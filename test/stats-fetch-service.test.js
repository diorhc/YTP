/**
 * @jest-environment jsdom
 */

/**
 * The canonical shared RYD data fetch service
 * (window.YouTubePlusStats.getDislikesData), registered at module scope.
 *
 * Measured metric: network requests per N same-id consumers.
 *   Before (pre-dedupe): N concurrent consumers → N network calls; every
 *   panel re-open → 1 refetch. After: N concurrent → 1 shared call; a
 *   verified aggregate is TTL-cached (panel re-opens reuse it, 0 refetch),
 *   failures/unknown responses are NOT cached (retry on the next action),
 *   and per-consumer abandonment is safe.
 *
 * Shared fetch contract: bounded cache (cap 100 + FIFO eviction + expired sweep),
 * a shared 8s fetch deadline with timer cleanup, and strict number
 * validation — real zeros stay zeros, garbage/strings/HTTP 500/{} never
 * become a zero aggregate (null = unknown).
 */

const fs = require('node:fs');
const path = require('node:path');

const statsJsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'stats.js'), 'utf8');

// The dedupe/TTL implementation must be the measured
// change — the negative security corpus and the deferred idle path stay.
expect(statsJsSource).toContain('inFlightDislikes');
expect(statsJsSource).toContain('dislikesCache');
expect(statsJsSource).toContain('DISLIKES_TTL_MS');
// Bounded cache + deadline implementation.
expect(statsJsSource).toContain('DISLIKES_CACHE_CAP');
expect(statsJsSource).toContain('DISLIKES_FETCH_DEADLINE_MS');
expect(statsJsSource).toContain('evictDislikesCache_');

function installStatsGlobals() {
  if (!window.YouTubePlus) window.YouTubePlus = {};
  // Synchronous idle callback: makes the P8 defer path deterministic under
  // both real and fake timers.
  Object.defineProperty(globalThis, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: fn => fn(),
  });
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      logSuppressed: jest.fn(),
      setSafeHTML: (el, html) => {
        if (el) el.innerHTML = html;
      },
      byId: id => document.getElementById(id),
      $: (selector, root) => (root || document).querySelector(selector),
      $$: (sel, root) => Array.from((root || document).querySelectorAll(sel)),
      t: key => key || '',
      debounce: fn => fn,
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      logError: jest.fn(),
      createWithErrorBoundary: jest.fn(() => fn => fn),
      createRetryScheduler: jest.fn(() => ({ stop: jest.fn() })),
      onDomReady: cb => cb(),
      whenRelevant: jest.fn(({ onEnter }) => onEnter()),
      isSettingsModalOpen: jest.fn(() => false),
      storage: {
        getItem: key => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key, value),
        get: key => localStorage.getItem(key),
        set: (key, value) => localStorage.setItem(key, value),
      },
    },
  });
}

