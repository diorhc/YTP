/**
 * Unit tests for src/cleanup-manager.js (the canonical resource
 * lifecycle manager). Covers the register/cleanup lifecycle for
 * observers, listeners, timers, animation frames, and custom
 * callbacks.
 */

describe("YouTubePlusCleanupManager", () => {
  /** @type {any} */
  let cm;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusCleanupManager;
    delete window.YouTubeUtils;
    require("../src/cleanup-manager.js");
    cm = window.YouTubePlusCleanupManager;
  });

  test("register() and cleanup() lifecycle: callbacks fire and clear", () => {
    const cb = jest.fn();
    cm.register(cb);
    cm.cleanup();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test("cleanup() empties the callback set so callbacks do not fire twice", () => {
    const cb = jest.fn();
    cm.register(cb);
    cm.cleanup();
    cm.cleanup();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test("registerListener() returns a Symbol key and adds the listener", () => {
    const target = document.createElement("div");
    const handler = jest.fn();
    const key = cm.registerListener(target, "click", handler);

    expect(typeof key).toBe("symbol");

    const event = new Event("click");
    target.dispatchEvent(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("cleanup() removes listeners so they stop firing", () => {
    const target = document.createElement("div");
    const handler = jest.fn();
    cm.registerListener(target, "click", handler);
    cm.cleanup();

    target.dispatchEvent(new Event("click"));
    expect(handler).not.toHaveBeenCalled();
  });

  test("double cleanup() is safe (idempotent)", () => {
    const cb = jest.fn();
    cm.register(cb);
    cm.cleanup();
    expect(() => cm.cleanup()).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test("registerTimeout() tracks the ID and cleanup() clears it", () => {
    const id = setTimeout(() => {}, 1000);
    cm.registerTimeout(id);
    expect(cm.timeouts.has(id)).toBe(true);

    cm.cleanup();
    expect(cm.timeouts.size).toBe(0);
    // The underlying timer should have been cleared by the
    // manager's cleanup() call, so it never fires.
  });

  test("registerInterval() tracks the ID and cleanup() clears it", () => {
    const id = setInterval(() => {}, 1000);
    cm.registerInterval(id);
    expect(cm.intervals.has(id)).toBe(true);

    cm.cleanup();
    expect(cm.intervals.size).toBe(0);
  });

  test("cleanup() disconnects registered observers", () => {
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer);
    expect(cm.observers.has(observer)).toBe(true);

    cm.cleanup();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cm.observers.size).toBe(0);
  });

  test("cleanup() continues if a single callback throws", () => {
    const good = jest.fn();
    const bad = jest.fn(() => {
      throw new Error("boom");
    });
    cm.register(bad);
    cm.register(good);
    cm.cleanup();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // registerObserver with element tracking
  // ---------------------------------------------------------------------------

  test("registerObserver with element tracks via elementObservers WeakMap", () => {
    const el = document.createElement("div");
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer, el);
    expect(cm.observers.has(observer)).toBe(true);
    // The WeakMap should have an entry keyed by el
    expect(cm.elementObservers.has(el)).toBe(true);
  });

  test("registerObserver with null element does not track in elementObservers", () => {
    const observer = { disconnect: jest.fn() };
    cm.registerObserver(observer, null);
    expect(cm.observers.has(observer)).toBe(true);
    // No element was passed, so no WeakMap entry
  });

  test("registerObserver with non-object element is silently ignored", () => {
    const observer = { disconnect: jest.fn() };
    cm.registerObserver(observer, "string-element");
    expect(cm.observers.has(observer)).toBe(true);
    // Non-object 'el' should not throw, just be ignored
  });

  // ---------------------------------------------------------------------------
  // disconnectForElement / disconnectObserver
  // ---------------------------------------------------------------------------

  test("disconnectForElement disconnects observers for a tracked element", () => {
    const el = document.createElement("div");
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer, el);
    expect(cm.elementObservers.has(el)).toBe(true);

    cm.disconnectForElement(el);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cm.elementObservers.has(el)).toBe(false);
    expect(cm.observers.has(observer)).toBe(false);
  });

  test("disconnectForElement with untracked element does nothing", () => {
    const el = document.createElement("div");
    expect(() => cm.disconnectForElement(el)).not.toThrow();
  });

  test("disconnectObserver disconnects and removes a single observer", () => {
    const disconnect = jest.fn();
    const observer = { disconnect };
    cm.registerObserver(observer);
    expect(cm.observers.has(observer)).toBe(true);

    cm.disconnectObserver(observer);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cm.observers.has(observer)).toBe(false);
  });

  test("disconnectObserver with null is a no-op", () => {
    expect(() => cm.disconnectObserver(null)).not.toThrow();
  });

  test("disconnectObserver with observer that has no disconnect is safe", () => {
    const observer = { foo: "bar" };
    cm.registerObserver(observer);
    expect(() => cm.disconnectObserver(observer)).not.toThrow();
    expect(cm.observers.has(observer)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // registerAnimationFrame
  // ---------------------------------------------------------------------------

  test("registerAnimationFrame tracks the ID and cleanup cancels it", () => {
    // requestAnimationFrame may not be available in jsdom, so use a mock
    const raf = jest
      .spyOn(globalThis, "requestAnimationFrame")
      .mockReturnValue(42);
    const caf = jest
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation(() => {});

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

  test("getListenerStats returns active and registeredTotal counts", () => {
    const stats = cm.getListenerStats();
    expect(stats).toEqual({ active: 0, registeredTotal: 0 });
  });

  test("getListenerStats reflects registered listeners", () => {
    const target = document.createElement("div");
    cm.registerListener(target, "click", jest.fn());
    cm.registerListener(target, "keydown", jest.fn());

    const stats = cm.getListenerStats();
    expect(stats.active).toBe(2);
    expect(stats.registeredTotal).toBe(2);
  });

  test("getListenerStats survives cleanup", () => {
    cm.registerListener(document.createElement("div"), "click", jest.fn());
    cm.cleanup();
    const stats = cm.getListenerStats();
    expect(stats.active).toBe(0);
    expect(stats.registeredTotal).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // YouTubeUtils integration (window.YouTubeUtils.cleanupManager)
  // ---------------------------------------------------------------------------

  test("sets cleanupManager on window.YouTubeUtils when YouTubeUtils exists", () => {
    // YouTubeUtils was deleted in beforeEach; set it up before re-loading
    jest.resetModules();
    delete window.YouTubePlusCleanupManager;
    window.YouTubeUtils = {};
    require("../src/cleanup-manager.js");
    const cm2 = window.YouTubePlusCleanupManager;
    expect(window.YouTubeUtils.cleanupManager).toBe(cm2);
  });

  test("does not override existing YouTubeUtils.cleanupManager", () => {
    const existing = { mock: true };
    jest.resetModules();
    delete window.YouTubePlusCleanupManager;
    window.YouTubeUtils = { cleanupManager: existing };
    require("../src/cleanup-manager.js");
    expect(window.YouTubeUtils.cleanupManager).toBe(existing);
  });

  // ---------------------------------------------------------------------------
  // Edge cases: error resilience
  // ---------------------------------------------------------------------------

  test("registerListener handles target.addEventListener throwing", () => {
    const badTarget = {
      addEventListener: jest.fn(() => {
        throw new Error("addEventListener failed");
      }),
    };
    // Should not throw, should log via logError
    const key = cm.registerListener(badTarget, "click", jest.fn());
    expect(key).toBeNull();
  });

  test("cleanup continues when observer.disconnect throws", () => {
    const disconnect = jest.fn(() => {
      throw new Error("disconnect failed");
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

  test("register with non-function is ignored", () => {
    cm.register("not-a-function");
    cm.register(null);
    cm.register(undefined);
    cm.register(42);
    // No callbacks to fire, cleanup should not crash
    expect(() => cm.cleanup()).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // unsafeWindow propagation
  // ---------------------------------------------------------------------------

  test("sets YouTubePlusCleanupManager on unsafeWindow", () => {
    // unsafeWindow is mocked to window in setup.js
    expect(unsafeWindow.YouTubePlusCleanupManager).toBe(cm);
  });
});
