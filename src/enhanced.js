// Shared DOM helpers - defined at file scope for use across all IIFEs and functions
const _getDOMCache = () => typeof window !== 'undefined' && window.YouTubeDOMCache;

/**
 * Query single element with optional caching
 * @param {string} sel - CSS selector
 * @param {Element|Document} [ctx] - Context element
 * @returns {Element|null}
 */
const $ = (sel, ctx) =>
  _getDOMCache()?.querySelector(sel, ctx) || (ctx || document).querySelector(sel);

/**
 * Query all elements with optional caching
 * @param {string} sel - CSS selector
 * @param {Element|Document} [ctx] - Context element
 * @returns {Element[]}
 */
const $$ = (sel, ctx) =>
  _getDOMCache()?.querySelectorAll(sel, ctx) || Array.from((ctx || document).querySelectorAll(sel));

/**
 * Get element by ID with optional caching
 * @param {string} id - Element ID
 * @returns {Element|null}
 */
const byId = id => _getDOMCache()?.getElementById(id) || document.getElementById(id);

// $, $$, byId are defined above and used throughout

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

  if (!ready) {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  }

  return cb => {
    if (ready) {
      cb();
    } else {
      queue.push(cb);
    }
  };
})();

// Enhanced Tabviews
(function () {
  'use strict';
  // Use centralized i18n from YouTubePlusI18n or YouTubeUtils
  const _getLanguage = () => {
    if (window.YouTubePlusI18n?.getLanguage) return window.YouTubePlusI18n.getLanguage();
    if (window.YouTubeUtils?.getLanguage) return window.YouTubeUtils.getLanguage();
    const htmlLang = document.documentElement.lang || 'en';
    return htmlLang.startsWith('ru') ? 'ru' : 'en';
  };

  const t = (key, params = {}) => {
    if (window.YouTubePlusI18n?.t) return window.YouTubePlusI18n.t(key, params);
    if (window.YouTubeUtils?.t) return window.YouTubeUtils.t(key, params);
    // Fallback for initialization phase
    if (!key) return '';
    let result = String(key);
    for (const [k, v] of Object.entries(params || {})) {
      result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return result;
  };
  // No local alias needed here; modules may use global YouTubeUtils.getLanguage when required

  /**
   * Configuration object for scroll-to-top button
   * @type {Object}
   * @property {boolean} enabled - Whether the feature is enabled
   * @property {string} storageKey - LocalStorage key for settings
   */
  const config = {
    enabled: (() => {
      try {
        const settings = localStorage.getItem('youtube_plus_settings');
        if (settings) {
          const parsed = JSON.parse(settings);
          return parsed.enableScrollToTopButton !== false;
        }
      } catch {}
      return true;
    })(),
    storageKey: 'youtube_top_button_settings',
  };

  let universalScrollHandler = null;
  let universalScrollContainer = null;

  const getUniversalScrollContainer = () => {
    try {
      const host = window.location.hostname;
      const candidates = [];
      if (host === 'music.youtube.com') {
        // YouTube Music uses custom layout elements – try multiple containers
        // The main scrollable area on YouTube Music is typically #layout or the app-layout itself
        const appLayout = document.querySelector('ytmusic-app-layout');
        if (appLayout) {
          // Check the direct scroll container inside app-layout
          const layoutContent = appLayout.querySelector('#layout');
          if (layoutContent) candidates.push(layoutContent);
          // Also try the app-layout itself (sometimes it's the scroll host)
          candidates.push(appLayout);
        }
        candidates.push(
          document.querySelector('ytmusic-browse-response #contents'),
          document.querySelector('ytmusic-section-list-renderer'),
          document.querySelector('ytmusic-tabbed-page #content'),
          document.querySelector('ytmusic-app-layout #content'),
          document.querySelector('#content'),
          document.querySelector('ytmusic-app')
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
    } catch {}
    return document.scrollingElement || document.documentElement;
  };

  let universalWindowScrollHandler = null;

  const removeUniversalButton = () => {
    try {
      const btn = byId('universal-top-button');
      if (btn) btn.remove();
    } catch {}
    try {
      if (universalScrollHandler && universalScrollContainer) {
        universalScrollContainer.removeEventListener('scroll', universalScrollHandler);
      }
    } catch {}
    try {
      if (universalWindowScrollHandler) {
        window.removeEventListener('scroll', universalWindowScrollHandler);
      }
    } catch {}
    universalScrollHandler = null;
    universalScrollContainer = null;
    universalWindowScrollHandler = null;
  };

  let musicSideScrollHandler = null;
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
        const el = document.querySelector(sel);
        if (el && el.scrollHeight > el.clientHeight + 30) return el;
      } catch {}
    }

    // Try within specific roots
    const roots = [
      document.querySelector('ytmusic-player-page'),
      document.querySelector('ytmusic-app-layout'),
      document.querySelector('ytmusic-app'),
    ];
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
        } catch {}
      }
    }
    return null;
  };

  const removeMusicSideButton = () => {
    try {
      const btn = byId('music-side-top-button');
      if (btn) btn.remove();
    } catch {}
    try {
      if (musicSideScrollHandler && musicSideScrollContainer) {
        musicSideScrollContainer.removeEventListener('scroll', musicSideScrollHandler);
      }
    } catch {}
    musicSideScrollHandler = null;
    musicSideScrollContainer = null;
  };

  const cleanupTopButtons = () => {
    try {
      const rightButton = byId('right-tabs-top-button');
      if (rightButton) rightButton.remove();
    } catch {}
    try {
      const playlistButton = byId('playlist-panel-top-button');
      if (playlistButton) playlistButton.remove();
    } catch {}

    removeMusicSideButton();

    removeUniversalButton();

    try {
      $$('#right-tabs .tab-content-cld').forEach(tab => {
        if (tab && tab._topButtonScrollHandler) {
          tab.removeEventListener('scroll', tab._topButtonScrollHandler);
          tab._topButtonScrollHandler = null;
        }
      });
    } catch {}

    try {
      const playlistScroll = $('ytd-playlist-panel-renderer #items');
      if (playlistScroll && playlistScroll._topButtonScrollHandler) {
        playlistScroll.removeEventListener('scroll', playlistScroll._topButtonScrollHandler);
        playlistScroll._topButtonScrollHandler = null;
      }
    } catch {}
  };

  let tabChangesObserver = null;
  let watchInitToken = 0;
  let isTabClickListenerAttached = false;
  let tabDelegationHandler = null;
  let tabDelegationRegistered = false;
  let tabCheckTimeoutId = null;
  let playlistPanelCheckTimeoutId = null;

  const isWatchPage = () => window.location.pathname === '/watch';
  const isShortsPage = () => window.location.pathname.startsWith('/shorts');
  const shouldInitReturnDislike = () => isWatchPage() || isShortsPage();

  const isTopButton = el =>
    el &&
    (el.id === 'right-tabs-top-button' ||
      el.id === 'universal-top-button' ||
      el.id === 'playlist-panel-top-button' ||
      el.id === 'music-side-top-button');

  const handleTopButtonActivate = button => {
    try {
      if (!button) return;

      if (button.id === 'right-tabs-top-button') {
        const activeTab = $('#right-tabs .tab-content-cld:not(.tab-content-hidden)');
        if (activeTab) {
          if ('scrollBehavior' in document.documentElement.style) {
            activeTab.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            activeTab.scrollTop = 0;
          }
          button.setAttribute('aria-label', t('scrolledToTop') || 'Scrolled to top');
          setTimeout(() => {
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
        const scrollToTop = el => {
          if ('scrollBehavior' in document.documentElement.style) {
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
          // Scroll all potentially scrollable music containers
          const musicContainers = [
            document.querySelector('ytmusic-app-layout #layout'),
            document.querySelector('ytmusic-app-layout'),
            document.querySelector('ytmusic-browse-response #contents'),
            document.querySelector('ytmusic-section-list-renderer'),
          ];
          for (const c of musicContainers) {
            if (c && c.scrollTop > 0) {
              scrollToTop(c);
            }
          }
        }
        return;
      }

      if (button.id === 'playlist-panel-top-button') {
        const playlistPanel = $('ytd-playlist-panel-renderer');
        const scrollContainer = playlistPanel ? $('#items', playlistPanel) : null;
        if (scrollContainer) {
          if ('scrollBehavior' in document.documentElement.style) {
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
          if ('scrollBehavior' in document.documentElement.style) {
            target.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            target.scrollTop = 0;
          }
        }
      }
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error scrolling to top:', error);
    }
  };

  const setupTopButtonDelegation = (() => {
    let attached = false;
    return () => {
      if (attached) return;
      attached = true;

      const delegator = window.YouTubePlusEventDelegation;
      if (delegator?.on) {
        delegator.on(document, 'click', '.top-button', (ev, target) => {
          if (isTopButton(target)) handleTopButtonActivate(target);
        });
        delegator.on(document, 'keydown', '.top-button', (ev, target) => {
          if (!isTopButton(target)) return;
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            handleTopButtonActivate(target);
          }
        });
      } else {
        document.addEventListener(
          'click',
          ev => {
            const target = ev.target?.closest?.('.top-button');
            if (isTopButton(target)) handleTopButtonActivate(target);
          },
          true
        );
        document.addEventListener(
          'keydown',
          ev => {
            const target = ev.target?.closest?.('.top-button');
            if (!isTopButton(target)) return;
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              handleTopButtonActivate(target);
            }
          },
          true
        );
      }
    };
  })();

  const clearTimeoutSafe = id => {
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
      :root{--scrollbar-width:8px;--scrollbar-track:transparent;--scrollbar-thumb:rgba(144,144,144,.5);--scrollbar-thumb-hover:rgba(170,170,170,.7);--scrollbar-thumb-active:rgba(190,190,190,.9);}
      ::-webkit-scrollbar{width:var(--scrollbar-width)!important;height:var(--scrollbar-width)!important;}
      ::-webkit-scrollbar-track{background:var(--scrollbar-track)!important;border-radius:4px!important;}
      ::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb)!important;border-radius:4px!important;transition:background .2s!important;}
      ::-webkit-scrollbar-thumb:hover{background:var(--scrollbar-thumb-hover)!important;}
      ::-webkit-scrollbar-thumb:active{background:var(--scrollbar-thumb-active)!important;}
      ::-webkit-scrollbar-corner{background:transparent!important;}
      html,body,#content,#guide-content,#secondary,#comments,#chat,ytd-comments,ytd-watch-flexy,ytd-browse,ytd-search,ytd-playlist-panel-renderer,#right-tabs,.tab-content-cld,ytmusic-app-layout{scrollbar-width:thin;scrollbar-color:var(--scrollbar-thumb) var(--scrollbar-track);}
      html[dark]{--scrollbar-thumb:rgba(144,144,144,.4);--scrollbar-thumb-hover:rgba(170,170,170,.6);--scrollbar-thumb-active:rgba(190,190,190,.8);}
      .top-button{position:fixed;bottom:16px;right:16px;width:40px;height:40px;background:var(--yt-top-btn-bg,rgba(0,0,0,.7));color:var(--yt-top-btn-color,#fff);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2100;opacity:0;visibility:hidden;transition:all .3s cubic-bezier(0.4, 0, 0.2, 1);backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);border:1px solid var(--yt-top-btn-border,rgba(255,255,255,.1));background:rgba(255,255,255,.12);box-shadow:0 8px 32px 0 rgba(31,38,135,.18);}
      .top-button:hover{background:var(--yt-top-btn-hover,rgba(0,0,0,.15));transform:translateY(-2px) scale(1.07);box-shadow:0 8px 32px rgba(0,0,0,.25);}
      .top-button:active{transform:translateY(-1px) scale(1.03);}
      .top-button:focus{outline:2px solid rgba(255,255,255,0.5);outline-offset:2px;}
      .top-button.visible{opacity:1;visibility:visible;}
      .top-button svg{transition:transform .2s ease;}
      .top-button:hover svg{transform:translateY(-1px) scale(1.1);}
      html[dark]{--yt-top-btn-bg:rgba(255,255,255,.10);--yt-top-btn-color:#fff;--yt-top-btn-border:rgba(255,255,255,.18);--yt-top-btn-hover:rgba(255,255,255,.18);}
      html:not([dark]){--yt-top-btn-bg:rgba(255,255,255,.12);--yt-top-btn-color:#222;--yt-top-btn-border:rgba(0,0,0,.08);--yt-top-btn-hover:rgba(255,255,255,.18);}
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
      console.error('[YouTube+][Enhanced] Error in handleScroll:', error);
    }
  };

  /**
   * Sets up scroll event listener on active tab with debouncing for performance
   * Uses IntersectionObserver when possible for better performance
   * @returns {void}
   */
  const setupScrollListener = (() => {
    let timeout;
    return () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
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

          const activeTab = $('#right-tabs .tab-content-cld:not(.tab-content-hidden)');
          const button = byId('right-tabs-top-button');

          if (activeTab && button) {
            // Use ScrollManager if available for better performance
            if (window.YouTubePlusScrollManager) {
              const cleanup = window.YouTubePlusScrollManager.addScrollListener(
                activeTab,
                () => handleScroll(activeTab, button),
                { debounce: 100, runInitial: true }
              );
              activeTab._scrollCleanup = cleanup;
            } else {
              // Fallback to manual debouncing
              const debounceFunc =
                typeof YouTubeUtils !== 'undefined' && YouTubeUtils.debounce
                  ? YouTubeUtils.debounce
                  : (fn, delay) => {
                      let timeoutId;
                      return (...args) => {
                        clearTimeout(timeoutId);
                        timeoutId = setTimeout(() => fn(...args), delay);
                      };
                    };
              const scrollHandler = debounceFunc(() => handleScroll(activeTab, button), 100);
              activeTab._topButtonScrollHandler = scrollHandler;
              activeTab.addEventListener('scroll', scrollHandler, {
                passive: true,
                capture: false,
              });
              handleScroll(activeTab, button);
            }
          }
        } catch (error) {
          console.error('[YouTube+][Enhanced] Error in setupScrollListener:', error);
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
      button.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

      rightTabs.style.position = 'relative';
      rightTabs.appendChild(button);
      setupScrollListener();
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error creating button:', error);
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
      button.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

      // Ensure the button is above YouTube Music/Studio overlays
      const host = window.location.hostname;
      if (host === 'music.youtube.com' || host === 'studio.youtube.com') {
        button.style.zIndex = '10000';
      }

      document.body.appendChild(button);

      // Setup scroll listener for the active container
      const debounceFunc =
        typeof YouTubeUtils !== 'undefined' && YouTubeUtils.debounce
          ? YouTubeUtils.debounce
          : (fn, delay) => {
              let timeoutId;
              return (...args) => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => fn(...args), delay);
              };
            };

      const scrollHandler = debounceFunc(() => {
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
        const musicScrollCheck = debounceFunc(() => {
          // Check multiple containers for any scroll offset
          let anyScrolled = window.scrollY > 100;
          if (!anyScrolled) {
            const containers = [
              document.querySelector('ytmusic-app-layout #layout'),
              document.querySelector('ytmusic-app-layout'),
              document.querySelector('ytmusic-browse-response #contents'),
              document.querySelector('ytmusic-section-list-renderer'),
              scrollContainer !== window ? scrollContainer : null,
            ];
            for (const c of containers) {
              if (c && c.scrollTop > 100) {
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
          const targets = [
            document.querySelector('ytmusic-app-layout #layout'),
            document.querySelector('ytmusic-app-layout'),
          ];
          for (const target of targets) {
            if (target && !target._ytpScrollAttached) {
              target._ytpScrollAttached = true;
              target.addEventListener('scroll', musicScrollCheck, { passive: true });
            }
          }
        };
        attachMusicScrollListeners();
        // Re-attach after navigation
        setTimeout(attachMusicScrollListeners, 1000);
        setTimeout(attachMusicScrollListeners, 3000);
      }
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error creating universal button:', error);
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
      button.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

      const scrollContainer = $('#items', playlistPanel);
      if (!scrollContainer) return;

      // Ensure the playlist panel is positioned so absolute children are anchored inside it
      playlistPanel.style.position = playlistPanel.style.position || 'relative';

      // Force the button to be positioned inside the playlist panel (override global fixed)
      button.style.position = 'absolute';
      button.style.bottom = '16px';
      button.style.right = '16px';
      button.style.zIndex = '1000';

      playlistPanel.appendChild(button);

      // Setup scroll listener
      const debounceFunc =
        typeof YouTubeUtils !== 'undefined' && YouTubeUtils.debounce
          ? YouTubeUtils.debounce
          : (fn, delay) => {
              let timeoutId;
              return (...args) => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => fn(...args), delay);
              };
            };

      const scrollHandler = debounceFunc(() => handleScroll(scrollContainer, button), 100);
      scrollContainer._topButtonScrollHandler = scrollHandler;
      scrollContainer.addEventListener('scroll', scrollHandler, { passive: true });
      handleScroll(scrollContainer, button);

      // Hide the button when the playlist panel is collapsed/hidden.
      // Use ResizeObserver + MutationObserver to detect layout/attribute changes.
      const updateVisibility = () => {
        try {
          // If panel not connected or explicitly hidden, hide the button
          if (!playlistPanel.isConnected || playlistPanel.hidden) {
            button.style.display = 'none';
            return;
          }

          // Use offsetParent check (cheaper than getComputedStyle) - null means hidden
          if (playlistPanel.offsetParent === null && playlistPanel.style.position !== 'fixed') {
            button.style.display = 'none';
            return;
          }

          // If bounding box is too small (collapsed), hide button
          const { width, height } = playlistPanel.getBoundingClientRect();
          if (width < 40 || height < 40) {
            button.style.display = 'none';
            return;
          }

          // If items container cannot scroll or has no height, hide button
          if (
            !scrollContainer ||
            scrollContainer.offsetHeight === 0 ||
            scrollContainer.scrollHeight === 0
          ) {
            button.style.display = 'none';
            return;
          }

          // Otherwise keep normal display and let handleScroll control visibility class
          button.style.display = '';
        } catch {
          // On error, prefer hiding to avoid stray UI
          try {
            button.style.display = 'none';
          } catch {}
        }
      };

      // Observe size changes
      let ro = null;
      try {
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(updateVisibility);
          ro.observe(playlistPanel);
          if (scrollContainer) ro.observe(scrollContainer);
        }
      } catch {
        ro = null;
      }

      // Observe attribute/class changes
      const mo = new MutationObserver(updateVisibility);
      try {
        mo.observe(playlistPanel, {
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden'],
        });
      } catch {}

      // Initial visibility pass
      updateVisibility();

      // Register cleanup with YouTubeUtils.cleanupManager when available
      try {
        if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
          YouTubeUtils.cleanupManager.register(() => {
            try {
              if (ro) ro.disconnect();
            } catch {}
            try {
              mo.disconnect();
            } catch {}
          });
        }
      } catch {}
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error creating playlist panel button:', error);
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
        // Retry after a delay since YouTube Music loads content dynamically
        setTimeout(() => {
          if (!byId('music-side-top-button') && config.enabled) {
            const retryPanel = getMusicSidePanelContainer();
            if (retryPanel) createMusicSidePanelButton();
          }
        }, 2000);
        return;
      }

      const button = document.createElement('button');
      button.id = 'music-side-top-button';
      button.className = 'top-button';
      button.title = t('scrollToTop');
      button.setAttribute('aria-label', t('scrollToTop'));
      button.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

      panel.style.position = panel.style.position || 'relative';
      button.style.position = 'absolute';
      button.style.bottom = '16px';
      button.style.right = '16px';
      button.style.zIndex = '1000';

      panel.appendChild(button);

      const debounceFunc =
        typeof YouTubeUtils !== 'undefined' && YouTubeUtils.debounce
          ? YouTubeUtils.debounce
          : (fn, delay) => {
              let timeoutId;
              return (...args) => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => fn(...args), delay);
              };
            };

      const scrollHandler = debounceFunc(() => {
        button.classList.toggle('visible', panel.scrollTop > 100);
      }, 100);

      musicSideScrollContainer = panel;
      musicSideScrollHandler = scrollHandler;
      panel.addEventListener('scroll', scrollHandler, { passive: true });
      button.classList.toggle('visible', panel.scrollTop > 100);
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error creating music side button:', error);
    }
  };

  // --- Return YouTube Dislike integration ---
  const RETURN_DISLIKE_API = 'https://returnyoutubedislikeapi.com/votes';
  const DISLIKE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  const dislikeCache = new Map(); // videoId -> { value, expiresAt }
  let dislikeObserver = null;
  let dislikePollTimer = null;

  const formatCompactNumber = number => {
    try {
      return new Intl.NumberFormat(_getLanguage() || 'en', {
        notation: 'compact',
        compactDisplay: 'short',
      }).format(Number(number) || 0);
    } catch {
      return String(number || 0);
    }
  };

  const DISLIKE_CACHE_MAX_SIZE = 50;
  const fetchDislikes = async videoId => {
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
          const timeoutId = setTimeout(() => reject(new Error('timeout')), 8000);
          GM_xmlhttpRequest({
            method: 'GET',
            url: `${RETURN_DISLIKE_API}?videoId=${encodeURIComponent(videoId)}`,
            timeout: 8000,
            headers: { Accept: 'application/json' },
            onload: r => {
              clearTimeout(timeoutId);
              if (r.status >= 200 && r.status < 300) resolve(r.responseText);
              else reject(new Error(`HTTP ${r.status}`));
            },
            onerror: e => {
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
        const val = Number(parsed.dislikes || 0) || 0;
        dislikeCache.set(videoId, { value: val, expiresAt: Date.now() + DISLIKE_CACHE_TTL });
        return val;
      }

      // fallback to fetch
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);
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
        const val = Number(json.dislikes || 0) || 0;
        dislikeCache.set(videoId, { value: val, expiresAt: Date.now() + DISLIKE_CACHE_TTL });
        return val;
      } finally {
        clearTimeout(id);
      }
    } catch {
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
    } catch {
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
        $('dislike-button-view-model', activeReel) ||
        $('like-button-view-model', activeReel)
          ?.parentElement?.querySelector('[aria-label*="islike"]')
          ?.closest('button')?.parentElement ||
        $('#dislike-button', activeReel);
      if (btn) return btn;
    }

    // Fallback: find in the shorts player container
    const shortsContainer = $('ytd-shorts');
    if (shortsContainer) {
      const btn =
        $('dislike-button-view-model', shortsContainer) || $('#dislike-button', shortsContainer);
      if (btn) return btn;
    }

    // Last resort: global search
    return $('dislike-button-view-model') || $('#dislike-button') || null;
  };

  /**
   * Get dislike button from buttons container
   * @param {HTMLElement} buttons - Buttons container
   * @returns {HTMLElement|null} Dislike button element
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

  const getOrCreateDislikeText = dislikeButton => {
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
    created.style.cssText = isShorts
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
      buttonShape.style.minWidth = 'auto';
      buttonShape.style.width = 'auto';
      if (viewModelHost !== dislikeButton) {
        viewModelHost.style.minWidth = 'auto';
      }
    } catch (e) {
      console.warn('YTP: Failed to create dislike text:', e);
    }
    return created;
  };

  const setDislikeDisplay = (dislikeButton, count) => {
    try {
      const container = getOrCreateDislikeText(dislikeButton);
      if (!container) return;

      const formatted = formatCompactNumber(count);
      if (container.innerText !== String(formatted)) {
        container.innerText = String(formatted);

        // Ensure the text is visible and properly styled
        container.style.display = 'inline-block';
        container.style.visibility = 'visible';
        container.style.opacity = '1';

        // Make sure parent button container is wide enough
        const buttonShape = container.closest('button') || dislikeButton.querySelector('button');
        if (buttonShape) {
          buttonShape.style.minWidth = 'fit-content';
          buttonShape.style.width = 'auto';
        }
      }
    } catch (e) {
      console.warn('YTP: Failed to set dislike display:', e);
    }
  };

  const setupDislikeObserver = dislikeButton => {
    if (!dislikeButton) return;
    if (dislikeObserver) {
      dislikeObserver.disconnect();
      dislikeObserver = null;
    }

    // Don't observe if we already have text displayed
    const existingText = dislikeButton.querySelector('#ytp-plus-dislike-text');
    if (existingText?.textContent && existingText.textContent !== '0') {
      return;
    }

    dislikeObserver = new MutationObserver(() => {
      // on any mutation, update displayed cached value
      const vid = getVideoIdForDislike();
      const cached = dislikeCache.get(vid);
      if (cached) {
        const btn = getDislikeButton();
        if (btn) setDislikeDisplay(btn, cached.value);
      }
    });
    try {
      dislikeObserver.observe(dislikeButton, { childList: true, subtree: true, attributes: true });
    } catch {}
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
            dislikePollTimer.disconnect();
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

      // Set up observer for button appearance - use targeted childList only (no subtree)
      const isShorts = window.location.pathname.startsWith('/shorts');
      const maxTime = 10000; // 10 seconds timeout
      const startTime = Date.now();

      dislikePollTimer = new MutationObserver(async () => {
        if (Date.now() - startTime > maxTime) {
          dislikePollTimer.disconnect();
          dislikePollTimer = null;
          return;
        }
        await checkButton();
      });

      // Observe more targeted containers to reduce mutation callbacks
      const targetEl = isShorts ? $('#shorts-container') : $('ytd-watch-flexy #below');
      if (targetEl) {
        dislikePollTimer.observe(targetEl, { childList: true, subtree: true });
      } else {
        // Fallback: use a short interval instead of expensive body observer
        const pollId = setInterval(async () => {
          if (Date.now() - startTime > maxTime) {
            clearInterval(pollId);
            return;
          }
          if (await checkButton()) clearInterval(pollId);
        }, 500);
      }
    } catch {
      // ignore
    }
  };

  const cleanupReturnDislike = () => {
    try {
      if (dislikePollTimer) {
        if (typeof dislikePollTimer.disconnect === 'function') {
          dislikePollTimer.disconnect();
        } else if (typeof dislikePollTimer === 'number') {
          clearInterval(dislikePollTimer);
        }
        dislikePollTimer = null;
      }
      if (dislikeObserver) {
        dislikeObserver.disconnect();
        dislikeObserver = null;
      }
      // Remove all created dislike text spans
      $$('#ytp-plus-dislike-text').forEach(el => {
        try {
          if (el.parentNode) el.parentNode.removeChild(el);
        } catch {}
      });
      // Clear cache to free memory
      dislikeCache.clear();
    } catch (e) {
      console.warn('YTP: Dislike cleanup error:', e);
    }
  };

  /**
   * Observes DOM changes to detect tab switches
   * @returns {MutationObserver|null} The created observer or null on error
   */
  const observeTabChanges = () => {
    try {
      const observer = new MutationObserver(mutations => {
        try {
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
        } catch (error) {
          console.error('[YouTube+][Enhanced] Error in mutation observer:', error);
        }
      });

      const rightTabs = $('#right-tabs');
      if (rightTabs) {
        observer.observe(rightTabs, {
          attributes: true,
          subtree: true,
          attributeFilter: ['class'],
        });
        return observer;
      }
      return null;
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error in observeTabChanges:', error);
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

    if (isWatchPage() || isShortsPage()) return false;

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
  const handleTabButtonClick = e => {
    try {
      const { target } = /** @type {{ target: HTMLElement }} */ (e);
      const tabButton = target?.closest?.('.tab-btn[tyt-tab-content]');
      if (tabButton) {
        setTimeout(setupScrollListener, 100);
      }
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error in click handler:', error);
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
        tabDelegationHandler = (ev, target) => {
          void ev;
          if (!target) return;
          setTimeout(setupScrollListener, 100);
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
      console.error('[YouTube+][Enhanced] Error in setupEvents:', error);
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
      console.error('[YouTube+][Enhanced] Error cleaning up events:', error);
    }
  };

  const stopWatchEnhancements = () => {
    watchInitToken++;
    tabCheckTimeoutId = clearTimeoutSafe(tabCheckTimeoutId);
    playlistPanelCheckTimeoutId = clearTimeoutSafe(playlistPanelCheckTimeoutId);

    try {
      tabChangesObserver?.disconnect?.();
    } catch {}
    tabChangesObserver = null;

    cleanupEvents();

    try {
      cleanupReturnDislike();
    } catch {}
  };

  const startWatchEnhancements = () => {
    if (!config.enabled) return;
    if (!isWatchPage()) return;

    const token = ++watchInitToken;
    setupEvents();

    const maxTabAttempts = 40;
    const checkForTabs = (attempt = 0) => {
      if (token !== watchInitToken) return;
      if (!isWatchPage()) return;

      if ($('#right-tabs')) {
        createButton();
        try {
          tabChangesObserver?.disconnect?.();
        } catch {}
        tabChangesObserver = observeTabChanges();
        return;
      }

      if (attempt >= maxTabAttempts) return;
      tabCheckTimeoutId = setTimeout(() => checkForTabs(attempt + 1), 250);
    };

    const maxPlaylistPanelAttempts = 30;
    const checkForPlaylistPanel = (attempt = 0) => {
      if (token !== watchInitToken) return;
      if (!isWatchPage()) return;

      try {
        const playlistPanel = $('ytd-playlist-panel-renderer');
        if (playlistPanel && !byId('playlist-panel-top-button')) {
          createPlaylistPanelButton();
          return;
        }
      } catch (error) {
        console.error('[YouTube+][Enhanced] Error checking for playlist panel:', error);
      }

      if (attempt >= maxPlaylistPanelAttempts) return;
      playlistPanelCheckTimeoutId = setTimeout(() => checkForPlaylistPanel(attempt + 1), 300);
    };

    checkForTabs();
    checkForPlaylistPanel();
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
          console.error('[YouTube+][Enhanced] Error checking page type:', error);
        }
      };

      const onNavigate = () => {
        stopWatchEnhancements();
        checkPageType();

        if (shouldInitReturnDislike()) {
          try {
            initReturnDislike();
          } catch {}
        }

        // Watch-specific UI only initializes on /watch
        startWatchEnhancements();
      };

      // Initial run
      onNavigate();

      // Listen for navigation changes (YouTube is SPA)
      if (window.YouTubeUtils?.cleanupManager?.registerListener) {
        YouTubeUtils.cleanupManager.registerListener(
          document,
          'yt-navigate-finish',
          () => setTimeout(onNavigate, 200),
          { passive: true }
        );
      } else {
        window.addEventListener('yt-navigate-finish', () => {
          setTimeout(onNavigate, 200);
        });
      }

      // For YouTube Music: also listen on popstate and observe #side-panel appearance
      if (window.location.hostname === 'music.youtube.com') {
        window.addEventListener('popstate', () => setTimeout(onNavigate, 200));
        // Observe DOM for side-panel becoming scrollable
        const sidePanelObserver = new MutationObserver(() => {
          if (!byId('music-side-top-button') && config.enabled) {
            createMusicSidePanelButton();
          }
        });
        const observeTarget = $('ytmusic-app-layout') || $('ytmusic-app') || document.body;
        if (observeTarget) {
          sidePanelObserver.observe(observeTarget, {
            childList: true,
            subtree: true,
          });
        }
      }
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error in initialization:', error);
    }
  };

  const scheduleInit = () => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(init, { timeout: 2000 });
    } else {
      setTimeout(init, 0);
    }
  };

  window.addEventListener('youtube-plus-settings-updated', e => {
    try {
      const nextEnabled = e?.detail?.enableScrollToTopButton !== false;
      if (nextEnabled === config.enabled) return;
      config.enabled = nextEnabled;
      if (!config.enabled) {
        cleanupTopButtons();
        stopWatchEnhancements();
        return;
      }
      addStyles();
      if (needsUniversalButton() && !byId('universal-top-button')) {
        createUniversalButton();
      }
      if (window.location.hostname === 'music.youtube.com' && !byId('music-side-top-button')) {
        createMusicSidePanelButton();
      }
      startWatchEnhancements();
    } catch {}
  });

  onDomReady(scheduleInit);
})();

