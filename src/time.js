// Time to Read (Resume Playback)
//
// Hardened runtime module. Owns:
//   - the resume-playback overlay (created on /watch pages when a
//     saved timestamp is found, removed on navigation away),
//   - the A-B loop control surface exposed as
//     `window.YouTubePlusTimeLoop`.
//
// Hardening notes (intentionally narrow):
//   - The IIFE is idempotent via `__ytpTimeInitDone__`. Hot-reload or
//     re-injection of this file becomes a no-op after the first run,
//     so we never double-register navigation / settings-updated
//     listeners on the cleanupManager.
//   - The logger and the cleanupManager are resolved lazily through
//     small helpers. This file historically could be loaded before
//     logger.js / cleanup-manager.js; capturing those refs at IIFE
//     start would have lost log output or thrown on null access.
//   - Public surface (`YouTubePlusTimeLoop`) and the resume storage
//     schema (`youtube_resume_times_v1` / `youtube_loop_state`) are
//     preserved verbatim so download.js, music.js, and on-disk state
//     keep working unchanged.

(function () {
  if (window.__ytpTimeInitDone__) return;
  window.__ytpTimeInitDone__ = true;

  const U = window.YouTubeUtils;

  /**
   * Minimal logger shape — covers logger.js createLogger() and the
   * lightweight shims used by older test harnesses. Methods are all
   * optional so `?.warn?.(...)` patterns stay safe.
   * @typedef {{
   *   error?: (...args: unknown[]) => void,
   *   warn?: (...args: unknown[]) => void,
   *   info?: (...args: unknown[]) => void,
   *   debug?: (...args: unknown[]) => void,
   *   log?: (...args: unknown[]) => void
   * }} MinimalLogger
   */

  /**
   * Resolve the canonical logger at call time. Capturing it once at
   * IIFE start is unsafe when this file loads before logger.js.
   * @returns {MinimalLogger | null}
   */
  const getLogger = () =>
    /** @type {MinimalLogger | null} */ (window.YouTubePlusLogger || U?.logger || null);

  /**
   * Resolve the canonical cleanupManager at call time. The same
   * instance is shared across modules via `YouTubeUtils.cleanupManager`
   * (a lazy getter defined in utils.js) or the `YouTubePlusCleanupManager`
   * global fallback.
   * @returns {CleanupManager | null}
   */
  const getCleanupManager = () => {
    return U?.cleanupManager || window.YouTubePlusCleanupManager || null;
  };

  /** @type {boolean} */
  let featureEnabled = true;
  /** @type {(() => void) | null} */
  let activeCleanup = null;
  /**
   * Toggle the resume feature at runtime. Called by the
   * `youtube-plus-settings-updated` event when the user flips the
   * resume switch in the settings modal.
   * @param {boolean} [nextEnabled]
   */
  const setFeatureEnabled = nextEnabled => {
    featureEnabled = nextEnabled !== false;
    if (!featureEnabled) {
      const existingOverlay = byId(OVERLAY_ID);
      if (existingOverlay) {
        try {
          existingOverlay.remove();
        } catch (e) {
          getLogger()?.warn?.('Time', 'Failed to remove resume overlay on disable', e);
        }
      }
      if (typeof activeCleanup === 'function') {
        try {
          activeCleanup();
        } catch (e) {
          getLogger()?.warn?.('Time', 'Active cleanup threw on disable', e);
        }
        activeCleanup = null;
      }
    } else {
      try {
        initResume();
      } catch (e) {
        getLogger()?.warn?.('Time', 'initResume threw on enable', e);
      }
    }
  };

  featureEnabled = U?.loadFeatureEnabled?.('enableResumeTime') ?? true;

  // Narrow setTimeout wrapper. `YouTubeUtils.setTimeout_` (if present)
  // routes the timer through the canonical cleanupManager so the
  // central lifecycle can dispose it on SPA cleanup. When the wrapper
  // is missing, we fall back to the native setTimeout rather than
  // silently dropping the scheduled callback — the previous `?.()`
  // pattern meant a missing `setTimeout_` would skip
  // `applyLoopStateToCurrentVideo()` entirely and leave the loop
  // state un-applied to the current <video>. This matches the
  // `basicSetTimeout_` alias used in basic.js.
  /** @type {(...args: unknown[]) => unknown} */
  const timeSetTimeout_ =
    /** @type {(...args: unknown[]) => unknown} */ (U?.setTimeout_) || setTimeout;

  // Shared DOM helpers from YouTubeUtils
  const { $, byId } = U || {};
  const onDomReady =
    U?.onDomReady ||
    (cb => {
      if (document.readyState !== 'loading') cb();
      else document.addEventListener('DOMContentLoaded', cb, { once: true });
    });

  const ensureResumeStyles = () => {
    try {
      const StyleManager = U?.StyleManager;
      if (!StyleManager || typeof StyleManager.add !== 'function') return;
      const css = window.YouTubePlusDesignSystem?.getStyle?.('ytp-resume-overlay-styles') || '';
      if (!css) return;
      StyleManager.add('ytp-resume-overlay-styles', css);
    } catch (e) {
      getLogger()?.warn?.('Time', 'Failed to pre-register resume overlay styles', e);
    }
  };

  const setupResumeDelegation = (() => {
    let attached = false;
    return () => {
      if (attached) return;
      attached = true;

      const delegator = window.YouTubePlusEventDelegation;
      const handler = (/** @type {Event} */ _ev, /** @type {HTMLElement | null} */ target) => {
        const action = target?.getAttribute('data-ytp-resume-action');
        if (!(action && target)) return;
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
        if (U?.cleanupManager?.registerListener) {
          U.cleanupManager.registerListener(document, 'click', clickHandler, true);
          U.cleanupManager.registerListener(
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

  /**
   * Translate a key via the canonical i18n with a safe interpolation
   * fallback. Centralized translation lives in i18n.js; this fallback
   * keeps the module usable when i18n.js is not yet loaded (e.g. in
   * isolated unit-test harnesses).
   * @param {string} key
   * @param {Record<string, any>} [params]
   * @returns {string}
   */
  const t = (key, params = {}) => {
    if (U?.t) return U.t(key, params);
    const val = key;
    if (!params || Object.keys(params).length === 0) return val;
    let result = val;
    for (const [k, v] of Object.entries(params)) {
      const token = `{${k}}`;
      result = result.split(token).join(String(v));
    }
    return result;
  };

  /**
   * Read the resume-timestamps map. Returns an empty object on any
   * parse error so callers can safely index into the result.
   * @returns {Record<string, number>}
   */
  const readStorage = () => {
    try {
      const raw = localStorage.getItem(RESUME_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return /** @type {Record<string, number>} */ (
        parsed && typeof parsed === 'object' ? parsed : {}
      );
    } catch (e) {
      getLogger()?.warn?.('Time', 'Failed to parse resume storage', e);
      return {};
    }
  };

  /**
   * Persist the resume-timestamps map. Storage failures are
   * non-critical and only logged.
   * @param {Record<string, any>} obj
   */
  const writeStorage = obj => {
    try {
      localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      getLogger()?.warn?.('Time', 'Failed to save resume time', e);
    }
  };

  /**
   * Extract the current video ID from a variety of YouTube page
   * shapes (URL `?v=`, canonical link, embedded `ytInitialPlayerResponse`,
   * `/watch/...` and `/shorts/...` pathnames). Returns `null` when no
   * ID can be determined.
   * @returns {string | null}
   */
  const getVideoId = () => {
    try {
      const base = /** @type {any} */ (window.YouTubeUtils)?.getVideoIdFromLocation?.();
      if (base) return base;

      // Try canonical link
      const meta = $('link[rel="canonical"]');
      if (meta?.href) {
        const u = new URL(meta.href);
        const vParam = u.searchParams.get('v');
        if (vParam) return vParam;

        // Try extracting from pathname (for /watch/ or /shorts/ URLs)
        const pathMatch = u.pathname.match(/\/(watch|shorts)\/([^/?]+)/);
        if (pathMatch?.[2]) return pathMatch[2];
      }

      // Fallback to ytInitialPlayerResponse
      const yipr = /** @type {any} */ (window).ytInitialPlayerResponse;
      const fromPlayer = yipr?.videoDetails?.videoId;
      if (typeof fromPlayer === 'string' && fromPlayer) return fromPlayer;

      // Last resort: try to extract from current URL pathname
      const pathMatch = window.location.pathname.match(/\/(watch|shorts)\/([^/?]+)/);
      if (pathMatch?.[2]) return pathMatch[2];

      return null;
    } catch (_e) {
      return null;
    }
  };

  /**
   * Build and mount the resume overlay. Returns the cancel function
   * (clears the auto-hide timer) or `null` when an overlay is
   * already present.
   * @param {number} seconds
   * @param {() => void} onResume
   * @param {() => void} onRestart
   * @param {string} [videoId]
   * @returns {(() => void) | null}
   */
  const createOverlay = (seconds, onResume, onRestart, videoId) => {
    if (byId(OVERLAY_ID)) return null;
    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-label', t('resumePlayback'));
    if (videoId) wrap.setAttribute('data-vid', videoId);

    // Keep styles registered before the first overlay paint so the UI
    // never flashes as unstyled native buttons/text.
    ensureResumeStyles();

    // Do NOT append inside #movie_player: YouTube recreates/empties that
    // element during full page loads and removes foreign DOM. Instead,
    // append to the player container (#player-container) when available;
    // it is a stable ancestor and gives us absolute positioning over the
    // video. Fall back to body only when the container is missing.
    wrap.className = 'ytp-resume-overlay ytp-plus-resume-overlay';
    wrap.style.position = 'absolute';
    wrap.style.left = '50%';
    wrap.style.bottom = '5%';
    wrap.style.transform = 'translate(-50%,-50%)';
    wrap.style.zIndex = '2147483647';
    wrap.style.pointerEvents = 'auto';

    const playerContainer = $('#player-container');
    if (playerContainer instanceof HTMLElement) {
      try {
        const containerStyle = window.getComputedStyle(playerContainer);
        if (containerStyle.position === 'static') playerContainer.style.position = 'relative';
      } catch (_e) {
        /* Intentional: container may be detached */
      }
      playerContainer.appendChild(wrap);
    } else {
      const player = $('#movie_player');
      if (player instanceof HTMLElement) {
        try {
          const playerStyle = window.getComputedStyle(player);
          if (playerStyle.position === 'static') player.style.position = 'relative';
        } catch (_e) {
          /* Intentional: player may be detached */
        }
        player.appendChild(wrap);
      } else {
        wrap.style.position = 'fixed';
        wrap.style.bottom = '8%';
        (document.body || document.documentElement).appendChild(wrap);
      }
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

    /**
     * @param {() => void} cb
     * @param {string} label
     */
    const runAndRemove = (cb, label) => {
      try {
        cb();
      } catch (err) {
        getLogger()?.error?.('Time', `${label} error`, err);
      }
      try {
        wrap.remove();
      } catch (_e) {
        U.logSuppressed(_e, 'Time');
      }
    };

    const handleResume = () => runAndRemove(onResume, 'Resume');
    const handleRestart = () => runAndRemove(onRestart, 'Restart');

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
    } catch (_e) {
      U.logSuppressed(_e, 'Time');
    }

    /** @type {ReturnType<typeof setTimeout>} */
    let autoHideTimer = setTimeout(() => {
      autoHideTimer = /** @type {ReturnType<typeof setTimeout>} */ (/** @type {unknown} */ (null));
      try {
        wrap.remove();
      } catch (_e) {
        U.logSuppressed(_e, 'Time');
      }
    }, AUTO_HIDE_MS);

    // Return function to cancel timeout
    const cancel = () => {
      if (autoHideTimer) clearTimeout(autoHideTimer);
      autoHideTimer = /** @type {ReturnType<typeof setTimeout>} */ (/** @type {unknown} */ (null));
    };

    // Register cleanup: cancel timeout and remove overlay when cleanup runs
    const cm = getCleanupManager();
    if (cm && typeof cm.register === 'function') {
      cm.register(() => {
        try {
          cancel();
        } catch (_e) {
          U.logSuppressed(_e, 'Time');
        }
        try {
          wrap.remove();
        } catch (_e) {
          U.logSuppressed(_e, 'Time');
        }
      });
    }

    return cancel;
  };

  /**
   * Format seconds as `H:MM:SS` / `M:SS` for display in the overlay.
   * @param {number} secs
   * @returns {string}
   */
  const formatTime =
    U.formatTime ||
    ((/** @type {number} */ secs) => {
      const safe = Number.isFinite(secs) && secs > 0 ? secs : 0;
      const s = Math.floor(safe % 60)
        .toString()
        .padStart(2, '0');
      const m = Math.floor((safe / 60) % 60).toString();
      const h = Math.floor(safe / 3600);
      return h ? `${h}:${m.padStart(2, '0')}:${s}` : `${m}:${s}`;
    });

  /**
   * Attach resume handlers to a `<video>` element. Idempotent via
   * `videoEl._ytpResumeAttached`; re-attaching is a no-op. Returns the
   * cleanup function or `null` when the feature is disabled or the
   * video is missing.
   * @param {HTMLVideoElement} videoEl
   * @returns {(() => void) | null | undefined}
   */
  const attachResumeHandlers = videoEl => {
    if (!featureEnabled) return null;
    if (videoEl?.tagName !== 'VIDEO') {
      getLogger()?.warn?.('Time', 'Invalid video element for resume handlers');
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

          const currentSec = Math.floor(videoEl.currentTime || 0);
          const now = Date.now();
          if (currentSec && (!lastSavedAt || now - lastSavedAt > SAVE_THROTTLE_MS)) {
            const s = readStorage();
            s[currentVid] = currentSec;
            writeStorage(s);
            lastSavedAt = now;
          }
        } catch (e) {
          getLogger()?.warn?.('Time', 'Error saving playback time', e);
        }
      };
      videoEl.addEventListener('timeupdate', timeUpdateHandler, {
        passive: true,
      });

      // register cleanup to remove listener
      const cm = getCleanupManager();
      if (cm && typeof cm.register === 'function') {
        cm.register(() => {
          try {
            if (timeUpdateHandler) videoEl.removeEventListener('timeupdate', timeUpdateHandler);
          } catch (_e) {
            /* Intentional: element may be detached */
          }
        });
      }
    };

    const stopSaving = () => {
      if (!timeUpdateHandler) return;
      try {
        videoEl.removeEventListener('timeupdate', timeUpdateHandler);
      } catch (_e) {
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
            getLogger()?.error?.('Time', 'Failed to resume playback', e);
          }
        },
        () => {
          try {
            videoEl.currentTime = 0;
            videoEl.play();
          } catch (e) {
            getLogger()?.error?.('Time', 'Failed to start over', e);
          }
        },
        vid
      );

      // register cleanup for overlay timeout
      const cm = getCleanupManager();
      if (cm && typeof cm.register === 'function' && cancelTimeout) {
        cm.register(cancelTimeout);
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
        getLogger()?.error?.('Time', 'Resume cleanup error', err);
      }
    };

    const cm = getCleanupManager();
    if (cm && typeof cm.register === 'function') {
      cm.register(cleanupHandlers);
    }

    // Return cleanup function
    activeCleanup = cleanupHandlers;
    return cleanupHandlers;
  };

  /**
   * Find the primary HTML5 video element on a YouTube watch page.
   * Tries several selectors in order of specificity.
   * @returns {HTMLVideoElement | null}
   */
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

  /**
   * Initialize (or re-initialize) the resume overlay for the current
   * watch page. Safe to call repeatedly: existing overlays for the
   * current video ID are preserved across SPA re-inits.
   */
  const initResume = () => {
    if (!featureEnabled) {
      const existingOverlay = byId(OVERLAY_ID);
      if (existingOverlay) {
        try {
          existingOverlay.remove();
        } catch (e) {
          getLogger()?.warn?.('Time', 'Failed to remove overlay on init', e);
        }
      }
      return;
    }
    // Only run on watch pages
    if (window.location.pathname !== '/watch') {
      // Remove overlay if we navigate away from watch page
      const existingOverlay = byId(OVERLAY_ID);
      if (existingOverlay) {
        try {
          existingOverlay.remove();
        } catch (_e) {
          U.logSuppressed(_e, 'Time');
        }
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
      } catch (_e) {
        try {
          existingOverlay.remove();
        } catch (e) {
          getLogger()?.warn?.('Time', 'Overlay removal failed twice', e);
        }
      }
    }

    const videoEl = findVideoElement();
    if (videoEl) {
      attachResumeHandlers(videoEl);
      return;
    }

    // Fallback: wait for the video element via the canonical
    // dom-cache / utils waitFor helper, then retry once.
    const waitFor = U?.waitForElement || U?.waitFor;
    if (typeof waitFor === 'function') {
      // `.then(() => initResume())` is intentionally fire-and-forget:
      // an unresolving promise is the safe outcome (we don't want
      // to crash the page on a missing video), and any rejection is
      // already handled inside the helper.
      waitFor('video', 1200).then(() => {
        try {
          initResume();
        } catch (e) {
          getLogger()?.warn?.('Time', 'initResume after waitFor threw', e);
        }
      });
    } else {
      requestAnimationFrame(initResume);
    }
  };

  // Listen for navigation events used by YouTube SPA. The 150ms
  // delay lets the new <video> element mount before we look for it.
  const onNavigate = () => setTimeout(initResume, 150);

  onDomReady(() => {
    ensureResumeStyles();
    initResume();
  });

  // YouTube internal navigation event
  if (window?.document) {
    const cm = getCleanupManager();
    if (cm && typeof cm.registerListener === 'function') {
      cm.registerListener(document, 'yt-navigate-finish', onNavigate, {
        passive: true,
      });
    } else {
      document.addEventListener('yt-navigate-finish', onNavigate, {
        passive: true,
      });
    }
  }

  /**
   * React to settings updates by toggling the resume feature. Also
   * subscribes to the canonical `youtube-plus-settings-updated` event
   * so changes in the settings modal propagate immediately.
   * @param {Event} e
   */
  const settingsUpdatedHandler = /** @param {Event} e */ e => {
    try {
      const nextEnabled = /** @type {CustomEvent} */ (e)?.detail?.enableResumeTime !== false;
      if (nextEnabled === featureEnabled) return;
      setFeatureEnabled(nextEnabled);
    } catch (_e) {
      /* empty */
      setFeatureEnabled(U?.loadFeatureEnabled?.('enableResumeTime') ?? true);
    }
  };
  const cm = getCleanupManager();
  if (cm && typeof cm.registerListener === 'function') {
    cm.registerListener(window, 'youtube-plus-settings-updated', settingsUpdatedHandler);
  } else {
    window.addEventListener('youtube-plus-settings-updated', settingsUpdatedHandler);
  }

  // ==================== A-B Loop Control ====================

  /**
   * A-B loop control state. `pointA` / `pointB` are stored in
   * seconds from the start of the video; `null` means "unset".
   * @typedef {{
   *   enabled: boolean,
   *   pointA: number | null,
   *   pointB: number | null,
   *   storageKey: string,
   *   timeUpdateListener: ((this: HTMLVideoElement, ev: Event) => void) | null
   * }} LoopState
   */

  /** @type {LoopState} */
  const loopControl = {
    enabled: false,
    pointA: null,
    pointB: null,
    storageKey: 'youtube_loop_state',
    timeUpdateListener: null,
  };

  const _featureEnabled = () => U?.loadFeatureEnabled?.('enableLoop') !== false;
  const _t = U?.t || (s => s);

  /**
   * Compute the [start, end] seconds range for the current loop
   * points, normalized so start <= end. Returns `null` when only
   * one or zero points are set.
   * @returns {{ start: number, end: number } | null}
   */
  const getLoopRange = () => {
    const a = loopControl.pointA;
    const b = loopControl.pointB;
    if (a === null || b === null) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  };

  /** Persist the loop state to localStorage. Non-fatal on failure. */
  function saveLoopState() {
    try {
      const state = {
        enabled: loopControl.enabled,
        pointA: loopControl.pointA,
        pointB: loopControl.pointB,
      };
      localStorage.setItem(loopControl.storageKey, JSON.stringify(state));
    } catch (e) {
      getLogger()?.warn?.('Time', 'Failed to save loop state', e);
    }
  }

  function removeLoopListener() {
    if (loopControl.timeUpdateListener) {
      const video = /** @type {HTMLVideoElement | null} */ (document.querySelector('video'));
      if (video) {
        try {
          video.removeEventListener('timeupdate', loopControl.timeUpdateListener);
        } catch (_e) {
          /* Intentional: element may be detached */
        }
      }
      loopControl.timeUpdateListener = null;
    }
  }

  /**
   * Install a timeupdate listener that snaps the video back to
   * `startTime` whenever it reaches `endTime`.
   * @param {HTMLVideoElement} video
   */
  function setupLoopListener(video) {
    removeLoopListener();
    const range = getLoopRange();
    if (!range) return;

    loopControl.timeUpdateListener = () => {
      if (loopControl.enabled && video.currentTime >= range.end) {
        video.currentTime = range.start;
      }
    };

    video.addEventListener('timeupdate', loopControl.timeUpdateListener);
  }

  /** Render the on-screen progress-bar indicator for the loop range. */
  function updateLoopProgressBar() {
    if (loopControl.pointA === null && loopControl.pointB === null) {
      const existingIndicator = document.querySelector('.ytp-plus-loop-indicator');
      if (existingIndicator) existingIndicator.remove();
      return;
    }

    const video = /** @type {HTMLVideoElement | null} */ (document.querySelector('video'));
    if (!video?.duration) return;

    /** @type {Element | null} */
    let progressBar =
      document.querySelector('.ytp-progress-bar-container') ||
      document.querySelector('.ytp-scrubber-container') ||
      document.querySelector('[role="slider"][aria-label*="video"]') ||
      document.querySelector('.html5-progress-bar');

    if (!progressBar) {
      const playbackUI = document.querySelector('.html5-video-player');
      if (playbackUI) {
        progressBar = playbackUI.querySelector('[role="slider"]');
      }
    }

    if (!progressBar) return;

    /** @type {HTMLElement | null} */
    let indicator = /** @type {HTMLElement | null} */ (
      document.querySelector('.ytp-plus-loop-indicator')
    );
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'ytp-plus-loop-indicator';
      try {
        const compStyle = window.getComputedStyle(progressBar);
        if (!compStyle || compStyle.position === 'static') {
          /** @type {HTMLElement} */ (progressBar).style.position = 'relative';
        }
      } catch (_e) {
        /* Intentional: progressBar may be detached */
      }
      progressBar.appendChild(indicator);
      indicator.style.position = 'absolute';
      indicator.style.top = '0';
      indicator.style.height = '100%';
      indicator.style.pointerEvents = 'none';
      indicator.style.zIndex = '1000';
    }

    if (loopControl.pointA !== null && loopControl.pointB === null) {
      const startPercent = (loopControl.pointA / video.duration) * 100;
      indicator.style.left = `${startPercent}%`;
      indicator.style.width = '2px';
      indicator.style.background =
        'linear-gradient(90deg,var(--yt-accent-secondary),var(--yt-accent-secondary-light))';
      indicator.style.borderLeft = '2px solid var(--yt-accent-secondary)';
      indicator.style.borderRight = '2px solid var(--yt-accent-secondary)';
      indicator.style.display = 'block';
      return;
    }

    if (loopControl.pointB !== null && loopControl.pointA === null) {
      const bPercent = (loopControl.pointB / video.duration) * 100;
      indicator.style.left = `${bPercent}%`;
      indicator.style.width = '2px';
      indicator.style.background =
        'linear-gradient(90deg,var(--yt-accent-secondary),var(--yt-accent-secondary-light))';
      indicator.style.borderLeft = '2px solid var(--yt-accent-secondary)';
      indicator.style.borderRight = '2px solid var(--yt-accent-secondary)';
      indicator.style.display = 'block';
      return;
    }

    const range = getLoopRange();
    if (!range) return;
    const startPercent = (range.start / video.duration) * 100;
    const endPercent = (range.end / video.duration) * 100;

    indicator.style.left = `${startPercent}%`;
    indicator.style.width = `${Math.max(0.2, endPercent - startPercent)}%`;
    indicator.style.background =
      'linear-gradient(90deg,var(--yt-accent-secondary-ghost) 0%,var(--yt-accent-secondary-light-ghost) 50%,var(--yt-accent-secondary-ghost) 100%)';
    indicator.style.borderLeft = '2px solid var(--yt-accent-secondary)';
    indicator.style.borderRight = '2px solid var(--yt-accent-secondary)';
    indicator.style.display = 'block';
  }

  /** Public: toggle A-B loop on the current `<video>`. */
  function toggleLoop() {
    if (!_featureEnabled()) return;

    loopControl.enabled = !loopControl.enabled;

    /** @type {HTMLVideoElement | null} */
    const video = /** @type {HTMLVideoElement | null} */ (document.querySelector('video'));
    if (!video) {
      saveLoopState();
      return;
    }

    if (loopControl.enabled) {
      if (loopControl.pointA === null && loopControl.pointB === null) {
        video.loop = true;
      } else {
        video.loop = false;
        setupLoopListener(video);
      }
      U?.NotificationManager.show(_t('loopEnabled'), {
        duration: 1500,
        type: 'success',
      });
    } else {
      video.loop = false;
      removeLoopListener();
      U?.NotificationManager.show(_t('loopDisabled'), {
        duration: 1500,
        type: 'info',
      });
    }

    updateLoopProgressBar();
    saveLoopState();
  }

  /**
   * Public: set loop point A or B to the current `currentTime`.
   * @param {'A' | 'B'} point
   */
  function setLoopPoint(point) {
    if (!_featureEnabled()) return;

    /** @type {HTMLVideoElement | null} */
    const video = /** @type {HTMLVideoElement | null} */ (document.querySelector('video'));
    if (!video) return;

    const currentTime = video.currentTime;

    if (point === 'A') {
      loopControl.pointA = currentTime;
      U?.NotificationManager.show(`${_t('loopPointASet')}: ${formatTime(currentTime)}`, {
        duration: 1500,
        type: 'success',
      });
    } else if (point === 'B') {
      loopControl.pointB = currentTime;
      U?.NotificationManager.show(`${_t('loopPointBSet')}: ${formatTime(currentTime)}`, {
        duration: 1500,
        type: 'success',
      });
    }

    // If both points are set and loop is active, (re-)install the
    // timeupdate listener using the normalized range.
    if (loopControl.enabled && getLoopRange()) {
      video.loop = false;
      setupLoopListener(video);
    }

    updateLoopProgressBar();
    saveLoopState();
  }

  /** Public: clear loop points A and B. */
  function resetLoopPoints() {
    if (!_featureEnabled()) return;

    loopControl.pointA = null;
    loopControl.pointB = null;

    if (loopControl.enabled) {
      const video = /** @type {HTMLVideoElement | null} */ (document.querySelector('video'));
      if (video) {
        video.loop = true;
        removeLoopListener();
      }
    }

    U?.NotificationManager.show(_t('loopPointsReset'), {
      duration: 1500,
      type: 'info',
    });

    updateLoopProgressBar();
    saveLoopState();
  }

  /** Public: re-apply the saved loop state to the current `<video>`. */
  function applyLoopStateToCurrentVideo() {
    const video = /** @type {HTMLVideoElement | null} */ (document.querySelector('video'));
    if (!video) return;

    removeLoopListener();

    if (!(_featureEnabled() && loopControl.enabled)) {
      video.loop = false;
      updateLoopProgressBar();
      return;
    }

    if (getLoopRange()) {
      video.loop = false;
      setupLoopListener(video);
    } else {
      video.loop = true;
    }

    updateLoopProgressBar();
  }

  /** Load and validate the persisted loop state. */
  function loadLoopState() {
    try {
      const saved = localStorage.getItem(loopControl.storageKey);
      if (saved) {
        const state = JSON.parse(saved);
        loopControl.enabled = Boolean(state?.enabled);
        loopControl.pointA =
          typeof state?.pointA === 'number' && Number.isFinite(state.pointA) ? state.pointA : null;
        loopControl.pointB =
          typeof state?.pointB === 'number' && Number.isFinite(state.pointB) ? state.pointB : null;

        timeSetTimeout_(() => applyLoopStateToCurrentVideo(), 1000);
      }
    } catch (e) {
      getLogger()?.warn?.('Time', 'Failed to load loop state', e);
    }
  }

  /**
   * Public A-B loop API used by hotkey handlers in basic.js and the
   * keyboard shortcut module. Backed by `loopControl` state and
   * `localStorage[loopControl.storageKey]`.
   * @type {{
   *   toggleLoop: () => void,
   *   setLoopPoint: (point: 'A' | 'B') => void,
   *   resetLoopPoints: () => void,
   *   applyLoopStateToCurrentVideo: () => void
   * }}
   */
  window.YouTubePlusTimeLoop = {
    toggleLoop,
    setLoopPoint,
    resetLoopPoints,
    applyLoopStateToCurrentVideo,
  };

  if (_featureEnabled()) {
    timeSetTimeout_(loadLoopState, 1000);
  }
})();
