// Global error boundary for YouTube+ userscript
(function () {
  'use strict';

  /**
   * Circuit breaker states
   * @enum {string}
   */
  const CircuitState = {
    CLOSED: 'closed', // Normal operation
    OPEN: 'open', // Too many failures, block operations
    HALF_OPEN: 'half_open', // Testing if system recovered
  };

  /**
   * Error boundary configuration object with circuit breaker support
   * @typedef {Object} ErrorBoundaryConfig
   * @property {number} maxErrors - Maximum number of errors allowed within the error window
   * @property {number} errorWindow - Time window in milliseconds for tracking errors (default: 60000ms = 1 minute)
   * @property {boolean} enableLogging - Whether to log errors to console
   * @property {boolean} enableRecovery - Whether to attempt automatic recovery from errors
   * @property {string} storageKey - LocalStorage key for persisting error data
   * @property {Object} circuitBreaker - Circuit breaker configuration
   */
  const ErrorBoundaryConfig = {
    maxErrors: 10,
    errorWindow: 60000, // 1 minute
    enableLogging: true,
    enableRecovery: true,
    storageKey: 'youtube_plus_errors',
    // Circuit breaker to prevent cascading failures
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5, // Number of failures before opening circuit
      resetTimeout: 30000, // Time before attempting to close circuit (30s)
      halfOpenAttempts: 3, // Successful attempts needed to close circuit
    },
  };

  /**
   * Error tracking state with circuit breaker
   */
  const errorState = {
    errors: [],
    errorCount: 0,
    lastErrorTime: 0,
    isRecovering: false,
    // Circuit breaker state
    circuitState: CircuitState.CLOSED,
    circuitFailureCount: 0,
    circuitLastFailureTime: 0,
    circuitSuccessCount: 0,
  };

  /**
   * Error severity levels enumeration
   * @enum {string}
   */
  const ErrorSeverity = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
  };

  /**
   * Categorize error severity based on error message patterns
   * @param {Error} error - The error object to categorize
   * @returns {string} Severity level from ErrorSeverity enum
   */
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

  /**
   * Check circuit breaker state and update accordingly
   * @param {boolean} success - Whether the operation was successful
   * @returns {boolean} Whether the operation should proceed
   */
  const checkCircuitBreaker = success => {
    if (!ErrorBoundaryConfig.circuitBreaker.enabled) return true;

    const now = Date.now();
    const { circuitBreaker } = ErrorBoundaryConfig;

    // Check if circuit should be reset to half-open
    if (
      errorState.circuitState === CircuitState.OPEN &&
      now - errorState.circuitLastFailureTime >= circuitBreaker.resetTimeout
    ) {
      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.debug &&
        YouTubeUtils.logger.debug('[YouTube+] Circuit breaker transitioning to HALF_OPEN');
      errorState.circuitState = CircuitState.HALF_OPEN;
      errorState.circuitSuccessCount = 0;
    }

    // Handle successful operation
    if (success) {
      if (errorState.circuitState === CircuitState.HALF_OPEN) {
        errorState.circuitSuccessCount++;
        if (errorState.circuitSuccessCount >= circuitBreaker.halfOpenAttempts) {
          window.YouTubeUtils &&
            YouTubeUtils.logger &&
            YouTubeUtils.logger.debug &&
            YouTubeUtils.logger.debug('[YouTube+] Circuit breaker CLOSED - system recovered');
          errorState.circuitState = CircuitState.CLOSED;
          errorState.circuitFailureCount = 0;
          errorState.circuitSuccessCount = 0;
        }
      } else if (errorState.circuitState === CircuitState.CLOSED) {
        // Gradually decrease failure count on success
        errorState.circuitFailureCount = Math.max(0, errorState.circuitFailureCount - 1);
      }
      return true;
    }

    // Handle failed operation
    errorState.circuitFailureCount++;
    errorState.circuitLastFailureTime = now;

    if (errorState.circuitState === CircuitState.CLOSED) {
      if (errorState.circuitFailureCount >= circuitBreaker.failureThreshold) {
        console.error('[YouTube+] Circuit breaker OPEN - too many failures');
        errorState.circuitState = CircuitState.OPEN;
        return false;
      }
    } else if (errorState.circuitState === CircuitState.HALF_OPEN) {
      console.error('[YouTube+] Circuit breaker reopened - recovery failed');
      errorState.circuitState = CircuitState.OPEN;
      errorState.circuitSuccessCount = 0;
      return false;
    }

    return errorState.circuitState !== CircuitState.OPEN;
  };

  /**
   * Log error with context
   * @param {Error} error - The error object
   * @param {Object} context - Additional context information
   */
  const logError = (error, context = {}) => {
    if (!ErrorBoundaryConfig.enableLogging) return;

    // Update circuit breaker
    checkCircuitBreaker(false);

    const fallbackMessage = error.message?.trim() || '';

    // Skip if no meaningful message
    if (!fallbackMessage || fallbackMessage === '(no message)') {
      // Only log if we have stack trace or filename information
      if (!error.stack && !context.filename) {
        return;
      }
    }

    const displayMessage =
      fallbackMessage ||
      (context.filename ? `Error in ${context.filename}:${context.lineno}` : 'Unknown error');

    const errorInfo = {
      timestamp: new Date().toISOString(),
      message: displayMessage,
      stack: error.stack,
      severity: categorizeSeverity(error),
      context: {
        url: window.location.href,
        userAgent: navigator.userAgent,
        ...context,
      },
    };

    console.error('[YouTube+][Error Boundary]', `${errorInfo.message}`, errorInfo);

    // Store error for analysis
    errorState.errors.push(errorInfo);
    if (errorState.errors.length > 50) {
      errorState.errors.shift(); // Keep only last 50 errors
    }

    // Persist to localStorage for debugging
    try {
      const stored = JSON.parse(localStorage.getItem(ErrorBoundaryConfig.storageKey) || '[]');
      stored.push(errorInfo);
      if (stored.length > 20) stored.shift();
      localStorage.setItem(ErrorBoundaryConfig.storageKey, JSON.stringify(stored));
    } catch {}
  };

  /**
   * Check if error rate is too high
   * @returns {boolean} True if error rate exceeded
   */
  const isErrorRateExceeded = () => {
    const now = Date.now();
    const windowStart = now - ErrorBoundaryConfig.errorWindow;

    // Count errors in the time window
    const recentErrors = errorState.errors.filter(
      e => new Date(e.timestamp).getTime() > windowStart
    );

    return recentErrors.length >= ErrorBoundaryConfig.maxErrors;
  };

  /**
   * Get error rate per minute
   * @returns {number} Errors per minute
   */
  const getErrorRate = () => {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentErrors = errorState.errors.filter(
      e => new Date(e.timestamp).getTime() > oneMinuteAgo
    );
    return recentErrors.length;
  };

  /**
   * Check if should suppress error notification (rate limiting)
   * @param {Error} error - The error object
   * @returns {boolean} True if should suppress
   */
  const shouldSuppressNotification = error => {
    const rate = getErrorRate();

    // Suppress if more than 5 errors in the last minute
    if (rate > 5) {
      return true;
    }

    // Suppress duplicate errors within 10 seconds
    const tenSecondsAgo = Date.now() - 10000;
    const recentSimilar = errorState.errors.filter(
      e =>
        new Date(e.timestamp).getTime() > tenSecondsAgo &&
        e.message === error.message &&
        e.severity === categorizeSeverity(error)
    );

    return recentSimilar.length > 0;
  };

  /**
   * Show user-friendly error notification
   * @param {Error} error - The error object
   * @param {Object} _context - Error context (unused but kept for API consistency)
   */
  const showErrorNotification = (error, _context) => {
    try {
      const Y = window.YouTubeUtils;
      if (!Y || !Y.NotificationManager || typeof Y.NotificationManager.show !== 'function') {
        return; // Notification manager not available
      }

      const severity = categorizeSeverity(error);
      let message = 'An error occurred';
      let duration = 3000;

      switch (severity) {
        case ErrorSeverity.LOW:
          message = 'A minor issue occurred. Functionality should continue normally.';
          duration = 2000;
          break;
        case ErrorSeverity.MEDIUM:
          message = 'An error occurred. Some features may not work correctly.';
          duration = 3000;
          break;
        case ErrorSeverity.HIGH:
          message = 'A serious error occurred. Please refresh the page if issues persist.';
          duration = 5000;
          break;
        case ErrorSeverity.CRITICAL:
          message =
            'A critical error occurred. YouTube+ may not function properly. Please report this issue.';
          duration = 7000;
          break;
      }

      Y.NotificationManager.show(message, { duration, type: 'error' });
    } catch (notificationError) {
      console.error('[YouTube+] Failed to show error notification:', notificationError);
    }
  };

  /**
   * Attempt to recover from error
   * @param {Error} error - The error that occurred
   * @param {Object} context - Error context
   */
  const attemptRecovery = (error, context) => {
    if (!ErrorBoundaryConfig.enableRecovery || errorState.isRecovering) return;

    const severity = categorizeSeverity(error);

    if (severity === ErrorSeverity.CRITICAL) {
      console.error('[YouTube+] Critical error detected. Script may not function properly.');
      showErrorNotification(error, context);
      return;
    }

    errorState.isRecovering = true;

    try {
      // Show notification to user (except for low severity errors and rate-limited)
      if (severity !== ErrorSeverity.LOW && !shouldSuppressNotification(error)) {
        showErrorNotification(error, context);
      }

      // Use recovery utilities if available
      const RecoveryUtils = window.YouTubePlusErrorRecovery;

      if (RecoveryUtils && RecoveryUtils.attemptRecovery) {
        // Delegate to recovery utility module
        RecoveryUtils.attemptRecovery(error, context);
      } else {
        // Fallback to legacy recovery
        performLegacyRecovery(error, context);
      }

      setTimeout(() => {
        errorState.isRecovering = false;
      }, 5000);
    } catch (recoveryError) {
      console.error('[YouTube+] Recovery attempt failed:', recoveryError);
      errorState.isRecovering = false;
    }
  };

  /**
   * Perform legacy recovery (fallback)
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   */
  const performLegacyRecovery = (error, context) => {
    // Attempt module-specific recovery
    if (context.module) {
      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.debug &&
        YouTubeUtils.logger.debug(`[YouTube+] Attempting recovery for module: ${context.module}`);

      // Try to reinitialize the module if possible
      const Y = window.YouTubeUtils;
      if (Y && Y.cleanupManager) {
        // Could cleanup and reinitialize module-specific resources
        switch (context.module) {
          case 'StyleManager':
            // Clear and re-add styles if needed
            break;
          case 'NotificationManager':
            // Reset notification queue
            break;
          default:
            // Generic cleanup
            break;
        }
      }

      // Check if it's a DOM-related error and the element is missing
      if (
        error.message &&
        (error.message.includes('null') || error.message.includes('undefined')) &&
        context.element
      ) {
        window.YouTubeUtils &&
          YouTubeUtils.logger &&
          YouTubeUtils.logger.debug &&
          YouTubeUtils.logger.debug('[YouTube+] Attempting to re-query DOM element');
        // Could trigger element re-query here
      }
    }
  };

  /**
   * Global error handler
   * @param {ErrorEvent} event - The error event
   */
  const handleError = event => {
    const error = event.error || new Error(event.message);

    const message = (error.message || event.message || '').trim();
    const source = event.filename || '';
    const isCrossOriginSource =
      source && !source.startsWith(window.location.origin) && !/YouTube\+/.test(source);

    // Ignore opaque cross-origin errors we can't introspect
    if (!message && isCrossOriginSource) {
      return false;
    }

    // Skip logging if message is empty or just "(no message)" and from cross-origin
    if (!message || (message === '(no message)' && isCrossOriginSource)) {
      return false;
    }

    // Track error
    errorState.errorCount++;
    errorState.lastErrorTime = Date.now();

    // Log error
    logError(error, {
      type: 'uncaught',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });

    // Check error rate
    if (isErrorRateExceeded()) {
      console.error(
        '[YouTube+] Error rate exceeded! Too many errors in short period. Some features may be disabled.'
      );
      return false;
    }

    // Attempt recovery
    attemptRecovery(error, { type: 'uncaught' });

    // Don't prevent default error handling
    return false;
  };

  /**
   * Unhandled promise rejection handler
   * @param {PromiseRejectionEvent} event - The rejection event
   */
  const handleUnhandledRejection = event => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));

    logError(error, {
      type: 'unhandledRejection',
      promise: event.promise,
    });

    // Check error rate
    if (isErrorRateExceeded()) {
      console.error('[YouTube+] Promise rejection rate exceeded!');
      return;
    }

    // Attempt recovery
    attemptRecovery(error, { type: 'unhandledRejection' });
  };

  /**
   * Safe function wrapper with error boundary
   * @param {Function} fn - Function to wrap
   * @param {string} context - Context identifier
   * @returns {Function} Wrapped function
   */
  const withErrorBoundary = (fn, context = 'unknown') => {
    /** @this {any} */
    return function (...args) {
      try {
        const fnAny = /** @type {any} */ (fn);
        return /** @this {any} */ fnAny.call(this, ...args);
      } catch (error) {
        logError(error, { module: context, args });
        attemptRecovery(error, { module: context });
        return null;
      }
    };
  };

  /**
   * Safe async function wrapper with error boundary
   * @param {Function} fn - Async function to wrap
   * @param {string} context - Context identifier
   * @returns {Function} Wrapped async function
   */
  const withAsyncErrorBoundary = (fn, context = 'unknown') => {
    /** @this {any} */
    return async function (...args) {
      try {
        const fnAny = /** @type {any} */ (fn);
        return /** @this {any} */ await fnAny.call(this, ...args);
      } catch (error) {
        logError(error, { module: context, args });
        attemptRecovery(error, { module: context });
        return null;
      }
    };
  };

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  const getErrorStats = () => {
    return {
      totalErrors: errorState.errorCount,
      recentErrors: errorState.errors.length,
      lastErrorTime: errorState.lastErrorTime,
      isRecovering: errorState.isRecovering,
      errorsByType: errorState.errors.reduce((acc, e) => {
        acc[e.severity] = (acc[e.severity] || 0) + 1;
        return acc;
      }, {}),
    };
  };

  /**
   * Clear stored errors
   */
  const clearErrors = () => {
    errorState.errors = [];
    try {
      localStorage.removeItem(ErrorBoundaryConfig.storageKey);
    } catch {}
  };

  // Install global error handlers
  if (typeof window !== 'undefined') {
    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection, true);

    // Expose error boundary utilities
    window.YouTubeErrorBoundary = {
      withErrorBoundary,
      withAsyncErrorBoundary,
      getErrorStats,
      clearErrors,
      logError,
      getErrorRate,
      config: ErrorBoundaryConfig,
    };

    window.YouTubeUtils &&
      YouTubeUtils.logger &&
      YouTubeUtils.logger.debug &&
      YouTubeUtils.logger.debug('[YouTube+][Error Boundary]', 'Error boundary initialized');
  }
})();
