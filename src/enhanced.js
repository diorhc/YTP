// Shared DOM helpers from YouTubeUtils — defined at file scope for use across all IIFEs
const enhancedSetTimeout_ = setTimeout;
const { $, $$, byId } = window.YouTubeUtils || {};
const onDomReady =
  window.YouTubeUtils?.onDomReady ||
  ((/** @type {() => void} */ cb) => {
    if (document.readyState !== 'loading') cb();
    else document.addEventListener('DOMContentLoaded', cb, { once: true });
  });

// Enhanced Tabviews
(function () {
  'use strict';

  const _setSafeHTML = window.YouTubeUtils.setSafeHTML;
  const _getLanguage = window.YouTubeUtils.getLanguage;

  // Shared translation helper from YouTubeUtils
  const t = window.YouTubeUtils.t;

  /**
   * Configuration object for scroll-to-top button
   * @type {Object}
   * @property {boolean} enabled - Whether the feature is enabled
   * @property {string} storageKey - LocalStorage key for settings
   */
  /** @type {any} */
  const config = {
    enabled: window.YouTubeUtils?.loadFeatureEnabled?.('enableScrollToTopButton') ?? true,
    storageKey: 'youtube_top_button_settings',
  };

  // Shared debounce helper — prefers YouTubeUtils, falls back to shared defaults
  const _debounce = window.YouTubeUtils.debounce;

  const isTabviewEnabled = () => window.YouTubeUtils?.loadFeatureEnabled?.('enableTabview') ?? true;

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
      const host = window.location.hostname;
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
      window.console.warn('[YouTube+] Error detecting scroll container:', e);
    }
    return document.scrollingElement || document.documentElement;
  };

  /** @type {any} */
  let universalWindowScrollHandler = null;

  const removeUniversalButton = () => {
    try {
      const btn = byId('universal-top-button');
      if (btn) btn.remove();
    } catch (e) {
      // Non-critical, suppressed
    }
    try {
      if (universalScrollHandler && universalScrollContainer) {
        universalScrollContainer.removeEventListener('scroll', universalScrollHandler);
      }
    } catch (e) {
      // Non-critical, suppressed
    }
    try {
      if (universalWindowScrollHandler) {
        window.removeEventListener('scroll', universalWindowScrollHandler);
      }
    } catch (e) {
      // Non-critical, suppressed
    }
    try {
      if (universalWindowScrollHandler && universalExtraScrollTargets.size) {
        for (const target of universalExtraScrollTargets) {
          try {
            target.removeEventListener('scroll', universalWindowScrollHandler);
            if (/** @type {any} */ (target)._ytpScrollAttached) {
              /** @type {any} */ (target)._ytpScrollAttached = false;
            }
          } catch (e) {
            // Non-critical, suppressed
          }
        }
      }
    } catch (e) {
      // Non-critical, suppressed
    }
    try {
      if (universalAttachTimeoutIds.length) {
        universalAttachTimeoutIds.forEach(id => clearTimeout(id));
      }
    } catch (e) {
      // Non-critical, suppressed
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
    if (window.location.hostname !== 'music.youtube.com') return null;

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
      } catch (e) {
        // Non-critical, suppressed
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
        } catch (e) {
          // Non-critical, suppressed
        }
      }
    }
    return null;
  };

  const removeMusicSideButton = () => {
    try {
      const btn = byId('music-side-top-button');
      if (btn) btn.remove();
    } catch (e) {
      // Non-critical, suppressed
    }
    try {
      if (musicSideScrollHandler && musicSideScrollContainer) {
        musicSideScrollContainer.removeEventListener('scroll', musicSideScrollHandler);
      }
    } catch (e) {
      // Non-critical, suppressed
    }
    musicSideScrollHandler = null;
    musicSideScrollContainer = null;
  };

  const cleanupTopButtons = () => {
    try {
      const rightButton = byId('right-tabs-top-button');
      if (rightButton) rightButton.remove();
    } catch (e) {
      // Non-critical, suppressed
    }
    try {
      const playlistButton = byId('playlist-panel-top-button');
      if (playlistButton) playlistButton.remove();
    } catch (e) {
      // Non-critical, suppressed
    }

    removeMusicSideButton();

    removeUniversalButton();

    try {
      $$('#right-tabs .tab-content-cld').forEach(tab => {
        if (tab && tab._topButtonScrollHandler) {
          tab.removeEventListener('scroll', tab._topButtonScrollHandler);
          tab._topButtonScrollHandler = null;
        }
      });
    } catch (e) {
      window.console.warn('[YouTube+] Error cleaning up tab scroll handlers:', e);
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
    } catch (e) {
      // Non-critical, suppressed
    }

    try {
      const playlistScroll = $('ytd-playlist-panel-renderer #items');
      if (playlistScroll && playlistScroll._topButtonScrollHandler) {
        playlistScroll.removeEventListener('scroll', playlistScroll._topButtonScrollHandler);
        playlistScroll._topButtonScrollHandler = null;
      }
    } catch (e) {
      // Non-critical, suppressed
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
    (window.YouTubeUtils?.isWatchPage?.() ?? false) ||
    (window.YouTubeUtils?.isShortsPage?.() ?? false);

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
        const host = window.location.hostname;
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
      window.console.error('[YouTube+][Enhanced] Error scrolling to top:', error);
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
        const _cm = window.YouTubeUtils?.cleanupManager;
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
   * Adds CSS styles for scroll-to-top button and scrollbars
   * @returns {void}
   */
  const addStyles = () => {
    if (byId('custom-styles')) return;

    const style = document.createElement('style');
    style.id = 'custom-styles';
    style.textContent = `
      :root{--yt-scrollbar-width:8px;--yt-scrollbar-track:transparent;--yt-scrollbar-thumb:rgba(144,144,144,.5);--yt-scrollbar-thumb-hover:rgba(170,170,170,.7);--yt-scrollbar-thumb-active:rgba(190,190,190,.9);}
      ::-webkit-scrollbar{width:var(--yt-scrollbar-width)!important;height:var(--yt-scrollbar-width)!important;}
      ::-webkit-scrollbar-track{background:var(--yt-scrollbar-track)!important;border-radius:4px!important;}
      ::-webkit-scrollbar-thumb{background:var(--yt-scrollbar-thumb)!important;border-radius:4px!important;transition:background .2s!important;}
      ::-webkit-scrollbar-thumb:hover{background:var(--yt-scrollbar-thumb-hover)!important;}
      ::-webkit-scrollbar-thumb:active{background:var(--yt-scrollbar-thumb-active)!important;}
      ::-webkit-scrollbar-corner{background:transparent!important;}
      html,body,#content,#guide-content,#secondary,#comments,#chat,ytd-comments,ytd-watch-flexy,ytd-browse,ytd-search,ytd-playlist-panel-renderer,#right-tabs,.tab-content-cld,ytmusic-app-layout{scrollbar-width:thin;scrollbar-color:var(--yt-scrollbar-thumb) var(--yt-scrollbar-track);}
      html[dark]{--yt-scrollbar-thumb:rgba(144,144,144,.4);--yt-scrollbar-thumb-hover:rgba(170,170,170,.6);--yt-scrollbar-thumb-active:rgba(190,190,190,.8);}
      .top-button{position:fixed;bottom:16px;right:16px;width:40px;height:40px;background:var(--yt-button-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2100;opacity:0;visibility:hidden;transition:all .3s cubic-bezier(0.4, 0, 0.2, 1);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);box-shadow:var(--yt-shadow);}
      .top-button:hover{background:var(--yt-hover-bg);transform:translateY(-2px) scale(1.07);box-shadow:var(--yt-shadow);}
      .top-button:active{transform:translateY(-1px) scale(1.03);}
      .top-button:focus{outline:2px solid var(--yt-accent);outline-offset:2px;}
      .top-button.visible{opacity:1;visibility:visible;}
      .top-button svg{transition:transform .2s ease;}
      .top-button:hover svg{transform:translateY(-1px) scale(1.1);}
      html[dark]{--yt-top-btn-bg:var(--yt-button-bg);--yt-top-btn-color:var(--yt-text-primary);--yt-top-btn-border:var(--yt-glass-border);--yt-top-btn-hover:var(--yt-hover-bg);}
      html:not([dark]){--yt-top-btn-bg:var(--yt-button-bg);--yt-top-btn-color:var(--yt-text-primary);--yt-top-btn-border:var(--yt-glass-border);--yt-top-btn-hover:var(--yt-hover-bg);}
      #right-tabs .top-button{position:absolute;z-index:1000;}
      ytd-watch-flexy:not([tyt-tab^="#"]) #right-tabs .top-button{display:none;}
      ytd-playlist-panel-renderer .top-button{position:absolute;z-index:1000;}
      ytd-watch-flexy[flexy] #movie_player, ytd-watch-flexy[flexy] #movie_player .html5-video-container, ytd-watch-flexy[flexy] .html5-main-video{width:100%!important; max-width:100%!important;}
      ytd-watch-flexy[flexy] .html5-main-video{height:auto!important; max-height:100%!important; object-fit:contain!important; transform:none!important;}
      ytd-watch-flexy[flexy] #player-container-outer, ytd-watch-flexy[flexy] #movie_player{display:flex!important; align-items:center!important; justify-content:center!important;}
      /* Return YouTube Dislike button styling */
      dislike-button-view-model button{min-width:fit-content!important;width:auto!important;}
      dislike-button-view-model .yt-spec-button-shape-next__button-text-content{display:inline-flex!important;align-items:center!important;justify-content:center!important;}
      #ytp-plus-dislike-text{display:inline-block!important;visibility:visible!important;opacity:1!important;margin-left:6px!important;font-size:1.4rem!important;line-height:2rem!important;font-weight:500!important;}
      ytd-segmented-like-dislike-button-renderer dislike-button-view-model button{min-width:fit-content!important;}
      ytd-segmented-like-dislike-button-renderer .yt-spec-button-shape-next__button-text-content{min-width:2.4rem!important;}
      /* Shorts-specific dislike button styling */
      ytd-reel-video-renderer dislike-button-view-model #ytp-plus-dislike-text{font-size:1.2rem!important;line-height:1.8rem!important;margin-left:4px!important;}
      ytd-reel-video-renderer dislike-button-view-model button{padding:8px 12px!important;min-width:auto!important;}
      ytd-shorts dislike-button-view-model .yt-spec-button-shape-next__button-text-content{display:inline-flex!important;min-width:auto!important;}
        `;
    (document.head || document.documentElement).appendChild(style);
  };

  /**
   * Updates button visibility based on scroll position
   * @param {HTMLElement} scrollContainer - The container being scrolled
   * @param {HTMLElement} button - The button element
   * @returns {void}
   */
  const handleScroll = (scrollContainer, button) => {
    try {
      if (!button || !scrollContainer) return;
      button.classList.toggle('visible', scrollContainer.scrollTop > 100);
    } catch (error) {
      window.console.error('[YouTube+][Enhanced] Error in handleScroll:', error);
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
            window.console.warn('[YouTube+] Error cleaning up right-tabs scroll handler:', e);
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
          window.console.error('[YouTube+][Enhanced] Error in setupScrollListener:', error);
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
      window.console.error('[YouTube+][Enhanced] Error creating button:', error);
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
      const host = window.location.hostname;
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
      scrollContainer.addEventListener('scroll', scrollHandler, { passive: true });

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
              target.addEventListener('scroll', musicScrollCheck, { passive: true });
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
      window.console.error('[YouTube+][Enhanced] Error creating universal button:', error);
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
      /** @type {any} */ (button).style.position = 'absolute';
      /** @type {any} */ (button).style.bottom = '16px';
      /** @type {any} */ (button).style.right = '16px';
      /** @type {any} */ (button).style.zIndex = '1000';

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
      scrollContainer.addEventListener('scroll', scrollHandler, { passive: true });
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
        } catch (e) {
          // On error, prefer hiding to avoid stray UI
          try {
            /** @type {any} */ (button).style.display = 'none';
          } catch (e) {
            // Non-critical, suppressed
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
      } catch (e) {
        ro = null;
      }

      // Observe attribute/class changes via centralized coordinator.
      const coordinator = window.YouTubeMutationCoordinator;
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
        if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
          if (ro) {
            YouTubeUtils.cleanupManager.register(() => {
              try {
                ro.disconnect();
              } catch (e) {
                // Non-critical, suppressed
              }
            });
          }
        }
      } catch (e) {
        // Non-critical, suppressed
      }
    } catch (error) {
      window.console.error('[YouTube+][Enhanced] Error creating playlist panel button:', error);
    }
  };

  /**
   * Creates scroll-to-top button for YouTube Music side panel
   * @returns {void}
   */
  const createMusicSidePanelButton = () => {
    try {
      if (window.location.hostname !== 'music.youtube.com') return;
      setupTopButtonDelegation();
      if (byId('music-side-top-button')) return;
      if (!config.enabled) return;

      const panel = getMusicSidePanelContainer();
      if (!panel) {
        // Retry with scheduler since YouTube Music loads content dynamically
        window.YouTubeUtils?.createRetryScheduler?.({
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
      /** @type {any} */ (button).style.position = 'absolute';
      /** @type {any} */ (button).style.bottom = '16px';
      /** @type {any} */ (button).style.right = '16px';
      /** @type {any} */ (button).style.zIndex = '1000';

      panel.appendChild(button);

      const scrollHandler = _debounce(() => {
        button.classList.toggle('visible', panel.scrollTop > 100);
      }, 100);

      musicSideScrollContainer = panel;
      musicSideScrollHandler = scrollHandler;
      panel.addEventListener('scroll', scrollHandler, { passive: true });
      button.classList.toggle('visible', panel.scrollTop > 100);
    } catch (error) {
      window.console.error('[YouTube+][Enhanced] Error creating music side button:', error);
    }
  };

  // --- Return YouTube Dislike integration ---
  const RETURN_DISLIKE_API = 'https://returnyoutubedislikeapi.com/votes';
  const DISLIKE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  const dislikeCache = new Map(); // videoId -> { value, expiresAt }
  /** @type {string | null} */
  let dislikeObserver = null;
  /** @type {string | null} */
  let dislikePollTimer = null;

  const formatCompactNumber = (/** @type {any} */ number) => {
    try {
      return new Intl.NumberFormat(_getLanguage() || 'en', {
        notation: 'compact',
        compactDisplay: 'short',
      }).format(Number(number) || 0);
    } catch (e) {
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
        dislikeCache.set(videoId, { value: val, expiresAt: Date.now() + DISLIKE_CACHE_TTL });
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
        dislikeCache.set(videoId, { value: val, expiresAt: Date.now() + DISLIKE_CACHE_TTL });
        return val;
      } finally {
        clearTimeout(id);
      }
    } catch (e) {
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
      return urlObj.searchParams.get('v');
    } catch (e) {
      return null;
    }
  };

  const getButtonsContainer = () => {
    return (
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
      buttons.querySelector('button[aria-label*="islike"]') ||
      buttons.querySelector('button[aria-label*="Не нравится"]');
    if (dislikeBtn) {
      return dislikeBtn.closest('dislike-button-view-model') || dislikeBtn.parentElement;
    }

    // Last resort: second child in container
    return buttons.children && buttons.children[1] ? buttons.children[1] : null;
  };

  const getDislikeButton = () => {
    // Handle Shorts variants and main page segmented buttons
    const isShorts = window.location.pathname.startsWith('/shorts');
    if (isShorts) {
      return getDislikeButtonShorts();
    }

    const buttons = getButtonsContainer();
    return getDislikeButtonFromContainer(buttons);
  };

  const getOrCreateDislikeText = (/** @type {any} */ dislikeButton) => {
    if (!dislikeButton) return null;

    // Check if our custom text already exists (prevent duplicates)
    const existingCustom = dislikeButton.querySelector('#ytp-plus-dislike-text');
    if (existingCustom) return existingCustom;

    // Try to find existing text container in various YouTube button structures
    const textSpan =
      dislikeButton.querySelector('span.yt-core-attributed-string:not(#ytp-plus-dislike-text)') ||
      dislikeButton.querySelector('#text') ||
      dislikeButton.querySelector('yt-formatted-string') ||
      dislikeButton.querySelector('span[role="text"]:not(#ytp-plus-dislike-text)') ||
      dislikeButton.querySelector('.yt-spec-button-shape-next__button-text-content');

    // If native text exists, use it directly to avoid duplication
    if (textSpan && textSpan.id !== 'ytp-plus-dislike-text') {
      textSpan.id = 'ytp-plus-dislike-text';
      return textSpan;
    }

    // For view-model buttons, find the proper container
    const viewModelHost = dislikeButton.closest('ytDislikeButtonViewModelHost') || dislikeButton;
    const buttonShape =
      viewModelHost.querySelector('button-view-model button') ||
      viewModelHost.querySelector('button[aria-label]') ||
      dislikeButton.querySelector('button') ||
      dislikeButton;

    // Check if text container already exists
    let textContainer = buttonShape.querySelector(
      '.yt-spec-button-shape-next__button-text-content'
    );

    // Create a dedicated span with proper styling to match like button
    // Use min-width to prevent CLS when count loads
    const created = document.createElement('span');
    created.id = 'ytp-plus-dislike-text';
    created.setAttribute('role', 'text');
    created.className = 'yt-core-attributed-string yt-core-attributed-string--white-space-no-wrap';
    const isShorts = window.location.pathname.startsWith('/shorts');
    // Added min-width to reserve space and prevent CLS
    /** @type {any} */ (created).style.cssText = isShorts
      ? 'margin-left: 4px; font-size: 1.2rem; line-height: 1.8rem; font-weight: 500; min-width: 1.5em; display: inline-block; text-align: center;'
      : 'margin-left: 6px; font-size: 1.4rem; line-height: 2rem; font-weight: 500; min-width: 2em; display: inline-block; text-align: center;';

    try {
      if (!textContainer) {
        // Create text container if it doesn't exist (matching like button structure)
        textContainer = document.createElement('div');
        textContainer.className = 'yt-spec-button-shape-next__button-text-content';
        textContainer.appendChild(created);
        buttonShape.appendChild(textContainer);
      } else {
        textContainer.appendChild(created);
      }

      // Ensure button has proper width
      /** @type {any} */ (buttonShape).style.minWidth = 'auto';
      /** @type {any} */ (buttonShape).style.width = 'auto';
      if (viewModelHost !== dislikeButton) {
        /** @type {any} */ (viewModelHost).style.minWidth = 'auto';
      }
    } catch (e) {
      window.console.warn('YTP: Failed to create dislike text:', e);
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
        const buttonShape = container.closest('button') || dislikeButton.querySelector('button');
        if (buttonShape) {
          /** @type {any} */ (buttonShape).style.minWidth = 'fit-content';
          /** @type {any} */ (buttonShape).style.width = 'auto';
        }
      }
    } catch (e) {
      window.console.warn('YTP: Failed to set dislike display:', e);
    }
  };

  const setupDislikeObserver = (/** @type {any} */ dislikeButton) => {
    if (!dislikeButton) return;
    if (dislikeObserver) {
      window.YouTubeMutationCoordinator?.unwatch?.(dislikeObserver);
      dislikeObserver = null;
    }

    // Don't observe if we already have text displayed
    const existingText = dislikeButton.querySelector('#ytp-plus-dislike-text');
    if (existingText?.textContent && existingText.textContent !== '0') {
      return;
    }

    const coordinator = window.YouTubeMutationCoordinator;
    if (coordinator?.watchTarget) {
      dislikeObserver = 'enhanced::dislikeObserver';
      coordinator.watchTarget(
        dislikeObserver,
        dislikeButton,
        () => {
          // on any mutation, update displayed cached value
          const vid = getVideoIdForDislike();
          const cached = dislikeCache.get(vid);
          if (cached) {
            const btn = getDislikeButton();
            if (btn) setDislikeDisplay(btn, cached.value);
          }
        },
        { childList: true, subtree: true, attributes: true }
      );
    }
  };

  const initReturnDislike = async () => {
    try {
      // avoid multiple polls
      if (dislikePollTimer) return;

      // Use MutationObserver instead of setInterval for better performance
      const checkButton = async () => {
        const btn = getDislikeButton();
        if (btn) {
          if (dislikePollTimer) {
            window.YouTubeMutationCoordinator?.unsubscribe?.(dislikePollTimer);
            dislikePollTimer = null;
          }
          const vid = getVideoIdForDislike();
          const val = await fetchDislikes(vid);
          setDislikeDisplay(btn, val);
          setupDislikeObserver(btn);
          return true;
        }
        return false;
      };

      // Check immediately
      if (await checkButton()) return;

      // Set up coordinator subscription for button appearance
      const isShorts = window.location.pathname.startsWith('/shorts');
      const maxTime = 10000; // 10 seconds timeout
      const startTime = Date.now();

      const coordinator = window.YouTubeMutationCoordinator;
      if (coordinator?.subscribeRoot) {
        const pollSelector = isShorts
          ? '#shorts-container'
          : 'ytd-watch-flexy #below, #page-manager';
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
            await checkButton();
          },
          { selector: pollSelector, childList: true, attributes: false, subtree: true }
        );
      }
    } catch (e) {
      window.console.warn('[YouTube+] Failed to initialize Return YouTube Dislike:', e);
    }
  };

  const cleanupReturnDislike = () => {
    try {
      if (dislikePollTimer) {
        window.YouTubeMutationCoordinator?.unsubscribe?.(dislikePollTimer);
        dislikePollTimer = null;
      }
      if (dislikeObserver) {
        window.YouTubeMutationCoordinator?.unwatch?.(dislikeObserver);
        dislikeObserver = null;
      }
      // Remove all created dislike text spans
      $$('#ytp-plus-dislike-text').forEach(el => {
        try {
          if (el.parentNode) el.parentNode.removeChild(el);
        } catch (e) {
          // Non-critical, suppressed
        }
      });
      // Clear cache to free memory
      dislikeCache.clear();
    } catch (e) {
      window.console.warn('YTP: Dislike cleanup error:', e);
    }
  };

  /**
   * Observes DOM changes to detect tab switches
   * @returns {string|null} Subscription id or null on error
   */
  const observeTabChanges = () => {
    try {
      const coordinator = window.YouTubeMutationCoordinator;
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
            window.console.error('[YouTube+][Enhanced] Error in mutation observer:', error);
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
        window.YouTubeUtils?.ObserverRegistry?.track?.();
      } catch (e) {
        // Non-critical, suppressed
      }

      const rightTabs = $('#right-tabs');
      if (rightTabs) {
        return observerId;
      }
      // No target found — untrack
      try {
        window.YouTubeUtils?.ObserverRegistry?.untrack?.();
      } catch (e) {
        // Non-critical, suppressed
      }
      coordinator.unsubscribe(observerId);
      return null;
    } catch (error) {
      window.console.error('[YouTube+][Enhanced] Error in observeTabChanges:', error);
      return null;
    }
  };

  /**
   * Check if current page needs universal button
   * @returns {boolean}
   */
  const needsUniversalButton = () => {
    const host = window.location.hostname;
    // Always show on Music and Studio
    if (host === 'music.youtube.com' || host === 'studio.youtube.com') return true;

    if (
      (window.YouTubeUtils?.isWatchPage?.() ?? false) ||
      (window.YouTubeUtils?.isShortsPage?.() ?? false)
    ) {
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
      window.console.error('[YouTube+][Enhanced] Error in click handler:', error);
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
        tabDelegationHandler = (/** @type {any} */ ev, /** @type {any} */ target) => {
          void ev;
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
      window.console.error('[YouTube+][Enhanced] Error in setupEvents:', error);
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
      window.console.error('[YouTube+][Enhanced] Error cleaning up events:', error);
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
    } catch (e) {
      // Non-critical, suppressed
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
    } catch (e) {
      // Non-critical, suppressed
    }
    playlistPanelCheckTimeoutId = null;

    try {
      if (tabChangesObserver) {
        window.YouTubeMutationCoordinator?.unsubscribe?.(tabChangesObserver);
      }
      if (tabChangesObserver) {
        try {
          window.YouTubeUtils?.ObserverRegistry?.untrack?.();
        } catch (e) {
          // Non-critical, suppressed
        }
      }
    } catch (e) {
      // Non-critical, suppressed
    }
    tabChangesObserver = null;

    cleanupEvents();

    try {
      cleanupReturnDislike();
    } catch (e) {
      // Non-critical, suppressed
    }
  };

  const startWatchEnhancements = () => {
    if (!config.enabled) return;
    if (!(window.YouTubeUtils?.isWatchPage?.() ?? false)) return;

    const token = ++watchInitToken;
    setupEvents();

    // Use shared RetryScheduler for tab detection
    const tabScheduler = window.YouTubeUtils?.createRetryScheduler?.({
      check: () => {
        if (token !== watchInitToken || !(window.YouTubeUtils?.isWatchPage?.() ?? false)) {
          return true;
        } // stop
        if ($('#right-tabs')) {
          createButton();
          try {
            if (tabChangesObserver) {
              window.YouTubeMutationCoordinator?.unsubscribe?.(tabChangesObserver);
            }
          } catch (e) {
            // Non-critical, suppressed
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
    const playlistScheduler = window.YouTubeUtils?.createRetryScheduler?.({
      check: () => {
        if (token !== watchInitToken || !(window.YouTubeUtils?.isWatchPage?.() ?? false)) {
          return true;
        }
        try {
          const playlistPanel = $('ytd-playlist-panel-renderer');
          if (playlistPanel && !byId('playlist-panel-top-button')) {
            createPlaylistPanelButton();
            return true;
          }
        } catch (error) {
          window.console.error('[YouTube+][Enhanced] Error checking for playlist panel:', error);
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
          if (window.location.hostname === 'music.youtube.com' && !byId('music-side-top-button')) {
            createMusicSidePanelButton();
          }
        } catch (error) {
          window.console.error('[YouTube+][Enhanced] Error checking page type:', error);
        }
      };

      const onNavigate = () => {
        stopWatchEnhancements();
        invalidateMusicContainersCache();
        checkPageType();

        if (shouldInitReturnDislike()) {
          const _doInitDislike = () => {
            try {
              initReturnDislike();
            } catch (e) {
              window.console.warn('[YouTube+] initReturnDislike error:', e);
            }
          };
          if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(_doInitDislike, { timeout: 3000 });
          } else {
            enhancedSetTimeout_(_doInitDislike, 0);
          }
        }

        // Watch-specific UI only initializes on /watch
        startWatchEnhancements();
      };

      // Initial run
      onNavigate();

      // Listen for navigation changes (YouTube is SPA)
      if (typeof window.YouTubeUtils?.cleanupManager?.registerListener === 'function') {
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
      if (window.location.hostname === 'music.youtube.com') {
        window.addEventListener('popstate', () => enhancedSetTimeout_(onNavigate, 200));
        // Observe DOM for side-panel becoming scrollable via centralized coordinator.
        const coordinator = window.YouTubeMutationCoordinator;
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
      window.console.error('[YouTube+][Enhanced] Error in initialization:', error);
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
        ((window.YouTubeUtils?.isWatchPage?.() ?? false) ||
          (window.YouTubeUtils?.isShortsPage?.() ?? false)) &&
        !tabviewEnabled;
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
      if (window.location.hostname === 'music.youtube.com' && !byId('music-side-top-button')) {
        createMusicSidePanelButton();
      }
      startWatchEnhancements();
    } catch (e) {
      // Non-critical, suppressed
    }
  });

  onDomReady(scheduleInit);
})();

// Remember Manual Playback Quality
(function () {
  'use strict';

  const QUALITY_STORAGE_KEY = 'youtube_plus_manual_playback_quality';
  const APPLY_ATTEMPTS = 16;
  const APPLY_INTERVAL_MS = 350;

  /** @type {Array<ReturnType<typeof setTimeout>>} */
  let pendingApplyTimeouts = [];
  let lastAppliedVideoId = '';

  const isVideoPage = () => {
    try {
      const path = window.location.pathname || '';
      return path === '/watch' || path.startsWith('/shorts/');
    } catch (e) {
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
    } catch (e) {
      // Non-critical, suppressed
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
    } catch (e) {
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
    } catch (e) {
      // Non-critical, suppressed
    }
  };

  const applyStoredQualityOnce = () => {
    if (!(window.YouTubeUtils?.loadFeatureEnabled?.('enableRememberManualQuality') ?? true)) {
      return true;
    }
    if (!isVideoPage()) return true;

    const preferredQuality = getStoredQuality();
    if (!preferredQuality) return true;

    const player = getPlayer();
    if (!player) return false;

    const currentVideoId = getCurrentVideoId();
    if (currentVideoId && lastAppliedVideoId === currentVideoId) return true;

    try {
      const availableQualityLevels =
        typeof player.getAvailableQualityLevels === 'function'
          ? player.getAvailableQualityLevels().map(normalizeQuality).filter(Boolean)
          : [];

      if (availableQualityLevels.length && !availableQualityLevels.includes(preferredQuality)) {
        lastAppliedVideoId = currentVideoId;
        return true;
      }

      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(preferredQuality, preferredQuality);
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(preferredQuality);
      }

      lastAppliedVideoId = currentVideoId;
      return true;
    } catch (e) {
      return false;
    }
  };

  const scheduleApplyStoredQuality = () => {
    clearPendingApplyTimeouts();
    if (!(window.YouTubeUtils?.loadFeatureEnabled?.('enableRememberManualQuality') ?? true)) {
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

    if (!label) return;
    if (!/(\bauto\b|\d{3,4}p|\bhd\b|\b4k\b|\b8k\b)/.test(label)) return;

    enhancedSetTimeout_(() => {
      if (!(window.YouTubeUtils?.loadFeatureEnabled?.('enableRememberManualQuality') ?? true)) {
        return;
      }

      if (label.includes('auto')) {
        storeQuality('auto');
        return;
      }

      const currentQuality = normalizeQuality(getPlayer()?.getPlaybackQuality?.());
      if (currentQuality) {
        storeQuality(currentQuality);
      }
    }, 150);
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

  window.addEventListener('yt-navigate-finish', handleNavigation, { passive: true });
  onDomReady(scheduleApplyStoredQuality);
})();

// Styles
(function () {
  try {
    const host = typeof location === 'undefined' ? '' : location.hostname;
    if (!host) return;
    if (!/(^|\.)youtube\.com$/.test(host) && !/\.youtube\.google/.test(host)) return;

    const SETTINGS_KEY = window.YouTubeUtils?.SETTINGS_KEY || 'youtube_plus_settings';
    const STYLE_ELEMENT_ID = 'ytp-zen-features-style';
    const NON_CRITICAL_STYLE_ID = 'ytp-zen-features-style-noncritical';
    const STYLE_MANAGER_KEY = 'zen-features-style';
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
        misc: true,
      },
    };

    const loadSettings = () => {
      /** @type {any} */
      let parsed = null;
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) parsed = JSON.parse(raw);
      } catch (e) {
        window.console.warn('[YouTube+] Zen settings parse error:', e);
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
        @media (prefers-color-scheme: dark) {
          yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) .ytSearchboxComponentInputBox,
          yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {background-color: var(--yt-modal-bg) !important;}
        }
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
      misc: `        
        /* Show video meta on hover */
        #content #dismissible:hover ytd-video-meta-block { opacity: 1 !important;}
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
        html[dark],html:not([dark]):not([light]) {
          --yt-glass-bg:rgba(24,24,24,.96) !important;
          --yt-panel-bg:rgba(30,30,30,.98) !important;
          --yt-header-bg:rgba(22,22,22,.98) !important;
          --yt-button-bg:rgba(42,42,42,.98) !important;
          --yt-input-bg:rgba(34,34,34,.98) !important;
          --yt-glass-shadow:0 10px 28px rgba(0,0,0,.28) !important;
        }
        html[light] {
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
        ytd-watch-flexy #secondary #related ytd-item-section-renderer #contents,
        ytd-watch-flexy #secondary #related ytd-watch-next-secondary-results-renderer #items {
          display: grid !important;
          grid-template-columns: repeat(${sideCols}, minmax(0, 1fr)) !important;
          gap: 8px !important;
          padding: 0 !important;
          align-items: start !important;
        }
        ytd-watch-flexy #secondary #related ytd-compact-video-renderer,
        ytd-watch-flexy #secondary #related ytd-compact-radio-renderer,
        ytd-watch-flexy #secondary #related ytd-compact-playlist-renderer,
        ytd-watch-flexy #secondary #related yt-lockup-view-model {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin: 0 !important;
          box-sizing: border-box !important;
        }
        ytd-watch-flexy #secondary #related yt-lockup-view-model .ytLockupViewModelHost {
          display: block !important;
          width: 100% !important;
          min-width: 0 !important;
        }
        ytd-watch-flexy #secondary #related yt-lockup-view-model .ytLockupViewModelHorizontal,
        ytd-watch-flexy #secondary #related yt-lockup-view-model .yt-lockup-view-model-wiz {
          display: flex !important;
          flex-direction: column !important;
          align-items: stretch !important;
          width: 100% !important;
          min-width: 0 !important;
          gap: 6px !important;
        }
        ytd-watch-flexy #secondary #related yt-lockup-view-model .yt-lockup-view-model-wiz__content-image,
        ytd-watch-flexy #secondary #related yt-lockup-view-model [class*="LockupContentImage"],
        ytd-watch-flexy #secondary #related yt-lockup-view-model yt-image {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          height: auto !important;
          flex: 0 0 auto !important;
        }
        ytd-watch-flexy #secondary #related yt-lockup-view-model yt-image img {
          width: 100% !important;
          height: auto !important;
          object-fit: cover !important;
          display: block !important;
        }
        ytd-watch-flexy #secondary #related yt-lockup-view-model .yt-lockup-view-model-wiz__text-container {
          padding: 4px 0 0 0 !important;
          min-width: 0 !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        ytd-watch-flexy #secondary #related ytd-compact-video-renderer #dismissible {
          display: flex !important;
          flex-direction: column !important;
          gap: 6px !important;
          width: 100% !important;
        }
        ytd-watch-flexy #secondary #related ytd-compact-video-renderer ytd-thumbnail {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
        }
        ytd-watch-flexy #secondary #related ytd-compact-video-renderer .details,
        ytd-watch-flexy #secondary #related ytd-compact-video-renderer #meta {
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
      if (z.misc) css += CSS_BLOCKS.misc;
      return css.trim();
    };

    const removeStyles = () => {
      try {
        if (window.YouTubeUtils?.StyleManager?.remove) {
          window.YouTubeUtils.StyleManager.remove(STYLE_MANAGER_KEY);
        }
      } catch (e) {
        // Non-critical, suppressed
      }

      if (nonCriticalTimer) {
        if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
          try {
            window.cancelIdleCallback(nonCriticalTimer);
          } catch (e) {
            // Non-critical, suppressed
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
        } catch (e) {
          // Non-critical, suppressed
        }
      }

      const ncEl = byId(NON_CRITICAL_STYLE_ID);
      if (ncEl) {
        try {
          ncEl.remove();
        } catch (e) {
          // Non-critical, suppressed
        }
      }
    };

    const applyNonCriticalStyles = (/** @type {any} */ css) => {
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
      if (!criticalCss && !nonCriticalCss) {
        removeStyles();
        return;
      }

      try {
        if (window.YouTubeUtils?.StyleManager?.add) {
          window.YouTubeUtils.StyleManager.add(STYLE_MANAGER_KEY, criticalCss || '');
          // Ensure legacy <style> isn't left behind
          const el = byId(STYLE_ELEMENT_ID);
          if (el) el.remove();
          if (nonCriticalTimer) {
            if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
              try {
                window.cancelIdleCallback(nonCriticalTimer);
              } catch (e) {
                // Non-critical, suppressed
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
      } catch (e) {
        // Non-critical, suppressed
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
          } catch (e) {
            // Non-critical, suppressed
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
      document.addEventListener(
        'focusin',
        e => {
          if (e.target instanceof Element && e.target.closest('yt-searchbox')) {
            _applySearchboxWillChange();
          }
        },
        { passive: true, capture: true }
      );
      document.addEventListener(
        'focusout',
        e => {
          if (e.target instanceof Element && e.target.closest('yt-searchbox')) {
            _clearSearchboxWillChange();
          }
        },
        { passive: true, capture: true }
      );
    } catch (e) {
      // Non-critical, suppressed
    }

    window.addEventListener('youtube-plus-settings-updated', (/** @type {any} */ e) => {
      try {
        applyStyles(e?.detail || loadSettings(), true);
      } catch (e) {
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
    window.console.error('zen-youtube-features injection failed', err);
  }
})();

// Theater overlay runtime fixes
// 1) Auto-expand live chat in theater overlay (avoid "Show chat" placeholder)
// 2) Preload comments content so Zen comments panel is not empty
(function () {
  'use strict';

  const host = typeof location === 'undefined' ? '' : location.hostname;
  if (!host) return;
  if (!/(^|\.)youtube\.com$/.test(host) && !/\.youtube\.google/.test(host)) return;

  const SETTINGS_KEY = window.YouTubeUtils?.SETTINGS_KEY || 'youtube_plus_settings';
  const PRELOADED_ATTR = 'data-ytp-zen-comments-preloaded';

  const readSettings = () => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
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
        new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window })
      );
    } catch (e) {
      try {
        element.click();
      } catch (e) {
        // Non-critical, suppressed
      }
    }
  };

  const preloadCommentsInBackground = (/** @type {any} */ flexy) => {
    const commentsTab = $('#tab-comments');
    const commentsBtn = $('#material-tabs a[tyt-tab-content="#tab-comments"]');
    if (!commentsTab || !commentsBtn || commentsTab.getAttribute(PRELOADED_ATTR) === '1') return;

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
      } catch (e) {
        // Non-critical, suppressed
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
    if (!(window.YouTubeUtils?.isWatchPage?.() ?? false)) return;
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
    const coordinator = window.YouTubeMutationCoordinator;
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
    window.addEventListener(
      'yt-navigate-finish',
      () => {
        expandAttempts = 0; // reset on navigation so chat can expand on new page
        enhancedSetTimeout_(() => {
          attachFlexyObserver();
          attachChatObserver();
          scheduleRun();
        }, 180);
      },
      { passive: true }
    );

    try {
      if (window.YouTubeUtils?.cleanupManager?.register) {
        window.YouTubeUtils.cleanupManager.register(() => {
          coordinator.unwatch(flexyObserverId);
          coordinator.unwatch(chatObserverId);
        });
      }
    } catch (e) {
      // Non-critical, suppressed
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

// Comment Translation Button
// Restores the "Translate to ..." button that YouTube removed from comments
(function () {
  'use strict';

  const t = window.YouTubeUtils.t;

  const TRANSLATE_BTN_CLASS = 'ytp-comment-translate-btn';
  const TRANSLATED_ATTR = 'data-ytp-translated';
  const ORIGINAL_ATTR = 'data-ytp-original-text';
  const SETTINGS_KEY = window.YouTubeUtils?.SETTINGS_KEY || 'youtube_plus_settings';
  /** @type {string | null} */
  let translateObserver = null;

  /**
   * Map YouTube+/YouTube locale codes → Google Translate BCP-47 codes.
   * Google Translate uses mostly ISO 639-1 with some regional variants.
   */
  const LANG_MAP = {
    // YouTube+ internal codes
    cn: 'zh-CN',
    tw: 'zh-TW',
    kr: 'ko',
    jp: 'ja',
    ng: 'en',
    du: 'nl',
    be: 'be',
    bg: 'bg',
    kk: 'kk',
    ky: 'ky',
    uz: 'uz',
    uk: 'uk',
    // YouTube locale codes → ISO 639-1
    'zh-hans': 'zh-CN',
    'zh-hant': 'zh-TW',
    'zh-cn': 'zh-CN',
    'zh-tw': 'zh-TW',
    'zh-hk': 'zh-TW',
    iw: 'he', // YouTube uses 'iw' for Hebrew
    jv: 'jw', // Javanese
    'sr-latn': 'sr',
    'pt-br': 'pt',
    'pt-pt': 'pt',
    // Pass-through for standard ISO 639-1 codes
    ar: 'ar',
    az: 'az',
    cs: 'cs',
    da: 'da',
    de: 'de',
    el: 'el',
    en: 'en',
    es: 'es',
    fi: 'fi',
    fr: 'fr',
    hi: 'hi',
    hr: 'hr',
    hu: 'hu',
    id: 'id',
    it: 'it',
    lt: 'lt',
    lv: 'lv',
    ms: 'ms',
    nl: 'nl',
    no: 'no',
    pl: 'pl',
    ro: 'ro',
    ru: 'ru',
    sk: 'sk',
    sl: 'sl',
    sq: 'sq',
    sv: 'sv',
    th: 'th',
    tr: 'tr',
    vi: 'vi',
  };

  /** Normalise any locale/YouTube+ code to a Google-Translate-compatible code */
  const toGoogleLang = (/** @type {any} */ code) => {
    if (!code) return 'en';
    const lower = code.toLowerCase();
    if (/** @type {any} */ (LANG_MAP)[lower]) return /** @type {any} */ (LANG_MAP)[lower];
    // Strip region suffix for unknown codes (e.g. 'es-419' → 'es')
    const base = lower.split('-')[0];
    return /** @type {any} */ (LANG_MAP)[base] || base || 'en';
  };

  /** Detect user's preferred language (returns Google-Translate-compatible code) */
  const getUserLanguage = () => {
    try {
      // 1. YouTube+ i18n internal code (e.g. 'cn', 'kr', 'jp')
      return toGoogleLang(window.YouTubeUtils.getLanguage());
      // 2. <html lang="..."> attribute set by YouTube
    } catch (e) {
      // Non-critical, suppressed
    }
    // 3. Browser navigator.language
    return toGoogleLang(navigator.language) || 'en';
  };

  /** Translate text using Google Translate (free endpoint) */
  const translateText = async (/** @type {any} */ text, /** @type {any} */ targetLang) => {
    const controller = new AbortController();
    const timerId = enhancedSetTimeout_(() => controller.abort(), 8000); // 8 s timeout
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        return data[0].map((/** @type {any} */ s) => (s && s[0]) || '').join('');
      }
    } catch (e) {
      if (/** @type {any} */ (e)?.name !== 'AbortError') {
        window.console.warn('[YouTube+] Translation failed:', e);
      }
    } finally {
      clearTimeout(timerId);
    }
    return null;
  };

  /** Get the translate button label (uses i18n) */
  const getTranslateLabel = () => t('translateComment') || 'Translate';

  /** Get the show-original button label (uses i18n) */
  const getShowOriginalLabel = () => t('showOriginal') || 'Show original';

  /** Inject CSS for translate button */
  const injectStyles = (() => {
    let injected = false;
    return () => {
      if (injected) return;
      injected = true;
      const css = `
        .${TRANSLATE_BTN_CLASS}{
          display:inline-flex;align-items:center;gap:4px;
          background:none;border:none;cursor:pointer;
          color:var(--yt-spec-text-secondary,#aaa);
          font-size:1.2rem;line-height:1.8rem;font-weight:400;
          padding:4px 0;margin-top:4px;
          font-family:'Roboto','Arial',sans-serif;
          transition:color .2s;
        }
        .${TRANSLATE_BTN_CLASS}:hover{color:var(--yt-spec-text-primary,#fff);}
        .${TRANSLATE_BTN_CLASS}[disabled]{opacity:.5;cursor:wait;}
        .${TRANSLATE_BTN_CLASS} svg{flex-shrink:0;}
      `;
      try {
        if (window.YouTubeUtils?.StyleManager?.add) {
          window.YouTubeUtils.StyleManager.add('ytp-comment-translate-styles', css);
          return;
        }
      } catch (e) {
        // Non-critical, suppressed
      }
      const style = document.createElement('style');
      style.id = 'ytp-comment-translate-styles';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    };
  })();

  const translateIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;
  const _setSafeHTML = window.YouTubeUtils.setSafeHTML;

  const isCommentTranslateEnabled = (settings = null) => {
    try {
      const currentSettings =
        settings ||
        /** @type {any} */ (window).youtubePlus?.settings ||
        (() => {
          const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
          return parsed && typeof parsed === 'object' ? parsed : {};
        })();
      return currentSettings?.enableCommentTranslate !== false;
    } catch (e) {
      return true;
    }
  };

  const removeTranslateButtons = () => {
    $$(`.${TRANSLATE_BTN_CLASS}`).forEach(btn => btn.remove());
    $$(`[${TRANSLATED_ATTR}][${ORIGINAL_ATTR}]`).forEach(
      /** @param {Element} node */ node => {
        const original = node.getAttribute(ORIGINAL_ATTR);
        if (original) node.textContent = original;
        node.removeAttribute(TRANSLATED_ATTR);
        node.removeAttribute(ORIGINAL_ATTR);
      }
    );
  };

  const stopTranslateObserver = () => {
    if (!translateObserver) return;
    window.YouTubeMutationCoordinator?.unwatch?.(translateObserver);
    translateObserver = null;
  };

  /** Add translate button to a comment element */
  const addTranslateButton = (/** @type {any} */ commentEl) => {
    if (commentEl.querySelector(`.${TRANSLATE_BTN_CLASS}`)) return;

    // Find the text content element
    const contentEl = commentEl.querySelector(
      '#content-text.ytd-comment-view-model, ' +
        '#content-text.ytd-comment-renderer, ' +
        'yt-attributed-string#content-text, ' +
        'yt-formatted-string#content-text, ' +
        '#content-text'
    );
    if (!contentEl) return;

    const text = (contentEl.textContent || '').trim();
    if (!text || text.length < 2) return;

    // Don't add if comment is already in user's language (basic heuristic)
    const userLang = getUserLanguage();

    const btn = document.createElement('button');
    btn.className = TRANSLATE_BTN_CLASS;
    btn.type = 'button';
    _setSafeHTML(btn, `${translateIcon} ${getTranslateLabel()}`);
    btn.setAttribute('aria-label', getTranslateLabel());

    btn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();

      if (contentEl.hasAttribute(TRANSLATED_ATTR)) {
        // Toggle back to original
        const original = contentEl.getAttribute(ORIGINAL_ATTR);
        if (original) {
          contentEl.textContent = original;
          contentEl.removeAttribute(TRANSLATED_ATTR);
          _setSafeHTML(btn, `${translateIcon} ${getTranslateLabel()}`);
          btn.setAttribute('aria-label', getTranslateLabel());
        }
        return;
      }

      btn.disabled = true;
      _setSafeHTML(btn, `${translateIcon} ...`);

      const originalText = contentEl.textContent || '';
      const translated = await translateText(originalText, userLang);

      if (translated && translated !== originalText) {
        contentEl.setAttribute(ORIGINAL_ATTR, originalText);
        contentEl.setAttribute(TRANSLATED_ATTR, 'true');
        contentEl.textContent = translated;
        _setSafeHTML(btn, `${translateIcon} ${getShowOriginalLabel()}`);
        btn.setAttribute('aria-label', getShowOriginalLabel());
      } else {
        _setSafeHTML(btn, `${translateIcon} ${getTranslateLabel()}`);
        btn.setAttribute('aria-label', getTranslateLabel());
      }
      btn.disabled = false;
    });

    // Insert after the text content
    const actionBar = commentEl.querySelector(
      '#action-buttons, ytd-comment-action-buttons-renderer, #toolbar'
    );
    if (actionBar) {
      actionBar.parentElement.insertBefore(btn, actionBar);
    } else {
      contentEl.after(btn);
    }
  };

  /** Process all visible comments */
  const processComments = () => {
    const commentSelectors = [
      'ytd-comment-view-model',
      'ytd-comment-renderer',
      'ytd-comment-thread-renderer',
    ];
    for (const sel of commentSelectors) {
      $$(sel).forEach(addTranslateButton);
    }
  };

  /** Debounced processing */
  /** @type {ReturnType<typeof setTimeout> | null} */
  let processTimeout = null;
  const scheduleProcess = () => {
    if (processTimeout) clearTimeout(processTimeout);
    processTimeout = enhancedSetTimeout_(processComments, 300);
  };

  const startTranslateFeature = () => {
    if (!isCommentTranslateEnabled()) {
      stopTranslateObserver();
      removeTranslateButtons();
      return;
    }

    injectStyles();
    processComments();

    if (translateObserver) return;

    // Observe for new comments
    const commentsContainer = $('#comments, #tab-comments, #content');
    const target = commentsContainer || document.body;

    const coordinator = window.YouTubeMutationCoordinator;
    if (coordinator?.watchTarget) {
      translateObserver = 'enhanced::translateComments';
      coordinator.watchTarget(
        translateObserver,
        target,
        (/** @type {MutationRecord[]} */ mutations) => {
          let hasNewComments = false;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (!(node instanceof Element)) continue;
              if (
                node.matches?.(
                  'ytd-comment-view-model, ytd-comment-renderer, ytd-comment-thread-renderer'
                ) ||
                node.querySelector?.('ytd-comment-view-model, ytd-comment-renderer, #content-text')
              ) {
                hasNewComments = true;
                break;
              }
            }
            if (hasNewComments) break;
          }
          if (hasNewComments) scheduleProcess();
        },
        { childList: true, attributes: false, subtree: true }
      );
    }
  };

  // Lazy init on watch pages
  const scheduleInit = () => {
    const isVideoPage = location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
    if (!isVideoPage) return;

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => startTranslateFeature(), { timeout: 3000 });
    } else {
      enhancedSetTimeout_(startTranslateFeature, 1500);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInit, { once: true });
  } else {
    scheduleInit();
  }

  window.addEventListener('yt-navigate-finish', scheduleInit, { passive: true });
  window.addEventListener('youtube-plus-settings-updated', (/** @type {any} */ e) => {
    if (isCommentTranslateEnabled(e?.detail)) {
      startTranslateFeature();
      return;
    }
    stopTranslateObserver();
    removeTranslateButtons();
  });
})();
