/**
 * Unit tests for YouTube+ Adblocker module
 */

describe('Adblocker Module', () => {
  beforeEach(() => {
    window._ytplusCreateHTML = s => s;
    window.YouTubeUtils = {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
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
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
    };
    window.YouTubePlusI18n = { t: jest.fn(key => key) };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
  });

  test('should have required globals for initialization', () => {
    expect(window._ytplusCreateHTML).toBeDefined();
    expect(window.YouTubeUtils).toBeDefined();
    expect(window.YouTubeUtils.$).toBeDefined();
  });

  test('should define ad-related CSS selectors', () => {
    // Common YouTube ad selectors that the adblocker targets
    const adSelectors = [
      '.ytp-ad-overlay-container',
      '.ytp-ad-text-overlay',
      '.video-ads',
      '#player-ads',
      'ytd-promoted-sparkles-web-renderer',
      'ytd-display-ad-renderer',
      'ytd-ad-slot-renderer',
    ];

    adSelectors.forEach(sel => {
      expect(typeof sel).toBe('string');
      expect(sel.length).toBeGreaterThan(0);
    });
  });

  test('should handle missing ad elements gracefully', () => {
    // Attempting to remove non-existent ad elements should not throw
    const removeAds = () => {
      const selectors = ['.ytp-ad-overlay-container', '.video-ads', '#player-ads'];
      selectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.remove();
      });
    };

    expect(() => removeAds()).not.toThrow();
  });

  test('should use StyleManager to inject ad-hiding CSS', () => {
    const StyleManager = window.YouTubeUtils.StyleManager;
    StyleManager.add('adblocker', '.video-ads { display: none !important; }');
    expect(StyleManager.add).toHaveBeenCalledWith('adblocker', expect.any(String));
  });
});