// Styles
(function () {
  try {
    const host = typeof location === 'undefined' ? '' : location.hostname;
    if (!host) return;
    if (!/(^|\.)youtube\.com$/.test(host) && !/\.youtube\.google/.test(host)) return;

    const SETTINGS_KEY = 'youtube_plus_settings';
    const STYLE_ELEMENT_ID = 'ytp-zen-features-style';
    const NON_CRITICAL_STYLE_ID = 'ytp-zen-features-style-noncritical';
    const STYLE_MANAGER_KEY = 'zen-features-style';
    let nonCriticalTimer = null;

    const DEFAULTS = {
      enableZenStyles: true,
      // legacy (kept for backward compat)
      hideSideGuide: false,
      zenStyles: {
        thumbnailHover: true,
        immersiveSearch: true,
        hideVoiceSearch: true,
        transparentHeader: true,
        hideSideGuide: false,
        cleanSideGuide: false,
        fixFeedLayout: true,
        betterCaptions: true,
        playerBlur: true,
      },
    };

    const loadSettings = () => {
      /** @type {any} */
      let parsed = null;
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) parsed = JSON.parse(raw);
      } catch {}

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

      return merged;
    };

    const CSS_BLOCKS = {
      thumbnailHover: `
        /* yt-thumbnail hover */
        #inline-preview-player {transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) 1s !important; transform: scale(1) !important;}
        #video-preview-container:has(#inline-preview-player) {transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important; border-radius: 1.2em !important; overflow: hidden !important; transform: scale(1) !important;}
        #video-preview-container:has(#inline-preview-player):hover {transform: scale(1.25) !important; box-shadow: #0008 0px 0px 60px !important; transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) 2s !important;}
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
        yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {background-color: #fffb !important; box-shadow: black 0 0 30px !important;}
        @media (prefers-color-scheme: dark) {
          yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) .ytSearchboxComponentInputBox,
          yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {background-color: #000b !important;}
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
        #masthead-container, #background.ytd-masthead { background-color: transparent !important; }
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
        @media only screen and (min-width: 1400px) { ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-grid-items-per-row: 4 !important; } }
        @media only screen and (min-width: 1700px) { ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-grid-items-per-row: 5 !important; } }
        @media only screen and (min-width: 2180px) { ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-grid-items-per-row: 6 !important; } }
        ytd-rich-item-renderer[is-in-first-column=""] { margin-left: calc(var(--ytd-rich-grid-item-margin) / 2) !important; }
        #contents { padding-left: calc(var(--ytd-rich-grid-item-margin) / 2 + var(--ytd-rich-grid-gutter-margin)) !important; }
      `,
      betterCaptions: `
        /* Better captions */
        .caption-window { backdrop-filter: blur(10px) brightness(70%) !important; border-radius: 1em !important; padding: 1em !important; box-shadow: #0008 0 0 20px !important; width: fit-content !important; }
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
        .ytPlayerQuickActionButtonsHostDisableBackdropFilter { backdrop-filter: blur(5px) !important; background-color: #0004 !important; }
        .ytp-popup { backdrop-filter: blur(10px) !important; background-color: #0007 !important; }
      `,
      // CLS Prevention styles - always loaded to reserve space for dynamic elements
      clsPrevention: `
        /* CLS Prevention - Reserve space for dynamic elements */
        #ytp-plus-dislike-text { min-width: 1.5em;display: inline-block !important;}
        /* Contain layout for dynamic panels */
        .ytp-plus-stats-panel, .ytp-plus-modal-content { contain: layout style;}
        /* Prevent layout shifts from search box animations */
        yt-searchbox { will-change: transform;}
        /* Stable feed items */
        ytd-rich-item-renderer { contain: layout style;content-visibility: auto;contain-intrinsic-size: auto 400px;}
        /* Stable thumbnails */
        ytd-thumbnail { contain: layout style paint;content-visibility: auto;}
        /* Prevent header shifts */
        #masthead-container { contain: layout style;}
      `,
    };

    const buildCriticalCss = settings => {
      const z = settings?.zenStyles || {};
      let css = CSS_BLOCKS.clsPrevention; // Always include CLS prevention
      if (z.hideSideGuide) css += CSS_BLOCKS.hideSideGuide;
      if (z.fixFeedLayout) css += CSS_BLOCKS.fixFeedLayout;
      return css.trim();
    };

    const buildNonCriticalCss = settings => {
      const z = settings?.zenStyles || {};
      let css = '';
      if (z.thumbnailHover) css += CSS_BLOCKS.thumbnailHover;
      if (z.immersiveSearch) css += CSS_BLOCKS.immersiveSearch;
      if (z.hideVoiceSearch) css += CSS_BLOCKS.hideVoiceSearch;
      if (z.transparentHeader) css += CSS_BLOCKS.transparentHeader;
      if (z.cleanSideGuide) css += CSS_BLOCKS.cleanSideGuide;
      if (z.betterCaptions) css += CSS_BLOCKS.betterCaptions;
      if (z.playerBlur) css += CSS_BLOCKS.playerBlur;
      return css.trim();
    };

    const removeStyles = () => {
      try {
        if (window.YouTubeUtils?.StyleManager?.remove) {
          window.YouTubeUtils.StyleManager.remove(STYLE_MANAGER_KEY);
        }
      } catch {}

      if (nonCriticalTimer) {
        if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
          try {
            window.cancelIdleCallback(nonCriticalTimer);
          } catch {}
        } else {
          clearTimeout(nonCriticalTimer);
        }
        nonCriticalTimer = null;
      }

      const el = document.getElementById(STYLE_ELEMENT_ID);
      if (el) {
        try {
          el.remove();
        } catch {}
      }

      const ncEl = document.getElementById(NON_CRITICAL_STYLE_ID);
      if (ncEl) {
        try {
          ncEl.remove();
        } catch {}
      }
    };

    const applyNonCriticalStyles = css => {
      if (!css) {
        const ncEl = document.getElementById(NON_CRITICAL_STYLE_ID);
        if (ncEl) ncEl.remove();
        return;
      }

      let ncEl = document.getElementById(NON_CRITICAL_STYLE_ID);
      if (!ncEl) {
        ncEl = document.createElement('style');
        ncEl.id = NON_CRITICAL_STYLE_ID;
        (document.head || document.documentElement).appendChild(ncEl);
      }
      ncEl.textContent = css;
    };

    const applyStyles = settings => {
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
          const el = document.getElementById(STYLE_ELEMENT_ID);
          if (el) el.remove();
          if (nonCriticalTimer) {
            if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
              try {
                window.cancelIdleCallback(nonCriticalTimer);
              } catch {}
            } else {
              clearTimeout(nonCriticalTimer);
            }
          }
          if (typeof requestIdleCallback === 'function') {
            nonCriticalTimer = requestIdleCallback(() => applyNonCriticalStyles(nonCriticalCss), {
              timeout: 2000,
            });
          } else {
            nonCriticalTimer = setTimeout(() => applyNonCriticalStyles(nonCriticalCss), 200);
          }
          return;
        }
      } catch {}

      let el = document.getElementById(STYLE_ELEMENT_ID);
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
          } catch {}
        } else {
          clearTimeout(nonCriticalTimer);
        }
      }
      if (typeof requestIdleCallback === 'function') {
        nonCriticalTimer = requestIdleCallback(() => applyNonCriticalStyles(nonCriticalCss), {
          timeout: 2000,
        });
      } else {
        nonCriticalTimer = setTimeout(() => applyNonCriticalStyles(nonCriticalCss), 200);
      }
    };

    const applyFromStorage = () => applyStyles(loadSettings());

    // Initial apply
    applyFromStorage();

    // Live updates
    window.addEventListener('youtube-plus-settings-updated', e => {
      try {
        applyStyles(e?.detail || loadSettings());
      } catch {
        applyFromStorage();
      }
    });
  } catch (err) {
    console.error('zen-youtube-features injection failed', err);
  }
})();
