/**
 * Route-scoped features on studio.youtube.com: the domain is its own route,
 * so `watch` / `channel` never match there.
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://studio.youtube.com/channel/UC1"}
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
}

const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;

describe('FeatureLifecycle routes on studio.youtube.com', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    loadChain();
    window.YouTubePlusSettingsStore.set('enablePlayAll', true);
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('getRoute is studio whatever the path', () => {
    expect(window.YouTubeUtils.getRoute()).toBe('studio');
  });

  test('a feature for YouTube pages does not start here', () => {
    const start = jest.fn();
    lifecycle()
      .define({ id: 'probe', settingsKey: 'enablePlayAll', routes: ['watch', 'channel'], start })
      .sync();
    expect(start).not.toHaveBeenCalled();
  });

  test('a feature that lists studio starts here', () => {
    const start = jest.fn();
    lifecycle()
      .define({ id: 'probe', settingsKey: 'enablePlayAll', routes: ['studio'], start })
      .sync();
    expect(start).toHaveBeenCalledTimes(1);
  });
});
