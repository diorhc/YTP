/**
 * Centralized resource lifecycle manager for YouTube+.
 *
 * Tracks observers, listeners, intervals, timeouts, animation frames,
 * and custom callbacks so they can be bulk-cleaned on SPA navigation.
 *
 * Usage:
 *   const cm = window.YouTubePlusCleanupManager;
 *   cm.registerObserver(mutationObserver);
 *   cm.registerListener(el, 'click', handler);
 *   cm.cleanup(); // disconnect/dispose everything
 */
(function () {
  /**
   * Routes error details through YouTubePlusErrorBoundary for structured
   * persistence (memory + storage) instead of plain console logging.
   * @param {string} module
   * @param {string} message
   * @param {unknown} error
   */
  const logError = (module, message, error) => {
    try {
      const errorObj = error instanceof Error ? error : new Error(message);
      if (window.YouTubePlusErrorBoundary?.logError) {
        window.YouTubePlusErrorBoundary.logError(errorObj, { module, message });
      } else if (window.YouTubeUtils?.logError) {
        window.YouTubeUtils.logError(module, message, error);
      }
    } catch {}
  };

  /**
   * A tracked listener registration.
   * @typedef {{ target: EventTarget, ev: string, fn: EventListener, actualFn: EventListener, capture: boolean, opts: ListenerOpts | boolean, persistent?: boolean, abortListener?: (() => void) | null }} ListenerEntry
   */
  /**
   * Listener registration options, including the coordinator extensions
   * (`owner` scopes the listener to an element, `scope`/`persistent` mark it
   * session-scoped).
   * @typedef {AddEventListenerOptions & { owner?: Element | null, scope?: string, persistent?: boolean }} ListenerOpts
   */

  /**
   * Clear all tracked ids in a set via disposeFn, swallowing individual failures.
   * @template T
   * @param {Set<T>} set
   * @param {(id: T) => void} disposeFn
   * @param {string} label - for error logging context
   */
  function flushSet(set, disposeFn, label) {
    const ids = Array.from(set);
    set.clear();
    for (const id of ids) {
      try {
        disposeFn(id);
      } catch (e) {
        logError('cleanupManager', `${label} cleanup failed`, e);
      }
    }
  }

  const cleanupManager = (function () {
    /** @type {Set<MutationObserver | IntersectionObserver | ResizeObserver>} */
    const observers = new Set();
    // Session-scoped resources live for the whole page lifetime (e.g. the
    // design-system style self-healing observers, dom-cache TTL sweep) and
    // must survive the per-SPA-navigation cleanup().
    /** @type {Set<MutationObserver | IntersectionObserver | ResizeObserver>} */
    const sessionObservers = new Set();
    const listeners = new Map();
    const listenerStats = { registeredTotal: 0 };
    const intervals = new Set();
    const timeouts = new Set();
    const animationFrames = new Set();
    // Session-scoped timers: boot-time polling loops (update checker,
    // visibility-aware intervals) must survive per-navigation cleanup().
    const sessionIntervals = new Set();
    const sessionTimeouts = new Set();
    const sessionAnimationFrames = new Set();
    const callbacks = new Set();
    const sessionCallbacks = new Set();
    const elementObservers = new WeakMap();
    const elementListeners = new WeakMap();
    const navigateStartHooks = new Set();
    const navigateFinishHooks = new Set();

    /**
     * @param {Set<() => void>} hooks
     * @param {string} phase
     */
    const runHooks = (hooks, phase) => {
      for (const hook of hooks) {
        try {
          hook();
        } catch (e) {
          logError('cleanupManager', `${phase} hook failed`, e);
        }
      }
    };

    /**
     * Associate a listener key with a target element for scoped teardown.
     * @param {object | null} target
     * @param {symbol} key
     */
    const trackElementListener = (target, key) => {
      if (!target || typeof target !== 'object') return;
      try {
        let set = elementListeners.get(target);
        if (!set) {
          set = new Set();
          elementListeners.set(target, set);
        }
        set.add(key);
      } catch (_e) {
        logError('cleanupManager', 'trackElementListener failed', _e);
      }
    };

    /**
     * Remove a listener key from target element tracking.
     * @param {object | null} target
     * @param {symbol} key
     */
    const untrackElementListener = (target, key) => {
      if (!target || typeof target !== 'object') return;
      try {
        const set = elementListeners.get(target);
        if (!set) return;
        set.delete(key);
        if (set.size === 0) {
          elementListeners.delete(target);
        }
      } catch (_e) {
        logError('cleanupManager', 'untrackElementListener failed', _e);
      }
    };

    /**
     * @param {ListenerEntry | undefined} entry
     * @param {string} ev
     * @param {EventListener} fn
     * @param {boolean} capture
     * @returns {boolean}
     */
    const matchesListener = (entry, ev, fn, capture) =>
      Boolean(entry && entry.ev === ev && entry.fn === fn && entry.capture === capture);

    /**
     * @param {Iterable<symbol>} keys
     * @param {string} ev
     * @param {EventListener} fn
     * @param {boolean} capture
     * @returns {{ key: symbol, entry: ListenerEntry } | null}
     */
    const findInKeys = (keys, ev, fn, capture) => {
      for (const k of keys) {
        const entry = listeners.get(k);
        if (matchesListener(entry, ev, fn, capture)) return { key: k, entry };
      }
      return null;
    };

    /**
     * Find an existing listener registration for deduplication.
     * @param {object | null} target
     * @param {string} ev
     * @param {EventListener} fn
     * @param {boolean} capture
     * @returns {{ key: symbol, entry: ListenerEntry } | null}
     */
    const findExistingListener = (target, ev, fn, capture) => {
      const targetKeys = target && typeof target === 'object' ? elementListeners.get(target) : null;
      if (targetKeys) return findInKeys(targetKeys, ev, fn, capture);
      for (const [k, entry] of listeners.entries()) {
        if (entry.target === target && matchesListener(entry, ev, fn, capture)) {
          return { key: k, entry };
        }
      }
      return null;
    };

    /**
     * `opts.owner`: the element whose lifetime a listener follows when its
     * target is a shared node (document, window). Releasing the owner's
     * subtree releases the listener too.
     * @param {ListenerOpts | boolean | null} [opts]
     * @returns {Element | null}
     */
    const ownerOf = opts => (opts && typeof opts === 'object' ? opts.owner || null : null);

    /**
     * @param {boolean | 'session'} persistent
     * @param {ListenerOpts | boolean | null} [opts]
     * @returns {boolean}
     */
    const isPersistentScope = (persistent, opts) =>
      persistent === true ||
      persistent === 'session' ||
      (typeof opts === 'object' &&
        opts !== null &&
        (opts.scope === 'session' || opts.persistent === true));

    /**
     * @param {EventListener} fn
     * @param {symbol} key
     * @param {ListenerOpts | boolean | null} [opts]
     * @returns {EventListener}
     */
    const createListenerWrapper = (fn, key, opts) => {
      if (!opts || typeof opts !== 'object' || !opts.once) return fn;
      /**
       * @this {unknown}
       * @param {[Event]} args
       */
      function wrapper(...args) {
        // Release the registration identity before the user callback runs. If
        // the callback re-registers the same fn with {once:true}, the dedupe must
        // not find the stale entry being removed: the re-entrant call creates an
        // independent record, so two dispatches produce the expected two calls.
        // The native listener detaches itself
        // (browser once semantics), so only the bookkeeping is dropped here.
        removeListenerEntry(key, false);
        return fn.apply(this, args);
      }
      return wrapper;
    };

    /**
     * @param {symbol} key
     * @param {ListenerOpts | boolean | null} [opts]
     * @returns {(() => void) | null}
     */
    const setupAbortSignal = (key, opts) => {
      if (!opts || typeof opts !== 'object' || !opts.signal) return null;
      const abortListener = () => {
        removeListenerEntry(key, false);
      };
      try {
        opts.signal.addEventListener('abort', abortListener, { once: true });
      } catch (_e) {}
      return abortListener;
    };

    /**
     * Remove a tracked listener entry, optionally detaching from DOM.
     * @param {symbol} key
     * @param {boolean} [removeFromDom=true]
     */
    const removeListenerEntry = (key, removeFromDom = true) => {
      const entry = listeners.get(key);
      if (!entry) return;
      if (removeFromDom) {
        try {
          entry.target.removeEventListener(entry.ev, entry.actualFn, entry.opts);
        } catch (e) {
          logError('cleanupManager', 'unregisterListener failed', e);
        }
      }
      if (entry.abortListener && entry.opts?.signal) {
        try {
          entry.opts.signal.removeEventListener('abort', entry.abortListener);
        } catch (_e) {}
      }
      listeners.delete(key);
      untrackElementListener(entry.target, key);
    };

    /**
     * @param {Node} el
     */
    const disconnectElementObservers = el => {
      const set = elementObservers.get(el);
      if (!set) return;
      for (const o of set) {
        try {
          if (o && typeof o.disconnect === 'function') o.disconnect();
          observers.delete(o);
          sessionObservers.delete(o);
        } catch (_e) {
          logError('cleanupManager', 'disconnectForElement observer failed', _e);
        }
      }
      elementObservers.delete(el);
    };

    /**
     * @param {Node} el
     */
    const disconnectElementListeners = el => {
      const listenerKeys = elementListeners.get(el);
      if (!listenerKeys) return;
      for (const key of [...listenerKeys]) {
        const entry = listeners.get(key);
        if (entry && !entry.persistent) {
          removeListenerEntry(key, true);
        }
      }
    };

    return {
      /**
       * Register a MutationObserver for bulk cleanup on SPA navigation.
       * @template {MutationObserver|IntersectionObserver|ResizeObserver} T
       * @param {T} o - The observer to track
       * @param {Element} [el] - Optional element to associate the observer with
       * @param {{scope?: 'page'|'session'}} [opts] - `scope:'session'` exempts
       *   the observer from per-navigation cleanup (it lives until page unload)
       * @returns {T} The registered observer
       */
      registerObserver(o, el, opts) {
        try {
          if (o) (opts?.scope === 'session' ? sessionObservers : observers).add(o);
          if (el && typeof el === 'object') {
            try {
              let set = elementObservers.get(el);
              if (!set) {
                set = new Set();
                elementObservers.set(el, set);
              }
              set.add(o);
            } catch (_e) {
              logError('cleanupManager', 'registerObserver element tracking failed', _e);
            }
          }
        } catch (_e) {
          logError('cleanupManager', 'registerObserver failed', _e);
        }
        return o;
      },
      /**
       * Stop tracking a MutationObserver for bulk cleanup (it is not disconnected;
       * use disconnectObserver for that).
       * @param {MutationObserver | IntersectionObserver | ResizeObserver} o - The observer to stop tracking
       * @returns {MutationObserver | IntersectionObserver | ResizeObserver} The same observer
       */
      unregisterObserver(
        /** @type {MutationObserver | IntersectionObserver | ResizeObserver} */ o
      ) {
        try {
          observers.delete(o);
          sessionObservers.delete(o);
        } catch (_e) {
          logError('cleanupManager', 'unregisterObserver failed', _e);
        }
        return o;
      },
      /**
       * Register an event listener for bulk cleanup on SPA navigation.
       * @param {EventTarget} target - The element to listen on
       * @param {string} ev - Event name
       * @param {EventListener} fn - Event handler
       * @param {AddEventListenerOptions} [opts] - Listener options
       * @param {boolean|string} [persistent=false] - Whether listener survives per-navigation cleanup
       * @returns {symbol|null} Key to unregister, or null on failure
       */
      registerListener(
        /** @type {EventTarget} */ target,
        /** @type {string} */ ev,
        /** @type {EventListener} */ fn,
        /** @type {ListenerOpts | boolean} */ opts,
        /** @type {boolean | 'session'} */ persistent = false
      ) {
        try {
          if (!target || typeof fn !== 'function') return null;
          const isPersistent = isPersistentScope(persistent, opts);
          const capture = Boolean(typeof opts === 'object' ? opts?.capture : opts);

          const existing = findExistingListener(target, ev, fn, capture);
          if (existing) {
            if (isPersistent && !existing.entry.persistent) {
              existing.entry.persistent = true;
            }
            return existing.key;
          }

          if (opts && typeof opts === 'object' && opts.signal?.aborted) {
            return null;
          }

          const key = Symbol();
          const actualFn = createListenerWrapper(fn, key, opts);
          const abortListener = setupAbortSignal(key, opts);

          target.addEventListener(ev, actualFn, opts);

          listeners.set(key, {
            target,
            ev,
            fn,
            actualFn,
            opts,
            persistent: isPersistent,
            capture,
            abortListener,
            owner: ownerOf(opts),
          });
          trackElementListener(target, key);
          listenerStats.registeredTotal++;
          return key;
        } catch (e) {
          logError('cleanupManager', 'registerListener failed', e);
          return null;
        }
      },
      /**
       * Unregister a tracked listener and remove it from the DOM.
       * @param {symbol|null} key - The key returned by registerListener
       * @returns {symbol|null} The same key
       */
      unregisterListener(/** @type {symbol | null} */ key) {
        if (!key) return key;
        removeListenerEntry(key, true);
        return key;
      },
      /**
       * Get statistics about registered listeners.
       * @returns {{ active: number, registeredTotal: number }}
       */
      getListenerStats() {
        try {
          return {
            active: listeners.size,
            registeredTotal: listenerStats.registeredTotal,
          };
        } catch (_e) {
          return { active: 0, registeredTotal: 0 };
        }
      },
      /**
       * Register a setInterval ID for bulk cleanup.
       * @param {number} id - The interval ID
       * @param {{scope?: 'page'|'session'}} [opts] - `scope:'session'` exempts
       *   the interval from per-navigation cleanup (it lives until page unload)
       * @returns {number} The registered ID
       */
      registerInterval(/** @type {number} */ id, /** @type {{scope?: 'page'|'session'}} */ opts) {
        (opts?.scope === 'session' ? sessionIntervals : intervals).add(id);
        return id;
      },
      /**
       * Unregister a tracked interval.
       * @param {number} id - The interval ID to remove
       * @returns {number} The removed ID
       */
      unregisterInterval(/** @type {number} */ id) {
        intervals.delete(id);
        sessionIntervals.delete(id);
        return id;
      },
      /**
       * Register a setTimeout ID for bulk cleanup.
       * @param {number} id - The timeout ID
       * @param {{scope?: 'page'|'session'}} [opts] - `scope:'session'` exempts
       *   the timeout from per-navigation cleanup
       * @returns {number} The registered ID
       */
      registerTimeout(/** @type {number} */ id, /** @type {{scope?: 'page'|'session'}} */ opts) {
        (opts?.scope === 'session' ? sessionTimeouts : timeouts).add(id);
        return id;
      },
      /**
       * Schedule a timeout that stays registered only until it fires.
       * @param {Function} fn - Callback
       * @param {number} ms - Delay
       * @param {{scope?: 'page'|'session'}} [opts]
       * @returns {number} The timeout ID
       */
      timeout(
        /** @type {() => void} */ fn,
        /** @type {number} */ ms,
        /** @type {{scope?: 'page'|'session'}} */ opts
      ) {
        const set = opts?.scope === 'session' ? sessionTimeouts : timeouts;
        // lint:custom:ignore registered on the next line
        const id = /** @type {number} */ (
          /** @type {unknown} */ (
            /** @type {typeof setTimeout} */ (setTimeout)(() => {
              set.delete(id);
              fn();
            }, ms)
          )
        );
        set.add(id);
        return id;
      },
      /**
       * Unregister a tracked timeout.
       * @param {number} id - The timeout ID to remove
       * @returns {number} The removed ID
       */
      unregisterTimeout(/** @type {number} */ id) {
        timeouts.delete(id);
        sessionTimeouts.delete(id);
        return id;
      },
      /**
       * Register a requestAnimationFrame ID for bulk cleanup.
       * @param {number} id - The animation frame ID
       * @param {{scope?: 'page'|'session'}} [opts] - `scope:'session'` exempts
       *   the frame from per-navigation cleanup
       * @returns {number} The registered ID
       */
      registerAnimationFrame(
        /** @type {number} */ id,
        /** @type {{scope?: 'page'|'session'}} */ opts
      ) {
        (opts?.scope === 'session' ? sessionAnimationFrames : animationFrames).add(id);
        return id;
      },
      /**
       * Unregister a tracked requestAnimationFrame ID (e.g. after it already fired
       * or was cancelled manually) so bulk cleanup does not touch it again.
       * @param {number} id - The animation frame ID
       * @returns {number} The removed ID
       */
      unregisterAnimationFrame(/** @type {number} */ id) {
        animationFrames.delete(id);
        sessionAnimationFrames.delete(id);
        return id;
      },
      /**
       * Register a custom cleanup callback.
       * @param {() => void} cb - Cleanup function to call on SPA navigation
       * @param {{scope?: 'page'|'session'}} [opts] - `scope:'session'` exempts
       *   the callback from per-navigation cleanup (it lives until page unload)
       */
      register(/** @type {() => void} */ cb, /** @type {{scope?: 'page'|'session'}} */ opts) {
        if (typeof cb === 'function') {
          (opts?.scope === 'session' ? sessionCallbacks : callbacks).add(cb);
        }
      },
      /**
       * Unregister a tracked cleanup callback.
       * @param {() => void} cb - The callback to remove
       */
      unregister(/** @type {() => void} */ cb) {
        callbacks.delete(cb);
        sessionCallbacks.delete(cb);
      },
      /**
       * Register a callback to run when yt-navigate-start fires.
       * @param {() => void} cb
       * @returns {() => void} Unregister function
       */
      onNavigateStart(/** @type {() => void} */ cb) {
        if (typeof cb !== 'function') return () => {};
        navigateStartHooks.add(cb);
        return () => {
          navigateStartHooks.delete(cb);
        };
      },
      /**
       * Register a callback to run when yt-navigate-finish fires.
       * @param {() => void} cb
       * @returns {() => void} Unregister function
       */
      onNavigateFinish(/** @type {() => void} */ cb) {
        if (typeof cb !== 'function') return () => {};
        navigateFinishHooks.add(cb);
        return () => {
          navigateFinishHooks.delete(cb);
        };
      },
      /**
       * Notify registered start-of-navigation hooks. Called by the
       * module-registry during SPA navigation, or by listeners on
       * yt-navigate-start.
       */
      notifyNavigateStart() {
        runHooks(navigateStartHooks, 'navigateStart');
      },
      /**
       * Notify registered end-of-navigation hooks. Called by the
       * module-registry during SPA navigation, or by listeners on
       * yt-navigate-finish.
       */
      notifyNavigateFinish() {
        runHooks(navigateFinishHooks, 'navigateFinish');
      },
      /**
       * Execute registered cleanup callbacks, swallowing individual errors
       * so one bad callback cannot abort the whole cleanup.
       */
      runCallbacks() {
        for (const cb of callbacks) {
          try {
            cb();
          } catch (e) {
            logError('cleanupManager', 'callback failed', e);
          }
        }
        callbacks.clear();
      },
      /**
       * Disconnect all registered page-scoped MutationObservers /
       * IntersectionObservers. Session-scoped observers are left running.
       */
      disconnectObservers() {
        for (const o of observers) {
          try {
            if (o && typeof o.disconnect === 'function') o.disconnect();
          } catch (_e) {
            logError('cleanupManager', 'disconnectObservers failed', _e);
          }
        }
        observers.clear();
      },
      /**
       * Remove non-persistent event listeners registered through this manager.
       */
      removeListeners() {
        const listenerEntries = [...listeners.entries()];
        for (const [key, keyEntry] of listenerEntries) {
          if (keyEntry.persistent) continue;
          removeListenerEntry(key, true);
        }
      },
      /**
       * Clear all tracked intervals, timeouts and animation frames.
       * Session-scoped timers (registered with `scope:'session'`) survive:
       * they are boot-lifetime resources like the update checker interval.
       */
      clearTimers() {
        flushSet(intervals, clearInterval, 'interval');
        flushSet(timeouts, clearTimeout, 'timeout');
        flushSet(animationFrames, cancelAnimationFrame, 'animationFrame');
      },
      /**
       * Run all registered cleanup logic: execute callbacks, disconnect
       * observers, remove listeners, clear intervals/timeouts/frames.
       */
      cleanup() {
        try {
          this.runCallbacks();
          this.disconnectObservers();
          this.removeListeners();
          this.clearTimers();
        } catch (e) {
          logError('cleanupManager', 'cleanup failed', e);
        }
      },
      observers,
      elementObservers,
      elementListeners,
      /**
       * Disconnect all observers and unregister all non-persistent listeners
       * associated with a specific element.
       * @param {Element} el - The element whose observers and listeners should be disconnected
       */
      disconnectForElement(/** @type {Element} */ el) {
        try {
          if (!el || typeof el !== 'object') return;
          disconnectElementObservers(el);
          disconnectElementListeners(el);
        } catch (e) {
          logError('cleanupManager', 'disconnectForElement failed', e);
        }
      },
      /**
       * Remove every listener whose target or owner lies inside `root`
       * (including `root`), persistent ones too: they belong to DOM that is
       * being discarded, such as a closing dialog.
       * @param {Node} root
       */
      disconnectSubtree(/** @type {Node} */ root) {
        try {
          if (!root || typeof root.contains !== 'function') return;
          disconnectElementObservers(root);
          for (const [key, entry] of [...listeners.entries()]) {
            const node = entry.owner || entry.target;
            if (
              node &&
              typeof node.nodeType === 'number' &&
              (node === root || root.contains(node))
            ) {
              removeListenerEntry(key, true);
            }
          }
        } catch (e) {
          logError('cleanupManager', 'disconnectSubtree failed', e);
        }
      },
      /**
       * Disconnect a specific observer and remove it from tracking.
       * @param {MutationObserver} o - The observer to disconnect
       */
      disconnectObserver(/** @type {MutationObserver} */ o) {
        try {
          if (!o) return;
          try {
            if (typeof o.disconnect === 'function') o.disconnect();
          } catch (_e) {
            logError('cleanupManager', 'disconnectObserver disconnect failed', _e);
          }
          observers.delete(o);
          sessionObservers.delete(o);
        } catch (e) {
          logError('cleanupManager', 'disconnectObserver failed', e);
        }
      },
      listeners,
      intervals,
      timeouts,
      animationFrames,
      sessionObservers,
      sessionIntervals,
      sessionTimeouts,
      sessionAnimationFrames,
    };
  })();

  if (typeof window !== 'undefined') {
    const origClearTimeout = window.clearTimeout;
    if (typeof origClearTimeout === 'function') {
      window.clearTimeout = /** @type {typeof window.clearTimeout} */ (
        function (/** @type {number} */ id) {
          cleanupManager.timeouts.delete(id);
          cleanupManager.sessionTimeouts.delete(id);
          return origClearTimeout(id);
        }
      );
    }
    const origClearInterval = window.clearInterval;
    if (typeof origClearInterval === 'function') {
      window.clearInterval = /** @type {typeof window.clearInterval} */ (
        function (/** @type {number} */ id) {
          cleanupManager.intervals.delete(id);
          cleanupManager.sessionIntervals.delete(id);
          return origClearInterval(id);
        }
      );
    }

    window.YouTubePlusCleanupManager = /** @type {CleanupManager} */ (cleanupManager);
    // Mirror onto YouTubeUtils only when the facade already exists (utils.js
    // has loaded first). utils.js owns creating YouTubeUtils, so this stays a
    // guarded mirror: an unconditional assignment would no-op when utils.js
    // loads later and would break callers that read `YouTubeUtils.cleanupManager`.
    if (window.YouTubeUtils && !window.YouTubeUtils.cleanupManager) {
      window.YouTubeUtils.cleanupManager = /** @type {CleanupManager} */ (cleanupManager);
    }

    const startHandler = () => {
      cleanupManager.notifyNavigateStart();
    };
    const finishHandler = () => {
      cleanupManager.notifyNavigateFinish();
    };
    window.addEventListener('yt-navigate-start', startHandler);
    window.addEventListener('yt-navigate-finish', finishHandler);
    cleanupManager.registerListener(window, 'yt-navigate-start', startHandler, undefined, true);
    cleanupManager.registerListener(window, 'yt-navigate-finish', finishHandler, undefined, true);
  }
})();
