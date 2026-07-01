/**
 * Error Boundary — canonical owner of error severity, recovery, and global
 * error/unhandledrejection listeners.
 *
 * Responsibilities:
 *   - Categorize errors by severity from message heuristics.
 *   - Persist recent errors in memory and localStorage.
 *   - Provide `withErrorBoundary` / `withAsyncErrorBoundary` function wrappers.
 *   - Bridge to YouTubeUtils.NotificationManager for user-visible alerts.
 *   - Bridge to YouTubePlusErrorRecovery.attemptRecovery for recovery hooks.
 *   - Install global `error` and `unhandledrejection` listeners.
 *
 * Public surface:
 *   window.YouTubePlusErrorBoundary
 *     - withErrorBoundary(fn, context?)
 *     - withAsyncErrorBoundary(fn, context?)
 *     - getErrorStats()
 *     - clearErrors()
 *     - logError(error, context?)
 *     - getErrorRate()
 *     - config
 *
 * Note: this module is intentionally logger-agnostic. It calls
 * `window.YouTubePlusLogger?.error?.(...)` for visible log output when
 * available, but never depends on it for control flow.
 */
(function () {
  const setTimeout_ = setTimeout;

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
    /** Max age (ms) for persisted errors in localStorage. 24 hours. */
    maxPersistAge: 86400000,
    /** Max stack trace lines stored to limit PII exposure. */
    maxStackLines: 3,
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
      if (!Y?.NotificationManager || typeof Y.NotificationManager.show !== 'function') {
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
    } catch (_notificationError) {}
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
    } catch (_recoveryError) {
      errorState.isRecovering = false;
    }
  };

  /** @param {Error} error @param {{ filename?: string; lineno?: number; [key: string]: unknown }} [context] */
  const logBoundaryError = (error, context = {}) => {
    if (!errorBoundaryConfig.enableLogging) return;

    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const fallbackMessage = normalizedError.message?.trim() || '';

    if (!(fallbackMessage || normalizedError.stack || context.filename)) {
      return;
    }

    const displayMessage =
      fallbackMessage ||
      (context.filename ? `Error in ${context.filename}:${context.lineno}` : 'Unknown error');

    /** Truncate stack trace to limit PII exposure in localStorage. */
    const scrubbedStack =
      normalizedError.stack?.split('\n').slice(0, errorBoundaryConfig.maxStackLines).join('\n') ||
      '';

    const errorInfo = {
      timestamp: new Date().toISOString(),
      message: displayMessage,
      stack: scrubbedStack,
      severity: categorizeSeverity(normalizedError),
      context: {
        url: window.location.pathname,
        ...context,
      },
    };

    try {
      const sink = window.YouTubePlusLogger;
      if (sink && typeof sink.error === 'function') {
        sink.error('ErrorBoundary', displayMessage, errorInfo);
      } else {
      }
    } catch (_loggingError) {}

    errorState.errors.push(errorInfo);
    if (errorState.errors.length > 50) {
      errorState.errors.shift();
    }

    try {
      const now = Date.now();
      const stored = JSON.parse(localStorage.getItem(errorBoundaryConfig.storageKey) || '[]');
      // Filter out expired entries (TTL-based expiry) before appending
      const fresh = Array.isArray(stored)
        ? stored.filter(e => {
            const ts = typeof e?.timestamp === 'string' ? new Date(e.timestamp).getTime() : 0;
            return now - ts < errorBoundaryConfig.maxPersistAge;
          })
        : [];
      fresh.push(errorInfo);
      if (fresh.length > 20) fresh.shift();
      localStorage.setItem(errorBoundaryConfig.storageKey, JSON.stringify(fresh));
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[YouTube+ ErrorBoundary] localStorage write failed:', e);
      }
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
        logBoundaryError(normalizedError, { module: context });
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
        logBoundaryError(normalizedError, { module: context });
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
    errorsByType: errorState.errors.reduce(
      (/** @type {Record<string, number>} */ acc, e) => {
        acc[e.severity] = (acc[e.severity] || 0) + 1;
        return acc;
      },
      /** @type {Record<string, number>} */ ({})
    ),
  });

  const clearErrors = () => {
    errorState.errors = [];
    errorState.errorCount = 0;
    errorState.lastErrorTime = 0;
    try {
      localStorage.removeItem(errorBoundaryConfig.storageKey);
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[YouTube+ ErrorBoundary] localStorage remove failed:', e);
      }
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
      try {
        const sink = window.YouTubePlusLogger;
        if (sink && typeof sink.error === 'function') {
          sink.error('ErrorBoundary', 'Error rate exceeded');
        } else {
        }
      } catch (_loggingError) {}
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
      try {
        const sink = window.YouTubePlusLogger;
        if (sink && typeof sink.error === 'function') {
          sink.error('ErrorBoundary', 'Promise rejection rate exceeded');
        } else {
        }
      } catch (_loggingError) {}
      return;
    }

    attemptRecovery(error, { type: 'unhandledRejection' });
  };

  const errorBoundary = {
    withErrorBoundary,
    withAsyncErrorBoundary,
    getErrorStats,
    clearErrors,
    logError: logBoundaryError,
    getErrorRate,
    config: errorBoundaryConfig,
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection, true);

    window.YouTubePlusErrorBoundary = /** @type {any} */ (errorBoundary);
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusErrorBoundary = /** @type {any} */ (errorBoundary);
    }
  }
})();
