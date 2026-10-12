/**
 * @jest-environment jsdom
 *
 * Tests exercise the real speedcontrol.js module through
 * window.YouTubePlusSpeedControl. Earlier versions of this file tested locally
 * reimplemented helpers and assigned a mock API; now the assertions use the
 * real exported functions.
 */

const setupSpeedDeps = () => {
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      $: jest.fn((sel, ctx = document) => (ctx || document).querySelector(sel)),
      $$: jest.fn((sel, ctx = document) => Array.from((ctx || document).querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      cleanupManager: {
        registerInterval: jest.fn(id => id),
        registerTimeout: jest.fn(id => id),
        registerObserver: jest.fn(obs => obs),
        registerListener: jest.fn((target, event, fn, options) => {
          target.addEventListener(event, fn, options);
          return Symbol('listener');
        }),
        unregisterListener: jest.fn(key => key),
        register: jest.fn(),
        cleanup: jest.fn(),
        registerAnimationFrame: jest.fn(id => id),
        getListenerStats: jest.fn(() => ({ active: 0, registeredTotal: 0 })),
      },
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      loadFeatureEnabled: jest.fn(() => true),
      getRoute: jest.fn(() => 'watch'),
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
      logSuppressed: jest.fn(),
      storage: {
        get: (key, def = null) => {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : def;
        },
        set: (key, val) => {
          localStorage.setItem(key, JSON.stringify(val));
          return true;
        },
        remove: key => localStorage.removeItem(key),
        has: key => localStorage.getItem(key) !== null,
        getItem: key => localStorage.getItem(key),
        setItem: (key, val) => {
          localStorage.setItem(key, val);
          return true;
        },
        removeItem: key => localStorage.removeItem(key),
      },
    },
  });

  Object.defineProperty(window, 'YouTubePlusLogger', {
    configurable: true,
    writable: true,
    value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });

  Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
    configurable: true,
    writable: true,
    value: {
      subscribeRoot: jest.fn(),
      unsubscribe: jest.fn(),
      watchTarget: jest.fn(() => 'watch-id'),
      unwatch: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      StyleManager: window.YouTubeUtils.StyleManager,
      getStyle: jest.fn(() => ''),
    },
  });

  Object.defineProperty(window, 'YouTubePlusSettingsStore', {
    configurable: true,
    writable: true,
    value: {
      get: jest.fn((path, fallback) => {
        if (path === 'speedControlHotkeys') {
          return { decrease: 'g', increase: 'h', reset: 'b' };
        }
        return fallback;
      }),
      set: jest.fn(),
      load: jest.fn(() => ({ speedControlHotkeys: { decrease: 'g', increase: 'h', reset: 'b' } })),
    },
  });

  Object.defineProperty(window, 'YouTubePlusDOMCache', {
    configurable: true,
    writable: true,
    value: {
      getAll: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
    },
  });

  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    href: 'https://www.youtube.com/watch?v=test',
  });
};

/** @returns {any} */
const createEnhancer = () => ({
  speedControl: {
    currentSpeed: 1,
    availableSpeeds: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3],
    storageKey: 'youtube_playback_speed',
  },
  getElement: () => null,
  settings: {
    enableSpeedControl: true,
    speedControlHotkeys: { decrease: 'g', increase: 'h', reset: 'b' },
  },
  isEditableTarget: () => false,
});

