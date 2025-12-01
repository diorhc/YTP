/**
 * Global configuration for YouTube+ userscript
 * Controls logging, debugging, and feature flags
 */

window.YouTubePlusConfig = {
  /**
   * Production mode - reduces console logging
   * Set to false for development/debugging
   */
  PRODUCTION_MODE: false,

  /**
   * Log levels
   */
  LOG_LEVELS: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },

  /**
   * Current log level
   * In production, only show WARN and ERROR
   */
  get currentLogLevel() {
    return this.PRODUCTION_MODE ? this.LOG_LEVELS.WARN : this.LOG_LEVELS.DEBUG;
  },

  /**
   * Feature flags
   */
  FEATURES: {
    PERFORMANCE_MONITORING: true,
    ERROR_BOUNDARY: true,
    AUTO_UPDATE_CHECK: true,
    ANALYTICS: false, // Disabled for privacy
  },

  /**
   * Version info
   */
  VERSION: '2.2',
  BUILD_DATE: new Date().toISOString(),

  /**
   * Check if a log level should be shown
   * @param {number} level - Log level to check
   * @returns {boolean}
   */
  shouldLog(level) {
    return level >= this.currentLogLevel;
  },

  /**
   * Enhanced logging functions
   */
  log: {
    debug(...args) {
      if (window.YouTubePlusConfig.shouldLog(window.YouTubePlusConfig.LOG_LEVELS.DEBUG)) {
        console.log('[YouTube+][DEBUG]', ...args);
      }
    },

    info(...args) {
      if (window.YouTubePlusConfig.shouldLog(window.YouTubePlusConfig.LOG_LEVELS.INFO)) {
        console.info('[YouTube+][INFO]', ...args);
      }
    },

    warn(...args) {
      if (window.YouTubePlusConfig.shouldLog(window.YouTubePlusConfig.LOG_LEVELS.WARN)) {
        console.warn('[YouTube+][WARN]', ...args);
      }
    },

    error(...args) {
      if (window.YouTubePlusConfig.shouldLog(window.YouTubePlusConfig.LOG_LEVELS.ERROR)) {
        console.error('[YouTube+][ERROR]', ...args);
      }
    },
  },
};

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.YouTubePlusConfig;
}
