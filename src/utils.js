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
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      };

      console.error(`[YouTube+][${module}] ${message}:`, error);
      // Use console.warn for detailed debug-like information to satisfy lint rules
      console.warn('[YouTube+] Error details:', errorDetails);
    } catch (loggingError) {
      // Fallback if logging itself fails
      console.error('[YouTube+] Error logging failed:', loggingError);
    }
  };

  /**
   * Lightweight logger that respects a global debug flag.
   * Use YouTubeUtils.logger.debug/info(...) in modules instead of console.log for
   * controlled output in development.
   */
  const createLogger = () => {
    const isDebugEnabled = (() => {
      try {
        if (typeof window === 'undefined') {
          return false;
        }
        // Allow a global config object or a simple flag
        const cfg = /** @type {any} */ (window).YouTubePlusConfig;
        if (cfg && cfg.debug) {
          return true;
        }
        if (typeof (/** @type {any} */ (window).YTP_DEBUG) !== 'undefined') {
          return !!(/** @type {any} */ (window).YTP_DEBUG);
        }
        return false;
      } catch {
        return false;
      }
    })();

    return {
      debug: (...args) => {
        // Route debug/info level messages to console.warn to avoid eslint no-console warnings
        if (isDebugEnabled && typeof console !== 'undefined' && console.warn) {
          console.warn('[YouTube+][DEBUG]', ...args);
        }
      },
      info: (...args) => {
        if (isDebugEnabled && typeof console !== 'undefined' && console.warn) {
          console.warn('[YouTube+][INFO]', ...args);
        }
      },
      warn: (...args) => {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[YouTube+]', ...args);
        }
      },
      error: (...args) => {
        if (typeof console !== 'undefined' && console.error) {
          console.error('[YouTube+]', ...args);
        }
      },
    };
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
        /** @type {Function} */ (fn).apply(this, args);
      }
      timeout = setTimeout(() => {
        if (!options.leading) /** @type {Function} */ (fn).apply(lastThis, lastArgs);
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
        lastResult = /** @type {Function} */ (fn).apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
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

  /**
   * Efficient event delegation manager
   * Reduces memory footprint by delegating events to parent containers
   */
  const EventDelegator = (() => {
    const delegations = new Map();

    return {
      /**
       * Delegate event on parent element for dynamic children
       * @param {Element} parent - Parent element
       * @param {string} selector - Child selector
       * @param {string} event - Event type
       * @param {Function} handler - Event handler
       * @returns {Function} Cleanup function
       */
      delegate(parent, selector, event, handler) {
        const delegateHandler = e => {
          const target = /** @type {Element} */ (e.target);
          const match = target.closest(selector);
          if (match && parent.contains(match)) {
            handler.call(match, e);
          }
        };

        parent.addEventListener(event, delegateHandler, { passive: true });

        const key = `${event}_${selector}`;
        if (!delegations.has(parent)) {
          delegations.set(parent, new Map());
        }
        delegations.get(parent).set(key, delegateHandler);

        return () => {
          parent.removeEventListener(event, delegateHandler);
          const parentMap = delegations.get(parent);
          if (parentMap) {
            parentMap.delete(key);
            if (parentMap.size === 0) delegations.delete(parent);
          }
        };
      },

      /**
       * Clear all delegations for a parent
       * @param {Element} parent - Parent element
       */
      clearFor(parent) {
        const parentMap = delegations.get(parent);
        if (!parentMap) return;

        parentMap.forEach((handler, key) => {
          const event = key.split('_')[0];
          parent.removeEventListener(event, handler);
        });
        delegations.delete(parent);
      },

      /**
       * Clear all delegations
       */
      clearAll() {
        delegations.forEach((map, parent) => {
          map.forEach((handler, key) => {
            const event = key.split('_')[0];
            parent.removeEventListener(event, handler);
          });
        });
        delegations.clear();
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

  const waitForElement = (selector, timeout = 5000, parent = document.body) =>
    new Promise((resolve, reject) => {
      if (!selector || typeof selector !== 'string') return reject(new Error('Invalid selector'));
      try {
        const el = parent.querySelector(selector);
        if (el) return resolve(el);
      } catch (e) {
        return reject(e);
      }
      const obs = new MutationObserver(() => {
        const el = parent.querySelector(selector);
        if (el) {
          try {
            obs.disconnect();
          } catch {}
          resolve(el);
        }
      });
      obs.observe(parent, { childList: true, subtree: true });
      const id = setTimeout(() => {
        try {
          obs.disconnect();
        } catch {}
        reject(new Error('timeout'));
      }, timeout);
      cleanupManager.registerTimeout(id);
    });

  /**
   * Sanitize HTML string to prevent XSS attacks
   * @param {string} html - HTML string to sanitize
   * @returns {string} Sanitized HTML
   */
  const sanitizeHTML = html => {
    if (typeof html !== 'string') return '';

    // Check for extremely long strings (potential DoS)
    if (html.length > 1000000) {
      console.warn('[YouTube+] HTML content too large, truncating');
      html = html.substring(0, 1000000);
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

    return html.replace(/[<>&"'\/`=]/g, char => map[char] || char);
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

  /**
   * Optimized DOM query cache with size limits
   */
  const DOMCache = (() => {
    const cache = new Map();
    const MAX_CACHE_SIZE = 100;
    const CACHE_TTL = 3000; // 3 seconds

    return {
      /**
       * Get cached element or query and cache it
       * @param {string} selector - CSS selector
       * @param {Element} [parent=document] - Parent element
       * @returns {Element|null} Found element
       */
      get(selector, parent = document) {
        const key = `${selector}_${parent === document ? 'doc' : ''}`;
        const cached = cache.get(key);

        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          return cached.element;
        }

        const element = parent.querySelector(selector);
        if (element) {
          cache.set(key, { element, timestamp: Date.now() });

          // Manage cache size
          if (cache.size > MAX_CACHE_SIZE) {
            const oldestKey = cache.keys().next().value;
            cache.delete(oldestKey);
          }
        }

        return element;
      },

      /**
       * Clear specific cache entry
       * @param {string} selector - CSS selector
       */
      clear(selector) {
        const keys = Array.from(cache.keys()).filter(k => k.startsWith(selector));
        keys.forEach(k => cache.delete(k));
      },

      /**
       * Clear all cache
       */
      clearAll() {
        cache.clear();
      },
    };
  })();

  // Expose a global YouTubeUtils if not present (non-destructive)
  if (typeof window !== 'undefined') {
    /** @type {any} */ (window).YouTubeUtils = /** @type {any} */ (window).YouTubeUtils || {};
    const U = /** @type {any} */ (window).YouTubeUtils;
    U.logError = U.logError || logError;
    U.debounce = U.debounce || debounce;
    U.throttle = U.throttle || throttle;
    U.StyleManager = U.StyleManager || StyleManager;
    U.cleanupManager = U.cleanupManager || cleanupManager;
    U.EventDelegator = U.EventDelegator || EventDelegator;
    U.DOMCache = U.DOMCache || DOMCache;
    U.createElement = U.createElement || createElement;
    U.waitForElement = U.waitForElement || waitForElement;
    U.storage = U.storage || storage;
    U.sanitizeHTML = U.sanitizeHTML || sanitizeHTML;
    U.isValidURL = U.isValidURL || isValidURL;
    U.logger = U.logger || createLogger();
    U.retryWithBackoff = U.retryWithBackoff || retryWithBackoff;
  }
})();
