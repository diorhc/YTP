// Lazy Loading System - Performance Optimization
(function () {
  'use strict';

  /**
   * Lazy loading manager for non-critical features
   * Defers initialization to improve initial load performance
   */
  class LazyLoader {
    constructor() {
      /** @type {Map<string, {fn: Function, priority: number, loaded: boolean}>} */
      this.modules = new Map();
      /** @type {Set<string>} */
      this.loadedModules = new Set();
      this.stats = { totalModules: 0, loadedModules: 0 };
      this.isIdle = false;
      this.idleCallbackId = null;
    }

    /**
     * Register a module for lazy loading
     * @param {string} name - Module name
     * @param {Function} fn - Function to execute when loaded
     * @param {Object} [options] - Loading options
     * @param {number} [options.priority=0] - Priority (higher = loads first)
     * @param {number} [options.delay=0] - Delay before loading (ms)
     * @param {string[]} [options.dependencies=[]] - Module dependencies
     */
    register(name, fn, options = {}) {
      if (this.modules.has(name)) {
        window.YouTubeUtils?.logger?.warn?.(`[LazyLoader] Module "${name}" already registered`);
        return;
      }

      const moduleConfig = {
        fn,
        priority: options.priority || 0,
        delay: options.delay || 0,
        dependencies: options.dependencies || [],
        loaded: false,
      };

      this.modules.set(name, moduleConfig);
      this.stats.totalModules++;

      window.YouTubeUtils?.logger?.debug?.(
        `[LazyLoader] Registered module "${name}" (priority: ${moduleConfig.priority})`
      );
    }

    /**
     * Load a specific module
     * @param {string} name - Module name
     * @returns {Promise<boolean>} Success status
     */
    async load(name) {
      const module = this.modules.get(name);

      if (!module) {
        window.YouTubeUtils?.logger?.warn?.(`[LazyLoader] Module "${name}" not found`);
        return false;
      }

      if (module.loaded) {
        window.YouTubeUtils?.logger?.debug?.(`[LazyLoader] Module "${name}" already loaded`);
        return true;
      }

      // Check dependencies
      for (const dep of module.dependencies) {
        if (!this.loadedModules.has(dep)) {
          window.YouTubeUtils?.logger?.debug?.(
            `[LazyLoader] Loading dependency "${dep}" for "${name}"`
          );
          await this.load(dep);
        }
      }

      // Apply delay if specified
      if (module.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, module.delay));
      }

      try {
        window.YouTubeUtils?.logger?.debug?.(`[LazyLoader] Loading module "${name}"`);
        const startTime = performance.now();

        await module.fn();

        const loadTime = performance.now() - startTime;
        window.YouTubeUtils?.logger?.debug?.(
          `[LazyLoader] Module "${name}" loaded in ${loadTime.toFixed(2)}ms`
        );

        module.loaded = true;
        this.loadedModules.add(name);
        this.stats.loadedModules++;

        return true;
      } catch (error) {
        console.error(`[LazyLoader] Failed to load module "${name}":`, error);
        window.YouTubeUtils?.logger?.error?.(`[LazyLoader] Module "${name}" load failed`, error);
        return false;
      }
    }

    /**
     * Load all registered modules by priority
     * @returns {Promise<number>} Number of modules loaded
     */
    async loadAll() {
      // Sort modules by priority (highest first)
      const sortedModules = Array.from(this.modules.entries()).sort(
        (a, b) => b[1].priority - a[1].priority
      );

      let loadedCount = 0;

      for (const [name, module] of sortedModules) {
        if (!module.loaded) {
          const success = await this.load(name);
          if (success) loadedCount++;
        }
      }

      return loadedCount;
    }

    /**
     * Load modules when browser is idle
     * @param {number} [timeout=2000] - Timeout for requestIdleCallback
     */
    loadOnIdle(timeout = 2000) {
      if (this.isIdle) {
        window.YouTubeUtils?.logger?.debug?.('[LazyLoader] Idle loading already scheduled');
        return;
      }

      this.isIdle = true;

      const loadModules = async () => {
        window.YouTubeUtils?.logger?.debug?.('[LazyLoader] Starting idle loading');
        const count = await this.loadAll();
        window.YouTubeUtils?.logger?.debug?.(`[LazyLoader] Loaded ${count} modules during idle`);
      };

      // Use requestIdleCallback if available, otherwise setTimeout
      if (typeof requestIdleCallback !== 'undefined') {
        this.idleCallbackId = requestIdleCallback(loadModules, { timeout });
      } else {
        this.idleCallbackId = setTimeout(loadModules, timeout);
      }
    }

    /**
     * Cancel idle loading
     */
    cancelIdleLoading() {
      if (!this.isIdle) return;

      if (typeof window.cancelIdleCallback !== 'undefined' && this.idleCallbackId) {
        window.cancelIdleCallback(this.idleCallbackId);
      } else if (this.idleCallbackId) {
        clearTimeout(this.idleCallbackId);
      }

      this.isIdle = false;
      this.idleCallbackId = null;
    }

    /**
     * Check if module is loaded
     * @param {string} name - Module name
     * @returns {boolean}
     */
    isLoaded(name) {
      return this.loadedModules.has(name);
    }

    /**
     * Get loading statistics
     * @returns {Object} Statistics object
     */
    getStats() {
      return {
        ...this.stats,
        loadingPercentage:
          this.stats.totalModules > 0
            ? (this.stats.loadedModules / this.stats.totalModules) * 100
            : 0,
        unloadedModules: this.stats.totalModules - this.stats.loadedModules,
      };
    }

    /**
     * Clear all modules
     */
    clear() {
      this.cancelIdleLoading();
      this.modules.clear();
      this.loadedModules.clear();
      this.stats = { totalModules: 0, loadedModules: 0 };
    }
  }

  // Create global instance
  const lazyLoader = new LazyLoader();

  // Export to window
  if (typeof window !== 'undefined') {
    window.YouTubePlusLazyLoader = {
      LazyLoader,
      register: (name, fn, options) => lazyLoader.register(name, fn, options),
      load: name => lazyLoader.load(name),
      loadAll: () => lazyLoader.loadAll(),
      loadOnIdle: timeout => lazyLoader.loadOnIdle(timeout),
      isLoaded: name => lazyLoader.isLoaded(name),
      getStats: () => lazyLoader.getStats(),
      clear: () => lazyLoader.clear(),
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LazyLoader };
  }
})();
