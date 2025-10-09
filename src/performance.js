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
        } catch {}
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
    } catch {}

    if (typeof performance !== 'undefined' && performance.clearMarks) {
      try {
        performance.clearMarks();
        performance.clearMeasures();
      } catch {}
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
