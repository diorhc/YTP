/**
 * YouTube Music Enhancement Module
 * Provides UI improvements and features for YouTube Music
 * @module music
 * @version 2.2
 */

/* global GM_addStyle */

(function () {
  'use strict';

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
    `;

  // Стили для кнопки "Scroll to top"
  const scrollToTopStyles = `
        /* Base appearance for YouTube Music scroll-to-top button. */
        .ytmusic-top-button {position: absolute; bottom: 16px; right: 16px; width: 40px; height: 40px; background: rgba(255,255,255,.12); color: #fff; border: none; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 1000; opacity: 0; visibility: hidden; transition: all .3s; backdrop-filter: blur(12px) saturate(180%); -webkit-backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(255,255,255,.18); box-shadow: 0 8px 32px 0 rgba(31,38,135,.18);}
        /* Hover state */
        .ytmusic-top-button:hover {background: rgba(255,255,255,.18); transform: translateY(-2px) scale(1.07); box-shadow: 0 8px 32px rgba(0,0,0,.25);} 
        /* Visible state */
        .ytmusic-top-button.visible {opacity: 1; visibility: visible;} 
        /* Smooth icon transitions */
        .ytmusic-top-button svg {transition: transform .2s;} 
        .ytmusic-top-button:hover svg {transform: translateY(-1px) scale(1.1);} 
        /* Prevent browser/site focus ring (blue glow) and provide consistent focus style */
        .ytmusic-top-button:focus {outline: none; box-shadow: 0 8px 32px rgba(0,0,0,.25);}
        .ytmusic-top-button:active {transform: translateY(0) scale(0.98);} 
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
    // Проверяем, что мы на YouTube Music
    if (window.location.hostname !== 'music.youtube.com') {
      return;
    }

    // Объединяем все стили
    const allStyles = `
            ${enhancedStyles}
            ${hoverStyles}
            ${playerSidebarStyles}
            ${centeredPlayerStyles}
            ${playerBarStyles}
            ${centeredPlayerBarStyles}
            ${miniPlayerStyles}
            ${scrollToTopStyles}
        `;

    // Применяем стили
    if (typeof GM_addStyle === 'undefined') {
      const style = document.createElement('style');
      style.textContent = allStyles;
      document.head.appendChild(style);
    } else {
      GM_addStyle(allStyles);
    }

    console.log('[YouTube+][Music]', 'Стили применены');
  }

  /**
   * Reference to global i18n instance
   * @type {Object|null}
   * @private
   */
  const _globalI18n_music =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;

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
    return button;
  }

  /**
   * Find scrollable container in side panel
   * @param {HTMLElement} sidePanel - Side panel element
   * @param {Object} MusicUtils - Utility module
   * @returns {HTMLElement|null} Scroll container or null
   * @private
   */
  function findScrollContainer(sidePanel, MusicUtils) {
    const findContainer =
      MusicUtils.findScrollContainer ||
      (root => {
        const contents = root?.querySelector('#contents');
        if (contents && contents.scrollHeight > contents.clientHeight) return contents;
        if (root && root.scrollHeight > root.clientHeight + 10) return root;
        return null;
      });

    return findContainer(sidePanel);
  }

  /**
   * Setup scroll to top click behavior
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} sc - Scroll container
   * @param {Object} MusicUtils - Utility module
   * @private
   */
  function setupScrollBehavior(button, sc, MusicUtils) {
    if (MusicUtils.setupScrollToTop) {
      MusicUtils.setupScrollToTop(button, sc);
    } else {
      button.addEventListener('click', () => {
        sc.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  /**
   * Setup button positioning styles
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} sidePanel - Side panel element
   * @param {Object} MusicUtils - Utility module
   * @private
   */
  function setupButtonPosition(button, sidePanel, MusicUtils) {
    if (MusicUtils.setupButtonStyles) {
      MusicUtils.setupButtonStyles(button, sidePanel);
    } else {
      sidePanel.style.position = sidePanel.style.position || 'relative';
      button.style.position = 'absolute';
      button.style.bottom = '16px';
      button.style.right = '16px';
      button.style.zIndex = '1000';
    }
  }

  /**
   * Setup scroll visibility toggle handler
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} sc - Scroll container
   * @param {Object} MusicUtils - Utility module
   * @private
   */
  function setupScrollVisibility(button, sc, MusicUtils) {
    if (MusicUtils.setupScrollVisibility) {
      MusicUtils.setupScrollVisibility(button, sc, 100);
    } else {
      const debounce = (fn, delay) => {
        let timeoutId;
        return (...args) => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fn(...args), delay);
        };
      };
      const scrollHandler = debounce(() => {
        button.classList.toggle('visible', sc.scrollTop > 100);
      }, 100);
      sc.addEventListener('scroll', scrollHandler, { passive: true });
      button.classList.toggle('visible', sc.scrollTop > 100);
    }
  }

  /**
   * Attach button to container with all setup
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} sidePanel - Side panel element
   * @param {HTMLElement} sc - Scroll container
   * @param {Object} MusicUtils - Utility module
   * @private
   */
  function attachButtonToContainer(button, sidePanel, sc, MusicUtils) {
    try {
      setupScrollBehavior(button, sc, MusicUtils);
      setupButtonPosition(button, sidePanel, MusicUtils);
      sidePanel.appendChild(button);
      setupScrollVisibility(button, sc, MusicUtils);
      console.log('[YouTube+][Music]', 'Кнопка scroll to top создана');
    } catch (err) {
      console.error('[YouTube+][Music] attachButton error:', err);
    }
  }

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

      const sidePanel = document.querySelector('#side-panel');
      if (!sidePanel || document.getElementById('ytmusic-side-panel-top-button')) return;

      const MusicUtils = window.YouTubePlusMusicUtils || {};
      const button = createButton();
      const scrollContainer = findScrollContainer(sidePanel, MusicUtils);

      if (!scrollContainer) {
        // Retry after delay if container not found
        setTimeout(() => {
          const sc = findScrollContainer(sidePanel, MusicUtils);
          if (sc) attachButtonToContainer(button, sidePanel, sc, MusicUtils);
        }, 400);
        return;
      }

      attachButtonToContainer(button, sidePanel, scrollContainer, MusicUtils);
    } catch (error) {
      console.error('[YouTube+][Music] Error creating scroll to top button:', error);
    }
  }

  /**
   * Checks if side panel exists and creates scroll-to-top button if needed
   * @function checkAndCreateButton
   * @returns {void}
   */
  function checkAndCreateButton() {
    const sidePanel = document.querySelector('#side-panel');
    if (sidePanel && !document.getElementById('ytmusic-side-panel-top-button')) {
      setTimeout(createScrollToTopButton, 500);
    }
  }

  // Применяем стили при загрузке
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyStyles();
      checkAndCreateButton();
    });
  } else {
    applyStyles();
    checkAndCreateButton();
  }

  // Дополнительно применяем при смене состояния истории (для SPA)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.call(this, ...args);
    setTimeout(() => {
      applyStyles();
      checkAndCreateButton();
    }, 100);
  };

  history.replaceState = function (...args) {
    originalReplaceState.call(this, ...args);
    setTimeout(() => {
      applyStyles();
      checkAndCreateButton();
    }, 100);
  };

  window.addEventListener('popstate', () => {
    setTimeout(() => {
      applyStyles();
      checkAndCreateButton();
    }, 100);
  });

  // Observer для обнаружения появления side-panel
  const observer = new MutationObserver(() => {
    checkAndCreateButton();
  });

  const observeDocumentBodySafely = () => {
    if (document.body) {
      try {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      } catch (observeError) {
        console.error('[YouTube+][Music] Failed to observe document.body:', observeError);
      }
    } else {
      // Wait for DOMContentLoaded then attach
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          try {
            if (document.body) {
              observer.observe(document.body, { childList: true, subtree: true });
            }
          } catch (observeError) {
            console.error(
              '[YouTube+][Music] Failed to observe document.body after DOMContentLoaded:',
              observeError
            );
          }
        },
        { once: true }
      );
    }
  };

  // Export module to global scope for module loader
  if (typeof window !== 'undefined') {
    window.YouTubeMusic = {
      observeDocumentBodySafely,
      version: '2.2',
    };
  }

  observeDocumentBodySafely();

  console.log('[YouTube+][Music]', 'Модуль загружен');
})();
