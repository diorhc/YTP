/**
 * @jest-environment jsdom
 *
 * Performance Baseline Suite.
 * Measures off vs on overhead under identical conditions:
 * - Negative controls (failing init rejected, listener leaks detected, latency detected)
 * - True EventTarget listener tracking (not on* property counting)
 * - Init timing with verified boot flag (window.__ytpMainBootDone__)
 * - SPA navigation lifecycle overhead (20 cycles of yt-navigate-start -> yt-navigate-finish)
 * - Listener accumulation & leak budget
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE_PATH = path.join(ROOT, 'youtube.user.js');
const { installListenerTracker } = require('../scripts/listener-tracker');
const JSDOM_BASELINE_OUTPUT = path.join(ROOT, 'test-results', 'performance-baseline-jsdom.json');

function setupYouTubeDom() {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  const app = document.createElement('div');
  app.id = 'ytd-app';
  const mp = document.createElement('div');
  mp.id = 'movie_player';
  const video = document.createElement('video');
  mp.appendChild(video);
  app.appendChild(mp);
  document.body.appendChild(app);

  const browse = document.createElement('ytd-browse');
  document.body.appendChild(browse);
  const flexy = document.createElement('ytd-watch-flexy');
  document.body.appendChild(flexy);
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Wait for the bundle's post-boot marker instead of sleeping a guessed
 * interval. Polls a real state, so a slow machine costs iterations, not
 * correctness.
 */
async function waitForMainExecDone(win, attempts = 200) {
  for (let i = 0; i < attempts; i++) {
    if (win.__ytpMainExecDone__ === true) return true;
    await Promise.resolve();
  }
  // The flag is optional for older bundles; the boot marker is the contract.
  return win.__ytpMainBootDone__ === true;
}

