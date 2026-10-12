// Enhanced Tabviews: tab-switching, description, and
//   engagement-panel orchestration for the YTP tabview overlay.
//
// Responsibility: DOM helpers shared across IIFEs (top-button click,
//   tab-button click, dislike-button restoration, inline-expander
//   state management). No public window symbol; consumes
//   YouTubeUtils.$/$$/byId/helpers at file scope.
// Public surface: window.YouTubePlusEnhanced.
const enhancedSetTimeout_ = setTimeout;
const { $, byId } = window.YouTubeUtils || {};
const onDomReady =
  window.YouTubeUtils?.onDomReady ||
  (cb => {
    if (typeof cb !== 'function') return;
    if (document.readyState === 'loading') {
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'DOMContentLoaded',
        cb,
        { once: true },
        true
      );
    } else {
      cb();
    }
  });
const enhancedLogger = window.YouTubeUtils?.logger || window.YouTubePlusLogger || null;
const U = window.YouTubeUtils;
const logSEnhanced = (
  /** @type {unknown} */ _err,
  /** @type {string|undefined} */ _label = undefined
) => U?.logSuppressed?.(_err, _label || 'Enhanced');

function isYouTubeHost_() {
  const host = typeof location === 'undefined' ? '' : location.hostname;
  return Boolean(host && (/(^|\.)youtube\.com$/.test(host) || /\.youtube\.google/.test(host)));
}

const withErrorBoundary = U?.createWithErrorBoundary?.('Enhanced') || (fn => fn);

// Public surface for testable helpers. Populated by the first IIFE below.
if (!window.YouTubePlusEnhanced) {
  window.YouTubePlusEnhanced = {};
}

