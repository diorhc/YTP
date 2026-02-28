// Ad Blocker
(function () {
  'use strict';

  // DOM cache helpers with fallback
  const $ = selector => {
    if (window.YouTubeDOMCache && typeof window.YouTubeDOMCache.get === 'function') {
      return window.YouTubeDOMCache.get(selector);
    }
    return document.querySelector(selector);
  };
  const $$ = selector => {
    if (window.YouTubeDOMCache && typeof window.YouTubeDOMCache.getAll === 'function') {
      return window.YouTubeDOMCache.getAll(selector);
    }
    return document.querySelectorAll(selector);
  };

  /**
   * Translation helper - uses centralized i18n system
   * @param {string} key - Translation key
   * @param {Object} params - Interpolation parameters
   * @returns {string} Translated string
   */
  function t(key, params = {}) {
    try {
      if (typeof window !== 'undefined') {
        if (window.YouTubePlusI18n && typeof window.YouTubePlusI18n.t === 'function') {
          return window.YouTubePlusI18n.t(key, params);
        }
        if (window.YouTubeUtils && typeof window.YouTubeUtils.t === 'function') {
          return window.YouTubeUtils.t(key, params);
        }
      }
    } catch {
      // Fallback to key if central i18n unavailable
    }
    return key;
  }

  /**
   * Ad blocking functionality for YouTube
   * @namespace AdBlocker
   */
  const AdBlocker = {
    /**
     * Configuration settings
     * @type {Object}
     */
    config: {
      skipInterval: 1000, // Combined ad-check interval (skip + remove + dismiss).
      removeInterval: 3000,
      enableLogging: false,
      maxRetries: 2,
      enabled: true,
      storageKey: 'youtube_adblocker_settings',
    },

    /**
     * Current state tracking
     * @type {Object}
     */
    state: {
      isYouTubeShorts: false,
      isYouTubeMusic: location.hostname === 'music.youtube.com',
      lastSkipAttempt: 0,
      retryCount: 0,
      initialized: false,
    },

    /**
     * Cached DOM queries for performance
     * @type {Object}
     */
    cache: {
      moviePlayer: null,
      ytdPlayer: null,
      lastCacheTime: 0,
      cacheTimeout: 10000, // Increased cache timeout for better performance
    },

    /**
     * Optimized CSS selectors for ad elements
     * @type {Object}
     */
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

    /**
     * Settings management with localStorage persistence
     * @type {Object}
     */
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
            console.warn('[AdBlocker] Invalid settings format');
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
          console.error('[AdBlocker] Error loading settings:', error);
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
          console.error('[AdBlocker] Error saving settings:', error);
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
        const skipSelectors = [
          '.ytp-ad-skip-button',
          '.ytp-ad-skip-button-modern',
          '.ytp-skip-ad-button',
          '.videoAdUiSkipButton',
          'button.ytp-ad-skip-button-modern',
          '.ytp-ad-skip-button-slot button',
          '.ytp-ad-skip-button-container button',
          '.ytp-ad-skip-button-modern .ytp-ad-skip-button-container',
          // 2025+ new skip button selectors
          '.ytp-skip-ad-button__text',
          'button[class*="skip"]',
          '.ytp-ad-skip-button-modern button',
          'ytd-button-renderer.ytp-ad-skip-button-renderer button',
        ];
        for (const sel of skipSelectors) {
          const skipButton = document.querySelector(sel);
          if (skipButton) {
            // offsetParent is null for position:fixed elements (YouTube skip buttons)
            // so use getBoundingClientRect width/height as the visibility check instead
            const rect = skipButton.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              skipButton.click();
              AdBlocker.state.retryCount = 0;
              return;
            }
          }
        }

        // Strategy 2: Speed through ad (mute + seek to end)
        const video = $(AdBlocker.selectors.video);
        if (video) {
          video.muted = true;
          // Attempt to seek to end of ad if duration is available
          if (video.duration && isFinite(video.duration) && video.duration > 0) {
            try {
              video.currentTime = Math.max(video.duration - 0.1, 0);
            } catch (e) {
              console.warn('[YouTube+] Ad seek error:', e);
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
      } catch {
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
          dialog.style.display = 'none';
          dialog.remove();
          return;
        }

        // Strategy 3: Handle overlay/backdrop that blocks interaction
        const overlays = document.querySelectorAll(
          'tp-yt-iron-overlay-backdrop, .yt-dialog-overlay'
        );
        for (const overlay of overlays) {
          if (overlay.style.display !== 'none' && overlay.offsetParent !== null) {
            overlay.style.display = 'none';
          }
        }
      } catch {
        // Silently ignore
      }
    },

    // Minimal CSS injection - only hide minor UI elements that YouTube doesn't monitor
    addCss() {
      if ($('#yt-ab-styles') || !AdBlocker.config.enabled) return;

      // Only use ads selectors (countdown, survey) in CSS
      // element selectors (masthead-ad, merch, etc.) are removed via DOM to avoid detection
      const styles = `${AdBlocker.selectors.ads}{display:none!important;}`;
      YouTubeUtils.StyleManager.add('yt-ab-styles', styles);
    },

    removeCss() {
      YouTubeUtils.StyleManager.remove('yt-ab-styles');
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
            } catch {}
          });
        } catch {}

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
            if (container && container.remove) container.remove();
          } catch (e) {
            if (AdBlocker.config.enableLogging) console.warn('[AdBlocker] removeElements error', e);
          }
        });
      };

      if (window.requestIdleCallback) {
        requestIdleCallback(remove, { timeout: 100 });
      } else {
        setTimeout(remove, 0);
      }
    },

    // Optimized settings UI
    addSettingsUI() {
      const section = $('.ytp-plus-settings-section[data-section="basic"]');
      if (!section || section.querySelector('.ab-settings')) return;

      try {
        const item = document.createElement('div');
        item.className = 'ytp-plus-settings-item ab-settings';
        item.innerHTML = `
          <div>
            <label class="ytp-plus-settings-item-label">${t('adBlocker')}</label>
            <div class="ytp-plus-settings-item-description">${t('adBlockerDescription')}</div>
          </div>
          <input type="checkbox" class="ytp-plus-settings-checkbox" ${AdBlocker.config.enabled ? 'checked' : ''}>
        `;

        section.appendChild(item);

        item.querySelector('input').addEventListener('change', e => {
          const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
          AdBlocker.config.enabled = target.checked;
          AdBlocker.settings.save();
          AdBlocker.config.enabled ? AdBlocker.addCss() : AdBlocker.removeCss();
        });
      } catch (error) {
        YouTubeUtils.logError('AdBlocker', 'Failed to add settings UI', error);
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
      // Use single combined interval instead of 3 separate ones
      const combinedAdCheck = () => {
        if (AdBlocker.config.enabled) {
          AdBlocker.skipAd();
          AdBlocker.removeElements();
          AdBlocker.dismissAdBlockerWarning();
        }
      };
      // Single interval for all ad-related checks (faster interval for responsive skip)
      const adInterval = setInterval(combinedAdCheck, AdBlocker.config.skipInterval);
      YouTubeUtils.cleanupManager.registerInterval(adInterval);

      // Also monitor video play events for immediate ad detection
      try {
        const handleVideoPlay = () => {
          if (AdBlocker.config.enabled) {
            setTimeout(AdBlocker.skipAd, 50);
            setTimeout(AdBlocker.skipAd, 200);
            setTimeout(AdBlocker.skipAd, 500);
          }
        };
        document.addEventListener('playing', handleVideoPlay, { capture: true, passive: true });
      } catch (e) {
        console.warn('[YouTube+] Ad play listener error:', e);
      }

      // Navigation handling
      const handleNavigation = () => {
        AdBlocker.state.isYouTubeShorts = location.pathname.startsWith('/shorts/');
        AdBlocker.cache.lastCacheTime = 0; // Reset cache
      };

      // Use centralized pushState/replaceState event from utils.js
      window.addEventListener('ytp-history-navigate', () => setTimeout(handleNavigation, 50));

      // Settings modal integration — use event instead of MutationObserver
      document.addEventListener('youtube-plus-settings-modal-opened', () => {
        setTimeout(AdBlocker.addSettingsUI, 50);
      });

      // Observe DOM for dynamically inserted ad slots and remove them
      // Use targeted observation rather than full subtree to reduce detection risk
      try {
        const adSlotObserver = new MutationObserver(mutations => {
          let shouldRemove = false;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (!(node instanceof Element)) continue;
              try {
                if (
                  node.matches &&
                  node.matches('ytd-ad-slot-renderer, ytd-merch-shelf-renderer')
                ) {
                  shouldRemove = true;
                  break;
                }
                if (node.querySelector && node.querySelector('ytd-ad-slot-renderer')) {
                  shouldRemove = true;
                  break;
                }
              } catch (e) {
                if (AdBlocker.config.enableLogging) {
                  console.warn('[AdBlocker] adSlotObserver node check', e);
                }
              }
            }
            if (shouldRemove) break;
          }
          if (shouldRemove) {
            AdBlocker.removeElements();
          }
        });

        // Observe only specific content containers, not the entire body
        const observeContentContainers = () => {
          const containers = [
            document.querySelector('#content'),
            document.querySelector('#page-manager'),
            document.querySelector('ytd-browse'),
            document.querySelector('ytd-search'),
          ].filter(Boolean);

          if (containers.length === 0) {
            // Fallback to body with reduced scope
            adSlotObserver.observe(document.body, { childList: true, subtree: true });
          } else {
            containers.forEach(container => {
              adSlotObserver.observe(container, { childList: true, subtree: true });
            });
          }
        };

        if (document.body) {
          observeContentContainers();
        } else {
          document.addEventListener('DOMContentLoaded', observeContentContainers);
        }

        // Register for cleanup
        YouTubeUtils.cleanupManager.registerObserver(adSlotObserver);
      } catch (e) {
        if (AdBlocker.config.enableLogging) {
          console.warn('[AdBlocker] Failed to create adSlotObserver', e);
        }
      }

      const clickHandler = e => {
        const target = /** @type {EventTarget & HTMLElement} */ (e.target);
        if (target.dataset?.section === 'basic') {
          setTimeout(AdBlocker.addSettingsUI, 25);
        }
      };
      YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, {
        passive: true,
        capture: true,
      });

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
