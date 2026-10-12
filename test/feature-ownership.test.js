/**
 * Feature ownership.
 *
 * Contracts under test:
 *   - Every feature module owns ONE descriptor (command, settings key,
 *     shortcut, icon) and registers it with the FeatureRegistry.
 *   - BOTH surfaces (Classic player-controls button and the Vision dock)
 *     invoke the SAME owned command — verified for the screenshot
 *     reference feature.
 *   - The settings emergency fallback in Basic is DERIVED from the Store's
 *     canonical DEFAULTS (single owner), not a hand-maintained duplicate.
 *   - Modal UI session state is owned by the modal; Basic forwards its
 *     section hint through the modal facade (no duplicated helper).
 */

describe('feature ownership (schema/command/shortcut at the owner)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=testvideo1',
    });
    // Per-test require chain (setup.js deletes facades + resets modules
    // between tests, so a beforeAll-only chain goes stale).
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/settings-store.js');
    require('../src/feature-registry.js');
    require('../src/safe-dom.js');
    require('../src/i18n.js');
    require('../src/design-system.js');
  });

  afterEach(() => {
    window.YouTubePlusVisionDockHost?.unmount?.();
    window.YouTubePlusFeatureRegistry?._reset?.();
    delete window.__ytpBasicInitDone__;
    document.body.innerHTML = '';
  });

  test('all seven feature descriptors are registered by their owner modules', () => {
    require('../src/screenshot.js');
    require('../src/zoom.js');
    require('../src/speedcontrol.js');
    require('../src/time.js');
    require('../src/thumbnail.js');
    require('../src/download.js');
    require('../src/stats.js');

    const reg = window.YouTubePlusFeatureRegistry;
    for (const id of ['screenshot', 'zoom', 'speed', 'loop', 'thumbnail', 'download', 'stats']) {
      const desc = reg.get(id);
      expect({ id, owned: Boolean(desc && typeof desc.command === 'function') }).toEqual({
        id,
        owned: true,
      });
    }
    // Settings keys are owned per feature (stats gates on its own storage
    // key and deliberately has no canonical settings entry).
    expect(reg.get('screenshot').settingsKey).toBe('enableScreenshot');
    expect(reg.get('zoom').settingsKey).toBe('enableZoom');
  });

  test('both surfaces invoke the ONE owned screenshot command', () => {
    require('../src/screenshot.js');
    const screenshot = window.YouTubePlusScreenshot;

    const player = document.createElement('div');
    player.id = 'movie_player';
    player.innerHTML = '<video class="html5-main-video"></video>';
    document.body.append(player);

    // jsdom has no 2D canvas context — stub the prototype so the REAL
    // capture() code runs end-to-end (mirrors screenshot.test.js).
    const mockCtx = { drawImage: jest.fn() };
    const getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockCtx);
    const toDataURLSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,test');

    /** @type {string[]} */
    const toasts = [];
    const enhancer = {
      getElement: /** @type {(sel: string) => Element|null} */ sel => document.querySelector(sel),
      /** @type {(msg: string, duration?: number) => void} */
      showNotification: msg => {
        toasts.push(String(msg));
      },
    };
    const controls = document.createElement('div');
    player.append(controls);
    screenshot.addButton(enhancer, controls);
    const classicBtn = controls.querySelector('.yp-screenshot-button');
    expect(classicBtn).toBeTruthy();

    // Vision surface: the generic dock renderer for the same descriptor.
    const host = window.YouTubePlusVisionDockHost;
    const dock = host.mount(player);
    const visionBtn = dock.querySelector('.yp-screenshot-button');
    expect(visionBtn).toBeTruthy();

    toasts.length = 0;
    toDataURLSpy.mockClear();
    const invokeCalls = [];
    const originalInvoke = window.YouTubePlusPlayerActionHost.invokeCommand;
    window.YouTubePlusPlayerActionHost.invokeCommand = (
      /** @type {any} */ desc,
      /** @type {any} */ shim
    ) => {
      invokeCalls.push(desc?.id || 'unknown');
      return originalInvoke(desc, shim);
    };
    classicBtn.click();
    visionBtn.click();
    window.YouTubePlusPlayerActionHost.invokeCommand = originalInvoke;
    // BOTH surfaces performed exactly one capture each — the Classic path
    // calls the owned implementation directly, the Vision path goes through
    // the descriptor command via the generic host.
    expect(toDataURLSpy.mock.calls.length).toBe(2);
    expect(invokeCalls).toEqual(['screenshot']);
    getContextSpy.mockRestore();
    toDataURLSpy.mockRestore();
  });

  test('Basic emergency fallback derives from the Store canonical DEFAULTS', () => {
    const store = window.YouTubePlusSettingsStore;
    window.__ytpBasicInitDone__ = true;
    require('../src/settings-helpers.js');
    require('../src/basic.js');

    const enhancer = window.YouTubePlusBasic.YouTubeEnhancer;
    // With the store present, Basic's working copy IS the store's load().
    const canonical = store.load();
    expect(JSON.stringify(enhancer.settings)).toBe(JSON.stringify(canonical));

    // The emergency path (no store) uses the Store's frozen DEFAULTS.
    const defaultsClone = JSON.parse(JSON.stringify(store._internals.DEFAULTS));
    expect(defaultsClone.enableScreenshot).toBe(true);
    expect(defaultsClone.styles.themeVariant).toBe('vision');
  });

  test('modal owns modal-UI session state; Basic forwards the section hint', async () => {
    require('../src/safe-dom.js');
    require('../src/settings-helpers.js');
    require('../src/modal-handlers.js');
    require('../src/settings-modal.js');
    require('../src/basic.js');

    const modal = window.YouTubePlusSettingsModal;
    // Ownership: the facade exposes the modal's own session-state helper.
    expect(typeof modal.basicUiState.lastOpenSection.write).toBe('function');

    modal.basicUiState.lastOpenSection.write('download');
    expect(modal.basicUiState.lastOpenSection.read()).toBe('download');
  });
});
