// Ad Blocker
(function () {
  'use strict';

  // Use centralized i18n where available
  const _globalI18n =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;
  /**
   * Translation helper that falls back to local formatting when i18n isn't available
   * @param {string} key - Translation key or fallback string
   * @param {Object} [params={}] - Template parameters to replace in the string
   * @returns {string} Localized string or formatted fallback
   */
  const t = (key, params = {}) => {
    try {
      if (_globalI18n && typeof _globalI18n.t === 'function') return _globalI18n.t(key, params);
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.t === 'function'
      ) {
        return window.YouTubeUtils.t(key, params);
      }
    } catch {
      // fallback
    }
    if (!key || typeof key !== 'string') return '';
    if (Object.keys(params).length === 0) return key;
    let result = key;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
  };

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
       * Load settings from localStorage with validation
       * @returns {void}
       */
      load() {
        try {
          const saved = localStorage.getItem(AdBlocker.config.storageKey);
          if (!saved) return;

          const parsed = JSON.parse(saved);
          if (typeof parsed !== 'object' || parsed === null) {
            console.warn('[YouTube+][AdBlocker]', 'Invalid settings format');
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
          console.error('[YouTube+][AdBlocker]', 'Error loading settings:', error);
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
          console.error('[YouTube+][AdBlocker]', 'Error saving settings:', error);
        }
      },
    },

    /**
     * Get cached player elements
     * @returns {Object} Object containing player element and controller
     */
    /**
     * Get cached player elements
     * @returns {{element: Element|null, player: any}} Object containing player element and controller
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
    /**
     * Skip current ad by seeking to its end or by using player APIs when available
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
    /**
     * Inject minimal CSS rules to hide known ad elements
     * Uses the project's StyleManager to avoid duplicate style tags
     * @returns {void}
     */
    addCss() {
      if (document.querySelector('#yt-ab-styles') || !AdBlocker.config.enabled) return;

      // ✅ Use StyleManager instead of createElement('style')
      const styles = `${AdBlocker.selectors.ads},${AdBlocker.selectors.elements}{display:none!important;}`;
      YouTubeUtils.StyleManager.add('yt-ab-styles', styles);
    },

    /**
     * Remove injected ad blocking CSS rules
     * @returns {void}
     */
    removeCss() {
      YouTubeUtils.StyleManager.remove('yt-ab-styles');
    },

    // Batched element removal
    /**
     * Remove ad-related DOM elements in a batched, non-blocking way
     * Uses requestIdleCallback when available or setTimeout as a fallback
     * @returns {void}
     */
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
    /**
     * Inject a settings UI entry into the extension's settings modal
     * Adds a toggle checkbox wired to AdBlocker.config.enabled
     * @returns {void}
     */
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
          const { target } = e;
          const input = /** @type {EventTarget & HTMLInputElement} */ (target);
          const { checked } = input;
          AdBlocker.config.enabled = checked;
          AdBlocker.settings.save();
          AdBlocker.config.enabled ? AdBlocker.addCss() : AdBlocker.removeCss();
        });
      } catch (error) {
        YouTubeUtils.logError('AdBlocker', 'Failed to add settings UI', error);
      }
    },

    // Streamlined initialization
    /**
     * Initialize the AdBlocker module: load settings, apply CSS, register intervals
     * and observers, and register cleanup handlers with YouTubeUtils.cleanupManager
     * @returns {void}
     */
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
      history.pushState = function (...args) {
        const result = originalPushState.call(this, ...args);
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
        const { target } = /** @type {{ target: EventTarget & HTMLElement }} */ (e);
        if (target?.dataset?.section === 'basic') {
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
