/**
 * @jest-environment jsdom
 *
 * Ad blocker settings through the shared settings blob. The real store runs
 * against a Map-backed GM stub and an explicit host policy, and the real
 * adblocker module boots on the real FeatureLifecycle chain.
 *
 * Contracts under test:
 *   - Once the blob exists the legacy `youtube_adblocker_settings` payload is
 *     migrated into `modules.adblocker` and preserved.
 *   - Without the blob the legacy key stays authoritative and no blob is made.
 *   - A blob change from another tab re-applies to the live config.
 */

const BLOB = 'ytp_settings_v3';
const LEGACY = 'youtube_adblocker_settings';

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

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/mutation-coordinator.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
}

/** @returns {Promise<void>} */
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = '<div id="movie_player"></div>';
  document.head.innerHTML = '';
  localStorage.clear();
  delete window.YouTubePlusAdBlocker;
  delete window.AdBlocker;
  delete window.YouTubeUtils;
  delete window.YouTubePlusSettingsStore;
  delete window.YouTubePlusHostPolicy;
  delete window.YouTubePlusFeatureRegistry;
  delete window._ytpSettingsStoreGmListenerId;
  delete window._ytpSettingsStoreStorageKey;
  delete window._ytpSettingsStoreUpdateKey;
  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    href: 'https://www.youtube.com/watch?v=test',
  });
});

afterEach(() => {
  delete globalThis.GM_getValue;
  delete globalThis.GM_setValue;
  delete globalThis.GM_addValueChangeListener;
  window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  localStorage.clear();
});

describe('adblocker settings through the shared blob', () => {
  test('migrates the legacy payload into modules.adblocker when the blob exists', async () => {
    localStorage.setItem(LEGACY, JSON.stringify({ enabled: true, enableLogging: true }));
    const { store } = installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);

    loadChain();
    require('../src/adblocker.js');
    await settle();

    const mod = JSON.parse(store.get(BLOB)).modules.adblocker;
    expect(mod.enableLogging).toBe(true);
    expect(window.AdBlocker.config.enableLogging).toBe(true);
  });

  test('without the blob the legacy key stays authoritative and no blob is created', async () => {
    localStorage.setItem(LEGACY, JSON.stringify({ enabled: true, enableLogging: true }));
    const { store } = installGm();
    installPolicy(false);

    loadChain();
    require('../src/adblocker.js');
    await settle();

    expect(store.has(BLOB)).toBe(false);
    expect(window.AdBlocker.config.enableLogging).toBe(true);
  });

  test('a blob change from another tab is applied to the live config', async () => {
    const before = blobOf({ adblocker: { enabled: true, enableLogging: false } });
    const { store, listeners } = installGm({ [BLOB]: before });
    installPolicy(true);

    loadChain();
    require('../src/adblocker.js');
    await settle();
    expect(window.AdBlocker.config.enableLogging).toBe(false);

    const next = blobOf({ adblocker: { enabled: true, enableLogging: true } });
    store.set(BLOB, next);
    const blobListener = listeners.find(entry => entry.key === BLOB);
    expect(blobListener).toBeTruthy();
    blobListener.cb(BLOB, before, next, true);

    expect(window.AdBlocker.config.enableLogging).toBe(true);
  });
});
