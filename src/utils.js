// Shared utilities for YouTube+ modules
(function () {
  'use strict';

  /**
   * Logs an error message with module context
   * @param {string} module - The module name where the error occurred
   * @param {string} message - Description of the error
   * @param {Error|*} error - The error object or value
   */
  const logError = (module, message, error) => {
    try {
      console.error(`[YouTube+][${module}] ${message}:`, error);
    } catch {}
  };

  /**
   * Creates a debounced function that delays invoking func until after wait milliseconds
   * @template {Function} T
   * @param {T} fn - The function to debounce
   * @param {number} ms - The number of milliseconds to delay
   * @param {{leading?: boolean}} [options={}] - Options object
   * @returns {T & {cancel: () => void}} The debounced function with a cancel method
   */
  const debounce = (fn, ms, options = {}) => {
    let timeout = null;
    let lastArgs = null;
    let lastThis = null;
    /** @this {any} */
    const debounced = function (...args) {
      lastArgs = args;
      lastThis = this;
      clearTimeout(timeout);
      if (options.leading && !timeout) {
        /** @type {Function} */ (fn).apply(this, args);
      }
      timeout = setTimeout(() => {
        if (!options.leading) /** @type {Function} */ (fn).apply(lastThis, lastArgs);
        timeout = null;
        lastArgs = null;
        lastThis = null;
      }, ms);
    };
    debounced.cancel = () => {
      clearTimeout(timeout);
      timeout = null;
      lastArgs = null;
      lastThis = null;
    };
    return /** @type {any} */ (debounced);
  };

  /**
   * Creates a throttled function that only invokes func at most once per limit milliseconds
   * @template {Function} T
   * @param {T} fn - The function to throttle
   * @param {number} limit - The number of milliseconds to throttle invocations to
   * @returns {T} The throttled function
   */
  const throttle = (fn, limit) => {
    let inThrottle = false;
    let lastResult;
    /** @this {any} */
    const throttled = function (...args) {
      if (!inThrottle) {
        lastResult = /** @type {Function} */ (fn).apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
      return lastResult;
    };
    return /** @type {any} */ (throttled);
  };

  const StyleManager = (function () {
    const styles = new Map();
    return {
      add(id, css) {
        try {
          let el = document.getElementById(id);
          if (!el) {
            el = document.createElement('style');
            el.id = id;
            document.head.appendChild(el);
          }
          styles.set(id, css);
          el.textContent = Array.from(styles.values()).join('\n\n');
        } catch (e) {
          logError('StyleManager', 'add failed', e);
        }
      },
      remove(id) {
        try {
          styles.delete(id);
          const el = document.getElementById(id);
          if (el) el.remove();
        } catch (e) {
          logError('StyleManager', 'remove failed', e);
        }
      },
      clear() {
        for (const id of Array.from(styles.keys())) this.remove(id);
      },
    };
  })();

  const cleanupManager = (function () {
    const observers = new Set();
    const listeners = new Map();
    const intervals = new Set();
    const timeouts = new Set();
    const animationFrames = new Set();

    return {
      registerObserver(o) {
        try {
          observers.add(o);
        } catch {}
        return o;
      },
      registerListener(target, ev, fn, opts) {
        try {
          target.addEventListener(ev, fn, opts);
          const key = Symbol();
          listeners.set(key, { target, ev, fn, opts });
          return key;
        } catch (e) {
          logError('cleanupManager', 'registerListener failed', e);
          return null;
        }
      },
      registerInterval(id) {
        intervals.add(id);
        return id;
      },
      registerTimeout(id) {
        timeouts.add(id);
        return id;
      },
      registerAnimationFrame(id) {
        animationFrames.add(id);
        return id;
      },
      cleanup() {
        try {
          for (const o of observers) {
            try {
              o.disconnect();
            } catch {}
          }
          observers.clear();
          for (const keyEntry of listeners.values()) {
            try {
              keyEntry.target.removeEventListener(keyEntry.ev, keyEntry.fn, keyEntry.opts);
            } catch {}
          }
          listeners.clear();
          for (const id of intervals) clearInterval(id);
          intervals.clear();
          for (const id of timeouts) clearTimeout(id);
          timeouts.clear();
          for (const id of animationFrames) cancelAnimationFrame(id);
          animationFrames.clear();
        } catch (e) {
          logError('cleanupManager', 'cleanup failed', e);
        }
      },
      // expose for debug
      observers,
      listeners,
      intervals,
      timeouts,
      animationFrames,
    };
  })();

  const createElement = (tag, props = {}, children = []) => {
    try {
      const element = document.createElement(tag);
      Object.entries(props).forEach(([k, v]) => {
        if (k === 'className') element.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(element.style, v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(element.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') {
          element.addEventListener(k.slice(2), v);
        } else element.setAttribute(k, v);
      });
      children.forEach(c => {
        if (typeof c === 'string') element.appendChild(document.createTextNode(c));
        else if (c instanceof Node) element.appendChild(c);
      });
      return element;
    } catch (e) {
      logError('createElement', 'failed', e);
      return document.createElement('div');
    }
  };

  const waitForElement = (selector, timeout = 5000, parent = document.body) =>
    new Promise((resolve, reject) => {
      if (!selector || typeof selector !== 'string') return reject(new Error('Invalid selector'));
      try {
        const el = parent.querySelector(selector);
        if (el) return resolve(el);
      } catch (e) {
        return reject(e);
      }
      const obs = new MutationObserver(() => {
        const el = parent.querySelector(selector);
        if (el) {
          try {
            obs.disconnect();
          } catch {}
          resolve(el);
        }
      });
      obs.observe(parent, { childList: true, subtree: true });
      const id = setTimeout(() => {
        try {
          obs.disconnect();
        } catch {}
        reject(new Error('timeout'));
      }, timeout);
      cleanupManager.registerTimeout(id);
    });

  // Minimal storage wrapper
  const storage = {
    get(key, def = null) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? def : JSON.parse(v);
      } catch {
        return def;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {}
    },
  };

  // Expose a global YouTubeUtils if not present (non-destructive)
  if (typeof window !== 'undefined') {
    /** @type {any} */ (window).YouTubeUtils = /** @type {any} */ (window).YouTubeUtils || {};
    const U = /** @type {any} */ (window).YouTubeUtils;
    U.logError = U.logError || logError;
    U.debounce = U.debounce || debounce;
    U.throttle = U.throttle || throttle;
    U.StyleManager = U.StyleManager || StyleManager;
    U.cleanupManager = U.cleanupManager || cleanupManager;
    U.createElement = U.createElement || createElement;
    U.waitForElement = U.waitForElement || waitForElement;
    U.storage = U.storage || storage;
  }
})();
