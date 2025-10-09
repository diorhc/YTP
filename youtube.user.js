// ==UserScript==
// @name            YouTube +
// @name:en         YouTube +
// @namespace       by
// @version         2.0
// @author          diorhc
// @description     Вкладки для информации, комментариев, видео, плейлиста и скачивание видео и другие функции ↴
// @description:en  Tabview YouTube and Download and others features ↴
// @match           https://*.youtube.com/*
// @match           https://music.youtube.com/*
// @match           *://myactivity.google.com/*
// @include         *://www.youtube.com/feed/history/*
// @include         https://www.youtube.com
// @include         *://*.youtube.com/**
// @exclude         *://accounts.youtube.com/*
// @exclude         *://www.youtube.com/live_chat_replay*
// @exclude         *://www.youtube.com/persist_identity*
// @exclude         /^https?://\w+\.youtube\.com\/live_chat.*$/
// @exclude         /^https?://\S+\.(txt|png|jpg|jpeg|gif|xml|svg|manifest|log|ini)[^\/]*$/
// @icon            https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @license         MIT
// @grant           GM_xmlhttpRequest
// @grant           unsafeWindow
// @connect         api.livecounts.io
// @connect         livecounts.io
// @run-at          document-start
// @homepageURL     https://github.com/diorhc/YoutubePlus
// @supportURL      https://github.com/diorhc/YoutubePlus/issues
// @downloadURL     https://update.greasyfork.org/scripts/537017/YouTube%20%2B.user.js
// @updateURL       https://update.greasyfork.org/scripts/537017/YouTube%20%2B.meta.js
// ==/UserScript==

// --- MODULE: utils.js ---

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
    } catch { }
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
        } catch { }
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
            } catch { }
          }
          observers.clear();
          for (const keyEntry of listeners.values()) {
            try {
              keyEntry.target.removeEventListener(keyEntry.ev, keyEntry.fn, keyEntry.opts);
            } catch { }
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
          } catch { }
          resolve(el);
        }
      });
      obs.observe(parent, { childList: true, subtree: true });
      const id = setTimeout(() => {
        try {
          obs.disconnect();
        } catch { }
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
      } catch { }
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

// --- MODULE: error-boundary.js ---

// Global error boundary for YouTube+ userscript
(function () {
  'use strict';

  /**
   * Error boundary configuration
   */
  const ErrorBoundaryConfig = {
    maxErrors: 10,
    errorWindow: 60000, // 1 minute
    enableLogging: true,
    enableRecovery: true,
    storageKey: 'youtube_plus_errors',
  };

  /**
   * Error tracking state
   */
  const errorState = {
    errors: [],
    errorCount: 0,
    lastErrorTime: 0,
    isRecovering: false,
  };

  /**
   * Error severity levels
   */
  const ErrorSeverity = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
  };

  /**
   * Categorize error severity
   * @param {Error} error - The error object
   * @returns {string} Severity level
   */
  const categorizeSeverity = error => {
    const message = error.message?.toLowerCase() || '';

    if (
      message.includes('cannot read') ||
      message.includes('undefined') ||
      message.includes('null')
    ) {
      return ErrorSeverity.MEDIUM;
    }

    if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
      return ErrorSeverity.LOW;
    }

    if (message.includes('syntax') || message.includes('reference') || message.includes('type')) {
      return ErrorSeverity.HIGH;
    }

    if (message.includes('security') || message.includes('csp')) {
      return ErrorSeverity.CRITICAL;
    }

    return ErrorSeverity.MEDIUM;
  };

  /**
   * Log error with context
   * @param {Error} error - The error object
   * @param {Object} context - Additional context information
   */
  const logError = (error, context = {}) => {
    if (!ErrorBoundaryConfig.enableLogging) return;

    const fallbackMessage = error.message?.trim() || '(no message)';

    const errorInfo = {
      timestamp: new Date().toISOString(),
      message: fallbackMessage,
      stack: error.stack,
      severity: categorizeSeverity(error),
      context: {
        url: window.location.href,
        userAgent: navigator.userAgent,
        ...context,
      },
    };

    console.error(`[YouTube+ Error Boundary] ${errorInfo.message}`, errorInfo);

    // Store error for analysis
    errorState.errors.push(errorInfo);
    if (errorState.errors.length > 50) {
      errorState.errors.shift(); // Keep only last 50 errors
    }

    // Persist to localStorage for debugging
    try {
      const stored = JSON.parse(localStorage.getItem(ErrorBoundaryConfig.storageKey) || '[]');
      stored.push(errorInfo);
      if (stored.length > 20) stored.shift();
      localStorage.setItem(ErrorBoundaryConfig.storageKey, JSON.stringify(stored));
    } catch { }
  };

  /**
   * Check if error rate is too high
   * @returns {boolean} True if error rate exceeded
   */
  const isErrorRateExceeded = () => {
    const now = Date.now();
    const windowStart = now - ErrorBoundaryConfig.errorWindow;

    // Count errors in the time window
    const recentErrors = errorState.errors.filter(
      e => new Date(e.timestamp).getTime() > windowStart
    );

    return recentErrors.length >= ErrorBoundaryConfig.maxErrors;
  };

  /**
   * Attempt to recover from error
   * @param {Error} error - The error that occurred
   * @param {Object} context - Error context
   */
  const attemptRecovery = (error, context) => {
    if (!ErrorBoundaryConfig.enableRecovery || errorState.isRecovering) return;

    const severity = categorizeSeverity(error);

    if (severity === ErrorSeverity.CRITICAL) {
      console.error('[YouTube+] Critical error detected. Script may not function properly.');
      return;
    }

    errorState.isRecovering = true;

    try {
      // Attempt recovery based on error type
      if (context.module && window.YouTubeUtils?.cleanupManager) {
        console.log(`[YouTube+] Attempting recovery for module: ${context.module}`);
        // Could implement module-specific recovery here
      }

      setTimeout(() => {
        errorState.isRecovering = false;
      }, 5000);
    } catch (recoveryError) {
      console.error('[YouTube+] Recovery attempt failed:', recoveryError);
      errorState.isRecovering = false;
    }
  };

  /**
   * Global error handler
   * @param {ErrorEvent} event - The error event
   */
  const handleError = event => {
    const error = event.error || new Error(event.message);

    const message = (error.message || event.message || '').trim();
    const source = event.filename || '';
    const isCrossOriginSource =
      source && !source.startsWith(window.location.origin) && !/YouTube\+/.test(source);

    if (!message && isCrossOriginSource) {
      // Ignore opaque cross-origin errors we can't introspect
      return false;
    }

    // Track error
    errorState.errorCount++;
    errorState.lastErrorTime = Date.now();

    // Log error
    logError(error, {
      type: 'uncaught',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });

    // Check error rate
    if (isErrorRateExceeded()) {
      console.error(
        '[YouTube+] Error rate exceeded! Too many errors in short period. Some features may be disabled.'
      );
      return;
    }

    // Attempt recovery
    attemptRecovery(error, { type: 'uncaught' });

    // Don't prevent default error handling
    return false;
  };

  /**
   * Unhandled promise rejection handler
   * @param {PromiseRejectionEvent} event - The rejection event
   */
  const handleUnhandledRejection = event => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));

    logError(error, {
      type: 'unhandledRejection',
      promise: event.promise,
    });

    // Check error rate
    if (isErrorRateExceeded()) {
      console.error('[YouTube+] Promise rejection rate exceeded!');
      return;
    }

    // Attempt recovery
    attemptRecovery(error, { type: 'unhandledRejection' });
  };

  /**
   * Safe function wrapper with error boundary
   * @param {Function} fn - Function to wrap
   * @param {string} context - Context identifier
   * @returns {Function} Wrapped function
   */
  const withErrorBoundary = (fn, context = 'unknown') => {
    /** @this {any} */
    return function (...args) {
      try {
        const fnAny = /** @type {any} */ (fn);
        return /** @this {any} */ fnAny.apply(this, args);
      } catch (error) {
        logError(error, { module: context, args });
        attemptRecovery(error, { module: context });
        return null;
      }
    };
  };

  /**
   * Safe async function wrapper with error boundary
   * @param {Function} fn - Async function to wrap
   * @param {string} context - Context identifier
   * @returns {Function} Wrapped async function
   */
  const withAsyncErrorBoundary = (fn, context = 'unknown') => {
    /** @this {any} */
    return async function (...args) {
      try {
        const fnAny = /** @type {any} */ (fn);
        return /** @this {any} */ await fnAny.apply(this, args);
      } catch (error) {
        logError(error, { module: context, args });
        attemptRecovery(error, { module: context });
        return null;
      }
    };
  };

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  const getErrorStats = () => {
    return {
      totalErrors: errorState.errorCount,
      recentErrors: errorState.errors.length,
      lastErrorTime: errorState.lastErrorTime,
      isRecovering: errorState.isRecovering,
      errorsByType: errorState.errors.reduce((acc, e) => {
        acc[e.severity] = (acc[e.severity] || 0) + 1;
        return acc;
      }, {}),
    };
  };

  /**
   * Clear stored errors
   */
  const clearErrors = () => {
    errorState.errors = [];
    try {
      localStorage.removeItem(ErrorBoundaryConfig.storageKey);
    } catch { }
  };

  // Install global error handlers
  if (typeof window !== 'undefined') {
    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection, true);

    // Expose error boundary utilities
    window.YouTubeErrorBoundary = {
      withErrorBoundary,
      withAsyncErrorBoundary,
      getErrorStats,
      clearErrors,
      logError,
    };

    console.log('[YouTube+] Error boundary initialized');
  }
})();

// --- MODULE: performance.js ---

// Performance monitoring for YouTube+ userscript
(function () {
  'use strict';

  /**
   * Performance monitoring configuration
   */
  const PerformanceConfig = {
    enabled: true,
    sampleRate: 1.0, // 100% sampling
    storageKey: 'youtube_plus_performance',
    metricsRetention: 100, // Keep last 100 metrics
    enableConsoleOutput: false,
  };

  /**
   * Performance metrics storage
   */
  const metrics = {
    timings: new Map(),
    marks: new Map(),
    measures: [],
    resources: [],
  };

  /**
   * Create a performance mark
   * @param {string} name - Mark name
   */
  const mark = name => {
    if (!PerformanceConfig.enabled) return;

    try {
      if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark(name);
      }
      metrics.marks.set(name, Date.now());
    } catch (e) {
      console.warn('[YouTube+ Perf] Failed to create mark:', e);
    }
  };

  /**
   * Measure time between two marks
   * @param {string} name - Measure name
   * @param {string} startMark - Start mark name
   * @param {string} endMark - End mark name (optional, defaults to now)
   * @returns {number} Duration in milliseconds
   */
  const measure = (name, startMark, endMark) => {
    if (!PerformanceConfig.enabled) return 0;

    try {
      const startTime = metrics.marks.get(startMark);
      if (!startTime) {
        console.warn(`[YouTube+ Perf] Start mark "${startMark}" not found`);
        return 0;
      }

      const endTime = endMark ? metrics.marks.get(endMark) : Date.now();
      const duration = endTime - startTime;

      const measureData = {
        name,
        startMark,
        endMark: endMark || 'now',
        duration,
        timestamp: Date.now(),
      };

      metrics.measures.push(measureData);

      // Keep only recent measures
      if (metrics.measures.length > PerformanceConfig.metricsRetention) {
        metrics.measures.shift();
      }

      if (PerformanceConfig.enableConsoleOutput) {
        console.log(`[YouTube+ Perf] ${name}: ${duration.toFixed(2)}ms`);
      }

      // Try native performance API
      if (typeof performance !== 'undefined' && performance.measure) {
        try {
          performance.measure(name, startMark, endMark);
        } catch { }
      }

      return duration;
    } catch (e) {
      console.warn('[YouTube+ Perf] Failed to measure:', e);
      return 0;
    }
  };

  /**
   * Time a function execution
   * @param {string} name - Timer name
   * @param {Function} fn - Function to time
   * @returns {Function} Wrapped function
   */
  const timeFunction = (name, fn) => {
    if (!PerformanceConfig.enabled) return fn;

    return /** @this {any} */ function (...args) {
      const startMark = `${name}-start-${Date.now()}`;
      mark(startMark);

      try {
        const fnAny = /** @type {any} */ (fn);
        const result = fnAny.apply(this, args);

        // Handle promises
        if (result && typeof result.then === 'function') {
          return result.finally(() => {
            measure(name, startMark, undefined);
          });
        }

        measure(name, startMark, undefined);
        return result;
      } catch (error) {
        measure(name, startMark, undefined);
        throw error;
      }
    };
  };

  /**
   * Time an async function execution
   * @param {string} name - Timer name
   * @param {Function} fn - Async function to time
   * @returns {Function} Wrapped async function
   */
  const timeAsyncFunction = (name, fn) => {
    if (!PerformanceConfig.enabled) return fn;

    return /** @this {any} */ async function (...args) {
      const startMark = `${name}-start-${Date.now()}`;
      mark(startMark);

      try {
        const fnAny = /** @type {any} */ (fn);
        const result = await fnAny.apply(this, args);
        measure(name, startMark, undefined);
        return result;
      } catch (error) {
        measure(name, startMark, undefined);
        throw error;
      }
    };
  };

  /**
   * Record custom metric
   * @param {string} name - Metric name
   * @param {number} value - Metric value
   * @param {Object} metadata - Additional metadata
   */
  const recordMetric = (name, value, metadata = {}) => {
    if (!PerformanceConfig.enabled) return;

    const metric = {
      name,
      value,
      timestamp: Date.now(),
      ...metadata,
    };

    metrics.timings.set(name, metric);

    if (PerformanceConfig.enableConsoleOutput) {
      console.log(`[YouTube+ Perf] ${name}: ${value}`, metadata);
    }
  };

  /**
   * Get performance statistics
   * @param {string} metricName - Optional metric name filter
   * @returns {Object} Performance statistics
   */
  const getStats = metricName => {
    if (metricName) {
      const filtered = metrics.measures.filter(m => m.name === metricName);
      if (filtered.length === 0) return null;

      const durations = filtered.map(m => m.duration);
      return {
        name: metricName,
        count: durations.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        latest: durations[durations.length - 1],
      };
    }

    // Get all stats
    const allMetrics = {};
    const metricNames = [...new Set(metrics.measures.map(m => m.name))];

    metricNames.forEach(name => {
      allMetrics[name] = getStats(name);
    });

    return {
      metrics: allMetrics,
      totalMeasures: metrics.measures.length,
      totalMarks: metrics.marks.size,
      customMetrics: Object.fromEntries(metrics.timings),
    };
  };

  /**
   * Export metrics to JSON
   * @returns {string} JSON string of metrics
   */
  const exportMetrics = () => {
    const data = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      stats: getStats(undefined),
      measures: metrics.measures,
      customMetrics: Object.fromEntries(metrics.timings),
    };

    return JSON.stringify(data, null, 2);
  };

  /**
   * Clear all performance metrics
   */
  const clearMetrics = () => {
    metrics.timings.clear();
    metrics.marks.clear();
    metrics.measures = [];
    metrics.resources = [];

    try {
      localStorage.removeItem(PerformanceConfig.storageKey);
    } catch { }

    if (typeof performance !== 'undefined' && performance.clearMarks) {
      try {
        performance.clearMarks();
        performance.clearMeasures();
      } catch { }
    }
  };

  /**
   * Monitor DOM mutations performance
   * @param {Element} element - Element to monitor
   * @param {string} name - Monitor name
   * @returns {MutationObserver} The observer instance
   */
  const monitorMutations = (element, name) => {
    if (!PerformanceConfig.enabled) return null;

    let mutationCount = 0;
    const startTime = Date.now();

    const observer = new MutationObserver(mutations => {
      mutationCount += mutations.length;
      recordMetric(`${name}-mutations`, mutationCount, {
        elapsed: Date.now() - startTime,
      });
    });

    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    return observer;
  };

  /**
   * Get browser performance entries
   * @param {string} type - Entry type filter
   * @returns {Array} Performance entries
   */
  const getPerformanceEntries = type => {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) {
      return [];
    }

    try {
      return performance.getEntriesByType(type);
    } catch {
      return [];
    }
  };

  /**
   * Log page load performance
   */
  const logPageLoadMetrics = () => {
    if (!PerformanceConfig.enabled) return;

    try {
      const navigation = getPerformanceEntries('navigation')[0];
      if (navigation) {
        recordMetric('page-load-time', navigation.loadEventEnd - navigation.fetchStart);
        recordMetric('dom-content-loaded', navigation.domContentLoadedEventEnd);
        recordMetric('dom-interactive', navigation.domInteractive);
      }
    } catch (e) {
      console.warn('[YouTube+ Perf] Failed to log page metrics:', e);
    }
  };

  // Auto-log page load metrics
  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') {
      logPageLoadMetrics();
    } else {
      window.addEventListener('load', logPageLoadMetrics, { once: true });
    }

    // Expose performance monitoring API
    window.YouTubePerformance = {
      mark,
      measure,
      timeFunction,
      timeAsyncFunction,
      recordMetric,
      getStats,
      exportMetrics,
      clearMetrics,
      monitorMutations,
      getPerformanceEntries,
      config: PerformanceConfig,
    };

    console.log('[YouTube+] Performance monitoring initialized');
  }
})();

// --- MODULE: main.js ---

/**
 * Identity function that returns the input value unchanged
 * @param {*} value - The value to return
 * @returns {*} The same value
 */
// @ts-nocheck

const identityFn = value => value; /**
 * Ensure TrustedTypes policy exists for secure HTML handling
 * @returns {{createHTML: Function, error: Error|null}} Policy object with createHTML function and error status
 */
function ensureTrustedTypesPolicy() {
  if (typeof trustedTypes === 'undefined') {
    return { createHTML: identityFn, error: null };
  }

  try {
    if (trustedTypes.defaultPolicy === null) {
      trustedTypes.createPolicy('default', {
        createHTML: identityFn,
        createScriptURL: identityFn,
        createScript: identityFn,
      });
    }

    const policy = trustedTypes.defaultPolicy;
    const createHTML =
      policy && typeof policy.createHTML === 'function'
        ? policy.createHTML.bind(policy)
        : identityFn;

    // Validate policy works
    const testDiv = document.createElement('div');
    testDiv.innerHTML = createHTML('1');
    return { createHTML, error: null };
  } catch (error) {
    console.error('TrustedTypes policy creation failed:', error);
    return { createHTML: identityFn, error };
  }
}

/**
 * Create browser tick scheduler for microtask execution
 * @param {Function} existing - Existing scheduler to reuse if version compatible
 * @returns {Function} Scheduler function with version property
 */
function createNextBrowserTick(existing) {
  if (existing && typeof existing === 'function' && existing.version >= 2) {
    return existing;
  }

  const SafePromise = (async () => { })().constructor;
  const queue =
    typeof queueMicrotask === 'function'
      ? callback => queueMicrotask(callback)
      : callback => SafePromise.resolve().then(callback);

  const scheduler = callback => {
    if (typeof callback === 'function') {
      queue(callback);
      return;
    }
    return SafePromise.resolve();
  };

  scheduler.version = 2;
  return scheduler;
}

const { createHTML, error: trustHTMLErr } = ensureTrustedTypesPolicy();

if (trustHTMLErr) {
  console.error(
    '[YouTube+] TrustedHTML Error: Script cannot run due to Content Security Policy restrictions',
    trustHTMLErr
  );
  throw new Error('CSP restriction - cannot initialize TrustedTypes');
}

// Export createHTML for use in modules if needed
if (typeof window !== 'undefined') {
  window._ytplusCreateHTML = createHTML;
}

const nextBrowserTick = createNextBrowserTick(
  (typeof window !== 'undefined' && window.nextBrowserTick) || undefined
);

if (
  typeof window !== 'undefined' &&
  (!window.nextBrowserTick || window.nextBrowserTick.version < 2)
) {
  window.nextBrowserTick = nextBrowserTick;
}

// -----------------------------------------------------------------------------------------------------------------------------

/**
 * Main execution script for YouTube tab view
 * @param {string} _communicationKey - Unique key for cross-context communication (reserved for future use)
 */
const executionScript = _communicationKey => {
  /** @const {boolean} Debug flag for attachment/detachment events */
  const DEBUG_5084 = false;

  /** @const {boolean} Debug flag for tab operations */
  const DEBUG_5085 = false;

  /** @const {boolean} Auto-switch to comments tab when available */
  const TAB_AUTO_SWITCH_TO_COMMENTS = false;

  // Configuration validation
  /** @const {number} Maximum value for attributes before overflow reset */
  const MAX_ATTRIBUTE_VALUE = 1e9;

  /** @const {number} Reset value when attribute exceeds max */
  const ATTRIBUTE_RESET_VALUE = 9;

  // Validate configuration
  if (
    MAX_ATTRIBUTE_VALUE <= 0 ||
    ATTRIBUTE_RESET_VALUE < 0 ||
    ATTRIBUTE_RESET_VALUE >= MAX_ATTRIBUTE_VALUE
  ) {
    console.error(
      '[YouTube+] Invalid configuration: MAX_ATTRIBUTE_VALUE and ATTRIBUTE_RESET_VALUE must be valid positive numbers'
    );
  } // Reuse utility functions from parent scope
  const identityFn = value => value;
  const ensureTrustedTypesPolicyLocal = () => {
    if (typeof trustedTypes === 'undefined') {
      return { createHTML: identityFn, error: null };
    }

    try {
      if (trustedTypes.defaultPolicy === null) {
        trustedTypes.createPolicy('default', {
          createHTML: identityFn,
          createScriptURL: identityFn,
          createScript: identityFn,
        });
      }

      const policy = trustedTypes.defaultPolicy;
      const createHTML = policy?.createHTML?.bind?.(policy) ?? identityFn;

      // Validate policy works
      const testDiv = document.createElement('div');
      testDiv.innerHTML = createHTML('1');
      return { createHTML, error: null };
    } catch (error) {
      console.error('[YouTube+] TrustedTypes local policy failed:', error);
      return { createHTML: identityFn, error };
    }
  };

  /**
   * Create browser tick scheduler for microtask execution
   * @param {Function} existing - Existing scheduler to reuse if version compatible
   * @returns {Function} Scheduler function
   */
  const createNextBrowserTickLocal = existing => {
    if (existing?.version >= 2) {
      return existing;
    }

    const SafePromise = (async () => { })().constructor;
    const queue =
      typeof queueMicrotask === 'function'
        ? callback => queueMicrotask(callback)
        : callback => SafePromise.resolve().then(callback);

    const scheduler = callback => {
      if (typeof callback === 'function') {
        queue(callback);
        return;
      }
      return SafePromise.resolve();
    };

    scheduler.version = 2;
    return scheduler;
  };

  const { createHTML, error: trustHTMLErr } = ensureTrustedTypesPolicyLocal();

  if (trustHTMLErr) {
    console.error(
      '[YouTube+] TrustedHTML Error: Script cannot run due to CSP restrictions',
      trustHTMLErr
    );
    return; // Exit execution script gracefully
  }

  const nextBrowserTick = createNextBrowserTickLocal(
    (typeof window !== 'undefined' && window.nextBrowserTick) || undefined
  );

  if (
    typeof window !== 'undefined' &&
    (!window.nextBrowserTick || window.nextBrowserTick.version < 2)
  ) {
    window.nextBrowserTick = nextBrowserTick;
  }

  try {
    let executionFinished = 0;

    if (typeof CustomElementRegistry === 'undefined') return;
    if (CustomElementRegistry.prototype.define000) return;
    if (typeof CustomElementRegistry.prototype.define !== 'function') return;

    /** @type {HTMLElement} HTMLElement constructor reference */
    const HTMLElement_ = HTMLElement.prototype.constructor;

    /**
     * Simple cache for frequently used querySelector results
     * Helps reduce DOM traversal overhead
     */
    const selectorCache = new Map();
    // eslint-disable-next-line no-unused-vars
    const _CACHE_MAX_SIZE = 50; // Reserved for future cache implementation
    const CACHE_TTL = 5000; // 5 seconds

    /**
     * Clear expired cache entries
     */
    const clearExpiredCache = () => {
      const now = Date.now();
      for (const [key, value] of selectorCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          selectorCache.delete(key);
        }
      }
    };

    // Periodically clear expired cache
    setInterval(clearExpiredCache, CACHE_TTL);

    /**
     * Query single element from a specific parent
     * @param {Element} elm - Parent element to query from
     * @param {string} selector - CSS selector string
     * @returns {Element | null} Found element or null
     */
    const qsOne = (elm, selector) => {
      return HTMLElement_.prototype.querySelector.call(elm, selector);
    };

    /**
     * Query all matching elements from a specific parent
     * @param {Element} elm - Parent element to query from
     * @param {string} selector - CSS selector string
     * @returns {NodeListOf<Element>} NodeList of found elements
     */
    // eslint-disable-next-line no-unused-vars
    const _qsAll = (elm, selector) => {
      return HTMLElement_.prototype.querySelectorAll.call(elm, selector);
    };

    const pdsBaseDF = Object.getOwnPropertyDescriptors(DocumentFragment.prototype);

    Object.defineProperties(DocumentFragment.prototype, {
      replaceChildren000: pdsBaseDF.replaceChildren,
    });

    const pdsBaseNode = Object.getOwnPropertyDescriptors(Node.prototype);

    Object.defineProperties(Node.prototype, {
      appendChild000: pdsBaseNode.appendChild,
      insertBefore000: pdsBaseNode.insertBefore,
    });

    const pdsBaseElement = Object.getOwnPropertyDescriptors(Element.prototype);

    Object.defineProperties(Element.prototype, {
      setAttribute000: pdsBaseElement.setAttribute,
      getAttribute000: pdsBaseElement.getAttribute,
      hasAttribute000: pdsBaseElement.hasAttribute,
      removeAttribute000: pdsBaseElement.removeAttribute,
      querySelector000: pdsBaseElement.querySelector,
      replaceChildren000: pdsBaseElement.replaceChildren,
    });

    /**
     * Set attribute only if value has changed (optimization to reduce DOM operations)
     * @param {string} p - Attribute name
     * @param {*} v - Attribute value
     */
    Element.prototype.setAttribute111 = function (p, v) {
      if (!p || typeof p !== 'string') {
        console.warn('[YouTube+] setAttribute111: invalid attribute name', p);
        return;
      }
      try {
        v = `${v}`;
        if (this.getAttribute000(p) === v) return;
        this.setAttribute000(p, v);
      } catch (error) {
        console.warn('[YouTube+] setAttribute111 failed:', error, p, v);
      }
    };

    /**
     * Increment attribute value (with overflow protection)
     * @param {string} p - Attribute name
     * @returns {number} New attribute value
     */
    Element.prototype.incAttribute111 = function (p) {
      if (!p || typeof p !== 'string') {
        console.warn('[YouTube+] incAttribute111: invalid attribute name', p);
        return 0;
      }
      try {
        let v = +this.getAttribute000(p) || 0;
        v = v > MAX_ATTRIBUTE_VALUE ? ATTRIBUTE_RESET_VALUE : v + 1;
        this.setAttribute000(p, `${v}`);
        return v;
      } catch (error) {
        console.warn('[YouTube+] incAttribute111 failed:', error, p);
        return 0;
      }
    };

    /**
     * Assign children elements in specific order while managing DOM efficiently
     * @param {Array<Node>|null} previousSiblings - Nodes to place before target node
     * @param {Node} node - Target node (required)
     * @param {Array<Node>|null} nextSiblings - Nodes to place after target node
     */
    Element.prototype.assignChildren111 = function (previousSiblings, node, nextSiblings) {
      if (!node) {
        console.warn('[YouTube+] assignChildren111: node is required');
        return;
      }

      try {
        // Collect all child nodes except the target node
        let nodeList = [];
        for (let t = this.firstChild; t instanceof Node; t = t.nextSibling) {
          if (t === node) continue;
          nodeList.push(t);
        }

        inPageRearrange = true;

        if (node.parentNode === this) {
          // Node is already a child, rearrange efficiently
          let fm = new DocumentFragment();

          if (nodeList.length > 0) {
            fm.replaceChildren000(...nodeList);
          }

          if (previousSiblings?.length > 0) {
            fm.replaceChildren000(...previousSiblings);
            this.insertBefore000(fm, node);
          }

          if (nextSiblings?.length > 0) {
            fm.replaceChildren000(...nextSiblings);
            this.appendChild000(fm);
          }

          fm.replaceChildren000();
          fm = null;
        } else {
          // Node is not a child yet, replace all children
          this.replaceChildren000(...(previousSiblings || []), node, ...(nextSiblings || []));
        }

        inPageRearrange = false;

        // Cleanup disconnected nodes
        if (nodeList.length > 0) {
          for (const t of nodeList) {
            if (t instanceof Element && t.isConnected === false) {
              t.remove(); // Trigger removal events
            }
          }
        }

        nodeList.length = 0;
        nodeList = null;
      } catch (error) {
        inPageRearrange = false;
        console.error('[YouTube+] assignChildren111 failed:', error);
      }
    };

    // ==============================================================================================================================================================================================================================================================================

    const DISABLE_FLAGS_SHADYDOM_FREE = true;

    /**
     *
     * Minified Code from https://greasyfork.org/en/scripts/475632-ytconfighacks/code (ytConfigHacks)
     * Date: 2024.04.17
     * Minifier: https://www.toptal.com/developers/javascript-minifier
     *
     */
    (() => {
      const e =
        'undefined' != typeof unsafeWindow ? unsafeWindow : this instanceof Window ? this : window;
      if (!e._ytConfigHacks) {
        let t = 4;
        class n extends Set {
          add(e) {
            if (t <= 0) return console.warn('yt.config_ is already applied on the page.');
            'function' == typeof e && super.add(e);
          }
        }
        const a = (async () => { })().constructor,
          i = (e._ytConfigHacks = new n());
        let l = () => {
          const t = e.ytcsi.originalYtcsi;
          t && ((e.ytcsi = t), (l = null));
        };
        let c = null;
        const o = () => {
          if (t >= 1) {
            const n = (e.yt || 0).config_ || (e.ytcfg || 0).data_ || 0;
            if ('string' == typeof n.INNERTUBE_API_KEY && 'object' == typeof n.EXPERIMENT_FLAGS) {
              for (const a of (--t <= 0 && l && l(), (c = !0), i)) a(n);
            }
          }
        };
        let f = 1;
        const d = t => {
          if ((t = t || e.ytcsi)) {
            return (
              (e.ytcsi = new Proxy(t, {
                get: (e, t) => ('originalYtcsi' === t ? e : (o(), c && --f <= 0 && l && l(), e[t])),
              })),
              !0
            );
          }
        };
        d() ||
          Object.defineProperty(e, 'ytcsi', {
            get() { },
            set: t => (t && (delete e.ytcsi, d(t)), !0),
            enumerable: !1,
            configurable: !0,
          });
        const { addEventListener: s, removeEventListener: y } = Document.prototype;
        function r(t) {
          (o(), t && e.removeEventListener('DOMContentLoaded', r, !1));
        }
        (new a(e => {
          if ('undefined' != typeof AbortSignal) {
            (s.call(document, 'yt-page-data-fetched', e, { once: !0 }),
              s.call(document, 'yt-navigate-finish', e, { once: !0 }),
              s.call(document, 'spfdone', e, { once: !0 }));
          } else {
            const t = () => {
              (e(),
                y.call(document, 'yt-page-data-fetched', t, !1),
                y.call(document, 'yt-navigate-finish', t, !1),
                y.call(document, 'spfdone', t, !1));
            };
            (s.call(document, 'yt-page-data-fetched', t, !1),
              s.call(document, 'yt-navigate-finish', t, !1),
              s.call(document, 'spfdone', t, !1));
          }
        }).then(o),
          new a(e => {
            if ('undefined' != typeof AbortSignal) {
              s.call(document, 'yt-action', e, { once: !0, capture: !0 });
            } else {
              const t = () => {
                (e(), y.call(document, 'yt-action', t, !0));
              };
              s.call(document, 'yt-action', t, !0);
            }
          }).then(o),
          a.resolve().then(() => {
            'loading' !== document.readyState ? r() : e.addEventListener('DOMContentLoaded', r, !1);
          }));
      }
    })();

    let configOnce = false;
    window._ytConfigHacks.add(config_ => {
      if (configOnce) return;
      configOnce = true;

      const EXPERIMENT_FLAGS = config_.EXPERIMENT_FLAGS || 0;
      const EXPERIMENTS_FORCED_FLAGS = config_.EXPERIMENTS_FORCED_FLAGS || 0;
      for (const flags of [EXPERIMENT_FLAGS, EXPERIMENTS_FORCED_FLAGS]) {
        if (flags) {
          // flags.kevlar_watch_metadata_refresh_no_old_secondary_data = false;
          // flags.live_chat_overflow_hide_chat = false;
          flags.web_watch_chat_hide_button_killswitch = false;
          flags.web_watch_theater_chat = false; // for re-openable chat (ytd-watch-flexy's liveChatCollapsed is always undefined)
          flags.suppress_error_204_logging = true;
          flags.kevlar_watch_grid = false; // A/B testing for watch grid

          if (DISABLE_FLAGS_SHADYDOM_FREE) {
            flags.enable_shadydom_free_scoped_node_methods = false;
            flags.enable_shadydom_free_scoped_query_methods = false;
            flags.enable_shadydom_free_scoped_readonly_properties_batch_one = false;
            flags.enable_shadydom_free_parent_node = false;
            flags.enable_shadydom_free_children = false;
            flags.enable_shadydom_free_last_child = false;
          }
        }
      }
    });

    // ===================================================================================================================================================================================================================================
    /* globals WeakRef:false */

    /** @type {(o: Object | null) => WeakRef | null} */
    const mWeakRef =
      typeof WeakRef === 'function' ? o => (o ? new WeakRef(o) : null) : o => o || null; // typeof InvalidVar == 'undefined'

    /** @type {(wr: Object | null) => Object | null} */
    const kRef = wr => (wr && wr.deref ? wr.deref() : wr);

    /** @type {globalThis.PromiseConstructor} */
    /** @type {PromiseConstructor} Safe Promise constructor (YouTube hacks Promise in WaterFox Classic) */
    const Promise = (async () => { })().constructor;

    /**
     * Create a promise that resolves after a delay
     * @param {number} delay - Delay in milliseconds
     * @returns {Promise<void>} Promise that resolves after the delay
     */
    const delayPn = delay => new Promise(fn => setTimeout(fn, delay));

    /**
     * Get polymer controller or instance from element
     * @param {*} o - Element or object to inspect
     * @returns {*} Polymer controller, instance, or the object itself
     */
    const insp = o => (o ? o.polymerController || o.inst || o || 0 : o || 0);

    /** @type {Function} Bound setTimeout to ensure correct context */
    const setTimeout_ = setTimeout.bind(window);

    /**
     * Error handler for promises - logs errors with context
     * @param {Error} error - The error that occurred
     * @param {string} context - Context information about where the error occurred
     */
    const handlePromiseError = (error, context = 'Unknown') => {
      if (error) {
        console.error(`[YouTube+] Promise error in ${context}:`, error);
      }
    };

    /**
     * Promise class with external resolve/reject methods
     * Useful for creating deferred promises that can be resolved externally
     */
    const PromiseExternal = ((resolve_, reject_) => {
      const h = (resolve, reject) => {
        resolve_ = resolve;
        reject_ = reject;
      };
      return class PromiseExternal extends Promise {
        constructor(cb = h) {
          super(cb);
          if (cb === h) {
            /** @type {(value: any) => void} */
            this.resolve = resolve_;
            /** @type {(reason?: any) => void} */
            this.reject = reject_;
          }
        }
      };
    })();

    // ------------------------------------------------------------------------ Event Listener Options ------------------------------------------------------------------------

    /** @const {boolean} Check if passive event listeners are supported */
    const isPassiveArgSupport = typeof IntersectionObserver === 'function';

    /** @const {Object|boolean} Event listener options for bubble phase with passive */
    // eslint-disable-next-line no-unused-vars
    const _bubblePassive = isPassiveArgSupport ? { capture: false, passive: true } : false;

    /** @const {Object|boolean} Event listener options for capture phase with passive */
    const capturePassive = isPassiveArgSupport ? { capture: true, passive: true } : true;

    /**
     * Helper class to manage binary flags as string attributes
     */
    class Attributer {
      /**
       * @param {string} list - String where each character represents a flag
       */
      constructor(list) {
        this.list = list;
        this.flag = 0;
      }

      /**
       * Convert active flags to string representation
       * @returns {string} String with characters for active flags
       */
      makeString() {
        let k = 1;
        let s = '';
        let i = 0;
        while (this.flag >= k) {
          if (this.flag & k) {
            s += this.list[i];
          }
          i++;
          k <<= 1;
        }
        return s;
      }
    }

    /** @type {Attributer} Module loaded state tracker */
    const mLoaded = new Attributer('icp');

    /** @type {WeakMap} WeakMap for self-referencing objects */
    const wrSelfMap = new WeakMap();

    /**
     * Elements cache using Proxy with WeakRef for memory efficiency
     * Automatically manages element references and prevents memory leaks
     * @type {Object.<string, Element | null>}
     */
    const elements = new Proxy(
      {
        related: null,
        comments: null,
        infoExpander: null,
      },
      {
        get(target, prop) {
          return kRef(target[prop]);
        },
        set(target, prop, value) {
          if (value) {
            let wr = wrSelfMap.get(value);
            if (!wr) {
              wr = mWeakRef(value);
              wrSelfMap.set(value, wr);
            }
            target[prop] = wr;
          } else {
            target[prop] = null;
          }
          return true;
        },
      }
    );

    /**
     * Get the main info element from the infoExpander
     * @returns {Element|null} The main info element or null
     */
    const getMainInfo = () => {
      const infoExpander = elements.infoExpander;
      if (!infoExpander) return null;
      const mainInfo = infoExpander.matches('[tyt-main-info]')
        ? infoExpander
        : infoExpander.querySelector000('[tyt-main-info]');
      return mainInfo || null;
    };
    /**
     * Wrap async function to execute in next microtask
     * @param {Function} asyncFn - Async function to wrap
     * @returns {Function} Wrapped function
     */
    // eslint-disable-next-line no-unused-vars
    const _asyncWrap = asyncFn => {
      return () => {
        Promise.resolve().then(asyncFn);
      };
    };

    let pageType = null;

    let pageLang = 'en';
    /**
     * Localized strings for different languages
     * @type {Object.<string, Object.<string, string>>}
     */
    const langWords = {
      en: {
        info: 'Info',
        videos: 'Videos',
        playlist: 'Playlist',
      },
      jp: {
        info: '情報',
        videos: '動画',
        playlist: '再生リスト',
      },
      tw: {
        info: '資訊',
        videos: '影片',
        playlist: '播放清單',
      },
      cn: {
        info: '资讯',
        videos: '视频',
        playlist: '播放列表',
      },
      du: {
        info: 'Info',
        videos: 'Videos',
        playlist: 'Playlist',
      },
      fr: {
        info: 'Info',
        videos: 'Vidéos',
        playlist: 'Playlist',
      },
      kr: {
        info: '정보',
        videos: '동영상',
        playlist: '재생목록',
      },
      ru: {
        info: 'Описание',
        videos: 'Видео',
        playlist: 'Плейлист',
      },
    };

    const svgComments =
      `<path d="M80 27H12A12 12 90 0 0 0 39v42a12 12 90 0 0 12 12h12v20a2 2 90 0 0 3.4 2L47 93h33a12 
  12 90 0 0 12-12V39a12 12 90 0 0-12-12zM20 47h26a2 2 90 1 1 0 4H20a2 2 90 1 1 0-4zm52 28H20a2 2 90 1 1 0-4h52a2 2 90 
  1 1 0 4zm0-12H20a2 2 90 1 1 0-4h52a2 2 90 1 1 0 4zm36-58H40a12 12 90 0 0-12 12v6h52c9 0 16 7 16 16v42h0v4l7 7a2 2 90 
  0 0 3-1V71h2a12 12 90 0 0 12-12V17a12 12 90 0 0-12-12z"/>`.trim();

    const svgVideos =
      `<path d="M89 10c0-4-3-7-7-7H7c-4 0-7 3-7 7v70c0 4 3 7 7 7h75c4 0 7-3 7-7V10zm-62 2h13v10H27V12zm-9 
  66H9V68h9v10zm0-56H9V12h9v10zm22 56H27V68h13v10zm-3-25V36c0-2 2-3 4-2l12 8c2 1 2 4 0 5l-12 8c-2 1-4 0-4-2zm25 
  25H49V68h13v10zm0-56H49V12h13v10zm18 56h-9V68h9v10zm0-56h-9V12h9v10z"/>`.trim();

    const svgInfo =
      `<path d="M30 0C13.3 0 0 13.3 0 30s13.3 30 30 30 30-13.3 30-30S46.7 0 30 0zm6.2 46.6c-1.5.5-2.6 
  1-3.6 1.3a10.9 10.9 0 0 1-3.3.5c-1.7 0-3.3-.5-4.3-1.4a4.68 4.68 0 0 1-1.6-3.6c0-.4.2-1 .2-1.5a20.9 20.9 90 0 1 
  .3-2l2-6.8c.1-.7.3-1.3.4-1.9a8.2 8.2 90 0 0 .3-1.6c0-.8-.3-1.4-.7-1.8s-1-.5-2-.5a4.53 4.53 0 0 0-1.6.3c-.5.2-1 
  .2-1.3.4l.6-2.1c1.2-.5 2.4-1 3.5-1.3s2.3-.6 3.3-.6c1.9 0 3.3.6 4.3 1.3s1.5 2.1 1.5 3.5c0 .3 0 .9-.1 1.6a10.4 10.4 
  90 0 1-.4 2.2l-1.9 6.7c-.2.5-.2 1.1-.4 1.8s-.2 1.3-.2 1.6c0 .9.2 1.6.6 1.9s1.1.5 2.1.5a6.1 6.1 90 0 0 1.5-.3 9 9 90 
  0 0 1.4-.4l-.6 2.2zm-3.8-35.2a1 1 0 010 8.6 1 1 0 010-8.6z"/>`.trim();

    const svgPlayList =
      `<path d="M0 3h12v2H0zm0 4h12v2H0zm0 4h8v2H0zm16 0V7h-2v4h-4v2h4v4h2v-4h4v-2z"/>`.trim();

    // eslint-disable-next-line no-unused-vars
    const svgDiag1 = `<svg stroke="currentColor" fill="none"><path d="M8 2h2v2M7 5l3-3m-6 8H2V8m0 2l3-3"/></svg>`;
    // eslint-disable-next-line no-unused-vars
    const svgDiag2 = `<svg stroke="currentColor" fill="none"><path d="M7 3v2h2M7 5l3-3M5 9V7H3m-1 3l3-3"/></svg>`;

    /**
     * Get GMT offset for the current timezone
     * @returns {string} GMT offset string (e.g., "+9" or "-5")
     */
    // eslint-disable-next-line no-unused-vars
    const getGMT = () => {
      const m = new Date('2023-01-01T00:00:00Z');
      return m.getDate() === 1 ? `+${m.getHours()}` : `-${24 - m.getHours()}`;
    };

    /**
     * Get localized word based on current page language
     * @param {string} tag - Word identifier
     * @returns {string} Localized word or empty string
     */
    function getWord(tag) {
      return langWords[pageLang]?.[tag] || langWords['en']?.[tag] || '';
    }

    /**
     * Create SVG element string
     * @param {number} w - Width
     * @param {number} h - Height
     * @param {number} vw - ViewBox width
     * @param {number} vh - ViewBox height
     * @param {string} p - Path data
     * @param {string} m - Optional class name
     * @returns {string} SVG element string
     */
    const svgElm = (w, h, vw, vh, p, m) =>
      `<svg${m ? ` class=${m}` : ''} width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">${p}</svg>`;

    const hiddenTabsByUserCSS = 0;

    /**
     * Generate HTML for tab buttons
     * @returns {string} HTML string for tabs
     */

    function getTabsHTML() {
      const sTabBtnVideos = `${svgElm(16, 16, 90, 90, svgVideos)}<span>${getWord('videos')}</span>`;
      const sTabBtnInfo = `${svgElm(16, 16, 60, 60, svgInfo)}<span>${getWord('info')}</span>`;
      const sTabBtnPlayList = `${svgElm(16, 16, 20, 20, svgPlayList)}<span>${getWord('playlist')}</span>`;

      const str1 = `
        <paper-ripple class="style-scope yt-icon-button">
            <div id="background" class="style-scope paper-ripple" style="opacity:0;"></div>
            <div id="waves" class="style-scope paper-ripple"></div>
        </paper-ripple>
        `;

      const str_fbtns = `
    <div class="font-size-right">
    <div class="font-size-btn font-size-plus" tyt-di="8rdLQ">
    <svg width="12" height="12" viewbox="0 0 50 50" preserveAspectRatio="xMidYMid meet" 
    stroke="currentColor" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-size">
      <path d="M12 25H38M25 12V38"/>
    </svg>
    </div><div class="font-size-btn font-size-minus" tyt-di="8rdLQ">
    <svg width="12" height="12" viewbox="0 0 50 50" preserveAspectRatio="xMidYMid meet"
    stroke="currentColor" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-size">
      <path d="M12 25h26"/>
    </svg>
    </div>
    </div>
    `.replace(/[\r\n]+/g, '');

      const str_tabs = [
        `<a id="tab-btn1" tyt-di="q9Kjc" tyt-tab-content="#tab-info" class="tab-btn${(hiddenTabsByUserCSS & 1) === 1 ? ' tab-btn-hidden' : ''}">${sTabBtnInfo}${str1}${str_fbtns}</a>`,
        `<a id="tab-btn3" tyt-di="q9Kjc" tyt-tab-content="#tab-comments" class="tab-btn${(hiddenTabsByUserCSS & 2) === 2 ? ' tab-btn-hidden' : ''}">${svgElm(16, 16, 120, 120, svgComments)}<span id="tyt-cm-count"></span>${str1}${str_fbtns}</a>`,
        `<a id="tab-btn4" tyt-di="q9Kjc" tyt-tab-content="#tab-videos" class="tab-btn${(hiddenTabsByUserCSS & 4) === 4 ? ' tab-btn-hidden' : ''}">${sTabBtnVideos}${str1}${str_fbtns}</a>`,
        `<a id="tab-btn5" tyt-di="q9Kjc" tyt-tab-content="#tab-list" class="tab-btn tab-btn-hidden">${sTabBtnPlayList}${str1}${str_fbtns}</a>`,
      ].join('');

      const addHTML = `
        <div id="right-tabs">
            <tabview-view-pos-thead></tabview-view-pos-thead>
            <header>
                <div id="material-tabs">
                    ${str_tabs}
                </div>
            </header>
            <div class="tab-content">
                <div id="tab-info" class="tab-content-cld tab-content-hidden" tyt-hidden userscript-scrollbar-render></div>
                <div id="tab-comments" class="tab-content-cld tab-content-hidden" tyt-hidden userscript-scrollbar-render></div>
                <div id="tab-videos" class="tab-content-cld tab-content-hidden" tyt-hidden userscript-scrollbar-render></div>
                <div id="tab-list" class="tab-content-cld tab-content-hidden" tyt-hidden userscript-scrollbar-render></div>
            </div>
        </div>
        `;
      return addHTML;
    }

    function getLang() {
      const htmlLang = ((document || 0).documentElement || 0).lang || '';

      // Language mapping with optimized lookup
      const langMap = {
        en: 'en',
        'en-GB': 'en',
        de: 'du',
        'de-DE': 'du',
        fr: 'fr',
        'fr-CA': 'fr',
        'fr-FR': 'fr',
        'zh-Hant': 'tw',
        'zh-Hant-HK': 'tw',
        'zh-Hant-TW': 'tw',
        'zh-Hans': 'cn',
        'zh-Hans-CN': 'cn',
        ja: 'jp',
        'ja-JP': 'jp',
        ko: 'kr',
        'ko-KR': 'kr',
        ru: 'ru',
        'ru-RU': 'ru',
      };

      return langMap[htmlLang] || 'en';
    }

    function getLangForPage() {
      const lang = getLang();
      pageLang = langWords[lang] ? lang : 'en';
    }

    /** @type {Object.<string, number>} */
    const _locks = {};

    const lockGet = new Proxy(_locks, {
      get(target, prop) {
        return target[prop] || 0;
      },
      set(_target, _prop, _val) {
        return true;
      },
    });

    const lockSet = new Proxy(_locks, {
      get(target, prop) {
        if (target[prop] > MAX_ATTRIBUTE_VALUE) target[prop] = ATTRIBUTE_RESET_VALUE;
        return (target[prop] = (target[prop] || 0) + 1);
      },
      set(_target, _prop, _val) {
        return true;
      },
    });

    // note: xxxxxxxxxAsyncLock is not expected for calling multiple time in a short period.
    //       it is just to split the process into microTasks.

    const videosElementProvidedPromise = new PromiseExternal();
    const navigateFinishedPromise = new PromiseExternal();

    let isRightTabsInserted = false;
    const rightTabsProvidedPromise = new PromiseExternal();

    const infoExpanderElementProvidedPromise = new PromiseExternal();

    const cmAttr = document.createComment('1');
    const cmAttrStack = [];

    /**
     * Add function to attribute change stack
     * @param {Function} f - Function to execute on attribute change
     */
    // eslint-disable-next-line no-unused-vars
    const cmAttrStackPush = f => {
      cmAttrStack.push(f);
      cmAttr.data = `${(cmAttr.data & 7) + 1}`;
    };

    const cmAttrObs = new MutationObserver(() => {
      cmAttrStack.forEach(fn => fn());
    });
    cmAttrObs.observe(cmAttr, { characterData: true });

    /**
     * Function to calculate if element can collapse
     * @param {*} _s - Parameter (unused but kept for compatibility)
     */
    const funcCanCollapse = function (_s) {
      const content = this.content || this.$.content;
      this.canToggle =
        this.shouldUseNumberOfLines &&
          (this.alwaysCollapsed || this.collapsed || this.isToggled === false)
          ? this.alwaysToggleable ||
          this.isToggled ||
          (content && content.offsetHeight < content.scrollHeight)
          : this.alwaysToggleable ||
          this.isToggled ||
          (content && content.scrollHeight > this.collapsedHeight);
    };

    const aoChatAttrChangeFn = async lockId => {
      if (lockGet['aoChatAttrAsyncLock'] !== lockId) return;

      const chatElm = elements.chat;
      const ytdFlexyElm = elements.flexy;
      if (chatElm && ytdFlexyElm) {
        const isChatCollapsed = chatElm.hasAttribute000('collapsed');
        if (isChatCollapsed) {
          ytdFlexyElm.setAttribute111('tyt-chat-collapsed', '');
        } else {
          ytdFlexyElm.removeAttribute000('tyt-chat-collapsed');
        }

        ytdFlexyElm.setAttribute111('tyt-chat', isChatCollapsed ? '-' : '+');
      }
    };

    const aoPlayListAttrChangeFn = async lockId => {
      if (lockGet['aoPlayListAttrAsyncLock'] !== lockId) return;

      const playlistElm = elements.playlist;
      const ytdFlexyElm = elements.flexy;
      if (playlistElm && ytdFlexyElm) {
        if (playlistElm.hasAttribute000('collapsed')) {
          ytdFlexyElm.removeAttribute000('tyt-playlist-expanded');
        } else {
          ytdFlexyElm.setAttribute111('tyt-playlist-expanded', '');
        }
      } else if (ytdFlexyElm) {
        ytdFlexyElm.removeAttribute000('tyt-playlist-expanded');
      }
    };

    const aoChat = new MutationObserver(() => {
      Promise.resolve(lockSet['aoChatAttrAsyncLock'])
        .then(aoChatAttrChangeFn)
        .catch(err => handlePromiseError(err, 'aoChatAttrChange'));
    });

    const aoPlayList = new MutationObserver(() => {
      Promise.resolve(lockSet['aoPlayListAttrAsyncLock'])
        .then(aoPlayListAttrChangeFn)
        .catch(err => handlePromiseError(err, 'aoPlayListAttrChange'));
    });

    const aoComment = new MutationObserver(async mutations => {
      const commentsArea = elements.comments;
      const ytdFlexyElm = elements.flexy;

      //tyt-comments-video-id //tyt-comments-data-status // hidden
      if (!commentsArea) return;
      let bfHidden = false;
      let bfCommentsVideoId = false;
      let bfCommentDisabled = false;
      for (const mutation of mutations) {
        if (mutation.attributeName === 'hidden' && mutation.target === commentsArea) {
          bfHidden = true;
        } else if (
          mutation.attributeName === 'tyt-comments-video-id' &&
          mutation.target === commentsArea
        ) {
          bfCommentsVideoId = true;
        } else if (
          mutation.attributeName === 'tyt-comments-data-status' &&
          mutation.target === commentsArea
        ) {
          bfCommentDisabled = true;
        }
      }

      if (bfHidden) {
        if (!commentsArea.hasAttribute000('hidden')) {
          Promise.resolve(commentsArea)
            .then(eventMap['settingCommentsVideoId'])
            .catch(err => handlePromiseError(err, 'settingCommentsVideoId'));
        }

        Promise.resolve(lockSet['removeKeepCommentsScrollerLock'])
          .then(removeKeepCommentsScroller)
          .catch(err => handlePromiseError(err, 'removeKeepCommentsScroller'));
      }

      if ((bfHidden || bfCommentsVideoId || bfCommentDisabled) && ytdFlexyElm) {
        const commentsDataStatus = +commentsArea.getAttribute000('tyt-comments-data-status');
        if (commentsDataStatus === 2) {
          ytdFlexyElm.setAttribute111('tyt-comment-disabled', '');
        } else if (commentsDataStatus === 1) {
          ytdFlexyElm.removeAttribute000('tyt-comment-disabled');
        }

        Promise.resolve(lockSet['checkCommentsShouldBeHiddenLock'])
          .then(eventMap['checkCommentsShouldBeHidden'])
          .catch(err => handlePromiseError(err, 'checkCommentsShouldBeHidden'));

        const lockId = lockSet['rightTabReadyLock01'];
        await rightTabsProvidedPromise.then();
        if (lockGet['rightTabReadyLock01'] !== lockId) return;

        if (elements.comments !== commentsArea) return;
        if (commentsArea.isConnected === false) return;
        // console.log(7932, 'comments');

        if (commentsArea.closest('#tab-comments')) {
          const shouldTabVisible = !commentsArea.closest('[hidden]');
          document
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.toggle('tab-btn-hidden', !shouldTabVisible);
        }
      }
    });

    const ioComment = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const target = entry.target;
          const cnt = insp(target);
          if (
            entry.isIntersecting &&
            target instanceof HTMLElement_ &&
            typeof cnt.calculateCanCollapse === 'function'
          ) {
            lockSet['removeKeepCommentsScrollerLock'];
            cnt.calculateCanCollapse(true);
            target.setAttribute111('io-intersected', '');
            const ytdFlexyElm = elements.flexy;
            if (ytdFlexyElm && !ytdFlexyElm.hasAttribute000('keep-comments-scroller')) {
              ytdFlexyElm.setAttribute111('keep-comments-scroller', '');
            }
          } else if (target.hasAttribute000('io-intersected')) {
            target.removeAttribute000('io-intersected');
          }
        }
      },
      {
        threshold: [0],
        rootMargin: '32px', // enlarging viewport for getting intersection earlier
      }
    );

    let bFixForResizedTabLater = false;
    let lastRoRightTabsWidth = 0;

    const roRightTabs = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      const width = Math.round(entry.borderBoxSize.inlineSize);

      if (lastRoRightTabsWidth !== width) {
        lastRoRightTabsWidth = width;
        if ((tabAStatus & 2) === 2) {
          bFixForResizedTabLater = false;
          Promise.resolve(1).then(eventMap['fixForTabDisplay']);
        } else {
          bFixForResizedTabLater = true;
        }
      }
    });

    /**
     * Switch to specified tab
     * @param {string|Element} activeLink - Tab link selector or element
     */
    const switchToTab = activeLink => {
      if (typeof activeLink === 'string') {
        activeLink = document.querySelector(`a[tyt-tab-content="${activeLink}"]`) || null;
      }

      const ytdFlexyElm = elements.flexy;
      const links = document.querySelectorAll('#material-tabs a[tyt-tab-content]');

      for (const link of links) {
        const content = document.querySelector(link.getAttribute000('tyt-tab-content'));
        if (!link || !content) continue;

        const isActive = link === activeLink;

        link.classList.toggle('active', isActive);
        content.classList.toggle('tab-content-hidden', !isActive);

        if (isActive) {
          content.removeAttribute000('tyt-hidden');
        } else if (!content.hasAttribute000('tyt-hidden')) {
          content.setAttribute111('tyt-hidden', '');
        }
      }

      const switchingTo = activeLink ? activeLink.getAttribute000('tyt-tab-content') : '';
      if (switchingTo) {
        lastTab = lastPanel = switchingTo;
      }

      if (ytdFlexyElm?.getAttribute000('tyt-chat') === '') {
        ytdFlexyElm.removeAttribute000('tyt-chat');
      }
      ytdFlexyElm?.setAttribute111('tyt-tab', switchingTo);

      if (switchingTo) {
        bFixForResizedTabLater = false;
        Promise.resolve(0).then(eventMap['fixForTabDisplay']);
      }
    };

    let tabAStatus = 0;

    /**
     * Calculate status flags based on element attributes
     * @param {number} r - Initial result value
     * @param {number} flag - Flags to check (bitwise)
     * @returns {number} Calculated status flags
     */
    const calculationFn = (r = 0, flag) => {
      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return r;
      if (flag & 1) {
        r |= 1;
        if (!ytdFlexyElm.hasAttribute000('theater')) r -= 1;
      }
      if (flag & 2) {
        r |= 2;
        if (!ytdFlexyElm.getAttribute000('tyt-tab')) r -= 2;
      }
      if (flag & 4) {
        r |= 4;
        if (ytdFlexyElm.getAttribute000('tyt-chat') !== '-') r -= 4;
      }
      if (flag & 8) {
        r |= 8;
        if (ytdFlexyElm.getAttribute000('tyt-chat') !== '+') r -= 8;
      }
      if (flag & 16) {
        r |= 16;
        if (!ytdFlexyElm.hasAttribute000('is-two-columns_')) r -= 16;
      }
      if (flag & 32) {
        r |= 32;
        if (!ytdFlexyElm.hasAttribute000('tyt-egm-panel_')) r -= 32;
      }
      if (flag & 64) {
        r |= 64;
        if (!document.fullscreenElement) r -= 64;
      }

      if (flag & 128) {
        r |= 128;
        if (!ytdFlexyElm.hasAttribute000('tyt-playlist-expanded')) r -= 128;
      }
      return r;
    };

    /**
     * Check if theater mode is active
     * @returns {boolean} True if theater mode is active
     */
    function isTheater() {
      return Boolean(elements.flexy?.hasAttribute000('theater'));
    }

    /**
     * Get theater mode toggle button
     * @returns {HTMLButtonElement|null} Theater button or null
     */
    function getTheaterButton() {
      return document.querySelector('ytd-watch-flexy #ytd-player button.ytp-size-button');
    }

    /**
     * Enable theater mode
     * @internal Reserved for future use
     */
    // eslint-disable-next-line no-unused-vars
    function ytBtnSetTheater() {
      if (!isTheater()) {
        getTheaterButton()?.click();
      }
    }

    /**
     * Disable theater mode
     */
    function ytBtnCancelTheater() {
      if (isTheater()) {
        getTheaterButton()?.click();
      }
    }

    /**
     * Get element with most nested children (best match)
     * @param {string} selector - CSS selector
     * @returns {Element|null} Element with most children or null
     */
    function getSuitableElement(selector) {
      const elements = document.querySelectorAll(selector);
      let bestIndex = -1;
      let maxDepth = -1;

      for (let i = 0; i < elements.length; i++) {
        const depth = elements[i].getElementsByTagName('*').length;
        if (depth > maxDepth) {
          maxDepth = depth;
          bestIndex = i;
        }
      }

      return bestIndex >= 0 ? elements[bestIndex] : null;
    }

    /**
     * Expand YouTube live chat
     */
    function ytBtnExpandChat() {
      const dom = getSuitableElement('ytd-live-chat-frame#chat');
      const cnt = insp(dom);

      if (cnt && typeof cnt.collapsed === 'boolean') {
        if (typeof cnt.setCollapsedState === 'function') {
          cnt.setCollapsedState({
            setLiveChatCollapsedStateAction: {
              collapsed: false,
            },
          });
          if (cnt.collapsed === false) return;
        }
        cnt.collapsed = false;
        if (cnt.collapsed === false) return;
      }

      let button = document.querySelector(
        'ytd-live-chat-frame#chat[collapsed] > .ytd-live-chat-frame#show-hide-button'
      );
      if (button) {
        button =
          button.querySelector000('div.yt-spec-touch-feedback-shape') ||
          button.querySelector000('ytd-toggle-button-renderer');
        button?.click();
      }
    }

    /**
     * Collapse YouTube live chat
     */
    /**
     * Collapse YouTube live chat panel
     */
    function ytBtnCollapseChat() {
      const dom = getSuitableElement('ytd-live-chat-frame#chat');
      const cnt = insp(dom);

      if (cnt && typeof cnt.collapsed === 'boolean') {
        if (typeof cnt.setCollapsedState === 'function') {
          cnt.setCollapsedState({
            setLiveChatCollapsedStateAction: {
              collapsed: true,
            },
          });
          if (cnt.collapsed === true) return;
        }
        cnt.collapsed = true;
        if (cnt.collapsed === true) return;
      }

      let button = document.querySelector(
        'ytd-live-chat-frame#chat:not([collapsed]) > .ytd-live-chat-frame#show-hide-button'
      );
      if (button) {
        button =
          button.querySelector000('div.yt-spec-touch-feedback-shape') ||
          button.querySelector000('ytd-toggle-button-renderer');
        button?.click();
      }
    }

    /**
     * Control YouTube engagement panels (show/hide)
     * @param {Array|Object} arr - Array of panel actions or single action object
     */
    function ytBtnEgmPanelCore(arr) {
      if (!arr) return;
      if (!('length' in arr)) arr = [arr];

      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return;

      const actions = [];

      for (const entry of arr) {
        if (!entry) continue;

        const { panelId, toHide, toShow } = entry;

        if (toHide === true && !toShow) {
          actions.push({
            changeEngagementPanelVisibilityAction: {
              targetId: panelId,
              visibility: 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN',
            },
          });
        } else if (toShow === true && !toHide) {
          actions.push({
            showEngagementPanelEndpoint: {
              panelIdentifier: panelId,
            },
          });
        }
      }

      if (actions.length > 0) {
        const cnt = insp(ytdFlexyElm);
        cnt.resolveCommand(
          {
            signalServiceEndpoint: {
              signal: 'CLIENT_SIGNAL',
              actions: actions,
            },
          },
          {},
          false
        );
      }
    }

    /*
            function ytBtnCloseEngagementPanel( s) {
              //ePanel.setAttribute('visibility',"ENGAGEMENT_PANEL_VISIBILITY_HIDDEN");
           
              let panelId = s.getAttribute('target-id')
              scriptletDeferred.debounce(() => {
                document.dispatchEvent(new CustomEvent('tyt-engagement-panel-visibility-change', {
                  detail: {
                    panelId,
                    toHide: true
                  }
                }))
              })
           
            }
        
            /**
             * Close all expanded YouTube engagement panels
             */
    function ytBtnCloseEngagementPanels() {
      const actions = [];
      for (const panelElm of document.querySelectorAll(
        `ytd-watch-flexy[flexy][tyt-tab] #panels.ytd-watch-flexy ytd-engagement-panel-section-list-renderer[target-id][visibility]:not([hidden])`
      )) {
        if (
          panelElm.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' &&
          !panelElm.closest('[hidden]')
        ) {
          actions.push({
            panelId: panelElm.getAttribute000('target-id'),
            toHide: true,
          });
        }
      }
      ytBtnEgmPanelCore(actions);
    }

    /**
     * Open YouTube playlist panel
     */
    function ytBtnOpenPlaylist() {
      const cnt = insp(elements.playlist);
      if (cnt && typeof cnt.collapsed === 'boolean') {
        cnt.collapsed = false;
      }
    }

    /**
     * Close YouTube playlist panel
     */
    function ytBtnClosePlaylist() {
      const cnt = insp(elements.playlist);
      if (cnt && typeof cnt.collapsed === 'boolean') {
        cnt.collapsed = true;
      }
    }

    const updateChatLocation498 = function () {
      /*
               
                          updateChatLocation: function() {
                          if (this.is !== "ytd-watch-grid" && y("web_watch_theater_chat")) {
                              var a = T(this.hostElement).querySelector("#chat-container")
                                , b = this.theater && (!this.fullscreen || y("web_watch_fullscreen_panels"));
                              this.watchWhileWindowSizeSufficient && this.liveChatPresentAndExpanded && b ? y("web_watch_theater_chat_beside_player") ? (b = T(this.hostElement).querySelector("#panels-full-bleed-container"),
                              (a == null ? void 0 : a.parentElement) !== b && b.append(a),
                              this.panelsBesidePlayer = !0) : y("web_watch_theater_fixed_chat") && (b = T(this.hostElement).querySelector("#columns"),
                              (a == null ? void 0 : a.parentElement) !== b && b.append(a),
                              this.fixedPanels = !0) : (y("web_watch_theater_chat_beside_player") ? this.panelsBesidePlayer = !1 : y("web_watch_theater_fixed_chat") && (this.fixedPanels = !1),
                              b = T(this.hostElement).querySelector("#playlist"),
                              a && b ? Fh(a, b) : Gm(new zk("Missing element when updating chat location",{
                                  "chatContainer defined": !!a,
                                  "playlist defined": !!b
                              })));
                              this.updatePageMediaQueries();
                              this.schedulePlayerSizeUpdate_()
                          }
                      },
               
                      */

      // console.log('updateChatLocation498')
      if (this.is !== 'ytd-watch-grid') {
        this.updatePageMediaQueries();
        this.schedulePlayerSizeUpdate_();
      }
    };

    const mirrorNodeWS = new WeakMap();

    /*
              const infoFix = () => {
                const infoExpander = elements.infoExpander;
                const ytdFlexyElm = elements.flexy;
                if (!infoExpander || !ytdFlexyElm) return;
                console.log(386, infoExpander, infoExpander.matches('#tab-info > [class]'))
                if (!infoExpander.matches('#tab-info > [class]')) return;
                // const elms = [...document.querySelectorAll('ytd-watch-metadata.ytd-watch-flexy div[slot="extra-content"], ytd-watch-metadata.ytd-watch-flexy ytd-metadata-row-container-renderer')].filter(elm=>{
                //   if(elm.parentNode.closest('div[slot="extra-content"], ytd-metadata-row-container-renderer')) return false;
                //    return true;
                // });
            
            
            
                const requireElements = [...document.querySelectorAll('ytd-watch-metadata.ytd-watch-flexy div[slot="extra-content"] > *, ytd-watch-metadata.ytd-watch-flexy #extra-content > *')].filter(elm => {
                  return typeof elm.is == 'string'
                }).map(elm => {
                  const is = elm.is;
                  while (elm instanceof HTMLElement_) {
                    const q = [...elm.querySelectorAll(is)].filter(e => insp(e).data);
                    if (q.length >= 1) return q[0];
                    elm = elm.parentNode;
                  }
                }).filter(elm => !!elm && typeof elm.is === 'string');
                console.log(requireElements)
            
                const source = requireElements.map(entry=>({
                  data: insp(entry).data,
                  tag: insp(entry).is,
                  elm: entry
                }))
            
                if (!document.querySelector('noscript#aythl')) {
                  const noscript = document.createElement('noscript')
                  noscript.id = 'aythl';
                  ytdFlexyElm.insertBefore000(noscript, ytdFlexyElm.firstChild);
            
                }
                const noscript = document.querySelector('noscript#aythl');
            
                const clones = new Set();
                for (const {data, tag, elm} of source) {
            
                  // const cloneNode = document.createElement(tag);
                  let cloneNode = elm.cloneNode(true);
                  // noscript.appendChild(cloneNode);
                  // insp(cloneNode).data = null;
                  insp(cloneNode).data = data;
                  source.clone = cloneNode;
                  clones.add(cloneNode);
                }
            
            
                // const elms = [...document.querySelectorAll('ytd-watch-metadata.ytd-watch-flexy div[slot="extra-content"]')].filter(elm => {
                //   if (elm.parentNode.closest('div[slot="extra-content"], ytd-metadata-row-container-renderer')) return false;
                //   return true;
                // });
            
                // let arr = [];
                // for(const elm of elms){
                //   if(elm.hasAttribute('slot')) arr.push(...elm.childNodes);
                //   else arr.push(elm);
                // }
                // arr = arr.filter(e=>e && e.nodeType === 1);
                // console.log(386,arr)
            
                // const clones = arr.map(e=>e.cloneNode(true));
            
                // for(let node = infoExpander.nextSibling; node instanceof Node; node = node.nextSibling) node.remove();
            
                // infoExpander.parentNode.assignChildren111(null, infoExpander, [...clones]);
                let removal = [];
                for(let node = infoExpander.nextSibling; node instanceof Node; node = node.nextSibling)removal.push(node);
                for(const node of removal) node.remove();
                for(const node of clones) infoExpander.parentNode.appendChild(node);
                
            
                for (const {data, tag, elm, clone} of source) {
            
                  insp(clone).data = null;
                  insp(clone).data = data;
                }
            
                // console.log(infoExpander.parentNode.childNodes)
              }
            */

    const dummyNode = document.createElement('noscript');

    // const __j4838__ = Symbol();
    const __j4836__ = Symbol();
    const __j5744__ = Symbol(); // original element
    const __j5733__ = Symbol(); // __lastChanged__

    const monitorDataChangedByDOMMutation = async function (_mutations) {
      const nodeWR = this;
      const node = kRef(nodeWR);
      if (!node) return;

      const cnt = insp(node);
      const __lastChanged__ = cnt[__j5733__];

      const val = cnt.data ? cnt.data[__j4836__] || 1 : 0;

      if (__lastChanged__ !== val) {
        cnt[__j5733__] = val > 0 ? (cnt.data[__j4836__] = Date.now()) : 0;

        await Promise.resolve(); // required for making sufficient delay for data rendering
        attributeInc(node, 'tyt-data-change-counter'); // next macro task
      }
    };

    const moChangeReflection = function (mutations) {
      const nodeWR = this;
      const node = kRef(nodeWR);
      if (!node) return;
      const originElement = kRef(node[__j5744__] || null) || null;
      if (!originElement) return;

      const cnt = insp(node);
      const oriCnt = insp(originElement);

      if (mutations) {
        let bfDataChangeCounter = false;
        for (const mutation of mutations) {
          if (
            mutation.attributeName === 'tyt-clone-refresh-count' &&
            mutation.target === originElement
          ) {
            bfDataChangeCounter = true;
          } else if (
            mutation.attributeName === 'tyt-data-change-counter' &&
            mutation.target === originElement
          ) {
            bfDataChangeCounter = true;
          }
        }
        if (bfDataChangeCounter && oriCnt.data) {
          node.replaceWith(dummyNode);
          cnt.data = Object.assign({}, oriCnt.data);
          dummyNode.replaceWith(node);
        }
      }
    };

    /*
            const moChangeReflection = async function (mutations) {
          
              const nodeWR = this;
              const node = kRef(nodeWR);
              if (!node) return;
              const originElement = kRef(node[__j5744__] || null) || null;
              if (!originElement) return;
          
              const cnt = insp(node);
              const oriCnt = insp(originElement);
          
              if(mutations){
          
                let bfDataChangeCounter = false;
                for (const mutation of mutations) {
                  if (mutation.attributeName === 'tyt-data-change-counter' && mutation.target === originElement) {
                    bfDataChangeCounter = true;
                  }
                }
                if(bfDataChangeCounter && oriCnt.data){
                  node.replaceWith(dummyNode);
                  cnt.data = Object.assign({}, oriCnt.data);
                  dummyNode.replaceWith(node);
                }
          
              } 
          
              // console.log(8348, originElement)
          
              if (cnt.isAttached === false) {
                // do nothing
                // don't call infoFix() as it shall be only called in ytd-expander::attached and yt-navigate-finish
              } else if (oriCnt.isAttached === false && cnt.isAttached === true) {
                if (node.isConnected && node.parentNode instanceof HTMLElement_) {
                  node.parentNode.removeChild(node);
                } else {
                  node.remove();
                }
                if (oriCnt.data !== null) {
                  cnt.data = null;
                }
              } else if (oriCnt.isAttached === true && cnt.isAttached === true) {
                if (!oriCnt.data) {
                  if(cnt.data){
                    cnt.data = null;
                  }
                } else if (!cnt.data || oriCnt.data[__j4838__] !== cnt.data[__j4838__]) {
                  oriCnt.data[__j4838__] = Date.now();
                  await Promise.resolve(); // required for making sufficient delay for data rendering
                  attributeInc(originElement, 'tyt-data-change-counter'); // next macro task
                }
              }
          
            };
            */

    /**
     * Increment attribute value with overflow protection
     * @param {Element} elm - Element to modify
     * @param {string} prop - Attribute name
     * @returns {number} New attribute value
     */
    const attributeInc = (elm, prop) => {
      let v = (+elm.getAttribute000(prop) || 0) + 1;
      if (v > MAX_ATTRIBUTE_VALUE) v = ATTRIBUTE_RESET_VALUE;
      elm.setAttribute000(prop, v);
      return v;
    };

    /**
     * Validates if a string is a valid YouTube channel ID
     * Format: UC[-_a-zA-Z0-9+=.]{22}
     * @see https://support.google.com/youtube/answer/6070344?hl=en
     * @param {string} x - The string to validate
     * @returns {boolean} True if valid channel ID
     */
    const isChannelId = x => {
      return typeof x === 'string' && x.length === 24 && /^UC[-_a-zA-Z0-9+=.]{22}$/.test(x);
    };

    /**
     * Fix and organize info panel layout
     * @param {number|null} lockId - Lock identifier for concurrent execution control
     */
    const infoFix = lockId => {
      if (lockId !== null && lockGet['infoFixLock'] !== lockId) return;
      const infoExpander = elements.infoExpander;
      const infoContainer =
        (infoExpander ? infoExpander.parentNode : null) || document.querySelector('#tab-info');
      const ytdFlexyElm = elements.flexy;
      if (!infoContainer || !ytdFlexyElm) return;
      if (infoExpander) {
        const match =
          infoExpander.matches('#tab-info > [class]') ||
          infoExpander.matches('#tab-info > [tyt-main-info]');
        if (!match) return;
      }

      const requireElements = [
        ...document.querySelectorAll(
          'ytd-watch-metadata.ytd-watch-flexy div[slot="extra-content"] > *, ytd-watch-metadata.ytd-watch-flexy #extra-content > *'
        ),
      ]
        .filter(elm => {
          return typeof elm.is == 'string';
        })
        .map(elm => {
          const is = elm.is;
          while (elm instanceof HTMLElement_) {
            const q = [...elm.querySelectorAll(is)].filter(e => insp(e).data);
            if (q.length >= 1) return q[0];
            elm = elm.parentNode;
          }
        })
        .filter(elm => !!elm && typeof elm.is === 'string');

      const source = requireElements.map(entry => {
        const inst = insp(entry);
        return {
          data: inst.data,
          tag: inst.is,
          elm: entry,
        };
      });

      let noscript_ = document.querySelector('noscript#aythl');
      if (!noscript_) {
        noscript_ = document.createElement('noscript');
        noscript_.id = 'aythl';

        inPageRearrange = true;
        ytdFlexyElm.insertBefore000(noscript_, ytdFlexyElm.firstChild);
        inPageRearrange = false;
      }
      const noscript = noscript_;

      let requiredUpdate = false;
      const mirrorElmSet = new Set();
      const targetParent = infoContainer;
      for (const { data, tag: tag, elm: s } of source) {
        let mirrorNode = mirrorNodeWS.get(s);
        mirrorNode = mirrorNode ? kRef(mirrorNode) : mirrorNode;
        if (!mirrorNode) {
          const cnt = insp(s);
          const cProto = cnt.constructor.prototype;

          const element = document.createElement(tag);
          noscript.appendChild(element);
          mirrorNode = element;
          mirrorNode[__j5744__] = mWeakRef(s);

          const nodeWR = mWeakRef(mirrorNode);

          new MutationObserver(moChangeReflection.bind(nodeWR)).observe(s, {
            attributes: true,
            attributeFilter: ['tyt-clone-refresh-count', 'tyt-data-change-counter'],
          });

          s.jy8432 = 1;
          if (
            !(cProto instanceof Node) &&
            !cProto._dataChanged496 &&
            typeof cProto._createPropertyObserver === 'function'
          ) {
            cProto._dataChanged496 = function () {
              const cnt = this;
              const node = cnt.hostElement || cnt;
              if (node.jy8432) {
                attributeInc(node, 'tyt-data-change-counter');
              }
            };
            cProto._createPropertyObserver('data', '_dataChanged496', undefined);
          } else if (
            !(cProto instanceof Node) &&
            !cProto._dataChanged496 &&
            cProto.useSignals === true &&
            insp(s).signalProxy
          ) {
            const dataSignal = cnt?.signalProxy?.signalCache?.data;
            if (
              dataSignal &&
              typeof dataSignal.setWithPath === 'function' &&
              !dataSignal.setWithPath573 &&
              !dataSignal.controller573
            ) {
              dataSignal.controller573 = mWeakRef(cnt);
              dataSignal.setWithPath573 = dataSignal.setWithPath;
              dataSignal.setWithPath = function () {
                const cnt = kRef(this.controller573 || null) || null;
                cnt &&
                  typeof cnt._dataChanged496k === 'function' &&
                  Promise.resolve(cnt)
                    .then(cnt._dataChanged496k)
                    .catch(err => handlePromiseError(err, 'setWithPath_dataChanged496k'));
                return this.setWithPath573(...arguments);
              };
              cProto._dataChanged496 = function () {
                const cnt = this;
                const node = cnt.hostElement || cnt;
                if (node.jy8432) {
                  attributeInc(node, 'tyt-data-change-counter');
                }
              };
              cProto._dataChanged496k = cnt => cnt._dataChanged496();
            }
          }

          if (!cProto._dataChanged496) {
            new MutationObserver(
              monitorDataChangedByDOMMutation.bind(mirrorNode[__j5744__])
            ).observe(s, { attributes: true, childList: true, subtree: true });
          }

          mirrorNodeWS.set(s, nodeWR);
          requiredUpdate = true;
        } else {
          if (mirrorNode.parentNode !== targetParent) {
            requiredUpdate = true;
          }
        }
        if (!requiredUpdate) {
          const cloneNodeCnt = insp(mirrorNode);
          if (cloneNodeCnt.data !== data) {
            // if(mirrorNode.parentNode !== noscript){
            //   noscript.appendChild(mirrorNode);
            // }
            // mirrorNode.replaceWith(dummyNode);
            // cloneNodeCnt.data = data;
            // dummyNode.replaceWith(mirrorNode);
            requiredUpdate = true;
          }
        }

        mirrorElmSet.add(mirrorNode);
        source.mirrored = mirrorNode;
      }

      const mirroElmArr = [...mirrorElmSet];
      mirrorElmSet.clear();

      if (!requiredUpdate) {
        let e = infoExpander ? -1 : 0;
        // DOM Tree Check
        for (let n = targetParent.firstChild; n instanceof Node; n = n.nextSibling) {
          const target = e < 0 ? infoExpander : mirroElmArr[e];
          e++;
          if (n !== target) {
            // target can be undefined if index overflow
            requiredUpdate = true;
            break;
          }
        }
        if (!requiredUpdate && e !== mirroElmArr.length + 1) requiredUpdate = true;
      }

      if (requiredUpdate) {
        if (infoExpander) {
          targetParent.assignChildren111(null, infoExpander, mirroElmArr);
        } else {
          targetParent.replaceChildren000(...mirroElmArr);
        }
        for (const mirrorElm of mirroElmArr) {
          // trigger data assignment and record refresh count by manual update
          const j = attributeInc(mirrorElm, 'tyt-clone-refresh-count');
          const oriElm = kRef(mirrorElm[__j5744__] || null) || null;
          if (oriElm) {
            oriElm.setAttribute111('tyt-clone-refresh-count', j);
          }
        }
      }

      mirroElmArr.length = 0;
      source.length = 0;
    };

    /**
     * Fix and optimize secondary layout structure
     * @param {number} lockId - Lock identifier for concurrent execution control
     */
    const layoutFix = lockId => {
      if (lockGet['layoutFixLock'] !== lockId) return;
      // console.log('((layoutFix))')

      const secondaryWrapper = document.querySelector(
        '#secondary-inner.style-scope.ytd-watch-flexy > secondary-wrapper'
      );
      // console.log(3838, !!chatContainer, !!(secondaryWrapper && secondaryInner), secondaryInner?.firstChild, secondaryInner?.lastChild , secondaryWrapper?.parentNode === secondaryInner)
      if (secondaryWrapper) {
        const secondaryInner = secondaryWrapper.parentNode;

        const chatContainer = document.querySelector(
          '#columns.style-scope.ytd-watch-flexy [tyt-chat-container]'
        );
        if (
          secondaryInner.firstChild !== secondaryInner.lastChild ||
          (chatContainer && !chatContainer.closest('secondary-wrapper'))
        ) {
          // console.log(38381)
          const w = [];
          const w2 = [];
          for (
            let node = secondaryInner.firstChild;
            node instanceof Node;
            node = node.nextSibling
          ) {
            if (node === chatContainer && chatContainer) {
            } else if (node === secondaryWrapper) {
              for (
                let node2 = secondaryWrapper.firstChild;
                node2 instanceof Node;
                node2 = node2.nextSibling
              ) {
                if (node2 === chatContainer && chatContainer) {
                } else {
                  if (node2.id === 'right-tabs' && chatContainer) {
                    w2.push(chatContainer);
                  }
                  w2.push(node2);
                }
              }
            } else {
              w.push(node);
            }
          }
          // console.log('qww', w, w2)

          inPageRearrange = true;
          secondaryWrapper.replaceChildren000(...w, ...w2);
          inPageRearrange = false;
          const chatElm = elements.chat;
          const chatCnt = insp(chatElm);
          if (
            chatCnt &&
            typeof chatCnt.urlChanged === 'function' &&
            secondaryWrapper.contains(chatElm)
          ) {
            // setTimeout(() => chatCnt.urlChanged, 136);
            if (typeof chatCnt.urlChangedAsync12 === 'function') {
              DEBUG_5085 && console.log('elements.chat urlChangedAsync12', 61);
              chatCnt.urlChanged();
            } else {
              DEBUG_5085 && console.log('elements.chat urlChangedAsync12', 62);
              setTimeout(() => chatCnt.urlChanged(), 136);
            }
          }
        }
      }
    };

    let lastPanel = '';
    let lastTab = '';
    // let fixInitialTabState = 0;

    const aoEgmPanels = new MutationObserver(() => {
      // console.log(5094,3);
      Promise.resolve(lockSet['updateEgmPanelsLock'])
        .then(updateEgmPanels)
        .catch(err => handlePromiseError(err, 'aoEgmPanels_updateEgmPanels'));
    });

    const removeKeepCommentsScroller = async lockId => {
      if (lockGet['removeKeepCommentsScrollerLock'] !== lockId) return;
      await Promise.resolve();
      if (lockGet['removeKeepCommentsScrollerLock'] !== lockId) return;
      const ytdFlexyFlm = elements.flexy;
      if (ytdFlexyFlm) {
        ytdFlexyFlm.removeAttribute000('keep-comments-scroller');
      }
    };

    const updateEgmPanels = async lockId => {
      if (lockId !== lockGet['updateEgmPanelsLock']) return;
      await navigateFinishedPromise.then().catch(console.warn);
      if (lockId !== lockGet['updateEgmPanelsLock']) return;
      // console.log('updateEgmPanels::called');
      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return;
      let newVisiblePanels = [];
      let newHiddenPanels = [];
      let allVisiblePanels = [];
      for (const panelElm of document.querySelectorAll('[tyt-egm-panel][target-id][visibility]')) {
        const visibility = panelElm.getAttribute000('visibility');

        if (visibility === 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN' || panelElm.closest('[hidden]')) {
          if (panelElm.hasAttribute000('tyt-visible-at')) {
            panelElm.removeAttribute000('tyt-visible-at');
            newHiddenPanels.push(panelElm);
          }
        } else if (
          visibility === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' &&
          !panelElm.closest('[hidden]')
        ) {
          const visibleAt = panelElm.getAttribute000('tyt-visible-at');
          if (!visibleAt) {
            panelElm.setAttribute111('tyt-visible-at', Date.now());
            newVisiblePanels.push(panelElm);
          }
          allVisiblePanels.push(panelElm);
        }
      }
      if (newVisiblePanels.length >= 1 && allVisiblePanels.length >= 2) {
        const targetVisible = newVisiblePanels[newVisiblePanels.length - 1];

        const actions = [];
        for (const panelElm of allVisiblePanels) {
          if (panelElm === targetVisible) continue;
          actions.push({
            panelId: panelElm.getAttribute000('target-id'),
            toHide: true,
          });
        }

        if (actions.length >= 1) {
          ytBtnEgmPanelCore(actions);
        }
      }
      if (allVisiblePanels.length >= 1) {
        ytdFlexyElm.setAttribute111('tyt-egm-panel_', '');
      } else {
        ytdFlexyElm.removeAttribute000('tyt-egm-panel_');
      }
      newVisiblePanels.length = 0;
      newVisiblePanels = null;
      newHiddenPanels.length = 0;
      newHiddenPanels = null;
      allVisiblePanels.length = 0;
      allVisiblePanels = null;
    };

    const checkElementExist = (css, exclude) => {
      for (const p of document.querySelectorAll(css)) {
        if (!p.closest(exclude)) return p;
      }
      return null;
    };

    let fixInitialTabStateK = 0;

    const { handleNavigateFactory } = (() => {
      let isLoadStartListened = false;

      function findLcComment(lc) {
        if (arguments.length === 1) {
          const element = document.querySelector(
            `#tab-comments ytd-comments ytd-comment-renderer #header-author a[href*="lc=${lc}"]`
          );
          if (element) {
            const commentRendererElm = closestFromAnchor.call(element, 'ytd-comment-renderer');
            if (commentRendererElm && lc) {
              return {
                lc,
                commentRendererElm,
              };
            }
          }
        } else if (arguments.length === 0) {
          const element = document.querySelector(
            `#tab-comments ytd-comments ytd-comment-renderer > #linked-comment-badge span:not(:empty)`
          );
          if (element) {
            const commentRendererElm = closestFromAnchor.call(element, 'ytd-comment-renderer');
            if (commentRendererElm) {
              const header = _querySelector.call(commentRendererElm, '#header-author');
              if (header) {
                const anchor = _querySelector.call(header, 'a[href*="lc="]');
                if (anchor) {
                  const href = anchor.getAttribute('href') || '';
                  const m = /[&?]lc=([\w_.-]+)/.exec(href); // dot = sub-comment
                  if (m) {
                    lc = m[1];
                  }
                }
              }
            }
            if (commentRendererElm && lc) {
              return {
                lc,
                commentRendererElm,
              };
            }
          }
        }

        return null;
      }

      function lcSwapFuncA(targetLcId, currentLcId) {
        let done = 0;
        try {
          // console.log(currentLcId, targetLcId)

          const r1 = findLcComment(currentLcId).commentRendererElm;
          const r2 = findLcComment(targetLcId).commentRendererElm;

          if (
            typeof insp(r1).data.linkedCommentBadge === 'object' &&
            typeof insp(r2).data.linkedCommentBadge === 'undefined'
          ) {
            const p = Object.assign({}, insp(r1).data.linkedCommentBadge);

            if (((p || 0).metadataBadgeRenderer || 0).trackingParams) {
              delete p.metadataBadgeRenderer.trackingParams;
            }

            const v1 = findContentsRenderer(r1);
            const v2 = findContentsRenderer(r2);

            if (
              v1.parent === v2.parent &&
              (v2.parent.nodeName === 'YTD-COMMENTS' ||
                v2.parent.nodeName === 'YTD-ITEM-SECTION-RENDERER')
            ) {
            } else {
              // currently not supported
              return false;
            }

            if (v2.index >= 0) {
              if (v2.parent.nodeName === 'YTD-COMMENT-REPLIES-RENDERER') {
                if (lcSwapFuncB(targetLcId, currentLcId, p)) {
                  done = 1;
                }

                done = 1;
              } else {
                const v2pCnt = insp(v2.parent);
                const v2Conents = (v2pCnt.data || 0).contents || 0;
                if (!v2Conents) console.warn('v2Conents is not found');

                v2pCnt.data = Object.assign({}, v2pCnt.data, {
                  contents: [].concat(
                    [v2Conents[v2.index]],
                    v2Conents.slice(0, v2.index),
                    v2Conents.slice(v2.index + 1)
                  ),
                });

                if (lcSwapFuncB(targetLcId, currentLcId, p)) {
                  done = 1;
                }
              }
            }
          }
        } catch (e) {
          console.warn(e);
        }
        return done === 1;
      }

      function lcSwapFuncB(targetLcId, currentLcId, _p) {
        let done = 0;
        try {
          const r1 = findLcComment(currentLcId).commentRendererElm;
          const r1cnt = insp(r1);
          const r2 = findLcComment(targetLcId).commentRendererElm;
          const r2cnt = insp(r2);

          const r1d = r1cnt.data;
          const p = Object.assign({}, _p);
          r1d.linkedCommentBadge = null;
          delete r1d.linkedCommentBadge;

          const q = Object.assign({}, r1d);
          q.linkedCommentBadge = null;
          delete q.linkedCommentBadge;

          r1cnt.data = Object.assign({}, q);
          r2cnt.data = Object.assign({}, r2cnt.data, { linkedCommentBadge: p });

          done = 1;
        } catch (e) {
          console.warn(e);
        }
        return done === 1;
      }

      const loadStartFx = async evt => {
        const media = (evt || 0).target || 0;
        if (media.nodeName === 'VIDEO' || media.nodeName === 'AUDIO') {
        } else return;

        const newMedia = media;

        const media1 = common.getMediaElement(0); // document.querySelector('#movie_player video[src]');
        const media2 = common.getMediaElements(2); // document.querySelectorAll('ytd-browse[role="main"] video[src]');

        if (media1 !== null && media2.length > 0) {
          if (newMedia !== media1 && media1.paused === false) {
            if (isVideoPlaying(media1)) {
              Promise.resolve(newMedia)
                .then(video => video.paused === false && video.pause())
                .catch(console.warn);
            }
          } else if (newMedia === media1) {
            for (const s of media2) {
              if (s.paused === false) {
                Promise.resolve(s)
                  .then(s => s.paused === false && s.pause())
                  .catch(console.warn);
                break;
              }
            }
          } else {
            Promise.resolve(media1)
              .then(video1 => video1.paused === false && video1.pause())
              .catch(console.warn);
          }
        }
      };

      const getBrowsableEndPoint = req => {
        let valid = false;
        let endpoint = req ? req.command : null;
        if (
          endpoint &&
          (endpoint.commandMetadata || 0).webCommandMetadata &&
          endpoint.watchEndpoint
        ) {
          const videoId = endpoint.watchEndpoint.videoId;
          const url = endpoint.commandMetadata.webCommandMetadata.url;

          if (typeof videoId === 'string' && typeof url === 'string' && url.indexOf('lc=') > 0) {
            const m = /^\/watch\?v=([\w_-]+)&lc=([\w_.-]+)$/.exec(url); // dot = sub-comment
            if (m && m[1] === videoId) {
              /*
                                          {
                                            "style": "BADGE_STYLE_TYPE_SIMPLE",
                                            "label": "注目のコメント",
                                            "trackingParams": "XXXXXX"
                                        }
                                          */

              const targetLc = findLcComment(m[2]);
              const currentLc = targetLc ? findLcComment() : null;

              if (targetLc && currentLc) {
                const done =
                  targetLc.lc === currentLc.lc ? 1 : lcSwapFuncA(targetLc.lc, currentLc.lc) ? 1 : 0;

                if (done === 1) {
                  common.xReplaceState(history.state, url);
                  return;
                }
              }
            }
          }
        }

        /*
                            
                            {
                              "type": 0,
                              "command": endpoint,
                              "form": {
                                "tempData": {},
                                "reload": false
                              }
                            }
                  
                        */

        if (
          endpoint &&
          (endpoint.commandMetadata || 0).webCommandMetadata &&
          endpoint.browseEndpoint &&
          isChannelId(endpoint.browseEndpoint.browseId)
        ) {
          valid = true;
        } else if (
          endpoint &&
          (endpoint.browseEndpoint || endpoint.searchEndpoint) &&
          !endpoint.urlEndpoint &&
          !endpoint.watchEndpoint
        ) {
          if (endpoint.browseEndpoint && endpoint.browseEndpoint.browseId === 'FEwhat_to_watch') {
            // valid = false;
            const playerMedia = common.getMediaElement(1);
            if (playerMedia && playerMedia.paused === false) valid = true; // home page
          } else if (endpoint.commandMetadata && endpoint.commandMetadata.webCommandMetadata) {
            const meta = endpoint.commandMetadata.webCommandMetadata;
            if (meta && /*meta.apiUrl &&*/ meta.url && meta.webPageType) {
              valid = true;
            }
          }
        }

        if (!valid) endpoint = null;

        return endpoint;
      };

      const shouldUseMiniPlayer = () => {
        const isSubTypeExist = document.querySelector(
          'ytd-page-manager#page-manager > ytd-browse[page-subtype]'
        );

        if (isSubTypeExist) return true;

        const movie_player = [...document.querySelectorAll('#movie_player')].filter(
          e => !e.closest('[hidden]')
        )[0];
        if (movie_player) {
          const media = qsOne(movie_player, 'video[class], audio[class]');
          if (
            media &&
            media.currentTime > 3 &&
            media.duration - media.currentTime > 3 &&
            media.paused === false
          ) {
            return true;
          }
        }
        return false;
        // return true;
        // return !!document.querySelector('ytd-page-manager#page-manager > ytd-browse[page-subtype]');
      };

      const conditionFulfillment = req => {
        const endpoint = req ? req.command : null;
        if (!endpoint) return;

        if (
          endpoint &&
          (endpoint.commandMetadata || 0).webCommandMetadata &&
          endpoint.watchEndpoint
        ) {
        } else if (
          endpoint &&
          (endpoint.commandMetadata || 0).webCommandMetadata &&
          endpoint.browseEndpoint &&
          isChannelId(endpoint.browseEndpoint.browseId)
        ) {
        } else if (
          endpoint &&
          (endpoint.browseEndpoint || endpoint.searchEndpoint) &&
          !endpoint.urlEndpoint &&
          !endpoint.watchEndpoint
        ) {
        } else {
          return false;
        }

        if (!shouldUseMiniPlayer()) return false;

        /*
                          // user would like to switch page immediately without playing the video;
                          // attribute appear after playing video for more than 2s
                          if (!document.head.dataset.viTime) return false;
                          else {
                            let currentVideo = common.getMediaElement(0);
                            if (currentVideo && currentVideo.readyState > currentVideo.HAVE_CURRENT_DATA && currentVideo.currentTime > 2.2 && currentVideo.duration - 2.2 < currentVideo.currentTime) {
                              // disable miniview browsing if the media is near to the end
                              return false;
                            }
                          }
                        */

        if (pageType !== 'watch') return false;

        if (
          !checkElementExist(
            'ytd-watch-flexy #player button.ytp-miniplayer-button.ytp-button',
            '[hidden]'
          )
        ) {
          return false;
        }

        return true;
      };

      let u38 = 0;
      const fixChannelAboutPopup = async t38 => {
        let promise = new PromiseExternal();
        const f = () => {
          promise && promise.resolve();
          promise = null;
        };
        document.addEventListener('yt-navigate-finish', f, false);
        await promise.then();
        promise = null;
        document.removeEventListener('yt-navigate-finish', f, false);
        if (t38 !== u38) return;
        setTimeout(() => {
          const currentAbout = [...document.querySelectorAll('ytd-about-channel-renderer')].filter(
            e => !e.closest('[hidden]')
          )[0];
          let okay = false;
          if (!currentAbout) okay = true;
          else {
            const popupContainer = currentAbout.closest('ytd-popup-container');
            if (popupContainer) {
              const cnt = insp(popupContainer);
              let arr = null;
              try {
                arr = cnt.handleGetOpenedPopupsAction_();
              } catch { }
              if (arr && arr.length === 0) okay = true;
            } else {
              okay = false;
            }
          }
          if (okay) {
            const descriptionModel = [
              ...document.querySelectorAll('yt-description-preview-view-model'),
            ].filter(e => !e.closest('[hidden]'))[0];
            if (descriptionModel) {
              const button = [...descriptionModel.querySelectorAll('button')].filter(
                e => !e.closest('[hidden]') && `${e.textContent}`.trim().length > 0
              )[0];
              if (button) {
                button.click();
              }
            }
          }
        }, 80);
      };
      const handleNavigateFactory = handleNavigate => {
        return function (req) {
          if (u38 > MAX_ATTRIBUTE_VALUE) u38 = ATTRIBUTE_RESET_VALUE;
          const t38 = ++u38;

          const $this = this;
          const $arguments = arguments;

          let endpoint = null;

          if (conditionFulfillment(req)) {
            endpoint = getBrowsableEndPoint(req);
          }

          if (!endpoint || !shouldUseMiniPlayer()) return handleNavigate.apply($this, $arguments);

          // console.log('tabview-script-handleNavigate')

          const ytdAppElm = document.querySelector('ytd-app');
          const ytdAppCnt = insp(ytdAppElm);

          let object = null;
          try {
            object = ytdAppCnt.data.response.currentVideoEndpoint.watchEndpoint || null;
          } catch {
            object = null;
          }

          if (typeof object !== 'object') object = null;

          const once = { once: true }; // browsers supporting async function can also use once option.

          if (object !== null && !('playlistId' in object)) {
            let wObject = mWeakRef(object);

            const N = 3;

            let count = 0;

            /*
                                      
                                      rcb(b) => a = playlistId = undefinded
                                      
                                      var scb = function(a, b, c, d) {
                                              a.isInitialized() && (B("kevlar_miniplayer_navigate_to_shorts_killswitch") ? c || d ? ("watch" !== Xu(b) && "shorts" !== Xu(b) && os(a.miniplayerEl, "yt-cache-miniplayer-page-action", [b]),
                                              qs(a.miniplayerEl, "yt-deactivate-miniplayer-action")) : "watch" === Xu(b) && rcb(b) && (qt.getInstance().playlistWatchPageActivation = !0,
                                              a.activateMiniplayer(b)) : c ? ("watch" !== Xu(b) && os(a.miniplayerEl, "yt-cache-miniplayer-page-action", [b]),
                                              qs(a.miniplayerEl, "yt-deactivate-miniplayer-action")) : d ? qs(a.miniplayerEl, "yt-pause-miniplayer-action") : "watch" === Xu(b) && rcb(b) && (qt.getInstance().playlistWatchPageActivation = !0,
                                              a.activateMiniplayer(b)))
                                          };
                            
                                    */

            Object.defineProperty(kRef(wObject) || {}, 'playlistId', {
              get() {
                count++;
                if (count === N) {
                  delete this.playlistId;
                }
                return '*';
              },
              set(value) {
                delete this.playlistId; // remove property definition
                this.playlistId = value; // assign as normal property
              },
              enumerable: false,
              configurable: true,
            });

            let playlistClearout = null;

            let timeoutid = 0;
            Promise.race([
              new Promise(r => {
                timeoutid = setTimeout(r, 4000);
              }),
              new Promise(r => {
                playlistClearout = () => {
                  if (timeoutid > 0) {
                    clearTimeout(timeoutid);
                    timeoutid = 0;
                  }
                  r();
                };
                document.addEventListener('yt-page-type-changed', playlistClearout, once);
              }),
            ])
              .then(() => {
                if (timeoutid !== 0) {
                  playlistClearout &&
                    document.removeEventListener('yt-page-type-changed', playlistClearout, once);
                  timeoutid = 0;
                }
                playlistClearout = null;
                count = N - 1;
                const object = kRef(wObject);
                wObject = null;
                return object ? object.playlistId : null;
              })
              .catch(console.warn);
          }

          if (!isLoadStartListened) {
            isLoadStartListened = true;
            document.addEventListener('loadstart', loadStartFx, true);
          }

          const endpointURL = `${endpoint?.commandMetadata?.webCommandMetadata?.url || ''}`;

          if (
            endpointURL &&
            endpointURL.endsWith('/about') &&
            /\/channel\/UC[-_a-zA-Z0-9+=.]{22}\/about/.test(endpointURL)
          ) {
            fixChannelAboutPopup(t38);
          }

          handleNavigate.apply($this, $arguments);
        };
      };

      return { handleNavigateFactory };
    })();

    const common = (() => {
      let mediaModeLock = 0;
      const _getMediaElement = i => {
        if (mediaModeLock === 0) {
          const e =
            document.querySelector('.video-stream.html5-main-video') ||
            document.querySelector('#movie_player video, #movie_player audio') ||
            document.querySelector('body video[src], body audio[src]');
          if (e) {
            if (e.nodeName === 'VIDEO') mediaModeLock = 1;
            else if (e.nodeName === 'AUDIO') mediaModeLock = 2;
          }
        }
        if (!mediaModeLock) return null;
        if (mediaModeLock === 1) {
          switch (i) {
            case 1:
              return 'ytd-player#ytd-player video[src]';
            case 2:
              return 'ytd-browse[role="main"] video[src]';
            case 0:
            default:
              return '#movie_player video[src]';
          }
        } else if (mediaModeLock === 2) {
          switch (i) {
            case 1:
              return 'ytd-player#ytd-player audio.video-stream.html5-main-video[src]';
            case 2:
              return 'ytd-browse[role="main"] audio.video-stream.html5-main-video[src]';
            case 0:
            default:
              return '#movie_player audio.video-stream.html5-main-video[src]';
          }
        }
        return null;
      };

      return {
        xReplaceState(s, u) {
          try {
            history.replaceState(s, '', u);
          } catch {
            // in case error occurs if replaceState is replaced by any external script / extension
          }
          if (s.endpoint) {
            try {
              const ytdAppElm = document.querySelector('ytd-app');
              const ytdAppCnt = insp(ytdAppElm);
              ytdAppCnt.replaceState(s.endpoint, '', u);
            } catch { }
          }
        },
        getMediaElement(i) {
          const s = _getMediaElement(i) || '';
          if (s) return document.querySelector(s);
          return null;
        },
        getMediaElements(i) {
          const s = _getMediaElement(i) || '';
          if (s) return document.querySelectorAll(s);
          return [];
        },
      };
    })();

    let inPageRearrange = false;
    let tmpLastVideoId = '';
    // const nsMap = new Map();

    const getCurrentVideoId = () => {
      const ytdFlexyElm = elements.flexy;
      const ytdFlexyCnt = insp(ytdFlexyElm);
      if (ytdFlexyCnt && typeof ytdFlexyCnt.videoId === 'string') return ytdFlexyCnt.videoId;
      if (ytdFlexyElm && typeof ytdFlexyElm.videoId === 'string') return ytdFlexyElm.videoId;
      console.log('video id not found');
      return '';
    };

    // eslint-disable-next-line no-unused-vars
    const holdInlineExpanderAlwaysExpanded = inlineExpanderCnt => {
      console.log('holdInlineExpanderAlwaysExpanded');
      if (inlineExpanderCnt.alwaysShowExpandButton === true) {
        inlineExpanderCnt.alwaysShowExpandButton = false;
      }
      if (typeof (inlineExpanderCnt.collapseLabel || 0) === 'string') {
        inlineExpanderCnt.collapseLabel = '';
      }
      if (typeof (inlineExpanderCnt.expandLabel || 0) === 'string') {
        inlineExpanderCnt.expandLabel = '';
      }
      if (inlineExpanderCnt.showCollapseButton === true) {
        inlineExpanderCnt.showCollapseButton = false;
      }
      if (inlineExpanderCnt.showExpandButton === true) inlineExpanderCnt.showExpandButton = false;
      if (inlineExpanderCnt.expandButton instanceof HTMLElement_) {
        inlineExpanderCnt.expandButton = null;
        inlineExpanderCnt.expandButton.remove();
      }
    };

    const fixInlineExpanderDisplay = inlineExpanderCnt => {
      try {
        inlineExpanderCnt.updateIsAttributedExpanded();
      } catch (e) {
        console.warn('[YouTube+] updateIsAttributedExpanded failed:', e);
      }
      try {
        inlineExpanderCnt.updateIsFormattedExpanded();
      } catch (e) {
        console.warn('[YouTube+] updateIsFormattedExpanded failed:', e);
      }
      try {
        inlineExpanderCnt.updateTextOnSnippetTypeChange();
      } catch (e) {
        console.warn('[YouTube+] updateTextOnSnippetTypeChange failed:', e);
      }
      try {
        inlineExpanderCnt.updateStyles();
      } catch (e) {
        console.warn('[YouTube+] updateStyles failed:', e);
      }
    };

    const fixInlineExpanderMethods = inlineExpanderCnt => {
      if (inlineExpanderCnt && !inlineExpanderCnt.__$$idncjk8487$$__) {
        inlineExpanderCnt.__$$idncjk8487$$__ = true;
        inlineExpanderCnt.updateTextOnSnippetTypeChange = function () {
          true || (this.isResetMutation && this.mutationCallback());
        };
        // inlineExpanderCnt.hasAttributedStringText = true;
        inlineExpanderCnt.isResetMutation = true;
        fixInlineExpanderDisplay(inlineExpanderCnt); // do the initial fix
      }
    };

    const fixInlineExpanderContent = () => {
      // console.log(21886,1)
      const mainInfo = getMainInfo();
      if (!mainInfo) return;
      // console.log(21886,2)
      const inlineExpanderElm = mainInfo.querySelector('ytd-text-inline-expander');
      const inlineExpanderCnt = insp(inlineExpanderElm);
      fixInlineExpanderMethods(inlineExpanderCnt);

      // console.log(21886, 3)
      // if (inlineExpanderCnt && inlineExpanderCnt.isExpanded === true && plugin.autoExpandInfoDesc.activated) {
      //   // inlineExpanderCnt.isExpandedChanged();
      //   // holdInlineExpanderAlwaysExpanded(inlineExpanderCnt);
      // }
      // if(inlineExpanderCnt){
      //   // console.log(21886,4, inlineExpanderCnt.isExpanded, inlineExpanderCnt.isTruncated)
      //   if (inlineExpanderCnt.isExpanded === false && inlineExpanderCnt.isTruncated === true) {
      //     // console.log(21881)
      //     inlineExpanderCnt.isTruncated = false;
      //   }
      // }
    };

    const plugin = {
      minibrowser: {
        activated: false,
        toUse: true, // depends on shouldUseMiniPlayer()
        activate() {
          if (this.activated) return;

          // Use global isPassiveArgSupport constant
          // https://caniuse.com/?search=observer
          // https://caniuse.com/?search=addEventListener%20passive

          if (!isPassiveArgSupport) return;

          this.activated = true;

          const ytdAppElm = document.querySelector('ytd-app');
          const ytdAppCnt = insp(ytdAppElm);

          if (!ytdAppCnt) return;

          const cProto = ytdAppCnt.constructor.prototype;

          if (!cProto.handleNavigate) return;

          if (cProto.handleNavigate.__ma355__) return;

          cProto.handleNavigate = handleNavigateFactory(cProto.handleNavigate);

          cProto.handleNavigate.__ma355__ = 1;
        },
      },
      autoExpandInfoDesc: {
        activated: false,
        toUse: false, // false by default; once the expand is clicked, maintain the feature until the browser is closed.
        /** @type { MutationObserver | null } */
        mo: null,
        promiseReady: new PromiseExternal(),
        moFn(lockId) {
          if (lockGet['autoExpandInfoDescAttrAsyncLock'] !== lockId) return;

          const mainInfo = getMainInfo();

          if (!mainInfo) return;
          switch (((mainInfo || 0).nodeName || '').toLowerCase()) {
            case 'ytd-expander':
              if (mainInfo.hasAttribute000('collapsed')) {
                let success = false;
                try {
                  insp(mainInfo).handleMoreTap(new Event('tap'));
                  success = true;
                } catch { }
                if (success) mainInfo.setAttribute111('tyt-no-less-btn', '');
              }
              break;
            case 'ytd-expandable-video-description-body-renderer':
              const inlineExpanderElm = mainInfo.querySelector('ytd-text-inline-expander');
              const inlineExpanderCnt = insp(inlineExpanderElm);
              if (inlineExpanderCnt && inlineExpanderCnt.isExpanded === false) {
                inlineExpanderCnt.isExpanded = true;
                inlineExpanderCnt.isExpandedChanged();
                // holdInlineExpanderAlwaysExpanded(inlineExpanderCnt);
              }
              break;
          }
        },
        activate() {
          if (this.activated) return;

          this.moFn = this.moFn.bind(this);
          this.mo = new MutationObserver(() => {
            Promise.resolve(lockSet['autoExpandInfoDescAttrAsyncLock'])
              .then(this.moFn)
              .catch(console.warn);
          });
          this.activated = true;
          this.promiseReady.resolve();
        },
        async onMainInfoSet(mainInfo) {
          await this.promiseReady.then();
          if (mainInfo.nodeName.toLowerCase() === 'ytd-expander') {
            this.mo.observe(mainInfo, {
              attributes: true,
              attributeFilter: ['collapsed', 'attr-8ifv7'],
            });
          } else {
            this.mo.observe(mainInfo, { attributes: true, attributeFilter: ['attr-8ifv7'] });
          }
          mainInfo.incAttribute111('attr-8ifv7');
        },
      },
      fullChannelNameOnHover: {
        activated: false,
        toUse: true,
        /** @type { MutationObserver | null } */
        mo: null,
        /** @type { ResizeObserver | null} */
        ro: null,
        promiseReady: new PromiseExternal(),
        checkResize: 0,
        mouseEnterFn(evt) {
          const target = evt ? evt.target : null;
          if (!(target instanceof HTMLElement_)) return;
          const metaDataElm = target.closest('ytd-watch-metadata');
          metaDataElm.classList.remove('tyt-metadata-hover-resized');
          this.checkResize = Date.now() + 300;
          metaDataElm.classList.add('tyt-metadata-hover');
          // console.log('mouseEnter')
        },
        mouseLeaveFn(evt) {
          const target = evt ? evt.target : null;
          if (!(target instanceof HTMLElement_)) return;
          const metaDataElm = target.closest('ytd-watch-metadata');
          metaDataElm.classList.remove('tyt-metadata-hover-resized');
          metaDataElm.classList.remove('tyt-metadata-hover');
          // console.log('mouseLeaveFn')
        },
        moFn(lockId) {
          if (lockGet['fullChannelNameOnHoverAttrAsyncLock'] !== lockId) return;

          const uploadInfo = document.querySelector(
            '#primary.ytd-watch-flexy ytd-watch-metadata #upload-info'
          );
          if (!uploadInfo) return;

          const evtOpt = { passive: true, capture: false };
          uploadInfo.removeEventListener('pointerenter', this.mouseEnterFn, evtOpt);
          uploadInfo.removeEventListener('pointerleave', this.mouseLeaveFn, evtOpt);

          uploadInfo.addEventListener('pointerenter', this.mouseEnterFn, evtOpt);
          uploadInfo.addEventListener('pointerleave', this.mouseLeaveFn, evtOpt);
        },
        async onNavigateFinish() {
          await this.promiseReady.then();
          const uploadInfo = document.querySelector(
            '#primary.ytd-watch-flexy ytd-watch-metadata #upload-info'
          );
          if (!uploadInfo) return;
          this.mo.observe(uploadInfo, {
            attributes: true,
            attributeFilter: ['hidden', 'attr-3wb0k'],
          });
          uploadInfo.incAttribute111('attr-3wb0k');
          this.ro.observe(uploadInfo);
        },
        activate() {
          if (this.activated) return;

          // Use global isPassiveArgSupport constant
          // https://caniuse.com/?search=observer
          // https://caniuse.com/?search=addEventListener%20passive

          if (!isPassiveArgSupport) return;

          this.activated = true;

          this.mouseEnterFn = this.mouseEnterFn.bind(this);
          this.mouseLeaveFn = this.mouseLeaveFn.bind(this);

          this.moFn = this.moFn.bind(this);
          this.mo = new MutationObserver(() => {
            Promise.resolve(lockSet['fullChannelNameOnHoverAttrAsyncLock'])
              .then(this.moFn)
              .catch(console.warn);
          });
          this.ro = new ResizeObserver(mutations => {
            if (Date.now() > this.checkResize) return;
            for (const mutation of mutations) {
              const uploadInfo = mutation.target;
              if (uploadInfo && mutation.contentRect.width > 0 && mutation.contentRect.height > 0) {
                const metaDataElm = uploadInfo.closest('ytd-watch-metadata');
                if (metaDataElm.classList.contains('tyt-metadata-hover')) {
                  metaDataElm.classList.add('tyt-metadata-hover-resized');
                }

                break;
              }
            }
          });
          this.promiseReady.resolve();
        },
      },
    };

    if (sessionStorage.__$$tmp_UseAutoExpandInfoDesc$$__) plugin.autoExpandInfoDesc.toUse = true;

    // let shouldFixInfo = false;
    const __attachedSymbol__ = Symbol();

    const makeInitAttached = tag => {
      const inPageRearrange_ = inPageRearrange;
      inPageRearrange = false;
      for (const elm of document.querySelectorAll(`${tag}`)) {
        const cnt = insp(elm) || 0;
        if (typeof cnt.attached498 === 'function' && !elm[__attachedSymbol__]) {
          Promise.resolve(elm).then(eventMap[`${tag}::attached`]).catch(console.warn);
        }
      }
      inPageRearrange = inPageRearrange_;
    };

    const getGeneralChatElement = async () => {
      for (let i = 2; i-- > 0;) {
        const t = document.querySelector(
          '#columns.style-scope.ytd-watch-flexy ytd-live-chat-frame#chat'
        );
        if (t instanceof Element) return t;
        if (i > 0) {
          // try later
          console.log('ytd-live-chat-frame::attached - delayPn(200)');
          await delayPn(200);
        }
      }
      return null;
    };

    const nsTemplateObtain = () => {
      let nsTemplate = document.querySelector('ytd-watch-flexy noscript[ns-template]');
      if (!nsTemplate) {
        nsTemplate = document.createElement('noscript');
        nsTemplate.setAttribute('ns-template', '');
        document.querySelector('ytd-watch-flexy').appendChild(nsTemplate);
      }
      return nsTemplate;
    };

    const isPageDOM = (elm, selector) => {
      if (!elm || !(elm instanceof Element) || !elm.nodeName) return false;
      if (!elm.closest(selector)) return false;
      if (elm.isConnected !== true) return false;
      return true;
    };

    const invalidFlexyParent = hostElement => {
      if (hostElement instanceof HTMLElement) {
        const hasFlexyParent = HTMLElement.prototype.closest.call(hostElement, 'ytd-watch-flexy'); // eg short
        if (!hasFlexyParent) return true;
        const currentFlexy = elements.flexy;
        if (currentFlexy && currentFlexy !== hasFlexyParent) return true;
      }
      return false;
    };

    // const mutationComment = document.createComment('1');
    // let mutationPromise = new PromiseExternal();
    // const mutationPromiseObs = new MutationObserver(()=>{
    //   mutationPromise.resolve();
    //   mutationPromise = new PromiseExternal();
    // });
    // mutationPromiseObs.observe(mutationComment, {characterData: true});

    let headerMutationObserver = null;
    let headerMutationTmpNode = null;

    const eventMap = {
      ceHack: () => {
        mLoaded.flag |= 2;
        document.documentElement.setAttribute111('tabview-loaded', mLoaded.makeString());

        retrieveCE('ytd-watch-flexy')
          .then(eventMap['ytd-watch-flexy::defined'])
          .catch(console.warn);
        retrieveCE('ytd-expander').then(eventMap['ytd-expander::defined']).catch(console.warn);
        retrieveCE('ytd-watch-next-secondary-results-renderer')
          .then(eventMap['ytd-watch-next-secondary-results-renderer::defined'])
          .catch(err =>
            console.warn(
              '[YouTube+] retrieveCE ytd-watch-next-secondary-results-renderer failed:',
              err
            )
          );
        retrieveCE('ytd-comments-header-renderer')
          .then(eventMap['ytd-comments-header-renderer::defined'])
          .catch(err =>
            console.warn('[YouTube+] retrieveCE ytd-comments-header-renderer failed:', err)
          );
        retrieveCE('ytd-live-chat-frame')
          .then(eventMap['ytd-live-chat-frame::defined'])
          .catch(err => console.warn('[YouTube+] retrieveCE ytd-live-chat-frame failed:', err));
        retrieveCE('ytd-comments')
          .then(eventMap['ytd-comments::defined'])
          .catch(err => console.warn('[YouTube+] retrieveCE ytd-comments failed:', err));
        retrieveCE('ytd-engagement-panel-section-list-renderer')
          .then(eventMap['ytd-engagement-panel-section-list-renderer::defined'])
          .catch(err =>
            console.warn(
              '[YouTube+] retrieveCE ytd-engagement-panel-section-list-renderer failed:',
              err
            )
          );
        retrieveCE('ytd-watch-metadata')
          .then(eventMap['ytd-watch-metadata::defined'])
          .catch(err => console.warn('[YouTube+] retrieveCE ytd-watch-metadata failed:', err));
        retrieveCE('ytd-playlist-panel-renderer')
          .then(eventMap['ytd-playlist-panel-renderer::defined'])
          .catch(err =>
            console.warn('[YouTube+] retrieveCE ytd-playlist-panel-renderer failed:', err)
          );
        retrieveCE('ytd-expandable-video-description-body-renderer')
          .then(eventMap['ytd-expandable-video-description-body-renderer::defined'])
          .catch(err =>
            console.warn(
              '[YouTube+] retrieveCE ytd-expandable-video-description-body-renderer failed:',
              err
            )
          );
      },

      fixForTabDisplay: isResize => {
        // isResize is true if the layout is resized (not due to tab switching)
        // youtube components shall handle the resize issue. can skip some checkings.

        bFixForResizedTabLater = false;
        for (const element of document.querySelectorAll('[io-intersected]')) {
          const cnt = insp(element);
          if (element instanceof HTMLElement_ && typeof cnt.calculateCanCollapse === 'function') {
            try {
              cnt.calculateCanCollapse(true);
            } catch (e) {
              console.warn('[YouTube+] calculateCanCollapse failed:', e);
            }
          }
        }

        if (!isResize && lastTab === '#tab-info') {
          // #tab-info is now shown.
          // to fix the sizing issue (description info cards in tab info)
          for (const element of document.querySelectorAll(
            '#tab-info ytd-video-description-infocards-section-renderer, #tab-info yt-chip-cloud-renderer, #tab-info ytd-horizontal-card-list-renderer, #tab-info yt-horizontal-list-renderer'
          )) {
            const cnt = insp(element);
            if (element instanceof HTMLElement_ && typeof cnt.notifyResize === 'function') {
              try {
                cnt.notifyResize();
              } catch (e) {
                console.warn('[YouTube+] notifyResize failed for tab-info:', e);
              }
            }
          }
          // to fix expand/collapse sizing issue (inline-expander in tab info)
          // for example, expand button is required but not shown as it was rendered in the hidden state
          for (const element of document.querySelectorAll('#tab-info ytd-text-inline-expander')) {
            const cnt = insp(element);
            if (element instanceof HTMLElement_ && typeof cnt.resize === 'function') {
              cnt.resize(false); // reflow due to offsetWidth calling
            }
            fixInlineExpanderDisplay(cnt); // just in case
          }
        }

        if (!isResize && typeof lastTab === 'string' && lastTab.startsWith('#tab-')) {
          const tabContent = document.querySelector('.tab-content-cld:not(.tab-content-hidden)');
          if (tabContent) {
            const renderers = tabContent.querySelectorAll('yt-chip-cloud-renderer');
            for (const renderer of renderers) {
              const cnt = insp(renderer);
              if (typeof cnt.notifyResize === 'function') {
                try {
                  cnt.notifyResize();
                } catch (e) {
                  console.warn('[YouTube+] notifyResize failed for renderer:', e);
                }
              }
            }
          }
        }
      },

      'ytd-watch-flexy::defined': cProto => {
        if (
          !cProto.updateChatLocation498 &&
          typeof cProto.updateChatLocation === 'function' &&
          cProto.updateChatLocation.length === 0
        ) {
          cProto.updateChatLocation498 = cProto.updateChatLocation;
          cProto.updateChatLocation = updateChatLocation498;
        }
      },

      'ytd-watch-next-secondary-results-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-next-secondary-results-renderer::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-next-secondary-results-renderer::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        makeInitAttached('ytd-watch-next-secondary-results-renderer');
      },

      'ytd-watch-next-secondary-results-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-watch-next-secondary-results-renderer::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        if (
          hostElement instanceof HTMLElement_ &&
          hostElement.matches('#columns #related ytd-watch-next-secondary-results-renderer') &&
          !hostElement.matches(
            '#right-tabs ytd-watch-next-secondary-results-renderer, [hidden] ytd-watch-next-secondary-results-renderer'
          )
        ) {
          elements.related = hostElement.closest('#related');
          hostElement.setAttribute111('tyt-videos-list', '');
        }
        // console.log('ytd-watch-next-secondary-results-renderer::attached', hostElement);
      },

      'ytd-watch-next-secondary-results-renderer::detached': hostElement => {
        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-watch-next-secondary-results-renderer::detached');
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        if (hostElement.hasAttribute000('tyt-videos-list')) {
          elements.related = null;
          hostElement.removeAttribute000('tyt-videos-list');
        }
        console.log('ytd-watch-next-secondary-results-renderer::detached', hostElement);
      },

      settingCommentsVideoId: hostElement => {
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        const cnt = insp(hostElement);
        const commentsArea = elements.comments;
        if (
          commentsArea !== hostElement ||
          hostElement.isConnected !== true ||
          cnt.isAttached !== true ||
          !cnt.data ||
          cnt.hidden !== false
        ) {
          return;
        }
        const ytdFlexyElm = elements.flexy;
        const ytdFlexyCnt = ytdFlexyElm ? insp(ytdFlexyElm) : null;
        if (ytdFlexyCnt && ytdFlexyCnt.videoId) {
          hostElement.setAttribute111('tyt-comments-video-id', ytdFlexyCnt.videoId);
        } else {
          hostElement.removeAttribute000('tyt-comments-video-id');
        }
      },
      checkCommentsShouldBeHidden: lockId => {
        if (lockGet['checkCommentsShouldBeHiddenLock'] !== lockId) return;

        // commentsArea's attribute: tyt-comments-video-id
        // ytdFlexyElm's attribute: video-id

        const commentsArea = elements.comments;
        const ytdFlexyElm = elements.flexy;
        if (commentsArea && ytdFlexyElm && !commentsArea.hasAttribute000('hidden')) {
          const ytdFlexyCnt = insp(ytdFlexyElm);
          if (typeof ytdFlexyCnt.videoId === 'string') {
            const commentsVideoId = commentsArea.getAttribute('tyt-comments-video-id');
            if (commentsVideoId && commentsVideoId !== ytdFlexyCnt.videoId) {
              commentsArea.setAttribute111('hidden', '');
              // removeKeepCommentsScroller();
            }
          }
        }
      },
      'ytd-comments::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments::attached'])
                .catch(console.warn);
            }
            // Promise.resolve(this.hostElement).then(eventMap['ytd-comments::dataChanged_']).catch(console.warn);
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments::detached'])
                .catch(console.warn);
            }
            // Promise.resolve(this.hostElement).then(eventMap['ytd-comments::dataChanged_']).catch(console.warn);
            return this.detached498();
          };
        }

        cProto._createPropertyObserver('data', '_dataChanged498', undefined);
        cProto._dataChanged498 = function () {
          // console.log('_dataChanged498', this.hostElement)
          Promise.resolve(this.hostElement)
            .then(eventMap['ytd-comments::_dataChanged498'])
            .catch(console.warn);
        };

        // if (!cProto.dataChanged498_ && typeof cProto.dataChanged_ === 'function') {
        //   cProto.dataChanged498_ = cProto.dataChanged_;
        //   cProto.dataChanged_ = function () {
        //     Promise.resolve(this.hostElement).then(eventMap['ytd-comments::dataChanged_']).catch(console.warn);
        //     return this.dataChanged498_();
        //   }
        // }

        makeInitAttached('ytd-comments');
      },

      'ytd-comments::_dataChanged498': hostElement => {
        // console.log(18984, hostElement.hasAttribute('tyt-comments-area'))
        if (!hostElement.hasAttribute000('tyt-comments-area')) return;
        let commentsDataStatus = 0;
        const cnt = insp(hostElement);
        const data = cnt ? cnt.data : null;
        const contents = data ? data.contents : null;
        if (data) {
          if (contents && contents.length === 1 && contents[0].messageRenderer) {
            commentsDataStatus = 2;
          }
          if (contents && contents.length > 1 && contents[0].commentThreadRenderer) {
            commentsDataStatus = 1;
          }
        }
        if (commentsDataStatus) {
          hostElement.setAttribute111('tyt-comments-data-status', commentsDataStatus);
          // ytdFlexyElm.setAttribute111('tyt-comment-disabled', '')
        } else {
          // ytdFlexyElm.removeAttribute000('tyt-comment-disabled')
          hostElement.removeAttribute000('tyt-comments-data-status');
        }
        Promise.resolve(hostElement).then(eventMap['settingCommentsVideoId']).catch(console.warn);
      },

      'ytd-comments::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-comments::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        if (!hostElement || hostElement.id !== 'comments') return;
        // if (!hostElement || hostElement.closest('[hidden]')) return;
        elements.comments = hostElement;
        console.log('ytd-comments::attached');
        Promise.resolve(hostElement).then(eventMap['settingCommentsVideoId']).catch(console.warn);

        aoComment.observe(hostElement, { attributes: true });
        hostElement.setAttribute111('tyt-comments-area', '');

        const lockId = lockSet['rightTabReadyLock02'];
        await rightTabsProvidedPromise.then();
        if (lockGet['rightTabReadyLock02'] !== lockId) return;

        if (elements.comments !== hostElement) return;
        if (hostElement.isConnected === false) return;
        DEBUG_5085 && console.log(7932, 'comments');

        // if(!elements.comments || elements.comments.isConnected === false) return;
        if (hostElement && !hostElement.closest('#right-tabs')) {
          document.querySelector('#tab-comments').assignChildren111(null, hostElement, null);
        } else {
          const shouldTabVisible =
            elements.comments &&
            elements.comments.closest('#tab-comments') &&
            !elements.comments.closest('[hidden]');

          document
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.toggle('tab-btn-hidden', !shouldTabVisible);

          //   document.querySelector('#tab-comments').classList.remove('tab-content-hidden')
          //   document.querySelector('[tyt-tab-content="#tab-comments"]').classList.remove('tab-btn-hidden')

          Promise.resolve(lockSet['removeKeepCommentsScrollerLock'])
            .then(removeKeepCommentsScroller)
            .catch(console.warn);
        }

        TAB_AUTO_SWITCH_TO_COMMENTS && switchToTab('#tab-comments');
      },
      'ytd-comments::detached': hostElement => {
        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-comments::detached');
        // console.log(858, hostElement)
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;

        if (hostElement.hasAttribute000('tyt-comments-area')) {
          // foComments.disconnect();
          // foComments.takeRecords();
          hostElement.removeAttribute000('tyt-comments-area');
          // document.querySelector('#tab-comments').classList.add('tab-content-hidden')
          // document.querySelector('[tyt-tab-content="#tab-comments"]').classList.add('tab-btn-hidden')

          aoComment.disconnect();
          aoComment.takeRecords();
          elements.comments = null;

          document
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.add('tab-btn-hidden');

          Promise.resolve(lockSet['removeKeepCommentsScrollerLock'])
            .then(removeKeepCommentsScroller)
            .catch(console.warn);
        }
      },

      'ytd-comments-header-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments-header-renderer::attached'])
                .catch(console.warn);
            }
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-comments-header-renderer::dataChanged'])
              .catch(console.warn); // force dataChanged on attached
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments-header-renderer::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        if (!cProto.dataChanged498 && typeof cProto.dataChanged === 'function') {
          cProto.dataChanged498 = cProto.dataChanged;
          cProto.dataChanged = function () {
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-comments-header-renderer::dataChanged'])
              .catch(console.warn);
            return this.dataChanged498();
          };
        }

        makeInitAttached('ytd-comments-header-renderer');
      },

      'ytd-comments-header-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-comments-header-renderer::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        if (!hostElement || !hostElement.classList.contains('ytd-item-section-renderer')) return;
        // console.log(12991, 'ytd-comments-header-renderer::attached')
        const targetElement = document.querySelector(
          '[tyt-comments-area] ytd-comments-header-renderer'
        );
        if (hostElement === targetElement) {
          hostElement.setAttribute111('tyt-comments-header-field', '');
        } else {
          const parentNode = hostElement.parentNode;
          if (
            parentNode instanceof HTMLElement_ &&
            parentNode.querySelector('[tyt-comments-header-field]')
          ) {
            hostElement.setAttribute111('tyt-comments-header-field', '');
          }
        }
      },

      'ytd-comments-header-renderer::detached': hostElement => {
        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-comments-header-renderer::detached');

        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        // console.log(12992, 'ytd-comments-header-renderer::detached')
        if (hostElement.hasAttribute000('field-of-cm-count')) {
          hostElement.removeAttribute000('field-of-cm-count');

          const cmCount = document.querySelector('#tyt-cm-count');
          if (
            cmCount &&
            !document.querySelector('#tab-comments ytd-comments-header-renderer[field-of-cm-count]')
          ) {
            cmCount.textContent = '';
          }
        }
        if (hostElement.hasAttribute000('tyt-comments-header-field')) {
          hostElement.removeAttribute000('tyt-comments-header-field');
        }
      },

      'ytd-comments-header-renderer::dataChanged': hostElement => {
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }

        const ytdFlexyElm = elements.flexy;

        let b = false;
        const cnt = insp(hostElement);
        if (
          cnt &&
          hostElement.closest('#tab-comments') &&
          document.querySelector('#tab-comments ytd-comments-header-renderer') === hostElement
        ) {
          b = true;
        } else if (
          hostElement instanceof HTMLElement_ &&
          hostElement.parentNode instanceof HTMLElement_ &&
          hostElement.parentNode.querySelector('[tyt-comments-header-field]')
        ) {
          b = true;
        }
        if (b) {
          hostElement.setAttribute111('tyt-comments-header-field', '');
          ytdFlexyElm && ytdFlexyElm.removeAttribute000('tyt-comment-disabled');
        }

        if (
          hostElement.hasAttribute000('tyt-comments-header-field') &&
          hostElement.isConnected === true
        ) {
          if (!headerMutationObserver) {
            headerMutationObserver = new MutationObserver(
              eventMap['ytd-comments-header-renderer::deferredCounterUpdate']
            );
          }
          headerMutationObserver.observe(hostElement.parentNode, {
            subtree: false,
            childList: true,
          });
          if (!headerMutationTmpNode) {
            headerMutationTmpNode = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
          }
          const tmpNode = headerMutationTmpNode;
          hostElement.insertAdjacentElement('afterend', tmpNode);
          tmpNode.remove();
        }
      },

      'ytd-comments-header-renderer::deferredCounterUpdate': () => {
        const nodes = document.querySelectorAll(
          '#tab-comments ytd-comments-header-renderer[class]'
        );
        if (nodes.length === 1) {
          const hostElement = nodes[0];
          const cnt = insp(hostElement);
          const data = cnt.data;
          if (!data) return;
          let ez = '';
          if (
            data.commentsCount &&
            data.commentsCount.runs &&
            data.commentsCount.runs.length >= 1
          ) {
            let max = -1;
            const z = data.commentsCount.runs
              .map(e => {
                const c = e.text.replace(/\D+/g, '').length;
                if (c > max) max = c;
                return [e.text, c];
              })
              .filter(a => a[1] === max);
            if (z.length >= 1) {
              ez = z[0][0];
            }
          } else if (data.countText && data.countText.runs && data.countText.runs.length >= 1) {
            let max = -1;
            const z = data.countText.runs
              .map(e => {
                const c = e.text.replace(/\D+/g, '').length;
                if (c > max) max = c;
                return [e.text, c];
              })
              .filter(a => a[1] === max);
            if (z.length >= 1) {
              ez = z[0][0];
            }
          }
          const cmCount = document.querySelector('#tyt-cm-count');
          if (ez) {
            hostElement.setAttribute111('field-of-cm-count', '');
            cmCount && (cmCount.textContent = ez.trim());
          } else {
            hostElement.removeAttribute000('field-of-cm-count');
            cmCount && (cmCount.textContent = '');
            console.warn('no text for #tyt-cm-count');
          }
        }
      },

      'ytd-expander::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expander::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expander::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }
        if (!cProto.calculateCanCollapse498 && typeof cProto.calculateCanCollapse === 'function') {
          cProto.calculateCanCollapse498 = cProto.calculateCanCollapse;
          cProto.calculateCanCollapse = funcCanCollapse;
        }

        if (!cProto.childrenChanged498 && typeof cProto.childrenChanged === 'function') {
          cProto.childrenChanged498 = cProto.childrenChanged;
          cProto.childrenChanged = function () {
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-expander::childrenChanged'])
              .catch(console.warn);
            return this.childrenChanged498();
          };
        }

        /*
                 
                        console.log('ytd-expander::defined 01');
                        
                        CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.connectedCallback = connectedCallbackY(CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.connectedCallback)
                        CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.disconnectedCallback = disconnectedCallbackY(CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.disconnectedCallback)
                        
                        console.log('ytd-expander::defined 02');
                 
                        */

        makeInitAttached('ytd-expander');
      },

      'ytd-expander::childrenChanged': hostElement => {
        if (
          hostElement instanceof Node &&
          hostElement.hasAttribute000('hidden') &&
          hostElement.hasAttribute000('tyt-main-info') &&
          hostElement.firstElementChild
        ) {
          hostElement.removeAttribute('hidden');
        }
      },

      'ytd-expandable-video-description-body-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expandable-video-description-body-renderer::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expandable-video-description-body-renderer::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        makeInitAttached('ytd-expandable-video-description-body-renderer');
      },

      'ytd-expandable-video-description-body-renderer::attached': async hostElement => {
        if (
          hostElement instanceof HTMLElement_ &&
          isPageDOM(hostElement, '[tyt-info-renderer]') &&
          !hostElement.matches('[tyt-main-info]')
        ) {
          elements.infoExpander = hostElement;
          console.log(128384, elements.infoExpander);

          // console.log(1299, hostElement.parentNode, isRightTabsInserted)

          infoExpanderElementProvidedPromise.resolve();
          hostElement.setAttribute111('tyt-main-info', '');
          if (plugin.autoExpandInfoDesc.toUse) {
            plugin.autoExpandInfoDesc.onMainInfoSet(hostElement);
          }

          const lockId = lockSet['rightTabReadyLock03'];
          await rightTabsProvidedPromise.then();
          if (lockGet['rightTabReadyLock03'] !== lockId) return;

          if (elements.infoExpander !== hostElement) return;
          if (hostElement.isConnected === false) return;
          console.log(7932, 'infoExpander');

          elements.infoExpander.classList.add('tyt-main-info'); // add a classname for it

          const infoExpander = elements.infoExpander;
          // const infoExpanderBack = elements.infoExpanderBack;

          // console.log(5438,infoExpander, qt);

          // const dummy = document.createElement('noscript');
          // dummy.setAttribute000('id', 'info-expander-vid');
          // dummy.setAttribute000('video-id', getCurrentVideoId());
          // infoExpander.insertBefore000(dummy, infoExpander.firstChild);

          // aoInfo.observe(infoExpander, { attributes: true, attributeFilter: ['tyt-display-for', 'tyt-video-id'] });
          // zoInfo.observe(infoExpanderBack, { attributes: true, attributeFilter: ['hidden', 'attr-w20ts'], childList: true, subtree: true});
          // new MutationObserver(()=>{
          //   console.log(591499)
          // }).observe(infoExpanderBack, {childList: true, subtree: true})

          const inlineExpanderElm = infoExpander.querySelector('ytd-text-inline-expander');
          if (inlineExpanderElm) {
            const mo = new MutationObserver(() => {
              const p = document.querySelector('#tab-info ytd-text-inline-expander');
              sessionStorage.__$$tmp_UseAutoExpandInfoDesc$$__ =
                p && p.hasAttribute('is-expanded') ? '1' : '';
              if (p) fixInlineExpanderContent();
            });
            mo.observe(inlineExpanderElm, {
              attributes: ['is-expanded', 'attr-6v8qu', 'hidden'],
              subtree: true,
            }); // hidden + subtree to trigger the fn by delayedUpdate
            inlineExpanderElm.incAttribute111('attr-6v8qu');
            const cnt = insp(inlineExpanderElm);

            if (cnt) fixInlineExpanderDisplay(cnt);
          }

          if (infoExpander && !infoExpander.closest('#right-tabs')) {
            document.querySelector('#tab-info').assignChildren111(null, infoExpander, null);
          } else {
            if (document.querySelector('[tyt-tab-content="#tab-info"]')) {
              const shouldTabVisible =
                elements.infoExpander && elements.infoExpander.closest('#tab-info');
              document
                .querySelector('[tyt-tab-content="#tab-info"]')
                .classList.toggle('tab-btn-hidden', !shouldTabVisible);
            }
          }

          Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn); // required when the page is switched from channel to watch

          // if (infoExpander && infoExpander.closest('#right-tabs')) Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn);

          // infoExpanderBack.incAttribute111('attr-w20ts');

          // return;
        }

        DEBUG_5084 && console.log(5084, 'ytd-expandable-video-description-body-renderer::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;

        if (isPageDOM(hostElement, '#tab-info [tyt-main-info]')) {
          // const cnt = insp(hostElement);
          // if(cnt.data){
          //   cnt.data = Object.assign({}, cnt.data);
          // }
        } else if (!hostElement.closest('#tab-info')) {
          const bodyRenderer = hostElement;
          let bodyRendererNew = document.querySelector(
            'ytd-expandable-video-description-body-renderer[tyt-info-renderer]'
          );
          if (!bodyRendererNew) {
            bodyRendererNew = document.createElement(
              'ytd-expandable-video-description-body-renderer'
            );
            bodyRendererNew.setAttribute('tyt-info-renderer', '');
            nsTemplateObtain().appendChild(bodyRendererNew);
          }
          // document.querySelector('#tab-info').assignChildren111(null, bodyRendererNew, null);

          const cnt = insp(bodyRendererNew);
          cnt.data = Object.assign({}, insp(bodyRenderer).data);

          const inlineExpanderElm = bodyRendererNew.querySelector('ytd-text-inline-expander');
          const inlineExpanderCnt = insp(inlineExpanderElm);
          fixInlineExpanderMethods(inlineExpanderCnt);

          // insp(bodyRendererNew).data = insp(bodyRenderer).data;

          // if((bodyRendererNew.hasAttribute('hidden')?1:0)^(bodyRenderer.hasAttribute('hidden')?1:0)){
          //   if(bodyRenderer.hasAttribute('hidden')) bodyRendererNew.setAttribute('hidden', '');
          //   else bodyRendererNew.removeAttribute('hidden');
          // }

          elements.infoExpanderRendererBack = bodyRenderer;
          elements.infoExpanderRendererFront = bodyRendererNew;
          bodyRenderer.setAttribute('tyt-info-renderer-back', '');
          bodyRendererNew.setAttribute('tyt-info-renderer-front', '');

          // elements.infoExpanderBack = {{ytd-expander}};
        }
      },

      'ytd-expandable-video-description-body-renderer::detached': async hostElement => {
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        // console.log(5992, hostElement)
        if (hostElement.hasAttribute000('tyt-main-info')) {
          DEBUG_5084 &&
            console.log(5084, 'ytd-expandable-video-description-body-renderer::detached');
          elements.infoExpander = null;
          hostElement.removeAttribute000('tyt-main-info');
        }
      },

      'ytd-expander::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        // console.log(4959, hostElement)

        if (
          hostElement instanceof HTMLElement_ &&
          hostElement.matches('[tyt-comments-area] #contents ytd-expander#expander') &&
          !hostElement.matches('[hidden] ytd-expander#expander')
        ) {
          hostElement.setAttribute111('tyt-content-comment-entry', '');
          ioComment.observe(hostElement);
        }

        // --------------

        // else if (hostElement instanceof HTMLElement_ && hostElement.matches('ytd-expander#expander.style-scope.ytd-expandable-video-description-body-renderer')) {
        //   //  && !hostElement.matches('#right-tabs ytd-expander#expander, [hidden] ytd-expander#expander')

        //   console.log(5084, 'ytd-expander::attached');
        //   const bodyRenderer = hostElement.closest('ytd-expandable-video-description-body-renderer');
        //   let bodyRendererNew = document.querySelector('ytd-expandable-video-description-body-renderer[tyt-info-renderer]');
        //   if (!bodyRendererNew) {
        //     bodyRendererNew = document.createElement('ytd-expandable-video-description-body-renderer');
        //     bodyRendererNew.setAttribute('tyt-info-renderer', '');
        //     nsTemplateObtain().appendChild(bodyRendererNew);
        //   }
        //   // document.querySelector('#tab-info').assignChildren111(null, bodyRendererNew, null);

        //   insp(bodyRendererNew).data = insp(bodyRenderer).data;
        //   // if((bodyRendererNew.hasAttribute('hidden')?1:0)^(bodyRenderer.hasAttribute('hidden')?1:0)){
        //   //   if(bodyRenderer.hasAttribute('hidden')) bodyRendererNew.setAttribute('hidden', '');
        //   //   else bodyRendererNew.removeAttribute('hidden');
        //   // }

        //   elements.infoExpanderRendererBack = bodyRenderer;
        //   elements.infoExpanderRendererFront = bodyRendererNew;
        //   bodyRenderer.setAttribute('tyt-info-renderer-back','')
        //   bodyRendererNew.setAttribute('tyt-info-renderer-front','')

        //   elements.infoExpanderBack = hostElement;

        // }

        // --------------

        // console.log('ytd-expander::attached', hostElement);
      },

      'ytd-expander::detached': hostElement => {
        // if (inPageRearrange) return;
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        // console.log(5992, hostElement)
        if (hostElement.hasAttribute000('tyt-content-comment-entry')) {
          ioComment.unobserve(hostElement);
          hostElement.removeAttribute000('tyt-content-comment-entry');
        } else if (hostElement.hasAttribute000('tyt-main-info')) {
          DEBUG_5084 && console.log(5084, 'ytd-expander::detached');
          elements.infoExpander = null;
          hostElement.removeAttribute000('tyt-main-info');
        }
        // console.log('ytd-expander::detached', hostElement);
      },

      'ytd-live-chat-frame::defined': cProto => {
        // eslint-disable-next-line no-unused-vars
        let lastDomAction = 0;

        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            lastDomAction = Date.now();
            // console.log('chat868-attached', Date.now());
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-live-chat-frame::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            lastDomAction = Date.now();
            // console.log('chat868-detached', Date.now());
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-live-chat-frame::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        if (
          typeof cProto.urlChanged === 'function' &&
          !cProto.urlChanged66 &&
          !cProto.urlChangedAsync12 &&
          cProto.urlChanged.length === 0
        ) {
          cProto.urlChanged66 = cProto.urlChanged;
          let ath = 0;
          cProto.urlChangedAsync12 = async function () {
            await this.__urlChangedAsyncT689__;
            const t = (ath = (ath & 1073741823) + 1);
            const chatframe = this.chatframe || (this.$ || 0).chatframe || 0;
            if (chatframe instanceof HTMLIFrameElement) {
              if (chatframe.contentDocument === null) {
                await Promise.resolve('#').catch(console.warn);
                if (t !== ath) return;
              }
              await new Promise(resolve => setTimeout_(resolve, 1)).catch(console.warn); // neccessary for Brave
              if (t !== ath) return;
              const isBlankPage = !this.data || this.collapsed;
              const p1 = new Promise(resolve => setTimeout_(resolve, 706)).catch(console.warn);
              const p2 = new Promise(resolve => {
                new IntersectionObserver((entries, observer) => {
                  for (const entry of entries) {
                    const rect = entry.boundingClientRect || 0;
                    if (isBlankPage || (rect.width > 0 && rect.height > 0)) {
                      observer.disconnect();
                      resolve('#');
                      break;
                    }
                  }
                }).observe(chatframe);
              }).catch(console.warn);
              await Promise.race([p1, p2]);
              if (t !== ath) return;
            }
            this.urlChanged66();
          };
          cProto.urlChanged = function () {
            const t = (this.__urlChangedAsyncT688__ =
              (this.__urlChangedAsyncT688__ & 1073741823) + 1);
            nextBrowserTick(() => {
              if (t !== this.__urlChangedAsyncT688__) return;
              this.urlChangedAsync12();
            });
          };
        }

        makeInitAttached('ytd-live-chat-frame');
      },

      'ytd-live-chat-frame::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-live-chat-frame::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        if (!hostElement || hostElement.id !== 'chat') return;
        console.log('ytd-live-chat-frame::attached');

        const lockId = lockSet['ytdLiveAttachedLock'];
        const chatElem = await getGeneralChatElement();
        if (lockGet['ytdLiveAttachedLock'] !== lockId) return;

        if (chatElem === hostElement) {
          elements.chat = chatElem;
          aoChat.observe(chatElem, { attributes: true });
          const isFlexyReady = elements.flexy instanceof Element;
          chatElem.setAttribute111('tyt-active-chat-frame', isFlexyReady ? 'CF' : 'C');

          const chatContainer = chatElem ? chatElem.closest('#chat-container') || chatElem : null;
          if (chatContainer && !chatContainer.hasAttribute000('tyt-chat-container')) {
            for (const p of document.querySelectorAll('[tyt-chat-container]')) {
              p.removeAttribute000('[tyt-chat-container]');
            }
            chatContainer.setAttribute111('tyt-chat-container', '');
          }
          const cnt = insp(hostElement);
          const q = cnt.__urlChangedAsyncT688__;
          const p = (cnt.__urlChangedAsyncT689__ = new PromiseExternal());
          setTimeout_(() => {
            if (p !== cnt.__urlChangedAsyncT689__) return;
            if (cnt.isAttached === true && hostElement.isConnected === true) {
              p.resolve();
              if (q === cnt.__urlChangedAsyncT688__) {
                cnt.urlChanged();
              }
            }
          }, 320);
          Promise.resolve(lockSet['layoutFixLock']).then(layoutFix);
        } else {
          console.log('Issue found in ytd-live-chat-frame::attached', chatElem, hostElement);
        }
      },

      'ytd-live-chat-frame::detached': hostElement => {
        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-live-chat-frame::detached');

        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        console.log('ytd-live-chat-frame::detached');
        if (hostElement.hasAttribute000('tyt-active-chat-frame')) {
          aoChat.disconnect();
          aoChat.takeRecords();
          hostElement.removeAttribute000('tyt-active-chat-frame');
          elements.chat = null;

          const ytdFlexyElm = elements.flexy;
          if (ytdFlexyElm) {
            ytdFlexyElm.removeAttribute000('tyt-chat-collapsed');
            ytdFlexyElm.setAttribute111('tyt-chat', '');
          }
        }
      },

      'ytd-engagement-panel-section-list-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-engagement-panel-section-list-renderer::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-engagement-panel-section-list-renderer::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }
        makeInitAttached('ytd-engagement-panel-section-list-renderer');
      },

      'ytd-engagement-panel-section-list-renderer::bindTarget': hostElement => {
        if (
          hostElement.matches(
            '#panels.ytd-watch-flexy > ytd-engagement-panel-section-list-renderer[target-id][visibility]'
          )
        ) {
          hostElement.setAttribute111('tyt-egm-panel', '');
          Promise.resolve(lockSet['updateEgmPanelsLock']).then(updateEgmPanels).catch(console.warn);
          aoEgmPanels.observe(hostElement, {
            attributes: true,
            attributeFilter: ['visibility', 'hidden'],
          });

          // console.log(5094, 2, 'ytd-engagement-panel-section-list-renderer::attached', hostElement);
        }
      },

      'ytd-engagement-panel-section-list-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-engagement-panel-section-list-renderer::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        // console.log('ytd-engagement-panel-section-list-renderer::attached', hostElement)
        // console.log(5094, 1, 'ytd-engagement-panel-section-list-renderer::attached', hostElement);

        if (
          !hostElement.matches(
            '#panels.ytd-watch-flexy > ytd-engagement-panel-section-list-renderer'
          )
        ) {
          return;
        }

        if (hostElement.hasAttribute000('target-id') && hostElement.hasAttribute000('visibility')) {
          Promise.resolve(hostElement)
            .then(eventMap['ytd-engagement-panel-section-list-renderer::bindTarget'])
            .catch(console.warn);
        } else {
          hostElement.setAttribute000('tyt-egm-panel-jclmd', '');
          moEgmPanelReady.observe(hostElement, {
            attributes: true,
            attributeFilter: ['visibility', 'target-id'],
          });
        }
      },

      'ytd-engagement-panel-section-list-renderer::detached': hostElement => {
        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-engagement-panel-section-list-renderer::detached');
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        if (hostElement.hasAttribute000('tyt-egm-panel')) {
          hostElement.removeAttribute000('tyt-egm-panel');
          Promise.resolve(lockSet['updateEgmPanelsLock']).then(updateEgmPanels).catch(console.warn);
        } else if (hostElement.hasAttribute000('tyt-egm-panel-jclmd')) {
          hostElement.removeAttribute000('tyt-egm-panel-jclmd');
          moEgmPanelReadyClearFn();
        }
      },

      'ytd-watch-metadata::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-metadata::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-metadata::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        makeInitAttached('ytd-watch-metadata');
      },

      'ytd-watch-metadata::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-watch-metadata::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;

        if (plugin.fullChannelNameOnHover.activated) {
          plugin.fullChannelNameOnHover.onNavigateFinish();
        }
      },

      'ytd-watch-metadata::detached': hostElement => {
        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-watch-metadata::detached');
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
      },

      'ytd-playlist-panel-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-playlist-panel-renderer::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-playlist-panel-renderer::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        makeInitAttached('ytd-playlist-panel-renderer');
      },

      'ytd-playlist-panel-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-playlist-panel-renderer::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;

        elements.playlist = hostElement;

        aoPlayList.observe(hostElement, {
          attributes: true,
          attributeFilter: ['hidden', 'collapsed', 'attr-1y6nu'],
        });
        hostElement.incAttribute111('attr-1y6nu');
      },

      'ytd-playlist-panel-renderer::detached': hostElement => {
        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-playlist-panel-renderer::detached');
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
      },

      _yt_playerProvided: () => {
        mLoaded.flag |= 4;
        document.documentElement.setAttribute111('tabview-loaded', mLoaded.makeString());
      },
      relatedElementProvided: target => {
        if (target.closest('[hidden]')) return;
        elements.related = target;
        console.log('relatedElementProvided');
        videosElementProvidedPromise.resolve();
      },
      onceInfoExpanderElementProvidedPromised: () => {
        console.log('hide-default-text-inline-expander');
        const ytdFlexyElm = elements.flexy;
        if (ytdFlexyElm) {
          ytdFlexyElm.setAttribute111('hide-default-text-inline-expander', '');
        }
      },

      refreshSecondaryInner: lockId => {
        if (lockGet['refreshSecondaryInnerLock'] !== lockId) return;
        /*
                   
                        ytd-watch-flexy:not([panels-beside-player]):not([fixed-panels]) #panels-full-bleed-container.ytd-watch-flexy{
                            display: none;}
                   
                  #player-full-bleed-container.ytd-watch-flexy{
                      position: relative;
                      flex: 1;}
                   
                        */

        const ytdFlexyElm = elements.flexy;
        // if(ytdFlexyElm && ytdFlexyElm.matches('ytd-watch-flexy[fixed-panels][theater]')){
        //   // ytdFlexyElm.fixedPanels = true;
        //   ytdFlexyElm.removeAttribute000('fixed-panels');
        // }

        if (
          ytdFlexyElm &&
          ytdFlexyElm.matches(
            'ytd-watch-flexy[theater][flexy][full-bleed-player]:not([full-bleed-no-max-width-columns])'
          )
        ) {
          // ytdFlexyElm.fullBleedNoMaxWidthColumns = true;
          ytdFlexyElm.setAttribute111('full-bleed-no-max-width-columns', '');
        }

        const related = elements.related;
        if (related && related.isConnected && !related.closest('#right-tabs #tab-videos')) {
          document.querySelector('#tab-videos').assignChildren111(null, related, null);
        }
        const infoExpander = elements.infoExpander;
        if (
          infoExpander &&
          infoExpander.isConnected &&
          !infoExpander.closest('#right-tabs #tab-info')
        ) {
          document.querySelector('#tab-info').assignChildren111(null, infoExpander, null);
        } else {
          // if (infoExpander && ytdFlexyElm && shouldFixInfo) {
          //   shouldFixInfo = false;
          //   Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn);
          // }
        }

        const commentsArea = elements.comments;
        if (commentsArea) {
          const isConnected = commentsArea.isConnected;
          if (isConnected && !commentsArea.closest('#right-tabs #tab-comments')) {
            const tab = document.querySelector('#tab-comments');
            tab.assignChildren111(null, commentsArea, null);
          } else {
            // if (!isConnected || tab.classList.contains('tab-content-hidden')) removeKeepCommentsScroller();
          }
        }
      },

      'yt-navigate-finish': _evt => {
        const ytdAppElm = document.querySelector(
          'ytd-page-manager#page-manager.style-scope.ytd-app'
        );
        const ytdAppCnt = insp(ytdAppElm);
        pageType = ytdAppCnt ? (ytdAppCnt.data || 0).page : null;

        if (!document.querySelector('ytd-watch-flexy #player')) return;
        // shouldFixInfo = true;
        // console.log('yt-navigate-finish')
        const flexyArr = [...document.querySelectorAll('ytd-watch-flexy')].filter(
          e => !e.closest('[hidden]') && e.querySelector('#player')
        );
        if (flexyArr.length === 1) {
          // const lockId = lockSet['yt-navigate-finish-videos'];
          elements.flexy = flexyArr[0];
          if (isRightTabsInserted) {
            Promise.resolve(lockSet['refreshSecondaryInnerLock'])
              .then(eventMap['refreshSecondaryInner'])
              .catch(console.warn);
            Promise.resolve(lockSet['removeKeepCommentsScrollerLock'])
              .then(removeKeepCommentsScroller)
              .catch(console.warn);
          } else {
            navigateFinishedPromise.resolve();
            if (plugin.minibrowser.toUse) plugin.minibrowser.activate();
            if (plugin.autoExpandInfoDesc.toUse) plugin.autoExpandInfoDesc.activate();
            if (plugin.fullChannelNameOnHover.toUse) plugin.fullChannelNameOnHover.activate();
          }
          const chat = elements.chat;
          if (chat instanceof Element) {
            chat.setAttribute111('tyt-active-chat-frame', 'CF'); // chat and flexy ready
          }
          const infoExpander = elements.infoExpander;
          if (infoExpander && infoExpander.closest('#right-tabs')) {
            Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn);
          }
          Promise.resolve(lockSet['layoutFixLock']).then(layoutFix);
          if (plugin.fullChannelNameOnHover.activated) {
            plugin.fullChannelNameOnHover.onNavigateFinish();
          }
        }
      },

      onceInsertRightTabs: () => {
        // if(lockId !== lockGet['yt-navigate-finish-videos']) return;
        const related = elements.related;
        let rightTabs = document.querySelector('#right-tabs');
        if (!document.querySelector('#right-tabs') && related) {
          getLangForPage();
          const docTmp = document.createElement('template');
          docTmp.innerHTML = createHTML(getTabsHTML());
          const newElm = docTmp.content.firstElementChild;
          if (newElm !== null) {
            inPageRearrange = true;
            related.parentNode.insertBefore000(newElm, related);
            inPageRearrange = false;
          }
          rightTabs = newElm;
          rightTabs
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.add('tab-btn-hidden');

          const secondaryWrapper = document.createElement('secondary-wrapper');
          const secondaryInner = document.querySelector(
            '#secondary-inner.style-scope.ytd-watch-flexy'
          );

          inPageRearrange = true;
          secondaryWrapper.replaceChildren000(...secondaryInner.childNodes);
          secondaryInner.insertBefore000(secondaryWrapper, secondaryInner.firstChild);
          inPageRearrange = false;

          rightTabs
            .querySelector('#material-tabs')
            .addEventListener('click', eventMap['tabs-btn-click'], true);

          inPageRearrange = true;
          if (!rightTabs.closest('secondary-wrapper')) secondaryWrapper.appendChild000(rightTabs);
          inPageRearrange = false;
        }
        if (rightTabs) {
          isRightTabsInserted = true;
          const ioTabBtns = new IntersectionObserver(
            entries => {
              for (const entry of entries) {
                const rect = entry.boundingClientRect;
                entry.target.classList.toggle('tab-btn-visible', rect.width && rect.height);
              }
            },
            { rootMargin: '0px' }
          );
          for (const btn of document.querySelectorAll('.tab-btn[tyt-tab-content]')) {
            ioTabBtns.observe(btn);
          }
          if (!related.closest('#right-tabs')) {
            document.querySelector('#tab-videos').assignChildren111(null, related, null);
          }
          const infoExpander = elements.infoExpander;
          if (infoExpander && !infoExpander.closest('#right-tabs')) {
            document.querySelector('#tab-info').assignChildren111(null, infoExpander, null);
          }
          const commentsArea = elements.comments;
          if (commentsArea && !commentsArea.closest('#right-tabs')) {
            document.querySelector('#tab-comments').assignChildren111(null, commentsArea, null);
          }
          rightTabsProvidedPromise.resolve();
          roRightTabs.disconnect();
          roRightTabs.observe(rightTabs);
          const ytdFlexyElm = elements.flexy;
          const aoFlexy = new MutationObserver(eventMap['aoFlexyFn']);
          aoFlexy.observe(ytdFlexyElm, { attributes: true });
          // Promise.resolve(lockSet['tabsStatusCorrectionLock']).then(eventMap['tabsStatusCorrection']).catch(console.warn);

          Promise.resolve(lockSet['fixInitialTabStateLock'])
            .then(eventMap['fixInitialTabStateFn'])
            .catch(console.warn);

          ytdFlexyElm.incAttribute111('attr-7qlsy'); // tabsStatusCorrectionLock and video-id
        }
      },

      aoFlexyFn: () => {
        Promise.resolve(lockSet['checkCommentsShouldBeHiddenLock'])
          .then(eventMap['checkCommentsShouldBeHidden'])
          .catch(console.warn);

        Promise.resolve(lockSet['refreshSecondaryInnerLock'])
          .then(eventMap['refreshSecondaryInner'])
          .catch(console.warn);

        Promise.resolve(lockSet['tabsStatusCorrectionLock'])
          .then(eventMap['tabsStatusCorrection'])
          .catch(console.warn);

        const videoId = getCurrentVideoId();
        if (videoId !== tmpLastVideoId) {
          tmpLastVideoId = videoId;
          Promise.resolve(lockSet['updateOnVideoIdChangedLock'])
            .then(eventMap['updateOnVideoIdChanged'])
            .catch(console.warn);
        }
      },

      twoColumnChanged10: lockId => {
        if (lockId !== lockGet['twoColumnChanged10Lock']) return;
        for (const continuation of document.querySelectorAll(
          '#tab-videos ytd-watch-next-secondary-results-renderer ytd-continuation-item-renderer'
        )) {
          if (continuation.closest('[hidden]')) continue;
          const cnt = insp(continuation);
          if (typeof cnt.showButton === 'boolean') {
            if (cnt.showButton === false) continue;
            cnt.showButton = false;
            const behavior = cnt.ytRendererBehavior || cnt;
            if (typeof behavior.invalidate === 'function') {
              behavior.invalidate(!1);
            }
          }
        }
      },

      tabsStatusCorrection: lockId => {
        if (lockId !== lockGet['tabsStatusCorrectionLock']) return;
        const ytdFlexyElm = elements.flexy;
        if (!ytdFlexyElm) return;
        const p = tabAStatus;
        const q = calculationFn(p, 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128);

        let resetForPanelDisappeared = false;
        if (p !== q) {
          console.log(388, p, q);
          let actioned = false;
          if ((p & 128) === 0 && (q & 128) === 128) {
            lastPanel = 'playlist';
          } else if ((p & 8) === 0 && (q & 8) === 8) {
            lastPanel = 'chat';
          } else if (
            (((p & 4) === 4 && (q & (4 | 8)) === (0 | 0)) ||
              ((p & 8) === 8 && (q & (4 | 8)) === (0 | 0))) &&
            lastPanel === 'chat'
          ) {
            // 24 -> 16 = -8; 'd'
            lastPanel = lastTab || '';
            resetForPanelDisappeared = true;
          } else if ((p & (4 | 8)) === 8 && (q & (4 | 8)) === 4 && lastPanel === 'chat') {
            // click close
            lastPanel = lastTab || '';
            resetForPanelDisappeared = true;
          } else if ((p & 128) === 128 && (q & 128) === 0 && lastPanel === 'playlist') {
            lastPanel = lastTab || '';
            resetForPanelDisappeared = true;
          }
          tabAStatus = q;

          let bFixForResizedTab = false;

          if ((q ^ 2) === 2 && bFixForResizedTabLater) {
            bFixForResizedTab = true;
          }

          if (((p & 16) === 16) & ((q & 16) === 0)) {
            Promise.resolve(lockSet['twoColumnChanged10Lock'])
              .then(eventMap['twoColumnChanged10'])
              .catch(console.warn);
          }

          if (((p & 2) === 2) ^ ((q & 2) === 2) && (q & 2) === 2) {
            bFixForResizedTab = true;
          }

          // p->q +2
          if ((p & 2) === 0 && (q & 2) === 2 && (p & 128) === 128 && (q & 128) === 128) {
            lastPanel = lastTab || '';
            ytBtnClosePlaylist();
            actioned = true;
          }

          // p->q +8
          if (
            (p & (8 | 128)) === (0 | 128) &&
            (q & (8 | 128)) === (8 | 128) &&
            lastPanel === 'chat'
          ) {
            lastPanel = lastTab || '';
            ytBtnClosePlaylist();
            actioned = true;
          }

          // p->q +128
          if (
            (p & (2 | 128)) === (2 | 0) &&
            (q & (2 | 128)) === (2 | 128) &&
            lastPanel === 'playlist'
          ) {
            switchToTab(null);
            actioned = true;
          }

          // p->q +128
          if (
            (p & (8 | 128)) === (8 | 0) &&
            (q & (8 | 128)) === (8 | 128) &&
            lastPanel === 'playlist'
          ) {
            lastPanel = lastTab || '';
            ytBtnCollapseChat();
            actioned = true;
          }

          // p->q +128
          if ((p & (1 | 16 | 128)) === (1 | 16) && (q & (1 | 16 | 128)) === (1 | 16 | 128)) {
            ytBtnCancelTheater();
            actioned = true;
          }

          // p->q +1
          if ((p & (1 | 16 | 128)) === (16 | 128) && (q & (1 | 16 | 128)) === (1 | 16 | 128)) {
            lastPanel = lastTab || '';
            ytBtnClosePlaylist();
            actioned = true;
          }

          if ((q & 64) === 64) {
            actioned = false;
          } else if ((p & 64) === 64 && (q & 64) === 0) {
            // p->q -64

            if ((q & 32) === 32) {
              ytBtnCloseEngagementPanels();
            }

            if ((q & (2 | 8)) === (2 | 8)) {
              if (lastPanel === 'chat') {
                switchToTab(null);
                actioned = true;
              } else if (lastPanel) {
                ytBtnCollapseChat();
                actioned = true;
              }
            }
          } else if (
            (p & (1 | 2 | 8 | 16 | 32)) === (1 | 0 | 0 | 16 | 0) &&
            (q & (1 | 2 | 8 | 16 | 32)) === (1 | 0 | 8 | 16 | 0)
          ) {
            // p->q +8
            ytBtnCancelTheater();
            actioned = true;
          } else if (
            (p & (1 | 16 | 32)) === (0 | 16 | 0) &&
            (q & (1 | 16 | 32)) === (0 | 16 | 32) &&
            (q & (2 | 8)) > 0
          ) {
            // p->q +32
            if (q & 2) {
              switchToTab(null);
              actioned = true;
            }
            if (q & 8) {
              ytBtnCollapseChat();
              actioned = true;
            }
          } else if (
            (p & (1 | 16 | 8 | 2)) === (16 | 8) &&
            (q & (1 | 16 | 8 | 2)) === 16 &&
            (q & 128) === 0
          ) {
            // p->q -8
            if (lastTab) {
              switchToTab(lastTab);
              actioned = true;
            }
          } else if ((p & 1) === 0 && (q & 1) === 1) {
            // p->q +1
            if ((q & 32) === 32) {
              ytBtnCloseEngagementPanels();
            }
            if ((p & 9) === 8 && (q & 9) === 9) {
              ytBtnCollapseChat();
            }
            switchToTab(null);
            actioned = true;
          } else if ((p & 3) === 1 && (q & 3) === 3) {
            // p->q +2
            ytBtnCancelTheater();
            actioned = true;
          } else if ((p & 10) === 2 && (q & 10) === 10) {
            // p->q +8
            switchToTab(null);
            actioned = true;
          } else if ((p & (8 | 32)) === (0 | 32) && (q & (8 | 32)) === (8 | 32)) {
            // p->q +8
            ytBtnCloseEngagementPanels();
            actioned = true;
          } else if ((p & (2 | 32)) === (0 | 32) && (q & (2 | 32)) === (2 | 32)) {
            // p->q +2
            ytBtnCloseEngagementPanels();
            actioned = true;
          } else if ((p & (2 | 8)) === (0 | 8) && (q & (2 | 8)) === (2 | 8)) {
            // p->q +2
            ytBtnCollapseChat();
            actioned = true;
            // if( lastPanel && (p & (1|16) === 16)  && (q & (1 | 16 | 8 | 2)) === (16) ){
            //   switchToTab(lastTab)
            //   actioned = true;
            // }
          } else if ((p & 1) === 1 && (q & (1 | 32)) === (0 | 0)) {
            // p->q -1
            if (lastPanel === 'chat') {
              ytBtnExpandChat();
              actioned = true;
            } else if (lastPanel === lastTab && lastTab) {
              switchToTab(lastTab);
              actioned = true;
            }
          }

          // 24 20
          // 8 16   4 16

          if (!actioned && (q & 128) === 128) {
            lastPanel = 'playlist';
            if ((q & 2) === 2) {
              switchToTab(null);
              actioned = true;
            }
          }

          if ((p & 2) === 2 && (q & (2 | 128)) === (0 | 128)) {
            // p->q -2
          } else if ((p & 8) === 8 && (q & (8 | 128)) === (0 | 128)) {
            // p->q -8
          } else if (
            !actioned &&
            (p & (1 | 16)) === 16 &&
            (q & (1 | 16 | 8 | 2 | 32 | 64)) === (16 | 0 | 0)
          ) {
            console.log(388, 'd');
            if (lastPanel === 'chat') {
              console.log(388, 'd1c');
              ytBtnExpandChat();
              actioned = true;
            } else if (lastPanel === 'playlist') {
              console.log(388, 'd1p');
              ytBtnOpenPlaylist();
              actioned = true;
            } else if (lastTab) {
              console.log(388, 'd2t');
              switchToTab(lastTab);
              actioned = true;
            } else if (resetForPanelDisappeared) {
              // if lastTab is undefined
              console.log(388, 'd2d');
              Promise.resolve(lockSet['fixInitialTabStateLock'])
                .then(eventMap['fixInitialTabStateFn'])
                .catch(console.warn);
              actioned = true;
            }
          }

          if (bFixForResizedTab) {
            bFixForResizedTabLater = false;
            Promise.resolve(0).then(eventMap['fixForTabDisplay']).catch(console.warn);
          }

          if (((p & 16) === 16) ^ ((q & 16) === 16)) {
            Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn);
            Promise.resolve(lockSet['removeKeepCommentsScrollerLock'])
              .then(removeKeepCommentsScroller)
              .catch(console.warn);
            Promise.resolve(lockSet['layoutFixLock']).then(layoutFix).catch(console.warn);
          }
        }
      },

      updateOnVideoIdChanged: lockId => {
        if (lockId !== lockGet['updateOnVideoIdChangedLock']) return;
        const videoId = tmpLastVideoId;
        if (!videoId) return;

        const bodyRenderer = elements.infoExpanderRendererBack;
        const bodyRendererNew = elements.infoExpanderRendererFront;

        if (bodyRendererNew && bodyRenderer) {
          insp(bodyRendererNew).data = insp(bodyRenderer).data;
          // if ((bodyRendererNew.hasAttribute('hidden') ? 1 : 0) ^ (bodyRenderer.hasAttribute('hidden') ? 1 : 0)) {
          //   if (bodyRenderer.hasAttribute('hidden')) bodyRendererNew.setAttribute('hidden', '');
          //   else bodyRendererNew.removeAttribute('hidden');
          // }
        }

        Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn);
      },

      fixInitialTabStateFn: async lockId => {
        // console.log('fixInitialTabStateFn 0a');
        if (lockGet['fixInitialTabStateLock'] !== lockId) return;
        // console.log('fixInitialTabStateFn 0b');
        const delayTime = fixInitialTabStateK > 0 ? 200 : 1;
        await delayPn(delayTime);
        if (lockGet['fixInitialTabStateLock'] !== lockId) return;
        // console.log('fixInitialTabStateFn 0c');
        const kTab = document.querySelector('[tyt-tab]');
        const qTab =
          !kTab || kTab.getAttribute('tyt-tab') === ''
            ? checkElementExist('ytd-watch-flexy[is-two-columns_]', '[hidden]')
            : null;
        if (checkElementExist('ytd-playlist-panel-renderer#playlist', '[hidden], [collapsed]')) {
          DEBUG_5085 && console.log('fixInitialTabStateFn 1p');
          switchToTab(null);
        } else if (checkElementExist('ytd-live-chat-frame#chat', '[hidden], [collapsed]')) {
          DEBUG_5085 && console.log('fixInitialTabStateFn 1a');
          switchToTab(null);
          if (checkElementExist('ytd-watch-flexy[theater]', '[hidden]')) {
            ytBtnCollapseChat();
          }
        } else if (qTab) {
          const hasTheater = qTab.hasAttribute('theater');
          if (!hasTheater) {
            DEBUG_5085 && console.log('fixInitialTabStateFn 1b');
            const btn0 = document.querySelector('.tab-btn-visible'); // or default button
            if (btn0) {
              switchToTab(btn0);
            } else {
              switchToTab(null);
            }
          } else {
            DEBUG_5085 && console.log('fixInitialTabStateFn 1c');
            switchToTab(null);
          }
        } else {
          DEBUG_5085 && console.log('fixInitialTabStateFn 1z');
        }
        // console.log('fixInitialTabStateFn 0d');
        fixInitialTabStateK++;
      },

      'tabs-btn-click': evt => {
        const target = evt.target;
        if (
          target instanceof HTMLElement_ &&
          target.classList.contains('tab-btn') &&
          target.hasAttribute000('tyt-tab-content')
        ) {
          evt.preventDefault();
          evt.stopPropagation();
          evt.stopImmediatePropagation();

          const activeLink = target;

          switchToTab(activeLink);
        }
      },
    };

    Promise.all([videosElementProvidedPromise, navigateFinishedPromise])
      .then(eventMap['onceInsertRightTabs'])
      .catch(console.warn);
    Promise.all([navigateFinishedPromise, infoExpanderElementProvidedPromise])
      .then(eventMap['onceInfoExpanderElementProvidedPromised'])
      .catch(console.warn);

    const isCustomElementsProvided =
      typeof customElements !== 'undefined' &&
      typeof (customElements || 0).whenDefined === 'function';

    const promiseForCustomYtElementsReady = isCustomElementsProvided
      ? Promise.resolve(0)
      : new Promise(callback => {
        const EVENT_KEY_ON_REGISTRY_READY = 'ytI-ce-registry-created';
        if (typeof customElements === 'undefined') {
          if (!('__CE_registry' in document)) {
            // https://github.com/webcomponents/polyfills/
            Object.defineProperty(document, '__CE_registry', {
              get() {
                // return undefined
              },
              set(nv) {
                if (typeof nv == 'object') {
                  delete this.__CE_registry;
                  this.__CE_registry = nv;
                  this.dispatchEvent(new CustomEvent(EVENT_KEY_ON_REGISTRY_READY));
                }
                return true;
              },
              enumerable: false,
              configurable: true,
            });
          }
          let eventHandler = _evt => {
            document.removeEventListener(EVENT_KEY_ON_REGISTRY_READY, eventHandler, false);
            const f = callback;
            callback = null;
            eventHandler = null;
            f();
          };
          document.addEventListener(EVENT_KEY_ON_REGISTRY_READY, eventHandler, false);
        } else {
          callback();
        }
      });

    // eslint-disable-next-line no-unused-vars
    const _retrieveCE = async nodeName => {
      try {
        isCustomElementsProvided || (await promiseForCustomYtElementsReady);
        await customElements.whenDefined(nodeName);
      } catch (e) {
        console.warn(e);
      }
    };

    const retrieveCE = async nodeName => {
      try {
        isCustomElementsProvided || (await promiseForCustomYtElementsReady);
        await customElements.whenDefined(nodeName);
        const dummy = document.querySelector(nodeName) || document.createElement(nodeName);
        const cProto = insp(dummy).constructor.prototype;
        return cProto;
      } catch (e) {
        console.warn(e);
      }
    };

    const moOverallRes = {
      _yt_playerProvided: () => (window || 0)._yt_player || 0 || 0,
    };

    let promiseWaitNext = null;
    const moOverall = new MutationObserver(() => {
      if (promiseWaitNext) {
        promiseWaitNext.resolve();
        promiseWaitNext = null;
      }

      if (typeof moOverallRes._yt_playerProvided === 'function') {
        const r = moOverallRes._yt_playerProvided();
        if (r) {
          moOverallRes._yt_playerProvided = r;
          eventMap._yt_playerProvided();
        }
      }
    });

    moOverall.observe(document, { subtree: true, childList: true });

    const moEgmPanelReady = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const target = mutation.target;
        if (!target.hasAttribute000('tyt-egm-panel-jclmd')) continue;
        if (target.hasAttribute000('target-id') && target.hasAttribute000('visibility')) {
          target.removeAttribute000('tyt-egm-panel-jclmd');
          moEgmPanelReadyClearFn();
          Promise.resolve(target)
            .then(eventMap['ytd-engagement-panel-section-list-renderer::bindTarget'])
            .catch(console.warn);
        }
      }
    });

    const moEgmPanelReadyClearFn = () => {
      if (document.querySelector('[tyt-egm-panel-jclmd]') === null) {
        moEgmPanelReady.takeRecords();
        moEgmPanelReady.disconnect();
      }
    };

    document.addEventListener('yt-navigate-finish', eventMap['yt-navigate-finish'], false);

    document.addEventListener(
      'animationstart',
      evt => {
        const f = eventMap[evt.animationName];
        if (typeof f === 'function') f(evt.target);
      },
      capturePassive
    );

    // console.log('hi122')

    mLoaded.flag |= 1;
    document.documentElement.setAttribute111('tabview-loaded', mLoaded.makeString());

    promiseForCustomYtElementsReady.then(eventMap['ceHack']).catch(console.warn);

    // eslint-disable-next-line no-unused-vars
    executionFinished = 1;
  } catch (e) {
    console.log('error 0xF491');
    console.error(e);
  }
};
const styles = {
  main: `
@keyframes relatedElementProvided{0%{background-position-x:3px;}100%{background-position-x:4px;}}
html[tabview-loaded="icp"] #related.ytd-watch-flexy{animation:relatedElementProvided 1ms linear 0s 1 normal forwards;}
html[tabview-loaded="icp"] #right-tabs #related.ytd-watch-flexy,html[tabview-loaded="icp"] [hidden] #related.ytd-watch-flexy,html[tabview-loaded="icp"] #right-tabs ytd-expander#expander,html[tabview-loaded="icp"] [hidden] ytd-expander#expander,html[tabview-loaded="icp"] ytd-comments ytd-expander#expander{animation:initial;}
#secondary.ytd-watch-flexy{position:relative;}
#secondary-inner.style-scope.ytd-watch-flexy{height:100%;}
#secondary-inner secondary-wrapper{display:flex;flex-direction:column;flex-wrap:nowrap;box-sizing:border-box;padding:0;margin:0;border:0;height:100%;max-height:calc(100vh - var(--ytd-toolbar-height,56px));position:absolute;top:0;right:0;left:0;contain:strict;padding:var(--ytd-margin-6x) var(--ytd-margin-6x) var(--ytd-margin-6x) 0;}
#right-tabs{position:relative;display:flex;padding:0;margin:0;flex-grow:1;flex-direction:column;}
[tyt-tab=""] #right-tabs{flex-grow:0;}
[tyt-tab=""] #right-tabs .tab-content{border:0;}
#right-tabs .tab-content{flex-grow:1;}
ytd-watch-flexy[hide-default-text-inline-expander] #primary.style-scope.ytd-watch-flexy ytd-text-inline-expander{display:none;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden{--comment-pre-load-sizing:90px;visibility:collapse;z-index:-1;position:fixed!important;left:2px;top:2px;width:var(--comment-pre-load-sizing)!important;height:var(--comment-pre-load-sizing)!important;display:block!important;pointer-events:none!important;overflow:hidden;contain:strict;border:0;margin:0;padding:0;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments>ytd-item-section-renderer#sections{display:block!important;overflow:hidden;height:var(--comment-pre-load-sizing);width:var(--comment-pre-load-sizing);contain:strict;border:0;margin:0;padding:0;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments>ytd-item-section-renderer#sections>#contents{display:flex!important;flex-direction:row;gap:60px;overflow:hidden;height:var(--comment-pre-load-sizing);width:var(--comment-pre-load-sizing);contain:strict;border:0;margin:0;padding:0;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents{--comment-pre-load-display:none;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents>*:only-of-type,ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents>*:last-child{--comment-pre-load-display:block;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents>*{display:var(--comment-pre-load-display)!important;}
#right-tabs #material-tabs{position:relative;display:flex;padding:0;border:1px solid var(--ytd-searchbox-legacy-border-color);overflow:hidden;}
[tyt-tab] #right-tabs #material-tabs{border-radius:var(--tyt-rounded-a1);}
[tyt-tab^="#"] #right-tabs #material-tabs{border-radius:var(--tyt-rounded-a1) var(--tyt-rounded-a1) 0 0;}
ytd-watch-flexy[flexy]:not([is-two-columns_]) #right-tabs #material-tabs{outline:0;}
#right-tabs #material-tabs a.tab-btn[tyt-tab-content]>*{pointer-events:none;}
#right-tabs #material-tabs a.tab-btn[tyt-tab-content]>.font-size-right{pointer-events:initial;display:none;}
ytd-watch-flexy #right-tabs .tab-content{padding:0;box-sizing:border-box;display:block;border:1px solid var(--ytd-searchbox-legacy-border-color);border-top:0;position:relative;top:0;display:flex;flex-direction:row;overflow:hidden;border-radius:0 0 var(--tyt-rounded-a1) var(--tyt-rounded-a1);}
ytd-watch-flexy:not([is-two-columns_]) #right-tabs .tab-content{height:100%;}
ytd-watch-flexy #right-tabs .tab-content-cld{box-sizing:border-box;position:relative;display:block;width:100%;overflow:auto;--tab-content-padding:var(--ytd-margin-4x);padding:var(--tab-content-padding);contain:layout paint;}
.tab-content-cld,#right-tabs,.tab-content{transition:none;animation:none;}
#right-tabs #emojis.ytd-commentbox{inset:auto 0 auto 0;width:auto;}
ytd-watch-flexy[is-two-columns_] #right-tabs .tab-content-cld{height:100%;width:100%;contain:size layout paint style;position:absolute;}
ytd-watch-flexy #right-tabs .tab-content-cld.tab-content-hidden{display:none;width:100%;contain:size layout paint style;}
@supports (color:var(--tabview-tab-btn-define)){
ytd-watch-flexy #right-tabs .tab-btn{background:var(--yt-spec-general-background-a);}
html{--tyt-tab-btn-flex-grow:1;--tyt-tab-btn-flex-basis:0%;--tyt-tab-bar-color-1-def:#ff4533;--tyt-tab-bar-color-2-def:var(--yt-brand-light-red);--tyt-tab-bar-color-1:var(--main-color,var(--tyt-tab-bar-color-1-def));--tyt-tab-bar-color-2:var(--main-color,var(--tyt-tab-bar-color-2-def));}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]{flex:var(--tyt-tab-btn-flex-grow) 1 var(--tyt-tab-btn-flex-basis);position:relative;display:inline-block;text-decoration:none;text-transform:uppercase;--tyt-tab-btn-color:var(--yt-spec-text-secondary);color:var(--tyt-tab-btn-color);text-align:center;padding:14px 8px 10px;border:0;border-bottom:4px solid transparent;font-weight:500;font-size:12px;line-height:18px;cursor:pointer;transition:border 200ms linear 100ms;background-color:var(--ytd-searchbox-legacy-button-color);text-transform:var(--yt-button-text-transform,inherit);user-select:none!important;overflow:hidden;white-space:nowrap;text-overflow:clip;}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]>svg{height:18px;padding-right:0;vertical-align:bottom;opacity:.5;margin-right:0;color:var(--yt-button-color,inherit);fill:var(--iron-icon-fill-color,currentcolor);stroke:var(--iron-icon-stroke-color,none);pointer-events:none;}
ytd-watch-flexy #right-tabs .tab-btn{--tabview-btn-txt-ml:8px;}
ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"]{--tabview-btn-txt-ml:0;}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]>svg+span{margin-left:var(--tabview-btn-txt-ml);}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].active{font-weight:500;outline:0;--tyt-tab-btn-color:var(--yt-spec-text-primary);background-color:var(--ytd-searchbox-legacy-button-focus-color);border-bottom:2px var(--tyt-tab-bar-color-2) solid;}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].active svg{opacity:.9;}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]:not(.active):hover{background-color:var(--ytd-searchbox-legacy-button-hover-color);--tyt-tab-btn-color:var(--yt-spec-text-primary);}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]:not(.active):hover svg{opacity:.9;}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].tab-btn-hidden{display:none;}
ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"],ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"]:hover{--tyt-tab-btn-color:var(--yt-spec-icon-disabled);}
ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"] span#tyt-cm-count:empty{display:none;}
ytd-watch-flexy #right-tabs .tab-btn span#tyt-cm-count:empty::after{display:inline-block;width:4em;text-align:left;font-size:inherit;color:currentColor;transform:scaleX(.8);}
}
@supports (color:var(--tyt-cm-count-define)){
ytd-watch-flexy{--tyt-x-loading-content-letter-spacing:2px;}
html{--tabview-text-loading:"Loading";--tabview-text-fetching:"Fetching";--tabview-panel-loading:var(--tabview-text-loading);}
html:lang(ja){--tabview-text-loading:"読み込み中";--tabview-text-fetching:"フェッチ..";}
html:lang(ko){--tabview-text-loading:"로딩..";--tabview-text-fetching:"가져오기..";}
html:lang(zh-Hant){--tabview-text-loading:"載入中";--tabview-text-fetching:"擷取中";}
html:lang(zh-Hans){--tabview-text-loading:"加载中";--tabview-text-fetching:"抓取中";}
html:lang(ru){--tabview-text-loading:"Загрузка";--tabview-text-fetching:"Получение";}
ytd-watch-flexy #right-tabs .tab-btn span#tyt-cm-count:empty::after{content:var(--tabview-text-loading);letter-spacing:var(--tyt-x-loading-content-letter-spacing);}
}
@supports (color:var(--tabview-font-size-btn-define)){
.font-size-right{display:inline-flex;flex-direction:column;position:absolute;right:0;top:0;bottom:0;width:16px;padding:4px 0;justify-content:space-evenly;align-content:space-evenly;pointer-events:none;}
html body ytd-watch-flexy.style-scope .font-size-btn{user-select:none!important;}
.font-size-btn{--tyt-font-size-btn-display:none;display:var(--tyt-font-size-btn-display,none);width:12px;height:12px;color:var(--yt-spec-text-secondary);background-color:var(--yt-spec-badge-chip-background);box-sizing:border-box;cursor:pointer;transform-origin:left top;margin:0;padding:0;position:relative;font-family:'Menlo','Lucida Console','Monaco','Consolas',monospace;line-height:100%;font-weight:900;transition:background-color 90ms linear,color 90ms linear;pointer-events:all;}
.font-size-btn:hover{background-color:var(--yt-spec-text-primary);color:var(--yt-spec-general-background-a);}
@supports (zoom:.5){
.tab-btn .font-size-btn{--tyt-font-size-btn-display:none;}
.tab-btn.active:hover .font-size-btn{--tyt-font-size-btn-display:inline-block;}
body ytd-watch-flexy:not([is-two-columns_]) #columns.ytd-watch-flexy{flex-direction:column;}
body ytd-watch-flexy:not([is-two-columns_]) #secondary.ytd-watch-flexy{display:block;width:100%;box-sizing:border-box;}
body ytd-watch-flexy:not([is-two-columns_]) #secondary.ytd-watch-flexy secondary-wrapper{padding-left:var(--ytd-margin-6x);contain:content;height:initial;}
body ytd-watch-flexy:not([is-two-columns_]) #secondary.ytd-watch-flexy secondary-wrapper #right-tabs{overflow:auto;}
[tyt-chat="+"] secondary-wrapper>[tyt-chat-container]{flex-grow:1;flex-shrink:0;display:flex;flex-direction:column;}
[tyt-chat="+"] secondary-wrapper>[tyt-chat-container]>#chat{flex-grow:1;}
ytd-watch-flexy[is-two-columns_]:not([theater]) #columns.style-scope.ytd-watch-flexy{min-height:calc(100vh - var(--ytd-toolbar-height,56px));}
ytd-watch-flexy[is-two-columns_] ytd-live-chat-frame#chat{min-height:initial!important;height:initial!important;}
ytd-watch-flexy[tyt-tab^="#"]:not([is-two-columns_]):not([tyt-chat="+"]) #right-tabs{min-height:var(--ytd-watch-flexy-chat-max-height);}
body ytd-watch-flexy:not([is-two-columns_]) #chat.ytd-watch-flexy{margin-top:0;}
body ytd-watch-flexy:not([is-two-columns_]) ytd-watch-metadata.ytd-watch-flexy{margin-bottom:0;}
ytd-watch-metadata.ytd-watch-flexy ytd-metadata-row-container-renderer{display:none;}
#tab-info [show-expand-button] #expand-sizer.ytd-text-inline-expander{visibility:initial;}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>#left-arrow-container.ytd-video-description-infocards-section-renderer>#left-arrow,#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>#right-arrow-container.ytd-video-description-infocards-section-renderer>#right-arrow{border:6px solid transparent;opacity:.65;}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>#left-arrow-container.ytd-video-description-infocards-section-renderer>#left-arrow:hover,#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>#right-arrow-container.ytd-video-description-infocards-section-renderer>#right-arrow:hover{opacity:1;}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>div#left-arrow-container::before{content:'';background:transparent;width:40px;display:block;height:40px;position:absolute;left:-20px;top:0;z-index:-1;}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>div#right-arrow-container::before{content:'';background:transparent;width:40px;display:block;height:40px;position:absolute;right:-20px;top:0;z-index:-1;}
body ytd-watch-flexy[is-two-columns_][tyt-egm-panel_] #columns.style-scope.ytd-watch-flexy #panels.style-scope.ytd-watch-flexy{flex-grow:1;flex-shrink:0;display:flex;flex-direction:column;}
body ytd-watch-flexy[is-two-columns_][tyt-egm-panel_] #columns.style-scope.ytd-watch-flexy #panels.style-scope.ytd-watch-flexy ytd-engagement-panel-section-list-renderer[target-id][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]{height:initial;max-height:initial;min-height:initial;flex-grow:1;flex-shrink:0;display:flex;flex-direction:column;}
secondary-wrapper [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] ytd-transcript-renderer:not(:empty),secondary-wrapper [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] #body.ytd-transcript-renderer:not(:empty),secondary-wrapper [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] #content.ytd-transcript-renderer:not(:empty){flex-grow:1;height:initial;max-height:initial;min-height:initial;}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer{position:relative;}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer>[panel-target-id]:only-child{contain:style size;}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer ytd-transcript-segment-list-renderer.ytd-transcript-search-panel-renderer{flex-grow:1;contain:strict;}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer ytd-transcript-segment-renderer.style-scope.ytd-transcript-segment-list-renderer{contain:layout paint style;}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer ytd-transcript-segment-renderer.style-scope.ytd-transcript-segment-list-renderer>.segment{contain:layout paint style;}
body ytd-watch-flexy[theater] #secondary.ytd-watch-flexy{margin-top:var(--ytd-margin-3x);padding-top:0;}
body ytd-watch-flexy[theater] secondary-wrapper{margin-top:0;padding-top:0;}
body ytd-watch-flexy[theater] #chat.ytd-watch-flexy{margin-bottom:var(--ytd-margin-2x);}
ytd-watch-flexy[theater] #right-tabs .tab-btn[tyt-tab-content]{padding:8px 4px 6px;border-bottom:0 solid transparent;}
ytd-watch-flexy[theater] #playlist.ytd-watch-flexy{margin-bottom:var(--ytd-margin-2x);}
ytd-watch-flexy[theater] ytd-playlist-panel-renderer[collapsible][collapsed] .header.ytd-playlist-panel-renderer{padding:6px 8px;}
#tab-comments ytd-comments#comments [field-of-cm-count]{margin-top:0;}
#tab-info>ytd-expandable-video-description-body-renderer{margin-bottom:var(--ytd-margin-3x);}
#tab-info [class]:last-child{margin-bottom:0;padding-bottom:0;}
#tab-info ytd-rich-metadata-row-renderer ytd-rich-metadata-renderer{max-width:initial;}
ytd-watch-flexy[is-two-columns_] secondary-wrapper #chat.ytd-watch-flexy{margin-bottom:var(--ytd-margin-3x);}
ytd-watch-flexy[tyt-tab] tp-yt-paper-tooltip{white-space:nowrap;contain:content;}
ytd-watch-info-text tp-yt-paper-tooltip.style-scope.ytd-watch-info-text{margin-bottom:-300px;margin-top:-96px;}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata{font-size:1.2rem;line-height:1.8rem;}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata yt-animated-rolling-number{font-size:inherit;}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata #info-container.style-scope.ytd-watch-info-text{align-items:center;}
ytd-watch-flexy[hide-default-text-inline-expander]{--tyt-bottom-watch-metadata-margin:6px;}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata>#description-inner.ytd-watch-metadata{margin:6px 12px;}
[hide-default-text-inline-expander] ytd-watch-metadata[title-headline-xs] h1.ytd-watch-metadata{font-size:1.8rem;}
ytd-watch-flexy[is-two-columns_][hide-default-text-inline-expander] #below.style-scope.ytd-watch-flexy ytd-merch-shelf-renderer{padding:0;border:0;margin:0;}
ytd-watch-flexy[is-two-columns_][hide-default-text-inline-expander] #below.style-scope.ytd-watch-flexy ytd-watch-metadata.ytd-watch-flexy{margin-bottom:6px;}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model--horizontal .yt-video-attribute-view-model__link-container .yt-video-attribute-view-model__hero-section{flex-shrink:0;}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model__overflow-menu{background:var(--yt-emoji-picker-category-background-color);border-radius:99px;}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model--image-square.yt-video-attribute-view-model--image-large .yt-video-attribute-view-model__hero-section{max-height:128px;}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model--image-large .yt-video-attribute-view-model__hero-section{max-width:128px;}
#tab-info ytd-reel-shelf-renderer #items.yt-horizontal-list-renderer ytd-reel-item-renderer.yt-horizontal-list-renderer{max-width:142px;}
ytd-watch-info-text#ytd-watch-info-text.style-scope.ytd-watch-metadata #view-count.style-scope.ytd-watch-info-text,ytd-watch-info-text#ytd-watch-info-text.style-scope.ytd-watch-metadata #date-text.style-scope.ytd-watch-info-text{align-items:center;}
ytd-watch-info-text:not([detailed]) #info.ytd-watch-info-text a.yt-simple-endpoint.yt-formatted-string{pointer-events:none;}
body ytd-app>ytd-popup-container>tp-yt-iron-dropdown>#contentWrapper>[slot="dropdown-content"]{backdrop-filter:none;}
#tab-info [tyt-clone-refresh-count]{overflow:visible!important;}
#tab-info #items.ytd-horizontal-card-list-renderer yt-video-attribute-view-model.ytd-horizontal-card-list-renderer{contain:layout;}
#tab-info #thumbnail-container.ytd-structured-description-channel-lockup-renderer,#tab-info ytd-media-lockup-renderer[is-compact] #thumbnail-container.ytd-media-lockup-renderer{flex-shrink:0;}
secondary-wrapper ytd-donation-unavailable-renderer{--ytd-margin-6x:var(--ytd-margin-2x);--ytd-margin-5x:var(--ytd-margin-2x);--ytd-margin-4x:var(--ytd-margin-2x);--ytd-margin-3x:var(--ytd-margin-2x);}
[tyt-no-less-btn] #less{display:none;}
.tyt-metadata-hover-resized #purchase-button,.tyt-metadata-hover-resized #sponsor-button,.tyt-metadata-hover-resized #analytics-button,.tyt-metadata-hover-resized #subscribe-button{display:none!important;}
.tyt-metadata-hover #upload-info{max-width:max-content;min-width:max-content;flex-basis:100vw;flex-shrink:0;}
.tyt-info-invisible{display:none;}
[tyt-playlist-expanded] secondary-wrapper>ytd-playlist-panel-renderer#playlist{overflow:auto;flex-shrink:1;flex-grow:1;max-height:unset!important;}
[tyt-playlist-expanded] secondary-wrapper>ytd-playlist-panel-renderer#playlist>#container{max-height:unset!important;}
secondary-wrapper ytd-playlist-panel-renderer{--ytd-margin-6x:var(--ytd-margin-3x);}
#tab-info ytd-structured-description-playlist-lockup-renderer[collections] #playlist-thumbnail.style-scope.ytd-structured-description-playlist-lockup-renderer{max-width:100%;}
#tab-info ytd-structured-description-playlist-lockup-renderer[collections] #lockup-container.ytd-structured-description-playlist-lockup-renderer{padding:1px;}
#tab-info ytd-structured-description-playlist-lockup-renderer[collections] #thumbnail.ytd-structured-description-playlist-lockup-renderer{outline:1px solid rgba(127,127,127,.5);}
ytd-live-chat-frame#chat[collapsed] ytd-message-renderer~#show-hide-button.ytd-live-chat-frame>ytd-toggle-button-renderer.ytd-live-chat-frame{padding:0;}
ytd-watch-flexy{--tyt-bottom-watch-metadata-margin:12px;}
ytd-watch-flexy[rounded-info-panel],ytd-watch-flexy[rounded-player-large]{--tyt-rounded-a1:12px;}
#bottom-row.style-scope.ytd-watch-metadata .item.ytd-watch-metadata{margin-right:var(--tyt-bottom-watch-metadata-margin,12px);margin-top:var(--tyt-bottom-watch-metadata-margin,12px);}
#cinematics{contain:layout style size;}
ytd-watch-flexy[is-two-columns_]{contain:layout style;}
  `,
};
(async () => {
  const communicationKey = `ck-${Date.now()}-${Math.floor(Math.random() * 314159265359 + 314159265359).toString(36)}`;

  /** @type {globalThis.PromiseConstructor} */
  const Promise = (async () => { })().constructor; // YouTube hacks Promise in WaterFox Classic and "Promise.resolve(0)" nevers resolve.

  if (!document.documentElement) {
    await Promise.resolve(0);
    while (!document.documentElement) {
      await new Promise(resolve => nextBrowserTick(resolve)).then().catch(console.warn);
    }
  }
  const sourceURL = 'debug://tabview-youtube/tabview.execution.js';
  const textContent = `(${executionScript})("${communicationKey}");${'\n\n'}//# sourceURL=${sourceURL}${'\n'}`;

  // Inject script using a script element with the page's nonce (if available) to comply with CSP
  let script = document.createElement('script');

  // Try to get the nonce from an existing script on the page
  const existingScript = document.querySelector('script[nonce]');
  if (existingScript && existingScript.nonce) {
    script.nonce = existingScript.nonce;
  }

  // Use TrustedTypes if available
  if (typeof trustedTypes !== 'undefined' && trustedTypes.defaultPolicy) {
    script.textContent = trustedTypes.defaultPolicy.createScript(textContent);
  } else {
    script.textContent = textContent;
  }

  (document.head || document.documentElement).appendChild(script);
  script.remove();
  script = null;

  const style = document.createElement('style');
  const sourceURLMainCSS = 'debug://tabview-youtube/tabview.main.css';
  style.textContent = `${styles['main'].trim()}${'\n\n'}/*# sourceURL=${sourceURLMainCSS} */${'\n'}`;
  document.documentElement.appendChild(style);
})();

// --- MODULE: basic.js ---

const YouTubeUtils = (() => {
  'use strict';

  /**
   * Error logging with module context
   * @param {string} module - Module name
   * @param {string} message - Error message
   * @param {Error} error - Error object
   */
  const logError = (module, message, error) => {
    console.error(`[YouTube+][${module}] ${message}:`, error);
  };

  /**
   * Safe function wrapper with error handling
   * @param {Function} fn - Function to wrap
   * @param {string} context - Context for error logging
   * @returns {Function} Wrapped function
   */
  const safeExecute = (fn, context = 'Unknown') => {
    /** @this {any} */
    return function (...args) {
      try {
        return fn.apply(this, args);
      } catch (error) {
        logError(context, 'Execution failed', error);
        return null;
      }
    };
  };

  /**
   * Safe async function wrapper with error handling
   * @param {Function} fn - Async function to wrap
   * @param {string} context - Context for error logging
   * @returns {Function} Wrapped async function
   */
  const safeExecuteAsync = (fn, context = 'Unknown') => {
    /** @this {any} */
    return async function (...args) {
      try {
        return await fn.apply(this, args);
      } catch (error) {
        logError(context, 'Async execution failed', error);
        return null;
      }
    };
  };

  /**
   * Sanitize HTML string to prevent XSS
   * @param {string} html - HTML string to sanitize
   * @returns {string} Sanitized HTML
   */
  const sanitizeHTML = html => {
    if (typeof html !== 'string') return '';

    const map = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
    };

    return html.replace(/[<>&"'\/]/g, char => map[char]);
  };

  /**
   * Validate URL to prevent injection attacks
   * @param {string} url - URL to validate
   * @returns {boolean} Whether URL is safe
   */
  const isValidURL = url => {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      // Only allow http and https protocols
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  /**
   * Safe localStorage wrapper
   */
  const storage = {
    /**
     * Get item from localStorage with JSON parsing
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value if key doesn't exist
     * @returns {*} Parsed value or default
     */
    get: (key, defaultValue = null) => {
      try {
        if (typeof key !== 'string' || !key) {
          logError('Storage', 'Invalid storage key', new Error('Key must be a non-empty string'));
          return defaultValue;
        }
        const value = localStorage.getItem(key);
        return value !== null ? JSON.parse(value) : defaultValue;
      } catch (e) {
        logError('Storage', `Failed to get item: ${key}`, e);
        return defaultValue;
      }
    },

    /**
     * Set item to localStorage with JSON serialization
     * @param {string} key - Storage key
     * @param {*} value - Value to store
     * @returns {boolean} Success status
     */
    set: (key, value) => {
      try {
        if (typeof key !== 'string' || !key) {
          logError('Storage', 'Invalid storage key', new Error('Key must be a non-empty string'));
          return false;
        }
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        logError('Storage', `Failed to set item: ${key}`, e);
        return false;
      }
    },

    /**
     * Remove item from localStorage
     * @param {string} key - Storage key
     */
    remove: key => {
      try {
        if (typeof key !== 'string' || !key) {
          logError('Storage', 'Invalid storage key', new Error('Key must be a non-empty string'));
          return;
        }
        localStorage.removeItem(key);
      } catch (e) {
        logError('Storage', `Failed to remove item: ${key}`, e);
      }
    },
  };

  // Use shared debounce and throttle from YouTubeUtils (defined in utils.js)
  const debounce =
    /** @type {any} */ (window).YouTubeUtils?.debounce ||
    ((func, wait, options = {}) => {
      let timeout;
      let lastArgs;
      let lastThis;

      /** @this {any} */
      const debounced = function (...args) {
        lastArgs = args;
        lastThis = this;
        clearTimeout(timeout);

        if (options.leading && !timeout) {
          /** @type {Function} */ (func).apply(this, args);
        }

        timeout = setTimeout(() => {
          if (!options.leading) {
            /** @type {Function} */ (func).apply(lastThis, lastArgs);
          }
          timeout = null;
          lastArgs = null;
          lastThis = null;
        }, wait);
      };

      debounced.cancel = () => {
        clearTimeout(timeout);
        timeout = null;
        lastArgs = null;
        lastThis = null;
      };

      return debounced;
    });

  const throttle =
    /** @type {any} */ (window).YouTubeUtils?.throttle ||
    ((func, limit) => {
      let inThrottle;
      let lastResult;

      /** @this {any} */
      return function (...args) {
        if (!inThrottle) {
          lastResult = /** @type {Function} */ (func).apply(this, args);
          inThrottle = true;
          setTimeout(() => (inThrottle = false), limit);
        }
        return lastResult;
      };
    });

  /**
   * Safe DOM element creation with props and children
   * @param {string} tag - HTML tag name
   * @param {Object} props - Element properties
   * @param {Array} children - Child elements or text
   * @returns {HTMLElement} Created element
   */
  const createElement = (tag, props = {}, children = []) => {
    // Validate tag name to prevent XSS
    const validTags = /^[a-z][a-z0-9-]*$/i;
    if (!validTags.test(tag)) {
      logError('createElement', 'Invalid tag name', new Error(`Tag "${tag}" is not allowed`));
      return document.createElement('div');
    }

    const element = document.createElement(tag);

    Object.entries(props).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.substring(2).toLowerCase(), value);
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.assign(element.dataset, value);
      } else if (key === 'innerHTML' || key === 'outerHTML') {
        // Prevent direct HTML injection
        logError(
          'createElement',
          'Direct HTML injection prevented',
          new Error('Use children array instead')
        );
      } else {
        try {
          element.setAttribute(key, value);
        } catch (e) {
          logError('createElement', `Failed to set attribute ${key}`, e);
        }
      }
    });

    children.forEach(child => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        element.appendChild(child);
      }
    });

    return element;
  };

  /**
   * DOM Selector Cache with automatic cleanup
   */
  const selectorCache = new Map();
  const CACHE_MAX_SIZE = 50;
  const CACHE_MAX_AGE = 5000; // 5 seconds

  /**
   * Cached querySelector with LRU-like eviction
   * @param {string} selector - CSS selector
   * @param {boolean} nocache - Skip cache
   * @returns {HTMLElement|null} Found element
   */
  const querySelector = (selector, nocache = false) => {
    if (nocache) return document.querySelector(selector);

    const now = Date.now();
    const cached = selectorCache.get(selector);

    // Check if cached element is still valid
    if (cached?.element?.isConnected && now - cached.timestamp < CACHE_MAX_AGE) {
      return cached.element;
    }

    // Remove stale entry
    if (cached) {
      selectorCache.delete(selector);
    }

    const element = document.querySelector(selector);

    if (element) {
      // LRU eviction: remove oldest entries if cache is full
      if (selectorCache.size >= CACHE_MAX_SIZE) {
        const firstKey = selectorCache.keys().next().value;
        selectorCache.delete(firstKey);
      }

      selectorCache.set(selector, { element, timestamp: now });
    }

    return element;
  };

  /**
   * Wait for element with timeout and AbortController
   * @param {string} selector - CSS selector
   * @param {number} timeout - Timeout in ms
   * @param {HTMLElement} parent - Parent element to search in
   * @returns {Promise<HTMLElement>} Promise resolving to element
   */
  const waitForElement = (selector, timeout = 5000, parent = document.body) => {
    return new Promise((resolve, reject) => {
      // Validate inputs
      if (!selector || typeof selector !== 'string') {
        reject(new Error('Selector must be a non-empty string'));
        return;
      }

      if (!parent || !(parent instanceof Element)) {
        reject(new Error('Parent must be a valid DOM element'));
        return;
      }

      // Check if element already exists
      try {
        const element = parent.querySelector(selector);
        if (element) {
          resolve(/** @type {HTMLElement} */(/** @type {unknown} */ (element)));
          return;
        }
      } catch {
        reject(new Error(`Invalid selector: ${selector}`));
        return;
      }

      const controller = new AbortController();
      let observer = null;

      const timeoutId = setTimeout(() => {
        controller.abort();
        if (observer) {
          try {
            observer.disconnect();
          } catch (e) {
            logError('waitForElement', 'Observer disconnect failed', e);
          }
        }
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);

      observer = new MutationObserver(() => {
        try {
          const element = parent.querySelector(selector);
          if (element) {
            clearTimeout(timeoutId);
            observer.disconnect();
            resolve(/** @type {HTMLElement} */(/** @type {unknown} */ (element)));
          }
        } catch (e) {
          logError('waitForElement', 'Observer callback error', e);
        }
      });

      try {
        // Ensure parent supports observe/querySelector
        if (!(parent instanceof Element) && parent !== document) {
          throw new Error('Parent does not support observation');
        }
        observer.observe(parent, { childList: true, subtree: true });
      } catch {
        // Fallback for browsers without signal support
        try {
          observer.observe(parent, { childList: true, subtree: true });
        } catch {
          clearTimeout(timeoutId);
          reject(new Error('Failed to observe DOM'));
        }
      }
    });
  };

  /**
   * Resource Cleanup Manager
   * Manages observers, listeners, and intervals
   */
  const cleanupManager = {
    observers: new Set(),
    listeners: new Map(),
    intervals: new Set(),
    timeouts: new Set(),
    animationFrames: new Set(),

    /**
     * Register MutationObserver for cleanup
     * @param {MutationObserver} observer - Observer to register
     * @returns {MutationObserver} Registered observer
     */
    registerObserver: observer => {
      cleanupManager.observers.add(observer);
      return observer;
    },

    /**
     * Unregister and disconnect specific observer
     * @param {MutationObserver} observer - Observer to unregister
     */
    unregisterObserver: observer => {
      if (observer) {
        try {
          observer.disconnect();
        } catch (e) {
          logError('Cleanup', 'Observer disconnect failed', e);
        }
        cleanupManager.observers.delete(observer);
      }
    },

    /**
     * Register event listener for cleanup
     * @param {EventTarget|Document|Window} element - Target element
     * @param {string} event - Event name
     * @param {EventListener|EventListenerObject} handler - Event handler
     * @param {Object} options - Event listener options
     * @returns {Symbol} Listener key for later removal
     */
    registerListener: (element, event, handler, options) => {
      const key = Symbol('listener');
      cleanupManager.listeners.set(key, { element, event, handler, options });
      try {
        element.addEventListener(event, /** @type {EventListener} */(handler), options);
      } catch {
        // best-effort: if addEventListener fails, still register the listener record
      }
      return key;
    },

    /**
     * Unregister specific listener
     * @param {Symbol} key - Listener key
     */
    unregisterListener: key => {
      const listener = cleanupManager.listeners.get(key);
      if (listener) {
        const { element, event, handler, options } = listener;
        try {
          element.removeEventListener(event, handler, options);
        } catch (e) {
          logError('Cleanup', 'Listener removal failed', e);
        }
        cleanupManager.listeners.delete(key);
      }
    },

    /**
     * Register interval for cleanup
     * @param {TimerId} id - Interval ID
     * @returns {TimerId} Interval ID
     */
    registerInterval: id => {
      cleanupManager.intervals.add(id);
      return id;
    },

    /**
     * Unregister specific interval
     * @param {number} id - Interval ID
     */
    unregisterInterval: id => {
      clearInterval(id);
      cleanupManager.intervals.delete(id);
    },

    /**
     * Register timeout for cleanup
     * @param {TimerId} id - Timeout ID
     * @returns {TimerId} Timeout ID
     */
    registerTimeout: id => {
      cleanupManager.timeouts.add(id);
      return id;
    },

    /**
     * Unregister specific timeout
     * @param {number} id - Timeout ID
     */
    unregisterTimeout: id => {
      clearTimeout(id);
      cleanupManager.timeouts.delete(id);
    },

    /**
     * Register animation frame for cleanup
     * @param {number} id - Animation frame ID
     * @returns {number} Animation frame ID
     */
    registerAnimationFrame: id => {
      cleanupManager.animationFrames.add(id);
      return id;
    },

    /**
     * Unregister specific animation frame
     * @param {number} id - Animation frame ID
     */
    unregisterAnimationFrame: id => {
      cancelAnimationFrame(id);
      cleanupManager.animationFrames.delete(id);
    },

    /**
     * Cleanup all registered resources
     */
    cleanup: () => {
      // Disconnect all observers
      cleanupManager.observers.forEach(obs => {
        try {
          obs.disconnect();
        } catch (e) {
          logError('Cleanup', 'Observer disconnect failed', e);
        }
      });
      cleanupManager.observers.clear();

      // Remove all listeners
      cleanupManager.listeners.forEach(({ element, event, handler, options }) => {
        try {
          element.removeEventListener(event, handler, options);
        } catch (e) {
          logError('Cleanup', 'Listener removal failed', e);
        }
      });
      cleanupManager.listeners.clear();

      // Clear all intervals
      cleanupManager.intervals.forEach(id => clearInterval(id));
      cleanupManager.intervals.clear();

      // Clear all timeouts
      cleanupManager.timeouts.forEach(id => clearTimeout(id));
      cleanupManager.timeouts.clear();

      // Cancel all animation frames
      cleanupManager.animationFrames.forEach(id => cancelAnimationFrame(id));
      cleanupManager.animationFrames.clear();
    },
  };

  /**
   * Settings Manager
   * Centralized settings storage and retrieval
   */
  const SettingsManager = {
    storageKey: 'youtube_plus_all_settings_v2',

    defaults: {
      speedControl: { enabled: true, currentSpeed: 1 },
      screenshot: { enabled: true },
      download: { enabled: true },
      updateChecker: { enabled: true },
      adBlocker: { enabled: true },
      pip: { enabled: true },
      timecodes: { enabled: true },
      // Add other modules...
    },

    /**
     * Load all settings
     * @returns {Object} Settings object
     */
    load() {
      const saved = storage.get(this.storageKey);
      return saved ? { ...this.defaults, ...saved } : { ...this.defaults };
    },

    /**
     * Save all settings
     * @param {Object} settings - Settings to save
     */
    save(settings) {
      storage.set(this.storageKey, settings);
      // Dispatch event for modules to react
      window.dispatchEvent(
        new CustomEvent('youtube-plus-settings-changed', {
          detail: settings,
        })
      );
    },

    /**
     * Get setting by path
     * @param {string} path - Dot-separated path (e.g., 'speedControl.enabled')
     * @returns {*} Setting value
     */
    get(path) {
      const settings = this.load();
      return path.split('.').reduce((obj, key) => obj?.[key], settings);
    },

    /**
     * Set setting by path
     * @param {string} path - Dot-separated path
     * @param {*} value - Value to set
     */
    set(path, value) {
      const settings = this.load();
      const keys = path.split('.');
      const last = keys.pop();
      const target = keys.reduce((obj, key) => {
        obj[key] = obj[key] || {};
        return obj[key];
      }, settings);
      target[last] = value;
      this.save(settings);
    },
  };

  /**
   * Style Manager
   * Centralized CSS injection and management
   */
  const StyleManager = {
    styles: new Map(),
    element: null,

    /**
     * Add CSS rules
     * @param {string} id - Unique identifier
     * @param {string} css - CSS rules
     */
    add(id, css) {
      if (typeof id !== 'string' || !id) {
        logError('StyleManager', 'Invalid style ID', new Error('ID must be a non-empty string'));
        return;
      }
      if (typeof css !== 'string') {
        logError('StyleManager', 'Invalid CSS', new Error('CSS must be a string'));
        return;
      }
      this.styles.set(id, css);
      this.update();
    },

    /**
     * Remove CSS rules
     * @param {string} id - Identifier
     */
    remove(id) {
      this.styles.delete(id);
      this.update();
    },

    /**
     * Update style element
     */
    update() {
      try {
        if (!this.element) {
          this.element = document.createElement('style');
          this.element.id = 'youtube-plus-styles';
          this.element.type = 'text/css';
          (document.head || document.documentElement).appendChild(this.element);
        }
        this.element.textContent = Array.from(this.styles.values()).join('\n');
      } catch (error) {
        logError('StyleManager', 'Failed to update styles', error);
      }
    },

    /**
     * Clear all styles
     */
    clear() {
      this.styles.clear();
      if (this.element) {
        try {
          this.element.remove();
        } catch (e) {
          logError('StyleManager', 'Failed to remove style element', e);
        }
        this.element = null;
      }
    },
  };

  /**
   * Centralized Notification System
   * Manages all notifications with queue and deduplication
   */
  const NotificationManager = {
    queue: [],
    activeNotifications: new Set(),
    maxVisible: 3,
    defaultDuration: 3000,

    /**
     * Show notification
     * @param {string} message - Notification message
     * @param {Object} options - Notification options
     * @returns {HTMLElement} Notification element
     */
    show(message, options = {}) {
      // Validate message
      if (!message || typeof message !== 'string') {
        logError(
          'NotificationManager',
          'Invalid message',
          new Error('Message must be a non-empty string')
        );
        return null;
      }

      const {
        duration = this.defaultDuration,
        position = null,
        action = null, // { text: string, callback: function }
      } = options;

      // Remove duplicate messages
      this.activeNotifications.forEach(notif => {
        if (notif.dataset.message === message) {
          this.remove(notif);
        }
      });

      const positions = {
        'top-right': { top: '20px', right: '20px' },
        'top-left': { top: '20px', left: '20px' },
        'bottom-right': { bottom: '20px', right: '20px' },
        'bottom-left': { bottom: '20px', left: '20px' },
      };

      try {
        // Use shared enhancer notification class for consistent appearance
        const notification = createElement('div', {
          className: 'youtube-enhancer-notification',
          dataset: { message }, // Store message for deduplication
          // Keep minimal inline styles; main visuals come from the shared CSS class
          style: Object.assign(
            {
              zIndex: '10001',
              width: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            },
            position && positions[position] ? positions[position] : {}
          ),
        });

        // Add message (with accessibility attributes)
        notification.setAttribute('role', 'status');
        notification.setAttribute('aria-live', 'polite');
        notification.setAttribute('aria-atomic', 'true');

        const messageSpan = createElement(
          'span',
          {
            style: { flex: '1' },
          },
          [message]
        );
        notification.appendChild(messageSpan);

        // Add action button if provided
        if (action && action.text && typeof action.callback === 'function') {
          const actionBtn = createElement(
            'button',
            {
              style: {
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.3)',
                color: 'white',
                padding: '4px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                transition: 'background 0.2s',
              },
              onClick: () => {
                action.callback();
                this.remove(notification);
              },
            },
            [action.text]
          );
          notification.appendChild(actionBtn);
        }

        document.body.appendChild(notification);
        this.activeNotifications.add(notification);

        // Auto-dismiss
        if (duration > 0) {
          const timeoutId = setTimeout(() => this.remove(notification), duration);
          cleanupManager.registerTimeout(timeoutId);
        }

        // Limit visible notifications
        if (this.activeNotifications.size > this.maxVisible) {
          const oldest = Array.from(this.activeNotifications)[0];
          this.remove(oldest);
        }

        return notification;
      } catch (error) {
        logError('NotificationManager', 'Failed to show notification', error);
        return null;
      }
    },

    /**
     * Remove notification
     * @param {HTMLElement} notification - Notification element
     */
    remove(notification) {
      if (!notification || !notification.isConnected) return;

      try {
        notification.style.transform = 'translateY(100%)';
        notification.style.opacity = '0';

        const timeoutId = setTimeout(() => {
          try {
            notification.remove();
            this.activeNotifications.delete(notification);
          } catch (e) {
            logError('NotificationManager', 'Failed to remove notification', e);
          }
        }, 300);
        cleanupManager.registerTimeout(timeoutId);
      } catch (error) {
        logError('NotificationManager', 'Failed to animate notification removal', error);
        // Force remove
        notification.remove();
        this.activeNotifications.delete(notification);
      }
    },

    /**
     * Clear all notifications
     */
    clearAll() {
      this.activeNotifications.forEach(notif => {
        try {
          notif.remove();
        } catch (e) {
          logError('NotificationManager', 'Failed to clear notification', e);
        }
      });
      this.activeNotifications.clear();
    },
  };

  // Add notification animation styles
  StyleManager.add(
    'notification-animations',
    `
    @keyframes slideInFromBottom {
      from { transform: translateY(100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `
  );

  // Global cleanup on page unload
  window.addEventListener('beforeunload', () => {
    cleanupManager.cleanup();
    selectorCache.clear();
    StyleManager.clear();
    NotificationManager.clearAll();
  });

  // Periodic cache cleanup to prevent memory leaks
  const cacheCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of selectorCache.entries()) {
      if (!value.element?.isConnected || now - value.timestamp > CACHE_MAX_AGE) {
        selectorCache.delete(key);
      }
    }
  }, 30000); // Clean every 30 seconds

  cleanupManager.registerInterval(cacheCleanupInterval);

  // Global error handler for uncaught promise rejections
  window.addEventListener('unhandledrejection', event => {
    logError('Global', 'Unhandled promise rejection', event.reason);
    event.preventDefault(); // Prevent console spam
  });

  // Global error handler for uncaught errors
  window.addEventListener('error', event => {
    // Only log errors from our script
    if (event.filename && event.filename.includes('youtube')) {
      logError(
        'Global',
        'Uncaught error',
        new Error(`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`)
      );
    }
  });

  /**
   * Performance monitoring wrapper
   * @param {string} label - Operation label
   * @param {Function} fn - Function to monitor
   * @returns {Function} Wrapped function
   */
  const measurePerformance = (label, fn) => {
    /** @this {any} */
    return function (...args) {
      const start = performance.now();
      try {
        const result = fn.apply(this, args);
        const duration = performance.now() - start;
        if (duration > 100) {
          console.warn(`[YouTube+][Performance] ${label} took ${duration.toFixed(2)}ms`);
        }
        return result;
      } catch (error) {
        logError('Performance', `${label} failed`, error);
        throw error;
      }
    };
  };

  /**
   * Async performance monitoring wrapper
   * @param {string} label - Operation label
   * @param {Function} fn - Async function to monitor
   * @returns {Function} Wrapped async function
   */
  const measurePerformanceAsync = (label, fn) => {
    /** @this {any} */
    return async function (...args) {
      const start = performance.now();
      try {
        const result = await fn.apply(this, args);
        const duration = performance.now() - start;
        if (duration > 100) {
          console.warn(`[YouTube+][Performance] ${label} took ${duration.toFixed(2)}ms`);
        }
        return result;
      } catch (error) {
        logError('Performance', `${label} failed`, error);
        throw error;
      }
    };
  };

  /**
   * Mobile device detection
   * @returns {boolean} True if mobile device
   */
  const isMobile = () => {
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth <= 768
    );
  };

  /**
   * Get viewport dimensions
   * @returns {Object} Width and height
   */
  const getViewport = () => ({
    width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
    height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
  });

  /**
   * Safe async retry wrapper
   * @param {Function} fn - Async function to retry
   * @param {number} retries - Number of retries
   * @param {number} delay - Delay between retries
   * @returns {Promise} Result or error
   */
  const retryAsync = async (fn, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    }
  };

  // Export public API
  return {
    logError,
    safeExecute,
    safeExecuteAsync,
    sanitizeHTML,
    isValidURL,
    storage,
    debounce,
    throttle,
    createElement,
    querySelector,
    waitForElement,
    cleanupManager,
    SettingsManager,
    StyleManager,
    NotificationManager,
    clearCache: () => selectorCache.clear(),
    isMobile,
    getViewport,
    retryAsync,
    measurePerformance,
    measurePerformanceAsync,
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  // Merge utilities into existing global YouTubeUtils without overwriting
  /** @type {any} */ (window).YouTubeUtils = /** @type {any} */ (window).YouTubeUtils || {};
  const existing = /** @type {any} */ (window).YouTubeUtils;
  try {
    for (const k of Object.keys(YouTubeUtils)) {
      if (existing[k] === undefined) existing[k] = YouTubeUtils[k];
    }
  } catch { }

  // Add initialization health check (non-intrusive)
  console.log('[YouTube+ v2.0] Core utilities merged');

  // Expose debug info
  /** @type {any} */ (window).YouTubePlusDebug = {
    version: '2.0',
    cacheSize: () =>
      YouTubeUtils.cleanupManager.observers.size +
      YouTubeUtils.cleanupManager.listeners.size +
      YouTubeUtils.cleanupManager.intervals.size,
    clearAll: () => {
      YouTubeUtils.cleanupManager.cleanup();
      YouTubeUtils.clearCache();
      YouTubeUtils.StyleManager.clear();
      YouTubeUtils.NotificationManager.clearAll();
      console.log('[YouTube+] All resources cleared');
    },
    stats: () => ({
      observers: YouTubeUtils.cleanupManager.observers.size,
      listeners: YouTubeUtils.cleanupManager.listeners.size,
      intervals: YouTubeUtils.cleanupManager.intervals.size,
      timeouts: YouTubeUtils.cleanupManager.timeouts.size,
      animationFrames: YouTubeUtils.cleanupManager.animationFrames.size,
      styles: YouTubeUtils.StyleManager.styles.size,
      notifications: YouTubeUtils.NotificationManager.activeNotifications.size,
    }),
  };

  // Show subtle startup notification (only once per session)
  if (!sessionStorage.getItem('youtube_plus_started')) {
    sessionStorage.setItem('youtube_plus_started', 'true');
    setTimeout(() => {
      if (YouTubeUtils.NotificationManager) {
        YouTubeUtils.NotificationManager.show('YouTube+ v2.0 loaded', {
          type: 'success',
          duration: 2000,
          position: 'bottom-right',
        });
      }
    }, 1000);
  }
} //-----------------------------------------------------------------------------
// YouTube enhancements module
(function () {
  'use strict';

  const YouTubeEnhancer = {
    // Speed control variables
    speedControl: {
      currentSpeed: 1,
      activeAnimationId: null,
      storageKey: 'youtube_playback_speed',
    },

    _initialized: false,

    // Settings
    settings: {
      enableSpeedControl: true,
      enableScreenshot: true,
      enableDownload: true,
      // Состояние сайтов внутри сабменю кнопки Download (ytdl всегда включён)
      downloadSites: {
        y2mate: true,
        xbbuddy: true,
      },
      // Настройки кастомизации download сайтов
      downloadSiteCustomization: {
        y2mate: {
          name: 'Y2Mate',
          url: 'https://www.y2mate.com/youtube/{videoId}',
        },
        xbbuddy: {
          name: '9xbuddy',
          url: 'https://9xbuddy.org/process?url={videoUrl}',
        },
      },
      storageKey: 'youtube_plus_settings',
    },

    // Cache DOM queries
    _cache: new Map(),

    // Cached element getter
    getElement(selector, useCache = true) {
      if (useCache && this._cache.has(selector)) {
        const element = this._cache.get(selector);
        if (element?.isConnected) return element;
        this._cache.delete(selector);
      }

      const element = document.querySelector(selector);
      if (element && useCache) this._cache.set(selector, element);
      return element;
    },

    loadSettings() {
      try {
        const saved = localStorage.getItem(this.settings.storageKey);
        if (saved) Object.assign(this.settings, JSON.parse(saved));
      } catch (e) {
        console.error('Error loading settings:', e);
      }
    },

    init() {
      if (this._initialized) {
        return;
      }

      this._initialized = true;

      try {
        this.loadSettings();
      } catch (error) {
        console.warn('[YouTube Enhancer] Failed to load settings during init:', error);
      }

      this.insertStyles();
      this.addSettingsButtonToHeader();
      this.setupNavigationObserver();

      if (location.href.includes('watch?v=')) {
        this.setupCurrentPage();
      }

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && location.href.includes('watch?v=')) {
          this.setupCurrentPage();
        }
      });
    },

    saveSettings() {
      localStorage.setItem(this.settings.storageKey, JSON.stringify(this.settings));
      this.updatePageBasedOnSettings();
      this.refreshDownloadButton();
    },

    updatePageBasedOnSettings() {
      const settingsMap = {
        'ytp-screenshot-button': 'enableScreenshot',
        'ytp-download-button': 'enableDownload',
        'speed-control-btn': 'enableSpeedControl',
      };

      Object.entries(settingsMap).forEach(([className, setting]) => {
        const button = this.getElement(`.${className}`, false);
        if (button) button.style.display = this.settings[setting] ? '' : 'none';
      });
    },

    refreshDownloadButton() {
      const selector = '.ytp-download-button';

      // Очистить кеш, чтобы избежать возврата удалённых элементов
      if (this._cache.has(selector)) {
        this._cache.delete(selector);
      }

      const existingButton = document.querySelector(selector);
      if (existingButton?.parentElement) {
        existingButton.remove();
      }

      if (!this.settings.enableDownload) {
        return;
      }

      const controls = this.getElement('.ytp-right-controls', false);
      if (!controls) {
        return;
      }

      this.addDownloadButton(controls);
    },

    setupCurrentPage() {
      this.waitForElement('#player-container-outer .html5-video-player, .ytp-right-controls', 5000)
        .then(() => {
          this.addCustomButtons();
          this.setupVideoObserver();
          this.applyCurrentSpeed();
          this.updatePageBasedOnSettings();
          this.refreshDownloadButton();
        })
        .catch(() => { });
    },

    insertStyles() {
      // Glassmorphism styles for modal and controls
      const styles = `:root{--yt-accent:#ff0000;--yt-accent-hover:#cc0000;--yt-radius-sm:6px;--yt-radius-md:10px;--yt-radius-lg:16px;--yt-transition:all .2s ease;--yt-space-xs:4px;--yt-space-sm:8px;--yt-space-md:16px;--yt-space-lg:24px;--yt-glass-blur:blur(18px) saturate(180%);--yt-glass-blur-light:blur(12px) saturate(160%);--yt-glass-blur-heavy:blur(24px) saturate(200%);}
        html[dark],html:not([dark]):not([light]){--yt-bg-primary:rgba(15,15,15,.85);--yt-bg-secondary:rgba(28,28,28,.85);--yt-bg-tertiary:rgba(34,34,34,.85);--yt-text-primary:#fff;--yt-text-secondary:#aaa;--yt-border-color:rgba(255,255,255,.2);--yt-hover-bg:rgba(255,255,255,.1);--yt-shadow:0 4px 12px rgba(0,0,0,.25);--yt-glass-bg:rgba(255,255,255,.1);--yt-glass-border:rgba(255,255,255,.2);--yt-glass-shadow:0 8px 32px rgba(0,0,0,.2);--yt-modal-bg:rgba(0,0,0,.75);--yt-notification-bg:rgba(28,28,28,.9);--yt-panel-bg:rgba(34,34,34,.3);--yt-header-bg:rgba(20,20,20,.6);--yt-input-bg:rgba(255,255,255,.1);--yt-button-bg:rgba(255,255,255,.2);--yt-text-stroke:white;}
        html[light]{--yt-bg-primary:rgba(255,255,255,.85);--yt-bg-secondary:rgba(248,248,248,.85);--yt-bg-tertiary:rgba(240,240,240,.85);--yt-text-primary:#030303;--yt-text-secondary:#606060;--yt-border-color:rgba(0,0,0,.2);--yt-hover-bg:rgba(0,0,0,.05);--yt-shadow:0 4px 12px rgba(0,0,0,.15);--yt-glass-bg:rgba(255,255,255,.7);--yt-glass-border:rgba(0,0,0,.1);--yt-glass-shadow:0 8px 32px rgba(0,0,0,.1);--yt-modal-bg:rgba(0,0,0,.5);--yt-notification-bg:rgba(255,255,255,.95);--yt-panel-bg:rgba(255,255,255,.7);--yt-header-bg:rgba(248,248,248,.8);--yt-input-bg:rgba(0,0,0,.05);--yt-button-bg:rgba(0,0,0,.1);--yt-text-stroke:#030303;}
        .ytp-screenshot-button,.ytp-cobalt-button,.ytp-pip-button{position:relative;bottom:12px;width:44px;transition:opacity .15s,transform .15s;}
        .ytp-screenshot-button:hover,.ytp-cobalt-button:hover,.ytp-pip-button:hover{transform:scale(1.1);}
        .speed-control-btn{width:4em!important;float:left;text-align:center!important;border-radius:var(--yt-radius-sm);font-size:13px;color:var(--yt-text-primary);cursor:pointer;user-select:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;transition:color .2s;}
        .speed-control-btn:hover{color:var(--yt-accent);font-weight:bold;}
        .speed-options{position:absolute!important;background:var(--yt-glass-bg)!important;color:var(--yt-text-primary)!important;border-radius:var(--yt-radius-md)!important;display:none;bottom: 100%!important;width:48px!important;z-index:9999!important;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);overflow:hidden;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);}
        .speed-option-item{cursor:pointer!important;height:25px!important;line-height:25px!important;font-size:12px!important;text-align:center!important;transition:background-color .15s,color .15s;}
        .speed-option-active,.speed-option-item:hover{color:var(--yt-accent)!important;font-weight:bold!important;background:var(--yt-hover-bg)!important;}
        #speed-indicator{position:absolute!important;margin:auto!important;top:0!important;right:0!important;bottom:0!important;left:0!important;border-radius:24px!important;font-size:30px!important;background:var(--yt-glass-bg)!important;color:var(--yt-text-primary)!important;z-index:99999!important;width:80px!important;height:80px!important;line-height:80px!important;text-align:center!important;display:none;box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);border:1px solid var(--yt-glass-border);}
        .youtube-enhancer-notification{position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:var(--yt-glass-bg);color:var(--yt-text-primary);padding:12px 24px;border-radius:var(--yt-radius-md);z-index:9999;transition:opacity .5s,transform .3s;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);font-weight:500;}
        .ytp-plus-settings-button{background:transparent;border:none;color:var(--yt-text-secondary);cursor:pointer;padding:var(--yt-space-sm);margin-right:var(--yt-space-sm);border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background-color .2s,transform .2s;}
        .ytp-plus-settings-button svg{width:24px;height:24px;}
        .ytp-plus-settings-button:hover{background:var(--yt-hover-bg);transform:rotate(30deg);color:var(--yt-text-secondary);}
        .ytp-plus-settings-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);animation:ytEnhanceFadeIn .25s ease-out;}
        .ytp-plus-settings-panel{background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:var(--yt-radius-lg);width:720px;max-width:90%;max-height:90vh;overflow:hidden;box-shadow:var(--yt-glass-shadow);animation:ytEnhanceScaleIn .3s cubic-bezier(.4,0,.2,1);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);border:1px solid var(--yt-glass-border);will-change:transform,opacity;display:flex;flex-direction:row;}
        .ytp-plus-settings-sidebar{width:200px;background:var(--yt-header-bg);border-right:1px solid var(--yt-glass-border);display:flex;flex-direction:column;backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);}
        .ytp-plus-settings-sidebar-header{padding:var(--yt-space-md) var(--yt-space-lg);border-bottom:1px solid var(--yt-glass-border);display:flex;justify-content:space-between;align-items:center;}
        .ytp-plus-settings-title{font-size:18px;font-weight:500;margin:0;color:var(--yt-text-primary);}
        .ytp-plus-settings-sidebar-close{padding:var(--yt-space-md) var(--yt-space-lg);display:flex;justify-content:flex-end;background:transparent;}
        .ytp-plus-settings-close{background:none;border:none;cursor:pointer;padding:var(--yt-space-sm);margin:-8px;color:var(--yt-text-primary);transition:color .2s,transform .2s;}
        .ytp-plus-settings-close:hover{color:var(--yt-accent);transform:scale(1.25) rotate(90deg);}
        .ytp-plus-settings-nav{flex:1;padding:var(--yt-space-md) 0;}
        .ytp-plus-settings-nav-item{display:flex;align-items:center;padding:12px var(--yt-space-lg);cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1);font-size:14px;border-left:3px solid transparent;color:var(--yt-text-primary);}
        .ytp-plus-settings-nav-item:hover{background:var(--yt-hover-bg);}
        .ytp-plus-settings-nav-item.active{background:rgba(255,0,0,.1);border-left-color:var(--yt-accent);color:var(--yt-accent);font-weight:500;}
        .ytp-plus-settings-nav-item svg{width:18px;height:18px;margin-right:12px;opacity:.8;transition:opacity .2s,transform .2s;}
        .ytp-plus-settings-nav-item.active svg{opacity:1;transform:scale(1.1);}
        .ytp-plus-settings-nav-item:hover svg{transform:scale(1.05);}
        .ytp-plus-settings-main{flex:1;display:flex;flex-direction:column;overflow-y:auto;}
        .ytp-plus-settings-header{padding:var(--yt-space-md) var(--yt-space-lg);border-bottom:1px solid var(--yt-glass-border);background:var(--yt-header-bg);backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);}
        .ytp-plus-settings-content{flex:1;padding:var(--yt-space-md) var(--yt-space-lg);overflow-y:auto;}
        .ytp-plus-settings-section{margin-bottom:var(--yt-space-lg);}
        .ytp-plus-settings-section-title{font-size:16px;font-weight:500;margin-bottom:var(--yt-space-md);color:var(--yt-text-primary);}
        .ytp-plus-settings-section.hidden{display:none;}
        .ytp-plus-settings-item{display:flex;align-items:center;margin-bottom:var(--yt-space-md);padding:14px 18px;background:transparent;transition:all .25s cubic-bezier(.4,0,.2,1);border-radius:var(--yt-radius-md);}
        .ytp-plus-settings-item:hover{background:var(--yt-hover-bg);transform:translateX(6px);box-shadow:0 2px 8px rgba(0,0,0,.1);}
        .ytp-plus-settings-item-label{flex:1;font-size:14px;color:var(--yt-text-primary);}
        .ytp-plus-settings-item-description{font-size:12px;color:var(--yt-text-secondary);margin-top:4px;}
        .ytp-plus-settings-checkbox{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:15px;height:15px;margin-left:auto;border:1px solid var(--yt-glass-border);border-radius:50%;background:transparent;display:inline-flex;align-items:center;justify-content:center;transition:all 250ms cubic-bezier(.4,0,.23,1);cursor:pointer;position:relative;flex-shrink:0;color:#fff;}
        html:not([dark]) .ytp-plus-settings-checkbox{border-color:rgba(0,0,0,.25);color:#222;}
        .ytp-plus-settings-checkbox:focus-visible{outline:2px solid var(--yt-accent);outline-offset:2px;}
        .ytp-plus-settings-checkbox:hover{background:var(--yt-hover-bg);transform:scale(1.1);}
        .ytp-plus-settings-checkbox::before{content:"";width:4px;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(45deg);top:4px;left:3px;transition:width 100ms ease 50ms,opacity 50ms;transform-origin:0% 0%;opacity:0;}
        .ytp-plus-settings-checkbox::after{content:"";width:0;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(305deg);top:9px;left:6px;transition:width 100ms ease,opacity 50ms;transform-origin:0% 0%;opacity:0;}
        .ytp-plus-settings-checkbox:checked{transform:rotate(0deg) scale(1.2);}
        .ytp-plus-settings-checkbox:checked::before{width:8px;opacity:1;background:#fff;transition:width 150ms ease 100ms,opacity 150ms ease 100ms;}
        .ytp-plus-settings-checkbox:checked::after{width:15px;opacity:1;background:#fff;transition:width 150ms ease 250ms,opacity 150ms ease 250ms;}
        .ytp-plus-footer{padding:var(--yt-space-md) var(--yt-space-lg);border-top:1px solid var(--yt-glass-border);display:flex;justify-content:flex-end;background:transparent;}
        .ytp-plus-button{padding:var(--yt-space-sm) var(--yt-space-md);border-radius:18px;border:none;font-size:14px;font-weight:500;cursor:pointer;transition:all .25s cubic-bezier(.4,0,.2,1);}
        .ytp-plus-button-primary{background:transparent;border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);}
        .ytp-plus-button-primary:hover{background:var(--yt-accent);color:#fff;box-shadow:0 6px 16px rgba(255,0,0,.35);transform:translateY(-2px);}
        .app-icon{fill:var(--yt-text-primary);stroke:var(--yt-text-primary);transition:all .3s;}
        @keyframes ytEnhanceFadeIn{from{opacity:0;}to{opacity:1;}}
        @keyframes ytEnhanceScaleIn{from{opacity:0;transform:scale(.92) translateY(10px);}to{opacity:1;transform:scale(1) translateY(0);}}
        @media(max-width:768px){.ytp-plus-settings-panel{width:95%;max-height:80vh;flex-direction:column;}
        .ytp-plus-settings-sidebar{width:100%;max-height:120px;flex-direction:row;overflow-x:auto;}
        .ytp-plus-settings-nav{display:flex;flex-direction:row;padding:0;}
        .ytp-plus-settings-nav-item{white-space:nowrap;border-left:none;border-bottom:3px solid transparent;}
        .ytp-plus-settings-nav-item.active{border-left:none;border-bottom-color:var(--yt-accent);}
        .ytp-plus-settings-item{padding:10px 12px;}
        }
        .ytp-plus-settings-section h1{margin:-95px 90px 8px;font-family:'Montserrat',sans-serif;font-size:52px;font-weight:600;color:transparent;-webkit-text-stroke-width:1px;-webkit-text-stroke-color:var(--yt-text-stroke);cursor:pointer;transition:color .2s;}
        .ytp-plus-settings-section h1:hover{color:var(--yt-accent);-webkit-text-stroke-width:1px;-webkit-text-stroke-color:transparent;}
        .download-options{position:fixed;background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:var(--yt-radius-md);width:150px;z-index:99999;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);overflow:hidden;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);display:none;}
        .download-options.visible{display:block;}
        .download-options-list{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;}
        .download-option-item{cursor:pointer;padding:12px;text-align:center;transition:background .2s,color .2s;width:100%;}
        .download-option-item:hover{background:var(--yt-hover-bg);color:var(--yt-accent);}
        .glass-panel{background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);box-shadow:var(--yt-glass-shadow);}
        .glass-card{background:var(--yt-panel-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);padding:var(--yt-space-md);backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);box-shadow:var(--yt-shadow);}
        .glass-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);}
        .glass-button{background:var(--yt-button-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);padding:var(--yt-space-sm) var(--yt-space-md);color:var(--yt-text-primary);cursor:pointer;transition:all .2s ease;backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);}
        .glass-button:hover{background:var(--yt-hover-bg);transform:translateY(-1px);box-shadow:var(--yt-shadow);}
        .download-site-option{display:flex;flex-direction:column;align-items:stretch;gap:8px;}
        .download-site-header{display:flex;flex-direction:row;align-items:center;justify-content:space-between;width:100%;gap:8px;}
        .download-site-controls{width:100%;margin-top:6px;}
        .download-site-cta{display:flex;flex-direction:row;gap:8px;margin-top:6px;}
        .download-site-cta .glass-button{width:100%;}
        .download-site-option .ytp-plus-settings-checkbox{margin:0;}
        .download-site-name{font-weight:600;color:var(--yt-text-primary);}
        .download-site-desc{font-size:12px;color:var(--yt-text-secondary);margin-top:2px;}
        `;

      // ✅ Use StyleManager instead of createElement('style')
      if (!document.getElementById('yt-enhancer-styles')) {
        YouTubeUtils.StyleManager.add('yt-enhancer-main', styles);
      }
    },

    addSettingsButtonToHeader() {
      this.waitForElement('ytd-masthead #end', 5000)
        .then(headerEnd => {
          if (!this.getElement('.ytp-plus-settings-button')) {
            const settingsButton = document.createElement('div');
            settingsButton.className = 'ytp-plus-settings-button';
            settingsButton.setAttribute('title', 'YouTube + Settings');
            settingsButton.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M39.23,26a16.52,16.52,0,0,0,.14-2,16.52,16.52,0,0,0-.14-2l4.33-3.39a1,1,0,0,0,.25-1.31l-4.1-7.11a1,1,0,0,0-1.25-.44l-5.11,2.06a15.68,15.68,0,0,0-3.46-2l-.77-5.43a1,1,0,0,0-1-.86H19.9a1,1,0,0,0-1,.86l-.77,5.43a15.36,15.36,0,0,0-3.46,2L9.54,9.75a1,1,0,0,0-1.25.44L4.19,17.3a1,1,0,0,0,.25,1.31L8.76,22a16.66,16.66,0,0,0-.14,2,16.52,16.52,0,0,0,.14,2L4.44,29.39a1,1,0,0,0-.25,1.31l4.1,7.11a1,1,0,0,0,1.25.44l5.11-2.06a15.68,15.68,0,0,0,3.46,2l.77,5.43a1,1,0,0,0,1,.86h8.2a1,1,0,0,0,1-.86l.77-5.43a15.36,15.36,0,0,0,3.46-2l5.11,2.06a1,1,0,0,0,1.25-.44l4.1-7.11a1,1,0,0,0-.25-1.31ZM24,31.18A7.18,7.18,0,1,1,31.17,24,7.17,7.17,0,0,1,24,31.18Z"/>
                </svg>
              `;

            settingsButton.addEventListener('click', this.openSettingsModal.bind(this));

            const avatarButton = headerEnd.querySelector('ytd-topbar-menu-button-renderer');
            if (avatarButton) {
              headerEnd.insertBefore(settingsButton, avatarButton);
            } else {
              headerEnd.appendChild(settingsButton);
            }
          }
        })
        .catch(() => { });
    },

    createSettingsModal() {
      const modal = document.createElement('div');
      modal.className = 'ytp-plus-settings-modal';

      modal.innerHTML = `
          <div class="ytp-plus-settings-panel">
            <div class="ytp-plus-settings-sidebar">
              <div class="ytp-plus-settings-sidebar-header">
                <h2 class="ytp-plus-settings-title">Settings</h2>                
              </div>
              <div class="ytp-plus-settings-nav">
                <div class="ytp-plus-settings-nav-item active" data-section="basic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-1.414-.586H13l-2-2v3h6l3 3"/>
                  </svg>
                  Basic
                </div>
                <div class="ytp-plus-settings-nav-item" data-section="advanced">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="m12 1 0 6m0 6 0 6"/>
                    <path d="m17.5 6.5-4.5 4.5m0 0-4.5 4.5m9-9L12 12l5.5 5.5"/>
                  </svg>
                  Advanced
                </div>
                <div class="ytp-plus-settings-nav-item" data-section="experimental">
                  <svg width="64px" height="64px" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M18.019 4V15.0386L6.27437 39.3014C5.48686 40.9283 6.16731 42.8855 7.79421 43.673C8.23876 43.8882 8.72624 44 9.22013 44H38.7874C40.5949 44 42.0602 42.5347 42.0602 40.7273C42.0602 40.2348 41.949 39.7488 41.7351 39.3052L30.0282 15.0386V4H18.019Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"></path> <path d="M10.9604 29.9998C13.1241 31.3401 15.2893 32.0103 17.4559 32.0103C19.6226 32.0103 21.7908 31.3401 23.9605 29.9998C26.1088 28.6735 28.2664 28.0103 30.433 28.0103C32.5997 28.0103 34.7755 28.6735 36.9604 29.9998" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path>
                  </svg>
                  Experimental
                </div>
                <div class="ytp-plus-settings-nav-item" data-section="about">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="m9 12 2 2 4-4"/>
                  </svg>
                  About
                </div>
              </div>
            </div>
            <div class="ytp-plus-settings-main">
              <div class="ytp-plus-settings-sidebar-close">
                <button class="ytp-plus-settings-close" aria-label="Close">
                  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                  </svg>
                </button>
              </div>              
              <div class="ytp-plus-settings-content">                
                <div class="ytp-plus-settings-section" data-section="basic">
                  <div class="ytp-plus-settings-item">
                    <div>
                      <label class="ytp-plus-settings-item-label">Speed Control</label>
                      <div class="ytp-plus-settings-item-description">Add speed control buttons to video player</div>
                    </div>
                    <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableSpeedControl" ${this.settings.enableSpeedControl ? 'checked' : ''}>
                  </div>
                  <div class="ytp-plus-settings-item">
                    <div>
                      <label class="ytp-plus-settings-item-label">Screenshot Button</label>
                      <div class="ytp-plus-settings-item-description">Add screenshot capture button to video player</div>
                    </div>
                    <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableScreenshot" ${this.settings.enableScreenshot ? 'checked' : ''}>
                  </div>
                  <div class="ytp-plus-settings-item">
                    <div>
                      <label class="ytp-plus-settings-item-label">Download Button</label>
                      <div class="ytp-plus-settings-item-description">Add download button with multiple site options to video player</div>
                    </div>
                    <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableDownload" ${this.settings.enableDownload ? 'checked' : ''}>
                  </div>
                  <div class="download-submenu" style="display:${this.settings.enableDownload ? 'block' : 'none'};margin-left:12px;margin-bottom:12px;">
                    <div class="glass-card" style="display:flex;flex-direction:column;gap:8px;">
                      <div class="download-site-option">
                        <div class="download-site-header">
                          <div>
                            <div class="download-site-name">${this.settings.downloadSiteCustomization?.y2mate?.name || 'Y2Mate'}</div>
                            <div class="download-site-desc">Use custom downloader</div>
                          </div>
                          <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="downloadSite_y2mate" ${this.settings.downloadSites?.y2mate ? 'checked' : ''}>
                        </div>
                        <div class="download-site-controls" style="display:${this.settings.downloadSites?.y2mate ? 'block' : 'none'};">
                          <input type="text" placeholder="Site name" value="${this.settings.downloadSiteCustomization?.y2mate?.name || 'Y2Mate'}" 
                              data-site="y2mate" data-field="name" class="download-site-input" 
                              style="width:100%;margin-top:6px;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:12px;">
                          <input type="text" placeholder="URL template (use {videoId} or {videoUrl})" value="${this.settings.downloadSiteCustomization?.y2mate?.url || 'https://www.y2mate.com/youtube/{videoId}'}" 
                            data-site="y2mate" data-field="url" class="download-site-input" 
                            style="width:100%;margin-top:4px;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:11px;">
                          <div class="download-site-cta">
                            <button class="glass-button" id="download-y2mate-save" style="padding:6px 10px;font-size:12px;">Save</button>
                            <button class="glass-button" id="download-y2mate-reset" style="padding:6px 10px;font-size:12px;background:rgba(255,0,0,0.12);">Reset</button>
                          </div>
                        </div>
                      </div>

                      <div class="download-site-option">
                        <div class="download-site-header">
                          <div>
                            <div class="download-site-name">${this.settings.downloadSiteCustomization?.xbbuddy?.name || '9xbuddy'}</div>
                            <div class="download-site-desc">Use custom downloader</div>
                          </div>
                          <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="downloadSite_xbbuddy" ${this.settings.downloadSites?.xbbuddy ? 'checked' : ''}>
                        </div>
                        <div class="download-site-controls" style="display:${this.settings.downloadSites?.xbbuddy ? 'block' : 'none'};">
                          <input type="text" placeholder="Site name" value="${this.settings.downloadSiteCustomization?.xbbuddy?.name || '9xbuddy'}" 
                            data-site="xbbuddy" data-field="name" class="download-site-input" 
                            style="width:100%;margin-top:6px;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:12px;">
                          <input type="text" placeholder="URL template (use {videoId} or {videoUrl})" value="${this.settings.downloadSiteCustomization?.xbbuddy?.url || 'https://9xbuddy.org/process?url={videoUrl}'}" 
                            data-site="xbbuddy" data-field="url" class="download-site-input" 
                            style="width:100%;margin-top:4px;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:11px;">
                          <div class="download-site-cta">
                            <button class="glass-button" id="download-xbbuddy-save" style="padding:6px 10px;font-size:12px;">Save</button>
                            <button class="glass-button" id="download-xbbuddy-reset" style="padding:6px 10px;font-size:12px;background:rgba(255,0,0,0.12);">Reset</button>
                          </div>
                        </div>
                      </div>

                      <div class="download-site-option" style="padding:4px 0;">
                        <div>
                          <div class="download-site-name">by YTDL</div>
                          <div class="download-site-desc">Always enabled - GitHub repository</div>
                        </div>
                        <button class="glass-button" id="open-ytdl-github" style="margin:0;padding:10px 14px;font-size:13px;">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15,3 21,3 21,9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div class="ytp-plus-settings-section hidden" data-section="advanced">
                </div>

                <div class="ytp-plus-settings-section hidden" data-section="experimental">
                </div>
                
                <div class="ytp-plus-settings-section hidden" data-section="about">
                  <svg class="app-icon" width="90" height="90" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" version="1.1">
                    <path d="m23.24,4.62c-0.85,0.45 -2.19,2.12 -4.12,5.13c-1.54,2.41 -2.71,4.49 -3.81,6.8c-0.55,1.14 -1.05,2.2 -1.13,2.35c-0.08,0.16 -0.78,0.7 -1.66,1.28c-1.38,0.91 -1.8,1.29 -1.4,1.28c0.08,0 0.67,-0.35 1.31,-0.77c0.64,-0.42 1.19,-0.76 1.2,-0.74c0.02,0.02 -0.1,0.31 -0.25,0.66c-1.03,2.25 -1.84,5.05 -1.84,6.37c0.01,1.89 0.84,2.67 2.86,2.67c1.08,0 1.94,-0.31 3.66,-1.29c1.84,-1.06 3.03,-1.93 4.18,-3.09c1.69,-1.7 2.91,-3.4 3.28,-4.59c0.59,-1.9 -0.1,-3.08 -2.02,-3.44c-0.87,-0.16 -2.85,-0.14 -3.75,0.06c-1.78,0.38 -2.74,0.76 -2.5,1c0.03,0.03 0.5,-0.1 1.05,-0.28c1.49,-0.48 2.34,-0.59 3.88,-0.53c1.64,0.07 2.09,0.19 2.69,0.75l0.46,0.43l0,0.87c0,0.74 -0.05,0.98 -0.35,1.6c-0.69,1.45 -2.69,3.81 -4.37,5.14c-0.93,0.74 -2.88,1.94 -4.07,2.5c-1.64,0.77 -3.56,0.72 -4.21,-0.11c-0.39,-0.5 -0.5,-1.02 -0.44,-2.11c0.05,-0.85 0.16,-1.32 0.67,-2.86c0.34,-1.01 0.86,-2.38 1.15,-3.04c0.52,-1.18 0.55,-1.22 1.6,-2.14c4.19,-3.65 8.42,-9.4 9.02,-12.26c0.2,-0.94 0.13,-1.46 -0.21,-1.7c-0.31,-0.22 -0.38,-0.21 -0.89,0.06m0.19,0.26c-0.92,0.41 -3.15,3.44 -5.59,7.6c-1.05,1.79 -3.12,5.85 -3.02,5.95c0.07,0.07 1.63,-1.33 2.58,-2.34c1.57,-1.65 3.73,-4.39 4.88,-6.17c1.31,-2.03 2.06,-4.11 1.77,-4.89c-0.13,-0.34 -0.16,-0.35 -0.62,-0.15m11.69,13.32c-0.3,0.6 -1.19,2.54 -1.98,4.32c-1.6,3.62 -1.67,3.71 -2.99,4.34c-1.13,0.54 -2.31,0.85 -3.54,0.92c-0.99,0.06 -1.08,0.04 -1.38,-0.19c-0.28,-0.22 -0.31,-0.31 -0.26,-0.7c0.03,-0.25 0.64,-1.63 1.35,-3.08c1.16,-2.36 2.52,-5.61 2.52,-6.01c0,-0.49 -0.36,0.19 -1.17,2.22c-0.51,1.26 -1.37,3.16 -1.93,4.24c-0.55,1.08 -1.04,2.17 -1.09,2.43c-0.1,0.59 0.07,1.03 0.49,1.28c0.78,0.46 3.3,0.06 5.13,-0.81l0.93,-0.45l-0.66,1.25c-0.7,1.33 -3.36,6.07 -4.31,7.67c-2.02,3.41 -3.96,5.32 -6.33,6.21c-2.57,0.96 -4.92,0.74 -6.14,-0.58c-0.81,-0.88 -0.82,-1.71 -0.04,-3.22c1.22,-2.36 6.52,-6.15 10.48,-7.49c0.52,-0.18 0.95,-0.39 0.95,-0.46c0,-0.21 -0.19,-0.18 -1.24,0.2c-1.19,0.43 -3.12,1.37 -4.34,2.11c-2.61,1.59 -5.44,4.09 -6.13,5.43c-1.15,2.2 -0.73,3.61 1.4,4.6c0.59,0.28 0.75,0.3 2.04,0.3c1.67,0 2.42,-0.18 3.88,-0.89c1.87,-0.92 3.17,-2.13 4.72,-4.41c0.98,-1.44 4.66,-7.88 5.91,-10.33c0.25,-0.49 0.68,-1.19 0.96,-1.56c0.28,-0.37 0.76,-1.15 1.06,-1.73c0.82,-1.59 2.58,-6.1 2.58,-6.6c0,-0.06 -0.07,-0.1 -0.17,-0.1c-0.1,0 -0.39,0.44 -0.71,1.09m-1.34,3.7c-0.93,2.08 -1.09,2.48 -0.87,2.2c0.19,-0.24 1.66,-3.65 1.6,-3.71c-0.02,-0.02 -0.35,0.66 -0.73,1.51" fill="none" fill-rule="evenodd" stroke="currentColor" />
                  </svg>
                    <h1>YouTube +</h1><br><br>
                </div>
              </div>
              <div class="ytp-plus-footer">
                <button class="ytp-plus-button ytp-plus-button-primary" id="ytp-plus-save-settings">Save Changes</button>
              </div>
            </div>
          </div>
        `;

      // Event delegation for better performance
      modal.addEventListener('click', e => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target === modal) modal.remove();
        if (
          target.classList.contains('ytp-plus-settings-close') ||
          target.closest('.ytp-plus-settings-close')
        ) {
          modal.remove();
        }

        // Обработка кнопки GitHub для YTDL
        if (target.id === 'open-ytdl-github' || target.closest('#open-ytdl-github')) {
          window.open('https://github.com/diorhc/YouTube-Downloader', '_blank');
          return;
        }

        if (target.classList.contains('ytp-plus-settings-nav-item')) {
          // Handle sidebar navigation
          const section = /** @type {HTMLElement} */ (target).dataset.section;
          modal
            .querySelectorAll('.ytp-plus-settings-nav-item')
            .forEach(item => item.classList.remove('active'));
          modal
            .querySelectorAll('.ytp-plus-settings-section')
            .forEach(section => section.classList.add('hidden'));

          target.classList.add('active');
          modal
            .querySelector(`.ytp-plus-settings-section[data-section="${section}"]`)
            .classList.remove('hidden');
        }

        if (target.classList.contains('ytp-plus-settings-checkbox')) {
          const setting = /** @type {HTMLElement} */ (target).dataset.setting;
          if (!setting) return;

          // Сохранение простых настроек (enableSpeedControl, enableScreenshot, enableDownload)
          if (!setting.startsWith('downloadSite_')) {
            this.settings[setting] = /** @type {HTMLInputElement} */ (target).checked;

            // Показывать/скрывать сабменю при переключении Download
            if (setting === 'enableDownload') {
              const submenu = modal.querySelector('.download-submenu');
              if (submenu) {
                submenu.style.display = /** @type {HTMLInputElement} */ (target).checked
                  ? 'block'
                  : 'none';
              }
            }
          } else {
            // Обработка чекбоксов в сабменю: data-setting = downloadSite_<key>
            const key = setting.replace('downloadSite_', '');
            if (!this.settings.downloadSites) {
              this.settings.downloadSites = { y2mate: true, xbbuddy: true };
            }
            const checkbox = /** @type {HTMLElement} */ (target);
            this.settings.downloadSites[key] = /** @type {HTMLInputElement} */ (checkbox).checked;
            // Toggle visibility of controls for this site (if present in DOM)
            try {
              const container = checkbox.closest('.download-site-option');
              if (container) {
                const controls = container.querySelector('.download-site-controls');
                if (controls) {
                  controls.style.display = /** @type {HTMLInputElement} */ (checkbox).checked
                    ? 'block'
                    : 'none';
                }
              }
            } catch (err) {
              console.warn('[YouTube+] toggle download-site-controls failed:', err);
            }
            // Rebuild dropdown if present
            try {
              if (
                typeof window !== 'undefined' &&
                /** @type {any} */ (window).youtubePlus &&
                typeof (/** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown) ===
                'function'
              ) {
                /** @type {any} */ (window).youtubePlus.settings =
                  /** @type {any} */ (window).youtubePlus.settings || this.settings;
                /** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown();
              }
            } catch (err) {
              console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
            }
          }
        }

        // Обработка кастомизации download сайтов
        if (target.classList.contains('download-site-input')) {
          const site = /** @type {HTMLElement} */ (target).dataset.site;
          const field = /** @type {HTMLElement} */ (target).dataset.field;
          if (!site || !field) return;

          if (!this.settings.downloadSiteCustomization) {
            this.settings.downloadSiteCustomization = {
              y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
              xbbuddy: { name: '9xbuddy', url: 'https://9xbuddy.org/process?url={videoUrl}' },
            };
          }
          if (!this.settings.downloadSiteCustomization[site]) {
            this.settings.downloadSiteCustomization[site] = { name: '', url: '' };
          }

          this.settings.downloadSiteCustomization[site][field] = /** @type {HTMLInputElement} */ (
            target
          ).value;

          // Обновить имя в UI в реальном времени
          if (field === 'name') {
            const nameDisplay = target
              .closest('.download-site-option')
              ?.querySelector('.download-site-name');
            if (nameDisplay) {
              nameDisplay.textContent =
                /** @type {HTMLInputElement} */ (target).value ||
                (site === 'y2mate' ? 'Y2Mate' : '9xbuddy');
            }
          }
          // Rebuild dropdown if present so changes reflect immediately
          try {
            if (
              typeof window !== 'undefined' &&
              /** @type {any} */ (window).youtubePlus &&
              typeof (/** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown) ===
              'function'
            ) {
              /** @type {any} */ (window).youtubePlus.settings =
                /** @type {any} */ (window).youtubePlus.settings || this.settings;
              /** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
        }

        if (target.id === 'ytp-plus-save-settings') {
          this.saveSettings();
          modal.remove();
          this.showNotification('Settings saved');
        }
        // Save specific Y2Mate customization
        if (target.id === 'download-y2mate-save') {
          // Ensure settings structure
          if (!this.settings.downloadSiteCustomization) {
            this.settings.downloadSiteCustomization = {
              y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
              xbbuddy: { name: '9xbuddy', url: 'https://9xbuddy.org/process?url={videoUrl}' },
            };
          }
          if (!this.settings.downloadSiteCustomization.y2mate) {
            this.settings.downloadSiteCustomization.y2mate = { name: '', url: '' };
          }
          // Read current inputs inside this download-site-option
          const container = /** @type {HTMLElement|null} */ (
            /** @type {unknown} */ (target.closest('.download-site-option'))
          );
          if (container) {
            const nameInput = container.querySelector(
              'input.download-site-input[data-site="y2mate"][data-field="name"]'
            );
            const urlInput = container.querySelector(
              'input.download-site-input[data-site="y2mate"][data-field="url"]'
            );
            if (nameInput) this.settings.downloadSiteCustomization.y2mate.name = nameInput.value;
            if (urlInput) this.settings.downloadSiteCustomization.y2mate.url = urlInput.value;
          }
          this.saveSettings();
          try {
            if (
              typeof window !== 'undefined' &&
              /** @type {any} */ (window).youtubePlus &&
              typeof (/** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown) ===
              'function'
            ) {
              /** @type {any} */ (window).youtubePlus.settings =
                /** @type {any} */ (window).youtubePlus.settings || this.settings;
              /** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
          this.showNotification('Y2Mate settings saved');
        }

        // Reset Y2Mate to defaults
        if (target.id === 'download-y2mate-reset') {
          if (!this.settings.downloadSiteCustomization) {
            // Initialize with expected structure to satisfy type checks
            this.settings.downloadSiteCustomization = {
              y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
              xbbuddy: { name: '9xbuddy', url: 'https://9xbuddy.org/process?url={videoUrl}' },
            };
          }
          this.settings.downloadSiteCustomization.y2mate = {
            name: 'Y2Mate',
            url: 'https://www.y2mate.com/youtube/{videoId}',
          };
          // Update inputs in modal if present
          const container = /** @type {HTMLElement|null} */ (
            /** @type {unknown} */ (modal.querySelector('.download-site-option'))
          );
          if (container) {
            const nameInput = container.querySelector(
              'input.download-site-input[data-site="y2mate"][data-field="name"]'
            );
            const urlInput = container.querySelector(
              'input.download-site-input[data-site="y2mate"][data-field="url"]'
            );
            const nameDisplay = container.querySelector('.download-site-name');
            if (nameInput) nameInput.value = this.settings.downloadSiteCustomization.y2mate.name;
            if (urlInput) urlInput.value = this.settings.downloadSiteCustomization.y2mate.url;
            if (nameDisplay) {
              nameDisplay.textContent = this.settings.downloadSiteCustomization.y2mate.name;
            }
          }
          this.saveSettings();
          try {
            if (
              typeof window !== 'undefined' &&
              /** @type {any} */ (window).youtubePlus &&
              typeof (/** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown) ===
              'function'
            ) {
              /** @type {any} */ (window).youtubePlus.settings =
                /** @type {any} */ (window).youtubePlus.settings || this.settings;
              /** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
          this.showNotification('Y2Mate reset to defaults');
        }

        // Save specific 9xBuddy customization
        if (target.id === 'download-xbbuddy-save') {
          if (!this.settings.downloadSiteCustomization) {
            // Initialize expected structure
            this.settings.downloadSiteCustomization = {
              y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
              xbbuddy: { name: '9xbuddy', url: 'https://9xbuddy.org/process?url={videoUrl}' },
            };
          }
          if (!this.settings.downloadSiteCustomization.xbbuddy) {
            this.settings.downloadSiteCustomization.xbbuddy = { name: '', url: '' };
          }
          const container = /** @type {HTMLElement|null} */ (
            /** @type {unknown} */ (target.closest('.download-site-option'))
          );
          if (container) {
            const nameInput = container.querySelector(
              'input.download-site-input[data-site="xbbuddy"][data-field="name"]'
            );
            const urlInput = container.querySelector(
              'input.download-site-input[data-site="xbbuddy"][data-field="url"]'
            );
            if (nameInput) this.settings.downloadSiteCustomization.xbbuddy.name = nameInput.value;
            if (urlInput) this.settings.downloadSiteCustomization.xbbuddy.url = urlInput.value;
          }
          this.saveSettings();
          try {
            if (
              typeof window !== 'undefined' &&
              /** @type {any} */ (window).youtubePlus &&
              typeof (/** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown) ===
              'function'
            ) {
              /** @type {any} */ (window).youtubePlus.settings =
                /** @type {any} */ (window).youtubePlus.settings || this.settings;
              /** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
          this.showNotification('9xBuddy settings saved');
        }

        // Reset 9xBuddy to defaults
        if (target.id === 'download-xbbuddy-reset') {
          if (!this.settings.downloadSiteCustomization) {
            this.settings.downloadSiteCustomization = {
              y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
              xbbuddy: { name: '9xbuddy', url: 'https://9xbuddy.org/process?url={videoUrl}' },
            };
          }
          this.settings.downloadSiteCustomization.xbbuddy = {
            name: '9xbuddy',
            url: 'https://9xbuddy.org/process?url={videoUrl}',
          };
          // Update inputs in modal if present
          const container = /** @type {HTMLElement|null} */ (
            /** @type {unknown} */ (modal.querySelectorAll('.download-site-option')[1])
          );
          if (container) {
            const nameInput = container.querySelector(
              'input.download-site-input[data-site="xbbuddy"][data-field="name"]'
            );
            const urlInput = container.querySelector(
              'input.download-site-input[data-site="xbbuddy"][data-field="url"]'
            );
            const nameDisplay = container.querySelector('.download-site-name');
            if (nameInput) nameInput.value = this.settings.downloadSiteCustomization.xbbuddy.name;
            if (urlInput) urlInput.value = this.settings.downloadSiteCustomization.xbbuddy.url;
            if (nameDisplay) {
              nameDisplay.textContent = this.settings.downloadSiteCustomization.xbbuddy.name;
            }
          }
          this.saveSettings();
          try {
            if (
              typeof window !== 'undefined' &&
              /** @type {any} */ (window).youtubePlus &&
              typeof (/** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown) ===
              'function'
            ) {
              /** @type {any} */ (window).youtubePlus.settings =
                /** @type {any} */ (window).youtubePlus.settings || this.settings;
              /** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
          this.showNotification('9xBuddy reset to defaults');
        }
      });

      // Обработка изменений input полей для кастомизации
      modal.addEventListener('input', e => {
        const target = /** @type {EventTarget & HTMLElement} */ (e.target);
        if (target.classList.contains('download-site-input')) {
          const site = /** @type {HTMLElement} */ (target).dataset.site;
          const field = /** @type {HTMLElement} */ (target).dataset.field;
          if (!site || !field) return;

          if (!this.settings.downloadSiteCustomization) {
            this.settings.downloadSiteCustomization = {
              y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
              xbbuddy: { name: '9xbuddy', url: 'https://9xbuddy.org/process?url={videoUrl}' },
            };
          }
          if (!this.settings.downloadSiteCustomization[site]) {
            this.settings.downloadSiteCustomization[site] = { name: '', url: '' };
          }

          this.settings.downloadSiteCustomization[site][field] = /** @type {HTMLInputElement} */ (
            target
          ).value;

          // Обновить имя в UI в реальном времени
          if (field === 'name') {
            const nameDisplay = /** @type {HTMLElement|null} */ (
              /** @type {unknown} */ (target.closest('.download-site-option'))
            )?.querySelector('.download-site-name');
            if (nameDisplay) {
              nameDisplay.textContent =
                /** @type {HTMLInputElement} */ (target).value ||
                (site === 'y2mate' ? 'Y2Mate' : '9xbuddy');
            }
          }
          // Rebuild dropdown if present so changes reflect immediately
          try {
            if (
              typeof window !== 'undefined' &&
              /** @type {any} */ (window).youtubePlus &&
              typeof (/** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown) ===
              'function'
            ) {
              /** @type {any} */ (window).youtubePlus.settings =
                /** @type {any} */ (window).youtubePlus.settings || this.settings;
              /** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
        }
      });

      return modal;
    },

    openSettingsModal() {
      const existingModal = this.getElement('.ytp-plus-settings-modal', false);
      if (existingModal) existingModal.remove();
      document.body.appendChild(this.createSettingsModal());
    },

    waitForElement(selector, timeout = 5000) {
      // ✅ Use centralized utility
      return YouTubeUtils.waitForElement(selector, timeout);
    },

    addCustomButtons() {
      const controls = this.getElement('.ytp-right-controls');
      if (!controls) return;

      if (!this.getElement('.ytp-screenshot-button')) this.addScreenshotButton(controls);
      if (!this.getElement('.ytp-download-button')) this.addDownloadButton(controls);
      if (!this.getElement('.speed-control-btn')) this.addSpeedControlButton(controls);

      if (!document.getElementById('speed-indicator')) {
        const indicator = document.createElement('div');
        indicator.id = 'speed-indicator';
        const player = document.getElementById('movie_player');
        if (player) player.appendChild(indicator);
      }

      this.handleFullscreenChange();
    },

    addScreenshotButton(controls) {
      const button = document.createElement('button');
      button.className = 'ytp-button ytp-screenshot-button';
      button.setAttribute('title', 'Take screenshot');
      button.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19.83,8.77l-2.77,2.84H6.29A1.79,1.79,0,0,0,4.5,13.4V36.62a1.8,1.8,0,0,0,1.79,1.8H41.71a1.8,1.8,0,0,0,1.79-1.8V13.4a1.79,1.79,0,0,0-1.79-1.79H30.94L28.17,8.77Zm18.93,5.74a1.84,1.84,0,1,1,0,3.68A1.84,1.84,0,0,1,38.76,14.51ZM24,17.71a8.51,8.51,0,1,1-8.51,8.51A8.51,8.51,0,0,1,24,17.71Z"/>
          </svg>
        `;
      button.addEventListener('click', this.captureFrame.bind(this));
      controls.insertBefore(button, controls.firstChild);
    },

    addDownloadButton(controls) {
      if (!this.settings.enableDownload) return;
      const button = document.createElement('div');
      button.className = 'ytp-button ytp-download-button';
      button.setAttribute('title', 'Download options');
      button.setAttribute('tabindex', '0');
      button.setAttribute('role', 'button');
      button.setAttribute('aria-haspopup', 'true');
      button.setAttribute('aria-expanded', 'false');
      button.style.display = 'inline-block';
      button.style.padding = '0 10px 0 0';
      button.style.height = '36px';
      button.innerHTML = `
          <svg fill="currentColor" width="24" height="24" viewBox="0 0 256 256" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;vertical-align:middle;">
        <path d="M83.17188,112.83984a4.00026,4.00026,0,0,1,5.65624-5.6582L124,142.34473V40a4,4,0,0,1,8,0V142.34473l35.17188-35.16309a4.00026,4.00026,0,0,1,5.65624,5.6582l-42,41.98926a4.00088,4.00088,0,0,1-5.65624,0ZM216,148a4.0002,4.0002,0,0,0-4,4v56a4.00427,4.00427,0,0,1-4,4H48a4.00427,4.00427,0,0,1-4-4V152a4,4,0,0,0-8,0v56a12.01343,12.01343,0,0,0,12,12H208a12.01343,12.01343,0,0,0,12-12V152A4.0002,4.0002,0,0,0,216,148Z"/>
          </svg>
        `;

      // Dropdown options
      const options = document.createElement('div');
      options.className = 'download-options';
      options.setAttribute('role', 'menu');

      // Position dropdown below button
      function positionDropdown() {
        const rect = button.getBoundingClientRect();
        options.style.left = `${rect.left + rect.width / 2 - 75}px`;
        options.style.bottom = `${window.innerHeight - rect.top + 12}px`;
      }

      // Helper to open download site
      function openDownloadSite(url, isYTDL = false) {
        if (isYTDL) {
          // For YTDL: copy video URL to clipboard and open localhost
          const videoId = new URLSearchParams(location.search).get('v');
          const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

          // Copy to clipboard
          navigator.clipboard
            .writeText(videoUrl)
            .then(() => {
              // Show notification
              YouTubeUtils.NotificationManager.show('URL скопирован в буфер обмена!', {
                duration: 2000,
                type: 'success',
              });
            })
            .catch(() => {
              // Fallback for older browsers
              const input = document.createElement('input');
              input.value = videoUrl;
              document.body.appendChild(input);
              input.select();
              document.execCommand('copy');
              document.body.removeChild(input);
              YouTubeUtils.NotificationManager.show('URL скопирован в буфер обмена!', {
                duration: 2000,
                type: 'success',
              });
            });

          // Open YTDL in new tab
          window.open(url, '_blank');
        } else {
          window.open(url, '_blank');
        }
        options.classList.remove('visible');
        button.setAttribute('aria-expanded', 'false');
      }

      // Helper to rebuild the dropdown if settings changed while dropdown exists
      // Exposed on button element via dataset so external handlers can trigger a rebuild
      function rebuildDropdown() {
        try {
          // Remove existing list if present
          const existingList = options.querySelector('.download-options-list');
          if (existingList) existingList.remove();

          // Rebuild downloadSites from current settings
          const customizationNow =
            typeof window !== 'undefined' &&
            /** @type {any} */ (window).youtubePlus &&
            /** @type {any} */ (window).youtubePlus.settings &&
            /** @type {any} */ (window).youtubePlus.settings.downloadSiteCustomization
              ? /** @type {any} */ (window).youtubePlus.settings.downloadSiteCustomization
              : customization;
          const videoIdNow = new URLSearchParams(location.search).get('v');
          const videoUrlNow = videoIdNow
            ? `https://www.youtube.com/watch?v=${videoIdNow}`
            : location.href;
          const buildUrlNow = template =>
            (template || '')
              .replace('{videoId}', videoIdNow || '')
              .replace('{videoUrl}', encodeURIComponent(videoUrlNow));

          const baseSitesNow = [
            {
              key: 'y2mate',
              name: customizationNow?.y2mate?.name || 'Y2Mate',
              url: buildUrlNow(
                customizationNow?.y2mate?.url || `https://www.y2mate.com/youtube/{videoId}`
              ),
              isYTDL: false,
            },
            {
              key: 'xbbuddy',
              name: customizationNow?.xbbuddy?.name || '9xbuddy',
              url: buildUrlNow(
                customizationNow?.xbbuddy?.url || `https://9xbuddy.org/process?url={videoUrl}`
              ),
              isYTDL: false,
            },
            { key: 'ytdl', name: 'by YTDL', url: `http://localhost:5005`, isYTDL: true },
          ];

          const enabledSitesNow =
            typeof window !== 'undefined' &&
            /** @type {any} */ (window).youtubePlus &&
            /** @type {any} */ (window).youtubePlus.settings &&
            /** @type {any} */ (window).youtubePlus.settings.downloadSites
              ? /** @type {any} */ (window).youtubePlus.settings.downloadSites
              : enabledSites;

          const downloadSitesNow = baseSitesNow.filter(s => {
            if (s.key === 'ytdl') return true;
            return enabledSitesNow[s.key] !== false;
          });

          // If only one site remains replace click handler
          if (downloadSitesNow.length === 1) {
            const single = downloadSitesNow[0];
            // Remove any existing clickable handlers on button
            button.replaceWith(button.cloneNode(true));
            const newButton = controls.querySelector('.ytp-download-button');
            if (newButton) {
              newButton.addEventListener('click', () =>
                openDownloadSite(single.url, single.isYTDL)
              );
            }
            return;
          }

          // Build new list
          const newList = document.createElement('div');
          newList.className = 'download-options-list';
          downloadSitesNow.forEach(site => {
            const opt = document.createElement('div');
            opt.className = 'download-option-item';
            opt.textContent = site.name;
            opt.setAttribute('role', 'menuitem');
            opt.setAttribute('tabindex', '0');
            opt.addEventListener('click', () => openDownloadSite(site.url, site.isYTDL));
            opt.addEventListener('keydown', e => {
              if (e.key === 'Enter' || e.key === ' ') openDownloadSite(site.url, site.isYTDL);
            });
            newList.appendChild(opt);
          });
          options.appendChild(newList);
        } catch (err) {
          console.warn('[YouTube+] rebuildDropdown failed:', err);
        }
      }

      // Get current video URL
      const videoId = new URLSearchParams(location.search).get('v');
      const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

      // Получить кастомные настройки или использовать defaults
      const customization = this.settings.downloadSiteCustomization || {
        y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
        xbbuddy: { name: '9xbuddy', url: 'https://9xbuddy.org/process?url={videoUrl}' },
      };

      // Функция для замены плейсхолдеров в URL
      const buildUrl = template => {
        return template
          .replace('{videoId}', videoId || '')
          .replace('{videoUrl}', encodeURIComponent(videoUrl));
      };

      // List of download sites (ytdl всегда включён, filter by user settings.downloadSites для остальных)
      const baseSites = [
        {
          key: 'y2mate',
          name: customization.y2mate?.name || 'Y2Mate',
          url: buildUrl(customization.y2mate?.url || `https://www.y2mate.com/youtube/{videoId}`),
          isYTDL: false,
        },
        {
          key: 'xbbuddy',
          name: customization.xbbuddy?.name || '9xbuddy',
          url: buildUrl(customization.xbbuddy?.url || `https://9xbuddy.org/process?url={videoUrl}`),
          isYTDL: false,
        },
        { key: 'ytdl', name: 'by YTDL', url: `http://localhost:5005`, isYTDL: true },
      ];

      const enabledSites =
        this.settings && this.settings.downloadSites
          ? this.settings.downloadSites
          : { y2mate: true, xbbuddy: true };

      // YTDL всегда включён, фильтруем остальные по настройкам
      const downloadSites = baseSites.filter(s => {
        if (s.key === 'ytdl') return true; // ytdl всегда включён
        return enabledSites[s.key] !== false;
      });

      // Если активен только один сайт — прямой переход без dropdown
      if (downloadSites.length === 1) {
        const singleSite = downloadSites[0];
        button.style.cursor = 'pointer';
        button.addEventListener('click', () => openDownloadSite(singleSite.url, singleSite.isYTDL));
        controls.insertBefore(button, controls.firstChild);
        return; // Не создаём dropdown
      }

      // Centered list
      const list = document.createElement('div');
      list.className = 'download-options-list';

      downloadSites.forEach(site => {
        const opt = document.createElement('div');
        opt.className = 'download-option-item';
        opt.textContent = site.name;
        opt.setAttribute('role', 'menuitem');
        opt.setAttribute('tabindex', '0');
        opt.addEventListener('click', () => openDownloadSite(site.url, site.isYTDL));
        opt.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            openDownloadSite(site.url, site.isYTDL);
          }
        });
        list.appendChild(opt);
      });

      options.appendChild(list);

      button.appendChild(options);

      // Expose rebuild function globally (safe guard) so settings handlers can call it
      try {
        if (typeof window !== 'undefined') {
          /** @type {any} */ (window).youtubePlus = /** @type {any} */ (window).youtubePlus || {};
          /** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown = rebuildDropdown;
          // also store settings ref for rebuildDropdown to read
          /** @type {any} */ (window).youtubePlus.settings =
            /** @type {any} */ (window).youtubePlus.settings || this.settings;
        }
      } catch (e) {
        console.warn('[YouTube+] expose rebuildDownloadDropdown failed:', e);
      }

      let dropdownTimeout;
      function showDropdown() {
        clearTimeout(dropdownTimeout);
        positionDropdown();
        options.classList.add('visible');
        button.setAttribute('aria-expanded', 'true');
      }
      function hideDropdown() {
        dropdownTimeout = setTimeout(() => {
          options.classList.remove('visible');
          button.setAttribute('aria-expanded', 'false');
        }, 150);
      }
      button.addEventListener('mouseenter', showDropdown);
      button.addEventListener('mouseleave', hideDropdown);
      options.addEventListener('mouseenter', showDropdown);
      options.addEventListener('mouseleave', hideDropdown);
      button.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (options.classList.contains('visible')) {
            hideDropdown();
          } else {
            showDropdown();
          }
        }
      });

      controls.insertBefore(button, controls.firstChild);
    },

    addSpeedControlButton(controls) {
      const speedBtn = document.createElement('div');
      speedBtn.className = 'ytp-button speed-control-btn';
      speedBtn.innerHTML = `<span>${this.speedControl.currentSpeed}×</span>`;

      const speedOptions = document.createElement('div');
      speedOptions.className = 'speed-options';

      [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0].forEach(speed => {
        const option = document.createElement('div');
        option.className = `speed-option-item${Number(speed) === this.speedControl.currentSpeed ? ' speed-option-active' : ''}`;
        option.textContent = `${speed}x`;
        option.dataset.speed = String(speed);
        option.addEventListener('click', () => this.changeSpeed(speed));
        speedOptions.appendChild(option);
      });

      speedBtn.appendChild(speedOptions);

      let isHovering = false;
      speedBtn.addEventListener('mouseenter', () => {
        isHovering = true;
        speedOptions.style.display = 'block';
      });

      speedBtn.addEventListener('mouseleave', () => {
        isHovering = false;
        setTimeout(() => {
          if (!isHovering) speedOptions.style.display = 'none';
        }, 150);
      });

      controls.insertBefore(speedBtn, controls.firstChild);
    },

    captureFrame() {
      const video = this.getElement('video', false);
      if (!video) return;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const videoTitle = document.title.replace(/\s-\sYouTube$/, '').trim();
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${videoTitle}.png`;
      link.click();
    },

    showNotification(message, duration = 2000) {
      YouTubeUtils.NotificationManager.show(message, { duration, type: 'info' });
    },

    handleFullscreenChange() {
      const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
      document.querySelectorAll('.ytp-screenshot-button, .ytp-cobalt-button').forEach(button => {
        button.style.bottom = isFullscreen ? '15px' : '12px';
      });
    },

    changeSpeed(speed) {
      speed = Number(speed);
      this.speedControl.currentSpeed = speed;
      localStorage.setItem(this.speedControl.storageKey, String(speed));

      const speedBtn = this.getElement('.speed-control-btn span', false);
      if (speedBtn) speedBtn.textContent = `${speed}×`;

      document.querySelectorAll('.speed-option-item').forEach(option => {
        option.classList.toggle('speed-option-active', parseFloat(option.dataset.speed) === speed);
      });

      this.applyCurrentSpeed();
      this.showSpeedIndicator(speed);
    },

    applyCurrentSpeed() {
      document.querySelectorAll('video').forEach(video => {
        if (video && video.playbackRate !== this.speedControl.currentSpeed) {
          video.playbackRate = this.speedControl.currentSpeed;
        }
      });
    },

    setupVideoObserver() {
      if (this._speedInterval) clearInterval(this._speedInterval);
      this._speedInterval = setInterval(() => this.applyCurrentSpeed(), 1000);

      // ✅ Register interval in cleanupManager
      YouTubeUtils.cleanupManager.registerInterval(this._speedInterval);
    },

    setupNavigationObserver() {
      let lastUrl = location.href;

      document.addEventListener('fullscreenchange', this.handleFullscreenChange.bind(this));

      document.addEventListener('yt-navigate-finish', () => {
        if (location.href.includes('watch?v=')) this.setupCurrentPage();
        this.addSettingsButtonToHeader();
      });

      // ✅ Register observer in cleanupManager
      const observer = new MutationObserver(() => {
        if (lastUrl !== location.href) {
          lastUrl = location.href;
          if (location.href.includes('watch?v=')) {
            setTimeout(() => this.setupCurrentPage(), 500);
          }
          this.addSettingsButtonToHeader();
        }
      });

      YouTubeUtils.cleanupManager.registerObserver(observer);

      // ✅ Safe observe with document.body check
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          observer.observe(document.body, { childList: true, subtree: true });
        });
      }
    },

    showSpeedIndicator(speed) {
      const indicator = document.getElementById('speed-indicator');
      if (!indicator) return;

      if (this.speedControl.activeAnimationId) {
        cancelAnimationFrame(this.speedControl.activeAnimationId);
        YouTubeUtils.cleanupManager.unregisterAnimationFrame(this.speedControl.activeAnimationId);
        this.speedControl.activeAnimationId = null;
      }

      indicator.textContent = `${speed}×`;
      indicator.style.display = 'block';
      indicator.style.opacity = '0.8';

      const startTime = performance.now();
      const fadeOut = timestamp => {
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / 1500, 1);

        indicator.style.opacity = String(0.8 * (1 - progress));

        if (progress < 1) {
          this.speedControl.activeAnimationId = YouTubeUtils.cleanupManager.registerAnimationFrame(
            requestAnimationFrame(fadeOut)
          );
        } else {
          indicator.style.display = 'none';
          this.speedControl.activeAnimationId = null;
        }
      };

      this.speedControl.activeAnimationId = YouTubeUtils.cleanupManager.registerAnimationFrame(
        requestAnimationFrame(fadeOut)
      );
    },
  };

  // Save reference to init function BEFORE IIFE closes (critical for DOMContentLoaded)
  const initFunction = YouTubeEnhancer.init.bind(YouTubeEnhancer);

  // Initialize immediately or on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFunction);
  } else {
    initFunction();
  }
})();

// --- MODULE: enhanced.js ---

// Enhanced Tabviews
(function () {
  'use strict';

  /**
   * Configuration object for scroll-to-top button
   * @type {Object}
   * @property {boolean} enabled - Whether the feature is enabled
   * @property {string} storageKey - LocalStorage key for settings
   */
  const config = {
    enabled: true,
    storageKey: 'youtube_top_button_settings',
  };

  /**
   * Adds CSS styles for scroll-to-top button and scrollbars
   * @returns {void}
   */
  const addStyles = () => {
    if (document.getElementById('custom-styles')) return;

    const style = document.createElement('style');
    style.id = 'custom-styles';
    style.textContent = `
      :root{--scrollbar-width:8px;--scrollbar-track:transparent;--scrollbar-thumb:rgba(144,144,144,.5);--scrollbar-thumb-hover:rgba(170,170,170,.7);--scrollbar-thumb-active:rgba(190,190,190,.9);}
      ::-webkit-scrollbar{width:var(--scrollbar-width)!important;height:var(--scrollbar-width)!important;}
      ::-webkit-scrollbar-track{background:var(--scrollbar-track)!important;border-radius:4px!important;}
      ::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb)!important;border-radius:4px!important;transition:background .2s!important;}
      ::-webkit-scrollbar-thumb:hover{background:var(--scrollbar-thumb-hover)!important;}
      ::-webkit-scrollbar-thumb:active{background:var(--scrollbar-thumb-active)!important;}
      ::-webkit-scrollbar-corner{background:transparent!important;}
      *{scrollbar-width:thin;scrollbar-color:var(--scrollbar-thumb) var(--scrollbar-track);}
      html[dark]{--scrollbar-thumb:rgba(144,144,144,.4);--scrollbar-thumb-hover:rgba(170,170,170,.6);--scrollbar-thumb-active:rgba(190,190,190,.8);}
      .top-button{position:absolute;bottom:16px;right:16px;width:40px;height:40px;background:var(--yt-top-btn-bg,rgba(0,0,0,.7));color:var(--yt-top-btn-color,#fff);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1000;opacity:0;visibility:hidden;transition:all .3s;backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);border:1px solid var(--yt-top-btn-border,rgba(255,255,255,.1));background:rgba(255,255,255,.12);box-shadow:0 8px 32px 0 rgba(31,38,135,.18);}
      .top-button:hover{background:var(--yt-top-btn-hover,rgba(0,0,0,.15));transform:translateY(-2px) scale(1.07);box-shadow:0 8px 32px rgba(0,0,0,.25);}
      .top-button.visible{opacity:1;visibility:visible;}
      .top-button svg{transition:transform .2s;}
      .top-button:hover svg{transform:translateY(-1px) scale(1.1);}
      html[dark]{--yt-top-btn-bg:rgba(255,255,255,.10);--yt-top-btn-color:#fff;--yt-top-btn-border:rgba(255,255,255,.18);--yt-top-btn-hover:rgba(255,255,255,.18);}
      html:not([dark]){--yt-top-btn-bg:rgba(255,255,255,.12);--yt-top-btn-color:#222;--yt-top-btn-border:rgba(0,0,0,.08);--yt-top-btn-hover:rgba(255,255,255,.18);}
      ytd-watch-flexy:not([tyt-tab^="#"]) .top-button{display:none;}
        `;
    document.head.appendChild(style);
  };

  /**
   * Updates button visibility based on scroll position
   * @param {HTMLElement} scrollContainer - The container being scrolled
   * @returns {void}
   */
  const handleScroll = scrollContainer => {
    const button = document.getElementById('right-tabs-top-button');
    if (!button || !scrollContainer) return;
    button.classList.toggle('visible', scrollContainer.scrollTop > 100);
  };

  /**
   * Sets up scroll event listener on active tab
   * @returns {void}
   */
  const setupScrollListener = () => {
    document.querySelectorAll('.tab-content-cld').forEach(tab => {
      tab.removeEventListener('scroll', tab._topButtonScrollHandler);
    });

    const activeTab = document.querySelector(
      '#right-tabs .tab-content-cld:not(.tab-content-hidden)'
    );
    if (activeTab) {
      const scrollHandler = () => handleScroll(activeTab);
      activeTab._topButtonScrollHandler = scrollHandler;
      activeTab.addEventListener('scroll', scrollHandler, { passive: true });
      handleScroll(activeTab);
    }
  };

  /**
   * Creates and appends scroll-to-top button
   * @returns {void}
   */
  const createButton = () => {
    const rightTabs = document.querySelector('#right-tabs');
    if (!rightTabs || document.getElementById('right-tabs-top-button')) return;
    if (!config.enabled) return;

    const button = document.createElement('button');
    button.id = 'right-tabs-top-button';
    button.className = 'top-button';
    button.title = 'Scroll to top';
    button.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

    button.addEventListener('click', () => {
      const activeTab = document.querySelector(
        '#right-tabs .tab-content-cld:not(.tab-content-hidden)'
      );
      if (activeTab) activeTab.scrollTo({ top: 0, behavior: 'smooth' });
    });

    rightTabs.style.position = 'relative';
    rightTabs.appendChild(button);
    setupScrollListener();
  };

  /**
   * Observes DOM changes to detect tab switches
   * @returns {void}
   */
  const observeTabChanges = () => {
    const observer = new MutationObserver(mutations => {
      if (
        mutations.some(
          m =>
            m.type === 'attributes' &&
            m.attributeName === 'class' &&
            m.target instanceof Element &&
            m.target.classList.contains('tab-content-cld')
        )
      ) {
        setTimeout(setupScrollListener, 100);
      }
    });

    const rightTabs = document.querySelector('#right-tabs');
    if (rightTabs) {
      observer.observe(rightTabs, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class'],
      });
    }
  };

  // Events
  const setupEvents = () => {
    document.addEventListener(
      'click',
      e => {
        const target = /** @type {EventTarget & HTMLElement} */ (e.target);
        if (target.closest && target.closest('.tab-btn[tyt-tab-content]')) {
          setTimeout(setupScrollListener, 100);
        }
      },
      true
    );
  };

  // Initialize
  const init = () => {
    addStyles();
    setupEvents();

    const checkForTabs = () => {
      if (document.querySelector('#right-tabs')) {
        createButton();
        observeTabChanges();
      } else {
        setTimeout(checkForTabs, 500);
      }
    };

    checkForTabs();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// YouTube End Screen Remover
(function () {
  'use strict';

  // Optimized configuration
  const CONFIG = {
    enabled: true,
    storageKey: 'youtube_endscreen_settings',
    selectors:
      '.ytp-ce-element-show,.ytp-ce-element,.ytp-endscreen-element,.ytp-ce-covering-overlay,.ytp-cards-teaser,.ytp-cards-button,.iv-drawer,.video-annotations',
    debounceMs: 32,
    batchSize: 20,
  };

  // Minimal state with better tracking
  const state = {
    observer: null,
    styleEl: null,
    isActive: false,
    removeCount: 0,
    lastCheck: 0,
    ytNavigateListenerKey: null,
    settingsNavListenerKey: null,
  };

  // High-performance utilities: use shared debounce when available
  const debounce = (fn, ms) => {
    try {
      return (
        (window.YouTubeUtils && window.YouTubeUtils.debounce) ||
        ((f, t) => {
          let id;
          return (...args) => {
            clearTimeout(id);
            id = setTimeout(() => f(...args), t);
          };
        })(fn, ms)
      );
    } catch {
      let id;
      return (...args) => {
        clearTimeout(id);
        id = setTimeout(() => fn(...args), ms);
      };
    }
  };

  const fastRemove = elements => {
    const len = Math.min(elements.length, CONFIG.batchSize);
    for (let i = 0; i < len; i++) {
      const el = elements[i];
      if (el?.isConnected) {
        el.style.cssText = 'display:none!important;visibility:hidden!important';
        try {
          el.remove();
          state.removeCount++;
        } catch { }
      }
    }
  };

  // Settings with caching
  const settings = {
    load: () => {
      try {
        const data = localStorage.getItem(CONFIG.storageKey);
        CONFIG.enabled = data ? (JSON.parse(data).enabled ?? true) : true;
      } catch {
        CONFIG.enabled = true;
      }
    },

    save: () => {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({ enabled: CONFIG.enabled }));
      } catch { }
      settings.apply();
    },

    apply: () => (CONFIG.enabled ? init() : cleanup()),
  };

  // Optimized core functions
  const injectCSS = () => {
    if (state.styleEl || !CONFIG.enabled) return;

    // ✅ Use StyleManager instead of createElement('style')
    const styles = `${CONFIG.selectors}{display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;transform:scale(0)!important}`;
    YouTubeUtils.StyleManager.add('end-screen-remover', styles);
    state.styleEl = true; // Mark as added
  };

  const removeEndScreens = () => {
    if (!CONFIG.enabled) return;
    const now = performance.now();
    if (now - state.lastCheck < CONFIG.debounceMs) return;
    state.lastCheck = now;

    const elements = document.querySelectorAll(CONFIG.selectors);
    if (elements.length) fastRemove(elements);
  };

  const setupWatcher = () => {
    if (state.observer || !CONFIG.enabled) return;

    const throttledRemove = debounce(removeEndScreens, CONFIG.debounceMs);

    state.observer = new MutationObserver(mutations => {
      let hasRelevantChanges = false;
      for (const { addedNodes } of mutations) {
        for (const node of addedNodes) {
          if (
            node instanceof Element &&
            (node.className?.includes('ytp-') || node.querySelector?.('.ytp-ce-element'))
          ) {
            hasRelevantChanges = true;
            break;
          }
        }
        if (hasRelevantChanges) break;
      }
      if (hasRelevantChanges) throttledRemove();
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(state.observer);

    const target = document.querySelector('#movie_player') || document.body;
    state.observer.observe(target, {
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'style'],
    });
  };

  const cleanup = () => {
    state.observer?.disconnect();
    state.observer = null;
    state.styleEl?.remove();
    state.styleEl = null;
    state.isActive = false;
  };

  const init = () => {
    if (state.isActive || !CONFIG.enabled) return;
    state.isActive = true;
    injectCSS();
    removeEndScreens();
    setupWatcher();
  };

  // Streamlined settings UI
  const addSettingsUI = () => {
    const section = document.querySelector('.ytp-plus-settings-section[data-section="advanced"]');
    if (!section || section.querySelector('.endscreen-settings')) return;

    const container = document.createElement('div');
    container.className = 'ytp-plus-settings-item endscreen-settings';
    container.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Hide End Screens & Cards</label>
          <div class="ytp-plus-settings-item-description">Remove end screen suggestions and info cards${state.removeCount ? ` (${state.removeCount} removed)` : ''}</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" ${CONFIG.enabled ? 'checked' : ''}>
      `;

    section.appendChild(container);

    container.querySelector('input').addEventListener(
      'change',
      e => {
        const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
        CONFIG.enabled = target.checked;
        settings.save();
      },
      { passive: true }
    );
  };

  // Optimized navigation handler
  const handlePageChange = debounce(() => {
    if (location.pathname === '/watch') {
      cleanup();
      requestIdleCallback ? requestIdleCallback(init) : setTimeout(init, 1);
    }
  }, 50);

  // Initialize
  settings.load();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  const handleSettingsNavClick = e => {
    const target = /** @type {EventTarget & HTMLElement} */ (e.target);
    if (target.dataset?.section === 'advanced') {
      setTimeout(addSettingsUI, 10);
    }
  };

  if (!state.ytNavigateListenerKey) {
    state.ytNavigateListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'yt-navigate-finish',
      handlePageChange,
      { passive: true }
    );
  }

  // Settings modal integration
  const settingsObserver = new MutationObserver(mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addSettingsUI, 25);
          return;
        }
      }
    }
  });

  // ✅ Register observer in cleanupManager
  YouTubeUtils.cleanupManager.registerObserver(settingsObserver);

  // ✅ Safe observe with document.body check
  if (document.body) {
    settingsObserver.observe(document.body, { childList: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      settingsObserver.observe(document.body, { childList: true });
    });
  }

  if (!state.settingsNavListenerKey) {
    state.settingsNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'click',
      handleSettingsNavClick,
      { passive: true, capture: true }
    );
  }
})();

// --- MODULE: adblocker.js ---

// Ad Blocker
(function () {
  'use strict';

  /**
   * Ad blocking functionality for YouTube
   * @namespace AdBlocker
   */
  const AdBlocker = {
    /**
     * Configuration settings
     * @type {Object}
     */
    config: {
      skipInterval: 500,
      removeInterval: 1500,
      enableLogging: false,
      maxRetries: 2,
      enabled: true,
      storageKey: 'youtube_adblocker_settings',
    },

    /**
     * Current state tracking
     * @type {Object}
     */
    state: {
      isYouTubeShorts: false,
      isYouTubeMusic: location.hostname === 'music.youtube.com',
      lastSkipAttempt: 0,
      retryCount: 0,
      initialized: false,
    },

    /**
     * Cached DOM queries for performance
     * @type {Object}
     */
    cache: {
      moviePlayer: null,
      ytdPlayer: null,
      lastCacheTime: 0,
      cacheTimeout: 5000,
    },

    /**
     * Optimized CSS selectors for ad elements
     * @type {Object}
     */
    selectors: {
      ads: '#player-ads,.ytp-ad-module,.ad-showing,.ytp-ad-timed-pie-countdown-container,.ytp-ad-survey-questions',
      elements:
        '#masthead-ad,ytd-merch-shelf-renderer,.yt-mealbar-promo-renderer,ytmusic-mealbar-promo-renderer,ytmusic-statement-banner-renderer,.ytp-featured-product',
      video: 'video.html5-main-video',
      removal: 'ytd-reel-video-renderer .ytd-ad-slot-renderer',
    },

    /**
     * Settings management with localStorage persistence
     * @type {Object}
     */
    settings: {
      /**
       * Load settings from localStorage
       * @returns {void}
       */
      load() {
        try {
          const saved = localStorage.getItem(AdBlocker.config.storageKey);
          if (saved) {
            const parsed = JSON.parse(saved);
            AdBlocker.config.enabled = parsed.enabled ?? true;
            AdBlocker.config.enableLogging = parsed.enableLogging ?? false;
          }
        } catch {
          // Silently fail if localStorage is unavailable
        }
      },

      /**
       * Save settings to localStorage
       * @returns {void}
       */
      save() {
        try {
          localStorage.setItem(
            AdBlocker.config.storageKey,
            JSON.stringify({
              enabled: AdBlocker.config.enabled,
              enableLogging: AdBlocker.config.enableLogging,
            })
          );
        } catch {
          // Silently fail if localStorage is unavailable
        }
      },
    },

    /**
     * Get cached player elements
     * @returns {Object} Object containing player element and controller
     */
    getPlayer() {
      const now = Date.now();
      if (now - AdBlocker.cache.lastCacheTime > AdBlocker.cache.cacheTimeout) {
        AdBlocker.cache.moviePlayer = document.querySelector('#movie_player');
        AdBlocker.cache.ytdPlayer = document.querySelector('#ytd-player');
        AdBlocker.cache.lastCacheTime = now;
      }

      const playerEl = AdBlocker.cache.ytdPlayer;
      return {
        element: AdBlocker.cache.moviePlayer,
        player: playerEl?.getPlayer?.() || playerEl,
      };
    },

    /**
     * Skip current ad by seeking to end
     * @returns {void}
     */
    skipAd() {
      if (!AdBlocker.config.enabled) return;

      const now = Date.now();
      if (now - AdBlocker.state.lastSkipAttempt < 300) return;
      AdBlocker.state.lastSkipAttempt = now;

      if (location.pathname.startsWith('/shorts/')) return;

      // Fast ad detection
      const adElement = document.querySelector(
        '.ad-showing, .ytp-ad-timed-pie-countdown-container'
      );
      if (!adElement) {
        AdBlocker.state.retryCount = 0;
        return;
      }

      try {
        const { player } = AdBlocker.getPlayer();
        if (!player) return;

        const video = document.querySelector(AdBlocker.selectors.video);

        // Mute ad immediately
        if (video) video.muted = true;

        // Skip logic based on platform
        if (AdBlocker.state.isYouTubeMusic && video) {
          /** @type {HTMLVideoElement} */ (video).currentTime = video.duration || 999;
        } else if (typeof player.getVideoData === 'function') {
          const videoData = player.getVideoData();
          if (videoData?.video_id) {
            const currentTime = Math.floor(player.getCurrentTime?.() || 0);

            // Use most efficient skip method
            if (typeof player.loadVideoById === 'function') {
              player.loadVideoById(videoData.video_id, currentTime);
            }
          }
        }

        AdBlocker.state.retryCount = 0;
      } catch {
        if (AdBlocker.state.retryCount < AdBlocker.config.maxRetries) {
          AdBlocker.state.retryCount++;
          setTimeout(AdBlocker.skipAd, 800);
        }
      }
    },

    // Minimal CSS injection
    addCss() {
      if (document.querySelector('#yt-ab-styles') || !AdBlocker.config.enabled) return;

      // ✅ Use StyleManager instead of createElement('style')
      const styles = `${AdBlocker.selectors.ads},${AdBlocker.selectors.elements}{display:none!important;}`;
      YouTubeUtils.StyleManager.add('yt-ab-styles', styles);
    },

    removeCss() {
      YouTubeUtils.StyleManager.remove('yt-ab-styles');
    },

    // Batched element removal
    removeElements() {
      if (!AdBlocker.config.enabled || AdBlocker.state.isYouTubeMusic) return;

      // Use requestIdleCallback for non-blocking removal
      const remove = () => {
        const elements = document.querySelectorAll(AdBlocker.selectors.removal);
        elements.forEach(el => el.closest('ytd-reel-video-renderer')?.remove());
      };

      if (window.requestIdleCallback) {
        requestIdleCallback(remove, { timeout: 100 });
      } else {
        setTimeout(remove, 0);
      }
    },

    // Optimized settings UI
    addSettingsUI() {
      const section = document.querySelector('.ytp-plus-settings-section[data-section="basic"]');
      if (!section || section.querySelector('.ab-settings')) return;

      try {
        const item = document.createElement('div');
        item.className = 'ytp-plus-settings-item ab-settings';
        item.innerHTML = `
          <div>
            <label class="ytp-plus-settings-item-label">Ad Blocker</label>
            <div class="ytp-plus-settings-item-description">Skip ads and remove ad elements automatically</div>
          </div>
          <input type="checkbox" class="ytp-plus-settings-checkbox" ${AdBlocker.config.enabled ? 'checked' : ''}>
        `;

        section.appendChild(item);

        item.querySelector('input').addEventListener('change', e => {
          const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
          AdBlocker.config.enabled = target.checked;
          AdBlocker.settings.save();
          AdBlocker.config.enabled ? AdBlocker.addCss() : AdBlocker.removeCss();
        });
      } catch (error) {
        YouTubeUtils.logError('AdBlocker', 'Failed to add settings UI', error);
      }
    },

    // Streamlined initialization
    init() {
      if (AdBlocker.state.initialized) return;
      AdBlocker.state.initialized = true;

      AdBlocker.settings.load();

      if (AdBlocker.config.enabled) {
        AdBlocker.addCss();
        AdBlocker.removeElements();
      }

      // Start optimized intervals with cleanup registration
      const skipInterval = setInterval(AdBlocker.skipAd, AdBlocker.config.skipInterval);
      const removeInterval = setInterval(AdBlocker.removeElements, AdBlocker.config.removeInterval);

      // ✅ Register intervals in cleanupManager
      YouTubeUtils.cleanupManager.registerInterval(skipInterval);
      YouTubeUtils.cleanupManager.registerInterval(removeInterval);

      // Navigation handling
      const handleNavigation = () => {
        AdBlocker.state.isYouTubeShorts = location.pathname.startsWith('/shorts/');
        AdBlocker.cache.lastCacheTime = 0; // Reset cache
      };

      // Override pushState for SPA navigation
      const originalPushState = history.pushState;
      history.pushState = function () {
        const result = originalPushState.apply(this, arguments);
        setTimeout(handleNavigation, 50);
        return result;
      };

      // Settings modal integration
      const settingsObserver = new MutationObserver(_mutations => {
        for (const { addedNodes } of _mutations) {
          for (const node of addedNodes) {
            if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
              setTimeout(AdBlocker.addSettingsUI, 50);
              return;
            }
          }
        }
      });

      // ✅ Register observer in cleanupManager
      YouTubeUtils.cleanupManager.registerObserver(settingsObserver);

      // ✅ Safe observe with document.body check
      if (document.body) {
        settingsObserver.observe(document.body, { childList: true });
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          settingsObserver.observe(document.body, { childList: true });
        });
      }

      // ✅ Register global click listener in cleanupManager
      const clickHandler = e => {
        const target = /** @type {EventTarget & HTMLElement} */ (e.target);
        if (target.dataset?.section === 'basic') {
          setTimeout(AdBlocker.addSettingsUI, 25);
        }
      };
      YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, {
        passive: true,
        capture: true,
      });

      // Initial skip attempt
      if (AdBlocker.config.enabled) {
        setTimeout(AdBlocker.skipAd, 200);
      }
    },
  };

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', AdBlocker.init, { once: true });
  } else {
    AdBlocker.init();
  }
})();

// --- MODULE: count.js ---

// count
(function () {
  'use strict';

  // Enhanced configuration with better defaults
  const CONFIG = {
    OPTIONS: ['subscribers', 'views', 'videos'],
    FONT_LINK: 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;700&display=swap',
    STATS_API_URL: 'https://api.livecounts.io/youtube-live-subscriber-counter/stats/',
    DEFAULT_UPDATE_INTERVAL: 2000,
    DEFAULT_OVERLAY_OPACITY: 0.75,
    MAX_RETRIES: 3,
    CACHE_DURATION: 300000, // 5 minutes
    DEBOUNCE_DELAY: 100,
    STORAGE_KEY: 'youtube_channel_stats_settings',
  };

  // Global state management
  const state = {
    overlay: null,
    isUpdating: false,
    intervalId: null,
    currentChannelName: null,
    enabled: localStorage.getItem(CONFIG.STORAGE_KEY) !== 'false',
    updateInterval:
      parseInt(localStorage.getItem('youtubeEnhancerInterval')) || CONFIG.DEFAULT_UPDATE_INTERVAL,
    overlayOpacity:
      parseFloat(localStorage.getItem('youtubeEnhancerOpacity')) || CONFIG.DEFAULT_OVERLAY_OPACITY,
    lastSuccessfulStats: new Map(),
    previousStats: new Map(),
    previousUrl: location.href,
    isChecking: false,
    documentListenerKeys: new Set(),
  };

  // Utility functions
  const utils = {
    log: (message, ...args) => {
      console.log(`[YouTube Enhancer] ${message}`, ...args);
    },

    warn: (message, ...args) => {
      console.warn(`[YouTube Enhancer] ${message}`, ...args);
    },

    error: (message, ...args) => {
      console.error(`[YouTube Enhancer] ${message}`, ...args);
    },

    // Use shared debounce from YouTubeUtils
    debounce:
      window.YouTubeUtils?.debounce ||
      ((func, wait) => {
        let timeout;
        return function executedFunction(...args) {
          const later = () => {
            clearTimeout(timeout);
            func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
        };
      }),
  };

  const OPTIONS = CONFIG.OPTIONS;
  const FONT_LINK = CONFIG.FONT_LINK;
  const STATS_API_URL = CONFIG.STATS_API_URL;

  /**
   * Fetches channel data from YouTube
   * @param {string} url - The channel URL to fetch
   * @returns {Promise<Object|null>} The parsed channel data or null on error
   */
  async function fetchChannel(url) {
    if (state.isChecking) return null;
    state.isChecking = true;

    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
      });

      if (!response.ok) return null;

      const html = await response.text();
      const match = html.match(/var ytInitialData = (.+?);<\/script>/);
      return match && match[1] ? JSON.parse(match[1]) : null;
    } catch (error) {
      utils.warn('Failed to fetch channel data:', error);
      return null;
    } finally {
      state.isChecking = false;
    }
  }

  async function getChannelInfo(url) {
    const data = await fetchChannel(url);
    if (!data) return null;

    try {
      const channelName = data?.metadata?.channelMetadataRenderer?.title || 'Unknown';
      const channelId = data?.metadata?.channelMetadataRenderer?.externalId || null;

      return { channelName, channelId };
    } catch {
      return null;
    }
  }

  function isChannelPageUrl(url) {
    return (
      url.includes('youtube.com/') &&
      (url.includes('/channel/') || url.includes('/@')) &&
      !url.includes('/video/') &&
      !url.includes('/watch')
    );
  }

  function checkUrlChange() {
    const currentUrl = location.href;
    if (currentUrl !== state.previousUrl) {
      state.previousUrl = currentUrl;
      if (isChannelPageUrl(currentUrl)) {
        setTimeout(() => getChannelInfo(currentUrl), 500);
      }
    }
  }

  history.pushState = (function (f) {
    /** @this {any} */
    return function () {
      f.apply(this, arguments);
      checkUrlChange();
    };
  })(history.pushState);

  history.replaceState = (function (f) {
    /** @this {any} */
    return function () {
      f.apply(this, arguments);
      checkUrlChange();
    };
  })(history.replaceState);

  window.addEventListener('popstate', checkUrlChange);
  setInterval(checkUrlChange, 1000);

  function init() {
    try {
      utils.log('Initializing YouTube Enhancer v1.6');

      loadFonts();
      initializeLocalStorage();
      addStyles();
      if (state.enabled) {
        observePageChanges();
        addNavigationListener();

        if (isChannelPageUrl(location.href)) {
          getChannelInfo(location.href);
        }
      }

      utils.log('YouTube Enhancer initialized successfully');
    } catch (error) {
      utils.error('Failed to initialize YouTube Enhancer:', error);
    }
  }

  function loadFonts() {
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = FONT_LINK;
    document.head.appendChild(fontLink);
  }

  function initializeLocalStorage() {
    OPTIONS.forEach(option => {
      if (localStorage.getItem(`show-${option}`) === null) {
        localStorage.setItem(`show-${option}`, 'true');
      }
    });
  }

  function addStyles() {
    // ✅ Use StyleManager instead of createElement('style')
    const styles = `
        .channel-banner-overlay{position:absolute;top:0;left:0;width:100%;height:100%;border-radius:12px;z-index:10;display:flex;justify-content:space-around;align-items:center;color:#fff;font-family:var(--stats-font-family,'Rubik',sans-serif);font-size:var(--stats-font-size,24px);box-sizing:border-box;transition:background-color .3s ease;backdrop-filter:blur(2px)}
        .settings-button{position:absolute;top:8px;right:8px;width:24px;height:24px;cursor:pointer;z-index:2;transition:transform .2s;opacity:.7}
        .settings-button:hover{transform:scale(1.1);opacity:1}
        .settings-menu{position:absolute;top:35px;right:8px;background:rgba(0,0,0,.95);padding:12px;border-radius:8px;z-index:10;display:none;backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.1);min-width:320px}
        .settings-menu.show{display:block}
        .stat-container{display:flex;flex-direction:column;align-items:center;justify-content:center;visibility:hidden;width:33%;height:100%;padding:0 1rem}
        .number-container{display:flex;align-items:center;justify-content:center;font-weight:700;min-height:3rem}
        .label-container{display:flex;align-items:center;margin-top:.5rem;font-size:1.2rem;opacity:.9}
        .label-container svg{width:1.5rem;height:1.5rem;margin-right:.5rem}
        .difference{font-size:1.8rem;height:2rem;margin-bottom:.5rem;transition:opacity .3s}
        .spinner-container{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;justify-content:center;align-items:center}
        .loading-spinner{animation:spin 1s linear infinite}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @media(max-width:768px){.channel-banner-overlay{flex-direction:column;padding:8px;min-height:160px}.settings-menu{width:280px;right:4px}}
        .setting-group{margin-bottom:12px}
        .setting-group:last-child{margin-bottom:0}
        .setting-group label{display:block;margin-bottom:4px;font-weight:600;color:#fff;font-size:14px}
        .setting-group input[type="range"]{width:100%;margin:4px 0}
        .setting-group input[type="checkbox"]{margin-right:8px}
        .setting-value{color:#aaa;font-size:12px;margin-top:2px}
        `;
    YouTubeUtils.StyleManager.add('channel-stats-overlay', styles);
  }

  function createSettingsButton() {
    const button = document.createElement('div');
    button.className = 'settings-button';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 0 512 512');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'white');
    path.setAttribute(
      'd',
      'M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z'
    );

    svg.appendChild(path);
    button.appendChild(svg);

    return button;
  }

  function createSettingsMenu() {
    const menu = document.createElement('div');
    menu.className = 'settings-menu';
    menu.style.gap = '15px';
    menu.style.width = '360px';
    menu.setAttribute('tabindex', '-1');
    menu.setAttribute('aria-modal', 'true');

    const displaySection = createDisplaySection();
    const controlsSection = createControlsSection();

    menu.appendChild(displaySection);
    menu.appendChild(controlsSection);

    return menu;
  }

  function createDisplaySection() {
    const displaySection = document.createElement('div');
    displaySection.style.flex = '1';

    const displayLabel = document.createElement('label');
    displayLabel.textContent = 'Display Options';
    displayLabel.style.marginBottom = '10px';
    displayLabel.style.display = 'block';
    displayLabel.style.fontSize = '16px';
    displayLabel.style.fontWeight = 'bold';
    displaySection.appendChild(displayLabel);

    OPTIONS.forEach(option => {
      const checkboxContainer = document.createElement('div');
      checkboxContainer.style.display = 'flex';
      checkboxContainer.style.alignItems = 'center';
      checkboxContainer.style.marginTop = '5px';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `show-${option}`;
      checkbox.checked = localStorage.getItem(`show-${option}`) !== 'false';
      // ✅ Применяем стиль как в настройках
      checkbox.className = 'ytp-plus-settings-checkbox';

      const checkboxLabel = document.createElement('label');
      checkboxLabel.htmlFor = `show-${option}`;
      checkboxLabel.textContent = option.charAt(0).toUpperCase() + option.slice(1);
      checkboxLabel.style.cursor = 'pointer';
      checkboxLabel.style.color = 'white';
      checkboxLabel.style.fontSize = '14px';
      checkboxLabel.style.marginLeft = '8px';

      checkbox.addEventListener('change', () => {
        localStorage.setItem(`show-${option}`, String(checkbox.checked));
        updateDisplayState();
      });

      checkboxContainer.appendChild(checkbox);
      checkboxContainer.appendChild(checkboxLabel);
      displaySection.appendChild(checkboxContainer);
    });

    return displaySection;
  }

  function createControlsSection() {
    const controlsSection = document.createElement('div');
    controlsSection.style.flex = '1';

    // Font family selector
    const fontLabel = document.createElement('label');
    fontLabel.textContent = 'Font Family';
    fontLabel.style.display = 'block';
    fontLabel.style.marginBottom = '5px';
    fontLabel.style.fontSize = '16px';
    fontLabel.style.fontWeight = 'bold';

    const fontSelect = document.createElement('select');
    fontSelect.className = 'font-family-select';
    fontSelect.style.width = '100%';
    fontSelect.style.marginBottom = '10px';
    const fonts = [
      { name: 'Rubik', value: 'Rubik, sans-serif' },
      { name: 'Impact', value: 'Impact, Charcoal, sans-serif' },
      { name: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
      { name: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
    ];
    const savedFont = localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif';
    fonts.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.value;
      opt.textContent = f.name;
      if (f.value === savedFont) opt.selected = true;
      fontSelect.appendChild(opt);
    });

    fontSelect.addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLSelectElement} */ (e.target);
      localStorage.setItem('youtubeEnhancerFontFamily', target.value);
      if (state.overlay) {
        // Only update .subscribers-number, .views-number, .videos-number
        state.overlay
          .querySelectorAll('.subscribers-number,.views-number,.videos-number')
          .forEach(el => {
            el.style.fontFamily = target.value;
          });
      }
    });

    // Font size slider
    const fontSizeLabel = document.createElement('label');
    fontSizeLabel.textContent = 'Font Size';
    fontSizeLabel.style.display = 'block';
    fontSizeLabel.style.marginBottom = '5px';
    fontSizeLabel.style.fontSize = '16px';
    fontSizeLabel.style.fontWeight = 'bold';

    const fontSizeSlider = document.createElement('input');
    fontSizeSlider.type = 'range';
    fontSizeSlider.min = '16';
    fontSizeSlider.max = '72';
    fontSizeSlider.value = localStorage.getItem('youtubeEnhancerFontSize') || '24';
    fontSizeSlider.step = '1';
    fontSizeSlider.className = 'font-size-slider';

    const fontSizeValue = document.createElement('div');
    fontSizeValue.className = 'font-size-value';
    fontSizeValue.textContent = `${fontSizeSlider.value}px`;
    fontSizeValue.style.fontSize = '14px';
    fontSizeValue.style.marginBottom = '15px';

    fontSizeSlider.addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      fontSizeValue.textContent = `${target.value}px`;
      localStorage.setItem('youtubeEnhancerFontSize', target.value);
      if (state.overlay) {
        // Only update .subscribers-number, .views-number, .videos-number
        state.overlay
          .querySelectorAll('.subscribers-number,.views-number,.videos-number')
          .forEach(el => {
            el.style.fontSize = `${target.value}px`;
          });
      }
    });

    // ...existing code...
    const intervalLabel = document.createElement('label');
    intervalLabel.textContent = 'Update Interval';
    intervalLabel.style.display = 'block';
    intervalLabel.style.marginBottom = '5px';
    intervalLabel.style.fontSize = '16px';
    intervalLabel.style.fontWeight = 'bold';

    const intervalSlider = document.createElement('input');
    intervalSlider.type = 'range';
    intervalSlider.min = '2';
    intervalSlider.max = '10';
    intervalSlider.value = String(state.updateInterval / 1000);
    intervalSlider.step = '1';
    intervalSlider.className = 'interval-slider';

    const intervalValue = document.createElement('div');
    intervalValue.className = 'interval-value';
    intervalValue.textContent = `${intervalSlider.value}s`;
    intervalValue.style.marginBottom = '15px';
    intervalValue.style.fontSize = '14px';

    intervalSlider.addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      const newInterval = parseInt(target.value) * 1000;
      intervalValue.textContent = `${target.value}s`;
      state.updateInterval = newInterval;
      localStorage.setItem('youtubeEnhancerInterval', String(newInterval));

      if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = setInterval(() => {
          updateOverlayContent(state.overlay, state.currentChannelName);
        }, newInterval);

        // ✅ Register interval in cleanupManager
        YouTubeUtils.cleanupManager.registerInterval(state.intervalId);
      }
    });

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Background Opacity';
    opacityLabel.style.display = 'block';
    opacityLabel.style.marginBottom = '5px';
    opacityLabel.style.fontSize = '16px';
    opacityLabel.style.fontWeight = 'bold';

    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.min = '50';
    opacitySlider.max = '90';
    opacitySlider.value = String(state.overlayOpacity * 100);
    opacitySlider.step = '5';
    opacitySlider.className = 'opacity-slider';

    const opacityValue = document.createElement('div');
    opacityValue.className = 'opacity-value';
    opacityValue.textContent = `${opacitySlider.value}%`;
    opacityValue.style.fontSize = '14px';

    opacitySlider.addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      const newOpacity = parseInt(target.value) / 100;
      opacityValue.textContent = `${target.value}%`;
      state.overlayOpacity = newOpacity;
      localStorage.setItem('youtubeEnhancerOpacity', String(newOpacity));

      if (state.overlay) {
        state.overlay.style.backgroundColor = `rgba(0, 0, 0, ${newOpacity})`;
      }
    });

    controlsSection.appendChild(fontLabel);
    controlsSection.appendChild(fontSelect);
    controlsSection.appendChild(fontSizeLabel);
    controlsSection.appendChild(fontSizeSlider);
    controlsSection.appendChild(fontSizeValue);
    controlsSection.appendChild(intervalLabel);
    controlsSection.appendChild(intervalSlider);
    controlsSection.appendChild(intervalValue);
    controlsSection.appendChild(opacityLabel);
    controlsSection.appendChild(opacitySlider);
    controlsSection.appendChild(opacityValue);

    return controlsSection;
  }

  function createSpinner() {
    const spinnerContainer = document.createElement('div');
    spinnerContainer.style.position = 'absolute';
    spinnerContainer.style.top = '0';
    spinnerContainer.style.left = '0';
    spinnerContainer.style.width = '100%';
    spinnerContainer.style.height = '100%';
    spinnerContainer.style.display = 'flex';
    spinnerContainer.style.justifyContent = 'center';
    spinnerContainer.style.alignItems = 'center';
    spinnerContainer.classList.add('spinner-container');

    const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spinner.setAttribute('viewBox', '0 0 512 512');
    spinner.setAttribute('width', '64');
    spinner.setAttribute('height', '64');
    spinner.classList.add('loading-spinner');
    spinner.style.animation = 'spin 1s linear infinite';

    const secondaryPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    secondaryPath.setAttribute(
      'd',
      'M0 256C0 114.9 114.1 .5 255.1 0C237.9 .5 224 14.6 224 32c0 17.7 14.3 32 32 32C150 64 64 150 64 256s86 192 192 192c69.7 0 130.7-37.1 164.5-92.6c-3 6.6-3.3 14.8-1 22.2c1.2 3.7 3 7.2 5.4 10.3c1.2 1.5 2.6 3 4.1 4.3c.8 .7 1.6 1.3 2.4 1.9c.4 .3 .8 .6 1.3 .9s.9 .6 1.3 .8c5 2.9 10.6 4.3 16 4.3c11 0 21.8-5.7 27.7-16c-44.3 76.5-127 128-221.7 128C114.6 512 0 397.4 0 256z'
    );
    secondaryPath.style.opacity = '0.4';
    secondaryPath.style.fill = 'white';

    const primaryPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    primaryPath.setAttribute(
      'd',
      'M224 32c0-17.7 14.3-32 32-32C397.4 0 512 114.6 512 256c0 46.6-12.5 90.4-34.3 128c-8.8 15.3-28.4 20.5-43.7 11.7s-20.5-28.4-11.7-43.7c16.3-28.2 25.7-61 25.7-96c0-106-86-192-192-192c-17.7 0-32-14.3-32-32z'
    );
    primaryPath.style.fill = 'white';

    spinner.appendChild(secondaryPath);
    spinner.appendChild(primaryPath);
    spinnerContainer.appendChild(spinner);
    return spinnerContainer;
  }

  function createSVGIcon(path) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 640 512');
    svg.setAttribute('width', '2rem');
    svg.setAttribute('height', '2rem');
    svg.style.marginRight = '0.5rem';
    svg.style.display = 'none';

    const svgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svgPath.setAttribute('d', path);
    svgPath.setAttribute('fill', 'white');

    svg.appendChild(svgPath);
    return svg;
  }

  function createStatContainer(className, iconPath) {
    const container = document.createElement('div');
    Object.assign(container.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      visibility: 'hidden',
      width: '33%',
      height: '100%',
      padding: '0 1rem',
    });

    const numberContainer = document.createElement('div');
    Object.assign(numberContainer.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    });

    const differenceElement = document.createElement('div');
    differenceElement.classList.add(`${className}-difference`);
    Object.assign(differenceElement.style, {
      fontSize: '2.5rem',
      height: '2.5rem',
      marginBottom: '1rem',
    });

    const digitContainer = createNumberContainer();
    digitContainer.classList.add(`${className}-number`);
    Object.assign(digitContainer.style, {
      fontSize: (localStorage.getItem('youtubeEnhancerFontSize') || '24') + 'px',
      fontWeight: 'bold',
      lineHeight: '1',
      height: '4rem',
      fontFamily: localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif',
      letterSpacing: '0.025em',
    });

    numberContainer.appendChild(differenceElement);
    numberContainer.appendChild(digitContainer);

    const labelContainer = document.createElement('div');
    Object.assign(labelContainer.style, {
      display: 'flex',
      alignItems: 'center',
      marginTop: '0.5rem',
    });

    const icon = createSVGIcon(iconPath);
    Object.assign(icon.style, {
      width: '2rem',
      height: '2rem',
      marginRight: '0.75rem',
    });

    const labelElement = document.createElement('div');
    labelElement.classList.add(`${className}-label`);
    labelElement.style.fontSize = '2rem';

    labelContainer.appendChild(icon);
    labelContainer.appendChild(labelElement);

    container.appendChild(numberContainer);
    container.appendChild(labelContainer);

    return container;
  }

  function createOverlay(bannerElement) {
    clearExistingOverlay();

    if (!bannerElement) return null;

    const overlay = document.createElement('div');
    overlay.classList.add('channel-banner-overlay');
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      backgroundColor: `rgba(0, 0, 0, ${state.overlayOpacity})`,
      borderRadius: '15px',
      zIndex: '10',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      color: 'white',
      fontFamily: localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif',
      fontSize: (localStorage.getItem('youtubeEnhancerFontSize') || '24') + 'px',
      boxSizing: 'border-box',
      transition: 'background-color 0.3s ease',
    });

    // Accessibility attributes
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', 'YouTube Channel Statistics Overlay');
    overlay.setAttribute('tabindex', '-1');

    // Responsive design for mobile
    if (window.innerWidth <= 768) {
      overlay.style.flexDirection = 'column';
      overlay.style.padding = '10px';
      overlay.style.minHeight = '200px';
    }

    const settingsButton = createSettingsButton();
    settingsButton.setAttribute('tabindex', '0');
    settingsButton.setAttribute('aria-label', 'Open settings menu');
    settingsButton.setAttribute('role', 'button');

    const settingsMenu = createSettingsMenu();
    settingsMenu.setAttribute('aria-label', 'Statistics display settings');
    settingsMenu.setAttribute('role', 'dialog');

    overlay.appendChild(settingsButton);
    overlay.appendChild(settingsMenu);

    // Enhanced event handling with keyboard support
    const toggleMenu = show => {
      settingsMenu.classList.toggle('show', show);
      settingsButton.setAttribute('aria-expanded', show);
      if (show) {
        settingsMenu.focus();
      }
    };

    settingsButton.addEventListener('click', e => {
      e.stopPropagation();
      toggleMenu(!settingsMenu.classList.contains('show'));
    });

    settingsButton.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleMenu(!settingsMenu.classList.contains('show'));
      }
    });

    // Close menu when clicking outside or pressing escape
    const documentClickHandler = e => {
      const target = /** @type {EventTarget & Node} */ (e.target);
      if (!settingsMenu.contains(target) && !settingsButton.contains(target)) {
        toggleMenu(false);
      }
    };
    const clickListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'click',
      documentClickHandler
    );
    state.documentListenerKeys.add(clickListenerKey);

    const documentKeydownHandler = e => {
      if (e.key === 'Escape' && settingsMenu.classList.contains('show')) {
        toggleMenu(false);
        settingsButton.focus();
      }
    };
    const keyListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'keydown',
      documentKeydownHandler
    );
    state.documentListenerKeys.add(keyListenerKey);

    const spinner = createSpinner();
    overlay.appendChild(spinner);

    const subscribersElement = createStatContainer(
      'subscribers',
      'M144 160c-44.2 0-80-35.8-80-80S99.8 0 144 0s80 35.8 80 80s-35.8 80-80 80zm368 0c-44.2 0-80-35.8-80-80s35.8-80 80-80s80 35.8 80 80s-35.8 80-80 80zM0 298.7C0 239.8 47.8 192 106.7 192h42.7c15.9 0 31 3.5 44.6 9.7c-1.3 7.2-1.9 14.7-1.9 22.3c0 38.2 16.8 72.5 43.3 96c-.2 0-.4 0-.7 0H21.3C9.6 320 0 310.4 0 298.7zM405.3 320c-.2 0-.4 0-.7 0c26.6-23.5 43.3-57.8 43.3-96c0-7.6-.7-15-1.9-22.3c13.6-6.3 28.7-9.7 44.6-9.7h42.7C592.2 192 640 239.8 640 298.7c0 11.8-9.6 21.3-21.3 21.3H405.3zM416 224c0 53-43 96-96 96s-96-43-96-96s43-96 96-96s96 43 96 96zM128 485.3C128 411.7 187.7 352 261.3 352H378.7C452.3 352 512 411.7 512 485.3c0 14.7-11.9 26.7-26.7 26.7H154.7c-14.7 0-26.7-11.9-26.7-26.7z'
    );
    const viewsElement = createStatContainer(
      'views',
      'M288 32c-80.8 0-145.5 36.8-192.6 80.6C48.6 156 17.3 208 2.5 243.7c-3.3 7.9-3.3 16.7 0 24.6C17.3 304 48.6 356 95.4 399.4C142.5 443.2 207.2 480 288 480s145.5-36.8 192.6-80.6c46.8-43.5 78.1-95.4 93-131.1c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C433.5 68.8 368.8 32 288 32zM144 256a144 144 0 1 1 288 0 144 144 0 1 1 -288 0zm144-64c0 35.3-28.7 64-64 64c-7.1 0-13.9-1.2-20.3-3.3c-5.5-1.8-11.9 1.6-11.7 7.4c.3 6.9 1.3 13.8 3.2 20.7c13.7 51.2 66.4 81.6 117.6 67.9s81.6-66.4 67.9-117.6c-11.1-41.5-47.8-69.4-88.6-71.1c-5.8-.2-9.2 6.1-7.4 11.7c2.1 6.4 3.3 13.2 3.3 20.3z'
    );
    const videosElement = createStatContainer(
      'videos',
      'M0 128C0 92.7 28.7 64 64 64H320c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128zM559.1 99.8c10.4 5.6 16.9 16.4 16.9 28.2V384c0 11.8-6.5 22.6-16.9 28.2s-23 5-32.9-1.6l-96-64L416 337.1V320 192 174.9l14.2-9.5 96-64c9.8-6.5 22.4-7.2 32.9-1.6z'
    );

    overlay.appendChild(subscribersElement);
    overlay.appendChild(viewsElement);
    overlay.appendChild(videosElement);

    bannerElement.appendChild(overlay);
    updateDisplayState();
    return overlay;
  }

  function fetchWithGM(url, headers = {}) {
    const requestHeaders = {
      Accept: 'application/json',
      ...headers,
    };
    // Access GM_xmlhttpRequest via window to avoid TS "Cannot find name" when d.ts isn't picked up
    const gm = /** @type {any} */ (window).GM_xmlhttpRequest;
    if (typeof gm === 'function') {
      return new Promise((resolve, reject) => {
        gm({
          method: 'GET',
          url,
          headers: requestHeaders,
          timeout: 10000,
          onload: response => {
            if (response.status >= 200 && response.status < 300) {
              try {
                resolve(JSON.parse(response.responseText));
              } catch (parseError) {
                reject(new Error(`Failed to parse response: ${parseError.message}`));
              }
            } else {
              reject(new Error(`Failed to fetch: ${response.status}`));
            }
          },
          onerror: error => reject(error),
          ontimeout: () => reject(new Error('Request timed out')),
        });
      });
    }

    utils.warn('GM_xmlhttpRequest unavailable, falling back to fetch API');
    return fetch(url, {
      method: 'GET',
      headers: requestHeaders,
      credentials: 'omit',
      mode: 'cors',
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }
        return response.json();
      })
      .catch(error => {
        utils.error('Fallback fetch failed:', error);
        throw error;
      });
  }

  async function fetchChannelId(_channelName) {
    // Try meta tag first
    const metaTag = document.querySelector('meta[itemprop="channelId"]');
    if (metaTag && metaTag.content) return metaTag.content;

    // Try URL pattern
    const urlMatch = window.location.href.match(/channel\/(UC[\w-]+)/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];

    // Try ytInitialData
    const channelInfo = await getChannelInfo(window.location.href);
    if (channelInfo && channelInfo.channelId) return channelInfo.channelId;
    throw new Error('Could not determine channel ID');
  }

  async function fetchChannelStats(channelId) {
    try {
      let retries = CONFIG.MAX_RETRIES;

      while (retries > 0) {
        try {
          const stats = await fetchWithGM(`${STATS_API_URL}${channelId}`, {
            origin: 'https://livecounts.io',
            referer: 'https://livecounts.io/',
          });

          // Validate response structure
          if (!stats || typeof stats.followerCount === 'undefined') {
            throw new Error('Invalid stats response structure');
          }

          // Cache successful response
          state.lastSuccessfulStats.set(channelId, {
            ...stats,
            timestamp: Date.now(),
          });
          return stats;
        } catch (e) {
          utils.warn('Fetch attempt failed:', e.message);
          retries--;
          if (retries > 0) {
            // Exponential backoff for retries
            await new Promise(resolve =>
              setTimeout(resolve, 1000 * (CONFIG.MAX_RETRIES - retries + 1))
            );
          }
        }
      }

      // Try to use cached data if available and recent (within 5 minutes)
      if (state.lastSuccessfulStats.has(channelId)) {
        const cached = state.lastSuccessfulStats.get(channelId);
        const isRecent = Date.now() - cached.timestamp < CONFIG.CACHE_DURATION;
        if (isRecent) {
          utils.log('Using cached stats for channel:', channelId);
          return cached;
        }
      }

      // Fallback: try to extract subscriber count from page
      const fallbackStats = {
        followerCount: 0,
        bottomOdos: [0, 0],
        error: true,
        timestamp: Date.now(),
      };

      // Try multiple selectors for subscriber count
      const subCountSelectors = [
        '#subscriber-count',
        '.yt-subscription-button-subscriber-count-branded-horizontal',
        '[id*="subscriber"]',
        '.ytd-subscribe-button-renderer',
      ];

      for (const selector of subCountSelectors) {
        const subCountElem = document.querySelector(selector);
        if (subCountElem) {
          const subText = subCountElem.textContent || subCountElem.innerText || '';
          const subMatch = subText.match(/[\d,\.]+[KMB]?/);
          if (subMatch) {
            const raw = subMatch[0].replace(/,/g, '');
            // parse into number safely
            let numCount = Number(raw.replace(/[KMB]/, '')) || 0;
            if (raw.includes('K')) {
              numCount = numCount * 1000;
            } else if (raw.includes('M')) {
              numCount = numCount * 1000000;
            } else if (raw.includes('B')) {
              numCount = numCount * 1000000000;
            }
            // Ensure followerCount is a number
            fallbackStats.followerCount = Math.floor(numCount);
            utils.log('Extracted fallback subscriber count:', fallbackStats.followerCount);
            break;
          }
        }
      }

      return fallbackStats;
    } catch (error) {
      utils.error('Failed to fetch channel stats:', error);
      return {
        followerCount: 0,
        bottomOdos: [0, 0],
        error: true,
        timestamp: Date.now(),
      };
    }
  }

  function clearExistingOverlay() {
    const existingOverlay = document.querySelector('.channel-banner-overlay');
    if (existingOverlay) {
      try {
        existingOverlay.remove();
      } catch {
        console.warn('[YouTube+] Failed to remove overlay');
      }
    }
    if (state.intervalId) {
      try {
        clearInterval(state.intervalId);
        // ✅ Unregister from cleanupManager if it was registered
        YouTubeUtils.cleanupManager.unregisterInterval(state.intervalId);
      } catch {
        console.warn('[YouTube+] Failed to clear interval');
      }
      state.intervalId = null;
    }
    if (state.documentListenerKeys && state.documentListenerKeys.size) {
      state.documentListenerKeys.forEach(key => {
        try {
          YouTubeUtils.cleanupManager.unregisterListener(key);
        } catch {
          console.warn('[YouTube+] Failed to unregister listener');
        }
      });
      state.documentListenerKeys.clear();
    }
    if (state.lastSuccessfulStats) state.lastSuccessfulStats.clear();
    if (state.previousStats) state.previousStats.clear();
    state.isUpdating = false;
    state.overlay = null;
    utils.log('Cleared existing overlay');
  }

  function createDigitElement() {
    const digit = document.createElement('span');
    Object.assign(digit.style, {
      display: 'inline-block',
      width: '0.6em',
      textAlign: 'center',
      marginRight: '0.025em',
      marginLeft: '0.025em',
    });
    return digit;
  }

  function createCommaElement() {
    const comma = document.createElement('span');
    comma.textContent = ',';
    Object.assign(comma.style, {
      display: 'inline-block',
      width: '0.3em',
      textAlign: 'center',
    });
    return comma;
  }

  function createNumberContainer() {
    const container = document.createElement('div');
    Object.assign(container.style, {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      letterSpacing: '0.025em',
    });
    return container;
  }

  function updateDigits(container, newValue) {
    const newValueStr = newValue.toString();
    const digits = [];

    for (let i = newValueStr.length - 1; i >= 0; i -= 3) {
      const start = Math.max(0, i - 2);
      digits.unshift(newValueStr.slice(start, i + 1));
    }

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    for (let i = 0; i < digits.length; i++) {
      const group = digits[i];
      for (let j = 0; j < group.length; j++) {
        const digitElement = createDigitElement();
        digitElement.textContent = group[j];
        container.appendChild(digitElement);
      }
      if (i < digits.length - 1) {
        container.appendChild(createCommaElement());
      }
    }

    let elementIndex = 0;
    for (let i = 0; i < digits.length; i++) {
      const group = digits[i];
      for (let j = 0; j < group.length; j++) {
        const digitElement = container.children[elementIndex];
        const newDigit = parseInt(group[j]);
        const currentDigit = parseInt(digitElement.textContent || '0');

        if (currentDigit !== newDigit) {
          animateDigit(digitElement, currentDigit, newDigit);
        }
        elementIndex++;
      }
      if (i < digits.length - 1) {
        elementIndex++;
      }
    }
  }

  function animateDigit(element, start, end) {
    const duration = 1000;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = Math.round(start + (end - start) * easeOutQuart);
      element.textContent = current;

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  }

  function showContent(overlay) {
    const spinnerContainer = overlay.querySelector('.spinner-container');
    if (spinnerContainer) {
      spinnerContainer.remove();
    }

    const containers = overlay.querySelectorAll('div[style*="visibility: hidden"]');
    containers.forEach(container => {
      container.style.visibility = 'visible';
    });

    const icons = overlay.querySelectorAll('svg[style*="display: none"]');
    icons.forEach(icon => {
      icon.style.display = 'block';
    });
  }

  function updateDifferenceElement(element, currentValue, previousValue) {
    if (!previousValue) return;

    const difference = currentValue - previousValue;
    if (difference === 0) {
      element.textContent = '';
      return;
    }

    const sign = difference > 0 ? '+' : '';
    element.textContent = `${sign}${difference.toLocaleString()}`;
    element.style.color = difference > 0 ? '#1ed760' : '#f3727f';

    setTimeout(() => {
      element.textContent = '';
    }, 1000);
  }

  function updateDisplayState() {
    const overlay = document.querySelector('.channel-banner-overlay');
    if (!overlay) return;

    const statContainers = overlay.querySelectorAll('div[style*="width"]');
    if (!statContainers.length) return;

    let visibleCount = 0;
    const visibleContainers = [];

    statContainers.forEach(container => {
      const numberContainer = container.querySelector('[class$="-number"]');
      if (!numberContainer) return;

      const type = numberContainer.className.replace('-number', '');

      const isVisible = localStorage.getItem(`show-${type}`) !== 'false';

      if (isVisible) {
        container.style.display = 'flex';
        visibleCount++;
        visibleContainers.push(container);
      } else {
        container.style.display = 'none';
      }
    });

    visibleContainers.forEach(container => {
      container.style.width = '';
      container.style.margin = '';

      switch (visibleCount) {
        case 1:
          container.style.width = '100%';
          break;
        case 2:
          container.style.width = '50%';
          break;
        case 3:
          container.style.width = '33.33%';
          break;
        default:
          container.style.display = 'none';
      }
    });

    // Only update font size and font family for .subscribers-number, .views-number, .videos-number
    const fontSize = localStorage.getItem('youtubeEnhancerFontSize') || '24';
    const fontFamily = localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif';
    overlay.querySelectorAll('.subscribers-number,.views-number,.videos-number').forEach(el => {
      el.style.fontSize = `${fontSize}px`;
      el.style.fontFamily = fontFamily;
    });

    overlay.style.display = 'flex';
  }

  async function updateOverlayContent(overlay, channelName) {
    if (state.isUpdating || channelName !== state.currentChannelName) return;
    state.isUpdating = true;

    try {
      const channelId = await fetchChannelId(channelName);
      const stats = await fetchChannelStats(channelId);

      // Check if channel changed during async operations
      if (channelName !== state.currentChannelName) {
        state.isUpdating = false;
        return;
      }

      if (stats.error) {
        const containers = overlay.querySelectorAll('[class$="-number"]');
        containers.forEach(container => {
          if (container.classList.contains('subscribers-number') && stats.followerCount > 0) {
            updateDigits(container, stats.followerCount);
          } else {
            container.textContent = '---';
          }
        });
        utils.warn('Using fallback stats due to API error');
        return;
      }

      const updateElement = (className, value, label) => {
        const numberContainer = overlay.querySelector(`.${className}-number`);
        const differenceElement = overlay.querySelector(`.${className}-difference`);
        const labelElement = overlay.querySelector(`.${className}-label`);

        if (numberContainer) {
          updateDigits(numberContainer, value);
        }

        if (differenceElement && state.previousStats.has(channelId)) {
          const previousValue =
            className === 'subscribers'
              ? state.previousStats.get(channelId).followerCount
              : state.previousStats.get(channelId).bottomOdos[className === 'views' ? 0 : 1];
          updateDifferenceElement(differenceElement, value, previousValue);
        }

        if (labelElement) {
          labelElement.textContent = label;
        }
      };

      updateElement('subscribers', stats.followerCount, 'Subscribers');
      updateElement('views', stats.bottomOdos[0], 'Views');
      updateElement('videos', stats.bottomOdos[1], 'Videos');

      if (!state.previousStats.has(channelId)) {
        showContent(overlay);
        utils.log('Displayed initial stats for channel:', channelName);
      }

      state.previousStats.set(channelId, stats);
    } catch (error) {
      utils.error('Failed to update overlay content:', error);
      const containers = overlay.querySelectorAll('[class$="-number"]');
      containers.forEach(container => {
        container.textContent = '---';
      });
    } finally {
      state.isUpdating = false;
    }
  }

  // Add settings UI to experimental section
  function addSettingsUI() {
    const section = document.querySelector(
      '.ytp-plus-settings-section[data-section="experimental"]'
    );
    if (!section || section.querySelector('.count-settings-item')) return;

    const item = document.createElement('div');
    item.className = 'ytp-plus-settings-item count-settings-item';
    item.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Channel Stats</label>
          <div class="ytp-plus-settings-item-description">Show live subscriber/views/videos overlay on channel banner</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" ${state.enabled ? 'checked' : ''}>
      `;
    section.appendChild(item);

    item.querySelector('input').addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      state.enabled = target.checked;
      localStorage.setItem(CONFIG.STORAGE_KEY, state.enabled ? 'true' : 'false');
      if (!state.enabled) {
        clearExistingOverlay();
      } else {
        observePageChanges();
        addNavigationListener();
        setTimeout(() => {
          const bannerElement = document.getElementById('page-header-banner-sizer');
          if (bannerElement && isChannelPage()) {
            addOverlay(bannerElement);
          }
        }, 100);
      }
    });
  }

  // Observe settings modal for experimental section
  const settingsObserver = new MutationObserver(mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addSettingsUI, 100);
          return;
        }
      }
    }
    if (document.querySelector('.ytp-plus-settings-nav-item[data-section="experimental"].active')) {
      setTimeout(addSettingsUI, 50);
    }
  });
  YouTubeUtils.cleanupManager.registerObserver(settingsObserver);

  // ✅ Safe observe with document.body check
  if (document.body) {
    settingsObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      settingsObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  const experimentalNavClickHandler = e => {
    const target = /** @type {EventTarget & HTMLElement} */ (e.target);
    if (
      target.classList?.contains('ytp-plus-settings-nav-item') &&
      target.dataset?.section === 'experimental'
    ) {
      setTimeout(addSettingsUI, 50);
    }
  };

  const listenerKey = YouTubeUtils.cleanupManager.registerListener(
    document,
    'click',
    experimentalNavClickHandler,
    true
  );
  state.documentListenerKeys.add(listenerKey);

  function addOverlay(bannerElement) {
    // Improved channel name extraction with better URL parsing
    let channelName = null;
    const pathname = window.location.pathname;

    if (pathname.startsWith('/@')) {
      channelName = pathname.split('/')[1].replace('@', '');
    } else if (pathname.startsWith('/channel/')) {
      channelName = pathname.split('/')[2];
    } else if (pathname.startsWith('/c/')) {
      channelName = pathname.split('/')[2];
    } else if (pathname.startsWith('/user/')) {
      channelName = pathname.split('/')[2];
    }

    // Skip if no valid channel name or already processing the same channel
    if (!channelName || (channelName === state.currentChannelName && state.overlay)) {
      return;
    }

    // Ensure banner element is properly positioned
    if (bannerElement && !bannerElement.style.position) {
      bannerElement.style.position = 'relative';
    }

    state.currentChannelName = channelName;
    state.overlay = createOverlay(bannerElement);

    if (state.overlay) {
      // Clear existing interval
      if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
      }

      // Debounced update function for better performance
      let lastUpdateTime = 0;
      const debouncedUpdate = () => {
        const now = Date.now();
        if (now - lastUpdateTime >= state.updateInterval - 100) {
          updateOverlayContent(state.overlay, channelName);
          lastUpdateTime = now;
        }
      };

      // Set up interval with debouncing
      state.intervalId = setInterval(debouncedUpdate, state.updateInterval);

      // ✅ Register interval in cleanupManager
      YouTubeUtils.cleanupManager.registerInterval(state.intervalId);

      // Initial update
      updateOverlayContent(state.overlay, channelName);
      utils.log('Added overlay for channel:', channelName);
    }
  }

  function isChannelPage() {
    return (
      window.location.pathname.startsWith('/@') ||
      window.location.pathname.startsWith('/channel/') ||
      window.location.pathname.startsWith('/c/')
    );
  }

  function observePageChanges() {
    if (!state.enabled) return;

    // More robust banner detection with multiple fallback selectors
    const observer = new MutationObserver(_mutations => {
      // Throttle observations for better performance
      if (/** @type {any} */ (observer)._timeout) {
        YouTubeUtils.cleanupManager.unregisterTimeout(/** @type {any} */(observer)._timeout);
        clearTimeout(/** @type {any} */(observer)._timeout);
      }

      /** @type {any} */ (observer)._timeout = YouTubeUtils.cleanupManager.registerTimeout(
        setTimeout(() => {
          let bannerElement = document.getElementById('page-header-banner-sizer');

          // Try alternative selectors if main one fails
          if (!bannerElement) {
            const alternatives = [
              '[id*="banner"]',
              '.ytd-c4-tabbed-header-renderer',
              '#channel-header',
              '.channel-header',
            ];

            for (const selector of alternatives) {
              bannerElement = document.querySelector(selector);
              if (bannerElement) break;
            }
          }

          if (bannerElement && isChannelPage()) {
            // Ensure banner has proper positioning
            if (bannerElement.style.position !== 'relative') {
              bannerElement.style.position = 'relative';
            }
            addOverlay(bannerElement);
          } else if (!isChannelPage()) {
            // Clean up when not on channel page
            clearExistingOverlay();
            state.currentChannelName = null;
          }
        }, 100)
      ); // Small delay to batch rapid changes
    });

    // ✅ Safe observe with document.body check
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false, // Reduce observation scope for performance
      });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: false,
        });
      });
    }

    // Store timeout reference for cleanup
    /** @type {any} */ (observer)._timeout = null;

    // Store observer for cleanup on page unload
    if (typeof state.observers === 'undefined') {
      state.observers = [];
    }
    state.observers.push(observer);

    return observer;
  }

  function addNavigationListener() {
    if (!state.enabled) return;

    window.addEventListener('yt-navigate-finish', () => {
      if (!isChannelPage()) {
        clearExistingOverlay();
        state.currentChannelName = null;
        utils.log('Navigated away from channel page');
      } else {
        const bannerElement = document.getElementById('page-header-banner-sizer');
        if (bannerElement) {
          addOverlay(bannerElement);
          utils.log('Navigated to channel page');
        }
      }
    });
  }

  // Cleanup function for page unload
  function cleanup() {
    // Disconnect all observers
    if (state.observers && Array.isArray(state.observers)) {
      state.observers.forEach(observer => {
        try {
          observer.disconnect();
        } catch (e) {
          console.warn('[YouTube+] Failed to disconnect observer:', e);
        }
      });
      state.observers = [];
    }

    // Clear overlay and intervals
    clearExistingOverlay();

    utils.log('Cleanup completed');
  }

  // Register cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

  init();
})();

// --- MODULE: pip.js ---

// YouTube Picture-in-Picture settings
(function () {
  'use strict';

  /**
   * PiP settings configuration
   * @type {Object}
   * @property {boolean} enabled - Whether PiP is enabled
   * @property {Object} shortcut - Keyboard shortcut configuration
   * @property {string} storageKey - LocalStorage key for persistence
   */
  const pipSettings = {
    enabled: true,
    shortcut: { key: 'P', shiftKey: true, altKey: false, ctrlKey: false },
    storageKey: 'youtube_pip_settings',
  };

  const PIP_SESSION_KEY = 'youtube_plus_pip_session';

  const getVideoElement = () => {
    const candidate =
      (typeof YouTubeUtils?.querySelector === 'function' && YouTubeUtils.querySelector('video')) ||
      document.querySelector('video');

    if (candidate && candidate.tagName && candidate.tagName.toLowerCase() === 'video') {
      return /** @type {HTMLVideoElement} */ (candidate);
    }

    return null;
  };

  const waitForMetadata = video => {
    if (!video) return Promise.reject(new Error('No video element available'));

    if (video.readyState >= 1 && !video.seeking) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };

      const onLoaded = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Video metadata failed to load'));
      };

      let timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Timed out waiting for video metadata'));
      }, 3000);

      const registeredTimeout = YouTubeUtils?.cleanupManager?.registerTimeout?.(timeoutId);
      if (registeredTimeout) {
        timeoutId = registeredTimeout;
      }

      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  };

  const setSessionActive = isActive => {
    try {
      if (isActive) {
        sessionStorage.setItem(PIP_SESSION_KEY, 'true');
      } else {
        sessionStorage.removeItem(PIP_SESSION_KEY);
      }
    } catch { }
  };

  const wasSessionActive = () => {
    try {
      return sessionStorage.getItem(PIP_SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  };

  /**
   * Load settings from localStorage
   * @returns {void}
   */
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(pipSettings.storageKey);
      if (saved) Object.assign(pipSettings, JSON.parse(saved));
    } catch (e) {
      console.error('Error loading PiP settings:', e);
    }
  };

  /**
   * Save settings to localStorage
   * @returns {void}
   */
  const saveSettings = () => {
    try {
      localStorage.setItem(pipSettings.storageKey, JSON.stringify(pipSettings));
    } catch (e) {
      console.error('Error saving PiP settings:', e);
    }
  };

  /**
   * Get current PiP element as HTMLVideoElement when available
   * @returns {HTMLVideoElement|null}
   */
  const getCurrentPiPElement = () => {
    const current = document.pictureInPictureElement;
    if (current && typeof current === 'object' && 'tagName' in current) {
      const tag = /** @type {{ tagName?: string }} */ (current).tagName;
      if (typeof tag === 'string' && tag.toLowerCase() === 'video') {
        return /** @type {HTMLVideoElement} */ (/** @type {unknown} */ (current));
      }
    }
    return null;
  };

  /**
   * Toggle Picture-in-Picture mode
   * @param {HTMLVideoElement} video - The video element
   * @returns {Promise<void>}
   */
  const togglePictureInPicture = async video => {
    if (!pipSettings.enabled || !video) return;

    try {
      const currentPiP = getCurrentPiPElement();

      if (currentPiP && currentPiP !== video) {
        await document.exitPictureInPicture();
        setSessionActive(false);
      }

      if (getCurrentPiPElement() === video) {
        await document.exitPictureInPicture();
        setSessionActive(false);
        return;
      }

      if (video.disablePictureInPicture) {
        throw new Error('Picture-in-Picture is disabled by the video element');
      }

      await waitForMetadata(video);

      await video.requestPictureInPicture();
      setSessionActive(true);
    } catch (error) {
      console.error('[YouTube+][PiP] Failed to toggle Picture-in-Picture:', error);
    }
  };

  /**
   * Add PiP settings UI to advanced settings modal
   * @returns {void}
   */
  const addPipSettingsToModal = () => {
    // ✅ Use cached querySelector
    const advancedSection = YouTubeUtils.querySelector(
      '.ytp-plus-settings-section[data-section="advanced"]'
    );
    if (!advancedSection || YouTubeUtils.querySelector('.pip-settings-item')) return;

    // Add styles if they don't exist
    // ✅ Use StyleManager instead of createElement('style')
    if (!document.getElementById('pip-styles')) {
      const styles = `
          .pip-shortcut-editor { display: flex; align-items: center; gap: 8px; }
          .pip-shortcut-editor select, #pip-key {background: rgba(34, 34, 34, var(--yt-header-bg-opacity)); color: var(--yt-spec-text-primary); border: 1px solid var(--yt-spec-10-percent-layer); border-radius: var(--yt-radius-sm); padding: 4px;}
        `;
      YouTubeUtils.StyleManager.add('pip-styles', styles);
    }

    // Enable/disable toggle
    const enableItem = document.createElement('div');
    enableItem.className = 'ytp-plus-settings-item pip-settings-item';
    enableItem.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Picture-in-Picture</label>
          <div class="ytp-plus-settings-item-description">Add Picture-in-Picture functionality with keyboard shortcut</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enablePiP" id="pip-enable-checkbox" ${pipSettings.enabled ? 'checked' : ''}>
      `;
    advancedSection.appendChild(enableItem);

    // Shortcut settings
    const shortcutItem = document.createElement('div');
    shortcutItem.className = 'ytp-plus-settings-item pip-shortcut-item';
    shortcutItem.style.display = pipSettings.enabled ? 'flex' : 'none';

    const { ctrlKey, altKey, shiftKey } = pipSettings.shortcut;
    const modifierValue =
      ctrlKey && altKey && shiftKey
        ? 'ctrl+alt+shift'
        : ctrlKey && altKey
          ? 'ctrl+alt'
          : ctrlKey && shiftKey
            ? 'ctrl+shift'
            : altKey && shiftKey
              ? 'alt+shift'
              : ctrlKey
                ? 'ctrl'
                : altKey
                  ? 'alt'
                  : shiftKey
                    ? 'shift'
                    : 'none';

    shortcutItem.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">PiP Keyboard Shortcut</label>
          <div class="ytp-plus-settings-item-description">Customize keyboard combination to toggle PiP mode</div>
        </div>
        <div class="pip-shortcut-editor">
          <select id="pip-modifier-combo">
            ${[
        'none',
        'ctrl',
        'alt',
        'shift',
        'ctrl+alt',
        'ctrl+shift',
        'alt+shift',
        'ctrl+alt+shift',
      ]
        .map(
          v =>
            `<option value="${v}" ${v === modifierValue ? 'selected' : ''}>${v === 'none'
              ? 'None'
              : v
                .replace(/\+/g, '+')
                .split('+')
                .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                .join('+')
            }</option>`
        )
        .join('')}
          </select>
          <span>+</span>
          <input type="text" id="pip-key" value="${pipSettings.shortcut.key}" maxlength="1" style="width: 30px; text-align: center;">
        </div>
      `;
    advancedSection.appendChild(shortcutItem);

    // Event listeners
    document.getElementById('pip-enable-checkbox').addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      pipSettings.enabled = target.checked;
      shortcutItem.style.display = pipSettings.enabled ? 'flex' : 'none';
      saveSettings();
    });

    document.getElementById('pip-modifier-combo').addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLSelectElement} */ (e.target);
      const value = target.value;
      pipSettings.shortcut.ctrlKey = value.includes('ctrl');
      pipSettings.shortcut.altKey = value.includes('alt');
      pipSettings.shortcut.shiftKey = value.includes('shift');
      saveSettings();
    });

    document.getElementById('pip-key').addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      if (target.value) {
        pipSettings.shortcut.key = target.value.toUpperCase();
        saveSettings();
      }
    });

    document.getElementById('pip-key').addEventListener('keydown', e => e.stopPropagation());
  };

  // Initialize
  loadSettings();

  // Event listeners
  document.addEventListener('keydown', e => {
    if (!pipSettings.enabled) return;
    const { shiftKey, altKey, ctrlKey, key } = pipSettings.shortcut;
    if (
      e.shiftKey === shiftKey &&
      e.altKey === altKey &&
      e.ctrlKey === ctrlKey &&
      e.key.toUpperCase() === key
    ) {
      // ✅ Use cached querySelector and guard by tagName to avoid referencing DOM lib types in TS
      const video = getVideoElement();
      if (video) {
        void togglePictureInPicture(video);
      }
      e.preventDefault();
    }
  });

  window.addEventListener('storage', e => {
    if (e.key === pipSettings.storageKey) {
      loadSettings();
    }
  });

  window.addEventListener('load', () => {
    if (!pipSettings.enabled || !wasSessionActive() || document.pictureInPictureElement) {
      return;
    }

    const resumePiP = () => {
      const video = getVideoElement();
      if (!video) return;

      togglePictureInPicture(video).catch(() => {
        // If resume fails we reset the session flag to avoid loops
        setSessionActive(false);
      });
    };

    const ensureCleanup = handler => {
      if (!handler) return;
      try {
        document.removeEventListener('pointerdown', handler, true);
      } catch { }
    };

    const cleanupListeners = () => {
      ensureCleanup(pointerListener);
      ensureCleanup(keyListener);
    };

    const pointerListener = () => {
      cleanupListeners();
      resumePiP();
    };

    const keyListener = () => {
      cleanupListeners();
      resumePiP();
    };

    document.addEventListener('pointerdown', pointerListener, { once: true, capture: true });
    document.addEventListener('keydown', keyListener, { once: true, capture: true });
  });

  // DOM observers for the settings modal
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addPipSettingsToModal, 100);
        }
      }
    }

    document.addEventListener('leavepictureinpicture', () => {
      setSessionActive(false);
    });
    // Check for section changes - ✅ Use cached querySelector
    if (YouTubeUtils.querySelector('.ytp-plus-settings-nav-item[data-section="advanced"].active')) {
      // If advanced section is active and our settings aren't there yet, add them
      if (!YouTubeUtils.querySelector('.pip-settings-item')) {
        setTimeout(addPipSettingsToModal, 50);
      }
    }
  });

  // ✅ Register observer in cleanupManager
  YouTubeUtils.cleanupManager.registerObserver(observer);

  // ✅ Safe observe with document.body check
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // ✅ Register global click listener in cleanupManager
  const clickHandler = e => {
    const target = /** @type {EventTarget & HTMLElement} */ (e.target);
    if (target.classList && target.classList.contains('ytp-plus-settings-nav-item')) {
      if (target.dataset?.section === 'advanced') {
        setTimeout(addPipSettingsToModal, 50);
      }
    }
  };
  YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);
})();

// --- MODULE: timecode.js ---

// YouTube Timecode Panel
(function () {
  'use strict';

  // Early exit for embeds to prevent duplicate panels - ✅ Use cached querySelector
  if (window.location.hostname !== 'www.youtube.com' || window.frameElement) {
    return;
  }

  // Prevent multiple initializations
  if (window._timecodeModuleInitialized) return;
  window._timecodeModuleInitialized = true;

  // Configuration
  const config = {
    enabled: true,
    autoDetect: true,
    shortcut: { key: 'T', shiftKey: true, altKey: false, ctrlKey: false },
    storageKey: 'youtube_timecode_settings',
    autoSave: true,
    autoTrackPlayback: true,
    panelPosition: null,
    export: true,
  };

  // State management
  const state = {
    timecodes: new Map(),
    dom: {},
    isReloading: false,
    activeIndex: null,
    trackingId: 0,
    dragging: false,
    editingIndex: null,
    resizeListenerKey: null,
  };

  let initStarted = false;

  const scheduleInitRetry = () => {
    const timeoutId = setTimeout(init, 250);
    YouTubeUtils.cleanupManager?.registerTimeout?.(timeoutId);
  };

  // Utilities
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(config.storageKey);
      if (saved) Object.assign(config, JSON.parse(saved));
    } catch { }
  };

  const saveSettings = () => {
    try {
      localStorage.setItem(config.storageKey, JSON.stringify(config));
    } catch { }
  };

  const clampPanelPosition = (panel, left, top) => {
    if (!panel) return { left: 0, top: 0 };

    const rect = panel.getBoundingClientRect();
    const width = rect.width || panel.offsetWidth || 0;
    const height = rect.height || panel.offsetHeight || 0;

    const maxLeft = Math.max(0, window.innerWidth - width);
    const maxTop = Math.max(0, window.innerHeight - height);

    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  };

  const savePanelPosition = (left, top) => {
    config.panelPosition = { left, top };
    saveSettings();
  };

  const applySavedPanelPosition = panel => {
    if (!panel || !config.panelPosition) return;

    requestAnimationFrame(() => {
      const { left, top } = clampPanelPosition(
        panel,
        config.panelPosition.left,
        config.panelPosition.top
      );
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
    });
  };

  const showNotification = (message, duration = 2000, type = 'info') => {
    YouTubeUtils.NotificationManager.show(message, { duration, type });
  };

  // Time utilities
  const formatTime = seconds => {
    if (isNaN(seconds)) return '00:00';
    seconds = Math.round(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const parseTime = timeStr => {
    if (!timeStr) return null;
    const str = timeStr.trim();

    // Handle HH:MM:SS format
    let match = str.match(/^(\d+):(\d{1,2}):(\d{2})$/);
    if (match) {
      const [, h, m, s] = match.map(Number);
      return m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
    }

    // Handle MM:SS format
    match = str.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const [, m, s] = match.map(Number);
      return m < 60 && s < 60 ? m * 60 + s : null;
    }

    return null;
  };

  // Timecode extraction
  const extractTimecodes = text => {
    if (!text) return [];

    const timecodes = [];
    const seen = new Set();
    const patterns = [
      /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(.+?)$/gm,
      /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+?)$/gm,
      /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:]\s*([^\n\r]{1,100}?)(?=\s*\d{1,2}:\d{2}|\s*$)/g,
      /(\d{1,2}:\d{2}(?::\d{2})?)\s*[–—-]\s*([^\n]+)/gm,
      /^(\d{1,2}:\d{2}(?::\d{2})?)\s*(.+)$/gm,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const time = parseTime(match[1]);
        if (time !== null && !seen.has(time)) {
          seen.add(time);
          const label = (match[2] || formatTime(time))
            .trim()
            .replace(/^\d+[\.\)]\s*/, '')
            .substring(0, 100);
          if (label) {
            timecodes.push({ time, label, originalText: match[1] });
          }
        }
      }
    }

    return timecodes.sort((a, b) => a.time - b.time);
  };

  const DESCRIPTION_SELECTORS = [
    '#description-inline-expander yt-attributed-string',
    '#description-inline-expander yt-formatted-string',
    '#description-inline-expander ytd-text-inline-expander',
    '#description-inline-expander .yt-core-attributed-string',
    '#description ytd-text-inline-expander',
    '#description ytd-expandable-video-description-body-renderer',
    '#description.ytd-watch-metadata yt-formatted-string',
    '#description.ytd-watch-metadata #description-inline-expander',
    '#tab-info ytd-expandable-video-description-body-renderer yt-formatted-string',
    '#tab-info ytd-expandable-video-description-body-renderer yt-attributed-string',
    '#structured-description ytd-text-inline-expander',
    '#structured-description yt-formatted-string',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"] yt-formatted-string',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"] yt-attributed-string',
    'ytd-watch-metadata #description',
    'ytd-watch-metadata #description-inline-expander',
    '#description',
  ];

  const DESCRIPTION_SELECTOR_COMBINED = DESCRIPTION_SELECTORS.join(',');

  const DESCRIPTION_EXPANDERS = [
    '#description-inline-expander yt-button-shape button',
    '#description-inline-expander tp-yt-paper-button#expand',
    '#description-inline-expander tp-yt-paper-button[aria-label]',
    'ytd-watch-metadata #description-inline-expander yt-button-shape button',
    'ytd-text-inline-expander[collapsed] yt-button-shape button',
    'ytd-text-inline-expander[collapsed] tp-yt-paper-button#expand',
    'ytd-expandable-video-description-body-renderer #expand',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"] #expand',
  ];

  const sleep = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));

  const collectDescriptionText = () => {
    const snippets = [];
    DESCRIPTION_SELECTORS.forEach(selector => {
      document.querySelectorAll(selector).forEach(node => {
        const text = node?.textContent?.trim();
        if (text) {
          snippets.push(text);
        }
      });
    });
    return snippets.join('\n');
  };

  const expandDescriptionIfNeeded = async () => {
    for (const selector of DESCRIPTION_EXPANDERS) {
      const button = document.querySelector(selector);
      if (!button) continue;

      const ariaExpanded = button.getAttribute('aria-expanded');
      if (ariaExpanded === 'true') return false;

      const ariaLabel = button.getAttribute('aria-label')?.toLowerCase();
      if (ariaLabel && ariaLabel.includes('less')) return false;

      if (button.offsetParent !== null) {
        try {
          /** @type {HTMLElement} */ (button).click();
          await sleep(400);
          return true;
        } catch (error) {
          console.warn('[Timecode] Failed to click expand button:', error);
        }
      }
    }

    const inlineExpander = document.querySelector('ytd-text-inline-expander[collapsed]');
    if (inlineExpander) {
      try {
        inlineExpander.removeAttribute('collapsed');
      } catch (error) {
        YouTubeUtils.logError('TimecodePanel', 'Failed to expand description', error);
      }
      await sleep(300);
      return true;
    }

    return false;
  };

  const ensureDescriptionReady = async () => {
    const initialText = collectDescriptionText();
    if (initialText) return;

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await YouTubeUtils.waitForElement(DESCRIPTION_SELECTOR_COMBINED, 1500);
      } catch {
        // Continue trying
      }

      await sleep(200);
      const expanded = await expandDescriptionIfNeeded();

      await sleep(expanded ? 500 : 200);
      const text = collectDescriptionText();

      if (text && text.length > initialText.length) {
        return;
      }
    }
  };
  const getCurrentVideoId = () => new URLSearchParams(window.location.search).get('v');

  // Detection
  const detectTimecodes = async (options = {}) => {
    const { force = false } = options;

    if (!config.enabled) return [];
    if (!force && !config.autoDetect) return [];

    const videoId = getCurrentVideoId();
    if (!videoId) return [];

    const cacheKey = `detect_${videoId}`;
    if (!force && state.timecodes.has(cacheKey)) {
      const cached = state.timecodes.get(cacheKey);
      if (Array.isArray(cached) && cached.length) {
        return cached;
      }
      state.timecodes.delete(cacheKey);
    }

    await ensureDescriptionReady();

    const uniqueMap = new Map();
    const descriptionText = collectDescriptionText();

    if (descriptionText) {
      const extracted = extractTimecodes(descriptionText);
      extracted.forEach(tc => {
        if (tc.time >= 0 && tc.label?.trim()) {
          uniqueMap.set(tc.time.toString(), tc);
        }
      });
    }

    // Get native chapters
    const chapters = getYouTubeChapters();

    chapters.forEach(chapter => {
      if (chapter.time >= 0 && chapter.label?.trim()) {
        uniqueMap.set(chapter.time.toString(), chapter);
      }
    });

    const result = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
    const hadExistingItems = state.dom.list?.childElementCount > 0;

    if (result.length > 0) {
      updateTimecodePanel(result);
      state.timecodes.set(cacheKey, result);
      if (config.autoSave) saveTimecodesToStorage(result);
    } else {
      if (force || !hadExistingItems) {
        updateTimecodePanel([]);
      }
      if (force) {
        state.timecodes.delete(cacheKey);
      }
    }

    return result;
  };

  const reloadTimecodes = async (buttonOverride = null) => {
    const button =
      buttonOverride || state.dom.reloadButton || document.getElementById('timecode-reload');

    if (state.isReloading || !config.enabled) return;

    state.isReloading = true;
    if (button) {
      button.disabled = true;
      button.classList.add('loading');
    }

    try {
      const result = await detectTimecodes({ force: true });

      if (Array.isArray(result) && result.length) {
        showNotification(`Найдено таймкодов: ${result.length}`);
      } else {
        updateTimecodePanel([]);
        showNotification('Таймкоды не найдены');
      }
    } catch (error) {
      YouTubeUtils.logError('TimecodePanel', 'Reload failed', error);
      showNotification('Ошибка при обновлении таймкодов');
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('loading');
      }
      state.isReloading = false;
    }
  };

  const getYouTubeChapters = () => {
    // Расширенный поиск глав/эпизодов
    const selectors = [
      'ytd-macro-markers-list-item-renderer',
      'ytd-chapter-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id*="description-chapters"] ytd-macro-markers-list-item-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id*="description-chapters"] #details',
      '#structured-description ytd-horizontal-card-list-renderer ytd-macro-markers-list-item-renderer',
    ];

    const items = document.querySelectorAll(selectors.join(', '));
    const chapters = new Map();

    items.forEach(item => {
      // Попробуем разные способы извлечения времени и заголовка
      const timeSelectors = ['.time-info', '.timestamp', '#time', 'span[id*="time"]'];
      const titleSelectors = ['.marker-title', '.chapter-title', '#details', 'h4', '.title'];

      let timeText = null;
      for (const sel of timeSelectors) {
        const el = item.querySelector(sel);
        if (el?.textContent) {
          timeText = el.textContent;
          break;
        }
      }

      let titleText = null;
      for (const sel of titleSelectors) {
        const el = item.querySelector(sel);
        if (el?.textContent) {
          titleText = el.textContent;
          break;
        }
      }

      if (timeText) {
        const time = parseTime(timeText.trim());
        if (time !== null) {
          // Очищаем заголовок от лишних пробелов и переносов строк
          const cleanTitle = titleText?.trim().replace(/\s+/g, ' ') || formatTime(time);
          chapters.set(time.toString(), {
            time,
            label: cleanTitle,
            isChapter: true,
          });
        }
      }
    });
    const result = Array.from(chapters.values()).sort((a, b) => a.time - b.time);
    return result;
  };

  // Settings panel
  const addTimecodePanelSettings = () => {
    // ✅ Use cached querySelector
    const advancedSection = YouTubeUtils.querySelector(
      '.ytp-plus-settings-section[data-section="advanced"]'
    );
    if (!advancedSection || YouTubeUtils.querySelector('.timecode-settings-item')) return;

    const { ctrlKey, altKey, shiftKey } = config.shortcut;
    const modifierValue =
      [
        ctrlKey && altKey && shiftKey && 'ctrl+alt+shift',
        ctrlKey && altKey && 'ctrl+alt',
        ctrlKey && shiftKey && 'ctrl+shift',
        altKey && shiftKey && 'alt+shift',
        ctrlKey && 'ctrl',
        altKey && 'alt',
        shiftKey && 'shift',
      ].find(Boolean) || 'none';

    const enableDiv = document.createElement('div');
    enableDiv.className = 'ytp-plus-settings-item timecode-settings-item';
    enableDiv.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Timecode Panel</label>
          <div class="ytp-plus-settings-item-description">Enable video timecode/chapter panel with quick navigation</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enabled" ${config.enabled ? 'checked' : ''}>
      `;

    const shortcutDiv = document.createElement('div');
    shortcutDiv.className = 'ytp-plus-settings-item timecode-settings-item timecode-shortcut-item';
    shortcutDiv.style.display = config.enabled ? 'flex' : 'none';
    shortcutDiv.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Keyboard Shortcut</label>
          <div class="ytp-plus-settings-item-description">Customize keyboard combination to toggle Timecode Panel</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <select id="timecode-modifier-combo" style="background: rgba(34, 34, 34, 0.6); color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 4px;">
            ${[
        'none',
        'ctrl',
        'alt',
        'shift',
        'ctrl+alt',
        'ctrl+shift',
        'alt+shift',
        'ctrl+alt+shift',
      ]
        .map(
          v =>
            `<option value="${v}" ${v === modifierValue ? 'selected' : ''}>${v === 'none'
              ? 'None'
              : v
                .split('+')
                .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                .join('+')
            }</option>`
        )
        .join('')}
          </select>
          <span>+</span>
          <input type="text" id="timecode-key" value="${config.shortcut.key}" maxlength="1" style="width: 30px; text-align: center; background: rgba(34, 34, 34, 0.6); color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 4px;">
        </div>
      `;

    advancedSection.append(enableDiv, shortcutDiv);

    // Event listeners
    advancedSection.addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (target.matches && target.matches('.ytp-plus-settings-checkbox[data-setting="enabled"]')) {
        config.enabled = /** @type {HTMLInputElement} */ (target).checked;
        shortcutDiv.style.display = config.enabled ? 'flex' : 'none';
        toggleTimecodePanel(config.enabled);
        saveSettings();
      }
    });

    document.getElementById('timecode-modifier-combo')?.addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLSelectElement} */ (e.target);
      const value = target.value;
      config.shortcut.ctrlKey = value.includes('ctrl');
      config.shortcut.altKey = value.includes('alt');
      config.shortcut.shiftKey = value.includes('shift');
      saveSettings();
    });

    document.getElementById('timecode-key')?.addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      if (target.value) {
        config.shortcut.key = target.value.toUpperCase();
        saveSettings();
      }
    });
  };

  // CSS
  const insertTimecodeStyles = () => {
    if (document.getElementById('timecode-panel-styles')) return;

    // ✅ Use StyleManager instead of createElement('style')
    const styles = `
                #timecode-panel{position:fixed;right:20px;top:80px;background:rgba(34,34,34,.9);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.4);width:250px;max-height:70vh;z-index:9999;color:#fff;backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);transition:transform .3s,opacity .3s;overflow:hidden;display:flex;flex-direction:column}
                #timecode-panel.hidden{transform:translateX(270px);opacity:0;pointer-events:none}
                #timecode-panel.auto-tracking{border-color:rgba(255,0,0,.5)}
                #timecode-header{display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.3);cursor:move}
                #timecode-title{font-weight:500;margin:0;font-size:14px;user-select:none;display:flex;align-items:center;gap:8px}
                #timecode-tracking-indicator{width:8px;height:8px;background:red;border-radius:50%;opacity:0;transition:opacity .3s}
                #timecode-panel.auto-tracking #timecode-tracking-indicator{opacity:1}
                #timecode-current-time{font-family:monospace;font-size:12px;padding:2px 6px;background:rgba(255,0,0,.3);border-radius:3px;margin-left:auto}
                #timecode-header-controls{display:flex;align-items:center;gap:6px}
                #timecode-reload,#timecode-close{background:0 0;border:none;color:rgba(255,255,255,.7);cursor:pointer;width:24px;height:24px;padding:0;display:flex;align-items:center;justify-content:center;transition:color .2s}
                #timecode-reload:hover,#timecode-close:hover{color:#fff}
                #timecode-reload.loading{animation:timecode-spin .8s linear infinite}
                #timecode-list{overflow-y:auto;padding:8px 0;max-height:calc(70vh - 80px);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent}
                #timecode-list::-webkit-scrollbar{width:6px}
                #timecode-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3);border-radius:3px}
                .timecode-item{padding:8px 12px;display:flex;align-items:center;cursor:pointer;transition:background-color .2s;border-left:3px solid transparent;position:relative}
                .timecode-item:hover{background:rgba(255,255,255,.1)}
                .timecode-item:hover .timecode-actions{opacity:1}
                .timecode-item.active{background:rgba(255,0,0,.25);border-left-color:red}
                .timecode-item.active.pulse{animation:pulse .8s ease-out}
                .timecode-item.editing{background:rgba(255,255,0,.15);border-left-color:#ffaa00}
                .timecode-item.editing .timecode-actions{opacity:1}
                @keyframes pulse{0%{transform:scale(1)}50%{transform:scale(1.02)}100%{transform:scale(1)}}
                @keyframes timecode-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
                .timecode-time{font-family:monospace;margin-right:10px;color:rgba(255,255,255,.8);font-size:13px;min-width:45px}
                .timecode-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;flex:1}
                .timecode-item.has-chapter .timecode-time{color:#ff4444}
                .timecode-progress{width:0;height:2px;background:#ff4444;position:absolute;bottom:0;left:0;transition:width .3s;opacity:.8}
                .timecode-actions{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;gap:4px;opacity:0;transition:opacity .2s;background:rgba(0,0,0,.8);border-radius:4px;padding:2px}
                .timecode-action{background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;padding:4px;font-size:12px;border-radius:2px;transition:color .2s,background-color .2s}
                .timecode-action:hover{color:#fff;background:rgba(255,255,255,.2)}
                .timecode-action.edit:hover{color:#ffaa00}
                .timecode-action.delete:hover{color:#ff4444}
                #timecode-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;text-align:center;color:rgba(255,255,255,.7);font-size:13px}
                #timecode-form{padding:10px;border-top:1px solid rgba(255,255,255,.1);display:none}
                #timecode-form.visible{display:block}
                #timecode-form input{width:100%;margin-bottom:8px;padding:8px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:4px;color:#fff;font-size:13px}
                #timecode-form input::placeholder{color:rgba(255,255,255,.6)}
                #timecode-form-buttons{display:flex;gap:8px;justify-content:flex-end}
                #timecode-form-buttons button{padding:6px 12px;border:none;border-radius:4px;cursor:pointer;font-size:12px;transition:background-color .2s}
                #timecode-form-cancel{background:rgba(255,255,255,.2);color:#fff}
                #timecode-form-cancel:hover{background:rgba(255,255,255,.3)}
                #timecode-form-save{background:#ff4444;color:#fff}
                #timecode-form-save:hover{background:#ff6666}
                #timecode-actions{padding:8px;border-top:1px solid rgba(255,255,255,.1);display:flex;gap:8px;background:rgba(0,0,0,.2)}
                #timecode-actions button{padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;transition:background-color .2s;background:rgba(255,255,255,.2);color:#fff}
                #timecode-actions button:hover{background:rgba(255,255,255,.3)}
                #timecode-track-toggle.active{background:#ff4444!important}
            `;
    YouTubeUtils.StyleManager.add('timecode-panel-styles', styles);
  };

  // Panel creation
  const createTimecodePanel = () => {
    if (state.dom.panel) return state.dom.panel;

    // Remove any existing panels (for redundancy)
    document.querySelectorAll('#timecode-panel').forEach(p => p.remove());

    const panel = document.createElement('div');
    panel.id = 'timecode-panel';
    panel.className = config.enabled ? '' : 'hidden';
    if (config.autoTrackPlayback) panel.classList.add('auto-tracking');

    panel.innerHTML = `
        <div id="timecode-header">
          <h3 id="timecode-title">
            <div id="timecode-tracking-indicator"></div>
            Timecodes
            <span id="timecode-current-time"></span>
          </h3>
          <div id="timecode-header-controls">
            <button id="timecode-reload" title="Reload timecodes" aria-label="Reload timecodes">⟳</button>
            <button id="timecode-close" title="Close" aria-label="Close timecode panel">×</button>
          </div>
        </div>
        <div id="timecode-list"></div>
        <div id="timecode-empty">
          <div>No timecodes found</div>
          <div style="margin-top:5px;font-size:12px">Click + to add current time</div>
        </div>
        <div id="timecode-form">
          <input type="text" id="timecode-form-time" placeholder="Time (e.g., 1:30)">
          <input type="text" id="timecode-form-label" placeholder="Label (optional)">
          <div id="timecode-form-buttons">
            <button type="button" id="timecode-form-cancel">Cancel</button>
            <button type="button" id="timecode-form-save" class="save">Save</button>
          </div>
        </div>
        <div id="timecode-actions">
          <button id="timecode-add-btn">+ Add</button>
          <button id="timecode-export-btn" ${config.export ? '' : 'style="display:none"'}>Export</button>
          <button id="timecode-track-toggle" class="${config.autoTrackPlayback ? 'active' : ''}">${config.autoTrackPlayback ? 'Tracking' : 'Track'}</button>
        </div>
      `;

    // Cache DOM elements
    state.dom = {
      panel,
      list: panel.querySelector('#timecode-list'),
      empty: panel.querySelector('#timecode-empty'),
      form: panel.querySelector('#timecode-form'),
      timeInput: panel.querySelector('#timecode-form-time'),
      labelInput: panel.querySelector('#timecode-form-label'),
      currentTime: panel.querySelector('#timecode-current-time'),
      trackToggle: panel.querySelector('#timecode-track-toggle'),
      reloadButton: panel.querySelector('#timecode-reload'),
    };

    // Event delegation
    panel.addEventListener('click', handlePanelClick);
    makeDraggable(panel);

    document.body.appendChild(panel);
    applySavedPanelPosition(panel);
    return panel;
  };

  // Event handling
  const handlePanelClick = e => {
    const { target } = e;
    const item = target.closest('.timecode-item');

    const reloadButton =
      target.id === 'timecode-reload' ? target : target.closest('#timecode-reload');
    if (reloadButton) {
      e.preventDefault();
      reloadTimecodes(reloadButton);
      return;
    }

    if (target.id === 'timecode-close') {
      toggleTimecodePanel(false);
    } else if (target.id === 'timecode-add-btn') {
      // ✅ Use cached querySelector
      const video = YouTubeUtils.querySelector('video');
      if (video) showTimecodeForm(video.currentTime);
    } else if (target.id === 'timecode-track-toggle') {
      config.autoTrackPlayback = !config.autoTrackPlayback;
      target.textContent = config.autoTrackPlayback ? 'Tracking' : 'Track';
      target.classList.toggle('active', config.autoTrackPlayback);
      state.dom.panel.classList.toggle('auto-tracking', config.autoTrackPlayback);
      saveSettings();
      if (config.autoTrackPlayback) startTracking();
    } else if (target.id === 'timecode-export-btn') {
      exportTimecodes();
    } else if (target.id === 'timecode-form-cancel') {
      hideTimecodeForm();
    } else if (target.id === 'timecode-form-save') {
      saveTimecodeForm();
    } else if (target.classList.contains('timecode-action')) {
      e.stopPropagation();
      const action = target.dataset.action;
      const index = parseInt(target.closest('.timecode-item').dataset.index);

      if (action === 'edit') {
        editTimecode(index);
      } else if (action === 'delete') {
        deleteTimecode(index);
      }
    } else if (item && !target.closest('.timecode-actions')) {
      const time = parseFloat(item.dataset.time);
      const video = document.querySelector('video');
      if (video && !isNaN(time)) {
        /** @type {HTMLVideoElement} */ (video).currentTime = time;
        if (video.paused) video.play();
        updateActiveItem(item);
      }
    }
  };

  // Edit timecode
  const editTimecode = index => {
    const timecodes = getCurrentTimecodes();
    if (index < 0 || index >= timecodes.length) return;

    const timecode = timecodes[index];
    state.editingIndex = index;

    // Update item appearance
    const item = state.dom.list.querySelector(`.timecode-item[data-index="${index}"]`);
    if (item) {
      item.classList.add('editing');
      // Hide other editing items
      state.dom.list.querySelectorAll('.timecode-item.editing').forEach(el => {
        if (el !== item) el.classList.remove('editing');
      });
    }

    showTimecodeForm(timecode.time, timecode.label);
  };

  // Delete timecode
  const deleteTimecode = index => {
    const timecodes = getCurrentTimecodes();
    if (index < 0 || index >= timecodes.length) return;

    const timecode = timecodes[index];

    // Don't allow deletion of native YouTube chapters
    if (timecode.isChapter && !timecode.isUserAdded) {
      showNotification('Cannot delete YouTube chapters');
      return;
    }

    // Confirm deletion
    if (!confirm(`Delete timecode "${timecode.label}"?`)) return;

    timecodes.splice(index, 1);
    updateTimecodePanel(timecodes);
    saveTimecodesToStorage(timecodes);
    showNotification('Timecode deleted');
  };

  // Form handling
  const showTimecodeForm = (currentTime, existingLabel = '') => {
    const { form, timeInput, labelInput } = state.dom;
    form.classList.add('visible');
    timeInput.value = formatTime(currentTime);
    labelInput.value = existingLabel;
    requestAnimationFrame(() => labelInput.focus());
  };

  const hideTimecodeForm = () => {
    state.dom.form.classList.remove('visible');
    state.editingIndex = null;
    // Remove editing class from all items
    state.dom.list?.querySelectorAll('.timecode-item.editing').forEach(el => {
      el.classList.remove('editing');
    });
  };

  const saveTimecodeForm = () => {
    const { timeInput, labelInput } = state.dom;
    const timeValue = timeInput.value.trim();
    const labelValue = labelInput.value.trim();

    const time = parseTime(timeValue);
    if (time === null) {
      showNotification('Invalid time format');
      return;
    }

    const timecodes = getCurrentTimecodes();
    const newTimecode = {
      time,
      label: labelValue || formatTime(time),
      isUserAdded: true,
      isChapter: false,
    };

    if (state.editingIndex !== null) {
      // Editing existing timecode
      const oldTimecode = timecodes[state.editingIndex];
      if (oldTimecode.isChapter && !oldTimecode.isUserAdded) {
        showNotification('Cannot edit YouTube chapters');
        hideTimecodeForm();
        return;
      }

      timecodes[state.editingIndex] = { ...oldTimecode, ...newTimecode };
      showNotification('Timecode updated');
    } else {
      // Adding new timecode
      timecodes.push(newTimecode);
      showNotification('Timecode added');
    }

    const sorted = timecodes.sort((a, b) => a.time - b.time);
    updateTimecodePanel(sorted);
    saveTimecodesToStorage(sorted);
    hideTimecodeForm();
  };

  // Export
  const exportTimecodes = () => {
    const timecodes = getCurrentTimecodes();
    if (!timecodes.length) {
      showNotification('No timecodes to export');
      return;
    }

    const exportBtn = state.dom.panel?.querySelector('#timecode-export-btn');
    if (exportBtn) {
      exportBtn.textContent = 'Copied!';
      exportBtn.style.backgroundColor = 'rgba(0,220,0,0.8)';
      setTimeout(() => {
        exportBtn.textContent = 'Export';
        exportBtn.style.backgroundColor = '';
      }, 2000);
    }

    const videoTitle = document.title.replace(/\s-\sYouTube$/, '');
    let content = `${videoTitle}\n\nTimecodes:\n`;
    timecodes.forEach(tc => (content += `${formatTime(tc.time)} - ${tc.label}\n`));

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(content).then(() => {
        showNotification('Timecodes copied to clipboard');
      });
    }
  };

  // Panel updates
  const updateTimecodePanel = timecodes => {
    const { list, empty } = state.dom;
    if (!list || !empty) return;

    const isEmpty = !timecodes.length;
    empty.style.display = isEmpty ? 'flex' : 'none';
    list.style.display = isEmpty ? 'none' : 'block';

    if (isEmpty) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = timecodes
      .map((tc, i) => {
        const timeStr = formatTime(tc.time);
        const label = (tc.label?.trim() || timeStr).replace(
          /[<>&"']/g,
          c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]
        );
        const isEditable = !tc.isChapter || tc.isUserAdded;

        return `
          <div class="timecode-item ${tc.isChapter ? 'has-chapter' : ''}" data-time="${tc.time}" data-index="${i}">
            <div class="timecode-time">${timeStr}</div>
            <div class="timecode-label" title="${label}">${label}</div>
            <div class="timecode-progress"></div>
            ${isEditable
            ? `
              <div class="timecode-actions">
                <button class="timecode-action edit" data-action="edit" title="Edit">✎</button>
                <button class="timecode-action delete" data-action="delete" title="Delete">✕</button>
              </div>
            `
            : ''
          }
          </div>
        `;
      })
      .join('');
  };

  const updateActiveItem = activeItem => {
    const items = state.dom.list?.querySelectorAll('.timecode-item');
    if (!items) return;

    items.forEach(item => item.classList.remove('active', 'pulse'));
    if (activeItem) {
      activeItem.classList.add('active', 'pulse');
      setTimeout(() => activeItem.classList.remove('pulse'), 800);
    }
  };

  // Tracking
  const startTracking = () => {
    if (state.trackingId) return;

    const track = () => {
      try {
        const video = document.querySelector('video');
        const { panel, currentTime, list } = state.dom;

        // Stop tracking if essential elements are missing or panel is hidden
        if (!video || !panel || panel.classList.contains('hidden') || !config.autoTrackPlayback) {
          if (state.trackingId) {
            cancelAnimationFrame(state.trackingId);
            state.trackingId = 0;
          }
          return;
        }

        // Update current time display
        if (currentTime && !isNaN(video.currentTime)) {
          currentTime.textContent = formatTime(video.currentTime);
        }

        // Update active item
        const items = list?.querySelectorAll('.timecode-item');
        if (items?.length) {
          let activeIndex = -1;
          let nextIndex = -1;

          for (let i = 0; i < items.length; i++) {
            const timeData = items[i].dataset.time;
            if (!timeData) continue;

            const time = parseFloat(timeData);
            if (isNaN(time)) continue;

            if (video.currentTime >= time) {
              activeIndex = i;
            } else if (nextIndex === -1) {
              nextIndex = i;
            }
          }

          // Update active state
          if (state.activeIndex !== activeIndex) {
            // Remove previous active state
            if (state.activeIndex !== null && state.activeIndex >= 0 && items[state.activeIndex]) {
              items[state.activeIndex].classList.remove('active');
            }

            // Set new active state
            if (activeIndex >= 0 && items[activeIndex]) {
              items[activeIndex].classList.add('active');
              try {
                items[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
              } catch {
                // Fallback for browsers that don't support smooth scrolling
                items[activeIndex].scrollIntoView(false);
              }
            }

            state.activeIndex = activeIndex;
          }

          // Update progress bar
          if (activeIndex >= 0 && nextIndex >= 0 && items[activeIndex]) {
            const currentTimeData = items[activeIndex].dataset.time;
            const nextTimeData = items[nextIndex].dataset.time;

            if (currentTimeData && nextTimeData) {
              const current = parseFloat(currentTimeData);
              const next = parseFloat(nextTimeData);

              if (!isNaN(current) && !isNaN(next) && next > current) {
                const progress = ((video.currentTime - current) / (next - current)) * 100;
                const progressEl = items[activeIndex].querySelector('.timecode-progress');
                if (progressEl) {
                  const clampedProgress = Math.min(100, Math.max(0, progress));
                  progressEl.style.width = `${clampedProgress}%`;
                }
              }
            }
          }
        }

        // Continue tracking if enabled
        if (config.autoTrackPlayback) {
          state.trackingId = requestAnimationFrame(track);
        }
      } catch (error) {
        console.warn('Timecode tracking error:', error);
        // Stop tracking on error to prevent infinite error loops
        if (state.trackingId) {
          cancelAnimationFrame(state.trackingId);
          state.trackingId = 0;
        }
      }
    };

    state.trackingId = requestAnimationFrame(track);
  };

  // Stop tracking function
  const stopTracking = () => {
    if (state.trackingId) {
      cancelAnimationFrame(state.trackingId);
      state.trackingId = 0;
    }
  };

  // Drag functionality
  const makeDraggable = panel => {
    const header = panel.querySelector('#timecode-header');
    if (!header) return;

    let startX, startY, startLeft, startTop;

    const mouseDownHandler = e => {
      if (e.button !== 0) return;

      state.dragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = panel.getBoundingClientRect();

      if (!panel.style.left) {
        panel.style.left = `${rect.left}px`;
      }
      if (!panel.style.top) {
        panel.style.top = `${rect.top}px`;
      }

      panel.style.right = 'auto';

      startLeft = parseFloat(panel.style.left) || rect.left;
      startTop = parseFloat(panel.style.top) || rect.top;

      const handleMove = event => {
        if (!state.dragging) return;

        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        const { left, top } = clampPanelPosition(panel, startLeft + deltaX, startTop + deltaY);

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';
      };

      const handleUp = () => {
        if (!state.dragging) return;

        state.dragging = false;
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);

        const rectAfter = panel.getBoundingClientRect();
        const { left, top } = clampPanelPosition(panel, rectAfter.left, rectAfter.top);

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';

        savePanelPosition(left, top);
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    };

    // ✅ Register the mousedown listener for cleanup
    YouTubeUtils.cleanupManager.registerListener(header, 'mousedown', mouseDownHandler);
  };

  // Storage
  const saveTimecodesToStorage = timecodes => {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) return;

    try {
      const minimal = timecodes.map(tc => ({
        t: tc.time,
        l: tc.label?.trim() || formatTime(tc.time),
        c: tc.isChapter || false,
        u: tc.isUserAdded || false,
      }));
      localStorage.setItem(`yt_tc_${videoId}`, JSON.stringify(minimal));
    } catch { }
  };

  const loadTimecodesFromStorage = () => {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) return null;

    try {
      const data = localStorage.getItem(`yt_tc_${videoId}`);
      return data
        ? JSON.parse(data)
          .map(tc => ({
            time: tc.t,
            label: tc.l,
            isChapter: tc.c,
            isUserAdded: tc.u || false,
          }))
          .sort((a, b) => a.time - b.time)
        : null;
    } catch {
      return null;
    }
  };

  const getCurrentTimecodes = () => {
    const items = state.dom.list?.querySelectorAll('.timecode-item');
    if (!items) return [];

    return Array.from(items)
      .map(item => ({
        time: parseFloat(item.dataset.time),
        label:
          item.querySelector('.timecode-label')?.textContent ||
          formatTime(parseFloat(item.dataset.time)),
        isChapter: item.classList.contains('has-chapter'),
        isUserAdded: !item.classList.contains('has-chapter') || false,
      }))
      .sort((a, b) => a.time - b.time);
  };

  // Toggle panel
  const toggleTimecodePanel = show => {
    // Close any existing panels first (cleanup)
    document.querySelectorAll('#timecode-panel').forEach(panel => {
      if (panel !== state.dom.panel) panel.remove();
    });

    const panel = state.dom.panel || createTimecodePanel();
    if (show === undefined) show = panel.classList.contains('hidden');

    panel.classList.toggle('hidden', !show);

    if (show) {
      applySavedPanelPosition(panel);

      const saved = loadTimecodesFromStorage();
      if (saved?.length) {
        updateTimecodePanel(saved);
      } else if (config.autoDetect) {
        detectTimecodes().catch(err => console.error('[Timecode] Detection failed:', err));
      }

      if (config.autoTrackPlayback) startTracking();
    } else if (state.trackingId) {
      cancelAnimationFrame(state.trackingId);
      state.trackingId = 0;
    }
  };

  // Navigation handling
  const setupNavigation = () => {
    let currentVideoId = new URLSearchParams(window.location.search).get('v');

    const handleNavigationChange = () => {
      const newVideoId = new URLSearchParams(window.location.search).get('v');
      if (newVideoId === currentVideoId || window.location.pathname !== '/watch') return;

      currentVideoId = newVideoId;
      state.activeIndex = null;
      state.editingIndex = null;
      state.timecodes.clear();

      if (config.enabled && state.dom.panel && !state.dom.panel.classList.contains('hidden')) {
        const saved = loadTimecodesFromStorage();
        if (saved?.length) {
          updateTimecodePanel(saved);
        } else if (config.autoDetect) {
          setTimeout(
            () =>
              detectTimecodes().catch(err => console.error('[Timecode] Detection failed:', err)),
            500
          );
        }
        if (config.autoTrackPlayback) startTracking();
      }
    };

    document.addEventListener('yt-navigate-finish', handleNavigationChange);

    // Also watch for URL changes using MutationObserver as a fallback
    const observer = new MutationObserver(() => {
      const newVideoId = new URLSearchParams(window.location.search).get('v');
      if (newVideoId !== currentVideoId) {
        handleNavigationChange();
      }
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(observer);

    // ✅ Safe observe with document.body check
    if (document.body) {
      observer.observe(document.body, { subtree: true, childList: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { subtree: true, childList: true });
      });
    }
  };

  // Keyboard shortcuts
  const setupKeyboard = () => {
    document.addEventListener('keydown', e => {
      // ✅ Проверяем, включена ли функция в настройках
      if (!config.enabled) return;

      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (target.matches && target.matches('input, textarea, [contenteditable]')) return;

      const { key, shiftKey, altKey, ctrlKey } = config.shortcut;
      if (
        e.key.toUpperCase() === key &&
        e.shiftKey === shiftKey &&
        e.altKey === altKey &&
        e.ctrlKey === ctrlKey
      ) {
        e.preventDefault();
        toggleTimecodePanel();
      }
    });
  };

  // Cleanup on unload
  const cleanup = () => {
    stopTracking();
    if (state.dom.panel) {
      state.dom.panel.remove();
      state.dom.panel = null;
    }
  };

  // Initialize
  const init = () => {
    if (initStarted) return;

    const appRoot =
      (typeof YouTubeUtils?.querySelector === 'function' &&
        YouTubeUtils.querySelector('ytd-app')) ||
      document.querySelector('ytd-app');

    if (!appRoot) {
      scheduleInitRetry();
      return;
    }

    initStarted = true;

    loadSettings();
    insertTimecodeStyles();
    setupKeyboard();
    setupNavigation();

    // Settings modal observer
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
            setTimeout(addTimecodePanelSettings, 100);
            return;
          }
        }
      }

      if (
        document.querySelector(
          '.ytp-plus-settings-section[data-section="advanced"]:not(.hidden)'
        ) &&
        !document.querySelector('.timecode-settings-item')
      ) {
        setTimeout(addTimecodePanelSettings, 50);
      }
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(observer);

    // ✅ Safe observe with document.body check
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        });
      });
    }

    // ✅ Register global click listener in cleanupManager
    const clickHandler = e => {
      if (
        /** @type {HTMLElement} */ (e.target).classList?.contains('ytp-plus-settings-nav-item') &&
        /** @type {HTMLElement} */ (e.target).dataset.section === 'advanced'
      ) {
        setTimeout(addTimecodePanelSettings, 50);
      }
    };
    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);

    if (config.enabled) {
      createTimecodePanel();

      if (!state.resizeListenerKey) {
        const onResize = YouTubeUtils.throttle(() => {
          if (!state.dom.panel) return;

          const rect = state.dom.panel.getBoundingClientRect();
          const { left, top } = clampPanelPosition(state.dom.panel, rect.left, rect.top);

          state.dom.panel.style.left = `${left}px`;
          state.dom.panel.style.top = `${top}px`;
          state.dom.panel.style.right = 'auto';

          savePanelPosition(left, top);
        }, 200);

        state.resizeListenerKey = YouTubeUtils.cleanupManager.registerListener(
          window,
          'resize',
          onResize
        );
      }

      const saved = loadTimecodesFromStorage();
      if (saved?.length) {
        updateTimecodePanel(saved);
      } else if (config.autoDetect) {
        setTimeout(
          () => detectTimecodes().catch(err => console.error('[Timecode] Detection failed:', err)),
          1500
        );
      }
      if (config.autoTrackPlayback) startTracking();
    }
  };

  // Start on document ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Cleanup on beforeunload
  window.addEventListener('beforeunload', cleanup);
})();

// --- MODULE: shorts.js ---

// Shorts Keyboard controls
(function () {
  'use strict';

  // Configuration
  const config = {
    enabled: true,
    shortcuts: {
      seekBackward: { key: 'ArrowLeft', description: 'Seek backward 5s' },
      seekForward: { key: 'ArrowRight', description: 'Seek forward 5s' },
      volumeUp: { key: '+', description: 'Volume up' },
      volumeDown: { key: '-', description: 'Volume down' },
      mute: { key: 'm', description: 'Mute/Unmute' },
      showHelp: { key: '?', description: 'Show/Hide help', editable: false },
    },
    storageKey: 'youtube_shorts_keyboard_settings',
  };

  // State management
  const state = {
    helpVisible: false,
    lastAction: null,
    actionTimeout: null,
    editingShortcut: null,
    cachedVideo: null,
    lastVideoCheck: 0,
  };

  // Optimized video selector with caching
  const getCurrentVideo = (() => {
    const selectors = ['ytd-reel-video-renderer[is-active] video', '#shorts-player video', 'video'];

    return () => {
      const now = Date.now();
      if (state.cachedVideo?.isConnected && now - state.lastVideoCheck < 100) {
        return state.cachedVideo;
      }

      for (const selector of selectors) {
        // ✅ Use cached querySelector
        const video = YouTubeUtils.querySelector(selector);
        if (video) {
          state.cachedVideo = video;
          state.lastVideoCheck = now;
          return video;
        }
      }

      state.cachedVideo = null;
      return null;
    };
  })();

  // Optimized utilities
  const utils = {
    isInShortsPage: () => location.pathname.startsWith('/shorts/'),

    isInputFocused: () => {
      const el = document.activeElement;
      return el?.matches?.('input, textarea, [contenteditable="true"]') || el?.isContentEditable;
    },

    loadSettings: () => {
      try {
        const saved = localStorage.getItem(config.storageKey);
        if (saved) Object.assign(config, JSON.parse(saved));
      } catch { }
    },

    saveSettings: () => {
      try {
        localStorage.setItem(
          config.storageKey,
          JSON.stringify({
            enabled: config.enabled,
            shortcuts: config.shortcuts,
          })
        );
      } catch { }
    },

    getDefaultShortcuts: () => ({
      seekBackward: { key: 'ArrowLeft', description: 'Seek backward 5s' },
      seekForward: { key: 'ArrowRight', description: 'Seek forward 5s' },
      volumeUp: { key: '+', description: 'Volume up' },
      volumeDown: { key: '-', description: 'Volume down' },
      mute: { key: 'm', description: 'Mute/Unmute' },
      showHelp: { key: '?', description: 'Show/Hide help', editable: false },
    }),
  };

  // Optimized feedback system
  const feedback = (() => {
    let element = null;

    const create = () => {
      if (element) return element;

      element = document.createElement('div');
      element.id = 'shorts-keyboard-feedback';
      element.style.cssText = `
          position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
          background:var(--shorts-feedback-bg,rgba(255,255,255,.1));
          backdrop-filter:blur(16px) saturate(150%);
          border:1px solid var(--shorts-feedback-border,rgba(255,255,255,.15));
          border-radius:20px;
          color:var(--shorts-feedback-color,#fff);
          padding:18px 32px;font-size:20px;font-weight:700;
          z-index:10000;opacity:0;visibility:hidden;pointer-events:none;
          transition:all .3s cubic-bezier(.4,0,.2,1);text-align:center;
          box-shadow:0 8px 32px rgba(0,0,0,.4);
          background: rgba(255,255,255,0.15);
          border: 1px solid rgba(255,255,255,0.2);
          box-shadow: 0 8px 32px 0 rgba(31,38,135,0.37);
          backdrop-filter: blur(12px) saturate(180%);
          -webkit-backdrop-filter: blur(12px) saturate(180%);
        `;
      document.body.appendChild(element);
      return element;
    };

    return {
      show: text => {
        state.lastAction = text;
        clearTimeout(state.actionTimeout);

        const el = create();
        el.textContent = text;

        requestAnimationFrame(() => {
          el.style.opacity = '1';
          el.style.visibility = 'visible';
          el.style.transform = 'translate(-50%, -50%) scale(1.05)';
        });

        state.actionTimeout = setTimeout(() => {
          el.style.opacity = '0';
          el.style.visibility = 'hidden';
          el.style.transform = 'translate(-50%, -50%) scale(0.95)';
        }, 1500);
      },
    };
  })();

  // Optimized actions
  const actions = {
    seekBackward: () => {
      const video = getCurrentVideo();
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - 5);
        feedback.show('-5s');
      }
    },

    seekForward: () => {
      const video = getCurrentVideo();
      if (video) {
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
        feedback.show('+5s');
      }
    },

    volumeUp: () => {
      const video = getCurrentVideo();
      if (video) {
        video.volume = Math.min(1, video.volume + 0.1);
        feedback.show(`${Math.round(video.volume * 100)}%`);
      }
    },

    volumeDown: () => {
      const video = getCurrentVideo();
      if (video) {
        video.volume = Math.max(0, video.volume - 0.1);
        feedback.show(`${Math.round(video.volume * 100)}%`);
      }
    },

    mute: () => {
      const video = getCurrentVideo();
      if (video) {
        video.muted = !video.muted;
        feedback.show(video.muted ? '🔇' : '🔊');
      }
    },

    showHelp: () => helpPanel.toggle(),
  };

  // Help panel system
  const helpPanel = (() => {
    let panel = null;

    const create = () => {
      if (panel) return panel;

      panel = document.createElement('div');
      panel.id = 'shorts-keyboard-help';
      panel.className = 'glass-panel shorts-help-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.tabIndex = -1;

      const render = () => {
        panel.innerHTML = `
            <div class="help-header">
              <h3>Keyboard Shortcuts</h3>
              <button class="ytp-plus-settings-close help-close" type="button" aria-label="Close">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                </svg>
              </button>
            </div>
            <div class="help-content">
              ${Object.entries(config.shortcuts)
            .map(
              ([action, shortcut]) =>
                `<div class="help-item">
                  <kbd data-action="${action}" ${shortcut.editable === false ? 'class="non-editable"' : ''}>${shortcut.key === ' ' ? 'Space' : shortcut.key}</kbd>
                  <span>${shortcut.description}</span>
                </div>`
            )
            .join('')}
            </div>
            <div class="help-footer">
              <button class="ytp-plus-button ytp-plus-button-primary reset-all-shortcuts">Reset All</button>
            </div>
          `;

        panel.querySelector('.help-close').onclick = () => helpPanel.hide();
        panel.querySelector('.reset-all-shortcuts').onclick = () => {
          if (confirm('Reset all shortcuts?')) {
            config.shortcuts = utils.getDefaultShortcuts();
            utils.saveSettings();
            feedback.show('Shortcuts reset');
            render();
          }
        };

        panel.querySelectorAll('kbd[data-action]:not(.non-editable)').forEach(kbd => {
          kbd.onclick = () =>
            editShortcut(kbd.dataset.action, config.shortcuts[kbd.dataset.action].key);
        });
      };

      render();
      document.body.appendChild(panel);
      return panel;
    };

    return {
      show: () => {
        const p = create();
        p.classList.add('visible');
        state.helpVisible = true;
        p.focus();
      },

      hide: () => {
        if (panel) {
          panel.classList.remove('visible');
          state.helpVisible = false;
        }
      },

      toggle: () => (state.helpVisible ? helpPanel.hide() : helpPanel.show()),

      refresh: () => {
        if (panel) {
          panel.remove();
          panel = null;
        }
      },
    };
  })();

  // Shortcut editing
  const editShortcut = (actionKey, currentKey) => {
    const dialog = document.createElement('div');
    dialog.className = 'glass-modal shortcut-edit-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
        <div class="glass-panel shortcut-edit-content">
          <h4>Edit: ${config.shortcuts[actionKey].description}</h4>
          <p>Press any key to set as new shortcut</p>
          <div class="current-shortcut">Current: <kbd>${currentKey === ' ' ? 'Space' : currentKey}</kbd></div>
          <button class="ytp-plus-button ytp-plus-button-primary shortcut-cancel" type="button">Cancel</button>
        </div>
      `;

    document.body.appendChild(dialog);
    state.editingShortcut = actionKey;

    const handleKey = e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return cleanup();

      const conflict = Object.keys(config.shortcuts).find(
        key => key !== actionKey && config.shortcuts[key].key === e.key
      );
      if (conflict) {
        feedback.show(`Key "${e.key}" already used`);
        return;
      }

      config.shortcuts[actionKey].key = e.key;
      utils.saveSettings();
      feedback.show('Shortcut updated');
      helpPanel.refresh();
      cleanup();
    };

    const cleanup = () => {
      document.removeEventListener('keydown', handleKey, true);
      dialog.remove();
      state.editingShortcut = null;
    };

    dialog.querySelector('.shortcut-cancel').onclick = cleanup;
    dialog.onclick = e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (target === dialog) cleanup();
    };
    document.addEventListener('keydown', handleKey, true);
  };

  // Optimized styles with glassmorphism
  const addStyles = () => {
    if (document.getElementById('shorts-keyboard-styles')) return;

    // ✅ Use StyleManager instead of createElement('style')
    const styles = `
                :root{--shorts-feedback-bg:rgba(255,255,255,.15);--shorts-feedback-border:rgba(255,255,255,.2);--shorts-feedback-color:#fff;--shorts-help-bg:rgba(255,255,255,.15);--shorts-help-border:rgba(255,255,255,.2);--shorts-help-color:#fff;}
                html[dark],body[dark]{--shorts-feedback-bg:rgba(34,34,34,.7);--shorts-feedback-border:rgba(255,255,255,.15);--shorts-feedback-color:#fff;--shorts-help-bg:rgba(34,34,34,.7);--shorts-help-border:rgba(255,255,255,.1);--shorts-help-color:#fff;}
                html:not([dark]){--shorts-feedback-bg:rgba(255,255,255,.95);--shorts-feedback-border:rgba(0,0,0,.08);--shorts-feedback-color:#222;--shorts-help-bg:rgba(255,255,255,.98);--shorts-help-border:rgba(0,0,0,.08);--shorts-help-color:#222;}
                .shorts-help-panel{position:fixed;top:50%;left:25%;transform:translate(-50%,-50%) scale(.9);z-index:10001;opacity:0;visibility:hidden;transition:all .3s ease;width:340px;max-width:95vw;max-height:80vh;overflow:hidden;outline:none;color:var(--shorts-help-color,#fff);}
                .shorts-help-panel.visible{opacity:1;visibility:visible;transform:translate(-50%,-50%) scale(1);}
                .help-header{display:flex;justify-content:space-between;align-items:center;padding:24px 24px 12px;border-bottom:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);}
                html:not([dark]) .help-header{background:rgba(0,0,0,.04);border-bottom:1px solid rgba(0,0,0,.08);}
                .help-header h3{margin:0;font-size:20px;font-weight:700;}
                .help-close{display:flex;align-items:center;justify-content:center;padding:4px;}
                .help-content{padding:18px 24px;max-height:400px;overflow-y:auto;}
                .help-item{display:flex;align-items:center;margin-bottom:14px;gap:18px;}
                .help-item kbd{background:rgba(255,255,255,.15);color:inherit;padding:7px 14px;border-radius:8px;font-family:monospace;font-size:15px;font-weight:700;min-width:60px;text-align:center;border:1.5px solid rgba(255,255,255,.2);cursor:pointer;transition:all .2s;position:relative;}
                html:not([dark]) .help-item kbd{background:rgba(0,0,0,.06);color:#222;border:1.5px solid rgba(0,0,0,.08);}
                .help-item kbd:hover{background:rgba(255,255,255,.22);transform:scale(1.07);}
                .help-item kbd:after{content:"✎";position:absolute;top:-7px;right:-7px;font-size:11px;opacity:0;transition:opacity .2s;}
                .help-item kbd:hover:after{opacity:.7;}
                .help-item kbd.non-editable{cursor:default;opacity:.7;}
                .help-item kbd.non-editable:hover{background:rgba(255,255,255,.15);transform:none;}
                .help-item kbd.non-editable:after{display:none;}
                .help-item span{font-size:15px;color:rgba(255,255,255,.92);}
                html:not([dark]) .help-item span{color:#222;}
                .help-footer{padding:16px 24px 20px;border-top:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);text-align:center;}
                html:not([dark]) .help-footer{background:rgba(0,0,0,.04);border-top:1px solid rgba(0,0,0,.08);}
                .reset-all-shortcuts{display:inline-flex;align-items:center;justify-content:center;gap:var(--yt-space-sm);}
                .shortcut-edit-dialog{z-index:10002;}
                .shortcut-edit-content{padding:28px 32px;min-width:320px;text-align:center;display:flex;flex-direction:column;gap:var(--yt-space-md);color:inherit;}
                html:not([dark]) .shortcut-edit-content{color:#222;}
                .shortcut-edit-content h4{margin:0 0 14px;font-size:17px;font-weight:700;}
                .shortcut-edit-content p{margin:0 0 18px;font-size:15px;color:rgba(255,255,255,.85);}
                html:not([dark]) .shortcut-edit-content p{color:#222;}
                .current-shortcut{margin:18px 0;font-size:15px;}
                .current-shortcut kbd{background:rgba(255,255,255,.15);padding:5px 12px;border-radius:6px;font-family:monospace;border:1.5px solid rgba(255,255,255,.2);}
                html:not([dark]) .current-shortcut kbd{background:rgba(0,0,0,.06);color:#222;border:1.5px solid rgba(0,0,0,.08);}
                .shortcut-cancel{display:inline-flex;align-items:center;justify-content:center;gap:var(--yt-space-sm);}
                @media(max-width:480px){.shorts-help-panel{width:98vw;max-height:85vh}.help-header{padding:16px 10px 8px 10px}.help-content{padding:12px 10px}.help-item{gap:10px}.help-item kbd{min-width:44px;font-size:13px;padding:5px 7px}.shortcut-edit-content{margin:20px;min-width:auto}}
                #shorts-keyboard-feedback{background:var(--shorts-feedback-bg,rgba(255,255,255,.15));color:var(--shorts-feedback-color,#fff);border:1.5px solid var(--shorts-feedback-border,rgba(255,255,255,.2));border-radius:20px;box-shadow:0 8px 32px 0 rgba(31,38,135,.37);backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);}
                html:not([dark]) #shorts-keyboard-feedback{background:var(--shorts-feedback-bg,rgba(255,255,255,.95));color:var(--shorts-feedback-color,#222);border:1.5px solid var(--shorts-feedback-border,rgba(0,0,0,.08));}
            `;
    YouTubeUtils.StyleManager.add('shorts-keyboard-styles', styles);
  };

  // Main keyboard handler
  const handleKeydown = e => {
    if (
      !config.enabled ||
      !utils.isInShortsPage() ||
      utils.isInputFocused() ||
      state.editingShortcut
    ) {
      return;
    }

    let key = e.key;
    if (e.code === 'NumpadAdd') key = '+';
    else if (e.code === 'NumpadSubtract') key = '-';

    const action = Object.keys(config.shortcuts).find(k => config.shortcuts[k].key === key);
    if (action && actions[action]) {
      e.preventDefault();
      e.stopPropagation();
      actions[action]();
    }
  };

  // Initialize
  const init = () => {
    utils.loadSettings();
    addStyles();

    // ✅ Register listeners in cleanupManager
    YouTubeUtils.cleanupManager.registerListener(document, 'keydown', handleKeydown, true);

    const clickHandler = e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (state.helpVisible && target.closest && !target.closest('#shorts-keyboard-help')) {
        helpPanel.hide();
      }
    };
    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state.helpVisible) {
        e.preventDefault();
        helpPanel.hide();
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  if (utils.isInShortsPage() && !localStorage.getItem('shorts_keyboard_help_shown')) {
    setTimeout(() => {
      feedback.show('Press ? for shortcuts');
      localStorage.setItem('shorts_keyboard_help_shown', 'true');
    }, 2000);
  }
})();

// --- MODULE: stats.js ---

// Stats button and menu
(function () {
  'use strict';

  // Glassmorphism styles for stats button and menu
  const styles = `
            .videoStats{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-left:8px;background:rgba(255,255,255,0.15);box-shadow:0 8px 32px rgba(0,0,0,.18);backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);border:1px solid rgba(255,255,255,.18);transition:background .2s}
            html[dark] .videoStats{background:rgba(34,34,34,0.7);border:1px solid rgba(255,255,255,.18)}html:not([dark]) .videoStats{background:rgba(255,255,255,0.15);border:1px solid rgba(0,0,0,.08)}.videoStats:hover{background:rgba(255,255,255,0.22)}.videoStats svg{width:18px;height:18px;fill:var(--yt-spec-text-primary,#030303)}html[dark] .videoStats svg{fill:#fff}html:not([dark]) .videoStats svg{fill:#222}.shortsStats{display:flex;align-items:center;justify-content:center;margin-top:16px;margin-bottom:16px;width:48px;height:48px;border-radius:50%;cursor:pointer;background:rgba(255,255,255,0.15);box-shadow:0 8px 32px rgba(0,0,0,.18);backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);border:1px solid rgba(255,255,255,.18);transition:background .3s}html[dark] .shortsStats{background:rgba(34,34,34,0.7);border:1px solid rgba(255,255,255,.18)}html:not([dark]) .shortsStats{background:rgba(255,255,255,0.15);border:1px solid rgba(0,0,0,.08)}
            .shortsStats:hover{background:rgba(255,255,255,0.22)}.shortsStats svg{width:24px;height:24px;fill:#222}html[dark] .shortsStats svg{fill:#fff}html:not([dark]) .shortsStats svg{fill:#222}.stats-menu-container{position:relative;display:inline-block}.stats-horizontal-menu{position:absolute;display:flex;left:100%;top:0;height:100%;visibility:hidden;opacity:0;transition:visibility 0s,opacity 0.2s linear;z-index:100}.stats-menu-container:hover .stats-horizontal-menu{visibility:visible;opacity:1}.stats-menu-button{margin-left:8px;white-space:nowrap}.stats-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeInModal 0.2s;backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%)}.stats-modal-content{background:rgba(34,34,34,0.95);border-radius:18px;box-shadow:0 8px 32px rgba(0,0,0,.2);max-width:75vw;max-height:90vh;overflow:auto;position:relative;padding:24px 0 0 0;display:flex;flex-direction:column;align-items:center;animation:scaleInModal 0.2s;border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%)}html[dark] .stats-modal-content{background:rgba(34,34,34,0.95)}html:not([dark]) .stats-modal-content{background:#fff;color:#222}.stats-modal-close{position:absolute;top:12px;right:18px;background:transparent;color:#fff;border:none;font-size:28px;line-height:1;width:36px;height:36px;cursor:pointer;transition:background 0.2s;z-index:2;display:flex;align-items:center;justify-content:center}.stats-modal-close:hover{color:#ff4444;transform:rotate(90deg) scale(1.25)}.stats-modal-iframe{width:72vw;height:70vh;box-shadow:0 8px 32px rgba(0,0,0,.2);background:#222;border:1px solid rgba(255,255,255,.2)}.stats-modal-title{font-size:18px;font-weight:600;color:#fff;margin-bottom:10px;text-align:center;text-shadow:0 2px 8px rgba(0,0,0,0.15)}html:not([dark]) .stats-modal-title{color:#222}@keyframes fadeInModal{from{opacity:0}to{opacity:1}}@keyframes scaleInModal{from{transform:scale(0.95)}to{transform:scale(1)}}
        `;

  // Settings state
  const SETTINGS_KEY = 'youtube_stats_button_enabled';
  let statsButtonEnabled = localStorage.getItem(SETTINGS_KEY) !== 'false';

  let previousUrl = location.href;
  let isChecking = false;
  let experimentalNavListenerKey = null;
  let channelFeatures = {
    hasStreams: false,
    hasShorts: false,
  };

  function addStyles() {
    if (!document.querySelector('#youtube-enhancer-styles')) {
      // ✅ Use StyleManager instead of createElement('style')
      YouTubeUtils.StyleManager.add('youtube-enhancer-styles', styles);
    }
  }

  function getCurrentVideoUrl() {
    const url = window.location.href;
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');

    if (videoId) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }

    const shortsMatch = url.match(/\/shorts\/([^?]+)/);
    if (shortsMatch) {
      return `https://www.youtube.com/shorts/${shortsMatch[1]}`;
    }

    return null;
  }

  function getChannelIdentifier() {
    const url = window.location.href;
    let identifier = '';

    if (url.includes('/channel/')) {
      identifier = url.split('/channel/')[1].split('/')[0];
    } else if (url.includes('/@')) {
      identifier = url.split('/@')[1].split('/')[0];
    }

    return identifier;
  }

  async function checkChannelTabs(url) {
    if (isChecking) return;
    isChecking = true;

    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        isChecking = false;
        return;
      }

      const html = await response.text();
      const match = html.match(/var ytInitialData = (.+?);<\/script>/);

      if (!match || !match[1]) {
        isChecking = false;
        return;
      }

      const data = JSON.parse(match[1]);
      const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];

      let hasStreams = false;
      let hasShorts = false;

      tabs.forEach(tab => {
        const tabUrl = tab?.tabRenderer?.endpoint?.commandMetadata?.webCommandMetadata?.url;
        if (tabUrl) {
          if (/\/streams$/.test(tabUrl)) hasStreams = true;
          if (/\/shorts$/.test(tabUrl)) hasShorts = true;
        }
      });

      channelFeatures = {
        hasStreams: hasStreams,
        hasShorts: hasShorts,
      };

      const existingMenu = document.querySelector('.stats-menu-container');
      if (existingMenu) {
        existingMenu.remove();
        createStatsMenu();
      }
    } catch {
    } finally {
      isChecking = false;
    }
  }

  function isChannelPage(url) {
    return (
      url.includes('youtube.com/') &&
      (url.includes('/channel/') || url.includes('/@')) &&
      !url.includes('/video/') &&
      !url.includes('/watch')
    );
  }

  function checkUrlChange() {
    const currentUrl = location.href;
    if (currentUrl !== previousUrl) {
      previousUrl = currentUrl;
      if (isChannelPage(currentUrl)) {
        setTimeout(() => checkChannelTabs(currentUrl), 500);
      }
    }
  }

  function createStatsIcon(isShorts = false) {
    const icon = document.createElement('div');
    icon.className = isShorts ? 'shortsStats' : 'videoStats';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M500 89c13.8-11 16-31.2 5-45s-31.2-16-45-5L319.4 151.5 211.2 70.4c-11.7-8.8-27.8-8.5-39.2 .6L12 199c-13.8 11-16 31.2-5 45s31.2 16 45 5L192.6 136.5l108.2 81.1c11.7 8.8 27.8 8.5 39.2-.6L500 89zM160 256l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32zM32 352l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32zm288-64c-17.7 0-32 14.3-32 32l0 128c0 17.7 14.3 32 32 32s32-14.3 32-32l0-128c0-17.7-14.3-32-32-32zm96-32l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32z'
    );

    svg.appendChild(path);
    icon.appendChild(svg);

    icon.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const videoUrl = getCurrentVideoUrl();
      if (videoUrl) {
        openStatsModal(
          `https://stats.afkarxyz.fun/?directVideo=${encodeURIComponent(videoUrl)}`,
          'Video Stats'
        );
      }
    });

    return icon;
  }

  function insertIconForRegularVideo() {
    if (!statsButtonEnabled) return;
    const targetSelector = '#owner';
    const target = document.querySelector(targetSelector);

    if (target && !document.querySelector('.videoStats')) {
      const statsIcon = createStatsIcon();
      target.appendChild(statsIcon);
    }
  }

  function insertIconForShorts() {
    if (!statsButtonEnabled) return false;
    const likeButtonContainer = document.querySelector(
      'ytd-reel-video-renderer[is-active] #like-button'
    );

    if (likeButtonContainer && !document.querySelector('.shortsStats')) {
      const iconDiv = createStatsIcon(true);
      likeButtonContainer.parentNode.insertBefore(iconDiv, likeButtonContainer);
      return true;
    }
    return false;
  }

  function createButton(text, svgPath, viewBox, className, onClick) {
    const buttonViewModel = document.createElement('button-view-model');
    buttonViewModel.className = `yt-spec-button-view-model ${className}-view-model`;

    const button = document.createElement('button');
    button.className = `yt-spec-button-shape-next yt-spec-button-shape-next--outline yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--enable-backdrop-filter-experiment ${className}-button`;
    button.setAttribute('aria-disabled', 'false');
    button.setAttribute('aria-label', text);
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.gap = '8px';

    button.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.style.width = '20px';
    svg.style.height = '20px';
    svg.style.fill = 'currentColor';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', svgPath);
    svg.appendChild(path);

    const buttonText = document.createElement('div');
    buttonText.className = `yt-spec-button-shape-next__button-text-content ${className}-text`;
    buttonText.textContent = text;
    buttonText.style.display = 'flex';
    buttonText.style.alignItems = 'center';

    const touchFeedback = document.createElement('yt-touch-feedback-shape');
    touchFeedback.style.borderRadius = 'inherit';

    const touchFeedbackDiv = document.createElement('div');
    touchFeedbackDiv.className =
      'yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--touch-response';
    touchFeedbackDiv.setAttribute('aria-hidden', 'true');

    const strokeDiv = document.createElement('div');
    strokeDiv.className = 'yt-spec-touch-feedback-shape__stroke';

    const fillDiv = document.createElement('div');
    fillDiv.className = 'yt-spec-touch-feedback-shape__fill';

    touchFeedbackDiv.appendChild(strokeDiv);
    touchFeedbackDiv.appendChild(fillDiv);
    touchFeedback.appendChild(touchFeedbackDiv);

    button.appendChild(svg);
    button.appendChild(buttonText);
    button.appendChild(touchFeedback);
    buttonViewModel.appendChild(button);

    return buttonViewModel;
  }

  function openStatsModal(url, titleText) {
    document.querySelectorAll('.stats-modal-overlay').forEach(m => m.remove());

    const overlay = document.createElement('div');
    overlay.className = 'stats-modal-overlay';

    const content = document.createElement('div');
    content.className = 'stats-modal-content';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'stats-modal-close';
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
      </svg>
    `;
    closeBtn.title = 'Close';
    closeBtn.onclick = () => overlay.remove();

    const title = document.createElement('div');
    title.className = 'stats-modal-title';
    title.textContent = titleText || 'Stats';

    const iframe = document.createElement('iframe');
    iframe.className = 'stats-modal-iframe';
    iframe.src = url;
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    iframe.style.background = '#222';

    content.append(closeBtn, title, iframe);
    overlay.appendChild(content);

    overlay.onclick = e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (target === overlay) overlay.remove();
    };
    document.addEventListener(
      'keydown',
      function escHandler(e) {
        if (e.key === 'Escape') {
          overlay.remove();
          document.removeEventListener('keydown', escHandler, true);
        }
      },
      true
    );

    document.body.appendChild(overlay);
  }

  function createStatsMenu() {
    if (!statsButtonEnabled) return;
    if (document.querySelector('.stats-menu-container')) {
      return;
    }

    const containerDiv = document.createElement('div');
    containerDiv.className = 'yt-flexible-actions-view-model-wiz__action stats-menu-container';

    const mainButtonViewModel = document.createElement('button-view-model');
    mainButtonViewModel.className = 'yt-spec-button-view-model main-stats-view-model';

    const mainButton = document.createElement('button');
    mainButton.className =
      'yt-spec-button-shape-next yt-spec-button-shape-next--outline yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--enable-backdrop-filter-experiment main-stats-button';
    mainButton.setAttribute('aria-disabled', 'false');
    mainButton.setAttribute('aria-label', 'Stats');
    mainButton.style.display = 'flex';
    mainButton.style.alignItems = 'center';
    mainButton.style.justifyContent = 'center';
    mainButton.style.gap = '8px';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.style.width = '20px';
    svg.style.height = '20px';
    svg.style.fill = 'currentColor';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M500 89c13.8-11 16-31.2 5-45s-31.2-16-45-5L319.4 151.5 211.2 70.4c-11.7-8.8-27.8-8.5-39.2 .6L12 199c-13.8 11-16 31.2-5 45s31.2 16 45 5L192.6 136.5l108.2 81.1c11.7 8.8 27.8 8.5 39.2-.6L500 89zM160 256l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32zM32 352l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32zm288-64c-17.7 0-32 14.3-32 32l0 128c0 17.7 14.3 32 32 32s32-14.3 32-32l0-128c0-17.7-14.3-32-32-32zm96-32l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32z'
    );
    svg.appendChild(path);

    const buttonText = document.createElement('div');
    buttonText.className = 'yt-spec-button-shape-next__button-text-content main-stats-text';
    buttonText.textContent = 'Stats';
    buttonText.style.display = 'flex';
    buttonText.style.alignItems = 'center';

    const touchFeedback = document.createElement('yt-touch-feedback-shape');
    touchFeedback.style.borderRadius = 'inherit';

    const touchFeedbackDiv = document.createElement('div');
    touchFeedbackDiv.className =
      'yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--touch-response';
    touchFeedbackDiv.setAttribute('aria-hidden', 'true');

    const strokeDiv = document.createElement('div');
    strokeDiv.className = 'yt-spec-touch-feedback-shape__stroke';

    const fillDiv = document.createElement('div');
    fillDiv.className = 'yt-spec-touch-feedback-shape__fill';

    touchFeedbackDiv.appendChild(strokeDiv);
    touchFeedbackDiv.appendChild(fillDiv);
    touchFeedback.appendChild(touchFeedbackDiv);

    mainButton.appendChild(svg);
    mainButton.appendChild(buttonText);
    mainButton.appendChild(touchFeedback);
    mainButtonViewModel.appendChild(mainButton);
    containerDiv.appendChild(mainButtonViewModel);

    const horizontalMenu = document.createElement('div');
    horizontalMenu.className = 'stats-horizontal-menu';

    const channelButtonContainer = document.createElement('div');
    channelButtonContainer.className = 'stats-menu-button channel-stats-container';

    const channelButton = createButton(
      'Channel',
      'M64 48c-8.8 0-16 7.2-16 16l0 288c0 8.8 7.2 16 16 16l512 0c8.8 0 16-7.2 16-16l0-288c0-8.8-7.2-16-16-16L64 48zM0 64C0 28.7 28.7 0 64 0L576 0c35.3 0 64 28.7 64 64l0 288c0 35.3-28.7 64-64 64L64 416c-35.3 0-64-28.7-64-64L0 64zM120 464l400 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-400 0c-13.3 0-24-10.7-24-24s10.7-24 24-24z',
      '0 0 640 512',
      'channel-stats',
      () => {
        const channelId = getChannelIdentifier();
        if (channelId) {
          openStatsModal(`https://stats.afkarxyz.fun/?directChannel=${channelId}`, 'Channel Stats');
        }
      }
    );

    channelButtonContainer.appendChild(channelButton);
    horizontalMenu.appendChild(channelButtonContainer);

    if (channelFeatures.hasStreams) {
      const liveButtonContainer = document.createElement('div');
      liveButtonContainer.className = 'stats-menu-button live-stats-container';

      const liveButton = createButton(
        'Live',
        'M99.8 69.4c10.2 8.4 11.6 23.6 3.2 33.8C68.6 144.7 48 197.9 48 256s20.6 111.3 55 152.8c8.4 10.2 7 25.3-3.2 33.8s-25.3 7-33.8-3.2C24.8 389.6 0 325.7 0 256S24.8 122.4 66 72.6c8.4-10.2 23.6-11.6 33.8-3.2zm376.5 0c10.2-8.4 25.3-7 33.8 3.2c41.2 49.8 66 113.8 66 183.4s-24.8 133.6-66 183.4c-8.4 10.2-23.6 11.6-33.8 3.2s-11.6-23.6-3.2-33.8c34.3-41.5 55-94.7 55-152.8s-20.6-111.3-55-152.8c-8.4-10.2-7-25.3 3.2-33.8zM248 256a40 40 0 1 1 80 0 40 40 0 1 1 -80 0zm-61.1-78.5C170 199.2 160 226.4 160 256s10 56.8 26.9 78.5c8.1 10.5 6.3 25.5-4.2 33.7s-25.5 6.3-33.7-4.2c-23.2-29.8-37-67.3-37-108s13.8-78.2 37-108c8.1-10.5 23.2-12.3 33.7-4.2s12.3 23.2 4.2 33.7zM427 148c23.2 29.8 37 67.3 37 108s-13.8 78.2-37 108c-8.1 10.5-23.2 12.3-33.7 4.2s-12.3-23.2-4.2-33.7C406 312.8 416 285.6 416 256s-10-56.8-26.9-78.5c-8.1-10.5-6.3-25.5 4.2-33.7s25.5-6.3 33.7 4.2z',
        '0 0 576 512',
        'live-stats',
        () => {
          const channelId = getChannelIdentifier();
          if (channelId) {
            openStatsModal(`https://stats.afkarxyz.fun/?directStream=${channelId}`, 'Live Stats');
          }
        }
      );

      liveButtonContainer.appendChild(liveButton);
      horizontalMenu.appendChild(liveButtonContainer);
    }

    if (channelFeatures.hasShorts) {
      const shortsButtonContainer = document.createElement('div');
      shortsButtonContainer.className = 'stats-menu-button shorts-stats-container';

      const shortsButton = createButton(
        'Shorts',
        'M80 48c-8.8 0-16 7.2-16 16l0 384c0 8.8 7.2 16 16 16l224 0c8.8 0 16-7.2 16-16l0-384c0-8.8-7.2-16-16-16L80 48zM16 64C16 28.7 44.7 0 80 0L304 0c35.3 0 64 28.7 64 64l0 384c0 35.3-28.7 64-64 64L80 512c-35.3 0-64-28.7-64-64L16 64zM160 400l64 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-64 0c-8.8 0-16-7.2-16-16s7.2-16 16-16z',
        '0 0 384 512',
        'shorts-stats',
        () => {
          const channelId = getChannelIdentifier();
          if (channelId) {
            openStatsModal(`https://stats.afkarxyz.fun/?directShorts=${channelId}`, 'Shorts Stats');
          }
        }
      );

      shortsButtonContainer.appendChild(shortsButton);
      horizontalMenu.appendChild(shortsButtonContainer);
    }

    containerDiv.appendChild(horizontalMenu);

    const joinButton = document.querySelector(
      '.yt-flexible-actions-view-model-wiz__action:not(.stats-menu-container)'
    );
    if (joinButton) {
      joinButton.parentNode.appendChild(containerDiv);
    } else {
      const buttonContainer = document.querySelector('#subscribe-button + #buttons');
      if (buttonContainer) {
        buttonContainer.appendChild(containerDiv);
      }
    }

    return containerDiv;
  }

  function checkAndAddMenu() {
    if (!statsButtonEnabled) return;
    const joinButton = document.querySelector(
      '.yt-flexible-actions-view-model-wiz__action:not(.stats-menu-container)'
    );
    const statsMenu = document.querySelector('.stats-menu-container');

    if (joinButton && !statsMenu) {
      createStatsMenu();
    }
  }

  function checkAndInsertIcon() {
    if (!statsButtonEnabled) return;
    const isShorts = window.location.pathname.includes('/shorts/');
    if (isShorts) {
      const shortsObserver = new MutationObserver((_mutations, observer) => {
        if (insertIconForShorts()) {
          observer.disconnect();
        }
      });

      // ✅ Register observer in cleanupManager
      YouTubeUtils.cleanupManager.registerObserver(shortsObserver);

      const shortsContainer = document.querySelector('ytd-shorts');
      if (shortsContainer) {
        shortsObserver.observe(shortsContainer, {
          childList: true,
          subtree: true,
        });
        insertIconForShorts();
      }
    } else if (getCurrentVideoUrl()) {
      insertIconForRegularVideo();
    }
  }

  function addSettingsUI() {
    const section = document.querySelector(
      '.ytp-plus-settings-section[data-section="experimental"]'
    );
    if (!section || section.querySelector('.stats-button-settings-item')) return;

    const item = document.createElement('div');
    item.className = 'ytp-plus-settings-item stats-button-settings-item';
    item.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Statistics Button</label>
          <div class="ytp-plus-settings-item-description">Show statistics button on videos and channel menu for quick access to statistics</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" ${statsButtonEnabled ? 'checked' : ''}>
      `;
    section.appendChild(item);

    item.querySelector('input').addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      statsButtonEnabled = target.checked;
      localStorage.setItem(SETTINGS_KEY, statsButtonEnabled ? 'true' : 'false');
      // Remove all stats buttons and menus
      document
        .querySelectorAll('.videoStats,.shortsStats,.stats-menu-container')
        .forEach(el => el.remove());
      if (statsButtonEnabled) {
        checkAndInsertIcon();
        checkAndAddMenu();
      }
    });
  }

  // Observe settings modal for experimental section
  const settingsObserver = new MutationObserver(mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addSettingsUI, 50);
        }
      }
    }
    if (document.querySelector('.ytp-plus-settings-nav-item[data-section="experimental"].active')) {
      setTimeout(addSettingsUI, 50);
    }
  });

  // ✅ Register observer in cleanupManager
  YouTubeUtils.cleanupManager.registerObserver(settingsObserver);

  // ✅ Safe observe with document.body check
  if (document.body) {
    settingsObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      settingsObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  const handleExperimentalNavClick = e => {
    const target = /** @type {EventTarget & HTMLElement} */ (e.target);
    if (
      target.classList?.contains('ytp-plus-settings-nav-item') &&
      target.dataset?.section === 'experimental'
    ) {
      setTimeout(addSettingsUI, 50);
    }
  };

  if (!experimentalNavListenerKey) {
    experimentalNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'click',
      handleExperimentalNavClick,
      true
    );
  }

  function init() {
    addStyles();
    if (statsButtonEnabled) {
      checkAndInsertIcon();
      checkAndAddMenu();
    }

    history.pushState = (function (f) {
      /** @this {any} */
      return function () {
        const fAny = /** @type {any} */ (f);
        const result = fAny.apply(this, arguments);
        checkUrlChange();
        return result;
      };
    })(history.pushState);

    history.replaceState = (function (f) {
      /** @this {any} */
      return function () {
        const fAny = /** @type {any} */ (f);
        const result = fAny.apply(this, arguments);
        checkUrlChange();
        return result;
      };
    })(history.replaceState);

    window.addEventListener('popstate', checkUrlChange);

    if (isChannelPage(location.href)) {
      checkChannelTabs(location.href);
    }
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        if (statsButtonEnabled) {
          checkAndInsertIcon();
          checkAndAddMenu();
        }
      }
    }
  });

  // ✅ Safe observe with document.body check
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('yt-navigate-finish', () => {
    if (statsButtonEnabled) {
      checkAndInsertIcon();
      checkAndAddMenu();
      if (isChannelPage(location.href)) {
        checkChannelTabs(location.href);
      }
    }
  });

  document.addEventListener('yt-action', function (event) {
    const ev = /** @type {CustomEvent<any>} */ (event);
    if (ev.detail && ev.detail.actionName === 'yt-reload-continuation-items-command') {
      if (statsButtonEnabled) {
        checkAndInsertIcon();
        checkAndAddMenu();
      }
    }
  });
})();

// --- MODULE: thumbnail.js ---

(function () {
  'use strict';

  function extractVideoId(thumbnailSrc) {
    const match = thumbnailSrc.match(/\/vi\/([^\/]+)\//);
    return match ? match[1] : null;
  }

  function extractShortsId(href) {
    const match = href.match(/\/shorts\/([^\/\?]+)/);
    return match ? match[1] : null;
  }

  async function checkImageExists(url) {
    try {
      const corsTest = await fetch(url, { method: 'HEAD' }).catch(() => null);

      if (corsTest) {
        return corsTest.ok;
      } else {
        return true;
      }
    } catch {
      return new Promise(resolve => {
        const img = document.createElement('img');
        img.style.display = 'none';

        const timeout = setTimeout(() => {
          document.body.removeChild(img);
          resolve(false);
        }, 2000);

        img.onload = () => {
          clearTimeout(timeout);
          document.body.removeChild(img);
          resolve(true);
        };

        img.onerror = () => {
          clearTimeout(timeout);
          document.body.removeChild(img);
          resolve(false);
        };

        document.body.appendChild(img);
        img.src = url;
      });
    }
  }

  function createSpinner() {
    const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spinner.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    spinner.setAttribute('width', '16');
    spinner.setAttribute('height', '16');
    spinner.setAttribute('viewBox', '0 0 24 24');
    spinner.setAttribute('fill', 'none');
    spinner.setAttribute('stroke', 'white');
    spinner.setAttribute('stroke-width', '2');
    spinner.setAttribute('stroke-linecap', 'round');
    spinner.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M21 12a9 9 0 1 1-6.219-8.56');
    spinner.appendChild(path);

    spinner.style.animation = 'spin 1s linear infinite';

    if (!document.querySelector('#spinner-keyframes')) {
      const style = document.createElement('style');
      style.id = 'spinner-keyframes';
      style.textContent = `
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
      document.head.appendChild(style);
    }

    return spinner;
  }

  async function openThumbnail(videoId, isShorts, overlayElement) {
    if (isShorts) {
      const originalSvg = overlayElement.querySelector('svg');
      const spinner = createSpinner();
      overlayElement.replaceChild(spinner, originalSvg);

      try {
        const oardefaultUrl = `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`;
        const isOarDefaultAvailable = await checkImageExists(oardefaultUrl);

        if (isOarDefaultAvailable) {
          showImageModal(oardefaultUrl);
        } else {
          showImageModal(`https://i.ytimg.com/vi/${videoId}/oar2.jpg`);
        }
      } finally {
        overlayElement.replaceChild(originalSvg, spinner);
      }
    } else {
      // For non-shorts thumbnails: capture original svg, show spinner while checking
      const originalSvg = overlayElement.querySelector('svg');
      const spinner = createSpinner();
      // replace original with spinner
      overlayElement.replaceChild(spinner, originalSvg);

      try {
        const maxresdefaultUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
        const isMaxResAvailable = await checkImageExists(maxresdefaultUrl);

        if (isMaxResAvailable) {
          showImageModal(maxresdefaultUrl);
        } else {
          showImageModal(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
        }
      } finally {
        // restore original svg
        try {
          overlayElement.replaceChild(originalSvg, spinner);
        } catch {
          // fallback: remove spinner if original not found
          if (spinner && spinner.parentNode) spinner.parentNode.removeChild(spinner);
        }
      }
    }
  }

  // Inject CSS styles via StyleManager (if available) to match base theme
  (function addThumbnailStyles() {
    try {
      const css = `
    :root {
        --thumbnail-btn-bg-light: rgba(255, 255, 255, 0.85);
        --thumbnail-btn-bg-dark: rgba(0, 0, 0, 0.7);
        --thumbnail-btn-hover-bg-light: rgba(255, 255, 255, 1);
        --thumbnail-btn-hover-bg-dark: rgba(0, 0, 0, 0.9);
        --thumbnail-btn-color-light: #222;
        --thumbnail-btn-color-dark: #fff;
        --thumbnail-modal-bg-light: rgba(255, 255, 255, 0.95);
        --thumbnail-modal-bg-dark: rgba(34, 34, 34, 0.85);
        --thumbnail-modal-title-light: #222;
        --thumbnail-modal-title-dark: #fff;
        --thumbnail-modal-btn-bg-light: rgba(0, 0, 0, 0.08);
        --thumbnail-modal-btn-bg-dark: rgba(255, 255, 255, 0.08);
        --thumbnail-modal-btn-hover-bg-light: rgba(0, 0, 0, 0.18);
        --thumbnail-modal-btn-hover-bg-dark: rgba(255, 255, 255, 0.18);
        --thumbnail-modal-btn-color-light: #222;
        --thumbnail-modal-btn-color-dark: #fff;
        --thumbnail-modal-btn-hover-color-light: #ff4444;
        --thumbnail-modal-btn-hover-color-dark: #ff4444;
        --thumbnail-glass-blur: blur(18px) saturate(180%);
        --thumbnail-glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        --thumbnail-glass-border: rgba(255, 255, 255, 0.2);
    }

    html[dark],
    body[dark] {
        --thumbnail-btn-bg: var(--thumbnail-btn-bg-dark);
        --thumbnail-btn-hover-bg: var(--thumbnail-btn-hover-bg-dark);
        --thumbnail-btn-color: var(--thumbnail-btn-color-dark);
        --thumbnail-modal-bg: var(--thumbnail-modal-bg-dark);
        --thumbnail-modal-title: var(--thumbnail-modal-title-dark);
        --thumbnail-modal-btn-bg: var(--thumbnail-modal-btn-bg-dark);
        --thumbnail-modal-btn-hover-bg: var(--thumbnail-modal-btn-hover-bg-dark);
        --thumbnail-modal-btn-color: var(--thumbnail-modal-btn-color-dark);
        --thumbnail-modal-btn-hover-color: var(--thumbnail-modal-btn-hover-color-dark);
    }

    html:not([dark]) {
        --thumbnail-btn-bg: var(--thumbnail-btn-bg-light);
        --thumbnail-btn-hover-bg: var(--thumbnail-btn-hover-bg-light);
        --thumbnail-btn-color: var(--thumbnail-btn-color-light);
        --thumbnail-modal-bg: var(--thumbnail-modal-bg-light);
        --thumbnail-modal-title: var(--thumbnail-modal-title-light);
        --thumbnail-modal-btn-bg: var(--thumbnail-modal-btn-bg-light);
        --thumbnail-modal-btn-hover-bg: var(--thumbnail-modal-btn-hover-bg-light);
        --thumbnail-modal-btn-color: var(--thumbnail-modal-btn-color-light);
        --thumbnail-modal-btn-hover-color: var(--thumbnail-modal-btn-hover-color-light);
    }

    .thumbnail-overlay-container { position: absolute; bottom: 8px; left: 8px; z-index: 9999; opacity: 0; transition: opacity 0.2s ease; }
    .thumbnail-overlay-button { width: 28px; height: 28px; background: var(--thumbnail-btn-bg); border: none; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--thumbnail-btn-color); position: relative; box-shadow: var(--thumbnail-glass-shadow); backdrop-filter: var(--thumbnail-glass-blur); -webkit-backdrop-filter: var(--thumbnail-glass-blur); border: 1px solid var(--thumbnail-glass-border); }
    .thumbnail-overlay-button:hover { background: var(--thumbnail-btn-hover-bg); }
    .thumbnail-dropdown { position: absolute; bottom: 100%; left: 0; background: var(--thumbnail-btn-hover-bg); border-radius: 8px; padding: 4px; margin-bottom: 4px; display: none; flex-direction: column; min-width: 140px; box-shadow: var(--thumbnail-glass-shadow); z-index: 10000; backdrop-filter: var(--thumbnail-glass-blur); -webkit-backdrop-filter: var(--thumbnail-glass-blur); border: 1px solid var(--thumbnail-glass-border); }
    .thumbnail-dropdown.show { display: flex !important; }
    .thumbnail-dropdown-item { background: none; border: none; color: var(--thumbnail-btn-color); padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 12px; text-align: left; white-space: nowrap; transition: background-color 0.2s ease; }
    .thumbnail-dropdown-item:hover { background: rgba(255,255,255,0.06); }
    .thumbnailPreview-button { position: absolute; bottom: 10px; left: 5px; background-color: var(--thumbnail-btn-bg); color: var(--thumbnail-btn-color); border: none; border-radius: 6px; padding: 3px; font-size: 18px; cursor: pointer; z-index: 2000; opacity: 0; transition: opacity 0.3s; display: flex; align-items: center; justify-content: center; box-shadow: var(--thumbnail-glass-shadow); backdrop-filter: var(--thumbnail-glass-blur); -webkit-backdrop-filter: var(--thumbnail-glass-blur); border: 1px solid var(--thumbnail-glass-border); }
    .thumbnailPreview-container { position: relative; }
    .thumbnailPreview-container:hover .thumbnailPreview-button { opacity: 1; }
    .thumbnail-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 99999; display: flex; align-items: center; justify-content: center; animation: fadeInModal 0.2s; backdrop-filter: var(--thumbnail-glass-blur); -webkit-backdrop-filter: var(--thumbnail-glass-blur); }
    .thumbnail-modal-content { background: var(--thumbnail-modal-bg); border-radius: 18px; box-shadow: var(--thumbnail-glass-shadow); max-width: 75vw; max-height: 90vh; overflow: auto; position: relative; padding: 24px 0 16px 0; display: flex; flex-direction: column; align-items: center; animation: scaleInModal 0.2s; border: 1px solid var(--thumbnail-glass-border); backdrop-filter: var(--thumbnail-glass-blur); -webkit-backdrop-filter: var(--thumbnail-glass-blur); }
    .thumbnail-modal-close { position: absolute; top: 12px; right: 18px; background: transparent; color: #fff; border: none; font-size: 28px; line-height: 1; width: 36px; height: 36px; cursor: pointer; transition: background 0.2s; z-index: 2; display: flex; align-items: center; justify-content: center; }
    .thumbnail-modal-close:hover { color: #ff4444; transform: rotate(90deg) scale(1.25); }
    .thumbnail-modal-img { max-width: 72vw; max-height: 70vh; margin-bottom: 12px; box-shadow: var(--thumbnail-glass-shadow); background: #222; border: 1px solid var(--thumbnail-glass-border); }
    .thumbnail-modal-options { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; justify-content: center; }
    .thumbnail-modal-option-btn { background: var(--thumbnail-modal-btn-bg); color: var(--thumbnail-modal-btn-color); border: none; border-radius: 8px; padding: 8px 18px; font-size: 14px; cursor: pointer; transition: background 0.2s; margin-bottom: 6px; box-shadow: var(--thumbnail-glass-shadow); backdrop-filter: var(--thumbnail-glass-blur); -webkit-backdrop-filter: var(--thumbnail-glass-blur); border: 1px solid var(--thumbnail-glass-border); }
    .thumbnail-modal-option-btn:hover { background: var(--thumbnail-modal-btn-hover-bg); color: var(--thumbnail-modal-btn-hover-color); }
    .thumbnail-modal-title { font-size: 18px; font-weight: 600; color: var(--thumbnail-modal-title); margin-bottom: 10px; text-align: center; text-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    @keyframes fadeInModal { from { opacity: 0; } to { opacity: 1; } }
    @keyframes scaleInModal { from { transform: scale(0.95); } to { transform: scale(1); } }
            `;

      if (
        window.YouTubeUtils &&
        YouTubeUtils.StyleManager &&
        typeof YouTubeUtils.StyleManager.add === 'function'
      ) {
        YouTubeUtils.StyleManager.add('thumbnail-viewer-styles', css);
      } else {
        const s = document.createElement('style');
        s.id = 'ytplus-thumbnail-styles';
        s.textContent = css;
        document.head.appendChild(s);
      }
    } catch {
      // fallback: inject minimal styles
      if (!document.getElementById('ytplus-thumbnail-styles')) {
        const s = document.createElement('style');
        s.id = 'ytplus-thumbnail-styles';
        s.textContent = '.thumbnail-modal-img{max-width:72vw;max-height:70vh;}';
        document.head.appendChild(s);
      }
    }
  })();

  // Modal image viewer (class-based, uses injected CSS)
  function showImageModal(url, titleText) {
    // remove existing
    document.querySelectorAll('.thumbnail-modal-overlay').forEach(m => m.remove());

    const overlay = document.createElement('div');
    overlay.className = 'thumbnail-modal-overlay';

    const content = document.createElement('div');
    content.className = 'thumbnail-modal-content';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'thumbnail-modal-close';
    closeBtn.innerHTML = `\n            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>\n            </svg>\n            `;
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      overlay.remove();
    });

    const title = document.createElement('div');
    title.className = 'thumbnail-modal-title';
    title.textContent = titleText || 'Thumbnail Preview';

    const img = document.createElement('img');
    img.className = 'thumbnail-modal-img';
    img.src = url;
    img.alt = 'Thumbnail Preview';
    img.title = 'Click to open in new tab';
    img.style.cursor = 'pointer';
    img.addEventListener('click', () => window.open(img.src, '_blank'));

    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'thumbnail-modal-options';

    content.appendChild(closeBtn);
    content.appendChild(title);
    content.appendChild(img);
    content.appendChild(optionsDiv);
    overlay.appendChild(content);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });

    function escHandler(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        window.removeEventListener('keydown', escHandler, true);
      }
    }
    window.addEventListener('keydown', escHandler, true);

    img.addEventListener('error', () => {
      const err = document.createElement('div');
      err.textContent = 'Не удалось загрузить изображение';
      err.style.color = 'white';
      content.appendChild(err);
    });

    document.body.appendChild(overlay);
  }

  let thumbnailPreviewCurrentVideoId = '';
  let thumbnailPreviewClosed = false;
  let thumbnailInsertionAttempts = 0;
  const MAX_ATTEMPTS = 10;
  const RETRY_DELAY = 500;

  function isWatchPage() {
    const url = new URL(window.location.href);
    return url.pathname === '/watch' && url.searchParams.has('v');
  }

  function addOrUpdateThumbnailImage() {
    if (!isWatchPage()) return;

    const newVideoId = new URLSearchParams(window.location.search).get('v');

    if (newVideoId !== thumbnailPreviewCurrentVideoId) {
      thumbnailPreviewClosed = false;
    }

    if (!newVideoId || newVideoId === thumbnailPreviewCurrentVideoId || thumbnailPreviewClosed) {
      return;
    }

    thumbnailPreviewCurrentVideoId = newVideoId;

    function attemptInsertion() {
      const player =
        document.querySelector('#movie_player') || document.querySelector('ytd-player');
      if (!player) {
        thumbnailInsertionAttempts++;
        if (thumbnailInsertionAttempts < MAX_ATTEMPTS) {
          setTimeout(attemptInsertion, RETRY_DELAY);
        } else {
          thumbnailInsertionAttempts = 0;
        }
        return;
      }

      // Add or update a small overlay icon at top-left of the player
      const overlayId = 'thumbnailPreview-player-overlay';
      let overlay = player.querySelector(`#${overlayId}`);

      if (!overlay) {
        // create a standard thumb-overlay and adapt it for the top-left player position
        overlay = /** @type {any} */ (
          createThumbnailOverlay(thumbnailPreviewCurrentVideoId, player)
        );
        overlay.id = overlayId;
        // override position/size for player overlay (top-left)
        overlay.style.cssText = `
                    position: absolute;
                    top: 8px;
                    left: 8px;
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 6px;
                    cursor: pointer;
                    z-index: 1001;
                    transition: all 0.15s ease;
                    opacity: 0.5;
                `;

        // ensure the player is positioned to allow absolute child
        const playerAny = /** @type {any} */ (player);
        if (/** @type {any} */ (getComputedStyle(playerAny)).position === 'static') {
          playerAny.style.position = 'relative';
        }
        playerAny.appendChild(overlay);
      } else {
        // overlay already exists — keep it updated (no img src needed, overlay contains svg)
      }

      thumbnailInsertionAttempts = 0;
    }

    attemptInsertion();
  }

  function createThumbnailOverlay(videoId, container) {
    const overlay = document.createElement('div');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'white');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.transition = 'stroke 0.2s ease';

    const mainRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    mainRect.setAttribute('width', '18');
    mainRect.setAttribute('height', '18');
    mainRect.setAttribute('x', '3');
    mainRect.setAttribute('y', '3');
    mainRect.setAttribute('rx', '2');
    mainRect.setAttribute('ry', '2');
    svg.appendChild(mainRect);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '9');
    circle.setAttribute('cy', '9');
    circle.setAttribute('r', '2');
    svg.appendChild(circle);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21');
    svg.appendChild(path);

    overlay.appendChild(svg);
    overlay.style.cssText = `
            position: absolute;
            bottom: 8px;
            left: 8px;
            background: rgba(0, 0, 0, 0.7);
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            cursor: pointer;
            z-index: 1000;
            opacity: 0;
            transition: all 0.2s ease;
        `;

    overlay.onmouseenter = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.9)';
      svg.style.stroke = '#f50057';
    };
    overlay.onmouseleave = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.7)';
      svg.style.stroke = 'white';
    };

    overlay.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();

      const isShorts =
        container.closest('ytm-shorts-lockup-view-model') ||
        container.closest('.shortsLockupViewModelHost') ||
        container.closest('[class*="shortsLockupViewModelHost"]') ||
        container.querySelector('a[href*="/shorts/"]');

      await openThumbnail(videoId, !!isShorts, overlay);
    };

    return overlay;
  }

  function addThumbnailOverlay(container) {
    if (container.querySelector('.thumb-overlay')) return;

    let videoId = null;
    let thumbnailContainer = null;

    const img = container.querySelector('img[src*="ytimg.com"]');
    if (img?.src) {
      videoId = extractVideoId(img.src);
      thumbnailContainer = img.closest('yt-thumbnail-view-model') || img.parentElement;
    }

    if (!videoId) {
      const link = container.querySelector('a[href*="/shorts/"]');
      if (link?.href) {
        videoId = extractShortsId(link.href);

        const shortsImg = container.querySelector('img[src*="ytimg.com"]');
        if (shortsImg) {
          thumbnailContainer =
            shortsImg.closest('.ytCoreImageHost') ||
            shortsImg.closest('[class*="ThumbnailContainer"]') ||
            shortsImg.closest('[class*="ImageHost"]') ||
            shortsImg.parentElement;
        }
      }
    }

    if (!videoId || !thumbnailContainer) return;

    if (getComputedStyle(thumbnailContainer).position === 'static') {
      thumbnailContainer.style.position = 'relative';
    }
    const overlay = createThumbnailOverlay(videoId, container);
    overlay.className = 'thumb-overlay';
    thumbnailContainer.appendChild(overlay);

    thumbnailContainer.onmouseenter = () => (overlay.style.opacity = '1');
    thumbnailContainer.onmouseleave = () => (overlay.style.opacity = '0');
  }

  function createAvatarOverlay() {
    const overlay = document.createElement('div');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'white');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.transition = 'stroke 0.2s ease';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '8');
    circle.setAttribute('r', '5');
    svg.appendChild(circle);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 21a8 8 0 0 0-16 0');
    svg.appendChild(path);

    overlay.appendChild(svg);

    overlay.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.7);
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            cursor: pointer;
            z-index: 1000;
            opacity: 0;
            transition: all 0.2s ease;
        `;

    overlay.onmouseenter = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.9)';
      svg.style.stroke = '#f50057';
    };
    overlay.onmouseleave = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.7)';
      svg.style.stroke = 'white';
    };

    return overlay;
  }

  function addAvatarOverlay(img) {
    const container = img.parentElement;
    if (container.querySelector('.avatar-overlay')) return;

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const overlay = createAvatarOverlay();
    overlay.className = 'avatar-overlay';

    overlay.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      const highResUrl = img.src.replace(/=s\d+-c-k-c0x00ffffff-no-rj.*/, '=s0');
      showImageModal(highResUrl);
    };

    container.appendChild(overlay);

    container.onmouseenter = () => (overlay.style.opacity = '1');
    container.onmouseleave = () => (overlay.style.opacity = '0');
  }

  function createBannerOverlay() {
    const overlay = document.createElement('div');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'white');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.transition = 'stroke 0.2s ease';

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '3');
    rect.setAttribute('y', '3');
    rect.setAttribute('width', '18');
    rect.setAttribute('height', '18');
    rect.setAttribute('rx', '2');
    rect.setAttribute('ry', '2');
    svg.appendChild(rect);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '9');
    circle.setAttribute('cy', '9');
    circle.setAttribute('r', '2');
    svg.appendChild(circle);

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '21,15 16,10 5,21');
    svg.appendChild(polyline);

    overlay.appendChild(svg);

    overlay.style.cssText = `
            position: absolute;
            bottom: 8px;
            left: 8px;
            background: rgba(0, 0, 0, 0.7);
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            cursor: pointer;
            z-index: 1000;
            opacity: 0;
            transition: all 0.2s ease;
        `;

    overlay.onmouseenter = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.9)';
      svg.style.stroke = '#f50057';
    };
    overlay.onmouseleave = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.7)';
      svg.style.stroke = 'white';
    };

    return overlay;
  }

  function addBannerOverlay(img) {
    const container = img.parentElement;
    if (container.querySelector('.banner-overlay')) return;

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const overlay = createBannerOverlay();
    overlay.className = 'banner-overlay';

    overlay.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      const highResUrl = img.src.replace(/=w\d+-.*/, '=s0');
      showImageModal(highResUrl);
    };

    container.appendChild(overlay);

    container.onmouseenter = () => (overlay.style.opacity = '1');
    container.onmouseleave = () => (overlay.style.opacity = '0');
  }

  function processAvatars() {
    const avatarSelectors = [
      'yt-avatar-shape img',
      '#avatar img',
      'ytd-channel-avatar-editor img',
      '.ytd-video-owner-renderer img[src*="yt"]',
    ];

    avatarSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(img => {
        if (img.src && img.src.includes('yt') && !img.closest('.avatar-overlay')) {
          addAvatarOverlay(img);
        }
      });
    });
  }

  function processBanners() {
    const bannerSelectors = [
      'yt-image-banner-view-model img',
      'ytd-c4-tabbed-header-renderer img[src*="yt"]',
      '#channel-header img[src*="banner"]',
    ];

    bannerSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(img => {
        if (
          img.src &&
          (img.src.includes('banner') || img.src.includes('yt')) &&
          !img.closest('.banner-overlay')
        ) {
          addBannerOverlay(img);
        }
      });
    });
  }

  function processThumbnails() {
    document.querySelectorAll('yt-thumbnail-view-model').forEach(addThumbnailOverlay);
    document.querySelectorAll('.ytd-thumbnail').forEach(addThumbnailOverlay);

    document.querySelectorAll('ytm-shorts-lockup-view-model').forEach(addThumbnailOverlay);
    document.querySelectorAll('.shortsLockupViewModelHost').forEach(addThumbnailOverlay);
    document.querySelectorAll('[class*="shortsLockupViewModelHost"]').forEach(addThumbnailOverlay);
  }

  function processAll() {
    processThumbnails();
    processAvatars();
    processBanners();
    addOrUpdateThumbnailImage();
  }

  function setupMutationObserver() {
    const observer = new MutationObserver(() => {
      setTimeout(processAll, 50);
    });

    // ✅ Safe observe with document.body check
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      });
    }
  }

  function setupUrlChangeDetection() {
    let currentUrl = location.href;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      originalPushState.apply(history, arguments);
      setTimeout(() => {
        if (location.href !== currentUrl) {
          currentUrl = location.href;
          setTimeout(addOrUpdateThumbnailImage, 500);
        }
      }, 100);
    };

    history.replaceState = function () {
      originalReplaceState.apply(history, arguments);
      setTimeout(() => {
        if (location.href !== currentUrl) {
          currentUrl = location.href;
          setTimeout(addOrUpdateThumbnailImage, 500);
        }
      }, 100);
    };

    window.addEventListener('popstate', function () {
      setTimeout(() => {
        if (location.href !== currentUrl) {
          currentUrl = location.href;
          setTimeout(addOrUpdateThumbnailImage, 500);
        }
      }, 100);
    });

    setInterval(function () {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        setTimeout(addOrUpdateThumbnailImage, 300);
      }
    }, 500);
  }

  function initialize() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(init, 100);
      });
    } else {
      setTimeout(init, 100);
    }
  }

  function init() {
    setupUrlChangeDetection();
    setupMutationObserver();
    processAll();
    setTimeout(processAll, 500);
    setTimeout(processAll, 1000);
    setTimeout(processAll, 2000);
  }

  initialize();
})();

// --- MODULE: comment.js ---

/**
 * Comment Manager Module
 * Provides bulk delete functionality and comment management tools for YouTube
 * @module CommentManager
 */
(function () {
  'use strict';

  /**
   * Configuration object for comment manager
   * @const {Object}
   */
  const CONFIG = {
    selectors: {
      deleteButtons: 'div[class^="VfPpkd-Bz112c-"]',
      menuButton: '[aria-haspopup="menu"]',
    },
    classes: {
      checkbox: 'comment-checkbox',
      checkboxAnchor: 'comment-checkbox-anchor',
      checkboxFloating: 'comment-checkbox-floating',
      container: 'comment-controls-container',
      panel: 'comment-controls-panel',
      header: 'comment-controls-header',
      title: 'comment-controls-title',
      actions: 'comment-controls-actions',
      button: 'comment-controls-button',
      buttonDanger: 'comment-controls-button--danger',
      buttonPrimary: 'comment-controls-button--primary',
      buttonSuccess: 'comment-controls-button--success',
      close: 'comment-controls-close',
      deleteButton: 'comment-controls-button-delete',
    },
    debounceDelay: 100,
    deleteDelay: 200,
    enabled: true,
    storageKey: 'youtube_comment_manager_settings',
  };

  // State management
  const state = {
    observer: null,
    isProcessing: false,
    settingsNavListenerKey: null,
    panelCollapsed: false,
  };

  // Optimized settings
  const settings = {
    load: () => {
      try {
        const saved = localStorage.getItem(CONFIG.storageKey);
        if (saved) CONFIG.enabled = JSON.parse(saved).enabled ?? true;
      } catch { }
    },
    save: () => {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({ enabled: CONFIG.enabled }));
      } catch { }
    },
  };

  // Utility functions: use shared debounce when available
  const debounce = (func, wait) => {
    try {
      return (
        (window.YouTubeUtils && window.YouTubeUtils.debounce) ||
        ((f, w) => {
          let timeout;
          return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => f(...args), w);
          };
        })(func, wait)
      );
    } catch {
      // fallback
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    }
  };

  /**
   * Safely query a single element
   * @param {string} selector - CSS selector
   * @returns {HTMLElement|null} The first matching element or null
   */
  const $ = selector => /** @type {HTMLElement|null} */(document.querySelector(selector));

  /**
   * Safely query multiple elements
   * @param {string} selector - CSS selector
   * @returns {NodeListOf<HTMLElement>} NodeList of matching elements
   */
  const $$ = selector =>
    /** @type {NodeListOf<HTMLElement>} */(document.querySelectorAll(selector));

  /**
   * Log error with error boundary integration
   * @param {string} context - Error context
   * @param {Error|string|unknown} error - Error object or message
   */
  const logError = (context, error) => {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    if (window.YouTubeErrorBoundary) {
      window.YouTubeErrorBoundary.logError(errorObj, { context });
    } else {
      console.error(`[YouTube+][CommentManager] ${context}:`, error);
    }
  };

  /**
   * Wraps function with error boundary protection
   * @template {Function} T
   * @param {T} fn - Function to wrap
   * @param {string} context - Error context for debugging
   * @returns {T} Wrapped function
   */
  const withErrorBoundary = (fn, context) => {
    if (window.YouTubeErrorBoundary?.withErrorBoundary) {
      return /** @type {T} */ (window.YouTubeErrorBoundary.withErrorBoundary(fn, 'CommentManager'));
    }
    return /** @type {any} */ (
      (...args) => {
        try {
          return fn(...args);
        } catch (error) {
          logError(context, error);
          return null;
        }
      }
    );
  };

  /**
   * Add checkboxes to comment elements for selection
   * Core functionality for bulk operations
   */
  const addCheckboxes = withErrorBoundary(() => {
    if (!CONFIG.enabled || state.isProcessing) return;

    const deleteButtons = $$(CONFIG.selectors.deleteButtons);

    deleteButtons.forEach(button => {
      const parent = button.parentNode;
      if (
        button.closest(CONFIG.selectors.menuButton) ||
        (parent && parent.querySelector && parent.querySelector(`.${CONFIG.classes.checkbox}`))
      ) {
        return;
      }

      const commentElement =
        button.closest('[class*="comment"]') || button.closest('[role="article"]') || parent;

      if (commentElement && commentElement instanceof Element) {
        if (!commentElement.hasAttribute('data-comment-text')) {
          commentElement.setAttribute(
            'data-comment-text',
            (commentElement.textContent || '').toLowerCase()
          );
        }
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = `${CONFIG.classes.checkbox} ytp-plus-settings-checkbox`;
      checkbox.setAttribute('aria-label', 'Select comment');

      checkbox.addEventListener('change', updateDeleteButtonState);
      checkbox.addEventListener('click', e => e.stopPropagation());

      // Optimized positioning
      const dateElement =
        commentElement && commentElement.querySelector
          ? commentElement.querySelector(
            '[class*="date"],[class*="time"],time,[title*="20"],[aria-label*="ago"]'
          )
          : null;

      if (dateElement && dateElement instanceof Element) {
        dateElement.classList.add(CONFIG.classes.checkboxAnchor);
        checkbox.classList.add(CONFIG.classes.checkboxFloating);
        dateElement.appendChild(checkbox);
      } else if (parent && parent.insertBefore) {
        parent.insertBefore(checkbox, button);
      }
    });
  }, 'addCheckboxes');

  /**
   * Add control panel with bulk action buttons
   */
  const addControlButtons = withErrorBoundary(() => {
    if (!CONFIG.enabled || $(`.${CONFIG.classes.container}`)) return;

    const deleteButtons = $$(CONFIG.selectors.deleteButtons);
    if (!deleteButtons.length) return;

    const first = deleteButtons[0];
    const container = first && first.parentNode && first.parentNode.parentNode;
    if (!container || !(container instanceof Element)) return;

    const panel = document.createElement('div');
    panel.className = `${CONFIG.classes.container} ${CONFIG.classes.panel} glass-panel`;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Comment manager controls');

    const header = document.createElement('div');
    header.className = CONFIG.classes.header;

    const title = document.createElement('div');
    title.className = CONFIG.classes.title;
    title.textContent = 'Comment Manager';

    const collapseButton = document.createElement('button');
    collapseButton.className = `${CONFIG.classes.close} ytp-plus-settings-close`;
    collapseButton.setAttribute('type', 'button');
    collapseButton.setAttribute('aria-expanded', String(!state.panelCollapsed));
    collapseButton.setAttribute('aria-label', 'Toggle panel');
    collapseButton.innerHTML = `
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
        </svg>
      `;

    const togglePanelState = collapsed => {
      state.panelCollapsed = collapsed;
      header.classList.toggle('is-collapsed', collapsed);
      actions.classList.toggle('is-hidden', collapsed);
      collapseButton.setAttribute('aria-expanded', String(!collapsed));
      panel.classList.toggle('is-collapsed', collapsed);
    };

    collapseButton.addEventListener('click', () => {
      state.panelCollapsed = !state.panelCollapsed;
      togglePanelState(state.panelCollapsed);
    });

    header.append(title, collapseButton);

    const actions = document.createElement('div');
    actions.className = CONFIG.classes.actions;

    const createActionButton = (label, className, onClick, options = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = `${CONFIG.classes.button} ${className}`;
      if (options.id) button.id = options.id;
      if (options.disabled) button.disabled = true;
      button.addEventListener('click', onClick);
      return button;
    };

    const deleteAllButton = createActionButton(
      'Delete Selected',
      `${CONFIG.classes.buttonDanger} ${CONFIG.classes.deleteButton}`,
      deleteSelectedComments,
      { disabled: true }
    );

    const selectAllButton = createActionButton('Select All', CONFIG.classes.buttonPrimary, () => {
      $$(`.${CONFIG.classes.checkbox}`).forEach(cb => (cb.checked = true));
      updateDeleteButtonState();
    });

    const clearAllButton = createActionButton('Clear All', CONFIG.classes.buttonSuccess, () => {
      $$(`.${CONFIG.classes.checkbox}`).forEach(cb => (cb.checked = false));
      updateDeleteButtonState();
    });

    actions.append(deleteAllButton, selectAllButton, clearAllButton);
    togglePanelState(state.panelCollapsed);

    panel.append(header, actions);

    const refNode = deleteButtons[0] && deleteButtons[0].parentNode;
    if (refNode && refNode.parentNode) {
      container.insertBefore(panel, refNode);
    } else {
      container.appendChild(panel);
    }
  }, 'addControlButtons');

  /**
   * Update delete button state based on checkbox selection
   */
  const updateDeleteButtonState = withErrorBoundary(() => {
    const deleteAllButton = $(`.${CONFIG.classes.deleteButton}`);
    if (!deleteAllButton) return;

    const hasChecked = Array.from($$(`.${CONFIG.classes.checkbox}`)).some(cb => cb.checked);
    deleteAllButton.disabled = !hasChecked;
    deleteAllButton.style.opacity = hasChecked ? '1' : '0.6';
  }, 'updateDeleteButtonState');

  /**
   * Delete selected comments with confirmation
   */
  const deleteSelectedComments = withErrorBoundary(() => {
    const checkedBoxes = Array.from($$(`.${CONFIG.classes.checkbox}`)).filter(cb => cb.checked);

    if (!checkedBoxes.length || !confirm(`Delete ${checkedBoxes.length} comment(s)?`)) return;

    state.isProcessing = true;
    checkedBoxes.forEach((checkbox, index) => {
      setTimeout(() => {
        const deleteButton =
          checkbox.nextElementSibling ||
          checkbox.parentNode.querySelector(CONFIG.selectors.deleteButtons);
        deleteButton?.click();
      }, index * CONFIG.deleteDelay);
    });

    setTimeout(() => (state.isProcessing = false), checkedBoxes.length * CONFIG.deleteDelay + 1000);
  }, 'deleteSelectedComments');

  /**
   * Clean up all comment manager elements
   */
  const cleanup = withErrorBoundary(() => {
    $$(`.${CONFIG.classes.checkbox}`).forEach(el => el.remove());
    $(`.${CONFIG.classes.container}`)?.remove();
  }, 'cleanup');

  /**
   * Initialize or cleanup script based on enabled state
   */
  const initializeScript = withErrorBoundary(() => {
    if (CONFIG.enabled) {
      addCheckboxes();
      addControlButtons();
      updateDeleteButtonState();
    } else {
      cleanup();
    }
  }, 'initializeScript');

  /**
   * Add enhanced CSS styles for comment manager UI
   */
  const addStyles = withErrorBoundary(() => {
    if ($('#comment-delete-styles')) return;

    const styles = `
  .${CONFIG.classes.checkboxAnchor}{position:relative;display:inline-flex;align-items:center;gap:8px;width:auto;}
        .${CONFIG.classes.checkboxFloating}{position:absolute;top:-4px;right:-32px;margin:0;}
        .${CONFIG.classes.panel}{position:fixed;top:50%;right:24px;transform:translateY(-50%);display:flex;flex-direction:column;gap:16px;z-index:9999;padding:18px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-lg);box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);min-width:220px;max-width:260px;color:var(--yt-text-primary);transition:transform .3s ease,opacity .3s ease;}
        html:not([dark]) .${CONFIG.classes.panel}{background:var(--yt-glass-bg);}
        .${CONFIG.classes.header}{display:flex;align-items:center;justify-content:space-between;gap:12px;}
  .${CONFIG.classes.panel}.is-collapsed{padding:14px 18px;}
  .${CONFIG.classes.panel}.is-collapsed .${CONFIG.classes.title}{font-weight:500;opacity:.85;}
  .${CONFIG.classes.panel}.is-collapsed .${CONFIG.classes.close}{transform:rotate(45deg);}
  .${CONFIG.classes.panel}.is-collapsed .${CONFIG.classes.actions}{display:none!important;}
        .${CONFIG.classes.title}{font-size:15px;font-weight:600;letter-spacing:.3px;}
        .${CONFIG.classes.close}{background:transparent;border:none;cursor:pointer;padding:6px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--yt-text-primary);transition:all .2s ease;}
        .${CONFIG.classes.close}:hover{transform:rotate(90deg) scale(1.05);color:var(--yt-accent);}
        .${CONFIG.classes.actions}{display:flex;flex-direction:column;gap:10px;}
  .${CONFIG.classes.actions}.is-hidden{display:none!important;}
        .${CONFIG.classes.button}{padding:12px 16px;border-radius:var(--yt-radius-md);border:1px solid var(--yt-glass-border);cursor:pointer;font-size:13px;font-weight:500;background:var(--yt-button-bg);color:var(--yt-text-primary);transition:all .2s ease;text-align:center;}
        .${CONFIG.classes.button}:disabled{opacity:.5;cursor:not-allowed;}
        .${CONFIG.classes.button}:not(:disabled):hover{transform:translateY(-1px);box-shadow:var(--yt-shadow);}
        .${CONFIG.classes.buttonDanger}{background:rgba(255,99,71,.12);border-color:rgba(255,99,71,.25);color:#ff5c5c;}
        .${CONFIG.classes.buttonPrimary}{background:rgba(33,150,243,.12);border-color:rgba(33,150,243,.25);color:#2196f3;}
        .${CONFIG.classes.buttonSuccess}{background:rgba(76,175,80,.12);border-color:rgba(76,175,80,.25);color:#4caf50;}
        .${CONFIG.classes.buttonDanger}:not(:disabled):hover{background:rgba(255,99,71,.22);}
        .${CONFIG.classes.buttonPrimary}:not(:disabled):hover{background:rgba(33,150,243,.22);}
        .${CONFIG.classes.buttonSuccess}:not(:disabled):hover{background:rgba(76,175,80,.22);}
        @media(max-width:1280px){
          .${CONFIG.classes.panel}{top:auto;bottom:24px;transform:none;right:16px;}
        }
        @media(max-width:768px){
          .${CONFIG.classes.panel}{position:fixed;left:16px;right:16px;bottom:16px;top:auto;transform:none;max-width:none;}
          .${CONFIG.classes.actions}{flex-direction:row;flex-wrap:wrap;}
          .${CONFIG.classes.button}{flex:1;min-width:140px;}
        }
      `;
    YouTubeUtils.StyleManager.add('comment-delete-styles', styles);
  }, 'addStyles');

  /**
   * Add comment manager settings to YouTube+ settings panel
   */
  const addCommentManagerSettings = withErrorBoundary(() => {
    const advancedSection = $('.ytp-plus-settings-section[data-section="advanced"]');
    if (!advancedSection) return;

    // If already exists, move it to the bottom to ensure Comment Manager is last
    const existing = $('.comment-manager-settings-item');
    if (existing) {
      try {
        advancedSection.appendChild(existing);
      } catch {
        // ignore
      }
      return;
    }

    const settingsItem = document.createElement('div');
    settingsItem.className = 'ytp-plus-settings-item comment-manager-settings-item';
    settingsItem.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Comment Manager</label>
          <div class="ytp-plus-settings-item-description">Add bulk delete functionality for managing comments on YouTube</div>
        </div>
        <button class="ytp-plus-button" id="open-comment-history-page" style="margin:0 0 0 30px;padding:12px 16px;font-size:13px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15,3 21,3 21,9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      `;

    // Append to end (ensure it's the bottom-most item)
    advancedSection.appendChild(settingsItem);

    $('#open-comment-history-page').addEventListener('click', () => {
      window.open('https://www.youtube.com/feed/history/comment_history', '_blank');
    });
  }, 'addCommentManagerSettings');

  /**
   * Initialize comment manager module
   * Sets up observers, event listeners, and initial state
   */
  const init = withErrorBoundary(() => {
    settings.load();
    addStyles();

    // Setup observer with throttling
    state.observer?.disconnect();
    state.observer = new MutationObserver(debounce(initializeScript, CONFIG.debounceDelay));

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(state.observer);

    // ✅ Safe observe with document.body check
    if (document.body) {
      state.observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        state.observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    // Initial setup
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeScript);
    } else {
      initializeScript();
    }

    // Settings modal integration
    const settingsObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
            setTimeout(addCommentManagerSettings, 100);
            return;
          }
        }
      }
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(settingsObserver);

    // ✅ Safe observe with document.body check
    if (document.body) {
      settingsObserver.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        settingsObserver.observe(document.body, { childList: true, subtree: true });
      });
    }

    const handleAdvancedNavClick = e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (target.dataset?.section === 'advanced') {
        setTimeout(addCommentManagerSettings, 50);
      }
    };

    if (!state.settingsNavListenerKey) {
      state.settingsNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
        document,
        'click',
        handleAdvancedNavClick,
        { passive: true, capture: true }
      );
    }
  }, 'init');

  // Start the module
  init();
})();

// --- MODULE: update.js ---

// Update checker module
(function () {
  'use strict';

  const UPDATE_CONFIG = {
    enabled: true,
    checkInterval: 24 * 60 * 60 * 1000, // 24 hours
    updateUrl: 'https://update.greasyfork.org/scripts/537017/YouTube%20%2B.meta.js',
    currentVersion: '2.0',
    storageKey: 'youtube_plus_update_check',
    notificationDuration: 8000,
    autoInstallUrl: 'https://update.greasyfork.org/scripts/537017/YouTube%20%2B.user.js',
  };

  const updateState = {
    lastCheck: 0,
    lastVersion: UPDATE_CONFIG.currentVersion,
    updateAvailable: false,
    checkInProgress: false,
    updateDetails: null,
  };

  // Optimized utilities
  const utils = {
    loadSettings: () => {
      try {
        const saved = localStorage.getItem(UPDATE_CONFIG.storageKey);
        if (saved) Object.assign(updateState, JSON.parse(saved));
      } catch (e) {
        console.warn('[YouTube+] Failed to load update settings:', e);
      }
    },

    saveSettings: () => {
      try {
        localStorage.setItem(
          UPDATE_CONFIG.storageKey,
          JSON.stringify({
            lastCheck: updateState.lastCheck,
            lastVersion: updateState.lastVersion,
            updateAvailable: updateState.updateAvailable,
            updateDetails: updateState.updateDetails,
          })
        );
      } catch (e) {
        console.warn('[YouTube+] Failed to save update settings:', e);
      }
    },

    compareVersions: (v1, v2) => {
      const normalize = v =>
        v
          .replace(/[^\d.]/g, '')
          .split('.')
          .map(n => parseInt(n) || 0);
      const [parts1, parts2] = [normalize(v1), normalize(v2)];
      const maxLength = Math.max(parts1.length, parts2.length);

      for (let i = 0; i < maxLength; i++) {
        const diff = (parts1[i] || 0) - (parts2[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    },

    parseMetadata: text => {
      const extractField = field =>
        text.match(new RegExp(`@${field}\\s+([^\\r\\n]+)`))?.[1]?.trim();
      return {
        version: extractField('version'),
        description: extractField('description') || '',
        downloadUrl: extractField('downloadURL') || UPDATE_CONFIG.autoInstallUrl,
      };
    },

    formatTimeAgo: timestamp => {
      if (!timestamp) return 'Never';
      const diffMs = Date.now() - timestamp;
      const diffDays = Math.floor(diffMs / 86400000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffMinutes = Math.floor(diffMs / 60000);

      if (diffDays > 0) return `${diffDays}d ago`;
      if (diffHours > 0) return `${diffHours}h ago`;
      if (diffMinutes > 0) return `${diffMinutes}m ago`;
      return 'Just now';
    },

    showNotification: (text, type = 'info', duration = 3000) => {
      YouTubeUtils.NotificationManager.show(text, { type, duration });
    },
  };

  // Enhanced update notification
  const showUpdateNotification = updateDetails => {
    const notification = document.createElement('div');
    notification.className = 'youtube-enhancer-notification update-notification';
    notification.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 10001; max-width: 350px;
        background: linear-gradient(135deg, rgba(255, 69, 0, 0.95), rgba(255, 140, 0, 0.95));
        color: white; padding: 16px 20px; border-radius: 12px;
        box-shadow: 0 8px 32px rgba(255, 69, 0, 0.4); backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        animation: slideInFromRight 0.4s ease-out;
      `;

    notification.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="background: rgba(255, 255, 255, 0.2); border-radius: 8px; padding: 8px; flex-shrink: 0;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12c0 1-1 2-1 2s-1-1-1-2 1-2 1-2 1 1 1 2z"/>
              <path d="m21 12-5-5v3H8v4h8v3l5-5z"/>
            </svg>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px;">YouTube + Update Available</div>
            <div style="font-size: 13px; opacity: 0.9; margin-bottom: 12px;">
              Version ${updateDetails.version} • ${updateDetails.description || 'New features and improvements'}
            </div>
            <div style="display: flex; gap: 8px;">
              <button id="update-install-btn" style="
                background: rgba(255, 255, 255, 0.9); color: #ff4500; border: none;
                padding: 8px 16px; border-radius: 6px; cursor: pointer;
                font-size: 13px; font-weight: 600; transition: all 0.2s ease;
              ">Install Update</button>
              <button id="update-dismiss-btn" style="
                background: rgba(255, 255, 255, 0.1); color: white;
                border: 1px solid rgba(255, 255, 255, 0.3); padding: 8px 12px;
                border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.2s ease;
              ">Later</button>
            </div>
          </div>
        </div>
        <style>
          @keyframes slideInFromBottom {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        </style>
      `;

    document.body.appendChild(notification);

    const removeNotification = () => {
      notification.style.animation = 'slideInFromRight 0.3s ease-in reverse';
      setTimeout(() => notification.remove(), 300);
    };

    // Event handlers
    notification.querySelector('#update-install-btn').addEventListener('click', () => {
      try {
        window.open(updateDetails.downloadUrl, '_blank');
        sessionStorage.setItem('update_dismissed', updateDetails.version);
        removeNotification();
        setTimeout(
          () =>
            utils.showNotification('Update started! Follow your userscript manager instructions.'),
          500
        );
      } catch (error) {
        console.error('Error installing update:', error);
        window.open('https://greasyfork.org/en/scripts/537017-youtube', '_blank');
        removeNotification();
      }
    });

    notification.querySelector('#update-dismiss-btn').addEventListener('click', () => {
      sessionStorage.setItem('update_dismissed', updateDetails.version);
      removeNotification();
    });

    notification.querySelector('#update-close-btn').addEventListener('click', removeNotification);

    // Auto-dismiss
    setTimeout(() => {
      if (notification.isConnected) removeNotification();
    }, UPDATE_CONFIG.notificationDuration);
  };

  // Optimized update checker
  const checkForUpdates = async (force = false) => {
    if (!UPDATE_CONFIG.enabled || updateState.checkInProgress) return;

    const now = Date.now();
    if (!force && now - updateState.lastCheck < UPDATE_CONFIG.checkInterval) return;

    updateState.checkInProgress = true;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(UPDATE_CONFIG.updateUrl, {
        method: 'GET',
        cache: 'no-cache',
        signal: controller.signal,
        headers: { Accept: 'text/plain', 'User-Agent': 'YouTube+ UpdateChecker' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const metaText = await response.text();
      const updateDetails = utils.parseMetadata(metaText);

      if (updateDetails.version) {
        updateState.lastCheck = now;
        updateState.lastVersion = updateDetails.version;
        updateState.updateDetails = updateDetails;

        const comparison = utils.compareVersions(
          UPDATE_CONFIG.currentVersion,
          updateDetails.version
        );
        updateState.updateAvailable = comparison < 0;

        if (
          updateState.updateAvailable &&
          (force || sessionStorage.getItem('update_dismissed') !== updateDetails.version)
        ) {
          showUpdateNotification(updateDetails);
          console.log(`YouTube + Update available: ${updateDetails.version}`);
        } else if (force) {
          utils.showNotification(
            updateState.updateAvailable
              ? `Update ${updateDetails.version} available!`
              : `You're using the latest version (${UPDATE_CONFIG.currentVersion})`
          );
        }

        utils.saveSettings();
      }
    } catch (error) {
      console.error('Update check failed:', error);
      if (force) utils.showNotification(`Update check failed: ${error.message}`, 'error', 4000);
    } finally {
      updateState.checkInProgress = false;
    }
  };

  // Optimized settings UI
  const addUpdateSettings = () => {
    // ✅ Use cached querySelector
    const aboutSection = YouTubeUtils.querySelector(
      '.ytp-plus-settings-section[data-section="about"]'
    );
    if (!aboutSection || YouTubeUtils.querySelector('.update-settings-container')) return;

    const updateContainer = document.createElement('div');
    updateContainer.className = 'update-settings-container';
    updateContainer.style.cssText = `
        padding: 16px; margin-top: 20px; border-radius: 12px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
        border: 1px solid var(--yt-glass-border); backdrop-filter: blur(8px);
      `;

    const lastCheckTime = utils.formatTimeAgo(updateState.lastCheck);

    updateContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--yt-spec-text-primary);">
            Enhanced YouTube experience with powerful features
          </h3>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; 
                    padding: 16px; background: rgba(255, 255, 255, 0.03); border-radius: 10px; margin-bottom: 16px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 14px; font-weight: 600; color: var(--yt-spec-text-primary);">Current Version</span>
              <span style="font-size: 13px; font-weight: 600; color: var(--yt-spec-text-primary); 
                           padding: 3px 10px; background: rgba(255, 255, 255, 0.1); border-radius: 12px; 
                           border: 1px solid rgba(255, 255, 255, 0.2);">${UPDATE_CONFIG.currentVersion}</span>
            </div>
            <div style="font-size: 12px; color: var(--yt-spec-text-secondary);">
              Last checked: <span style="font-weight: 500;">${lastCheckTime}</span>
              ${updateState.lastVersion && updateState.lastVersion !== UPDATE_CONFIG.currentVersion
        ? `<br>Latest available: <span style="color: #ff6666; font-weight: 600;">${updateState.lastVersion}</span>`
        : ''
      }
            </div>
          </div>
          
          ${updateState.updateAvailable
        ? `
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; 
                          background: linear-gradient(135deg, rgba(255, 68, 68, 0.2), rgba(255, 68, 68, 0.3)); 
                          border: 1px solid rgba(255, 68, 68, 0.4); border-radius: 20px;">
                <div style="width: 6px; height: 6px; background: #ff4444; border-radius: 50%; animation: pulse 2s infinite;"></div>
                <span style="font-size: 11px; color: #ff6666; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  Update Available
                </span>
              </div>
              <button id="install-update-btn" style="background: linear-gradient(135deg, #ff4500, #ff6b35); 
                      color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; 
                      font-size: 12px; font-weight: 600; transition: all 0.3s ease; 
                      box-shadow: 0 4px 12px rgba(255, 69, 0, 0.3);">Install Now</button>
            </div>
          `
        : `
            <div style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; 
                        background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(34, 197, 94, 0.3)); 
                        border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 20px;">
              <div style="width: 6px; height: 6px; background: #22c55e; border-radius: 50%;"></div>
              <span style="font-size: 11px; color: #22c55e; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                Up to Date
              </span>
            </div>
          `
      }
        </div>
        
        <div style="display: flex; gap: 12px;">
          <button class="ytp-plus-button ytp-plus-button-primary" id="manual-update-check" 
                  style="flex: 1; padding: 12px; font-size: 13px; font-weight: 600;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M19.13 11.48A10 10 0 0 0 12 2C6.48 2 2 6.48 2 12c0 .34.02.67.05 1M4.87 12.52A10 10 0 0 0 12 22c5.52 0 10-4.48 10-10 0-.34-.02-.67-.05-1"/>
            </svg>
            Check for Updates
          </button>
          <button class="ytp-plus-button" id="open-update-page" 
                  style="padding: 12px 16px; font-size: 13px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15,3 21,3 21,9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
        </div>

        <style>
          @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.1); } }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        </style>
      `;

    aboutSection.appendChild(updateContainer);

    // Event listeners with optimization
    const attachClickHandler = (id, handler) => {
      const element = document.getElementById(id);
      if (element) YouTubeUtils.cleanupManager.registerListener(element, 'click', handler);
    };

    attachClickHandler('manual-update-check', async e => {
      const button = /** @type {EventTarget & HTMLElement} */ (e.target);
      const originalHTML = button.innerHTML;

      button.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" 
               style="margin-right: 6px; animation: spin 1s linear infinite;">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M19.13 11.48A10 10 0 0 0 12 2C6.48 2 2 6.48 2 12c0 .34.02.67.05 1M4.87 12.52A10 10 0 0 0 12 22c5.52 0 10-4.48 10-10 0-.34-.02-.67-.05-1"/>
          </svg>
          Checking...
        `;
      button.disabled = true;

      await checkForUpdates(true);

      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.disabled = false;
      }, 1000);
    });

    attachClickHandler('install-update-btn', () => {
      const url =
        updateState.updateDetails?.downloadUrl ||
        'https://greasyfork.org/en/scripts/537017-youtube';
      window.open(url, '_blank');
    });

    attachClickHandler('open-update-page', () => {
      window.open('https://greasyfork.org/en/scripts/537017-youtube', '_blank');
    });
  };

  // Optimized initialization
  const init = () => {
    utils.loadSettings();

    // Initial check with delay
    setTimeout(() => checkForUpdates(), 3000);

    // Periodic checks
    // ✅ Register interval in cleanupManager
    const intervalId = setInterval(() => checkForUpdates(), UPDATE_CONFIG.checkInterval);
    YouTubeUtils.cleanupManager.registerInterval(intervalId);
    window.addEventListener('beforeunload', () => clearInterval(intervalId));

    // Optimized settings modal observer
    let settingsObserved = false;
    const observer = new MutationObserver(mutations => {
      if (settingsObserved) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
            settingsObserved = true;
            setTimeout(addUpdateSettings, 100);
            return;
          }
        }
      }

      // ✅ Use cached querySelector
      const aboutNavItem = YouTubeUtils.querySelector(
        '.ytp-plus-settings-nav-item[data-section="about"].active:not([data-observed])'
      );
      if (aboutNavItem) {
        aboutNavItem.setAttribute('data-observed', '');
        setTimeout(addUpdateSettings, 50);
      }
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(observer);

    // ✅ Safe observe with document.body check
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    // Optimized click handler
    // ✅ Register global listener in cleanupManager
    const clickHandler = e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (
        target.classList?.contains('ytp-plus-settings-nav-item') &&
        target.dataset?.section === 'about'
      ) {
        setTimeout(addUpdateSettings, 50);
      }
    };
    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, {
      passive: true,
      capture: true,
    });

    console.log('YouTube + Update Checker initialized', {
      version: UPDATE_CONFIG.currentVersion,
      enabled: UPDATE_CONFIG.enabled,
      lastCheck: new Date(updateState.lastCheck).toLocaleString(),
      updateAvailable: updateState.updateAvailable,
    });
  };

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();