describe('Speed Control Module', () => {
  beforeEach(() => {
    jest.resetModules();
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    delete window.YouTubePlusFeatureRegistry;
    setupSpeedDeps();
    localStorage.clear();
    // The module runs as a lifecycle feature: the real registry starts it.
    require('../src/feature-registry.js');
    require('../src/speedcontrol.js');
  });

  afterEach(() => {
    // Stop the feature so its listeners do not leak into the next test.
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  });

  describe('Real module API', () => {
    test('real speedcontrol exposes window.YouTubePlusSpeedControl', () => {
      expect(window.YouTubePlusSpeedControl).toBeDefined();
      expect(typeof window.YouTubePlusSpeedControl.changeSpeed).toBe('function');
      expect(typeof window.YouTubePlusSpeedControl.adjustSpeedByStep).toBe('function');
      expect(typeof window.YouTubePlusSpeedControl.applyCurrentSpeed).toBe('function');
      expect(typeof window.YouTubePlusSpeedControl.showSpeedIndicator).toBe('function');
      expect(typeof window.YouTubePlusSpeedControl.registerHotkeys).toBe('function');
    });

    test('the module loads without a logger on YouTubeUtils or the window', () => {
      delete window.YouTubeUtils.logger;
      delete window.YouTubePlusLogger;
      jest.resetModules();
      require('../src/speedcontrol.js');
      expect(window.YouTubePlusSpeedControl).toBeDefined();
    });

    test('restore() survives a storage read that throws', () => {
      window.YouTubeUtils.storage.getItem = () => {
        throw new Error('storage unavailable');
      };
      expect(() => window.YouTubePlusSpeedControl.restore()).not.toThrow();
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    });

    test('real changeSpeed updates currentSpeed and persists to localStorage', () => {
      const enhancer = createEnhancer();
      window.YouTubePlusSpeedControl.changeSpeed(enhancer, 1.5);

      expect(enhancer.speedControl.currentSpeed).toBe(1.5);
      expect(localStorage.getItem('youtube_playback_speed')).toBe('1.5');
    });

    test('real adjustSpeedByStep increases speed by one step', () => {
      const enhancer = createEnhancer();
      window.YouTubePlusSpeedControl.adjustSpeedByStep(enhancer, 1);

      expect(enhancer.speedControl.currentSpeed).toBe(1.25);
      expect(localStorage.getItem('youtube_playback_speed')).toBe('1.25');
    });

    test('real adjustSpeedByStep decreases speed by one step', () => {
      const enhancer = createEnhancer();
      window.YouTubePlusSpeedControl.adjustSpeedByStep(enhancer, -1);

      expect(enhancer.speedControl.currentSpeed).toBe(0.75);
      expect(localStorage.getItem('youtube_playback_speed')).toBe('0.75');
    });

    test('real adjustSpeedByStep clamps at minimum speed', () => {
      const enhancer = createEnhancer();
      window.YouTubePlusSpeedControl.changeSpeed(enhancer, 0.25);
      window.YouTubePlusSpeedControl.adjustSpeedByStep(enhancer, -1);

      expect(enhancer.speedControl.currentSpeed).toBe(0.25);
      expect(localStorage.getItem('youtube_playback_speed')).toBe('0.25');
    });

    test('real adjustSpeedByStep clamps at maximum speed', () => {
      const enhancer = createEnhancer();
      window.YouTubePlusSpeedControl.changeSpeed(enhancer, 3);
      window.YouTubePlusSpeedControl.adjustSpeedByStep(enhancer, 1);

      expect(enhancer.speedControl.currentSpeed).toBe(3);
      expect(localStorage.getItem('youtube_playback_speed')).toBe('3');
    });

    test('real applyCurrentSpeed sets playbackRate on matching video elements', () => {
      const video = document.createElement('video');
      video.playbackRate = 1;
      document.body.appendChild(video);

      const enhancer = createEnhancer();
      // The speed value is owned by the Speed Control module —
      // tests route changes through the owner command (changeSpeed), the
      // enhancer copy is a read-through mirror only.
      window.YouTubePlusSpeedControl.changeSpeed(enhancer, 1.5);
      window.YouTubePlusSpeedControl.applyCurrentSpeed(enhancer);

      expect(video.playbackRate).toBe(1.5);
      expect(enhancer.speedControl.currentSpeed).toBe(1.5);
      video.remove();
    });
  });

  describe('Speed state management', () => {
    test('available speeds include common values', () => {
      const availableSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
      expect(availableSpeeds).toContain(1);
      expect(availableSpeeds).toContain(2);
    });

    test('real changeSpeed persists the default 1x speed', () => {
      const enhancer = createEnhancer();
      window.YouTubePlusSpeedControl.changeSpeed(enhancer, 1);
      expect(localStorage.getItem('youtube_playback_speed')).toBe('1');
    });
  });

  describe('Video element interaction', () => {
    test('real applyCurrentSpeed sets playbackRate on video element', () => {
      document.body.innerHTML = '<video id="movie_player"></video>';
      const video = /** @type {HTMLVideoElement} */ (document.getElementById('movie_player'));

      const enhancer = createEnhancer();
      window.YouTubePlusSpeedControl.changeSpeed(enhancer, 1.5);
      window.YouTubePlusSpeedControl.applyCurrentSpeed(enhancer);

      expect(video.playbackRate).toBe(1.5);
    });

    test('handles multiple video elements', () => {
      document.body.innerHTML = '<video class="vid"></video><video class="vid"></video>';
      const videos = document.querySelectorAll('video');

      const enhancer = createEnhancer();
      window.YouTubePlusSpeedControl.changeSpeed(enhancer, 2);
      window.YouTubePlusSpeedControl.applyCurrentSpeed(enhancer);

      expect(videos[0].playbackRate).toBe(2);
      expect(videos[1].playbackRate).toBe(2);
    });
  });

  describe('Speed ownership invariant', () => {
    test('external playbackRate change snaps back to the owned speed unless the mouse button is held', () => {
      const enhancer = createEnhancer();
      const video = /** @type {HTMLVideoElement} */ (document.createElement('video'));
      document.body.appendChild(video);

      window.YouTubePlusSpeedControl.setupVideoObserver(enhancer);
      window.YouTubePlusSpeedControl.changeSpeed(enhancer, 1.5);
      expect(video.playbackRate).toBe(1.5);

      // Player-side rate changes are corrected on the next ratechange event.
      video.playbackRate = 2.5;
      video.dispatchEvent(new Event('ratechange'));
      expect(video.playbackRate).toBe(1.5);

      // Hold-to-speed: while the left button is held, the external value wins.
      document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      video.playbackRate = 2.5;
      video.dispatchEvent(new Event('ratechange'));
      expect(video.playbackRate).toBe(2.5);

      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      video.dispatchEvent(new Event('ratechange'));
      expect(video.playbackRate).toBe(1.5);
    });

    test('the player hold boost survives while Space is held, and the owner speed returns on release', () => {
      const enhancer = createEnhancer();
      const video = /** @type {HTMLVideoElement} */ (document.createElement('video'));
      document.body.appendChild(video);

      window.YouTubePlusSpeedControl.setupVideoObserver(enhancer);
      window.YouTubePlusSpeedControl.changeSpeed(enhancer, 1);
      expect(video.playbackRate).toBe(1);

      // The player raises the rate on its own when Space goes down.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }));
      video.playbackRate = 2;
      video.dispatchEvent(new Event('ratechange'));
      expect(video.playbackRate).toBe(2);

      // With no ratechange after the release (the player restored nothing),
      // releasing the key must still return the owned speed.
      document.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space' }));
      expect(video.playbackRate).toBe(1);

      // Outside a hold the ownership invariant is unchanged.
      video.playbackRate = 2;
      video.dispatchEvent(new Event('ratechange'));
      expect(video.playbackRate).toBe(1);
    });

    test('a speed option applies even when the dropdown was built from a different enhancer', () => {
      // The Classic button can mount before basic.js hands over its enhancer,
      // so the shared dropdown may be built from the fallback enhancer while
      // the video-ownership listener captured the real one. The applied speed
      // must still stick instead of snapping back to the other enhancer's value.
      const videoEnhancer = createEnhancer();
      const video = /** @type {HTMLVideoElement} */ (document.createElement('video'));
      document.body.appendChild(video);
      window.YouTubePlusSpeedControl.setupVideoObserver(videoEnhancer);

      const desc = window.YouTubePlusSpeedControl.DESCRIPTOR;
      desc.command(createEnhancer()); // dropdown built from a distinct enhancer
      const opts = /** @type {HTMLElement} */ (document.querySelector('.speed-options'));
      const item = /** @type {HTMLElement} */ (
        opts.querySelector('.speed-option-item[data-speed="3"]')
      );
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(video.playbackRate).toBe(3);
      video.dispatchEvent(new Event('ratechange'));
      expect(video.playbackRate).toBe(3);
      opts.remove();
    });

    test('mounted controls re-label from the owner state after a later restore', () => {
      const controls = document.createElement('div');
      controls.className = 'ytp-right-controls';
      document.body.appendChild(controls);
      const enhancer = createEnhancer();
      window.YouTubePlusSpeedControl.addButton(enhancer, controls);
      const btn = /** @type {HTMLElement} */ (controls.querySelector('.speed-control-btn'));

      // basic.js restores the persisted speed after the button already mounted.
      // The applied owner speed must be reflected on the control surface.
      window.YouTubePlusSpeedControl.setSpeed(2);
      window.YouTubePlusSpeedControl.applyCurrentSpeed(enhancer);
      expect(btn.textContent).toBe('2x');

      controls.remove();
    });
  });

  describe('Speed indicator', () => {
    test('real showSpeedIndicator creates a visible indicator', () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      document.body.appendChild(player);

      const enhancer = createEnhancer();
      window.YouTubePlusSpeedControl.showSpeedIndicator(enhancer, 1.5);

      const indicator = document.getElementById('speed-indicator');
      expect(indicator).toBeTruthy();
      expect(indicator.textContent).toBe('1.5x');
      expect(indicator.style.display).toBe('block');

      player.remove();
    });
  });

  describe('Hotkey registration', () => {
    const press = (key, extra = {}) =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }));

    const speedKeydownEntries = () =>
      [...window.YouTubePlusCleanupManager.listeners.values()].filter(
        e => e.target === document && e.ev === 'keydown' && e.capture === true && e.persistent
      );

    test('the running feature owns exactly one document hotkey listener', () => {
      expect(speedKeydownEntries()).toHaveLength(1);
      window.YouTubePlusSpeedControl.registerHotkeys(createEnhancer());
      expect(speedKeydownEntries()).toHaveLength(1);
    });

    test('pressing h increases speed', () => {
      window.YouTubePlusSpeedControl.registerHotkeys(createEnhancer());
      press('h');
      expect(localStorage.getItem('youtube_playback_speed')).toBe('1.25');
    });

    test('pressing g decreases speed', () => {
      window.YouTubePlusSpeedControl.registerHotkeys(createEnhancer());
      press('g');
      expect(localStorage.getItem('youtube_playback_speed')).toBe('0.75');
    });

    test('pressing b resets speed', () => {
      const enhancer = createEnhancer();
      enhancer.speedControl.currentSpeed = 2;
      window.YouTubePlusSpeedControl.registerHotkeys(enhancer);
      press('b');
      expect(localStorage.getItem('youtube_playback_speed')).toBe('1');
    });

    test('modifier key combos are ignored', () => {
      window.YouTubePlusSpeedControl.registerHotkeys(createEnhancer());
      press('h', { ctrlKey: true });
      expect(localStorage.getItem('youtube_playback_speed')).toBeNull();
    });

    test('keys are ignored while an editable element has focus', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      const enhancer = createEnhancer();
      enhancer.isEditableTarget = el => el === input;
      window.YouTubePlusSpeedControl.registerHotkeys(enhancer);
      press('h');
      expect(localStorage.getItem('youtube_playback_speed')).toBeNull();
      input.remove();
    });

    test('re-registering hotkeys replaces the old listener (SPA navigation)', () => {
      const first = createEnhancer();
      const second = createEnhancer();
      window.YouTubePlusSpeedControl.registerHotkeys(first);
      const count = speedKeydownEntries().length;
      window.YouTubePlusSpeedControl.registerHotkeys(second);
      expect(speedKeydownEntries().length).toBe(count);

      press('h');
      expect(second.speedControl.currentSpeed).toBe(1.25);
      expect(first.speedControl.currentSpeed).toBe(1);
    });

    test('turning the feature off removes the hotkeys', () => {
      window.YouTubePlusSpeedControl.registerHotkeys(createEnhancer());
      const before = speedKeydownEntries().length;
      window.YouTubePlusFeatureRegistry.FeatureLifecycle._reset();
      expect(speedKeydownEntries().length).toBe(before - 1);
      press('h');
      expect(localStorage.getItem('youtube_playback_speed')).toBeNull();
    });
  });

  describe('Style ownership', () => {
    test('speed CSS is added while the feature runs and removed when it stops', () => {
      jest.resetModules();
      window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
      delete window.YouTubePlusFeatureRegistry;
      window.YouTubePlusDesignSystem.getStyle = jest.fn(id =>
        id === 'yp-speedcontrol-styles' ? '.speed-options{}' : ''
      );
      const sm = window.YouTubePlusDesignSystem.StyleManager;
      sm.add.mockClear();
      sm.remove.mockClear();
      require('../src/feature-registry.js');
      require('../src/speedcontrol.js');
      expect(sm.add).toHaveBeenCalledWith('yp-speedcontrol-styles', '.speed-options{}');

      window.YouTubePlusFeatureRegistry.FeatureLifecycle._reset();
      expect(sm.remove).toHaveBeenCalledWith('yp-speedcontrol-styles');
    });
  });

  describe('Refresh visibility', () => {
    test('shows speed controls when enabled via YouTubePlusSpeedControl.refreshVisibility', () => {
      const btn = document.createElement('button');
      btn.className = 'speed-control-btn';
      document.body.appendChild(btn);

      const options = document.createElement('div');
      options.className = 'speed-options visible';
      document.body.appendChild(options);

      window.YouTubePlusSpeedControl.refreshVisibility(true);
      expect(btn.style.display).toBe('');
      expect(options.style.display).toBe('');

      window.YouTubePlusSpeedControl.refreshVisibility(false);
      expect(btn.style.display).toBe('none');
      expect(options.style.display).toBe('none');
      expect(options.classList.contains('visible')).toBe(false);

      btn.remove();
      options.remove();
    });
  });

  describe('Unified Feature Contract', () => {
    test('exposes canonical DESCRIPTOR matching FeatureRegistry schema', () => {
      const desc = window.YouTubePlusSpeedControl.DESCRIPTOR;
      expect(desc).toBeDefined();
      expect(desc.id).toBe('speed');
      expect(desc.settingsKey).toBe('enableSpeedControl');
      expect(desc.titleKey).toBe('speedControl');
      expect(typeof desc.command).toBe('function');
      expect(typeof desc.mountDock).toBe('function');
    });

    test('DESCRIPTOR.command toggles speed options dropdown', () => {
      const desc = window.YouTubePlusSpeedControl.DESCRIPTOR;
      const enhancer = createEnhancer();

      // First call opens dropdown
      const opened = desc.command(enhancer);
      expect(opened).toBe(true);
      const opts = document.querySelector('.speed-options');
      expect(opts).toBeTruthy();
      expect(opts?.classList.contains('visible')).toBe(true);

      // Second call closes dropdown
      const closed = desc.command(enhancer);
      expect(closed).toBe(true);
      expect(opts?.classList.contains('visible')).toBe(false);

      opts?.remove();
    });

    test('clicking a speed option applies it and closes the dropdown', () => {
      const desc = window.YouTubePlusSpeedControl.DESCRIPTOR;
      const enhancer = createEnhancer();
      desc.command(enhancer); // opens the dropdown
      const opts = /** @type {HTMLElement} */ (document.querySelector('.speed-options'));
      const item = /** @type {HTMLElement} */ (
        opts.querySelector('.speed-option-item[data-speed="1.5"]')
      );

      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(enhancer.speedControl.currentSpeed).toBe(1.5);
      expect(opts.classList.contains('visible')).toBe(false);
      opts.remove();
    });

    test('pressing Enter on a focused speed option applies it', () => {
      const desc = window.YouTubePlusSpeedControl.DESCRIPTOR;
      const enhancer = createEnhancer();
      desc.command(enhancer); // opens the dropdown
      const opts = /** @type {HTMLElement} */ (document.querySelector('.speed-options'));
      const item = /** @type {HTMLElement} */ (
        opts.querySelector('.speed-option-item[data-speed="2"]')
      );

      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(enhancer.speedControl.currentSpeed).toBe(2);

      const spaceItem = /** @type {HTMLElement} */ (
        opts.querySelector('.speed-option-item[data-speed="0.5"]')
      );
      spaceItem.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      expect(enhancer.speedControl.currentSpeed).toBe(0.5);
      opts.remove();
    });

    test('the facade setSpeed writes the owner speed without a dropdown', () => {
      const enhancer = createEnhancer();
      const video = document.createElement('video');
      document.body.appendChild(video);

      window.YouTubePlusSpeedControl.setSpeed(1.75);
      window.YouTubePlusSpeedControl.applyCurrentSpeed(enhancer);

      expect(video.playbackRate).toBe(1.75);
      video.remove();
    });

    test('DESCRIPTOR.mountDock creates Vision dock badge idempotently', () => {
      const desc = window.YouTubePlusSpeedControl.DESCRIPTOR;
      const player = document.createElement('div');
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);

      localStorage.setItem('youtube_playback_speed', '1.75');
      // Restore is owned by the Speed Control module and runs
      // once per boot (basic.js calls restore) — the dock badge displays the
      // OWNER state, not a fresh storage read.
      window.YouTubePlusSpeedControl.restore?.();
      desc.mountDock(player, dock);

      const badge = dock.querySelector('#yp-vision-speed-btn');
      expect(badge).toBeTruthy();
      expect(badge?.classList.contains('vision-dock-btn')).toBe(true);
      expect(badge?.classList.contains('speed-control-btn')).toBe(true);
      expect(badge?.textContent).toBe('1.75x');

      // Second mount should be a no-op and not duplicate badge
      desc.mountDock(player, dock);
      expect(dock.querySelectorAll('#yp-vision-speed-btn').length).toBe(1);
    });

    test('badge handlers survive sweep + re-mount; dispose releases all three', async () => {
      const desc = window.YouTubePlusSpeedControl.DESCRIPTOR;
      const player = document.createElement('div');
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);
      const cm = window.YouTubePlusCleanupManager;
      const countEntries = () => {
        let n = 0;
        for (const e of cm.listeners.values()) {
          if (e.target === dock.querySelector('#yp-vision-speed-btn')) n += 1;
        }
        return n;
      };

      let dispose = desc.mountDock(player, dock);
      expect(typeof dispose).toBe('function');
      const badge = dock.querySelector('#yp-vision-speed-btn');
      expect(badge?.tagName).toBe('BUTTON');
      expect(badge?.getAttribute('aria-expanded')).toBe('false');
      expect(countEntries()).toBe(4);

      // Direct re-mount without host: stable closures must dedup, not stack.
      dispose = desc.mountDock(player, dock);
      expect(countEntries()).toBe(4);

      // Per-navigation sweep wipes listeners; re-mount restores them.
      cm.cleanup();
      expect(countEntries()).toBe(0);
      dispose = desc.mountDock(player, dock);
      expect(countEntries()).toBe(4);
      badge.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      expect(document.querySelector('.speed-options')?.classList.contains('visible')).toBe(true);
      expect(badge?.getAttribute('aria-expanded')).toBe('true');

      // Click toggles the visible dropdown closed (stable click closure).
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(document.querySelector('.speed-options')?.classList.contains('visible')).toBe(false);
      expect(badge?.getAttribute('aria-expanded')).toBe('false');

      // Keyboard Enter toggles it open
      badge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(document.querySelector('.speed-options')?.classList.contains('visible')).toBe(true);
      expect(badge?.getAttribute('aria-expanded')).toBe('true');

      // Keyboard Space toggles it closed
      badge.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(document.querySelector('.speed-options')?.classList.contains('visible')).toBe(false);
      expect(badge?.getAttribute('aria-expanded')).toBe('false');

      // Click again while hidden: the else branch opens it via showSpeed.
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(document.querySelector('.speed-options')?.classList.contains('visible')).toBe(true);
      expect(badge?.getAttribute('aria-expanded')).toBe('true');

      // Mouseleave: the hide timer closes the dropdown when nothing is
      // hovered, and keeps it when hovered. jsdom throws on the :hover
      // pseudo-class (spies drive both outcomes), and the module captures the
      // RAW setTimeout at load, so real timers are used here.
      jest.useRealTimers();
      const opts = document.querySelector('.speed-options');
      jest.spyOn(opts, 'matches').mockReturnValue(false);
      jest.spyOn(badge, 'matches').mockReturnValue(false);
      badge.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      await new Promise(r => setTimeout(r, 320));
      expect(opts.classList.contains('visible')).toBe(false);

      badge.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      expect(opts.classList.contains('visible')).toBe(true);
      jest.spyOn(opts, 'matches').mockReturnValue(true);
      badge.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      await new Promise(r => setTimeout(r, 320));
      // Hovered: the hide timer must keep the dropdown visible.
      expect(opts.classList.contains('visible')).toBe(true);

      // The latest dispose releases every live registration it made.
      dispose();
      expect(countEntries()).toBe(0);
    });

    test('disposed mount hide timer never closes the new session popup', async () => {
      const desc = window.YouTubePlusSpeedControl.DESCRIPTOR;
      const player = document.createElement('div');
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);
      jest.useRealTimers();

      // Mount #1 → open → mouseleave (schedules the deferred hide) → dispose.
      let dispose = desc.mountDock(player, dock);
      let badge = dock.querySelector('#yp-vision-speed-btn');
      badge.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      const opts = document.querySelector('.speed-options');
      expect(opts?.classList.contains('visible')).toBe(true);
      jest.spyOn(opts, 'matches').mockReturnValue(false);
      jest.spyOn(badge, 'matches').mockReturnValue(false);
      badge.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      dispose(); // The disposer must cancel the pending hide timer

      // The popup is closed by the time the user returns (any cause); the
      // dock is remounted and the user opens it again with Enter.
      opts.classList.remove('visible');
      dispose = desc.mountDock(player, dock);
      badge = dock.querySelector('#yp-vision-speed-btn');
      badge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(opts.classList.contains('visible')).toBe(true);

      // The stale timer's window elapses: the NEW session's popup must stay
      // open. (Buggy baseline: the raw timer from mount #1 fires here and
      // removes 'visible' from the current popup.)
      await new Promise(r => setTimeout(r, 320));
      expect(opts.classList.contains('visible')).toBe(true);
      dispose();
    });

    test('window relayout listeners live only while the speed menu is open', async () => {
      const desc = window.YouTubePlusSpeedControl.DESCRIPTOR;
      const player = document.createElement('div');
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);
      // MutationObserver callbacks run as microtasks: flush after each state
      // change before reading the spy counts.
      const flush = () => new Promise(r => setTimeout(r, 0));

      const addSpy = jest.spyOn(window, 'addEventListener');
      const removeSpy = jest.spyOn(window, 'removeEventListener');
      const addedScroll = () => addSpy.mock.calls.filter(call => call[0] === 'scroll').length;
      const addedResize = () => addSpy.mock.calls.filter(call => call[0] === 'resize').length;
      const removedScroll = () => removeSpy.mock.calls.filter(call => call[0] === 'scroll').length;
      const removedResize = () => removeSpy.mock.calls.filter(call => call[0] === 'resize').length;

      const dispose = desc.mountDock(player, dock);
      await flush();
      // Mount must not attach the window relayout pair: it only anchors an
      // open menu, so pages without the open menu pay nothing on scroll.
      expect(addedScroll()).toBe(0);
      expect(addedResize()).toBe(0);

      const badge = dock.querySelector('#yp-vision-speed-btn');
      badge?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      await flush();
      const opts = document.querySelector('.speed-options');
      expect(opts?.classList.contains('visible')).toBe(true);
      expect(addedScroll()).toBe(1);
      expect(addedResize()).toBe(1);

      badge?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await flush();
      expect(opts?.classList.contains('visible')).toBe(false);
      expect(removedScroll()).toBe(1);
      expect(removedResize()).toBe(1);

      // Reopening re-attaches the pair for the open window.
      badge?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
      expect(opts?.classList.contains('visible')).toBe(true);
      expect(addedScroll()).toBe(2);
      expect(addedResize()).toBe(2);
      expect(removedScroll()).toBe(1);

      dispose();
    });

    test('addButton is idempotent in Classic controls and opens dropdown upwards even in upper viewport', () => {
      const controls = document.createElement('div');
      document.body.appendChild(controls);
      const enhancer = createEnhancer();
      window.YouTubePlusZoom = {
        closestDock: el =>
          el && typeof el.closest === 'function' ? el.closest('.vision-top-center-dock') : null,
      };

      window.YouTubePlusSpeedControl.addButton(enhancer, controls);
      expect(controls.querySelectorAll('.speed-control-btn').length).toBe(1);

      window.YouTubePlusSpeedControl.addButton(enhancer, controls);
      expect(controls.querySelectorAll('.speed-control-btn').length).toBe(1);

      const btn = controls.querySelector('.speed-control-btn');
      btn.getBoundingClientRect = () => ({
        left: 400,
        top: 200,
        right: 440,
        bottom: 236,
        width: 40,
        height: 36,
      });
      btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      const opts = document.querySelector('.speed-options');
      expect(opts?.style.top).toBe('auto');
      expect(opts?.style.bottom).not.toBe('auto');

      // Vision dock anchor opens downwards
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      dock.getBoundingClientRect = () => ({
        left: 300,
        top: 20,
        right: 500,
        bottom: 56,
        width: 200,
        height: 36,
      });
      dock.appendChild(btn);
      document.body.appendChild(dock);
      window.dispatchEvent(new Event('resize'));
      expect(opts?.style.top).toBe('66px');
      expect(opts?.style.bottom).toBe('auto');

      dock.remove();
      controls.remove();
    });
  });
});
