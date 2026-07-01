/**
 * YouTube+ Logger — canonical owner of structured, level-based logging.
 *
 * Responsibilities:
 *   - Buffer recent log entries (with rate limiting per module).
 *   - Filter log output by configurable level.
 *   - Format and forward log lines to window.console.
 *   - Provide scoped loggers via `createLogger(moduleName)`.
 *   - Provide child loggers via `createChild(context)` for nested scopes.
 *   - Provide stats / export / clear / setLevel / getLevel.
 *
 * Non-responsibilities (moved to error-boundary.js):
 *   - Severity categorization of errors.
 *   - Error recovery, notification, persistence.
 *   - Global `error` / `unhandledrejection` listeners.
 *   - `withErrorBoundary` / `withAsyncErrorBoundary` wrappers.
 *
 * Public surface:
 *   window.YouTubePlusLogger
 *     - error(module, message, data?)
 *     - warn(module, message, data?)
 *     - info(module, message, data?)
 *     - debug(module, message, data?)
 *     - setLevel(level)
 *     - getLevel()
 *     - getRecent(count?, filterLevel?)
 *     - export()
 *     - clear()
 *     - getStats()
 *     - createLogger(moduleName)
 *     - createChild(context)
 *     - logError(error, context?)            [back-compat bridge → YouTubePlusErrorBoundary]
 *     - withErrorBoundary(fn, context?)     [back-compat bridge → YouTubePlusErrorBoundary]
 *     - withAsyncErrorBoundary(fn, context?) [back-compat bridge → YouTubePlusErrorBoundary]
 *     - getErrorStats()                     [back-compat bridge → YouTubePlusErrorBoundary]
 *     - clearErrors()                       [back-compat bridge → YouTubePlusErrorBoundary]
 *     - getErrorRate()                      [back-compat bridge → YouTubePlusErrorBoundary]
 *
 *   window.YouTubePlusErrorBoundary             [re-exposed for back-compat with existing
 *                                            callers; canonical owner is error-boundary.js]
 */