// Enhanced Tabviews
(function () {
  const _setSafeHTML = U.setSafeHTML;
  const _getLanguage = U.getLanguage;

  // Shared translation helper from YouTubeUtils
  const t = U?.t || ((/** @type {string} */ key) => key || '');

  // Reusable SVG icon for scroll-to-top buttons
  const SCROLL_TOP_BUTTON_SVG =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

  // Reusable positioning styles for panel buttons
  const PANEL_BUTTON_POSITION = {
    position: 'absolute',
    bottom: '16px',
    right: '16px',
    zIndex: '1000',
  };

  const _debounce = U.debounce;

  const isTabviewEnabled = () => U?.loadFeatureEnabled?.('enableTabview') ?? true;

  // Scroll-to-top runs as a lifecycle feature (see FeatureLifecycle in
  // feature-registry.js). `topCtx` exists only while the feature runs; every
  // button owns a child scope, so removing one button releases exactly its
  // listeners, observers and timers, and stopping the feature releases all.
  /** @type {FeatureContext | null} */
  let topCtx = null;
  /** @type {FeatureScope | null} */
  let universalScope = null;
  /** @type {FeatureScope | null} */
  let musicSideScope = null;
  /** @type {FeatureScope | null} */
  let playlistScope = null;
  /** @type {FeatureScope | null} */
  let rightTabsScope = null;
  /** @type {FeatureScope | null} */
  let rightTabsScrollScope = null;

  /**
   * Replace a button scope: dispose the current scope and open a new child of
   * the running feature. Returns null when the feature is not running.
   * @type {(scope: FeatureScope | null) => FeatureScope | null}
   */
  const renewScope = previous => {
    previous?.dispose?.();
    return topCtx ? topCtx.scope() : null;
  };

  /** @type {Window | Element | Document | null} */
  let universalScrollContainer = null;

  // --- Shared Music/Studio container resolver ---
  // Caches results for a short TTL to avoid repeated DOM queries in hot paths.
  /** @type {Element[] | null} */
  let _musicContainersCache = null;
  let _musicContainersCacheTime = 0;
  const MUSIC_CACHE_TTL = 5000;

  /**
   * Resolves the primary YouTube Music scroll containers.
   * Result is cached for MUSIC_CACHE_TTL ms.
   * @returns {Element[]}
   */
  const resolveMusicContainers = () => {
    const now = Date.now();
    if (_musicContainersCache && now - _musicContainersCacheTime < MUSIC_CACHE_TTL) {
      return _musicContainersCache;
    }
    _musicContainersCache = /** @type {Element[]} */ (
      [
        $('ytmusic-app-layout #layout'),
        $('ytmusic-app-layout'),
        $('ytmusic-browse-response #contents'),
        $('ytmusic-section-list-renderer'),
      ].filter(Boolean)
    );
    _musicContainersCacheTime = now;
    return _musicContainersCache;
  };

  /** Invalidate music containers cache (call on SPA navigation) */
  const invalidateMusicContainersCache = () => {
    _musicContainersCache = null;
    _musicContainersCacheTime = 0;
  };

  const getUniversalScrollContainer = () => {
    const host = U?.getHostname?.() || '';
    const candidates = [];
    if (host === 'music.youtube.com') {
      // YouTube Music: use shared resolver + additional candidates
      const musicContainers = resolveMusicContainers();
      candidates.push(...musicContainers);
      candidates.push(
        $('ytmusic-tabbed-page #content'),
        $('ytmusic-app-layout #content'),
        $('#content'),
        $('ytmusic-app')
      );
    } else if (host === 'studio.youtube.com') {
      // YouTube Studio uses different layout containers
      candidates.push(
        $('ytcp-entity-page #scrollable-content'),
        $('ytcp-app #content'),
        $('#main-content'),
        $('#content'),
        $('#main'),
        $('ytcp-app')
      );
    }
    candidates.push(document.scrollingElement, document.documentElement, document.body);

    for (const el of candidates) {
      if (!el) continue;
      if (el.scrollHeight > el.clientHeight + 50) return el;
    }
    // Fallback: if no scrollable container found yet, return window-level
    // for music/studio since they may use window scroll
    if (host === 'music.youtube.com' || host === 'studio.youtube.com') {
      return document.scrollingElement || document.documentElement;
    }
    return document.scrollingElement || document.documentElement;
  };

  const removeUniversalButton = () => {
    universalScope?.dispose();
    universalScope = null;
    universalScrollContainer = null;
    // A stray button from an earlier page instance is not owned by any scope.
    byId('universal-top-button')?.remove();
  };

  /** @type {HTMLElement | null} */
  let musicSideScrollContainer = null;

  const isScrollable_ = (/** @type {HTMLElement | null} */ el) =>
    Boolean(el && el.scrollHeight > el.clientHeight + 30);

  const findScrollableInDirect_ = (/** @type {string[]} */ selectors) => {
    for (const sel of selectors) {
      const el = /** @type {HTMLElement | null} */ ($(sel));
      if (isScrollable_(el)) return el;
    }
    return null;
  };

  const findScrollableInRoots_ = (
    /** @type {Array<Element | null>} */ roots,
    /** @type {string[]} */ selectors
  ) => {
    for (const root of roots) {
      if (!root) continue;
      for (const sel of selectors) {
        const el = /** @type {HTMLElement | null} */ (root.querySelector(sel));
        if (isScrollable_(el)) return el;
      }
    }
    return null;
  };

  const getMusicSidePanelContainer = () => {
    if (!U?.isMusicDomain?.()) return null;

    const directSelectors = [
      'ytmusic-player-queue #contents',
      'ytmusic-player-queue',
      '#side-panel #contents',
      '#side-panel',
      'ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_QUEUE"] #contents',
      'ytmusic-queue #automix-contents',
      'ytmusic-queue #contents',
    ];
    const directMatch = findScrollableInDirect_(directSelectors);
    if (directMatch) return directMatch;

    const roots = [$('ytmusic-player-page'), $('ytmusic-app-layout'), $('ytmusic-app')];
    const selectors = [
      '#side-panel',
      '#right-content',
      'ytmusic-player-queue',
      'ytmusic-queue',
      'ytmusic-tab-renderer[selected] #contents',
      '.side-panel',
    ];
    return findScrollableInRoots_(roots, selectors);
  };

  const removeMusicSideButton = () => {
    musicSideScope?.dispose();
    musicSideScope = null;
    musicSideScrollContainer = null;
    byId('music-side-top-button')?.remove();
  };

  const removeRightTabsButton = () => {
    rightTabsScrollScope?.dispose();
    rightTabsScrollScope = null;
    rightTabsScope?.dispose();
    rightTabsScope = null;
    byId('right-tabs-top-button')?.remove();
  };

  const removePlaylistPanelButton = () => {
    playlistScope?.dispose();
    playlistScope = null;
    byId('playlist-panel-top-button')?.remove();
  };

  const cleanupTopButtons = () => {
    removeRightTabsButton();
    removePlaylistPanelButton();
    removeMusicSideButton();
    removeUniversalButton();
  };

  /** @type {string | null} */
  let tabChangesObserver = null;
  let watchInitToken = 0;
  /** @type {{ stop?: () => void } | null} */
  let tabCheckTimeoutId = null;
  /** @type {{ stop?: () => void } | null} */
  let playlistPanelCheckTimeoutId = null;

  const shouldInitReturnDislike = () =>
    (U?.isWatchPage?.() ?? false) || (U?.isShortsPage?.() ?? false);

  const isTopButton = (/** @type {Element | null} */ el) =>
    el &&
    (el.id === 'right-tabs-top-button' ||
      el.id === 'universal-top-button' ||
      el.id === 'playlist-panel-top-button' ||
      el.id === 'music-side-top-button');

  const smoothScrollTop = (/** @type {Element | Window} */ el) => {
    if ('scrollBehavior' in (document.documentElement.style || {})) {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    } else if ('scrollTop' in el) {
      el.scrollTop = 0;
    } else {
      el.scrollTo(0, 0);
    }
  };

  const scrollRightTabsToTop = (/** @type {HTMLElement} */ button) => {
    // Use a direct DOM query here: class-based selectors may be stale in the cache.
    const activeTab = $('#right-tabs .tab-content-cld:not(.tab-content-hidden)');
    const rightTabsEl = byId('right-tabs');
    // On single-column layout #right-tabs is the actual scroll host (overflow:auto),
    // so prefer scrolling it when it already has a positive scrollTop.
    const scrollTarget =
      rightTabsEl && rightTabsEl.scrollTop > 0
        ? rightTabsEl
        : activeTab && activeTab.scrollTop > 0
          ? activeTab
          : activeTab || rightTabsEl;
    if (scrollTarget) {
      smoothScrollTop(scrollTarget);
      button.setAttribute('aria-label', t('scrolledToTop'));
      enhancedSetTimeout_(() => {
        button.setAttribute('aria-label', t('scrollToTop'));
      }, 1000);
    }
  };

  const scrollUniversalToTop = () => {
    // Always re-detect container on Music/Studio since SPA navigation changes it
    const host = U?.getHostname?.() || '';
    const isMusic = host === 'music.youtube.com';
    const isStudio = host === 'studio.youtube.com';
    /** @type {Window | Element | Document | null} */
    const target =
      isMusic || isStudio
        ? getUniversalScrollContainer()
        : universalScrollContainer || getUniversalScrollContainer();

    if (
      target === window ||
      target === document ||
      target === document.body ||
      target === document.documentElement
    ) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (target && 'scrollTo' in target && typeof target.scrollTo === 'function') {
      smoothScrollTop(target);
    }

    // For YouTube Music: also scroll window and common inner containers
    if (isMusic) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      for (const c of resolveMusicContainers()) {
        if (c && c.scrollTop > 0) {
          smoothScrollTop(c);
        }
      }
    }
  };

  const scrollPlaylistPanelToTop = () => {
    const playlistPanel = $('ytd-playlist-panel-renderer');
    const scrollContainer = playlistPanel ? $('#items', playlistPanel) : null;
    if (scrollContainer) {
      smoothScrollTop(scrollContainer);
    }
  };

  const scrollMusicSideToTop = () => {
    // Always re-detect since panel content changes with navigation
    const target = getMusicSidePanelContainer() || musicSideScrollContainer;
    if (target) {
      smoothScrollTop(target);
    }
  };

  const handleTopButtonActivate = (/** @type {HTMLElement} */ button) => {
    if (!button) return;
    if (button.id === 'right-tabs-top-button') {
      scrollRightTabsToTop(button);
      return;
    }
    if (button.id === 'universal-top-button') {
      scrollUniversalToTop();
      return;
    }
    if (button.id === 'playlist-panel-top-button') {
      scrollPlaylistPanelToTop();
      return;
    }
    if (button.id === 'music-side-top-button') {
      scrollMusicSideToTop();
    }
  };
  /** @param {Event} _ev @param {Element} target */
  const onTopButtonClick = (_ev, target) => {
    if (target instanceof HTMLElement && isTopButton(target)) handleTopButtonActivate(target);
  };
  /** @param {Event} ev @param {Element} target */
  const onTopButtonKeydown = (ev, target) => {
    if (target instanceof HTMLElement && isTopButton(target) && ev instanceof KeyboardEvent) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handleTopButtonActivate(target);
      }
    }
  };

  /**
   * Delegated click/keyboard activation for every top button, owned by the
   * running feature.
   * @param {FeatureContext} ctx
   */
  const setupTopButtonDelegation = ctx => {
    ctx.delegate(document, 'click', '.top-button', onTopButtonClick);
    ctx.delegate(document, 'keydown', '.top-button', onTopButtonKeydown);
  };

  /**
   * Adds CSS styles for scroll-to-top button and scrollbars.
   * Prefers the design-system StyleManager so this CSS shares the
   * single style host with the rest of the design system. Idempotent via
   * StyleManager.add (last write wins, no-op when css is unchanged).
   * @returns {void}
   */
  const addStyles = () => {
    const SM = U?.StyleManager;
    if (SM && typeof SM.add === 'function') {
      const css = window.YouTubePlusDesignSystem?.getStyle?.('yp-enhanced-styles') || '';
      SM.add('yp-enhanced-styles', css);
    }
  };

  /**
   * Updates button visibility based on scroll position
   * @param {HTMLElement} scrollContainer - The container being scrolled
   * @param {HTMLElement} button - The button element
   * @returns {void}
   */
  const handleScroll = (scrollContainer, button) => {
    if (!(button && scrollContainer)) return;
    button.classList.toggle('visible', scrollContainer.scrollTop > 100);
  };

  /**
   * Attach a debounced scroll listener to `target` inside `scope`.
   * @param {FeatureScope} scope
   * @param {EventTarget} target
   * @param {() => void} onScroll
   */
  const listenScroll = (scope, target, onScroll) => {
    scope.listen(target, 'scroll', _debounce(onScroll, 100), { passive: true });
  };

  /**
   * (Re)attach the right-tabs scroll listener to the tab that is currently
   * visible. Runs shortly after tab switches; each run replaces the existing
   * listener scope.
   * @returns {void}
   */
  const setupScrollListener = () => {
    if (!rightTabsScope?.active) return;
    rightTabsScrollScope?.dispose();
    rightTabsScrollScope = rightTabsScope.scope();
    const scope = rightTabsScrollScope;
    scope.timeout(() => {
      // Direct query: a cached ':not(.tab-content-hidden)' result can be the
      // last active tab, which stays in the DOM but is hidden.
      const activeTab = $('#right-tabs .tab-content-cld:not(.tab-content-hidden)');
      const button = byId('right-tabs-top-button');
      if (!(activeTab && button)) return;

      // On single-column layouts #right-tabs itself scrolls (overflow:auto)
      // and the tab never gets scrollTop > 0.
      const rightTabsEl = byId('right-tabs');
      const rtIsScrollHost =
        rightTabsEl &&
        rightTabsEl !== activeTab &&
        rightTabsEl.scrollHeight > rightTabsEl.clientHeight + 10;
      const scrollTarget = /** @type {HTMLElement} */ (rtIsScrollHost ? rightTabsEl : activeTab);
      const update = () => handleScroll(scrollTarget, /** @type {HTMLElement} */ (button));
      listenScroll(scope, scrollTarget, update);
      update();
    }, 100);
  };

  /**
   * Build a top button element.
   * @param {string} id
   * @returns {HTMLButtonElement}
   */
  const buildTopButton = id => {
    const button = document.createElement('button');
    button.id = id;
    button.className = 'top-button';
    button.title = t('scrollToTop');
    button.setAttribute('aria-label', t('scrollToTop'));
    _setSafeHTML(button, SCROLL_TOP_BUTTON_SVG);
    return button;
  };

  /**
   * Creates the right-tabs (Tabview) scroll-to-top button.
   * @returns {void}
   */
  const createButton = () => {
    const rightTabs = $('#right-tabs');
    if (!(rightTabs && topCtx) || byId('right-tabs-top-button')) return;

    rightTabsScope = renewScope(rightTabsScope);
    if (!rightTabsScope) return;
    const button = rightTabsScope.own(buildTopButton('right-tabs-top-button'));
    /** @type {HTMLElement} */ (rightTabs).style.position = 'relative';
    rightTabs.appendChild(button);
    setupScrollListener();
  };

  /**
   * Creates the page-level scroll-to-top button.
   * @returns {void}
   */
  const createUniversalButton = () => {
    if (!topCtx || byId('universal-top-button')) return;

    universalScope = renewScope(universalScope);
    const scope = universalScope;
    if (!scope) return;
    const rawContainer = getUniversalScrollContainer();
    const scrollContainer =
      rawContainer === document.scrollingElement ||
      rawContainer === document.documentElement ||
      rawContainer === document.body
        ? window
        : rawContainer;
    universalScrollContainer = scrollContainer;

    const button = scope.own(buildTopButton('universal-top-button'));
    // Keep the button above YouTube Music/Studio overlays.
    const host = U?.getHostname?.() || '';
    const isMusicOrStudio = host === 'music.youtube.com' || host === 'studio.youtube.com';
    if (isMusicOrStudio) {
      button.style.zIndex = '10000';
    }
    document.body.appendChild(button);

    const readOffset = () =>
      scrollContainer === window
        ? window.scrollY
        : /** @type {Element} */ (scrollContainer).scrollTop;
    listenScroll(scope, scrollContainer, () => {
      button.classList.toggle('visible', readOffset() > 100);
    });
    button.classList.toggle('visible', readOffset() > 100);

    if (!isMusicOrStudio) return;

    // Music/Studio: the scrolling container differs per page, so watch the
    // window and the known layout containers as they appear.
    const getMusicContainers = () => {
      const base = resolveMusicContainers();
      if (
        scrollContainer !== window &&
        scrollContainer instanceof Element &&
        !base.includes(/** @type {Element} */ (scrollContainer))
      ) {
        return [...base, /** @type {Element} */ (scrollContainer)];
      }
      return base;
    };
    const musicScrollCheck = _debounce(() => {
      const anyScrolled = window.scrollY > 100 || getMusicContainers().some(c => c.scrollTop > 100);
      button.classList.toggle('visible', anyScrolled);
    }, 100);
    scope.listen(window, 'scroll', musicScrollCheck, { passive: true });

    const attached = new WeakSet();
    const attachMusicScrollListeners = () => {
      for (const target of [$('ytmusic-app-layout #layout'), $('ytmusic-app-layout')]) {
        if (target && !attached.has(target)) {
          attached.add(target);
          scope.listen(target, 'scroll', musicScrollCheck, { passive: true });
        }
      }
    };
    attachMusicScrollListeners();
    // Layout containers can mount after navigation.
    scope.timeout(attachMusicScrollListeners, 1000);
    scope.timeout(attachMusicScrollListeners, 3000);
  };

  /**
   * Creates the playlist panel scroll-to-top button.
   * @returns {void}
   */
  const createPlaylistPanelButton = () => {
    const playlistPanel = /** @type {HTMLElement | null} */ ($('ytd-playlist-panel-renderer'));
    if (!(playlistPanel && topCtx) || byId('playlist-panel-top-button')) return;
    const scrollContainer = /** @type {HTMLElement | null} */ ($('#items', playlistPanel));
    if (!scrollContainer) return;

    playlistScope = renewScope(playlistScope);
    const scope = playlistScope;
    if (!scope) return;
    const button = scope.own(buildTopButton('playlist-panel-top-button'));

    // Anchor the absolutely positioned button inside the panel.
    playlistPanel.style.position = playlistPanel.style.position || 'relative';
    Object.assign(button.style, PANEL_BUTTON_POSITION);
    playlistPanel.appendChild(button);

    const update = () => handleScroll(scrollContainer, button);
    listenScroll(scope, scrollContainer, update);
    update();

    // Hide the button while the panel is collapsed or hidden.
    const updateVisibility = () => {
      const collapsed =
        !playlistPanel.isConnected ||
        playlistPanel.hidden ||
        (playlistPanel.offsetParent === null && playlistPanel.style.position !== 'fixed');
      const { width, height } = playlistPanel.getBoundingClientRect();
      const empty = scrollContainer.offsetHeight === 0 || scrollContainer.scrollHeight === 0;
      button.style.display = collapsed || width < 40 || height < 40 || empty ? 'none' : '';
    };

    if (typeof ResizeObserver !== 'undefined') {
      const ro = scope.observe(new ResizeObserver(updateVisibility)); // lint:custom:ignore
      ro.observe(playlistPanel);
      ro.observe(scrollContainer);
    }

    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.watchTarget) {
      const watchId = 'enhanced::playlistPanelVisibility';
      coordinator.watchTarget(watchId, playlistPanel, updateVisibility, {
        attributes: true,
        childList: false,
        subtree: false,
        attributeFilter: ['class', 'style', 'hidden'],
      });
      scope.onDispose(() => coordinator.unwatch?.(watchId));
    }

    updateVisibility();
  };

  /**
   * Creates the YouTube Music side panel scroll-to-top button.
   * @returns {void}
   */
  const createMusicSidePanelButton = () => {
    if (!(U?.isMusicDomain?.() && topCtx) || byId('music-side-top-button')) return;

    const panel = /** @type {HTMLElement | null} */ (getMusicSidePanelContainer());
    if (!panel) {
      // YouTube Music renders the queue late; retry for a few seconds.
      const retry = U?.createRetryScheduler?.({
        check: () => {
          if (!topCtx || byId('music-side-top-button')) return true;
          if (!getMusicSidePanelContainer()) return false;
          createMusicSidePanelButton();
          return true;
        },
        maxAttempts: 8,
        interval: 500,
      });
      if (retry) topCtx.onDispose(() => retry.stop());
      return;
    }

    musicSideScope = renewScope(musicSideScope);
    const scope = musicSideScope;
    if (!scope) return;
    const button = scope.own(buildTopButton('music-side-top-button'));
    panel.style.position = panel.style.position || 'relative';
    Object.assign(button.style, PANEL_BUTTON_POSITION);
    panel.appendChild(button);

    musicSideScrollContainer = panel;
    listenScroll(scope, panel, () => {
      button.classList.toggle('visible', panel.scrollTop > 100);
    });
    button.classList.toggle('visible', panel.scrollTop > 100);
  };

  // Return YouTube Dislike integration.
  // The shared Stats service (window.YouTubePlusStats.getDislikesData) owns the
  // request, deadline and result cache. stats.js loads after enhanced.js in
  // build order, so the service is resolved lazily at call time and no local
  // copy of the transport is kept. A null result means "unknown this round"
  // (error, timeout or not-yet-loaded service), shown as an em dash, not 0.
  /** @type {MutationObserver | null} */
  let dislikeDirectObserver = null;
  /** @type {string | null} */
  let dislikePollTimer = null;
  /** @type {string | null} */
  let dislikeRemountSubId = null;
  /** @type {HTMLElement | ShadowRoot | null} */
  let observedDislikeButton = null;

  /** @returns {Element | null} */
  const queryShadow = (
    /** @type {Element | ShadowRoot | null} */ element,
    /** @type {string} */ selector
  ) => {
    if (!element) return null;
    const root = element instanceof Element && element.shadowRoot ? element.shadowRoot : element;
    /** @type {Element | null} */
    const found = root.querySelector(selector);
    if (found) return found;

    const children = root.querySelectorAll('*');
    for (const child of children) {
      /** @type {Element | null} */
      const res = queryShadow(child, selector);
      if (res) return res;
    }
    return null;
  };

  const findAllInShadow = (
    /** @type {ParentNode | null} */ root,
    /** @type {string} */ selector,
    /** @type {Element[]} */ results = []
  ) => {
    if (!root) return results;
    if (typeof root.querySelectorAll === 'function') {
      const found = root.querySelectorAll(selector);
      for (const el of found) results.push(el);
    }
    const children = typeof root.querySelectorAll === 'function' ? root.querySelectorAll('*') : [];
    for (const child of children) {
      if (child instanceof Element && child.shadowRoot) {
        findAllInShadow(child.shadowRoot, selector, results);
      }
    }
    return results;
  };

  /**
   * Compact count formatting; `null`/`undefined` is an explicit unknown,
   * rendered as an em dash so it is not confused with a real 0.
   * @param {number | string | null | undefined} number
   * @returns {string}
   */
  const formatCompactNumber = (/** @type {number | string | null | undefined} */ number) => {
    if (number === null || number === undefined) return '—';
    try {
      return new Intl.NumberFormat(_getLanguage() || 'en', {
        notation: 'compact',
        compactDisplay: 'short',
      }).format(Number(number) || 0);
    } catch (_e) {
      logSEnhanced(_e);
      // Intentional: Intl.NumberFormat may not support locale; fall back to plain string
      return String(number || 0);
    }
  };

  /**
   * Dislike count for a video via the shared RYD service. Stats
   * owns the transport, deadline and bounded result cache; a `null` return
   * means unknown (failed, hung or service not ready), not a zero.
   * @param {string | null | undefined} videoId
   * @returns {Promise<number | null>}
   */
  const fetchDislikes = async (/** @type {string | null | undefined} */ videoId) => {
    if (!videoId) return null;
    const service = window.YouTubePlusStats?.getDislikesData;
    if (typeof service !== 'function') return null;
    try {
      const data = await service(videoId);
      if (!data || typeof data.dislikes !== 'number') return null;
      return data.dislikes;
    } catch (e) {
      logSEnhanced(e);
      return null;
    }
  };

  const extractVideoIdFromDom_ = () => {
    const watchFlexy = $('ytd-watch-flexy');
    const flexyVid = watchFlexy?.getAttribute('video-id');
    if (flexyVid) return flexyVid;

    const moviePlayer = /** @type {YtPlayerElement | null} */ (
      byId('movie_player') || $('#movie_player')
    );
    if (moviePlayer && typeof moviePlayer.getVideoData === 'function') {
      try {
        const data = moviePlayer.getVideoData();
        if (data?.video_id) return data.video_id;
      } catch (_e) {
        // the page player API is not ready yet
        logSEnhanced(_e);
      }
    }

    const metaVideoId = $("meta[itemprop='videoId']");
    return metaVideoId?.getAttribute('content') || null;
  };

  const extractVideoIdFromLocation_ = () => {
    const fromLoc = U?.getVideoIdFromLocation?.() || U?.getVideoIdFromUrl?.(window.location.href);
    if (fromLoc) return fromLoc;

    const search = window.location.search || '';
    const vMatch = search.match(/[?&]v=([^&#]+)/);
    if (vMatch?.[1]) {
      try {
        return decodeURIComponent(vMatch[1]);
      } catch (_e) {
        logSEnhanced(_e);
        return vMatch[1];
      }
    }

    const pathname = window.location.pathname || '';
    if (pathname.startsWith('/shorts/')) return pathname.slice(8);
    if (pathname.startsWith('/clip/')) {
      const meta = $("meta[itemprop='videoId'], meta[itemprop='identifier']");
      return meta?.getAttribute('content') || null;
    }
    return null;
  };

  const getVideoIdForDislike = () => {
    const fromLocation = extractVideoIdFromLocation_();
    if (fromLocation) return fromLocation;
    // A Shorts or clip URL names its video; the page DOM may still show another one.
    const pathname = window.location.pathname || '';
    if (pathname.startsWith('/shorts/') || pathname.startsWith('/clip/')) return fromLocation;
    return extractVideoIdFromDom_();
  };

  const getButtonsContainer = () => {
    return (
      $(
        'ytd-watch-flexy:not([hidden]) ytd-menu-renderer.ytd-watch-metadata > div#top-level-buttons-computed'
      ) ||
      $('ytd-watch-flexy:not([hidden]) ytd-menu-renderer.ytd-video-primary-info-renderer > div') ||
      $('ytd-watch-flexy:not([hidden]) #menu-container #top-level-buttons-computed') ||
      $('ytd-menu-renderer.ytd-watch-metadata > div#top-level-buttons-computed') ||
      $('ytd-menu-renderer.ytd-video-primary-info-renderer > div') ||
      $('#menu-container #top-level-buttons-computed') ||
      null
    );
  };

  const findNativeDislikeButton_ = (/** @type {Element | null} */ container) => {
    if (!container) return null;
    const btn =
      container.querySelector('dislike-button-view-model') ||
      container
        .querySelector('like-button-view-model')
        ?.parentElement?.querySelector('[aria-label*="islike"]:not(.yp-shorts-dislike-btn)')
        ?.closest('button')?.parentElement ||
      container.querySelector('#dislike-button');
    return /** @type {HTMLElement | null} */ (btn);
  };

  const createOrMountCustomShortsDislike_ = (
    /** @type {Element | null} */ activeReel,
    /** @type {Element | null} */ shortsContainer
  ) => {
    const dlParent = document.querySelector('.yp-shorts-download')?.parentElement;
    const root = /** @type {ParentNode} */ (dlParent || activeReel || shortsContainer || document);
    const likeEl = root.querySelector(
      'like-button-view-model, #like-button, button[aria-label*="Like" i]:not([aria-label*="Dislike" i]):not(.yp-shorts-dislike-btn), button[aria-label*="Нравится" i]:not([aria-label*="Не нравится" i])'
    );
    const likeAnchor =
      likeEl?.closest(
        'like-button-view-model, #like-button, reel-action-view-model, ytw-reel-action-view-model, [class*="ReelActionViewModel"]'
      ) || likeEl;
    if (!likeAnchor?.parentElement) return null;

    const existingWraps = document.querySelectorAll('#yp-shorts-dislike, .yp-shorts-dislike-wrap');
    let customWrap = /** @type {HTMLElement | null} */ (existingWraps[0] || null);
    for (let i = 1; i < existingWraps.length; i += 1) {
      existingWraps[i].remove();
    }
    if (!customWrap) {
      customWrap = document.createElement('div');
      customWrap.id = 'yp-shorts-dislike';
      customWrap.className = 'yp-shorts-dislike-wrap';
      U.setSafeHTML(
        customWrap,
        '<button type="button" class="yp-shorts-dislike-btn" aria-label="Dislike"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg></button><span id="yp-dislike-text" class="yp-dislike-text--shorts label" role="text" data-yp-original-text="Dislike">—</span>'
      );
    }
    if (likeAnchor.nextElementSibling !== customWrap) {
      likeAnchor.insertAdjacentElement('afterend', customWrap);
    }
    return customWrap;
  };

  /**
   * Get dislike button for Shorts page
   * @returns {HTMLElement|null} Dislike button element
   */
  const getDislikeButtonShorts = () => {
    const activeReel =
      document.querySelector('ytd-reel-video-renderer[is-active]') ||
      document.querySelector('ytd-reel-video-renderer[is-active="true"]') ||
      document.querySelector('#shorts-player ytd-reel-video-renderer');
    const reelBtn = findNativeDislikeButton_(activeReel);
    if (reelBtn) return reelBtn;

    // Only the native buttons: the like-button search could pick another reel's button.
    const shortsContainer = document.querySelector('ytd-shorts');
    const containerBtn =
      shortsContainer?.querySelector('dislike-button-view-model') ||
      shortsContainer?.querySelector('#dislike-button');
    if (containerBtn) return /** @type {HTMLElement} */ (containerBtn);

    const custom = createOrMountCustomShortsDislike_(activeReel, shortsContainer);
    if (custom) return custom;

    // Last resort: global search outside hidden watch page
    return /** @type {HTMLElement | null} */ (
      document.querySelector('dislike-button-view-model:not(ytd-watch-flexy *)') ||
        document.querySelector('#dislike-button:not(ytd-watch-flexy *)') ||
        null
    );
  };

  /**
   * Get dislike button from buttons container
   * @param {Element|null} buttons - Buttons container
   * @returns {Element|null} Dislike button element
   */
  const getDislikeButtonFromContainer = buttons => {
    if (!buttons) return null;

    // Check for segmented like/dislike button (newer YouTube layout)
    const segmented = buttons.querySelector('ytd-segmented-like-dislike-button-renderer');
    if (segmented) {
      const dislikeViewModel =
        segmented.querySelector('dislike-button-view-model') ||
        segmented.querySelector('#segmented-dislike-button') ||
        segmented.children[1];
      if (dislikeViewModel) return dislikeViewModel;
    }

    // Check for standalone dislike view-model button
    const viewModel = buttons.querySelector('dislike-button-view-model');
    if (viewModel) return viewModel;

    // Fallback: try to find by button label or position
    const dislikeBtn =
      buttons.querySelector('button[aria-label*="dislike" i]') ||
      buttons.querySelector('button[aria-label*="islike" i]') ||
      buttons.querySelector('button[aria-label*="не нравится" i]');
    if (dislikeBtn) {
      return dislikeBtn.closest('dislike-button-view-model') || dislikeBtn.parentElement;
    }

    // Last resort: second child in container
    return buttons.children?.[1] ? buttons.children[1] : null;
  };

  const getDislikeButton = () => {
    // Handle Shorts variants and main page segmented buttons
    const isShorts = window.location.pathname.startsWith('/shorts');
    if (isShorts) {
      return getDislikeButtonShorts();
    }

    const buttons = getButtonsContainer();
    const btn = getDislikeButtonFromContainer(buttons);
    if (btn) return btn;

    // Fallbacks
    return (
      $(
        'ytd-watch-flexy:not([hidden]) ytd-watch-metadata ytd-segmented-like-dislike-button-renderer dislike-button-view-model'
      ) ||
      $('ytd-watch-flexy:not([hidden]) ytd-watch-metadata dislike-button-view-model') ||
      $(
        'ytd-watch-metadata ytd-segmented-like-dislike-button-renderer dislike-button-view-model'
      ) ||
      $('ytd-watch-metadata dislike-button-view-model') ||
      $('ytd-segmented-like-dislike-button-renderer dislike-button-view-model') ||
      $('dislike-button-view-model') ||
      $('#segmented-dislike-button') ||
      null
    );
  };

  const getShortsDislikeLabel_ = (/** @type {HTMLElement} */ dislikeButton) => {
    if (!window.location.pathname.startsWith('/shorts')) return null;
    const label =
      queryShadow(dislikeButton, 'yt-formatted-string') ||
      queryShadow(dislikeButton, 'span[role="text"]') ||
      queryShadow(dislikeButton, 'span.label') ||
      queryShadow(dislikeButton, '.label');
    if (label && !label.hasAttribute('data-yp-original-text')) {
      label.setAttribute(
        'data-yp-original-text',
        /** @type {HTMLElement} */ (label).innerText || 'Dislike'
      );
    }
    return label || null;
  };

  const findOrCreateTextContainer_ = (/** @type {HTMLElement} */ buttonShape) => {
    let textContainer = queryShadow(buttonShape, '.yt-spec-button-shape-next__button-text-content');
    if (textContainer) return textContainer;

    const targetElement = buttonShape.shadowRoot || buttonShape;
    textContainer = targetElement.querySelector?.(
      '.yt-spec-button-shape-next__button-text-content'
    );
    if (textContainer) return textContainer;

    textContainer = document.createElement('div');
    textContainer.className = 'yt-spec-button-shape-next__button-text-content';
    const icon = queryShadow(buttonShape, '.yt-spec-button-shape-next__icon');
    const parent = icon?.parentNode || buttonShape;
    parent.appendChild(textContainer);
    return textContainer;
  };

  const ensureDislikeShadowStyle_ = (/** @type {Node} */ textContainer) => {
    const rootNode = textContainer.getRootNode();
    if (rootNode instanceof ShadowRoot && !rootNode.querySelector('#yp-dislike-style')) {
      const style = document.createElement('style');
      style.id = 'yp-dislike-style';
      style.textContent =
        window.YouTubePlusDesignSystem?.getStyle?.('yp-dislike-shadow-style') || '';
      rootNode.appendChild(style);
    }
  };

  const styleDislikeButtonWidth_ = (
    /** @type {HTMLElement} */ buttonShape,
    /** @type {HTMLElement} */ dislikeButton
  ) => {
    buttonShape.style.minWidth = 'auto';
    buttonShape.style.width = 'auto';
    const viewModelHost = /** @type {HTMLElement | null} */ (
      dislikeButton.closest('ytDislikeButtonViewModelHost')
    );
    if (viewModelHost) {
      viewModelHost.style.minWidth = 'auto';
    }
    dislikeButton.style.minWidth = 'auto';
  };

  const getOrCreateDislikeText = (/** @type {HTMLElement | null} */ dislikeButton) => {
    if (!dislikeButton) return null;

    const shortsLabel = getShortsDislikeLabel_(dislikeButton);
    if (shortsLabel) return shortsLabel;

    const existingCustom = queryShadow(dislikeButton, '#yp-dislike-text');
    if (existingCustom) return existingCustom;

    const buttonShape = /** @type {HTMLElement} */ (
      queryShadow(dislikeButton, 'button') ||
        dislikeButton.querySelector('button') ||
        dislikeButton.closest('button') ||
        dislikeButton
    );

    const textContainer = findOrCreateTextContainer_(buttonShape);

    const created = document.createElement('span');
    created.id = 'yp-dislike-text';
    created.setAttribute('role', 'text');
    created.className = 'yt-core-attributed-string yt-core-attributed-string--white-space-no-wrap';
    created.classList.add('yp-dislike-text--regular');
    textContainer.appendChild(created);

    ensureDislikeShadowStyle_(textContainer);
    styleDislikeButtonWidth_(buttonShape, dislikeButton);
    return created;
  };

  const setDislikeDisplay = (
    /** @type {HTMLElement | null} */ dislikeButton,
    /** @type {number | string | null} */ count
  ) => {
    if (!dislikeButton) return;
    const container = /** @type {HTMLElement | null} */ (getOrCreateDislikeText(dislikeButton));
    if (!container) return;

    const formatted = formatCompactNumber(count);
    if (container.innerText !== String(formatted)) {
      container.innerText = String(formatted);

      // Ensure the text is visible and properly styled
      container.style.display = 'inline-block';
      container.style.visibility = 'visible';
      container.style.opacity = '1';

      // Make sure parent button container is wide enough
      const buttonShape = /** @type {HTMLElement | null} */ (
        container.closest('button') ||
          queryShadow(dislikeButton, 'button') ||
          dislikeButton.querySelector('button')
      );
      if (buttonShape && !dislikeButton.classList?.contains('yp-shorts-dislike-wrap')) {
        buttonShape.style.minWidth = 'fit-content';
        buttonShape.style.width = 'auto';
      }
    }
  };

  /** Display memo for the MutationObserver: one entry, the current video. */
  /** @type {{ vid: string | null; count: number | null }} */
  let lastDislikeDisplay = { vid: null, count: null };

  /** Disconnect the dislike observer and drop it from the manager's tracking. */
  const releaseDislikeObserver = () => {
    if (!dislikeDirectObserver) return;
    dislikeDirectObserver.disconnect();
    window.YouTubePlusCleanupManager?.unregisterObserver?.(dislikeDirectObserver);
    dislikeDirectObserver = null;
  };

  const setupDislikeObserver = (/** @type {HTMLElement | null} */ dislikeButton) => {
    if (!dislikeButton || dislikeButton.id === 'yp-shorts-dislike') return;
    const innerBtn =
      queryShadow(dislikeButton, 'button') ||
      dislikeButton.querySelector('button') ||
      dislikeButton;
    const rootNode = innerBtn.getRootNode();
    const targetNode = rootNode instanceof ShadowRoot ? rootNode : dislikeButton;
    if (dislikeDirectObserver && observedDislikeButton === targetNode) {
      return; // Already observing this exact targetNode (ShadowRoot or element)
    }
    if (dislikeDirectObserver) {
      releaseDislikeObserver();
    }

    observedDislikeButton = targetNode;
    try {
      // lint:custom:ignore
      const rawDislikeObserver = new MutationObserver(() => {
        // on any mutation, re-display the last value for the current video;
        // the authoritative result store is the shared Stats service cache.
        const vid = getVideoIdForDislike();
        if (vid && lastDislikeDisplay.vid === vid) {
          const btn = getDislikeButton();
          if (btn instanceof HTMLElement) setDislikeDisplay(btn, lastDislikeDisplay.count);
        }
      });
      dislikeDirectObserver =
        window.YouTubePlusCleanupManager?.registerObserver?.(rawDislikeObserver, null) ||
        rawDislikeObserver;
      dislikeDirectObserver.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    } catch (e) {
      logSEnhanced(e);
      enhancedLogger?.warn?.('Enhanced', 'Failed to create dislike direct observer', e);
    }
  };

  /**
   * Check if the dislike button inner element is upgraded and ready.
   * @param {Element} btn
   * @param {boolean} isShorts
   * @returns {boolean}
   */
  const isDislikeButtonReady_ = (btn, isShorts) => {
    if (isShorts) return true;
    const innerBtn =
      queryShadow(btn, 'button') ||
      btn.querySelector('button') ||
      (btn.tagName === 'BUTTON' ? btn : null);
    return Boolean(innerBtn);
  };

  /**
   * Check if the dislike count is already properly rendered for the given video ID.
   * @param {Element} btn
   * @param {string} vid
   * @param {boolean} isShorts
   * @returns {boolean}
   */
  const isDislikeAlreadyRendered_ = (btn, vid, isShorts) => {
    if (btn.getAttribute('data-yp-video-id') !== vid) return false;

    const existingText = /** @type {HTMLElement | null} */ (
      isShorts
        ? queryShadow(btn, 'yt-formatted-string, span[role="text"], span.label, .label')
        : queryShadow(btn, '#yp-dislike-text')
    );

    if (!existingText) return false;

    if (isShorts) {
      const originalText = existingText.getAttribute('data-yp-original-text');
      return Boolean(originalText && existingText.innerText !== originalText);
    }

    const text = existingText.innerText;
    // An em dash marks an unknown count, so treat it as not rendered and let
    // the next consumer action retry after a transient RYD failure.
    if (text === '—') return false;
    return Boolean(text && text.trim() !== '');
  };

  const initReturnDislike = async () => {
    try {
      if (dislikeRemountSubId) {
        window.YouTubePlusMutationCoordinator?.unsubscribe?.(dislikeRemountSubId);
        dislikeRemountSubId = null;
      }
      if (dislikePollTimer) {
        window.YouTubePlusMutationCoordinator?.unsubscribe?.(dislikePollTimer);
        dislikePollTimer = null;
      }

      let checkInFlight = false;
      // Use MutationObserver instead of setInterval for better performance
      const checkButton = async () => {
        if (checkInFlight) return false;
        const btn = getDislikeButton();
        if (!(btn instanceof HTMLElement)) return false;

        const isShorts = window.location.pathname.startsWith('/shorts');
        if (!isDislikeButtonReady_(btn, isShorts)) return false;

        const vid = getVideoIdForDislike();
        if (!vid) return false;

        if (isDislikeAlreadyRendered_(btn, vid, isShorts)) return true;

        checkInFlight = true;
        try {
          const val = await fetchDislikes(vid);
          lastDislikeDisplay = { vid, count: val };
          setDislikeDisplay(btn, val);
          btn.setAttribute('data-yp-video-id', vid);
          setupDislikeObserver(btn);
          return true;
        } finally {
          checkInFlight = false;
        }
      };

      // Helper for retrying checkButton
      const runCheckWithRetry = async (retryCount = 0) => {
        try {
          const success = await checkButton();
          if (!success && retryCount < 15) {
            enhancedSetTimeout_(() => runCheckWithRetry(retryCount + 1), 100 + retryCount * 100);
          }
        } catch (_e) {
          logSEnhanced(_e);
          // ignore
        }
      };

      // Check immediately
      await runCheckWithRetry();

      // Set up coordinator subscription for button appearance
      const isShorts = window.location.pathname.startsWith('/shorts');
      const maxTime = 20000; // 20 seconds timeout
      const startTime = Date.now();

      const coordinator = window.YouTubePlusMutationCoordinator;
      if (coordinator?.subscribeRoot) {
        const pollSelector = isShorts
          ? '#shorts-container, ytd-shorts'
          : 'ytd-watch-flexy, #page-manager, #below';
        dislikePollTimer = 'enhanced::dislikePoll';
        coordinator.subscribeRoot(
          dislikePollTimer,
          async () => {
            if (Date.now() - startTime > maxTime) {
              if (dislikePollTimer) {
                coordinator.unsubscribe(dislikePollTimer);
              }
              dislikePollTimer = null;
              return;
            }
            await runCheckWithRetry();
          },
          {
            selector: pollSelector,
            childList: true,
            attributes: false,
            subtree: true,
          }
        );
      }

      // After the 20 s fast path, a remount of the like/dislike buttons
      // (YouTube re-renders them on its own) is caught by a subscription
      // scoped to those buttons, not by a timer.
      if (coordinator?.subscribeRoot) {
        dislikeRemountSubId = 'enhanced::dislikeRemount';
        coordinator.subscribeRoot(
          dislikeRemountSubId,
          () => {
            if (!shouldInitReturnDislike()) return;
            checkButton().catch(logSEnhanced);
          },
          {
            selector:
              'dislike-button-view-model, ytd-segmented-like-dislike-button-renderer, like-button-view-model',
            childList: true,
            attributes: false,
            subtree: true,
          }
        );
      }
    } catch (e) {
      logSEnhanced(e);
      enhancedLogger?.warn?.('Enhanced', 'Failed to initialize Return YouTube Dislike', e);
    }
  };

  const cleanupReturnDislike = () => {
    if (dislikePollTimer) {
      window.YouTubePlusMutationCoordinator?.unsubscribe?.(dislikePollTimer);
      dislikePollTimer = null;
    }
    if (dislikeRemountSubId) {
      window.YouTubePlusMutationCoordinator?.unsubscribe?.(dislikeRemountSubId);
      dislikeRemountSubId = null;
    }
    releaseDislikeObserver();
    observedDislikeButton = null;
    byId('yp-shorts-dislike')?.remove();
    // Remove all created dislike text spans
    /** @type {Element[]} */
    const dislikeSpans = [];
    findAllInShadow(document.body, '#yp-dislike-text', dislikeSpans);
    dislikeSpans.forEach(el => el.remove());
    // Remove data-yp-video-id attributes
    /** @type {Element[]} */
    const buttonsWithAttr = [];
    findAllInShadow(document.body, '[data-yp-video-id]', buttonsWithAttr);
    buttonsWithAttr.forEach(el => el.removeAttribute('data-yp-video-id'));
    // Restore original text on label elements
    /** @type {Element[]} */
    const originalTexts = [];
    findAllInShadow(document.body, '[data-yp-original-text]', originalTexts);
    originalTexts.forEach(el => {
      /** @type {HTMLElement} */ (el).innerText = el.getAttribute('data-yp-original-text') || '';
      el.removeAttribute('data-yp-original-text');
    });
  };

  if (typeof window !== 'undefined') {
    window.YouTubePlusEnhanced = window.YouTubePlusEnhanced || {};
    window.YouTubePlusEnhanced.getVideoIdForDislike = getVideoIdForDislike;
    window.YouTubePlusEnhanced.formatCompactNumber = formatCompactNumber;
    window.YouTubePlusEnhanced.isDislikeButtonReady = isDislikeButtonReady_;
    window.YouTubePlusEnhanced.isDislikeAlreadyRendered = isDislikeAlreadyRendered_;
    window.YouTubePlusEnhanced.getDislikeButton = getDislikeButton;
    window.YouTubePlusEnhanced.setDislikeDisplay = setDislikeDisplay;
  }

  /**
   * Observes DOM changes to detect tab switches
   * @returns {string|null} Subscription id or null on error
   */
  const observeTabChanges = () => {
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (!coordinator?.subscribeRoot) return null;

    const observerId = 'enhanced::tabChanges';
    coordinator.subscribeRoot(
      observerId,
      (/** @type {MutationRecord[]} */ mutations) => {
        if (
          mutations.some(
            (/** @type {MutationRecord} */ m) =>
              m.type === 'attributes' &&
              m.attributeName === 'class' &&
              m.target instanceof Element &&
              m.target.classList.contains('tab-content-cld')
          )
        ) {
          setupScrollListener();
        }
      },
      {
        selector: '#right-tabs .tab-content-cld',
        attributes: true,
        childList: false,
        subtree: true,
        attributeFilter: ['class'],
      }
    );

    // Track observer for diagnostics
    U?.ObserverRegistry?.track?.();

    const rightTabs = $('#right-tabs');
    if (rightTabs) {
      return observerId;
    }
    // No target found, untrack.
    U?.ObserverRegistry?.untrack?.();
    coordinator.unsubscribe(observerId);
    return null;
  };

  /**
   * Check if current page needs universal button
   * @returns {boolean}
   */
  const needsUniversalButton = () => {
    const host = U?.getHostname?.() || '';
    // Always show on Music and Studio
    if (host === 'music.youtube.com' || host === 'studio.youtube.com') return true;

    if ((U?.isWatchPage?.() ?? false) || (U?.isShortsPage?.() ?? false)) {
      return !isTabviewEnabled();
    }

    const path = window.location.pathname;
    const { search } = window.location;

    // Search results page
    if (path === '/results' && search.includes('search_query=')) return true;

    // Playlist page
    if (path === '/playlist' && search.includes('list=')) return true;

    // Home/Feed pages
    if (path === '/' || path === '/feed/subscriptions') return true;

    return true;
  };

  /**
   * Tab switches in Tabview move the scroll host; re-attach the right-tabs
   * scroll listener after each switch.
   * @param {FeatureContext} ctx
   */
  const setupEvents = ctx => {
    ctx.delegate(document, 'click', '.tab-btn[tyt-tab-content]', () => setupScrollListener(), {
      capture: true,
    });
  };

  /** Stop the watch-page top-button schedulers and the tab observer. */
  const stopTopButtonWatch = () => {
    watchInitToken++;
    tabCheckTimeoutId?.stop?.();
    tabCheckTimeoutId = null;
    playlistPanelCheckTimeoutId?.stop?.();
    playlistPanelCheckTimeoutId = null;
    if (tabChangesObserver) {
      window.YouTubePlusMutationCoordinator?.unsubscribe?.(tabChangesObserver);
      U?.ObserverRegistry?.untrack?.();
    }
    tabChangesObserver = null;
  };

  const stopWatchEnhancements = () => {
    stopTopButtonWatch();
    cleanupReturnDislike();
  };

  /** Watch-page buttons: Tabview right tabs and the playlist panel. */
  const startWatchEnhancements = () => {
    if (!topCtx) return;
    if (!(U?.isWatchPage?.() ?? false)) return;

    const token = ++watchInitToken;
    const isCurrent = () =>
      token === watchInitToken && Boolean(topCtx) && (U?.isWatchPage?.() ?? false);

    tabCheckTimeoutId =
      U?.createRetryScheduler?.({
        check: () => {
          if (!isCurrent()) return true;
          if (!$('#right-tabs')) return false;
          createButton();
          if (tabChangesObserver) {
            window.YouTubePlusMutationCoordinator?.unsubscribe?.(tabChangesObserver);
          }
          tabChangesObserver = observeTabChanges();
          return true;
        },
        maxAttempts: 40,
        interval: 250,
      }) || null;

    playlistPanelCheckTimeoutId =
      U?.createRetryScheduler?.({
        check: () => {
          if (!isCurrent()) return true;
          if (!$('ytd-playlist-panel-renderer')) return false;
          createPlaylistPanelButton();
          return true;
        },
        maxAttempts: 30,
        interval: 300,
      }) || null;
  };

  /** Create the buttons the current page needs. */
  const createPageButtons = () => {
    if (!topCtx) return;
    if (needsUniversalButton()) createUniversalButton();
    if (U?.isMusicDomain?.()) createMusicSidePanelButton();
  };

  /** Rebuild every button, e.g. after Tabview was switched on or off. */
  const rebuildTopButtons = () => {
    stopTopButtonWatch();
    cleanupTopButtons();
    createPageButtons();
    startWatchEnhancements();
  };

  const TOP_BUTTON_STYLE_ID = 'yp-top-button-styles';

  const scrollToTopFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'scrollToTop',
    settingsKey: 'enableScrollToTopButton',
    start(/** @type {FeatureContext} */ ctx) {
      topCtx = ctx;
      ctx.style(
        TOP_BUTTON_STYLE_ID,
        window.YouTubePlusDesignSystem?.getStyle?.(TOP_BUTTON_STYLE_ID) || ''
      );
      setupTopButtonDelegation(ctx);
      setupEvents(ctx);
      ctx.onDispose(
        window.YouTubePlusSettingsHost?.onChange?.('enableTabview', () => rebuildTopButtons()) ||
          (() => {})
      );
      createPageButtons();
      startWatchEnhancements();
    },
    stop() {
      stopTopButtonWatch();
      cleanupTopButtons();
      topCtx = null;
    },
  });

  /**
   * Initialize the enhanced module: shared styles, Return YouTube Dislike and
   * the scroll-to-top feature.
   * @returns {void}
   */
  const init = () => {
    try {
      addStyles();

      const onNavigate = () => {
        stopWatchEnhancements();
        invalidateMusicContainersCache();
        createPageButtons();

        if (shouldInitReturnDislike()) {
          initReturnDislike();
        }

        // Watch-specific UI only initializes on /watch
        startWatchEnhancements();
      };

      // Starts the feature when its setting is on, then follows the setting.
      scrollToTopFeature?.sync();
      onNavigate();

      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'yt-navigate-finish',
        () => enhancedSetTimeout_(onNavigate, 200),
        { passive: true },
        true
      );

      if (U?.isMusicDomain?.()) {
        window.YouTubePlusCleanupManager?.registerListener?.(
          window,
          'popstate',
          () => enhancedSetTimeout_(onNavigate, 200),
          undefined,
          true
        );
        const coordinator = window.YouTubePlusMutationCoordinator;
        if (coordinator?.subscribeRoot) {
          coordinator.subscribeRoot(
            'enhanced::musicSidePanel',
            () => createMusicSidePanelButton(),
            {
              selector: 'ytmusic-player-page, ytmusic-app-layout, ytmusic-app, #layout',
              childList: true,
              attributes: false,
              subtree: true,
            }
          );
        }
      }
    } catch (error) {
      logSEnhanced(error);
      enhancedLogger?.error?.('Enhanced', 'Error in initialization', error);
    }
  };

  const scheduleInit = () => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(init, { timeout: 4000 });
    } else {
      enhancedSetTimeout_(init, 0);
    }
  };

  // Expose deterministic helpers for real-API testing.
  Object.assign(window.YouTubePlusEnhanced, {
    isTabviewEnabled,
    resolveMusicContainers,
    invalidateMusicContainersCache,
    getUniversalScrollContainer,
  });

  // Prevent multiple runtime initializations while keeping the public API available.
  if (!window._enhancedInitialized) {
    window._enhancedInitialized = true;
    onDomReady(scheduleInit);
  }
})();

