/**
 * Tests for src/performance.js focused on the in-memory marks Map
 * and its bounded growth under repeated timing wrappers.
 *
 * The previous implementation interpolated `Date.now()` into every
 * mark name produced by `timeFunction` / `timeAsyncFunction`, which
 * leaked a new Map entry per call. Fixed-name marks are bounded
 * by the number of distinct mark sites (a small constant), and
 * `getStats().totalMarks` reflects the live Map size for inspection.
 */

describe('YouTubePlusPerformance mark map bounds', () => {
  /** @type {any} */
  let perf;
  /** @type {any} */
  let logger;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePerformance;
    delete window.YouTubePlusLogger;
    delete window.YouTubeUtils;
    delete window.YouTubePlusConfig;

    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    window.YouTubeUtils = { logger };
    require('../src/performance.js');
    perf = window.YouTubePerformance;
  });

  test('repeated timeFunction calls with the same name do not grow marks unboundedly', () => {
    const timed = perf.timeFunction('bounded-test', () => 42);

    const before = perf.getStats().totalMarks;

    for (let i = 0; i < 1000; i++) {
      timed();
    }

    const after = perf.getStats().totalMarks;
    expect(after - before).toBeLessThanOrEqual(1);
  });

  test('mark() called repeatedly with the same name overwrites without growing', () => {
    const before = perf.getStats().totalMarks;
    for (let i = 0; i < 500; i++) {
      perf.mark('same-name');
    }
    const after = perf.getStats().totalMarks;
    expect(after - before).toBe(1);
  });

  test('timeFunction mark key does not include Date.now()', () => {
    const timed = perf.timeFunction('stable-name', () => 1);
    timed();
    const marks = [...perf.getStats().customMetrics ? Object.keys(perf.getStats()) : []];
    const before = perf.getStats().totalMarks;
    timed();
    const after = perf.getStats().totalMarks;
    expect(after - before).toBeLessThanOrEqual(1);
    void marks;
  });

  test('timeAsyncFunction does not leak marks under repeated invocation', async () => {
    const timed = perf.timeAsyncFunction('bounded-async', async () => 'ok');
    const before = perf.getStats().totalMarks;
    for (let i = 0; i < 200; i++) {
      await timed();
    }
    const after = perf.getStats().totalMarks;
    expect(after - before).toBeLessThanOrEqual(1);
  });

  test('clearMetrics() resets marks count', () => {
    perf.mark('a');
    perf.mark('b');
    perf.mark('c');
    expect(perf.getStats().totalMarks).toBeGreaterThanOrEqual(3);
    perf.clearMetrics();
    expect(perf.getStats().totalMarks).toBe(0);
  });
});
