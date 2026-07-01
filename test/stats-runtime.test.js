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
        log: jest.fn(),
        logError: jest.fn(),
        logger: {
          debug: jest.fn(),
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

  test('registers both stats modules with whenRelevant', () => {
    // Reset the init flag (it persists across tests in the same module)
    delete window.__ytpVideoStatsModuleInit;
    delete window.__ytpChannelStatsModuleInit;

    const whenRelevant = jest.fn();
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        ...(window.YouTubeUtils || {}),
        whenRelevant,
      },
    });

    jest.resetModules();
    require('../src/stats.js');

    expect(whenRelevant).toHaveBeenCalledTimes(2);

    const names = whenRelevant.mock.calls.map(call => call[0]?.name);
    expect(names).toContain('stats.video');
    expect(names).toContain('stats.channel');

    const videoCall = whenRelevant.mock.calls.find(call => call[0]?.name === 'stats.video');
    const channelCall = whenRelevant.mock.calls.find(call => call[0]?.name === 'stats.channel');

    expect(typeof videoCall?.[0]?.isRelevant).toBe('function');
    expect(typeof videoCall?.[0]?.onEnter).toBe('function');
    expect(typeof channelCall?.[0]?.isRelevant).toBe('function');
    expect(typeof channelCall?.[0]?.onEnter).toBe('function');
  });

  test('route predicates from whenRelevant options behave as expected', () => {
    delete window.__ytpVideoStatsModuleInit;
    delete window.__ytpChannelStatsModuleInit;

    const whenRelevant = jest.fn();
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        ...(window.YouTubeUtils || {}),
        whenRelevant,
      },
    });

    jest.resetModules();
    require('../src/stats.js');

    const videoIsRelevant = whenRelevant.mock.calls.find(call => call[0]?.name === 'stats.video')?.[0]
      ?.isRelevant;
    const channelIsRelevant = whenRelevant.mock.calls.find(call => call[0]?.name === 'stats.channel')?.[0]
      ?.isRelevant;

    expect(videoIsRelevant).toBeDefined();
    expect(channelIsRelevant).toBeDefined();

    mockLocation({
      href: 'https://www.youtube.com/watch?v=abc123def45',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=abc123def45',
    });
    expect(videoIsRelevant()).toBe(true);

    mockLocation({
      href: 'https://www.youtube.com/channel/UC1234567890',
      hostname: 'www.youtube.com',
      pathname: '/channel/UC1234567890',
      search: '',
    });
    expect(channelIsRelevant()).toBe(true);

    mockLocation({
      href: 'https://www.youtube.com/results?search_query=test',
      hostname: 'www.youtube.com',
      pathname: '/results',
      search: '?search_query=test',
    });
    expect(channelIsRelevant()).toBe(false);
  });

  test('invokes both init callbacks without throwing and exports channel stats API', () => {
    const whenRelevant = jest.fn();
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        ...(window.YouTubeUtils || {}),
        whenRelevant,
      },
    });

    jest.resetModules();
    require('../src/stats.js');

    const videoInit = whenRelevant.mock.calls.find(call => call[0]?.name === 'stats.video')?.[0]
      ?.onEnter;
    const channelInit = whenRelevant.mock.calls.find(call => call[0]?.name === 'stats.channel')?.[0]
      ?.onEnter;

    expect(typeof videoInit).toBe('function');
    expect(typeof channelInit).toBe('function');

    expect(() => videoInit()).not.toThrow();
    expect(() => channelInit()).not.toThrow();

    expect(window.__ytpVideoStatsModuleInit).toBe(true);
    expect(window.__ytpChannelStatsModuleInit).toBe(true);
    expect(window.YouTubeStats).toBeDefined();
    expect(typeof window.YouTubeStats.init).toBe('function');
    expect(typeof window.YouTubeStats.cleanup).toBe('function');
  });

  test('reacts to settings/language/navigation events after init', () => {
    const whenRelevant = jest.fn();
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        ...(window.YouTubeUtils || {}),
        whenRelevant,
      },
    });

    jest.resetModules();
    require('../src/stats.js');

    const videoInit = whenRelevant.mock.calls.find(call => call[0]?.name === 'stats.video')?.[0]
      ?.onEnter;
    const channelInit = whenRelevant.mock.calls.find(call => call[0]?.name === 'stats.channel')?.[0]
      ?.onEnter;

    videoInit();
    channelInit();

    const experimentalSection = document.createElement('div');
    experimentalSection.className = 'ytp-plus-settings-section';
    experimentalSection.setAttribute('data-section', 'experimental');
    document.body.appendChild(experimentalSection);

    const navItem = document.createElement('button');
    navItem.className = 'ytp-plus-settings-nav-item';
    navItem.setAttribute('data-section', 'experimental');
    document.body.appendChild(navItem);

    document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
    document.dispatchEvent(new Event('youtube-plus-language-changed'));
    navItem.click();
    window.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('yt-page-data-updated'));

    expect(window.YouTubeUtils.cleanupManager.registerListener).toHaveBeenCalled();
    expect(window.YouTubeUtils.StyleManager.add).toHaveBeenCalled();
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

    const whenRelevant = jest.fn();
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        ...(window.YouTubeUtils || {}),
        whenRelevant,
      },
    });

    jest.resetModules();
    require('../src/stats.js');
    const channelInit = whenRelevant.mock.calls.find(call => call[0]?.name === 'stats.channel')?.[0]
      ?.onEnter;
    expect(typeof channelInit).toBe('function');

    channelInit();
    window.dispatchEvent(new Event('yt-navigate-finish'));
    window.dispatchEvent(new Event('ytp:nav-refresh'));

    expect(typeof window.YouTubeStats?.cleanup).toBe('function');
    expect(() => window.YouTubeStats.cleanup()).not.toThrow();
  });
});
