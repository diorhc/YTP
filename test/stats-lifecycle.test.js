/**
 * @jest-environment jsdom
 *
 * Route lifecycle for src/stats.js on the real FeatureLifecycle,
 * CleanupManager and StyleManager: off-route no start, on-route start, and
 * route leave releasing everything the feature context acquired.
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/mutation-coordinator.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
}

const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;
const styles = () => window.YouTubePlusDesignSystem.StyleManager;
const cm = () => window.YouTubePlusCleanupManager;
const counts = () => ({
  listeners: cm().getListenerStats().active,
  intervals: cm().intervals.size + cm().sessionIntervals.size,
  timeouts: cm().timeouts.size + cm().sessionTimeouts.size,
});

const ROUTE_URLS = {
  home: ['/', ''],
  watch: ['/watch', '?v=test1234567a'],
  shorts: ['/shorts/test1234567a', ''],
  channel: ['/channel/UC1234567890ABCDEFGHIJKL', ''],
};

/** @param {'home'|'watch'|'shorts'|'channel'} route */
function setRoute(route) {
  const [pathname, search] = ROUTE_URLS[route];
  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname,
    search,
    href: `https://www.youtube.com${pathname}${search}`,
  });
}

/**
 * Move to a route the way YouTube does: the per-navigation sweep runs first
 * (yt-navigate-start), then the lifecycle host re-checks the page.
 * @param {'home'|'watch'|'shorts'|'channel'} route
 */
function navigate(route) {
  setRoute(route);
  window.dispatchEvent(new Event('yt-navigate-start'));
  window.dispatchEvent(new Event('yp-history-navigate'));
}

describe('stats route lifecycle', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="movie_player"><div class="ytp-right-controls"></div></div>';
    localStorage.clear();
    delete window.__ytpVideoStatsModuleInit;
    delete window.__ytpChannelStatsModuleInit;
    delete window.YouTubePlusStats;
    delete window.YouTubeStats;
    setRoute('home');
    loadChain();
    require('../src/stats.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
    styles()?.clear?.();
  });

  test('off-route the stats features do not start', () => {
    expect(lifecycle().isRunning('videoStats')).toBe(false);
    expect(lifecycle().isRunning('channelStats')).toBe(false);
    expect(styles().has('yp-video-stats-styles')).toBe(false);
    expect(document.getElementById('yp-stats-universal-icon')).toBeNull();
  });

  test('on-route the video stats feature starts, and leaving releases it', () => {
    navigate('watch');
    expect(lifecycle().isRunning('videoStats')).toBe(true);
    expect(styles().has('yp-video-stats-styles')).toBe(true);

    navigate('home');
    expect(lifecycle().isRunning('videoStats')).toBe(false);
    expect(styles().has('yp-video-stats-styles')).toBe(false);
    expect(document.getElementById('yp-stats-universal-icon')).toBeNull();
    expect(document.querySelector('.stats-menu-container')).toBeNull();
  });

  test('the channel feature starts on the channel route only', () => {
    navigate('watch');
    expect(lifecycle().isRunning('channelStats')).toBe(false);

    navigate('channel');
    expect(lifecycle().isRunning('channelStats')).toBe(true);
    expect(lifecycle().isRunning('videoStats')).toBe(true);

    navigate('home');
    expect(lifecycle().isRunning('channelStats')).toBe(false);
    expect(styles().has('yp-video-stats-styles')).toBe(false);
  });

  test('repeated route cycles do not accumulate listeners, timers or styles', () => {
    navigate('watch');
    navigate('home');
    const baseline = counts();

    for (let i = 0; i < 10; i++) {
      navigate('watch');
      expect(lifecycle().isRunning('videoStats')).toBe(true);
      expect(styles().has('yp-video-stats-styles')).toBe(true);
      navigate('home');
      expect(lifecycle().isRunning('videoStats')).toBe(false);
    }

    expect(counts()).toEqual(baseline);
    expect(styles().has('yp-video-stats-styles')).toBe(false);
  });

  test('the modal bundle is added on demand and released with the runtime', async () => {
    navigate('watch');
    expect(lifecycle().isRunning('videoStats')).toBe(true);
    expect(styles().has('yp-video-stats-modal-styles')).toBe(false);

    // The modal CSS is attached right before the overlay is inserted; the
    // fetch pipeline behind it is irrelevant to the style contract.
    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ').catch(() => undefined);
    expect(styles().has('yp-video-stats-modal-styles')).toBe(true);

    // A second open in the same runtime does not re-add the bundle.
    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ').catch(() => undefined);
    expect(styles().has('yp-video-stats-modal-styles')).toBe(true);

    navigate('home');
    expect(styles().has('yp-video-stats-modal-styles')).toBe(false);

    // A later entry re-attaches it: the flag does not outlive the runtime.
    navigate('watch');
    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ').catch(() => undefined);
    expect(styles().has('yp-video-stats-modal-styles')).toBe(true);
  });

  test('the video stats feature stays off while its flag is off', () => {
    window.YouTubePlusSettingsStore.set('enableStatsButton', false);
    navigate('watch');
    expect(lifecycle().isRunning('videoStats')).toBe(false);
    expect(document.getElementById('yp-stats-universal-icon')).toBeNull();
  });

  test('the channel stats feature stays off while its flag is off', () => {
    window.YouTubePlusSettingsStore.set('enableChannelStats', false);
    navigate('channel');
    expect(lifecycle().isRunning('channelStats')).toBe(false);
    expect(document.querySelector('.channel-banner-overlay')).toBeNull();
  });

  test('a channel page with a rendered banner mounts the live overlay', async () => {
    const banner = document.createElement('div');
    banner.id = 'page-header-banner-sizer';
    banner.getBoundingClientRect = () => ({
      width: 320,
      height: 200,
      top: 0,
      left: 0,
      right: 320,
      bottom: 200,
    });
    document.body.appendChild(banner);

    globalThis.fetch = jest.fn(async url => {
      if (String(url).includes('livecounts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ followerCount: 1234, bottomOdos: [1, 2], viewCount: 5000 }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/channel/UC1234567890ABCDEFGHIJKL',
      search: '',
      href: 'https://www.youtube.com/channel/UC1234567890ABCDEFGHIJKL',
    });
    window.dispatchEvent(new Event('yt-navigate-start'));
    window.dispatchEvent(new Event('yp-history-navigate'));

    expect(lifecycle().isRunning('channelStats')).toBe(true);
    // The overlay ensure scheduler runs its first check on the next tick, then
    // the counter update fetches the live stats and renders the digits.
    await new Promise(resolve => setTimeout(resolve, 60));
    const overlay = document.querySelector('.channel-banner-overlay');
    expect(overlay).not.toBeNull();
    const subscribers = overlay.querySelector('.subscribers-number');
    expect(subscribers).not.toBeNull();
    expect(subscribers.textContent.replace(/\D/g, '')).toContain('1234');
  });
});
