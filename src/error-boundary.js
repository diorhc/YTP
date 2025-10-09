// Global error boundary for YouTube+ userscript
(function () {
  'use strict';

  /**
   * Error boundary configuration
   */
  const ErrorBoundaryConfig = {
    maxErrors: 10,
    errorWindow: 60000, // 1 minute
    enableLogging: true,
    enableRecovery: true,
    storageKey: 'youtube_plus_errors',
  };

  /**
   * Error tracking state
   */
  const errorState = {
    errors: [],
    errorCount: 0,
    lastErrorTime: 0,
    isRecovering: false,
  };

  /**
   * Error severity levels
   */
  const ErrorSeverity = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
  };

  /**
   * Categorize error severity
   * @param {Error} error - The error object
   * @returns {string} Severity level
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
   * Log error with context
   * @param {Error} error - The error object
   * @param {Object} context - Additional context information
   */
  const logError = (error, context = {}) => {
    if (!ErrorBoundaryConfig.enableLogging) return;

    const fallbackMessage = error.message?.trim() || '(no message)';

    const errorInfo = {
      timestamp: new Date().toISOString(),
      message: fallbackMessage,
      stack: error.stack,
      severity: categorizeSeverity(error),
      context: {
        url: window.location.href,
        userAgent: navigator.userAgent,
        ...context,
      },
    };

    console.error(`[YouTube+ Error Boundary] ${errorInfo.message}`, errorInfo);

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
   * Attempt to recover from error
   * @param {Error} error - The error that occurred
   * @param {Object} context - Error context
   */
  const attemptRecovery = (error, context) => {
    if (!ErrorBoundaryConfig.enableRecovery || errorState.isRecovering) return;

    const severity = categorizeSeverity(error);

    if (severity === ErrorSeverity.CRITICAL) {
      console.error('[YouTube+] Critical error detected. Script may not function properly.');
      return;
    }

    errorState.isRecovering = true;

    try {
      // Attempt recovery based on error type
      if (context.module && window.YouTubeUtils?.cleanupManager) {
        console.log(`[YouTube+] Attempting recovery for module: ${context.module}`);
        // Could implement module-specific recovery here
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
   * Global error handler
   * @param {ErrorEvent} event - The error event
   */
  const handleError = event => {
    const error = event.error || new Error(event.message);

    const message = (error.message || event.message || '').trim();
    const source = event.filename || '';
    const isCrossOriginSource =
      source && !source.startsWith(window.location.origin) && !/YouTube\+/.test(source);

    if (!message && isCrossOriginSource) {
      // Ignore opaque cross-origin errors we can't introspect
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
      return;
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
        return /** @this {any} */ fnAny.apply(this, args);
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
        return /** @this {any} */ await fnAny.apply(this, args);
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
    };

    console.log('[YouTube+] Error boundary initialized');
  }
})();
