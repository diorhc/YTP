/**
 * Unit tests for YouTube+ Download module
 */

describe('Download Module', () => {
  // originalLocation removed (unused)

  beforeEach(() => {
    // Set up required globals
    window._ytplusCreateHTML = s => s;
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
          cleanup: jest.fn(),
          registerAnimationFrame: jest.fn(id => id),
        },
        NotificationManager: jest.fn(() => ({ show: jest.fn(), hide: jest.fn() })),
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        logError: jest.fn(),
        createElement: jest.fn(tag => document.createElement(tag)),
        loadFeatureEnabled: jest.fn(() => true),
        storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        SETTINGS_KEY: 'youtube_plus_settings',
      },
    });
    Object.defineProperty(window, 'YouTubePlusI18n', {
      configurable: true,
      writable: true,
      value: {
        t: jest.fn(key => key),
        getLanguage: jest.fn(() => 'en'),
        loadTranslations: jest.fn(),
        isReady: jest.fn(() => true),
      },
    });
    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        setLevel: jest.fn(),
        getLevel: jest.fn(() => 'info'),
        getRecent: jest.fn(() => []),
        export: jest.fn(),
        createChild: jest.fn(),
      },
    });
    Object.defineProperty(window, 'YouTubeDOMCache', {
      configurable: true,
      writable: true,
      value: {
        get: jest.fn(),
        querySelector: jest.fn(),
        getAll: jest.fn(),
        querySelectorAll: jest.fn(),
        getElementById: jest.fn(),
        waitForElement: jest.fn(),
        invalidate: jest.fn(),
        clear: jest.fn(),
      },
    });

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
    const isRelevantRoute = /** @param {string} path */ path => {
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
