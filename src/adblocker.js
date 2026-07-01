// Ad Blocker — no canonical window symbol (self-initializing IIFE).
//
// Responsibility: hide promoted/ad elements in the YouTube player and
//   recommendation sidebar. Listens for DOM mutations and toggles a
//   CSS class on detected ad containers.
// Public surface: none (self-contained, no LazyLoader registration).
(function () {
  const setTimeout_ = setTimeout.bind(window);

  // Shared helpers from YouTubeUtils (canonical in utils.js)
  const U = window.YouTubeUtils;
  const adblockerLogger = U.logger || null;
  const $ = (/** @type {string} */ sel, /** @type {Document | Element} */ ctx = document) =>
    U.$(sel, ctx);

  /**
   * @typedef {{
   *   enableLogging: boolean,
   *   maxRetries: number,
   *   enabled: boolean,
   *   storageKey: string
   * }} AdBlockerConfig
   */

  /**
   * @typedef {{
   *   isYouTubeShorts: boolean,
   *   isYouTubeMusic: boolean,
   *   lastSkipAttempt: number,
   *   retryCount: number,
   *   initialized: boolean,
   *   moviePlayerSubId: string | null,
   *   adSlotSubId: string | null
   * }} AdBlockerState
   */

  /**
   * @typedef {{
   *   moviePlayer: Element | HTMLElement | null,
   *   ytdPlayer: Element | HTMLElement | null,
   *   lastCacheTime: number,
   *   cacheTimeout: number
   * }} AdBlockerCache
   */

  /**
   * @typedef {{
   *   ads: string,
   *   elements: string,
   *   video: string,
   *   removal: string
   * }} AdBlockerSelectors
   */

  /**
   * @typedef {{
   *   load: () => void,
   *   save: () => void
   * }} AdBlockerSettings
   */

  // Pre-built combined selector for all known skip buttons (cached at module level for performance)
  const SKIP_SELECTOR = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-skip-button-modern .ytp-ad-skip-button-container',
    '.ytp-skip-ad-button__text',
    'button[class*="skip"]',
    '.ytp-ad-skip-button-modern button',
    'ytd-button-renderer.ytp-ad-skip-button-renderer button',
  ].join(',');

  /**
   * Ad blocking functionality for YouTube
   * @namespace AdBlocker
   */
  const AdBlocker = {
    /** @type {AdBlockerConfig} */
    config: {
      enableLogging: false,
      maxRetries: 2,
      enabled: true,
      storageKey: 'youtube_adblocker_settings',
    },

    /** @type {AdBlockerState} */
    state: {
      isYouTubeShorts: false,
      isYouTubeMusic: location.hostname === 'music.youtube.com',
      lastSkipAttempt: 0,
      retryCount: 0,
      initialized: false,
      moviePlayerSubId: null,
      adSlotSubId: null,
    },

    /** @type {AdBlockerCache} */
    cache: {
      moviePlayer: null,
      ytdPlayer: null,
      lastCacheTime: 0,
      cacheTimeout: 10000, // Increased cache timeout for better performance
    },

    /** @type {AdBlockerSelectors} */
    selectors: {
      // Only hide minor ad UI elements that YouTube doesn't monitor
      ads: '.ytp-ad-timed-pie-countdown-container,.ytp-ad-survey-questions,.ytp-ad-overlay-container,.ytp-ad-progress,.ytp-ad-progress-list',
      // These are removed via DOM manipulation only (not CSS) to avoid detection
      elements:
        '#masthead-ad,ytd-merch-shelf-renderer,.yt-mealbar-promo-renderer,ytmusic-mealbar-promo-renderer,ytmusic-statement-banner-renderer,.ytp-featured-product,ytd-in-feed-ad-layout-renderer,ytd-banner-promo-renderer,ytd-statement-banner-renderer,ytd-brand-video-singleton-renderer,ytd-brand-video-shelf-renderer,ytd-promoted-sparkles-web-renderer,ytd-display-ad-renderer,ytd-promoted-video-renderer,.ytd-mealbar-promo-renderer',
      video: 'video.html5-main-video',
      // Match both ad-slot renderers inside reels and standalone ad-slot-renderer nodes
      removal:
        'ytd-reel-video-renderer .ytd-ad-slot-renderer, ytd-ad-slot-renderer, #player-ads, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ad-slot-renderer, ytd-player-legacy-desktop-watch-ads-renderer',
    },

    // Known item wrapper selectors that should be removed when they only contain ads
    wrappers: [
      'ytd-rich-item-renderer',
      'ytd-grid-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-rich-grid-media',
      'ytd-rich-shelf-renderer',
      'ytd-rich-grid-row',
      'ytd-video-renderer',
      'ytd-playlist-renderer',
      'ytd-reel-video-renderer',
    ],

    /** @type {AdBlockerSettings} */
    settings: {
      /**
       * Load settings from localStorage with validation
       * @returns {void}
       */
      load() {
        try {
          const saved = localStorage.getItem(AdBlocker.config.storageKey);
          if (!saved) return;

          const parsed = JSON.parse(saved);
          if (typeof parsed !== 'object' || parsed === null) {
            adblockerLogger?.warn?.('AdBlocker', 'Invalid settings format');
            return;
          }

          // Validate and apply settings
          if (typeof parsed.enabled === 'boolean') {
            AdBlocker.config.enabled = parsed.enabled;
          } else {
            AdBlocker.config.enabled = true; // Default to enabled
          }

          if (typeof parsed.enableLogging === 'boolean') {
            AdBlocker.config.enableLogging = parsed.enableLogging;
          } else {
            AdBlocker.config.enableLogging = false; // Default to disabled
          }
        } catch (error) {
          adblockerLogger?.error?.('AdBlocker', 'Error loading settings', error);
          // Set safe defaults on error
          AdBlocker.config.enabled = true;
          AdBlocker.config.enableLogging = false;
        }
      },

      /**
       * Save settings to localStorage with error handling
       * @returns {void}
       */
      save() {
        try {
          const settingsToSave = {
            enabled: AdBlocker.config.enabled,
            enableLogging: AdBlocker.config.enableLogging,
          };
          localStorage.setItem(AdBlocker.config.storageKey, JSON.stringify(settingsToSave));
        } catch (error) {
          adblockerLogger?.error?.('AdBlocker', 'Error saving settings', error);
        }
      },
    },

    /**
     * Get cached player elements
     * @returns {Object} Object containing player element and controller
     */
    getPlayer() {
      const now = Date.now();
      if (now - AdBlocker.cache.lastCacheTime > AdBlocker.cache.cacheTimeout) {
        AdBlocker.cache.moviePlayer = $('#movie_player');
        AdBlocker.cache.ytdPlayer = $('#ytd-player');
        AdBlocker.cache.lastCacheTime = now;
      }

      const playerEl = AdBlocker.cache.ytdPlayer;
      return {
        element: AdBlocker.cache.moviePlayer,
        player: playerEl?.getPlayer?.() || playerEl,
      };
    },

    /**
     * Skip current ad by clicking skip button or speeding through
     * Uses a stealthier approach to avoid YouTube ad blocker detection
     * @returns {void}
     */
    skipAd() {
      if (!AdBlocker.config.enabled) return;

      const now = Date.now();
      if (now - AdBlocker.state.lastSkipAttempt < 300) return;
      AdBlocker.state.lastSkipAttempt = now;

      if (location.pathname.startsWith('/shorts/')) return;

      // Check for ad-showing class on player
      const moviePlayer = $('#movie_player');
      const isAdShowing =
        moviePlayer &&
        (moviePlayer.classList.contains('ad-showing') ||
          moviePlayer.classList.contains('ad-interrupting'));
      if (!isAdShowing) {
        AdBlocker.state.retryCount = 0;
        return;
      }

      try {
        // Strategy 1: Click skip button if available (most natural user action)
        // Uses module-level cached SKIP_SELECTOR constant.
        // Batch getBoundingClientRect reads before any writes (clicks)
        // to avoid forced layout reflow per iteration.
        const skipButtons = document.querySelectorAll(SKIP_SELECTOR);
        const rects = Array.from(skipButtons, btn => btn.getBoundingClientRect());
        for (let i = 0; i < skipButtons.length; i++) {
          if (rects[i].width > 0 && rects[i].height > 0) {
            skipButtons[i].click();
            AdBlocker.state.retryCount = 0;
            return;
          }
        }

        // Strategy 2: Speed through ad (mute + seek to end)
        const video = $(AdBlocker.selectors.video);
        if (video) {
          video.muted = true;
          // Attempt to seek to end of ad if duration is available
          if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
            try {
              video.currentTime = Math.max(video.duration - 0.1, 0);
            } catch (e) {
              adblockerLogger?.warn?.('AdBlocker', 'Ad seek error', e);
            }
          }
        }

        // Strategy 3: Close overlay ads
        const overlaySelectors = [
          '.ytp-ad-overlay-close-button',
          '.ytp-ad-overlay-close-container button',
          '.ytp-ad-overlay-close-button button',
          // 2025+ overlay close
          '.ytp-ad-overlay-ad-info-button-container',
          'button[id="dismiss-button"]',
        ];
        for (const sel of overlaySelectors) {
          const overlayClose = $(sel);
          if (overlayClose) {
            overlayClose.click();
            break;
          }
        }

        AdBlocker.state.retryCount = 0;
      } catch (_e) {
        if (AdBlocker.state.retryCount < AdBlocker.config.maxRetries) {
          AdBlocker.state.retryCount++;
          setTimeout(AdBlocker.skipAd, 800);
        }
      }
    },

    /**
     * Dismiss YouTube's ad blocker warning popup if detected
     * @returns {void}
     */
    dismissAdBlockerWarning() {
      if (!AdBlocker.config.enabled) return;
      try {
        // Strategy 1: Handle the enforcement message overlay
        const enforcement = document.querySelector('ytd-enforcement-message-view-model');
        if (enforcement) {
          // Find any dismiss/close/allow button
          const btns = enforcement.querySelectorAll(
            'button, tp-yt-paper-button, a.yt-spec-button-shape-next--outline'
          );
          for (const btn of btns) {
            const btnText = (btn.textContent || '').toLowerCase().trim();
            // Click "Allow YouTube ads", "Dismiss", or the X button
            if (
              btnText.includes('allow') ||
              btnText.includes('dismiss') ||
              btnText.includes('разрешить') ||
              btn.getAttribute('aria-label')?.includes('close')
            ) {
              btn.click();
              return;
            }
          }
          // If no matching button, try removing the overlay
          enforcement.remove();
          return;
        }

        // Strategy 2: Handle paper dialog popups
        const dialogs = document.querySelectorAll(
          'tp-yt-paper-dialog, ytd-popup-container tp-yt-paper-dialog, yt-dialog-container'
        );
        for (const dialog of dialogs) {
          const text = (dialog.textContent || '').toLowerCase();
          const isAdBlockWarning =
            text.includes('ad blocker') ||
            text.includes('ad blockers') ||
            text.includes('блокировщик') ||
            text.includes('will be blocked') ||
            text.includes('будет заблокирован') ||
            (text.includes('allow') && text.includes('ads')) ||
            (text.includes('blocker') && text.includes('video'));

          if (!isAdBlockWarning) continue;

          // Try dismiss/allow buttons
          const dismissBtns = dialog.querySelectorAll(
            '#dismiss-button button, .dismiss-button, button[id*="dismiss"], ' +
              'tp-yt-paper-button, yt-button-renderer button, a[href]'
          );
          for (const btn of dismissBtns) {
            const btnText = (btn.textContent || '').toLowerCase();
            if (
              btnText.includes('dismiss') ||
              btnText.includes('allow') ||
              btnText.includes('not using') ||
              btnText.includes('report')
            ) {
              btn.click();
              return;
            }
          }
          // Last resort: remove dialog
          /** @type {any} */ (dialog).style.display = 'none';
          dialog.remove();
          return;
        }

        // Strategy 3: Handle overlay/backdrop that blocks interaction
        const overlays = document.querySelectorAll(
          'tp-yt-iron-overlay-backdrop, .yt-dialog-overlay'
        );
        for (const overlay of overlays) {
          if (
            /** @type {any} */ (overlay).style.display !== 'none' &&
            overlay.offsetParent !== null
          ) {
            /** @type {any} */ (overlay).style.display = 'none';
          }
        }
      } catch (_e) {
        // Silently ignore
      }
    },

    // Minimal CSS injection - only hide minor UI elements that YouTube doesn't monitor
    addCss() {
      if ($('#yt-ab-styles') || !AdBlocker.config.enabled) return;

      // Only use ads selectors (countdown, survey) in CSS
      // element selectors (masthead-ad, merch, etc.) are removed via DOM to avoid detection
      const styles = `${AdBlocker.selectors.ads}{display:none!important;}`;
      const SM = YouTubeUtils?.StyleManager;
      if (SM && typeof SM.add === 'function') {
        SM.add('yt-ab-styles', styles);
      }
    },

    removeCss() {
      const SM = YouTubeUtils?.StyleManager;
      if (SM && typeof SM.remove === 'function') {
        SM.remove('yt-ab-styles');
      }
    },

    // Batched element removal
    removeElements() {
      if (!AdBlocker.config.enabled || AdBlocker.state.isYouTubeMusic) return;

      // Use requestIdleCallback for non-blocking removal
      const remove = () => {
        // Remove known ad elements directly (these were previously in CSS)
        try {
          const adElements = document.querySelectorAll(AdBlocker.selectors.elements);
          adElements.forEach(el => {
            try {
              el.remove();
            } catch (_e) {
              U.logSuppressed(_e, 'AdBlocker');
            }
          });
        } catch (_e) {
          U.logSuppressed(_e, 'AdBlocker');
        }

        // Remove ad-slot renderers
        const elements = document.querySelectorAll(AdBlocker.selectors.removal);
        elements.forEach(el => {
          try {
            // Prefer removing a known item wrapper (thumbnail card, reel item, etc.)
            for (const w of AdBlocker.wrappers) {
              const wrap = el.closest(w);
              if (wrap) {
                wrap.remove();
                return;
              }
            }

            // If ad is inside a reel item specifically, remove the reel container
            const reel = el.closest('ytd-reel-video-renderer');
            if (reel) {
              reel.remove();
              return;
            }

            // If standalone ad-slot-renderer or other ad container, remove the nearest reasonable container
            const container =
              el.closest('ytd-ad-slot-renderer') || el.closest('.ad-container') || el;
            if (container?.remove) {
              container.remove();
            }
          } catch (e) {
            if (AdBlocker.config.enableLogging) {
              adblockerLogger?.warn?.('AdBlocker', 'removeElements error', e);
            }
          }
        });
      };

      const ric = /** @type {any} */ (window).requestIdleCallback;
      if (typeof ric === 'function') {
        ric(remove, { timeout: 100 });
      } else {
        setTimeout(remove, 0);
      }
    },

    // Attach change handler to the static checkbox in settings modal
    attachSettingsHandler() {
      try {
        const checkbox = document.getElementById('ytp-plus-setting-enableAdBlocker');
        if (!(checkbox instanceof HTMLInputElement)) return;
        if (checkbox.dataset.handlerAttached) return;
        checkbox.dataset.handlerAttached = 'true';
        checkbox.checked = AdBlocker.config.enabled;
        checkbox.addEventListener('change', (/** @type {Event} */ e) => {
          const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
          AdBlocker.config.enabled = target.checked;
          AdBlocker.settings.save();
          AdBlocker.config.enabled ? AdBlocker.addCss() : AdBlocker.removeCss();
        });
      } catch (_e) {
        // non-critical
      }
    },

    // Streamlined initialization
    init() {
      if (AdBlocker.state.initialized) return;
      AdBlocker.state.initialized = true;

      AdBlocker.settings.load();

      if (AdBlocker.config.enabled) {
        AdBlocker.addCss();
        AdBlocker.removeElements();
      }

      // Start optimized intervals with cleanup registration
      // P7: Cache movie_player reference to avoid 4+ redundant DOM queries per check cycle
      /** @type {Element | null} */
      let _cachedMoviePlayer = null;
      let _mpCacheTs = 0;
      const _MP_CACHE_TTL = 5000; // 5 seconds

      const getCachedMoviePlayer = () => {
        const now = Date.now();
        if (!_cachedMoviePlayer || now - _mpCacheTs > _MP_CACHE_TTL) {
          _cachedMoviePlayer = $('#movie_player');
          _mpCacheTs = now;
        }
        return _cachedMoviePlayer;
      };

      // Guard: only run heavy DOM queries if an ad is actually showing
      const isAdActive = () => {
        const mp = getCachedMoviePlayer();
        return (
          mp && (mp.classList.contains('ad-showing') || mp.classList.contains('ad-interrupting'))
        );
      };

      const combinedAdCheck = () => {
        if (!AdBlocker.config.enabled) return;
        if (isAdActive()) {
          AdBlocker.skipAd();
          AdBlocker.dismissAdBlockerWarning();
        }
      };

      // Primary: MutationObserver on #movie_player class attribute (event-driven, no polling)
      // Primary: coordinator watcher on #movie_player class attribute (event-driven, no polling)
      try {
        const attachAdObserver = () => {
          const coordinator = window.YouTubePlusMutationCoordinator;
          if (!coordinator?.watchTarget) return;

          const moviePlayer = $('#movie_player');
          if (!moviePlayer) {
            // Retry once after short delay if player not yet in DOM
            setTimeout_(attachAdObserver, 1500);
            return;
          }

          if (AdBlocker.state.moviePlayerSubId) {
            coordinator.unwatch(AdBlocker.state.moviePlayerSubId);
          }
          AdBlocker.state.moviePlayerSubId = 'adblocker::moviePlayerClass';

          coordinator.watchTarget(
            AdBlocker.state.moviePlayerSubId,
            moviePlayer,
            () => {
              if (AdBlocker.config.enabled && isAdActive()) {
                AdBlocker.skipAd();
                AdBlocker.dismissAdBlockerWarning();
              }
            },
            { attributes: true, childList: false, subtree: false, attributeFilter: ['class'] }
          );

          if (YouTubeUtils.cleanupManager?.register) {
            YouTubeUtils.cleanupManager.register(() => {
              if (AdBlocker.state.moviePlayerSubId) {
                coordinator.unwatch(AdBlocker.state.moviePlayerSubId);
                AdBlocker.state.moviePlayerSubId = null;
              }
            });
          }
        };
        attachAdObserver();
      } catch (e) {
        adblockerLogger?.warn?.('AdBlocker', 'Ad observer setup error', e);
      }

      // Also monitor video play events for immediate ad detection
      try {
        const handleVideoPlay = () => {
          if (AdBlocker.config.enabled) {
            // Single delayed check — MutationObserver handles fast detection
            setTimeout(combinedAdCheck, 100);
          }
        };
        if (YouTubeUtils.cleanupManager?.registerListener) {
          YouTubeUtils.cleanupManager.registerListener(document, 'playing', handleVideoPlay, {
            capture: true,
            passive: true,
          });
        } else {
          document.addEventListener('playing', handleVideoPlay, { capture: true, passive: true });
        }
      } catch (e) {
        adblockerLogger?.warn?.('AdBlocker', 'Ad play listener error', e);
      }

      // Navigation handling — also run removeElements on page transitions
      const handleNavigation = () => {
        AdBlocker.state.isYouTubeShorts = location.pathname.startsWith('/shorts/');
        AdBlocker.cache.lastCacheTime = 0; // Reset cache
        if (AdBlocker.config.enabled) AdBlocker.removeElements();
      };

      // Use centralized pushState/replaceState event from utils.js
      const navHandler = () => setTimeout(handleNavigation, 50);
      if (YouTubeUtils.cleanupManager?.registerListener) {
        YouTubeUtils.cleanupManager.registerListener(window, 'ytp-history-navigate', navHandler);
      } else {
        window.addEventListener('ytp-history-navigate', navHandler);
      }

      // Settings modal integration — attach handler to static checkbox
      const settingsHandler = () => {
        setTimeout(AdBlocker.attachSettingsHandler, 50);
      };
      if (YouTubeUtils.cleanupManager?.registerListener) {
        YouTubeUtils.cleanupManager.registerListener(
          document,
          'youtube-plus-settings-modal-opened',
          settingsHandler
        );
      } else {
        document.addEventListener('youtube-plus-settings-modal-opened', settingsHandler);
      }

      // Observe DOM for dynamically inserted ad slots and remove them
      // Use coordinator root subscription with selector filtering.
      try {
        const coordinator = window.YouTubePlusMutationCoordinator;
        if (coordinator?.subscribeRoot) {
          if (AdBlocker.state.adSlotSubId) {
            coordinator.unsubscribe(AdBlocker.state.adSlotSubId);
          }
          AdBlocker.state.adSlotSubId = 'adblocker::adSlots';
          coordinator.subscribeRoot(
            AdBlocker.state.adSlotSubId,
            () => {
              AdBlocker.removeElements();
            },
            {
              selector:
                'ytd-ad-slot-renderer, ytd-merch-shelf-renderer, #player-ads, ad-slot-renderer',
              childList: true,
              attributes: false,
              subtree: true,
            }
          );
          if (YouTubeUtils.cleanupManager?.register) {
            YouTubeUtils.cleanupManager.register(() => {
              if (AdBlocker.state.adSlotSubId) {
                coordinator.unsubscribe(AdBlocker.state.adSlotSubId);
                AdBlocker.state.adSlotSubId = null;
              }
            });
          }
        }
      } catch (e) {
        if (AdBlocker.config.enableLogging) {
          adblockerLogger?.warn?.('AdBlocker', 'Failed to create adSlotObserver', e);
        }
      }

      // Initial skip attempt
      if (AdBlocker.config.enabled) {
        setTimeout(AdBlocker.skipAd, 200);
        // Also check for ad blocker warning popup
        setTimeout(AdBlocker.dismissAdBlockerWarning, 500);
      }
    },
  };

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', AdBlocker.init, { once: true });
  } else {
    AdBlocker.init();
  }
})();
