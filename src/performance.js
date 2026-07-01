/**
 * YouTube+ Diagnostics & Profiling
 *
 * Canonical owner: diagnostics / profiling only.
 *
 * The module measures the running userscript and records timing data. It does
 * NOT modify the page, own feature lifecycle, or act as a shared utility bag.
 * If you find yourself wanting to add a `RAFScheduler`, `DOMBatcher`,
 * `IntersectionObserver` helper, or INP-yielding wrapper here, it belongs in
 * a different canonical module instead (e.g. mutation-coordinator.js,
 * dom-cache.js, design-system.js).
 *
 * Public surface (window.YouTubePerformance):
 *   - mark(name)                       create a performance mark
 *   - measure(name, startMark, end?)   measure duration between two marks
 *   - timeFunction(name, fn)           wrap a sync fn with timing
 *   - timeAsyncFunction(name, fn)      wrap an async fn with timing
 *   - recordMetric(name, value, meta?) record a custom metric
 *   - getStats(name?)                  aggregate stats for one or all metrics
 *   - getPerformanceEntries(type)      wrap performance.getEntriesByType
 *   - clearMetrics()                   reset all recorded data
 *   - config                           { enabled, sampleRate }
 *
 * Auto-initialised on load (idempotent):
 *   - Web Vitals observers (LCP, CLS, FID, INP)
 *   - long-task observer
 *   - page-load timing
 *   - SPA navigation marks (yt-navigate-start / yt-navigate-finish)
 *
 * To disable everything at runtime: window.YouTubePerformance.config.enabled = false
 */
