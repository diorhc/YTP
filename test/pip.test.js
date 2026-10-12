/**
 * @jest-environment jsdom
 *
 * Tests exercise the real pip.js module behavior. Where possible the
 * assertions observe real state (settings, localStorage, bridge scripts). Some
 * helper-only tests still mirror the module's own parsing rules because PiP
 * itself is not exported as a single global object.
 */

// Mirrors the utils.js test-hook gate: the mock YouTubeUtils objects below
// stand in for the real surface, so they carry the same gated exposure.
const exposeTestHooks = (facade, hooks) => {
  if (window.__YTP_TEST_HOOKS__ === true) facade.testHooks = hooks;
};

/** Point the lifecycle gate at a watch page and arm the harness facades. */
const installLifecycleHarness = () => {
  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    href: 'https://www.youtube.com/watch?v=test',
  });
  window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  delete window.YouTubePlusFeatureRegistry;
  Object.defineProperty(window, 'YouTubePlusSettingsStore', {
    configurable: true,
    writable: true,
    value: { get: jest.fn(), subscribe: jest.fn(() => jest.fn()) },
  });
};

/** Give a partial utils stand-in the route mapping the gate reads. */
const addRouteStub = standIn => {
  standIn.getRoute = jest.fn(() => {
    const p = window.location.pathname || '/';
    if (p === '/watch') return 'watch';
    if (p.startsWith('/shorts')) return 'shorts';
    return 'other';
  });
};

/** The ctx-based wiring reads window.YouTubePlusCleanupManager. */
const exposeCMOnWindow = () => {
  Object.defineProperty(window, 'YouTubePlusCleanupManager', {
    configurable: true,
    writable: true,
    value: window.YouTubeUtils.cleanupManager,
  });
  delete window.YouTubePlusFeatureRegistry;
  require('../src/feature-registry.js');
};

