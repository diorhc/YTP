// Shared utilities for YouTube+ modules
(function () {
  'use strict';

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
    return /** @type {Element|null} */ (document.getElementById(id));
  };

  // --- Shared translation helper (canonical) ---
  /**
   * Translation helper with fallback interpolation
   * @param {string} key - Translation key
   * @param {Object<string, string|number>} [params] - Interpolation parameters
   * @returns {string}
   */
  const t = (key, params = {}) => {
    if (window.YouTubePlusI18n?.t) return window.YouTubePlusI18n.t(key, params);
    if (!key) return '';
    let result = String(key);
    for (const [k, v] of Object.entries(params || {})) {
      const token = `{${k}}`;
      result = result.split(token).join(String(v));
    }
    return result;
  };

  /**
   * Unified language getter for modules that rely on YouTubeUtils.
   * @returns {string}
   */
  const getLanguage = () => {
    if (window.YouTubePlusI18n?.getLanguage) {
      return window.YouTubePlusI18n.getLanguage();
    }
    const htmlLang = document.documentElement?.lang || navigator.language || 'en';
    return String(htmlLang || 'en').toLowerCase();
  };

  /**
   * Unified safe HTML setter. Canonical impl: YouTubeSafeDOM.setHTML
   * (Trusted Types-aware). Falls back to _ytpDefaults.setSafeHTML which in
   * turn falls back to a textContent assignment when SafeDOM is not loaded.
   * @param {Element} element
   * @param {string} html
   * @param {boolean} [sanitize=true]
   */
  const setSafeHTML = (element, html, sanitize = true) => {
    if (!(element instanceof HTMLElement)) return;
    if (window.YouTubeSafeDOM?.setHTML) {
      window.YouTubeSafeDOM.setHTML(element, html, { sanitize });
      return;
    }
    window._ytpDefaults?.setSafeHTML?.(element, html, sanitize);
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
      const host = String(location.hostname || '').toLowerCase();
      return host === 'studio.youtube.com' || host.endsWith('.studio.youtube.com');
    } catch (e) {
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
    } catch (e) {
      // Non-critical, suppressed
    }
    return defaultValue;
  };

  /**
   * Resolve pathname from URL-like input or current location.
   * @param {string} [urlLike]
   * @returns {string}
   */
  const getPathname = urlLike => {
    try {
      if (urlLike) return new URL(urlLike, window.location.origin).pathname || '';
      return window.location.pathname || '';
    } catch (e) {
      return '';
    }
  };

  /**
   * Check if a URL/current page is a watch page.
   * @param {string} [urlLike]
   * @returns {boolean}
   */
  const isWatchPage = urlLike => getPathname(urlLike) === '/watch';

  /**
   * Check if a URL/current page is a shorts page.
   * @param {string} [urlLike]
   * @returns {boolean}
   */
  const isShortsPage = urlLike => getPathname(urlLike).startsWith('/shorts');

  /**
   * Check if a URL/current page is a channel page.
   * @param {string} [urlLike]
   * @returns {boolean}
   */
  const isChannelPage = urlLike => {
    const pathname = getPathname(urlLike);
    return (
      pathname.startsWith('/@') || pathname.startsWith('/channel/') || pathname.startsWith('/c/')
    );
  };

  /**
   * Format seconds to time string (H:MM:SS or M:SS).
   * @param {number} seconds
   * @returns {string}
   */
  const formatTime = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const totalSeconds = Math.floor(seconds);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  /**
   * Run callback when DOM is ready.
   * @param {() => void} cb
   * @returns {void}
   */
  const onDomReady = cb => {
    if (typeof cb !== 'function') return;
    if (document.readyState !== 'loading') {
      cb();
      return;
    }
    document.addEventListener('DOMContentLoaded', cb, { once: true });
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

      window.console.error(`[YouTube+][${module}] ${message}:`, error);
      // Use window.console.warn for detailed debug-like information to satisfy lint rules
      window.console.warn('[YouTube+] Error details:', errorDetails);
    } catch (loggingError) {
      // Fallback if logging itself fails
      window.console.error('[YouTube+] Error logging failed:', loggingError);
    }
  };

  /**
   * Lightweight logger that respects a global debug flag.
   * Use YouTubeUtils.logger.debug/info(...) in modules instead of window.console.log for
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
      } catch (e) {
        return false;
      }
    })();

    return {
      debug: function (/** @type {any[]} */ ...args) {
        // Route debug/info level messages to window.console.warn to avoid eslint no-console warnings
        if (isDebugEnabled && window.console?.warn) {
          window.console.warn('[YouTube+][DEBUG]', ...args);
        }
      },
      info: function (/** @type {any[]} */ ...args) {
        if (isDebugEnabled && window.console?.warn) {
          window.console.warn('[YouTube+][INFO]', ...args);
        }
      },
      warn: function (/** @type {any[]} */ ...args) {
        if (window.console?.warn) {
          window.console.warn('[YouTube+]', ...args);
        }
      },
      error: function (/** @type {any[]} */ ...args) {
        if (window.console?.error) {
          window.console.error('[YouTube+]', ...args);
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
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timeout = null;
    /** @type {any[]|null} */
    let lastArgs = null;
    /** @type {any} */
    let lastThis = null;
    let isDestroyed = false;

    /** @this {any} */
    const debounced = function (/** @type {any[]} */ ...args) {
      if (isDestroyed) return;

      lastArgs = args;
      lastThis = this;

      if (timeout !== null) clearTimeout(timeout);

      if (options.leading && timeout === null) {
        try {
          /** @type {Function} */ (fn).apply(this, args);
        } catch (e) {
          window.console.error('[YouTube+] Debounced function error:', e);
        }
      }

      timeout = setTimeout(() => {
        if (!isDestroyed && !options.leading) {
          try {
            /** @type {Function} */ (fn).apply(lastThis, lastArgs);
          } catch (e) {
            window.console.error('[YouTube+] Debounced function error:', e);
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
    /** @type {any} */
    let lastResult;
    /** @this {any} */
    const throttled = function (/** @type {any[]} */ ...args) {
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
    const STYLE_HOST_ID = 'youtube-plus-styles';
    const styles = new Map();
    /** @type {HTMLStyleElement | null} */
    let element = null;

    const ensureElement = () => {
      if (element?.isConnected) return element;
      const existing = /** @type {HTMLStyleElement | null} */ (
        document.getElementById(STYLE_HOST_ID)
      );
      if (existing) {
        element = existing;
        return element;
      }
      if (!document.head && !document.documentElement) return null;
      const created = document.createElement('style');
      created.id = STYLE_HOST_ID;
      created.type = 'text/css';
      (document.head || document.documentElement).appendChild(created);
      element = created;
      return element;
    };

    const render = () => {
      try {
        const host = ensureElement();
        if (!host) {
          document.addEventListener(
            'DOMContentLoaded',
            () => {
              const lateHost = ensureElement();
              if (lateHost) lateHost.textContent = Array.from(styles.values()).join('\n\n');
            },
            { once: true }
          );
          return;
        }
        host.textContent = Array.from(styles.values()).join('\n\n');
      } catch (e) {
        logError('StyleManager', 'render failed', e);
      }
    };

    return {
      styles,
      add(/** @type {string} */ id, /** @type {string} */ css) {
        try {
          if (typeof id !== 'string' || !id) return;
          if (typeof css !== 'string') return;
          styles.set(id, css);
          render();
        } catch (e) {
          logError('StyleManager', 'add failed', e);
        }
      },
      remove(/** @type {string} */ id) {
        try {
          styles.delete(id);
          render();
        } catch (e) {
          logError('StyleManager', 'remove failed', e);
        }
      },
      clear() {
        try {
          styles.clear();
          if (element) {
            element.remove();
            element = null;
          }
        } catch (e) {
          logError('StyleManager', 'clear failed', e);
        }
      },
    };
  })();

  /**
   * Efficient event delegation is owned by event-delegation.js
   * (window.YouTubePlusEventDelegation). The legacy inline copy that used to
   * live here was unused dead code and has been removed.
   */

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
            } catch (e) {
              // Non-critical, suppressed
            }
          }
        } catch (e) {
          // Non-critical, suppressed
        }
        return o;
      },
      registerListener(
        /** @type {EventTarget} */ target,
        /** @type {string} */ ev,
        /** @type {EventListenerOrEventListenerObject} */ fn,
        /** @type {AddEventListenerOptions|boolean|undefined} */ opts
      ) {
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
        } catch (e) {
          return { active: 0, registeredTotal: 0 };
        }
      },
      registerInterval(/** @type {ReturnType<typeof setInterval>} */ id) {
        intervals.add(id);
        return id;
      },
      registerTimeout(/** @type {ReturnType<typeof setTimeout>} */ id) {
        timeouts.add(id);
        return id;
      },
      registerAnimationFrame(/** @type {number} */ id) {
        animationFrames.add(id);
        return id;
      },
      register(/** @type {Function} */ cb) {
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
            } catch (e) {
              // Non-critical, suppressed
            }
          }
          observers.clear();

          // Also attempt to disconnect observers associated with elements
          try {
            // We cannot iterate WeakMap keys; instead we iterate observers set already
            // which covers all observers registered via registerObserver above.
          } catch (e) {
            // Non-critical, suppressed
          }
          for (const keyEntry of listeners.values()) {
            try {
              keyEntry.target.removeEventListener(keyEntry.ev, keyEntry.fn, keyEntry.opts);
            } catch (e) {
              // Non-critical, suppressed
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
            } catch (e) {
              // Non-critical, suppressed
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
          } catch (e) {
            // Non-critical, suppressed
          }
          observers.delete(o);
          // remove from any element sets
          try {
            // Can't iterate WeakMap directly; attempt best-effort sweep by checking
            // known element keys via listeners map as a hint (not comprehensive).
            // This is a noop if not found; primary removal is from observers set.
          } catch (e) {
            // Non-critical, suppressed
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

  const createElement = (
    /** @type {string} */ tag,
    /** @type {Record<string, unknown>} */ props = {},
    /** @type {(string | Node)[]} */ children = []
  ) => {
    try {
      const element = document.createElement(tag);
      Object.entries(props).forEach(([k, v]) => {
        if (k === 'className') element.className = String(v);
        else if (k === 'style' && typeof v === 'object') {
          Object.assign(element.style, v);
        } else if (k === 'dataset' && typeof v === 'object') {
          Object.assign(element.dataset, v);
        } else if (k.startsWith('on') && typeof v === 'function') {
          element.addEventListener(k.slice(2), /** @type {EventListener} */ (v));
        } else element.setAttribute(k, String(v));
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

  const waitForElement = (
    /** @type {string} */ selector,
    /** @type {number} */ timeout = 5000,
    /** @type {Element|Document} */ parent = document
  ) =>
    new Promise((resolve, reject) => {
      if (!selector || typeof selector !== 'string') return reject(new Error('Invalid selector'));
      /** @type {string | null} */
      let subId = null;
      /** @type {ReturnType<typeof setInterval> | null} */
      let fallbackTimer = null;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timeoutTimer = null;

      const finalize = () => {
        if (subId && window.YouTubeMutationCoordinator?.unsubscribe) {
          try {
            window.YouTubeMutationCoordinator.unsubscribe(subId);
          } catch (e) {
            // Non-critical, suppressed
          }
        }
        subId = null;
        if (fallbackTimer) {
          clearInterval(fallbackTimer);
          fallbackTimer = null;
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
      };

      const tryResolve = () => {
        const el = parent.querySelector(selector);
        if (!el) return false;
        finalize();
        resolve(el);
        return true;
      };

      try {
        if (tryResolve()) return;
      } catch (e) {
        return reject(e);
      }

      const coordinator = window.YouTubeMutationCoordinator;
      if (coordinator?.watchTarget && parent instanceof Node) {
        subId = `utils::waitForElement::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`;
        coordinator.watchTarget(
          subId,
          parent,
          () => {
            try {
              tryResolve();
            } catch (e) {
              finalize();
              reject(e);
            }
          },
          { childList: true, attributes: false, subtree: true }
        );
      } else {
        // Fallback for browsers/environments without the shared mutation coordinator.
        fallbackTimer = setInterval(() => {
          try {
            tryResolve();
          } catch (e) {
            finalize();
            reject(e);
          }
        }, 120);
      }

      timeoutTimer = setTimeout(() => {
        finalize();
        reject(new Error('timeout'));
      }, timeout);
      cleanupManager.registerTimeout(timeoutTimer);
    });

  /**
   * Sanitize HTML string to prevent XSS attacks. Canonical impl:
   * YouTubeSafeDOM.sanitizeHTML. This wrapper exists for callers that
   * captured a reference to YouTubeUtils.sanitizeHTML before SafeDOM loaded;
   * we delegate at call time so there is only one sanitizer in the system.
   * @param {string} html
   * @returns {string}
   */
  const sanitizeHTML = html => {
    if (typeof html !== 'string') return '';
    if (window.YouTubeSafeDOM?.sanitizeHTML) {
      return window.YouTubeSafeDOM.sanitizeHTML(html);
    }
    // Conservative pre-SafeDOM fallback (only hit during very early boot).
    if (html.length > 1000000) html = html.substring(0, 1000000);
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
    } catch (e) {
      return false;
    }
  };

  /**
   * Safely merge objects without prototype pollution
   * Prevents __proto__, constructor, and prototype pollution attacks
   * @param {Record<string, unknown>} target - Target object
   * @param {Record<string, unknown>} source - Source object to merge
   * @returns {Record<string, unknown>} Merged target object
   */
  const safeMerge = (
    /** @type {Record<string, unknown>} */ target,
    /** @type {Record<string, unknown>} */ source
  ) => {
    if (!source || typeof source !== 'object') return target;
    if (!target || typeof target !== 'object') return target;

    // List of dangerous keys that could lead to prototype pollution
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

    for (const key in source) {
      // Skip inherited properties
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;

      // Skip dangerous keys
      if (dangerousKeys.includes(key)) {
        window.console.warn(`[YouTube+][Security] Blocked attempt to set dangerous key: ${key}`);
        continue;
      }

      // Only copy own enumerable properties
      const value = source[key];

      // Deep clone objects (one level deep for safety)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] = safeMerge(
          /** @type {Record<string, unknown>} */ (target[key] || {}),
          /** @type {Record<string, unknown>} */ (value)
        );
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
      } catch (e) {
        return false;
      }
    },
  };

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
     * @param {{debounce?: number, throttle?: number, runInitial?: boolean}} [options] - Options
     * @returns {Function} Cleanup function
     */
    const addScrollListener = (
      /** @type {Element} */ element,
      /** @type {Function} */ callback,
      /** @type {{debounce?: number, throttle?: number, runInitial?: boolean}} */ options = {}
    ) => {
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
        element.addEventListener('scroll', /** @type {EventListener} */ (handler), {
          passive: true,
        });

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
            element.removeEventListener('scroll', /** @type {EventListener} */ (handler));
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
    const removeAllListeners = (/** @type {Element} */ element) => {
      try {
        const set = listeners.get(element);
        if (!set) return;

        set.forEach((/** @type {any} */ handler) => {
          try {
            element.removeEventListener('scroll', /** @type {EventListener} */ (handler));
          } catch (e) {
            // Non-critical, suppressed
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
    const scrollToTop = (
      /** @type {Element & {scrollTop: number, scrollTo: Function}} */ element,
      /** @type {{duration?: number, easing?: string}} */ options = {}
    ) => {
      const { duration = 300, easing = 'ease-out' } = options;

      try {
        // Try native smooth scroll first
        if ('scrollBehavior' in /** @type {any} */ (document.documentElement.style || {})) {
          element.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        // Fallback to manual animation
        const start = element.scrollTop;
        const startTime = performance.now();

        const scroll = (/** @type {number} */ currentTime) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);

          // Easing function
          const easeOutQuad = (/** @type {number} */ t) => t * (2 - t);
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
      const result = /** @type {any} */ (_origPush).apply(this, arguments);
      try {
        window.dispatchEvent(
          new CustomEvent('ytp-history-navigate', { detail: { type: 'pushState' } })
        );
      } catch (e) {
        window.console.warn('[YouTube+] pushState event error:', e);
      }
      return result;
    };
    history.replaceState = function () {
      const result = /** @type {any} */ (_origReplace).apply(this, arguments);
      try {
        window.dispatchEvent(
          new CustomEvent('ytp-history-navigate', { detail: { type: 'replaceState' } })
        );
      } catch (e) {
        window.console.warn('[YouTube+] replaceState event error:', e);
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
   * @param {string} [opts.label] - Diagnostic label
   * @returns {{ stop: () => void }} Control handle
   */
  const createRetryScheduler = opts => {
    const { check, maxAttempts = 20, interval = 250, onGiveUp, label } = opts;
    let attempts = 0;
    /** @type {ReturnType<typeof setTimeout>|null} */
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
        } catch (e) {
          // Non-critical, suppressed
        }
      }
      try {
        if (check()) {
          stopped = true;
          if (_hasPerfApi) {
            try {
              performance.mark(`ytp:${_label}:success`);
            } catch (e) {
              // Non-critical, suppressed
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
          } catch (e) {
            // Non-critical, suppressed
          }
        }
        if (typeof onGiveUp === 'function') {
          try {
            onGiveUp();
          } catch (e) {
            // Non-critical, suppressed
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

  /**
   * Creates a visibility-aware interval that pauses while the tab is hidden.
   * @param {() => void} callback
   * @param {number} delay
   * @param {{ label?: string }} [options]
   * @returns {{ stop: () => void, pause: () => void, resume: () => void, active: boolean }}
   */
  const createVisibilityAwareInterval = (callback, delay, options = {}) => {
    const label = options.label || 'visibility-interval';
    /** @type {ReturnType<typeof setInterval>|null} */
    let intervalId = null;
    let stopped = false;

    const tick = () => {
      if (stopped || (typeof document !== 'undefined' && document.hidden)) return;
      try {
        callback();
      } catch (e) {
        logError('VisibilityInterval', `${label} tick failed`, e);
      }
    };

    const pause = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const resume = () => {
      if (stopped || intervalId !== null) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      // setInterval is intentional here: we need pause/resume semantics across visibility changes.
      intervalId = setInterval(tick, delay);
      if (typeof cleanupManager?.registerInterval === 'function') {
        cleanupManager.registerInterval(intervalId);
      }
    };

    const visibilityHandler = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) pause();
      else resume();
    };

    if (typeof cleanupManager?.registerListener === 'function' && typeof document !== 'undefined') {
      cleanupManager.registerListener(document, 'visibilitychange', visibilityHandler, {
        passive: true,
      });
    } else if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', visibilityHandler, { passive: true });
    }

    resume();

    return {
      stop() {
        stopped = true;
        pause();
      },
      pause,
      resume,
      get active() {
        return intervalId !== null;
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
        window.console.warn('[YouTube+ Diagnostics] ObserverRegistry:', stats);
        if (cmStats) window.console.warn('[YouTube+ Diagnostics] CleanupManager:', cmStats);
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
   * @returns {{ isEnabled: () => boolean, setEnabled: (v: boolean) => void, onChange: (cb: (enabled: boolean) => void) => () => void, reload: () => void }}
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
        } catch (e) {
          // Storage write failure — state still updated in memory
        }
        // Notify listeners
        for (const cb of _listeners) {
          try {
            cb(_enabled);
          } catch (e) {
            // Non-critical, suppressed
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
    const winGlobal = /** @type {any} */ (window);
    if (!winGlobal.YouTubeUtils) winGlobal.YouTubeUtils = {};
    const U = /** @type {any} */ (winGlobal.YouTubeUtils);
    U.logError = U.logError || logError;
    U.debounce = U.debounce || debounce;
    U.throttle = U.throttle || throttle;
    U.StyleManager = U.StyleManager || StyleManager;
    U.cleanupManager = U.cleanupManager || cleanupManager;
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
    if (typeof U.createVisibilityAwareInterval !== 'function') {
      U.createVisibilityAwareInterval = createVisibilityAwareInterval;
    }
    U.ObserverRegistry = U.ObserverRegistry || ObserverRegistry;
    // Shared DOM helpers — modules can use YouTubeUtils.$ instead of local copies
    U.$ = U.$ || $;
    U.$$ = U.$$ || $$;
    U.byId = U.byId || byId;
    U.t = U.t || t;
    U.getLanguage = U.getLanguage || getLanguage;
    U.setSafeHTML = U.setSafeHTML || setSafeHTML;
    U.onDomReady = U.onDomReady || onDomReady;
    U.loadFeatureEnabled = U.loadFeatureEnabled || loadFeatureEnabled;
    U.isWatchPage = U.isWatchPage || isWatchPage;
    U.isShortsPage = U.isShortsPage || isShortsPage;
    U.isChannelPage = U.isChannelPage || isChannelPage;
    U.formatTime = U.formatTime || formatTime;
    U.createFeatureToggle = U.createFeatureToggle || createFeatureToggle;
    U.SETTINGS_KEY = U.SETTINGS_KEY || SETTINGS_KEY;
    U.isStudioPage = U.isStudioPage || isStudioPage;

    // Dev-only diagnostics — call window.__ytpDiagnostics() in browser console
    if (!window.__ytpDiagnostics) {
      window.__ytpDiagnostics = function (/** @type {boolean|undefined} */ verbose) {
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
            /** @type {Record<string, {attempts: number, success: boolean, giveup: boolean}>} */
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
        } catch (e) {
          // Non-critical, suppressed
        }

        const report = {
          observers: obs,
          cleanupManager: cm,
          retrySchedulers: retryMetrics,
          timestamp: new Date().toISOString(),
        };
        window.console.warn('[YouTube+ Diagnostics] Observers:', obs);
        window.console.warn('[YouTube+ Diagnostics] CleanupManager:', cm);
        if (retryMetrics) {
          window.console.warn('[YouTube+ Diagnostics] RetrySchedulers:', retryMetrics);
        }
        if (verbose) window.console.warn('[YouTube+ Diagnostics]', JSON.stringify(report, null, 2));
        return report;
      };
    }

    // Provide lightweight channel stats helpers if not defined by other modules.
    U.channelStatsHelpers = U.channelStatsHelpers || null;
    // Wrap global timer functions to auto-register with cleanupManager for safe cleanup.
    try {
      const w = /** @type {any} */ (window);
      if (w && !w.__ytp_timers_wrapped) {
        const origSetTimeout = w.setTimeout.bind(w);
        const origSetInterval = w.setInterval.bind(w);
        const origRaf = w.requestAnimationFrame ? w.requestAnimationFrame.bind(w) : null;

        w.setTimeout = function (
          /** @type {any} */ fn,
          /** @type {any} */ ms,
          /** @type {any[]} */ ...args
        ) {
          const id = origSetTimeout(fn, ms, ...args);
          try {
            U.cleanupManager.registerTimeout(id);
          } catch (e) {
            // Non-critical, suppressed
          }
          return id;
        };

        // Keep a global setInterval wrapper so every timer is auto-registered for SPA cleanup.
        w.setInterval = function (
          /** @type {any} */ fn,
          /** @type {any} */ ms,
          /** @type {any[]} */ ...args
        ) {
          const id = origSetInterval(fn, ms, ...args);
          try {
            U.cleanupManager.registerInterval(id);
          } catch (e) {
            // Non-critical, suppressed
          }
          return id;
        };

        if (origRaf) {
          w.requestAnimationFrame = function (/** @type {FrameRequestCallback} */ cb) {
            const id = origRaf(cb);
            try {
              U.cleanupManager.registerAnimationFrame(id);
            } catch (e) {
              // Non-critical, suppressed
            }
            return id;
          };
        }

        w.__ytp_timers_wrapped = true;
      }
    } catch (e) {
      logError('utils', 'timer wrapper failed', e);
    }

    // Auto-cleanup on SPA navigation — prevents listener and timer leaks between pages
    try {
      const navCleanupHost = /** @type {any} */ (window);
      if (!navCleanupHost.__ytp_nav_cleanup_registered) {
        navCleanupHost.__ytp_nav_cleanup_registered = true;
        document.addEventListener('yt-navigate-start', () => {
          try {
            U.cleanupManager.cleanup();
          } catch (e) {
            // Non-critical: cleanup best-effort on navigation
          }
        });
      }
    } catch (e) {
      // Non-critical: navigation cleanup hook failed to register
    }

    if (!window.YouTubePlusChannelStatsHelpers) {
      window.YouTubePlusChannelStatsHelpers = {
        async fetchWithRetry(
          /** @type {() => Promise<any>} */ fetchFn,
          maxRetries = 2,
          logger = console
        ) {
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
        cacheStats(
          /** @type {any} */ mapLike,
          /** @type {string} */ channelId,
          /** @type {any} */ stats
        ) {
          try {
            if (!mapLike || typeof mapLike.set !== 'function') return;
            mapLike.set(channelId, stats);
          } catch (e) {
            // Non-critical, suppressed
          }
        },
        getCachedStats(
          /** @type {any} */ mapLike,
          /** @type {string} */ channelId,
          cacheDuration = 60000
        ) {
          try {
            if (!mapLike || typeof mapLike.get !== 'function') return null;
            const s = mapLike.get(channelId);
            if (!s) return null;
            if (s.timestamp && Date.now() - s.timestamp > cacheDuration) return null;
            return s;
          } catch (e) {
            return null;
          }
        },
        extractSubscriberCountFromPage() {
          try {
            const el = $('yt-formatted-string#subscriber-count') || $('[id*="subscriber-count"]');
            if (!el) return 0;
            const txt = el.textContent || '';
            const digits = txt.replace(/[^0-9]/g, '');
            return digits ? parseInt(digits, 10) : 0;
          } catch (e) {
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
