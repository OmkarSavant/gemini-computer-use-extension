/**
 * Gemini Client for Computer Use
 *
 * This module wraps the official @google/generative-ai SDK to match
 * the behavior of the Python google-gemini/computer-use-preview agent.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Predefined computer use functions (matching original)
export const PREDEFINED_COMPUTER_USE_FUNCTIONS = [
    "open_web_browser",
    "click_at",
    "hover_at",
    "type_text_at",
    "scroll_document",
    "scroll_at",
    "wait_5_seconds",
    "go_back",
    "go_forward",
    "search",
    "navigate",
    "key_combination",
    "drag_and_drop",
];

const MAX_RECENT_TURN_WITH_SCREENSHOTS = 3;

/**
 * Browser Agent - mirrors the Python BrowserAgent class
 */
export class BrowserAgent {
    constructor(settings) {
        this.settings = settings;
        this.contents = [];
        this.finalReasoning = null;

        // Initialize the Gemini client
        const genAI = new GoogleGenerativeAI(settings.apiKey);

        // Detect if model supports thinking (2.5+ and 3.0 models)
        const supportsThinking = settings.modelName.includes('gemini-3') ||
            settings.modelName.includes('gemini-2.5');

        // Build generation config with optional thinkingConfig
        const generationConfig = {
            temperature: 1,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
        };

        // Build model options
        const modelOptions = {
            model: settings.modelName,
            tools: [{
                // Computer Use tool configuration
                computerUse: {
                    environment: "ENVIRONMENT_BROWSER"
                }
            }],
            generationConfig,
        };

        // Enable thought summaries for models that support thinking
        if (supportsThinking) {
            modelOptions.generationConfig = {
                ...generationConfig,
                thinkingConfig: {
                    includeThoughts: true
                }
            };
        }

        this.model = genAI.getGenerativeModel(modelOptions);
    }

    /**
     * Start a new conversation with the given query
     */
    startConversation(query) {
        this.contents = [{
            role: "user",
            parts: [{ text: query }]
        }];
        this.finalReasoning = null;
    }

    /**
     * Add a user message to the conversation
     */
    addUserMessage(text) {
        this.contents.push({
            role: "user",
            parts: [{ text }]
        });
    }

