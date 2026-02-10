// --- Zoom UI with wheel, pinch and keyboard support ---
(function () {
  'use strict';

  let featureEnabled = true;
  const loadFeatureEnabled = () => {
    try {
      const settings = localStorage.getItem('youtube_plus_settings');
      if (settings) {
        const parsed = JSON.parse(settings);
        return parsed.enableZoom !== false;
      }
    } catch {}
    return true;
  };
  const clearZoomUI = () => {
    try {
      const ui = byId('ytp-zoom-control');
      if (ui) ui.remove();
    } catch {}
    try {
      const styles = byId('ytp-zoom-styles');
      if (styles) styles.remove();
    } catch {}
    try {
      const video = findVideoElement();
      if (video) {
        video.style.transform = '';
        video.style.willChange = '';
        video.style.transition = '';
        video.style.cursor = '';
      }
    } catch {}
  };
  const setFeatureEnabled = nextEnabled => {
    featureEnabled = nextEnabled !== false;
    if (!featureEnabled) {
      clearZoomUI();
    } else {
      try {
        initZoom();
      } catch {}
    }
  };

  featureEnabled = loadFeatureEnabled();

  // DOM helpers
  const _getDOMCache = () => typeof window !== 'undefined' && window.YouTubeDOMCache;
  const $ = (sel, ctx) =>
    _getDOMCache()?.querySelector(sel, ctx) || (ctx || document).querySelector(sel);
  const byId = id => _getDOMCache()?.getElementById(id) || document.getElementById(id);

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
      const zoom = Number(obj && obj.zoom) || DEFAULT_ZOOM;
      const panX = Number(obj && obj.panX) || 0;
      const panY = Number(obj && obj.panY) || 0;
      return { zoom, panX, panY };
    } catch {
      return { zoom: DEFAULT_ZOOM, panX: 0, panY: 0 };
    }
  }

  function saveZoomPan(zoom, panX, panY) {
    try {
      const obj = {
        zoom: Number(zoom) || DEFAULT_ZOOM,
        panX: Number(panX) || 0,
        panY: Number(panY) || 0,
      };
      localStorage.setItem(ZOOM_PAN_STORAGE_KEY, JSON.stringify(obj));
    } catch {}
  }

  function logRestoreEvent(evt) {
    try {
      const entry = Object.assign({ time: new Date().toISOString() }, evt);
      try {
        const raw = sessionStorage.getItem(RESTORE_LOG_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        arr.push(entry);
        // keep last 200 entries
        if (arr.length > 200) arr.splice(0, arr.length - 200);
        sessionStorage.setItem(RESTORE_LOG_KEY, JSON.stringify(arr));
      } catch {
        // fallback: ignore
      }
      // Console output for live debugging
      console.warn('[YouTube+] Zoom restore:', entry);
    } catch {}
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
    videoEl,
    zoom,
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
      container.style.overflow = 'visible';
      if (!container.style.position || container.style.position === 'static') {
        container.style.position = 'relative';
      }

      // Set transform origin to center for natural zoom
      videoEl.style.transformOrigin = 'center center';

      // Apply transform with proper precision
      const transformStr = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${zoom.toFixed(3)})`;
      videoEl.style.transform = transformStr;

      // Track the transform we just applied
      if (!skipTransformTracking) {
        _lastTransformApplied = transformStr;
      }

      // Use will-change for GPU acceleration
      videoEl.style.willChange = zoom !== 1 ? 'transform' : 'auto';

      // Smooth transition for better UX (skip during fullscreen transitions to avoid flicker)
      videoEl.style.transition = skipTransition ? 'none' : 'transform .08s ease-out';

      // Reset flag after a short delay
      if (!skipTransformTracking) {
        setTimeout(() => {
          _isApplyingTransform = false;
        }, 100);
      }
    } catch (e) {
      console.error('[YouTube+] applyZoomToVideo error:', e);
      _isApplyingTransform = false;
    }
  };

  function createZoomUI() {
    const player = $('#movie_player');
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
      #ytp-zoom-control{position: absolute; left: 12px; bottom: 64px; z-index: 2200; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 24px; background: rgba(0,0,0,0.35); color: #fff; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); backdrop-filter: blur(6px);}
      #ytp-zoom-control input[type=range]{width: 120px; -webkit-appearance: none; background: transparent; height: 24px;}
      /* WebKit track */
      #ytp-zoom-control input[type=range]::-webkit-slider-runnable-track{height: 4px; background: rgba(255,255,255,0.12); border-radius: 3px;}
      #ytp-zoom-control input[type=range]::-webkit-slider-thumb{-webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 6px rgba(255,255,255,0.06); margin-top: -4px;}
      /* Firefox */
      #ytp-zoom-control input[type=range]::-moz-range-track{height: 4px; background: rgba(255,255,255,0.12); border-radius: 3px;}
      #ytp-zoom-control input[type=range]::-moz-range-thumb{width: 12px; height: 12px; border-radius: 50%; background: #fff; border: none;}
      #ytp-zoom-control .zoom-label{min-width:36px;text-align:center;font-size:11px;padding:0 6px;user-select:none}
      #ytp-zoom-control::after{content:'Shift + Wheel to zoom';position:absolute;bottom:100%;right:0;padding:4px 8px;background:rgba(0,0,0,0.8);color:#fff;font-size:10px;border-radius:4px;white-space:nowrap;opacity:0;pointer-events:none;transform:translateY(4px);transition:opacity .2s,transform .2s}
      #ytp-zoom-control:hover::after{opacity:1;transform:translateY(-4px)}
      #ytp-zoom-control .zoom-reset{background: rgba(255,255,255,0.06); border: none; color: inherit; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer; width: 28px; height: 28px;}
      #ytp-zoom-control .zoom-reset:hover{background: rgba(255,255,255,0.12)}
      #ytp-zoom-control .zoom-reset svg{display:block;width:14px;height:14px}
      /* Hidden state to mirror YouTube controls autohide */
      #ytp-zoom-control.ytp-hidden{opacity:0;transform:translateY(6px);pointer-events:none}
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
    reset.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4V1l-5 5 5 5V7a7 7 0 1 1-7 7" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  `;

    wrap.appendChild(input);
    wrap.appendChild(label);
    wrap.appendChild(reset);

    let video = findVideoElement();
    const stored = readZoomPan().zoom;
    const initZoomVal = Number.isFinite(stored) && !Number.isNaN(stored) ? stored : DEFAULT_ZOOM;

    const setZoom = z => {
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
              video.style.cursor = clamped > 1 ? 'grab' : '';
            } catch {}
          } catch (err) {
            console.error('[YouTube+] Apply zoom error:', err);
          }
        });
      }

      try {
        saveZoomPan(clamped, panX, panY);
      } catch (err) {
        console.error('[YouTube+] Save zoom error:', err);
      }
    };

    input.addEventListener('input', e => setZoom(e.target.value));
    reset.addEventListener('click', () => {
      try {
        panX = 0;
        panY = 0;
        setZoom(DEFAULT_ZOOM);
        // persist reset pan immediately
        try {
          // set via combined storage
          saveZoomPan(DEFAULT_ZOOM, 0, 0);
        } catch {}
        // Provide visual feedback
        reset.style.transform = 'scale(0.9)';
        setTimeout(() => {
          reset.style.transform = '';
        }, 150);
      } catch (err) {
        console.error('[YouTube+] Reset zoom error:', err);
      }
    });

    // Wheel: Shift + wheel to zoom (with throttling for performance)
    let wheelThrottleTimer = null;
    // Throttled pan save timer to avoid excessive localStorage writes
    let panSaveTimer = null;
    const scheduleSavePan = () => {
      try {
        if (panSaveTimer) clearTimeout(panSaveTimer);
        panSaveTimer = setTimeout(() => {
          try {
            const currentZoom = parseFloat(input.value) || readZoomPan().zoom || DEFAULT_ZOOM;
            saveZoomPan(currentZoom, panX, panY);
          } catch (err) {
            console.error('[YouTube+] Save pan error:', err);
          }
          panSaveTimer = null;
        }, 220);
      } catch (err) {
        console.error('[YouTube+] Schedule save pan error:', err);
      }
    };
    const wheelHandler = ev => {
      try {
        if (!featureEnabled) return;
        if (!ev.shiftKey) return;
        ev.preventDefault();

        // Throttle wheel events to prevent excessive zoom changes
        if (wheelThrottleTimer) return;

        wheelThrottleTimer = setTimeout(() => {
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
        console.error('[YouTube+] Wheel zoom error:', err);
      }
    };
    // Attach wheel handler to player and video (if present) so it works over controls
    player.addEventListener('wheel', wheelHandler, { passive: false });
    if (video) {
      try {
        video.addEventListener('wheel', wheelHandler, { passive: false });
      } catch (err) {
        console.error('[YouTube+] Failed to attach wheel handler to video:', err);
      }
    }

    // Keyboard +/- (ignore when typing)
    const keydownHandler = ev => {
      try {
        if (!featureEnabled) return;
        const active = document.activeElement;
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
      } catch {}
    };
    window.addEventListener('keydown', keydownHandler);

    // Pinch-to-zoom using Pointer Events
    // Panning (drag) state
    let panX = 0;
    let panY = 0;
    // Observer to watch for external changes to the video's style (YouTube may override transform)
    let videoStyleObserver = null;

    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartPanX = 0;
    let dragStartPanY = 0;

    const clampPan = (zoom = readZoomPan().zoom) => {
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
        if (!baseW || !baseH || !Number.isFinite(baseW) || !Number.isFinite(baseH)) return;

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
        console.error('[YouTube+] Clamp pan error:', err);
      }
    };

    const pointers = new Map();
    let initialPinchDist = null;
    let pinchStartZoom = null;
    let prevTouchAction = null;
    const getDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    const pointerDown = ev => {
      try {
        if (!featureEnabled) return;
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        try {
          ev.target.setPointerCapture(ev.pointerId);
        } catch {}
        // Start mouse drag for panning when single mouse pointer
        try {
          if (ev.pointerType === 'mouse' && ev.button === 0 && pointers.size <= 1 && video) {
            dragging = true;
            dragStartX = ev.clientX;
            dragStartY = ev.clientY;
            dragStartPanX = panX;
            dragStartPanY = panY;
            try {
              video.style.cursor = 'grabbing';
            } catch {}
          }
        } catch {}
        if (pointers.size === 2) {
          const pts = Array.from(pointers.values());
          initialPinchDist = getDistance(pts[0], pts[1]);
          pinchStartZoom = readZoomPan().zoom;
          prevTouchAction = player.style.touchAction;
          try {
            player.style.touchAction = 'none';
          } catch {}
        }
      } catch {}
    };

    const pointerMove = ev => {
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
      } catch {}
    };

    const pointerUp = ev => {
      try {
        if (!featureEnabled) return;
        pointers.delete(ev.pointerId);
        try {
          ev.target.releasePointerCapture(ev.pointerId);
        } catch {}
        // stop dragging
        try {
          if (dragging && ev.pointerType === 'mouse') {
            dragging = false;
            try {
              if (video) video.style.cursor = parseFloat(input.value) > 1 ? 'grab' : '';
            } catch {}
          }
        } catch {}
        if (pointers.size < 2) {
          initialPinchDist = null;
          pinchStartZoom = null;
          if (prevTouchAction != null) {
            try {
              player.style.touchAction = prevTouchAction;
            } catch {}
            prevTouchAction = null;
          }
        }
      } catch {}
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
    let touchInitialDist = null;
    let touchPinchStartZoom = null;

    const getTouchDistance = (t1, t2) =>
      Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    const touchStart = ev => {
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
            prevTouchAction = player.style.touchAction;
            player.style.touchAction = 'none';
          } catch {}
          ev.preventDefault();
        }
      } catch (e) {
        console.error('[YouTube+] touchStart error:', e);
      }
    };

    const touchMove = ev => {
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
        console.error('[YouTube+] touchMove error:', e);
      }
    };

    const touchEnd = ev => {
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
              player.style.touchAction = prevTouchAction;
            } catch {}
            prevTouchAction = null;
          }
        }
      } catch (e) {
        console.error('[YouTube+] touchEnd error:', e);
      }
    };

    try {
      // Use non-passive handlers so we can preventDefault when needed
      player.addEventListener('touchstart', touchStart, { passive: false });
      player.addEventListener('touchmove', touchMove, { passive: false });
      player.addEventListener('touchend', touchEnd, { passive: true });
      player.addEventListener('touchcancel', touchEnd, { passive: true });
    } catch (e) {
      console.error('[YouTube+] Failed to attach touch handlers:', e);
    }

    // Fallback mouse handlers for more reliable dragging on desktop
    const mouseDownHandler = ev => {
      try {
        if (!featureEnabled) return;
        if (ev.button !== 0 || !video) return;
        dragging = true;
        dragStartX = ev.clientX;
        dragStartY = ev.clientY;
        dragStartPanX = panX;
        dragStartPanY = panY;
        try {
          video.style.cursor = 'grabbing';
        } catch {}
        ev.preventDefault();
      } catch {}
    };

    const mouseMoveHandler = ev => {
      try {
        if (!featureEnabled) return;
        if (!dragging || !video) return;

        const dx = ev.clientX - dragStartX;
        const dy = ev.clientY - dragStartY;
        panX = dragStartPanX + dx;
        panY = dragStartPanY + dy;
        clampPan();

        // Use RAF to avoid excessive repaints
        if (!video._panRAF) {
          video._panRAF = requestAnimationFrame(() => {
            applyZoomToVideo(video, parseFloat(input.value) || DEFAULT_ZOOM, panX, panY);
            // persist pan after RAF'd update
            scheduleSavePan();
            video._panRAF = null;
          });
        }

        ev.preventDefault();
      } catch (err) {
        console.error('[YouTube+] Mouse move error:', err);
      }
    };

    const mouseUpHandler = _ev => {
      try {
        if (!featureEnabled) return;
        if (dragging) {
          dragging = false;
          try {
            if (video) video.style.cursor = parseFloat(input.value) > 1 ? 'grab' : '';
          } catch {}
        }
      } catch {}
    };

    if (video) {
      try {
        video.addEventListener('mousedown', mouseDownHandler);
      } catch {}
      try {
        window.addEventListener('mousemove', mouseMoveHandler);
      } catch {}
      try {
        window.addEventListener('mouseup', mouseUpHandler);
      } catch {}
      // Attach style observer to ensure transform isn't clobbered by YouTube
      try {
        const attachStyleObserver = () => {
          try {
            if (videoStyleObserver) {
              try {
                videoStyleObserver.disconnect();
              } catch {}
              videoStyleObserver = null;
            }
            if (!video) return;
            videoStyleObserver = new MutationObserver(muts => {
              try {
                // Skip if we're currently applying a transform
                if (_isApplyingTransform) return;

                for (const m of muts) {
                  if (m.type === 'attributes' && m.attributeName === 'style') {
                    // If transform has been changed externally, restore expected transform
                    const current = (video && video.style && video.style.transform) || '';
                    const expectedZoom =
                      readZoomPan().zoom || parseFloat(input.value) || DEFAULT_ZOOM;
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
                          } catch {}
                        } catch {}
                      });
                    }
                  }
                }
              } catch {}
            });
            videoStyleObserver.observe(video, { attributes: true, attributeFilter: ['style'] });
          } catch {}
        };
        attachStyleObserver();
      } catch {}
    }

    // If video element is replaced by YouTube (e.g. fullscreen toggle or navigation), rebind handlers
    const playerObserver = new MutationObserver(() => {
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
            console.error('[YouTube+] Error detaching from old video:', err);
          }

          // Update reference
          video = newVideo;

          // Reattach style observer for the new video element
          try {
            if (videoStyleObserver) {
              try {
                videoStyleObserver.disconnect();
              } catch {}
              videoStyleObserver = null;
            }
            if (video) {
              videoStyleObserver = new MutationObserver(muts => {
                try {
                  // Skip if we're currently applying a transform
                  if (_isApplyingTransform) return;

                  for (const m of muts) {
                    if (m.type === 'attributes' && m.attributeName === 'style') {
                      const current = (video && video.style && video.style.transform) || '';
                      const expectedZoom =
                        readZoomPan().zoom || parseFloat(input.value) || DEFAULT_ZOOM;
                      const expected = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${expectedZoom.toFixed(3)})`;

                      // Only restore if transform was actually changed by YouTube (not by us)
                      // and the current zoom is not default
                      if (
                        expectedZoom !== DEFAULT_ZOOM &&
                        current !== expected &&
                        current !== _lastTransformApplied
                      ) {
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
                            } catch {}
                          } catch {}
                        });
                      }
                    }
                  }
                } catch {}
              });
              videoStyleObserver.observe(video, { attributes: true, attributeFilter: ['style'] });
            }
          } catch (err) {
            console.error('[YouTube+] Error attaching style observer to new video:', err);
          }

          // Reapply zoom to the new video
          try {
            const current = readZoomPan().zoom || DEFAULT_ZOOM;
            clampPan(current);
            applyZoomToVideo(video, current, panX, panY);
          } catch (err) {
            console.error('[YouTube+] Error applying zoom to new video:', err);
          }

          // Attach listeners to new video
          try {
            video.addEventListener('mousedown', mouseDownHandler);
          } catch (err) {
            console.error('[YouTube+] Error attaching mousedown to new video:', err);
          }
          try {
            video.addEventListener('wheel', wheelHandler, { passive: false });
          } catch (err) {
            console.error('[YouTube+] Error attaching wheel to new video:', err);
          }
        }
      } catch (err) {
        console.error('[YouTube+] Player observer error:', err);
      }
    });
    try {
      playerObserver.observe(player, { childList: true, subtree: true });
    } catch (err) {
      console.error('[YouTube+] Failed to observe player for video changes:', err);
    }

    // Reapply zoom on fullscreen change since layout may move elements.
    // Use a short timeout to allow YouTube to move/replace the video element
    // when entering/leaving fullscreen, and listen for vendor-prefixed events.
    const fullscreenHandler = () => {
      try {
        const current = readZoomPan().zoom || DEFAULT_ZOOM;
        // Attempt to find/apply multiple times — YouTube may move/replace the video element
        setTimeout(() => {
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
                  } catch {}

                  video = newVideo;
                  swapped = true;

                  // Reattach wheel handler if needed
                  try {
                    video.addEventListener('wheel', wheelHandler, { passive: false });
                  } catch {}
                }

                clampPan(current);
                // Apply zoom without transition during fullscreen to prevent flicker
                if (video) applyZoomToVideo(video, current, panX, panY, false, true);

                // If we didn't find/replace video yet, retry a few times
                if (!swapped && (!video || attempts < FULLSCREEN_APPLY_RETRIES)) {
                  attempts += 1;
                  setTimeout(tryApply, FULLSCREEN_APPLY_RETRY_DELAY);
                }
              } catch (e) {
                console.error('[YouTube+] Fullscreen apply attempt error:', e);
              }
            };
            tryApply();
          } catch (e) {
            console.error('[YouTube+] Fullscreen inner apply error:', e);
          }
        }, FULLSCREEN_APPLY_DELAY);
      } catch (err) {
        console.error('[YouTube+] Fullscreen handler error:', err);
      }
    };
    [
      'fullscreenchange',
      'webkitfullscreenchange',
      'mozfullscreenchange',
      'MSFullscreenChange',
    ].forEach(evt => document.addEventListener(evt, fullscreenHandler));

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
        console.error('[YouTube+] Restore pan error:', err);
      }
    } catch (err) {
      console.error('[YouTube+] Initial zoom setup error:', err);
    }

    // Initialize transform tracking with the initial state
    try {
      const initialTransform = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${initZoomVal.toFixed(3)})`;
      _lastTransformApplied = initialTransform;
    } catch {}

    setZoom(initZoomVal);
    // Position the zoom control above YouTube's bottom chrome (progress bar / controls).
    const updateZoomPosition = () => {
      try {
        const chrome = player.querySelector('.ytp-chrome-bottom');
        // If chrome exists, place the control just above it; otherwise keep the CSS fallback.
        if (chrome && chrome.offsetHeight) {
          const offset = chrome.offsetHeight + 8; // small gap above controls
          wrap.style.bottom = `${offset}px`;
        } else {
          // fallback to original design value
          wrap.style.bottom = '';
        }
      } catch {
        // ignore positioning errors
      }
    };

    // Initial position and reactive updates for fullscreen / resize / chrome changes
    updateZoomPosition();

    // Use a safe ResizeObserver callback that schedules the actual work on the
    // next animation frame. This reduces the chance of a "ResizeObserver loop
    // completed with undelivered notifications" error caused by synchronous
    // layout work inside the observer callback.
    const ro = new ResizeObserver(_entries => {
      try {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            try {
              updateZoomPosition();
            } catch (e) {
              try {
                YouTubeUtils &&
                  YouTubeUtils.logError &&
                  YouTubeUtils.logError('Enhanced', 'updateZoomPosition failed', e);
              } catch {}
            }
          });
        } else {
          // fallback
          updateZoomPosition();
        }
      } catch (e) {
        try {
          YouTubeUtils &&
            YouTubeUtils.logError &&
            YouTubeUtils.logError('Enhanced', 'ResizeObserver callback error', e);
        } catch {}
      }
    });

    // Register observer with cleanup manager so it gets disconnected on unload/cleanup
    try {
      if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
        YouTubeUtils.cleanupManager.registerObserver(ro);
      }
    } catch {}

    try {
      const chromeEl = player.querySelector('.ytp-chrome-bottom');
      if (chromeEl) ro.observe(chromeEl);
    } catch (e) {
      try {
        YouTubeUtils &&
          YouTubeUtils.logError &&
          YouTubeUtils.logError('Enhanced', 'Failed to observe chrome element', e);
      } catch {}
    }

    // Keep a window resize listener for fallback positioning
    try {
      window.addEventListener('resize', updateZoomPosition, { passive: true });
      if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
        YouTubeUtils.cleanupManager.registerListener(window, 'resize', updateZoomPosition);
      }
    } catch {}

    // Reposition on fullscreen changes (vendor-prefixed events included)
    [
      'fullscreenchange',
      'webkitfullscreenchange',
      'mozfullscreenchange',
      'MSFullscreenChange',
    ].forEach(evt => {
      try {
        document.addEventListener(evt, updateZoomPosition);
        if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
          YouTubeUtils.cleanupManager.registerListener(document, evt, updateZoomPosition);
        }
      } catch {}
    });

    player.appendChild(wrap);

    // Sync visibility with YouTube controls (autohide)
    const chromeBottom = player.querySelector('.ytp-chrome-bottom');
    const isControlsHidden = () => {
      try {
        // Player class flags
        if (
          player.classList.contains('ytp-autohide') ||
          player.classList.contains('ytp-hide-controls')
        ) {
          return true;
        }
        // Chrome bottom layer opacity/visibility
        if (chromeBottom) {
          const style = window.getComputedStyle(chromeBottom);
          if (
            style &&
            (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none')
          ) {
            return true;
          }
        }
      } catch {}
      return false;
    };

    const updateHidden = () => {
      try {
        if (isControlsHidden()) {
          wrap.classList.add('ytp-hidden');
        } else {
          wrap.classList.remove('ytp-hidden');
        }
      } catch {}
    };

    // Observe player class changes
    const visObserver = new MutationObserver(() => updateHidden());
    try {
      visObserver.observe(player, { attributes: true, attributeFilter: ['class', 'style'] });
      if (chromeBottom) {
        visObserver.observe(chromeBottom, {
          attributes: true,
          attributeFilter: ['class', 'style'],
        });
      }
    } catch {}

    // Temporary show on mousemove over player (like other controls)
    let showTimer = null;
    const mouseMoveShow = () => {
      try {
        wrap.classList.remove('ytp-hidden');
        if (showTimer) clearTimeout(showTimer);
        showTimer = setTimeout(updateHidden, 2200);
      } catch {}
    };
    player.addEventListener('mousemove', mouseMoveShow, { passive: true });
    // Initial sync
    updateHidden();

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
        if (video && video._panRAF) {
          cancelAnimationFrame(video._panRAF);
          video._panRAF = null;
        }

        // Remove all event listeners
        player.removeEventListener('wheel', wheelHandler);
        player.removeEventListener('pointerdown', pointerDown);
        player.removeEventListener('pointermove', pointerMove);
        player.removeEventListener('pointerup', pointerUp);
        player.removeEventListener('pointercancel', pointerUp);
        player.removeEventListener('mousemove', mouseMoveShow);
        window.removeEventListener('keydown', keydownHandler);

        if (video) {
          try {
            video.removeEventListener('mousedown', mouseDownHandler);
          } catch {}
          try {
            video.removeEventListener('wheel', wheelHandler);
          } catch {}
          try {
            window.removeEventListener('mousemove', mouseMoveHandler);
          } catch {}
          try {
            window.removeEventListener('mouseup', mouseUpHandler);
          } catch {}
          try {
            // Reset video styles
            video.style.cursor = '';
            video.style.transform = '';
            video.style.willChange = 'auto';
            video.style.transition = '';
          } catch {}
        }

        // Disconnect style observer
        if (videoStyleObserver) {
          try {
            videoStyleObserver.disconnect();
          } catch {}
          videoStyleObserver = null;
        }

        // Disconnect observer
        if (visObserver) {
          try {
            visObserver.disconnect();
          } catch {}
        }
        // Disconnect player mutation observer
        try {
          if (playerObserver) playerObserver.disconnect();
        } catch {}

        // Remove fullscreen handler
        try {
          document.removeEventListener('fullscreenchange', fullscreenHandler);
        } catch {}

        // Clear show timer
        if (showTimer) {
          clearTimeout(showTimer);
          showTimer = null;
        }

        // Remove UI element
        wrap.remove();
      } catch (err) {
        console.error('[YouTube+] Cleanup error:', err);
      }
    };

    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.register(cleanup);
    }

    return wrap;
  }

  // Call this to initialize zoom (e.g. on page load / SPA navigation)
  function initZoom() {
    try {
      if (!featureEnabled) return;
      const ensure = () => {
        const player = $('#movie_player');
        if (!player) return setTimeout(ensure, 400);
        createZoomUI();
      };
      ensure();
      window.addEventListener('yt-navigate-finish', () => setTimeout(() => createZoomUI(), 300));
    } catch {
      console.error('initZoom error');
    }
  }

  window.addEventListener('youtube-plus-settings-updated', e => {
    try {
      const nextEnabled = e?.detail?.enableZoom !== false;
      if (nextEnabled === featureEnabled) return;
      setFeatureEnabled(nextEnabled);
    } catch {
      setFeatureEnabled(loadFeatureEnabled());
    }
  });

  // Ensure initZoom is used to avoid unused-var lint and to initialize feature
  try {
    initZoom();
  } catch {}
})();
