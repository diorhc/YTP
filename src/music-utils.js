/**
 * Music Module - Utility Functions
 * Helper functions extracted from music.js to reduce complexity
 */

window.YouTubePlusMusicUtils = (() => {
  'use strict';

  /**
   * Check if element is scrollable
   * @param {HTMLElement} el - Element to check
   * @returns {boolean}
   */
  function isScrollable(el) {
    if (!el || el.scrollHeight <= el.clientHeight + 10) return false;

    try {
      const style = window.getComputedStyle(el);
      const overflowY = style && style.overflowY;
      return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    } catch {
      return false;
    }
  }

  /**
   * Find scrollable container within root element
   * @param {HTMLElement} root - Root element to search
   * @returns {HTMLElement|null}
   */
  function findScrollContainer(root) {
    if (!root) return null;

    // Prefer element with id "contents"
    const contents = root.querySelector('#contents');
    if (contents && contents.scrollHeight > contents.clientHeight) return contents;

    // Search for scrollable elements
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      if (isScrollable(all[i])) return all[i];
    }

    // Fallback to root if it scrolls
    if (isScrollable(root)) return root;

    return null;
  }

  /**
   * Setup button styles and positioning
   * @param {HTMLButtonElement} button - Button element
   * @param {HTMLElement} container - Container element
   */
  function setupButtonStyles(button, container) {
    if (!button || !container) return;

    container.style.position = container.style.position || 'relative';
    button.style.position = 'absolute';
    button.style.bottom = '16px';
    button.style.right = '16px';
    button.style.zIndex = '1000';
  }

  /**
   * Debounce utility to limit function execution rate
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   */
  function debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  }

  /**
   * Setup scroll visibility handler
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} scrollContainer - Scroll container
   * @param {number} threshold - Scroll threshold in pixels
   * @returns {Function} Cleanup function
   */
  function setupScrollVisibility(button, scrollContainer, threshold = 100) {
    if (!button || !scrollContainer) return () => {};

    const scrollHandler = debounce(() => {
      button.classList.toggle('visible', scrollContainer.scrollTop > threshold);
    }, 100);

    scrollContainer.addEventListener('scroll', scrollHandler, { passive: true });
    button.classList.toggle('visible', scrollContainer.scrollTop > threshold);

    return () => {
      scrollContainer.removeEventListener('scroll', scrollHandler);
    };
  }

  /**
   * Setup scroll to top behavior
   * @param {HTMLButtonElement} button - Button element
   * @param {HTMLElement} scrollContainer - Scroll container
   */
  function setupScrollToTop(button, scrollContainer) {
    if (!button || !scrollContainer) return;

    button.addEventListener('click', () => {
      try {
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        console.error('[YouTube+][Music] Error scrolling to top:', err);
      }
    });
  }

  // Public API
  return {
    isScrollable,
    findScrollContainer,
    setupButtonStyles,
    debounce,
    setupScrollVisibility,
    setupScrollToTop,
  };
})();
