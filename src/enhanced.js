// Enhanced Tabviews — canonical tab-switching, description, and
//   engagement-panel orchestration for the YTP tabview overlay.
//
// Responsibility: DOM helpers shared across IIFEs (top-button click,
//   tab-button click, dislike-button restoration, inline-expander
//   state management). No public window symbol; consumes
//   YouTubeUtils.$/$$/byId/helpers at file scope.
// Public surface: none (self-contained IIFEs, no LazyLoader).
const enhancedSetTimeout_ = setTimeout;
const { $, $$, byId } = window.YouTubeUtils || {};
const onDomReady = window.YouTubeUtils.onDomReady;
const enhancedLogger = window.YouTubeUtils?.logger || window.YouTubePlusLogger || null;
const U = window.YouTubeUtils;

// Enhanced Tabviews
(function () {
  const _setSafeHTML = U.setSafeHTML;
  const _getLanguage = U.getLanguage;

  // Shared translation helper from YouTubeUtils
  const t = U?.t || ((/** @type {string} */ key) => key || '');

  /**
   * Configuration object for scroll-to-top button
   * @type {Object}
   * @property {boolean} enabled - Whether the feature is enabled
   * @property {string} storageKey - LocalStorage key for settings
   */
  /** @type {any} */
  const config = {
    enabled: U?.loadFeatureEnabled?.('enableScrollToTopButton') ?? true,
    storageKey: 'youtube_top_button_settings',
  };

  // Shared debounce helper — prefers YouTubeUtils, falls back to shared defaults
  const _debounce = U.debounce;

  const isTabviewEnabled = () => U?.loadFeatureEnabled?.('enableTabview') ?? true;

  /** @type {any} */
  let universalScrollHandler = null;
  /** @type {any} */
  let universalScrollContainer = null;
  const universalExtraScrollTargets = new Set();
  /** @type {Array<ReturnType<typeof setTimeout>>} */
  let universalAttachTimeoutIds = [];

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
    try {
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
    } catch (e) {
      enhancedLogger?.warn?.('Enhanced', 'Error detecting scroll container', e);
    }
    return document.scrollingElement || document.documentElement;
  };

  /** @type {any} */
  let universalWindowScrollHandler = null;

  const removeUniversalButton = () => {
    try {
      const btn = byId('universal-top-button');
      if (btn) btn.remove();
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    try {
      if (universalScrollHandler && universalScrollContainer) {
        universalScrollContainer.removeEventListener('scroll', universalScrollHandler);
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    try {
      if (universalWindowScrollHandler) {
        window.removeEventListener('scroll', universalWindowScrollHandler);
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    try {
      if (universalWindowScrollHandler && universalExtraScrollTargets.size) {
        for (const target of universalExtraScrollTargets) {
          try {
            target.removeEventListener('scroll', universalWindowScrollHandler);
            if (/** @type {any} */ (target)._ytpScrollAttached) {
              /** @type {any} */ (target)._ytpScrollAttached = false;
            }
          } catch (_e) {
            U.logSuppressed(_e, 'Enhanced');
          }
        }
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    try {
      if (universalAttachTimeoutIds.length) {
        universalAttachTimeoutIds.forEach(id => clearTimeout(id));
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    universalScrollHandler = null;
    universalScrollContainer = null;
    universalWindowScrollHandler = null;
    universalExtraScrollTargets.clear();
    universalAttachTimeoutIds = [];
  };

  /** @type {any} */
  let musicSideScrollHandler = null;
  /** @type {any} */
  let musicSideScrollContainer = null;

  const getMusicSidePanelContainer = () => {
    if (!U?.isMusicDomain?.()) return null;

    // Direct selectors for the queue/side panel content
    const directSelectors = [
      'ytmusic-player-queue #contents',
      'ytmusic-player-queue',
      '#side-panel #contents',
      '#side-panel',
      'ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_QUEUE"] #contents',
      'ytmusic-queue #automix-contents',
      'ytmusic-queue #contents',
    ];

    for (const sel of directSelectors) {
      try {
        const el = $(sel);
        if (el && el.scrollHeight > el.clientHeight + 30) return el;
      } catch (_e) {
        U.logSuppressed(_e, 'Enhanced');
      }
    }

    // Try within specific roots
    const roots = [$('ytmusic-player-page'), $('ytmusic-app-layout'), $('ytmusic-app')];
    const selectors = [
      '#side-panel',
      '#right-content',
      'ytmusic-player-queue',
      'ytmusic-queue',
      'ytmusic-tab-renderer[selected] #contents',
      '.side-panel',
    ];

    for (const root of roots) {
      if (!root) continue;
      for (const sel of selectors) {
        try {
          const el = root.querySelector(sel);
          if (el && el.scrollHeight > el.clientHeight + 30) return el;
        } catch (_e) {
          U.logSuppressed(_e, 'Enhanced');
        }
      }
    }
    return null;
  };

  const removeMusicSideButton = () => {
    try {
      const btn = byId('music-side-top-button');
      if (btn) btn.remove();
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    try {
      if (musicSideScrollHandler && musicSideScrollContainer) {
        musicSideScrollContainer.removeEventListener('scroll', musicSideScrollHandler);
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    musicSideScrollHandler = null;
    musicSideScrollContainer = null;
  };

  const cleanupTopButtons = () => {
    try {
      const rightButton = byId('right-tabs-top-button');
      if (rightButton) rightButton.remove();
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    try {
      const playlistButton = byId('playlist-panel-top-button');
      if (playlistButton) playlistButton.remove();
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }

    removeMusicSideButton();

    removeUniversalButton();

    try {
      $$('#right-tabs .tab-content-cld').forEach(tab => {
        if (tab?._topButtonScrollHandler) {
          tab.removeEventListener('scroll', tab._topButtonScrollHandler);
          tab._topButtonScrollHandler = null;
        }
      });
    } catch (e) {
      enhancedLogger?.warn?.('Enhanced', 'Error cleaning up tab scroll handlers', e);
    }

    try {
      // #right-tabs itself may be the scroll host on single-column layout
      const rightTabsEl = byId('right-tabs');
      if (rightTabsEl) {
        if (rightTabsEl._topButtonScrollHandler) {
          rightTabsEl.removeEventListener('scroll', rightTabsEl._topButtonScrollHandler);
          rightTabsEl._topButtonScrollHandler = null;
        }
        if (rightTabsEl._scrollCleanup) {
          rightTabsEl._scrollCleanup();
          rightTabsEl._scrollCleanup = null;
        }
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }

    try {
      const playlistScroll = $('ytd-playlist-panel-renderer #items');
      if (playlistScroll?._topButtonScrollHandler) {
        playlistScroll.removeEventListener('scroll', playlistScroll._topButtonScrollHandler);
        playlistScroll._topButtonScrollHandler = null;
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
  };

  /** @type {string | null} */
  let tabChangesObserver = null;
  let watchInitToken = 0;
  let isTabClickListenerAttached = false;
  /** @type {any} */
  let tabDelegationHandler = null;
  let tabDelegationRegistered = false;
  /** @type {any} */
  let tabCheckTimeoutId = null;
  /** @type {any} */
  let playlistPanelCheckTimeoutId = null;
  /** @type {string | null} */
  let musicSidePanelSubId = null;

  const shouldInitReturnDislike = () =>
    (U?.isWatchPage?.() ?? false) || (U?.isShortsPage?.() ?? false);

  const isTopButton = (/** @type {any} */ el) =>
    el &&
    (el.id === 'right-tabs-top-button' ||
      el.id === 'universal-top-button' ||
      el.id === 'playlist-panel-top-button' ||
      el.id === 'music-side-top-button');

  const handleTopButtonActivate = (/** @type {any} */ button) => {
    try {
      if (!button) return;

      if (button.id === 'right-tabs-top-button') {
        // Always use direct DOM query here — class-based selectors may be stale in cache
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
          if ('scrollBehavior' in /** @type {any} */ (document.documentElement.style || {})) {
            scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            scrollTarget.scrollTop = 0;
          }
          button.setAttribute('aria-label', 'Scrolled to top');
          enhancedSetTimeout_(() => {
            button.setAttribute('aria-label', t('scrollToTop'));
          }, 1000);
        }
        return;
      }

      if (button.id === 'universal-top-button') {
        // Always re-detect container on Music/Studio since SPA navigation changes it
        const host = U?.getHostname?.() || '';
        const isMusic = host === 'music.youtube.com';
        const isStudio = host === 'studio.youtube.com';
        const target =
          isMusic || isStudio
            ? getUniversalScrollContainer()
            : universalScrollContainer || getUniversalScrollContainer();

        // Try multiple scroll strategies for YouTube Music
        const scrollToTop = (/** @type {any} */ el) => {
          if ('scrollBehavior' in /** @type {any} */ (document.documentElement.style || {})) {
            el.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            el.scrollTop = 0;
          }
        };

        if (
          target === window ||
          target === document ||
          target === document.body ||
          target === document.documentElement
        ) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (target && typeof target.scrollTo === 'function') {
          scrollToTop(target);
        }

        // For YouTube Music: also scroll window and common inner containers
        if (isMusic) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          for (const c of resolveMusicContainers()) {
            if (c && c.scrollTop > 0) {
              scrollToTop(c);
            }
          }
        }
        return;
      }

      if (button.id === 'playlist-panel-top-button') {
        const playlistPanel = $('ytd-playlist-panel-renderer');
        const scrollContainer = playlistPanel
          ? $('#items', /** @type {any} */ (playlistPanel))
          : null;
        if (scrollContainer) {
          if ('scrollBehavior' in /** @type {any} */ (document.documentElement.style || {})) {
            scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            scrollContainer.scrollTop = 0;
          }
        }
        return;
      }

      if (button.id === 'music-side-top-button') {
        // Always re-detect since panel content changes with navigation
        const target = getMusicSidePanelContainer() || musicSideScrollContainer;
        if (target) {
          if ('scrollBehavior' in /** @type {any} */ (document.documentElement.style || {})) {
            target.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            target.scrollTop = 0;
          }
        }
      }
    } catch (error) {
      enhancedLogger?.error?.('Enhanced', 'Error scrolling to top', error);
    }
  };

  const setupTopButtonDelegation = (() => {
    let attached = false;
    return () => {
      if (attached) return;
      attached = true;

      const delegator = window.YouTubePlusEventDelegation;
      if (delegator?.on) {
        delegator.on(
          document,
          'click',
          '.top-button',
          (/** @type {any} */ _ev, /** @type {any} */ target) => {
            if (isTopButton(target)) handleTopButtonActivate(target);
          }
        );
        delegator.on(
          document,
          'keydown',
          '.top-button',
          (/** @type {any} */ ev, /** @type {any} */ target) => {
            if (!isTopButton(target)) return;
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              handleTopButtonActivate(target);
            }
          }
        );
      } else {
        const _cm = U?.cleanupManager;
        const _clickHandler = (/** @type {any} */ ev) => {
          const target = ev.target?.closest?.('.top-button');
          if (isTopButton(target)) handleTopButtonActivate(target);
        };
        const _keyHandler = (/** @type {any} */ ev) => {
          const target = ev.target?.closest?.('.top-button');
          if (!isTopButton(target)) return;
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            handleTopButtonActivate(target);
          }
        };
        if (_cm?.registerListener) {
          _cm.registerListener(document, 'click', _clickHandler, true);
          _cm.registerListener(document, 'keydown', _keyHandler, true);
        } else {
          document.addEventListener('click', _clickHandler, true);
          document.addEventListener('keydown', _keyHandler, true);
        }
      }
    };
  })();

  const clearTimeoutSafe = (/** @type {any} */ id) => {
    if (id) clearTimeout(id);
    return null;
  };

  /**
   * Adds CSS styles for scroll-to-top button and scrollbars.
   * Prefers the canonical design-system StyleManager so this CSS shares the
   * single style host with the rest of the design system. Idempotent via
   * StyleManager.add (last write wins, no-op when css is unchanged).
   * @returns {void}
   */
  const addStyles = () => {
    try {
      const SM = U?.StyleManager;
      if (SM && typeof SM.add === 'function') {
        const css = window.YouTubePlusDesignSystem?.getStyle?.('ytp-enhanced-styles') || '';
        SM.add('ytp-enhanced-styles', css);
        // Legacy cleanup: earlier versions injected a standalone
        // <style id="custom-styles"> element. Remove any such leftover so
        // users upgrading from older releases don't keep stale CSS in the
        // DOM. Safe no-op when the element is absent.
        const legacy = byId('custom-styles');
        if (legacy) legacy.remove();
      }
    } catch (e) {
      enhancedLogger?.warn?.('Enhanced', 'Failed to inject enhanced styles via StyleManager', e);
    }
  };

  /**
   * Updates button visibility based on scroll position
   * @param {HTMLElement} scrollContainer - The container being scrolled
   * @param {HTMLElement} button - The button element
   * @returns {void}
   */
  const handleScroll = (scrollContainer, button) => {
    try {
      if (!(button && scrollContainer)) return;
      button.classList.toggle('visible', scrollContainer.scrollTop > 100);
    } catch (error) {
      enhancedLogger?.error?.('Enhanced', 'Error in handleScroll', error);
    }
  };

  /**
   * Sets up scroll event listener on active tab with debouncing for performance
   * Uses IntersectionObserver when possible for better performance
   * @returns {void}
   */
  const setupScrollListener = (() => {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeout = null;
    return () => {
      if (timeout) clearTimeout(timeout);
      timeout = enhancedSetTimeout_(() => {
        try {
          // Clean up old listeners first
          $$('.tab-content-cld').forEach(tab => {
            if (tab._topButtonScrollHandler) {
              tab.removeEventListener('scroll', tab._topButtonScrollHandler);
              delete tab._topButtonScrollHandler;
            }

            // Clean up IntersectionObserver if exists
            if (tab._scrollObserver) {
              tab._scrollObserver.disconnect();
              delete tab._scrollObserver;
            }

            // Use ScrollManager if available
            window.YouTubePlusScrollManager?.removeAllListeners?.(tab);
          });

          // Also remove any direct #right-tabs scroll handler from a previous run
          try {
            const prevRtEl = byId('right-tabs');
            if (prevRtEl) {
              if (prevRtEl._topButtonScrollHandler) {
                prevRtEl.removeEventListener('scroll', prevRtEl._topButtonScrollHandler);
                delete prevRtEl._topButtonScrollHandler;
              }
              if (prevRtEl._scrollCleanup) {
                prevRtEl._scrollCleanup();
                delete prevRtEl._scrollCleanup;
              }
            }
          } catch (e) {
            enhancedLogger?.warn?.('Enhanced', 'Error cleaning up right-tabs scroll handler', e);
          }

          // Always use direct DOM query — class-based ':not(.tab-content-hidden)' selectors
          // can return a stale cached element (the previously-active tab, which is still in
          // the DOM but now hidden). A direct query guarantees the correct live result.
          const activeTab = $('#right-tabs .tab-content-cld:not(.tab-content-hidden)');
          const button = byId('right-tabs-top-button');

          if (activeTab && button) {
            // On single-column layouts, #right-tabs itself has overflow:auto and acts as
            // the scroll host. In that case the individual tab <div> never gets scrollTop>0.
            // Detect which element is actually scrollable and attach the listener there.
            const rightTabsEl = byId('right-tabs');
            const rtIsScrollHost =
              rightTabsEl &&
              rightTabsEl !== activeTab &&
              rightTabsEl.scrollHeight > rightTabsEl.clientHeight + 10;
            const scrollTarget = rtIsScrollHost ? rightTabsEl : activeTab;

            // Use ScrollManager if available for better performance
            if (window.YouTubePlusScrollManager) {
              const cleanup = window.YouTubePlusScrollManager.addScrollListener(
                /** @type {any} */ (scrollTarget),
                () =>
                  handleScroll(
                    /** @type {any} */ (scrollTarget),
                    /** @type {HTMLElement} */ (button)
                  ),
                { debounce: 100, runInitial: true }
              );
              scrollTarget._scrollCleanup = cleanup;
            } else {
              // Fallback to manual debouncing
              const scrollHandler = _debounce(
                () =>
                  handleScroll(
                    /** @type {any} */ (scrollTarget),
                    /** @type {HTMLElement} */ (button)
                  ),
                100
              );
              scrollTarget._topButtonScrollHandler = scrollHandler;
              scrollTarget.addEventListener('scroll', scrollHandler, {
                passive: true,
                capture: false,
              });
              handleScroll(/** @type {any} */ (scrollTarget), /** @type {HTMLElement} */ (button));
            }
          }
        } catch (error) {
          enhancedLogger?.error?.('Enhanced', 'Error in setupScrollListener', error);
        }
      }, 100);
    };
  })();

  /**
   * Creates and appends scroll-to-top button with error handling
   * @returns {void}
   */
  const createButton = () => {
    try {
      setupTopButtonDelegation();
      const rightTabs = $('#right-tabs');
      if (!rightTabs || byId('right-tabs-top-button')) return;
      if (!config.enabled) return;

      const button = document.createElement('button');
      button.id = 'right-tabs-top-button';
      button.className = 'top-button';
      button.title = t('scrollToTop');
      button.setAttribute('aria-label', t('scrollToTop'));
      _setSafeHTML(
        button,
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>'
      );

      /** @type {any} */ (rightTabs).style.position = 'relative';
      rightTabs.appendChild(button);
      setupScrollListener();
    } catch (error) {
      enhancedLogger?.error?.('Enhanced', 'Error creating button', error);
    }
  };

  /**
   * Creates universal scroll-to-top button for pages
   * @returns {void}
   */
  const createUniversalButton = () => {
    try {
      setupTopButtonDelegation();
      if (byId('universal-top-button')) return;
      if (!config.enabled) return;

      const rawContainer = getUniversalScrollContainer();
      const scrollContainer =
        rawContainer === document.scrollingElement ||
        rawContainer === document.documentElement ||
        rawContainer === document.body
          ? window
          : rawContainer;
      universalScrollContainer = scrollContainer;

      const button = document.createElement('button');
      button.id = 'universal-top-button';
      button.className = 'top-button';
      button.title = t('scrollToTop');
      button.setAttribute('aria-label', t('scrollToTop'));
      _setSafeHTML(
        button,
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>'
      );

      // Ensure the button is above YouTube Music/Studio overlays
      const host = U?.getHostname?.() || '';
      if (host === 'music.youtube.com' || host === 'studio.youtube.com') {
        /** @type {any} */ (button).style.zIndex = '10000';
      }

      document.body.appendChild(button);

      // Setup scroll listener for the active container
      const scrollHandler = _debounce(() => {
        const offset = scrollContainer === window ? window.scrollY : scrollContainer.scrollTop;
        button.classList.toggle('visible', offset > 100);
      }, 100);

      universalScrollHandler = scrollHandler;
      scrollContainer.addEventListener('scroll', scrollHandler, {
        passive: true,
      });

      const initialOffset = scrollContainer === window ? window.scrollY : scrollContainer.scrollTop;
      button.classList.toggle('visible', initialOffset > 100);

      // For YouTube Music/Studio: listen on multiple scroll targets
      // since the actual scrollable container may differ per page
      if (host === 'music.youtube.com' || host === 'studio.youtube.com') {
        const getMusicContainers = () => {
          const base = resolveMusicContainers();
          if (
            scrollContainer !== window &&
            scrollContainer instanceof Element &&
            !base.includes(/** @type {any} */ (scrollContainer))
          ) {
            return [...base, /** @type {any} */ (scrollContainer)];
          }
          return base;
        };

        const musicScrollCheck = _debounce(() => {
          let anyScrolled = window.scrollY > 100;
          if (!anyScrolled) {
            for (const c of getMusicContainers()) {
              if (c.scrollTop > 100) {
                anyScrolled = true;
                break;
              }
            }
          }
          button.classList.toggle('visible', anyScrolled);
        }, 100);

        // Listen on window + key music containers
        window.addEventListener('scroll', musicScrollCheck, { passive: true });
        universalWindowScrollHandler = musicScrollCheck;

        // Also attach to known music containers as they become available
        const attachMusicScrollListeners = () => {
          const targets = [$('ytmusic-app-layout #layout'), $('ytmusic-app-layout')];
          for (const target of targets) {
            if (target && !(/** @type {any} */ (target)._ytpScrollAttached)) {
              /** @type {any} */ (target)._ytpScrollAttached = true;
              target.addEventListener('scroll', musicScrollCheck, {
                passive: true,
              });
              universalExtraScrollTargets.add(target);
            }
          }
        };
        attachMusicScrollListeners();
        // Re-attach after navigation
        universalAttachTimeoutIds.push(enhancedSetTimeout_(attachMusicScrollListeners, 1000));
        universalAttachTimeoutIds.push(enhancedSetTimeout_(attachMusicScrollListeners, 3000));
      }
    } catch (error) {
      enhancedLogger?.error?.('Enhanced', 'Error creating universal button', error);
    }
  };

  /**
   * Creates scroll-to-top button for playlist panel
   * @returns {void}
   */
  const createPlaylistPanelButton = () => {
    try {
      setupTopButtonDelegation();
      const playlistPanel = $('ytd-playlist-panel-renderer');
      if (!playlistPanel || byId('playlist-panel-top-button')) return;
      if (!config.enabled) return;

      const button = document.createElement('button');
      button.id = 'playlist-panel-top-button';
      button.className = 'top-button';
      button.title = t('scrollToTop');
      button.setAttribute('aria-label', t('scrollToTop'));
      _setSafeHTML(
        button,
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>'
      );

      const scrollContainer = $('#items', /** @type {any} */ (playlistPanel));
      if (!scrollContainer) return;

      // Ensure the playlist panel is positioned so absolute children are anchored inside it
      /** @type {any} */ (playlistPanel).style.position =
        /** @type {any} */ (playlistPanel).style.position || 'relative';

      // Force the button to be positioned inside the playlist panel (override global fixed)
      Object.assign(/** @type {any} */ (button).style, {
        position: 'absolute',
        bottom: '16px',
        right: '16px',
        zIndex: '1000',
      });

      playlistPanel.appendChild(button);

      // Setup scroll listener
      const scrollHandler = _debounce(
        () =>
          handleScroll(
            /** @type {HTMLElement} */ (scrollContainer),
            /** @type {HTMLElement} */ (button)
          ),
        100
      );
      scrollContainer._topButtonScrollHandler = scrollHandler;
      scrollContainer.addEventListener('scroll', scrollHandler, {
        passive: true,
      });
      handleScroll(
        /** @type {HTMLElement} */ (scrollContainer),
        /** @type {HTMLElement} */ (button)
      );

      // Hide the button when the playlist panel is collapsed/hidden.
      // Use ResizeObserver + MutationObserver to detect layout/attribute changes.
      const updateVisibility = () => {
        try {
          // If panel not connected or explicitly hidden, hide the button
          if (!playlistPanel.isConnected || playlistPanel.hidden) {
            /** @type {any} */ (button).style.display = 'none';
            return;
          }

          // Use offsetParent check (cheaper than getComputedStyle) - null means hidden
          if (
            playlistPanel.offsetParent === null &&
            /** @type {any} */ (playlistPanel).style.position !== 'fixed'
          ) {
            /** @type {any} */ (button).style.display = 'none';
            return;
          }

          // If bounding box is too small (collapsed), hide button
          const { width, height } = playlistPanel.getBoundingClientRect();
          if (width < 40 || height < 40) {
            /** @type {any} */ (button).style.display = 'none';
            return;
          }

          // If items container cannot scroll or has no height, hide button
          if (
            !scrollContainer ||
            scrollContainer.offsetHeight === 0 ||
            scrollContainer.scrollHeight === 0
          ) {
            /** @type {any} */ (button).style.display = 'none';
            return;
          }

          // Otherwise keep normal display and let handleScroll control visibility class
          /** @type {any} */ (button).style.display = '';
        } catch (_e) {
          // On error, prefer hiding to avoid stray UI
          try {
            /** @type {any} */ (button).style.display = 'none';
          } catch (_e) {
            U.logSuppressed(_e, 'Enhanced');
          }
        }
      };

      // Observe size changes
      let ro = null;
      try {
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(updateVisibility);
          ro.observe(/** @type {Element} */ (playlistPanel));
          if (scrollContainer) ro.observe(/** @type {Element} */ (scrollContainer));
        }
      } catch (_e) {
        ro = null;
      }

      // Observe attribute/class changes via centralized coordinator.
      const coordinator = window.YouTubePlusMutationCoordinator;
      if (coordinator?.watchTarget) {
        coordinator.watchTarget(
          'enhanced::playlistPanelVisibility',
          playlistPanel,
          updateVisibility,
          {
            attributes: true,
            childList: false,
            subtree: false,
            attributeFilter: ['class', 'style', 'hidden'],
          }
        );
      }

      // Initial visibility pass
      updateVisibility();

      // Register cleanup for ResizeObserver when available
      try {
        if (U && YouTubeUtils.cleanupManager) {
          if (ro) {
            YouTubeUtils.cleanupManager.register(() => {
              try {
                ro.disconnect();
              } catch (_e) {
                U.logSuppressed(_e, 'Enhanced');
              }
            });
          }
        }
      } catch (_e) {
        U.logSuppressed(_e, 'Enhanced');
      }
    } catch (error) {
      enhancedLogger?.error?.('Enhanced', 'Error creating playlist panel button', error);
    }
  };

  /**
   * Creates scroll-to-top button for YouTube Music side panel
   * @returns {void}
   */
  const createMusicSidePanelButton = () => {
    try {
      if (!U?.isMusicDomain?.()) return;
      setupTopButtonDelegation();
      if (byId('music-side-top-button')) return;
      if (!config.enabled) return;

      const panel = getMusicSidePanelContainer();
      if (!panel) {
        // Retry with scheduler since YouTube Music loads content dynamically
        U?.createRetryScheduler?.({
          check: () => {
            if (byId('music-side-top-button') || !config.enabled) return true;
            return !!getMusicSidePanelContainer() && (createMusicSidePanelButton(), true);
          },
          maxAttempts: 8,
          interval: 500,
        });
        return;
      }

      const button = document.createElement('button');
      button.id = 'music-side-top-button';
      button.className = 'top-button';
      button.title = t('scrollToTop');
      button.setAttribute('aria-label', t('scrollToTop'));
      _setSafeHTML(
        button,
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>'
      );

      /** @type {any} */ (panel).style.position =
        /** @type {any} */ (panel).style.position || 'relative';
      Object.assign(/** @type {any} */ (button).style, {
        position: 'absolute',
        bottom: '16px',
        right: '16px',
        zIndex: '1000',
      });

      panel.appendChild(button);

      const scrollHandler = _debounce(() => {
        button.classList.toggle('visible', panel.scrollTop > 100);
      }, 100);

      musicSideScrollContainer = panel;
      musicSideScrollHandler = scrollHandler;
      panel.addEventListener('scroll', scrollHandler, { passive: true });
      button.classList.toggle('visible', panel.scrollTop > 100);
    } catch (error) {
      enhancedLogger?.error?.('Enhanced', 'Error creating music side button', error);
    }
  };

  // --- Return YouTube Dislike integration ---
  const RETURN_DISLIKE_API = 'https://returnyoutubedislikeapi.com/votes';
  const DISLIKE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  const dislikeCache = new Map(); // videoId -> { value, expiresAt }
  /** @type {MutationObserver | null} */
  let dislikeDirectObserver = null;
  /** @type {string | null} */
  let dislikePollTimer = null;
  /** @type {any} */
  let dislikeFallbackIntervalId = null;
  /** @type {HTMLElement | null} */
  let observedDislikeButton = null;

  /** @returns {Element | null} */
  const queryShadow = (/** @type {any} */ element, /** @type {string} */ selector) => {
    if (!element) return null;
    const root = element.shadowRoot || element;
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
    /** @type {any} */ root,
    /** @type {string} */ selector,
    /** @type {any[]} */ results = []
  ) => {
    if (!root) return results;
    if (root.querySelectorAll) {
      const found = root.querySelectorAll(selector);
      for (const el of found) results.push(el);
    }
    const children = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const child of children) {
      if (child.shadowRoot) {
        findAllInShadow(child.shadowRoot, selector, results);
      }
    }
    return results;
  };

  const formatCompactNumber = (/** @type {any} */ number) => {
    try {
      return new Intl.NumberFormat(_getLanguage() || 'en', {
        notation: 'compact',
        compactDisplay: 'short',
      }).format(Number(number) || 0);
    } catch (_e) {
      // Intentional: Intl.NumberFormat may not support locale; fall back to plain string
      return String(number || 0);
    }
  };

  const DISLIKE_CACHE_MAX_SIZE = 50;
  const fetchDislikes = async (/** @type {any} */ videoId) => {
    if (!videoId) return 0;
    const cached = dislikeCache.get(videoId);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    // Evict expired entries if cache grows too large
    if (dislikeCache.size > DISLIKE_CACHE_MAX_SIZE) {
      const now = Date.now();
      for (const [key, entry] of dislikeCache) {
        if (now >= entry.expiresAt) dislikeCache.delete(key);
      }
      // If still too large, remove oldest entries
      if (dislikeCache.size > DISLIKE_CACHE_MAX_SIZE) {
        const iter = dislikeCache.keys();
        while (dislikeCache.size > DISLIKE_CACHE_MAX_SIZE / 2) {
          const next = iter.next();
          if (next.done) break;
          dislikeCache.delete(next.value);
        }
      }
    }

    // Try GM_xmlhttpRequest first (userscript env). Fallback to fetch with timeout.
    try {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        const text = await new Promise((resolve, reject) => {
          const timeoutId = enhancedSetTimeout_(() => reject(new Error('timeout')), 8000);
          GM_xmlhttpRequest({
            method: 'GET',
            url: `${RETURN_DISLIKE_API}?videoId=${encodeURIComponent(videoId)}`,
            timeout: 8000,
            headers: { Accept: 'application/json' },
            onload: (/** @type {any} */ r) => {
              clearTimeout(timeoutId);
              if (r.status >= 200 && r.status < 300) resolve(r.responseText);
              else reject(new Error(`HTTP ${r.status}`));
            },
            onerror: (/** @type {any} */ e) => {
              clearTimeout(timeoutId);
              reject(e || new Error('network'));
            },
            ontimeout: () => {
              clearTimeout(timeoutId);
              reject(new Error('timeout'));
            },
          });
        });
        const parsed = JSON.parse(text || '{}');
        const rawDislikes = parsed && typeof parsed === 'object' ? parsed.dislikes : undefined;
        const val = Number.isFinite(Number(rawDislikes))
          ? Math.max(0, Math.floor(Number(rawDislikes)))
          : 0;
        dislikeCache.set(videoId, {
          value: val,
          expiresAt: Date.now() + DISLIKE_CACHE_TTL,
        });
        return val;
      }

      // fallback to fetch
      const controller = new AbortController();
      const id = enhancedSetTimeout_(() => controller.abort(), 8000);
      try {
        const resp = await fetch(`${RETURN_DISLIKE_API}?videoId=${encodeURIComponent(videoId)}`, {
          method: 'GET',
          cache: 'no-cache',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        clearTimeout(id);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const rawDislikes2 = json && typeof json === 'object' ? json.dislikes : undefined;
        const val = Number.isFinite(Number(rawDislikes2))
          ? Math.max(0, Math.floor(Number(rawDislikes2)))
          : 0;
        dislikeCache.set(videoId, {
          value: val,
          expiresAt: Date.now() + DISLIKE_CACHE_TTL,
        });
        return val;
      } finally {
        clearTimeout(id);
      }
    } catch (_e) {
      // on any error, return 0 but don't throw
      return 0;
    }
  };

  const getVideoIdForDislike = () => {
    try {
      const urlObj = new URL(window.location.href);
      const pathname = urlObj.pathname || '';
      if (pathname.startsWith('/shorts/')) return pathname.slice(8);
      if (pathname.startsWith('/clip/')) {
        const meta = $("meta[itemprop='videoId'], meta[itemprop='identifier']");
        return meta?.getAttribute('content') || null;
      }
      let v = urlObj.searchParams.get('v');
      if (v) return v;

      // Fallback 1: ytd-watch-flexy video-id attribute
      const watchFlexy = $('ytd-watch-flexy');
      if (watchFlexy) {
        v = watchFlexy.getAttribute('video-id');
        if (v) return v;
      }

      // Fallback 2: movie_player getVideoData()
      const moviePlayer = byId('movie_player') || $('#movie_player');
      if (moviePlayer && typeof moviePlayer.getVideoData === 'function') {
        v = moviePlayer.getVideoData()?.video_id;
        if (v) return v;
      }

      // Fallback 3: meta tag videoId
      const metaVideoId = $("meta[itemprop='videoId']");
      if (metaVideoId) {
        v = metaVideoId.getAttribute('content');
        if (v) return v;
      }

      return null;
    } catch (_e) {
      return null;
    }
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

  /**
   * Get dislike button for Shorts page
   * @returns {HTMLElement|null} Dislike button element
   */
  const getDislikeButtonShorts = () => {
    // Try to find the active reel first
    const activeReel = $('ytd-reel-video-renderer[is-active]');
    if (activeReel) {
      const btn =
        $('dislike-button-view-model', /** @type {any} */ (activeReel)) ||
        $('like-button-view-model', /** @type {any} */ (activeReel))
          ?.parentElement?.querySelector('[aria-label*="islike"]')
          ?.closest('button')?.parentElement ||
        $('#dislike-button', /** @type {any} */ (activeReel));
      if (btn) return /** @type {HTMLElement} */ (btn);
    }

    // Fallback: find in the shorts player container
    const shortsContainer = $('ytd-shorts');
    if (shortsContainer) {
      const btn =
        $('dislike-button-view-model', /** @type {any} */ (shortsContainer)) ||
        $('#dislike-button', /** @type {any} */ (shortsContainer));
      if (btn) return /** @type {HTMLElement} */ (btn);
    }

    // Last resort: global search
    return /** @type {HTMLElement | null} */ (
      $('dislike-button-view-model') || $('#dislike-button') || null
    );
  };

  /**
   * Get dislike button from buttons container
   * @param {HTMLElement} buttons - Buttons container
   * @returns {HTMLElement|null} Dislike button element
   */
  const getDislikeButtonFromContainer = (/** @type {any} */ buttons) => {
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

  const getOrCreateDislikeText = (/** @type {any} */ dislikeButton) => {
    if (!dislikeButton) return null;

    const isShorts = window.location.pathname.startsWith('/shorts');
    if (isShorts) {
      // Find native label element
      const label =
        queryShadow(dislikeButton, 'yt-formatted-string') ||
        queryShadow(dislikeButton, 'span[role="text"]') ||
        queryShadow(dislikeButton, 'span.label') ||
        queryShadow(dislikeButton, '.label');
      if (label) {
        if (!label.hasAttribute('data-ytp-original-text')) {
          label.setAttribute('data-ytp-original-text', label.innerText || 'Dislike');
        }
        return label;
      }
    }

    // Check if our custom text already exists (prevent duplicates)
    const existingCustom = queryShadow(dislikeButton, '#ytp-plus-dislike-text');
    if (existingCustom) return existingCustom;

    // Find the proper button element
    const buttonShape =
      queryShadow(dislikeButton, 'button') ||
      dislikeButton.querySelector('button') ||
      dislikeButton.closest('button') ||
      dislikeButton;

    // Find or create the standard text container (which might be in shadow DOM)
    let textContainer = queryShadow(buttonShape, '.yt-spec-button-shape-next__button-text-content');

    if (!textContainer) {
      const targetElement = buttonShape.shadowRoot || buttonShape;
      textContainer = targetElement.querySelector(
        '.yt-spec-button-shape-next__button-text-content'
      );
      if (!textContainer) {
        textContainer = document.createElement('div');
        textContainer.className = 'yt-spec-button-shape-next__button-text-content';
        const icon = queryShadow(buttonShape, '.yt-spec-button-shape-next__icon');
        const parent = icon ? icon.parentNode : buttonShape;
        parent.appendChild(textContainer);
      }
    }

    // Create a dedicated span with proper styling to match like button
    const created = document.createElement('span');
    created.id = 'ytp-plus-dislike-text';
    created.setAttribute('role', 'text');
    created.className = 'yt-core-attributed-string yt-core-attributed-string--white-space-no-wrap';
    created.classList.add('ytp-plus-dislike-text--regular');
    textContainer.appendChild(created);

    try {
      const rootNode = textContainer.getRootNode();
      if (rootNode instanceof ShadowRoot && !rootNode.querySelector('#ytp-plus-dislike-style')) {
        const style = document.createElement('style');
        style.id = 'ytp-plus-dislike-style';
        style.textContent = `
          #ytp-plus-dislike-text.ytp-plus-dislike-text--regular {
            margin-left: 6px !important;
            font-size: 1.4rem !important;
            line-height: 2rem !important;
            font-weight: 500 !important;
            display: inline-block !important;
            visibility: visible !important;
            opacity: 1 !important;
            min-width: 2em !important;
            text-align: center !important;
          }
          :host {
            min-width: fit-content !important;
            width: auto !important;
          }
          yt-button-shape {
            min-width: fit-content !important;
            width: auto !important;
          }
          button.yt-spec-button-shape-next--icon-only-default,
          button.yt-spec-button-shape-next--segmented-end,
          button.yt-spec-button-shape-next,
          button {
            min-width: fit-content !important;
            width: auto !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          button.yt-spec-button-shape-next--segmented-end {
            padding-left: 8px !important;
            padding-right: 12px !important;
          }
          button.yt-spec-button-shape-next--icon-only-default {
            padding-left: 8px !important;
            padding-right: 8px !important;
          }
          .yt-spec-button-shape-next__button-text-content {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-width: fit-content !important;
          }
        `;
        rootNode.appendChild(style);
      }
    } catch (e) {
      enhancedLogger?.warn?.('Enhanced', 'Failed to inject shadow style', e);
    }

    try {
      // Ensure button and its wrapper have proper width/sizing
      buttonShape.style.minWidth = 'auto';
      buttonShape.style.width = 'auto';
      const viewModelHost = dislikeButton.closest('ytDislikeButtonViewModelHost');
      if (viewModelHost) {
        viewModelHost.style.minWidth = 'auto';
      }
      dislikeButton.style.minWidth = 'auto';
    } catch (e) {
      enhancedLogger?.warn?.('Enhanced', 'Failed to style dislike button', e);
    }
    return created;
  };

  const setDislikeDisplay = (/** @type {any} */ dislikeButton, /** @type {any} */ count) => {
    try {
      const container = getOrCreateDislikeText(dislikeButton);
      if (!container) return;

      const formatted = formatCompactNumber(count);
      if (container.innerText !== String(formatted)) {
        container.innerText = String(formatted);

        // Ensure the text is visible and properly styled
        /** @type {any} */ (container).style.display = 'inline-block';
        /** @type {any} */ (container).style.visibility = 'visible';
        /** @type {any} */ (container).style.opacity = '1';

        // Make sure parent button container is wide enough
        const buttonShape =
          container.closest('button') ||
          queryShadow(dislikeButton, 'button') ||
          dislikeButton.querySelector('button');
        if (buttonShape) {
          /** @type {any} */ (buttonShape).style.minWidth = 'fit-content';
          /** @type {any} */ (buttonShape).style.width = 'auto';
        }
      }
    } catch (e) {
      enhancedLogger?.warn?.('Enhanced', 'Failed to set dislike display', e);
    }
  };

  const setupDislikeObserver = (/** @type {any} */ dislikeButton) => {
    if (!dislikeButton) return;
    const innerBtn =
      queryShadow(dislikeButton, 'button') ||
      dislikeButton.querySelector('button') ||
      dislikeButton;
    const targetNode = innerBtn.getRootNode();
    if (dislikeDirectObserver && observedDislikeButton === targetNode) {
      return; // Already observing this exact targetNode (ShadowRoot or element)
    }
    if (dislikeDirectObserver) {
      dislikeDirectObserver.disconnect();
      dislikeDirectObserver = null;
    }

    observedDislikeButton = targetNode;
    try {
      dislikeDirectObserver = new MutationObserver(() => {
        // on any mutation, update displayed cached value
        const vid = getVideoIdForDislike();
        const cached = dislikeCache.get(vid);
        if (cached) {
          const btn = getDislikeButton();
          if (btn) setDislikeDisplay(btn, cached.value);
        }
      });
      dislikeDirectObserver.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    } catch (e) {
      enhancedLogger?.warn?.('Enhanced', 'Failed to create dislike direct observer', e);
    }
  };

  const initReturnDislike = async () => {
    try {
      if (dislikeFallbackIntervalId) {
        clearInterval(dislikeFallbackIntervalId);
        dislikeFallbackIntervalId = null;
      }
      // avoid multiple polls
      if (dislikePollTimer) return;

      // Use MutationObserver instead of setInterval for better performance
      const checkButton = async () => {
        const btn = getDislikeButton();
        if (btn) {
          const isShorts = window.location.pathname.startsWith('/shorts');

          // Verify if inner elements are fully loaded and ready
          if (!isShorts) {
            const innerBtn =
              queryShadow(btn, 'button') ||
              btn.querySelector('button') ||
              (btn.tagName === 'BUTTON' ? btn : null);
            if (!innerBtn) {
              // Inner button shape is not upgraded or populated yet. Keep waiting.
              return false;
            }
          }

          const vid = getVideoIdForDislike();
          if (!vid) return false;

          // Check if already processed for this button and video ID
          const existingText = isShorts
            ? queryShadow(btn, 'yt-formatted-string, span[role="text"], span.label, .label')
            : queryShadow(btn, '#ytp-plus-dislike-text');

          if (btn.getAttribute('data-ytp-video-id') === vid) {
            if (existingText) {
              if (isShorts) {
                // For Shorts, verify the label doesn't contain the default non-numeric text
                const originalText = existingText.getAttribute('data-ytp-original-text');
                if (originalText && existingText.innerText !== originalText) {
                  return true;
                }
              } else {
                // For normal watch page, verify the custom text container is not empty
                if (existingText.innerText && existingText.innerText.trim() !== '') {
                  return true;
                }
              }
            }
          }

          const val = await fetchDislikes(vid);
          setDislikeDisplay(btn, val);
          btn.setAttribute('data-ytp-video-id', vid);
          setupDislikeObserver(btn);
          return true;
        }
        return false;
      };

      // Helper for retrying checkButton
      const runCheckWithRetry = async (retryCount = 0) => {
        try {
          const success = await checkButton();
          if (!success && retryCount < 15) {
            enhancedSetTimeout_(() => runCheckWithRetry(retryCount + 1), 100 + retryCount * 100);
          }
        } catch (_e) {
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

      // Start periodic fallback check
      dislikeFallbackIntervalId = setInterval(async () => {
        if (!shouldInitReturnDislike()) {
          if (dislikeFallbackIntervalId) {
            clearInterval(dislikeFallbackIntervalId);
            dislikeFallbackIntervalId = null;
          }
          return;
        }
        try {
          await checkButton();
        } catch (_e) {
          // ignore
        }
      }, 1500);
    } catch (e) {
      enhancedLogger?.warn?.('Enhanced', 'Failed to initialize Return YouTube Dislike', e);
    }
  };

  const cleanupReturnDislike = () => {
    try {
      if (dislikePollTimer) {
        window.YouTubePlusMutationCoordinator?.unsubscribe?.(dislikePollTimer);
        dislikePollTimer = null;
      }
      if (dislikeFallbackIntervalId) {
        clearInterval(dislikeFallbackIntervalId);
        dislikeFallbackIntervalId = null;
      }
      if (dislikeDirectObserver) {
        dislikeDirectObserver.disconnect();
        dislikeDirectObserver = null;
      }
      observedDislikeButton = null;
      // Remove all created dislike text spans
      /** @type {Element[]} */
      const dislikeSpans = [];
      findAllInShadow(document.body, '#ytp-plus-dislike-text', dislikeSpans);
      dislikeSpans.forEach(el => {
        try {
          if (el.parentNode) el.parentNode.removeChild(el);
        } catch (_e) {
          U.logSuppressed(_e, 'Enhanced');
        }
      });
      // Remove data-ytp-video-id attributes
      /** @type {Element[]} */
      const buttonsWithAttr = [];
      findAllInShadow(document.body, '[data-ytp-video-id]', buttonsWithAttr);
      buttonsWithAttr.forEach(el => {
        try {
          el.removeAttribute('data-ytp-video-id');
        } catch (_e) {
          U.logSuppressed(_e, 'Enhanced');
        }
      });
      // Restore original text on label elements
      /** @type {Element[]} */
      const originalTexts = [];
      findAllInShadow(document.body, '[data-ytp-original-text]', originalTexts);
      originalTexts.forEach(el => {
        try {
          el.innerText = el.getAttribute('data-ytp-original-text') || '';
          el.removeAttribute('data-ytp-original-text');
        } catch (_e) {
          U.logSuppressed(_e, 'Enhanced');
        }
      });
    } catch (e) {
      enhancedLogger?.warn?.('Enhanced', 'Dislike cleanup error', e);
    }
  };

  /**
   * Observes DOM changes to detect tab switches
   * @returns {string|null} Subscription id or null on error
   */
  const observeTabChanges = () => {
    try {
      const coordinator = window.YouTubePlusMutationCoordinator;
      if (!coordinator?.subscribeRoot) return null;

      const observerId = 'enhanced::tabChanges';
      coordinator.subscribeRoot(
        observerId,
        (/** @type {MutationRecord[]} */ mutations) => {
          try {
            if (
              mutations.some(
                (/** @type {MutationRecord} */ m) =>
                  m.type === 'attributes' &&
                  m.attributeName === 'class' &&
                  m.target instanceof Element &&
                  m.target.classList.contains('tab-content-cld')
              )
            ) {
              enhancedSetTimeout_(setupScrollListener, 100);
            }
          } catch (error) {
            enhancedLogger?.error?.('Enhanced', 'Error in mutation observer', error);
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
      try {
        U?.ObserverRegistry?.track?.();
      } catch (_e) {
        U.logSuppressed(_e, 'Enhanced');
      }

      const rightTabs = $('#right-tabs');
      if (rightTabs) {
        return observerId;
      }
      // No target found — untrack
      try {
        U?.ObserverRegistry?.untrack?.();
      } catch (_e) {
        U.logSuppressed(_e, 'Enhanced');
      }
      coordinator.unsubscribe(observerId);
      return null;
    } catch (error) {
      enhancedLogger?.error?.('Enhanced', 'Error in observeTabChanges', error);
      return null;
    }
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
   * Handles click events on tab buttons
   * @param {Event} e - Click event
   * @returns {void}
   */
  const handleTabButtonClick = (/** @type {any} */ e) => {
    try {
      const { target } = /** @type {{ target: HTMLElement }} */ (e);
      const tabButton = target?.closest?.('.tab-btn[tyt-tab-content]');
      if (tabButton) {
        enhancedSetTimeout_(setupScrollListener, 100);
      }
    } catch (error) {
      enhancedLogger?.error?.('Enhanced', 'Error in click handler', error);
    }
  };

  /**
   * Sets up event listeners for tab button clicks
   * @returns {void}
   */
  const setupEvents = () => {
    try {
      if (isTabClickListenerAttached) return;
      const delegator = window.YouTubePlusEventDelegation;
      if (delegator?.on) {
        tabDelegationHandler = (/** @type {any} */ _ev, /** @type {any} */ target) => {
          if (!target) return;
          enhancedSetTimeout_(setupScrollListener, 100);
        };
        delegator.on(document, 'click', '.tab-btn[tyt-tab-content]', tabDelegationHandler, {
          capture: true,
        });
        tabDelegationRegistered = true;
      } else {
        document.addEventListener('click', handleTabButtonClick, true);
      }
      isTabClickListenerAttached = true;
    } catch (error) {
      enhancedLogger?.error?.('Enhanced', 'Error in setupEvents', error);
    }
  };

  const cleanupEvents = () => {
    try {
      if (!isTabClickListenerAttached) return;
      const delegator = window.YouTubePlusEventDelegation;
      if (tabDelegationRegistered && delegator?.off && tabDelegationHandler) {
        delegator.off(document, 'click', '.tab-btn[tyt-tab-content]', tabDelegationHandler);
      } else {
        document.removeEventListener('click', handleTabButtonClick, true);
      }
      tabDelegationHandler = null;
      tabDelegationRegistered = false;
      isTabClickListenerAttached = false;
    } catch (error) {
      enhancedLogger?.error?.('Enhanced', 'Error cleaning up events', error);
    }
  };

  const stopWatchEnhancements = () => {
    watchInitToken++;
    // Stop retry schedulers (may be scheduler objects with .stop() or timer IDs)
    try {
      if (tabCheckTimeoutId && typeof tabCheckTimeoutId === 'object' && tabCheckTimeoutId.stop) {
        tabCheckTimeoutId.stop();
      } else {
        tabCheckTimeoutId = clearTimeoutSafe(tabCheckTimeoutId);
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    tabCheckTimeoutId = null;
    try {
      if (
        playlistPanelCheckTimeoutId &&
        typeof playlistPanelCheckTimeoutId === 'object' &&
        playlistPanelCheckTimeoutId.stop
      ) {
        playlistPanelCheckTimeoutId.stop();
      } else {
        playlistPanelCheckTimeoutId = clearTimeoutSafe(playlistPanelCheckTimeoutId);
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    playlistPanelCheckTimeoutId = null;

    try {
      if (tabChangesObserver) {
        window.YouTubePlusMutationCoordinator?.unsubscribe?.(tabChangesObserver);
      }
      if (tabChangesObserver) {
        try {
          U?.ObserverRegistry?.untrack?.();
        } catch (_e) {
          U.logSuppressed(_e, 'Enhanced');
        }
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    tabChangesObserver = null;

    cleanupEvents();

    try {
      cleanupReturnDislike();
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
  };

  const startWatchEnhancements = () => {
    if (!config.enabled) return;
    if (!(U?.isWatchPage?.() ?? false)) return;

    const token = ++watchInitToken;
    setupEvents();

    // Use shared RetryScheduler for tab detection
    const tabScheduler = U?.createRetryScheduler?.({
      check: () => {
        if (token !== watchInitToken || !(U?.isWatchPage?.() ?? false)) {
          return true;
        } // stop
        if ($('#right-tabs')) {
          createButton();
          try {
            if (tabChangesObserver) {
              window.YouTubePlusMutationCoordinator?.unsubscribe?.(tabChangesObserver);
            }
          } catch (_e) {
            U.logSuppressed(_e, 'Enhanced');
          }
          tabChangesObserver = observeTabChanges();
          return true; // done
        }
        return false;
      },
      maxAttempts: 40,
      interval: 250,
    });

    // Use shared RetryScheduler for playlist panel detection
    const playlistScheduler = U?.createRetryScheduler?.({
      check: () => {
        if (token !== watchInitToken || !(U?.isWatchPage?.() ?? false)) {
          return true;
        }
        try {
          const playlistPanel = $('ytd-playlist-panel-renderer');
          if (playlistPanel && !byId('playlist-panel-top-button')) {
            createPlaylistPanelButton();
            return true;
          }
        } catch (error) {
          enhancedLogger?.error?.('Enhanced', 'Error checking for playlist panel', error);
        }
        return false;
      },
      maxAttempts: 30,
      interval: 300,
    });

    // Store schedulers for cleanup
    tabCheckTimeoutId = tabScheduler;
    playlistPanelCheckTimeoutId = playlistScheduler;
  };

  /**
   * Initialize scroll-to-top button module
   * @returns {void}
   */
  const init = () => {
    try {
      addStyles();

      const checkPageType = () => {
        try {
          if (needsUniversalButton() && !byId('universal-top-button')) {
            createUniversalButton();
          }
          if (U?.isMusicDomain?.() && !byId('music-side-top-button')) {
            createMusicSidePanelButton();
          }
        } catch (error) {
          enhancedLogger?.error?.('Enhanced', 'Error checking page type', error);
        }
      };

      const onNavigate = () => {
        stopWatchEnhancements();
        invalidateMusicContainersCache();
        checkPageType();

        if (shouldInitReturnDislike()) {
          try {
            initReturnDislike();
          } catch (e) {
            enhancedLogger?.warn?.('Enhanced', 'initReturnDislike error', e);
          }
        }

        // Watch-specific UI only initializes on /watch
        startWatchEnhancements();
      };

      // Initial run
      onNavigate();

      // Listen for navigation changes (YouTube is SPA)
      if (typeof U?.cleanupManager?.registerListener === 'function') {
        YouTubeUtils.cleanupManager.registerListener(
          document,
          'yt-navigate-finish',
          () => enhancedSetTimeout_(onNavigate, 200),
          { passive: true }
        );
      } else {
        window.addEventListener('yt-navigate-finish', () => {
          enhancedSetTimeout_(onNavigate, 200);
        });
      }

      // For YouTube Music: also listen on popstate and observe #side-panel appearance
      if (U?.isMusicDomain?.()) {
        window.addEventListener('popstate', () => enhancedSetTimeout_(onNavigate, 200));
        // Observe DOM for side-panel becoming scrollable via centralized coordinator.
        const coordinator = window.YouTubePlusMutationCoordinator;
        if (coordinator?.subscribeRoot) {
          musicSidePanelSubId = 'enhanced::musicSidePanel';
          coordinator.subscribeRoot(
            musicSidePanelSubId,
            () => {
              if (!byId('music-side-top-button') && config.enabled) {
                createMusicSidePanelButton();
              }
            },
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

  window.addEventListener('youtube-plus-settings-updated', (/** @type {any} */ e) => {
    try {
      const nextEnabled = e?.detail?.enableScrollToTopButton !== false;
      const tabviewEnabled = e?.detail?.enableTabview !== false;
      const shouldUseUniversalOnWatch =
        ((U?.isWatchPage?.() ?? false) || (U?.isShortsPage?.() ?? false)) && !tabviewEnabled;
      config.enabled = nextEnabled;
      if (!config.enabled) {
        cleanupTopButtons();
        stopWatchEnhancements();
        return;
      }
      addStyles();
      cleanupTopButtons();
      stopWatchEnhancements();

      if ((needsUniversalButton() || shouldUseUniversalOnWatch) && !byId('universal-top-button')) {
        createUniversalButton();
      }
      if (U?.isMusicDomain?.() && !byId('music-side-top-button')) {
        createMusicSidePanelButton();
      }
      startWatchEnhancements();

      if (shouldInitReturnDislike()) {
        try {
          initReturnDislike();
        } catch (e) {
          enhancedLogger?.warn?.('Enhanced', 'initReturnDislike error after settings update', e);
        }
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
  });

  onDomReady(scheduleInit);
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
    try {
      const path = window.location.pathname || '';
      return path === '/watch' || path.startsWith('/shorts/');
    } catch (_e) {
      return false;
    }
  };

  const normalizeQuality = (/** @type {any} */ value) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    return normalized && normalized !== 'unknown' ? normalized : '';
  };

  const getCurrentVideoId = () => {
    try {
      const path = window.location.pathname || '';
      if (path === '/watch') {
        return new URLSearchParams(window.location.search || '').get('v') || '';
      }
      if (path.startsWith('/shorts/')) {
        return path.split('/')[2] || '';
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
    return '';
  };

  const getPlayer = () => /** @type {any} */ (byId('movie_player'));

  const clearPendingApplyTimeouts = () => {
    pendingApplyTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    pendingApplyTimeouts = [];
  };

  const getStoredQuality = () => {
    try {
      return normalizeQuality(localStorage.getItem(QUALITY_STORAGE_KEY));
    } catch (_e) {
      return '';
    }
  };

  const storeQuality = (/** @type {string} */ quality) => {
    const normalized = normalizeQuality(quality);
    try {
      if (!normalized || normalized === 'auto') {
        localStorage.removeItem(QUALITY_STORAGE_KEY);
        return;
      }
      localStorage.setItem(QUALITY_STORAGE_KEY, normalized);
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
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

      let targetQuality = preferredQuality;
      if (!availableQualityLevels.includes(preferredQuality)) {
        const prefIdx = QUALITY_RANKING.indexOf(preferredQuality);
        if (prefIdx !== -1) {
          targetQuality =
            QUALITY_RANKING.slice(prefIdx).find(q => availableQualityLevels.includes(q)) || 'auto';
        }
      }

      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(targetQuality, targetQuality);
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(targetQuality);
      }

      try {
        localStorage.setItem(
          'yt-player-quality',
          JSON.stringify({
            data: targetQuality,
            expiration: Date.now() + 1000 * 60 * 60 * 24 * 30,
            creation: Date.now(),
          })
        );
      } catch (_err) {
        // Suppress
      }

      lastAppliedVideoId = currentVideoId;
      return true;
    } catch (_e) {
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

    // Fallback: parse from label
    const lbl = String(label || '').toLowerCase();
    if (lbl.includes('2160p') || lbl.includes('4k') || lbl.includes('2160')) return 'hd2160';
    if (lbl.includes('1440p') || lbl.includes('2k') || lbl.includes('1440')) return 'hd1440';
    if (lbl.includes('1080p') || lbl.includes('1080')) return 'hd1080';
    if (lbl.includes('720p') || lbl.includes('720')) return 'hd720';
    if (lbl.includes('480p') || lbl.includes('480')) return 'large';
    if (lbl.includes('360p') || lbl.includes('360')) return 'medium';
    if (lbl.includes('240p') || lbl.includes('240')) return 'small';
    if (lbl.includes('144p') || lbl.includes('144')) return 'tiny';
    if (lbl.includes('auto') || lbl.includes('авто')) return 'auto';

    if (val.includes('2160')) return 'hd2160';
    if (val.includes('1440')) return 'hd1440';
    if (val.includes('1080')) return 'hd1080';
    if (val.includes('720')) return 'hd720';
    if (val.includes('480')) return 'large';
    if (val.includes('360')) return 'medium';
    if (val.includes('240')) return 'small';
    if (val.includes('144')) return 'tiny';
    if (val.includes('auto')) return 'auto';

    return val;
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
      menuItem.getAttribute('data-value') || /** @type {any} */ (menuItem).dataset?.value || ''
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

  document.addEventListener('click', handleQualityMenuInteraction, true);
  document.addEventListener(
    'loadedmetadata',
    event => {
      const target = /** @type {EventTarget | null} */ (event.target);
      if (target instanceof HTMLElement && target.tagName === 'VIDEO') {
        scheduleApplyStoredQuality();
      }
    },
    true
  );

  window.addEventListener('youtube-plus-settings-updated', () => {
    lastAppliedVideoId = '';
    scheduleApplyStoredQuality();
  });

  window.addEventListener('yt-navigate-finish', handleNavigation, {
    passive: true,
  });
  window.addEventListener('ytp:nav-refresh', handleNavigation, {
    passive: true,
  });
  onDomReady(scheduleApplyStoredQuality);
})();

// Styles
(function () {
  try {
    const host = typeof location === 'undefined' ? '' : location.hostname;
    if (!host) return;
    if (!(/(^|\.)youtube\.com$/.test(host) || /\.youtube\.google/.test(host))) return;

    const SETTINGS_KEY = U?.SETTINGS_KEY || 'youtube_plus_settings';
    const STYLE_ELEMENT_ID = 'ytp-zen-features-style';
    const NON_CRITICAL_STYLE_ID = 'ytp-zen-features-style-noncritical';
    const STYLE_MANAGER_KEY = 'zen-features-style';
    const NON_CRITICAL_STYLE_MANAGER_KEY = 'zen-features-style-noncritical';
    /** @type {any} */
    let nonCriticalTimer = null;

    const DEFAULTS = {
      enableZenStyles: true,
      // legacy (kept for backward compat)
      hideSideGuide: false,
      zenStyles: {
        themeVariant: 'glass',
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
      /** @type {any} */
      let parsed = null;
      try {
        const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
        if (store && typeof store.load === 'function') {
          parsed = store.load();
        } else {
          const raw = localStorage.getItem(SETTINGS_KEY);
          if (raw) parsed = JSON.parse(raw);
        }
      } catch (e) {
        enhancedLogger?.warn?.('Enhanced', 'Zen settings parse error', e);
      }

      const merged = {
        ...DEFAULTS,
        ...(parsed && typeof parsed === 'object' ? parsed : null),
      };

      merged.zenStyles = {
        ...DEFAULTS.zenStyles,
        ...(merged.zenStyles && typeof merged.zenStyles === 'object' ? merged.zenStyles : null),
      };

      // Backward compat: if legacy hideSideGuide is set, also enable the style flag.
      if (merged.hideSideGuide === true && merged.zenStyles.hideSideGuide !== true) {
        merged.zenStyles.hideSideGuide = true;
      }

      // Backward compat: migrate old boolean sideVideosTwoColumns → sideVideosColumns number
      if (
        merged.zenStyles.sideVideosTwoColumns === true &&
        (merged.zenStyles.sideVideosColumns === undefined ||
          merged.zenStyles.sideVideosColumns === null ||
          merged.zenStyles.sideVideosColumns === '')
      ) {
        merged.zenStyles.sideVideosColumns = 2;
      }
      if (merged.zenStyles.sideVideosTwoColumns === true) {
        merged.zenStyles.sideVideosColumnsEnabled = true;
      }
      const parsedSideCols = Number(merged.zenStyles.sideVideosColumns);
      if (!Number.isFinite(parsedSideCols) || parsedSideCols < 0) {
        merged.zenStyles.sideVideosColumns = 0;
      } else {
        merged.zenStyles.sideVideosColumns = parsedSideCols;
      }
      merged.zenStyles.sideVideosColumns = Math.min(2, merged.zenStyles.sideVideosColumns);
      if (typeof merged.zenStyles.sideVideosColumnsEnabled !== 'boolean') {
        merged.zenStyles.sideVideosColumnsEnabled = merged.zenStyles.sideVideosColumns > 0;
      }

      return merged;
    };

    const CSS_BLOCKS = {
      thumbnailHover: `
        /* yt-thumbnail hover */
        #inline-preview-player {transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) 1s !important; transform: scale(1) !important;}
        #video-preview-container:has(#inline-preview-player) {transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important; border-radius: 1.2em !important; overflow: hidden !important; transform: scale(1) !important;}
        #video-preview-container:has(#inline-preview-player):hover {transform: scale(1.25) !important; box-shadow: rgba(0,0,0,0.5) 0px 0px 60px !important; transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) 2s !important;}
        ytd-app #content {opacity: 1 !important; transition: opacity 0.3s ease-in-out !important;}
        ytd-app:has(#video-preview-container:hover) #content {opacity: 0.5 !important; transition: opacity 4s ease-in-out 1s !important;}
      `,
      immersiveSearch: `
        /* yt-Immersive search */
        #page-manager, yt-searchbox {transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35) !important;}
        #masthead yt-searchbox button[aria-label="Search"] {display: none !important;}
        .ytSearchboxComponentInputBox {border-radius: 2em !important;}
        yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) {position: relative !important; left: 0vw !important; top: -30vh !important; height: 40px !important; max-width: 600px !important; transform: scale(1) !important;}
        @media only screen and (min-width: 1400px) {yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) { height: 60px !important; max-width: 700px !important; transform: scale(1.1) !important;}}
        yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) .ytSearchboxComponentInputBox,
        yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {background-color: var(--yt-bg-primary) !important; box-shadow: black 0 0 30px !important;}
        yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {margin-top: 10px !important;}
        @media only screen and (min-width: 1400px) {yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {margin-top: 30px !important;}}
        .ytd-masthead #center:has(.ytSearchboxComponentInputBoxHasFocus) {height: 100vh !important; width: 100vw !important; left: 0 !important; top: 0 !important; position: fixed !important; justify-content: center !important; align-items: center !important;}
        #content:has(.ytSearchboxComponentInputBoxHasFocus) #page-manager {filter: blur(20px) !important; transform: scale(1.05) !important;}
      `,
      hideVoiceSearch: `
        /* No voice search button */
        #voice-search-button {display: none !important;}
      `,
      transparentHeader: `
        /* Transparent header */
        :root{
          --yt-spec-base-background: transparent;
          --ytd-masthead-background: transparent;
          --yt-spec-brand-background-primary: transparent;
          --yt-spec-brand-background-solid: transparent;
          --yt-spec-general-background-a: transparent;
          --yt-spec-raised-background: transparent;
          --yt-spec-additive-background: transparent;
        }
        #masthead-container,
        #masthead,
        ytd-masthead,
        #background.ytd-masthead,
        ytd-masthead #background,
        ytd-masthead #container,
        ytd-masthead #contentContainer,
        ytd-masthead #end,
        ytd-masthead #start,
        ytd-masthead #center,
        ytd-masthead #frosted-glass,
        ytd-masthead #background-content,
        #frosted-glass,
        ytd-masthead tp-yt-app-header-layout,
        ytd-mini-guide-renderer,
        ytd-topbar-logo-renderer,
        ytd-app #masthead,
        ytd-app #masthead-container,
        tp-yt-app-header-layout #masthead-container {
          background-color: transparent !important;
          background: transparent !important;
          box-shadow: none !important;
        }
      `,
      hideSideGuide: `
        /* Hide side guide */
        ytd-mini-guide-renderer, [theater=""] #contentContainer::after {display: none !important;}
        tp-yt-app-drawer > #contentContainer:not([opened=""]),
        #contentContainer:not([opened=""]) #guide-content,
        ytd-mini-guide-renderer,
        ytd-mini-guide-entry-renderer {background-color: var(--yt-spec-text-primary-inverse) !important; background: var(--yt-spec-text-primary-inverse) !important;}
        #content:not(:has(#contentContainer[opened=""])) #page-manager {margin-left: 0 !important;}
        ytd-app:not([guide-persistent-and-visible=""]) tp-yt-app-drawer > #contentContainer {background-color: var(--yt-spec-text-primary-inverse) !important;}
        ytd-alert-with-button-renderer {align-items: center !important; justify-content: center !important;}
      `,
      cleanSideGuide: `
        /* Clean side guide */
        ytd-guide-section-renderer:has([title="YouTube Premium"]),
        ytd-guide-renderer #footer {display: none !important;}
        ytd-guide-section-renderer, ytd-guide-collapsible-section-entry-renderer {border: none !important;}
      `,
      fixFeedLayout: `
        /* Fix new feed layout */
        @media only screen and (min-width: 1400px) {
          ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-grid-items-per-row: 4 !important; }
        }
        @media only screen and (min-width: 1700px) {
          ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-grid-items-per-row: 5 !important; }
        }
        @media only screen and (min-width: 2180px) {
          ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-grid-items-per-row: 6 !important; }
        }
        ytd-rich-item-renderer[is-in-first-column] { margin-left: calc(var(--ytd-rich-grid-item-margin) / 2) !important; }
        #contents { padding-left: calc(var(--ytd-rich-grid-item-margin) / 2 + var(--ytd-rich-grid-gutter-margin)) !important; }
      `,
      // sideVideosColumns CSS is generated dynamically in buildNonCriticalCss
      betterCaptions: `
        /* Better captions */
        .caption-window { backdrop-filter: blur(10px) brightness(70%) !important; border-radius: 1em !important; padding: 1em !important; box-shadow: rgba(0,0,0,0.5) 0 0 20px !important; width: fit-content !important; }
        .ytp-caption-segment { background: none !important; }
      `,
      playerBlur: `
        /* Player controls blur */
        .ytp-left-controls .ytp-play-button,
        .ytp-left-controls .ytp-volume-area,
        .ytp-left-controls .ytp-time-display.notranslate > span,
        .ytp-left-controls .ytp-chapter-container > button,
        .ytp-left-controls .ytp-prev-button,
        .ytp-left-controls .ytp-next-button,
        .ytp-right-controls,
        .ytp-time-wrapper,
        .ytPlayerQuickActionButtonsHost,
        .ytPlayerQuickActionButtonsHostCompactControls,
        .ytPlayerQuickActionButtonsHostDisableBackdropFilter { backdrop-filter: blur(5px) !important; background-color: rgba(0,0,0,0.4) !important; }
        .ytp-popup { backdrop-filter: blur(10px) !important; background-color: rgba(0,0,0,0.45) !important; }
      `,
      theaterEnhancements: `
        /* Zen view comments (from zeninternet) */
        /* Hide secondary column visually but break containment so fixed children can escape */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #columns #secondary { display: block !important;width: 0 !important;min-width: 0 !important;max-width: 0 !important;padding: 0 !important;margin: 0 !important;border: 0 !important;overflow: visible !important;pointer-events: none !important;flex: 0 0 0px !important;contain: none !important;
        }
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #secondary-inner { overflow: visible !important;contain: none !important;position: static !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #secondary-inner secondary-wrapper,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #secondary-inner .tabview-secondary-wrapper { contain: none !important;overflow: visible !important;position: static !important;max-height: none !important;height: auto !important;padding: 0 !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #right-tabs { display: block !important;overflow: visible !important;contain: none !important;position: static !important;width: 0 !important;height: 0 !important;padding: 0 !important;margin: 0 !important;border: 0 !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #right-tabs > header { display: none !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #right-tabs .tab-content { display: block !important;overflow: visible !important;contain: none !important;position: static !important;width: 0 !important;height: 0 !important;padding: 0 !important;margin: 0 !important;border: 0 !important;}
        /* Break containment on tab-comments so its fixed-position child can escape */
        /* Extra .tab-content-hidden selector to beat main.js specificity (line 5169) */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-hidden,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-cld { contain: none !important;overflow: visible !important;position: static !important;display: block !important;visibility: visible !important;width: 0 !important;height: 0 !important;padding: 0 !important;margin: 0 !important;z-index: auto !important;pointer-events: none !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-hidden ytd-comments#comments > ytd-item-section-renderer#sections,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-hidden ytd-comments#comments > ytd-item-section-renderer#sections > #contents,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-hidden ytd-comments#comments #contents { contain: none !important;width: auto !important;height: auto !important;max-height: none !important;overflow: visible !important;visibility: visible !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-hidden ytd-comments#comments #contents > * { display: block !important;}
        /* Hide other tabs content */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-info,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-videos,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-list { display: none !important;}
        /* Comments overlay panel */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) ytd-comments { visibility: visible !important;display: block !important;background-color: var(--yt-live-chat-shimmer-background-color) !important;backdrop-filter: blur(20px) !important;padding: 0 2em !important;border-radius: 2em 0 0 2em !important;max-height: calc(100vh - 120px) !important;overflow-y: auto !important;position: fixed !important;z-index: 2000 !important;top: 3vh !important;right: -42em !important;width: 40em !important;height: 90vh !important;opacity: 0 !important;pointer-events: auto !important;transition: opacity 0.4s ease, right 0.4s ease !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) ytd-comments:hover { opacity: 1 !important;right: 0 !important;}
        /* Transparent overlay chat — fixed panel */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) [tyt-chat-container],
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat-container { contain: none !important;overflow: visible !important;position: static !important;display: block !important;pointer-events: none !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat { visibility: visible !important;display: block !important;position: fixed !important;top: 3vh !important;right: 0 !important;width: 400px !important;height: calc(100vh - 120px) !important;max-height: calc(100vh - 120px) !important;z-index: 2001 !important;opacity: 0.85 !important;pointer-events: auto !important;border-radius: 2em 0 0 2em !important;overflow: hidden !important;backdrop-filter: blur(20px) !important;transition: opacity 0.4s ease !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat[collapsed] { visibility: visible !important;display: block !important;position: fixed !important;top: 3vh !important;right: 0 !important;width: 400px !important;height: calc(100vh - 120px) !important;max-height: calc(100vh - 120px) !important;z-index: 2001 !important;opacity: 0.85 !important;pointer-events: auto !important;overflow: hidden !important;border-radius: 2em 0 0 2em !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat[collapsed] > #show-hide-button,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat[collapsed] > .ytd-live-chat-frame#show-hide-button { display: none !important;visibility: hidden !important;opacity: 0 !important;pointer-events: none !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat[collapsed] iframe { display: block !important;visibility: visible !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat iframe { height: 100% !important;width: 100% !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) yt-live-chat-renderer { background: transparent !important;}
        /* Ambient mode: fix black bars in theater */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #cinematics-container,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #cinematics { position: absolute !important;top: 0 !important;left: 0 !important;width: 100% !important;height: 100% !important;overflow: hidden !important;pointer-events: none !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #cinematics canvas,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #cinematics video { position: absolute !important;top: 50% !important;left: 50% !important;transform: translate(-50%, -50%) scale(1.2) !important;min-width: 100% !important;min-height: 100% !important;object-fit: cover !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #player-full-bleed-container { overflow: hidden !important;}
        ytd-watch-flexy[fullscreen] ytd-live-chat-frame { background-color: var(--app-drawer-content-container-background-color) !important;}
      `,
      compactFeed: `
      /* Compact feed – reduced spacing, hover menus, inline details */
        ytd-rich-item-renderer { margin-bottom: 15px !important;}
        ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-item-row-usable-width: calc(100% - var(--ytd-rich-grid-gutter-margin) * 1) !important;}
        ytd-rich-item-renderer #metadata.ytd-video-meta-block { flex-direction: row !important;}
        ytd-rich-item-renderer #metadata.ytd-video-meta-block #metadata-line span:nth-child(3) { height: 1em !important;margin-left: 1em !important;}
        ytd-rich-grid-media { border-radius: 1.2em;height: 100% !important;}
        ytd-rich-grid-media ytd-menu-renderer #button { opacity: 0 !important;transition: opacity 0.3s ease-in-out !important;}
        ytd-rich-grid-media:hover ytd-menu-renderer #button { opacity: 1 !important;}
      `,
      themeSolid: `
        html {
          --yt-glass-blur:none !important;
          --yt-glass-blur-light:none !important;
          --yt-glass-blur-heavy:none !important;
        }
        html[dark],html[data-ytp-theme="dark"] {
          --yt-glass-bg:rgba(24,24,24,.96) !important;
          --yt-panel-bg:rgba(30,30,30,.98) !important;
          --yt-header-bg:rgba(22,22,22,.98) !important;
          --yt-button-bg:rgba(42,42,42,.98) !important;
          --yt-input-bg:rgba(34,34,34,.98) !important;
          --yt-glass-shadow:0 10px 28px rgba(0,0,0,.28) !important;
        }
        html[light],html[data-ytp-theme="light"],html:not([dark]):not([data-ytp-theme="dark"]) {
          --yt-glass-bg:rgba(255,255,255,.98) !important;
          --yt-panel-bg:rgba(250,250,250,.99) !important;
          --yt-header-bg:rgba(245,245,245,.99) !important;
          --yt-button-bg:rgba(236,236,236,.98) !important;
          --yt-input-bg:rgba(245,245,245,.98) !important;
          --yt-glass-shadow:0 10px 24px rgba(0,0,0,.12) !important;
        }
        .ytp-plus-settings-panel,
        .ytp-plus-settings-sidebar,
        .top-button,
        .download-options.visible,
        .speed-options.visible,
        .glass-dropdown__list,
        .glass-panel,
        .glass-card,
        .ytp-plus-comments-sidepanel,
        .ytp-plus-comments-item,
        .youtube-enhancer-notification,
        .stats-modal-content,
        .settings-menu,
        #timecode-panel,
        #shorts-keyboard-feedback,
        .shortsStats,
        .ytp-popup,
        .ytPlayerQuickActionButtonsHost,
        .ytPlayerQuickActionButtonsHostCompactControls,
        .ytPlayerQuickActionButtonsHostDisableBackdropFilter,
        .caption-window,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) ytd-comments,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat {
          backdrop-filter:none !important;
          -webkit-backdrop-filter:none !important;
        }
      `,
      // CLS Prevention styles - always loaded to reserve space for dynamic elements
      clsPrevention: `
        /* CLS Prevention - Reserve space for dynamic elements */
        #ytp-plus-dislike-text { min-width: 1.5em;display: inline-block !important;}
        /* Contain layout only for our own panels (not YouTube layout elements) */
        .ytp-plus-stats-panel, .ytp-plus-modal-content { contain: layout style;}
        /* Reduce CLS from late-loading channel avatars */
        #owner #avatar { min-width: 40px; min-height: 40px; }
        /* Reserve space for action buttons to prevent shift */
        ytd-menu-renderer.ytd-watch-metadata { min-height: 36px; }
        /* Subscribe button stability */
        ytd-subscribe-button-renderer { min-width: 90px; }
      `,
    };

    const buildCriticalCss = (/** @type {any} */ settings) => {
      const z = settings?.zenStyles || {};
      let css = CSS_BLOCKS.clsPrevention; // Always include CLS prevention
      if ((z.themeVariant || 'glass') === 'solid') css += CSS_BLOCKS.themeSolid;
      if (z.hideSideGuide) css += CSS_BLOCKS.hideSideGuide;
      if (z.fixFeedLayout) css += CSS_BLOCKS.fixFeedLayout;
      // theaterEnhancements in critical so overlay CSS applies immediately on DOMContentLoaded
      // (previously non-critical, could take up to 5s to appear on theater mode switch)
      if (z.theaterEnhancements) css += CSS_BLOCKS.theaterEnhancements;
      return css.trim();
    };

    const buildNonCriticalCss = (/** @type {any} */ settings) => {
      const z = settings?.zenStyles || {};
      const themeVariant = z.themeVariant || 'glass';
      let css = '';
      if (z.thumbnailHover) css += CSS_BLOCKS.thumbnailHover;
      if (z.immersiveSearch) css += CSS_BLOCKS.immersiveSearch;
      if (z.hideVoiceSearch) css += CSS_BLOCKS.hideVoiceSearch;
      if (z.transparentHeader) css += CSS_BLOCKS.transparentHeader;
      if (z.cleanSideGuide) css += CSS_BLOCKS.cleanSideGuide;
      const sideColsRaw = Number(z.sideVideosColumns);
      const sideCols = Number.isFinite(sideColsRaw) ? Math.max(0, Math.min(2, sideColsRaw)) : 0;
      const sideColsEnabled = z.sideVideosColumnsEnabled === true;
      // Apply only when explicitly enabled. 0 = YouTube default layout.
      if (sideColsEnabled && sideCols > 0) {
        css += `
        /* Side Videos: ${sideCols}-column card grid */
        #secondary #related {
          min-width: 0 !important;
          overflow: visible !important;
        }
        #secondary {
          overflow: visible !important;
        }
        #secondary #related ytd-item-section-renderer.ytd-watch-next-secondary-results-renderer {
          width: ${sideCols >= 2 ? '200%' : '100%'} !important;
        }
        #secondary #related #contents,
        #secondary #related ytd-watch-next-secondary-results-renderer #items {
          display: grid !important;
          grid-template-columns: repeat(${sideCols}, minmax(0, 1fr)) !important;
          gap: 8px !important;
          padding: 0 !important;
          align-items: start !important;
        }
        /* yt-lockup-view-model: card container */
        #secondary #related yt-lockup-view-model {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin: 0 !important;
          box-sizing: border-box !important;
        }
        /* Host div: switch from horizontal row to vertical column */
        #secondary #related .ytLockupViewModelHost {
          display: flex !important;
          flex-direction: column !important;
          align-items: stretch !important;
          width: 100% !important;
          min-width: 0 !important;
          gap: 0 !important;
          flex-wrap: nowrap !important;
        }
        /* Thumbnail link: override inline style="width: 55%" */
        #secondary #related .ytLockupViewModelContentImage {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          flex: 0 0 auto !important;
          position: relative !important;
        }
        /* Thumbnail image container */
        #secondary #related .ytThumbnailViewModelHost {
          width: 100% !important;
          max-width: 100% !important;
        }
        #secondary #related .ytThumbnailViewModelImage {
          width: 100% !important;
          aspect-ratio: 16 / 9 !important;
        }
        #secondary #related .ytThumbnailViewModelImage img {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          display: block !important;
        }
        /* Metadata: full width */
        #secondary #related .ytLockupViewModelMetadata {
          width: 100% !important;
          min-width: 0 !important;
          flex: 1 1 auto !important;
        }
        #secondary #related yt-lockup-metadata-view-model {
          width: 100% !important;
        }
        #secondary #related .ytLockupMetadataViewModelTextContainer {
          width: 100% !important;
          min-width: 0 !important;
        }
        #secondary #related .ytLockupMetadataViewModelHeadingReset {
          width: 100% !important;
          min-width: 0 !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          display: -webkit-box !important;
          -webkit-line-clamp: 2 !important;
          -webkit-box-orient: vertical !important;
        }
        /* Legacy compact renderers (fallback) */
        #secondary #related ytd-compact-video-renderer,
        #secondary #related ytd-compact-radio-renderer,
        #secondary #related ytd-compact-playlist-renderer {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin: 0 !important;
          box-sizing: border-box !important;
        }
        #secondary #related ytd-compact-video-renderer #dismissible,
        #secondary #related ytd-compact-radio-renderer #dismissible,
        #secondary #related ytd-compact-playlist-renderer #dismissible {
          display: flex !important;
          flex-direction: column !important;
          gap: 6px !important;
          width: 100% !important;
        }
        #secondary #related ytd-compact-video-renderer ytd-thumbnail,
        #secondary #related ytd-compact-radio-renderer ytd-thumbnail,
        #secondary #related ytd-compact-playlist-renderer ytd-thumbnail {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
        }
        #secondary #related ytd-compact-video-renderer .details,
        #secondary #related ytd-compact-video-renderer #meta {
          padding-left: 0 !important;
          min-width: 0 !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
      `;
      }
      if (z.betterCaptions && themeVariant !== 'solid') css += CSS_BLOCKS.betterCaptions;
      if (z.playerBlur && themeVariant !== 'solid') css += CSS_BLOCKS.playerBlur;
      if (z.compactFeed) css += CSS_BLOCKS.compactFeed;
      return css.trim();
    };

    const removeStyles = () => {
      try {
        if (U?.StyleManager?.remove) {
          U.StyleManager.remove(STYLE_MANAGER_KEY);
          U.StyleManager.remove(NON_CRITICAL_STYLE_MANAGER_KEY);
        }
      } catch (_e) {
        U.logSuppressed(_e, 'Enhanced');
      }

      if (nonCriticalTimer) {
        if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
          try {
            window.cancelIdleCallback(nonCriticalTimer);
          } catch (_e) {
            U.logSuppressed(_e, 'Enhanced');
          }
        } else {
          clearTimeout(nonCriticalTimer);
        }
        nonCriticalTimer = null;
      }

      const el = byId(STYLE_ELEMENT_ID);
      if (el) {
        try {
          el.remove();
        } catch (_e) {
          U.logSuppressed(_e, 'Enhanced');
        }
      }

      const ncEl = byId(NON_CRITICAL_STYLE_ID);
      if (ncEl) {
        try {
          ncEl.remove();
        } catch (_e) {
          U.logSuppressed(_e, 'Enhanced');
        }
      }
    };

    const applyNonCriticalStyles = (/** @type {any} */ css) => {
      // Prefer the canonical design-system StyleManager so non-critical zen
      // CSS shares the single style host with the rest of the design system.
      // StyleManager.add('', '') is treated as remove(), so we can hand both
      // "set" and "clear" through the same call.
      try {
        const SM = U?.StyleManager;
        if (SM && typeof SM.add === 'function') {
          SM.add(NON_CRITICAL_STYLE_MANAGER_KEY, css || '');
          // Ensure legacy <style id="ytp-zen-features-style-noncritical">
          // from older releases (or from the raw fallback below) isn't left
          // behind to double-apply the same CSS.
          const legacy = byId(NON_CRITICAL_STYLE_ID);
          if (legacy) legacy.remove();
          return;
        }
      } catch (_e) {
        // Fall through to raw fallback to preserve behavior when StyleManager
        // is somehow unavailable.
      }

      // Raw <style> fallback — only reached when StyleManager isn't available.
      if (!css) {
        const ncEl = byId(NON_CRITICAL_STYLE_ID);
        if (ncEl) ncEl.remove();
        return;
      }

      let ncEl = byId(NON_CRITICAL_STYLE_ID);
      if (!ncEl) {
        ncEl = document.createElement('style');
        ncEl.id = NON_CRITICAL_STYLE_ID;
        (document.head || document.documentElement).appendChild(ncEl);
      }
      ncEl.textContent = css;
    };

    const applyStyles = (/** @type {any} */ settings, immediateNonCritical = false) => {
      const enabled = settings?.enableZenStyles !== false;
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

      try {
        if (U?.StyleManager?.add) {
          U.StyleManager.add(STYLE_MANAGER_KEY, criticalCss || '');
          // Ensure legacy <style> isn't left behind
          const el = byId(STYLE_ELEMENT_ID);
          if (el) el.remove();
          if (nonCriticalTimer) {
            if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
              try {
                window.cancelIdleCallback(nonCriticalTimer);
              } catch (_e) {
                U.logSuppressed(_e, 'Enhanced');
              }
            } else {
              clearTimeout(nonCriticalTimer);
            }
          }
          if (immediateNonCritical) {
            applyNonCriticalStyles(nonCriticalCss);
            nonCriticalTimer = null;
          } else if (typeof requestIdleCallback === 'function') {
            nonCriticalTimer = requestIdleCallback(() => applyNonCriticalStyles(nonCriticalCss), {
              timeout: 5000,
            });
          } else {
            nonCriticalTimer = enhancedSetTimeout_(
              () => applyNonCriticalStyles(nonCriticalCss),
              200
            );
          }
          return;
        }
      } catch (_e) {
        U.logSuppressed(_e, 'Enhanced');
      }

      let el = byId(STYLE_ELEMENT_ID);
      if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ELEMENT_ID;
        (document.head || document.documentElement).appendChild(el);
      }
      el.textContent = criticalCss || '';

      if (nonCriticalTimer) {
        if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
          try {
            window.cancelIdleCallback(nonCriticalTimer);
          } catch (_e) {
            U.logSuppressed(_e, 'Enhanced');
          }
        } else {
          clearTimeout(nonCriticalTimer);
        }
      }
      if (immediateNonCritical) {
        applyNonCriticalStyles(nonCriticalCss);
        nonCriticalTimer = null;
      } else if (typeof requestIdleCallback === 'function') {
        nonCriticalTimer = requestIdleCallback(() => applyNonCriticalStyles(nonCriticalCss), {
          timeout: 5000,
        });
      } else {
        nonCriticalTimer = enhancedSetTimeout_(() => applyNonCriticalStyles(nonCriticalCss), 200);
      }
    };

    const applyFromStorage = (immediateNonCritical = false) =>
      applyStyles(loadSettings(), immediateNonCritical);

    // Initial apply
    applyFromStorage(true);

    // Live updates
    // Dynamic will-change for yt-searchbox: only active during focus to avoid constant GPU layers
    try {
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
      document.addEventListener('focusin', _focusinHandler, { passive: true, capture: true });
      document.addEventListener('focusout', _focusoutHandler, { passive: true, capture: true });
      if (U?.cleanupManager?.register) {
        U.cleanupManager.register(() => {
          document.removeEventListener('focusin', _focusinHandler, { capture: true });
          document.removeEventListener('focusout', _focusoutHandler, { capture: true });
        });
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }

    window.addEventListener('youtube-plus-settings-updated', (/** @type {any} */ e) => {
      try {
        applyStyles(e?.detail || loadSettings(), true);
      } catch (_e) {
        applyFromStorage(true);
      }
    });

    // YouTube SPA re-mounts layout containers on navigation; re-apply from
    // storage to keep global zen styles (e.g. transparent header, hover preview)
    // active on all pages, not only the initial route.
    window.addEventListener(
      'yt-navigate-finish',
      () => {
        applyFromStorage(true);
      },
      { passive: true }
    );
  } catch (err) {
    enhancedLogger?.error?.('Enhanced', 'zen-youtube-features injection failed', err);
  }
})();

// Theater overlay runtime fixes
// 1) Auto-expand live chat in theater overlay (avoid "Show chat" placeholder)
// 2) Preload comments content so Zen comments panel is not empty
(function () {
  const host = typeof location === 'undefined' ? '' : location.hostname;
  if (!host) return;
  if (!(/(^|\.)youtube\.com$/.test(host) || /\.youtube\.google/.test(host))) return;

  const SETTINGS_KEY = U?.SETTINGS_KEY || 'youtube_plus_settings';
  const PRELOADED_ATTR = 'data-ytp-zen-comments-preloaded';

  const readSettings = () => {
    try {
      const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
      if (store && typeof store.load === 'function') {
        return store.load();
      }
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_e) {
      return null;
    }
  };

  const isTheaterEnhancementEnabled = () => {
    const settings = readSettings();
    if (!settings) return true;
    if (settings.enableZenStyles === false) return false;
    if (settings.zenStyles && settings.zenStyles.theaterEnhancements === false) return false;
    return true;
  };

  const clickElement = (/** @type {any} */ element) => {
    if (!element) return;
    try {
      element.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    } catch (_e) {
      try {
        element.click();
      } catch (_e) {
        U.logSuppressed(_e, 'Enhanced');
      }
    }
  };

  const preloadCommentsInBackground = (/** @type {any} */ flexy) => {
    const commentsTab = $('#tab-comments');
    const commentsBtn = $('#material-tabs a[tyt-tab-content="#tab-comments"]');
    if (!(commentsTab && commentsBtn) || commentsTab.getAttribute(PRELOADED_ATTR) === '1') return;

    // Disable tiny pre-load mode CSS from main.js for theater overlay comments.
    if (flexy && !flexy.hasAttribute('keep-comments-scroller')) {
      flexy.setAttribute('keep-comments-scroller', '');
    }

    const activeBtn = $('#material-tabs a[tyt-tab-content].active');
    clickElement(commentsBtn);

    requestAnimationFrame(() => {
      commentsTab.setAttribute(PRELOADED_ATTR, '1');
      if (activeBtn && activeBtn !== commentsBtn && activeBtn.isConnected) {
        clickElement(activeBtn);
      }
    });
  };

  // Re-enabled: now safe because ytBtnCancelTheater() in main.js is guarded by
  // isZenTheaterOverlayActive() — it won't exit theater when zen overlay CSS is active.
  // Without this JS step, the iframe inside #chat doesn't load when [collapsed].
  let expandAttempts = 0;
  const MAX_EXPAND_ATTEMPTS = 3;

  const expandLiveChat = () => {
    const chat = $('ytd-live-chat-frame#chat');
    if (!chat) return;

    // Step 1: Uncollapse the chat element if it has [collapsed] attribute
    if (chat.hasAttribute('collapsed')) {
      if (expandAttempts >= MAX_EXPAND_ATTEMPTS) return;
      expandAttempts++;

      // Method 1: Polymer internal API (same approach as main.js ytBtnExpandChat)
      let expanded = false;
      try {
        const cnt =
          chat.polymerController ||
          (typeof chat.__data !== 'undefined' ? chat : null) ||
          (chat.inst ? chat.inst : null);
        if (cnt && typeof cnt.setCollapsedState === 'function') {
          cnt.setCollapsedState({
            setLiveChatCollapsedStateAction: { collapsed: false },
          });
          expanded = cnt.collapsed === false;
        }
        if (!expanded && cnt && typeof cnt.collapsed === 'boolean') {
          cnt.collapsed = false;
          if (cnt.isHiddenByUser === true) cnt.isHiddenByUser = false;
          expanded = cnt.collapsed === false;
        }
      } catch (_e) {
        U.logSuppressed(_e, 'Enhanced');
      }

      // Method 2: click the "Show chat" button as fallback
      if (!expanded) {
        const showBtn = chat.querySelector(
          '#show-hide-button div.yt-spec-touch-feedback-shape, ' +
            '#show-hide-button ytd-toggle-button-renderer, ' +
            '#show-hide-button button'
        );
        if (showBtn) clickElement(showBtn);
      }
    }

    // Step 2: Ensure the iframe has its src loaded.
    // YouTube's Polymer binding may not fire when we uncollapse programmatically,
    // leaving the iframe empty. Manually set src from the element's URL property.
    const iframe = chat.querySelector('iframe#chatframe');
    if (iframe && !iframe.src && chat.url) {
      iframe.src = chat.url;
    }
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

    expandLiveChat();
    preloadCommentsInBackground(flexy);
  };

  /** @type {ReturnType<typeof setTimeout> | null} */
  let debounceTimer = null;
  const scheduleRun = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = enhancedSetTimeout_(runOverlayFixes, 150);
  };

  // --- Targeted observers (NOT document.body subtree — that fires hundreds of times during page parse) ---
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
      expandAttempts = 0; // reset on navigation so chat can expand on new page
      enhancedSetTimeout_(() => {
        attachFlexyObserver();
        attachChatObserver();
        scheduleRun();
      }, 180);
    };
    if (U?.cleanupManager?.registerListener) {
      U.cleanupManager.registerListener(window, 'yt-navigate-finish', _navFinishHandler, {
        passive: true,
      });
    } else {
      window.addEventListener('yt-navigate-finish', _navFinishHandler, { passive: true });
    }

    try {
      if (U?.cleanupManager?.register) {
        U.cleanupManager.register(() => {
          coordinator.unwatch(flexyObserverId);
          coordinator.unwatch(chatObserverId);
        });
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Enhanced');
    }
  };

  // Defer observer setup to after DOMContentLoaded so it does NOT fire during page parse
  // (observing document.documentElement at document-start fires hundreds of times and hurts LCP)
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        scheduleRun();
        setupOverlayObservers();
      },
      { once: true }
    );
  } else {
    scheduleRun();
    setupOverlayObservers();
  }
})();
