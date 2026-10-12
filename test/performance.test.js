/**
 * @jest-environment jsdom
 *
 * Tests the real YouTubePerformance module surface exported by src/performance.js.
 * Exercises actual timeFunction, timeAsyncFunction, recordMetric, getStats,
 * clearMetrics, and ObserverRegistry against real module logic.
 */

describe('Performance Module (real API)', () => {
  const setupPerfDeps = () => {
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        cleanupManager: {
          observers: new Set(),
          intervals: new Set(),
          timeouts: new Set(),
          animationFrames: new Set(),
          getListenerStats: () => ({ active: 0, registeredTotal: 0 }),
        },
      },
    });

    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        observers: new Set(),
        intervals: new Set(),
        timeouts: new Set(),
        getListenerStats: () => ({ active: 0, registeredTotal: 0 }),
      },
    });
  };

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePerformance;
    delete window.YouTubePlusPerformance;

    setupPerfDeps();
    require('../src/performance.js');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('exposes the real API facade on window.YouTubePerformance and window.YouTubePlusPerformance', () => {
    expect(window.YouTubePerformance).toBeDefined();
    expect(window.YouTubePlusPerformance).toBe(window.YouTubePerformance);
    expect(typeof window.YouTubePerformance.mark).toBe('function');
    expect(typeof window.YouTubePerformance.measure).toBe('function');
    expect(typeof window.YouTubePerformance.timeFunction).toBe('function');
    expect(typeof window.YouTubePerformance.timeAsyncFunction).toBe('function');
    expect(typeof window.YouTubePerformance.recordMetric).toBe('function');
    expect(typeof window.YouTubePerformance.getStats).toBe('function');
    expect(typeof window.YouTubePerformance.clearMetrics).toBe('function');
    expect(window.YouTubePerformance.ObserverRegistry).toBeDefined();
  });

  describe('recordMetric and getStats', () => {
    test('records custom metrics in customMetrics registry', () => {
      const { recordMetric, getStats, clearMetrics } = window.YouTubePerformance;
      clearMetrics();

      recordMetric('custom-metric-1', 42, { tag: 'fast' });

      const allStats = getStats();
      expect(allStats).toBeDefined();
      expect(allStats.customMetrics).toBeDefined();
      expect(allStats.customMetrics['custom-metric-1']).toBeDefined();
      expect(allStats.customMetrics['custom-metric-1'].value).toBe(42);
      expect(allStats.customMetrics['custom-metric-1'].tag).toBe('fast');
    });

    test('returns null for unmeasured metric names', () => {
      const stats = window.YouTubePerformance.getStats('non-existent-measure');
      expect(stats).toBeNull();
    });
  });

  describe('timeFunction wrapping', () => {
    test('measures synchronous execution duration and returns result', () => {
      const { timeFunction, getStats, clearMetrics } = window.YouTubePerformance;
      clearMetrics();

      const compute = (a, b) => a + b;
      const timedCompute = timeFunction('compute-add', compute);

      const result = timedCompute(5, 7);
      expect(result).toBe(12);

      const stats = getStats('compute-add');
      expect(stats).toBeDefined();
      expect(stats.count).toBe(1);
      expect(stats.avg).toBeGreaterThanOrEqual(0);
    });

    test('propagates errors while still recording timing measure', () => {
      const { timeFunction, getStats, clearMetrics } = window.YouTubePerformance;
      clearMetrics();

      const failingFn = () => {
        throw new Error('boom');
      };
      const timedFailing = timeFunction('compute-fail', failingFn);

      expect(() => timedFailing()).toThrow('boom');

      const stats = getStats('compute-fail');
      expect(stats).toBeDefined();
      expect(stats.count).toBe(1);
    });
  });

  describe('timeAsyncFunction wrapping', () => {
    test('measures asynchronous execution duration and resolves result', async () => {
      const { timeAsyncFunction, getStats, clearMetrics } = window.YouTubePerformance;
      clearMetrics();

      const asyncTask = async x => {
        return x * 2;
      };
      const timedAsyncTask = timeAsyncFunction('async-double', asyncTask);

      const result = await timedAsyncTask(21);
      expect(result).toBe(42);

      const stats = getStats('async-double');
      expect(stats).toBeDefined();
      expect(stats.count).toBe(1);
    });
  });

  describe('ObserverRegistry diagnostics', () => {
    test('tracks created and active observer counts accurately', () => {
      const { ObserverRegistry } = window.YouTubePerformance;
      ObserverRegistry.reset();

      ObserverRegistry.track();
      ObserverRegistry.track();
      expect(ObserverRegistry.getStats().active).toBe(2);
      expect(ObserverRegistry.getStats().created).toBe(2);
      expect(ObserverRegistry.getStats().peak).toBe(2);

      ObserverRegistry.untrack();
      expect(ObserverRegistry.getStats().active).toBe(1);
      expect(ObserverRegistry.getStats().disconnected).toBe(1);

      ObserverRegistry.reset();
      expect(ObserverRegistry.getStats().active).toBe(0);
    });

    test('dump returns structured diagnostic object', () => {
      const { ObserverRegistry } = window.YouTubePerformance;
      const dump = ObserverRegistry.dump();
      expect(dump).toBeDefined();
      expect(dump.observers).toBeDefined();
      expect(dump.cleanup).toBeDefined();
    });
  });

  describe('INP diagnostic metric', () => {
    test('INP keeps running max across event-timing batches', () => {
      const perf = window.YouTubePerformance;
      expect(perf).toBeDefined();

      // Simulate the event-timing observer callbacks by driving the same
      // entry-shape through a PerformanceObserver stub. jsdom lacks
      // PerformanceObserver, so install a minimal capture stub BEFORE
      // requiring the module is not possible here (require already ran);
      // instead exercise the running-max semantics via the exported API:
      // recordMetric is a different path, so drive the real observer setup
      // through a PerformanceObserver polyfill on globalThis.
      const observers = [];
      class FakePerformanceObserver {
        constructor(cb) {
          this.cb = cb;
          observers.push(this);
        }
        observe(opts) {
          this.opts = opts;
        }
        disconnect() {
          /* mock */
        }
      }
      const origPO = globalThis.PerformanceObserver;
      globalThis.PerformanceObserver = FakePerformanceObserver;

      try {
        // Fresh module so initPerformanceObserver uses the polyfill.
        jest.resetModules();
        delete window.YouTubePerformance;
        delete window.YouTubePlusPerformance;
        setupPerfDeps();
        require('../src/performance.js');
        const fresh = window.YouTubePerformance;

        // The bug scenario: a slow batch is followed by a fast one.
        const inpObserver = observers.find(o => o.opts?.type === 'event');
        expect(inpObserver).toBeDefined();
        inpObserver.cb({ getEntries: () => [{ duration: 120 }] });
        inpObserver.cb({ getEntries: () => [{ duration: 24 }] });

        // The fast batch must NOT overwrite the running max.
        expect(fresh.getStats().webVitals.INP).toBe(120);
        expect(fresh.getStats().webVitals.INP_approximation).toBe(120);
        expect(fresh.getStats().webVitals.isApproximation?.INP).toBe(true);
        expect(fresh.getStats().webVitals.isApproximation?.CLS).toBe(true);

        // The other Web Vitals observers record through their real callbacks.
        const lcpObserver = observers.find(o => o.opts?.type === 'largest-contentful-paint');
        lcpObserver.cb({ getEntries: () => [{ startTime: 42 }] });
        expect(fresh.getStats().webVitals.LCP).toBe(42);

        const clsObserver = observers.find(o => o.opts?.type === 'layout-shift');
        clsObserver.cb({ getEntries: () => [{ hadRecentInput: false, value: 0.1 }] });
        clsObserver.cb({ getEntries: () => [{ hadRecentInput: true, value: 0.5 }] });
        expect(fresh.getStats().webVitals.CLS).toBeCloseTo(0.1);

        const fidObserver = observers.find(o => o.opts?.type === 'first-input');
        fidObserver.cb({ getEntries: () => [{ processingStart: 30, startTime: 10 }] });
        expect(fresh.getStats().webVitals.FID).toBe(20);

        // The diagnostics surface reports live observer and cleanup counts.
        const diag = window.__ytpDiagnostics(true);
        expect(diag).toBeDefined();
        expect(diag.observers).toBeDefined();
        expect(diag.cleanupManager).toBeDefined();
      } finally {
        globalThis.PerformanceObserver = origPO;
      }
    });
  });

  describe('observer init and entries pins', () => {
    const installFakePO = supportedEntryTypes => {
      const observers = [];
      class FakePerformanceObserver {
        constructor(cb) {
          this.cb = cb;
          observers.push(this);
        }
        observe(opts) {
          this.opts = opts;
        }
        disconnect() {
          /* nothing to release in the stub */
        }
      }
      if (supportedEntryTypes) {
        FakePerformanceObserver.supportedEntryTypes = supportedEntryTypes;
      }
      globalThis.PerformanceObserver = FakePerformanceObserver;
      return observers;
    };

    const freshModule = () => {
      jest.resetModules();
      delete window.YouTubePerformance;
      delete window.YouTubePlusPerformance;
      setupPerfDeps();
      require('../src/performance.js');
    };

    afterEach(() => {
      delete globalThis.PerformanceObserver;
      jest.restoreAllMocks();
    });

    test('getPerformanceEntries passes entries through from the browser API', () => {
      freshModule();
      const spy = jest
        .spyOn(window.performance, 'getEntriesByType')
        .mockReturnValue([{ loadEventEnd: 8, fetchStart: 0 }]);
      const entries = window.YouTubePerformance.getPerformanceEntries('navigation');
      expect(spy).toHaveBeenCalledWith('navigation');
      expect(entries[0].loadEventEnd).toBe(8);
    });

    test('getPerformanceEntries returns [] when the browser API is unavailable', () => {
      freshModule();
      Object.defineProperty(window.performance, 'getEntriesByType', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      expect(window.YouTubePerformance.getPerformanceEntries('navigation')).toEqual([]);
    });

    test('mark() records the marks map even without the browser mark API', () => {
      freshModule();
      Object.defineProperty(window.performance, 'mark', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const { mark, getStats, clearMetrics } = window.YouTubePerformance;
      clearMetrics();
      mark('no-browser-mark');
      expect(getStats().totalMarks).toBe(1);
    });

    test('a browser that rejects a mark name still records the mark', () => {
      freshModule();
      Object.defineProperty(window.performance, 'mark', {
        value: () => {
          throw new SyntaxError('navigationStart is a reserved timing name');
        },
        configurable: true,
        writable: true,
      });
      const { mark, getStats, clearMetrics } = window.YouTubePerformance;
      clearMetrics();
      expect(() => mark('navigationStart')).not.toThrow();
      expect(getStats().totalMarks).toBe(1);
    });

    test('getPerformanceEntries returns [] when the browser API throws', () => {
      freshModule();
      Object.defineProperty(window.performance, 'getEntriesByType', {
        value: () => {
          throw new Error('performance timeline unavailable');
        },
        configurable: true,
        writable: true,
      });
      expect(window.YouTubePerformance.getPerformanceEntries('navigation')).toEqual([]);
    });

    test('a longtask observer that throws on observe does not stop the module', () => {
      installFakePO(['longtask']);
      const Fake = window.PerformanceObserver;
      window.PerformanceObserver = class extends Fake {
        observe(opts) {
          if (opts?.type === 'longtask') throw new TypeError('longtask not observable');
          return super.observe(opts);
        }
      };
      window.PerformanceObserver.supportedEntryTypes = ['longtask'];
      freshModule();
      expect(window.YouTubePerformance).toBeDefined();
    });

    test('initLongTaskMonitor skips observer creation when longtask is unsupported', () => {
      const observers = installFakePO(['largest-contentful-paint', 'layout-shift']);
      freshModule();
      expect(observers.some(o => o.opts?.type === 'longtask')).toBe(false);
    });

    test('longtask observer records task counts and blocking total', () => {
      const observers = installFakePO(['longtask']);
      freshModule();
      const longTaskObserver = observers.find(o => o.opts?.type === 'longtask');
      expect(longTaskObserver).toBeDefined();
      longTaskObserver.cb({
        getEntries: () => [
          { duration: 60, startTime: 10, name: 'task-1' },
          { duration: 60, startTime: 100, name: 'task-2' },
        ],
      });
      const custom = window.YouTubePerformance.getStats().customMetrics;
      expect(custom['long-tasks-count'].value).toBe(2);
      expect(custom['total-blocking-time'].value).toBe(20);
    });
  });
});
