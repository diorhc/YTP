// Ad Blocker
(function () {
  'use strict';

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
      skipInterval: 500,
      removeInterval: 1500,
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
      ads: '#player-ads,.ytp-ad-module,.ad-showing,.ytp-ad-timed-pie-countdown-container,.ytp-ad-survey-questions,ytd-ad-slot-renderer',
      elements:
        '#masthead-ad,ytd-merch-shelf-renderer,.yt-mealbar-promo-renderer,ytmusic-mealbar-promo-renderer,ytmusic-statement-banner-renderer,.ytp-featured-product,ytd-ad-slot-renderer',
      video: 'video.html5-main-video',
      // Match both ad-slot renderers inside reels and standalone ad-slot-renderer nodes
      removal: 'ytd-reel-video-renderer .ytd-ad-slot-renderer, ytd-ad-slot-renderer',
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
        AdBlocker.cache.moviePlayer = document.querySelector('#movie_player');
        AdBlocker.cache.ytdPlayer = document.querySelector('#ytd-player');
        AdBlocker.cache.lastCacheTime = now;
      }

      const playerEl = AdBlocker.cache.ytdPlayer;
      return {
        element: AdBlocker.cache.moviePlayer,
        player: playerEl?.getPlayer?.() || playerEl,
      };
    },

    /**
     * Skip current ad by seeking to end
     * @returns {void}
     */
    skipAd() {
      if (!AdBlocker.config.enabled) return;

      const now = Date.now();
      if (now - AdBlocker.state.lastSkipAttempt < 300) return;
      AdBlocker.state.lastSkipAttempt = now;

      if (location.pathname.startsWith('/shorts/')) return;

      // Fast ad detection
      const adElement = document.querySelector(
        '.ad-showing, .ytp-ad-timed-pie-countdown-container'
      );
      if (!adElement) {
        AdBlocker.state.retryCount = 0;
        return;
      }

      try {
        const { player } = AdBlocker.getPlayer();
        if (!player) return;

        const video = document.querySelector(AdBlocker.selectors.video);

        // Mute ad immediately
        if (video) video.muted = true;

        // Skip logic based on platform
        if (AdBlocker.state.isYouTubeMusic && video) {
          /** @type {HTMLVideoElement} */ (video).currentTime = video.duration || 999;
        } else if (video) {
          // Safer ad skipping: speed up and seek to end
          // This avoids reloading the player which can cause 403 errors
          if (!isNaN(video.duration)) {
            video.currentTime = video.duration;
          }

          // Click skip button if available
          const skipButton = document.querySelector(
            '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .videoAdUiSkipButton'
          );
          if (skipButton) {
            skipButton.click();
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

    // Minimal CSS injection
    addCss() {
      if (document.querySelector('#yt-ab-styles') || !AdBlocker.config.enabled) return;

      // ✅ Use StyleManager instead of createElement('style')
      const styles = `${AdBlocker.selectors.ads},${AdBlocker.selectors.elements}{display:none!important;}`;
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

        // Collapse any empty wrappers that might remain (e.g. rows with removed items)
        try {
          const rowCandidates = document.querySelectorAll(
            'ytd-rich-grid-row, ytd-rich-grid-renderer, #contents > ytd-rich-item-renderer'
          );
          rowCandidates.forEach(row => {
            try {
              // If row has no meaningful visible children, remove it
              const visibleChildren = Array.from(row.children).filter(c => {
                if (!(c instanceof Element)) return false;
                const style = window.getComputedStyle(c);
                return (
                  style &&
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  c.offsetHeight > 0
                );
              });
              if (visibleChildren.length === 0) {
                row.remove();
              }
            } catch {
              // Silently ignore individual row removal failures
            }
          });
        } catch {
          // Silently ignore errors in row cleanup
        }
      };

      if (window.requestIdleCallback) {
        requestIdleCallback(remove, { timeout: 100 });
      } else {
        setTimeout(remove, 0);
      }
    },

    // Optimized settings UI
    addSettingsUI() {
      const section = document.querySelector('.ytp-plus-settings-section[data-section="basic"]');
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
      const skipInterval = setInterval(AdBlocker.skipAd, AdBlocker.config.skipInterval);
      const removeInterval = setInterval(AdBlocker.removeElements, AdBlocker.config.removeInterval);

      // ✅ Register intervals in cleanupManager
      YouTubeUtils.cleanupManager.registerInterval(skipInterval);
      YouTubeUtils.cleanupManager.registerInterval(removeInterval);

      // Navigation handling
      const handleNavigation = () => {
        AdBlocker.state.isYouTubeShorts = location.pathname.startsWith('/shorts/');
        AdBlocker.cache.lastCacheTime = 0; // Reset cache
      };

      // Override pushState for SPA navigation
      const originalPushState = history.pushState;
      history.pushState = function () {
        const result = originalPushState.apply(this, arguments);
        setTimeout(handleNavigation, 50);
        return result;
      };

      // Settings modal integration
      const settingsObserver = new MutationObserver(_mutations => {
        for (const { addedNodes } of _mutations) {
          for (const node of addedNodes) {
            if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
              setTimeout(AdBlocker.addSettingsUI, 50);
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

      // Observe DOM for dynamically inserted ad slots and remove them immediately
      try {
        const adSlotObserver = new MutationObserver(mutations => {
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (!(node instanceof Element)) continue;
              try {
                if (
                  node.matches &&
                  node.matches(
                    'ytd-ad-slot-renderer, ytd-reel-video-renderer, .ad-showing, .ytp-ad-module'
                  )
                ) {
                  AdBlocker.removeElements();
                  return;
                }
                if (
                  node.querySelector &&
                  node.querySelector('ytd-ad-slot-renderer, .ad-showing, .ytp-ad-module')
                ) {
                  AdBlocker.removeElements();
                  return;
                }
              } catch (e) {
                if (AdBlocker.config.enableLogging) {
                  console.warn('[AdBlocker] adSlotObserver node check', e);
                }
              }
            }
          }
        });

        if (document.body) {
          adSlotObserver.observe(document.body, { childList: true, subtree: true });
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            adSlotObserver.observe(document.body, { childList: true, subtree: true });
          });
        }

        // Register for cleanup
        YouTubeUtils.cleanupManager.registerObserver(adSlotObserver);
      } catch (e) {
        if (AdBlocker.config.enableLogging) {
          console.warn('[AdBlocker] Failed to create adSlotObserver', e);
        }
      }

      // ✅ Register global click listener in cleanupManager
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
