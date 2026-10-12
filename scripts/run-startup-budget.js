/**
 * Startup budget runner.
 *
 * Measures script startup on the mock (headless Chromium +
 * e2e/fixtures/youtube-mock-full.html) in BOTH configurations:
 *   - 'default' — settings defaults (all features on per DEFAULTS);
 *   - 'all-off' — every boolean feature flag off through the REAL paths:
 *     the canonical store blob (calibrated from store.DEFAULTS via
 *     store.set) plus the per-module legacy storage keys whose enabling
 *     flag bypasses the canonical blob (adblocker, comment, pip).
 *
 * Per configuration it reports:
 *   - syncMs — synchronous bundle execution (wall-clock around script
 *     insertion; the single long task a real YouTube load pays at start);
 *   - bootMs — injection → __ytpMainBootDone__ (includes async boot work);
 *   - CSS rules the script adds to document-level styleSheets right after
 *     boot (new owner nodes vs the pre-injection snapshot; ShadowRoot
 *     styles are not in document.styleSheets and stay out of this metric);
 *   - observer constructor counts during the startup window (boot + settle);
 *   - usedJSHeapSize right after the boot flag and after the settle window.
 *
 * `--thresholds` turns the report into the CI gate: strict fail on CSS rules
 * and observer counts; sync time and heap stay REPORT-ONLY (machine-dependent,
 * no CI budget by design). Without the flag the run is report-only.
 *
 * Usage:
 *   node scripts/run-startup-budget.js [--config both] [--runs 5]
 *        [--settle 1000] [--out test-results/startup-budget.json]
 *        [--bundle <path>] [--thresholds]
 * The bundle resolution also honors TEST_BUNDLE_PATH like the e2e fixture.
 */

const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const {
  STARTUP_PROBE_SCRIPT,
  BOOT_AND_MEASURE_SCRIPT,
  COLLECT_STATE_SCRIPT,
  CALIBRATE_ALL_OFF_SCRIPT,
} = require('./startup-probe');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE_MIN = path.join(ROOT, 'youtube.user.min.js');
const BUNDLE_UNMINIFIED = path.join(ROOT, 'youtube.user.js');
const GREASYFORK_CHAR_LIMIT = 2 * 1024 * 1024;
const FIXTURE_PATH = path.join(ROOT, 'e2e', 'fixtures', 'youtube-mock-full.html');
const DEFAULT_OUT = path.join(ROOT, 'test-results', 'startup-budget.json');

/**
 * Strict CI thresholds (fail the run when exceeded). The budget follows the
 * measured startup baselines; it is intentionally data-only
 * (counts), never timing. Values are ratchets: lowering one is a conscious
 * budget change in this file.
 *
 * The css-rules ratchets were raised once (all-off 303 -> 428, default 587 ->
 * 712) when the Vision dock's own CSS moved out of the lazily-loaded settings
 * bundle into the eagerly-loaded player-surface / shared-UI bundles: the dock
 * was invisible until the settings window opened, so those rules now load at
 * boot. The raise equals exactly the rules those two bundles add.
 */
const THRESHOLDS = {
  // Strict ratchets at the measured baselines (report: test-results/startup-budget.json):
  // feature CSS that follows the lifecycle starts and stops with its feature.
  'all-off': {
    cssRulesMax: 428,
    observers: { MutationObserver: 6, IntersectionObserver: 0, ResizeObserver: 0 },
  },
  default: {
    cssRulesMax: 712,
    observers: { MutationObserver: 6, IntersectionObserver: 1, ResizeObserver: 1 },
  },
  // syncMs and heap: report-only by design (machine-dependent, no CI budget).
};

/**
 * Legacy per-module storage seeds for the all-off configuration. The enabling
 * flags of these modules bypass the canonical settings blob and read their own
 * key; `{ enabled: false }` is the exact shape every `settings.load()` expects.
 */
const ALL_OFF_LEGACY_SEEDS = {
  youtube_adblocker_settings: { enabled: false },
  youtube_comment_manager_settings: { enabled: false },
  youtube_pip_settings: { enabled: false },
};

/**
 * @param {number[]} values
 * @returns {{ min: number, p50: number, max: number }}
 */
function aggregate(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: round(sorted[0]),
    p50: round(percentile(sorted, 50)),
    max: round(sorted[sorted.length - 1]),
  };
}