describe('PiP Module', () => {
  /** The CM instance carrying the base beforeEach boot; bodies may swap it. */
  let baseCM = null;
  beforeEach(() => {
    jest.resetModules();
    window._ytplusCreateHTML = s => s;
    // The real CleanupManager: the ctx wiring needs real registrations and
    // real releases (the cleanup-detach test disposes them).
    require('../src/cleanup-manager.js');
    baseCM = window.YouTubePlusCleanupManager;
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        exposeTestHooks,
        getPageWindow: () => window,
        t: jest.fn(key => key || ''),
        $: jest.fn(sel => document.querySelector(sel)),
        loadFeatureEnabled: jest.fn(() => true),
        helpers: {
          logger: null,
          $: (selector, root) => (root || document).querySelector(selector),
          byId: id => document.getElementById(id),
          setTimeout_: (fn, ms) => setTimeout(fn, ms),
        },
        cleanupManager: window.YouTubePlusCleanupManager,
        SETTINGS_KEY: 'youtube_plus_settings',
      },
    });
    addRouteStub(window.YouTubeUtils);
    installLifecycleHarness();
    exposeCMOnWindow();
    require('../src/pip.js');
  });

  afterEach(() => {
    window.YouTubePlusPip?.cleanup?.();
    // Sweep every CM the file has booted against: bodies that require a fresh
    // cleanup-manager swap the window facade, leaving the base boot's DOM
    // listeners orphaned. Without both sweeps they leak into the next test.
    for (const cm of new Set([baseCM, window.YouTubePlusCleanupManager])) {
      if (cm?.listeners instanceof Map) {
        for (const key of [...cm.listeners.keys()]) cm.unregisterListener?.(key);
      }
    }
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  });

  test('exports canonical window.YouTubePlusPip facade', () => {
    expect(window.YouTubePlusPip).toBeDefined();
    expect(typeof window.YouTubePlusPip.cleanup).toBe('function');
    expect(typeof window.YouTubePlusPip.testHooks.init).toBe('function');
    expect(typeof window.YouTubePlusPip.testHooks.keyToCode).toBe('function');
    expect(typeof window.YouTubePlusPip.testHooks.getSettings).toBe('function');
    expect(typeof window.YouTubePlusPip.testHooks.isFeatureEnabled).toBe('function');
  });

  test('loads persisted PiP settings from storage at runtime start', () => {
    jest.resetModules();
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        exposeTestHooks,
        getPageWindow: () => window,
        t: jest.fn(key => key || ''),
        $: jest.fn(sel => document.querySelector(sel)),
        loadFeatureEnabled: jest.fn(() => true),
        storage: {
          getItem: jest.fn(key =>
            key === 'youtube_pip_settings'
              ? JSON.stringify({
                  enabled: false,
                  shortcut: { key: 'I', shiftKey: false, altKey: true, ctrlKey: false },
                })
              : null
          ),
          setItem: jest.fn(),
        },
        cleanupManager: {
          registerListener: jest.fn(),
          registerTimeout: jest.fn(id => id),
          registerObserver: jest.fn(),
          registerInterval: jest.fn(id => id),
          registerAnimationFrame: jest.fn(id => id),
          cleanup: jest.fn(),
        },
        SETTINGS_KEY: 'youtube_plus_settings',
      },
    });
    addRouteStub(window.YouTubeUtils);
    installLifecycleHarness();
    exposeCMOnWindow();
    require('../src/pip.js');

    const loaded = window.YouTubePlusPip.testHooks.getSettings();
    expect(loaded.shortcut.key).toBe('I');
    expect(loaded.shortcut.altKey).toBe(true);
  });

  test('the module leaves the enable checkbox to the settings modal', async () => {
    jest.resetModules();
    const setItem = jest.fn();
    let onAdvancedActivated = null;
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        exposeTestHooks,
        getPageWindow: () => window,
        t: jest.fn(key => key || ''),
        $: jest.fn(sel => document.querySelector(sel)),
        loadFeatureEnabled: jest.fn(() => true),
        helpers: {
          logger: null,
          $: (selector, root) => (root || document).querySelector(selector),
          byId: id => document.getElementById(id),
          setTimeout_: (fn, ms) => setTimeout(fn, ms),
        },
        StyleManager: { add: jest.fn(), remove: jest.fn() },
        storage: { getItem: jest.fn(() => null), setItem },
        onSectionActive: jest.fn((_section, callback) => {
          onAdvancedActivated = callback;
        }),
        cleanupManager: {
          registerListener: jest.fn(),
          registerTimeout: jest.fn(id => id),
          registerObserver: jest.fn(),
          registerInterval: jest.fn(id => id),
          registerAnimationFrame: jest.fn(id => id),
          cleanup: jest.fn(),
        },
        SETTINGS_KEY: 'youtube_plus_settings',
      },
    });
    // The real CleanupManager on the window facade: honest registrations and
    // releases for the ctx wiring (and for the afterEach sweep).
    delete window.YouTubePlusCleanupManager;
    require('../src/cleanup-manager.js');
    addRouteStub(window.YouTubeUtils);
    installLifecycleHarness();

    document.body.innerHTML =
      '<div class="yp-settings-section" data-section="advanced">' +
      '<div class="pip-settings-item"></div>' +
      '</div>' +
      '<input id="pip-enable-checkbox" type="checkbox">';
    require('../src/pip.js');

    // The settings modal activation wires the PiP section handlers (deferred).
    expect(onAdvancedActivated).toBeInstanceOf(Function);
    onAdvancedActivated();
    await new Promise(resolve => setTimeout(resolve, 50));
    const styleManager = /** @type {any} */ (window.YouTubeUtils).StyleManager;
    expect(styleManager.add).toHaveBeenCalledWith('pip-styles', '');

    const checkbox = document.getElementById('pip-enable-checkbox');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    // The module does not own the enable checkbox: the settings modal persists
    // `enablePip` in the main settings, so no legacy write happens here.
    expect(setItem).not.toHaveBeenCalled();
    expect(window.YouTubePlusPip.testHooks.isFeatureEnabled()).toBe(true);
  });

  test('storage event re-reads persisted PiP settings (cross-tab sync)', () => {
    jest.resetModules();
    let stored = null;
    // The real CleanupManager: honest registrations and releases.
    require('../src/cleanup-manager.js');
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        exposeTestHooks,
        getPageWindow: () => window,
        t: jest.fn(key => key || ''),
        $: jest.fn(sel => document.querySelector(sel)),
        loadFeatureEnabled: jest.fn(() => true),
        helpers: {
          logger: null,
          $: (selector, root) => (root || document).querySelector(selector),
          byId: id => document.getElementById(id),
          setTimeout_: (fn, ms) => setTimeout(fn, ms),
        },
        storage: { getItem: jest.fn(() => stored), setItem: jest.fn() },
        cleanupManager: window.YouTubePlusCleanupManager,
        SETTINGS_KEY: 'youtube_plus_settings',
      },
    });
    addRouteStub(window.YouTubeUtils);
    installLifecycleHarness();
    exposeCMOnWindow();
    require('../src/pip.js');

    expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.key).toBe('P');

    // Another tab persisted a new shortcut; the storage event must re-load.
    stored = JSON.stringify({
      shortcut: { key: 'K', shiftKey: false, altKey: false, ctrlKey: false },
    });
    window.dispatchEvent(new StorageEvent('storage', { key: 'youtube_pip_settings' }));
    expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.key).toBe('K');
  });

  test('cleanup detaches the hotkey handler', async () => {
    const video = document.createElement('video');
    video.requestPictureInPicture = jest.fn(() => Promise.resolve());
    document.body.appendChild(video);

    const api = window.YouTubePlusPip;
    const cm = window.YouTubePlusCleanupManager;
    const beforeKeys = cm.listeners.size;
    api.cleanup();
    const afterKeys = cm.listeners.size;

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'p',
        code: 'KeyP',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    // The runtime-scope dispatch detaches every pip listener, and the raw
    // keydown must not reach a detached hotkey handler afterwards.
    expect(afterKeys).toBeLessThan(beforeKeys);
    expect(video.requestPictureInPicture).not.toHaveBeenCalled();
  });

  test('real keyToCode normalizes symbols and characters', () => {
    expect(window.YouTubePlusPip.testHooks.keyToCode('P')).toBe('KeyP');
    expect(window.YouTubePlusPip.testHooks.keyToCode('5')).toBe('Digit5');
    expect(window.YouTubePlusPip.testHooks.keyToCode(']')).toBe('BracketRight');
    expect(window.YouTubePlusPip.testHooks.keyToCode('[')).toBe('BracketLeft');
    expect(window.YouTubePlusPip.testHooks.keyToCode('-')).toBe('Minus');
    expect(window.YouTubePlusPip.testHooks.keyToCode('+')).toBe('Equal');
    expect(window.YouTubePlusPip.testHooks.keyToCode('')).toBe('');
  });

  test('keyboard shortcut toggles Picture-in-Picture on the player video', async () => {
    const video = document.createElement('video');
    video.requestPictureInPicture = jest.fn().mockResolvedValue(undefined);
    document.body.appendChild(video);

    // The real user path: the P shortcut fires PiP via the keydown handler.
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'p',
        code: 'KeyP',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    // Flush the async toggle chain (keydown → runtime → requestPictureInPicture).
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(video.requestPictureInPicture).toHaveBeenCalled();
  });

  test('a stored PiP session flag resumes PiP on the next pointer interaction after load', async () => {
    const video = document.createElement('video');
    video.requestPictureInPicture = jest.fn().mockResolvedValue(undefined);
    document.body.appendChild(video);

    try {
      sessionStorage.setItem('youtube_plus_pip_session', 'true');

      // The resume attempt waits for the next user gesture after load.
      window.dispatchEvent(new Event('load'));
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(video.requestPictureInPicture).toHaveBeenCalled();
    } finally {
      sessionStorage.removeItem('youtube_plus_pip_session');
      window.YouTubePlusPip?.cleanup?.();
    }
  });
});