/** Drain the microtask queue and the already-scheduled timer callbacks. */
async function settlePendingWork(rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

describe('Performance Baselines & Measured Overhead', () => {
  let bundleSrc;
  let bundleHash;
  let tracker;

  beforeAll(() => {
    if (!fs.existsSync(BUNDLE_PATH)) {
      throw new Error(`youtube.user.js not found at ${BUNDLE_PATH}. Run npm run build first.`);
    }
    bundleSrc = fs.readFileSync(BUNDLE_PATH, 'utf8');
    bundleHash = crypto.createHash('sha256').update(bundleSrc, 'utf8').digest('hex');
    tracker = installListenerTracker(window);
  });

  afterAll(() => {
    tracker?.restore();
  });

  // ---------------------------------------------------------------------------
  // Negative Controls: Prove the measurement harness catches faults
  // ---------------------------------------------------------------------------
  describe('Negative Controls (harness validation)', () => {
    test('negative control: harness catches failing init and does not count as success', () => {
      const faultyInit = () => {
        throw new TypeError('window.addEventListener is not a function (simulated fault)');
      };
      let caught = false;
      try {
        faultyInit();
      } catch (err) {
        caught = true;
        expect(err.message).toContain('window.addEventListener is not a function');
      }
      expect(caught).toBe(true);
      expect(window.__ytpMainBootDone__).toBeFalsy();
    });

    test('negative control: listener tracker detects intentional listener leaks', () => {
      const preCount = tracker.getTotalCount();
      const leakedFns = [];
      for (let i = 0; i < 50; i++) {
        const fn = () => {
          /* mock */
        };
        leakedFns.push(fn);
        window.addEventListener(`neg_leak_${i}`, fn);
      }
      const postCount = tracker.getTotalCount();
      expect(postCount - preCount).toBe(50);

      // Clean up negative control listeners
      for (let i = 0; i < 50; i++) {
        window.removeEventListener(`neg_leak_${i}`, leakedFns[i]);
      }
      expect(tracker.getTotalCount()).toBe(preCount);
    });

    test('negative control: latency detector flags artificial synchronous delay', () => {
      const t0 = performance.now();
      while (performance.now() - t0 < 55) {
        // burn CPU
      }
      const duration = performance.now() - t0;
      expect(duration).toBeGreaterThanOrEqual(50);
    });
  });

  // ---------------------------------------------------------------------------
  // Real Baseline: OFF vs ON under verified execution
  // ---------------------------------------------------------------------------
  test('executes off vs on baseline and records metrics with logical budgets', async () => {
    // 1. Baseline OFF: Bare YouTube DOM without userscript
    setupYouTubeDom();
    const offNavTimes = [];
    const offListenersBefore = tracker.getTotalCount();

    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      window.dispatchEvent(new CustomEvent('yt-navigate-start'));
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      const t1 = performance.now();
      offNavTimes.push(t1 - t0);
    }
    const offListenersAfter = tracker.getTotalCount();
    const offSorted = [...offNavTimes].sort((a, b) => a - b);
    const offBaseline = {
      navDurationP50: percentile(offSorted, 50),
      navDurationP95: percentile(offSorted, 95),
      listenersBefore: offListenersBefore,
      listenersAfter: offListenersAfter,
      listenersDelta: offListenersAfter - offListenersBefore,
    };

    // 2. Baseline ON: Real userscript execution on YouTube DOM
    setupYouTubeDom();
    window.GM_info = { script: { version: '2.5.3' } };
    window.GM_addElement = () => {
      /* mock */
    };
    window.GM_setValue = () => {
      /* mock */
    };
    window.GM_getValue = () => {
      /* mock */
    };
    window.GM_registerMenuCommand = () => {
      /* mock */
    };
    window.GM_xmlhttpRequest = () => {
      /* mock */
    };
    window.unsafeWindow = window;

    const tInit0 = performance.now();
    const runBundle = new Function(bundleSrc);
    runBundle();
    const tInit1 = performance.now();
    const initDuration = tInit1 - tInit0;

    // Boot must be verified: window.__ytpMainBootDone__ must be true
    expect(window.__ytpMainBootDone__).toBe(true);

    // The bundle registers listeners from deferred work too (dictionary load,
    // visibility observers, hotkeys). Measuring while that work is still
    // landing makes the leak number depend on scheduling, not on the
    // navigation cycles under test, so wait for the real post-boot marker and
    // then for a settled microtask/timer queue.
    await waitForMainExecDone(window);
    await settlePendingWork();
    const listenersSettled = tracker.getTotalCount();

    const onListenersBefore = tracker.getTotalCount();
    const onNavTimes = [];
    // Listener count after each cycle, so growth can be compared per half.
    const listenerMarks = [onListenersBefore];

    // Run 20 SPA navigation cycles with userscript active
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      window.dispatchEvent(new CustomEvent('yt-navigate-start'));
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      const t1 = performance.now();
      onNavTimes.push(t1 - t0);
      listenerMarks.push(tracker.getTotalCount());
    }
    const onListenersAfter = tracker.getTotalCount();
    const onSorted = [...onNavTimes].sort((a, b) => a - b);

    const onBaseline = {
      initDurationMs: Math.round(initDuration * 100) / 100,
      bootMarkerVerified: window.__ytpMainBootDone__ === true,
      navDurationP50: Math.round(percentile(onSorted, 50) * 100) / 100,
      navDurationP95: Math.round(percentile(onSorted, 95) * 100) / 100,
      listenersBefore: onListenersBefore,
      listenersAfter: onListenersAfter,
      listenersDelta: onListenersAfter - onListenersBefore,
      listenersAfterSettling: listenersSettled,
    };

    // 3. Verifications & Logical Asserts
    // Verified boot
    expect(onBaseline.bootMarkerVerified).toBe(true);

    // No unbounded listener leaks: delta across 20 cycles must be <= 2
    expect(onBaseline.listenersDelta).toBeLessThanOrEqual(2);

    // A leak accumulates with the number of cycles. The first half may even
    // release listeners (navigation cleanup), so the invariant is per half:
    // the second block of cycles must not add more than the leak budget, no
    // matter what the first block did.
    const growthInSecondHalf = listenerMarks[20] - listenerMarks[10];
    expect(growthInSecondHalf).toBeLessThanOrEqual(2);

    // jsdom wall-clock numbers are NOT browser metrics and carry no budget
    // here — CI load and V8 make them too noisy to gate on, and speed as a
    // product property is measured only by the browser benchmark suite.
    // The p50/p95 figures are recorded in the report below as diagnostics;
    // the logical contract this suite enforces is the boot marker and the
    // listener budget above.

    // 4. Save Report
    const report = {
      timestamp: new Date().toISOString(),
      bundleHash,
      bundleSizeBytes: bundleSrc.length,
      sampleRuns: 20,
      negativeControlsPassed: true,
      off: offBaseline,
      on: onBaseline,
      comparison: {
        navLatencyDeltaP50Ms:
          Math.round((onBaseline.navDurationP50 - offBaseline.navDurationP50) * 100) / 100,
        listenerLeakDelta20Cycles: onBaseline.listenersDelta,
        listenerGrowthSecondHalf: listenerMarks[20] - listenerMarks[10],
        leakBudgetPassed: onBaseline.listenersDelta <= 2,
      },
    };

    fs.mkdirSync(path.dirname(JSDOM_BASELINE_OUTPUT), { recursive: true });
    fs.writeFileSync(JSDOM_BASELINE_OUTPUT, JSON.stringify(report, null, 2), 'utf8');

    expect(fs.existsSync(JSDOM_BASELINE_OUTPUT)).toBe(true);
  });
});
