/**
 * Gemini API client for Computer Use
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Build the API endpoint URL based on settings
 */
function buildEndpoint(settings) {
  if (settings.useVertexAI) {
    const { vertexProject, vertexLocation, modelName } = settings;
    return `https://${vertexLocation}-aiplatform.googleapis.com/v1/projects/${vertexProject}/locations/${vertexLocation}/publishers/google/models/${modelName}:generateContent`;
  } else {
    return `${GEMINI_API_BASE}/models/${settings.modelName}:generateContent?key=${settings.apiKey}`;
  }
}

/**
 * Build the request body for Gemini API
 */
function buildRequestBody(conversationHistory) {
  return {
    contents: conversationHistory,
    tools: [{
      computerUse: {
        environment: "ENVIRONMENT_BROWSER"
      }
    }],
    generationConfig: {
      temperature: 1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192
    }
  };
}

/**
 * Call the Gemini API with the conversation history
 */
export async function callGeminiAPI(conversationHistory, settings) {
  const endpoint = buildEndpoint(settings);
  const body = buildRequestBody(conversationHistory);

  // Debug: log the request (without full screenshot data)
  const debugBody = JSON.parse(JSON.stringify(body));
  debugBody.contents.forEach(content => {
    if (content.parts) {
      content.parts.forEach(part => {
        if (part.inlineData?.data) {
          part.inlineData.data = `[BASE64 ${part.inlineData.data.length} chars]`;
        }
        if (part.functionResponse?.parts) {
          part.functionResponse.parts.forEach(frPart => {
            if (frPart.inlineData?.data) {
              frPart.inlineData.data = `[BASE64 ${frPart.inlineData.data.length} chars]`;
            }
          });
        }
      });
    }
  });
  console.log('[Gemini API] Request:', JSON.stringify(debugBody, null, 2));

  const headers = {
    'Content-Type': 'application/json'
  };

  // For Vertex AI, we rely on the browser's credentials
  // For Gemini Developer API, the key is in the URL

  let retries = 0;
  const maxRetries = 3;

  while (retries <= maxRetries) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (response.status === 401) {
        throw new Error('Invalid API key or unauthorized access');
      }

      if (response.status === 429) {
        if (retries < maxRetries) {
          const delay = Math.pow(2, retries) * 1000;
          await sleep(delay);
          retries++;
          continue;
        }
        throw new Error('Rate limited. Please try again later.');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      return parseResponse(data);

    } catch (error) {
      if (error.message.includes('Rate limited') || error.message.includes('Invalid API')) {
        throw error;
      }

      if (retries < maxRetries && error.name === 'TypeError') {
        // Network error, retry
        const delay = Math.pow(2, retries) * 1000;
        await sleep(delay);
        retries++;
        continue;
      }

      throw error;
    }
  }
}

/**
 * Parse the Gemini API response
 */
function parseResponse(data) {
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('No response from model');
  }

  const candidate = data.candidates[0];

  if (candidate.finishReason === 'SAFETY') {
    throw new Error('Response blocked by safety filters');
  }

  const content = candidate.content;
  if (!content || !content.parts) {
    // Handle case where content might be empty but we have a finish reason
    return {
      parts: [],
      role: 'model',
      finishReason: candidate.finishReason
    };
  }

  return {
    parts: content.parts,
    role: content.role || 'model',
    finishReason: candidate.finishReason
  };
}

/**
 * Extract function calls from response parts
 */
export function extractFunctionCalls(parts) {
  const functionCalls = [];

  for (const part of parts) {
    // Handle both camelCase and snake_case from API
    const fc = part.functionCall || part.function_call;
    if (fc) {
      functionCalls.push({
        name: fc.name,
        args: fc.args || {}
      });
    }
  }

  return functionCalls;
}

/**
 * Extract text content from response parts
 */
export function extractText(parts) {
  let text = '';

  for (const part of parts) {
    if (part.text) {
      text += part.text;
    }
  }

  return text.trim();
}

/**
 * Check if the model is asking a question or waiting for input
 */
export function isWaitingForInput(parts) {
  const text = extractText(parts);
  const functionCalls = extractFunctionCalls(parts);

  // If there are function calls, model is not waiting for input
  if (functionCalls.length > 0) {
    return false;
  }

  // If there's no text, model is done
  if (!text) {
    return false;
  }

  // Check for question indicators
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
 * Check if a function call requires safety confirmation
 */
export function requiresSafetyConfirmation(functionCall) {
  const args = functionCall.args || {};
  const safetyDecision = args.safety_decision;

  if (safetyDecision && safetyDecision.decision === 'require_confirmation') {
    return {
      required: true,
      explanation: safetyDecision.explanation || 'Action requires confirmation'
    };
  }

  return { required: false };
}

/**
 * Build a function response for the conversation
 * @param {string} name - Function name
 * @param {Object} result - Function result (must include url field)
 * @param {string|null} screenshotBase64 - Screenshot to include in response
 * @param {boolean} safetyAcknowledgement - Whether to include safety acknowledgement
 */
export function buildFunctionResponse(name, result, screenshotBase64 = null, safetyAcknowledgement = false) {
  const response = { url: result.url || '' };

  if (safetyAcknowledgement) {
    response.safety_acknowledgement = 'true';
  }

  const functionResponse = {
    name,
    response
  };

  // Include screenshot in function response parts if provided
  if (screenshotBase64) {
    functionResponse.parts = [
      {
        inlineData: {
          mimeType: 'image/png',
          data: screenshotBase64
        }
      }
    ];
  }

  return {
    functionResponse: functionResponse
  };
}

/**
 * Build a user message with optional screenshot
 */
export function buildUserMessage(text, screenshotBase64 = null) {
  const parts = [];

  if (text) {
    parts.push({ text });
  }

  if (screenshotBase64) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: screenshotBase64
      }
    });
  }

  return {
    role: 'user',
    parts
  };
}

/**
 * Build a model message
 */
export function buildModelMessage(parts) {
  return {
    role: 'model',
    parts
  };
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { sleep };
