/**
 * Action definitions and utilities for Computer Use
 *
 * This module defines the available actions and provides utilities
 * for formatting action displays.
 */

/**
 * Map of action names to their display-friendly descriptions
 */
export const ACTION_DESCRIPTIONS = {
  click_at: 'Click at position',
  type_text_at: 'Type text at position',
  scroll_document: 'Scroll document',
  scroll_at: 'Scroll at position',
  navigate: 'Navigate to URL',
  go_back: 'Go back',
  go_forward: 'Go forward',
  hover_at: 'Hover at position',
  key_combination: 'Press key combination',
  drag_and_drop: 'Drag and drop',
  wait_5_seconds: 'Wait 5 seconds',
  search: 'Open search',
  open_web_browser: 'Open browser'
};

/**
 * Format a function call for display in the UI
 * @param {Object} functionCall - The function call object
 * @returns {string} Formatted string representation
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
      return `drag_and_drop(${args.x}, ${args.y}, ${args.dest_x}, ${args.dest_y})`;

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

/**
 * Parse scroll direction to delta values
 * @param {string} direction - Direction string (up, down, left, right)
 * @param {number} magnitude - Optional magnitude multiplier (default: 1)
 * @returns {{deltaX: number, deltaY: number}} Scroll delta values
 */
export function parseScrollDirection(direction, magnitude = 1) {
  const baseAmount = 300 * magnitude;

  switch (direction.toLowerCase()) {
    case 'up':
      return { deltaX: 0, deltaY: -baseAmount };
    case 'down':
      return { deltaX: 0, deltaY: baseAmount };
    case 'left':
      return { deltaX: -baseAmount, deltaY: 0 };
    case 'right':
      return { deltaX: baseAmount, deltaY: 0 };
    default:
      return { deltaX: 0, deltaY: 0 };
  }
}

/**
 * Parse key combination string into modifier flags and key
 * @param {string} keys - Key combination string (e.g., "Control+C", "Alt+Tab")
 * @returns {{key: string, modifiers: Object}} Parsed key info
 */
export function parseKeyCombination(keys) {
  const parts = keys.split('+').map(k => k.trim());
  const modifiers = {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false
  };

  let mainKey = '';

  for (const part of parts) {
    const lowerPart = part.toLowerCase();
    switch (lowerPart) {
      case 'control':
      case 'ctrl':
        modifiers.ctrlKey = true;
        break;
      case 'alt':
        modifiers.altKey = true;
        break;
      case 'shift':
        modifiers.shiftKey = true;
        break;
      case 'meta':
      case 'command':
      case 'cmd':
        modifiers.metaKey = true;
        break;
      default:
        mainKey = part;
    }
  }

  return { key: mainKey, modifiers };
}

/**
 * Get the key code for common keys
 * @param {string} key - Key name
 * @returns {number} Key code
 */
export function getKeyCode(key) {
  const keyCodes = {
    'Enter': 13,
    'Tab': 9,
    'Escape': 27,
    'Backspace': 8,
    'Delete': 46,
    'ArrowUp': 38,
    'ArrowDown': 40,
    'ArrowLeft': 37,
    'ArrowRight': 39,
    'Home': 36,
    'End': 35,
    'PageUp': 33,
    'PageDown': 34,
    'Space': 32,
    ' ': 32
  };

  // Check for special keys
  if (keyCodes[key]) {
    return keyCodes[key];
  }

  // For single characters, use char code
  if (key.length === 1) {
    return key.toUpperCase().charCodeAt(0);
  }

  return 0;
}

/**
 * Create event options for mouse events
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} options - Additional options
 * @returns {Object} MouseEvent init options
 */
export function createMouseEventOptions(x, y, options = {}) {
  return {
    bubbles: true,
    cancelable: true,
    view: typeof window !== 'undefined' ? window : null,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: options.button || 0,
    buttons: options.buttons || 1,
    ...options
  };
}

/**
 * Create event options for keyboard events
 * @param {string} key - Key name
 * @param {Object} modifiers - Modifier keys
 * @returns {Object} KeyboardEvent init options
 */
export function createKeyboardEventOptions(key, modifiers = {}) {
  return {
    bubbles: true,
    cancelable: true,
    key: key,
    code: `Key${key.toUpperCase()}`,
    keyCode: getKeyCode(key),
    which: getKeyCode(key),
    ...modifiers
  };
}
