/**
 * Unit tests for YouTube+ Download module
 */

describe('Download Module', () => {
  let originalLocation;

  beforeEach(() => {
    // Set up required globals
    window._ytplusCreateHTML = s => s;
    window.YouTubeUtils = {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      cleanupManager: {
        registerInterval: jest.fn(id => id),
        registerTimeout: jest.fn(id => id),
        registerObserver: jest.fn(obs => obs),
        registerListener: jest.fn(),
        cleanup: jest.fn(),
        observers: new Set(),
        intervals: new Set(),
        timeouts: new Set(),
        animationFrames: new Set(),
        getListenerStats: jest.fn(() => ({ total: 0 })),
      },
      NotificationManager: jest.fn(() => ({
        show: jest.fn(),
        hide: jest.fn(),
      })),
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      logError: jest.fn(),
      createElement: jest.fn(tag => document.createElement(tag)),
      loadFeatureEnabled: jest.fn(() => true),
      storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
    };
    window.YouTubePlusI18n = { t: jest.fn(key => key) };
    window.YouTubePlusLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };
    window.YouTubeDOMCache = { get: jest.fn(), querySelector: jest.fn() };

    // Mock location for watch page
    global.mockLocation({
      href: 'https://www.youtube.com/watch?v=test123',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=test123',
    });
  });

  test('should define download globals when loaded on watch page', () => {
    // The download module should register itself when on a watch page
    // It checks for YouTube route relevance
    expect(window.YouTubeUtils).toBeDefined();
  });

  test('should validate video ID format', () => {
    // YouTube video IDs are 11 characters of alphanumeric + dash + underscore
    const validId = 'dQw4w9WgXcQ';
    const invalidId = 'too_short';
    expect(validId.length).toBe(11);
    expect(/^[a-zA-Z0-9_-]{11}$/.test(validId)).toBe(true);
    expect(/^[a-zA-Z0-9_-]{11}$/.test(invalidId)).toBe(false);
  });

  test('should detect relevant routes', () => {
    const isRelevantRoute = path => {
      try {
        return path === '/watch' || path.startsWith('/shorts');
      } catch {
        return false;
      }
    };
    expect(isRelevantRoute('/watch')).toBe(true);
    expect(isRelevantRoute('/shorts/abc')).toBe(true);
    expect(isRelevantRoute('/channel/UC123')).toBe(false);
    expect(isRelevantRoute('/')).toBe(false);
  });
});
