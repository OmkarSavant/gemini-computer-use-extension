/**
 * Content script for Gemini Computer Use extension
 *
 * This script runs in the context of web pages and executes
 * actions received from the background service worker.
 */

// Coordinate conversion utilities (inline to avoid module issues in content scripts)
const NORMALIZED_MAX = 1000;

function denormalizeX(normalizedX) {
  return Math.round((normalizedX / NORMALIZED_MAX) * window.innerWidth);
}

function denormalizeY(normalizedY) {
  return Math.round((normalizedY / NORMALIZED_MAX) * window.innerHeight);
}

// Click indicator for debug mode
let highlightEnabled = false;

function showClickIndicator(x, y) {
  if (!highlightEnabled) return;

  // Remove any existing indicator
  const existing = document.getElementById('gemini-click-indicator');
  if (existing) existing.remove();

  // Add styles if not present
  if (!document.getElementById('gemini-indicator-styles')) {
    const style = document.createElement('style');
    style.id = 'gemini-indicator-styles';
    style.textContent = `
      @keyframes gemini-pulse {
        0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
      }
      #gemini-click-indicator {
        position: fixed;
        width: 30px;
        height: 30px;
        border: 3px solid #ff4444;
        border-radius: 50%;
        pointer-events: none;
        z-index: 2147483647;
        animation: gemini-pulse 0.5s ease-out forwards;
        transform: translate(-50%, -50%);
      }
    `;
    document.head.appendChild(style);
  }

  const indicator = document.createElement('div');
  indicator.id = 'gemini-click-indicator';
  indicator.style.left = `${x}px`;
  indicator.style.top = `${y}px`;
  document.body.appendChild(indicator);

  setTimeout(() => indicator.remove(), 500);
}

