// Mutation Lifecycle Coordinator: mutation lifecycle service.
//
// Responsibility: own the single shared `MutationObserver`
// for the document, route mutation batches to subscribers, and
// manage the watch/unwatch lifecycle for both root-level and
// target-scoped subscriptions.
//
// This module is *not* a generic timer / scheduler / visibility
// utility. The retry scheduler (`createRetryScheduler`) is kept
// here only because it is the natural complement to the
// mutation API, since both APIs are about "react to a DOM condition"
// and it has no better home. Visibility-aware
// intervals and managed timers are not mutation lifecycle and
// are intentionally not part of this surface.
//
// Public API on `window.YouTubePlusMutationCoordinator`:
//   - subscribeRoot(id, callback, options?)  // also exposed as subscribe()
//   - unsubscribe(id)
//   - watchTarget(id, target, callback, options?)  // also exposed as watch()
//   - unwatch(id)
//   - createRetryScheduler(opts)  // uses private managed timers
//   - whenRelevant(config)        // signal-driven predicate activation
//   - onSectionActive(sectionId, onEnter, onLeave?)  // settings-modal section lifecycle
//   - getStats()
//   - dispose()                   // explicit teardown
//
// `createRetryScheduler` is the only remaining generic helper
// and is kept on the public surface because it backs
// `dom-cache.waitForElement`'s scoped-context waiting strategy
// and is consumed directly by 8+ feature modules.