// Remember Manual Playback Quality
(function () {
  const QUALITY_STORAGE_KEY = 'youtube_plus_manual_playback_quality';
  const APPLY_ATTEMPTS = 16;
  const APPLY_INTERVAL_MS = 350;

  const QUALITY_RANKING = [
    'highres',
    'hd2160',
    'hd1440',
    'hd1080',
    'hd720',
    'large',
    'medium',
    'small',
    'tiny',
    'auto',
  ];

  /** @type {Array<ReturnType<typeof setTimeout>>} */
  let pendingApplyTimeouts = [];
  let lastAppliedVideoId = '';

  const isVideoPage = () => {
    const path = window.location.pathname || '';
    return path === '/watch' || path.startsWith('/shorts/');
  };

  const normalizeQuality = (/** @type {unknown} */ value) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    return normalized && normalized !== 'unknown' ? normalized : '';
  };

  /** Module namespace in the shared settings blob. */
  const MODULE_NAME = 'enhanced';

  /** @returns {YouTubePlusSettingsStore | null} the store when the blob bridge is active */
  const bridgedStore = () => window.YouTubePlusSettingsStore?.moduleBridge?.() ?? null;

  const getCurrentVideoId = () => {
    return U?.getVideoIdFromLocation?.() || '';
  };

  const getPlayer = () => /** @type {YtPlayerElement | null} */ (byId('movie_player'));

  const clearPendingApplyTimeouts = () => {
    pendingApplyTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    pendingApplyTimeouts = [];
  };

  /** @returns {string} the remembered quality from the legacy key */
  const readLegacyQuality = () => {
    try {
      return normalizeQuality(U.storage?.getItem(QUALITY_STORAGE_KEY));
    } catch (_e) {
      logSEnhanced(_e);
      return '';
    }
  };

  const getStoredQuality = () => {
    const store = bridgedStore();
    if (store) {
      const mod = store.getModuleSettings(MODULE_NAME);
      if (mod && Object.hasOwn(mod, 'playbackQuality')) {
        return normalizeQuality(mod.playbackQuality);
      }
      // Migrate the legacy value once, then read only from the blob.
      const legacy = readLegacyQuality();
      store.updateModuleSettings(MODULE_NAME, { playbackQuality: legacy });
      return legacy;
    }
    return readLegacyQuality();
  };

  const storeQuality = (/** @type {string} */ quality) => {
    const normalized = normalizeQuality(quality);
    const store = bridgedStore();
    if (store) {
      store.updateModuleSettings(MODULE_NAME, {
        playbackQuality: !normalized || normalized === 'auto' ? '' : normalized,
      });
      return;
    }
    try {
      if (!normalized || normalized === 'auto') {
        U.storage?.removeItem(QUALITY_STORAGE_KEY);
        return;
      }
      U.storage?.setItem(QUALITY_STORAGE_KEY, normalized);
    } catch (_e) {
      logSEnhanced(_e);
      logSEnhanced(_e);
    }
  };

  const resolveTargetQuality_ = (
    /** @type {string} */ preferredQuality,
    /** @type {string[]} */ availableQualityLevels
  ) => {
    if (availableQualityLevels.includes(preferredQuality)) return preferredQuality;
    const prefIdx = QUALITY_RANKING.indexOf(preferredQuality);
    if (prefIdx !== -1) {
      return QUALITY_RANKING.slice(prefIdx).find(q => availableQualityLevels.includes(q)) || 'auto';
    }
    return 'auto';
  };

  const persistPlayerQuality_ = (/** @type {string} */ targetQuality) => {
    try {
      U.storage?.setItem(
        'yt-player-quality',
        JSON.stringify({
          data: targetQuality,
          expiration: Date.now() + 1000 * 60 * 60 * 24 * 30,
          creation: Date.now(),
        })
      );
    } catch (_err) {
      logSEnhanced(_err);
    }
  };

  const applyStoredQualityOnce = () => {
    if (!(U?.loadFeatureEnabled?.('enableRememberManualQuality') ?? true)) {
      return true;
    }
    if (!isVideoPage()) return true;

    const preferredQuality = getStoredQuality();
    if (!preferredQuality) return true;

    const player = getPlayer();
    if (!player) return false;

    const currentVideoId = getCurrentVideoId();
    const currentQuality = normalizeQuality(player?.getPlaybackQuality?.());
    if (
      currentVideoId &&
      lastAppliedVideoId === currentVideoId &&
      currentQuality === preferredQuality
    ) {
      return true;
    }

    try {
      const availableQualityLevels =
        typeof player.getAvailableQualityLevels === 'function'
          ? player.getAvailableQualityLevels().map(normalizeQuality).filter(Boolean)
          : [];

      // Player metadata can arrive later on initial load; keep retrying until levels are known.
      if (
        !availableQualityLevels.length ||
        (availableQualityLevels.length === 1 && availableQualityLevels[0] === 'auto')
      ) {
        return false;
      }

      const targetQuality = resolveTargetQuality_(preferredQuality, availableQualityLevels);

      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(targetQuality, targetQuality);
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(targetQuality);
      }

      persistPlayerQuality_(targetQuality);

      lastAppliedVideoId = currentVideoId;
      return true;
    } catch (_e) {
      logSEnhanced(_e);
      return false;
    }
  };

  const scheduleApplyStoredQuality = () => {
    clearPendingApplyTimeouts();
    if (!(U?.loadFeatureEnabled?.('enableRememberManualQuality') ?? true)) {
      return;
    }
    if (!isVideoPage()) return;

    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt += 1) {
      const timeoutId = enhancedSetTimeout_(() => {
        if (applyStoredQualityOnce()) {
          clearPendingApplyTimeouts();
        }
      }, attempt * APPLY_INTERVAL_MS);
      pendingApplyTimeouts.push(timeoutId);
    }
  };

  const QUALITY_LABEL_TOKENS = [
    ['2160p', 'hd2160'],
    ['4k', 'hd2160'],
    ['2160', 'hd2160'],
    ['1440p', 'hd1440'],
    ['2k', 'hd1440'],
    ['1440', 'hd1440'],
    ['1080p', 'hd1080'],
    ['1080', 'hd1080'],
    ['720p', 'hd720'],
    ['720', 'hd720'],
    ['480p', 'large'],
    ['480', 'large'],
    ['360p', 'medium'],
    ['360', 'medium'],
    ['240p', 'small'],
    ['240', 'small'],
    ['144p', 'tiny'],
    ['144', 'tiny'],
    ['auto', 'auto'],
    ['авто', 'auto'],
  ];

  const QUALITY_VALUE_TOKENS = [
    ['2160', 'hd2160'],
    ['1440', 'hd1440'],
    ['1080', 'hd1080'],
    ['720', 'hd720'],
    ['480', 'large'],
    ['360', 'medium'],
    ['240', 'small'],
    ['144', 'tiny'],
    ['auto', 'auto'],
  ];

  /**
   * Find the first matching token in text
   * @param {string} text - Text to search
   * @param {string[][]} tokens - [token, quality] pairs
   * @returns {string|null} Matched quality or null
   */
  const matchQualityToken = (text, tokens) => {
    for (const [token, quality] of tokens) {
      if (text.includes(token)) return quality;
    }
    return null;
  };

  const parseQualityFromLabelOrValue = (
    /** @type {string} */ label,
    /** @type {string} */ value
  ) => {
    const val = normalizeQuality(value);
    // If it's already a recognized YouTube quality identifier, use it
    if (
      [
        'highres',
        'hd2160',
        'hd1440',
        'hd1080',
        'hd720',
        'large',
        'medium',
        'small',
        'tiny',
        'auto',
      ].includes(val)
    ) {
      return val;
    }

    // Fallback: parse from label, then from the normalized value
    const lbl = String(label || '').toLowerCase();
    return (
      matchQualityToken(lbl, QUALITY_LABEL_TOKENS) ||
      matchQualityToken(val, QUALITY_VALUE_TOKENS) ||
      val
    );
  };

  const handleQualityMenuInteraction = (/** @type {Event} */ event) => {
    const target = /** @type {HTMLElement | null} */ (
      event.target instanceof HTMLElement ? event.target : null
    );
    const menuItem = target?.closest?.(
      '.ytp-quality-menu .ytp-menuitem, .ytp-panel-menu .ytp-menuitem'
    );
    if (!menuItem) return;

    const label = String(menuItem.textContent || '')
      .trim()
      .toLowerCase();
    const menuValue = String(
      menuItem.getAttribute('data-value') ||
        (menuItem instanceof HTMLElement ? menuItem.dataset?.value : '') ||
        ''
    ).trim();

    if (!(label || menuValue)) return;
    if (!(menuValue || /(\bauto\b|авто|\d{3,4}p|\bhd\b|\b4k\b|\b8k\b)/.test(label))) return;

    const parsedQuality = parseQualityFromLabelOrValue(label, menuValue);
    if (parsedQuality) {
      if (!(U?.loadFeatureEnabled?.('enableRememberManualQuality') ?? true)) {
        return;
      }
      storeQuality(parsedQuality);
      enhancedSetTimeout_(() => {
        scheduleApplyStoredQuality();
      }, 50);
    } else {
      // Fallback: wait and query player
      enhancedSetTimeout_(() => {
        if (!(U?.loadFeatureEnabled?.('enableRememberManualQuality') ?? true)) {
          return;
        }

        if (menuValue === 'auto' || /\bauto\b|авто/.test(label)) {
          storeQuality('auto');
          return;
        }

        const currentQuality = normalizeQuality(getPlayer()?.getPlaybackQuality?.());
        if (currentQuality) {
          storeQuality(currentQuality);
        }
        scheduleApplyStoredQuality();
      }, 150);
    }
  };

  const handleNavigation = () => {
    lastAppliedVideoId = '';
    scheduleApplyStoredQuality();
  };

  window.YouTubePlusCleanupManager?.registerListener?.(
    document,
    'click',
    handleQualityMenuInteraction,
    true,
    true
  );
  window.YouTubePlusCleanupManager?.registerListener?.(
    document,
    'loadedmetadata',
    event => {
      const target = /** @type {EventTarget | null} */ (event.target);
      if (target instanceof HTMLElement && target.tagName === 'VIDEO') {
        scheduleApplyStoredQuality();
      }
    },
    true,
    true
  );

  window.YouTubePlusCleanupManager?.registerListener?.(
    window,
    'youtube-plus-settings-updated',
    (/** @type {CustomEvent & { changedKeys?: string[] }} */ e) => {
      // A main-settings toggle of the feature must re-apply the remembered
      // quality, so it counts as a change here alongside the module namespace.
      const affectsQuality = window.YouTubePlusSettingsStore?.affectsModule?.(e, MODULE_NAME, [
        'enableRememberManualQuality',
      ]);
      if (affectsQuality === false) return;
      lastAppliedVideoId = '';
      scheduleApplyStoredQuality();
    },
    undefined,
    true
  );

  window.YouTubePlusCleanupManager?.registerListener?.(
    window,
    'yt-navigate-finish',
    handleNavigation,
    {
      passive: true,
    },
    true
  );
  window.YouTubePlusCleanupManager?.registerListener?.(
    window,
    'yp:nav-refresh',
    handleNavigation,
    {
      passive: true,
    },
    true
  );
  onDomReady(scheduleApplyStoredQuality);
})();

