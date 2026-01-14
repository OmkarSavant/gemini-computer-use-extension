/**
 * Background service worker for Gemini Computer Use extension
 *
 * This service worker manages the agent loop using the BrowserAgent class,
 * mirroring the Python google-gemini/computer-use-preview implementation.
 */

import { BrowserAgent, formatFunctionCall, sleep } from '../lib/gemini-client.js';
import { generateTrajectoryHTML, generateFilename } from '../lib/trajectory-export.js';

// State management
let agent = null;
let isRunning = false;
let shouldStop = false;
let currentSettings = null;
let pendingSafetyConfirmation = null;

// Trajectory tracking for export (cached from storage)
let trajectorySteps = [];
let trajectoryStartTime = null;
let storedInitialPrompt = null;
let storedModelName = null;

/**
 * Save trajectory data to chrome.storage.local for persistence
 */
async function saveTrajectoryToStorage() {
  await chrome.storage.local.set({
    trajectoryData: {
      steps: trajectorySteps,
      startTime: trajectoryStartTime,
      initialPrompt: storedInitialPrompt,
      modelName: storedModelName,
      savedAt: Date.now()  // Track when data was saved for expiry
    }
  });
}

// Trajectory data expires after 24 hours
const TRAJECTORY_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Load trajectory data from chrome.storage.local
 * Clears data if older than 24 hours
 */
async function loadTrajectoryFromStorage() {
  const result = await chrome.storage.local.get('trajectoryData');
  if (result.trajectoryData) {
    // Check if data has expired (24 hours)
    const savedAt = result.trajectoryData.savedAt || 0;
    if (Date.now() - savedAt > TRAJECTORY_EXPIRY_MS) {
      console.log('[Gemini CU] Clearing expired trajectory data');
      await clearTrajectoryStorage();
      return;
    }

    trajectorySteps = result.trajectoryData.steps || [];
    trajectoryStartTime = result.trajectoryData.startTime || null;
    storedInitialPrompt = result.trajectoryData.initialPrompt || null;
    storedModelName = result.trajectoryData.modelName || null;
  }
}

/**
 * Clear trajectory data from storage
 */
async function clearTrajectoryStorage() {
  trajectorySteps = [];
  trajectoryStartTime = null;
  storedInitialPrompt = null;
  storedModelName = null;
  await chrome.storage.local.remove('trajectoryData');
}

// Load trajectory on service worker startup (with expiry check)
loadTrajectoryFromStorage();

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Enable side panel for all tabs
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });

/**
 * Capture screenshot of the active tab
 */
async function captureScreenshot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 90
    });

    // Remove the data URL prefix to get just the base64 data
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    return base64Data;
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    throw error;
  }
}

/**
 * Get current tab URL
 */
async function getCurrentUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || '';
}

/**
 * Execute an action in the content script
 */
async function executeAction(action, args, highlightMouse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }

    // Special handling for wait_5_seconds
    if (action === 'wait_5_seconds') {
      await sleep(5000);
      return { success: true, waited: 5000, url: tab.url };
    }

    // Send action to content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXECUTE_ACTION',
      action,
      args,
      highlightMouse
    });

    return response;
  } catch (error) {
    // Content script might not be loaded, try injecting it
    if (error.message.includes('Receiving end does not exist')) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/content.js']
        });

        // Retry the action
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'EXECUTE_ACTION',
          action,
          args,
          highlightMouse
        });
        return response;
      } catch (injectError) {
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
        return { success: false, error: 'Failed to inject content script: ' + injectError.message, url: t?.url || '' };
      }
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return { success: false, error: error.message, url: tab?.url || '' };
  }
}

/**
 * Send a message to the side panel
 */
function sendToSidepanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel might not be open, ignore error
  });
}

/**
 * Wait for page to settle after navigation/action
 */
async function waitForPageSettle() {
  await sleep(500);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.status === 'loading') {
      await new Promise((resolve) => {
        const listener = (tabId, changeInfo) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);

        // Timeout after 10 seconds
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 10000);
      });

      await sleep(500);
    }
  } catch (error) {
    console.error('Error waiting for page settle:', error);
  }
}

/**
 * Request safety confirmation from the user
 */
async function requestSafetyConfirmation(functionCall, explanation) {
  return new Promise((resolve) => {
    pendingSafetyConfirmation = { resolve, functionCall };

    sendToSidepanel({
      type: 'SAFETY_CONFIRMATION',
      action: formatFunctionCall(functionCall),
      explanation
    });
  });
}

/**
 * Run one iteration of the agent loop
 * Mirrors the Python run_one_iteration method
 */
