// DOM Query Cache: DOM query / wait / cache service.
//
// Responsibility: own the single source of truth for
// `querySelector` / `querySelectorAll` / `getElementById` /
// `waitForElement` so that the rest of the codebase does not
// touch the DOM through ad-hoc caches, ad-hoc intervals, or
// per-module MutationObservers.
//
// This module is *not* a feature lifecycle module and does not
// own feature-specific logic. It exposes a small, stable
// surface and defers everything else to mutation-coordinator
// (for shared observers) and the shared retry scheduler (for
// scoped-context waiting).
//
// Public API on `window.YouTubePlusDOMCache`:
//   - query(selector, ctx?)
//   - queryAll(selector, ctx?)
//   - byId(id)
//   - querySelector(selector, ctx?, skipCache?)
//   - querySelectorAll(selector, ctx?, skipCache?)
//   - getElementById(id)
//   - get(selector)                       // alias of querySelector
//   - getAll(selector)                    // alias of querySelectorAll
//   - waitForElement(selector, timeout?)
//   - invalidate(selector?)
//   - clear()
//   - getStats()
//   - destroy()
//
// Also exposed as `window.waitForElement` and on `window.YouTubeUtils`
// (`.domCache`, `.waitForElement`) for back-compat with modules
// that captured a reference before this module loaded.

