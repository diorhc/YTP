/**
 * @jest-environment jsdom
 *
 * Branch coverage for src/pip.js: every test drives the real module through
 * window.YouTubePlusPip / its testHooks and asserts observable results
 * (PiP requests made, controls clicked, storage/session state, wiring).
 * The harness mirrors test/pip.test.js: real CleanupManager, real
 * FeatureLifecycle, stand-in YouTubeUtils.
 */

const exposeTestHooks = (facade, hooks) => {
  if (window.__YTP_TEST_HOOKS__ === true) facade.testHooks = hooks;
};

const FIREFOX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SESSION_KEY = 'youtube_plus_pip_session';

describe('PiP branch coverage', () => {
  /** @type {any} */
  let baseCM = null;
  /** @type {any} */
  let logger = null;
  /** @type {any} */
  let utils = null;
  /** @type {any} */
  let storage = null;
  /** @type {jest.Mock} */
  let gmAddElement = null;
  /** Manual clock so the 250ms hotkey debounce can be crossed. */
  let clock = 1000;
  let clockSpy = null;

  /**
   * Boot the real module with the given stand-ins.
   * @param {{
   *   ua?: string,
   *   pageWindow?: () => any,
   *   storageValue?: string|null,
   *   storageWrite?: (key: string, value: string) => void,
   *   dollar?: (sel: string) => any,
   *   gm?: 'function'|'null-return'|'throw'|'absent',
   *   trustedTypes?: any,
   *   safeDom?: any,
   *   onSectionActive?: boolean,
   * }} [opts]
   */
  const boot = opts => {
    const o = opts || {};
    jest.resetModules();
    clock = 1000;
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    for (const key of [
      '__ytplusFirefoxPipBridgeInstalled',
      '__ytplusFirefoxPipKeydownBridge',
      '__ytplusPipShortcut',
      '__ytplusPipPageHandled',
      '__ytplusFirefoxPipKeydownHandler',
      '__ytplusFirefoxPipBridgeMessageHandler',
      'YouTubeSafeDOM',
      'YouTubeTrustedTypes',
      'YouTubeSettingsHelpers',
      'YouTubePlusSettingsHelpers',
      'YouTubePlusDesignSystem',
    ]) {
      delete window[key];
    }

    require('../src/cleanup-manager.js');
    baseCM = window.YouTubePlusCleanupManager;

    logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    storage = {
      getItem: jest.fn(() => (o.storageValue === undefined ? null : o.storageValue)),
      setItem: jest.fn((key, value) => {
        if (o.storageWrite) o.storageWrite(key, value);
      }),
    };
    const dollar = o.dollar || (sel => document.querySelector(sel));
    utils = {
      exposeTestHooks,
      getPageWindow: o.pageWindow || (() => window),
      t: jest.fn(key => key || ''),
      $: jest.fn(dollar),
      renderTemplateClone: jest.fn((el, html) => {
        el.innerHTML = html;
      }),
      loadFeatureEnabled: jest.fn(() => true),
      logSuppressed: jest.fn(),
      helpers: {
        logger,
        $: (selector, root) => (root || document).querySelector(selector),
        byId: id => document.getElementById(id),
        setTimeout_: (fn, ms) => setTimeout(fn, ms),
      },
      storage,
      StyleManager: { add: jest.fn(), remove: jest.fn() },
      cleanupManager: baseCM,
      getRoute: jest.fn(() => {
        const p = window.location.pathname || '/';
        if (p === '/watch') return 'watch';
        if (p.startsWith('/shorts')) return 'shorts';
        return 'other';
      }),
      SETTINGS_KEY: 'youtube_plus_settings',
    };
    if (o.onSectionActive !== false) {
      utils.onSectionActive = jest.fn(() => ({ dispose: jest.fn() }));
    }
    if (o.dollar) {
      utils.helpers.$ = (selector, root) =>
        o.dollar(selector, root) ?? (root || document).querySelector(selector);
    }

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: utils,
    });
    if (o.trustedTypes) {
      Object.defineProperty(window, 'YouTubeTrustedTypes', {
        configurable: true,
        writable: true,
        value: o.trustedTypes,
      });
    }
    if (o.safeDom) {
      Object.defineProperty(window, 'YouTubeSafeDOM', {
        configurable: true,
        writable: true,
        value: o.safeDom,
      });
    }

    gmAddElement = jest.fn(() => document.createElement('script'));
    if (o.gm === 'absent') {
      delete globalThis.GM_addElement;
    } else {
      if (o.gm === 'throw') {
        gmAddElement.mockImplementation(() => {
          throw new Error('GM unavailable');
        });
      }
      if (o.gm === 'null-return') gmAddElement.mockImplementation(() => null);
      Object.defineProperty(globalThis, 'GM_addElement', {
        configurable: true,
        writable: true,
        value: gmAddElement,
      });
    }

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => o.ua || CHROME_UA,
    });
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=abc',
    });

    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: baseCM,
    });
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: { get: jest.fn(() => undefined), subscribe: jest.fn(() => jest.fn()) },
    });
    delete window.YouTubePlusFeatureRegistry;
    require('../src/feature-registry.js');
    require('../src/pip.js');
  };

  afterEach(() => {
    window.YouTubePlusPip?.cleanup?.();
    for (const cm of new Set([baseCM, window.YouTubePlusCleanupManager])) {
      if (cm?.listeners instanceof Map) {
        for (const key of [...cm.listeners.keys()]) cm.unregisterListener?.(key);
      }
    }
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    clockSpy?.mockRestore?.();
    clockSpy = null;
    delete globalThis.GM_addElement;
  });

  /** Freeze Date.now() and return a stepper for the debounce windows. */
  const freezeClock = () => {
    clockSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    return ms => {
      clock += ms;
    };
  };

  /** @param {Partial<KeyboardEventInit>} [init] */
  const pressKey = (init = {}) => {
    const ev = new KeyboardEvent('keydown', {
      key: 'P',
      code: 'KeyP',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    document.dispatchEvent(ev);
    return ev;
  };

  const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

  /** A real <video> wired for PiP. @param {{noRequest?: boolean}} [opts] */
  const addVideo = (opts = {}) => {
    const video = document.createElement('video');
    video.className = 'html5-main-video';
    video.requestPictureInPicture = jest.fn().mockResolvedValue(/** @type {any} */ (video));
    document.body.appendChild(video);
    if (opts.noRequest) delete video.requestPictureInPicture;
    return video;
  };

  /** A native PiP control inside the player chrome. */
  const addNativeButton = (attrs = {}) => {
    const btn = document.createElement('button');
    btn.className = 'yp-pip-button';
    for (const [k, v] of Object.entries(attrs)) btn.setAttribute(k, v);
    btn.click = jest.fn();
    const controls = document.createElement('div');
    controls.className = 'ytp-right-controls';
    controls.appendChild(btn);
    document.body.appendChild(controls);
    return btn;
  };

  const settingsMarkup = () => {
    document.body.innerHTML =
      '<div class="yp-settings-section" data-section="advanced">' +
      '<div class="pip-settings-item">' +
      '<button class="yp-submenu-toggle" data-submenu="pip"></button>' +
      '<div class="pip-submenu" data-submenu="pip"></div>' +
      '</div></div>' +
      '<input id="pip-enable-checkbox" type="checkbox">' +
      '<select id="pip-modifier-combo"><option value="ctrl+shift">ctrl+shift</option></select>' +
      '<div id="pip-modifier-dropdown"></div>' +
      '<input id="pip-key" type="text">';
  };

  describe('keyToCode', () => {
    test('passes named keys through and maps every symbol family', () => {
      boot();
      const { keyToCode } = window.YouTubePlusPip.testHooks;
      expect(keyToCode('ArrowUp')).toBe('ARROWUP');
      expect(keyToCode('F5')).toBe('F5');
      expect(keyToCode('  ')).toBe('');
      expect(keyToCode('`')).toBe('Backquote');
      expect(keyToCode('~')).toBe('Backquote');
      expect(keyToCode('-')).toBe('Minus');
      expect(keyToCode('_')).toBe('Minus');
      expect(keyToCode('+')).toBe('Equal');
      expect(keyToCode('=')).toBe('Equal');
      expect(keyToCode('[')).toBe('BracketLeft');
      expect(keyToCode('}')).toBe('BracketRight');
      expect(keyToCode('\\')).toBe('Backslash');
      expect(keyToCode('|')).toBe('Backslash');
      expect(keyToCode(';')).toBe('Semicolon');
      expect(keyToCode(':')).toBe('Semicolon');
      expect(keyToCode("'")).toBe('Quote');
      expect(keyToCode('"')).toBe('Quote');
      expect(keyToCode(',')).toBe('Comma');
      expect(keyToCode('<')).toBe('Comma');
      expect(keyToCode('.')).toBe('Period');
      expect(keyToCode('>')).toBe('Period');
      expect(keyToCode('/')).toBe('Slash');
      expect(keyToCode('?')).toBe('Slash');
      expect(keyToCode('7')).toBe('Digit7');
    });
  });

  describe('page-script injection paths', () => {
    test('without GM_addElement the bridge cannot install', () => {
      boot({ gm: 'absent' });
      expect(window.YouTubePlusPip.testHooks.ensureFirefoxPagePipBridge()).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'PiP',
        'Firefox PiP bridge could not be installed (CSP). Using button fallback.'
      );
    });

    test('GM_addElement returning null still reports the bridge run as successful', () => {
      boot({ gm: 'null-return', ua: FIREFOX_UA });
      expect(window.YouTubePlusPip.testHooks.ensureFirefoxPagePipBridge()).toBe(true);
      expect(gmAddElement).toHaveBeenCalled();
    });

    test('without a page window the bridge is treated as already available', () => {
      boot({ gm: 'absent', pageWindow: () => null });
      expect(window.YouTubePlusPip.testHooks.ensureFirefoxPagePipBridge()).toBe(true);
      expect(gmAddElement).not.toHaveBeenCalled();
    });

    test('the bridge token is generated once and reused', () => {
      boot();
      const { getBridgeToken } = window.YouTubePlusPip.testHooks;
      const first = getBridgeToken();
      expect(first).toMatch(/^[a-f0-9]{32}$/);
      expect(getBridgeToken()).toBe(first);
    });

    test('the route stop removes the page-realm bridge handlers', () => {
      boot({ ua: FIREFOX_UA });
      window.YouTubePlusPip.testHooks.ensureFirefoxPagePipBridge();
      for (const marker of [
        '__ytplusFirefoxPipKeydownBridge',
        '__ytplusFirefoxPipBridgeInstalled',
      ]) {
        const call = gmAddElement.mock.calls.find(c => c[1]?.textContent?.includes(marker));
        expect(call).toBeDefined();
        new Function(call[1].textContent)();
      }
      expect(typeof window.__ytplusFirefoxPipKeydownHandler).toBe('function');
      expect(typeof window.__ytplusFirefoxPipBridgeMessageHandler).toBe('function');

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/feed/subscriptions',
        href: 'https://www.youtube.com/feed/subscriptions',
      });
      window.dispatchEvent(new Event('yp-history-navigate'));

      const removal = gmAddElement.mock.calls.find(c =>
        c[1]?.textContent?.includes("window.removeEventListener('keydown'")
      );
      expect(removal).toBeDefined();
      new Function(removal[1].textContent)();
      expect(window.__ytplusFirefoxPipKeydownHandler).toBeUndefined();
      expect(window.__ytplusFirefoxPipBridgeMessageHandler).toBeUndefined();
      expect(window.__ytplusFirefoxPipBridgeInstalled).toBeUndefined();
    });

    test('bridge requests from a foreign origin, bad id or wrong token are ignored', async () => {
      boot({ ua: FIREFOX_UA });
      const api = window.YouTubePlusPip;
      api.testHooks.ensureFirefoxPagePipBridge();
      const call = gmAddElement.mock.calls.find(c =>
        c[1]?.textContent?.includes('__ytplusFirefoxPipBridgeInstalled')
      );
      new Function(call[1].textContent)();
      const video = addVideo();
      const responses = [];
      const onMessage = evt => {
        if (evt.data?.type === 'yp-pip-response') responses.push(evt.data);
      };
      window.addEventListener('message', onMessage);

      const post = (data, origin) =>
        window.dispatchEvent(new MessageEvent('message', { data, origin, source: window }));
      const token = api.testHooks.getBridgeToken();
      // Foreign origin.
      post({ type: 'yp-pip-request', id: 'foreign', token }, 'https://evil.example');
      // Over-long request id.
      post({ type: 'yp-pip-request', id: 'x'.repeat(81), token }, window.location.origin);
      // Non-string id.
      post({ type: 'yp-pip-request', id: 42, token }, window.location.origin);
      // Wrong token.
      post({ type: 'yp-pip-request', id: 'wrong-token', token: 'nope' }, window.location.origin);
      // Wrong message type.
      post({ type: 'something-else', id: 'wrong-type', token }, window.location.origin);
      await tick(30);

      expect(responses).toHaveLength(0);
      expect(video.requestPictureInPicture).not.toHaveBeenCalled();
      window.removeEventListener('message', onMessage);
    });

    test('the bridge reports failure when neither a video nor a control can enter PiP', async () => {
      boot({ ua: FIREFOX_UA });
      const api = window.YouTubePlusPip;
      api.testHooks.ensureFirefoxPagePipBridge();
      const call = gmAddElement.mock.calls.find(c =>
        c[1]?.textContent?.includes('__ytplusFirefoxPipBridgeInstalled')
      );
      new Function(call[1].textContent)();
      const responses = [];
      const onMessage = evt => {
        if (evt.data?.type === 'yp-pip-response') responses.push(evt.data);
      };
      window.addEventListener('message', onMessage);

      // No video and no native control: the bridge answers success:false.
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: { type: 'yp-pip-request', id: 'no-video', token: api.testHooks.getBridgeToken() },
          origin: window.location.origin,
        })
      );
      await tick(40);
      expect(responses).toEqual([{ type: 'yp-pip-response', id: 'no-video', success: false }]);
      window.removeEventListener('message', onMessage);
    });

    test('a bridge video without PiP support falls back to clicking the control', async () => {
      boot({ ua: FIREFOX_UA });
      const api = window.YouTubePlusPip;
      api.testHooks.ensureFirefoxPagePipBridge();
      const call = gmAddElement.mock.calls.find(c =>
        c[1]?.textContent?.includes('__ytplusFirefoxPipBridgeInstalled')
      );
      new Function(call[1].textContent)();
      const video = document.createElement('video');
      video.className = 'html5-main-video';
      document.body.appendChild(video);
      const btn = addNativeButton();
      const responses = [];
      const onMessage = evt => {
        if (evt.data?.type === 'yp-pip-response') responses.push(evt.data);
      };
      window.addEventListener('message', onMessage);

      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            type: 'yp-pip-request',
            id: 'click-fallback',
            token: api.testHooks.getBridgeToken(),
          },
          origin: window.location.origin,
        })
      );
      await tick(40);
      expect(btn.click).toHaveBeenCalled();
      expect(responses[0].success).toBe(true);
      window.removeEventListener('message', onMessage);
    });

    test('requestFirefoxPiPViaBridge gives up after the response timeout', async () => {
      jest.useFakeTimers();
      try {
        boot({ ua: FIREFOX_UA });
        const pending = window.YouTubePlusPip.testHooks.requestFirefoxPiPViaBridge();
        jest.advanceTimersByTime(1300);
        await expect(pending).resolves.toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    test('the bridge response listener ignores foreign messages and settles once', async () => {
      boot({ ua: FIREFOX_UA });
      const api = window.YouTubePlusPip;
      // jsdom delivers postMessage events with a foreign `source` object and an
      // empty origin, so the real bridge only sees self-originated messages when
      // the shim replays them as MessageEvents from this window.
      const originalPostMessage = window.postMessage;
      window.postMessage = message => {
        setTimeout(() => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: message,
              source: window,
              origin: window.location.origin,
            })
          );
        }, 0);
      };
      try {
        api.testHooks.ensureFirefoxPagePipBridge();
        const call = gmAddElement.mock.calls.find(c =>
          c[1]?.textContent?.includes('__ytplusFirefoxPipBridgeInstalled')
        );
        new Function(call[1].textContent)();
        addVideo();

        const settled = [];
        const pending = api.testHooks
          .requestFirefoxPiPViaBridge()
          .then(value => settled.push(value));

        // Messages that are not this request's response must not settle it.
        const send = (data, origin) =>
          window.dispatchEvent(new MessageEvent('message', { data, origin, source: window }));
        const origin = window.location.origin;
        send({ type: 'yp-pip-response', id: 'other-request', success: false }, origin);
        send({ type: 'unrelated-type', id: 'x', success: false }, origin);
        send({ type: 'yp-pip-response', id: 'x', success: false }, 'https://evil.example');
        expect(settled).toHaveLength(0);

        await pending;
        expect(settled).toEqual([true]);
      } finally {
        window.postMessage = originalPostMessage;
      }
    });
  });

  describe('video element lookup', () => {
    test('a cached video is reused while connected and re-queried once detached', async () => {
      boot();
      const step = freezeClock();
      const first = addVideo();
      pressKey();
      await tick();
      expect(first.requestPictureInPicture).toHaveBeenCalledTimes(1);

      step(500);
      pressKey();
      await tick();
      expect(first.requestPictureInPicture).toHaveBeenCalledTimes(2);

      first.remove();
      const second = addVideo();
      step(500);
      pressKey();
      await tick();
      expect(second.requestPictureInPicture).toHaveBeenCalled();
    });

    test('an expired cache entry re-queries the DOM', async () => {
      boot();
      const step = freezeClock();
      const first = addVideo();
      pressKey();
      await tick();
      first.remove();
      const second = addVideo();
      step(3000);
      pressKey();
      await tick();
      expect(second.requestPictureInPicture).toHaveBeenCalled();
    });

    test('a WeakRef failure still resolves the video element', async () => {
      const RealWeakRef = global.WeakRef;
      // @ts-expect-error deliberate test double
      global.WeakRef = class {
        constructor() {
          throw new Error('WeakRef unavailable');
        }
      };
      try {
        boot();
        const video = addVideo();
        pressKey();
        await tick();
        expect(video.requestPictureInPicture).toHaveBeenCalled();
        expect(utils.logSuppressed).toHaveBeenCalled();
      } finally {
        global.WeakRef = RealWeakRef;
      }
    });

    test('a page-window failure is logged and the native control is clicked', async () => {
      boot({
        pageWindow: () => {
          throw new Error('sandbox died');
        },
      });
      const btn = addNativeButton();
      pressKey();
      await tick();
      expect(logger.error).toHaveBeenCalledWith(
        'PiP',
        'Error getting video element',
        expect.any(Error)
      );
      expect(btn.click).toHaveBeenCalled();
    });

    test('a non-video candidate is rejected by the tag-name guard', async () => {
      boot({
        pageWindow: () => ({ document: { querySelector: () => document.createElement('div') } }),
      });
      const btn = addNativeButton();
      pressKey();
      await tick();
      expect(btn.click).toHaveBeenCalled();
    });
  });

  describe('requestPictureInPicture fallbacks', () => {
    test('the page-realm video handle is used when the sandbox has none', async () => {
      const pageVideo = document.createElement('video');
      pageVideo.requestPictureInPicture = jest
        .fn()
        .mockResolvedValue(/** @type {any} */ (pageVideo));
      boot({ pageWindow: () => ({ document: { querySelector: () => pageVideo } }) });
      addVideo({ noRequest: true });
      pressKey();
      await tick();
      expect(pageVideo.requestPictureInPicture).toHaveBeenCalled();
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('true');
    });

    test('the page-realm prototype method is used when the instance has none', async () => {
      const pageVideo = document.createElement('video');
      const protoMethod = jest.fn().mockResolvedValue(undefined);
      boot({
        pageWindow: () => ({
          document: { querySelector: () => pageVideo },
          HTMLVideoElement: { prototype: { requestPictureInPicture: protoMethod } },
        }),
      });
      addVideo({ noRequest: true });
      pressKey();
      await tick();
      expect(protoMethod).toHaveBeenCalled();
    });

    test('#movie_player.togglePictureInPicture is the last API fallback', async () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      const toggle = jest.fn();
      player.togglePictureInPicture = toggle;
      document.body.appendChild(player);
      boot({
        pageWindow: () => ({
          document: { getElementById: () => player, querySelector: () => null },
        }),
      });
      addVideo({ noRequest: true });
      pressKey();
      await tick();
      expect(toggle).toHaveBeenCalled();
    });

    test('#movie_player.requestPictureInPicture is used when toggle is absent', async () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      const request = jest.fn();
      player.requestPictureInPicture = request;
      document.body.appendChild(player);
      boot({
        pageWindow: () => ({
          document: { getElementById: () => player, querySelector: () => null },
        }),
      });
      addVideo({ noRequest: true });
      pressKey();
      await tick();
      expect(request).toHaveBeenCalled();
    });

    test('a failed request waits for metadata and then clicks the native control', async () => {
      boot({ pageWindow: () => ({ document: { querySelector: () => null } }) });
      const video = addVideo({ noRequest: true });
      Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
      const btn = addNativeButton();

      pressKey();
      await tick();
      expect(btn.click).not.toHaveBeenCalled();
      video.dispatchEvent(new Event('loadedmetadata'));
      await tick();
      expect(btn.click).toHaveBeenCalled();
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('true');
    });

    test('the metadata wait gives up on its own timeout', async () => {
      boot({ pageWindow: () => ({ document: { querySelector: () => null } }) });
      const video = addVideo({ noRequest: true });
      Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
      const btn = addNativeButton();

      pressKey();
      await tick(800);
      expect(btn.click).toHaveBeenCalled();
    });

    test('two failed requests without any control report the failure', async () => {
      boot({ pageWindow: () => ({ document: { querySelector: () => null } }) });
      const video = addVideo({ noRequest: true });
      Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
      pressKey();
      await tick();
      expect(logger.error).toHaveBeenCalledWith(
        'PiP',
        'Failed to toggle Picture-in-Picture',
        expect.any(Error)
      );
    });

    test('an already-active PiP session exits instead of requesting', async () => {
      boot();
      const video = addVideo();
      Object.defineProperty(document, 'pictureInPictureElement', {
        configurable: true,
        value: video,
      });
      const exit = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, 'exitPictureInPicture', {
        configurable: true,
        writable: true,
        value: exit,
      });
      sessionStorage.setItem(SESSION_KEY, 'true');

      pressKey();
      await tick();
      expect(exit).toHaveBeenCalled();
      expect(video.requestPictureInPicture).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
      delete document.pictureInPictureElement;
      delete document.exitPictureInPicture;
    });

    test('a second video exits the other PiP element before requesting', async () => {
      boot();
      const video = addVideo();
      const other = document.createElement('video');
      document.body.appendChild(other);
      Object.defineProperty(document, 'pictureInPictureElement', {
        configurable: true,
        value: other,
      });
      const exit = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, 'exitPictureInPicture', {
        configurable: true,
        writable: true,
        value: exit,
      });

      pressKey();
      await tick();
      expect(exit).toHaveBeenCalled();
      expect(video.requestPictureInPicture).toHaveBeenCalled();
      delete document.pictureInPictureElement;
      delete document.exitPictureInPicture;
    });

    test('disablePictureInPicture is lifted for the request and restored after', async () => {
      boot();
      const video = addVideo();
      video.disablePictureInPicture = true;
      let seenWhileRequesting = null;
      video.requestPictureInPicture = jest.fn(() => {
        seenWhileRequesting = video.disablePictureInPicture;
        return Promise.resolve(/** @type {any} */ (video));
      });

      pressKey();
      await tick();
      expect(seenWhileRequesting).toBe(false);
      expect(video.disablePictureInPicture).toBe(true);
    });

    test('a throwing disablePictureInPicture setter does not break the toggle', async () => {
      boot();
      const video = addVideo();
      Object.defineProperty(video, 'disablePictureInPicture', {
        configurable: true,
        get: () => true,
        set: () => {
          throw new Error('read-only');
        },
      });

      pressKey();
      await tick();
      expect(video.requestPictureInPicture).toHaveBeenCalled();
      expect(utils.logSuppressed).toHaveBeenCalled();
    });

    test('the Firefox video[__pip] attribute identifies the active session', async () => {
      boot({ ua: FIREFOX_UA });
      const pipVideo = document.createElement('video');
      pipVideo.setAttribute('__pip', '');
      document.body.appendChild(pipVideo);
      const exit = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, 'exitPictureInPicture', {
        configurable: true,
        writable: true,
        value: exit,
      });

      pressKey();
      await tick();
      expect(exit).toHaveBeenCalled();
      delete document.exitPictureInPicture;
    });

    test('a Firefox PiP lookup failure is swallowed', async () => {
      boot({
        ua: FIREFOX_UA,
        pageWindow: () => ({
          document: {
            querySelector: () => {
              throw new Error('detached document');
            },
          },
        }),
      });
      addVideo();
      pressKey();
      await tick();
      expect(utils.logSuppressed).toHaveBeenCalled();
    });
  });

  describe('native control fallback', () => {
    test('a disabled control is skipped and the aria-keyshortcuts one is clicked', async () => {
      boot({ pageWindow: () => ({ document: { querySelector: () => null } }) });
      const disabled = document.createElement('button');
      disabled.className = 'yp-pip-button';
      disabled.setAttribute('aria-disabled', 'true');
      document.body.appendChild(disabled);
      const fallback = document.createElement('button');
      fallback.className = 'yp-pip-button';
      fallback.setAttribute('aria-keyshortcuts', 'i');
      fallback.click = jest.fn();
      const controls = document.createElement('div');
      controls.className = 'ytp-right-controls';
      controls.appendChild(fallback);
      document.body.appendChild(controls);
      const video = addVideo({ noRequest: true });
      Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });

      pressKey();
      await tick();
      expect(fallback.click).toHaveBeenCalled();
    });

    test('a disabled attribute disqualifies the only control', async () => {
      boot({ pageWindow: () => ({ document: { querySelector: () => null } }) });
      const disabled = document.createElement('button');
      disabled.className = 'yp-pip-button';
      disabled.setAttribute('disabled', '');
      const controls = document.createElement('div');
      controls.className = 'ytp-right-controls';
      controls.appendChild(disabled);
      document.body.appendChild(controls);
      const video = addVideo({ noRequest: true });
      Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });

      pressKey();
      await tick();
      expect(logger.error).toHaveBeenCalled();
    });

    test('the player chrome is probed with hover events before clicking', async () => {
      boot();
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 300 });
      document.body.appendChild(player);
      const seen = [];
      player.addEventListener('mousemove', ev => seen.push(ev.type));
      player.addEventListener('mouseover', ev => seen.push(ev.type));
      player.addEventListener('mouseenter', ev => seen.push(ev.type));
      const btn = addNativeButton();
      const video = addVideo({ noRequest: true });
      Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });

      pressKey();
      await tick();
      expect(seen).toEqual(['mousemove', 'mouseover', 'mouseenter']);
      expect(btn.click).toHaveBeenCalled();
    });

    test('a hover dispatch against a foreign view is swallowed', async () => {
      boot({ pageWindow: () => ({}) });
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10 });
      document.body.appendChild(player);
      const btn = addNativeButton();
      const video = addVideo({ noRequest: true });
      Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });

      pressKey();
      await tick();
      expect(utils.logSuppressed).toHaveBeenCalled();
      expect(btn.click).toHaveBeenCalled();
    });
  });

  describe('settings persistence', () => {
    test('malformed stored settings are reported and ignored', () => {
      boot({ storageValue: 'not json{' });
      expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.key).toBe('P');
      expect(logger.error).toHaveBeenCalledWith('PiP', 'Error loading settings', expect.any(Error));
    });

    test('a non-object payload is reported as invalid', () => {
      boot({ storageValue: '42' });
      expect(logger.warn).toHaveBeenCalledWith('PiP', 'Invalid settings format');
      expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.key).toBe('P');
    });

    test('shortcut fields of the wrong type keep their defaults', () => {
      boot({
        storageValue: JSON.stringify({
          enabled: true,
          shortcut: { key: '', shiftKey: 'yes', altKey: 1, ctrlKey: null },
        }),
      });
      expect(window.YouTubePlusPip.testHooks.getSettings().shortcut).toEqual({
        key: 'P',
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
      });
    });

    test('a storage write failure is reported and the page shortcut still syncs', async () => {
      boot({
        storageValue: JSON.stringify({ enabled: false, shortcut: { key: 'K', shiftKey: false } }),
        storageWrite: () => {
          throw new Error('quota exceeded');
        },
      });
      settingsMarkup();
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      await tick(80);
      const input = /** @type {HTMLInputElement} */ (document.getElementById('pip-key'));
      input.value = 'k';
      input.dispatchEvent(new Event('input'));

      expect(logger.error).toHaveBeenCalledWith('PiP', 'Error saving settings', expect.any(Error));
      expect(window.__ytplusPipShortcut).toEqual({
        key: 'K',
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        enabled: true,
      });
    });
  });

  describe('hotkey guards', () => {
    test('repeat, composing, meta and editable targets are ignored', async () => {
      boot();
      const video = addVideo();
      pressKey({ repeat: true });
      pressKey({ isComposing: true });
      pressKey({ metaKey: true });
      const input = document.createElement('input');
      document.body.appendChild(input);
      // A keystroke that lands in the settings text field is not a shortcut.
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'P',
          code: 'KeyP',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      document.body.appendChild(editable);
      editable.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'P',
          code: 'KeyP',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      await tick();
      expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    });

    test('a keydown without key/code and other editable targets are ignored', async () => {
      boot();
      const video = addVideo();
      // A synthetic event without KeyboardEvent fields never matches.
      document.dispatchEvent(new Event('keydown', { bubbles: true, cancelable: true }));
      // The editable-target guard also covers textarea/select and any node
      // inside a contenteditable subtree.
      for (const tag of ['textarea', 'select']) {
        const field = document.createElement(tag);
        document.body.appendChild(field);
        field.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'P',
            code: 'KeyP',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          })
        );
      }
      const host = document.createElement('div');
      host.setAttribute('contenteditable', 'true');
      const child = document.createElement('span');
      host.appendChild(child);
      document.body.appendChild(host);
      child.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'P',
          code: 'KeyP',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      await tick();
      expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    });

    test('a second press inside the debounce window only prevents the default', async () => {
      boot();
      const video = addVideo();
      pressKey();
      await tick();
      const second = pressKey();
      await tick();
      expect(video.requestPictureInPicture).toHaveBeenCalledTimes(1);
      expect(second.defaultPrevented).toBe(true);
    });

    test('a legacy enabled flag no longer gates the hotkey', async () => {
      boot({ storageValue: JSON.stringify({ enabled: false }) });
      const video = addVideo();
      pressKey();
      await tick();
      // The module only runs when the main switch is on, so its hotkey is live.
      expect(video.requestPictureInPicture).toHaveBeenCalled();
    });

    test('a symbol shortcut matches through KeyboardEvent.code', async () => {
      boot({
        storageValue: JSON.stringify({
          shortcut: { key: ']', shiftKey: true, altKey: false, ctrlKey: false },
        }),
      });
      const video = addVideo();
      pressKey({ key: 'Unidentified', code: 'BracketRight' });
      await tick();
      expect(video.requestPictureInPicture).toHaveBeenCalled();
    });

    test('a modifier mismatch does not trigger the toggle', async () => {
      boot();
      const video = addVideo();
      pressKey({ ctrlKey: true });
      await tick();
      expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    });

    test('the native Firefox combo keeps a Ctrl+Shift+BracketRight toggle', async () => {
      boot({
        ua: FIREFOX_UA,
        storageValue: JSON.stringify({
          shortcut: { key: ']', shiftKey: true, altKey: false, ctrlKey: true },
        }),
      });
      const step = freezeClock();
      const video = addVideo();
      pressKey({
        key: 'Unidentified',
        code: 'BracketRight',
        shiftKey: true,
        ctrlKey: true,
      });
      // The native combo keeps the browser default: the async bridge chain
      // resolves first and only then requests PiP on the video handle.
      await tick(1400);
      expect(video.requestPictureInPicture).toHaveBeenCalled();
      step(1000);
      pressKey({
        key: 'Unidentified',
        code: 'BracketRight',
        shiftKey: true,
        ctrlKey: true,
      });
      await tick(1400);
      expect(video.requestPictureInPicture).toHaveBeenCalledTimes(2);
    });

    test('a storage event for another key is ignored', () => {
      boot();
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated_key' }));
      window.dispatchEvent(new Event('storage'));
      expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.key).toBe('P');
    });

    test('a failing page-context listener registration is reported', () => {
      boot({
        ua: FIREFOX_UA,
        pageWindow: () => ({
          document: {
            get addEventListener() {
              throw new Error('sandbox blocks page listeners');
            },
          },
        }),
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'PiP',
        'Could not register page-context keydown listener (Firefox sandbox)'
      );
    });

    test('page document and window keydown mirrors are registered and released', () => {
      const pageListeners = [];
      const removed = [];
      const pageDocument = {
        addEventListener: (type, fn) => pageListeners.push([type, fn]),
        removeEventListener: (type, fn) => removed.push([type, fn]),
      };
      const pageWindow = {
        document: pageDocument,
        addEventListener: (type, fn) => pageListeners.push([type, fn]),
        removeEventListener: (type, fn) => removed.push([type, fn]),
      };
      boot({ pageWindow: () => pageWindow });
      expect(pageListeners.map(entry => entry[0])).toEqual(['keydown', 'keydown']);

      window.YouTubePlusPip.cleanup();
      expect(removed.map(entry => entry[0])).toEqual(['keydown', 'keydown']);
      for (const [, fn] of pageListeners) {
        expect(removed.some(entry => entry[1] === fn)).toBe(true);
      }
    });
  });

  describe('session resume and teardown', () => {
    test('the resume attempt expires and clears the stale session flag', () => {
      jest.useFakeTimers();
      try {
        boot();
        sessionStorage.setItem(SESSION_KEY, 'true');
        window.dispatchEvent(new Event('load'));
        jest.advanceTimersByTime(16000);
        expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test('a resume interaction without a video keeps the flag for a later attempt', async () => {
      boot();
      sessionStorage.setItem(SESSION_KEY, 'true');
      window.dispatchEvent(new Event('load'));
      // No <video> on the page: the resume attempt returns without toggling.
      document.dispatchEvent(new Event('keydown', { bubbles: true }));
      await tick();
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('true');
    });

    test('a second gesture after the pointer resume toggles PiP again', async () => {
      // Real behaviour: the resume listeners are registered through the
      // CleanupManager with { once: true }, which wraps each handler, so the
      // module's own removeEventListener(type, handler) cannot match the
      // wrapper and the sibling gesture listener stays armed until the 15s
      // expiry timer. Assert the observable outcome rather than the intent.
      boot();
      const video = addVideo();
      sessionStorage.setItem(SESSION_KEY, 'true');
      window.dispatchEvent(new Event('load'));
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await tick();
      expect(video.requestPictureInPicture).toHaveBeenCalledTimes(1);
      document.dispatchEvent(new Event('keydown', { bubbles: true }));
      await tick();
      expect(video.requestPictureInPicture).toHaveBeenCalledTimes(2);
    });

    test('a load event with no stored session arms nothing', async () => {
      boot();
      const video = addVideo();
      window.dispatchEvent(new Event('load'));
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await tick();
      expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    });

    test('leavepictureinpicture clears the stored session flag', () => {
      boot();
      addVideo();
      sessionStorage.setItem(SESSION_KEY, 'true');
      document.dispatchEvent(new Event('leavepictureinpicture'));
      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    });

    test('the route stop releases the runtime scope', async () => {
      boot();
      const video = addVideo();
      const before = baseCM.listeners.size;
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/@channel/videos',
        href: 'https://www.youtube.com/@channel/videos',
      });
      window.dispatchEvent(new Event('yp-history-navigate'));
      expect(baseCM.listeners.size).toBeLessThan(before);
      pressKey();
      await tick();
      expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    });
  });

  describe('settings UI wiring', () => {
    test('handlers attach once and drive the modifiers and key', async () => {
      boot();
      settingsMarkup();
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      await tick(80);
      const item = document.querySelector('.pip-settings-item');
      expect(item.dataset.handlerAttached).toBe('1');
      expect(utils.StyleManager.add).toHaveBeenCalledWith('pip-styles', '');

      const combo = /** @type {HTMLSelectElement} */ (
        document.getElementById('pip-modifier-combo')
      );
      combo.value = 'ctrl+shift';
      combo.dispatchEvent(new Event('change', { bubbles: true }));
      expect(window.YouTubePlusPip.testHooks.getSettings().shortcut).toMatchObject({
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
      });

      // The key field stops the shortcut keystrokes from bubbling out of the
      // settings modal.
      const keyInput = /** @type {HTMLInputElement} */ (document.getElementById('pip-key'));
      const bubbled = jest.fn();
      window.addEventListener('keydown', bubbled);
      keyInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      window.removeEventListener('keydown', bubbled);
      expect(bubbled).not.toHaveBeenCalled();

      // An empty value keeps the stored key untouched.
      const writesBefore = storage.setItem.mock.calls.length;
      keyInput.value = '';
      keyInput.dispatchEvent(new Event('input'));
      expect(storage.setItem.mock.calls.length).toBe(writesBefore);
      keyInput.value = 'j';
      keyInput.dispatchEvent(new Event('input'));
      expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.key).toBe('J');

      // Re-opening the section is a no-op for the handlers.
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      await tick(80);
      expect(item.dataset.handlerAttached).toBe('1');
    });

    test('the module does not touch the enable checkbox or its submenu', async () => {
      boot();
      settingsMarkup();
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      await tick(80);
      const checkbox = /** @type {HTMLInputElement} */ (
        document.getElementById('pip-enable-checkbox')
      );
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      // The settings modal's general handler owns the checkbox; the module
      // leaves the submenu toggle markup untouched.
      const toggle = document.querySelector('.yp-submenu-toggle');
      expect(toggle.hasAttribute('disabled')).toBe(false);
    });

    test('existing pip styles short-circuit the style injection', async () => {
      boot();
      settingsMarkup();
      const existing = document.createElement('style');
      existing.id = 'pip-styles';
      document.head.appendChild(existing);
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      await tick(80);
      expect(utils.StyleManager.add).not.toHaveBeenCalled();
    });

    test('the design system owns the pip artwork and the modifier dropdown', async () => {
      const initGlassDropdown = jest.fn();
      const getStyle = jest.fn(() => '.pip-styles{}');
      boot();
      window.YouTubePlusDesignSystem = {
        initGlassDropdown,
        getStyle,
        getThemeVariant: () => 'classic',
      };
      try {
        settingsMarkup();
        document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
        await tick(80);
        expect(getStyle).toHaveBeenCalledWith('pip-styles');
        expect(initGlassDropdown).toHaveBeenCalledWith({
          dropdown: document.getElementById('pip-modifier-dropdown'),
          hiddenSelect: document.getElementById('pip-modifier-combo'),
        });
      } finally {
        delete window.YouTubePlusDesignSystem;
      }
    });

    test('the advanced section activation registers a deferred attach', async () => {
      boot();
      settingsMarkup();
      expect(utils.onSectionActive).toHaveBeenCalledWith('advanced', expect.any(Function));
      const activate = utils.onSectionActive.mock.calls[0][1];
      activate();
      await tick(60);
      expect(document.querySelector('.pip-settings-item').dataset.handlerAttached).toBe('1');
    });

    test('markup without the advanced section or the item is a no-op', async () => {
      boot();
      document.body.innerHTML = '<div></div>';
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      await tick(80);
      expect(utils.StyleManager.add).not.toHaveBeenCalled();

      document.body.innerHTML = '<div class="yp-settings-section" data-section="advanced"></div>';
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      await tick(80);
      expect(utils.StyleManager.add).not.toHaveBeenCalled();
    });

    test('attaching without the enable checkbox still wires the shortcut', async () => {
      boot();
      document.body.innerHTML =
        '<div class="yp-settings-section" data-section="advanced">' +
        '<div class="pip-settings-item"></div></div>' +
        '<select id="pip-modifier-combo"><option value="ctrl">ctrl</option></select>' +
        '<input id="pip-key" type="text">';
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      await tick(80);
      expect(document.querySelector('.pip-settings-item').dataset.handlerAttached).toBe('1');
      const combo = /** @type {HTMLSelectElement} */ (
        document.getElementById('pip-modifier-combo')
      );
      combo.value = 'ctrl';
      combo.dispatchEvent(new Event('change', { bubbles: true }));
      expect(window.YouTubePlusPip.testHooks.getSettings().shortcut.ctrlKey).toBe(true);
    });

    test('the module runs without the optional settings-section hook', () => {
      boot({ onSectionActive: false });
      expect(utils.onSectionActive).toBeUndefined();
      expect(window.YouTubePlusPip).toBeDefined();
    });
  });

  describe('Firefox hotkey path', () => {
    test('an active PiP session exits without touching the controls', async () => {
      boot({ ua: FIREFOX_UA });
      const video = addVideo();
      Object.defineProperty(document, 'pictureInPictureElement', {
        configurable: true,
        value: video,
      });
      const exit = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, 'exitPictureInPicture', {
        configurable: true,
        writable: true,
        value: exit,
      });
      const btn = addNativeButton();

      const ev = pressKey();
      await tick();
      expect(exit).toHaveBeenCalled();
      expect(btn.click).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(true);
      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
      delete document.pictureInPictureElement;
      delete document.exitPictureInPicture;
    });

    test('the native control wins when the sandbox has no video handle', async () => {
      boot({ ua: FIREFOX_UA, pageWindow: () => ({ document: { querySelector: () => null } }) });
      const btn = addNativeButton();
      const ev = pressKey();
      await tick();
      expect(btn.click).toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(true);
      expect(sessionStorage.getItem(SESSION_KEY)).toBe('true');
    });

    test('without a control or page handle the key still stops browser defaults', async () => {
      boot({ ua: FIREFOX_UA, pageWindow: () => ({ document: { querySelector: () => null } }) });
      const ev = pressKey();
      await tick(30);
      expect(ev.defaultPrevented).toBe(true);
    });

    test('the Firefox hotkey clicks the native control before any async fallback', async () => {
      boot({ ua: FIREFOX_UA });
      const video = addVideo();
      const btn = addNativeButton();
      pressKey();
      await tick();
      expect(btn.click).toHaveBeenCalled();
      expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    });

    test('the delayed control retry runs when nothing handled the hotkey', async () => {
      boot({ ua: FIREFOX_UA, pageWindow: () => ({ document: { querySelector: () => null } }) });
      const btn = addNativeButton();
      pressKey();
      await tick(120);
      expect(btn.click).toHaveBeenCalled();
    });

    test('a recent page-bridge handling suppresses the userscript handler', async () => {
      boot({ ua: FIREFOX_UA });
      const step = freezeClock();
      const btn = addNativeButton();
      window.__ytplusPipPageHandled = clock;
      pressKey();
      await tick();
      expect(btn.click).not.toHaveBeenCalled();

      step(400);
      pressKey();
      await tick();
      expect(btn.click).toHaveBeenCalled();
    });

    test('an installed keydown bridge keeps the async fallback path', async () => {
      boot({ ua: FIREFOX_UA });
      window.__ytplusFirefoxPipKeydownBridge = true;
      const video = addVideo();
      delete video.requestPictureInPicture;
      const btn = addNativeButton();
      const ev = pressKey();
      await tick();
      expect(ev.defaultPrevented).toBe(true);
      expect(btn.click).toHaveBeenCalled();
    });
  });
});
