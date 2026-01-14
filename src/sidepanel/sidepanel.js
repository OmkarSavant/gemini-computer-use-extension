/**
 * Side panel JavaScript for Gemini Computer Use extension
 *
 * This module handles the UI interactions and communication
 * with the background service worker.
 */

// DOM Elements
const newChatBtn = document.getElementById('new-chat-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsClose = document.getElementById('settings-close');
const modelSelect = document.getElementById('model-select');
const thinkingLevelSelect = document.getElementById('thinking-level');
const thinkingLevelSection = document.getElementById('thinking-level-section');
const useVertexCheckbox = document.getElementById('use-vertex');
const apiKeySection = document.getElementById('api-key-section');
const vertexSection = document.getElementById('vertex-section');
const apiKeyInput = document.getElementById('api-key');
const toggleApiKeyBtn = document.getElementById('toggle-api-key');
const vertexProjectInput = document.getElementById('vertex-project');
const vertexLocationInput = document.getElementById('vertex-location');
const highlightMouseCheckbox = document.getElementById('highlight-mouse');
const saveSettingsBtn = document.getElementById('save-settings');
const conversationDiv = document.getElementById('conversation');
const safetyBanner = document.getElementById('safety-banner');
const safetyAction = document.getElementById('safety-action');
const safetyReason = document.getElementById('safety-reason');
const safetyAllowBtn = document.getElementById('safety-allow');
const safetyDenyBtn = document.getElementById('safety-deny');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const exportBtn = document.getElementById('export-btn');

// Thinking level options by model type (2.5 Computer Use has no configurable thinking)
const THINKING_LEVELS = {
  'gemini-3-pro': [
    { value: 'low', label: 'Low (faster, less reasoning)' },
    { value: 'high', label: 'High (slower, more reasoning)' }
  ],
  'gemini-3-flash': [
    { value: 'minimal', label: 'Minimal (fastest, minimal reasoning)' },
    { value: 'low', label: 'Low (fast, less reasoning)' },
    { value: 'medium', label: 'Medium (balanced)' },
    { value: 'high', label: 'High (slow, more reasoning)' }
  ]
};

// State
let currentStatus = 'idle';
let isFirstMessage = true;

/**
 * Load settings from storage
 */
async function loadSettings() {
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || {};

  modelSelect.value = settings.modelName || 'gemini-2.5-computer-use-preview-10-2025';
  updateThinkingLevelOptions();
  thinkingLevelSelect.value = settings.thinkingLevel || 'low';
  useVertexCheckbox.checked = settings.useVertexAI || false;
  apiKeyInput.value = settings.apiKey || '';
  vertexProjectInput.value = settings.vertexProject || '';
  vertexLocationInput.value = settings.vertexLocation || 'us-central1';
  highlightMouseCheckbox.checked = settings.highlightMouse || false;

  updateVertexVisibility();
}

/**
 * Update thinking level dropdown options based on selected model
 */
function updateThinkingLevelOptions() {
  const modelName = modelSelect.value;
  let options;

  // 2.5 Computer Use has no configurable thinking levels
  if (modelName.includes('computer-use')) {
    thinkingLevelSection.classList.add('hidden');
    return;
  }

  // Show thinking level section for 3.0 models
  thinkingLevelSection.classList.remove('hidden');

  if (modelName.includes('gemini-3-flash')) {
    options = THINKING_LEVELS['gemini-3-flash'];
  } else if (modelName.includes('gemini-3-pro')) {
    options = THINKING_LEVELS['gemini-3-pro'];
  } else {
    // Fallback - hide if unknown model
    thinkingLevelSection.classList.add('hidden');
    return;
  }

  // Save current selection if valid for new model
  const currentValue = thinkingLevelSelect.value;

  // Clear and repopulate options
  thinkingLevelSelect.innerHTML = '';
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    thinkingLevelSelect.appendChild(option);
  }

  // Restore selection if valid, otherwise default to 'low'
  const validValues = options.map(o => o.value);
  if (validValues.includes(currentValue)) {
    thinkingLevelSelect.value = currentValue;
  } else {
    thinkingLevelSelect.value = 'low';
  }
}

/**
 * Save settings to storage
 */
async function saveSettings() {
  // Get previous settings to check if model changed
  const previousSettings = await getSettings();
  const previousModel = previousSettings.modelName;

  const settings = {
    modelName: modelSelect.value,
    thinkingLevel: thinkingLevelSelect.value,
    useVertexAI: useVertexCheckbox.checked,
    apiKey: apiKeyInput.value.trim(),
    vertexProject: vertexProjectInput.value.trim(),
    vertexLocation: vertexLocationInput.value.trim() || 'us-central1',
    highlightMouse: highlightMouseCheckbox.checked
  };

  await chrome.storage.local.set({ settings });

  // Close settings panel
  settingsPanel.classList.add('hidden');

  // If model changed, auto-start a new conversation
  if (previousModel && previousModel !== settings.modelName) {
    clearConversation();
    showStatus(`Model changed. New conversation started.`, 'idle');
    if (exportBtn) exportBtn.disabled = true;
  } else {
    // Show confirmation
    showStatus('Settings saved', 'idle');
  }
}

