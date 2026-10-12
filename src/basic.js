// Boot orchestrator for YouTube+.
//
// Responsibility: settings modal shell, YouTubeUtils global surface,
//   NotificationManager, and the `__ytpBasicInitDone__` idempotency flag.
// Public surface: window.YouTubeUtils, window.YouTubePlusDebug.

const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
  window.YouTubeUtils?.logSuppressed?.(_err, _label || 'Basic');

/**
 * Stable CSS class / id strings for the launcher elements basic.js
 * mounts on the host page; renaming them means editing one place.
 */
const BASIC_SETTINGS_BUTTON_SEL_ = '.yp-settings-button';
const BASIC_NOTIF_CONTAINER_ID_ = 'youtube-enhancer-notification-container';
const BASIC_NOTIF_CLASS_ = 'youtube-enhancer-notification';

/**
 * Idempotent UI guards.
 *
 * The mount paths (settings button, guide toggle button) are
 * reachable from several call sites (init, navigation finish,
 * popstate, URL change fallback) and the NotificationManager is
 * a hot path. Each guard consults the DOM cache when it is
 * installed, and falls back to a direct `querySelector` only when
 * the cache is not there (partial load / test harness).
 */
const basicHasSettingsButton_ = () => {
  const cache = window.YouTubePlusDOMCache;
  if (cache && typeof cache.querySelector === 'function') {
    return !!cache.querySelector(BASIC_SETTINGS_BUTTON_SEL_, document, true);
  }
  return typeof document !== 'undefined' && !!document.querySelector(BASIC_SETTINGS_BUTTON_SEL_);
};

const createActiveNotificationsStore_ = () => {
  const ws = new WeakSet();
  return {
    add(/** @type {Element} */ el) {
      if (el) ws.add(el);
      return this;
    },
    delete(/** @type {Element} */ el) {
      if (el) ws.delete(el);
      return true;
    },
    has(/** @type {Element} */ el) {
      return el ? ws.has(el) : false;
    },
    get size() {
      const container =
        typeof document !== 'undefined' ? document.getElementById(BASIC_NOTIF_CONTAINER_ID_) : null;
      return container ? container.children.length : 0;
    },
    forEach(/** @type {(item: Element) => void} */ fn) {
      const container =
        typeof document !== 'undefined' ? document.getElementById(BASIC_NOTIF_CONTAINER_ID_) : null;
      if (container) {
        Array.from(container.children).forEach(fn);
      }
    },
    clear() {
      const container =
        typeof document !== 'undefined' ? document.getElementById(BASIC_NOTIF_CONTAINER_ID_) : null;
      if (container) {
        container.replaceChildren();
      }
    },
    [Symbol.iterator]() {
      const container =
        typeof document !== 'undefined' ? document.getElementById(BASIC_NOTIF_CONTAINER_ID_) : null;
      const children = container ? Array.from(container.children) : [];
      return children[Symbol.iterator]();
    },
  };
};

/**
 * Centralized Notification System
 * Manages all notifications with queue and deduplication
 */
