// YouTube End Screen Remover.
//
// Responsibility: hide and remove YouTube's end-screen cards and overlays
//   while the `endscreen` setting is on.
// Public surface: window.YouTubePlusEndscreen (test hooks only).
(function () {
  const U = window.YouTubeUtils;
  const { $, $$ } = U || {};
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'Endscreen');

  const CONFIG = {
    // Includes the `.teaser-carousel` variant alongside the other card overlays.
    selectors:
      '.ytp-ce-element-show,.ytp-ce-element,.ytp-endscreen-element,.ytp-ce-covering-overlay,.ytp-cards-teaser,.teaser-carousel,.ytp-cards-button,.iv-drawer,.iv-branding,.video-annotations,.ytp-cards-teaser-text',
    debounceMs: 32,
    batchSize: 20,
  };
  const STYLE_ID = 'end-screen-remover';
  const SETTINGS_KEY = 'endscreen';

  const state = {
    removeCount: 0,
    lastCheck: 0,
  };

  /** @type {YouTubePlusFeatureContext | null} */
  let endCtx = null;

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
        } catch (_e) {
          logS(_e);
        }
      }
    }
  };

  /**
   * Remove end-screen elements from the DOM while the feature runs.
   * @param {{ force?: boolean }} [opts] - `force` bypasses the debounce guard
   *   (the initial pass in start and programmatic calls).
   */
  const removeEndScreens = opts => {
    if (!endCtx) return;
    if (!opts?.force) {
      const now = performance.now();
      if (now - state.lastCheck < CONFIG.debounceMs) return;
      state.lastCheck = now;
    }

    const elements = $$(CONFIG.selectors);
    if (elements.length) fastRemove(/** @type {HTMLElement[]} */ (elements));
  };

  /**
   * The DOM exposes `className` as a string on HTML elements and as an
   * `SVGAnimatedString` on SVG elements. In Firefox some nodes have
   * `className === undefined`.
   * @param {{ className?: string | SVGAnimatedString }} node
   * @returns {string}
   */
  const getClassNameValue = node => {
    const className = node?.className;
    if (typeof className === 'string') return className;
    if (className && typeof className === 'object' && 'baseVal' in className) {
      return className.baseVal || '';
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
    return Boolean(classNameValue.includes('ytp-') || node.querySelector?.('.ytp-ce-element'));
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
   * Watch the player for new end-screen elements; owned by the feature.
   * @param {YouTubePlusFeatureContext} ctx
   */
  const watchPlayer = ctx => {
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (!coordinator?.subscribeRoot) return;

    /** @type {(() => void) | null} */
    let pending = null;
    const scheduleRemove = () => {
      if (pending) return;
      pending = ctx.timeout(() => {
        pending = null;
        removeEndScreens();
      }, CONFIG.debounceMs);
    };

    const subId = 'endscreen::observer';
    coordinator.subscribeRoot(
      subId,
      /** @param {MutationRecord[]} mutations */ mutations => {
        if (hasRelevantChanges(mutations)) scheduleRemove();
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
    ctx.onDispose(() => coordinator.unsubscribe?.(subId));
    ctx.listen(document, 'yt-navigate-finish', scheduleRemove, { passive: true });
  };

  const endscreenFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'endscreen',
    settingsKey: SETTINGS_KEY,
    // End-screen overlays render inside the watch page's player only.
    routes: ['watch'],
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      endCtx = ctx;
      ctx.style(
        STYLE_ID,
        `${CONFIG.selectors}{display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;transform:scale(0)!important}`
      );
      removeEndScreens({ force: true });
      watchPlayer(ctx);
    },
    stop() {
      endCtx = null;
    },
  });

  // ----- Settings UI (works while the feature is off) -----

  const addSettingsUI = () => {
    const enhancedSlot = $('.endscreen-settings-slot');
    const enhancedCard = $('.enhanced-submenu .glass-card');
    const host = enhancedSlot || enhancedCard;
    if (!host || $('.endscreen-settings', /** @type {Element} */ (host))) return;

    const enabled = window.YouTubePlusSettingsStore?.get?.(SETTINGS_KEY) !== false;
    const container = document.createElement('div');
    container.className = 'yp-settings-item endscreen-settings';
    U.renderTemplateClone(
      container,
      `
        <div>
          <label class="yp-settings-item-label">${YouTubeUtils.t('endscreenHideLabel')}</label>
          <div class="yp-settings-item-description">${YouTubeUtils.t('endscreenHideDesc')}${state.removeCount ? ` (${state.removeCount} ${YouTubeUtils.t('removedSuffix').replace('{n}', '').trim()})` : ''}</div>
        </div>
        <input type="checkbox" class="yp-settings-checkbox" ${enabled ? 'checked' : ''}>
      `
    );

    if (enhancedSlot) {
      enhancedSlot.replaceWith(container);
    } else {
      host.appendChild(container);
    }
  };

  const cm = window.YouTubePlusCleanupManager;
  /** @param {() => void} fn @param {number} ms */
  const later = (fn, ms) => cm.timeout(fn, ms);

  window.YouTubePlusEventDelegation?.on?.(
    document,
    'change',
    '.endscreen-settings .yp-settings-checkbox',
    (/** @type {Event} */ _ev, /** @type {HTMLInputElement | null} */ target) => {
      if (target) window.YouTubePlusSettingsStore?.set?.(SETTINGS_KEY, target.checked);
    },
    { passive: true }
  );
  cm.registerListener(
    document,
    'youtube-plus-settings-modal-opened',
    () => later(addSettingsUI, 25),
    undefined,
    true
  );
  cm.registerListener(
    document,
    'click',
    (/** @type {Event} */ e) => {
      const target = /** @type {HTMLElement | null} */ (e.target);
      if (target?.dataset?.section === 'advanced') later(addSettingsUI, 10);
    },
    { passive: true, capture: true },
    true
  );

  window.YouTubePlusEndscreen = {};
  // Test-only surface: internal entry points and state accessors live here,
  // not on the facade root.
  U?.exposeTestHooks?.(window.YouTubePlusEndscreen, {
    CONFIG,
    state,
    removeEndScreens,
    isRelevantNode,
    getClassNameValue,
    fastRemove,
  });

  U.onDomReady(() => endscreenFeature?.sync());
})();
