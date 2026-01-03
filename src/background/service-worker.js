/**
 * Background service worker for Gemini Computer Use extension
 *
 * This service worker manages the agent loop using the BrowserAgent class,
 * mirroring the Python google-gemini/computer-use-preview implementation.
 */

import { BrowserAgent, formatFunctionCall, sleep } from '../lib/gemini-client.js';

// State management
let agent = null;
let isRunning = false;
let shouldStop = false;
let currentSettings = null;
let pendingSafetyConfirmation = null;

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Enable side panel for all tabs
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

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
      actions: functionCalls.map(fc => formatFunctionCall(fc))
    }
  });

  // No function calls - agent is complete or waiting for input
  if (!functionCalls.length) {
    console.log('Agent Loop Complete:', reasoning);
    agent.finalReasoning = reasoning;

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
function resetConversation() {
  if (agent) {
    agent.reset();
  }
  agent = null;
  isRunning = false;
  shouldStop = false;
  pendingSafetyConfirmation = null;
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
        conversationLength: agent?.contents?.length || 0
      });
      break;

    default:
      sendResponse({ error: 'Unknown message type' });
  }

  return true;
});

console.log('[Gemini Computer Use] Service worker loaded');
