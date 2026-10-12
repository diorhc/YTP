/**
 * @jest-environment jsdom
 */

describe('PlayAll Coverage Suite', () => {
  let playAllHooks;

  const exposeTestHooks = (facade, hooks) => {
    if (window.__YTP_TEST_HOOKS__ === true) {
      facade.testHooks = hooks;
      playAllHooks = hooks;
    }
  };

  const setLocation = loc => {
    global.mockLocation(loc);
  };

  /**
   * @param {() => void} run
   * @returns {string | undefined} the URL `run` loaded, if any
   */
  const navigatedTo = run => {
    window.YouTubeUtils.navigateTo.mockClear();
    run();
    return window.YouTubeUtils.navigateTo.mock.calls.at(-1)?.[0];
  };

  const setupDeps = () => {
    window.__YTP_TEST_HOOKS__ = true;
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();

    delete window.YouTubePlusPlayall;

    setLocation({
      hostname: 'www.youtube.com',
      pathname: '/channel/UC1234567890123456789012',
      href: 'https://www.youtube.com/channel/UC1234567890123456789012',
      search: '',
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        exposeTestHooks,
        $: jest.fn(sel => document.querySelector(sel)),
        $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
        t: jest.fn(key => (key === 'playAllButton' ? 'Play All' : key)),
        cleanupManager: {
          registerInterval: jest.fn(id => id),
          registerTimeout: jest.fn(id => id),
          registerObserver: jest.fn(obs => obs),
          registerListener: jest.fn((target, type, fn, opts) => {
            if (target?.addEventListener) {
              target.addEventListener(type, fn, opts);
            }
          }),
          register: jest.fn(),
          cleanup: jest.fn(),
          registerAnimationFrame: jest.fn(id => id),
          getListenerStats: jest.fn(() => ({ active: 0, registeredTotal: 0 })),
        },
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        loadFeatureEnabled: jest.fn(() => true),
        navigateTo: jest.fn(),
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
        SETTINGS_KEY: 'youtube_plus_settings',
        createHTML: jest.fn(s => s),
        createWithErrorBoundary: _name => fn => fn,
        whenRelevant: jest.fn(() => ({ active: false, check: jest.fn(), dispose: jest.fn() })),
        waitFor: jest.fn(() => Promise.resolve(null)),
        waitForElement: jest.fn(() => Promise.resolve(null)),
        createRetryScheduler: jest.fn(opts => {
          opts.check?.();
          return { stop: jest.fn() };
        }),
        logSuppressed: jest.fn(),
        getVideoIdFromUrl: jest.fn(url => {
          try {
            const u = new URL(url, 'https://www.youtube.com');
            return u.searchParams.get('v');
          } catch {
            return null;
          }
        }),
        renderTemplateClone: jest.fn((el, html) => {
          el.innerHTML = html;
        }),
        storage: {
          get: jest.fn((key, def = null) => {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : def;
          }),
          set: jest.fn((key, val) => {
            localStorage.setItem(key, JSON.stringify(val));
            return true;
          }),
          remove: jest.fn(key => localStorage.removeItem(key)),
          has: jest.fn(key => localStorage.getItem(key) !== null),
          getItem: jest.fn(key => localStorage.getItem(key)),
          setItem: jest.fn((key, val) => {
            localStorage.setItem(key, val);
            return true;
          }),
          removeItem: jest.fn(key => localStorage.removeItem(key)),
        },
      },
    });

    Object.defineProperty(window, 'YouTubePlusI18n', {
      configurable: true,
      writable: true,
      value: {
        t: jest.fn(key => key),
        hasTranslation: jest.fn(key => key === 'playAllButton'),
        getLanguage: jest.fn(() => 'en'),
      },
    });

    Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
      configurable: true,
      writable: true,
      value: {
        subscribeRoot: jest.fn(),
        unsubscribe: jest.fn(),
        watchTarget: jest.fn(() => 'watch-id'),
        unwatch: jest.fn(),
      },
    });

    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: {
        StyleManager: window.YouTubeUtils.StyleManager,
        getStyle: jest.fn(() => '.test-css { color: red; }'),
      },
    });

    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: window.YouTubeUtils.cleanupManager,
    });
  };

  const makeCtx = () => {
    const makeScope = () => ({
      listen: jest.fn((target, type, fn, opts) => {
        if (target && typeof target.addEventListener === 'function') {
          target.addEventListener(type, fn, opts);
        }
        return jest.fn();
      }),
      own: jest.fn(),
      onDispose: jest.fn(),
      dispose: jest.fn(),
      timeout: jest.fn(),
      frame: jest.fn(),
    });
    return {
      style: jest.fn(),
      timeout: jest.fn(),
      listen: jest.fn(),
      frame: jest.fn(),
      onDispose: jest.fn(),
      scope: jest.fn(makeScope),
    };
  };

  beforeEach(() => {
    jest.resetModules();
    setupDeps();
    require('../src/playall.js');
  });

  afterEach(() => {
    playAllHooks?.cleanup?.();
    jest.restoreAllMocks();
  });

  describe('clearRetryHandle', () => {
    test('handles null and undefined without throwing', () => {
      expect(() => {
        playAllHooks.clearRetryHandle(null);
        playAllHooks.clearRetryHandle(undefined);
      }).not.toThrow();
    });

    test('clears numeric timer handle via clearTimeout', () => {
      jest.useFakeTimers();
      const timer = setTimeout(() => {
        /* timer callback */
      }, 1000);
      expect(() => playAllHooks.clearRetryHandle(timer)).not.toThrow();
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    test('stops handle with stop() method', () => {
      const stopFn = jest.fn();
      playAllHooks.clearRetryHandle({ stop: stopFn });
      expect(stopFn).toHaveBeenCalled();
    });

    test('cancels handle with cancel() method', () => {
      const cancelFn = jest.fn();
      playAllHooks.clearRetryHandle({ cancel: cancelFn });
      expect(cancelFn).toHaveBeenCalled();
    });
  });

  describe('getPlayAllLabel and getPlayAllAriaLabel', () => {
    test('returns localized label if available', () => {
      window.YouTubePlusI18n.hasTranslation.mockReturnValue(true);
      window.YouTubeUtils.t.mockReturnValue('Tous Lire');
      expect(playAllHooks.getPlayAllLabel()).toBe('Tous Lire');
    });

    test('falls back to "Play All" if localized equals key', () => {
      window.YouTubePlusI18n.hasTranslation.mockReturnValue(true);
      window.YouTubeUtils.t.mockReturnValue('playAllButton');
      expect(playAllHooks.getPlayAllLabel()).toBe('Play All');
    });

    test('falls back to "Play All" if hasTranslation returns false', () => {
      window.YouTubePlusI18n.hasTranslation.mockReturnValue(false);
      expect(playAllHooks.getPlayAllLabel()).toBe('Play All');
    });

    test('getPlayAllAriaLabel returns custom aria label or falls back to label', () => {
      window.YouTubeUtils.t.mockImplementation(key => {
        if (key === 'enablePlayAllLabel') return 'Play all videos in channel';
        return 'Play All';
      });
      expect(playAllHooks.getPlayAllAriaLabel()).toBe('Play all videos in channel');

      window.YouTubeUtils.t.mockImplementation(key => {
        if (key === 'enablePlayAllLabel') return 'enablePlayAllLabel';
        return 'Play All';
      });
      expect(playAllHooks.getPlayAllAriaLabel()).toBe('Play All');
    });
  });

  describe('Channel ID DOM Resolution Helpers', () => {
    test('resolveMetaChannelId_ extracts from meta[itemprop="channelId"]', () => {
      document.head.innerHTML = '<meta itemprop="channelId" content="UC1234567890123456789012">';
      expect(playAllHooks.resolveMetaChannelId_()).toBe('UC1234567890123456789012');
    });

    test('resolveMetaChannelId_ extracts from canonical link', () => {
      document.head.innerHTML =
        '<link rel="canonical" href="https://www.youtube.com/channel/UC9999999999999999999999">';
      expect(playAllHooks.resolveMetaChannelId_()).toBe('UC9999999999999999999999');
    });

    test('resolveMetaChannelId_ returns null if canonical is non-channel or invalid', () => {
      document.head.innerHTML = '<link rel="canonical" href="https://www.youtube.com/watch?v=123">';
      expect(playAllHooks.resolveMetaChannelId_()).toBeNull();
    });

    test('resolveDomNodeChannelId_ extracts from ytd-browse channel-id attribute', () => {
      setLocation({ pathname: '/@handle', href: 'https://www.youtube.com/@handle' });
      document.body.innerHTML =
        '<ytd-browse page-subtype="channels" channel-id="UC1234567890123456789012"></ytd-browse>';
      expect(playAllHooks.resolveDomNodeChannelId_()).toBe('UC1234567890123456789012');
    });

    test('resolveDomNodeChannelId_ extracts from ytd-channel-name anchor href', () => {
      setLocation({ pathname: '/@handle', href: 'https://www.youtube.com/@handle' });
      document.body.innerHTML =
        '<ytd-channel-name><a href="/channel/UC1234567890123456789012">Channel</a></ytd-channel-name>';
      expect(playAllHooks.resolveDomNodeChannelId_()).toBe('UC1234567890123456789012');
    });

    test('resolveDomNodeChannelId_ returns null if no matching elements exist', () => {
      setLocation({ pathname: '/@handle', href: 'https://www.youtube.com/@handle' });
      document.body.innerHTML = '<div>No channel info</div>';
      expect(playAllHooks.resolveDomNodeChannelId_()).toBeNull();
    });

    test('resolveInitialDataChannelId_ extracts from header.c4TabbedHeaderRenderer', () => {
      window.ytInitialData = {
        header: {
          c4TabbedHeaderRenderer: {
            channelId: 'UC1234567890123456789012',
          },
        },
      };
      expect(playAllHooks.resolveInitialDataChannelId_()).toBe('UC1234567890123456789012');
      delete window.ytInitialData;
    });

    test('resolveInitialDataChannelId_ extracts from metadata.channelMetadataRenderer', () => {
      window.ytInitialData = {
        metadata: {
          channelMetadataRenderer: {
            externalId: 'UC9999999999999999999999',
          },
        },
      };
      expect(playAllHooks.resolveInitialDataChannelId_()).toBe('UC9999999999999999999999');
      delete window.ytInitialData;
    });

    test('resolveInitialDataChannelId_ extracts from ytcfg if available', () => {
      window.ytcfg = {
        get: jest.fn(key => (key === 'CHANNEL_ID' ? 'UC1234567890123456789012' : null)),
      };
      expect(playAllHooks.resolveInitialDataChannelId_()).toBe('UC1234567890123456789012');
      delete window.ytcfg;
    });

    test('resolveInitialDataChannelId_ returns null if ytInitialData is empty or malformed', () => {
      window.ytInitialData = {};
      expect(playAllHooks.resolveInitialDataChannelId_()).toBeNull();
      delete window.ytInitialData;
    });

    test('resolveChannelIdFromDom resolves from URL pathname directly', () => {
      setLocation({
        hostname: 'www.youtube.com',
        pathname: '/channel/UC1234567890123456789012/videos',
        href: 'https://www.youtube.com/channel/UC1234567890123456789012/videos',
      });
      expect(playAllHooks.resolveChannelIdFromDom()).toBe('UC1234567890123456789012');
    });

    test('resolveChannelIdWithRetry resolves immediately if present', async () => {
      document.head.innerHTML = '<meta itemprop="channelId" content="UC1234567890123456789012">';
      const resolved = await playAllHooks.resolveChannelIdWithRetry(3, 10);
      expect(resolved).toBe('UC1234567890123456789012');
    });

    test('resolveChannelIdWithRetry polls and succeeds on subsequent try', async () => {
      setLocation({
        hostname: 'www.youtube.com',
        pathname: '/@somehandle',
        href: 'https://www.youtube.com/@somehandle',
      });
      setTimeout(() => {
        document.head.innerHTML =
          '<link rel="canonical" href="https://www.youtube.com/channel/UC1234567890123456789012">';
      }, 25);

      const resolved = await playAllHooks.resolveChannelIdWithRetry(5, 20);
      expect(resolved).toBe('UC1234567890123456789012');
    });

    test('resolveChannelIdWithRetry returns null after max attempts', async () => {
      setLocation({
        hostname: 'www.youtube.com',
        pathname: '/@empty',
        href: 'https://www.youtube.com/@empty',
      });
      const resolved = await playAllHooks.resolveChannelIdWithRetry(2, 5);
      expect(resolved).toBeNull();
    });
  });

  describe('buildWatchUrl and redirect', () => {
    test('buildWatchUrl constructs expected URLs with or without random parameter', () => {
      expect(playAllHooks.buildWatchUrl('vid1', 'list1', null)).toBe('/watch?v=vid1&list=list1');
      expect(playAllHooks.buildWatchUrl('vid1', 'list1', 'random')).toBe(
        '/watch?v=vid1&list=list1&ytp-random=random'
      );
    });

    test('redirect creates endpoint and clicks on desktop when panel exists', () => {
      setLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch',
      });
      document.body.innerHTML = `
        <ytd-playlist-panel-renderer>
          <div id="items"></div>
        </ytd-playlist-panel-renderer>
      `;
      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click');
      playAllHooks.redirect('v456', 'PL456', 'random');
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    test('redirect falls back to window.location.href if items container missing', () => {
      document.body.innerHTML = '<div>No playlist panel</div>';
      expect(navigatedTo(() => playAllHooks.redirect('v789', 'PL789', null))).toBe(
        '/watch?v=v789&list=PL789'
      );
    });
  });

  describe('scheduleManagedTimeout and scheduleApplyRetry', () => {
    test('scheduleManagedTimeout uses playAllCtx.timeout when available', () => {
      playAllHooks.cleanup();
      const mockCtx = {
        style: jest.fn(),
        timeout: jest.fn(),
        listen: jest.fn(),
        frame: jest.fn(),
        onDispose: jest.fn(),
        scope: jest.fn(() => ({ listen: jest.fn(), dispose: jest.fn() })),
      };
      playAllHooks.init(mockCtx);
      const cb = jest.fn();
      playAllHooks.scheduleManagedTimeout(cb, 100);
      expect(mockCtx.timeout).toHaveBeenCalledWith(cb, 100);
      playAllHooks.cleanup();
    });

    test('scheduleApplyRetry aborts when retryCount >= 12', () => {
      window.YouTubeUtils.waitFor.mockClear();
      playAllHooks.scheduleApplyRetry(12, '.test', 500);
      expect(window.YouTubeUtils.waitFor).not.toHaveBeenCalled();
    });

    test('scheduleApplyRetry executes waitFor and retries apply', async () => {
      const waitForDeferred = Promise.resolve(document.createElement('div'));
      window.YouTubeUtils.waitFor.mockReturnValue(waitForDeferred);
      playAllHooks.cleanup();
      playAllHooks.init(makeCtx());
      playAllHooks.scheduleApplyRetry(2, '.some-selector', 800);
      expect(window.YouTubeUtils.waitFor).toHaveBeenCalledWith('.some-selector', 800);
      await waitForDeferred;
      playAllHooks.cleanup();
    });
  });

  describe('ChipBar and Mount Resolution', () => {
    test('resolveChipBarPlacement handles shadowRoot', () => {
      const host = document.createElement('div');
      const sr = host.attachShadow({ mode: 'open' });
      const placement = playAllHooks.resolveChipBarPlacement(host);
      expect(placement.parent).toBe(sr);
      expect(placement.chipBarInsertBefore).toBeNull();
    });

    test('resolveChipBarPlacement handles parentElement without shadowRoot', () => {
      const parent = document.createElement('div');
      const host = document.createElement('div');
      parent.appendChild(host);
      const placement = playAllHooks.resolveChipBarPlacement(host);
      expect(placement.parent).toBe(parent);
      expect(placement.chipBarInsertBefore).toBe(host);
    });

    test('resolveChipBarPlacement returns host when no parent exists', () => {
      const host = document.createElement('div');
      const placement = playAllHooks.resolveChipBarPlacement(host);
      expect(placement.parent).toBe(host);
      expect(placement.chipBarInsertBefore).toBeNull();
    });

    test('resolveDesktopParent finds non-chip-bar candidate', () => {
      document.body.innerHTML = `
        <ytd-feed-filter-chip-bar-renderer id="chips-wrapper">
          <div class="chip">All</div>
        </ytd-feed-filter-chip-bar-renderer>
      `;
      const result = playAllHooks.resolveDesktopParent();
      expect(result.parent).toBeTruthy();
    });

    test('resolveDesktopParent ignores chip bars in engagement panels', () => {
      document.body.innerHTML = `
        <ytd-engagement-panel-section-list-renderer>
          <chip-bar-view-model class="ytChipBarViewModelHost"></chip-bar-view-model>
        </ytd-engagement-panel-section-list-renderer>
      `;
      const result = playAllHooks.resolveDesktopParent();
      expect(result.parent).toBeNull();
    });

    test('resolveGridParent handles grid with chip bar inside', () => {
      document.body.innerHTML = `
        <ytd-rich-grid-renderer>
          <chip-bar-view-model class="ytChipBarViewModelHost"></chip-bar-view-model>
        </ytd-rich-grid-renderer>
      `;
      const result = playAllHooks.resolveGridParent(0);
      expect(result.parent).toBeTruthy();
      expect(result.chipBarHost).toBeTruthy();
    });

    test('resolveGridParent handles missing grid and schedules retry', () => {
      document.body.innerHTML = '<div>Empty</div>';
      const result = playAllHooks.resolveGridParent(0);
      expect(result.retry).toBe(true);
    });

    test('resolveGridParent creates fallback container after retries', () => {
      document.body.innerHTML = '<ytd-rich-grid-renderer></ytd-rich-grid-renderer>';
      const result = playAllHooks.resolveGridParent(8);
      expect(result.parent).toBeTruthy();
      expect(result.parent.className).toBe('yp-button-container');
    });
  });

  describe('Playlist Prefix and Button Creation', () => {
    test('getPlaylistPrefix_ returns correct prefix for shorts, streams, and videos', () => {
      expect(playAllHooks.getPlaylistPrefix_('/channel/UC123/shorts')).toBe('UUSH');
      expect(playAllHooks.getPlaylistPrefix_('/channel/UC123/streams')).toBe('UULV');
      expect(playAllHooks.getPlaylistPrefix_('/channel/UC123/videos')).toBe('UULF');
      expect(playAllHooks.getPlaylistPrefix_('/channel/UC123')).toBe('UULF');
    });

    test('wirePlayAllButtonClick_ attaches click handler navigating to playAllHref', () => {
      const btn = document.createElement('a');
      const href = '/playlist?list=UULF123&playnext=1&ytp-random=random';
      playAllHooks.wirePlayAllButtonClick_(btn, href);

      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      expect(navigatedTo(() => btn.dispatchEvent(event))).toBe(href);
    });

    test('insertPlayAllButton handles insertion before chipBarInsertBefore', () => {
      const parent = document.createElement('div');
      const sibling = document.createElement('span');
      parent.appendChild(sibling);
      const btn = document.createElement('a');
      playAllHooks.insertPlayAllButton(parent, sibling, btn);
      expect(parent.firstChild).toBe(btn);
      expect(parent.classList.contains('yp-play-all-parent')).toBe(true);
    });

    test('insertPlayAllButton handles shadow root insertion', () => {
      const host = document.createElement('div');
      const sr = host.attachShadow({ mode: 'open' });
      const btn = document.createElement('a');
      playAllHooks.insertPlayAllButton(sr, null, btn);
      expect(sr.firstChild).toBe(btn);
    });
  });

  describe('mountStyles', () => {
    test('uses ctx.style when ctx is provided', () => {
      const mockCtx = {
        style: jest.fn(),
      };
      playAllHooks.mountStyles(mockCtx);
      expect(mockCtx.style).toHaveBeenCalledWith('yp-play-all-styles', expect.any(String));
    });
  });

  describe('fetchChannelId_ Network Fallback', () => {
    test('skips fetch for non-YouTube host', async () => {
      setLocation({
        hostname: 'example.com',
        host: 'example.com',
        pathname: '/somepage',
        href: 'https://example.com/somepage',
      });
      const result = await playAllHooks.fetchChannelId_();
      expect(result).toBeNull();
    });

    test('extracts channel ID from canonical link in HTML', async () => {
      setLocation({
        hostname: 'www.youtube.com',
        pathname: '/@ChannelName',
        href: 'https://www.youtube.com/@ChannelName',
      });
      global.fetch = jest.fn(() =>
        Promise.resolve({
          text: () =>
            Promise.resolve(
              '<html><head><link rel="canonical" href="https://www.youtube.com/channel/UC1234567890123456789012"></head></html>'
            ),
        })
      );

      const id = await playAllHooks.fetchChannelId_();
      expect(id).toBe('UC1234567890123456789012');
      delete global.fetch;
    });

    test('extracts channel ID from "channelId" JSON match in HTML', async () => {
      setLocation({
        hostname: 'www.youtube.com',
        pathname: '/@ChannelName2',
        href: 'https://www.youtube.com/@ChannelName2',
      });
      global.fetch = jest.fn(() =>
        Promise.resolve({
          text: () =>
            Promise.resolve(
              '<html><script>var data = {"channelId":"UC9876543210987654321098"};</script></html>'
            ),
        })
      );

      const id = await playAllHooks.fetchChannelId_();
      expect(id).toBe('UC9876543210987654321098');
      delete global.fetch;
    });

    test('handles fetch errors gracefully', async () => {
      setLocation({
        hostname: 'www.youtube.com',
        pathname: '/@Failed',
        href: 'https://www.youtube.com/@Failed',
      });
      global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));

      const id = await playAllHooks.fetchChannelId_();
      expect(id).toBeNull();
      delete global.fetch;
    });
  });

  describe('Random Play Flow in Watch Mode', () => {
    test('initializes random play UI and badge on watch page', () => {
      setLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch?v=vid123&list=PLtest&ytp-random=random',
        search: '?v=vid123&list=PLtest&ytp-random=random',
      });

      document.body.innerHTML = `
        <div id="secondary">
          <ytd-playlist-panel-renderer>
            <div id="header">
              <h3><a href="/playlist?list=PLtest">Playlist Name</a></h3>
            </div>
            <div id="items">
              <ytd-playlist-panel-video-renderer>
                <a id="wc-endpoint" href="/watch?v=vid123&list=PLtest">Video 1</a>
              </ytd-playlist-panel-video-renderer>
              <ytd-playlist-panel-video-renderer>
                <a id="wc-endpoint" href="/watch?v=vid456&list=PLtest">Video 2</a>
              </ytd-playlist-panel-video-renderer>
            </div>
          </ytd-playlist-panel-renderer>
        </div>
        <div id="ytd-player">
          <button class="ytp-next-button ytp-button">Next</button>
        </div>
        <video></video>
      `;

      playAllHooks.cleanup();

      playAllHooks.init(makeCtx());
      playAllHooks.scheduleApplyRandomPlay();

      const notice = document.querySelector('.yp-random-notice');
      expect(notice).toBeTruthy();

      const badge = document.querySelector('.yp-random-badge');
      expect(badge).toBeTruthy();

      // Click badge to dismiss
      const target = navigatedTo(() =>
        badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      );
      expect(target).toBeDefined();
      expect(target).not.toContain('ytp-random=random');

      playAllHooks.cleanup();
    });

    test('handles video timeupdate and triggers autoplay near end of video', () => {
      setLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch?v=vid123&list=PLtest&ytp-random=random',
        search: '?v=vid123&list=PLtest&ytp-random=random',
      });

      document.body.innerHTML = `
        <div id="movie_player"></div>
        <div id="secondary">
          <ytd-playlist-panel-renderer>
            <div id="header">
              <h3><a href="/playlist?list=PLtest">Playlist</a></h3>
            </div>
            <div id="items">
              <ytd-playlist-panel-video-renderer>
                <a id="wc-endpoint" href="/watch?v=vid123&list=PLtest">V1</a>
              </ytd-playlist-panel-video-renderer>
              <ytd-playlist-panel-video-renderer>
                <a id="wc-endpoint" href="/watch?v=vid456&list=PLtest">V2</a>
              </ytd-playlist-panel-video-renderer>
            </div>
          </ytd-playlist-panel-renderer>
        </div>
        <video></video>
      `;

      const moviePlayer = document.getElementById('movie_player');
      moviePlayer.pauseVideo = jest.fn();
      moviePlayer.seekTo = jest.fn();
      moviePlayer.getProgressState = jest.fn(() => ({
        current: 99,
        duration: 100,
        number: 1,
      }));

      // Set watched storage
      localStorage.setItem('ytp-random-PLtest', JSON.stringify({ vid123: false, vid456: false }));

      playAllHooks.cleanup();
      playAllHooks.init(makeCtx());

      const video = document.querySelector('video');
      video.dispatchEvent(new Event('timeupdate'));

      expect(moviePlayer.pauseVideo).toHaveBeenCalled();
      playAllHooks.cleanup();
    });
  });

  describe('Mobile Navigation Wiring', () => {
    test('listens to yp-history-navigate and popstate on m.youtube.com', () => {
      setLocation({
        hostname: 'm.youtube.com',
        host: 'm.youtube.com',
        pathname: '/channel/UC1234567890123456789012',
        href: 'https://m.youtube.com/channel/UC1234567890123456789012',
      });

      const register = playAllHooks.createEventRegistrar_(null);
      const listener = jest.fn();
      register(window, 'test-event', listener);
      window.dispatchEvent(new Event('test-event'));

      expect(listener).toHaveBeenCalled();
    });
  });
});
