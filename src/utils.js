// Shared utilities for YouTube+ modules
(function () {
  'use strict';

  // DOM cache helper with fallback
  const qs = selector => {
    if (window.YouTubeDOMCache && typeof window.YouTubeDOMCache.get === 'function') {
      return window.YouTubeDOMCache.get(selector);
    }
    return document.querySelector(selector);
  };

  // --- Shared DOM helpers (canonical, used by all modules) ---
  /**
   * Query a single element via DOMCache with context support
   * @param {string} sel - CSS selector
   * @param {Element|Document} [ctx] - Optional context element
   * @returns {Element|null}
   */
  const $ = (sel, ctx) => {
    const cache = window.YouTubeDOMCache;
    if (cache && typeof cache.querySelector === 'function') return cache.querySelector(sel, ctx);
    if (cache && typeof cache.get === 'function' && !ctx) return cache.get(sel);
    return (ctx || document).querySelector(sel);
  };

  /**
   * Query all matching elements via DOMCache with context support
   * @param {string} sel - CSS selector
   * @param {Element|Document} [ctx] - Optional context element
   * @returns {Element[]}
   */
  const $$ = (sel, ctx) => {
    const cache = window.YouTubeDOMCache;
    if (cache && typeof cache.querySelectorAll === 'function') {
      return cache.querySelectorAll(sel, ctx);
    }
    if (cache && typeof cache.getAll === 'function' && !ctx) return cache.getAll(sel);
    return Array.from((ctx || document).querySelectorAll(sel));
  };

  /**
   * Get element by ID via DOMCache
   * @param {string} id - Element ID
   * @returns {Element|null}
   */
  const byId = id => {
    const cache = window.YouTubeDOMCache;
    if (cache && typeof cache.getElementById === 'function') return cache.getElementById(id);
    return document.getElementById(id);
  };

  // --- Shared translation helper (canonical) ---
  /**
   * Translation helper with fallback interpolation
   * @param {string} key - Translation key
   * @param {Object<string, string|number>} [params] - Interpolation parameters
   * @returns {string}
   */
  const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const t = (key, params = {}) => {
    if (window.YouTubePlusI18n?.t) return window.YouTubePlusI18n.t(key, params);
    if (!key) return '';
    let result = String(key);
    for (const [k, v] of Object.entries(params || {})) {
      result = result.replace(new RegExp(`\\{${escapeRegex(k)}\\}`, 'g'), String(v));
    }
    return result;
  };

  // --- Shared feature toggle loader ---
  /**
   * Shared constant for the settings localStorage key
   * @type {string}
   */
  const SETTINGS_KEY = 'youtube_plus_settings';

  /**
   * Check if current page is YouTube Studio
   * @returns {boolean}
   */
  const isStudioPage = () => {
    try {
      return location.hostname.includes('studio.youtube.com');
    } catch {
      return false;
    }
  };

  /**
   * Load a feature enabled state from youtube_plus_settings
   * @param {string} featureKey - The key name (e.g. 'enableZoom', 'enablePlayAll')
   * @param {boolean} [defaultValue=true] - Default value if not found
   * @returns {boolean}
   */
  const loadFeatureEnabled = (featureKey, defaultValue = true) => {
    try {
      const settings = localStorage.getItem(SETTINGS_KEY);
      if (settings) {
        const parsed = JSON.parse(settings);
        return parsed[featureKey] !== false;
      }
    } catch {
      /* empty */
    }
    return defaultValue;
  };

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
        const cfg = window.YouTubePlusConfig;
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
        if (isDebugEnabled && console?.warn) {
          console.warn('[YouTube+][DEBUG]', ...args);
        }
      },
      info: (...args) => {
        if (isDebugEnabled && console?.warn) {
          console.warn('[YouTube+][INFO]', ...args);
        }
      },
      warn: (...args) => {
        if (console?.warn) {
          console.warn('[YouTube+]', ...args);
        }
      },
      error: (...args) => {
        if (console?.error) {
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
    let isDestroyed = false;

    /** @this {any} */
    const debounced = function (...args) {
      if (isDestroyed) return;

      lastArgs = args;
      lastThis = this;

      if (timeout !== null) clearTimeout(timeout);

      if (options.leading && timeout === null) {
        try {
          /** @type {Function} */ (fn).apply(this, args);
        } catch (e) {
          console.error('[YouTube+] Debounced function error:', e);
        }
      }

      timeout = setTimeout(() => {
        if (!isDestroyed && !options.leading) {
          try {
            /** @type {Function} */ (fn).apply(lastThis, lastArgs);
          } catch (e) {
            console.error('[YouTube+] Debounced function error:', e);
          }
        }
        timeout = null;
        lastArgs = null;
        lastThis = null;
      }, ms);
    };

    debounced.cancel = () => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
      lastArgs = null;
      lastThis = null;
    };

    debounced.destroy = () => {
      debounced.cancel();
      isDestroyed = true;
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
          styles.set(id, css);
          if (!el) {
            el = document.createElement('style');
            el.id = id;
            if (!document.head) {
              document.addEventListener(
                'DOMContentLoaded',
                () => {
                  if (!document.getElementById(id) && document.head) {
                    document.head.appendChild(el);
                    el.textContent = Array.from(styles.values()).join('\n\n');
                  }
                },
                { once: true }
              );
              return;
            }
            document.head.appendChild(el);
          }
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
    const listenerStats = { registeredTotal: 0 };
    const intervals = new Set();
    const timeouts = new Set();
    const animationFrames = new Set();
    const callbacks = new Set();
    // Map elements -> Set of observers (WeakMap so entries are GC'd when element removed)
    const elementObservers = new WeakMap();

    return {
      /**
       * Register an observer for global cleanup and optionally associate it with an element.
       * If an element is provided the observer will be tracked in a WeakMap so when
       * the element is GC'd the mapping is removed automatically.
       * @param {MutationObserver|IntersectionObserver|ResizeObserver} o
       * @param {Element} [el]
       */
      registerObserver(o, el) {
        try {
          if (o) observers.add(o);
          if (el && typeof el === 'object') {
            try {
              let set = elementObservers.get(el);
              if (!set) {
                set = new Set();
                elementObservers.set(el, set);
              }
              set.add(o);
            } catch {
              /* empty */
            }
          }
        } catch {
          /* empty */
        }
        return o;
      },
      registerListener(target, ev, fn, opts) {
        try {
          target.addEventListener(ev, fn, opts);
          const key = Symbol();
          listeners.set(key, { target, ev, fn, opts });
          listenerStats.registeredTotal++;
          return key;
        } catch (e) {
          logError('cleanupManager', 'registerListener failed', e);
          return null;
        }
      },
      getListenerStats() {
        try {
          return {
            active: listeners.size,
            registeredTotal: listenerStats.registeredTotal,
          };
        } catch {
          return { active: 0, registeredTotal: 0 };
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
      register(cb) {
        if (typeof cb === 'function') callbacks.add(cb);
      },
      cleanup() {
        try {
          for (const cb of callbacks) {
            try {
              cb();
            } catch (e) {
              logError('cleanupManager', 'callback failed', e);
            }
          }
          callbacks.clear();

          // Disconnect all registered observers
          for (const o of observers) {
            try {
              if (o && typeof o.disconnect === 'function') o.disconnect();
            } catch {
              /* empty */
            }
          }
          observers.clear();

          // Also attempt to disconnect observers associated with elements
          try {
            // We cannot iterate WeakMap keys; instead we iterate observers set already
            // which covers all observers registered via registerObserver above.
          } catch {
            /* empty */
          }
          for (const keyEntry of listeners.values()) {
            try {
              keyEntry.target.removeEventListener(keyEntry.ev, keyEntry.fn, keyEntry.opts);
            } catch {
              /* empty */
            }
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
      elementObservers,
      /**
       * Disconnect and remove observers associated with a given element
       * @param {Element} el
       */
      disconnectForElement(el) {
        try {
          const set = elementObservers.get(el);
          if (!set) return;
          for (const o of set) {
            try {
              if (o && typeof o.disconnect === 'function') o.disconnect();
              observers.delete(o);
            } catch {
              /* empty */
            }
          }
          elementObservers.delete(el);
        } catch (e) {
          logError('cleanupManager', 'disconnectForElement failed', e);
        }
      },
      /**
       * Disconnect a single observer and remove it from tracking
       * @param {MutationObserver|IntersectionObserver|ResizeObserver} o
       */
      disconnectObserver(o) {
        try {
          if (!o) return;
          try {
            if (typeof o.disconnect === 'function') o.disconnect();
          } catch {
            /* empty */
          }
          observers.delete(o);
          // remove from any element sets
          try {
            // Can't iterate WeakMap directly; attempt best-effort sweep by checking
            // known element keys via listeners map as a hint (not comprehensive).
            // This is a noop if not found; primary removal is from observers set.
          } catch {
            /* empty */
          }
        } catch (e) {
          logError('cleanupManager', 'disconnectObserver failed', e);
        }
      },
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
          } catch {
            /* empty */
          }
          resolve(el);
        }
      });
      obs.observe(parent, { childList: true, subtree: true });
      const id = setTimeout(() => {
        try {
          obs.disconnect();
        } catch {
          /* empty */
        }
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
   * Escape HTML for use in attributes (more strict than sanitizeHTML)
   * Prevents XSS in HTML attributes like onclick, onerror, etc.
   * @param {string} str - String to escape
   * @returns {string} Escaped string safe for HTML attributes
   */
  const escapeHTMLAttribute = str => {
    if (typeof str !== 'string') return '';

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
      '\n': '&#10;',
      '\r': '&#13;',
      '\t': '&#9;',
    };

    return str.replace(/[<>&"'\/`=\n\r\t]/g, char => map[char] || char);
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
   * Safely merge objects without prototype pollution
   * Prevents __proto__, constructor, and prototype pollution attacks
   * @template T
   * @param {T} target - Target object
   * @param {Object} source - Source object to merge
   * @returns {T} Merged target object
   */
  const safeMerge = (target, source) => {
    if (!source || typeof source !== 'object') return target;
    if (!target || typeof target !== 'object') return target;

    // List of dangerous keys that could lead to prototype pollution
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

    for (const key in source) {
      // Skip inherited properties
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;

      // Skip dangerous keys
      if (dangerousKeys.includes(key)) {
        console.warn(`[YouTube+][Security] Blocked attempt to set dangerous key: ${key}`);
        continue;
      }

      // Only copy own enumerable properties
      const value = source[key];

      // Deep clone objects (one level deep for safety)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] = safeMerge(target[key] || {}, value);
      } else {
        target[key] = value;
      }
    }

    return target;
  };

  /**
   * Validate and sanitize video ID
   * @param {string} videoId - Video ID to validate
   * @returns {string|null} Valid video ID or null
   */
  const validateVideoId = videoId => {
    if (typeof videoId !== 'string') return null;
    // YouTube video IDs are 11 characters, alphanumeric + dash and underscore
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
    return videoId;
  };

  /**
   * Validate and sanitize playlist ID
   * @param {string} playlistId - Playlist ID to validate
   * @returns {string|null} Valid playlist ID or null
   */
  const validatePlaylistId = playlistId => {
    if (typeof playlistId !== 'string') return null;
    // YouTube playlist IDs typically start with PL, UU, LL, RD, etc. and contain alphanumeric + dash and underscore
    if (!/^[a-zA-Z0-9_-]+$/.test(playlistId) || playlistId.length < 2 || playlistId.length > 50) {
      return null;
    }
    return playlistId;
  };

  /**
   * Validate and sanitize channel ID
   * @param {string} channelId - Channel ID to validate
   * @returns {string|null} Valid channel ID or null
   */
  const validateChannelId = channelId => {
    if (typeof channelId !== 'string') return null;
    // YouTube channel IDs start with UC and are 24 characters long
    if (!/^UC[a-zA-Z0-9_-]{22}$/.test(channelId) && !/^@[\w-]{3,30}$/.test(channelId)) {
      return null;
    }
    return channelId;
  };

  /**
   * Sanitize and validate numeric input
   * @param {any} value - Value to validate
   * @param {number} min - Minimum allowed value
   * @param {number} max - Maximum allowed value
   * @param {number} defaultValue - Default value if validation fails
   * @returns {number} Validated number
   */
  const validateNumber = (value, min = -Infinity, max = Infinity, defaultValue = 0) => {
    const num = Number(value);
    if (Number.isNaN(num) || !Number.isFinite(num)) return defaultValue;
    return Math.max(min, Math.min(max, num));
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
    const MAX_CACHE_SIZE = 200; // Increased for better performance
    const CACHE_TTL = 5000; // 5 seconds - longer cache

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

  /**
   * Advanced ScrollManager for efficient scroll event handling
   * Uses IntersectionObserver when possible for better performance
   */
  const ScrollManager = (() => {
    const listeners = new WeakMap();

    /**
     * Add optimized scroll listener
     * @param {Element} element - Element to listen to
     * @param {Function} callback - Callback function
     * @param {Object} options - Options {debounce: number, throttle: number, runInitial: boolean}
     * @returns {Function} Cleanup function
     */
    const addScrollListener = (element, callback, options = {}) => {
      try {
        const { debounce: debounceMs = 0, throttle: throttleMs = 0, runInitial = false } = options;

        let handler = callback;

        // Apply debounce if specified
        if (debounceMs > 0) {
          handler = debounce(handler, debounceMs);
        }

        // Apply throttle if specified
        if (throttleMs > 0) {
          handler = throttle(handler, throttleMs);
        }

        // Store handler for cleanup
        if (!listeners.has(element)) {
          listeners.set(element, new Set());
        }
        listeners.get(element).add(handler);

        // Add event listener
        element.addEventListener('scroll', handler, { passive: true });

        // Run initial callback if requested
        if (runInitial) {
          try {
            callback();
          } catch (err) {
            logError('ScrollManager', 'Initial callback error', err);
          }
        }

        // Return cleanup function
        return () => {
          try {
            element.removeEventListener('scroll', handler);
            const set = listeners.get(element);
            if (set) {
              set.delete(handler);
              if (set.size === 0) {
                listeners.delete(element);
              }
            }
          } catch (err) {
            logError('ScrollManager', 'Cleanup error', err);
          }
        };
      } catch (err) {
        logError('ScrollManager', 'addScrollListener error', err);
        return () => {}; // Return no-op cleanup
      }
    };

    /**
     * Remove all listeners for an element
     * @param {Element} element - Element to clean up
     */
    const removeAllListeners = element => {
      try {
        const set = listeners.get(element);
        if (!set) return;

        set.forEach(handler => {
          try {
            element.removeEventListener('scroll', handler);
          } catch {
            /* empty */
          }
        });

        listeners.delete(element);
      } catch (err) {
        logError('ScrollManager', 'removeAllListeners error', err);
      }
    };

    /**
     * Create scroll-to-top functionality with smooth animation
     * @param {Element} element - Element to scroll
     * @param {Object} options - Options {duration: number, easing: string}
     */
    const scrollToTop = (element, options = {}) => {
      const { duration = 300, easing = 'ease-out' } = options;

      try {
        // Try native smooth scroll first
        if ('scrollBehavior' in document.documentElement.style) {
          element.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        // Fallback to manual animation
        const start = element.scrollTop;
        const startTime = performance.now();

        const scroll = currentTime => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);

          // Easing function
          const easeOutQuad = t => t * (2 - t);
          const easedProgress = easing === 'ease-out' ? easeOutQuad(progress) : progress;

          element.scrollTop = start * (1 - easedProgress);

          if (progress < 1) {
            requestAnimationFrame(scroll);
          }
        };

        requestAnimationFrame(scroll);
      } catch (err) {
        logError('ScrollManager', 'scrollToTop error', err);
      }
    };

    return {
      addScrollListener,
      removeAllListeners,
      scrollToTop,
    };
  })();

  // Centralized history.pushState/replaceState wrapping.
  // Dispatches 'ytp-history-navigate' so modules can listen instead of each wrapping independently.
  if (typeof window !== 'undefined' && !window.__ytp_history_wrapped) {
    window.__ytp_history_wrapped = true;
    const _origPush = history.pushState;
    const _origReplace = history.replaceState;
    history.pushState = function () {
      const result = _origPush.apply(this, arguments);
      try {
        window.dispatchEvent(
          new CustomEvent('ytp-history-navigate', { detail: { type: 'pushState' } })
        );
      } catch (e) {
        console.warn('[YouTube+] pushState event error:', e);
      }
      return result;
    };
    history.replaceState = function () {
      const result = _origReplace.apply(this, arguments);
      try {
        window.dispatchEvent(
          new CustomEvent('ytp-history-navigate', { detail: { type: 'replaceState' } })
        );
      } catch (e) {
        console.warn('[YouTube+] replaceState event error:', e);
      }
      return result;
    };
  }

  // --- Shared Retry Scheduler ---
  // Used by modules to retry DOM element detection without each implementing their own timer loops.
  /**
   * Creates a retry scheduler that will invoke a check function until it succeeds or limits are hit.
   * @param {Object} opts
   * @param {() => boolean} opts.check - Return true to stop retrying
   * @param {number} [opts.maxAttempts=20] - Maximum retry attempts
   * @param {number} [opts.interval=250] - Delay between attempts (ms)
   * @param {() => void} [opts.onGiveUp] - Called when max attempts reached
   * @returns {{ stop: () => void }} Control handle
   */
  const createRetryScheduler = opts => {
    const { check, maxAttempts = 20, interval = 250, onGiveUp, label } = opts;
    let attempts = 0;
    let timerId = null;
    let stopped = false;
    const _label = label || 'retry';
    const _hasPerfApi =
      typeof performance !== 'undefined' && typeof performance.mark === 'function';

    const tick = () => {
      if (stopped) return;
      attempts++;
      if (_hasPerfApi) {
        try {
          performance.mark(`ytp:${_label}:attempt:${attempts}`);
        } catch {
          /* empty */
        }
      }
      try {
        if (check()) {
          stopped = true;
          if (_hasPerfApi) {
            try {
              performance.mark(`ytp:${_label}:success`);
            } catch {
              /* empty */
            }
          }
          return;
        }
      } catch (e) {
        logError('RetryScheduler', 'check error', e);
      }
      if (attempts >= maxAttempts) {
        stopped = true;
        if (_hasPerfApi) {
          try {
            performance.mark(`ytp:${_label}:giveup`);
          } catch {
            /* empty */
          }
        }
        if (typeof onGiveUp === 'function') {
          try {
            onGiveUp();
          } catch {
            /* empty */
          }
        }
        return;
      }
      timerId = setTimeout(tick, interval);
    };

    // Start on next microtask
    timerId = setTimeout(tick, 0);

    return {
      stop() {
        stopped = true;
        if (timerId) clearTimeout(timerId);
        timerId = null;
      },
    };
  };

  // --- Observer Registry (dev-only diagnostics) ---
  // Tracks active observers/listeners to detect monotonic growth.
  const ObserverRegistry = (() => {
    let _active = 0;
    let _peak = 0;
    let _created = 0;
    let _disconnected = 0;

    return {
      /** Record observer creation */
      track() {
        _active++;
        _created++;
        if (_active > _peak) _peak = _active;
      },
      /** Record observer disconnection */
      untrack() {
        _active = Math.max(0, _active - 1);
        _disconnected++;
      },
      /** Get snapshot of observer counts */
      getStats() {
        return { active: _active, peak: _peak, created: _created, disconnected: _disconnected };
      },
      /** Reset (for tests) */
      reset() {
        _active = 0;
        _peak = 0;
        _created = 0;
        _disconnected = 0;
      },
      /** Dev-only: dump all diagnostics to console for field debugging */
      dump() {
        const stats = {
          active: _active,
          peak: _peak,
          created: _created,
          disconnected: _disconnected,
        };
        // Also include cleanupManager stats if available
        const cmStats = cleanupManager
          ? {
              observers: cleanupManager.observers?.size ?? 'n/a',
              intervals: cleanupManager.intervals?.size ?? 'n/a',
              timeouts: cleanupManager.timeouts?.size ?? 'n/a',
              listeners:
                typeof cleanupManager.getListenerStats === 'function'
                  ? cleanupManager.getListenerStats()
                  : 'n/a',
            }
          : null;
        console.warn('[YouTube+ Diagnostics] ObserverRegistry:', stats);
        if (cmStats) console.warn('[YouTube+ Diagnostics] CleanupManager:', cmStats);
        return { observers: stats, cleanup: cmStats };
      },
    };
  })();

  // --- FeatureToggle utility ---
  // Unifies feature enable/disable patterns across modules.
  // Provides a single source of truth for feature state with change event dispatch.
  /**
   * @param {string} featureKey - localStorage key within youtube_plus_settings (e.g. 'enableZoom')
   * @param {boolean} [defaultEnabled=true] - Default state when not configured
   * @returns {{ isEnabled: () => boolean, setEnabled: (v: boolean) => void, onChange: (cb: (enabled: boolean) => void) => () => void }}
   */
  const createFeatureToggle = (featureKey, defaultEnabled = true) => {
    let _enabled = loadFeatureEnabled(featureKey, defaultEnabled);
    /** @type {Set<(enabled: boolean) => void>} */
    const _listeners = new Set();

    return {
      /** Current state */
      isEnabled() {
        return _enabled;
      },
      /** Update state, persist, and notify listeners */
      setEnabled(value) {
        const next = value !== false;
        if (next === _enabled) return;
        _enabled = next;
        // Persist back to settings
        try {
          const raw = localStorage.getItem(SETTINGS_KEY);
          const settings = raw ? JSON.parse(raw) : {};
          settings[featureKey] = _enabled;
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch {
          // Storage write failure — state still updated in memory
        }
        // Notify listeners
        for (const cb of _listeners) {
          try {
            cb(_enabled);
          } catch {
            /* empty */
          }
        }
      },
      /** Subscribe to changes. Returns unsubscribe function */
      onChange(cb) {
        _listeners.add(cb);
        return () => _listeners.delete(cb);
      },
      /** Re-read state from localStorage (e.g. after external change) */
      reload() {
        _enabled = loadFeatureEnabled(featureKey, defaultEnabled);
      },
    };
  };

  // Expose a global YouTubeUtils if not present (non-destructive)
  if (typeof window !== 'undefined') {
    window.YouTubeUtils = window.YouTubeUtils || {};
    const U = window.YouTubeUtils;
    U.logError = U.logError || logError;
    U.debounce = U.debounce || debounce;
    U.throttle = U.throttle || throttle;
    U.StyleManager = U.StyleManager || StyleManager;
    U.cleanupManager = U.cleanupManager || cleanupManager;
    U.EventDelegator = U.EventDelegator || EventDelegator;
    U.DOMCache = U.DOMCache || DOMCache;
    U.ScrollManager = U.ScrollManager || ScrollManager;
    U.createElement = U.createElement || createElement;
    U.waitForElement = U.waitForElement || waitForElement;
    U.storage = U.storage || storage;
    U.sanitizeHTML = U.sanitizeHTML || sanitizeHTML;
    U.escapeHTMLAttribute = U.escapeHTMLAttribute || escapeHTMLAttribute;
    U.safeMerge = U.safeMerge || safeMerge;
    U.validateVideoId = U.validateVideoId || validateVideoId;
    U.validatePlaylistId = U.validatePlaylistId || validatePlaylistId;
    U.validateChannelId = U.validateChannelId || validateChannelId;
    U.validateNumber = U.validateNumber || validateNumber;
    U.isValidURL = U.isValidURL || isValidURL;
    U.logger = U.logger || createLogger();
    U.retryWithBackoff = U.retryWithBackoff || retryWithBackoff;
    if (typeof U.createRetryScheduler !== 'function') {
      U.createRetryScheduler = createRetryScheduler;
    }
    U.ObserverRegistry = U.ObserverRegistry || ObserverRegistry;
    // Shared DOM helpers — modules can use YouTubeUtils.$ instead of local copies
    U.$ = U.$ || $;
    U.$$ = U.$$ || $$;
    U.byId = U.byId || byId;
    U.t = U.t || t;
    U.loadFeatureEnabled = U.loadFeatureEnabled || loadFeatureEnabled;
    U.createFeatureToggle = U.createFeatureToggle || createFeatureToggle;
    U.SETTINGS_KEY = U.SETTINGS_KEY || SETTINGS_KEY;
    U.isStudioPage = U.isStudioPage || isStudioPage;

    // Dev-only diagnostics — call window.__ytpDiagnostics() in browser console
    if (!window.__ytpDiagnostics) {
      window.__ytpDiagnostics = function (verbose) {
        const obs = ObserverRegistry.getStats();
        const cm = {
          observers: cleanupManager.observers.size,
          listeners: cleanupManager.getListenerStats(),
          intervals: cleanupManager.intervals.size,
          timeouts: cleanupManager.timeouts.size,
          animationFrames: cleanupManager.animationFrames.size,
        };

        // Retry scheduler performance metrics (dev-only)
        let retryMetrics = null;
        try {
          if (
            typeof performance !== 'undefined' &&
            typeof performance.getEntriesByType === 'function'
          ) {
            const marks = performance
              .getEntriesByType('mark')
              .filter(m => m.name.startsWith('ytp:'));
            const retryLabels = new Set();
            const retryData = {};
            for (const m of marks) {
              const parts = m.name.split(':');
              if (parts.length >= 3) {
                const label = parts[1];
                retryLabels.add(label);
                if (!retryData[label]) {
                  retryData[label] = { attempts: 0, success: false, giveup: false };
                }
                if (parts[2] === 'attempt') retryData[label].attempts++;
                else if (parts[2] === 'success') retryData[label].success = true;
                else if (parts[2] === 'giveup') retryData[label].giveup = true;
              }
            }
            retryMetrics = { totalMarks: marks.length, schedulers: retryData };
          }
        } catch {
          /* empty */
        }

        const report = {
          observers: obs,
          cleanupManager: cm,
          retrySchedulers: retryMetrics,
          timestamp: new Date().toISOString(),
        };
        console.warn('[YouTube+ Diagnostics] Observers:', obs);
        console.warn('[YouTube+ Diagnostics] CleanupManager:', cm);
        if (retryMetrics) console.warn('[YouTube+ Diagnostics] RetrySchedulers:', retryMetrics);
        if (verbose) console.warn('[YouTube+ Diagnostics]', JSON.stringify(report, null, 2));
        return report;
      };
    }

    // Provide lightweight channel stats helpers if not defined by other modules.
    U.channelStatsHelpers = U.channelStatsHelpers || null;
    // Wrap global timer functions to auto-register with cleanupManager for safe cleanup.
    try {
      const w = window;
      if (w && !w.__ytp_timers_wrapped) {
        const origSetTimeout = w.setTimeout.bind(w);
        const origSetInterval = w.setInterval.bind(w);
        const origRaf = w.requestAnimationFrame ? w.requestAnimationFrame.bind(w) : null;

        w.setTimeout = function (fn, ms, ...args) {
          const id = origSetTimeout(fn, ms, ...args);
          try {
            U.cleanupManager.registerTimeout(id);
          } catch {
            /* empty */
          }
          return id;
        };

        w.setInterval = function (fn, ms, ...args) {
          const id = origSetInterval(fn, ms, ...args);
          try {
            U.cleanupManager.registerInterval(id);
          } catch {
            /* empty */
          }
          return id;
        };

        if (origRaf) {
          w.requestAnimationFrame = function (cb) {
            const id = origRaf(cb);
            try {
              U.cleanupManager.registerAnimationFrame(id);
            } catch {
              /* empty */
            }
            return id;
          };
        }

        w.__ytp_timers_wrapped = true;
      }
    } catch (e) {
      logError('utils', 'timer wrapper failed', e);
    }
    if (!window.YouTubePlusChannelStatsHelpers) {
      window.YouTubePlusChannelStatsHelpers = {
        async fetchWithRetry(fetchFn, maxRetries = 2, logger = console) {
          let attempt = 0;
          while (attempt <= maxRetries) {
            try {
              // Allow fetchFn to be an async function returning parsed JSON
              const res = await fetchFn();
              return res;
            } catch (err) {
              attempt += 1;
              if (attempt > maxRetries) {
                logger &&
                  logger.warn &&
                  logger.warn('[ChannelStatsHelpers] fetch failed after retries', err);
                return null;
              }
              // backoff
              await new Promise(r => setTimeout(r, 300 * attempt));
            }
          }
          return null;
        },
        cacheStats(mapLike, channelId, stats) {
          try {
            if (!mapLike || typeof mapLike.set !== 'function') return;
            mapLike.set(channelId, stats);
          } catch {
            /* empty */
          }
        },
        getCachedStats(mapLike, channelId, cacheDuration = 60000) {
          try {
            if (!mapLike || typeof mapLike.get !== 'function') return null;
            const s = mapLike.get(channelId);
            if (!s) return null;
            if (s.timestamp && Date.now() - s.timestamp > cacheDuration) return null;
            return s;
          } catch {
            return null;
          }
        },
        extractSubscriberCountFromPage() {
          try {
            const el = qs('yt-formatted-string#subscriber-count') || qs('[id*="subscriber-count"]');
            if (!el) return 0;
            const txt = el.textContent || '';
            const digits = txt.replace(/[^0-9]/g, '');
            return digits ? parseInt(digits, 10) : 0;
          } catch {
            return 0;
          }
        },
        createFallbackStats(followerCount = 0) {
          return {
            followerCount: followerCount || 0,
            bottomOdos: [0, 0],
            error: true,
            timestamp: Date.now(),
          };
        },
      };
    }
  }
})();
