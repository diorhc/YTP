/**
 * @fileoverview In-page instrumentation for scripts/run-startup-budget.js.
 *
 * All three scripts run inside the page (Playwright evaluates string page
 * functions as expressions — each is an IIFE), which keeps them out of the
 * Node-side type check (tsconfig.scripts.json has no DOM lib, same reason
 * scripts/listener-tracker.js ships its page code as a string). The bundle
 * source is staged on the page first (window.__startupBundleCode__) because
 * string evaluates cannot receive arguments.
 *
 * The probe is installed BEFORE the userscript is injected. It counts the
 * observer constructors the bundle instantiates during the startup window and
 * snapshots the pre-injection stylesheet nodes, so script-added sheets can be
 * identified later by node identity — with no knowledge of script internals.
 * No cleanup: every run uses a fresh browser context, so the probe always
 * starts from a clean page.
 */

const STARTUP_PROBE_SCRIPT = `
(() => {
  if (window.__startupProbeAPI__) return;
  const api = {
    installedAt: performance.now(),
    counts: {},
    created: [],
    preSheetNodes: [...document.styleSheets].map(sheet => sheet.ownerNode),
  };
  for (const name of ['MutationObserver', 'IntersectionObserver', 'ResizeObserver']) {
    const Orig = window[name];
    if (typeof Orig !== 'function') {
      // Constructor absent in this environment; the runner reports -1.
      api.counts[name] = -1;
      continue;
    }
    api.counts[name] = 0;
    window[name] = new Proxy(Orig, {
      construct(_target, args) {
        api.counts[name] += 1;
        api.created.push({ type: name, at: Math.round(performance.now() - api.installedAt) });
        return new Orig(...args);
      },
    });
  }
  window.__startupProbeAPI__ = api;
})();
`;

/**
 * all-off calibration: walks the REAL settings store (window.YouTubePlusSettingsStore)
 * after a default boot and turns every boolean-true leaf off via store.set
 * (the same write path the settings modal uses), then reads back the persisted
 * canonical blob for the runner to seed into fresh contexts. Theme
 * preferences (strings) and already-false flags are left untouched.
 */
const CALIBRATE_ALL_OFF_SCRIPT = `
(() => {
  const store = window.YouTubePlusSettingsStore;
  if (!store || !store.DEFAULTS || typeof store.set !== 'function' || typeof store.get !== 'function') {
    throw new Error('SettingsStore facade is not available for all-off calibration');
  }
  const booleanPaths = [];
  const walk = (obj, prefix) => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? prefix + '.' + key : key;
      if (typeof value === 'boolean') {
        if (value === true) booleanPaths.push(path);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, path);
      }
    }
  };
  walk(store.DEFAULTS, '');
  for (const path of booleanPaths) {
    if (store.set(path, false) !== true) throw new Error('store.set rejected ' + path);
    if (store.get(path) !== false) throw new Error('store.get did not return false for ' + path);
  }
  const blob = localStorage.getItem('youtube_plus_settings');
  if (!blob) throw new Error('canonical settings blob was not persisted after calibration');
  return { booleanPaths, blob };
})();
`;

/** Injects the bundle, times the synchronous execution, waits for the boot flag. */
const BOOT_AND_MEASURE_SCRIPT = `
(async () => {
  const code = window.__startupBundleCode__;
  if (!code) throw new Error('bundle code was not staged on the page');
  const script = document.createElement('script');
  script.textContent = code;
  const t0 = performance.now();
  document.body.appendChild(script);
  const syncMs = performance.now() - t0;
  const deadline = performance.now() + 20000;
  while (!window.__ytpMainBootDone__) {
    if (performance.now() > deadline) {
      throw new Error('boot did not reach __ytpMainBootDone__ within 20s');
    }
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  window.__startupBootDoneAt__ = performance.now();
  if (!performance.memory) {
    throw new Error('performance.memory is unavailable — the heap metric requires Chromium');
  }
  return { syncMs, bootMs: window.__startupBootDoneAt__ - t0, heapAfterBootBytes: performance.memory.usedJSHeapSize };
})()
`;

/** Collects stylesheet/observer/heap state after the settle window. */
const COLLECT_STATE_SCRIPT = `
(() => {
  const api = window.__startupProbeAPI__;
  if (!api) throw new Error('startup probe is missing on the page');
  const preNodes = new Set(api.preSheetNodes);
  const sheets = [...document.styleSheets];
  const bootDelta = (window.__startupBootDoneAt__ || api.installedAt) - api.installedAt;
  const observersAtBoot = {};
  const observersAtSettle = {};
  for (const observation of api.created) {
    const { type, at } = observation;
    observersAtBoot[type] = (observersAtBoot[type] || 0) + (at <= bootDelta ? 1 : 0);
    observersAtSettle[type] = (observersAtSettle[type] || 0) + 1;
  }
  for (const [name, count] of Object.entries(api.counts)) {
    if (observersAtBoot[name] === undefined) observersAtBoot[name] = 0;
    if (observersAtSettle[name] === undefined) observersAtSettle[name] = count;
  }
  const scriptSheets = [];
  for (const sheet of sheets) {
    const node = sheet.ownerNode;
    if (!node || preNodes.has(node)) continue;
    const entry = {
      id: node.id || null,
      rules: -1,
      textLength: typeof node.textContent === 'string' ? node.textContent.length : -1,
    };
    try {
      entry.rules = sheet.cssRules.length;
    } catch (error) {
      // Cross-origin sheets cannot be inspected; they are page-loaded,
      // so an unknown count here does not pollute the script metric.
      entry.rulesError = String(error && error.message ? error.message : error);
    }
    scriptSheets.push(entry);
  }
  return {
    sheetsTotal: sheets.length,
    scriptSheets,
    cssRulesAddedByScript: scriptSheets.reduce((sum, entry) => sum + Math.max(0, entry.rules), 0),
    observersAtBoot,
    observersAtSettle,
    heap: {
      usedBytes: performance.memory.usedJSHeapSize,
      totalBytes: performance.memory.totalJSHeapSize,
    },
  };
})()
`;

module.exports = {
  STARTUP_PROBE_SCRIPT,
  BOOT_AND_MEASURE_SCRIPT,
  COLLECT_STATE_SCRIPT,
  CALIBRATE_ALL_OFF_SCRIPT,
};
