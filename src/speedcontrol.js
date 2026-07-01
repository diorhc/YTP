// Speed Control — canonical playback speed selector.
//
// Responsibility: dropdown speed selector UI for the YouTube player,
//   keyboard shortcut bindings, and per-video speed persistence.
// Public surface: none (self-contained IIFE, no LazyLoader registration).
(function () {
  const logger = window.YouTubeUtils?.logger || window.YouTubePlusLogger || null;
  const setTimeout_ = setTimeout;
  const STYLE_ID = 'ytp-speedcontrol-styles';

  const injectStyles = () => {
    try {
      const StyleManager = window.YouTubeUtils?.StyleManager;
      if (!StyleManager || typeof StyleManager.add !== 'function') return;
      const css = window.YouTubePlusDesignSystem?.getStyle?.(STYLE_ID) || '';
      StyleManager.add(STYLE_ID, css);
    } catch (e) {
      logger?.warn?.('speedcontrol', 'Failed to inject styles', e);
    }
  };

  const ensureIndicator = () => {
    let indicator = document.getElementById('speed-indicator');
    if (indicator) return indicator;
    indicator = document.createElement('div');
    indicator.id = 'speed-indicator';
    const player = document.getElementById('movie_player');
    if (player) player.appendChild(indicator);
    return indicator;
  };

  /**
   * @param {any} enhancer
   * @param {number} speed
   */
  function showSpeedIndicator(enhancer, speed) {
    injectStyles();
    const indicator = /** @type {any} */ (ensureIndicator());
    if (!indicator) return;

    if (enhancer.speedControl.activeAnimationId) {
      cancelAnimationFrame(/** @type {any} */ (enhancer.speedControl).activeAnimationId);
      window.YouTubeUtils?.cleanupManager?.unregisterAnimationFrame?.(
        /** @type {any} */ (enhancer.speedControl).activeAnimationId
      );
      /** @type {any} */ (enhancer.speedControl).activeAnimationId = null;
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
        /** @type {any} */ (enhancer.speedControl).activeAnimationId =
          window.YouTubeUtils?.cleanupManager?.registerAnimationFrame?.(
            requestAnimationFrame(fadeOut)
          ) || requestAnimationFrame(fadeOut);
      } else {
        indicator.style.display = 'none';
        /** @type {any} */ (enhancer.speedControl).activeAnimationId = null;
      }
    };

    /** @type {any} */ (enhancer.speedControl).activeAnimationId =
      window.YouTubeUtils?.cleanupManager?.registerAnimationFrame?.(
        requestAnimationFrame(fadeOut)
      ) || requestAnimationFrame(fadeOut);
  }

  /** @param {any} enhancer */
  function applyCurrentSpeed(enhancer) {
    const videos =
      window.YouTubePlusDOMCache && typeof window.YouTubePlusDOMCache.getAll === 'function'
        ? window.YouTubePlusDOMCache.getAll('video')
        : document.querySelectorAll('video');

    videos.forEach((/** @type {HTMLVideoElement} */ video) => {
      if (video && video.playbackRate !== enhancer.speedControl.currentSpeed) {
        video.playbackRate = enhancer.speedControl.currentSpeed;
      }
    });
  }

  /**
   * @param {any} enhancer
   * @param {number|string} speed
   */
  function changeSpeed(enhancer, speed) {
    const numericSpeed = Number(speed);
    enhancer.speedControl.currentSpeed = numericSpeed;
    localStorage.setItem(enhancer.speedControl.storageKey, String(numericSpeed));

    const speedBtn = enhancer.getElement('.speed-control-btn span', false);
    if (speedBtn) speedBtn.textContent = `${numericSpeed}x`;

    document.querySelectorAll('.speed-option-item').forEach(option => {
      option.classList.toggle(
        'speed-option-active',
        parseFloat(/** @type {any} */ (option).dataset?.speed || '0') === numericSpeed
      );
    });

    applyCurrentSpeed(enhancer);
    showSpeedIndicator(enhancer, numericSpeed);
  }

  /**
   * @param {any} enhancer
   * @param {number} direction
   */
  function adjustSpeedByStep(enhancer, direction) {
    const speeds = enhancer.speedControl.availableSpeeds;
    if (!(Array.isArray(speeds) && speeds.length)) return;
    const current = Number(enhancer.speedControl.currentSpeed);

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

  /** @param {any} enhancer */
  function setupVideoObserver(enhancer) {
    if (/** @type {any} */ (enhancer)._speedInterval) {
      clearInterval(/** @type {any} */ (enhancer)._speedInterval);
    }
    /** @type {any} */ (enhancer)._speedInterval = null;

    if (!(/** @type {any} */ (enhancer)._mouseHoldTracked)) {
      /** @type {any} */ (enhancer)._mouseHoldTracked = true;
      /** @type {any} */ (enhancer)._mouseButtonHeld = false;
      window.YouTubeUtils?.cleanupManager?.registerListener?.(
        document,
        'mousedown',
        (/** @type {any} */ e) => {
          if (e.button === 0) /** @type {any} */ (enhancer)._mouseButtonHeld = true;
        },
        { passive: true, capture: true }
      );
      window.YouTubeUtils?.cleanupManager?.registerListener?.(
        document,
        'mouseup',
        (/** @type {any} */ e) => {
          if (e.button === 0) /** @type {any} */ (enhancer)._mouseButtonHeld = false;
        },
        { passive: true, capture: true }
      );
    }

    const applySpeed = () => applyCurrentSpeed(enhancer);
    const updateLoopBar = () => enhancer.updateLoopProgressBar?.();
    const applyLoop = () => enhancer.applyLoopStateToCurrentVideo?.();

    const attachSpeedListeners = (/** @type {any} */ video) => {
      if (video._ytpSpeedListenerAttached) return;
      video._ytpSpeedListenerAttached = true;
      video.addEventListener('loadedmetadata', applySpeed);
      video.addEventListener('loadedmetadata', updateLoopBar);
      video.addEventListener('loadedmetadata', applyLoop);
      video.addEventListener('playing', applySpeed);
      let settingRate = false;
      video.addEventListener('ratechange', () => {
        if (settingRate) return;
        if (
          /** @type {any} */ (enhancer)._mouseButtonHeld &&
          video.playbackRate > enhancer.speedControl.currentSpeed
        ) {
          return;
        }
        if (video.playbackRate !== enhancer.speedControl.currentSpeed) {
          settingRate = true;
          video.playbackRate = enhancer.speedControl.currentSpeed;
          settingRate = false;
        }
      });
      applySpeed();
    };

    const mainPlayer =
      document.querySelector('#movie_player') || document.querySelector('ytd-player');
    if (mainPlayer) {
      mainPlayer.querySelectorAll('video').forEach(attachSpeedListeners);
    } else {
      document.querySelectorAll('video').forEach(attachSpeedListeners);
    }

    const coordinator = window.YouTubePlusMutationCoordinator;
    const videoObserverId = 'speedcontrol::videoElements';
    /** @param {MutationRecord[]} mutations */
    const onVideoMutations = mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeName === 'VIDEO') attachSpeedListeners(node);
          if (node instanceof Element) {
            node.querySelectorAll?.('video').forEach(attachSpeedListeners);
          }
        }
      }
    };

    const playerRoot =
      document.querySelector('#movie_player') ||
      document.querySelector('ytd-player') ||
      document.body;

    if (playerRoot && coordinator?.watchTarget) {
      coordinator.watchTarget(videoObserverId, playerRoot, onVideoMutations, {
        childList: true,
        attributes: false,
        subtree: true,
      });
      window.YouTubeUtils?.cleanupManager?.register?.(() => {
        coordinator.unwatch(videoObserverId);
      });
    }
  }

  /**
   * @param {any} enhancer
   * @param {HTMLElement} controls
   */
  function addButton(enhancer, controls) {
    if (!enhancer.settings.enableSpeedControl) return;
    injectStyles();
    ensureIndicator();

    const speedBtn = document.createElement('button');
    speedBtn.type = 'button';
    speedBtn.className = 'ytp-button speed-control-btn';
    speedBtn.setAttribute(
      'aria-label',
      window.YouTubeUtils?.t?.('speedControl') || 'Speed control'
    );
    speedBtn.setAttribute('aria-haspopup', 'true');
    speedBtn.setAttribute('aria-expanded', 'false');
    window.YouTubeUtils?.setSafeHTML?.(
      speedBtn,
      `<span>${enhancer.speedControl.currentSpeed}x</span>`
    );

    const speedOptions = document.createElement('div');
    speedOptions.className = 'speed-options';
    speedOptions.setAttribute('role', 'menu');

    const selectSpeed = (/** @type {number} */ speed) => {
      changeSpeed(enhancer, speed);
      hideDropdown();
    };

    enhancer.speedControl.availableSpeeds.forEach((/** @type {number} */ speed) => {
      const option = document.createElement('div');
      option.className = `speed-option-item${Number(speed) === enhancer.speedControl.currentSpeed ? ' speed-option-active' : ''}`;
      option.textContent = `${speed}x`;
      /** @type {any} */ (option).dataset.speed = String(speed);
      option.setAttribute('role', 'menuitem');
      option.tabIndex = 0;
      option.addEventListener('click', () => selectSpeed(speed));
      option.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectSpeed(speed);
        }
      });
      speedOptions.appendChild(option);
    });

    const existingSpeed = document.querySelector('.speed-options');
    if (existingSpeed) existingSpeed.remove();

    try {
      document.body.appendChild(speedOptions);
    } catch (_e) {
      speedBtn.appendChild(speedOptions);
    }

    const positionDropdown = () => {
      const rect = speedBtn.getBoundingClientRect();
      /** @type {any} */ (speedOptions).style.left = `${rect.left + rect.width / 2}px`;
      /** @type {any} */ (speedOptions).style.bottom = `${window.innerHeight - rect.top + 8}px`;
    };

    const hideDropdown = () => {
      speedOptions.classList.remove('visible');
      speedBtn.setAttribute('aria-expanded', 'false');
    };

    const showDropdown = () => {
      positionDropdown();
      speedOptions.classList.add('visible');
      speedBtn.setAttribute('aria-expanded', 'true');
    };

    const toggleDropdown = () => {
      if (speedOptions.classList.contains('visible')) hideDropdown();
      else showDropdown();
    };

    /** @type {symbol | null | undefined} */
    let documentClickKey;

    const documentClickHandler = (/** @type {any} */ event) => {
      if (!speedBtn.isConnected) {
        if (documentClickKey) {
          window.YouTubeUtils?.cleanupManager?.unregisterListener?.(documentClickKey);
          documentClickKey = undefined;
        }
        return;
      }
      if (!speedOptions.classList.contains('visible')) return;
      if (
        speedBtn.contains(/** @type {Node} */ (event.target)) ||
        speedOptions.contains(/** @type {Node} */ (event.target))
      ) {
        return;
      }
      hideDropdown();
    };

    const documentKeydownHandler = (/** @type {any} */ event) => {
      if (event.key === 'Escape' && speedOptions.classList.contains('visible')) {
        hideDropdown();
        speedBtn.focus();
      }
    };

    documentClickKey = window.YouTubeUtils?.cleanupManager?.registerListener?.(
      document,
      'click',
      documentClickHandler,
      true
    );

    window.YouTubeUtils?.cleanupManager?.registerListener?.(
      document,
      'keydown',
      documentKeydownHandler,
      true
    );

    window.YouTubeUtils?.cleanupManager?.registerListener?.(window, 'resize', () => {
      if (speedOptions.classList.contains('visible')) positionDropdown();
    });

    window.YouTubeUtils?.cleanupManager?.registerListener?.(
      window,
      'scroll',
      () => {
        if (speedOptions.classList.contains('visible')) positionDropdown();
      },
      true
    );

    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let speedHideTimer;
    speedBtn.addEventListener('mouseenter', () => {
      clearTimeout(speedHideTimer);
      showDropdown();
    });
    speedBtn.addEventListener('mouseleave', () => {
      clearTimeout(speedHideTimer);
      speedHideTimer = setTimeout_(hideDropdown, 200);
    });
    speedOptions.addEventListener('mouseenter', () => {
      clearTimeout(speedHideTimer);
      showDropdown();
    });
    speedOptions.addEventListener('mouseleave', () => {
      clearTimeout(speedHideTimer);
      speedHideTimer = setTimeout_(hideDropdown, 200);
    });

    speedBtn.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleDropdown();
      } else if (event.key === 'Escape') {
        hideDropdown();
      }
    });

    controls.insertBefore(speedBtn, controls.firstChild);
  }

  /** @param {boolean} enabled */
  function refreshVisibility(enabled) {
    const btn = document.querySelector('.speed-control-btn');
    if (btn && /** @type {any} */ (btn).style) {
      /** @type {any} */ (btn).style.setProperty('display', enabled ? '' : 'none', 'important');
    }
    const options = document.querySelector('.speed-options');
    if (options && /** @type {any} */ (options).style) {
      /** @type {any} */ (options).style.setProperty('display', enabled ? '' : 'none', 'important');
      if (!enabled) options.classList.remove('visible');
    }
  }

  /** @param {any} enhancer */
  function registerHotkeys(enhancer) {
    try {
      window.YouTubeUtils?.cleanupManager?.registerListener?.(
        document,
        'keydown',
        (/** @type {any} */ e) => {
          if (!(enhancer.settings.enableSpeedControl && e?.key)) return;
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          if (enhancer.isEditableTarget(document.activeElement)) return;

          const key = String(e.key).toLowerCase();
          const decreaseKey = enhancer.normalizeSpeedHotkey(
            enhancer.settings.speedControlHotkeys?.decrease,
            'g'
          );
          const increaseKey = enhancer.normalizeSpeedHotkey(
            enhancer.settings.speedControlHotkeys?.increase,
            'h'
          );
          const resetKey = enhancer.normalizeSpeedHotkey(
            enhancer.settings.speedControlHotkeys?.reset,
            'b'
          );

          if (key === decreaseKey) {
            e.preventDefault();
            adjustSpeedByStep(enhancer, -1);
          } else if (key === increaseKey) {
            e.preventDefault();
            adjustSpeedByStep(enhancer, 1);
          } else if (key === resetKey) {
            e.preventDefault();
            changeSpeed(enhancer, 1);
          }
        },
        true
      );
    } catch (e) {
      window.YouTubeUtils?.logError?.('SpeedControl', 'Failed to register speed hotkeys', e);
    }
  }

  if (typeof window !== 'undefined') {
    window.YouTubePlusSpeedControl = {
      addButton,
      changeSpeed,
      applyCurrentSpeed,
      setupVideoObserver,
      showSpeedIndicator,
      adjustSpeedByStep,
      refreshVisibility,
      registerHotkeys,
      injectStyles,
    };
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusSpeedControl = window.YouTubePlusSpeedControl;
    }
  }

  logger?.debug?.('speedcontrol', 'Speed control module loaded');
})();
