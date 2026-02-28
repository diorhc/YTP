// YouTube End Screen Remover
(function () {
  'use strict';

  // DOM helpers
  const _getDOMCache = () => typeof window !== 'undefined' && window.YouTubeDOMCache;
  const $ = (sel, ctx) =>
    _getDOMCache()?.querySelector(sel, ctx) || (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) =>
    _getDOMCache()?.querySelectorAll(sel, ctx) ||
    Array.from((ctx || document).querySelectorAll(sel));
  const onDomReady = (() => {
    let ready = document.readyState !== 'loading';
    const queue = [];
    const run = () => {
      ready = true;
      while (queue.length) {
        const cb = queue.shift();
        try {
          cb();
        } catch {}
      }
    };
    if (!ready) document.addEventListener('DOMContentLoaded', run, { once: true });
    return cb => {
      if (ready) cb();
      else queue.push(cb);
    };
  })();

  // Optimized configuration
  const CONFIG = {
    enabled: true,
    storageKey: 'youtube_endscreen_settings',
    // Added .teaser-carousel to cover variants named 'teaser-carousel'
    selectors:
      '.ytp-ce-element-show,.ytp-ce-element,.ytp-endscreen-element,.ytp-ce-covering-overlay,.ytp-cards-teaser,.teaser-carousel,.ytp-cards-button,.iv-drawer,.iv-branding,.video-annotations,.ytp-cards-teaser-text',
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
      if (window.YouTubeUtils?.debounce) {
        return window.YouTubeUtils.debounce(fn, ms);
      }
      let id;
      return (...args) => {
        clearTimeout(id);
        id = setTimeout(() => fn(...args), ms);
      };
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

    const styles = `${CONFIG.selectors}{display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;transform:scale(0)!important}`;
    YouTubeUtils.StyleManager.add('end-screen-remover', styles);
    // store the style id so it can be removed via StyleManager.remove
    state.styleEl = 'end-screen-remover';
  };

  const removeEndScreens = () => {
    if (!CONFIG.enabled) return;
    const now = performance.now();
    if (now - state.lastCheck < CONFIG.debounceMs) return;
    state.lastCheck = now;

    const elements = $$(CONFIG.selectors);
    if (elements.length) fastRemove(elements);
  };

  const getClassNameValue = node => {
    if (typeof node.className === 'string') {
      return node.className;
    }
    if (node.className && typeof node.className === 'object' && 'baseVal' in node.className) {
      return /** @type {any} */ (node.className).baseVal;
    }
    return '';
  };

  /**
   * Check if node is relevant for end screen removal
   * @param {Node} node - DOM node to check
   * @returns {boolean} True if relevant
   */
  const isRelevantNode = node => {
    if (!(node instanceof Element)) return false;

    const classNameValue = getClassNameValue(node);
    return classNameValue.includes('ytp-') || node.querySelector?.('.ytp-ce-element');
  };

  /**
   * Check if mutations contain relevant changes
   * @param {MutationRecord[]} mutations - Mutation records
   * @returns {boolean} True if has relevant changes
   */
  const hasRelevantChanges = mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (isRelevantNode(node)) return true;
      }
    }
    return false;
  };

  /**
   * Create mutation observer for end screens
   * @param {Function} throttledRemove - Throttled remove function
   * @returns {MutationObserver} Observer instance
   */
  const createEndScreenObserver = throttledRemove => {
    return new MutationObserver(mutations => {
      if (hasRelevantChanges(mutations)) {
        throttledRemove();
      }
    });
  };

  /**
   * Setup watcher for end screens
   * @returns {void}
   */
  const setupWatcher = () => {
    if (state.observer || !CONFIG.enabled) return;

    const throttledRemove = debounce(removeEndScreens, CONFIG.debounceMs);
    state.observer = createEndScreenObserver(throttledRemove);

    YouTubeUtils.cleanupManager.registerObserver(state.observer);

    const target = $('#movie_player') || document.body;
    state.observer.observe(target, {
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'style'],
    });
  };

  const cleanup = () => {
    state.observer?.disconnect();
    state.observer = null;
    if (state.styleEl) {
      try {
        YouTubeUtils.StyleManager.remove(state.styleEl);
      } catch {}
    }
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

  const setupEndscreenSettingsDelegation = (() => {
    let attached = false;
    return () => {
      if (attached) return;
      attached = true;

      const delegator = window.YouTubePlusEventDelegation;
      const handler = (ev, target) => {
        const input = /** @type {HTMLInputElement | null} */ (target);
        if (!input) return;
        if (!input.classList?.contains('ytp-plus-settings-checkbox')) return;
        if (!input.closest?.('.endscreen-settings')) return;
        CONFIG.enabled = input.checked;
        settings.save();
        void ev;
      };

      if (delegator?.on) {
        delegator.on(
          document,
          'change',
          '.endscreen-settings .ytp-plus-settings-checkbox',
          handler,
          { passive: true }
        );
      } else {
        document.addEventListener(
          'change',
          ev => {
            const target = ev.target?.closest?.('.ytp-plus-settings-checkbox');
            if (target) handler(ev, target);
          },
          { passive: true, capture: true }
        );
      }
    };
  })();

  // Streamlined settings UI
  const addSettingsUI = () => {
    const enhancedSlot = $('.endscreen-settings-slot');
    const enhancedCard = $('.enhanced-submenu .glass-card');
    const host = enhancedSlot || enhancedCard;
    if (!host || $('.endscreen-settings', host)) return;

    const container = document.createElement('div');
    container.className = 'ytp-plus-settings-item endscreen-settings';
    container.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">${YouTubeUtils.t('endscreenHideLabel')}</label>
          <div class="ytp-plus-settings-item-description">${YouTubeUtils.t('endscreenHideDesc')}${state.removeCount ? ` (${state.removeCount} ${YouTubeUtils.t('removedSuffix').replace('{n}', '')?.trim() || 'removed'})` : ''}</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" ${CONFIG.enabled ? 'checked' : ''}>
      `;

    if (enhancedSlot) {
      enhancedSlot.replaceWith(container);
    } else {
      host.appendChild(container);
    }
    setupEndscreenSettingsDelegation();
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

  onDomReady(init);

  const handleSettingsNavClick = e => {
    const { target } = /** @type {{ target: HTMLElement }} */ (e);
    if (target?.dataset?.section === 'advanced') {
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

  // Settings modal integration — use event instead of MutationObserver
  const settingsModalHandler = () => setTimeout(addSettingsUI, 25);
  document.addEventListener('youtube-plus-settings-modal-opened', settingsModalHandler);

  if (!state.settingsNavListenerKey) {
    state.settingsNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'click',
      handleSettingsNavClick,
      { passive: true, capture: true }
    );
  }
})();
