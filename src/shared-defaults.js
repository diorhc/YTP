/**
 * YouTube+ Shared Defaults
 *
 * Single-source fallback implementations for utility functions that every module
 * needs but can't guarantee will be available from YouTubeUtils at parse time.
 *
 * Usage in other modules:
 *   const debounce = window.YouTubeUtils?.debounce || window._ytpDefaults.debounce;
 *
 * This eliminates the inline fallback definitions that were duplicated across
 * 8+ modules (each defining their own debounce/throttle/$ implementation).
 */
(function () {
  'use strict';

  // Prevent double-init
  if (window._ytpDefaults) return;

  /**
   * Minimal debounce implementation (fallback when YouTubeUtils is not yet loaded)
   * @param {Function} fn - Function to debounce
   * @param {number} ms - Delay in milliseconds
   * @param {object} [options] - Options
   * @param {boolean} [options.leading] - Whether to call on the leading edge
   * @returns {Function & { cancel: () => void }} Debounced function
   */
  const debounce = (fn, ms, options = {}) => {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeout = null;
    const debounced = /** @this {unknown} */ function (/** @type {any[]} */ ...args) {
      if (timeout !== null) clearTimeout(timeout);
      if (options.leading && timeout === null) fn.call(this, ...args);
      timeout = setTimeout(() => {
        if (!options.leading) fn.call(this, ...args);
        timeout = null;
      }, ms);
    };
    debounced.cancel = () => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
    };
    return debounced;
  };

  /**
   * Minimal throttle implementation
   * @param {Function} fn - Function to throttle
   * @param {number} limit - Minimum interval in milliseconds
   * @returns {Function} Throttled function
   */
  const throttle = (fn, limit) => {
    let inThrottle = false;
    return /** @this {unknown} */ function (/** @type {any[]} */ ...args) {
      if (!inThrottle) {
        fn.call(this, ...args);
        inThrottle = true;
        setTimeout(() => {
          inThrottle = false;
        }, limit);
      }
    };
  };

  /**
   * Minimal DOM query helper
   * @param {string} sel - CSS selector
   * @param {Element | Document} [ctx] - Context element
   * @returns {Element | null}
   */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);

  /**
   * Multi-element DOM query helper
   * @param {string} sel - CSS selector
   * @param {Element | Document} [ctx] - Context element
   * @returns {Element[]}
   */
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /**
   * getElementById shorthand
   * @param {string} id - Element ID
   * @returns {Element | null}
   */
  const byId = id => document.getElementById(id);

  /**
   * Sanitize HTML string (minimal fallback)
   * @param {string} html - Raw HTML string
   * @returns {string} Sanitized string
   */
  const sanitizeHTML = html => {
    if (typeof html !== 'string') return '';
    return html.replace(/[<>&"'\/`=]/g, '');
  };

  /**
   * Translation no-op fallback
   * @param {string} key - Translation key
   * @returns {string} The key itself
   */
  const t = key => key || '';

  // Expose as a frozen object on window — modules should prefer
  // window.YouTubeUtils.X but fall back to window._ytpDefaults.X
  window._ytpDefaults = Object.freeze({
    debounce,
    throttle,
    $,
    $$,
    byId,
    sanitizeHTML,
    t,
  });
})();
