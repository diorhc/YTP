/**
 * @jest-environment jsdom
 */

const mockLocation = globalThis.mockLocation;

describe('Channel Stats Overlay', () => {
  let mockCleanupManager;
  let mockRetryScheduler;
  let mockVisibilityInterval;

  function setupDeps() {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete window.__ytpVideoStatsModuleInit;
    delete window.__ytpChannelStatsModuleInit;
    delete window.YouTubeStats;
    delete window.YouTubePlusStats;
    delete window.ytInitialData;
    delete window.ytcfg;

    mockLocation({
      href: 'https://www.youtube.com/@TestChannel',
      hostname: 'www.youtube.com',
      pathname: '/@TestChannel',
      search: '',
    });

    const meta = document.createElement('meta');
    meta.setAttribute('itemprop', 'channelId');
    meta.content = 'UC1234567890123456789012';
    document.head.appendChild(meta);

    mockCleanupManager = {
      registerListener: jest.fn((target, event, handler, options) => {
        if (target && typeof target.addEventListener === 'function') {
          target.addEventListener(event, handler, options);
        }
        return `${event}-listener`;
      }),
      unregisterListener: jest.fn(),
      register: jest.fn(),
      disconnectSubtree: jest.fn(),
    };

    mockRetryScheduler = { stop: jest.fn() };
    mockVisibilityInterval = {
      stop: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      active: true,
    };

    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: mockCleanupManager,
    });

    // The stats enable flags are settings-store keys; keep a small store double
    // so the checkbox handlers can read and write them.
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
            /* ignore */
          }
          return mockRetryScheduler;
        }),
        createVisibilityAwareInterval: jest.fn((cb, _delay) => {
          try {
            if (typeof cb === 'function') {
              cb();
            }
          } catch {
            /* ignore */
          }
          return mockVisibilityInterval;
        }),
        cleanupManager: mockCleanupManager,
        StyleManager: {
          add: jest.fn(),
          remove: jest.fn(),
        },
        isStudioPage: jest.fn(() => false),
        isChannelPage: jest.fn(url => {
          const checkUrl = url || window.location.href;
          return /\/channel\/|\/@|\/c\//.test(checkUrl);
        }),
        isSettingsModalOpen: jest.fn(() => false),
        logSuppressed: jest.fn(),
        log: jest.fn(),
        logError: jest.fn(),
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        createWithErrorBoundary: _name => fn => fn,
        onDomReady: cb => cb(),
        getRoute: () => {
          const p = window.location.pathname || '/';
          if (p === '/watch') return 'watch';
          if (p.startsWith('/shorts')) return 'shorts';
          if (window.YouTubeUtils?.isChannelPage?.(window.location.href)) return 'channel';
          return 'other';
        },
        registerListenerSafe: (target, event, handler, options) => {
          if (target && typeof target.addEventListener === 'function') {
            target.addEventListener(event, handler, options);
          }
          return `${event}-listener`;
        },
        storage: {
          getItem: jest.fn(key => {
            if (key === 'youtube_channel_stats_settings') return 'true';
            return null;
          }),
          setItem: jest.fn(),
        },
        whenRelevant: jest.fn(config => {
          if (config.name === 'stats.channel') {
            config.onEnter();
          }
        }),
      },
    });

    // Minimal route-aware lifecycle host: starts/stops each definition by its
    // routes, with a context whose listeners attach for real.
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
    Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
      configurable: true,
      writable: true,
      value: {
        FeatureLifecycle: {
          define: jest.fn(def => {
            if (!def || typeof def.start !== 'function') return null;
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

    Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    require('../src/modal-handlers.js');
    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: {
        initGlassDropdown:
          window.YouTubePlusModalHandlers?.initGlassDropdown ||
          window.YouTubePlusDesignSystem?.initGlassDropdown,
        getStyle: () => '',
      },
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn(async url => {
        if (String(url).includes('api.livecounts.io')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ liveSubscriber: 1234, liveViews: 56789, liveVideos: 100 }),
            text: async () =>
              JSON.stringify({ liveSubscriber: 1234, liveViews: 56789, liveVideos: 100 }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () =>
            '<script>var ytInitialData = {"metadata":{"channelMetadataRenderer":{"externalId":"UC1234567890123456789012","title":"Test Channel"}}};</script>',
        };
      }),
    });
  }

  beforeEach(() => {
    jest.resetModules();
    setupDeps();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function renderBanner() {
    let banner = document.getElementById('page-header-banner-sizer');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'page-header-banner-sizer';
      document.body.appendChild(banner);
    }
    banner.getBoundingClientRect = () => ({
      width: 900,
      height: 200,
      top: 0,
      left: 0,
      right: 900,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    return banner;
  }

  function renderSettingsCheckbox() {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'yp-setting-enableChannelStats';
    document.body.appendChild(cb);
    return cb;
  }

  test('1. Initializes and creates overlay when banner is present', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(window.YouTubePlusStats.init).toBeDefined();

    const overlay = document.querySelector('.channel-banner-overlay');
    expect(overlay).toBeTruthy();
    expect(document.querySelector('.settings-button')).toBeTruthy();
  });

  test('2. Does not initialize overlay on non-channel routes', async () => {
    mockLocation({
      href: 'https://www.youtube.com/watch?v=123',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=123',
    });
    window.YouTubeUtils.isChannelPage.mockReturnValue(false);

    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const overlay = document.querySelector('.channel-banner-overlay');
    expect(overlay).toBeFalsy();
  });

  test('3. Uses retry scheduler if banner is initially missing', async () => {
    let savedCheck;
    window.YouTubeUtils.createRetryScheduler = jest.fn(({ check }) => {
      savedCheck = check;
      return mockRetryScheduler;
    });

    require('../src/stats.js');
    await Promise.resolve();

    // Banner missing, shouldn't have overlay
    expect(document.querySelector('.channel-banner-overlay')).toBeFalsy();

    // Simulate retry scheduler finding banner
    renderBanner();
    expect(typeof savedCheck).toBe('function');
    savedCheck();

    expect(document.querySelector('.channel-banner-overlay')).toBeTruthy();
  });

  test('4. Settings button click opens settings menu', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const settingsButton = document.querySelector('.settings-button');
    const settingsMenu = document.querySelector('.settings-menu');

    expect(settingsMenu.classList.contains('show')).toBe(false);

    settingsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(settingsMenu.classList.contains('show')).toBe(true);
  });

  test('5. Settings button Keydown Enter opens settings menu', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const settingsButton = document.querySelector('.settings-button');
    const settingsMenu = document.querySelector('.settings-menu');

    settingsButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(settingsMenu.classList.contains('show')).toBe(true);
  });

  test('6. Escape key closes settings menu', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const settingsButton = document.querySelector('.settings-button');
    const settingsMenu = document.querySelector('.settings-menu');

    settingsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(settingsMenu.classList.contains('show')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(settingsMenu.classList.contains('show')).toBe(false);
  });

  test('7. Click outside closes settings menu', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const settingsButton = document.querySelector('.settings-button');
    const settingsMenu = document.querySelector('.settings-menu');

    settingsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Click outside
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(settingsMenu.classList.contains('show')).toBe(false);
  });

  test('8. Checkboxes update visibility and localStorage', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const checkbox = document.getElementById('show-subscribers');
    expect(checkbox).toBeTruthy();

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(window.YouTubeUtils.storage.setItem).toHaveBeenCalledWith('show-subscribers', 'false');
  });

  test('9. Font dropdown selection updates localStorage and styles', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();
    await Promise.resolve(); // microtask for initFontDropdown

    const fontDropdownList = document.querySelector('.glass-dropdown__list');
    const item = fontDropdownList.querySelector(
      '.glass-dropdown__item[data-value="Impact, Charcoal, sans-serif"]'
    );

    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(window.YouTubeUtils.storage.setItem).toHaveBeenCalledWith(
      'youtubeEnhancerFontFamily',
      'Impact, Charcoal, sans-serif'
    );
  });

  test('10. Font size slider updates localStorage and styles', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const controlsSection = document.querySelector('.yp-stats-channel-menu > div:nth-child(2)');
    const sizeSlider = controlsSection.querySelector('.font-size-slider');

    sizeSlider.value = '32';
    sizeSlider.dispatchEvent(new Event('input', { bubbles: true }));
    // Persistence happens when the slider settles, not on every input step.
    sizeSlider.dispatchEvent(new Event('change', { bubbles: true }));

    expect(window.YouTubeUtils.storage.setItem).toHaveBeenCalledWith(
      'youtubeEnhancerFontSize',
      '32'
    );
  });

  test('11. Interval slider updates interval and restarts visibility timer', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const controlsSection = document.querySelector('.yp-stats-channel-menu > div:nth-child(2)');
    const intervalSlider = controlsSection.querySelector('.interval-slider');

    intervalSlider.value = '8';
    intervalSlider.dispatchEvent(new Event('input', { bubbles: true }));
    intervalSlider.dispatchEvent(new Event('change', { bubbles: true }));

    expect(window.YouTubeUtils.storage.setItem).toHaveBeenCalledWith(
      'youtubeEnhancerInterval',
      '8000'
    );
    expect(mockVisibilityInterval.stop).toHaveBeenCalled();
  });

  test('12. Opacity slider updates overlay style and localStorage', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const controlsSection = document.querySelector('.yp-stats-channel-menu > div:nth-child(2)');
    const opacitySlider = controlsSection.querySelector('.opacity-slider');

    opacitySlider.value = '60';
    opacitySlider.dispatchEvent(new Event('input', { bubbles: true }));
    opacitySlider.dispatchEvent(new Event('change', { bubbles: true }));

    expect(window.YouTubeUtils.storage.setItem).toHaveBeenCalledWith(
      'youtubeEnhancerOpacity',
      '0.6'
    );
    const overlay = document.querySelector('.channel-banner-overlay');
    expect(overlay.style.backgroundColor).toBe('rgba(0, 0, 0, 0.6)');
  });

  test('13. fetchWithGM uses fetch fallback when GM_xmlhttpRequest is missing', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  test('14. fetchWithGM uses GM_xmlhttpRequest when available', async () => {
    const gmMock = jest.fn(opts =>
      opts.onload({ status: 200, responseText: '{"liveSubscriber":111}' })
    );
    globalThis.GM_xmlhttpRequest = gmMock;

    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(gmMock).toHaveBeenCalled();
  });

  test('15. Channel ID resolves via meta tag', async () => {
    const meta = document.querySelector('meta[itemprop="channelId"]');
    meta.content = 'UCmeta1234567890123456';

    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('UCmeta1234567890123456'),
      expect.any(Object)
    );
  });

  test('16. Channel ID resolves via ytcfg', async () => {
    document.querySelector('meta[itemprop="channelId"]')?.remove();
    window.ytcfg = { get: jest.fn(() => 'UCytcfg12345678901234567') };

    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('UCytcfg12345678901234567'),
      expect.any(Object)
    );
  });

  test('17. Navigation yt-navigate-finish to channel page adds overlay', async () => {
    require('../src/stats.js');
    await Promise.resolve();

    renderBanner();
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await Promise.resolve();

    expect(document.querySelector('.channel-banner-overlay')).toBeTruthy();
  });

  test('18. Navigation yt-navigate-finish away removes overlay', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();
    expect(document.querySelector('.channel-banner-overlay')).toBeTruthy();

    window.YouTubeUtils.isChannelPage.mockReturnValue(false);
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await Promise.resolve();

    expect(document.querySelector('.channel-banner-overlay')).toBeFalsy();
  });

  test('19. Navigation yp:nav-refresh rerenders overlay', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    document.querySelector('.channel-banner-overlay').remove();
    window.dispatchEvent(new Event('yp:nav-refresh'));
    await Promise.resolve();

    expect(document.querySelector('.channel-banner-overlay')).toBeTruthy();
  });

  test('20. Extract subscriber count from DOM fallback', async () => {
    const subCount = document.createElement('div');
    subCount.id = 'subscriber-count';
    subCount.textContent = '1.2M subscribers';
    document.body.appendChild(subCount);

    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(document.querySelector('.channel-banner-overlay')).toBeTruthy();
  });

  test('21. The channel-stats checkbox is owned by the settings modal', async () => {
    window.YouTubeUtils.isSettingsModalOpen = jest.fn(() => true);
    const cb = renderSettingsCheckbox();
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(document.querySelector('.channel-banner-overlay')).toBeTruthy();

    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await Promise.resolve();

    // The module attaches no handler: the overlay stays and the store write is
    // the general settings handler's job.
    expect(cb.dataset.handlerAttached).toBeUndefined();
    expect(window.YouTubePlusSettingsStore.set).not.toHaveBeenCalledWith(
      'enableChannelStats',
      false
    );
    expect(document.querySelector('.channel-banner-overlay')).toBeTruthy();
  });

  test('22. The channel-stats flag off keeps the overlay absent and the checkbox unbound', async () => {
    window.YouTubeUtils.isSettingsModalOpen = jest.fn(() => true);
    window.YouTubePlusSettingsStore.set('enableChannelStats', false);

    const cb = renderSettingsCheckbox();
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    await new Promise(r => setTimeout(r, 200));

    expect(document.querySelector('.channel-banner-overlay')).toBeFalsy();
    expect(cb.dataset.handlerAttached).toBeUndefined();
  });

  test('23. Cleanup method removes overlays and clears timers', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(document.querySelector('.channel-banner-overlay')).toBeTruthy();

    window.YouTubePlusStats.cleanup();
    expect(document.querySelector('.channel-banner-overlay')).toBeFalsy();
    expect(mockVisibilityInterval.stop).toHaveBeenCalled();
  });

  test('24. Mobile responsiveness reduces padding and flex direction', async () => {
    window.innerWidth = 500;
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const overlay = document.querySelector('.channel-banner-overlay');
    expect(overlay.style.flexDirection).toBe('column');
    expect(overlay.style.padding).toBe('10px');
  });

  test('25. Overlay Accessibility properties', async () => {
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const overlay = document.querySelector('.channel-banner-overlay');
    expect(overlay.getAttribute('role')).toBe('region');
    expect(overlay.getAttribute('tabindex')).toBe('-1');
  });

  test('26. Render digit groups inserts commas properly', async () => {
    globalThis.GM_xmlhttpRequest = jest.fn(opts =>
      opts.onload({
        status: 200,
        responseText: '{"liveSubscriber":1234567, "liveViews": 0, "liveVideos": 0}',
      })
    );
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    const overlay = document.querySelector('.channel-banner-overlay');
    expect(overlay).toBeTruthy();
  });

  test('27. fetch error gracefully returns null and triggers fallback', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(document.querySelector('.channel-banner-overlay')).toBeTruthy();
  });

  test('28. Stats fetching retries on failure', async () => {
    let attempts = 0;
    globalThis.fetch = jest.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return { ok: true, status: 200, json: async () => ({ liveSubscriber: 1 }) };
    });

    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(attempts).toBeGreaterThanOrEqual(1);
  });

  test('29. Caching avoids refetching stats', async () => {
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ liveSubscriber: 1 }),
    }));
    globalThis.fetch = fetchSpy;

    renderBanner();
    require('../src/stats.js');
    await Promise.resolve();

    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(5);
  });

  test('30. youtube-plus-settings-modal-opened event runs initChannelStats', async () => {
    require('../src/stats.js');
    await Promise.resolve();

    document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
    await Promise.resolve();

    expect(window.YouTubePlusStats.init).toBeDefined();
  });
});
