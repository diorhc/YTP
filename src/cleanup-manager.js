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
   * persistence (memory + localStorage) instead of plain console logging.
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

  const cleanupManager = (function () {
    const observers = new Set();
    const listeners = new Map();
    const listenerStats = { registeredTotal: 0 };
    const intervals = new Set();
    const timeouts = new Set();
    const animationFrames = new Set();
    const callbacks = new Set();
    const elementObservers = new WeakMap();

    return {
      /**
       * Register a MutationObserver for bulk cleanup on SPA navigation.
       * @param {MutationObserver} o - The observer to track
       * @param {Element} [el] - Optional element to associate the observer with
       * @returns {MutationObserver} The registered observer
       */
      registerObserver(/** @type {any} */ o, /** @type {any} */ el) {
        try {
          if (o) observers.add(o);
          if (el && typeof el === 'object') {
            try {
              let set = elementObservers.get(el);
              if (!set) {
                set = new Set();
                elementObservers.set(el, set);
              }
              set.add(o);
            } catch (_e) {
              window.YouTubePlusErrorBoundary?.logError?.(
                _e instanceof Error ? _e : new Error(String(_e)),
                { module: 'CleanupManager' }
              );
            }
          }
        } catch (_e) {
          window.YouTubePlusErrorBoundary?.logError?.(
            _e instanceof Error ? _e : new Error(String(_e)),
            { module: 'CleanupManager' }
          );
        }
        return o;
      },
      /**
       * Register an event listener for bulk cleanup on SPA navigation.
       * @param {EventTarget} target - The element to listen on
       * @param {string} ev - Event name
       * @param {EventListener} fn - Event handler
       * @param {AddEventListenerOptions} [opts] - Listener options
       * @returns {symbol|null} Key to unregister, or null on failure
       */
      registerListener(
        /** @type {any} */ target,
        /** @type {any} */ ev,
        /** @type {any} */ fn,
        /** @type {any} */ opts,
        /** @type {boolean} */ persistent = false
      ) {
        try {
          target.addEventListener(ev, fn, opts);
          const key = Symbol();
          listeners.set(key, { target, ev, fn, opts, persistent });
          listenerStats.registeredTotal++;
          return key;
        } catch (e) {
          logError('cleanupManager', 'registerListener failed', e);
          return null;
        }
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
       * @returns {number} The registered ID
       */
      registerInterval(/** @type {any} */ id) {
        intervals.add(id);
        return id;
      },
      /**
       * Unregister a previously registered interval.
       * @param {number} id - The interval ID to remove
       * @returns {number} The removed ID
       */
      unregisterInterval(/** @type {any} */ id) {
        intervals.delete(id);
        return id;
      },
      /**
       * Register a setTimeout ID for bulk cleanup.
       * @param {number} id - The timeout ID
       * @returns {number} The registered ID
       */
      registerTimeout(/** @type {any} */ id) {
        timeouts.add(id);
        return id;
      },
      /**
       * Register a requestAnimationFrame ID for bulk cleanup.
       * @param {number} id - The animation frame ID
       * @returns {number} The registered ID
       */
      registerAnimationFrame(/** @type {any} */ id) {
        animationFrames.add(id);
        return id;
      },
      /**
       * Register a custom cleanup callback.
       * @param {() => void} cb - Cleanup function to call on SPA navigation
       */
      register(/** @type {any} */ cb) {
        if (typeof cb === 'function') callbacks.add(cb);
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
       * Disconnect all registered MutationObservers / IntersectionObservers.
       */
      disconnectObservers() {
        for (const o of observers) {
          try {
            if (o && typeof o.disconnect === 'function') o.disconnect();
          } catch (_e) {
            window.YouTubePlusErrorBoundary?.logError?.(
              _e instanceof Error ? _e : new Error(String(_e)),
              { module: 'CleanupManager' }
            );
          }
        }
        observers.clear();
      },
      /**
       * Remove non-persistent event listeners registered through this manager.
       */
      removeListeners() {
        const persistentEvents = new Set([
          'yt-navigate-start',
          'yt-navigate-finish',
          'yt-page-data-updated',
          'yt-page-data-fetched',
          'popstate',
          'hashchange',
          'keydown',
          'keyup',
          'keypress',
          'visibilitychange',
          'fullscreenchange',
          'resize',
          'scroll',
          'beforeunload',
        ]);
        const listenerEntries = [...listeners.entries()];
        for (const [key, keyEntry] of listenerEntries) {
          if (keyEntry.persistent || persistentEvents.has(keyEntry.ev)) continue;
          try {
            keyEntry.target.removeEventListener(keyEntry.ev, keyEntry.fn, keyEntry.opts);
          } catch (_e) {
            window.YouTubePlusErrorBoundary?.logError?.(
              _e instanceof Error ? _e : new Error(String(_e)),
              { module: 'CleanupManager' }
            );
          }
          listeners.delete(key);
        }
      },
      /**
       * Clear all tracked intervals, timeouts and animation frames.
       */
      clearTimers() {
        for (const id of intervals) clearInterval(id);
        intervals.clear();
        for (const id of timeouts) clearTimeout(id);
        timeouts.clear();
        for (const id of animationFrames) cancelAnimationFrame(id);
        animationFrames.clear();
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
      /**
       * Disconnect all observers associated with a specific element.
       * @param {Element} el - The element whose observers should be disconnected
       */
      disconnectForElement(/** @type {any} */ el) {
        try {
          const set = elementObservers.get(el);
          if (!set) return;
          for (const o of set) {
            try {
              if (o && typeof o.disconnect === 'function') o.disconnect();
              observers.delete(o);
            } catch (_e) {
              window.YouTubePlusErrorBoundary?.logError?.(
                _e instanceof Error ? _e : new Error(String(_e)),
                { module: 'CleanupManager' }
              );
            }
          }
          elementObservers.delete(el);
        } catch (e) {
          logError('cleanupManager', 'disconnectForElement failed', e);
        }
      },
      /**
       * Disconnect a specific observer and remove it from tracking.
       * @param {MutationObserver} o - The observer to disconnect
       */
      disconnectObserver(/** @type {any} */ o) {
        try {
          if (!o) return;
          try {
            if (typeof o.disconnect === 'function') o.disconnect();
          } catch (_e) {
            window.YouTubePlusErrorBoundary?.logError?.(
              _e instanceof Error ? _e : new Error(String(_e)),
              { module: 'CleanupManager' }
            );
          }
          observers.delete(o);
        } catch (e) {
          logError('cleanupManager', 'disconnectObserver failed', e);
        }
      },
      listeners,
      intervals,
      timeouts,
      animationFrames,
    };
  })();

  if (typeof window !== 'undefined') {
    window.YouTubePlusCleanupManager = cleanupManager;
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusCleanupManager = cleanupManager;
    }
    // Mirror onto YouTubeUtils ONLY if the facade already exists
    // (i.e. utils.js has loaded first). We never create YouTubeUtils
    // here — that is utils.js's responsibility. This was previously
    // an unconditional assignment that no-op'd when utils.js loaded
    // later; keeping it as a guarded mirror avoids breaking tests
    // and legacy callers that read `YouTubeUtils.cleanupManager`.
    if (window.YouTubeUtils && !window.YouTubeUtils.cleanupManager) {
      window.YouTubeUtils.cleanupManager = cleanupManager;
    }
  }
})();
