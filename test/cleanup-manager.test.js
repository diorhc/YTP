/**
 * Unit tests for src/cleanup-manager.js (the canonical resource
 * lifecycle manager). Covers the register/cleanup lifecycle for
 * observers, listeners, timers, animation frames, and custom
 * callbacks.
 */

describe('YouTubePlusCleanupManager', () => {
  /** @type {any} */
  let cm;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusCleanupManager;
    delete window.YouTubeUtils;
    require('../src/cleanup-manager.js');
    cm = window.YouTubePlusCleanupManager;
  });

  test('register() and cleanup() lifecycle: callbacks fire and clear', () => {
    const cb = jest.fn();
    cm.register(cb);
    cm.cleanup();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('cleanup() empties the callback set so callbacks do not fire twice', () => {
    const cb = jest.fn();
    cm.register(cb);
    cm.cleanup();
    cm.cleanup();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('registerListener() returns a Symbol key and adds the listener', () => {
    const target = document.createElement('div');
    const handler = jest.fn();
    const key = cm.registerListener(target, 'click', handler);

    expect(typeof key).toBe('symbol');

    const event = new Event('click');
    target.dispatchEvent(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('cleanup() removes listeners so they stop firing', () => {
    const target = document.createElement('div');
    const handler = jest.fn();
    cm.registerListener(target, 'click', handler);
    cm.cleanup();

    target.dispatchEvent(new Event('click'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('double cleanup() is safe (idempotent)', () => {
    const cb = jest.fn();
    cm.register(cb);
    cm.cleanup();
    expect(() => cm.cleanup()).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('registerTimeout() tracks the ID and cleanup() clears it', () => {
    const id = setTimeout(() => {
      /* mock */
    }, 1000);
    cm.registerTimeout(id);
    expect(cm.timeouts.has(id)).toBe(true);

    cm.cleanup();
    expect(cm.timeouts.size).toBe(0);
    // The underlying timer should have been cleared by the
    // manager's cleanup() call, so it never fires.
  });

  test('registerInterval() tracks the ID and cleanup() clears it', () => {
    const id = setInterval(() => {
      /* mock */
    }, 1000);
    cm.registerInterval(id);
    expect(cm.intervals.has(id)).toBe(true);

    cm.cleanup();
    expect(cm.intervals.size).toBe(0);
  });

  test('cleanup() disconnects registered observers', () => {
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer);
    expect(cm.observers.has(observer)).toBe(true);

    cm.cleanup();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cm.observers.size).toBe(0);
  });

  test('cleanup() continues if a single callback throws', () => {
    const good = jest.fn();
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    cm.register(bad);
    cm.register(good);
    cm.cleanup();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // session scope: session-scoped resources survive per-navigation cleanup()
  // ---------------------------------------------------------------------------

  test('session-scoped observer survives cleanup() and stays connected', () => {
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer, null, { scope: 'session' });

    cm.cleanup();
    expect(disconnect).not.toHaveBeenCalled();
  });

  test('session-scoped callback survives cleanup() but unregister still removes it', () => {
    const cb = jest.fn();
    cm.register(cb, { scope: 'session' });
    cm.cleanup();
    expect(cb).not.toHaveBeenCalled();

    cm.unregister(cb);
    expect(() => cm.cleanup()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  test('disconnectObserver removes a session-scoped observer', () => {
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer, null, { scope: 'session' });

    cm.disconnectObserver(observer);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  test('page-scoped observers still disconnect alongside session ones', () => {
    const pageDisconnect = jest.fn();
    const sessionDisconnect = jest.fn();
    cm.registerObserver({ disconnect: pageDisconnect });
    cm.registerObserver({ disconnect: sessionDisconnect }, null, { scope: 'session' });

    cm.cleanup();
    expect(pageDisconnect).toHaveBeenCalledTimes(1);
    expect(sessionDisconnect).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // registerObserver with element tracking
  // ---------------------------------------------------------------------------

  test('registerObserver with element tracks via elementObservers WeakMap', () => {
    const el = document.createElement('div');
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer, el);
    expect(cm.observers.has(observer)).toBe(true);
    // The WeakMap should have an entry keyed by el
    expect(cm.elementObservers.has(el)).toBe(true);
  });

  test('registerObserver with null element does not track in elementObservers', () => {
    const observer = { disconnect: jest.fn() };
    cm.registerObserver(observer, null);
    expect(cm.observers.has(observer)).toBe(true);
    // No element was passed, so no WeakMap entry
  });

  test('registerObserver with non-object element is silently ignored', () => {
    const observer = { disconnect: jest.fn() };
    cm.registerObserver(observer, 'string-element');
    expect(cm.observers.has(observer)).toBe(true);
    // Non-object 'el' should not throw, just be ignored
  });

  // ---------------------------------------------------------------------------
  // disconnectForElement / disconnectObserver
  // ---------------------------------------------------------------------------

  test('disconnectForElement disconnects observers for a tracked element', () => {
    const el = document.createElement('div');
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer, el);
    expect(cm.elementObservers.has(el)).toBe(true);

    cm.disconnectForElement(el);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cm.elementObservers.has(el)).toBe(false);
    expect(cm.observers.has(observer)).toBe(false);
  });

  test('disconnectForElement with untracked element does nothing', () => {
    const el = document.createElement('div');
    expect(() => cm.disconnectForElement(el)).not.toThrow();
  });

  test('disconnectObserver disconnects and removes a single observer', () => {
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer);
    expect(cm.observers.has(observer)).toBe(true);

    cm.disconnectObserver(observer);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cm.observers.has(observer)).toBe(false);
  });

  test('disconnectObserver with null is a no-op', () => {
    expect(() => cm.disconnectObserver(null)).not.toThrow();
  });

  test('disconnectObserver with observer that has no disconnect is safe', () => {
    const observer = { foo: 'bar' };
    cm.registerObserver(observer);
    expect(() => cm.disconnectObserver(observer)).not.toThrow();
    expect(cm.observers.has(observer)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // registerAnimationFrame
  // ---------------------------------------------------------------------------

  test('registerAnimationFrame tracks the ID and cleanup cancels it', () => {
    // requestAnimationFrame may not be available in jsdom, so use a mock
    const raf = jest.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(42);
    const caf = jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {
      /* mock */
    });

    const id = cm.registerAnimationFrame(42);
    expect(cm.animationFrames.has(id)).toBe(true);

    cm.cleanup();
    expect(caf).toHaveBeenCalledWith(42);
    expect(cm.animationFrames.size).toBe(0);

    raf.mockRestore();
    caf.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // getListenerStats
  // ---------------------------------------------------------------------------

  test('getListenerStats returns active and registeredTotal counts', () => {
    // The module auto-registers two persistent yt-navigate-* listeners on load.
    // We verify the baseline from a fresh instance plus any new registrations.
    const stats = cm.getListenerStats();
    expect(stats.active).toBe(2);
    expect(stats.registeredTotal).toBe(2);
  });

  test('getListenerStats reflects registered listeners', () => {
    const target = document.createElement('div');
    cm.registerListener(target, 'click', jest.fn());
    cm.registerListener(target, 'keydown', jest.fn());

    const stats = cm.getListenerStats();
    expect(stats.active).toBe(4);
    expect(stats.registeredTotal).toBe(4);
  });

  test('getListenerStats survives cleanup', () => {
    cm.registerListener(document.createElement('div'), 'click', jest.fn());
    cm.cleanup();
    const stats = cm.getListenerStats();
    // Non-persistent listener removed; two persistent navigation listeners remain.
    expect(stats.active).toBe(2);
    expect(stats.registeredTotal).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // YouTubeUtils integration (window.YouTubeUtils.cleanupManager)
  // ---------------------------------------------------------------------------

  test('sets cleanupManager on window.YouTubeUtils when YouTubeUtils exists', () => {
    // YouTubeUtils was deleted in beforeEach; set it up before re-loading
    jest.resetModules();
    delete window.YouTubePlusCleanupManager;
    window.YouTubeUtils = {};
    require('../src/cleanup-manager.js');
    const cm2 = window.YouTubePlusCleanupManager;
    expect(window.YouTubeUtils.cleanupManager).toBe(cm2);
  });

  test('does not override existing YouTubeUtils.cleanupManager', () => {
    const existing = { mock: true };
    jest.resetModules();
    delete window.YouTubePlusCleanupManager;
    window.YouTubeUtils = { cleanupManager: existing };
    require('../src/cleanup-manager.js');
    expect(window.YouTubeUtils.cleanupManager).toBe(existing);
  });

  // ---------------------------------------------------------------------------
  // onNavigateStart / onNavigateFinish lifecycle hooks
  // ---------------------------------------------------------------------------

  test('onNavigateStart fires when notifyNavigateStart is called', () => {
    const hook = jest.fn();
    cm.onNavigateStart(hook);
    cm.notifyNavigateStart();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  test('onNavigateFinish fires when notifyNavigateFinish is called', () => {
    const hook = jest.fn();
    cm.onNavigateFinish(hook);
    cm.notifyNavigateFinish();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  test('onNavigateStart returns an unregister function', () => {
    const hook = jest.fn();
    const unregister = cm.onNavigateStart(hook);
    unregister();
    cm.notifyNavigateStart();
    expect(hook).not.toHaveBeenCalled();
  });

  test('onNavigateFinish returns an unregister function', () => {
    const hook = jest.fn();
    const unregister = cm.onNavigateFinish(hook);
    unregister();
    cm.notifyNavigateFinish();
    expect(hook).not.toHaveBeenCalled();
  });

  test('onNavigateStart ignores non-function callbacks', () => {
    expect(() => cm.onNavigateStart('not-a-function')).not.toThrow();
    expect(() => cm.onNavigateStart(null)).not.toThrow();
    expect(() => cm.onNavigateStart(42)).not.toThrow();
    // Should still be callable without crashing
    expect(() => cm.notifyNavigateStart()).not.toThrow();
  });

  test('onNavigateFinish ignores non-function callbacks', () => {
    expect(() => cm.onNavigateFinish('not-a-function')).not.toThrow();
    expect(() => cm.onNavigateFinish(null)).not.toThrow();
    expect(() => cm.onNavigateFinish(42)).not.toThrow();
    expect(() => cm.notifyNavigateFinish()).not.toThrow();
  });

  test('notifyNavigateStart continues if one hook throws', () => {
    const good = jest.fn();
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    cm.onNavigateStart(bad);
    cm.onNavigateStart(good);
    cm.notifyNavigateStart();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  test('notifyNavigateFinish continues if one hook throws', () => {
    const good = jest.fn();
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    cm.onNavigateFinish(bad);
    cm.onNavigateFinish(good);
    cm.notifyNavigateFinish();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  test('yt-navigate-start event triggers notifyNavigateStart', () => {
    const hook = jest.fn();
    cm.onNavigateStart(hook);
    window.dispatchEvent(new Event('yt-navigate-start'));
    expect(hook).toHaveBeenCalledTimes(1);
  });

  test('yt-navigate-finish event triggers notifyNavigateFinish', () => {
    const hook = jest.fn();
    cm.onNavigateFinish(hook);
    window.dispatchEvent(new Event('yt-navigate-finish'));
    expect(hook).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Edge cases: error resilience
  // ---------------------------------------------------------------------------

  test('registerListener handles target.addEventListener throwing', () => {
    const badTarget = {
      addEventListener: jest.fn(() => {
        throw new Error('addEventListener failed');
      }),
    };
    // Should not throw, should log via logError
    const key = cm.registerListener(badTarget, 'click', jest.fn());
    expect(key).toBeNull();
  });

  test('cleanup continues when observer.disconnect throws', () => {
    const disconnect = jest.fn(() => {
      throw new Error('disconnect failed');
    });
    const badObserver = { disconnect };
    const goodDisconnect = jest.fn();
    const goodObserver = { disconnect: goodDisconnect };

    cm.registerObserver(badObserver);
    cm.registerObserver(goodObserver);

    expect(() => cm.cleanup()).not.toThrow();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(goodDisconnect).toHaveBeenCalledTimes(1);
    expect(cm.observers.size).toBe(0);
  });

  test('register with non-function is ignored', () => {
    cm.register('not-a-function');
    cm.register(null);
    cm.register(undefined);
    cm.register(42);
    // No callbacks to fire, cleanup should not crash
    expect(() => cm.cleanup()).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // unregister helpers and scopes
  // ---------------------------------------------------------------------------

  test('unregisterObserver stops tracking observer', () => {
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer);
    cm.unregisterObserver(observer);
    cm.cleanup();
    expect(disconnect).not.toHaveBeenCalled();
  });

  test('unregisterListener removes listener before cleanup', () => {
    const target = document.createElement('div');
    const listener = jest.fn();
    const key = cm.registerListener(target, 'click', listener);
    cm.unregisterListener(key);
    target.click();
    expect(listener).not.toHaveBeenCalled();
  });

  test('timeout() leaves the registry when it fires and is cleared by cleanup() before that', () => {
    jest.useFakeTimers();
    try {
      const fired = jest.fn();
      cm.timeout(fired, 100);
      cm.timeout(fired, 100, { scope: 'session' });
      expect(cm.timeouts.size).toBe(1);
      expect(cm.sessionTimeouts.size).toBe(1);
      jest.advanceTimersByTime(100);
      expect(fired).toHaveBeenCalledTimes(2);
      expect(cm.timeouts.size).toBe(0);
      expect(cm.sessionTimeouts.size).toBe(0);

      const cancelled = jest.fn();
      cm.timeout(cancelled, 100);
      cm.cleanup();
      jest.advanceTimersByTime(100);
      expect(cancelled).not.toHaveBeenCalled();
      expect(cm.timeouts.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('registerTimeout and unregisterTimeout handle session and page scopes', () => {
    const to1 = setTimeout(() => {
      /* mock */
    }, 1000);
    const to2 = setTimeout(() => {
      /* mock */
    }, 1000);
    cm.registerTimeout(to1);
    cm.registerTimeout(to2, { scope: 'session' });
    cm.unregisterTimeout(to1);
    cm.unregisterTimeout(to2);
    clearTimeout(to1);
    clearTimeout(to2);
  });

  test('registerAnimationFrame and unregisterAnimationFrame handle session and page scopes', () => {
    const f1 = 123;
    const f2 = 124;
    cm.registerAnimationFrame(f1);
    cm.registerAnimationFrame(f2, { scope: 'session' });
    cm.unregisterAnimationFrame(f1);
    cm.unregisterAnimationFrame(f2);
  });

  test('logError fallback when ErrorBoundary is absent but YouTubeUtils is present', () => {
    const originalEB = window.YouTubePlusErrorBoundary;
    delete window.YouTubePlusErrorBoundary;
    window.YouTubeUtils = {
      logError: jest.fn(),
    };

    const badCb = () => {
      throw new Error('test error');
    };
    cm.register(badCb);
    cm.cleanup();
    expect(window.YouTubeUtils.logError).toHaveBeenCalled();

    window.YouTubePlusErrorBoundary = originalEB;
  });

  // Regression: non-persistent listener for a "persistent" event type
  // (e.g. keydown, resize, scroll) MUST be removed by cleanup() when
  // persistent=false. Previously the hardcoded persistentEvents set
  // overrode the persistent flag.
  test('cleanup() removes non-persistent listeners even for keydown/resize/scroll', () => {
    const target = document.createElement('div');
    const kdHandler = jest.fn();
    const rsHandler = jest.fn();
    const scHandler = jest.fn();
    cm.registerListener(target, 'keydown', kdHandler, undefined, false);
    cm.registerListener(target, 'resize', rsHandler, undefined, false);
    cm.registerListener(target, 'scroll', scHandler, undefined, false);

    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('resize'));
    target.dispatchEvent(new Event('scroll'));
    expect(kdHandler).toHaveBeenCalledTimes(1);
    expect(rsHandler).toHaveBeenCalledTimes(1);
    expect(scHandler).toHaveBeenCalledTimes(1);

    cm.cleanup();

    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('resize'));
    target.dispatchEvent(new Event('scroll'));
    expect(kdHandler).toHaveBeenCalledTimes(1);
    expect(rsHandler).toHaveBeenCalledTimes(1);
    expect(scHandler).toHaveBeenCalledTimes(1);
  });

  test('persistent flag on keydown/resize/scroll survives cleanup()', () => {
    const target = document.createElement('div');
    const kdHandler = jest.fn();
    const rsHandler = jest.fn();
    cm.registerListener(target, 'keydown', kdHandler, undefined, true);
    cm.registerListener(target, 'resize', rsHandler, undefined, true);

    cm.cleanup();

    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('resize'));
    expect(kdHandler).toHaveBeenCalledTimes(1);
    expect(rsHandler).toHaveBeenCalledTimes(1);
  });

  test('once: true removes listener from bookkeeping after firing', () => {
    const target = document.createElement('div');
    const handler = jest.fn();
    const key = cm.registerListener(target, 'click', handler, { once: true });
    expect(cm.listeners.has(key)).toBe(true);

    target.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cm.listeners.has(key)).toBe(false);

    target.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('AbortSignal auto-removes listener entry from bookkeeping on abort', () => {
    const target = document.createElement('div');
    const handler = jest.fn();
    const controller = new AbortController();
    const key = cm.registerListener(target, 'click', handler, {
      signal: controller.signal,
    });
    expect(cm.listeners.has(key)).toBe(true);

    controller.abort();
    expect(cm.listeners.has(key)).toBe(false);

    target.dispatchEvent(new Event('click'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('duplicate listener registration returns same key without inflating stats', () => {
    const target = document.createElement('div');
    const handler = jest.fn();
    const statsBefore = cm.getListenerStats();

    const key1 = cm.registerListener(target, 'click', handler);
    const statsAfter1 = cm.getListenerStats();
    expect(statsAfter1.registeredTotal).toBe(statsBefore.registeredTotal + 1);

    const key2 = cm.registerListener(target, 'click', handler);
    const statsAfter2 = cm.getListenerStats();
    expect(key2).toBe(key1);
    expect(statsAfter2.registeredTotal).toBe(statsAfter1.registeredTotal);
    expect(statsAfter2.active).toBe(statsAfter1.active);
  });

  test('disconnectForElement removes non-persistent listeners and clears element tracking', () => {
    const el = document.createElement('div');
    const handler = jest.fn();
    const key = cm.registerListener(el, 'click', handler);
    expect(cm.elementListeners.has(el)).toBe(true);
    expect(cm.listeners.has(key)).toBe(true);

    cm.disconnectForElement(el);
    expect(cm.listeners.has(key)).toBe(false);
    expect(cm.elementListeners.has(el)).toBe(false);

    el.dispatchEvent(new Event('click'));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('disconnectSubtree', () => {
  test('releases listeners targeted inside the subtree and listeners owned by it', () => {
    const cm = window.YouTubePlusCleanupManager;
    const root = document.createElement('div');
    const child = document.createElement('button');
    root.appendChild(child);
    document.body.appendChild(root);
    const outside = document.createElement('span');
    document.body.appendChild(outside);

    const onChild = jest.fn();
    const onDoc = jest.fn();
    const onOutside = jest.fn();
    cm.registerListener(child, 'click', onChild);
    cm.registerListener(document, 'click', onDoc, { owner: root }, true);
    cm.registerListener(outside, 'click', onOutside);

    cm.disconnectSubtree(root);
    child.click();
    outside.click();

    expect(onChild).not.toHaveBeenCalled();
    expect(onDoc).not.toHaveBeenCalled();
    expect(onOutside).toHaveBeenCalledTimes(1);
    cm.disconnectForElement(outside);
    root.remove();
    outside.remove();
  });
});

describe('resource-scoped disconnect APIs', () => {
  test('tolerate a missing node without throwing', () => {
    jest.resetModules();
    delete window.YouTubePlusCleanupManager;
    delete window.YouTubeUtils;
    require('../src/cleanup-manager.js');
    const cm = window.YouTubePlusCleanupManager;

    expect(() => cm.disconnectForElement(null)).not.toThrow();
    expect(() => cm.disconnectSubtree(null)).not.toThrow();
  });
});
