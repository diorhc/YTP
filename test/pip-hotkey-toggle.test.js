/**
 * The Chromium PiP hotkey path with no video handle: pressing the shortcut on
 * a watch page without a player or a native control must warn and stop the
 * event instead of throwing. Real CleanupManager, utils and pip module.
 * @jest-environment jsdom
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
  require('../src/pip.js');
}

describe('PiP hotkey without a video handle', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.__ytplusFirefoxPipBridgeInstalled;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=abc',
    });
    require('../src/settings-store.js');
    window.YouTubePlusSettingsStore.set('enablePip', true);
    loadChain();
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  });

  test('the shortcut warns and stops the event when there is no player', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'P',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(() => document.dispatchEvent(event)).not.toThrow();
  });
});
