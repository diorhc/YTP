// Shared utilities for YouTube+ modules
(function () {
  'use strict';

  /**
   * Logs an error message with module context
   * @param {string} module - The module name where the error occurred
   * @param {string} message - Description of the error
   * @param {Error|*} error - The error object or value
   */
  const logError = (module, message, error) => {
    try {
      const errorDetails = {
        module,
        message,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        timestamp: new Date().toISOString(),
        userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
        url: typeof window === 'undefined' ? 'unknown' : window.location.href,
      };

      console.error(`[YouTube+][${module}] ${message}:`, error);
      console.debug('[YouTube+] Error details:', errorDetails);
    } catch (loggingError) {
      // Fallback if logging itself fails
      console.error('[YouTube+] Error logging failed:', loggingError);
    }
  };

  /**
   * Creates a debounced function that delays invoking func until after wait milliseconds
   * @template {Function} T
   * @param {T} fn - The function to debounce
   * @param {number} ms - The number of milliseconds to delay
   * @param {{leading?: boolean}} [options={}] - Options object
   * @returns {T & {cancel: () => void}} The debounced function with a cancel method
   */
  const debounce = (fn, ms, options = {}) => {
    let timeout = null;
    let lastArgs = null;
    let lastThis = null;
    /** @this {any} */
    const debounced = function (...args) {
      lastArgs = args;
      lastThis = this;
      clearTimeout(timeout);
      if (options.leading && !timeout) {
        /** @type {Function} */ (fn).call(this, ...args);
      }
      timeout = setTimeout(() => {
        if (!options.leading) /** @type {Function} */ (fn).call(lastThis, ...lastArgs);
        timeout = null;
        lastArgs = null;
        lastThis = null;
      }, ms);
    };
    debounced.cancel = () => {
      clearTimeout(timeout);
      timeout = null;
      lastArgs = null;
      lastThis = null;
    };
    return /** @type {any} */ (debounced);
  };

  /**
   * Creates a throttled function that only invokes func at most once per limit milliseconds
   * @template {Function} T
   * @param {T} fn - The function to throttle
   * @param {number} limit - The number of milliseconds to throttle invocations to
   * @returns {T} The throttled function
   */
  const throttle = (fn, limit) => {
    let inThrottle = false;
    let lastResult;
    /** @this {any} */
    const throttled = function (...args) {
      if (!inThrottle) {
        lastResult = /** @type {Function} */ (fn).call(this, ...args);
        inThrottle = true;
        setTimeout(() => {
          inThrottle = false;
        }, limit);
      }
      return lastResult;
    };
    return /** @type {any} */ (throttled);
  };

  const StyleManager = (function () {
    const styles = new Map();
    return {
      add(id, css) {
        try {
          let el = document.getElementById(id);
          if (!el) {
            el = document.createElement('style');
            el.id = id;
            document.head.appendChild(el);
          }
          styles.set(id, css);
          el.textContent = Array.from(styles.values()).join('\n\n');
        } catch (e) {
          logError('StyleManager', 'add failed', e);
        }
      },
      remove(id) {
        try {
          styles.delete(id);
          const el = document.getElementById(id);
          if (el) el.remove();
        } catch (e) {
          logError('StyleManager', 'remove failed', e);
        }
      },
      clear() {
        for (const id of Array.from(styles.keys())) this.remove(id);
      },
    };
  })();

  const cleanupManager = (function () {
    const observers = new Set();
    const listeners = new Map();
    const intervals = new Set();
    const timeouts = new Set();
    const animationFrames = new Set();

    return {
      registerObserver(o) {
        try {
          observers.add(o);
        } catch {}
        return o;
      },
      registerListener(target, ev, fn, opts) {
        try {
          target.addEventListener(ev, fn, opts);
          const key = Symbol();
          listeners.set(key, { target, ev, fn, opts });
          return key;
        } catch (e) {
          logError('cleanupManager', 'registerListener failed', e);
          return null;
        }
      },
      registerInterval(id) {
        intervals.add(id);
        return id;
      },
      registerTimeout(id) {
        timeouts.add(id);
        return id;
      },
      registerAnimationFrame(id) {
        animationFrames.add(id);
        return id;
      },
      cleanup() {
        try {
          for (const o of observers) {
            try {
              o.disconnect();
            } catch {}
          }
          observers.clear();
          for (const keyEntry of listeners.values()) {
            try {
              keyEntry.target.removeEventListener(keyEntry.ev, keyEntry.fn, keyEntry.opts);
            } catch {}
          }
          listeners.clear();
          for (const id of intervals) clearInterval(id);
          intervals.clear();
          for (const id of timeouts) clearTimeout(id);
          timeouts.clear();
          for (const id of animationFrames) cancelAnimationFrame(id);
          animationFrames.clear();
        } catch (e) {
          logError('cleanupManager', 'cleanup failed', e);
        }
      },
      // expose for debug
      observers,
      listeners,
      intervals,
      timeouts,
      animationFrames,
    };
  })();

  /**
   * Event delegation helper - attach single listener to parent for multiple children
   * @param {HTMLElement} parent - Parent element to attach listener to
   * @param {string} selector - CSS selector for child elements
   * @param {string} eventType - Event type (click, mouseenter, etc)
   * @param {Function} handler - Event handler function
   * @param {Object} options - Event listener options
   * @returns {Function} Cleanup function to remove listener
   */
  const delegateEvent = (parent, selector, eventType, handler, options = {}) => {
    const delegatedHandler = event => {
      const target = event.target.closest(selector);
      if (target && parent.contains(target)) {
        handler.call(target, event);
      }
    };

    parent.addEventListener(eventType, delegatedHandler, options);

    // Return cleanup function
    return () => parent.removeEventListener(eventType, delegatedHandler, options);
  };

  /**
   * Batch event delegation - setup multiple delegated events at once
   * @param {HTMLElement} parent - Parent element
   * @param {Object} config - Config object with selector as key, events as value
   * @returns {Function} Cleanup function for all listeners
   * @example
   * batchDelegateEvents(container, {
   *   '.button': { click: handleClick, mouseenter: handleHover },
   *   '.item': { click: handleItemClick }
   * })
   */
  const batchDelegateEvents = (parent, config) => {
    const cleanupFns = [];

    for (const [selector, events] of Object.entries(config)) {
      for (const [eventType, handler] of Object.entries(events)) {
        cleanupFns.push(delegateEvent(parent, selector, eventType, handler));
      }
    }

    // Return single cleanup function for all
    return () => cleanupFns.forEach(fn => fn());
  };

  const createElement = (tag, props = {}, children = []) => {
    try {
      const element = document.createElement(tag);
      Object.entries(props).forEach(([k, v]) => {
        if (k === 'className') element.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(element.style, v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(element.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') {
          element.addEventListener(k.slice(2), v);
        } else element.setAttribute(k, v);
      });
      children.forEach(c => {
        if (typeof c === 'string') element.appendChild(document.createTextNode(c));
        else if (c instanceof Node) element.appendChild(c);
      });
      return element;
    } catch (e) {
      logError('createElement', 'failed', e);
      return document.createElement('div');
    }
  };

  /**
   * Validate waitForElement parameters
   * @param {string} selector - CSS selector
   * @returns {Error|null} Validation error or null
   */
  const validateWaitForElementParams = selector => {
    if (!selector || typeof selector !== 'string') {
      return new Error('Invalid selector');
    }
    return null;
  };

  /**
   * Try to find element immediately
   * @param {HTMLElement} parent - Parent element
   * @param {string} selector - CSS selector
   * @returns {{element: HTMLElement|null, error: Error|null}} Result object
   */
  const tryFindElement = (parent, selector) => {
    try {
      const el = parent.querySelector(selector);
      return { element: el, error: null };
    } catch (e) {
      return { element: null, error: e };
    }
  };

  /**
   * Setup mutation observer for element watching
   * @param {HTMLElement} parent - Parent element
   * @param {string} selector - CSS selector
   * @param {Function} resolve - Promise resolve function
   * @returns {MutationObserver} Mutation observer instance
   */
  const setupElementObserver = (parent, selector, resolve) => {
    const obs = new MutationObserver(() => {
      const el = parent.querySelector(selector);
      if (el) {
        try {
          obs.disconnect();
        } catch {}
        resolve(el);
      }
    });
    return obs;
  };

  /**
   * Start observing parent element for changes
   * @param {MutationObserver} obs - Observer instance
   * @param {HTMLElement} parent - Parent element to observe
   */
  const startObserving = (obs, parent) => {
    try {
      if (
        parent &&
        (parent instanceof Node || parent instanceof Document || parent instanceof DocumentFragment)
      ) {
        obs.observe(parent, { childList: true, subtree: true });
      } else if (document.body) {
        obs.observe(document.body, { childList: true, subtree: true });
      } else {
        document.addEventListener(
          'DOMContentLoaded',
          () => {
            try {
              obs.observe(document.body, { childList: true, subtree: true });
            } catch (observeError) {
              logError(
                'waitForElement',
                'Failed to observe document.body after DOMContentLoaded',
                observeError
              );
            }
          },
          { once: true }
        );
      }
    } catch (observeError) {
      logError('waitForElement', 'observer.observe failed', observeError);
    }
  };

  /**
   * Setup timeout for element search
   * @param {MutationObserver} obs - Observer instance
   * @param {Function} reject - Promise reject function
   * @param {number} timeout - Timeout in milliseconds
   * @returns {number} Timeout ID
   */
  const setupElementTimeout = (obs, reject, timeout) => {
    const id = setTimeout(() => {
      try {
        obs.disconnect();
      } catch {}
      reject(new Error('timeout'));
    }, timeout);
    cleanupManager.registerTimeout(id);
    return id;
  };

  const waitForElement = (selector, timeout = 5000, parent = document.body) =>
    new Promise((resolve, reject) => {
      const validationError = validateWaitForElementParams(selector);
      if (validationError) return reject(validationError);

      const { element, error } = tryFindElement(parent, selector);
      if (error) return reject(error);
      if (element) return resolve(element);

      const obs = setupElementObserver(parent, selector, resolve);
      startObserving(obs, parent);
      setupElementTimeout(obs, reject, timeout);
    });

  /**
   * Sanitize HTML string to prevent XSS attacks
   * @param {string} html - HTML string to sanitize
   * @returns {string} Sanitized HTML
   */
  const sanitizeHTML = html => {
    if (typeof html !== 'string') return '';

    // Check for extremely long strings (potential DoS)
    let sanitizedHtml = html;
    if (sanitizedHtml.length > 1000000) {
      console.warn('[YouTube+] HTML content too large, truncating');
      sanitizedHtml = sanitizedHtml.substring(0, 1000000);
    }

    /** @type {Record<string, string>} */
    const map = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;',
    };

    return sanitizedHtml.replace(/[<>&"'\/`=]/g, char => map[char] || char);
  };

  /**
   * Validate URL to prevent injection attacks
   * @param {string} url - URL to validate
   * @returns {boolean} Whether URL is safe
   */
  const isValidURL = url => {
    if (typeof url !== 'string') return false;
    if (url.length > 2048) return false; // RFC 2616
    if (/^\s|\s$/.test(url)) return false; // No leading/trailing whitespace

    try {
      const parsed = new URL(url);
      // Only allow http/https protocols
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Retry an async operation with exponential backoff
   * @template T
   * @param {() => Promise<T>} fn - Async function to retry
   * @param {number} maxRetries - Maximum number of retries
   * @param {number} baseDelay - Base delay in milliseconds
   * @returns {Promise<T>} Result of the async operation
   */
  const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, i);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  };

  // Enhanced storage wrapper with better validation
  const storage = {
    /**
     * Get value from localStorage with validation
     * @param {string} key - Storage key
     * @param {*} def - Default value
     * @returns {*} Stored value or default
     */
    get(key, def = null) {
      // Validate key format
      if (typeof key !== 'string' || !/^[a-zA-Z0-9_\-\.]+$/.test(key)) {
        logError('storage', 'Invalid key format', new Error(`Invalid key: ${key}`));
        return def;
      }

      try {
        const v = localStorage.getItem(key);
        if (v === null) return def;

        // Check size before parsing
        if (v.length > 5 * 1024 * 1024) {
          // 5MB limit
          logError('storage', 'Stored value too large', new Error(`Key: ${key}`));
          return def;
        }

        return JSON.parse(v);
      } catch (e) {
        logError('storage', 'Failed to parse stored value', e);
        return def;
      }
    },

    /**
     * Set value in localStorage with validation
     * @param {string} key - Storage key
     * @param {*} val - Value to store
     * @returns {boolean} Whether operation succeeded
     */
    set(key, val) {
      // Validate key format
      if (typeof key !== 'string' || !/^[a-zA-Z0-9_\-\.]+$/.test(key)) {
        logError('storage', 'Invalid key format', new Error(`Invalid key: ${key}`));
        return false;
      }

      try {
        const serialized = JSON.stringify(val);

        // Check size limit (5MB)
        if (serialized.length > 5 * 1024 * 1024) {
          logError('storage', 'Value too large to store', new Error(`Key: ${key}`));
          return false;
        }

        localStorage.setItem(key, serialized);
        return true;
      } catch (e) {
        logError('storage', 'Failed to store value', e);
        return false;
      }
    },

    /**
     * Remove value from localStorage
     * @param {string} key - Storage key
     */
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        logError('storage', 'Failed to remove value', e);
      }
    },

    /**
     * Clear all localStorage
     */
    clear() {
      try {
        localStorage.clear();
      } catch (e) {
        logError('storage', 'Failed to clear storage', e);
      }
    },

    /**
     * Check if key exists
     * @param {string} key - Storage key
     * @returns {boolean} Whether key exists
     */
    has(key) {
      try {
        return localStorage.getItem(key) !== null;
      } catch {
        return false;
      }
    },
  };

  // Expose a global YouTubeUtils if not present (non-destructive)
  if (typeof window !== 'undefined') {
    /** @type {any} */ (window).YouTubeUtils = /** @type {any} */ (window).YouTubeUtils || {};
    const U = /** @type {any} */ (window).YouTubeUtils;
    U.logError = U.logError || logError;
    U.debounce = U.debounce || debounce;
    U.throttle = U.throttle || throttle;
    U.delegateEvent = U.delegateEvent || delegateEvent;
    U.batchDelegateEvents = U.batchDelegateEvents || batchDelegateEvents;
    U.StyleManager = U.StyleManager || StyleManager;
    U.cleanupManager = U.cleanupManager || cleanupManager;
    U.createElement = U.createElement || createElement;
    U.waitForElement = U.waitForElement || waitForElement;
    U.storage = U.storage || storage;
    U.sanitizeHTML = U.sanitizeHTML || sanitizeHTML;
    U.isValidURL = U.isValidURL || isValidURL;
    U.retryWithBackoff = U.retryWithBackoff || retryWithBackoff;
  }
})();
