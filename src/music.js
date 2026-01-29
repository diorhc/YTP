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

/* global GM_addStyle, GM_getValue, GM_addValueChangeListener */

(function () {
  'use strict';

  /**
   * Read YouTube Music settings from localStorage with defaults.
   * Kept in sync with defaults in settings UI.
   */
  function readMusicSettings() {
    const defaults = {
      enableMusic: true,
    };

    // Prefer userscript-global storage so youtube.com and music.youtube.com share the setting.
    try {
      if (typeof GM_getValue !== 'undefined') {
        const stored = GM_getValue('youtube-plus-music-settings', null);
        if (typeof stored === 'string' && stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed.enableMusic === 'boolean') {
            return { enableMusic: parsed.enableMusic };
          }
        }
      }
    } catch {
      // fall back to localStorage
    }

    try {
      const stored = localStorage.getItem('youtube-plus-music-settings');
      if (!stored) return defaults;
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed.enableMusic === 'boolean') {
        return { enableMusic: parsed.enableMusic };
      }
      if (parsed && typeof parsed === 'object') {
        const legacyEnabled = !!(
          parsed.enableMusicStyles ||
          parsed.enableMusicEnhancements ||
          parsed.enableImmersiveSearch ||
          parsed.enableSidebarHover ||
          parsed.enableCenteredPlayer ||
          parsed.enableScrollToTop
        );
        return { enableMusic: legacyEnabled };
      }
      return defaults;
    } catch {
      return defaults;
    }
  }

  function isMusicModuleEnabled(settings) {
    return !!(settings && settings.enableMusic);
  }

  function isScrollToTopEnabled(settings) {
    return !!(settings && settings.enableMusic && window.location.hostname === 'music.youtube.com');
  }

  /**
   * Mutable settings snapshot for live-apply.
   * @type {ReturnType<typeof readMusicSettings>}
   */
  let musicSettingsSnapshot = readMusicSettings();

  /** @type {HTMLStyleElement|null} */
  let musicStyleEl = null;

  /** @type {MutationObserver|null} */
  let observer = null;

  /** @type {number|null} */
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
      ytmusic-search-box:has(input:focus) input, ytmusic-searchbox:has(input:focus) input, ytmusic-search-box:focus-within input, ytmusic-searchbox:focus-within input {background-color: #fffb !important; box-shadow: black 0 0 30px !important;}
      @media (prefers-color-scheme: dark) {ytmusic-search-box:has(input:focus) input, ytmusic-searchbox:has(input:focus) input {background-color: #000b !important;}}
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
        #side-panel {width: 40em !important; height: 80vh !important; padding: 0 2em !important; right: -30em !important; top: 10vh !important; opacity: 0 !important; position: absolute !important; transition: all 0.3s ease-in-out !important; backdrop-filter: blur(5px) !important; background-color: #0005 !important; border-radius: 1em !important; box-shadow: rgba(0, 0, 0, 0.15) 0px -36px 30px inset, rgba(0, 0, 0, 0.1) 0px -79px 40px inset, rgba(0, 0, 0, 0.06) 0px 2px 1px, rgba(0, 0, 0, 0.09) 0px 4px 2px, rgba(0, 0, 0, 0.09) 0px 8px 4px, rgba(0, 0, 0, 0.09) 0px 16px 8px, rgba(0, 0, 0, 0.09) 0px 32px 16px !important;}        
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
        ytmusic-player-bar, #player-bar-background {margin: 1vw !important; width: 98vw !important; border-radius: 1em !important; overflow: hidden !important; transition: all 0.5s ease-in-out !important; background-color: #0002 !important; box-shadow: rgba(0, 0, 0, 0.15) 0px -36px 30px inset, rgba(0, 0, 0, 0.1) 0px -79px 40px inset, rgba(0, 0, 0, 0.06) 0px 2px 1px, rgba(0, 0, 0, 0.09) 0px 4px 2px, rgba(0, 0, 0, 0.09) 0px 8px 4px, rgba(0, 0, 0, 0.09) 0px 16px 8px, rgba(0, 0, 0, 0.09) 0px 32px 16px !important;}        
        #layout:not([player-ui-state="PLAYER_PAGE_OPEN"]) #player-bar-background {background-color: #0005 !important;}
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

  // Стили для кнопки "Scroll to top"
  const scrollToTopStyles = `
        /* Base appearance for YouTube Music scroll-to-top button. */
        .ytmusic-top-button {position: fixed !important; bottom: 100px !important; right: 20px !important; width: 48px; height: 48px; background: rgba(255,255,255,.12); color: #fff; border: none; border-radius: 50%; cursor: pointer; display: flex !important; align-items: center; justify-content: center; z-index: 10000 !important; opacity: 0; visibility: hidden; transition: all .3s cubic-bezier(0.4, 0, 0.2, 1); backdrop-filter: blur(12px) saturate(180%); -webkit-backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(255,255,255,.18); box-shadow: 0 8px 32px 0 rgba(31,38,135,.18); pointer-events: auto !important;}
        /* Dark mode support */
        html[dark] .ytmusic-top-button {background: rgba(255,255,255,.15); border-color: rgba(255,255,255,.25);}
        /* Light mode support */
        html:not([dark]) .ytmusic-top-button {background: rgba(0,0,0,.08); color: #030303; border-color: rgba(0,0,0,.1);}
        /* Hover state */
        .ytmusic-top-button:hover {background: rgba(255,255,255,.25); transform: translateY(-2px) scale(1.07); box-shadow: 0 8px 32px rgba(0,0,0,.35);}
        html[dark] .ytmusic-top-button:hover {background: rgba(255,255,255,.28);}
        html:not([dark]) .ytmusic-top-button:hover {background: rgba(0,0,0,.15);}
        /* Visible state */
        .ytmusic-top-button.visible {opacity: 1 !important; visibility: visible !important;}
        /* Force show class for debugging */
        .ytmusic-top-button.force-show {opacity: 1 !important; visibility: visible !important; display: flex !important;}
        /* Smooth icon transitions */
        .ytmusic-top-button svg {transition: transform .2s ease;}
        .ytmusic-top-button:hover svg {transform: translateY(-1px) scale(1.1);}
        /* Focus and active states */
        .ytmusic-top-button:focus {outline: 2px solid rgba(255,255,255,0.5); outline-offset: 2px; box-shadow: 0 8px 32px rgba(0,0,0,.25);}
        .ytmusic-top-button:active {transform: translateY(0) scale(0.98);}
        /* Responsive positioning */
        @media (max-height: 600px) {.ytmusic-top-button {bottom: 80px !important;}}
        /* Allow reuse of the global .top-button rules when available */
        .ytmusic-top-button.top-button { /* additional shared rules can apply via .top-button */ }
    `;

  /**
   * Applies all enhanced styles to YouTube Music interface
   * Only applies styles when on music.youtube.com domain
   * @function applyStyles
   * @returns {void}
   */
  function applyStyles() {
    if (window.location.hostname !== 'music.youtube.com') return;

    const s = musicSettingsSnapshot || readMusicSettings();
    if (!s.enableMusic) return;

    const styleParts = [
      enhancedStyles,
      immersiveSearchStyles,
      hoverStyles,
      playerSidebarStyles,
      centeredPlayerStyles,
      playerBarStyles,
      centeredPlayerBarStyles,
      miniPlayerStyles,
      scrollToTopStyles,
    ];

    const allStyles = `\n${styleParts.join('\n')}\n`;

    // Reuse single managed <style> for live updates.
    if (musicStyleEl && musicStyleEl.isConnected) {
      musicStyleEl.textContent = allStyles;
      window.YouTubeUtils?.logger?.debug?.('[YouTube+][Music]', 'Styles updated');
      return;
    }

    try {
      if (typeof GM_addStyle !== 'undefined') {
        const el = GM_addStyle(allStyles);
        if (el && el.tagName === 'STYLE') {
          musicStyleEl = /** @type {HTMLStyleElement} */ (el);
          try {
            musicStyleEl.id = 'youtube-plus-music-styles';
          } catch {}
        }
      }
    } catch {
      // ignore and fallback
    }

    if (!musicStyleEl || !musicStyleEl.isConnected) {
      const style = document.createElement('style');
      style.id = 'youtube-plus-music-styles';
      style.textContent = allStyles;
      document.head.appendChild(style);
      musicStyleEl = style;
    }

    window.YouTubeUtils?.logger?.debug?.('[YouTube+][Music]', 'Styles applied');
  }

  /**
   * Reference to global i18n instance
   * @type {Object|null}
   * @private
   */
  const _globalI18n_music =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;

  /**
   * Get debounce utility from YouTubeUtils or provide fallback
   * @function getDebounce
   * @returns {Function} Debounce function
   * @private
   */
  const getDebounce = () => {
    if (window.YouTubeUtils?.debounce) {
      return window.YouTubeUtils.debounce;
    }
    // Fallback debounce implementation
    return (fn, delay) => {
      let timeoutId;
      return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
      };
    };
  };

  /**
   * Translation helper function with fallback support
   * @function t
   * @param {string} key - Translation key
   * @param {Object} [params={}] - Optional parameters for interpolation
   * @returns {string} Translated string or key if translation not found
   */
  const t = (key, params = {}) => {
    try {
      if (_globalI18n_music && typeof _globalI18n_music.t === 'function') {
        return _globalI18n_music.t(key, params);
      }
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.t === 'function'
      ) {
        return window.YouTubeUtils.t(key, params);
      }
    } catch {
      // fallback
    }
    if (!key || typeof key !== 'string') return '';
    if (Object.keys(params).length === 0) return key;
    let result = key;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
  };

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
    button.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

    // Add data attribute for debugging
    button.setAttribute('data-ytmusic-scroll-button', 'true');

    window.YouTubeUtils?.logger?.debug?.('[YouTube+][Music]', 'Button element created', {
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
  function findScrollContainer(sidePanel, MusicUtils) {
    // Check cache first
    if (scrollContainerCache.has(sidePanel)) {
      const cached = scrollContainerCache.get(sidePanel);
      // Verify cached element is still in DOM and scrollable
      if (
        cached &&
        document.body.contains(cached) &&
        cached.scrollHeight > cached.clientHeight + 10
      ) {
        return cached;
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
        const isScrollable = container.scrollHeight > container.clientHeight + 10;
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          `Checking ${selector}: scrollHeight=${container.scrollHeight}, clientHeight=${container.clientHeight}, isScrollable=${isScrollable}`
        );
        if (isScrollable) {
          window.YouTubeUtils?.logger?.debug?.(
            '[YouTube+][Music]',
            `✓ Found scroll container: ${selector}`
          );
          scrollContainerCache.set(sidePanel, container);
          return container;
        }
      }
    }

    // Fallback: check if side-panel itself is scrollable
    if (sidePanel && sidePanel.scrollHeight > sidePanel.clientHeight + 10) {
      window.YouTubeUtils?.logger?.debug?.(
        '[YouTube+][Music]',
        '✓ Using side-panel as scroll container'
      );
      scrollContainerCache.set(sidePanel, sidePanel);
      return sidePanel;
    }

    // Try finding ANY scrollable element within side-panel
    if (sidePanel) {
      const allElements = Array.from(sidePanel.querySelectorAll('*'));

      // Prefer elements that explicitly allow scrolling via CSS overflow, and pick the
      // element with the largest scroll delta as a best-effort heuristic.
      let best = null;
      let bestScore = 0;

      for (const el of allElements) {
        try {
          const sh = el.scrollHeight || 0;
          const ch = el.clientHeight || 0;
          const delta = sh - ch;
          if (delta <= 10) continue;

          const style = window.getComputedStyle?.(el) || {};
          const overflowY = (style.overflowY || '').toLowerCase();

          // Base score by delta, boost if overflow-y allows scrolling
          let score = delta;
          if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
            score += 100000;
          }

          // Prefer elements with role=tabpanel or obvious content containers
          if (el.getAttribute && el.getAttribute('role') === 'tabpanel') {
            score += 5000;
          }

          if (score > bestScore) {
            bestScore = score;
            best = el;
          }
        } catch {
          // ignore read errors (detached or cross-origin)
        }
      }

      if (best) {
        const tag = best.tagName.toLowerCase();
        const id = best.id ? `#${best.id}` : '';
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          `✓ Best scroll container chosen: ${tag}${id}`,
          { scrollHeight: best.scrollHeight, clientHeight: best.clientHeight, score: bestScore }
        );
        scrollContainerCache.set(sidePanel, best);
        return best;
      }
    }

    // Don't cache null result - content may load asynchronously
    window.YouTubeUtils?.logger?.debug?.(
      '[YouTube+][Music]',
      '✗ No scroll container found. Available elements:',
      Array.from(sidePanel?.querySelectorAll('*') || [])
        .map(el => {
          let classes = '';
          try {
            if (typeof el.className === 'string') {
              const s = el.className.trim();
              classes = s ? '.' + s.split(/\s+/).join('.') : '';
            } else if (el.classList && typeof el.classList === 'object') {
              const list = Array.from(el.classList).filter(Boolean);
              classes = list.length ? '.' + list.join('.') : '';
            }
          } catch {
            classes = '';
          }
          const scrollInfo =
            el.scrollHeight > el.clientHeight
              ? ` [scrollable: ${el.scrollHeight}/${el.clientHeight}]`
              : '';
          return el.tagName + (el.id ? `#${el.id}` : '') + classes + scrollInfo;
        })
        .slice(0, 30)
    );
    return null;
  }

  /**
   * Setup scroll to top click behavior
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} sc - Scroll container
   * @param {Object} MusicUtils - Utility module
   * @private
   */
  function setupScrollBehavior(button, sc, MusicUtils, sidePanel) {
    if (MusicUtils.setupScrollToTop) {
      MusicUtils.setupScrollToTop(button, sc);
      return;
    }

    const findNearestScrollable = startEl => {
      let el = startEl;
      while (el && el !== document.body) {
        try {
          if (el.scrollHeight > el.clientHeight + 10) return el;
        } catch {
          // ignore errors accessing scroll properties on cross-origin or detached nodes
        }
        el = el.parentElement;
      }
      return null;
    };

    const clickHandler = ev => {
      // Prevent other handlers or navigation from interfering
      try {
        ev.preventDefault?.();
      } catch {}
      try {
        ev.stopPropagation?.();
      } catch {}

      // Determine best candidate to scroll: provided sc, fallback to nearest scrollable in sidePanel, then walk from button
      let target = sc;
      if (!target || !(target.scrollHeight > target.clientHeight + 1)) {
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
        } catch {}
        // Log via available logger or console
        window.YouTubeUtils?.logger?.debug?.('[YouTube+][Music]', 'ScrollToTop click target', info);
      } catch {}

      // Try smooth scroll then fallback to instant. Attempt multiple targets (target, sc, document)
      const tryScroll = el => {
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
        } catch {
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
          window.YouTubeUtils?.logger?.debug?.(
            '[YouTube+][Music]',
            'Final scroll fallback failed',
            err2
          );
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
  function setupButtonPosition(button, sidePanel, MusicUtils, options = {}) {
    // options.insideSidePanel: boolean - if true, position the button inside the side panel
    if (MusicUtils.setupButtonStyles) {
      MusicUtils.setupButtonStyles(button, sidePanel, options);
      return;
    }

    if (options.insideSidePanel && sidePanel) {
      // When visually aligning with the side-panel but appending to `body`,
      // use fixed positioning so the button won't be clipped by panel transforms.
      button.style.setProperty('position', 'absolute', 'important');
      button.style.setProperty('bottom', '20px', 'important');
      button.style.setProperty('right', '20px', 'important');
      // Keep z-index high enough to be above panel content but below full-screen overlays
      button.style.setProperty('z-index', '1200', 'important');
      button.style.setProperty('pointer-events', 'auto', 'important');
      button.style.display = 'flex';
    } else {
      // Use fixed positioning so button stays visible regardless of side-panel state
      button.style.position = 'fixed';
      button.style.bottom = '100px'; // Above player bar (player bar is ~72px height)
      button.style.right = '20px'; // Match CSS definition
      button.style.zIndex = '10000'; // Higher than side-panel
      button.style.pointerEvents = 'auto';
      button.style.display = 'flex'; // Ensure flex display
    }

    window.YouTubeUtils?.logger?.debug?.('[YouTube+][Music]', 'Button positioned:', {
      position: button.style.position,
      bottom: button.style.bottom,
      right: button.style.right,
      zIndex: button.style.zIndex,
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
  function setupScrollVisibility(button, sc, MusicUtils) {
    // Try to use ScrollManager for better performance
    if (window.YouTubePlusScrollManager && window.YouTubePlusScrollManager.addScrollListener) {
      try {
        const cleanup = window.YouTubePlusScrollManager.addScrollListener(
          sc,
          () => {
            const shouldShow = sc.scrollTop > 100;
            button.classList.toggle('visible', shouldShow);
            window.YouTubeUtils?.logger?.debug?.(
              '[YouTube+][Music]',
              `Scroll position: ${sc.scrollTop}px, button visible: ${shouldShow}`
            );
          },
          { debounce: 100, runInitial: true }
        );

        button._scrollCleanup = cleanup;
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          'Using ScrollManager for scroll handling'
        );
        return;
      } catch {
        console.error('[YouTube+][Music] ScrollManager failed, using fallback');
      }
    }

    if (MusicUtils.setupScrollVisibility) {
      MusicUtils.setupScrollVisibility(button, sc, 100);
      return;
    }

    // Fallback implementation
    let isTabVisible = !document.hidden;
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
          window.YouTubeUtils?.logger?.debug?.(
            '[YouTube+][Music]',
            `Button visibility changed: ${shouldShow ? 'SHOWN' : 'HIDDEN'} (scroll: ${currentScroll}px)`
          );
        }
      });
    };

    const debounce = getDebounce();
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

    window.YouTubeUtils?.logger?.debug?.('[YouTube+][Music]', 'Using fallback scroll handler');
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
      setupButtonPosition(button, sidePanel, MusicUtils, { insideSidePanel: attachInsidePanel });

      // Always append to `body` so the button is never clipped by panel
      // transforms/overflow. If `attachInsidePanel` is true we'll keep the
      // button visually near the panel using a position updater below.
      document.body.appendChild(button);

      if (attachInsidePanel) {
        try {
          sidePanel.appendChild(button);
        } catch (err) {
          // Fallback to body if append fails for any reason
          document.body.appendChild(button);
          // Reference the error to avoid "defined but never used" lint errors
          void err;
          window.YouTubeUtils?.logger?.debug?.(
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
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          `Button shown immediately (scroll: ${initialScroll}px)`
        );
      }

      window.YouTubeUtils?.logger?.debug?.(
        '[YouTube+][Music]',
        'Scroll to top button created successfully',
        {
          buttonId: button.id,
          scrollContainer: sc.tagName,
          scrollContainerId: sc.id || 'no-id',
          scrollHeight: sc.scrollHeight,
          clientHeight: sc.clientHeight,
          scrollTop: initialScroll,
          position: button.style.position,
          computedDisplay: window.getComputedStyle(button).display,
          computedOpacity: window.getComputedStyle(button).opacity,
          computedVisibility: window.getComputedStyle(button).visibility,
        }
      );
    } catch (err) {
      console.error('[YouTube+][Music] attachButton error:', err);
    }
  }

  /**
   * State tracking for button creation attempts
   * @type {Object}
   * @private
   */
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
      if (window.location.hostname !== 'music.youtube.com') return;

      // Check if button already exists and is properly attached
      const existingButton = document.getElementById('ytmusic-side-panel-top-button');
      if (existingButton) {
        // Verify it's in the DOM and has event listeners
        if (document.body.contains(existingButton) && existingButton._scrollCleanup) {
          window.YouTubeUtils?.logger?.debug?.(
            '[YouTube+][Music]',
            'Button already exists and is properly attached'
          );
          return;
        } else {
          // Button exists but is orphaned, remove it
          window.YouTubeUtils?.logger?.debug?.('[YouTube+][Music]', 'Removing orphaned button');
          existingButton.remove();
        }
      }

      // Rate limiting
      const now = Date.now();
      if (now - buttonCreationState.lastAttempt < buttonCreationState.minInterval) {
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          'Rate limited, skipping button creation'
        );
        return;
      }

      buttonCreationState.attempts++;
      buttonCreationState.lastAttempt = now;

      if (buttonCreationState.attempts > buttonCreationState.maxAttempts) {
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          `Max attempts (${buttonCreationState.maxAttempts}) reached, stopping retries`
        );
        return;
      }

      window.YouTubeUtils?.logger?.debug?.(
        '[YouTube+][Music]',
        `Creating button (attempt ${buttonCreationState.attempts}/${buttonCreationState.maxAttempts})`
      );

      const sidePanel = document.querySelector('#side-panel');
      const MusicUtils = window.YouTubePlusMusicUtils || {};
      const button = createButton();

      // If no side-panel, try to find the main content area or queue
      if (!sidePanel) {
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          'No side-panel found, checking for main content or queue'
        );

        // Try queue renderer (shown in playlist/queue view)
        const queueRenderer = document.querySelector('ytmusic-queue-renderer');
        if (queueRenderer) {
          const queueContents = queueRenderer.querySelector('#contents');
          if (queueContents) {
            attachButtonToContainer(button, queueRenderer, queueContents, MusicUtils);
            buttonCreationState.attempts = 0; // Reset on success
            return;
          }
        }

        // Try to find main scrollable area on homepage/explore pages
        const mainContent = document.querySelector('ytmusic-browse');
        if (mainContent) {
          const scrollContainer = mainContent.querySelector('ytmusic-section-list-renderer');
          if (scrollContainer) {
            attachButtonToContainer(button, mainContent, scrollContainer, MusicUtils);
            buttonCreationState.attempts = 0; // Reset on success
            return;
          }
        }

        // Retry later
        setTimeout(createScrollToTopButton, 1000);
        return;
      }

      const scrollContainer = findScrollContainer(sidePanel, MusicUtils);

      if (!scrollContainer) {
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          'No scroll container found, will retry with backoff'
        );

        // Retry with exponential backoff
        const backoffDelay = Math.min(500 * buttonCreationState.attempts, 3000);
        setTimeout(createScrollToTopButton, backoffDelay);
        return;
      }

      attachButtonToContainer(button, sidePanel, scrollContainer, MusicUtils);
      buttonCreationState.attempts = 0; // Reset on success

      window.YouTubeUtils?.logger?.debug?.('[YouTube+][Music]', '✓ Button created successfully');
    } catch (error) {
      console.error('[YouTube+][Music] Error creating scroll to top button:', error);
      // Retry on error if we haven't exceeded max attempts
      if (buttonCreationState.attempts < buttonCreationState.maxAttempts) {
        setTimeout(createScrollToTopButton, 1000);
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
      const existingButton = document.getElementById('ytmusic-side-panel-top-button');

      // Clean up if button exists but is orphaned (no scroll listener)
      if (existingButton) {
        if (!existingButton._scrollCleanup || !document.body.contains(existingButton)) {
          window.YouTubeUtils?.logger?.debug?.(
            '[YouTube+][Music]',
            'Cleaning up orphaned/detached button'
          );
          if (existingButton._scrollCleanup) {
            try {
              existingButton._scrollCleanup();
            } catch {
              // ignore cleanup errors
            }
          }
          if (existingButton._positionCleanup) {
            try {
              existingButton._positionCleanup();
            } catch {
              // ignore cleanup errors
            }
          }
          existingButton.remove();
        } else {
          // Button exists and is healthy
          window.YouTubeUtils?.logger?.debug?.(
            '[YouTube+][Music]',
            'Button is healthy, no action needed'
          );
          return;
        }
      }

      // Look for containers that need a button
      const sidePanel = document.querySelector('#side-panel');
      const mainContent = document.querySelector('ytmusic-browse');
      const queueRenderer = document.querySelector('ytmusic-queue-renderer');
      const tabRenderer = document.querySelector('ytmusic-tab-renderer[tab-identifier]');

      if (sidePanel || mainContent || queueRenderer || tabRenderer) {
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          'Found container, scheduling button creation'
        );
        setTimeout(createScrollToTopButton, 300);
      } else {
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          'No suitable container found yet'
        );
      }
    } catch (error) {
      console.error('[YouTube+][Music] Error in checkAndCreateButton:', error);
    }
  }

  // Lazy init: do not inject styles/observers until settings enable it.

  /**
   * Create and configure the mutation observer
   * @function createObserver
   * @returns {MutationObserver}
   * @private
   */
  const createObserver = () => {
    const debounce = getDebounce();
    const debouncedCheck = debounce(checkAndCreateButton, 250);
    let lastCheckTime = 0;
    const minCheckInterval = 500; // Minimum 500ms between checks

    return new MutationObserver(mutations => {
      // Rate limiting: skip if checked too recently
      const now = Date.now();
      if (now - lastCheckTime < minCheckInterval) return;

      // Don't disconnect - keep observing for tab changes and navigation
      const existingButton = document.getElementById('ytmusic-side-panel-top-button');

      // If button exists and is properly attached, just verify it's working
      if (
        existingButton &&
        document.body.contains(existingButton) &&
        existingButton._scrollCleanup
      ) {
        // Button is healthy, no action needed
        return;
      }

      // Check if any mutation added side-panel, main content, or queue
      const hasRelevantChange = mutations.some(mutation => {
        // Fast path: skip mutations with no added nodes
        if (mutation.addedNodes.length === 0) return false;

        // Early filter: check if any added node is an Element
        let hasElements = false;
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          if (mutation.addedNodes[i].nodeType === 1) {
            hasElements = true;
            break;
          }
        }
        if (!hasElements) return false;

        return Array.from(mutation.addedNodes).some(node => {
          if (node.nodeType !== 1) return false;

          const element = /** @type {Element} */ (node);
          // Direct ID check is fastest
          if (element.id === 'side-panel' || element.id === 'contents') return true;

          // Tag name check is faster than querySelector
          const tagName = element.tagName;
          if (
            tagName === 'YTMUSIC-BROWSE' ||
            tagName === 'YTMUSIC-PLAYER-PAGE' ||
            tagName === 'YTMUSIC-QUEUE-RENDERER' ||
            tagName === 'YTMUSIC-TAB-RENDERER'
          ) {
            return true;
          }

          // Only do querySelector as last resort
          return (
            element.querySelector?.(
              '#side-panel, #contents, ytmusic-browse, ytmusic-queue-renderer, ytmusic-tab-renderer'
            ) != null
          );
        });
      });

      // Also check for attribute changes that might indicate tab switches
      const hasTabChange = mutations.some(
        mutation =>
          mutation.type === 'attributes' &&
          mutation.attributeName === 'selected' &&
          mutation.target instanceof Element &&
          mutation.target.matches?.('ytmusic-tab-renderer, tp-yt-paper-tab')
      );

      if (hasRelevantChange || hasTabChange) {
        lastCheckTime = now;
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          'Detected relevant DOM change, checking button'
        );
        debouncedCheck();
      }
    });
  };

  /**
   * Safely observe document body for side-panel appearance
   * @function observeDocumentBodySafely
   * @returns {void}
   */
  const observeDocumentBodySafely = () => {
    if (observer) return; // Already observing

    const startObserving = () => {
      if (!document.body) return;

      try {
        observer = createObserver();
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true, // Watch for attribute changes (tab switches)
          attributeFilter: ['selected', 'tab-identifier', 'page-type'], // Only specific attributes
        });
        window.YouTubeUtils?.logger?.debug?.(
          '[YouTube+][Music]',
          '✓ Observer started with enhanced config'
        );
      } catch (observeError) {
        console.error('[YouTube+][Music] Failed to observe document.body:', observeError);
        // Retry with basic config
        try {
          observer = createObserver();
          observer.observe(document.body, {
            childList: true,
            subtree: true,
          });
          window.YouTubeUtils?.logger?.debug?.(
            '[YouTube+][Music]',
            '✓ Observer started with basic config'
          );
        } catch (retryError) {
          console.error('[YouTube+][Music] Failed to start observer (retry):', retryError);
        }
      }
    };

    if (document.body) {
      startObserving();
    } else {
      document.addEventListener('DOMContentLoaded', startObserving, { once: true });
    }
  };

  function stopScrollToTopRuntime() {
    try {
      if (healthCheckIntervalId != null) {
        clearInterval(healthCheckIntervalId);
        healthCheckIntervalId = null;
      }

      if (observer) {
        observer.disconnect();
        observer = null;
      }

      if (detachNavigationListeners) {
        try {
          detachNavigationListeners();
        } catch {}
        detachNavigationListeners = null;
      }

      const button = document.getElementById('ytmusic-side-panel-top-button');
      if (button?._scrollCleanup) {
        try {
          button._scrollCleanup();
        } catch {}
      }
      if (button?._positionCleanup) {
        try {
          button._positionCleanup();
        } catch {}
      }
      if (button) button.remove();
    } catch (e) {
      console.error('[YouTube+][Music] stopScrollToTopRuntime error:', e);
    }
  }

  function startScrollToTopRuntime() {
    if (!isScrollToTopEnabled(musicSettingsSnapshot)) return;

    // Already running
    if (observer || healthCheckIntervalId != null || detachNavigationListeners) return;

    // Ensure styles (button relies on CSS)
    applyStyles();

    // Create button on load
    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          checkAndCreateButton();
        },
        { once: true }
      );
    } else {
      checkAndCreateButton();
    }

    // Navigation hooks (non-invasive: no history monkeypatch)
    const debounce = getDebounce();
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

    // Start observer
    observeDocumentBodySafely();

    // Periodic health check
    healthCheckIntervalId = setInterval(() => {
      try {
        if (!isScrollToTopEnabled(musicSettingsSnapshot)) return;
        if (document.hidden) return;

        const button = document.getElementById('ytmusic-side-panel-top-button');

        if (button && (!button._scrollCleanup || !document.body.contains(button))) {
          window.YouTubeUtils?.logger?.debug?.(
            '[YouTube+][Music]',
            'Health check: removing unhealthy button'
          );
          button.remove();
          checkAndCreateButton();
        }

        if (!button) {
          const sidePanel = document.querySelector('#side-panel');
          if (sidePanel) checkAndCreateButton();
        }
      } catch (error) {
        console.error('[YouTube+][Music] Health check error:', error);
      }
    }, 30000);
  }

  function startIfEnabled() {
    // Never start outside YouTube Music.
    if (window.location.hostname !== 'music.youtube.com') return;

    musicSettingsSnapshot = readMusicSettings();
    if (!isMusicModuleEnabled(musicSettingsSnapshot)) return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyStyles, { once: true });
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
      if (musicStyleEl && musicStyleEl.isConnected) musicStyleEl.remove();
      // Defensive: remove any stray YouTube Music style tags we may have added earlier.
      try {
        document
          .querySelectorAll('#youtube-plus-music-styles')
          .forEach(el => el !== musicStyleEl && el.remove());
      } catch {}
      musicStyleEl = null;
      return;
    }

    if (window.location.hostname !== 'music.youtube.com') return;

    // Styles
    applyStyles();

    // Scroll-to-top runtime
    if (isScrollToTopEnabled(musicSettingsSnapshot)) {
      if (!observer) startScrollToTopRuntime();
    } else {
      stopScrollToTopRuntime();
    }
  }

  function saveSettings(s) {
    // Caller already saves to localStorage; keep an in-memory snapshot.
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
      version: '2.3',
    };
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    try {
      stopScrollToTopRuntime();
      if (musicStyleEl && musicStyleEl.isConnected) musicStyleEl.remove();
      musicStyleEl = null;
      window.YouTubeUtils?.logger?.debug?.('[YouTube+][Music]', 'Cleanup completed');
    } catch (error) {
      console.error('[YouTube+][Music] Cleanup error:', error);
    }
  });

  // Start only if enabled; otherwise remain dormant.
  startIfEnabled();

  // Cross-subdomain live sync: react to changes made on youtube.com settings UI.
  try {
    if (typeof GM_addValueChangeListener !== 'undefined') {
      GM_addValueChangeListener('youtube-plus-music-settings', (_name, _oldValue, newValue) => {
        try {
          if (typeof newValue === 'string' && newValue) {
            const parsed = JSON.parse(newValue);
            if (parsed && typeof parsed.enableMusic === 'boolean') {
              musicSettingsSnapshot = { enableMusic: parsed.enableMusic };
            } else {
              musicSettingsSnapshot = readMusicSettings();
            }
          } else {
            musicSettingsSnapshot = readMusicSettings();
          }
        } catch {
          musicSettingsSnapshot = readMusicSettings();
        }

        // Apply immediately (will teardown if disabled).
        applySettingsChanges();
      });
    }
  } catch {}

  window.YouTubeUtils?.logger?.debug?.('[YouTube+][Music]', 'Module loaded (lazy)', {
    version: '2.3',
    hostname: window.location.hostname,
    enabled:
      window.location.hostname === 'music.youtube.com' &&
      isMusicModuleEnabled(musicSettingsSnapshot),
  });
})();
