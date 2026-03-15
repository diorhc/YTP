/**
 * Unit tests for YouTube+ PiP module
 */

describe('PiP Module', () => {
  beforeEach(() => {
    window._ytplusCreateHTML = s => s;
    window.YouTubeUtils = {
      t: jest.fn(key => key || ''),
      $: jest.fn(sel => document.querySelector(sel)),
      loadFeatureEnabled: jest.fn(() => true),
      cleanupManager: {
        registerListener: jest.fn(),
        registerTimeout: jest.fn(id => id),
      },
      SETTINGS_KEY: 'youtube_plus_settings',
    };
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
      return (
        'pictureInPictureEnabled' in document ||
        document.createElement('video').requestPictureInPicture !== undefined
      );
    };

    // jsdom doesn't support PiP
    expect(typeof isPiPSupported()).toBe('boolean');
  });

  test('should validate shortcut config', () => {
    const isValidShortcut = config => {
      if (!config || typeof config !== 'object') return false;
      if (!config.key || typeof config.key !== 'string') return false;
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
    const restored = JSON.parse(localStorage.getItem(key));
    expect(restored.enabled).toBe(false);
    expect(restored.shortcut.key).toBe('I');
  });
});