const NotificationManager = {
  queue: [],
  activeNotifications: createActiveNotificationsStore_(),
  maxVisible: 3,
  defaultDuration: 3000,

  /**
   * Show notification
   * @param {string} message - Notification message
   * @param {{duration?: number, position?: string | null, action?: {text: string, callback: () => void} | null, type?: string}} [options] - Notification options
   * @returns {HTMLElement | null} Notification element
   */
  show(message, options = {}) {
    // Validate message
    if (!message || typeof message !== 'string') {
      window.YouTubeUtils?.logError?.(
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
      if (notif instanceof HTMLElement && notif.dataset.message === message) {
        this.remove(notif);
      }
    });

    /** @type {{ [key: string]: { top?: string, right?: string, bottom?: string, left?: string } }} */
    const positions = {
      'top-right': { top: '20px', right: '20px' },
      'top-left': { top: '20px', left: '20px' },
      'bottom-right': { bottom: '20px', right: '20px' },
      'bottom-left': { bottom: '20px', left: '20px' },
    };

    // Use shared enhancer notification class for consistent appearance
    const notification = document.createElement('div');
    notification.className = BASIC_NOTIF_CLASS_;
    notification.dataset.message = message; // Store message for deduplication
    // Keep minimal inline styles; main visuals come from the shared CSS class
    Object.assign(notification.style, {
      zIndex: '10001',
      width: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      ...(position && positions[position] ? positions[position] : {}),
    });

    // Add message (with accessibility attributes)
    notification.setAttribute('role', 'status');
    notification.setAttribute('aria-live', 'polite');
    notification.setAttribute('aria-atomic', 'true');

    const messageSpan = document.createElement('span');
    messageSpan.style.flex = '1';
    messageSpan.textContent = message;
    notification.appendChild(messageSpan);

    // Add action button if provided
    if (action?.text && typeof action.callback === 'function') {
      const actionBtn = document.createElement('button');
      Object.assign(actionBtn.style, {
        background: 'var(--yt-button-bg)',
        border: '1px solid var(--yt-glass-border)',
        color: 'white',
        padding: '4px 12px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: '600',
        transition: 'background 0.2s',
      });
      window.YouTubePlusCleanupManager?.registerListener?.(
        actionBtn,
        'click',
        () => {
          action.callback();
          this.remove(notification);
        },
        undefined,
        false
      );
      actionBtn.textContent = action.text;
      notification.appendChild(actionBtn);
    }

    // Ensure a centralized bottom-center container exists and add notification there
    const _notifContainerId = BASIC_NOTIF_CONTAINER_ID_;
    let _notifContainer =
      window.YouTubePlusDOMCache?.getElementById?.(_notifContainerId) ||
      (typeof document !== 'undefined' ? document.getElementById(_notifContainerId) : null);
    if (!_notifContainer) {
      _notifContainer = document.createElement('div');
      _notifContainer.id = _notifContainerId;
      _notifContainer.className = 'youtube-enhancer-notification-container';
      const appendRoot = document.body || document.documentElement;
      if (!appendRoot) return null;
      appendRoot.appendChild(_notifContainer);
    }

    // Prepend so newest notifications appear on top
    _notifContainer.insertBefore(notification, _notifContainer.firstChild);

    // ensure notification accepts pointer events (container is pointer-events:none)
    notification.style.pointerEvents = 'auto';
    // Apply entry animation from bottom
    notification.style.animation = 'slideInFromBottom 0.38s ease-out forwards';
    this.activeNotifications.add(notification);

    // Auto-dismiss
    if (duration > 0) {
      const dismiss = () => this.remove(notification);
      window.YouTubeUtils?.cleanupManager?.timeout?.(dismiss, duration);
    }

    // Limit visible notifications
    if (this.activeNotifications.size > this.maxVisible) {
      const oldest = Array.from(this.activeNotifications)[0];
      this.remove(oldest);
    }

    return notification;
  },

  /**
   * Remove notification
   * @param {Element | null | undefined} notification - Notification element
   */
  remove(notification) {
    if (!(notification instanceof HTMLElement && notification.isConnected)) return;

    notification.style.animation = 'slideOutToBottom 0.32s ease-in forwards';
    const detach = () => {
      notification.remove();
      this.activeNotifications.delete(notification);
    };
    window.YouTubeUtils?.cleanupManager?.timeout?.(detach, 340);
  },

  /**
   * Clear all notifications
   */
  clearAll() {
    this.activeNotifications.forEach(notif => {
      notif.remove();
    });
    this.activeNotifications.clear();
  },
};

// Global cleanup on page unload
window.YouTubePlusCleanupManager?.registerListener?.(
  window,
  'beforeunload',
  () => {
    window.YouTubeUtils?.cleanupManager?.cleanup?.();
    window.YouTubePlusDOMCache?.invalidate?.();
    window.YouTubeUtils?.StyleManager?.clear?.();
    NotificationManager.clearAll();
  },
  undefined,
  true
);

// Global error/rejection handling is owned exclusively by ErrorBoundary
// (installed in error-boundary.js with proper classification, third-party
// filtering, and dedup). Duplicate window-level handlers here caused the
// same failure to be logged twice ("Unhandled promise rejection" spam),
// so they were removed (Stage 10 console-noise fix).