async function runOneIteration() {
  // Get model response
  let response;
  try {
    response = await agent.getModelResponse();
  } catch (error) {
    console.error('Error getting model response:', error);
    sendToSidepanel({
      type: 'ERROR',
      message: error.message
    });
    return 'COMPLETE';
  }

  if (!response.candidates || response.candidates.length === 0) {
    console.error('Response has no candidates');
    sendToSidepanel({
      type: 'ERROR',
      message: 'No response from model'
    });
    return 'COMPLETE';
  }

  const candidate = response.candidates[0];

  // Add model response to history
  agent.addModelResponse(candidate);

  // Extract reasoning and function calls
  const reasoning = agent.getText(candidate);
  const thoughtSummary = agent.extractThoughtSummary(candidate);
  const functionCalls = agent.extractFunctionCalls(candidate);

  // Handle malformed function call - retry
  if (!functionCalls.length && !reasoning && agent.isMalformedFunctionCall(candidate)) {
    console.log('Malformed function call detected, retrying...');
    return 'CONTINUE';
  }

  // Send model message to UI
  sendToSidepanel({
    type: 'UPDATE_CONVERSATION',
    message: {
      role: 'model',
      content: reasoning,
      thoughtSummary: thoughtSummary,
      actions: functionCalls.map(fc => formatFunctionCall(fc))
    }
  });

  // No function calls - agent is complete or waiting for input
  if (!functionCalls.length) {
    console.log('Agent Loop Complete:', reasoning);
    agent.finalReasoning = reasoning;

    // Track final response in trajectory (even without screenshot)
    if (reasoning || thoughtSummary) {
      trajectorySteps.push({
        timestamp: new Date().toISOString(),
        screenshot: null,
        text: reasoning,
        thoughts: thoughtSummary,
        actions: [],
        result: { final: true }
      });
      // Save to storage and notify sidepanel
      await saveTrajectoryToStorage();
      sendToSidepanel({ type: 'TRAJECTORY_UPDATED', hasTrajectory: true });
    }

    sendToSidepanel({
      type: 'STATUS_UPDATE',
      status: agent.isWaitingForInput(reasoning) ? 'waiting' : 'idle'
    });

    return 'COMPLETE';
  }

  // Execute each function call
  const functionResponses = [];

  for (const fc of functionCalls) {
    if (shouldStop) break;

    // Check for safety confirmation requirement
    const safety = agent.requiresSafetyConfirmation(fc);
    let safetyAcknowledgement = false;

    if (safety.required) {
      const allowed = await requestSafetyConfirmation(fc, safety.explanation);

      if (!allowed) {
        console.log('Terminating agent loop - user denied action');
        return 'COMPLETE';
      }
      safetyAcknowledgement = true;
    }

    // Execute the action
    const result = await executeAction(fc.name, fc.args, currentSettings?.highlightMouse);

    // Wait for page to settle and capture screenshot
    await waitForPageSettle();
    const screenshot = await captureScreenshot();

    // Build function response (matching Python EnvState structure)
    const response = {
      url: result.url || await getCurrentUrl()
    };

    if (safetyAcknowledgement) {
      response.safety_acknowledgement = 'true';
    }

    functionResponses.push({
      name: fc.name,
      response,
      screenshot
    });

    // Track step for trajectory export
    trajectorySteps.push({
      timestamp: new Date().toISOString(),
      screenshot: screenshot,
      text: reasoning,
      thoughts: thoughtSummary,
      actions: [formatFunctionCall(fc)],
      result: response
    });

    // Save to storage and notify sidepanel
    await saveTrajectoryToStorage();
    sendToSidepanel({ type: 'TRAJECTORY_UPDATED', hasTrajectory: true });

    await sleep(200);
  }

  if (shouldStop) {
    return 'COMPLETE';
  }

  // Add function responses to conversation
  agent.addFunctionResponses(functionResponses);

  return 'CONTINUE';
}

/**
 * Main agent loop
 * Mirrors the Python run method
 */
async function runAgentLoop(initialPrompt) {
  if (isRunning) {
    console.warn('Agent already running');
    return;
  }

  isRunning = true;
  shouldStop = false;

  sendToSidepanel({ type: 'STATUS_UPDATE', status: 'running' });

  try {
    // Start new conversation if we have an initial prompt
    if (initialPrompt) {
      agent = new BrowserAgent(currentSettings);
      agent.startConversation(initialPrompt);

      // Initialize trajectory tracking
      trajectoryStartTime = new Date().toISOString();
      storedInitialPrompt = initialPrompt;
      storedModelName = currentSettings?.modelName || 'unknown';
      await saveTrajectoryToStorage();

      sendToSidepanel({
        type: 'UPDATE_CONVERSATION',
        message: {
          role: 'user',
          content: initialPrompt
        }
      });
    }

    // Agent loop
    while (isRunning && !shouldStop) {
      const result = await runOneIteration();

      if (result === 'COMPLETE') {
        break;
      }

      await sleep(300);
    }
  } catch (error) {
    console.error('Agent loop error:', error);
    sendToSidepanel({
      type: 'ERROR',
      message: error.message
    });
  } finally {
    isRunning = false;
    pendingSafetyConfirmation = null;

    if (!shouldStop) {
      sendToSidepanel({ type: 'STATUS_UPDATE', status: 'idle' });
    }
  }
}

