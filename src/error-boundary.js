/**
 * Error Boundary: owner of error severity, recovery, and global
 * error/unhandledrejection listeners.
 *
 * Responsibilities:
 *   - Categorize errors by severity from message heuristics.
 *   - Persist recent errors in memory and localStorage.
 *   - Provide `withErrorBoundary` / `withAsyncErrorBoundary` function wrappers.
 *   - Bridge to YouTubeUtils.NotificationManager for user-visible alerts.
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

  /** Dedup state for the logging path (message + timestamp of last logged error). */
  let lastLoggedMessage = '';
  let lastLoggedTime = 0;

  /** Suppress identical repeats logged within 500ms (browser re-dispatches the same event to multiple capture/bubble listeners). @param {string} displayMessage @returns {boolean} true when this exact message was just logged. */
  const isDuplicateLog = displayMessage => {
    const now = Date.now();
    if (displayMessage === lastLoggedMessage && now - lastLoggedTime < 500) return true;
    lastLoggedMessage = displayMessage;
    lastLoggedTime = now;
    return false;
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
    } catch (_notificationError) {
      /* Notification failure is non-critical; suppress to avoid recursive errors. */
    }
  };

  /** @param {Error} error @param {Record<string, unknown>} _context - reserved for a future recovery-hook bridge */
  const attemptRecovery = (error, _context) => {
    if (!errorBoundaryConfig.enableRecovery || errorState.isRecovering) return;

    const severity = categorizeSeverity(error);
    if (severity === ErrorSeverity.CRITICAL) {
      showErrorNotification(error);
      return;
    }

    errorState.isRecovering = true;
    if (severity !== ErrorSeverity.LOW && getErrorRate() <= 5) {
      showErrorNotification(error);
    }

    setTimeout_(() => {
      errorState.isRecovering = false;
    }, 5000);
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
    if (isDuplicateLog(displayMessage)) return;

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

    // Suppressed/expected errors log at debug level; real failures at error.
    const sink = window.YouTubePlusLogger;
    const level = context.level === 'debug' ? 'debug' : 'error';
    if (sink && typeof sink[level] === 'function') {
      sink[level]('ErrorBoundary', displayMessage, errorInfo);
    }

    errorState.errors.push(errorInfo);
    if (errorState.errors.length > 50) {
      errorState.errors.shift();
    }

    schedulePersist(errorInfo);
  };

  /** Persist an error into localStorage with TTL-based pruning (best effort).
   *  Writes are rate-limited to at most one per {@link PERSIST_MIN_INTERVAL}
   *  milliseconds; extra errors are batched and flushed at the window's end. */
  const PERSIST_MIN_INTERVAL = 5000;
  let lastPersistAt = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let persistTimer = null;
  /** @type {BoundaryErrorInfo[]} */
  let pendingPersist = [];

  const flushPersisted = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (pendingPersist.length === 0) return;
    const batch = pendingPersist;
    pendingPersist = [];
    lastPersistAt = Date.now();
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
      for (const entry of batch) fresh.push(entry);
      while (fresh.length > 20) fresh.shift();
      localStorage.setItem(errorBoundaryConfig.storageKey, JSON.stringify(fresh));
    } catch (e) {
      const log = window.YouTubePlusLogger;
      if (log?.warn) {
        log.warn('ErrorBoundary', 'localStorage write failed:', e);
      } else if (typeof console !== 'undefined' && console.warn) {
        console.warn('[YouTube+ ErrorBoundary] localStorage write failed:', e);
      }
    }
  };

  /** @param {BoundaryErrorInfo} errorInfo */
  const schedulePersist = errorInfo => {
    pendingPersist.push(errorInfo);
    const elapsed = Date.now() - lastPersistAt;
    if (elapsed >= PERSIST_MIN_INTERVAL) {
      flushPersisted();
      return;
    }
    if (!persistTimer) {
      persistTimer = setTimeout_(flushPersisted, PERSIST_MIN_INTERVAL - elapsed);
    }
  };

  /** Report a boundary failure: log, recover, and never rethrow. */
  const handleBoundaryFailure = (/** @type {unknown} */ error, /** @type {string} */ context) => {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    logBoundaryError(normalizedError, { module: context });
    attemptRecovery(normalizedError, { module: context });
    return null;
  };

  /**
   * @template {(...args: never[]) => unknown} F
   * @param {F} fn
   * @param {string} [context]
   * @returns {F}
   */
  const withErrorBoundary = (fn, context = 'unknown') => {
    const callable = /** @type {(...args: unknown[]) => unknown} */ (/** @type {unknown} */ (fn));
    return /** @type {F} */ (
      /** @type {unknown} */ (
        /** @this {unknown} */
        function (/** @type {unknown[]} */ ...args) {
          try {
            return callable.call(this, ...args);
          } catch (error) {
            return handleBoundaryFailure(error, context);
          }
        }
      )
    );
  };

  /**
   * @template {(...args: never[]) => Promise<unknown>} F
   * @param {F} fn
   * @param {string} [context]
   * @returns {F}
   */
  const withAsyncErrorBoundary = (fn, context = 'unknown') => {
    const callable = /** @type {(...args: unknown[]) => Promise<unknown>} */ (
      /** @type {unknown} */ (fn)
    );
    return /** @type {F} */ (
      /** @type {unknown} */ (
        /** @this {unknown} */
        async function (/** @type {unknown[]} */ ...args) {
          try {
            return await callable.call(this, ...args);
          } catch (error) {
            return handleBoundaryFailure(error, context);
          }
        }
      )
    );
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
    pendingPersist = [];
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try {
      localStorage.removeItem(errorBoundaryConfig.storageKey);
    } catch (e) {
      const log = window.YouTubePlusLogger;
      if (log?.warn) {
        log.warn('ErrorBoundary', 'localStorage remove failed:', e);
      } else if (typeof console !== 'undefined' && console.warn) {
        console.warn('[YouTube+ ErrorBoundary] localStorage remove failed:', e);
      }
    }
  };

  /**
   * Extract the failing resource URL from a capture-phase load error
   * (failed <script>/<link>/<img> fire a plain Event that reaches window
   * listeners in the capture phase). Returns null when the event carries a
   * real error payload (script execution error), not a load failure.
   * @param {Event} event
   * @returns {string | null}
   */
  const getResourceLoadErrorUrl = event => {
    // cross-realm: the failing <script>/<link>/<img> target is read structurally
    const target = /** @type {{ tagName?: string; src?: string; href?: string } | null} */ (
      /** @type {unknown} */ (event?.target)
    );
    const tag = target?.tagName;
    if (typeof tag !== 'string') return null;
    if (tag !== 'SCRIPT' && tag !== 'LINK' && tag !== 'IMG') return null;
    return target?.src || target?.href || 'unknown resource';
  };

  /** @param {ErrorEvent} event */
  const handleError = event => {
    if (getResourceLoadErrorUrl(event) !== null) {
      // Load failure of a page resource (YouTube's own scripts, assets, etc.).
      // Never our runtime error (our own script load fails before we run), so
      // reporting these produced "[object Event]" console spam.
      return false;
    }

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
      const sink = window.YouTubePlusLogger;
      if (sink && typeof sink.error === 'function') {
        sink.error('ErrorBoundary', 'Error rate exceeded');
      }
      return false;
    }

    attemptRecovery(error, { type: 'uncaught' });
    return false;
  };

  /** @param {PromiseRejectionEvent} event */
  const handleUnhandledRejection = event => {
    let reason = event.reason;

    // Some failures surface as a rejection whose reason is a raw Event
    // (e.g. a failed <script> load re-dispatched as a rejection on Firefox,
    // or GM/fetch onerror handlers rejecting with the response event).
    // String() of those is "[object Event]"; classify instead of logging junk.
    if (reason && typeof reason === 'object' && !(reason instanceof Error)) {
      const resourceUrl = getResourceLoadErrorUrl(reason);
      if (resourceUrl !== null) {
        // Resource load failure re-dispatched as a rejection: not our runtime
        // error; suppress instead of logging "[object Event]" spam.
        event.preventDefault?.();
        return;
      }
      if (typeof reason.type === 'string' && reason.target != null) {
        // Event-shaped reason without a resource target; don't stringify.
        reason = new Error(`Unhandled rejection with ${reason.type || 'unknown'} event`);
      }
    }

    const error = reason instanceof Error ? reason : new Error(String(reason));
    errorState.errorCount++;
    errorState.lastErrorTime = Date.now();

    logBoundaryError(error, {
      type: 'unhandledRejection',
      promise: event.promise,
    });

    if (isErrorRateExceeded()) {
      const sink = window.YouTubePlusLogger;
      if (sink && typeof sink.error === 'function') {
        sink.error('ErrorBoundary', 'Promise rejection rate exceeded');
      }
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
    window.YouTubePlusCleanupManager?.registerListener?.(window, 'error', handleError, true, true);
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'unhandledrejection',
      handleUnhandledRejection,
      true,
      true
    );

    window.YouTubePlusErrorBoundary = /** @type {YouTubeErrorBoundary} */ (errorBoundary);
  }
})();
