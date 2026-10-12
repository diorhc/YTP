/**
 * Unit tests for src/dom-cache.js (the canonical DOM query cache).
 * Covers the querySelector caching, TTL-based invalidation when
 * elements leave the DOM, the getElementById null-result TTL, the
 * maxAge live-element window, and the waitForElement resolver.
 */

const loadRealDeps = () => {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
};

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
    loadRealDeps();
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

  test('clearNull() removes only cached null entries', () => {
    const live = document.createElement('div');
    live.id = 'live-null-test';
    document.body.appendChild(live);

    expect(cache.querySelector('#live-null-test')).toBe(live);
    expect(cache.querySelector('#missing-null-test')).toBeNull();

    const statsBefore = cache.getStats();
    cache.clearNull();

    // The null entry is gone, the live entry remains.
    expect(cache.getStats().size).toBe(statsBefore.size - 1);
    expect(cache.querySelector('#live-null-test')).toBe(live);
  });

  test('abortAllWaits() resolves pending waitForElement with null', async () => {
    const promise = cache.waitForElement('#aborted-el', 5000);

    let settledValue = 'pending';
    promise.then(v => {
      settledValue = v;
    });

    await new Promise(r => setTimeout(r, 10));
    cache.abortAllWaits();

    const result = await promise;
    expect(result).toBeNull();
    expect(settledValue).toBeNull();
    expect(cache.pendingWaits.size).toBe(0);
  });

  test('waitForElement respects an external AbortSignal', async () => {
    const controller = new AbortController();
    const promise = cache.waitForElement('#external-abort-el', 5000, document, controller.signal);

    controller.abort();

    const result = await promise;
    expect(result).toBeNull();
    expect(cache.pendingWaits.size).toBe(0);
  });

  test('removing a middle element updates the querySelectorAll result', () => {
    const items = ['a', 'b', 'c'].map(id => {
      const el = document.createElement('div');
      el.className = 'item';
      el.id = id;
      document.body.appendChild(el);
      return el;
    });
    expect(cache.querySelectorAll('.item')).toEqual(items);

    items[1].remove();
    const d = document.createElement('div');
    d.className = 'item';
    d.id = 'd';
    document.body.appendChild(d);

    // The old first/last validation kept returning [a,b,c] here.
    expect(cache.querySelectorAll('.item')).toEqual([items[0], items[2], d]);
  });

  test('reordering the list updates the querySelectorAll result', () => {
    const items = ['a', 'b', 'c'].map(id => {
      const el = document.createElement('div');
      el.className = 'item';
      el.id = id;
      document.body.appendChild(el);
      return el;
    });
    expect(cache.querySelectorAll('.item')).toEqual(items);

    // Move first element to the end: [b, c, a].
    document.body.appendChild(items[0]);

    expect(cache.querySelectorAll('.item')).toEqual([items[1], items[2], items[0]]);
  });

  test('element that changed class no longer answers the old selector', () => {
    const el = document.createElement('div');
    el.className = 'foo';
    document.body.appendChild(el);
    expect(cache.querySelector('.foo')).toBe(el);

    el.className = 'bar';

    expect(cache.querySelector('.foo')).toBeNull();
    expect(cache.querySelector('.bar')).toBe(el);
  });

  test('element that changed id no longer answers the old id', () => {
    const el = document.createElement('div');
    el.id = 'renamed';
    document.body.appendChild(el);
    expect(cache.getElementById('renamed')).toBe(el);

    el.id = 'other';

    expect(cache.getElementById('renamed')).toBeNull();
    expect(cache.getElementById('other')).toBe(el);
  });

  test('replacing the context element re-queries from scratch', () => {
    const ctx1 = document.createElement('div');
    const inner = document.createElement('span');
    inner.className = 'leaf';
    ctx1.appendChild(inner);
    document.body.appendChild(ctx1);
    expect(cache.querySelector('.leaf', ctx1)).toBe(inner);

    const ctx2 = document.createElement('div');
    document.body.appendChild(ctx2);

    expect(cache.querySelector('.leaf', ctx2)).toBeNull();
    // The old context entry is still valid for its own context.
    expect(cache.querySelector('.leaf', ctx1)).toBe(inner);
  });
});