/**
 * Handle user follow-up message
 */
async function handleUserMessage(text) {
  if (isRunning) {
    console.warn('Agent is already running');
    return;
  }

  if (!agent) {
    // Start a new conversation if no agent exists
    runAgentLoop(text);
    return;
  }

  try {
    // Add user message to existing conversation
    agent.addUserMessage(text);

    sendToSidepanel({
      type: 'UPDATE_CONVERSATION',
      message: {
        role: 'user',
        content: text
      }
    });

    // Resume the agent loop
    isRunning = true;
    shouldStop = false;
    sendToSidepanel({ type: 'STATUS_UPDATE', status: 'running' });

    while (isRunning && !shouldStop) {
      const result = await runOneIteration();

      if (result === 'COMPLETE') {
        break;
      }

      await sleep(300);
    }

    isRunning = false;
    if (!shouldStop) {
      sendToSidepanel({ type: 'STATUS_UPDATE', status: 'idle' });
    }
  } catch (error) {
    isRunning = false;
    sendToSidepanel({
      type: 'ERROR',
      message: error.message
    });
  }
}

/**
 * Stop the agent
 */
function stopAgent() {
  shouldStop = true;
  isRunning = false;
  pendingSafetyConfirmation = null;

  sendToSidepanel({ type: 'STATUS_UPDATE', status: 'idle' });
}

/**
 * Reset conversation
 */
async function resetConversation() {
  if (agent) {
    agent.reset();
  }
  agent = null;
  isRunning = false;
  shouldStop = false;
  pendingSafetyConfirmation = null;
  // Reset trajectory tracking and clear from storage
  await clearTrajectoryStorage();
}

/**
 * Generate a two-word title for the trajectory using Gemini Flash
 * Falls back gracefully if the API call fails
 */
async function generateTrajectoryTitle(prompt) {
  // If no API key available, return default
  if (!currentSettings?.apiKey) {
    return 'Agent Trajectory';
  }

  try {
    // Use gemini-2.5-flash-lite for faster, cheaper title generation
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${currentSettings.apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `Generate a two-word title (like "Email Search" or "Flight Booking") that summarizes this task. Reply with ONLY the two words, nothing else.\n\nTask: ${prompt}` }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 10
        }
      })
    });

    if (!response.ok) {
      console.warn('Title generation API error, using fallback');
      return 'Agent Trajectory';
    }

    const data = await response.json();
    const title = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Agent Trajectory';
    return title.split(/\s+/).slice(0, 3).join(' ');
  } catch (error) {
    console.error('Title generation failed:', error);
    return 'Agent Trajectory';
  }
}

/**
 * Export trajectory as HTML and trigger download
 */
async function exportTrajectory() {
  if (trajectorySteps.length === 0) {
    return { success: false, error: 'No trajectory data to export' };
  }

  try {
    const taskTitle = await generateTrajectoryTitle(storedInitialPrompt);

    const trajectoryData = {
      taskTitle,
      initialPrompt: storedInitialPrompt,
      startTime: trajectoryStartTime,
      modelName: storedModelName,
      steps: trajectorySteps
    };

    const html = generateTrajectoryHTML(trajectoryData);
    const filename = generateFilename(trajectoryStartTime, taskTitle);

    // Create data URL for download
    const blob = new Blob([html], { type: 'text/html' });
    const reader = new FileReader();

    return new Promise((resolve) => {
      reader.onloadend = async () => {
        try {
          await chrome.downloads.download({
            url: reader.result,
            filename: filename,
            saveAs: true
          });
          resolve({ success: true, filename });
        } catch (error) {
          resolve({ success: false, error: error.message });
        }
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_AGENT':
      currentSettings = message.settings;
      resetConversation();
      runAgentLoop(message.prompt);
      sendResponse({ success: true });
      break;

    case 'USER_MESSAGE':
      currentSettings = message.settings;
      handleUserMessage(message.text);
      sendResponse({ success: true });
      break;

    case 'STOP_AGENT':
      stopAgent();
      sendResponse({ success: true });
      break;

    case 'RESET_CONVERSATION':
      resetConversation();
      sendResponse({ success: true });
      break;

    case 'SAFETY_RESPONSE':
      if (pendingSafetyConfirmation) {
        pendingSafetyConfirmation.resolve(message.allowed);
        pendingSafetyConfirmation = null;
      }
      sendResponse({ success: true });
      break;

    case 'GET_STATUS':
      sendResponse({
        isRunning,
        conversationLength: agent?.contents?.length || 0,
        hasTrajectory: trajectorySteps.length > 0
      });
      break;

    case 'EXPORT_TRAJECTORY':
      exportTrajectory().then(result => {
        sendResponse(result);
      });
      return true; // Keep channel open for async response

    default:
      sendResponse({ error: 'Unknown message type' });
  }

  return true;
});

console.log('[Gemini Computer Use] Service worker loaded');