/**
 * @param {number[]} sorted already sorted ascending
 * @param {number} p percentile 0..100
 */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** @param {number} n */
function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {string[]} argv
 * @returns {{ runs: number, settleMs: number, out: string, bundle: string | null, config: 'default' | 'all-off' | 'both', thresholds: boolean }}
 */
function parseArgs(argv) {
  /** @type {{ runs: number, settleMs: number, out: string, bundle: string | null, config: 'default' | 'all-off' | 'both', thresholds: boolean }} */
  const args = {
    runs: 5,
    settleMs: 1000,
    out: DEFAULT_OUT,
    bundle: process.env.TEST_BUNDLE_PATH
      ? path.resolve(process.cwd(), process.env.TEST_BUNDLE_PATH)
      : null,
    config: 'both',
    thresholds: false,
  };
  const readValue = (name, index, list) => {
    const value = list[index + 1];
    if (value === undefined || value === '') throw new Error(`${name}: value is missing`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') {
      const value = Number(readValue('--runs', i, argv));
      if (!Number.isInteger(value) || value < 1 || value > 50) {
        throw new Error(`--runs must be an integer between 1 and 50, got: ${value}`);
      }
      i += 1;
      args.runs = value;
    } else if (arg === '--settle') {
      const value = Number(readValue('--settle', i, argv));
      if (!Number.isFinite(value) || value < 0 || value > 10000) {
        throw new Error(
          `--settle must be a number of milliseconds between 0 and 10000, got: ${value}`
        );
      }
      i += 1;
      args.settleMs = value;
    } else if (arg === '--out') {
      args.out = path.resolve(readValue('--out', i, argv));
      i += 1;
    } else if (arg === '--bundle') {
      args.bundle = path.resolve(readValue('--bundle', i, argv));
      i += 1;
    } else if (arg === '--config') {
      const value = readValue('--config', i, argv);
      if (value !== 'default' && value !== 'all-off' && value !== 'both') {
        throw new Error(`--config must be one of: default, all-off, both (got: ${value})`);
      }
      i += 1;
      args.config = value;
    } else if (arg === '--thresholds') {
      args.thresholds = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return args;
}

/**
 * @param {string | null} explicitPath
 * @returns {string}
 */
function resolveBundle(explicitPath) {
  if (explicitPath) return explicitPath;
  for (const candidate of [BUNDLE_MIN, BUNDLE_UNMINIFIED]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Userscript bundle not found — build first (npm run build:release)');
}

/**
 * Serves the SPA mock for every GET path, same as the U18 runner and e2e.
 */
function startFixtureServer() {
  const fixtureContent = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fixtureContent);
  });
  return server;
}

/** @param {string} bundleRaw */
function stripUserscriptHeader(bundleRaw) {
  const endTag = '// ==/UserScript==';
  const idx = bundleRaw.indexOf(endTag);
  return idx === -1 ? bundleRaw : bundleRaw.slice(idx + endTag.length).trim();
}

/**
 * Aggregates per-run observer count objects (type → count) into min/max ranges.
 * @param {Record<string, unknown>[]} samples
 * @param {string} key
 */
function aggregateObserverCounts(samples, key) {
  const out = {};
  for (const sample of samples) {
    for (const [type, count] of Object.entries(/** @type {any} */ (sample)[key] || {})) {
      if (!out[type]) out[type] = { min: count, max: count };
      out[type].min = Math.min(out[type].min, count);
      out[type].max = Math.max(out[type].max, count);
    }
  }
  return out;
}

/**
 * Prepares a fresh measurement context. The all-off configuration seeds the
 * calibrated store blob and the legacy module keys BEFORE injection, so the
 * boot reads the disabled flags on its very first storage accesses.
 * @param {any} browser
 * @param {(route: string) => string} pageUrl
 * @param {'default' | 'all-off'} configName
 * @param {string | null} allOffBlob raw persisted settings blob (calibrated)
 * @returns {Promise<any>} page
 */
async function openMeasurementPage(browser, pageUrl, configName, allOffBlob) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(pageUrl(`/watch?v=startup_budget_${configName}`));
    if (configName === 'all-off') {
      if (!allOffBlob) throw new Error('all-off config requested without a calibrated store blob');
      await page.evaluate(
        seeds => {
          localStorage.setItem('youtube_plus_settings', seeds.main);
          for (const [key, value] of Object.entries(seeds.legacy)) {
            localStorage.setItem(key, JSON.stringify(value));
          }
        },
        { main: allOffBlob, legacy: ALL_OFF_LEGACY_SEEDS }
      );
    }
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

