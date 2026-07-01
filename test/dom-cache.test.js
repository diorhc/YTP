/**
 * Unit tests for src/dom-cache.js (the canonical DOM query cache).
 * Covers the querySelector caching, TTL-based invalidation when
 * elements leave the DOM, the getElementById null-result TTL, the
 * maxAge live-element window, and the waitForElement resolver.
 */

describe('YouTubeDOMCache', () => {
  /** @type {any} */
  let cache;
  /** @type {((mutations: MutationRecord[]) => void) | null} */
  let mutationCallback = null;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusDOMCache;
    delete window.YouTubeUtils;
    delete window.unsafeWindow;
    delete window.YouTubePlusMutationCoordinator;
    delete window.YouTubePlusCleanupManager;
    window.YouTubeUtils = {};
    // The dom-cache wait path subscribes to a shared
    // MutationCoordinator. Stub it so we can manually fire the
    // subscription callback when a test wants to simulate a DOM
    // mutation. jsdom's MutationObserver works but the rAF-based
    // flush inside the cache means the test would otherwise need
    // a 16ms+ wait AND a real DOM mutation; explicit triggering
    // keeps the test deterministic.
    mutationCallback = null;
    window.YouTubePlusMutationCoordinator = {
      subscribeRoot: (_id, cb) => {
        mutationCallback = cb;
        return 'sub-id';
      },
    };
    require('../src/dom-cache.js');
    cache = window.YouTubePlusDOMCache;
    // Start from a clean DOM each test.
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  afterEach(() => {
    try {
      cache.destroy();
    } catch (_e) {
      void _e;
    }
  });

  test('querySelector caches results so the second call is a hit', () => {
    const el = document.createElement('div');
    el.id = 'cached-el';
    document.body.appendChild(el);

    cache.getStats();
    const initialHits = cache.stats.hits;
    const initialMisses = cache.stats.misses;

    const first = cache.querySelector('#cached-el');
    const second = cache.querySelector('#cached-el');

    expect(first).toBe(el);
    expect(second).toBe(el);
    expect(cache.stats.misses).toBe(initialMisses + 1);
    expect(cache.stats.hits).toBe(initialHits + 1);
  });

  test('Cache invalidates when element leaves the DOM (isConnected = false)', () => {
    const el = document.createElement('div');
    el.id = 'transient';
    document.body.appendChild(el);

    expect(cache.querySelector('#transient')).toBe(el);

    el.remove();

    // The cached entry is stale (element disconnected). The next
    // querySelector must re-query the DOM and miss.
    expect(cache.querySelector('#transient')).toBeNull();
  });

  test('getElementById null result uses the shorter nullMaxAge, not maxAge', () => {
    jest.useFakeTimers();
    try {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(0);
      expect(cache.getElementById('missing-el')).toBeNull();

      const spy = jest.spyOn(document, 'getElementById');
      // 1.5s later: past nullMaxAge (1s) but inside maxAge (5s).
      // With the shorter TTL on null entries, the next lookup
      // re-queries the DOM.
      nowSpy.mockReturnValue(1500);
      cache.getElementById('missing-el');
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
      nowSpy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  test('Live-element cache respects maxAge (5s)', () => {
    jest.useFakeTimers();
    try {
      const el = document.createElement('div');
      el.id = 'stable';
      document.body.appendChild(el);

      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(0);
      expect(cache.getElementById('stable')).toBe(el);

      const spy = jest.spyOn(document, 'getElementById');
      // 2s later: well inside maxAge (5s), so the cached element
      // is returned without another DOM query.
      nowSpy.mockReturnValue(2000);
      const ref = cache.getElementById('stable');
      expect(ref).toBe(el);
      expect(spy).not.toHaveBeenCalled();

      spy.mockRestore();
      nowSpy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  test('waitForElement resolves when the element appears in the DOM', async () => {
    const promise = cache.waitForElement('#late', 2000);
    // The element doesn't exist yet; the promise must stay pending.
    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await new Promise(r => setTimeout(r, 30));
    expect(settled).toBe(false);

    // Now insert the element. The root-context wait path uses the
    // shared MutationObserver subscription on YouTubePlusMutationCoordinator;
    // simulate the mutation by manually firing the subscribed callback.
    const el = document.createElement('div');
    el.id = 'late';
    document.body.appendChild(el);

    if (mutationCallback) {
      mutationCallback([]);
    }

    const result = await promise;
    expect(result).toBe(el);
  });

  test('getStats reports size and enabled state', () => {
    const el = document.createElement('div');
    el.id = 'sized';
    document.body.appendChild(el);
    cache.querySelector('#sized');

    const stats = cache.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.size).toBeGreaterThanOrEqual(1);
  });

  test('invalidate() drops the matching entry so the next lookup re-queries', () => {
    const el = document.createElement('div');
    el.id = 'inv';
    document.body.appendChild(el);

    expect(cache.querySelector('#inv')).toBe(el);
    cache.invalidate('#inv');
    // Cache miss after invalidate.
    const hitsBefore = cache.stats.hits;
    cache.querySelector('#inv');
    expect(cache.stats.hits).toBe(hitsBefore);
  });

  test('skipCache forces a fresh querySelector even for cached selectors', () => {
    const el = document.createElement('div');
    el.id = 'fresh';
    document.body.appendChild(el);

    const first = cache.querySelector('#fresh');
    const second = cache.querySelector('#fresh', document, true);
    expect(first).toBe(el);
    expect(second).toBe(el);
  });

  test('querySelectorAll does not indefinitely cache empty results', () => {
    // 1. Initial query when element is not present.
    const emptyResult = cache.querySelectorAll('.dynamic-item');
    expect(emptyResult).toEqual([]);

    // 2. Append elements to the DOM.
    const el1 = document.createElement('div');
    el1.className = 'dynamic-item';
    const el2 = document.createElement('div');
    el2.className = 'dynamic-item';
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    // 3. Query again. Should not return cached empty array, but query the DOM.
    const result = cache.querySelectorAll('.dynamic-item');
    expect(result).toEqual([el1, el2]);
  });
});
