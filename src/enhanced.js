// Enhanced Tabviews
(function () {
  'use strict';

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
        `;
    document.head.appendChild(style);
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
    button.title = 'Scroll to top';
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
          if (
            node instanceof Element &&
            (node.className?.includes('ytp-') || node.querySelector?.('.ytp-ce-element'))
          ) {
            hasRelevantChanges = true;
            break;
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
          <label class="ytp-plus-settings-item-label">Hide End Screens & Cards</label>
          <div class="ytp-plus-settings-item-description">Remove end screen suggestions and info cards${state.removeCount ? ` (${state.removeCount} removed)` : ''}</div>
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
      handlePageChange,
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
