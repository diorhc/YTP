// Time to Read (Resume Playback)
(function () {
  'use strict';

  let featureEnabled = true;
  /** @type {(() => void) | null} */
  let activeCleanup = null;
  /** @param {boolean} [nextEnabled] */
  const setFeatureEnabled = nextEnabled => {
    featureEnabled = nextEnabled !== false;
    if (!featureEnabled) {
      const existingOverlay = byId(OVERLAY_ID);
      if (existingOverlay) {
        try {
          existingOverlay.remove();
        } catch (e) {
          // Non-critical, suppressed
        }
      }
      if (typeof activeCleanup === 'function') {
        try {
          activeCleanup();
        } catch (e) {
          // Non-critical, suppressed
        }
        activeCleanup = null;
      }
    } else {
      try {
        initResume();
      } catch (e) {
        // Non-critical, suppressed
      }
    }
  };

  featureEnabled = window.YouTubeUtils?.loadFeatureEnabled?.('enableResumeTime') ?? true;

  // Shared DOM helpers from YouTubeUtils
  const { $, byId } = window.YouTubeUtils || {};
  const onDomReady =
    window.YouTubeUtils?.onDomReady ||
    ((/** @type {() => void} */ cb) => {
      if (document.readyState !== 'loading') cb();
      else document.addEventListener('DOMContentLoaded', cb, { once: true });
    });

  const setupResumeDelegation = (() => {
    let attached = false;
    return () => {
      if (attached) return;
      attached = true;

      const delegator = window.YouTubePlusEventDelegation;
      const handler = (/** @type {Event} */ _ev, /** @type {HTMLElement | null} */ target) => {
        const action = target?.getAttribute('data-ytp-resume-action');
        if (!action || !target) return;
        const wrap = target.closest('.ytp-resume-overlay');
        if (!wrap) return;

        if (action === 'resume') {
          wrap.dispatchEvent(new CustomEvent('ytp:resume', { bubbles: true }));
        } else if (action === 'restart') {
          wrap.dispatchEvent(new CustomEvent('ytp:restart', { bubbles: true }));
        }
      };

      if (delegator?.on) {
        delegator.on(document, 'click', '.ytp-resume-btn', handler);
        delegator.on(
          document,
          'keydown',
          '.ytp-resume-btn',
          (/** @type {KeyboardEvent} */ ev, /** @type {HTMLElement} */ target) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              handler(ev, target);
            }
          }
        );
      } else {
        const clickHandler = /** @param {Event} ev */ ev => {
          const target1 = /** @type {Element|null} */ (ev.target)?.closest?.('.ytp-resume-btn');
          if (target1) handler(ev, /** @type {HTMLElement} */ (target1));
        };
        const keyHandler = /** @param {KeyboardEvent} ev */ ev => {
          const target2 = /** @type {Element|null} */ (ev.target)?.closest?.('.ytp-resume-btn');
          if (!target2) return;
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            handler(ev, /** @type {HTMLElement} */ (target2));
          }
        };
        if (window.YouTubeUtils?.cleanupManager?.registerListener) {
          window.YouTubeUtils.cleanupManager.registerListener(
            document,
            'click',
            clickHandler,
            true
          );
          window.YouTubeUtils.cleanupManager.registerListener(
            document,
            'keydown',
            /** @type {EventListener} */ (keyHandler),
            true
          );
        } else {
          document.addEventListener('click', clickHandler, true);
          document.addEventListener('keydown', keyHandler, true);
        }
      }
    };
  })();

  const RESUME_STORAGE_KEY = 'youtube_resume_times_v1';
  const OVERLAY_ID = 'yt-resume-overlay';
  const AUTO_HIDE_MS = 10000; // hide overlay after 10s

  /** @type {Record<string, {en: string, ru: string}>} */
  const _localFallback = {
    resumePlayback: { en: 'Resume playback?', ru: 'Продолжить воспроизведение?' },
    resume: { en: 'Resume', ru: 'Продолжить' },
    startOver: { en: 'Start over', ru: 'Начать сначала' },
  };

  /**
   * @param {string} key
   * @param {Record<string,any>} [params]
   */
  const t = (key, params = {}) => {
    // Prefer centralized i18n
    const U = window.YouTubeUtils;
    if (U?.t) return U.t(key, params);
    // Fallback to local tiny map for this module's critical keys
    const htmlLang = document.documentElement.lang || 'en';
    const lang = htmlLang.startsWith('ru') ? 'ru' : 'en';
    const val = _localFallback[key]?.[lang] || _localFallback[key]?.en || key;
    if (!params || Object.keys(params).length === 0) return val;
    let result = val;
    for (const [k, v] of Object.entries(params)) {
      const token = `{${k}}`;
      result = result.split(token).join(String(v));
    }
    return result;
  };

  const readStorage = () => {
    try {
      return JSON.parse(localStorage.getItem(RESUME_STORAGE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  };

  /**
   * @param {Record<string, any>} obj
   */
  const writeStorage = obj => {
    try {
      localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      window.console.warn('[YouTube+] Failed to save resume time:', e);
    }
  };

  // Get current video id from the page (works on standard watch pages)
  const getVideoId = () => {
    try {
      // First try URL parameters (most reliable)
      const urlParams = new URLSearchParams(window.location.search);
      const videoIdFromUrl = urlParams.get('v');
      if (videoIdFromUrl) return videoIdFromUrl;

      // Try canonical link
      const meta = $('link[rel="canonical"]');
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
    } catch (e) {
      return null;
    }
  };

  /**
   * @param {number} seconds
   * @param {() => void} onResume
   * @param {() => void} onRestart
   */
  const createOverlay = (seconds, onResume, onRestart) => {
    if (byId(OVERLAY_ID)) return null;
    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-label', t('resumePlayback') || 'Resume playback');

    // Try to insert overlay inside the player so it appears above the progress bar
    const player = $('#movie_player');
    const inPlayer = !!player;

    // Ensure glassmorphism styles are available for the overlay
    const resumeOverlayStyles = `
      .ytp-resume-overlay{min-width:180px;max-width:36vw;background:var(--yt-glass-bg);color:var(--yt-text-primary,#fff);padding:12px 14px;border-radius:12px;backdrop-filter:blur(8px) saturate(150%);-webkit-backdrop-filter:blur(8px) saturate(150%);box-shadow:0 14px 40px var(--yt-shadow-flyout);border:1.25px solid var(--yt-surface-overlay-border);font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;align-items:center;text-align:center;animation:ytp-resume-fadein 0.3s ease-out}
      @keyframes ytp-resume-fadein{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      .ytp-resume-overlay .ytp-resume-title{font-weight:600;margin-bottom:8px;font-size:13px}
      .ytp-resume-overlay .ytp-resume-actions{display:flex;gap:8px;justify-content:center;margin-top:6px}
      .ytp-resume-overlay .ytp-resume-btn{padding:6px 12px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:500;transition:all 0.2s ease;outline:none}
      .ytp-resume-overlay .ytp-resume-btn:focus{box-shadow:0 0 0 2px var(--yt-glass-border);outline:2px solid transparent}
      .ytp-resume-overlay .ytp-resume-btn:hover{transform:translateY(-1px)}
      .ytp-resume-overlay .ytp-resume-btn:active{transform:translateY(0)}
      .ytp-resume-overlay .ytp-resume-btn.primary{background:var(--yt-accent-secondary);color:#fff}
      .ytp-resume-overlay .ytp-resume-btn.primary:hover{background:var(--yt-accent-secondary-light)}
      .ytp-resume-overlay .ytp-resume-btn.ghost{background:var(--yt-button-bg);color:var(--yt-text-primary)}
      .ytp-resume-overlay .ytp-resume-btn.ghost:hover{background:var(--yt-hover-bg)}
    `;
    try {
      if (window.YouTubeUtils && YouTubeUtils.StyleManager) {
        YouTubeUtils.StyleManager.add('ytp-resume-overlay-styles', resumeOverlayStyles);
      } else if (!byId('ytp-resume-overlay-styles')) {
        const s = document.createElement('style');
        s.id = 'ytp-resume-overlay-styles';
        s.textContent = resumeOverlayStyles;
        (document.head || document.documentElement).appendChild(s);
      }
    } catch (e) {
      window.console.warn('[YouTube+] Failed to inject resume overlay styles:', e);
    }

    if (inPlayer) {
      try {
        // Ensure player can be a positioning context
        const playerStyle = window.getComputedStyle(
          /** @type {Element} */ (/** @type {unknown} */ (player))
        );
        if (playerStyle.position === 'static') player.style.position = 'relative';
      } catch (e) {
        /* Intentional: player element may be detached */
      }

      // Position centered inside the player
      wrap.className = 'ytp-resume-overlay ytp-plus-resume-overlay';
      // absolute center (use transform to center by both axes)
      wrap.style.position = 'absolute';
      wrap.style.left = '50%';
      wrap.style.bottom = '5%';
      wrap.style.transform = 'translate(-50%,-50%)';
      wrap.style.zIndex = '9999';
      wrap.style.pointerEvents = 'auto';
      player.appendChild(wrap);
    } else {
      // Fallback: fixed centered on the page
      wrap.className = 'ytp-resume-overlay ytp-plus-resume-overlay';
      wrap.style.position = 'fixed';
      wrap.style.left = '50%';
      wrap.style.bottom = '5%';
      wrap.style.transform = 'translate(-50%,-50%)';
      wrap.style.zIndex = '1200';
      wrap.style.pointerEvents = 'auto';
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
    btnResume.setAttribute('data-ytp-resume-action', 'resume');

    const btnRestart = document.createElement('button');
    btnRestart.className = 'ytp-resume-btn ghost';
    btnRestart.textContent = t('startOver');
    btnRestart.setAttribute('aria-label', t('startOver'));
    btnRestart.tabIndex = 0;
    btnRestart.setAttribute('data-ytp-resume-action', 'restart');

    const handleResume = () => {
      try {
        onResume();
      } catch (err) {
        window.console.error('[YouTube+] Resume error:', err);
      }
      try {
        wrap.remove();
      } catch (e) {
        // Non-critical, suppressed
      }
    };

    const handleRestart = () => {
      try {
        onRestart();
      } catch (err) {
        window.console.error('[YouTube+] Restart error:', err);
      }
      try {
        wrap.remove();
      } catch (e) {
        // Non-critical, suppressed
      }
    };

    setupResumeDelegation();

    wrap.addEventListener('ytp:resume', () => handleResume(), { once: true });
    wrap.addEventListener('ytp:restart', () => handleRestart(), { once: true });

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
    } catch (e) {
      // Non-critical, suppressed
    }

    const to = setTimeout(() => {
      try {
        wrap.remove();
      } catch (e) {
        // Non-critical, suppressed
      }
    }, AUTO_HIDE_MS);

    // Return function to cancel timeout
    const cancel = () => clearTimeout(to);

    // Register cleanup: cancel timeout and remove overlay when cleanup runs
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.register(() => {
        try {
          cancel();
        } catch (e) {
          // Non-critical, suppressed
        }
        try {
          wrap.remove();
        } catch (e) {
          // Non-critical, suppressed
        }
      });
    }

    return cancel;
  };

  /** @param {number} secs */
  const formatTime = secs => {
    const s = Math.floor(secs % 60)
      .toString()
      .padStart(2, '0');
    const m = Math.floor((secs / 60) % 60).toString();
    const h = Math.floor(secs / 3600);
    return h ? `${h}:${m.padStart(2, '0')}:${s}` : `${m}:${s}`;
  };

  /** @param {HTMLVideoElement} videoEl */
  const attachResumeHandlers = videoEl => {
    if (!featureEnabled) return null;
    if (!videoEl || videoEl.tagName !== 'VIDEO') {
      window.console.warn('[YouTube+] Invalid video element for resume handlers');
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
    /** @type {(() => void) | null} */
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
        } catch (e) {
          window.console.warn('[YouTube+] Error saving playback time:', e);
        }
      };
      videoEl.addEventListener('timeupdate', timeUpdateHandler, { passive: true });

      // register cleanup to remove listener
      if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
        YouTubeUtils.cleanupManager.register(() => {
          try {
            if (timeUpdateHandler) videoEl.removeEventListener('timeupdate', timeUpdateHandler);
          } catch (e) {
            /* Intentional: element may be detached */
          }
        });
      }
    };

    const stopSaving = () => {
      if (!timeUpdateHandler) return;
      try {
        videoEl.removeEventListener('timeupdate', timeUpdateHandler);
      } catch (e) {
        /* Intentional: element may be detached */
      }
      timeUpdateHandler = null;
      lastSavedAt = 0;
    };

    // If saved time exists and is > 5s, show overlay
    if (saved && saved > 5 && !byId(OVERLAY_ID)) {
      const cancelTimeout = createOverlay(
        saved,
        () => {
          try {
            videoEl.currentTime = saved;
            videoEl.play();
          } catch (e) {
            window.console.error('[YouTube+] Failed to resume playback:', e);
          }
        },
        () => {
          try {
            videoEl.currentTime = 0;
            videoEl.play();
          } catch (e) {
            window.console.error('[YouTube+] Failed to start over:', e);
          }
        }
      );

      // Tag overlay with current video id so future init calls won't immediately remove it
      try {
        const overlayEl = byId(OVERLAY_ID);
        if (overlayEl && vid) overlayEl.setAttribute('data-vid', vid);
      } catch (e) {
        // Non-critical, suppressed
      }

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
        window.console.error('[YouTube+] Resume cleanup error:', err);
      }
    };

    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.register(cleanupHandlers);
    }

    // Return cleanup function
    activeCleanup = cleanupHandlers;
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
      const video = $(selector);
      if (video && video.tagName === 'VIDEO') {
        return /** @type {HTMLVideoElement} */ (video);
      }
    }

    return null;
  };

  const initResume = () => {
    if (!featureEnabled) {
      const existingOverlay = byId(OVERLAY_ID);
      if (existingOverlay) {
        try {
          existingOverlay.remove();
        } catch (e) {
          // Non-critical, suppressed
        }
      }
      return;
    }
    // Only run on watch pages
    if (window.location.pathname !== '/watch') {
      // Remove overlay if we navigate away from watch page
      const existingOverlay = byId(OVERLAY_ID);
      if (existingOverlay) {
        existingOverlay.remove();
      }
      return;
    }

    // Remove any existing overlay from previous video — but keep it if it's for the same video id
    const currentVid = getVideoId();
    const existingOverlay = byId(OVERLAY_ID);
    if (existingOverlay) {
      try {
        if (existingOverlay.dataset && existingOverlay.getAttribute('data-vid') === currentVid) {
          // overlay matches current video; keep it (prevents immediate disappearance during SPA re-inits)
        } else {
          existingOverlay.remove();
        }
      } catch (e) {
        try {
          existingOverlay.remove();
        } catch (e) {
          // Non-critical, suppressed
        }
      }
    }

    const videoEl = findVideoElement();
    if (videoEl) {
      attachResumeHandlers(videoEl);
    } else {
      const waitFor = window.YouTubeUtils?.waitForElement || window.YouTubeUtils?.waitFor;
      if (typeof waitFor === 'function') {
        waitFor('video', 1200).then(() => initResume());
      } else {
        requestAnimationFrame(initResume);
      }
    }
  };

  // Listen for navigation events used by YouTube SPA
  const onNavigate = () => setTimeout(initResume, 150);

  onDomReady(initResume);

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

  const settingsUpdatedHandler = /** @param {Event} e */ e => {
    try {
      const nextEnabled = /** @type {CustomEvent} */ (e)?.detail?.enableResumeTime !== false;
      if (nextEnabled === featureEnabled) return;
      setFeatureEnabled(nextEnabled);
    } catch (e) {
      /* empty */
      setFeatureEnabled(window.YouTubeUtils?.loadFeatureEnabled?.('enableResumeTime') ?? true);
    }
  };
  if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
    YouTubeUtils.cleanupManager.registerListener(
      window,
      'youtube-plus-settings-updated',
      settingsUpdatedHandler
    );
  } else {
    window.addEventListener('youtube-plus-settings-updated', settingsUpdatedHandler);
  }
})();
