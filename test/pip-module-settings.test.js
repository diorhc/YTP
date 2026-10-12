/**
 * PiP settings through the shared settings blob. The real store runs against a
 * Map-backed GM stub and an explicit host policy, and the real pip module is
 * started with a minimal feature context.
 *
 * Contracts under test:
 *   - Once the blob exists the legacy `youtube_pip_settings` shortcut is
 *     migrated into `modules.pip` and preserved.
 *   - The enable switch lives in the main settings, so the module's own
 *     `enabled` is neither read nor written.
 *   - Without the blob the legacy key stays authoritative and no blob is made.
 *   - A blob change from another tab is applied to the live shortcut.
 * @jest-environment jsdom
 */

const BLOB = 'ytp_settings_v3';
const LEGACY = 'youtube_pip_settings';

/** @param {Record<string, string>} [initial] */
function installGm(initial) {
  const store = new Map(Object.entries(initial || {}));
  /** @type {{ key: string, cb: Function }[]} */
  const listeners = [];
  globalThis.GM_getValue = (key, def) => (store.has(key) ? store.get(key) : def);
  globalThis.GM_setValue = (key, value) => {
    store.set(key, value);
  };
  globalThis.GM_addValueChangeListener = (key, cb) => {
    listeners.push({ key, cb });
    return listeners.length;
  };
  return { store, listeners };
}

/** @param {boolean} owns */
function installPolicy(owns) {
  window.YouTubePlusHostPolicy = {
    hostClass: () => 'youtube',
    ownsSharedSettings: () => owns,
    table: {},
    runs: () => true,
  };
}

/** @param {Record<string, unknown>} modules */
function blobOf(modules) {
  return JSON.stringify({ version: 3, main: {}, modules });
}

function pipBlob(shortcut) {
  return blobOf({ pip: { shortcut } });
}

/** A minimal feature context: only `scope()` with `listen`/`dispose` is read. */
function makeCtx() {
  /** @type {[EventTarget, string, EventListener, any][]} */
  const listeners = [];
  const scope = {
    listen: (
      /** @type {EventTarget} */ target,
      /** @type {string} */ type,
      /** @type {EventListener} */ handler,
      /** @type {any} */ opts
    ) => {
      listeners.push([target, type, handler, opts]);
      target.addEventListener(type, handler, opts);
    },
    dispose: () => {
      for (const [target, type, handler, opts] of listeners) {
        target.removeEventListener(type, handler, opts);
      }
      listeners.length = 0;
    },
  };
  return { scope: () => scope, dispose: () => scope.dispose() };
}

function installUtils() {
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      exposeTestHooks: (/** @type {any} */ facade, /** @type {any} */ hooks) => {
        facade.testHooks = hooks;
      },
      getPageWindow: () => window,
      logSuppressed: jest.fn(),
      helpers: {
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
        $: (/** @type {string} */ sel) => document.querySelector(sel),
        byId: (/** @type {string} */ id) => document.getElementById(id),
      },
      storage: {
        getItem: (/** @type {string} */ k) => localStorage.getItem(k),
        setItem: (/** @type {string} */ k, /** @type {string} */ v) => {
          localStorage.setItem(k, v);
          return true;
        },
      },
      StyleManager: { add: jest.fn(), remove: jest.fn() },
      t: (/** @type {string} */ k) => k || '',
      loadFeatureEnabled: jest.fn(() => true),
      cleanupManager: null,
    },
  });
}

function loadStore() {
  require('../src/cleanup-manager.js');
  require('../src/settings-store.js');
  window.YouTubeUtils.cleanupManager = window.YouTubePlusCleanupManager;
}

function startPip() {
  installUtils();
  loadStore();
  require('../src/pip.js');
  const ctx = makeCtx();
  window.YouTubePlusPip.testHooks.init(/** @type {any} */ (ctx));
  return ctx;
}

beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = '';
  localStorage.clear();
  delete window.YouTubePlusPip;
  delete window.YouTubeUtils;
  delete window.YouTubePlusHostPolicy;
  delete window._ytpSettingsStoreGmListenerId;
  delete window._ytpSettingsStoreStorageKey;
  delete window._ytpSettingsStoreUpdateKey;
});

afterEach(() => {
  delete globalThis.GM_getValue;
  delete globalThis.GM_setValue;
  delete globalThis.GM_addValueChangeListener;
  localStorage.clear();
});

describe('pip settings through the shared blob', () => {
  test('migrates the legacy shortcut into modules.pip when the blob exists', () => {
    localStorage.setItem(
      LEGACY,
      JSON.stringify({
        enabled: false,
        shortcut: { key: 'I', shiftKey: false, altKey: true, ctrlKey: false },
      })
    );
    const { store } = installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);

    startPip();

    const settings = window.YouTubePlusPip.testHooks.getSettings();
    expect(settings.shortcut.key).toBe('I');
    const pip = JSON.parse(store.get(BLOB)).modules.pip;
    expect(pip.enabled).toBeUndefined();
    expect(pip.shortcut.key).toBe('I');
    // The legacy `enabled` moved into the main switch and off the legacy key.
    expect(window.YouTubePlusSettingsStore.get('enablePip')).toBe(false);
  });

  test('a blob change from another tab re-applies to the live shortcut', () => {
    const { store, listeners } = installGm({
      [BLOB]: pipBlob({ key: 'P', shiftKey: true, altKey: false, ctrlKey: false }),
    });
    installPolicy(true);

    startPip();
    expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.key).toBe('P');

    const next = pipBlob({ key: 'K', shiftKey: false, altKey: false, ctrlKey: false });
    store.set(BLOB, next);
    listeners[0].cb(BLOB, null, next, true);

    expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.key).toBe('K');
  });

  test('without the blob the legacy key stays authoritative and no blob is created', () => {
    localStorage.setItem(
      LEGACY,
      JSON.stringify({
        enabled: false,
        shortcut: { key: 'J', shiftKey: false, altKey: false, ctrlKey: false },
      })
    );
    const { store } = installGm();
    installPolicy(false);

    startPip();

    expect(store.has(BLOB)).toBe(false);
    const settings = window.YouTubePlusPip.testHooks.getSettings();
    expect(settings.shortcut.key).toBe('J');
  });
});
