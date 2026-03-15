/**
 * Unit tests for YouTube+ Event Delegation module
 */

describe('EventDelegation', () => {
  let delegation;

  beforeEach(() => {
    delete window.YouTubePlusEventDelegation;
    window.YouTubeUtils = {
      logger: { debug: jest.fn(), warn: jest.fn() },
    };

    // Reset module cache so the IIFE re-executes
    jest.resetModules();

    require('../src/event-delegation');
    delegation = window.YouTubePlusEventDelegation;
  });

  test('should be exported to window.YouTubePlusEventDelegation', () => {
    expect(delegation).toBeDefined();
    expect(typeof delegation.on).toBe('function');
    expect(typeof delegation.off).toBe('function');
    expect(typeof delegation.getStats).toBe('function');
  });

  test('should delegate click events via on/off', () => {
    const parent = document.createElement('div');
    const child = document.createElement('button');
    child.className = 'target-btn';
    parent.appendChild(child);
    document.body.appendChild(parent);

    const handler = jest.fn();
    delegation.on(parent, 'click', '.target-btn', handler);

    // Simulate click on child
    child.click();
    expect(handler).toHaveBeenCalledTimes(1);

    // Cleanup
    delegation.off(parent, 'click', '.target-btn', handler);
    document.body.removeChild(parent);
  });

  test('should not fire handler for non-matching elements', () => {
    const parent = document.createElement('div');
    const nonTarget = document.createElement('span');
    nonTarget.className = 'other';
    parent.appendChild(nonTarget);
    document.body.appendChild(parent);

    const handler = jest.fn();
    delegation.on(parent, 'click', '.target-btn', handler);

    nonTarget.click();
    expect(handler).not.toHaveBeenCalled();

    delegation.off(parent, 'click', '.target-btn', handler);
    document.body.removeChild(parent);
  });

  test('should provide delegation stats', () => {
    const stats = delegation.getStats();
    expect(stats).toBeDefined();
    expect(typeof stats.totalDelegations).toBe('number');
  });
});
