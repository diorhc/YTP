// Enhanced Tabviews
(function () {
  'use strict';

  // Localization
  const i18n = {
    en: {
      scrollToTop: 'Scroll to top',
    },
    ru: {
      scrollToTop: 'Прокрутить вверх',
    },
  };

  const getLanguage = () => {
    const htmlLang = document.documentElement.lang || 'en';
    if (htmlLang.startsWith('ru')) return 'ru';
    return 'en';
  };

  const lang = getLanguage();
  const t = key => i18n[lang][key] || i18n.en[key] || key;

  /**
   * Configuration object for scroll-to-top button
   * @type {Object}
   * @property {boolean} enabled - Whether the feature is enabled
   * @property {string} storageKey - LocalStorage key for settings
   */
  const config = {
    enabled: true,
    storageKey: 'youtube_top_button_settings',
  };

  /**
   * Adds CSS styles for scroll-to-top button and scrollbars
   * @returns {void}
   */
  const addStyles = () => {
    if (document.getElementById('custom-styles')) return;

    const style = document.createElement('style');
    style.id = 'custom-styles';
    style.textContent = `
      :root{--scrollbar-width:8px;--scrollbar-track:transparent;--scrollbar-thumb:rgba(144,144,144,.5);--scrollbar-thumb-hover:rgba(170,170,170,.7);--scrollbar-thumb-active:rgba(190,190,190,.9);}
      ::-webkit-scrollbar{width:var(--scrollbar-width)!important;height:var(--scrollbar-width)!important;}
      ::-webkit-scrollbar-track{background:var(--scrollbar-track)!important;border-radius:4px!important;}
      ::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb)!important;border-radius:4px!important;transition:background .2s!important;}
      ::-webkit-scrollbar-thumb:hover{background:var(--scrollbar-thumb-hover)!important;}
      ::-webkit-scrollbar-thumb:active{background:var(--scrollbar-thumb-active)!important;}
      ::-webkit-scrollbar-corner{background:transparent!important;}
      *{scrollbar-width:thin;scrollbar-color:var(--scrollbar-thumb) var(--scrollbar-track);}
      html[dark]{--scrollbar-thumb:rgba(144,144,144,.4);--scrollbar-thumb-hover:rgba(170,170,170,.6);--scrollbar-thumb-active:rgba(190,190,190,.8);}
      .top-button{position:absolute;bottom:16px;right:16px;width:40px;height:40px;background:var(--yt-top-btn-bg,rgba(0,0,0,.7));color:var(--yt-top-btn-color,#fff);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1000;opacity:0;visibility:hidden;transition:all .3s;backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);border:1px solid var(--yt-top-btn-border,rgba(255,255,255,.1));background:rgba(255,255,255,.12);box-shadow:0 8px 32px 0 rgba(31,38,135,.18);}
      .top-button:hover{background:var(--yt-top-btn-hover,rgba(0,0,0,.15));transform:translateY(-2px) scale(1.07);box-shadow:0 8px 32px rgba(0,0,0,.25);}
      .top-button.visible{opacity:1;visibility:visible;}
      .top-button svg{transition:transform .2s;}
      .top-button:hover svg{transform:translateY(-1px) scale(1.1);}
      html[dark]{--yt-top-btn-bg:rgba(255,255,255,.10);--yt-top-btn-color:#fff;--yt-top-btn-border:rgba(255,255,255,.18);--yt-top-btn-hover:rgba(255,255,255,.18);}
      html:not([dark]){--yt-top-btn-bg:rgba(255,255,255,.12);--yt-top-btn-color:#222;--yt-top-btn-border:rgba(0,0,0,.08);--yt-top-btn-hover:rgba(255,255,255,.18);}
      ytd-watch-flexy:not([tyt-tab^="#"]) .top-button{display:none;}
      ytd-watch-flexy[flexy] #movie_player,
      ytd-watch-flexy[flexy] #movie_player .html5-video-container,
      ytd-watch-flexy[flexy] .html5-main-video{
        width:100%!important;
        max-width:100%!important;
      }
      ytd-watch-flexy[flexy] .html5-main-video{
        height:auto!important;
        max-height:100%!important;
        object-fit:contain!important;
        transform:none!important;
      }
      ytd-watch-flexy[flexy] #player-container-outer,
      ytd-watch-flexy[flexy] #movie_player{
        display:flex!important;
        align-items:center!important;
        justify-content:center!important;
      }
        `;
    (document.head || document.documentElement).appendChild(style);
  };

  /**
   * Updates button visibility based on scroll position
   * @param {HTMLElement} scrollContainer - The container being scrolled
   * @returns {void}
   */
  const handleScroll = scrollContainer => {
    const button = document.getElementById('right-tabs-top-button');
    if (!button || !scrollContainer) return;
    button.classList.toggle('visible', scrollContainer.scrollTop > 100);
  };

  /**
   * Sets up scroll event listener on active tab
   * @returns {void}
   */
  const setupScrollListener = () => {
    document.querySelectorAll('.tab-content-cld').forEach(tab => {
      tab.removeEventListener('scroll', tab._topButtonScrollHandler);
    });

    const activeTab = document.querySelector(
      '#right-tabs .tab-content-cld:not(.tab-content-hidden)'
    );
    if (activeTab) {
      const scrollHandler = () => handleScroll(activeTab);
      activeTab._topButtonScrollHandler = scrollHandler;
      activeTab.addEventListener('scroll', scrollHandler, { passive: true });
      handleScroll(activeTab);
    }
  };

  /**
   * Creates and appends scroll-to-top button
   * @returns {void}
   */
  const createButton = () => {
    const rightTabs = document.querySelector('#right-tabs');
    if (!rightTabs || document.getElementById('right-tabs-top-button')) return;
    if (!config.enabled) return;

    const button = document.createElement('button');
    button.id = 'right-tabs-top-button';
    button.className = 'top-button';
    button.title = t('scrollToTop');
    button.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

    button.addEventListener('click', () => {
      const activeTab = document.querySelector(
        '#right-tabs .tab-content-cld:not(.tab-content-hidden)'
      );
      if (activeTab) activeTab.scrollTo({ top: 0, behavior: 'smooth' });
    });

    rightTabs.style.position = 'relative';
    rightTabs.appendChild(button);
    setupScrollListener();
  };

  /**
   * Observes DOM changes to detect tab switches
   * @returns {void}
   */
  const observeTabChanges = () => {
    const observer = new MutationObserver(mutations => {
      if (
        mutations.some(
          m =>
            m.type === 'attributes' &&
            m.attributeName === 'class' &&
            m.target instanceof Element &&
            m.target.classList.contains('tab-content-cld')
        )
      ) {
        setTimeout(setupScrollListener, 100);
      }
    });

    const rightTabs = document.querySelector('#right-tabs');
    if (rightTabs) {
      observer.observe(rightTabs, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class'],
      });
    }
  };

  // Events
  const setupEvents = () => {
    document.addEventListener(
      'click',
      e => {
        const target = /** @type {EventTarget & HTMLElement} */ (e.target);
        if (target.closest && target.closest('.tab-btn[tyt-tab-content]')) {
          setTimeout(setupScrollListener, 100);
        }
      },
      true
    );
  };

  // Initialize
  const init = () => {
    addStyles();
    setupEvents();

    const checkForTabs = () => {
      if (document.querySelector('#right-tabs')) {
        createButton();
        observeTabChanges();
      } else {
        setTimeout(checkForTabs, 500);
      }
    };

    checkForTabs();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// YouTube End Screen Remover
(function () {
  'use strict';

  // Optimized configuration
  const CONFIG = {
    enabled: true,
    storageKey: 'youtube_endscreen_settings',
    selectors:
      '.ytp-ce-element-show,.ytp-ce-element,.ytp-endscreen-element,.ytp-ce-covering-overlay,.ytp-cards-teaser,.ytp-cards-button,.iv-drawer,.video-annotations',
    debounceMs: 32,
    batchSize: 20,
  };

  // Minimal state with better tracking
  const state = {
    observer: null,
    styleEl: null,
    isActive: false,
    removeCount: 0,
    lastCheck: 0,
    ytNavigateListenerKey: null,
    settingsNavListenerKey: null,
  };

  // High-performance utilities: use shared debounce when available
  const debounce = (fn, ms) => {
    try {
      return (
        (window.YouTubeUtils && window.YouTubeUtils.debounce) ||
        ((f, t) => {
          let id;
          return (...args) => {
            clearTimeout(id);
            id = setTimeout(() => f(...args), t);
          };
        })(fn, ms)
      );
    } catch {
      let id;
      return (...args) => {
        clearTimeout(id);
        id = setTimeout(() => fn(...args), ms);
      };
    }
  };

  const fastRemove = elements => {
    const len = Math.min(elements.length, CONFIG.batchSize);
    for (let i = 0; i < len; i++) {
      const el = elements[i];
      if (el?.isConnected) {
        el.style.cssText = 'display:none!important;visibility:hidden!important';
        try {
          el.remove();
          state.removeCount++;
        } catch {}
      }
    }
  };

  // Settings with caching
  const settings = {
    load: () => {
      try {
        const data = localStorage.getItem(CONFIG.storageKey);
        CONFIG.enabled = data ? (JSON.parse(data).enabled ?? true) : true;
      } catch {
        CONFIG.enabled = true;
      }
    },

    save: () => {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({ enabled: CONFIG.enabled }));
      } catch {}
      settings.apply();
    },

    apply: () => (CONFIG.enabled ? init() : cleanup()),
  };

  // Optimized core functions
  const injectCSS = () => {
    if (state.styleEl || !CONFIG.enabled) return;

    // ✅ Use StyleManager instead of createElement('style')
    const styles = `${CONFIG.selectors}{display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;transform:scale(0)!important}`;
    YouTubeUtils.StyleManager.add('end-screen-remover', styles);
    state.styleEl = true; // Mark as added
  };

  const removeEndScreens = () => {
    if (!CONFIG.enabled) return;
    const now = performance.now();
    if (now - state.lastCheck < CONFIG.debounceMs) return;
    state.lastCheck = now;

    const elements = document.querySelectorAll(CONFIG.selectors);
    if (elements.length) fastRemove(elements);
  };

  const setupWatcher = () => {
    if (state.observer || !CONFIG.enabled) return;

    const throttledRemove = debounce(removeEndScreens, CONFIG.debounceMs);

    state.observer = new MutationObserver(mutations => {
      let hasRelevantChanges = false;
      for (const { addedNodes } of mutations) {
        for (const node of addedNodes) {
          if (node instanceof Element) {
            // Handle both HTML and SVG elements - className can be string or SVGAnimatedString
            const classNameValue =
              typeof node.className === 'string'
                ? node.className
                : node.className &&
                    typeof node.className === 'object' &&
                    'baseVal' in node.className
                  ? /** @type {any} */ (node.className).baseVal
                  : '';
            if (classNameValue.includes('ytp-') || node.querySelector?.('.ytp-ce-element')) {
              hasRelevantChanges = true;
              break;
            }
          }
        }
        if (hasRelevantChanges) break;
      }
      if (hasRelevantChanges) throttledRemove();
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(state.observer);

    const target = document.querySelector('#movie_player') || document.body;
    state.observer.observe(target, {
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'style'],
    });
  };

  const cleanup = () => {
    state.observer?.disconnect();
    state.observer = null;
    state.styleEl?.remove();
    state.styleEl = null;
    state.isActive = false;
  };

  const init = () => {
    if (state.isActive || !CONFIG.enabled) return;
    state.isActive = true;
    injectCSS();
    removeEndScreens();
    setupWatcher();
  };

  // Streamlined settings UI
  const addSettingsUI = () => {
    const section = document.querySelector('.ytp-plus-settings-section[data-section="advanced"]');
    if (!section || section.querySelector('.endscreen-settings')) return;

    const container = document.createElement('div');
    container.className = 'ytp-plus-settings-item endscreen-settings';
    container.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">${YouTubeUtils.t('endscreenHideLabel')}</label>
          <div class="ytp-plus-settings-item-description">${YouTubeUtils.t('endscreenHideDesc')}${state.removeCount ? ` (${state.removeCount} ${YouTubeUtils.t('removedSuffix').replace('{n}', '')?.trim() || 'removed'})` : ''}</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" ${CONFIG.enabled ? 'checked' : ''}>
      `;

    section.appendChild(container);

    container.querySelector('input').addEventListener(
      'change',
      e => {
        const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
        CONFIG.enabled = target.checked;
        settings.save();
      },
      { passive: true }
    );
  };

  // Optimized navigation handler
  const handlePageChange = debounce(() => {
    if (location.pathname === '/watch') {
      cleanup();
      requestIdleCallback ? requestIdleCallback(init) : setTimeout(init, 1);
    }
  }, 50);

  // Initialize
  settings.load();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  const handleSettingsNavClick = e => {
    const target = /** @type {EventTarget & HTMLElement} */ (e.target);
    if (target.dataset?.section === 'advanced') {
      setTimeout(addSettingsUI, 10);
    }
  };

  if (!state.ytNavigateListenerKey) {
    state.ytNavigateListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'yt-navigate-finish',
      /** @type {EventListener} */ (handlePageChange),
      { passive: true }
    );
  }

  // Settings modal integration
  const settingsObserver = new MutationObserver(mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addSettingsUI, 25);
          return;
        }
      }
    }
  });

  // ✅ Register observer in cleanupManager
  YouTubeUtils.cleanupManager.registerObserver(settingsObserver);

  // ✅ Safe observe with document.body check
  if (document.body) {
    settingsObserver.observe(document.body, { childList: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      settingsObserver.observe(document.body, { childList: true });
    });
  }

  if (!state.settingsNavListenerKey) {
    state.settingsNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'click',
      handleSettingsNavClick,
      { passive: true, capture: true }
    );
  }
})();

// Time to Read (Resume Playback)
(function () {
  'use strict';

  const RESUME_STORAGE_KEY = 'youtube_resume_times_v1';
  const OVERLAY_ID = 'yt-resume-overlay';
  const AUTO_HIDE_MS = 20000; // hide overlay after 20s

  // Localization
  const i18n = {
    en: {
      resumePlayback: 'Resume playback?',
      resume: 'Resume',
      startOver: 'Start over',
    },
    ru: {
      resumePlayback: 'Продолжить воспроизведение?',
      resume: 'Продолжить',
      startOver: 'Начать сначала',
    },
  };

  // Detect language
  const getLanguage = () => {
    const htmlLang = document.documentElement.lang || 'en';
    if (htmlLang.startsWith('ru')) return 'ru';
    return 'en';
  };

  const lang = getLanguage();
  const t = key => i18n[lang][key] || i18n.en[key] || key;

  const readStorage = () => {
    try {
      return JSON.parse(localStorage.getItem(RESUME_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  };

  const writeStorage = obj => {
    try {
      localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(obj));
    } catch {}
  };

  // Get current video id from the page (works on standard watch pages)
  const getVideoId = () => {
    try {
      const meta = document.querySelector('link[rel="canonical"]');
      if (meta && meta.href) {
        const u = new URL(meta.href);
        return u.searchParams.get('v') || (u.pathname && u.pathname.split('/').pop());
      }
      // Fallback to ytInitialPlayerResponse
      return (
        (window.ytInitialPlayerResponse &&
          window.ytInitialPlayerResponse.videoDetails &&
          window.ytInitialPlayerResponse.videoDetails.videoId) ||
        null
      );
    } catch {
      return null;
    }
  };

  const createOverlay = (seconds, onResume, onRestart) => {
    if (document.getElementById(OVERLAY_ID)) return null;
    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;

    // Try to insert overlay inside the player so it appears above the progress bar
    const player = document.querySelector('#movie_player');
    const inPlayer = !!player;

    // Ensure glassmorphism styles are available for the overlay
    const resumeOverlayStyles = `
      .ytpa-resume-overlay{min-width:180px;max-width:36vw;background:rgba(24, 24, 24, 0.3);color:var(--yt-spec-text-primary,#fff);padding:12px 14px;border-radius:12px;backdrop-filter:blur(8px) saturate(150%);-webkit-backdrop-filter:blur(8px) saturate(150%);box-shadow:0 14px 40px rgba(0,0,0,0.48);border:1.25px solid rgba(255,255,255,0.06);font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;align-items:center;text-align:center}
      .ytpa-resume-overlay .ytpa-resume-title{font-weight:600;margin-bottom:8px}
      .ytpa-resume-overlay .ytpa-resume-actions{display:flex;gap:8px;justify-content:center;margin-top:6px}
      .ytpa-resume-overlay .ytpa-resume-btn{padding:6px 12px;border-radius:8px;border:none;cursor:pointer}
      .ytpa-resume-overlay .ytpa-resume-btn.primary{background:#1e88e5;color:#fff}
      .ytpa-resume-overlay .ytpa-resume-btn.ghost{background:rgba(255,255,255,0.06);color:#fff}
    `;
    try {
      if (window.YouTubeUtils && YouTubeUtils.StyleManager) {
        YouTubeUtils.StyleManager.add('ytpa-resume-overlay-styles', resumeOverlayStyles);
      } else if (!document.getElementById('ytpa-resume-overlay-styles')) {
        const s = document.createElement('style');
        s.id = 'ytpa-resume-overlay-styles';
        s.textContent = resumeOverlayStyles;
        (document.head || document.documentElement).appendChild(s);
      }
    } catch {}

    if (inPlayer) {
      try {
        // Ensure player can be a positioning context
        const playerStyle = window.getComputedStyle(
          /** @type {Element} */ (/** @type {unknown} */ (player))
        );
        if (playerStyle.position === 'static') player.style.position = 'relative';
      } catch {}

      // Position centered inside the player
      wrap.className = 'ytpa-resume-overlay';
      // absolute center (use transform to center by both axes)
      wrap.style.cssText =
        'position:absolute;left:50%;bottom:5%;transform:translate(-50%,-50%);z-index:9999;pointer-events:auto;';
      player.appendChild(wrap);
    } else {
      // Fallback: fixed centered on the page
      wrap.className = 'ytpa-resume-overlay';
      wrap.style.cssText =
        'position:fixed;left:50%;bottom:5%;transform:translate(-50%,-50%);z-index:1200;pointer-events:auto;';
      document.body.appendChild(wrap);
    }

    const title = document.createElement('div');
    title.className = 'ytpa-resume-title';
    title.textContent = `${t('resumePlayback')} (${formatTime(seconds)})`;

    const btnResume = document.createElement('button');
    btnResume.className = 'ytpa-resume-btn primary';
    btnResume.textContent = t('resume');
    const btnRestart = document.createElement('button');
    btnRestart.className = 'ytpa-resume-btn ghost';
    btnRestart.textContent = t('startOver');

    btnResume.addEventListener('click', () => {
      try {
        onResume();
      } catch {}
      try {
        wrap.remove();
      } catch {}
    });
    btnRestart.addEventListener('click', () => {
      try {
        onRestart();
      } catch {}
      try {
        wrap.remove();
      } catch {}
    });

    // group actions and center them
    const actions = document.createElement('div');
    actions.className = 'ytpa-resume-actions';
    actions.appendChild(btnResume);
    actions.appendChild(btnRestart);

    wrap.appendChild(title);
    wrap.appendChild(actions);

    const to = setTimeout(() => {
      try {
        wrap.remove();
      } catch {}
    }, AUTO_HIDE_MS);

    // Return function to cancel timeout
    const cancel = () => clearTimeout(to);

    // Register cleanup: cancel timeout and remove overlay when cleanup runs
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.register(() => {
        try {
          cancel();
        } catch {}
        try {
          wrap.remove();
        } catch {}
      });
    }

    return cancel;
  };

  const formatTime = secs => {
    const s = Math.floor(secs % 60)
      .toString()
      .padStart(2, '0');
    const m = Math.floor((secs / 60) % 60).toString();
    const h = Math.floor(secs / 3600);
    return h ? `${h}:${m.padStart(2, '0')}:${s}` : `${m}:${s}`;
  };

  const attachResumeHandlers = videoEl => {
    if (!videoEl) return;
    const vid = getVideoId();
    if (!vid) return;

    const storage = readStorage();
    const saved = storage[vid];

    // Save current time using `timeupdate` event (throttled) instead of interval
    let timeUpdateHandler = null;
    let lastSavedAt = 0;
    const SAVE_THROTTLE_MS = 800; // minimum ms between writes

    const startSaving = () => {
      if (timeUpdateHandler) return;
      timeUpdateHandler = () => {
        try {
          const t = Math.floor(videoEl.currentTime || 0);
          const now = Date.now();
          if (t && (!lastSavedAt || now - lastSavedAt > SAVE_THROTTLE_MS)) {
            const s = readStorage();
            s[vid] = t;
            writeStorage(s);
            lastSavedAt = now;
          }
        } catch {}
      };
      videoEl.addEventListener('timeupdate', timeUpdateHandler, { passive: true });

      // register cleanup to remove listener
      if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
        YouTubeUtils.cleanupManager.register(() => {
          try {
            videoEl.removeEventListener('timeupdate', timeUpdateHandler);
          } catch {}
        });
      }
    };

    const stopSaving = () => {
      if (!timeUpdateHandler) return;
      try {
        videoEl.removeEventListener('timeupdate', timeUpdateHandler);
      } catch {}
      timeUpdateHandler = null;
      lastSavedAt = 0;
    };

    // If saved time exists and is > 5s, show overlay
    if (saved && saved > 5 && !document.getElementById(OVERLAY_ID)) {
      const cancelTimeout = createOverlay(
        saved,
        () => {
          try {
            videoEl.currentTime = saved;
            videoEl.play();
          } catch {}
        },
        () => {
          try {
            videoEl.currentTime = 0;
            videoEl.play();
          } catch {}
        }
      );

      // register cleanup for overlay timeout
      if (window.YouTubeUtils && YouTubeUtils.cleanupManager && cancelTimeout) {
        YouTubeUtils.cleanupManager.register(cancelTimeout);
      }
    }

    // Start saving when playing
    const onPlay = () => startSaving();
    const onPause = () => stopSaving();
    videoEl.addEventListener('play', onPlay, { passive: true });
    videoEl.addEventListener('pause', onPause, { passive: true });

    // Cleanup listeners when needed
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.register(() => {
        try {
          videoEl.removeEventListener('play', onPlay);
          videoEl.removeEventListener('pause', onPause);
        } catch {}
      });
    }
  };

  // Try to find the primary HTML5 video element on the YouTube watch page
  const findVideoElement = () => {
    // Try multiple selectors for better compatibility
    const selectors = [
      'video.html5-main-video',
      'video.video-stream',
      '#movie_player video',
      'video',
    ];

    for (const selector of selectors) {
      const video = document.querySelector(selector);
      if (video && video.tagName === 'VIDEO') {
        return /** @type {HTMLVideoElement} */ (video);
      }
    }

    return null;
  };

  const initResume = () => {
    // Only run on watch pages
    if (window.location.pathname !== '/watch') return;

    const videoEl = findVideoElement();
    if (videoEl) {
      attachResumeHandlers(videoEl);
    } else {
      // Retry after a short delay if video not found yet
      setTimeout(initResume, 500);
    }
  };

  // Listen for navigation events used by YouTube SPA
  const onNavigate = () => setTimeout(initResume, 150);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initResume, { once: true });
  } else {
    initResume();
  }

  // YouTube internal navigation event
  if (window && window.document) {
    // Prefer custom event registered in other modules
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.registerListener(document, 'yt-navigate-finish', onNavigate, {
        passive: true,
      });
    } else {
      document.addEventListener('yt-navigate-finish', onNavigate, { passive: true });
    }
  }
})();

// Play All
(async function () {
  'use strict';

  // Safe access to Greasemonkey/Tampermonkey globals via window lookup to avoid
  // static analysis errors when those globals are not present.
  const GM_info_safe =
    typeof window !== 'undefined' && window['GM_info'] ? window['GM_info'] : null;
  const GM_safe = typeof window !== 'undefined' && window['GM'] ? window['GM'] : null;

  // Localization for YouTube Play All
  const i18n = {
    en: {
      loadingPlaylist: 'Loading playlist...',
      playPopular: 'Play Popular',
      playAll: 'Play All',
      playRandom: 'Play Random',
      preferNewest: 'Prefer newest',
      preferOldest: 'Prefer oldest',
      randomMode: 'Random',
      externalApiWarning:
        "Make sure to allow the external API call to ytplaylist.robert.wesner.io to keep viewing playlists that YouTube doesn't natively support!",
    },
    ru: {
      loadingPlaylist: 'Загрузка плейлиста...',
      playPopular: 'Популярные',
      playAll: 'Воспроизвести все',
      playRandom: 'Случайно',
      preferNewest: 'Сначала новые',
      preferOldest: 'Сначала старые',
      randomMode: 'Случайный',
      externalApiWarning:
        'Разрешите внешний API вызов на ytplaylist.robert.wesner.io для просмотра плейлистов, которые YouTube не поддерживает изначально!',
    },
  };

  const getLanguage = () => {
    const htmlLang = document.documentElement.lang || 'en';
    if (htmlLang.startsWith('ru')) return 'ru';
    return 'en';
  };

  const lang = getLanguage();
  const t = key => i18n[lang][key] || i18n.en[key] || key;

  const scriptVersion = GM_info_safe?.script?.version || null;
  if (scriptVersion && /-(alpha|beta|dev|test)$/.test(scriptVersion)) {
    // Only log in development/test builds
    if (typeof console !== 'undefined' && console.log) {
      console.log(
        '%cYTPA - YouTube Play All\n',
        'color: #bf4bcc; font-size: 32px; font-weight: bold',
        'You are currently running a test version:',
        scriptVersion
      );
    }
  }

  if (window.hasOwnProperty('trustedTypes') && !window.trustedTypes.defaultPolicy) {
    window.trustedTypes.createPolicy('default', { createHTML: string => string });
  }

  if (document.head) {
    document.head.insertAdjacentHTML(
      'beforeend',
      `<style>
        .ytpa-btn {
            border-radius: 8px;
            font-family: 'Roboto', 'Arial', sans-serif;
            font-size: 1.4rem;
            line-height: 2rem;
            font-weight: 500;
            padding: 0.5em;
            margin-left: 0.6em;
            user-select: none;
        }
        
        .ytpa-btn, .ytpa-btn > * {
            text-decoration: none;
            cursor: pointer;
        }
        
        .ytpa-btn-sections {
            padding: 0;
        }
        
        .ytpa-btn-sections > .ytpa-btn-section {
            padding: 0.5em;
            display: inline-block;
        }
 
        .ytpa-btn-sections > .ytpa-btn-section:first-child {
            border-top-left-radius: 8px;
            border-bottom-left-radius: 8px;
        }
 
  /* Firefox doesn't support the :nth-last-child(1 of ...) syntax; use :last-child instead */
    .ytpa-btn-sections > .ytpa-btn-section:last-child {
      border-top-right-radius: 8px;
      border-bottom-right-radius: 8px;
    }
        
        .ytpa-badge {
            border-radius: 8px;
            padding: 0.2em;
            font-size: 0.8em;
            vertical-align: top;
        }
 
        .ytpa-play-all-btn {
            background-color: #313131ff;
            color: white;
        }
 
        .ytpa-play-all-btn:hover {
            background-color: #d264de;
        }
        
        .ytpa-random-btn > .ytpa-btn-section, .ytpa-random-badge, .ytpa-random-notice, .ytpa-random-popover > * {
            background-color: #313131ff;
            color: white;
        }
 
        .ytpa-random-btn > .ytpa-btn-section:hover, .ytpa-random-popover > *:hover {
            background-color: #6192ee;
        }
        
        .ytpa-play-all-btn.ytpa-unsupported {
            background-color: #828282;
            color: white;
        }
        
        .ytpa-random-popover {
            position: absolute;
            border-radius: 8px;
            font-size: 1.6rem;
            transform: translate(-100%, 0.4em);
        }
        
        .ytpa-random-popover > * {
            display: block;
            text-decoration: none;
            padding: 0.4em;
        }
        
        .ytpa-random-popover > :first-child {
            border-top-left-radius: 8px;
            border-top-right-radius: 8px;
        }
        
        .ytpa-random-popover > :last-child {
            border-bottom-left-radius: 8px;
            border-bottom-right-radius: 8px;
        }
    
        .ytpa-random-popover > *:not(:last-child) {
            border-bottom: 1px solid #6e8dbb;
        }
    
        .ytpa-button-container {
            display: flex;
            width: 100%;
            margin-top: 1em;
            margin-bottom: -1em;
        }
 
        ytd-rich-grid-renderer .ytpa-button-container > :first-child {
            margin-left: 0;
        }
        
        /* fetch() API introduces a race condition. This hides the occasional duplicate buttons */
        .ytpa-play-all-btn ~ .ytpa-play-all-btn,
        .ytpa-random-btn ~ .ytpa-random-btn {
            display: none;
        }
        
        /* Fix for mobile view */
        ytm-feed-filter-chip-bar-renderer .ytpa-btn {
            margin-right: 12px;
            padding: 0.4em;
        }
        
    /* Replace :has() rules (unsupported in Firefox) by targeting attributes placed on body by JS */
    body.ytpa-has-random #secondary ytd-playlist-panel-renderer[ytpa-random] .ytp-prev-button.ytp-button,
    body.ytpa-has-random #secondary ytd-playlist-panel-renderer[ytpa-random] .ytp-next-button.ytp-button:not([ytpa-random="applied"]) {
      display: none !important;
    }

    body.ytpa-has-random #secondary ytd-playlist-panel-renderer[ytpa-random] ytd-menu-renderer.ytd-playlist-panel-renderer {
      height: 1em;
      visibility: hidden;
    }

    /* Use a body class to emulate :not(:hover) visual behavior via a slightly different rule: when not hovered the items get blurred.
       Since CSS cannot detect :not(:hover) globally, we apply a class during random mode and rely on the existing hover behaviour for desktop. */
    body.ytpa-has-random #secondary ytd-playlist-panel-renderer[ytpa-random] ytd-playlist-panel-video-renderer {
      transition: filter 0.2s ease-in-out;
    }
    body.ytpa-has-random #secondary ytd-playlist-panel-renderer[ytpa-random]:not(:hover) ytd-playlist-panel-video-renderer {
      filter: blur(2em);
    }
 
        .ytpa-random-notice {
            padding: 1em;
            z-index: 1000;
        }
        
        .ytpa-playlist-emulator {
            margin-bottom: 1.6rem;
            border-radius: 1rem;
        }
        
        .ytpa-playlist-emulator > .title {
            border-top-left-radius: 1rem;
            border-top-right-radius: 1rem;
            font-size: 2rem;
            background-color: #323232;
            color: white;
            padding: 0.8rem;
        }
        
        .ytpa-playlist-emulator > .information {
            font-size: 1rem;
            background-color: #2b2a2a;
            color: white;
            padding: 0.8rem;
        }
        
        .ytpa-playlist-emulator > .footer {
            border-bottom-left-radius: 1rem;
            border-bottom-right-radius: 1rem;
            background-color: #323232;
            padding: 0.8rem;
        }
        
        .ytpa-playlist-emulator > .items {
            max-height: 500px;
            overflow-y: auto;
            overflow-x: hidden;
        }
        
        .ytpa-playlist-emulator:not([data-failed]) > .items:empty::before {
            content: '${t('loadingPlaylist')}';
            background-color: #626262;
            padding: 0.8rem;
            color: white;
            font-size: 2rem;
            display: block;
        }
        
        .ytpa-playlist-emulator[data-failed="rejected"] > .items:empty::before {
            content: "${t('externalApiWarning')}";
            background-color: #491818;
            padding: 0.8rem;
            color: #ff7c7c;
            font-size: 1rem;
            display: block;
        }
        
        .ytpa-playlist-emulator > .items > .item {
            background-color: #2c2c2c;
            padding: 0.8rem;
            border: 1px solid #1b1b1b;
            font-size: 1.6rem;
            color: white;
            min-height: 5rem;
            cursor: pointer;
        }
        
        .ytpa-playlist-emulator > .items > .item:hover {
            background-color: #505050;
        }
        
        .ytpa-playlist-emulator > .items > .item:not(:last-of-type) {
            border-bottom: 0;
        }
        
        .ytpa-playlist-emulator > .items > .item[data-current] {
            background-color: #767676;
        }
        
    /* Replace :has(.ytpa-playlist-emulator) with a body class set by JS to support Firefox */
    body.ytpa-has-emulator .ytp-prev-button.ytp-button,
    body.ytpa-has-emulator .ytp-next-button.ytp-button:not([ytpa-emulation="applied"]) {
      display: none !important;
    }
        
        /* hide when sorting by oldest */
        ytm-feed-filter-chip-bar-renderer > div :nth-child(3).selected ~ .ytpa-btn:not(.ytpa-unsupported), ytd-feed-filter-chip-bar-renderer iron-selector#chips :nth-child(3).iron-selected ~ .ytpa-btn:not(.ytpa-unsupported) {
            display: none;
        }
    </style>`
    );
  }

  const getVideoId = url => new URLSearchParams(new URL(url).search).get('v');

  /**
   * @return {{ getProgressState: () => { current: number, duration, number }, pauseVideo: () => void, seekTo: (number) => void, isLifaAdPlaying: () => boolean }} player
   */
  /**
   * Safe player accessor.
   * Returns either the native player element (if it exposes the expected API)
   * or a lightweight wrapper implementing the small API surface used by this
   * module. This prevents runtime/TS complaints when YouTube's player does not
   * expose the expected methods.
   */
  const getPlayer = () => {
    const playerEl = document.querySelector('#movie_player');
    if (!playerEl) return null;

    // If the player element already implements the methods we need, return it
    if (
      typeof playerEl.getProgressState === 'function' &&
      typeof playerEl.pauseVideo === 'function' &&
      typeof playerEl.seekTo === 'function' &&
      typeof playerEl.isLifaAdPlaying === 'function'
    ) {
      return playerEl;
    }

    // Otherwise return a safe wrapper that proxies to the HTML5 <video> where possible
    return {
      getProgressState: () => {
        try {
          const v = document.querySelector('video');
          if (v) return { current: v.currentTime || 0, duration: v.duration || 1, number: 0 };
        } catch {
          // ignore
        }
        return { current: 0, duration: 1, number: 0 };
      },
      pauseVideo: () => {
        try {
          const v = document.querySelector('video');
          if (v && typeof v.pause === 'function') v.pause();
        } catch {}
      },
      seekTo: sec => {
        try {
          const v = document.querySelector('video');
          if (v) v.currentTime = sec;
        } catch {}
      },
      isLifaAdPlaying: () => !!document.querySelector('.ad-interrupting'),
    };
  };

  const isAdPlaying = () => !!document.querySelector('.ad-interrupting');

  const redirect = (v, list, ytpaRandom = null) => {
    if (location.host === 'm.youtube.com') {
      // TODO: Client side routing on mobile
    } else {
      const redirector = document.createElement('a');
      redirector.className = 'yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer';
      redirector.setAttribute('hidden', '');
      redirector.data = {
        commandMetadata: {
          webCommandMetadata: {
            url: `/watch?v=${v}&list=${list}${ytpaRandom !== null ? `&ytpa-random=${ytpaRandom}` : ''}`,
            webPageType: 'WEB_PAGE_TYPE_WATCH',
            rootVe: 3832, // ??? required though
          },
        },
        watchEndpoint: {
          videoId: v,
          playlistId: list,
        },
      };
      document.querySelector('ytd-playlist-panel-renderer #items').append(redirector);
      redirector.click();
    }
  };

  let id = '';
  const apply = () => {
    if (id === '') {
      // do not apply prematurely, caused by mutation observer
      return;
    }

    let parent =
      location.host === 'm.youtube.com'
        ? // mobile view
          document.querySelector(
            'ytm-feed-filter-chip-bar-renderer .chip-bar-contents, ytm-feed-filter-chip-bar-renderer > div'
          )
        : // desktop view
          document.querySelector('ytd-feed-filter-chip-bar-renderer iron-selector#chips');

    // #5: add a custom container for buttons if Latest/Popular/Oldest is missing
    if (parent === null) {
      const grid = document.querySelector('ytd-rich-grid-renderer, ytm-rich-grid-renderer');
      if (grid instanceof HTMLElement) {
        grid.insertAdjacentHTML('afterbegin', '<div class="ytpa-button-container"></div>');
        const maybe = grid.querySelector('.ytpa-button-container');
        parent = maybe instanceof HTMLElement ? maybe : null;
      }
    }

    // See: available-lists.md
    const [allPlaylist, popularPlaylist] = window.location.pathname.endsWith('/videos')
      ? // Normal videos
        // list=UULP has the all videos sorted by popular
        // list=UU<ID> adds shorts into the playlist, list=UULF<ID> has videos without shorts
        ['UULF', 'UULP']
      : // Shorts
        window.location.pathname.endsWith('/shorts')
        ? ['UUSH', 'UUPS']
        : // Live streams
          ['UULV', 'UUPV'];

    // Check if popular videos are displayed
    if (parent.querySelector(':nth-child(2).selected, :nth-child(2).iron-selected')) {
      parent.insertAdjacentHTML(
        'beforeend',
        `<a class="ytpa-btn ytpa-play-all-btn" href="/playlist?list=${popularPlaylist}${id}&playnext=1">${t('playPopular')}</a>`
      );
    } else if (parent.querySelector(':nth-child(1).selected, :nth-child(1).iron-selected')) {
      parent.insertAdjacentHTML(
        'beforeend',
        `<a class="ytpa-btn ytpa-play-all-btn" href="/playlist?list=${allPlaylist}${id}&playnext=1">${t('playAll')}</a>`
      );
    } else {
      parent.insertAdjacentHTML(
        'beforeend',
        `<a class="ytpa-btn ytpa-play-all-btn ytpa-unsupported" href="https://github.com/RobertWesner/YouTube-Play-All/issues/39" target="_blank">No Playlist Found</a>`
      );
    }

    if (location.host === 'm.youtube.com') {
      // YouTube returns an "invalid response" when using client side routing for playnext=1 on mobile
      document.querySelectorAll('.ytpa-btn').forEach(btn =>
        btn.addEventListener('click', event => {
          event.preventDefault();

          window.location.href = btn.href;
        })
      );
    } else {
      // Only allow random play in desktop version for now
      parent.insertAdjacentHTML(
        'beforeend',
        `
                <span class="ytpa-btn ytpa-random-btn ytpa-btn-sections">
                    <a class="ytpa-btn-section" href="/playlist?list=${allPlaylist}${id}&playnext=1&ytpa-random=random&ytpa-random-initial=1">
                        ${t('playRandom')}
                    </a><!--
                    --><span class="ytpa-btn-section ytpa-random-more-options-btn ytpa-hover-popover">
                        &#x25BE
                    </span>
                </span>
            `
      );

      document.body.insertAdjacentHTML(
        'beforeend',
        `
                <div class="ytpa-random-popover" hidden="">
                    <a href="/playlist?list=${allPlaylist}${id}&playnext=1&ytpa-random=prefer-newest">
                        ${t('preferNewest')}
                    </a>
                    <a href="/playlist?list=${allPlaylist}${id}&playnext=1&ytpa-random=prefer-oldest&ytpa-random-initial=1">
                        ${t('preferOldest')}
                    </a>
                </div>
            `
      );

      const randomMoreOptionsBtn = document.querySelector('.ytpa-random-more-options-btn');
      const randomPopover = document.querySelector('.ytpa-random-popover');
      randomMoreOptionsBtn.addEventListener('click', () => {
        const rect = randomMoreOptionsBtn.getBoundingClientRect();
        randomPopover.style.top = rect.bottom.toString() + 'px';
        randomPopover.style.left = rect.right.toString() + 'px';
        randomPopover.removeAttribute('hidden');
      });
      randomPopover.addEventListener('mouseleave', () => {
        randomPopover.setAttribute('hidden', '');
      });
    }
  };

  const observer = new MutationObserver(() => {
    // [20250929-0] removeButton first and then apply, not addButton, since we don't need the pathname validation, and we want mobile to also use it
    removeButton();
    apply();
  });

  const addButton = async () => {
    observer.disconnect();

    if (
      !(
        window.location.pathname.endsWith('/videos') ||
        window.location.pathname.endsWith('/shorts') ||
        window.location.pathname.endsWith('/streams')
      )
    ) {
      return;
    }

    // Regenerate button if switched between Latest and Popular
    const element = document.querySelector(
      'ytd-rich-grid-renderer, ytm-feed-filter-chip-bar-renderer .iron-selected, ytm-feed-filter-chip-bar-renderer .chip-bar-contents .selected'
    );
    if (element) {
      observer.observe(element, {
        attributes: true,
        childList: false,
        subtree: false,
      });
    }

    // This check is necessary for the mobile Interval
    if (document.querySelector('.ytpa-play-all-btn')) {
      return;
    }

    const html = await (await fetch(location.href)).text();
    const i =
      html.indexOf('<link rel="canonical" href="https://www.youtube.com/channel/UC') +
      60 +
      2; /* ID starts with "UC" */
    id = html.substring(i, i + 22);

    // Initially generate button
    apply();
  };

  // Removing the button prevents it from still existing when switching between "Videos", "Shorts", and "Live"
  // This is necessary due to the mobile Interval requiring a check for an already existing button
  const removeButton = () =>
    document.querySelectorAll('.ytpa-btn').forEach(element => element.remove());

  if (location.host === 'm.youtube.com') {
    // The "yt-navigate-finish" event does not fire on mobile
    // Unfortunately pushState is triggered before the navigation occurs, so a Proxy is useless
    setInterval(addButton, 1000);
  } else {
    window.addEventListener('yt-navigate-start', removeButton);
    window.addEventListener('yt-navigate-finish', addButton);
  }

  // Fallback playlist emulation
  (() => {
    const getItems = playlist => {
      return new Promise(resolve => {
        // Prefer GM_safe.xmlHttpRequest when available (userscripts), otherwise use fetch
        if (typeof GM_safe !== 'undefined' && GM_safe?.xmlHttpRequest) {
          try {
            GM_safe.xmlHttpRequest({
              method: 'POST',
              url: 'https://ytplaylist.robert.wesner.io/api/list',
              data: JSON.stringify({
                uri: `https://www.youtube.com/playlist?list=${playlist}`,
                requestType: `YTPA ${scriptVersion || 'unknown'}`,
              }),
              headers: {
                'Content-Type': 'application/json',
              },
              onload: response => {
                resolve(JSON.parse(response.responseText));
              },
              onerror: () => {
                document
                  .querySelector('.ytpa-playlist-emulator')
                  ?.setAttribute('data-failed', 'rejected');
                resolve([]);
              },
            });
            return;
          } catch (err) {
            console.warn('[YTPA] GM_safe.xmlHttpRequest failed, falling back to fetch', err);
          }
        }

        // Fetch fallback for non-userscript environments
        fetch('https://ytplaylist.robert.wesner.io/api/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uri: `https://www.youtube.com/playlist?list=${playlist}`,
            requestType: `YTPA ${scriptVersion || 'unknown'}`,
          }),
        })
          .then(r => r.json())
          .then(json => resolve(json))
          .catch(() => {
            document
              .querySelector('.ytpa-playlist-emulator')
              ?.setAttribute('data-failed', 'rejected');
            resolve([]);
          });
      });
    };

    const processItems = items => {
      const itemsContainer = document.querySelector('.ytpa-playlist-emulator .items');
      const params = new URLSearchParams(window.location.search);
      const list = params.get('list');

      items.forEach(
        /**
         * @param {{
         *  position: number,
         *  title: string,
         *  videoId: string,
         * }} item
         */
        item => {
          const element = document.createElement('div');
          element.className = 'item';
          element.textContent = item.title;
          element.setAttribute('data-id', item.videoId);
          element.addEventListener('click', () => redirect(item.videoId, list));

          itemsContainer.append(element);
        }
      );

      markCurrentItem(params.get('v'));
    };

    const playNextEmulationItem = () => {
      document.querySelector(`.ytpa-playlist-emulator .items .item[data-current] + .item`)?.click();
    };

    const markCurrentItem = videoId => {
      const existing = document.querySelector(`.ytpa-playlist-emulator .items .item[data-current]`);
      if (existing) {
        existing.removeAttribute('data-current');
      }

      const current = document.querySelector(
        `.ytpa-playlist-emulator .items .item[data-id="${videoId}"]`
      );
      if (current && current.parentElement) {
        current.setAttribute('data-current', '');
        // Type assertion: getComputedStyle accepts Element (HTMLElement extends Element)
        const docElement = /** @type {Element} */ (
          /** @type {unknown} */ (document.documentElement)
        );
        const fontSize = parseFloat(window.getComputedStyle(docElement).fontSize || '16');
        current.parentElement.scrollTop = current.offsetTop - 12 * fontSize;
      }
    };

    const emulatePlaylist = () => {
      if (!window.location.pathname.endsWith('/watch')) {
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const list = params.get('list');
      if (params.has('ytpa-random')) {
        return;
      }

      // prevent playlist emulation on queue
      // its impossible to fetch that playlist externally anyway
      // https://github.com/RobertWesner/YouTube-Play-All/issues/33
      if (list.startsWith('TLPQ')) {
        return;
      }

      // No user ID in the list, cannot be fetched externally -> no emulation
      if (list.length <= 4) {
        return;
      }

      const existingEmulator = document.querySelector('.ytpa-playlist-emulator');
      if (existingEmulator) {
        if (list === existingEmulator.getAttribute('data-list')) {
          markCurrentItem(params.get('v'));

          return;
        } else {
          // necessary to lose all the client side manipulations like SHIFT + N and the play next button
          window.location.reload();
        }
      }

      if (!new URLSearchParams(window.location.search).has('list')) {
        return;
      }

      if (
        !document.querySelector(
          '#secondary-inner > ytd-playlist-panel-renderer#playlist #items:empty'
        )
      ) {
        return;
      }

      const playlistEmulator = document.createElement('div');
      playlistEmulator.className = 'ytpa-playlist-emulator';
      playlistEmulator.innerHTML = `
                <div class="title">
                    Playlist emulator
                </div>
                <div class="information">
                    It looks like YouTube is unable to handle this large playlist.
                    Playlist emulation is a <b>limited</b> fallback feature of YTPA to enable you to watch even more content. <br>
                </div>
                <div class="items"></div>
                <div class="footer"></div>
            `;
      playlistEmulator.setAttribute('data-list', list);
      const playlistPanel = document.querySelector(
        '#secondary-inner > ytd-playlist-panel-renderer#playlist'
      );
      if (playlistPanel && playlistPanel.parentNode) {
        playlistPanel.parentNode.insertBefore(playlistEmulator, playlistPanel.nextSibling);
        // Signal to CSS that an emulator exists (used instead of :has() for Firefox)
        document.body.classList.add('ytpa-has-emulator');
      }

      getItems(list).then(response => {
        if (response.status === 'running') {
          setTimeout(() => getItems(list).then(response => processItems(response.items)), 5000);

          return;
        }

        processItems(response.items);
      });

      const nextButtonInterval = setInterval(() => {
        const nextButton = document.querySelector(
          '#ytd-player .ytp-next-button.ytp-button:not([ytpa-emulation="applied"])'
        );
        if (nextButton) {
          clearInterval(nextButtonInterval);

          // Replace with span to prevent anchor click events
          const newButton = document.createElement('span');
          newButton.className = nextButton.className;
          newButton.innerHTML = nextButton.innerHTML;
          nextButton.replaceWith(newButton);

          newButton.setAttribute('ytpa-emulation', 'applied');
          newButton.addEventListener('click', () => playNextEmulationItem());
        }
      }, 1000);

      document.addEventListener(
        'keydown',
        event => {
          // SHIFT + N
          if (event.shiftKey && event.key.toLowerCase() === 'n') {
            event.stopImmediatePropagation();
            event.preventDefault();

            playNextEmulationItem();
          }
        },
        true
      );

      setInterval(() => {
        const player = getPlayer();
        const progressState = player.getProgressState();

        // Do not listen for watch progress when watching advertisements
        if (!isAdPlaying()) {
          // Autoplay random video
          if (progressState.current >= progressState.duration - 2) {
            // make sure vanilla autoplay doesnt take over
            player.pauseVideo();
            player.seekTo(0);
            playNextEmulationItem();
          }
        }
      }, 500);
    };

    if (location.host === 'm.youtube.com') {
      // TODO: mobile playlist emulation
    } else {
      window.addEventListener('yt-navigate-finish', () => setTimeout(emulatePlaylist, 1000));
      // Remove emulator body class on navigation start to ensure styles update
      window.addEventListener('yt-navigate-start', () => {
        document.body.classList.remove('ytpa-has-emulator');
      });
    }
  })();

  // Random play feature
  (() => {
    // Random play is not supported for mobile devices
    if (location.host === 'm.youtube.com') {
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);

    if (!urlParams.has('ytpa-random') || urlParams.get('ytpa-random') === '0') {
      return;
    }

    /**
     * @type {'random'|'prefer-newest'|'prefer-oldest'}
     */
    const ytpaRandom = /** @type {'random'|'prefer-newest'|'prefer-oldest'} */ (
      urlParams.get('ytpa-random')
    );

    const getStorageKey = () => `ytpa-random-${urlParams.get('list')}`;
    const getStorage = () => JSON.parse(localStorage.getItem(getStorageKey()) || '{}');

    const isWatched = videoId => getStorage()[videoId] || false;
    const markWatched = videoId => {
      localStorage.setItem(getStorageKey(), JSON.stringify({ ...getStorage(), [videoId]: true }));
      document
        .querySelectorAll('#wc-endpoint[href*=zsA3X40nz9w]')
        .forEach(element => element.parentElement.setAttribute('hidden', ''));
    };

    // Storage needs to now be { [videoId]: bool }
    try {
      if (Array.isArray(getStorage())) {
        localStorage.removeItem(getStorageKey());
      }
    } catch {
      localStorage.removeItem(getStorageKey());
    }

    const playNextRandom = (reload = false) => {
      getPlayer().pauseVideo();

      const videos = Object.entries(getStorage()).filter(([_, watched]) => !watched);
      const params = new URLSearchParams(window.location.search);

      // Either one fifth or at most the 20 newest.
      const preferenceRange = Math.min(Math.min(videos.length * 0.2, 20));

      let videoIndex;
      switch (ytpaRandom) {
        case 'prefer-newest':
          // Select between latest 20 videos
          videoIndex = Math.floor(Math.random() * preferenceRange);

          break;
        case 'prefer-oldest':
          // Select between oldest 20 videos
          videoIndex = videos.length - Math.floor(Math.random() * preferenceRange);

          break;
        default:
          videoIndex = Math.floor(Math.random() * videos.length);
      }

      if (reload) {
        params.set('v', videos[videoIndex][0]);
        params.set('ytpa-random', ytpaRandom);
        params.delete('t');
        params.delete('index');
        params.delete('ytpa-random-initial');
        window.location.href = `${window.location.pathname}?${params.toString()}`;
      } else {
        // TODO: refactor to the new redirect() function
        const redirector = document.createElement('a');
        redirector.className = 'yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer';
        redirector.setAttribute('hidden', '');
        redirector.data = {
          commandMetadata: {
            webCommandMetadata: {
              url: `/watch?v=${videos[videoIndex][0]}&list=${params.get('list')}&ytpa-random=${ytpaRandom}`,
              webPageType: 'WEB_PAGE_TYPE_WATCH',
              rootVe: 3832, // ??? required though
            },
          },
          watchEndpoint: {
            videoId: videos[videoIndex][0],
            playlistId: params.get('list'),
          },
        };
        document.querySelector('ytd-playlist-panel-renderer #items').append(redirector);
        redirector.click();
      }
    };

    let isIntervalSet = false;

    const applyRandomPlay = () => {
      if (!window.location.pathname.endsWith('/watch')) {
        return;
      }

      const playlistContainer = document.querySelector('#secondary ytd-playlist-panel-renderer');
      if (playlistContainer === null) {
        return;
      }
      if (playlistContainer.hasAttribute('ytpa-random')) {
        return;
      }

      playlistContainer.setAttribute('ytpa-random', 'applied');
      // Signal to CSS that random mode is active (used instead of :has() for Firefox)
      document.body.classList.add('ytpa-has-random');
      playlistContainer.querySelector('.header').insertAdjacentHTML(
        'afterend',
        `
                <div class="ytpa-random-notice">
                    This playlist is using random play.<br>
                    The videos will <strong>not be played in the order</strong> listed here.
                </div>
            `
      );

      const storage = getStorage();
      playlistContainer.querySelectorAll('#wc-endpoint').forEach(element => {
        const videoId = new URLSearchParams(new URL(element.href).searchParams).get('v');
        if (!isWatched(videoId)) {
          storage[videoId] = false;
        }

        element.href += '&ytpa-random=' + ytpaRandom;
        // This bypasses the client side routing
        element.addEventListener('click', event => {
          event.preventDefault();

          window.location.href = element.href;
        });

        const entryKey = getVideoId(element.href);
        if (isWatched(entryKey)) {
          element.parentElement.setAttribute('hidden', '');
        }
      });
      localStorage.setItem(getStorageKey(), JSON.stringify(storage));

      if (urlParams.get('ytpa-random-initial') === '1' || isWatched(getVideoId(location.href))) {
        playNextRandom();

        return;
      }

      const header = playlistContainer.querySelector('h3 a');
      header.innerHTML += ` <span class="ytpa-badge ytpa-random-badge">${ytpaRandom} <span style="font-size: 2rem; vertical-align: top">&times;</span></span>`;
      header.href = 'javascript:none';
      header.querySelector('.ytpa-random-badge').addEventListener('click', event => {
        event.preventDefault();

        localStorage.removeItem(getStorageKey());

        const params = new URLSearchParams(location.search);
        params.delete('ytpa-random');
        // Remove the body class before navigating away
        document.body.classList.remove('ytpa-has-random');
        window.location.href = `${window.location.pathname}?${params.toString()}`;
      });

      document.addEventListener(
        'keydown',
        event => {
          // SHIFT + N
          if (event.shiftKey && event.key.toLowerCase() === 'n') {
            event.stopImmediatePropagation();
            event.preventDefault();

            const videoId = getVideoId(location.href);
            markWatched(videoId);
            // Unfortunately there is no workaround to YouTube redirecting to the next in line without a reload
            playNextRandom(true);
          }
        },
        true
      );

      if (isIntervalSet) {
        return;
      }
      isIntervalSet = true;

      setInterval(() => {
        const videoId = getVideoId(location.href);

        const params = new URLSearchParams(location.search);
        params.set('ytpa-random', ytpaRandom);
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

        const player = getPlayer();
        const progressState = player.getProgressState();

        // Do not listen for watch progress when watching advertisements
        if (!isAdPlaying()) {
          if (progressState.current / progressState.duration >= 0.9) {
            markWatched(videoId);
          }

          // Autoplay random video
          if (progressState.current >= progressState.duration - 2) {
            // make sure vanilla autoplay doesnt take over
            player.pauseVideo();
            player.seekTo(0);
            playNextRandom();
          }
        }

        const nextButton = document.querySelector(
          '#ytd-player .ytp-next-button.ytp-button:not([ytpa-random="applied"])'
        );
        if (nextButton) {
          // Replace with span to prevent anchor click events
          const newButton = document.createElement('span');
          newButton.className = nextButton.className;
          newButton.innerHTML = nextButton.innerHTML;
          nextButton.replaceWith(newButton);

          newButton.setAttribute('ytpa-random', 'applied');
          newButton.addEventListener('click', _event => {
            markWatched(videoId);
            playNextRandom();
          });
        }
      }, 1000);
    };

    setInterval(applyRandomPlay, 1000);
  })();
})().catch(error => {
  // Only log critical errors
  if (typeof console !== 'undefined' && console.error) {
    console.error(
      '%cYTPA - YouTube Play All\n',
      'color: #bf4bcc; font-size: 32px; font-weight: bold',
      error
    );
  }
});
