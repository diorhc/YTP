/**
 * Centralized Logging System for YouTube+
 *
 * Provides structured, level-based logging with configurable verbosity.
 * Replaces scattered window.console.* calls with a unified interface.
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
  const setTimeout_ = setTimeout;

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
    } catch (e) {
      // Non-critical, suppressed
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
        window.console.error(formatted, data);
      } else {
        window.console.error(formatted);
      }
    } else if (level === 'warn') {
      if (data !== undefined) {
        window.console.warn(formatted, data);
      } else {
        window.console.warn(formatted);
      }
    } else if (currentLevel === 'debug') {
      if (data !== undefined) {
        window.console.warn(formatted, data);
      } else {
        window.console.warn(formatted);
      }
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
     * @returns {any[]}
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
      const byModule = /** @type {Record<string, number>} */ ({});
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
  };

  const ErrorSeverity = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
  };

  const errorBoundaryConfig = {
    maxErrors: 10,
    errorWindow: 60000,
    enableLogging: true,
    enableRecovery: true,
    storageKey: 'youtube_plus_errors',
  };

  /**
   * @typedef {{ timestamp: string; message: string; stack: string | undefined; severity: string; context: Record<string, unknown> }} BoundaryErrorInfo
   */

  /** @type {{ errors: BoundaryErrorInfo[]; errorCount: number; lastErrorTime: number; isRecovering: boolean }} */
  const errorState = {
    errors: [],
    errorCount: 0,
    lastErrorTime: 0,
    isRecovering: false,
  };

  /** @param {Error} error */
  const categorizeSeverity = error => {
    const message = error.message?.toLowerCase() || '';
    if (
      message.includes('cannot read') ||
      message.includes('undefined') ||
      message.includes('null')
    ) {
      return ErrorSeverity.MEDIUM;
    }
    if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
      return ErrorSeverity.LOW;
    }
    if (message.includes('syntax') || message.includes('reference') || message.includes('type')) {
      return ErrorSeverity.HIGH;
    }
    if (message.includes('security') || message.includes('csp')) {
      return ErrorSeverity.CRITICAL;
    }
    return ErrorSeverity.MEDIUM;
  };

  const getErrorRate = () => {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    return errorState.errors.filter(e => new Date(e.timestamp).getTime() > oneMinuteAgo).length;
  };

  const isErrorRateExceeded = () => {
    const now = Date.now();
    const windowStart = now - errorBoundaryConfig.errorWindow;
    const recentErrors = errorState.errors.filter(
      e => new Date(e.timestamp).getTime() > windowStart
    );
    return recentErrors.length >= errorBoundaryConfig.maxErrors;
  };

  /** @param {Error} error */
  const showErrorNotification = error => {
    try {
      const Y = window.YouTubeUtils;
      if (!Y || !Y.NotificationManager || typeof Y.NotificationManager.show !== 'function') {
        return;
      }

      const severity = categorizeSeverity(error);
      let message = 'An error occurred';
      let duration = 3000;

      if (severity === ErrorSeverity.LOW) {
        message = 'A minor issue occurred. Functionality should continue normally.';
        duration = 2000;
      } else if (severity === ErrorSeverity.MEDIUM) {
        message = 'An error occurred. Some features may not work correctly.';
        duration = 3000;
      } else if (severity === ErrorSeverity.HIGH) {
        message = 'A serious error occurred. Please refresh the page if issues persist.';
        duration = 5000;
      } else if (severity === ErrorSeverity.CRITICAL) {
        message =
          'A critical error occurred. YouTube+ may not function properly. Please report this issue.';
        duration = 7000;
      }

      Y.NotificationManager.show(message, { duration, type: 'error' });
    } catch (notificationError) {
      window.console.error(
        '[YouTube+][ErrorBoundary] Failed to show error notification',
        notificationError
      );
    }
  };

  /** @param {Error} error @param {Record<string, unknown>} context */
  const attemptRecovery = (error, context) => {
    if (!errorBoundaryConfig.enableRecovery || errorState.isRecovering) return;

    const severity = categorizeSeverity(error);
    if (severity === ErrorSeverity.CRITICAL) {
      showErrorNotification(error);
      return;
    }

    errorState.isRecovering = true;
    try {
      if (severity !== ErrorSeverity.LOW && getErrorRate() <= 5) {
        showErrorNotification(error);
      }

      if (window.YouTubePlusErrorRecovery?.attemptRecovery) {
        window.YouTubePlusErrorRecovery.attemptRecovery(error, context);
      }

      setTimeout_(() => {
        errorState.isRecovering = false;
      }, 5000);
    } catch (recoveryError) {
      window.console.error('[YouTube+][ErrorBoundary] Recovery attempt failed', recoveryError);
      errorState.isRecovering = false;
    }
  };

  /** @param {Error} error @param {{ filename?: string; lineno?: number; [key: string]: unknown }} [context] */
  const logBoundaryError = (error, context = {}) => {
    if (!errorBoundaryConfig.enableLogging) return;

    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const fallbackMessage = normalizedError.message?.trim() || '';

    if (!fallbackMessage && !normalizedError.stack && !context.filename) {
      return;
    }

    const displayMessage =
      fallbackMessage ||
      (context.filename ? `Error in ${context.filename}:${context.lineno}` : 'Unknown error');

    const errorInfo = {
      timestamp: new Date().toISOString(),
      message: displayMessage,
      stack: normalizedError.stack,
      severity: categorizeSeverity(normalizedError),
      context: {
        url: window.location.href,
        userAgent: navigator.userAgent,
        ...context,
      },
    };

    logger.error('ErrorBoundary', displayMessage, errorInfo);

    errorState.errors.push(errorInfo);
    if (errorState.errors.length > 50) {
      errorState.errors.shift();
    }

    try {
      const stored = JSON.parse(localStorage.getItem(errorBoundaryConfig.storageKey) || '[]');
      stored.push(errorInfo);
      if (stored.length > 20) stored.shift();
      localStorage.setItem(errorBoundaryConfig.storageKey, JSON.stringify(stored));
    } catch (e) {
      void e;
    }
  };

  /** @param {(...args: any[]) => unknown} fn @param {string} [context] */
  const withErrorBoundary = (fn, context = 'unknown') => {
    /** @this {any} */
    return function (/** @type {any[]} */ ...args) {
      try {
        return fn.call(this, ...args);
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        logBoundaryError(normalizedError, { module: context, args });
        attemptRecovery(normalizedError, { module: context });
        return null;
      }
    };
  };

  /** @param {(...args: any[]) => Promise<unknown>} fn @param {string} [context] */
  const withAsyncErrorBoundary = (fn, context = 'unknown') => {
    /** @this {any} */
    return async function (/** @type {any[]} */ ...args) {
      try {
        return await fn.call(this, ...args);
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        logBoundaryError(normalizedError, { module: context, args });
        attemptRecovery(normalizedError, { module: context });
        return null;
      }
    };
  };

  const getErrorStats = () => ({
    totalErrors: errorState.errorCount,
    recentErrors: errorState.errors.length,
    lastErrorTime: errorState.lastErrorTime,
    isRecovering: errorState.isRecovering,
    errorsByType: errorState.errors.reduce((/** @type {Record<string, number>} */ acc, e) => {
      acc[e.severity] = (acc[e.severity] || 0) + 1;
      return acc;
    }, /** @type {Record<string, number>} */ ({})),
  });

  const clearErrors = () => {
    errorState.errors = [];
    errorState.errorCount = 0;
    errorState.lastErrorTime = 0;
    try {
      localStorage.removeItem(errorBoundaryConfig.storageKey);
    } catch (e) {
      void e;
    }
  };

  /** @param {ErrorEvent} event */
  const handleError = event => {
    const error = event.error || new Error(event.message);
    const message = (error.message || event.message || '').trim();

    if (message.includes('ResizeObserver loop')) return false;

    const source = event.filename || '';
    const isCrossOriginSource =
      source && !source.startsWith(window.location.origin) && !/YouTube\+/.test(source);
    if (!message && isCrossOriginSource) return false;
    if (!message || (message === '(no message)' && isCrossOriginSource)) return false;

    errorState.errorCount++;
    errorState.lastErrorTime = Date.now();

    logBoundaryError(error, {
      type: 'uncaught',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });

    if (isErrorRateExceeded()) {
      logger.error('ErrorBoundary', 'Error rate exceeded');
      return false;
    }

    attemptRecovery(error, { type: 'uncaught' });
    return false;
  };

  /** @param {PromiseRejectionEvent} event */
  const handleUnhandledRejection = event => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    errorState.errorCount++;
    errorState.lastErrorTime = Date.now();

    logBoundaryError(error, {
      type: 'unhandledRejection',
      promise: event.promise,
    });

    if (isErrorRateExceeded()) {
      logger.error('ErrorBoundary', 'Promise rejection rate exceeded');
      return;
    }

    attemptRecovery(error, { type: 'unhandledRejection' });
  };

  logger.withErrorBoundary = withErrorBoundary;
  logger.withAsyncErrorBoundary = withAsyncErrorBoundary;
  logger.getErrorStats = getErrorStats;
  logger.clearErrors = clearErrors;
  logger.logError = logBoundaryError;
  logger.getErrorRate = getErrorRate;
  logger.config = errorBoundaryConfig;

  // Export to window
  if (typeof window !== 'undefined') {
    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection, true);

    window.YouTubePlusLogger = /** @type {any} */ (logger);
    window.YouTubeErrorBoundary = {
      withErrorBoundary,
      withAsyncErrorBoundary,
      getErrorStats,
      clearErrors,
      logError: logBoundaryError,
      getErrorRate,
      config: errorBoundaryConfig,
    };
  }
})();
