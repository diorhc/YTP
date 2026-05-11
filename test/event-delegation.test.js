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
});