// Action handlers
const actionHandlers = {
  click_at(args) {
    const x = denormalizeX(args.x);
    const y = denormalizeY(args.y);

    showClickIndicator(x, y);

    const element = document.elementFromPoint(x, y);
    if (!element) {
      return { success: false, error: 'No element at coordinates', url: window.location.href };
    }

    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + window.screenX,
      screenY: y + window.screenY,
      button: 0,
      buttons: 1
    };

    element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    element.dispatchEvent(new MouseEvent('click', eventOptions));

    // Focus if it's an input element
    if (element.focus && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable)) {
      element.focus();
    }

    return {
      success: true,
      element: element.tagName,
      url: window.location.href
    };
  },

  type_text_at(args) {
    const x = denormalizeX(args.x);
    const y = denormalizeY(args.y);
    const text = args.text || '';
    const pressEnter = args.press_enter || false;
    const clearBefore = args.clear_before_typing || false;

    showClickIndicator(x, y);

    const element = document.elementFromPoint(x, y);
    if (!element) {
      return { success: false, error: 'No element at coordinates', url: window.location.href };
    }

    // Click to focus
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y
    }));

    if (element.focus) {
      element.focus();
    }

    // Clear existing content if requested
    if (clearBefore) {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        element.select();
        document.execCommand('delete');
      } else if (element.isContentEditable) {
        element.innerHTML = '';
      }
    }

    // Type the text
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      // For input elements, we can set value directly and dispatch input event
      const start = element.selectionStart || 0;
      const end = element.selectionEnd || 0;
      const currentValue = element.value || '';
      element.value = currentValue.substring(0, start) + text + currentValue.substring(end);
      element.selectionStart = element.selectionEnd = start + text.length;

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (element.isContentEditable) {
      // For contenteditable, insert text
      document.execCommand('insertText', false, text);
    } else {
      // Try to find the nearest input
      const nearestInput = element.querySelector('input, textarea') ||
                          element.closest('input, textarea');
      if (nearestInput) {
        nearestInput.focus();
        nearestInput.value = (nearestInput.value || '') + text;
        nearestInput.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        return { success: false, error: 'No typeable element at coordinates', url: window.location.href };
      }
    }

    // Press Enter if requested
    if (pressEnter) {
      const enterEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13
      });
      element.dispatchEvent(enterEvent);

      // Also submit the form if in a form
      const form = element.closest('form');
      if (form) {
        // Try to find and click a submit button
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
        if (submitBtn) {
          submitBtn.click();
        } else {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }
    }

    return {
      success: true,
      element: element.tagName,
      textTyped: text.length,
      url: window.location.href
    };
  },

  scroll_document(args) {
    const direction = (args.direction || 'down').toLowerCase();

    // In content script context, we use scrollBy directly
    // (Playwright uses PageUp/PageDown keys which trigger native scroll,
    // but dispatched KeyboardEvents don't trigger native scroll behavior)
    // Horizontal scroll amount matches original: screen_width / 2
    const verticalAmount = window.innerHeight * 0.8;
    const horizontalAmount = window.innerWidth / 2;

    if (direction === 'down') {
      window.scrollBy({ top: verticalAmount, behavior: 'smooth' });
    } else if (direction === 'up') {
      window.scrollBy({ top: -verticalAmount, behavior: 'smooth' });
    } else if (direction === 'left') {
      window.scrollBy({ left: -horizontalAmount, behavior: 'smooth' });
    } else if (direction === 'right') {
      window.scrollBy({ left: horizontalAmount, behavior: 'smooth' });
    }

    return {
      success: true,
      direction,
      url: window.location.href
    };
  },

  scroll_at(args) {
    const x = denormalizeX(args.x);
    const y = denormalizeY(args.y);
    const direction = (args.direction || 'down').toLowerCase();
    // magnitude is in normalized coordinates (0-1000), default 800
    // Must be denormalized based on scroll direction
    let magnitude = args.magnitude || 800;
    if (direction === 'up' || direction === 'down') {
      magnitude = denormalizeY(magnitude);
    } else {
      magnitude = denormalizeX(magnitude);
    }

    showClickIndicator(x, y);

    // Find the scrollable element at the coordinates
    let element = document.elementFromPoint(x, y);
    if (!element) {
      return { success: false, error: 'No element at coordinates', url: window.location.href };
    }

    // Find the nearest scrollable parent
    let scrollable = element;
    while (scrollable && scrollable !== document.body) {
      const style = window.getComputedStyle(scrollable);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;

      if (overflowY === 'auto' || overflowY === 'scroll' ||
          overflowX === 'auto' || overflowX === 'scroll') {
        break;
      }
      scrollable = scrollable.parentElement;
    }

    if (!scrollable) {
      scrollable = document.documentElement;
    }

    let deltaX = 0;
    let deltaY = 0;

    switch (direction) {
      case 'up':
        deltaY = -magnitude;
        break;
      case 'down':
        deltaY = magnitude;
        break;
      case 'left':
        deltaX = -magnitude;
        break;
      case 'right':
        deltaX = magnitude;
        break;
    }

    scrollable.scrollBy({ left: deltaX, top: deltaY, behavior: 'smooth' });

    return {
      success: true,
      scrolledBy: { x: deltaX, y: deltaY },
      element: scrollable.tagName,
      url: window.location.href
    };
  },

  navigate(args) {
    let url = args.url;
    if (!url) {
      return { success: false, error: 'No URL provided', url: window.location.href };
    }

    // Normalize URL by prepending https:// if no protocol specified
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    window.location.href = url;

    return {
      success: true,
      navigatedTo: url,
      url: url
    };
  },

  go_back() {
    history.back();
    return {
      success: true,
      action: 'back',
      url: window.location.href
    };
  },

  go_forward() {
    history.forward();
    return {
      success: true,
      action: 'forward',
      url: window.location.href
    };
  },

  hover_at(args) {
    const x = denormalizeX(args.x);
    const y = denormalizeY(args.y);

    showClickIndicator(x, y);

    const element = document.elementFromPoint(x, y);
    if (!element) {
      return { success: false, error: 'No element at coordinates', url: window.location.href };
    }

    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y
    };

    element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseenter', eventOptions));
    element.dispatchEvent(new MouseEvent('mousemove', eventOptions));

    return {
      success: true,
      element: element.tagName,
      url: window.location.href
    };
  },

  key_combination(args) {
    const keys = args.keys || '';
    const parts = keys.split('+').map(k => k.trim());

    // Key mapping similar to Playwright's PLAYWRIGHT_KEY_MAP
    const KEY_MAP = {
      'backspace': 'Backspace',
      'tab': 'Tab',
      'return': 'Enter',
      'enter': 'Enter',
      'shift': 'Shift',
      'control': 'Control',
      'ctrl': 'Control',
      'alt': 'Alt',
      'escape': 'Escape',
      'esc': 'Escape',
      'space': ' ',
      'pageup': 'PageUp',
      'pagedown': 'PageDown',
      'end': 'End',
      'home': 'Home',
      'left': 'ArrowLeft',
      'up': 'ArrowUp',
      'right': 'ArrowRight',
      'down': 'ArrowDown',
      'insert': 'Insert',
      'delete': 'Delete',
      'command': 'Meta',
      'cmd': 'Meta',
      'meta': 'Meta'
    };

    // Map keys to their proper names
    const mappedKeys = parts.map(k => {
      const lower = k.toLowerCase();
      return KEY_MAP[lower] || k;
    });

    // Determine modifiers from the key list
    const modifiers = {
      ctrlKey: mappedKeys.some(k => k === 'Control'),
      altKey: mappedKeys.some(k => k === 'Alt'),
      shiftKey: mappedKeys.some(k => k === 'Shift'),
      metaKey: mappedKeys.some(k => k === 'Meta')
    };

    const activeElement = document.activeElement || document.body;

    // Press down all modifier keys, then press the main key, then release in reverse
    // This matches Playwright's behavior
    const modifierKeys = mappedKeys.filter(k => ['Control', 'Alt', 'Shift', 'Meta'].includes(k));
    const mainKey = mappedKeys.find(k => !['Control', 'Alt', 'Shift', 'Meta'].includes(k)) || '';

    // Key down for modifiers
    for (const mod of modifierKeys) {
      activeElement.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: mod,
        code: mod === 'Control' ? 'ControlLeft' : mod === 'Alt' ? 'AltLeft' : mod === 'Shift' ? 'ShiftLeft' : 'MetaLeft',
        ...modifiers
      }));
    }

    // Press the main key if there is one
    if (mainKey) {
      const code = mainKey.length === 1
        ? `Key${mainKey.toUpperCase()}`
        : mainKey;

      activeElement.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: mainKey,
        code: code,
        ...modifiers
      }));
      activeElement.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: mainKey,
        code: code,
        ...modifiers
      }));
    }

    // Key up for modifiers in reverse order
    for (const mod of modifierKeys.reverse()) {
      activeElement.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: mod,
        code: mod === 'Control' ? 'ControlLeft' : mod === 'Alt' ? 'AltLeft' : mod === 'Shift' ? 'ShiftLeft' : 'MetaLeft',
        ...modifiers
      }));
    }

    return {
      success: true,
      keys: keys,
      url: window.location.href
    };
  },

  drag_and_drop(args) {
    const startX = denormalizeX(args.x);
    const startY = denormalizeY(args.y);
    const endX = denormalizeX(args.destination_x);
    const endY = denormalizeY(args.destination_y);

    showClickIndicator(startX, startY);

    const startElement = document.elementFromPoint(startX, startY);
    const endElement = document.elementFromPoint(endX, endY);

    if (!startElement) {
      return { success: false, error: 'No element at start coordinates', url: window.location.href };
    }

    // Simulate drag events
    const dragStartOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: startX,
      clientY: startY
    };

    const dragEndOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: endX,
      clientY: endY
    };

    // Mouse-based drag simulation
    startElement.dispatchEvent(new MouseEvent('mousedown', dragStartOptions));

    // Simulate mouse move
    for (let i = 0; i <= 10; i++) {
      const progress = i / 10;
      const currentX = startX + (endX - startX) * progress;
      const currentY = startY + (endY - startY) * progress;

      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: currentX,
        clientY: currentY
      }));
    }

    (endElement || startElement).dispatchEvent(new MouseEvent('mouseup', dragEndOptions));

    setTimeout(() => showClickIndicator(endX, endY), 100);

    return {
      success: true,
      from: { x: startX, y: startY },
      to: { x: endX, y: endY },
      url: window.location.href
    };
  },

  wait_5_seconds() {
    // The actual waiting is handled by the service worker
    // This just acknowledges the action
    return {
      success: true,
      waited: 5000,
      url: window.location.href
    };
  },

  search() {
    window.location.href = 'https://www.google.com';
    return {
      success: true,
      navigatedTo: 'https://www.google.com',
      url: 'https://www.google.com'
    };
  },

  open_web_browser() {
    // Already in a browser, no-op
    return {
      success: true,
      message: 'Already in browser',
      url: window.location.href
    };
  }
};

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXECUTE_ACTION') {
    const { action, args } = message;

    // Update highlight setting
    if (message.highlightMouse !== undefined) {
      highlightEnabled = message.highlightMouse;
    }

    const handler = actionHandlers[action];
    if (!handler) {
      sendResponse({ success: false, error: `Unknown action: ${action}` });
      return true;
    }

    try {
      const result = handler(args);
      sendResponse(result);
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }

    return true;
  }

  if (message.type === 'GET_VIEWPORT_INFO') {
    sendResponse({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      url: window.location.href,
      title: document.title
    });
    return true;
  }

  if (message.type === 'SET_HIGHLIGHT') {
    highlightEnabled = message.enabled;
    sendResponse({ success: true });
    return true;
  }
});

// Log that content script is loaded
console.log('[Gemini Computer Use] Content script loaded');
