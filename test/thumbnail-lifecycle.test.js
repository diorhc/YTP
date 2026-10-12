/**
 * Thumbnail (src/thumbnail.js) on the FeatureLifecycle contract
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
  require('../src/thumbnail.js');
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

function addFixture() {
  const controls = document.createElement('div');
  controls.className = 'ytp-right-controls';
  document.body.appendChild(controls);

  const card = document.createElement('yt-thumbnail-view-model');
  const img = document.createElement('img');
  img.src = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
  card.appendChild(img);
  document.body.appendChild(card);

  const avWrap = document.createElement('yt-avatar-shape');
  const avImg = document.createElement('img');
  avImg.src = 'https://yt4.ggpht.com/example=s32-c-k-c0x00ffffff-no-rj';
  avWrap.appendChild(avImg);
  document.body.appendChild(avWrap);
}

async function waitForCondition(
  /** @type {() => boolean} */ asFn,
  /** @type {number} */ ms = 1500
) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (asFn()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  if (!asFn()) throw new Error('condition not met');
}

describe('thumbnail on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.YouTubePlusThumbnail;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      search: '?v=dQw4w9WgXcQ',
    });
    loadChain();
    store().set('enableThumbnail', false);
    require('../src/thumbnail.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('10 on/off cycles return to the starting counts and leave no DOM or CSS', async () => {
    addFixture();

    store().set('enableThumbnail', true);
    await waitForCondition(() => document.querySelector('.yp-thumbnail-button'));
    expect(document.querySelectorAll('.thumb-overlay')).toHaveLength(1);
    expect(document.querySelectorAll('.avatar-overlay')).toHaveLength(1);
    expect(window.YouTubePlusDesignSystem.StyleManager.has('thumbnail-viewer-styles')).toBe(true);

    store().set('enableThumbnail', false);
    await waitForCondition(() => !document.querySelector('.yp-thumbnail-button'), 1000);
    expect(document.querySelectorAll('.thumb-overlay')).toHaveLength(0);
    expect(document.querySelectorAll('.avatar-overlay')).toHaveLength(0);
    // The viewer bundle also styles the stats modal, so it stays loaded.
    expect(window.YouTubePlusDesignSystem.StyleManager.has('thumbnail-viewer-styles')).toBe(true);

    const baseline = counts();
    const css = styleText();

    for (let i = 0; i < 10; i++) {
      store().set('enableThumbnail', true);
      await waitForCondition(() => document.querySelector('.yp-thumbnail-button'), 1500);
      expect(document.querySelectorAll('.thumb-overlay')).toHaveLength(1);
      store().set('enableThumbnail', false);
      await waitForCondition(() => !document.querySelector('.yp-thumbnail-button'), 1000);
      expect(document.querySelectorAll('.thumb-overlay')).toHaveLength(0);
    }

    expect(counts()).toEqual(baseline);
    expect(styleText()).toBe(css);
  });

  test('feature keeps processing late DOM nodes after off/on cycles', async () => {
    addFixture();

    store().set('enableThumbnail', true);
    await waitForCondition(() => document.querySelector('.yp-thumbnail-button'), 3000);
    store().set('enableThumbnail', false);
    await waitForCondition(() => !document.querySelector('.yp-thumbnail-button'), 1000);

    // A card that arrives after the cycle still gets its overlay on the next run.
    const card = document.createElement('yt-thumbnail-view-model');
    const img = document.createElement('img');
    img.src = 'https://i.ytimg.com/vi/D8H3g6bO6m4/hqdefault.jpg';
    card.appendChild(img);
    document.body.appendChild(card);

    store().set('enableThumbnail', true);
    await waitForCondition(() => card.querySelector('.thumb-overlay'), 1500);
    store().set('enableThumbnail', false);
    await waitForCondition(() => !card.querySelector('.thumb-overlay'), 1000);
  });

  /** Wrap the root subscription to record the batches the thumbnail observer sees. */
  const spyThumbnailBatches = () => {
    const batches = [];
    const coord = window.YouTubePlusMutationCoordinator;
    const orig = coord.subscribeRoot;
    jest.spyOn(coord, 'subscribeRoot').mockImplementation((id, cb, opts) =>
      orig.call(
        coord,
        id,
        records => {
          if (id === 'thumbnail::routeObserver') batches.push(records);
          cb(records);
        },
        opts
      )
    );
    return batches;
  };

  test('an unrelated text-node mutation does not wake the thumbnail observer', async () => {
    const batches = spyThumbnailBatches();
    addFixture();
    store().set('enableThumbnail', true);
    await waitForCondition(() => document.querySelector('.thumb-overlay'));
    await new Promise(r => setTimeout(r, 400));
    batches.length = 0;

    const aside = document.createElement('div');
    aside.textContent = 'watch time 0:01';
    document.body.appendChild(aside);
    await new Promise(r => setTimeout(r, 150));

    expect(batches).toHaveLength(0);
  });

  test('adding a thumbnail renderer notifies the batch with that renderer', async () => {
    const batches = spyThumbnailBatches();
    addFixture();
    store().set('enableThumbnail', true);
    await waitForCondition(() => document.querySelector('.thumb-overlay'));
    await new Promise(r => setTimeout(r, 400));
    batches.length = 0;

    const card = document.createElement('yt-thumbnail-view-model');
    const img = document.createElement('img');
    img.src = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
    card.appendChild(img);
    document.body.appendChild(card);

    await waitForCondition(() => Boolean(card.querySelector('.thumb-overlay')));
    const added = batches.flatMap(records => records.flatMap(record => [...record.addedNodes]));
    expect(added).toContain(card);
    expect(card.querySelector('.thumb-overlay')).not.toBeNull();
  });

  test('an avatar that gets its src after insertion still gets its overlay', async () => {
    addFixture();
    store().set('enableThumbnail', true);
    await waitForCondition(() => document.querySelector('.thumb-overlay'));
    // Past the delayed startup full pass, so only the mutation path can react.
    await new Promise(r => setTimeout(r, 2000));

    const wrap = document.createElement('yt-avatar-shape');
    const img = document.createElement('img');
    wrap.appendChild(img);
    document.body.appendChild(wrap);
    await new Promise(r => setTimeout(r, 600));
    expect(wrap.querySelector('.avatar-overlay')).toBeNull();

    img.src = 'https://yt3.ggpht.com/lazy=s88-c-k-c0x00ffffff-no-rj';
    await waitForCondition(() => Boolean(wrap.querySelector('.avatar-overlay')), 1000);
  }, 10000);
});
