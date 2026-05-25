/**
 * Module Registry for YouTube+
 *
 * Provides a centralized registry for modules to register and access each other,
 * reducing reliance on window.* globals and making dependencies explicit.
 *
 * Usage:
 *   // Register a module
 *   window.YouTubePlusRegistry.register('utils', myUtilsObject);
 *
 *   // Get a module
 *   const utils = window.YouTubePlusRegistry.get('utils');
 *
 *   // Check if module exists
 *   if (window.YouTubePlusRegistry.has('stats')) { ... }
 */
(function () {
  'use strict';

  /** @type {Map<string, any>} */
  const modules = new Map();

  /** @type {Map<string, Set<Function>>} */
  const pendingCallbacks = new Map();

  class LazyLoader {
    constructor() {
      /** @type {Map<string, {fn: Function, priority: number, delay: number, dependencies: string[], shouldLoad: (() => boolean) | null, reloadOnNavigate: boolean, loadOnReady: boolean, loaded: boolean, onNavigate: (() => void) | null}>} */
      this.modules = new Map();
      /** @type {Set<string>} */
      this.loadedModules = new Set();
      this.stats = { totalModules: 0, loadedModules: 0, blockedModules: 0 };
      this.isIdle = false;
      this.isReadyLoading = false;
      /** @type {number | null} */
      this.idleCallbackId = null;
      this.navListenerAttached = false;
      this.navRetryScheduled = false;
      this.readyListenerAttached = false;
    }

    resetReloadableModules() {
      let resetCount = 0;
      for (const [name, module] of this.modules.entries()) {
        if (!module.reloadOnNavigate || !module.loaded) continue;
        module.loaded = false;
        if (this.loadedModules.delete(name)) {
          this.stats.loadedModules = Math.max(0, this.stats.loadedModules - 1);
        }
        resetCount++;
      }
      return resetCount;
    }

    async retryBlockedModules() {
      let loaded = 0;
      for (const [name, module] of this.modules.entries()) {
        const shouldRetry = module.reloadOnNavigate
          ? module.shouldLoad
            ? module.shouldLoad()
            : true
          : module.shouldLoad
            ? module.shouldLoad()
            : false;
        if (module.loaded || !shouldRetry) continue;
        try {
          const ok = await this.load(name);
          if (ok) loaded++;
        } catch (e) {
          void e;
        }
      }
      return loaded;
    }

    attachNavRetry() {
      if (this.navListenerAttached || typeof window === 'undefined') return;
      this.navListenerAttached = true;
      /** @param {any} event */
      const isSettingsReplayEvent = event => {
        try {
          return Boolean(event?.detail?.__ytpLazyReplay);
        } catch (e) {
          return false;
        }
      };
      const schedule = () => {
        if (this.navRetryScheduled) return;
        this.navRetryScheduled = true;
        const run = () => {
          this.navRetryScheduled = false;
          this.resetReloadableModules();
          this.retryBlockedModules().catch(() => {});
          // Invoke per-module onNavigate hooks for already-loaded modules so
          // route-scoped UI (stats overlays, playall buttons, thumbnail/zoom
          // re-binds) can re-attach to the freshly rendered YouTube DOM.
          for (const [name, module] of this.modules.entries()) {
            if (!module.loaded || !module.onNavigate) continue;
            try {
              module.onNavigate();
            } catch (err) {
              window.YouTubeUtils?.logger?.warn?.(`[LazyLoader] onNavigate("${name}") threw`, err);
            }
          }
          // Also dispatch a global event for modules that prefer subscribing
          // from their own scope (avoids cross-scope closure plumbing).
          try {
            window.dispatchEvent(new CustomEvent('ytp:nav-refresh'));
          } catch (err) {
            void err;
          }
          // If settings modal is currently open, replay the modal-opened event
          // so modules loaded during this retry can inject their settings UI.
          try {
            if (document.querySelector('.ytp-plus-settings-modal')) {
              document.dispatchEvent(
                new CustomEvent('youtube-plus-settings-modal-opened', {
                  bubbles: true,
                  detail: { __ytpLazyReplay: true },
                })
              );
            }
          } catch (err) {
            void err;
          }
        };
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(run, { timeout: 1500 });
        } else {
          setTimeout(run, 250);
        }
      };
      try {
        window.addEventListener('yt-navigate-finish', schedule, { passive: true });
        document.addEventListener('yt-page-data-updated', schedule, { passive: true });
        window.addEventListener('popstate', schedule, { passive: true });
        document.addEventListener(
          'youtube-plus-settings-modal-opened',
          /** @param {any} event */ event => {
            if (isSettingsReplayEvent(event)) return;
            schedule();
          }
        );
      } catch (e) {
        void e;
      }
    }

    /**
     * @param {string} name
     * @param {Function} fn
     * @param {{ priority?: number; delay?: number; dependencies?: string[]; shouldLoad?: (() => boolean); reloadOnNavigate?: boolean; loadOnReady?: boolean; onNavigate?: (() => void) }} [options]
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
        shouldLoad: typeof options.shouldLoad === 'function' ? options.shouldLoad : null,
        reloadOnNavigate: options.reloadOnNavigate === true,
        loadOnReady: options.loadOnReady !== false,
        loaded: false,
        onNavigate: typeof options.onNavigate === 'function' ? options.onNavigate : null,
      };

      this.modules.set(name, moduleConfig);
      this.stats.totalModules++;
      window.YouTubeUtils?.logger?.debug?.(
        `[LazyLoader] Registered module "${name}" (priority: ${moduleConfig.priority})`
      );
    }

    /** @param {string} name */
    async load(name) {
      const module = this.modules.get(name);
      if (!module) {
        window.YouTubeUtils?.logger?.warn?.(`[LazyLoader] Module "${name}" not found`);
        return false;
      }
      if (module.loaded) return true;

      if (module.shouldLoad && !module.shouldLoad()) {
        this.stats.blockedModules++;
        this.attachNavRetry();
        return false;
      }

      for (const dep of module.dependencies) {
        if (!this.loadedModules.has(dep)) {
          await this.load(dep);
        }
      }

      if (module.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, module.delay));
      }

      try {
        await module.fn();
        module.loaded = true;
        this.loadedModules.add(name);
        this.stats.loadedModules++;
        return true;
      } catch (error) {
        window.console.error(`[LazyLoader] Failed to load module "${name}":`, error);
        window.YouTubeUtils?.logger?.error?.(`[LazyLoader] Module "${name}" load failed`, error);
        return false;
      }
    }

    async loadAll() {
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

    loadOnReady() {
      if (this.isReadyLoading) return;
      this.attachNavRetry();

      const loadModules = () => {
        if (this.isReadyLoading) return;
        this.isReadyLoading = true;
        this.loadAll().catch(() => {});
      };

      if (typeof document === 'undefined' || document.readyState !== 'loading') {
        loadModules();
        return;
      }

      if (this.readyListenerAttached) return;
      this.readyListenerAttached = true;

      const onReadyStateChange = () => {
        if (document.readyState !== 'loading') {
          document.removeEventListener('readystatechange', onReadyStateChange);
          loadModules();
        }
      };

      document.addEventListener('readystatechange', onReadyStateChange, { passive: true });
      window.addEventListener(
        'yt-navigate-finish',
        () => {
          document.removeEventListener('readystatechange', onReadyStateChange);
          loadModules();
        },
        { passive: true, once: true }
      );
    }

    /** @param {number} [timeout] */
    loadOnIdle(timeout = 2000) {
      if (this.isIdle) return;
      this.isIdle = true;

      const loadModules = async () => {
        await this.loadAll();
      };

      this.attachNavRetry();

      if (typeof requestIdleCallback !== 'undefined') {
        this.idleCallbackId = requestIdleCallback(loadModules, { timeout });
      } else {
        this.idleCallbackId = /** @type {number} */ (
          /** @type {unknown} */ (setTimeout(loadModules, timeout))
        );
      }
    }

    cancelIdleLoading() {
      if (!this.isIdle) return;
      if (typeof window.cancelIdleCallback !== 'undefined' && this.idleCallbackId) {
        window.cancelIdleCallback(this.idleCallbackId);
      } else if (this.idleCallbackId) {
        clearTimeout(
          /** @type {ReturnType<typeof setTimeout>} */ (
            /** @type {unknown} */ (this.idleCallbackId)
          )
        );
      }
      this.isIdle = false;
      this.idleCallbackId = null;
    }

    cancelReadyLoading() {
      this.isReadyLoading = false;
      this.readyListenerAttached = false;
    }

    /** @param {string} name */
    isLoaded(name) {
      return this.loadedModules.has(name);
    }

    getStats() {
      return {
        ...this.stats,
        loadingPercentage:
          this.stats.totalModules > 0
            ? (this.stats.loadedModules / this.stats.totalModules) * 100
            : 0,
        unloadedModules: this.stats.totalModules - this.stats.loadedModules,
        blockedModules: this.stats.blockedModules,
      };
    }

    clear() {
      this.cancelIdleLoading();
      this.cancelReadyLoading();
      this.modules.clear();
      this.loadedModules.clear();
      this.stats = { totalModules: 0, loadedModules: 0, blockedModules: 0 };
      this.navListenerAttached = false;
      this.navRetryScheduled = false;
    }
  }

  const lazyLoader = new LazyLoader();
  const lazyLoaderApi = {
    LazyLoader,
    register: (
      /** @type {string} */ name,
      /** @type {Function} */ fn,
      /** @type {{priority?: number; delay?: number; dependencies?: string[]; shouldLoad?: (() => boolean); reloadOnNavigate?: boolean; loadOnReady?: boolean; onNavigate?: (() => void)} | undefined} */ options
    ) => lazyLoader.register(name, fn, options),
    load: /** @param {string} name */ name => lazyLoader.load(name),
    loadAll: () => lazyLoader.loadAll(),
    loadOnIdle: /** @param {number} [timeout] */ timeout => lazyLoader.loadOnIdle(timeout),
    loadOnReady: () => lazyLoader.loadOnReady(),
    isLoaded: /** @param {string} name */ name => lazyLoader.isLoaded(name),
    getStats: () => lazyLoader.getStats(),
    clear: () => lazyLoader.clear(),
    retryBlockedModules: () => lazyLoader.retryBlockedModules(),
    attachNavRetry: () => lazyLoader.attachNavRetry(),
  };

  /**
   * Module Registry
   */
  const registry = {
    /**
     * Register a module in the registry
     * @param {string} name - Module name
     * @param {any} moduleExport - Module's public API
     */
    register(name, moduleExport) {
      if (!name || typeof name !== 'string') {
        window.console.warn('[YouTube+ Registry] Invalid module name:', name);
        return;
      }
      modules.set(name, moduleExport);

      // Also set window global for backward compatibility
      // Map common registry names to their existing window.* counterparts
      /** @type {Record<string, string>} */
      const windowAliases = {
        utils: 'YouTubeUtils',
        domCache: 'YouTubeDOMCache',
        errorBoundary: 'YouTubeErrorBoundary',
        performance: 'YouTubePerformance',
        i18n: 'YouTubePlusI18n',
        lazyLoader: 'YouTubePlusLazyLoader',
        eventDelegation: 'YouTubePlusEventDelegation',
        security: 'YouTubeSecurityUtils',
        settings: 'YouTubePlusSettingsHelpers',
        modalHandlers: 'YouTubePlusModalHandlers',
        stats: 'YouTubeStats',
        download: 'YouTubePlusDownload',
        music: 'YouTubeMusic',
        voting: 'YouTubePlus',
        logger: 'YouTubePlusLogger',
      };

      if (windowAliases[name] && typeof window !== 'undefined') {
        window[windowAliases[name]] = moduleExport;
      }

      // Resolve pending callbacks
      const pending = pendingCallbacks.get(name);
      if (pending) {
        for (const cb of pending) {
          try {
            cb(moduleExport);
          } catch (e) {
            window.console.error(`[YouTube+ Registry] Callback error for "${name}":`, e);
          }
        }
        pendingCallbacks.delete(name);
      }
    },

    /**
     * Get a registered module
     * @param {string} name - Module name
          // @ts-check
     * @returns {any} Module's public API, or undefined
     */
    get(name) {
      return modules.get(name);
    },

    /**
     * Check if a module is registered
     * @param {string} name - Module name
     * @returns {boolean}
     */
    has(name) {
      return modules.has(name);
    },

    /**
     * Wait for a module to be registered
     * @param {string} name - Module name
     * @param {Function} callback - Called when module is available
     */
    onReady(name, callback) {
      if (modules.has(name)) {
        try {
          callback(modules.get(name));
        } catch (e) {
          window.console.error(`[YouTube+ Registry] onReady callback error for "${name}":`, e);
        }
        return;
      }
      if (!pendingCallbacks.has(name)) {
        pendingCallbacks.set(name, new Set());
      }
      pendingCallbacks.get(name)?.add(callback);
    },

    /**
     * Get all registered module names
     * @returns {string[]}
     */
    list() {
      return Array.from(modules.keys());
    },

    /**
     * Get registry statistics
     * @returns {Object}
     */
    getStats() {
      return {
        totalModules: modules.size,
        moduleNames: Array.from(modules.keys()),
        pendingCallbacks: Array.from(pendingCallbacks.keys()),
      };
    },

    /**
     * Remove a module (for testing/cleanup)
     * @param {string} name
     */
    unregister(name) {
      modules.delete(name);
    },

    /**
     * Clear all registered modules (for testing)
     */
    clear() {
      modules.clear();
      pendingCallbacks.clear();
      lazyLoader.clear();
    },
    lazyLoader: lazyLoaderApi,
  };

  // Export to window
  if (typeof window !== 'undefined') {
    window.YouTubePlusLazyLoader = lazyLoaderApi;
    window.YouTubePlusRegistry = registry;
  }
})();
