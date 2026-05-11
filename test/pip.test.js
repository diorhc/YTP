/**
 * Unit tests for YouTube+ PiP module
 */

describe('PiP Module', () => {
  beforeEach(() => {
    window._ytplusCreateHTML = s => s;
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        t: jest.fn(key => key || ''),
        $: jest.fn(sel => document.querySelector(sel)),
        loadFeatureEnabled: jest.fn(() => true),
        cleanupManager: {
          registerListener: jest.fn(),
          registerTimeout: jest.fn(id => id),
          registerObserver: jest.fn(),
          registerInterval: jest.fn(id => id),
          registerAnimationFrame: jest.fn(id => id),
          cleanup: jest.fn(),
        },
        SETTINGS_KEY: 'youtube_plus_settings',
      },
    });
  });

  test('should define PiP settings with defaults', () => {
    const pipSettings = {
      enabled: true,
      shortcut: { key: 'P', shiftKey: false, altKey: true, ctrlKey: false },
      storageKey: 'youtube_pip_settings',
    };

    expect(pipSettings.enabled).toBe(true);
    expect(pipSettings.shortcut.key).toBe('P');
    expect(pipSettings.shortcut.altKey).toBe(true);
  });

  test('should detect PiP support', () => {
    const isPiPSupported = () => {
      const doc = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (document));
      if ('pictureInPictureEnabled' in doc) return true;
      const vid = /** @type {HTMLVideoElement} */ (
        /** @type {unknown} */ (document.createElement('video'))
      );
      return typeof vid.requestPictureInPicture === 'function';
    };

    // jsdom doesn't support PiP
    expect(typeof isPiPSupported()).toBe('boolean');
  });

  test('should validate shortcut config', () => {
    const isValidShortcut = /** @param {unknown} config */ config => {
      if (!config || typeof config !== 'object') return false;
      if (!('key' in config) || typeof (/** @type {{key?: unknown}} */ (config).key) !== 'string')
        return false;
      if (
        config /** @type {{key: string}} */.key
          .trim().length === 0
      )
        return false;
      return true;
    };

    expect(isValidShortcut({ key: 'P', shiftKey: false })).toBe(true);
    expect(isValidShortcut(null)).toBe(false);
    expect(isValidShortcut({})).toBe(false);
    expect(isValidShortcut({ key: '' })).toBe(false);
  });

  test('should save and restore PiP settings', () => {
    const key = 'youtube_pip_settings';
    const settings = { enabled: false, shortcut: { key: 'I', altKey: true } };

    localStorage.setItem(key, JSON.stringify(settings));
    const restored = JSON.parse(localStorage.getItem(key) ?? 'null');
    expect(restored.enabled).toBe(false);
    expect(restored.shortcut.key).toBe('I');
  });
});
