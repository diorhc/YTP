// DOM Query Cache System - Performance Optimization (Enhanced)
(function () {
  'use strict';

  /**
   * High-performance DOM query cache with automatic invalidation
   * Reduces repeated querySelector calls by caching results
   */
  class DOMCache {
    constructor() {
      /** @type {Map<string, {element: Element|null, timestamp: number}>} */
      this.cache = new Map();
      /** @type {Map<string, NodeList|Element[]>} */
      this.multiCache = new Map();
      this.maxAge = 5000; // Cache TTL: 5 seconds
      this.nullMaxAge = 250; // Cache TTL for null/empty results: 250ms
      this.maxSize = 500; // Max cache entries
      this.cleanupInterval = null;
      this.enabled = true;

      // Statistics
      this.stats = { hits: 0, misses: 0, evictions: 0 };

      this.contextUids = new WeakMap();
      this.uidCounter = 0;

      // Shared MutationObserver for waitForElement
      this.observerCallbacks = new Set();
      this.sharedObserver = null;
      this.sharedObserverPending = false;

      // Start periodic cleanup
      this.startCleanup();
    }

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
     * Get single element with caching
     * @param {string} selector - CSS selector
     * @param {Element|Document} [context=document] - Context element
     * @param {boolean} [skipCache=false] - Skip cache and force fresh query
     * @returns {Element|null}
     */
    querySelector(selector, context = document, skipCache = false) {
      if (!this.enabled || skipCache) {
        return context.querySelector(selector);
      }

      const cacheKey = `${selector}::${this.getContextUid(context)}`;
      const cached = this.cache.get(cacheKey);
      const now = Date.now();

      // Determine TTL based on cached value
      const ttl = cached && cached.element ? this.maxAge : this.nullMaxAge;

      // Return cached result if valid and element still in DOM
      if (cached && now - cached.timestamp < ttl) {
        if (cached.element) {
          if (this.isElementInDOM(cached.element)) {
            this.stats.hits++;
            return cached.element;
          }
        } else {
          // Return cached null
          this.stats.hits++;
          return null;
        }
      }

      // Track miss
      this.stats.misses++;

      // LRU eviction if cache too large
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
        this.stats.evictions++;
      }

      // Query and cache
      const element = context.querySelector(selector);
      this.cache.set(cacheKey, { element, timestamp: now });
      return element;
    }

    /**
     * Get multiple elements with caching
     * @param {string} selector - CSS selector
     * @param {Element|Document} [context=document] - Context element
     * @param {boolean} [skipCache=false] - Skip cache and force fresh query
     * @returns {NodeList|Element[]}
     */
    querySelectorAll(selector, context = document, skipCache = false) {
      if (!this.enabled || skipCache) {
        return context.querySelectorAll(selector);
      }

      const cacheKey = `ALL::${selector}::${this.getContextUid(context)}`;
      const cached = this.multiCache.get(cacheKey);

      if (cached && this.areElementsValid(cached)) {
        return cached;
      }

      const elements = Array.from(context.querySelectorAll(selector));
      this.multiCache.set(cacheKey, elements);

      // Auto-cleanup after maxAge or nullMaxAge
      const ttl = elements.length > 0 ? this.maxAge : this.nullMaxAge;
      setTimeout(() => this.multiCache.delete(cacheKey), ttl);

      return elements;
    }

    /**
     * Get element by ID with caching
     * @param {string} id - Element ID
     * @returns {Element|null}
     */
    getElementById(id) {
      if (!this.enabled) {
        return document.getElementById(id);
      }

      const cacheKey = `ID::${id}`;
      const cached = this.cache.get(cacheKey);
      const now = Date.now();

      if (cached && now - cached.timestamp < this.maxAge) {
        if (cached.element && this.isElementInDOM(cached.element)) {
          return cached.element;
        }
      }

      const element = document.getElementById(id);
      this.cache.set(cacheKey, { element, timestamp: now });
      return element;
    }

    /**
     * Check if element is still in DOM
     * @param {Element} element
     * @returns {boolean}
     */
    isElementInDOM(element) {
      return element && document.contains(element);
    }

    /**
     * Check if cached elements are still valid
     * @param {Element[]} elements
     * @returns {boolean}
     */
    areElementsValid(elements) {
      if (!elements || elements.length === 0) return true;
      // Sample first and last elements for performance
      return this.isElementInDOM(elements[0]) && this.isElementInDOM(elements[elements.length - 1]);
    }

    /**
     * Invalidate cache for specific selector or all
     * @param {string} [selector] - Specific selector to invalidate
     */
    invalidate(selector) {
      if (selector) {
        // Invalidate specific selector
        for (const key of this.cache.keys()) {
          if (key.includes(selector)) {
            this.cache.delete(key);
          }
        }
        for (const key of this.multiCache.keys()) {
          if (key.includes(selector)) {
            this.multiCache.delete(key);
          }
        }
      } else {
        // Clear all cache
        this.cache.clear();
        this.multiCache.clear();
      }
    }

    /**
     * Start periodic cache cleanup
     */
    startCleanup() {
      if (this.cleanupInterval) return;

      // Use requestIdleCallback if available for cleanup to avoid blocking main thread
      const cleanupFn = () => {
        const now = Date.now();
        let deletedCount = 0;
        const maxDeletesPerRun = 50; // Limit work per frame

        // Cleanup single element cache
        for (const [key, value] of this.cache.entries()) {
          if (
            now - value.timestamp > this.maxAge ||
            (value.element && !this.isElementInDOM(value.element))
          ) {
            this.cache.delete(key);
            deletedCount++;
            if (deletedCount >= maxDeletesPerRun) break;
          }
        }
      };

      this.cleanupInterval = setInterval(() => {
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(cleanupFn, { timeout: 1000 });
        } else {
          cleanupFn();
        }
      }, 5000); // Run every 5 seconds
    }

    /**
     * Stop cache cleanup and clear all caches
     */
    destroy() {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
      this.cache.clear();
      this.multiCache.clear();
      if (this.sharedObserver) {
        this.sharedObserver.disconnect();
        this.sharedObserver = null;
      }
      this.observerCallbacks.clear();
    }

    /**
     * Get cache statistics
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
     * Initialize shared observer for waitForElement
     */
    initSharedObserver() {
      if (this.sharedObserver) return;

      this.sharedObserver = new MutationObserver(() => {
        if (this.observerCallbacks.size === 0) return;
        if (this.sharedObserverPending) return;

        this.sharedObserverPending = true;
        const flush = () => {
          this.sharedObserverPending = false;
          for (const callback of this.observerCallbacks) {
            try {
              callback();
            } catch {
              // Ignore callback errors to avoid breaking other observers
            }
          }
        };

        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(flush);
        } else {
          setTimeout(flush, 0);
        }
      });

      this.sharedObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  /**
   * Scoped DOM cache for specific contexts (e.g., player, secondary)
   */
  class ScopedDOMCache {
    constructor() {
      /** @type {Map<string, WeakMap<Element, any>>} */
      this.scopedCaches = new Map();
    }

    /**
     * Get or create cache for a scope
     * @param {string} scope - Scope identifier
     * @returns {WeakMap<Element, any>}
     */
    getScope(scope) {
      if (!this.scopedCaches.has(scope)) {
        this.scopedCaches.set(scope, new WeakMap());
      }
      return this.scopedCaches.get(scope);
    }

    /**
     * Cache element in scope
     * @param {string} scope - Scope identifier
     * @param {Element} element - Element to cache
     * @param {any} value - Value to cache
     */
    set(scope, element, value) {
      this.getScope(scope).set(element, value);
    }

    /**
     * Get cached value from scope
     * @param {string} scope - Scope identifier
     * @param {Element} element - Element key
     * @returns {any}
     */
    get(scope, element) {
      return this.getScope(scope).get(element);
    }

    /**
     * Check if element exists in scope
     * @param {string} scope - Scope identifier
     * @param {Element} element - Element key
     * @returns {boolean}
     */
    has(scope, element) {
      return this.getScope(scope).has(element);
    }
  }

  /**
   * Optimized selector patterns for common YouTube elements
   */
  const OptimizedSelectors = {
    // Player elements
    player: '#movie_player',
    video: 'video.video-stream.html5-main-video',
    videoAlt: '#movie_player video',
    chromeBottom: '.ytp-chrome-bottom',

    // Watch page elements
    watchFlexy: 'ytd-watch-flexy',
    secondary: '#secondary',
    rightTabs: '#right-tabs',
    playlistPanel: 'ytd-playlist-panel-renderer',

    // Tab elements
    tabInfo: '#tab-info',
    tabComments: '#tab-comments',
    tabVideos: '#tab-videos',

    // Buttons and controls
    likeButton: 'like-button-view-model button',
    dislikeButton: 'dislike-button-view-model button',
    subscribeButton: '#subscribe-button',

    // Shorts elements
    shorts: 'ytd-shorts',
    activeReel: 'ytd-reel-video-renderer[is-active]',

    // Common containers
    masthead: 'ytd-masthead',
    ytdApp: 'ytd-app',
  };

  /**
   * Batch query executor - executes multiple queries in parallel
   * @param {Array<{selector: string, multi?: boolean, context?: Element}>} queries
   * @returns {Array<Element|Element[]|null>}
   */
  function batchQuery(queries) {
    return queries.map(({ selector, multi = false, context = document }) => {
      if (multi) {
        return Array.from(context.querySelectorAll(selector));
      }
      return context.querySelector(selector);
    });
  }

  // Create global instances
  const globalCache = new DOMCache();
  const scopedCache = new ScopedDOMCache();

  /**
   * Wait for element to appear in DOM (Optimized)
   * @param {string} selector - CSS selector
   * @param {number} [timeout=5000] - Timeout in milliseconds
   * @param {Element} [context=document] - Context element
   * @returns {Promise<Element|null>}
   */
  function waitForElement(selector, timeout = 5000, context = document) {
    return new Promise(resolve => {
      const existing = context.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const isPlaylistPage =
        typeof window !== 'undefined' &&
        window.location &&
        typeof window.location.pathname === 'string' &&
        window.location.pathname === '/playlist';

      // On heavy playlist pages (WL/LL), MutationObserver(subtree) can become very expensive.
      // Prefer lightweight polling here to avoid reacting to the large volume of DOM mutations.
      if (isPlaylistPage && (context === document || context === document.body)) {
        const interval = 250;
        const start = Date.now();
        const timerId = setInterval(() => {
          const element = context.querySelector(selector);
          if (element) {
            clearInterval(timerId);
            resolve(element);
            return;
          }
          if (Date.now() - start >= timeout) {
            clearInterval(timerId);
            resolve(null);
          }
        }, interval);
        return;
      }

      // Use shared observer if context is document/body
      const useShared = context === document || context === document.body;

      if (useShared) {
        globalCache.initSharedObserver();

        const checkCallback = () => {
          const element = context.querySelector(selector);
          if (element) {
            globalCache.observerCallbacks.delete(checkCallback);
            resolve(element);
            return true;
          }
          return false;
        };

        globalCache.observerCallbacks.add(checkCallback);

        setTimeout(() => {
          globalCache.observerCallbacks.delete(checkCallback);
          resolve(null);
        }, timeout);
      } else {
        // Fallback to local observer for specific contexts
        const observer = new MutationObserver(() => {
          const element = context.querySelector(selector);
          if (element) {
            observer.disconnect();
            resolve(element);
          }
        });

        observer.observe(context, {
          childList: true,
          subtree: true,
        });

        setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeout);
      }
    });
  }

  // Export to global namespace
  if (typeof window !== 'undefined') {
    window.YouTubeDOMCache = globalCache;
    window.YouTubeScopedCache = scopedCache;
    window.YouTubeSelectors = OptimizedSelectors;
    window.batchQueryDOM = batchQuery;
    window.waitForElement = waitForElement;

    // Also add to YouTubeUtils if available
    if (window.YouTubeUtils) {
      window.YouTubeUtils.domCache = globalCache;
      window.YouTubeUtils.scopedCache = scopedCache;
      window.YouTubeUtils.selectors = OptimizedSelectors;
      window.YouTubeUtils.batchQuery = batchQuery;
      window.YouTubeUtils.waitFor = waitForElement;
    }
  }

  // Invalidate cache on navigation
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('yt-navigate-finish', () => {
      globalCache.invalidate();
    });

    // Also invalidate on SPF navigation (older YouTube)
    window.addEventListener('spfdone', () => {
      globalCache.invalidate();
    });
  }

  // Cleanup on unload
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', () => {
      globalCache.destroy();
    });
  }
})();