    /**
     * Get response from the model with retry logic
     * Matches original: 5 retries with exponential backoff
     */
    async getModelResponse() {
        const maxRetries = 5;
        const baseDelayMs = 1000;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const result = await this.model.generateContent({
                    contents: this.contents
                });
                return result.response;
            } catch (error) {
                console.warn(`API request failed (attempt ${attempt + 1}/${maxRetries}):`, error);

                if (attempt === maxRetries - 1) {
                    // Final attempt failed - enhance error message with details
                    let errorMessage = error.message || 'Unknown API error';

                    // Try to extract more details from the error
                    if (error.status) {
                        errorMessage = `[${error.status}] ${errorMessage}`;
                    }
                    if (error.statusText) {
                        errorMessage += ` (${error.statusText})`;
                    }

                    // Create enhanced error
                    const enhancedError = new Error(errorMessage);
                    enhancedError.originalError = error;
                    throw enhancedError;
                }

                // Exponential backoff: 1s, 2s, 4s, 8s, 16s
                const delayMs = baseDelayMs * Math.pow(2, attempt);
                console.log(`Retrying in ${delayMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    /**
     * Extract text from a candidate response (excluding thought parts)
     */
    getText(candidate) {
        if (!candidate.content?.parts) return null;

        const textParts = candidate.content.parts
            .filter(part => part.text && !part.thought)
            .map(part => part.text);

        return textParts.length > 0 ? textParts.join('') : null;
    }

    /**
     * Extract thought summary from a candidate response
     */
    extractThoughtSummary(candidate) {
        if (!candidate.content?.parts) return null;

        const thoughtParts = candidate.content.parts
            .filter(part => part.thought && part.text)
            .map(part => part.text);

        return thoughtParts.length > 0 ? thoughtParts.join('\n') : null;
    }

    /**
     * Extract function calls from a candidate response
     */
    extractFunctionCalls(candidate) {
        if (!candidate.content?.parts) return [];

        return candidate.content.parts
            .filter(part => part.functionCall)
            .map(part => ({
                name: part.functionCall.name,
                args: part.functionCall.args || {}
            }));
    }

    /**
     * Check if the response has a malformed function call
     */
    isMalformedFunctionCall(candidate) {
        return candidate.finishReason === 'MALFORMED_FUNCTION_CALL';
    }

    /**
     * Add model response to conversation history
     */
    addModelResponse(candidate) {
        if (candidate.content) {
            this.contents.push(candidate.content);
        }
    }

    /**
     * Build function responses and add to conversation
     * @param {Array} functionResponses - Array of {name, response, screenshot} objects
     */
    addFunctionResponses(functionResponses) {
        const parts = functionResponses.map(fr => {
            const functionResponse = {
                name: fr.name,
                response: fr.response
            };

            // Include screenshot in parts if provided (matching Python FunctionResponsePart)
            if (fr.screenshot) {
                functionResponse.parts = [{
                    inlineData: {
                        mimeType: 'image/png',
                        data: fr.screenshot
                    }
                }];
            }

            return { functionResponse };
        });

        this.contents.push({
            role: "user",
            parts
        });

        // Clean up old screenshots
        this._cleanupOldScreenshots();
    }

    /**
     * Remove screenshots from old turns to manage context size
     * Matches the Python implementation's screenshot cleanup logic
     */
    _cleanupOldScreenshots() {
        let turnWithScreenshotsFound = 0;

        // Iterate backwards through conversation history
        for (let i = this.contents.length - 1; i >= 0; i--) {
            const content = this.contents[i];

            if (content.role === 'user' && content.parts) {
                let hasScreenshot = false;

                for (const part of content.parts) {
                    if (part.functionResponse?.parts &&
                        PREDEFINED_COMPUTER_USE_FUNCTIONS.includes(part.functionResponse.name)) {
                        hasScreenshot = true;
                        break;
                    }
                }

                if (hasScreenshot) {
                    turnWithScreenshotsFound++;

                    if (turnWithScreenshotsFound > MAX_RECENT_TURN_WITH_SCREENSHOTS) {
                        for (const part of content.parts) {
                            if (part.functionResponse?.parts &&
                                PREDEFINED_COMPUTER_USE_FUNCTIONS.includes(part.functionResponse.name)) {
                                part.functionResponse.parts = null;
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Check if a function call requires safety confirmation
     */
    requiresSafetyConfirmation(functionCall) {
        const safetyDecision = functionCall.args?.safety_decision;

        if (safetyDecision?.decision === 'require_confirmation') {
            return {
                required: true,
                explanation: safetyDecision.explanation || 'Action requires confirmation'
            };
        }

        return { required: false };
    }

    /**
     * Check if the model is waiting for user input
     */
    isWaitingForInput(text) {
        if (!text) return false;

        const questionIndicators = [
            /\?$/m,
            /please confirm/i,
            /should I/i,
            /would you like/i,
            /which one/i,
            /do you want/i,
            /can you (tell|provide|specify)/i,
            /let me know/i
        ];

        return questionIndicators.some(pattern => pattern.test(text));
    }

    /**
     * Reset the conversation
     */
    reset() {
        this.contents = [];
        this.finalReasoning = null;
    }
}

/**
 * Sleep utility
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format a function call for display
 */
export function formatFunctionCall(functionCall) {
    const { name, args } = functionCall;

    switch (name) {
        case 'click_at':
            return `click_at(${args.x}, ${args.y})`;

        case 'type_text_at': {
            const text = args.text || '';
            const truncatedText = text.length > 30 ? text.substring(0, 30) + '...' : text;
            let result = `type_text_at(${args.x}, ${args.y}, "${truncatedText}"`;
            if (args.press_enter) result += ', press_enter=true';
            if (args.clear_before_typing) result += ', clear=true';
            return result + ')';
        }

        case 'scroll_document':
            return `scroll_document("${args.direction}")`;

        case 'scroll_at': {
            let result = `scroll_at(${args.x}, ${args.y}, "${args.direction}"`;
            if (args.magnitude) result += `, magnitude=${args.magnitude}`;
            return result + ')';
        }

        case 'navigate':
            return `navigate("${args.url}")`;

        case 'go_back':
            return 'go_back()';

        case 'go_forward':
            return 'go_forward()';

        case 'hover_at':
            return `hover_at(${args.x}, ${args.y})`;

        case 'key_combination':
            return `key_combination("${args.keys}")`;

        case 'drag_and_drop':
            return `drag_and_drop(${args.x}, ${args.y}, ${args.destination_x}, ${args.destination_y})`;

        case 'wait_5_seconds':
            return 'wait_5_seconds()';

        case 'search':
            return 'search()';

        case 'open_web_browser':
            return 'open_web_browser()';

        default:
            return `${name}(${JSON.stringify(args)})`;
    }
}
