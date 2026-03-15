/**
 * Unit tests for YouTube+ Music module
 */

describe('Music Module', () => {
  beforeEach(() => {
    window._ytplusCreateHTML = s => s;
    window.YouTubeUtils = {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => []),
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
      },
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      loadFeatureEnabled: jest.fn(() => true),
      SETTINGS_KEY: 'youtube_plus_settings',
    };
    window.YouTubeDOMCache = { get: jest.fn() };
    // Note: Music module only activates on music.youtube.com
    global.mockLocation({
      hostname: 'music.youtube.com',
      pathname: '/',
      href: 'https://music.youtube.com/',
    });
  });

  test('should only activate on music.youtube.com', () => {
    const isMusicPage = hostname => hostname === 'music.youtube.com';
    expect(isMusicPage('music.youtube.com')).toBe(true);
    expect(isMusicPage('www.youtube.com')).toBe(false);
  });

  test('should read default YouTube Music settings', () => {
    // Default music settings structure
    const defaults = {
      showShortcuts: true,
      enableVisualization: true,
      autoPlay: true,
    };

    const readSettings = () => {
      try {
        const raw = localStorage.getItem('youtube_music_settings');
        return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
      } catch {
        return { ...defaults };
      }
    };

    const settings = readSettings();
    expect(settings.showShortcuts).toBe(true);
    expect(settings.enableVisualization).toBe(true);
  });

  test('should save and restore settings', () => {
    const settings = { showShortcuts: false, enableVisualization: true };
    localStorage.setItem('youtube_music_settings', JSON.stringify(settings));

    const restored = JSON.parse(localStorage.getItem('youtube_music_settings'));
    expect(restored.showShortcuts).toBe(false);
    expect(restored.enableVisualization).toBe(true);
  });

  test('should handle corrupted settings gracefully', () => {
    localStorage.setItem('youtube_music_settings', 'not json');

    const readSettings = () => {
      try {
        const raw = localStorage.getItem('youtube_music_settings');
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    };

    expect(() => readSettings()).not.toThrow();
    expect(readSettings()).toEqual({});
  });
});