// Styles
(function () {
  try {
    if (!isYouTubeHost_()) return;

    const SETTINGS_KEY = U?.SETTINGS_KEY || 'youtube_plus_settings';
    const STYLE_ELEMENT_ID = 'yp-features';
    const NON_CRITICAL_STYLE_ID = 'yp-features-noncritical';
    const STYLE_MANAGER_KEY = 'style-features';
    const NON_CRITICAL_STYLE_MANAGER_KEY = 'style-features-noncritical';
    /** @type {ReturnType<typeof setTimeout> | number | null} */
    let nonCriticalTimer = null;

    const DEFAULTS = {
      enableStyles: true,
      // legacy (kept for backward compat)
      hideSideGuide: false,
      styles: {
        themeVariant: 'vision',
        themeStyle: 'glass',
        thumbnailHover: true,
        immersiveSearch: true,
        hideVoiceSearch: true,
        transparentHeader: true,
        hideSideGuide: true,
        cleanSideGuide: false,
        fixFeedLayout: true,
        sideVideosColumnsEnabled: false,
        sideVideosColumns: 0,
        compactFeed: true,
        betterCaptions: true,
        playerBlur: true,
        theaterEnhancements: true,
      },
    };

    const loadSettings = () => {
      /** @type {Record<string, unknown> | null} */
      let parsed = null;
      try {
        const store = /** @type {{ load?: () => unknown } | undefined} */ (
          window.YouTubePlusSettingsStore
        );
        if (store && typeof store.load === 'function') {
          parsed = /** @type {Record<string, unknown> | null} */ (store.load());
        } else {
          const raw = U.storage?.getItem(SETTINGS_KEY);
          if (raw) parsed = JSON.parse(raw);
        }
      } catch (e) {
        logSEnhanced(e);
        enhancedLogger?.warn?.('Enhanced', 'Styles settings parse error', e);
      }

      const merged = {
        ...DEFAULTS,
        ...(parsed && typeof parsed === 'object' ? parsed : null),
      };

      merged.styles = {
        ...DEFAULTS.styles,
        ...(merged.styles && typeof merged.styles === 'object' ? merged.styles : null),
      };

      // Backward compat: if legacy hideSideGuide is set, also enable the style flag.
      if (merged.hideSideGuide === true && merged.styles.hideSideGuide !== true) {
        merged.styles.hideSideGuide = true;
      }

      const styleCfg = /** @type {Record<string, unknown>} */ (merged.styles);
      // Backward compat: migrate old boolean sideVideosTwoColumns → sideVideosColumns number
      if (
        styleCfg.sideVideosTwoColumns === true &&
        (styleCfg.sideVideosColumns === undefined ||
          styleCfg.sideVideosColumns === null ||
          styleCfg.sideVideosColumns === '')
      ) {
        styleCfg.sideVideosColumns = 2;
      }
      if (styleCfg.sideVideosTwoColumns === true) {
        styleCfg.sideVideosColumnsEnabled = true;
      }
      const parsedSideCols = Number(styleCfg.sideVideosColumns);
      if (!Number.isFinite(parsedSideCols) || parsedSideCols < 0) {
        styleCfg.sideVideosColumns = 0;
      } else {
        styleCfg.sideVideosColumns = parsedSideCols;
      }
      styleCfg.sideVideosColumns = Math.min(2, Number(styleCfg.sideVideosColumns));
      if (typeof styleCfg.sideVideosColumnsEnabled !== 'boolean') {
        styleCfg.sideVideosColumnsEnabled = Number(styleCfg.sideVideosColumns) > 0;
      }

      return merged;
    };

    const CSS_BLOCKS = {
      get thumbnailHover() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-thumbnail-hover') || '';
      },
      get immersiveSearch() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-immersive-search') || '';
      },
      get hideVoiceSearch() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-hide-voice-search') || '';
      },
      get transparentHeader() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-transparent-header') || '';
      },
      get hideSideGuide() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-hide-side-guide') || '';
      },
      get cleanSideGuide() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-clean-side-guide') || '';
      },
      get fixFeedLayout() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-fix-feed-layout') || '';
      },
      // sideVideosColumns CSS is generated dynamically in buildNonCriticalCss
      get betterCaptions() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-better-captions') || '';
      },
      get playerBlur() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-player-blur') || '';
      },
      get theaterEnhancements() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-theater-enhancements') || '';
      },
      get compactFeed() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-compact-feed') || '';
      },
      get themeSolid() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-theme-solid') || '';
      },
      // CLS Prevention styles - always loaded to reserve space for dynamic elements
      get clsPrevention() {
        return window.YouTubePlusDesignSystem?.getStyle?.('yp-cls-prevention') || '';
      },
    };

    // Legacy themeVariant stored a material ('solid'/'glass'); new model stores a
    // layout ('vision'/'classic') + themeStyle. Resolve material from either.
    const isSolidStyle = (/** @type {Record<string, unknown>} */ z) =>
      (z.themeStyle || (z.themeVariant === 'solid' ? 'solid' : 'glass')) === 'solid';

    const buildCriticalCss = (/** @type {Record<string, unknown>} */ settings) => {
      const z = /** @type {Record<string, unknown>} */ (settings?.styles || {});
      let css = CSS_BLOCKS.clsPrevention; // Always include CLS prevention
      if (isSolidStyle(z)) css += CSS_BLOCKS.themeSolid;
      if (z.hideSideGuide) css += CSS_BLOCKS.hideSideGuide;
      if (z.fixFeedLayout) css += CSS_BLOCKS.fixFeedLayout;
      // theaterEnhancements in critical so overlay CSS applies immediately on
      // DOMContentLoaded (waiting for a non-critical pass could delay it by ~5s
      // on theater mode switch).
      if (z.theaterEnhancements) css += CSS_BLOCKS.theaterEnhancements;
      return css.trim();
    };

    /**
     * Apply the side-videos grid CSS vars (column count / card width) and return
     * the design-system grid bundle ('' when the grid is off).
     * @param {Record<string, unknown>} z
     */
    const buildSideVideosGridCss_ = z => {
      const sideColsRaw = Number(z?.sideVideosColumns);
      const sideCols = Number.isFinite(sideColsRaw) ? Math.max(0, Math.min(2, sideColsRaw)) : 0;
      const root = document.documentElement;
      if (!root) return '';
      if (!z?.sideVideosColumnsEnabled || sideCols <= 0) {
        root.style.removeProperty('--yp-side-cols');
        root.style.removeProperty('--yp-side-width');
        return '';
      }
      root.style.setProperty('--yp-side-cols', String(sideCols));
      root.style.setProperty('--yp-side-width', sideCols >= 2 ? '200%' : '100%');
      return window.YouTubePlusDesignSystem?.getStyle?.('yp-side-videos-grid') || '';
    };

    const buildNonCriticalCss = (/** @type {Record<string, unknown>} */ settings) => {
      const z = /** @type {Record<string, unknown>} */ (settings?.styles || {});
      const solid = isSolidStyle(z);
      let css = '';
      if (z.thumbnailHover) css += CSS_BLOCKS.thumbnailHover;
      if (z.immersiveSearch) css += CSS_BLOCKS.immersiveSearch;
      if (z.hideVoiceSearch) css += CSS_BLOCKS.hideVoiceSearch;
      if (z.transparentHeader) css += CSS_BLOCKS.transparentHeader;
      if (z.cleanSideGuide) css += CSS_BLOCKS.cleanSideGuide;
      css += buildSideVideosGridCss_(z);
      if (z.betterCaptions && !solid) css += CSS_BLOCKS.betterCaptions;
      if (z.playerBlur) css += CSS_BLOCKS.playerBlur;
      if (z.compactFeed) css += CSS_BLOCKS.compactFeed;
      return css.trim();
    };

    const removeStyles = () => {
      if (U?.StyleManager?.remove) {
        U.StyleManager.remove(STYLE_MANAGER_KEY);
        U.StyleManager.remove(NON_CRITICAL_STYLE_MANAGER_KEY);
      }

      if (nonCriticalTimer) {
        if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(/** @type {number} */ (nonCriticalTimer));
        } else {
          clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (nonCriticalTimer));
        }
        nonCriticalTimer = null;
      }

      byId(STYLE_ELEMENT_ID)?.remove();
      byId(NON_CRITICAL_STYLE_ID)?.remove();
      document.documentElement?.style.removeProperty('--yp-side-cols');
      document.documentElement?.style.removeProperty('--yp-side-width');
    };

    const applyNonCriticalStyles = (/** @type {string} */ css) => {
      const SM = U?.StyleManager;
      if (SM && typeof SM.add === 'function') {
        SM.add(NON_CRITICAL_STYLE_MANAGER_KEY, css || '');
        const legacy = byId(NON_CRITICAL_STYLE_ID);
        if (legacy) legacy.remove();
      }
    };

    const cancelNonCriticalTimer_ = () => {
      if (!nonCriticalTimer) return;
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(/** @type {number} */ (nonCriticalTimer));
      } else {
        clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (nonCriticalTimer));
      }
      nonCriticalTimer = null;
    };

    const scheduleNonCriticalStyles_ = (
      /** @type {string} */ nonCriticalCss,
      /** @type {boolean} */ immediate
    ) => {
      if (immediate) {
        applyNonCriticalStyles(nonCriticalCss);
        nonCriticalTimer = null;
        return;
      }
      if (typeof requestIdleCallback === 'function') {
        nonCriticalTimer = requestIdleCallback(() => applyNonCriticalStyles(nonCriticalCss), {
          timeout: 5000,
        });
      } else {
        nonCriticalTimer = enhancedSetTimeout_(() => applyNonCriticalStyles(nonCriticalCss), 200);
      }
    };

    const applyStyles = (
      /** @type {Record<string, unknown>} */ settings,
      immediateNonCritical = false
    ) => {
      const enabled = settings?.enableStyles !== false;
      if (!enabled) {
        removeStyles();
        return;
      }

      const criticalCss = buildCriticalCss(settings);
      const nonCriticalCss = buildNonCriticalCss(settings);
      if (!(criticalCss || nonCriticalCss)) {
        removeStyles();
        return;
      }

      if (U?.StyleManager?.add) {
        U.StyleManager.add(STYLE_MANAGER_KEY, criticalCss || '');
        byId(STYLE_ELEMENT_ID)?.remove();
        cancelNonCriticalTimer_();
        scheduleNonCriticalStyles_(nonCriticalCss, immediateNonCritical);
      }
    };

    const applyFromStorage = (immediateNonCritical = false) =>
      applyStyles(loadSettings(), immediateNonCritical);

    // Initial apply
    applyFromStorage(true);

    // Live updates
    // Dynamic will-change for yt-searchbox: only active during focus to avoid constant GPU layers
    const _applySearchboxWillChange = () => {
      const sb = $('yt-searchbox');
      if (sb instanceof HTMLElement) sb.style.willChange = 'transform';
    };
    const _clearSearchboxWillChange = () => {
      const sb = $('yt-searchbox');
      if (sb instanceof HTMLElement) sb.style.willChange = '';
    };
    /** @param {Event} e */
    const _focusinHandler = e => {
      if (e.target instanceof Element && e.target.closest('yt-searchbox')) {
        _applySearchboxWillChange();
      }
    };
    /** @param {Event} e */
    const _focusoutHandler = e => {
      if (e.target instanceof Element && e.target.closest('yt-searchbox')) {
        _clearSearchboxWillChange();
      }
    };
    window.YouTubePlusCleanupManager?.registerListener?.(
      document,
      'focusin',
      _focusinHandler,
      { passive: true, capture: true },
      true
    );
    window.YouTubePlusCleanupManager?.registerListener?.(
      document,
      'focusout',
      _focusoutHandler,
      { passive: true, capture: true },
      true
    );
    if (U?.cleanupManager?.register) {
      U.cleanupManager.register(() => {
        document.removeEventListener('focusin', _focusinHandler, {
          capture: true,
        });
        document.removeEventListener('focusout', _focusoutHandler, {
          capture: true,
        });
      });
    }

    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'youtube-plus-settings-updated',
      (/** @type {CustomEvent<{ [key: string]: unknown }> | Event} */ e) => {
        const detail = 'detail' in e ? e.detail : null;
        applyStyles(detail || loadSettings(), true);
      },
      undefined,
      true
    );

    // YouTube SPA re-mounts layout containers on navigation; re-apply from
    // storage to keep the global interface styles (e.g. transparent header, hover preview)
    // active on all pages, not only the initial route.
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'yt-navigate-finish',
      () => {
        applyFromStorage(true);
      },
      { passive: true },
      true
    );
  } catch (err) {
    logSEnhanced(err);
    enhancedLogger?.error?.('Enhanced', 'youtube-styles injection failed', err);
  }
})();

