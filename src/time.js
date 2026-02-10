// Time to Read (Resume Playback)
(function () {
  'use strict';

  let featureEnabled = true;
  let activeCleanup = null;
  const loadFeatureEnabled = () => {
    try {
      const settings = localStorage.getItem('youtube_plus_settings');
      if (settings) {
        const parsed = JSON.parse(settings);
        return parsed.enableResumeTime !== false;
      }
    } catch {}
    return true;
  };
  const setFeatureEnabled = nextEnabled => {
    featureEnabled = nextEnabled !== false;
    if (!featureEnabled) {
      const existingOverlay = byId(OVERLAY_ID);
      if (existingOverlay) {
        try {
          existingOverlay.remove();
        } catch {}
      }
      if (typeof activeCleanup === 'function') {
        try {
          activeCleanup();
        } catch {}
        activeCleanup = null;
      }
    } else {
      try {
        initResume();
      } catch {}
    }
  };

  featureEnabled = loadFeatureEnabled();

  // DOM helpers
  const _getDOMCache = () => typeof window !== 'undefined' && window.YouTubeDOMCache;
  const $ = (sel, ctx) =>
    _getDOMCache()?.querySelector(sel, ctx) || (ctx || document).querySelector(sel);
  const byId = id => _getDOMCache()?.getElementById(id) || document.getElementById(id);
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
    if (!ready) document.addEventListener('DOMContentLoaded', run, { once: true });
    return cb => {
      if (ready) cb();
      else queue.push(cb);
    };
  })();

  const setupResumeDelegation = (() => {
    let attached = false;
    return () => {
      if (attached) return;
      attached = true;

      const delegator = window.YouTubePlusEventDelegation;
      const handler = (ev, target) => {
        const action = target?.dataset?.ytpResumeAction;
        if (!action) return;
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
        delegator.on(document, 'keydown', '.ytp-resume-btn', (ev, target) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            handler(ev, target);
          }
        });
      } else {
        document.addEventListener(
          'click',
          ev => {
            const target = ev.target?.closest?.('.ytp-resume-btn');
            if (target) handler(ev, target);
          },
          true
        );
        document.addEventListener(
          'keydown',
          ev => {
            const target = ev.target?.closest?.('.ytp-resume-btn');
            if (!target) return;
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              handler(ev, target);
            }
          },
          true
        );
      }
    };
  })();

  const RESUME_STORAGE_KEY = 'youtube_resume_times_v1';
  const OVERLAY_ID = 'yt-resume-overlay';
  const AUTO_HIDE_MS = 10000; // hide overlay after 10s

  // Localization: prefer centralized i18n with local fallback for critical keys
  const _localFallback = {
    resumePlayback: { en: 'Resume playback?', ru: 'Продолжить воспроизведение?' },
    resume: { en: 'Resume', ru: 'Продолжить' },
    startOver: { en: 'Start over', ru: 'Начать сначала' },
  };

  const t = (key, params = {}) => {
    if (window.YouTubePlusI18n?.t) return window.YouTubePlusI18n.t(key, params);
    if (window.YouTubeUtils?.t) return window.YouTubeUtils.t(key, params);

    // Fallback to local tiny map for this module's critical keys
    const htmlLang = document.documentElement.lang || 'en';
    const lang = htmlLang.startsWith('ru') ? 'ru' : 'en';
    const val = _localFallback[key]?.[lang] || _localFallback[key]?.en || key;

    if (!params || Object.keys(params).length === 0) return val;
    let result = val;
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
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
    } catch {
      return null;
    }
  };

  const createOverlay = (seconds, onResume, onRestart) => {
    if (byId(OVERLAY_ID)) return null;
    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;

    // Try to insert overlay inside the player so it appears above the progress bar
    const player = $('#movie_player');
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
      } else if (!byId('ytp-resume-overlay-styles')) {
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
    btnResume.dataset.ytpResumeAction = 'resume';

    const btnRestart = document.createElement('button');
    btnRestart.className = 'ytp-resume-btn ghost';
    btnRestart.textContent = t('startOver');
    btnRestart.setAttribute('aria-label', t('startOver'));
    btnRestart.tabIndex = 0;
    btnRestart.dataset.ytpResumeAction = 'restart';

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
    if (!featureEnabled) return null;
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
    if (saved && saved > 5 && !byId(OVERLAY_ID)) {
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
        const overlayEl = byId(OVERLAY_ID);
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
        } catch {}
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

  window.addEventListener('youtube-plus-settings-updated', e => {
    try {
      const nextEnabled = e?.detail?.enableResumeTime !== false;
      if (nextEnabled === featureEnabled) return;
      setFeatureEnabled(nextEnabled);
    } catch {
      setFeatureEnabled(loadFeatureEnabled());
    }
  });
})();
