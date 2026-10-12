/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://music.youtube.com/"}
 *
 * music.js watches the legacy GM key `youtube-plus-music-settings` for cross-tab
 * sync only while the shared blob does not exist. Once the blob is present the
 * unified settings event is the single source, so the legacy listener is skipped.
 */

const LEGACY = 'youtube-plus-music-settings';

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

/** @param {boolean} hasBlob */
function setupDeps(hasBlob) {
  /** @type {{ key: string, cb: Function }[]} */
  const gmListeners = [];
  globalThis.GM_addValueChangeListener = (key, cb) => {
    gmListeners.push({ key, cb });
    return gmListeners.length;
  };

  Object.defineProperty(window, 'YouTubePlusCleanupManager', {
    configurable: true,
    writable: true,
    value: { registerListener: jest.fn() },
  });

  Object.defineProperty(window, 'YouTubePlusSettingsStore', {
    configurable: true,
    writable: true,
    value: {
      hasSharedSettings: () => hasBlob,
      getMusicSettings: () => ({ ...musicDefaults }),
      affectsModule: () => true,
    },
  });

  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      $: jest.fn(() => null),
      $$: jest.fn(() => []),
      byId: jest.fn(() => null),
      t: jest.fn(key => key || ''),
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      loadFeatureEnabled: jest.fn(() => true),
      isMusicDomain: jest.fn(() => true),
      getHostname: jest.fn(() => 'music.youtube.com'),
      createWithErrorBoundary: jest.fn(() => fn => fn),
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
    value: { getStyle: jest.fn(() => '') },
  });

  return { gmListeners };
}

afterEach(() => {
  delete globalThis.GM_addValueChangeListener;
  delete window.YouTubePlusMusic;
  delete window.YouTubeMusic;
  delete window.YouTubePlusSettingsStore;
  delete window.YouTubePlusCleanupManager;
});

test('the legacy GM listener is skipped once the shared blob exists', () => {
  jest.resetModules();
  const { gmListeners } = setupDeps(true);

  require('../src/music.js');

  expect(gmListeners.filter(listener => listener.key === LEGACY)).toHaveLength(0);
});

test('the legacy GM listener is registered while the blob is absent', () => {
  jest.resetModules();
  const { gmListeners } = setupDeps(false);

  require('../src/music.js');

  const legacy = gmListeners.filter(listener => listener.key === LEGACY);
  expect(legacy).toHaveLength(1);
  // The callback re-reads settings for the pre-blob cross-tab path.
  expect(() => legacy[0].cb()).not.toThrow();
});

test('without GM storage the legacy listener is simply not registered', () => {
  jest.resetModules();
  const { gmListeners } = setupDeps(false);
  delete globalThis.GM_addValueChangeListener;

  expect(() => require('../src/music.js')).not.toThrow();
  expect(gmListeners).toHaveLength(0);
});
