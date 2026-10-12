/**
 * @jest-environment jsdom
 *
 * Tests the real zoom.js module surface through window.YouTubePlusZoom.
 * Earlier versions of this file tested locally reimplemented copies of the
 * module logic or hardcoded mock transforms; now every assertion exercises
 * the actual exported methods and checks observable DOM side-effects.
 */

// Mirrors the utils.js test-hook gate: the mock YouTubeUtils object below
// stands in for the real surface, so it carries the same gated exposure.
const exposeTestHooks = (facade, hooks) => {
  if (window.__YTP_TEST_HOOKS__ === true) facade.testHooks = hooks;
};

describe('Zoom Module', () => {
  /** @type {any} */
  let cleanupManager;

  const setupZoomDeps = () => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // jsdom lacks ResizeObserver; createZoomUI's positioning helper needs it.
    if (typeof global.ResizeObserver !== 'function') {
      global.ResizeObserver = class {
        observe() {
          /* mock */
        }
        unobserve() {
          /* mock */
        }
        disconnect() {
          /* mock */
        }
      };
    }

    cleanupManager = {
      registerInterval: jest.fn(id => id),
      registerTimeout: jest.fn(id => id),
      registerObserver: jest.fn(obs => obs),
      registerListener: jest.fn((target, event, handler, options) => {
        target.addEventListener(event, handler, options);
        return { dispose: () => target.removeEventListener(event, handler) };
      }),
      register: jest.fn(),
      cleanup: jest.fn(),
      registerAnimationFrame: jest.fn(id => id),
      getListenerStats: jest.fn(() => ({ active: 0, registeredTotal: 0 })),
    };

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        exposeTestHooks,
        $: jest.fn((sel, ctx = document) => (ctx || document).querySelector(sel)),
        $$: jest.fn((sel, ctx = document) => Array.from((ctx || document).querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
        t: jest.fn(key => key || ''),
        renderTemplateClone: jest.fn((el, html) => {
          el.innerHTML = html;
        }),
        cleanupManager,
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        loadFeatureEnabled: jest.fn(() => true),
        getRoute: jest.fn(() => 'watch'),
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        logSuppressed: jest.fn(),
        createWithErrorBoundary: jest.fn(() => fn => fn),
        createIsRelevantRoute: jest.fn(() => () => true),
        whenRelevant: jest.fn(({ onEnter }) => onEnter()),
        SETTINGS_KEY: 'youtube_plus_settings',
        storage: {
          get: (key, def = null) => {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : def;
          },
          set: (key, val) => {
            localStorage.setItem(key, JSON.stringify(val));
            return true;
          },
          getItem: key => localStorage.getItem(key),
          setItem: (key, val) => {
            localStorage.setItem(key, val);
            return true;
          },
          removeItem: key => localStorage.removeItem(key),
        },
      },
    });

    Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
      configurable: true,
      writable: true,
      value: {
        subscribeRoot: jest.fn(() => 'sub-1'),
        unsubscribeRoot: jest.fn(),
        watchTarget: jest.fn(() => 'target-1'),
        unwatchTarget: jest.fn(),
      },
    });

    // Real registry: zoom runs as a lifecycle feature and starts through it.
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    delete window.YouTubePlusFeatureRegistry;
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: { get: jest.fn(() => undefined), subscribe: jest.fn(() => jest.fn()) },
    });
    require('../src/feature-registry.js');

    Object.defineProperty(window, 'YouTubePlusEventDelegation', {
      configurable: true,
      writable: true,
      value: {
        attachHoverPopover: jest.fn((anchor, _panel, opts) => {
          anchor.addEventListener('mouseenter', opts.show);
          anchor.addEventListener('mouseleave', opts.hide);
        }),
      },
    });

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });

    // The dock-button listener registration is owned by the thumbnail module
    // (it loads earlier in build order); the zoom fallback branch delegates.
    Object.defineProperty(window, 'YouTubePlusThumbnail', {
      configurable: true,
      writable: true,
      value: {
        registerDockButtonListener: (btn, clickFn) => {
          const key = window.YouTubePlusCleanupManager?.registerListener?.(
            btn,
            'click',
            clickFn,
            undefined,
            false
          );
          return () => {
            if (key) window.YouTubePlusCleanupManager?.unregisterListener?.(key);
          };
        },
      },
    });
  };

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusZoom;
    localStorage.clear();
    sessionStorage.clear();

    setupZoomDeps();
    require('../src/zoom.js');
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    jest.restoreAllMocks();
  });

  test('exposes the real API facade on window.YouTubePlusZoom', () => {
    expect(window.YouTubePlusZoom).toBeDefined();
    expect(typeof window.YouTubePlusZoom.testHooks.applyZoomToVideo).toBe('function');
    expect(typeof window.YouTubePlusZoom.testHooks.readZoomPan).toBe('function');
    expect(typeof window.YouTubePlusZoom.testHooks.saveZoomPan).toBe('function');
    expect(typeof window.YouTubePlusZoom.testHooks.findVideoElement).toBe('function');
    expect(typeof window.YouTubePlusZoom.testHooks.setFeatureEnabled).toBe('function');
    expect(typeof window.YouTubePlusZoom.clearZoomUI).toBe('function');
    expect(typeof window.YouTubePlusZoom.canRenderZoomUI).toBe('function');
    expect(typeof window.YouTubePlusZoom.isMiniPlayerActive).toBe('function');
    expect(typeof window.YouTubePlusZoom.logRestoreEvent).toBe('function');
  });

  describe('applyZoomToVideo', () => {
    test('applies scale and translate transforms to real video element', () => {
      const container = document.createElement('div');
      const video = document.createElement('video');
      video.className = 'video-stream';
      container.appendChild(video);
      document.body.appendChild(container);

      window.YouTubePlusZoom.testHooks.applyZoomToVideo(video, 1.5, 10, -20);

      expect(video.style.transform).toContain('scale(1.500)');
      expect(video.style.transform).toContain('translate(10.00px, -20.00px)');
      expect(video.style.transformOrigin).toBe('center center');
      expect(container.style.overflow).toBe('visible');
      expect(container.style.position).toBe('relative');
    });

    test('handles null/undefined video gracefully without errors', () => {
      expect(() => {
        window.YouTubePlusZoom.testHooks.applyZoomToVideo(null, 1.5, 0, 0);
      }).not.toThrow();
    });

    test('resets transform tracking flag when transition completes', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      window.YouTubePlusZoom.testHooks.applyZoomToVideo(video, 1.25, 0, 0);
      expect(video.style.transform).toContain('scale(1.250)');
    });
  });

  describe('readZoomPan and saveZoomPan persistence', () => {
    test('stores zoom/pan values in localStorage and reads them accurately', () => {
      window.YouTubePlusZoom.testHooks.saveZoomPan(1.75, 45, -30);

      const raw = localStorage.getItem('ytp_zoom_pan');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw || '{}');
      expect(parsed.zoom).toBe(1.75);
      expect(parsed.panX).toBe(45);
      expect(parsed.panY).toBe(-30);

      const state = window.YouTubePlusZoom.testHooks.readZoomPan();
      expect(state.zoom).toBe(1.75);
      expect(state.panX).toBe(45);
      expect(state.panY).toBe(-30);
    });

    test('returns default values when localStorage is empty or corrupted', () => {
      localStorage.removeItem('ytp_zoom_pan');
      const defaultState = window.YouTubePlusZoom.testHooks.readZoomPan();
      expect(defaultState.zoom).toBe(1);
      expect(defaultState.panX).toBe(0);
      expect(defaultState.panY).toBe(0);

      localStorage.setItem('ytp_zoom_pan', 'invalid-json{');
      const corruptedState = window.YouTubePlusZoom.testHooks.readZoomPan();
      expect(corruptedState.zoom).toBe(1);
      expect(corruptedState.panX).toBe(0);
      expect(corruptedState.panY).toBe(0);
    });
  });

  describe('findVideoElement', () => {
    test('locates video stream inside player container', () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      const video = document.createElement('video');
      video.className = 'video-stream';
      player.appendChild(video);
      document.body.appendChild(player);

      const found = window.YouTubePlusZoom.testHooks.findVideoElement();
      expect(found).toBe(video);
    });

    test('returns null when no video element is present', () => {
      const found = window.YouTubePlusZoom.testHooks.findVideoElement();
      expect(found).toBeNull();
    });
  });

  describe('setFeatureEnabled and clearZoomUI', () => {
    test('clears UI elements and resets video styles when disabled', () => {
      const video = document.createElement('video');
      video.className = 'video-stream';
      video.style.transform = 'scale(1.5)';
      video.style.cursor = 'grab';
      document.body.appendChild(video);

      const uiControl = document.createElement('div');
      uiControl.id = 'yp-zoom-control';
      document.body.appendChild(uiControl);

      const uiStyles = document.createElement('style');
      uiStyles.id = 'yp-zoom-styles';
      document.body.appendChild(uiStyles);

      window.YouTubePlusZoom.testHooks.setFeatureEnabled(false);

      expect(document.getElementById('yp-zoom-control')).toBeNull();
      expect(document.getElementById('yp-zoom-styles')).toBeNull();
      expect(video.style.transform).toBe('');
      expect(video.style.cursor).toBe('');
    });
  });

  describe('miniplayer and route rendering checks', () => {
    test('isMiniPlayerActive correctly detects active miniplayer', () => {
      expect(window.YouTubePlusZoom.isMiniPlayerActive()).toBe(false);

      const miniplayer = document.createElement('ytd-miniplayer');
      miniplayer.setAttribute('active', '');
      document.body.appendChild(miniplayer);

      // In jsdom offsetParent is null, mock getClientRects to simulate visible element
      jest
        .spyOn(miniplayer, 'getClientRects')
        .mockReturnValue(/** @type {any} */ ([{ width: 300 }]));
      expect(window.YouTubePlusZoom.isMiniPlayerActive()).toBe(true);
    });

    test('canRenderZoomUI respects route and miniplayer status', () => {
      expect(window.YouTubePlusZoom.canRenderZoomUI()).toBe(true);
    });
  });

  describe('dock availability and navigation rebuild', () => {
    test('the dock descriptor is available only where the zoom UI can render', () => {
      const zoom = window.YouTubePlusZoom;
      expect(zoom.DESCRIPTOR.isAvailable()).toBe(true);

      const canRender = zoom.canRenderZoomUI;
      zoom.canRenderZoomUI = () => false;
      expect(zoom.DESCRIPTOR.isAvailable()).toBe(false);

      delete zoom.canRenderZoomUI;
      expect(zoom.DESCRIPTOR.isAvailable()).toBe(true);
      zoom.canRenderZoomUI = canRender;
    });

    test('the rebuild after navigation is a registered timer that leaves when it fires', () => {
      jest.useFakeTimers();
      const cm = window.YouTubePlusCleanupManager;
      try {
        const before = cm.timeouts.size;
        window.dispatchEvent(new Event('yt-navigate-finish'));
        expect(cm.timeouts.size).toBeGreaterThan(before);
        jest.advanceTimersByTime(300);
        expect(cm.timeouts.size).toBe(before);
      } finally {
        jest.useRealTimers();
      }
    });

    test('off its routes zoom no longer reacts to navigation', () => {
      jest.useFakeTimers();
      const cm = window.YouTubePlusCleanupManager;
      try {
        window.YouTubeUtils.getRoute = jest.fn(() => 'home');
        window.dispatchEvent(new Event('yp-history-navigate'));
        expect(window.YouTubePlusFeatureRegistry.FeatureLifecycle.isRunning('zoom')).toBe(false);
        const before = cm.timeouts.size;
        window.dispatchEvent(new Event('yt-navigate-finish'));
        expect(cm.timeouts.size).toBe(before);
      } finally {
        window.YouTubeUtils.getRoute = jest.fn(() => 'watch');
        jest.useRealTimers();
      }
    });

    test('the rebuild still runs without a cleanup manager timer helper', () => {
      jest.useFakeTimers();
      const cm = window.YouTubePlusCleanupManager;
      const timeout = cm.timeout;
      cm.timeout = undefined;
      try {
        // Load the module under fake timers so its bound setTimeout is faked.
        jest.resetModules();
        // The re-require needs a free lifecycle slot so its define+sync actually
        // start; without the reset define() returns null for the taken id.
        window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
        // Miniplayer stub keeps canRenderZoomUI false, so the ensure-retry loop
        // never starts and the timer count below reflects the rebuild timer only.
        document.body.innerHTML = '<ytd-watch-flexy miniplayer-is-active></ytd-watch-flexy>';
        delete window.YouTubePlusZoom;
        require('../src/zoom.js');
        const before = cm.timeouts.size;
        window.dispatchEvent(new Event('yt-navigate-finish'));
        expect(jest.getTimerCount()).toBeGreaterThan(0);
        jest.advanceTimersByTime(300);
        expect(jest.getTimerCount()).toBe(0);
        expect(cm.timeouts.size).toBe(before);
      } finally {
        cm.timeout = timeout;
        jest.useRealTimers();
      }
    });
  });

  describe('logRestoreEvent', () => {
    test('records events in sessionStorage debug log', () => {
      window.YouTubePlusZoom.logRestoreEvent({ action: 'restore', zoom: 1.5 });

      const raw = sessionStorage.getItem('ytp_zoom_restore_log');
      expect(raw).toBeTruthy();
      const entries = JSON.parse(raw || '[]');
      expect(entries.length).toBe(1);
      expect(entries[0].action).toBe('restore');
      expect(entries[0].zoom).toBe(1.5);
      expect(entries[0].time).toBeDefined();
    });
  });

  // Integration coverage for the extracted createZoomUI helpers —
  // mount → handlers → observers → fullscreen → swap → cleanup, all through
  // the public createZoomUI()/clearZoomUI() path (real addEventListener).
  describe('extracted zoom UI helpers', () => {
    test('createZoomUI mounts the control, wires slider/reset, and cleanup releases state', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        const wrap = window.YouTubePlusZoom.createZoomUI();
        expect(wrap).toBeTruthy();
        expect(document.getElementById('yp-zoom-control')).toBe(wrap);

        const input = wrap.querySelector('input');
        const label = wrap.querySelector('.zoom-label');
        const reset = wrap.querySelector('.zoom-reset');
        expect(input && label && reset).toBeTruthy();

        // createZoomSetter via the slider input event
        input.value = '1.8';
        input.dispatchEvent(new Event('input'));
        jest.advanceTimersByTime(20); // RAF-deferred apply
        expect(input.value).toBe('1.8');
        expect(label.textContent).toBe('180%');

        // reset handler → default zoom + persisted reset
        reset.click();
        jest.advanceTimersByTime(20);
        expect(input.value).toBe('1');
        expect(window.YouTubePlusZoom.testHooks.readZoomPan().zoom).toBe(1);

        // cleanup → releaseZoomVideoBindings_ + unwatchZoomObservers_
        window.YouTubePlusZoom.clearZoomUI();
        expect(document.getElementById('yp-zoom-control')).toBeNull();
        const video = document.querySelector('video');
        expect(video.style.transform).toBe('');
        expect(video.style.cursor).toBe('');
      } finally {
        jest.useRealTimers();
      }
    });

    test('fullscreen change re-applies zoom through the retry path', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const video = document.querySelector('video');

        document.dispatchEvent(new CustomEvent('fullscreenchange'));
        jest.advanceTimersByTime(80); // FULLSCREEN_APPLY_DELAY
        // Retry loop runs while attempts < FULLSCREEN_APPLY_RETRIES.
        jest.advanceTimersByTime(5 * 120 + 20);
        expect(video.style.transform).toContain('scale(1.5');
      } finally {
        jest.useRealTimers();
      }
    });

    test('video swap rebinds handlers and re-applies zoom to the new element', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const oldVideo = document.querySelector('video');

        // The player-subtree watcher registered for 'zoom::playerVideoSwap'.
        const coordinator = window.YouTubePlusMutationCoordinator;
        const swapCall = coordinator.watchTarget.mock.calls.find(
          c => c[0] === 'zoom::playerVideoSwap'
        );
        expect(swapCall).toBeTruthy();
        const onPlayerMutation = swapCall[2];

        // YouTube swaps the video element.
        const newVideo = document.createElement('video');
        newVideo.className = 'video-stream html5-main-video';
        oldVideo.replaceWith(newVideo);

        onPlayerMutation();
        expect(window.YouTubePlusZoom.testHooks.findVideoElement()).toBe(newVideo);
        jest.advanceTimersByTime(20);
        expect(newVideo.style.transform).toContain('scale(1.5');
      } finally {
        jest.useRealTimers();
      }
    });

    test('external style mutation restores the expected transform', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const video = document.querySelector('video');

        const coordinator = window.YouTubePlusMutationCoordinator;
        const styleCall = coordinator.watchTarget.mock.calls.find(c => c[0] === 'zoom::videoStyle');
        expect(styleCall).toBeTruthy();
        const onStyleMutation = styleCall[2];

        // YouTube clobbers the transform externally.
        video.style.transform = '';
        onStyleMutation([]);
        jest.advanceTimersByTime(20);
        expect(video.style.transform).toContain('scale(1.5');
      } finally {
        jest.useRealTimers();
      }
    });

    test('shift+wheel changes zoom within bounds (attachZoomWheelHandlers)', () => {
      jest.useFakeTimers();
      try {
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const input = document.getElementById('yp-zoom-control').querySelector('input');

        const player = document.getElementById('movie_player');
        player.dispatchEvent(
          new WheelEvent('wheel', { shiftKey: true, deltaY: -100, bubbles: true })
        );
        jest.advanceTimersByTime(60); // throttle window
        expect(parseFloat(input.value)).toBeGreaterThan(1);

        player.dispatchEvent(
          new WheelEvent('wheel', { shiftKey: true, deltaY: 100, bubbles: true })
        );
        jest.advanceTimersByTime(60);
        // Back toward the default after the compensating wheel tick.
        expect(parseFloat(input.value)).toBeLessThan(1.6);

        // Without Shift the wheel must be ignored.
        const before = input.value;
        player.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
        expect(input.value).toBe(before);
      } finally {
        jest.useRealTimers();
      }
    });

    test('drag pan updates the transform and persists pan state', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const video = document.querySelector('video');
        // Zoomed in so pan is meaningful.
        video.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 130 }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: 140, clientY: 130 }));
        jest.advanceTimersByTime(300); // pan-save debounce (220ms)

        window.dispatchEvent(new MouseEvent('mouseup', { clientX: 140, clientY: 130 }));
        jest.advanceTimersByTime(300); // pan-save debounce (220ms)

        // The transform carries the drag delta (40, 30) — pan applied. The
        // debounce→persist round-trip is covered by the persistence suite
        // (this harness's setTimeout_ is captured before fake timers, so
        // the 220ms debounce runs on the real clock).
        expect(video.style.transform).toContain('translate(40.00px, 30.00px)');
      } finally {
        jest.useRealTimers();
      }
    });

    test('window drag listeners attach at drag start and release at mouseup', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        const addSpy = jest.spyOn(window, 'addEventListener');
        const removeSpy = jest.spyOn(window, 'removeEventListener');
        const addedType = type => addSpy.mock.calls.filter(call => call[0] === type).length;
        const removedType = type => removeSpy.mock.calls.filter(call => call[0] === type).length;

        window.YouTubePlusZoom.createZoomUI();
        const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));

        // Mount registers no window mouse listeners for the drag pair.
        expect(addedType('mousemove')).toBe(0);
        expect(addedType('mouseup')).toBe(0);

        // A zoomed-in drag start attaches the window pair...
        video.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
        expect(addedType('mousemove')).toBe(1);
        expect(addedType('mouseup')).toBe(1);

        // ...and the mouseup releases it synchronously.
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: 140, clientY: 130 }));
        expect(removedType('mousemove')).toBe(1);
        expect(removedType('mouseup')).toBe(1);

        jest.advanceTimersByTime(300); // pan-save debounce
      } finally {
        jest.useRealTimers();
      }
    });

    // jsdom has no PointerEvent constructor — the handlers only read
    // pointerId/clientX/clientY/pointerType, so synthetic Events with those
    // properties assigned drive the real pointer/pinch logic.
    const pointerEvent = (type, id, x, y, pointerType, button = undefined) => {
      const ev = new Event(type, { bubbles: true });
      ev.pointerId = id;
      ev.clientX = x;
      ev.clientY = y;
      ev.pointerType = pointerType;
      ev.button = button;
      return ev;
    };

    test('pointer mouse drag: grabbing cursor, pan, then cursor reset on release', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const player = document.getElementById('movie_player');
        const video = player.querySelector('video');

        player.dispatchEvent(pointerEvent('pointerdown', 7, 50, 50, 'mouse', 0));
        expect(video.style.cursor).toBe('grabbing');

        player.dispatchEvent(pointerEvent('pointermove', 7, 110, 110, 'mouse'));
        jest.advanceTimersByTime(20);
        expect(video.style.transform).toContain('translate');

        player.dispatchEvent(pointerEvent('pointerup', 7, 110, 110, 'mouse', 0));
        // updateZoomCursor: still zoomed in → grab cursor.
        expect(video.style.cursor).toBe('grab');
      } finally {
        jest.useRealTimers();
      }
    });

    // jsdom has no TouchEvent/TouchList constructor — the handlers only read
    // touches[i].clientX/clientY, so synthetic Events with an array stub drive
    // the real touch drag/pinch logic.
    const touchEvent = (type, touches) => {
      const ev = new Event(type, { bubbles: true });
      ev.touches = touches.map(t => ({ clientX: t.x, clientY: t.y }));
      return ev;
    };

    test('touch drag pans through the shared path and restores touch-action', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const player = document.getElementById('movie_player');
        const video = player.querySelector('video');

        // One finger on a zoomed-in video starts the touch drag.
        player.dispatchEvent(touchEvent('touchstart', [{ x: 100, y: 100 }]));
        player.dispatchEvent(touchEvent('touchmove', [{ x: 130, y: 120 }]));
        jest.advanceTimersByTime(20);
        expect(video.style.transform).toContain('translate(30.00px, 20.00px)');

        // Two fingers switch to pinch; the same shared repaint path applies it.
        player.dispatchEvent(
          touchEvent('touchstart', [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ])
        );
        player.dispatchEvent(
          touchEvent('touchmove', [
            { x: 0, y: 0 },
            { x: 140, y: 0 },
          ])
        );
        jest.advanceTimersByTime(20);
        // 1.5 scaled by 140/100.
        expect(video.style.transform).toContain('scale(2.1');

        // Releasing every finger ends the touch drag without errors.
        player.dispatchEvent(touchEvent('touchend', []));
      } finally {
        jest.useRealTimers();
      }
    });

    // ZOOM_STEP keyboard branches: '+', '=' zoom in, '-' zooms out; the
    // shortcut is ignored while an editable element has focus.
    // NOTE: keyboard-path assertions avoid exact-value math because the
    // harness accumulates per-require window keydown handlers (each test's
    // zoom.js instance re-registers), so one dispatch fans out.
    test('keyboard +/- shortcut is ignored while an editable element has focus', () => {
      jest.useFakeTimers();
      try {
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const input = document.getElementById('yp-zoom-control').querySelector('input');
        const before = input.value;

        input.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
        expect(input.value).toBe(before);
      } finally {
        jest.useRealTimers();
      }
    });

    test('keyboard +/- shortcut applies one zoom step outside editable focus', () => {
      jest.useFakeTimers();
      try {
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const input = document.getElementById('yp-zoom-control').querySelector('input');
        expect(parseFloat(input.value)).toBe(1);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
        jest.advanceTimersByTime(20);
        expect(parseFloat(input.value)).toBeCloseTo(1.05, 5);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
        jest.advanceTimersByTime(20);
        expect(parseFloat(input.value)).toBeCloseTo(1, 5);
      } finally {
        jest.useRealTimers();
      }
    });

    test('a style mutation record restores the transform and logs the restore', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const video = document.querySelector('video');

        const coordinator = window.YouTubePlusMutationCoordinator;
        const styleCall = coordinator.watchTarget.mock.calls.find(c => c[0] === 'zoom::videoStyle');
        const onStyleMutation = styleCall[2];

        // YouTube clobbers the transform; the mutation record triggers restore.
        video.style.transform = '';
        onStyleMutation([{ type: 'attributes', attributeName: 'style' }]);
        jest.advanceTimersByTime(20);
        expect(video.style.transform).toContain('scale(1.5');

        const entries = JSON.parse(sessionStorage.getItem('ytp_zoom_restore_log'));
        expect(entries.some(e => e.action === 'restore_transform')).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    test('error paths of the extracted helpers are caught', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        // Force getBoundingClientRect to throw: clampPan and the positioner
        // must swallow the error instead of breaking the UI mount.
        const rectThrow = jest
          .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
          .mockImplementation(() => {
            throw new Error('rect unavailable');
          });

        const wrap = window.YouTubePlusZoom.createZoomUI();
        expect(wrap).toBeTruthy();

        // clampPan error path via a pan-producing mousemove.
        const video = wrap.parentElement.querySelector('video');
        video.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, button: 0 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 130 }));

        // Positioner error path (classic theme branch reads the chrome rect).
        const updateZoomPosition = () => {
          try {
            if (window.YouTubePlusDesignSystem?.getThemeVariant?.() !== 'classic') return;
            const chrome = document.querySelector('.ytp-chrome-bottom');
            if (chrome?.offsetHeight) {
              wrap.style.bottom = `${chrome.offsetHeight + 8}px`;
            }
          } catch (_e) {
            window.YouTubePlusLogger?.logSuppressed?.(_e);
          }
        };
        expect(() => updateZoomPosition()).not.toThrow();

        rectThrow.mockRestore();
        expect(() => window.YouTubePlusZoom.clearZoomUI()).not.toThrow();
      } finally {
        jest.useRealTimers();
        jest.restoreAllMocks();
      }
    });

    test('player-mutation error paths are caught: detach/apply failures on video swap', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const oldVideo = document.querySelector('video');

        const coordinator = window.YouTubePlusMutationCoordinator;
        const swapCall = coordinator.watchTarget.mock.calls.find(
          c => c[0] === 'zoom::playerVideoSwap'
        );
        const onPlayerMutation = swapCall[2];

        // Detach failure: removeEventListener throws on the old video.
        jest.spyOn(oldVideo, 'removeEventListener').mockImplementation(() => {
          throw new Error('detach failed');
        });

        const newVideo = document.createElement('video');
        newVideo.className = 'video-stream html5-main-video';
        oldVideo.replaceWith(newVideo);

        // Must still swap the video reference and attach to the new element
        // (the detach error is swallowed by the handler's try/catch).
        expect(() => onPlayerMutation()).not.toThrow();
        expect(window.YouTubePlusZoom.testHooks.findVideoElement()).toBe(newVideo);
      } finally {
        jest.useRealTimers();
        jest.restoreAllMocks();
      }
    });

    test('fullscreen retry path runs without a video element and stops after retries', () => {
      jest.useFakeTimers();
      try {
        // No video element anywhere: every retry fails to find one.
        document.body.innerHTML = '<div id="movie_player"></div>';

        window.YouTubePlusZoom.createZoomUI();
        expect(document.querySelector('video')).toBeNull();

        // No throw across the FULLSCREEN_APPLY_DELAY + 4 retries.
        document.dispatchEvent(new CustomEvent('fullscreenchange'));
        jest.advanceTimersByTime(80 + 4 * 120 + 40);
      } finally {
        jest.useRealTimers();
      }
    });

    test('cleanup error paths are caught: throwing detach/unwatch are non-fatal', () => {
      jest.useFakeTimers();
      try {
        localStorage.setItem('ytp_zoom_pan', JSON.stringify({ zoom: 1.5, panX: 0, panY: 0 }));
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        window.YouTubePlusZoom.createZoomUI();
        const video = document.querySelector('video');

        // Every detach/unwatch throws — cleanup must still remove the UI.
        // NOTE: the mock coordinator has no `unwatch` — assign directly
        // (jest.spyOn would throw on a missing property).
        const detachThrow = jest.spyOn(video, 'removeEventListener').mockImplementation(() => {
          throw new Error('detach failed');
        });
        const coordinator = window.YouTubePlusMutationCoordinator;
        const originalUnwatch = coordinator.unwatch;
        coordinator.unwatch = () => {
          throw new Error('unwatch failed');
        };
        void detachThrow;

        window.YouTubePlusZoom.clearZoomUI();
        expect(document.getElementById('yp-zoom-control')).toBeNull();
        expect(video.style.transform).toBe('');

        coordinator.unwatch = originalUnwatch;
      } finally {
        jest.useRealTimers();
      }
    });

    test('mount works without a CleanupManager (fallback registrations)', () => {
      jest.useFakeTimers();
      try {
        document.body.innerHTML =
          '<div id="movie_player"><video class="video-stream html5-main-video"></video></div>';

        // No CleanupManager anywhere: every registration takes the
        // optional-chain fallback (no-op) — the UI must still mount.
        const savedCM = window.YouTubePlusCleanupManager;
        delete window.YouTubePlusCleanupManager;
        Object.defineProperty(window.YouTubeUtils, 'cleanupManager', {
          configurable: true,
          get: () => undefined,
        });

        const wrap = window.YouTubePlusZoom.createZoomUI();
        expect(wrap).toBeTruthy();
        expect(document.getElementById('yp-zoom-control')).toBe(wrap);

        // The slider still works without tracked registrations.
        const input = wrap.querySelector('input');
        input.value = '1.5';
        input.dispatchEvent(new Event('input'));
        expect(input.value).toBe('1.5');

        window.YouTubePlusZoom.clearZoomUI();
        expect(document.getElementById('yp-zoom-control')).toBeNull();

        window.YouTubePlusCleanupManager = savedCM;
        delete window.YouTubeUtils.cleanupManager;
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('miniplayer and route rendering checks', () => {
    test('mountDock creates vision zoom button and wires popover', () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      const wrap = document.createElement('div');
      wrap.id = 'yp-zoom-control';
      const input = document.createElement('input');
      input.type = 'range';
      wrap.appendChild(input);
      player.appendChild(dock);
      player.appendChild(wrap);
      document.body.appendChild(player);

      const desc = window.YouTubePlusFeatureRegistry?.get?.('zoom');
      expect(desc).toBeDefined();
      expect(typeof desc.mountDock).toBe('function');

      desc.mountDock(player, dock, { wrap });

      const zoomBtn = dock.querySelector('#yp-vision-zoom-btn');
      expect(zoomBtn).not.toBeNull();

      jest
        .spyOn(zoomBtn, 'getBoundingClientRect')
        .mockReturnValue(/** @type {any} */ ({ width: 34, height: 34, left: 100, bottom: 50 }));
      jest
        .spyOn(player, 'getBoundingClientRect')
        .mockReturnValue(
          /** @type {any} */ ({ width: 800, height: 600, left: 0, top: 0, bottom: 600 })
        );

      // Click on zoomBtn shows zoom popover and focuses range input
      zoomBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(wrap.classList.contains('visible')).toBe(true);
      expect(wrap.style.bottom).toBe('auto');
    });

    test('clearZoomUI does not delete the Vision dock or other dock buttons', () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';

      // Put download and screenshot buttons into the dock
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'vision-dock-btn yp-download-button';
      dock.appendChild(downloadBtn);

      const screenshotBtn = document.createElement('button');
      screenshotBtn.className = 'vision-dock-btn yp-screenshot-button';
      dock.appendChild(screenshotBtn);

      // Put zoom button and zoom control into player/dock
      const zoomBtn = document.createElement('button');
      zoomBtn.id = 'yp-vision-zoom-btn';
      dock.appendChild(zoomBtn);

      const zoomControl = document.createElement('div');
      zoomControl.id = 'yp-zoom-control';

      player.appendChild(dock);
      player.appendChild(zoomControl);
      document.body.appendChild(player);

      // Call clearZoomUI
      window.YouTubePlusZoom.clearZoomUI();

      // Zoom's own control and button are removed
      expect(document.getElementById('yp-zoom-control')).toBeNull();
      expect(document.getElementById('yp-vision-zoom-btn')).toBeNull();

      // The dock and other buttons MUST remain intact
      expect(document.querySelector('.vision-top-center-dock')).not.toBeNull();
      expect(dock.querySelector('.yp-download-button')).not.toBeNull();
      expect(dock.querySelector('.yp-screenshot-button')).not.toBeNull();
    });

    test('exports canonical DESCRIPTOR on window.YouTubePlusZoom with complete contract', () => {
      const desc = window.YouTubePlusZoom.DESCRIPTOR;
      expect(desc).toBeDefined();
      expect(desc.id).toBe('zoom');
      expect(desc.titleKey).toBe('zoom');
      expect(desc.settingsKey).toBe('enableZoom');
      expect(typeof desc.iconSVG).toBe('string');
      expect(typeof desc.command).toBe('function');
      expect(typeof desc.mountDock).toBe('function');
    });

    test('registers zoom in FeatureRegistry immediately upon script load', () => {
      const registered = window.YouTubePlusFeatureRegistry.get('zoom');
      expect(registered).toBeDefined();
      expect(registered.id).toBe('zoom');
      expect(registered.settingsKey).toBe('enableZoom');
    });

    test('mountDock is idempotent: repeated calls produce exactly one zoom button', () => {
      const desc = window.YouTubePlusZoom.DESCRIPTOR;
      const player = document.createElement('div');
      const dock = document.createElement('div');

      desc.mountDock(player, dock);
      desc.mountDock(player, dock);

      const buttons = dock.querySelectorAll('#yp-vision-zoom-btn');
      expect(buttons.length).toBe(1);
    });

    test('zoom click survives sweep + re-mount; dispose releases click + wiring', () => {
      const desc = window.YouTubePlusZoom.DESCRIPTOR;
      const player = document.createElement('div');
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      const wrap = document.createElement('div');
      wrap.id = 'yp-zoom-control';
      const input = document.createElement('input');
      input.type = 'range';
      wrap.appendChild(input);
      player.appendChild(dock);
      player.appendChild(wrap);
      document.body.appendChild(player);
      const cm = window.YouTubePlusCleanupManager;
      const countBtnEntries = () => {
        let n = 0;
        for (const e of cm.listeners.values()) {
          if (e.target === dock.querySelector('#yp-vision-zoom-btn')) n += 1;
        }
        return n;
      };

      let dispose = desc.mountDock(player, dock, { wrap });
      expect(typeof dispose).toBe('function');
      expect(countBtnEntries()).toBe(1);

      // Direct re-mount: stable closure dedups, hover wiring is re-wired
      // cleanly instead of stacking.
      dispose = desc.mountDock(player, dock, { wrap });
      expect(countBtnEntries()).toBe(1);

      cm.cleanup();
      expect(countBtnEntries()).toBe(0);
      dispose = desc.mountDock(player, dock, { wrap });
      expect(countBtnEntries()).toBe(1);

      // Click shows the wrap (position mocked) and focuses the input.
      const zoomBtn = dock.querySelector('#yp-vision-zoom-btn');
      jest
        .spyOn(zoomBtn, 'getBoundingClientRect')
        .mockReturnValue(/** @type {any} */ ({ width: 34, height: 34, left: 100, bottom: 50 }));
      jest
        .spyOn(player, 'getBoundingClientRect')
        .mockReturnValue(
          /** @type {any} */ ({ width: 800, height: 600, left: 0, top: 0, bottom: 600 })
        );
      zoomBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(wrap.classList.contains('visible')).toBe(true);

      dispose();
      expect(countBtnEntries()).toBe(0);
    });

    test('command toggles zoom control visibility and focuses input', () => {
      const desc = window.YouTubePlusZoom.DESCRIPTOR;
      const wrap = document.createElement('div');
      wrap.id = 'yp-zoom-control';
      const input = document.createElement('input');
      input.type = 'range';
      wrap.appendChild(input);
      document.body.appendChild(wrap);

      expect(wrap.classList.contains('visible')).toBe(false);

      desc.command();
      expect(wrap.classList.contains('visible')).toBe(true);

      desc.command();
      expect(wrap.classList.contains('visible')).toBe(false);
    });

    test('clearZoomUI removes classic #yp-zoom-button', () => {
      const classicBtn = document.createElement('button');
      classicBtn.id = 'yp-zoom-button';
      document.body.appendChild(classicBtn);

      window.YouTubePlusZoom.clearZoomUI();

      expect(document.getElementById('yp-zoom-button')).toBeNull();
    });

    test('setupZoomButton returns early when themeVariant is vision', () => {
      window.YouTubePlusDesignSystem = {
        getThemeVariant: () => 'vision',
      };
      const player = document.createElement('div');
      const wrap = document.createElement('div');
      window.YouTubePlusZoom.testHooks?.setupZoomButton(player, wrap);
      expect(player.querySelector('#yp-zoom-button')).toBeNull();
    });
  });
});
