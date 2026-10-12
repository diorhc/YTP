/**
 * @jest-environment jsdom
 *
 * In the Vision variant there is no classic download button, but the dock
 * button still needs the shared `.download-options` menu. The feature creates
 * the menu on start, and a click or Enter on the dock button opens it.
 */

function loadVision() {
  jest.resetModules();
  document.body.innerHTML = '';
  delete window.YouTubePlusDownload;
  delete window.YouTubePlusDownloadButton;
  delete window.YouTubePlusFeatureRegistry;
  delete window.YouTubePlusSettingsStore;
  localStorage.clear();

  Object.defineProperty(window, 'YouTubePlusSettingsStore', {
    configurable: true,
    writable: true,
    value: {
      get: () => true,
      hasKey: () => true,
      subscribe: () => () => undefined,
      load: () => ({ downloadSites: { externalDownloader: true, ytdl: true, direct: true } }),
    },
  });

  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  window.YouTubeUtils.cleanupManager = window.YouTubePlusCleanupManager;
  window.YouTubeUtils.getRoute = () => 'watch';

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      getThemeVariant: () => 'vision',
      getStyle: () => '',
      StyleManager: { add: () => undefined, remove: () => undefined },
    },
  });

  require('../src/feature-registry.js');
  require('../src/download.js');
}

function mountDockButton() {
  const player = document.createElement('div');
  player.id = 'movie_player';
  document.body.appendChild(player);
  const dock = document.createElement('div');
  dock.className = 'vision-top-center-dock';
  const btn = document.createElement('button');
  btn.id = 'yp-vision-download-btn';
  btn.className = 'vision-dock-btn yp-download-button';
  dock.appendChild(btn);
  player.appendChild(dock);
  return btn;
}

beforeEach(() => {
  mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    search: '?v=abc',
    href: 'https://www.youtube.com/watch?v=abc',
  });
});

test('the Vision dock button has a menu and a click opens it', () => {
  loadVision();

  // No classic button exists, but the shared menu is built anyway.
  expect(document.querySelector('.ytp-right-controls .yp-download-button')).toBeNull();
  expect(document.querySelector('.download-options')).not.toBeNull();

  const btn = mountDockButton();
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  const dropdown = document.querySelector('.download-options');
  expect(dropdown?.classList.contains('visible')).toBe(true);
});

test('Enter on the Vision dock button opens the menu', () => {
  loadVision();
  const btn = mountDockButton();

  btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  const dropdown = document.querySelector('.download-options');
  expect(dropdown?.classList.contains('visible')).toBe(true);
});
