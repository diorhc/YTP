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

  // High-performance utilities
  const debounce = (fn, ms) => {
    let id;
    return (...args) => {
      clearTimeout(id);
      id = setTimeout(() => fn(...args), ms);
    };
  };

  const fastRemove = (elements) => {
    const len = Math.min(elements.length, CONFIG.batchSize);
    for (let i = 0; i < len; i++) {
      const el = elements[i];
      if (el?.isConnected) {
        el.style.cssText = 'display:none!important;visibility:hidden!important';
        try {
          el.remove();
          state.removeCount++;
        } catch (e) {}
      }
    }
  };

  // Settings with caching
  const settings = {
    load: () => {
      try {
        const data = localStorage.getItem(CONFIG.storageKey);
        CONFIG.enabled = data ? (JSON.parse(data).enabled ?? true) : true;
      } catch (e) {
        CONFIG.enabled = true;
      }
    },

    save: () => {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({ enabled: CONFIG.enabled }));
      } catch (e) {}
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

    state.observer = new MutationObserver((mutations) => {
      let hasRelevantChanges = false;
      for (const { addedNodes } of mutations) {
        for (const node of addedNodes) {
          if (
            node.nodeType === 1 &&
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
      (e) => {
        CONFIG.enabled = e.target.checked;
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

  const handleSettingsNavClick = (e) => {
    if (e.target.dataset?.section === 'advanced') {
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
  const settingsObserver = new MutationObserver((mutations) => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addSettingsUI, 25);
          return;
        }
      }
    }
  });

  // ✅ Register observer in cleanupManager
  YouTubeUtils.cleanupManager.registerObserver(settingsObserver);
  settingsObserver.observe(document.body, { childList: true });

  if (!state.settingsNavListenerKey) {
    state.settingsNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'click',
      handleSettingsNavClick,
      { passive: true, capture: true }
    );
  }
})();
