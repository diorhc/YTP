/**
 * @jest-environment jsdom
 *
 * The Vision dock's visibility is owned entirely by the stylesheet
 * (`.ytp-autohide`/`.ytp-hide-controls .vision-top-center-dock` in
 * yp-player-surface-styles), so it matches YouTube's control bar with no inline
 * styles. A YouTube player rebuild drops the dock, so it is re-inserted on the
 * player lifecycle events.
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/mutation-coordinator.js');
  require('../src/feature-registry.js');
}

/** @returns {HTMLElement} */
function makePlayer() {
  const player = document.createElement('div');
  player.id = 'movie_player';
  document.body.appendChild(player);
  return player;
}
beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = '';
  delete window.YouTubePlusFeatureRegistry;
  delete window.YouTubePlusMutationCoordinator;
  delete window.YouTubePlusSettingsStore;
  delete window._ytpVisionDockHostSettingsKey;
  // Force the Vision variant and satisfy the settings host reads.
  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: { getThemeVariant: () => 'vision' },
  });
  Object.defineProperty(window, 'YouTubePlusSettingsStore', {
    configurable: true,
    writable: true,
    value: { get: () => true, hasKey: () => true, subscribe: () => () => undefined },
  });
  loadChain();
});

afterEach(() => {
  window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  delete window.YouTubePlusDesignSystem;
});

test('a dock dropped by a player rebuild is re-inserted on the lifecycle event', () => {
  const player = makePlayer();
  const host = window.YouTubePlusFeatureRegistry.VisionDockHost;
  host.mount(player);

  player.querySelector('.vision-top-center-dock')?.remove();
  expect(player.querySelector('.vision-top-center-dock')).toBeNull();

  document.dispatchEvent(new Event('yt-player-updated'));
  expect(player.querySelector('.vision-top-center-dock')).not.toBeNull();
});

test('a dock dropped without a lifecycle event is re-inserted by ensureVisible', () => {
  const player = makePlayer();
  const host = window.YouTubePlusFeatureRegistry.VisionDockHost;
  host.mount(player);

  player.querySelector('.vision-top-center-dock')?.remove();
  host.ensureVisible();
  expect(player.querySelector('.vision-top-center-dock')).not.toBeNull();
});