/**
 * Get current settings
 */
async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return result.settings || {
    modelName: 'gemini-2.5-computer-use-preview-10-2025',
    thinkingLevel: 'low',
    useVertexAI: false,
    apiKey: '',
    vertexProject: '',
    vertexLocation: 'us-central1',
    highlightMouse: false
  };
}

/**
 * Update Vertex AI section visibility
 */
function updateVertexVisibility() {
  if (useVertexCheckbox.checked) {
    apiKeySection.classList.add('hidden');
    vertexSection.classList.remove('hidden');
  } else {
    apiKeySection.classList.remove('hidden');
    vertexSection.classList.add('hidden');
  }
}

/**
 * Toggle API key visibility
 */
function toggleApiKeyVisibility() {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
  } else {
    apiKeyInput.type = 'password';
  }
}

/**
 * Add a message to the conversation
 */
function addMessage(role, content, actions = [], thoughtSummary = null, isError = false) {
  // Remove welcome message if present
  const welcomeMessage = conversationDiv.querySelector('.welcome-message');
  if (welcomeMessage) {
    welcomeMessage.remove();
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}${isError ? ' error' : ''}`;

  const senderDiv = document.createElement('div');
  senderDiv.className = 'message-sender';
  senderDiv.textContent = role === 'user' ? 'You' : (isError ? '⚠️ Error' : 'Model');

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  if (content) {
    const textP = document.createElement('p');
    textP.textContent = content;
    contentDiv.appendChild(textP);
  }

  // Add thought summary if present (before actions)
  if (thoughtSummary) {
    const thoughtDetails = document.createElement('details');
    thoughtDetails.className = 'thought-block';
    thoughtDetails.open = false;  // Collapsed by default

    const thoughtSummaryEl = document.createElement('summary');
    thoughtSummaryEl.textContent = '💭 Thought Summary';
    thoughtDetails.appendChild(thoughtSummaryEl);

    const thoughtContent = document.createElement('div');
    thoughtContent.className = 'thought-content';
    thoughtContent.textContent = thoughtSummary;
    thoughtDetails.appendChild(thoughtContent);

    contentDiv.appendChild(thoughtDetails);
  }

  // Add action blocks if present
  if (actions && actions.length > 0) {
    const actionsDetails = document.createElement('details');
    actionsDetails.className = 'action-block';
    actionsDetails.open = true;

    const actionsSummary = document.createElement('summary');
    actionsSummary.textContent = `Actions (${actions.length})`;
    actionsDetails.appendChild(actionsSummary);

    for (const action of actions) {
      const actionDiv = document.createElement('div');
      actionDiv.className = 'action-item';
      actionDiv.textContent = action;
      actionsDetails.appendChild(actionDiv);
    }

    contentDiv.appendChild(actionsDetails);
  }

  messageDiv.appendChild(senderDiv);
  messageDiv.appendChild(contentDiv);
  conversationDiv.appendChild(messageDiv);

  // Scroll to bottom
  conversationDiv.scrollTop = conversationDiv.scrollHeight;
}

/**
 * Show safety confirmation banner
 */
function showSafetyConfirmation(action, explanation) {
  safetyAction.textContent = `Model wants to: ${action}`;
  safetyReason.textContent = `Reason: ${explanation}`;
  safetyBanner.classList.remove('hidden');

  // Disable input while safety confirmation is shown
  messageInput.disabled = true;
  sendBtn.disabled = true;
}

/**
 * Hide safety confirmation banner
 */
function hideSafetyConfirmation() {
  safetyBanner.classList.add('hidden');
  messageInput.disabled = false;
  updateButtonStates();
}

/**
 * Update status display
 */
function showStatus(text, status) {
  currentStatus = status;
  statusText.textContent = text;
  statusIndicator.className = `status-indicator ${status}`;
  updateButtonStates();
}

/**
 * Update button states based on current status
 */
function updateButtonStates() {
  const isRunning = currentStatus === 'running';

  sendBtn.disabled = isRunning || messageInput.disabled;
  stopBtn.disabled = !isRunning;

  if (isRunning) {
    sendBtn.textContent = 'Running...';
  } else {
    sendBtn.textContent = 'Send';
  }
}

/**
 * Send a message
 */
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  const settings = await getSettings();

  // Validate settings
  if (!settings.useVertexAI && !settings.apiKey) {
    showStatus('Please set your API key in settings', 'error');
    settingsPanel.classList.remove('hidden');
    return;
  }

  if (settings.useVertexAI && !settings.vertexProject) {
    showStatus('Please set your Vertex AI project in settings', 'error');
    settingsPanel.classList.remove('hidden');
    return;
  }

  messageInput.value = '';
  autoResizeTextarea();

  if (isFirstMessage) {
    // Start new agent
    chrome.runtime.sendMessage({
      type: 'START_AGENT',
      prompt: text,
      settings
    });
    isFirstMessage = false;
  } else {
    // Continue conversation
    chrome.runtime.sendMessage({
      type: 'USER_MESSAGE',
      text,
      settings
    });
  }

  showStatus('Running', 'running');
}

/**
 * Stop the agent
 */
function stopAgent() {
  chrome.runtime.sendMessage({ type: 'STOP_AGENT' });
  showStatus('Stopped', 'idle');
}

/**
 * Handle safety confirmation response
 */
function handleSafetyResponse(allowed) {
  chrome.runtime.sendMessage({
    type: 'SAFETY_RESPONSE',
    allowed
  });
  hideSafetyConfirmation();
}

/**
 * Clear conversation
 */
function clearConversation() {
  conversationDiv.innerHTML = `
    <div class="welcome-message">
      <p>Welcome! Enter a task and I'll help you complete it using computer actions.</p>
      <p class="hint">Example: "Find and try the first demo prompt from the Gemini 2.5 Computer Use Blog"</p>
      <p class="hint">Ping osavant@ for issues/comments</p>
    </div>
  `;
  isFirstMessage = true;
  chrome.runtime.sendMessage({ type: 'RESET_CONVERSATION' });
}

/**
 * Auto-resize textarea
 */
function autoResizeTextarea() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

// Event listeners
newChatBtn.addEventListener('click', () => {
  // Stop any running agent first
  stopAgent();
  // Clear the conversation and reset state
  clearConversation();
  showStatus('Idle', 'idle');
  // Disable export button
  if (exportBtn) exportBtn.disabled = true;
});

settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.remove('hidden');
});

settingsClose.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

useVertexCheckbox.addEventListener('change', updateVertexVisibility);

// Update thinking level options when model changes
modelSelect.addEventListener('change', updateThinkingLevelOptions);

toggleApiKeyBtn.addEventListener('click', toggleApiKeyVisibility);

saveSettingsBtn.addEventListener('click', saveSettings);

sendBtn.addEventListener('click', sendMessage);

stopBtn.addEventListener('click', stopAgent);

safetyAllowBtn.addEventListener('click', () => handleSafetyResponse(true));

safetyDenyBtn.addEventListener('click', () => handleSafetyResponse(false));

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

messageInput.addEventListener('input', autoResizeTextarea);

// Export trajectory
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';

    try {
      const response = await chrome.runtime.sendMessage({ type: 'EXPORT_TRAJECTORY' });
      if (response.success) {
        showStatus(`Exported: ${response.filename}`, 'idle');
      } else {
        showStatus(`Export failed: ${response.error}`, 'error');
      }
    } catch (error) {
      showStatus(`Export error: ${error.message}`, 'error');
    }

    exportBtn.textContent = 'Export';
    // Re-enable if there's still trajectory data
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
      if (status) exportBtn.disabled = !status.hasTrajectory;
    });
  });
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'UPDATE_CONVERSATION':
      addMessage(
        message.message.role,
        message.message.content,
        message.message.actions,
        message.message.thoughtSummary
      );
      break;

    case 'STATUS_UPDATE':
      switch (message.status) {
        case 'running':
          showStatus('Running', 'running');
          break;
        case 'waiting':
          showStatus('Waiting for input', 'waiting');
          break;
        case 'idle':
          showStatus('Idle', 'idle');
          break;
        case 'error':
          showStatus('Error', 'error');
          break;
      }
      break;

    case 'SAFETY_CONFIRMATION':
      showSafetyConfirmation(message.action, message.explanation);
      break;

    case 'ERROR':
      addMessage('model', message.message, [], null, true);  // isError = true
      showStatus('Error', 'error');
      break;

    case 'WAITING_FOR_INPUT':
      showStatus('Waiting for input', 'waiting');
      messageInput.focus();
      break;

    case 'TRAJECTORY_UPDATED':
      // Enable export button when trajectory data becomes available
      if (exportBtn && message.hasTrajectory) {
        exportBtn.disabled = false;
      }
      break;
  }

  sendResponse({ received: true });
  return true;
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  updateButtonStates();
});

// Also run immediately in case DOMContentLoaded already fired
loadSettings();
updateButtonStates();
