/**
 * @jest-environment jsdom
 *
 * The stats enable flags and the channel-overlay settings through the shared
 * settings blob. The real store runs against a Map-backed GM stub and an
 * explicit host policy, and the real stats module boots on the real
 * FeatureLifecycle chain.
 *
 * Contracts under test:
 *   - The two enable flags migrate into the store from a bare string and from a
 *     `{enabled}` object, and the legacy keys are dropped.
 *   - The channel-overlay settings read `modules.channelStats` when the blob
 *     exists (migrating the legacy `youtubeEnhancer*`/`show-*` keys) and the
 *     legacy keys otherwise, without creating a blob.
 *   - A blob change from another tab reaches the live overlay.
 */

const BLOB = 'ytp_settings_v3';

/** @param {Record<string, string>} [initial] */
function installGm(initial) {
  const store = new Map(Object.entries(initial || {}));
  /** @type {{ key: string, cb: Function }[]} */
  const listeners = [];
  globalThis.GM_getValue = (key, def) => (store.has(key) ? store.get(key) : def);
  globalThis.GM_setValue = (key, value) => {
    store.set(key, value);
  };
  globalThis.GM_addValueChangeListener = (key, cb) => {
    listeners.push({ key, cb });
    return listeners.length;
  };
  return { store, listeners };
}

/** @param {boolean} owns */
function installPolicy(owns) {
  window.YouTubePlusHostPolicy = {
    hostClass: () => 'youtube',
    ownsSharedSettings: () => owns,
    table: {},
    runs: () => true,
  };
}

/** @param {Record<string, unknown>} modules */
function blobOf(modules) {
  return JSON.stringify({ version: 3, main: {}, modules });
}

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

function renderBanner() {
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
}

/** @returns {Promise<void>} */
const settle = (/** @type {number} */ ms = 120) => new Promise(resolve => setTimeout(resolve, ms));

const store = () => window.YouTubePlusSettingsStore;
const overlay = () => document.querySelector('.channel-banner-overlay');

beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
  delete window.__ytpVideoStatsModuleInit;
  delete window.__ytpChannelStatsModuleInit;
  delete window.YouTubePlusStats;
  delete window.YouTubeStats;
  delete window.YouTubePlusSettingsStore;
  delete window.YouTubePlusHostPolicy;
  delete window._ytpSettingsStoreGmListenerId;
  delete window._ytpSettingsStoreStorageKey;
  delete window._ytpSettingsStoreUpdateKey;
  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/channel/UC1234567890ABCDEFGHIJKL',
    href: 'https://www.youtube.com/channel/UC1234567890ABCDEFGHIJKL',
  });
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
});

afterEach(() => {
  delete globalThis.GM_getValue;
  delete globalThis.GM_setValue;
  delete globalThis.GM_addValueChangeListener;
  window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  localStorage.clear();
});

describe('stats enable flags through the shared settings blob', () => {
  test('a bare-string button flag and an object channel flag both migrate', () => {
    localStorage.setItem('youtube_stats_button_enabled', 'false');
    localStorage.setItem('youtube_channel_stats_settings', JSON.stringify({ enabled: false }));
    installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);

    loadChain();

    expect(store().get('enableStatsButton')).toBe(false);
    expect(store().get('enableChannelStats')).toBe(false);
    // The migrated flags are dropped from the legacy keys.
    expect(localStorage.getItem('youtube_stats_button_enabled')).toBeNull();
    expect(localStorage.getItem('youtube_channel_stats_settings')).toBe('{}');
  });

  test('a bare-string channel flag also migrates', () => {
    localStorage.setItem('youtube_channel_stats_settings', 'false');
    installGm({ [BLOB]: blobOf({}) });
    installPolicy(true);

    loadChain();

    expect(store().get('enableChannelStats')).toBe(false);
    expect(localStorage.getItem('youtube_channel_stats_settings')).toBeNull();
  });
});

describe('channel overlay settings through the shared blob', () => {
  test('the overlay reads modules.channelStats when the blob exists', async () => {
    installGm({
      [BLOB]: blobOf({
        channelStats: {
          interval: 8000,
          opacity: 0.6,
          fontSize: 32,
          fontFamily: 'Impact, Charcoal, sans-serif',
          showSubscribers: true,
          showViews: true,
          showVideos: false,
        },
      }),
    });
    installPolicy(true);
    renderBanner();

    loadChain();
    require('../src/stats.js');
    await settle();

    const el = /** @type {HTMLElement} */ (overlay());
    expect(el).not.toBeNull();
    expect(el.style.backgroundColor).toBe('rgba(0, 0, 0, 0.6)');
    expect(el.style.getPropertyValue('--yt-stats-font-family')).toBe(
      'Impact, Charcoal, sans-serif'
    );
    expect(el.style.getPropertyValue('--yt-stats-font-size')).toBe('32px');
    const videos = /** @type {HTMLElement} */ (el.querySelector('.videos-number')).closest(
      '.channel-stat'
    );
    expect(/** @type {HTMLElement} */ (videos).style.display).toBe('none');
  });

  test('without the blob the legacy keys stay authoritative and no blob is made', async () => {
    localStorage.setItem('youtubeEnhancerOpacity', '0.4');
    localStorage.setItem('youtubeEnhancerFontSize', '28');
    localStorage.setItem('show-videos', 'false');
    const { store: gm } = installGm();
    installPolicy(false);
    renderBanner();

    loadChain();
    require('../src/stats.js');
    await settle();

    const el = /** @type {HTMLElement} */ (overlay());
    expect(el).not.toBeNull();
    expect(el.style.backgroundColor).toBe('rgba(0, 0, 0, 0.4)');
    expect(el.style.getPropertyValue('--yt-stats-font-size')).toBe('28px');
    const videos = /** @type {HTMLElement} */ (el.querySelector('.videos-number')).closest(
      '.channel-stat'
    );
    expect(/** @type {HTMLElement} */ (videos).style.display).toBe('none');
    expect(gm.has(BLOB)).toBe(false);
  });

  test('a blob change from another tab is applied to the live overlay', async () => {
    const settings = {
      interval: 5000,
      opacity: 0.75,
      fontSize: 24,
      fontFamily: 'Rubik, sans-serif',
      showSubscribers: true,
      showViews: true,
      showVideos: true,
    };
    const before = blobOf({ channelStats: settings });
    const { store: gm, listeners } = installGm({ [BLOB]: before });
    installPolicy(true);
    renderBanner();

    loadChain();
    require('../src/stats.js');
    await settle();
    expect(/** @type {HTMLElement} */ (overlay()).style.backgroundColor).toBe(
      'rgba(0, 0, 0, 0.75)'
    );

    const next = blobOf({ channelStats: { ...settings, opacity: 0.3, showVideos: false } });
    gm.set(BLOB, next);
    const blobListener = listeners.find(entry => entry.key === BLOB);
    expect(blobListener).toBeTruthy();
    blobListener.cb(BLOB, before, next, true);

    const el = /** @type {HTMLElement} */ (overlay());
    expect(el.style.backgroundColor).toBe('rgba(0, 0, 0, 0.3)');
    const videos = /** @type {HTMLElement} */ (el.querySelector('.videos-number')).closest(
      '.channel-stat'
    );
    expect(/** @type {HTMLElement} */ (videos).style.display).toBe('none');
  });
});
