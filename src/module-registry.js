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
        console.warn('[YouTube+ Registry] Invalid module name:', name);
        return;
      }
      modules.set(name, moduleExport);

      // Also set window global for backward compatibility
      // Map common registry names to their existing window.* counterparts
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
            console.error(`[YouTube+ Registry] Callback error for "${name}":`, e);
          }
        }
        pendingCallbacks.delete(name);
      }
    },

    /**
     * Get a registered module
     * @param {string} name - Module name
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
          console.error(`[YouTube+ Registry] onReady callback error for "${name}":`, e);
        }
        return;
      }
      if (!pendingCallbacks.has(name)) {
        pendingCallbacks.set(name, new Set());
      }
      pendingCallbacks.get(name).add(callback);
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
    },
  };

  // Export to window
  if (typeof window !== 'undefined') {
    window.YouTubePlusRegistry = registry;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { registry };
  }
})();
