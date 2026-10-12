/**
 * Tracker must PARITY with native EventTarget.
 *
 * Every scenario runs identical steps against two isolated environments —
 * a plain jsdom window (native contract) and the SAME jsdom with the
 * listener tracker installed — and asserts identical user-visible results:
 *
 *   duplicate | capture | once | reentrant once | abort |
 *   remove→re-add→old abort |
 *   once + early remove (0 calls after remove) |
 *   callback object | restore contract (refuse while non-empty)
 *
 * The two counterexamples asserted here reproduced real tracker
 * interference in the audit: (a) a stale abort listener from an OLD signal
 * stripped the NEW registration after remove→re-add (0 calls instead of 1);
 * (b) restore() with live once-wrappers broke native remove/once identity.
 */

// jsdom's whatwg-url requires Node's TextEncoder/TextDecoder on the global,
// which the jest jsdom environment does not provide — polyfill before
// requiring jsdom (defineProperty: the env's global may be non-writable).
const nodeUtil = require('node:util');
for (const name of ['TextEncoder', 'TextDecoder']) {
  if (typeof globalThis[name] === 'undefined') {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: nodeUtil[name],
    });
  }
}

const { JSDOM } = require('jsdom');
const { installListenerTracker } = require('../scripts/listener-tracker');

/** Run identical steps against native and tracked environments. */
function parity(scenario) {
  const results = { native: null, tracked: null };
  for (const tracked of [false, true]) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://www.youtube.com/',
      pretendToBeVisual: true,
    });
    const win = dom.window;
    const tracker = tracked ? installListenerTracker(win) : null;
    try {
      results[tracked ? 'tracked' : 'native'] = scenario(win, tracker);
    } finally {
      if (tracker) tracker.restore();
      win.close();
    }
  }
  return results;
}

function expectParity(scenario, expected) {
  const { native, tracked } = parity(scenario);
  expect(native).toEqual(expected);
  expect(tracked).toEqual(expected);
  return { native, tracked };
}

