/**
 * Canonical listener tracker semantics vs native EventTarget.
 *
 * The tracker hooks EventTarget.prototype in the test window; every test
 * asserts the TRACKED behavior equals the native EventTarget contract:
 * callback identity, capture, once, signal, duplicate registration, manual
 * removal, reentrancy and restore.
 */

const { installListenerTracker } = require('../scripts/listener-tracker');

describe('listener tracker native semantics', () => {
  let tracker;

  beforeEach(() => {
    for (const key of [
      '__ytpTrackerInstalled__',
      '__ytpGetListenerCount',
      '__ytpGetTargetListenerCount',
      '__ytpRestoreListenerTracker',
    ]) {
      delete window[key];
    }
    tracker = installListenerTracker(window);
  });

  afterEach(() => {
    tracker?.restore();
    for (const key of [
      '__ytpTrackerInstalled__',
      '__ytpGetListenerCount',
      '__ytpGetTargetListenerCount',
      '__ytpRestoreListenerTracker',
    ]) {
      delete window[key];
    }
  });

  const newTarget = () => new window.EventTarget();

  test('duplicate once registration fires exactly once (including mixed option shapes)', () => {
    const t = newTarget();
    let calls = 0;
    const cb = () => calls++;
    t.addEventListener('audit', cb, { once: true });
    t.addEventListener('audit', cb, { once: true });
    expect(tracker.getTargetCount(t)).toBe(1);
    expect(Number.isFinite(tracker.getTargetCount(t))).toBe(true);

    // A boolean-options duplicate with the same capture is the same listener.
    t.addEventListener('audit', cb, false);
    t.dispatchEvent(new window.Event('audit'));
    expect(calls).toBe(1);
    // once auto-removal: back to baseline after the invocation.
    expect(tracker.getTargetCount(t)).toBe(0);
    expect(tracker.getTotalCount()).toBe(0);
  });

  test('re-adding the same (type, callback, capture) is a native no-op for both once and non-once', () => {
    const t = newTarget();
    let calls = 0;
    const cb = () => calls++;
    // Non-once first, then once — native dedupe keeps the first registration.
    t.addEventListener('audit', cb);
    t.addEventListener('audit', cb, { once: true });
    t.dispatchEvent(new window.Event('audit'));
    t.dispatchEvent(new window.Event('audit'));
    expect(calls).toBe(2); // no auto-removal: the FIRST registration governs
    expect(tracker.getTargetCount(t)).toBe(1);
  });

  test('once callback identity: this binding and reentrant self re-registration', () => {
    const t = newTarget();
    const seenThis = [];
    let rounds = 0;
    const cb = function (/** @type {Event} */ _e) {
      seenThis.push(this);
      rounds++;
      // Re-register itself exactly once during its own dispatch (native
      // semantics: a listener added during dispatch does not fire for the
      // current event, only for the next one).
      if (rounds === 1) t.addEventListener('audit', cb, { once: true });
    };
    t.addEventListener('audit', cb, { once: true });
    t.dispatchEvent(new window.Event('audit'));
    // The re-added once listener is armed exactly once between dispatches.
    expect(tracker.getTargetCount(t)).toBe(1);
    t.dispatchEvent(new window.Event('audit'));
    expect(rounds).toBe(2);
    // After the second invocation the once listener self-removed again.
    expect(tracker.getTargetCount(t)).toBe(0);
    for (const receiver of seenThis) {
      expect(receiver).toBe(t);
    }
    expect(Number.isFinite(tracker.getTotalCount())).toBe(true);
  });

  test('capture phases: tracker keeps capture identity and ordering', () => {
    // Bubbling needs real DOM nodes (an EventTarget cannot be a parent).
    const root = document.createElement('div');
    const child = document.createElement('span');
    root.appendChild(child);
    document.body.appendChild(root);
    const order = [];
    const cap = () => order.push('capture');
    const bub = () => order.push('bubble');
    root.addEventListener('audit', cap, true);
    root.addEventListener('audit', bub);
    expect(tracker.getTargetCount(root)).toBe(2);

    const e = new window.Event('audit', { bubbles: true });
    child.dispatchEvent(e);
    expect(order).toEqual(['capture', 'bubble']);

    root.removeEventListener('audit', cap, true);
    expect(tracker.getTargetCount(root)).toBe(1);
    order.length = 0;
    child.dispatchEvent(e);
    expect(order).toEqual(['bubble']);
    root.removeEventListener('audit', bub);
    expect(tracker.getTargetCount(root)).toBe(0);
    document.body.removeChild(root);
  });

  test('manual remove decrements to baseline; empty per-type maps are not retained', () => {
    const t = newTarget();
    const cb = () => {
      /* mock */
    };
    t.addEventListener('a', cb);
    t.addEventListener('b', cb);
    expect(tracker.getTargetCount(t)).toBe(2);
    t.removeEventListener('a', cb);
    t.removeEventListener('b', cb);
    expect(tracker.getTargetCount(t)).toBe(0);
    expect(tracker.getTotalCount()).toBe(0);
    // No type map remains: re-adding works from a clean slate.
    t.addEventListener('a', cb);
    expect(tracker.getTargetCount(t)).toBe(1);
  });

  test('AbortSignal auto-removal decrements counts; already-aborted never registers', () => {
    const t = newTarget();
    let calls = 0;
    const cb = () => calls++;

    const ac = new window.AbortController();
    t.addEventListener('audit', cb, { signal: ac.signal });
    expect(tracker.getTargetCount(t)).toBe(1);
    ac.abort();
    expect(tracker.getTargetCount(t)).toBe(0);
    t.dispatchEvent(new window.Event('audit'));
    expect(calls).toBe(0);

    const aborted = new window.AbortController();
    aborted.abort();
    t.addEventListener('audit', cb, { signal: aborted.signal });
    expect(tracker.getTargetCount(t)).toBe(0);
    t.dispatchEvent(new window.Event('audit'));
    expect(calls).toBe(0);
  });

  test('other listeners survive one listener removal (shared roots)', () => {
    const t = newTarget();
    let a = 0;
    let b = 0;
    const aCb = () => a++;
    const bCb = () => b++;
    t.addEventListener('audit', aCb);
    t.addEventListener('audit', bCb);
    t.removeEventListener('audit', aCb);
    t.dispatchEvent(new window.Event('audit'));
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(tracker.getTargetCount(t)).toBe(1);
  });

  test('removeEventListener of an unknown listener is a clean no-op', () => {
    const t = newTarget();
    const cb = () => {
      /* mock */
    };
    t.removeEventListener('audit', cb);
    expect(tracker.getTargetCount(t)).toBe(0);
    expect(tracker.getTotalCount()).toBe(0);
  });

  test('counts are always finite numbers (never NaN) across churn', () => {
    const targets = [];
    for (let i = 0; i < 100; i++) {
      const t = newTarget();
      const cb = () => {
        /* mock */
      };
      t.addEventListener('churn', cb);
      t.addEventListener('churn', cb, { once: true });
      t.dispatchEvent(new window.Event('churn'));
      t.removeEventListener('churn', cb);
      targets.push(t);
    }
    expect(Number.isFinite(tracker.getTotalCount())).toBe(true);
    expect(tracker.getTotalCount()).toBe(0);
    for (const t of targets) {
      expect(Number.isFinite(tracker.getTargetCount(t))).toBe(true);
    }
  });

  test('restore() removes the hooks and the tracker globals', () => {
    tracker.restore();
    expect(window.__ytpTrackerInstalled__).toBeUndefined();
    expect(window.__ytpGetListenerCount).toBeUndefined();

    // Native behavior returns: a fresh once listener fires exactly once and
    // native dedupe holds — the tracker no longer observes anything.
    const t = newTarget();
    let calls = 0;
    const cb = () => calls++;
    t.addEventListener('audit', cb, { once: true });
    t.addEventListener('audit', cb, { once: true });
    t.dispatchEvent(new window.Event('audit'));
    expect(calls).toBe(1);

    // Re-install after restore must work again.
    const second = installListenerTracker(window);
    try {
      const t2 = newTarget();
      let calls2 = 0;
      const cb2 = () => calls2++;
      t2.addEventListener('audit', cb2, { once: true });
      t2.addEventListener('audit', cb2, { once: true });
      t2.dispatchEvent(new window.Event('audit'));
      expect(calls2).toBe(1);
      expect(second.getTargetCount(t2)).toBe(0);
    } finally {
      second.restore();
    }
  });
});