describe('PiP Module — bridge script injection', () => {
  /** @type {jest.Mock} */
  let gmAddElement;
  const originalUserAgent = window.navigator.userAgent;
  let originalPostMessage;
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    delete window.__ytplusFirefoxPipBridgeInstalled;
    delete window.__ytplusFirefoxPipKeydownBridge;
    delete window.__ytplusPipPageHandled;

    originalPostMessage = window.postMessage;
    window.postMessage = (message, _targetOrigin) => {
      setTimeout(() => {
        const evt = new MessageEvent('message', {
          data: message,
          source: window,
          origin: window.location.origin || 'https://www.youtube.com',
        });
        window.dispatchEvent(evt);
      }, 0);
    };

    gmAddElement = jest.fn();
    Object.defineProperty(globalThis, 'GM_addElement', {
      configurable: true,
      writable: true,
      value: gmAddElement,
    });

    try {
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        get: () =>
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      });
    } catch (_e) {
      jest
        .spyOn(window.navigator, 'userAgent', 'get')
        .mockReturnValue('Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0');
    }

    global.mockLocation({
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=dQw4w9WgXcQ',
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        exposeTestHooks,
        getPageWindow: () => window,
        createWithErrorBoundary: _name => fn => fn,
        logSuppressed: jest.fn(),
        helpers: {
          logger: null,
          $: (selector, root) => (root || document).querySelector(selector),
          byId: id => document.getElementById(id),
          setTimeout_: (fn, ms) => setTimeout(fn, ms),
        },
        StyleManager: { add: jest.fn(), remove: jest.fn() },
        cleanupManager: {
          registerListener: jest.fn((target, type, handler, opts) => {
            if (target && typeof target.addEventListener === 'function') {
              target.addEventListener(type, handler, opts);
            }
          }),
        },
        whenRelevant: jest.fn(({ onEnter }) => {
          if (onEnter) onEnter();
          return { check: jest.fn(), dispose: jest.fn() };
        }),
        onSectionActive: jest.fn(() => ({ dispose: jest.fn() })),
      },
    });
    addRouteStub(window.YouTubeUtils);
    installLifecycleHarness();
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: window.YouTubeUtils.cleanupManager,
    });
    delete window.YouTubePlusFeatureRegistry;
    require('../src/feature-registry.js');
  });

  afterEach(() => {
    if (originalPostMessage) {
      window.postMessage = originalPostMessage;
    }
    delete window.__ytplusFirefoxPipBridgeInstalled;
    delete window.__ytplusFirefoxPipKeydownBridge;
    delete window.__ytplusPipPageHandled;
    delete globalThis.GM_addElement;
    try {
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: originalUserAgent,
      });
    } catch (_e) {
      /* ignore */
    }
  });

  test('injected bridge scripts are syntactically valid JS', () => {
    require('../src/pip.js');

    const event = new KeyboardEvent('keydown', {
      key: 'P',
      code: 'KeyP',
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    const scripts = gmAddElement.mock.calls
      .map(call => call[1])
      .filter(opts => opts && typeof opts.textContent === 'string')
      .map(opts => /** @type {string} */ (opts.textContent));

    expect(scripts.length).toBeGreaterThanOrEqual(2);
    const joined = scripts.join('\n');
    expect(joined).toContain('__ytplusFirefoxPipKeydownBridge');
    expect(joined).toContain('__ytplusFirefoxPipBridgeInstalled');

    for (const script of scripts) {
      // Real syntax-validity check: new Function() compiles the script body;
      // if it returns a function object, the injected bridge script is
      // syntactically valid and safe to evaluate. Replacing a bare
      // not.toThrow() with an observable result assertion.
      expect(typeof new Function(script)).toBe('function');
    }
  });

  test('without a random source the bridge is not installed', () => {
    const getRandomValues = window.crypto.getRandomValues;
    Object.defineProperty(window.crypto, 'getRandomValues', {
      configurable: true,
      value: undefined,
    });
    try {
      require('../src/pip.js');
      expect(window.YouTubePlusPip.testHooks.getBridgeToken()).toBe('');
      expect(window.YouTubePlusPip.testHooks.ensureFirefoxPagePipBridge()).toBe(false);
      const injected = gmAddElement.mock.calls.some(call =>
        call[1]?.textContent?.includes('__ytplusFirefoxPipBridgeInstalled')
      );
      expect(injected).toBe(false);
    } finally {
      Object.defineProperty(window.crypto, 'getRandomValues', {
        configurable: true,
        value: getRandomValues,
      });
    }
  });

  test('request with the right token toggles PiP and gets a response', async () => {
    require('../src/pip.js');

    window.YouTubePlusPip.testHooks.ensureFirefoxPagePipBridge();

    const scriptCall = gmAddElement.mock.calls.find(call =>
      call[1]?.textContent?.includes('__ytplusFirefoxPipBridgeInstalled')
    );
    expect(scriptCall).toBeDefined();
    const bridgeCode = scriptCall[1].textContent;

    new Function(bridgeCode)();

    const video = document.createElement('video');
    video.className = 'html5-main-video';
    video.requestPictureInPicture = jest.fn().mockResolvedValue(undefined);
    document.body.appendChild(video);

    const token = window.YouTubePlusPip.testHooks.getBridgeToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/);

    /** @type {any[]} */
    const responses = [];
    const onMessage = (/** @type {MessageEvent} */ evt) => {
      if (evt.data?.type === 'yp-pip-response') {
        responses.push(evt.data);
      }
    };
    window.addEventListener('message', onMessage);

    window.postMessage({ type: 'yp-pip-request', id: 'valid-req-1', token }, '*');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(video.requestPictureInPicture).toHaveBeenCalled();
    expect(responses).toHaveLength(1);
    expect(responses[0]).toEqual({
      type: 'yp-pip-response',
      id: 'valid-req-1',
      success: true,
    });
    expect(responses[0].token).toBeUndefined();

    window.removeEventListener('message', onMessage);
  });

  test('request without a token, or with a wrong one, does nothing and gets no response', async () => {
    require('../src/pip.js');

    window.YouTubePlusPip.testHooks.ensureFirefoxPagePipBridge();

    const scriptCall = gmAddElement.mock.calls.find(call =>
      call[1]?.textContent?.includes('__ytplusFirefoxPipBridgeInstalled')
    );
    expect(scriptCall).toBeDefined();
    const bridgeCode = scriptCall[1].textContent;

    new Function(bridgeCode)();

    const video = document.createElement('video');
    video.className = 'html5-main-video';
    video.requestPictureInPicture = jest.fn().mockResolvedValue(undefined);
    document.body.appendChild(video);

    /** @type {any[]} */
    const responses = [];
    const onMessage = (/** @type {MessageEvent} */ evt) => {
      if (evt.data?.type === 'yp-pip-response') {
        responses.push(evt.data);
      }
    };
    window.addEventListener('message', onMessage);

    // 1. Request without token
    window.postMessage({ type: 'yp-pip-request', id: 'no-token-req' }, '*');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    expect(responses).toHaveLength(0);

    // 2. Request with wrong token
    window.postMessage(
      { type: 'yp-pip-request', id: 'wrong-token-req', token: 'invalid_token_1234' },
      '*'
    );
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    expect(responses).toHaveLength(0);

    window.removeEventListener('message', onMessage);
  });

  test('a failing GM_addElement keeps the bridges uninstalled and requests unsupported', async () => {
    gmAddElement.mockImplementation(() => {
      throw new Error('GM blocked');
    });
    require('../src/pip.js');
    const api = window.YouTubePlusPip;

    // The GM run fails, the nonce run finds no page nonce here, and both
    // bridges stay uninstalled through the runtime start and the direct call.
    expect(api.testHooks.ensureFirefoxPagePipBridge()).toBe(false);
    await expect(api.testHooks.requestFirefoxPiPViaBridge()).resolves.toBe(false);
    expect(gmAddElement.mock.calls.length).toBeGreaterThan(0);
    expect(window.__ytplusFirefoxPipBridgeInstalled).toBeUndefined();

    // The route leave runs the stop: the bridge removal goes through the same
    // failing GM path and leaves the page globals untouched.
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/@channel/videos',
      href: 'https://www.youtube.com/@channel/videos',
    });
    window.dispatchEvent(new Event('yp-history-navigate'));
    expect(
      gmAddElement.mock.calls.some(call =>
        String(call[1]?.textContent).includes("window.removeEventListener('keydown'")
      )
    ).toBe(true);
  });
});
