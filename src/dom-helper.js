/**
 * DOM Helper Module
 * Provides safe DOM manipulation utilities
 */

/**
 * DOM Selector Cache with automatic cleanup
 */
const selectorCache = new Map();
const CACHE_MAX_SIZE = 50;
const CACHE_MAX_AGE = 5000; // 5 seconds

/**
 * Safe DOM element creation with props and children
 * @param {string} tag - HTML tag name
 * @param {Object} props - Element properties
 * @param {Array<string | Node>} children - Child elements or text
 * @returns {HTMLElement} Created element
 */
const createElement = (tag, props = {}, children = []) => {
  // Validate tag name to prevent XSS
  const validTags = /^[a-z][a-z0-9-]*$/i;
  if (!validTags.test(tag)) {
    console.error(
      `[YouTube+][createElement] Invalid tag name:`,
      new Error(`Tag "${tag}" is not allowed`)
    );
    return document.createElement('div');
  }

  const element = document.createElement(tag);

  Object.entries(props).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.substring(2).toLowerCase(), value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(element.dataset, value);
    } else if (key === 'innerHTML' || key === 'outerHTML') {
      // Prevent direct HTML injection
      console.error(
        '[YouTube+][createElement] Direct HTML injection prevented:',
        new Error('Use children array instead')
      );
    } else {
      try {
        element.setAttribute(key, value);
      } catch (e) {
        console.error(`[YouTube+][createElement] Failed to set attribute ${key}:`, e);
      }
    }
  });

  children.forEach(child => {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      element.appendChild(child);
    }
  });

  return element;
};

/**
 * Cached querySelector with LRU-like eviction
 * @param {string} selector - CSS selector
 * @param {boolean} nocache - Skip cache
 * @returns {HTMLElement|null} Found element
 */
const querySelector = (selector, nocache = false) => {
  if (nocache) return document.querySelector(selector);

  const now = Date.now();
  const cached = selectorCache.get(selector);

  // Check if cached element is still valid
  if (cached?.element?.isConnected && now - cached.timestamp < CACHE_MAX_AGE) {
    return cached.element;
  }

  // Remove stale entry
  if (cached) {
    selectorCache.delete(selector);
  }

  const element = document.querySelector(selector);

  if (element) {
    // LRU eviction: remove oldest entries if cache is full
    if (selectorCache.size >= CACHE_MAX_SIZE) {
      const firstKey = selectorCache.keys().next().value;
      selectorCache.delete(firstKey);
    }

    selectorCache.set(selector, { element, timestamp: now });
  }

  return element;
};

/**
 * Clear selector cache
 */
const clearCache = () => {
  selectorCache.clear();
};

/**
 * Validate selector string
 * @param {string} selector - Selector to validate
 * @returns {boolean} True if valid
 */
const isValidSelector = selector => {
  if (!selector || typeof selector !== 'string') return false;
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
};

/**
 * Validate wait parameters
 * @param {string} selector - Selector to validate
 * @param {HTMLElement} parent - Parent element
 * @returns {Error|null} Error if invalid, null if valid
 */
const validateWaitParameters = (selector, parent) => {
  if (!isValidSelector(selector)) {
    return new Error(`Invalid selector: ${selector}`);
  }
  if (!parent || !(parent instanceof Element)) {
    return new Error('Parent must be a valid DOM element');
  }
  return null;
};

/**
 * Check for existing element
 * @param {HTMLElement} parent - Parent element
 * @param {string} selector - CSS selector
 * @returns {{element: HTMLElement|null, error: Error|null}} Result
 */
const checkForExistingElement = (parent, selector) => {
  try {
    const element = parent.querySelector(selector);
    return { element, error: null };
  } catch {
    return { element: null, error: new Error(`Invalid selector: ${selector}`) };
  }
};

/**
 * Disconnect observer safely
 * @param {MutationObserver} observer - Observer to disconnect
 */
const disconnectObserver = observer => {
  if (!observer) return;
  try {
    observer.disconnect();
  } catch (e) {
    console.error(`[YouTube+][waitForElement] Observer disconnect failed:`, e);
  }
};

/**
 * Create mutation observer for element waiting
 * @param {HTMLElement} parent - Parent element
 * @param {string} selector - CSS selector
 * @param {Function} resolve - Promise resolve function
 * @param {number} timeoutId - Timeout ID
 * @returns {MutationObserver|null} Created observer or null on error
 */
const createWaitObserver = (parent, selector, resolve, timeoutId) => {
  const observer = new MutationObserver(() => {
    try {
      const element = parent.querySelector(selector);
      if (element) {
        clearTimeout(timeoutId);
        disconnectObserver(observer);
        resolve(/** @type {HTMLElement} */ (/** @type {unknown} */ (element)));
      }
    } catch (e) {
      console.error(`[YouTube+][waitForElement] Observer callback error:`, e);
    }
  });

  try {
    observer.observe(parent, { childList: true, subtree: true });
    return observer;
  } catch {
    return null;
  }
};

/**
 * Wait for element with timeout and MutationObserver
 * @param {string} selector - CSS selector
 * @param {number} timeout - Timeout in ms
 * @param {HTMLElement} parent - Parent element to search in
 * @returns {Promise<HTMLElement>} Promise resolving to element
 */
const waitForElement = (selector, timeout = 5000, parent = document.body) => {
  return new Promise((resolve, reject) => {
    const validationError = validateWaitParameters(selector, parent);
    if (validationError) {
      reject(validationError);
      return;
    }

    const { element, error } = checkForExistingElement(parent, selector);
    if (error) {
      reject(error);
      return;
    }
    if (element) {
      resolve(/** @type {HTMLElement} */ (/** @type {unknown} */ (element)));
      return;
    }

    /** @type {MutationObserver | null} */
    let observer = null;

    const timeoutId = setTimeout(() => {
      disconnectObserver(observer);
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);

    observer = createWaitObserver(parent, selector, resolve, timeoutId);
    if (!observer) {
      clearTimeout(timeoutId);
      reject(new Error('Failed to observe DOM'));
    }
  });
};

/**
 * Check if element is visible
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if visible
 */
const isVisible = element => {
  if (!element || !(element instanceof HTMLElement)) return false;
  if (!element.isConnected) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

/**
 * Get element dimensions
 * @param {HTMLElement} element - Element to measure
 * @returns {{width: number, height: number, top: number, left: number}} Dimensions
 */
const getElementDimensions = element => {
  if (!element || !(element instanceof HTMLElement)) {
    return { width: 0, height: 0, top: 0, left: 0 };
  }

  const rect = element.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    top: rect.top,
    left: rect.left,
  };
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.YouTubePlusDOMHelper = {
    createElement,
    querySelector,
    waitForElement,
    clearCache,
    isValidSelector,
    isVisible,
    getElementDimensions,
  };
}
