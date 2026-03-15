/**
 * Memory leak regression test — verifies that SPA navigation cycles
 * do not cause observers/listeners to accumulate unboundedly.
 *
 * Simulates the cleanupManager lifecycle: register → cleanup → re-register
 * and asserts internal counts stabilize.
 */

describe('Memory leak regression — SPA navigation cycle', () => {
  /**
   * Simplified cleanupManager (same structure as utils.js)
   */
  function createCleanupManager() {
    const observers = new Set();
    const listeners = new Map();
    const intervals = new Set();
    const timeouts = new Set();
    let registeredTotal = 0;

    return {
      observers,
      listeners,
      intervals,
      registerObserver(o) {
        if (o) observers.add(o);
        return o;
      },
      registerListener(target, ev, fn, opts) {
        target.addEventListener(ev, fn, opts);
        const key = Symbol();
        listeners.set(key, { target, ev, fn, opts });
        registeredTotal++;
        return key;
      },
      registerInterval(id) {
        intervals.add(id);
        return id;
      },
      cleanup() {
        for (const o of observers) {
          if (o && typeof o.disconnect === 'function') o.disconnect();
        }
        observers.clear();

        for (const entry of listeners.values()) {
          entry.target.removeEventListener(entry.ev, entry.fn, entry.opts);
        }
        listeners.clear();

        for (const id of intervals) clearInterval(id);
        intervals.clear();
        for (const id of timeouts) clearTimeout(id);
        timeouts.clear();
      },
      getStats() {
        return {
          observers: observers.size,
          listeners: listeners.size,
          intervals: intervals.size,
          registeredTotal,
        };
      },
    };
  }

  /**
   * Simplified ObserverRegistry (same structure as utils.js)
   */
  function createObserverRegistry() {
    const registry = new Map();
    return {
      register(name, obs) {
        registry.set(name, { observer: obs, registeredAt: Date.now() });
      },
      unregister(name) {
        const entry = registry.get(name);
        if (entry && entry.observer?.disconnect) entry.observer.disconnect();
        registry.delete(name);
      },
      getStats() {
        return { totalRegistered: registry.size, names: [...registry.keys()] };
      },
    };
  }

  /**
   * Simulate a single "module init" that registers observers + listeners
   * (mimics what src/ modules do on page load)
   */
  function simulateModuleInit(cm, registry) {
    // Register 3 MutationObservers
    const obs1 = new MutationObserver(() => {});
    const obs2 = new MutationObserver(() => {});
    const obs3 = new MutationObserver(() => {});
    cm.registerObserver(obs1);
    cm.registerObserver(obs2);
    cm.registerObserver(obs3);
    registry.register('testObs1', obs1);
    registry.register('testObs2', obs2);
    registry.register('testObs3', obs3);

    // Register 5 event listeners
    for (let i = 0; i < 5; i++) {
      cm.registerListener(document, 'click', () => {});
    }

    // Register 1 interval
    const intervalId = setInterval(() => {}, 60000);
    cm.registerInterval(intervalId);
  }

  test('observer/listener counts stabilize after 20 SPA navigation cycles', () => {
    const cm = createCleanupManager();
    const registry = createObserverRegistry();

    const counts = [];

    // Simulate 20 navigation cycles: each triggers cleanup then re-init
    for (let cycle = 0; cycle < 20; cycle++) {
      // Cleanup from previous navigation
      if (cycle > 0) {
        cm.cleanup();
        registry.unregister('testObs1');
        registry.unregister('testObs2');
        registry.unregister('testObs3');
      }

      // Re-init modules
      simulateModuleInit(cm, registry);

      // Record counts after init
      const stats = cm.getStats();
      const regStats = registry.getStats();
      counts.push({
        observers: stats.observers,
        listeners: stats.listeners,
        intervals: stats.intervals,
        registrySize: regStats.totalRegistered,
      });
    }

    // Verify steady state: all cycles after the first should have identical counts
    const first = counts[0];
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i].observers).toBe(first.observers);
      expect(counts[i].listeners).toBe(first.listeners);
      expect(counts[i].intervals).toBe(first.intervals);
      expect(counts[i].registrySize).toBe(first.registrySize);
    }

    // Verify absolute counts are reasonable
    expect(first.observers).toBe(3);
    expect(first.listeners).toBe(5);
    expect(first.intervals).toBe(1);
    expect(first.registrySize).toBe(3);
  });

  test('cleanup removes all registered resources', () => {
    const cm = createCleanupManager();

    // Register various resources
    const obs = new MutationObserver(() => {});
    cm.registerObserver(obs);
    cm.registerListener(document, 'click', () => {});
    cm.registerListener(document, 'keydown', () => {});
    cm.registerInterval(setInterval(() => {}, 60000));

    const before = cm.getStats();
    expect(before.observers).toBe(1);
    expect(before.listeners).toBe(2);
    expect(before.intervals).toBe(1);

    // Cleanup
    cm.cleanup();

    const after = cm.getStats();
    expect(after.observers).toBe(0);
    expect(after.listeners).toBe(0);
    expect(after.intervals).toBe(0);
  });

  test('re-registration after cleanup does not accumulate', () => {
    const cm = createCleanupManager();
    const registry = createObserverRegistry();

    // Cycle 1
    simulateModuleInit(cm, registry);
    expect(cm.getStats().observers).toBe(3);

    // Cleanup
    cm.cleanup();
    registry.unregister('testObs1');
    registry.unregister('testObs2');
    registry.unregister('testObs3');
    expect(cm.getStats().observers).toBe(0);
    expect(registry.getStats().totalRegistered).toBe(0);

    // Cycle 2
    simulateModuleInit(cm, registry);
    expect(cm.getStats().observers).toBe(3);
    expect(registry.getStats().totalRegistered).toBe(3);

    // Should not have 6 observers (leak) — should have exactly 3
    expect(cm.getStats().observers).not.toBe(6);
  });

  test('registeredTotal keeps growing but active count stays stable', () => {
    const cm = createCleanupManager();
    const registry = createObserverRegistry();

    // Run 5 cycles
    for (let i = 0; i < 5; i++) {
      if (i > 0) {
        cm.cleanup();
        registry.unregister('testObs1');
        registry.unregister('testObs2');
        registry.unregister('testObs3');
      }
      simulateModuleInit(cm, registry);
    }

    const stats = cm.getStats();
    // Active listeners should be constant (5)
    expect(stats.listeners).toBe(5);
    // But total registered grows (5 listeners × 5 cycles = 25)
    expect(stats.registeredTotal).toBe(25);
  });
});
