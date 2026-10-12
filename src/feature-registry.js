/**
 * YouTube+ Feature Registry
 *
 * Single source of truth for feature descriptors shared by all UI
 * surfaces (Classic player controls, Vision dock). Each descriptor
 * defines one feature's icon, label, command, settings key, and
 * hotkey ONCE; hosts render it per-surface so wrappers stay thin.
 * @version 2.5.3
 */

(function () {
  const U = window.YouTubeUtils;
  // Single (error, label) signature; see download.js for rationale.
  const logS = /** @type {(err: unknown, label?: string) => void} */ (
    (/** @type {unknown} */ err, /** @type {string|undefined} */ label = undefined) =>
      U?.logSuppressed?.(err, label || 'FeatureRegistry')
  );

  if (window.YouTubePlusFeatureRegistry) return;

  /**
   * A registered lifecycle feature and its live host entry.
   * @typedef {{ def: YouTubePlusLifecycleFeature, ctx: YouTubePlusFeatureContext | null, armed: boolean, unsubscribe: (() => void) | null }} LifecycleEntry
   */

  /** @type {Map<string, YouTubePlusScreenshotFeatureDescriptor>} */
  const descriptors = new Map();

  function getStore() {
    return window.YouTubePlusSettingsStore;
  }

  /** Keys already reported as unknown, so a typo warns once per page. */
  const warnedUnknownKeys = new Set();

  function warnUnknownKey(/** @type {string} */ settingsKey, /** @type {string} */ descriptorId) {
    if (!settingsKey || warnedUnknownKeys.has(settingsKey)) return;
    warnedUnknownKeys.add(settingsKey);
    try {
      console.warn(
        `[YouTubePlusFeatureRegistry] unknown settings key "${settingsKey}" (descriptor: ${descriptorId}) — feature evaluates as disabled`
      );
    } catch (_e) {
      logS(_e);
    }
  }

  function isClassicTheme() {
    const dsVariant = window.YouTubePlusDesignSystem?.getThemeVariant?.();
    if (dsVariant) return dsVariant === 'classic';
    // Nested dot-path: themeVariant lives under styles, not at the top level.
    const storeVariant = getStore()?.get?.('styles.themeVariant');
    return storeVariant === 'classic';
  }

  const SettingsHost = {
    /**
     * Read a feature's enabled state by settings key. A key that is
     * not registered in the settings store is a typo and evaluates
     * as disabled, so a feature is never enabled by a misspelled key.
     * @param {string} settingsKey
     * @param {boolean} [fallback] used only when no store is loaded; defaults to false
     * @returns {boolean}
     */
    isEnabled(settingsKey, fallback = false) {
      try {
        const store = getStore();
        if (!store || typeof store.get !== 'function') return Boolean(fallback);
        if (typeof store.hasKey === 'function' && !store.hasKey(settingsKey)) {
          warnUnknownKey(settingsKey, 'isEnabled');
          return false;
        }
        return store.get(settingsKey) !== false;
      } catch (_e) {
        logS(_e);
        return Boolean(fallback);
      }
    },

    /**
     * Subscribe to a settings key or all settings changes. Returns an unsubscribe function.
     * @param {string | ((value: unknown) => void)} settingsKeyOrCallback
     * @param {((value: unknown) => void)} [callback]
     * @returns {() => void}
     */
    onChange(settingsKeyOrCallback, callback) {
      try {
        if (typeof settingsKeyOrCallback === 'function') {
          const cb = settingsKeyOrCallback;
          const store = getStore();
          if (store && typeof store.subscribe === 'function') {
            return store.subscribe('*', cb);
          }
          const handler = (/** @type {Event} */ e) =>
            cb(/** @type {CustomEvent} */ (e)?.detail || e);
          const sub = /** @type {{ dispose?: () => void } | null} */ (
            window.YouTubePlusCleanupManager?.registerListener?.(
              window,
              'youtube-plus-settings-updated',
              handler,
              undefined,
              false
            )
          );
          const cleanupFn = /** @type {(() => void) & { dispose?: () => void }} */ (
            sub?.dispose
              ? () => sub.dispose?.()
              : () => window.removeEventListener('youtube-plus-settings-updated', handler)
          );
          cleanupFn.dispose = cleanupFn;
          return cleanupFn;
        }
        if (typeof callback === 'function') {
          const unsub = /** @type {(() => void) & { dispose?: () => void }} */ (
            getStore()?.subscribe(settingsKeyOrCallback, callback) || (() => {})
          );
          if (typeof unsub === 'function' && !unsub.dispose) unsub.dispose = unsub;
          return unsub;
        }
        return () => {};
      } catch (_e) {
        logS(_e);
        return () => {};
      }
    },
  };

  const PlayerActionHost = {
    /**
     * Build the shared <button> for a descriptor on any surface.
     * Icon and title come from the descriptor, never redefined per surface.
     * @param {YouTubePlusScreenshotFeatureDescriptor} desc
     * @param {{ className?: string, id?: string, onClick?: (e: MouseEvent) => void }} [opts]
     * @returns {HTMLButtonElement}
     */
    createButton(desc, opts = {}) {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (opts.id) btn.id = opts.id;
      btn.className = opts.className || 'ytp-button';
      const rawTitle = U?.t?.(desc?.titleKey);
      const title =
        rawTitle && rawTitle !== 'undefined'
          ? rawTitle
          : desc?.fallbackTitle || desc?.titleKey || '';
      if (title) {
        btn.setAttribute('title', title);
        btn.setAttribute('aria-label', title);
      }
      if (desc?.iconSVG) {
        if (U?.setSafeHTML) {
          U.setSafeHTML(btn, desc.iconSVG);
        } else if (window.YouTubePlusSafeDOM?.setInnerHTML) {
          window.YouTubePlusSafeDOM.setInnerHTML(btn, desc.iconSVG);
        } else if (window.YouTubeSafeDOM?.setHTML) {
          window.YouTubeSafeDOM.setHTML(btn, desc.iconSVG);
        }
      }
      if (typeof opts.onClick === 'function')
        window.YouTubePlusCleanupManager?.registerListener?.(
          btn,
          'click',
          opts.onClick,
          undefined,
          false
        );
      return btn;
    },

    /**
     * Execute a descriptor's command with an enhancer shim.
     * @param {YouTubePlusScreenshotFeatureDescriptor} desc
     * @param {{ getElement?: Function, showNotification?: Function }} [shim]
     * @returns {boolean}
     */
    invokeCommand(desc, shim = {}) {
      if (!desc || typeof desc.command !== 'function') return false;
      try {
        return Boolean(desc.command(shim));
      } catch (err) {
        logS(err);
        U?.logError?.('PlayerActionHost', `Command failed for ${desc.id}`, err);
        return false;
      }
    },
  };

  const PopoverController = {
    /**
     * Show a toast through the NotificationManager.
     * @param {string} message
     * @param {{ duration?: number, type?: string }} [opts]
     */
    showToast(message, opts = {}) {
      if (!message) return;
      try {
        const nm = U?.NotificationManager;
        if (nm && typeof nm.show === 'function') {
          nm.show(message, {
            duration: opts.duration || 2000,
            type: opts.type || 'info',
          });
          return;
        }
      } catch (_e) {
        logS(_e);
      }
      try {
        window.YouTubePlusLogger?.warn?.(
          'FeatureRegistry',
          'NotificationManager unavailable',
          message
        );
      } catch (_e) {
        logS(_e);
      }
    },

    /**
     * Place a fixed-position dropdown under or above its anchor. A Vision dock
     * anchor sits at the top of the player, so it opens downward; a classic
     * bottom-bar anchor opens upward. Either side flips when the menu does not
     * fit, so it never overflows the player's clipped box.
     * @param {Element|null} anchorEl
     * @param {HTMLElement|null} dropdown
     * @param {{ preferDown?: boolean, gap?: number }} [options]
     * @returns {boolean} true when the menu opened downward
     */
    positionDropdown(anchorEl, dropdown, options = {}) {
      if (typeof window === 'undefined' || !(anchorEl instanceof Element)) return false;
      if (!(dropdown instanceof HTMLElement)) return false;
      const gap = typeof options.gap === 'number' ? options.gap : 8;
      const rect = anchorEl.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const height = dropdown.getBoundingClientRect().height || 0;
      const spaceAbove = rect.top - gap;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const fitsUp = height > 0 && spaceAbove >= height;
      const fitsDown = height > 0 && spaceBelow >= height;
      let openDown;
      if (height <= 0) {
        // Height unknown before first paint: trust the caller's preferred side.
        openDown = options.preferDown === true;
      } else if (fitsUp && fitsDown) {
        openDown = options.preferDown === true;
      } else if (fitsDown) {
        openDown = true;
      } else if (fitsUp) {
        openDown = false;
      } else {
        // Neither side fits the measured height: pick the roomier side.
        openDown = spaceBelow >= spaceAbove;
      }
      if (openDown) {
        dropdown.style.top = `${rect.bottom + gap}px`;
        dropdown.style.bottom = 'auto';
      } else {
        dropdown.style.bottom = `${window.innerHeight - rect.top + gap}px`;
        dropdown.style.top = 'auto';
      }
      return openDown;
    },
  };

  const DOCK_ORDER = ['download', 'speed', 'thumbnail', 'zoom', 'loop', 'screenshot', 'stats'];

  // The dock owns every click registration it creates. Each
  // rendered feature is an explicit resource: { btn, clickFn, cmKey }.
  // The clickFn is ONE stable closure per feature id, so re-registering the
  // same (btn, event, fn) triple after a cleanup sweep re-attaches through
  // the manager's identity dedup instead of stacking a new handler, and
  // removeFeatureButton/unmount release exactly what the host created.
  /** @type {Map<string, { btn: HTMLElement, clickFn: (e: Event) => void, cmKey: symbol | null }>} */
  const dockButtonResources = new Map();

  /**
   * Build the stable per-feature click handler. It resolves the CURRENT
   * dock's player at click time, so one closure stays valid across
   * remounts instead of capturing a stale player element.
   * @param {YouTubePlusScreenshotFeatureDescriptor} desc
   * @returns {(e: Event) => void}
   */
  function createStableClickFn(desc) {
    return /** @type {(e: Event) => void} */ (
      e => {
        e?.preventDefault?.();
        const dock = VisionDockHost.getDock();
        const dockPlayer = /** @type {HTMLElement|null} */ (
          dock?.parentElement instanceof HTMLElement ? dock.parentElement : null
        );
        PlayerActionHost.invokeCommand(desc, {
          getElement: (/** @type {string} */ sel) =>
            sel === 'video' ? dockPlayerVideo(dockPlayer) : null,
          showNotification: (/** @type {string} */ msg, /** @type {number|undefined} */ dur) =>
            PopoverController.showToast(msg, { duration: dur }),
        });
      }
    );
  }

  /**
   * @param {HTMLElement|null} player
   * @returns {Element|null}
   */
  function dockPlayerVideo(player) {
    return player?.querySelector('video') || null;
  }

  // Custom mountDock resources. Each custom mount returns an
  // idempotent dispose; the host owns it and releases the prior mount
  // before re-mounting, on removeFeatureButton and on unmount. Mounts
  // themselves re-attach listeners on every call through the manager's
  // (target, event, fn) dedup with stable closures, which is what restores
  // handlers after the per-navigation cleanup() sweep while keeping exactly
  // one live registration per event.
  /** @type {Map<string, () => void>} */
  const customMountResources = new Map();

  /**
   * Dispose and forget the tracked custom mount for one descriptor.
   * @param {string} id
   */
  function disposeCustomMount(id) {
    const dispose = customMountResources.get(id);
    if (!dispose) return;
    customMountResources.delete(id);
    try {
      dispose();
    } catch (e) {
      logS(e);
    }
  }

  /**
   * Track the dispose returned by a custom mount. Non-function returns are
   * ignored (the mount owns no host-visible resources).
   * @param {string} id
   * @param {unknown} dispose
   */
  function trackCustomMount(id, dispose) {
    if (typeof dispose === 'function') {
      customMountResources.set(id, /** @type {() => void} */ (dispose));
    }
  }

  /**
   * Release one tracked button resource: unregister its click registration
   * (if still tracked by the manager) and drop the tracking entry.
   * @param {string} id
   */
  function releaseButtonResource(id) {
    const res = dockButtonResources.get(id);
    if (!res) return;
    if (res.cmKey) {
      try {
        window.YouTubePlusCleanupManager?.unregisterListener?.(res.cmKey);
      } catch (_e) {
        logS(_e);
      }
    }
    dockButtonResources.delete(id);
  }

  const VisionDockHost = {
    /**
     * Get or resolve the player element.
     * @param {HTMLElement} [playerEl]
     * @returns {HTMLElement|null}
     */
    getPlayer(playerEl) {
      if (playerEl && playerEl instanceof HTMLElement) return playerEl;
      if (typeof document === 'undefined') return null;
      return /** @type {HTMLElement|null} */ (
        document.getElementById('movie_player') ||
          document.querySelector('#movie_player, .html5-video-player')
      );
    },

    /**
     * Return the Vision dock element if present on the page.
     * @returns {HTMLElement|null}
     */
    getDock() {
      if (typeof document === 'undefined') return null;
      return /** @type {HTMLElement|null} */ (document.querySelector('.vision-top-center-dock'));
    },

    /**
     * Mount or update the Vision dock on player.
     * In Classic variant, unmounts dock (active-surface-only mount).
     * @param {HTMLElement} [playerEl]
     * @param {{ wrap?: HTMLElement }} [ctx]
     * @returns {HTMLElement|null}
     */
    mount(playerEl, ctx) {
      if (typeof document === 'undefined') return null;
      if (isClassicTheme()) {
        this.unmount();
        return null;
      }
      const player = this.getPlayer(playerEl);
      if (!player || player.closest('ytd-miniplayer')) {
        return null;
      }

      let dock = /** @type {HTMLElement|null} */ (player.querySelector('.vision-top-center-dock'));
      if (!dock) {
        dock = document.createElement('div');
        dock.className = 'vision-top-center-dock';
        player.appendChild(dock);
      }

      const rendered = new Set();
      for (const id of DOCK_ORDER) {
        if (descriptors.has(id)) {
          this.renderFeature(id, player, dock, ctx);
          rendered.add(id);
        }
      }
      for (const id of descriptors.keys()) {
        if (!rendered.has(id)) {
          this.renderFeature(id, player, dock, ctx);
        }
      }

      return dock;
    },

    /**
     * Re-render every registered feature into the current dock. On the real
     * page mount() runs before a feature's FeatureLifecycle start, so its
     * buttons are missing until this re-render; it also drops a stopped
     * feature's button.
     */
    renderAll() {
      const dock = this.getDock();
      const player = dock?.parentElement;
      if (!(dock && player instanceof HTMLElement)) return;
      const rendered = new Set();
      for (const id of DOCK_ORDER) {
        if (descriptors.has(id)) {
          this.renderFeature(id, player, dock);
          rendered.add(id);
        }
      }
      for (const id of descriptors.keys()) {
        if (!rendered.has(id)) this.renderFeature(id, player, dock);
      }
    },

    /**
     * Render or update a specific feature inside the dock.
     * @param {string} id
     * @param {HTMLElement} player
     * @param {HTMLElement} dock
     * @param {{ wrap?: HTMLElement }} [ctx]
     */
    renderFeature(id, player, dock, ctx) {
      const desc = FeatureRegistry.get(id);
      if (!desc) return;

      const isEnabled = !desc.settingsKey || SettingsHost.isEnabled(desc.settingsKey);
      // `isAvailable` lets a feature hide its button where it cannot run
      // (another route, the miniplayer) while its setting stays on.
      if (!isEnabled || desc.isAvailable?.() === false) {
        this.removeFeatureButton(id, dock);
        return;
      }

      // Feature-owned custom dock mount (e.g. popovers for zoom, speed, etc.)
      if (typeof desc.mountDock === 'function') {
        // Host owns the custom-mount dispose. Release the prior mount
        // for this descriptor before re-mounting so replaced/detached buttons
        // never keep dead registrations; the fresh mount re-attaches its own
        // listeners (dedup keeps one per event), restoring handlers after a
        // cleanup() sweep on stable DOM.
        disposeCustomMount(id);
        trackCustomMount(id, desc.mountDock(player, dock, ctx));
        return;
      }

      // Standard generic renderer for descriptors without custom mountDock (e.g. screenshot)
      let btn = /** @type {HTMLElement|null} */ (
        dock.querySelector(`.yp-${id}-button`) || dock.querySelector(`#yp-vision-${id}-btn`)
      );
      // The click handler is one stable closure per feature id; see
      // createStableClickFn.
      let resource = dockButtonResources.get(id);
      if (resource && resource.btn !== btn) {
        // The DOM button was replaced (recycled/removed): release the stale
        // registration so no detached entry survives.
        releaseButtonResource(id);
        resource = undefined;
      }
      if (!resource) {
        resource = {
          btn: /** @type {HTMLElement} */ (btn),
          clickFn: createStableClickFn(desc),
          cmKey: null,
        };
      }
      if (!btn) {
        btn = PlayerActionHost.createButton(desc, {
          id: `yp-vision-${id}-btn`,
          className: `vision-dock-btn yp-${id}-button`,
        });
        dock.appendChild(btn);
      }
      // Always (re)attach our OWN registration: after a cleanup sweep the
      // entry is gone while the DOM button survived: the manager dedupes
      // by (target, event, fn), so re-attaching the stable closure either
      // restores the removed entry or keeps the single existing one.
      resource.btn = /** @type {HTMLElement} */ (btn);
      resource.cmKey = window.YouTubePlusCleanupManager?.registerListener?.(
        btn,
        'click',
        resource.clickFn,
        undefined,
        false
      );
      dockButtonResources.set(id, resource);
    },

    /**
     * Remove only one specific feature's button from the dock without tearing down other buttons.
     * @param {string} id
     * @param {HTMLElement} [dockEl]
     */
    removeFeatureButton(id, dockEl) {
      // release the host-owned click registration FIRST so the removed
      // button cannot leave a detached listener entry behind.
      releaseButtonResource(id);
      // Custom mounts are host-tracked; dispose them before removing the
      // element so their registrations never outlive the button.
      disposeCustomMount(id);
      const dock = dockEl || this.getDock();
      if (!dock) return;
      const btn =
        dock.querySelector(`.yp-${id}-button`) || dock.querySelector(`#yp-vision-${id}-btn`);
      if (btn) btn.remove();
    },

    /**
     * Keep the dock present. Safe to call from any player lifecycle event: it
     * re-inserts a dock that a player rebuild dropped. Visibility is the CSS
     * rules' job (`.ytp-autohide .vision-top-center-dock`).
     */
    ensureVisible() {
      if (typeof document === 'undefined') return;
      if (isClassicTheme()) {
        this.unmount();
        return;
      }
      const player = this.getPlayer();
      if (!player) return;
      const dock = /** @type {HTMLElement|null} */ (
        player.querySelector('.vision-top-center-dock')
      );
      if (!dock?.isConnected) {
        this.mount(player);
      }
      scheduleDockRender();
    },

    /**
     * Completely unmount the dock (e.g. switching to classic surface or leaving watch page).
     */
    unmount() {
      // release every registration this host created.
      for (const id of [...dockButtonResources.keys()]) {
        releaseButtonResource(id);
      }
      // custom mounts are host-owned as well.
      for (const id of [...customMountResources.keys()]) {
        disposeCustomMount(id);
      }
      const dock = this.getDock();
      if (dock) dock.remove();
    },
  };

  /** True while a coalesced dock re-render is queued for the next frame. */
  let dockRenderPending = false;

  /**
   * Coalesce dock re-renders to one per animation frame: a feature start/stop,
   * a registration and a lifecycle event may all fire in the same tick.
   */
  function scheduleDockRender() {
    if (dockRenderPending) return;
    // Only when a dock is mounted: a classic page owns no dock buttons, so a
    // queued frame there would only add a stray tracked resource.
    if (!VisionDockHost.getDock()) return;
    dockRenderPending = true;
    const cm = window.YouTubePlusCleanupManager;
    /** @type {number | null} */
    let frameId = null;
    const run = () => {
      dockRenderPending = false;
      if (frameId !== null) cm?.unregisterAnimationFrame?.(frameId);
      frameId = null;
      VisionDockHost.renderAll();
    };
    if (typeof window.requestAnimationFrame === 'function') {
      frameId = window.requestAnimationFrame(run); // lint:custom:ignore registered on the next line
      cm?.registerAnimationFrame?.(frameId, { scope: 'session' });
    } else {
      // Some test realms lack rAF; a zero-delay task still coalesces the tick.
      setTimeout(run, 0);
    }
  }

  // Feature lifecycle: a feature declares
  //   { id, settingsKey, start(ctx), stop?() }
  // and the host calls start when the setting turns on and stop when it turns
  // off. Everything the feature acquires through `ctx` is released by the host
  // after stop, so a feature cannot leave listeners, observers, timers, styles
  // or DOM nodes behind. After release every ctx method is a no-op, which keeps
  // late async callbacks from re-acquiring resources for a stopped feature.

  /**
   * @param {string} featureId
   * @returns {YouTubePlusFeatureContext}
   */
  function createFeatureContext(featureId) {
    /** @type {Set<() => void>} */
    const disposers = new Set();
    let active = true;
    const cm = () => window.YouTubePlusCleanupManager;

    /**
     * Wrap a release so it runs at most once and forgets itself when called
     * early, so a long-running feature does not accumulate spent entries.
     * @param {() => void} fn
     * @returns {() => void}
     */
    const track = fn => {
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        disposers.delete(release);
        try {
          fn();
        } catch (e) {
          logS(e, `Feature:${featureId}`);
        }
      };
      disposers.add(release);
      return release;
    };

    const ctx = {
      id: featureId,
      get active() {
        return active;
      },
      /**
       * Listener owned by the feature: survives the per-navigation sweep and
       * is removed when the feature stops. Returns an idempotent release.
       * @param {EventTarget} target
       * @param {string} type
       * @param {EventListener} fn
       * @param {AddEventListenerOptions | boolean} [opts]
       */
      listen(target, type, fn, opts) {
        if (!(active && target)) return () => {};
        const key = cm()?.registerListener?.(target, type, fn, opts, true);
        if (!key) return () => {};
        return track(() => cm()?.unregisterListener?.(key));
      },
      /**
       * Delegated handler through YouTubePlusEventDelegation.
       * @param {Document | Element} root
       * @param {string} type
       * @param {string} selector
       * @param {Function} handler
       * @param {AddEventListenerOptions} [opts]
       */
      delegate(root, type, selector, handler, opts) {
        if (!active) return () => {};
        const delegator = window.YouTubePlusEventDelegation;
        if (!delegator?.on) return () => {};
        const off = delegator.on(root, type, selector, handler, opts);
        return track(() => {
          if (typeof off === 'function') off();
        });
      },
      /**
       * Observer owned by the feature; disconnected when the feature stops.
       * @template {MutationObserver|IntersectionObserver|ResizeObserver} T
       * @param {T} observer
       * @returns {T}
       */
      observe(observer) {
        if (!active) {
          observer?.disconnect?.();
          return observer;
        }
        // Session scope: the per-navigation sweep must not cancel a resource the
        // running feature still needs. ctx.dispose() releases it instead.
        cm()?.registerObserver?.(observer, null, { scope: 'session' });
        track(() => {
          observer.disconnect();
          cm()?.unregisterObserver?.(observer);
        });
        return observer;
      },
      /**
       * @param {() => void} fn
       * @param {number} ms
       */
      timeout(fn, ms) {
        if (!active) return () => {};
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timerId;
        const release = track(() => clearTimeout(timerId));
        timerId = setTimeout(() => {
          release();
          fn();
        }, ms);
        return release;
      },
      /**
       * @param {() => void} fn
       * @param {number} ms
       */
      interval(fn, ms) {
        if (!active) return () => {};
        const id = setInterval(fn, ms); // lint:custom:ignore registered on the next line
        cm()?.registerInterval?.(id, { scope: 'session' });
        return track(() => {
          clearInterval(id);
          cm()?.unregisterInterval?.(id);
        });
      },
      /**
       * One animation frame; released early if the feature stops first.
       * @param {FrameRequestCallback} fn
       */
      frame(fn) {
        if (!(active && typeof requestAnimationFrame === 'function')) return () => {};
        /** @type {number | undefined} */
        let frameId;
        const release = track(() => {
          if (frameId === undefined) return;
          cancelAnimationFrame(frameId);
          cm()?.unregisterAnimationFrame?.(frameId);
        });
        const onFrame = (/** @type {number} */ ts) => {
          if (frameId !== undefined) cm()?.unregisterAnimationFrame?.(frameId);
          frameId = undefined;
          release();
          fn(ts);
        };
        frameId = requestAnimationFrame(onFrame); // lint:custom:ignore registered on the next line
        cm()?.registerAnimationFrame?.(frameId, { scope: 'session' });
        return release;
      },
      /**
       * CSS owned by the feature: added now, removed when the feature stops.
       * @param {string} styleId
       * @param {string} css
       */
      style(styleId, css) {
        const SM = window.YouTubePlusDesignSystem?.StyleManager || U?.StyleManager;
        if (!(active && css && typeof SM?.add === 'function')) return () => {};
        SM.add(styleId, css);
        return track(() => SM.remove?.(styleId));
      },
      /**
       * DOM node owned by the feature: removed when the feature stops.
       * @template {Element} E
       * @param {E} el
       * @returns {E}
       */
      own(el) {
        if (!el) return el;
        if (!active) {
          el.remove();
          return el;
        }
        track(() => {
          cm()?.disconnectForElement?.(el);
          el.remove();
        });
        return el;
      },
      /** @param {() => void} fn */
      onDispose(fn) {
        if (typeof fn !== 'function') return () => {};
        if (!active) {
          fn();
          return () => {};
        }
        return track(fn);
      },
      /**
       * Child context for a resource group that is rebuilt while the feature
       * runs (one button, one panel). Disposing it releases only that group;
       * stopping the feature releases it too.
       */
      scope() {
        const child = createFeatureContext(featureId);
        if (!active) {
          child.dispose();
          return child;
        }
        // Disposing the child directly also drops it from this context.
        child.onDispose(track(() => child.dispose()));
        return child;
      },
      /** Release everything in reverse order of acquisition. */
      dispose() {
        if (!active) return;
        active = false;
        for (const release of [...disposers].reverse()) release();
      },
    };
    return ctx;
  }

  /** @type {Map<string, LifecycleEntry>} */
  const lifecycleFeatures = new Map();

  /**
   * @param {string} id
   */
  function stopLifecycleFeature(id) {
    const entry = lifecycleFeatures.get(id);
    if (!entry?.ctx) return;
    const { ctx } = entry;
    entry.ctx = null;
    try {
      entry.def.stop?.();
    } catch (e) {
      logS(e, `Feature:${id}`);
    }
    ctx.dispose();
  }

  /**
   * Whether the current page is one the feature runs on.
   * @param {YouTubePlusLifecycleFeature} def
   * @returns {boolean}
   */
  function isOnFeaturePage(def) {
    if (def.routes?.length) {
      const route = U?.getRoute?.();
      if (!(route && def.routes.includes(route))) return false;
    }
    return !def.when || Boolean(def.when());
  }

  /** @type {symbol | null} */
  let navigationListenerKey = null;

  /** Re-check every armed, page-scoped feature after a URL change. */
  function syncPageScopedFeatures() {
    for (const [id, entry] of lifecycleFeatures) {
      if (entry.armed && (entry.def.routes?.length || entry.def.when)) syncLifecycleFeature(id);
    }
  }

  function ensureNavigationListener() {
    if (navigationListenerKey) return;
    navigationListenerKey =
      window.YouTubePlusCleanupManager?.registerListener?.(
        window,
        'yp-history-navigate',
        syncPageScopedFeatures,
        undefined,
        true
      ) || null;
  }

  /**
   * Start or stop one feature to match its setting and the current page.
   * @param {string} id
   */
  function syncLifecycleFeature(id) {
    const entry = lifecycleFeatures.get(id);
    if (!entry) return;
    entry.armed = true;
    if (entry.def.routes?.length || entry.def.when) ensureNavigationListener();
    const shouldRun =
      (!entry.def.settingsKey || SettingsHost.isEnabled(entry.def.settingsKey)) &&
      isOnFeaturePage(entry.def);
    if (shouldRun && !entry.ctx) {
      const ctx = createFeatureContext(id);
      entry.ctx = ctx;
      try {
        entry.def.start(ctx);
      } catch (e) {
        logS(e, `Feature:${id}`);
        stopLifecycleFeature(id);
      }
    } else if (!shouldRun && entry.ctx) {
      stopLifecycleFeature(id);
    }
    scheduleDockRender();
  }

  const FeatureLifecycle = {
    /**
     * Declare a feature with a start/stop lifecycle. Nothing runs until the
     * owning module calls `sync()` on the returned handle (usually from its
     * init, once the DOM is ready); after that the host follows the setting
     * and, when `routes` or `when` is given, the page: the feature starts on a
     * listed page and stops (releasing its context) when navigation leaves it.
     * Call `sync()` again when a `when` condition changes without navigation.
     * @param {YouTubePlusLifecycleFeature} def
     * @returns {{ sync: () => void, isRunning: () => boolean, restart: () => void } | null}
     */
    define(def) {
      if (!def || typeof def.id !== 'string' || typeof def.start !== 'function') return null;
      if (lifecycleFeatures.has(def.id)) return null;
      /** @type {LifecycleEntry} */
      const entry = { def, ctx: null, armed: false, unsubscribe: null };
      lifecycleFeatures.set(def.id, entry);
      if (def.settingsKey) {
        entry.unsubscribe = SettingsHost.onChange(def.settingsKey, () => {
          if (entry.armed) syncLifecycleFeature(def.id);
        });
      }
      return {
        sync: () => syncLifecycleFeature(def.id),
        isRunning: () => Boolean(entry.ctx),
        restart: () => {
          stopLifecycleFeature(def.id);
          syncLifecycleFeature(def.id);
        },
      };
    },
    /** @param {string} id */
    isRunning(id) {
      return Boolean(lifecycleFeatures.get(id)?.ctx);
    },
    /** @returns {string[]} */
    list() {
      return [...lifecycleFeatures.keys()];
    },
    /** Stop every feature and forget all definitions (test isolation). */
    _reset() {
      for (const id of [...lifecycleFeatures.keys()]) {
        stopLifecycleFeature(id);
        lifecycleFeatures.get(id)?.unsubscribe?.();
      }
      lifecycleFeatures.clear();
      if (navigationListenerKey) {
        window.YouTubePlusCleanupManager?.unregisterListener?.(navigationListenerKey);
        navigationListenerKey = null;
      }
    },
    createContext: createFeatureContext,
  };

  const FeatureRegistry = {
    SettingsHost,
    FeatureLifecycle,
    PlayerActionHost,
    PopoverController,
    VisionDockHost,
    /**
     * @param {YouTubePlusScreenshotFeatureDescriptor} descriptor
     * @returns {boolean} false if a descriptor with the same id exists.
     */
    register(/** @type {YouTubePlusScreenshotFeatureDescriptor} */ descriptor) {
      if (!descriptor || typeof descriptor.id !== 'string' || !descriptor.id) return false;
      if (descriptors.has(descriptor.id)) return false;
      // Surface typos at registration time instead of at render time.
      if (descriptor.settingsKey) {
        const store = getStore();
        if (store && typeof store.hasKey === 'function' && !store.hasKey(descriptor.settingsKey)) {
          warnUnknownKey(descriptor.settingsKey, descriptor.id);
          return false;
        }
      }
      descriptors.set(descriptor.id, descriptor);
      if (VisionDockHost.getDock()) scheduleDockRender();
      return true;
    },
    /** @returns {YouTubePlusScreenshotFeatureDescriptor | null} */
    get(/** @type {string} */ id) {
      return descriptors.get(id) || null;
    },
    /** @returns {boolean} */
    has(/** @type {string} */ id) {
      return descriptors.has(id);
    },
    /** @returns {YouTubePlusScreenshotFeatureDescriptor[]} */
    list() {
      return [...descriptors.values()];
    },
    /** @returns {YouTubePlusScreenshotFeatureDescriptor[]} */
    getAll() {
      return [...descriptors.values()];
    },
    /** Clear registry state (primarily for isolated testing). */
    _reset() {
      descriptors.clear();
      warnedUnknownKeys.clear();
      // also release any dock button registrations this module owns.
      for (const id of [...dockButtonResources.keys()]) {
        releaseButtonResource(id);
      }
      // Custom mounts are host-owned too: release them exactly like
      // the generic renderer's buttons so test isolation cannot leak their
      // registrations across suites.
      for (const id of [...customMountResources.keys()]) {
        disposeCustomMount(id);
      }
    },
  };

  if (typeof window !== 'undefined') {
    if (window._ytpVisionDockHostSettingsKey) {
      try {
        window.YouTubePlusCleanupManager?.unregisterListener?.(
          window._ytpVisionDockHostSettingsKey
        );
      } catch (_e) {
        logS(_e);
      }
    }
    try {
      window._ytpVisionDockHostSettingsKey = window.YouTubePlusCleanupManager?.registerListener?.(
        window,
        'youtube-plus-settings-updated',
        () => {
          if (isClassicTheme()) {
            VisionDockHost.unmount();
            return;
          }
          const player = VisionDockHost.getPlayer();
          const dock = VisionDockHost.getDock();
          if (!(player && dock)) return;
          for (const id of descriptors.keys()) {
            VisionDockHost.renderFeature(id, player, dock);
          }
        },
        undefined,
        true
      );
    } catch (_e) {
      logS(_e);
    }

    // The player is rebuilt on load and SPA transitions, dropping the dock.
    // Re-insert it on the player lifecycle events instead of polling a timer.
    const onPlayerLifecycle = () => VisionDockHost.ensureVisible();
    for (const eventName of ['yt-player-updated', 'yt-navigate-finish']) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        eventName,
        onPlayerLifecycle,
        undefined,
        'session'
      );
    }
    window.YouTubePlusCleanupManager?.registerListener?.(
      document,
      'loadedmetadata',
      onPlayerLifecycle,
      true,
      'session'
    );
  }

  window.YouTubePlusFeatureRegistry = /** @type {YouTubePlusFeatureRegistry} */ (FeatureRegistry);
  window.YouTubePlusSettingsHost = SettingsHost;
  window.YouTubePlusPlayerActionHost = /** @type {YouTubePlusPlayerActionHost} */ (
    PlayerActionHost
  );
  window.YouTubePlusPopoverController = PopoverController;
  window.YouTubePlusVisionDockHost = VisionDockHost;
})();