describe('load-order regression (real build order)', () => {
  test('coordinator subscription attaches after coordinator loads, not only at construction', () => {
    jest.resetModules();
    delete window.YouTubePlusDOMCache;
    delete window.YouTubeUtils;
    delete window.YouTubePlusMutationCoordinator;
    loadRealDeps();

    // build.order.json: dom-cache.js (pos 6) loads BEFORE
    // mutation-coordinator.js (pos 7). At construction the
    // coordinator does not exist yet; the subscription must not
    // be silently left null forever.
    require('../src/dom-cache.js');
    const cache = window.YouTubePlusDOMCache;
    expect(cache.cleanupSubId).toBeNull();

    window.YouTubePlusMutationCoordinator = {
      subscribeRoot: (id, cb) => {
        expect(id).toBe('dom-cache::cleanup');
        expect(typeof cb).toBe('function');
        return 'late-sub';
      },
      unsubscribe: jest.fn(),
    };

    const el = document.createElement('div');
    el.id = 'late-order';
    document.body.appendChild(el);

    // A normal query self-heals the attachment.
    expect(cache.querySelector('#late-order')).toBe(el);
    expect(cache.cleanupSubId).toBe('late-sub');

    // destroy() unsubscribes through the same lifecycle.
    cache.destroy();
    expect(window.YouTubePlusMutationCoordinator.unsubscribe).toHaveBeenCalledWith('late-sub');
    expect(cache.cleanupSubId).toBeNull();

    delete window.YouTubePlusDOMCache;
    delete window.YouTubePlusMutationCoordinator;
  });

  test('waitForElement does not leak abort listener in CleanupManager', async () => {
    delete window.YouTubePlusDOMCache;
    delete window.YouTubePlusCleanupManager;
    loadRealDeps();
    require('../src/dom-cache.js');
    const cache = window.YouTubePlusDOMCache;
    const cm = window.YouTubePlusCleanupManager;

    const listenersBefore = cm.listeners.size;

    const controller = new AbortController();
    const promise = cache.waitForElement('#non-existent-test-el', 100, document, controller.signal);
    controller.abort();
    await promise;

    // After abort and resolution, CleanupManager must not retain any listener entry
    expect(cm.listeners.size).toBe(listenersBefore);
  });

  describe('DOMCache branch coverage additions', () => {
    let cache;
    beforeEach(() => {
      document.body.innerHTML = '';
      document.head.innerHTML = '';
      loadRealDeps();
      if (!window.YouTubePlusDOMCache) {
        require('../src/dom-cache.js');
      }
      cache = window.YouTubePlusDOMCache;
    });

    test('covers aliases query, queryAll, byId, get, getAll', () => {
      const el = document.createElement('div');
      el.id = 'alias-el';
      el.className = 'alias-class';
      document.body.appendChild(el);

      expect(cache.query('#alias-el')).toBe(el);
      expect(cache.queryAll('.alias-class')).toEqual([el]);
      expect(cache.byId('alias-el')).toBe(el);
      expect(cache.get('#alias-el')).toBe(el);
      expect(cache.getAll('.alias-class')).toEqual([el]);
    });

    test('covers disabled cache for querySelector and getElementById', () => {
      const el = document.createElement('div');
      el.id = 'disabled-el';
      document.body.appendChild(el);

      cache.enabled = false;
      expect(cache.querySelector('#disabled-el')).toBe(el);
      expect(cache.getElementById('disabled-el')).toBe(el);
      cache.enabled = true;
    });

    test('covers cache eviction when maxSize is reached for getElementById and querySelector', () => {
      cache.maxSize = 2;
      const el1 = document.createElement('div');
      el1.id = 'evict-1';
      const el2 = document.createElement('div');
      el2.id = 'evict-2';
      const el3 = document.createElement('div');
      el3.id = 'evict-3';
      document.body.append(el1, el2, el3);

      cache.getElementById('evict-1');
      cache.getElementById('evict-2');
      expect(cache.cache.size).toBe(2);

      // 3rd element triggers eviction
      cache.getElementById('evict-3');
      expect(cache.stats.evictions).toBeGreaterThan(0);

      // Now with querySelector
      cache.cache.clear();
      cache.querySelector('#evict-1');
      cache.querySelector('#evict-2');
      cache.querySelector('#evict-3');
      expect(cache.stats.evictions).toBeGreaterThan(1);
    });

    test('covers invalidate() without arguments calling clear()', () => {
      const el = document.createElement('div');
      el.id = 'inv-el';
      document.body.appendChild(el);
      cache.querySelector('#inv-el');
      expect(cache.cache.size).toBeGreaterThan(0);

      cache.invalidate();
      expect(cache.cache.size).toBe(0);
    });

    test('covers _isEntryFresh branches for null result, shadowing, and context changes', () => {
      // 1. Cached null that now succeeds
      const missingId = 'not-in-dom-yet';
      const nullRes = cache.querySelector(`#${missingId}`);
      expect(nullRes).toBeNull();
      const cacheKey = `#${missingId}::${cache.getContextUid(document)}`;
      const entry = cache.cache.get(cacheKey);
      expect(entry).toBeDefined();

      // Before inserting, _isEntryFresh is true
      expect(cache._isEntryFresh(entry)).toBe(true);

      // Insert element with that ID -> _isEntryFresh must become false (lookup now succeeds)
      const newEl = document.createElement('div');
      newEl.id = missingId;
      document.body.appendChild(newEl);
      expect(cache._isEntryFresh(entry)).toBe(false);

      // 2. Element moved out of context
      const containerA = document.createElement('div');
      const containerB = document.createElement('div');
      const child = document.createElement('span');
      child.className = 'moving-child';
      containerA.appendChild(child);
      document.body.append(containerA, containerB);

      cache.querySelector('.moving-child', containerA);
      const entryChild = cache.cache.get(`.moving-child::${cache.getContextUid(containerA)}`);
      expect(entryChild).toBeDefined();
      expect(cache._isEntryFresh(entryChild)).toBe(true);

      // Move child to containerB
      containerB.appendChild(child);
      expect(cache._isEntryFresh(entryChild)).toBe(false);

      // 3. Shadowing: new earlier match in context
      const list = document.createElement('ul');
      const item2 = document.createElement('li');
      item2.className = 'item';
      item2.textContent = 'second';
      list.appendChild(item2);
      document.body.appendChild(list);

      cache.querySelector('.item', list);
      const entryItem = cache.cache.get(`.item::${cache.getContextUid(list)}`);
      expect(entryItem).toBeDefined();
      expect(cache._isEntryFresh(entryItem)).toBe(true);

      // Prepend an earlier match
      const item1 = document.createElement('li');
      item1.className = 'item';
      item1.textContent = 'first';
      list.insertBefore(item1, item2);
      // Now _isEntryFresh must be false because item2 is shadowed by item1
      expect(cache._isEntryFresh(entryItem)).toBe(false);
    });

    test('covers HTML element isElementInDOM and queryFirst error handling', () => {
      expect(cache.isElementInDOM(document.documentElement)).toBe(true);

      // Invalid selector syntax in _queryFirst triggers catch
      const badEntry = { selector: ':::invalid:::', context: document, timestamp: Date.now() };
      expect(cache._queryFirst(badEntry)).toBeNull();
    });

    test('covers _isInContext with custom context without contains method', () => {
      const el = document.createElement('div');
      const fakeRoot = { getRootNode: () => fakeRoot };
      el.getRootNode = () => fakeRoot;
      expect(cache._isInContext(el, fakeRoot)).toBe(true);

      const otherRoot = {};
      expect(cache._isInContext(el, otherRoot)).toBe(false);
      expect(cache._isInContext(null, fakeRoot)).toBe(false);
    });

    test('covers mutationCallback triggering revalidate via requestIdleCallback/setTimeout', () => {
      jest.useFakeTimers();
      let cb = null;
      window.YouTubePlusMutationCoordinator = {
        subscribeRoot: (_id, callback) => {
          cb = callback;
          return 'mock-cleanup-sub';
        },
        unsubscribe: jest.fn(),
      };
      cache.cleanupSubId = null;
      cache.startCleanup();
      if (cb) {
        cb([]);
        jest.runAllTimers();
      }
      jest.useRealTimers();
    });

    test('covers YouTubeUtils.waitForElement, scoped context retry scheduling, and playlist polling', async () => {
      // 1. YouTubeUtils.waitForElement legacy delegate
      const target = document.createElement('div');
      target.id = 'utils-wait-target';
      document.body.appendChild(target);
      const res1 = await window.YouTubeUtils.waitForElement('#utils-wait-target', 100);
      expect(res1).toBe(target);

      // 2. Scoped context wait with retry factory and abort
      const fakeRetry = { stop: jest.fn() };
      window.YouTubePlusMutationCoordinator = {
        subscribeRoot: jest.fn(),
        createRetryScheduler: jest.fn(opts => {
          opts.check();
          return fakeRetry;
        }),
      };
      const container = document.createElement('div');
      const child = document.createElement('span');
      child.className = 'scoped-wait-child';
      container.appendChild(child);
      const res2 = await cache.waitForElement('.scoped-wait-child', 100, container);
      expect(res2).toBe(child);

      // 3. Scoped context wait abort
      const ctrl = new AbortController();
      const p3 = cache.waitForElement('.never-found', 100, container, ctrl.signal);
      ctrl.abort();
      const res3 = await p3;
      expect(res3).toBeNull();

      // 4. Playlist root wait path via pollUntil
      jest.useFakeTimers();
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/playlist',
        href: 'https://www.youtube.com/playlist?list=test',
      });
      const plWait = cache.waitForElement('#pl-target-missing', 100);
      jest.advanceTimersByTime(500);
      const res4 = await plWait;
      expect(res4).toBeNull();

      // Poll until finds element
      const plFound = document.createElement('div');
      plFound.id = 'pl-found-el';
      const plPromise = cache.waitForElement('#pl-found-el', 500);
      document.body.appendChild(plFound);
      jest.advanceTimersByTime(500);
      const resFound = await plPromise;
      expect(resFound).toBe(plFound);

      // Poll until abort
      const plCtrl = new AbortController();
      const plAbortPromise = cache.waitForElement('#pl-abort-el', 500, document, plCtrl.signal);
      plCtrl.abort();
      jest.advanceTimersByTime(500);
      const resAbort = await plAbortPromise;
      expect(resAbort).toBeNull();

      // Fallback timeout without cleanupManager.timeout on /watch
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch?v=test',
      });
      const oldTimeout = window.YouTubeUtils.cleanupManager.timeout;
      delete window.YouTubeUtils.cleanupManager.timeout;
      const fallbackP = cache.waitForElement('#fallback-timeout-el', 50);
      jest.advanceTimersByTime(500);
      await fallbackP;
      window.YouTubeUtils.cleanupManager.timeout = oldTimeout;

      jest.useRealTimers();

      // 5. Pre-aborted signal
      const ab = new AbortController();
      ab.abort();
      const res5 = await cache.waitForElement('#none', 100, document, ab.signal);
      expect(res5).toBeNull();

      // 6. Navigation and unload event listeners
      window.dispatchEvent(new Event('yt-navigate-start'));
      window.dispatchEvent(new Event('yt-navigate-finish'));
      window.dispatchEvent(new Event('spfdone'));
      window.dispatchEvent(new Event('beforeunload'));
    });
  });
});
