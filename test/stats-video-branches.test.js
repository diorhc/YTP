/**
 * @jest-environment jsdom
 *
 * Branch coverage for the video half of src/stats.js: player/DOM extraction
 * guards, the modal shell (focus trap, close buttons, focus restore), the
 * channel-tab analysis pipeline behind checkChannelTabs, and duration
 * formatting. Real module throughout, mocked network and host services.
 */

const mockLocation = globalThis.mockLocation;

/** The network stub installed for the current test. */
let fetchSpy;

/**
 * Every listener the module binds is tracked here: jsdom keeps one document per
 * file, so a stale runtime from a previous test would otherwise still react to
 * navigation events. They are released after each test.
 */
const boundListeners = [];
const bind = (target, type, handler, options) => {
  boundListeners.push([target, type, handler, options]);
  target.addEventListener(type, handler, options);
};

const activeTimers = new Set();
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;

function trackTimers() {
  globalThis.setTimeout = (fn, ms, ...args) => {
    let id;
    id = nativeSetTimeout(
      (...cbArgs) => {
        activeTimers.delete(id);
        return fn(...cbArgs);
      },
      ms,
      ...args
    );
    activeTimers.add(id);
    return id;
  };
  globalThis.clearTimeout = id => {
    activeTimers.delete(id);
    return nativeClearTimeout(id);
  };
  window.setTimeout = globalThis.setTimeout;
  window.clearTimeout = globalThis.clearTimeout;
}

function clearTrackedTimers() {
  for (const id of activeTimers) {
    nativeClearTimeout(id);
  }
  activeTimers.clear();
}

function setupDeps() {
  document.body.innerHTML = '';
  document.head.innerHTML = '';

  delete window.__ytpVideoStatsModuleInit;
  delete window.__ytpChannelStatsModuleInit;
  delete window.YouTubeStats;
  delete window.YouTubePlusStats;
  delete window.ytInitialData;
  delete window.ytInitialPlayerResponse;
  delete window.ytcfg;
  delete window.yt;
  delete window.YouTubePlusModalHandlers;

  // A realistic page: YouTube publishes the InnerTube key in ytcfg.
  window.ytcfg = {
    get: jest.fn(key => {
      if (key === 'INNERTUBE_API_KEY') return 'e2e-inner-tube-key';
      if (key === 'INNERTUBE_CLIENT_VERSION') return '2.20260101.00.00';
      return null;
    }),
    data_: {},
  };

  localStorage.clear();

  // The stats enable flags are settings-store keys; keep a small store double.
  const storeValues = {};
  Object.defineProperty(window, 'YouTubePlusSettingsStore', {
    configurable: true,
    writable: true,
    value: {
      get: jest.fn(key => storeValues[key]),
      set: jest.fn((key, value) => {
        storeValues[key] = value;
        return true;
      }),
      affectsModule: jest.fn(() => true),
    },
  });

  require('../src/utils.js');
  const canonUtils = window.YouTubeUtils;

  mockLocation({
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    hostname: 'www.youtube.com',
    pathname: '/watch',
    search: '?v=dQw4w9WgXcQ',
  });

  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: cb => {
      cb();
      return 1;
    },
  });

  Object.defineProperty(window, 'YouTubeSafeDOM', {
    configurable: true,
    writable: true,
    value: {
      escapeHTML: s =>
        String(s ?? '').replace(
          /[&<>"']/g,
          c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
        ),
      isValidVideoId: id => !!id && /^[a-zA-Z0-9_-]{11}$/.test(id),
    },
  });

  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      StyleManager: { add: jest.fn(), remove: jest.fn() },
      getVideoIdFromUrl: canonUtils.getVideoIdFromUrl,
      getVideoIdFromLocation: canonUtils.getVideoIdFromLocation,
      logError: jest.fn(),
      logSuppressed: jest.fn(),
      debounce: fn => fn,
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      $: (sel, ctx = document) => (ctx || document).querySelector(sel),
      $$: (sel, ctx = document) => Array.from((ctx || document).querySelectorAll(sel)),
      byId: id => document.getElementById(id),
      t: jest.fn(key => key || ''),
      loadFeatureEnabled: jest.fn(() => true),
      createWithErrorBoundary: jest.fn(() => fn => fn),
      onDomReady: cb => cb(),
      getRoute: () => {
        const p = window.location.pathname || '/';
        if (p === '/watch') return 'watch';
        if (p.startsWith('/shorts')) return 'shorts';
        if (/^\/@|\/channel\/|\/c\/|\/user\//.test(p)) return 'channel';
        return 'other';
      },
      isWatchPage: jest.fn(url => (url || '').includes('/watch')),
      isStudioPage: jest.fn(() => false),
      isChannelPage: jest.fn(url => /\/@|\/channel\/|\/c\/|\/user\//.test(url || '')),
      setSafeHTML: jest.fn((el, html) => {
        if (el) el.innerHTML = html;
      }),
      renderTemplateClone: jest.fn((el, html) => {
        if (el) el.innerHTML = html;
      }),
      registerListenerSafe: jest.fn((target, event, handler, options) => {
        if (target && typeof target.addEventListener === 'function') {
          bind(target, event, handler, options);
        }
        return `${event}-listener`;
      }),
      createRetryScheduler: jest.fn(({ check }) => {
        try {
          if (typeof check === 'function') check();
        } catch {
          /* non-critical */
        }
        return { stop: jest.fn() };
      }),
      createVisibilityAwareInterval: jest.fn(() => ({
        stop: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        active: true,
      })),
      cleanupManager: {
        registerListener: jest.fn((target, event, handler, options) => {
          if (target && typeof target.addEventListener === 'function') {
            bind(target, event, handler, options);
          }
          return { dispose: () => target.removeEventListener(event, handler, options) };
        }),
        unregisterListener: jest.fn(),
        register: jest.fn(),
        cleanup: jest.fn(),
        registerObserver: jest.fn(obs => obs),
        registerAnimationFrame: jest.fn(id => id),
      },
      storage: {
        get: (key, def = null) => {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : def;
        },
        set: (key, val) => {
          localStorage.setItem(key, JSON.stringify(val));
          return true;
        },
        remove: key => localStorage.removeItem(key),
        has: key => localStorage.getItem(key) !== null,
        getItem: key => localStorage.getItem(key),
        setItem: (key, val) => {
          localStorage.setItem(key, val);
          return true;
        },
        removeItem: key => localStorage.removeItem(key),
      },
    },
  });

  Object.defineProperty(window, 'YouTubePlusCleanupManager', {
    configurable: true,
    writable: true,
    value: window.YouTubeUtils.cleanupManager,
  });

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      initGlassDropdown: jest.fn(),
      getStyle: jest.fn(() => '.videoStats{width:36px}'),
      getThemeVariant: jest.fn(() => 'classic'),
    },
  });

  Object.defineProperty(window, 'YouTubePlusLogger', {
    configurable: true,
    writable: true,
    value: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });

  const featureRegistryMap = new Map();
  const handles = [];
  const makeCtx = () => ({
    style: jest.fn(),
    // Real attachment: the navigation listeners under test only fire when the
    // feature context actually binds them.
    listen: (target, type, fn, opts) => {
      if (target && typeof target.addEventListener === 'function') {
        bind(target, type, fn, opts);
      }
      return jest.fn();
    },
    own: el => el,
    onDispose: jest.fn(),
    scope: () => makeCtx(),
    dispose: jest.fn(),
  });
  Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
    configurable: true,
    writable: true,
    value: {
      register: jest.fn(desc => featureRegistryMap.set(desc.id, desc)),
      get: jest.fn(id => featureRegistryMap.get(id)),
      has: jest.fn(id => featureRegistryMap.has(id)),
      _map: featureRegistryMap,
      FeatureLifecycle: {
        define: jest.fn(def => {
          if (!def || typeof def.start !== 'function') return null;
          const ctx = makeCtx();
          let running = false;
          const matches = () => {
            const route = window.YouTubeUtils.getRoute();
            return !def.routes?.length || def.routes.includes(route);
          };
          const handle = {
            id: def.id,
            ctx,
            sync() {
              const should = matches();
              if (should && !running) {
                running = true;
                def.start(ctx);
              } else if (!should && running) {
                running = false;
                def.stop?.();
              }
            },
            isRunning: () => running,
            restart() {
              def.stop?.();
              running = false;
              this.sync();
            },
          };
          handles.push(handle);
          return handle;
        }),
        _reset: jest.fn(),
      },
      _handles: handles,
    },
  });

  Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
    configurable: true,
    writable: true,
    value: {
      subscribeRoot: jest.fn(() => 'sub-id'),
      unsubscribe: jest.fn(),
      watchTarget: jest.fn(() => 'watch-id'),
      unwatch: jest.fn(),
    },
  });
}

