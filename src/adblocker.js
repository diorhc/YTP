// Ad Blocker.
//
// Responsibility: hide promoted/ad elements in the YouTube player and
//   recommendation sidebar. Listens for DOM mutations and toggles a
//   CSS class on detected ad containers.
// Public surface: window.YouTubePlusAdBlocker.
(function () {
  // Shared helpers from YouTubeUtils.
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'AdBlocker');

  const adblockerLogger = U.logger || null;
  const $ = (/** @type {string} */ sel, /** @type {Document | Element} */ ctx = document) =>
    U.$(sel, ctx);

  /** Module namespace in the shared settings blob. */
  const MODULE_NAME = 'adblocker';

  /** @returns {YouTubePlusSettingsStore | null} the store when the blob bridge is active */
  const bridgedStore = () => window.YouTubePlusSettingsStore?.moduleBridge?.() ?? null;

  /** @type {YouTubePlusFeatureContext | null} */
  let adblockerCtx = null;

  /**
   * @typedef {{
   *   enableLogging: boolean,
   *   storageKey: string
   * }} AdBlockerConfig
   */

  /**
   * @typedef {{
   *   isYouTubeMusic: boolean,
   *   lastSkipAttempt: number,
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
   *   readLegacy: () => Record<string, unknown> | null,
   *   assign: (parsed: Record<string, unknown> | null) => void,
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

  /** Click the first visible skip button; a natural user action. */
  const clickVisibleSkipButton = () => {
    // Batch getBoundingClientRect reads before any writes (clicks)
    // to avoid forced layout reflow per iteration.
    const skipButtons = document.querySelectorAll(SKIP_SELECTOR);
    const rects = Array.from(skipButtons, btn => btn.getBoundingClientRect());
    for (let i = 0; i < skipButtons.length; i++) {
      if (rects[i].width > 0 && rects[i].height > 0) {
        /** @type {HTMLElement} */ (skipButtons[i]).click();
        return true;
      }
    }
    return false;
  };

  /** Mute the ad media and seek to its end. */
  const seekThroughAd = () => {
    const video = /** @type {HTMLVideoElement | null} */ ($(AdBlocker.selectors.video));
    if (video) {
      video.muted = true;
      // Attempt to seek to end of ad if duration is available
      if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
        // The ad media can refuse seeks while it is unseekable.
        try {
          video.currentTime = Math.max(video.duration - 0.1, 0);
        } catch (e) {
          logS(e);
          adblockerLogger?.warn?.('AdBlocker', 'Ad seek error', e);
        }
      }
    }
  };

  /** Click the first available ad-overlay close control. */
  const closeAdOverlay = () => {
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
        /** @type {HTMLElement} */ (overlayClose).click();
        return;
      }
    }
  };

  /** Click a dismissal control on the enforcement overlay, else remove it. */
  const dismissEnforcementOverlay = () => {
    const enforcement = document.querySelector('ytd-enforcement-message-view-model');
    if (!enforcement) return false;
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
        /** @type {HTMLElement} */ (btn).click();
        return true;
      }
    }
    // If no matching button, try removing the overlay
    enforcement.remove();
    return true;
  };

  /** Recognize the ad-blocker warning dialogs by their visible text. */
  const isAdBlockerWarningText = (/** @type {string} */ text) =>
    text.includes('ad blocker') ||
    text.includes('ad blockers') ||
    text.includes('блокировщик') ||
    text.includes('will be blocked') ||
    text.includes('будет заблокирован') ||
    (text.includes('allow') && text.includes('ads')) ||
    (text.includes('blocker') && text.includes('video'));

  /** Dismiss the paper-dialog ad-blocker warning, else hide and remove it. */
  const dismissWarningDialog = () => {
    const dialogs = document.querySelectorAll(
      'tp-yt-paper-dialog, ytd-popup-container tp-yt-paper-dialog, yt-dialog-container'
    );
    for (const dialog of dialogs) {
      const text = (dialog.textContent || '').toLowerCase();
      if (!isAdBlockerWarningText(text)) continue;

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
          /** @type {HTMLElement} */ (btn).click();
          return true;
        }
      }
      // Last resort: remove dialog
      /** @type {HTMLElement} */ (dialog).style.display = 'none';
      dialog.remove();
      return true;
    }
    return false;
  };

  /** Show through overlay backdrops YouTube leaves blocking interaction. */
  const hideBlockerBackdrops = () => {
    const overlays = /** @type {NodeListOf<HTMLElement>} */ (
      document.querySelectorAll('tp-yt-iron-overlay-backdrop, .yt-dialog-overlay')
    );
    for (const overlay of overlays) {
      if (overlay.style.display !== 'none' && overlay.offsetParent !== null) {
        overlay.style.display = 'none';
      }
    }
  };

  /**
   * Ad blocking functionality for YouTube
   * @namespace AdBlocker
   */
  const AdBlocker = {
    /** @type {AdBlockerConfig} */
    config: {
      enableLogging: false,
      storageKey: 'youtube_adblocker_settings',
    },

    /** @type {AdBlockerState} */
    state: {
      isYouTubeMusic: location.hostname === 'music.youtube.com',
      lastSkipAttempt: 0,
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
       * Read and validate the legacy key payload. Returns null when it is
       * absent or unusable so the live config is left untouched.
       * @returns {Record<string, unknown> | null}
       */
      readLegacy() {
        try {
          const saved = U.storage?.getItem(AdBlocker.config.storageKey);
          if (!saved) return null;
          const parsed = JSON.parse(saved);
          if (typeof parsed !== 'object' || parsed === null) {
            adblockerLogger?.warn?.('AdBlocker', 'Invalid settings format');
            return null;
          }
          return /** @type {Record<string, unknown>} */ (parsed);
        } catch (error) {
          logS(error);
          adblockerLogger?.error?.('AdBlocker', 'Error loading settings', error);
          // Safe defaults on corrupt storage.
          return {};
        }
      },

      /**
       * Apply a settings object to the live config, filling absent fields.
       * @param {Record<string, unknown> | null} parsed
       */
      assign(parsed) {
        if (parsed === null) return;
        AdBlocker.config.enableLogging =
          typeof parsed.enableLogging === 'boolean' ? parsed.enableLogging : false;
      },

      load() {
        const store = bridgedStore();
        if (store) {
          const mod = store.getModuleSettings(MODULE_NAME);
          if (mod && Object.keys(mod).length) {
            AdBlocker.settings.assign(mod);
            return;
          }
          AdBlocker.settings.assign(AdBlocker.settings.readLegacy());
          AdBlocker.settings.save();
          return;
        }
        AdBlocker.settings.assign(AdBlocker.settings.readLegacy());
      },

      save() {
        const payload = {
          enableLogging: AdBlocker.config.enableLogging,
        };
        const store = bridgedStore();
        if (store) {
          store.updateModuleSettings(MODULE_NAME, payload);
          return;
        }
        // Storage can be disabled or full.
        try {
          U.storage?.setItem(AdBlocker.config.storageKey, JSON.stringify(payload));
        } catch (error) {
          logS(error);
          adblockerLogger?.error?.('AdBlocker', 'Error saving settings', error);
        }
      },
    },

    /**
     * Skip current ad by clicking skip button or speeding through
     * Uses a stealthier approach to avoid YouTube ad blocker detection
     * @returns {void}
     */
    skipAd() {
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
        return;
      }

      if (clickVisibleSkipButton()) return;
      seekThroughAd();
      closeAdOverlay();
    },

    /**
     * Dismiss YouTube's ad blocker warning popup if detected
     * @returns {void}
     */
    dismissAdBlockerWarning() {
      if (dismissEnforcementOverlay()) return;
      if (dismissWarningDialog()) return;
      hideBlockerBackdrops();
    },

    // Minimal CSS injection - only hide minor UI elements that YouTube doesn't monitor
    addCss() {
      // Only use ads selectors (countdown, survey) in CSS
      // element selectors (masthead-ad, merch, etc.) are removed via DOM to avoid detection
      const styles = `${AdBlocker.selectors.ads}{display:none!important;}`;
      const SM = U?.StyleManager;
      if (SM && typeof SM.add === 'function') {
        SM.add('yt-ab-styles', styles);
      }
    },

    removeCss() {
      const SM = U?.StyleManager;
      if (SM && typeof SM.remove === 'function') {
        SM.remove('yt-ab-styles');
      }
    },

    // Batched element removal
    removeElements() {
      if (AdBlocker.state.isYouTubeMusic) return;

      // Use requestIdleCallback for non-blocking removal
      const remove = () => {
        // Remove known ad elements directly; these ship via the DOM path
        // (not CSS) to avoid detection.
        document.querySelectorAll(AdBlocker.selectors.elements).forEach(el => {
          el.remove();
        });

        // Remove ad-slot renderers
        document.querySelectorAll(AdBlocker.selectors.removal).forEach(el => {
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
          const container = el.closest('ytd-ad-slot-renderer') || el.closest('.ad-container') || el;
          if (container?.remove) {
            container.remove();
          }
        });
      };

      const ric = window.requestIdleCallback;
      if (typeof ric === 'function') {
        // The idle callback fires at most once and needs no tracking.
        ric(
          () => {
            remove();
          },
          { timeout: 100 }
        );
      } else {
        // The context frame releases itself on fire and at the feature stop,
        // so repeated removeElements calls cannot accumulate pool entries.
        adblockerCtx?.frame(remove);
      }
    },

    // Wire the runtime. Everything the blocker reacts with is owned by the
    // feature context: the release at the route exit removes the CSS,
    // unregisters the coordinators and drops the listeners together.
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      adblockerCtx = ctx;

      AdBlocker.settings.load();

      AdBlocker.addCss();
      AdBlocker.removeElements();

      // Blob changes arrive through the unified event; only adblocker keys
      // matter. The feature lifecycle owns the on/off switch, so re-reading
      // only applies a logging change from another tab.
      ctx.listen(window, 'youtube-plus-settings-updated', (/** @type {Event} */ e) => {
        if (window.YouTubePlusSettingsStore?.affectsModule?.(e, MODULE_NAME) === false) return;
        AdBlocker.settings.load();
      });

      // Cache movie_player reference to avoid 4+ redundant DOM queries per check cycle
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
        if (isAdActive()) {
          AdBlocker.skipAd();
          AdBlocker.dismissAdBlockerWarning();
        }
      };

      // Primary: coordinator watcher on #movie_player class attribute
      // (event-driven, no polling). When the player is absent (boot before
      // the DOM builds, SPA replacement), a root subscription for
      // '#movie_player' delivers the insertion and re-attaches instead of a
      // repeating retry timer.
      /** @type {Element | null} */
      let watchedPlayer = null;
      const attachAdObserver = () => {
        const coordinator = window.YouTubePlusMutationCoordinator;
        if (!coordinator?.watchTarget) return;

        const moviePlayer = $('#movie_player');
        // Mutations inside the player reach the wait subscription too; the
        // watcher already on this player needs no re-attach.
        if (moviePlayer && moviePlayer === watchedPlayer && moviePlayer.isConnected) return;
        if (AdBlocker.state.moviePlayerSubId) {
          coordinator.unwatch(AdBlocker.state.moviePlayerSubId);
          AdBlocker.state.moviePlayerSubId = null;
        }
        watchedPlayer = null;
        if (!moviePlayer) return;
        watchedPlayer = moviePlayer;
        AdBlocker.state.moviePlayerSubId = 'adblocker::moviePlayerClass';

        coordinator.watchTarget(AdBlocker.state.moviePlayerSubId, moviePlayer, combinedAdCheck, {
          attributes: true,
          childList: false,
          subtree: false,
          attributeFilter: ['class'],
        });
      };
      attachAdObserver();

      const moviePlayerWaitSubId = 'adblocker::moviePlayerWait';
      if (window.YouTubePlusMutationCoordinator?.subscribeRoot) {
        window.YouTubePlusMutationCoordinator.subscribeRoot(
          moviePlayerWaitSubId,
          () => attachAdObserver(),
          {
            selector: '#movie_player',
            childList: true,
            subtree: true,
            attributes: false,
          }
        );
      }
      ctx.onDispose(() => {
        const c = window.YouTubePlusMutationCoordinator;
        if (AdBlocker.state.moviePlayerSubId && c?.unwatch) {
          c.unwatch(AdBlocker.state.moviePlayerSubId);
          AdBlocker.state.moviePlayerSubId = null;
        }
        c?.unsubscribe?.(moviePlayerWaitSubId);
      });

      // Video play events for immediate ad detection; the class watcher
      // handles fast detection, this only adds one delayed check.
      ctx.listen(
        document,
        'playing',
        () => {
          ctx.timeout(combinedAdCheck, 100);
        },
        {
          capture: true,
          passive: true,
        }
      );

      // Navigation handling: also run removeElements on page transitions.
      const handleNavigation = () => {
        AdBlocker.cache.lastCacheTime = 0; // Reset cache
        AdBlocker.removeElements();
      };
      ctx.listen(window, 'yp-history-navigate', () => ctx.timeout(handleNavigation, 50), false);

      // Observe DOM for dynamically inserted ad slots and remove them
      // (coordinator root subscription with selector filtering)
      const adSlotCoordinator = window.YouTubePlusMutationCoordinator;
      if (adSlotCoordinator?.subscribeRoot) {
        if (AdBlocker.state.adSlotSubId) {
          adSlotCoordinator.unsubscribe(AdBlocker.state.adSlotSubId);
        }
        AdBlocker.state.adSlotSubId = 'adblocker::adSlots';
        adSlotCoordinator.subscribeRoot(
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
        ctx.onDispose(() => {
          if (AdBlocker.state.adSlotSubId) {
            window.YouTubePlusMutationCoordinator?.unsubscribe?.(AdBlocker.state.adSlotSubId);
            AdBlocker.state.adSlotSubId = null;
          }
        });
      }

      // Initial skip attempt
      ctx.timeout(() => {
        AdBlocker.skipAd();
      }, 200);
      // Also check for ad blocker warning popup
      ctx.timeout(() => {
        AdBlocker.dismissAdBlockerWarning();
      }, 500);
    },

    stop() {
      if (adblockerCtx) {
        adblockerCtx.dispose();
        adblockerCtx = null;
      }
      AdBlocker.removeCss();
    },
  };

  // --- FeatureLifecycle: the runtime starts when `enableAdBlocker` is on ---
  // Routes carry the pages where something is removed: player ads on watch,
  // the shorts player, and the feed/home/search list ad slots. Channel and
  // other pages ship none of the module's removal selectors.
  const adblockerFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'adblocker',
    settingsKey: 'enableAdBlocker',
    routes: ['watch', 'shorts', 'home', 'feed', 'search'],
    start: AdBlocker.start,
    stop: AdBlocker.stop,
  });
  adblockerFeature?.sync();

  window.AdBlocker = AdBlocker;
  window.YouTubePlusAdBlocker = AdBlocker;
})();
