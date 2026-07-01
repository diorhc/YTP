// Basic — canonical boot orchestrator for YouTube+.
//
// Responsibility: settings modal shell, YouTubeUtils global surface,
//   NotificationManager, prototype-pollution guards, and the
//   `__ytpBasicInitDone__` idempotency flag.
// Public surface: window.YouTubeUtils (via YouTubePlusDebug shim).
//
// NOTE on removed fallbacks: this file used to ship inlined fallbacks for
// `safeMerge`, `localStorage` reads/writes, and a `basicDangerousKeys_`
// prototype-pollution guard array. Those fallbacks were unreachable in
// production (utils.js + settings-helpers.js are always loaded first by
// build.order.json) and only added ~1.2 KB raw. They have been removed;
// if you ever need to load basic.js in isolation (tests, partial load),
// reintroduce them as a single, well-named compat shim instead of
// scattering them across files.

const basicSetTimeout_ = setTimeout;

/**
 * Modal UI session-state helpers.
 *
 * These are NOT settings. They are per-session UI affordances
 * (which submenus are open, which settings tab was last viewed,
 * which settings section a bookmarklet wants to open). They use
 * a dedicated, non-canonical keyspace so they never collide with
 * the canonical settings object in `youtube_plus_settings`.
 *
 * `modal-handlers.js` and `pip.js` share the same keys, so the
 * helper centralizes read/write and documents the boundary.
 * @type {{
 *   submenuStates: { read: () => Record<string, any>, write: (next: Record<string, any>) => void },
 *   activeNavSection: { read: () => string, write: (id: string) => void },
 *   lastOpenSection: { read: () => string, write: (id: string) => void },
 * }}
 */
const basicUiState_ = {
  submenuStates: {
    read() {
      try {
        const raw = localStorage.getItem('ytp-plus-submenu-states');
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (e) {
        YouTubePlusLogger?.warn?.('Basic', 'Submenu state read failed', e);
        return {};
      }
    },
    write(/** @type {Record<string, any>} */ next) {
      try {
        localStorage.setItem('ytp-plus-submenu-states', JSON.stringify(next || {}));
      } catch (e) {
        YouTubePlusLogger?.warn?.('Basic', 'Submenu state write failed', e);
      }
    },
  },
  activeNavSection: {
    read() {
      try {
        return localStorage.getItem('ytp-plus-active-nav-section') || '';
      } catch (_e) {
        return '';
      }
    },
    write(/** @type {string} */ id) {
      try {
        localStorage.setItem('ytp-plus-active-nav-section', id);
      } catch (_e) {
        window.YouTubePlusErrorBoundary?.logError?.(
          _e instanceof Error ? _e : new Error(String(_e)),
          { module: 'Basic' }
        );
      }
    },
  },
  lastOpenSection: {
    read() {
      try {
        return localStorage.getItem('youtube_plus_last_active_section') || '';
      } catch (_e) {
        return '';
      }
    },
    write(/** @type {string} */ id) {
      try {
        localStorage.setItem('youtube_plus_last_active_section', id);
      } catch (_e) {
        window.YouTubePlusErrorBoundary?.logError?.(
          _e instanceof Error ? _e : new Error(String(_e)),
          { module: 'Basic' }
        );
      }
    },
  },
};

/**
 * Submenu selector resolver.
 *
 * Both the click-toggle path (handleModalClick → submenu toggle) and
 * the restore-on-open path (createSettingsModal → submenu state
 * restoration) need to find the panel-relative element for a given
 * `data-submenu` key. The key→selector map was previously duplicated
 * inline in both places and drifted slightly. Centralising it here
 * keeps the two paths in lockstep and makes future submenus a
 * one-line addition.
 *
 * Unknown keys fall back to a generic `[data-submenu="…"]` selector
 * so feature modules can ship their own submenu cards without
 * needing a basic.js change.
 */
const basicSubmenuSelector_ = (/** @type {string} */ key) => {
  switch (key) {
    case 'music':
      return `.music-submenu[data-submenu="${key}"]`;
    case 'download':
      return `.download-submenu[data-submenu="${key}"]`;
    case 'style':
      return `.style-submenu[data-submenu="${key}"]`;
    case 'speed':
      return `.speed-submenu[data-submenu="${key}"]`;
    case 'loop':
      return `.loop-submenu[data-submenu="${key}"]`;
    case 'pip':
      return `.pip-submenu[data-submenu="${key}"]`;
    case 'timecode':
      return `.timecode-submenu[data-submenu="${key}"]`;
    case 'enhanced':
      return `.enhanced-submenu[data-submenu="${key}"]`;
    default:
      return `[data-submenu="${key}"]`;
  }
};

/**
 * Normalize a hotkey map (`{ key: value, ... }`) in place.
 * Each value is run through `normalizeSpeedHotkey_` (a tiny
 * single-character lowercase clamp) against the matching
 * default. Returns the (possibly freshly allocated) map so
 * callers can reassign.
 *
 * Replaces 7 lines of `this.settings.X[k] = this.normalizeSpeedHotkey(...)`
 * that previously appeared inline in `init()`. Keeping the
 * helper at module scope (rather than as a YouTubeEnhancer
 * method) keeps it out of the per-instance surface — it is
 * a pure transform on data, not a method that participates
 * in lifecycle.
 *
 * The generic `D` lets the inferred return type match the
 * `defaults` shape exactly, so callers can assign the result
 * to a typed hotkey object without a cast.
 *
 * @template {{ [key: string]: string }} D
 * @param {Record<string, any> | null | undefined} source
 * @param {D} defaults
 * @returns {D}
 */
const basicNormalizeHotkeyMap_ = (source, defaults) => {
  /** @type {Record<string, any>} */
  const out = { ...(source && typeof source === 'object' ? source : {}) };
  for (const key of Object.keys(defaults)) {
    out[key] = basicNormalizeSingleHotkey_(out[key], defaults[key]);
  }
  return /** @type {D} */ (out);
};

/**
 * Clamp a single hotkey value to a single lowercase character.
 * Pure function; mirrors the historical inline
 * `normalizeSpeedHotkey` logic without the per-instance
 * method indirection. Public surface (YouTubeEnhancer.normalizeSpeedHotkey)
 * is preserved for the keydown handler that still uses it.
 * @param {any} value
 * @param {string} fallback
 * @returns {string}
 */
const basicNormalizeSingleHotkey_ = (value, fallback) => {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (candidate) return candidate.slice(0, 1);
  return (
    String(fallback || '')
      .trim()
      .toLowerCase()
      .slice(0, 1) || 'g'
  );
};

/**
 * Stable CSS class / id strings for the launcher elements basic.js
 * mounts on the host page. Centralising them here avoids the
 * "same selector string duplicated across N methods" smell that
 * is the most common source of "settings button not appearing"
 * regressions when the class is renamed.
 */
const BASIC_SETTINGS_BUTTON_SEL_ = '.ytp-plus-settings-button';
const BASIC_GUIDE_TOGGLE_BTN_ID_ = 'ytplus-guide-toggle-btn';
const _BASIC_NAV_ITEM_SEL_ = '.ytp-plus-settings-nav-item';
const _BASIC_NAV_SECTION_SEL_ = '.ytp-plus-settings-section';
const _BASIC_NAV_PANEL_SEL_ = '.ytp-plus-settings-panel';
const BASIC_NOTIF_CONTAINER_ID_ = 'youtube-enhancer-notification-container';
const BASIC_NOTIF_CLASS_ = 'youtube-enhancer-notification';

/**
 * Idempotent UI guards.
 *
 * The mount paths (settings button, guide toggle button) are
 * reachable from multiple call sites (init, navigation finish,
 * popstate, URL change fallback) and the NotificationManager is
 * a hot path. Each guard uses the canonical DOM cache when
 * available, and falls back to a direct `querySelector` only when
 * the cache has not installed itself (partial load / test harness).
 */
const basicHasSettingsButton_ = () => {
  const cache = /** @type {any} */ (window).YouTubePlusDOMCache;
  if (cache && typeof cache.querySelector === 'function') {
    return !!cache.querySelector(BASIC_SETTINGS_BUTTON_SEL_, document, true);
  }
  return typeof document !== 'undefined' && !!document.querySelector(BASIC_SETTINGS_BUTTON_SEL_);
};
const basicHasGuideToggleButton_ = () => {
  const cache = /** @type {any} */ (window).YouTubePlusDOMCache;
  if (cache && typeof cache.getElementById === 'function') {
    return !!cache.getElementById(BASIC_GUIDE_TOGGLE_BTN_ID_);
  }
  return typeof document !== 'undefined' && !!document.getElementById(BASIC_GUIDE_TOGGLE_BTN_ID_);
};

/**
 * Fallback implementations for core YouTubeUtils properties.
 * These are merged into `window.YouTubeUtils` only when the
 * canonical owner (utils.js) hasn't already set them.
 * The IIFE avoids polluting module scope; its return value is
 * merged into the global and then discarded.
 */
const basicFallbackUtils_ = (() => {
  const canonical = window.YouTubeUtils || {};
  const Storage = window.YouTubePlusStorage || {};

  /**
   * Translation function with fallback support
   * Uses centralized i18n from YouTubePlusI18n
   * @param {string} key - Translation key
   * @param {any} params - Parameters for interpolation
   * @returns {string} Translated string
   */
  // Resolve translations from the active i18n module, with safe fallback.
  const t =
    canonical.t ||
    ((/** @type {string} */ key, /** @type {Record<string, any>} */ params = {}) => {
      const i18n = /** @type {any} */ (window.YouTubePlusI18n);
      const translator = i18n?.translate || i18n?.t;
      if (typeof translator === 'function') {
        try {
          return translator(key, params);
        } catch (_e) {
          // Fall through to interpolation fallback below.
        }
      }
      if (!key) return '';
      let result = String(key);
      for (const [k, v] of Object.entries(params || {})) {
        const token = `{${k}}`;
        result = result.split(token).join(String(v));
      }
      return result;
    });

  const logError =
    canonical.logError ||
    ((module, message, error) => {
      const sink = window.YouTubePlusLogger?.error || console.error;
      sink(`[${module}]`, message, error);
    });

  // Use storage helper or fallback
  /** @type {{ get: <T = unknown>(key: string, defaultValue?: T) => T; set: (key: string, value: unknown) => boolean; remove: (key: string) => void }} */
  const storage = /** @type {any} */ (
    canonical.storage ||
      Storage || {
        get: (/** @type {any} */ key, defaultValue = null) => {
          try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : defaultValue;
          } catch (_e) {
            return defaultValue;
          }
        },
        set: (/** @type {any} */ key, /** @type {any} */ value) => {
          try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
          } catch (_e) {
            return false;
          }
        },
        remove: (/** @type {any} */ key) => {
          try {
            localStorage.removeItem(key);
            return true;
          } catch (_e) {
            return false;
          }
        },
      }
  );

  const cleanupManager = canonical.cleanupManager;

  /**
   * Local DOM factory fallback used by NotificationManager.
   * Canonical owner is utils.js, but basic.js keeps this minimal
   * implementation so notifications still work even if the global
   * facade is partially unavailable during boot.
   * @param {string} tag
   * @param {Record<string, unknown>} [props]
   * @param {(string | Node)[]} [children]
   * @returns {HTMLElement}
   */
  const createElement =
    canonical.createElement ||
    ((tag, props = {}, children = []) => {
      const element = document.createElement(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (k === 'className') element.className = String(v);
        else if (k === 'style' && v && typeof v === 'object') Object.assign(element.style, v);
        else if (k === 'dataset' && v && typeof v === 'object') Object.assign(element.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') {
          element.addEventListener(k.slice(2).toLowerCase(), /** @type {EventListener} */ (v));
        } else if (v !== undefined && v !== null) {
          element.setAttribute(k, String(v));
        }
      }
      for (const child of children) {
        if (typeof child === 'string') element.appendChild(document.createTextNode(child));
        else if (child instanceof Node) element.appendChild(child);
      }
      return element;
    });

  /**
   * Settings Manager (compatibility shim)
   *
   * Historically, basic.js owned a v2 settings container keyed on
   * `youtube_plus_all_settings_v2`. That ownership has been moved to
   * the canonical `YouTubePlusSettingsStore` (settings-helpers.js);
   * basic.js now keeps `YouTubeEnhancer.settings` as an in-memory
   * working copy and routes persistence through the store.
   *
   * This shim preserves the small public surface (load / save /
   * get / set) so legacy callers (notably report.js's debug-info
   * snapshot, which guards with `typeof Y?.SettingsManager === 'object'`)
   * keep working without changes. All persistence flows through
   * the store; if the store is unavailable the shim falls back to
   * a one-shot, in-memory-only read so callers do not crash.
   *
   * Note: the legacy `youtube-plus-settings-changed` event is no
   * longer dispatched. Modules that need to react to settings
   * changes should listen for the canonical
   * `youtube-plus-settings-updated` event (fired by the store).
   */
  const SettingsManager = {
    /**
     * @returns {Record<string, any> | null} Current settings snapshot,
     *   or null when neither the store nor an in-memory cache can
     *   produce one.
     */
    load() {
      const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
      if (store && typeof store.load === 'function') {
        try {
          const v = store.load();
          return v && typeof v === 'object' ? v : null;
        } catch (e) {
          YouTubePlusLogger?.warn?.('Basic', 'SettingsManager.load via store failed', e);
        }
      }
      return null;
    },

    /**
     * @param {Record<string, any> | null | undefined} settings
     * @returns {boolean} true when persistence succeeded.
     */
    save(settings) {
      const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
      if (store && typeof store.save === 'function') {
        try {
          store.save(settings && typeof settings === 'object' ? settings : {});
          return true;
        } catch (e) {
          YouTubePlusLogger?.warn?.('Basic', 'SettingsManager.save via store failed', e);
          return false;
        }
      }
      return false;
    },

    /**
     * Read a setting by dot-path. Returns `undefined` when the
     * value is not present.
     * @param {string} path
     * @returns {*}
     */
    get(path) {
      const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
      if (store && typeof store.get === 'function') {
        return store.get(path);
      }
      return undefined;
    },

    /**
     * Write a setting by dot-path. Persists and dispatches the
     * canonical `youtube-plus-settings-updated` event via the store.
     * @param {string} path
     * @param {*} value
     * @returns {boolean}
     */
    set(path, value) {
      const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
      if (store && typeof store.set === 'function') {
        return store.set(path, value) === true;
      }
      return false;
    },
  };

  const StyleManager = window.YouTubePlusDesignSystem?.StyleManager || null;

  /**
   * Centralized Notification System
   * Manages all notifications with queue and deduplication
   */
  const NotificationManager = {
    /** @type {any[]} */
    queue: [],
    activeNotifications: new Set(),
    maxVisible: 3,
    defaultDuration: 3000,

    /**
     * Show notification
     * @param {string} message - Notification message
     * @param {{duration?: number, position?: string | null, action?: {text: string, callback: Function} | null, type?: string}} [options] - Notification options
     * @returns {HTMLElement | null} Notification element
     */
    show(message, options = {}) {
      // Validate message
      if (!message || typeof message !== 'string') {
        logError(
          'NotificationManager',
          'Invalid message',
          new Error('Message must be a non-empty string')
        );
        return null;
      }

      const {
        duration = this.defaultDuration,
        position = null,
        action = null, // { text: string, callback: function }
      } = options;

      // Remove duplicate messages
      this.activeNotifications.forEach(notif => {
        if (notif.dataset.message === message) {
          this.remove(notif);
        }
      });

      const positions = {
        'top-right': { top: '20px', right: '20px' },
        'top-left': { top: '20px', left: '20px' },
        'bottom-right': { bottom: '20px', right: '20px' },
        'bottom-left': { bottom: '20px', left: '20px' },
      };

      try {
        // Use shared enhancer notification class for consistent appearance
        const notification = /** @type {any} */ (
          createElement('div', {
            className: BASIC_NOTIF_CLASS_,
            dataset: { message }, // Store message for deduplication
            // Keep minimal inline styles; main visuals come from the shared CSS class
            style: {
              zIndex: '10001',
              width: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              ...(position && /** @type {any} */ (positions)[position]
                ? /** @type {any} */ (positions)[position]
                : {}),
            },
          })
        );

        // Add message (with accessibility attributes)
        notification.setAttribute('role', 'status');
        notification.setAttribute('aria-live', 'polite');
        notification.setAttribute('aria-atomic', 'true');

        const messageSpan = createElement(
          'span',
          {
            style: { flex: '1' },
          },
          [message]
        );
        notification.appendChild(messageSpan);

        // Add action button if provided
        if (action?.text && typeof action.callback === 'function') {
          const actionBtn = createElement(
            'button',
            {
              style: {
                background: 'var(--yt-button-bg)',
                border: '1px solid var(--yt-glass-border)',
                color: 'white',
                padding: '4px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                transition: 'background 0.2s',
              },
              onClick: () => {
                action.callback();
                this.remove(notification);
              },
            },
            [action.text]
          );
          notification.appendChild(actionBtn);
        }

        // Ensure a centralized bottom-center container exists and add notification there
        const _notifContainerId = BASIC_NOTIF_CONTAINER_ID_;
        let _notifContainer =
          /** @type {any} */ (window).YouTubePlusDOMCache?.getElementById?.(_notifContainerId) ||
          (typeof document !== 'undefined' ? document.getElementById(_notifContainerId) : null);
        if (!_notifContainer) {
          _notifContainer = createElement('div', {
            id: _notifContainerId,
            className: 'youtube-enhancer-notification-container',
          });
          try {
            const appendRoot = document.body || document.documentElement;
            if (appendRoot) {
              appendRoot.appendChild(_notifContainer);
            } else {
              return null;
            }
          } catch (_e) {
            // fallback to body append if container append fails
            const appendRoot = document.body || document.documentElement;
            if (appendRoot) {
              appendRoot.appendChild(notification);
              this.activeNotifications.add(notification);
            }
          }
        }

        try {
          // Prepend so newest notifications appear on top
          _notifContainer.insertBefore(notification, _notifContainer.firstChild);
        } catch (_e) {
          // fallback
          const appendRoot = document.body || document.documentElement;
          if (appendRoot) appendRoot.appendChild(notification);
        }
        // ensure notification accepts pointer events (container is pointer-events:none)
        try {
          notification.style.pointerEvents = 'auto';
        } catch (_e) {
          /* style may be read-only */
        }
        this.activeNotifications.add(notification);

        // Apply entry animation from bottom
        try {
          notification.style.animation = 'slideInFromBottom 0.38s ease-out forwards';
        } catch (_e) {
          /* animation may be unsupported */
        }

        // Auto-dismiss
        if (duration > 0) {
          const timeoutId = basicSetTimeout_(() => this.remove(notification), duration);
          cleanupManager.registerTimeout(timeoutId);
        }

        // Limit visible notifications
        if (this.activeNotifications.size > this.maxVisible) {
          const oldest = Array.from(this.activeNotifications)[0];
          this.remove(oldest);
        }

        return notification;
      } catch (error) {
        logError('NotificationManager', 'Failed to show notification', /** @type {any} */ (error));
        return null;
      }
    },

    /**
     * Remove notification
     * @param {HTMLElement} notification - Notification element
     */
    remove(/** @type {any} */ notification) {
      if (!notification?.isConnected) return;

      try {
        try {
          notification.style.animation = 'slideOutToBottom 0.32s ease-in forwards';
          const timeoutId = basicSetTimeout_(() => {
            try {
              notification.remove();
              this.activeNotifications.delete(notification);
            } catch (e) {
              logError(
                'NotificationManager',
                'Failed to remove notification',
                /** @type {any} */ (e)
              );
            }
          }, 340);
          cleanupManager.registerTimeout(timeoutId);
        } catch (_e) {
          // Fallback: immediate removal
          try {
            notification.remove();
            this.activeNotifications.delete(notification);
          } catch (e) {
            logError(
              'NotificationManager',
              'Failed to remove notification (fallback)',
              /** @type {any} */ (e)
            );
          }
        }
      } catch (error) {
        logError(
          'NotificationManager',
          'Failed to animate notification removal',
          /** @type {any} */ (error)
        );
        // Force remove
        notification.remove();
        this.activeNotifications.delete(notification);
      }
    },

    /**
     * Clear all notifications
     */
    clearAll() {
      this.activeNotifications.forEach(notif => {
        try {
          notif.remove();
        } catch (e) {
          logError('NotificationManager', 'Failed to clear notification', /** @type {any} */ (e));
        }
      });
      this.activeNotifications.clear();
    },
  };

  // Global cleanup on page unload
  window.addEventListener('beforeunload', () => {
    cleanupManager.cleanup();
    window.YouTubePlusDOMCache?.invalidate?.();
    StyleManager?.clear();
    NotificationManager.clearAll();
  });

  /**
   * Backward-compatible cache clear that now delegates to canonical DOM cache.
   */
  const clearCache = () => {
    window.YouTubePlusDOMCache?.invalidate?.();
  };

  // Global error handler for uncaught promise rejections
  cleanupManager.registerListener(window, 'unhandledrejection', (/** @type {any} */ event) => {
    logError('Global', 'Unhandled promise rejection', event.reason);
    event.preventDefault(); // Prevent console spam
  });

  // Global error handler for uncaught errors
  cleanupManager.registerListener(window, 'error', (/** @type {any} */ event) => {
    const message = String(event?.message || '');
    const errorMessage = String(event?.error?.message || '');
    if (message.includes('ResizeObserver loop') || errorMessage.includes('ResizeObserver loop')) {
      return;
    }

    // Only log errors from our script
    if (event.filename?.includes('youtube')) {
      logError(
        'Global',
        'Uncaught error',
        new Error(`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`)
      );
    }
  });

  // Export public API — logError and StyleManager are already set by utils.js.
  // Cast the return to `any` to break the recursive type inference
  // so the file can pass strict typecheck. The runtime shape is unchanged
  // and downstream JSDoc consumers (utils.js, design-system.js, etc.)
  // get the real `YouTubeUtilsAPI` type via `window.YouTubeUtils`.
  return /** @type {any} */ ({
    logError,
    storage,
    cleanupManager,
    SettingsManager,
    NotificationManager,
    clearCache,
    t,
    createElement,
    get StyleManager() {
      return canonical.StyleManager || window.YouTubePlusDesignSystem?.StyleManager || null;
    },
  });
})();