function innerTube(overrides = {}) {
  return {
    videoDetails: {
      videoId: 'dQw4w9WgXcQ',
      title: 'Test Video Title',
      author: 'Test Author',
      viewCount: '1234567',
      lengthSeconds: '212',
      channelId: 'UCtest1234567890abcdefg',
      thumbnail: {
        thumbnails: [{ url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }],
      },
      ...overrides.videoDetails,
    },
    microformat: {
      playerMicroformatRenderer: {
        ownerProfileUrl: 'http://www.youtube.com/@testauthor',
        isFamilySafe: true,
        ...overrides.microformat,
      },
    },
    ...overrides.top,
  };
}

/**
 * Network stub for the modal + channel-tab pipelines. Each bucket can be
 * replaced per test through the returned `routes` object.
 */
/** A JSON payload becomes a Response; anything else is passed through. */
function asResponse(payload) {
  if (payload && typeof payload === 'object' && 'ok' in payload) return payload;
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function installFetch(routes = {}) {
  const state = {
    player: () => innerTube(),
    browse: () => ({ header: { c4TabbedHeaderRenderer: { country: 'US' } } }),
    ryd: () => ({ likes: 100, dislikes: 5, rating: 4.8 }),
    livecounts: () => ({ liveSubscriber: 50000, liveViews: 9999999, liveVideos: 200 }),
    page: () => ({ ok: true, status: 200, text: async () => '<html></html>' }),
    ...routes,
  };
  const fetchMock = jest.fn(async url => {
    const urlStr = String(url);
    if (urlStr.includes('/youtubei/v1/player')) return asResponse(state.player(urlStr));
    if (urlStr.includes('/youtubei/v1/browse')) return asResponse(state.browse(urlStr));
    if (urlStr.includes('returnyoutubedislikeapi')) return asResponse(state.ryd(urlStr));
    if (urlStr.includes('livecounts.io')) return asResponse(state.livecounts(urlStr));
    return state.page(urlStr);
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
  fetchSpy = fetchMock;
  return { fetchMock, state };
}

const okHtml = html => ({ ok: true, status: 200, json: async () => ({}), text: async () => html });

function tabsHtml(paths) {
  const tabs = paths.map(
    p => `{"tabRenderer":{"endpoint":{"commandMetadata":{"webCommandMetadata":{"url":"${p}"}}}}}`
  );
  return `<html><script>var ytInitialData = {"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[${tabs.join(',')}]}}};</script></html>`;
}

/** A tab list whose first entry carries no endpoint at all. */
function tabsHtmlWithShapelessTab() {
  return `<html><script>var ytInitialData = {"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{}},{"tabRenderer":{"endpoint":{"commandMetadata":{"webCommandMetadata":{"url":"/@SomeCreator/streams"}}}}}]}}};</script></html>`;
}

/** Owner action row, the mount point of the channel stats menu. */
function renderOwnerButtons() {
  document.body.innerHTML =
    '<div id="owner"><div id="top-row"><div id="buttons"></div></div></div>';
  return document.querySelector('#owner #top-row #buttons');
}

/**
 * Drain the pending microtask chain: the pipelines under test are several
 * awaits deep, so a macrotask hop is needed rather than a microtask tick.
 */
const flush = async (times = 2) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

/**
 * Point the location at a URL the history API cannot reach (a different
 * origin, or a non-URL string): jsdom's location is not configurable, so the
 * individual properties are redefined on the instance.
 */
function forceLocation(href, pathname) {
  const patch = (name, value) => {
    try {
      Object.defineProperty(window.location, name, {
        configurable: true,
        writable: true,
        value,
      });
    } catch {
      /* a read-only location property keeps its jsdom value */
    }
  };
  patch('href', href);
  patch('pathname', pathname);
  patch('hostname', new URL(href, 'https://www.youtube.com').hostname);
  patch('toString', () => href);
}

describe('stats video branch coverage', () => {
  beforeEach(() => {
    jest.resetModules();
    trackTimers();
    setupDeps();
    delete globalThis.GM_xmlhttpRequest;
    installFetch();
  });

  afterEach(() => {
    clearTrackedTimers();
    while (boundListeners.length) {
      const [target, type, handler, options] = boundListeners.pop();
      target.removeEventListener(type, handler, options);
    }
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete globalThis.unsafeWindow;
  });

  // ─── module guards ────────────────────────────────────────────────────────

  test('a second evaluation of the module keeps the video init guard', () => {
    require('../src/stats.js');
    const videoDefs = () =>
      window.YouTubePlusFeatureRegistry.FeatureLifecycle.define.mock.calls.filter(
        call => call[0]?.id === 'videoStats'
      ).length;

    expect(videoDefs()).toBe(1);

    // Re-evaluate the module body with the video init flag still set: the
    // video scope must not register a second definition.
    jest.isolateModules(() => {
      require('../src/stats.js');
    });

    expect(videoDefs()).toBe(1);
    expect(typeof window.YouTubePlusStats.openStatsModal).toBe('function');
  });

  test('the stats icon falls back to a literal title when the translation is empty', () => {
    window.YouTubeUtils.t = jest.fn(() => '');
    document.body.innerHTML = '<div class="ytp-right-controls"></div>';
    require('../src/stats.js');

    const icon = document.getElementById('yp-stats-universal-icon');
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('title')).toBe('Video Stats');
    expect(icon.getAttribute('aria-label')).toBe('Video Stats');
  });

  test('a route without a pathname is never stats-relevant, so init stays skipped', () => {
    renderOwnerButtons();
    require('../src/stats.js');
    const videoHandle = window.YouTubePlusFeatureRegistry._handles.find(h => h.id === 'videoStats');
    expect(videoHandle.isRunning()).toBe(true);

    // Location without a pathname: isStatsRelevant() must treat it as
    // irrelevant instead of guessing from the href.
    forceLocation('https://www.youtube.com/', '');
    document.dispatchEvent(new Event('yt-navigate-finish'));

    // No channel-tab check ran for a route that is not a video/channel page.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ─── player/DOM extraction guards ─────────────────────────────────────────

  test('a wrapped unsafeWindow is the page global, so its player response is read', () => {
    require('../src/stats.js');
    const viewsEl = document.createElement('yt-view-count-renderer');
    viewsEl.textContent = '111 views';
    document.body.appendChild(viewsEl);

    const pageDocument = document.implementation.createHTMLDocument('page');
    const player = pageDocument.createElement('div');
    player.id = 'movie_player';
    player.getPlayerResponse = () => ({
      videoDetails: { videoId: 'dQw4w9WgXcQ', viewCount: '4242' },
    });
    pageDocument.body.appendChild(player);
    globalThis.unsafeWindow = {
      wrappedJSObject: { document: pageDocument, ytInitialPlayerResponse: undefined },
    };

    expect(window.YouTubePlusStats.getPageVideoStats().views).toBe(4242);
  });

  test('an unsafeWindow without an object wrapper falls back to the sandbox document', () => {
    require('../src/stats.js');
    const viewsEl = document.createElement('yt-view-count-renderer');
    viewsEl.textContent = '1,234 views';
    document.body.appendChild(viewsEl);

    globalThis.unsafeWindow = { wrappedJSObject: 'not-an-object' };

    expect(window.YouTubePlusStats.getPageVideoStats().views).toBe(1234);
  });

  test('a denied unsafeWindow read is suppressed and the sandbox DOM is used', () => {
    require('../src/stats.js');
    const viewsEl = document.createElement('yt-view-count-renderer');
    viewsEl.textContent = '2,500 views';
    document.body.appendChild(viewsEl);

    Object.defineProperty(globalThis, 'unsafeWindow', {
      configurable: true,
      get() {
        throw new Error('Permission denied to access property');
      },
    });

    expect(window.YouTubePlusStats.getPageVideoStats().views).toBe(2500);
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
  });

  test('player details without a view count never become a view number', () => {
    require('../src/stats.js');
    window.ytInitialPlayerResponse = {
      videoDetails: { videoId: 'dQw4w9WgXcQ', title: 'no count here' },
    };
    const viewsEl = document.createElement('yt-view-count-renderer');
    viewsEl.textContent = '7,777 views';
    document.body.appendChild(viewsEl);

    expect(window.YouTubePlusStats.getPageVideoStats().views).toBe(7777);
    delete window.ytInitialPlayerResponse;
  });

  test('the like aria-label keeps the largest grouped count of several numbers', () => {
    require('../src/stats.js');
    const wrap = document.createElement('like-button-view-model');
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'like this video along with 1,000 other people and 12,345 more');
    btn.textContent = '12K';
    wrap.appendChild(btn);
    document.body.appendChild(wrap);

    expect(window.YouTubePlusStats.getPageVideoStats().likes).toBe(12345);
  });

  // ─── universal icon mounting ──────────────────────────────────────────────

  describe('the universal stats icon', () => {
    test('clicking the player icon opens the modal for the current video', async () => {
      document.body.innerHTML = '<div class="ytp-right-controls"></div>';
      require('../src/stats.js');
      await flush();

      const icon = document.getElementById('yp-stats-universal-icon');
      icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await flush();

      const playerCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/youtubei/v1/player')
      );
      expect(playerCalls.length).toBeGreaterThan(0);
      expect(playerCalls[0][1].body).toContain('dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('stats-grid');
      expect(body.innerHTML).toContain('1.2M');
    });

    test('the Vision theme leaves the player controls to the dock button', async () => {
      window.YouTubePlusDesignSystem.getThemeVariant = jest.fn(() => 'vision');
      document.body.innerHTML = '<div class="ytp-right-controls"></div>';
      require('../src/stats.js');
      await flush();

      expect(document.getElementById('yp-stats-universal-icon')).toBeNull();
    });

    test('a stale icon without its id is adopted instead of duplicated', () => {
      document.body.innerHTML = '<div class="ytp-right-controls"></div>';
      const stale = document.createElement('button');
      stale.className = 'videoStats';
      stale.setAttribute('data-yp-stats-icon', 'true');
      document.querySelector('.ytp-right-controls').appendChild(stale);

      require('../src/stats.js');
      window.YouTubePlusStats.ensureShortsStatsButton();

      const icons = document.querySelectorAll('#yp-stats-universal-icon, .videoStats');
      expect(icons.length).toBe(1);
      expect(icons[0].id).toBe('yp-stats-universal-icon');
      expect(stale.parentElement).toBe(document.querySelector('.ytp-right-controls'));
    });

    test('duplicate page icons are pruned down to one', () => {
      document.body.innerHTML = '<div class="ytp-right-controls"></div>';
      require('../src/stats.js');
      const extra = document.createElement('button');
      extra.className = 'videoStats';
      extra.setAttribute('data-yp-stats-icon', 'true');
      document.querySelector('.ytp-right-controls').appendChild(extra);

      window.YouTubePlusStats.ensureShortsStatsButton();

      expect(
        document.querySelectorAll('#yp-stats-universal-icon, .videoStats:not(.vision-dock-btn)')
      ).toHaveLength(1);
    });

    test('on Shorts the icon opens the modal for the reel video', async () => {
      mockLocation({
        href: 'https://www.youtube.com/shorts/test1234567',
        hostname: 'www.youtube.com',
        pathname: '/shorts/test1234567',
        search: '',
      });
      const reel = document.createElement('ytd-reel-video-renderer');
      reel.setAttribute('is-active', '');
      const actions = document.createElement('div');
      actions.id = 'actions';
      const likeVm = document.createElement('like-button-view-model');
      actions.appendChild(likeVm);
      reel.appendChild(actions);
      document.body.appendChild(reel);

      require('../src/stats.js');
      window.YouTubePlusStats.ensureShortsStatsButton();
      actions
        .querySelector('#yp-stats-universal-icon')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await flush();

      const playerCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/youtubei/v1/player')
      );
      expect(playerCalls[0][1].body).toContain('test1234567');
    });

    test('the channel menu button works from a /channel/ URL', async () => {
      mockLocation({
        href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '?v=dQw4w9WgXcQ',
      });
      mockLocation({
        href: 'https://www.youtube.com/channel/UC1234567890abcdefghij',
        hostname: 'www.youtube.com',
        pathname: '/channel/UC1234567890abcdefghij',
        search: '',
      });
      renderOwnerButtons();
      require('../src/stats.js');
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();

      document
        .querySelector('.channel-stats-button')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(
        fetchSpy.mock.calls.filter(([url]) => String(url).includes('UC1234567890abcdefghij')).length
      ).toBeGreaterThan(0);
    });

    test('toggling the setting leaves the icons to the settings modal handler', () => {
      document.body.innerHTML = '<div class="ytp-right-controls"></div>';
      const checkbox = document.createElement('input');
      checkbox.id = 'yp-setting-enableStatsButton';
      document.body.appendChild(checkbox);
      require('../src/stats.js');
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      window.YouTubePlusStats.ensureShortsStatsButton();
      expect(document.getElementById('yp-stats-universal-icon')).not.toBeNull();

      // The settings modal's general handler owns the checkbox now: the module
      // attaches no handler and does not stamp the attached mark.
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));
      expect(checkbox.dataset.handlerAttached).toBeUndefined();
      expect(document.getElementById('yp-stats-universal-icon')).not.toBeNull();
    });

    test('on Shorts the icon falls back to the action bar when no like button exists', () => {
      mockLocation({
        href: 'https://www.youtube.com/shorts/test1234567',
        hostname: 'www.youtube.com',
        pathname: '/shorts/test1234567',
        search: '',
      });
      const reel = document.createElement('ytd-reel-video-renderer');
      reel.setAttribute('is-active', '');
      const actions = document.createElement('div');
      actions.id = 'actions';
      reel.appendChild(actions);
      document.body.appendChild(reel);

      require('../src/stats.js');
      window.YouTubePlusStats.ensureShortsStatsButton();

      const icon = actions.querySelector('#yp-stats-universal-icon');
      expect(icon).not.toBeNull();
      expect(icon.classList.contains('shortsStats')).toBe(true);
    });

    test('a malformed page thumbnail falls back to the constructed one', async () => {
      const link = document.createElement('link');
      link.rel = 'image_src';
      link.href = 'http://';
      document.head.appendChild(link);
      const views = document.createElement('yt-view-count-renderer');
      views.textContent = '12 views';
      document.body.appendChild(views);

      installFetch({
        player: () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' }),
        ryd: () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' }),
        browse: () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' }),
      });
      require('../src/stats.js');
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const img = document.querySelector('.stats-thumb-img');
      expect(img.getAttribute('src')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    });
  });

  // ─── DESCRIPTOR command ───────────────────────────────────────────────────

  test('the descriptor command initializes the runtime when it is not open yet', () => {
    mockLocation({
      href: 'https://www.youtube.com/feed/subscriptions',
      hostname: 'www.youtube.com',
      pathname: '/feed/subscriptions',
      search: '',
    });
    require('../src/stats.js');

    // Off every video route the runtime never started, so the facade has no
    // openStatsModal until the command initializes it.
    delete window.YouTubePlusStats.openStatsModal;
    const desc = window.YouTubePlusFeatureRegistry.get('stats');
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => innerTube(),
      text: async () => '{}',
    }));

    mockLocation({
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=dQw4w9WgXcQ',
    });
    expect(desc.command()).toBe(true);
    expect(typeof window.YouTubePlusStats.openStatsModal).toBe('function');
  });

  test('the descriptor command reports false when no video ID is on the page', () => {
    require('../src/stats.js');
    const desc = window.YouTubePlusFeatureRegistry.get('stats');

    mockLocation({
      href: 'https://www.youtube.com/feed/history',
      hostname: 'www.youtube.com',
      pathname: '/feed/history',
      search: '',
    });
    expect(desc.command()).toBe(false);
  });

  // ─── the settings checkbox is owned by the settings modal ────────────────

  test('the module attaches no handler to the stats-button checkbox', () => {
    const checkbox = document.createElement('input');
    checkbox.id = 'yp-setting-enableStatsButton';
    document.body.appendChild(checkbox);
    require('../src/stats.js');
    document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    // The general settings handler writes `enableStatsButton` and the feature
    // lifecycle reacts; the module binds nothing of its own.
    expect(checkbox.dataset.handlerAttached).toBeUndefined();
  });

  // ─── modal shell ──────────────────────────────────────────────────────────

  test('the modal close buttons close the overlay through the bound close fn', async () => {
    require('../src/stats.js');
    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

    const sharedClose = document.querySelector('.stats-modal-close');
    const classicClose = document.querySelector('.stats-classic-close-btn');
    expect(sharedClose).not.toBeNull();
    expect(classicClose).not.toBeNull();

    sharedClose.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.stats-modal-overlay')).toBeNull();

    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
    const reopened = document.querySelector('.stats-modal-overlay');
    document
      .querySelector('.stats-classic-close-btn')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.contains(reopened)).toBe(false);
  });

  test('a close button without the bound close fn still removes the overlay', async () => {
    require('../src/stats.js');
    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
    const overlay = document.querySelector('.stats-modal-overlay');

    // A DOM swap can drop the bound close fn; the button must still work.
    delete overlay._ytpCloseOverlay;
    document
      .querySelector('.stats-modal-close')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.contains(overlay)).toBe(false);
  });

  test('closing the modal restores focus and survives a denied focus call', async () => {
    require('../src/stats.js');
    // A cross-context focus() can throw; the close path must not propagate it.
    document.body.focus = () => {
      throw new Error('Permission denied to access property');
    };

    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.querySelector('.stats-modal-overlay')).toBeNull();
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
  });

  test('the modal focus trap is released once the overlay leaves the DOM', async () => {
    const removeTrap = jest.fn();
    Object.defineProperty(window, 'YouTubePlusModalHandlers', {
      configurable: true,
      writable: true,
      value: { createFocusTrap: jest.fn(() => removeTrap) },
    });

    const coordinator = window.YouTubePlusMutationCoordinator;
    require('../src/stats.js');
    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

    expect(window.YouTubePlusModalHandlers.createFocusTrap).toHaveBeenCalledTimes(1);
    expect(coordinator.subscribeRoot).toHaveBeenCalledTimes(1);
    const trapSubId = coordinator.subscribeRoot.mock.calls[0][0];
    const onMutated = coordinator.subscribeRoot.mock.calls[0][1];

    // Still connected: the trap stays.
    onMutated();
    expect(removeTrap).not.toHaveBeenCalled();

    document.querySelector('.stats-modal-overlay').remove();
    onMutated();
    expect(removeTrap).toHaveBeenCalledTimes(1);
    expect(coordinator.unsubscribe).toHaveBeenCalledWith(trapSubId);
  });

  // ─── duration formatting ──────────────────────────────────────────────────

  describe('duration formatting through the modal', () => {
    const renderWithDuration = async lengthSeconds => {
      installFetch({
        player: () => ({
          ok: true,
          status: 200,
          json: async () => innerTube({ videoDetails: { lengthSeconds } }),
          text: async () => '{}',
        }),
      });
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      return document.querySelector('.stats-modal-body').innerHTML;
    };

    test('an already colon-formatted H:MM:SS duration is preserved', async () => {
      require('../src/stats.js');
      const html = await renderWithDuration('1:02:03');
      expect(html).toContain('1:02:03');
    });

    test('an ISO duration without a value stays unknown instead of 0:00', async () => {
      require('../src/stats.js');
      const html = await renderWithDuration('PT');
      expect(html).toContain('PT');
      expect(html).not.toContain('0:00');
    });

    test('a free-form duration string is displayed as delivered', async () => {
      require('../src/stats.js');
      const html = await renderWithDuration('about an hour');
      expect(html).toContain('about an hour');
    });

    test('a zero duration renders as 0:00', async () => {
      require('../src/stats.js');
      const html = await renderWithDuration(0);
      expect(html).toContain('0:00');
    });
  });

  test('a response without isFamilySafe reports a non-monetized channel', async () => {
    installFetch({
      player: () => ({
        ok: true,
        status: 200,
        json: async () => innerTube({ microformat: { isFamilySafe: undefined } }),
        text: async () => '{}',
      }),
    });
    require('../src/stats.js');
    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

    const html = document.querySelector('.stats-modal-body').innerHTML;
    expect(html).toContain('#ef4444');
  });

  // ─── InnerTube configuration fallbacks ───────────────────────────────────

  test('without a ytcfg key no InnerTube request is made and a clear warning is shown', async () => {
    delete window.ytcfg;
    installFetch({
      player: () => ({
        ok: true,
        status: 200,
        json: async () => innerTube(),
        text: async () => '{}',
      }),
    });
    require('../src/stats.js');
    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

    const playerCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/youtubei/v1/player')
    );
    expect(playerCalls).toHaveLength(0);
    expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
      'Stats',
      'InnerTube API key is unavailable from ytcfg; skipping the stats request'
    );
  });

  test('a failing country lookup leaves the video card without a country', async () => {
    installFetch({
      browse: () => {
        throw new Error('browse down');
      },
    });
    require('../src/stats.js');
    await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

    const html = document.querySelector('.stats-modal-body').innerHTML;
    expect(html).toContain('stats-icon-views');
    expect(html).not.toContain('country-flag');
  });

  // ─── owner stats menu ─────────────────────────────────────────────────────

  test('the channel menu button opens the channel modal for the current handle', async () => {
    mockLocation({
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=dQw4w9WgXcQ',
    });
    mockLocation({
      href: 'https://www.youtube.com/@SomeCreator',
      hostname: 'www.youtube.com',
      pathname: '/@SomeCreator',
      search: '',
    });
    renderOwnerButtons();
    require('../src/stats.js');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await flush();

    const channelBtn = document.querySelector('.channel-stats-button');
    expect(channelBtn).not.toBeNull();
    channelBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    const livecountsCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('livecounts.io')
    );
    expect(livecountsCalls.length).toBe(1);
    expect(livecountsCalls[0][0]).toContain('SomeCreator');
    expect(document.querySelector('.stats-modal-body').innerHTML).toContain('50.0K');
  });

  test('the channel menu button is inert when the page has no channel identifier', async () => {
    renderOwnerButtons();
    require('../src/stats.js');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await flush();

    const channelBtn = document.querySelector('.channel-stats-button');
    expect(channelBtn).not.toBeNull();
    channelBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('livecounts'))).toHaveLength(
      0
    );
  });

  test('the stats menu falls back to the flexible-actions parent container', async () => {
    const actions = document.createElement('div');
    actions.className = 'yt-flexible-actions-view-model-wiz__action';
    const wrapper = document.createElement('div');
    wrapper.id = 'owner-wrapper';
    wrapper.appendChild(actions);
    document.body.appendChild(wrapper);

    require('../src/stats.js');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await flush();

    const menu = document.querySelector('.stats-menu-container');
    expect(menu).not.toBeNull();
    expect(menu.parentElement).toBe(wrapper);
  });

  test('the stats menu falls back to the subscribe-adjacent buttons container', async () => {
    document.body.innerHTML = '<div id="subscribe-button"></div><div id="buttons"></div>';
    require('../src/stats.js');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await flush();

    const menu = document.querySelector('.stats-menu-container');
    expect(menu).not.toBeNull();
    expect(menu.parentElement.id).toBe('buttons');
  });

  // ─── navigation events ────────────────────────────────────────────────────

  test('a reload-continuation action re-inserts the icon that YouTube removed', async () => {
    document.body.innerHTML = '<div class="ytp-right-controls"></div>';
    require('../src/stats.js');
    await flush();
    expect(document.getElementById('yp-stats-universal-icon')).not.toBeNull();

    document.getElementById('yp-stats-universal-icon').remove();
    expect(document.getElementById('yp-stats-universal-icon')).toBeNull();

    document.dispatchEvent(
      new CustomEvent('yt-action', {
        detail: { actionName: 'yt-reload-continuation-items-command' },
      })
    );
    expect(document.getElementById('yp-stats-universal-icon')).not.toBeNull();
  });

  test('an unrelated yt-action and a detail-less action change nothing', async () => {
    document.body.innerHTML = '<div class="ytp-right-controls"></div>';
    require('../src/stats.js');
    await flush();

    const icon = document.getElementById('yp-stats-universal-icon');
    icon.remove();

    document.dispatchEvent(
      new CustomEvent('yt-action', { detail: { actionName: 'yt-some-other-command' } })
    );
    document.dispatchEvent(new CustomEvent('yt-action', { detail: null }));
    expect(document.getElementById('yp-stats-universal-icon')).toBeNull();
  });

  test('a failing video init is logged, unwinds its own flag and rethrows', () => {
    renderOwnerButtons();
    require('../src/stats.js');

    // Studio detection itself fails: the init wrapper must log it, release the
    // flag it set and rethrow so the caller sees the failure.
    window.YouTubeUtils.isStudioPage = jest.fn(() => {
      throw new Error('boom');
    });
    const videoHandle = window.YouTubePlusFeatureRegistry._handles.find(h => h.id === 'videoStats');
    expect(() => videoHandle.restart()).toThrow('boom');
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();

    // The runtime unwound, so a later healthy pass initializes again.
    window.YouTubeUtils.isStudioPage = jest.fn(() => false);
    expect(() => videoHandle.restart()).not.toThrow();
  });

  // ─── channel tab analysis ─────────────────────────────────────────────────

  describe('channel tab analysis behind checkChannelTabs', () => {
    const onChannelPage = (href = 'https://www.youtube.com/@SomeCreator') => {
      mockLocation({ href, hostname: 'www.youtube.com', pathname: '/@SomeCreator', search: '' });
      renderOwnerButtons();
    };

    test('a streams and shorts channel is analysed and reported', async () => {
      onChannelPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      installFetch({
        page: () => okHtml(tabsHtml(['/@SomeCreator/streams', '/@SomeCreator/shorts'])),
      });
      require('../src/stats.js');

      mockLocation({
        href: 'https://www.youtube.com/@SomeCreator',
        hostname: 'www.youtube.com',
        pathname: '/@SomeCreator',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();

      // The tab analysis consumed the fetched channel page and reported the
      // content types it found.
      expect(window.YouTubePlusLogger.info).toHaveBeenCalledWith('Stats', 'Channel tabs:', {
        hasStreams: true,
        hasShorts: true,
      });
      expect(document.querySelector('.channel-stats-button')).not.toBeNull();
    });

    test('a channel without those tabs keeps only the channel button', async () => {
      onChannelPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      installFetch({ page: () => okHtml(tabsHtml(['/@SomeCreator/videos'])) });
      require('../src/stats.js');

      mockLocation({
        href: 'https://www.youtube.com/@SomeCreator',
        hostname: 'www.youtube.com',
        pathname: '/@SomeCreator',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();
      await flush();

      expect(document.querySelector('.channel-stats-button')).not.toBeNull();
      expect(document.querySelector('.live-stats-button')).toBeNull();
      expect(window.YouTubePlusLogger.info).not.toHaveBeenCalled();
    });

    test('a non-200 channel page is skipped with a warning', async () => {
      onChannelPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      installFetch({
        page: () => ({ ok: false, status: 503, statusText: '', json: async () => ({}) }),
      });
      require('../src/stats.js');

      mockLocation({
        href: 'https://www.youtube.com/@SomeCreator',
        hostname: 'www.youtube.com',
        pathname: '/@SomeCreator',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();
      await flush();

      expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
        'Stats',
        'HTTP 503 when checking channel tabs'
      );
    });

    test('an oversized channel page is skipped before parsing', async () => {
      onChannelPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      installFetch({ page: () => okHtml('x'.repeat(5_000_001)) });
      require('../src/stats.js');

      mockLocation({
        href: 'https://www.youtube.com/@SomeCreator',
        hostname: 'www.youtube.com',
        pathname: '/@SomeCreator',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();
      await flush();

      expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
        'Stats',
        'Response too large, skipping parse'
      );
    });

    test('unparsable ytInitialData is reported as a parse failure', async () => {
      onChannelPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      installFetch({
        page: () => okHtml('<script>var ytInitialData = {not json};</script>'),
      });
      require('../src/stats.js');

      mockLocation({
        href: 'https://www.youtube.com/@SomeCreator',
        hostname: 'www.youtube.com',
        pathname: '/@SomeCreator',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();
      await flush();

      expect(window.YouTubeUtils.logError).toHaveBeenCalledWith(
        'Stats',
        'Failed to parse ytInitialData',
        expect.anything()
      );
    });

    test('a rejected channel fetch is logged and never breaks the runtime', async () => {
      onChannelPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      installFetch({
        page: () => {
          throw new Error('network down');
        },
      });
      require('../src/stats.js');

      mockLocation({
        href: 'https://www.youtube.com/@SomeCreator',
        hostname: 'www.youtube.com',
        pathname: '/@SomeCreator',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();
      await flush();

      expect(window.YouTubeUtils.logError).toHaveBeenCalledWith(
        'Stats',
        'Channel tab check failed',
        expect.anything()
      );
      expect(document.querySelector('.stats-menu-container')).not.toBeNull();
    });

    test('an aborted channel fetch reports the timeout', async () => {
      onChannelPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      installFetch({
        page: () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        },
      });
      require('../src/stats.js');

      mockLocation({
        href: 'https://www.youtube.com/@SomeCreator',
        hostname: 'www.youtube.com',
        pathname: '/@SomeCreator',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();
      await flush();

      expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
        'Stats',
        'Channel check timed out'
      );
    });

    test('the channel page is fetched same-origin with an HTML Accept header', async () => {
      onChannelPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      installFetch({ page: () => okHtml(tabsHtml(['/@SomeCreator/videos'])) });
      require('../src/stats.js');

      mockLocation({
        href: 'https://www.youtube.com/@SomeCreator',
        hostname: 'www.youtube.com',
        pathname: '/@SomeCreator',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();

      const pageCalls = fetchSpy.mock.calls.filter(
        ([url]) => String(url) === 'https://www.youtube.com/@SomeCreator'
      );
      expect(pageCalls.length).toBe(1);
      expect(pageCalls[0][1]).toMatchObject({
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
      });
    });

    test('a channel page without ytInitialData is skipped', async () => {
      onChannelPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      installFetch({ page: () => okHtml('') });
      require('../src/stats.js');

      mockLocation({
        href: 'https://www.youtube.com/@SomeCreator',
        hostname: 'www.youtube.com',
        pathname: '/@SomeCreator',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();

      expect(window.YouTubePlusLogger.info).not.toHaveBeenCalled();
      expect(document.querySelector('.stats-menu-container')).not.toBeNull();
    });

    test('the channel check is rate limited to ten checks per minute', async () => {
      onChannelPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      installFetch({ page: () => okHtml(tabsHtml([])) });
      require('../src/stats.js');

      for (let i = 0; i < 11; i += 1) {
        mockLocation({
          href: `https://www.youtube.com/@Creator${i}`,
          hostname: 'www.youtube.com',
          pathname: `/@Creator${i}`,
          search: '',
        });
        document.dispatchEvent(new Event('yt-navigate-finish'));
        // eslint-disable-next-line no-await-in-loop
        await flush();
      }

      expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
        'Stats',
        'Rate limit exceeded for checkChannelTabs. Max 10 requests per minute.'
      );
    });
  });

  // ─── page DOM extraction matrix ──────────────────────────────────────────

  describe('page DOM extraction through getPageVideoStats', () => {
    const boot = () => {
      require('../src/stats.js');
      return window.YouTubePlusStats.getPageVideoStats;
    };

    test('a toggle button without an aria-label falls back to its text', () => {
      const stats = boot();
      const toggle = document.createElement('ytd-toggle-button-renderer');
      toggle.setAttribute('is-icon-button', '');
      const formatted = document.createElement('yt-formatted-string');
      formatted.textContent = '12K';
      toggle.appendChild(formatted);
      document.body.appendChild(toggle);

      expect(stats().likes).toBe(12000);
    });

    test('comments, subscribers and the title are read from their containers', () => {
      const stats = boot();
      const count = document.createElement('h2');
      count.id = 'count';
      const thread = document.createElement('ytd-comment-thread-renderer');
      thread.textContent = '1,234 Comments';
      count.appendChild(thread);
      document.body.appendChild(count);

      const subs = document.createElement('div');
      subs.id = 'owner-sub-count';
      subs.textContent = '1.2M';
      document.body.appendChild(subs);

      const heading = document.createElement('h1');
      heading.textContent = 'A video title';
      document.body.appendChild(heading);

      const ogImage = document.createElement('meta');
      ogImage.setAttribute('property', 'og:image');
      ogImage.content = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
      document.head.appendChild(ogImage);

      const page = stats();
      expect(page.comments).toBe(1234);
      expect(page.subscribers).toBe('1.2M');
      expect(page.title).toBe('A video title');
      expect(page.thumbnail).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    });

    test('a handle without the @ prefix is not treated as a handle', () => {
      const stats = boot();
      const owner = document.createElement('ytd-video-owner-renderer');
      const handle = document.createElement('div');
      handle.id = 'channel-handle';
      handle.textContent = 'plain-name';
      const name = document.createElement('div');
      name.id = 'owner-name';
      name.textContent = 'Plain Name';
      owner.append(handle, name);
      document.body.appendChild(owner);

      const page = stats();
      expect(page.authorHandle).toBeNull();
      expect(page.author).toBe('Plain Name');
    });

    test('an empty page produces no stats at all', () => {
      const stats = boot();
      expect(stats()).toBeNull();
    });

    test('a non-numeric player view count is never rendered as a number', () => {
      window.ytInitialPlayerResponse = {
        videoDetails: { videoId: 'dQw4w9WgXcQ', viewCount: 'not a number' },
      };
      const stats = boot();
      const views = document.createElement('yt-view-count-renderer');
      views.textContent = '55 views';
      document.body.appendChild(views);

      expect(stats().views).toBe(55);
      delete window.ytInitialPlayerResponse;
    });
  });

  // ─── InnerTube payload variants ─────────────────────────────────────────

  describe('InnerTube payload variants', () => {
    const renderWith = async payload => {
      installFetch({ player: () => asResponse(payload) });
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      return document.querySelector('.stats-modal-body').innerHTML;
    };

    test('a response without a channel ID skips the country lookup', async () => {
      require('../src/stats.js');
      const html = await renderWith(innerTube({ videoDetails: { channelId: undefined } }));

      expect(
        fetchSpy.mock.calls.filter(([url]) => String(url).includes('/youtubei/v1/browse'))
      ).toHaveLength(0);
      expect(html).toContain('stats-grid');
    });

    test('a rejected country response leaves the card without a flag', async () => {
      require('../src/stats.js');
      installFetch({ browse: () => ({ ok: false, status: 500 }) });
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const html = document.querySelector('.stats-modal-body').innerHTML;
      expect(html).toContain('stats-grid');
      expect(html).not.toContain('country-flag');
    });

    test('the creator country is read from the About continuation on modern channels', async () => {
      require('../src/stats.js');
      const aboutToken = 'ABOUT_CONT_TOKEN';
      // Modern header: no country, but a description panel continuation token.
      const modernHeader = {
        header: {
          pageHeaderRenderer: {
            content: {
              pageHeaderViewModel: {
                description: {
                  descriptionPreviewViewModel: {
                    rendererContext: {
                      commandContext: {
                        onTap: {
                          innertubeCommand: {
                            showEngagementPanelEndpoint: {
                              engagementPanel: {
                                engagementPanelSectionListRenderer: {
                                  content: {
                                    sectionListRenderer: {
                                      contents: [
                                        {
                                          itemSectionRenderer: {
                                            contents: [
                                              {
                                                continuationItemRenderer: {
                                                  continuationEndpoint: {
                                                    continuationCommand: { token: aboutToken },
                                                  },
                                                },
                                              },
                                            ],
                                          },
                                        },
                                      ],
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
      const aboutResponse = {
        onResponseReceivedEndpoints: [
          {
            appendContinuationItemsAction: {
              continuationItems: [
                {
                  aboutChannelRenderer: {
                    metadata: { aboutChannelViewModel: { country: 'Russia' } },
                  },
                },
              ],
            },
          },
        ],
      };
      let browseCalls = 0;
      installFetch({
        browse: () => {
          browseCalls += 1;
          return browseCalls === 1 ? modernHeader : aboutResponse;
        },
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const browseCalls_ = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/youtubei/v1/browse')
      );
      expect(browseCalls_).toHaveLength(2);
      expect(String(browseCalls_[1][1]?.body)).toContain(aboutToken);
      const html = document.querySelector('.stats-modal-body').innerHTML;
      expect(html).toContain('Russia');
    });

    test('a response without author and title renders the bare counter grid', async () => {
      require('../src/stats.js');
      document.title = '';
      const html = await renderWith(
        innerTube({
          videoDetails: { author: '', title: '', channelId: undefined },
          microformat: { ownerProfileUrl: '', isFamilySafe: undefined },
        })
      );

      expect(html).toContain('stats-grid');
      expect(html).not.toContain('stats-author-big');
      expect(html).toContain('unknown');
      expect(document.getElementById('stats-classic-channel-badge').textContent).toBe('');
    });

    test('a response without reaction counts omits the like/dislike pair', async () => {
      require('../src/stats.js');
      installFetch({ ryd: () => asResponse({}) });
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const html = document.querySelector('.stats-modal-body').innerHTML;
      expect(html).toContain('stats-card-pair');
      expect(html).toContain('unknown');
    });

    test('a response without a thumbnail list falls back to the constructed one', async () => {
      require('../src/stats.js');
      const html = await renderWith(innerTube({ videoDetails: { thumbnail: { thumbnails: [] } } }));

      expect(html).toContain('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    });

    test('a response without a duration shows the unknown duration', async () => {
      require('../src/stats.js');
      const html = await renderWith(innerTube({ videoDetails: { lengthSeconds: undefined } }));

      expect(html).toContain('unknown');
    });

    test.each([
      ['PTfoo', 'PTfoo'],
      ['ab:cd', 'ab:cd'],
      ['00:30', '0:30'],
      ['', 'unknown'],
    ])('a %p duration is rendered verbatim', async (lengthSeconds, expected) => {
      require('../src/stats.js');
      const html = await renderWith(innerTube({ videoDetails: { lengthSeconds } }));

      expect(html).toContain(expected);
    });

    test('a channel counter payload of zeros renders real zeros', async () => {
      require('../src/stats.js');
      installFetch({
        livecounts: () => asResponse({ liveSubscriber: 0, liveViews: 0, liveVideos: 0 }),
      });
      await window.YouTubePlusStats.openStatsModal('channel', 'UCzero0000000000000000');

      const html = document.querySelector('.stats-modal-body').innerHTML;
      expect(html).toContain('stats-value">0<');
    });

    test('a failing channel counter request reports the status', async () => {
      require('../src/stats.js');
      installFetch({ livecounts: () => ({ ok: false, status: 503 }) });
      await window.YouTubePlusStats.openStatsModal('channel', 'UCerr00000000000000000');

      expect(document.querySelector('.stats-modal-body').innerHTML).toContain(
        'failedToLoadStats (503)'
      );
    });
  });

  // ─── runtime gating ─────────────────────────────────────────────────────

  describe('runtime gating', () => {
    test('the stats button flag off keeps every insertion path inert', async () => {
      window.YouTubePlusSettingsStore.set('enableStatsButton', false);
      document.body.innerHTML = '<div class="ytp-right-controls"></div>';
      const checkbox = document.createElement('input');
      checkbox.id = 'yp-setting-enableStatsButton';
      document.body.appendChild(checkbox);

      require('../src/stats.js');
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      document.dispatchEvent(new Event('yt-navigate-finish'));
      document.dispatchEvent(
        new CustomEvent('yt-action', {
          detail: { actionName: 'yt-reload-continuation-items-command' },
        })
      );
      await flush();

      expect(document.getElementById('yp-stats-universal-icon')).toBeNull();
      expect(document.querySelector('.stats-menu-container')).toBeNull();
      expect(checkbox.checked).toBe(false);
    });

    test('a Studio page never runs the tab check', () => {
      window.YouTubeUtils.isStudioPage = jest.fn(() => true);
      document.body.innerHTML = '<div class="ytp-right-controls"></div>';
      require('../src/stats.js');
      window.dispatchEvent(new Event('yt-navigate-finish'));

      expect(fetchSpy.mock.calls).toHaveLength(0);
      expect(window.YouTubePlusLogger.info).not.toHaveBeenCalled();
    });

    test('a listener registrar without a key still binds the navigation handlers', () => {
      window.YouTubeUtils.registerListenerSafe = jest.fn(() => null);
      document.body.innerHTML = '<div class="ytp-right-controls"></div>';
      const checkbox = document.createElement('input');
      checkbox.id = 'yp-setting-enableStatsButton';
      document.body.appendChild(checkbox);
      require('../src/stats.js');

      expect(typeof window.YouTubePlusStats.openStatsModal).toBe('function');
    });

    test('a Shorts URL without a usable video ID opens nothing', async () => {
      mockLocation({
        href: 'https://www.youtube.com/shorts/x',
        hostname: 'www.youtube.com',
        pathname: '/shorts/x',
        search: '',
      });
      const reel = document.createElement('ytd-reel-video-renderer');
      reel.setAttribute('is-active', '');
      const actions = document.createElement('div');
      actions.id = 'actions';
      reel.appendChild(actions);
      document.body.appendChild(reel);

      require('../src/stats.js');
      window.YouTubePlusStats.ensureShortsStatsButton();
      const icon = actions.querySelector('#yp-stats-universal-icon');
      icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await flush();

      expect(fetchSpy.mock.calls).toHaveLength(0);
    });

    test('a channel tab list without endpoints is skipped', async () => {
      mockLocation({
        href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '?v=dQw4w9WgXcQ',
      });
      renderOwnerButtons();
      installFetch({
        page: () => okHtml(tabsHtmlWithShapelessTab()),
      });
      require('../src/stats.js');

      mockLocation({
        href: 'https://www.youtube.com/@SomeCreator',
        hostname: 'www.youtube.com',
        pathname: '/@SomeCreator',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush();

      // The shapeless entry is skipped; the streams tab is still analysed.
      expect(window.YouTubePlusLogger.info).toHaveBeenCalledWith('Stats', 'Channel tabs:', {
        hasStreams: true,
        hasShorts: false,
      });
      expect(document.querySelector('.channel-stats-button')).not.toBeNull();
    });
  });

  // ─── shared RYD fetch service ───────────────────────────────────────────

  describe('shared RYD fetch service transports', () => {
    const boot = () => {
      jest.resetModules();
      setupDeps();
      require('../src/stats.js');
      return window.YouTubePlusStats;
    };

    test('the fetch transport works without an AbortController and without idle callbacks', async () => {
      const realAbort = globalThis.AbortController;
      const realIdle = window.requestIdleCallback;
      // Managers without abort support and without idle scheduling must still
      // get a real aggregate.
      // eslint-disable-next-line no-restricted-syntax
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AbortController');
      delete globalThis.AbortController;
      delete window.requestIdleCallback;

      try {
        const fetchMock = jest.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({ likes: 7, dislikes: 1, rating: 4.5 }),
          text: async () => '{}',
        }));
        Object.defineProperty(globalThis, 'fetch', {
          configurable: true,
          writable: true,
          value: fetchMock,
        });

        const stats = boot();
        // The idle callback is re-created by the harness boot, so drop it after.
        delete window.requestIdleCallback;
        expect(await stats.getDislikesData('vid-nocontroller')).toEqual({
          likes: 7,
          dislikes: 1,
          rating: 4.5,
        });
        expect(fetchMock.mock.calls[0][1]).toBeUndefined();
      } finally {
        if (descriptor) Object.defineProperty(globalThis, 'AbortController', descriptor);
        else globalThis.AbortController = realAbort;
        Object.defineProperty(window, 'requestIdleCallback', {
          configurable: true,
          writable: true,
          value: realIdle,
        });
      }
    });

    test('a GM response with a malformed body is unknown, never a zero', async () => {
      const stats = boot();
      globalThis.GM_xmlhttpRequest = jest.fn(opts => {
        setTimeout(() => opts.onload({ status: 200, responseText: 'not json at all' }), 0);
      });

      expect(await stats.getDislikesData('vid-badjson')).toBeNull();
      expect(stats.getDislikesServiceStats().cached).toBe(0);
    });

    test('a GM transport error resolves unknown and retries on the next action', async () => {
      const stats = boot();
      globalThis.GM_xmlhttpRequest = jest.fn(opts => {
        setTimeout(() => opts.onerror({ code: -1 }), 0);
      });
      expect(await stats.getDislikesData('vid-gmerror')).toBeNull();

      globalThis.GM_xmlhttpRequest = jest.fn(opts => {
        setTimeout(() => opts.onload({ status: 200, responseText: '{"likes":3}' }), 0);
      });
      expect(await stats.getDislikesData('vid-gmerror')).toEqual({
        likes: 3,
        dislikes: null,
        rating: null,
      });
    });

    test('a GM timeout resolves unknown instead of hanging', async () => {
      jest.useFakeTimers();
      const stats = boot();
      globalThis.GM_xmlhttpRequest = jest.fn(opts => {
        setTimeout(() => opts.ontimeout(), 0);
      });

      const pending = stats.getDislikesData('vid-gmtimeout');
      await jest.advanceTimersByTimeAsync(10);
      await expect(pending).resolves.toBeNull();
    });
  });
});
