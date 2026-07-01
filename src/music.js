/**
 * YouTube Music Enhancement Module
 * Provides UI improvements and features for YouTube Music
 * @module music
 * @version 2.3
 *
 * Features:
 * - Scroll-to-top button with smart container detection
 * - Enhanced navigation styles (centered search, immersive mode)
 * - Sidebar hover effects and player enhancements
 * - Health monitoring and automatic recovery
 * - SPA navigation support with debounced updates
 */

/* global GM_addStyle, GM_addValueChangeListener */

(function () {
  const setTimeout_ = setTimeout.bind(window);
  const U = window.YouTubeUtils;
  const createVisibilityAwareInterval = /** @type {any} */ (U)?.createVisibilityAwareInterval;

  if (typeof location !== 'undefined' && location.hostname !== 'music.youtube.com') {
    return;
  }

  // DOM cache helper from YouTubeUtils
  const qs = U.$;
  const byId = U.byId;

  const musicLogger = U?.logger || null;

  U?.StyleManager?.add?.(
    'ytp-music-fab-styles',
    window.YouTubePlusDesignSystem?.getStyle?.('ytp-music-fab-styles') || ''
  );

  // YouTube Music settings persistence is owned by the canonical
  // settings store (src/settings-helpers.js, exposed on
  // window.YouTubePlusSettingsStore). music.js no longer reads or
  // writes GM_*/localStorage for `youtube-plus-music-settings`
  // directly; the only persistence path here is the store. A
  // single, tiny read helper is kept so the call sites in this
  // file (applyStyles, startIfEnabled, applySettingsChanges,
  // saveSettings, the cross-subdomain listener) all read through
  // the same code.

  /**
   * Read YouTube Music settings from the canonical store. The
   * store already merges defaults + legacy flag mapping and
   * applies the GM-then-localStorage precedence, so this is a
   * direct delegation.
   * @returns {Record<string, any>}
   */
  function readMusicSettings() {
    const store = typeof window !== 'undefined' ? window.YouTubePlusSettingsStore : null;
    if (store && typeof store.getMusicSettings === 'function') {
      return store.getMusicSettings();
    }
    // Defensive fallback. The store is always present in the
    // shipped build (settings-helpers.js loads before music.js in
    // build.order.json), but a minimal hard-coded default keeps
    // unit tests and odd load orderings safe.
    return {
      enableMusic: true,
      immersiveSearchStyles: true,
      hoverStyles: true,
      playerSidebarStyles: true,
      centeredPlayerStyles: true,
      playerBarStyles: true,
      centeredPlayerBarStyles: true,
      miniPlayerStyles: true,
      scrollToTopStyles: true,
    };
  }

  function isMusicModuleEnabled(/** @type {any} */ settings) {
    return !!settings?.enableMusic;
  }

  // Scroll-to-top is now handled globally by enhanced.js
  // This function is kept for backward compatibility but always returns false
  function isScrollToTopEnabled(/** @type {any} */ _settings) {
    return false;
  }

  /**
   * Mutable settings snapshot for live-apply.
   * @type {ReturnType<typeof readMusicSettings>}
   */
  let musicSettingsSnapshot = readMusicSettings();

  /** @type {HTMLStyleElement|null} */
  let musicStyleEl = null;

  /** @type {string|null} */
  let observerSubId = null;

  /** @type {{ stop: () => void, pause?: () => void, resume?: () => void, active?: boolean } | null} */
  let observerFallbackTimerId = null;

  /** @type {{ stop: () => void, pause?: () => void, resume?: () => void, active?: boolean } | null} */
  let healthCheckIntervalId = null;

  /** @type {(() => void)|null} */
  let detachNavigationListeners = null;

  /**
   * Enhanced styles for YouTube Music interface
   * Includes: navigation cleanup, immersive search, sidebar effects, centered player, etc.
   * @type {string}
   * @const
   */
  const enhancedStyles = `
        /* Remove borders and shadows from nav/guide when bauhaus sidenav is enabled */
        ytmusic-app-layout[is-bauhaus-sidenav-enabled] #nav-bar-background.ytmusic-app-layout { border-bottom: none !important; box-shadow: none !important; }
        ytmusic-app-layout[is-bauhaus-sidenav-enabled] #nav-bar-divider.ytmusic-app-layout { border-top: none !important; }
        ytmusic-app-layout[is-bauhaus-sidenav-enabled] #mini-guide-background.ytmusic-app-layout { border-right: 0 !important; }
        ytmusic-nav-bar, ytmusic-app-layout[is-bauhaus-sidenav-enabled] .ytmusic-nav-bar { border: none !important; box-shadow: none !important; }
        /* Center the settings button in the top nav bar (fixes it being rendered at the bottom) */
        ytmusic-settings-button.style-scope.ytmusic-nav-bar, ytmusic-nav-bar ytmusic-settings-button.style-scope.ytmusic-nav-bar {position: absolute !important; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) !important; bottom: auto !important; margin: 0 !important; z-index: 1000 !important;}
        /* Center the search box in the top nav bar */
        ytmusic-search-box, ytmusic-nav-bar ytmusic-search-box, ytmusic-searchbox, ytmusic-nav-bar ytmusic-searchbox {position: absolute !important; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) !important; margin: 0 !important; max-width: 75% !important; width: auto !important; z-index: 900 !important;}
  `;

  const immersiveSearchStyles = `
      /* yt-Immersive search behaviour for YouTube Music: expand/center the search when focused */
      ytmusic-search-box:has(input:focus), ytmusic-searchbox:has(input:focus), ytmusic-search-box:focus-within, ytmusic-searchbox:focus-within {position: fixed !important; left: 50% !important; top: 12vh !important; transform: translateX(-50%) !important; height: auto !important; max-width: 900px !important; width: min(90vw, 900px) !important; z-index: 1200 !important; display: block !important;}
      @media only screen and (min-width: 1400px) {ytmusic-search-box:has(input:focus), ytmusic-searchbox:has(input:focus) {top: 10vh !important; max-width: 1000px !important; transform: translateX(-50%) scale(1.05) !important;}}
      /* Highlight the input and add a soft glow */
      ytmusic-search-box:has(input:focus) input, ytmusic-searchbox:has(input:focus) input, ytmusic-search-box:focus-within input, ytmusic-searchbox:focus-within input {background-color: var(--yt-bg-primary) !important; box-shadow: black 0 0 30px !important;}
      @media (prefers-color-scheme: dark) {ytmusic-search-box:has(input:focus) input, ytmusic-searchbox:has(input:focus) input {background-color: var(--yt-modal-bg) !important;}}
      /* Blur/scale the main content when immersive search is active */
      ytmusic-app-layout:has(ytmusic-search-box:has(input:focus)) #main-panel, ytmusic-app-layout:has(ytmusic-searchbox:has(input:focus)) #main-panel {filter: blur(18px) !important; transform: scale(1.03) !important;}
    `;

  // Ховер эффекты для боковой панели
  const hoverStyles = `
        .ytmusic-guide-renderer {opacity: 0.01 !important; transition: opacity 0.5s ease-in-out !important;}
        .ytmusic-guide-renderer:hover { opacity: 1 !important;}
        ytmusic-app[is-bauhaus-sidenav-enabled] #guide-wrapper.ytmusic-app {background-color: transparent !important; border: none !important;}
    `;

  // Боковая панель плеера
  const playerSidebarStyles = `
        #side-panel {width: 40em !important; height: 80vh !important; padding: 0 2em !important; right: -30em !important; top: 10vh !important; opacity: 0 !important; position: absolute !important; transition: all 0.3s ease-in-out !important; backdrop-filter: blur(5px) !important; background-color: var(--yt-panel-overlay-subtle) !important; border-radius: 1em !important; box-shadow: var(--yt-shadow-deep-1) 0px -36px 30px inset, var(--yt-shadow-deep-2) 0px -79px 40px inset, var(--yt-shadow-deep-3) 0px 2px 1px, var(--yt-shadow-deep-4) 0px 4px 2px, var(--yt-shadow-deep-4) 0px 8px 4px, var(--yt-shadow-deep-4) 0px 16px 8px, var(--yt-shadow-deep-4) 0px 32px 16px !important;}
        #side-panel tp-yt-paper-tabs {transition: height 0.3s ease-in-out !important; height: 0 !important;}
        #side-panel:hover {right: 0 !important; opacity: 1 !important;}
        #side-panel:hover tp-yt-paper-tabs {height: 4em !important;}
        #side-panel:has(ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]):not(:has(ytmusic-message-renderer:not([style="display: none;"]))) {right: 0 !important; opacity: 1 !important;}
        #side-panel {min-width: auto !important;}
      /* Allow JS to control visibility; ensure pointer-events and positioning only. */
        #side-panel .ytmusic-top-button { opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; }
      /* When button is placed inside the panel, prefer absolute positioning inside it
         so it won't be forced to fixed by the global rule. Use high specificity + !important */
        #side-panel .ytmusic-top-button {position: absolute !important; bottom: 20px !important; right: 20px !important; z-index: 1200 !important;}
    `;

  // Центрированный плеер
  const centeredPlayerStyles = `
        ytmusic-app-layout:not([player-ui-state="FULLSCREEN"]) #main-panel {position: absolute !important; height: 70vh !important; max-width: 70vw !important; aspect-ratio: 1 !important; top: 50vh !important; left: 50vw !important; transform: translate(-50%, -50%) !important;}
        #player-page {padding: 0 !important; margin: 0 !important; left: 0 !important; top: 0 !important; height: 100% !important; width: 100% !important;}
    `;

  // Стилизация плеер бара (центрированная версия)
  const playerBarStyles = `
        ytmusic-player-bar, #player-bar-background {margin: 1vw !important; width: 98vw !important; border-radius: 1em !important; overflow: hidden !important; transition: all 0.5s ease-in-out !important; background-color: var(--yt-panel-overlay-weak) !important; box-shadow: var(--yt-shadow-deep-1) 0px -36px 30px inset, var(--yt-shadow-deep-2) 0px -79px 40px inset, var(--yt-shadow-deep-3) 0px 2px 1px, var(--yt-shadow-deep-4) 0px 4px 2px, var(--yt-shadow-deep-4) 0px 8px 4px, var(--yt-shadow-deep-4) 0px 16px 8px, var(--yt-shadow-deep-4) 0px 32px 16px !important;}
        #layout:not([player-ui-state="PLAYER_PAGE_OPEN"]) #player-bar-background {background-color: var(--yt-panel-overlay-subtle) !important;}
    `;

  // Центрирование плеер бара
  const centeredPlayerBarStyles = `
        #left-controls {position: absolute !important; left: 49vw !important; bottom: 15px !important; transform: translateX(-50%) !important; width: fit-content !important; order: 1 !important;}
        .time-info {position: absolute !important; bottom: -10px !important; left: 0 !important; width: 100% !important; text-align: center !important; padding: 0 !important; margin: 0 !important;}
        .middle-controls {position: absolute !important; left: 1vw !important; bottom: 15px !important; max-width: 30vw !important; order: 0 !important;}
    `;

  // Настройки мини-плеера
  const miniPlayerStyles = `
        #main-panel:has(ytmusic-player[player-ui-state="MINIPLAYER"]) {position: fixed !important; width: 100vw !important; height: 100vh !important; top: -100vh !important; left: 0 !important; margin: 0 !important; padding: 0 !important; transform: none !important; max-width: 100vw !important;}
        ytmusic-player[player-ui-state="MINIPLAYER"] {position: fixed !important; bottom: calc(100vh + 120px) !important; right: 30px !important; width: 350px !important; height: fit-content !important;}
        #av-id:has(ytmusic-av-toggle) {position: absolute !important; left: 50% !important; transform: translateX(-50%) !important; top: -4em !important; opacity: 0 !important; transition: all 0.3s ease-in-out !important;}
        #av-id:has(ytmusic-av-toggle):hover {opacity: 1 !important;}
        #player[player-ui-state="MINIPLAYER"] {display: none !important;}
      /* Chrome-specific robustness: ensure the AV toggle container is above overlays
         and can receive hover even if :has() behaves differently. Also provide a
         non-:has fallback so the element is hoverable regardless of child matching. */
      /* Use absolute positioning (keeps internal menu alignment) but promote
         stacking and rendering to ensure it sits above overlays and receives clicks. */
        #av-id {position: absolute !important; left: 50% !important; transform: translateX(-50%) translateZ(0) !important; top: -4em !important; z-index: 10000 !important; pointer-events: auto !important; display: block !important; visibility: visible !important; width: auto !important; height: auto !important; will-change: transform, opacity !important;}
        #av-id ytmusic-av-toggle {pointer-events: auto !important;}
        #av-id:hover {opacity: 1 !important;}
      /* Prevent overlapping overlays from stealing clicks when hovering the toggle.
         This is a conservative rule; if a specific overlay still steals clicks we
         can target it explicitly later. */
        #av-id:hover, #av-id:active { filter: none !important; }
    `;

  // Scroll-to-top styles removed - now handled by enhanced.js universal button

  /**
   * Primary canonical path: route music CSS through the design-system
   * StyleManager so it shares the single style host with the rest of the
   * design system. add() is idempotent (no-op on unchanged css) and
   * implements last-write-wins for live updates from settings changes.
   * Returns true when StyleManager handled the css, false to signal that
   * the caller should use the legacy GM_addStyle / raw `<style>` fallback.
   * @param {string} cssText
   * @returns {boolean}
   * @private
   */
  function applyStylesViaStyleManager(cssText) {
    try {
      const SM = U?.StyleManager;
      if (!SM || typeof SM.add !== 'function') return false;
      SM.add('youtube-plus-music-styles', cssText);
      // Tear down any previously-injected standalone <style> element from
      // either a prior raw/GM_addStyle path or an older release so the
      // same CSS is not applied twice. Safe no-op when absent.
      if (musicStyleEl?.isConnected) {
        try {
          musicStyleEl.remove();
        } catch (_e) {
          /* legacy element removal optional */
        }
      }
      musicStyleEl = null;
      try {
        document.querySelectorAll('#youtube-plus-music-styles').forEach(el => el.remove());
      } catch (_e) {
        /* stray element cleanup optional */
      }
      U?.logger?.debug?.('[YouTube+][Music]', 'Styles applied via StyleManager');
      return true;
    } catch (_e) {
      // Fall through to legacy GM_addStyle / raw <style> path to preserve
      // behavior in environments where StyleManager is unreachable.
      return false;
    }
  }

  /**
   * Applies all enhanced styles to YouTube Music interface
   * Only applies styles when on music.youtube.com domain
   *
   * Live-update path: the canonical design-system StyleManager is preferred
   * when available (see {@link applyStylesViaStyleManager}). StyleManager
   * stores css keyed by `'youtube-plus-music-styles'`, so repeated calls
   * triggered by settings changes update styles in-place without recreating
   * a `<style>` element — preserving the prior live-update behavior backed
   * by direct textContent mutation.
   *
   * Compatibility fallback: when StyleManager isn't reachable (e.g. an
   * unusual load order in test contexts), the original GM_addStyle / raw
   * `<style id="youtube-plus-music-styles">` path is used so behavior is
   * preserved end-to-end.
   *
   * @function applyStyles
   * @returns {void}
   */
  function applyStyles() {
    if (!U?.isMusicDomain?.()) return;

    const s = musicSettingsSnapshot || readMusicSettings();
    if (!s.enableMusic) return;

    const styleParts = [enhancedStyles];
    if (s.immersiveSearchStyles) styleParts.push(immersiveSearchStyles);
    if (s.hoverStyles) styleParts.push(hoverStyles);
    if (s.playerSidebarStyles) styleParts.push(playerSidebarStyles);
    if (s.centeredPlayerStyles) styleParts.push(centeredPlayerStyles);
    if (s.playerBarStyles) styleParts.push(playerBarStyles);
    if (s.centeredPlayerBarStyles) styleParts.push(centeredPlayerBarStyles);
    if (s.miniPlayerStyles) styleParts.push(miniPlayerStyles);

    const allStyles = `\n${styleParts.join('\n')}\n`;

    if (applyStylesViaStyleManager(allStyles)) return;

    // Reuse single managed <style> for live updates.
    if (musicStyleEl?.isConnected) {
      musicStyleEl.textContent = allStyles;
      U?.logger?.debug?.('[YouTube+][Music]', 'Styles updated');
      return;
    }

    try {
      if (typeof GM_addStyle !== 'undefined') {
        const el = /** @type {any} */ (GM_addStyle(allStyles));
        if (el && el.tagName === 'STYLE') {
          musicStyleEl = /** @type {HTMLStyleElement} */ (el);
          try {
            musicStyleEl.id = 'youtube-plus-music-styles';
          } catch (_e) {
            /* style ID assignment optional */
          }
        }
      }
    } catch (_e) {
      // ignore and fallback
    }

    if (!musicStyleEl?.isConnected) {
      const style = document.createElement('style');
      style.id = 'youtube-plus-music-styles';
      style.textContent = allStyles;
      document.head.appendChild(style);
      musicStyleEl = style;
    }

    U?.logger?.debug?.('[YouTube+][Music]', 'Styles applied');
  }

  /**
   * Reference to global i18n instance
   * @type {Object|null}
   * @private
   */
  // i18n: prefer centralized YouTubeUtils.t

  /**
   * Translation helper function with fallback support
   * @function t
   * @param {string} key - Translation key
   * @param {Object} [params={}] - Optional parameters for interpolation
   * @returns {string} Translated string or key if translation not found
   */
  const t =
    U?.t || ((/** @type {string} */ key, /** @type {Record<string, any>} */ _p) => key || '');

  /**
   * Create button element with attributes
   * @returns {HTMLElement} Button element
   * @private
   */
  function createButton() {
    const button = document.createElement('button');
    button.id = 'ytmusic-side-panel-top-button';
    // Add both music-specific and shared class so global styles from enhanced.js
    // (the `.top-button` rules) can be applied when present.
    button.className = 'ytmusic-top-button top-button';
    button.title = t('scrollToTop');
    button.setAttribute('aria-label', t('scrollToTop'));
    U.renderTemplateClone(
      button,
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>'
    );

    // Add data attribute for debugging
    button.setAttribute('data-ytmusic-scroll-button', 'true');

    U?.logger?.debug?.('[YouTube+][Music]', 'Button element created', {
      id: button.id,
      className: button.className,
    });

    return button;
  }

  /**
   * Cache for scroll containers to avoid repeated searches
   * @type {WeakMap<HTMLElement, HTMLElement|null>}
   * @private
   */
  const scrollContainerCache = new WeakMap();

  /**
   * Find scrollable container in side panel
   * @param {HTMLElement} sidePanel - Side panel element
   * @param {Object} MusicUtils - Utility module
   * @returns {HTMLElement|null} Scroll container or null
   * @private
   */
  function findScrollContainer(
    /** @type {HTMLElement} */ sidePanel,
    /** @type {any} */ MusicUtils
  ) {
    // Check cache first
    if (scrollContainerCache.has(sidePanel)) {
      const cached = scrollContainerCache.get(sidePanel);
      // Verify cached element is still in DOM and scrollable.
      // Batch layout reads to avoid separate forced layouts.
      if (cached && document.body.contains(cached)) {
        const cachedSH = cached.scrollHeight;
        const cachedCH = cached.clientHeight;
        if (cachedSH > cachedCH + 10) {
          return cached;
        }
      }
      // Cache invalidated
      scrollContainerCache.delete(sidePanel);
    }

    if (MusicUtils.findScrollContainer) {
      const result = MusicUtils.findScrollContainer(sidePanel);
      if (result) scrollContainerCache.set(sidePanel, result);
      return result;
    }

    // Try multiple selectors for scroll container
    // Prioritize queue/playlist containers from the screenshot
    const selectors = [
      // Tab-specific content containers (most specific)
      'ytmusic-tab-renderer[tab-identifier="FEmusic_queue"] #contents',
      'ytmusic-tab-renderer[tab-identifier="FEmusic_up_next"] #contents',
      'ytmusic-tab-renderer[tab-identifier="FEmusic_lyrics"] #contents',
      'ytmusic-tab-renderer[selected] #contents', // Currently selected tab
      'ytmusic-tab-renderer #contents', // Any tab contents
      // Queue and playlist containers
      'ytmusic-queue-renderer #contents',
      'ytmusic-playlist-shelf-renderer #contents',
      // Generic selectors
      '#side-panel #contents',
      '#contents.ytmusic-tab-renderer',
      '.ytmusic-section-list-renderer',
      '[role="tabpanel"]',
      '.ytmusic-player-queue',
      // Broader fallbacks
      'ytmusic-tab-renderer',
      '.scroller',
      '[scroll-container]',
    ];

    for (const selector of selectors) {
      const container = sidePanel?.querySelector(selector);
      if (container) {
        // Batch layout reads: read scrollHeight and clientHeight once,
        // then use the cached values for both the comparison and logging
        // to avoid triggering separate forced layouts per property read.
        const sh = container.scrollHeight;
        const ch = container.clientHeight;
        const isScrollable = sh > ch + 10;
        U?.logger?.debug?.(
          '[YouTube+][Music]',
          `Checking ${selector}: scrollHeight=${sh}, clientHeight=${ch}, isScrollable=${isScrollable}`
        );
        if (isScrollable) {
          U?.logger?.debug?.('[YouTube+][Music]', `✓ Found scroll container: ${selector}`);
          scrollContainerCache.set(sidePanel, /** @type {any} */ (container));
          return /** @type {any} */ (container);
        }
      }
    }

    // Fallback: check if side-panel itself is scrollable
    // Batch layout reads to avoid forced layout per property.
    if (sidePanel) {
      const spSH = sidePanel.scrollHeight;
      const spCH = sidePanel.clientHeight;
      if (spSH > spCH + 10) {
        U?.logger?.debug?.('[YouTube+][Music]', '✓ Using side-panel as scroll container');
        scrollContainerCache.set(sidePanel, sidePanel);
        return sidePanel;
      }
    }

    // Last resort: walk direct children and a few levels deep for scrollable elements
    // Avoids querySelectorAll('*') + getComputedStyle which is extremely expensive
    if (sidePanel) {
      const fallbackSelectors = [
        'div[id]',
        'div[class]',
        '[role="tabpanel"]',
        '[role="list"]',
        '[role="listbox"]',
      ];
      let best = null;
      let bestDelta = 0;

      for (const sel of fallbackSelectors) {
        try {
          const candidates = sidePanel.querySelectorAll(sel);
          for (const el of candidates) {
            const delta = (el.scrollHeight || 0) - (el.clientHeight || 0);
            if (delta > 10 && delta > bestDelta) {
              bestDelta = delta;
              best = el;
            }
          }
        } catch (_e) {
          // ignore
        }
      }

      if (best) {
        const tag = best.tagName.toLowerCase();
        const id = best.id ? `#${best.id}` : '';
        U?.logger?.debug?.('[YouTube+][Music]', `✓ Best scroll container chosen: ${tag}${id}`, {
          scrollHeight: best.scrollHeight,
          clientHeight: best.clientHeight,
        });
        scrollContainerCache.set(sidePanel, /** @type {any} */ (best));
        return /** @type {any} */ (best);
      }
    }

    // Don't cache null result - content may load asynchronously
    U?.logger?.debug?.('[YouTube+][Music]', '✗ No scroll container found in side-panel');
    return null;
  }

  /**
   * Setup scroll to top click behavior
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} sc - Scroll container
   * @param {Object} MusicUtils - Utility module
   * @private
   */
  function setupScrollBehavior(
    /** @type {HTMLElement} */ button,
    /** @type {HTMLElement} */ sc,
    /** @type {any} */ MusicUtils,
    /** @type {HTMLElement} */ sidePanel
  ) {
    if (MusicUtils.setupScrollToTop) {
      MusicUtils.setupScrollToTop(button, sc);
      return;
    }

    const findNearestScrollable = (/** @type {HTMLElement|null} */ startEl) => {
      let el = startEl;
      while (el && el !== document.body) {
        try {
          if (el.scrollHeight > el.clientHeight + 10) return el;
        } catch (_e) {
          // ignore errors accessing scroll properties on cross-origin or detached nodes
        }
        el = el.parentElement;
      }
      return null;
    };

    const clickHandler = (/** @type {any} */ ev) => {
      // Prevent other handlers or navigation from interfering
      try {
        ev.preventDefault?.();
      } catch (_e) {
        /* optional event method */
      }
      try {
        ev.stopPropagation?.();
      } catch (_e) {
        /* optional event method */
      }

      // Determine best candidate to scroll: provided sc, fallback to nearest scrollable in sidePanel, then walk from button
      /** @type {any} */
      let target = sc;
      if (!(target && target.scrollHeight > target.clientHeight + 1)) {
        target = sidePanel && findNearestScrollable(sidePanel);
      }
      if (!target) {
        target = findNearestScrollable(button.parentElement);
      }
      // As a last resort, use document.scrollingElement or window
      if (!target) {
        target = document.scrollingElement || document.documentElement || document.body;
      }

      // Debug info: record chosen target and sizes
      try {
        const info = {
          chosen: target && (target.id || target.tagName || '(window)'),
          scrollTop: target && 'scrollTop' in target ? target.scrollTop : null,
          scrollHeight: target && 'scrollHeight' in target ? target.scrollHeight : null,
          clientHeight: target && 'clientHeight' in target ? target.clientHeight : null,
        };
        // Expose last click debug info for manual inspection
        try {
          window.YouTubeMusic = window.YouTubeMusic || {};
          window.YouTubeMusic._lastClickDebug = info;
        } catch (_e) {
          /* debug store non-critical */
        }
        // Log via available logger or console
        U?.logger?.debug?.('[YouTube+][Music]', 'ScrollToTop click target', info);
      } catch (_e) {
        /* debug info collection non-critical */
      }

      // Try smooth scroll then fallback to instant. Attempt multiple targets (target, sc, document)
      const tryScroll = (/** @type {any} */ el) => {
        if (!el) return false;
        try {
          if (typeof el.scrollTo === 'function') {
            el.scrollTo({ top: 0, behavior: 'smooth' });
            return true;
          }
          if ('scrollTop' in el) {
            el.scrollTop = 0;
            return true;
          }
        } catch (_e) {
          // ignore and continue
        }
        return false;
      };

      let scrolled = false;
      scrolled = tryScroll(target) || scrolled;
      // If we have a provided sc and it differs from target, try it too
      if (sc && sc !== target) scrolled = tryScroll(sc) || scrolled;
      // Finally, try document/window
      scrolled =
        tryScroll(document.scrollingElement || document.documentElement || document.body) ||
        scrolled;

      if (!scrolled) {
        // Last-resort direct window scroll
        try {
          window.scrollTo(0, 0);
        } catch (err2) {
          U?.logger?.debug?.('[YouTube+][Music]', 'Final scroll fallback failed', err2);
        }
      }
    };

    // Use non-passive so preventDefault works if needed
    button.addEventListener('click', clickHandler, { passive: false });
  }

  /**
   * Setup button positioning styles
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} sidePanel - Side panel element (not used with fixed positioning)
   * @param {Object} MusicUtils - Utility module
   * @private
   */
  function setupButtonPosition(
    /** @type {HTMLElement} */ button,
    /** @type {HTMLElement} */ sidePanel,
    /** @type {any} */ MusicUtils,
    /** @type {{insideSidePanel?: boolean}} */ options = {}
  ) {
    // options.insideSidePanel: boolean - if true, position the button inside the side panel
    if (MusicUtils.setupButtonStyles) {
      MusicUtils.setupButtonStyles(button, sidePanel, options);
      return;
    }

    if (options.insideSidePanel && sidePanel) {
      button.classList.add('ytp-music-fab-side-panel');
    } else {
      button.classList.add('ytp-music-fab');
    }

    U?.logger?.debug?.('[YouTube+][Music]', 'Button positioned:', {
      position: /** @type {any} */ (button).style.position,
      bottom: /** @type {any} */ (button).style.bottom,
      right: /** @type {any} */ (button).style.right,
      zIndex: /** @type {any} */ (button).style.zIndex,
      insideSidePanel: !!options.insideSidePanel,
    });
  }

  /**
   * Setup scroll visibility toggle handler
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} sc - Scroll container
   * @param {Object} MusicUtils - Utility module
   * @private
   */
  function setupScrollVisibility(
    /** @type {HTMLElement} */ button,
    /** @type {HTMLElement} */ sc,
    /** @type {any} */ MusicUtils
  ) {
    // Try to use ScrollManager for better performance
    if (window.YouTubePlusScrollManager?.addScrollListener) {
      try {
        const cleanup = window.YouTubePlusScrollManager.addScrollListener(
          sc,
          () => {
            const shouldShow = sc.scrollTop > 100;
            button.classList.toggle('visible', shouldShow);
            U?.logger?.debug?.(
              '[YouTube+][Music]',
              `Scroll position: ${sc.scrollTop}px, button visible: ${shouldShow}`
            );
          },
          { debounce: 100, runInitial: true }
        );

        button._scrollCleanup = cleanup;
        U?.logger?.debug?.('[YouTube+][Music]', 'Using ScrollManager for scroll handling');
        return;
      } catch (e) {
        musicLogger?.error?.('Music', 'ScrollManager failed, using fallback', e);
      }
    }

    if (MusicUtils.setupScrollVisibility) {
      MusicUtils.setupScrollVisibility(button, sc, 100);
      return;
    }

    // Fallback implementation
    let isTabVisible = !document.hidden;
    /** @type {number|null} */
    let rafId = null;

    const updateVisibility = () => {
      // Cancel any pending animation frame
      if (rafId) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        // Don't update if tab is hidden (performance optimization)
        if (!isTabVisible) return;

        const currentScroll = sc.scrollTop || 0;
        const shouldShow = currentScroll > 100;
        const wasVisible = button.classList.contains('visible');

        button.classList.toggle('visible', shouldShow);

        // Log only on state changes to reduce noise
        if (shouldShow !== wasVisible) {
          U?.logger?.debug?.(
            '[YouTube+][Music]',
            `Button visibility changed: ${shouldShow ? 'SHOWN' : 'HIDDEN'} (scroll: ${currentScroll}px)`
          );
        }
      });
    };

    const debounce = U.debounce;
    const scrollHandler = debounce(updateVisibility, 100);

    // Listen for page visibility changes
    const visibilityHandler = () => {
      isTabVisible = !document.hidden;
      if (isTabVisible) {
        updateVisibility();
      }
    };

    sc.addEventListener('scroll', scrollHandler, { passive: true });
    document.addEventListener('visibilitychange', visibilityHandler);

    // Initial check with slight delay to ensure layout is complete
    setTimeout(updateVisibility, 100);
    // Additional check after longer delay in case content loads asynchronously
    setTimeout(updateVisibility, 500);

    // Store cleanup function
    button._scrollCleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      sc.removeEventListener('scroll', scrollHandler);
      document.removeEventListener('visibilitychange', visibilityHandler);
    };

    U?.logger?.debug?.('[YouTube+][Music]', 'Using fallback scroll handler');
  }

  /**
   * Attach button to container with all setup
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} sidePanel - Side panel element (for context, not attachment)
   * @param {HTMLElement} sc - Scroll container
   * @param {Object} MusicUtils - Utility module
   * @private
   */
  function attachButtonToContainer(button, sidePanel, sc, MusicUtils) {
    try {
      setupScrollBehavior(button, sc, MusicUtils, sidePanel);

      // Prefer to visually align the button with the side-panel, but always
      // append to `document.body` to avoid clipping when the panel uses transforms.
      const attachInsidePanel = !!sidePanel;
      setupButtonPosition(button, sidePanel, MusicUtils, {
        insideSidePanel: attachInsidePanel,
      });

      // Always append to `body` so the button is never clipped by panel
      // transforms/overflow. If `attachInsidePanel` is true we'll try panel first.

      if (attachInsidePanel) {
        try {
          sidePanel.appendChild(button);
        } catch (err) {
          // Fallback to body if append fails for any reason
          document.body.appendChild(button);
          U?.logger?.debug?.(
            '[YouTube+][Music]',
            'Appending to sidePanel failed, appended to body',
            err
          );
        }
      } else {
        document.body.appendChild(button);
      }

      setupScrollVisibility(button, sc, MusicUtils);

      // Initial visibility check - show immediately if already scrolled
      const initialScroll = sc.scrollTop || 0;
      if (initialScroll > 100) {
        button.classList.add('visible');
        U?.logger?.debug?.(
          '[YouTube+][Music]',
          `Button shown immediately (scroll: ${initialScroll}px)`
        );
      }

      U?.logger?.debug?.('[YouTube+][Music]', 'Scroll to top button created successfully', {
        buttonId: button.id,
        scrollContainer: sc.tagName,
        scrollContainerId: sc.id || 'no-id',
        scrollHeight: sc.scrollHeight,
        clientHeight: sc.clientHeight,
        scrollTop: initialScroll,
        position: /** @type {any} */ (button).style.position,
        computedDisplay: (() => {
          const cs = window.getComputedStyle(/** @type {Element} */ (/** @type {any} */ (button)));
          return {
            display: cs.display,
            opacity: cs.opacity,
            visibility: cs.visibility,
          };
        })(),
      });
    } catch (err) {
      musicLogger?.error?.('Music', 'attachButton error', err);
    }
  }

  /**
   * State tracking for button creation attempts
   * @type {Object}
   * @private
   */
  /** @type {{attempts: number, maxAttempts: number, lastAttempt: number, minInterval: number}} */
  const buttonCreationState = {
    attempts: 0,
    maxAttempts: 5,
    lastAttempt: 0,
    minInterval: 500, // Minimum time between attempts
  };

  /**
   * Creates a "Scroll to Top" button in YouTube Music's side panel
   * Button appears when scrollable content is detected and user scrolls down
   * @function createScrollToTopButton
   * @returns {void}
   */
  function createScrollToTopButton() {
    try {
      // Early exit checks
      if (!U?.isMusicDomain?.()) return;

      // Check if button already exists and is properly attached
      const existingButton = byId('ytmusic-side-panel-top-button');
      if (existingButton) {
        // Verify it's in the DOM and has event listeners
        if (document.body.contains(existingButton) && existingButton._scrollCleanup) {
          U?.logger?.debug?.('[YouTube+][Music]', 'Button already exists and is properly attached');
          return;
        } else {
          // Button exists but is orphaned, remove it
          U?.logger?.debug?.('[YouTube+][Music]', 'Removing orphaned button');
          existingButton.remove();
        }
      }

      // Rate limiting
      const now = Date.now();
      if (now - buttonCreationState.lastAttempt < buttonCreationState.minInterval) {
        U?.logger?.debug?.('[YouTube+][Music]', 'Rate limited, skipping button creation');
        return;
      }

      buttonCreationState.attempts++;
      buttonCreationState.lastAttempt = now;

      if (buttonCreationState.attempts > buttonCreationState.maxAttempts) {
        U?.logger?.debug?.(
          '[YouTube+][Music]',
          `Max attempts (${buttonCreationState.maxAttempts}) reached, stopping retries`
        );
        return;
      }

      U?.logger?.debug?.(
        '[YouTube+][Music]',
        `Creating button (attempt ${buttonCreationState.attempts}/${buttonCreationState.maxAttempts})`
      );

      const sidePanel = /** @type {HTMLElement|null} */ (qs('#side-panel'));
      const MusicUtils = /** @type {any} */ (window.YouTubePlusMusicUtils || {});
      const button = createButton();

      // If no side-panel, try to find the main content area or queue
      if (!sidePanel) {
        U?.logger?.debug?.(
          '[YouTube+][Music]',
          'No side-panel found, checking for main content or queue'
        );

        // Try queue renderer (shown in playlist/queue view)
        const queueRenderer = qs('ytmusic-queue-renderer');
        if (queueRenderer) {
          const queueContents = queueRenderer.querySelector('#contents');
          if (queueContents) {
            attachButtonToContainer(
              button,
              /** @type {any} */ (queueRenderer),
              /** @type {any} */ (queueContents),
              MusicUtils
            );
            buttonCreationState.attempts = 0; // Reset on success
            return;
          }
        }

        // Try to find main scrollable area on homepage/explore pages
        const mainContent = qs('ytmusic-browse');
        if (mainContent) {
          const scrollContainer = mainContent.querySelector('ytmusic-section-list-renderer');
          if (scrollContainer) {
            attachButtonToContainer(
              button,
              /** @type {any} */ (mainContent),
              /** @type {any} */ (scrollContainer),
              MusicUtils
            );
            buttonCreationState.attempts = 0; // Reset on success
            return;
          }
        }

        // Retry later
        setTimeout_(function () {
          createScrollToTopButton();
        }, 1000);
        return;
      }

      const scrollContainer = findScrollContainer(sidePanel, MusicUtils);

      if (!scrollContainer) {
        U?.logger?.debug?.(
          '[YouTube+][Music]',
          'No scroll container found, will retry with backoff'
        );

        // Retry with exponential backoff
        const backoffDelay = Math.min(500 * buttonCreationState.attempts, 3000);
        setTimeout_(function () {
          createScrollToTopButton();
        }, backoffDelay);
        return;
      }

      attachButtonToContainer(button, sidePanel, scrollContainer, MusicUtils);
      buttonCreationState.attempts = 0; // Reset on success

      U?.logger?.debug?.('[YouTube+][Music]', '✓ Button created successfully');
    } catch (error) {
      musicLogger?.error?.('Music', 'Error creating scroll to top button', error);
      // Retry on error if we haven't exceeded max attempts
      if (buttonCreationState.attempts < buttonCreationState.maxAttempts) {
        setTimeout_(function () {
          createScrollToTopButton();
        }, 1000);
      }
    }
  }

  /**
   * Checks if side panel exists and creates scroll-to-top button if needed
   * @function checkAndCreateButton
   * @returns {void}
   */
  function checkAndCreateButton() {
    try {
      const existingButton = byId('ytmusic-side-panel-top-button');

      // Clean up if button exists but is orphaned (no scroll listener)
      if (existingButton) {
        if (!(existingButton._scrollCleanup && document.body.contains(existingButton))) {
          U?.logger?.debug?.('[YouTube+][Music]', 'Cleaning up orphaned/detached button');
          if (existingButton._scrollCleanup) {
            try {
              existingButton._scrollCleanup();
            } catch (_e) {
              // ignore cleanup errors
            }
          }
          if (existingButton._positionCleanup) {
            try {
              existingButton._positionCleanup();
            } catch (_e) {
              // ignore cleanup errors
            }
          }
          existingButton.remove();
        } else {
          // Button exists and is healthy
          U?.logger?.debug?.('[YouTube+][Music]', 'Button is healthy, no action needed');
          return;
        }
      }

      // Look for containers that need a button
      const sidePanel = /** @type {HTMLElement|null} */ (qs('#side-panel'));
      const mainContent = qs('ytmusic-browse');
      const queueRenderer = qs('ytmusic-queue-renderer');
      const tabRenderer = qs('ytmusic-tab-renderer[tab-identifier]');

      if (sidePanel || mainContent || queueRenderer || tabRenderer) {
        U?.logger?.debug?.('[YouTube+][Music]', 'Found container, scheduling button creation');
        setTimeout(function () {
          createScrollToTopButton();
        }, 300);
      } else {
        U?.logger?.debug?.('[YouTube+][Music]', 'No suitable container found yet');
      }
    } catch (error) {
      musicLogger?.error?.('Music', 'Error in checkAndCreateButton', error);
    }
  }

  // Lazy init: do not inject styles/observers until settings enable it.

  /**
   * Safely observe document body for side-panel appearance
   * @function observeDocumentBodySafely
   * @returns {void}
   */
  const observeDocumentBodySafely = () => {
    if (observerSubId || observerFallbackTimerId) return;

    const debounce = U.debounce;
    const debouncedCheck = debounce(checkAndCreateButton, 200);
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.subscribeRoot) {
      observerSubId = 'music::sidePanelObserver';
      coordinator.subscribeRoot(
        observerSubId,
        /** @param {MutationRecord[]} mutations */ mutations => {
          const now = Date.now();
          const existingButton = byId('ytmusic-side-panel-top-button');
          if (
            existingButton &&
            document.body.contains(existingButton) &&
            existingButton._scrollCleanup
          ) {
            return;
          }

          const hasRelevantChange = mutations.some((/** @type {MutationRecord} */ mutation) => {
            if (mutation.addedNodes.length === 0) return false;
            return Array.from(mutation.addedNodes).some(node => {
              if (node.nodeType !== 1) return false;

              const element = /** @type {Element} */ (node);
              if (element.id === 'side-panel' || element.id === 'contents') return true;

              const tagName = element.tagName;
              if (
                tagName === 'YTMUSIC-BROWSE' ||
                tagName === 'YTMUSIC-PLAYER-PAGE' ||
                tagName === 'YTMUSIC-QUEUE-RENDERER' ||
                tagName === 'YTMUSIC-TAB-RENDERER'
              ) {
                return true;
              }

              return (
                element.querySelector?.(
                  '#side-panel, #contents, ytmusic-browse, ytmusic-queue-renderer, ytmusic-tab-renderer'
                ) != null
              );
            });
          });

          const hasTabChange = mutations.some(
            (/** @type {MutationRecord} */ mutation) =>
              mutation.type === 'attributes' &&
              mutation.attributeName === 'selected' &&
              mutation.target instanceof Element &&
              mutation.target.matches?.('ytmusic-tab-renderer, tp-yt-paper-tab')
          );

          if (hasRelevantChange || hasTabChange) {
            U?.logger?.debug?.(
              '[YouTube+][Music]',
              'Detected relevant DOM change, checking button'
            );
            debouncedCheck();
          } else if (now % 2 === 0) {
            debouncedCheck();
          }
        },
        {
          selector:
            '#side-panel, #contents, ytmusic-browse, ytmusic-player-page, ytmusic-queue-renderer, ytmusic-tab-renderer',
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['selected', 'tab-identifier', 'page-type'],
        }
      );
      U?.logger?.debug?.('[YouTube+][Music]', '✓ Coordinator watcher started');
      return;
    }

    observerFallbackTimerId = createVisibilityAwareInterval(() => {
      checkAndCreateButton();
    }, 500);
  };

  function stopScrollToTopRuntime() {
    try {
      if (healthCheckIntervalId != null) {
        healthCheckIntervalId.stop();
        healthCheckIntervalId = null;
      }

      if (observerSubId && window.YouTubePlusMutationCoordinator?.unsubscribe) {
        window.YouTubePlusMutationCoordinator.unsubscribe(observerSubId);
        observerSubId = null;
      }

      if (observerFallbackTimerId) {
        observerFallbackTimerId.stop();
        observerFallbackTimerId = null;
      }

      if (detachNavigationListeners) {
        try {
          detachNavigationListeners();
        } catch (_e) {
          /* teardown may fail safely */
        }
        detachNavigationListeners = null;
      }

      const button = byId('ytmusic-side-panel-top-button');
      if (button?._scrollCleanup) {
        try {
          button._scrollCleanup();
        } catch (_e) {
          /* cleanup may fail safely */
        }
      }
      if (button?._positionCleanup) {
        try {
          button._positionCleanup();
        } catch (_e) {
          /* cleanup may fail safely */
        }
      }
      if (button) button.remove();
    } catch (e) {
      musicLogger?.error?.('Music', 'stopScrollToTopRuntime error', e);
    }
  }

  function startScrollToTopRuntime() {
    if (!isScrollToTopEnabled(musicSettingsSnapshot)) return;

    // Already running
    if (
      observerSubId ||
      observerFallbackTimerId ||
      healthCheckIntervalId != null ||
      detachNavigationListeners
    ) {
      return;
    }

    // Ensure styles (button relies on CSS)
    applyStyles();

    // Create button on load
    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(checkAndCreateButton, { timeout: 1000 });
          } else {
            setTimeout(checkAndCreateButton, 0);
          }
        },
        { once: true }
      );
    } else {
      checkAndCreateButton();
    }

    // Navigation hooks (non-invasive: no history monkeypatch)
    const debounce = U.debounce;
    const onNavigate = debounce(() => {
      if (!isScrollToTopEnabled(musicSettingsSnapshot)) return;
      applyStyles();
      buttonCreationState.attempts = 0;
      buttonCreationState.lastAttempt = 0;
      checkAndCreateButton();
    }, 150);

    const popstateHandler = () => onNavigate();
    const ytNavigateHandler = () => onNavigate();

    window.addEventListener('popstate', popstateHandler);
    window.addEventListener('yt-navigate-finish', ytNavigateHandler);

    detachNavigationListeners = () => {
      window.removeEventListener('popstate', popstateHandler);
      window.removeEventListener('yt-navigate-finish', ytNavigateHandler);
    };

    // Start coordinator-backed watcher
    observeDocumentBodySafely();

    // Periodic health check
    healthCheckIntervalId = createVisibilityAwareInterval(() => {
      try {
        if (!isScrollToTopEnabled(musicSettingsSnapshot)) return;
        if (document.hidden) return;

        const button = byId('ytmusic-side-panel-top-button');

        if (button && !(button._scrollCleanup && document.body.contains(button))) {
          U?.logger?.debug?.('[YouTube+][Music]', 'Health check: removing unhealthy button');
          button.remove();
          checkAndCreateButton();
        }

        if (!button) {
          const sidePanel = /** @type {HTMLElement|null} */ (qs('#side-panel'));
          if (sidePanel) checkAndCreateButton();
        }
      } catch (error) {
        musicLogger?.error?.('Music', 'Health check error', error);
      }
    }, 30000);
  }

  function startIfEnabled() {
    // Never start outside YouTube Music.
    if (!U?.isMusicDomain?.()) return;

    musicSettingsSnapshot = readMusicSettings();
    if (!isMusicModuleEnabled(musicSettingsSnapshot)) return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyStyles, {
        once: true,
      });
    } else {
      applyStyles();
    }

    if (isScrollToTopEnabled(musicSettingsSnapshot)) {
      startScrollToTopRuntime();
    }
  }

  function applySettingsChanges() {
    // Re-read persisted settings and (re)apply.
    musicSettingsSnapshot = readMusicSettings();

    // If disabled, tear everything down immediately, regardless of hostname.
    if (!isMusicModuleEnabled(musicSettingsSnapshot)) {
      stopScrollToTopRuntime();
      // Canonical path: remove the music CSS entry from the design-system
      // StyleManager so the shared style host stops emitting these rules.
      try {
        U?.StyleManager?.remove?.('youtube-plus-music-styles');
      } catch (_e) {
        /* StyleManager teardown optional */
      }
      if (musicStyleEl?.isConnected) musicStyleEl.remove();
      // Defensive: remove any stray YouTube Music style tags we may have added earlier.
      try {
        document
          .querySelectorAll('#youtube-plus-music-styles')
          .forEach(el => el !== musicStyleEl && el.remove());
      } catch (_e) {
        /* stray element cleanup optional */
      }
      musicStyleEl = null;
      return;
    }

    if (!U?.isMusicDomain?.()) return;

    // Styles
    applyStyles();

    // Scroll-to-top runtime
    if (isScrollToTopEnabled(musicSettingsSnapshot)) {
      if (!(observerSubId || observerFallbackTimerId)) startScrollToTopRuntime();
    } else {
      stopScrollToTopRuntime();
    }
  }

  function saveSettings(/** @type {any} */ s) {
    // Caller (modal-handlers) already persists via the canonical
    // settings store; here we just keep the in-memory snapshot
    // in sync for live-apply.
    if (s && typeof s === 'object') {
      musicSettingsSnapshot = { ...musicSettingsSnapshot, ...s };
    } else {
      musicSettingsSnapshot = readMusicSettings();
    }
  }

  // Export module to global scope for settings live-apply
  if (typeof window !== 'undefined') {
    window.YouTubeMusic = {
      observeDocumentBodySafely,
      checkAndCreateButton,
      createScrollToTopButton,
      saveSettings,
      applySettingsChanges,
      version: '2.4.5',
    };
  }

  // Cleanup on page unload
  const isMusicRoute = () => U?.isMusicDomain?.() ?? false;

  let musicRuntimeStarted = false;
  const startMusicRuntime = () => {
    if (musicRuntimeStarted) return;
    musicRuntimeStarted = true;

    window.addEventListener('beforeunload', () => {
      try {
        stopScrollToTopRuntime();
        // Canonical path: drop the music CSS entry from the shared
        // design-system style host on unload.
        try {
          U?.StyleManager?.remove?.('youtube-plus-music-styles');
        } catch (_e) {
          /* StyleManager teardown optional */
        }
        if (musicStyleEl?.isConnected) musicStyleEl.remove();
        musicStyleEl = null;
        U?.logger?.debug?.('[YouTube+][Music]', 'Cleanup completed');
      } catch (error) {
        musicLogger?.error?.('Music', 'Cleanup error', error);
      }
    });

    // Start only if enabled; otherwise remain dormant.
    startIfEnabled();

    // Cross-subdomain live sync: react to changes made on the
    // youtube.com settings UI (or any other tab that writes
    // youtube-plus-music-settings through the canonical store).
    // The store is the source of truth for parsing + legacy
    // flag mapping, so the listener just re-reads via the same
    // readMusicSettings() helper the rest of this module uses.
    try {
      if (typeof GM_addValueChangeListener !== 'undefined') {
        GM_addValueChangeListener('youtube-plus-music-settings', () => {
          try {
            musicSettingsSnapshot = readMusicSettings();
          } catch (e) {
            musicLogger?.warn?.('Music', 'Settings listener read failed', e);
          }
          // Apply immediately (will teardown if disabled).
          applySettingsChanges();
        });
      }
    } catch (e) {
      musicLogger?.warn?.('Music', 'Settings listener registration error', e);
    }

    U?.logger?.debug?.('[YouTube+][Music]', 'Module loaded (lazy)', {
      version: '2.4.5',
      hostname: U?.getHostname?.() ?? '',
      enabled: isMusicRoute() && isMusicModuleEnabled(musicSettingsSnapshot),
    });
  };

  // Activate on `music.youtube.com` only. The shim re-evaluates
  // `isMusicRoute` on every YouTube SPA nav and settings update,
  // so the runtime starts when the user lands on music.youtube.com
  // and is a no-op on every other page. The runtime guards its own
  // re-entry, so onLeave is intentionally empty: there is nothing
  // cheap to tear down that wouldn't be re-attached on the next
  // navigation back to the music route.
  U?.whenRelevant?.({
    name: 'music',
    isRelevant: () =>
      (U?.isMusicDomain?.() ?? false) && isMusicModuleEnabled(musicSettingsSnapshot),
    onEnter: startMusicRuntime,
  });
})();
