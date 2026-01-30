/**
 * Trajectory Export Module
 * 
 * Generates a self-contained HTML report of the agent's trajectory,
 * showing each step with screenshot, thoughts, and actions.
 */

/**
 * Generate HTML report from trajectory data
 * @param {Object} data - Trajectory data
 * @param {string} data.taskTitle - Two-word task title
 * @param {string} data.initialPrompt - Original user prompt
 * @param {string} data.startTime - ISO timestamp when task started
 * @param {string} data.modelName - Model used for the task
 * @param {Array} data.steps - Array of step objects
 * @returns {string} - Complete HTML document as string
 */
export function generateTrajectoryHTML(data) {
  const { taskTitle, initialPrompt, startTime, modelName, steps } = data;

  const formattedDate = new Date(startTime).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const stepsHTML = steps.map((step, index) => `
    <div class="step">
      <div class="step-header">
        <span class="step-number">Step ${index + 1}</span>
        <span class="step-time">${new Date(step.timestamp).toLocaleTimeString()}</span>
      </div>
      
      ${step.screenshot ? `
        <div class="screenshot">
          <img src="data:image/png;base64,${step.screenshot}" alt="Screenshot for step ${index + 1}" />
        </div>
      ` : ''}
      
      ${step.thoughts ? `
        <div class="thoughts">
          <h4>💭 Model Thoughts</h4>
          <p>${escapeHtml(step.thoughts)}</p>
        </div>
      ` : ''}
      
      ${step.text ? `
        <div class="response">
          <h4>💬 Response</h4>
          <p>${escapeHtml(step.text)}</p>
        </div>
      ` : ''}
      
      ${step.actions && step.actions.length > 0 ? `
        <div class="actions">
          <h4>🎯 Actions</h4>
          <ul>
            ${step.actions.map(action => `<li><code>${escapeHtml(action)}</code></li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(taskTitle)} - Gemini Computer Use Trajectory</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      color: #e0e0e0;
      line-height: 1.6;
      padding: 2rem;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    header {
      text-align: center;
      margin-bottom: 3rem;
      padding: 2rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    h1 {
      font-size: 2.5rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
    }
    
    .meta {
      color: #888;
      font-size: 0.9rem;
    }
    
    .prompt {
      margin-top: 1.5rem;
      padding: 1rem;
      background: rgba(102, 126, 234, 0.1);
      border-left: 4px solid #667eea;
      border-radius: 0 8px 8px 0;
    }
    
    .prompt h3 {
      color: #667eea;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.5rem;
    }
    
    .step {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .step:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    
    .step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .step-number {
      font-weight: 600;
      color: #667eea;
      font-size: 1.1rem;
    }
    
    .step-time {
      color: #666;
      font-size: 0.85rem;
    }
    
    .screenshot {
      margin: 1rem 0;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .screenshot img {
      width: 100%;
      height: auto;
      display: block;
    }
    
    .thoughts, .response, .actions {
      margin: 1rem 0;
      padding: 1rem;
      border-radius: 8px;
    }
    
    .thoughts {
      background: rgba(255, 193, 7, 0.1);
      border-left: 3px solid #ffc107;
    }
    
    .response {
      background: rgba(76, 175, 80, 0.1);
      border-left: 3px solid #4caf50;
    }
    
    .actions {
      background: rgba(33, 150, 243, 0.1);
      border-left: 3px solid #2196f3;
    }
    
    h4 {
      font-size: 0.9rem;
      margin-bottom: 0.5rem;
      color: inherit;
    }
    
    .thoughts h4 { color: #ffc107; }
    .response h4 { color: #4caf50; }
    .actions h4 { color: #2196f3; }
    
    ul {
      list-style: none;
      padding: 0;
    }
    
    li {
      padding: 0.25rem 0;
    }
    
    code {
      background: rgba(0, 0, 0, 0.3);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.85rem;
    }
    
    footer {
      text-align: center;
      margin-top: 3rem;
      padding: 1.5rem;
      color: #666;
      font-size: 0.85rem;
    }
    
    @media (max-width: 768px) {
      body {
        padding: 1rem;
      }
      
      h1 {
        font-size: 1.75rem;
      }
      
      .step {
        padding: 1rem;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${escapeHtml(taskTitle)}</h1>
      <p class="meta">${formattedDate}</p>
      ${modelName ? `<p class="meta" style="margin-top: 4px;">Model: <strong>${escapeHtml(modelName)}</strong></p>` : ''}
      <div class="prompt">
        <h3>Original Task</h3>
        <p>${escapeHtml(initialPrompt)}</p>
      </div>
    </header>
    
    <main>
      ${stepsHTML}
    </main>
    
    <footer>
      <p>Generated by Gemini Computer Use Extension</p>
      <p>${steps.length} steps captured</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, char => div[char]);
}

/**
 * Generate filename for the trajectory export
 * @param {string} startTime - ISO timestamp
 * @param {string} taskTitle - Two-word task title
 * @returns {string} - Filename like "2026-01-12_21-56_task-title.html"
 */
export function generateFilename(startTime, taskTitle) {
  const date = new Date(startTime);
  const dateStr = date.toISOString().slice(0, 10); // 2026-01-12
  const timeStr = date.toTimeString().slice(0, 5).replace(':', '-'); // 21-56
  const titleSlug = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `${dateStr}_${timeStr}_${titleSlug}.html`;
}
