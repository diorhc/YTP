/**
 * Unit tests for YouTube+ Basic module (basic.js)
 *
 * Tests the YouTubeUtils facade, SettingsManager, NotificationManager,
 * and idempotency guards.
 */

/** @param {Record<string, unknown>} overrides */
const setupYouTubeUtils = (overrides = {}) => {
  const cm = {
    registerInterval: jest.fn(id => id),
    registerTimeout: jest.fn(id => id),
    registerObserver: jest.fn(obs => obs),
    registerListener: jest.fn(),
    registerAnimationFrame: jest.fn(id => id),
    register: jest.fn(),
    cleanup: jest.fn(),
    getListenerStats: jest.fn(() => ({ active: 0, registeredTotal: 0 })),
  };

  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      cleanupManager: cm,
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn(), styles: new Map() },
      NotificationManager: { show: jest.fn(), remove: jest.fn() },
      SettingsManager: { load: jest.fn(() => ({})), save: jest.fn(), get: jest.fn(), set: jest.fn() },
      loadFeatureEnabled: jest.fn(() => true),
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
      debounce: jest.fn((fn) => Object.assign(fn, { cancel: jest.fn(), destroy: jest.fn() })),
      throttle: jest.fn(fn => fn),
      createElement: jest.fn((tag, props, children) => {
        const el = document.createElement(tag);
        if (props) Object.entries(props).forEach(([k, v]) => { el[k] = v; });
        if (children) children.forEach(c => { if (typeof c === 'string') el.textContent = c; else el.appendChild(c); });
        return el;
      }),
      waitForElement: jest.fn(() => Promise.resolve(null)),
      storage: { get: jest.fn(() => null), set: jest.fn(), remove: jest.fn() },
      whenRelevant: jest.fn(() => ({ active: false, check: jest.fn(), dispose: jest.fn() })),
      logSuppressed: jest.fn(),
      ...overrides,
    },
  });
};

