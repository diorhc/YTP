// Zoom — LazyLoader registered as 'zoom'.
//
// Responsibility: zoom UI with mouse-wheel, pinch, and keyboard
//   support for the YouTube video player. Persists zoom level and
//   position across SPA navigations.
// Public surface: none (self-contained IIFE, registered via LazyLoader).
(function () {
  const setTimeout_ = setTimeout.bind(window);
  const U = window.YouTubeUtils;
  const isRelevantRoute = () => {
    return U.isWatchRoute() || U.isShortsRoute();
  };
  const initZoomModule = () => {
    let featureEnabled = true;
    /** @type {(() => void) | null} */
    let _activeZoomCleanup = null;
    const clearZoomUI = () => {
      if (_activeZoomCleanup) {
        try {
          _activeZoomCleanup();
        } catch (_e) {}
        _activeZoomCleanup = null;
      }
      try {
        const ui = byId('ytp-zoom-control');
        if (ui) ui.remove();
      } catch (_e) {
        U.logSuppressed(_e, 'Zoom');
      }
      try {
        const styles = byId('ytp-zoom-styles');
        if (styles) styles.remove();
      } catch (_e) {
        U.logSuppressed(_e, 'Zoom');
      }
      try {
        const video = findVideoElement();
        if (video) {
          /** @type {any} */ (video).style.transform = '';
          /** @type {any} */ (video).style.willChange = '';
          /** @type {any} */ (video).style.transition = '';
          /** @type {any} */ (video).style.cursor = '';
        }
      } catch (_e) {
        U.logSuppressed(_e, 'Zoom');
      }
    };
    const setFeatureEnabled = (/** @type {boolean|undefined} */ nextEnabled) => {
      featureEnabled = nextEnabled !== false;
      if (!featureEnabled) {
        clearZoomUI();
      } else {
        try {
          initZoom();
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
      }
    };

    const isMiniPlayerActive = () => {
      try {
        const mini = document.querySelector('ytd-miniplayer[active], ytd-miniplayer[enabled]');
        if (mini && mini instanceof HTMLElement) {
          if (mini.offsetParent !== null) return true;
          if (mini.getClientRects().length > 0) return true;
        }

        const miniWatch = document.querySelector(
          'ytd-watch-flexy[is-miniplayer], ytd-watch-flexy[miniplayer-is-active]'
        );
        return Boolean(miniWatch);
      } catch (_e) {
        return false;
      }
    };

    const canRenderZoomUI = () => {
      try {
        return featureEnabled && isRelevantRoute() && !isMiniPlayerActive();
      } catch (_e) {
        return false;
      }
    };

    featureEnabled = U?.loadFeatureEnabled?.('enableZoom') ?? true;

    // Shared DOM helpers from YouTubeUtils
    const { $, byId } = U || {};
    const zoomLogger = U?.logger || null;

    const ZOOM_PAN_STORAGE_KEY = 'ytp_zoom_pan';
    const RESTORE_LOG_KEY = 'ytp_zoom_restore_log'; // stored in sessionStorage for debugging
    const DEFAULT_ZOOM = 1;
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 2.5;
    const ZOOM_STEP = 0.05;
    // Fullscreen apply timing (ms) and retries — make configurable if needed
    const FULLSCREEN_APPLY_DELAY = 80;
    const FULLSCREEN_APPLY_RETRIES = 4;
    const FULLSCREEN_APPLY_RETRY_DELAY = 120;

    // Helpers for combined zoom+pan storage
    function readZoomPan() {
      try {
        const raw = localStorage.getItem(ZOOM_PAN_STORAGE_KEY);
        if (!raw) return { zoom: DEFAULT_ZOOM, panX: 0, panY: 0 };
        const obj = JSON.parse(raw);
        const zoom = Number(obj?.zoom) || DEFAULT_ZOOM;
        const panX = Number(obj?.panX) || 0;
        const panY = Number(obj?.panY) || 0;
        return { zoom, panX, panY };
      } catch (_e) {
        return { zoom: DEFAULT_ZOOM, panX: 0, panY: 0 };
      }
    }

    function saveZoomPan(
      /** @type {number} */ zoom,
      /** @type {number} */ panX,
      /** @type {number} */ panY
    ) {
      try {
        const obj = {
          zoom: Number(zoom) || DEFAULT_ZOOM,
          panX: Number(panX) || 0,
          panY: Number(panY) || 0,
        };
        localStorage.setItem(ZOOM_PAN_STORAGE_KEY, JSON.stringify(obj));
      } catch (e) {
        zoomLogger?.warn?.('Zoom', 'Failed to save zoom/pan settings', e);
      }
    }

    function logRestoreEvent(/** @type {Record<string, any>} */ evt) {
      try {
        const entry = Object.assign({ time: new Date().toISOString() }, evt);
        try {
          const raw = sessionStorage.getItem(RESTORE_LOG_KEY);
          const arr = raw ? JSON.parse(raw) : [];
          arr.push(entry);
          // keep last 200 entries
          if (arr.length > 200) arr.splice(0, arr.length - 200);
          sessionStorage.setItem(RESTORE_LOG_KEY, JSON.stringify(arr));
        } catch (_e) {
          // fallback: ignore
        }
        // console output for live debugging (only when debug mode is active)
        if (
          (typeof window !== 'undefined' && window.YTP_DEBUG) ||
          window.YouTubePlusConfig?.debug
        ) {
          zoomLogger?.warn?.('Zoom', 'Zoom restore', entry);
        }
      } catch (_e) {
        U.logSuppressed(_e, 'Zoom');
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
      try {
        // Set flag to prevent observer loops
        if (!skipTransformTracking) {
          _isApplyingTransform = true;
        }

        // Ensure container can display overflow content
        /** @type {any} */ (container).style.overflow = 'visible';
        if (
          !(/** @type {any} */ (container).style.position) ||
          /** @type {any} */ (container).style.position === 'static'
        ) {
          /** @type {any} */ (container).style.position = 'relative';
        }

        // Set transform origin to center for natural zoom
        /** @type {any} */ (videoEl).style.transformOrigin = 'center center';

        if (zoom === 1 && panX === 0 && panY === 0) {
          /** @type {any} */ (videoEl).style.transform = '';
          /** @type {any} */ (videoEl).style.willChange = 'auto';
          if (!skipTransformTracking) {
            _lastTransformApplied = '';
          }
        } else {
          // Apply transform with proper precision
          const transformStr = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${zoom.toFixed(3)})`;
          /** @type {any} */ (videoEl).style.transform = transformStr;

          // Track the transform we just applied
          if (!skipTransformTracking) {
            _lastTransformApplied = transformStr;
          }

          // Use will-change for GPU acceleration
          /** @type {any} */ (videoEl).style.willChange = 'transform';
        }

        // Smooth transition for better UX (skip during fullscreen transitions to avoid flicker)
        /** @type {any} */ (videoEl).style.transition = skipTransition
          ? 'none'
          : 'transform .08s ease-out';

        // Reset flag after a short delay
        if (!skipTransformTracking) {
          setTimeout_(() => {
            _isApplyingTransform = false;
          }, 100);
        }
      } catch (e) {
        zoomLogger?.error?.('Zoom', 'applyZoomToVideo error', e);
        _isApplyingTransform = false;
      }
    };

    function createZoomUI() {
      const player = /** @type {HTMLElement | null} */ ($('#movie_player'));
      if (!player) return null;
      if (byId('ytp-zoom-control')) {
        return byId('ytp-zoom-control');
      }

      // styles (minimal)
      if (!byId('ytp-zoom-styles')) {
        const s = document.createElement('style');
        s.id = 'ytp-zoom-styles';
        s.textContent = `
      /* Compact control bar matching YouTube control style */
      #ytp-zoom-control{position: absolute; left: 12px; bottom: 70px; z-index: 2200; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 24px; background: var(--yt-glass-bg); color: var(--yt-text-primary); font-size: 12px; box-shadow: 0 2px 8px var(--yt-shadow-flyout); backdrop-filter: blur(6px);}
      #ytp-zoom-control input[type=range]{width: 120px; -webkit-appearance: none; background: transparent; height: 24px;}
      /* WebKit track */
      #ytp-zoom-control input[type=range]::-webkit-slider-runnable-track{height: 4px; background: var(--yt-button-bg); border-radius: 3px;}
      #ytp-zoom-control input[type=range]::-webkit-slider-thumb{-webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--yt-text-primary); box-shadow: 0 0 0 6px var(--yt-button-bg); margin-top: -4px;}
      /* Firefox */
      #ytp-zoom-control input[type=range]::-moz-range-track{height: 4px; background: var(--yt-button-bg); border-radius: 3px;}
      #ytp-zoom-control input[type=range]::-moz-range-thumb{width: 12px; height: 12px; border-radius: 50%; background: var(--yt-text-primary); border: none;}
      #ytp-zoom-control .zoom-label{min-width:36px;text-align:center;font-size:11px;padding:0 6px;user-select:none}
      #ytp-zoom-control::after{content:'Shift + Wheel to zoom';position:absolute;bottom:100%;right:0;padding:4px 8px;background:var(--yt-notification-bg);color:var(--yt-text-primary);font-size:10px;border-radius:4px;white-space:nowrap;opacity:0;pointer-events:none;transform:translateY(4px);transition:opacity .2s,transform .2s}
      #ytp-zoom-control:hover::after{opacity:1;transform:translateY(-4px)}
      #ytp-zoom-control .zoom-reset{background: var(--yt-button-bg); border: none; color: inherit; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer; width: 28px; height: 28px;}
      #ytp-zoom-control .zoom-reset:hover{background: var(--yt-hover-bg)}
      #ytp-zoom-control .zoom-reset svg{display:block;width:14px;height:14px}
      /* Hidden state to mirror YouTube controls autohide */
      #ytp-zoom-control.ytp-hidden,
      .ytp-autohide #ytp-zoom-control,
      .ytp-hide-controls #ytp-zoom-control{opacity:0 !important;transform:translateY(6px) !important;pointer-events:none !important}
      #ytp-zoom-control{transition:opacity .18s ease, transform .18s ease}
    `;
        (document.head || document.documentElement).appendChild(s);
      }

      const wrap = document.createElement('div');
      wrap.id = 'ytp-zoom-control';

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(MIN_ZOOM);
      input.max = String(MAX_ZOOM);
      input.step = String(ZOOM_STEP);

      const label = document.createElement('div');
      label.className = 'zoom-label';
      label.setAttribute('role', 'status');
      label.setAttribute('aria-live', 'polite');
      label.setAttribute('aria-label', 'Current zoom level');

      const reset = document.createElement('button');
      reset.className = 'zoom-reset';
      reset.type = 'button';
      reset.setAttribute('aria-label', 'Reset zoom');
      reset.title = 'Reset zoom';
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

      let video = findVideoElement();
      const stored = readZoomPan().zoom;
      const initZoomVal = Number.isFinite(stored) && !Number.isNaN(stored) ? stored : DEFAULT_ZOOM;

      const setZoom = (/** @type {number|string} */ z) => {
        const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(z)));
        input.value = String(clamped);
        const percentage = Math.round(clamped * 100);
        label.textContent = `${percentage}%`;
        label.setAttribute('aria-label', `Current zoom level ${percentage} percent`);

        if (video) {
          // clamp pan to new zoom limits
          clampPan(clamped);

          // Use RAF for smooth animation
          requestAnimationFrame(() => {
            try {
              applyZoomToVideo(video, clamped, panX, panY);
              // update cursor depending on zoom
              try {
                /** @type {any} */ (video).style.cursor = clamped > 1 ? 'grab' : '';
              } catch (_e) {
                /* Intentional: video element may be detached */
              }
            } catch (err) {
              zoomLogger?.error?.('Zoom', 'Apply zoom error', err);
            }
          });
        }

        try {
          saveZoomPan(clamped, panX, panY);
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Save zoom error', err);
        }
      };

      input.addEventListener('input', (/** @type {Event} */ e) => {
        const target = /** @type {HTMLInputElement|null} */ (e.target);
        setZoom(target ? target.value : DEFAULT_ZOOM);
      });
      reset.addEventListener('click', () => {
        try {
          panX = 0;
          panY = 0;
          setZoom(DEFAULT_ZOOM);
          // persist reset pan immediately
          try {
            // set via combined storage
            saveZoomPan(DEFAULT_ZOOM, 0, 0);
          } catch (e) {
            zoomLogger?.warn?.('Zoom', 'Failed to persist zoom reset', e);
          }
          // Provide visual feedback
          /** @type {any} */ (reset).style.transform = 'scale(0.9)';
          setTimeout_(() => {
            /** @type {any} */ (reset).style.transform = '';
          }, 150);
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Reset zoom error', err);
        }
      });

      // Wheel: Shift + wheel to zoom (with throttling for performance)
      /** @type {ReturnType<typeof setTimeout>|null} */
      let wheelThrottleTimer = null;
      // Throttled pan save timer to avoid excessive localStorage writes
      /** @type {ReturnType<typeof setTimeout>|null} */
      let panSaveTimer = null;
      const scheduleSavePan = () => {
        try {
          if (panSaveTimer) clearTimeout(panSaveTimer);
          panSaveTimer = setTimeout_(() => {
            try {
              const currentZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
              saveZoomPan(currentZoom, panX, panY);
            } catch (err) {
              zoomLogger?.error?.('Zoom', 'Save pan error', err);
            }
            panSaveTimer = null;
          }, 220);
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Schedule save pan error', err);
        }
      };
      const wheelHandler = (/** @type {WheelEvent} */ ev) => {
        try {
          if (!featureEnabled) return;
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
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Wheel zoom error', err);
        }
      };
      // Attach wheel handler to player and video (if present) so it works over controls
      player.addEventListener('wheel', wheelHandler, { passive: false });
      if (video) {
        try {
          video.addEventListener('wheel', wheelHandler, { passive: false });
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Failed to attach wheel handler to video', err);
        }
      }

      // Keyboard +/- (ignore when typing)
      const keydownHandler = (/** @type {KeyboardEvent} */ ev) => {
        try {
          if (!featureEnabled) return;
          const active = document.activeElement;
          if (
            active &&
            (active.tagName === 'INPUT' ||
              active.tagName === 'TEXTAREA' ||
              active.isContentEditable)
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
        } catch (e) {
          zoomLogger?.error?.('Zoom', 'Keyboard zoom error', e);
        }
      };
      window.addEventListener('keydown', keydownHandler);

      // Pinch-to-zoom using Pointer Events
      // Panning (drag) state
      let panX = 0;
      let panY = 0;
      const mutationCoordinator = window.YouTubePlusMutationCoordinator;
      // Coordinator subscription id for external changes to video style
      /** @type {string|null} */
      let videoStyleObserver = null;
      const videoStyleSubId = 'zoom::videoStyle';
      const playerObserverSubId = 'zoom::playerVideoSwap';

      let dragging = false;
      let dragStartX = 0;
      let dragStartY = 0;
      let dragStartPanX = 0;
      let dragStartPanY = 0;

      const clampPan = (/** @type {number} */ zoom = readZoomPan().zoom) => {
        try {
          if (!video) return;
          const container = video.parentElement || video;
          if (!container) return;

          const containerRect = container.getBoundingClientRect();
          if (!containerRect || containerRect.width === 0 || containerRect.height === 0) return;

          // Get actual video dimensions respecting aspect ratio
          const baseW = video.videoWidth || video.offsetWidth || containerRect.width;
          const baseH = video.videoHeight || video.offsetHeight || containerRect.height;

          // Validate dimensions
          if (!(baseW && baseH && Number.isFinite(baseW) && Number.isFinite(baseH))) return;

          // Calculate scaled dimensions
          const scaledW = baseW * zoom;
          const scaledH = baseH * zoom;

          // Calculate maximum pan distance (how far content can move)
          const maxX = Math.max(0, (scaledW - containerRect.width) / 2);
          const maxY = Math.max(0, (scaledH - containerRect.height) / 2);

          // Clamp pan values with validation
          if (Number.isFinite(maxX) && Number.isFinite(panX)) {
            panX = Math.max(-maxX, Math.min(maxX, panX));
          }
          if (Number.isFinite(maxY) && Number.isFinite(panY)) {
            panY = Math.max(-maxY, Math.min(maxY, panY));
          }
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Clamp pan error', err);
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
        try {
          if (!featureEnabled) return;
          pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
          try {
            const target = /** @type {any} */ (ev.target);
            if (target?.setPointerCapture) target.setPointerCapture(ev.pointerId);
          } catch (_e) {
            /* Intentional: some elements don't support pointer capture */
          }
          // Start mouse drag for panning when single mouse pointer and zoomed in.
          // Skip at default zoom so we don't interfere with YouTube's native
          // hold-left-mouse-button → 2× speed feature.
          try {
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
              try {
                /** @type {any} */ (video).style.cursor = 'grabbing';
              } catch (_e) {
                U.logSuppressed(_e, 'Zoom');
              }
            }
          } catch (_e) {
            U.logSuppressed(_e, 'Zoom');
          }
          if (pointers.size === 2) {
            const pts = Array.from(pointers.values());
            initialPinchDist = getDistance(pts[0], pts[1]);
            pinchStartZoom = readZoomPan().zoom;
            prevTouchAction = /** @type {any} */ (player).style.touchAction;
            try {
              /** @type {any} */ (player).style.touchAction = 'none';
            } catch (_e) {
              U.logSuppressed(_e, 'Zoom');
            }
          }
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
      };

      const pointerMove = (/** @type {PointerEvent} */ ev) => {
        try {
          if (!featureEnabled) return;
          // Update pointers map
          if (pointers.has(ev.pointerId)) {
            pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
          }

          // If dragging with mouse, pan the video
          if (dragging && ev.pointerType === 'mouse' && video) {
            const dx = ev.clientX - dragStartX;
            const dy = ev.clientY - dragStartY;
            // Movement should be independent of scale; adjust if desired
            panX = dragStartPanX + dx;
            panY = dragStartPanY + dy;
            // clamp pan to allowed bounds
            clampPan();
            applyZoomToVideo(video, parseFloat(input.value) || DEFAULT_ZOOM, panX, panY);
            // schedule persisting pan
            scheduleSavePan();
            ev.preventDefault();
            return;
          }

          // Pinch-to-zoom when two pointers
          if (pointers.size === 2 && initialPinchDist && pinchStartZoom != null) {
            const pts = Array.from(pointers.values());
            const dist = getDistance(pts[0], pts[1]);
            if (dist <= 0) return;
            const ratio = dist / initialPinchDist;
            const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom * ratio));
            setZoom(newZoom);
            ev.preventDefault();
          }
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
      };

      const pointerUp = (/** @type {PointerEvent} */ ev) => {
        try {
          if (!featureEnabled) return;
          pointers.delete(ev.pointerId);
          try {
            const target = /** @type {any} */ (ev.target);
            if (target?.releasePointerCapture) target.releasePointerCapture(ev.pointerId);
          } catch (_e) {
            U.logSuppressed(_e, 'Zoom');
          }
          // stop dragging
          try {
            if (dragging && ev.pointerType === 'mouse') {
              dragging = false;
              try {
                if (video) {
                  /** @type {any} */ (video).style.cursor =
                    parseFloat(input.value) > 1 ? 'grab' : '';
                }
              } catch (_e) {
                U.logSuppressed(_e, 'Zoom');
              }
            }
          } catch (_e) {
            U.logSuppressed(_e, 'Zoom');
          }
          if (pointers.size < 2) {
            initialPinchDist = null;
            pinchStartZoom = null;
            if (prevTouchAction != null) {
              try {
                /** @type {any} */ (player).style.touchAction = prevTouchAction;
              } catch (_e) {
                U.logSuppressed(_e, 'Zoom');
              }
              prevTouchAction = null;
            }
          }
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
      };

      player.addEventListener('pointerdown', pointerDown, { passive: true });
      player.addEventListener('pointermove', pointerMove, { passive: false });
      player.addEventListener('pointerup', pointerUp, { passive: true });
      player.addEventListener('pointercancel', pointerUp, { passive: true });

      // Touch event fallback for browsers that don't fully support Pointer Events
      // Enables pinch-to-zoom and one-finger pan on touchscreens
      let touchDragging = false;
      let touchDragStartX = 0;
      let touchDragStartY = 0;
      let touchDragStartPanX = 0;
      let touchDragStartPanY = 0;
      /** @type {number|null} */
      let touchInitialDist = null;
      /** @type {number|null} */
      let touchPinchStartZoom = null;

      const getTouchDistance = (/** @type {Touch} */ t1, /** @type {Touch} */ t2) =>
        Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

      const touchStart = (/** @type {TouchEvent} */ ev) => {
        try {
          if (!featureEnabled) return;
          if (!video) return;
          if (ev.touches.length === 1) {
            // start pan only if zoomed in
            const currentZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
            if (currentZoom > 1) {
              touchDragging = true;
              touchDragStartX = ev.touches[0].clientX;
              touchDragStartY = ev.touches[0].clientY;
              touchDragStartPanX = panX;
              touchDragStartPanY = panY;
              // prevent page scroll when panning video
              ev.preventDefault();
            }
          } else if (ev.touches.length === 2) {
            // pinch start
            touchInitialDist = getTouchDistance(ev.touches[0], ev.touches[1]);
            touchPinchStartZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
            // prevent default gestures (scroll/zoom) while pinching
            try {
              prevTouchAction = /** @type {any} */ (player).style.touchAction;
              /** @type {any} */ (player).style.touchAction = 'none';
            } catch (_e) {
              U.logSuppressed(_e, 'Zoom');
            }
            ev.preventDefault();
          }
        } catch (e) {
          zoomLogger?.error?.('Zoom', 'touchStart error', e);
        }
      };

      const touchMove = (/** @type {TouchEvent} */ ev) => {
        try {
          if (!featureEnabled) return;
          if (!video) return;
          if (ev.touches.length === 1 && touchDragging) {
            const dx = ev.touches[0].clientX - touchDragStartX;
            const dy = ev.touches[0].clientY - touchDragStartY;
            panX = touchDragStartPanX + dx;
            panY = touchDragStartPanY + dy;
            clampPan();
            applyZoomToVideo(video, parseFloat(input.value) || DEFAULT_ZOOM, panX, panY);
            scheduleSavePan();
            ev.preventDefault();
            return;
          }

          if (ev.touches.length === 2 && touchInitialDist && touchPinchStartZoom != null) {
            const dist = getTouchDistance(ev.touches[0], ev.touches[1]);
            if (dist <= 0) return;
            const ratio = dist / touchInitialDist;
            const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, touchPinchStartZoom * ratio));
            setZoom(newZoom);
            ev.preventDefault();
          }
        } catch (e) {
          zoomLogger?.error?.('Zoom', 'touchMove error', e);
        }
      };

      const touchEnd = (/** @type {TouchEvent} */ ev) => {
        try {
          if (!featureEnabled) return;
          if (touchDragging && ev.touches.length === 0) {
            touchDragging = false;
          }
          if (ev.touches.length < 2) {
            touchInitialDist = null;
            touchPinchStartZoom = null;
            if (prevTouchAction != null) {
              try {
                /** @type {any} */ (player).style.touchAction = prevTouchAction;
              } catch (_e) {
                U.logSuppressed(_e, 'Zoom');
              }
              prevTouchAction = null;
            }
          }
        } catch (e) {
          zoomLogger?.error?.('Zoom', 'touchEnd error', e);
        }
      };

      try {
        // Use non-passive handlers so we can preventDefault when needed
        player.addEventListener('touchstart', touchStart, { passive: false });
        player.addEventListener('touchmove', touchMove, { passive: false });
        player.addEventListener('touchend', touchEnd, { passive: true });
        player.addEventListener('touchcancel', touchEnd, { passive: true });
      } catch (e) {
        zoomLogger?.error?.('Zoom', 'Failed to attach touch handlers', e);
      }

      // Fallback mouse handlers for more reliable dragging on desktop
      const mouseDownHandler = (/** @type {MouseEvent} */ ev) => {
        try {
          if (!featureEnabled) return;
          if (ev.button !== 0 || !video) return;
          // Only intercept mousedown (and call preventDefault) when actually zoomed in.
          // At default zoom (1×) we must NOT call preventDefault() because it breaks
          // YouTube's native hold-left-mouse-button → 2× speed feature.
          const currentZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
          if (currentZoom <= 1) return;
          dragging = true;
          dragStartX = ev.clientX;
          dragStartY = ev.clientY;
          dragStartPanX = panX;
          dragStartPanY = panY;
          try {
            /** @type {any} */ (video).style.cursor = 'grabbing';
          } catch (_e) {
            U.logSuppressed(_e, 'Zoom');
          }
          ev.preventDefault();
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
      };

      const mouseMoveHandler = (/** @type {MouseEvent} */ ev) => {
        try {
          if (!featureEnabled) return;
          if (!(dragging && video)) return;

          const dx = ev.clientX - dragStartX;
          const dy = ev.clientY - dragStartY;
          panX = dragStartPanX + dx;
          panY = dragStartPanY + dy;
          clampPan();

          // Use RAF to avoid excessive repaints
          if (video && !video._panRAF) {
            const activeVideo = video;
            activeVideo._panRAF = requestAnimationFrame(() => {
              applyZoomToVideo(activeVideo, parseFloat(input.value) || DEFAULT_ZOOM, panX, panY);
              // persist pan after RAF'd update
              scheduleSavePan();
              activeVideo._panRAF = null;
            });
          }

          ev.preventDefault();
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Mouse move error', err);
        }
      };

      const mouseUpHandler = (/** @type {MouseEvent} */ _ev) => {
        try {
          if (!featureEnabled) return;
          if (dragging) {
            dragging = false;
            try {
              if (video) {
                /** @type {any} */ (video).style.cursor = parseFloat(input.value) > 1 ? 'grab' : '';
              }
            } catch (_e) {
              U.logSuppressed(_e, 'Zoom');
            }
          }
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
      };

      if (video) {
        try {
          video.addEventListener('mousedown', mouseDownHandler);
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
        try {
          window.addEventListener('mousemove', mouseMoveHandler);
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
        try {
          window.addEventListener('mouseup', mouseUpHandler);
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
        // Attach style observer to ensure transform isn't clobbered by YouTube
        try {
          attachStyleObserver();
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
      }

      function handleVideoStyleMutations(/** @type {MutationRecord[]} */ muts) {
        try {
          // Skip if we're currently applying a transform
          if (_isApplyingTransform) return;

          for (const m of muts) {
            if (m.type === 'attributes' && m.attributeName === 'style') {
              // If transform has been changed externally, restore expected transform
              const current = video?.style?.transform || '';
              const expectedZoom = readZoomPan().zoom || parseFloat(input.value) || DEFAULT_ZOOM;
              const expected = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${expectedZoom.toFixed(3)})`;

              // Only restore if transform was actually changed by YouTube (not by us)
              // and the current zoom is not default
              if (
                expectedZoom !== DEFAULT_ZOOM &&
                current !== expected &&
                current !== _lastTransformApplied
              ) {
                // Reapply on next frame to minimize layout thrash
                requestAnimationFrame(() => {
                  try {
                    applyZoomToVideo(video, expectedZoom, panX, panY);
                    try {
                      logRestoreEvent({
                        action: 'restore_transform',
                        currentTransform: current,
                        expectedTransform: expected,
                        zoom: expectedZoom,
                        panX,
                        panY,
                      });
                    } catch (_e) {
                      U.logSuppressed(_e, 'Zoom');
                    }
                  } catch (_e) {
                    U.logSuppressed(_e, 'Zoom');
                  }
                });
              }
            }
          }
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
      }

      function attachStyleObserver() {
        if (videoStyleObserver) {
          mutationCoordinator?.unwatch?.(videoStyleObserver);
          videoStyleObserver = null;
        }
        if (!(video && mutationCoordinator?.watchTarget)) return;
        videoStyleObserver = videoStyleSubId;
        mutationCoordinator.watchTarget(videoStyleObserver, video, handleVideoStyleMutations, {
          attributes: true,
          childList: false,
          subtree: false,
          attributeFilter: ['style'],
        });
      }

      // If video element is replaced by YouTube (e.g. fullscreen toggle or navigation), rebind handlers
      const handlePlayerMutations = () => {
        try {
          const newVideo = findVideoElement();
          if (newVideo && newVideo !== video) {
            // Remove listeners from old video
            try {
              if (video) {
                video.removeEventListener('mousedown', mouseDownHandler);
                video.removeEventListener('wheel', wheelHandler);
                if (video._panRAF) {
                  cancelAnimationFrame(video._panRAF);
                  video._panRAF = null;
                }
              }
            } catch (err) {
              zoomLogger?.error?.('Zoom', 'Error detaching from old video', err);
            }

            // Update reference
            video = newVideo;

            // Reattach style observer for the new video element
            try {
              attachStyleObserver();
            } catch (err) {
              zoomLogger?.error?.('Zoom', 'Error attaching style observer to new video', err);
            }

            // Reapply zoom to the new video
            try {
              const current = readZoomPan().zoom || DEFAULT_ZOOM;
              clampPan(current);
              applyZoomToVideo(video, current, panX, panY);
            } catch (err) {
              zoomLogger?.error?.('Zoom', 'Error applying zoom to new video', err);
            }

            // Attach listeners to new video
            try {
              video.addEventListener('mousedown', mouseDownHandler);
            } catch (err) {
              zoomLogger?.error?.('Zoom', 'Error attaching mousedown to new video', err);
            }
            try {
              video.addEventListener('wheel', wheelHandler, { passive: false });
            } catch (err) {
              zoomLogger?.error?.('Zoom', 'Error attaching wheel to new video', err);
            }
          }
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Player observer error', err);
        }
      };

      let playerObserverActive = false;
      try {
        if (mutationCoordinator?.watchTarget) {
          mutationCoordinator.watchTarget(playerObserverSubId, player, handlePlayerMutations, {
            childList: true,
            subtree: true,
            attributes: false,
          });
          playerObserverActive = true;
          if (U?.ObserverRegistry?.track) {
            U.ObserverRegistry.track();
          }
        }
      } catch (err) {
        zoomLogger?.error?.('Zoom', 'Failed to observe player for video changes', err);
      }

      // Reapply zoom on fullscreen change since layout may move elements.
      // Use a short timeout to allow YouTube to move/replace the video element
      // when entering/leaving fullscreen, and listen for vendor-prefixed events.
      const fullscreenHandler = () => {
        try {
          const current = readZoomPan().zoom || DEFAULT_ZOOM;
          // Attempt to find/apply multiple times — YouTube may move/replace the video element
          setTimeout_(() => {
            try {
              let attempts = 0;
              const tryApply = () => {
                try {
                  const newVideo = findVideoElement();
                  let swapped = false;
                  if (newVideo && newVideo !== video) {
                    // detach from old video listeners safely
                    try {
                      if (video) video.removeEventListener('wheel', wheelHandler);
                    } catch (_e) {
                      U.logSuppressed(_e, 'Zoom');
                    }

                    video = newVideo;
                    swapped = true;

                    // Reattach wheel handler if needed
                    try {
                      video.addEventListener('wheel', wheelHandler, { passive: false });
                    } catch (_e) {
                      U.logSuppressed(_e, 'Zoom');
                    }
                  }

                  clampPan(current);
                  // Apply zoom without transition during fullscreen to prevent flicker
                  if (video) applyZoomToVideo(video, current, panX, panY, false, true);

                  // If we didn't find/replace video yet, retry a few times
                  if (!swapped && (!video || attempts < FULLSCREEN_APPLY_RETRIES)) {
                    attempts += 1;
                    setTimeout_(tryApply, FULLSCREEN_APPLY_RETRY_DELAY);
                  }
                } catch (e) {
                  zoomLogger?.error?.('Zoom', 'Fullscreen apply attempt error', e);
                }
              };
              tryApply();
            } catch (e) {
              zoomLogger?.error?.('Zoom', 'Fullscreen inner apply error', e);
            }
          }, FULLSCREEN_APPLY_DELAY);
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Fullscreen handler error', err);
        }
      };
      [
        'fullscreenchange',
        'webkitfullscreenchange',
        'mozfullscreenchange',
        'MSFullscreenChange',
      ].forEach(evt => {
        document.addEventListener(evt, fullscreenHandler);
        if (U?.cleanupManager?.registerListener) {
          U.cleanupManager.registerListener(document, evt, fullscreenHandler);
        }
      });

      // Apply initial zoom and attach UI
      // Restore stored pan values (if any) and clamp before applying zoom
      try {
        try {
          const s = readZoomPan();
          if (Number.isFinite(s.panX)) panX = s.panX;
          if (Number.isFinite(s.panY)) panY = s.panY;
          // Ensure pan is within limits for the initial zoom
          clampPan(initZoomVal);
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Restore pan error', err);
        }
      } catch (err) {
        zoomLogger?.error?.('Zoom', 'Initial zoom setup error', err);
      }

      // Initialize transform tracking with the initial state
      try {
        const initialTransform = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${initZoomVal.toFixed(3)})`;
        _lastTransformApplied = initialTransform;
      } catch (_e) {
        U.logSuppressed(_e, 'Zoom');
      }

      setZoom(initZoomVal);
      // Position the zoom control above YouTube's bottom chrome (progress bar / controls).
      const updateZoomPosition = () => {
        try {
          const chrome = player.querySelector('.ytp-chrome-bottom');
          // If chrome exists, place the control just above it; otherwise keep the CSS fallback.
          if (chrome?.offsetHeight) {
            const offset = chrome.offsetHeight + 8; // small gap above controls
            /** @type {any} */ (wrap).style.bottom = `${offset}px`;
          } else {
            // fallback to original design value
            /** @type {any} */ (wrap).style.bottom = '';
          }
        } catch (_e) {
          // ignore positioning errors
        }
      };

      // Initial position and reactive updates for fullscreen / resize / chrome changes
      updateZoomPosition();

      // Use a safe ResizeObserver callback that schedules the actual work on the
      // next animation frame. This reduces the chance of a "ResizeObserver loop
      // completed with undelivered notifications" error caused by synchronous
      // layout work inside the observer callback.
      const ro = new ResizeObserver((/** @type {ResizeObserverEntry[]} */ _entries) => {
        try {
          if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
              try {
                updateZoomPosition();
              } catch (e) {
                try {
                  U?.logError?.(
                    'Enhanced',
                    'updateZoomPosition failed',
                    e instanceof Error ? e : new Error(String(e))
                  );
                } catch (_e) {
                  U.logSuppressed(_e, 'Zoom');
                }
              }
            });
          } else {
            // fallback
            updateZoomPosition();
          }
        } catch (e) {
          try {
            U?.logError?.(
              'Enhanced',
              'ResizeObserver callback error',
              e instanceof Error ? e : new Error(String(e))
            );
          } catch (_e) {
            U.logSuppressed(_e, 'Zoom');
          }
        }
      });

      // Register observer with cleanup manager so it gets disconnected on unload/cleanup
      try {
        if (U?.cleanupManager) {
          U.cleanupManager.registerObserver(/** @type {any} */ (ro));
        }
      } catch (_e) {
        U.logSuppressed(_e, 'Zoom');
      }

      try {
        const chromeEl = player.querySelector('.ytp-chrome-bottom');
        if (chromeEl) ro.observe(chromeEl);
      } catch (e) {
        try {
          U?.logError?.(
            'Enhanced',
            'Failed to observe chrome element',
            e instanceof Error ? e : new Error(String(e))
          );
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
      }

      // Keep a window resize listener for fallback positioning
      try {
        window.addEventListener('resize', updateZoomPosition, { passive: true });
        if (U?.cleanupManager) {
          U.cleanupManager.registerListener(window, 'resize', updateZoomPosition);
        }
      } catch (_e) {
        U.logSuppressed(_e, 'Zoom');
      }

      // Reposition on fullscreen changes (vendor-prefixed events included)
      [
        'fullscreenchange',
        'webkitfullscreenchange',
        'mozfullscreenchange',
        'MSFullscreenChange',
      ].forEach(evt => {
        try {
          document.addEventListener(evt, updateZoomPosition);
          if (U?.cleanupManager) {
            U.cleanupManager.registerListener(document, evt, updateZoomPosition);
          }
        } catch (_e) {
          U.logSuppressed(_e, 'Zoom');
        }
      });

      player.appendChild(wrap);

      // Cleanup
      const cleanup = () => {
        try {
          // Clear throttle timer
          if (wheelThrottleTimer) {
            clearTimeout(wheelThrottleTimer);
            wheelThrottleTimer = null;
          }

          // Clear pan save timer
          if (panSaveTimer) {
            clearTimeout(panSaveTimer);
            panSaveTimer = null;
          }

          // Cancel pending RAF
          if (video?._panRAF) {
            cancelAnimationFrame(video._panRAF);
            video._panRAF = null;
          }

          // Remove all event listeners
          player.removeEventListener('wheel', wheelHandler);
          player.removeEventListener('pointerdown', pointerDown);
          player.removeEventListener('pointermove', pointerMove);
          player.removeEventListener('pointerup', pointerUp);
          player.removeEventListener('pointercancel', pointerUp);
          window.removeEventListener('keydown', keydownHandler);

          if (video) {
            try {
              video.removeEventListener('mousedown', mouseDownHandler);
            } catch (_e) {
              U.logSuppressed(_e, 'Zoom');
            }
            try {
              video.removeEventListener('wheel', wheelHandler);
            } catch (_e) {
              U.logSuppressed(_e, 'Zoom');
            }
            try {
              window.removeEventListener('mousemove', mouseMoveHandler);
            } catch (_e) {
              U.logSuppressed(_e, 'Zoom');
            }
            try {
              window.removeEventListener('mouseup', mouseUpHandler);
            } catch (_e) {
              U.logSuppressed(_e, 'Zoom');
            }
            try {
              // Reset video styles
              /** @type {any} */ (video).style.cursor = '';
              /** @type {any} */ (video).style.transform = '';
              /** @type {any} */ (video).style.willChange = 'auto';
              /** @type {any} */ (video).style.transition = '';
            } catch (_e) {
              U.logSuppressed(_e, 'Zoom');
            }
          }

          // Disconnect style observer
          if (videoStyleObserver) {
            mutationCoordinator?.unwatch?.(videoStyleObserver);
            videoStyleObserver = null;
          }

          if (playerObserverActive) {
            mutationCoordinator?.unwatch?.(playerObserverSubId);
            playerObserverActive = false;
            try {
              U?.ObserverRegistry?.untrack?.();
            } catch (_e) {
              U.logSuppressed(_e, 'Zoom');
            }
          }

          // Remove fullscreen handler
          try {
            document.removeEventListener('fullscreenchange', fullscreenHandler);
          } catch (_e) {
            U.logSuppressed(_e, 'Zoom');
          }

          // Remove UI element
          wrap.remove();
        } catch (err) {
          zoomLogger?.error?.('Zoom', 'Cleanup error', err);
        }
      };

      if (U?.cleanupManager) {
        U.cleanupManager.register(cleanup);
      }

      _activeZoomCleanup = cleanup;

      return wrap;
    }

    // Guard: track whether the yt-navigate-finish listener was already added so that
    // toggling the zoom feature on/off does not accumulate duplicate listeners.
    let _navigateListenerAdded = false;

    // Call this to initialize zoom (e.g. on page load / SPA navigation)
    function initZoom() {
      try {
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
        if (!_navigateListenerAdded) {
          _navigateListenerAdded = true;

          const handleNavigation = () => {
            try {
              // Reset saved zoom/pan on navigation to prevent subsequent videos from starting zoomed
              saveZoomPan(DEFAULT_ZOOM, 0, 0);
              // Clear zoom UI immediately to prevent stale elements/observers from lingering
              clearZoomUI();
            } catch {}
            setTimeout_(() => {
              try {
                if (canRenderZoomUI()) createZoomUI();
                else clearZoomUI();
              } catch {}
            }, 300);
          };

          window.addEventListener('yt-navigate-finish', handleNavigation);
          // Safety net: LazyLoader dispatches ytp:nav-refresh after every SPA nav
          window.addEventListener('ytp:nav-refresh', handleNavigation);
        }
      } catch (e) {
        zoomLogger?.error?.('Zoom', 'initZoom error', e);
      }
    }

    window.addEventListener(
      'youtube-plus-settings-updated',
      /** @type {EventListener} */ (
        e => {
          try {
            const detail = /** @type {any} */ (e).detail;
            const nextEnabled = detail?.enableZoom !== false;
            if (nextEnabled === featureEnabled) return;
            setFeatureEnabled(nextEnabled);
          } catch (_e) {
            setFeatureEnabled(U?.loadFeatureEnabled?.('enableZoom') ?? true);
          }
        }
      )
    );

    // Ensure initZoom is used to avoid unused-var lint and to initialize feature
    try {
      initZoom();
    } catch (_e) {
      U.logSuppressed(_e, 'Zoom');
    }
  }; // end initZoomModule

  // Defer zoom init via the relevance helper
  if (U?.whenRelevant) {
    U.whenRelevant({
      name: 'zoom',
      isRelevant: isRelevantRoute,
      onEnter: initZoomModule,
    });
  } else {
    initZoomModule();
  }
})();