(function () {
  /* global PerformanceObserver */

  if (typeof window !== 'undefined' && window.YouTubePerformance) {
    return;
  }

  const isTestEnv = (() => {
    try {
      return typeof process !== 'undefined' && !!process?.env?.JEST_WORKER_ID;
    } catch {
      return false;
    }
  })();

  const logger = window.YouTubeUtils?.logger || window.YouTubePlusLogger || null;

  const config = {
    enabled: true,
    // 100% in tests to keep diagnostics deterministic; 1% in production by default.
    sampleRate: isTestEnv ? 1.0 : 0.01,
    metricsRetention: 100,
  };

  // Honor a user-configured sample rate when present.
  if (!isTestEnv) {
    try {
      const cfg = window.YouTubePlusConfig;
      const explicit =
        cfg?.performance?.sampleRate ??
        cfg?.performanceSampleRate ??
        cfg?.perfSampleRate ??
        undefined;
      if (typeof explicit === 'number' && Number.isFinite(explicit)) {
        config.sampleRate = Math.min(1, Math.max(0, explicit));
      }
    } catch {
      /* no-op */
    }
    // Sampling gate: keep the API available but disable observers/recording
    // when this session is not selected.
    if (config.sampleRate < 1 && Math.random() > config.sampleRate) {
      config.enabled = false;
    }
  }

  /** @type {{ timings: Map<string, any>, marks: Map<string, number>, measures: any[], webVitals: { LCP: number|null, CLS: number, FID: number|null, INP: number|null, FCP: number|null, TTFB: number|null } }} */
  const metrics = {
    timings: new Map(),
    marks: new Map(),
    measures: [],
    webVitals: { LCP: null, CLS: 0, FID: null, INP: null, FCP: null, TTFB: null },
  };

  /**
   * @param {string} name
   */
  const mark = name => {
    if (!config.enabled) return;
    try {
      if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark(name);
      }
      metrics.marks.set(name, Date.now());
    } catch (e) {
      logger?.warn?.('Performance', 'Failed to create mark', e);
    }
  };

  /**
   * @param {string} name
   * @param {string} startMark
   * @param {string} [endMark]
   * @returns {number}
   */
  const measure = (name, startMark, endMark) => {
    if (!config.enabled) return 0;
    try {
      const startTime = metrics.marks.get(startMark);
      if (!startTime) return 0; // Missing start mark; stay quiet in hot paths.

      const endTime = endMark ? (metrics.marks.get(endMark) ?? Date.now()) : Date.now();
      const duration = endTime - startTime;

      metrics.measures.push({
        name,
        startMark,
        endMark: endMark || 'now',
        duration,
        timestamp: Date.now(),
      });
      if (metrics.measures.length > config.metricsRetention) {
        metrics.measures.shift();
      }

      if (typeof performance !== 'undefined' && performance.measure) {
        try {
          performance.measure(name, startMark, endMark);
        } catch {
          /* no-op */
        }
      }
      return duration;
    } catch (e) {
      logger?.warn?.('Performance', 'Failed to measure', e);
      return 0;
    }
  };

  /**
   * @param {string} name
   * @param {(...args: any[]) => any} fn
   */
  const timeFunction = (name, fn) => {
    if (!config.enabled) return fn;
    return /** @this {any} */ function (/** @type {any[]} */ ...args) {
      const startMark = `${name}-start`;
      mark(startMark);
      try {
        const result = fn.apply(this, args);
        const maybePromise = /** @type {{ then?: unknown; finally?: unknown }} */ (result);
        if (
          result &&
          typeof maybePromise.then === 'function' &&
          typeof maybePromise.finally === 'function'
        ) {
          return /** @type {any} */ (maybePromise.finally)(() => {
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
   * @param {string} name
   * @param {(...args: any[]) => Promise<any>} fn
   */
  const timeAsyncFunction = (name, fn) => {
    if (!config.enabled) return fn;
    return /** @this {any} */ async function (/** @type {any[]} */ ...args) {
      const startMark = `${name}-start`;
      mark(startMark);
      try {
        const result = await fn.apply(this, args);
        measure(name, startMark, undefined);
        return result;
      } catch (error) {
        measure(name, startMark, undefined);
        throw error;
      }
    };
  };

  /**
   * @param {string} name
   * @param {number} value
   * @param {Record<string, any>} [metadata]
   */
  const recordMetric = (name, value, metadata = {}) => {
    if (!config.enabled) return;
    metrics.timings.set(name, {
      name,
      value,
      timestamp: Date.now(),
      ...metadata,
    });
  };

  /**
   * @param {string} [metricName]
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
    /** @type {Record<string, any>} */
    const allMetrics = {};
    const names = [...new Set(metrics.measures.map(m => m.name))];
    names.forEach(n => {
      allMetrics[n] = getStats(n);
    });
    return {
      metrics: allMetrics,
      webVitals: { ...metrics.webVitals },
      totalMeasures: metrics.measures.length,
      totalMarks: metrics.marks.size,
      customMetrics: Object.fromEntries(metrics.timings),
    };
  };

  /**
   * @param {string} type
   * @returns {any[]}
   */
  const getPerformanceEntries = type => {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) return [];
    try {
      return performance.getEntriesByType(type);
    } catch {
      return [];
    }
  };

  const clearMetrics = () => {
    metrics.timings.clear();
    metrics.marks.clear();
    metrics.measures = [];
    metrics.webVitals = { LCP: null, CLS: 0, FID: null, INP: null, FCP: null, TTFB: null };
    if (typeof performance !== 'undefined') {
      try {
        performance.clearMarks?.();
        performance.clearMeasures?.();
      } catch {
        /* no-op */
      }
    }
  };

  const initPerformanceObserver = () => {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      new PerformanceObserver(entryList => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        if (lastEntry) metrics.webVitals.LCP = lastEntry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });

      new PerformanceObserver(entryList => {
        for (const entry of entryList.getEntries()) {
          const layoutShiftEntry = /** @type {{ hadRecentInput?: boolean; value?: number }} */ (
            entry
          );
          if (!layoutShiftEntry.hadRecentInput) {
            metrics.webVitals.CLS += layoutShiftEntry.value || 0;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });

      new PerformanceObserver(entryList => {
        const firstInput = /** @type {any} */ (entryList.getEntries()[0]);
        metrics.webVitals.FID = (firstInput?.processingStart || 0) - (firstInput?.startTime || 0);
      }).observe({ type: 'first-input', buffered: true });

      try {
        new PerformanceObserver(entryList => {
          const entries = entryList.getEntries();
          if (entries.length > 0) {
            const maxDuration = Math.max(...entries.map(e => e.duration));
            metrics.webVitals.INP = maxDuration;
          }
        }).observe(/** @type {any} */ ({ type: 'event', buffered: true, durationThreshold: 16 }));
      } catch {
        /* no-op */
      }
    } catch (e) {
      logger?.warn?.('Performance', 'Failed to init PerformanceObserver', e);
    }
  };

  const initLongTaskMonitor = () => {
    if (typeof PerformanceObserver === 'undefined') return;
    if (
      Array.isArray(PerformanceObserver.supportedEntryTypes) &&
      !PerformanceObserver.supportedEntryTypes.includes('longtask')
    ) {
      return;
    }
    try {
      /** @type {{ duration: number, startTime: number, name: string }[]} */
      const longTasks = [];
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime,
            name: entry.name,
          });
          if (longTasks.length > 50) longTasks.shift();
        }
        recordMetric('long-tasks-count', longTasks.length);
        const totalBlocking = longTasks.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);
        recordMetric('total-blocking-time', totalBlocking);
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      /* no-op */
    }
  };

  const logPageLoadMetrics = () => {
    if (!config.enabled) return;
    try {
      const navigation = getPerformanceEntries('navigation')[0];
      if (navigation) {
        recordMetric('page-load-time', navigation.loadEventEnd - navigation.fetchStart);
        recordMetric('dom-content-loaded', navigation.domContentLoadedEventEnd);
        recordMetric('dom-interactive', navigation.domInteractive);
      }
    } catch (e) {
      logger?.warn?.('Performance', 'Failed to log page metrics', e);
    }
  };

  const initNavigationTracking = () => {
    window.addEventListener('yt-navigate-start', () => mark('yt-navigate-start'), {
      passive: true,
    });
    window.addEventListener(
      'yt-navigate-finish',
      () => {
        mark('yt-navigate-finish');
        measure('yt-navigation-duration', 'yt-navigate-start', undefined);
      },
      { passive: true }
    );
  };

  const perfApi = {
    mark,
    measure,
    timeFunction,
    timeAsyncFunction,
    recordMetric,
    getStats,
    getPerformanceEntries,
    clearMetrics,
    config,
  };

  if (typeof window !== 'undefined') {
    // Page-load timing
    if (document.readyState === 'complete') {
      logPageLoadMetrics();
    } else {
      window.addEventListener('load', logPageLoadMetrics, { once: true });
    }

    if (config.enabled) {
      initPerformanceObserver();
      initLongTaskMonitor();
    }
    initNavigationTracking();

    Object.defineProperty(window, 'YouTubePerformance', {
      value: perfApi,
      configurable: true,
      enumerable: false,
      writable: true,
    });

    window.YouTubeUtils?.logger?.debug?.('[YouTube+] Performance diagnostics initialised');
  }
})();
