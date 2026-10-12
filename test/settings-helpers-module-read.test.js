/**
 * @jest-environment jsdom
 *
 * The settings window reads module-owned values as the modules themselves do.
 * The ad blocker and PiP enable switches live in the main settings (`settings`
 * passed to the builders); their own preferences (the PiP shortcut) live in
 * `modules.<name>` once the module has written the blob, and fall back to the
 * legacy key until then.
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

const t = (/** @type {string} */ k) => k;

/** Load the real store and the modal helpers on top of it. */
function loadHelpers() {
  jest.resetModules();
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/settings-helpers.js');
  return window.YouTubePlusSettingsHelpers;
}

/** @param {string} html @param {string} sel */
function mount(html, sel) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return /** @type {HTMLInputElement} */ (root.querySelector(sel));
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  delete window.YouTubePlusSettingsHelpers;
  delete window.YouTubePlusSettingsStore;
  delete window.YouTubePlusHostPolicy;
});

afterEach(() => {
  delete globalThis.GM_getValue;
  delete globalThis.GM_setValue;
  delete globalThis.GM_addValueChangeListener;
  delete window.YouTubePlusHostPolicy;
  localStorage.clear();
});

describe('enable switches come from the main settings', () => {
  test('the ad blocker switch reflects settings.enableAdBlocker', () => {
    const H = loadHelpers();
    const box = mount(
      H.createBasicSettingsSection({ enableAdBlocker: false }, t),
      '#yp-setting-enableAdBlocker'
    );
    expect(box.checked).toBe(false);
  });

  test('the PiP switch reflects settings.enablePip and posts the right key', () => {
    const H = loadHelpers();
    const html = H.createAdvancedSettingsSection({ enablePip: false }, t);
    expect(mount(html, '#pip-enable-checkbox').checked).toBe(false);
    expect(html).toContain('data-setting="enablePip"');
    expect(html).not.toContain('data-setting="enablePiP"');
  });

  test('a stale enablePiP key in stored settings is ignored', () => {
    localStorage.setItem('youtube_plus_settings', JSON.stringify({ enablePiP: false }));
    const H = loadHelpers();
    // The switch follows the passed settings, and the old key is not registered.
    expect(window.YouTubePlusSettingsStore.hasKey('enablePiP')).toBe(false);
    const box = mount(
      H.createAdvancedSettingsSection({ enablePip: true }, t),
      '#pip-enable-checkbox'
    );
    expect(box.checked).toBe(true);
  });
});

describe('shortcuts come from modules.<name>, falling back to the legacy key', () => {
  test('a module that has written the blob wins', () => {
    installGm({
      [BLOB]: blobOf({
        pip: { shortcut: { key: 'I', shiftKey: false, altKey: true, ctrlKey: false } },
      }),
    });
    installPolicy(true);
    const H = loadHelpers();
    expect(mount(H.createAdvancedSettingsSection({}, t), '#pip-key').value).toBe('I');
  });

  test('an empty module namespace falls back to the legacy key', () => {
    localStorage.setItem(
      'youtube_pip_settings',
      JSON.stringify({ shortcut: { key: 'J', shiftKey: false, altKey: false, ctrlKey: false } })
    );
    installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);
    const H = loadHelpers();
    expect(mount(H.createAdvancedSettingsSection({}, t), '#pip-key').value).toBe('J');
  });

  test('timecode and screenshot shortcuts come from their legacy keys without the blob', () => {
    localStorage.setItem(
      'youtube_timecode_settings',
      JSON.stringify({ shortcut: { key: 'Y', shiftKey: false, altKey: false, ctrlKey: true } })
    );
    localStorage.setItem(
      'youtube_screenshot_settings',
      JSON.stringify({ shortcut: { key: 'G', shiftKey: true, altKey: false, ctrlKey: false } })
    );
    installGm();
    installPolicy(false);
    const H = loadHelpers();

    expect(mount(H.createAdvancedSettingsSection({}, t), '#timecode-key').value).toBe('Y');
    expect(
      mount(H.buildScreenshotSettingsHTML({ enableScreenshot: true }, t), '#screenshot-key').value
    ).toBe('G');
  });
});
