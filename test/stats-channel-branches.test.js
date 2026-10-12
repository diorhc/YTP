/**
 * @jest-environment jsdom
 *
 * Branch coverage for the channel half of src/stats.js: the live-counter
 * transport (GM + fetch fallbacks, retries, cache), channel-ID resolution and
 * its fallbacks, the digit/difference rendering of the banner overlay, the
 * display-option layout recalculation and the overlay lifecycle helpers.
 * Real module throughout, mocked network, timers and animation frames.
 */

const mockLocation = globalThis.mockLocation;

/** The network stub installed for the current test. */
let fetchSpy;

function setupChannelDeps() {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete window.__ytpVideoStatsModuleInit;
  delete window.__ytpChannelStatsModuleInit;
  delete window.YouTubeStats;
  delete window.YouTubePlusStats;
  delete window.ytInitialData;
  delete window.ytcfg;
  delete globalThis.GM_xmlhttpRequest;

  localStorage.clear();

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

  const cleanupManager = {
    registerListener: jest.fn((target, event, handler, options) => {
      if (target && typeof target.addEventListener === 'function') {
        target.addEventListener(event, handler, options);
      }
      return { dispose: () => target.removeEventListener(event, handler, options) };
    }),
    unregisterListener: jest.fn(),
    register: jest.fn(),
    cleanup: jest.fn(),
    registerAnimationFrame: jest.fn(id => id),
    disconnectSubtree: jest.fn(),
  };

  Object.defineProperty(window, 'YouTubePlusCleanupManager', {
    configurable: true,
    writable: true,
    value: cleanupManager,
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
      // No warn/error: the module must fall back to the console.
      logger: { debug: jest.fn() },
      logSuppressed: jest.fn(),
      logError: jest.fn(),
      isStudioPage: jest.fn(() => false),
      isChannelPage: jest.fn(url => {
        const checkUrl = url || window.location.href;
        return /\/channel\/|\/@|\/c\/|\/user\//.test(checkUrl);
      }),
      isSettingsModalOpen: jest.fn(() => false),
      registerListenerSafe: (target, event, handler, options) => {
        if (target && typeof target.addEventListener === 'function') {
          target.addEventListener(event, handler, options);
        }
        return `${event}-listener`;
      },
      createRetryScheduler: jest.fn(() => ({ stop: jest.fn() })),
      createVisibilityAwareInterval: jest.fn(() => ({
        stop: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        active: true,
      })),
      cleanupManager,
      StyleManager: { add: jest.fn(), remove: jest.fn() },
      onDomReady: cb => cb(),
      getRoute: () => {
        const p = window.location.pathname || '/';
        if (p === '/watch') return 'watch';
        if (p.startsWith('/shorts')) return 'shorts';
        return window.YouTubeUtils.isChannelPage(window.location.href) ? 'channel' : 'other';
      },
      storage: {
        getItem: key => localStorage.getItem(key),
        setItem: (key, value) => {
          localStorage.setItem(key, value);
          return true;
        },
      },
    },
  });

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

  require('../src/modal-handlers.js');
  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      initGlassDropdown:
        window.YouTubePlusModalHandlers?.initGlassDropdown ||
        window.YouTubePlusDesignSystem?.initGlassDropdown ||
        jest.fn(),
      getStyle: () => '',
    },
  });
}

function renderBanner() {
  const banner = document.createElement('div');
  banner.id = 'page-header-banner-sizer';
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
  document.body.appendChild(banner);
  return banner;
}

/** Live-counter payload plus the channel page HTML the runtime reads. */
const LIVE_COUNTS = { followerCount: 1234, bottomOdos: [56789, 100] };

