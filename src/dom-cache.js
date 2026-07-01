// DOM Query Cache — canonical DOM query / wait / cache service.
//
// Canonical responsibility: own the single source of truth for
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
   * High-performance DOM query cache with automatic invalidation.
   * Reduces repeated querySelector calls by caching results, with
   * a small TTL window for "not found" entries so we do not hammer
   * querySelector for elements that are absent from the page.
   */
  class DOMCache {
    constructor() {
      /** @type {Map<string, {element: Element|null, timestamp: number}>} */
      this.cache = new Map();
      /** @type {Map<string, Element[]>} */
      this.multiCache = new Map();
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

      // Start coordinator-coalesced cleanup.
      this.startCleanup();
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
     * Get single element with caching.
     * @param {string} selector
     * @param {Element|Document} [context=document]
     * @param {boolean} [skipCache=false]
     * @returns {Element|null}
     */
    querySelector(selector, context = document, skipCache = false) {
      if (!this.enabled || skipCache) {
        return context.querySelector(selector);
      }

      const cacheKey = `${selector}::${this.getContextUid(context)}`;
      const cached = this.cache.get(cacheKey);

      if (cached) {
        // TTL depends on whether we have a live element or a stale
        // "not found" entry. Live elements get the longer TTL.
        const ttl = cached.element ? this.maxAge : this.nullMaxAge;
        const now = Date.now();

        if (now - cached.timestamp < ttl) {
          if (cached.element) {
            if (this.isElementInDOM(cached.element)) {
              this.stats.hits++;
              return cached.element;
            }
          } else {
            this.stats.hits++;
            return null;
          }
        }
      }

      this.stats.misses++;

      // LRU eviction if cache too large.
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) this.cache.delete(firstKey);
        this.stats.evictions++;
      }

      const element = context.querySelector(selector);
      this.cache.set(cacheKey, { element, timestamp: Date.now() });
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
      if (!this.enabled || skipCache) {
        return Array.from(context.querySelectorAll(selector));
      }

      const cacheKey = `ALL::${selector}::${this.getContextUid(context)}`;
      const cached = this.multiCache.get(cacheKey);
      if (cached && this.areElementsValid(cached)) {
        return cached;
      }

      const elements = Array.from(context.querySelectorAll(selector));
      this.multiCache.set(cacheKey, elements);
      return elements;
    }

    /**
     * Get element by ID with caching.
     * @param {string} id
     * @returns {Element|null}
     */
    getElementById(id) {
      if (!this.enabled) {
        return /** @type {Element|null} */ (document.getElementById(id));
      }

      const cacheKey = `ID::${id}`;
      const cached = this.cache.get(cacheKey);

      if (cached) {
        const ttl = cached.element ? this.maxAge : this.nullMaxAge;
        const now = Date.now();

        if (now - cached.timestamp < ttl) {
          if (cached.element) {
            if (this.isElementInDOM(cached.element)) {
              return cached.element;
            }
          } else {
            return null;
          }
        }
      }

      const element = /** @type {Element|null} */ (document.getElementById(id));
      this.cache.set(cacheKey, { element, timestamp: Date.now() });
      return element;
    }

    // -------------------------------------------------------------------------
    // Aliases — same behavior, shorter or alternative names.
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
     * @returns {Promise<Element|null>}
     */
    waitForElement(selector, timeout) {
      return waitForElementImpl(selector, timeout, document);
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
     * Check if a cached list is still valid. Samples the first
     * and last element for performance — losing a middle entry
     * to garbage collection is acceptable because the next
     * querySelectorAll call will rebuild the cache.
     * @param {Element[]} elements
     * @returns {boolean}
     */
    areElementsValid(elements) {
      if (!elements || elements.length === 0) return false;
      return this.isElementInDOM(elements[0]) && this.isElementInDOM(elements[elements.length - 1]);
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
        for (const key of this.multiCache.keys()) {
          if (key.includes(selector)) this.multiCache.delete(key);
        }
      } else {
        this.clear();
      }
    }

    /**
     * Clear the entire cache.
     */
    clear() {
      this.cache.clear();
      this.multiCache.clear();
    }

    /**
     * Start periodic cache cleanup on the mutation coordinator.
     * Single subscription per cache; per-frame work is bounded
     * by `maxSize`, so no per-run budget is needed.
     */
    startCleanup() {
      if (this.cleanupSubId) return;

      const cleanupFn = () => {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
          if (
            now - value.timestamp > this.maxAge ||
            (value.element && !this.isElementInDOM(value.element))
          ) {
            this.cache.delete(key);
          }
        }
        // multiCache entries are rebuilt on the next call, so
        // we only evict the all-empty ones (which we never
        // actually cache) and any whose first/last element is
        // no longer in the DOM. Cheaper than per-entry timers.
        for (const [key, value] of this.multiCache.entries()) {
          if (!this.areElementsValid(value)) {
            this.multiCache.delete(key);
          }
        }
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

      if (this.cleanupSubId && U?.cleanupManager?.register) {
        U.cleanupManager.register(() => {
          if (this.cleanupSubId && window.YouTubePlusMutationCoordinator?.unsubscribe) {
            window.YouTubePlusMutationCoordinator.unsubscribe(this.cleanupSubId);
            this.cleanupSubId = null;
          }
          this.cleanupPending = false;
        });
      }
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
      if (this.sharedObserverSubId && window.YouTubePlusMutationCoordinator?.unsubscribe) {
        window.YouTubePlusMutationCoordinator.unsubscribe(this.sharedObserverSubId);
        this.sharedObserverSubId = null;
      }
      this.observerCallbacks.clear();
    }

    /**
     * Get cache statistics.
     * @returns {{size: number, multiSize: number, enabled: boolean}}
     */
    getStats() {
      return {
        size: this.cache.size,
        multiSize: this.multiCache.size,
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
                if (typeof window !== 'undefined' && U?.logError) {
                  U.logError('DOMCache', 'Observer callback error', e);
                }
              }
            }
          };

          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(flush);
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
   */
  function pollUntil(check, timeout, interval, onTimeout) {
    const start = Date.now();
    const id = setInterval(() => {
      if (check()) {
        clearInterval(id);
        return;
      }
      if (Date.now() - start >= timeout) {
        clearInterval(id);
        onTimeout();
      }
    }, interval);
    if (typeof window !== 'undefined' && U?.cleanupManager?.registerInterval) {
      U.cleanupManager.registerInterval(id);
    }
  }

  /**
   * Wait for an element matching `selector` to appear in
   * `context`. Strategy depends on the context:
   *
   *   1. Immediate check — fast path when the element is
   *      already in the DOM.
   *   2. Playlist page + root context — interval polling.
   *      MutationObserver on a /playlist subtree is
   *      prohibitively expensive, so we trade reactivity for
   *      cost by polling at 250 ms.
   *   3. Other root context (document / body) — the shared
   *      observer: a single MutationCoordinator subscription
   *      shared by every `waitForElement` caller.
   *   4. Scoped context (any other element) — the shared
   *      retry scheduler (`YouTubeUtils.createRetryScheduler`),
   *      which polls at 120 ms and uses `onGiveUp` for the
   *      overall timeout. No parallel setTimeout — that was
   *      the redundant race the refactor removes.
   *   5. Last-resort interval polling when no retry scheduler
   *      is registered.
   *
   * @param {string} selector
   * @param {number} [timeout=5000]
   * @param {Element|Document} [context=document]
   * @returns {Promise<Element|null>}
   */
  function waitForElementImpl(selector, timeout = 5000, context = document) {
    return new Promise(resolve => {
      const existing = context.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      // `check` resolves the promise and returns true on first
      // hit. Used by all three reactive strategies below.
      const check = () => {
        const element = context.querySelector(selector);
        if (element) {
          resolve(element);
          return true;
        }
        return false;
      };

      const isRoot = context === document || context === document.body;
      const isPlaylistPage =
        typeof window !== 'undefined' &&
        window.location &&
        typeof window.location.pathname === 'string' &&
        window.location.pathname === '/playlist';

      // (2) Playlist page root: polling. MutationObserver on a
      // heavy /playlist subtree is prohibitively expensive.
      if (isPlaylistPage && isRoot) {
        pollUntil(check, timeout, 250, () => resolve(null));
        return;
      }

      // (3) Other root contexts: shared observer. The
      // MutationCoordinator subscription is shared across the
      // entire codebase, so we add a single check callback and
      // a single timeout for this call.
      if (isRoot) {
        const cache = window.YouTubePlusDOMCache;
        if (cache) {
          cache.initSharedObserver();
          cache.observerCallbacks.add(check);
          const timeoutId = setTimeout(() => {
            cache.observerCallbacks.delete(check);
            resolve(null);
          }, timeout);
          if (U?.cleanupManager?.registerTimeout) {
            U.cleanupManager.registerTimeout(timeoutId);
          }
        }
        return;
      }

      // (4) Scoped context: retry scheduler. Its built-in
      // `onGiveUp` callback handles the overall timeout, so
      // we no longer race a parallel setTimeout against it.
      const retryFactory = U?.createRetryScheduler;
      if (typeof retryFactory === 'function') {
        retryFactory({
          interval: 120,
          maxAttempts: Math.max(1, Math.ceil(timeout / 120)),
          check,
          onGiveUp: () => resolve(null),
        });
        return;
      }

      // (5) Last-resort fallback for scoped contexts when the
      // shared retry scheduler is not registered. Prefer the
      // MutationCoordinator's managed-timer retry over raw
      // setInterval so cleanup is handled on coordinator dispose.
      const coordinator =
        typeof window !== 'undefined'
          ? /** @type {any} */ (window).YouTubePlusMutationCoordinator
          : null;
      if (coordinator && typeof coordinator.createRetryScheduler === 'function') {
        coordinator.createRetryScheduler({
          interval: 120,
          maxAttempts: Math.max(1, Math.ceil(timeout / 120)),
          check,
          onGiveUp: () => resolve(null),
        });
        return;
      }

      // (5b) Extreme fallback when neither retry scheduler nor
      // coordinator is available. Still registers via cleanupManager.
      pollUntil(check, timeout, 120, () => resolve(null));
    });
  }

  // Create the singleton cache instance.
  const globalCache = new DOMCache();

  // Export to global namespace.
  if (typeof window !== 'undefined') {
    window.YouTubePlusDOMCache = globalCache;
    /**
     * @type {(selector: string, timeout?: number) => Promise<Element | null>}
     */
    const waitForElementGlobal = (selector, timeout) =>
      waitForElementImpl(selector, timeout, document);
    window.waitForElement = waitForElementGlobal;
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusDOMCache = globalCache;
      unsafeWindow.waitForElement = waitForElementGlobal;
    }

    // Also add to YouTubeUtils for the legacy adapter surface.
    if (U) {
      U.domCache = globalCache;
      Object.defineProperty(U, 'waitForElement', {
        configurable: false,
        enumerable: true,
        get() {
          return (/** @type {string} */ selector, /** @type {number} */ timeout) =>
            waitForElementImpl(selector, timeout, document);
        },
        set() {},
      });
    }
  }

  // Invalidate the entire cache on navigation. This keeps the
  // cache coherent with YouTube's SPA route changes.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('yt-navigate-finish', () => {
      globalCache.invalidate();
    });
    window.addEventListener('spfdone', () => {
      globalCache.invalidate();
    });
  }

  // Cleanup on unload so the MutationCoordinator subscription
  // does not leak across hot-reload boundaries.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', () => {
      globalCache.destroy();
    });
  }
})();
