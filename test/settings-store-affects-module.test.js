/**
 * @jest-environment jsdom
 *
 * The store's shared changed-key router for module listeners. A single
 * `affectsModule(event, name, alsoKeys)` decides whether a settings-updated
 * event concerns one module, replacing the per-module copies.
 *
 * Contracts under test:
 *   - An event without a changed-key list affects every module.
 *   - A bare `modules`, the exact `modules.<name>` namespace and any
 *     `modules.<name>.<key>` path match.
 *   - A sibling sharing the prefix (`modules.<name>Extra`) does not match.
 *   - `alsoKeys` matches module-owned keys that still live outside the
 *     namespace.
 */

const BLOB = 'ytp_settings_v3';

/** @param {Record<string, string>} [initial] */
function installGm(initial) {
  const store = new Map(Object.entries(initial || {}));
  globalThis.GM_getValue = (key, def) => (store.has(key) ? store.get(key) : def);
  globalThis.GM_setValue = (key, value) => {
    store.set(key, value);
  };
  globalThis.GM_addValueChangeListener = () => 1;
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

/** @param {string[] | undefined} changedKeys */
const event = changedKeys => (changedKeys ? { changedKeys } : {});

describe('settings store affectsModule', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusSettingsStore;
    delete window.YouTubePlusHostPolicy;
    localStorage.clear();
  });

  afterEach(() => {
    delete globalThis.GM_getValue;
    delete globalThis.GM_setValue;
    delete globalThis.GM_addValueChangeListener;
    localStorage.clear();
  });

  test('an event without changed keys affects every module', () => {
    installGm({ [BLOB]: JSON.stringify({ version: 3, main: {}, modules: {} }) });
    installPolicy(true);
    const S = loadStore();

    expect(S.affectsModule(undefined, 'timecode')).toBe(true);
    expect(S.affectsModule(null, 'timecode')).toBe(true);
    expect(S.affectsModule({}, 'timecode')).toBe(true);
    expect(S.affectsModule({ changedKeys: 'modules.timecode' }, 'timecode')).toBe(true);
  });

  test('a bare modules change or the module namespace matches', () => {
    installGm({ [BLOB]: JSON.stringify({ version: 3, main: {}, modules: {} }) });
    installPolicy(true);
    const S = loadStore();

    expect(S.affectsModule(event(['modules']), 'timecode')).toBe(true);
    expect(S.affectsModule(event(['modules.timecode']), 'timecode')).toBe(true);
    expect(S.affectsModule(event(['modules.timecode.autoDetect']), 'timecode')).toBe(true);
  });

  test('a bare modules list only matches a wholesale reset', () => {
    installGm({ [BLOB]: JSON.stringify({ version: 3, main: {}, modules: {} }) });
    installPolicy(true);
    const S = loadStore();

    // A reset carries bare `modules` among the reset keys with no module paths.
    expect(S.affectsModule(event(['enableStyles', 'modules']), 'timecode')).toBe(true);
    // A single-module write also carries bare `modules`, but the module paths
    // decide ownership, so an uninvolved module stays out.
    expect(S.affectsModule(event(['modules', 'modules.music.hoverStyles']), 'timecode')).toBe(
      false
    );
    expect(S.affectsModule(event(['modules', 'modules.music.hoverStyles']), 'music')).toBe(true);
  });

  test('a sibling name sharing the prefix does not match', () => {
    installGm({ [BLOB]: JSON.stringify({ version: 3, main: {}, modules: {} }) });
    installPolicy(true);
    const S = loadStore();

    expect(S.affectsModule(event(['modules.timecodeX']), 'timecode')).toBe(false);
    expect(S.affectsModule(event(['modules.music.hoverStyles']), 'timecode')).toBe(false);
    expect(S.affectsModule(event(['styles.themeVariant']), 'timecode')).toBe(false);
  });

  test('another module namespace in the list matches that module only', () => {
    installGm({ [BLOB]: JSON.stringify({ version: 3, main: {}, modules: {} }) });
    installPolicy(true);
    const S = loadStore();

    expect(S.affectsModule(event(['modules.music.hoverStyles']), 'music')).toBe(true);
    expect(S.affectsModule(event(['modules.music']), 'music')).toBe(true);
    expect(S.affectsModule(event(['modules.pip.shortcut']), 'music')).toBe(false);
  });

  test('alsoKeys match module-owned settings outside the namespace', () => {
    installGm({ [BLOB]: JSON.stringify({ version: 3, main: {}, modules: {} }) });
    installPolicy(true);
    const S = loadStore();

    expect(
      S.affectsModule(event(['enableRememberManualQuality']), 'enhanced', [
        'enableRememberManualQuality',
      ])
    ).toBe(true);
    expect(S.affectsModule(event(['music']), 'music', ['music'])).toBe(true);
    expect(S.affectsModule(event(['music']), 'pip', [])).toBe(false);
  });

  test('non-string entries are ignored', () => {
    installGm({ [BLOB]: JSON.stringify({ version: 3, main: {}, modules: {} }) });
    installPolicy(true);
    const S = loadStore();

    expect(S.affectsModule({ changedKeys: [null, 7, 'modules.pip.enabled'] }, 'pip')).toBe(true);
    expect(S.affectsModule({ changedKeys: [null, 7] }, 'pip')).toBe(false);
  });
});
