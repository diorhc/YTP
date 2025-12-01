/**
 * DOM Utility Module
 * Shared utilities for DOM manipulation, element creation, and selection
 */

window.YouTubePlusDOMUtils = (() => {
  'use strict';

  /**
   * Error logging utility
   * @param {string} module - Module name
   * @param {string} message - Error message
   * @param {Error} error - Error object
   */
  const logError = (module, message, error) => {
    console.error(`[YouTube+][${module}] ${message}:`, error);
  };

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
      logError('createElement', 'Invalid tag name', new Error(`Tag "${tag}" is not allowed`));
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
        logError(
          'createElement',
          'Direct HTML injection prevented',
          new Error('Use children array instead')
        );
      } else {
        try {
          element.setAttribute(key, value);
        } catch (e) {
          logError('createElement', `Failed to set attribute ${key}`, e);
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
   * Create button element with common properties
   * @param {Object} options - Button options
   * @returns {HTMLButtonElement}
   */
  const createButton = ({ text, className, onClick, title, ariaLabel, disabled = false }) => {
    const button = createElement('button', {
      className: className || '',
      title: title || text,
      'aria-label': ariaLabel || text,
      disabled,
      onClick,
    });

    if (text) {
      button.textContent = text;
    }

    return button;
  };

  /**
   * Create icon element
   * @param {string} iconClass - Icon CSS class
   * @param {string} title - Title attribute
   * @returns {HTMLElement}
   */
  const createIcon = (iconClass, title = '') => {
    return createElement('span', {
      className: `ytp-icon ${iconClass}`,
      'aria-hidden': 'true',
      title,
    });
  };

  /**
   * DOM Selector Cache with automatic cleanup
   * Optimized for performance with WeakRef and lazy cleanup
   */
  const selectorCache = new Map();
  const CACHE_MAX_SIZE = 100; // Increased cache size
  const CACHE_MAX_AGE = 10000; // 10 seconds for better hit rate
  let cacheHits = 0;
  let cacheMisses = 0;

  /**
   * Cached querySelector with LRU-like eviction and WeakRef support
   * @param {string} selector - CSS selector
   * @param {boolean} nocache - Skip cache
   * @param {Document|HTMLElement} parent - Parent element to search in
   * @returns {HTMLElement|null} Found element
   */
  const querySelector = (selector, nocache = false, parent = document) => {
    if (nocache) return parent.querySelector(selector);

    const cacheKey = `${selector}:${parent === document ? 'doc' : parent.id || 'custom'}`;
    const now = Date.now();
    const cached = selectorCache.get(cacheKey);

    // Check if cached element is still valid
    if (cached?.element?.isConnected && now - cached.timestamp < CACHE_MAX_AGE) {
      cacheHits++;
      return cached.element;
    }

    // Remove stale entry
    if (cached) {
      selectorCache.delete(cacheKey);
    }

    const element = parent.querySelector(selector);
    cacheMisses++;

    if (element) {
      // LRU eviction: remove oldest entries if cache is full
      if (selectorCache.size >= CACHE_MAX_SIZE) {
        const firstKey = selectorCache.keys().next().value;
        selectorCache.delete(firstKey);
      }

      selectorCache.set(cacheKey, { element, timestamp: now });
    }

    return element;
  };

  /**
   * Batch querySelector for multiple selectors (more efficient)
   * @param {string[]} selectors - Array of CSS selectors
   * @param {Document|HTMLElement} parent - Parent element
   * @returns {Object} Map of selector to element
   */
  const querySelectorBatch = (selectors, parent = document) => {
    const results = {};
    for (const selector of selectors) {
      results[selector] = querySelector(selector, false, parent);
    }
    return results;
  };

  /**
   * Clear selector cache
   */
  const clearSelectorCache = () => {
    selectorCache.clear();
    cacheHits = 0;
    cacheMisses = 0;
  };

  /**
   * Get cache statistics for debugging
   * @returns {Object} Cache stats
   */
  const getCacheStats = () => {
    const total = cacheHits + cacheMisses;
    return {
      size: selectorCache.size,
      hits: cacheHits,
      misses: cacheMisses,
      hitRate: total > 0 ? `${((cacheHits / total) * 100).toFixed(2)}%` : 'N/A',
    };
  };

  /**
   * Wait for element with timeout and AbortController
   * @param {string} selector - CSS selector
   * @param {number} timeout - Timeout in ms
   * @param {HTMLElement} parent - Parent element to search in
   * @returns {Promise<HTMLElement>} Promise resolving to element
   */
  const waitForElement = (selector, timeout = 5000, parent = document.body) => {
    return new Promise((resolve, reject) => {
      // Validate inputs
      if (!selector || typeof selector !== 'string') {
        reject(new Error('Selector must be a non-empty string'));
        return;
      }

      if (!parent || !(parent instanceof Element)) {
        reject(new Error('Parent must be a valid DOM element'));
        return;
      }

      // Check if element already exists
      try {
        const element = parent.querySelector(selector);
        if (element) {
          resolve(/** @type {HTMLElement} */ (element));
          return;
        }
      } catch {
        reject(new Error(`Invalid selector: ${selector}`));
        return;
      }

      const controller = new AbortController();
      let observer = null;

      const timeoutId = setTimeout(() => {
        controller.abort();
        if (observer) observer.disconnect();
        reject(new Error(`Timeout waiting for element: ${selector}`));
      }, timeout);

      observer = new MutationObserver(() => {
        try {
          const element = parent.querySelector(selector);
          if (element) {
            clearTimeout(timeoutId);
            observer.disconnect();
            resolve(/** @type {HTMLElement} */ (element));
          }
        } catch (e) {
          clearTimeout(timeoutId);
          observer.disconnect();
          reject(e);
        }
      });

      observer.observe(parent, {
        childList: true,
        subtree: true,
      });
    });
  };

  /**
   * Check if element is visible in viewport
   * @param {HTMLElement} element - Element to check
   * @returns {boolean}
   */
  const isElementVisible = element => {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  };

  /**
   * Get element offset from document top
   * @param {HTMLElement} element - Element
   * @returns {Object} Offset coordinates
   */
  const getElementOffset = element => {
    if (!element) return { top: 0, left: 0 };

    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    return {
      top: rect.top + scrollTop,
      left: rect.left + scrollLeft,
    };
  };

  /**
   * Insert element after reference element
   * @param {HTMLElement} newElement - Element to insert
   * @param {HTMLElement} referenceElement - Reference element
   */
  const insertAfter = (newElement, referenceElement) => {
    if (!newElement || !referenceElement) return;
    referenceElement.parentNode?.insertBefore(newElement, referenceElement.nextSibling);
  };

  /**
   * Remove all children from element
   * @param {HTMLElement} element - Parent element
   */
  const removeAllChildren = element => {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  };

  /**
   * Add multiple classes to element
   * @param {HTMLElement} element - Target element
   * @param {string[]} classes - Array of class names
   */
  const addClasses = (element, classes) => {
    if (!element || !Array.isArray(classes)) return;
    element.classList.add(...classes);
  };

  /**
   * Remove multiple classes from element
   * @param {HTMLElement} element - Target element
   * @param {string[]} classes - Array of class names
   */
  const removeClasses = (element, classes) => {
    if (!element || !Array.isArray(classes)) return;
    element.classList.remove(...classes);
  };

  /**
   * Toggle class on element
   * @param {HTMLElement} element - Target element
   * @param {string} className - Class name to toggle
   * @param {boolean} force - Force add or remove
   */
  const toggleClass = (element, className, force) => {
    if (!element || !className) return;
    element.classList.toggle(className, force);
  };

  // Public API
  return {
    createElement,
    createButton,
    createIcon,
    querySelector,
    querySelectorBatch,
    clearSelectorCache,
    getCacheStats,
    waitForElement,
    isElementVisible,
    getElementOffset,
    insertAfter,
    removeAllChildren,
    addClasses,
    removeClasses,
    toggleClass,
  };
})();
