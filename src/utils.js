// YouTube+ utils.js - compatibility facade only.
//
// This file is a THIN compatibility layer. It exposes the canonical
// YouTube+ modules and a small set of compat shims under
// `window.YouTubeUtils`, and runs the cross-cutting side effects that
// have no better canonical home.
//
// Canonical owners live in their own modules. New shared logic MUST
// be added to the correct canonical module, NOT here:
//
//   - logger.js                 -> canonical logging
//   - design-system.js          -> canonical styles / StyleManager
//   - i18n.js                   -> canonical translation
//   - safe-dom.js               -> canonical safe HTML
//   - settings-helpers.js       -> canonical settings store
//   - dom-cache.js              -> canonical DOM query / wait / cache
//   - mutation-coordinator.js   -> canonical mutation lifecycle
//   - event-delegation.js       -> canonical delegated events
//   - cleanup-manager.js        -> canonical SPA-resource cleanup
//   - performance.js            -> diagnostics / profiling
//
// utils.js (this file) is allowed to:
//   1. Proxy to canonical owners (preferred).
//   2. Expose back-compat aliases for properties that were historically
//      on `window.YouTubeUtils` and may be captured by reference at
//      module load time, before the canonical module is defined.
//   3. Define local compat shims for utilities that have no canonical
//      owner yet (debounce, throttle, safeMerge, storage, etc.).
//   4. Run cross-cutting side effects (history / timer wrapping, SPA
//      nav cleanup, dev diagnostics) that no single canonical owns.
//
// It is NOT allowed to:
//   - Implement shared logic that belongs in a canonical module.
//   - Add new utilities here to avoid touching the canonical owners.

