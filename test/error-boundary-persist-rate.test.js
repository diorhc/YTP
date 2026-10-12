/**
 * ErrorBoundary: localStorage writes are rate-limited to one per 5 seconds
 * (batched), and errors routed through logSuppressed reach the logger at debug
 * level instead of console.error. Real error-boundary.js and utils.js.
 * @jest-environment jsdom
 */

describe('ErrorBoundary persistence rate limit', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    localStorage.clear();
    require('../src/error-boundary.js');
  });

  afterEach(() => {
    window.YouTubePlusErrorBoundary?.clearErrors?.();
    jest.useRealTimers();
  });

  test('batches localStorage writes to at most one per 5 seconds', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    const eb = window.YouTubePlusErrorBoundary;

    for (let i = 0; i < 10; i++) {
      eb.logError(new Error(`rate probe ${i}`));
    }
    // The first error flushes immediately; the rest are batched.
    expect(setItem).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5000);
    // One trailing flush carries the batch.
    expect(setItem).toHaveBeenCalledTimes(2);

    const stored = JSON.parse(localStorage.getItem(eb.config.storageKey));
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.length).toBeGreaterThanOrEqual(10);

    setItem.mockRestore();
  });

  test('suppressed errors reach the logger at debug level, not error', () => {
    jest.resetModules();
    jest.useFakeTimers();
    require('../src/cleanup-manager.js');
    require('../src/error-boundary.js');
    const debug = jest.fn();
    const error = jest.fn();
    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: { debug, info: jest.fn(), warn: jest.fn(), error },
    });
    require('../src/utils.js');

    window.YouTubeUtils.logSuppressed(new Error('expected runtime failure'), 'TestModule');

    expect(debug).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
