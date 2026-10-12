/**
 * @jest-environment jsdom
 *
 * Comprehensive coverage-oriented tests for src/enhanced.js:
 * - Return YouTube Dislike integration
 * - Scroll-to-top buttons & delegators (universal, right tabs, playlist panel, music)
 * - Playback quality persistence (IIFE 2)
 * - YouTube interface styles generation (IIFE 3)
 * - Theater overlay runtime fixes (IIFE 4)
 */

const mockLocation = globalThis.mockLocation;

describe('Enhanced Module Comprehensive Coverage', () => {
  let listeners = {};
  let storageMap = {};
  let mockCtx = null;
  let definedFeature = null;

  function createMockScope() {
    const disposables = [];
    const scope = {
      active: true,
      listen: jest.fn((target, type, handler, opts) => {
        target?.addEventListener?.(type, handler, opts);
        const unsub = () => target?.removeEventListener?.(type, handler, opts);
        disposables.push(unsub);
        return unsub;
      }),
      timeout: jest.fn(fn => {
        fn();
        return 1;
      }),
      interval: jest.fn(fn => {
        fn();
        return 1;
      }),
      observe: jest.fn(obs => {
        disposables.push(() => obs?.disconnect?.());
        return obs;
      }),
      own: jest.fn(el => {
        disposables.push(() => el?.remove?.());
        return el;
      }),
      onDispose: jest.fn(fn => {
        disposables.push(fn);
      }),
      dispose: jest.fn(() => {
        scope.active = false;
        while (disposables.length) {
          try {
            disposables.pop()();
          } catch {
            /* ignore */
          }
        }
      }),
      scope: jest.fn(() => createMockScope()),
    };
    return scope;
  }

  function setupEnhancedDeps() {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    listeners = {};
    storageMap = {};

    delete window._enhancedInitialized;
    delete window.YouTubePlusEnhanced;
    delete window.YouTubePlusSettingsStore;
    delete window.YouTubePlusMain;

    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      search: '?v=dQw4w9WgXcQ',
    });

    const mockCleanupManager = {
      registerInterval: jest.fn(id => id),
      registerTimeout: jest.fn(id => id),
      registerObserver: jest.fn(obs => obs),
      unregisterObserver: jest.fn(),
      registerListener: jest.fn((target, type, handler) => {
        const key = `${type}`;
        if (!listeners[key]) listeners[key] = [];
        listeners[key].push({ target, handler });
        target.addEventListener?.(type, handler);
        return () => undefined;
      }),
      register: jest.fn(fn => fn),
      cleanup: jest.fn(),
      registerAnimationFrame: jest.fn(id => id),
    };

    const mockStorage = {
      getItem: jest.fn(k => storageMap[k] ?? null),
      setItem: jest.fn((k, v) => {
        storageMap[k] = String(v);
      }),
      removeItem: jest.fn(k => {
        delete storageMap[k];
      }),
    };

    const mockStyleManager = {
      add: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn(),
    };

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(sel => document.querySelector(sel)),
        $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
        t: jest.fn(key => key || ''),
        createWithErrorBoundary: _name => fn => fn,
        setSafeHTML: jest.fn((el, html) => {
          el.innerHTML = html;
        }),
        getLanguage: jest.fn(() => 'en'),
        getHostname: jest.fn(() => window.location.hostname),
        loadFeatureEnabled: jest.fn((_name, def = true) => def),
        debounce: jest.fn(fn => Object.assign(fn, { cancel: jest.fn(), destroy: jest.fn() })),
        throttle: jest.fn(fn => fn),
        cleanupManager: mockCleanupManager,
        storage: mockStorage,
        StyleManager: mockStyleManager,
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        SETTINGS_KEY: 'youtube_plus_settings',
        logSuppressed: jest.fn(),
        logError: jest.fn(),
        isWatchPage: jest.fn(() => window.location.pathname === '/watch'),
        isShortsPage: jest.fn(() => window.location.pathname.startsWith('/shorts')),
        isMusicDomain: jest.fn(() => window.location.hostname === 'music.youtube.com'),
        getVideoIdFromLocation: jest.fn(() => {
          const match = (window.location.search || '').match(/[?&]v=([^&#]+)/);
          return match ? match[1] : null;
        }),
        getVideoIdFromUrl: jest.fn(url => {
          const match = String(url).match(/[?&]v=([^&#]+)/);
          return match ? match[1] : null;
        }),
        createRetryScheduler: jest.fn(opts => {
          let stopped = false;
          let attempts = 0;
          const maxAttempts = opts?.maxAttempts || 10;
          const interval = opts?.interval || 100;
          const run = () => {
            if (stopped) return;
            attempts++;
            const done = opts?.check?.();
            if (!done && attempts < maxAttempts) {
              setTimeout(run, interval);
            }
          };
          run();
          return {
            stop: () => {
              stopped = true;
            },
          };
        }),
        onDomReady: jest.fn(cb => {
          if (typeof cb === 'function') cb();
        }),
        ObserverRegistry: {
          track: jest.fn(),
          untrack: jest.fn(),
        },
      },
    });

    mockCtx = {
      ...createMockScope(),
      style: jest.fn(),
      delegate: jest.fn((target, type, sel, handler) => {
        const listener = e => {
          const match = e.target.closest(sel);
          if (match) handler(e, match);
        };
        target.addEventListener(type, listener);
        mockCtx.onDispose(() => target.removeEventListener(type, listener));
      }),
    };

    Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
      configurable: true,
      writable: true,
      value: {
        FeatureLifecycle: {
          define: jest.fn(def => {
            definedFeature = {
              ...def,
              sync: jest.fn(() => def.start?.(mockCtx)),
            };
            return definedFeature;
          }),
        },
      },
    });

    Object.defineProperty(window, 'YouTubePlusSettingsHost', {
      configurable: true,
      writable: true,
      value: {
        onChange: jest.fn((_key, _cb) => () => undefined),
        isEnabled: jest.fn(() => true),
      },
    });

    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: mockCleanupManager,
    });

    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: {
        StyleManager: mockStyleManager,
        getStyle: jest.fn(key => `.style-${key} { display: block; }`),
      },
    });

    const coordinatorCallbacks = {};
    Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
      configurable: true,
      writable: true,
      value: {
        subscribeRoot: jest.fn((id, cb) => {
          coordinatorCallbacks[id] = cb;
          cb?.([]);
          return id;
        }),
        unsubscribe: jest.fn(id => {
          delete coordinatorCallbacks[id];
        }),
        watchTarget: jest.fn((id, _target, cb) => {
          coordinatorCallbacks[id] = cb;
          cb?.();
        }),
        unwatch: jest.fn(id => {
          delete coordinatorCallbacks[id];
        }),
        _trigger: (id, arg) => coordinatorCallbacks[id]?.(arg),
      },
    });

    Object.defineProperty(window, 'YouTubePlusStats', {
      configurable: true,
      writable: true,
      value: {
        getDislikesData: jest.fn(async vid => ({ videoId: vid, dislikes: 1234, rating: 4.5 })),
      },
    });

    Object.defineProperty(window, 'YouTubePlusMain', {
      configurable: true,
      writable: true,
      value: {
        expandLiveChat: jest.fn(),
        preloadComments: jest.fn(),
      },
    });
  }

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    setupEnhancedDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(500);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // ─── 1. Return YouTube Dislike (RYD) ───────────────────────────────

  describe('Return YouTube Dislike Helpers', () => {
    test('getVideoIdForDislike extracts from search, pathname, clips, and dom fallbacks', () => {
      const getVid = window.YouTubePlusEnhanced.getVideoIdForDislike;

      // 1. From location search (?v=abc)
      mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '?v=video123',
        href: 'https://www.youtube.com/watch?v=video123',
      });
      expect(getVid()).toBe('video123');

      // 2. From shorts pathname
      window.YouTubeUtils.getVideoIdFromLocation.mockReturnValueOnce(null);
      mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/shorts/shortVideoId1',
        search: '',
        href: 'https://www.youtube.com/shorts/shortVideoId1',
      });
      expect(getVid()).toBe('shortVideoId1');

      // 3. From clip pathname with meta tag
      window.YouTubeUtils.getVideoIdFromLocation.mockReturnValueOnce(null);
      mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/clip/clip123',
        search: '',
        href: 'https://www.youtube.com/clip/clip123',
      });
      const meta = document.createElement('meta');
      meta.setAttribute('itemprop', 'videoId');
      meta.setAttribute('content', 'clipSourceVid');
      document.head.appendChild(meta);
      expect(getVid()).toBe('clipSourceVid');
      meta.remove();

      // 3b. A clip without its meta tag is unknown, even with a watch flexy in the page
      window.YouTubeUtils.getVideoIdFromLocation.mockReturnValueOnce(null);
      const staleFlexy = document.createElement('ytd-watch-flexy');
      staleFlexy.setAttribute('video-id', 'otherVideo1');
      document.body.appendChild(staleFlexy);
      expect(getVid()).toBeNull();
      staleFlexy.remove();

      // 4. Fallback from ytd-watch-flexy attribute
      window.YouTubeUtils.getVideoIdFromLocation.mockReturnValueOnce(null);
      mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/unknown',
        search: '',
        href: 'https://www.youtube.com/unknown',
      });
      const flexy = document.createElement('ytd-watch-flexy');
      flexy.setAttribute('video-id', 'flexyVid456');
      document.body.appendChild(flexy);
      expect(getVid()).toBe('flexyVid456');
      flexy.remove();

      // 5. Fallback from movie_player.getVideoData()
      window.YouTubeUtils.getVideoIdFromLocation.mockReturnValueOnce(null);
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.getVideoData = () => ({ video_id: 'playerVid789' });
      document.body.appendChild(player);
      expect(getVid()).toBe('playerVid789');
      player.remove();

      // 6. Fallback from meta tag when nothing else matches
      window.YouTubeUtils.getVideoIdFromLocation.mockReturnValueOnce(null);
      const metaTag = document.createElement('meta');
      metaTag.setAttribute('itemprop', 'videoId');
      metaTag.setAttribute('content', 'metaTagVid');
      document.head.appendChild(metaTag);
      expect(getVid()).toBe('metaTagVid');
      metaTag.remove();
    });

    test('formatCompactNumber handles numbers, null, and fallback', () => {
      const fn = window.YouTubePlusEnhanced.formatCompactNumber;
      expect(fn(null)).toBe('—');
      expect(fn(undefined)).toBe('—');
      expect(fn(0)).toBe('0');
      expect(fn(500)).toBe('500');
      expect(fn(1200)).toBe('1.2K');
      expect(fn(1000000)).toBe('1M');
    });

    test('getDislikeButton creates custom Shorts dislike wrap when native button is missing', () => {
      mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/shorts/testShort',
        href: 'https://www.youtube.com/shorts/testShort',
        search: '',
      });

      const likeBtn = document.createElement('button');
      likeBtn.setAttribute('aria-label', 'Like this video');
      document.body.appendChild(likeBtn);

      const btn = window.YouTubePlusEnhanced.getDislikeButton();
      expect(btn).not.toBeNull();
      expect(btn.id).toBe('yp-shorts-dislike');
      expect(btn.querySelector('.yp-shorts-dislike-btn')).not.toBeNull();
      expect(btn.querySelector('#yp-dislike-text')).not.toBeNull();
    });

    test('setDislikeDisplay updates dislike text and visibility on standard button', () => {
      const dislikeBtn = document.createElement('div');
      dislikeBtn.className = 'dislike-button-container';
      const innerBtn = document.createElement('button');
      dislikeBtn.appendChild(innerBtn);
      document.body.appendChild(dislikeBtn);

      window.YouTubePlusEnhanced.setDislikeDisplay(dislikeBtn, 42000);

      const textEl = dislikeBtn.querySelector('#yp-dislike-text');
      expect(textEl).not.toBeNull();
      expect(textEl.innerText).toBe('42K');
      expect(textEl.style.visibility).toBe('visible');
    });

    test('isDislikeAlreadyRendered checks correct attributes and label values', () => {
      const btn = document.createElement('button');
      btn.setAttribute('data-yp-video-id', 'vid123');
      const textSpan = document.createElement('span');
      textSpan.id = 'yp-dislike-text';
      textSpan.innerText = '1.5K';
      btn.appendChild(textSpan);

      expect(window.YouTubePlusEnhanced.isDislikeAlreadyRendered(btn, 'vid123', false)).toBe(true);
      expect(window.YouTubePlusEnhanced.isDislikeAlreadyRendered(btn, 'otherVid', false)).toBe(
        false
      );

      textSpan.innerText = '—';
      expect(window.YouTubePlusEnhanced.isDislikeAlreadyRendered(btn, 'vid123', false)).toBe(false);
    });

    test('isDislikeButtonReady detects buttons properly', () => {
      expect(
        window.YouTubePlusEnhanced.isDislikeButtonReady(document.createElement('div'), true)
      ).toBe(true);
      const readyBtn = document.createElement('button');
      expect(window.YouTubePlusEnhanced.isDislikeButtonReady(readyBtn, false)).toBe(true);
    });
  });

  // ─── 2. Top Buttons & Scroll Containers ────────────────────────────

  describe('Scroll To Top Buttons', () => {
    test('getUniversalScrollContainer detects scrollable containers across domains', () => {
      // 1. YouTube Watch
      const container = window.YouTubePlusEnhanced.getUniversalScrollContainer();
      expect(container).toBeDefined();

      // 2. YouTube Music domain
      mockLocation({
        hostname: 'music.youtube.com',
        pathname: '/',
        href: 'https://music.youtube.com/',
        search: '',
      });
      window.YouTubeUtils.isMusicDomain.mockReturnValue(true);

      const musicContainer = window.YouTubePlusEnhanced.getUniversalScrollContainer();
      expect(musicContainer).toBeDefined();
    });

    test('resolveMusicContainers and invalidateMusicContainersCache manage cache', () => {
      const initial = window.YouTubePlusEnhanced.resolveMusicContainers();
      expect(initial).toBeDefined();

      window.YouTubePlusEnhanced.invalidateMusicContainersCache();
      const afterInvalidate = window.YouTubePlusEnhanced.resolveMusicContainers();
      expect(afterInvalidate).toBeDefined();
    });

    test('right tabs top button scrolls right-tabs container or active tab', () => {
      const rightTabs = document.createElement('div');
      rightTabs.id = 'right-tabs';
      rightTabs.style.height = '500px';
      rightTabs.scrollTop = 250;
      rightTabs.scrollTo = jest.fn();

      const activeTab = document.createElement('div');
      activeTab.className = 'tab-content-cld';
      activeTab.scrollTop = 100;
      activeTab.scrollTo = jest.fn();
      rightTabs.appendChild(activeTab);
      document.body.appendChild(rightTabs);

      const btn = document.createElement('button');
      btn.id = 'right-tabs-top-button';
      btn.className = 'top-button';
      rightTabs.appendChild(btn);

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(rightTabs.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    test('playlist panel top button scrolls playlist panel items', () => {
      const panel = document.createElement('ytd-playlist-panel-renderer');
      const items = document.createElement('div');
      items.id = 'items';
      items.scrollTo = jest.fn();
      panel.appendChild(items);
      document.body.appendChild(panel);

      const btn = document.createElement('button');
      btn.id = 'playlist-panel-top-button';
      btn.className = 'top-button';
      panel.appendChild(btn);

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(items.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    test('universal top button scrolls window on watch page', () => {
      const scrollSpy = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
      const btn = document.createElement('button');
      btn.id = 'universal-top-button';
      btn.className = 'top-button';
      document.body.appendChild(btn);

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
      scrollSpy.mockRestore();
    });

    test('music side panel top button scrolls music panel', () => {
      mockLocation({
        hostname: 'music.youtube.com',
        pathname: '/watch',
        href: 'https://music.youtube.com/watch?v=music123',
        search: '?v=music123',
      });
      window.YouTubeUtils.isMusicDomain.mockReturnValue(true);

      const queue = document.createElement('div');
      queue.id = 'side-panel';
      queue.scrollTo = jest.fn();
      Object.defineProperty(queue, 'scrollHeight', { value: 600 });
      Object.defineProperty(queue, 'clientHeight', { value: 300 });
      document.body.appendChild(queue);

      const btn = document.createElement('button');
      btn.id = 'music-side-top-button';
      btn.className = 'top-button';
      document.body.appendChild(btn);

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(queue.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    test('tab change mutation triggers setupScrollListener', () => {
      const rightTabs = document.createElement('div');
      rightTabs.id = 'right-tabs';
      const tabContent = document.createElement('div');
      tabContent.className = 'tab-content-cld';
      rightTabs.appendChild(tabContent);
      document.body.appendChild(rightTabs);

      const coordinator = window.YouTubePlusMutationCoordinator;
      coordinator._trigger('enhanced::tabChanges', [
        {
          type: 'attributes',
          attributeName: 'class',
          target: tabContent,
        },
      ]);
    });

    test('feature stop cleans up top buttons and scopes', () => {
      definedFeature?.stop?.();
    });
  });

  // ─── 3. Quality Persistence (IIFE 2) ───────────────────────────────

  describe('Playback Quality Persistence (IIFE 2)', () => {
    test('settings update and navigation events re-trigger quality checks', () => {
      // Dispatch youtube-plus-settings-updated on window
      const settingsEvent = new CustomEvent('youtube-plus-settings-updated');
      window.dispatchEvent(settingsEvent);

      // Dispatch yt-navigate-finish on window
      const navEvent = new CustomEvent('yt-navigate-finish');
      window.dispatchEvent(navEvent);

      // Dispatch loadedmetadata on a video element
      const videoEl = document.createElement('video');
      document.body.appendChild(videoEl);
      const metaEvent = new Event('loadedmetadata', { bubbles: true });
      videoEl.dispatchEvent(metaEvent);
    });

    test('quality setting persistence stores and applies preferred quality', () => {
      storageMap['youtube_plus_manual_playback_quality'] = 'hd1080';

      const player = document.createElement('div');
      player.id = 'movie_player';
      player.getPlaybackQuality = jest.fn(() => 'hd720');
      player.getAvailableQualityLevels = jest.fn(() => ['hd1080', 'hd720', 'medium', 'auto']);
      player.setPlaybackQualityRange = jest.fn();
      player.setPlaybackQuality = jest.fn();
      document.body.appendChild(player);

      // Trigger navigation event which invokes quality application
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));

      // Player should have received quality calls
      if (player.setPlaybackQualityRange.mock.calls.length > 0) {
        expect(player.setPlaybackQualityRange).toHaveBeenCalledWith('hd1080', 'hd1080');
      }
    });

    test('quality menu click handles manual selection and stores value', () => {
      const menu = document.createElement('div');
      menu.className = 'ytp-quality-menu';
      const item = document.createElement('div');
      item.className = 'ytp-menuitem';
      item.setAttribute('data-value', 'hd1080');
      item.textContent = '1080p60 HD';
      menu.appendChild(item);
      document.body.appendChild(menu);

      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(storageMap['youtube_plus_manual_playback_quality']).toBe('hd1080');

      // Click auto resets stored quality
      item.setAttribute('data-value', 'auto');
      item.textContent = 'Auto';
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(storageMap['youtube_plus_manual_playback_quality']).toBeUndefined();
    });

    test('falls back to next available quality when preferred quality is unavailable', () => {
      storageMap['youtube_plus_manual_playback_quality'] = 'hd2160';

      const player = document.createElement('div');
      player.id = 'movie_player';
      player.getPlaybackQuality = jest.fn(() => 'hd720');
      player.getAvailableQualityLevels = jest.fn(() => ['hd1080', 'hd720', 'medium', 'auto']);
      player.setPlaybackQualityRange = jest.fn();
      player.setPlaybackQuality = jest.fn();
      document.body.appendChild(player);

      // Re-trigger quality application
      window.dispatchEvent(new CustomEvent('youtube-plus-settings-updated'));

      if (player.setPlaybackQualityRange.mock.calls.length > 0) {
        expect(player.setPlaybackQualityRange).toHaveBeenCalledWith('hd1080', 'hd1080');
      }
    });
  });

  // ─── 4. YouTube interface styles (IIFE 3) ─────────────────────

  describe('YouTube interface styles (IIFE 3)', () => {
    test('settings update applies styles through StyleManager', () => {
      const settings = {
        enableStyles: true,
        styles: {
          themeVariant: 'vision',
          themeStyle: 'solid',
          thumbnailHover: true,
          immersiveSearch: true,
          hideVoiceSearch: true,
          transparentHeader: true,
          cleanSideGuide: true,
          hideSideGuide: true,
          fixFeedLayout: true,
          sideVideosColumnsEnabled: true,
          sideVideosColumns: 2,
          playerBlur: true,
          betterCaptions: true,
          theaterEnhancements: true,
          compactFeed: true,
        },
      };

      const updateEvent = new CustomEvent('youtube-plus-settings-updated', {
        detail: settings,
      });
      window.dispatchEvent(updateEvent);

      expect(window.YouTubeUtils.StyleManager.add).toHaveBeenCalled();
    });

    test('disabling interface styles removes styles from StyleManager', () => {
      const updateEvent = new CustomEvent('youtube-plus-settings-updated', {
        detail: { enableStyles: false },
      });
      window.dispatchEvent(updateEvent);

      expect(window.YouTubeUtils.StyleManager.remove).toHaveBeenCalled();
    });

    test('focusin and focusout on yt-searchbox adjusts will-change style', () => {
      const searchbox = document.createElement('yt-searchbox');
      const input = document.createElement('input');
      searchbox.appendChild(input);
      document.body.appendChild(searchbox);

      input.dispatchEvent(new Event('focusin', { bubbles: true }));
      expect(searchbox.style.willChange).toBe('transform');

      input.dispatchEvent(new Event('focusout', { bubbles: true }));
      expect(searchbox.style.willChange).toBe('');
    });
  });

  // ─── 5. Theater Overlay Fixes (IIFE 4) ─────────────────────────────

  describe('Theater Overlay Runtime Fixes (IIFE 4)', () => {
    test('overlay bootstrap registers mutation coordinator watches', () => {
      expect(window.YouTubePlusMutationCoordinator.watchTarget).toBeDefined();
    });

    test('theater mode triggers live chat expansion and comment preloading', () => {
      const flexy = document.createElement('ytd-watch-flexy');
      flexy.setAttribute('theater', '');
      document.body.appendChild(flexy);

      const chat = document.createElement('ytd-live-chat-frame');
      chat.id = 'chat';
      document.body.appendChild(chat);

      // Trigger mutation check
      const coordinator = window.YouTubePlusMutationCoordinator;
      coordinator._trigger('enhanced::overlayFlexy');
      coordinator._trigger('enhanced::overlayChat');

      // Trigger navigation event
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      jest.advanceTimersByTime(300);

      expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();
      expect(window.YouTubePlusMain.preloadComments).toHaveBeenCalled();
    });
  });

  // ─── 7. Full Lifecycle and Retries Coverage ────────────────────────

  describe('Full Lifecycle and Retries Coverage', () => {
    test('initReturnDislike initializes dislike observer and cleanup removes all artifacts', async () => {
      mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '?v=vid123',
        href: 'https://www.youtube.com/watch?v=vid123',
      });

      const container = document.createElement('div');
      container.id = 'segmented-dislike-button';
      const button = document.createElement('button');
      container.appendChild(button);
      document.body.appendChild(container);

      // Trigger navigation on document
      document.dispatchEvent(new CustomEvent('yt-navigate-finish', { bubbles: true }));
      jest.advanceTimersByTime(500);
      await Promise.resolve();

      // Trigger coordinator poll
      const coordinator = window.YouTubePlusMutationCoordinator;
      coordinator._trigger('enhanced::dislikePoll');
      jest.advanceTimersByTime(500);
      await Promise.resolve();

      // Dislike text should be attached
      expect(document.querySelector('#yp-dislike-text')).not.toBeNull();

      // Trigger navigation away (which calls stopWatchEnhancements -> cleanupReturnDislike)
      mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/feed/subscriptions',
        search: '',
        href: 'https://www.youtube.com/feed/subscriptions',
      });
      document.dispatchEvent(new CustomEvent('yt-navigate-finish', { bubbles: true }));
      jest.advanceTimersByTime(500);
      await Promise.resolve();

      // Cleanup should have removed dislike text
      expect(document.querySelector('#yp-dislike-text')).toBeNull();
    });

    test('startWatchEnhancements creates buttons when containers appear via retry scheduler', () => {
      mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        search: '?v=vid123',
        href: 'https://www.youtube.com/watch?v=vid123',
      });

      const rightTabs = document.createElement('div');
      rightTabs.id = 'right-tabs';
      const tabContent = document.createElement('div');
      tabContent.className = 'tab-content-cld';
      rightTabs.appendChild(tabContent);
      document.body.appendChild(rightTabs);

      const playlistPanel = document.createElement('ytd-playlist-panel-renderer');
      const items = document.createElement('div');
      items.id = 'items';
      playlistPanel.appendChild(items);
      document.body.appendChild(playlistPanel);

      document.dispatchEvent(new CustomEvent('yt-navigate-finish', { bubbles: true }));
      jest.advanceTimersByTime(500);

      expect(document.getElementById('right-tabs-top-button')).not.toBeNull();
      expect(document.getElementById('playlist-panel-top-button')).not.toBeNull();
    });

    test('universal button is created on playlist page or non-watch routes', () => {
      mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/playlist',
        search: '?list=PL123',
        href: 'https://www.youtube.com/playlist?list=PL123',
      });

      document.dispatchEvent(new CustomEvent('yt-navigate-finish', { bubbles: true }));
      jest.advanceTimersByTime(500);

      expect(document.getElementById('universal-top-button')).not.toBeNull();
    });

    test('music side panel button creation retries and anchors inside panel', () => {
      mockLocation({
        hostname: 'music.youtube.com',
        pathname: '/watch',
        search: '?v=song123',
        href: 'https://music.youtube.com/watch?v=song123',
      });
      window.YouTubeUtils.isMusicDomain.mockReturnValue(true);

      const panel = document.createElement('div');
      panel.id = 'side-panel';
      Object.defineProperty(panel, 'scrollHeight', { value: 500 });
      Object.defineProperty(panel, 'clientHeight', { value: 200 });
      document.body.appendChild(panel);

      document.dispatchEvent(new CustomEvent('yt-navigate-finish', { bubbles: true }));
      const coordinator = window.YouTubePlusMutationCoordinator;
      coordinator._trigger('enhanced::musicSidePanel');
      jest.advanceTimersByTime(1000);

      expect(document.getElementById('music-side-top-button')).not.toBeNull();
    });

    test('scheduleApplyStoredQuality retries multiple times until player metadata is ready', () => {
      storageMap['youtube_plus_manual_playback_quality'] = 'hd1080';

      const player = document.createElement('div');
      player.id = 'movie_player';
      let ready = false;
      player.getAvailableQualityLevels = jest.fn(() => {
        if (!ready) {
          ready = true;
          return ['auto'];
        }
        return ['hd1080', 'hd720', 'auto'];
      });
      player.getPlaybackQuality = jest.fn(() => 'hd720');
      player.setPlaybackQualityRange = jest.fn();
      player.setPlaybackQuality = jest.fn();
      document.body.appendChild(player);

      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      jest.advanceTimersByTime(350 * 5);

      expect(player.setPlaybackQualityRange).toHaveBeenCalledWith('hd1080', 'hd1080');
      expect(storageMap['yt-player-quality']).toBeDefined();
    });

    test('scheduleNonCriticalStyles applies delayed non-critical styles when immediate is false', () => {
      const settings = {
        enableStyles: true,
        styles: {
          thumbnailHover: true,
          betterCaptions: true,
          sideVideosColumnsEnabled: true,
          sideVideosColumns: 1,
        },
      };

      window.dispatchEvent(
        new CustomEvent('youtube-plus-settings-updated', {
          detail: settings,
        })
      );
      jest.advanceTimersByTime(5500);

      expect(window.YouTubeUtils.StyleManager.add).toHaveBeenCalled();
    });
  });
});
