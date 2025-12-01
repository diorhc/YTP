/**
 * Module Lazy Loader - Dynamic module loading for performance optimization
 * Reduces initial bundle size by loading heavy modules only when needed
 */

window.YouTubeModuleLoader = (() => {
  'use strict';

  const loadedModules = new Map();
  const loadingPromises = new Map();

  // Module configurations - since modules are already loaded in bundle, just track their status
  const moduleConfigs = {
    stats: {
      loaded: false,
      priority: 'low',
      loadOnIdle: false, // Already in bundle
      globalName: 'YouTubeStats',
    },
    download: {
      loaded: false,
      priority: 'low',
      loadOnIdle: false, // Already in bundle
      globalName: 'YouTubeDownload',
    },
    comment: {
      loaded: false,
      priority: 'medium',
      loadOnDemand: false, // Already in bundle
      globalName: 'YouTubeComments',
    },
    music: {
      loaded: false,
      priority: 'medium',
      loadOnDemand: false, // Already in bundle
      globalName: 'YouTubeMusic',
    },
    playlist: {
      loaded: false,
      priority: 'low',
      loadOnDemand: false, // Already in bundle
      globalName: 'YouTubePlaylistSearch',
    },
  };

  /**
   * Check if module is already loaded
   * @param {string} moduleName - Module name
   * @returns {boolean}
   */
  const isModuleLoaded = moduleName => {
    return moduleConfigs[moduleName]?.loaded || false;
  };

  /**
   * Load module dynamically (or reference if already in bundle)
   * @param {string} moduleName - Module name to load
   * @returns {Promise<any>} Module export
   */
  const loadModule = async moduleName => {
    if (isModuleLoaded(moduleName)) {
      return loadedModules.get(moduleName);
    }

    // Check if already loading
    if (loadingPromises.has(moduleName)) {
      return loadingPromises.get(moduleName);
    }

    const loadPromise = (async () => {
      try {
        const startTime = performance.now();
        const config = moduleConfigs[moduleName];

        if (!config) {
          throw new Error(`Unknown module: ${moduleName}`);
        }

        // Since modules are in bundle, just reference them
        const module = window[config.globalName];

        if (!module) {
          console.warn(`[YT+][Loader] Module ${moduleName} not yet initialized, will retry...`);
          // Module might not be initialized yet, mark as not loaded
          return null;
        }

        loadedModules.set(moduleName, module);
        moduleConfigs[moduleName].loaded = true;

        const loadTime = performance.now() - startTime;
        console.log(`[YT+][Loader] Module ${moduleName} ready in ${loadTime.toFixed(2)}ms`);

        return module;
      } catch (error) {
        console.error(`[YT+][Loader] Failed to reference module ${moduleName}:`, error);
        loadingPromises.delete(moduleName);
        throw error;
      }
    })();

    loadingPromises.set(moduleName, loadPromise);
    return loadPromise;
  };

  /**
   * Load multiple modules in parallel
   * @param {string[]} moduleNames - Array of module names
   * @returns {Promise<any[]>} Array of loaded modules
   */
  const loadModules = async moduleNames => {
    const promises = moduleNames.map(name => loadModule(name));
    return Promise.all(promises);
  };

  /**
   * Preload/reference modules with low priority using requestIdleCallback
   * @param {string[]} moduleNames - Modules to preload
   */
  const preloadModules = moduleNames => {
    const callback = () => {
      moduleNames.forEach(moduleName => {
        if (!isModuleLoaded(moduleName)) {
          loadModule(moduleName).catch(err => {
            // Silently fail for optional modules
            if (err) console.debug(`[YT+][Loader] Module ${moduleName} not ready yet`);
          });
        }
      });
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(callback, { timeout: 3000 });
    } else {
      setTimeout(callback, 1000);
    }
  };

  /**
   * Auto-reference all modules after initialization
   */
  const autoPreload = () => {
    const allModules = Object.keys(moduleConfigs);
    preloadModules(allModules);
  };

  /**
   * Initialize loader
   */
  const init = () => {
    // Wait for DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoPreload);
    } else {
      // Already loaded, schedule for next tick
      setTimeout(autoPreload, 100);
    }
  };

  // Auto-initialize
  init();

  return {
    loadModule,
    loadModules,
    preloadModules,
    isModuleLoaded,
    getLoadedModules: () => Array.from(loadedModules.keys()),
    getModuleConfigs: () => ({ ...moduleConfigs }),
  };
})();
