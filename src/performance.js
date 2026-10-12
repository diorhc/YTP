/**
 * YouTube+ Diagnostics & Profiling
 *
 * Owner: diagnostics / profiling only.
 *
 * The module measures the running userscript and records timing data. It does
 * NOT modify the page, own feature lifecycle, or act as a shared utility bag.
 * If you find yourself wanting to add a `RAFScheduler`, `DOMBatcher`,
 * `IntersectionObserver` helper, or INP-yielding wrapper here, it belongs in
 * a different module instead (e.g. mutation-coordinator.js,
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
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'Performance');
  /* global PerformanceObserver */

  if (typeof window !== 'undefined' && window.YouTubePerformance) {
    return;
  }

  const isTestEnv = typeof process !== 'undefined' && !!process?.env?.JEST_WORKER_ID;

  const logger = window.YouTubeUtils?.logger || window.YouTubePlusLogger || null;

  const config = {
    enabled: true,
    // 100% in tests to keep diagnostics deterministic; 1% in production by default.
    sampleRate: isTestEnv ? 1.0 : 0.01,
    metricsRetention: 100,
  };

  // Honor a user-configured sample rate when present.
  if (!isTestEnv) {
    const cfg = window.YouTubePlusConfig;
    const explicit =
      cfg?.performance?.sampleRate ?? cfg?.performanceSampleRate ?? cfg?.perfSampleRate;
    if (typeof explicit === 'number' && Number.isFinite(explicit)) {
      config.sampleRate = Math.min(1, Math.max(0, explicit));
    }
    // Sampling gate: keep the API available but disable observers/recording
    // when this session is not selected.
    if (config.sampleRate < 1 && Math.random() > config.sampleRate) {
      config.enabled = false;
    }
  }

  /**
   * Factory for initial Web Vitals state.
   * Note: INP and CLS are diagnostic approximations (worst-case duration and raw cumulative sum),
   * not full specification Web Vitals.
   * @returns {{ LCP: number|null, CLS: number, FID: number|null, INP: number|null, FCP: number|null, TTFB: number|null, INP_approximation: number|null, CLS_approximation: number, isApproximation: { INP: boolean, CLS: boolean } }}
   */
  const createInitialWebVitals = () => ({
    LCP: null,
    CLS: 0,
    FID: null,
    INP: null,
    FCP: null,
    TTFB: null,
    INP_approximation: null,
    CLS_approximation: 0,
    isApproximation: {
      INP: true,
      CLS: true,
    },
  });

  // Magic number thresholds for performance monitoring
  const TBT_THRESHOLD_MS = 50; // Long-task blocking time threshold (ms)
  const MAX_LONG_TASKS_BUFFER = 50; // Maximum number of long-tasks to keep in memory
  const INP_DURATION_THRESHOLD_MS = 16; // Interaction to Next Paint duration threshold (ms)

  /** @typedef {{ name: string, startMark: string, endMark: string, duration: number, timestamp: number }} MeasureEntry */
  /** @type {{ timings: Map<string, Record<string, unknown>>, marks: Map<string, number>, measures: MeasureEntry[], webVitals: ReturnType<typeof createInitialWebVitals> }} */
  const metrics = {
    timings: new Map(),
    marks: new Map(),
    measures: [],
    webVitals: createInitialWebVitals(),
  };

  let markSeq = 0;

  /**
   * @param {string} name
   */
  const mark = name => {
    if (!config.enabled) return;
    if (typeof performance !== 'undefined' && performance.mark) {
      try {
        performance.mark(name);
      } catch (e) {
        logS(e);
        logger?.warn?.('Performance', 'Failed to create mark', e);
      }
    }
    metrics.marks.set(name, Date.now());
  };

  /**
   * Record the pair in the browser's performance timeline. `performance.measure`
   * throws when a referenced mark is missing, so the call stays guarded.
   * @param {string} name
   * @param {string} startMark
   * @param {string} [endMark]
   */
  const recordPerformanceMeasure = (name, startMark, endMark) => {
    if (typeof performance === 'undefined' || !performance.measure) return;
    try {
      performance.measure(name, startMark, endMark);
      if (performance.clearMarks) {
        performance.clearMarks(startMark);
        if (endMark) performance.clearMarks(endMark);
      }
    } catch (e) {
      logS(e);
      logger?.warn?.('Performance', 'Failed to record measure', e);
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
    const startTime = metrics.marks.get(startMark);
    if (!startTime) return 0; // Missing start mark; stay quiet in hot paths.

    const endTime = endMark ? (metrics.marks.get(endMark) ?? Date.now()) : Date.now();
    const duration = endTime - startTime;

    metrics.marks.delete(startMark);
    if (endMark) metrics.marks.delete(endMark);

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

    recordPerformanceMeasure(name, startMark, endMark);
    return duration;
  };

  /**
   * @param {string} name
   * @param {(...args: unknown[]) => unknown} fn
   */
  const timeFunction = (name, fn) => {
    if (!config.enabled) return fn;
    return /** @this {unknown} @param {...unknown} args */ function (...args) {
      const startMark = `${name}-start-${++markSeq}`;
      mark(startMark);
      let promiseLike = false;
      try {
        const result = fn.apply(this, args);
        const maybePromise = /** @type {{ then?: unknown; finally?: unknown }} */ (result);
        if (
          result &&
          typeof maybePromise.then === 'function' &&
          typeof maybePromise.finally === 'function'
        ) {
          promiseLike = true;
          return maybePromise.finally(() => {
            measure(name, startMark, undefined);
          });
        }
        return result;
      } finally {
        if (!promiseLike) measure(name, startMark, undefined);
      }
    };
  };

  /**
   * @param {string} name
   * @param {(...args: unknown[]) => Promise<unknown>} fn
   */
  const timeAsyncFunction = (name, fn) => {
    if (!config.enabled) return fn;
    return /** @this {unknown} @param {...unknown} args */ async function (...args) {
      const startMark = `${name}-start-${++markSeq}`;
      mark(startMark);
      try {
        return await fn.apply(this, args);
      } finally {
        measure(name, startMark, undefined);
      }
    };
  };

  /**
   * @param {string} name
   * @param {number} value
   * @param {Record<string, unknown>} [metadata]
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
    /** @type {Record<string, unknown>} */
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
   * @returns {PerformanceEntry[]}
   */
  const getPerformanceEntries = type => {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) return [];
    try {
      return performance.getEntriesByType(type);
    } catch (_e) {
      logS(_e);
      return [];
    }
  };

  const clearMetrics = () => {
    metrics.timings.clear();
    metrics.marks.clear();
    metrics.measures = [];
    metrics.webVitals = createInitialWebVitals();
    if (typeof performance !== 'undefined') {
      performance.clearMarks?.();
      performance.clearMeasures?.();
    }
  };

  /** Observe Event Timing for the INP approximation; unsupported types throw. */
  const observeEventTiming = () => {
    new PerformanceObserver(entryList => {
      // keep the running max across ALL batches. INP is the worst
      // interaction observed so far - a fast batch after a slow one must
      // never overwrite it. This is a diagnostic approximation (max event
      // duration), NOT the spec INP (which buckets by interactionId and
      // uses the 98th percentile per web.dev/articles/inp).
      for (const e of entryList.getEntries()) {
        const dur = e.duration || 0;
        if (dur > (metrics.webVitals.INP ?? 0)) {
          metrics.webVitals.INP = dur;
          metrics.webVitals.INP_approximation = dur;
        }
      }
    }).observe(
      /** @type {PerformanceObserverInit & { durationThreshold: number }} */ ({
        type: 'event',
        buffered: true,
        durationThreshold: INP_DURATION_THRESHOLD_MS,
      })
    );
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
            metrics.webVitals.CLS_approximation = metrics.webVitals.CLS;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });

      new PerformanceObserver(entryList => {
        const firstInput = /** @type {PerformanceEventTiming | undefined} */ (
          entryList.getEntries()[0]
        );
        metrics.webVitals.FID = (firstInput?.processingStart || 0) - (firstInput?.startTime || 0);
      }).observe({ type: 'first-input', buffered: true });

      observeEventTiming();
    } catch (e) {
      logS(e);
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
          if (longTasks.length > MAX_LONG_TASKS_BUFFER) longTasks.shift();
        }
        recordMetric('long-tasks-count', longTasks.length);
        const totalBlocking = longTasks.reduce(
          (sum, t) => sum + Math.max(0, t.duration - TBT_THRESHOLD_MS),
          0
        );
        recordMetric('total-blocking-time', totalBlocking);
      }).observe({ type: 'longtask', buffered: true });
    } catch (_e) {
      logS(_e);
      /* no-op */
    }
  };

  const logPageLoadMetrics = () => {
    if (!config.enabled) return;
    const navigation = /** @type {PerformanceNavigationTiming | undefined} */ (
      getPerformanceEntries('navigation')[0]
    );
    if (navigation) {
      recordMetric('page-load-time', navigation.loadEventEnd - navigation.fetchStart);
      recordMetric('dom-content-loaded', navigation.domContentLoadedEventEnd);
      recordMetric('dom-interactive', navigation.domInteractive);
    }
  };

  const initNavigationTracking = () => {
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'yt-navigate-start',
      () => mark('yt-navigate-start'),
      {
        passive: true,
      },
      true
    );
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'yt-navigate-finish',
      () => {
        mark('yt-navigate-finish');
        measure('yt-navigation-duration', 'yt-navigate-start', undefined);
      },
      { passive: true },
      true
    );
  };

  // Observer diagnostics: tracks active observer counts across manually
  // instrumented call sites (zoom.js / enhanced.js via U.ObserverRegistry).
  // The registry only reflects manual track/untrack calls; for central
  // observer management inspect YouTubePlusCleanupManager.observers or
  // YouTubePlusMutationCoordinator.
  const ObserverRegistry = (() => {
    let _active = 0;
    let _peak = 0;
    let _created = 0;
    let _disconnected = 0;
    return {
      track() {
        _active++;
        _created++;
        if (_active > _peak) _peak = _active;
      },
      untrack() {
        _active = Math.max(0, _active - 1);
        _disconnected++;
      },
      getStats() {
        return {
          active: _active,
          peak: _peak,
          created: _created,
          disconnected: _disconnected,
        };
      },
      reset() {
        _active = 0;
        _peak = 0;
        _created = 0;
        _disconnected = 0;
      },
      dump() {
        const stats = {
          active: _active,
          peak: _peak,
          created: _created,
          disconnected: _disconnected,
        };
        const mcStats = window.YouTubePlusMutationCoordinator?.getStats?.() ?? null;
        const cmStats = (() => {
          const cm = window.YouTubePlusCleanupManager;
          if (!cm) return null;
          return {
            observers: cm.observers?.size ?? 'n/a',
            intervals: cm.intervals?.size ?? 'n/a',
            timeouts: cm.timeouts?.size ?? 'n/a',
            listeners: typeof cm.getListenerStats === 'function' ? cm.getListenerStats() : 'n/a',
          };
        })();
        logger?.warn?.('Diagnostics', 'ObserverRegistry', stats);
        if (mcStats) logger?.warn?.('Diagnostics', 'MutationCoordinator', mcStats);
        if (cmStats) logger?.warn?.('Diagnostics', 'CleanupManager', cmStats);
        return {
          observers: stats,
          mutationCoordinator: mcStats,
          cleanup: cmStats,
        };
      },
    };
  })();

  if (!window.__ytpDiagnostics) {
    window.__ytpDiagnostics = function (/** @type {boolean|undefined} */ verbose) {
      const obs = ObserverRegistry.getStats();
      const mc = window.YouTubePlusMutationCoordinator?.getStats?.() ?? null;
      const cm = (() => {
        const m = window.YouTubePlusCleanupManager;
        if (!m) return null;
        return {
          observers: m.observers?.size ?? 0,
          listeners:
            typeof m.getListenerStats === 'function'
              ? m.getListenerStats()
              : { active: 0, registeredTotal: 0 },
          intervals: m.intervals?.size ?? 0,
          timeouts: m.timeouts?.size ?? 0,
          animationFrames: m.animationFrames?.size ?? 0,
        };
      })();
      const report = {
        observers: obs,
        mutationCoordinator: mc,
        cleanupManager: cm,
        timestamp: new Date().toISOString(),
      };
      logger?.warn?.('Diagnostics', 'Observers', obs);
      if (mc) logger?.warn?.('Diagnostics', 'MutationCoordinator', mc);
      if (cm) logger?.warn?.('Diagnostics', 'CleanupManager', cm);
      if (verbose) logger?.warn?.('Diagnostics', JSON.stringify(report, null, 2));
      return report;
    };
  }

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
    ObserverRegistry,
  };

  if (typeof window !== 'undefined') {
    // Page-load timing
    if (document.readyState === 'complete') {
      logPageLoadMetrics();
    } else {
      window.YouTubePlusCleanupManager?.registerListener?.(
        window,
        'load',
        logPageLoadMetrics,
        { once: true },
        true
      );
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
    if (!window.YouTubePlusPerformance) {
      // Facade boundary: the module object is handed to the page global namespace.
      window.YouTubePlusPerformance = /** @type {YouTubePerformance} */ (
        /** @type {unknown} */ (perfApi)
      );
    }

    window.YouTubeUtils?.logger?.debug?.('[YouTube+] Performance diagnostics initialised');
  }
})();
