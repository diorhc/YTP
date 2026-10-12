/**
 * Shared settings blob backed by GM storage. The real store module runs
 * against a Map-backed GM stub and an explicit host policy; jsdom pins
 * location.hostname, so the host is supplied through window.YouTubePlusHostPolicy.
 *
 * Contracts under test:
 *   - Only the owning host (www) seeds `ytp_settings_v3` from its localStorage;
 *     other subdomains keep their own localStorage until a blob appears.
 *   - Once the blob exists it is authoritative over the localStorage mirror on
 *     every host, and a remote change is applied as a diff.
 *   - Reading the blob refreshes the localStorage theme cache for document-start.
 *   - A failed GM write fails closed; a manager without GM storage falls back
 *     to localStorage.
 *   - reset() writes the default blob and clears the mirror.
 * @jest-environment jsdom
 */

const BLOB = 'ytp_settings_v3';
const MAIN = 'youtube_plus_settings';
const THEME = 'ytp-theme-preference';

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

/** @param {Record<string, unknown>} main */
function blobOf(main) {
  return JSON.stringify({ version: 3, main });
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

describe('shared settings blob on the owning host', () => {
  test('seeds the blob from localStorage and keeps the mirror', () => {
    localStorage.setItem(MAIN, JSON.stringify({ enableScreenshot: false }));
    const { store } = installGm();
    installPolicy(true);

    const S = loadStore();

    expect(S.get('enableScreenshot')).toBe(false);
    const env = blobEnvelope(store);
    expect(env.version).toBe(3);
    expect(env.main.enableScreenshot).toBe(false);
    // The localStorage copy survives the migration for the grace period.
    expect(localStorage.getItem(MAIN)).toBeTruthy();
  });

  test('the GM blob is authoritative over a stale localStorage mirror', () => {
    localStorage.setItem(MAIN, JSON.stringify({ enableScreenshot: false }));
    installGm({ [BLOB]: blobOf({ enableScreenshot: true, enablePlayAll: false }) });
    installPolicy(true);

    const S = loadStore();

    expect(S.get('enableScreenshot')).toBe(true);
    expect(S.get('enablePlayAll')).toBe(false);
  });

  test('a save writes the blob and mirrors it to localStorage', () => {
    const { store } = installGm({ [BLOB]: blobOf({ enableZoom: true }) });
    installPolicy(true);
    const S = loadStore();

    expect(S.set('enableZoom', false)).toBe(true);

    expect(blobEnvelope(store).main.enableZoom).toBe(false);
    expect(JSON.parse(localStorage.getItem(MAIN)).enableZoom).toBe(false);
  });

  test('a failed GM write keeps the previous snapshot', () => {
    installGm({ [BLOB]: blobOf({ enableScreenshot: true }) });
    installPolicy(true);
    const S = loadStore();
    expect(S.get('enableScreenshot')).toBe(true);

    globalThis.GM_setValue = () => {
      throw new Error('quota');
    };

    expect(S.set('enableScreenshot', false)).toBe(false);
    expect(S.get('enableScreenshot')).toBe(true);
  });

  test('reading the blob refreshes the theme cache for document-start', () => {
    installGm({ [BLOB]: blobOf({ styles: { themePreference: 'dark' } }) });
    installPolicy(true);

    loadStore();

    expect(localStorage.getItem(THEME)).toBe('dark');
  });

  test('reset writes the default blob and clears the localStorage mirror', () => {
    const { store } = installGm({
      [BLOB]: blobOf({ enableScreenshot: false, enablePlayAll: false }),
    });
    installPolicy(true);
    const S = loadStore();
    expect(S.get('enableScreenshot')).toBe(false);

    S.reset();

    const env = blobEnvelope(store);
    expect(env.main.enableScreenshot).toBe(true);
    expect(env.main.enablePlayAll).toBe(true);
    expect(localStorage.getItem(MAIN)).toBeNull();
    expect(S.get('enableZoom')).toBe(true);
  });
});

describe('shared settings blob on a non-owning host', () => {
  test('keeps localStorage and does not create the blob', () => {
    localStorage.setItem(MAIN, JSON.stringify({ enableScreenshot: false, enableZoom: false }));
    const { store } = installGm();
    installPolicy(false);

    const S = loadStore();

    expect(store.has(BLOB)).toBe(false);
    expect(S.get('enableScreenshot')).toBe(false);
    expect(S.get('enableZoom')).toBe(false);

    // A save must not seed the shared blob from this host either.
    expect(S.set('enableZoom', true)).toBe(true);
    expect(store.has(BLOB)).toBe(false);
    expect(S.get('enableZoom')).toBe(true);
  });
});

describe('shared settings blob cross-context sync', () => {
  test('a non-owning host adopts the blob once another host creates it', () => {
    localStorage.setItem(MAIN, JSON.stringify({ enableScreenshot: false }));
    const { store, listeners } = installGm();
    installPolicy(false);
    const S = loadStore();
    expect(store.has(BLOB)).toBe(false);
    expect(S.get('enableScreenshot')).toBe(false);

    // Another context (www) creates the blob; the change reaches this host.
    const envelope = blobOf({ enableScreenshot: true, enablePlayAll: false });
    store.set(BLOB, envelope);
    listeners[0].cb(BLOB, null, envelope, true);

    expect(S.get('enableScreenshot')).toBe(true);
    expect(S.get('enablePlayAll')).toBe(false);
    // The adopter never wrote back over the blob.
    expect(store.get(BLOB)).toBe(envelope);
  });

  test('a remote change notifies the changed keys through one event', () => {
    const { store, listeners } = installGm({
      [BLOB]: blobOf({ enablePlayAll: true, enableZoom: true }),
    });
    installPolicy(true);
    const S = loadStore();
    /** @type {CustomEvent[]} */
    const events = [];
    window.addEventListener('youtube-plus-settings-updated', e =>
      events.push(/** @type {CustomEvent} */ (e))
    );

    const envelope = blobOf({ enablePlayAll: false, enableZoom: true });
    store.set(BLOB, envelope);
    listeners[0].cb(BLOB, null, envelope, true);

    expect(events).toHaveLength(1);
    expect(events[0].changedKeys).toEqual(['enablePlayAll']);
    expect(S.get('enablePlayAll')).toBe(false);
  });

  test('the blob listener ignores the value this context just wrote', () => {
    const { store, listeners } = installGm({ [BLOB]: blobOf({ enablePlayAll: true }) });
    installPolicy(true);
    const S = loadStore();
    expect(S.set('enablePlayAll', false)).toBe(true);

    const written = store.get(BLOB);
    let events = 0;
    window.addEventListener('youtube-plus-settings-updated', () => events++);

    listeners[0].cb(BLOB, null, written, true);

    expect(events).toBe(0);
  });
});

describe('shared settings blob without GM storage', () => {
  test('falls back to localStorage and never throws', () => {
    localStorage.setItem(MAIN, JSON.stringify({ enableScreenshot: false }));
    installPolicy(true);

    const S = loadStore();

    expect(S.get('enableScreenshot')).toBe(false);
    expect(localStorage.getItem(BLOB)).toBeNull();
  });
});
