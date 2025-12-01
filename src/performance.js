// Performance monitoring for YouTube+ userscript
(function () {
  'use strict';

  /* global Blob, URL */

  /**
   * Performance monitoring configuration
   * Optimized for minimal overhead in production
   */
  const PerformanceConfig = {
    enabled: true,
    sampleRate: 0.01, // 1% sampling in production (10x reduction for lower overhead)
    storageKey: 'youtube_plus_performance',
    metricsRetention: 30, // Keep last 30 metrics (reduced from 50)
    enableConsoleOutput: false,
    // Performance budgets (in milliseconds)
    budgets: {
      initialization: 100,
      domManipulation: 50,
      apiCall: 500,
      rendering: 16, // ~60fps
    },
    // Lazy loading threshold - don't track until this many ms after page load
    lazyLoadThreshold: 5000, // 5 seconds to significantly reduce startup overhead
    // Auto-disable if performance impact is too high
    maxOverhead: 30, // Maximum acceptable overhead in ms (reduced from 50)
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
   * Lazy initialization state
   */
  let initialized = false;
  const initTime = Date.now();

  /**
   * Check if performance tracking should sample this operation
   * @returns {boolean} Whether to track this operation
   */
  const shouldSample = () => {
    if (!PerformanceConfig.enabled) return false;
    if (PerformanceConfig.sampleRate >= 1.0) return true;
    return Math.random() < PerformanceConfig.sampleRate;
  };

  /**
   * Check if enough time has passed since page load for lazy tracking
   * @returns {boolean} Whether lazy threshold has been met
   */
  const isLazyLoadComplete = () => {
    if (!initialized && Date.now() - initTime >= PerformanceConfig.lazyLoadThreshold) {
      initialized = true;
    }
    return initialized;
  };

  /**
   * Create a performance mark
   * @param {string} name - Mark name
   */
  const mark = name => {
    if (!PerformanceConfig.enabled || !shouldSample()) return;
    if (!isLazyLoadComplete()) return; // Skip until lazy threshold is met

    try {
      if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark(name);
      }
      metrics.marks.set(name, Date.now());
    } catch (e) {
      console.warn('[YouTube+][Performance]', 'Failed to create mark:', e);
    }
  };

  /**
   * Measure time between two marks
   * @param {string} name - Measure name
   * @param {string} startMark - Start mark name
   * @param {string} [endMark] - End mark name (optional, uses current time if not provided)
   * @returns {number} Duration in milliseconds
   */
  /**
   * Check if measurement should be performed
   * @returns {boolean} True if measurement should proceed
   */
  const canMeasure = () => {
    if (!PerformanceConfig.enabled || !shouldSample()) return false;
    if (!isLazyLoadComplete()) return false;
    return true;
  };

  /**
   * Calculate duration between marks
   * @param {string} startMark - Start mark name
   * @param {string} endMark - End mark name
   * @returns {{duration: number, endTime: number} | null} Duration and end time or null
   */
  const calculateDuration = (startMark, endMark) => {
    const startTime = metrics.marks.get(startMark);
    if (!startTime) {
      console.warn('[YouTube+][Performance]', `Start mark "${startMark}" not found`);
      return null;
    }

    const endTime = endMark ? metrics.marks.get(endMark) : Date.now();
    const duration = endTime - startTime;

    return { duration, endTime };
  };

  /**
   * Store measurement data
   * @param {string} name - Measurement name
   * @param {string} startMark - Start mark name
   * @param {string} endMark - End mark name
   * @param {number} duration - Duration in milliseconds
   */
  const storeMeasurement = (name, startMark, endMark, duration) => {
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
  };

  /**
   * Check if performance budget is exceeded
   * @param {string} name - Measurement name
   * @param {number} duration - Duration in milliseconds
   * @returns {boolean} True if budget exceeded
   */
  const checkBudgetExceeded = (name, duration) => {
    for (const [category, budget] of Object.entries(PerformanceConfig.budgets)) {
      if (name.toLowerCase().includes(category.toLowerCase()) && duration > budget) {
        console.warn(
          '[YouTube+][Performance]',
          `⚠️ Budget exceeded: ${name} took ${duration.toFixed(2)}ms (budget: ${budget}ms)`
        );
        return true;
      }
    }
    return false;
  };

  /**
   * Log measurement result
   * @param {string} name - Measurement name
   * @param {number} duration - Duration in milliseconds
   * @param {boolean} budgetExceeded - Whether budget was exceeded
   */
  const logMeasurement = (name, duration, budgetExceeded) => {
    if (PerformanceConfig.enableConsoleOutput || budgetExceeded) {
      const status = budgetExceeded ? '⚠️' : '✓';
      console.log('[YouTube+][Performance]', `${status} ${name}: ${duration.toFixed(2)}ms`);
    }
  };

  /**
   * Try to use native performance API
   * @param {string} name - Measurement name
   * @param {string} startMark - Start mark name
   * @param {string} endMark - End mark name
   */
  const tryNativePerformanceAPI = (name, startMark, endMark) => {
    if (typeof performance !== 'undefined' && performance.measure) {
      try {
        performance.measure(name, startMark, endMark);
      } catch {
        // Ignore errors from native API
      }
    }
  };

  const measure = (name, startMark, endMark) => {
    if (!canMeasure()) return 0;

    try {
      const result = calculateDuration(startMark, endMark);
      if (!result) return 0;

      const { duration } = result;

      storeMeasurement(name, startMark, endMark, duration);
      const budgetExceeded = checkBudgetExceeded(name, duration);
      logMeasurement(name, duration, budgetExceeded);
      tryNativePerformanceAPI(name, startMark, endMark);

      return duration;
    } catch (e) {
      console.warn('[YouTube+][Performance]', 'Failed to measure:', e);
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
      if (!shouldSample() || !isLazyLoadComplete()) {
        const fnAny = /** @type {any} */ (fn);
        return fnAny.call(this, ...args);
      }
      const startMark = `${name}-start-${Date.now()}`;
      mark(startMark);

      try {
        const fnAny = /** @type {any} */ (fn);
        const result = fnAny.call(this, ...args);

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
      if (!shouldSample() || !isLazyLoadComplete()) {
        const fnAny = /** @type {any} */ (fn);
        return await fnAny.call(this, ...args);
      }
      const startMark = `${name}-start-${Date.now()}`;
      mark(startMark);

      try {
        const fnAny = /** @type {any} */ (fn);
        const result = await fnAny.call(this, ...args);
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
      console.log('[YouTube+][Performance]', `${name}: ${value}`, metadata);
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
   * Get memory usage information
   * @returns {Object|null} Memory usage data
   */
  const getMemoryUsage = () => {
    if (typeof performance === 'undefined' || !performance.memory) {
      return null;
    }

    try {
      const { memory } = performance;
      return {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
        usedPercent: ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(2),
      };
    } catch {
      return null;
    }
  };

  /**
   * Track memory usage as a metric
   */
  const trackMemory = () => {
    const memory = getMemoryUsage();
    if (memory) {
      recordMetric('memory-usage', memory.usedJSHeapSize, {
        totalJSHeapSize: memory.totalJSHeapSize,
        usedPercent: memory.usedPercent,
      });
    }
  };

  /**
   * Check if metrics exceed thresholds
   * @param {Object} thresholds - Threshold configuration
   * @returns {Array} Array of threshold violations
   */
  const checkThresholds = thresholds => {
    const violations = [];
    const allStats = getStats(undefined);

    if (!allStats || !allStats.metrics) return violations;

    Object.entries(thresholds).forEach(([metricName, threshold]) => {
      const stat = allStats.metrics[metricName];
      if (stat && stat.avg > threshold) {
        violations.push({
          metric: metricName,
          threshold,
          actual: stat.avg,
          exceeded: stat.avg - threshold,
        });
      }
    });

    return violations;
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
      memory: getMemoryUsage(),
      stats: getStats(undefined),
      measures: metrics.measures,
      customMetrics: Object.fromEntries(metrics.timings),
    };

    return JSON.stringify(data, null, 2);
  };

  /**
   * Export metrics to downloadable file
   * @param {string} filename - Filename for export
   * @returns {boolean} Success status
   */
  const exportToFile = (filename = 'youtube-plus-performance.json') => {
    try {
      const data = exportMetrics();
      if (typeof Blob === 'undefined') {
        console.warn('[YouTube+][Performance]', 'Blob API not available');
        return false;
      }
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      console.error('[YouTube+][Performance]', 'Failed to export to file:', e);
      return false;
    }
  };

  /**
   * Aggregate metrics by time period
   * @param {number} periodMs - Time period in milliseconds
   * @returns {Array} Aggregated metrics
   */
  const aggregateByPeriod = (periodMs = 60000) => {
    const periods = new Map();

    metrics.measures.forEach(measureItem => {
      const periodStart = Math.floor(measureItem.timestamp / periodMs) * periodMs;
      if (!periods.has(periodStart)) {
        periods.set(periodStart, []);
      }
      periods.get(periodStart).push(measureItem);
    });

    const aggregated = [];
    periods.forEach((measures, periodStart) => {
      const durations = measures.map(m => m.duration);
      aggregated.push({
        period: new Date(periodStart).toISOString(),
        count: durations.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      });
    });

    return aggregated;
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
      console.warn('[YouTube+][Performance]', 'Failed to log page metrics:', e);
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
      exportToFile,
      clearMetrics,
      monitorMutations,
      getPerformanceEntries,
      getMemoryUsage,
      trackMemory,
      checkThresholds,
      aggregateByPeriod,
      config: PerformanceConfig,
    };

    console.log('[YouTube+][Performance]', 'Performance monitoring initialized');
  }
})();
