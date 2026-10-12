// YouTube+ utils.js - compatibility facade only.
//
// This file is a THIN compatibility layer. It exposes the
// YouTube+ modules and a small set of compat shims under
// `window.YouTubeUtils`, and runs the cross-cutting side effects that
// have no better home.
//
// Owner modules live in their own files. Add new shared logic to the
// correct owner, not here:
//
//   - logger.js                 -> logging
//   - design-system.js          -> styles / StyleManager
//   - i18n.js                   -> translation
//   - safe-dom.js               -> safe HTML
//   - settings-helpers.js       -> settings store
//   - dom-cache.js              -> DOM query / wait / cache
//   - mutation-coordinator.js   -> mutation lifecycle
//   - event-delegation.js       -> delegated events
//   - cleanup-manager.js        -> SPA-resource cleanup
//   - performance.js            -> diagnostics / profiling
//
// utils.js (this file) is allowed to:
//   1. Proxy to the owner modules (preferred).
//   2. Expose back-compat aliases for properties that sit on
//      `window.YouTubeUtils` and may be captured by reference at
//      module load time, before the owner module is defined.
//   3. Define local compat shims for utilities that have no owner
//      yet (debounce, throttle, safeMerge, storage, etc.).
//   4. Run cross-cutting side effects (navigation lifecycle, SPA
//      cleanup, dev diagnostics) that no single owner covers.
//
// It is NOT allowed to:
//   - Implement shared logic that belongs in an owner module.
//   - Add new utilities here to avoid touching the owners.

