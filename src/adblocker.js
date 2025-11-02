// Ad Blocker
(function () {
  'use strict';

  // Internationalization
  const i18n = {
    en: {
      adBlocker: 'Ad Blocker',
      adBlockerDescription: 'Skip ads and remove ad elements automatically',
    },
    ru: {
      adBlocker: 'Блокировщик рекламы',
      adBlockerDescription: 'Автоматически пропускать рекламу и удалять рекламные элементы',
    },
  };

  function getLanguage() {
    const lang = document.documentElement.lang || navigator.language || 'en';
    return lang.startsWith('ru') ? 'ru' : 'en';
  }

  function t(key) {
    const lang = getLanguage();
    return i18n[lang][key] || i18n.en[key] || key;
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
      cacheTimeout: 5000,
    },

    /**
     * Optimized CSS selectors for ad elements
     * @type {Object}
     */
    selectors: {
      ads: '#player-ads,.ytp-ad-module,.ad-showing,.ytp-ad-timed-pie-countdown-container,.ytp-ad-survey-questions',
      elements:
        '#masthead-ad,ytd-merch-shelf-renderer,.yt-mealbar-promo-renderer,ytmusic-mealbar-promo-renderer,ytmusic-statement-banner-renderer,.ytp-featured-product',
      video: 'video.html5-main-video',
      removal: 'ytd-reel-video-renderer .ytd-ad-slot-renderer',
    },

    /**
     * Settings management with localStorage persistence
     * @type {Object}
     */
    settings: {
      /**
       * Load settings from localStorage
       * @returns {void}
       */
      load() {
        try {
          const saved = localStorage.getItem(AdBlocker.config.storageKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            AdBlocker.config.enabled = parsed.enabled ?? true;
            AdBlocker.config.enableLogging = parsed.enableLogging ?? false;
          }
        } catch {
          // Silently fail if localStorage is unavailable
        }
      },

      /**
       * Save settings to localStorage
       * @returns {void}
       */
      save() {
        try {
          localStorage.setItem(
            AdBlocker.config.storageKey,
            JSON.stringify({
              enabled: AdBlocker.config.enabled,
              enableLogging: AdBlocker.config.enableLogging,
            })
          );
        } catch {
          // Silently fail if localStorage is unavailable
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
        } else if (typeof player.getVideoData === 'function') {
          const videoData = player.getVideoData();
          if (videoData?.video_id) {
            const currentTime = Math.floor(player.getCurrentTime?.() || 0);

            // Use most efficient skip method
            if (typeof player.loadVideoById === 'function') {
              player.loadVideoById(videoData.video_id, currentTime);
            }
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
        elements.forEach(el => el.closest('ytd-reel-video-renderer')?.remove());
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
