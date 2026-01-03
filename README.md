# Gemini Computer Use Chrome Extension

A Chrome extension that enables testing the Gemini Computer Use model directly in your browser. This extension allows an AI agent to interact with web pages by taking screenshots, analyzing them, and executing actions like clicking, typing, and scrolling.

This implementation uses the official `@google/generative-ai` JavaScript SDK to closely mirror the Python [google-gemini/computer-use-preview](https://github.com/google-gemini/computer-use-preview) agent.

## Building the Extension

### Prerequisites

- Node.js 18+ installed
- npm

### Build Steps

```bash
# Install dependencies
npm install

# Build the extension
npm run build
```

This creates a `dist/` folder containing the ready-to-load extension.

### Development Mode

```bash
# Watch for changes and rebuild automatically
npm run watch
```

## Installation

1. Build the extension (see above)
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" using the toggle in the top right corner
4. Click "Load unpacked" and select the `dist` folder (not the root folder!)
5. The extension icon will appear in your Chrome toolbar

## Note: Your Gemini API key must be a paid tier key - free tier keys will not work. 

## Usage

### Basic Setup

1. Click the extension icon in your Chrome toolbar to open the side panel
2. Click the gear icon to open Settings
3. Enter your API key (or configure Vertex AI settings)
4. Click "Save Settings"

### Running Tasks

1. Navigate to any webpage
2. Type a task in the message input
3. Click "Send" or press Enter
4. Watch as the agent analyzes the page and executes actions

### Multi-Turn Conversations

The extension supports multi-turn conversations:
- If the model asks a question, it will pause and wait for your response
- Simply type your answer and click Send to continue
- The agent maintains the full conversation history for context

### Safety Confirmations

For potentially sensitive actions (like form submissions or purchases), the model may request confirmation:
- A yellow safety banner will appear
- Review the proposed action
- Click "Allow" to proceed or "Deny" to skip the action

### Controls

- **Send**: Submit your message or task
- **Stop**: Immediately halt the agent's actions
- **Settings**: Configure API keys and options

## Settings

| Setting | Description |
|---------|-------------|
| Model Name | The Gemini model to use (default: `gemini-2.5-computer-use-preview-10-2025`) |
| Use Vertex AI | Toggle between Gemini Developer API and Vertex AI |
| API Key | Your Gemini API key (when not using Vertex AI) |
| Project ID | Your GCP project ID (when using Vertex AI) |
| Location | Vertex AI region (default: `us-central1`) |
| Highlight Mouse | Show a visual indicator when the agent clicks |

## Supported Actions

The agent can perform the following actions:

| Action | Description |
|--------|-------------|
| `click_at` | Click at a specific position on the page |
| `type_text_at` | Type text at a position (optionally press Enter) |
| `scroll_document` | Scroll the page up, down, left, or right |
| `scroll_at` | Scroll a specific element |
| `navigate` | Navigate to a URL |
| `go_back` | Go back in browser history |
| `go_forward` | Go forward in browser history |
| `hover_at` | Hover over an element |
| `key_combination` | Press keyboard shortcuts (e.g., Ctrl+C) |
| `drag_and_drop` | Drag from one position to another |
| `wait_5_seconds` | Wait for 5 seconds |
| `search` | Navigate to Google |

## Known Limitations

1. **Same-origin restrictions**: The extension cannot capture screenshots or execute actions on certain protected pages:
   - Chrome internal pages (`chrome://`, `chrome-extension://`)
   - The Chrome Web Store
   - Some browser-specific pages

2. **Cross-frame limitations**: Actions cannot be executed inside iframes from different origins.

3. **Dynamic content**: Very fast-changing content may not be accurately captured in screenshots.

4. **Complex interactions**: Some complex JavaScript-based interactions (like drag-and-drop in certain applications) may not work perfectly with simulated events.

5. **Authentication**: The extension cannot interact with pages that require authentication unless you're already logged in.

6. **Rate limits**: The Gemini API has rate limits. If you hit them, wait a moment before retrying.

## Troubleshooting

### Actions not working on a page
- Some pages block automated interactions
- Try refreshing the page and starting again
- Check if the page uses complex JavaScript frameworks that may interfere

### Screenshot capture fails
- Make sure you're on a regular webpage (not a Chrome internal page)
- Check that the tab has finished loading
- Some pages may block screenshot capture

## Privacy & Security

- API keys are stored locally in Chrome's extension storage
- Screenshots are sent to the Gemini API for analysis
- No data is stored on external servers beyond the API call
- Conversation history is stored in memory only and cleared when you close the browser

## File Structure

```
gemini-computer-use-extension/
├── manifest.json           # Extension configuration
├── sidepanel/
│   ├── sidepanel.html     # Side panel UI
│   ├── sidepanel.css      # Styles
│   └── sidepanel.js       # UI logic
├── background/
│   └── service-worker.js  # Agent loop and API calls
├── content/
│   └── content.js         # Action execution in pages
├── lib/
│   ├── api.js             # Gemini API client
│   ├── actions.js         # Action utilities
│   └── coordinates.js     # Coordinate conversion
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## License

This project is provided for testing and evaluation purposes.
