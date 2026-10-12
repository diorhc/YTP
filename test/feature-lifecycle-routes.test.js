/**
 * Route-scoped features: FeatureLifecycle runs a feature only while its
 * setting is on AND the current page is one it lists. Real CleanupManager,
 * SettingsStore and FeatureRegistry.
 * @jest-environment jsdom
 */

function goTo(url) {
  const u = new URL(url);
  global.mockLocation({
    hostname: u.hostname,
    pathname: u.pathname,
    search: u.search,
    href: u.href,
  });
}

function navigate(url) {
  goTo(url);
  window.dispatchEvent(new CustomEvent('yp-history-navigate', { detail: { type: 'navigate' } }));
}

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
const store = () => window.YouTubePlusSettingsStore;
const U = () => window.YouTubeUtils;

describe('YouTubeUtils.getRoute', () => {
  beforeEach(() => {
    jest.resetModules();
    goTo('https://www.youtube.com/');
    loadChain();
  });

  test.each([
    ['https://www.youtube.com/', 'home'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'watch'],
    ['https://www.youtube.com/shorts/abc', 'shorts'],
    ['https://www.youtube.com/results?search_query=x', 'search'],
    ['https://www.youtube.com/playlist?list=PL1', 'playlist'],
    ['https://www.youtube.com/feed/subscriptions', 'feed'],
    ['https://www.youtube.com/@someone/videos', 'channel'],
    ['https://www.youtube.com/channel/UC123', 'channel'],
    ['https://www.youtube.com/c/name', 'channel'],
    ['https://www.youtube.com/user/legacy/videos', 'channel'],
    ['https://www.youtube.com/account', 'other'],
  ])('%s → %s', (url, route) => {
    goTo(url);
    expect(U().getRoute()).toBe(route);
  });
});

describe('FeatureLifecycle routes', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    localStorage.clear();
    goTo('https://www.youtube.com/');
    loadChain();
    store().set('enablePlayAll', true);
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('does not start on a page outside its routes', () => {
    const start = jest.fn();
    lifecycle()
      .define({ id: 'probe', settingsKey: 'enablePlayAll', routes: ['watch'], start })
      .sync();
    expect(start).not.toHaveBeenCalled();
    expect(lifecycle().isRunning('probe')).toBe(false);
  });

  test('starts when navigation reaches a listed page and stops when it leaves', () => {
    const start = jest.fn();
    const stop = jest.fn();
    lifecycle()
      .define({
        id: 'probe',
        settingsKey: 'enablePlayAll',
        routes: ['watch', 'shorts'],
        start,
        stop,
      })
      .sync();

    navigate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(start).toHaveBeenCalledTimes(1);

    navigate('https://www.youtube.com/shorts/abc');
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    navigate('https://www.youtube.com/results?search_query=x');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(lifecycle().isRunning('probe')).toBe(false);
  });

  test('everything the feature acquired is released when it leaves its page', () => {
    const cm = window.YouTubePlusCleanupManager;
    const handle = lifecycle().define({
      id: 'probe',
      settingsKey: 'enablePlayAll',
      routes: ['watch'],
      start: ctx => {
        ctx.listen(document, 'click', jest.fn());
        ctx.timeout(jest.fn(), 60000);
      },
    });
    handle.sync();
    const before = cm.getListenerStats().active;
    navigate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(cm.getListenerStats().active).toBeGreaterThan(before);
    navigate('https://www.youtube.com/');
    expect(cm.getListenerStats().active).toBe(before);
  });

  test('the setting still decides: off means off on a listed page', () => {
    goTo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    store().set('enablePlayAll', false);
    const start = jest.fn();
    lifecycle()
      .define({ id: 'probe', settingsKey: 'enablePlayAll', routes: ['watch'], start })
      .sync();
    expect(start).not.toHaveBeenCalled();
    store().set('enablePlayAll', true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('a feature without routes keeps running across pages', () => {
    const start = jest.fn();
    const stop = jest.fn();
    lifecycle().define({ id: 'probe', settingsKey: 'enablePlayAll', start, stop }).sync();
    navigate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    navigate('https://www.youtube.com/');
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  test('`when` adds a condition; handle.sync() re-checks it', () => {
    let marker = false;
    const start = jest.fn();
    const stop = jest.fn();
    const handle = lifecycle().define({
      id: 'probe',
      settingsKey: 'enablePlayAll',
      routes: ['channel', 'watch'],
      when: () => U().getRoute() === 'channel' || marker,
      start,
      stop,
    });
    handle.sync();

    navigate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(start).not.toHaveBeenCalled();

    marker = true;
    handle.sync();
    expect(start).toHaveBeenCalledTimes(1);

    marker = false;
    handle.sync();
    expect(stop).toHaveBeenCalledTimes(1);

    navigate('https://www.youtube.com/@someone/videos');
    expect(start).toHaveBeenCalledTimes(2);
  });

  test('a feature that was never synced does not start on navigation', () => {
    const start = jest.fn();
    lifecycle().define({ id: 'probe', settingsKey: 'enablePlayAll', routes: ['watch'], start });
    navigate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(start).not.toHaveBeenCalled();
  });

  test('_reset leaves no navigation listener behind', () => {
    const cm = window.YouTubePlusCleanupManager;
    const before = cm.getListenerStats().active;
    lifecycle()
      .define({ id: 'probe', settingsKey: 'enablePlayAll', routes: ['watch'], start: jest.fn() })
      .sync();
    lifecycle()._reset();
    expect(cm.getListenerStats().active).toBe(before);
  });
});
