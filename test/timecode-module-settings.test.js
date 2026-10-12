/**
 * Timecode settings through the shared settings blob. The real store runs
 * against a Map-backed GM stub and an explicit host policy, and the real
 * timecode module is loaded on top.
 *
 * Contracts under test:
 *   - Once the blob exists the legacy `youtube_timecode_settings` payload is
 *     migrated into `modules.timecode` and preserved.
 *   - Without the blob the legacy key stays authoritative and no blob is made.
 *   - A blob change from another tab is applied to the live config.
 * @jest-environment jsdom
 */

const BLOB = 'ytp_settings_v3';
const LEGACY = 'youtube_timecode_settings';

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

function setupDeps() {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  window._timecodeModuleInitialized = false;
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/i18n.js');
  require('../src/design-system.js');

  const utils = window.YouTubeUtils;
  utils.confirmDialog = jest.fn(() => Promise.resolve(true));
  utils.NotificationManager = { show: jest.fn() };
  utils.createIsRelevantRoute = jest.fn(() => () => true);
  utils.whenRelevant = jest.fn((/** @type {{ onEnter?: () => void }} */ { onEnter }) => {
    if (typeof onEnter === 'function') onEnter();
  });

  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    href: 'https://www.youtube.com/watch?v=test',
  });
}

function loadTimecode() {
  require('../src/timecode.js');
  window.YouTubePlusTimecode.testHooks.setupTimecodeSettingsIntegration();
  return window.YouTubePlusTimecode;
}

beforeEach(() => {
  jest.resetModules();
  delete window.YouTubePlusTimecode;
  delete window._timecodeModuleInitialized;
  delete window.YouTubePlusHostPolicy;
  delete window._ytpSettingsStoreGmListenerId;
  delete window._ytpSettingsStoreStorageKey;
  delete window._ytpSettingsStoreUpdateKey;
  localStorage.clear();
});

afterEach(() => {
  delete globalThis.GM_getValue;
  delete globalThis.GM_setValue;
  delete globalThis.GM_addValueChangeListener;
  localStorage.clear();
});

describe('timecode settings through the shared blob', () => {
  test('migrates the legacy settings into modules.timecode when the blob exists', () => {
    localStorage.setItem(
      LEGACY,
      JSON.stringify({
        autoDetect: false,
        autoSave: false,
        shortcut: { key: 'c', shiftKey: false, altKey: true, ctrlKey: false },
      })
    );
    const { store } = installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);

    setupDeps();
    const timecode = loadTimecode();

    const cfg = timecode.config;
    expect(cfg.autoDetect).toBe(false);
    expect(cfg.autoSave).toBe(false);
    expect(cfg.shortcut.key).toBe('c');
    expect(cfg.shortcut.altKey).toBe(true);

    const mod = JSON.parse(store.get(BLOB)).modules.timecode;
    expect(mod.autoDetect).toBe(false);
    expect(mod.shortcut.key).toBe('c');
  });

  test('a blob change from another tab re-applies to the live config', () => {
    const { store, listeners } = installGm({
      [BLOB]: blobOf({
        timecode: {
          autoDetect: true,
          shortcut: { key: 'T', shiftKey: true, altKey: false, ctrlKey: false },
        },
      }),
    });
    installPolicy(true);

    setupDeps();
    const timecode = loadTimecode();
    expect(timecode.config.shortcut.key).toBe('T');

    const next = blobOf({
      timecode: {
        autoDetect: true,
        shortcut: { key: 'K', shiftKey: false, altKey: false, ctrlKey: false },
      },
    });
    store.set(BLOB, next);
    listeners[0].cb(BLOB, null, next, true);

    expect(timecode.config.shortcut.key).toBe('K');
  });

  test('without the blob the legacy key stays authoritative and no blob is created', () => {
    localStorage.setItem(LEGACY, JSON.stringify({ autoDetect: false }));
    const { store } = installGm();
    installPolicy(false);

    setupDeps();
    const timecode = loadTimecode();

    expect(store.has(BLOB)).toBe(false);
    expect(timecode.config.autoDetect).toBe(false);

    timecode.testHooks.saveSettings();
    expect(store.has(BLOB)).toBe(false);
    expect(JSON.parse(localStorage.getItem(LEGACY)).autoDetect).toBe(false);
  });
});
