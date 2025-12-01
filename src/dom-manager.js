/**
 * DOM Manager Module
 * Centralized DOM manipulation, observation, and resource cleanup
 * @module dom-manager
 */

const DOMManager = (() => {
  'use strict';

  /**
   * Error logging helper
   * @param {string} context - Context of the error
   * @param {string} message - Error message
   * @param {Error} error - Error object
   */
  const logError = (context, message, error) => {
    console.error(`[YouTube+][DOMManager][${context}] ${message}:`, error);
  };

  // ============================================================================
  // DOM Element Creation
  // ============================================================================

  /**
   * Set className attribute on element
   * @param {HTMLElement} element - Target element
   * @param {string} value - Class name
   */
  const setClassName = (element, value) => {
    element.className = value;
  };

  /**
   * Set dataset attributes on element
   * @param {HTMLElement} element - Target element
   * @param {Object} dataObj - Dataset object
   */
  const setDataset = (element, dataObj) => {
    // Use for..in to avoid allocating intermediate arrays from Object.entries
    if (!dataObj || typeof dataObj !== 'object') return;
    for (const k in dataObj) {
      if (Object.prototype.hasOwnProperty.call(dataObj, k)) {
        element.dataset[k] = dataObj[k];
      }
    }
  };

  /**
   * Set style attributes on element
   * @param {HTMLElement} element - Target element
   * @param {Object} styleObj - Style object
   */
  const setStyles = (element, styleObj) => {
    if (!styleObj || typeof styleObj !== 'object') return;
    // for..in reduces temporary allocations compared to Object.entries for hot paths
    for (const key in styleObj) {
      if (Object.prototype.hasOwnProperty.call(styleObj, key)) {
        try {
          element.style[key] = styleObj[key];
        } catch {
          // ignore individual style assignment errors to avoid breaking callers
        }
      }
    }
  };

  /**
   * Attach event listener from attribute
   * @param {HTMLElement} element - Target element
   * @param {string} key - Attribute key (e.g., 'onClick')
   * @param {Function} handler - Event handler function
   */
  const attachEventListener = (element, key, handler) => {
    const eventName = key.slice(2).toLowerCase();
    element.addEventListener(eventName, handler);
  };

  /**
   * Set regular attribute on element
   * @param {HTMLElement} element - Target element
   * @param {string} key - Attribute key
   * @param {*} value - Attribute value
   */
  const setAttribute = (element, key, value) => {
    try {
      element.setAttribute(key, value);
    } catch (e) {
      logError('setAttribute', `Failed to set attribute ${key}`, e);
    }
  };

  /**
   * Apply single attribute to element
   * @param {HTMLElement} element - Target element
   * @param {string} key - Attribute key
   * @param {*} value - Attribute value
   */
  /**
   * Attribute handler map for efficient dispatch
   * @type {Object<string, Function>}
   */
  const attributeHandlers = {
    className: (element, value) => setClassName(element, value),
    dataset: (element, value) => setDataset(element, value),
  };

  /**
   * Check if attribute is an event handler
   * @param {string} key - Attribute key
   * @param {*} value - Attribute value
   * @returns {boolean} True if event handler
   */
  const isEventHandler = (key, value) => key.startsWith('on') && typeof value === 'function';

  /**
   * Check if attribute is style object
   * @param {string} key - Attribute key
   * @param {*} value - Attribute value
   * @returns {boolean} True if style object
   */
  const isStyleObject = (key, value) => key === 'style' && typeof value === 'object';

  /**
   * Apply single attribute to element
   * @param {HTMLElement} element - Target element
   * @param {string} key - Attribute key
   * @param {*} value - Attribute value
   */
  const applyAttribute = (element, key, value) => {
    // Use handler map for known attributes
    if (attributeHandlers[key]) {
      attributeHandlers[key](element, value);
      return;
    }

    // Handle style objects
    if (isStyleObject(key, value)) {
      setStyles(element, value);
      return;
    }

    // Handle event listeners
    if (isEventHandler(key, value)) {
      attachEventListener(element, key, value);
      return;
    }

    // Default: set as attribute
    setAttribute(element, key, value);
  };

  /**
   * Apply all attributes to element
   * @param {HTMLElement} element - Target element
   * @param {Object} attrs - Attributes object
   */
  const applyAttributes = (element, attrs) => {
    if (!attrs || typeof attrs !== 'object') return;
    for (const key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        applyAttribute(element, key, attrs[key]);
      }
    }
  };

  /**
   * Append child node to element
   * @param {HTMLElement} element - Parent element
   * @param {string|Node} child - Child to append
   */
  const appendChild = (element, child) => {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      element.appendChild(child);
    }
  };

  /**
   * Append all children to element
   * @param {HTMLElement} element - Parent element
   * @param {Array} children - Array of children
   */
  const appendChildren = (element, children) => {
    children.forEach(child => appendChild(element, child));
  };

  /**
   * Create DOM element with attributes and children
   * @param {string} tag - Element tag name
   * @param {Object} attrs - Element attributes
   * @param {Array} children - Child elements or text nodes
   * @returns {HTMLElement} Created element
   */
  const createElement = (tag, attrs = {}, children = []) => {
    if (!tag || typeof tag !== 'string') {
      logError('createElement', 'Invalid tag', new Error('Tag must be a non-empty string'));
      return document.createElement('div');
    }

    const element = document.createElement(tag);
    applyAttributes(element, attrs);
    appendChildren(element, children);
    return element;
  };

  // ============================================================================
  // Selector Cache
  // ============================================================================

  const selectorCache = new Map();
  const CACHE_MAX_SIZE = 50;
  const CACHE_MAX_AGE = 5000; // 5 seconds

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

    if (cached?.element?.isConnected && now - cached.timestamp < CACHE_MAX_AGE) {
      return cached.element;
    }

    if (cached) {
      selectorCache.delete(selector);
    }

    const element = document.querySelector(selector);

    if (element) {
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
  const clearCache = () => selectorCache.clear();

  // ============================================================================
  // Wait for Element
  // ============================================================================

  /**
   * Validate selector and parent for waitForElement
   * @param {string} selector - CSS selector
   * @param {HTMLElement} parent - Parent element
   * @returns {Error|null} Validation error or null
   */
  const validateWaitParams = (selector, parent) => {
    if (!selector || typeof selector !== 'string') {
      return new Error('Selector must be a non-empty string');
    }
    if (!parent || !(parent instanceof Element)) {
      return new Error('Parent must be a valid DOM element');
    }
    return null;
  };

  /**
   * Check if element already exists in DOM
   * @param {HTMLElement} parent - Parent element
   * @param {string} selector - CSS selector
   * @returns {{element: HTMLElement|null, error: Error|null}} Result object
   */
  const checkExistingElement = (parent, selector) => {
    try {
      const element = parent.querySelector(selector);
      return { element, error: null };
    } catch {
      return { element: null, error: new Error(`Invalid selector: ${selector}`) };
    }
  };

  /**
   * Cleanup observer and timeout
   * @param {MutationObserver|null} observer - Observer to disconnect
   * @param {number} timeoutId - Timeout ID to clear
   */
  const cleanupWaitResources = (observer, timeoutId) => {
    if (observer) {
      try {
        observer.disconnect();
      } catch (e) {
        logError('waitForElement', 'Observer disconnect failed', e);
      }
    }
    clearTimeout(timeoutId);
  };

  /**
   * Create mutation observer for element watching
   * @param {HTMLElement} parent - Parent element
   * @param {string} selector - CSS selector
   * @param {Function} resolve - Promise resolve function
   * @param {number} timeoutId - Timeout ID for cleanup
   * @returns {MutationObserver|null} Created observer
   */
  const createElementObserver = (parent, selector, resolve, timeoutId) => {
    const observer = new MutationObserver(() => {
      try {
        const element = parent.querySelector(selector);
        if (element) {
          cleanupWaitResources(observer, timeoutId);
          resolve(/** @type {HTMLElement} */ (element));
        }
      } catch (e) {
        logError('waitForElement', 'Observer callback error', e);
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
   * Wait for element with timeout and observer
   * @param {string} selector - CSS selector
   * @param {number} timeout - Timeout in ms
   * @param {HTMLElement} parent - Parent element to search in
   * @returns {Promise<HTMLElement>} Promise resolving to element
   */
  const waitForElement = (selector, timeout = 5000, parent = document.body) => {
    return new Promise((resolve, reject) => {
      const validationError = validateWaitParams(selector, parent);
      if (validationError) {
        reject(validationError);
        return;
      }

      const { element, error } = checkExistingElement(parent, selector);
      if (error) {
        reject(error);
        return;
      }
      if (element) {
        resolve(/** @type {HTMLElement} */ (element));
        return;
      }

      let observer = null;
      const timeoutId = setTimeout(() => {
        cleanupWaitResources(observer, timeoutId);
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);

      observer = createElementObserver(parent, selector, resolve, timeoutId);
      if (!observer) {
        clearTimeout(timeoutId);
        reject(new Error('Failed to observe DOM'));
      }
    });
  };

  // ============================================================================
  // Resource Cleanup Manager
  // ============================================================================

  /**
   * Cleanup all registered functions
   * @param {Set} functions - Set of cleanup functions
   */
  const cleanupFunctions = functions => {
    functions.forEach(fn => {
      try {
        fn();
      } catch (e) {
        logError('Cleanup', 'Cleanup function failed', e);
      }
    });
    functions.clear();
  };

  /**
   * Cleanup all observers
   * @param {Set} observers - Set of observers
   */
  const cleanupObservers = observers => {
    observers.forEach(obs => {
      try {
        obs.disconnect();
      } catch (e) {
        logError('Cleanup', 'Observer disconnect failed', e);
      }
    });
    observers.clear();
  };

  /**
   * Cleanup all event listeners
   * @param {Map} listeners - Map of listeners
   */
  const cleanupListeners = listeners => {
    listeners.forEach(({ element, event, handler, options }) => {
      try {
        element.removeEventListener(event, handler, options);
      } catch (e) {
        logError('Cleanup', 'Listener removal failed', e);
      }
    });
    listeners.clear();
  };

  /**
   * Cleanup all intervals
   * @param {Set} intervals - Set of interval IDs
   */
  const cleanupIntervals = intervals => {
    intervals.forEach(id => clearInterval(id));
    intervals.clear();
  };

  /**
   * Cleanup all timeouts
   * @param {Set} timeouts - Set of timeout IDs
   */
  const cleanupTimeouts = timeouts => {
    timeouts.forEach(id => clearTimeout(id));
    timeouts.clear();
  };

  /**
   * Cleanup all animation frames
   * @param {Set} frames - Set of animation frame IDs
   */
  const cleanupAnimationFrames = frames => {
    frames.forEach(id => cancelAnimationFrame(id));
    frames.clear();
  };

  const cleanupManager = {
    observers: new Set(),
    listeners: new Map(),
    intervals: new Set(),
    timeouts: new Set(),
    animationFrames: new Set(),
    cleanupFunctions: new Set(),

    register: fn => {
      if (typeof fn === 'function') {
        cleanupManager.cleanupFunctions.add(fn);
      }
      return fn;
    },

    unregister: fn => {
      cleanupManager.cleanupFunctions.delete(fn);
    },

    registerObserver: observer => {
      cleanupManager.observers.add(observer);
      return observer;
    },

    unregisterObserver: observer => {
      if (observer) {
        try {
          observer.disconnect();
        } catch (e) {
          logError('Cleanup', 'Observer disconnect failed', e);
        }
        cleanupManager.observers.delete(observer);
      }
    },

    registerListener: (element, event, handler, options) => {
      const key = Symbol('listener');
      cleanupManager.listeners.set(key, { element, event, handler, options });
      try {
        element.addEventListener(event, handler, options);
      } catch (e) {
        logError('registerListener', 'Failed to add listener', e);
      }
      return key;
    },

    unregisterListener: key => {
      const listener = cleanupManager.listeners.get(key);
      if (listener) {
        const { element, event, handler, options } = listener;
        try {
          element.removeEventListener(event, handler, options);
        } catch (e) {
          logError('Cleanup', 'Listener removal failed', e);
        }
        cleanupManager.listeners.delete(key);
      }
    },

    registerInterval: id => {
      cleanupManager.intervals.add(id);
      return id;
    },

    unregisterInterval: id => {
      clearInterval(id);
      cleanupManager.intervals.delete(id);
    },

    registerTimeout: id => {
      cleanupManager.timeouts.add(id);
      return id;
    },

    unregisterTimeout: id => {
      clearTimeout(id);
      cleanupManager.timeouts.delete(id);
    },

    registerAnimationFrame: id => {
      cleanupManager.animationFrames.add(id);
      return id;
    },

    unregisterAnimationFrame: id => {
      cancelAnimationFrame(id);
      cleanupManager.animationFrames.delete(id);
    },

    cleanup: () => {
      cleanupFunctions(cleanupManager.cleanupFunctions);
      cleanupObservers(cleanupManager.observers);
      cleanupListeners(cleanupManager.listeners);
      cleanupIntervals(cleanupManager.intervals);
      cleanupTimeouts(cleanupManager.timeouts);
      cleanupAnimationFrames(cleanupManager.animationFrames);
    },
  };

  // ============================================================================
  // Public API
  // ============================================================================

  return {
    createElement,
    querySelector,
    clearCache,
    waitForElement,
    cleanupManager,
  };
})();

// Export globally
if (typeof window !== 'undefined') {
  window.YouTubePlusDOMManager = DOMManager;
}