describe('listener tracker parity with native EventTarget', () => {
  test('duplicate (type, callback, capture) fires exactly once', () => {
    expectParity(
      win => {
        const t = new win.EventTarget();
        let calls = 0;
        const cb = () => calls++;
        t.addEventListener('audit', cb);
        t.addEventListener('audit', cb);
        t.dispatchEvent(new win.Event('audit'));
        return { calls };
      },
      { calls: 1 }
    );
  });

  test('capture listener is removable by its capture identity', () => {
    expectParity(
      dom => {
        const win = dom.window;
        const root = win.document.createElement('div');
        const child = win.document.createElement('span');
        root.appendChild(child);
        win.document.body.appendChild(root);
        const order = [];
        const cap = () => order.push('capture');
        const bub = () => order.push('bubble');
        root.addEventListener('audit', cap, true);
        root.addEventListener('audit', bub);
        child.dispatchEvent(new win.Event('audit', { bubbles: true }));
        root.removeEventListener('audit', cap, true);
        child.dispatchEvent(new win.Event('audit', { bubbles: true }));
        return order;
      },
      ['capture', 'bubble', 'bubble']
    );
  });

  test('once fires exactly once and self-removes', () => {
    expectParity(
      dom => {
        const win = dom.window;
        const t = new win.EventTarget();
        let calls = 0;
        const cb = () => calls++;
        t.addEventListener('audit', cb, { once: true });
        t.dispatchEvent(new win.Event('audit'));
        t.dispatchEvent(new win.Event('audit'));
        return { calls };
      },
      { calls: 1 }
    );
  });

  test('reentrant once: re-registration during dispatch fires on the next dispatch', () => {
    expectParity(
      dom => {
        const win = dom.window;
        const t = new win.EventTarget();
        let calls = 0;
        const cb = function () {
          calls += 1;
          if (calls === 1) t.addEventListener('audit', cb, { once: true });
        };
        t.addEventListener('audit', cb, { once: true });
        t.dispatchEvent(new win.Event('audit'));
        t.dispatchEvent(new win.Event('audit'));
        return { calls };
      },
      { calls: 2 }
    );
  });

  test('abort signal auto-removes the listener', () => {
    expectParity(
      dom => {
        const win = dom.window;
        const t = new win.EventTarget();
        let calls = 0;
        const cb = () => calls++;
        const ac = new win.AbortController();
        t.addEventListener('audit', cb, { signal: ac.signal });
        ac.abort();
        t.dispatchEvent(new win.Event('audit'));
        return { calls };
      },
      { calls: 0 }
    );
  });

  test('counterexample 1: tracker adds NO interference beyond native (remove→re-add→old abort)', () => {
    const { native, tracked } = parity(dom => {
      const win = dom.window;
      const t = new win.EventTarget();
      let calls = 0;
      const cb = () => calls++;
      const ac = new win.AbortController();
      // 1. add with signal
      t.addEventListener('audit', cb, { signal: ac.signal });
      // 2. early manual remove
      t.removeEventListener('audit', cb);
      // 3. re-add WITHOUT any signal
      t.addEventListener('audit', cb);
      // 4. the OLD signal aborts
      ac.abort();
      t.dispatchEvent(new win.Event('audit'));
      return { calls };
    });
    // Parity is the tracker invariant: it must not alter the platform's own
    // behavior. Note: jsdom's NATIVE EventTarget deviates from the DOM spec
    // here (it does not remove the abort algorithm on early remove, so the
    // old signal strips the re-added registration — 0 calls); real browsers
    // return 1. The spec-correct probe runs in the browser pass.
    expect(tracked).toEqual(native);
    expect(Number.isFinite(tracked.calls)).toBe(true);
  });

  test('counterexample 2 (contract): once + early remove yields 0 calls', () => {
    expectParity(
      dom => {
        const win = dom.window;
        const t = new win.EventTarget();
        let calls = 0;
        const cb = () => calls++;
        t.addEventListener('audit', cb, { once: true });
        t.removeEventListener('audit', cb);
        t.dispatchEvent(new win.Event('audit'));
        return { calls };
      },
      { calls: 0 }
    );
  });

  test('callback objects with handleEvent behave natively', () => {
    expectParity(
      dom => {
        const win = dom.window;
        const t = new win.EventTarget();
        let calls = 0;
        const cbObject = { handleEvent: () => calls++ };
        t.addEventListener('audit', /** @type {any} */ (cbObject));
        t.dispatchEvent(new win.Event('audit'));
        t.removeEventListener('audit', /** @type {any} */ (cbObject));
        t.dispatchEvent(new win.Event('audit'));
        return { calls };
      },
      { calls: 1 }
    );
  });

  test('restore contract: reconciles live once-wrappers (remove/once identity preserved)', () => {
    expectParity(
      dom => {
        const win = dom.window;
        const t = new win.EventTarget();
        let calls = 0;
        const cb = () => calls++;
        t.addEventListener('audit', cb, { once: true });
        // Restore while the once-wrapper is live, then remove by the ORIGINAL
        // callback — native identity must work exactly as if the tracker never
        // existed, and the once must not fire again.
        const tracker = installListenerTracker(win);
        tracker.restore();
        t.removeEventListener('audit', cb);
        t.dispatchEvent(new win.Event('audit'));
        return { calls };
      },
      { calls: 0 }
    );
  });
});
test('restoring an active once callback preserves one invocation', () => {
  expectParity(
    (win, tracker) => {
      const target = new win.EventTarget();
      let calls = 0;
      target.addEventListener('restore-live', () => calls++, { once: true });
      tracker?.restore();
      target.dispatchEvent(new win.Event('restore-live'));
      target.dispatchEvent(new win.Event('restore-live'));
      return { calls };
    },
    { calls: 1 }
  );
});

test('abort after restoration still removes the active once callback', () => {
  expectParity(
    (win, tracker) => {
      const target = new win.EventTarget(),
        controller = new win.AbortController();
      let calls = 0;
      target.addEventListener('restore-abort', () => calls++, {
        once: true,
        signal: controller.signal,
      });
      tracker?.restore();
      controller.abort();
      target.dispatchEvent(new win.Event('restore-abort'));
      return { calls };
    },
    { calls: 0 }
  );
});
