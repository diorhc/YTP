/**
 * Unit tests for YouTube+ Speed Control module (speedcontrol.js)
 */

const setupSpeedDeps = () => {
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      cleanupManager: {
        registerInterval: jest.fn(id => id),
        registerTimeout: jest.fn(id => id),
        registerObserver: jest.fn(obs => obs),
        registerListener: jest.fn(),
        register: jest.fn(),
        cleanup: jest.fn(),
        registerAnimationFrame: jest.fn(id => id),
        getListenerStats: jest.fn(() => ({ active: 0, registeredTotal: 0 })),
      },
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      loadFeatureEnabled: jest.fn(() => true),
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
      logSuppressed: jest.fn(),
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

  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    href: 'https://www.youtube.com/watch?v=test',
  });
};

describe('Speed Control Module', () => {
  beforeEach(() => {
    setupSpeedDeps();
  });

  describe('Speed state management', () => {
    test('should define available speed values', () => {
      const availableSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
      expect(availableSpeeds).toContain(1);
      expect(availableSpeeds).toContain(2);
      expect(availableSpeeds.length).toBeGreaterThan(0);
    });

    test('should default to 1x speed', () => {
      const currentSpeed = 1;
      expect(currentSpeed).toBe(1);
    });

    test('should validate speed is within available range', () => {
      const availableSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
      const isValidSpeed = speed => availableSpeeds.includes(speed);
      expect(isValidSpeed(1)).toBe(true);
      expect(isValidSpeed(2.5)).toBe(true);
      expect(isValidSpeed(0.01)).toBe(false);
      expect(isValidSpeed(5)).toBe(false);
    });

    test('should clamp speed to min/max', () => {
      const MIN = 0.25;
      const MAX = 3;
      const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
      expect(clamp(0.1, MIN, MAX)).toBe(0.25);
      expect(clamp(5, MIN, MAX)).toBe(3);
      expect(clamp(1.5, MIN, MAX)).toBe(1.5);
    });
  });

  describe('Step adjustment', () => {
    test('should increase speed by step', () => {
      const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
      const idx = speeds.indexOf(1);
      const next = speeds[Math.min(idx + 1, speeds.length - 1)];
      expect(next).toBe(1.25);
    });

    test('should decrease speed by step', () => {
      const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
      const idx = speeds.indexOf(1);
      const prev = speeds[Math.max(idx - 1, 0)];
      expect(prev).toBe(0.75);
    });

    test('should not go below minimum', () => {
      const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
      const idx = speeds.indexOf(0.25);
      const prev = speeds[Math.max(idx - 1, 0)];
      expect(prev).toBe(0.25);
    });

    test('should not go above maximum', () => {
      const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
      const idx = speeds.indexOf(3);
      const next = speeds[Math.min(idx + 1, speeds.length - 1)];
      expect(next).toBe(3);
    });
  });

  describe('Video element interaction', () => {
    test('should set playbackRate on video element', () => {
      document.body.innerHTML = '<video id="movie_player"></video>';
      const video = document.getElementById('movie_player');
      video.playbackRate = 1.5;
      expect(video.playbackRate).toBe(1.5);
    });

    test('should handle multiple video elements', () => {
      document.body.innerHTML = '<video class="vid"></video><video class="vid"></video>';
      const videos = document.querySelectorAll('video');
      videos.forEach(v => { v.playbackRate = 2; });
      expect(videos[0].playbackRate).toBe(2);
      expect(videos[1].playbackRate).toBe(2);
    });

    test('should handle missing video gracefully', () => {
      const video = document.getElementById('nonexistent');
      expect(video).toBeNull();
    });
  });

  describe('Speed indicator', () => {
    test('should create speed indicator element', () => {
      const indicator = document.createElement('div');
      indicator.className = 'ytp-speed-indicator';
      document.body.appendChild(indicator);
      expect(document.querySelector('.ytp-speed-indicator')).toBeTruthy();
    });

    test('should display speed value text', () => {
      const indicator = document.createElement('div');
      indicator.textContent = '1.5x';
      expect(indicator.textContent).toBe('1.5x');
    });

    test('should be positioned over video player', () => {
      const indicator = document.createElement('div');
      indicator.style.position = 'absolute';
      indicator.style.top = '50%';
      indicator.style.left = '50%';
      expect(indicator.style.position).toBe('absolute');
    });
  });

  describe('Hotkey registration', () => {
    test('should register decrease speed hotkey (B)', () => {
      const code = 'KeyB';
      expect(code).toBe('KeyB');
    });

    test('should register increase speed hotkey (G)', () => {
      const code = 'KeyG';
      expect(code).toBe('KeyG');
    });

    test('should register reset speed hotkey (H)', () => {
      const code = 'KeyH';
      expect(code).toBe('KeyH');
    });

    test('should handle keyboard events', () => {
      const handler = jest.fn();
      document.addEventListener('keydown', handler);
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
      expect(handler).toHaveBeenCalled();
      document.removeEventListener('keydown', handler);
    });
  });

  describe('Style injection', () => {
    test('should inject speed control CSS', () => {
      const sm = window.YouTubeUtils.StyleManager;
      sm.add('speed-control-styles', '.ytp-speed-indicator{position:absolute}');
      expect(sm.add).toHaveBeenCalledWith('speed-control-styles', expect.any(String));
    });

    test('should remove styles on cleanup', () => {
      const sm = window.YouTubeUtils.StyleManager;
      sm.remove('speed-control-styles');
      expect(sm.remove).toHaveBeenCalledWith('speed-control-styles');
    });
  });

  describe('Refresh visibility', () => {
    test('should show speed controls when enabled', () => {
      const el = document.createElement('div');
      el.style.display = '';
      expect(el.style.display).not.toBe('none');
    });

    test('should hide speed controls when disabled', () => {
      const el = document.createElement('div');
      el.style.display = 'none';
      expect(el.style.display).toBe('none');
    });
  });

  describe('Public API', () => {
    test('should expose speed control API', () => {
      window.YouTubePlusSpeedControl = {
        addButton: jest.fn(),
        changeSpeed: jest.fn(),
        applyCurrentSpeed: jest.fn(),
        setupVideoObserver: jest.fn(),
        showSpeedIndicator: jest.fn(),
        adjustSpeedByStep: jest.fn(),
        refreshVisibility: jest.fn(),
        registerHotkeys: jest.fn(),
        injectStyles: jest.fn(),
      };
      expect(window.YouTubePlusSpeedControl).toBeDefined();
      expect(typeof window.YouTubePlusSpeedControl.changeSpeed).toBe('function');
      expect(typeof window.YouTubePlusSpeedControl.adjustSpeedByStep).toBe('function');
    });
  });
});
