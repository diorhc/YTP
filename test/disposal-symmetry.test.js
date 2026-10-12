/**
 * Disposal symmetry of the shared registries.
 *
 * ScrollManager (utils.js): the returned disposer must release EVERY
 * thing the registration owns — native listener, pending debounce timer, the
 * CleanupManager bookkeeping entry AND its own ScrollManager registry entry —
 * so detached DOM roots never linger in the Map. Single-handler disposal must
 * not remove neighbours; removeAllListeners must tolerate mutation during
 * iteration.
 *
 * CleanupManager once: the stale once-identity is released BEFORE the
 * user callback runs, so a re-entrant re-registration of the same fn with
 * {once:true} creates a NEW independent record (two dispatches → two calls).
 *
 * Other contracts must stay intact: capture, manual remove, abort signals,
 * non-function callbacks (rejected) and repeated cleanup.
 * @jest-environment jsdom
 */

function loadCore() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/mutation-coordinator.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/design-system.js');
  require('../src/feature-registry.js');
}

describe('ScrollManager releases disposed roots completely', () => {
  /** @type {any} */
  let ScrollManager;
  /** @type {any} */
  let cm;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    loadCore();
    ScrollManager = window.YouTubePlusScrollManager;
    cm = window.YouTubePlusCleanupManager;
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('20 detached roots + disposers leave 0 entries and 0 managed keys', () => {
    /** @type {{ target: Element, dispose: () => void }[]} */
    const roots = [];
    for (let i = 0; i < 20; i++) {
      const target = document.createElement('div'); // never attached
      const dispose = ScrollManager.addScrollListener(target, () => {
        /* mock */
      });
      roots.push({ target, dispose });
    }

    expect(ScrollManager.size()).toBe(20);
    expect(
      [...cm.listeners.values()].filter(entry => roots.some(r => r.target === entry.target)).length
    ).toBe(20);

    for (const { dispose } of roots) dispose();
    // Full cleanup sweep (as the SPA navigation does):
    cm.cleanup();

    expect(ScrollManager.size()).toBe(0);
    expect(
      [...cm.listeners.values()].filter(entry => roots.some(r => r.target === entry.target)).length
    ).toBe(0);
  });

  test('reused root with several handlers: one disposal removes only its own entry', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const calls = { a: 0, b: 0, c: 0 };
    const disposeA = ScrollManager.addScrollListener(target, () => calls.a++);
    ScrollManager.addScrollListener(target, () => calls.b++);
    const disposeC = ScrollManager.addScrollListener(target, () => calls.c++);

    expect(ScrollManager.size()).toBe(3);

    // Disposing the MIDDLE handler keeps the neighbours.
    disposeC();
    expect(ScrollManager.size()).toBe(2);
    target.dispatchEvent(new Event('scroll'));
    jest.advanceTimersByTime(200);
    expect(calls.a).toBe(1);
    expect(calls.b).toBe(1);
    expect(calls.c).toBe(0);

    // Re-dispose is idempotent and does not touch the neighbours.
    disposeC();
    expect(ScrollManager.size()).toBe(2);

    disposeA();
    ScrollManager.removeAllListeners(target);
    expect(ScrollManager.size()).toBe(0);
    target.dispatchEvent(new Event('scroll'));
    jest.advanceTimersByTime(200);
    expect(calls.a).toBe(1);
    expect(calls.b).toBe(1);
  });

  test('disposer before the debounce fires leaves no pending callback', () => {
    const target = document.createElement('div');
    let calls = 0;
    const dispose = ScrollManager.addScrollListener(target, () => calls++);

    target.dispatchEvent(new Event('scroll'));
    dispose(); // before the 100ms debounce elapses

    jest.advanceTimersByTime(500);
    expect(calls).toBe(0);
  });

  test('removeAllListeners is correct while the bucket mutates during iteration', () => {
    const target = document.createElement('div');
    const disposers = [];
    for (let i = 0; i < 5; i++) {
      disposers.push(
        ScrollManager.addScrollListener(target, () => {
          /* mock */
        })
      );
    }
    expect(ScrollManager.size()).toBe(5);

    ScrollManager.removeAllListeners(target);
    expect(ScrollManager.size()).toBe(0);

    // Manual disposers after removeAllListeners are no-ops (idempotent).
    for (const dispose of disposers) dispose();
    expect(ScrollManager.size()).toBe(0);
  });
});

describe('CleanupManager once identity and removal semantics', () => {
  /** @type {any} */
  let cm;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    loadCore();
    cm = window.YouTubePlusCleanupManager;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('reentrant once re-registration creates a NEW record: two dispatches, two calls', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    let calls = 0;
    const handler = () => {
      calls += 1;
      // Re-register the SAME fn while it is executing.
      cm.registerListener(target, 'custom', handler, { once: true });
    };

    cm.registerListener(target, 'custom', handler, { once: true });

    target.dispatchEvent(new Event('custom'));
    expect(calls).toBe(1);

    target.dispatchEvent(new Event('custom'));
    expect(calls).toBe(2);
  });

  test('capture, manual remove, abort, callback object and repeated cleanup stay correct', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    // Capture semantics: register + remove.
    let captureCalls = 0;
    const captureHandler = () => captureCalls++;
    const key = cm.registerListener(target, 'ping', captureHandler, { capture: true });
    expect(key).not.toBeNull();
    target.dispatchEvent(new Event('ping'));
    expect(captureCalls).toBe(1);
    cm.unregisterListener(key);
    target.dispatchEvent(new Event('ping'));
    expect(captureCalls).toBe(1);

    // Abort signal removes the registration.
    const controller = new AbortController();
    let abortCalls = 0;
    cm.registerListener(target, 'abortable', () => abortCalls++, {
      signal: controller.signal,
    });
    controller.abort();
    target.dispatchEvent(new Event('abortable'));
    expect(abortCalls).toBe(0);

    // Non-function callbacks are rejected (same contract as before).
    const objectListener = {
      handleEvent: () => {
        /* mock */
      },
    };
    expect(
      cm.registerListener(target, 'object-event', /** @type {any} */ (objectListener))
    ).toBeNull();

    // Repeated cleanup stays safe.
    expect(() => {
      cm.cleanup();
      cm.cleanup();
    }).not.toThrow();
  });
});
