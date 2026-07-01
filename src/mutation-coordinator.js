// Mutation Lifecycle Coordinator — canonical mutation lifecycle service.
//
// Canonical responsibility: own the single shared `MutationObserver`
// for the document, route mutation batches to subscribers, and
// manage the watch/unwatch lifecycle for both root-level and
// target-scoped subscriptions.
//
// This module is *not* a generic timer / scheduler / visibility
// utility. The retry scheduler (`createRetryScheduler`) is kept
// here only because it is the natural complement to the
// mutation API — both APIs are about "react to a DOM condition"
// — and because it has no better canonical home. Visibility-aware
// intervals and managed timers are not mutation lifecycle and
// are intentionally not part of this surface.
//
// Public API on `window.YouTubePlusMutationCoordinator`:
//   - subscribeRoot(id, callback, options?)  // also exposed as subscribe()
//   - unsubscribe(id)
//   - watchTarget(id, target, callback, options?)  // also exposed as watch()
//   - unwatch(id)
//   - createRetryScheduler(opts)  // uses private managed timers
//   - getStats()
//   - dispose()                   // explicit teardown
//
// `createRetryScheduler` is the only remaining generic helper
// and is kept on the public surface because it backs
// `dom-cache.waitForElement`'s scoped-context waiting strategy
// and is consumed directly by 8+ feature modules.

