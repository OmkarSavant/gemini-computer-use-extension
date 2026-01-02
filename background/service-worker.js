/**
 * Background service worker for Gemini Computer Use extension
 *
 * This service worker manages the agent loop, coordinates with the
 * content script for action execution, and communicates with the side panel.
 */

import {
  callGeminiAPI,
  extractFunctionCalls,
  extractText,
  isWaitingForInput,
  requiresSafetyConfirmation,
  buildFunctionResponse,
  buildUserMessage,
  sleep
} from '../lib/api.js';

import { formatFunctionCall } from '../lib/actions.js';

// State management
let conversationHistory = [];
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
        return { success: false, error: 'Failed to inject content script: ' + injectError.message };
      }
    }
    return { success: false, error: error.message };
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
  // Wait a bit for any navigation or dynamic content to load
  await sleep(500);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.status === 'loading') {
      // Wait for tab to finish loading
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

      // Additional delay after page load
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
 * Main agent loop
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
    // If this is a new conversation, add the initial message
    if (initialPrompt) {
      await waitForPageSettle();
      const screenshot = await captureScreenshot();

      conversationHistory.push(buildUserMessage(initialPrompt, screenshot));

      sendToSidepanel({
        type: 'UPDATE_CONVERSATION',
        message: {
          role: 'user',
          content: initialPrompt
        }
      });
    }

    while (isRunning && !shouldStop) {
      // Call Gemini API
      let response;
      try {
        response = await callGeminiAPI(conversationHistory, currentSettings);
      } catch (error) {
        sendToSidepanel({
          type: 'ERROR',
          message: error.message
        });
        break;
      }

      // Add model response to history
      conversationHistory.push({
        role: 'model',
        parts: response.parts
      });

      // Extract text and function calls
      const text = extractText(response.parts);
      const functionCalls = extractFunctionCalls(response.parts);

      // Send model message to UI
      sendToSidepanel({
        type: 'UPDATE_CONVERSATION',
        message: {
          role: 'model',
          content: text,
          actions: functionCalls.map(fc => formatFunctionCall(fc))
        }
      });

      // Check if there are no function calls
      if (functionCalls.length === 0) {
        // Model is done or asking a question
        isRunning = false;
        sendToSidepanel({
          type: 'STATUS_UPDATE',
          status: isWaitingForInput(response.parts) ? 'waiting' : 'idle'
        });
        break;
      }

      // Execute each function call
      const functionResponses = [];

      for (const fc of functionCalls) {
        if (shouldStop) break;

        // Check for safety confirmation requirement
        const safety = requiresSafetyConfirmation(fc);
        let safetyAcknowledgement = false;

        if (safety.required) {
          const allowed = await requestSafetyConfirmation(fc, safety.explanation);

          if (!allowed) {
            functionResponses.push(
              buildFunctionResponse(fc.name, {
                denied: true,
                reason: 'User denied action'
              })
            );
            continue;
          }
          safetyAcknowledgement = true;
        }

        // Execute the action
        const result = await executeAction(fc.name, fc.args, currentSettings?.highlightMouse);

        functionResponses.push(
          buildFunctionResponse(fc.name, result, safetyAcknowledgement)
        );

        // Wait a bit between actions
        await sleep(200);
      }

      if (shouldStop) break;

      // Wait for page to settle before taking screenshot
      await waitForPageSettle();

      // Capture new screenshot
      const newScreenshot = await captureScreenshot();

      // Add function responses to history
      const userParts = [
        ...functionResponses.map(fr => fr),
        { inlineData: { mimeType: 'image/png', data: newScreenshot } }
      ];

      conversationHistory.push({
        role: 'user',
        parts: userParts
      });

      // Small delay before next iteration
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

  try {
    await waitForPageSettle();
    const screenshot = await captureScreenshot();

    conversationHistory.push(buildUserMessage(text, screenshot));

    sendToSidepanel({
      type: 'UPDATE_CONVERSATION',
      message: {
        role: 'user',
        content: text
      }
    });

    // Resume the agent loop
    runAgentLoop(null);
  } catch (error) {
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
  conversationHistory = [];
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
        conversationLength: conversationHistory.length
      });
      break;

    default:
      sendResponse({ error: 'Unknown message type' });
  }

  return true;
});

console.log('[Gemini Computer Use] Service worker loaded');
