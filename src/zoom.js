// Zoom: LazyLoader registered as 'zoom'.
//
// Responsibility: zoom UI with mouse-wheel, pinch, and keyboard
//   support for the YouTube video player. Persists zoom level and
//   position across SPA navigations.
// Public surface: window.YouTubePlusZoom.
(function () {
  const setTimeout_ = setTimeout.bind(window);
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'Zoom');

  const isRelevantRoute = U.createIsRelevantRoute({
    watch: true,
    shorts: true,
  });
  // Shared zoom-lens icon (single artwork for classic button + dock variants).
  const ZOOM_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';

  // Stable dock-button closures and hover wiring, so repeated
  // mountDock calls dedup to a single live registration per event.
  /** @type {WeakMap<HTMLElement, (e: Event) => void>} */
  const zoomClickHandlers = new WeakMap();
  /** @type {WeakMap<HTMLElement, () => void>} */
  const zoomPopoverWiring = new WeakMap();

  const mountVisionZoomButton = (
    /** @type {HTMLElement} */ player,
    /** @type {HTMLElement} */ dock,
    /** @type {HTMLElement} */ wrap,
    /** @type {HTMLElement} */ button
  ) => {
    const zoomBtn =
      button || /** @type {HTMLElement|null} */ (dock.querySelector('#yp-vision-zoom-btn'));
    if (!zoomBtn) return null;

    const positionVisionZoom = (/** @type {HTMLElement} */ wrapEl) => {
      const playerRect = player.getBoundingClientRect();
      const btnRect = zoomBtn.getBoundingClientRect();
      if (btnRect.width === 0 && btnRect.height === 0) return;
      const dockEl = zoomBtn.closest('.vision-top-center-dock');
      const bottomAnchor = dockEl ? dockEl.getBoundingClientRect().bottom : btnRect.bottom;
      const left = btnRect.left - playerRect.left + btnRect.width / 2;
      const top = bottomAnchor - playerRect.top + 10;
      wrapEl.style.left = `${left}px`;
      wrapEl.style.right = 'auto';
      wrapEl.style.top = `${top}px`;
      wrapEl.style.bottom = 'auto';
    };

    const showZoom = () => {
      positionVisionZoom(wrap);
      wrap.classList.add('visible');
    };
    // Re-attach the hover wiring: drop this button's native listeners
    // before wiring a fresh set.
    const prevWiring = zoomPopoverWiring.get(zoomBtn);
    if (prevWiring) prevWiring();
    const wiring = window.YouTubePlusEventDelegation?.attachHoverPopover?.(zoomBtn, wrap, {
      show: showZoom,
      hide: () => wrap.classList.remove('visible'),
    });
    zoomPopoverWiring.set(zoomBtn, typeof wiring === 'function' ? wiring : () => {});
    // stable per-button click closure (dedup-safe re-mounts). The wrap
    // is resolved at dispatch time, so one closure stays valid across
    // player replacements.
    let clickFn = zoomClickHandlers.get(zoomBtn);
    if (!clickFn) {
      clickFn = /** @type {(e: Event) => void} */ (
        e => {
          e.preventDefault();
          const currentWrap = /** @type {HTMLElement|null} */ (
            document.getElementById('yp-zoom-control')
          );
          if (currentWrap) {
            positionVisionZoom(currentWrap);
            currentWrap.classList.add('visible');
            const input = currentWrap.querySelector('input[type=range]');
            if (input instanceof HTMLElement) input.focus();
          }
        }
      );
      zoomClickHandlers.set(zoomBtn, clickFn);
    }
    return window.YouTubePlusCleanupManager?.registerListener?.(
      zoomBtn,
      'click',
      clickFn,
      undefined,
      false
    );
  };

  const DESCRIPTOR = Object.freeze({
    id: 'zoom',
    titleKey: 'zoom',
    fallbackTitle: 'Zoom',
    settingsKey: 'enableZoom',
    iconSVG: ZOOM_ICON_SVG,
    isAvailable: () => window.YouTubePlusZoom?.canRenderZoomUI?.() ?? true,
    command(/** @type {unknown} */ _shim) {
      if (!zoomModuleStarted) {
        initZoomModule();
      }
      const wrap = document.getElementById('yp-zoom-control');
      if (wrap) {
        wrap.classList.toggle('visible');
        if (wrap.classList.contains('visible')) {
          const input = wrap.querySelector('input[type=range]');
          if (input instanceof HTMLElement) input.focus();
        }
        return true;
      }
      if (typeof window.YouTubePlusZoom?.createZoomUI === 'function') {
        const created = window.YouTubePlusZoom.createZoomUI();
        if (created) {
          created.classList.add('visible');
          const input = created.querySelector('input[type=range]');
          if (input instanceof HTMLElement) input.focus();
          return true;
        }
      }
      return false;
    },
    mountDock(
      /** @type {HTMLElement} */ player,
      /** @type {HTMLElement} */ dock,
      /** @type {{ wrap?: HTMLElement } | undefined} */ ctx
    ) {
      if (!zoomModuleStarted) {
        initZoomModule();
      }
      // Button artwork/attributes (bypasses DOMCache to avoid null-TTL race)
      let btn = /** @type {HTMLButtonElement|null} */ (dock.querySelector('#yp-vision-zoom-btn'));
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vision-dock-btn yp-zoom-button';
        btn.id = 'yp-vision-zoom-btn';
        const title = U?.t?.('zoom') || 'Zoom';
        btn.setAttribute('title', title);
        btn.setAttribute('aria-label', title);
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('role', 'button');
        U?.renderTemplateClone?.(btn, ZOOM_ICON_SVG);
        dock.appendChild(btn);
      }
      const wrap = ctx?.wrap || document.getElementById('yp-zoom-control');
      if (wrap) {
        const clickKey = mountVisionZoomButton(player, dock, wrap, btn);
        // Idempotent dispose: releases the click registration and the
        // hover wiring for this button.
        return () => {
          if (clickKey) window.YouTubePlusCleanupManager?.unregisterListener?.(clickKey);
          const wiring = zoomPopoverWiring.get(btn);
          if (wiring) {
            wiring();
            zoomPopoverWiring.delete(btn);
          }
        };
      }
      // stable per-button closure so re-mounts dedup to one registration.
      // The listener registration/dispose shape is owned by the thumbnail
      // dock-button helper (it loads earlier in build order).
      let clickFn = zoomClickHandlers.get(btn);
      if (!clickFn) {
        clickFn = /** @type {(e: Event) => void} */ (
          e => {
            e.preventDefault();
            DESCRIPTOR.command({});
          }
        );
        zoomClickHandlers.set(btn, clickFn);
      }
      return window.YouTubePlusThumbnail.registerDockButtonListener(btn, clickFn);
    },
  });

  /** Find the Vision dock ancestor for popover/dropdown positioning. */
  const closestDock = (/** @type {Element|null} */ el) =>
    el && typeof el.closest === 'function' ? el.closest('.vision-top-center-dock') : null;

  if (typeof window !== 'undefined') {
    window.YouTubePlusZoom = Object.assign(window.YouTubePlusZoom || {}, {
      DESCRIPTOR,
      closestDock,
    });
    window.YouTubePlusFeatureRegistry?.register?.(DESCRIPTOR);
  }

  // Zoom runs as a lifecycle feature (FeatureLifecycle in feature-registry.js).
  // `zoomCtx` exists only while the setting is on and owns the zoom CSS; each
  // zoom UI instance (one per player) owns a child scope with all of its
  // listeners and observers, released when that UI is cleared.
  /** @type {YouTubePlusFeatureContext | null} */
  let zoomCtx = null;
  /** @type {(() => void) | null} */
  let onZoomStart = null;
  /** @type {(() => void) | null} */
  let onZoomStop = null;

  let zoomModuleStarted = false;
  const initZoomModule = () => {
    if (zoomModuleStarted) return;
    zoomModuleStarted = true;
    /** @type {YouTubePlusFeatureContext | null} */
    let uiScope = null;

    /**
     * Listener owned by the current zoom UI; a no-op when no UI is mounted.
     * @template {Event} E
     * @param {EventTarget} target
     * @param {string} type
     * @param {(ev: E) => void} fn
     * @param {AddEventListenerOptions} [opts]
     */
    const zoomListen = (target, type, fn, opts) =>
      uiScope?.listen(target, type, /** @type {EventListener} */ (fn), opts);

    /**
     * Animation frame owned by the current zoom UI. Returns a cancel function,
     * or null when no UI is mounted.
     * @param {FrameRequestCallback} fn
     * @returns {(() => void) | null}
     */
    const zoomFrame = fn => uiScope?.frame(fn) ?? null;
    /** @type {(() => void) | null} */
    let _activeZoomCleanup = null;
    /**
     * Single slot owner of the classic zoom hover wiring. Exactly one
     * classic zoom button exists at a time; the disposer owns that
     * button's and the shared zoom-control wrap's native listeners and must
     * be released before the next wiring instead of being discarded.
     * @type {(() => void) | null}
     */
    let classicZoomPopoverDispose = /** @type {(() => void) | null} */ (null);

    /**
     * Release the manager entries owned by the removed zoom UI (slider
     * input, reset button) immediately instead of letting them linger
     * (detached targets) until the navigation sweep.
     * @param {HTMLElement} ui
     */
    const releaseZoomControlEntries = ui => {
      const cmRelease = window.YouTubePlusCleanupManager;
      if (!cmRelease?.disconnectForElement) return;
      cmRelease.disconnectForElement(ui);
      for (const child of ui.querySelectorAll('input, button')) {
        cmRelease.disconnectForElement(child);
      }
    };

    const clearZoomUI = () => {
      // Locate the UI BEFORE the active cleanup removes it from the DOM,
      // so the entry release below can still find the (then detached)
      // elements. Removal lookups bypass DOMCache on purpose: a cached null
      // (1s null-TTL) would silently skip removing an element created after
      // the null was cached.
      const ui = document.getElementById('yp-zoom-control');
      if (_activeZoomCleanup) {
        _activeZoomCleanup();
        _activeZoomCleanup = null;
      }
      uiScope?.dispose();
      uiScope = null;
      // The classic hover wiring is owned by this slot; release it
      // before the buttons it binds disappear.
      classicZoomPopoverDispose?.();
      classicZoomPopoverDispose = null;
      if (ui) {
        releaseZoomControlEntries(ui);
        ui.remove();
      }
      const classicBtn = document.getElementById('yp-zoom-button');
      if (classicBtn) classicBtn.remove();
      window.YouTubePlusVisionDockHost?.removeFeatureButton?.('zoom');
      const zoomBtn = document.getElementById('yp-vision-zoom-btn');
      if (zoomBtn) zoomBtn.remove();
      const styles = document.getElementById('yp-zoom-styles');
      if (styles) styles.remove();
      // Resolve the video freshly: createZoomUI may never have run, so the
      // module-level `video` can still be null even when a video exists.
      const activeVideo = video || findVideoElement();
      if (activeVideo) {
        activeVideo.style.transform = '';
        activeVideo.style.willChange = '';
        activeVideo.style.transition = '';
        activeVideo.style.cursor = '';
      }
    };
    /** Clear the UI, or mount it when the feature runs. */
    const setFeatureEnabled = (/** @type {boolean|undefined} */ nextEnabled) => {
      if (nextEnabled === false) {
        clearZoomUI();
        return;
      }
      initZoom();
    };

    const isMiniPlayerActive = () => {
      // Gating checks must bypass DOMCache: a cached null for the miniplayer
      // selector (1s TTL) would mis-gate creation during page transitions.
      const mini = document.querySelector('ytd-miniplayer[active], ytd-miniplayer[enabled]');
      if (mini && mini instanceof HTMLElement) {
        if (mini.offsetParent !== null) return true;
        if (mini.getClientRects().length > 0) return true;
      }
      const miniWatch = document.querySelector(
        'ytd-watch-flexy[is-miniplayer], ytd-watch-flexy[miniplayer-is-active]'
      );
      return Boolean(miniWatch);
    };

    const canRenderZoomUI = () => Boolean(zoomCtx) && isRelevantRoute() && !isMiniPlayerActive();

    // Shared DOM helpers from YouTubeUtils
    const { $ } = U || {};
    const zoomLogger = U?.logger || null;

    const ZOOM_PAN_STORAGE_KEY = 'ytp_zoom_pan';
    const RESTORE_LOG_KEY = 'ytp_zoom_restore_log'; // stored in sessionStorage for debugging
    const DEFAULT_ZOOM = 1;
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 2.5;
    const ZOOM_STEP = 0.05;
    // Fullscreen apply timing (ms) and retries, tunable here.
    const FULLSCREEN_APPLY_DELAY = 80;
    const FULLSCREEN_APPLY_RETRIES = 4;
    const FULLSCREEN_APPLY_RETRY_DELAY = 120;

    // Helpers for combined zoom+pan storage
    function readZoomPan() {
      // Storage may be unavailable or hold stale/corrupt text.
      try {
        const raw = U.storage?.getItem(ZOOM_PAN_STORAGE_KEY);
        if (!raw) return { zoom: DEFAULT_ZOOM, panX: 0, panY: 0 };
        const obj = JSON.parse(raw);
        const zoom = Number(obj?.zoom) || DEFAULT_ZOOM;
        const panX = Number(obj?.panX) || 0;
        const panY = Number(obj?.panY) || 0;
        return { zoom, panX, panY };
      } catch (_e) {
        logS(_e);
        return { zoom: DEFAULT_ZOOM, panX: 0, panY: 0 };
      }
    }

    function saveZoomPan(
      /** @type {number} */ zoom,
      /** @type {number} */ panX,
      /** @type {number} */ panY
    ) {
      // Storage can be disabled or full.
      try {
        const obj = {
          zoom: Number(zoom) || DEFAULT_ZOOM,
          panX: Number(panX) || 0,
          panY: Number(panY) || 0,
        };
        U.storage?.setItem(ZOOM_PAN_STORAGE_KEY, JSON.stringify(obj));
      } catch (e) {
        logS(e);
        zoomLogger?.warn?.('Zoom', 'Failed to save zoom/pan settings', e);
      }
    }

    function logRestoreEvent(/** @type {Record<string, unknown>} */ evt) {
      /** @type {Record<string, unknown>} */
      let entry;
      // The restore log is best-effort debugging: sessionStorage quota or
      // disabled storage must not break the restore path.
      try {
        entry = Object.assign({ time: new Date().toISOString() }, evt);
        const raw = sessionStorage.getItem(RESTORE_LOG_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        arr.push(entry);
        // keep last 200 entries
        if (arr.length > 200) arr.splice(0, arr.length - 200);
        sessionStorage.setItem(RESTORE_LOG_KEY, JSON.stringify(arr));
      } catch (_e) {
        logS(_e);
        return;
      }
      // console output for live debugging (only when debug mode is active)
      if ((typeof window !== 'undefined' && window.YTP_DEBUG) || window.YouTubePlusConfig?.debug) {
        zoomLogger?.warn?.('Zoom', 'Zoom restore', entry);
      }
    }

    const findVideoElement = () => {
      const selectors = ['#movie_player video', 'video.video-stream', 'video'];
      for (const s of selectors) {
        const v = $(s);
        if (v && v.tagName === 'VIDEO') return /** @type {HTMLVideoElement} */ (v);
      }
      return null;
    };

    // Transform tracking state (module scope so helpers can access it)
    let _lastTransformApplied = '';
    let _isApplyingTransform = false;

    /** Transform for the requested zoom and pan, or an empty reset string. */
    const zoomTransformString = (
      /** @type {number} */ zoom,
      /** @type {number} */ panX,
      /** @type {number} */ panY
    ) =>
      zoom === 1 && panX === 0 && panY === 0
        ? ''
        : `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${zoom.toFixed(3)})`;

    const applyZoomToVideo = (
      /** @type {HTMLVideoElement|null} */ videoEl,
      /** @type {number} */ zoom,
      panX = 0,
      panY = 0,
      skipTransformTracking = false,
      skipTransition = false
    ) => {
      if (!videoEl) return;
      const container = videoEl.parentElement || videoEl;
      if (!skipTransformTracking) {
        _isApplyingTransform = true;
      }
      // Ensure container can display overflow content
      container.style.overflow = 'visible';
      if (!container.style.position || container.style.position === 'static') {
        container.style.position = 'relative';
      }
      // Set transform origin to center for natural zoom
      videoEl.style.transformOrigin = 'center center';
      const transformStr = zoomTransformString(zoom, panX, panY);
      videoEl.style.transform = transformStr;
      // Track the transform we just applied
      if (!skipTransformTracking) {
        _lastTransformApplied = transformStr;
      }
      // will-change keeps the transform on the GPU while it is active
      videoEl.style.willChange = transformStr ? 'transform' : 'auto';
      // Smooth transition for better UX (skip during fullscreen transitions to avoid flicker)
      videoEl.style.transition = skipTransition ? 'none' : 'transform .08s ease-out';
      // Reset flag after a short delay
      if (!skipTransformTracking) {
        setTimeout_(() => {
          _isApplyingTransform = false;
        }, 100);
      }
    };

    const setupZoomButton = (
      /** @type {HTMLElement} */ player,
      /** @type {HTMLElement} */ wrap
    ) => {
      // In Vision variant, the top dock owns the zoom button; classic right-controls are hidden.
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') {
        return;
      }
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() !== 'classic') {
        return;
      }
      const controls = /** @type {HTMLElement|null} */ ($('.ytp-right-controls', player));
      let zoomBtn = /** @type {HTMLButtonElement|null} */ ($('#yp-zoom-button', player));
      if (controls && !zoomBtn) {
        zoomBtn = document.createElement('button');
        zoomBtn.type = 'button';
        zoomBtn.className = 'ytp-button yp-zoom-button';
        zoomBtn.id = 'yp-zoom-button';
        zoomBtn.setAttribute('title', U.t('zoom') || 'Zoom');
        zoomBtn.setAttribute('aria-label', U.t('zoom') || 'Zoom');
        U.renderTemplateClone(zoomBtn, ZOOM_ICON_SVG);
        controls.insertBefore(zoomBtn, controls.firstChild);
      }

      const positionZoomControl = () => {
        if (!(zoomBtn && wrap && player)) return;
        const playerRect = player.getBoundingClientRect();
        const btnRect = zoomBtn.getBoundingClientRect();
        if (btnRect.width === 0 && btnRect.height === 0) return;
        const left = btnRect.left - playerRect.left + btnRect.width / 2;
        const bottom = playerRect.bottom - btnRect.top + 8;
        wrap.style.left = `${left}px`;
        wrap.style.right = 'auto';
        wrap.style.bottom = `${bottom}px`;
        wrap.style.top = 'auto';
      };

      const showZoomPopup = () => {
        positionZoomControl();
        wrap.classList.add('visible');
      };

      const hoverApi = window.YouTubePlusEventDelegation;
      if (zoomBtn && hoverApi?.attachHoverPopover) {
        // Release the existing classic wiring before re-wiring; the
        // disposer owns this button's and the shared wrap's native
        // listeners.
        classicZoomPopoverDispose?.();
        classicZoomPopoverDispose =
          hoverApi.attachHoverPopover(zoomBtn, wrap, {
            show: showZoomPopup,
            hide: () => wrap.classList.remove('visible'),
          }) || null;
        // Keyboard parity: focus/blur show/hide the same popover without delay.
        zoomListen(zoomBtn, 'focus', showZoomPopup);
        zoomListen(zoomBtn, 'blur', () => wrap.classList.remove('visible'));
      } else if (zoomBtn) {
        zoomListen(zoomBtn, 'mouseenter', showZoomPopup);
        zoomListen(zoomBtn, 'mouseleave', () => wrap.classList.remove('visible'));
      }
    };

    const setupVisionTopDock = (
      /** @type {HTMLElement} */ player,
      /** @type {HTMLElement} */ wrap
    ) => {
      // Active-surface-only mount: in Classic variant the player
      // right-controls own the feature buttons; skip the Vision Dock.
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'classic') {
        return;
      }
      window.YouTubePlusVisionDockHost?.mount?.(player, { wrap });
    };

    /** Vendor-prefixed fullscreen events (apply + reposition share them). */
    const FULLSCREEN_EVENTS_ = [
      'fullscreenchange',
      'webkitfullscreenchange',
      'mozfullscreenchange',
      'MSFullscreenChange',
    ];

    // Pan state shared by zoom/pan handlers (single zoom UI instance exists
    // at a time; createZoomUI resets it on rebuild).
    let panX = 0;

    /** Pure pan update from a drag start point plus delta. */
    const applyPan = (
      /** @type {number} */ startPanX,
      /** @type {number} */ startPanY,
      /** @type {number} */ dx,
      /** @type {number} */ dy
    ) => ({ panX: startPanX + dx, panY: startPanY + dy });

    /** Show grab cursor when zoomed in. */
    const updateZoomCursor = (
      /** @type {HTMLVideoElement|null} */ videoEl,
      /** @type {HTMLInputElement} */ input
    ) => {
      const current = parseFloat(input.value) || DEFAULT_ZOOM;
      if (videoEl) videoEl.style.cursor = current > 1 ? 'grab' : '';
    };

    /** Clamp pan to video bounds for the current zoom level. */
    function clampPan(/** @type {number} */ zoom = readZoomPan().zoom) {
      try {
        if (!video) return;
        const container = video.parentElement || video;
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        if (!(containerRect?.width && containerRect.height)) return;
        const baseW = video.videoWidth || video.offsetWidth || containerRect.width;
        const baseH = video.videoHeight || video.offsetHeight || containerRect.height;
        const scaledW = baseW * zoom;
        const scaledH = baseH * zoom;
        const maxX = Math.max(0, (scaledW - containerRect.width) / 2);
        const maxY = Math.max(0, (scaledH - containerRect.height) / 2);
        if (Number.isFinite(panX)) panX = Math.min(maxX, Math.max(-maxX, panX));
        if (Number.isFinite(panY)) panY = Math.min(maxY, Math.max(-maxY, panY));
      } catch (_e) {
        // Player layout metrics can be unavailable while the player DOM is
        // rebuilt; pan can stay unclamped in that transient state.
        logS(_e);
        zoomLogger?.error?.('Zoom', 'Clamp pan error', _e);
      }
    }

    // Single-instance UI state for the extracted zoom helpers.
    // Exactly one zoom UI exists at a time (createZoomUI guards it), so
    // these mirror the module-level video/panX/panY pattern.
    /** @type {HTMLInputElement | null} */
    let activeZoomInput = null;
    /** @type {string | null} */
    let videoStyleObserver = null;
    let playerObserverActive = false;

    // Drag/pinch pointer state shared by pointer/touch/mouse handlers and the
    // player observer (single zoom UI instance exists at a time; createZoomUI
    // resets it on rebuild).
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartPanX = 0;
    let dragStartPanY = 0;

    // Current video element for zoom UI (module-level because pointer handlers and
    // the player observer need the CURRENT video after player mutations swap it).
    /** @type {HTMLVideoElement | null} */
    let video = null;
    let panY = 0;

    /** @type {YouTubePlusFeatureContext | null} */
    let styledCtx = null;
    /** Zoom CSS lives as long as the running feature. */
    function injectZoomStyles() {
      if (!zoomCtx || styledCtx === zoomCtx) return;
      styledCtx = zoomCtx;
      zoomCtx.style(
        'yp-zoom-styles',
        window.YouTubePlusDesignSystem?.getStyle?.('yp-zoom-styles') || ''
      );
    }

    /** Build the zoom slider DOM. @returns {{wrap: HTMLDivElement, input: HTMLInputElement, label: HTMLDivElement, reset: HTMLButtonElement}} */
    function buildZoomControlDom() {
      const wrap = document.createElement('div');
      wrap.id = 'yp-zoom-control';
      wrap.style.opacity = '0';
      wrap.style.pointerEvents = 'none';

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(MIN_ZOOM);
      input.max = String(MAX_ZOOM);
      input.step = String(ZOOM_STEP);

      const label = document.createElement('div');
      label.className = 'zoom-label';
      label.setAttribute('role', 'status');
      label.setAttribute('aria-live', 'polite');
      label.setAttribute('aria-label', U.t('currentZoomLevel'));

      const reset = document.createElement('button');
      reset.className = 'zoom-reset';
      reset.type = 'button';
      reset.setAttribute('aria-label', U.t('resetZoom'));
      reset.title = U.t('resetZoom');
      U.renderTemplateClone(
        reset,
        `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4V1l-5 5 5 5V7a7 7 0 1 1-7 7" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  `
      );

      wrap.appendChild(input);
      wrap.appendChild(label);
      wrap.appendChild(reset);
      return { wrap, input, label, reset };
    }

    /**
     * Wheel: Shift + wheel to zoom (with throttling for performance).
     * @param {HTMLElement} player
     * @param {Element|null} video
     * @param {HTMLInputElement} input
     * @param {(z: number|string) => void} setZoom
     */
    function attachZoomWheelHandlers(player, video, input, setZoom) {
      /** @type {ReturnType<typeof setTimeout>|null} */
      let wheelThrottleTimer = null;
      // Throttled pan save timer to avoid excessive storage writes
      /** @type {ReturnType<typeof setTimeout>|null} */
      let panSaveTimer = null;
      const scheduleSavePan = () => {
        if (panSaveTimer) clearTimeout(panSaveTimer);
        panSaveTimer = setTimeout_(() => {
          const currentZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
          saveZoomPan(currentZoom, panX, panY);
          panSaveTimer = null;
        }, 220);
      };
      const wheelHandler = (/** @type {WheelEvent} */ ev) => {
        if (!zoomCtx) return;
        if (!ev.shiftKey) return;
        ev.preventDefault();

        // Throttle wheel events to prevent excessive zoom changes
        if (wheelThrottleTimer) return;
        wheelThrottleTimer = setTimeout_(() => {
          wheelThrottleTimer = null;
        }, 50); // 50ms throttle

        // Normalize wheel delta for consistent behavior across browsers
        const delta = ev.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        const current = readZoomPan().zoom || DEFAULT_ZOOM;
        const newZoom = current + delta;

        // Only zoom if within bounds
        if (newZoom >= MIN_ZOOM && newZoom <= MAX_ZOOM) {
          setZoom(newZoom);
        }
      };
      // Attach wheel handler to player and video (if present) so it works over controls.
      // Non-passive: the Shift+wheel branch calls preventDefault to stop page zoom.
      zoomListen(player, 'wheel', wheelHandler, { passive: false });
      const attachVideoWheel = /** @param {Element|null} v */ v => {
        if (!v) return;
        // Non-passive: same handler and reason as the player wheel above.
        zoomListen(v, 'wheel', wheelHandler, { passive: false });
      };
      const detachVideoWheel = /** @param {Element|null} v */ v => {
        v?.removeEventListener('wheel', /** @type {EventListener} */ (wheelHandler));
      };
      attachVideoWheel(video);
      return { attachVideoWheel, detachVideoWheel, scheduleSavePan };
    }

    /**
     * Keyboard +/- zoom (ignore when typing).
     * @param {(z: number|string) => void} setZoom
     */
    function attachZoomKeydownHandler(setZoom) {
      const keydownHandler = (/** @type {KeyboardEvent} */ ev) => {
        if (!zoomCtx) return;
        const active = /** @type {HTMLElement | null} */ (document.activeElement);
        if (
          active &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
        ) {
          return;
        }
        if (ev.key === '+' || ev.key === '=') {
          ev.preventDefault();
          const current = readZoomPan().zoom || DEFAULT_ZOOM;
          setZoom(Math.min(MAX_ZOOM, current + ZOOM_STEP));
        } else if (ev.key === '-') {
          ev.preventDefault();
          const current = readZoomPan().zoom || DEFAULT_ZOOM;
          setZoom(Math.max(MIN_ZOOM, current - ZOOM_STEP));
        }
      };
      zoomListen(window, 'keydown', keydownHandler);
    }

    /**
     * Pointer/touch/mouse interactions for the zoom UI (pan, pinch-zoom, drag).
     * All interaction state lives here; `video` is module-scope and updated by the
     * player observer when YouTube swaps the media element.
     * @param {HTMLElement} player
     * @param {HTMLInputElement} input
     * @param {(z: number) => void} setZoom
     * @param {() => void} scheduleSavePan
     * @returns {{ mouseDownHandler: (ev: MouseEvent) => void, mouseMoveHandler: (ev: MouseEvent) => void, mouseUpHandler: (ev: MouseEvent) => void }}
     */
    function attachZoomPointerAndTouchHandlers(player, input, setZoom, scheduleSavePan) {
      /** Pinch ratio applied through the zoom setter. */
      const applyPinchZoom = (
        /** @type {number} */ dist,
        /** @type {number} */ initialDist,
        /** @type {number} */ startZoom
      ) => {
        if (initialDist <= 0) return;
        setZoom(startZoom * (dist / initialDist));
      };

      /**
       * Pan from the drag start point, clamp it, and repaint on the next frame
       * with the pan persisted after the update.
       */
      const dragPanUpdate = (
        /** @type {number} */ startX,
        /** @type {number} */ startY,
        /** @type {number} */ startPanX,
        /** @type {number} */ startPanY,
        /** @type {number} */ clientX,
        /** @type {number} */ clientY
      ) => {
        const pan = applyPan(startPanX, startPanY, clientX - startX, clientY - startY);
        panX = pan.panX;
        panY = pan.panY;
        clampPan();
        // Use RAF to avoid excessive repaints
        if (video && !video._panRAF) {
          const activeVideo = video;
          activeVideo._panRAF = zoomFrame(() => {
            applyZoomToVideo(activeVideo, parseFloat(input.value) || DEFAULT_ZOOM, panX, panY);
            scheduleSavePan();
            activeVideo._panRAF = null;
          });
        }
      };

      const pointers = new Map();
      /** @type {number|null} */
      let initialPinchDist = null;
      /** @type {number|null} */
      let pinchStartZoom = null;
      /** @type {string|null} */
      let prevTouchAction = null;
      const getDistance = (
        /** @type {{x:number,y:number}} */ a,
        /** @type {{x:number,y:number}} */ b
      ) => Math.hypot(a.x - b.x, a.y - b.y);

      const pointerDown = (/** @type {PointerEvent} */ ev) => {
        if (!zoomCtx) return;
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        // Pointer capture rejects when the pointer is inactive; capture loss
        // is non-fatal for panning.
        try {
          const target = ev.target;
          if (target instanceof Element && typeof target.setPointerCapture === 'function') {
            target.setPointerCapture(ev.pointerId);
          }
        } catch (_e) {
          logS(_e);
        }
        // Start mouse drag only for primary button so we don't break YouTube's
        // 2x-speed hotkeys when the user is not zoomed in.
        const currentZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
        if (
          ev.pointerType === 'mouse' &&
          ev.button === 0 &&
          pointers.size <= 1 &&
          video &&
          currentZoom > 1
        ) {
          dragging = true;
          dragStartX = ev.clientX;
          dragStartY = ev.clientY;
          dragStartPanX = panX;
          dragStartPanY = panY;
          video.style.cursor = 'grabbing';
        }
        if (pointers.size === 2) {
          const pts = Array.from(pointers.values());
          initialPinchDist = getDistance(pts[0], pts[1]);
          pinchStartZoom = readZoomPan().zoom;
          prevTouchAction = player.style.touchAction;
          player.style.touchAction = 'none';
        }
      };

      const pointerMove = (/** @type {PointerEvent} */ ev) => {
        if (!zoomCtx) return;
        if (pointers.has(ev.pointerId)) {
          pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        }
        if (dragging && ev.pointerType === 'mouse' && video) {
          dragPanUpdate(
            dragStartX,
            dragStartY,
            dragStartPanX,
            dragStartPanY,
            ev.clientX,
            ev.clientY
          );
          ev.preventDefault();
          return;
        }
        if (pointers.size === 2 && initialPinchDist && pinchStartZoom != null) {
          const pts = Array.from(pointers.values());
          const dist = getDistance(pts[0], pts[1]);
          if (dist > 0) {
            applyPinchZoom(dist, initialPinchDist, pinchStartZoom);
            ev.preventDefault();
          }
        }
      };

      /** Release capture rejects when the pointer was never captured. */
      const releasePointerCaptureSafely = (/** @type {PointerEvent} */ ev) => {
        try {
          const target = ev.target;
          if (target instanceof Element && typeof target.releasePointerCapture === 'function') {
            target.releasePointerCapture(ev.pointerId);
          }
        } catch (_e) {
          logS(_e);
        }
      };

      const pointerUp = (/** @type {PointerEvent} */ ev) => {
        if (!zoomCtx) return;
        pointers.delete(ev.pointerId);
        releasePointerCaptureSafely(ev);
        releaseWindowDragPair_();
        if (dragging && ev.pointerType === 'mouse') {
          dragging = false;
          updateZoomCursor(video, input);
        }
        if (pointers.size < 2) {
          initialPinchDist = null;
          pinchStartZoom = null;
          if (prevTouchAction != null) {
            player.style.touchAction = prevTouchAction;
            prevTouchAction = null;
          }
        }
      };

      zoomListen(player, 'pointerdown', pointerDown, { passive: true });
      // Non-passive: the mouse-drag and pinch branches call preventDefault.
      zoomListen(player, 'pointermove', pointerMove, { passive: false });
      zoomListen(player, 'pointerup', pointerUp, { passive: true });
      zoomListen(player, 'pointercancel', pointerUp, { passive: true });

      let touchDragging = false;
      let touchDragStartX = 0;
      let touchDragStartY = 0;
      let touchDragStartPanX = 0;
      let touchDragStartPanY = 0;
      /** @type {number|null} */
      let touchInitialDist = null;
      /** @type {number|null} */
      let touchPinchStartZoom = null;
      const getTouchDistance = (
        /** @type {{clientX:number,clientY:number}} */ t1,
        /** @type {{clientX:number,clientY:number}} */ t2
      ) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

      const touchStart = (/** @type {TouchEvent} */ ev) => {
        if (!zoomCtx) return;
        if (!video) return;
        if (ev.touches.length === 1) {
          const currentZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
          if (currentZoom > 1) {
            touchDragging = true;
            touchDragStartX = ev.touches[0].clientX;
            touchDragStartY = ev.touches[0].clientY;
            touchDragStartPanX = panX;
            touchDragStartPanY = panY;
            ev.preventDefault();
          }
        } else if (ev.touches.length === 2) {
          touchInitialDist = getTouchDistance(ev.touches[0], ev.touches[1]);
          touchPinchStartZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
          prevTouchAction = player.style.touchAction;
          player.style.touchAction = 'none';
          ev.preventDefault();
        }
      };

      const touchMove = (/** @type {TouchEvent} */ ev) => {
        if (!zoomCtx) return;
        if (!video) return;
        if (ev.touches.length === 1 && touchDragging) {
          dragPanUpdate(
            touchDragStartX,
            touchDragStartY,
            touchDragStartPanX,
            touchDragStartPanY,
            ev.touches[0].clientX,
            ev.touches[0].clientY
          );
          ev.preventDefault();
          return;
        }
        if (ev.touches.length === 2 && touchInitialDist && touchPinchStartZoom != null) {
          const dist = getTouchDistance(ev.touches[0], ev.touches[1]);
          if (dist <= 0) return;
          applyPinchZoom(dist, touchInitialDist, touchPinchStartZoom);
          ev.preventDefault();
        }
      };

      const touchEnd = (/** @type {TouchEvent} */ ev) => {
        if (!zoomCtx) return;
        if (touchDragging && ev.touches.length === 0) {
          touchDragging = false;
        }
        if (ev.touches.length < 2) {
          touchInitialDist = null;
          touchPinchStartZoom = null;
          if (prevTouchAction != null) {
            player.style.touchAction = prevTouchAction;
            prevTouchAction = null;
          }
        }
      };

      // Non-passive: the pan and pinch branches call preventDefault.
      zoomListen(player, 'touchstart', touchStart, { passive: false });
      // Non-passive: the pan and pinch branches call preventDefault.
      zoomListen(player, 'touchmove', touchMove, { passive: false });
      zoomListen(player, 'touchend', touchEnd, { passive: true });
      zoomListen(player, 'touchcancel', touchEnd, { passive: true });

      /** The window mousemove/mouseup pair lives only for a drag gesture:
       * attached at drag start, released at drag end, so neither page nor
       * player pays for the listeners while nothing is dragged. */
      /** @type {(() => void) | null} */
      let windowDragPair = null;
      const attachWindowDragPair_ = () => {
        if (windowDragPair) return;
        const offMove = zoomListen(window, 'mousemove', mouseMoveHandler);
        const offUp = zoomListen(window, 'mouseup', mouseUpHandler);
        windowDragPair = () => {
          offMove?.();
          offUp?.();
          windowDragPair = null;
        };
      };
      const releaseWindowDragPair_ = () => {
        windowDragPair?.();
        windowDragPair = null;
      };

      const mouseDownHandler = (/** @type {MouseEvent} */ ev) => {
        if (!zoomCtx) return;
        if (ev.button !== 0 || !video) return;
        // Intercept dragging only when the user is zoomed in, so YouTube's
        // built-in 2x-speed click-to-seek at zoom 1 still works.
        const currentZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
        if (currentZoom <= 1) return;
        dragging = true;
        dragStartX = ev.clientX;
        dragStartY = ev.clientY;
        dragStartPanX = panX;
        dragStartPanY = panY;
        video.style.cursor = 'grabbing';
        ev.preventDefault();
        attachWindowDragPair_();
      };

      const mouseMoveHandler = (/** @type {MouseEvent} */ ev) => {
        if (!zoomCtx) return;
        if (!(dragging && video)) return;
        dragPanUpdate(dragStartX, dragStartY, dragStartPanX, dragStartPanY, ev.clientX, ev.clientY);
        ev.preventDefault();
      };

      const mouseUpHandler = (/** @type {MouseEvent} */ _ev) => {
        if (!zoomCtx) return;
        releaseWindowDragPair_();
        if (dragging) {
          dragging = false;
          updateZoomCursor(video, input);
        }
      };

      return { mouseDownHandler, mouseMoveHandler, mouseUpHandler };
    }

    /** Build the zoom setter: clamps, updates UI, applies via RAF, persists. */
    /**
     * Build the zoom setter: clamps, updates UI, applies via RAF, persists.
     * @param {HTMLInputElement} input
     * @param {HTMLElement} label
     * @returns {(z: number | string) => void}
     */
    function createZoomSetter(input, label) {
      return (/** @type {number|string} */ z) => {
        const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(z)));
        input.value = String(clamped);
        const percentage = Math.round(clamped * 100);
        label.textContent = `${percentage}%`;
        label.setAttribute('aria-label', U.t('zoomLevelPercent', { percent: percentage }));
        if (video) {
          clampPan(clamped);
          zoomFrame(() => {
            applyZoomToVideo(video, clamped, panX, panY);
            updateZoomCursor(video, input);
          });
        }
        saveZoomPan(clamped, panX, panY);
      };
    }

    /** Register the slider input listener and the reset-button handler. */
    function registerZoomControlHandlers(
      /** @type {HTMLInputElement} */ input,
      /** @type {HTMLButtonElement} */ reset,
      /** @type {(z: number | string) => void} */ setZoom
    ) {
      zoomListen(input, 'input', (/** @type {Event} */ ev) =>
        setZoom(/** @type {HTMLInputElement} */ (ev.target)?.value || DEFAULT_ZOOM)
      );

      zoomListen(reset, 'click', () => {
        panX = 0;
        panY = 0;
        setZoom(DEFAULT_ZOOM);
        saveZoomPan(DEFAULT_ZOOM, 0, 0);
        reset.style.transform = 'scale(0.9)';
        setTimeout_(() => {
          reset.style.transform = '';
        }, 150);
      });
    }

    /** Restore stored pan values and seed the transform tracking baseline. */
    function restoreZoomPanState(/** @type {number} */ initZoomVal) {
      const s = readZoomPan();
      if (Number.isFinite(s.panX)) panX = s.panX;
      if (Number.isFinite(s.panY)) panY = s.panY;
      // Ensure pan is within limits for the initial zoom
      clampPan(initZoomVal);
      // Initialize transform tracking with the initial state
      _lastTransformApplied = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${initZoomVal.toFixed(3)})`;
    }

    /** Restore the expected transform when YouTube clobbers video styles. */
    function handleVideoStyleMutations(/** @type {MutationRecord[]} */ muts) {
      // Skip if we're currently applying a transform
      if (_isApplyingTransform) return;
      for (const m of muts) {
        if (m.type === 'attributes' && m.attributeName === 'style') {
          // If the transform was changed externally, restore the expected transform
          const current = video?.style?.transform || '';
          const expectedZoom =
            readZoomPan().zoom || parseFloat(activeZoomInput?.value || '') || DEFAULT_ZOOM;
          const expected = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${expectedZoom.toFixed(3)})`;

          // Only restore if the transform was actually changed by YouTube (not by us)
          // and the current zoom is not default
          if (
            expectedZoom !== DEFAULT_ZOOM &&
            current !== expected &&
            current !== _lastTransformApplied
          ) {
            // Reapply on next frame to minimize layout thrash
            zoomFrame(() => {
              applyZoomToVideo(video, expectedZoom, panX, panY);
              logRestoreEvent({
                action: 'restore_transform',
                currentTransform: current,
                expectedTransform: expected,
                zoom: expectedZoom,
                panX,
                panY,
              });
            });
          }
        }
      }
    }

    /** Watch the CURRENT video's inline style attribute for external changes. */
    function attachStyleObserver() {
      const mutationCoordinator = window.YouTubePlusMutationCoordinator;
      if (videoStyleObserver) {
        mutationCoordinator?.unwatch?.(videoStyleObserver);
        videoStyleObserver = null;
      }
      if (!(video && mutationCoordinator?.watchTarget)) return;
      videoStyleObserver = 'zoom::videoStyle';
      mutationCoordinator.watchTarget(videoStyleObserver, video, handleVideoStyleMutations, {
        attributes: true,
        childList: false,
        subtree: false,
        attributeFilter: ['style'],
      });
    }

    /**
     * Rebind pointer/wheel/observer state when YouTube swaps the video element.
     * @param {{ mouseDownHandler: (ev: MouseEvent) => void, mouseMoveHandler: (ev: MouseEvent) => void, mouseUpHandler: (ev: MouseEvent) => void }} pointerApi
     * @param {{ detachVideoWheel: (v: Element | null) => void, attachVideoWheel: (v: Element | null) => void }} wheelBinding
     */
    function handlePlayerMutations(pointerApi, wheelBinding) {
      const newVideo = findVideoElement();
      if (!(newVideo && newVideo !== video)) return;
      // Release the current video's bindings inside its own boundary: a failing
      // detach must not abort the swap to the new element.
      try {
        if (video) {
          video.removeEventListener('mousedown', pointerApi.mouseDownHandler);
          wheelBinding.detachVideoWheel(video);
          cancelPanRaf();
        }
      } catch (err) {
        logS(err);
        zoomLogger?.error?.('Zoom', 'Error detaching from old video', err);
      }

      // Update reference
      video = newVideo;

      // Reattach style observer for the new video element
      attachStyleObserver();

      // Reapply zoom to the new video
      const current = readZoomPan().zoom || DEFAULT_ZOOM;
      clampPan(current);
      applyZoomToVideo(video, current, panX, panY);

      // Attach listeners to new video
      zoomListen(video, 'mousedown', pointerApi.mouseDownHandler);
      wheelBinding.attachVideoWheel(video);
    }

    /**
     * Reapply zoom after fullscreen transitions (layout may move/replace the video).
     * @param {{ detachVideoWheel: (v: Element | null) => void, attachVideoWheel: (v: Element | null) => void }} wheelBinding
     */
    function handleZoomFullscreenChange(wheelBinding) {
      const current = readZoomPan().zoom || DEFAULT_ZOOM;
      // Retry finding and applying the zoom several times: YouTube may
      // move/replace the video element.
      setTimeout_(() => {
        let attempts = 0;
        const tryApply = () => {
          const newVideo = findVideoElement();
          let swapped = false;
          if (newVideo && newVideo !== video) {
            // detach from old video listeners safely
            wheelBinding.detachVideoWheel(video);

            video = newVideo;
            swapped = true;

            // Reattach wheel handler if needed
            wheelBinding.attachVideoWheel(video);
          }

          clampPan(current);
          // Apply zoom without transition during fullscreen to prevent flicker
          if (video) applyZoomToVideo(video, current, panX, panY, false, true);

          // If we didn't find/replace video yet, retry a few times
          if (!swapped && (!video || attempts < FULLSCREEN_APPLY_RETRIES)) {
            attempts += 1;
            setTimeout_(tryApply, FULLSCREEN_APPLY_RETRY_DELAY);
          }
        };
        tryApply();
      }, FULLSCREEN_APPLY_DELAY);
    }

    /** Keep-above-chrome positioner for the zoom control. */
    function createUpdateZoomPosition(
      /** @type {HTMLElement} */ player,
      /** @type {HTMLElement} */ wrap
    ) {
      return () => {
        if (window.YouTubePlusDesignSystem?.getThemeVariant?.() !== 'classic') {
          return;
        }
        const chrome = /** @type {HTMLElement | null} */ ($('.ytp-chrome-bottom', player));
        // If chrome exists, place the control just above it; otherwise keep the CSS fallback.
        if (chrome?.offsetHeight) {
          const offset = chrome.offsetHeight + 8; // small gap above controls
          wrap.style.bottom = `${offset}px`;
        } else {
          wrap.style.bottom = '';
        }
      };
    }

    /** RAF-deferred resize observer keeping the control above the chrome. */
    function registerZoomResizeObserver(
      /** @type {HTMLElement} */ player,
      /** @type {() => void} */ updateZoomPosition
    ) {
      // The work runs on the next animation frame so synchronous layout does
      // not execute inside the observer callback ("ResizeObserver loop
      // completed with undelivered notifications").
      // Raw observer fallback; it is registered with CleanupManager below.
      // lint:custom:ignore
      const rawRo = new ResizeObserver((/** @type {ResizeObserverEntry[]} */ _entries) => {
        if (typeof window.requestAnimationFrame === 'function') {
          zoomFrame(updateZoomPosition);
        } else {
          updateZoomPosition();
        }
      });
      const ro = uiScope ? uiScope.observe(rawRo) : rawRo;

      const chromeEl = $('.ytp-chrome-bottom', player);
      if (chromeEl) ro.observe(chromeEl);
      return ro;
    }

    /** Window resize + fullscreen repositioning for the zoom control. */
    function registerZoomPositionListeners(/** @type {() => void} */ updateZoomPosition) {
      // Keep a window resize listener for fallback positioning
      zoomListen(window, 'resize', updateZoomPosition, { passive: true });

      // Reposition on fullscreen changes (vendor-prefixed events included)
      FULLSCREEN_EVENTS_.forEach(evt => {
        zoomListen(document, evt, updateZoomPosition);
      });
    }

    /**
     * Attach the video-level pointer entry point; the window drag pair is
     * managed per gesture.
     * @param {{ mouseDownHandler: (ev: MouseEvent) => void, mouseMoveHandler: (ev: MouseEvent) => void, mouseUpHandler: (ev: MouseEvent) => void }} pointerApi
     */
    function attachZoomPointerListeners_(
      /** @type {{ mouseDownHandler: (ev: MouseEvent) => void, mouseMoveHandler: (ev: MouseEvent) => void, mouseUpHandler: (ev: MouseEvent) => void }} */ pointerApi
    ) {
      if (!video) return;
      // The window mousemove/mouseup pair attaches at drag start
      // (attachWindowDragPair_), not at mount.
      zoomListen(video, 'mousedown', pointerApi.mouseDownHandler);
      // Attach style observer to ensure transform isn't clobbered by YouTube
      attachStyleObserver();
    }

    /**
     * Watch the player subtree for video-element swaps and rebind state.
     * @param {HTMLElement} player
     * @param {{ mouseDownHandler: (ev: MouseEvent) => void, mouseMoveHandler: (ev: MouseEvent) => void, mouseUpHandler: (ev: MouseEvent) => void }} pointerApi
     * @param {{ detachVideoWheel: (v: Element | null) => void, attachVideoWheel: (v: Element | null) => void }} wheelBinding
     */
    function registerVideoSwapObserver_(player, pointerApi, wheelBinding) {
      const mutationCoordinator = window.YouTubePlusMutationCoordinator;
      if (!mutationCoordinator?.watchTarget) return;
      mutationCoordinator.watchTarget(
        'zoom::playerVideoSwap',
        player,
        () => handlePlayerMutations(pointerApi, wheelBinding),
        {
          childList: true,
          subtree: true,
          attributes: false,
        }
      );
      playerObserverActive = true;
      U?.ObserverRegistry?.track?.();
    }

    /** Register the fullscreen reapply handler on vendor-prefixed events. */
    function registerFullscreenReapply_(
      /** @type {{ detachVideoWheel: (v: Element | null) => void, attachVideoWheel: (v: Element | null) => void }} */ wheelBinding
    ) {
      FULLSCREEN_EVENTS_.forEach(evt => {
        zoomListen(document, evt, () => handleZoomFullscreenChange(wheelBinding));
      });
    }

    /** Cancel a pending pan repaint frame on the video element. */
    function cancelPanRaf() {
      if (video?._panRAF) {
        video._panRAF();
        video._panRAF = null;
      }
    }

    /** Detach pointer bindings and reset video styling on teardown. */
    function releaseZoomVideoBindings_(
      /** @type {{ mouseDownHandler: (ev: MouseEvent) => void, mouseMoveHandler: (ev: MouseEvent) => void, mouseUpHandler: (ev: MouseEvent) => void }} */ pointerApi
    ) {
      if (!video) return;
      video.removeEventListener('mousedown', pointerApi.mouseDownHandler);
      window.removeEventListener('mousemove', pointerApi.mouseMoveHandler);
      window.removeEventListener('mouseup', pointerApi.mouseUpHandler);
      // Reset video styles
      video.style.cursor = '';
      video.style.transform = '';
      video.style.willChange = 'auto';
      video.style.transition = '';
    }

    /** Disconnect the style observer and the player-subtree observer. */
    function unwatchZoomObservers_() {
      const mutationCoordinator = window.YouTubePlusMutationCoordinator;
      if (videoStyleObserver) {
        mutationCoordinator?.unwatch?.(videoStyleObserver);
        videoStyleObserver = null;
      }
      if (playerObserverActive) {
        mutationCoordinator?.unwatch?.('zoom::playerVideoSwap');
        playerObserverActive = false;
        U?.ObserverRegistry?.untrack?.();
      }
    }

    /**
     * Mount (or reuse) the zoom control UI on the player. Delegates to the
     * named sibling helpers above, which share the module-level state.
     * @returns {HTMLDivElement | null} the zoom control wrap element
     */
    function createZoomUI() {
      const player = /** @type {HTMLElement | null} */ ($('#movie_player'));
      if (!player) return null;
      const existingWrap = document.getElementById('yp-zoom-control');
      if (existingWrap) return /** @type {HTMLDivElement} */ (existingWrap);
      if (!zoomCtx) return null;

      uiScope?.dispose();
      uiScope = zoomCtx.scope();
      injectZoomStyles();
      const { wrap, input, label, reset } = buildZoomControlDom();

      video = findVideoElement();
      const stored = readZoomPan().zoom;
      const initZoomVal = Number.isFinite(stored) && !Number.isNaN(stored) ? stored : DEFAULT_ZOOM;

      const setZoom = createZoomSetter(input, label);
      registerZoomControlHandlers(input, reset, setZoom);

      const wheelBinding = attachZoomWheelHandlers(player, video, input, setZoom);
      const scheduleSavePan = wheelBinding.scheduleSavePan;
      attachZoomKeydownHandler(setZoom);

      // applyPan/updateZoomCursor/clampPan are initZoomModule-level helpers;
      // they only read shared state and are shared with the
      // extracted mutation/fullscreen handlers.

      activeZoomInput = input;
      const pointerApi = attachZoomPointerAndTouchHandlers(player, input, setZoom, scheduleSavePan);

      attachZoomPointerListeners_(pointerApi);

      // If video element is replaced by YouTube (e.g. fullscreen toggle or navigation), rebind handlers
      registerVideoSwapObserver_(player, pointerApi, wheelBinding);

      // Reapply zoom on fullscreen change since layout may move elements.
      // Use a short timeout to allow YouTube to move/replace the video element
      // when entering/leaving fullscreen, and listen for vendor-prefixed events.
      registerFullscreenReapply_(wheelBinding);

      // Apply initial zoom and attach UI
      // Restore stored pan values (if any) and clamp before applying zoom
      restoreZoomPanState(initZoomVal);
      setZoom(initZoomVal);

      // Position the zoom control above YouTube's bottom chrome (progress bar / controls).
      const updateZoomPosition = createUpdateZoomPosition(player, wrap);

      // Initial position and reactive updates for fullscreen / resize / chrome changes
      updateZoomPosition();
      registerZoomResizeObserver(player, updateZoomPosition);
      registerZoomPositionListeners(updateZoomPosition);

      player.appendChild(wrap);

      setupZoomButton(player, wrap);
      setupVisionTopDock(player, wrap);

      // Listeners and observers are released with uiScope (see clearZoomUI);
      // this restores the video and drops the pending frame and the watches.
      const cleanup = () => {
        // Release every teardown step even when some detach or unwatch call
        // throws; the remaining steps and the removed UI must still run.
        try {
          cancelPanRaf();
          releaseZoomVideoBindings_(pointerApi);
          unwatchZoomObservers_();
          wrap.remove();
        } catch (err) {
          logS(err);
          zoomLogger?.error?.('Zoom', 'Cleanup error', err);
        }
      };

      _activeZoomCleanup = cleanup;

      return wrap;
    }

    // Call this to initialize zoom (e.g. on page load / SPA navigation)
    function initZoom() {
      if (!canRenderZoomUI()) {
        clearZoomUI();
        return;
      }
      const ensure = () => {
        if (!canRenderZoomUI()) {
          clearZoomUI();
          return;
        }
        const player = /** @type {HTMLElement | null} */ ($('#movie_player'));
        if (!player) {
          setTimeout_(ensure, 400);
          return;
        }
        if (player.closest('ytd-miniplayer')) {
          clearZoomUI();
          return;
        }
        createZoomUI();
      };
      ensure();
    }

    // Rebuild the player UI after a variant change without SPA navigation.
    function rebuildUI() {
      clearZoomUI();
      initZoom();
    }

    // SPA navigation: reset zoom/pan and recreate UI on route changes.
    // Register once through cleanupManager so it is removed on feature teardown.
    const handleZoomNavigation = () => {
      // Off its routes or switched off, zoom does no navigation work.
      if (!zoomCtx) return;
      // Reset saved zoom/pan on navigation to prevent subsequent videos from starting zoomed
      saveZoomPan(DEFAULT_ZOOM, 0, 0);
      // Clear zoom UI immediately to prevent stale elements/observers from lingering
      clearZoomUI();
      const rebuild = () => {
        if (canRenderZoomUI()) createZoomUI();
        else clearZoomUI();
      };
      if (cm?.timeout) cm.timeout(rebuild, 300);
      else setTimeout_(rebuild, 300);
    };

    // Navigation listeners live for the whole session and return at once
    // while the feature is not running.
    const cm = window.YouTubePlusCleanupManager;
    cm?.registerListener?.(window, 'yt-navigate-finish', handleZoomNavigation, undefined, true);
    cm?.registerListener?.(window, 'yp:nav-refresh', handleZoomNavigation, undefined, true);

    onZoomStart = () => setFeatureEnabled(true);
    onZoomStop = () => setFeatureEnabled(false);

    const publicAPI = {
      DESCRIPTOR,
      createZoomUI,
      clearZoomUI,
      canRenderZoomUI,
      isMiniPlayerActive,
      logRestoreEvent,
      initZoom,
      rebuildUI,
      closestDock,
    };
    window.YouTubePlusZoom = Object.assign(window.YouTubePlusZoom || {}, publicAPI);
    // Test-only surface: internal entry points and state accessors live here,
    // not on the facade root.
    U?.exposeTestHooks?.(window.YouTubePlusZoom, {
      readZoomPan,
      saveZoomPan,
      applyZoomToVideo,
      findVideoElement,
      setFeatureEnabled,
      setupZoomButton,
    });
  }; // end initZoomModule

  const zoomFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'zoom',
    settingsKey: 'enableZoom',
    // Zoom UI lives on the watch and shorts players only.
    routes: ['watch', 'shorts'],
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      zoomCtx = ctx;
      initZoomModule();
      onZoomStart?.();
    },
    stop() {
      onZoomStop?.();
      zoomCtx = null;
    },
  });
  zoomFeature?.sync();
})();
