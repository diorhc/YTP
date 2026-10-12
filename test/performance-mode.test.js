/**
 * @jest-environment jsdom
 *
 * Unit tests for src/performance-mode.js — the route-scoped page-cost
 * reductions. Each part is a FeatureLifecycle feature whose `when` gates the
 * master `performanceMode` switch and its own toggle.
 */

describe('performance mode runtime', () => {
  /** @type {any[]} */
  let defs;
  /** @type {any[]} */
  let handles;
  /** @type {Array<[string, Function]>} */
  let subscriptions;
  /** @type {{ subscribeRoot: jest.Mock, unsubscribe: jest.Mock }} */
  let coordinator;
  /** @type {Record<string, unknown>} */
  let settings;

  const makeCtx = () => {
    /** @type {Array<() => void>} */
    const disposers = [];
    return {
      style: jest.fn(() => () => undefined),
      listen: jest.fn(
        (
          /** @type {EventTarget} */ target,
          /** @type {string} */ type,
          /** @type {EventListener} */ fn,
          /** @type {AddEventListenerOptions | boolean | undefined} */ opts
        ) => {
          target.addEventListener(type, fn, opts);
          return () => target.removeEventListener(type, fn, opts);
        }
      ),
      timeout: jest.fn((/** @type {() => void} */ fn) => {
        fn();
        return () => undefined;
      }),
      onDispose: jest.fn((/** @type {() => void} */ fn) => {
        disposers.push(fn);
        return () => undefined;
      }),
      runDisposers: () => {
        for (const fn of disposers) fn();
      },
    };
  };

  beforeEach(() => {
    jest.resetModules();
    settings = { performanceMode: false };

    defs = [];
    handles = [];
    Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
      configurable: true,
      writable: true,
      value: {
        FeatureLifecycle: {
          define: jest.fn((/** @type {any} */ def) => {
            defs.push(def);
            const handle = { sync: jest.fn(), isRunning: () => false, restart: jest.fn() };
            handles.push(handle);
            return handle;
          }),
        },
      },
    });

    subscriptions = [];
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: {
        get: jest.fn((/** @type {string} */ key) => settings[key]),
        set: jest.fn(),
        subscribe: jest.fn((/** @type {string} */ key, /** @type {Function} */ cb) => {
          subscriptions.push([key, cb]);
          return () => undefined;
        }),
      },
    });

    coordinator = { subscribeRoot: jest.fn(() => 'sub'), unsubscribe: jest.fn() };
    Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
      configurable: true,
      writable: true,
      value: coordinator,
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        logSuppressed: jest.fn(),
        onDomReady: jest.fn((/** @type {() => void} */ fn) => fn()),
        exposeTestHooks: jest.fn((/** @type {any} */ facade, /** @type {any} */ hooks) => {
          Object.assign(facade, hooks);
        }),
      },
    });

    document.body.innerHTML = '';
    require('../src/performance-mode.js');
  });

  test('defines one lifecycle feature per part with its own routes', () => {
    expect(defs).toHaveLength(4);
    expect(defs.map(def => def.id)).toEqual([
      'performanceMode.ambient',
      'performanceMode.hoverPreview',
      'performanceMode.contentVisibility',
      'performanceMode.lazyChat',
    ]);
    expect(defs[0].routes).toEqual(['watch']);
    expect(defs[1].routes).toEqual(['home', 'feed', 'search', 'channel', 'watch']);
    expect(defs[3].routes).toEqual(['watch']);
  });

  test('when() gates on the master switch and the part toggle', () => {
    settings.performanceMode = true;
    settings.performanceModeAmbient = true;
    expect(defs[0].when()).toBe(true);

    settings.performanceMode = false;
    expect(defs[0].when()).toBe(false);

    settings.performanceMode = true;
    settings.performanceModeAmbient = false;
    expect(defs[0].when()).toBe(false);
  });

  test('every relevant settings key re-syncs the parts', () => {
    expect(subscriptions.map(([key]) => key)).toEqual([
      'performanceMode',
      'performanceModeAmbient',
      'performanceModeHoverPreview',
      'performanceModeContentVisibility',
      'performanceModeLazyChat',
    ]);
    handles.forEach(handle => {
      expect(handle.sync).toHaveBeenCalled();
    });
  });

  test('CSS-only parts register their feature-owned style on start', () => {
    const ctx = makeCtx();
    defs[0].start(ctx);
    defs[1].start(ctx);
    defs[2].start(ctx);

    expect(ctx.style).toHaveBeenCalledWith(
      'yp-perf-ambient',
      '#cinematics,#cinematic-container{display:none!important}'
    );
    expect(ctx.style.mock.calls[1][0]).toBe('yp-perf-hover-preview');
    expect(ctx.style.mock.calls[2][0]).toBe('yp-perf-content-visibility');
  });

  test('lazy chat defers the iframe until the panel is expanded', () => {
    document.body.innerHTML =
      '<ytd-live-chat-frame><iframe id="chatframe" src="https://chat.example/x"></iframe></ytd-live-chat-frame>';
    const ctx = makeCtx();
    defs[3].start(ctx);

    const iframe = /** @type {HTMLIFrameElement} */ (document.querySelector('#chatframe'));
    const frame = /** @type {HTMLElement} */ (document.querySelector('ytd-live-chat-frame'));
    expect(iframe.getAttribute('src')).toBe('about:blank');
    expect(iframe.dataset.ypLazyChatSrc).toBe('https://chat.example/x');

    // A click while the frame is still collapsed must not restore it.
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(iframe.getAttribute('src')).toBe('about:blank');

    frame.setAttribute('expanded', '');
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(iframe.getAttribute('src')).toBe('https://chat.example/x');
    expect(iframe.dataset.ypLazyChatSrc).toBeUndefined();
    expect(coordinator.subscribeRoot).toHaveBeenCalledWith(
      'performanceMode::lazyChat',
      expect.any(Function),
      expect.objectContaining({ attributeFilter: ['src', 'expanded'] })
    );
  });

  test('an already-expanded chat frame is left untouched', () => {
    document.body.innerHTML =
      '<ytd-live-chat-frame expanded><iframe id="chatframe" src="https://chat.example/x"></iframe></ytd-live-chat-frame>';
    defs[3].start(makeCtx());
    expect(document.querySelector('#chatframe')?.getAttribute('src')).toBe(
      'https://chat.example/x'
    );
  });

  test('the lazy chat unsubscribes and restores on dispose', () => {
    document.body.innerHTML =
      '<ytd-live-chat-frame><iframe id="chatframe" src="https://chat.example/y"></iframe></ytd-live-chat-frame>';
    const ctx = makeCtx();
    defs[3].start(ctx);
    ctx.runDisposers();
    expect(document.querySelector('#chatframe')?.getAttribute('src')).toBe(
      'https://chat.example/y'
    );
    expect(coordinator.unsubscribe).toHaveBeenCalledWith('performanceMode::lazyChat');
  });

  test('exposes the test hooks surface', () => {
    const hooks = /** @type {any} */ (window.YouTubePlusPerformanceMode);
    expect(hooks.MASTER_KEY).toBe('performanceMode');
    expect(Array.isArray(hooks.PARTS)).toBe(true);
    expect(typeof hooks.masterOn).toBe('function');
    settings.performanceMode = true;
    expect(hooks.masterOn()).toBe(true);
    hooks.syncAll();
    handles.forEach(handle => {
      expect(handle.sync).toHaveBeenCalled();
    });
  });
});