// @ts-check
(function () {
  if (typeof window === 'undefined') return;

  // ---------------------------------------------------------------------------
  // User configuration — YouTubePlusConfig
  // ---------------------------------------------------------------------------
  // Provides a stable, frozen config object that users can override by
  // setting window.YouTubePlusConfig before the script loads. Read by
  // performance.js, zoom.js, and createLogger below.
  if (!window.YouTubePlusConfig) {
    window.YouTubePlusConfig = Object.freeze({
      enabled: true,
      downloaders: { y2mate: true, xbbuddy: true },
      debug: false,
      performance: { sampleRate: 0.01 },
    });
  }

  // ---------------------------------------------------------------------------
  // Scroll Manager — centralized debounced scroll listener registry
  // ---------------------------------------------------------------------------
  // Provides addScrollListener / removeAllListeners so modules don't
  // each create their own debounced scroll handlers on the same element.
  if (!window.YouTubePlusScrollManager) {
    /** @type {Map<Element, { handler: EventListener, cleanup: Function }[]>} */
    const scrollListeners = new Map();
    /**
     * @typedef {Object} ScrollManagerAPI
     * @property {(target: Element, callback: Function, opts?: { debounce?: number, runInitial?: boolean }) => () => void} addScrollListener - Add a debounced scroll listener
     * @property {(target: Element) => void} removeAllListeners - Remove all scroll listeners for a target
     */
    /** @type {ScrollManagerAPI} */
    window.YouTubePlusScrollManager = {
      /**
       * Add a debounced scroll listener to an element.
       * @param {Element} target - DOM element to listen on
       * @param {Function} callback - Scroll handler
       * @param {{ debounce?: number, runInitial?: boolean }} [opts={}] - Options
       * @returns {() => void} Cleanup function to remove the listener
       */
      addScrollListener(
        /** @type {Element} */ target,
        /** @type {Function} */ callback,
        /** @type {Record<string, any>} */ opts = {}
      ) {
        const debounceMs = /** @type {number} */ (opts.debounce) || 100;
        /** @type {ReturnType<typeof setTimeout>|null} */
        let timer = null;
        const handler = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => callback(), debounceMs);
        };
        target.addEventListener('scroll', handler, { passive: true });
        if (!scrollListeners.has(target)) scrollListeners.set(target, []);
        const entry = {
          handler,
          cleanup: () => {
            target.removeEventListener('scroll', handler);
            if (timer) clearTimeout(timer);
          },
        };
        /** @type {{ handler: EventListener, cleanup: Function }[]} */ (
          scrollListeners.get(target)
        ).push(entry);
        if (opts.runInitial) callback();
        return entry.cleanup;
      },
      /**
       * Remove all scroll listeners for a given element.
       * @param {Element} target - DOM element to clean up
       */
      removeAllListeners(/** @type {Element} */ target) {
        const entries = scrollListeners.get(target);
        if (!entries) return;
        for (const e of entries) e.cleanup();
        scrollListeners.delete(target);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Storage — unified localStorage wrapper with JSON parse/stringify
  // ---------------------------------------------------------------------------
  // Provides a stable storage API that basic.js and other modules can
  // use as a fallback when YouTubePlusSettingsStore is unavailable.
  if (!window.YouTubePlusStorage) {
    /**
     * @typedef {Object} StorageAPI
     * @property {(key: string, defaultValue?: any) => any} get - Get a value from localStorage (JSON-parsed)
     * @property {(key: string, value: any) => boolean} set - Set a value in localStorage (JSON-stringified)
     * @property {(key: string) => boolean} remove - Remove a key from localStorage
     */
    /** @type {StorageAPI} */
    window.YouTubePlusStorage = {
      /**
       * Get a value from localStorage by key.
       * @param {string} key - Storage key
       * @param {any} [defaultValue=null] - Default if key is missing or unparseable
       * @returns {any} Parsed value or defaultValue
       */
      get(/** @type {string} */ key, /** @type {any} */ defaultValue = null) {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : defaultValue;
        } catch (_e) {
          return defaultValue;
        }
      },
      set(/** @type {string} */ key, /** @type {any} */ value) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
          return true;
        } catch (_e) {
          return false;
        }
      },
      /**
       * Remove a key from localStorage.
       * @param {string} key - Storage key
       * @returns {boolean} True on success
       */
      remove(/** @type {string} */ key) {
        try {
          localStorage.removeItem(key);
          return true;
        } catch (_e) {
          return false;
        }
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Settings modal detection — shared across modules
  // ---------------------------------------------------------------------------
  if (typeof window.YouTubeUtils === 'undefined')
    window.YouTubeUtils = /** @type {YouTubeUtils} */ ({});
  const _U = window.YouTubeUtils;
  if (!_U.isSettingsModalOpen) {
    _U.isSettingsModalOpen = () => {
      try {
        return Boolean(document.querySelector('.ytp-plus-settings-modal'));
      } catch (_e) {
        return false;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Route-matching primitives — shared across modules
  // ---------------------------------------------------------------------------
  if (!_U.isYouTubeDomain) {
    _U.isYouTubeDomain = () => {
      try {
        const host = window.location.hostname || '';
        return host.endsWith('youtube.com') && host !== 'music.youtube.com';
      } catch (_e) {
        return false;
      }
    };
  }
  if (!_U.isWatchRoute) {
    _U.isWatchRoute = () => {
      try {
        return window.location.pathname === '/watch';
      } catch (_e) {
        return false;
      }
    };
  }
  if (!_U.isShortsRoute) {
    _U.isShortsRoute = () => {
      try {
        return window.location.pathname.startsWith('/shorts');
      } catch (_e) {
        return false;
      }
    };
  }
  if (!_U.isChannelRoute) {
    _U.isChannelRoute = () => {
      try {
        const p = window.location.pathname || '';
        return p.startsWith('/channel/') || p.startsWith('/@') || p.startsWith('/c/');
      } catch (_e) {
        return false;
      }
    };
  }
  if (!_U.getHostname) {
    _U.getHostname = () => {
      try {
        return window.location.hostname || '';
      } catch (_e) {
        return '';
      }
    };
  }
  if (!_U.isMusicDomain) {
    _U.isMusicDomain = () => _U.getHostname() === 'music.youtube.com';
  }
  if (!_U.isStudioDomain) {
    _U.isStudioDomain = () => _U.getHostname() === 'studio.youtube.com';
  }

  // ---------------------------------------------------------------------------
  // Non-critical error logging — replaces bare "Non-critical, suppressed" catches
  // ---------------------------------------------------------------------------
  if (!_U.logSuppressed) {
    /**
     * Logs a non-critical error to the error boundary. Use in catch blocks
     * that intentionally swallow errors but should still be tracked.
     * @param {unknown} error
     * @param {string} module
     * @param {string} [message]
     */
    _U.logSuppressed = (error, module, message) => {
      try {
        const eb = window.YouTubePlusErrorBoundary;
        if (eb?.logError) {
          const err = error instanceof Error ? error : new Error(String(error));
          eb.logError(err, { module, message: message || 'Non-critical, suppressed' });
        }
      } catch (_e) {
        /* never break error reporting */
      }
    };
  }

  // ---------------------------------------------------------------------------
  // youtubePlus — early stub for legacy cross-module settings bridge
  // ---------------------------------------------------------------------------
  // modal-handlers.js and shorts.js read window.youtubePlus.settings
  // and window.youtubePlus.rebuildDownloadDropdown. basic.js and
  // download.js lazily populate this object later; defining an empty
  // stub early prevents ReferenceError and avoids boot-order coupling.
  if (typeof window !== 'undefined' && !window.youtubePlus) {
    /** @type {any} */ (window).youtubePlus = {};
  }

  // ---------------------------------------------------------------------------
  // Log / error routing — canonical: logger.js
  // ---------------------------------------------------------------------------
  // All log calls go through YouTubePlusLogger. utils.js does not own
  // any logging policy of its own.

  /**
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string} module
   * @param {string} message
   * @param {any} [data]
   */
  const emitCoreLog = (level, module, message, data) => {
    const sink = window.YouTubePlusLogger;
    if (!sink || typeof sink[level] !== 'function') return;
    try {
      if (data === undefined) sink[level](module, message);
      else sink[level](module, message, data);
    } catch {}
  };

  /**
   * Logs an error with structured context. Convention used by every
   * module: YouTubeUtils.logError(module, message, error).
   * @param {string} module
   * @param {string} message
   * @param {Error|*|null|undefined} error
   */
  const logError = (module, message, error) => {
    try {
      const errorDetails = {
        module,
        message,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : error,
        timestamp: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      };
      emitCoreLog('error', module, message, error);
      emitCoreLog('warn', module, 'Error details', errorDetails);
    } catch (loggingError) {
      emitCoreLog('error', 'Utils', 'Error logging failed', loggingError);
    }
  };

  // ---------------------------------------------------------------------------
  // Thin proxies to canonical owners
  // ---------------------------------------------------------------------------
  // Each proxy below is a small wrapper that defers to the canonical
  // module. The wrapper exists so the global is defined even if the
  // canonical module is not yet loaded (utils.js loads first in build
  // order); the wrapper falls through to a tiny built-in fallback if
  // the canonical is missing.

  // -- DOM (canonical: dom-cache.js) -----------------------------------------
  /** @param {string} sel @param {Element|Document} [ctx] */
  const $ = (sel, ctx) => {
    const cache = window.YouTubePlusDOMCache;
    if (cache && typeof cache.querySelector === 'function') return cache.querySelector(sel, ctx);
    if (cache && typeof cache.get === 'function' && !ctx) return cache.get(sel);
    return (ctx || document).querySelector(sel);
  };
  /** @param {string} sel @param {Element|Document} [ctx] */
  const $$ = (sel, ctx) => {
    const cache = window.YouTubePlusDOMCache;
    if (cache && typeof cache.querySelectorAll === 'function') {
      return cache.querySelectorAll(sel, ctx);
    }
    if (cache && typeof cache.getAll === 'function' && !ctx) return cache.getAll(sel);
    return Array.from((ctx || document).querySelectorAll(sel));
  };
  /** @param {string} id */
  const byId = id => {
    const cache = window.YouTubePlusDOMCache;
    if (cache && typeof cache.getElementById === 'function') return cache.getElementById(id);
    return /** @type {Element|null} */ (document.getElementById(id));
  };
  /**
   * Canonical DOMContentLoaded wrapper. Runs the callback
   * synchronously when the document is already past `loading`, so
   * module init can call it unconditionally.
   * @param {() => void} cb
   * @returns {void}
   */
  const onDomReady = cb => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb, { once: true });
    } else {
      cb();
    }
  };
  /**
   * @param {string} selector
   * @param {number} [timeout=5000]
   * @param {Element|Document} [parent=document]
   * @returns {Promise<Element|null>}
   */
  const waitForElement = (selector, timeout = 5000, parent = document) => {
    const cache = /** @type {any} */ (window).YouTubePlusDOMCache;
    return cache?.waitForElement
      ? cache.waitForElement(selector, timeout, parent)
      : Promise.resolve(parent?.querySelector(selector) ?? null);
  };

  // -- i18n (canonical: i18n.js) ----------------------------------------------
  /**
   * @param {string} key
   * @param {Record<string, string|number>} [params]
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
  /** @returns {string} */
  const getLanguage = () => {
    if (window.YouTubePlusI18n?.getLanguage) return window.YouTubePlusI18n.getLanguage();
    const htmlLang = document.documentElement?.lang || navigator.language || 'en';
    return String(htmlLang || 'en').toLowerCase();
  };

  // -- Safe HTML (canonical: safe-dom.js) -------------------------------------
  /** @param {string} html */
  const createHTML = html => {
    if (typeof window._ytplusCreateHTML === 'function') return window._ytplusCreateHTML(html);
    return typeof html === 'string' ? html : String(html ?? '');
  };
  /**
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
    element.replaceChildren(document.createTextNode(String(html || '')));
  };
  /** @param {string} html */
  const sanitizeHTML = html => {
    if (typeof html !== 'string') return '';
    return window.YouTubeSafeDOM?.sanitizeHTML?.(html) ?? '';
  };

  // -- Settings (canonical: settings-helpers.js) ------------------------------
  // SETTINGS_KEY is the canonical storage key. It is exposed for the
  // handful of modules that read the raw shape; new code should go
  // through `YouTubePlusSettingsStore` instead.
  /** @type {string} */
  const SETTINGS_KEY = 'youtube_plus_settings';

  /**
   * Thin compat wrapper around YouTubePlusSettingsStore that returns
   * `true` unless the feature is explicitly set to `false`. Falls
   * back to a direct localStorage read of the canonical key when the
   * store has not yet installed itself (utils.js loads first).
   * @param {string} featureKey
   * @param {boolean} [defaultValue=true]
   * @returns {boolean}
   */
  const loadFeatureEnabled = (featureKey, defaultValue = true) => {
    const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
    if (store && typeof store.get === 'function') {
      const v = store.get(featureKey, defaultValue);
      return v === undefined ? defaultValue : v !== false;
    }
    try {
      const settings = localStorage.getItem(SETTINGS_KEY);
      if (settings) {
        const parsed = JSON.parse(settings);
        return parsed[featureKey] !== false;
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Utils');
    }
    return defaultValue;
  };

  // -- Logger facade (canonical: logger.js) -----------------------------------
  // A small wrapper that respects a `YouTubePlusConfig.debug` /
  // `window.YTP_DEBUG` flag for dev output. warn/error are always
  // emitted through YouTubePlusLogger.
  const createLogger = () => {
    const isDebugEnabled = (() => {
      try {
        if (typeof window === 'undefined') return false;
        const cfg = window.YouTubePlusConfig;
        if (cfg?.debug) return true;
        if (typeof (/** @type {any} */ (window).YTP_DEBUG) !== 'undefined') {
          return !!(/** @type {any} */ (window).YTP_DEBUG);
        }
        return false;
      } catch (_e) {
        return false;
      }
    })();
    return {
      debug: function (/** @type {any[]} */ ...args) {
        if (isDebugEnabled) /** @type {any} */ (emitCoreLog)('debug', ...args);
      },
      info: function (/** @type {any[]} */ ...args) {
        if (isDebugEnabled) /** @type {any} */ (emitCoreLog)('info', ...args);
      },
      warn: function (/** @type {any[]} */ ...args) {
        /** @type {any} */ (emitCoreLog)('warn', ...args);
      },
      error: function (/** @type {any[]} */ ...args) {
        /** @type {any} */ (emitCoreLog)('error', ...args);
      },
    };
  };

  // -- Retry scheduler (canonical: mutation-coordinator.js) ------------------
  /**
   * @param {{ check: () => boolean, maxAttempts?: number, interval?: number, onGiveUp?: () => void, label?: string }} opts
   * @returns {{ stop: () => void } | null}
   */
  const createRetryScheduler = opts => {
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.createRetryScheduler) return coordinator.createRetryScheduler(opts);
    return null;
  };

  // ---------------------------------------------------------------------------
  // Local compat shims (no canonical owner)
  // ---------------------------------------------------------------------------
  // Kept here because no canonical module owns them and existing modules
  // capture references at load time. They are NOT a destination for new
  // shared logic - promote them to a canonical module if they grow.

  /**
   * @template {Function} T
   * @param {T} fn
   * @param {number} ms
   * @param {{ leading?: boolean }} [options={}]
   * @returns {T & { cancel: () => void, destroy: () => void }}
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
          emitCoreLog('error', 'Utils', 'Debounced function error', e);
        }
      }
      timeout = setTimeout(() => {
        if (!(isDestroyed || options.leading)) {
          try {
            /** @type {Function} */ (fn).apply(lastThis, lastArgs);
          } catch (e) {
            emitCoreLog('error', 'Utils', 'Debounced function error', e);
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
   * @template {Function} T
   * @param {T} fn
   * @param {number} limit
   * @returns {T}
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

  /**
   * @param {string} [urlLike]
   * @returns {boolean}
   */
  const isWatchPage = urlLike => {
    try {
      const url = new URL(urlLike || window.location.href);
      return url.pathname === '/watch' || url.pathname.startsWith('/watch/');
    } catch (_e) {
      return false;
    }
  };

  /**
   * @param {string} [urlLike]
   * @returns {boolean}
   */
  const isShortsPage = urlLike => {
    try {
      const url = new URL(urlLike || window.location.href);
      return url.pathname.startsWith('/shorts/');
    } catch (_e) {
      return false;
    }
  };

  /**
   * @param {string} [urlLike]
   * @returns {boolean}
   */
  const isChannelPage = urlLike => {
    try {
      const url = new URL(urlLike || window.location.href);
      const path = url.pathname || '';
      return (
        path.startsWith('/@') ||
        path.startsWith('/channel/') ||
        path.startsWith('/c/') ||
        path.startsWith('/user/')
      );
    } catch (_e) {
      return false;
    }
  };

  /**
   * @returns {boolean}
   */
  const isStudioPage = () => {
    try {
      return _U.isStudioDomain?.() ?? false;
    } catch (_e) {
      return false;
    }
  };

  /**
   * Secure object merge - guards against prototype pollution.
   * @param {Record<string, unknown>} target
   * @param {Record<string, unknown>} source
   * @returns {Record<string, unknown>}
   */
  const safeMerge = (target, source) => {
    if (!source || typeof source !== 'object') return target;
    if (!target || typeof target !== 'object') return target;
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const key in source) {
      if (!Object.hasOwn(source, key)) continue;
      if (dangerousKeys.includes(key)) {
        emitCoreLog('warn', 'Security', `Blocked attempt to set dangerous key: ${key}`);
        continue;
      }
      const value = source[key];
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

  // Non-settings localStorage wrapper. NOT the settings store - that is
  // `YouTubePlusSettingsStore` (settings-helpers.js). This helper validates
  // keys and caps serialized value size, but does not coordinate with any
  // other module.
  const storage = {
    /**
     * @param {string} key
     * @param {*} [def=null]
     * @returns {*}
     */
    get(key, def = null) {
      if (typeof key !== 'string' || !/^[a-zA-Z0-9_\-.]+$/.test(key)) {
        logError('storage', 'Invalid key format', new Error(`Invalid key: ${key}`));
        return def;
      }
      try {
        const v = localStorage.getItem(key);
        if (v === null) return def;
        if (v.length > 5 * 1024 * 1024) {
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
     * @param {string} key
     * @param {*} val
     * @returns {boolean}
     */
    set(key, val) {
      if (typeof key !== 'string' || !/^[a-zA-Z0-9_\-.]+$/.test(key)) {
        logError('storage', 'Invalid key format', new Error(`Invalid key: ${key}`));
        return false;
      }
      try {
        const serialized = JSON.stringify(val);
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
    /** @param {string} key */
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        logError('storage', 'Failed to remove value', e);
      }
    },
    clear() {
      try {
        const ytpPrefixes = ['youtube_plus_', 'youtube_', 'ytp-', 'youtube-plus-'];
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && ytpPrefixes.some(p => key.startsWith(p))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      } catch (e) {
        logError('storage', 'Failed to clear storage', e);
      }
    },
    /** @param {string} key @returns {boolean} */
    has(key) {
      try {
        return localStorage.getItem(key) !== null;
      } catch (_e) {
        return false;
      }
    },
  };

  // ---------------------------------------------------------------------------
  // Diagnostics (no canonical owner; dev-only console helper)
  // ---------------------------------------------------------------------------
  // ObserverRegistry tracks active observer counts. Used by
  // `window.__ytpDiagnostics()` and by zoom.js / enhanced.js.
  const ObserverRegistry = (() => {
    let _active = 0;
    let _peak = 0;
    let _created = 0;
    let _disconnected = 0;
    return {
      track() {
        _active++;
        _created++;
        if (_active > _peak) _peak = _active;
      },
      untrack() {
        _active = Math.max(0, _active - 1);
        _disconnected++;
      },
      getStats() {
        return { active: _active, peak: _peak, created: _created, disconnected: _disconnected };
      },
      reset() {
        _active = 0;
        _peak = 0;
        _created = 0;
        _disconnected = 0;
      },
      dump() {
        const stats = {
          active: _active,
          peak: _peak,
          created: _created,
          disconnected: _disconnected,
        };
        const cmStats = (() => {
          const cm = window.YouTubePlusCleanupManager;
          if (!cm) return null;
          try {
            return {
              observers: cm.observers?.size ?? 'n/a',
              intervals: cm.intervals?.size ?? 'n/a',
              timeouts: cm.timeouts?.size ?? 'n/a',
              listeners: typeof cm.getListenerStats === 'function' ? cm.getListenerStats() : 'n/a',
            };
          } catch (_e) {
            return null;
          }
        })();
        emitCoreLog('warn', 'Diagnostics', 'ObserverRegistry', stats);
        if (cmStats) emitCoreLog('warn', 'Diagnostics', 'CleanupManager', cmStats);
        return { observers: stats, cleanup: cmStats };
      },
    };
  })();

  if (!window.__ytpDiagnostics) {
    window.__ytpDiagnostics = function (/** @type {boolean|undefined} */ verbose) {
      const obs = ObserverRegistry.getStats();
      const cm = (() => {
        const m = window.YouTubePlusCleanupManager;
        if (!m) return null;
        try {
          return {
            observers: m.observers?.size ?? 0,
            listeners:
              typeof m.getListenerStats === 'function'
                ? m.getListenerStats()
                : { active: 0, registeredTotal: 0 },
            intervals: m.intervals?.size ?? 0,
            timeouts: m.timeouts?.size ?? 0,
            animationFrames: m.animationFrames?.size ?? 0,
          };
        } catch (_e) {
          return null;
        }
      })();
      const report = { observers: obs, cleanupManager: cm, timestamp: new Date().toISOString() };
      emitCoreLog('warn', 'Diagnostics', 'Observers', obs);
      if (cm) emitCoreLog('warn', 'Diagnostics', 'CleanupManager', cm);
      if (verbose) emitCoreLog('warn', 'Diagnostics', JSON.stringify(report, null, 2));
      return report;
    };
  }

  // ---------------------------------------------------------------------------
  // Cross-cutting side effect: history.pushState / replaceState wrapping
  // ---------------------------------------------------------------------------
  // Wraps history so modules can subscribe to 'ytp-history-navigate'
  // instead of each wrapping independently. Guarded to run once.

  if (!window.__ytp_history_wrapped) {
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
        emitCoreLog('warn', 'Utils', 'pushState event error', e);
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
        emitCoreLog('warn', 'Utils', 'replaceState event error', e);
      }
      return result;
    };
  }

  /**
   * Format seconds as `H:MM:SS` / `M:SS` for display.
   * @param {number} secs
   * @returns {string}
   */
  const formatTime = secs => {
    const safe = Number.isFinite(secs) && secs > 0 ? secs : 0;
    const s = Math.floor(safe % 60)
      .toString()
      .padStart(2, '0');
    const m = Math.floor((safe / 60) % 60).toString();
    const h = Math.floor(safe / 3600);
    return h ? `${h}:${m.padStart(2, '0')}:${s}` : `${m}:${s}`;
  };

  // ---------------------------------------------------------------------------
  // YouTubeUtils surface
  // ---------------------------------------------------------------------------
  // Each property is set only if not already present so modules that
  // captured a reference at load time keep working through re-evaluation.
  if (!window.YouTubeUtils) window.YouTubeUtils = /** @type {any} */ ({});
  const U = /** @type {any} */ (window.YouTubeUtils);

  // -- Lazy getters (resolve at call time to current canonical state) ------
  if (!Object.getOwnPropertyDescriptor(U, 'StyleManager')) {
    Object.defineProperty(U, 'StyleManager', {
      configurable: true,
      enumerable: true,
      get() {
        return window.YouTubePlusDesignSystem?.StyleManager || null;
      },
    });
  }
  if (!Object.getOwnPropertyDescriptor(U, 'cleanupManager')) {
    Object.defineProperty(U, 'cleanupManager', {
      configurable: true,
      enumerable: true,
      get() {
        return window.YouTubePlusCleanupManager || null;
      },
    });
  }
  if (!Object.getOwnPropertyDescriptor(U, 'throttle')) {
    Object.defineProperty(U, 'throttle', {
      configurable: false,
      enumerable: true,
      get() {
        return throttle;
      },
      set() {},
    });
  }
  if (!Object.getOwnPropertyDescriptor(U, 'safeLS')) {
    U.safeLS = {
      /** @param {string} k @param {string|null} [def] @returns {string|null} */
      getItem: (k, def = null) => {
        try {
          return localStorage.getItem(k) ?? def;
        } catch (_e) {
          return def;
        }
      },
      /** @param {string} k @param {string} v @returns {boolean} */
      setItem: (k, v) => {
        try {
          localStorage.setItem(k, v);
          return true;
        } catch (_e) {
          return false;
        }
      },
      /** @param {string} k */
      removeItem: k => {
        try {
          localStorage.removeItem(k);
        } catch (_e) {
          /* non-critical */
        }
      },
    };
  }

  /**
   * Visibility-aware interval: pauses when the tab is hidden,
   * registers with cleanupManager for SPA navigation cleanup.
   *
   * `resume()` correctly re-creates the interval after `pause()`.
   * The previous implementation had a no-op `resume()` which left
   * background polling dead until page reload — see time.js for
   * the regression history.
   * @param {() => void} callback
   * @param {number} delay
   * @returns {{ stop: () => void; pause: () => void; resume: () => void; active: boolean }}
   */
  const createVisibilityAwareInterval = (callback, delay) => {
    /** @type {ReturnType<typeof setInterval> | null} */
    let id = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    /** @type {ReturnType<typeof setInterval> | number | null} */
    let cmHandle = null;
    let paused = false;
    const cm = window.YouTubeUtils?.cleanupManager || window.YouTubePlusCleanupManager;
    const start = () => {
      if (id !== null) return;
      id = setInterval(() => {
        if (!document.hidden) callback();
      }, delay);
      if (cm && typeof cm.registerInterval === 'function') {
        cmHandle = cm.registerInterval(id);
      }
    };
    start();
    return {
      stop() {
        if (id !== null) {
          clearInterval(id);
          id = null;
        }
        if (cm && cmHandle !== null && typeof cm.unregisterInterval === 'function') {
          try {
            cm.unregisterInterval(cmHandle);
          } catch (_e) {
            /* non-critical */
          }
          cmHandle = null;
        }
      },
      pause() {
        if (id !== null) {
          clearInterval(id);
          id = null;
        }
        paused = true;
      },
      resume() {
        if (id === null && paused) {
          paused = false;
          start();
        }
      },
      get active() {
        return id !== null;
      },
    };
  };

  // -- Plain property assignments (compat surface) --------------------------
  U.logError = U.logError || logError;
  U.debounce = U.debounce || debounce;
  U.waitForElement = U.waitForElement || waitForElement;
  U.storage = U.storage || storage;
  U.sanitizeHTML = U.sanitizeHTML || sanitizeHTML;
  U.safeMerge = U.safeMerge || safeMerge;
  U.renderTemplateClone =
    U.renderTemplateClone ||
    ((/** @type {Element} */ el, /** @type {string} */ html) =>
      window.YouTubeSafeDOM?.renderTemplateClone?.(el, html));
  U.logger = U.logger || createLogger();
  if (typeof U.createRetryScheduler !== 'function') {
    U.createRetryScheduler = createRetryScheduler;
  }
  U.ObserverRegistry = U.ObserverRegistry || ObserverRegistry;
  U.$ = U.$ || $;
  U.$$ = U.$$ || $$;
  U.byId = U.byId || byId;
  U.t = U.t || t;
  U.createHTML = U.createHTML || createHTML;
  U.getLanguage = U.getLanguage || getLanguage;
  U.setSafeHTML = U.setSafeHTML || setSafeHTML;
  U.loadFeatureEnabled = U.loadFeatureEnabled || loadFeatureEnabled;
  U.SETTINGS_KEY = U.SETTINGS_KEY || SETTINGS_KEY;
  U.isWatchPage = U.isWatchPage || isWatchPage;
  U.isShortsPage = U.isShortsPage || isShortsPage;
  U.isChannelPage = U.isChannelPage || isChannelPage;
  U.isStudioPage = U.isStudioPage || isStudioPage;
  U.onDomReady = U.onDomReady || onDomReady;
  U.formatTime = U.formatTime || formatTime;
  U.createVisibilityAwareInterval =
    U.createVisibilityAwareInterval || createVisibilityAwareInterval;

  // -- Cleanup-tracked timer helpers ---------------------------------------
  // Explicit opt-in for modules that want their timers cleared on SPA
  // navigation. We deliberately do NOT wrap `window.setTimeout` globally
  // — see the SPA-navigation section below for the regression history.
  // These helpers are no-ops when `YouTubePlusCleanupManager` is not yet
  // available (e.g. during partial bootstrap or in tests).
  if (typeof U.safeSetTimeout !== 'function') {
    U.safeSetTimeout = function (
      /** @type {any} */ fn,
      /** @type {any} */ ms,
      /** @type {any[]} */ ...args
    ) {
      const id = setTimeout(fn, ms, ...args);
      try {
        U.cleanupManager?.registerTimeout?.(id);
      } catch (_e) {
        U.logSuppressed(_e, 'Utils');
      }
      return id;
    };
  }
  if (typeof U.safeSetInterval !== 'function') {
    U.safeSetInterval = function (
      /** @type {any} */ fn,
      /** @type {any} */ ms,
      /** @type {any[]} */ ...args
    ) {
      const id = setInterval(fn, ms, ...args);
      try {
        U.cleanupManager?.registerInterval?.(id);
      } catch (_e) {
        U.logSuppressed(_e, 'Utils');
      }
      return id;
    };
  }
  if (typeof U.safeRequestAnimationFrame !== 'function') {
    U.safeRequestAnimationFrame = function (/** @type {FrameRequestCallback} */ cb) {
      const id = requestAnimationFrame(cb);
      try {
        U.cleanupManager?.registerAnimationFrame?.(id);
      } catch (_e) {
        U.logSuppressed(_e, 'Utils');
      }
      return id;
    };
  }

  // -- Helpers shorthand ---------------------------------------------------
  // Modules destructure this for the 6-line preamble. `setTimeout_`
  // is intentionally the NATIVE `window.setTimeout` (no global wrap),
  // so SPA navigation cleanup does not touch unrelated timers. Modules
  // that want their timers tracked should call `YouTubeUtils.safeSetTimeout`
  // explicitly.
  U.helpers = U.helpers || {
    $: U.$,
    $$: U.$$,
    byId: U.byId,
    t: U.t,
    logger: U.logger || null,
    createHTML: U.createHTML,
    debounce: U.debounce,
    setTimeout_: setTimeout.bind(window),
    onDomReady: U.onDomReady,
  };

  // -- Runtime activation helpers -----------------------------------------
  // Small composable primitives that let a module activate and deactivate
  // itself in response to changes in route, settings, or the open
  // settings-modal section, without going through a central registry.
  //
  // Rationale: a userscript is a single concatenated file, so there is
  // no code-splitting to defer. The only meaningful "lazy" axis is
  // *when* a module's body actually runs. Doing that per-module, with
  // a composable predicate, means a module pays zero cost while it is
  // not relevant (wrong route, feature off, modal closed) instead of
  // running a no-op init on every YouTube SPA navigation.

  /**
   * The default set of DOM events that should re-evaluate a
   * module's `isRelevant` predicate. Covers YouTube SPA nav, the
   * settings modal open/close cycle, and the settings-updated
   * broadcast that fires when the user toggles a feature.
   * @type {ReadonlyArray<string>}
   */
  const DEFAULT_RELEVANCE_SIGNALS = Object.freeze([
    'yt-navigate-finish',
    'yt-page-data-updated',
    'youtube-plus-settings-modal-opened',
    'youtube-plus-settings-updated',
  ]);

  /**
   * Invoke `fn` only while `predicate()` returns true. Re-evaluates
   * the predicate whenever any of `signals` fires on `window` or
   * `document`.
   *
   * `onEnter` is called every time the predicate flips false→true,
   * and `onLeave` is called every time it flips true→false. The
   * helper never calls `onLeave` automatically on `dispose()` — the
   * caller is responsible for teardown; the browser will reclaim
   * everything when the page unloads anyway, and double-cleanup is
   * harder to debug than missing cleanup in test environments.
   *
   * If `onEnter` throws, the helper logs the error and stays in
   * the inactive state. The next signal will re-attempt activation,
   * which makes the helper self-healing across transient DOM
   * conditions (e.g., `document.querySelector('video')` returning
   * null mid-nav). `onLeave` errors are logged and swallowed: a
   * cleanup failure must not put the module back into a
   * half-initialised state.
   *
   * @param {{
   *   isRelevant: () => boolean,
   *   onEnter?: () => void,
   *   onLeave?: () => void,
   *   signals?: ReadonlyArray<string>,
   *   name?: string
   * }} config
   * @returns {{
   *   active: boolean,
   *   check: () => void,
   *   dispose: () => void
   * }}
   */
  const whenRelevant = config => {
    const signals = config.signals || DEFAULT_RELEVANCE_SIGNALS;
    const label = config.name || 'whenRelevant';
    let active = false;

    const safeOnEnter = () => {
      if (typeof config.onEnter !== 'function') {
        active = true;
        return;
      }
      try {
        config.onEnter();
        active = true;
      } catch (err) {
        U.logger?.error?.(label, 'onEnter failed; will retry on next signal', err);
        active = false;
      }
    };

    const safeOnLeave = () => {
      if (typeof config.onLeave !== 'function') {
        active = false;
        return;
      }
      try {
        config.onLeave();
      } catch (err) {
        U.logger?.error?.(label, 'onLeave failed; ignoring', err);
      } finally {
        active = false;
      }
    };

    const check = () => {
      let should = false;
      try {
        should = !!config.isRelevant();
      } catch (err) {
        U.logger?.error?.(label, 'isRelevant threw; treating as inactive', err);
        should = false;
      }
      if (should && !active) safeOnEnter();
      else if (!should && active) safeOnLeave();
    };

    const handlers = signals.map(name => {
      const handler = () => check();
      // YouTube SPA lifecycle events are dispatched on `document`. Most of them
      // bubble, but some (e.g. yt-page-data-updated) may not in all contexts.
      // Listening on `document` is the safer default; the settings-modal-opened
      // event is also a document event.
      // The modal-opened event is dispatched on `document` (see basic.js); the
      // settings-updated event is dispatched on `window` (see settings-helpers.js);
      // YouTube SPA lifecycle events are dispatched on `document`.
      const target = name === 'youtube-plus-settings-updated' ? window : document;
      target.addEventListener(name, handler);
      return { target, name, handler };
    });

    // Initial evaluation. Synchronous: the caller has finished
    // wiring up state by the time they call `whenRelevant`, and
    // making the first check async would race with subsequent
    // sync code that reads `.active`.
    check();

    return {
      get active() {
        return active;
      },
      check,
      dispose: () => {
        for (const h of handlers) h.target.removeEventListener(h.name, h.handler);
        handlers.length = 0;
      },
    };
  };

  /**
   * Subscribe to a single DOM event and return a disposer. The
   * disposer removes the listener even if the listener throws
   * (it doesn't, but the call is wrapped defensively).
   *
   * @param {EventTarget} target
   * @param {string} event
   * @param {(e: any) => void} handler
   * @param {AddEventListenerOptions | boolean} [options]
   * @returns {() => void} disposer
   */
  const on = (target, event, handler, options) => {
    /** @type {any} */
    const h = handler;
    target.addEventListener(event, h, options);
    return () => {
      try {
        target.removeEventListener(event, h, options);
      } catch (_e) {
        /* non-critical */
      }
    };
  };

  /**
   * Combine multiple disposers into one. Useful when a module
   * accumulates several `on()` subscriptions and wants a single
   * cleanup point.
   * @param  {...(() => void)} disposers
   * @returns {() => void}
   */
  const group =
    (...disposers) =>
    () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch (_e) {
          /* non-critical */
        }
      }
    };

  /**
   * Fire `onEnter` whenever the user opens the named settings
   * section, and `onLeave` whenever they leave it. Re-fires on
   * every modal open/close cycle, so the section's UI must be
   * idempotently injectable (a common pattern is to gate the
   * injection with a `WeakSet` of already-populated parents).
   *
   * Implementation note: relies on the
   * `youtube-plus-settings-section-activated` CustomEvent that
   * `handleSidebarNavigation` dispatches in modal-handlers.js.
   * If that event is missing, the helper is silently inert.
   *
   * @param {string} sectionId
   * @param {() => void} onEnter
   * @param {() => void} [onLeave]
   * @returns {{ dispose: () => void }}
   */
  const onSectionActive = (sectionId, onEnter, onLeave) => {
    let active = false;
    const handler = (/** @type {any} */ e) => {
      const detail = e?.detail;
      if (!detail || detail.section !== sectionId) return;
      active = true;
      try {
        onEnter();
      } catch (err) {
        U.logger?.error?.('onSectionActive', `onEnter for "${sectionId}" failed`, err);
        active = false;
      }
    };
    const leaveHandler = (/** @type {any} */ e) => {
      if (!active) return;
      // The `youtube-plus-settings-section-activated` event also
      // fires on the NEW section when switching; that path is
      // handled by `handler` above. We only get here if the
      // caller explicitly tears down the section, e.g. on
      // settings-updated. Treat any non-matching activation as
      // a leave.
      const detail = e?.detail;
      if (detail && detail.section === sectionId) return;
      active = false;
      if (typeof onLeave === 'function') {
        try {
          onLeave();
        } catch (err) {
          U.logger?.error?.('onSectionActive', `onLeave for "${sectionId}" failed`, err);
        }
      }
    };
    document.addEventListener('youtube-plus-settings-section-activated', handler);
    document.addEventListener('youtube-plus-settings-modal-closed', leaveHandler);
    return {
      dispose: () => {
        document.removeEventListener('youtube-plus-settings-section-activated', handler);
        document.removeEventListener('youtube-plus-settings-modal-closed', leaveHandler);
      },
    };
  };

  U.whenRelevant = U.whenRelevant || whenRelevant;
  U.on = U.on || on;
  U.group = U.group || group;
  U.onSectionActive = U.onSectionActive || onSectionActive;

  // ---------------------------------------------------------------------------
  // Video ID extraction helpers — shared across download, time, playall
  // ---------------------------------------------------------------------------
  /**
   * Extract video ID from a URL string (query param `v` only).
   * @param {string} url
   * @returns {string|null}
   */
  const getVideoIdFromUrl = url => {
    try {
      return new URLSearchParams(new URL(url).search).get('v');
    } catch (_e) {
      return null;
    }
  };
  /**
   * Extract video ID from the current page location.
   * Checks: query `v`, /shorts/, /live/, youtu.be paths.
   * @returns {string|null}
   */
  const getVideoIdFromLocation = () => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const fromQuery = params.get('v');
      if (fromQuery) return fromQuery;
      const path = window.location.pathname || '';
      const shortsMatch = path.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch?.[1]) return shortsMatch[1];
      const liveMatch = path.match(/^\/live\/([a-zA-Z0-9_-]{11})/);
      if (liveMatch?.[1]) return liveMatch[1];
      const youtuBeMatch = (window.location.href || '').match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
      if (youtuBeMatch?.[1]) return youtuBeMatch[1];
    } catch (_e) {
      // non-critical
    }
    return null;
  };
  U.getVideoIdFromUrl = U.getVideoIdFromUrl || getVideoIdFromUrl;
  U.getVideoIdFromLocation = U.getVideoIdFromLocation || getVideoIdFromLocation;

  // ---------------------------------------------------------------------------
  // Shared style injection utility
  // ---------------------------------------------------------------------------
  // Canonical path for injecting module CSS. Prefers the design-system
  // StyleManager; falls back to a raw <style> element when the canonical
  // service is unavailable. Every call is wrapped in try/catch so a
  // style failure never breaks the host page.
  /**
   * @param {string} id - Unique style element / StyleManager key.
   * @param {string} css - CSS text to inject.
   * @param {Element} [target] - Optional parent for the raw <style> fallback
   *   (defaults to document.head or document.documentElement).
   */
  const injectModuleStyles = (id, css, target) => {
    try {
      const SM = U.StyleManager;
      if (SM && typeof SM.add === 'function') {
        SM.add(id, css);
        return;
      }
    } catch (_e) {
      // StyleManager unavailable — fall through to raw injection
    }
    try {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('style');
        el.id = id;
        (target || document.head || document.documentElement).appendChild(el);
      }
      el.textContent = css;
    } catch (_e) {
      // Non-critical: style injection failed
    }
  };
  U.injectModuleStyles = U.injectModuleStyles || injectModuleStyles;

  // ---------------------------------------------------------------------------
  // Cross-cutting side effect: SPA navigation cleanup
  // ---------------------------------------------------------------------------
  // On `yt-navigate-start`, invoke the cleanup manager. Guarded to run once.
  //
  // IMPORTANT: We intentionally DO NOT wrap `window.setTimeout`,
  // `window.setInterval`, or `window.requestAnimationFrame` globally anymore.
  // Doing so caused several regressions: (1) YouTube SPA navigation cleanup
  // would also kill timers scheduled by the page itself or by other
  // userscripts running in the same context, breaking unrelated features;
  // (2) modules that captured `setTimeout` at module-init time still saw
  // the native function, so the wrap was inconsistently applied; (3) the
  // `helpers.setTimeout_` getter previously returned the wrapped version
  // which silently no-op'd when the wrapper threw, breaking
  // `applyLoopStateToCurrentVideo()` in time.js.
  //
  // Modules that want their timers cleaned up on SPA navigation should
  // import the explicit `safeSetTimeout` / `safeSetInterval` /
  // `safeRequestAnimationFrame` helpers exposed on `YouTubeUtils`. The
  // canonical YouTubePlusCleanupManager still owns the cleanup call below.

  // ---------------------------------------------------------------------------
  // Cross-cutting side effect: SPA navigation cleanup
  // ---------------------------------------------------------------------------
  // On `yt-navigate-start`, invoke the cleanup manager. Guarded to run once.
  try {
    const navHost = /** @type {any} */ (window);
    if (!navHost.__ytp_nav_cleanup_registered) {
      navHost.__ytp_nav_cleanup_registered = true;
      document.addEventListener('yt-navigate-start', () => {
        try {
          U.cleanupManager?.cleanup?.();
        } catch (_e) {
          // Non-critical
        }
      });
    }
  } catch (_e) {
    // Non-critical: navigation cleanup hook failed to register
  }
})();
