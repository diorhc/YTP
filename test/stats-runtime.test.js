/**
 * @jest-environment jsdom
 */

describe('Stats Module Runtime Registration', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete window.__ytpVideoStatsModuleInit;
    delete window.__ytpChannelStatsModuleInit;
    delete window.YouTubeStats;
    delete window.YouTubePlusStats;

    mockLocation({
      href: 'https://www.youtube.com/watch?v=test1234567a',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=test1234567a',
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        setSafeHTML: (el, html) => {
          if (el) el.innerHTML = html;
        },
        $: (selector, root) => (root || document).querySelector(selector),
        $$: (selector, root) => Array.from((root || document).querySelectorAll(selector)),
        byId: id => document.getElementById(id),
        t: key => key,
        debounce: fn => fn,
        storage: {
          getItem: (k, def = null) => localStorage.getItem(k) ?? def,
          setItem: (k, v) => {
            localStorage.setItem(k, v);
            return true;
          },
          removeItem: k => localStorage.removeItem(k),
        },
        getVideoIdFromLocation: () => {
          const fromQuery = new URLSearchParams(window.location.search || '').get('v');
          if (fromQuery) return fromQuery;
          const path = window.location.pathname || '';
          const shortsMatch = path.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
          if (shortsMatch?.[1]) return shortsMatch[1];
          const liveMatch = path.match(/^\/live\/([a-zA-Z0-9_-]{11})/);
          if (liveMatch?.[1]) return liveMatch[1];
          return null;
        },
        createRetryScheduler: jest.fn(({ check }) => {
          try {
            if (typeof check === 'function') {
              check();
            }
          } catch {
            // Non-critical in unit tests
          }
          return { stop: jest.fn() };
        }),
        createVisibilityAwareInterval: jest.fn((cb, _delay) => {
          try {
            if (typeof cb === 'function') {
              cb();
            }
          } catch {
            // Non-critical in unit tests
          }
          return {
            stop: jest.fn(),
            pause: jest.fn(),
            resume: jest.fn(),
            active: true,
          };
        }),
        cleanupManager: {
          registerListener: jest.fn((target, event, handler, options) => {
            if (target && typeof target.addEventListener === 'function') {
              target.addEventListener(event, handler, options);
            }
            return `${event}-listener`;
          }),
          unregisterListener: jest.fn(),
          register: jest.fn(),
        },
        StyleManager: {
          add: jest.fn(),
          remove: jest.fn(),
        },
        isStudioPage: jest.fn(() => false),
        isChannelPage: jest.fn(url => /\/channel\//.test(url)),
        isSettingsModalOpen: jest.fn(() => false),
        isWatchRoute: jest.fn(() => window.location.pathname === '/watch'),
        isShortsRoute: jest.fn(() => window.location.pathname.startsWith('/shorts')),
        isYouTubeDomain: jest.fn(() => true),
        isChannelRoute: jest.fn(() => false),
        logSuppressed: jest.fn(),
        onDomReady: cb => cb(),
        getRoute: () => {
          const p = window.location.pathname || '/';
          if (p === '/watch') return 'watch';
          if (p.startsWith('/shorts')) return 'shorts';
          if (/^\/@|\/channel\/|\/c\/|\/user\//.test(p)) return 'channel';
          return 'other';
        },
        log: jest.fn(),
        logError: jest.fn(),
        logger: {
          debug: jest.fn(),
        },
        createIsRelevantRoute: (opts = {}) => {
          const {
            watch = false,
            shorts = false,
            channel = false,
            domain = false,
            settingsModal = false,
          } = opts;
          return () => {
            if (settingsModal && window.YouTubeUtils.isSettingsModalOpen?.()) return true;
            if (domain && !window.YouTubeUtils.isYouTubeDomain?.()) return false;
            return (
              (window.YouTubeUtils.isWatchRoute?.() && watch) ||
              (window.YouTubeUtils.isShortsRoute?.() && shorts) ||
              (window.YouTubeUtils.isChannelRoute?.() && channel)
            );
          };
        },
        createWithErrorBoundary: _name => fn => fn,
        registerListenerSafe: (target, event, handler, options) => {
          const cm = window.YouTubeUtils?.cleanupManager;
          if (cm && typeof cm.registerListener === 'function') {
            return cm.registerListener(target, event, handler, options);
          }
          if (target && typeof target.addEventListener === 'function') {
            target.addEventListener(event, handler, options);
          }
          return null;
        },
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
      },
    });

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

    Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });

    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: {
        initGlassDropdown: jest.fn(),
      },
    });

    // Minimal route-aware lifecycle host: starts/stops each definition by its
    // routes and re-syncs on navigation, mirroring the production host.
    const makeLifecycle = () => {
      const handles = [];
      const makeCtx = () => ({
        style: jest.fn(),
        listen: (target, type, fn, opts) => {
          if (target && typeof target.addEventListener === 'function') {
            target.addEventListener(type, fn, opts);
          }
          return jest.fn();
        },
        own: el => el,
        onDispose: jest.fn(),
        scope: () => makeCtx(),
        dispose: jest.fn(),
      });
      return {
        define: jest.fn(def => {
          if (!def || typeof def.start !== 'function') return null;
          const ctx = makeCtx();
          let running = false;
          const matches = () => {
            const route = window.YouTubeUtils.getRoute();
            return (!def.routes?.length || def.routes.includes(route)) && (!def.when || def.when());
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
        _reset: jest.fn(() => {
          for (const handle of handles) handle.sync();
          handles.length = 0;
        }),
        _syncAll: () => {
          for (const handle of handles) handle.sync();
        },
      };
    };
    Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
      configurable: true,
      writable: true,
      value: { FeatureLifecycle: makeLifecycle() },
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
      })),
    });
  });

  test('defines both stats features on the lifecycle with their routes', () => {
    jest.resetModules();
    require('../src/stats.js');

    const define = window.YouTubePlusFeatureRegistry.FeatureLifecycle.define;
    const defs = define.mock.calls.map(call => call[0]);
    const video = defs.find(def => def?.id === 'videoStats');
    const channel = defs.find(def => def?.id === 'channelStats');

    expect(video).toBeDefined();
    expect(video.routes).toEqual(['watch', 'shorts', 'channel']);
    expect(typeof video.start).toBe('function');
    expect(typeof video.stop).toBe('function');
    expect(channel).toBeDefined();
    expect(channel.routes).toEqual(['channel']);
    expect(typeof channel.start).toBe('function');
    expect(typeof channel.stop).toBe('function');
  });

  test('route gate starts video stats on watch and channel stats on channel', () => {
    jest.resetModules();
    // beforeEach mocks /watch: the video feature starts, the channel one does not.
    require('../src/stats.js');

    expect(window.__ytpVideoStatsModuleInit).toBe(true);
    expect(window.__ytpChannelStatsModuleInit).toBeUndefined();

    mockLocation({
      href: 'https://www.youtube.com/channel/UC1234567890',
      hostname: 'www.youtube.com',
      pathname: '/channel/UC1234567890',
      search: '',
    });
    window.YouTubePlusFeatureRegistry.FeatureLifecycle._syncAll();
    expect(window.__ytpChannelStatsModuleInit).toBe(true);
  });

  test('starts both scopes on a channel route and exports the channel API', () => {
    mockLocation({
      href: 'https://www.youtube.com/channel/UC1234567890',
      hostname: 'www.youtube.com',
      pathname: '/channel/UC1234567890',
      search: '',
    });
    jest.resetModules();
    require('../src/stats.js');

    expect(window.__ytpVideoStatsModuleInit).toBe(true);
    expect(window.__ytpChannelStatsModuleInit).toBe(true);
    expect(window.YouTubeStats).toBeDefined();
    expect(typeof window.YouTubeStats.init).toBe('function');
    expect(typeof window.YouTubeStats.cleanup).toBe('function');
  });

  describe('page stat parsing', () => {
    const bootStats = () => {
      jest.resetModules();
      document.body.innerHTML = '';
      document.head.innerHTML = '';
      if (!window.YouTubePlus) window.YouTubePlus = {};
      require('../src/stats.js');
      return window.YouTubeStats;
    };

    test('parseLocalizedCount table: 1.234.567 / 1,2 тыс. / 1.2K / 0', () => {
      const whenRelevant = jest.fn();
      Object.defineProperty(window, 'YouTubeUtils', {
        configurable: true,
        writable: true,
        value: { ...(window.YouTubeUtils || {}), whenRelevant },
      });
      require('../src/stats.js');
      window.YouTubeStats.initVideoStats?.();
      const parse = window.YouTubeStats.parseLocalizedCount;
      expect(typeof parse).toBe('function');

      // From the plan.
      expect(parse('1.234.567')).toBe(1234567);
      expect(parse('1,2 тыс.')).toBe(1200);
      expect(parse('1.2K')).toBe(1200);
      expect(parse('0')).toBe(0);
      // Locale-aware neighbors.
      expect(parse('1,234')).toBe(1234);
      expect(parse('1,2 млн')).toBe(1200000);
      expect(parse('1.2M')).toBe(1200000);
      // Garbage is null, never NaN or 0.
      expect(parse('garbage')).toBeNull();
      expect(parse('')).toBeNull();
      expect(parse(null)).toBeNull();
    });

    test('localized counters: the audit suffix table parses for every locale; 0 stays 0', () => {
      bootStats();
      const parse = window.YouTubeStats.parseLocalizedCount;
      expect(typeof parse).toBe('function');

      // Real YouTube display strings per locale — the suffix must be
      // recognized anywhere in the string, not only at its end.
      const table = [
        ['1,2 тыс.', 1200],
        ['1.234.567 Aufrufe', 1234567],
        ['1,2 Mio. Aufrufe', 1200000],
        ['3,4 M de vues', 3400000],
        ['1.2万次观看', 12000],
        ['12万 回視聴', 120000],
        ['1.2만회', 12000],
        ['1,5 тис.', 1500],
        ['1.5B views', 1500000000],
        ['0', 0],
      ];
      for (const [raw, expected] of table) {
        expect(parse(raw)).toBe(expected);
      }
    });

    test('localized counters: suffix table follows the interface language', () => {
      bootStats();
      const parse = window.YouTubeStats.parseLocalizedCount;
      expect(typeof parse).toBe('function');
      const html = document.documentElement;
      // One representative YouTube display string per supported locale.
      const cases = [
        ['en', '1.2K views', 1200],
        ['en', '1,2 тыс.', 1200],
        ['ru', '1,2 млрд', 1200000000],
        ['uk', '1,5 тис.', 1500],
        ['be', '1,2 тыс.', 1200],
        ['de', '1,2 Mio.', 1200000],
        ['fr', '3,4 M de vues', 3400000],
        ['es', '3,4 M de vistas', 3400000],
        ['pt', '1,2 mil', 1200],
        ['it', '1,2 mln', 1200000],
        ['pl', '1,2 mln', 1200000],
        ['nl', '1,2 mln', 1200000],
        ['ja', '1.2万回視聴', 12000],
        ['ko', '1.2만회', 12000],
        ['ko', '1.2천회', 1200],
        ['zh-CN', '1.2万次观看', 12000],
        ['zh-TW', '1.2萬次觀看', 12000],
        ['tr', '1,2 B', 1200],
        ['tr', '1,2 bin', 1200],
        ['id', '1,2 rb', 1200],
        ['vi', '1,2 N lượt xem', 1200],
        ['hi', '1.2 हज़ार', 1200],
        ['hi', '1.2 लाख', 120000],
        ['hi', '1.2 करोड़', 12000000],
        ['ar', '1.2 ألف', 1200],
        ['bg', '1.2 хил.', 1200],
        ['kk', '1.2 мың', 1200],
        ['ky', '1.2 миң', 1200],
        ['uz', '1.2 ming', 1200],
        ['az', '1.2 min', 1200],
        ['es', '1,2 mil M de vistas', 1200000000],
        ['es', '1,2 mil vistas', 1200],
        ['it', '1,2 Mrd di visualizzazioni', 1200000000],
        ['hi', '1.2 \u0939\u091c\u093c\u093e\u0930', 1200],
        ['hi', '1.2 हजार', 1200],
        ['ar', '١٫٢ ألف', 1200],
        ['ar', '١٬٢٣٤ مشاهدة', 1234],
      ];
      for (const [lang, raw, expected] of cases) {
        html.lang = lang;
        expect(parse(raw)).toBe(expected);
      }
      // Conflicting single letters resolve per locale, not globally.
      html.lang = 'tr';
      expect(parse('1,2 B')).toBe(1200);
      html.lang = 'id';
      expect(parse('1,2 M')).toBe(1200000000);
      html.lang = 'en';
      expect(parse('1.2B views')).toBe(1200000000);
      html.lang = '';
    });

    test('page extraction: player data wins for views; 0 survives as a real zero', () => {
      mockLocation({
        href: 'https://www.youtube.com/watch?v=test1234567',
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '?v=test1234567',
      });
      window.ytInitialPlayerResponse = {
        videoDetails: { videoId: 'test1234567', viewCount: '1234567' },
      };
      require('../src/stats.js');
      window.YouTubeStats.initVideoStats?.();

      // DOM carries a localized display string; the player data is exact.
      const viewsEl = document.createElement('span');
      viewsEl.className = 'view-count';
      viewsEl.textContent = '1,2 тыс. views';
      document.body.appendChild(viewsEl);

      expect(window.YouTubePlusStats.getPageVideoStats().views).toBe(1234567);

      // A real zero is a real zero, never "no data".
      window.ytInitialPlayerResponse = {
        videoDetails: { videoId: 'test1234567', viewCount: '0' },
      };
      expect(window.YouTubePlusStats.getPageVideoStats().views).toBe(0);
      delete window.ytInitialPlayerResponse;
    });

    test('page extraction: live movie_player response beats stale initial data', () => {
      // ytInitialPlayerResponse is frozen at page load; after SPA navigation
      // only the live player response reflects the current video.
      mockLocation({
        href: 'https://www.youtube.com/watch?v=test1234567',
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '?v=test1234567',
      });
      window.ytInitialPlayerResponse = {
        videoDetails: { videoId: 'test1234567', viewCount: '1234567' },
      };
      bootStats();
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.getPlayerResponse = () => ({
        videoDetails: { videoId: 'test1234567', viewCount: '7654321' },
      });
      document.body.appendChild(player);
      const viewsEl = document.createElement('span');
      viewsEl.className = 'view-count';
      viewsEl.textContent = '1,2 тыс. views';
      document.body.appendChild(viewsEl);

      expect(window.YouTubePlusStats.getPageVideoStats().views).toBe(7654321);
      delete window.ytInitialPlayerResponse;
    });

    test('page extraction: a player that throws falls back to the initial data', () => {
      // A cross-context player object can throw on access (Firefox wrappers).
      global.mockLocation({
        href: 'https://www.youtube.com/watch?v=test1234567',
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '?v=test1234567',
      });
      window.ytInitialPlayerResponse = {
        videoDetails: { videoId: 'test1234567', viewCount: '1234567' },
      };
      bootStats();
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.getPlayerResponse = () => {
        throw new Error('Permission denied to access object');
      };
      document.body.appendChild(player);

      expect(window.YouTubePlusStats.getPageVideoStats().views).toBe(1234567);
      delete window.ytInitialPlayerResponse;
    });

    test('page extraction: a stale response for another video is never used', () => {
      // After an SPA transition the player response can still describe the
      // PREVIOUS video; its viewCount must not leak into the current card.
      window.ytInitialPlayerResponse = {
        videoDetails: { videoId: 'stalevideo1', viewCount: '1234567' },
      };
      bootStats();
      history.pushState({}, '', '/watch?v=freshvideo2');
      const viewsEl = document.createElement('yt-view-count-renderer');
      viewsEl.textContent = '9,9 тыс. views';
      document.body.appendChild(viewsEl);

      expect(window.YouTubePlusStats.getPageVideoStats().views).toBe(9900);
      delete window.ytInitialPlayerResponse;
    });

    test('page extraction: like button aria-label carries the exact count', () => {
      bootStats();
      const labels = [
        'like this video along with 12,345 other people',
        'like this video along with 12 345 other people',
        'like this video along with 12.345 other people',
        'like this video along with 12\u00a0345 other people',
        'like this video along with 12\u202f345 other people',
      ];
      for (const label of labels) {
        const wrap = document.createElement('like-button-view-model');
        const btn = document.createElement('button');
        btn.setAttribute('aria-label', label);
        const text = document.createElement('yt-formatted-string');
        text.textContent = '12K';
        btn.appendChild(text);
        wrap.appendChild(btn);
        document.body.appendChild(wrap);

        expect(window.YouTubePlusStats.getPageVideoStats().likes).toBe(12345);
        wrap.remove();
      }
    });
  });

  test('without the design system the stats styles are not registered', () => {
    delete window.YouTubePlusDesignSystem;
    jest.resetModules();
    require('../src/stats.js');
    expect(window.YouTubeUtils.StyleManager.add).not.toHaveBeenCalledWith(
      'yp-video-stats-styles',
      expect.anything()
    );
  });

  test('reacts to settings/language/navigation events after init', () => {
    window.YouTubePlusDesignSystem = {
      getStyle: id => (id === 'yp-video-stats-styles' ? '.videoStats{width:36px}' : ''),
    };

    jest.resetModules();
    require('../src/stats.js');
    document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));

    const handles = window.YouTubePlusFeatureRegistry.FeatureLifecycle.define.mock.results
      .map(result => result.value)
      .filter(Boolean);
    const videoHandle = handles.find(handle => handle.id === 'videoStats');
    expect(videoHandle).toBeDefined();
    // The video feature acquires its base CSS through its context on start.
    expect(videoHandle.ctx.style).toHaveBeenCalledWith(
      'yp-video-stats-styles',
      '.videoStats{width:36px}'
    );

    const experimentalSection = document.createElement('div');
    experimentalSection.className = 'yp-settings-section';
    experimentalSection.setAttribute('data-section', 'experimental');
    document.body.appendChild(experimentalSection);

    const navItem = document.createElement('button');
    navItem.className = 'yp-settings-nav-item';
    navItem.setAttribute('data-section', 'experimental');
    document.body.appendChild(navItem);

    document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
    document.dispatchEvent(new Event('youtube-plus-language-changed'));
    navItem.click();
    window.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('yt-page-data-updated'));

    expect(window.YouTubeUtils.cleanupManager.registerListener).toHaveBeenCalled();
    // The base stats bundle goes in under its own id; the small
    // `yp-stats-styles` bundle keeps its own rules.
    expect(window.YouTubeUtils.StyleManager.add).not.toHaveBeenCalledWith(
      'yp-stats-styles',
      expect.anything()
    );
    delete window.YouTubePlusDesignSystem;
  });

  test('channel stats lifecycle can create overlay and cleanup', () => {
    mockLocation({
      href: 'https://www.youtube.com/channel/UC1234567890ABCDEFGHIJKL',
      hostname: 'www.youtube.com',
      pathname: '/channel/UC1234567890ABCDEFGHIJKL',
      search: '',
    });

    const banner = document.createElement('div');
    banner.id = 'page-header-banner-sizer';
    banner.getBoundingClientRect = jest.fn(() => ({
      width: 900,
      height: 220,
      top: 0,
      left: 0,
      right: 900,
      bottom: 220,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    document.body.appendChild(banner);

    jest.resetModules();
    require('../src/stats.js');
    window.dispatchEvent(new Event('yt-navigate-finish'));
    window.dispatchEvent(new Event('yp:nav-refresh'));

    expect(typeof window.YouTubeStats?.cleanup).toBe('function');
    expect(() => window.YouTubeStats.cleanup()).not.toThrow();
  });
});
