/**
 * @jest-environment jsdom
 *
 * On the real page the dock mounts before a feature's FeatureLifecycle start,
 * so its button is missing until the dock re-renders. A feature that starts (or
 * stops) later must add (or drop) its button without a settings event.
 */

function makeStore() {
  return {
    /** @type {Record<string, unknown>} */
    values: { enableProbe: true },
    /** @param {string} key */
    get(key) {
      return this.values[key];
    },
    hasKey: () => true,
    subscribe: () => () => undefined,
  };
}

function load() {
  jest.resetModules();
  document.body.innerHTML = '';
  delete window.YouTubePlusFeatureRegistry;
  delete window.YouTubePlusMutationCoordinator;
  const store = makeStore();
  Object.defineProperty(window, 'YouTubePlusSettingsStore', {
    configurable: true,
    writable: true,
    value: store,
  });
  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: { getThemeVariant: () => 'vision' },
  });
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/mutation-coordinator.js');
  require('../src/feature-registry.js');
  return store;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 40));

test('a feature started after mount adds its dock button without a settings event', async () => {
  const store = load();
  const registry = window.YouTubePlusFeatureRegistry;
  const player = document.createElement('div');
  player.id = 'movie_player';
  document.body.appendChild(player);

  let available = false;
  registry.register({
    id: 'probe',
    titleKey: 'probe',
    settingsKey: 'enableProbe',
    iconSVG: '<svg viewBox="0 0 24 24"></svg>',
    isAvailable: () => available,
  });

  // Mount runs before the feature can run: no button yet.
  registry.VisionDockHost.mount(player);
  expect(player.querySelector('.yp-probe-button')).toBeNull();

  // The feature starts (its availability flips on): the dock re-renders.
  available = true;
  const handle = registry.FeatureLifecycle.define({
    id: 'probe',
    settingsKey: 'enableProbe',
    start: () => undefined,
  });
  expect(handle).not.toBeNull();
  handle?.sync();
  await flush();
  expect(player.querySelector('.yp-probe-button')).not.toBeNull();

  // Stopping the feature removes its button again.
  store.values.enableProbe = false;
  handle?.sync();
  await flush();
  expect(player.querySelector('.yp-probe-button')).toBeNull();
});

test('a registration while the dock is present triggers a re-render', async () => {
  load();
  const registry = window.YouTubePlusFeatureRegistry;
  const player = document.createElement('div');
  player.id = 'movie_player';
  document.body.appendChild(player);
  registry.VisionDockHost.mount(player);

  registry.register({
    id: 'late',
    titleKey: 'late',
    settingsKey: 'enableProbe',
    iconSVG: '<svg viewBox="0 0 24 24"></svg>',
  });
  await flush();
  expect(player.querySelector('.yp-late-button')).not.toBeNull();
});
