// Speed Control: playback speed selector.
//
// Responsibility: dropdown speed selector UI for the YouTube player,
//   keyboard shortcut bindings, and per-video speed persistence.
// Public surface: window.YouTubePlusSpeedControl.
(function () {
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'SpeedControl');
  const logger = window.YouTubeUtils?.logger || window.YouTubePlusLogger || null;
  const setTimeout_ = setTimeout;
  const clearTimeout_ = clearTimeout;
  // This module owns the playback speed (state, restore and persist). All
  // reads route through getSpeed_(), all writes through setSpeed_().
  const SPEED_STORAGE_KEY = 'youtube_playback_speed';
  const speedOwnerState = { current: 1 };

  function getSpeed_() {
    return speedOwnerState.current;
  }

  /**
   * Set the owned speed value; `persist` additionally writes the storage key.
   * @param {number} n
   * @param {boolean} persist
   * @returns {number}
   */
  function setSpeed_(n, persist) {
    speedOwnerState.current = n;
    if (persist) {
      try {
        window.YouTubeUtils?.storage?.setItem(SPEED_STORAGE_KEY, String(n));
      } catch (_e) {
        logS(_e);
        /* storage may be unavailable */
      }
    }
    return n;
  }

  /**
   * Read the persisted speed once per boot; this is the only storage read for
   * the speed value.
   * @returns {number}
   */
  function restoreSpeed_() {
    try {
      const stored = Number(window.YouTubeUtils?.storage?.getItem(SPEED_STORAGE_KEY));
      if (Number.isFinite(stored) && stored > 0 && stored <= 16) speedOwnerState.current = stored;
    } catch (_e) {
      logS(_e);
    }
    return speedOwnerState.current;
  }
  // One stable handler set per dock badge, so repeated mountDock
  // calls dedup to a single live registration per event.
  /** @type {WeakMap<HTMLElement, { enter: () => void, leave: () => void, click: (e: Event) => void, keydown: (e: Event) => void, cancelPendingHide: () => void }>} */
  const badgeStableHandlers = new WeakMap();
  /**
   * @typedef {{
   *   currentSpeed: number,
   *   availableSpeeds: number[],
   *   storageKey?: string,
   *   activeAnimationId?: number | null,
   *   [key: string]: unknown,
   * }} SpeedControlState
   */

  /**
   * @typedef {{
   *   speedControl: SpeedControlState,
   *   getElement?: (selector: string) => Element | null,
   *   updateLoopProgressBar?: () => void,
   *   applyLoopStateToCurrentVideo?: () => void,
   *   _mouseButtonHeld?: boolean,
   *   _spaceHeld?: boolean,
   *   isEditableTarget?: (el: Element | null) => boolean,
   *   settings?: {
   *     speedControlHotkeys?: Record<string, string>,
   *     [key: string]: unknown,
   *   },
   *   [key: string]: unknown,
   * }} SpeedControlEnhancer
   */

  // Speed control runs as a lifecycle feature (FeatureLifecycle in
  // feature-registry.js). `speedCtx` exists only while the setting is on; the
  // classic button, the shared dropdown, the video listeners and the hotkeys
  // each own a child scope that is renewed whenever that part is rebuilt.
  /** @type {YouTubePlusFeatureContext | null} */
  let speedCtx = null;
  /** @type {YouTubePlusFeatureContext | null} */
  let classicScope = null;
  /** @type {YouTubePlusFeatureContext | null} */
  let dropdownScope = null;
  /** @type {YouTubePlusFeatureContext | null} */
  let videoScope = null;
  /** @type {YouTubePlusFeatureContext | null} */
  let hotkeyScope = null;
  /** Last enhancer handed in by basic.js; reused when the feature starts later. */
  /** @type {SpeedControlEnhancer | null} */
  let lastEnhancer = null;

  /** @type {(scope: YouTubePlusFeatureContext | null) => YouTubePlusFeatureContext | null} */
  const renewScope = previous => {
    previous?.dispose?.();
    return speedCtx ? speedCtx.scope() : null;
  };

  /** @type {(() => void) | null} */
  let stopDropdownRelayout = null;
  /** The scope the relayout pair is attached to; a rebuilt menu yields a new
   * scope instance that makes the pair's bookkeeping stale. */
  /** @type {YouTubePlusFeatureContext | null} */
  let relayoutOwner = null;

  /** Attach the window relayout pair only while `.speed-options` is open. */
  function beginDropdownRelayout() {
    const scope = dropdownScope;
    if (stopDropdownRelayout) {
      if (relayoutOwner === scope) return;
      // The owning menu was rebuilt: the scope disposal already released the
      // listeners, only the bookkeeping needs a reset.
      stopDropdownRelayout = null;
    }
    if (!scope) return;
    relayoutOwner = scope;
    const offResize = scope.listen(window, 'resize', repositionSpeedDropdown);
    const offScroll = scope.listen(window, 'scroll', repositionSpeedDropdown, { capture: true });
    stopDropdownRelayout = () => {
      offResize();
      offScroll();
      stopDropdownRelayout = null;
    };
  }

  /** Release the relayout pair on close; clears stale state after rebuilds. */
  function endDropdownRelayout() {
    stopDropdownRelayout?.();
    stopDropdownRelayout = null;
    relayoutOwner = null;
  }

  /** @type {HTMLElement | null} The speed button that currently anchors the shared dropdown. */
  let lastActiveSpeedAnchor = null;

  /**
   * The visible speed button that should anchor the dropdown: the preferred
   * anchor only when it is laid out and on screen, otherwise any visible one.
   * @param {HTMLElement | null} preferred
   * @returns {HTMLElement | null}
   */
  function findVisibleSpeedAnchor(preferred) {
    if (preferred) {
      const r = preferred.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return preferred;
    }
    for (const b of document.querySelectorAll('.speed-control-btn')) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return /** @type {HTMLElement} */ (b);
    }
    return preferred;
  }

  /**
   * Position the shared dropdown relative to its active speed anchor.
   * @param {HTMLElement | null} [anchorEl]
   */
  function applySpeedDropdownPosition(anchorEl) {
    if (anchorEl) lastActiveSpeedAnchor = anchorEl;
    const target = findVisibleSpeedAnchor(lastActiveSpeedAnchor);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    lastActiveSpeedAnchor = target;
    const speedOptions = /** @type {HTMLElement | null} */ (
      document.querySelector('.speed-options')
    );
    if (!(speedOptions instanceof HTMLElement)) return;
    const dock = window.YouTubePlusZoom?.closestDock?.(target);
    speedOptions.style.left = `${rect.left + rect.width / 2}px`;
    speedOptions.style.right = 'auto';
    window.YouTubePlusFeatureRegistry?.PopoverController?.positionDropdown?.(
      dock || target,
      speedOptions,
      { preferDown: Boolean(dock), gap: 10 }
    );
  }

  /** The open dropdown follows window scroll/resize; the relayout pair is
   * bound to the open state, so closed pages register nothing. */
  function repositionSpeedDropdown() {
    const opts = document.querySelector('.speed-options');
    if (opts?.classList.contains('visible')) applySpeedDropdownPosition();
  }

  /** @returns {HTMLElement | null} */
  const ensureIndicator = () => {
    const existing = document.getElementById('speed-indicator');
    if (existing) return existing;
    if (!speedCtx) return null;
    /** @type {HTMLElement} */
    const indicator = speedCtx.own(document.createElement('div'));
    indicator.id = 'speed-indicator';
    const player = document.getElementById('movie_player');
    if (player) player.appendChild(indicator);
    return indicator;
  };

  /**
   * @param {SpeedControlEnhancer} enhancer
   * @param {number} speed
   */
  function showSpeedIndicator(enhancer, speed) {
    const indicator = ensureIndicator();
    if (!indicator) return;
    const state = enhancer.speedControl;

    if (state.activeAnimationId) {
      cancelAnimationFrame(state.activeAnimationId);
      window.YouTubeUtils?.cleanupManager?.unregisterAnimationFrame?.(state.activeAnimationId);
      state.activeAnimationId = null;
    }

    indicator.textContent = `${speed}x`;
    indicator.style.display = 'block';
    indicator.style.opacity = '0.8';

    const startTime = performance.now();
    const fadeOut = (/** @type {number} */ timestamp) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / 1500, 1);

      indicator.style.opacity = String(0.8 * (1 - progress));

      if (progress < 1) {
        state.activeAnimationId =
          window.YouTubeUtils?.cleanupManager?.registerAnimationFrame?.(
            requestAnimationFrame(fadeOut)
          ) ||
          window.YouTubePlusCleanupManager?.registerAnimationFrame?.(
            requestAnimationFrame(fadeOut)
          );
      } else {
        indicator.style.display = 'none';
        state.activeAnimationId = null;
      }
    };

    state.activeAnimationId =
      window.YouTubeUtils?.cleanupManager?.registerAnimationFrame?.(
        requestAnimationFrame(fadeOut)
      ) ||
      window.YouTubePlusCleanupManager?.registerAnimationFrame?.(requestAnimationFrame(fadeOut));
  }

  /**
   * Reflect the owned speed on every mounted control surface (Classic button,
   * Vision dock badge and the shared dropdown). Always derived from the owner
   * state, so a restore that happens after a control mounted still shows up.
   */
  function syncSpeedControlsUI_() {
    const speed = getSpeed_();
    document.querySelectorAll('.speed-control-btn').forEach(btn => {
      const span = btn.querySelector('span');
      if (span) span.textContent = `${speed}x`;
      else btn.textContent = `${speed}x`;
    });
    document.querySelectorAll('.speed-option-item').forEach(option => {
      option.classList.toggle(
        'speed-option-active',
        parseFloat(/** @type {HTMLElement} */ (option).dataset?.speed || '0') === speed
      );
    });
  }

  /**
   * The speed value is read from the SINGLE owner state, never
   * from an enhancer-local mutable copy (the `enhancer` arg is kept for
   * surface compatibility and intentionally unused).
   * @param {SpeedControlEnhancer | null | undefined} [_enhancer]
   */
  function applyCurrentSpeed(_enhancer) {
    const videos =
      window.YouTubePlusDOMCache && typeof window.YouTubePlusDOMCache.getAll === 'function'
        ? window.YouTubePlusDOMCache.getAll('video')
        : document.querySelectorAll('video');

    videos.forEach(el => {
      const video = /** @type {HTMLVideoElement} */ (el);
      // the speed value is read from the SINGLE owner state,
      // never from an enhancer-local mutable copy.
      const ownerSpeed = getSpeed_();
      if (video && video.playbackRate !== ownerSpeed) {
        video.playbackRate = ownerSpeed;
      }
    });

    // Re-render the control surfaces: the persisted speed may have been restored
    // after a control mounted (basic.js restores once at boot).
    syncSpeedControlsUI_();
  }

  /**
   * @param {SpeedControlEnhancer} enhancer
   * @param {number|string} speed
   */
  function changeSpeed(enhancer, speed) {
    const numericSpeed = setSpeed_(Number(speed), true);
    // Mirror the value onto the enhancer facade; the owner state is the source.
    enhancer.speedControl.currentSpeed = numericSpeed;

    syncSpeedControlsUI_();

    applyCurrentSpeed(enhancer);
    showSpeedIndicator(enhancer, numericSpeed);
  }

  /**
   * @param {SpeedControlEnhancer} enhancer
   * @param {number} direction
   */
  function adjustSpeedByStep(enhancer, direction) {
    const speeds = enhancer.speedControl.availableSpeeds;
    if (!(Array.isArray(speeds) && speeds.length)) return;
    const current = getSpeed_();

    let closestIndex = 0;
    let closestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < speeds.length; i += 1) {
      const delta = Math.abs(speeds[i] - current);
      if (delta < closestDelta) {
        closestDelta = delta;
        closestIndex = i;
      }
    }

    const step = direction > 0 ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(speeds.length - 1, closestIndex + step));
    if (nextIndex === closestIndex) return;

    changeSpeed(enhancer, speeds[nextIndex]);
  }

  /**
   * Call `fn` for every <video> added by a mutation batch.
   * @param {MutationRecord[]} mutations
   * @param {(video: HTMLVideoElement) => void} fn
   */
  const forEachAddedVideo = (mutations, fn) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeName === 'VIDEO') fn(/** @type {HTMLVideoElement} */ (node));
        if (node instanceof Element) for (const v of node.querySelectorAll('video')) fn(v);
      }
    }
  };

  /**
   * Loop hooks on every video element. They belong to the loop feature and
   * stay attached whether speed control is on or off.
   * @param {SpeedControlEnhancer} enhancer
   */
  function attachLoopHooks(enhancer) {
    const updateLoopBar = () => enhancer.updateLoopProgressBar?.();
    const applyLoop = () => enhancer.applyLoopStateToCurrentVideo?.();
    const cm = window.YouTubePlusCleanupManager;
    const attach = (/** @type {Element} */ video) => {
      const v = /** @type {Element & { _ytpLoopHooksAttached?: boolean }} */ (video);
      if (v._ytpLoopHooksAttached) return;
      v._ytpLoopHooksAttached = true;
      cm?.registerListener?.(video, 'loadedmetadata', updateLoopBar, undefined, false);
      cm?.registerListener?.(video, 'loadedmetadata', applyLoop, undefined, false);
      // The per-navigation sweep removes these listeners; reset the marker with them.
      cm?.register?.(() => {
        v._ytpLoopHooksAttached = false;
      });
    };
    const playerRoot =
      document.querySelector('#movie_player') || document.querySelector('ytd-player');
    for (const video of (playerRoot || document).querySelectorAll('video')) attach(video);

    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.watchTarget) {
      const watchId = 'speedcontrol::loopVideos';
      coordinator.watchTarget(
        watchId,
        playerRoot || document.body,
        (/** @type {MutationRecord[]} */ mutations) => forEachAddedVideo(mutations, attach),
        { childList: true, attributes: false, subtree: true }
      );
      cm?.register?.(() => coordinator.unwatch?.(watchId));
    }
  }

  /**
   * Hold-to-speed bookkeeping: while the left mouse button or Space is held,
   * the player's own boost wins over the owned speed.
   * @param {YouTubePlusFeatureContext} ctx
   * @param {SpeedControlEnhancer} enhancer
   */
  function trackHoldInputs(ctx, enhancer) {
    const e_ = enhancer;
    e_._mouseButtonHeld = false;
    e_._spaceHeld = false;
    const opts = { passive: true, capture: true };
    const isSpace = (/** @type {KeyboardEvent} */ e) =>
      e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
    ctx.listen(
      document,
      'mousedown',
      /** @type {EventListener} */ (
        (/** @type {MouseEvent} */ e) => {
          if (e.button === 0) e_._mouseButtonHeld = true;
        }
      ),
      opts
    );
    ctx.listen(
      document,
      'mouseup',
      /** @type {EventListener} */ (
        (/** @type {MouseEvent} */ e) => {
          if (e.button === 0) e_._mouseButtonHeld = false;
        }
      ),
      opts
    );
    ctx.listen(
      document,
      'keydown',
      /** @type {EventListener} */ (
        (/** @type {KeyboardEvent} */ e) => {
          if (isSpace(e)) e_._spaceHeld = true;
        }
      ),
      opts
    );
    ctx.listen(
      document,
      'keyup',
      /** @type {EventListener} */ (
        (/** @type {KeyboardEvent} */ e) => {
          if (!isSpace(e)) return;
          e_._spaceHeld = false;
          // The hold is over: the owned speed is the truth again, even when the
          // player emits no ratechange of its own.
          applyCurrentSpeed(enhancer);
        }
      ),
      opts
    );
  }

  /**
   * Keep every player video at the owned speed while the feature runs.
   * Each call rebuilds the video listener scope for the current player.
   * @param {SpeedControlEnhancer} enhancer
   */
  function setupVideoObserver(enhancer) {
    if (enhancer) lastEnhancer = enhancer;
    if (enhancer) attachLoopHooks(enhancer);
    videoScope = renewScope(videoScope);
    if (!(videoScope && enhancer)) return;
    const scope = videoScope;
    trackHoldInputs(scope, enhancer);

    const applySpeed = () => applyCurrentSpeed(enhancer);
    const attached = new WeakSet();
    const attachSpeedListeners = (/** @type {HTMLVideoElement} */ video) => {
      if (attached.has(video)) return;
      attached.add(video);
      scope.listen(video, 'loadedmetadata', applySpeed);
      scope.listen(video, 'playing', applySpeed);
      let settingRate = false;
      scope.listen(video, 'ratechange', () => {
        if (settingRate) return;
        // The owned speed is the single source of truth. Reading it from the
        // captured enhancer would revert the rate whenever the value was set
        // through a different enhancer (e.g. the shared dropdown fallback).
        const target = getSpeed_();
        const holding = Boolean(enhancer._mouseButtonHeld || enhancer._spaceHeld);
        if (holding && video.playbackRate > target) return;
        if (video.playbackRate !== target) {
          settingRate = true;
          video.playbackRate = target;
          settingRate = false;
        }
      });
      applySpeed();
    };

    const playerRoot =
      document.querySelector('#movie_player') || document.querySelector('ytd-player');
    for (const video of (playerRoot || document).querySelectorAll('video')) {
      attachSpeedListeners(/** @type {HTMLVideoElement} */ (video));
    }

    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.watchTarget) {
      const watchId = 'speedcontrol::videoElements';
      coordinator.watchTarget(
        watchId,
        playerRoot || document.body,
        (/** @type {MutationRecord[]} */ mutations) =>
          forEachAddedVideo(mutations, attachSpeedListeners),
        { childList: true, attributes: false, subtree: true }
      );
      scope.onDispose(() => coordinator.unwatch?.(watchId));
    }
  }

  /**
   * Fallback enhancer for dropdown creation when the real one isn't
   * reachable (e.g. the Vision Dock requests the shared dropdown while
   * the Classic mount path never ran). Reads the persisted speed so
   * the active item is marked correctly.
   * @returns {SpeedControlEnhancer}
   */
  const createSpeedEnhancerFallback_ = () => {
    // Fallback reads the owner state, never storage.
    return {
      speedControl: {
        currentSpeed: getSpeed_(),
        availableSpeeds: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3],
        storageKey: 'youtube_playback_speed',
      },
      getElement: () => null,
    };
  };

  /**
   * Create (or replace) the shared `.speed-options` dropdown. The Classic
   * button and the Vision dock badge both find it with
   * `document.querySelector('.speed-options')`. Returns null while the
   * feature is off.
   * @param {SpeedControlEnhancer | null} [enhancer]
   * @returns {HTMLElement | null}
   */
  function ensureDropdown(enhancer) {
    dropdownScope = renewScope(dropdownScope);
    if (!dropdownScope) return null;
    const scope = dropdownScope;
    // A panel left by an earlier page instance is not owned by any scope.
    document.querySelector('.speed-options')?.remove();

    const api = enhancer || createSpeedEnhancerFallback_();
    const speedOptions = scope.own(document.createElement('div'));
    speedOptions.className = 'speed-options';
    speedOptions.setAttribute('role', 'menu');

    const selectSpeed = (/** @type {number} */ speed) => {
      changeSpeed(api, speed);
      endDropdownRelayout();
      // The classic surface's extra aria-expanded sync lives in addButton's hideDropdown.
      speedOptions.classList.remove('visible');
    };

    for (const speed of api.speedControl.availableSpeeds) {
      const option = document.createElement('div');
      option.className = `speed-option-item${Number(speed) === getSpeed_() ? ' speed-option-active' : ''}`;
      option.textContent = `${speed}x`;
      option.dataset.speed = String(speed);
      option.setAttribute('role', 'menuitem');
      option.tabIndex = 0;
      speedOptions.appendChild(option);
    }
    /** @param {Event} event */
    const itemFromEvent = event =>
      /** @type {HTMLElement | null | undefined} */ (
        /** @type {Element | null} */ (event.target)?.closest?.('.speed-option-item')
      );
    // One delegated pair on the panel instead of two listeners per item.
    scope.listen(speedOptions, 'click', (/** @type {Event} */ event) => {
      const item = itemFromEvent(event);
      if (item) selectSpeed(Number(item.dataset.speed));
    });
    scope.listen(
      speedOptions,
      'keydown',
      /** @type {EventListener} */ (
        (/** @type {KeyboardEvent} */ event) => {
          const item = itemFromEvent(event);
          if (item && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            selectSpeed(Number(item.dataset.speed));
          }
        }
      )
    );

    // The 'visible' class is toggled from several surfaces; each open/close
    // site calls the module-level relayout begin/end hook.
    document.body.appendChild(speedOptions);
    return speedOptions;
  }

  /**
   * Add the Classic player-controls speed button.
   * @param {SpeedControlEnhancer | null} enhancer
   * @param {HTMLElement} controls
   */
  function addButton(enhancer, controls) {
    if (enhancer) lastEnhancer = enhancer;
    if (!(controls && speedCtx)) return;
    if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') return;
    if (controls.querySelector('.speed-control-btn')) return;

    classicScope = renewScope(classicScope);
    const scope = /** @type {YouTubePlusFeatureContext} */ (classicScope);
    const speedOptions = ensureDropdown(enhancer);
    if (!speedOptions) return;

    const speedBtn = scope.own(document.createElement('button'));
    speedBtn.type = 'button';
    speedBtn.className = 'ytp-button speed-control-btn';
    speedBtn.setAttribute(
      'aria-label',
      window.YouTubeUtils?.t?.('speedControl') || 'Speed control'
    );
    speedBtn.setAttribute('aria-haspopup', 'true');
    speedBtn.setAttribute('aria-expanded', 'false');
    window.YouTubeUtils?.setSafeHTML?.(speedBtn, `<span>${getSpeed_()}x</span>`);

    /** @type {(() => void) | null} */
    let speedTrapCleanup = null;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let speedHideTimer;
    scope.onDispose(() => {
      clearTimeout_(speedHideTimer);
      speedTrapCleanup?.();
      endDropdownRelayout();
    });

    const hideDropdown = () => {
      endDropdownRelayout();
      speedOptions.classList.remove('visible');
      if (lastActiveSpeedAnchor) lastActiveSpeedAnchor.setAttribute('aria-expanded', 'false');
      speedBtn.setAttribute('aria-expanded', 'false');
      syncVisionSpeedBadgeAria_(false);
      speedTrapCleanup?.();
      speedTrapCleanup = null;
    };

    /** @param {HTMLElement|null} [anchorEl] */
    const showDropdown = (anchorEl = speedBtn) => {
      if (anchorEl) lastActiveSpeedAnchor = anchorEl;
      applySpeedDropdownPosition(lastActiveSpeedAnchor);
      speedOptions.classList.add('visible');
      beginDropdownRelayout();
      if (lastActiveSpeedAnchor) lastActiveSpeedAnchor.setAttribute('aria-expanded', 'true');
      speedBtn.setAttribute('aria-expanded', 'true');
      syncVisionSpeedBadgeAria_(true);
      // a11y: cycle keyboard focus inside the open speed menu (shared trap).
      speedTrapCleanup?.();
      speedTrapCleanup = window.YouTubePlusModalHandlers?.createFocusTrap?.(speedOptions) || null;
    };

    const toggleDropdown = () => {
      if (speedOptions.classList.contains('visible')) hideDropdown();
      else showDropdown(speedBtn);
    };

    const scheduleHide = () => {
      clearTimeout_(speedHideTimer);
      speedHideTimer = setTimeout_(hideDropdown, 200);
    };

    scope.listen(
      document,
      'click',
      (/** @type {Event} */ event) => {
        if (!speedOptions.classList.contains('visible')) return;
        const target = /** @type {Node | null} */ (event.target);
        if (speedBtn.contains(target) || speedOptions.contains(target)) return;
        hideDropdown();
      },
      { capture: true }
    );
    scope.listen(
      document,
      'keydown',
      /** @type {EventListener} */ (
        (/** @type {KeyboardEvent} */ event) => {
          if (event.key === 'Escape' && speedOptions.classList.contains('visible')) {
            hideDropdown();
            speedBtn.focus();
          }
        }
      ),
      { capture: true }
    );
    const hoverApi = window.YouTubePlusEventDelegation;
    if (hoverApi?.attachHoverPopover) {
      const dispose = hoverApi.attachHoverPopover(speedBtn, speedOptions, {
        show: () => showDropdown(speedBtn),
        hide: hideDropdown,
        hideDelay: 200,
        extraAnchors: [speedOptions],
      });
      if (dispose) scope.onDispose(dispose);
    } else {
      scope.listen(speedBtn, 'mouseenter', () => showDropdown(speedBtn));
      scope.listen(speedBtn, 'mouseleave', scheduleHide);
      scope.listen(speedOptions, 'mouseenter', () => clearTimeout_(speedHideTimer));
      scope.listen(speedOptions, 'mouseleave', scheduleHide);
    }

    scope.listen(
      speedBtn,
      'keydown',
      /** @type {EventListener} */ (
        (/** @type {KeyboardEvent} */ event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleDropdown();
          } else if (event.key === 'Escape') {
            hideDropdown();
          }
        }
      )
    );

    // Speed buttons recreated by YouTube's player (e.g. fullscreen) keep the
    // hover behaviour through these capture-phase document listeners.
    scope.listen(
      document,
      'mouseenter',
      (/** @type {Event} */ e) => {
        const target = /** @type {Element | null} */ (e.target);
        const btn = /** @type {HTMLElement | null | undefined} */ (
          target?.closest?.('.speed-control-btn')
        );
        if (btn) {
          clearTimeout_(speedHideTimer);
          showDropdown(btn);
        }
      },
      { capture: true }
    );
    scope.listen(
      document,
      'mouseleave',
      (/** @type {Event} */ e) => {
        const target = /** @type {Element | null} */ (e.target);
        if (target?.closest?.('.speed-control-btn')) scheduleHide();
      },
      { capture: true }
    );

    controls.insertBefore(speedBtn, controls.firstChild);
  }

  const SPEED_HOTKEY_DEFAULTS = Object.freeze({
    decrease: 'g',
    increase: 'h',
    reset: 'b',
  });
  /** @typedef {keyof typeof SPEED_HOTKEY_DEFAULTS} SpeedHotkeyName */

  /**
   * Clamp a single hotkey value to a single lowercase character.
   * @param {unknown} value
   * @param {string} fallback
   * @returns {string}
   */
  const normalizeSpeedHotkey_ = (value, fallback) => {
    const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return (
      candidate.slice(0, 1) ||
      String(fallback || '')
        .trim()
        .toLowerCase()
        .slice(0, 1) ||
      'g'
    );
  };

  /**
   * Read speed hotkeys from the settings store when no enhancer is
   * provided (self-registration path).
   * @returns {{ decrease: string, increase: string, reset: string }}
   */
  const readSpeedHotkeys_ = () => {
    try {
      const store = window.YouTubePlusSettingsStore;
      const raw = store?.get?.('speedControlHotkeys', {});
      const source =
        raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
      return {
        decrease: normalizeSpeedHotkey_(source.decrease, SPEED_HOTKEY_DEFAULTS.decrease),
        increase: normalizeSpeedHotkey_(source.increase, SPEED_HOTKEY_DEFAULTS.increase),
        reset: normalizeSpeedHotkey_(source.reset, SPEED_HOTKEY_DEFAULTS.reset),
      };
    } catch (e) {
      logS(e);
      logger?.warn?.('speedcontrol', 'Failed to read speed hotkeys', e);
      return { ...SPEED_HOTKEY_DEFAULTS };
    }
  };

  /**
   * True if the keyboard event target is an editable element; delegates to
   * `YouTubeUtils.isEditableTarget`.
   * @param {EventTarget | null | undefined} target
   * @returns {boolean}
   */
  const isEditableTarget_ = target => window.YouTubeUtils?.isEditableTarget?.(target) ?? false;

  /** @param {boolean} enabled */
  function refreshVisibility(enabled) {
    const btns = document.querySelectorAll('.speed-control-btn');
    btns.forEach(btn => {
      if (btn instanceof HTMLElement) {
        btn.style.setProperty('display', enabled ? '' : 'none', 'important');
      }
    });
    const options = document.querySelector('.speed-options');
    if (options instanceof HTMLElement) {
      options.style.setProperty('display', enabled ? '' : 'none', 'important');
      if (!enabled) {
        options.classList.remove('visible');
        endDropdownRelayout();
      }
    }
  }

  /**
   * @param {SpeedControlEnhancer | null | undefined} enhancer
   * @returns {{ decrease: string, increase: string, reset: string }}
   */
  const resolveEffectiveHotkeys = enhancer => {
    const configured = enhancer?.settings?.speedControlHotkeys;
    if (configured) {
      const names = /** @type {SpeedHotkeyName[]} */ (['decrease', 'increase', 'reset']);
      return /** @type {{ decrease: string, increase: string, reset: string }} */ (
        Object.fromEntries(
          names.map(name => [
            name,
            normalizeSpeedHotkey_(configured[name], SPEED_HOTKEY_DEFAULTS[name]),
          ])
        )
      );
    }
    return readSpeedHotkeys_();
  };

  /**
   * @param {KeyboardEvent} e
   * @param {SpeedControlEnhancer | null | undefined} enhancer
   */
  const handleSpeedKeyEvent = (e, enhancer) => {
    if (!e?.key || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    const isEditable =
      typeof enhancer?.isEditableTarget === 'function'
        ? enhancer.isEditableTarget(document.activeElement)
        : isEditableTarget_(document.activeElement);
    if (isEditable) return;

    const key = String(e.key).toLowerCase();
    const typedHotkeys = resolveEffectiveHotkeys(enhancer);
    const targetEnhancer = enhancer || createSpeedEnhancerFallback_();

    if (key === typedHotkeys.decrease) {
      e.preventDefault();
      adjustSpeedByStep(targetEnhancer, -1);
    } else if (key === typedHotkeys.increase) {
      e.preventDefault();
      adjustSpeedByStep(targetEnhancer, 1);
    } else if (key === typedHotkeys.reset) {
      e.preventDefault();
      changeSpeed(targetEnhancer, 1);
    }
  };

  /** @type {SpeedControlEnhancer | null} */
  let hotkeyEnhancer = null;

  /** (Re)attach the speed hotkeys for the current enhancer. */
  function attachHotkeys() {
    hotkeyScope = renewScope(hotkeyScope);
    if (!hotkeyScope) return;
    const enhancer = hotkeyEnhancer;
    hotkeyScope.listen(
      document,
      'keydown',
      /** @type {EventListener} */ (
        (/** @type {KeyboardEvent} */ e) => handleSpeedKeyEvent(e, enhancer)
      ),
      { capture: true }
    );
  }

  /**
   * Basic calls this once per enhancer; a new enhancer (SPA rebuild) replaces
   * the captured one.
   * @param {SpeedControlEnhancer | null} enhancer
   */
  function registerHotkeys(enhancer) {
    hotkeyEnhancer = enhancer;
    if (enhancer) lastEnhancer = enhancer;
    attachHotkeys();
  }

  /**
   * @param {boolean} expanded
   * @param {HTMLElement|null} [badgeEl]
   */
  function syncVisionSpeedBadgeAria_(expanded, badgeEl = null) {
    const badge =
      badgeEl || /** @type {HTMLElement|null} */ (document.querySelector('#yp-vision-speed-btn'));
    if (badge && typeof badge.setAttribute === 'function') {
      badge.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
  }

  /**
   * @param {HTMLElement} badge
   */
  function showVisionSpeedDropdown_(badge) {
    const opts =
      /** @type {HTMLElement|null} */ (document.querySelector('.speed-options')) ||
      (typeof ensureDropdown === 'function' ? ensureDropdown(null) : null);
    if (!opts) return;
    const dockEl = window.YouTubePlusZoom?.closestDock?.(badge);
    const bottomAnchor = dockEl
      ? dockEl.getBoundingClientRect().bottom
      : badge.getBoundingClientRect().bottom;
    const rect = badge.getBoundingClientRect();
    opts.style.left = `${rect.left + rect.width / 2}px`;
    opts.style.right = 'auto';
    opts.style.top = `${bottomAnchor + 10}px`;
    opts.style.bottom = 'auto';
    opts.classList.add('visible');
    beginDropdownRelayout();
    syncVisionSpeedBadgeAria_(true, badge);
  }

  /**
   * @param {HTMLElement} badge
   */
  function toggleVisionSpeedDropdown_(badge) {
    const opts =
      /** @type {HTMLElement|null} */ (document.querySelector('.speed-options')) ||
      (typeof ensureDropdown === 'function' ? ensureDropdown(null) : null);
    if (!opts) return;
    if (opts.classList.contains('visible')) {
      opts.classList.remove('visible');
      endDropdownRelayout();
      syncVisionSpeedBadgeAria_(false, badge);
    } else {
      showVisionSpeedDropdown_(badge);
    }
  }

  // FeatureRegistry descriptor for playback speed (shared by the Classic and Vision surfaces)
  const DESCRIPTOR = {
    id: 'speed',
    titleKey: 'speedControl',
    fallbackTitle: 'Speed control',
    settingsKey: 'enableSpeedControl',
    iconSVG: '',
    command(/** @type {unknown} */ shim) {
      const opts =
        /** @type {HTMLElement|null} */ (document.querySelector('.speed-options')) ||
        (typeof ensureDropdown === 'function'
          ? ensureDropdown(/** @type {SpeedControlEnhancer | null | undefined} */ (shim))
          : null);
      if (opts) {
        if (opts.classList.contains('visible')) {
          opts.classList.remove('visible');
          endDropdownRelayout();
          syncVisionSpeedBadgeAria_(false);
        } else {
          opts.classList.add('visible');
          beginDropdownRelayout();
          syncVisionSpeedBadgeAria_(true);
        }
        return true;
      }
      return false;
    },
    mountDock(/** @type {HTMLElement} */ player, /** @type {HTMLElement} */ dock) {
      void player;
      let badge = /** @type {HTMLButtonElement|null} */ (
        dock.querySelector('#yp-vision-speed-btn')
      );
      if (!badge) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.id = 'yp-vision-speed-btn';
        badge.className = 'yp-studio-speed-badge speed-control-btn vision-dock-btn yp-speed-button';
        badge.style.cssText =
          'font-size:12px;background:none;border:none;padding:0 4px;color:inherit;cursor:pointer;user-select:none;';
        const curSpeed = String(getSpeed_());
        badge.textContent = `${curSpeed}x`;
        const title = window.YouTubeUtils?.t?.('speedControl') || 'Speed control';
        badge.setAttribute('title', title);
        badge.setAttribute('aria-label', title);
        badge.setAttribute('tabindex', '0');
        badge.setAttribute('aria-haspopup', 'true');
        badge.setAttribute('aria-expanded', 'false');
        dock.appendChild(badge);
      }
      const badgeEl = badge;

      // stable per-badge closures, so re-mounts dedup to one live
      // registration per event and the dispose releases exactly these entries.
      let stable = badgeStableHandlers.get(badgeEl);
      if (!stable) {
        // the deferred-hide timer is owned by the per-badge stable record
        // (the closures below and every mount's disposer share it). It is
        // cancelled on dispose, before each re-arm and on every new opening,
        // so a stale mouseleave callback can never close a newer session's
        // popup and timers never stack.
        const hideState = {
          timer: /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined),
        };
        const cancelPendingHide = () => {
          if (hideState.timer !== undefined) {
            clearTimeout_(hideState.timer);
            hideState.timer = undefined;
          }
        };
        const showSpeed = () => {
          cancelPendingHide();
          showVisionSpeedDropdown_(badgeEl);
        };
        const hideSpeed = () => {
          cancelPendingHide();
          const opts = /** @type {HTMLElement|null} */ (document.querySelector('.speed-options'));
          if (opts) {
            hideState.timer = setTimeout_(() => {
              hideState.timer = undefined;
              if (!(opts.matches(':hover') || badgeEl.matches(':hover'))) {
                opts.classList.remove('visible');
                endDropdownRelayout();
                syncVisionSpeedBadgeAria_(false, badgeEl);
              }
            }, 250);
          }
        };
        stable = {
          enter: () => showSpeed(),
          leave: () => hideSpeed(),
          click: /** @type {(e: Event) => void} */ (
            e => {
              e.preventDefault();
              // Cancel a pending auto-hide on explicit open/close: before a
              // close it is a no-op, before an open it keeps the fresh popup up.
              cancelPendingHide();
              toggleVisionSpeedDropdown_(badgeEl);
            }
          ),
          keydown: /** @type {(e: Event) => void} */ (
            e => {
              if (
                e instanceof KeyboardEvent &&
                (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')
              ) {
                e.preventDefault();
                cancelPendingHide();
                toggleVisionSpeedDropdown_(badgeEl);
              }
            }
          ),
          cancelPendingHide,
        };
        badgeStableHandlers.set(badgeEl, stable);
      }
      const cm = window.YouTubePlusCleanupManager;
      const enterKey = cm?.registerListener?.(
        badgeEl,
        'mouseenter',
        stable.enter,
        undefined,
        false
      );
      const leaveKey = cm?.registerListener?.(
        badgeEl,
        'mouseleave',
        stable.leave,
        undefined,
        false
      );
      const clickKey = cm?.registerListener?.(badgeEl, 'click', stable.click, undefined, false);
      const keydownKey = cm?.registerListener?.(
        badgeEl,
        'keydown',
        stable.keydown,
        undefined,
        false
      );
      // Dispose is idempotent; the host calls it on remove/unmount/replace.
      return () => {
        if (enterKey) cm?.unregisterListener?.(enterKey);
        if (leaveKey) cm?.unregisterListener?.(leaveKey);
        if (clickKey) cm?.unregisterListener?.(clickKey);
        if (keydownKey) cm?.unregisterListener?.(keydownKey);
        // dispose cancels the pending hide timer owned by this badge.
        stable?.cancelPendingHide?.();
      };
    },
  };

  const STYLE_ID = 'yp-speedcontrol-styles';

  /** Rebuild the Classic button on the current player, if there is one. */
  const mountClassicButton = () => {
    if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') return;
    const controls = document.querySelector('.ytp-right-controls');
    if (controls) addButton(lastEnhancer, /** @type {HTMLElement} */ (controls));
  };

  /** Release the Classic speed button and its listeners. The shared dropdown
   *  stays, because the Vision badge opens the same panel. */
  const removeClassicButton = () => {
    classicScope?.dispose();
    classicScope = null;
  };

  const speedFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'speed',
    settingsKey: 'enableSpeedControl',
    // Hotkeys and the owned playback speed act on the Shorts video too; the
    // dock badge and classic button only render on the watch player.
    routes: ['watch', 'shorts'],
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      speedCtx = ctx;
      ctx.style(STYLE_ID, window.YouTubePlusDesignSystem?.getStyle?.(STYLE_ID) || '');
      attachHotkeys();
      if (lastEnhancer) {
        setupVideoObserver(lastEnhancer);
        applyCurrentSpeed(lastEnhancer);
      }
      // In the Vision variant the dock badge comes from VisionDockHost instead.
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() !== 'vision') mountClassicButton();
    },
    stop() {
      for (const scope of [classicScope, dropdownScope, videoScope, hotkeyScope]) scope?.dispose();
      classicScope = null;
      dropdownScope = null;
      videoScope = null;
      hotkeyScope = null;
      speedCtx = null;
    },
  });

  if (typeof window !== 'undefined') {
    window.YouTubePlusSpeedControl = /** @type {YouTubePlusSpeedControl} */ ({
      addButton,
      removeClassicButton,
      changeSpeed,
      applyCurrentSpeed,
      setupVideoObserver,
      showSpeedIndicator,
      adjustSpeedByStep,
      refreshVisibility,
      registerHotkeys,
      restore: restoreSpeed_,
      setSpeed: n => setSpeed_(n, false),
      DESCRIPTOR,
    });
  }

  window.YouTubePlusFeatureRegistry?.register?.(DESCRIPTOR);
  speedFeature?.sync();
})();