// Make available globally
if (typeof window !== 'undefined') {
  // Merge fallback utilities into existing global YouTubeUtils without overwriting
  window.YouTubeUtils = /** @type {any} */ (window.YouTubeUtils || {});
  const existing = /** @type {any} */ (window.YouTubeUtils);
  try {
    for (const k of Object.keys(basicFallbackUtils_)) {
      if (existing[k] === undefined) existing[k] = /** @type {any} */ (basicFallbackUtils_)[k];
    }
  } catch (e) {
    YouTubePlusLogger?.error?.('Basic', 'Failed to merge core utilities', e);
  }

  // Local alias for downstream code in this file
  const YouTubeUtils = /** @type {any} */ (window.YouTubeUtils);

  // Add initialization health check (non-intrusive)
  window.YouTubeUtils &&
    /** @type {any} */ (YouTubeUtils).logger?.debug?.('[YouTube+ v2.4.5] Core utilities merged');

  /**
   * @typedef {Object} YouTubePlusDebugAPI
   * @property {string} version - Current extension version
   * @property {() => number} cacheSize - Get total number of tracked resources (observers + listeners + intervals)
   * @property {() => void} clearAll - Cleanup all resources, clear caches and styles
   * @property {() => { observers: number, listeners: number, intervals: number, timeouts: number, animationFrames: number, styles: number, notifications: number }} stats - Get resource tracking statistics
   */

  /** @type {YouTubePlusDebugAPI} */
  window.YouTubePlusDebug = /** @type {any} */ ({
    version: '2.5.2',
    cacheSize: () =>
      YouTubeUtils.cleanupManager.observers.size +
      YouTubeUtils.cleanupManager.listeners.size +
      YouTubeUtils.cleanupManager.intervals.size,
    clearAll: () => {
      YouTubeUtils.cleanupManager.cleanup();
      YouTubeUtils.clearCache();
      YouTubeUtils.StyleManager.clear();
      YouTubeUtils.NotificationManager.clearAll();
      window.YouTubeUtils &&
        /** @type {any} */ (YouTubeUtils).logger?.debug?.('[YouTube+] All resources cleared');
    },
    stats: () => ({
      observers: YouTubeUtils.cleanupManager.observers.size,
      listeners: YouTubeUtils.cleanupManager.listeners.size,
      intervals: YouTubeUtils.cleanupManager.intervals.size,
      timeouts: YouTubeUtils.cleanupManager.timeouts.size,
      animationFrames: YouTubeUtils.cleanupManager.animationFrames.size,
      styles: /** @type {any} */ (YouTubeUtils.StyleManager).styles.size,
      notifications: YouTubeUtils.NotificationManager.activeNotifications.size,
    }),
  });
  if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.YouTubePlusDebug = window.YouTubePlusDebug;
  }

  // Show subtle startup notification (only once per session). Wrap the
  // sessionStorage access in a try/catch so sandboxed contexts (about:blank,
  // detached iframe, hardened YouTube embeds) where sessionStorage throws
  // a SecurityError do not abort the rest of the boot sequence — a
  // non-critical startup banner must never break module init.
  let firstStart = true;
  try {
    if (typeof sessionStorage !== 'undefined') {
      firstStart = !sessionStorage.getItem('youtube_plus_started');
      if (firstStart) sessionStorage.setItem('youtube_plus_started', 'true');
    }
  } catch (_e) {
    // sessionStorage unavailable (sandboxed page) — assume first start.
    firstStart = true;
  }
  if (firstStart) {
    basicSetTimeout_(() => {
      if (YouTubeUtils.NotificationManager) {
        YouTubeUtils.NotificationManager.show('YouTube+ v2.5.2 loaded', {
          type: 'success',
          duration: 2000,
          position: 'bottom-right',
        });
      }
    }, 1000);
  }
}
// YouTube enhancements module
(function () {
  const YouTubeUtils = /** @type {any} */ (window.YouTubeUtils);
  const _setSafeHTML = YouTubeUtils.setSafeHTML;

  // Local reference to translation function
  const { t } = YouTubeUtils;

  const YouTubeEnhancer = {
    // Speed control variables
    speedControl: {
      currentSpeed: 1,
      activeAnimationId: null,
      storageKey: 'youtube_playback_speed',
      availableSpeeds: [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0],
    },

    _initialized: false,

    // Stable handler references. Kept on the instance so repeated
    // `init()` calls (or future retry paths) hand the same function
    // reference to the cleanupManager. The manager dedupes by
    // (target, event, fn) identity, so storing the reference also
    // makes the registration idempotent against a defensive
    // re-entry that bypasses the `_initialized` flag.
    //
    // The explicit `(() => void) | null` type is the strict-check
    // shape — JSDoc-inferred type from the `null` literal would
    // be just `null`, which a function assignment cannot satisfy.
    /** @type {(() => void) | null} */ _onVisibilityChange_: null,
    /** @type {((e: any) => void) | null} */ _onLoopHotkey_: null,
    /** @type {(() => void) | null} */ _onFullscreenChange_: null,
    /** @type {(() => void) | null} */ _onPopState_: null,
    /** @type {(() => void) | null} */ _onNavigateStart_: null,
    /** @type {(() => void) | null} */ _onNavigateFinish_: null,
    /** @type {boolean} */ _navigationObserverStarted: false,

    // Settings
    settings: {
      enableSpeedControl: true,
      speedControlHotkeys: {
        decrease: 'g',
        increase: 'h',
        reset: 'b',
      },
      enableScreenshot: true,
      enableDownload: true,

      // Basic: optional UI/style tweaks (style.js)
      enableZenStyles: true,
      zenStyles: {
        thumbnailHover: true,
        immersiveSearch: true,
        hideVoiceSearch: true,
        transparentHeader: true,
        hideSideGuide: true,
        cleanSideGuide: false,
        fixFeedLayout: true,
        sideVideosColumnsEnabled: false,
        sideVideosColumns: 0,
        betterCaptions: true,
        playerBlur: true,
        theaterEnhancements: true,
      },

      // Enhanced features (advanced tab)
      enableEnhanced: true,
      enableTabview: true,
      enableCommentTranslate: true,
      enablePlayAll: true,
      enableResumeTime: true,
      enableZoom: true,
      enableThumbnail: true,
      enablePlaylistSearch: true,
      enableScrollToTopButton: true,
      enableRememberManualQuality: true,

      // Loop settings
      enableLoop: true,
      loopHotkeys: {
        toggleLoop: 'r',
        setPointA: 'k',
        setPointB: 'l',
        resetPoints: 'o',
      },

      // Состояние сайтов внутри сабменю кнопки Download (ytdl всегда включён)
      downloadSites: {
        direct: true,
        externalDownloader: true,
        ytdl: true,
      },
      // Настройки кастомизации download сайтов
      downloadSiteCustomization: {
        externalDownloader:
          typeof window !== 'undefined' && window.YouTubePlusConstants
            ? window.YouTubePlusConstants.DOWNLOAD_SITES.EXTERNAL_DOWNLOADER
            : {
                name: 'SSYouTube',
                url: 'https://ssyoutube.com/watch?v={videoId}',
              },
      },
      storageKey: window.YouTubeUtils?.SETTINGS_KEY || 'youtube_plus_settings',
      // runtime setting: hide left side guide/footer when true
      hideSideGuide: false,
    },

    // Cached element getter.
    //
    // Routes through the canonical DOM cache (YouTubePlusDOMCache) so
    // basic.js stops maintaining its own per-instance `Map`. The
    // canonical cache already provides TTL-based caching, a
    // single shared observer for `waitForElement`, and a global
    // `invalidate()` / `clear()` surface. The `useCache` parameter
    // maps to the cache's `skipCache` flag so existing callers
    // (`useCache = false`) still force a fresh query.
    //
    // A small `isConnected` re-check is kept as a local safety net
    // because the canonical cache's 5s TTL for found elements is
    // longer than a typical YouTube SPA teardown cycle, and a stale
    // detached element can break mount logic on the next navigation.
    getElement(/** @type {string} */ selector, useCache = true) {
      const cache = /** @type {any} */ (window).YouTubePlusDOMCache;
      if (!cache || typeof cache.querySelector !== 'function') {
        return typeof document !== 'undefined' ? document.querySelector(selector) : null;
      }
      if (useCache) {
        // Cache.get uses the canonical TTL. Manually verify the
        // element is still attached before returning it.
        const cached = cache.get(selector);
        if (cached && /** @type {any} */ (cached).isConnected) return cached;
        if (cached) {
          // Detached — drop from the canonical cache so the next
          // querySelector below repopulates it cleanly.
          try {
            cache.invalidate?.(selector);
          } catch {}
        }
      }
      return cache.querySelector(selector, document, !useCache);
    },

    loadSettings() {
      // Route canonical settings reads through the store. The store
      // handles reading from `youtube_plus_settings`, migration from
      // the legacy `youtube_plus_all_settings_v2` key, and merging
      // with defaults. basic.js keeps `this.settings` as its
      // in-memory working copy (mutated throughout the module), so
      // we merge the store's result into it rather than replacing it.
      try {
        const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
        const canonical = store && typeof store.load === 'function' ? store.load() : null;
        if (!canonical || typeof canonical !== 'object') return;
        const source = canonical;
        if (!source) return;
        if (window.YouTubeUtils?.safeMerge) {
          window.YouTubeUtils.safeMerge(this.settings, source);
        } else if (typeof source === 'object') {
          Object.assign(this.settings, source);
        }
      } catch (e) {
        YouTubePlusLogger?.error?.('Basic', 'Error loading settings', e);
      }
    },

    /**
     * Init orchestrator. Decomposed into named phases so the
     * boot order is explicit and each phase is independently
     * testable / debuggable.
     *
     * Phase order (must not be reordered casually):
     *   1. loadAndNormalizeSettings_   — store → in-memory working copy
     *   2. mountBootUI_                — styles + settings button + nav
     *   3. setupCurrentPageIfWatch_    — page mount (only on /watch)
     *   4. registerVisibilityListener_ — SPA tab-return handler
     *   5. registerFeatureHotkeys_     — feature-owned hotkey hooks
     *   6. registerLoopHotkeyHandler_  — loop control keybind
     *
     * Idempotency: the `_initialized` flag is set BEFORE the
     * phases run so any throw leaves a half-initialized state
     * that still early-returns on the next call. The window-level
     * `__ytpBasicInitDone__` guard is the primary defense; the
     * per-instance flag is defense-in-depth for the same-instance
     * retry case.
     */
    init() {
      if (this._initialized) {
        return;
      }
      this._initialized = true;

      this.loadAndNormalizeSettings_();
      this.mountBootUI_();
      this.setupCurrentPageIfWatch_();
      this.registerVisibilityListener_();
      this.registerFeatureHotkeys_();
      this.registerLoopHotkeyHandler_();
    },

    /**
     * Phase 1: load settings from the canonical store, run
     * the legacy-hotkey migration, normalize all hotkey values,
     * and restore the saved playback speed.
     *
     * Each sub-step is independently try/catch'd so a single
     * bad value (e.g. corrupted `youtube_playback_speed` in
     * localStorage) cannot abort the rest of init.
     */
    loadAndNormalizeSettings_() {
      try {
        this.loadSettings();
        this.migrateLegacyLoopHotkeys_();
        this.normalizeAllHotkeys_();
        this.restorePlaybackSpeed_();
      } catch (error) {
        YouTubePlusLogger?.warn?.('Basic', 'Failed to load settings during init', error);
      }
    },

    /**
     * One-shot legacy migration. Older users have loop hotkey
     * values that match what the new defaults are now, so we
     * swap them in place and persist a single time.
     */
    migrateLegacyLoopHotkeys_() {
      try {
        const lh = this.settings.loopHotkeys || {};
        let migrated = false;
        // previous defaults: setPointA: 'l', setPointB: 'o', resetPoints: 'k'
        if (lh.setPointA === 'l') {
          lh.setPointA = 'k';
          migrated = true;
        }
        if (lh.setPointB === 'o') {
          lh.setPointB = 'l';
          migrated = true;
        }
        if (lh.resetPoints === 'k') {
          lh.resetPoints = 'o';
          migrated = true;
        }
        if (migrated) {
          this.settings.loopHotkeys = lh;
          try {
            this.saveSettings();
          } catch (e) {
            YouTubePlusLogger?.warn?.('Basic', 'Failed to save migrated loop hotkeys', e);
          }
        }
      } catch (_e) {
        /* ignore migration errors */
      }
    },

    /**
     * Normalize every hotkey value in `this.settings.*Hotkeys` to
     * a single lowercase character. The previous shape ran
     * `normalizeSpeedHotkey` 7 times inline; extracting the loop
     * keeps the orchestrator readable and makes future hotkey
     * groups a one-line addition.
     */
    normalizeAllHotkeys_() {
      const speedDefaults = { decrease: 'g', increase: 'h', reset: 'b' };
      const loopDefaults = {
        toggleLoop: 'r',
        setPointA: 'k',
        setPointB: 'l',
        resetPoints: 'o',
      };
      this.settings.speedControlHotkeys = basicNormalizeHotkeyMap_(
        /** @type {any} */ (this.settings).speedControlHotkeys,
        speedDefaults
      );
      this.settings.loopHotkeys = basicNormalizeHotkeyMap_(this.settings.loopHotkeys, loopDefaults);
    },

    /**
     * Restore the last-used playback speed from localStorage.
     * Bounded to a sane range (0 < speed <= 16) so a corrupted
     * value can never poison the working copy.
     */
    restorePlaybackSpeed_() {
      try {
        const savedSpeed = localStorage.getItem(this.speedControl.storageKey);
        if (savedSpeed !== null) {
          const parsed = Number(savedSpeed);
          if (Number.isFinite(parsed) && parsed > 0 && parsed <= 16) {
            this.speedControl.currentSpeed = parsed;
          }
        }
      } catch (e) {
        YouTubePlusLogger?.warn?.('Basic', 'Speed restore error', e);
      }
    },

    /**
     * Phase 2: insert styles, mount the settings launcher
     * button, and set up the SPA navigation observer. All three
     * are idempotent (StyleManager.add is idempotent,
     * addSettingsButtonToHeader short-circuits via
     * basicHasSettingsButton_, setupNavigationObserver is
     * guarded by `_navigationObserverStarted`).
     */
    mountBootUI_() {
      this.insertStyles();
      this.addSettingsButtonToHeader();
      this.setupNavigationObserver();

      // YouTube can replace layout/head fragments shortly after boot.
      // Replay the core style registration once more after initial mount
      // so settings/modal shell styles do not end up missing on the
      // first settled paint.
      basicSetTimeout_(() => {
        try {
          this.insertStyles();
        } catch (_e) {
          window.YouTubePlusErrorBoundary?.logError?.(
            _e instanceof Error ? _e : new Error(String(_e)),
            { module: 'Basic' }
          );
        }
      }, 1200);
    },

    /**
     * Phase 3: mount the per-page UI only on a /watch page. The
     * existing test harness uses pathname: '/watch' so this
     * gate must remain a `location.href.includes('watch?v=')`
     * substring match (not an exact-host match).
     */
    setupCurrentPageIfWatch_() {
      if (location.href.includes('watch?v=')) {
        this.setupCurrentPage();
      }
    },

    /**
     * Phase 4: when the tab returns to the foreground on a
     * /watch page, re-run the per-page mount. The handler is
     * stored on the instance so a defensive re-registration
     * passes the same reference to the cleanupManager (the
     * manager dedupes by `(target, event, fn)` identity).
     */
    registerVisibilityListener_() {
      if (this._onVisibilityChange_) return;

      this._onVisibilityChange_ = () => {
        if (!document.hidden && location.href.includes('watch?v=')) {
          this.setupCurrentPage();
        }
      };
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'visibilitychange',
        this._onVisibilityChange_
      );
    },

    /**
     * Phase 5: delegate hotkey registration to the feature
     * modules. Each delegation is independently try/catch'd so
     * a single broken module cannot prevent the others from
     * registering.
     */
    registerFeatureHotkeys_() {
      try {
        window.YouTubePlusScreenshot?.registerHotkey?.(this);
      } catch (e) {
        YouTubeUtils?.logError?.(
          'Basic',
          'Failed to initialize screenshot hotkey module',
          /** @type {any} */ (e)
        );
      }

      try {
        window.YouTubePlusSpeedControl?.registerHotkeys?.(this);
      } catch (e) {
        YouTubeUtils?.logError?.(
          'Basic',
          'Failed to initialize speed hotkey module',
          /** @type {any} */ (e)
        );
      }
    },

    /**
     * Phase 6: install the loop-control keydown handler.
     * Stored on the instance so a defensive re-registration
     * passes the same reference to the cleanupManager.
     */
    registerLoopHotkeyHandler_() {
      try {
        if (this._onLoopHotkey_) return;

        this._onLoopHotkey_ = (/** @type {any} */ e) => {
          if (!(this.settings.enableLoop && e?.key)) return;
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          if (this.isEditableTarget(document.activeElement)) return;

          const key = String(e.key).toLowerCase();
          const toggleLoopKey = this.normalizeSpeedHotkey(
            this.settings.loopHotkeys?.toggleLoop,
            'r'
          );
          const setPointAKey = this.normalizeSpeedHotkey(this.settings.loopHotkeys?.setPointA, 'k');
          const setPointBKey = this.normalizeSpeedHotkey(this.settings.loopHotkeys?.setPointB, 'l');
          const resetPointsKey = this.normalizeSpeedHotkey(
            this.settings.loopHotkeys?.resetPoints,
            'o'
          );

          if (key === toggleLoopKey) {
            e.preventDefault();
            window.YouTubePlusTimeLoop?.toggleLoop();
          } else if (key === setPointAKey) {
            e.preventDefault();
            window.YouTubePlusTimeLoop?.setLoopPoint?.('A');
          } else if (key === setPointBKey) {
            e.preventDefault();
            window.YouTubePlusTimeLoop?.setLoopPoint?.('B');
          } else if (key === resetPointsKey) {
            e.preventDefault();
            window.YouTubePlusTimeLoop?.resetLoopPoints?.();
          }
        };

        YouTubeUtils.cleanupManager.registerListener(
          document,
          'keydown',
          this._onLoopHotkey_,
          true
        );
      } catch (e) {
        if (YouTubeUtils?.logError) {
          YouTubeUtils.logError(
            'Basic',
            'Failed to register loop keyboard shortcuts',
            /** @type {any} */ (e)
          );
        }
      }
    },

    isEditableTarget(/** @type {any} */ target) {
      const active = /** @type {HTMLElement | null | undefined} */ (target);
      if (!active) return false;
      const tag = (active.tagName || '').toLowerCase();
      return (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(active.isContentEditable)
      );
    },

    normalizeSpeedHotkey(/** @type {any} */ value, /** @type {any} */ fallback) {
      const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (candidate) return candidate.slice(0, 1);
      return (
        String(fallback || '')
          .trim()
          .toLowerCase()
          .slice(0, 1) || 'g'
      );
    },

    adjustSpeedByStep(/** @type {any} */ direction) {
      const speedApi = window.YouTubePlusSpeedControl;
      if (speedApi && typeof speedApi.adjustSpeedByStep === 'function') {
        speedApi.adjustSpeedByStep(this, direction);
      }
    },

    // ==================== End Loop Functions (moved to time.js) ====================

    saveSettings() {
      // Route canonical settings writes through the store. The store
      // writes to `youtube_plus_settings` and dispatches the unified
      // `youtube-plus-settings-updated` event. basic.js keeps
      // `this.settings` as its in-memory working copy, so we pass it
      // to the store for persistence.
      const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
      if (store && typeof store.save === 'function') {
        store.save(this.settings);
      } else if (typeof window.YouTubePlusLogger !== 'undefined') {
        window.YouTubePlusLogger?.warn?.(
          'Basic',
          'settings store unavailable; settings not persisted'
        );
      }

      this.updatePageBasedOnSettings();
      this.refreshDownloadButton();

      // Expose settings on window for legacy consumers.
      try {
        /** @type {any} */ (window).youtubePlus = /** @type {any} */ (window).youtubePlus || {};
        /** @type {any} */ (window).youtubePlus.settings = this.settings;
      } catch (e) {
        YouTubePlusLogger?.warn?.('Basic', 'Settings exposure error', e);
      }
    },

    updatePageBasedOnSettings() {
      window.YouTubePlusScreenshot?.refreshVisibility?.(!!this.settings.enableScreenshot);
      window.YouTubePlusSpeedControl?.refreshVisibility?.(!!this.settings.enableSpeedControl);
      window.YouTubePlusDownloadButton?.refreshVisibility?.(!!this.settings.enableDownload);
    },

    /**
     * Refresh download button visibility - Delegates to download-button module
     */
    refreshDownloadButton() {
      // Use extracted download button module
      if (typeof window !== 'undefined' && window.YouTubePlusDownloadButton) {
        const manager = window.YouTubePlusDownloadButton.createDownloadButtonManager({
          settings: this.settings,
          t,
          getElement: this.getElement.bind(this),
          YouTubeUtils,
        });
        manager.refreshDownloadButton();
      }
    },

    setupCurrentPage() {
      this.waitForElement('#player-container-outer .html5-video-player, .ytp-right-controls', 5000)
        .then(() => {
          this.addCustomButtons();
          this.setupVideoObserver();
          this.applyCurrentSpeed();
          window.YouTubePlusTimeLoop?.applyLoopStateToCurrentVideo?.();
          this.updatePageBasedOnSettings();
          this.refreshDownloadButton();
        })
        .catch(() => {});
    },

    insertStyles() {
      // === CRITICAL CSS: variables, player controls, speed, notifications ===
      // Injected synchronously — minimal set needed before first paint
      const criticalStyles = `.youtube-enhancer-notification-container{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;z-index:2147483647;pointer-events:none;max-width:calc(100% - 32px);width:100%;box-sizing:border-box;padding:0 16px;}
        .youtube-enhancer-notification{position:relative;max-width:700px;width:auto;background:var(--yt-glass-bg);color:var(--yt-text-primary);padding:8px 14px;font-size:13px;border-radius:var(--yt-radius-md);z-index:inherit;transition:opacity .35s,transform .32s;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);font-weight:500;box-sizing:border-box;display:flex;align-items:center;gap:10px;pointer-events:auto;}
        .ytp-plus-loop-indicator{position:absolute;height:100%;background:linear-gradient(90deg,var(--yt-accent-secondary-ghost) 0%,var(--yt-accent-secondary-light-ghost) 50%,var(--yt-accent-secondary-ghost) 100%);border-left:2px solid var(--yt-accent-secondary);border-right:2px solid var(--yt-accent-secondary);display:none;pointer-events:none;top:0;z-index:1000;box-shadow:inset 0 0 4px var(--yt-accent-secondary-shadow);}
        .ytp-plus-settings-button{box-sizing:border-box;width:40px;height:40px;min-width:40px;flex:0 0 auto;background:transparent;border:none;color:var(--yt-text-primary,#fff);cursor:pointer;padding:8px;margin:0 4px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;align-self:center;transition:background-color .2s,transform .2s;}
        .ytp-plus-settings-button svg{width:24px;height:24px;display:block;}
        .ytp-plus-settings-button:hover{transform:rotate(30deg);background:var(--yt-glass-bg,rgba(255,255,255,.12));}
        ytmusic-nav-bar .ytp-plus-settings-button{color:var(--ytmusic-color-icon-active,#fff);}
        ytcp-header .ytp-plus-settings-button{color:var(--ytcp-icon-color,#606060);}
        .ytp-plus-settings-button--floating{position:fixed;right:18px;bottom:18px;z-index:100001;margin-right:0;padding:10px;border-radius:999px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);box-shadow:var(--yt-glass-shadow);backdrop-filter:blur(10px) saturate(130%);-webkit-backdrop-filter:blur(10px) saturate(130%);}
        .ytp-plus-settings-button--floating:hover{transform:translateY(-2px) rotate(30deg);}
        @media(max-width:768px){.ytp-plus-settings-button--floating{right:12px;bottom:12px;padding:8px;}}
        .ytSearchboxComponentInputBox { background: transparent !important; }`;
      // === UI CSS: settings modal, voting, glass utilities ===
      // Inject eagerly so on-demand surfaces (settings modal, related overlays)
      // never flash as unstyled native HTML before the deferred path catches up.
      const nonCriticalStyles = `
        .ytp-plus-settings-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);display:flex;align-items:center;justify-content:center;z-index:100000;backdrop-filter:blur(8px) saturate(140%);-webkit-backdrop-filter:blur(8px) saturate(140%);animation:ytEnhanceFadeIn .25s ease-out;contain:layout style paint;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
        .ytp-plus-settings-shell{max-width:45vw;max-height:65vh;display:flex;flex-direction:row;gap:12px;animation:ytEnhanceScaleIn .28s cubic-bezier(.4,0,.2,1);will-change:transform,opacity;}
        .ytp-plus-settings-sidebar{display:flex;align-items:center;justify-content:center;padding-top:44px;box-sizing:border-box;}
        .ytp-plus-settings-column{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;}
        .ytp-plus-settings-topbar{display:flex;align-items:center;gap:12px;padding:0 2px;}
        .ytp-plus-settings-title{font-size:14px;font-weight:500;margin:0;padding:var(--yt-space-sm) var(--yt-space-md);border-radius:18px;border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);cursor:default;transition:transform .25s cubic-bezier(.4,0,.2,1),background-color .25s cubic-bezier(.4,0,.2,1),border-color .25s cubic-bezier(.4,0,.2,1);white-space:nowrap;background:var(--yt-glass-bg);text-wrap:balance;}
        .ytp-plus-settings-active-label{flex:1;font-size:13px;font-weight:600;color:var(--yt-text-secondary);text-align:center;white-space:nowrap;letter-spacing:.03em;text-transform:uppercase;opacity:.75;text-wrap:balance;}
        .ytp-plus-settings-panel{background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:24px;flex:1;min-width:0;min-height:0;overflow:hidden;box-shadow:var(--yt-glass-shadow);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);border:1.5px solid var(--yt-glass-border);contain:layout style paint;display:flex;}
        .ytp-plus-settings-side-actions{display:flex;flex-direction:column;gap:10px;padding-top:50px;align-self:flex-start;}
        .ytp-plus-settings-close{width:40px;height:40px;border-radius:50%;background:var(--yt-glass-bg);border:1px solid var(--yt-surface-active);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px var(--yt-shadow-soft);transition:transform .12s cubic-bezier(.2,0,0,1),background-color .12s cubic-bezier(.2,0,0,1),color .2s;color:var(--yt-text-primary);padding:0;}
        .ytp-plus-settings-close:hover{transform:translateY(-2px);background:var(--yt-danger-ghost);color:var(--yt-accent);}
        .ytp-plus-settings-close:active{transform:scale(0.96) !important;}
        .ytp-plus-settings-nav{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;}
        .ytp-plus-settings-nav-rail{border:1px solid var(--yt-glass-border);border-radius:24px;background:var(--yt-glass-bg);box-shadow:inset 0 1px 0 var(--yt-rail-inset);padding:10px 8px;}
        .ytp-plus-settings-nav-item{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;width:44px;height:44px;border-radius:14px;cursor:pointer;transition:transform .2s cubic-bezier(.4,0,.2,1),background-color .2s cubic-bezier(.4,0,.2,1),color .2s cubic-bezier(.4,0,.2,1),box-shadow .2s cubic-bezier(.4,0,.2,1);font-size:11px;border:none;color:var(--yt-text-primary);padding:4px 4px;text-align:center;}
        .ytp-plus-settings-nav-item-label{display:none;}
        .ytp-plus-settings-nav-item:hover{background:var(--yt-hover-bg);transform:translateY(-1px);}
        .ytp-plus-settings-nav-item:active{transform:scale(0.96) !important;}
        .ytp-plus-settings-nav-item.active{background:var(--yt-panel-bg);color:var(--yt-accent);box-shadow:inset 0 0 0 1px var(--yt-surface-active-strong);}
        .ytp-plus-settings-nav-item svg{width:20px;height:20px;margin-right:0;opacity:.92;transition:opacity .2s,transform .2s;flex-shrink:0;}
        .ytp-plus-settings-nav-item.active svg{opacity:1;transform:scale(1.1);}
        .ytp-plus-settings-nav-item:hover svg{transform:scale(1.06);}
        .ytp-plus-settings-main{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;}
        .ytp-plus-settings-content{flex:1;padding:var(--yt-space-md) var(--yt-space-lg);overflow-y:auto;min-height:0;}
        .ytp-plus-settings-section{margin-bottom:var(--yt-space-lg);}
        .ytp-plus-settings-section-title{font-size:16px;font-weight:500;margin-bottom:var(--yt-space-md);color:var(--yt-text-primary);text-wrap:balance;}
        .ytp-plus-settings-section.hidden{display:none !important;}
        .ytp-plus-settings-item{display:flex;align-items:center;margin-bottom:var(--yt-space-md);padding:14px 18px;background:transparent;transition:transform .25s cubic-bezier(.4,0,.2,1),background-color .25s cubic-bezier(.4,0,.2,1),box-shadow .25s cubic-bezier(.4,0,.2,1);border-radius:var(--yt-radius-md);cursor:pointer;}
        .ytp-plus-settings-item:hover{background:var(--yt-hover-bg);transform:translateX(6px);box-shadow:0 2px 8px rgba(0,0,0,.1);}
        .ytp-plus-settings-item-actions{display:flex;align-items:center;gap:10px;margin-left:auto;}
        .ytp-plus-submenu-toggle{position:relative;width:26px;height:26px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);cursor:pointer;opacity:.9;transition:transform .15s ease,background-color .15s ease,opacity .15s ease;}
        .ytp-plus-submenu-toggle::after{content:"";position:absolute;top:-7px;left:-7px;right:-7px;bottom:-7px;}
        .ytp-plus-submenu-toggle:hover{background:var(--yt-hover-bg);transform:scale(1.06);}
        .ytp-plus-submenu-toggle:active{transform:scale(0.96) !important;}
        .ytp-plus-submenu-toggle:disabled{opacity:.35;cursor:not-allowed;transform:none;}
        .ytp-plus-submenu-toggle svg{width:16px;height:16px;transition:transform .15s ease;}
        .ytp-plus-submenu-toggle[aria-expanded="false"] svg{transform:rotate(-90deg);}
        .ytp-plus-submenu-toggle[aria-expanded="true"] svg{transform:rotate(0deg);}
        .ytp-plus-settings-item-label{flex:1;font-size:14px;color:var(--yt-text-primary);}
        .ytp-plus-settings-item-description{font-size:12px;color:var(--yt-text-secondary);margin-top:4px;text-wrap:pretty;}
        .ytp-plus-settings-checkbox{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:20px;height:20px;min-width:20px;min-height:20px;margin-left:auto;border:2px solid var(--yt-glass-border);border-radius:50%;background:transparent;display:inline-flex;align-items:center;justify-content:center;transition:transform 250ms cubic-bezier(.4,0,.23,1),background-color 250ms cubic-bezier(.4,0,.23,1),border-color 250ms cubic-bezier(.4,0,.23,1);cursor:pointer;position:relative;flex-shrink:0;color:var(--yt-text-primary);box-sizing:border-box;}
        .ytp-plus-settings-checkbox:focus-visible{outline:2px solid var(--yt-accent);outline-offset:2px;}
        .ytp-plus-settings-checkbox:hover{background:var(--yt-hover-bg);transform:scale(1.1);}
        .ytp-plus-settings-checkbox:active{transform:scale(0.96) !important;}
        .ytp-plus-settings-checkbox::before{content:"";width:5px;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(45deg);top:6px;left:3px;transition:width 100ms ease 50ms,opacity 50ms;transform-origin:0% 0%;opacity:0;}
        .ytp-plus-settings-checkbox::after{content:"";width:0;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(305deg);top:12px;left:7px;transition:width 100ms ease,opacity 50ms;transform-origin:0% 0%;opacity:0;}
        .ytp-plus-settings-checkbox:checked{transform:rotate(0deg) scale(1.15);}
        .ytp-plus-settings-checkbox:checked::before{width:9px;opacity:1;background:var(--yt-text-primary);transition:width 150ms ease 100ms,opacity 150ms ease 100ms;}
        .ytp-plus-settings-checkbox:checked::after{width:16px;opacity:1;background:var(--yt-text-primary);transition:width 150ms ease 250ms,opacity 150ms ease 250ms;}
        .ytp-plus-settings-select{margin-left:auto;flex-shrink:0;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:8px;color:var(--yt-text-primary);font-size:13px;padding:4px 8px;cursor:pointer;outline:none;transition:border-color .2s;}
        .ytp-plus-settings-select:focus{border-color:var(--yt-accent,#f00);}
        html[data-ytp-theme="light"] .ytp-plus-settings-select,html:not([dark]):not([data-ytp-theme="dark"]) .ytp-plus-settings-select{background:var(--yt-input-bg);border-color:var(--yt-border-color);}
        .ytp-plus-button{padding:var(--yt-space-sm) var(--yt-space-md);border-radius:18px;border:none;font-size:14px;font-weight:500;cursor:pointer;transition:transform .25s cubic-bezier(.4,0,.2,1),background-color .25s cubic-bezier(.4,0,.2,1),box-shadow .25s cubic-bezier(.4,0,.2,1),color .25s cubic-bezier(.4,0,.2,1);}
        .ytp-plus-button-primary{background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);}
        .ytp-plus-button-primary:hover{background:var(--yt-accent);color:#fff;box-shadow:0 6px 16px var(--yt-danger-shadow-strong);transform:translateY(-2px);}
        .ytp-plus-button:active{transform:scale(0.96) !important;}
        .update-open-page-btn{padding:12px 16px;font-size:13px;background:var(--yt-button-bg);border:1px solid var(--yt-glass-border);display:inline-flex;align-items:center;justify-content:center;}
        .update-open-page-btn svg{stroke:currentColor;}
        .update-open-page-btn:hover{background:var(--yt-hover-bg);transform:translateY(-1px);box-shadow:var(--yt-shadow);}
        .ytp-plus-settings-item .update-open-page-btn{margin-left:auto;}
        .app-icon{fill:var(--yt-text-primary);stroke:var(--yt-text-primary);transition:fill .3s,stroke .3s;}
        .about-section-content{display:flex;flex-direction:row;align-items:center;justify-content:center;flex-wrap:nowrap;width:fit-content;max-width:100%;line-height:1;gap:12px;text-align:center;margin:6px auto 12px;}
        .about-section-content .app-icon{display:block;flex:0 0 auto;margin:0;}
        @media(max-width:768px){.ytp-plus-settings-shell{max-height:86vh;flex-direction:column;gap:8px;}
        .ytp-plus-settings-sidebar{width:100%;max-height:70px;overflow-x:auto;padding-top:0;}
        .ytp-plus-settings-nav{flex-direction:row;}
        .ytp-plus-settings-nav-rail{max-width:none;border:none;border-radius:0;background:transparent;box-shadow:none;padding:0;flex-direction:row;display:flex;gap:4px;}
        .ytp-plus-settings-nav-item{width:40px;height:40px;}
        .ytp-plus-settings-side-actions{flex-direction:row;padding-top:0;align-self:auto;}
        .ytp-plus-settings-panel{min-height:0;}
        .ytp-plus-settings-active-label{display:none;}
        .ytp-plus-settings-item{padding:10px 12px;}}
        .about-section-content h1{margin:0;white-space:nowrap;font-family:'Montserrat',sans-serif;font-size:52px;font-weight:600;line-height:1.05;color:transparent;-webkit-text-stroke-width:1px;-webkit-text-stroke-color:var(--yt-text-stroke);cursor:pointer;transition:color .2s;}
        .about-section-content h1:hover{color:var(--yt-accent);-webkit-text-stroke-width:1px;-webkit-text-stroke-color:transparent;}
        .glass-panel{background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);box-shadow:var(--yt-glass-shadow);}
        .glass-card{background:var(--yt-panel-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);padding:var(--yt-space-md);box-shadow:var(--yt-shadow);}
        .stats-value, .ytp-plus-dislike-text, .speed-control-btn, .ytp-plus-voting-comments-icon{font-variant-numeric:tabular-nums;}
        .glass-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);display:flex;align-items:center;justify-content:center;z-index:99999;}
        .glass-button{background:var(--yt-button-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);padding:var(--yt-space-sm) var(--yt-space-md);color:var(--yt-text-primary);cursor:pointer;transition:background-color .2s ease,transform .1s cubic-bezier(0.2,0,0,1),box-shadow .2s ease,color .2s ease,border-color .2s ease;}
        .glass-button:hover{background:var(--yt-hover-bg);transform:translateY(-1px);box-shadow:var(--yt-shadow);}
        .glass-button:active{transform:scale(0.96) !important;}
        .glass-button.danger{background:var(--yt-danger-soft);border-color:var(--yt-danger-border);color:var(--yt-danger-text);}
        .glass-button.danger:hover{background:var(--yt-danger-soft-hover);}
        .download-site-controls{display:flex;flex-direction:column;gap:8px;margin-top:4px;}
        .download-site-input{width:100%;height:36px;border-radius:10px;border:1px solid var(--yt-glass-border);background:var(--yt-input-bg, rgba(255,255,255,.06));color:var(--yt-text-primary);padding:10px 12px;box-sizing:border-box;}
        .download-site-input.small{height:32px;font-size:12px;padding:6px 10px;}
        .download-site-input:focus{background:var(--yt-hover-bg);outline:none;}
        .download-site-cta{display:flex;gap:8px;width:100%;box-sizing:border-box;}
        .download-site-cta.one-btn{justify-content:center;}
        .download-site-cta .glass-button{flex:1;}
        .download-site-cta.one-btn .glass-button{width:100%;}
        .style-submenu{margin:4px 0 12px 12px;}
        .style-submenu-container{display:flex;flex-direction:column;gap:8px;}
        .style-side-videos-submenu{margin-left:12px;margin-bottom:8px;}
        .enhanced-submenu,.music-submenu{margin-left:12px;margin-bottom:12px;}
        .ytp-plus-settings-submenu-card{display:flex;flex-direction:column;gap:8px;}
        .ytp-plus-settings-item--top-gap{margin-top:4px;}
        .loop-submenu-compact{margin:0 0 4px 0;}
        .loop-hotkeys-row-no-margin{margin-bottom:0;}
        .loop-submenu-container{display:flex;flex-direction:column;gap:8px;}
        .loop-hotkeys-row{flex-direction:column!important;align-items:stretch!important;gap:6px;}
        .loop-hotkeys-info{display:flex;flex-direction:column;gap:4px;}
        .loop-hotkeys-fields{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-top:12px;width:100%;}
        .loop-hotkey-field{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:12px;color:var(--yt-text-secondary);flex:1;min-width:80px;}
        .loop-hotkey-field span{text-align:center;width:100%;}
        .loop-hotkey-input{width:100%;height:36px;border-radius:8px;border:1px solid var(--yt-glass-border);background:var(--yt-glass-bg);color:var(--yt-text-primary);text-align:center;text-transform:uppercase;}
        .loop-hotkey-input:focus{background:var(--yt-hover-bg);}
        .ytp-plus-about-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:16px 0;}
        .ytp-plus-about-footer{text-align:center;color:var(--yt-text-secondary);font-size:13px;line-height:1.6;margin-bottom:12px;}
        .ytp-plus-about-author-link{color:var(--yt-text-primary);font-style:italic;text-decoration:none;}
        .ytplus-guide-toggle-btn{position:fixed;right:12px;bottom:12px;z-index:100000;background:var(--yt-spec-call-to-action);color:#fff;border:none;border-radius:8px;padding:8px 10px;box-shadow:0 6px 18px var(--yt-shadow-notification);cursor:pointer;opacity:.95;font-size:13px;}
        .ytp-plus-settings-panel select,
        .ytp-plus-settings-panel select option {background: var(--yt-panel-bg) !important; color: var(--yt-text-primary) !important;}
        .ytp-plus-settings-panel select {-webkit-appearance: menulist !important; appearance: menulist !important; padding: 6px 8px !important; border-radius: 6px !important; border: 1px solid var(--yt-glass-border) !important;}
        .ytp-plus-theme-item{display:flex;flex-direction:column;align-items:stretch;gap:12px;text-align:left;}
        .ytp-plus-theme-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:100%}
        .ytp-plus-theme-card{display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:12px;border:1px solid var(--yt-glass-border);background:var(--yt-panel-bg);color:var(--yt-text-secondary);font-size:13px;font-weight:500;cursor:pointer;transition:background-color .18s ease,color .18s ease,border-color .18s ease,transform .18s ease,box-shadow .18s ease}
        .ytp-plus-theme-card:hover{background:var(--yt-hover-bg);color:var(--yt-text-primary)}
        .ytp-plus-theme-card:active{transform:scale(0.96) !important;}
        .ytp-plus-theme-card.active{color:#fff;background:linear-gradient(180deg,var(--yt-danger-card-bg-start),var(--yt-danger-card-bg-end));border-color:var(--yt-danger-card-border);box-shadow:0 0 0 1px var(--yt-danger-card-inset) inset}
        @media(max-width:580px){.ytp-plus-theme-grid{grid-template-columns:1fr}}
        .glass-dropdown{position:relative;display:inline-block;min-width:110px}
        .glass-dropdown__toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:6px 8px;border-radius:8px;background:linear-gradient(180deg, var(--yt-surface-overlay-subtle), var(--yt-surface-overlay-faint));color:inherit;border:1px solid var(--yt-surface-overlay-border);cursor:pointer}
        .glass-dropdown__toggle:focus{outline:2px solid var(--yt-surface-overlay-border)}
        .glass-dropdown__label{font-size:12px}
        .glass-dropdown__chev{opacity:0.9}
        .glass-dropdown__list{position:absolute;left:0;right:0;bottom:calc(100% + 8px);top:auto;z-index:20000;display:none;margin:0;padding:6px;border-radius:10px;list-style:none;background:var(--yt-header-bg);border:1px solid var(--yt-surface-overlay-border);box-shadow:0 8px 30px var(--yt-shadow-flyout);backdrop-filter:blur(10px) saturate(130%);-webkit-backdrop-filter:blur(10px) saturate(130%);max-height:220px;overflow:auto}
        .glass-dropdown__list.glass-dropdown__list--down{bottom:auto;top:calc(100% + 8px)}
        .glass-dropdown__item{padding:8px 10px;border-radius:6px;margin:4px 0;cursor:pointer;color:inherit;font-size:13px}
        .glass-dropdown__item:hover{background:var(--yt-surface-overlay-subtle)}
        .glass-dropdown__item[aria-selected="true"]{background:linear-gradient(90deg, var(--yt-surface-overlay-subtle), var(--yt-surface-overlay-faint));box-shadow:inset 0 0 0 1px var(--yt-surface-overlay-faint)}
        .ytp-plus-settings-voting-header{margin-bottom:var(--yt-space-lg);}
        .ytp-plus-settings-voting-header h3{font-size:18px;font-weight:500;margin:0 0 8px 0;color:var(--yt-text-primary);}
        .ytp-plus-settings-voting-desc{font-size:13px;color:var(--yt-text-secondary);margin:0;}
        .ytp-plus-voting{display:flex;flex-direction:column;gap:12px;}
        .ytp-plus-voting-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
        .ytp-plus-voting-list{display:flex;flex-direction:column;gap:12px;}
        .ytp-plus-voting-item{display:flex;align-items:flex-start;justify-content:space-between;padding:16px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);transition:background-color .2s ease,transform .2s ease,border-color .2s ease,box-shadow .2s ease;gap:12px;}
        .ytp-plus-voting-item:hover{background:var(--yt-hover-bg);transform:translateX(4px);}
        .ytp-plus-voting-item-content{flex:1;padding-right:16px;}
        .ytp-plus-voting-item-title{font-size:14px;font-weight:500;color:var(--yt-text-primary);margin-bottom:4px;}
        .ytp-plus-voting-item-desc{font-size:12px;color:var(--yt-text-secondary);line-height:1.4;}
        .ytp-plus-voting-item-status{font-size:11px;min-height:28px;padding:0 10px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:var(--yt-surface-overlay-soft);color:var(--yt-text-secondary);border:1px solid var(--yt-glass-border);line-height:1;}
        .ytp-plus-voting-item-status.completed{background:var(--yt-success-soft);color:var(--yt-success);}
        .ytp-plus-voting-item-status.in-progress{background:var(--yt-warning-soft);color:var(--yt-warning);}
        .ytp-plus-voting-item-votes{display:flex;flex-direction:column;align-items:stretch;gap:8px;min-width:120px;}
        .ytp-plus-voting-score{display:flex;align-items:baseline;gap:8px;justify-content:center;}
        .ytp-plus-vote-total{font-size:12px;color:var(--yt-text-secondary);}
        .ytp-plus-voting-buttons{position:relative;display:flex;justify-content:center;gap:0;border:1px solid var(--yt-glass-border);border-radius:20px;overflow:hidden;}
        .ytp-plus-voting-buttons-track{position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;transition:background .4s ease;border-radius:20px;pointer-events:none;}
        .ytp-plus-vote-btn{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:42px;height:32px;border:none;background:transparent;cursor:pointer;transition:color .15s ease,opacity .15s ease,transform .1s cubic-bezier(0.2,0,0,1);color:var(--yt-text-secondary);opacity:.95}
        .ytp-plus-vote-btn:first-of-type{border-right:1px solid var(--yt-glass-border)}
        .ytp-plus-vote-btn:hover{color:var(--yt-text-primary);opacity:1}
        .ytp-plus-vote-btn:active{transform:scale(0.96) !important;}
        .ytp-plus-vote-btn.active{color:#fff;opacity:1}
        .ytp-plus-vote-icon{width:20px;height:20px;fill:currentColor;opacity:.92}
        .ytp-plus-vote-btn.active .ytp-plus-vote-icon,.ytp-plus-vote-btn:hover .ytp-plus-vote-icon{opacity:1}
        .ytp-plus-voting-loading,.ytp-plus-voting-empty{text-align:center;padding:24px;color:var(--yt-text-secondary);font-size:13px;}
        .ytp-plus-voting-add-btn{background:var(--yt-accent);color:#fff;border:none;padding:8px 16px;border-radius:18px;font-size:13px;font-weight:500;cursor:pointer;transition:background-color .2s cubic-bezier(0.2,0,0,1),transform .2s cubic-bezier(0.2,0,0,1),box-shadow .2s cubic-bezier(0.2,0,0,1);}
        .ytp-plus-voting-add-btn:hover{transform:translateY(-2px);box-shadow:0 4px 12px var(--yt-danger-shadow);}
        .ytp-plus-voting-add-btn:active{transform:scale(0.96) !important;}
        .ytp-plus-voting-add-form{margin-top:16px;padding:16px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);}
        .ytp-plus-voting-add-form input,.ytp-plus-voting-add-form textarea{width:100%;padding:10px 12px;margin-bottom:12px;background:var(--yt-header-bg);border:1px solid var(--yt-glass-border);border-radius:8px;color:var(--yt-text-primary);font-size:13px;box-sizing:border-box;}
        .ytp-plus-voting-add-form input:focus,.ytp-plus-voting-add-form textarea:focus{border-color:var(--yt-accent);outline:none;}
        .ytp-plus-voting-add-form textarea{min-height:80px;resize:vertical;}
        .ytp-plus-voting-form-actions{display:flex;gap:8px;justify-content:flex-end;}
        .ytp-plus-voting-cancel{background:transparent;border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);padding:8px 16px;border-radius:18px;font-size:13px;cursor:pointer;transition:background-color .2s cubic-bezier(0.2,0,0,1),border-color .2s cubic-bezier(0.2,0,0,1),transform .2s cubic-bezier(0.2,0,0,1);}
        .ytp-plus-voting-cancel:hover{background:var(--yt-hover-bg);}
        .ytp-plus-voting-cancel:active{transform:scale(0.96) !important;}
        .ytp-plus-voting-submit{background:var(--yt-accent);color:#fff;border:none;padding:8px 16px;border-radius:18px;font-size:13px;font-weight:500;cursor:pointer;transition:background-color .2s cubic-bezier(0.2,0,0,1),transform .2s cubic-bezier(0.2,0,0,1),box-shadow .2s cubic-bezier(0.2,0,0,1);}
        .ytp-plus-voting-submit:hover{transform:translateY(-2px);box-shadow:0 4px 12px var(--yt-danger-shadow);}
        .ytp-plus-voting-submit:active{transform:scale(0.96) !important;}
        @media (max-width: 680px){.ytp-plus-voting-item{flex-direction:column;align-items:stretch}.ytp-plus-voting-item-content{padding-right:0}.ytp-plus-voting-item-votes{min-width:0;width:100%}}
        .ytp-plus-voting-preview{margin-bottom:20px;}
        .ytp-plus-ba-container{position:relative;width:100%;height:260px;overflow:hidden;border-radius:var(--yt-radius-md);border:1px solid var(--yt-glass-border);user-select:none;cursor:ew-resize;background:var(--yt-glass-bg);}
        .ytp-plus-ba-before,.ytp-plus-ba-after{position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;}
        .ytp-plus-ba-before img,.ytp-plus-ba-after img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;}
        .ytp-plus-ba-after{clip-path:inset(0 0 0 50%);}
        .ytp-plus-ba-divider{position:absolute;top:0;left:50%;transform:translateX(-50%);width:8px;height:100%;background:transparent;pointer-events:auto;z-index:3;cursor:ew-resize;transition:left .6s linear}
        .ytp-plus-ba-divider::after{content:'';position:absolute;left:50%;top:0;transform:translateX(-50%);width:2px;height:100%;background:var(--yt-accent,#f00);}
        .ytp-plus-ba-divider.autoplay{animation:ytpPlusSlideDivider 6s linear infinite}
        @keyframes ytpPlusSlideDivider{0%{left:10%}50%{left:90%}100%{left:10%}}
        .ytp-plus-ba-label{position:absolute;top:10px;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600;color:#fff;background:var(--yt-overlay-strong);pointer-events:none;z-index:5;}
        .ytp-plus-ba-label-before{left:10px;}
        .ytp-plus-ba-label-after{right:10px;}
        .ytp-plus-vote-bar-section{margin-top:12px;display:flex;flex-direction:column;align-items:center;gap:6px;}
        .ytp-plus-vote-bar-buttons{position:relative;display:flex;gap:0;border-radius:20px;overflow:hidden;border:1px solid var(--yt-glass-border);}
        .ytp-plus-vote-bar-track{position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;transition:background .4s ease;background:linear-gradient(to right, var(--yt-success) 50%, var(--yt-danger) 50%);border-radius:20px;}
        .ytp-plus-vote-bar-btn{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;padding:8px 18px;background:transparent;border:none;color:var(--yt-text-secondary);cursor:pointer;transition:color .15s;font-size:14px;}
        .ytp-plus-vote-bar-btn:first-of-type{border-right:1px solid var(--yt-glass-border);}
        .ytp-plus-vote-bar-btn:hover{color:var(--yt-text-primary);}
        .ytp-plus-vote-bar-btn.active{color:#fff;}
        .ytp-plus-vote-bar-btn svg{fill:currentColor;width:20px;height:20px;display:block;}
        .ytp-plus-vote-bar-btn svg path{fill:currentColor;}
        .ytp-plus-vote-bar-count{font-size:12px;color:var(--yt-text-secondary);}`;

      // Inject the shared UI CSS through the canonical design-system
      // StyleManager so it shares the single style host with the rest of
      // the design system. StyleManager.add(id, css) is idempotent, so the
      // eager boot-time injection and the lazy openSettingsModal path safely
      // converge on the same stable id without duplicate style hosts.
      const domCache = /** @type {any} */ (window).YouTubePlusDOMCache;
      const domById = (/** @type {string} */ id) =>
        domCache && typeof domCache.getElementById === 'function'
          ? domCache.getElementById(id)
          : typeof document !== 'undefined'
            ? document.getElementById(id)
            : null;
      const injectNonCritical = () => {
        try {
          const SM = YouTubeUtils?.StyleManager;
          if (SM && typeof SM.add === 'function') {
            SM.add('yt-enhancer-nc-styles', nonCriticalStyles);
            // Legacy cleanup: earlier versions injected a standalone
            // <style id="yt-enhancer-nc-styles">. Remove any such
            // leftover so users upgrading from older releases don't keep
            // the same CSS applied twice. Safe no-op when absent.
            const legacy = domById('yt-enhancer-nc-styles');
            if (legacy && /** @type {any} */ (legacy).remove) {
              /** @type {any} */ (legacy).remove();
            }
            return;
          }
        } catch (_e) {
          // Fall through to raw fallback to preserve behavior when
          // StyleManager is somehow unreachable.
        }

        // Raw <style> fallback — only reached when StyleManager isn't available.
        if (!domById('yt-enhancer-nc-styles')) {
          const ncEl = document.createElement('style');
          ncEl.id = 'yt-enhancer-nc-styles';
          ncEl.textContent = nonCriticalStyles;
          (document.head || document.documentElement).appendChild(ncEl);
        }
      };
      /** @type {any} */ (this).ensureNonCriticalStyles = injectNonCritical;

      // Inject critical CSS immediately. StyleManager.add() is
      // idempotent (last-write-wins on the same id+css, true no-op
      // on identical input), so a pre-check for an existing style
      // element is redundant and would just duplicate canonical
      // idempotency logic that belongs in the StyleManager.
      //
      // Guard the call the same way as injectNonCritical above: if the
      // canonical StyleManager is not reachable in this trust boundary
      // (e.g. design-system.js failed to expose it, or load ordering
      // changed), fall back to a raw <style> host. Without this guard a
      // missing StyleManager throws here and aborts insertStyles() ->
      // init(), which silently removes the entire UI (settings button +
      // all core styles) while self-executing modules keep working.
      const injectCritical = () => {
        try {
          const SM = YouTubeUtils?.StyleManager;
          if (SM && typeof SM.add === 'function') {
            SM.add('yt-enhancer-main', criticalStyles);
            return;
          }
        } catch (_e) {
          // Fall through to raw fallback to preserve behavior when
          // StyleManager is somehow unreachable.
        }

        // Raw <style> fallback — only reached when StyleManager isn't available.
        if (!domById('yt-enhancer-main')) {
          const critEl = document.createElement('style');
          critEl.id = 'yt-enhancer-main';
          critEl.textContent = criticalStyles;
          (document.head || document.documentElement).appendChild(critEl);
        }
      };
      injectCritical();
      injectNonCritical();
    },

    createSettingsLauncherButton() {
      const settingsButton = document.createElement('div');
      settingsButton.className = 'ytp-plus-settings-button';
      settingsButton.setAttribute('title', t('youtubeSettings'));
      _setSafeHTML(
        settingsButton,
        `
          <svg width="24" height="24" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M39.23,26a16.52,16.52,0,0,0,.14-2,16.52,16.52,0,0,0-.14-2l4.33-3.39a1,1,0,0,0,.25-1.31l-4.1-7.11a1,1,0,0,0-1.25-.44l-5.11,2.06a15.68,15.68,0,0,0-3.46-2l-.77-5.43a1,1,0,0,0-1-.86H19.9a1,1,0,0,0-1,.86l-.77,5.43a15.36,15.36,0,0,0-3.46,2L9.54,9.75a1,1,0,0,0-1.25.44L4.19,17.3a1,1,0,0,0,.25,1.31L8.76,22a16.66,16.66,0,0,0-.14,2,16.52,16.52,0,0,0,.14,2L4.44,29.39a1,1,0,0,0-.25,1.31l4.1,7.11a1,1,0,0,0,1.25.44l5.11-2.06a15.68,15.68,0,0,0,3.46,2l.77,5.43a1,1,0,0,0,1,.86h8.2a1,1,0,0,0,1-.86l.77-5.43a15.36,15.36,0,0,0,3.46-2l5.11,2.06a1,1,0,0,0,1.25-.44l4.1-7.11a1,1,0,0,0-.25-1.31ZM24,31.18A7.18,7.18,0,1,1,31.17,24,7.17,7.17,0,0,1,24,31.18Z"/>
          </svg>
        `
      );

      settingsButton.addEventListener('click', this.openSettingsModal.bind(this));
      return settingsButton;
    },

    getSettingsButtonTargets() {
      const host = String(location.hostname || '').toLowerCase();
      if (host === 'music.youtube.com') {
        return [
          'ytmusic-nav-bar #right-content',
          'ytmusic-nav-bar .right-content',
          'ytmusic-nav-bar #right-divider ~ *',
          'ytmusic-nav-bar tp-yt-paper-icon-button#right-content',
          'ytmusic-nav-bar .center-content',
          'ytmusic-nav-bar',
        ];
      }

      if (host === 'studio.youtube.com' || host.endsWith('.studio.youtube.com')) {
        return [
          'ytcp-header #right-content',
          'ytcp-header .right-content',
          'ytcp-header #account-section',
          'ytcp-header #notifications-button',
          'tp-yt-app-header #right-content',
          'ytcp-header',
        ];
      }

      return ['ytd-masthead #end', 'ytd-masthead #buttons', 'ytd-masthead', '#end'];
    },

    mountSettingsButton(/** @type {Element} */ container) {
      if (basicHasSettingsButton_()) return;

      const settingsButton = this.createSettingsLauncherButton();
      const insertionPoint = container.querySelector(
        'ytd-topbar-menu-button-renderer, ytmusic-settings-button, ytmusic-user-settings-button, [id*="avatar" i], [aria-label*="account" i]'
      );

      if (insertionPoint && insertionPoint.parentElement === container) {
        container.insertBefore(settingsButton, insertionPoint);
        return;
      }

      container.appendChild(settingsButton);
    },

    addFloatingSettingsButton() {
      if (basicHasSettingsButton_()) return;
      const settingsButton = this.createSettingsLauncherButton();
      settingsButton.classList.add('ytp-plus-settings-button--floating');
      (document.body || document.documentElement).appendChild(settingsButton);
    },

    addSettingsButtonToHeader() {
      if (basicHasSettingsButton_()) return;

      const targets = this.getSettingsButtonTargets();
      for (const selector of targets) {
        const container = this.getElement(selector);
        if (container) {
          this.mountSettingsButton(container);
          return;
        }
      }

      // Wait for the most generic container (last target) since host-specific
      // sub-containers may render late or differ across YouTube surfaces.
      const fallbackTarget = targets[targets.length - 1];
      this.waitForElement(fallbackTarget, 5000)
        .then(() => {
          if (basicHasSettingsButton_()) return;
          for (const selector of targets) {
            const container = this.getElement(selector);
            if (container) {
              this.mountSettingsButton(container);
              return;
            }
          }
          this.addFloatingSettingsButton();
        })
        .catch(() => {
          this.addFloatingSettingsButton();
        });
    },

    /**
     * Handle modal click actions (extracted to reduce complexity)
     * @param {HTMLElement} target - Click target
     * @param {HTMLElement} modal - Modal element
     * @param {any} handlers - Modal handlers
     * @param {Function} _markDirty - Mark dirty function
     * @param {any} _context - Context object
     * @param {Function} translate - Translation function
     */
    handleModalClickActions(
      target,
      modal,
      handlers,
      /** @type {any} */ _markDirty,
      /** @type {any} */ _context,
      translate
    ) {
      // Sidebar navigation
      const navItem = /** @type {HTMLElement | null} */ (
        target.classList?.contains('ytp-plus-settings-nav-item')
          ? target
          : target.closest?.('.ytp-plus-settings-nav-item')
      );
      if (navItem) {
        handlers.handleSidebarNavigation(navItem, modal);
        return;
      }

      // Save button
      if (target.id === 'ytp-plus-save-settings' || target.id === 'ytp-plus-save-settings-icon') {
        this.saveSettings();
        try {
          document.dispatchEvent(
            new CustomEvent('youtube-plus-settings-modal-closed', {
              bubbles: true,
            })
          );
        } catch (_e) {
          window.YouTubePlusErrorBoundary?.logError?.(
            _e instanceof Error ? _e : new Error(String(_e)),
            { module: 'Basic' }
          );
        }
        /** @type {any} */ (modal)._ytpFallbackLayoutObserver?.disconnect();
        modal.remove();
        this.showNotification(translate('settingsSaved'));
        return;
      }

      // External downloader save
      if (target.id === 'download-externalDownloader-save') {
        handlers.handleExternalDownloaderSave(
          target,
          this.settings,
          this.saveSettings.bind(this),
          this.showNotification.bind(this),
          translate
        );
        return;
      }

      // External downloader reset
      if (target.id === 'download-externalDownloader-reset') {
        handlers.handleExternalDownloaderReset(
          modal,
          this.settings,
          this.saveSettings.bind(this),
          this.showNotification.bind(this),
          translate
        );
      }
    },

    createSettingsModal() {
      const modal = document.createElement('div');
      modal.className = 'ytp-plus-settings-modal';

      // Use helper functions from settings-helpers.js
      const helpers = window.YouTubePlusSettingsHelpers;
      const handlers = window.YouTubePlusModalHandlers;
      _setSafeHTML(
        modal,
        `
        <div class="ytp-plus-settings-shell">
          <div class="ytp-plus-settings-sidebar">${helpers.createSettingsSidebar(t)}</div>
          <div class="ytp-plus-settings-column">
            <div class="ytp-plus-settings-topbar">
              <h2 class="ytp-plus-settings-title">${t('settingsTitle')}</h2>
              <div class="ytp-plus-settings-active-label" id="ytp-plus-active-section-label"></div>
              <button class="ytp-plus-button ytp-plus-button-primary" id="ytp-plus-save-settings">${t('saveChanges')}</button>
            </div>
            <div class="ytp-plus-settings-panel">${helpers.createMainContent(this.settings, t)}</div>
          </div>
          <div class="ytp-plus-settings-side-actions">
            <button class="ytp-plus-settings-close" id="ytp-plus-close-settings" aria-label="${t('closeButton')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.5 9.50002L9.5 14.5M9.49998 9.5L14.5 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>
            </button>
          </div>
        </div>
      `
      );

      /** @type {MutationObserver | null} */
      let fallbackLayoutObserver = null;
      /** @type {number | null} */
      let fallbackLayoutRafId = null;

      const scheduleFallbackLayoutRepair = () => {
        if (fallbackLayoutRafId !== null) return;
        fallbackLayoutRafId = requestAnimationFrame(() => {
          fallbackLayoutRafId = null;
          ensureModalFallbackLayout();
        });
      };

      const ensureModalFallbackLayout = () => {
        const shell = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-shell')
        );
        const sidebar = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-sidebar')
        );
        const column = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-column')
        );
        const topbar = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-topbar')
        );
        const panel = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-panel')
        );
        const main = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-main')
        );
        const content = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-content')
        );
        const sideActions = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-side-actions')
        );
        const navRail = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-nav-rail')
        );
        const navItems = modal.querySelectorAll('.ytp-plus-settings-nav-item');
        const hiddenSections = modal.querySelectorAll('.ytp-plus-settings-section.hidden');
        const navSvg = /** @type {SVGElement | null} */ (
          modal.querySelector('.ytp-plus-settings-nav-item svg')
        );
        const navItemLabel = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-nav-item-label')
        );
        const firstSettingsItem = /** @type {HTMLElement | null} */ (
          modal.querySelector('.ytp-plus-settings-item')
        );

        let needsFallback = false;
        try {
          const shellStyle = shell ? window.getComputedStyle(shell) : null;
          const panelStyle = panel ? window.getComputedStyle(panel) : null;
          const navLabelStyle = navItemLabel ? window.getComputedStyle(navItemLabel) : null;
          const firstSettingsItemStyle = firstSettingsItem
            ? window.getComputedStyle(firstSettingsItem)
            : null;
          const navSvgWidth = navSvg?.getBoundingClientRect?.().width || 0;
          needsFallback =
            !(shell && panel) ||
            shellStyle?.display !== 'flex' ||
            panelStyle?.display !== 'flex' ||
            navSvgWidth > 64 ||
            navLabelStyle?.display !== 'none' ||
            firstSettingsItemStyle?.display !== 'flex';
        } catch (_e) {
          needsFallback = true;
        }

        if (!needsFallback) return;

        modal.setAttribute('data-ytp-inline-fallback', 'true');
        Object.assign(modal.style, {
          position: 'fixed',
          inset: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          boxSizing: 'border-box',
          background: 'var(--yt-modal-bg, rgba(0,0,0,.72))',
          zIndex: '100000',
        });
        if (shell) {
          Object.assign(shell.style, {
            display: 'flex',
            flexDirection: 'row',
            gap: '12px',
            width: 'min(960px, 92vw)',
            maxWidth: '92vw',
            maxHeight: '86vh',
          });
        }
        if (sidebar) {
          Object.assign(sidebar.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: '44px',
            boxSizing: 'border-box',
          });
        }
        if (column) {
          Object.assign(column.style, {
            flex: '1',
            minWidth: '0',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          });
        }
        if (topbar) {
          Object.assign(topbar.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '0 2px',
          });
        }
        if (panel) {
          Object.assign(panel.style, {
            display: 'flex',
            flex: '1',
            minWidth: '0',
            minHeight: '0',
            overflow: 'hidden',
            background: 'var(--yt-glass-bg, rgba(24,24,24,.92))',
            color: 'var(--yt-text-primary, #fff)',
            border: '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
            borderRadius: '24px',
            boxShadow: 'var(--yt-glass-shadow, 0 12px 40px rgba(0,0,0,.35))',
          });
        }
        if (main) {
          Object.assign(main.style, {
            flex: '1',
            minHeight: '0',
            display: 'flex',
            flexDirection: 'column',
          });
        }
        if (content) {
          Object.assign(content.style, {
            flex: '1',
            minHeight: '0',
            overflowY: 'auto',
            padding: '16px 20px',
          });
        }
        if (sideActions) {
          Object.assign(sideActions.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            paddingTop: '50px',
            alignSelf: 'flex-start',
          });
        }
        if (navRail) {
          Object.assign(navRail.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '10px 8px',
            borderRadius: '24px',
            background: 'var(--yt-glass-bg, rgba(24,24,24,.92))',
            border: '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
          });
        }
        for (const section of hiddenSections) {
          if (section instanceof HTMLElement) section.style.display = 'none';
        }
        for (const item of navItems) {
          if (!(item instanceof HTMLElement)) continue;
          Object.assign(item.style, {
            position: 'relative',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '14px',
            color: 'var(--yt-text-primary, #fff)',
            flexShrink: '0',
          });
        }
        modal.querySelectorAll('.ytp-plus-settings-nav-item-label').forEach(label => {
          if (label instanceof HTMLElement) label.style.display = 'none';
        });
        modal
          .querySelectorAll('.ytp-plus-settings-item:not(.ytp-plus-theme-item)')
          .forEach(item => {
            if (!(item instanceof HTMLElement)) return;
            Object.assign(item.style, {
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '14px 18px',
              marginBottom: '12px',
              borderRadius: '14px',
              boxSizing: 'border-box',
            });
          });
        modal.querySelectorAll('.ytp-plus-theme-item').forEach(item => {
          if (!(item instanceof HTMLElement)) return;
          Object.assign(item.style, {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: '12px',
            padding: '14px 18px',
            marginBottom: '12px',
            borderRadius: '14px',
            boxSizing: 'border-box',
            textAlign: 'left',
          });
        });
        modal.querySelectorAll('.ytp-plus-settings-item-actions').forEach(actions => {
          if (!(actions instanceof HTMLElement)) return;
          Object.assign(actions.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginLeft: 'auto',
            flexShrink: '0',
          });
        });
        modal.querySelectorAll('.ytp-plus-button').forEach(btn => {
          if (!(btn instanceof HTMLElement)) return;
          Object.assign(btn.style, {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            minHeight: '36px',
            padding: '8px 14px',
            borderRadius: '18px',
            border: '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
            background: 'var(--yt-glass-bg, rgba(255,255,255,.08))',
            color: 'var(--yt-text-primary, #fff)',
            boxSizing: 'border-box',
          });
        });
        modal.querySelectorAll('.glass-button').forEach(btn => {
          if (!(btn instanceof HTMLElement)) return;
          const isDanger = btn.classList.contains('danger');
          Object.assign(btn.style, {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            minHeight: '36px',
            padding: '8px 14px',
            borderRadius: '14px',
            border: isDanger
              ? '1px solid var(--yt-danger-border, rgba(255,59,59,0.3))'
              : '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
            background: isDanger
              ? 'var(--yt-danger-soft, rgba(255,59,59,0.15))'
              : 'var(--yt-button-bg, rgba(255,255,255,.08))',
            color: isDanger ? 'var(--yt-danger-text, #ff5c5c)' : 'var(--yt-text-primary, #fff)',
            boxSizing: 'border-box',
          });
        });
        modal.querySelectorAll('.download-site-cta').forEach(cta => {
          if (!(cta instanceof HTMLElement)) return;
          Object.assign(cta.style, {
            display: 'flex',
            gap: '8px',
            width: '100%',
            boxSizing: 'border-box',
          });
          cta.querySelectorAll('.glass-button').forEach(btn => {
            if (btn instanceof HTMLElement) {
              btn.style.flex = '1';
              if (cta.classList.contains('one-btn')) {
                btn.style.width = '100%';
              }
            }
          });
        });
        modal.querySelectorAll('.download-site-controls').forEach(controls => {
          if (!(controls instanceof HTMLElement)) return;
          Object.assign(controls.style, {
            display: controls.style.display === 'none' ? 'none' : 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginTop: '4px',
          });
        });
        modal.querySelectorAll('.ytp-plus-submenu-toggle').forEach(toggle => {
          if (!(toggle instanceof HTMLElement)) return;
          Object.assign(toggle.style, {
            display: toggle.hasAttribute('disabled') ? 'none' : 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '26px',
            height: '26px',
            borderRadius: '999px',
            border: '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
            background: 'transparent',
            color: 'var(--yt-text-primary, #fff)',
            flexShrink: '0',
          });
        });
        modal.querySelectorAll('.ytp-plus-settings-checkbox').forEach(checkbox => {
          if (!(checkbox instanceof HTMLElement)) return;
          Object.assign(checkbox.style, {
            appearance: 'none',
            WebkitAppearance: 'none',
            width: '20px',
            height: '20px',
            minWidth: '20px',
            minHeight: '20px',
            marginLeft: 'auto',
            borderRadius: '50%',
            border: '2px solid var(--yt-glass-border, rgba(255,255,255,.12))',
            background: 'transparent',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            flexShrink: '0',
          });
        });
        modal
          .querySelectorAll(
            '.ytp-plus-settings-item input[type="text"], .ytp-plus-settings-item input[type="email"], .ytp-plus-settings-item textarea, .download-site-input, .pip-key-input, .ytp-plus-settings-panel input[type="text"], .ytp-plus-settings-panel input[type="email"], .ytp-plus-settings-panel textarea, .ytp-plus-settings-panel select'
          )
          .forEach(field => {
            if (!(field instanceof HTMLElement)) return;
            Object.assign(field.style, {
              background: 'var(--yt-input-bg, rgba(255,255,255,.06))',
              color: 'var(--yt-text-primary, #fff)',
              border: '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
              borderRadius: '10px',
              padding: '10px 12px',
              boxSizing: 'border-box',
            });
          });
        modal.querySelectorAll('.glass-dropdown').forEach(dropdown => {
          if (!(dropdown instanceof HTMLElement)) return;
          Object.assign(dropdown.style, {
            position: 'relative',
            display: 'inline-block',
            minWidth: '140px',
          });
        });
        modal.querySelectorAll('.glass-dropdown__toggle').forEach(toggle => {
          if (!(toggle instanceof HTMLElement)) return;
          Object.assign(toggle.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            width: '100%',
            padding: '8px 10px',
            borderRadius: '10px',
            border: '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
            background: 'var(--yt-button-bg, rgba(255,255,255,.08))',
            color: 'var(--yt-text-primary, #fff)',
            boxSizing: 'border-box',
          });
        });
        modal.querySelectorAll('.glass-dropdown__list').forEach(list => {
          if (!(list instanceof HTMLElement)) return;
          Object.assign(list.style, {
            listStyle: 'none',
            margin: '0 0 8px 0',
            padding: '6px',
            borderRadius: '10px',
            border: '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
            background: 'var(--yt-panel-bg, rgba(24,24,24,.96))',
            boxSizing: 'border-box',
            top: 'auto',
            bottom: 'calc(100% + 8px)',
          });
          // Re-apply down direction if the shared handler toggled the class.
          if (list.classList.contains('glass-dropdown__list--down')) {
            list.style.bottom = 'auto';
            list.style.top = 'calc(100% + 8px)';
            list.style.margin = '8px 0 0 0';
          }
          if (list.parentElement?.getAttribute('aria-expanded') !== 'true' && !list.style.display) {
            list.style.display = 'none';
          }
        });
        modal.querySelectorAll('.glass-dropdown__item').forEach(item => {
          if (!(item instanceof HTMLElement)) return;
          Object.assign(item.style, {
            listStyle: 'none',
            padding: '8px 10px',
            margin: '0',
            borderRadius: '8px',
            cursor: 'pointer',
          });
        });
        modal.querySelectorAll('.ytp-plus-theme-grid').forEach(group => {
          if (!(group instanceof HTMLElement)) return;
          Object.assign(group.style, {
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '10px',
            width: '100%',
          });
        });
        modal.querySelectorAll('.ytp-plus-theme-card').forEach(card => {
          if (!(card instanceof HTMLElement)) return;
          Object.assign(card.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '44px',
            borderRadius: '12px',
            border: '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
            background: card.classList.contains('active')
              ? 'linear-gradient(180deg, var(--yt-danger-card-bg-start, rgba(255,0,0,.4)), var(--yt-danger-card-bg-end, rgba(180,0,0,.45)))'
              : 'var(--yt-panel-bg, rgba(255,255,255,.04))',
            color: 'var(--yt-text-primary, #fff)',
            boxSizing: 'border-box',
          });
        });
        modal.querySelectorAll('.ytp-plus-about-actions').forEach(actions => {
          if (!(actions instanceof HTMLElement)) return;
          Object.assign(actions.style, {
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '10px',
            margin: '16px 0',
          });
        });
        modal.querySelectorAll('.ytp-plus-about-footer').forEach(footer => {
          if (!(footer instanceof HTMLElement)) return;
          Object.assign(footer.style, {
            textAlign: 'center',
            color: 'var(--yt-text-secondary, rgba(255,255,255,.72))',
            fontSize: '13px',
            lineHeight: '1.6',
          });
        });
        modal.querySelectorAll('.ytp-plus-voting, .ytp-plus-voting-list').forEach(block => {
          if (!(block instanceof HTMLElement)) return;
          Object.assign(block.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          });
        });
        modal.querySelectorAll('.ytp-plus-voting-item').forEach(item => {
          if (!(item instanceof HTMLElement)) return;
          Object.assign(item.style, {
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '16px',
            borderRadius: '16px',
            border: '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
            background: 'var(--yt-glass-bg, rgba(255,255,255,.04))',
            boxSizing: 'border-box',
          });
        });
        modal
          .querySelectorAll('.ytp-plus-voting-buttons, .ytp-plus-vote-bar-buttons')
          .forEach(group => {
            if (!(group instanceof HTMLElement)) return;
            Object.assign(group.style, {
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '0',
              borderRadius: '20px',
              overflow: 'hidden',
              border: '1px solid var(--yt-glass-border, rgba(255,255,255,.12))',
            });
          });
        modal.querySelectorAll('.ytp-plus-vote-btn, .ytp-plus-vote-bar-btn').forEach(btn => {
          if (!(btn instanceof HTMLElement)) return;
          Object.assign(btn.style, {
            position: 'relative',
            zIndex: '1',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '42px',
            minHeight: '32px',
            border: 'none',
            background: 'transparent',
            color: 'var(--yt-text-primary, #fff)',
          });
        });
        modal.querySelectorAll('.ytp-plus-settings-section').forEach(section => {
          if (!(section instanceof HTMLElement)) return;
          if (!section.classList.contains('hidden')) section.style.display = '';
        });
        modal.querySelectorAll('svg').forEach(svg => {
          if (!(svg instanceof SVGElement)) return;
          const isAppIcon = svg.classList.contains('app-icon');
          if (!svg.getAttribute('width')) svg.setAttribute('width', isAppIcon ? '72' : '20');
          if (!svg.getAttribute('height')) svg.setAttribute('height', isAppIcon ? '72' : '20');
          svg.style.display = 'block';
          svg.style.flexShrink = '0';
          svg.style.maxWidth = '100%';
        });
      };

      ensureModalFallbackLayout();
      requestAnimationFrame(ensureModalFallbackLayout);

      try {
        fallbackLayoutObserver = new MutationObserver(() => {
          if (modal.getAttribute('data-ytp-inline-fallback') === 'true') {
            scheduleFallbackLayoutRepair();
          }
        });
        /** @type {any} */ (modal)._ytpFallbackLayoutObserver = fallbackLayoutObserver;
        fallbackLayoutObserver.observe(modal, {
          childList: true,
          subtree: true,
        });
      } catch (_e) {
        fallbackLayoutObserver = null;
      }

      // Sync topbar active-section label with initially active nav item
      const _initialNav = /** @type {HTMLElement|null} */ (
        modal.querySelector('.ytp-plus-settings-nav-item.active')
      );
      const _activeLabel = modal.querySelector('#ytp-plus-active-section-label');
      if (_initialNav && _activeLabel) {
        _activeLabel.textContent = _initialNav.dataset?.label || '';
      }

      // Track unsaved changes (callback passed to handlers)
      const markDirty = () => {};

      // Context for handlers
      const context = {
        settings: this.settings,
        getElement: this.getElement.bind(this),
        addDownloadButton: this.addDownloadButton.bind(this),
        addSpeedControlButton: this.addSpeedControlButton.bind(this),
        refreshDownloadButton: this.refreshDownloadButton.bind(this),
        updatePageBasedOnSettings: this.updatePageBasedOnSettings.bind(this),
      };

      // Create click handler
      const handleModalClick = (/** @type {any} */ e) => {
        const target = /** @type {HTMLElement} */ (e.target);

        // Submenu toggle buttons (e.g., YouTube Music)
        const submenuToggleBtn = target.closest('.ytp-plus-submenu-toggle');
        if (submenuToggleBtn) {
          try {
            if (
              submenuToggleBtn instanceof HTMLElement &&
              submenuToggleBtn.tagName === 'BUTTON' &&
              submenuToggleBtn.hasAttribute('disabled')
            ) {
              return;
            }
            const submenuKey = submenuToggleBtn.dataset?.submenu;
            if (!submenuKey) return;
            const panel = submenuToggleBtn.closest('.ytp-plus-settings-panel');
            if (!panel) return;
            const submenuEl = panel.querySelector(basicSubmenuSelector_(submenuKey));
            if (!(submenuEl instanceof HTMLElement)) return;

            const computedDisplay = window.getComputedStyle(
              /** @type {Element} */ (submenuEl)
            ).display;
            const currentlyHidden =
              computedDisplay === 'none' ||
              submenuEl.hidden ||
              submenuEl.classList.contains('is-hidden');
            const nextHidden = !currentlyHidden;
            /** @type {any} */ (submenuEl).style.display = nextHidden ? 'none' : '';
            submenuEl.classList.toggle('is-hidden', nextHidden);
            submenuToggleBtn.setAttribute('aria-expanded', nextHidden ? 'false' : 'true');

            // Persist submenu expanded state to modal UI-state store
            const submenuStates = basicUiState_.submenuStates.read();
            submenuStates[submenuKey] = !nextHidden;
            basicUiState_.submenuStates.write(submenuStates);
          } catch (e) {
            YouTubePlusLogger?.warn?.('Basic', 'Submenu toggle error', e);
          }
          return;
        }

        const themeCard = target.closest('.ytp-plus-theme-card[data-setting-card][data-value]');
        if (themeCard instanceof HTMLElement) {
          const setting = themeCard.dataset.settingCard;
          const value = themeCard.dataset.value;
          if (setting && typeof value === 'string') {
            handlers.setSettingByPath(this.settings, setting, value);
            const group = themeCard.closest('.ytp-plus-theme-grid');
            if (group) {
              group.querySelectorAll('.ytp-plus-theme-card').forEach(card => {
                const isActive = card === themeCard;
                card.classList.toggle('active', isActive);
                card.setAttribute('aria-checked', isActive ? 'true' : 'false');
              });
            }
            markDirty();
            handlers.applySettingLive(setting, context);
            this.saveSettings();
          }
          return;
        }

        // Close modal
        if (target === modal) {
          try {
            document.dispatchEvent(
              new CustomEvent('youtube-plus-settings-modal-closed', {
                bubbles: true,
              })
            );
          } catch (_e) {
            window.YouTubePlusErrorBoundary?.logError?.(
              _e instanceof Error ? _e : new Error(String(_e)),
              { module: 'Basic' }
            );
          }
          /** @type {any} */ (modal)._ytpFallbackLayoutObserver?.disconnect();
          modal.remove();
          return;
        }

        // Close button
        if (
          target.id === 'ytp-plus-close-settings' ||
          target.id === 'ytp-plus-close-settings-icon' ||
          target.classList.contains('ytp-plus-settings-close') ||
          target.closest('.ytp-plus-settings-close') ||
          target.closest('#ytp-plus-close-settings') ||
          target.closest('#ytp-plus-close-settings-icon')
        ) {
          try {
            document.dispatchEvent(
              new CustomEvent('youtube-plus-settings-modal-closed', {
                bubbles: true,
              })
            );
          } catch (_e) {
            window.YouTubePlusErrorBoundary?.logError?.(
              _e instanceof Error ? _e : new Error(String(_e)),
              { module: 'Basic' }
            );
          }
          /** @type {any} */ (modal)._ytpFallbackLayoutObserver?.disconnect();
          modal.remove();
          return;
        }

        // YTDL GitHub button
        if (target.id === 'open-ytdl-github' || target.closest('#open-ytdl-github')) {
          window.open('https://github.com/diorhc/YTDL', '_blank');
          return;
        }

        if (target.id === 'open-ytp-github' || target.closest('#open-ytp-github')) {
          window.open('https://github.com/diorhc/YTP', '_blank');
          return;
        }

        if (target.id === 'open-ytp-discussions' || target.closest('#open-ytp-discussions')) {
          window.open('https://github.com/diorhc/YTP/discussions', '_blank');
          return;
        }

        if (target.id === 'open-ytp-greasyfork' || target.closest('#open-ytp-greasyfork')) {
          window.open('https://greasyfork.org/en/scripts/537017-youtube', '_blank');
          return;
        }

        // Toggle checkboxes when clicking anywhere on the settings item row
        const itemRow = target.closest('.ytp-plus-settings-item');
        if (
          itemRow &&
          !target.closest('input, select, button, a, .glass-dropdown, .ytp-plus-submenu-toggle')
        ) {
          const checkbox = itemRow.querySelector('.ytp-plus-settings-checkbox');
          if (checkbox instanceof HTMLInputElement) {
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
        }

        // Handle different actions
        this.handleModalClickActions(target, modal, handlers, markDirty, context, t);
      };

      modal.addEventListener('click', handleModalClick);

      // Change event delegation for checkboxes and selects
      modal.addEventListener('change', (/** @type {any} */ e) => {
        const target = /** @type {HTMLElement} */ (e.target);

        // Handle select elements with data-setting
        if (
          /** @type {any} */ (target).tagName === 'SELECT' &&
          /** @type {any} */ (target).dataset?.setting
        ) {
          const setting = /** @type {any} */ (target).dataset.setting;
          const rawValue = /** @type {any} */ (target).value;
          const numericValue = Number(rawValue);
          const parsedValue =
            rawValue !== '' && Number.isNaN(numericValue) ? rawValue : numericValue;
          handlers.setSettingByPath(this.settings, setting, parsedValue);
          markDirty();
          handlers.applySettingLive(setting, context);
          this.saveSettings();
          return;
        }

        if (!target.classList.contains('ytp-plus-settings-checkbox')) return;

        const { dataset } = /** @type {any} */ (target);
        const { setting } = dataset;
        if (!setting) return;

        // Download site checkboxes
        if (setting.startsWith('downloadSite_')) {
          const key = setting.replace('downloadSite_', '');
          handlers.handleDownloadSiteToggle(
            target,
            key,
            this.settings,
            markDirty,
            this.saveSettings.bind(this)
          );
          return;
        }

        // YouTube Music settings - handle separately
        if (handlers.isMusicSetting?.(setting)) {
          handlers.handleMusicSettingToggle(target, setting, this.showNotification.bind(this), t);
          return;
        }

        // Simple settings
        handlers.handleSimpleSettingToggle(
          target,
          setting,
          this.settings,
          context,
          markDirty,
          this.saveSettings.bind(this),
          modal
        );
      });

      // Input event delegation - allow free editing
      modal.addEventListener('input', (/** @type {any} */ e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.classList.contains('speed-hotkey-input')) {
          const keyType = target.dataset?.speedHotkey;
          if (keyType !== 'decrease' && keyType !== 'increase' && keyType !== 'reset') return;
          // Allow free editing on input, normalize on blur
          markDirty();
          return;
        }

        if (target.classList.contains('loop-hotkey-input')) {
          const keyType = target.dataset?.loopHotkey;
          if (keyType !== 'setPointA' && keyType !== 'setPointB' && keyType !== 'resetPoints') {
            return;
          }
          // Allow free editing on input, normalize on blur
          markDirty();
          return;
        }

        if (target.classList.contains('download-site-input')) {
          const { dataset } = /** @type {any} */ (target);
          const { site, field } = dataset;
          if (!(site && field)) return;
          handlers.handleDownloadSiteInput(target, site, field, this.settings, markDirty, t);
        }
      });

      // Blur event delegation - normalize hotkey inputs when editing ends
      modal.addEventListener(
        'blur',
        (/** @type {any} */ e) => {
          const target = /** @type {HTMLElement} */ (e.target);
          if (target.classList.contains('speed-hotkey-input')) {
            const keyType = target.dataset?.speedHotkey;
            if (keyType !== 'decrease' && keyType !== 'increase' && keyType !== 'reset') return;

            const input = /** @type {HTMLInputElement} */ (target);
            const fallback = keyType === 'decrease' ? 'g' : keyType === 'increase' ? 'h' : 'b';
            const normalized = this.normalizeSpeedHotkey(input.value, fallback);

            this.settings.speedControlHotkeys = this.settings.speedControlHotkeys || {
              decrease: 'g',
              increase: 'h',
              reset: 'b',
            };
            this.settings.speedControlHotkeys[keyType] = normalized;
            input.value = normalized;
            this.saveSettings();
            return;
          }

          if (target.classList.contains('loop-hotkey-input')) {
            const keyType = target.dataset?.loopHotkey;
            if (keyType !== 'setPointA' && keyType !== 'setPointB' && keyType !== 'resetPoints') {
              return;
            }

            const input = /** @type {HTMLInputElement} */ (target);
            const fallback = keyType === 'setPointA' ? 'k' : keyType === 'setPointB' ? 'l' : 'o';
            const normalized = this.normalizeSpeedHotkey(input.value, fallback);

            this.settings.loopHotkeys = this.settings.loopHotkeys || {
              toggleLoop: 'r',
              setPointA: 'k',
              setPointB: 'l',
              resetPoints: 'o',
            };
            this.settings.loopHotkeys[keyType] = normalized;
            input.value = normalized;
            this.saveSettings();
            return;
          }
        },
        true
      );

      // Allow report module to populate settings
      try {
        if (
          typeof window !== 'undefined' &&
          window.youtubePlusReport &&
          typeof window.youtubePlusReport.render === 'function'
        ) {
          try {
            window.youtubePlusReport.render(modal);
          } catch (e) {
            YouTubeUtils.logError('Report', 'report.render failed', /** @type {any} */ (e));
          }
        }
      } catch (e) {
        YouTubeUtils.logError(
          'Report',
          'Failed to initialize report section',
          /** @type {any} */ (e)
        );
      }

      // Restore submenu expanded states from modal UI-state store
      const submenuStates = basicUiState_.submenuStates.read();
      try {
        Object.entries(submenuStates).forEach(([key, expanded]) => {
          const toggleBtn = modal.querySelector(`.ytp-plus-submenu-toggle[data-submenu="${key}"]`);
          if (toggleBtn instanceof HTMLElement && !toggleBtn.hasAttribute('disabled')) {
            const submenuEl = modal.querySelector(basicSubmenuSelector_(key));
            if (submenuEl instanceof HTMLElement) {
              const isExpanded = !!expanded;
              /** @type {any} */ (submenuEl).style.display = isExpanded ? '' : 'none';
              submenuEl.classList.toggle('is-hidden', !isExpanded);
              toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            }
          }
        });
      } catch (_e) {
        // Ignore storage errors
      }

      // Safety: if Advanced feature toggles are enabled and no explicit saved submenu state exists,
      // ensure those submenus are visible so users see all available options.
      try {
        const advancedSection = modal.querySelector(
          '.ytp-plus-settings-section[data-section="advanced"]'
        );
        if (advancedSection instanceof HTMLElement) {
          const ensureVisibleWhenEnabled = (
            /** @type {any} */ key,
            /** @type {any} */ setting,
            /** @type {any} */ submenuSelector
          ) => {
            if (Object.hasOwn(submenuStates, key)) return;
            const checkbox = advancedSection.querySelector(
              `.ytp-plus-settings-checkbox[data-setting="${setting}"]`
            );
            const submenu = advancedSection.querySelector(submenuSelector);
            const toggleBtn = advancedSection.querySelector(
              `.ytp-plus-submenu-toggle[data-submenu="${key}"]`
            );
            if (
              checkbox instanceof Element &&
              checkbox.classList.contains('ytp-plus-settings-checkbox') &&
              /** @type {HTMLInputElement} */ (checkbox).checked &&
              submenu instanceof HTMLElement
            ) {
              /** @type {any} */ (submenu).style.display = '';
              submenu.classList.remove('is-hidden');
              if (toggleBtn instanceof HTMLElement) {
                toggleBtn.setAttribute('aria-expanded', 'true');
              }
            }
          };

          ensureVisibleWhenEnabled('enhanced', 'enableEnhanced', basicSubmenuSelector_('enhanced'));
          ensureVisibleWhenEnabled('music', 'enableMusic', basicSubmenuSelector_('music'));
        }
      } catch (_e) {
        // Ignore layout recovery errors
      }

      // Restore active nav section from localStorage. The saved value
      // is treated as a hint only: if it points at a section that no
      // longer exists in the DOM (renamed, removed, or corrupted value)
      // we fall back to the first nav item so the user is never left
      // staring at an empty modal — that regression made the whole
      // settings UI look broken even though `createMainContent` itself
      // was rendering correctly.
      try {
        const validSections = new Set(
          Array.from(modal.querySelectorAll('.ytp-plus-settings-nav-item')).map(
            item => /** @type {HTMLElement} */ (item).dataset?.section
          )
        );
        const fallbackSection =
          modal.querySelector('.ytp-plus-settings-nav-item')?.dataset?.section || null;
        const savedSection = validSections.has(basicUiState_.activeNavSection.read())
          ? basicUiState_.activeNavSection.read()
          : fallbackSection;
        if (savedSection) {
          const navItem = modal.querySelector(
            `.ytp-plus-settings-nav-item[data-section="${savedSection}"]`
          );
          if (navItem) {
            modal
              .querySelectorAll('.ytp-plus-settings-nav-item')
              .forEach(item => item.classList.remove('active'));
            modal.querySelectorAll('.ytp-plus-settings-section').forEach(s => {
              s.classList.add('hidden');
              if (
                modal.getAttribute('data-ytp-inline-fallback') === 'true' &&
                s instanceof HTMLElement
              ) {
                s.style.display = 'none';
              }
            });
            navItem.classList.add('active');
            const targetSection = modal.querySelector(
              `.ytp-plus-settings-section[data-section="${savedSection}"]`
            );
            if (targetSection instanceof HTMLElement) {
              targetSection.classList.remove('hidden');
              if (modal.getAttribute('data-ytp-inline-fallback') === 'true') {
                targetSection.style.display = '';
              }
            }

            // Broadcast the initial section activation so feature
            // modules that opted in via `onSectionActive` can
            // hydrate their UI without waiting for the user to
            // click a different tab first. Use a short timeout so
            // section display/layout changes settle before listeners
            // measure the DOM.
            try {
              setTimeout(() => {
                document.dispatchEvent(
                  new CustomEvent('youtube-plus-settings-section-activated', {
                    detail: {
                      section: savedSection,
                      label: navItem.dataset?.label || '',
                    },
                    bubbles: true,
                  })
                );
              }, 0);
            } catch (_e) {
              window.YouTubePlusErrorBoundary?.logError?.(
                _e instanceof Error ? _e : new Error(String(_e)),
                { module: 'Basic' }
              );
            }
          }
        }
      } catch (_e) {
        // Ignore storage errors
      }

      return modal;
    },

    openSettingsModal() {
      try {
        this.insertStyles();
        window.YouTubePlusDesignSystem?.repairStyles?.();
      } catch (_e) {
        window.YouTubePlusErrorBoundary?.logError?.(
          _e instanceof Error ? _e : new Error(String(_e)),
          { module: 'Basic' }
        );
      }
      const existingModal = this.getElement('.ytp-plus-settings-modal', false);
      if (existingModal) {
        try {
          document.dispatchEvent(
            new CustomEvent('youtube-plus-settings-modal-closed', {
              bubbles: true,
            })
          );
        } catch (_e) {
          window.YouTubePlusErrorBoundary?.logError?.(
            _e instanceof Error ? _e : new Error(String(_e)),
            { module: 'Basic' }
          );
        }
        existingModal.remove();
      }
      if (typeof (/** @type {any} */ (this).ensureNonCriticalStyles) === 'function') {
        /** @type {any} */ (this).ensureNonCriticalStyles();
      }
      (document.body || document.documentElement).appendChild(this.createSettingsModal());
      // Initialize voting system
      if (window.YouTubePlus?.Voting) {
        const domCache = /** @type {any} */ (window).YouTubePlusDOMCache;
        const votingContainer =
          domCache?.getElementById?.('ytp-plus-voting-container') ||
          (typeof document !== 'undefined'
            ? document.getElementById('ytp-plus-voting-container')
            : null);
        if (votingContainer) {
          window.YouTubePlus.Voting.init();
          window.YouTubePlus.Voting.createUI(votingContainer);
        }
      }
      // Notify modules that settings modal is now in DOM
      try {
        document.dispatchEvent(
          new CustomEvent('youtube-plus-settings-modal-opened', {
            bubbles: true,
          })
        );
      } catch (_e) {
        // ignore event dispatch errors
      }
    },

    /**
     * Wait for an element matching `selector` to appear in the DOM.
     *
     * Delegates to the canonical DOM cache's `waitForElement` so
     * basic.js stops owning its own `setInterval` poller. The
     * canonical implementation:
     *   - resolves immediately if the element is already in the DOM
     *     (via the same `querySelector` the rest of the cache uses),
     *   - subscribes to a single shared `MutationObserver` (one
     *     observer for the whole userscript, not one per caller),
     *   - respects `timeout` and returns `null` on expiry.
     *
     * The previous setInterval(120ms) implementation created a new
     * timer per call and was never unregistered on early resolve,
     * which leaked a timer + a querySelector per `setupCurrentPage`
     * cycle.
     */
    waitForElement(/** @type {string | null | undefined} */ selector, timeout = 5000) {
      if (!selector) return Promise.resolve(null);
      const cache = /** @type {any} */ (window).YouTubePlusDOMCache;
      if (cache && typeof cache.waitForElement === 'function') {
        return cache.waitForElement(selector, timeout);
      }
      // Last-resort fallback when the canonical cache is unavailable
      // (e.g., partial load or test harness). Documented as a
      // compatibility shim; production builds always have the cache.
      return new Promise(resolve => {
        if (typeof document === 'undefined') {
          resolve(null);
          return;
        }
        const immediate = document.querySelector(selector);
        if (immediate) {
          resolve(immediate);
          return;
        }
        const start = Date.now();
        const poll = setInterval(() => {
          const found = document.querySelector(/** @type {string} */ (selector));
          if (found) {
            clearInterval(poll);
            YouTubeUtils.cleanupManager?.unregisterInterval?.(poll);
            resolve(found);
            return;
          }
          if (Date.now() - start >= timeout) {
            clearInterval(poll);
            YouTubeUtils.cleanupManager?.unregisterInterval?.(poll);
            resolve(null);
          }
        }, 120);
        YouTubeUtils.cleanupManager?.registerInterval?.(poll);
      });
    },

    addCustomButtons() {
      const controls = this.getElement('.ytp-right-controls');
      if (!controls) return;

      if (!this.getElement('.ytp-screenshot-button')) this.addScreenshotButton(controls);
      if (!this.getElement('.ytp-download-button')) this.addDownloadButton(controls);
      if (!this.getElement('.speed-control-btn')) this.addSpeedControlButton(controls);

      this.handleFullscreenChange();
    },

    addScreenshotButton(/** @type {any} */ controls) {
      const screenshotApi = window.YouTubePlusScreenshot;
      if (screenshotApi && typeof screenshotApi.addButton === 'function') {
        screenshotApi.addButton(this, controls);
      }
    },

    addDownloadButton(/** @type {HTMLElement} */ controls) {
      if (typeof window !== 'undefined' && window.YouTubePlusDownloadButton) {
        const manager = window.YouTubePlusDownloadButton.createDownloadButtonManager({
          settings: this.settings,
          t,
          getElement: this.getElement.bind(this),
          YouTubeUtils,
        });
        manager.addDownloadButton(controls);
      }
    },

    addSpeedControlButton(/** @type {any} */ controls) {
      const speedApi = window.YouTubePlusSpeedControl;
      if (speedApi && typeof speedApi.addButton === 'function') {
        speedApi.addButton(this, controls);
      }
    },

    // ------------------ Side Guide Toggle ------------------
    applyGuideVisibility() {
      try {
        const enabled = Boolean(YouTubeUtils.storage.get('ytplus.hideGuide', false));
        document.documentElement.classList.toggle('ytp-hide-guide', enabled);
        // update floating button appearance if present
        const btn =
          /** @type {any} */ (window).YouTubePlusDOMCache?.getElementById?.(
            BASIC_GUIDE_TOGGLE_BTN_ID_
          ) ||
          (typeof document !== 'undefined'
            ? document.getElementById(BASIC_GUIDE_TOGGLE_BTN_ID_)
            : null);
        if (btn) {
          btn.setAttribute('aria-pressed', String(enabled));
          const label = enabled ? 'Show side guide' : 'Hide side guide';
          btn.title = label;
          btn.setAttribute('aria-label', label);
        }
      } catch (e) {
        YouTubePlusLogger?.warn?.('Basic', 'applyGuideVisibility failed', e);
      }
    },

    toggleSideGuide() {
      try {
        const current = Boolean(YouTubeUtils.storage.get('ytplus.hideGuide', false));
        const next = !current;
        YouTubeUtils.storage.set('ytplus.hideGuide', next);
        this.applyGuideVisibility();
      } catch (e) {
        YouTubePlusLogger?.warn?.('Basic', 'toggleSideGuide failed', e);
      }
    },

    createGuideToggleButton() {
      try {
        if (basicHasGuideToggleButton_()) return;
        const btn = document.createElement('button');
        btn.id = BASIC_GUIDE_TOGGLE_BTN_ID_;
        btn.type = 'button';
        btn.className = 'ytplus-guide-toggle-btn';
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', 'Hide side guide');
        btn.title = 'Hide side guide';
        btn.textContent = 'Toggle Guide';
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleSideGuide();
        });

        // keyboard support
        btn.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.toggleSideGuide();
          }
        });

        document.body.appendChild(btn);
        // Apply current stored value
        this.applyGuideVisibility();
      } catch (e) {
        YouTubePlusLogger?.warn?.('Basic', 'createGuideToggleButton failed', e);
      }
    },

    captureFrame() {
      const screenshotApi = window.YouTubePlusScreenshot;
      if (screenshotApi && typeof screenshotApi.capture === 'function') {
        screenshotApi.capture(this);
        return;
      }

      YouTubePlusLogger?.warn?.('Basic', 'Screenshot module not loaded');
    },

    showNotification(/** @type {any} */ message, duration = 2000) {
      YouTubeUtils.NotificationManager.show(message, {
        duration,
        type: 'info',
      });
    },

    handleFullscreenChange() {
      document.querySelectorAll('.ytp-screenshot-button, .ytp-cobalt-button').forEach(button => {
        /** @type {any} */ (button).style.bottom = '0px';
      });
    },

    changeSpeed(/** @type {any} */ speed) {
      const speedApi = window.YouTubePlusSpeedControl;
      if (speedApi && typeof speedApi.changeSpeed === 'function') {
        speedApi.changeSpeed(this, speed);
        return;
      }

      const numericSpeed = Number(speed);
      this.speedControl.currentSpeed = numericSpeed;
      localStorage.setItem(this.speedControl.storageKey, String(numericSpeed));
    },

    applyCurrentSpeed() {
      const speedApi = window.YouTubePlusSpeedControl;
      if (speedApi && typeof speedApi.applyCurrentSpeed === 'function') {
        speedApi.applyCurrentSpeed(this);
      }
    },

    setupVideoObserver() {
      const speedApi = window.YouTubePlusSpeedControl;
      if (speedApi && typeof speedApi.setupVideoObserver === 'function') {
        speedApi.setupVideoObserver(this);
      }
    },

    /**
     * Install the SPA navigation listeners. Idempotent: a
     * defensive re-entry (e.g. a future retry path) early-returns
     * instead of registering a second batch. The window-level
     * `__ytpBasicInitDone__` guard is the primary defense; this
     * is defense-in-depth.
     *
     * Handler references are stored on the instance so the
     * cleanupManager dedupes by `(target, event, fn)` identity
     * and the fullscreenchange `bind(this)` is shared across
     * calls instead of leaking a new bound function each time.
     */
    setupNavigationObserver() {
      if (this._navigationObserverStarted) return;
      this._navigationObserverStarted = true;

      let lastUrl = location.href;

      if (!this._onFullscreenChange_) {
        this._onFullscreenChange_ = this.handleFullscreenChange.bind(this);
      }
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'fullscreenchange',
        this._onFullscreenChange_
      );

      if (!this._onNavigateFinish_) {
        this._onNavigateFinish_ = () => {
          this.insertStyles();
          if (location.href.includes('watch?v=')) this.setupCurrentPage();
          this.addSettingsButtonToHeader();
        };
      }
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'yt-navigate-finish',
        this._onNavigateFinish_
      );

      // Use popstate + pushState/replaceState override for SPA
      // navigation fallback instead of an expensive body subtree
      // MutationObserver. The 500ms debounce timer is registered
      // with the cleanupManager so it cannot fire on a torn-down
      // page (e.g. when the user navigates away within the 500ms
      // window, we used to leave a dangling timer that re-ran
      // setupCurrentPage on the next page mount).
      const checkUrlChange = () => {
        if (lastUrl !== location.href) {
          lastUrl = location.href;
          if (location.href.includes('watch?v=')) {
            const timerId = basicSetTimeout_(
              () => /** @type {any} */ (this).setupCurrentPage(),
              500
            );
            try {
              YouTubeUtils.cleanupManager?.registerTimeout?.(timerId);
            } catch (_e) {
              /* best-effort registration; timer still works */
            }
          }
          this.addSettingsButtonToHeader();
        }
      };

      if (!this._onPopState_) this._onPopState_ = checkUrlChange;
      if (!this._onNavigateStart_) this._onNavigateStart_ = checkUrlChange;
      YouTubeUtils.cleanupManager.registerListener(window, 'popstate', this._onPopState_);
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'yt-navigate-start',
        this._onNavigateStart_
      );
    },

    showSpeedIndicator(/** @type {any} */ speed) {
      const speedApi = window.YouTubePlusSpeedControl;
      if (speedApi && typeof speedApi.showSpeedIndicator === 'function') {
        speedApi.showSpeedIndicator(this, speed);
      }
    },
  };

  // Save reference to init function BEFORE IIFE closes (critical for DOMContentLoaded)
  const initFunction = YouTubeEnhancer.init.bind(YouTubeEnhancer);

  // Expose a small public API for programmatic control of the settings modal.
  // This is the supported entry-point for opening/closing the settings UI from
  // bookmarklets, tests, and integrations (see Sprint 1 of AUDIT_REPORT.md).
  try {
    /** @type {any} */ (window).YouTubePlus = /** @type {any} */ (window).YouTubePlus || {};
    /** @type {any} */ (window).YouTubePlus.openSettings = (
      /** @type {{section?: string} | undefined} */ opts
    ) => {
      try {
        if (opts && typeof opts.section === 'string') {
          basicUiState_.lastOpenSection.write(opts.section);
        }
        YouTubeEnhancer.openSettingsModal();
        return true;
      } catch (e) {
        YouTubePlusLogger?.warn?.('Basic', 'openSettings failed', e);
        return false;
      }
    };
    /** @type {any} */ (window).YouTubePlus.closeSettings = () => {
      try {
        const domCache = /** @type {any} */ (window).YouTubePlusDOMCache;
        const existing =
          domCache?.querySelector?.('.ytp-plus-settings-modal', document, true) ||
          (typeof document !== 'undefined'
            ? document.querySelector('.ytp-plus-settings-modal')
            : null);
        if (existing) {
          try {
            document.dispatchEvent(
              new CustomEvent('youtube-plus-settings-modal-closed', {
                bubbles: true,
              })
            );
          } catch (_e) {
            // Non-critical
          }
          existing.remove();
          return true;
        }
        return false;
      } catch (e) {
        YouTubePlusLogger?.warn?.('Basic', 'closeSettings failed', e);
        return false;
      }
    };
  } catch (e) {
    // Defensive: never let public API wiring break the script
    YouTubePlusLogger?.warn?.('Basic', 'Failed to expose public settings API', e);
  }

  // Re-entrancy guard.
  //
  // basic.js has shipped for a long time with only an internal
  // `_initialized` flag on the YouTubeEnhancer instance, which
  // protects against `init()` being called twice in the same
  // module instance. It does NOT protect against the script
  // being injected twice (e.g., HMR, the host re-loading the
  // userscript, a test harness re-requiring the module after
  // resetModules). When that happens, a fresh IIFE closure runs
  // and we end up with two parallel init() pipelines, two
  // keyboard listeners, two settings button mount attempts,
  // and — most importantly — two competing `registerListener`
  // calls that double-fire hotkeys and modal-close events.
  //
  // The window-level guard is checked before the IIFE body
  // touches any DOM so re-injection is a true no-op.
  /** @type {boolean} */
  const basicInitGuard = (() => {
    if (typeof window === 'undefined') return true;
    /** @type {any} */
    const w = window;
    if (w.__ytpBasicInitDone__) return false;
    w.__ytpBasicInitDone__ = true;
    return true;
  })();

  if (basicInitGuard) {
    // Initialize immediately or on DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initFunction);
    } else {
      initFunction();
    }
  }
})();
