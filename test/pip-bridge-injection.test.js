/**
 * PiP page-bridge injection through GM_addElement. The nonce fallback is gone,
 * so a failing GM_addElement must be reported as a failed install instead of
 * throwing. Real CleanupManager, utils and pip module.
 * @jest-environment jsdom
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/design-system.js');
  require('../src/pip.js');
}

const hooks = () => window.YouTubePlusPip?.testHooks;

describe('PiP page-bridge injection', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.__ytplusFirefoxPipBridgeInstalled;
    delete window.__ytplusFirefoxPipKeydownBridge;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=abc',
    });
  });

  afterEach(() => {
    delete globalThis.GM_addElement;
  });

  test('a throwing GM_addElement is swallowed and the install reports failure', () => {
    globalThis.GM_addElement = () => {
      throw new Error('GM unavailable');
    };
    loadChain();

    expect(hooks().ensureFirefoxPagePipBridge()).toBe(false);
  });
});
