/**
 * Screenshot shortcut settings through the shared settings blob. The real store
 * runs against a Map-backed GM stub and an explicit host policy, so the blob can
 * be driven directly, and the real screenshot module is loaded on top.
 *
 * Contracts under test:
 *   - Once the blob exists the legacy `youtube_screenshot_settings` payload is
 *     migrated into `modules.screenshot` and preserved.
 *   - Without the blob the legacy key stays authoritative and no blob is made.
 *   - A blob change from another tab is applied to the live shortcut.
 * @jest-environment jsdom
 */

const BLOB = 'ytp_settings_v3';
const LEGACY = 'youtube_screenshot_settings';

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

function screenshotBlob(shortcut) {
  return blobOf({ screenshot: { shortcut } });
}

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
}

beforeEach(() => {
  jest.resetModules();
  document.head.innerHTML = '';
  document.body.innerHTML =
    '<div id="movie_player"><div class="ytp-chrome-bottom"><div class="ytp-right-controls"></div></div></div>';
  localStorage.clear();
  delete window.YouTubePlusScreenshot;
  delete window.YouTubePlusHostPolicy;
  delete window._ytpSettingsStoreGmListenerId;
  delete window._ytpSettingsStoreStorageKey;
  delete window._ytpSettingsStoreUpdateKey;
});

afterEach(() => {
  window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  delete globalThis.GM_getValue;
  delete globalThis.GM_setValue;
  delete globalThis.GM_addValueChangeListener;
  localStorage.clear();
});

describe('screenshot settings through the shared blob', () => {
  test('migrates the legacy shortcut into modules.screenshot when the blob exists', () => {
    localStorage.setItem(
      LEGACY,
      JSON.stringify({ shortcut: { key: ' x ', shiftKey: true, altKey: false, ctrlKey: true } })
    );
    const { store } = installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);

    loadChain();
    require('../src/screenshot.js');

    const settings = window.YouTubePlusScreenshot.getSettings();
    expect(settings.shortcut.key).toBe('X');
    expect(settings.shortcut.ctrlKey).toBe(true);
    expect(JSON.parse(store.get(BLOB)).modules.screenshot.shortcut.key).toBe('X');
  });

  test('a blob change from another tab re-applies to the live shortcut', () => {
    const { store, listeners } = installGm({
      [BLOB]: screenshotBlob({ key: 'S', shiftKey: false, altKey: false, ctrlKey: false }),
    });
    installPolicy(true);

    loadChain();
    require('../src/screenshot.js');
    expect(window.YouTubePlusScreenshot.getSettings().shortcut.key).toBe('S');

    const next = screenshotBlob({ key: 'G', shiftKey: true, altKey: false, ctrlKey: false });
    store.set(BLOB, next);
    listeners[0].cb(BLOB, null, next, true);

    const settings = window.YouTubePlusScreenshot.getSettings();
    expect(settings.shortcut.key).toBe('G');
    expect(settings.shortcut.shiftKey).toBe(true);
  });

  test('an unrelated settings change is ignored', () => {
    installGm({
      [BLOB]: screenshotBlob({ key: 'S', shiftKey: false, altKey: false, ctrlKey: false }),
    });
    installPolicy(true);
    loadChain();
    require('../src/screenshot.js');

    window.dispatchEvent(
      Object.assign(new CustomEvent('youtube-plus-settings-updated'), {
        changedKeys: ['styles.themeVariant'],
      })
    );

    expect(window.YouTubePlusScreenshot.getSettings().shortcut.key).toBe('S');
  });

  test('without the blob the legacy key stays authoritative and no blob is created', () => {
    localStorage.setItem(
      LEGACY,
      JSON.stringify({ shortcut: { key: 'y', shiftKey: false, altKey: true, ctrlKey: false } })
    );
    const { store } = installGm();
    installPolicy(false);

    loadChain();
    require('../src/screenshot.js');

    expect(store.has(BLOB)).toBe(false);
    const settings = window.YouTubePlusScreenshot.getSettings();
    expect(settings.shortcut.key).toBe('Y');
    expect(settings.shortcut.altKey).toBe(true);

    settings.shortcut.key = 'Z';
    window.YouTubePlusScreenshot.saveSettings();
    expect(store.has(BLOB)).toBe(false);
    expect(JSON.parse(localStorage.getItem(LEGACY)).shortcut.key).toBe('Z');
  });
});