// @ts-check
(function () {
  if (typeof window === 'undefined') return;

  // ---------------------------------------------------------------------------
  // User configuration: YouTubePlusConfig
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
      communityWritesEnabled: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Scroll Manager: centralized debounced scroll listener registry
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
        /** @type {Record<string, unknown>} */ opts = {}
      ) {
        const debounceMs = /** @type {number} */ (opts.debounce) || 100;
        /** @type {ReturnType<typeof setTimeout>|null} */
        let timer = null;
        const handler = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => callback(), debounceMs);
        };
        // Keep the managed registration key: the returned disposer must
        // release BOTH bookkeepings (CleanupManager entry AND the Map entry
        // below), otherwise detached DOM targets linger in the registry.
        const managedKey = /** @type {symbol | null} */ (
          registerListenerSafe(target, 'scroll', handler, { passive: true })
        );
        if (!scrollListeners.has(target)) scrollListeners.set(target, []);
        /** @type {{ handler: EventListener, cleanup: Function }[]} */ (
          scrollListeners.get(target)
        );
        const bucket = /** @type {{ handler: EventListener, cleanup: Function }[]} */ (
          scrollListeners.get(target)
        );
        const entry = {
          handler,
          cleanup: () => {
            target.removeEventListener('scroll', handler);
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            if (managedKey && window.YouTubePlusCleanupManager?.unregisterListener) {
              window.YouTubePlusCleanupManager.unregisterListener(managedKey);
            }
            // Remove this entry and drop the empty bucket: a detached
            // root must not linger in the registry.
            const list = scrollListeners.get(target);
            if (list) {
              const idx = list.indexOf(entry);
              if (idx !== -1) list.splice(idx, 1);
              if (list.length === 0) scrollListeners.delete(target);
            }
          },
        };
        bucket.push(entry);
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
        // Iterate a snapshot: each cleanup() splices its own entry out
        // of the live bucket (single-handler cleanup never removes neighbours,
        // and mutation during iteration must not skip elements).
        for (const e of [...entries]) e.cleanup();
      },
      /**
       * Diagnostic count of live scroll registrations (test/audit support).
       * @returns {number}
       */
      size() {
        let n = 0;
        for (const list of scrollListeners.values()) n += list.length;
        return n;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Settings modal detection: shared across modules
  // ---------------------------------------------------------------------------
  if (typeof window.YouTubeUtils === 'undefined')
    window.YouTubeUtils = /** @type {YouTubeUtils} */ ({});
  const _U = window.YouTubeUtils;
  _U.isSettingsModalOpen = () => Boolean(document.querySelector('.yp-settings-modal'));

  // ---------------------------------------------------------------------------
  // Route-matching primitives: shared across modules
  // ---------------------------------------------------------------------------
  _U.isYouTubeDomain = () => {
    const host = window.location.hostname || '';
    return host.endsWith('youtube.com') && host !== 'music.youtube.com';
  };
  _U.isWatchRoute = () => window.location.pathname === '/watch';
  _U.isShortsRoute = () => window.location.pathname.startsWith('/shorts');
  _U.isChannelRoute = () => {
    const p = window.location.pathname || '';
    return (
      p.startsWith('/channel/') ||
      p.startsWith('/@') ||
      p.startsWith('/c/') ||
      p.startsWith('/user/')
    );
  };
  _U.getHostname = () => window.location.hostname || '';
  _U.isMusicDomain = () => _U.getHostname() === 'music.youtube.com';
  _U.isStudioDomain = () => _U.getHostname() === 'studio.youtube.com';

  /**
   * The kind of page the browser is on. YouTube Music and Studio are their
   * own routes whatever their path, so `watch` never matches music.youtube.com.
   * @returns {YouTubePlusRoute}
   */
  _U.getRoute = () => {
    if (_U.isMusicDomain()) return 'music';
    if (_U.isStudioDomain()) return 'studio';
    const p = window.location.pathname || '/';
    if (p === '/watch') return 'watch';
    if (p.startsWith('/shorts')) return 'shorts';
    if (p === '/') return 'home';
    if (p === '/results') return 'search';
    if (p === '/playlist') return 'playlist';
    if (p.startsWith('/feed/')) return 'feed';
    if (_U.isChannelRoute()) return 'channel';
    return 'other';
  };

  // ---------------------------------------------------------------------------
  // Route-matching factory: replaces per-module isRelevantRoute() duplicates
  // ---------------------------------------------------------------------------
  /**
   * Creates a route-checking function based on the provided route flags.
   * @param {{ watch?: boolean, shorts?: boolean, channel?: boolean, domain?: boolean, settingsModal?: boolean }} options
   * @returns {() => boolean}
   */
  _U.createIsRelevantRoute = (options = {}) => {
    const {
      watch = false,
      shorts = false,
      channel = false,
      domain = false,
      settingsModal = false,
    } = options;
    return () => {
      if (settingsModal && _U.isSettingsModalOpen()) return true;
      if (domain && !_U.isYouTubeDomain()) return false;
      return (
        (_U.isWatchRoute() && watch) ||
        (_U.isShortsRoute() && shorts) ||
        (_U.isChannelRoute() && channel)
      );
    };
  };

  // ---------------------------------------------------------------------------
  // Shared withErrorBoundary shim: replaces per-module duplication
  // ---------------------------------------------------------------------------
  /**
   * Returns a withErrorBoundary wrapper bound to the given module name.
   * Falls back to a try/catch shim when the error boundary isn't loaded.
   * @param {string} moduleName
   * @param {(context: string, error: unknown) => void} [logErrorFn] - optional custom error logger
   * @returns {<T extends (...args: never[]) => unknown>(fn: T, context?: string) => T}
   */
  _U.createWithErrorBoundary = (moduleName, logErrorFn) => {
    /**
     * @template {(...args: never[]) => unknown} T
     * @param {T} fn
     * @param {string} [context]
     * @returns {T}
     */
    const wrapper = (fn, context) => {
      const ctx = context || moduleName;
      if (window.YouTubePlusErrorBoundary?.withErrorBoundary) {
        return /** @type {T} */ (
          /** @type {unknown} */ (
            window.YouTubePlusErrorBoundary.withErrorBoundary(
              /** @type {(...args: unknown[]) => unknown} */ (/** @type {unknown} */ (fn)),
              moduleName
            )
          )
        );
      }
      const callable = /** @type {(...args: unknown[]) => unknown} */ (/** @type {unknown} */ (fn));
      const fallback = /** @param {...unknown} args */ (...args) => {
        try {
          return callable(...args);
        } catch (e) {
          if (logErrorFn) {
            logErrorFn(ctx, e);
          } else {
            const eb = window.YouTubePlusErrorBoundary;
            if (eb?.logError) {
              const err = e instanceof Error ? e : new Error(String(e));
              eb.logError(err, { module: ctx });
            }
          }
          return null;
        }
      };
      return /** @type {T} */ (/** @type {unknown} */ (fallback));
    };
    return wrapper;
  };

  // ---------------------------------------------------------------------------
  // Non-critical error logging: replaces bare "Non-critical, suppressed" catches
  // ---------------------------------------------------------------------------
  /**
   * Normalizes any suppressed value into a real Error, keeping Error
   * identity strings/objects/undefined become Errors with a
   * meaningful message instead of String(undefined) sentinels.
   * @param {unknown} error
   * @returns {Error}
   */
  _U.normalizeSuppressedError = error => {
    if (error instanceof Error) return error;
    const msg =
      error &&
      typeof error === 'object' &&
      typeof (/** @type {{ message?: unknown }} */ (error).message) === 'string'
        ? String(/** @type {{ message?: unknown }} */ (error).message)
        : error === undefined || error === null || error === ''
          ? 'suppressed error'
          : String(error);
    return new Error(msg);
  };

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
        const err = _U.normalizeSuppressedError(error);
        eb.logError(err, {
          module,
          message: message || 'Non-critical, suppressed',
          // Expected errors are routine; the boundary logs them at debug level.
          level: 'debug',
        });
      }
    } catch (_e) {
      /* never break error reporting */
    }
  };

  // ---------------------------------------------------------------------------
  // YouTubePlus* naming aliases: backward-compat bridges
  // ---------------------------------------------------------------------------
  // New code should use the YouTubePlus* names; the short names are kept as
  // aliases so existing consumers keep working during the migration.
  if (typeof window !== 'undefined') {
    if (!window.YouTubePlusUtils) window.YouTubePlusUtils = window.YouTubeUtils;
  }

  // ---------------------------------------------------------------------------
  // Log and error routing: owner logger.js
  // ---------------------------------------------------------------------------
  // All log calls go through YouTubePlusLogger. utils.js does not own
  // any logging policy of its own.

  /**
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string} module
   * @param {string} message
   * @param {unknown} [data]
   */
  const emitCoreLog = (level, module, message, data) => {
    const sink = window.YouTubePlusLogger;
    if (!sink || typeof sink[level] !== 'function') return;
    if (data === undefined) sink[level](module, message);
    else sink[level](module, message, data);
  };

  /**
   * Logs an error with structured context. Convention used by every
   * module: YouTubeUtils.logError(module, message, error).
   * @param {string} module
   * @param {string} message
   * @param {unknown} error
   */
  const logError = (module, message, error) => {
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
  };

  // ---------------------------------------------------------------------------
  // Thin proxies to the owner modules
  // ---------------------------------------------------------------------------
  // Each proxy below is a small wrapper that defers to its owner
  // module. The wrapper exists so the global is defined even if that
  // module is not yet loaded (utils.js loads first in build order);
  // the wrapper falls through to a tiny built-in fallback if the owner
  // is missing.

  // -- DOM (owner: dom-cache.js) -----------------------------------------
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
   * DOMContentLoaded wrapper. Runs the callback
   * synchronously when the document is already past `loading`, so
   * module init can call it unconditionally.
   * @param {() => void} cb
   * @returns {void}
   */
  const onDomReady = cb => {
    if (document.readyState === 'loading') {
      registerListenerSafe(document, 'DOMContentLoaded', cb, { once: true });
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
    const cache = window.YouTubePlusDOMCache;
    return cache?.waitForElement
      ? cache.waitForElement(selector, timeout, parent)
      : Promise.resolve(parent?.querySelector(selector) ?? null);
  };

  // -- i18n (owner: i18n.js) ----------------------------------------------
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
    return String(htmlLang).toLowerCase();
  };

  // -- Safe HTML (owner: safe-dom.js) -------------------------------------
  /** @param {string} html */
  const createHTML = html => {
    if (window.YouTubeSafeDOM?.createHTML) return window.YouTubeSafeDOM.createHTML(html);
    return String(html ?? '');
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
  /**
   * Quote-safe HTML escaper used when `YouTubeSafeDOM.escapeHTML` is
   * unavailable (and by modules that interpolate values into quoted
   * attributes). Escapes a strict superset of the DOM-based
   * escaper (`& < > " '`); the extra quote entities are required
   * because consumer templates place the result inside `attr="..."`.
   * @param {unknown} input
   * @returns {string}
   */
  const escapeHTML = input =>
    typeof input === 'string'
      ? input
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
      : '';

  // -- Confirm dialog replacement for native confirm() ----
  // Own focus-trapped dialog instead of the page-blocking native confirm().
  // The message is rendered through textContent, never interpolated into HTML.
  const CONFIRM_DIALOG_CSS = `
    .yp-confirm-backdrop{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;}
    .yp-confirm-dialog{background:#212121;color:#f1f1f1;border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:20px 22px;max-width:340px;box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:Roboto,Arial,sans-serif;font-size:14px;line-height:1.4;}
    .yp-confirm-message{margin:0 0 16px;white-space:pre-line;word-break:break-word;}
    .yp-confirm-actions{display:flex;gap:10px;justify-content:flex-end;}
    .yp-confirm-actions button{min-width:88px;padding:9px 14px;border-radius:18px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:inherit;font:inherit;cursor:pointer;}
    .yp-confirm-actions .yp-confirm-confirm{background:#f1f1f1;color:#0f0f0f;border-color:transparent;}
  `;

  const ensureConfirmDialogStyles = () => {
    if (document.getElementById('yp-confirm-styles')) return;
    const style = document.createElement('style');
    style.id = 'yp-confirm-styles';
    style.textContent = CONFIRM_DIALOG_CSS;
    document.head.appendChild(style);
  };

  /**
   * Ask the user a destructive-action question. Resolves `true` only when the
   * user activates the confirm button; Escape, the backdrop and the cancel
   * button resolve `false`. Focus is trapped inside the dialog and restored
   * to the trigger element afterwards.
   * @param {{ message: string, confirmLabel?: string, cancelLabel?: string }} [options]
   * @returns {Promise<boolean>}
   */
  const confirmDialog = (
    /** @type {{ message?: string, confirmLabel?: string, cancelLabel?: string }} */ options = {}
  ) =>
    new Promise(resolve => {
      ensureConfirmDialogStyles();

      const labelOf = (
        /** @type {string|undefined} */ value,
        /** @type {string} */ key,
        /** @type {string} */ fallback
      ) => {
        if (value) return String(value);
        const translated = t(key);
        return translated && translated !== key ? translated : fallback;
      };

      const backdrop = document.createElement('div');
      backdrop.className = 'yp-confirm-backdrop';
      const dialog = document.createElement('div');
      dialog.className = 'yp-confirm-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.tabIndex = -1;

      const messageEl = document.createElement('p');
      messageEl.className = 'yp-confirm-message';
      messageEl.textContent = String(options.message ?? '');
      const actions = document.createElement('div');
      actions.className = 'yp-confirm-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'yp-confirm-cancel';
      cancelBtn.textContent = labelOf(options.cancelLabel, 'cancel', 'Cancel');
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'yp-confirm-confirm';
      confirmBtn.textContent = labelOf(options.confirmLabel, 'confirm', 'Confirm');
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      dialog.appendChild(messageEl);
      dialog.appendChild(actions);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      const restoreFocusEl =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const controller = new AbortController();
      /** @type {boolean} */
      let settled = false;
      const finish = (/** @type {boolean} */ result) => {
        if (settled) return;
        settled = true;
        controller.abort();
        backdrop.remove();
        if (restoreFocusEl && typeof restoreFocusEl.focus === 'function') {
          try {
            restoreFocusEl.focus();
          } catch (_e) {
            /* detached focus target */
          }
        }
        resolve(result);
      };
      const onDialogKeydown = /** @param {KeyboardEvent} e */ e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
          return;
        }
        if (
          e.key === 'Tab' &&
          (e.target === dialog || dialog.contains(/** @type {Node} */ (e.target)))
        ) {
          e.preventDefault();
          const next = document.activeElement === confirmBtn ? cancelBtn : confirmBtn;
          next.focus();
        }
      };
      dialog.addEventListener('keydown', onDialogKeydown, { signal: controller.signal });
      document.addEventListener(
        'keydown',
        /** @param {KeyboardEvent} e */ e => {
          if (e.key === 'Escape') finish(false);
        },
        { signal: controller.signal }
      );
      cancelBtn.addEventListener('click', () => finish(false), { signal: controller.signal });
      confirmBtn.addEventListener('click', () => finish(true), { signal: controller.signal });
      backdrop.addEventListener(
        'click',
        e => {
          if (e.target === backdrop) finish(false);
        },
        { signal: controller.signal }
      );

      cancelBtn.focus();
    });

  // -- Settings (owner: settings-helpers.js) ------------------------------
  // SETTINGS_KEY is the storage key. It is exposed for the
  // handful of modules that read the raw shape; new code should go
  // through `YouTubePlusSettingsStore` instead.
  /** @type {string} */
  const SETTINGS_KEY = 'youtube_plus_settings';

  /**
   * Thin compat wrapper around YouTubePlusSettingsStore that returns
   * `true` unless the feature is explicitly set to `false`. Falls
   * back to a direct storage read of the main settings key when the
   * store has not yet installed itself (utils.js loads first).
   * @param {string} featureKey
   * @param {boolean} [defaultValue=true]
   * @returns {boolean}
   */
  const loadFeatureEnabled = (featureKey, defaultValue = true) => {
    const store = window.YouTubePlusSettingsStore;
    if (store && typeof store.get === 'function') {
      const v = store.get(featureKey, defaultValue);
      return v === undefined ? defaultValue : v !== false;
    }
    try {
      const settings = localStorage.getItem(SETTINGS_KEY); // lint:custom:ignore boot-order fallback: store not installed yet
      if (settings) {
        const parsed = JSON.parse(settings);
        return parsed[featureKey] !== false;
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Utils');
    }
    return defaultValue;
  };

  // -- Logger facade (owner: logger.js) -----------------------------------
  // A small wrapper that respects a `YouTubePlusConfig.debug` /
  // `window.YTP_DEBUG` flag for dev output. warn/error are always
  // emitted through YouTubePlusLogger.
  const createLogger = () => {
    const isDebugEnabled = (() => {
      if (typeof window === 'undefined') return false;
      const cfg = window.YouTubePlusConfig;
      if (cfg?.debug) return true;
      if (typeof window.YTP_DEBUG !== 'undefined') {
        return !!window.YTP_DEBUG;
      }
      return false;
    })();
    return {
      debug: function (/** @type {unknown[]} */ ...args) {
        if (isDebugEnabled)
          /** @type {(...a: unknown[]) => void} */ (emitCoreLog)('debug', ...args);
      },
      info: function (/** @type {unknown[]} */ ...args) {
        if (isDebugEnabled) /** @type {(...a: unknown[]) => void} */ (emitCoreLog)('info', ...args);
      },
      warn: function (/** @type {unknown[]} */ ...args) {
        /** @type {(...a: unknown[]) => void} */ (emitCoreLog)('warn', ...args);
      },
      error: function (/** @type {unknown[]} */ ...args) {
        /** @type {(...a: unknown[]) => void} */ (emitCoreLog)('error', ...args);
      },
    };
  };

  // -- Retry scheduler (owner: mutation-coordinator.js) ------------------
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
  // Local compat shims
  // ---------------------------------------------------------------------------
  // Kept here because no owner module defines them and existing modules
  // capture references at load time. They are NOT a destination for new
  // shared logic - promote them to an owner module if they grow.

  /**
   * @template {(...args: never[]) => unknown} T
   * @param {T} fn
   * @param {number} ms
   * @param {{ leading?: boolean }} [options={}]
   * @returns {T & { cancel: () => void, destroy: () => void }}
   */
  const debounce = (fn, ms, options = {}) => {
    const callable = /** @type {(...a: unknown[]) => unknown} */ (/** @type {unknown} */ (fn));
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timeout = null;
    /** @type {unknown[]|null} */
    let lastArgs = null;
    /** @type {unknown} */
    let lastThis = null;
    let isDestroyed = false;

    /** @this {unknown} */
    const debounced = function (/** @type {unknown[]} */ ...args) {
      if (isDestroyed) return;
      lastArgs = args;
      lastThis = this;
      if (timeout !== null) clearTimeout(timeout);
      if (options.leading && timeout === null) {
        try {
          callable.apply(this, args);
        } catch (e) {
          emitCoreLog('error', 'Utils', 'Debounced function error', e);
        }
      }
      timeout = setTimeout(() => {
        if (!(isDestroyed || options.leading)) {
          try {
            callable.apply(lastThis, lastArgs ?? []);
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
    return /** @type {T & { cancel: () => void, destroy: () => void }} */ (
      /** @type {unknown} */ (debounced)
    );
  };

  /**
   * @template {(...args: never[]) => unknown} T
   * @param {T} fn
   * @param {number} limit
   * @returns {T}
   */
  const throttle = (fn, limit) => {
    const callable = /** @type {(...a: unknown[]) => unknown} */ (/** @type {unknown} */ (fn));
    let inThrottle = false;
    /** @type {unknown} */
    let lastResult;
    /** @this {unknown} */
    const throttled = function (/** @type {unknown[]} */ ...args) {
      if (!inThrottle) {
        lastResult = callable.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
      return lastResult;
    };
    return /** @type {T} */ (/** @type {unknown} */ (throttled));
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
      // malformed URL
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
      // malformed URL
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
      // malformed URL
      return false;
    }
  };

  /**
   * @returns {boolean}
   */
  const isStudioPage = () => _U.isStudioDomain?.() ?? false;

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

  // Non-settings storage wrapper. NOT the settings store - that is
  // `YouTubePlusSettingsStore` (settings-store.js). This helper validates
  // keys and caps serialized value size, but does not coordinate with any
  // other module. All raw IO delegates to the store's sanctioned primitives
  // (readRaw/writeRaw/removeRaw): utils.js never touches storage directly
  // directly, keeping SettingsStore the single storage boundary.
  /** @returns {YouTubePlusSettingsStore | null} store with raw IO, or null before settings-store.js loads */
  const getRawStore = () => window.YouTubePlusSettingsStore;
  const storage = {
    /**
     * @template [T=unknown]
     * @param {string} key
     * @param {T | null} [def]
     * @returns {T}
     */
    get(key, def = null) {
      if (typeof key !== 'string' || !/^[a-zA-Z0-9_\-.]+$/.test(key)) {
        logError('storage', 'Invalid key format', new Error(`Invalid key: ${key}`));
        return /** @type {T} */ (def);
      }
      try {
        const v = getRawStore()?.readRaw?.(key) ?? null;
        if (v === null) return /** @type {T} */ (def);
        if (v.length > 5 * 1024 * 1024) {
          logError('storage', 'Stored value too large', new Error(`Key: ${key}`));
          return /** @type {T} */ (def);
        }
        return JSON.parse(v);
      } catch (e) {
        logError('storage', 'Failed to parse stored value', e);
        return /** @type {T} */ (def);
      }
    },
    /**
     * @param {string} key
     * @param {unknown} val
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
        return getRawStore()?.writeRaw?.(key, serialized) ?? false;
      } catch (e) {
        logError('storage', 'Failed to store value', e);
        return false;
      }
    },
    /** @param {string} key */
    remove(key) {
      getRawStore()?.removeRaw?.(key);
    },
    clear() {
      getRawStore()?.clearRaw?.(['youtube_plus_', 'youtube_', 'ytp-', 'youtube-plus-']);
    },
    /** @param {string} key @returns {boolean} */
    has(key) {
      return (getRawStore()?.readRaw?.(key) ?? null) !== null;
    },
    /** Raw string getItem, no JSON parse. @param {string} k @param {string|null} [def] */
    getItem(k, def = null) {
      return getRawStore()?.readRaw?.(k) ?? def;
    },
    /** Raw string setItem, no JSON stringify. @param {string} k @param {string} v */
    setItem(k, v) {
      return getRawStore()?.writeRaw?.(k, v) ?? false;
    },
    /** @param {string} k */
    removeItem(k) {
      getRawStore()?.removeRaw?.(k);
    },
  };

  // ---------------------------------------------------------------------------
  // Diagnostics: thin back-compat proxy. Owner performance.js
  // (ObserverRegistry + window.__ytpDiagnostics live there now). Kept here as
  // a lazy getter since performance.js loads after utils.js in build order;
  // zoom.js / enhanced.js still call `U.ObserverRegistry?.track?.()`.
  // ---------------------------------------------------------------------------
  if (!Object.getOwnPropertyDescriptor(_U, 'ObserverRegistry')) {
    Object.defineProperty(_U, 'ObserverRegistry', {
      get() {
        return window.YouTubePerformance?.ObserverRegistry;
      },
      configurable: true,
      enumerable: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation & history change notification
  // ---------------------------------------------------------------------------
  // Emits 'yp-history-navigate' on URL transitions.
  // Guarded to install once per session.

  const HISTORY_KEYS_SYM = Symbol.for('ytp_history_keys');

  const installHistoryNavigation = () => {
    window.__ytp_history_wrapped = true;

    const cm = window.YouTubePlusCleanupManager;
    const historyKeys = /** @type {Record<symbol, symbol[] | undefined>} */ (
      /** @type {unknown} */ (window)
    );
    if (Array.isArray(historyKeys[HISTORY_KEYS_SYM])) {
      const prevKeys = /** @type {symbol[]} */ (historyKeys[HISTORY_KEYS_SYM]);
      for (const k of prevKeys) {
        cm?.unregisterListener?.(k);
      }
    }

    /** @type {symbol[]} */
    const keys = [];
    historyKeys[HISTORY_KEYS_SYM] = keys;

    let lastEmittedHref = '';

    /**
     * @param {'navigate' | 'popstate'} type
     */
    const emitHistoryNavigate = type => {
      const currentHref = typeof location !== 'undefined' ? location.href : '';
      if (currentHref && currentHref === lastEmittedHref) return;
      lastEmittedHref = currentHref;
      window.dispatchEvent(
        new CustomEvent('yp-history-navigate', {
          detail: { type },
        })
      );
    };

    if (typeof window !== 'undefined' && 'navigation' in window && window.navigation) {
      const k = cm?.registerListener(
        /** @type {EventTarget} */ (window.navigation),
        'navigatesuccess',
        () => emitHistoryNavigate('navigate'),
        undefined,
        true
      );
      if (k) keys.push(k);
    }
    if (typeof document !== 'undefined') {
      const k = cm?.registerListener(
        document,
        'yt-navigate-finish',
        () => emitHistoryNavigate('navigate'),
        undefined,
        true
      );
      if (k) keys.push(k);
    }
    if (typeof window !== 'undefined') {
      const k1 = cm?.registerListener(
        window,
        'yt-navigate-finish',
        () => emitHistoryNavigate('navigate'),
        undefined,
        true
      );
      if (k1) keys.push(k1);
      const k2 = cm?.registerListener(
        window,
        'popstate',
        () => emitHistoryNavigate('popstate'),
        undefined,
        true
      );
      if (k2) keys.push(k2);
    }
  };

  if (!window.__ytp_history_wrapped) installHistoryNavigation();

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

  /**
   * True if the keyboard event target is an editable element.
   * Shared helper; speed/time hotkey paths use it.
   * @param {EventTarget | null | undefined} target
   * @returns {boolean}
   */
  const isEditableTarget = target => {
    const active = /** @type {HTMLElement | null | undefined} */ (target);
    if (!active) return false;
    const tag = (active.tagName || '').toLowerCase();
    return (
      tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable === true
    );
  };

  /**
   * True when the document's active element is editable, preferring an
   * enhancer's own `isEditableTarget` when it provides one.
   * @param {{ isEditableTarget?: (target: EventTarget | null | undefined) => boolean } | null | undefined} enhancer
   * @returns {boolean}
   */
  const isEditableActiveElement = enhancer => {
    const active = document.activeElement;
    return typeof enhancer?.isEditableTarget === 'function'
      ? enhancer.isEditableTarget(active)
      : isEditableTarget(active);
  };

  /**
   * Register a DOM listener via the cleanup manager when available, falling
   * back to raw addEventListener. Shared helper.
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListenerOrEventListenerObject} handler
   * @param {AddEventListenerOptions | boolean} [opts]
   * @returns {unknown}
   */
  const registerListenerSafe = (target, type, handler, opts) => {
    // Listeners on global targets (window/document/body) are session-scoped:
    // they are registered once at boot and must survive every SPA navigation.
    // Element-scoped listeners default to page scope so the per-navigation
    // cleanup() sweep reclaims them together with the UI that owns them.
    const globalTarget =
      target === window ||
      target === document ||
      target === document.body ||
      target === document.documentElement ||
      target === document.head;
    if (window.YouTubePlusCleanupManager?.registerListener) {
      return window.YouTubePlusCleanupManager.registerListener(
        target,
        type,
        /** @type {EventListener} */ (/** @type {unknown} */ (handler)),
        opts,
        globalTarget
      );
    }
    target.addEventListener(type, handler, opts);
    return null;
  };

  /**
   * Build the shared experimental-section nav click handler and register its
   * companion language-change listener. Both stats views use the identical
   * wiring.
   * @param {() => void} attachSettingsHandler
   * @returns {(e: Event) => void}
   */
  const createExperimentalNavClickHandler = attachSettingsHandler => {
    const handleExperimentalNavClick = /** @type {EventListener} */ (
      e => {
        const target = /** @type {HTMLElement | null} */ (e.target);
        const navItem = /** @type {HTMLElement | null} */ (
          target?.closest?.('.yp-settings-nav-item')
        );
        if (navItem?.dataset?.section === 'experimental') attachSettingsHandler();
      }
    );
    registerListenerSafe(document, 'youtube-plus-language-changed', () => attachSettingsHandler());
    return /** @type {(e: Event) => void} */ (handleExperimentalNavClick);
  };

  // ---------------------------------------------------------------------------
  // YouTubeUtils surface
  // ---------------------------------------------------------------------------
  // Back-compat surface: properties modules may capture by reference at
  // module load time.
  if (!window.YouTubeUtils)
    window.YouTubeUtils = /** @type {YouTubeUtils} */ (/** @type {unknown} */ ({}));
  const U = window.YouTubeUtils;

  // -- Lazy getters (resolve at call time to current state) ----------------
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

  /**
   * Visibility-aware interval: pauses when the tab is hidden,
   * registers with cleanupManager for SPA navigation cleanup.
   *
   * `resume()` re-creates the interval after `pause()`.
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
          cm.unregisterInterval(cmHandle);
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

  /**
   * Open an external URL in a new tab, enforcing HTTPS scheme (or
   * loopback/localhost for local tools like YTDL). Returns whether the URL was
   * allowed and the tab requested; the `noopener` window handle is always null
   * by spec, so it is not returned.
   * @param {string} rawUrl
   * @param {string} [target='_blank']
   * @returns {boolean}
   */
  const openSafe = (rawUrl, target = '_blank') => {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
      const parsed = new URL(rawUrl.trim(), window.location.href);
      const isHttps = parsed.protocol === 'https:';
      const isLocal =
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' ||
          parsed.hostname === '127.0.0.1' ||
          parsed.hostname === '::1');
      if (!(isHttps || isLocal)) {
        emitCoreLog('warn', 'Security', 'Blocked unsafe navigation scheme:', parsed.protocol);
        return false;
      }
      window.open(parsed.href, target, 'noopener,noreferrer');
      return true;
    } catch (_e) {
      emitCoreLog('warn', 'Security', 'Invalid URL passed to openSafe:', rawUrl);
      return false;
    }
  };

  // Test-only surface gate: feature modules hand their internal entry
  // points here instead of attaching a testHooks bag to the facade root.
  // Release pages (flag unset) never receive the bag.
  const exposeTestHooks = (
    /** @type {object} */ facade,
    /** @type {Record<string, unknown>} */ hooks
  ) => {
    if (facade && window.__YTP_TEST_HOOKS__ === true) {
      /** @type {{ testHooks?: unknown }} */ (facade).testHooks = hooks;
    }
  };

  // Host policy: the single implementation lives in src/host-policy.js, which
  // the build inlines into the bundle prologue (with the manifest table). utils
  // only re-exposes the installed policy; tests may install it themselves.
  if (window.YouTubePlusHostPolicy) {
    U.hostPolicy = window.YouTubePlusHostPolicy;
  }

  // -- Plain property assignments (compat surface) --------------------------
  U.openSafe = openSafe;
  U.logError = logError;
  U.debounce = debounce;
  U.waitForElement = waitForElement;
  U.storage = storage;
  /**
   * Full page load of a URL, for flows YouTube's in-page router cannot take.
   * @param {string} url
   */
  U.navigateTo = url => {
    window.location.assign(url);
  };
  U.sanitizeHTML = sanitizeHTML;
  U.escapeHTML = escapeHTML;
  U.safeMerge = safeMerge;
  U.renderTemplateClone =
    U.renderTemplateClone ||
    ((/** @type {Element} */ el, /** @type {string} */ html) =>
      window.YouTubeSafeDOM?.renderTemplateClone?.(el, html));
  U.logger = createLogger();
  if (typeof U.createRetryScheduler !== 'function') {
    U.createRetryScheduler = createRetryScheduler;
  }
  U.$ = $;
  U.$$ = $$;
  U.byId = byId;
  U.t = t;
  U.createHTML = createHTML;
  U.getLanguage = getLanguage;
  U.setSafeHTML = setSafeHTML;
  U.confirmDialog = confirmDialog;
  U.loadFeatureEnabled = loadFeatureEnabled;
  U.SETTINGS_KEY = SETTINGS_KEY;
  U.isWatchPage = isWatchPage;
  U.isShortsPage = isShortsPage;
  U.isChannelPage = isChannelPage;
  U.isStudioPage = isStudioPage;
  U.onDomReady = onDomReady;
  U.formatTime = formatTime;
  U.isEditableTarget = isEditableTarget;
  U.isEditableActiveElement = isEditableActiveElement;
  U.registerListenerSafe = /** @type {typeof U.registerListenerSafe} */ (
    /** @type {unknown} */ (registerListenerSafe)
  );
  U.createExperimentalNavClickHandler =
    U.createExperimentalNavClickHandler || createExperimentalNavClickHandler;
  U.createVisibilityAwareInterval =
    U.createVisibilityAwareInterval || createVisibilityAwareInterval;
  U.exposeTestHooks = exposeTestHooks;

  // -- Cleanup-tracked timer helpers ---------------------------------------
  // Explicit opt-in for modules that want their timers cleared on SPA
  // navigation. We deliberately do NOT wrap `window.setTimeout` globally
  // See the SPA-navigation section below.
  // These helpers are no-ops when `YouTubePlusCleanupManager` is not yet
  // available (e.g. during partial bootstrap or in tests).
  if (typeof U.safeRequestAnimationFrame !== 'function') {
    U.safeRequestAnimationFrame = function (/** @type {FrameRequestCallback} */ cb) {
      const id = requestAnimationFrame(cb);
      U.cleanupManager?.registerAnimationFrame?.(id);
      return id;
    };
  }

  // -- Helpers shorthand ---------------------------------------------------
  // Modules destructure this for the 6-line preamble. `setTimeout_`
  // is intentionally the NATIVE `window.setTimeout` (no global wrap),
  // so SPA navigation cleanup does not touch unrelated timers. Modules
  // that want tracked timers should use `cleanupManager.register*` APIs.
  U.helpers = /** @type {typeof U.helpers} */ (
    /** @type {unknown} */ ({
      $: U.$,
      $$: U.$$,
      byId: U.byId,
      t: U.t,
      logger: U.logger || null,
      createHTML: U.createHTML,
      debounce: U.debounce,
      setTimeout_: setTimeout.bind(window),
      onDomReady: U.onDomReady,
    })
  );

  // -- Runtime activation helpers -----------------------------------------
  // `whenRelevant` / `onSectionActive` live in mutation-coordinator.js,
  // which loads after utils.js in build order, so they are proxied below
  // via lazy getters. By the time either is called (all consumers are
  // feature files that load later), the target is resolved.
  if (!Object.getOwnPropertyDescriptor(U, 'whenRelevant')) {
    Object.defineProperty(U, 'whenRelevant', {
      configurable: true,
      enumerable: true,
      get() {
        return window.YouTubePlusMutationCoordinator?.whenRelevant;
      },
    });
  }
  if (!Object.getOwnPropertyDescriptor(U, 'onSectionActive')) {
    Object.defineProperty(U, 'onSectionActive', {
      configurable: true,
      enumerable: true,
      get() {
        return window.YouTubePlusMutationCoordinator?.onSectionActive;
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Video ID extraction helpers: shared across download, time, playall
  // ---------------------------------------------------------------------------
  /**
   * Extract video ID from a URL string (query param `v` only).
   * @param {string} url
   * @returns {string|null}
   */
  const getVideoIdFromUrl = url => {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
    try {
      // Handle relative URLs by supplying base
      const parsed = new URL(trimmed, 'https://www.youtube.com');
      const fromQuery = parsed.searchParams.get('v');
      if (fromQuery && /^[a-zA-Z0-9_-]{11}$/.test(fromQuery)) return fromQuery;

      const path = parsed.pathname;
      const pathMatch = path.match(/\/(?:shorts|live|embed|v|e)\/([a-zA-Z0-9_-]{11})/);
      if (pathMatch?.[1]) return pathMatch[1];

      if (parsed.hostname === 'youtu.be') {
        const id = path.replace(/^\/+/, '').split('/')[0];
        if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
      }
    } catch (_e) {
      // Regex fallback if URL parsing throws
      const queryMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (queryMatch?.[1]) return queryMatch[1];
      const pathMatch = trimmed.match(
        /(?:\/shorts\/|\/live\/|\/embed\/|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/
      );
      if (pathMatch?.[1]) return pathMatch[1];
    }
    return null;
  };
  /**
   * Running script version from the userscript manager's metadata. The
   * header's @version is written from package.json at build time, so this
   * is the only runtime source, never a hardcoded literal. 'dev' when no
   * manager is present (tests, raw source).
   * @returns {string}
   */
  const getScriptVersion = () => {
    try {
      const info =
        typeof GM_info !== 'undefined'
          ? GM_info
          : /** @type {{ GM_info?: typeof GM_info }} */ (globalThis).GM_info;
      const version = info?.script?.version;
      return typeof version === 'string' && version ? version : 'dev';
    } catch (_e) {
      // no userscript manager
      return 'dev';
    }
  };
  U.getScriptVersion = getScriptVersion;

  /**
   * Resolve the page-realm window. Firefox userscripts expose it as
   * `unsafeWindow`; unwrap the Xray wrapper when `wrappedJSObject` is present.
   * @returns {Window & typeof globalThis}
   */
  const getPageWindow = () => {
    if (typeof unsafeWindow === 'undefined')
      return /** @type {Window & typeof globalThis} */ (window);
    const uw = /** @type {{ wrappedJSObject?: unknown }} */ (unsafeWindow);
    const unwrapped = uw.wrappedJSObject;
    if (unwrapped && typeof unwrapped === 'object') {
      return /** @type {Window & typeof globalThis} */ (unwrapped);
    }
    return unsafeWindow;
  };
  U.getPageWindow = getPageWindow;

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
  U.getVideoIdFromUrl = getVideoIdFromUrl;
  U.getVideoIdFromLocation = getVideoIdFromLocation;

  // ---------------------------------------------------------------------------
  // Cross-cutting side effect: SPA navigation cleanup
  // ---------------------------------------------------------------------------
  // On `yt-navigate-start`, invoke the cleanup manager. Guarded to run once.
  //
  // `window.setTimeout`, `window.setInterval` and `window.requestAnimationFrame`
  // are NOT wrapped globally: a global wrap also clears timers scheduled by the
  // page or by other userscripts, and modules that captured the native function
  // at load time would not see it. Modules that want their timers cleared on SPA
  // navigation use the explicit `YouTubePlusCleanupManager` registration APIs;
  // the manager owns the cleanup call below.
  if (!window.__ytp_nav_cleanup_registered) {
    window.__ytp_nav_cleanup_registered = true;
    // yt-navigate-start is dispatched on window; also listen on document for
    // clients that fire it there. cleanup() is idempotent, so a double
    // dispatch just sweeps twice.
    const onNavStart = () => {
      U.cleanupManager?.cleanup?.();
    };
    registerListenerSafe(document, 'yt-navigate-start', onNavStart);
    registerListenerSafe(window, 'yt-navigate-start', onNavStart);
  }
})();