// Theater overlay runtime fixes
// 1) Auto-expand live chat in theater overlay (avoid "Show chat" placeholder)
// 2) Preload comments content so the floating comments panel is not empty
(function () {
  if (!isYouTubeHost_()) return;

  const SETTINGS_KEY = U?.SETTINGS_KEY || 'youtube_plus_settings';

  const readSettings = () => {
    try {
      const store = /** @type {{ load?: () => unknown } | undefined} */ (
        window.YouTubePlusSettingsStore
      );
      if (store && typeof store.load === 'function') {
        return store.load();
      }
      const raw = U.storage?.getItem(SETTINGS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_e) {
      logSEnhanced(_e);
      return null;
    }
  };

  const isTheaterEnhancementEnabled = () => {
    const settings = readSettings();
    if (!settings) return true;
    if (settings.enableStyles === false) return false;
    if (settings.styles && settings.styles.theaterEnhancements === false) return false;
    return true;
  };

  const runOverlayFixes = () => {
    if (!(U?.isWatchPage?.() ?? false)) return;
    if (!isTheaterEnhancementEnabled()) return;

    const flexy = $('ytd-watch-flexy');
    if (!flexy || flexy.hasAttribute('fullscreen')) return;
    const isTheaterLike =
      flexy.hasAttribute('theater') ||
      flexy.hasAttribute('full-bleed-player') ||
      flexy.hasAttribute('theater-requested_');
    if (!isTheaterLike) return;

    // Both operations are owned by the tabview core (page context): it holds the
    // Polymer handles for the chat frame and the lock that guards
    // keep-comments-scroller. Calling them from here would bypass that lock and
    // could strand the attribute, permanently disabling comment pre-loading.
    const tabview = window.YouTubePlusMain;
    tabview?.expandLiveChat?.();
    tabview?.preloadComments?.();
  };

  /** @type {ReturnType<typeof setTimeout> | null} */
  let debounceTimer = null;
  const scheduleRun =
    U?.debounce && typeof U.debounce === 'function'
      ? U.debounce(runOverlayFixes, 150)
      : () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = enhancedSetTimeout_(runOverlayFixes, 150);
        };

  // Observer targets exclude the document.body subtree, which fires hundreds of times during page parse.
  const setupOverlayObservers = () => {
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (!coordinator?.watchTarget) return;

    // Observer 1: watch ytd-watch-flexy for theater / fullscreen attribute changes
    const flexyObserverId = 'enhanced::overlayFlexy';
    /** @type {Element | null} */
    let observedFlexy = null;

    const attachFlexyObserver = () => {
      const flexy = $('ytd-watch-flexy');
      if (flexy && flexy !== observedFlexy) {
        coordinator.watchTarget(flexyObserverId, flexy, scheduleRun, {
          attributes: true,
          childList: false,
          subtree: false,
          attributeFilter: ['theater', 'full-bleed-player', 'theater-requested_', 'fullscreen'],
        });
        observedFlexy = flexy;
      }
    };

    // Observer 2: watch #chat for [collapsed] changes
    // (CSS handles display; observer just schedules overlay fixes like comment preloading)
    const chatObserverId = 'enhanced::overlayChat';
    /** @type {Element | null} */
    let observedChat = null;

    const attachChatObserver = () => {
      const chat = $('ytd-live-chat-frame#chat');
      if (chat && chat !== observedChat) {
        coordinator.watchTarget(chatObserverId, chat, scheduleRun, {
          attributes: true,
          childList: false,
          subtree: false,
          attributeFilter: ['collapsed'],
        });
        observedChat = chat;
      }
    };

    attachFlexyObserver();
    attachChatObserver();

    // Re-attach after SPA navigation (new flexy/chat elements are created)
    const _navFinishHandler = () => {
      enhancedSetTimeout_(() => {
        attachFlexyObserver();
        attachChatObserver();
        scheduleRun();
      }, 180);
    };
    if (U?.cleanupManager?.registerListener) {
      U.cleanupManager.registerListener(
        window,
        'yt-navigate-finish',
        _navFinishHandler,
        { passive: true },
        true
      );
    } else {
      window.YouTubePlusCleanupManager?.registerListener?.(
        window,
        'yt-navigate-finish',
        _navFinishHandler,
        { passive: true },
        true
      );
    }

    if (U?.cleanupManager?.register) {
      U.cleanupManager.register(() => {
        coordinator.unwatch(flexyObserverId);
        coordinator.unwatch(chatObserverId);
      });
    }
  };

  // Defer observer setup to after DOMContentLoaded so it does NOT fire during page parse
  // (observing document.documentElement at document-start fires hundreds of times and hurts LCP)
  const _bootstrapEnhanced = withErrorBoundary(() => {
    scheduleRun();
    setupOverlayObservers();
  }, 'bootstrap');
  if (document.readyState === 'loading') {
    window.YouTubePlusCleanupManager?.registerListener?.(
      document,
      'DOMContentLoaded',
      _bootstrapEnhanced,
      { once: true },
      true
    );
  } else {
    _bootstrapEnhanced();
  }
})();