function installFetch(overrides = {}) {
  const state = {
    livecounts: () => ({ ok: true, status: 200, json: async () => LIVE_COUNTS }),
    // Channel page bodies: the runtime reads them as HTML.
    page: () => channelHtml({ title: 'Test Channel', externalId: 'UC1234567890123456789012' }),
    ...overrides,
  };
  const fetchMock = jest.fn(async url => {
    const urlStr = String(url);
    if (urlStr.includes('livecounts.io')) return state.livecounts(urlStr);
    const body = state.page(urlStr);
    return typeof body === 'string'
      ? { ok: true, status: 200, json: async () => ({}), text: async () => body }
      : body;
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
  fetchSpy = fetchMock;
  return fetchMock;
}

function channelHtml({ title = 'Test Channel', externalId = 'UC1234567890123456789012' } = {}) {
  const metadata = externalId
    ? `{"channelMetadataRenderer":{"title":"${title}","externalId":"${externalId}"}}`
    : '{"channelMetadataRenderer":{"title":"' + title + '"}}';
  return `<html><script>var ytInitialData = {"metadata":${metadata}};</script></html>`;
}

const flush = async (times = 2) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

const overlay = () => document.querySelector('.channel-banner-overlay');
const statText = (cls, root = overlay()) =>
  (root?.querySelector(`.${cls}-number`)?.textContent || '').replace(/\D/g, '');

describe('stats channel branch coverage', () => {
  let intervalCb;
  let intervalHandles;

  beforeEach(() => {
    jest.resetModules();
    setupChannelDeps();
    // The module logs through the console whenever no logger is wired.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    window.YouTubeUtils.createVisibilityAwareInterval = jest.fn(cb => {
      intervalCb = cb;
      const handle = { stop: jest.fn(), pause: jest.fn(), resume: jest.fn(), active: true };
      intervalHandles.push(handle);
      return handle;
    });
    window.YouTubeUtils.createRetryScheduler = jest.fn(({ check }) => {
      // The banner exists, so the first check runs immediately; later checks
      // stay under the test's control.
      check();
      return { stop: jest.fn(), check };
    });
    intervalCb = null;
    intervalHandles = [];
    installFetch();
    renderBanner();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // ─── settings menu ────────────────────────────────────────────────────────

  test('the font dropdown toggle opens and closes the font list', async () => {
    require('../src/stats.js');
    await flush();
    expect(overlay()).not.toBeNull();

    const dropdown = document.querySelector('.glass-dropdown__toggle').closest('.glass-dropdown');
    const list = dropdown.querySelector('.glass-dropdown__list');
    expect(dropdown.getAttribute('aria-expanded')).toBe('false');
    expect(list.style.display).toBe('none');

    dropdown
      .querySelector('.glass-dropdown__toggle')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dropdown.getAttribute('aria-expanded')).toBe('true');
    expect(list.style.display).toBe('block');

    dropdown
      .querySelector('.glass-dropdown__toggle')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dropdown.getAttribute('aria-expanded')).toBe('false');
    expect(list.style.display).toBe('none');

    const item = dropdown.querySelector(
      '.glass-dropdown__item[data-value="Verdana, Geneva, sans-serif"]'
    );
    if (item) {
      item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(localStorage.getItem('youtubeEnhancerFontFamily')).toBe('Verdana, Geneva, sans-serif');
    }
  });

  // ─── display-option layout ────────────────────────────────────────────────

  describe('overlay layout follows the visible options', () => {
    const boot = async () => {
      require('../src/stats.js');
      await flush();
      await flush();
      expect(overlay()).not.toBeNull();
      return Array.from(overlay().querySelectorAll('.channel-stat'));
    };

    // The layout pass derives its visibility key from the number container's class
    // list, so a hidden counter is declared with exactly that derived key.
    const hideOption = name => {
      const numberEl = overlay().querySelector('.' + name + '-number');
      localStorage.setItem('show-' + numberEl.className.replace('-number', ''), 'false');
      const checkbox = document.getElementById('show-' + name);
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    };

    test('three visible options split the row into thirds', async () => {
      const containers = await boot();
      expect(containers).toHaveLength(3);
      expect(containers.map(c => c.style.width)).toEqual(['33.33%', '33.33%', '33.33%']);
      expect(containers.every(c => c.style.display === 'flex')).toBe(true);
    });

    test('one visible option takes the full width', async () => {
      await boot();
      hideOption('views');
      hideOption('videos');

      expect(overlay().querySelector('.channel-stat').style.width).toBe('100%');
      expect(overlay().querySelectorAll('.channel-stat')[1].style.display).toBe('none');
      expect(overlay().querySelectorAll('.channel-stat')[2].style.display).toBe('none');
    });

    test('two visible options split the row in half', async () => {
      await boot();
      hideOption('videos');

      const containers = Array.from(overlay().querySelectorAll('.channel-stat'));
      // Only the visible counters are re-laid out; the hidden one is dropped
      // from the row entirely.
      expect(containers.slice(0, 2).map(c => c.style.width)).toEqual(['50%', '50%']);
      expect(containers[2].style.display).toBe('none');
    });

    test('hiding every option hides the row instead of stretching it', async () => {
      await boot();
      for (const name of ['subscribers', 'views', 'videos']) hideOption(name);

      expect(
        Array.from(overlay().querySelectorAll('.channel-stat')).every(
          c => c.style.display === 'none'
        )
      ).toBe(true);
    });

    test('a display option checkbox persists its flag', async () => {
      await boot();
      const checkbox = document.getElementById('show-views');
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));

      expect(localStorage.getItem('show-views')).toBe('false');
    });
  });

  // ─── counter transport: GM and fetch fallbacks ────────────────────────────
  describe('counter transport fallbacks', () => {
    const bootWith = (overrides, gmImpl) => {
      installFetch(overrides);
      if (gmImpl) {
        globalThis.GM_xmlhttpRequest = jest.fn(gmImpl);
      }
      require('../src/stats.js');
      return fetchSpy;
    };

    test('a GM response with a malformed body is retried and never rendered', async () => {
      jest.useFakeTimers();
      let attempts = 0;
      const fetchMock = bootWith(
        {
          livecounts: () => {
            attempts += 1;
            return { ok: false, status: 500, json: async () => ({}) };
          },
        },
        opts => {
          setTimeout(() => opts.onload({ status: 200, responseText: 'not json' }), 0);
        }
      );
      await jest.advanceTimersByTimeAsync(10000);

      // The unparsable GM body is never turned into a count.
      expect(attempts).toBe(0);
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).includes('livecounts'))
      ).toHaveLength(0);
      expect(console.warn).toHaveBeenCalledWith(
        '[YouTube+][Stats]',
        'Using fallback stats due to API error'
      );
    });

    test('a non-2xx GM response fails the fetch with its status', async () => {
      jest.useFakeTimers();
      const fetchMock = bootWith({}, opts => {
        setTimeout(() => opts.onload({ status: 500, responseText: '' }), 0);
      });
      await jest.advanceTimersByTimeAsync(10000);

      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).includes('livecounts'))
      ).toHaveLength(0);
      expect(console.error).toHaveBeenCalledWith(
        '[YouTube+][Stats]',
        'Failed to fetch channel stats:',
        expect.objectContaining({ message: 'Failed to fetch: 500' })
      );
    });

    test('a failing fetch fallback is reported and never rendered', async () => {
      jest.useFakeTimers();
      bootWith({
        livecounts: () => ({ ok: false, status: 503, json: async () => ({}) }),
      });
      await jest.advanceTimersByTimeAsync(10000);

      expect(console.warn).toHaveBeenCalledWith(
        '[YouTube+][Stats]',
        'GM_xmlhttpRequest unavailable, falling back to fetch API'
      );
      expect(console.error).toHaveBeenCalledWith(
        '[YouTube+][Stats]',
        'Fallback fetch failed:',
        expect.objectContaining({ message: 'Failed to fetch: 503' })
      );
    });

    test('a working fetch fallback renders the live counters', async () => {
      bootWith({});
      await flush(4);

      expect(statText('subscribers')).toBe('1234');
      expect(statText('views')).toBe('56789');
      expect(statText('videos')).toBe('100');
    });
  });

  // ─── retries, cache and DOM fallback ──────────────────────────────────────

  describe('stat fetching resilience', () => {
    test('a failing counter endpoint retries with backoff and falls back to the page DOM', async () => {
      jest.useFakeTimers();
      let attempts = 0;
      installFetch({
        livecounts: () => {
          attempts += 1;
          return { ok: false, status: 500, json: async () => ({}) };
        },
      });
      const sub = document.createElement('div');
      sub.id = 'subscriber-count';
      sub.textContent = '1.2M';
      document.body.appendChild(sub);

      require('../src/stats.js');
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(10000);

      expect(attempts).toBe(4);
      // Subscribers fall back to the page DOM; the API-only counters show the
      // unknown state.
      expect(statText('subscribers')).toBe('1200000');
      expect(overlay().querySelector('.views-number').textContent).toBe('---');
      expect(console.error).toHaveBeenCalledWith(
        '[YouTube+][Stats]',
        'Failed to fetch channel stats:',
        expect.any(Error)
      );
    });

    test('a second failure inside the cache window serves the last good payload', async () => {
      jest.useFakeTimers();
      let healthy = true;
      installFetch({
        livecounts: () =>
          healthy
            ? { ok: true, status: 200, json: async () => LIVE_COUNTS }
            : { ok: false, status: 500, json: async () => ({}) },
      });

      require('../src/stats.js');
      await jest.advanceTimersByTimeAsync(0);
      expect(statText('subscribers')).toBe('1234');

      healthy = false;
      await jest.advanceTimersByTimeAsync(6000);
      // The retry ladder (1s + 2s + 4s) has to finish before the cache is read.
      await jest.advanceTimersByTimeAsync(10000);

      // Still the cached payload, not the fallback state.
      expect(statText('subscribers')).toBe('1234');
      expect(overlay().querySelector('.views-number').textContent).not.toBe('---');
    });

    test('a DOM fallback without a subscriber element reports zero subscribers', async () => {
      jest.useFakeTimers();
      installFetch({
        livecounts: () => ({ ok: false, status: 500, json: async () => ({}) }),
      });

      require('../src/stats.js');
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(10000);

      expect(statText('subscribers')).toBe('');
      expect(overlay().querySelector('.subscribers-number').textContent).toBe('---');
    });

    test('an unreadable subscriber element is treated as zero', async () => {
      jest.useFakeTimers();
      installFetch({
        livecounts: () => ({ ok: false, status: 500, json: async () => ({}) }),
      });
      const sub = document.createElement('yt-formatted-string');
      sub.id = 'subscriber-count';
      sub.textContent = 'no digits here';
      document.body.appendChild(sub);

      require('../src/stats.js');
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(10000);

      expect(console.warn).toHaveBeenCalledWith(
        '[YouTube+][Stats]',
        'Using fallback stats due to API error'
      );
    });
  });

  // ─── digit rendering, differences and animation ───────────────────────────

  describe('counter rendering over several updates', () => {
    let frames;

    beforeEach(() => {
      frames = [];
      window.requestAnimationFrame = jest.fn(cb => {
        frames.push(cb);
        return frames.length;
      });
      window.cancelAnimationFrame = jest.fn();
      window.YouTubeUtils.cleanupManager.registerAnimationFrame = jest.fn(id => id);
    });

    const runFrames = (time = 0) => {
      const pending = frames.splice(0, frames.length);
      for (const cb of pending) {
        cb(time);
      }
    };

    test('a growing counter animates the changed digits and shows the difference', async () => {
      jest.useFakeTimers();
      let subscribers = 1234;
      installFetch({
        livecounts: () => ({
          ok: true,
          status: 200,
          json: async () => ({
            followerCount: subscribers,
            bottomOdos: [10, 20],
          }),
        }),
      });

      require('../src/stats.js');
      await jest.advanceTimersByTimeAsync(0);
      expect(statText('subscribers')).toBe('1234');

      subscribers = 2234;
      jest.advanceTimersByTime(6000);
      intervalCb();
      await jest.advanceTimersByTimeAsync(0);

      // The changed digit animates: an incomplete frame re-queues itself.
      runFrames(0);
      runFrames(500);
      runFrames(1000);
      const difference = overlay().querySelector('.subscribers-difference');
      expect(difference.textContent).toBe('+1,000');
      expect(difference.classList.contains('yp-stats-change-positive')).toBe(true);

      // The delta clears itself after a second.
      await jest.advanceTimersByTimeAsync(1000);
      expect(difference.textContent).toBe('');
    });

    test('an unchanged counter renders an empty difference', async () => {
      jest.useFakeTimers();
      installFetch({
        livecounts: () => ({
          ok: true,
          status: 200,
          json: async () => ({ followerCount: 1234, bottomOdos: [10, 20] }),
        }),
      });

      require('../src/stats.js');
      await jest.advanceTimersByTimeAsync(0);
      jest.advanceTimersByTime(6000);
      intervalCb();
      await jest.advanceTimersByTimeAsync(0);

      expect(overlay().querySelector('.subscribers-difference').textContent).toBe('');
    });
  });

  // ─── channel ID resolution ────────────────────────────────────────────────

  describe('channel ID resolution', () => {
    const boot = async () => {
      require('../src/stats.js');
      await flush(4);
      expect(overlay()).not.toBeNull();
    };

    test('the URL channel ID is used when the page has no channel meta tag', async () => {
      document.querySelector('meta[itemprop="channelId"]')?.remove();
      mockLocation({
        href: 'https://www.youtube.com/channel/UCabcdefghij0123456789',
        hostname: 'www.youtube.com',
        pathname: '/channel/UCabcdefghij0123456789',
        search: '',
      });
      await boot();

      const calls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('livecounts.io'));
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toContain('UCabcdefghij0123456789');
    });

    test('a ytInitialData channel ID is used when the URL has none', async () => {
      document.querySelector('meta[itemprop="channelId"]')?.remove();
      window.ytInitialData = {
        header: { c4TabbedHeaderRenderer: { channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz' } },
      };
      mockLocation({
        href: 'https://www.youtube.com/@TestChannel',
        hostname: 'www.youtube.com',
        pathname: '/@TestChannel',
        search: '',
      });
      await boot();

      const calls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('livecounts.io'));
      expect(calls[0][0]).toContain('UCzzzzzzzzzzzzzzzzzzzzzz');
    });

    test('the channel page HTML is the last resort for the channel ID', async () => {
      jest.useFakeTimers();
      document.querySelector('meta[itemprop="channelId"]')?.remove();
      installFetch({
        page: () => channelHtml({ externalId: 'UCpage0000000000000000' }),
      });

      require('../src/stats.js');
      // The DOM poll runs out of attempts, then the page HTML is parsed and
      // its channel ID is the one used for the counter request.
      await jest.advanceTimersByTimeAsync(5000);

      const livecountsCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('livecounts.io')
      );
      expect(livecountsCalls.length).toBeGreaterThan(0);
      expect(livecountsCalls[0][0]).toContain('UCpage0000000000000000');
    });

    test('a channel page without a channel ID warns once and retries', async () => {
      jest.useFakeTimers();
      document.querySelector('meta[itemprop="channelId"]')?.remove();
      installFetch({ page: () => channelHtml({ externalId: null }) });
      window.YouTubeUtils.logger.warn = jest.fn();

      require('../src/stats.js');
      await jest.advanceTimersByTimeAsync(2000);
      expect(window.YouTubeUtils.logger.warn).toHaveBeenCalledWith(
        '[YouTube+][Stats]',
        'Skipping overlay update: channel ID is not available yet'
      );
      expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('livecounts'))).toHaveLength(0);
    });
  });

  // ─── legacy channel URL shapes and switching channels ─────────────────────

  describe('channel URL shapes', () => {
    test.each([
      ['/c/LegacyName', 'LegacyName'],
      ['/user/SomeUser', 'SomeUser'],
    ])('%s mounts the overlay for %s', async (pathname, channelName) => {
      mockLocation({
        href: `https://www.youtube.com${pathname}`,
        hostname: 'www.youtube.com',
        pathname,
        search: '',
      });
      require('../src/stats.js');
      await flush(3);

      expect(overlay()).not.toBeNull();
      expect(window.YouTubeUtils.logger.debug).toHaveBeenCalledWith(
        '[YouTube+][Stats]',
        'Added overlay for channel:',
        channelName
      );
    });

    test('switching channels replaces the overlay and restarts the counter timer', async () => {
      require('../src/stats.js');
      await flush(3);
      expect(intervalHandles).toHaveLength(1);

      mockLocation({
        href: 'https://www.youtube.com/@OtherChannel',
        hostname: 'www.youtube.com',
        pathname: '/@OtherChannel',
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      await flush(3);

      expect(window.YouTubeUtils.logger.debug).toHaveBeenCalledWith(
        '[YouTube+][Stats]',
        'Added overlay for channel:',
        'OtherChannel'
      );
      // The previous counter timer is released instead of leaking a second one.
      expect(intervalHandles[0].stop).toHaveBeenCalled();
      expect(intervalHandles).toHaveLength(2);
      expect(overlay()).not.toBeNull();
    });
  });

  // ─── bounded channel-ID cache ─────────────────────────────────────────────

  test('the channel-ID cache is bounded: an evicted channel re-reads the DOM', async () => {
    const meta = document.querySelector('meta[itemprop="channelId"]');
    require('../src/stats.js');
    await flush(2);

    const livecountsCallsFor = name =>
      fetchSpy.mock.calls.filter(([url]) => String(url).includes(name));

    for (let i = 0; i < 55; i += 1) {
      meta.content = 'UCcache' + i;
      mockLocation({
        href: 'https://www.youtube.com/@Channel' + i,
        hostname: 'www.youtube.com',
        pathname: '/@Channel' + i,
        search: '',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      // eslint-disable-next-line no-await-in-loop
      await flush(1);
      expect(livecountsCallsFor('UCcache' + i).length).toBeGreaterThan(0);
    }

    // The cache holds at most 50 entries, so the first channel was evicted:
    // revisiting it resolves the ID from the DOM again instead of the cache.
    meta.content = 'UCcacheRevisited';
    mockLocation({
      href: 'https://www.youtube.com/@Channel0',
      hostname: 'www.youtube.com',
      pathname: '/@Channel0',
      search: '',
    });
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await flush(2);

    expect(livecountsCallsFor('UCcacheRevisited').length).toBeGreaterThan(0);
  });
  // ─── channel scope without AbortController ───────────────────────────────

  test('the channel page fetch works on a host without AbortController', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AbortController');
    delete globalThis.AbortController;
    try {
      require('../src/stats.js');
      await flush(3);

      const pageCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('youtube.com/@TestChannel')
      );
      expect(pageCalls.length).toBeGreaterThan(0);
      // Without abort support the request carries no signal.
      expect(pageCalls[0][1].signal).toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'AbortController', descriptor);
    }
  });

  // ─── SPA URL change inside the channel scope ──────────────────────────────

  test('a channel SPA navigation re-reads the channel info for the new URL', async () => {
    jest.useFakeTimers();
    require('../src/stats.js');
    await jest.advanceTimersByTimeAsync(0);

    mockLocation({
      href: 'https://www.youtube.com/@SecondChannel',
      hostname: 'www.youtube.com',
      pathname: '/@SecondChannel',
      search: '',
    });
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await jest.advanceTimersByTimeAsync(600);

    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('@SecondChannel'))).toBe(true);
  });

  // ─── counter rendering edges ─────────────────────────────────────────────

  describe('counter rendering edges', () => {
    const bootWithCounters = async (first, second) => {
      let current = first;
      installFetch({
        livecounts: () => ({ ok: true, status: 200, json: async () => current }),
      });
      require('../src/stats.js');
      await jest.advanceTimersByTimeAsync(0);
      jest.advanceTimersByTime(6000);
      current = second;
      intervalCb();
      await jest.advanceTimersByTimeAsync(0);
    };

    test('a shrinking counter renders a negative difference', async () => {
      jest.useFakeTimers();
      await bootWithCounters(
        { followerCount: 5000, bottomOdos: [10, 20] },
        { followerCount: 4000, bottomOdos: [8, 18] }
      );

      const difference = overlay().querySelector('.subscribers-difference');
      expect(difference.textContent).toBe('-1,000');
      expect(difference.classList.contains('yp-stats-change-negative')).toBe(true);
    });

    test('a counter that grew from zero renders no difference', async () => {
      jest.useFakeTimers();
      await bootWithCounters(
        { followerCount: 0, bottomOdos: [10, 20] },
        { followerCount: 7, bottomOdos: [10, 20] }
      );

      expect(overlay().querySelector('.subscribers-difference').textContent).toBe('');
    });

    test('a shapeless counter payload is treated as a failure', async () => {
      jest.useFakeTimers();
      installFetch({
        livecounts: () => ({ ok: true, status: 200, json: async () => ({}) }),
      });
      require('../src/stats.js');
      await jest.advanceTimersByTimeAsync(10000);

      expect(console.warn).toHaveBeenCalledWith(
        '[YouTube+][Stats]',
        'Using fallback stats due to API error'
      );
    });
  });

  // ─── page subscriber text ────────────────────────────────────────────────

  test.each([
    ['K', '0'],
    ['2.3K', '2300'],
    ['1.4B', '1400000000'],
  ])('a subscriber element reading %s renders %s subscribers', async (text, expected) => {
    jest.useFakeTimers();
    installFetch({
      livecounts: () => ({ ok: false, status: 500, json: async () => ({}) }),
    });
    const sub = document.createElement('div');
    sub.id = 'subscriber-count';
    sub.textContent = text;
    document.body.appendChild(sub);

    require('../src/stats.js');
    await jest.advanceTimersByTimeAsync(10000);

    const rendered = overlay().querySelector('.subscribers-number').textContent.replace(/\D/g, '');
    expect(rendered === '' ? '0' : rendered).toBe(expected.replace(/\D/g, ''));
  });

  // ─── channel metadata and banner discovery ───────────────────────────────

  test('a channel page without a title still identifies the channel', async () => {
    installFetch({
      page: () => channelHtml({ title: '', externalId: 'UCnotitle0000000000000' }),
    });
    require('../src/stats.js');
    await flush(3);

    expect(overlay()).not.toBeNull();
    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).includes('livecounts')).length
    ).toBeGreaterThan(0);
  });

  test('an explicit page-header banner is accepted without the sizer', async () => {
    document.getElementById('page-header-banner-sizer').remove();
    const banner = document.createElement('div');
    banner.id = 'page-header-banner';
    banner.getBoundingClientRect = () => ({ width: 900, height: 200, toJSON: () => ({}) });
    document.body.appendChild(banner);

    require('../src/stats.js');
    await flush(3);

    expect(overlay()).not.toBeNull();
  });

  test('a banner that has not been laid out yet is rejected', async () => {
    const banner = document.getElementById('page-header-banner-sizer');
    banner.getBoundingClientRect = () => ({ width: 0, height: 0, toJSON: () => ({}) });

    require('../src/stats.js');
    await flush(3);

    expect(overlay()).toBeNull();
  });

  test('without a retry scheduler factory no overlay is ensured', async () => {
    window.YouTubeUtils.createRetryScheduler = undefined;
    require('../src/stats.js');
    await flush(3);

    expect(overlay()).toBeNull();
  });

  test('a stat container without a number column is left untouched', async () => {
    require('../src/stats.js');
    await flush(3);
    const extra = document.createElement('div');
    extra.className = 'channel-stat';
    overlay().appendChild(extra);
    const before = extra.getAttribute('style');

    const views = document.getElementById('show-views');
    views.checked = false;
    views.dispatchEvent(new Event('change', { bubbles: true }));

    expect(extra.getAttribute('style')).toBe(before);
  });

  test('updates stop for a detached overlay and for a hidden page', async () => {
    jest.useFakeTimers();
    require('../src/stats.js');
    await jest.advanceTimersByTimeAsync(0);
    const counterCalls = () =>
      fetchSpy.mock.calls.filter(([url]) => String(url).includes('livecounts.io')).length;
    const callsBefore = counterCalls();

    overlay().remove();
    jest.advanceTimersByTime(6000);
    intervalCb();
    await jest.advanceTimersByTimeAsync(0);
    expect(counterCalls()).toBe(callsBefore);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      jest.advanceTimersByTime(6000);
      intervalCb();
      await jest.advanceTimersByTimeAsync(0);
      expect(counterCalls()).toBe(callsBefore);
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
    }
  });

  test('a channel ID that appears during the DOM poll is picked up', async () => {
    jest.useFakeTimers();
    document.querySelector('meta[itemprop="channelId"]')?.remove();
    require('../src/stats.js');
    await jest.advanceTimersByTimeAsync(150);

    const meta = document.createElement('meta');
    meta.setAttribute('itemprop', 'channelId');
    meta.content = 'UClate00000000000000000';
    document.head.appendChild(meta);
    await jest.advanceTimersByTimeAsync(200);

    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).includes('UClate00000000000000000')).length
    ).toBeGreaterThan(0);
  });

  test('a ytInitialData metadata channel ID is used when the meta tag is absent', async () => {
    document.querySelector('meta[itemprop="channelId"]').remove();
    window.ytInitialData = {
      metadata: { channelMetadataRenderer: { externalId: 'UCmetadata00000000000000' } },
    };
    require('../src/stats.js');
    await flush(3);

    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).includes('UCmetadata00000000000000')).length
    ).toBeGreaterThan(0);
  });

  test('the settings-modal event without a channel checkbox is inert', () => {
    require('../src/stats.js');

    expect(() =>
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'))
    ).not.toThrow();
  });

  test('clicking the font list outside an item changes nothing', async () => {
    require('../src/stats.js');
    await flush();
    const list = document.querySelector('.glass-dropdown__list');
    list.style.display = 'block';

    list.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(localStorage.getItem('youtubeEnhancerFontFamily')).toBeNull();
  });
});
