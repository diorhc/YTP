/**
 * Module namespaces in the shared settings blob and the music migration onto
 * them. The real store runs against a Map-backed GM stub and an explicit host
 * policy, so the blob can be driven directly.
 *
 * Contracts under test:
 *   - `modules.<name>` is stored beside `main` in the blob, never inside it.
 *   - The module bridge never creates the blob; a module write only lands where
 *     the shared settings already exist.
 *   - Music migrates from the legacy GM key into `modules.music` once the blob
 *     exists and keeps the values; before the blob exists the legacy key stays
 *     authoritative.
 *   - A remote blob change is delivered as one event carrying the
 *     `modules.music.*` paths.
 *   - Import accepts module namespaces and rejects prototype-polluting ones.
 * @jest-environment jsdom
 */

const BLOB = 'ytp_settings_v3';
const LEGACY_MUSIC = 'youtube-plus-music-settings';

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

function loadStore() {
  require('../src/cleanup-manager.js');
  require('../src/settings-store.js');
  return window.YouTubePlusSettingsStore;
}

/** @param {Map<string, string>} store */
function blobEnvelope(store) {
  const raw = store.get(BLOB);
  return raw ? JSON.parse(raw) : null;
}

/** @param {Record<string, unknown>} modules */
function blobOf(modules) {
  return JSON.stringify({ version: 3, main: {}, modules });
}

beforeEach(() => {
  jest.resetModules();
  delete window.YouTubePlusSettingsStore;
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

describe('module namespaces in the shared blob', () => {
  test('writes the namespace beside main and reports the module paths', () => {
    const { store } = installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);
    const S = loadStore();
    /** @type {CustomEvent[]} */
    const events = [];
    window.addEventListener('youtube-plus-settings-updated', e =>
      events.push(/** @type {CustomEvent} */ (e))
    );

    expect(S.getModuleSettings('timecode')).toEqual({});
    expect(S.updateModuleSettings('timecode', { enabled: true, position: 'bottom' })).toBe(true);

    const env = blobEnvelope(store);
    expect(env.modules.timecode).toEqual({ enabled: true, position: 'bottom' });
    // The wire format keeps modules out of main.
    expect(Object.hasOwn(env.main, 'modules')).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0].changedKeys).toContain('modules.timecode.enabled');
    expect(S.getModuleSettings('timecode')).toEqual({ enabled: true, position: 'bottom' });
  });

  test('a module write never creates the blob', () => {
    const { store } = installGm();
    installPolicy(false);
    const S = loadStore();

    expect(S.updateModuleSettings('timecode', { enabled: true })).toBe(false);
    expect(store.has(BLOB)).toBe(false);
    expect(S.getModuleSettings('timecode')).toEqual({});
  });

  test('import accepts module namespaces and rejects prototype keys', () => {
    installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);
    const S = loadStore();

    expect(S.importSettings({ modules: { timecode: { enabled: true } } })).toBe(true);
    expect(S.getModuleSettings('timecode').enabled).toBe(true);

    const polluted = JSON.parse('{"modules":{"__proto__":{"polluted":true}}}');
    expect(S.importSettings(polluted)).toBe(false);
    expect(/** @type {Record<string, unknown>} */ ({}).polluted).toBeUndefined();
  });
});

describe('music migration into modules.music', () => {
  test('seeds modules.music from the legacy key once the blob exists', () => {
    const { store } = installGm({
      [LEGACY_MUSIC]: JSON.stringify({ enableMusic: true, hoverStyles: false }),
    });
    installPolicy(true);
    const S = loadStore();

    expect(S.getMusicSettings().hoverStyles).toBe(false);
    expect(blobEnvelope(store).modules.music.hoverStyles).toBe(false);

    // After the migration the legacy key is not read any more.
    store.set(LEGACY_MUSIC, JSON.stringify({ enableMusic: false, hoverStyles: true }));
    expect(S.getMusicSettings().enableMusic).toBe(true);
    expect(S.getMusicSettings().hoverStyles).toBe(false);
  });

  test('without the blob the legacy key stays authoritative', () => {
    const { store } = installGm({
      [LEGACY_MUSIC]: JSON.stringify({ enableMusic: true, hoverStyles: false }),
    });
    installPolicy(false);
    const S = loadStore();

    expect(store.has(BLOB)).toBe(false);
    expect(S.getMusicSettings().hoverStyles).toBe(false);

    expect(S.updateMusicSettings({ hoverStyles: true })).toBe(true);
    expect(store.has(BLOB)).toBe(false);
    expect(JSON.parse(store.get(LEGACY_MUSIC)).hoverStyles).toBe(true);
    expect(JSON.parse(localStorage.getItem(LEGACY_MUSIC)).hoverStyles).toBe(true);
  });

  test('a music change from another tab arrives as one event with module paths', () => {
    const { store, listeners } = installGm({
      [BLOB]: blobOf({ music: { enableMusic: true, hoverStyles: true } }),
    });
    installPolicy(true);
    const S = loadStore();
    /** @type {CustomEvent[]} */
    const events = [];
    window.addEventListener('youtube-plus-settings-updated', e =>
      events.push(/** @type {CustomEvent} */ (e))
    );

    const next = blobOf({ music: { enableMusic: true, hoverStyles: false } });
    store.set(BLOB, next);
    listeners[0].cb(BLOB, null, next, true);

    expect(events).toHaveLength(1);
    expect(events[0].changedKeys).toContain('modules.music.hoverStyles');
    expect(S.getMusicSettings().hoverStyles).toBe(false);
  });

  test('a same-tab music toggle notifies the music alias once', () => {
    const { store } = installGm({
      [BLOB]: blobOf({ music: { enableMusic: true, hoverStyles: true } }),
    });
    installPolicy(true);
    const S = loadStore();
    let notifications = 0;
    S.subscribeMusicSettings(() => notifications++);

    expect(S.updateMusicSettings({ hoverStyles: false })).toBe(true);

    expect(notifications).toBe(1);
    expect(S.getMusicSettings().hoverStyles).toBe(false);
    expect(blobEnvelope(store).modules.music.hoverStyles).toBe(false);
  });
});
