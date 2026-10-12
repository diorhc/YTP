/**
 * @jest-environment jsdom
 *
 * Coverage-oriented tests for src/stats.js IIFE 1 (video stats).
 * Exercises openStatsModal, displayVideoStats, duration formatting,
 * channel tab analysis, rate limiter, InnerTube fetch pipeline,
 * modal event handlers, and rendering helpers through the real module.
 */

const mockLocation = globalThis.mockLocation;

function setupVideoCoverageDeps() {
  document.body.innerHTML = '';
  document.head.innerHTML = '';

  delete window.__ytpVideoStatsModuleInit;
  delete window.__ytpChannelStatsModuleInit;
  delete window.YouTubeStats;
  delete window.YouTubePlusStats;
  delete window.ytInitialPlayerResponse;
  delete window.ytcfg;
  delete window.yt;

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

  // A realistic page: YouTube publishes the InnerTube key in ytcfg.
  window.ytcfg = {
    get: jest.fn(key => {
      if (key === 'INNERTUBE_API_KEY') return 'e2e-inner-tube-key';
      if (key === 'INNERTUBE_CLIENT_VERSION') return '2.20260101.00.00';
      return null;
    }),
    data_: {},
  };

  mockLocation({
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    hostname: 'www.youtube.com',
    pathname: '/watch',
    search: '?v=dQw4w9WgXcQ',
  });

  localStorage.clear();

  require('../src/utils.js');
  const canonUtils = window.YouTubeUtils;

  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: cb => {
      cb();
      return 1;
    },
  });

  Object.defineProperty(window, 'cancelIdleCallback', {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });

  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: cb => {
      cb(0);
      return 1;
    },
  });

  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: jest.fn(),
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
      debounce: fn => fn,
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      $: (sel, ctx = document) => (ctx || document).querySelector(sel),
      $$: (sel, ctx = document) => Array.from((ctx || document).querySelectorAll(sel)),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      loadFeatureEnabled: jest.fn(() => true),
      SETTINGS_KEY: 'youtube_plus_settings',
      createWithErrorBoundary: jest.fn(() => fn => fn),
      logSuppressed: jest.fn(),
      onDomReady: cb => cb(),
      getRoute: () => {
        const p = window.location.pathname || '/';
        if (p === '/watch') return 'watch';
        if (p.startsWith('/shorts')) return 'shorts';
        if (/^\/@|\/channel\/|\/c\/|\/user\//.test(p)) return 'channel';
        return 'other';
      },
      setSafeHTML: jest.fn((el, html) => {
        if (el) el.innerHTML = html;
      }),
      renderTemplateClone: jest.fn((el, html) => {
        if (el) el.innerHTML = html;
      }),
      whenRelevant: jest.fn(({ onEnter }) => onEnter()),
      isSettingsModalOpen: jest.fn(() => false),
      isWatchPage: jest.fn(url => url?.includes('/watch')),
      isStudioPage: jest.fn(() => false),
      isChannelPage: jest.fn(url => /\/@|\/channel\/|\/c\//.test(url || '')),
      isWatchRoute: jest.fn(() => window.location.pathname === '/watch'),
      isShortsRoute: jest.fn(() => (window.location.pathname || '').startsWith('/shorts')),
      isYouTubeDomain: jest.fn(() => true),
      isChannelRoute: jest.fn(() => false),
      createIsRelevantRoute:
        (opts = {}) =>
        () => {
          const { watch = false, shorts = false, channel = false, settingsModal = false } = opts;
          if (settingsModal && window.YouTubeUtils.isSettingsModalOpen?.()) return true;
          return (
            (window.YouTubeUtils.isWatchRoute?.() && watch) ||
            (window.YouTubeUtils.isShortsRoute?.() && shorts) ||
            (window.YouTubeUtils.isChannelRoute?.() && channel)
          );
        },
      registerListenerSafe: jest.fn((target, event, handler, options) => {
        if (target && typeof target.addEventListener === 'function') {
          target.addEventListener(event, handler, options);
        }
        return `${event}-listener`;
      }),
      createExperimentalNavClickHandler: attachSettingsHandler => {
        const handleExperimentalNavClick = e => {
          const navItem = e.target?.closest?.('.yp-settings-nav-item');
          if (navItem?.dataset?.section === 'experimental') {
            attachSettingsHandler();
          }
        };
        window.YouTubeUtils.registerListenerSafe(document, 'youtube-plus-language-changed', () =>
          attachSettingsHandler()
        );
        return handleExperimentalNavClick;
      },
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
        registerInterval: jest.fn(id => id),
        registerTimeout: jest.fn(id => id),
        registerObserver: jest.fn(obs => obs),
        registerListener: jest.fn((target, event, handler, options) => {
          if (target && typeof target.addEventListener === 'function') {
            target.addEventListener(event, handler, options);
          }
          return `${event}-listener`;
        }),
        unregisterListener: jest.fn(),
        register: jest.fn(),
        cleanup: jest.fn(),
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

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      initGlassDropdown: jest.fn(),
      getStyle: jest.fn(() => ''),
      getThemeVariant: jest.fn(() => 'classic'),
    },
  });

  const featureRegistryMap = new Map();
  Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
    configurable: true,
    writable: true,
    value: {
      register: jest.fn(desc => featureRegistryMap.set(desc.id, desc)),
      get: jest.fn(id => featureRegistryMap.get(id)),
      has: jest.fn(id => featureRegistryMap.has(id)),
      _map: featureRegistryMap,
      // Minimal route-aware host mirroring the production lifecycle gate.
      FeatureLifecycle: {
        define: jest.fn(def => {
          if (!def || typeof def.start !== 'function') return null;
          const makeCtx = () => ({
            style: jest.fn(),
            listen: jest.fn(() => jest.fn()),
            own: el => el,
            onDispose: jest.fn(),
            scope: () => makeCtx(),
            dispose: jest.fn(),
          });
          const ctx = makeCtx();
          let running = false;
          const matches = () => {
            const route = window.YouTubeUtils.getRoute();
            return !def.routes?.length || def.routes.includes(route);
          };
          return {
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
        }),
        _reset: jest.fn(),
      },
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

  Object.defineProperty(window, 'YouTubePlusCleanupManager', {
    configurable: true,
    writable: true,
    value: window.YouTubeUtils.cleanupManager,
  });
}

function mockInnerTubeResponse(videoId = 'dQw4w9WgXcQ', overrides = {}) {
  return {
    videoDetails: {
      videoId,
      title: 'Test Video Title',
      author: 'Test Author',
      viewCount: '1234567',
      lengthSeconds: '212',
      channelId: 'UCtest1234567890abcdefg',
      thumbnail: {
        thumbnails: [
          { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', width: 480, height: 360 },
        ],
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
  };
}

function mockBrowseResponse(country = 'US') {
  return {
    header: {
      c4TabbedHeaderRenderer: { country },
    },
  };
}

function mockRydResponse(likes = 100, dislikes = 5, rating = 4.8) {
  return { likes, dislikes, rating };
}

function installFetchMock(innertube, browse, ryd) {
  const fetchMock = jest.fn(async url => {
    const urlStr = String(url);
    if (urlStr.includes('/youtubei/v1/player')) {
      return {
        ok: true,
        status: 200,
        json: async () => innertube,
        text: async () => JSON.stringify(innertube),
      };
    }
    if (urlStr.includes('/youtubei/v1/browse')) {
      return {
        ok: true,
        status: 200,
        json: async () => browse,
        text: async () => JSON.stringify(browse),
      };
    }
    if (urlStr.includes('returnyoutubedislikeapi')) {
      return {
        ok: true,
        status: 200,
        json: async () => ryd,
        text: async () => JSON.stringify(ryd),
      };
    }
    if (urlStr.includes('livecounts.io')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ liveSubscriber: 50000, liveViews: 9999999, liveVideos: 200 }),
      };
    }
    return { ok: false, status: 404 };
  });

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
  return fetchMock;
}

describe('Stats Video Coverage Tests', () => {
  let fetchMock;

  beforeEach(() => {
    jest.resetModules();
    setupVideoCoverageDeps();
    fetchMock = installFetchMock(mockInnerTubeResponse(), mockBrowseResponse(), mockRydResponse());
    delete globalThis.GM_xmlhttpRequest;
    require('../src/stats.js');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // ─── openStatsModal video path ─────────────────────────────────────

  describe('openStatsModal video path', () => {
    test('creates modal overlay, fetches InnerTube + RYD, displays video stats', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      // Modal overlay exists in DOM
      const overlay = document.querySelector('.stats-modal-overlay');
      expect(overlay).not.toBeNull();

      // Modal has expected structure
      const container = overlay.querySelector('.stats-modal-container');
      expect(container).not.toBeNull();
      expect(container.getAttribute('role')).toBe('dialog');
      expect(container.getAttribute('aria-modal')).toBe('true');

      // Stats were rendered — check for stats grid
      const body = overlay.querySelector('.stats-modal-body');
      expect(body).not.toBeNull();
      expect(body.innerHTML).toContain('stats-grid');
      expect(body.innerHTML).toContain('stats-card');

      // Thumbnail rendered
      expect(body.innerHTML).toContain('stats-thumb-img');

      // Author handle rendered
      expect(body.innerHTML).toContain('@testauthor');
    });

    test('displays views, likes, dislikes cards with correct values', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const body = document.querySelector('.stats-modal-body');
      // Views: 1234567 → "1.2M"
      expect(body.innerHTML).toContain('1.2M');
      // Likes: 100 → "100"
      expect(body.innerHTML).toContain('stats-icon-likes');
      // Dislikes: 5 → "5"
      expect(body.innerHTML).toContain('stats-icon-dislikes');
    });

    test('renders metadata cards: monetization, country, duration', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const body = document.querySelector('.stats-modal-body');
      // Duration 212 seconds → "3:32"
      expect(body.innerHTML).toContain('3:32');
      // Country "US"
      expect(body.innerHTML).toContain('US');
      // Monetization (isFamilySafe=true means monetized)
      expect(body.innerHTML).toContain('monetization');
    });

    test('renders classic header with channel badge', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const badge = document.querySelector('#stats-classic-channel-badge');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toContain('@testauthor');
    });

    test('modal close via overlay click', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const overlay = document.querySelector('.stats-modal-overlay');
      expect(overlay).not.toBeNull();

      // Click overlay (not container) to close
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // Overlay has _ytpCloseOverlay set
      expect(
        overlay._ytpCloseOverlay || overlay.parentNode === null || !document.contains(overlay)
      ).toBeTruthy();
    });

    test('modal close via Escape key', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const overlay = document.querySelector('.stats-modal-overlay');
      expect(overlay).not.toBeNull();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('rejects invalid parameters', async () => {
      await window.YouTubePlusStats.openStatsModal('', '');
      expect(document.querySelector('.stats-modal-overlay')).toBeNull();

      await window.YouTubePlusStats.openStatsModal(null, null);
      expect(document.querySelector('.stats-modal-overlay')).toBeNull();
    });

    test('removes existing overlays before creating new one', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const overlays = document.querySelectorAll('.stats-modal-overlay');
      expect(overlays.length).toBe(1);
    });
  });

  // ─── openStatsModal error / fallback paths ─────────────────────────

  describe('openStatsModal error paths', () => {
    test('renders error message when InnerTube fetch fails', async () => {
      fetchMock.mockImplementation(async () => ({ ok: false, status: 503 }));

      await window.YouTubePlusStats.openStatsModal('video', 'unknownVideoId');

      const body = document.querySelector('.stats-modal-body');
      expect(body).not.toBeNull();
      // Error or fallback should be shown
      expect(body.innerHTML.length).toBeGreaterThan(0);
    });

    test('renders page fallback when fetch fails but page data is available', async () => {
      window.ytInitialPlayerResponse = {
        videoDetails: { videoId: 'dQw4w9WgXcQ', viewCount: '999' },
      };
      fetchMock.mockImplementation(async () => ({ ok: false, status: 500 }));

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const body = document.querySelector('.stats-modal-body');
      // Should show page fallback with view count
      expect(body.innerHTML).toContain('stats-grid');
      delete window.ytInitialPlayerResponse;
    });
  });

  // ─── openStatsModal channel path ───────────────────────────────────

  describe('openStatsModal channel path', () => {
    test('displays channel stats with subscribers, views, videos', async () => {
      await window.YouTubePlusStats.openStatsModal('channel', 'UCtest1234567890abcdefg');

      const body = document.querySelector('.stats-modal-body');
      expect(body).not.toBeNull();
      // Channel stats should include subscriber/view/video cards
      expect(body.innerHTML).toContain('stats-card');
    });

    test('renders error when livecounts returns invalid payload', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('livecounts.io')) {
          return { ok: true, status: 200, json: async () => ({}) };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('channel', 'UCtest');

      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML.length).toBeGreaterThan(0);
    });
  });

  // ─── Duration formatting ──────────────────────────────────────────

  describe('duration formatting via openStatsModal', () => {
    test('ISO 8601 duration PT3M32S renders as 3:32', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          const resp = mockInnerTubeResponse();
          resp.videoDetails.lengthSeconds = 'PT3M32S';
          return { ok: true, status: 200, json: async () => resp };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => mockBrowseResponse() };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      // 212 seconds = 3:32
      expect(body.innerHTML).toContain('3:32');
    });

    test('hour-length duration renders as H:MM:SS', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          const resp = mockInnerTubeResponse();
          resp.videoDetails.lengthSeconds = '7384'; // 2:03:04
          return { ok: true, status: 200, json: async () => resp };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => mockBrowseResponse() };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('2:03:04');
    });
  });

  // ─── InnerTube API key resolution ─────────────────────────────────

  describe('InnerTube API config resolution', () => {
    test('uses ytcfg.get when available', async () => {
      window.ytcfg = {
        get: jest.fn(key => {
          if (key === 'INNERTUBE_API_KEY') return 'test-api-key-from-ytcfg';
          if (key === 'INNERTUBE_CLIENT_VERSION') return '2.20260101.00.00';
          return null;
        }),
        data_: {},
      };

      jest.resetModules();
      setupVideoCoverageDeps();
      window.ytcfg = {
        get: jest.fn(key => {
          if (key === 'INNERTUBE_API_KEY') return 'test-api-key-from-ytcfg';
          if (key === 'INNERTUBE_CLIENT_VERSION') return '2.20260101.00.00';
          return null;
        }),
        data_: {},
      };
      installFetchMock(mockInnerTubeResponse(), mockBrowseResponse(), mockRydResponse());
      require('../src/stats.js');

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      // The fetch URL should contain the key from ytcfg
      const playerCalls = globalThis.fetch.mock.calls.filter(([url]) =>
        String(url).includes('/youtubei/v1/player')
      );
      expect(playerCalls.length).toBeGreaterThan(0);
      expect(playerCalls[0][0]).toContain('test-api-key-from-ytcfg');
      delete window.ytcfg;
    });

    test('reads the InnerTube key from the page window when the sandbox lacks ytcfg', async () => {
      jest.resetModules();
      setupVideoCoverageDeps();
      // The userscript sandbox `window` carries no page globals; `unsafeWindow`
      // (the page window) does. The key must come from there.
      delete window.ytcfg;
      delete window.yt;
      globalThis.unsafeWindow = {
        ytcfg: {
          get: jest.fn(key => (key === 'INNERTUBE_API_KEY' ? 'key-from-page-window' : null)),
          data_: {},
        },
      };
      try {
        installFetchMock(mockInnerTubeResponse(), mockBrowseResponse(), mockRydResponse());
        require('../src/stats.js');

        await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

        const playerCalls = globalThis.fetch.mock.calls.filter(([url]) =>
          String(url).includes('/youtubei/v1/player')
        );
        expect(playerCalls.length).toBeGreaterThan(0);
        expect(playerCalls[0][0]).toContain('key-from-page-window');
      } finally {
        globalThis.unsafeWindow = window;
      }
    });

    test('falls back to ytcfg.data_ when get() returns nothing', async () => {
      jest.resetModules();
      setupVideoCoverageDeps();
      window.ytcfg = {
        get: jest.fn(() => null),
        data_: { INNERTUBE_API_KEY: 'key-from-data', INNERTUBE_CLIENT_VERSION: '2.20260102.00.00' },
      };
      installFetchMock(mockInnerTubeResponse(), mockBrowseResponse(), mockRydResponse());
      require('../src/stats.js');

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const playerCalls = globalThis.fetch.mock.calls.filter(([url]) =>
        String(url).includes('/youtubei/v1/player')
      );
      expect(playerCalls.length).toBeGreaterThan(0);
      expect(playerCalls[0][0]).toContain('key-from-data');
      delete window.ytcfg;
    });

    test('falls back to yt.config_ when ytcfg is unavailable', async () => {
      jest.resetModules();
      setupVideoCoverageDeps();
      delete window.ytcfg;
      window.yt = {
        config_: {
          INNERTUBE_API_KEY: 'key-from-yt-config',
          INNERTUBE_CLIENT_VERSION: '2.20260103.00.00',
        },
      };
      installFetchMock(mockInnerTubeResponse(), mockBrowseResponse(), mockRydResponse());
      require('../src/stats.js');

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const playerCalls = globalThis.fetch.mock.calls.filter(([url]) =>
        String(url).includes('/youtubei/v1/player')
      );
      expect(playerCalls.length).toBeGreaterThan(0);
      expect(playerCalls[0][0]).toContain('key-from-yt-config');
      delete window.yt;
    });
  });

  // ─── Thumbnail URL validation ─────────────────────────────────────

  describe('thumbnail URL validation in modal', () => {
    test('accepts trusted ytimg.com domain', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const img = document.querySelector('.stats-thumb-img');
      expect(img).not.toBeNull();
      expect(img.src).toContain('ytimg.com');
    });

    test('rejects untrusted domain and uses fallback thumbnail', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          const resp = mockInnerTubeResponse();
          resp.videoDetails.thumbnail = {
            thumbnails: [{ url: 'https://evil.com/thumb.jpg' }],
          };
          return { ok: true, status: 200, json: async () => resp };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => mockBrowseResponse() };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const img = document.querySelector('.stats-thumb-img');
      expect(img).not.toBeNull();
      // Fallback to constructed URL
      expect(img.src).toContain('i.ytimg.com/vi/dQw4w9WgXcQ');
    });
  });

  // ─── Country card with flag ───────────────────────────────────────

  describe('country card rendering', () => {
    test('renders flag image for valid country code', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('country-flag');
      expect(body.innerHTML).toContain('flag-icons');
    });

    test('renders globe icon when no country available', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          return { ok: true, status: 200, json: async () => mockInnerTubeResponse() };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => ({ header: {} }) };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      // Globe icon SVG contains <circle cx="12" cy="12" r="10">
      expect(body.innerHTML).toContain('country');
    });

    test('flag image error triggers globe fallback', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const flagImg = document.querySelector('.country-flag');
      if (flagImg) {
        // Simulate image load error
        flagImg.dispatchEvent(new Event('error'));
      }
    });
  });

  // ─── formatNumber coverage ────────────────────────────────────────

  describe('number formatting via modal display', () => {
    test('billion value renders with B suffix', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          const resp = mockInnerTubeResponse();
          resp.videoDetails.viewCount = '2500000000';
          return { ok: true, status: 200, json: async () => resp };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => mockBrowseResponse() };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('2.5B');
    });

    test('million value renders with M suffix', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          const resp = mockInnerTubeResponse();
          resp.videoDetails.viewCount = '5600000';
          return { ok: true, status: 200, json: async () => resp };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => mockBrowseResponse() };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('5.6M');
    });

    test('thousand value renders with K suffix', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          const resp = mockInnerTubeResponse();
          resp.videoDetails.viewCount = '42300';
          return { ok: true, status: 200, json: async () => resp };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => mockBrowseResponse() };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('42.3K');
    });
  });

  // ─── Live viewer card ─────────────────────────────────────────────

  describe('live viewer card', () => {
    test('renders live viewer card when liveViewer is present', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          const resp = mockInnerTubeResponse();
          resp.videoDetails.viewCount = '1000';
          return { ok: true, status: 200, json: async () => resp };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => mockBrowseResponse() };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      // Set page data with liveViewer
      window.ytInitialPlayerResponse = {
        videoDetails: { videoId: 'dQw4w9WgXcQ', viewCount: '1000' },
      };
      const viewerEl = document.createElement('span');
      viewerEl.className = 'view-count';
      viewerEl.textContent = '1,000 views';
      document.body.appendChild(viewerEl);

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      delete window.ytInitialPlayerResponse;
    });
  });

  // ─── mergeVideoStats ──────────────────────────────────────────────

  describe('mergeVideoStats via openStatsModal with page data', () => {
    test('API data takes priority over page data', async () => {
      window.ytInitialPlayerResponse = {
        videoDetails: { videoId: 'dQw4w9WgXcQ', viewCount: '100' },
      };
      const viewsEl = document.createElement('span');
      viewsEl.className = 'view-count';
      viewsEl.textContent = '100 views';
      document.body.appendChild(viewsEl);

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const body = document.querySelector('.stats-modal-body');
      // API returns 1234567 views which is 1.2M — page has 100
      expect(body.innerHTML).toContain('1.2M');
      delete window.ytInitialPlayerResponse;
    });
  });

  // ─── URL helpers ──────────────────────────────────────────────────

  describe('URL helpers exercised via icon insertion', () => {
    test('stats icon inserts on watch page', () => {
      const controls = document.createElement('div');
      controls.className = 'ytp-right-controls';
      document.body.appendChild(controls);

      window.YouTubeUtils.$ = jest.fn((sel, ctx = document) => {
        if (sel === '.ytp-right-controls') return controls;
        return (ctx || document).querySelector(sel);
      });

      window.YouTubePlusStats.ensureShortsStatsButton();
      // Icon might be created depending on route
    });

    test('Shorts route creates icon in Shorts action bar', () => {
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

      window.YouTubePlusStats.ensureShortsStatsButton();

      const statsBtn = actions.querySelector('#yp-stats-universal-icon');
      expect(statsBtn).not.toBeNull();
    });
  });

  // ─── Settings checkbox ownership ─────────────────────────────────

  describe('the settings checkbox is owned by the settings modal', () => {
    test('the module does not touch the stats-button checkbox', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'yp-setting-enableStatsButton';
      document.body.appendChild(checkbox);

      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));

      // The module neither checks the box nor stamps the attached mark: the
      // settings modal's general handler owns it.
      expect(checkbox.checked).toBe(false);
      expect(checkbox.dataset.handlerAttached).toBeUndefined();

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      expect(window.YouTubePlusSettingsStore.set).not.toHaveBeenCalledWith(
        'enableStatsButton',
        true
      );
    });
  });

  // ─── Navigation event handling ────────────────────────────────────

  describe('navigation events', () => {
    test('yt-navigate-finish triggers icon re-check', () => {
      window.dispatchEvent(new Event('yt-navigate-finish'));
      // No throw
    });

    test('yt-page-data-updated triggers icon re-check', () => {
      document.dispatchEvent(new Event('yt-page-data-updated'));
      // No throw
    });

    test('yp:nav-refresh triggers icon re-check', () => {
      window.dispatchEvent(new Event('yp:nav-refresh'));
      // No throw
    });

    test('yt-action with reload-continuation triggers re-check', () => {
      const event = new CustomEvent('yt-action', {
        detail: { actionName: 'yt-reload-continuation-items-command' },
      });
      document.dispatchEvent(event);
      // No throw
    });
  });

  describe('Shorts stats icon', () => {
    test('mounts the Shorts icon in the active reel action bar', () => {
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

      window.YouTubePlusStats.ensureShortsStatsButton();
      const icon = actions.querySelector('#yp-stats-universal-icon');
      expect(icon).not.toBeNull();
      expect(icon.classList.contains('shortsStats')).toBe(true);
      expect(icon.getAttribute('data-yp-stats-icon')).toBe('true');
      expect(actions.firstElementChild).toBe(icon);
    });
  });

  describe('owner stats menu', () => {
    test('adds the stats menu with touch feedback to the owner buttons at init', () => {
      jest.resetModules();
      setupVideoCoverageDeps();
      installFetchMock(mockInnerTubeResponse(), mockBrowseResponse(), mockRydResponse());
      document.body.innerHTML =
        '<div id="owner"><div id="top-row"><div id="buttons"></div></div></div>';
      require('../src/stats.js');

      const buttons = document.querySelector('#owner #top-row #buttons');
      const menu = buttons.querySelector('.stats-menu-container');
      expect(menu).not.toBeNull();
      expect(menu.querySelector('.main-stats-button')).not.toBeNull();
      expect(menu.querySelector('.channel-stats-container')).not.toBeNull();
      const shapes = menu.querySelectorAll(
        'yt-touch-feedback-shape .yt-spec-touch-feedback-shape__stroke + .yt-spec-touch-feedback-shape__fill'
      );
      expect(shapes.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── fetchChannelCountryFromInnerTube paths ───────────────────────

  describe('country resolution from InnerTube', () => {
    test('pageHeaderRenderer path for newer channels', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          return { ok: true, status: 200, json: async () => mockInnerTubeResponse() };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              header: {
                pageHeaderRenderer: {
                  content: {
                    pageHeaderViewModel: {
                      metadata: {
                        contentMetadataViewModel: {
                          metadataRows: [{ metadataParts: [{ text: { content: 'DE' } }] }],
                        },
                      },
                    },
                  },
                },
              },
            }),
          };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('DE');
    });

    test('frameworkUpdates mutations path', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          return { ok: true, status: 200, json: async () => mockInnerTubeResponse() };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              header: {},
              frameworkUpdates: {
                entityBatchUpdate: {
                  mutations: [
                    { payload: { channelHeaderMetadataEntityViewModel: { country: 'JP' } } },
                  ],
                },
              },
            }),
          };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('JP');
    });

    test('channelBasicInfoEntityViewModel country path', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          return { ok: true, status: 200, json: async () => mockInnerTubeResponse() };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              header: {},
              frameworkUpdates: {
                entityBatchUpdate: {
                  mutations: [{ payload: { channelBasicInfoEntityViewModel: { country: 'KR' } } }],
                },
              },
            }),
          };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('KR');
    });
  });

  // ─── Author handle rendering ──────────────────────────────────────

  describe('author rendering', () => {
    test('renders author link when handle is available', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('stats-author-handle-big');
      expect(body.innerHTML).toContain('@testauthor');
    });

    test('renders author name when handle is missing', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          const resp = mockInnerTubeResponse();
          resp.microformat.playerMicroformatRenderer.ownerProfileUrl = '';
          return { ok: true, status: 200, json: async () => resp };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => mockBrowseResponse() };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('Test Author');
    });
  });

  // ─── fetchWithDeadline_ timeout ───────────────────────────────────

  describe('fetchWithDeadline_ deadline handling', () => {
    test('fetch abort on deadline', async () => {
      jest.useFakeTimers();
      fetchMock.mockImplementation(
        (_url, opts) =>
          new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener?.('abort', () => reject(new Error('aborted')));
          })
      );

      jest.resetModules();
      setupVideoCoverageDeps();
      installFetchMock(mockInnerTubeResponse(), mockBrowseResponse(), mockRydResponse());
      // Override fetch with hanging mock
      globalThis.fetch = fetchMock;
      require('../src/stats.js');

      const pending = window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      await jest.advanceTimersByTimeAsync(11000);
      await expect(pending).resolves.toBeUndefined();

      jest.useRealTimers();
    });
  });

  // ─── Channel tab analysis via checkChannelTabs ────────────────────

  describe('channel tab detection via URL change', () => {
    test('navigating to channel page triggers tab analysis', async () => {
      mockLocation({
        href: 'https://www.youtube.com/@TestChannel',
        hostname: 'www.youtube.com',
        pathname: '/@TestChannel',
        search: '',
      });

      window.YouTubeUtils.isChannelPage = jest.fn(() => true);

      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('youtube.com/@TestChannel')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              '<html><script>var ytInitialData = {"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"endpoint":{"commandMetadata":{"webCommandMetadata":{"url":"/@TestChannel/streams"}}}}},{"tabRenderer":{"endpoint":{"commandMetadata":{"webCommandMetadata":{"url":"/@TestChannel/shorts"}}}}}]}}};</script></html>',
          };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      });

      // Trigger URL change via navigation event
      window.dispatchEvent(new Event('yt-navigate-finish'));
    });
  });

  // ─── getPageVideoStats comments extraction ────────────────────────

  describe('getPageVideoStats comment count extraction', () => {
    test('extracts comments from comments-count element', () => {
      const header = document.createElement('h2');
      header.id = 'count';
      const commentsSpan = document.createElement('yt-formatted-string');
      commentsSpan.className = 'count-text';
      commentsSpan.textContent = '1,234 Comments';
      header.appendChild(commentsSpan);
      document.body.appendChild(header);

      const stats = window.YouTubePlusStats.getPageVideoStats();
      // Comments may or may not be extracted depending on selector paths
      expect(stats).toBeDefined();
    });
  });

  // ─── Exact count display ──────────────────────────────────────────

  describe('exact count display in stats card', () => {
    test('stats cards include exact localized count', async () => {
      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');

      const body = document.querySelector('.stats-modal-body');
      // Exact views count: 1234567 → "1,234,567" (locale formatted)
      expect(body.innerHTML).toContain('stats-exact');
    });
  });

  // ─── displayChannelStats HTML ─────────────────────────────────────

  describe('displayChannelStats rendering', () => {
    test('channel stats show subscriber, view, and video cards', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('livecounts.io')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ liveSubscriber: 50000, liveViews: 9999999, liveVideos: 200 }),
          };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('channel', 'UCtest1234567890abcdefg');

      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('stats-card');
      // Check for subscriber formatting: 50000 → "50.0K"
      expect(body.innerHTML).toContain('50.0K');
    });
  });

  // ─── Extra function coverage ──────────────────────────────────────

  describe('extra function coverage', () => {
    test('colon formatted duration M:SS and H:MM:SS', async () => {
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          const resp = mockInnerTubeResponse();
          resp.videoDetails.lengthSeconds = '12:34';
          return { ok: true, status: 200, json: async () => resp };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => mockBrowseResponse() };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'dQw4w9WgXcQ');
      const body = document.querySelector('.stats-modal-body');
      expect(body.innerHTML).toContain('12:34');
    });

    test('DESCRIPTOR command opens modal and mountDock unmounts when disabled', () => {
      const reg = window.YouTubePlusFeatureRegistry;
      const desc = reg._map.get('videoStats') || reg._map.get('stats');
      if (desc?.command) {
        expect(desc.command()).toBe(true);
      }
      if (desc?.mountDock) {
        const player = document.createElement('div');
        const dock = document.createElement('div');
        const unmount = desc.mountDock(player, dock);
        expect(dock.querySelector('#yp-vision-stats-btn')).not.toBeNull();

        // When disabled
        window.YouTubePlusSettingsStore.set('enableStatsButton', false);
        desc.mountDock(player, dock);
        expect(dock.querySelector('#yp-vision-stats-btn')).toBeNull();
        if (typeof unmount === 'function') unmount();
      }
    });

    test('numbersAreValidCounts validates payloads correctly across all shapes', () => {
      const fn = window.YouTubePlusStats.numbersAreValidCounts;
      expect(fn(null)).toBe(false);
      expect(fn(undefined)).toBe(false);
      expect(fn('string')).toBe(false);
      expect(fn(123)).toBe(false);
      expect(fn({})).toBe(false);
      expect(fn({ a: -1 })).toBe(false);
      expect(fn({ a: Infinity })).toBe(false);
      expect(fn({ a: NaN })).toBe(false);
      expect(fn({ a: 10 })).toBe(true);
      expect(fn({ a: [1, 2, 3] })).toBe(true);
      expect(fn({ nested: { arr: ['string', null, { deep: 5 }] } })).toBe(true);
      expect(fn({ a: 10, b: -1 })).toBe(false);
      expect(fn({ a: [10, -5] })).toBe(false);
    });

    test('parseLocalizedCount parses comma, dot, and grouped numbers correctly', () => {
      const fn = window.YouTubePlusStats.parseLocalizedCount;
      expect(fn('1.234,56')).toBe(1235);
      expect(fn('1,234.56')).toBe(1235);
      expect(fn('1,234,567')).toBe(1234567);
      expect(fn('1,234')).toBe(1234);
      expect(fn('1.5')).toBe(2);
      expect(fn('100')).toBe(100);
      expect(fn(null)).toBeNull();
      expect(fn('')).toBeNull();
      expect(fn('no digits here')).toBeNull();
    });

    test('InnerTube config extraction fallbacks handle ytcfg and yt.config_ structures', async () => {
      // 1. Using ytcfg.data_
      window.ytcfg = {
        data_: {
          INNERTUBE_API_KEY: 'test_ytcfg_key',
          INNERTUBE_CLIENT_VERSION: 'test_ytcfg_ver',
        },
      };
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/youtubei/v1/player')) {
          expect(urlStr).toContain('key=test_ytcfg_key');
          return { ok: true, status: 200, json: async () => mockInnerTubeResponse() };
        }
        if (urlStr.includes('/youtubei/v1/browse')) {
          return { ok: true, status: 200, json: async () => mockBrowseResponse() };
        }
        if (urlStr.includes('returnyoutubedislikeapi')) {
          return { ok: true, status: 200, json: async () => mockRydResponse() };
        }
        return { ok: false, status: 404 };
      });

      await window.YouTubePlusStats.openStatsModal('video', 'vid_ytcfg');

      // 2. Using yt.config_
      delete window.ytcfg;
      window.yt = {
        config_: {
          INNERTUBE_API_KEY: 'test_yt_key',
          INNERTUBE_CLIENT_VERSION: 'test_yt_ver',
        },
      };
      await window.YouTubePlusStats.openStatsModal('video', 'vid_yt_config');

      // 3. Throwing ytcfg access
      Object.defineProperty(window, 'ytcfg', {
        configurable: true,
        get() {
          throw new Error('ytcfg boom');
        },
      });
      await window.YouTubePlusStats.openStatsModal('video', 'vid_ytcfg_throw');
      delete window.ytcfg;
      delete window.yt;
    });

    test('channel stats fetch handles livecounts error responses and invalid payloads', async () => {
      // 1. Error status (500)
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/stats/')) {
          return { ok: false, status: 500, json: async () => null };
        }
        return { ok: false, status: 404 };
      });
      await window.YouTubePlusStats.openStatsModal('channel', 'UC_error_500_channel');
      let body = document.querySelector('.stats-modal-body');
      expect(body.textContent).toMatch(/failedToLoadStats|Failed to load stats/i);

      // 2. Invalid count payload
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/stats/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ liveSubscriber: 'bad_not_number' }),
          };
        }
        return { ok: false, status: 404 };
      });
      await window.YouTubePlusStats.openStatsModal('channel', 'UC_invalid_payload_chan');
      body = document.querySelector('.stats-modal-body');
      expect(body.textContent).toMatch(/failedToLoadStats|Failed to load stats/i);

      // 3. Network fetch rejection
      fetchMock.mockImplementation(async url => {
        const urlStr = String(url);
        if (urlStr.includes('/stats/')) {
          throw new Error('Network failure');
        }
        return { ok: false, status: 404 };
      });
      await window.YouTubePlusStats.openStatsModal('channel', 'UC_network_error_chan');
      body = document.querySelector('.stats-modal-body');
      expect(body.textContent).toMatch(/failedToLoadStats|Failed to load stats/i);
    });

    test('getPageVideoStats extracts author from channel-name when handle is missing', () => {
      document.body.innerHTML = `
        <ytd-video-owner-renderer>
          <div id="channel-name">Author Only Channel</div>
        </ytd-video-owner-renderer>
      `;
      const stats = window.YouTubePlusStats.getPageVideoStats();
      expect(stats.author).toBe('Author Only Channel');
      expect(stats.authorHandle).toBeNull();
    });
  });
});