(function () {
  if (typeof window === 'undefined' || window.YouTubePlusMutationCoordinator) return;
  const mcLogger = window.YouTubeUtils?.logger || null;

  // ---------------------------------------------------------------------------
  // Internal types
  // ---------------------------------------------------------------------------

  /**
   * @typedef {{
   *   id: string,
   *   callback: (mutations: MutationRecord[]) => void,
   *   selector: string | null,
   *   attributes: boolean,
   *   childList: boolean,
   *   subtree: boolean,
   *   attributeFilter: string[] | null
   * }} RootSubscription
   *
   * @typedef {{
   *   selector?: string | null,
   *   attributes?: boolean,
   *   childList?: boolean,
   *   subtree?: boolean,
   *   attributeFilter?: string[] | null
   * }} SubscriptionOptions
   */

  // ---------------------------------------------------------------------------
  // Shared root observer state
  // ---------------------------------------------------------------------------

  /** @type {Map<string, RootSubscription>} */
  const rootSubscriptions = new Map();
  /** @type {MutationObserver | null} */
  let rootObserver = null;
  let rafScheduled = false;
  /** @type {MutationRecord[]} */
  let pendingMutations = [];
  /** @type {MutationObserverInit | null} */
  let currentObserveConfig = null;

  /**
   * @param {MutationObserverInit | null} config
   * @returns {string}
   */
  const configKey = config => (config ? JSON.stringify(config) : 'null');

  /**
   * @param {string | null} selector
   * @param {MutationRecord[]} mutations
   * @returns {boolean}
   */
  const shouldNotifySelector = (selector, mutations) => {
    if (!selector) return true;

    for (const mutation of mutations) {
      const target = mutation.target;
      if (target instanceof Element && (target.matches(selector) || target.closest(selector))) {
        return true;
      }

      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(selector) || node.querySelector(selector)) return true;
      }
    }

    return false;
  };

  /**
   * @param {RootSubscription} sub
   * @param {MutationRecord[]} batch
   * @returns {MutationRecord[]}
   */
  const filterMutationsForSubscription = (sub, batch) => {
    const out = [];
    for (const mutation of batch) {
      if (mutation.type === 'attributes') {
        if (!sub.attributes) continue;
        if (
          sub.attributeFilter &&
          sub.attributeFilter.length > 0 &&
          mutation.attributeName &&
          !sub.attributeFilter.includes(mutation.attributeName)
        ) {
          continue;
        }
      }
      if (mutation.type === 'childList' && !sub.childList) continue;
      out.push(mutation);
    }
    return out;
  };

  const flush = () => {
    rafScheduled = false;
    if (pendingMutations.length === 0) return;

    const batch = pendingMutations;
    pendingMutations = [];

    for (const sub of rootSubscriptions.values()) {
      try {
        if (!shouldNotifySelector(sub.selector, batch)) continue;
        const filtered = filterMutationsForSubscription(sub, batch);
        if (filtered.length > 0) {
          sub.callback(filtered);
        }
      } catch (e) {
        mcLogger?.error?.('MutationCoordinator', 'subscriber failed', e);
      }
    }
  };

  /**
   * @returns {MutationObserverInit}
   */
  const computeObserveConfig = () => {
    let childList = false;
    let attributes = false;
    let hasUnlimitedAttributeFilter = false;
    /** @type {Set<string>} */
    const attrSet = new Set();

    for (const sub of rootSubscriptions.values()) {
      childList = childList || sub.childList;
      attributes = attributes || sub.attributes;
      if (sub.attributes) {
        if (!sub.attributeFilter || sub.attributeFilter.length === 0) {
          hasUnlimitedAttributeFilter = true;
        } else {
          for (const attr of sub.attributeFilter) attrSet.add(attr);
        }
      }
    }

    return {
      childList,
      subtree: true,
      attributes,
      attributeFilter:
        attributes && !hasUnlimitedAttributeFilter && attrSet.size > 0 ? [...attrSet] : undefined,
    };
  };

  /**
   * @param {MutationObserverInit} nextConfig
   */
  const ensureRootObserver = nextConfig => {
    const target = document.body || document.documentElement;
    if (!target) return;

    if (!rootObserver) {
      rootObserver = new MutationObserver(mutations => {
        pendingMutations.push(...mutations);
        if (rafScheduled) return;
        rafScheduled = true;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(flush);
        } else {
          setTimeout(flush, 0);
        }
      });
    }

    if (configKey(currentObserveConfig) === configKey(nextConfig)) {
      return;
    }

    rootObserver.disconnect();
    rootObserver.observe(target, nextConfig);
    currentObserveConfig = nextConfig;
  };

  const refreshObserver = () => {
    if (rootSubscriptions.size === 0) {
      if (rootObserver) {
        rootObserver.disconnect();
        rootObserver = null;
      }
      currentObserveConfig = null;
      pendingMutations = [];
      rafScheduled = false;
      return;
    }

    ensureRootObserver(computeObserveConfig());
  };

  /**
   * @param {Node} target
   * @param {MutationRecord} mutation
   * @param {{subtree?: boolean, childList?: boolean, attributes?: boolean, attributeFilter?: string[]|null}} options
   * @returns {boolean}
   */
  const mutationTouchesTarget = (target, mutation, options) => {
    const allowSubtree = options.subtree !== false;

    if (mutation.type === 'attributes') {
      if (!options.attributes) return false;
      if (
        options.attributeFilter &&
        options.attributeFilter.length > 0 &&
        mutation.attributeName &&
        !options.attributeFilter.includes(mutation.attributeName)
      ) {
        return false;
      }
      if (mutation.target === target) return true;
      if (!allowSubtree) return false;
      return target instanceof Element && target.contains(mutation.target);
    }

    if (mutation.type === 'childList') {
      if (!options.childList) return false;
      if (mutation.target === target) return true;
      if (!allowSubtree) return false;
      if (target instanceof Element && target.contains(mutation.target)) return true;
      for (const node of mutation.addedNodes) {
        if (node === target) return true;
        if (target instanceof Element && node instanceof Element && target.contains(node)) {
          return true;
        }
      }
      for (const node of mutation.removedNodes) {
        if (node === target) return true;
      }
    }

    return false;
  };

  // ---------------------------------------------------------------------------
  // Private managed timers — used only by createRetryScheduler.
  //
  // These are intentionally not part of the public API. Earlier
  // revisions exposed `setManagedTimeout` / `setManagedInterval`
  // on the coordinator surface, but no external module actually
  // consumed them — callers had their own `setTimeout_` /
  // `setInterval` fallbacks wired through the cleanup manager.
  // Keeping them private also means we can change the backing
  // store (e.g. move to cleanup-manager) without breaking
  // external callers.
  // ---------------------------------------------------------------------------

  /** @type {Map<string, { kind: 'timeout', handle: ReturnType<typeof setTimeout>, label: string }>} */
  const managedTimers = new Map();
  let nextTimerId = 0;

  const createManagedTimerId = () => `ytp:timeout:${Date.now().toString(36)}:${nextTimerId++}`;

  /**
   * @param {() => void} callback
   * @param {number} delay
   * @param {string} [label]
   * @returns {string}
   */
  const setManagedTimeout = (callback, delay, label = 'managed') => {
    const id = createManagedTimerId();
    const handle = setTimeout(() => {
      managedTimers.delete(id);
      try {
        callback();
      } catch (e) {
        mcLogger?.error?.('MutationCoordinator', 'managed timeout failed', e);
      }
    }, delay);
    managedTimers.set(id, { kind: 'timeout', handle, label });
    return id;
  };

  /**
   * @param {string | null | undefined} id
   */
  const clearManagedTimeout = id => {
    if (!id) return;
    const timer = managedTimers.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    managedTimers.delete(id);
  };

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** @type {{
   *   subscribeRoot: (id: string, callback: (mutations: MutationRecord[]) => void, options?: SubscriptionOptions) => string | null,
   *   subscribe: (id: string, callback: (mutations: MutationRecord[]) => void, options?: SubscriptionOptions) => string | null,
   *   unsubscribe: (id: string) => void,
   *   watchTarget: (id: string, target: Node, callback: (mutations: MutationRecord[]) => void, options?: SubscriptionOptions) => string | null,
   *   watch: (id: string, target: Node, callback: (mutations: MutationRecord[]) => void, options?: SubscriptionOptions) => string | null,
   *   unwatch: (id: string) => void,
   *   createRetryScheduler: (opts: { check: () => boolean, maxAttempts?: number, interval?: number, onGiveUp?: (() => void) | undefined, label?: string | undefined }) => { stop: () => void },
   *   getStats: () => { rootSubscribers: number, rootObserverActive: boolean, managedTimers: number },
   *   dispose: () => void,
   * }} */
  const api = {
    /**
     * Register a subscription on the shared root observer.
     * @param {string} id
     * @param {(mutations: MutationRecord[]) => void} callback
     * @param {SubscriptionOptions} [options]
     * @returns {string | null}
     */
    subscribeRoot(id, callback, options = {}) {
      if (!id || typeof callback !== 'function') return null;
      rootSubscriptions.set(id, {
        id,
        callback,
        selector: typeof options.selector === 'string' ? options.selector : null,
        attributes: options.attributes === true,
        childList: options.childList !== false,
        subtree: options.subtree !== false,
        attributeFilter: Array.isArray(options.attributeFilter)
          ? options.attributeFilter.filter(
              (/** @type {unknown} */ a) => typeof a === 'string' && a.length > 0
            )
          : null,
      });
      refreshObserver();
      return id;
    },

    /**
     * Alias for `subscribeRoot` — shorter name for the desired
     * API direction. `subscribeRoot` is kept for back-compat
     * with the 14+ callers that already use it.
     * @param {string} id
     * @param {(mutations: MutationRecord[]) => void} callback
     * @param {SubscriptionOptions} [options]
     * @returns {string | null}
     */
    subscribe(id, callback, options) {
      return api.subscribeRoot(id, callback, options);
    },

    /**
     * Remove a subscription.
     * @param {string} id
     */
    unsubscribe(id) {
      if (!id) return;
      rootSubscriptions.delete(id);
      refreshObserver();
    },

    /**
     * Subscribe to mutations on a specific target node. Wraps
     * `subscribeRoot` and filters the global mutation batch
     * down to the records that touch `target`.
     * @param {string} id
     * @param {Node} target
     * @param {(mutations: MutationRecord[]) => void} callback
     * @param {SubscriptionOptions} [options]
     * @returns {string | null}
     */
    watchTarget(id, target, callback, options = {}) {
      if (!(id && target instanceof Node) || typeof callback !== 'function') return null;
      const normalized = {
        attributes: options.attributes !== false,
        childList: options.childList !== false,
        subtree: options.subtree !== false,
        attributeFilter: Array.isArray(options.attributeFilter)
          ? options.attributeFilter.filter(
              (/** @type {unknown} */ a) => typeof a === 'string' && a.length > 0
            )
          : null,
      };

      return api.subscribeRoot(
        id,
        (/** @type {MutationRecord[]} */ mutations) => {
          const filtered = mutations.filter((/** @type {MutationRecord} */ m) =>
            mutationTouchesTarget(target, m, normalized)
          );
          if (filtered.length > 0) {
            callback(filtered);
          }
        },
        {
          selector: typeof options.selector === 'string' ? options.selector : null,
          attributes: normalized.attributes,
          childList: normalized.childList,
          subtree: true,
          attributeFilter: normalized.attributeFilter,
        }
      );
    },

    /**
     * Alias for `watchTarget` — shorter name for the desired
     * API direction. `watchTarget` is kept for back-compat
     * with the 4 modules (zoom, timecode, performance, playall)
     * that already use it.
     * @param {string} id
     * @param {Node} target
     * @param {(mutations: MutationRecord[]) => void} callback
     * @param {SubscriptionOptions} [options]
     * @returns {string | null}
     */
    watch(id, target, callback, options) {
      return api.watchTarget(id, target, callback, options);
    },

    /**
     * Remove a watch subscription. Equivalent to `unsubscribe`.
     * @param {string} id
     */
    unwatch(id) {
      api.unsubscribe(id);
    },

    /**
     * Create a retry scheduler that polls a check function
     * until it returns true or `maxAttempts` is reached. Uses
     * the coordinator's private managed timers as a backing
     * store so a single `dispose()` cleans up all in-flight
     * retries.
     *
     * @param {{
     *   check: () => boolean,
     *   maxAttempts?: number,
     *   interval?: number,
     *   onGiveUp?: (() => void) | undefined,
     *   label?: string | undefined
     * }} opts
     * @returns {{ stop: () => void }}
     */
    createRetryScheduler(opts) {
      const { check, maxAttempts = 20, interval = 250, onGiveUp, label = 'retry' } = opts || {};
      let attempts = 0;
      /** @type {string | null} */
      let timeoutId = null;
      let stopped = false;

      const tick = () => {
        if (stopped) return;
        attempts += 1;

        try {
          if (check()) {
            stopped = true;
            return;
          }
        } catch (e) {
          mcLogger?.error?.('MutationCoordinator', 'retry check failed', e);
        }

        if (attempts >= maxAttempts) {
          stopped = true;
          if (typeof onGiveUp === 'function') {
            try {
              onGiveUp();
            } catch (e) {
              mcLogger?.error?.('MutationCoordinator', 'retry give-up callback failed', e);
            }
          }
          return;
        }

        timeoutId = setManagedTimeout(tick, interval, label);
      };

      timeoutId = setManagedTimeout(tick, 0, label);

      return {
        stop() {
          stopped = true;
          if (timeoutId) clearManagedTimeout(timeoutId);
          timeoutId = null;
        },
      };
    },

    /**
     * Diagnostics.
     * @returns {{ rootSubscribers: number, rootObserverActive: boolean, managedTimers: number }}
     */
    getStats() {
      return {
        rootSubscribers: rootSubscriptions.size,
        rootObserverActive: !!rootObserver,
        managedTimers: managedTimers.size,
      };
    },

    /**
     * Explicit teardown for SPA navigation. Disconnects the
     * shared observer, clears all subscriptions, and clears
     * any in-flight managed timers. Safe to call multiple
     * times; safe to call when nothing is subscribed.
     */
    dispose() {
      if (rootObserver) {
        rootObserver.disconnect();
        rootObserver = null;
      }
      currentObserveConfig = null;
      pendingMutations = [];
      rafScheduled = false;
      rootSubscriptions.clear();
      for (const [id, timer] of managedTimers) {
        clearTimeout(timer.handle);
        managedTimers.delete(id);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // SPA safety
  //
  // On full page unload, the shared observer is torn down so
  // the underlying MutationObserver cannot outlive the page.
  // `yt-navigate-finish` is left to per-module unsubscribe
  // calls (zoom, timecode, comment, endscreen, playall, music,
  // playlist-search all unsubscribe their own ids on teardown).
  // ---------------------------------------------------------------------------
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', () => api.dispose());
  }

  if (typeof window !== 'undefined') {
    window.YouTubePlusMutationCoordinator = api;
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusMutationCoordinator = api;
    }
  }
})();
