/**
 * @jest-environment jsdom
 */

describe('YouTubeErrorBoundary (real integration)', () => {
  /** @type {any} */
  let logger;
  /** @type {any} */
  let errorBoundary;

  /** Build an Event-shaped object that mimics a failed <script> load error event. */
  const evt_likeScriptError = target => {
    const e = new Event('loaderror');
    Object.defineProperty(e, 'target', { value: target, configurable: true });
    return e;
  };

  beforeEach(() => {
    jest.resetModules();

    delete window.YouTubePlusLogger;
    delete window.YouTubePlusErrorBoundary;
    delete window.YouTubeUtils;
    delete window.YouTubePlusCleanupManager;

    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/error-boundary.js');
    require('../src/logger.js');

    window.YouTubeUtils.NotificationManager = {
      show: jest.fn(),
    };

    jest.spyOn(window.console, 'error').mockImplementation(() => {
      /* mock */
    });
    jest.spyOn(window.console, 'warn').mockImplementation(() => {
      /* mock */
    });

    logger = window.YouTubePlusLogger;
    errorBoundary = window.YouTubePlusErrorBoundary;

    logger.setLevel('debug');
    logger.clear();
    errorBoundary.clearErrors();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('exports real boundary API from logger module', () => {
    expect(errorBoundary).toBeDefined();
    expect(typeof errorBoundary.withErrorBoundary).toBe('function');
    expect(typeof errorBoundary.withAsyncErrorBoundary).toBe('function');
    expect(typeof errorBoundary.logError).toBe('function');
    expect(typeof errorBoundary.getErrorStats).toBe('function');
    expect(typeof errorBoundary.getErrorRate).toBe('function');
  });

  test('withErrorBoundary captures sync error and records stats', () => {
    const wrapped = errorBoundary.withErrorBoundary(() => {
      throw new TypeError('Cannot read property x of undefined');
    }, 'sync-module');

    const result = wrapped('arg1');

    expect(result).toBeNull();
    const stats = errorBoundary.getErrorStats();
    expect(stats.totalErrors).toBe(0);
    expect(stats.recentErrors).toBe(1);
    expect(stats.errorsByType.medium).toBeGreaterThanOrEqual(1);
    expect(stats.isRecovering).toBe(true);
    expect(window.YouTubeUtils.NotificationManager.show).toHaveBeenCalled();
  });

  test('withAsyncErrorBoundary captures async error and logs via logger', async () => {
    const wrapped = errorBoundary.withAsyncErrorBoundary(async () => {
      throw new Error('network timeout while fetching captions');
    }, 'async-module');

    const result = await wrapped();

    expect(result).toBeNull();
    const recentErrors = logger.getRecent(10, 'error');
    expect(recentErrors.some(e => e.module === 'ErrorBoundary')).toBe(true);
    expect(errorBoundary.getErrorStats().isRecovering).toBe(true);
  });

  test('logError stores fallback message from context when message is empty', () => {
    const emptyError = new Error('');
    errorBoundary.logError(emptyError, { filename: 'main.js', lineno: 123 });

    const recentErrors = logger.getRecent(10, 'error');
    const boundaryEntry = recentErrors.find(e => e.module === 'ErrorBoundary');
    expect(boundaryEntry).toBeDefined();
    expect(boundaryEntry.message).toContain('main.js:123');
  });

  test('clearErrors resets stats and persisted storage', () => {
    errorBoundary.logError(new Error('first'));
    errorBoundary.logError(new Error('second'));

    expect(errorBoundary.getErrorStats().recentErrors).toBeGreaterThan(0);

    errorBoundary.clearErrors();

    const stats = errorBoundary.getErrorStats();
    expect(stats.recentErrors).toBe(0);
    expect(stats.totalErrors).toBe(0);
    expect(localStorage.getItem(errorBoundary.config.storageKey)).toBeNull();
  });

  test('global error event updates error counters and logs', () => {
    const evt = new ErrorEvent('error', {
      message: 'ReferenceError: bad value',
      filename: 'https://www.youtube.com/watch',
      lineno: 10,
      colno: 20,
      error: new ReferenceError('bad value'),
    });

    window.dispatchEvent(evt);

    const stats = errorBoundary.getErrorStats();
    expect(stats.totalErrors).toBeGreaterThanOrEqual(1);
    expect(stats.lastErrorTime).toBeGreaterThan(0);
  });

  test('unhandledrejection event increments counters', () => {
    const rejectionEvent = new Event('unhandledrejection');
    Object.defineProperty(rejectionEvent, 'reason', {
      value: new Error('promise failed hard'),
      configurable: true,
    });
    Object.defineProperty(rejectionEvent, 'promise', {
      value: Promise.reject(new Error('inner reject')).catch(() => {
        /* handled for test */
      }),
      configurable: true,
    });

    window.dispatchEvent(rejectionEvent);

    const stats = errorBoundary.getErrorStats();
    expect(stats.totalErrors).toBeGreaterThanOrEqual(1);
  });

  test('third-party resource load errors are ignored (no counters, no "[object Event]" spam)', () => {
    // Firefox fires a capture-phase `error` Event (no message/error payload)
    // for a failed <script>. Simulate YouTube's failing lottie script.
    const script = document.createElement('script');
    script.setAttribute('src', 'https://www.youtube.com/lottie-light.js');
    const evt = new Event('error');
    Object.defineProperty(evt, 'target', { value: script, configurable: true });

    window.dispatchEvent(evt);

    const stats = errorBoundary.getErrorStats();
    expect(stats.totalErrors).toBe(0);

    const recentErrors = logger.getRecent(10, 'error');
    const boundaryEntry = recentErrors.find(e => e.module === 'ErrorBoundary');
    expect(boundaryEntry).toBeUndefined();
  });

  test('rejection reason that is a raw script-load Event is suppressed, not "[object Event]"', () => {
    const script = document.createElement('script');
    script.setAttribute('src', 'https://www.youtube.com/other-failing.js');
    const rejectionEvent = new Event('unhandledrejection');
    rejectionEvent.preventDefault = jest.fn();
    Object.defineProperty(rejectionEvent, 'reason', {
      // Firefox can surface a failed script load as an unhandled rejection
      // whose reason is the Event object itself.
      value: evt_likeScriptError(script),
      configurable: true,
    });

    window.dispatchEvent(rejectionEvent);

    const recentErrors = logger.getRecent(10, 'error');
    const boundaryEntry = recentErrors.find(e => e.module === 'ErrorBoundary');
    expect(boundaryEntry).toBeUndefined();
    expect(rejectionEvent.preventDefault).toHaveBeenCalled();
  });

  test('identical errors within 500ms are logged once (dedup)', () => {
    errorBoundary.logError(new Error('dup probe'));
    errorBoundary.logError(new Error('dup probe'));

    const recentErrors = logger.getRecent(10, 'error');
    const dupLogs = recentErrors.filter(e => e.message === 'dup probe');
    expect(dupLogs).toHaveLength(1);
  });

  test('critical errors notify but skip recovery attempts', () => {
    window.YouTubeUtils.NotificationManager.show.mockClear();

    errorBoundary.logError(new Error('security csp violation detected'));
    const wrapped = errorBoundary.withErrorBoundary(() => {
      throw new Error('security csp violation detected');
    }, 'critical-module');

    wrapped();

    expect(window.YouTubeUtils.NotificationManager.show).toHaveBeenCalled();
    expect(errorBoundary.getErrorStats().isRecovering).toBe(false);
  });

  test('error context redacts full URL and navigator.userAgent', () => {
    errorBoundary.logError(new Error('redaction probe'));

    const recentErrors = logger.getRecent(10, 'error');
    const boundaryEntry = recentErrors.find(e => e.module === 'ErrorBoundary');
    expect(boundaryEntry).toBeDefined();
    const errorInfo = boundaryEntry.data;

    expect(errorInfo.context.url).toBe(window.location.pathname);
    expect(errorInfo.context.url).not.toContain('?');
    expect(errorInfo.context.url).not.toContain('#');
    expect(errorInfo.context).not.toHaveProperty('userAgent');

    const persisted = JSON.parse(localStorage.getItem(errorBoundary.config.storageKey));
    const lastPersisted = persisted[persisted.length - 1];
    expect(lastPersisted.context.url).toBe(window.location.pathname);
    expect(lastPersisted.context).not.toHaveProperty('userAgent');
  });

  test('withErrorBoundary does not include caller args in error context', () => {
    const secret = 'super-secret-token-12345';
    const wrapped = errorBoundary.withErrorBoundary(() => {
      throw new Error('arg leak probe');
    }, 'arg-leak-module');

    wrapped(secret, { password: 'p@ssw0rd' });

    const recentErrors = logger.getRecent(10, 'error');
    const boundaryEntry = recentErrors.find(e => e.message === 'arg leak probe');
    expect(boundaryEntry).toBeDefined();
    const serialized = JSON.stringify(boundaryEntry.data);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('p@ssw0rd');
  });

  test('security and CSP messages escalate to CRITICAL severity notice', () => {
    const wrapped = errorBoundary.withErrorBoundary(() => {
      throw new Error('inline script blocked by csp policy');
    }, 'csp-module');

    expect(wrapped('input')).toBeNull();
    const show = window.YouTubeUtils.NotificationManager.show;
    expect(show).toHaveBeenCalled();
    const call = show.mock.calls.at(-1);
    expect(call?.[0]).toBe(
      'A critical error occurred. YouTube+ may not function properly. Please report this issue.'
    );
    expect(call?.[1]).toEqual({ duration: 7000, type: 'error' });
  });

  test('type messages escalate to HIGH severity notice', () => {
    const wrapped = errorBoundary.withErrorBoundary(() => {
      throw new Error('a type error probe');
    }, 'type-module');

    expect(wrapped('input')).toBeNull();
    const call = window.YouTubeUtils.NotificationManager.show.mock.calls.at(-1);
    expect(call?.[0]).toBe('A serious error occurred. Please refresh the page if issues persist.');
    expect(call?.[1]).toEqual({ duration: 5000, type: 'error' });
  });
});