(function () {
  const U = window.YouTubeUtils;
  /**
   * @param {unknown} err
   * @param {string} [label]
   */
  const logS = (err, label = undefined) => U?.logSuppressed?.(err, label || 'DOMCache');
  /**
   * DOM query service with single-element caching.
   *
   * Single-element results (`querySelector` / `getElementById`) are
   * cached with a TTL and validated on read (still connected AND
   * still matching the selector/id). List results
   * (`querySelectorAll`) are always queried fresh: a list cache
   * cannot be validated cheaply (middle removal, reordering and
   * insertions all leave first/last intact) and its benefit was
   * never measured.
   */
  class DOMCache {
    constructor() {
      /** @type {Map<string, {element: Element|null, selector?: string, context?: Element|Document|ShadowRoot, timestamp: number}>} */
      this.cache = new Map();
      this.maxAge = 5000; // Cache TTL for found elements: 5 s.
      this.nullMaxAge = 1000; // Cache TTL for null/empty results: 1 s.
      // Most modules react to DOM changes via MutationObserver or
      // yt-navigate-finish, so a 1-second stale window for "not
      // found" entries is safe and cuts repeated querySelector
      // calls by ~75 % for elements absent from the page.
      this.maxSize = 500; // Hard cap on cache entries (LRU eviction).
      this.cleanupSubId = null;
      this.cleanupPending = false;
      this.enabled = true;

      // Statistics
      this.stats = { hits: 0, misses: 0, evictions: 0 };

      this.contextUids = new WeakMap();
      this.uidCounter = 0;

      // Shared coordinator subscription for waitForElement.
      this.observerCallbacks = new Set();
      this.sharedObserverSubId = null;
      this.sharedObserverPending = false;

      // AbortControllers for in-flight waitForElement calls.
      // Cleared on SPA navigation so pending promises resolve early
      // and the garbage collector can reclaim their closures.
      /** @type {Set<AbortController>} */
      this.pendingWaits = new Set();

      // Start coordinator-coalesced cleanup.
      this.startCleanup();
    }

    /**
     * Remove all cached "not found" entries. Called aggressively on
     * `yt-navigate-start` so lookups on the freshly rendered page
     * are not blocked by stale null results.
     */
    clearNull() {
      for (const [key, value] of this.cache.entries()) {
        if (!value.element) this.cache.delete(key);
      }
    }

    /**
     * Abort every pending waitForElement promise and drop it from
     * the tracking set. Used on SPA navigation.
     */
    abortAllWaits() {
      for (const controller of this.pendingWaits) {
        try {
          controller.abort();
        } catch (_e) {
          logS(_e);
          // ignore
        }
      }
      this.pendingWaits.clear();
    }

    /**
     * @param {Element|Document} ctx
     * @returns {string|number}
     */
    getContextUid(ctx) {
      if (ctx === document) return 'doc';
      let uid = this.contextUids.get(ctx);
      if (!uid) {
        uid = ++this.uidCounter;
        this.contextUids.set(ctx, uid);
      }
      return uid;
    }

    /**
     * Read a cache entry, checking TTL, DOM presence, and (for elements)
     * whether the element still satisfies `verify`. isConnected alone is
     * not sufficient: an element that changed its class (or id) is still
     * connected yet fails the lookup.
     * Increments stats.hits on successful hit. Returns { hit: true, value: Element|null }
     * if the cache entry is valid, or { hit: false } if invalid or missing.
     * @param {string} cacheKey
     * @param {(element: Element) => boolean} [verify]
     * @returns {{ hit: true, value: Element|null } | { hit: false }}
     */
    /**
     * Context membership check that also works for ShadowRoot /
     * DocumentFragment contexts (no `.contains`): root-node identity.
     * @param {Element} element
     * @param {Element|Document|ShadowRoot} ctx
     * @returns {boolean}
     */
    _isInContext(element, ctx) {
      if (!(element && ctx)) return false;
      if (typeof ctx.contains === 'function') return ctx.contains(element);
      return element.getRootNode?.() === ctx;
    }

    /**
     * Read a cache entry, checking TTL, DOM presence, (for elements)
     * whether the element still satisfies `verify`, and whether it is still
     * inside the context it was queried for. A node
     * moved to another container must never be served for its prior context.
     * Policy note: between mutation batches a hit can lag behind a NEW
     * earlier match; the sweep revalidates first-match semantics per
     * entry (see `revalidate`), so the window is bounded by the idle
     * sweep, not by the 5s TTL.
     * Increments stats.hits on successful hit. Returns { hit: true, value: Element|null }
     * if the cache entry is valid, or { hit: false } if invalid or missing.
     * @param {string} cacheKey
     * @param {(element: Element) => boolean} [verify]
     * @returns {{ hit: true, value: Element|null } | { hit: false }}
     */
    _readCached(cacheKey, verify) {
      const cached = this.cache.get(cacheKey);
      if (!cached) return { hit: false };
      const ttl = cached.element ? this.maxAge : this.nullMaxAge;
      if (Date.now() - cached.timestamp >= ttl) return { hit: false };
      if (cached.element) {
        if (!this.isElementInDOM(cached.element)) return { hit: false };
        if (cached.context && !this._isInContext(cached.element, cached.context)) {
          return { hit: false };
        }
        if (verify && !verify(cached.element)) return { hit: false };
      }
      this.stats.hits++;
      return { hit: true, value: cached.element ?? null };
    }

    /**
     * Get single element with caching.
     * @param {string} selector
     * @param {Element|Document} [context=document]
     * @param {boolean} [skipCache=false]
     * @returns {Element|null}
     */
    querySelector(selector, context = document, skipCache = false) {
      this.startCleanup(); // Self-heals the coordinator subscription if the cache was built before the coordinator loaded.
      if (!this.enabled || skipCache) {
        return context.querySelector(selector);
      }

      const cacheKey = `${selector}::${this.getContextUid(context)}`;
      const readResult = this._readCached(cacheKey, el => el.matches(selector));
      if (readResult.hit) return readResult.value;

      this.stats.misses++;

      // LRU eviction if cache too large.
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) this.cache.delete(firstKey);
        this.stats.evictions++;
      }

      const element = context.querySelector(selector);
      // remember WHAT was queried and WHERE so the sweep can verify
      // the entry still answers the same (selector, context) question.
      this.cache.set(cacheKey, {
        element,
        selector,
        context,
        timestamp: Date.now(),
      });
      return element;
    }

    /**
     * Get multiple elements with caching.
     * @param {string} selector
     * @param {Element|Document} [context=document]
     * @param {boolean} [skipCache=false]
     * @returns {Element[]}
     */
    querySelectorAll(selector, context = document, skipCache = false) {
      // ponytail: always a direct query. A multi-cache
      // validated only first/last connectivity, so middle removal,
      // reordering, insertions, and attr changes all returned stale
      // lists; the cache's benefit was never measured, so a fresh
      // query is the correct and simplest behavior.
      void skipCache;
      this.startCleanup();
      return Array.from(context.querySelectorAll(selector));
    }

    /**
     * Get element by ID with caching.
     * @param {string} id
     * @returns {Element|null}
     */
    getElementById(id) {
      this.startCleanup();
      if (!this.enabled) {
        return /** @type {Element|null} */ (document.getElementById(id));
      }

      const cacheKey = `ID::${id}`;
      const readResult = this._readCached(cacheKey, el => el.id === id);
      if (readResult.hit) return readResult.value;

      const element = /** @type {Element|null} */ (document.getElementById(id));
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.delete(firstKey);
          this.stats.evictions++;
        }
      }
      this.cache.set(cacheKey, {
        element,
        selector: `#${id}`,
        context: document,
        timestamp: Date.now(),
      });
      return element;
    }

    // -------------------------------------------------------------------------
    // Aliases: same behavior, shorter or alternative names.
    // These are real methods on the class so the runtime instance
    // and the typed `YouTubePlusDOMCacheAPI` surface stay in lockstep.
    // -------------------------------------------------------------------------

    /**
     * Alias of `querySelector`.
     * @param {string} selector
     * @param {Element|Document} [context]
     * @returns {Element|null}
     */
    query(selector, context) {
      return this.querySelector(selector, context);
    }

    /**
     * Alias of `querySelectorAll`.
     * @param {string} selector
     * @param {Element|Document} [context]
     * @returns {Element[]}
     */
    queryAll(selector, context) {
      return this.querySelectorAll(selector, context);
    }

    /**
     * Alias of `getElementById`.
     * @param {string} id
     * @returns {Element|null}
     */
    byId(id) {
      return this.getElementById(id);
    }

    /**
     * Legacy alias of `querySelector` with no context. Kept for
     * the 6+ test mocks and the few legacy callers that still
     * use the short name.
     * @param {string} selector
     * @returns {Element|null}
     */
    get(selector) {
      return this.querySelector(selector);
    }

    /**
     * Legacy alias of `querySelectorAll` with no context.
     * @param {string} selector
     * @returns {Element[]}
     */
    getAll(selector) {
      return this.querySelectorAll(selector);
    }

    /**
     * Wait for an element to appear in the DOM. Delegates to
     * the module-level implementation. Exposed as a class
     * method so `window.YouTubePlusDOMCache.waitForElement(...)` is
     * a real method on the typed `YouTubePlusDOMCacheAPI` surface.
     * @param {string} selector
     * @param {number} [timeout]
     * @param {Element|Document} [context] - Root to search within; defaults to `document`
     * @param {AbortSignal} [signal]
     * @returns {Promise<Element|null>}
     */
    waitForElement(selector, timeout, context, signal) {
      return waitForElementImpl(selector, timeout, context ?? document, signal);
    }

    /**
     * Check if element is still in DOM.
     * @param {Element|null|undefined} element
     * @returns {boolean}
     */
    isElementInDOM(element) {
      return !!(element && document.contains(element));
    }

    /**
     * Invalidate cache for a specific selector (substring match)
     * or the entire cache when no selector is given.
     * @param {string} [selector]
     */
    invalidate(selector) {
      if (selector) {
        for (const key of this.cache.keys()) {
          if (key.includes(selector)) this.cache.delete(key);
        }
      } else {
        this.clear();
      }
    }

    /**
     * Freshness sweep. Revalidates every cached entry against its
     * recorded (selector, context) pair and drops entries that do not
     * answer it (see `_isEntryFresh` for the exact rules). Called on every
     * mutation batch (idle-coalesced by the coordinator subscription) and
     * available synchronously for tests/diagnostics.
     */
    revalidate() {
      for (const [key, entry] of this.cache.entries()) {
        if (!this._isEntryFresh(entry)) this.cache.delete(key);
      }
    }

    /**
     * Freshness rules for ONE cache entry:
     *   - TTL expired → stale;
     *   - cached NULL → stale when the lookup now succeeds;
     *   - element detached, moved out of its context, or not the
     *     first match in that context (a new earlier match shadows it).
     * @param {{element: Element|null, selector?: string, context?: Element|Document|ShadowRoot, timestamp: number}} entry
     * @returns {boolean} true when the entry may stay cached
     */
    _isEntryFresh(entry) {
      const ttl = entry.element ? this.maxAge : this.nullMaxAge;
      if (Date.now() - entry.timestamp >= ttl) return false;
      if (!entry.element) {
        // A cached null: drop it if the lookup now succeeds.
        if (entry.selector && this._queryFirst(entry) != null) return false;
        return true;
      }
      if (!this.isElementInDOM(entry.element)) return false;
      if (entry.context && !this._isInContext(entry.element, entry.context)) return false;
      // First-match revalidation: a new earlier match inside the context
      // must shadow the cached node.
      if (entry.selector && this._queryFirst(entry) !== entry.element) return false;
      return true;
    }

    /**
     * Re-run the native lookup recorded with an entry.
     * @param {{selector?: string, context?: Element|Document|ShadowRoot}} entry
     * @returns {Element|null}
     */
    _queryFirst(entry) {
      if (!(entry.selector && entry.context)) return null;
      const ctx = /** @type {ParentNode} */ (entry.context);
      try {
        return ctx.querySelector(entry.selector);
      } catch (_e) {
        logS(_e, 'DOMCache:_queryFirst');
        return null;
      }
    }

    /**
     * Clear the entire cache.
     */
    clear() {
      this.cache.clear();
    }

    /**
     * Start periodic cache cleanup on the mutation coordinator.
     * Single subscription per cache; per-frame work is bounded
     * by `maxSize`, so no per-run budget is needed.
     */
    startCleanup() {
      if (this.cleanupSubId) return;

      const cleanupFn = () => {
        // The mutation batch drives the freshness sweep; TTL-only
        // purging left shadowed/moved entries cached until their TTL.
        this.revalidate();
      };

      const coordinator = window.YouTubePlusMutationCoordinator;
      if (!coordinator?.subscribeRoot) return;

      this.cleanupSubId = coordinator.subscribeRoot(
        'dom-cache::cleanup',
        () => {
          if (this.cleanupPending) return;
          this.cleanupPending = true;

          const run = () => {
            this.cleanupPending = false;
            cleanupFn();
          };

          if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(run, { timeout: 1000 });
          } else {
            setTimeout(run, 0);
          }
        },
        { childList: true, attributes: true, subtree: true }
      );

      // The coordinator subscription is session infrastructure: it must
      // survive the per-navigation cleanupManager.cleanup() sweep, which would
      // otherwise unsubscribe it and kill the TTL eviction sweep. destroy() is
      // the only unsubscribe.
    }

    /**
     * Stop cache cleanup and clear all caches.
     */
    destroy() {
      if (this.cleanupSubId && window.YouTubePlusMutationCoordinator?.unsubscribe) {
        window.YouTubePlusMutationCoordinator.unsubscribe(this.cleanupSubId);
        this.cleanupSubId = null;
      }
      this.cleanupPending = false;
      this.clear();
      this.abortAllWaits();
      if (this.sharedObserverSubId && window.YouTubePlusMutationCoordinator?.unsubscribe) {
        window.YouTubePlusMutationCoordinator.unsubscribe(this.sharedObserverSubId);
        this.sharedObserverSubId = null;
      }
      this.observerCallbacks.clear();
    }

    /**
     * Get cache statistics.
     * @returns {{size: number, enabled: boolean}}
     */
    getStats() {
      return {
        size: this.cache.size,
        enabled: this.enabled,
      };
    }

    /**
     * Initialize the shared observer used by `waitForElement`
     * for the document / body context. The observer is a
     * MutationCoordinator subscription so the entire codebase
     * shares a single underlying MutationObserver.
     */
    initSharedObserver() {
      if (this.sharedObserverSubId) return;

      const coordinator = window.YouTubePlusMutationCoordinator;
      if (!coordinator?.subscribeRoot) return;

      this.sharedObserverSubId = coordinator.subscribeRoot(
        'dom-cache::waitForElementShared',
        () => {
          if (this.observerCallbacks.size === 0) return;
          if (this.sharedObserverPending) return;

          this.sharedObserverPending = true;
          const flush = () => {
            this.sharedObserverPending = false;
            for (const callback of this.observerCallbacks) {
              try {
                callback();
              } catch (e) {
                logS(e);
                if (typeof window !== 'undefined' && U?.logError) {
                  U.logError('DOMCache', 'Observer callback error', e);
                }
              }
            }
          };

          if (typeof requestAnimationFrame === 'function') {
            // lint:custom:ignore rAF id passed to registerAnimationFrame below
            const rafId = requestAnimationFrame(flush);
            if (window.YouTubePlusCleanupManager?.registerAnimationFrame) {
              window.YouTubePlusCleanupManager.registerAnimationFrame(rafId, {
                scope: 'session',
              });
            } else {
              setTimeout(flush, 0);
            }
          } else {
            setTimeout(flush, 0);
          }
        }
      );
    }
  }

  // -------------------------------------------------------------------------
  // Module-level `waitForElement` implementation.
  //
  // Kept as a module-level function (not a class method) so the
  // class method can call it without recursing into itself, and
  // so the `window.waitForElement` global can be exported as a
  // plain function rather than a bound class method.
  // -------------------------------------------------------------------------

  /**
   * Poll a check function on a fixed interval until it returns
   * true or the timeout expires. Used for contexts where
   * MutationObserver is too expensive (heavy playlist pages)
   * or when the shared observer / retry scheduler is not
   * available. Tracks the interval with the cleanup manager.
   * @param {() => boolean} check
   * @param {number} timeout
   * @param {number} interval
   * @param {() => void} onTimeout
   * @param {AbortSignal} [signal]
   */
  function pollUntil(check, timeout, interval, onTimeout, signal) {
    const start = Date.now();
    const id = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(id);
        return;
      }
      if (check()) {
        clearInterval(id);
        return;
      }
      if (Date.now() - start >= timeout) {
        clearInterval(id);
        onTimeout();
      }
    }, interval);
    window.YouTubePlusCleanupManager?.registerInterval?.(id, {
      scope: 'session',
    });
    if (signal) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        signal,
        'abort',
        () => clearInterval(id),
        { once: true },
        false
      );
    }
    if (typeof window !== 'undefined' && U?.cleanupManager?.registerInterval) {
      U.cleanupManager.registerInterval(id);
    }
  }

  /**
   * Create the abortable wait state shared by all waitForElement
   * strategies. Returns an AbortController registered with the cache
   * and a `finish` resolver that cleans it up. If `signal` is already
   * aborted, the returned `aborted` flag is true and `finish(null)`
   * has been called.
   * @param {(value: Element|null) => void} resolve
   * @param {DOMCache|null} cache
   * @param {AbortSignal|null} signal
   * @returns {{ controller: AbortController, finish: (value: Element|null) => void, aborted: boolean }}
   */
  function createWaitState(resolve, cache, signal) {
    const controller = new AbortController();
    if (cache) cache.pendingWaits.add(controller);

    let settled = false;
    /**
     * @param {Element|null} value
     */
    const finish = value => {
      if (settled) return;
      settled = true;
      if (cache) cache.pendingWaits.delete(controller);
      controller.abort();
      resolve(value);
    };

    window.YouTubePlusCleanupManager?.registerListener?.(
      controller.signal,
      'abort',
      () => finish(null),
      { once: true },
      false
    );

    if (signal) {
      if (signal.aborted) {
        finish(null);
        return { controller, finish, aborted: true };
      }
      window.YouTubePlusCleanupManager?.registerListener?.(
        signal,
        'abort',
        () => controller.abort(),
        { once: true },
        false
      );
    }

    return { controller, finish, aborted: false };
  }

  /**
   * Run a retry scheduler factory for a scoped wait and wire abort.
   * @param {(opts: { check: () => boolean; maxAttempts?: number; interval?: number; onGiveUp?: () => void; label?: string }) => { stop: () => void } | null} factory
   * @param {() => boolean} check
   * @param {number} timeout
   * @param {AbortController} controller
   * @param {(value: Element|null) => void} finish
   */
  function runRetryScheduler(factory, check, timeout, controller, finish) {
    const retry = factory({
      interval: 120,
      maxAttempts: Math.max(1, Math.ceil(timeout / 120)),
      check,
      onGiveUp: () => finish(null),
    });
    window.YouTubePlusCleanupManager?.registerListener?.(
      controller.signal,
      'abort',
      () => {
        if (retry && typeof retry.stop === 'function') retry.stop();
        finish(null);
      },
      { once: true },
      false
    );
  }

  /**
   * True on the /playlist route. A MutationObserver over the whole playlist
   * subtree is prohibitively expensive there, so the root wait polls instead.
   * @returns {boolean}
   */
  function isPlaylistRootPage() {
    return (
      typeof window !== 'undefined' &&
      window.location &&
      typeof window.location.pathname === 'string' &&
      window.location.pathname === '/playlist'
    );
  }

  /**
   * Root-context wait through the shared MutationCoordinator observer: one
   * subscription shared by every caller, plus one timeout for this call.
   * @param {DOMCache|null} cache
   * @param {() => boolean} check
   * @param {number} timeout
   * @param {AbortController} controller
   * @param {(value: Element|null) => void} finish
   */
  function waitRootViaSharedObserver(cache, check, timeout, controller, finish) {
    if (!cache) return;
    cache.initSharedObserver();
    cache.observerCallbacks.add(check);
    const cleanup = () => {
      cache.observerCallbacks.delete(check);
    };
    window.YouTubePlusCleanupManager?.registerListener?.(
      controller.signal,
      'abort',
      cleanup,
      { once: true },
      false
    );
    const giveUp = () => {
      cleanup();
      finish(null);
    };
    if (U?.cleanupManager?.timeout) U.cleanupManager.timeout(giveUp, timeout);
    else setTimeout(giveUp, timeout);
  }

  /**
   * Retry factory for a scoped wait: the shared `U.createRetryScheduler` when
   * available, otherwise the coordinator's managed-timer scheduler.
   * @returns {((opts: { check: () => boolean; maxAttempts?: number; interval?: number; onGiveUp?: () => void; label?: string }) => { stop: () => void } | null) | null}
   */
  function resolveRetryFactory() {
    if (typeof U?.createRetryScheduler === 'function') return U.createRetryScheduler;
    const coordinator =
      typeof window !== 'undefined' ? window.YouTubePlusMutationCoordinator : null;
    if (coordinator && typeof coordinator.createRetryScheduler === 'function') {
      return opts => coordinator.createRetryScheduler(opts);
    }
    return null;
  }

  /**
   * Wait for an element matching `selector` to appear in `context`. Resolves as
   * soon as the element appears, or with null on timeout or abort. Strategy
   * depends on the context: the element may already exist (fast path); a root
   * context polls on /playlist and uses the shared observer elsewhere; a scoped
   * context uses the retry scheduler, falling back to polling.
   *
   * @param {string} selector
   * @param {number} [timeout=5000]
   * @param {Element|Document} [context=document]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<Element|null>}
   */
  function waitForElementImpl(selector, timeout = 5000, context = document, signal = null) {
    return new Promise(resolve => {
      if (signal?.aborted) {
        resolve(null);
        return;
      }

      const existing = context.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const cache = /** @type {DOMCache} */ (/** @type {unknown} */ (window.YouTubePlusDOMCache));
      const { controller, finish, aborted } = createWaitState(resolve, cache, signal);
      if (aborted) return;

      // Resolves the promise and returns true on the first hit.
      const check = () => {
        if (controller.signal.aborted) return true;
        const element = context.querySelector(selector);
        if (element) {
          finish(element);
          return true;
        }
        return false;
      };

      const isRoot = context === document || context === document.body;
      if (isRoot && isPlaylistRootPage()) {
        pollUntil(check, timeout, 250, () => finish(null), controller.signal);
        return;
      }
      if (isRoot) {
        waitRootViaSharedObserver(cache, check, timeout, controller, finish);
        return;
      }

      const retryFactory = resolveRetryFactory();
      if (retryFactory) {
        runRetryScheduler(retryFactory, check, timeout, controller, finish);
        return;
      }

      pollUntil(check, timeout, 120, () => finish(null), controller.signal);
    });
  }

  // Create the singleton cache instance.
  const globalCache = new DOMCache();

  // Export to global namespace.
  if (typeof window !== 'undefined') {
    window.YouTubePlusDOMCache = globalCache;
    /**
     * @type {(selector: string, timeout?: number, signal?: AbortSignal) => Promise<Element | null>}
     */
    const waitForElementGlobal = (selector, timeout, signal) =>
      waitForElementImpl(selector, timeout, document, signal);
    window.waitForElement = waitForElementGlobal;

    // Also add to YouTubeUtils for the legacy adapter surface.
    if (U) {
      U.domCache = globalCache;
      Object.defineProperty(U, 'waitForElement', {
        configurable: false,
        enumerable: true,
        get() {
          return (
            /** @type {string} */ selector,
            /** @type {number} */ timeout,
            /** @type {AbortSignal} */ signal
          ) => waitForElementImpl(selector, timeout, document, signal);
        },
        set() {},
      });
    }
  }

  // Invalidate the cache on navigation. `yt-navigate-start`
  // aggressively drops stale "not found" entries so new-page lookups
  // are fresh; `yt-navigate-finish` / `spfdone` clear the rest.
  if (typeof window !== 'undefined' && window.YouTubePlusCleanupManager) {
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'yt-navigate-start',
      () => {
        globalCache.clearNull();
        globalCache.abortAllWaits();
      },
      undefined,
      true
    );
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'yt-navigate-finish',
      () => {
        globalCache.invalidate();
      },
      undefined,
      true
    );
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'spfdone',
      () => {
        globalCache.invalidate();
      },
      undefined,
      true
    );
  }

  // Cleanup on unload so the MutationCoordinator subscription
  // does not leak across hot-reload boundaries.
  if (typeof window !== 'undefined' && window.YouTubePlusCleanupManager) {
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'beforeunload',
      () => {
        globalCache.destroy();
      },
      undefined,
      true
    );
  }
})();
