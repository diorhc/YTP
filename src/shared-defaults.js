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

  // Shared literals and default timing values to avoid module-level magic numbers.
  // Canonical DOM helpers ($, $$, byId) live in utils.js (cache-aware via
  // YouTubeDOMCache). Modules should use window.YouTubeUtils.$ at runtime.
  const SETTINGS_KEY = 'youtube_plus_settings';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TIMEOUTS = Object.freeze({
    SHORT_UI: 80,
    CHAT_URL_CHANGED: 136,
    LONG_OPERATION: 4000,
  });

  /**
   * Shared createHTML wrapper around TrustedTypes policy when available.
   * Canonical sanitization lives in safe-dom.js (YouTubeSafeDOM.sanitizeHTML);
   * we do NOT ship a naive sanitizer here because no caller relies on it.
   * @param {string} html
   * @returns {string}
   */
  const createHTML = html => {
    if (typeof window._ytplusCreateHTML === 'function') {
      return window._ytplusCreateHTML(html);
    }
    return typeof html === 'string' ? html : String(html ?? '');
  };

  /**
   * Shared safe HTML setter fallback used by modules.
   * @param {Element} element
   * @param {string} html
   * @param {boolean} [sanitize=true]
   */
  const setSafeHTML = (element, html, sanitize = true) => {
    if (!(element instanceof HTMLElement)) return;

    if (window.YouTubeSafeDOM?.setHTML) {
      window.YouTubeSafeDOM.setHTML(element, html, { sanitize });
      return;
    }

    if (window.YouTubeSecurityUtils?.setInnerHTMLSafe) {
      window.YouTubeSecurityUtils.setInnerHTMLSafe(element, html, sanitize);
      return;
    }

    const safeText = String(html || '');
    element.replaceChildren(document.createTextNode(safeText));
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
    SETTINGS_KEY,
    SVG_NS,
    TIMEOUTS,
    createHTML,
    setSafeHTML,
    t,
  });
})();
