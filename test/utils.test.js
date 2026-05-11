/**
 * Unit tests for YouTube+ utilities
 */

describe('YouTubeUtils', () => {
  /**
   * @typedef {Object} YouTubeUtilsHarness
   * @property {(module: string, message: string, error: unknown) => void} logError
   * @property {(fn: Function, ms: number, options?: {leading?: boolean}) => Function & { cancel: () => void }} debounce
   * @property {(fn: Function, limit: number) => Function} throttle
   */

  /** @type {YouTubeUtilsHarness} */
  let YouTubeUtils;

  beforeEach(() => {
    // Mock document head/body safely (some test environments have read-only properties)
    try {
      Object.defineProperty(document, 'head', {
        configurable: true,
        writable: true,
        value: document.createElement('head'),
      });
    } catch {
      // ignore in environments with read-only head
    }

    try {
      Object.defineProperty(document, 'body', {
        configurable: true,
        writable: true,
        value: document.createElement('body'),
      });
    } catch {
      // ignore in environments with read-only body
    }

    // Load utils.js logic inline for testing
    /** @param {string} module @param {string} message @param {unknown} error */
    const logError = (module, message, error) => {
      console.error(`[YouTube+][${module}] ${message}:`, error);
    };

    /** @param {Function} fn @param {number} ms @param {{leading?: boolean}} [options={}] */
    function debounce(fn, ms, options = {}) {
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timeout = null;
      /** @type {unknown[] | null} */
      let lastArgs = null;
      /** @type {unknown} */
      let lastThis = null;
      /** @this {unknown} @param {...unknown} args */
      const debounced = function (...args) {
        lastArgs = args;
        lastThis = this;
        if (timeout) {
          clearTimeout(timeout);
        }
        if (options.leading && !timeout) {
          fn.apply(this, args);
        }
        timeout = setTimeout(() => {
          if (!options.leading) {
            fn.apply(lastThis, lastArgs || []);
          }
          timeout = null;
          lastArgs = null;
          lastThis = null;
        }, ms);
      };
      debounced.cancel = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = null;
        lastArgs = null;
        lastThis = null;
      };
      return debounced;
    }

    /** @param {Function} fn @param {number} limit */
    function throttle(fn, limit) {
      let inThrottle = false;
      /** @type {unknown} */
      let lastResult;
      /** @type {(this: unknown, ...args: unknown[]) => unknown} */
      const throttled = function (...args) {
        if (!inThrottle) {
          lastResult = fn.apply(this, args);
          inThrottle = true;
          setTimeout(() => {
            inThrottle = false;
          }, limit);
        }
        return lastResult;
      };
      return throttled;
    }

    YouTubeUtils = {
      logError,
      debounce,
      throttle,
    };
  });

  describe('debounce', () => {
    jest.useFakeTimers();

    test('should delay function execution', () => {
      const fn = jest.fn();
      const debounced = YouTubeUtils.debounce(fn, 100);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('should cancel previous calls', () => {
      const fn = jest.fn();
      const debounced = YouTubeUtils.debounce(fn, 100);

      debounced();
      debounced();
      debounced();

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('should support leading edge execution', () => {
      const fn = jest.fn();
      const debounced = YouTubeUtils.debounce(fn, 100, { leading: true });

      debounced();
      expect(fn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('should have cancel method', () => {
      const fn = jest.fn();
      const debounced = YouTubeUtils.debounce(fn, 100);

      debounced();
      debounced.cancel();

      jest.advanceTimersByTime(100);
      expect(fn).not.toHaveBeenCalled();
    });

    afterEach(() => {
      jest.clearAllTimers();
    });
  });

  describe('throttle', () => {
    jest.useFakeTimers();

    test('should limit function calls', () => {
      const fn = jest.fn();
      const throttled = YouTubeUtils.throttle(fn, 100);

      throttled();
      throttled();
      throttled();

      expect(fn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(100);
      throttled();

      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('should return last result during throttle period', () => {
      const fn = jest.fn(() => 'result');
      const throttled = YouTubeUtils.throttle(fn, 100);

      const result1 = throttled();
      const result2 = throttled();

      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    afterEach(() => {
      jest.clearAllTimers();
    });
  });

  describe('logError', () => {
    test('should log errors with module context', () => {
      const error = new Error('Test error');
      YouTubeUtils.logError('TestModule', 'Test message', error);

      expect(console.error).toHaveBeenCalledWith('[YouTube+][TestModule] Test message:', error);
    });
  });
});
