/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://music.youtube.com/"}
 *
 * Unit tests for YouTube+ Music module
 *
 * Tests the real music.js IIFE through its public window.YouTubePlusMusic facade
 * and the canonical settings store integration.
 */

describe('Music Module', () => {
  const musicDefaults = {
    enableMusic: true,
    immersiveSearchStyles: true,
    hoverStyles: true,
    playerSidebarStyles: true,
    centeredPlayerStyles: true,
    playerBarStyles: true,
    centeredPlayerBarStyles: true,
    miniPlayerStyles: true,
    scrollToTopStyles: true,
  };

  /** @type {jest.Mock} */
  let styleManagerAdd;
  /** @type {jest.Mock} */
  let styleManagerRemove;
  /** @type {jest.Mock} */
  let getMusicSettings;

  const setupMusicDeps = () => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    styleManagerAdd = jest.fn();
    styleManagerRemove = jest.fn();

    getMusicSettings = jest.fn(() => ({ ...musicDefaults }));

    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: {
        getMusicSettings,
        /** Mirrors the store's changed-key routing for the module filters. */
        affectsModule: (event, name, alsoKeys = []) => {
          const keys = event?.changedKeys;
          if (!Array.isArray(keys)) return true;
          return keys.some(
            k =>
              k === 'modules' ||
              k === `modules.${name}` ||
              k.startsWith(`modules.${name}.`) ||
              alsoKeys.includes(k)
          );
        },
      },
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(sel => document.querySelector(sel)),
        $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
        t: jest.fn(key => key || ''),
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
        StyleManager: { add: styleManagerAdd, remove: styleManagerRemove, clear: jest.fn() },
        loadFeatureEnabled: jest.fn(() => true),
        isMusicDomain: jest.fn(() => true),
        createWithErrorBoundary: jest.fn(() => fn => fn),
        createVisibilityAwareInterval: jest.fn(() => ({
          stop: jest.fn(),
          pause: jest.fn(),
          resume: jest.fn(),
          active: true,
        })),
        logSuppressed: jest.fn(),
        whenRelevant: jest.fn(opts => {
          if (typeof opts.onEnter === 'function') opts.onEnter();
          return { active: true, check: jest.fn(), dispose: jest.fn() };
        }),
      },
    });

    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: {
        getStyle: jest.fn(id => {
          if (id && id.includes('music')) return `/* ${id} */ .ytmusic-nav-bar { border: none; }`;
          return '';
        }),
      },
    });

    Object.defineProperty(window, 'YouTubePlusDOMCache', {
      configurable: true,
      writable: true,
      value: {
        get: jest.fn(),
        getAll: jest.fn(),
        querySelector: jest.fn(),
        querySelectorAll: jest.fn(),
        getElementById: jest.fn(),
        invalidate: jest.fn(),
        clear: jest.fn(),
      },
    });
  };

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusMusic;
    delete window.YouTubeMusic;
    setupMusicDeps();
  });

  test('exposes public facade on music.youtube.com', () => {
    require('../src/music.js');

    expect(window.YouTubePlusMusic).toBeDefined();
    expect(window.YouTubeMusic).toBe(window.YouTubePlusMusic);
    expect(typeof window.YouTubePlusMusic.saveSettings).toBe('function');
    expect(typeof window.YouTubePlusMusic.applySettingsChanges).toBe('function');
  });

  test('applies styles when enableMusic is true on load', () => {
    require('../src/music.js');

    expect(styleManagerAdd).toHaveBeenCalled();
    const musicStyleCall = styleManagerAdd.mock.calls.find(
      ([key]) => key === 'youtube-plus-music-styles'
    );
    expect(musicStyleCall).toBeTruthy();
    expect(musicStyleCall[1]).toContain('music');
  });

  test('applySettingsChanges removes styles when enableMusic becomes false', () => {
    require('../src/music.js');
    expect(window.YouTubePlusMusic).toBeDefined();

    getMusicSettings.mockReturnValue({ ...musicDefaults, enableMusic: false });
    window.YouTubePlusMusic.applySettingsChanges();

    expect(styleManagerRemove).toHaveBeenCalledWith('youtube-plus-music-styles');
    const styleEl = document.getElementById('youtube-plus-music-styles');
    expect(styleEl).toBeNull();
  });

  test('applySettingsChanges re-applies styles when enableMusic toggles back on', () => {
    require('../src/music.js');
    expect(window.YouTubePlusMusic).toBeDefined();

    getMusicSettings.mockReturnValue({ ...musicDefaults, enableMusic: false });
    window.YouTubePlusMusic.applySettingsChanges();

    const removeCallsBefore = styleManagerRemove.mock.calls.length;

    getMusicSettings.mockReturnValue({ ...musicDefaults, enableMusic: true });
    window.YouTubePlusMusic.applySettingsChanges();

    expect(styleManagerAdd.mock.calls.length).toBeGreaterThan(removeCallsBefore);
    const lastAdd = styleManagerAdd.mock.calls[styleManagerAdd.mock.calls.length - 1];
    expect(lastAdd[0]).toBe('youtube-plus-music-styles');
  });

  test('saveSettings syncs the live-apply snapshot from the canonical store', () => {
    require('../src/music.js');
    const api = window.YouTubePlusMusic;

    // Object argument: the module keeps the provided snapshot for live-apply.
    expect(() => api.saveSettings({ ...musicDefaults, enableMusic: false })).not.toThrow();

    // Empty argument: the snapshot is re-read from the canonical store.
    getMusicSettings.mockClear();
    api.saveSettings(null);
    expect(getMusicSettings).toHaveBeenCalledTimes(1);
  });

  test('falls back to defaults when the settings store is absent', () => {
    require('../src/music.js');
    const api = window.YouTubePlusMusic;

    delete window.YouTubePlusSettingsStore;
    expect(() => api.applySettingsChanges()).not.toThrow();
    expect(styleManagerAdd).toHaveBeenCalledWith('youtube-plus-music-styles', expect.any(String));
  });

  test('re-applies from the unified settings event only for music keys', () => {
    require('../src/music.js');

    const callsBefore = styleManagerAdd.mock.calls.length;
    window.dispatchEvent(
      Object.assign(new CustomEvent('youtube-plus-settings-updated'), {
        changedKeys: ['styles.themeVariant'],
      })
    );
    expect(styleManagerAdd.mock.calls.length).toBe(callsBefore);

    getMusicSettings.mockReturnValue({ ...musicDefaults, hoverStyles: false });
    window.dispatchEvent(
      Object.assign(new CustomEvent('youtube-plus-settings-updated'), {
        changedKeys: ['modules.music.hoverStyles'],
      })
    );
    expect(styleManagerAdd.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
