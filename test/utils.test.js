/**
 * @jest-environment jsdom
 *
 * Tests exercise the real utilities in src/utils.js on window.YouTubeUtils.
 * Earlier versions of this file tested locally reimplemented debounce / throttle
 * / logError; now every assertion uses the actual exported helpers.
 */

if (typeof window !== 'undefined' && !window.navigation) {
  window.navigation = new EventTarget();
}

describe('YouTubeUtils', () => {
  beforeEach(() => {
    try {
      Object.defineProperty(document, 'head', {
        configurable: true,
        writable: true,
        value: document.createElement('head'),
      });
    } catch {
      // ignore in environments with read-only head
    }

    try {
      Object.defineProperty(document, 'body', {
        configurable: true,
        writable: true,
        value: document.createElement('body'),
      });
    } catch {
      // ignore in environments with read-only body
    }

    // Ensure the real utils.js module loads and exposes its canonical helpers.
    require('../src/utils.js');
  });

  describe('real escapeHTML', () => {
    test('escapes all five HTML-significant characters (quote-safe superset)', () => {
      expect(window.YouTubeUtils.escapeHTML(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    test('returns empty string for non-string input', () => {
      expect(window.YouTubeUtils.escapeHTML(null)).toBe('');
      expect(window.YouTubeUtils.escapeHTML(undefined)).toBe('');
      expect(window.YouTubeUtils.escapeHTML(42)).toBe('');
    });
  });

  describe('real debounce', () => {
    jest.useFakeTimers();

    test('delays function execution', () => {
      const fn = jest.fn();
      const debounced = window.YouTubeUtils.debounce(fn, 100);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('cancels previous calls', () => {
      const fn = jest.fn();
      const debounced = window.YouTubeUtils.debounce(fn, 100);

      debounced();
      debounced();
      debounced();

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('supports leading edge execution', () => {
      const fn = jest.fn();
      const debounced = window.YouTubeUtils.debounce(fn, 100, { leading: true });

      debounced();
      expect(fn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('has a cancel method', () => {
      const fn = jest.fn();
      const debounced = window.YouTubeUtils.debounce(fn, 100);

      debounced();
      debounced.cancel();

      jest.advanceTimersByTime(100);
      expect(fn).not.toHaveBeenCalled();
    });

    afterEach(() => {
      jest.clearAllTimers();
    });
  });

  describe('real throttle', () => {
    jest.useFakeTimers();

    test('limits function calls', () => {
      const fn = jest.fn();
      const throttled = window.YouTubeUtils.throttle(fn, 100);

      throttled();
      throttled();
      throttled();

      expect(fn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(100);
      throttled();

      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('returns last result during throttle period', () => {
      const fn = jest.fn(() => 'result');
      const throttled = window.YouTubeUtils.throttle(fn, 100);

      const result1 = throttled();
      const result2 = throttled();

      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    afterEach(() => {
      jest.clearAllTimers();
    });
  });

  describe('real logError', () => {
    test('logs errors with module context via YouTubePlusLogger', () => {
      Object.defineProperty(window, 'YouTubePlusLogger', {
        configurable: true,
        writable: true,
        value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      const error = new Error('Test error');
      window.YouTubeUtils.logError('TestModule', 'Test message', error);

      expect(window.YouTubePlusLogger.error).toHaveBeenCalledWith(
        'TestModule',
        'Test message',
        error
      );
    });
  });

  describe('real openSafe', () => {
    let originalOpen;
    beforeEach(() => {
      originalOpen = window.open;
      window.open = jest.fn((url, target, features) => ({ opener: null, url, target, features }));
    });

    afterEach(() => {
      window.open = originalOpen;
    });

    test('allows valid https URLs and requests a new tab', () => {
      const opened = window.YouTubeUtils.openSafe('https://example.com/download');
      expect(window.open).toHaveBeenCalledWith(
        'https://example.com/download',
        '_blank',
        'noopener,noreferrer'
      );
      expect(opened).toBe(true);
    });

    test('allows localhost/127.0.0.1 for local YTDL tool', () => {
      const opened = window.YouTubeUtils.openSafe('http://localhost:8080/ytdl');
      expect(window.open).toHaveBeenCalledWith(
        'http://localhost:8080/ytdl',
        '_blank',
        'noopener,noreferrer'
      );
      expect(opened).toBe(true);
    });

    test('blocks javascript: schemes and invalid URLs', () => {
      expect(window.YouTubeUtils.openSafe('javascript:alert(1)')).toBe(false);
      expect(window.YouTubeUtils.openSafe('data:text/html,bad')).toBe(false);
      expect(window.YouTubeUtils.openSafe(null)).toBe(false);
    });
  });

  describe('real formatTime', () => {
    test('formats seconds as M:SS', () => {
      expect(window.YouTubeUtils.formatTime(0)).toBe('0:00');
      expect(window.YouTubeUtils.formatTime(5)).toBe('0:05');
      expect(window.YouTubeUtils.formatTime(59)).toBe('0:59');
      expect(window.YouTubeUtils.formatTime(60)).toBe('1:00');
      expect(window.YouTubeUtils.formatTime(61)).toBe('1:01');
    });

    test('formats as H:MM:SS when >= 1 hour', () => {
      expect(window.YouTubeUtils.formatTime(3600)).toBe('1:00:00');
      expect(window.YouTubeUtils.formatTime(3661)).toBe('1:01:01');
      expect(window.YouTubeUtils.formatTime(7200)).toBe('2:00:00');
    });

    test('clamps negative/NaN/non-finite to 0:00', () => {
      expect(window.YouTubeUtils.formatTime(-10)).toBe('0:00');
      expect(window.YouTubeUtils.formatTime(NaN)).toBe('0:00');
      expect(window.YouTubeUtils.formatTime(Infinity)).toBe('0:00');
      expect(window.YouTubeUtils.formatTime(-Infinity)).toBe('0:00');
      expect(window.YouTubeUtils.formatTime(undefined)).toBe('0:00');
      expect(window.YouTubeUtils.formatTime(null)).toBe('0:00');
    });

    test('handles large values', () => {
      expect(window.YouTubeUtils.formatTime(86400)).toBe('24:00:00');
      expect(window.YouTubeUtils.formatTime(359999)).toBe('99:59:59');
    });
  });

  describe('real getVideoIdFromUrl', () => {
    test('extracts from query param v', () => {
      expect(
        window.YouTubeUtils.getVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      ).toBe('dQw4w9WgXcQ');
      expect(
        window.YouTubeUtils.getVideoIdFromUrl('https://youtube.com/watch?v=dQw4w9WgXcQ&t=10')
      ).toBe('dQw4w9WgXcQ');
    });

    test('extracts from /shorts/ path', () => {
      expect(
        window.YouTubeUtils.getVideoIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')
      ).toBe('dQw4w9WgXcQ');
    });

    test('extracts from /live/ path', () => {
      expect(
        window.YouTubeUtils.getVideoIdFromUrl('https://www.youtube.com/live/dQw4w9WgXcQ')
      ).toBe('dQw4w9WgXcQ');
    });

    test('extracts from /embed/ path', () => {
      expect(
        window.YouTubeUtils.getVideoIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')
      ).toBe('dQw4w9WgXcQ');
    });

    test('extracts from youtu.be short links', () => {
      expect(window.YouTubeUtils.getVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
        'dQw4w9WgXcQ'
      );
      expect(window.YouTubeUtils.getVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe(
        'dQw4w9WgXcQ'
      );
    });

    test('accepts bare 11-char video ID', () => {
      expect(window.YouTubeUtils.getVideoIdFromUrl('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    test('returns null for invalid input', () => {
      expect(window.YouTubeUtils.getVideoIdFromUrl(null)).toBeNull();
      expect(window.YouTubeUtils.getVideoIdFromUrl(undefined)).toBeNull();
      expect(window.YouTubeUtils.getVideoIdFromUrl('')).toBeNull();
      expect(window.YouTubeUtils.getVideoIdFromUrl('not-a-url')).toBeNull();
      expect(window.YouTubeUtils.getVideoIdFromUrl('https://example.com')).toBeNull();
    });

    test('returns null for too-short IDs', () => {
      expect(window.YouTubeUtils.getVideoIdFromUrl('abc')).toBeNull();
      expect(window.YouTubeUtils.getVideoIdFromUrl('1234567890')).toBeNull();
    });
  });

  describe('real isWatchPage / isShortsPage / isChannelPage', () => {
    test('isWatchPage matches /watch and /watch?v=...', () => {
      expect(window.YouTubeUtils.isWatchPage('https://www.youtube.com/watch?v=abc')).toBe(true);
      expect(window.YouTubeUtils.isWatchPage('https://www.youtube.com/watch')).toBe(true);
      expect(window.YouTubeUtils.isWatchPage('https://www.youtube.com/watch/abc')).toBe(true);
      expect(window.YouTubeUtils.isWatchPage('https://www.youtube.com/shorts/abc')).toBe(false);
      expect(window.YouTubeUtils.isWatchPage('https://www.youtube.com/channel/UC123')).toBe(false);
    });

    test('isShortsPage matches /shorts/ prefix', () => {
      expect(window.YouTubeUtils.isShortsPage('https://www.youtube.com/shorts/abc')).toBe(true);
      expect(window.YouTubeUtils.isShortsPage('https://www.youtube.com/watch?v=abc')).toBe(false);
    });

    test('isChannelPage matches /@, /channel/, /c/, /user/ paths', () => {
      expect(window.YouTubeUtils.isChannelPage('https://www.youtube.com/@username')).toBe(true);
      expect(window.YouTubeUtils.isChannelPage('https://www.youtube.com/channel/UC123')).toBe(true);
      expect(window.YouTubeUtils.isChannelPage('https://www.youtube.com/c/MyChannel')).toBe(true);
      expect(window.YouTubeUtils.isChannelPage('https://www.youtube.com/user/MyUser')).toBe(true);
      expect(window.YouTubeUtils.isChannelPage('https://www.youtube.com/watch?v=abc')).toBe(false);
    });

    test('returns false for invalid URLs', () => {
      expect(window.YouTubeUtils.isWatchPage('not-a-url')).toBe(false);
      expect(window.YouTubeUtils.isShortsPage('not-a-url')).toBe(false);
      expect(window.YouTubeUtils.isChannelPage('not-a-url')).toBe(false);
    });
  });

  describe('real safeMerge', () => {
    test('merges objects shallowly', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };
      expect(window.YouTubeUtils.safeMerge(target, source)).toEqual({ a: 1, b: 3, c: 4 });
    });

    test('merges objects deeply', () => {
      const target = { a: { x: 1 } };
      const source = { a: { y: 2 } };
      expect(window.YouTubeUtils.safeMerge(target, source)).toEqual({ a: { x: 1, y: 2 } });
    });

    test('blocks __proto__ pollution', () => {
      const target = {};
      const source = JSON.parse('{"__proto__": {"polluted": true}}');
      window.YouTubeUtils.safeMerge(target, source);
      expect({}.polluted).toBeUndefined();
    });

    test('blocks constructor pollution', () => {
      const target = {};
      const source = { constructor: { prototype: { polluted: true } } };
      window.YouTubeUtils.safeMerge(target, source);
      expect({}.polluted).toBeUndefined();
    });

    test('returns target when source is null/undefined', () => {
      const target = { a: 1 };
      expect(window.YouTubeUtils.safeMerge(target, null)).toBe(target);
      expect(window.YouTubeUtils.safeMerge(target, undefined)).toBe(target);
    });

    test('handles arrays as leaf values', () => {
      const target = { a: 1 };
      const source = { b: [1, 2, 3] };
      expect(window.YouTubeUtils.safeMerge(target, source)).toEqual({ a: 1, b: [1, 2, 3] });
    });
  });

  describe('real storage', () => {
    test('set/get round-trips simple values', () => {
      window.YouTubeUtils.storage.set('test_key', 'hello');
      expect(window.YouTubeUtils.storage.get('test_key')).toBe('hello');
    });

    test('set/get round-trips complex values', () => {
      const obj = { nested: { array: [1, 2, 3] } };
      window.YouTubeUtils.storage.set('test_complex', obj);
      expect(window.YouTubeUtils.storage.get('test_complex')).toEqual(obj);
    });

    test('get returns default for missing keys', () => {
      expect(window.YouTubeUtils.storage.get('nonexistent_key_xyz')).toBeNull();
      expect(window.YouTubeUtils.storage.get('nonexistent_key_xyz', 'fallback')).toBe('fallback');
    });

    test('rejects invalid key formats', () => {
      expect(window.YouTubeUtils.storage.set('key with spaces', 'v')).toBe(false);
      expect(window.YouTubeUtils.storage.set('key/with/slashes', 'v')).toBe(false);
      expect(window.YouTubeUtils.storage.set('', 'v')).toBe(false);
    });

    test('has returns true for existing keys', () => {
      window.YouTubeUtils.storage.set('test_has_key', 42);
      expect(window.YouTubeUtils.storage.has('test_has_key')).toBe(true);
      expect(window.YouTubeUtils.storage.has('nonexistent_has_key')).toBe(false);
    });

    test('remove deletes a key', () => {
      window.YouTubePlusStorage = window.YouTubeUtils.storage;
      window.YouTubeUtils.storage.set('test_remove_key', 'to_delete');
      expect(window.YouTubeUtils.storage.has('test_remove_key')).toBe(true);
      window.YouTubeUtils.storage.remove('test_remove_key');
      expect(window.YouTubeUtils.storage.has('test_remove_key')).toBe(false);
    });
  });

  describe('real loadFeatureEnabled', () => {
    test('returns default when no store or settings exist', () => {
      delete window.YouTubePlusSettingsStore;
      localStorage.clear();
      expect(window.YouTubeUtils.loadFeatureEnabled('enableZoom')).toBe(true);
      expect(window.YouTubeUtils.loadFeatureEnabled('enableZoom', false)).toBe(false);
    });

    test('reads from localStorage settings when store is absent', () => {
      delete window.YouTubePlusSettingsStore;
      localStorage.setItem('youtube_plus_settings', JSON.stringify({ enableZoom: false }));
      expect(window.YouTubeUtils.loadFeatureEnabled('enableZoom')).toBe(false);
    });

    test('reads from SettingsStore when available', () => {
      window.YouTubePlusSettingsStore = {
        get: (key, def) => (key === 'enableZoom' ? false : def),
      };
      expect(window.YouTubeUtils.loadFeatureEnabled('enableZoom')).toBe(false);
      delete window.YouTubePlusSettingsStore;
    });

    test('returns true for undefined values (not false)', () => {
      delete window.YouTubePlusSettingsStore;
      localStorage.setItem('youtube_plus_settings', JSON.stringify({ otherKey: true }));
      expect(window.YouTubeUtils.loadFeatureEnabled('enableZoom')).toBe(true);
    });
  });

  describe('additional real utilities on window.YouTubeUtils', () => {
    let origGetHostname;

    beforeEach(() => {
      origGetHostname = window.YouTubeUtils?.getHostname;
      if (document.body && !document.documentElement.contains(document.body)) {
        document.documentElement.appendChild(document.body);
      }
    });

    afterEach(() => {
      document.body.innerHTML = '';
      if (origGetHostname && window.YouTubeUtils) {
        window.YouTubeUtils.getHostname = origGetHostname;
      }
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/',
        search: '',
        href: 'https://www.youtube.com/',
      });
    });

    test('isSettingsModalOpen detects modal presence in DOM', () => {
      expect(window.YouTubeUtils.isSettingsModalOpen()).toBe(false);

      const modal = document.createElement('div');
      modal.className = 'yp-settings-modal';
      document.body.appendChild(modal);

      expect(window.YouTubeUtils.isSettingsModalOpen()).toBe(true);
    });

    test('route detection helpers accurately evaluate hostnames and paths', () => {
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '?v=dQw4w9WgXcQ',
        href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });

      expect(window.YouTubeUtils.getHostname()).toBe('www.youtube.com');
      expect(window.YouTubeUtils.isYouTubeDomain()).toBe(true);
      expect(window.YouTubeUtils.isWatchRoute()).toBe(true);
      expect(window.YouTubeUtils.isShortsRoute()).toBe(false);
      expect(window.YouTubeUtils.isChannelRoute()).toBe(false);
      expect(window.YouTubeUtils.isMusicDomain()).toBe(false);
      expect(window.YouTubeUtils.isStudioDomain()).toBe(false);
      expect(window.YouTubeUtils.isStudioPage()).toBe(false);

      window.YouTubeUtils.getHostname = () => 'music.youtube.com';
      expect(window.YouTubeUtils.isMusicDomain()).toBe(true);
      expect(window.YouTubeUtils.isStudioDomain()).toBe(false);

      window.YouTubeUtils.getHostname = () => 'studio.youtube.com';
      expect(window.YouTubeUtils.isStudioDomain()).toBe(true);
      expect(window.YouTubeUtils.isStudioPage()).toBe(true);

      window.YouTubeUtils.getHostname = origGetHostname;

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/shorts/abcdefghijk',
        search: '',
        href: 'https://www.youtube.com/shorts/abcdefghijk',
      });
      expect(window.YouTubeUtils.isShortsRoute()).toBe(true);

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/@creator',
        search: '',
        href: 'https://www.youtube.com/@creator',
      });
      expect(window.YouTubeUtils.isChannelRoute()).toBe(true);
    });

    test('createIsRelevantRoute creates composed route check predicate', () => {
      const isRelevant = window.YouTubeUtils.createIsRelevantRoute({
        watch: true,
        shorts: true,
        channel: true,
        domain: true,
        settingsModal: true,
      });

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '',
        href: 'https://www.youtube.com/watch',
      });
      expect(isRelevant()).toBe(true);

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/feed/subscriptions',
        search: '',
        href: 'https://www.youtube.com/feed/subscriptions',
      });
      expect(isRelevant()).toBe(false);

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/shorts/xyz12345678',
        search: '',
        href: 'https://www.youtube.com/shorts/xyz12345678',
      });
      expect(isRelevant()).toBe(true);

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/channel/UC12345',
        search: '',
        href: 'https://www.youtube.com/channel/UC12345',
      });
      expect(isRelevant()).toBe(true);

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/feed/trending',
        search: '',
        href: 'https://www.youtube.com/feed/trending',
      });
      const modal = document.createElement('div');
      modal.className = 'yp-settings-modal';
      document.body.appendChild(modal);
      expect(isRelevant()).toBe(true);
    });

    test('getScriptVersion reads the manager metadata and never invents a literal', () => {
      const getVersion = window.YouTubeUtils.getScriptVersion;
      const saved = globalThis.GM_info;
      try {
        globalThis.GM_info = { script: { version: '9.8.7', name: 'YouTube +' } };
        expect(getVersion()).toBe('9.8.7');
        globalThis.GM_info = { script: { version: '' } };
        expect(getVersion()).toBe('dev');
        globalThis.GM_info = { script: {} };
        expect(getVersion()).toBe('dev');
        delete globalThis.GM_info;
        expect(getVersion()).toBe('dev');
        Object.defineProperty(globalThis, 'GM_info', {
          configurable: true,
          get() {
            throw new Error('manager API unavailable');
          },
        });
        expect(getVersion()).toBe('dev');
      } finally {
        Object.defineProperty(globalThis, 'GM_info', {
          configurable: true,
          writable: true,
          value: saved,
        });
        if (saved === undefined) delete globalThis.GM_info;
      }
    });

    test('getVideoIdFromLocation extracts ID from various URL patterns', () => {
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '?v=1234567890a',
        href: 'https://www.youtube.com/watch?v=1234567890a',
      });
      expect(window.YouTubeUtils.getVideoIdFromLocation()).toBe('1234567890a');

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/shorts/1234567890b',
        search: '',
        href: 'https://www.youtube.com/shorts/1234567890b',
      });
      expect(window.YouTubeUtils.getVideoIdFromLocation()).toBe('1234567890b');

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/live/1234567890c',
        search: '',
        href: 'https://www.youtube.com/live/1234567890c',
      });
      expect(window.YouTubeUtils.getVideoIdFromLocation()).toBe('1234567890c');

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/feed/trending',
        search: '',
        href: 'https://www.youtube.com/feed/trending',
      });
      expect(window.YouTubeUtils.getVideoIdFromLocation()).toBeNull();
    });

    test('createHTML, sanitizeHTML and getLanguage behave predictably', () => {
      expect(window.YouTubeUtils.createHTML('<div>test</div>')).toBe('<div>test</div>');
      expect(window.YouTubeUtils.sanitizeHTML(null)).toBe('');
      expect(window.YouTubeUtils.sanitizeHTML('<b>text</b>')).toBeDefined();

      const lang = window.YouTubeUtils.getLanguage();
      expect(typeof lang).toBe('string');
      expect(lang.length).toBeGreaterThan(0);
    });

    test('isEditableTarget identifies editable elements correctly', () => {
      expect(window.YouTubeUtils.isEditableTarget(null)).toBe(false);
      expect(window.YouTubeUtils.isEditableTarget(document.createElement('div'))).toBe(false);

      const input = document.createElement('input');
      expect(window.YouTubeUtils.isEditableTarget(input)).toBe(true);

      const textarea = document.createElement('textarea');
      expect(window.YouTubeUtils.isEditableTarget(textarea)).toBe(true);

      const select = document.createElement('select');
      expect(window.YouTubeUtils.isEditableTarget(select)).toBe(true);

      const editableDiv = document.createElement('div');
      editableDiv.isContentEditable = true;
      expect(window.YouTubeUtils.isEditableTarget(editableDiv)).toBe(true);
    });

    test('createExperimentalNavClickHandler responds to nav and language events', () => {
      const handlerFn = jest.fn();
      const clickHandler = window.YouTubeUtils.createExperimentalNavClickHandler(handlerFn);

      const container = document.createElement('div');
      const item = document.createElement('div');
      item.className = 'yp-settings-nav-item';
      item.dataset.section = 'experimental';
      container.appendChild(item);
      document.body.appendChild(container);

      clickHandler({ target: item });
      expect(handlerFn).toHaveBeenCalledTimes(1);

      document.dispatchEvent(new Event('youtube-plus-language-changed'));
      expect(handlerFn).toHaveBeenCalledTimes(2);
    });

    test('createVisibilityAwareInterval lifecycle controls', () => {
      jest.useFakeTimers();
      const tick = jest.fn();
      const interval = window.YouTubeUtils.createVisibilityAwareInterval(tick, 100);

      expect(interval.active).toBe(true);
      jest.advanceTimersByTime(100);
      expect(tick).toHaveBeenCalledTimes(1);

      interval.pause();
      expect(interval.active).toBe(false);
      jest.advanceTimersByTime(200);
      expect(tick).toHaveBeenCalledTimes(1);

      interval.resume();
      expect(interval.active).toBe(true);
      jest.advanceTimersByTime(100);
      expect(tick).toHaveBeenCalledTimes(2);

      interval.stop();
      expect(interval.active).toBe(false);
      jest.clearAllTimers();
    });

    test('logger methods and safeRequestAnimationFrame execute safely', () => {
      const logger = window.YouTubeUtils.logger;
      expect(() => {
        logger.info('test info');
        logger.warn('test warn');
        logger.error('test error');
        logger.debug('test debug');
      }).not.toThrow();

      const rafCallback = jest.fn();
      const rafId = window.YouTubeUtils.safeRequestAnimationFrame(rafCallback);
      expect(rafId).toBeDefined();

      const scheduler = window.YouTubeUtils.createRetryScheduler({ check: () => true });
      expect(scheduler).toBeNull();
    });
  });

  describe('normalizeSuppressedError + logSuppressed', () => {
    let logErrorMock;

    beforeEach(() => {
      logErrorMock = jest.fn();
      Object.defineProperty(window, 'YouTubePlusErrorBoundary', {
        configurable: true,
        writable: true,
        value: { logError: logErrorMock },
      });
    });

    test('normalizeSuppressedError keeps Error instance identity', () => {
      const error = new Error('original');
      expect(window.YouTubeUtils.normalizeSuppressedError(error)).toBe(error);
    });

    test('logSuppressed passes Error instance through unchanged', () => {
      const error = new Error('keep identity');
      window.YouTubeUtils.logSuppressed(error, 'TestModule');

      expect(logErrorMock).toHaveBeenCalledTimes(1);
      const [err, ctx] = logErrorMock.mock.calls[0];
      expect(err).toBe(error);
      expect(ctx.module).toBe('TestModule');
    });

    test('logSuppressed normalizes string to Error with message', () => {
      window.YouTubeUtils.logSuppressed('a', 'TestModule');

      expect(logErrorMock).toHaveBeenCalledTimes(1);
      const err = logErrorMock.mock.calls[0][0];
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('a');
    });

    test('logSuppressed normalizes undefined to sentinel, not "undefined"', () => {
      window.YouTubeUtils.logSuppressed(undefined, 'TestModule');

      const err = logErrorMock.mock.calls[0][0];
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('suppressed error');
    });

    test('logSuppressed normalizes null to sentinel', () => {
      window.YouTubeUtils.logSuppressed(null, 'TestModule');

      const err = logErrorMock.mock.calls[0][0];
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('suppressed error');
    });

    test('logSuppressed extracts message from object shapes', () => {
      window.YouTubeUtils.logSuppressed({ message: 'x' }, 'TestModule');

      const err = logErrorMock.mock.calls[0][0];
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('x');
    });

    test('logSuppressed normalizes empty string to sentinel', () => {
      window.YouTubeUtils.logSuppressed('', 'TestModule');

      const err = logErrorMock.mock.calls[0][0];
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('suppressed error');
    });

    test('logSuppressed tolerates missing error boundary without throwing', () => {
      Object.defineProperty(window, 'YouTubePlusErrorBoundary', {
        configurable: true,
        writable: true,
        value: undefined,
      });

      expect(() => window.YouTubeUtils.logSuppressed('a', 'TestModule')).not.toThrow();
    });
  });

  describe('navigateTo', () => {
    test('loads the given URL in the current tab', () => {
      require('../src/utils.js');
      window.YouTubeUtils.navigateTo('#yp-navigate-test');
      expect(window.location.hash).toBe('#yp-navigate-test');
    });
  });

  describe('confirmDialog', () => {
    test('shows a focus-trapped dialog; Escape resolves false and restores focus', async () => {
      require('../src/utils.js');
      const U = window.YouTubeUtils;
      expect(typeof U.confirmDialog).toBe('function');

      if (!document.body.isConnected) document.documentElement.appendChild(document.body);
      const anchor = document.createElement('button');
      document.body.appendChild(anchor);
      anchor.focus();
      expect(document.activeElement).toBe(anchor);

      const promise = U.confirmDialog({ message: 'Delete intro?' });
      expect(promise).toBeInstanceOf(Promise);
      const backdrop = document.body.querySelector('.yp-confirm-backdrop');
      expect(backdrop).toBeTruthy();
      const dialog = document.body.querySelector('.yp-confirm-dialog');
      expect(dialog?.getAttribute('role')).toBe('dialog');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(dialog?.textContent).toContain('Delete intro?');

      const cancel = dialog.querySelector('.yp-confirm-cancel');
      const ok = dialog.querySelector('.yp-confirm-confirm');
      expect(document.activeElement).toBe(cancel);

      // Focus trap: Tab cycles between the two buttons and never leaves.
      cancel.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );
      expect(document.activeElement).toBe(ok);
      ok.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );
      expect(document.activeElement).toBe(cancel);

      // Escape cancels, the dialog is removed and focus is restored.
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await expect(promise).resolves.toBe(false);
      expect(document.body.querySelector('.yp-confirm-backdrop')).toBeNull();
      expect(document.activeElement).toBe(anchor);
    });

    test('confirm button resolves true, custom labels are honored, dialog is removed', async () => {
      require('../src/utils.js');
      const U = window.YouTubeUtils;
      if (!document.body.isConnected) document.documentElement.appendChild(document.body);

      const promise = U.confirmDialog({
        message: 'Proceed?',
        confirmLabel: 'Yes',
        cancelLabel: 'No',
      });
      const dialog = document.body.querySelector('.yp-confirm-dialog');
      expect(dialog.querySelector('.yp-confirm-confirm').textContent).toBe('Yes');
      expect(dialog.querySelector('.yp-confirm-cancel').textContent).toBe('No');

      dialog.querySelector('.yp-confirm-confirm').click();
      await expect(promise).resolves.toBe(true);
      expect(document.body.querySelector('.yp-confirm-backdrop')).toBeNull();
    });

    test('clicking the backdrop cancels like Escape', async () => {
      require('../src/utils.js');
      const U = window.YouTubeUtils;
      if (!document.body.isConnected) document.documentElement.appendChild(document.body);

      const promise = U.confirmDialog({ message: 'Proceed?' });
      document.body.querySelector('.yp-confirm-backdrop').click();
      await expect(promise).resolves.toBe(false);
      expect(document.body.querySelector('.yp-confirm-backdrop')).toBeNull();
    });
  });

  describe('yp-history-navigate without monkey-patching history', () => {
    test('history.pushState === History.prototype.pushState after utils.js loads', () => {
      expect(window.history.pushState).toBe(window.History.prototype.pushState);
      expect(window.history.replaceState).toBe(window.History.prototype.replaceState);
    });

    test('each source emits exactly one event per URL change with expected detail.type', () => {
      const events = [];
      const onNavigate = e => events.push(e.detail);
      window.addEventListener('yp-history-navigate', onNavigate);

      // 1. Navigation API navigatesuccess
      global.mockLocation({ href: 'https://www.youtube.com/watch?v=source1' });
      window.navigation.dispatchEvent(new Event('navigatesuccess'));
      expect(events).toEqual([{ type: 'navigate' }]);

      // 2. Document yt-navigate-finish
      global.mockLocation({ href: 'https://www.youtube.com/watch?v=source2' });
      document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      expect(events).toEqual([{ type: 'navigate' }, { type: 'navigate' }]);

      // 3. Window yt-navigate-finish
      global.mockLocation({ href: 'https://www.youtube.com/watch?v=source3' });
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      expect(events).toEqual([{ type: 'navigate' }, { type: 'navigate' }, { type: 'navigate' }]);

      // 4. Window popstate
      global.mockLocation({ href: 'https://www.youtube.com/watch?v=source4' });
      window.dispatchEvent(new Event('popstate'));
      expect(events).toEqual([
        { type: 'navigate' },
        { type: 'navigate' },
        { type: 'navigate' },
        { type: 'popstate' },
      ]);

      window.removeEventListener('yp-history-navigate', onNavigate);
    });

    test('the same URL twice gives one event', () => {
      const events = [];
      const onNavigate = e => events.push(e.detail);
      window.addEventListener('yp-history-navigate', onNavigate);

      global.mockLocation({ href: 'https://www.youtube.com/watch?v=dedup1' });

      // First trigger on new URL emits one event
      window.navigation.dispatchEvent(new Event('navigatesuccess'));
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'navigate' });

      // Multiple subsequent triggers from same or other sources on unchanged URL are ignored
      window.navigation.dispatchEvent(new Event('navigatesuccess'));
      document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      window.dispatchEvent(new Event('popstate'));
      expect(events).toHaveLength(1);

      // Transition to a different URL emits again
      global.mockLocation({ href: 'https://www.youtube.com/watch?v=dedup2' });
      document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      expect(events).toHaveLength(2);

      // Second trigger on dedup2 is ignored
      document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      expect(events).toHaveLength(2);

      window.removeEventListener('yp-history-navigate', onNavigate);
    });

    test('session listeners survive per-navigation cleanup sweeps', () => {
      const events = [];
      const onNavigate = e => events.push(e.detail);
      window.addEventListener('yp-history-navigate', onNavigate);

      global.mockLocation({ href: 'https://www.youtube.com/watch?v=sweep1' });
      document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      expect(events).toHaveLength(1);

      // Trigger a page navigation cleanup sweep
      window.YouTubePlusCleanupManager.cleanup();

      // Navigation listeners are session-scoped and continue emitting
      global.mockLocation({ href: 'https://www.youtube.com/watch?v=sweep2' });
      document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      expect(events).toHaveLength(2);

      window.removeEventListener('yp-history-navigate', onNavigate);
    });
  });

  describe('getPageWindow', () => {
    test('returns the page window when unsafeWindow has no wrappedJSObject', () => {
      expect(window.YouTubeUtils.getPageWindow()).toBe(window);
    });
  });
});
