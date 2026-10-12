/**
 * Unit tests for YouTube+ Event Delegation module
 */

describe('EventDelegation', () => {
  /** @type {YouTubePlusEventDelegation | null} */
  let delegation = null;

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

    // Reset module cache so the IIFE re-executes
    jest.resetModules();

    require('../src/event-delegation');
    delegation = window.YouTubePlusEventDelegation || null;
  });

  test('should be exported to window.YouTubePlusEventDelegation', () => {
    expect(delegation).toBeDefined();
    if (!delegation) throw new Error('delegation not initialized');
    expect(typeof delegation.on).toBe('function');
    expect(typeof delegation.off).toBe('function');
    expect(typeof delegation.getStats).toBe('function');
  });

  test('should delegate click events via on/off', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent = document.createElement('div');
    const child = document.createElement('button');
    child.className = 'target-btn';
    parent.appendChild(child);
    document.body.appendChild(parent);

    const handler = jest.fn();
    delegation.on(document, 'click', '.target-btn', handler);

    // Simulate click on child
    child.click();
    expect(handler).toHaveBeenCalledTimes(1);

    // Cleanup
    delegation.off(document, 'click', '.target-btn', handler);
    document.body.removeChild(parent);
  });

  test('should not fire handler for non-matching elements', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent = document.createElement('div');
    const nonTarget = document.createElement('span');
    nonTarget.className = 'other';
    parent.appendChild(nonTarget);
    document.body.appendChild(parent);

    const handler = jest.fn();
    delegation.on(document, 'click', '.target-btn', handler);

    nonTarget.click();
    expect(handler).not.toHaveBeenCalled();

    delegation.off(document, 'click', '.target-btn', handler);
    document.body.removeChild(parent);
  });

  test('should provide delegation stats', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const stats = delegation.getStats();
    expect(stats).toBeDefined();
    expect(typeof stats.totalDelegations).toBe('number');
  });

  test('attachHoverPopover shows on anchor mouseenter and hides after delay', () => {
    jest.useFakeTimers();
    try {
      if (!delegation) throw new Error('delegation not initialized');
      const anchor = document.createElement('button');
      const panel = document.createElement('div');
      document.body.appendChild(anchor);
      document.body.appendChild(panel);
      const show = jest.fn(() => panel.classList.add('visible'));
      const hide = jest.fn(() => panel.classList.remove('visible'));

      const dispose = delegation.attachHoverPopover(anchor, panel, { show, hide, hideDelay: 50 });

      anchor.dispatchEvent(new Event('mouseenter'));
      expect(show).toHaveBeenCalledTimes(1);
      expect(panel.classList.contains('visible')).toBe(true);

      anchor.dispatchEvent(new Event('mouseleave'));
      expect(hide).not.toHaveBeenCalled();
      jest.advanceTimersByTime(50);
      expect(hide).toHaveBeenCalledTimes(1);

      dispose();
      document.body.removeChild(anchor);
      document.body.removeChild(panel);
    } finally {
      jest.useRealTimers();
    }
  });

  test('attachHoverPopover cancels pending hide when pointer returns', () => {
    jest.useFakeTimers();
    try {
      if (!delegation) throw new Error('delegation not initialized');
      const anchor = document.createElement('button');
      const panel = document.createElement('div');
      document.body.appendChild(anchor);
      document.body.appendChild(panel);
      const show = jest.fn();
      const hide = jest.fn();

      const dispose = delegation.attachHoverPopover(anchor, panel, { show, hide, hideDelay: 50 });

      anchor.dispatchEvent(new Event('mouseenter'));
      anchor.dispatchEvent(new Event('mouseleave'));
      panel.dispatchEvent(new Event('mouseenter'));
      jest.advanceTimersByTime(100);
      expect(hide).not.toHaveBeenCalled();

      dispose();
      document.body.removeChild(anchor);
      document.body.removeChild(panel);
    } finally {
      jest.useRealTimers();
    }
  });

  test('attachHoverPopover dispose removes listeners', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const anchor = document.createElement('button');
    const panel = document.createElement('div');
    document.body.appendChild(anchor);
    document.body.appendChild(panel);
    const show = jest.fn();
    const hide = jest.fn();

    const dispose = delegation.attachHoverPopover(anchor, panel, { show, hide });
    dispose();

    anchor.dispatchEvent(new Event('mouseenter'));
    anchor.dispatchEvent(new Event('mouseleave'));
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();

    document.body.removeChild(anchor);
    document.body.removeChild(panel);
  });

  // Regression: two elements with the same id must NOT share a delegation
  // key. Previously _getElementKey used el.id, so a new element with the same
  // id would get the old element's handler table.
  test('elements with the same id get independent delegation keys', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent1 = document.createElement('div');
    const parent2 = document.createElement('div');
    parent1.id = 'dup-id';
    parent2.id = 'dup-id';
    document.body.appendChild(parent1);
    document.body.appendChild(parent2);

    const handler1 = jest.fn();
    const handler2 = jest.fn();
    delegation.on(parent1, 'click', '.btn', handler1);
    delegation.on(parent2, 'click', '.btn', handler2);

    const btn1 = document.createElement('button');
    btn1.className = 'btn';
    parent1.appendChild(btn1);
    btn1.click();
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(0);

    const btn2 = document.createElement('button');
    btn2.className = 'btn';
    parent2.appendChild(btn2);
    btn2.click();
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);

    delegation.off(parent1, 'click', '.btn', handler1);
    delegation.off(parent2, 'click', '.btn', handler2);
    document.body.removeChild(parent1);
    document.body.removeChild(parent2);
  });

  // Regression: root listener added with capture=true must be removed with
  // capture=true. Previously _removeRootListener always called
  // removeEventListener without options, so the capture listener was never
  // removed, causing double-fires.
  test('capture root listener is properly removed with matching options', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const handler = jest.fn();
    delegation.on(parent, 'click', '.btn', handler, { capture: true });

    const btn = document.createElement('button');
    btn.className = 'btn';
    parent.appendChild(btn);
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);

    delegation.off(parent, 'click', '.btn', handler);

    // After removal, the handler should not fire
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(parent);
  });

  // Regression: after off() then on() with the same selector, a single
  // click must fire the handler exactly once (not twice from duplicate root
  // listeners).
  test('off then on does not create duplicate root listeners', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const handler1 = jest.fn();
    const handler2 = jest.fn();
    delegation.on(parent, 'click', '.btn', handler1);
    delegation.off(parent, 'click', '.btn', handler1);
    delegation.on(parent, 'click', '.btn', handler2);

    const btn = document.createElement('button');
    btn.className = 'btn';
    parent.appendChild(btn);
    btn.click();
    expect(handler1).toHaveBeenCalledTimes(0);
    expect(handler2).toHaveBeenCalledTimes(1);

    delegation.off(parent, 'click', '.btn', handler2);
    document.body.removeChild(parent);
  });

  test('capture and bubble listeners coexist on same parent without conflict', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const callOrder = [];
    const captureHandler = jest.fn(() => callOrder.push('capture'));
    const bubbleHandler = jest.fn(() => callOrder.push('bubble'));

    delegation.on(parent, 'click', '.btn', bubbleHandler, false);
    delegation.on(parent, 'click', '.btn', captureHandler, { capture: true });

    const btn = document.createElement('button');
    btn.className = 'btn';
    parent.appendChild(btn);

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(captureHandler).toHaveBeenCalledTimes(1);
    expect(bubbleHandler).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['capture', 'bubble']);

    delegation.off(parent, 'click', '.btn', captureHandler, { capture: true });
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(captureHandler).toHaveBeenCalledTimes(1);
    expect(bubbleHandler).toHaveBeenCalledTimes(2);

    delegation.off(parent, 'click', '.btn', bubbleHandler, false);
    document.body.removeChild(parent);
  });

  test('duplicate on() calls with same handler do not inflate totalHandlers stats', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const handler = jest.fn();
    const stats0 = delegation.getStats().totalHandlers;

    delegation.on(parent, 'click', '.btn', handler);
    expect(delegation.getStats().totalHandlers).toBe(stats0 + 1);

    delegation.on(parent, 'click', '.btn', handler);
    expect(delegation.getStats().totalHandlers).toBe(stats0 + 1);

    delegation.off(parent, 'click', '.btn', handler);
    expect(delegation.getStats().totalHandlers).toBe(stats0);

    document.body.removeChild(parent);
  });

  test('on() returns an idempotent disposer function', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const handler = jest.fn();
    const disposer = delegation.on(parent, 'click', '.btn', handler);
    expect(typeof disposer).toBe('function');

    const btn = document.createElement('button');
    btn.className = 'btn';
    parent.appendChild(btn);

    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);

    disposer();
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);

    expect(() => disposer()).not.toThrow();

    document.body.removeChild(parent);
  });

  test('handler removed during dispatch is not invoked for the current event', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent = document.createElement('div');
    const child = document.createElement('button');
    child.className = 'r08-remove-target';
    parent.appendChild(child);
    document.body.appendChild(parent);

    const second = jest.fn();
    const first = jest.fn(() => {
      // First handler removes the second DURING the same dispatch.
      delegation.off(document, 'click', '.r08-remove-target', second);
    });
    const emptyHandler = () => {
      /* mock */
    };
    delegation.on(document, 'click', '.r08-target-empty', emptyHandler);
    delegation.on(document, 'click', '.r08-remove-target', first);
    delegation.on(document, 'click', '.r08-remove-target', second);

    // Native EventTarget: a listener removed before its invocation in the
    // same event never runs for THAT event.
    child.click();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    // The removal persists for later events.
    child.click();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).not.toHaveBeenCalled();

    delegation.off(document, 'click', '.r08-remove-target', first);
    delegation.off(document, 'click', '.r08-target-empty', emptyHandler);
    document.body.removeChild(parent);
  });

  test('off + re-add during dispatch does not revive the old snapshot entry', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent = document.createElement('div');
    const child = document.createElement('button');
    child.className = 'r08-readd-target';
    parent.appendChild(child);
    document.body.appendChild(parent);

    const second = jest.fn();
    let reAdded = false;
    const first = jest.fn(() => {
      // Remove the CURRENT registration and add the same callback back ONCE —
      // the re-added handler is a NEW registration, not the snapshot entry.
      if (!reAdded) {
        reAdded = true;
        delegation.off(document, 'click', '.r08-readd-target', second);
        delegation.on(document, 'click', '.r08-readd-target', second);
      }
    });
    delegation.on(document, 'click', '.r08-readd-target', first);
    delegation.on(document, 'click', '.r08-readd-target', second);

    child.click();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    // The NEXT event is served by the re-added registration.
    child.click();
    expect(second).toHaveBeenCalledTimes(1);

    delegation.off(document, 'click', '.r08-readd-target', first);
    delegation.off(document, 'click', '.r08-readd-target', second);
    document.body.removeChild(parent);
  });

  test('abort during dispatch skips the aborted handler for the current event', () => {
    if (!delegation) throw new Error('delegation not initialized');
    const parent = document.createElement('div');
    const child = document.createElement('button');
    child.className = 'r08-abort-target';
    parent.appendChild(child);
    document.body.appendChild(parent);

    const controller = new AbortController();
    const second = jest.fn();
    const first = jest.fn(() => controller.abort());
    delegation.on(document, 'click', '.r08-abort-target', first);
    delegation.on(document, 'click', '.r08-abort-target', second, {
      signal: controller.signal,
    });

    child.click();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    child.click();
    expect(second).not.toHaveBeenCalled();

    delegation.off(document, 'click', '.r08-abort-target', first);
    document.body.removeChild(parent);
  });
});