(function () {
  // Allow Node-based tests to load error-boundary.js via this module so that
  // requiring logger.js still surfaces both `YouTubePlusLogger` and
  // `YouTubePlusErrorBoundary` globals (matches the previous single-file behavior).
  // In the bundled userscript, build order loads error-boundary.js first.
  /** @type {((id: string) => unknown) | null} */
  const nodeRequire =
    typeof module !== 'undefined' && module && typeof require === 'function' ? require : null;
  const __loadBoundary =
    nodeRequire && !window.YouTubePlusErrorBoundary
      ? () => {
          try {
            nodeRequire('./error-boundary.js');
          } catch (_e) {
            // error-boundary.js is expected to be loaded by build order in the
            // bundled userscript. Swallow in case of misconfiguration.
          }
        }
      : null;
  if (__loadBoundary) __loadBoundary();

  const U = window.YouTubeUtils;

  /** @typedef {'error'|'warn'|'info'|'debug'} LogLevel */

  /** @type {Record<LogLevel, number>} */
  const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

  /** Maximum number of recent log entries to keep in memory */
  const MAX_LOG_ENTRIES = 200;

  /** Rate limiting: max logs per minute per module */
  const MAX_LOGS_PER_MINUTE = 60;

  /**
   * @typedef {{timestamp: number, level: LogLevel, module: string, message: string, data?: any}} LogEntry
   */

  /** @type {LogEntry[]} */
  const logBuffer = [];

  /** @type {Map<string, {count: number, resetTime: number}>} */
  const rateLimitMap = new Map();

  /**
   * Determine if we're in development mode.
   * Kept side-effect free — reads window flags / localStorage defensively.
   * @returns {boolean}
   */
  function isDevMode() {
    try {
      if (typeof window !== 'undefined') {
        if (window.__ytpDevMode) return true;
        const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
        if (store && typeof store.get === 'function') {
          if (store.get('debugMode')) return true;
        } else {
          const settings = localStorage.getItem('youtube_plus_settings');
          if (settings) {
            const parsed = JSON.parse(settings);
            if (parsed?.debugMode) return true;
          }
        }
      }
    } catch (_e) {
      U?.logSuppressed?.(_e, 'Logger');
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
   * Core logging function. Safe to call with any data shape; non-Error
   * payloads are stored as-is and Error payloads have `name/message/stack`
   * extracted for cross-realm safety.
   * @param {LogLevel} level
   * @param {string} module
   * @param {string} message
   * @param {any} [data]
   */
  function log(level, module, message, data) {
    if (LOG_LEVELS[level] > LOG_LEVELS[currentLevel]) return;
    if (!checkRateLimit(module)) return;

    const formatted = formatMessage(level, module, message);

    const safeData = data !== undefined ? serializeData(data) : undefined;

    /** @type {LogEntry} */
    const entry = {
      timestamp: Date.now(),
      level,
      module,
      message,
      data: safeData,
    };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) {
      logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
    }

    // Forward to console for real-browser diagnostics. Info/debug stay gated by
    // currentLevel, so production users only see warn/error by default.
    if (level === 'error') {
      if (safeData !== undefined) console.error(formatted, safeData);
      else console.error(formatted);
    } else if (level === 'warn') {
      if (safeData !== undefined) console.warn(formatted, safeData);
      else console.warn(formatted);
    } else if (currentLevel === 'debug') {
      if (safeData !== undefined) console.log(formatted, safeData);
      else console.log(formatted);
    }
  }

  /**
   * Normalize log payloads so stored entries and console output are
   * consistent and never carry non-serializable values.
   * @param {any} data
   * @returns {any}
   */
  function serializeData(data) {
    if (data instanceof Error) {
      return {
        __ytpError: true,
        name: data.name,
        message: data.message,
        stack: data.stack,
      };
    }
    if (data === null || typeof data !== 'object') {
      return data;
    }
    try {
      JSON.stringify(data);
      return data;
    } catch (_e) {
      return String(data);
    }
  }

  /** @type {any} */
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
     * @returns {LogEntry[]}
     */
    getRecent(count, filterLevel) {
      let entries = logBuffer;
      if (filterLevel) {
        entries = entries.filter(e => e.level === filterLevel);
      }
      const limit = typeof count === 'number' ? count : 50;
      return entries.slice(-limit);
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
     * @returns {{ totalEntries: number; byLevel: Record<LogLevel, number>; byModule: Record<string, number>; currentLevel: LogLevel }}
     */
    getStats() {
      const byLevel = { error: 0, warn: 0, info: 0, debug: 0 };
      const byModule = /** @type {Record<string, number>} */ ({});
      for (const entry of logBuffer) {
        byLevel[entry.level]++;
        byModule[entry.module] = (byModule[entry.module] || 0) + 1;
      }
      return {
        totalEntries: logBuffer.length,
        byLevel,
        byModule,
        currentLevel,
      };
    },

    /**
     * Create a scoped logger for a specific module.
     * Returns an object with error/warn/info/debug methods
     * that automatically set the module name.
     * @param {string} moduleName - Module identifier
     * @returns {{error: (message: string, data?: any) => void, warn: (message: string, data?: any) => void, info: (message: string, data?: any) => void, debug: (message: string, data?: any) => void}}
     */
    createLogger(moduleName) {
      return {
        /**
         * @param {string} message
         * @param {any} [data]
         */
        error(message, data) {
          log('error', moduleName, message, data);
        },
        /**
         * @param {string} message
         * @param {any} [data]
         */
        warn(message, data) {
          log('warn', moduleName, message, data);
        },
        /**
         * @param {string} message
         * @param {any} [data]
         */
        info(message, data) {
          log('info', moduleName, message, data);
        },
        /**
         * @param {string} message
         * @param {any} [data]
         */
        debug(message, data) {
          log('debug', moduleName, message, data);
        },
      };
    },

    /**
     * Create a child logger that prepends a sub-scope to the module name.
     * Useful for nested contexts (e.g. `Download:Thumbnails`).
     * @param {string} context - Sub-scope name
     * @returns {{error: (message: string, data?: any) => void, warn: (message: string, data?: any) => void, info: (message: string, data?: any) => void, debug: (message: string, data?: any) => void}}
     */
    createChild(context) {
      return {
        /**
         * @param {string} module
         * @param {string} message
         * @param {any} [data]
         */
        error(module, message, data) {
          log('error', `${context}:${module}`, message, data);
        },
        /**
         * @param {string} module
         * @param {string} message
         * @param {any} [data]
         */
        warn(module, message, data) {
          log('warn', `${context}:${module}`, message, data);
        },
        /**
         * @param {string} module
         * @param {string} message
         * @param {any} [data]
         */
        info(module, message, data) {
          log('info', `${context}:${module}`, message, data);
        },
        /**
         * @param {string} module
         * @param {string} message
         * @param {any} [data]
         */
        debug(module, message, data) {
          log('debug', `${context}:${module}`, message, data);
        },
      };
    },
  };

  // ---------------------------------------------------------------------------
  // Back-compat bridge for error-boundary methods.
  // These existed on the legacy YouTubePlusLogger surface. They now delegate
  // to window.YouTubePlusErrorBoundary (canonical owner: error-boundary.js).
  // If error-boundary.js has not been loaded for any reason, methods become
  // safe no-ops so callers do not crash.
  // ---------------------------------------------------------------------------
  /** @type {(...args: any[]) => void} */
  const NOOP = () => {};
  const NOOP_STATS = () => ({
    totalErrors: 0,
    recentErrors: 0,
    lastErrorTime: 0,
    isRecovering: false,
    errorsByType: {},
  });
  const NOOP_CONFIG = {
    maxErrors: 10,
    errorWindow: 60000,
    enableLogging: true,
    enableRecovery: true,
    storageKey: 'youtube_plus_errors',
  };

  function getBoundary() {
    return /** @type {any} */ (window).YouTubePlusErrorBoundary || null;
  }

  /**
   * @param {Error | unknown} error
   * @param {Record<string, unknown>} [context]
   */
  logger.logError = (error, context) => {
    const b = getBoundary();
    return b && typeof b.logError === 'function'
      ? b.logError(error, context)
      : NOOP(error, context);
  };
  /**
   * @template {(...args: any[]) => any} T
   * @param {T} fn
   * @param {string} [context]
   * @returns {T}
   */
  logger.withErrorBoundary = (fn, context) => {
    const b = getBoundary();
    return b && typeof b.withErrorBoundary === 'function' ? b.withErrorBoundary(fn, context) : fn;
  };
  /**
   * @template {(...args: any[]) => Promise<any>} T
   * @param {T} fn
   * @param {string} [context]
   * @returns {T}
   */
  logger.withAsyncErrorBoundary = (fn, context) => {
    const b = getBoundary();
    return b && typeof b.withAsyncErrorBoundary === 'function'
      ? b.withAsyncErrorBoundary(fn, context)
      : fn;
  };
  logger.getErrorStats = () => {
    const b = getBoundary();
    return b && typeof b.getErrorStats === 'function' ? b.getErrorStats() : NOOP_STATS();
  };
  logger.clearErrors = () => {
    const b = getBoundary();
    if (b && typeof b.clearErrors === 'function') b.clearErrors();
  };
  logger.getErrorRate = () => {
    const b = getBoundary();
    return b && typeof b.getErrorRate === 'function' ? b.getErrorRate() : 0;
  };
  logger.config = () => {
    const b = getBoundary();
    return b?.config ? b.config : NOOP_CONFIG;
  };

  if (typeof window !== 'undefined') {
    window.YouTubePlusLogger = /** @type {any} */ (logger);
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusLogger = /** @type {any} */ (logger);
    }

    // Re-expose the error-boundary global for callers that looked it up
    // through logger.js (e.g. legacy tests). Canonical owner is
    // error-boundary.js; this line is a no-op once it has run there.
    if (!window.YouTubePlusErrorBoundary) {
      window.YouTubePlusErrorBoundary = /** @type {any} */ (getBoundary());
    }
  }
})();
