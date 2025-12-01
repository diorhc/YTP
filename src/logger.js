/**
 * Centralized Logging System for YouTube Plus
 * Provides consistent logging across all modules with level filtering and production optimization
 */

(function () {
  'use strict';

  /**
   * Log levels enumeration
   * @enum {number}
   */
  const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    CRITICAL: 4,
    NONE: 5,
  };

  /**
   * Logger configuration
   * @typedef {Object} LoggerConfig
   * @property {number} level - Minimum log level to display
   * @property {boolean} enabled - Master switch for logging
   * @property {boolean} includeTimestamp - Include timestamp in logs
   * @property {boolean} includeStack - Include stack traces for errors
   * @property {number} maxStackLines - Maximum number of stack trace lines
   * @property {Function} [customHandler] - Custom log handler function
   */

  /** @type {LoggerConfig} */
  const config = {
    level: LogLevel.INFO, // Set to WARN or ERROR in production
    enabled: true,
    includeTimestamp: false,
    includeStack: true,
    maxStackLines: 5,
    customHandler: null,
  };

  /**
   * Format timestamp for logs
   * @returns {string} Formatted timestamp
   */
  const getTimestamp = () => {
    const now = new Date();
    return now.toISOString().substring(11, 23); // HH:MM:SS.mmm
  };

  /**
   * Format stack trace
   * @param {Error} error - Error object
   * @returns {string} Formatted stack trace
   */
  const formatStack = error => {
    if (!error || !error.stack) return '';
    const lines = error.stack.split('\n');
    const relevantLines = lines.slice(0, config.maxStackLines);
    return `\n${relevantLines.join('\n')}`;
  };

  /**
   * Create log message
   * @param {string} module - Module name
   * @param {string} level - Log level name
   * @param {Array} args - Log arguments
   * @returns {Array} Formatted log arguments
   */
  const formatMessage = (module, level, args) => {
    const parts = ['[YouTube+]'];

    if (config.includeTimestamp) {
      parts.push(`[${getTimestamp()}]`);
    }

    parts.push(`[${level}]`);

    if (module) {
      parts.push(`[${module}]`);
    }

    return [parts.join(' '), ...args];
  };

  /**
   * Core logging function
   * @param {string} module - Module name
   * @param {number} level - Log level
   * @param {string} levelName - Log level name
   * @param {Function} consoleFn - Console function to use
   * @param {Array} args - Arguments to log
   */
  /**
   * Check if logging is enabled and level is sufficient
   * @param {number} level - Log level
   * @returns {boolean} True if should log
   */
  const shouldLog = level => {
    return config.enabled && level >= config.level;
  };

  /**
   * Add stack trace to formatted args if needed
   * @param {Array} formattedArgs - Formatted arguments
   * @param {number} level - Log level
   * @param {Array} args - Original arguments
   * @returns {void}
   */
  const addStackTraceIfNeeded = (formattedArgs, level, args) => {
    if (level >= LogLevel.ERROR && config.includeStack) {
      const lastArg = args[args.length - 1];
      if (lastArg instanceof Error) {
        formattedArgs.push(formatStack(lastArg));
      }
    }
  };

  /**
   * Output log message using custom handler or console
   * @param {string} module - Module name
   * @param {number} level - Log level
   * @param {string} levelName - Level name
   * @param {Function} consoleFn - Console function
   * @param {Array} formattedArgs - Formatted arguments
   * @returns {void}
   */
  const outputLog = (module, level, levelName, consoleFn, formattedArgs) => {
    if (config.customHandler) {
      config.customHandler(module, level, levelName, formattedArgs);
    } else if (typeof consoleFn === 'function') {
      consoleFn(...formattedArgs);
    }
  };

  /**
   * Log a message with the specified level
   * @param {string} module - Module name
   * @param {number} level - Log level
   * @param {string} levelName - Level name string
   * @param {Function} consoleFn - Console function to use
   * @param {Array} args - Arguments to log
   * @returns {void}
   */
  const log = (module, level, levelName, consoleFn, args) => {
    if (!shouldLog(level)) return;

    try {
      const formattedArgs = formatMessage(module, levelName, args);
      addStackTraceIfNeeded(formattedArgs, level, args);
      outputLog(module, level, levelName, consoleFn, formattedArgs);
    } catch (err) {
      // Fallback to basic console.error if logging itself fails
      if (typeof console !== 'undefined' && console.error) {
        console.error('[YouTube+] Logger error:', err);
      }
    }
  };

  /**
   * Logger class for module-specific logging
   */
  class ModuleLogger {
    /**
     * Create a module logger
     * @param {string} moduleName - Name of the module
     */
    constructor(moduleName) {
      this.moduleName = moduleName || 'Unknown';
    }

    /**
     * Log debug message
     * @param {...*} args - Arguments to log
     */
    debug(...args) {
      log(this.moduleName, LogLevel.DEBUG, 'DEBUG', console.log, args);
    }

    /**
     * Log info message
     * @param {...*} args - Arguments to log
     */
    info(...args) {
      log(this.moduleName, LogLevel.INFO, 'INFO', console.log, args);
    }

    /**
     * Log warning message
     * @param {...*} args - Arguments to log
     */
    warn(...args) {
      log(this.moduleName, LogLevel.WARN, 'WARN', console.warn, args);
    }

    /**
     * Log error message
     * @param {...*} args - Arguments to log
     */
    error(...args) {
      log(this.moduleName, LogLevel.ERROR, 'ERROR', console.error, args);
    }

    /**
     * Log critical error message
     * @param {...*} args - Arguments to log
     */
    critical(...args) {
      log(this.moduleName, LogLevel.CRITICAL, 'CRITICAL', console.error, args);
    }

    /**
     * Log with custom level (for backwards compatibility)
     * @param {string} level - Log level name
     * @param {...*} args - Arguments to log
     */
    log(level, ...args) {
      const levelMap = {
        debug: () => this.debug(...args),
        info: () => this.info(...args),
        warn: () => this.warn(...args),
        error: () => this.error(...args),
        critical: () => this.critical(...args),
      };

      const logFn = levelMap[level.toLowerCase()];
      if (logFn) {
        logFn();
      } else {
        this.info(...args);
      }
    }
  }

  /**
   * Logger factory
   * @param {string} moduleName - Module name
   * @returns {ModuleLogger} Logger instance for the module
   */
  const createLogger = moduleName => {
    return new ModuleLogger(moduleName);
  };

  /**
   * Configure logger
   * @param {Partial<LoggerConfig>} options - Configuration options
   */
  const configure = options => {
    if (typeof options !== 'object' || options === null) return;

    if (typeof options.level === 'number') {
      config.level = options.level;
    }
    if (typeof options.enabled === 'boolean') {
      config.enabled = options.enabled;
    }
    if (typeof options.includeTimestamp === 'boolean') {
      config.includeTimestamp = options.includeTimestamp;
    }
    if (typeof options.includeStack === 'boolean') {
      config.includeStack = options.includeStack;
    }
    if (typeof options.maxStackLines === 'number') {
      config.maxStackLines = options.maxStackLines;
    }
    if (typeof options.customHandler === 'function') {
      config.customHandler = options.customHandler;
    }
  };

  /**
   * Set log level
   * @param {number|string} level - Log level (number or name)
   */
  const setLevel = level => {
    if (typeof level === 'number') {
      config.level = level;
    } else if (typeof level === 'string') {
      const levelMap = {
        debug: LogLevel.DEBUG,
        info: LogLevel.INFO,
        warn: LogLevel.WARN,
        error: LogLevel.ERROR,
        critical: LogLevel.CRITICAL,
        none: LogLevel.NONE,
      };
      const levelValue = levelMap[level.toLowerCase()];
      if (levelValue !== undefined) {
        config.level = levelValue;
      }
    }
  };

  /**
   * Enable/disable logging
   * @param {boolean} enabled - Whether logging is enabled
   */
  const setEnabled = enabled => {
    config.enabled = !!enabled;
  };

  // Expose to window for global access
  if (typeof window !== 'undefined') {
    /** @type {any} */ (window).YouTubePlusLogger = {
      createLogger,
      configure,
      setLevel,
      setEnabled,
      LogLevel,
      // Default logger for backwards compatibility
      logger: createLogger('YouTube+'),
    };
  }

  console.log('[YouTube+] Logger system initialized');
})();
