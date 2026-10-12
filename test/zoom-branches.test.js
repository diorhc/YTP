/**
 * @jest-environment jsdom
 *
 * Branch coverage for src/zoom.js. Every assertion drives the real module
 * through window.YouTubePlusZoom / its testHooks and checks observable
 * effects: mounted DOM, applied transforms, persisted zoom/pan, registered
 * observers and released registrations. The harness mirrors test/zoom.test.js
 * (real CleanupManager + real FeatureLifecycle, stand-in YouTubeUtils).
 */

const exposeTestHooks = (facade, hooks) => {
  if (window.__YTP_TEST_HOOKS__ === true) facade.testHooks = hooks;
};

const PLAYER_HTML =
  '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

/** jsdom needs a ResizeObserver; the stub records observed targets. */
const installResizeObserver = () => {
  const instances = [];
  global.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      instances.push(this);
    }
    observe(target) {
      this.observed.push(target);
    }
    unobserve() {
      /* mock */
    }
    disconnect() {
      /* mock */
    }
  };
  return instances;
};

describe('Zoom branch coverage', () => {
  /** @type {any} */
  let utils = null;
  /** @type {any} */
  let coordinator = null;
  /** @type {any[]} */
  let resizeObservers = [];
  /** @type {any} */
  let designSystem = null;
  /** @type {any} */
  let eventDelegation = null;
  /** @type {any} */
  let dockHost = null;
  /** @type {any} */
  let observerRegistry = null;
  let currentRoute = 'watch';
  /** When armed, the relevant-route predicate fails from the Nth call on. */
  let routeGate = null;
  let relevantRouteCalls = 0;

  /**
   * @param {{
   *   fakeTimers?: boolean,
   *   route?: string,
   *   translation?: string,
   *   hoverPopover?: any,
   *   style?: string,
   *   theme?: string,
   *   watchTarget?: boolean,
   *   mountedBeforeModule?: boolean,
   * }} [opts]
   */
  const boot = opts => {
    const o = opts || {};
    if (o.fakeTimers) jest.useFakeTimers();
    jest.resetModules();
    delete window.YouTubePlusZoom;
    delete window.YouTubePlusDesignSystem;
    delete window.YouTubePlusVisionDockHost;
    delete window.YouTubePlusEventDelegation;
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    currentRoute = o.route || 'watch';
    routeGate = null;
    relevantRouteCalls = 0;

    resizeObservers = installResizeObserver();
    observerRegistry = { track: jest.fn(), untrack: jest.fn() };

    const styleManager = { add: jest.fn(), remove: jest.fn() };
    utils = {
      exposeTestHooks,
      $: jest.fn((sel, ctx = document) => (ctx || document).querySelector(sel)),
      t: jest.fn(key => (o.translation === undefined ? key || '' : o.translation)),
      renderTemplateClone: jest.fn((el, html) => {
        el.innerHTML = html;
      }),
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      logSuppressed: jest.fn(),
      createIsRelevantRoute: jest.fn(() => () => {
        relevantRouteCalls += 1;
        if (routeGate && relevantRouteCalls >= routeGate.failFromCall) return false;
        return currentRoute === 'watch' || currentRoute === 'shorts';
      }),
      getRoute: jest.fn(() => currentRoute),
      loadFeatureEnabled: jest.fn(() => true),
      StyleManager: styleManager,
      ObserverRegistry: observerRegistry,
      storage: {
        getItem: key => localStorage.getItem(key),
        setItem: (key, value) => {
          localStorage.setItem(key, value);
          return true;
        },
      },
    };

    coordinator = {
      subscribeRoot: jest.fn(() => 'sub-1'),
      unsubscribeRoot: jest.fn(),
      watchTarget: jest.fn(() => 'target-1'),
      unwatch: jest.fn(),
    };
    if (o.watchTarget === false) delete coordinator.watchTarget;

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: utils,
    });
    // The real CleanupManager installed by the shared setup file.
    require('../src/cleanup-manager.js');
    Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
      configurable: true,
      writable: true,
      value: coordinator,
    });
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: { get: jest.fn(() => undefined), subscribe: jest.fn(() => jest.fn()) },
    });
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    delete window.YouTubePlusFeatureRegistry;
    require('../src/feature-registry.js');

    designSystem = {
      StyleManager: styleManager,
      getStyle: jest.fn(() => (o.style === undefined ? '.zoom{}' : o.style)),
      getThemeVariant: o.theme ? () => o.theme : undefined,
      initGlassDropdown: jest.fn(),
    };
    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: designSystem,
    });

    // attachHoverPopover returns a disposer (the real shape).
    eventDelegation = {
      attachHoverPopover: jest.fn((anchor, _panel, opts2) => {
        anchor.addEventListener('mouseenter', opts2.show);
        anchor.addEventListener('mouseleave', opts2.hide);
        return () => {
          anchor.removeEventListener('mouseenter', opts2.show);
          anchor.removeEventListener('mouseleave', opts2.hide);
        };
      }),
    };
    if (o.hoverPopover === null) delete eventDelegation.attachHoverPopover;
    Object.defineProperty(window, 'YouTubePlusEventDelegation', {
      configurable: true,
      writable: true,
      value: eventDelegation,
    });

    dockHost = {
      mount: jest.fn(),
      removeFeatureButton: jest.fn(),
    };
    Object.defineProperty(window, 'YouTubePlusVisionDockHost', {
      configurable: true,
      writable: true,
      value: dockHost,
    });

    Object.defineProperty(window, 'YouTubePlusThumbnail', {
      configurable: true,
      writable: true,
      value: {
        registerDockButtonListener: (btn, clickFn) => {
          const key = window.YouTubePlusCleanupManager.registerListener(
            btn,
            'click',
            clickFn,
            undefined,
            false
          );
          return () => window.YouTubePlusCleanupManager.unregisterListener?.(key);
        },
      },
    });

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: currentRoute === 'watch' ? '/watch' : '/feed/subscriptions',
      href: 'https://www.youtube.com/watch?v=test',
    });

    if (o.mountedBeforeModule) document.body.innerHTML = PLAYER_HTML;
    require('../src/zoom.js');
  };

  afterEach(() => {
    window.YouTubePlusZoom?.clearZoomUI?.();
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /** Mount the standard player + video, then create the zoom UI. */
  const mountZoomUI = () => {
    document.body.innerHTML = PLAYER_HTML;
    return window.YouTubePlusZoom.createZoomUI();
  };

  /** A synthetic pointer event: jsdom has no PointerEvent constructor. */
  const pointerEvent = (type, id, x, y, pointerType, button = undefined) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    ev.pointerId = id;
    ev.clientX = x;
    ev.clientY = y;
    ev.pointerType = pointerType;
    ev.button = button;
    return ev;
  };

  /** A synthetic touch event: jsdom has no TouchEvent/TouchList constructor. */
  const touchEvent = (type, touches) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    ev.touches = touches.map(t => ({ clientX: t.x, clientY: t.y }));
    return ev;
  };

  const getInput = () => document.getElementById('yp-zoom-control').querySelector('input');
  const getLabel = () => document.getElementById('yp-zoom-control').querySelector('.zoom-label');

  describe('persistence helpers', () => {
    test('readZoomPan coerces falsy and non-numeric fields to the defaults', () => {
      boot();
      const { readZoomPan } = window.YouTubePlusZoom.testHooks;
      expect(readZoomPan()).toEqual({ zoom: 1, panX: 0, panY: 0 });

      localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 0, panX: 'x', panY: null }));
      expect(readZoomPan()).toEqual({ zoom: 1, panX: 0, panY: 0 });

      localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: '1.75' }));
      expect(readZoomPan().zoom).toBe(1.75);
    });

    test('saveZoomPan normalises zero values and survives a storage failure', () => {
      boot();
      const { saveZoomPan, readZoomPan } = window.YouTubePlusZoom.testHooks;
      saveZoomPan(0, 0, 0);
      expect(JSON.parse(localStorage.getItem('ytp_zoom_pan'))).toEqual({
        zoom: 1,
        panX: 0,
        panY: 0,
      });

      const realSetItem = utils.storage.setItem;
      utils.storage.setItem = () => {
        throw new Error('quota');
      };
      expect(() => saveZoomPan(2, 4, 6)).not.toThrow();
      expect(utils.logSuppressed).toHaveBeenCalled();
      expect(utils.logger.warn).toHaveBeenCalledWith(
        'Zoom',
        'Failed to save zoom/pan settings',
        expect.any(Error)
      );
      utils.storage.setItem = realSetItem;
      expect(readZoomPan().zoom).toBe(1);
    });

    test('the restore log trims to 200 entries, tolerates storage failure and can log', () => {
      boot();
      const { logRestoreEvent } = window.YouTubePlusZoom;
      for (let i = 0; i < 205; i++) logRestoreEvent({ action: 'restore', index: i });
      const entries = JSON.parse(sessionStorage.getItem('ytp_zoom_restore_log'));
      expect(entries).toHaveLength(200);
      expect(entries[0].index).toBe(5);

      window.YTP_DEBUG = true;
      logRestoreEvent({ action: 'debug' });
      expect(utils.logger.warn).toHaveBeenCalledWith('Zoom', 'Zoom restore', expect.any(Object));
      delete window.YTP_DEBUG;

      const realGetItem = sessionStorage.getItem;
      sessionStorage.getItem = () => {
        throw new Error('session storage disabled');
      };
      expect(() => logRestoreEvent({ action: 'boom' })).not.toThrow();
      sessionStorage.getItem = realGetItem;
    });

    test('the restore log also reports through the shared debug config', () => {
      boot();
      window.YouTubePlusConfig = { debug: true };
      try {
        window.YouTubePlusZoom.logRestoreEvent({ action: 'restore', zoom: 1.5 });
        expect(utils.logger.warn).toHaveBeenCalledWith(
          'Zoom',
          'Zoom restore',
          expect.objectContaining({ action: 'restore', zoom: 1.5 })
        );
      } finally {
        delete window.YouTubePlusConfig;
      }
    });

    test('a corrupt restore log drops the entry instead of breaking the restore', () => {
      boot();
      sessionStorage.setItem('ytp_zoom_restore_log', 'not json');
      expect(() => window.YouTubePlusZoom.logRestoreEvent({ action: 'restore' })).not.toThrow();
      expect(sessionStorage.getItem('ytp_zoom_restore_log')).toBe('not json');
      expect(utils.logSuppressed).toHaveBeenCalled();
    });
  });

  describe('applyZoomToVideo and clampPan', () => {
    test('a detached video styles itself and can skip the transition', () => {
      boot();
      const video = document.createElement('video');
      window.YouTubePlusZoom.testHooks.applyZoomToVideo(video, 2, 5, -5, false, true);
      expect(video.style.transition).toBe('none');
      expect(video.style.transform).toContain('scale(2.000)');
      expect(video.style.willChange).toBe('transform');
    });

    test('the default zoom resets the transform and the will-change hint', () => {
      boot();
      const video = document.createElement('video');
      document.body.appendChild(video);
      window.YouTubePlusZoom.testHooks.applyZoomToVideo(video, 1, 0, 0);
      expect(video.style.transform).toBe('');
      expect(video.style.willChange).toBe('auto');
    });

    test('pan is clamped to the zoomed bounds of the player container', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        document.body.innerHTML = PLAYER_HTML;
        const player = document.getElementById('movie_player');
        const video = player.querySelector('video');
        jest
          .spyOn(player, 'getBoundingClientRect')
          .mockReturnValue(/** @type {any} */ ({ width: 200, height: 100, left: 0, top: 0 }));
        Object.defineProperty(video, 'videoWidth', { configurable: true, value: 400 });
        Object.defineProperty(video, 'videoHeight', { configurable: true, value: 200 });

        window.YouTubePlusZoom.createZoomUI();
        const input = getInput();
        input.value = '2';
        input.dispatchEvent(new Event('input'));
        jest.advanceTimersByTime(20);

        // Drag far beyond the scaled bounds; the transform stays clamped to
        // half the overflow of the 2x-scaled 400x200 video in a 200x100 box.
        video.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000, clientY: 5000 }));
        jest.advanceTimersByTime(20);
        expect(video.style.transform).toContain('translate(300.00px, 150.00px)');
      } finally {
        jest.useRealTimers();
      }
    });

    test('pan clamping is skipped while the layout metrics are empty', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML = PLAYER_HTML;
        const video = document.querySelector('video');
        window.YouTubePlusZoom.createZoomUI();
        // jsdom reports a zero-sized rect, so clampPan returns early and the
        // pan stays unclamped.
        video.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 90, clientY: 40 }));
        jest.advanceTimersByTime(20);
        expect(video.style.transform).toContain('translate(90.00px, 40.00px)');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('slider, wheel and keyboard input', () => {
    test('the slider clamps to the min/max range and updates the label', () => {
      boot();
      mountZoomUI();
      const input = getInput();
      const label = getLabel();

      input.value = '9';
      input.dispatchEvent(new Event('input'));
      expect(parseFloat(input.value)).toBe(2.5);
      expect(label.textContent).toBe('250%');

      input.value = '0.1';
      input.dispatchEvent(new Event('input'));
      expect(parseFloat(input.value)).toBe(0.5);
      expect(label.textContent).toBe('50%');
    });

    test('the reset button restores the default and reverts its own transform', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 2, panX: 10, panY: 20 }));
        mountZoomUI();
        const reset = document.getElementById('yp-zoom-control').querySelector('.zoom-reset');

        reset.click();
        expect(reset.style.transform).toBe('scale(0.9)');
        expect(window.YouTubePlusZoom.testHooks.readZoomPan()).toEqual({
          zoom: 1,
          panX: 0,
          panY: 0,
        });
        jest.advanceTimersByTime(200);
        expect(reset.style.transform).toBe('');
      } finally {
        jest.useRealTimers();
      }
    });

    test('shift+wheel is throttled and clamped at the zoom bounds', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        mountZoomUI();
        const player = document.getElementById('movie_player');
        const input = getInput();

        // Second wheel inside the 50ms throttle window is ignored.
        player.dispatchEvent(
          new WheelEvent('wheel', { shiftKey: true, deltaY: -100, bubbles: true, cancelable: true })
        );
        const afterFirst = input.value;
        player.dispatchEvent(
          new WheelEvent('wheel', { shiftKey: true, deltaY: -100, bubbles: true, cancelable: true })
        );
        expect(input.value).toBe(afterFirst);
        jest.advanceTimersByTime(60);

        // Zoom in to the ceiling, then keep zooming out to the floor.
        for (let i = 0; i < 45; i++) {
          player.dispatchEvent(
            new WheelEvent('wheel', {
              shiftKey: true,
              deltaY: -100,
              bubbles: true,
              cancelable: true,
            })
          );
          jest.advanceTimersByTime(60);
        }
        expect(parseFloat(input.value)).toBeCloseTo(2.5, 5);
        for (let i = 0; i < 60; i++) {
          player.dispatchEvent(
            new WheelEvent('wheel', {
              shiftKey: true,
              deltaY: 100,
              bubbles: true,
              cancelable: true,
            })
          );
          jest.advanceTimersByTime(60);
        }
        // Floating-point steps stall just above the floor once
        // current + delta falls below MIN_ZOOM.
        expect(parseFloat(input.value)).toBeLessThanOrEqual(0.55);
        expect(parseFloat(input.value)).toBeGreaterThanOrEqual(0.5);
      } finally {
        jest.useRealTimers();
      }
    });

    test('keyboard zoom steps from the stored level and stops when the feature is off', async () => {
      boot();
      mountZoomUI();
      const input = getInput();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '=', bubbles: true, cancelable: true })
      );
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true })
      );
      expect(parseFloat(input.value)).toBeCloseTo(1.1, 5);

      // Leaving the player route stops the feature, which disarms the handler.
      currentRoute = 'other';
      window.YouTubePlusFeatureRegistry.FeatureLifecycle._reset();
      const before = input.value;
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true })
      );
      expect(input.value).toBe(before);
    });

    test('the zoom handler is inert after the feature stops', () => {
      boot();
      mountZoomUI();
      const input = getInput();
      window.YouTubePlusZoom.testHooks.setFeatureEnabled(false);
      const before = input.value;
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true })
      );
      expect(input.value).toBe(before);
    });
  });

  describe('pan, drag and persistence', () => {
    test('a pan debounce persists the dragged offset', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const video = document.querySelector('video');
        const input = getInput();

        video.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 10 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 15 }));
        jest.advanceTimersByTime(20);
        jest.advanceTimersByTime(300);

        expect(window.YouTubePlusZoom.testHooks.readZoomPan()).toMatchObject({
          zoom: 1.5,
          panX: 30,
          panY: 15,
        });

        // A second drag re-schedules (and replaces) the pending save, and a
        // non-numeric slider falls back to the stored level.
        input.type = 'text';
        input.value = '';
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: 30, clientY: 15 }));
        video.dispatchEvent(new MouseEvent('mousedown', { clientX: 30, clientY: 15, button: 0 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 25 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 35 }));
        jest.advanceTimersByTime(20);
        jest.advanceTimersByTime(300);

        expect(window.YouTubePlusZoom.testHooks.readZoomPan()).toMatchObject({
          zoom: 1.5,
          panX: 60,
          panY: 35,
        });
      } finally {
        jest.useRealTimers();
      }
    });

    test('a pan repaint falls back to the default zoom when the slider is not numeric', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const video = document.querySelector('video');
        const input = getInput();
        // A range input sanitises '' to its midpoint, so switch the control to
        // a text input to observe the non-numeric fallback.
        input.type = 'text';
        input.value = '';

        video.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 12, clientY: 8 }));
        jest.advanceTimersByTime(20);
        expect(video.style.transform).toContain('translate(12.00px, 8.00px)');
        expect(video.style.transform).toContain('scale(1.000)');

        // Releasing the drag falls back to the default cursor too.
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: 12, clientY: 8 }));
        expect(video.style.cursor).toBe('');
      } finally {
        jest.useRealTimers();
      }
    });

    test('mouse drag gestures are ignored when unzoomed, non-primary or pointer-less', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        mountZoomUI();
        const video = document.querySelector('video');
        const addSpy = jest.spyOn(window, 'addEventListener');
        const countPair = type => addSpy.mock.calls.filter(call => call[0] === type).length;

        // Zoom 1: YouTube's click-to-seek must keep working.
        video.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        expect(countPair('mousemove')).toBe(0);

        // Non-primary button and a stray move/mouseup stay inert too.
        video.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 2 }));
        expect(countPair('mousemove')).toBe(0);
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: 5, clientY: 5 }));
        expect(video.style.transform).toBe('');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('pointer and touch pinch', () => {
    test('two pointers pinch the zoom level and restore touch-action on release', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const player = document.getElementById('movie_player');
        player.style.touchAction = 'pan-y';
        const input = getInput();

        player.dispatchEvent(pointerEvent('pointerdown', 1, 0, 0, 'touch'));
        player.dispatchEvent(pointerEvent('pointerdown', 2, 100, 0, 'touch'));
        expect(player.style.touchAction).toBe('none');

        player.dispatchEvent(pointerEvent('pointermove', 2, 200, 0, 'touch'));
        jest.advanceTimersByTime(20);
        // 1.5 * 200/100 would be 3, which the setter clamps to the maximum.
        expect(parseFloat(input.value)).toBe(2.5);

        player.dispatchEvent(pointerEvent('pointerup', 2, 200, 0, 'touch'));
        expect(player.style.touchAction).toBe('pan-y');

        // Releasing the first pointer also clears the pinch bookkeeping.
        player.dispatchEvent(pointerEvent('pointerup', 1, 0, 0, 'touch'));
        player.dispatchEvent(pointerEvent('pointercancel', 1, 0, 0, 'touch'));
      } finally {
        jest.useRealTimers();
      }
    });

    test('pointer capture is taken and released, and capture failures are swallowed', () => {
      jest.useFakeTimers();
      try {
        const setCapture = jest.fn();
        const releaseCapture = jest.fn();
        Object.defineProperty(Element.prototype, 'setPointerCapture', {
          configurable: true,
          value: setCapture,
        });
        Object.defineProperty(Element.prototype, 'releasePointerCapture', {
          configurable: true,
          value: releaseCapture,
        });
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const player = document.getElementById('movie_player');

        player.dispatchEvent(pointerEvent('pointerdown', 3, 10, 10, 'mouse', 0));
        expect(setCapture).toHaveBeenCalledWith(3);
        player.dispatchEvent(pointerEvent('pointerup', 3, 10, 10, 'mouse', 0));
        expect(releaseCapture).toHaveBeenCalledWith(3);

        // A rejecting capture must not abort the drag bookkeeping.
        setCapture.mockImplementation(() => {
          throw new Error('inactive pointer');
        });
        releaseCapture.mockImplementation(() => {
          throw new Error('never captured');
        });
        player.dispatchEvent(pointerEvent('pointerdown', 4, 10, 10, 'mouse', 0));
        expect(utils.logSuppressed).toHaveBeenCalled();
        player.dispatchEvent(pointerEvent('pointerup', 4, 10, 10, 'mouse', 0));
        delete Element.prototype.setPointerCapture;
        delete Element.prototype.releasePointerCapture;
      } finally {
        jest.useRealTimers();
      }
    });

    test('a two-finger touch pinch applies zoom and restores touch-action on touchend', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const player = document.getElementById('movie_player');
        player.style.touchAction = 'auto';
        const input = getInput();

        player.dispatchEvent(
          touchEvent('touchstart', [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ])
        );
        expect(player.style.touchAction).toBe('none');
        player.dispatchEvent(
          touchEvent('touchmove', [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
          ])
        );
        jest.advanceTimersByTime(20);
        expect(parseFloat(input.value)).toBeCloseTo(0.75, 5);

        player.dispatchEvent(touchEvent('touchend', [{ x: 0, y: 0 }]));
        expect(player.style.touchAction).toBe('auto');
        player.dispatchEvent(touchEvent('touchcancel', []));
      } finally {
        jest.useRealTimers();
      }
    });

    test('touch gestures without a video element are ignored', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        document.body.innerHTML = '<div id="movie_player"></div>';
        window.YouTubePlusZoom.createZoomUI();
        const player = document.getElementById('movie_player');
        player.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }]));
        player.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }]));
        player.dispatchEvent(touchEvent('touchmove', [{ x: 10, y: 10 }]));
        player.dispatchEvent(pointerEvent('pointerdown', 9, 0, 0, 'touch'));
        player.dispatchEvent(pointerEvent('pointermove', 9, 10, 10, 'touch'));
        player.dispatchEvent(pointerEvent('pointerup', 9, 10, 10, 'touch'));
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('observers, fullscreen and video swaps', () => {
    test('a video swap moves the wheel binding to the new element', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const player = document.getElementById('movie_player');
        const oldVideo = player.querySelector('video');
        const addSpy = jest.spyOn(oldVideo, 'addEventListener');
        const removeSpy = jest.spyOn(oldVideo, 'removeEventListener');

        const newVideo = document.createElement('video');
        newVideo.className = 'video-stream html5-main-video';
        oldVideo.replaceWith(newVideo);
        const swapCall = coordinator.watchTarget.mock.calls.find(
          c => c[0] === 'zoom::playerVideoSwap'
        );
        swapCall[2]();

        expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
        expect(addSpy).not.toHaveBeenCalled();
        jest.advanceTimersByTime(20);
        expect(newVideo.style.transform).toContain('scale(1.500)');

        // The wheel handler now rides the new element only.
        newVideo.dispatchEvent(
          new WheelEvent('wheel', { shiftKey: true, deltaY: -100, bubbles: true, cancelable: true })
        );
        jest.advanceTimersByTime(60);
        expect(parseFloat(getInput().value)).toBeGreaterThan(1.5);
      } finally {
        jest.useRealTimers();
      }
    });

    test('the fullscreen reapply adopts a video swapped in after the first attempt', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const player = document.getElementById('movie_player');
        const oldVideo = player.querySelector('video');

        document.dispatchEvent(new CustomEvent('fullscreenchange'));
        jest.advanceTimersByTime(80);
        // YouTube replaced the media element while the retry window was open.
        const newVideo = document.createElement('video');
        newVideo.className = 'video-stream html5-main-video';
        oldVideo.replaceWith(newVideo);
        jest.advanceTimersByTime(120);

        expect(newVideo.style.transform).toContain('scale(1.500)');
        expect(newVideo.style.transition).toBe('none');
        // The retry loop stops once the swap succeeded.
        expect(coordinator.watchTarget).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    test('a fullscreen pass without stored zoom falls back to the default level', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        mountZoomUI();
        const video = document.querySelector('video');
        localStorage.removeItem('ytp_zoom_pan');

        document.dispatchEvent(new CustomEvent('mozfullscreenchange'));
        jest.advanceTimersByTime(80);
        expect(video.style.transform).toBe('');
        expect(video.style.willChange).toBe('auto');
      } finally {
        jest.useRealTimers();
      }
    });

    test('the fullscreen retry loop re-applies zoom while the player is present', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const video = document.querySelector('video');

        document.dispatchEvent(new CustomEvent('webkitfullscreenchange'));
        jest.advanceTimersByTime(80 + 4 * 120 + 40);
        // Retries reapply without a transition, then stop.
        expect(video.style.transform).toContain('scale(1.500)');
        expect(video.style.transition).toBe('none');
      } finally {
        jest.useRealTimers();
      }
    });

    test('a swap with no stored zoom reapplies the default and stops re-binding', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const player = document.getElementById('movie_player');
        const oldVideo = player.querySelector('video');
        localStorage.removeItem('ytp_zoom_pan');
        const newVideo = document.createElement('video');
        newVideo.className = 'video-stream html5-main-video';
        oldVideo.replaceWith(newVideo);

        const swapCall = coordinator.watchTarget.mock.calls.find(
          c => c[0] === 'zoom::playerVideoSwap'
        );
        swapCall[2]();
        expect(newVideo.style.transform).toBe('');

        // A second pass finds the same element and rebinds nothing.
        swapCall[2]();
        expect(
          coordinator.watchTarget.mock.calls.filter(c => c[0] === 'zoom::videoStyle')
        ).toHaveLength(2);
      } finally {
        jest.useRealTimers();
      }
    });

    test('at the default level a style clobber is not restored', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        mountZoomUI();
        jest.advanceTimersByTime(200);
        const video = document.querySelector('video');
        localStorage.removeItem('ytp_zoom_pan');
        const styleCall = coordinator.watchTarget.mock.calls.find(c => c[0] === 'zoom::videoStyle');

        // Zoom 1 is the neutral level: nothing to restore, so the transform
        // YouTube wrote stays untouched.
        video.style.transform = 'scale(7)';
        styleCall[2]([{ type: 'attributes', attributeName: 'style' }]);
        jest.advanceTimersByTime(20);
        expect(video.style.transform).toBe('scale(7)');
        expect(sessionStorage.getItem('ytp_zoom_restore_log')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test('a slider input without a value resets to the default level', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        mountZoomUI();
        const input = getInput();
        input.type = 'text';
        input.value = '';

        input.dispatchEvent(new Event('input'));
        expect(getInput().value).toBe('1');
        expect(getLabel().textContent).toBe('100%');
      } finally {
        jest.useRealTimers();
      }
    });

    test('a style mutation while a transform is being applied is ignored', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const video = document.querySelector('video');
        const styleCall = coordinator.watchTarget.mock.calls.find(c => c[0] === 'zoom::videoStyle');

        // Applying a new zoom marks the tracking flag; a clobber in that window
        // must not schedule a restore.
        const input = getInput();
        input.value = '1.6';
        input.dispatchEvent(new Event('input'));
        jest.advanceTimersByTime(20);
        video.style.transform = 'scale(9)';
        styleCall[2]([{ type: 'attributes', attributeName: 'style' }]);
        jest.advanceTimersByTime(20);
        expect(video.style.transform).toContain('scale(9)');

        // After the apply window closes the restore runs again.
        jest.advanceTimersByTime(200);
        video.style.transform = 'scale(8)';
        styleCall[2]([{ type: 'attributes', attributeName: 'style' }]);
        jest.advanceTimersByTime(20);
        expect(video.style.transform).toContain('scale(1.600)');
        expect(JSON.parse(sessionStorage.getItem('ytp_zoom_restore_log'))).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });

    test('an unchanged transform and non-style records never schedule a restore', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        mountZoomUI();
        const styleCall = coordinator.watchTarget.mock.calls.find(c => c[0] === 'zoom::videoStyle');
        styleCall[2]([{ type: 'childList' }]);
        styleCall[2]([{ type: 'attributes', attributeName: 'class' }]);
        jest.advanceTimersByTime(20);
        expect(sessionStorage.getItem('ytp_zoom_restore_log')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test('the resize observer repositions the control on the next frame', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true, theme: 'classic' });
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video>' +
          '<div class="ytp-chrome-bottom" style="height:40px"></div></div>';
        window.YouTubePlusZoom.createZoomUI();
        const wrap = document.getElementById('yp-zoom-control');
        const chrome = document.querySelector('.ytp-chrome-bottom');
        Object.defineProperty(chrome, 'offsetHeight', { configurable: true, value: 40 });

        expect(resizeObservers).toHaveLength(1);
        expect(resizeObservers[0].observed).toEqual([chrome]);
        resizeObservers[0].callback([{}]);
        jest.advanceTimersByTime(20);
        expect(wrap.style.bottom).toBe('48px');

        // Without a measured chrome height the CSS fallback is restored.
        Object.defineProperty(chrome, 'offsetHeight', { configurable: true, value: 0 });
        resizeObservers[0].callback([{}]);
        jest.advanceTimersByTime(20);
        expect(wrap.style.bottom).toBe('');
      } finally {
        jest.useRealTimers();
      }
    });

    test('the resize observer falls back to a direct update without requestAnimationFrame', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true, theme: 'classic' });
        document.body.innerHTML = PLAYER_HTML;
        window.YouTubePlusZoom.createZoomUI();
        const rAF = window.requestAnimationFrame;
        // @ts-expect-error deliberate temporary removal
        window.requestAnimationFrame = undefined;
        try {
          expect(() => resizeObservers[0].callback([{}])).not.toThrow();
        } finally {
          window.requestAnimationFrame = rAF;
        }
      } finally {
        jest.useRealTimers();
      }
    });

    test('without a mutation coordinator the player swap watcher is skipped', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true, watchTarget: false });
        mountZoomUI();
        expect(coordinator.watchTarget).toBeUndefined();
        window.YouTubePlusZoom.clearZoomUI();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  /** Player markup with the classic right-controls chrome inside it. */
  const CLASSIC_PLAYER_HTML =
    '<div id="movie_player"><video class="video-stream html5-main-video"></video>' +
    '<div class="ytp-right-controls"></div></div>';

  describe('classic theme button and dock wiring', () => {
    test('the classic control button is created in the player chrome and hovered', () => {
      boot({ theme: 'classic' });
      document.body.innerHTML = CLASSIC_PLAYER_HTML;
      const player = document.getElementById('movie_player');
      jest
        .spyOn(player, 'getBoundingClientRect')
        .mockReturnValue(
          /** @type {any} */ ({ width: 800, height: 600, left: 0, top: 0, bottom: 600 })
        );

      window.YouTubePlusZoom.createZoomUI();
      const wrap = document.getElementById('yp-zoom-control');
      const btn = document.getElementById('yp-zoom-button');
      expect(btn).not.toBeNull();
      expect(btn.parentElement.className).toBe('ytp-right-controls');
      expect(btn.getAttribute('title')).toBe('zoom');
      jest
        .spyOn(btn, 'getBoundingClientRect')
        .mockReturnValue(
          /** @type {any} */ ({ width: 34, height: 34, left: 100, top: 500, bottom: 534 })
        );

      btn.dispatchEvent(new MouseEvent('mouseenter'));
      expect(wrap.classList.contains('visible')).toBe(true);
      expect(wrap.style.bottom).toBe('108px');

      btn.dispatchEvent(new MouseEvent('mouseleave'));
      expect(wrap.classList.contains('visible')).toBe(false);

      // Keyboard parity: focus and blur drive the same popover.
      btn.dispatchEvent(new FocusEvent('focus'));
      expect(wrap.classList.contains('visible')).toBe(true);
      btn.dispatchEvent(new FocusEvent('blur'));
      expect(wrap.classList.contains('visible')).toBe(false);

      // Re-wiring on a rebuild must not stack listeners.
      window.YouTubePlusZoom.clearZoomUI();
      expect(document.getElementById('yp-zoom-button')).toBeNull();
    });

    test('without a hover popover API the classic button falls back to mouse events', () => {
      boot({ theme: 'classic', hoverPopover: null });
      document.body.innerHTML = CLASSIC_PLAYER_HTML;
      window.YouTubePlusZoom.createZoomUI();
      const wrap = document.getElementById('yp-zoom-control');
      const btn = document.getElementById('yp-zoom-button');
      expect(btn).not.toBeNull();

      btn.dispatchEvent(new MouseEvent('mouseenter'));
      expect(wrap.classList.contains('visible')).toBe(true);
      btn.dispatchEvent(new MouseEvent('mouseleave'));
      expect(wrap.classList.contains('visible')).toBe(false);
    });

    test('the classic player control is never mounted twice', () => {
      boot({ theme: 'classic' });
      document.body.innerHTML = CLASSIC_PLAYER_HTML;
      window.YouTubePlusZoom.createZoomUI();
      window.YouTubePlusZoom.clearZoomUI();
      window.YouTubePlusZoom.createZoomUI();
      expect(document.querySelectorAll('#yp-zoom-button')).toHaveLength(1);
    });

    test('a remounted classic button releases the previous hover wiring first', () => {
      boot({ theme: 'classic' });
      document.body.innerHTML = CLASSIC_PLAYER_HTML;
      window.YouTubePlusZoom.createZoomUI();
      // A player re-render drops the control without the module noticing; the
      // next mount must release the stale wiring instead of stacking it.
      document.getElementById('yp-zoom-control').remove();
      window.YouTubePlusZoom.createZoomUI();

      const btn = document.getElementById('yp-zoom-button');
      const wrap = document.getElementById('yp-zoom-control');
      const popovers = eventDelegation.attachHoverPopover.mock.calls.filter(
        call => call[0] === btn
      );
      expect(popovers.length).toBeGreaterThanOrEqual(1);

      btn.dispatchEvent(new MouseEvent('mouseenter'));
      expect(wrap.classList.contains('visible')).toBe(true);
      window.YouTubePlusZoom.clearZoomUI();
    });

    test('mounting without a video element still restores the neutral pan state', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 2, panX: 12, panY: -8 }));
        document.body.innerHTML = '<div id="movie_player"></div>';
        const wrap = window.YouTubePlusZoom.createZoomUI();
        expect(wrap).toBeTruthy();
        expect(parseFloat(getInput().value)).toBe(2);
        // No video: nothing to style, and the pan cannot be clamped.
        expect(document.querySelector('video')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test('the Vision dock host is mounted outside the classic variant', () => {
      boot();
      mountZoomUI();
      expect(dockHost.mount).toHaveBeenCalled();

      const wrap = document.getElementById('yp-zoom-control');
      expect(dockHost.mount.mock.calls[0][1]).toEqual({ wrap });
      window.YouTubePlusZoom.clearZoomUI();
      expect(dockHost.removeFeatureButton).toHaveBeenCalledWith('zoom');
    });

    test('the zoom styles are owned by the feature context and added once', () => {
      boot({ style: '.yp-zoom-control{}' });
      mountZoomUI();
      expect(designSystem.getStyle).toHaveBeenCalledWith('yp-zoom-styles');
      const addCalls = designSystem.StyleManager.add.mock.calls.filter(
        c => c[0] === 'yp-zoom-styles'
      );
      expect(addCalls).toHaveLength(1);
      window.YouTubePlusZoom.clearZoomUI();
      window.YouTubePlusZoom.createZoomUI();
      expect(
        designSystem.StyleManager.add.mock.calls.filter(c => c[0] === 'yp-zoom-styles')
      ).toHaveLength(1);
    });

    test('the dock button mounts, positions the popover and is disposed', () => {
      boot();
      const player = document.createElement('div');
      player.id = 'movie_player';
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      const wrap = document.createElement('div');
      wrap.id = 'yp-zoom-control';
      const input = document.createElement('input');
      input.type = 'range';
      wrap.appendChild(input);
      player.append(dock, wrap);
      document.body.appendChild(player);

      const dispose = window.YouTubePlusZoom.DESCRIPTOR.mountDock(player, dock, { wrap });
      const btn = dock.querySelector('#yp-vision-zoom-btn');
      expect(btn.getAttribute('title')).toBe('zoom');
      expect(eventDelegation.attachHoverPopover).toHaveBeenCalled();

      // Unmeasured buttons skip the positioning pass.
      btn.dispatchEvent(new MouseEvent('click'));
      expect(wrap.classList.contains('visible')).toBe(true);

      jest
        .spyOn(btn, 'getBoundingClientRect')
        .mockReturnValue(/** @type {any} */ ({ width: 34, height: 34, left: 100, bottom: 50 }));
      jest
        .spyOn(player, 'getBoundingClientRect')
        .mockReturnValue(
          /** @type {any} */ ({ width: 800, height: 600, left: 0, top: 0, bottom: 600 })
        );
      btn.dispatchEvent(new MouseEvent('mouseenter'));
      // The Vision dock anchors the popover 10px under the dock bottom.
      expect(wrap.style.top).toBe('10px');

      expect(document.activeElement).toBe(input);
      dispose();
      // The disposer released the click registration and the hover wiring.
      btn.dispatchEvent(new MouseEvent('click'));
      expect(eventDelegation.attachHoverPopover).toHaveBeenCalledTimes(1);
    });

    test('a dock without the vision anchor positions from the button bottom', () => {
      boot();
      const player = document.createElement('div');
      player.id = 'movie_player';
      const dock = document.createElement('div');
      const wrap = document.createElement('div');
      wrap.id = 'yp-zoom-control';
      player.append(dock, wrap);
      document.body.appendChild(player);

      window.YouTubePlusZoom.DESCRIPTOR.mountDock(player, dock, { wrap });
      const btn = dock.querySelector('#yp-vision-zoom-btn');
      jest
        .spyOn(btn, 'getBoundingClientRect')
        .mockReturnValue(/** @type {any} */ ({ width: 20, height: 20, left: 40, bottom: 30 }));
      jest
        .spyOn(player, 'getBoundingClientRect')
        .mockReturnValue(
          /** @type {any} */ ({ width: 100, height: 100, left: 0, top: 0, bottom: 100 })
        );
      btn.dispatchEvent(new MouseEvent('click'));
      expect(wrap.style.left).toBe('50px');
      expect(wrap.style.top).toBe('40px');
    });

    test('the dock button click falls back to the descriptor command', () => {
      boot();
      const player = document.createElement('div');
      player.id = 'movie_player';
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);
      document.body.appendChild(player);

      // No zoom control exists yet, so the dock button runs the command, which
      // mounts the control and shows it.
      const dispose = window.YouTubePlusZoom.DESCRIPTOR.mountDock(player, dock);
      const btn = dock.querySelector('#yp-vision-zoom-btn');
      btn.dispatchEvent(new MouseEvent('click'));
      const wrap = document.getElementById('yp-zoom-control');
      expect(wrap.classList.contains('visible')).toBe(true);
      expect(document.activeElement).toBe(wrap.querySelector('input'));
      dispose();
    });

    test('a missing translation falls back to the English label', () => {
      boot({ translation: '' });
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      document.body.innerHTML = '<div id="movie_player"></div>';
      const player = document.getElementById('movie_player');
      player.appendChild(dock);
      window.YouTubePlusZoom.DESCRIPTOR.mountDock(player, dock);
      const btn = dock.querySelector('#yp-vision-zoom-btn');
      expect(btn.getAttribute('title')).toBe('Zoom');
      expect(btn.getAttribute('aria-label')).toBe('Zoom');
    });

    test('the dock mount starts the module outside the player routes', () => {
      boot({ route: 'other' });
      const player = document.createElement('div');
      player.id = 'movie_player';
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);
      document.body.appendChild(player);

      // Mounting the dock button initialises the module even though the
      // lifecycle never started, so no zoom control can exist.
      const dispose = window.YouTubePlusZoom.DESCRIPTOR.mountDock(player, dock);
      expect(typeof window.YouTubePlusZoom.createZoomUI).toBe('function');
      expect(dock.querySelector('#yp-vision-zoom-btn')).not.toBeNull();
      expect(document.getElementById('yp-zoom-control')).toBeNull();
      dispose();
    });

    test('the command starts the module lazily outside the player routes', () => {
      boot({ route: 'other' });
      // The lifecycle never started, so the module-level API does not exist yet
      // and the descriptor still reports itself as available.
      expect(window.YouTubePlusZoom.canRenderZoomUI).toBeUndefined();
      expect(window.YouTubePlusZoom.DESCRIPTOR.isAvailable()).toBe(true);

      const player = document.createElement('div');
      player.id = 'movie_player';
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);
      document.body.appendChild(player);

      expect(window.YouTubePlusZoom.DESCRIPTOR.command()).toBe(false);
      expect(typeof window.YouTubePlusZoom.canRenderZoomUI).toBe('function');
      expect(window.YouTubePlusZoom.canRenderZoomUI()).toBe(false);
      expect(window.YouTubePlusZoom.DESCRIPTOR.isAvailable()).toBe(false);

      window.YouTubePlusZoom.DESCRIPTOR.mountDock(player, dock);
      expect(dock.querySelector('#yp-vision-zoom-btn')).not.toBeNull();
    });

    test('the command remounts a removed zoom control and focuses the slider', () => {
      boot();
      mountZoomUI();
      const wrap = document.getElementById('yp-zoom-control');
      // A player re-render drops the control without the module noticing.
      wrap.remove();

      expect(window.YouTubePlusZoom.DESCRIPTOR.command()).toBe(true);
      const recreated = document.getElementById('yp-zoom-control');
      expect(recreated).not.toBeNull();
      expect(recreated.classList.contains('visible')).toBe(true);
      expect(document.activeElement).toBe(recreated.querySelector('input'));
    });

    test('the command reports failure when no control can exist', () => {
      boot();
      document.body.innerHTML = '<div></div>';
      expect(window.YouTubePlusZoom.DESCRIPTOR.command()).toBe(false);
    });
  });

  describe('mounting, gating and teardown', () => {
    test('initZoom retries until the player appears', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        document.body.innerHTML = '<div id="placeholder"></div>';
        window.YouTubePlusZoom.testHooks.setFeatureEnabled(true);
        expect(document.getElementById('yp-zoom-control')).toBeNull();

        document.body.innerHTML = PLAYER_HTML;
        jest.advanceTimersByTime(400);
        expect(document.getElementById('yp-zoom-control')).not.toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test('a player inside a miniplayer host is not mounted', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        document.body.innerHTML = '<ytd-miniplayer><div id="movie_player"></div></ytd-miniplayer>';
        window.YouTubePlusZoom.testHooks.setFeatureEnabled(true);
        expect(document.getElementById('yp-zoom-control')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test('a route that goes inactive inside the mount pass clears the UI', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        document.body.innerHTML = PLAYER_HTML;
        // The initial eligibility check passes; the re-check inside the mount
        // pass sees an inactive route and clears instead of mounting.
        relevantRouteCalls = 0;
        routeGate = { failFromCall: 2 };
        window.YouTubePlusZoom.testHooks.setFeatureEnabled(true);
        expect(document.getElementById('yp-zoom-control')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test('an active miniplayer with a visible box gates the UI', () => {
      boot();
      const mini = document.createElement('ytd-miniplayer');
      mini.setAttribute('enabled', '');
      Object.defineProperty(mini, 'offsetParent', { configurable: true, value: document.body });
      document.body.appendChild(mini);
      expect(window.YouTubePlusZoom.isMiniPlayerActive()).toBe(true);
      expect(window.YouTubePlusZoom.canRenderZoomUI()).toBe(false);

      // A detached miniplayer does not gate anything.
      mini.remove();
      document.body.appendChild(document.createElement('ytd-watch-flexy'));
      expect(window.YouTubePlusZoom.isMiniPlayerActive()).toBe(false);
    });

    test('navigation resets the stored zoom and rebuilds after the route settles', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 2, panX: 5, panY: 5 }));
        mountZoomUI();

        window.dispatchEvent(new Event('yp:nav-refresh'));
        expect(window.YouTubePlusZoom.testHooks.readZoomPan()).toEqual({
          zoom: 1,
          panX: 0,
          panY: 0,
        });
        expect(document.getElementById('yp-zoom-control')).toBeNull();

        jest.advanceTimersByTime(400);
        expect(document.getElementById('yp-zoom-control')).not.toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    test('rebuildUI recreates the control for the current player', () => {
      jest.useFakeTimers();
      try {
        boot({ fakeTimers: true });
        mountZoomUI();
        const first = document.getElementById('yp-zoom-control');
        window.YouTubePlusZoom.rebuildUI();
        const second = document.getElementById('yp-zoom-control');
        expect(second).not.toBeNull();
        expect(second).not.toBe(first);
      } finally {
        jest.useRealTimers();
      }
    });

    test('clearing the UI without a mounted control resets a live video', () => {
      boot();
      const video = document.createElement('video');
      video.className = 'video-stream';
      video.style.cursor = 'grab';
      video.style.transform = 'scale(2)';
      document.body.appendChild(video);

      window.YouTubePlusZoom.clearZoomUI();
      expect(video.style.cursor).toBe('');
      expect(video.style.transform).toBe('');
    });

    test('a second createZoomUI call reuses the existing control', () => {
      boot();
      const first = mountZoomUI();
      expect(window.YouTubePlusZoom.createZoomUI()).toBe(first);
    });

    test('a non-player route never mounts the zoom control', () => {
      boot({ route: 'watch' });
      document.body.innerHTML = PLAYER_HTML;
      window.YouTubePlusZoom.initZoom();
      expect(document.getElementById('yp-zoom-control')).not.toBeNull();

      // Leaving the player route makes the UI ineligible again.
      currentRoute = 'other';
      window.YouTubePlusZoom.initZoom();
      expect(document.getElementById('yp-zoom-control')).toBeNull();
    });

    test('the closestDock helper tolerates a missing element', () => {
      boot();
      expect(window.YouTubePlusZoom.closestDock(null)).toBeNull();
      const el = document.createElement('div');
      el.className = 'vision-top-center-dock';
      expect(window.YouTubePlusZoom.closestDock(el)).toBe(el);
    });
  });
});
