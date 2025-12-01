/**
 * Debug Configuration Module
 * Centralized debug settings for YouTube+ userscript
 * Set flags to true to enable specific debug logging
 */
(function () {
  'use strict';

  /**
   * Debug configuration object
   * @typedef {Object} DebugConfig
   * @property {boolean} enabled - Master switch for all debugging
   * @property {boolean} performance - Log performance metrics
   * @property {boolean} errors - Detailed error logging
   * @property {boolean} domOperations - Log DOM manipulation operations
   * @property {boolean} navigation - Log navigation and routing events
   * @property {boolean} modules - Log module initialization and lifecycle
   * @property {boolean} attachDetach - Log element attach/detach events (DEBUG_5084)
   * @property {boolean} tabOperations - Log tab switching operations (DEBUG_5085)
   * @property {boolean} api - Log API calls and responses
   * @property {boolean} storage - Log localStorage operations
   * @property {boolean} userActions - Log user interactions
   */

  /**
   * Debug configuration singleton
   * @type {DebugConfig}
   */
  const DebugConfig = {
    // Master switch - set to false in production to disable all debug logging
    enabled: false,

    // Specific debug categories
    performance: false,
    errors: true, // Keep errors visible even in production
    domOperations: false,
    navigation: false,
    modules: false,
    attachDetach: false, // DEBUG_5084
    tabOperations: false, // DEBUG_5085
    api: false,
    storage: false,
    userActions: false,
  };

  /**
   * Conditional console.log wrapper
   * @param {string} category - Debug category
   * @param {...any} args - Arguments to log
   */
  const debugLog = (category, ...args) => {
    if (!DebugConfig.enabled) return;
    if (!DebugConfig[category]) return;
    console.log(`[YouTube+ Debug:${category}]`, ...args);
  };

  /**
   * Conditional console.warn wrapper
   * @param {string} category - Debug category
   * @param {...any} args - Arguments to log
   */
  const debugWarn = (category, ...args) => {
    if (!DebugConfig.enabled) return;
    if (!DebugConfig[category]) return;
    console.warn(`[YouTube+ Debug:${category}]`, ...args);
  };

  /**
   * Conditional console.error wrapper (always logs if errors category is enabled)
   * @param {string} category - Debug category
   * @param {...any} args - Arguments to log
   */
  const debugError = (category, ...args) => {
    if (!DebugConfig.errors) return;
    console.error(`[YouTube+ Debug:${category}]`, ...args);
  };

  /**
   * Performance timing utility
   * @param {string} label - Label for the performance measurement
   * @returns {Function} End function to stop measurement
   */
  const debugTime = label => {
    if (!DebugConfig.enabled || !DebugConfig.performance) {
      return () => {}; // No-op
    }
    const startTime = performance.now();
    return () => {
      const endTime = performance.now();
      console.log(`[YouTube+ Perf] ${label}: ${(endTime - startTime).toFixed(2)}ms`);
    };
  };

  /**
   * Check if specific debug category is enabled
   * @param {string} category - Debug category to check
   * @returns {boolean} True if enabled
   */
  const isDebugEnabled = category => {
    return DebugConfig.enabled && DebugConfig[category];
  };

  // Expose debug utilities globally
  if (typeof window !== 'undefined') {
    window.YouTubePlusDebug = {
      config: DebugConfig,
      log: debugLog,
      warn: debugWarn,
      error: debugError,
      time: debugTime,
      isEnabled: isDebugEnabled,
      // Backward compatibility with existing flags
      get DEBUG_5084() {
        return isDebugEnabled('attachDetach');
      },
      get DEBUG_5085() {
        return isDebugEnabled('tabOperations');
      },
    };

    // Allow runtime configuration via console
    console.log(
      '[YouTube+] Debug system initialized. Use window.YouTubePlusDebug.config to configure.'
    );
  }
})();
