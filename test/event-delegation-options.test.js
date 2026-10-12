/**
 * Per-handler option semantics in
 * the shared delegated listener.
 *
 * Contracts under test (real EventDelegation):
 *   - Root identity: a same-id replacement root gets its own
 *     delegation; the old root's handlers stay dead.
 *   - Capture removal: off() with capture removes the capture
 *     registration, not the bubble one.
 *   - once/signal are PER-HANDLER: a once-handler firing must not
 *     tear down the shared root listener or disable other handlers; an
 *     abort signal removes only its own handler.
 *   - Root listener options are no longer inherited from the first
 *     registrant (no silent once/passive/signal sharing).
 *   - Stats match the live subscriptions.
 */

describe('EventDelegation per-handler options', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    require('../src/event-delegation.js');
  });

  afterEach(() => {
    window.YouTubePlusEventDelegation?.clear?.();
    document.body.innerHTML = '';
  });

  const makeRoot = () => {
    const root = document.createElement('section');
    root.id = 'same';
    root.innerHTML = '<button>x</button>';
    document.body.append(root);
    return root;
  };

  test('replacement root with the same id has its own delegation', () => {
    const ed = window.YouTubePlusEventDelegation;
    const a = makeRoot();
    let old = 0;
    let now = 0;
    ed.on(a, 'click', 'button', () => old++);
    a.remove();
    const b = makeRoot();
    ed.on(b, 'click', 'button', () => now++);
    b.firstChild.click();
    expect(old).toBe(0);
    expect(now).toBe(1);
  });

  test('capture off removes the capture registration', () => {
    const ed = window.YouTubePlusEventDelegation;
    const b = makeRoot();
    let capture = 0;
    const h = () => capture++;
    ed.on(b, 'click', 'button', h, true);
    ed.off(b, 'click', 'button', h);
    ed.on(b, 'click', 'button', h, true);
    b.firstChild.click();
    expect(capture).toBe(1);
  });

  test('once-handler firing does not disable the regular handler', () => {
    const ed = window.YouTubePlusEventDelegation;
    const b = makeRoot();
    let one = 0;
    let normal = 0;
    ed.on(b, 'click', 'button', () => one++, { once: true });
    ed.on(b, 'click', 'button', () => normal++);
    b.firstChild.click();
    b.firstChild.click();
    expect(one).toBe(1);
    expect(normal).toBe(2);
    // Stats match the live subscriptions.
    expect(ed.getStats().totalHandlers).toBe(1);
  });

  test('abort signal removes only its own handler', () => {
    const ed = window.YouTubePlusEventDelegation;
    const b = makeRoot();
    let signalled = 0;
    let regular = 0;
    const controller = new AbortController();
    ed.on(b, 'click', 'button', () => regular++);
    ed.on(b, 'click', 'button', () => signalled++, { signal: controller.signal });

    b.firstChild.click();
    expect(signalled).toBe(1);
    expect(regular).toBe(1);

    controller.abort();
    expect(ed.getStats().totalHandlers).toBe(1);

    b.firstChild.click();
    expect(signalled).toBe(1);
    expect(regular).toBe(2);
  });

  test('already-aborted signal rejects the registration (fail-closed)', () => {
    const ed = window.YouTubePlusEventDelegation;
    const b = makeRoot();
    let hits = 0;
    const controller = new AbortController();
    controller.abort();
    const disposer = ed.on(b, 'click', 'button', () => hits++, {
      signal: controller.signal,
    });
    expect(ed.getStats().totalHandlers).toBe(0);
    b.firstChild.click();
    expect(hits).toBe(0);
    expect(typeof disposer).toBe('function'); // safe no-op disposer
  });

  test('first-registrant once no longer leaks into the shared root listener', () => {
    const ed = window.YouTubePlusEventDelegation;
    const b = makeRoot();
    let first = 0;
    let second = 0;
    // FIRST registrant uses once — previously the shared native root
    // listener inherited {once:true} and the browser removed it entirely
    // after the first event, killing the second handler.
    ed.on(b, 'click', 'button', () => first++, { once: true });
    ed.on(b, 'click', 'button', () => second++);
    b.firstChild.click();
    b.firstChild.click();
    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  test('once + signal + regular on one delegation stay independent', () => {
    const ed = window.YouTubePlusEventDelegation;
    const b = makeRoot();
    let once = 0;
    let signalled = 0;
    let regular = 0;
    const controller = new AbortController();
    ed.on(b, 'click', 'button', () => once++, { once: true });
    ed.on(b, 'click', 'button', () => signalled++, { signal: controller.signal });
    ed.on(b, 'click', 'button', () => regular++);

    b.firstChild.click();
    expect(once).toBe(1);
    expect(signalled).toBe(1);
    expect(regular).toBe(1);

    controller.abort();
    b.firstChild.click();
    expect(once).toBe(1);
    expect(signalled).toBe(1);
    expect(regular).toBe(2);
    expect(ed.getStats().totalHandlers).toBe(1);
  });

  test('clear() releases pending signal subscriptions', () => {
    const ed = window.YouTubePlusEventDelegation;
    const b = makeRoot();
    let hits = 0;
    const controller = new AbortController();
    ed.on(b, 'click', 'button', () => hits++, { signal: controller.signal });

    ed.clear();
    // Aborting after clear must not resurrect anything.
    controller.abort();
    b.firstChild.click();
    expect(hits).toBe(0);
    expect(ed.getStats().totalHandlers).toBe(0);
  });

  // -- DOM dispatch semantics on option combinations ----------

  test('N04: once removes only its own phase; the other phase keeps firing', () => {
    const ed = window.YouTubePlusEventDelegation;
    const root = makeRoot();
    /** @type {number[]} */
    const phases = [];
    const cb = /** @type {(e: Event) => void} */ (e => phases.push(e.eventPhase));
    ed.on(root, 'click', 'button', cb, { once: true, capture: true });
    ed.on(root, 'click', 'button', cb);

    root.firstChild.click(); // once+capture fires [1], bubble fires [3]
    root.firstChild.click(); // only bubble remains [3]
    // Native once semantics: the capture-phase once registration is gone,
    // the bubble registration of the SAME callback keeps working.
    expect(phases).toEqual([1, 3, 3]);
  });

  test('N05: once is removed before invoke, so a reentrant dispatch runs it once', () => {
    const ed = window.YouTubePlusEventDelegation;
    const root = makeRoot();
    let calls = 0;
    ed.on(
      root,
      'click',
      'button',
      () => {
        calls++;
        // Reentrant dispatch while this once-handler is still logically bound.
        root.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      },
      { once: true }
    );

    root.firstChild.click();
    expect(calls).toBe(1);
    expect(ed.getStats().totalHandlers).toBe(0);
  });

  test('N06: abort removes only the aborted phase and retains the other', () => {
    const ed = window.YouTubePlusEventDelegation;
    const root = makeRoot();
    /** @type {number[]} */
    const phases = [];
    const cb = /** @type {(e: Event) => void} */ (e => phases.push(e.eventPhase));
    const controller = new AbortController();
    ed.on(root, 'click', 'button', cb, { capture: true, signal: controller.signal });
    ed.on(root, 'click', 'button', cb);

    root.firstChild.click();
    expect(phases).toEqual([1, 3]);

    controller.abort(); // removes the CAPTURE registration only
    expect(ed.getStats().totalHandlers).toBe(1);

    root.firstChild.click();
    expect(phases).toEqual([1, 3, 3]);
  });

  test('N07: replaced document body has independent delegation identity', () => {
    const ed = window.YouTubePlusEventDelegation;
    const oldBody = document.body;
    oldBody.innerHTML = '<button class=btn>old</button>';
    let oldCalls = 0;
    let newCalls = 0;
    ed.on(oldBody, 'click', '.btn', () => oldCalls++);

    const newBody = document.createElement('body');
    newBody.innerHTML = '<button class=btn>new</button>';
    document.documentElement.replaceChild(newBody, oldBody);
    ed.on(newBody, 'click', '.btn', () => newCalls++);

    newBody.querySelector('.btn').click();
    expect(oldCalls).toBe(0);
    expect(newCalls).toBe(1);

    // Restore the original body for other tests.
    document.documentElement.replaceChild(oldBody, newBody);
  });

  test('off/disposer/clear keep native and registry counts consistent', () => {
    const ed = window.YouTubePlusEventDelegation;
    const root = makeRoot();
    let hits = 0;
    const handler = () => hits++;
    const disposer = ed.on(root, 'click', 'button', handler);
    expect(ed.getStats().totalHandlers).toBe(1);
    expect(ed.getStats().uniqueDelegations).toBe(1);

    // Disposer removes exactly what its on() created; idempotent.
    disposer();
    disposer();
    expect(ed.getStats().totalHandlers).toBe(0);
    expect(ed.getStats().uniqueDelegations).toBe(0);
    root.firstChild.click();
    expect(hits).toBe(0);

    // Re-register two handlers; clear() empties everything consistently.
    ed.on(root, 'click', 'button', handler);
    ed.on(root, 'click', 'button', handler, { capture: true });
    expect(ed.getStats().totalHandlers).toBe(2);
    ed.clear();
    expect(ed.getStats().totalHandlers).toBe(0);
    expect(ed.getStats().uniqueDelegations).toBe(0);
    expect(ed.getStats().delegationKeys).toBe(0);
    root.firstChild.click();
    expect(hits).toBe(0);
  });
});