function okJson(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

describe('shared RYD fetch service (dedupe, TTL, bound, deadline)', () => {
  let fetchMock;

  function boot() {
    jest.resetModules();
    installStatsGlobals();
    // The stats module early-returns on its one-time-init guards — reset
    // them per test (same contract as test/stats.test.js).
    delete window.__ytpVideoStatsModuleInit;
    delete window.__ytpChannelStatsModuleInit;
    require('../src/stats.js');
    if (!window.YouTubePlusStats) {
      // The require must not silently leave the facade
      // unset — surface the actual failure instead of a downstream TypeError.
      throw new Error('boot: window.YouTubePlusStats missing after require (module threw)');
    }
    return window.YouTubePlusStats;
  }

  beforeEach(() => {
    installStatsGlobals();
    // Default fixture: no GM transport → the fetch transport + fetch mock.
    // GM transport tests define GM_xmlhttpRequest explicitly.
    delete globalThis.GM_xmlhttpRequest;
    // Real RYD response shape: finite numbers, rating is a float.
    fetchMock = jest.fn(() => Promise.resolve(okJson({ likes: 10, dislikes: 2, rating: 4.9 })));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test('in-flight dedupe: N concurrent same-id consumers share ONE network call', async () => {
    const stats = boot();
    // requestIdleCallback defer path: flush it so the fetch starts.
    await Promise.resolve();

    const consumers = await Promise.all([
      stats.getDislikesData('vid-1'),
      stats.getDislikesData('vid-1'),
      stats.getDislikesData('vid-1'),
    ]);

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('vid-1')).length).toBe(1);
    for (const res of consumers) {
      expect(res).toEqual({ likes: 10, dislikes: 2, rating: 4.9 });
    }
  });

  test('a successful aggregate is TTL-cached — panel re-opens reuse it with 0 refetch', async () => {
    const stats = boot();
    await stats.getDislikesData('vid-1');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('vid-1')).length).toBe(1);

    const reOpened = await stats.getDislikesData('vid-1');
    expect(reOpened).toEqual({ likes: 10, dislikes: 2, rating: 4.9 });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('vid-1')).length).toBe(1);
  });

  test('a failed or partial result is NOT cached as current delivery — the next consumer action retries', async () => {
    fetchMock = jest
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('network down')))
      .mockImplementationOnce(() =>
        Promise.resolve(okJson({ likes: 10, dislikes: 2, rating: 4.9 }))
      );
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    const stats = boot();

    // First consumer action fails — the failure is NOT cached.
    expect(await stats.getDislikesData('vid-1')).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(1);

    // Second consumer action retries and gets the healthy aggregate.
    const retry = await stats.getDislikesData('vid-1');
    expect(retry).toEqual({ likes: 10, dislikes: 2, rating: 4.9 });
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  test('per-consumer abandonment is safe: one consumer forgetting the promise never aborts the shared call', async () => {
    const stats = boot();
    fetchMock = jest.fn(() => Promise.resolve(okJson({ likes: 10, dislikes: 2, rating: 4.9 })));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    // Consumer A awaits; consumer B attaches a no-op catch and abandons —
    // neither can abort the shared in-flight call (per-consumer
    // abandonment safety).
    const awaiting = stats.getDislikesData('vid-1');
    stats.getDislikesData('vid-1').catch(() => {
      /* abandoned promise ignored in test */
    });
    const res = await awaiting;
    expect(res).toEqual({ likes: 10, dislikes: 2, rating: 4.9 });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('vid-1')).length).toBe(1);
  });

  // ── GM transport ──────

  test('GM_xmlhttpRequest transport: a mocked manager response serves the aggregate', async () => {
    const gmCalls = [];
    Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
      configurable: true,
      writable: true,
      value: jest.fn(opts => {
        gmCalls.push(opts.url);
        setTimeout(() => {
          opts.onload({
            status: 200,
            responseText: JSON.stringify({ dislikes: 1234 }),
          });
        }, 10);
      }),
    });
    const stats = boot();

    const res = await stats.getDislikesData('vid-1');
    expect(res).toEqual({ likes: null, dislikes: 1234, rating: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('GM transport: a non-2xx response is unknown, never a zero', async () => {
    Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
      configurable: true,
      writable: true,
      value: jest.fn(opts => {
        setTimeout(() => opts.onload({ status: 503, responseText: '' }), 10);
      }),
    });
    const stats = boot();

    expect(await stats.getDislikesData('vid-1')).toBeNull();
    expect(stats.getDislikesServiceStats().cached).toBe(0);
  });

  test('GM transport: a hung manager response is bounded by the deadline', async () => {
    jest.useFakeTimers();
    Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
      configurable: true,
      writable: true,
      value: jest.fn(() => {
        /* never calls back */
      }),
    });
    const stats = boot();

    const pending = stats.getDislikesData('vid-1');
    await jest.advanceTimersByTimeAsync(1);
    expect(stats.getDislikesServiceStats().inFlight).toBe(1);
    await jest.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toBeNull();
    expect(stats.getDislikesServiceStats().inFlight).toBe(0);
  });

  // ── Zero/unknown distinction ─────────────────────────────────────

  test('real zeros stay zeros: {likes:0, dislikes:0, rating:0} is a verified aggregate', async () => {
    fetchMock = jest.fn(() => Promise.resolve(okJson({ likes: 0, dislikes: 0, rating: 0 })));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const stats = boot();

    const res = await stats.getDislikesData('vid-1');
    expect(res).toEqual({ likes: 0, dislikes: 0, rating: 0 });

    // Zeros are a verified aggregate and are cached (no refetch).
    const again = await stats.getDislikesData('vid-1');
    expect(again).toEqual({ likes: 0, dislikes: 0, rating: 0 });
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  test('invalid fields become null while valid siblings stay visible (partial truth, not full loss)', async () => {
    fetchMock = jest.fn(() => Promise.resolve(okJson({ likes: '10', dislikes: 2, rating: 4.9 })));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const stats = boot();
    // The string likes count is unknown (null); the valid dislikes/rating
    // remain real data — and the aggregate is still cached as known data.
    expect(await stats.getDislikesData('vid-1')).toEqual({
      likes: null,
      dislikes: 2,
      rating: 4.9,
    });
  });

  test('garbage payloads never become a zero or empty success: {}, null, arrays, all-invalid fields', async () => {
    const garbage = [
      {}, // shapeless: no known field at all
      null, // JSON null body
      [10, 2], // bare array
      { likes: 'x', dislikes: {}, rating: null }, // every field invalid
    ];
    for (const payload of garbage) {
      fetchMock = jest.fn(() => Promise.resolve(okJson(payload)));
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      const stats = boot();
      expect(await stats.getDislikesData('vid-1')).toBeNull();
      expect(stats.getDislikesServiceStats().cached).toBe(0);
    }
  });

  test('an HTTP 500 response is unknown, never a zero aggregate — and is not cached', async () => {
    fetchMock = jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 }))
      .mockImplementationOnce(() =>
        Promise.resolve(okJson({ likes: 10, dislikes: 2, rating: 4.9 }))
      );
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const stats = boot();

    expect(await stats.getDislikesData('vid-1')).toBeNull();
    const retry = await stats.getDislikesData('vid-1');
    expect(retry).toEqual({ likes: 10, dislikes: 2, rating: 4.9 });
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  // ── Shared deadline ──────────────────────────────────────────────

  test('a hung response resolves null at the shared deadline and frees the in-flight slot', async () => {
    jest.useFakeTimers();
    fetchMock = jest.fn(
      (_url, opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const stats = boot();

    const pending = stats.getDislikesData('vid-1');
    // The synchronous idle stub lets the fetch start and hang.
    await jest.advanceTimersByTimeAsync(0);
    expect(stats.getDislikesServiceStats().inFlight).toBe(1);

    // The 8s deadline aborts the shared call; every awaiting consumer gets
    // null, and the in-flight slot is freed.
    await jest.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toBeNull();
    expect(stats.getDislikesServiceStats().inFlight).toBe(0);

    // A later consumer action retries (the hung round poisoned nothing).
    fetchMock = jest.fn(() => Promise.resolve(okJson({ likes: 10, dislikes: 2, rating: 4.9 })));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const retry = await stats.getDislikesData('vid-1');
    expect(retry).toEqual({ likes: 10, dislikes: 2, rating: 4.9 });
  });

  // ── Bounded cache ────────────────────────────────────────────────

  test('after 1000 unique IDs the cache never exceeds the cap; expired entries are freed', async () => {
    const stats = boot();
    for (let i = 0; i < 1000; i += 1) {
      await stats.getDislikesData(`vid-${i}`);
    }
    const afterMany = stats.getDislikesServiceStats();
    expect(afterMany.cached).toBeLessThanOrEqual(afterMany.cap);
    expect(afterMany.cap).toBe(100);

    // TTL expiry: shift past the TTL; the next bounded insert sweeps the
    // expired entry (it never lingers until a same-ID re-visit).
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const stats2 = boot();
    const first = stats2.getDislikesData('vid-ttl');
    await jest.advanceTimersByTimeAsync(0);
    await first;
    expect(stats2.getDislikesServiceStats().cached).toBe(1);
    jest.setSystemTime(31000);
    const second = stats2.getDislikesData('vid-ttl-2');
    await jest.advanceTimersByTimeAsync(0);
    await second;
    // The expired vid-ttl entry was swept; only the fresh insert remains.
    expect(stats2.getDislikesServiceStats().cached).toBe(1);
  });

  // ── livecounts counter payload validation ─────────────────────────

  describe('numbersAreValidCounts (livecounts channel counters)', () => {
    test('accepts payloads whose numbers are finite and non-negative', () => {
      const stats = boot();
      expect(typeof stats.numbersAreValidCounts).toBe('function');
      expect(stats.numbersAreValidCounts({ liveSubscriber: 0, liveViews: 12, liveVideos: 3 })).toBe(
        true
      );
      expect(stats.numbersAreValidCounts({ followerCount: 5, bottomOdos: [1, 2] })).toBe(true);
    });

    test('rejects malformed payloads (NaN, negative, non-numeric, shapeless)', () => {
      const stats = boot();
      const badPayloads = [
        null,
        undefined,
        'nope',
        [],
        {},
        { liveSubscriber: Number.NaN },
        { liveViews: -1 },
        { liveSubscriber: '10' },
        { followerCount: 5, bottomOdos: [1, -2] },
      ];
      for (const payload of badPayloads) {
        expect(stats.numbersAreValidCounts(payload)).toBe(false);
      }
    });
  });
});
