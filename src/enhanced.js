// Enhanced Tabviews
(function () {
  'use strict';

  // Use centralized i18n when available
  const _globalI18n =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;
  const _getLanguage = () => {
    try {
      if (_globalI18n && typeof _globalI18n.getLanguage === 'function') {
        return _globalI18n.getLanguage();
      }
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.getLanguage === 'function'
      ) {
        return window.YouTubeUtils.getLanguage();
      }
    } catch {
      // fallback
    }
    const htmlLang = document.documentElement.lang || 'en';
    return htmlLang.startsWith('ru') ? 'ru' : 'en';
  };
  const t = (key, params = {}) => {
    try {
      if (_globalI18n && typeof _globalI18n.t === 'function') {
        return _globalI18n.t(key, params);
      }
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.t === 'function'
      ) {
        return window.YouTubeUtils.t(key, params);
      }
    } catch {
      // fall through
    }
    if (!key || typeof key !== 'string') return '';
    if (Object.keys(params).length === 0) return key;
    let result = key;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
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
  const setupScrollListener = () => {
    try {
      // Clean up old listeners first
      document.querySelectorAll('.tab-content-cld').forEach(tab => {
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

      const activeTab = document.querySelector(
        '#right-tabs .tab-content-cld:not(.tab-content-hidden)'
      );
      const button = document.getElementById('right-tabs-top-button');

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
          activeTab.addEventListener('scroll', scrollHandler, { passive: true, capture: false });
          handleScroll(activeTab, button);
        }
      }
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error in setupScrollListener:', error);
    }
  };

  /**
   * Creates and appends scroll-to-top button with error handling
   * @returns {void}
   */
  const createButton = () => {
    try {
      const rightTabs = document.querySelector('#right-tabs');
      if (!rightTabs || document.getElementById('right-tabs-top-button')) return;
      if (!config.enabled) return;

      const button = document.createElement('button');
      button.id = 'right-tabs-top-button';
      button.className = 'top-button';
      button.title = t('scrollToTop');
      button.setAttribute('aria-label', t('scrollToTop'));
      button.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

      button.addEventListener('click', () => {
        try {
          const activeTab = document.querySelector(
            '#right-tabs .tab-content-cld:not(.tab-content-hidden)'
          );
          if (activeTab) {
            // Try smooth scroll, fallback to instant
            if ('scrollBehavior' in document.documentElement.style) {
              activeTab.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              activeTab.scrollTop = 0;
            }
            // Announce to screen readers
            button.setAttribute('aria-label', t('scrolledToTop') || 'Scrolled to top');
            setTimeout(() => {
              button.setAttribute('aria-label', t('scrollToTop'));
            }, 1000);
          }
        } catch (error) {
          console.error('[YouTube+][Enhanced] Error scrolling to top:', error);
        }
      });

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
      if (document.getElementById('universal-top-button')) return;
      if (!config.enabled) return;

      const button = document.createElement('button');
      button.id = 'universal-top-button';
      button.className = 'top-button';
      button.title = t('scrollToTop');
      button.setAttribute('aria-label', t('scrollToTop'));
      button.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

      const scrollToTop = () => {
        try {
          if ('scrollBehavior' in document.documentElement.style) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            window.scrollTo(0, 0);
          }
        } catch (error) {
          console.error('[YouTube+][Enhanced] Error scrolling to top:', error);
        }
      };

      button.addEventListener('click', scrollToTop);
      button.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          scrollToTop();
        }
      });

      document.body.appendChild(button);

      // Setup scroll listener for window
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
        button.classList.toggle('visible', window.scrollY > 100);
      }, 100);

      window.addEventListener('scroll', scrollHandler, { passive: true });
      button.classList.toggle('visible', window.scrollY > 100);
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
      const playlistPanel = document.querySelector('ytd-playlist-panel-renderer');
      if (!playlistPanel || document.getElementById('playlist-panel-top-button')) return;
      if (!config.enabled) return;

      const button = document.createElement('button');
      button.id = 'playlist-panel-top-button';
      button.className = 'top-button';
      button.title = t('scrollToTop');
      button.setAttribute('aria-label', t('scrollToTop'));
      button.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

      const scrollContainer = playlistPanel.querySelector('#items');
      if (!scrollContainer) return;

      const scrollToTop = () => {
        try {
          if ('scrollBehavior' in document.documentElement.style) {
            scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            scrollContainer.scrollTop = 0;
          }
        } catch (error) {
          console.error('[YouTube+][Enhanced] Error scrolling to top:', error);
        }
      };

      button.addEventListener('click', scrollToTop);
      button.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          scrollToTop();
        }
      });

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
      scrollContainer.addEventListener('scroll', scrollHandler, { passive: true });
      handleScroll(scrollContainer, button);
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error creating playlist panel button:', error);
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

  const fetchDislikes = async videoId => {
    if (!videoId) return 0;
    const cached = dislikeCache.get(videoId);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

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
        const meta = document.querySelector(
          "meta[itemprop='videoId'], meta[itemprop='identifier']"
        );
        return meta?.getAttribute('content') || null;
      }
      return urlObj.searchParams.get('v');
    } catch {
      return null;
    }
  };

  const getButtonsContainer = () => {
    return (
      document.querySelector(
        'ytd-menu-renderer.ytd-watch-metadata > div#top-level-buttons-computed'
      ) ||
      document.querySelector('ytd-menu-renderer.ytd-video-primary-info-renderer > div') ||
      document.querySelector('#menu-container #top-level-buttons-computed') ||
      null
    );
  };

  /**
   * Get dislike button for Shorts page
   * @returns {HTMLElement|null} Dislike button element
   */
  const getDislikeButtonShorts = () => {
    // Try to find the active reel first
    const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (activeReel) {
      const btn =
        activeReel.querySelector('dislike-button-view-model') ||
        activeReel
          .querySelector('like-button-view-model')
          ?.parentElement?.querySelector('[aria-label*="islike"]')
          ?.closest('button')?.parentElement ||
        activeReel.querySelector('#dislike-button');
      if (btn) return btn;
    }

    // Fallback: find in the shorts player container
    const shortsContainer = document.querySelector('ytd-shorts');
    if (shortsContainer) {
      const btn =
        shortsContainer.querySelector('dislike-button-view-model') ||
        shortsContainer.querySelector('#dislike-button');
      if (btn) return btn;
    }

    // Last resort: global search
    return (
      document.querySelector('dislike-button-view-model') ||
      document.querySelector('#dislike-button') ||
      null
    );
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
    const created = document.createElement('span');
    created.id = 'ytp-plus-dislike-text';
    created.setAttribute('role', 'text');
    created.className = 'yt-core-attributed-string yt-core-attributed-string--white-space-no-wrap';
    const isShorts = window.location.pathname.startsWith('/shorts');
    created.style.cssText = isShorts
      ? 'margin-left: 4px; font-size: 1.2rem; line-height: 1.8rem; font-weight: 500;'
      : 'margin-left: 6px; font-size: 1.4rem; line-height: 2rem; font-weight: 500;';

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

  const initReturnDislike = () => {
    try {
      // avoid multiple polls
      if (dislikePollTimer) return;
      let attempts = 0;
      const maxAttempts = window.location.pathname.startsWith('/shorts') ? 100 : 50;
      const interval = window.location.pathname.startsWith('/shorts') ? 100 : 200;
      dislikePollTimer = setInterval(async () => {
        attempts++;
        const btn = getDislikeButton();
        if (btn || attempts >= maxAttempts) {
          clearInterval(dislikePollTimer);
          dislikePollTimer = null;
          if (btn) {
            const vid = getVideoIdForDislike();
            const val = await fetchDislikes(vid);
            setDislikeDisplay(btn, val);
            setupDislikeObserver(btn);
          }
        }
      }, interval);
    } catch {
      // ignore
    }
  };

  const cleanupReturnDislike = () => {
    try {
      if (dislikePollTimer) {
        clearInterval(dislikePollTimer);
        dislikePollTimer = null;
      }
      if (dislikeObserver) {
        dislikeObserver.disconnect();
        dislikeObserver = null;
      }
      // Remove all created dislike text spans
      document.querySelectorAll('#ytp-plus-dislike-text').forEach(el => {
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

      const rightTabs = document.querySelector('#right-tabs');
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
    const path = window.location.pathname;
    const { search } = window.location;

    // Search results page
    if (path === '/results' && search.includes('search_query=')) return true;

    // Playlist page
    if (path === '/playlist' && search.includes('list=')) return true;

    // Home/Feed pages
    if (path === '/' || path === '/feed/subscriptions') return true;

    return false;
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
      document.addEventListener('click', handleTabButtonClick, true);
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error in setupEvents:', error);
    }
  };

  /**
   * Initialize scroll-to-top button module
   * @returns {void}
   */
  const init = () => {
    try {
      addStyles();
      setupEvents();

      // Check for right tabs (watch page)
      const checkForTabs = () => {
        try {
          if (document.querySelector('#right-tabs')) {
            createButton();
            observeTabChanges();
          } else {
            setTimeout(checkForTabs, 500);
          }
        } catch (error) {
          console.error('[YouTube+][Enhanced] Error checking for tabs:', error);
        }
      };

      // Check for playlist panel
      const checkForPlaylistPanel = () => {
        try {
          const playlistPanel = document.querySelector('ytd-playlist-panel-renderer');
          if (playlistPanel && !document.getElementById('playlist-panel-top-button')) {
            createPlaylistPanelButton();
          }
        } catch (error) {
          console.error('[YouTube+][Enhanced] Error checking for playlist panel:', error);
        }
      };

      // Check page type and create appropriate button
      const checkPageType = () => {
        try {
          if (needsUniversalButton() && !document.getElementById('universal-top-button')) {
            createUniversalButton();
          }
          checkForPlaylistPanel();
        } catch (error) {
          console.error('[YouTube+][Enhanced] Error checking page type:', error);
        }
      };

      checkForTabs();
      setTimeout(checkPageType, 500);
      // Initialize ReturnYouTubeDislike integration
      try {
        initReturnDislike();
      } catch {}

      // Observer for playlist panel - optimized with throttling
      let observerThrottle = null;
      const observer = new MutationObserver(() => {
        if (observerThrottle) return;
        observerThrottle = setTimeout(() => {
          observerThrottle = null;
          checkForPlaylistPanel();
        }, 200); // Throttle to reduce overhead
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false, // Don't watch attributes
        characterData: false, // Don't watch text changes
      });

      // Listen for navigation changes (YouTube is SPA)
      window.addEventListener('yt-navigate-finish', () => {
        // cleanup and re-init dislike integration around navigation
        try {
          cleanupReturnDislike();
        } catch {}
        setTimeout(() => {
          checkPageType();
          checkForTabs();
          try {
            initReturnDislike();
          } catch {}
        }, 300);
      });
    } catch (error) {
      console.error('[YouTube+][Enhanced] Error in initialization:', error);
    }
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
    // Added .teaser-carousel to cover variants named 'teaser-carousel'
    selectors:
      '.ytp-ce-element-show,.ytp-ce-element,.ytp-endscreen-element,.ytp-ce-covering-overlay,.ytp-cards-teaser,.teaser-carousel,.ytp-cards-button,.iv-drawer,.video-annotations,.ytp-overlay-bottom-right',
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
        window.YouTubeUtils?.debounce ||
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
        const { target } = /** @type {{ target: EventTarget & HTMLInputElement }} */ (e);
        const { checked } = /** @type {HTMLInputElement} */ (target);
        CONFIG.enabled = checked;
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

  const { readyState } = document;
  if (readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

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
  const AUTO_HIDE_MS = 10000; // hide overlay after 10s

  // Localization: prefer centralized i18n (YouTubePlusI18n) or YouTubeUtils.t, fall back to a tiny local map
  const _globalI18n =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;
  const _localFallback = {
    resumePlayback: { en: 'Resume playback?', ru: 'Продолжить воспроизведение?' },
    resume: { en: 'Resume', ru: 'Продолжить' },
    startOver: { en: 'Start over', ru: 'Начать сначала' },
  };

  const t = (key, params = {}) => {
    try {
      if (_globalI18n && typeof _globalI18n.t === 'function') {
        return _globalI18n.t(key, params);
      }
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.t === 'function'
      ) {
        return window.YouTubeUtils.t(key, params);
      }
    } catch {}

    // fallback to local tiny map
    const htmlLang = document.documentElement.lang || 'en';
    const lang = htmlLang.startsWith('ru') ? 'ru' : 'en';
    const val =
      (_localFallback[key] && (_localFallback[key][lang] || _localFallback[key].en)) || key;
    if (!params || Object.keys(params).length === 0) return val;
    let result = val;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
  };

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
      // First try URL parameters (most reliable)
      const urlParams = new URLSearchParams(window.location.search);
      const videoIdFromUrl = urlParams.get('v');
      if (videoIdFromUrl) return videoIdFromUrl;

      // Try canonical link
      const meta = document.querySelector('link[rel="canonical"]');
      if (meta && meta.href) {
        const u = new URL(meta.href);
        const vParam = u.searchParams.get('v');
        if (vParam) return vParam;

        // Try extracting from pathname (for /watch/ or /shorts/ URLs)
        const pathMatch = u.pathname.match(/\/(watch|shorts)\/([^\/\?]+)/);
        if (pathMatch && pathMatch[2]) return pathMatch[2];
      }

      // Fallback to ytInitialPlayerResponse
      if (
        window.ytInitialPlayerResponse &&
        window.ytInitialPlayerResponse.videoDetails &&
        window.ytInitialPlayerResponse.videoDetails.videoId
      ) {
        return window.ytInitialPlayerResponse.videoDetails.videoId;
      }

      // Last resort: try to extract from current URL pathname
      const pathMatch = window.location.pathname.match(/\/(watch|shorts)\/([^\/\?]+)/);
      if (pathMatch && pathMatch[2]) return pathMatch[2];

      return null;
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
      .ytp-resume-overlay{min-width:180px;max-width:36vw;background:rgba(24, 24, 24, 0.3);color:var(--yt-spec-text-primary,#fff);padding:12px 14px;border-radius:12px;backdrop-filter:blur(8px) saturate(150%);-webkit-backdrop-filter:blur(8px) saturate(150%);box-shadow:0 14px 40px rgba(0,0,0,0.48);border:1.25px solid rgba(255,255,255,0.06);font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;align-items:center;text-align:center;animation:ytp-resume-fadein 0.3s ease-out}
      @keyframes ytp-resume-fadein{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      .ytp-resume-overlay .ytp-resume-title{font-weight:600;margin-bottom:8px;font-size:13px}
      .ytp-resume-overlay .ytp-resume-actions{display:flex;gap:8px;justify-content:center;margin-top:6px}
      .ytp-resume-overlay .ytp-resume-btn{padding:6px 12px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:500;transition:all 0.2s ease;outline:none}
      .ytp-resume-overlay .ytp-resume-btn:focus{box-shadow:0 0 0 2px rgba(255,255,255,0.3);outline:2px solid transparent}
      .ytp-resume-overlay .ytp-resume-btn:hover{transform:translateY(-1px)}
      .ytp-resume-overlay .ytp-resume-btn:active{transform:translateY(0)}
      .ytp-resume-overlay .ytp-resume-btn.primary{background:#1e88e5;color:#fff}
      .ytp-resume-overlay .ytp-resume-btn.primary:hover{background:#1976d2}
      .ytp-resume-overlay .ytp-resume-btn.ghost{background:rgba(255,255,255,0.06);color:#fff}
      .ytp-resume-overlay .ytp-resume-btn.ghost:hover{background:rgba(255,255,255,0.12)}
    `;
    try {
      if (window.YouTubeUtils && YouTubeUtils.StyleManager) {
        YouTubeUtils.StyleManager.add('ytp-resume-overlay-styles', resumeOverlayStyles);
      } else if (!document.getElementById('ytp-resume-overlay-styles')) {
        const s = document.createElement('style');
        s.id = 'ytp-resume-overlay-styles';
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
      wrap.className = 'ytp-resume-overlay';
      // absolute center (use transform to center by both axes)
      wrap.style.cssText =
        'position:absolute;left:50%;bottom:5%;transform:translate(-50%,-50%);z-index:9999;pointer-events:auto;';
      player.appendChild(wrap);
    } else {
      // Fallback: fixed centered on the page
      wrap.className = 'ytp-resume-overlay';
      wrap.style.cssText =
        'position:fixed;left:50%;bottom:5%;transform:translate(-50%,-50%);z-index:1200;pointer-events:auto;';
      document.body.appendChild(wrap);
    }

    const title = document.createElement('div');
    title.className = 'ytp-resume-title';
    title.textContent = `${t('resumePlayback')} (${formatTime(seconds)})`;

    const btnResume = document.createElement('button');
    btnResume.className = 'ytp-resume-btn primary';
    btnResume.textContent = t('resume');
    btnResume.setAttribute('aria-label', `${t('resume')} at ${formatTime(seconds)}`);
    btnResume.tabIndex = 0;

    const btnRestart = document.createElement('button');
    btnRestart.className = 'ytp-resume-btn ghost';
    btnRestart.textContent = t('startOver');
    btnRestart.setAttribute('aria-label', t('startOver'));
    btnRestart.tabIndex = 0;

    const handleResume = () => {
      try {
        onResume();
      } catch (err) {
        console.error('[YouTube+] Resume error:', err);
      }
      try {
        wrap.remove();
      } catch {}
    };

    const handleRestart = () => {
      try {
        onRestart();
      } catch (err) {
        console.error('[YouTube+] Restart error:', err);
      }
      try {
        wrap.remove();
      } catch {}
    };

    btnResume.addEventListener('click', handleResume);
    btnRestart.addEventListener('click', handleRestart);

    // Add keyboard support (Enter/Space)
    btnResume.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handleResume();
      }
    });
    btnRestart.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handleRestart();
      }
    });

    // group actions and center them
    const actions = document.createElement('div');
    actions.className = 'ytp-resume-actions';
    actions.appendChild(btnResume);
    actions.appendChild(btnRestart);

    wrap.appendChild(title);
    wrap.appendChild(actions);

    // Set focus to primary button for keyboard accessibility
    try {
      requestAnimationFrame(() => {
        btnResume.focus();
      });
    } catch {}

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
    if (!videoEl || videoEl.tagName !== 'VIDEO') {
      console.warn('[YouTube+] Invalid video element for resume handlers');
      return;
    }

    // Mark element to prevent duplicate handlers
    if (videoEl._ytpResumeAttached) return;
    videoEl._ytpResumeAttached = true;

    // Get current video ID dynamically each time
    const getCurrentVideoId = () => getVideoId();
    const vid = getCurrentVideoId();
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
          // Get current video ID each time we save
          const currentVid = getCurrentVideoId();
          if (!currentVid) return;

          const t = Math.floor(videoEl.currentTime || 0);
          const now = Date.now();
          if (t && (!lastSavedAt || now - lastSavedAt > SAVE_THROTTLE_MS)) {
            const s = readStorage();
            s[currentVid] = t;
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

      // Tag overlay with current video id so future init calls won't immediately remove it
      try {
        const overlayEl = document.getElementById(OVERLAY_ID);
        if (overlayEl && vid) overlayEl.dataset.vid = vid;
      } catch {}

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
    const cleanupHandlers = () => {
      try {
        videoEl.removeEventListener('play', onPlay);
        videoEl.removeEventListener('pause', onPause);
        if (timeUpdateHandler) {
          videoEl.removeEventListener('timeupdate', timeUpdateHandler);
        }
        delete videoEl._ytpResumeAttached;
      } catch (err) {
        console.error('[YouTube+] Resume cleanup error:', err);
      }
    };

    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.register(cleanupHandlers);
    }

    // Return cleanup function
    return cleanupHandlers;
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
    if (window.location.pathname !== '/watch') {
      // Remove overlay if we navigate away from watch page
      const existingOverlay = document.getElementById(OVERLAY_ID);
      if (existingOverlay) {
        existingOverlay.remove();
      }
      return;
    }

    // Remove any existing overlay from previous video — but keep it if it's for the same video id
    const currentVid = getVideoId();
    const existingOverlay = document.getElementById(OVERLAY_ID);
    if (existingOverlay) {
      try {
        if (existingOverlay.dataset && existingOverlay.dataset.vid === currentVid) {
          // overlay matches current video; keep it (prevents immediate disappearance during SPA re-inits)
        } else {
          existingOverlay.remove();
        }
      } catch {
        try {
          existingOverlay.remove();
        } catch {}
      }
    }

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

  /** @type {any} */
  const globalContext =
    typeof unsafeWindow !== 'undefined'
      ? /** @type {any} */ (unsafeWindow)
      : /** @type {any} */ (window);

  const gmApi = globalContext?.GM ?? null;
  const gmInfo = globalContext?.GM_info ?? null;

  const scriptVersion = gmInfo?.script?.version ?? null;
  if (scriptVersion && /-(alpha|beta|dev|test)$/.test(scriptVersion)) {
    try {
      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.info &&
        YouTubeUtils.logger.info(
          '%cytp - YouTube Play All\n',
          'color: #bf4bcc; font-size: 32px; font-weight: bold',
          'You are currently running a test version:',
          scriptVersion
        );
    } catch {}
  }

  if (
    Object.prototype.hasOwnProperty.call(window, 'trustedTypes') &&
    !window.trustedTypes.defaultPolicy
  ) {
    window.trustedTypes.createPolicy('default', { createHTML: string => string });
  }

  const insertStylesSafely = html => {
    try {
      const target = document.head || document.documentElement;
      if (target && typeof target.insertAdjacentHTML === 'function') {
        target.insertAdjacentHTML('beforeend', html);
        return;
      }

      // If head isn't available yet, wait for DOMContentLoaded and insert then.
      const onReady = () => {
        try {
          const t = document.head || document.documentElement;
          if (t && typeof t.insertAdjacentHTML === 'function') {
            t.insertAdjacentHTML('beforeend', html);
          }
        } catch {}
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady, { once: true });
      } else {
        onReady();
      }
    } catch {}
  };

  insertStylesSafely(`<style>
        .ytp-btn {border-radius: 8px; font-family: 'Roboto', 'Arial', sans-serif; font-size: 1.4rem; line-height: 2rem; font-weight: 500; padding: 0.5em; margin-left: 0.6em; user-select: none;}        
        .ytp-btn, .ytp-btn > * {text-decoration: none; cursor: pointer;}        
        .ytp-btn-sections {padding: 0;}        
        .ytp-btn-sections > .ytp-btn-section {padding: 0.5em; display: inline-block;} 
        .ytp-btn-sections > .ytp-btn-section:first-child {border-top-left-radius: 8px; border-bottom-left-radius: 8px;} 
        .ytp-btn-sections > .ytp-btn-section:nth-last-child(1 of .ytp-btn-section) {border-top-right-radius: 8px; border-bottom-right-radius: 8px;}        
        .ytp-badge {border-radius: 8px; padding: 0.2em; font-size: 0.8em; vertical-align: top;} 
        .ytp-play-all-btn {background-color: #bf4bcc; color: white;} 
        .ytp-play-all-btn:hover {background-color: #d264de;}        
        .ytp-random-btn > .ytp-btn-section, .ytp-random-badge, .ytp-random-notice, .ytp-random-popover > * {background-color: #2b66da; color: white;} 
        .ytp-random-btn > .ytp-btn-section:hover, .ytp-random-popover > *:hover {background-color: #6192ee;}        
        .ytp-play-all-btn.ytp-unsupported {background-color: #828282; color: white;}        
        .ytp-random-popover {position: absolute; border-radius: 8px; font-size: 1.6rem; transform: translate(-100%, 0.4em);}        
        .ytp-random-popover > * {display: block; text-decoration: none; padding: 0.4em;}        
        .ytp-random-popover > :first-child {border-top-left-radius: 8px; border-top-right-radius: 8px;}        
        .ytp-random-popover > :last-child {border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;}    
        .ytp-random-popover > *:not(:last-child) {border-bottom: 1px solid #6e8dbb;}    
        .ytp-button-container {display: flex; width: 100%; margin-top: 1em; margin-bottom: -1em;} 
        ytd-rich-grid-renderer .ytp-button-container > :first-child {margin-left: 0;}        
        /* fetch() API introduces a race condition. This hides the occasional duplicate buttons */
        .ytp-play-all-btn ~ .ytp-play-all-btn, .ytp-random-btn ~ .ytp-random-btn {display: none;}        
        /* Fix for mobile view */
        ytm-feed-filter-chip-bar-renderer .ytp-btn {margin-right: 12px; padding: 0.4em;}        
        body:has(#secondary ytd-playlist-panel-renderer[ytp-random]) .ytp-prev-button.ytp-button, body:has(#secondary ytd-playlist-panel-renderer[ytp-random]) .ytp-next-button.ytp-button:not([ytp-random="applied"]) {display: none !important;}        
        #secondary ytd-playlist-panel-renderer[ytp-random] ytd-menu-renderer.ytd-playlist-panel-renderer {height: 1em; visibility: hidden;}        
        #secondary ytd-playlist-panel-renderer[ytp-random]:not(:hover) ytd-playlist-panel-video-renderer {filter: blur(2em);} 
        .ytp-random-notice {padding: 1em; z-index: 1000;}        
        .ytp-playlist-emulator {margin-bottom: 1.6rem; border-radius: 1rem;}        
        .ytp-playlist-emulator > .title {border-top-left-radius: 1rem; border-top-right-radius: 1rem; font-size: 2rem; background-color: #323232; color: white; padding: 0.8rem;}        
        .ytp-playlist-emulator > .information {font-size: 1rem; background-color: #2b2a2a; color: white; padding: 0.8rem;}        
        .ytp-playlist-emulator > .footer {border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; background-color: #323232; padding: 0.8rem;}        
        .ytp-playlist-emulator > .items {max-height: 500px; overflow-y: auto; overflow-x: hidden;}        
        .ytp-playlist-emulator:not([data-failed]) > .items:empty::before {content: 'Loading playlist...'; background-color: #626262; padding: 0.8rem; color: white; font-size: 2rem; display: block;}        
        .ytp-playlist-emulator[data-failed="rejected"] > .items:empty::before {content: "Make sure to allow the external API call to ytplaylist.robert.wesner.io to keep viewing playlists that YouTube doesn't natively support!"; background-color: #491818; padding: 0.8rem; color: #ff7c7c; font-size: 1rem; display: block;}        
        .ytp-playlist-emulator > .items > .item {background-color: #2c2c2c; padding: 0.8rem; border: 1px solid #1b1b1b; font-size: 1.6rem; color: white; min-height: 5rem; cursor: pointer;}        
        .ytp-playlist-emulator > .items > .item:hover {background-color: #505050;}      
        .ytp-playlist-emulator > .items > .item:not(:last-of-type) {border-bottom: 0;}        
        .ytp-playlist-emulator > .items > .item[data-current] {background-color: #767676;}        
        body:has(.ytp-playlist-emulator) .ytp-prev-button.ytp-button, body:has(.ytp-playlist-emulator) .ytp-next-button.ytp-button:not([ytp-emulation="applied"]) {display: none !important;}        
        /* hide when sorting by oldest */
        ytm-feed-filter-chip-bar-renderer > div :nth-child(3).selected ~ .ytp-btn:not(.ytp-unsupported), ytd-feed-filter-chip-bar-renderer iron-selector#chips :nth-child(3).iron-selected ~ .ytp-btn:not(.ytp-unsupported) {display: none;}
    </style>`);

  const getVideoId = url => {
    try {
      return new URLSearchParams(new URL(url).search).get('v');
    } catch {
      return null;
    }
  };

  const queryHTMLElement = selector => {
    const el = document.querySelector(selector);
    return el instanceof HTMLElement ? el : null;
  };

  /**
   * @typedef {HTMLDivElement & {
   *   getProgressState: () => { current: number, duration: number, number: number },
   *   pauseVideo: () => void,
   *   seekTo: (seconds: number, allowSeekAhead?: boolean) => void,
   *   isLifaAdPlaying: () => boolean
   * }} PlayerElement
   */

  /**
   * @return {{ getProgressState: () => { current: number, duration, number }, pauseVideo: () => void, seekTo: (number) => void, isLifaAdPlaying: () => boolean }} player
   */
  const getPlayer = () =>
    /** @type {PlayerElement | null} */ (document.querySelector('#movie_player'));

  const isAdPlaying = () => !!document.querySelector('.ad-interrupting');

  const redirect = (v, list, ytpRandom = null) => {
    if (location.host === 'm.youtube.com') {
      // Mobile: use direct navigation
      const url = `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`;
      window.location.href = url;
    } else {
      // Desktop: try YouTube's client-side routing first, with fallback
      try {
        const playlistPanel = document.querySelector('ytd-playlist-panel-renderer #items');
        if (playlistPanel) {
          const redirector = document.createElement('a');
          redirector.className = 'yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer';
          redirector.setAttribute('hidden', '');
          redirector.data = {
            commandMetadata: {
              webCommandMetadata: {
                url: `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`,
                webPageType: 'WEB_PAGE_TYPE_WATCH',
                rootVe: 3832, // ??? required though
              },
            },
            watchEndpoint: {
              videoId: v,
              playlistId: list,
            },
          };
          playlistPanel.append(redirector);
          redirector.click();
        } else {
          // Fallback: use direct navigation if playlist panel not found
          const url = `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`;
          window.location.href = url;
        }
      } catch {
        // Fallback: use direct navigation on error
        const url = `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`;
        window.location.href = url;
      }
    }
  };

  let id = '';
  const apply = () => {
    if (id === '') {
      // do not apply prematurely, caused by mutation observer
      console.warn('[Play All] Channel ID not yet determined');
      return;
    }

    let parent =
      location.host === 'm.youtube.com'
        ? // mobile view
          queryHTMLElement(
            'ytm-feed-filter-chip-bar-renderer .chip-bar-contents, ytm-feed-filter-chip-bar-renderer > div'
          )
        : // desktop view
          queryHTMLElement('ytd-feed-filter-chip-bar-renderer iron-selector#chips');

    // #5: add a custom container for buttons if Latest/Popular/Oldest is missing
    if (parent === null) {
      const grid = queryHTMLElement('ytd-rich-grid-renderer, ytm-rich-grid-renderer');
      if (!grid) {
        console.warn('[Play All] Could not find grid container');
        return;
      }

      // Check if container already exists
      let existingContainer = grid.querySelector('.ytp-button-container');
      if (!existingContainer) {
        grid.insertAdjacentHTML('afterbegin', '<div class="ytp-button-container"></div>');
        existingContainer = grid.querySelector('.ytp-button-container');
      }
      parent = existingContainer instanceof HTMLElement ? existingContainer : null;
    }

    if (!parent) {
      console.warn('[Play All] Could not find parent container');
      return;
    }

    // Prevent duplicate buttons
    if (parent.querySelector('.ytp-play-all-btn, .ytp-random-btn')) {
      try {
        window.YouTubeUtils &&
          YouTubeUtils.logger &&
          YouTubeUtils.logger.debug &&
          YouTubeUtils.logger.debug('[Play All] Buttons already exist, skipping');
      } catch {}
      return;
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

    const playlistSuffix = id.startsWith('UC') ? id.substring(2) : id;

    // Check if popular videos are displayed
    if (parent.querySelector(':nth-child(2).selected, :nth-child(2).iron-selected')) {
      parent.insertAdjacentHTML(
        'beforeend',
        `<a class="ytp-btn ytp-play-all-btn" href="/playlist?list=${popularPlaylist}${playlistSuffix}&playnext=1">Play Popular</a>`
      );
    } else if (parent.querySelector(':nth-child(1).selected, :nth-child(1).iron-selected')) {
      parent.insertAdjacentHTML(
        'beforeend',
        `<a class="ytp-btn ytp-play-all-btn" href="/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1">Play All</a>`
      );
    } else {
      parent.insertAdjacentHTML(
        'beforeend',
        `<a class="ytp-btn ytp-play-all-btn ytp-unsupported" href="https://github.com/RobertWesner/YouTube-Play-All/issues/39" target="_blank">No Playlist Found</a>`
      );
    }

    const navigate = href => {
      window.location.assign(href);
    };

    if (location.host === 'm.youtube.com') {
      // YouTube returns an "invalid response" when using client side routing for playnext=1 on mobile
      parent.querySelectorAll('.ytp-btn').forEach(btn => {
        btn.addEventListener('click', event => {
          event.preventDefault();

          navigate(btn.href);
        });
      });
    } else {
      const attachNavigationHandler = elements => {
        elements.forEach(btn => {
          btn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            navigate(btn.href);
          });
        });
      };

      attachNavigationHandler(parent.querySelectorAll('.ytp-play-all-btn:not(.ytp-unsupported)'));

      // Only allow random play in desktop version for now
      parent.insertAdjacentHTML(
        'beforeend',
        `
                <span class="ytp-btn ytp-random-btn ytp-btn-sections">
                    <a class="ytp-btn-section" href="/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1&ytp-random=random&ytp-random-initial=1">
                        Play Random
                    </a><!--
                    --><span class="ytp-btn-section ytp-random-more-options-btn ytp-hover-popover">
                        &#x25BE
                    </span>
                </span>
            `
      );

      // Remove existing popovers to prevent duplicates when navigating between tabs
      document.querySelectorAll('.ytp-random-popover').forEach(popover => popover.remove());

      document.body.insertAdjacentHTML(
        'beforeend',
        `
                <div class="ytp-random-popover" hidden="">
                    <a href="/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1&ytp-random=prefer-newest">
                        Prefer newest
                    </a>
                    <a href="/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1&ytp-random=prefer-oldest&ytp-random-initial=1">
                        Prefer oldest
                    </a>
                </div>
            `
      );

      attachNavigationHandler(parent.querySelectorAll('.ytp-random-btn a'));

      const randomPopover = document.querySelector('.ytp-random-popover');
      if (randomPopover) {
        attachNavigationHandler(randomPopover.querySelectorAll('a'));
      }

      const randomMoreOptionsBtn = document.querySelector('.ytp-random-more-options-btn');
      if (randomMoreOptionsBtn && randomPopover) {
        randomMoreOptionsBtn.addEventListener('click', () => {
          const rect = randomMoreOptionsBtn.getBoundingClientRect();
          randomPopover.style.top = `${rect.bottom}px`;
          randomPopover.style.left = `${rect.right}px`;
          randomPopover.removeAttribute('hidden');
        });
        randomPopover.addEventListener('mouseleave', () => {
          randomPopover.setAttribute('hidden', '');
        });
      }
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
    if (document.querySelector('.ytp-play-all-btn')) {
      return;
    }

    // Try to extract channel ID from canonical link first
    try {
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical && canonical.href) {
        const match = canonical.href.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
        if (match && match[1]) {
          id = match[1];
          apply();
          return;
        }

        // Also try @handle format
        const handleMatch = canonical.href.match(/\/@([^\/]+)/);
        if (handleMatch) {
          // Try to get channel ID from page data
          const pageData = document.querySelector('ytd-browse[page-subtype="channels"]');
          if (pageData) {
            const channelId = pageData.getAttribute('channel-id');
            if (channelId && channelId.startsWith('UC')) {
              id = channelId;
              apply();
              return;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Play All] Error extracting channel ID from canonical:', e);
    }

    // Fallback: fetch HTML and parse
    try {
      const html = await (await fetch(location.href)).text();
      const canonicalMatch = html.match(
        /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/
      );

      if (canonicalMatch && canonicalMatch[1]) {
        id = canonicalMatch[1];
      } else {
        // Try alternative extraction methods
        const channelIdMatch = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
        if (channelIdMatch && channelIdMatch[1]) {
          id = channelIdMatch[1];
        }
      }

      if (id) {
        apply();
      } else {
        console.warn('[Play All] Could not extract channel ID');
      }
    } catch (e) {
      console.error('[Play All] Error fetching channel data:', e);
    }
  };

  // Removing the button prevents it from still existing when switching between "Videos", "Shorts", and "Live"
  // This is necessary due to the mobile Interval requiring a check for an already existing button
  const removeButton = () =>
    document.querySelectorAll('.ytp-btn').forEach(element => element.remove());

  if (location.host === 'm.youtube.com') {
    // The "yt-navigate-finish" event does not fire on mobile
    // Unfortunately pushState is triggered before the navigation occurs, so a Proxy is useless
    setInterval(addButton, 1000);
  } else {
    window.addEventListener('yt-navigate-start', removeButton);
    window.addEventListener('yt-navigate-finish', addButton);
    // Also attempt to add buttons on initial script run in case the SPA navigation event
    // already happened before this script was loaded (some browsers/firefox timing).
    try {
      setTimeout(addButton, 300);
    } catch {}
  }

  // Fallback playlist emulation
  (() => {
    const getItems = playlist => {
      return new Promise(resolve => {
        const payload = {
          uri: `https://www.youtube.com/playlist?list=${playlist}`,
          requestType: `ytp ${gmInfo?.script?.version ?? 'unknown'}`,
        };

        const markFailure = () => {
          const emulator = document.querySelector('.ytp-playlist-emulator');
          if (emulator instanceof HTMLElement) {
            emulator.setAttribute('data-failed', 'rejected');
          }
        };

        const handleSuccess = data => {
          resolve(data);
        };

        const handleError = () => {
          markFailure();
          resolve({ status: 'error', items: [] });
        };

        if (gmApi && typeof gmApi.xmlHttpRequest === 'function') {
          gmApi.xmlHttpRequest({
            method: 'POST',
            url: 'https://ytplaylist.robert.wesner.io/api/list',
            data: JSON.stringify(payload),
            headers: {
              'Content-Type': 'application/json',
            },
            onload: response => {
              try {
                handleSuccess(JSON.parse(response.responseText));
              } catch (parseError) {
                console.error('[Play All] Failed to parse playlist response:', parseError);
                handleError();
              }
            },
            onerror: _error => {
              handleError();
            },
          });
          return;
        }

        // Fallback to fetch when GM.xmlHttpRequest is unavailable (e.g., during tests)
        fetch('https://ytplaylist.robert.wesner.io/api/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
          .then(resp => resp.json())
          .then(handleSuccess)
          .catch(err => {
            console.error('[Play All] Playlist fetch failed:', err);
            handleError();
          });
      });
    };

    const processItems = items => {
      const itemsContainer = document.querySelector('.ytp-playlist-emulator .items');
      const params = new URLSearchParams(window.location.search);
      const list = params.get('list');

      if (!(itemsContainer instanceof HTMLElement)) {
        return;
      }

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
      document.querySelector(`.ytp-playlist-emulator .items .item[data-current] + .item`)?.click();
    };

    const markCurrentItem = videoId => {
      const existing = document.querySelector(`.ytp-playlist-emulator .items .item[data-current]`);
      if (existing) {
        existing.removeAttribute('data-current');
      }

      const current = document.querySelector(
        `.ytp-playlist-emulator .items .item[data-id="${videoId}"]`
      );
      if (current instanceof HTMLElement) {
        current.setAttribute('data-current', '');
        const parentElement = current.parentElement;
        if (parentElement instanceof HTMLElement) {
          const docElement = /** @type {any} */ (document.documentElement);
          const fontSize = parseFloat(getComputedStyle(docElement).fontSize || '16');
          parentElement.scrollTop = current.offsetTop - 12 * fontSize;
        }
      }
    };

    const emulatePlaylist = () => {
      if (!window.location.pathname.endsWith('/watch')) {
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const list = params.get('list');
      if (!list) {
        return;
      }
      if (params.has('ytp-random')) {
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

      const existingEmulator = document.querySelector('.ytp-playlist-emulator');
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
      playlistEmulator.className = 'ytp-playlist-emulator';
      playlistEmulator.innerHTML = `
                <div class="title">
                    Playlist emulator
                </div>
                <div class="information">
                    It looks like YouTube is unable to handle this large playlist.
                    Playlist emulation is a <b>limited</b> fallback feature of ytp to enable you to watch even more content. <br>
                </div>
                <div class="items"></div>
                <div class="footer"></div>
            `;
      playlistEmulator.setAttribute('data-list', list);
      const playlistHost = document.querySelector(
        '#secondary-inner > ytd-playlist-panel-renderer#playlist'
      );
      if (playlistHost instanceof HTMLElement) {
        playlistHost.insertAdjacentElement('afterend', /** @type {any} */ (playlistEmulator));
      }

      getItems(list).then(response => {
        if (response?.status === 'running') {
          setTimeout(
            () =>
              getItems(list).then(nextResponse => {
                if (nextResponse && Array.isArray(nextResponse.items)) {
                  processItems(nextResponse.items);
                }
              }),
            5000
          );

          return;
        }

        if (response && Array.isArray(response.items)) {
          processItems(response.items);
        }
      });

      const nextButtonInterval = setInterval(() => {
        const nextButton = document.querySelector(
          '#ytd-player .ytp-next-button.ytp-button:not([ytp-emulation="applied"])'
        );
        if (nextButton) {
          clearInterval(nextButtonInterval);

          // Replace with span to prevent anchor click events
          const newButton = document.createElement('span');
          newButton.className = nextButton.className;
          newButton.innerHTML = nextButton.innerHTML;
          nextButton.replaceWith(newButton);

          newButton.setAttribute('ytp-emulation', 'applied');
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
        if (!player || typeof player.getProgressState !== 'function') {
          return;
        }

        const progressState = player.getProgressState();
        if (!progressState) {
          return;
        }

        // Do not listen for watch progress when watching advertisements
        if (!isAdPlaying()) {
          // Autoplay random video
          if (
            typeof progressState.current === 'number' &&
            typeof progressState.duration === 'number' &&
            progressState.current >= progressState.duration - 2
          ) {
            // make sure vanilla autoplay doesnt take over
            if (typeof player.pauseVideo === 'function') player.pauseVideo();
            if (typeof player.seekTo === 'function') player.seekTo(0);
            playNextEmulationItem();
          }
        }
      }, 500);
    };

    if (location.host === 'm.youtube.com') {
      // Note: Mobile playlist emulation is currently not supported due to different DOM structure
      // and API limitations on mobile YouTube. Future implementation would require:
      // - Mobile-specific DOM selectors
      // - Touch event handling
      // - Responsive UI adjustments
      try {
        window.YouTubeUtils &&
          YouTubeUtils.logger &&
          YouTubeUtils.logger.info &&
          YouTubeUtils.logger.info('[Play All] Mobile playlist emulation not yet supported');
      } catch {}
    } else {
      window.addEventListener('yt-navigate-finish', () => setTimeout(emulatePlaylist, 1000));
    }
  })();

  // Random play feature
  (() => {
    // Random play is not supported for mobile devices
    if (location.host === 'm.youtube.com') {
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);

    if (!urlParams.has('ytp-random') || urlParams.get('ytp-random') === '0') {
      return;
    }

    const ytpRandomParam = urlParams.get('ytp-random');
    /** @type {'random'|'prefer-newest'|'prefer-oldest'} */
    const ytpRandom =
      ytpRandomParam === 'prefer-newest' || ytpRandomParam === 'prefer-oldest'
        ? ytpRandomParam
        : 'random';

    const getStorageKey = () => `ytp-random-${urlParams.get('list')}`;
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
      const playerInstance = getPlayer();
      if (playerInstance && typeof playerInstance.pauseVideo === 'function') {
        playerInstance.pauseVideo();
      }

      const videos = Object.entries(getStorage()).filter(([_, watched]) => !watched);
      const params = new URLSearchParams(window.location.search);

      if (videos.length === 0) {
        return;
      }

      // Either one fifth or at most the 20 newest.
      const preferredCount = Math.max(1, Math.min(Math.floor(videos.length * 0.2), 20));

      let videoIndex;
      switch (ytpRandom) {
        case 'prefer-newest':
          // Select between latest 20 videos
          videoIndex = Math.floor(Math.random() * preferredCount);

          break;
        case 'prefer-oldest':
          // Select between oldest `preferredCount` videos (the last N entries).
          // videos is an array where order follows the playlist DOM order; to pick
          // from the oldest items we need to start at `videos.length - preferredCount`.
          videoIndex = videos.length - preferredCount + Math.floor(Math.random() * preferredCount);

          break;
        default:
          videoIndex = Math.floor(Math.random() * videos.length);
      }

      // Safety clamp in case of unexpected edge cases
      if (videoIndex < 0) videoIndex = 0;
      if (videoIndex >= videos.length) videoIndex = videos.length - 1;

      if (reload) {
        params.set('v', videos[videoIndex][0]);
        params.set('ytp-random', ytpRandom);
        params.delete('t');
        params.delete('index');
        params.delete('ytp-random-initial');
        window.location.href = `${window.location.pathname}?${params.toString()}`;
      } else {
        // Use the redirect() function for consistent navigation
        try {
          redirect(videos[videoIndex][0], params.get('list'), ytpRandom);
        } catch (error) {
          console.error(
            '[Play All] Error using redirect(), falling back to manual redirect:',
            error
          );
          // Fallback to manual redirect if the redirect() function fails
          const redirector = document.createElement('a');
          redirector.className = 'yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer';
          redirector.setAttribute('hidden', '');
          redirector.data = {
            commandMetadata: {
              webCommandMetadata: {
                url: `/watch?v=${videos[videoIndex][0]}&list=${params.get('list')}&ytp-random=${ytpRandom}`,
                webPageType: 'WEB_PAGE_TYPE_WATCH',
                rootVe: 3832,
              },
            },
            watchEndpoint: {
              videoId: videos[videoIndex][0],
              playlistId: params.get('list'),
            },
          };
          const listContainer = document.querySelector('ytd-playlist-panel-renderer #items');
          if (listContainer instanceof HTMLElement) {
            listContainer.append(redirector);
          } else {
            document.body.appendChild(redirector);
          }
          redirector.click();
        }
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
      if (playlistContainer.hasAttribute('ytp-random')) {
        return;
      }

      playlistContainer.setAttribute('ytp-random', 'applied');
      const headerContainer = playlistContainer.querySelector('.header');
      if (headerContainer) {
        headerContainer.insertAdjacentHTML(
          'afterend',
          `
                <div class="ytp-random-notice">
                    This playlist is using random play.<br>
                    The videos will <strong>not be played in the order</strong> listed here.
                </div>
            `
        );
      }

      const storage = getStorage();

      // Robustly collect playlist anchors - different YT layouts use different selectors
      const anchorSelectors = [
        '#wc-endpoint',
        'ytd-playlist-panel-video-renderer a#wc-endpoint',
        'ytd-playlist-panel-video-renderer a',
        'a#video-title',
        '#secondary ytd-playlist-panel-renderer a[href*="/watch?"]',
      ];

      const anchors = [];
      anchorSelectors.forEach(sel => {
        playlistContainer.querySelectorAll(sel).forEach(a => {
          if (a instanceof Element && a.tagName === 'A') anchors.push(/** @type {any} */ (a));
        });
      });

      // Deduplicate by href
      const uniq = [];
      const seen = new Set();
      anchors.forEach(a => {
        const href = a.href || a.getAttribute('href') || '';
        if (!seen.has(href)) {
          seen.add(href);
          uniq.push(a);
        }
      });

      const navigate = href => (window.location.href = href);

      uniq.forEach(element => {
        let videoId = null;
        try {
          videoId = new URL(element.href, window.location.origin).searchParams.get('v');
        } catch {
          videoId = new URLSearchParams(element.search || '').get('v');
        }

        if (!videoId) return;

        if (!isWatched(videoId)) {
          storage[videoId] = false;
        }

        // Ensure ytp-random param present
        try {
          const u = new URL(element.href, window.location.origin);
          u.searchParams.set('ytp-random', ytpRandom);
          element.href = u.toString();
        } catch {}

        // This bypasses the client side routing
        element.addEventListener('click', event => {
          event.preventDefault();
          navigate(element.href);
        });

        const entryKey = getVideoId(element.href);
        if (isWatched(entryKey)) {
          element.parentElement?.setAttribute('hidden', '');
        }
      });
      localStorage.setItem(getStorageKey(), JSON.stringify(storage));

      if (urlParams.get('ytp-random-initial') === '1' || isWatched(getVideoId(location.href))) {
        playNextRandom();

        return;
      }

      const header = playlistContainer.querySelector('h3 a');
      if (header && header.tagName === 'A') {
        const anchorHeader = /** @type {HTMLAnchorElement} */ (/** @type {unknown} */ (header));
        anchorHeader.innerHTML += ` <span class="ytp-badge ytp-random-badge">${ytpRandom} <span style="font-size: 2rem; vertical-align: top">&times;</span></span>`;
        anchorHeader.href = 'javascript:void(0)';
        const badge = anchorHeader.querySelector('.ytp-random-badge');
        if (badge) {
          badge.addEventListener('click', event => {
            event.preventDefault();

            localStorage.removeItem(getStorageKey());

            const params = new URLSearchParams(location.search);
            params.delete('ytp-random');
            window.location.href = `${window.location.pathname}?${params.toString()}`;
          });
        }
      }

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
        params.set('ytp-random', ytpRandom);
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

        const player = getPlayer();
        if (!player || typeof player.getProgressState !== 'function') {
          return;
        }

        const progressState = player.getProgressState();
        if (
          !progressState ||
          typeof progressState.current !== 'number' ||
          typeof progressState.duration !== 'number'
        ) {
          return;
        }

        // Do not listen for watch progress when watching advertisements
        if (!isAdPlaying()) {
          if (progressState.current / progressState.duration >= 0.9) {
            if (videoId) markWatched(videoId);
          }

          // Autoplay random video
          if (progressState.current >= progressState.duration - 2) {
            // make sure vanilla autoplay doesnt take over
            if (typeof player.pauseVideo === 'function') player.pauseVideo();
            if (typeof player.seekTo === 'function') player.seekTo(0);
            playNextRandom();
          }
        }

        const nextButton = document.querySelector(
          '#ytd-player .ytp-next-button.ytp-button:not([ytp-random="applied"])'
        );
        if (nextButton instanceof HTMLElement) {
          // Replace with span to prevent anchor click events
          const newButton = document.createElement('span');
          newButton.className = nextButton.className;
          newButton.innerHTML = nextButton.innerHTML;
          nextButton.replaceWith(newButton);

          newButton.setAttribute('ytp-random', 'applied');
          newButton.addEventListener('click', () => {
            if (videoId) markWatched(videoId);
            playNextRandom();
          });
        }
      }, 1000);
    };

    setInterval(applyRandomPlay, 1000);
  })();
})().catch(error =>
  console.error(
    '%cytp - YouTube Play All\n',
    'color: #bf4bcc; font-size: 32px; font-weight: bold',
    error
  )
);

// --- Zoom UI with wheel, pinch and keyboard support ---
const ZOOM_PAN_STORAGE_KEY = 'ytp_zoom_pan';
const RESTORE_LOG_KEY = 'ytp_zoom_restore_log'; // stored in sessionStorage for debugging
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.05;
// Fullscreen apply timing (ms) and retries — make configurable if needed
const FULLSCREEN_APPLY_DELAY = 80;
const FULLSCREEN_APPLY_RETRIES = 4;
const FULLSCREEN_APPLY_RETRY_DELAY = 120;

// Helpers for combined zoom+pan storage
function readZoomPan() {
  try {
    const raw = localStorage.getItem(ZOOM_PAN_STORAGE_KEY);
    if (!raw) return { zoom: DEFAULT_ZOOM, panX: 0, panY: 0 };
    const obj = JSON.parse(raw);
    const zoom = Number(obj && obj.zoom) || DEFAULT_ZOOM;
    const panX = Number(obj && obj.panX) || 0;
    const panY = Number(obj && obj.panY) || 0;
    return { zoom, panX, panY };
  } catch {
    return { zoom: DEFAULT_ZOOM, panX: 0, panY: 0 };
  }
}

function saveZoomPan(zoom, panX, panY) {
  try {
    const obj = {
      zoom: Number(zoom) || DEFAULT_ZOOM,
      panX: Number(panX) || 0,
      panY: Number(panY) || 0,
    };
    localStorage.setItem(ZOOM_PAN_STORAGE_KEY, JSON.stringify(obj));
  } catch {}
}

function logRestoreEvent(evt) {
  try {
    const entry = Object.assign({ time: new Date().toISOString() }, evt);
    try {
      const raw = sessionStorage.getItem(RESTORE_LOG_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      arr.push(entry);
      // keep last 200 entries
      if (arr.length > 200) arr.splice(0, arr.length - 200);
      sessionStorage.setItem(RESTORE_LOG_KEY, JSON.stringify(arr));
    } catch {
      // fallback: ignore
    }
    // Console output for live debugging
    console.warn('[YouTube+] Zoom restore:', entry);
  } catch {}
}

const findVideoElement = () => {
  const selectors = ['#movie_player video', 'video.video-stream', 'video'];
  for (const s of selectors) {
    const v = document.querySelector(s);
    if (v && v.tagName === 'VIDEO') return /** @type {HTMLVideoElement} */ (v);
  }
  return null;
};

// Transform tracking state (module scope so helpers can access it)
let _lastTransformApplied = '';
let _isApplyingTransform = false;

const applyZoomToVideo = (videoEl, zoom, panX = 0, panY = 0, skipTransformTracking = false) => {
  if (!videoEl) return;
  const container = videoEl.parentElement || videoEl;
  try {
    // Set flag to prevent observer loops
    if (!skipTransformTracking) {
      _isApplyingTransform = true;
    }

    // Ensure container can display overflow content
    container.style.overflow = 'visible';
    if (!container.style.position || container.style.position === 'static') {
      container.style.position = 'relative';
    }

    // Set transform origin to center for natural zoom
    videoEl.style.transformOrigin = 'center center';

    // Apply transform with proper precision
    const transformStr = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${zoom.toFixed(3)})`;
    videoEl.style.transform = transformStr;

    // Track the transform we just applied
    if (!skipTransformTracking) {
      _lastTransformApplied = transformStr;
    }

    // Use will-change for GPU acceleration
    videoEl.style.willChange = zoom !== 1 ? 'transform' : 'auto';

    // Smooth transition for better UX
    videoEl.style.transition = 'transform .08s ease-out';

    // Reset flag after a short delay
    if (!skipTransformTracking) {
      setTimeout(() => {
        _isApplyingTransform = false;
      }, 100);
    }
  } catch (e) {
    console.error('[YouTube+] applyZoomToVideo error:', e);
    _isApplyingTransform = false;
  }
};

function createZoomUI() {
  const player = document.querySelector('#movie_player');
  if (!player) return null;
  if (document.getElementById('ytp-zoom-control')) {
    return document.getElementById('ytp-zoom-control');
  }

  // styles (minimal)
  if (!document.getElementById('ytp-zoom-styles')) {
    const s = document.createElement('style');
    s.id = 'ytp-zoom-styles';
    s.textContent = `
      /* Compact control bar matching YouTube control style */
      #ytp-zoom-control{position: absolute; right: 12px; bottom: 64px; z-index: 2200; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 24px; background: rgba(0,0,0,0.35); color: #fff; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); backdrop-filter: blur(6px);}
      #ytp-zoom-control input[type=range]{width: 120px; -webkit-appearance: none; background: transparent; height: 24px;}
      /* WebKit track */
      #ytp-zoom-control input[type=range]::-webkit-slider-runnable-track{height: 4px; background: rgba(255,255,255,0.12); border-radius: 3px;}
      #ytp-zoom-control input[type=range]::-webkit-slider-thumb{-webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 6px rgba(255,255,255,0.06); margin-top: -4px;}
      /* Firefox */
      #ytp-zoom-control input[type=range]::-moz-range-track{height: 4px; background: rgba(255,255,255,0.12); border-radius: 3px;}
      #ytp-zoom-control input[type=range]::-moz-range-thumb{width: 12px; height: 12px; border-radius: 50%; background: #fff; border: none;}
      #ytp-zoom-control .zoom-label{min-width:36px;text-align:center;font-size:11px;padding:0 6px;user-select:none}
      #ytp-zoom-control::after{content:'Shift + Wheel to zoom';position:absolute;bottom:100%;right:0;padding:4px 8px;background:rgba(0,0,0,0.8);color:#fff;font-size:10px;border-radius:4px;white-space:nowrap;opacity:0;pointer-events:none;transform:translateY(4px);transition:opacity .2s,transform .2s}
      #ytp-zoom-control:hover::after{opacity:1;transform:translateY(-4px)}
      #ytp-zoom-control .zoom-reset{background: rgba(255,255,255,0.06); border: none; color: inherit; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer; width: 28px; height: 28px;}
      #ytp-zoom-control .zoom-reset:hover{background: rgba(255,255,255,0.12)}
      #ytp-zoom-control .zoom-reset svg{display:block;width:14px;height:14px}
      /* Hidden state to mirror YouTube controls autohide */
      #ytp-zoom-control.ytp-hidden{opacity:0;transform:translateY(6px);pointer-events:none}
      #ytp-zoom-control{transition:opacity .18s ease, transform .18s ease}
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  const wrap = document.createElement('div');
  wrap.id = 'ytp-zoom-control';

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(MIN_ZOOM);
  input.max = String(MAX_ZOOM);
  input.step = String(ZOOM_STEP);

  const label = document.createElement('div');
  label.className = 'zoom-label';
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  label.setAttribute('aria-label', 'Current zoom level');

  const reset = document.createElement('button');
  reset.className = 'zoom-reset';
  reset.type = 'button';
  reset.setAttribute('aria-label', 'Reset zoom');
  reset.title = 'Reset zoom';
  reset.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4V1l-5 5 5 5V7a7 7 0 1 1-7 7" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  `;

  wrap.appendChild(input);
  wrap.appendChild(label);
  wrap.appendChild(reset);

  let video = findVideoElement();
  const stored = readZoomPan().zoom;
  const initZoomVal = Number.isFinite(stored) && !Number.isNaN(stored) ? stored : DEFAULT_ZOOM;

  const setZoom = z => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(z)));
    input.value = String(clamped);
    const percentage = Math.round(clamped * 100);
    label.textContent = `${percentage}%`;
    label.setAttribute('aria-label', `Current zoom level ${percentage} percent`);

    if (video) {
      // clamp pan to new zoom limits
      clampPan(clamped);

      // Use RAF for smooth animation
      requestAnimationFrame(() => {
        try {
          applyZoomToVideo(video, clamped, panX, panY);
          // update cursor depending on zoom
          try {
            video.style.cursor = clamped > 1 ? 'grab' : '';
          } catch {}
        } catch (err) {
          console.error('[YouTube+] Apply zoom error:', err);
        }
      });
    }

    try {
      saveZoomPan(clamped, panX, panY);
    } catch (err) {
      console.error('[YouTube+] Save zoom error:', err);
    }
  };

  input.addEventListener('input', e => setZoom(e.target.value));
  reset.addEventListener('click', () => {
    try {
      panX = 0;
      panY = 0;
      setZoom(DEFAULT_ZOOM);
      // persist reset pan immediately
      try {
        // set via combined storage
        saveZoomPan(DEFAULT_ZOOM, 0, 0);
      } catch {}
      // Provide visual feedback
      reset.style.transform = 'scale(0.9)';
      setTimeout(() => {
        reset.style.transform = '';
      }, 150);
    } catch (err) {
      console.error('[YouTube+] Reset zoom error:', err);
    }
  });

  // Wheel: Shift + wheel to zoom (with throttling for performance)
  let wheelThrottleTimer = null;
  // Throttled pan save timer to avoid excessive localStorage writes
  let panSaveTimer = null;
  const scheduleSavePan = () => {
    try {
      if (panSaveTimer) clearTimeout(panSaveTimer);
      panSaveTimer = setTimeout(() => {
        try {
          const currentZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
          saveZoomPan(currentZoom, panX, panY);
        } catch (err) {
          console.error('[YouTube+] Save pan error:', err);
        }
        panSaveTimer = null;
      }, 220);
    } catch (err) {
      console.error('[YouTube+] Schedule save pan error:', err);
    }
  };
  const wheelHandler = ev => {
    try {
      if (!ev.shiftKey) return;
      ev.preventDefault();

      // Throttle wheel events to prevent excessive zoom changes
      if (wheelThrottleTimer) return;

      wheelThrottleTimer = setTimeout(() => {
        wheelThrottleTimer = null;
      }, 50); // 50ms throttle

      // Normalize wheel delta for consistent behavior across browsers
      const delta = ev.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const current = readZoomPan().zoom || DEFAULT_ZOOM;
      const newZoom = current + delta;

      // Only zoom if within bounds
      if (newZoom >= MIN_ZOOM && newZoom <= MAX_ZOOM) {
        setZoom(newZoom);
      }
    } catch (err) {
      console.error('[YouTube+] Wheel zoom error:', err);
    }
  };
  // Attach wheel handler to player and video (if present) so it works over controls
  player.addEventListener('wheel', wheelHandler, { passive: false });
  if (video) {
    try {
      video.addEventListener('wheel', wheelHandler, { passive: false });
    } catch (err) {
      console.error('[YouTube+] Failed to attach wheel handler to video:', err);
    }
  }

  // Keyboard +/- (ignore when typing)
  const keydownHandler = ev => {
    try {
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
      ) {
        return;
      }
      if (ev.key === '+' || ev.key === '=') {
        ev.preventDefault();
        const current = readZoomPan().zoom || DEFAULT_ZOOM;
        setZoom(Math.min(MAX_ZOOM, current + ZOOM_STEP));
      } else if (ev.key === '-') {
        ev.preventDefault();
        const current = readZoomPan().zoom || DEFAULT_ZOOM;
        setZoom(Math.max(MIN_ZOOM, current - ZOOM_STEP));
      }
    } catch {}
  };
  window.addEventListener('keydown', keydownHandler);

  // Pinch-to-zoom using Pointer Events
  // Panning (drag) state
  let panX = 0;
  let panY = 0;
  // Observer to watch for external changes to the video's style (YouTube may override transform)
  let videoStyleObserver = null;

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartPanX = 0;
  let dragStartPanY = 0;

  const clampPan = (zoom = readZoomPan().zoom) => {
    try {
      if (!video) return;
      const container = video.parentElement || video;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      if (!containerRect || containerRect.width === 0 || containerRect.height === 0) return;

      // Get actual video dimensions respecting aspect ratio
      const baseW = video.videoWidth || video.offsetWidth || containerRect.width;
      const baseH = video.videoHeight || video.offsetHeight || containerRect.height;

      // Validate dimensions
      if (!baseW || !baseH || !Number.isFinite(baseW) || !Number.isFinite(baseH)) return;

      // Calculate scaled dimensions
      const scaledW = baseW * zoom;
      const scaledH = baseH * zoom;

      // Calculate maximum pan distance (how far content can move)
      const maxX = Math.max(0, (scaledW - containerRect.width) / 2);
      const maxY = Math.max(0, (scaledH - containerRect.height) / 2);

      // Clamp pan values with validation
      if (Number.isFinite(maxX) && Number.isFinite(panX)) {
        panX = Math.max(-maxX, Math.min(maxX, panX));
      }
      if (Number.isFinite(maxY) && Number.isFinite(panY)) {
        panY = Math.max(-maxY, Math.min(maxY, panY));
      }
    } catch (err) {
      console.error('[YouTube+] Clamp pan error:', err);
    }
  };

  const pointers = new Map();
  let initialPinchDist = null;
  let pinchStartZoom = null;
  let prevTouchAction = null;
  const getDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const pointerDown = ev => {
    try {
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      try {
        ev.target.setPointerCapture(ev.pointerId);
      } catch {}
      // Start mouse drag for panning when single mouse pointer
      try {
        if (ev.pointerType === 'mouse' && ev.button === 0 && pointers.size <= 1 && video) {
          dragging = true;
          dragStartX = ev.clientX;
          dragStartY = ev.clientY;
          dragStartPanX = panX;
          dragStartPanY = panY;
          try {
            video.style.cursor = 'grabbing';
          } catch {}
        }
      } catch {}
      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        initialPinchDist = getDistance(pts[0], pts[1]);
        pinchStartZoom = readZoomPan().zoom;
        prevTouchAction = player.style.touchAction;
        try {
          player.style.touchAction = 'none';
        } catch {}
      }
    } catch {}
  };

  const pointerMove = ev => {
    try {
      // Update pointers map
      if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      // If dragging with mouse, pan the video
      if (dragging && ev.pointerType === 'mouse' && video) {
        const dx = ev.clientX - dragStartX;
        const dy = ev.clientY - dragStartY;
        // Movement should be independent of scale; adjust if desired
        panX = dragStartPanX + dx;
        panY = dragStartPanY + dy;
        // clamp pan to allowed bounds
        clampPan();
        applyZoomToVideo(video, parseFloat(input.value) || DEFAULT_ZOOM, panX, panY);
        // schedule persisting pan
        scheduleSavePan();
        ev.preventDefault();
        return;
      }

      // Pinch-to-zoom when two pointers
      if (pointers.size === 2 && initialPinchDist && pinchStartZoom != null) {
        const pts = Array.from(pointers.values());
        const dist = getDistance(pts[0], pts[1]);
        if (dist <= 0) return;
        const ratio = dist / initialPinchDist;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom * ratio));
        setZoom(newZoom);
        ev.preventDefault();
      }
    } catch {}
  };

  const pointerUp = ev => {
    try {
      pointers.delete(ev.pointerId);
      try {
        ev.target.releasePointerCapture(ev.pointerId);
      } catch {}
      // stop dragging
      try {
        if (dragging && ev.pointerType === 'mouse') {
          dragging = false;
          try {
            if (video) video.style.cursor = parseFloat(input.value) > 1 ? 'grab' : '';
          } catch {}
        }
      } catch {}
      if (pointers.size < 2) {
        initialPinchDist = null;
        pinchStartZoom = null;
        if (prevTouchAction != null) {
          try {
            player.style.touchAction = prevTouchAction;
          } catch {}
          prevTouchAction = null;
        }
      }
    } catch {}
  };

  player.addEventListener('pointerdown', pointerDown, { passive: true });
  player.addEventListener('pointermove', pointerMove, { passive: false });
  player.addEventListener('pointerup', pointerUp, { passive: true });
  player.addEventListener('pointercancel', pointerUp, { passive: true });

  // Fallback mouse handlers for more reliable dragging on desktop
  const mouseDownHandler = ev => {
    try {
      if (ev.button !== 0 || !video) return;
      dragging = true;
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
      dragStartPanX = panX;
      dragStartPanY = panY;
      try {
        video.style.cursor = 'grabbing';
      } catch {}
      ev.preventDefault();
    } catch {}
  };

  const mouseMoveHandler = ev => {
    try {
      if (!dragging || !video) return;

      const dx = ev.clientX - dragStartX;
      const dy = ev.clientY - dragStartY;
      panX = dragStartPanX + dx;
      panY = dragStartPanY + dy;
      clampPan();

      // Use RAF to avoid excessive repaints
      if (!video._panRAF) {
        video._panRAF = requestAnimationFrame(() => {
          applyZoomToVideo(video, parseFloat(input.value) || DEFAULT_ZOOM, panX, panY);
          // persist pan after RAF'd update
          scheduleSavePan();
          video._panRAF = null;
        });
      }

      ev.preventDefault();
    } catch (err) {
      console.error('[YouTube+] Mouse move error:', err);
    }
  };

  const mouseUpHandler = _ev => {
    try {
      if (dragging) {
        dragging = false;
        try {
          if (video) video.style.cursor = parseFloat(input.value) > 1 ? 'grab' : '';
        } catch {}
      }
    } catch {}
  };

  if (video) {
    try {
      video.addEventListener('mousedown', mouseDownHandler);
    } catch {}
    try {
      window.addEventListener('mousemove', mouseMoveHandler);
    } catch {}
    try {
      window.addEventListener('mouseup', mouseUpHandler);
    } catch {}
    // Attach style observer to ensure transform isn't clobbered by YouTube
    try {
      const attachStyleObserver = () => {
        try {
          if (videoStyleObserver) {
            try {
              videoStyleObserver.disconnect();
            } catch {}
            videoStyleObserver = null;
          }
          if (!video) return;
          videoStyleObserver = new MutationObserver(muts => {
            try {
              // Skip if we're currently applying a transform
              if (_isApplyingTransform) return;

              for (const m of muts) {
                if (m.type === 'attributes' && m.attributeName === 'style') {
                  // If transform has been changed externally, restore expected transform
                  const current = (video && video.style && video.style.transform) || '';
                  const expectedZoom =
                    readZoomPan().zoom || parseFloat(input.value) || DEFAULT_ZOOM;
                  const expected = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${expectedZoom.toFixed(3)})`;

                  // Only restore if transform was actually changed by YouTube (not by us)
                  // and the current zoom is not default
                  if (
                    expectedZoom !== DEFAULT_ZOOM &&
                    current !== expected &&
                    current !== _lastTransformApplied
                  ) {
                    // Reapply on next frame to minimize layout thrash
                    requestAnimationFrame(() => {
                      try {
                        applyZoomToVideo(video, expectedZoom, panX, panY);
                        try {
                          logRestoreEvent({
                            action: 'restore_transform',
                            currentTransform: current,
                            expectedTransform: expected,
                            zoom: expectedZoom,
                            panX,
                            panY,
                          });
                        } catch {}
                      } catch {}
                    });
                  }
                }
              }
            } catch {}
          });
          videoStyleObserver.observe(video, { attributes: true, attributeFilter: ['style'] });
        } catch {}
      };
      attachStyleObserver();
    } catch {}
  }

  // If video element is replaced by YouTube (e.g. fullscreen toggle or navigation), rebind handlers
  const playerObserver = new MutationObserver(() => {
    try {
      const newVideo = findVideoElement();
      if (newVideo && newVideo !== video) {
        // Remove listeners from old video
        try {
          if (video) {
            video.removeEventListener('mousedown', mouseDownHandler);
            video.removeEventListener('wheel', wheelHandler);
            if (video._panRAF) {
              cancelAnimationFrame(video._panRAF);
              video._panRAF = null;
            }
          }
        } catch (err) {
          console.error('[YouTube+] Error detaching from old video:', err);
        }

        // Update reference
        video = newVideo;

        // Reattach style observer for the new video element
        try {
          if (videoStyleObserver) {
            try {
              videoStyleObserver.disconnect();
            } catch {}
            videoStyleObserver = null;
          }
          if (video) {
            videoStyleObserver = new MutationObserver(muts => {
              try {
                // Skip if we're currently applying a transform
                if (_isApplyingTransform) return;

                for (const m of muts) {
                  if (m.type === 'attributes' && m.attributeName === 'style') {
                    const current = (video && video.style && video.style.transform) || '';
                    const expectedZoom =
                      readZoomPan().zoom || parseFloat(input.value) || DEFAULT_ZOOM;
                    const expected = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${expectedZoom.toFixed(3)})`;

                    // Only restore if transform was actually changed by YouTube (not by us)
                    // and the current zoom is not default
                    if (
                      expectedZoom !== DEFAULT_ZOOM &&
                      current !== expected &&
                      current !== _lastTransformApplied
                    ) {
                      requestAnimationFrame(() => {
                        try {
                          applyZoomToVideo(video, expectedZoom, panX, panY);
                          try {
                            logRestoreEvent({
                              action: 'restore_transform',
                              currentTransform: current,
                              expectedTransform: expected,
                              zoom: expectedZoom,
                              panX,
                              panY,
                            });
                          } catch {}
                        } catch {}
                      });
                    }
                  }
                }
              } catch {}
            });
            videoStyleObserver.observe(video, { attributes: true, attributeFilter: ['style'] });
          }
        } catch (err) {
          console.error('[YouTube+] Error attaching style observer to new video:', err);
        }

        // Reapply zoom to the new video
        try {
          const current = readZoomPan().zoom || DEFAULT_ZOOM;
          clampPan(current);
          applyZoomToVideo(video, current, panX, panY);
        } catch (err) {
          console.error('[YouTube+] Error applying zoom to new video:', err);
        }

        // Attach listeners to new video
        try {
          video.addEventListener('mousedown', mouseDownHandler);
        } catch (err) {
          console.error('[YouTube+] Error attaching mousedown to new video:', err);
        }
        try {
          video.addEventListener('wheel', wheelHandler, { passive: false });
        } catch (err) {
          console.error('[YouTube+] Error attaching wheel to new video:', err);
        }
      }
    } catch (err) {
      console.error('[YouTube+] Player observer error:', err);
    }
  });
  try {
    playerObserver.observe(player, { childList: true, subtree: true });
  } catch (err) {
    console.error('[YouTube+] Failed to observe player for video changes:', err);
  }

  // Reapply zoom on fullscreen change since layout may move elements.
  // Use a short timeout to allow YouTube to move/replace the video element
  // when entering/leaving fullscreen, and listen for vendor-prefixed events.
  const fullscreenHandler = () => {
    try {
      const current = readZoomPan().zoom || DEFAULT_ZOOM;
      // Attempt to find/apply multiple times — YouTube may move/replace the video element
      setTimeout(() => {
        try {
          let attempts = 0;
          const tryApply = () => {
            try {
              const newVideo = findVideoElement();
              let swapped = false;
              if (newVideo && newVideo !== video) {
                // detach from old video listeners safely
                try {
                  if (video) video.removeEventListener('wheel', wheelHandler);
                } catch {}

                video = newVideo;
                swapped = true;

                // Reattach wheel handler if needed
                try {
                  video.addEventListener('wheel', wheelHandler, { passive: false });
                } catch {}
              }

              clampPan(current);
              if (video) applyZoomToVideo(video, current, panX, panY);

              // If we didn't find/replace video yet, retry a few times
              if (!swapped && (!video || attempts < FULLSCREEN_APPLY_RETRIES)) {
                attempts += 1;
                setTimeout(tryApply, FULLSCREEN_APPLY_RETRY_DELAY);
              }
            } catch (e) {
              console.error('[YouTube+] Fullscreen apply attempt error:', e);
            }
          };
          tryApply();
        } catch (e) {
          console.error('[YouTube+] Fullscreen inner apply error:', e);
        }
      }, FULLSCREEN_APPLY_DELAY);
    } catch (err) {
      console.error('[YouTube+] Fullscreen handler error:', err);
    }
  };
  [
    'fullscreenchange',
    'webkitfullscreenchange',
    'mozfullscreenchange',
    'MSFullscreenChange',
  ].forEach(evt => document.addEventListener(evt, fullscreenHandler));

  // Apply initial zoom and attach UI
  // Restore stored pan values (if any) and clamp before applying zoom
  try {
    try {
      const s = readZoomPan();
      if (Number.isFinite(s.panX)) panX = s.panX;
      if (Number.isFinite(s.panY)) panY = s.panY;
      // Ensure pan is within limits for the initial zoom
      clampPan(initZoomVal);
    } catch (err) {
      console.error('[YouTube+] Restore pan error:', err);
    }
  } catch (err) {
    console.error('[YouTube+] Initial zoom setup error:', err);
  }

  // Initialize transform tracking with the initial state
  try {
    const initialTransform = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${initZoomVal.toFixed(3)})`;
    _lastTransformApplied = initialTransform;
  } catch {}

  setZoom(initZoomVal);
  // Position the zoom control above YouTube's bottom chrome (progress bar / controls).
  const updateZoomPosition = () => {
    try {
      const chrome = player.querySelector('.ytp-chrome-bottom');
      // If chrome exists, place the control just above it; otherwise keep the CSS fallback.
      if (chrome && chrome.offsetHeight) {
        const offset = chrome.offsetHeight + 8; // small gap above controls
        wrap.style.bottom = `${offset}px`;
      } else {
        // fallback to original design value
        wrap.style.bottom = '';
      }
    } catch {
      // ignore positioning errors
    }
  };

  // Initial position and reactive updates for fullscreen / resize / chrome changes
  updateZoomPosition();

  // Use a safe ResizeObserver callback that schedules the actual work on the
  // next animation frame. This reduces the chance of a "ResizeObserver loop
  // completed with undelivered notifications" error caused by synchronous
  // layout work inside the observer callback.
  const ro = new ResizeObserver(_entries => {
    try {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          try {
            updateZoomPosition();
          } catch (e) {
            try {
              YouTubeUtils &&
                YouTubeUtils.logError &&
                YouTubeUtils.logError('Enhanced', 'updateZoomPosition failed', e);
            } catch {}
          }
        });
      } else {
        // fallback
        updateZoomPosition();
      }
    } catch (e) {
      try {
        YouTubeUtils &&
          YouTubeUtils.logError &&
          YouTubeUtils.logError('Enhanced', 'ResizeObserver callback error', e);
      } catch {}
    }
  });

  // Register observer with cleanup manager so it gets disconnected on unload/cleanup
  try {
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.registerObserver(ro);
    }
  } catch {}

  try {
    const chromeEl = player.querySelector('.ytp-chrome-bottom');
    if (chromeEl) ro.observe(chromeEl);
  } catch (e) {
    try {
      YouTubeUtils &&
        YouTubeUtils.logError &&
        YouTubeUtils.logError('Enhanced', 'Failed to observe chrome element', e);
    } catch {}
  }

  // Keep a window resize listener for fallback positioning
  try {
    window.addEventListener('resize', updateZoomPosition);
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.registerListener(window, 'resize', updateZoomPosition);
    }
  } catch {}

  // Reposition on fullscreen changes (vendor-prefixed events included)
  [
    'fullscreenchange',
    'webkitfullscreenchange',
    'mozfullscreenchange',
    'MSFullscreenChange',
  ].forEach(evt => {
    try {
      document.addEventListener(evt, updateZoomPosition);
      if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
        YouTubeUtils.cleanupManager.registerListener(document, evt, updateZoomPosition);
      }
    } catch {}
  });

  player.appendChild(wrap);

  // Sync visibility with YouTube controls (autohide)
  const chromeBottom = player.querySelector('.ytp-chrome-bottom');
  const isControlsHidden = () => {
    try {
      // Player class flags
      if (
        player.classList.contains('ytp-autohide') ||
        player.classList.contains('ytp-hide-controls')
      ) {
        return true;
      }
      // Chrome bottom layer opacity/visibility
      if (chromeBottom) {
        const style = window.getComputedStyle(chromeBottom);
        if (
          style &&
          (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none')
        ) {
          return true;
        }
      }
    } catch {}
    return false;
  };

  const updateHidden = () => {
    try {
      if (isControlsHidden()) {
        wrap.classList.add('ytp-hidden');
      } else {
        wrap.classList.remove('ytp-hidden');
      }
    } catch {}
  };

  // Observe player class changes
  const visObserver = new MutationObserver(() => updateHidden());
  try {
    visObserver.observe(player, { attributes: true, attributeFilter: ['class', 'style'] });
    if (chromeBottom) {
      visObserver.observe(chromeBottom, { attributes: true, attributeFilter: ['class', 'style'] });
    }
  } catch {}

  // Temporary show on mousemove over player (like other controls)
  let showTimer = null;
  const mouseMoveShow = () => {
    try {
      wrap.classList.remove('ytp-hidden');
      if (showTimer) clearTimeout(showTimer);
      showTimer = setTimeout(updateHidden, 2200);
    } catch {}
  };
  player.addEventListener('mousemove', mouseMoveShow, { passive: true });
  // Initial sync
  updateHidden();

  // Cleanup
  const cleanup = () => {
    try {
      // Clear throttle timer
      if (wheelThrottleTimer) {
        clearTimeout(wheelThrottleTimer);
        wheelThrottleTimer = null;
      }

      // Clear pan save timer
      if (panSaveTimer) {
        clearTimeout(panSaveTimer);
        panSaveTimer = null;
      }

      // Cancel pending RAF
      if (video && video._panRAF) {
        cancelAnimationFrame(video._panRAF);
        video._panRAF = null;
      }

      // Remove all event listeners
      player.removeEventListener('wheel', wheelHandler);
      player.removeEventListener('pointerdown', pointerDown);
      player.removeEventListener('pointermove', pointerMove);
      player.removeEventListener('pointerup', pointerUp);
      player.removeEventListener('pointercancel', pointerUp);
      player.removeEventListener('mousemove', mouseMoveShow);
      window.removeEventListener('keydown', keydownHandler);

      if (video) {
        try {
          video.removeEventListener('mousedown', mouseDownHandler);
        } catch {}
        try {
          video.removeEventListener('wheel', wheelHandler);
        } catch {}
        try {
          window.removeEventListener('mousemove', mouseMoveHandler);
        } catch {}
        try {
          window.removeEventListener('mouseup', mouseUpHandler);
        } catch {}
        try {
          // Reset video styles
          video.style.cursor = '';
          video.style.transform = '';
          video.style.willChange = 'auto';
          video.style.transition = '';
        } catch {}
      }

      // Disconnect style observer
      if (videoStyleObserver) {
        try {
          videoStyleObserver.disconnect();
        } catch {}
        videoStyleObserver = null;
      }

      // Disconnect observer
      if (visObserver) {
        try {
          visObserver.disconnect();
        } catch {}
      }
      // Disconnect player mutation observer
      try {
        if (playerObserver) playerObserver.disconnect();
      } catch {}

      // Remove fullscreen handler
      try {
        document.removeEventListener('fullscreenchange', fullscreenHandler);
      } catch {}

      // Clear show timer
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }

      // Remove UI element
      wrap.remove();
    } catch (err) {
      console.error('[YouTube+] Cleanup error:', err);
    }
  };

  if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
    YouTubeUtils.cleanupManager.register(cleanup);
  }

  return wrap;
}

// Call this to initialize zoom (e.g. on page load / SPA navigation)
function initZoom() {
  try {
    const ensure = () => {
      const player = document.querySelector('#movie_player');
      if (!player) return setTimeout(ensure, 400);
      createZoomUI();
    };
    ensure();
    window.addEventListener('yt-navigate-finish', () => setTimeout(() => createZoomUI(), 300));
  } catch {
    console.error('initZoom error');
  }
}

// Ensure initZoom is used to avoid unused-var lint and to initialize feature
try {
  initZoom();
} catch {}