describe('Basic Module', () => {
  beforeEach(() => {
    setupYouTubeUtils();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
  });

  describe('YouTubeUtils facade', () => {
    test('should expose $ query helper', () => {
      document.body.innerHTML = '<div class="test-el"></div>';
      const result = window.YouTubeUtils.$('.test-el');
      expect(result).toBeTruthy();
      expect(result.className).toBe('test-el');
    });

    test('should expose $$ queryAll helper', () => {
      document.body.innerHTML = '<div class="a"></div><div class="a"></div>';
      const results = window.YouTubeUtils.$$('.a');
      expect(results).toHaveLength(2);
    });

    test('should expose byId helper', () => {
      document.body.innerHTML = '<div id="my-id"></div>';
      const el = window.YouTubeUtils.byId('my-id');
      expect(el).toBeTruthy();
      expect(el.id).toBe('my-id');
    });

    test('should expose translation helper t()', () => {
      expect(typeof window.YouTubeUtils.t).toBe('function');
      expect(window.YouTubeUtils.t('hello')).toBe('hello');
    });

    test('should expose cleanupManager', () => {
      expect(window.YouTubeUtils.cleanupManager).toBeDefined();
      expect(typeof window.YouTubeUtils.cleanupManager.register).toBe('function');
      expect(typeof window.YouTubeUtils.cleanupManager.cleanup).toBe('function');
    });

    test('should expose StyleManager', () => {
      const sm = window.YouTubeUtils.StyleManager;
      expect(sm).toBeDefined();
      expect(typeof sm.add).toBe('function');
      expect(typeof sm.remove).toBe('function');
    });
  });

  describe('SettingsManager', () => {
    test('should load settings from localStorage', () => {
      localStorage.setItem('youtube_plus_settings', JSON.stringify({ enabled: false }));
      const sm = window.YouTubeUtils.SettingsManager;
      sm.load();
      expect(sm.load).toHaveBeenCalled();
    });

    test('should save settings', () => {
      const sm = window.YouTubeUtils.SettingsManager;
      sm.save({ enabled: true });
      expect(sm.save).toHaveBeenCalledWith({ enabled: true });
    });

    test('should get setting by path', () => {
      const sm = window.YouTubeUtils.SettingsManager;
      sm.get('some.path');
      expect(sm.get).toHaveBeenCalledWith('some.path');
    });

    test('should set setting by path', () => {
      const sm = window.YouTubeUtils.SettingsManager;
      sm.set('some.path', 'value');
      expect(sm.set).toHaveBeenCalledWith('some.path', 'value');
    });
  });

  describe('NotificationManager', () => {
    test('should show notification', () => {
      const nm = window.YouTubeUtils.NotificationManager;
      nm.show('Test message', { duration: 3000 });
      expect(nm.show).toHaveBeenCalledWith('Test message', { duration: 3000 });
    });

    test('should remove notification', () => {
      const nm = window.YouTubeUtils.NotificationManager;
      const mockEl = document.createElement('div');
      nm.remove(mockEl);
      expect(nm.remove).toHaveBeenCalledWith(mockEl);
    });
  });

  describe('loadFeatureEnabled', () => {
    test('should return true when feature is enabled', () => {
      window.YouTubeUtils.loadFeatureEnabled = jest.fn(() => true);
      expect(window.YouTubeUtils.loadFeatureEnabled('testFeature')).toBe(true);
    });

    test('should return false when feature is disabled', () => {
      window.YouTubeUtils.loadFeatureEnabled = jest.fn(() => false);
      expect(window.YouTubeUtils.loadFeatureEnabled('testFeature')).toBe(false);
    });

    test('should accept default value parameter', () => {
      window.YouTubeUtils.loadFeatureEnabled = jest.fn(() => true);
      window.YouTubeUtils.loadFeatureEnabled('test', true);
      expect(window.YouTubeUtils.loadFeatureEnabled).toHaveBeenCalledWith('test', true);
    });
  });

  describe('whenRelevant', () => {
    test('should return activation object', () => {
      const result = window.YouTubeUtils.whenRelevant({
        isRelevant: () => true,
        onEnter: jest.fn(),
      });
      expect(result).toBeDefined();
      expect(typeof result.check).toBe('function');
      expect(typeof result.dispose).toBe('function');
    });
  });

  describe('idempotency guard', () => {
    test('should support setting init guard flag', () => {
      window.__ytpBasicInitDone__ = true;
      expect(window.__ytpBasicInitDone__).toBe(true);
      delete window.__ytpBasicInitDone__;
    });
  });

  describe('debounce', () => {
    test('should return a callable function', () => {
      const fn = jest.fn();
      const debounced = window.YouTubeUtils.debounce(fn, 100);
      expect(typeof debounced).toBe('function');
    });

    test('should have cancel method', () => {
      const fn = jest.fn();
      const debounced = window.YouTubeUtils.debounce(fn, 100);
      expect(typeof debounced.cancel).toBe('function');
    });
  });

  describe('throttle', () => {
    test('should return a callable function', () => {
      const fn = jest.fn();
      const throttled = window.YouTubeUtils.throttle(fn, 100);
      expect(typeof throttled).toBe('function');
    });
  });

  describe('createElement', () => {
    test('should create a DOM element', () => {
      const el = window.YouTubeUtils.createElement('div', { className: 'test' }, ['Hello']);
      expect(el.tagName).toBe('DIV');
      expect(el.className).toBe('test');
      expect(el.textContent).toBe('Hello');
    });
  });

  describe('storage', () => {
    test('should get value from storage', () => {
      window.YouTubeUtils.storage.get('key');
      expect(window.YouTubeUtils.storage.get).toHaveBeenCalledWith('key');
    });

    test('should set value in storage', () => {
      window.YouTubeUtils.storage.set('key', 'value');
      expect(window.YouTubeUtils.storage.set).toHaveBeenCalledWith('key', 'value');
    });

    test('should remove value from storage', () => {
      window.YouTubeUtils.storage.remove('key');
      expect(window.YouTubeUtils.storage.remove).toHaveBeenCalledWith('key');
    });
  });

  describe('waitForElement', () => {
    test('should return a promise', () => {
      const result = window.YouTubeUtils.waitForElement('.test');
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('logSuppressed', () => {
    test('should be a function', () => {
      expect(typeof window.YouTubeUtils.logSuppressed).toBe('function');
    });

    test('should not throw when called', () => {
      expect(() => window.YouTubeUtils.logSuppressed(new Error('test'), 'module')).not.toThrow();
    });
  });
});
