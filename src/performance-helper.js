/**
 * Performance Monitoring Helper Module
 * Provides utilities for measuring and monitoring performance
 */

/**
 * Performance monitoring wrapper for synchronous functions
 * @param {string} label - Operation label
 * @param {Function} fn - Function to monitor
 * @returns {Function} Wrapped function
 */
const measurePerformance = (label, fn) => {
  /** @this {any} */
  return function (...args) {
    const start = performance.now();
    try {
      const result = fn.apply(this, args);
      const duration = performance.now() - start;
      if (duration > 100) {
        console.warn(`[YouTube+][Performance] ${label} took ${duration.toFixed(2)}ms`);
      }
      return result;
    } catch (error) {
      console.error(`[YouTube+][Performance] ${label} failed:`, error);
      throw error;
    }
  };
};

/**
 * Async performance monitoring wrapper
 * @param {string} label - Operation label
 * @param {Function} fn - Async function to monitor
 * @returns {Function} Wrapped async function
 */
const measurePerformanceAsync = (label, fn) => {
  /** @this {any} */
  return async function (...args) {
    const start = performance.now();
    try {
      const result = await fn.apply(this, args);
      const duration = performance.now() - start;
      if (duration > 100) {
        console.warn(`[YouTube+][Performance] ${label} took ${duration.toFixed(2)}ms`);
      }
      return result;
    } catch (error) {
      console.error(`[YouTube+][Performance] ${label} failed:`, error);
      throw error;
    }
  };
};

/**
 * Measure a block of code
 * @param {string} label - Operation label
 * @param {Function} fn - Code to measure
 * @returns {Promise<number>} Duration in ms
 */
const measureBlock = async (label, fn) => {
  const start = performance.now();
  try {
    await fn();
    const duration = performance.now() - start;
    console.log(`[YouTube+][Performance] ${label} took ${duration.toFixed(2)}ms`);
    return duration;
  } catch (error) {
    console.error(`[YouTube+][Performance] ${label} failed:`, error);
    throw error;
  }
};

/**
 * Debounce a function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @param {{leading?: boolean}} [options] - Options object
 * @returns {Function} Debounced function
 */
const debounce = (func, wait, options = {}) => {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timeout = null;
  /** @type {any[] | null} */
  let lastArgs = null;
  /** @type {any} */
  let lastThis = null;

  /** @this {any} */
  const debounced = function (...args) {
    lastArgs = args;
    lastThis = this;
    if (timeout !== null) clearTimeout(timeout);

    if (options.leading && timeout === null) {
      func.call(this, ...args);
    }

    timeout = setTimeout(() => {
      if (!options.leading && lastArgs) {
        func.call(lastThis, ...lastArgs);
      }
      timeout = null;
      lastArgs = null;
      lastThis = null;
    }, wait);
  };

  debounced.cancel = () => {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
    lastArgs = null;
    lastThis = null;
  };

  return debounced;
};

/**
 * Throttle a function
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
const throttle = (func, limit) => {
  /** @type {boolean} */
  let inThrottle = false;
  /** @type {any} */
  let lastResult = undefined;

  /** @this {any} */
  return function (...args) {
    if (!inThrottle) {
      lastResult = func.call(this, ...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
    return lastResult;
  };
};

/**
 * Safe async retry wrapper
 * @param {Function} fn - Async function to retry
 * @param {number} retries - Number of retries
 * @param {number} delay - Delay between retries
 * @returns {Promise} Result or error
 */
const retryAsync = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.YouTubePlusPerformance = {
    measurePerformance,
    measurePerformanceAsync,
    measureBlock,
    debounce,
    throttle,
    retryAsync,
  };
}
