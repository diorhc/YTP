/**
 * Playlist Search (src/playlist-search.js) on the FeatureLifecycle contract
 * (feature-registry.js). Real CleanupManager, SettingsStore, EventDelegation,
 * MutationCoordinator and DesignSystem; no behavior stubs.
 * @jest-environment jsdom
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
  require('../src/mutation-coordinator.js');
  require('../src/playlist-search.js');
}

const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;
const store = () => window.YouTubePlusSettingsStore;

function counts() {
  const cm = window.YouTubePlusCleanupManager;
  const mc = window.YouTubePlusMutationCoordinator;
  return {
    listeners: cm.getListenerStats().active,
    observers: cm.observers.size,
    timeouts: cm.timeouts.size + cm.sessionTimeouts.size,
    watchers: mc.getStats().rootSubscribers,
    delegated: window.YouTubePlusEventDelegation?.getStats?.().totalHandlers ?? 0,
  };
}

const styleText = () => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');

/** Watch-page playlist panel with three renderer items. */
function addWatchPlaylist() {
  const panel = document.createElement('ytd-playlist-panel-renderer');
  const items = document.createElement('div');
  items.id = 'items';
  for (let i = 0; i < 3; i++) {
    const item = document.createElement('ytd-playlist-panel-video-renderer');
    item.setAttribute('video-id', `vid${i}`);
    const title = document.createElement('a');
    title.id = 'video-title';
    title.textContent = `Song number ${i} with searchable words`;
    item.appendChild(title);
    const byline = document.createElement('ytd-channel-name');
    const link = document.createElement('a');
    link.textContent = `Channel ${i}`;
    byline.appendChild(link);
    item.appendChild(byline);
    items.appendChild(item);
  }
  panel.appendChild(items);
  document.body.appendChild(panel);
}

/** Poll a boolean predicate with a deadline (jsdom has no waitFor helpers). */
async function waitForCondition(/** @type {() => boolean} */ asFn, /** @type {number} */ ms = 500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (asFn()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  if (!asFn()) throw new Error('condition not met');
}

describe('playlist search on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.YouTubePlusPlaylistSearch;
    window._playlistSearchInitialized = false;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=lifecycle&list=PLlifecycle123',
      search: '?v=lifecycle&list=PLlifecycle123',
    });
    loadChain();
    store().set('enablePlaylistSearch', false);
    require('../src/playlist-search.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('10 on/off cycles return to the starting counts and leave no DOM, CSS or attributes', async () => {
    addWatchPlaylist();

    store().set('enablePlaylistSearch', true);
    await waitForCondition(() => document.querySelector('.yp-playlist-search-input'));
    expect(document.querySelectorAll('.yp-playlist-search')).toHaveLength(1);
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-playlist-delete-styles')).toBe(true);

    store().set('enablePlaylistSearch', false);
    await waitForCondition(() => !document.querySelector('.yp-playlist-search'), 1000);
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-playlist-delete-styles')).toBe(
      false
    );

    const baseline = counts();
    const css = styleText();

    for (let i = 0; i < 10; i++) {
      store().set('enablePlaylistSearch', true);
      await waitForCondition(() => document.querySelector('.yp-playlist-search-input'), 1000);
      expect(document.querySelectorAll('.yp-playlist-search')).toHaveLength(1);
      store().set('enablePlaylistSearch', false);
      await waitForCondition(() => !document.querySelector('.yp-playlist-search'), 1000);
      expect(document.querySelectorAll('.yp-playlist-search')).toHaveLength(0);
    }

    expect(counts()).toEqual(baseline);
    expect(styleText()).toBe(css);
  });

  test('filter still works through the feature-owned delegations after off/on', async () => {
    addWatchPlaylist();

    store().set('enablePlaylistSearch', true);
    await waitForCondition(() => document.querySelector('.yp-playlist-search-input'), 1000);
    const input = /** @type {HTMLInputElement} */ (
      document.querySelector('.yp-playlist-search-input')
    );
    input.value = 'song number 1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForCondition(
      () =>
        document.querySelectorAll('ytd-playlist-panel-video-renderer')[1]?.style.display === '' &&
        document.querySelectorAll('ytd-playlist-panel-video-renderer')[0]?.style.display === 'none',
      1000
    );

    store().set('enablePlaylistSearch', false);
    await waitForCondition(() => !document.querySelector('.yp-playlist-search'), 1000);
    // Switching the feature off shows the items the filter had hidden.
    for (const item of document.querySelectorAll('ytd-playlist-panel-video-renderer')) {
      expect(/** @type {HTMLElement} */ (item).style.display).toBe('');
    }

    store().set('enablePlaylistSearch', true);
    await waitForCondition(() => document.querySelector('.yp-playlist-search-input'), 1000);
    const rebuilt = /** @type {HTMLInputElement} */ (
      document.querySelector('.yp-playlist-search-input')
    );
    rebuilt.value = 'channel 2';
    rebuilt.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForCondition(
      () =>
        document.querySelectorAll('ytd-playlist-panel-video-renderer')[2]?.style.display === '' &&
        document.querySelectorAll('ytd-playlist-panel-video-renderer')[0]?.style.display === 'none',
      1000
    );

    store().set('enablePlaylistSearch', false);
    await waitForCondition(() => !document.querySelector('.yp-playlist-search'), 1000);
  });

  test('a navigation re-runs the search UI sync through the owned listener', async () => {
    addWatchPlaylist();
    store().set('enablePlaylistSearch', true);
    await waitForCondition(() => document.querySelector('.yp-playlist-search-input'), 1000);

    document.dispatchEvent(new Event('yt-navigate-finish'));
    await new Promise(r => setTimeout(r, 400));

    expect(lifecycle().isRunning('playlist-search')).toBe(true);
    store().set('enablePlaylistSearch', false);
  });
});
