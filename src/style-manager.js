/**
 * Style Manager Module
 * Centralized CSS injection and management
 * @module style-manager
 */

const StyleManager = (() => {
  'use strict';

  const styles = new Map();
  let styleElement = null;

  /**
   * Error logging helper
   * @param {string} message - Error message
   * @param {Error} error - Error object
   */
  const logError = (message, error) => {
    console.error(`[YouTube+][StyleManager] ${message}:`, error);
  };

  /**
   * Update style element with all registered styles
   */
  const update = () => {
    try {
      if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'youtube-plus-styles';
        styleElement.type = 'text/css';
        (document.head || document.documentElement).appendChild(styleElement);
      }
      styleElement.textContent = Array.from(styles.values()).join('\n');
    } catch (error) {
      logError('Failed to update styles', error);
    }
  };

  /**
   * Add CSS rules
   * @param {string} id - Unique identifier
   * @param {string} css - CSS rules
   */
  const add = (id, css) => {
    if (typeof id !== 'string' || !id) {
      logError('Invalid style ID', new Error('ID must be a non-empty string'));
      return;
    }
    if (typeof css !== 'string') {
      logError('Invalid CSS', new Error('CSS must be a string'));
      return;
    }
    styles.set(id, css);
    update();
  };

  /**
   * Remove CSS rules by ID
   * @param {string} id - Identifier
   */
  const remove = id => {
    styles.delete(id);
    update();
  };

  /**
   * Clear all styles
   */
  const clear = () => {
    styles.clear();
    if (styleElement) {
      try {
        styleElement.remove();
      } catch (e) {
        logError('Failed to remove style element', e);
      }
      styleElement = null;
    }
  };

  /**
   * Check if style exists
   * @param {string} id - Style ID
   * @returns {boolean} True if exists
   */
  const has = id => styles.has(id);

  /**
   * Get style by ID
   * @param {string} id - Style ID
   * @returns {string|undefined} CSS content
   */
  const get = id => styles.get(id);

  /**
   * Get all style IDs
   * @returns {string[]} Array of IDs
   */
  const getIds = () => Array.from(styles.keys());

  return {
    add,
    remove,
    clear,
    has,
    get,
    getIds,
    styles,
  };
})();

// Export globally
if (typeof window !== 'undefined') {
  window.YouTubePlusStyleManager = StyleManager;
}