(function () {
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'MutationCoordinator');
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
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Normalize a raw attributeFilter option into a clean array of non-empty strings, or null.
   * @param {unknown} raw
   * @returns {string[] | null}
   */
  function normalizeAttributeFilter(raw) {
    return Array.isArray(raw) ? raw.filter(a => typeof a === 'string' && a.length > 0) : null;
  }

  /**
   * @param {string | null} attributeName
   * @param {string[] | null | undefined} attributeFilter
   * @returns {boolean} true if the attribute passes the filter (or there is no filter)
   */
  function attributePassesFilter(attributeName, attributeFilter) {
    if (!attributeFilter || attributeFilter.length === 0) return true;
    if (!attributeName) return true;
    return attributeFilter.includes(attributeName);
  }

  // ---------------------------------------------------------------------------
  // Relevance / lifecycle activation helpers
  // ---------------------------------------------------------------------------
  // Moved from utils.js (was a facade-contract violation: this is lifecycle
  // logic, not a proxy/shim/side-effect). Kept here rather than split
  // further since both watch signal-driven activation state, the same
  // conceptual territory as the rest of this file's watch/unwatch API.

  /**
   * Default signals `whenRelevant` re-evaluates its predicate on, when the
   * caller doesn't supply a custom list. Covers YouTube SPA navigation and
   * the settings-modal open/change lifecycle, the two triggers that matter
   * for "is my feature still relevant on this page/with this config" checks.
   * Deliberately does NOT include a generic MutationObserver signal: callers
   * that need DOM-driven re-evaluation should use `subscribeRoot`/`watchTarget`
   * directly and call `.check()` from their own callback, rather than this
   * broadcast that fires when the user toggles a feature.
   * @type {ReadonlyArray<string>}
   */
  const DEFAULT_RELEVANCE_SIGNALS = Object.freeze([
    'yt-navigate-finish',
    'yt-page-data-updated',
    'youtube-plus-settings-modal-opened',
    'youtube-plus-settings-updated',
  ]);

  /**
   * Invoke `fn` only while `predicate()` returns true. Re-evaluates
   * the predicate whenever any of `signals` fires on `window` or
   * `document`.
   *
   * `onEnter` is called every time the predicate flips false→true,
   * and `onLeave` is called every time it flips true→false. The
   * helper never calls `onLeave` automatically on `dispose()`; the
   * caller is responsible for teardown; the browser will reclaim
   * everything when the page unloads anyway, and double-cleanup is
   * harder to debug than missing cleanup in test environments.
   *
   * If `onEnter` throws, the helper logs the error and stays in
   * the inactive state. The next signal will re-attempt activation,
   * which makes the helper self-healing across transient DOM
   * conditions (e.g., `document.querySelector('video')` returning
   * null mid-nav). `onLeave` errors are logged and swallowed: a
   * cleanup failure must not put the module back into a
   * half-initialised state.
   *
   * @param {{
   *   isRelevant: () => boolean,
   *   onEnter?: () => void,
   *   onLeave?: () => void,
   *   signals?: ReadonlyArray<string>,
   *   name?: string
   * }} config
   * @returns {{
   *   active: boolean,
   *   check: () => void,
   *   dispose: () => void
   * }}
   */
  const whenRelevant = config => {
    const signals = config.signals || DEFAULT_RELEVANCE_SIGNALS;
    const label = config.name || 'whenRelevant';
    let active = false;

    const safeOnEnter = () => {
      if (typeof config.onEnter !== 'function') {
        active = true;
        return;
      }
      try {
        config.onEnter();
        active = true;
      } catch (err) {
        logS(err);
        mcLogger?.error?.(label, 'onEnter failed; will retry on next signal', err);
        active = false;
      }
    };

    const safeOnLeave = () => {
      if (typeof config.onLeave !== 'function') {
        active = false;
        return;
      }
      try {
        config.onLeave();
      } catch (err) {
        logS(err);
        mcLogger?.error?.(label, 'onLeave failed; ignoring', err);
      } finally {
        active = false;
      }
    };

    const check = () => {
      let should = false;
      try {
        should = !!config.isRelevant();
      } catch (err) {
        logS(err);
        mcLogger?.error?.(label, 'isRelevant threw; treating as inactive', err);
        should = false;
      }
      if (should && !active) safeOnEnter();
      else if (!should && active) safeOnLeave();
    };

    const handlers = signals.map(name => {
      const handler = () => check();
      // YouTube SPA lifecycle events are dispatched on `document`. Most of them
      // bubble, but some (e.g. yt-page-data-updated) may not in all contexts.
      // Listening on `document` is the safer default; the settings-modal-opened
      // event is also a document event.
      // The modal-opened event is dispatched on `document` (see basic.js); the
      // settings-updated event is dispatched on `window` (see settings-helpers.js);
      // YouTube SPA lifecycle events are dispatched on `document`.
      const target = name === 'youtube-plus-settings-updated' ? window : document;
      const cmKey = window.YouTubePlusCleanupManager?.registerListener?.(
        target,
        name,
        handler,
        undefined,
        true
      );
      return { target, name, handler, cmKey };
    });

    // Initial evaluation. Synchronous: the caller has finished
    // wiring up state by the time they call `whenRelevant`, and
    // making the first check async would race with subsequent
    // sync code that reads `.active`.
    check();

    return {
      get active() {
        return active;
      },
      check,
      dispose: () => {
        for (const h of handlers) {
          if (h.cmKey) {
            window.YouTubePlusCleanupManager?.unregisterListener?.(h.cmKey);
          } else {
            h.target.removeEventListener(h.name, h.handler);
          }
        }
        handlers.length = 0;
      },
    };
  };

  /**
   * Fire `onEnter` whenever the user opens the named settings
   * section, and `onLeave` whenever they leave it. Re-fires on
   * every modal open/close cycle, so the section's UI must be
   * idempotently injectable (a common pattern is to gate the
   * injection with a `WeakSet` of already-populated parents).
   *
   * Implementation note: relies on the
   * `youtube-plus-settings-section-activated` CustomEvent that
   * `handleSidebarNavigation` dispatches in modal-handlers.js.
   * If that event is missing, the helper is silently inert.
   *
   * @param {string} sectionId
   * @param {() => void} onEnter
   * @param {() => void} [onLeave]
   * @returns {{ dispose: () => void }}
   */
  const onSectionActive = (sectionId, onEnter, onLeave) => {
    let active = false;

    /**
     * Leave exactly once per true→false transition. Triggered by
     * a NON-matching section activation, a modal close, or dispose of an
     * active section.
     */
    const invokeLeave = () => {
      if (!active) return;
      active = false;
      if (typeof onLeave === 'function') {
        try {
          onLeave();
        } catch (err) {
          logS(err);
          mcLogger?.error?.('onSectionActive', `onLeave for "${sectionId}" failed`, err);
        }
      }
    };

    const handler = (/** @type {CustomEvent<{ section?: string }>} */ e) => {
      const detail = e?.detail;
      if (!detail || detail.section !== sectionId) {
        // a different section was activated: the prior section
        // must leave now, not only when the whole modal closes.
        invokeLeave();
        return;
      }
      // Re-activation of the already-active section is NOT a new enter.
      if (active) return;
      active = true;
      try {
        onEnter();
      } catch (err) {
        logS(err);
        mcLogger?.error?.('onSectionActive', `onEnter for "${sectionId}" failed`, err);
        active = false;
      }
    };
    const leaveHandler = () => {
      // The whole modal closed: any active section leaves.
      invokeLeave();
    };
    const enterKey = window.YouTubePlusCleanupManager?.registerListener?.(
      document,
      'youtube-plus-settings-section-activated',
      handler,
      undefined,
      true
    );
    const leaveKey = window.YouTubePlusCleanupManager?.registerListener?.(
      document,
      'youtube-plus-settings-modal-closed',
      leaveHandler,
      undefined,
      true
    );
    return {
      dispose: () => {
        // Explicitly defined: disposing an active section invokes its
        // final onLeave before the subscriptions are released.
        invokeLeave();
        if (enterKey) {
          window.YouTubePlusCleanupManager?.unregisterListener?.(enterKey);
        } else {
          document.removeEventListener(
            'youtube-plus-settings-section-activated',
            /** @type {EventListener} */ (handler)
          );
        }
        if (leaveKey) {
          window.YouTubePlusCleanupManager?.unregisterListener?.(leaveKey);
        } else {
          document.removeEventListener('youtube-plus-settings-modal-closed', leaveHandler);
        }
      },
    };
  };

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
  let paused = false;

  /**
   * @param {MutationObserverInit | null} config
   * @returns {string}
   */
  const configKey = config => (config ? JSON.stringify(config) : 'null');

  /**
   * @typedef {{
   *   matches: boolean,
   *   closest: boolean,
   *   contains: boolean
   * }} SelectorMemoEntry
   *
   * Per-flush memo for selector checks against the same element.
   * The Map is recreated for every flush and released afterwards, so
   * it does not retain DOM elements beyond the synchronous flush window.
   * @type {Map<Element, Map<string, SelectorMemoEntry>> | null}
   */
  let activeSelectorMemo = null;

  /**
   * @param {Element} el
   * @param {string} selector
   * @returns {SelectorMemoEntry}
   */
  const getSelectorMemoEntry = (el, selector) => {
    if (!activeSelectorMemo) {
      activeSelectorMemo = new Map();
    }
    let map = activeSelectorMemo.get(el);
    if (!map) {
      map = new Map();
      activeSelectorMemo.set(el, map);
    }
    let entry = map.get(selector);
    if (!entry) {
      entry = {
        matches: el.matches(selector),
        closest: !!el.closest(selector),
        contains: !!el.querySelector(selector),
      };
      map.set(selector, entry);
    }
    return entry;
  };

  /**
   * @param {string | null} selector
   * @param {MutationRecord[]} mutations
   * @returns {boolean}
   */
  const shouldNotifySelector = (selector, mutations) => {
    if (!selector) return true;

    for (const mutation of mutations) {
      const target = mutation.target;
      if (target instanceof Element) {
        const t = getSelectorMemoEntry(target, selector);
        if (t.matches || t.closest) return true;
      }

      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        const n = getSelectorMemoEntry(node, selector);
        if (n.matches || n.closest || n.contains) return true;
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
        if (!attributePassesFilter(mutation.attributeName, sub.attributeFilter)) {
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
    if (pendingMutations.length === 0 || paused) return;

    const batch = pendingMutations;
    pendingMutations = [];
    activeSelectorMemo = new Map();

    try {
      for (const sub of rootSubscriptions.values()) {
        try {
          if (!shouldNotifySelector(sub.selector, batch)) continue;
          const filtered = filterMutationsForSubscription(sub, batch);
          if (filtered.length > 0) {
            sub.callback(filtered);
          }
        } catch (e) {
          logS(e);
          mcLogger?.error?.('MutationCoordinator', 'subscriber failed', e);
        }
      }
    } finally {
      activeSelectorMemo = null;
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
      // lint:custom:ignore - Raw observer registered via CleanupManager below with raw fallback
      const rawRootObserver = new MutationObserver(mutations => {
        if (paused) return;
        pendingMutations.push(...mutations);
        if (rafScheduled) return;
        rafScheduled = true;
        if (typeof requestAnimationFrame === 'function') {
          // Tracked only while pending, so fired frames do not pile up in the
          // manager's frame set.
          const cm = window.YouTubePlusCleanupManager;
          const frameId = requestAnimationFrame(() => {
            cm?.unregisterAnimationFrame?.(frameId);
            flush();
          });
          cm?.registerAnimationFrame?.(frameId);
        } else {
          setTimeout(flush, 0);
        }
      });
      rootObserver =
        window.YouTubePlusCleanupManager?.registerObserver?.(rawRootObserver, null, {
          scope: 'session',
        }) || rawRootObserver;
    }

    if (configKey(currentObserveConfig) === configKey(nextConfig)) {
      return;
    }

    rootObserver.disconnect();
    rootObserver.observe(target, nextConfig);
    currentObserveConfig = nextConfig;
  };

  /**
   * Pause mutation processing during SPA navigation. Disconnects the
   * observer, drops any pending mutations, and cancels the scheduled
   * flush so the coordinator does not waste cycles on the dying DOM.
   */
  const pause = () => {
    if (paused) return;
    paused = true;
    rafScheduled = false;
    pendingMutations = [];
    activeSelectorMemo = null;
    if (rootObserver) {
      rootObserver.disconnect();
      rootObserver = null;
    }
    currentObserveConfig = null;
  };

  /**
   * Resume mutation processing after SPA navigation. Re-observes with
   * the current subscription configuration.
   */
  const resume = () => {
    if (!paused) return;
    paused = false;
    refreshObserver();
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
   * @param {{subtree?: boolean, attributes?: boolean, attributeFilter?: string[]|null}} options
   * @returns {boolean}
   */
  const attributeMutationTouches = (target, mutation, options) => {
    if (!options.attributes) return false;
    if (!attributePassesFilter(mutation.attributeName, options.attributeFilter)) return false;
    if (mutation.target === target) return true;
    if (options.subtree === false) return false;
    return target instanceof Element && target.contains(mutation.target);
  };

  /**
   * @param {Node} target
   * @param {MutationRecord} mutation
   * @param {{subtree?: boolean, childList?: boolean}} options
   * @returns {boolean}
   */
  const childListMutationTouches = (target, mutation, options) => {
    if (!options.childList) return false;
    if (mutation.target === target) return true;
    if (options.subtree === false) return false;
    if (target instanceof Element && target.contains(mutation.target)) return true;
    for (const node of mutation.addedNodes) {
      if (node === target) return true;
    }
    for (const node of mutation.removedNodes) {
      if (node === target) return true;
    }
    return false;
  };

  /**
   * @param {Node} target
   * @param {MutationRecord} mutation
   * @param {{subtree?: boolean, childList?: boolean, attributes?: boolean, attributeFilter?: string[]|null}} options
   * @returns {boolean}
   */
  const mutationTouchesTarget = (target, mutation, options) => {
    if (mutation.type === 'attributes') return attributeMutationTouches(target, mutation, options);
    if (mutation.type === 'childList') return childListMutationTouches(target, mutation, options);
    return false;
  };

  // ---------------------------------------------------------------------------
  // Private managed timers used only by createRetryScheduler.
  //
  // Not part of the public API, so the backing store can change without
  // breaking external callers.
  // ---------------------------------------------------------------------------

  /** @type {Map<string, { kind: 'timeout', handle: ReturnType<typeof setTimeout>, label: string }>} */
  const managedTimers = new Map();
  let nextTimerId = 0;

  const createManagedTimerId = () => `yp:timeout:${Date.now().toString(36)}:${nextTimerId++}`;

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
      callback();
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
   *   getStats: () => { rootSubscribers: number, rootObserverActive: boolean, managedTimers: number, paused: boolean },
   *   pause: () => void,
   *   resume: () => void,
   *   dispose: () => void,
   * }} */
  /** @type {YouTubePlusMutationCoordinatorAPI} */
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
        attributeFilter: normalizeAttributeFilter(options.attributeFilter),
      });
      refreshObserver();
      return id;
    },

    /**
     * Alias for `subscribeRoot`: shorter name for the desired
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
        attributeFilter: normalizeAttributeFilter(options.attributeFilter),
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
     * Alias for `watchTarget`: shorter name for the desired
     * API direction. `watchTarget` is kept for back-compat
     * with the 3 modules (zoom, timecode, playall)
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
          logS(e);
          mcLogger?.error?.('MutationCoordinator', 'retry check failed', e);
        }

        if (attempts >= maxAttempts) {
          stopped = true;
          if (typeof onGiveUp === 'function') {
            try {
              onGiveUp();
            } catch (e) {
              logS(e);
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
     * @returns {{ rootSubscribers: number, rootObserverActive: boolean, managedTimers: number, paused: boolean }}
     */
    getStats() {
      return {
        rootSubscribers: rootSubscriptions.size,
        rootObserverActive: !!rootObserver,
        managedTimers: managedTimers.size,
        paused,
      };
    },

    /**
     * Signal-driven predicate activation. See the `whenRelevant`
     * function above for full documentation.
     */
    whenRelevant,

    /**
     * Settings-modal section enter/leave lifecycle. See the
     * `onSectionActive` function above for full documentation.
     */
    onSectionActive,

    /**
     * Pause mutation processing during SPA navigation.
     * Disconnects the observer and drops pending mutations.
     */
    pause,

    /**
     * Resume mutation processing after SPA navigation.
     */
    resume,

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
  // During YouTube SPA navigation we pause the coordinator on
  // yt-navigate-start and resume on yt-navigate-finish to avoid
  // processing mutations on the dying DOM.
  // `yt-navigate-finish` is left to per-module unsubscribe
  // calls (zoom, timecode, comment, endscreen, playall, music,
  // playlist-search all unsubscribe their own ids on teardown).
  // ---------------------------------------------------------------------------
  if (typeof window !== 'undefined' && window.YouTubePlusCleanupManager) {
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'pagehide',
      () => api.dispose(),
      undefined,
      true
    );
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'yt-navigate-start',
      pause,
      undefined,
      true
    );
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'yt-navigate-finish',
      resume,
      undefined,
      true
    );
  }

  if (typeof window !== 'undefined') {
    window.YouTubePlusMutationCoordinator = api;
  }
})();
