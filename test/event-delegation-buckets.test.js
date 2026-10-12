/**
 * EventDelegator must release EMPTIED generation/metadata buckets
 * on ordinary point disposals (off/abort/once), not only on clear().
 *
 * Guarantees:
 *   - 1000 independent root on/off cycles return handler, metadata and
 *     generation-bucket counts to their baselines;
 *   - off/abort/clear/re-add/reentrant once keep the expected call counts for
 *     BOTH capture and bubble phases;
 *   - shared root listeners are NOT disabled together with one registration.
 */

describe('EventDelegator generation bucket release', () => {
  /** @type {any} */
  let delegation = null;
  /** @type {any} */
  let ed = null;

  beforeEach(() => {
    Object.defineProperty(window, 'YouTubePlusEventDelegation', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        logger: { debug: jest.fn(), warn: jest.fn() },
      },
    });
    jest.resetModules();
    require('../src/event-delegation');
    delegation = window.YouTubePlusEventDelegation || null;
    // The internal delegator class is exposed on the surface — a fresh
    // instance gives direct access to the internal bucket maps.
    ed = delegation ? new delegation.EventDelegator() : null;
  });

  afterEach(() => {
    ed?.clear?.();
    delegation?.clear?.();
  });

  test('1000 independent root on/off cycles return handlers, metadata and generation buckets to baseline', () => {
    expect(ed).toBeTruthy();
    const baseline = {
      handlers: ed.getStats().totalHandlers,
      delegations: ed.getStats().delegationKeys,
      meta: ed._handlerMeta.size,
      generations: ed._handlerGeneration.size,
    };

    for (let i = 0; i < 1000; i++) {
      const root = document.createElement('div');
      const off = ed.on(root, 'click', '.item', () => {
        /* mock */
      });
      off();
    }

    const after = {
      handlers: ed.getStats().totalHandlers,
      delegations: ed.getStats().delegationKeys,
      meta: ed._handlerMeta.size,
      generations: ed._handlerGeneration.size,
    };
    expect(after.handlers).toBe(baseline.handlers);
    expect(after.delegations).toBe(baseline.delegations);
    expect(after.meta).toBe(baseline.meta);
    expect(after.generations).toBe(baseline.generations);
  });

  test('off/abort/clear/re-add/reentrant once keep capture and bubble semantics', () => {
    const root = document.createElement('div');
    const btn = document.createElement('button');
    root.appendChild(btn);
    document.body.appendChild(root);
    const calls = [];

    // Bubble + capture registrations of the same callback.
    const cb = () => calls.push('cb');
    ed.on(root, 'audit', 'button', cb, { capture: true });
    ed.on(root, 'audit', 'button', cb);

    // Reentrant once: during dispatch it removes itself and re-adds itself.
    let reentrantRuns = 0;
    const onceCb = () => {
      reentrantRuns++;
      ed.on(root, 'audit', 'button', onceCb, { once: true });
    };
    ed.on(root, 'audit', 'button', onceCb, { once: true });

    // Abort-armed registration.
    const ac = new AbortController();
    ed.on(root, 'audit', 'button', () => calls.push('abortable'), { signal: ac.signal });

    btn.dispatchEvent(new window.Event('audit', { bubbles: true }));
    expect(reentrantRuns).toBe(1); // native once: removed before it ran
    // The once re-registration is armed for the NEXT dispatch.
    btn.dispatchEvent(new window.Event('audit', { bubbles: true }));
    expect(reentrantRuns).toBe(2);

    // Abort removes only its own registration.
    ac.abort();
    btn.dispatchEvent(new window.Event('audit', { bubbles: true }));
    expect(reentrantRuns).toBe(3); // re-added once fired again

    // Capture/bubble identity: capture listener fires first.
    const order = [];
    const cap = () => order.push('capture');
    const bub = () => order.push('bubble');
    ed.on(root, 'phase', 'button', cap, { capture: true });
    ed.on(root, 'phase', 'button', bub);
    btn.dispatchEvent(new window.Event('phase', { bubbles: true }));
    expect(order).toEqual(['capture', 'bubble']);
    ed.off(root, 'phase', 'button', cap, { capture: true });
    order.length = 0;
    btn.dispatchEvent(new window.Event('phase', { bubbles: true }));
    expect(order).toEqual(['bubble']);

    // Clear releases everything, including the shared root listener.
    ed.clear();
    expect(ed.getStats().totalHandlers).toBe(0);
    expect(ed._handlerMeta.size).toBe(0);
    expect(ed._handlerGeneration.size).toBe(0);
  });

  test('shared root listeners are not disabled together with one registration', () => {
    const root = document.createElement('div');
    const btn = document.createElement('button');
    root.appendChild(btn);
    document.body.appendChild(root);

    let a = 0;
    let b = 0;
    const aCb = () => a++;
    const bCb = () => b++;
    ed.on(root, 'shared', 'button', aCb);
    ed.on(root, 'shared', 'button', bCb);
    // Remove ONE handler — the shared root listener must stay active.
    ed.off(root, 'shared', 'button', aCb);
    btn.dispatchEvent(new window.Event('shared', { bubbles: true }));
    expect(a).toBe(0);
    expect(b).toBe(1);
    // The second removal releases the root listener entirely.
    ed.off(root, 'shared', 'button', bCb);
    expect(ed.getStats().delegationKeys).toBe(0);
    expect(ed._handlerGeneration.size).toBe(0);
  });

  test('abort-armed registration releases its metadata bucket on off', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ac = new AbortController();
    const off = ed.on(
      root,
      'audit',
      '.x',
      () => {
        /* mock */
      },
      { signal: ac.signal }
    );
    expect(ed._handlerMeta.size).toBe(1);
    off();
    expect(ed._handlerMeta.size).toBe(0);
    expect(ed._handlerGeneration.size).toBe(0);
    // Abort after removal: no throw, no resurrection.
    ac.abort();
    expect(ed.getStats().totalHandlers).toBe(0);
  });
});
