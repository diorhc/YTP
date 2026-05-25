// YouTube End Screen Remover
(function () {
  'use strict';
  const renderTemplateClone = (/** @type {Element} */ container, /** @type {string} */ html) => {
    if (window.YouTubeSafeDOM?.renderTemplateClone) {
      window.YouTubeSafeDOM.renderTemplateClone(container, html);
      return;
    }
    if (!(container instanceof Element)) return;
    container.replaceChildren(document.createTextNode(String(html ?? '')));
  };

  // Shared DOM helpers from YouTubeUtils
  const { $, $$ } = window.YouTubeUtils || {};
  const onDomReady =
    window.YouTubeUtils?.onDomReady ||
    ((/** @type {() => void} */ cb) => {
      if (document.readyState !== 'loading') cb();
      else document.addEventListener('DOMContentLoaded', cb, { once: true });
    });

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
  /** @type {{ observerSubId: string | null, styleEl: string | null, isActive: boolean, removeCount: number, lastCheck: number, ytNavigateListenerKey: symbol | null, settingsNavListenerKey: symbol | null }} */
  const state = {
    observerSubId: null,
    styleEl: null,
    isActive: false,
    removeCount: 0,
    lastCheck: 0,
    ytNavigateListenerKey: null,
    settingsNavListenerKey: null,
  };

  // Shared debounce from YouTubeUtils
  const debounce = window.YouTubeUtils.debounce;

  /**
   * @param {HTMLElement[]} elements
   */
  const fastRemove = elements => {
    const len = Math.min(elements.length, CONFIG.batchSize);
    for (let i = 0; i < len; i++) {
      const el = elements[i];
      if (el?.isConnected) {
        el.style.display = 'none';
        el.style.visibility = 'hidden';
        try {
          el.remove();
          state.removeCount++;
        } catch (e) {
          // Non-critical, suppressed
        }
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
      } catch (e) {
        // Non-critical, suppressed
      }
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
    if (elements.length) fastRemove(/** @type {HTMLElement[]} */ (elements));
  };

  /**
   * @param {Element} node
   */
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
   * Setup watcher for end screens
   * @returns {void}
   */
  const setupWatcher = () => {
    if (state.observerSubId || !CONFIG.enabled) return;

    const throttledRemove = debounce(removeEndScreens, CONFIG.debounceMs);
    const coordinator = window.YouTubeMutationCoordinator;
    if (!coordinator?.subscribeRoot) return;

    state.observerSubId = 'endscreen::observer';
    coordinator.subscribeRoot(
      state.observerSubId,
      /** @param {MutationRecord[]} mutations */ mutations => {
        if (hasRelevantChanges(mutations)) {
          throttledRemove();
        }
      },
      {
        selector:
          '#movie_player, .ytp-ce-element, .ytp-endscreen-element, .ytp-cards-teaser, .ytp-cards-button, .iv-drawer, .iv-branding, .video-annotations',
        childList: true,
        attributes: true,
        subtree: true,
        attributeFilter: ['class', 'style'],
      }
    );

    YouTubeUtils.cleanupManager.register(() => {
      if (state.observerSubId) {
        coordinator.unsubscribe(state.observerSubId);
        state.observerSubId = null;
      }
    });

    // Initial check after the coordinator subscribes.
    throttledRemove();
  };

  const cleanup = () => {
    if (state.observerSubId && window.YouTubeMutationCoordinator?.unsubscribe) {
      window.YouTubeMutationCoordinator.unsubscribe(state.observerSubId);
    }
    state.observerSubId = null;
    if (state.styleEl) {
      try {
        YouTubeUtils.StyleManager.remove(state.styleEl);
      } catch (e) {
        // Non-critical, suppressed
      }
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
      const handler = (/** @type {Event} */ ev, /** @type {HTMLInputElement | null} */ target) => {
        if (!target) return;
        if (!target.classList?.contains('ytp-plus-settings-checkbox')) return;
        if (!target.closest?.('.endscreen-settings')) return;
        CONFIG.enabled = target.checked;
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
        const changeHandler = /** @param {Event} ev */ ev => {
          const target = /** @type {Element | null} */ (ev.target)?.closest?.(
            '.ytp-plus-settings-checkbox'
          );
          if (target) handler(ev, /** @type {HTMLInputElement} */ (target));
        };
        if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
          YouTubeUtils.cleanupManager.registerListener(document, 'change', changeHandler, {
            passive: true,
            capture: true,
          });
        } else {
          document.addEventListener('change', changeHandler, { passive: true, capture: true });
        }
      }
    };
  })();

  // Streamlined settings UI
  const addSettingsUI = () => {
    const enhancedSlot = $('.endscreen-settings-slot');
    const enhancedCard = $('.enhanced-submenu .glass-card');
    const host = enhancedSlot || enhancedCard;
    if (!host || $('.endscreen-settings', /** @type {Element} */ (host))) return;

    const container = document.createElement('div');
    container.className = 'ytp-plus-settings-item endscreen-settings';
    renderTemplateClone(
      container,
      `
        <div>
          <label class="ytp-plus-settings-item-label">${YouTubeUtils.t('endscreenHideLabel')}</label>
          <div class="ytp-plus-settings-item-description">${YouTubeUtils.t('endscreenHideDesc')}${state.removeCount ? ` (${state.removeCount} ${YouTubeUtils.t('removedSuffix').replace('{n}', '')?.trim() || 'removed'})` : ''}</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" ${CONFIG.enabled ? 'checked' : ''}>
      `
    );

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

  const isWatchOrShortsRoute = () => {
    const path = location.pathname || '';
    return path === '/watch' || path.startsWith('/shorts');
  };

  const isSettingsModalOpen = () => {
    try {
      return Boolean(document.querySelector('.ytp-plus-settings-modal'));
    } catch (e) {
      return false;
    }
  };

  let endscreenRuntimeStarted = false;
  const startEndscreenRuntime = () => {
    if (endscreenRuntimeStarted) return;
    endscreenRuntimeStarted = true;

    // Initialize
    settings.load();
    onDomReady(init);

    /** @param {Event} e */
    const handleSettingsNavClick = e => {
      const { target } = /** @type {{ target: HTMLElement }} */ (/** @type {unknown} */ (e));
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
    YouTubeUtils.cleanupManager.registerListener(
      document,
      'youtube-plus-settings-modal-opened',
      settingsModalHandler
    );

    if (!state.settingsNavListenerKey) {
      state.settingsNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
        document,
        'click',
        handleSettingsNavClick,
        { passive: true, capture: true }
      );
    }
  };

  if (window.YouTubePlusLazyLoader?.register) {
    window.YouTubePlusLazyLoader.register('end', startEndscreenRuntime, {
      priority: 35,
      delay: 0,
      shouldLoad: () => isWatchOrShortsRoute() || isSettingsModalOpen(),
    });
  } else {
    startEndscreenRuntime();
  }
})();
