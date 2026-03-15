/**
 * Centralized Logging System for YouTube+
 *
 * Provides structured, level-based logging with configurable verbosity.
 * Replaces scattered console.* calls with a unified interface.
 *
 * Log levels: error (0), warn (1), info (2), debug (3)
 * Default: 'warn' in production, 'debug' in development.
 *
 * Usage:
 *   const log = window.YouTubePlusLogger;
 *   log.error('module', 'message', errorObj);
 *   log.warn('module', 'message');
 *   log.info('module', 'message');
 *   log.debug('module', 'message', data);
 */
(function () {
  'use strict';

  /** @typedef {'error'|'warn'|'info'|'debug'} LogLevel */

  /** @type {Record<LogLevel, number>} */
  const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

  /** Maximum number of recent log entries to keep in memory */
  const MAX_LOG_ENTRIES = 200;

  /** Rate limiting: max logs per minute per module */
  const MAX_LOGS_PER_MINUTE = 60;

  /**
   * @type {Array<{timestamp: number, level: LogLevel, module: string, message: string, data?: any}>}
   */
  const logBuffer = [];

  /** @type {Map<string, {count: number, resetTime: number}>} */
  const rateLimitMap = new Map();

  /**
   * Determine if we're in development mode
   * @returns {boolean}
   */
  function isDevMode() {
    try {
      // Check common dev indicators
      if (typeof window !== 'undefined') {
        if (window.__ytpDevMode) return true;
        const settings = localStorage.getItem('youtube_plus_settings');
        if (settings) {
          const parsed = JSON.parse(settings);
          if (parsed.debugMode) return true;
        }
      }
    } catch {
      /* empty */
    }
    return false;
  }

  /** @type {LogLevel} */
  let currentLevel = isDevMode() ? 'debug' : 'warn';

  /**
   * Check rate limit for a module
   * @param {string} module
   * @returns {boolean} true if allowed
   */
  function checkRateLimit(module) {
    const now = Date.now();
    const entry = rateLimitMap.get(module);
    if (!entry || now > entry.resetTime) {
      rateLimitMap.set(module, { count: 1, resetTime: now + 60000 });
      return true;
    }
    if (entry.count >= MAX_LOGS_PER_MINUTE) return false;
    entry.count++;
    return true;
  }

  /**
   * Format a log message with timestamp and module prefix
   * @param {LogLevel} level
   * @param {string} module
   * @param {string} message
   * @returns {string}
   */
  function formatMessage(level, module, message) {
    return `[YouTube+][${module}][${level.toUpperCase()}] ${message}`;
  }

  /**
   * Core logging function
   * @param {LogLevel} level
   * @param {string} module
   * @param {string} message
   * @param {any} [data]
   */
  function log(level, module, message, data) {
    // Check level threshold
    if (LOG_LEVELS[level] > LOG_LEVELS[currentLevel]) return;

    // Rate limit per module
    if (!checkRateLimit(module)) return;

    const formatted = formatMessage(level, module, message);

    // Store in buffer
    const entry = {
      timestamp: Date.now(),
      level,
      module,
      message,
      data: data !== undefined ? data : undefined,
    };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) {
      logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
    }

    // Output to console (respect ESLint no-console rule: only warn/error)
    if (level === 'error') {
      if (data !== undefined) {
        console.error(formatted, data);
      } else {
        console.error(formatted);
      }
    } else if (level === 'warn') {
      if (data !== undefined) {
        console.warn(formatted, data);
      } else {
        console.warn(formatted);
      }
    } else if (currentLevel === 'debug') {
      if (data !== undefined) {
        console.warn(formatted, data);
      } else {
        console.warn(formatted);
      }
    }
  }

  /** @type {import('../types/index').YouTubePlusLogger} */
  const logger = {
    /**
     * Log an error message
     * @param {string} module - Module name
     * @param {string} message - Error message
     * @param {any} [data] - Additional data (e.g., error object)
     */
    error(module, message, data) {
      log('error', module, message, data);
    },

    /**
     * Log a warning message
     * @param {string} module - Module name
     * @param {string} message - Warning message
     * @param {any} [data] - Additional data
     */
    warn(module, message, data) {
      log('warn', module, message, data);
    },

    /**
     * Log an info message
     * @param {string} module - Module name
     * @param {string} message - Info message
     * @param {any} [data] - Additional data
     */
    info(module, message, data) {
      log('info', module, message, data);
    },

    /**
     * Log a debug message
     * @param {string} module - Module name
     * @param {string} message - Debug message
     * @param {any} [data] - Additional data
     */
    debug(module, message, data) {
      log('debug', module, message, data);
    },

    /**
     * Set the current log level
     * @param {LogLevel} level
     */
    setLevel(level) {
      if (LOG_LEVELS[level] !== undefined) {
        currentLevel = level;
      }
    },

    /**
     * Get the current log level
     * @returns {LogLevel}
     */
    getLevel() {
      return currentLevel;
    },

    /**
     * Get recent log entries
     * @param {number} [count=50] - Number of entries to return
     * @param {LogLevel} [filterLevel] - Optional level filter
     * @returns {Array<Object>}
     */
    getRecent(count = 50, filterLevel) {
      let entries = logBuffer;
      if (filterLevel) {
        entries = entries.filter(e => e.level === filterLevel);
      }
      return entries.slice(-count);
    },

    /**
     * Export all log entries as JSON string (for bug reports)
     * @returns {string}
     */
    export() {
      return JSON.stringify(logBuffer, null, 2);
    },

    /**
     * Clear all log entries
     */
    clear() {
      logBuffer.length = 0;
      rateLimitMap.clear();
    },

    /**
     * Get logging statistics
     * @returns {Object}
     */
    getStats() {
      const byLevel = { error: 0, warn: 0, info: 0, debug: 0 };
      const byModule = {};
      for (const entry of logBuffer) {
        byLevel[entry.level]++;
        byModule[entry.module] = (byModule[entry.module] || 0) + 1;
      }
      return { totalEntries: logBuffer.length, byLevel, byModule, currentLevel };
    },

    /**
     * Create a scoped logger for a specific module.
     * Returns an object with error/warn/info/debug methods
     * that automatically set the module name.
     * @param {string} moduleName - Module identifier
     * @returns {{error: Function, warn: Function, info: Function, debug: Function}}
     */
    createLogger(moduleName) {
      return {
        error(message, data) {
          log('error', moduleName, message, data);
        },
        warn(message, data) {
          log('warn', moduleName, message, data);
        },
        info(message, data) {
          log('info', moduleName, message, data);
        },
        debug(message, data) {
          log('debug', moduleName, message, data);
        },
      };
    },
  };

  // Export to window
  if (typeof window !== 'undefined') {
    window.YouTubePlusLogger = logger;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { logger, LOG_LEVELS };
  }
})();
