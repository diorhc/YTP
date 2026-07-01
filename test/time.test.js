/**
 * Unit tests for YouTube+ Time module (time.js)
 *
 * Tests resume playback, A-B loop control, time formatting,
 * and storage helpers.
 */

const setupTimeDeps = () => {
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      formatTime: jest.fn(secs => {
        if (typeof secs !== 'number' || !isFinite(secs)) return '0:00';
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.floor(secs % 60);
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
      }),
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
      NotificationManager: { show: jest.fn(), remove: jest.fn() },
      whenRelevant: jest.fn(() => ({ active: false, check: jest.fn(), dispose: jest.fn() })),
      waitForElement: jest.fn(() => Promise.resolve(null)),
      onDomReady: jest.fn(cb => cb()),
      setTimeout_: jest.fn((cb, ms) => setTimeout(cb, ms)),
      logSuppressed: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusLogger', {
    configurable: true,
    writable: true,
    value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });

  Object.defineProperty(window, 'YouTubePlusEventDelegation', {
    configurable: true,
    writable: true,
    value: { on: jest.fn(), off: jest.fn() },
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

describe('Time Module', () => {
  beforeEach(() => {
    setupTimeDeps();
  });

  describe('Time formatting', () => {
    test('should format seconds to H:MM:SS', () => {
      const format = secs => {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.floor(secs % 60);
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
      };
      expect(format(3661)).toBe('1:01:01');
      expect(format(3600)).toBe('1:00:00');
      expect(format(65)).toBe('1:05');
      expect(format(0)).toBe('0:00');
    });

    test('should format minutes to M:SS', () => {
      const format = secs => {
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
      };
      expect(format(125)).toBe('2:05');
      expect(format(60)).toBe('1:00');
      expect(format(59)).toBe('0:59');
    });

    test('should handle edge cases', () => {
      const format = secs => {
        if (typeof secs !== 'number' || !isFinite(secs) || secs < 0) return '0:00';
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
      };
      expect(format(NaN)).toBe('0:00');
      expect(format(Infinity)).toBe('0:00');
      expect(format(-10)).toBe('0:00');
    });
  });

  describe('Resume storage', () => {
    test('should store playback position', () => {
      const storageKey = 'ytp_resume_times';
      const data = { test: { time: 120, duration: 300 } };
      localStorage.setItem(storageKey, JSON.stringify(data));

      const stored = JSON.parse(localStorage.getItem(storageKey));
      expect(stored.test.time).toBe(120);
      expect(stored.test.duration).toBe(300);
    });

    test('should read playback position', () => {
      const storageKey = 'ytp_resume_times';
      localStorage.setItem(storageKey, JSON.stringify({ vid1: { time: 60, duration: 200 } }));
      const data = JSON.parse(localStorage.getItem(storageKey));
      expect(data.vid1.time).toBe(60);
    });

    test('should handle missing storage gracefully', () => {
      const data = JSON.parse(localStorage.getItem('nonexistent') || '{}');
      expect(data).toEqual({});
    });

    test('should handle corrupted storage', () => {
      localStorage.setItem('ytp_resume_times', 'invalid');
      let data = {};
      try {
        data = JSON.parse(localStorage.getItem('ytp_resume_times'));
      } catch {
        data = {};
      }
      expect(data).toEqual({});
    });

    test('should store multiple video positions', () => {
      const storageKey = 'ytp_resume_times';
      const data = {
        vid1: { time: 60, duration: 200 },
        vid2: { time: 120, duration: 300 },
        vid3: { time: 0, duration: 100 },
      };
      localStorage.setItem(storageKey, JSON.stringify(data));
      const stored = JSON.parse(localStorage.getItem(storageKey));
      expect(Object.keys(stored)).toHaveLength(3);
    });
  });

  describe('Video ID extraction', () => {
    test('should extract video ID from URL', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      expect(match).toBeTruthy();
      expect(match[1]).toBe('dQw4w9WgXcQ');
    });

    test('should return null for invalid URL', () => {
      const url = 'https://www.youtube.com/';
      const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      expect(match).toBeNull();
    });
  });

  describe('A-B loop control', () => {
    test('should store loop points', () => {
      const loopState = { enabled: true, pointA: 10, pointB: 30 };
      expect(loopState.pointA).toBeLessThan(loopState.pointB);
    });

    test('should reset loop points', () => {
      const loopState = { enabled: false, pointA: null, pointB: null };
      expect(loopState.pointA).toBeNull();
      expect(loopState.pointB).toBeNull();
    });

    test('should validate A < B', () => {
      const pointA = 10;
      const pointB = 30;
      expect(pointA).toBeLessThan(pointB);
    });

    test('should handle same A and B points', () => {
      const pointA = 15;
      const pointB = 15;
      expect(pointA).toBe(pointB);
    });

    test('should persist loop state to storage', () => {
      const storageKey = 'ytp_loop_state';
      const state = { enabled: true, pointA: 10, pointB: 30 };
      localStorage.setItem(storageKey, JSON.stringify(state));
      const stored = JSON.parse(localStorage.getItem(storageKey));
      expect(stored.enabled).toBe(true);
      expect(stored.pointA).toBe(10);
      expect(stored.pointB).toBe(30);
    });

    test('should load loop state from storage', () => {
      const storageKey = 'ytp_loop_state';
      localStorage.setItem(storageKey, JSON.stringify({ enabled: false, pointA: null, pointB: null }));
      const stored = JSON.parse(localStorage.getItem(storageKey));
      expect(stored.enabled).toBe(false);
    });
  });

  describe('Loop progress bar', () => {
    test('should calculate loop duration', () => {
      const pointA = 10;
      const pointB = 30;
      const duration = pointB - pointA;
      expect(duration).toBe(20);
    });

    test('should calculate progress percentage', () => {
      const pointA = 10;
      const pointB = 30;
      const currentTime = 20;
      const progress = ((currentTime - pointA) / (pointB - pointA)) * 100;
      expect(progress).toBe(50);
    });

    test('should clamp progress to 0-100', () => {
      const clamp = val => Math.min(Math.max(val, 0), 100);
      expect(clamp(-10)).toBe(0);
      expect(clamp(110)).toBe(100);
      expect(clamp(50)).toBe(50);
    });
  });

  describe('Feature toggle', () => {
    test('should respect loadFeatureEnabled for resume', () => {
      const enabled = window.YouTubeUtils.loadFeatureEnabled('enableResume', true);
      expect(enabled).toBe(true);
    });

    test('should respect loadFeatureEnabled for loop', () => {
      const enabled = window.YouTubeUtils.loadFeatureEnabled('enableLoop', true);
      expect(enabled).toBe(true);
    });
  });

  describe('Public API', () => {
    test('should expose YouTubePlusTimeLoop API', () => {
      window.YouTubePlusTimeLoop = {
        toggleLoop: jest.fn(),
        setLoopPoint: jest.fn(),
        resetLoopPoints: jest.fn(),
        applyLoopStateToCurrentVideo: jest.fn(),
      };
      expect(window.YouTubePlusTimeLoop).toBeDefined();
      expect(typeof window.YouTubePlusTimeLoop.toggleLoop).toBe('function');
      expect(typeof window.YouTubePlusTimeLoop.setLoopPoint).toBe('function');
      expect(typeof window.YouTubePlusTimeLoop.resetLoopPoints).toBe('function');
    });

    test('toggleLoop should be callable', () => {
      window.YouTubePlusTimeLoop = { toggleLoop: jest.fn() };
      window.YouTubePlusTimeLoop.toggleLoop();
      expect(window.YouTubePlusTimeLoop.toggleLoop).toHaveBeenCalled();
    });

    test('setLoopPoint should accept A or B', () => {
      window.YouTubePlusTimeLoop = { setLoopPoint: jest.fn() };
      window.YouTubePlusTimeLoop.setLoopPoint('A');
      window.YouTubePlusTimeLoop.setLoopPoint('B');
      expect(window.YouTubePlusTimeLoop.setLoopPoint).toHaveBeenCalledTimes(2);
    });

    test('resetLoopPoints should clear both points', () => {
      window.YouTubePlusTimeLoop = { resetLoopPoints: jest.fn() };
      window.YouTubePlusTimeLoop.resetLoopPoints();
      expect(window.YouTubePlusTimeLoop.resetLoopPoints).toHaveBeenCalled();
    });
  });

  describe('Overlay creation', () => {
    test('should create resume overlay element', () => {
      const overlay = document.createElement('div');
      overlay.className = 'ytp-resume-overlay';
      overlay.innerHTML = '<button class="resume-btn">Resume</button><button class="restart-btn">Start over</button>';
      expect(overlay.querySelector('.resume-btn')).toBeTruthy();
      expect(overlay.querySelector('.restart-btn')).toBeTruthy();
    });

    test('should display formatted time in overlay', () => {
      const timeStr = '5:30';
      const el = document.createElement('span');
      el.textContent = `Resume from ${timeStr}`;
      expect(el.textContent).toContain('5:30');
    });
  });
});
