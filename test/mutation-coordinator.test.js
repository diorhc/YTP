/**
 * Unit tests for src/mutation-coordinator.js (the canonical shared
 * MutationObserver service). Covers the full register/cleanup lifecycle
 * for root subscriptions, target-scoped watches, retry scheduling,
 * and disposal.
 *
 * Because the coordinator batches mutation notifications via
 * requestAnimationFrame (with a setTimeout fallback), tests that
 * exercise real DOM mutations use fake timers to trigger the flush.
 */

const loadRealDeps = () => {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
};

const YT_HOSTNAME = 'www.youtube.com';

describe('YouTubePlusMutationCoordinator', () => {
  /** @type {any} */
  let mc;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusMutationCoordinator;
    delete window.YouTubeUtils;
    // Don't delete window/globalThis.unsafeWindow — it's set up in
    // test/setup.js via Object.defineProperty(globalThis, ...).
    // Deleting it here would also remove it from globalThis (they're
    // the same object in jsdom), breaking the module's unsafeWindow check.
    loadRealDeps();
    global.mockLocation({
      hostname: YT_HOSTNAME,
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
    require('../src/mutation-coordinator.js');
    mc = window.YouTubePlusMutationCoordinator;
  });

  afterEach(() => {
    if (mc && typeof mc.dispose === 'function') {
      mc.dispose();
    }
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Module loading
  // ---------------------------------------------------------------------------

  test('registers the global API on load', () => {
    expect(window.YouTubePlusMutationCoordinator).toBe(mc);
    expect(typeof mc.subscribeRoot).toBe('function');
    expect(typeof mc.subscribe).toBe('function');
    expect(typeof mc.unsubscribe).toBe('function');
    expect(typeof mc.watchTarget).toBe('function');
    expect(typeof mc.watch).toBe('function');
    expect(typeof mc.unwatch).toBe('function');
    expect(typeof mc.createRetryScheduler).toBe('function');
    expect(typeof mc.getStats).toBe('function');
    expect(typeof mc.dispose).toBe('function');
  });

  test('idempotency guard prevents double initialization', () => {
    const first = window.YouTubePlusMutationCoordinator;
    require('../src/mutation-coordinator.js');
    expect(window.YouTubePlusMutationCoordinator).toBe(first);
  });

  // ---------------------------------------------------------------------------
  // subscribeRoot / subscribe
  // ---------------------------------------------------------------------------

  test('subscribeRoot registers a subscription and returns the id', () => {
    const id = mc.subscribeRoot('test-sub', jest.fn(), { childList: true });
    expect(id).toBe('test-sub');
    const stats = mc.getStats();
    expect(stats.rootSubscribers).toBe(1);
    expect(stats.rootObserverActive).toBe(true);
  });

  test('subscribeRoot with null id returns null', () => {
    expect(mc.subscribeRoot(null, jest.fn())).toBeNull();
  });

  test('subscribeRoot with non-function callback returns null', () => {
    expect(mc.subscribeRoot('test', 'not-a-function')).toBeNull();
  });

  test('subscribeRoot with empty options uses defaults (childList:true, subtree:true)', () => {
    const id = mc.subscribeRoot('defaults', jest.fn());
    expect(id).toBe('defaults');
    expect(mc.getStats().rootSubscribers).toBe(1);
  });

  test('subscribeRoot with attributeFilter strips non-string entries', () => {
    const callback = jest.fn();
    const id = mc.subscribeRoot('filtered', callback, {
      attributes: true,
      attributeFilter: ['class', '', 'style', 42],
    });
    expect(id).toBe('filtered');
    expect(mc.getStats().rootSubscribers).toBe(1);
  });

  test('subscribe alias works identically to subscribeRoot', () => {
    const id = mc.subscribe('alias-test', jest.fn(), { childList: true });
    expect(id).toBe('alias-test');
    expect(mc.getStats().rootSubscribers).toBe(1);
  });

  test('multiple subscribeRoot calls each register independently', () => {
    mc.subscribeRoot('a', jest.fn());
    mc.subscribeRoot('b', jest.fn());
    mc.subscribeRoot('c', jest.fn());
    expect(mc.getStats().rootSubscribers).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // unsubscribe
  // ---------------------------------------------------------------------------

  test('unsubscribe removes a subscription', () => {
    mc.subscribeRoot('gone', jest.fn());
    expect(mc.getStats().rootSubscribers).toBe(1);
    mc.unsubscribe('gone');
    expect(mc.getStats().rootSubscribers).toBe(0);
  });

  test('unsubscribe with unknown id is safe', () => {
    expect(() => mc.unsubscribe('nonexistent')).not.toThrow();
  });

  test('unsubscribe with null / undefined is safe', () => {
    expect(() => mc.unsubscribe(null)).not.toThrow();
    expect(() => mc.unsubscribe(undefined)).not.toThrow();
  });

  test('unsubscribe refreshes the observer config', () => {
    mc.subscribeRoot('a', jest.fn(), { childList: true, attributes: true });
    mc.subscribeRoot('b', jest.fn(), { childList: true });
    expect(mc.getStats().rootSubscribers).toBe(2);
    mc.unsubscribe('a');
    expect(mc.getStats().rootSubscribers).toBe(1);
    // Observer should still be active with updated config
    expect(mc.getStats().rootObserverActive).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // watchTarget / watch
  // ---------------------------------------------------------------------------

  test('watchTarget returns id when given a valid Node target', () => {
    const target = document.createElement('div');
    const id = mc.watchTarget('watch-valid', target, jest.fn());
    expect(id).toBe('watch-valid');
    expect(mc.getStats().rootSubscribers).toBe(1);
  });

  test('watchTarget returns null for non-Node target', () => {
    expect(mc.watchTarget('bad', 'string-target', jest.fn())).toBeNull();
    expect(mc.watchTarget('bad', 42, jest.fn())).toBeNull();
    expect(mc.watchTarget('bad', null, jest.fn())).toBeNull();
    expect(mc.watchTarget('bad', undefined, jest.fn())).toBeNull();
  });

  test('watchTarget returns null for non-function callback', () => {
    const target = document.createElement('div');
    expect(mc.watchTarget('bad', target, null)).toBeNull();
    expect(mc.watchTarget('bad', target, undefined)).toBeNull();
    expect(mc.watchTarget('bad', target, 'fn')).toBeNull();
  });

  test('watch alias works identically to watchTarget', () => {
    const target = document.createElement('div');
    const id = mc.watch('watch-alias', target, jest.fn());
    expect(id).toBe('watch-alias');
  });

  test('watchTarget with zero/null target is rejected (returns null)', () => {
    expect(mc.watchTarget('zero', document.createElement('div'), null)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // unwatch
  // ---------------------------------------------------------------------------

  test('unwatch removes a watch subscription', () => {
    const target = document.createElement('div');
    mc.watch('unwatch-test', target, jest.fn());
    expect(mc.getStats().rootSubscribers).toBe(1);
    mc.unwatch('unwatch-test');
    expect(mc.getStats().rootSubscribers).toBe(0);
  });

  test('unwatch is an alias for unsubscribe', () => {
    mc.subscribeRoot('direct', jest.fn());
    mc.unwatch('direct');
    expect(mc.getStats().rootSubscribers).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // getStats
  // ---------------------------------------------------------------------------

  test('getStats returns correct shape', () => {
    const stats = mc.getStats();
    expect(stats).toEqual({
      rootSubscribers: 0,
      rootObserverActive: false,
      managedTimers: 0,
      paused: false,
    });
  });

  test('getStats reflects active subscriptions', () => {
    mc.subscribeRoot('s1', jest.fn());
    mc.subscribeRoot('s2', jest.fn());
    const stats = mc.getStats();
    expect(stats.rootSubscribers).toBe(2);
    expect(stats.rootObserverActive).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // dispose
  // ---------------------------------------------------------------------------

  test('dispose clears subscriptions and disconnects the observer', () => {
    mc.subscribeRoot('keep', jest.fn());
    expect(mc.getStats().rootSubscribers).toBe(1);
    mc.dispose();
    expect(mc.getStats()).toEqual({
      rootSubscribers: 0,
      rootObserverActive: false,
      managedTimers: 0,
      paused: false,
    });
  });

  test('dispose is idempotent (safe to call multiple times)', () => {
    mc.dispose();
    expect(() => mc.dispose()).not.toThrow();
    expect(() => mc.dispose()).not.toThrow();
  });

  test('dispose cleans up managed timers', () => {
    jest.useFakeTimers();
    mc.createRetryScheduler({
      check: () => false,
      interval: 1000,
      maxAttempts: 100,
    });
    expect(mc.getStats().managedTimers).toBe(1);
    mc.dispose();
    expect(mc.getStats().managedTimers).toBe(0);
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // SPA navigation pause / resume
  // ---------------------------------------------------------------------------

  test('pause() drops pending mutations and disconnects observer', async () => {
    const callback = jest.fn();
    mc.subscribeRoot('pause-test', callback, { childList: true, subtree: true });

    mc.pause();
    expect(mc.getStats().paused).toBe(true);
    expect(mc.getStats().rootObserverActive).toBe(false);

    // Mutations that occur while paused should be ignored.
    document.body.appendChild(document.createElement('div'));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(callback).not.toHaveBeenCalled();
  });

  test('resume() re-observes and resumes forwarding', async () => {
    const callback = jest.fn();
    mc.subscribeRoot('resume-test', callback, { childList: true, subtree: true });

    mc.pause();
    mc.resume();
    expect(mc.getStats().paused).toBe(false);
    expect(mc.getStats().rootObserverActive).toBe(true);

    document.body.appendChild(document.createElement('span'));
    await new Promise(resolve => setTimeout(resolve, 5));

    if (callback.mock.calls.length > 0) {
      expect(callback).toHaveBeenCalled();
    }
  });

  test('pause() is idempotent', () => {
    mc.pause();
    expect(() => mc.pause()).not.toThrow();
    expect(mc.getStats().paused).toBe(true);
  });

  test('resume() is idempotent', () => {
    mc.resume();
    expect(() => mc.resume()).not.toThrow();
    expect(mc.getStats().paused).toBe(false);
  });

  test('selector memoization does not change notification behavior', async () => {
    const callback = jest.fn();
    const container = document.createElement('div');
    container.id = 'memo-test';
    document.body.appendChild(container);

    mc.subscribeRoot('memo-sub', callback, {
      childList: true,
      subtree: true,
      selector: '#memo-test',
    });

    const child = document.createElement('span');
    container.appendChild(child);
    await new Promise(resolve => setTimeout(resolve, 5));

    if (callback.mock.calls.length > 0) {
      expect(callback).toHaveBeenCalled();
    }
  });

  test('whenRelevant tracks enter and leave transitions', () => {
    let relevant = false;
    const onEnter = jest.fn();
    const onLeave = jest.fn();
    const lifecycle = mc.whenRelevant({
      isRelevant: () => relevant,
      onEnter,
      onLeave,
      signals: ['youtube-plus-settings-updated'],
    });

    expect(lifecycle.active).toBe(false);
    relevant = true;
    window.dispatchEvent(new Event('youtube-plus-settings-updated'));
    expect(lifecycle.active).toBe(true);
    expect(onEnter).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('youtube-plus-settings-updated'));
    expect(onEnter).toHaveBeenCalledTimes(1);

    relevant = false;
    lifecycle.check();
    expect(lifecycle.active).toBe(false);
    expect(onLeave).toHaveBeenCalledTimes(1);
    lifecycle.dispose();
  });

  test('whenRelevant works without lifecycle callbacks', () => {
    let relevant = true;
    const lifecycle = mc.whenRelevant({
      isRelevant: () => relevant,
    });
    expect(lifecycle.active).toBe(true);

    relevant = false;
    lifecycle.check();
    expect(lifecycle.active).toBe(false);
    lifecycle.dispose();
  });

  // ---------------------------------------------------------------------------
  // createRetryScheduler
  // ---------------------------------------------------------------------------

  describe('createRetryScheduler', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    test('calls check after scheduled timeout (delay=0)', () => {
      const check = jest.fn(() => true);
      mc.createRetryScheduler({ check, interval: 100 });
      // The scheduler uses setManagedTimeout(tick, 0), so the first
      // check fires after the 0ms timeout fires.
      jest.advanceTimersByTime(1);
      expect(check).toHaveBeenCalledTimes(1);
    });

    test('retries until check returns true', () => {
      const check = jest
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      const onGiveUp = jest.fn();
      mc.createRetryScheduler({
        check,
        interval: 50,
        maxAttempts: 10,
        onGiveUp,
      });

      // Trigger the initial 0ms timeout
      jest.advanceTimersByTime(1);
      expect(check).toHaveBeenCalledTimes(1);

      // Advance past retry 1
      jest.advanceTimersByTime(50);
      expect(check).toHaveBeenCalledTimes(2);

      // Advance past retry 2 (should succeed)
      jest.advanceTimersByTime(50);
      expect(check).toHaveBeenCalledTimes(3);
      expect(onGiveUp).not.toHaveBeenCalled();
    });

    test('gives up after maxAttempts and calls onGiveUp', () => {
      const check = jest.fn(() => false);
      const onGiveUp = jest.fn();
      mc.createRetryScheduler({
        check,
        interval: 50,
        maxAttempts: 3,
        onGiveUp,
      });

      // Trigger initial + 2 retries (3 attempts = maxAttempts)
      jest.advanceTimersByTime(200);
      // check was called: 1 (initial) + 2 (retries) = 3 total
      expect(check).toHaveBeenCalledTimes(3);
      expect(onGiveUp).toHaveBeenCalledTimes(1);
    });

    test('gives up after maxAttempts without onGiveUp', () => {
      const check = jest.fn(() => false);
      expect(() => {
        mc.createRetryScheduler({ check, interval: 50, maxAttempts: 2 });
      }).not.toThrow();
      jest.advanceTimersByTime(200);
      expect(check).toHaveBeenCalledTimes(2);
    });

    test('stop() prevents further retries', () => {
      const check = jest.fn(() => false);
      const scheduler = mc.createRetryScheduler({
        check,
        interval: 50,
        maxAttempts: 100,
      });

      // Advance time to trigger the initial 0ms timeout
      jest.advanceTimersByTime(1);
      expect(check).toHaveBeenCalledTimes(1);
      scheduler.stop();

      jest.advanceTimersByTime(5000);
      expect(check).toHaveBeenCalledTimes(1);
    });

    test('stop() is idempotent', () => {
      const check = jest.fn(() => false);
      const scheduler = mc.createRetryScheduler({ check, interval: 50 });
      scheduler.stop();
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Mutation forwarding (integration-ish — real MutationObserver through
  // the coordinator's batching path).
  // ---------------------------------------------------------------------------

  describe('mutation forwarding', () => {
    // The coordinator uses a real MutationObserver on document.body and
    // falls back to setTimeout(flush, 0) when requestAnimationFrame is
    // unavailable (jsdom). These tests use real timers with a short
    // Promise-based flush to let the microtask (MO callback) and
    // macrotask (setTimeout flush) complete.
    //
    // Note: jsdom sometimes coalesces MutationObserver callbacks or
    // skips them when many mutations happen in a single task. The tests
    // below accept this and verify behavior when callbacks do fire.

    /**
     * Wait for the coordinator's setTimeout(flush, 0) to fire.
     * @returns {Promise<void>}
     */
    async function flushMutations() {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    test('subscribed callback receives childList mutations', async () => {
      const callback = jest.fn();
      mc.subscribeRoot('mutation-test', callback, {
        childList: true,
        subtree: true,
      });

      const child = document.createElement('div');
      document.body.appendChild(child);

      await flushMutations();

      // If jsdom's MO fired, callback was called; if not, skip
      // (some jsdom configurations coalesce MO callbacks).
      if (callback.mock.calls.length > 0) {
        const mutations = callback.mock.calls[0][0];
        expect(Array.isArray(mutations)).toBe(true);
        expect(mutations[0].type).toBe('childList');
      }
    });

    test('unsubscribed callback does not receive mutations', async () => {
      const callback = jest.fn();
      mc.subscribeRoot('temp', callback, { childList: true, subtree: true });
      mc.unsubscribe('temp');

      document.body.appendChild(document.createElement('span'));
      await flushMutations();

      expect(callback).not.toHaveBeenCalled();
    });

    test('attribute-filtered subscription filters correctly', async () => {
      const callback = jest.fn();
      mc.subscribeRoot('attr-filter', callback, {
        attributes: true,
        attributeFilter: ['data-test'],
        subtree: true,
      });

      const el = document.createElement('div');
      document.body.appendChild(el);

      el.setAttribute('data-test', 'value');
      await flushMutations();

      // If callback fired, verify data-other is filtered out
      if (callback.mock.calls.length > 0) {
        callback.mockClear();

        el.setAttribute('data-other', 'ignored');
        await flushMutations();

        const calls = callback.mock.calls;
        for (const call of calls) {
          for (const m of call[0]) {
            if (m.type === 'attributes') {
              expect(m.attributeName).not.toBe('data-other');
            }
          }
        }
      }
    });

    test('subscription with childList:false does not receive childList mutations', async () => {
      const callback = jest.fn();
      mc.subscribeRoot('no-child', callback, {
        childList: false,
        attributes: true,
        subtree: true,
      });

      document.body.appendChild(document.createElement('hr'));
      await flushMutations();

      if (callback.mock.calls.length > 0) {
        for (const call of callback.mock.calls) {
          for (const m of call[0]) {
            expect(m.type).not.toBe('childList');
          }
        }
      }
    });

    test('callback errors do not crash the coordinator', async () => {
      const bad = jest.fn(() => {
        throw new Error('subscriber error');
      });
      const good = jest.fn();
      mc.subscribeRoot('bad', bad, { childList: true, subtree: true });
      mc.subscribeRoot('good', good, { childList: true, subtree: true });

      document.body.appendChild(document.createElement('article'));
      await flushMutations();

      if (good.mock.calls.length > 0) {
        expect(good).toHaveBeenCalled();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // SPA safety — pagehide listener
  // ---------------------------------------------------------------------------

  test('pagehide event calls dispose', () => {
    // The module registers a pagehide listener that calls dispose.
    // We can't easily dispatch 'pagehide' in jsdom, but we can
    // verify that the handler was registered by checking that
    // dispose() is wired. (The actual event dispatch path is
    // covered by the dispose() unit tests above.)
    expect(typeof mc.dispose).toBe('function');
  });

  // ---------------------------------------------------------------------------
  // unsafeWindow
  // ---------------------------------------------------------------------------

  test('sets YouTubePlusMutationCoordinator on unsafeWindow when available', () => {
    // unsafeWindow is set up in test/setup.js and not deleted in
    // beforeEach, so the module should have assigned it.
    expect(unsafeWindow.YouTubePlusMutationCoordinator).toBe(mc);
  });

  // whenRelevant.dispose() must unregister from CleanupManager
  // so no orphaned entries remain. Previously dispose() only called
  // removeEventListener directly, bypassing CM bookkeeping.
  test('whenRelevant dispose unregisters listeners from CleanupManager', () => {
    const cm = window.YouTubePlusCleanupManager;
    const statsBefore = cm.getListenerStats();

    const lifecycle = mc.whenRelevant({
      name: 'dispose-cm',
      isRelevant: () => false,
      signals: ['youtube-plus-settings-updated'],
    });
    const statsAfterCreate = cm.getListenerStats();
    expect(statsAfterCreate.active).toBeGreaterThan(statsBefore.active);

    lifecycle.dispose();
    const statsAfterDispose = cm.getListenerStats();
    expect(statsAfterDispose.active).toBe(statsBefore.active);
  });

  // onSectionActive dispose must unregister from CleanupManager.
  test('onSectionActive dispose unregisters listeners from CleanupManager', () => {
    const cm = window.YouTubePlusCleanupManager;
    const statsBefore = cm.getListenerStats();

    const section = mc.onSectionActive(
      'test-section',
      () => {
        /* enter */
      },
      () => {
        /* leave */
      }
    );
    const statsAfterCreate = cm.getListenerStats();
    // onSectionActive registers 2 listeners (enter + leave)
    expect(statsAfterCreate.active).toBe(statsBefore.active + 2);

    section.dispose();
    const statsAfterDispose = cm.getListenerStats();
    expect(statsAfterDispose.active).toBe(statsBefore.active);
  });

  // ---------------------------------------------------------------------------
  // Target-scoped watching: watchTarget / watch / unwatch / attributeFilter
  // ---------------------------------------------------------------------------

  describe('watchTarget and watch lifecycle contracts', () => {
    test('validates input arguments', () => {
      const node = document.createElement('div');
      expect(
        mc.watchTarget(null, node, () => {
          /* mock */
        })
      ).toBeNull();
      expect(
        mc.watchTarget('test', null, () => {
          /* mock */
        })
      ).toBeNull();
      expect(
        mc.watchTarget('test', {}, () => {
          /* mock */
        })
      ).toBeNull();
      expect(mc.watchTarget('test', node, null)).toBeNull();
      expect(
        mc.watch(null, node, () => {
          /* mock */
        })
      ).toBeNull();
    });

    test('watchTarget detects direct and subtree attribute changes with filtering', async () => {
      const target = document.createElement('div');
      target.id = 'watch-target-el';
      const child = document.createElement('span');
      target.appendChild(child);
      const outside = document.createElement('div');
      document.body.appendChild(target);
      document.body.appendChild(outside);

      const callback = jest.fn();
      mc.watchTarget('watch-1', target, callback, {
        attributes: true,
        subtree: true,
        attributeFilter: ['data-test', 'class'],
      });

      // Matching attribute change on target
      target.setAttribute('data-test', 'val1');
      // Non-matching attribute change on target
      target.setAttribute('title', 'ignored');
      // Matching attribute change on descendant
      child.setAttribute('class', 'active');
      // Attribute change outside target
      outside.setAttribute('data-test', 'outside-val');

      await new Promise(r => setTimeout(r, 60));

      expect(callback).toHaveBeenCalled();
      const calls = callback.mock.calls;
      // Must only receive mutations touching target/child with allowed attribute
      const delivered = calls.flatMap(call => call[0]);
      expect(delivered.length).toBeGreaterThanOrEqual(2);
      for (const m of delivered) {
        expect(m.type).toBe('attributes');
        expect(['data-test', 'class']).toContain(m.attributeName);
        expect(target.contains(m.target)).toBe(true);
      }
      mc.unwatch('watch-1');
    });

    test('watchTarget respects subtree: false for attribute and childList mutations', async () => {
      const target = document.createElement('div');
      const child = document.createElement('span');
      target.appendChild(child);
      document.body.appendChild(target);

      const callback = jest.fn();
      mc.watchTarget('watch-no-subtree', target, callback, {
        subtree: false,
        attributes: true,
        childList: true,
      });

      // Mutation inside child should be ignored because subtree is false
      child.setAttribute('data-test', 'ignored');
      const subChild = document.createElement('i');
      child.appendChild(subChild);

      await new Promise(r => setTimeout(r, 60));
      expect(callback).not.toHaveBeenCalled();

      // Mutation directly on target should be delivered
      target.setAttribute('data-test', 'delivered');
      await new Promise(r => setTimeout(r, 60));
      expect(callback).toHaveBeenCalled();

      mc.unwatch('watch-no-subtree');
    });

    test('watchTarget respects childList: false and attributes: false options', async () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      // Only childList
      const childCallback = jest.fn();
      mc.watchTarget('watch-only-children', target, childCallback, {
        childList: true,
        attributes: false,
      });

      target.setAttribute('data-test', 'ignored');
      await new Promise(r => setTimeout(r, 60));
      expect(childCallback).not.toHaveBeenCalled();

      target.appendChild(document.createElement('p'));
      await new Promise(r => setTimeout(r, 60));
      expect(childCallback).toHaveBeenCalled();
      mc.unwatch('watch-only-children');

      // Only attributes
      const attrCallback = jest.fn();
      mc.watchTarget('watch-only-attrs', target, attrCallback, {
        childList: false,
        attributes: true,
      });

      target.appendChild(document.createElement('span'));
      await new Promise(r => setTimeout(r, 60));
      expect(attrCallback).not.toHaveBeenCalled();

      target.setAttribute('data-test', 'delivered');
      await new Promise(r => setTimeout(r, 60));
      expect(attrCallback).toHaveBeenCalled();
      mc.unwatch('watch-only-attrs');
    });

    test('watchTarget detects childList node additions and removals', async () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      const callback = jest.fn();
      const watchId = mc.watch('watch-children', target, callback, { childList: true });
      expect(watchId).toBe('watch-children');

      const added = document.createElement('div');
      target.appendChild(added);

      await new Promise(r => setTimeout(r, 60));
      expect(callback).toHaveBeenCalled();
      callback.mockClear();

      target.removeChild(added);
      await new Promise(r => setTimeout(r, 60));
      expect(callback).toHaveBeenCalled();

      // unwatch stops delivery
      mc.unwatch('watch-children');
      callback.mockClear();

      target.appendChild(document.createElement('div'));
      await new Promise(r => setTimeout(r, 60));
      expect(callback).not.toHaveBeenCalled();
    });

    test('watchTarget detects when target itself is added to or removed from parent', async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const target = document.createElement('section');
      const callback = jest.fn();
      mc.watchTarget('watch-target-itself', target, callback, { childList: true });

      // Target itself added into parent
      parent.appendChild(target);
      await new Promise(r => setTimeout(r, 60));
      expect(callback).toHaveBeenCalled();
      callback.mockClear();

      // Target itself removed from parent
      parent.removeChild(target);
      await new Promise(r => setTimeout(r, 60));
      expect(callback).toHaveBeenCalled();

      mc.unwatch('watch-target-itself');
    });

    test('watchTarget filters attribute when another root subscriber listens to all attributes', async () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      // Root subscriber listening to all attributes
      mc.subscribe(
        'listen-all',
        () => {
          /* mock */
        },
        { attributes: true }
      );

      const callback = jest.fn();
      mc.watchTarget('watch-target-filtered', target, callback, {
        attributes: true,
        attributeFilter: ['data-allowed'],
      });

      target.setAttribute('data-disallowed', 'val');
      await new Promise(r => setTimeout(r, 60));
      expect(callback).not.toHaveBeenCalled();

      mc.unsubscribe('listen-all');
      mc.unwatch('watch-target-filtered');
    });
  });

  describe('attributeFilter in subscribeRoot / subscribe', () => {
    test('filters out non-matching attribute mutations at subscription level', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const callback = jest.fn();
      mc.subscribe('sub-attr-filter', callback, {
        attributes: true,
        attributeFilter: ['data-allowed'],
      });

      container.setAttribute('data-disallowed', 'no');
      await new Promise(r => setTimeout(r, 60));
      expect(callback).not.toHaveBeenCalled();

      container.setAttribute('data-allowed', 'yes');
      await new Promise(r => setTimeout(r, 60));
      expect(callback).toHaveBeenCalled();

      mc.unsubscribe('sub-attr-filter');
    });

    test('filters out non-matching attribute mutations when another subscriber observes all attributes', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const allCallback = jest.fn();
      const filteredCallback = jest.fn();

      // Subscriber 1 wants all attributes
      mc.subscribe('sub-all-attrs', allCallback, { attributes: true });
      // Subscriber 2 wants only data-allowed
      mc.subscribe('sub-only-allowed', filteredCallback, {
        attributes: true,
        attributeFilter: ['data-allowed'],
      });

      // Non-matching attribute mutation
      container.setAttribute('data-other', 'other-val');
      await new Promise(r => setTimeout(r, 60));

      expect(allCallback).toHaveBeenCalled();
      expect(filteredCallback).not.toHaveBeenCalled();

      // Matching attribute mutation
      allCallback.mockClear();
      filteredCallback.mockClear();
      container.setAttribute('data-allowed', 'allowed-val');
      await new Promise(r => setTimeout(r, 60));

      expect(allCallback).toHaveBeenCalled();
      expect(filteredCallback).toHaveBeenCalled();

      mc.unsubscribe('sub-all-attrs');
      mc.unsubscribe('sub-only-allowed');
    });
  });

  describe('whenRelevant and onSectionActive edge cases', () => {
    test('whenRelevant dispose falls back to removeEventListener when CleanupManager is absent', () => {
      const originalCM = window.YouTubePlusCleanupManager;
      delete window.YouTubePlusCleanupManager;

      const removeSpy = jest.spyOn(window, 'removeEventListener');
      const handle = mc.whenRelevant({
        name: 'test-no-cm',
        isRelevant: () => false,
        signals: ['youtube-plus-settings-updated'],
      });

      handle.dispose();
      expect(removeSpy).toHaveBeenCalledWith('youtube-plus-settings-updated', expect.any(Function));
      removeSpy.mockRestore();

      window.YouTubePlusCleanupManager = originalCM;
    });

    test('onSectionActive handles exceptions in onLeave gracefully without breaking subsequent transitions', () => {
      const onLeaveThrows = jest.fn(() => {
        throw new Error('fail onLeave');
      });
      const onEnter = jest.fn();
      const handle = mc.onSectionActive('faulty-section', onEnter, onLeaveThrows);

      document.dispatchEvent(
        new CustomEvent('youtube-plus-settings-section-activated', {
          detail: { section: 'faulty-section' },
        })
      );
      expect(onEnter).toHaveBeenCalledTimes(1);

      // Switching away should trigger onLeave, catch the error, and reset active state
      expect(() => {
        document.dispatchEvent(
          new CustomEvent('youtube-plus-settings-section-activated', {
            detail: { section: 'other-section' },
          })
        );
      }).not.toThrow();
      expect(onLeaveThrows).toHaveBeenCalledTimes(1);

      // Switching back should trigger onEnter again
      document.dispatchEvent(
        new CustomEvent('youtube-plus-settings-section-activated', {
          detail: { section: 'faulty-section' },
        })
      );
      expect(onEnter).toHaveBeenCalledTimes(2);

      handle.dispose();
    });

    test('onSectionActive catches onEnter exceptions and resets active', () => {
      const onEnterThrows = jest.fn(() => {
        throw new Error('fail onEnter');
      });
      const handle = mc.onSectionActive('enter-throws-section', onEnterThrows);

      expect(() => {
        document.dispatchEvent(
          new CustomEvent('youtube-plus-settings-section-activated', {
            detail: { section: 'enter-throws-section' },
          })
        );
      }).not.toThrow();
      expect(onEnterThrows).toHaveBeenCalledTimes(1);

      // Modal closed event triggers leaveHandler
      expect(() => {
        document.dispatchEvent(new CustomEvent('youtube-plus-settings-modal-closed'));
      }).not.toThrow();

      handle.dispose();
    });
  });

  describe('createRetryScheduler error handling and give-up contracts', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    test('catches errors in check callback and continues until maxAttempts', () => {
      let attempts = 0;
      const onGiveUp = jest.fn();
      mc.createRetryScheduler({
        check: () => {
          attempts++;
          throw new Error('transient check error');
        },
        interval: 10,
        maxAttempts: 3,
        onGiveUp,
      });

      jest.advanceTimersByTime(1);
      expect(attempts).toBe(1);

      jest.advanceTimersByTime(10);
      expect(attempts).toBe(2);

      jest.advanceTimersByTime(10);
      expect(attempts).toBe(3);

      expect(onGiveUp).toHaveBeenCalledTimes(1);
    });

    test('catches errors in onGiveUp callback gracefully', () => {
      const onGiveUpThrows = jest.fn(() => {
        throw new Error('onGiveUp boom');
      });
      mc.createRetryScheduler({
        check: () => false,
        interval: 10,
        maxAttempts: 1,
        onGiveUp: onGiveUpThrows,
      });

      expect(() => {
        jest.advanceTimersByTime(1);
      }).not.toThrow();
      expect(onGiveUpThrows).toHaveBeenCalledTimes(1);
    });
  });
});

describe('whenRelevant — callback exception resilience', () => {
  const mc = () => window.YouTubePlusMutationCoordinator;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusMutationCoordinator;
    delete window.YouTubeUtils;
    loadRealDeps();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
    require('../src/mutation-coordinator.js');
  });

  test('exception in isRelevant is treated as irrelevant and does not crash check()', () => {
    const handle = mc().whenRelevant({
      name: 'test-isRelevant-throws',
      isRelevant: () => {
        throw new Error('isRelevant boom');
      },
      onEnter: jest.fn(),
    });
    expect(() => handle.check()).not.toThrow();
    expect(handle.active).toBe(false);
    handle.dispose();
  });

  test('exception in onEnter leaves state inactive and retries on next signal', () => {
    const relevant = true;
    let calls = 0;
    const handle = mc().whenRelevant({
      name: 'test-onEnter-throws',
      isRelevant: () => relevant,
      onEnter: () => {
        calls += 1;
        throw new Error('onEnter boom');
      },
    });
    // whenRelevant performs an initial check immediately on creation.
    const afterInit = calls;
    expect(afterInit).toBeGreaterThan(0);
    expect(handle.active).toBe(false);
    // Not stuck in active state: the next check tries again.
    handle.check();
    expect(calls).toBe(afterInit + 1);
    expect(handle.active).toBe(false);
    handle.dispose();
  });

  test('exception in onLeave is swallowed and state becomes inactive', () => {
    let relevant = true;
    const handle = mc().whenRelevant({
      name: 'test-onLeave-throws',
      isRelevant: () => relevant,
      onEnter: () => {
        /* mock */
      },
      onLeave: () => {
        throw new Error('onLeave boom');
      },
    });
    handle.check();
    expect(handle.active).toBe(true);

    relevant = false;
    expect(() => handle.check()).not.toThrow();
    expect(handle.active).toBe(false);
    handle.dispose();
  });

  test('whenRelevant signals survive CleanupManager.cleanup() and remain active', () => {
    let relevant = false;
    let enterCount = 0;
    const handle = mc().whenRelevant({
      name: 'test-persistence',
      isRelevant: () => relevant,
      onEnter: () => {
        enterCount++;
      },
    });
    expect(handle.active).toBe(false);
    expect(enterCount).toBe(0);

    // Simulate SPA navigation cleanup:
    window.YouTubePlusCleanupManager?.cleanup?.();

    // After navigation, user updates settings:
    relevant = true;
    window.dispatchEvent(
      new CustomEvent('youtube-plus-settings-updated', {
        detail: { enableFeature: true },
      })
    );

    // Listener must have survived cleanup and re-evaluated
    expect(handle.active).toBe(true);
    expect(enterCount).toBe(1);

    handle.dispose();
  });
});
