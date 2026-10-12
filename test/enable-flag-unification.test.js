/**
 * @jest-environment jsdom
 *
 * Ad blocker and PiP each used to carry their own `enabled` flag beside the
 * main `enableAdBlocker` / `enablePip` switch. The two could disagree: a user
 * who disabled the feature in 2.x kept a legacy `enabled:false` while the main
 * switch turned on, and the runtime refused to start. Now the main switch is
 * the only one, the legacy `enabled` is migrated into it, and the feature
 * lifecycle owns start/stop.
 */

const BLOB = 'ytp_settings_v3';
const LEGACY_AB = 'youtube_adblocker_settings';
const LEGACY_PIP = 'youtube_pip_settings';

/** @param {Record<string, string>} [initial] */
function installGm(initial) {
  const store = new Map(Object.entries(initial || {}));
  globalThis.GM_getValue = (key, def) => (store.has(key) ? store.get(key) : def);
  globalThis.GM_setValue = (key, value) => {
    store.set(key, value);
  };
  globalThis.GM_addValueChangeListener = () => 1;
  return { store };
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
  delete window.YouTubePlusPip;
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

describe('the main enable switch owns the ad blocker runtime', () => {
  test('a flag disabled in 2.x stays off, and enabling it starts the runtime', async () => {
    localStorage.setItem(LEGACY_AB, JSON.stringify({ enabled: false, enableLogging: true }));
    installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);

    loadChain();
    require('../src/adblocker.js');
    await settle();

    const S = window.YouTubePlusSettingsStore;
    // The legacy `enabled` moved into the main switch and off the legacy key.
    expect(S.get('enableAdBlocker')).toBe(false);
    expect(JSON.parse(localStorage.getItem(LEGACY_AB)).enabled).toBeUndefined();
    // Not started, so the runtime never loaded its logging preference.
    expect(window.AdBlocker.config.enableLogging).toBe(false);

    S.set('enableAdBlocker', true);
    await settle();

    // Started through the lifecycle: loadSettings() ran and applied the value.
    expect(window.AdBlocker.config.enableLogging).toBe(true);
  });
});

describe('the main enable switch owns the PiP runtime', () => {
  test('a flag disabled in 2.x stays off, and enabling it starts the runtime', async () => {
    localStorage.setItem(
      LEGACY_PIP,
      JSON.stringify({
        enabled: false,
        shortcut: { key: 'I', shiftKey: false, altKey: true, ctrlKey: false },
      })
    );
    installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);

    loadChain();
    require('../src/pip.js');
    await settle();

    const S = window.YouTubePlusSettingsStore;
    expect(S.get('enablePip')).toBe(false);
    expect(JSON.parse(localStorage.getItem(LEGACY_PIP)).enabled).toBeUndefined();
    // Not started, so the stored shortcut is not loaded yet.
    expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.key).toBe('P');

    S.set('enablePip', true);
    await settle();

    // Started through the lifecycle: loadSettings() read the legacy shortcut.
    expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.key).toBe('I');
  });
});
