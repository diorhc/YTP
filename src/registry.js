/**
 * YouTubePlusRegistry — centralized module/flag registry.
 *
 * Provides both module-level registration (register, get, onReady)
 * and flag-level tracking (set, get as override, onChange, all).
 *
 * Usage:
 *   const reg = window.YouTubePlusRegistry;
 *   reg.register('myModule', moduleExports);
 *   reg.set('featureFlag', true);
 *   reg.onReady('myModule', (mod) => { ... });
 */
// @ts-check
(function () {
  if (typeof window === 'undefined') return;

  /** @type {Map<string, any>} */
  const modules = new Map();
  /** @type {Map<string, Set<(mod: any) => void>>} */
  const readyCallbacks = new Map();
  /** @type {Map<string, any>} */
  const flags = new Map();
  /** @type {Map<string, Set<(value: any) => void>>} */
  const flagListeners = new Map();

  /**
   * @typedef {Object} YouTubePlusRegistryAPI
   * @property {(name: string, moduleExport: any) => void} register - Register a module
   * @property {(name: string) => any} get - Get a registered module or flag value
   * @property {(name: string) => boolean} has - Check if a module or flag exists
   * @property {(name: string, callback: (mod: any) => void) => void} onReady - Subscribe to module registration
   * @property {() => string[]} list - List all registered module names
   * @property {() => any} getStats - Get registry statistics
   * @property {(name: string) => void} unregister - Remove a module
   * @property {() => void} clear - Clear all registrations
   * @property {YouTubePlusLazyLoader} lazyLoader - Lazy loader subsystem
   * @property {(name: string, value: any) => void} set - Set a flag value
   * @property {(name: string, cb: (value: any) => void) => () => void} onChange - Subscribe to flag changes
   * @property {() => Record<string, any>} all - Get all flags as a plain object
   * @property {(name: string) => void} deleteFlag - Remove a flag
   */

  /** @type {YouTubePlusLazyLoader} */
  const lazyLoader = {
    LazyLoader: null,
    _entries: new Map(),
    register(name, fn, options) {
      this._entries.set(name, { fn, options: options || {}, loaded: false });
      if (this.LazyLoader && typeof this.LazyLoader.register === 'function') {
        this.LazyLoader.register(name, fn, options);
      }
    },
    async load(name) {
      const entry = this._entries.get(name);
      if (!entry || entry.loaded) return true;
      try {
        const deps = entry.options.dependencies || [];
        for (const dep of deps) {
          if (!modules.has(dep)) {
            const depReady = new Promise(resolve => {
              const existing = readyCallbacks.get(dep);
              if (existing) existing.add(() => resolve(true));
              else {
                const set = new Set();
                set.add(() => resolve(true));
                readyCallbacks.set(dep, set);
              }
            });
            await depReady;
          }
        }
        if (entry.options.shouldLoad && !entry.options.shouldLoad()) return false;
        await entry.fn();
        entry.loaded = true;
        return true;
      } catch (_e) {
        return false;
      }
    },
    async loadAll() {
      let count = 0;
      for (const name of this._entries.keys()) {
        if (await this.load(name)) count++;
      }
      return count;
    },
    loadOnIdle(timeout) {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => this.loadAll(), { timeout });
      } else {
        setTimeout(() => this.loadAll(), timeout || 100);
      }
    },
    isLoaded(name) {
      const entry = this._entries.get(name);
      return entry ? entry.loaded : false;
    },
    getStats() {
      let loaded = 0;
      let pending = 0;
      for (const entry of this._entries.values()) {
        if (entry.loaded) loaded++;
        else pending++;
      }
      return { loaded, pending, total: this._entries.size };
    },
    clear() {
      this._entries.clear();
    },
    async retryBlockedModules() {
      let count = 0;
      for (const [name, entry] of this._entries) {
        if (!entry.loaded) {
          if (await this.load(name)) count++;
        }
      }
      return count;
    },
    attachNavRetry() {
      // No-op in registry context; delegated to the legacy LazyLoader if present
      if (this.LazyLoader && typeof this.LazyLoader.attachNavRetry === 'function') {
        this.LazyLoader.attachNavRetry();
      }
    },
    getStatus() {
      /** @type {Record<string, string>} */
      const result = {};
      for (const [name, entry] of this._entries) {
        result[name] = entry.loaded ? 'loaded' : 'pending';
      }
      return result;
    },
    getAllEntries() {
      return [...this._entries.entries()].map(([name, e]) => ({
        name,
        loaded: e.loaded,
        options: e.options,
      }));
    },
  };

  /** @type {YouTubePlusRegistryAPI} */
  const registry = {
    /**
     * Register a module export under a name. Fires any pending onReady callbacks.
     * @param {string} name
     * @param {any} moduleExport
     */
    register(name, moduleExport) {
      modules.set(name, moduleExport);
      const callbacks = readyCallbacks.get(name);
      if (callbacks) {
        for (const cb of callbacks) {
          try {
            cb(moduleExport);
          } catch (_e) {
            /* non-critical */
          }
        }
        readyCallbacks.delete(name);
      }
    },

    /**
     * Get a registered module or flag value.
     * @param {string} name
     * @returns {any}
     */
    get(name) {
      if (modules.has(name)) return modules.get(name);
      if (flags.has(name)) return flags.get(name);
      return undefined;
    },

    /**
     * Check if a module or flag is registered.
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
      return modules.has(name) || flags.has(name);
    },

    /**
     * Subscribe to a module registration. If already registered, fires immediately.
     * @param {string} name
     * @param {(mod: any) => void} callback
     */
    onReady(name, callback) {
      if (modules.has(name)) {
        try {
          callback(modules.get(name));
        } catch (_e) {
          /* non-critical */
        }
        return;
      }
      if (!readyCallbacks.has(name)) readyCallbacks.set(name, new Set());
      readyCallbacks.get(name)?.add(callback);
    },

    /**
     * List all registered module names.
     * @returns {string[]}
     */
    list() {
      return [...modules.keys()];
    },

    /**
     * Get registry statistics.
     * @returns {{ modules: number, flags: number, pendingCallbacks: number }}
     */
    getStats() {
      let pendingCallbacks = 0;
      for (const s of readyCallbacks.values()) pendingCallbacks += s.size;
      return {
        modules: modules.size,
        flags: flags.size,
        pendingCallbacks,
      };
    },

    /**
     * Unregister a module.
     * @param {string} name
     */
    unregister(name) {
      modules.delete(name);
    },

    /**
     * Clear all registrations, flags, and callbacks.
     */
    clear() {
      modules.clear();
      flags.clear();
      readyCallbacks.clear();
      flagListeners.clear();
      lazyLoader._entries.clear();
    },

    lazyLoader,

    /**
     * Set a flag value and notify subscribers.
     * @param {string} name
     * @param {any} value
     */
    set(name, value) {
      flags.set(name, value);
      const subs = flagListeners.get(name);
      if (subs) {
        for (const cb of subs) {
          try {
            cb(value);
          } catch (_e) {
            /* non-critical */
          }
        }
      }
    },

    /**
     * Subscribe to flag changes. Fires immediately if the flag already has a value.
     * @param {string} name
     * @param {(value: any) => void} cb
     * @returns {() => void} Unsubscribe function
     */
    onChange(name, cb) {
      if (!flagListeners.has(name)) flagListeners.set(name, new Set());
      flagListeners.get(name)?.add(cb);
      if (flags.has(name)) {
        try {
          cb(flags.get(name));
        } catch (_e) {
          /* non-critical */
        }
      }
      return () => {
        const s = flagListeners.get(name);
        if (s) s.delete(cb);
      };
    },

    /**
     * Get all flags as a plain object.
     * @returns {Record<string, any>}
     */
    all() {
      return Object.fromEntries(flags);
    },

    /**
     * Remove a flag.
     * @param {string} name
     */
    deleteFlag(name) {
      flags.delete(name);
    },
  };

  window.YouTubePlusRegistry = registry;
  if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.YouTubePlusRegistry = registry;
  }
})();