/**
 * Runs the calibration boot for the all-off configuration: boots the bundle
 * with default settings, then turns every boolean-true settings leaf off
 * through store.set (the real write path) and dumps the persisted blob.
 * @param {any} browser
 * @param {(route: string) => string} pageUrl
 * @param {string} bundleCode
 * @returns {Promise<{ booleanPaths: string[], blob: string }>}
 */
async function calibrateAllOff(browser, pageUrl, bundleCode) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(pageUrl('/watch?v=startup_budget_calibration'));
    await page.evaluate(bundleText => {
      globalThis.__startupBundleCode__ = bundleText;
    }, bundleCode);
    await page.evaluate(STARTUP_PROBE_SCRIPT);
    await page.evaluate(BOOT_AND_MEASURE_SCRIPT);
    /** @type {{ booleanPaths: string[], blob: string }} */
    const calibration = await page.evaluate(CALIBRATE_ALL_OFF_SCRIPT);
    if (!calibration || !calibration.blob) {
      throw new Error('all-off calibration did not return the persisted settings blob');
    }
    return calibration;
  } finally {
    await context.close();
  }
}

/**
 * Runs one measurement configuration and returns its samples.
 * @param {any} browser
 * @param {(route: string) => string} pageUrl
 * @param {{ runs: number, settleMs: number }} args
 * @param {'default' | 'all-off'} configName
 * @param {null | { booleanPaths: string[], blob: string }} calibration
 * @param {string} bundleCode
 * @param {(line: string) => void} log
 */
async function measureConfig(browser, pageUrl, args, configName, calibration, bundleCode, log) {
  const samples = [];
  for (let runIndex = 1; runIndex <= args.runs; runIndex++) {
    const page = await openMeasurementPage(browser, pageUrl, configName, calibration?.blob || null);
    try {
      // Stage bundle bytes via a real function call, then run the string page
      // scripts below as IIFE expressions (Playwright evaluates string page
      // functions as expressions and never auto-invokes them).
      await page.evaluate(bundleText => {
        globalThis.__startupBundleCode__ = bundleText;
      }, bundleCode);
      // Instrument BEFORE injection.
      await page.evaluate(STARTUP_PROBE_SCRIPT);
      /** @type {{ syncMs: number, bootMs: number, heapAfterBootBytes: number }} */
      const boot = await page.evaluate(BOOT_AND_MEASURE_SCRIPT);
      if (!boot || typeof boot.syncMs !== 'number') {
        throw new Error('boot measurement returned no data');
      }
      await page.waitForTimeout(args.settleMs);
      /** @type {{ sheetsTotal: number, scriptSheets: any[], cssRulesAddedByScript: number, observersAtBoot: Record<string, number>, observersAtSettle: Record<string, number>, heap: { usedBytes: number, totalBytes: number } }} */
      const state = await page.evaluate(COLLECT_STATE_SCRIPT);
      if (!state) {
        throw new Error('startup state collection returned no data (probe failed to run)');
      }
      samples.push({
        run: runIndex,
        syncMs: round(boot.syncMs),
        bootMs: round(boot.bootMs),
        cssRulesAddedByScript: state.cssRulesAddedByScript,
        sheetsTotal: state.sheetsTotal,
        scriptSheets: state.scriptSheets,
        observersAtBoot: state.observersAtBoot,
        observersAtSettle: state.observersAtSettle,
        heapAfterBootBytes: boot.heapAfterBootBytes,
        heapAfterSettleBytes: state.heap.usedBytes,
      });
      log(
        `run ${runIndex}/${args.runs}: sync ${round(boot.syncMs).toFixed(1)}ms | css rules ${state.cssRulesAddedByScript} | observers ${JSON.stringify(state.observersAtBoot)} | heap ${(state.heap.usedBytes / 1048576).toFixed(1)}MB`
      );
    } finally {
      await page.context().close();
    }
  }

  return {
    syncMs: aggregate(samples.map(sample => sample.syncMs)),
    bootMs: aggregate(samples.map(sample => sample.bootMs)),
    cssRulesAddedByScript: aggregate(samples.map(sample => sample.cssRulesAddedByScript)),
    scriptSheetIds: [
      ...new Set(
        samples.flatMap(sample =>
          sample.scriptSheets.map(sheet => sheet.id || '(no id / page-loaded)')
        )
      ),
    ],
    observersAtBoot: aggregateObserverCounts(samples, 'observersAtBoot'),
    observersAtSettle: aggregateObserverCounts(samples, 'observersAtSettle'),
    heapAfterBootMb: aggregate(samples.map(sample => sample.heapAfterBootBytes / 1048576)),
    heapAfterSettleMb: aggregate(samples.map(sample => sample.heapAfterSettleBytes / 1048576)),
    runs: samples,
  };
}

