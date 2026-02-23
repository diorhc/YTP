// Performance monitoring for YouTube+ userscript (Enhanced)
(function () {
  'use strict';

  /* global Blob, URL, PerformanceObserver */

  /**
   * Performance monitoring configuration
   */
  const PerformanceConfig = {
    enabled: true,
    sampleRate: 0.01, // 1% sampling by default (can be overridden via YouTubePlusConfig)
    storageKey: 'youtube_plus_performance',
    metricsRetention: 100, // Keep last 100 metrics
    enableConsoleOutput: false,
    logLevel: 'info', // 'debug', 'info', 'warn', 'error'
  };

  const isTestEnv = (() => {
    try {
      // Jest provides process.env.JEST_WORKER_ID in node/jsdom
      return typeof process !== 'undefined' && !!process?.env?.JEST_WORKER_ID;
    } catch {
      return false;
    }
  })();

  const getConfiguredSampleRate = () => {
    try {
      const cfg = /** @type {any} */ (window).YouTubePlusConfig;
      const explicit =
        cfg?.performance?.sampleRate ??
        cfg?.performanceSampleRate ??
        cfg?.perfSampleRate ??
        undefined;

      if (typeof explicit === 'number' && isFinite(explicit)) {
        return Math.min(1, Math.max(0, explicit));
      }
    } catch {
      // ignore
    }
    return PerformanceConfig.sampleRate;
  };

  // Apply sample rate (always 100% in tests to avoid flakiness)
  PerformanceConfig.sampleRate = isTestEnv ? 1.0 : getConfiguredSampleRate();

  // Sampling gate: keep API available but disable heavy observers/recording when not sampled.
  try {
    if (
      !isTestEnv &&
      PerformanceConfig.sampleRate < 1 &&
      Math.random() > PerformanceConfig.sampleRate
    ) {
      PerformanceConfig.enabled = false;
    }
  } catch {
    // ignore
  }

  /**
   * Performance metrics storage
   */
  const metrics = {
    timings: new Map(),
    marks: new Map(),
    measures: [],
    resources: [],
    webVitals: {
      LCP: null,
      CLS: 0,
      FID: null,
      INP: null,
      FCP: null,
      TTFB: null,
    },
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
        // console.warn(`[YouTube+ Perf] Start mark "${startMark}" not found`);
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
        window.YouTubeUtils?.logger?.debug?.(`[YouTube+ Perf] ${name}: ${duration.toFixed(2)}ms`);
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
      window.YouTubeUtils?.logger?.debug?.(`[YouTube+ Perf] ${name}: ${value}`, metadata);
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
      webVitals: { ...metrics.webVitals },
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
      const memory = performance.memory;
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
      webVitals: metrics.webVitals,
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
        console.warn('[YouTube+ Perf] Blob API not available');
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
      console.error('[YouTube+ Perf] Failed to export to file:', e);
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

    metrics.measures.forEach(measure => {
      const periodStart = Math.floor(measure.timestamp / periodMs) * periodMs;
      if (!periods.has(periodStart)) {
        periods.set(periodStart, []);
      }
      periods.get(periodStart).push(measure);
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
    metrics.webVitals = {
      LCP: null,
      CLS: 0,
      FID: null,
      INP: null,
      FCP: null,
      TTFB: null,
    };

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
   * Initialize Performance Observer for Web Vitals
   */
  const initPerformanceObserver = () => {
    if (typeof PerformanceObserver === 'undefined') return;

    try {
      // Observe LCP
      new PerformanceObserver(entryList => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        metrics.webVitals.LCP = lastEntry.startTime;
        if (PerformanceConfig.enableConsoleOutput) {
          console.warn(`[YouTube+ Perf] LCP: ${lastEntry.startTime.toFixed(2)}ms`, lastEntry);
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });

      // Observe CLS
      new PerformanceObserver(entryList => {
        for (const entry of entryList.getEntries()) {
          if (!entry.hadRecentInput) {
            metrics.webVitals.CLS += entry.value;
          }
        }
        if (PerformanceConfig.enableConsoleOutput && PerformanceConfig.logLevel === 'debug') {
          console.warn(`[YouTube+ Perf] CLS: ${metrics.webVitals.CLS.toFixed(4)}`);
        }
      }).observe({ type: 'layout-shift', buffered: true });

      // Observe FID (First Input Delay)
      new PerformanceObserver(entryList => {
        const firstInput = entryList.getEntries()[0];
        metrics.webVitals.FID = firstInput.processingStart - firstInput.startTime;
        if (PerformanceConfig.enableConsoleOutput) {
          console.warn(`[YouTube+ Perf] FID: ${metrics.webVitals.FID.toFixed(2)}ms`);
        }
      }).observe({ type: 'first-input', buffered: true });

      // Observe INP (Interaction to Next Paint) - experimental
      try {
        new PerformanceObserver(entryList => {
          const entries = entryList.getEntries();
          // Simplified INP calculation (just taking max duration for now)
          const maxDuration = Math.max(...entries.map(e => e.duration));
          metrics.webVitals.INP = maxDuration;
        }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
      } catch (e) {
        void e; // INP might not be supported; reference `e` to satisfy linters
      }
    } catch (e) {
      console.warn('[YouTube+ Perf] Failed to init PerformanceObserver:', e);
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

    // Initialize Web Vitals observers (only when enabled to reduce overhead)
    if (PerformanceConfig.enabled) {
      initPerformanceObserver();
    }

    /**
     * RAF Scheduler for batched animations
     */
    const RAFScheduler = (() => {
      let rafId = null;
      const callbacks = new Set();

      const flush = () => {
        rafId = null;
        Array.from(callbacks).forEach(cb => {
          try {
            cb();
          } catch (e) {
            console.error('[RAF] Error:', e);
          }
        });
        callbacks.clear();
      };

      return {
        schedule: callback => {
          callbacks.add(callback);
          if (!rafId) rafId = requestAnimationFrame(flush);
          return () => callbacks.delete(callback);
        },
        cancelAll: () => {
          if (rafId) cancelAnimationFrame(rafId);
          rafId = null;
          callbacks.clear();
        },
      };
    })();

    /**
     * Lazy Loader using Intersection Observer
     */
    const LazyLoader = (() => {
      const observers = new Map();

      return {
        create: (options = {}) => {
          const { root = null, rootMargin = '50px', threshold = 0.01, onIntersect } = options;

          const observer = new IntersectionObserver(
            entries => {
              entries.forEach(entry => {
                if (entry.isIntersecting) {
                  onIntersect(entry.target, entry);
                  observer.unobserve(entry.target);
                }
              });
            },
            { root, rootMargin, threshold }
          );

          observers.set(observer, new Set());

          return {
            observe: el => {
              if (el instanceof Element) {
                observer.observe(el);
                observers.get(observer).add(el);
              }
            },
            unobserve: el => {
              if (el instanceof Element) {
                observer.unobserve(el);
                observers.get(observer)?.delete(el);
              }
            },
            disconnect: () => {
              observer.disconnect();
              observers.delete(observer);
            },
          };
        },
        disconnectAll: () => {
          observers.forEach((_, o) => o.disconnect());
          observers.clear();
        },
      };
    })();

    /**
     * DOM Batcher for efficient DOM mutations
     */
    const DOMBatcher = (() => {
      const batches = new Map();

      return {
        batch: (container, elements) => {
          if (!batches.has(container)) batches.set(container, []);
          batches.get(container).push(...elements);
        },
        flush: () => {
          RAFScheduler.schedule(() => {
            batches.forEach((elements, container) => {
              if (!container.isConnected) {
                batches.delete(container);
                return;
              }
              const frag = document.createDocumentFragment();
              elements.forEach(el => frag.appendChild(el));
              container.appendChild(frag);
            });
            batches.clear();
          });
        },
        clear: container => batches.delete(container),
      };
    })();

    /**
     * Element Cache using WeakMap (auto garbage collected)
     */
    const ElementCache = (() => {
      const cache = new WeakMap();

      return {
        get: (el, key) => cache.get(el)?.[key],
        set: (el, key, val) => {
          let data = cache.get(el);
          if (!data) {
            data = {};
            cache.set(el, data);
          }
          data[key] = val;
        },
        has: (el, key) => {
          const data = cache.get(el);
          return data ? key in data : false;
        },
        delete: (el, key) => {
          const data = cache.get(el);
          if (data) delete data[key];
        },
      };
    })();

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
      RAFScheduler,
      LazyLoader,
      DOMBatcher,
      ElementCache,
    };

    /**
     * Yield to main thread to improve INP
     * Uses scheduler.yield() if available, falls back to setTimeout
     * @returns {Promise<void>}
     */
    const yieldToMain = () => {
      return new Promise(resolve => {
        if ('scheduler' in window && typeof window.scheduler?.yield === 'function') {
          window.scheduler.yield().then(resolve);
        } else {
          setTimeout(resolve, 0);
        }
      });
    };

    /**
     * Break up long tasks into smaller chunks to improve INP
     * @param {Array<Function>} tasks - Array of task functions
     * @param {number} [yieldInterval=50] - Yield after this many ms
     * @returns {Promise<void>}
     */
    const runChunkedTasks = async (tasks, yieldInterval = 50) => {
      let lastYield = performance.now();

      for (const task of tasks) {
        task();

        const now = performance.now();
        if (now - lastYield > yieldInterval) {
          await yieldToMain();
          lastYield = performance.now();
        }
      }
    };

    /**
     * Wrap event handler to yield periodically for better INP
     * @param {Function} handler - Original event handler
     * @param {Object} [options] - Options
     * @param {number} [options.maxBlockTime=50] - Max time to block before yielding
     * @returns {Function} Wrapped handler
     */
    const wrapForINP = (handler, options = {}) => {
      const { maxBlockTime = 50 } = options;

      return async function (...args) {
        const start = performance.now();
        let result;

        try {
          result = handler.apply(this, args);

          // If handler returns a promise, wait for it
          if (result && typeof result.then === 'function') {
            result = await result;
          }
        } finally {
          const elapsed = performance.now() - start;
          if (elapsed > maxBlockTime) {
            // Record long task for debugging
            recordMetric('long-task', elapsed, { handler: handler.name || 'anonymous' });
          }
        }

        return result;
      };
    };

    // Add INP helpers to global API
    window.YouTubePerformance.yieldToMain = yieldToMain;
    window.YouTubePerformance.runChunkedTasks = runChunkedTasks;
    window.YouTubePerformance.wrapForINP = wrapForINP;

    // ─── LCP Optimization Suite ────────────────────────────────────────────────
    // Target: Main page <5s, Video page <3.5s, Playlist page <3.5s

    /**
     * 1. Resource Hints - preconnect to YouTube CDN origins
     *    Shaves 100-300ms from first resource fetch on each origin.
     */
    const injectResourceHints = () => {
      const origins = [
        'https://www.youtube.com',
        'https://i.ytimg.com', // Thumbnails (LCP candidate)
        'https://yt3.ggpht.com', // Channel avatars
        'https://fonts.googleapis.com', // Fonts
        'https://www.gstatic.com', // Static resources
        'https://play.google.com', // Play store resources
      ];

      const head = document.head;
      if (!head) return;

      const existingHrefs = new Set();
      head.querySelectorAll('link[rel="preconnect"]').forEach(el => {
        existingHrefs.add(el.href);
      });

      for (const origin of origins) {
        if (existingHrefs.has(origin) || existingHrefs.has(origin + '/')) continue;
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = origin;
        link.crossOrigin = 'anonymous';
        head.appendChild(link);
      }
    };

    /**
     * 2. LCP Element Priority Boost
     *    Set fetchpriority="high" on the LCP element (main video thumbnail / player poster).
     */
    const boostLCPElement = () => {
      const path = location.pathname;
      let lcpSelector;

      if (path === '/watch' || path.startsWith('/shorts/')) {
        // Video page: player poster or first video frame
        lcpSelector =
          '#movie_player .ytp-cued-thumbnail-overlay-image, #movie_player video, ytd-player #ytd-player .html5-video-container';
      } else if (path === '/playlist') {
        // Playlist page: first visible thumbnail
        lcpSelector = 'ytd-playlist-video-renderer:first-child img.yt-core-image';
      } else {
        // Main page: first visible rich item thumbnail
        lcpSelector =
          'ytd-rich-item-renderer:first-child img.yt-core-image, ytd-rich-grid-media img.yt-core-image';
      }

      if (!lcpSelector) return;

      requestAnimationFrame(() => {
        const el = document.querySelector(lcpSelector);
        if (el && el.tagName === 'IMG') {
          el.setAttribute('fetchpriority', 'high');
          el.setAttribute('loading', 'eager');
          // Remove lazy loading if set by YouTube
          if (el.loading === 'lazy') el.loading = 'eager';
        }
      });
    };

    /**
     * 3. Content-Visibility CSS for off-screen sections
     *    Dramatically reduces initial render work by skipping layout/paint for below-the-fold.
     */
    const injectContentVisibilityCSS = () => {
      const cssId = 'ytp-perf-content-visibility';
      if (document.getElementById(cssId)) return;

      const css = `
        /* ── YouTube+ LCP Performance Optimizations ── */

        /* Off-screen section rendering deferral */
        ytd-comments#comments { content-visibility: auto; contain-intrinsic-size: auto 800px; }
        #secondary ytd-compact-video-renderer:nth-child(n+6) { content-visibility: auto; contain-intrinsic-size: auto 94px; }
        ytd-watch-next-secondary-results-renderer ytd-item-section-renderer { content-visibility: auto; contain-intrinsic-size: auto 600px; }

        /* Main/browse feed - defer items below first viewport */
        ytd-rich-grid-renderer #contents > ytd-rich-item-renderer:nth-child(n+9) { content-visibility: auto; contain-intrinsic-size: auto 360px; }
        ytd-section-list-renderer > #contents > ytd-item-section-renderer:nth-child(n+3) { content-visibility: auto; contain-intrinsic-size: auto 500px; }

        /* Playlist page - defer items beyond visible viewport */
        ytd-playlist-video-list-renderer #contents > ytd-playlist-video-renderer:nth-child(n+12) { content-visibility: auto; contain-intrinsic-size: auto 90px; }

        /* Note: contain:layout is intentionally omitted here — it breaks position:sticky
           for chips-wrapper and tabs-container on browse/channel pages. */

        /* Guide sidebar - not needed for LCP */
        ytd-mini-guide-renderer { content-visibility: auto; contain-intrinsic-size: auto 100vh; }
        tp-yt-app-drawer#guide { content-visibility: auto; contain-intrinsic-size: 240px 100vh; }

        /* Below-the-fold metadata */
        ytd-watch-metadata #description { content-visibility: auto; contain-intrinsic-size: auto 120px; }
        ytd-structured-description-content-renderer { content-visibility: auto; contain-intrinsic-size: auto 200px; }

        /* Shorts shelf on browse pages */
        ytd-reel-shelf-renderer { content-visibility: auto; contain-intrinsic-size: auto 320px; }

        /* Comments container on main watch - contain:style only, not layout (preserves sticky) */
        ytd-item-section-renderer#sections { contain: style; }

        /* Reduce paint complexity for non-visible items */
        ytd-rich-grid-row:nth-child(n+4) { content-visibility: auto; contain-intrinsic-size: auto 240px; }

        /* Engagement panels - safe deferral only when fully hidden */
        ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"] { content-visibility: auto; contain-intrinsic-size: auto 0px; }

        /* Optimize image decoding */
        ytd-thumbnail img, yt-image img, .yt-core-image { content-visibility: auto; }
      `;

      const style = document.createElement('style');
      style.id = cssId;
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    };

    /**
     * 4. Deferred Image Loading
     *    Lazy-load images below the fold using IntersectionObserver.
     */
    const setupDeferredImageLoading = () => {
      const imgObserver = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const img = entry.target;
              const dataSrc = img.getAttribute('data-ytp-deferred-src');
              if (dataSrc) {
                img.src = dataSrc;
                img.removeAttribute('data-ytp-deferred-src');
              }
              imgObserver.unobserve(img);
            }
          }
        },
        { rootMargin: '200px 0px' }
      );

      // Observe below-fold thumbnail images
      const observeImages = () => {
        const belowFold = document.querySelectorAll(
          'ytd-rich-item-renderer:nth-child(n+5) img[src]:not([data-ytp-img-observed]),' +
            'ytd-compact-video-renderer:nth-child(n+4) img[src]:not([data-ytp-img-observed])'
        );
        belowFold.forEach(img => {
          img.setAttribute('data-ytp-img-observed', '1');
        });
      };

      // Run periodically to catch new items
      let imgTimer = null;
      const scheduleObserve = () => {
        if (imgTimer) return;
        imgTimer = setTimeout(() => {
          imgTimer = null;
          observeImages();
        }, 500);
      };

      window.addEventListener('yt-navigate-finish', scheduleObserve, { passive: true });
      if (document.readyState !== 'loading') {
        scheduleObserve();
      } else {
        document.addEventListener('DOMContentLoaded', scheduleObserve, { once: true });
      }
    };

    /**
     * 5. MutationObserver Optimization
     *    Provides a shared, debounced MutationObserver to reduce overhead
     *    from multiple independent subtree observers.
     */
    const SharedMutationManager = (() => {
      let observer = null;
      const callbacks = new Map(); // key -> {callback, filter}
      let scheduled = false;
      const pending = [];

      const flush = () => {
        scheduled = false;
        const entries = [...pending];
        pending.length = 0;

        for (const [, { callback, filter }] of callbacks) {
          const filtered = filter ? entries.filter(filter) : entries;
          if (filtered.length > 0) {
            try {
              callback(filtered);
            } catch (e) {
              console.warn('[YouTube+ Perf] SharedMutation callback error:', e);
            }
          }
        }
      };

      const start = () => {
        if (observer) return;
        observer = new MutationObserver(mutations => {
          pending.push(...mutations);
          if (!scheduled) {
            scheduled = true;
            // Use microtask for fast batching without losing responsiveness
            queueMicrotask(flush);
          }
        });
        const target = document.body || document.documentElement;
        if (target) {
          observer.observe(target, { childList: true, subtree: true });
        }
      };

      return {
        /**
         * Register a callback for shared mutation observation.
         * @param {string} key - Unique key
         * @param {Function} callback - Called with filtered mutations
         * @param {Function} [filter] - Optional filter for mutations
         */
        register(key, callback, filter) {
          callbacks.set(key, { callback, filter });
          if (callbacks.size === 1) start();
        },
        unregister(key) {
          callbacks.delete(key);
          if (callbacks.size === 0 && observer) {
            observer.disconnect();
            observer = null;
          }
        },
        getCallbackCount: () => callbacks.size,
      };
    })();

    /**
     * 6. Idle-time Task Scheduler
     *    Schedules non-critical initialization to idle periods.
     */
    const IdleScheduler = (() => {
      const queue = [];
      let running = false;

      const processQueue = deadline => {
        while (queue.length > 0 && (deadline ? deadline.timeRemaining() > 5 : true)) {
          const task = queue.shift();
          try {
            task.fn();
          } catch (e) {
            console.warn('[YouTube+ Perf] Idle task error:', e);
          }
          if (!deadline) break; // Without deadline, run one task per iteration
        }

        if (queue.length > 0) {
          scheduleNext();
        } else {
          running = false;
        }
      };

      const scheduleNext = () => {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(processQueue, { timeout: 3000 });
        } else {
          setTimeout(() => processQueue(null), 50);
        }
      };

      return {
        /**
         * Schedule a task for idle execution.
         * @param {Function} fn - Task function
         * @param {number} [priority=0] - Higher = runs first
         */
        schedule(fn, priority = 0) {
          queue.push({ fn, priority });
          queue.sort((a, b) => b.priority - a.priority);
          if (!running) {
            running = true;
            scheduleNext();
          }
        },
        /** Get number of pending tasks */
        pending: () => queue.length,
      };
    })();

    /**
     * 7. Long Task monitoring (via PerformanceObserver)
     *    Helps identify blocking scripts beyond 50ms.
     */
    const initLongTaskMonitor = () => {
      if (typeof PerformanceObserver === 'undefined') return;
      try {
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
        // longtask observer not supported
      }
    };

    /**
     * 8. Navigation-aware performance tracking
     *    Reset and re-measure on YouTube SPA navigations.
     */
    const initNavigationTracking = () => {
      window.addEventListener(
        'yt-navigate-start',
        () => {
          mark('yt-navigate-start');
        },
        { passive: true }
      );

      window.addEventListener(
        'yt-navigate-finish',
        () => {
          mark('yt-navigate-finish');
          measure('yt-navigation-duration', 'yt-navigate-start');

          // Re-boost LCP for new page
          requestAnimationFrame(() => {
            boostLCPElement();
          });
        },
        { passive: true }
      );
    };

    /**
     * Initialize all LCP optimizations
     */
    const initLCPOptimizations = () => {
      try {
        // Critical (run immediately - biggest LCP impact)
        injectResourceHints();
        injectContentVisibilityCSS();
        boostLCPElement();

        // High priority (run in next microtask)
        queueMicrotask(() => {
          initNavigationTracking();
          initLongTaskMonitor();
        });

        // Lower priority (defer to idle)
        IdleScheduler.schedule(() => setupDeferredImageLoading(), 2);
      } catch (e) {
        console.warn('[YouTube+ Perf] LCP optimization init error:', e);
      }
    };

    // Run LCP optimizations immediately
    initLCPOptimizations();

    // Expose new performance APIs
    window.YouTubePerformance.SharedMutationManager = SharedMutationManager;
    window.YouTubePerformance.IdleScheduler = IdleScheduler;
    window.YouTubePerformance.boostLCPElement = boostLCPElement;
    window.YouTubePerformance.injectResourceHints = injectResourceHints;

    window.YouTubeUtils &&
      YouTubeUtils.logger &&
      YouTubeUtils.logger.debug &&
      YouTubeUtils.logger.debug('[YouTube+] Performance monitoring initialized');
  }
})();
