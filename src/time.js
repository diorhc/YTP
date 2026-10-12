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
//     small helpers, so the module works even when it loads before
//     logger.js / cleanup-manager.js.
//   - Public surface (`YouTubePlusTimeLoop`) stays stable. Playback positions
//     and A-B loop state live in their own GM keys (`ytp_resume_v1` /
//     `ytp_loop_v1`), not the settings blob, so frequent writes never wake the
//     cross-tab blob listener; the legacy localStorage keys are read once for
//     migration and left untouched.

(function () {
  if (window.__ytpTimeInitDone__) return;
  window.__ytpTimeInitDone__ = true;

  const U = window.YouTubeUtils;
  // Stable dock-button closures and hover wiring, so repeated
  // mountDock calls dedup to a single live registration per event.
  /** @type {WeakMap<HTMLElement, (e: Event) => void>} */
  const loopClickHandlers = new WeakMap();
  /** @type {WeakMap<HTMLElement, () => void>} */
  const loopPopoverWiring = new WeakMap();
  /**
   * Delegated click disposals for the Vision loop pill, keyed by the pill
   * element. The pill is reused across re-renders, so the delegated
   * registration is created once and re-population stays a pure content
   * update instead of stacking four fresh listener entries per render.
   * @type {WeakMap<HTMLElement, () => void>}
   */
  const loopPillClickDisposals = new WeakMap();
  /**
   * Single-slot owner of the classic loop hover wiring. Exactly one classic
   * loop button exists at a time (active-surface-only mount); the disposer
   * owns both the button's and the shared dropdown's native listeners, so
   * replacing the button releases the wiring instead of stacking it on the
   * reused dropdown.
   * @type {(() => void) | null}
   */
  let classicLoopPopoverDispose = /** @type {(() => void) | null} */ (null);
  /**
   * Single-slot owner of the classic dropdown click delegation plus the
   * element it is bound to, so a page-replaced dropdown releases cleanly.
   * @type {{ el: HTMLElement, dispose: () => void } | null}
   */
  let classicLoopDropdownDelegation =
    /** @type {{ el: HTMLElement, dispose: () => void } | null} */ (null);
  /** Release key for the classic loop button click listener. @type {symbol | null} */
  let classicLoopButtonClickKey = null;
  /**
   * The classic loop state listener is a session-lifetime registration (like
   * the vision pill's): it resolves the current classic buttons at dispatch
   * time and is registered exactly once, so per-mount lifecycle cycles can
   * never stack a persistent document listener per button.
   */
  let classicLoopStateListenerRegistered = false;
  /** Session-scoped state listener: resolves the pill at dispatch time. */
  const loopStateHandler = () => {
    const pill = /** @type {HTMLElement|null} */ (document.getElementById('yp-vision-loop-pill'));
    if (!pill?.classList.contains('visible')) return;
    const state = window.YouTubePlusTimeLoop?.getLoopState?.() || {
      enabled: false,
      pointA: null,
      pointB: null,
    };
    populateVisionLoopPill(pill, state);
  };
  const logS = /** @type {(err: unknown, label?: string) => void} */ (
    (/** @type {unknown} */ err, /** @type {string|undefined} */ label = undefined) =>
      U?.logSuppressed?.(err, label || 'Time')
  );
  const withErrorBoundary = U.createWithErrorBoundary('Time');
  /**
   * Stable classic-surface state handler. Registered once (see
   * addClassicLoopButton) as a session-lifetime document listener; it colors
   * every existing classic loop button and refreshes the classic dropdown
   * when visible, resolving current DOM at dispatch time instead of closing
   * over a per-mount button.
   */
  const classicLoopStateHandler = () => {
    const state = window.YouTubePlusTimeLoop?.getLoopState?.();
    if (!state) return;
    const color = state.enabled ? 'var(--yt-accent, #ff0033)' : '';
    for (const btn of document.querySelectorAll('.yp-loop-button')) {
      /** @type {HTMLElement} */ (btn).style.color = color;
    }
    const dropdown = document.getElementById('yp-classic-loop-dropdown');
    if (dropdown?.classList.contains('visible')) {
      populateClassicLoopDropdown(dropdown, state);
    }
  };

  /**
   * Minimal logger shape covering logger.js createLogger() and the lightweight
   * test shims. Methods are optional so `?.warn?.(...)` stays safe.
   * @typedef {{
   *   error?: (...args: unknown[]) => void,
   *   warn?: (...args: unknown[]) => void,
   *   info?: (...args: unknown[]) => void,
   *   debug?: (...args: unknown[]) => void,
   *   log?: (...args: unknown[]) => void
   * }} MinimalLogger
   */

  /**
   * Resolve the logger at call time. Capturing it once at IIFE start is
   * unsafe when this file loads before logger.js.
   * @returns {MinimalLogger | null}
   */
  const getLogger = () =>
    /** @type {MinimalLogger | null} */ (window.YouTubePlusLogger || U?.logger || null);

  /**
   * Resolve the cleanupManager at call time. The same instance is shared
   * across modules via `YouTubeUtils.cleanupManager` (a lazy getter defined
   * in utils.js) or the `YouTubePlusCleanupManager` global fallback.
   * @returns {CleanupManager | null}
   */
  const getCleanupManager = () => {
    return U?.cleanupManager || window.YouTubePlusCleanupManager || null;
  };

  /**
   * Resume playback follows the FeatureLifecycle contract
   * (feature-registry.js): `resumeCtx` exists only while the setting is
   * on, and the per-video group (`videoScope`) is rebuilt for every
   * attached <video>, so a replaced player releases exactly its own
   * listeners, overlay and timers.
   * @type {YouTubePlusFeatureContext | null}
   */
  let resumeCtx = null;
  /** @type {YouTubePlusFeatureContext | null} */
  let videoScope = null;

  // Narrow setTimeout wrapper. `YouTubeUtils.setTimeout_` (if present)
  // routes the timer through the cleanupManager so the central lifecycle can
  // dispose it on SPA cleanup; otherwise fall back to the native setTimeout
  // so a scheduled callback is never silently dropped.
  /** @type {(...args: unknown[]) => unknown} */
  const timeSetTimeout_ =
    /** @type {(...args: unknown[]) => unknown} */ (U?.setTimeout_) || setTimeout;

  // Shared DOM helpers from YouTubeUtils
  const { $, byId } = U || {};
  const onDomReady =
    U?.onDomReady ||
    (cb => {
      if (document.readyState !== 'loading') cb();
      else
        window.YouTubePlusCleanupManager?.registerListener?.(
          document,
          'DOMContentLoaded',
          cb,
          { once: true },
          true
        );
    });

  /**
   * Document-level delegation for the overlay buttons, owned by the
   * running feature ctx.
   * @param {YouTubePlusFeatureContext} ctx
   */
  const setupResumeDelegation = ctx => {
    const handler = (/** @type {Event} */ _ev, /** @type {Element | null} */ target) => {
      const action = target?.getAttribute('data-yp-resume-action');
      if (!(action && target)) return;
      const wrap = target.closest('.yp-resume-overlay');
      if (!wrap) return;

      if (action === 'resume') {
        wrap.dispatchEvent(new CustomEvent('yp:resume', { bubbles: true }));
      } else if (action === 'restart') {
        wrap.dispatchEvent(new CustomEvent('yp:restart', { bubbles: true }));
      }
    };

    ctx.delegate(document, 'click', '.yp-resume-btn', handler);
    ctx.delegate(
      document,
      'keydown',
      '.yp-resume-btn',
      (/** @type {Event} */ ev, /** @type {Element} */ target) => {
        if (
          /** @type {KeyboardEvent} */ (ev).key === 'Enter' ||
          /** @type {KeyboardEvent} */ (ev).key === ' '
        ) {
          ev.preventDefault();
          handler(ev, target);
        }
      }
    );
  };

  const LEGACY_RESUME_STORAGE_KEY = 'youtube_resume_times_v1';
  const RESUME_STORAGE_KEY = 'ytp_resume_v1';
  const RESUME_SCHEMA_VERSION = 1;
  const OVERLAY_ID = 'yt-resume-overlay';
  const RESUME_STYLE_ID = 'yp-resume-overlay-styles';
  const AUTO_HIDE_MS = 10000; // hide overlay after 10s
  const RESUME_MAX_ENTRIES = 500; // cap for stored video positions
  const RESUME_PERSIST_DELAY_MS = 2000; // debounce window for storage writes
  const RESUME_MIN_WRITE_INTERVAL_MS = 5000; // minimum gap between writes

  // Translation helper: delegates to YouTubeUtils.t when present.
  const t =
    U?.t ||
    ((/** @type {string} */ key, /** @type {Record<string, unknown>} */ _p = {}) => {
      const val = key;
      if (!_p || Object.keys(_p).length === 0) return val;
      let result = val;
      for (const [k, v] of Object.entries(_p)) {
        const token = `{${k}}`;
        result = result.split(token).join(String(v));
      }
      return result;
    });

  /** @typedef {{ time: number, updatedAt: number }} ResumeEntry */

  // Standalone GM keys live outside the settings blob (the store falls back to
  // localStorage) so this state never wakes the cross-tab blob listener.

  /** In-memory resume map keyed by videoId. @type {Map<string, ResumeEntry> | null} */
  let resumeEntries = null;
  /** True when entries were staged since the last persist. */
  let resumeDirty = false;
  /** videoIds staged since the last persist. @type {Set<string>} */
  const resumeDirtyIds = new Set();
  /** Release for the debounced persist timer (feature-owned via ctx.timeout). */
  /** @type {(() => void) | null} */
  let resumePersistRelease = null;
  let resumeLastWriteAt = 0;

  /**
   * @param {unknown} value
   * @returns {ResumeEntry | null}
   */
  const normalizeResumeEntry_ = value => {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0
        ? { time: Math.floor(value), updatedAt: Date.now() }
        : null;
    }
    if (value && typeof value === 'object') {
      const rec = /** @type {{ time?: unknown, updatedAt?: unknown, timestamp?: unknown }} */ (
        value
      );
      const time = Number(rec.time);
      if (!Number.isFinite(time) || time <= 0) return null;
      const at = Number(rec.updatedAt ?? rec.timestamp);
      return { time: Math.floor(time), updatedAt: Number.isFinite(at) && at > 0 ? at : Date.now() };
    }
    return null;
  };

  /**
   * Parse a stored resume payload. Accepts the versioned shape
   * `{v, entries:{id:{time, updatedAt}}}` and the legacy flat shape
   * `{id: seconds}` or `{id: {time, updatedAt|timestamp}}`.
   * @param {string|null} raw
   * @returns {Map<string, ResumeEntry>}
   */
  const parseResumePayload_ = raw => {
    /** @type {Map<string, ResumeEntry>} */
    const out = new Map();
    if (!raw) return out;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_e) {
      logS(_e);
      return out;
    }
    const source =
      parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object'
        ? parsed.entries
        : parsed;
    if (!source || typeof source !== 'object') return out;
    for (const [id, value] of Object.entries(source)) {
      const entry = normalizeResumeEntry_(value);
      if (entry) out.set(id, entry);
    }
    return out;
  };

  /** Evict the oldest entries until the map is within the cap. @param {Map<string, ResumeEntry>} map */
  const capResumeEntries_ = map => {
    while (map.size > RESUME_MAX_ENTRIES) {
      let oldestId = null;
      let oldestAt = Infinity;
      for (const [id, entry] of map) {
        if (entry.updatedAt < oldestAt) {
          oldestAt = entry.updatedAt;
          oldestId = id;
        }
      }
      if (oldestId === null) break;
      map.delete(oldestId);
    }
  };

  /**
   * In-memory resume map. Hydrates from the standalone key once per page,
   * migrating the legacy localStorage key (both shapes) on first read.
   * @returns {Map<string, ResumeEntry>}
   */
  const readResumeEntries = () => {
    if (resumeEntries) return resumeEntries;
    let entries = new Map();
    try {
      entries = parseResumePayload_(
        window.YouTubePlusSettingsStore?.readGmKey?.(RESUME_STORAGE_KEY) ?? null
      );
      if (entries.size === 0) {
        const legacy = parseResumePayload_(
          U?.storage?.getItem?.(LEGACY_RESUME_STORAGE_KEY) ?? null
        );
        if (legacy.size > 0) {
          entries = legacy;
          resumeDirty = true;
          for (const id of entries.keys()) resumeDirtyIds.add(id);
          scheduleResumePersist();
        }
      }
    } catch (e) {
      logS(e);
      getLogger()?.warn?.('Time', 'Failed to parse resume storage', e);
      entries = new Map();
    }
    resumeEntries = entries;
    return resumeEntries;
  };

  const persistResumeMemoryNow = () => {
    resumePersistRelease?.();
    resumePersistRelease = null;
    if (!(resumeEntries && resumeDirty)) return;
    try {
      // Read-modify-write: another tab may have saved entries after our hydrate.
      const merged = parseResumePayload_(
        window.YouTubePlusSettingsStore?.readGmKey?.(RESUME_STORAGE_KEY) ?? null
      );
      for (const id of resumeDirtyIds) {
        const entry = resumeEntries.get(id);
        if (entry) merged.set(id, entry);
        else merged.delete(id);
      }
      capResumeEntries_(merged);
      const payload = JSON.stringify({
        v: RESUME_SCHEMA_VERSION,
        entries: Object.fromEntries(merged),
      });
      if (!(window.YouTubePlusSettingsStore?.writeGmKey?.(RESUME_STORAGE_KEY, payload) ?? false)) {
        throw new Error('resume persist rejected');
      }
      resumeEntries = merged;
      resumeDirty = false;
      resumeDirtyIds.clear();
      resumeLastWriteAt = Date.now();
    } catch (e) {
      logS(e);
      getLogger()?.warn?.('Time', 'Failed to save resume time', e);
    }
  };

  const scheduleResumePersist = () => {
    if (resumePersistRelease) return;
    const sinceLast = Date.now() - resumeLastWriteAt;
    const wait = Math.max(RESUME_PERSIST_DELAY_MS, RESUME_MIN_WRITE_INTERVAL_MS - sinceLast);
    resumePersistRelease =
      resumeCtx?.timeout(() => {
        resumePersistRelease = null;
        persistResumeMemoryNow();
      }, wait) || null;
  };

  /**
   * Stage one position update and schedule a debounced persist. Writes are
   * throttled (see scheduleResumePersist) so playback never floods storage.
   * @param {string} videoId
   * @param {number} seconds
   */
  const stageResumeEntry_ = (videoId, seconds) => {
    if (!(videoId && Number.isFinite(seconds) && seconds > 0)) return;
    const map = readResumeEntries();
    map.set(videoId, { time: Math.floor(seconds), updatedAt: Date.now() });
    resumeDirty = true;
    resumeDirtyIds.add(videoId);
    scheduleResumePersist();
  };

  /**
   * Extract the current video ID from a variety of YouTube page shapes
   * (URL `?v=`, the head link tag, embedded `ytInitialPlayerResponse`,
   * `/watch/...` and `/shorts/...` pathnames). Returns `null` when no ID can
   * be determined.
   * @returns {string | null}
   */
  const getVideoId = () => {
    try {
      const base = window.YouTubeUtils?.getVideoIdFromLocation?.();
      if (base) return base;

      const canonicalLink = $('link[rel="canonical"]');
      const meta = /** @type {HTMLLinkElement | null} */ (canonicalLink);
      if (meta?.href) {
        const u = new URL(meta.href);
        const vParam = u.searchParams.get('v');
        if (vParam) return vParam;

        // Try extracting from pathname (for /watch/ or /shorts/ URLs)
        const pathMatch = u.pathname.match(/\/(watch|shorts)\/([^/?]+)/);
        if (pathMatch?.[2]) return pathMatch[2];
      }

      // Fallback to ytInitialPlayerResponse
      const yipr = window.ytInitialPlayerResponse;
      const fromPlayer = yipr?.videoDetails?.videoId;
      if (typeof fromPlayer === 'string' && fromPlayer) return fromPlayer;

      // Last resort: try to extract from current URL pathname
      const pathMatch = window.location.pathname.match(/\/(watch|shorts)\/([^/?]+)/);
      if (pathMatch?.[2]) return pathMatch[2];

      return null;
    } catch (_e) {
      logS(_e);
      return null;
    }
  };

  /**
   * Build and mount the resume overlay. Every resource the overlay
   * acquires (DOM node, once-listeners, focus frame, auto-hide timer,
   * inline position fix on YouTube's containers) is owned by the given
   * group scope and released when it is disposed; the overlay is
   * skipped when one is already present.
   * @param {number} seconds
   * @param {() => void} onResume
   * @param {() => void} onRestart
   * @param {string} [videoId]
   * @param {YouTubePlusFeatureContext} [scope]
   */
  const createOverlay = (seconds, onResume, onRestart, videoId, scope) => {
    if (byId(OVERLAY_ID)) return;
    if (!scope) return;
    // A child scope so hiding the overlay releases exactly its own listeners,
    // timer and node without touching the video's.
    const overlayScope = typeof scope.scope === 'function' ? scope.scope() : scope;
    const wrap = overlayScope.own(document.createElement('div'));
    wrap.id = OVERLAY_ID;
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-label', t('resumePlayback'));
    if (videoId) wrap.setAttribute('data-vid', videoId);

    // Do NOT append inside #movie_player: YouTube recreates/empties that
    // element during full page loads and removes foreign DOM. Instead,
    // append to the player container (#player-container) when available;
    // it is a stable ancestor and gives us absolute positioning over the
    // video. Fall back to body only when the container is missing.
    wrap.className = 'yp-resume-overlay yp-resume-overlay';
    wrap.style.position = 'absolute';
    wrap.style.left = '50%';
    wrap.style.bottom = '5%';
    wrap.style.transform = 'translate(-50%,-50%)';
    wrap.style.zIndex = '2147483647';
    wrap.style.pointerEvents = 'auto';

    /**
     * Inline position changes on YouTube's own elements, restored when
     * the group releases.
     * @type {{ el: HTMLElement, prop: string, prev: string }[]}
     */
    const positionFixes = [];
    /**
     * @param {HTMLElement} el
     * @param {string} position
     */
    const fixPosition = (el, position) => {
      const computed = window.getComputedStyle(el);
      if (computed.position === position) {
        positionFixes.push({ el, prop: 'position', prev: el.style.position });
        el.style.position = 'relative';
      }
    };

    const playerContainer = $('#player-container');
    if (playerContainer instanceof HTMLElement) {
      fixPosition(playerContainer, 'static');
      playerContainer.appendChild(wrap);
    } else {
      const player = $('#movie_player');
      if (player instanceof HTMLElement) {
        fixPosition(player, 'static');
        player.appendChild(wrap);
      } else {
        wrap.style.position = 'fixed';
        wrap.style.bottom = '8%';
        (document.body || document.documentElement).appendChild(wrap);
      }
    }
    if (positionFixes.length) {
      overlayScope.onDispose(() => {
        for (const fix of positionFixes) fix.el.style.setProperty(fix.prop, fix.prev);
      });
    }

    const title = document.createElement('div');
    title.className = 'yp-resume-title';
    title.textContent = `${t('resumePlayback')} (${formatTime(seconds)})`;

    const btnResume = document.createElement('button');
    btnResume.className = 'yp-resume-btn primary';
    btnResume.textContent = t('resume');
    btnResume.setAttribute('aria-label', `${t('resume')} at ${formatTime(seconds)}`);
    btnResume.tabIndex = 0;
    btnResume.setAttribute('data-yp-resume-action', 'resume');

    const btnRestart = document.createElement('button');
    btnRestart.className = 'yp-resume-btn ghost';
    btnRestart.textContent = t('startOver');
    btnRestart.setAttribute('aria-label', t('startOver'));
    btnRestart.tabIndex = 0;
    btnRestart.setAttribute('data-yp-resume-action', 'restart');

    /** Release the overlay's own scope before removing it. */
    const removeOverlay = () => {
      overlayScope.dispose();
      wrap.remove();
    };

    /**
     * @param {() => void} cb
     * @param {string} label
     */
    const runAndRemove = (cb, label) => {
      try {
        cb();
      } catch (err) {
        logS(err);
        getLogger()?.error?.('Time', `${label} error`, err);
      }
      removeOverlay();
    };

    const handleResume = () => runAndRemove(onResume, 'Resume');
    const handleRestart = () => runAndRemove(onRestart, 'Restart');

    overlayScope.listen(wrap, 'yp:resume', () => handleResume(), { once: true });
    overlayScope.listen(wrap, 'yp:restart', () => handleRestart(), { once: true });

    // group actions and center them
    const actions = document.createElement('div');
    actions.className = 'yp-resume-actions';
    actions.appendChild(btnResume);
    actions.appendChild(btnRestart);

    wrap.appendChild(title);
    wrap.appendChild(actions);

    const updateOverlayLabels = () => {
      wrap.setAttribute('aria-label', t('resumePlayback'));
      title.textContent = `${t('resumePlayback')} (${formatTime(seconds)})`;
      btnResume.textContent = t('resume');
      btnResume.setAttribute('aria-label', `${t('resume')} at ${formatTime(seconds)}`);
      btnRestart.textContent = t('startOver');
      btnRestart.setAttribute('aria-label', t('startOver'));
    };
    window.addEventListener('youtube-plus-i18n-ready', updateOverlayLabels); // lint:custom:ignore managed by overlayScope.onDispose
    window.addEventListener('youtube-plus-language-changed', updateOverlayLabels); // lint:custom:ignore managed by overlayScope.onDispose
    overlayScope.onDispose(() => {
      window.removeEventListener('youtube-plus-i18n-ready', updateOverlayLabels);
      window.removeEventListener('youtube-plus-language-changed', updateOverlayLabels);
    });

    // Set focus to primary button for keyboard accessibility
    overlayScope.frame(() => btnResume.focus());

    // Auto-hide the overlay after the window elapses.
    overlayScope.timeout(removeOverlay, AUTO_HIDE_MS);
  };

  /**
   * Format seconds as `H:MM:SS` / `M:SS` for display in the overlay.
   * Delegates to `YouTubeUtils.formatTime` when present.
   * @param {number} secs
   * @returns {string}
   */
  const formatTime =
    U.formatTime ??
    ((/** @type {number} */ secs) => {
      if (!Number.isFinite(secs) || secs < 0) return '--:--';
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
    });

  /**
   * Attach resume handlers to a `<video>` element. Idempotent via
   * `videoEl._ytpResumeAttached`; re-attaching is a no-op. All video
   * listeners, the overlay and its timers live in the per-video group scope:
   * attaching a different video releases the group it replaces, and stopping
   * the feature releases the current one.
   * @param {HTMLVideoElement} videoEl
   */
  const attachResumeHandlers = videoEl => {
    if (!resumeCtx) return;
    if (videoEl?.tagName !== 'VIDEO') {
      getLogger()?.warn?.('Time', 'Invalid video element for resume handlers');
      return;
    }

    // Mark element to prevent duplicate handlers
    if (videoEl._ytpResumeAttached) return;
    videoEl._ytpResumeAttached = true;

    // The per-video group: rebuilt when another video attaches.
    videoScope?.dispose();
    videoScope = resumeCtx.scope();
    const scope = videoScope;
    scope.onDispose(() => {
      delete videoEl._ytpResumeAttached;
    });

    // Get current video ID dynamically each time
    const getCurrentVideoId = () => getVideoId();
    const vid = getCurrentVideoId();
    if (!vid) return;

    const saved = readResumeEntries().get(vid)?.time ?? null;

    // Save current time using `timeupdate` event (throttled) instead of interval
    /** @type {(() => void) | null} */
    let saveListenerRelease = null;
    let lastSavedAt = 0;
    const SAVE_THROTTLE_MS = 800; // minimum ms between writes

    const startSaving = () => {
      if (saveListenerRelease) return;
      saveListenerRelease = scope.listen(
        videoEl,
        'timeupdate',
        () => {
          try {
            // Get current video ID each time we save
            const currentVid = getCurrentVideoId();
            if (!currentVid) return;

            const currentSec = Math.floor(videoEl.currentTime || 0);
            const now = Date.now();
            if (currentSec && (!lastSavedAt || now - lastSavedAt > SAVE_THROTTLE_MS)) {
              stageResumeEntry_(currentVid, currentSec);
              lastSavedAt = now;
            }
          } catch (e) {
            logS(e);
            getLogger()?.warn?.('Time', 'Error saving playback time', e);
          }
        },
        { passive: true }
      );
    };

    const stopSaving = () => {
      saveListenerRelease?.();
      saveListenerRelease = null;
      lastSavedAt = 0;
    };

    // If saved time exists and is > 5s, show overlay
    if (saved && saved > 5 && !byId(OVERLAY_ID)) {
      createOverlay(
        saved,
        () => {
          try {
            videoEl.currentTime = saved;
            videoEl.play();
          } catch (e) {
            logS(e);
            getLogger()?.error?.('Time', 'Failed to resume playback', e);
          }
        },
        () => {
          try {
            videoEl.currentTime = 0;
            videoEl.play();
          } catch (e) {
            logS(e);
            getLogger()?.error?.('Time', 'Failed to start over', e);
          }
        },
        vid,
        scope
      );
    }

    // Start saving when playing
    scope.listen(videoEl, 'play', () => startSaving(), { passive: true });
    scope.listen(
      videoEl,
      'pause',
      () => {
        stopSaving();
        persistResumeMemoryNow();
      },
      { passive: true }
    );
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
  const initResume = withErrorBoundary(() => {
    if (!resumeCtx) return;
    // Only run on watch/shorts pages; the resume overlay applies to both.
    if (!/\/(watch|shorts)\b/.test(window.location.pathname)) {
      byId(OVERLAY_ID)?.remove();
      return;
    }

    // Drop an existing overlay unless it belongs to the current video id.
    const currentVid = getVideoId();
    const existingOverlay = byId(OVERLAY_ID);
    if (existingOverlay && existingOverlay.getAttribute('data-vid') !== currentVid) {
      existingOverlay.remove();
    }

    const videoEl = findVideoElement();
    if (videoEl) {
      attachResumeHandlers(videoEl);
      return;
    }

    // The player mounts its <video> shortly after navigation. Wait once;
    // a page that never gets one is picked up by the next navigation.
    const waitFor = U?.waitForElement || U?.waitFor;
    if (typeof waitFor !== 'function') return;
    waitFor('video', 1200).then((/** @type {Element | null} */ el) => {
      if (resumeCtx && el?.tagName === 'VIDEO') {
        attachResumeHandlers(/** @type {HTMLVideoElement} */ (el));
      }
    });
  }, 'initResume');

  // Navigation events from the YouTube SPA. The 150ms delay lets the new
  // <video> element mount before we look for it.
  /** @type {(() => void) | null} */
  let navRelease = null;
  const onNavigate = () => {
    navRelease?.();
    navRelease = resumeCtx?.timeout(() => initResume(), 150) || null;
  };

  /** @param {YouTubePlusFeatureContext} ctx */
  const startResume = ctx => {
    resumeCtx = ctx;
    ctx.style(RESUME_STYLE_ID, window.YouTubePlusDesignSystem?.getStyle?.(RESUME_STYLE_ID) || '');
    setupResumeDelegation(ctx);
    // Flush pending resume writes when the tab is hidden or closed;
    // owned by the feature and released with it.
    ctx.listen(window, 'visibilitychange', () => {
      if (document.hidden) persistResumeMemoryNow();
    });
    ctx.listen(window, 'pagehide', () => persistResumeMemoryNow());
    ctx.listen(document, 'yt-navigate-finish', onNavigate, { passive: true });
    initResume();
  };

  const stopResume = () => {
    // Persist a debounced write that would otherwise be lost with the
    // feature's timers.
    persistResumeMemoryNow();
    videoScope?.dispose();
    videoScope = null;
    resumeCtx = null;
  };

  /**
   * Resume playback on the FeatureLifecycle contract (feature-registry.js). The
   * host follows the `enableResumeTime` setting and drives start/stop.
   * @type {YouTubePlusFeatureHandle | null | undefined}
   */
  const resumeTimeFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'resumeTime',
    settingsKey: 'enableResumeTime',
    start: startResume,
    stop: stopResume,
  });

  window.YouTubePlusTimeResume = {
    createOverlay,
    readResumeEntries,
    stageResumeEntry: stageResumeEntry_,
    initResume,
  };

  onDomReady(() => resumeTimeFeature?.sync());

  // ==================== A-B Loop keyboard shortcuts ====================

  /**
   * Clamp a single hotkey value to a single lowercase character.
   * @param {unknown} value
   * @param {string} fallback
   * @returns {string}
   */
  const normalizeLoopHotkey_ = (value, fallback) => {
    const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (candidate) return candidate.slice(0, 1);
    return String(fallback || '')
      .trim()
      .toLowerCase()
      .slice(0, 1);
  };

  /**
   * Normalize every hotkey value in a map against defaults.
   * @param {Partial<LoopHotkeyMap> | null | undefined} source
   * @param {LoopHotkeyMap} defaults
   * @returns {LoopHotkeyMap}
   */
  const normalizeLoopHotkeyMap_ = (source, defaults) => {
    /** @type {Record<string, string>} */
    const out = { ...(source && typeof source === 'object' ? source : {}) };
    for (const rawKey of Object.keys(defaults)) {
      const key = /** @type {keyof LoopHotkeyMap} */ (rawKey);
      out[key] = normalizeLoopHotkey_(out[key], defaults[key]);
    }
    return /** @type {LoopHotkeyMap} */ (/** @type {unknown} */ (out));
  };

  /**
   * True when a keydown should drive the A-B loop hotkeys: a real key event,
   * no modifier held, the loop setting on, and no editable element focused.
   * @param {KeyboardEvent} e
   * @param {{ settings?: { enableLoop?: unknown }, isEditableTarget?: (target: EventTarget | null | undefined) => boolean } | null | undefined} enhancer
   * @returns {boolean}
   */
  const shouldHandleLoopHotkey = (e, enhancer) => {
    if (!e?.key) return false;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    const enhancerEnabled = enhancer?.settings?.enableLoop;
    const enabled =
      typeof enhancerEnabled === 'boolean'
        ? enhancerEnabled
        : U?.loadFeatureEnabled?.('enableLoop', true) !== false;
    if (!enabled) return false;
    return !U.isEditableActiveElement(enhancer);
  };

  /**
   * @typedef {{ toggleLoop: string, setPointA: string, setPointB: string, resetPoints: string }} LoopHotkeyMap
   */
  const LOOP_HOTKEY_DEFAULTS = Object.freeze(
    /** @type {LoopHotkeyMap} */
    ({ toggleLoop: 'r', setPointA: 'k', setPointB: 'l', resetPoints: 'o' })
  );

  /** Read loop hotkeys from the settings store and normalize them. */
  const readLoopHotkeys_ = () => {
    try {
      const store = window.YouTubePlusSettingsStore;
      const raw = /** @type {Partial<LoopHotkeyMap> | null | undefined} */ (
        store?.get?.('loopHotkeys', {})
      );
      return normalizeLoopHotkeyMap_(raw, LOOP_HOTKEY_DEFAULTS);
    } catch (e) {
      logS(e);
      getLogger()?.warn?.('Time', 'Failed to read loop hotkeys', e);
      return normalizeLoopHotkeyMap_({}, LOOP_HOTKEY_DEFAULTS);
    }
  };

  /**
   * Persist loop hotkeys to the settings store.
   * @param {Record<string, string>} hotkeys
   */
  const saveLoopHotkeys_ = hotkeys => {
    try {
      const store = window.YouTubePlusSettingsStore;
      if (store?.set) {
        store.set('loopHotkeys', hotkeys);
      }
    } catch (e) {
      logS(e);
      getLogger()?.warn?.('Time', 'Failed to save loop hotkeys', e);
    }
  };

  /** One-shot migration: rewrite stored hotkey values that equal the legacy
   *  defaults, then persist once. */
  const migrateLegacyLoopHotkeys_ = () => {
    try {
      const hotkeys = readLoopHotkeys_();
      let migrated = false;
      // values matching the legacy defaults: setPointA: 'l', setPointB: 'o', resetPoints: 'k'
      if (hotkeys.setPointA === 'l') {
        hotkeys.setPointA = 'k';
        migrated = true;
      }
      if (hotkeys.setPointB === 'o') {
        hotkeys.setPointB = 'l';
        migrated = true;
      }
      if (hotkeys.resetPoints === 'k') {
        hotkeys.resetPoints = 'o';
        migrated = true;
      }
      if (migrated) {
        saveLoopHotkeys_(hotkeys);
      }
    } catch (_e) {
      logS(_e);
      // ignore migration errors
    }
  };

  /** @type {((e: KeyboardEvent) => void) | null} */
  let loopHotkeyHandler_ = null;
  /** @type {boolean} */
  let loopHotkeysMigrated_ = false;

  /**
   * Register the A-B loop keyboard shortcuts. Can be called with an
   * enhancer surface (as basic.js does) or without arguments for
   * self-registration when this module loads after boot.
   *
   * Settings are re-read on every keystroke so changes made through
   * the settings modal take effect immediately without a page reload.
   * @param {{ settings?: { enableLoop?: boolean }, isEditableTarget?: (target: EventTarget | null | undefined) => boolean } | null} [enhancer]
   */
  function registerHotkeys(enhancer) {
    try {
      if (loopHotkeyHandler_) return;

      if (!loopHotkeysMigrated_) {
        migrateLegacyLoopHotkeys_();
        loopHotkeysMigrated_ = true;
      }

      loopHotkeyHandler_ = (/** @type {KeyboardEvent} */ e) => {
        if (!shouldHandleLoopHotkey(e, enhancer)) return;

        const key = String(e.key).toLowerCase();
        const hotkeys = readLoopHotkeys_();

        if (key === hotkeys.toggleLoop) {
          e.preventDefault();
          toggleLoop();
        } else if (key === hotkeys.setPointA) {
          e.preventDefault();
          setLoopPoint('A');
        } else if (key === hotkeys.setPointB) {
          e.preventDefault();
          setLoopPoint('B');
        } else if (key === hotkeys.resetPoints) {
          e.preventDefault();
          resetLoopPoints();
        }
      };

      const cm = getCleanupManager();
      if (cm && typeof cm.registerListener === 'function') {
        // Session lifetime: the once-guard above prevents re-registration.
        cm.registerListener(
          document,
          'keydown',
          /** @type {EventListener} */ (/** @type {unknown} */ (loopHotkeyHandler_)),
          true,
          'session'
        );
      } else {
        window.YouTubePlusCleanupManager?.registerListener?.(
          document,
          'keydown',
          /** @type {EventListener} */ (/** @type {unknown} */ (loopHotkeyHandler_)),
          true,
          true
        );
      }
    } catch (e) {
      logS(e);
      getLogger()?.warn?.('Time', 'Failed to register loop keyboard shortcuts', e);
    }
  }

  // ==================== A-B Loop Control ====================

  /**
   * A-B loop control state. `pointA` / `pointB` are stored in
   * seconds from the start of the video; `null` means "unset".
   * @typedef {{
   *   enabled: boolean,
   *   pointA: number | null,
   *   pointB: number | null,
   *   videoId: string | null,
   *   frameA: string | null,
   *   frameB: string | null,
   *   storageKey: string,
   *   timeUpdateListener: ((this: HTMLVideoElement, ev: Event) => void) | null
   * }} LoopState
   */

  /** @type {LoopState} */
  const loopControl = {
    enabled: false,
    pointA: null,
    pointB: null,
    // The video these points belong to; the loop is only ever applied to it.
    videoId: null,
    // Thumbnail previews (data URLs) captured when each loop point was set.
    // Not persisted; cheap to recapture on the next set.
    frameA: null,
    frameB: null,
    storageKey: 'ytp_loop_v1',
    timeUpdateListener: null,
  };

  const _featureEnabled = () => U?.loadFeatureEnabled?.('enableLoop') !== false;

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

  /** Persist the loop state to its standalone key. Non-fatal on failure. */
  function saveLoopState() {
    const videoId = getVideoId();
    loopControl.videoId = videoId;
    try {
      const state = {
        v: 1,
        videoId,
        enabled: loopControl.enabled,
        pointA: loopControl.pointA,
        pointB: loopControl.pointB,
      };
      if (
        !(
          window.YouTubePlusSettingsStore?.writeGmKey?.(
            loopControl.storageKey,
            JSON.stringify(state)
          ) ?? false
        )
      ) {
        throw new Error('loop state write rejected');
      }
    } catch (e) {
      logS(e);
      getLogger()?.warn?.('Time', 'Failed to save loop state', e);
    }
  }

  const getVideoElement = () =>
    /** @type {HTMLVideoElement | null} */ (
      window.YouTubePlusDOMCache?.querySelector?.('video') || document.querySelector('video')
    );

  function removeLoopListener() {
    if (loopControl.timeUpdateListener) {
      const video = getVideoElement();
      if (video) {
        video.removeEventListener('timeupdate', loopControl.timeUpdateListener);
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

    window.YouTubePlusCleanupManager?.registerListener?.(
      video,
      'timeupdate',
      loopControl.timeUpdateListener,
      undefined,
      false
    );
  }

  function removeLoopBubbles() {
    const bubbleA = document.querySelector('.yp-loop-bubble-a');
    if (bubbleA) bubbleA.remove();
    const bubbleB = document.querySelector('.yp-loop-bubble-b');
    if (bubbleB) bubbleB.remove();
  }

  /**
   * @param {Element} progressBar
   * @param {'A' | 'B'} point
   * @param {number} time
   * @param {number} percent
   * @param {boolean} isVision
   */
  function renderLoopBubble(progressBar, point, time, percent, isVision) {
    const selector = `.yp-loop-bubble-${point.toLowerCase()}`;
    let bubble = /** @type {HTMLElement|null} */ (progressBar.querySelector(selector));
    if (!bubble) {
      bubble = document.createElement('div');
      progressBar.appendChild(bubble);
    }
    bubble.className = `yp-loop-bubble-${point.toLowerCase()} ${isVision ? 'vision-loop-bubble' : 'classic-loop-bubble'}`;
    bubble.style.left = `${percent}%`;
    bubble.style.pointerEvents = 'none';

    if (isVision) {
      U.setSafeHTML?.(
        bubble,
        `
        <span class="yp-loop-badge-pill">${point}</span>
        <span class="yp-loop-badge-time">${formatTime(time)}</span>
        <div class="yp-loop-bubble-tail"></div>
      `
      );
    } else {
      U.setSafeHTML?.(
        bubble,
        `
        <div class="yp-loop-classic-flag">
          <span class="yp-loop-classic-flag-letter">${point}</span>
          <span class="yp-loop-classic-flag-time">${formatTime(time)}</span>
        </div>
        <div class="yp-loop-classic-needle"></div>
      `
      );
    }
  }

  function findLoopProgressBarElement() {
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
    return progressBar;
  }

  /** @param {Element} progressBar */
  function getOrCreateLoopIndicator(progressBar) {
    let indicator = /** @type {HTMLElement | null} */ (
      document.querySelector('.yp-loop-indicator')
    );
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'yp-loop-indicator';
      const compStyle = window.getComputedStyle(progressBar);
      if (!compStyle || compStyle.position === 'static') {
        /** @type {HTMLElement} */ (progressBar).style.position = 'relative';
      }
      progressBar.appendChild(indicator);
      indicator.style.position = 'absolute';
      indicator.style.top = '0';
      indicator.style.height = '100%';
      indicator.style.pointerEvents = 'none';
      indicator.style.zIndex = '1000';
    }
    return indicator;
  }

  /**
   * @param {Element} progressBar
   * @param {HTMLElement} indicator
   * @param {HTMLVideoElement} video
   * @param {'A' | 'B'} point
   * @param {boolean} isVision
   */
  function updateSingleLoopPointIndicator(progressBar, indicator, video, point, isVision) {
    const timeVal = point === 'A' ? loopControl.pointA : loopControl.pointB;
    if (timeVal === null) return;
    const percent = (timeVal / video.duration) * 100;
    indicator.style.left = `${percent}%`;
    indicator.style.width = '2px';
    indicator.style.display = 'block';
    renderLoopBubble(progressBar, point, timeVal, percent, isVision);
    const otherPoint = point === 'A' ? 'b' : 'a';
    const otherEl = progressBar.querySelector(`.yp-loop-bubble-${otherPoint}`);
    if (otherEl) otherEl.remove();
  }

  /** Render the on-screen progress-bar indicator for the loop range. */
  function updateLoopProgressBar() {
    if (loopControl.pointA === null && loopControl.pointB === null) {
      const existingIndicator = document.querySelector('.yp-loop-indicator');
      if (existingIndicator) existingIndicator.remove();
      removeLoopBubbles();
      return;
    }

    const video = getVideoElement();
    if (!video?.duration) return;

    const progressBar = findLoopProgressBarElement();
    if (!progressBar) return;

    const isVision =
      document.documentElement.getAttribute('data-yp-variant') === 'vision' ||
      document.documentElement.getAttribute('data-yp-layout') === 'vision' ||
      document.body.classList.contains('yp-vision-layout');

    const indicator = getOrCreateLoopIndicator(progressBar);

    if (loopControl.pointA !== null && loopControl.pointB === null) {
      updateSingleLoopPointIndicator(progressBar, indicator, video, 'A', isVision);
      return;
    }

    if (loopControl.pointB !== null && loopControl.pointA === null) {
      updateSingleLoopPointIndicator(progressBar, indicator, video, 'B', isVision);
      return;
    }

    const range = getLoopRange();
    if (!range) return;
    const startPercent = (range.start / video.duration) * 100;
    const endPercent = (range.end / video.duration) * 100;

    indicator.style.left = `${startPercent}%`;
    indicator.style.width = `${Math.max(0.2, endPercent - startPercent)}%`;
    indicator.style.display = 'block';

    renderLoopBubble(progressBar, 'A', range.start, startPercent, isVision);
    renderLoopBubble(progressBar, 'B', range.end, endPercent, isVision);
  }

  function notifyLoopStateChanged() {
    document.dispatchEvent(
      new CustomEvent('yp-loop-state-changed', {
        detail: {
          enabled: loopControl.enabled,
          pointA: loopControl.pointA,
          pointB: loopControl.pointB,
        },
      })
    );
  }

  /** Capture snapshot frame data URL from current video */
  function captureCurrentFrame() {
    const video = getVideoElement();
    if (!video?.videoWidth) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.8);
      }
    } catch (_e) {
      logS(_e);
      /* Intentional: cross-origin safety */
    }
    return null;
  }

  /** Public: toggle A-B loop on the current `<video>`. */
  function toggleLoop() {
    if (!_featureEnabled()) return;

    loopControl.enabled = !loopControl.enabled;

    const video = getVideoElement();
    if (!video) {
      saveLoopState();
      notifyLoopStateChanged();
      return;
    }

    if (loopControl.enabled) {
      if (loopControl.pointA === null && loopControl.pointB === null) {
        video.loop = true;
      } else {
        video.loop = false;
        setupLoopListener(video);
      }
      U?.NotificationManager.show(t('loopEnabled'), {
        duration: 1500,
        type: 'success',
      });
    } else {
      video.loop = false;
      removeLoopListener();
      U?.NotificationManager.show(t('loopDisabled'), {
        duration: 1500,
        type: 'info',
      });
    }

    updateLoopProgressBar();
    saveLoopState();
    notifyLoopStateChanged();
  }

  /**
   * Public: set loop point A or B to the current `currentTime`.
   * @param {'A' | 'B'} point
   */
  function setLoopPoint(point) {
    if (!_featureEnabled()) return;

    const video = getVideoElement();
    if (!video) return;

    const currentTime = video.currentTime;

    if (point === 'A') {
      loopControl.pointA = currentTime;
      loopControl.frameA = captureCurrentFrame();
      U?.NotificationManager.show(`${t('loopPointASet')}: ${formatTime(currentTime)}`, {
        duration: 1500,
        type: 'success',
      });
    } else if (point === 'B') {
      loopControl.pointB = currentTime;
      loopControl.frameB = captureCurrentFrame();
      U?.NotificationManager.show(`${t('loopPointBSet')}: ${formatTime(currentTime)}`, {
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
    notifyLoopStateChanged();
  }

  /** Public: clear loop points A and B. */
  function resetLoopPoints() {
    if (!_featureEnabled()) return;

    loopControl.pointA = null;
    loopControl.pointB = null;
    loopControl.frameA = null;
    loopControl.frameB = null;

    if (loopControl.enabled) {
      const video = getVideoElement();
      if (video) {
        video.loop = true;
        removeLoopListener();
      }
    }

    U?.NotificationManager.show(t('loopPointsReset'), {
      duration: 1500,
      type: 'info',
    });

    updateLoopProgressBar();
    saveLoopState();
    notifyLoopStateChanged();
  }

  /** Public: re-apply the saved loop state to the current `<video>`. */
  function applyLoopStateToCurrentVideo() {
    const video = getVideoElement();
    if (!video) return;

    removeLoopListener();

    if (!(_featureEnabled() && loopControl.enabled)) {
      video.loop = false;
      updateLoopProgressBar();
      notifyLoopStateChanged();
      return;
    }

    if (getLoopRange()) {
      video.loop = false;
      setupLoopListener(video);
    } else {
      video.loop = true;
    }

    updateLoopProgressBar();
    notifyLoopStateChanged();
  }

  /** Load and validate the persisted loop state, scoped to its own video. */
  function loadLoopState() {
    try {
      const raw = window.YouTubePlusSettingsStore?.readGmKey?.(loopControl.storageKey) ?? null;
      if (!raw) return;
      /** @type {Record<string, unknown>} */
      const state = JSON.parse(raw);
      if (!state || typeof state !== 'object') return;

      const currentVid = getVideoId();
      // Only the saved video's points are restored; another video's state is
      // neither applied nor erased.
      if (!currentVid || state.videoId !== currentVid) return;

      loopControl.videoId = currentVid;
      loopControl.enabled = Boolean(state.enabled);
      loopControl.pointA =
        typeof state.pointA === 'number' && Number.isFinite(state.pointA) ? state.pointA : null;
      loopControl.pointB =
        typeof state.pointB === 'number' && Number.isFinite(state.pointB) ? state.pointB : null;

      timeSetTimeout_(() => applyLoopStateToCurrentVideo(), 1000);
    } catch (e) {
      logS(e);
      getLogger()?.warn?.('Time', 'Failed to load loop state', e);
    }
  }

  /** @param {boolean} enabled */
  const refreshVisibility = enabled => {
    const btns = document.querySelectorAll('.yp-loop-button');
    btns.forEach(btn => {
      if (/** @type {HTMLElement} */ (btn).style) {
        /** @type {HTMLElement} */ (btn).style.setProperty(
          'display',
          enabled ? '' : 'none',
          'important'
        );
      }
    });
    const dd = document.querySelector('#yp-classic-loop-dropdown');
    if (dd && /** @type {HTMLElement} */ (dd).style) {
      /** @type {HTMLElement} */ (dd).style.setProperty(
        'display',
        enabled ? '' : 'none',
        'important'
      );
      if (!enabled) dd.classList.remove('visible');
    }
    const pill = document.querySelector('#yp-vision-loop-pill');
    if (pill && /** @type {HTMLElement} */ (pill).style) {
      /** @type {HTMLElement} */ (pill).style.setProperty(
        'display',
        enabled ? '' : 'none',
        'important'
      );
      if (!enabled) pill.classList.remove('visible');
    }
  };

  /**
   * Public A-B loop API used by hotkey handlers in basic.js and the
   * keyboard shortcut module. Backed by `loopControl` state and
   * `storage[loopControl.storageKey]`.
   * @type {{
   *   toggleLoop: () => void,
   *   setLoopPoint: (point: 'A' | 'B') => void,
   *   resetLoopPoints: () => void,
   *   applyLoopStateToCurrentVideo: () => void,
   *   registerHotkeys: (enhancer?: { settings?: { enableLoop?: boolean }, isEditableTarget?: (target: EventTarget | null | undefined) => boolean } | null) => void,
   *   getLoopState: () => { enabled: boolean, pointA: number | null, pointB: number | null, frameA: string | null, frameB: string | null },
   *   captureCurrentFrame: () => string | null,
   *   updateLoopProgressBar: () => void,
   *   refreshVisibility: (enabled: boolean) => void,
   *   [key: string]: unknown
   * }}
   */
  window.YouTubePlusTimeLoop = {
    toggleLoop,
    setLoopPoint,
    resetLoopPoints,
    applyLoopStateToCurrentVideo,
    registerHotkeys,
    refreshVisibility,
    getLoopState: () => ({
      enabled: loopControl.enabled,
      pointA: loopControl.pointA,
      pointB: loopControl.pointB,
      frameA: loopControl.frameA,
      frameB: loopControl.frameB,
    }),
    captureCurrentFrame,
    updateLoopProgressBar,
  };

  // --- Classic controls loop button (extracted from basic.js) ---
  const formatLoopTime = /** @param {number|null} tVal */ tVal => {
    if (typeof tVal !== 'number') return '--:--';
    const m = Math.floor(tVal / 60);
    const s = Math.floor(tVal % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  /** Delegated actions for the classic loop dropdown items. */
  const CLASSIC_LOOP_DROPDOWN_ACTIONS = /** @type {[string, () => void][]} */ ([
    ['.yp-classic-loop-toggle-item', () => window.YouTubePlusTimeLoop?.toggleLoop?.()],
    ['.yp-classic-set-a-item', () => window.YouTubePlusTimeLoop?.setLoopPoint?.('A')],
    ['.yp-classic-set-b-item', () => window.YouTubePlusTimeLoop?.setLoopPoint?.('B')],
    ['.yp-classic-reset-item', () => window.YouTubePlusTimeLoop?.resetLoopPoints?.()],
  ]);

  /**
   * Bind the classic dropdown's click delegation once per dropdown element.
   * The dropdown is a page-lifetime singleton; when the page replaces it,
   * addClassicLoopButton releases the delegation in this slot before
   * re-binding.
   * @param {HTMLElement} dropdown
   */
  const ensureClassicLoopDropdownDelegation = dropdown => {
    if (classicLoopDropdownDelegation && classicLoopDropdownDelegation.el === dropdown) return;
    classicLoopDropdownDelegation?.dispose?.();
    const d = window.YouTubePlusEventDelegation;
    if (!dropdown || typeof d?.on !== 'function') {
      classicLoopDropdownDelegation = null;
      return;
    }
    const offs = /** @type {(() => void)[]} */ ([]);
    for (const [selector, action] of CLASSIC_LOOP_DROPDOWN_ACTIONS) {
      const handler = (/** @type {Event} */ e, /** @type {HTMLElement|null} */ _target) => {
        e?.preventDefault?.();
        action();
      };
      d.on(dropdown, 'click', selector, handler);
      offs.push(() => d.off(dropdown, 'click', selector, handler));
    }
    classicLoopDropdownDelegation = {
      el: dropdown,
      dispose: () => {
        for (const off of offs) off();
      },
    };
  };

  /**
   * @param {HTMLElement} dropdown
   * @param {{ enabled: boolean, pointA: number|null, pointB: number|null }} state
   */
  const populateClassicLoopDropdown = (dropdown, state) => {
    const isEnabled = state.enabled;
    const timeA = formatLoopTime(state.pointA);
    const timeB = formatLoopTime(state.pointB);

    U.setSafeHTML?.(
      dropdown,
      `
        <div class="studio-dropdown-item yp-classic-loop-item yp-classic-loop-toggle-item${isEnabled ? ' is-active' : ''}">
          <span class="yp-classic-loop-item-left">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            <span>${t('enableLoopLabel') || 'Повтор видео'}</span>
          </span>
          <span class="yp-classic-loop-status-badge">${isEnabled ? 'ON' : 'OFF'}</span>
        </div>
        <div class="yp-classic-loop-divider"></div>
        <div class="studio-dropdown-item yp-classic-loop-item yp-classic-set-a-item${typeof state.pointA === 'number' ? ' has-point' : ''}">
          <span class="yp-classic-loop-item-left">
            <span class="yp-classic-loop-point-badge">A</span>
            <span>${t('setPointAHotkey') || 'Задать точку A'}</span>
          </span>
          <span class="yp-classic-loop-time-badge">${timeA}</span>
        </div>
        <div class="studio-dropdown-item yp-classic-loop-item yp-classic-set-b-item${typeof state.pointB === 'number' ? ' has-point' : ''}">
          <span class="yp-classic-loop-item-left">
            <span class="yp-classic-loop-point-badge">B</span>
            <span>${t('setPointBHotkey') || 'Задать точку B'}</span>
          </span>
          <span class="yp-classic-loop-time-badge">${timeB}</span>
        </div>
        <div class="yp-classic-loop-divider"></div>
        <div class="studio-dropdown-item yp-classic-loop-item yp-classic-reset-item">
          <span class="yp-classic-loop-item-left">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            <span>${t('loopPointsReset') || 'Сбросить A-B'}</span>
          </span>
        </div>
      `
    );

    // Delegation is registered once per dropdown and matches buttons by selector
    // at dispatch time, so re-populating the content registers nothing new.
    ensureClassicLoopDropdownDelegation(dropdown);
  };

  /** Stable classic loop button click handler; resolves state at dispatch time
   *  and is released by removeClassicLoopButton. */
  const classicLoopButtonClickHandler = (/** @type {Event} */ e) => {
    e.preventDefault();
    window.YouTubePlusTimeLoop?.toggleLoop?.();
  };

  /**
   * @param {HTMLElement} controls
   */
  const addClassicLoopButton = controls => {
    try {
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') return;
      if (!controls || controls.querySelector('.yp-loop-button')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ytp-button yp-loop-button';
      btn.setAttribute('title', t('enableLoopLabel') || 'Loop');
      btn.setAttribute('aria-label', t('enableLoopLabel') || 'Loop');
      btn.setAttribute('tabindex', '0');
      window.YouTubeUtils?.renderTemplateClone?.(
        btn,
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
      );

      // The page may replace the shared dropdown; release the stale delegation
      // slot before re-binding.
      if (classicLoopDropdownDelegation && !classicLoopDropdownDelegation.el.isConnected) {
        classicLoopDropdownDelegation.dispose();
        classicLoopDropdownDelegation = null;
      }
      let dropdown = /** @type {HTMLElement|null} */ (
        classicLoopDropdownDelegation?.el || document.querySelector('#yp-classic-loop-dropdown')
      );
      if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'yp-classic-loop-dropdown';
        document.body.appendChild(dropdown);
      }
      // The dropdown delegation is created once per element; content refreshes
      // never register anything.
      ensureClassicLoopDropdownDelegation(dropdown);

      const updateDropdown = () => {
        if (!dropdown) return;
        const state = window.YouTubePlusTimeLoop?.getLoopState?.() || {
          enabled: false,
          pointA: null,
          pointB: null,
        };
        btn.style.color = state.enabled ? 'var(--yt-accent, #ff0033)' : '';
        populateClassicLoopDropdown(dropdown, state);
      };

      const positionDropdown = () => {
        if (!dropdown) return;
        const rect = btn.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const clampedLeft = Math.max(
          120,
          Math.min(window.innerWidth - 120, rect.left + rect.width / 2)
        );
        dropdown.style.left = `${clampedLeft}px`;
        dropdown.style.bottom = `${window.innerHeight - rect.top + 10}px`;
        dropdown.style.top = 'auto';
        dropdown.style.right = 'auto';
      };

      // The classic popover wiring (button + shared dropdown listeners) is
      // owned by this slot: releasing it before wiring the new button keeps
      // native listeners from accumulating on the reused dropdown across
      // player mounts.
      classicLoopPopoverDispose?.();
      classicLoopPopoverDispose =
        window.YouTubePlusEventDelegation?.attachHoverPopover?.(btn, dropdown, {
          show: () => {
            updateDropdown();
            positionDropdown();
            dropdown.classList.add('visible');
          },
          hide: () => dropdown.classList.remove('visible'),
        }) || null;

      // The session-lifetime state listener is registered exactly once; the
      // stable handler resolves current buttons at dispatch time.
      if (!classicLoopStateListenerRegistered) {
        classicLoopStateListenerRegistered = true;
        window.YouTubePlusCleanupManager?.registerListener?.(
          document,
          'yp-loop-state-changed',
          classicLoopStateHandler,
          undefined,
          true
        );
      }

      // Per-mount click registration (non-persistent): swept with the
      // navigation sweep, re-created with the recreated button.
      classicLoopButtonClickKey = window.YouTubePlusCleanupManager?.registerListener?.(
        btn,
        'click',
        classicLoopButtonClickHandler,
        undefined,
        false
      );

      controls.insertBefore(btn, controls.firstChild);
    } catch (e) {
      logS(e);
    }
  };

  /**
   * Release the Classic loop surface: the button, its click listener, the
   * hover popover and the classic dropdown. The Vision pill is untouched.
   */
  const removeClassicLoopButton = () => {
    if (classicLoopButtonClickKey) {
      window.YouTubePlusCleanupManager?.unregisterListener?.(classicLoopButtonClickKey);
      classicLoopButtonClickKey = null;
    }
    for (const btn of document.querySelectorAll('.ytp-right-controls .yp-loop-button')) {
      btn.remove();
    }
    classicLoopPopoverDispose?.();
    classicLoopPopoverDispose = null;
    classicLoopDropdownDelegation?.dispose?.();
    classicLoopDropdownDelegation = null;
    document.getElementById('yp-classic-loop-dropdown')?.remove();
  };

  window.YouTubePlusTimeLoop.addClassicLoopButton = addClassicLoopButton;
  window.YouTubePlusTimeLoop.removeClassicLoopButton = removeClassicLoopButton;

  registerHotkeys();

  if (_featureEnabled()) {
    timeSetTimeout_(loadLoopState, 1000);
  }

  // --- FeatureRegistry descriptor: loop (Vision dock surface) ---
  // Owns the dock button and the hover loop pill; the loop feature has one
  // implementation.
  const descLoopIconSVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';

  const formatVisionLoopTime = (/** @type {number|null} */ tv) => {
    if (typeof tv !== 'number') return '--:--';
    const m = Math.floor(tv / 60);
    const s = Math.floor(tv % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const renderVisionLoopPreviewCard = (
    /** @type {'A' | 'B'} */ point,
    /** @type {string} */ pointTitle,
    /** @type {string} */ timeStr,
    /** @type {string} */ frame,
    /** @type {boolean} */ hasPoint
  ) => `
      <button class="yp-vision-loop-card yp-vision-set-btn yp-vision-set-${point.toLowerCase()}-btn${hasPoint ? ' has-point' : ''}" type="button">
        <div class="yp-vision-loop-card-top">
          <span class="yp-vision-loop-card-label">
            <span class="yp-vision-set-btn-tag">${point}</span>
            <span class="yp-vision-loop-card-title">${pointTitle}</span>
          </span>
          <span class="yp-vision-set-btn-val">${timeStr}</span>
        </div>
        <div class="yp-vision-loop-preview-box">
          ${
            frame
              ? `<img src="${frame}" class="yp-vision-loop-preview-img" alt="${pointTitle}" />`
              : `<div class="yp-vision-loop-preview-empty">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="4"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
                  <span>${t('noPreview') || 'Нет кадра'}</span>
                 </div>`
          }
        </div>
      </button>
    `;

  const populateVisionLoopPill = (
    /** @type {HTMLElement} */ loopPill,
    /** @type {{ enabled: boolean, pointA: number | null, pointB: number | null, frameA?: string | null, frameB?: string | null }} */ state
  ) => {
    const isEnabled = state.enabled;
    const timeA = formatVisionLoopTime(state.pointA);
    const timeB = formatVisionLoopTime(state.pointB);
    const durationSec =
      state.pointA !== null && state.pointB !== null
        ? `${Math.abs(Math.round(state.pointB - state.pointA))}с`
        : '';

    const labelA = `${t('pointA') || 'Точка A'} (${t('start') || 'Старт'})`;
    const labelB = `${t('pointB') || 'Точка B'} (${t('end') || 'Конец'})`;

    U.setSafeHTML?.(
      loopPill,
      `
        <div class="yp-vision-loop-header">
          <button class="yp-vision-loop-toggle-btn ${isEnabled ? 'is-active' : ''}" type="button">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.1"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            <span>Loop: ${isEnabled ? 'ON' : 'OFF'}</span>
          </button>
          <button class="yp-vision-reset-btn yp-studio-btn" type="button" title="Reset A-B">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          </button>
        </div>
        <div class="yp-vision-loop-cards">
          ${renderVisionLoopPreviewCard('A', labelA, timeA, state.frameA || '', state.pointA !== null)}
          <div class="yp-vision-loop-middle">
            <span class="yp-vision-loop-middle-arrow">→</span>
            ${durationSec ? `<span class="yp-vision-loop-middle-duration">${durationSec}</span>` : ''}
          </div>
          ${renderVisionLoopPreviewCard('B', labelB, timeB, state.frameB || '', state.pointB !== null)}
        </div>
      `
    );

    // The pill's click wiring is one delegated registration per pill element
    // (created on first populate). The pill is reused across re-renders, so
    // matching the fresh buttons by selector at dispatch time keeps
    // re-population from registering anything.
    ensureVisionLoopPillDelegation(loopPill);
  };

  /**
   * Bind the Vision loop pill's click delegation once per pill element.
   * Actions resolve the loop API at dispatch time; the disposer is held by
   * the mountDock dispose (host-owned custom mount).
   * @param {HTMLElement} pill
   */
  const ensureVisionLoopPillDelegation = pill => {
    if (!pill || loopPillClickDisposals.has(pill)) return;
    const d = window.YouTubePlusEventDelegation;
    if (typeof d?.on !== 'function') return;
    const actions = /** @type {[string, () => void][]} */ ([
      ['.yp-vision-loop-toggle-btn', () => toggleLoop()],
      ['.yp-vision-set-a-btn', () => setLoopPoint('A')],
      ['.yp-vision-set-b-btn', () => setLoopPoint('B')],
      ['.yp-vision-reset-btn', () => resetLoopPoints()],
    ]);
    const offs = /** @type {(() => void)[]} */ ([]);
    for (const [selector, action] of actions) {
      const handler = (/** @type {Event} */ e, /** @type {HTMLElement|null} */ _target) => {
        e?.preventDefault?.();
        action();
      };
      d.on(pill, 'click', selector, handler);
      offs.push(() => d.off(pill, 'click', selector, handler));
    }
    loopPillClickDisposals.set(pill, () => {
      for (const off of offs) off();
    });
  };

  window.YouTubePlusTimeLoop.populateVisionLoopPill = populateVisionLoopPill;

  const DESCRIPTOR = {
    id: 'loop',
    titleKey: 'enableLoopLabel',
    fallbackTitle: 'Loop',
    settingsKey: 'enableLoop',
    iconSVG: descLoopIconSVG,
    command(/** @type {unknown} */ _shim) {
      window.YouTubePlusTimeLoop?.toggleLoop?.();
      return true;
    },
    mountDock(/** @type {HTMLElement} */ player, /** @type {HTMLElement} */ dock) {
      try {
        let btn = /** @type {HTMLButtonElement|null} */ (dock.querySelector('#yp-vision-loop-btn'));
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'vision-dock-btn yp-loop-button';
          btn.id = 'yp-vision-loop-btn';
          const title = t('enableLoopLabel') || 'Loop';
          btn.setAttribute('title', title);
          btn.setAttribute('aria-label', title);
          btn.setAttribute('tabindex', '0');
          if (U?.setSafeHTML) {
            U.setSafeHTML(btn, descLoopIconSVG);
          } else if (window.YouTubePlusSafeDOM?.setInnerHTML) {
            window.YouTubePlusSafeDOM.setInnerHTML(btn, descLoopIconSVG);
          } else if (window.YouTubeSafeDOM?.setHTML) {
            window.YouTubeSafeDOM.setHTML(btn, descLoopIconSVG);
          }
          dock.appendChild(btn);
        }

        // Hover pill (was zoom.js setupVisionLoopPopover).
        let loopPill = /** @type {HTMLElement|null} */ (
          player.querySelector('#yp-vision-loop-pill')
        );
        if (!loopPill) {
          loopPill = document.createElement('div');
          loopPill.id = 'yp-vision-loop-pill';
          player.appendChild(loopPill);
        }

        const updatePillContent = () => {
          if (!loopPill) return;
          const state = window.YouTubePlusTimeLoop?.getLoopState?.() || {
            enabled: false,
            pointA: null,
            pointB: null,
          };
          populateVisionLoopPill(loopPill, state);
        };

        const positionPill = () => {
          const playerRect = player.getBoundingClientRect();
          const btnRect = btn.getBoundingClientRect();
          if (btnRect.width === 0 && btnRect.height === 0) return;
          const dockEl = window.YouTubePlusZoom?.closestDock?.(btn);
          const bottomAnchor = dockEl ? dockEl.getBoundingClientRect().bottom : btnRect.bottom;
          const left = btnRect.left - playerRect.left + btnRect.width / 2;
          const top = bottomAnchor - playerRect.top + 10;
          loopPill.style.left = `${left}px`;
          loopPill.style.right = 'auto';
          loopPill.style.top = `${top}px`;
          loopPill.style.bottom = 'auto';
        };

        // Re-attach the hover wiring cleanly: release the button's native
        // listeners before wiring a fresh set.
        const prevPopover = loopPopoverWiring.get(btn);
        if (prevPopover) prevPopover();
        const popoverDisposer = window.YouTubePlusEventDelegation?.attachHoverPopover?.(
          btn,
          loopPill,
          {
            show: () => {
              updatePillContent();
              positionPill();
              loopPill.classList.add('visible');
            },
            hide: () => loopPill.classList.remove('visible'),
          }
        );
        loopPopoverWiring.set(
          btn,
          typeof popoverDisposer === 'function' ? popoverDisposer : () => {}
        );

        // stable click closure (dedup-safe re-mounts).
        let clickFn = loopClickHandlers.get(btn);
        if (!clickFn) {
          clickFn = /** @type {(e: Event) => void} */ (
            e => {
              e.preventDefault();
              toggleLoop();
            }
          );
          loopClickHandlers.set(btn, clickFn);
        }
        const cm = window.YouTubePlusCleanupManager;
        const clickKey = cm?.registerListener?.(btn, 'click', clickFn, undefined, false);
        const stateKey = cm?.registerListener?.(
          document,
          'yp-loop-state-changed',
          loopStateHandler,
          undefined,
          true
        );
        // Dispose is idempotent; it releases the button registration, the
        // session-scoped state listener, the hover wiring and the delegated click.
        return () => {
          if (clickKey) cm?.unregisterListener?.(clickKey);
          if (stateKey) cm?.unregisterListener?.(stateKey);
          const wiring = loopPopoverWiring.get(btn);
          if (wiring) {
            wiring();
            loopPopoverWiring.delete(btn);
          }
          const pillClicks = loopPillClickDisposals.get(loopPill);
          if (pillClicks) {
            pillClicks();
            loopPillClickDisposals.delete(loopPill);
          }
        };
      } catch (e) {
        logS(e);
        return () => {};
      }
    },
  };

  window.YouTubePlusTimeLoop.DESCRIPTOR = DESCRIPTOR;
  window.YouTubePlusFeatureRegistry?.register?.(DESCRIPTOR);
})();