/**
 * Evaluates the strict CI thresholds for one configuration. Only the metrics
 * the gate owns (count metrics) are compared; timing stays report-only.
 * @param {{ cssRulesAddedByScript: { max: number }, observersAtBoot: Record<string, { max: number }> }} agg
 * @param {'default' | 'all-off'} configName
 */
function evaluateThresholds(agg, configName) {
  const limits = THRESHOLDS[configName];
  const results = [];
  if (limits && typeof limits.cssRulesMax === 'number') {
    results.push({
      gate: `${configName}: css rules ≤ ${limits.cssRulesMax}`,
      actual: agg.cssRulesAddedByScript.max,
      ok: agg.cssRulesAddedByScript.max <= limits.cssRulesMax,
    });
  }
  for (const [type, max] of Object.entries(limits?.observers || {})) {
    const actual = agg.observersAtBoot[type]?.max ?? 0;
    results.push({
      gate: `${configName}: ${type} ≤ ${max}`,
      actual,
      ok: actual <= max,
    });
  }
  return results;
}

async function runStartupBudget() {
  const args = parseArgs(process.argv.slice(2));
  const bundlePath = resolveBundle(args.bundle);
  const bundleRaw = fs.readFileSync(bundlePath, 'utf8');
  const bundleCode = stripUserscriptHeader(bundleRaw);
  const bundleHash = crypto.createHash('sha256').update(bundleRaw, 'utf8').digest('hex');

  /** @type {{ file: string, characters: number, greasyForkLimitPercent: number, greasyForkLimitRatio: number } | null} */
  let readableMetrics = null;
  if (fs.existsSync(BUNDLE_UNMINIFIED)) {
    const readableContent = fs.readFileSync(BUNDLE_UNMINIFIED, 'utf8');
    const chars = Array.from(readableContent).length;
    const ratio = chars / GREASYFORK_CHAR_LIMIT;
    const percent = round(ratio * 100);
    readableMetrics = {
      file: path.basename(BUNDLE_UNMINIFIED),
      characters: chars,
      greasyForkLimitPercent: percent,
      greasyForkLimitRatio: round(ratio),
    };
    console.log(
      `[Startup budget] Readable bundle size: ${chars} chars (${percent}% of GreasyFork 2MB limit)`
    );
  }

  const server = startFixtureServer();
  await /** @type {Promise<void>} */ (
    new Promise(resolve => {
      server.once('listening', () => resolve());
      server.listen({ port: 0, host: '127.0.0.1' });
    })
  );
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('fixture server did not open a TCP port');
  const browser = await chromium.launch({ headless: true });

  const pageUrl = route => `http://127.0.0.1:${address.port}${route}`;
  /** @type {Array<'default' | 'all-off'>} */
  const configNames = args.config === 'both' ? ['default', 'all-off'] : [args.config];

  console.log(
    `[Startup budget] (${args.thresholds ? 'CI GATE' : 'REPORT ONLY'}): bundle ${path.basename(bundlePath)} (sha256 ${bundleHash.slice(0, 12)}…), Chromium ${browser.version()} headless, fixture ${path.basename(FIXTURE_PATH)}, configs: ${configNames.join('+')}, runs: ${args.runs}, settle: ${args.settleMs}ms`
  );

  /** @type {{ [config: string]: any }} */
  const byConfig = {};
  /** @type {{ booleanPaths: string[], blob: string } | null} */
  let calibration = null;
  try {
    if (configNames.includes('all-off')) {
      calibration = await calibrateAllOff(browser, pageUrl, bundleCode);
      console.log(
        `[Startup budget] all-off calibration: ${calibration.booleanPaths.length} boolean flags off via store.set; blob bytes: ${calibration.blob.length}`
      );
    }
    for (const configName of configNames) {
      console.log(`[Startup budget] config ${configName}:`);
      byConfig[configName] = await measureConfig(
        browser,
        pageUrl,
        args,
        configName,
        configName === 'all-off' ? calibration : null,
        bundleCode,
        line => console.log(`[Startup budget] ${line}`)
      );
      const agg = byConfig[configName];
      console.log(
        `[Startup budget] ${configName}: sync ${agg.syncMs.min}–${agg.syncMs.max}ms (p50 ${agg.syncMs.p50}) | css rules ${agg.cssRulesAddedByScript.min}–${agg.cssRulesAddedByScript.max} (p50 ${agg.cssRulesAddedByScript.p50}) | observers ${JSON.stringify(agg.observersAtBoot)} | heap p50 ${agg.heapAfterSettleMb.p50}MB`
      );
    }
  } finally {
    await browser.close();
    await /** @type {Promise<void>} */ (new Promise(resolve => server.close(() => resolve())));
  }

  /** @type {{ ok: boolean, gate: string, actual: number }[]} */
  let gates = [];
  /** @type {boolean | null} */
  let thresholdsPassed = null;
  if (args.thresholds) {
    gates = configNames.flatMap(configName => evaluateThresholds(byConfig[configName], configName));
    for (const gate of gates) {
      console.log(
        `[Startup budget] ${gate.ok ? 'PASS' : 'FAIL'} ${gate.gate} (actual: ${gate.actual})`
      );
    }
    thresholdsPassed = gates.every(gate => gate.ok);
    console.log(`[Startup budget] Thresholds passed: ${thresholdsPassed}`);
  }

  const report = {
    name: 'startup-budget',
    timestamp: new Date().toISOString(),
    mode: args.thresholds ? 'ci-gate' : 'report-only',
    thresholdsEvaluated: Boolean(args.thresholds),
    thresholdsPassed,
    referenceTargets: {
      // Startup targets: sync ≤ 10ms and CSS rules ≤ 300 — only in the
      // all-features-disabled state; sync is report-only by design.
      syncMsMax: 10,
      cssRulesMax: 300,
    },
    environment: {
      browser: `Chromium ${browser.version()}`,
      headless: true,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
    bundle: {
      file: path.basename(bundlePath),
      sha256: bundleHash,
      sizeKB: round(Buffer.byteLength(bundleRaw, 'utf8') / 1024),
      readable: readableMetrics || undefined,
    },
    fixture: path.relative(ROOT, FIXTURE_PATH),
    config: { runs: args.runs, settleMs: args.settleMs, configs: configNames },
    allOff: calibration
      ? { booleanPaths: calibration.booleanPaths, legacySeeds: Object.keys(ALL_OFF_LEGACY_SEEDS) }
      : undefined,
    configs: byConfig,
    gates,
    notes: {
      syncMs:
        'wall-clock around document.body.appendChild(script) in the page — the synchronous bundle execution (one long task)',
      bootMs:
        'injection → __ytpMainBootDone__; includes async boot work (dictionary delivery, facades)',
      cssRules:
        'document-level styleSheets added by the script, identified by owner-node identity vs the pre-injection snapshot; ShadowRoot styles are out of the document.styleSheets metric',
      observers:
        'constructor counts while the probe is installed: MutationObserver/IntersectionObserver/ResizeObserver wrapped with a Proxy before injection (boot + settle window)',
      heap: 'performance.memory.usedJSHeapSize, right after the boot flag and after the settle window; no forced GC — coarse, compare medians not single samples',
      allOffConstruction:
        'calibration boot reads store.DEFAULTS and turns every boolean-true leaf off via store.set (real write path); per-module legacy enable keys are seeded as {"enabled": false}',
      gates:
        'count metrics only (CSS rules, observers); sync time and heap are machine-dependent and report-only by design → never CI-gated',
      greasyForkLimit:
        'GreasyFork readable userscript length is capped at 2 MiB characters (2 * 1024 * 1024); reporting-only metric',
    },
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[Startup budget] Report saved to ${args.out}`);

  return { report, thresholdsPassed };
}

if (require.main === module) {
  runStartupBudget()
    .then(result => {
      if (result.thresholdsPassed === false) {
        console.error('[Startup budget] Startup budget thresholds failed.');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('[Startup budget] Startup budget run failed:', error);
      process.exit(1);
    });
}

module.exports = { runStartupBudget, THRESHOLDS, ALL_OFF_LEGACY_SEEDS };