// Make available globally
if (typeof window !== 'undefined') {
  // utils.js (build order) owns the facade; only NotificationManager lives
  // here, and it is only added when the facade does not already carry one.
  const existing = window.YouTubeUtils;
  if (existing.NotificationManager === undefined) {
    existing.NotificationManager = NotificationManager;
  }

  // Local alias for downstream code in this file
  const YouTubeUtils = window.YouTubeUtils;

  // The running version comes from the userscript metadata, never a
  // hardcoded literal (literals drifted out of sync here before).
  const basicScriptVersion = YouTubeUtils?.getScriptVersion?.() ?? 'dev';

  // Add initialization health check (non-intrusive)
  window.YouTubeUtils &&
    YouTubeUtils.logger?.debug?.(`[YouTube+ v${basicScriptVersion}] Core utilities merged`);

  window.YouTubePlusDebug = {
    version: basicScriptVersion,
    clearAll: () => {
      YouTubeUtils.cleanupManager.cleanup();
      window.YouTubePlusDOMCache?.invalidate?.();
      YouTubeUtils.StyleManager.clear();
      NotificationManager.clearAll();
      window.YouTubeUtils && YouTubeUtils.logger?.debug?.('[YouTube+] All resources cleared');
    },
    stats: () => ({
      observers: YouTubeUtils.cleanupManager.observers.size,
      listeners: YouTubeUtils.cleanupManager.listeners.size,
      intervals: YouTubeUtils.cleanupManager.intervals.size,
      timeouts: YouTubeUtils.cleanupManager.timeouts.size,
      animationFrames: YouTubeUtils.cleanupManager.animationFrames.size,
      styles: YouTubeUtils.StyleManager.styles.size,
      notifications: NotificationManager.activeNotifications.size,
    }),
  };
  // Page-context (unsafeWindow) exposure is opt-in: the Debug surface is the
  // only thing allowed past the sandbox boundary, and only when the user
  // enables the debug-surface setting (default off).
  const debugSurfaceEnabled = window.YouTubePlusSettingsStore?.get?.('enableDebugSurface') === true;
  if (debugSurfaceEnabled && typeof unsafeWindow !== 'undefined') {
    unsafeWindow.YouTubePlusDebug = window.YouTubePlusDebug;
  }

  // Show subtle startup notification (only once per session). Wrap the
  // sessionStorage access in a try/catch so sandboxed contexts (about:blank,
  // detached iframe, hardened YouTube embeds) where sessionStorage throws
  // a SecurityError do not abort the rest of the boot sequence: a
  // non-critical startup banner must never break module init.
  let firstStart = true;
  try {
    if (typeof sessionStorage !== 'undefined') {
      firstStart = !sessionStorage.getItem('youtube_plus_started');
      if (firstStart) sessionStorage.setItem('youtube_plus_started', 'true');
    }
  } catch (_e) {
    logS(_e);
    // sessionStorage unavailable (sandboxed page): assume first start.
    firstStart = true;
  }
  if (firstStart) {
    window.YouTubePlusCleanupManager?.timeout?.(() => {
      if (YouTubeUtils.NotificationManager) {
        YouTubeUtils.NotificationManager.show(`YouTube+ v${basicScriptVersion} loaded`, {
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
  const YouTubeUtils = window.YouTubeUtils;
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
    // shape: JSDoc-inferred type from the `null` literal would
    // be just `null`, which a function assignment cannot satisfy.
    /** @type {(() => void) | null} */ _onVisibilityChange_: null,
    /** @type {(() => void) | null} */ _onFullscreenChange_: null,
    /** @type {(() => void) | null} */ _onPopState_: null,
    /** @type {(() => void) | null} */ _onNavigateStart_: null,
    /** @type {(() => void) | null} */ _onNavigateFinish_: null,
    /** @type {boolean} */ _navigationObserverStarted: false,
    /** @type {boolean} */ _settingsUpdateSubscribed_: false,

    // Settings
    /** @type {YoutubePlusSettings} */
    settings: (function () {
      const store = typeof window !== 'undefined' ? window.YouTubePlusSettingsStore : null;
      if (store && typeof store.load === 'function') {
        return store.load();
      }
      // The Store owns the defaults; the emergency fallback clones them
      // (DEFAULTS is frozen shallowly, and consumers mutate nested
      // styles/hotkeys objects). A duplicate list here would drift
      // from the store's restore behavior.
      const canonicalDefaults = store?._internals?.DEFAULTS;
      if (canonicalDefaults) {
        return JSON.parse(JSON.stringify(canonicalDefaults));
      }
      // Last-resort bootstrap (settings-store.js missing entirely): only the
      // flags the very first paint needs. The store owns the full defaults.
      return {
        enableSpeedControl: true,
        enableScreenshot: true,
        enableDownload: true,
        enableStyles: true,
      };
    })(),

    // Cached element getter.
    //
    // Routes through YouTubePlusDOMCache so basic.js stops
    // maintaining its own per-instance `Map`. The cache provides
    // TTL-based caching, a single shared observer for `waitForElement`,
    // and a global `invalidate()` / `clear()` surface. The `useCache`
    // parameter maps to the cache's `skipCache` flag so existing
    // callers (`useCache = false`) still force a fresh query.
    //
    // A small `isConnected` re-check is kept as a local safety net
    // because the cache's 5s TTL for found elements is
    // longer than a typical YouTube SPA teardown cycle, and a stale
    // detached element can break mount logic on the next navigation.
    getElement(/** @type {string} */ selector, useCache = true) {
      const cache = window.YouTubePlusDOMCache;
      return cache && typeof cache.querySelector === 'function'
        ? cache.querySelector(selector, document, !useCache)
        : typeof document !== 'undefined'
          ? document.querySelector(selector)
          : null;
    },

    loadSettings() {
      // Route settings reads through the store. The store
      // handles reading from `youtube_plus_settings`, migration from
      // the legacy `youtube_plus_all_settings_v2` key, and merging
      // with defaults. basic.js keeps `this.settings` as its
      // in-memory working copy (mutated throughout the module), so
      // we merge the store's result into it rather than replacing it.
      const store = window.YouTubePlusSettingsStore;
      const canonical = store && typeof store.load === 'function' ? store.load() : null;
      if (!canonical || typeof canonical !== 'object') return;
      const source = canonical;
      if (!source) return;
      if (window.YouTubeUtils?.safeMerge) {
        window.YouTubeUtils.safeMerge(this.settings, source);
      } else {
        Object.assign(this.settings, source);
      }
    },

    /**
     * Init orchestrator. Decomposed into named phases so the
     * boot order is explicit and each phase is independently
     * testable / debuggable.
     *
     * Phase order (must not be reordered casually):
     *   1. loadAndNormalizeSettings_: load settings, restore speed
     *   2. mountBootUI_: styles, settings button, navigation
     *   3. setupCurrentPageIfWatch_: page mount (only on /watch)
     *   4. registerVisibilityListener_: SPA tab-return handler
     *   5. registerFeatureHotkeys_: feature-owned hotkey hooks
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
    },

    /**
     * Phase 1: load settings from the store and restore
     * the saved playback speed.
     */
    loadAndNormalizeSettings_() {
      this.loadSettings();
      this.restorePlaybackSpeed_();
    },

    /**
     * Restore is owned by the Speed Control module (the single
     * owner of the speed state). Basic only mirrors the owner's value
     * into its compatibility surface (it never reads storage itself).
     */
    restorePlaybackSpeed_() {
      const restored = window.YouTubePlusSpeedControl?.restore?.();
      if (typeof restored === 'number' && restored > 0) {
        this.speedControl.currentSpeed = restored;
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
      window.YouTubePlusCleanupManager?.timeout?.(() => {
        this.insertStyles();
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
      // Session lifetime: Basic init runs once, so this document-level
      // listener must survive the per-navigation cleanup sweep, like
      // the other Basic dispatcher listeners below.
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'visibilitychange',
        this._onVisibilityChange_,
        undefined,
        'session'
      );
    },

    /**
     * Phase 5: delegate hotkey registration to the feature
     * modules. One broken module must not prevent the others from
     * registering.
     */
    registerFeatureHotkeys_() {
      /** @param {() => void} register @param {string} message */
      const tryRegister = (register, message) => {
        try {
          register();
        } catch (e) {
          logS(e);
          YouTubeUtils?.logError?.('Basic', message, e);
        }
      };
      tryRegister(
        () => window.YouTubePlusScreenshot?.registerHotkey?.(this),
        'Failed to initialize screenshot hotkey module'
      );
      tryRegister(
        () => window.YouTubePlusSpeedControl?.registerHotkeys?.(this),
        'Failed to initialize speed hotkey module'
      );
      tryRegister(
        () => window.YouTubePlusTimeLoop?.registerHotkeys?.(this),
        'Failed to initialize loop hotkey module'
      );
    },

    isEditableTarget(/** @type {EventTarget | null | undefined} */ target) {
      const active = target instanceof HTMLElement ? target : null;
      if (!active) return false;
      const tag = active.tagName.toLowerCase();
      return (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(active.isContentEditable)
      );
    },

    saveSettings() {
      // Route settings writes through the store. The store
      // writes to `youtube_plus_settings` and dispatches the unified
      // `youtube-plus-settings-updated` event. basic.js keeps
      // `this.settings` as its in-memory working copy, so we pass it
      // to the store for persistence.
      const store = window.YouTubePlusSettingsStore;
      if (store && typeof store.save === 'function') {
        // Module settings (`modules.<name>`: PiP/Timecode/screenshot hotkeys,
        // music, …) are written straight to the store by their modules and
        // never pass through this working copy. Pull the current namespace
        // before writing, otherwise a modal Save reverts a just-changed module
        // setting to the stale snapshot value.
        const current = typeof store.load === 'function' ? store.load() : null;
        if (current && typeof current === 'object' && current.modules) {
          this.settings.modules = current.modules;
        }
        store.save(this.settings);
      } else if (typeof window.YouTubePlusLogger !== 'undefined') {
        window.YouTubePlusLogger?.warn?.(
          'Basic',
          'settings store unavailable; settings not persisted'
        );
      }

      this.updatePageBasedOnSettings();
      this.refreshDownloadButton();
    },

    updatePageBasedOnSettings() {
      window.YouTubePlusSpeedControl?.refreshVisibility?.(!!this.settings.enableSpeedControl);
      window.YouTubePlusDownloadButton?.refreshVisibility?.(!!this.settings.enableDownload);
    },

    /** Build the download-button manager for this enhancer. */
    createDownloadManagerForThis_() {
      if (typeof window !== 'undefined' && window.YouTubePlusDownloadButton) {
        return window.YouTubePlusDownloadButton.createDownloadButtonManager({
          settings: this.settings,
          t,
          getElement: this.getElement.bind(this),
          YouTubeUtils,
        });
      }
      return null;
    },

    /**
     * Refresh download button visibility - Delegates to download-button module
     */
    refreshDownloadButton() {
      this.createDownloadManagerForThis_()?.refreshDownloadButton();
    },

    setupCurrentPage() {
      this.waitForElement('#movie_player, .html5-video-player', 5000)
        .then(() => {
          this.addCustomButtons();
          window.YouTubePlusSpeedControl?.setupVideoObserver?.(this);
          window.YouTubePlusSpeedControl?.applyCurrentSpeed?.(this);
          window.YouTubePlusTimeLoop?.applyLoopStateToCurrentVideo?.();
          this.updatePageBasedOnSettings();
          this.refreshDownloadButton();
        })
        .catch((/** @type {unknown} */ e) => logS(e));
    },

    insertStyles() {
      // Critical styles, injected synchronously: the minimal set
      // needed before first paint
      const ds = window.YouTubePlusDesignSystem;
      const criticalStyles = ds?.getStyle?.('yp-basic-critical-styles') || '';
      // The player surface (Vision dock, zoom popover, loop popovers) and the
      // shared UI pieces (download modal, glass components, dropdowns) must be
      // present without the settings window, so they load eagerly too.
      const playerSurfaceStyles = ds?.getStyle?.('yp-player-surface-styles') || '';
      const sharedUiStyles = ds?.getStyle?.('yp-shared-ui-styles') || '';
      const nonCriticalStyles = ds?.getStyle?.('yp-basic-settings-styles') || '';

      // Inject the shared UI CSS through the design-system StyleManager
      // so it shares the single style host with the rest of
      // the design system. The critical, player-surface and shared-UI sets are
      // added here; the settings-only CSS is injected lazily through
      // ensureNonCriticalStyles() when the settings window opens, so a page
      // that never opens it pays nothing for those rules.
      const SM = YouTubeUtils?.StyleManager;
      if (SM && typeof SM.add === 'function') {
        SM.add('yt-enhancer-main', criticalStyles);
        SM.add('yt-enhancer-player-surface', playerSurfaceStyles);
        SM.add('yt-enhancer-shared-ui', sharedUiStyles);
      }

      /** @type {{ ensureNonCriticalStyles?: () => void }} */ (this).ensureNonCriticalStyles =
        () => {
          const ncManager = YouTubeUtils?.StyleManager;
          if (ncManager && typeof ncManager.add === 'function') {
            ncManager.add('yt-enhancer-nc-styles', nonCriticalStyles);
          }
        };
    },

    openSettingsModal() {
      window.YouTubePlusSettingsModal?.open?.(this);
    },

    createSettingsLauncherButton() {
      const settingsButton = document.createElement('div');
      settingsButton.className = 'yp-settings-button';
      settingsButton.setAttribute('title', t('youtubeSettings'));
      _setSafeHTML(
        settingsButton,
        `
          <svg width="24" height="24" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M39.23,26a16.52,16.52,0,0,0,.14-2,16.52,16.52,0,0,0-.14-2l4.33-3.39a1,1,0,0,0,.25-1.31l-4.1-7.11a1,1,0,0,0-1.25-.44l-5.11,2.06a15.68,15.68,0,0,0-3.46-2l-.77-5.43a1,1,0,0,0-1-.86H19.9a1,1,0,0,0-1,.86l-.77,5.43a15.36,15.36,0,0,0-3.46,2L9.54,9.75a1,1,0,0,0-1.25.44L4.19,17.3a1,1,0,0,0,.25,1.31L8.76,22a16.66,16.66,0,0,0-.14,2,16.52,16.52,0,0,0,.14,2L4.44,29.39a1,1,0,0,0-.25,1.31l4.1,7.11a1,1,0,0,0,1.25.44l5.11-2.06a15.68,15.68,0,0,0,3.46,2l.77,5.43a1,1,0,0,0,1,.86h8.2a1,1,0,0,0,1-.86l.77-5.43a15.36,15.36,0,0,0,3.46-2l5.11,2.06a1,1,0,0,0,1.25-.44l4.1-7.11a1,1,0,0,0-.25-1.31ZM24,31.18A7.18,7.18,0,1,1,31.17,24,7.17,7.17,0,0,1,24,31.18Z"/>
          </svg>
        `
      );

      window.YouTubePlusCleanupManager?.registerListener?.(
        settingsButton,
        'click',
        this.openSettingsModal.bind(this),
        undefined,
        true
      );
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
      settingsButton.classList.add('yp-settings-button--floating');
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
        .catch((/** @type {unknown} */ e) => {
          // Header containers may never arrive (unexpected host layout): the
          // floating launcher keeps the settings reachable.
          logS(e);
          this.addFloatingSettingsButton();
        });
    },

    /**
     * Handle modal click actions.
     * @param {HTMLElement} target - Click target
     * @param {HTMLElement} modal - Modal element
     * @param {Record<string, unknown>} handlers - Modal handlers
     * @param {Record<string, unknown>} _context - Context object
     * @param {(key: string, params?: Record<string, string | number>) => string} translate - Translation function
     */
    handleModalClickActions(target, modal, handlers, _context, translate) {
      window.YouTubePlusModalHandlers?.handleModalClickActions?.(
        target,
        modal,
        /** @type {YouTubePlusModalHandlers} */ (handlers),
        /** @type {SettingsModalContext} */ ({
          ..._context,
          settings: this.settings,
          saveSettingsBound: this.saveSettings.bind(this),
          showNotificationBound: this.showNotification.bind(this),
        }),
        translate
      );
    },

    /**
     * Handles clicks on theme cards, appearance toggles, and material style buttons.
     * @param {HTMLElement} target
     * @param {HTMLElement} modal
     * @param {Record<string, unknown>} handlers
     * @param {Record<string, unknown>} context
     * @returns {boolean | undefined} true if handled
     */
    handleThemeOptionsClick_(target, modal, handlers, context) {
      return window.YouTubePlusModalHandlers?.handleThemeOptionsClick?.(
        target,
        modal,
        /** @type {YouTubePlusModalHandlers} */ (handlers),
        /** @type {SettingsModalContext} */ ({
          ...context,
          settings: this.settings,
          saveSettingsBound: this.saveSettings.bind(this),
          showNotificationBound: this.showNotification.bind(this),
        })
      );
    },

    /**
     * Wait for an element matching `selector` to appear in the DOM.
     *
     * Delegates to the DOM cache's `waitForElement` (no local
     * `setInterval` poller here). The cache implementation:
     *   - resolves immediately if the element is already in the DOM
     *     (via the same `querySelector` the rest of the cache uses),
     *   - subscribes to a single shared `MutationObserver` (one
     *     observer for the whole userscript, not one per caller),
     *   - respects `timeout` and returns `null` on expiry.
     */
    waitForElement(/** @type {string | null | undefined} */ selector, timeout = 5000) {
      if (!selector) return Promise.resolve(null);
      const cache = window.YouTubePlusDOMCache;
      return cache && typeof cache.waitForElement === 'function'
        ? cache.waitForElement(selector, timeout)
        : Promise.resolve(
            typeof document !== 'undefined' ? document.querySelector(selector) : null
          );
    },

    addCustomButtons() {
      // Active-surface-only mount: in the Vision variant the Vision Dock owns
      // the player buttons, so the Classic ones are removed (with their
      // listeners) instead of left hidden for CSS to cover.
      const variant = window.YouTubePlusDesignSystem?.getThemeVariant?.();
      if (variant === 'vision') {
        this.removeClassicButtons();
        window.YouTubePlusVisionDockHost?.mount?.();
        this.handleFullscreenChange();
        return;
      }

      window.YouTubePlusVisionDockHost?.unmount?.();
      const controls = this.getElement('.ytp-right-controls');
      if (!controls) return;

      if (!window.YouTubeUtils?.$('.yp-screenshot-button', controls))
        this.addScreenshotButton(controls);
      if (!window.YouTubeUtils?.$('.yp-download-button', controls))
        this.addDownloadButton(controls);
      if (!window.YouTubeUtils?.$('.speed-control-btn', controls))
        this.addSpeedControlButton(controls);
      if (!window.YouTubeUtils?.$('.yp-loop-button', controls)) {
        window.YouTubePlusTimeLoop?.addClassicLoopButton?.(/** @type {HTMLElement} */ (controls));
      }

      this.handleFullscreenChange();
    },

    /** Release the Classic player-control buttons and their listeners when
     *  the Vision dock takes over. Each owner module keeps its own button, so
     *  the listeners are removed with it. */
    removeClassicButtons() {
      window.YouTubePlusScreenshot?.removeClassicButton?.();
      window.YouTubePlusDownloadButton?.removeClassicButtons?.();
      window.YouTubePlusSpeedControl?.removeClassicButton?.();
      window.YouTubePlusTimeLoop?.removeClassicLoopButton?.();
    },

    addScreenshotButton(/** @type {Element} */ controls) {
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') return;
      const screenshotApi = window.YouTubePlusScreenshot;
      if (screenshotApi && typeof screenshotApi.addButton === 'function') {
        screenshotApi.addButton(this, controls);
      }
    },

    addDownloadButton(/** @type {Element} */ controls) {
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') return;
      this.createDownloadManagerForThis_()?.addDownloadButton(
        /** @type {HTMLElement} */ (controls)
      );
    },

    addSpeedControlButton(/** @type {Element} */ controls) {
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') return;
      const speedApi = window.YouTubePlusSpeedControl;
      if (speedApi && typeof speedApi.addButton === 'function') {
        speedApi.addButton(this, controls);
      }
    },

    showNotification(/** @type {string} */ message, duration = 2000) {
      YouTubeUtils.NotificationManager.show(message, {
        duration,
        type: 'info',
      });
    },

    handleFullscreenChange() {
      window.YouTubeUtils?.$$('.yp-screenshot-button, .yp-cobalt-button').forEach(button => {
        /** @type {HTMLElement} */ (button).style.bottom = '0px';
      });
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
      // The four dispatcher registrations below are session-scoped: their
      // lifetime is the whole page session, not a single SPA navigation.
      // The per-navigation cleanupManager.cleanup() sweep (utils.js, on
      // yt-navigate-start) would otherwise detach them after the first
      // navigation while `_navigationObserverStarted` stayed true, leaving
      // Basic dead on every later navigation. The handler
      // identity is preserved so the manager's (target, event, fn) dedup
      // keeps exactly one entry per kind.
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'fullscreenchange',
        this._onFullscreenChange_,
        undefined,
        'session'
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
        this._onNavigateFinish_,
        undefined,
        'session'
      );

      // Use popstate + pushState/replaceState override for SPA
      // navigation fallback instead of a body subtree
      // MutationObserver. The 500ms debounce timer is registered
      // with the cleanupManager so it cannot fire after the page
      // is torn down; a raw setTimeout would stay armed across
      // navigation.
      const checkUrlChange = () => {
        if (lastUrl !== location.href) {
          lastUrl = location.href;
          if (location.href.includes('watch?v=')) {
            const setup = () => this.setupCurrentPage();
            YouTubeUtils.cleanupManager?.timeout?.(setup, 500);
          }
          this.addSettingsButtonToHeader();
        }
      };

      if (!this._onPopState_) this._onPopState_ = checkUrlChange;
      if (!this._onNavigateStart_) this._onNavigateStart_ = checkUrlChange;
      YouTubeUtils.cleanupManager.registerListener(
        window,
        'popstate',
        this._onPopState_,
        undefined,
        'session'
      );
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'yt-navigate-start',
        this._onNavigateStart_,
        undefined,
        'session'
      );
    },
  };

  // Save reference to init function BEFORE IIFE closes (critical for DOMContentLoaded)
  const initFunction = YouTubeEnhancer.init.bind(YouTubeEnhancer);

  // Expose a small public API for programmatic control of the settings modal.
  // This is the supported entry-point for opening/closing the settings UI from
  // bookmarklets, tests, and integrations.
  window.YouTubePlus = window.YouTubePlus || /** @type {YouTubePlusPublicApi} */ ({});
  window.YouTubePlus.openSettings = (/** @type {{section?: string} | undefined} */ opts) => {
    try {
      if (opts && typeof opts.section === 'string') {
        // The modal owns modal-UI session state; Basic forwards
        // the hint through its facade.
        window.YouTubePlusSettingsModal?.basicUiState?.lastOpenSection?.write?.(opts.section);
      }
      YouTubeEnhancer.openSettingsModal();
      return true;
    } catch (e) {
      logS(e);
      window.YouTubePlusLogger?.warn?.('Basic', 'openSettings failed', e);
      return false;
    }
  };
  window.YouTubePlus.closeSettings = () => {
    try {
      // route through the modal's ONE lifecycle session so the
      // external API releases the same disposal as Escape/backdrop/re-open
      // instead of a raw modal.remove() that leaked the session listeners.
      const modalApi = window.YouTubePlusSettingsModal;
      if (modalApi && typeof modalApi.close === 'function' && modalApi.close()) {
        return true;
      }
      const domCache = window.YouTubePlusDOMCache;
      const existing =
        domCache?.querySelector?.('.yp-settings-modal', document, true) ||
        (typeof document !== 'undefined' ? document.querySelector('.yp-settings-modal') : null);
      if (existing) {
        // Foreign/legacy modal without our session: release defensively.
        document.dispatchEvent(
          new CustomEvent('youtube-plus-settings-modal-closed', {
            bubbles: true,
          })
        );
        existing.remove();
        return true;
      }
      return false;
    } catch (e) {
      logS(e);
      window.YouTubePlusLogger?.warn?.('Basic', 'closeSettings failed', e);
      return false;
    }
  };

  // Public facade export
  const basicAPI = {
    YouTubeEnhancer,
    createEnhancer: () => YouTubeEnhancer,
    openSettings: window.YouTubePlus?.openSettings || (() => YouTubeEnhancer.openSettingsModal()),
    closeSettings: window.YouTubePlus?.closeSettings || (() => false),
  };
  window.YouTubePlusBasic = basicAPI;

  // Prevent duplicate listeners when the userscript is injected twice.
  /** @type {boolean} */
  const basicInitGuard = (() => {
    if (typeof window === 'undefined') return true;
    if (window.__ytpBasicInitDone__) return false;
    window.__ytpBasicInitDone__ = true;
    return true;
  })();

  if (basicInitGuard) {
    // Initialize immediately or on DOMContentLoaded
    if (document.readyState === 'loading') {
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'DOMContentLoaded',
        initFunction,
        undefined,
        true
      );
    } else {
      initFunction();
    }
  }
})();
