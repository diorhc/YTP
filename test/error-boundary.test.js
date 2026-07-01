/**
 * @jest-environment jsdom
 */

describe('YouTubeErrorBoundary (real integration)', () => {
  /** @type {any} */
  let logger;
  /** @type {any} */
  let errorBoundary;

  beforeEach(() => {
    jest.resetModules();

    delete window.YouTubePlusLogger;
    delete window.YouTubePlusErrorBoundary;
    delete window.YouTubeUtils;
    delete window.YouTubePlusErrorRecovery;

    window.YouTubeUtils = {
      NotificationManager: {
        show: jest.fn(),
      },
    };

    window.YouTubePlusErrorRecovery = {
      attemptRecovery: jest.fn(),
    };

    jest.spyOn(window.console, 'error').mockImplementation(() => {});
    jest.spyOn(window.console, 'warn').mockImplementation(() => {});

    require('../src/logger.js');

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
    expect(window.YouTubePlusErrorRecovery.attemptRecovery).toHaveBeenCalled();
  });

  test('withAsyncErrorBoundary captures async error and logs via logger', async () => {
    const wrapped = errorBoundary.withAsyncErrorBoundary(async () => {
      throw new Error('network timeout while fetching captions');
    }, 'async-module');

    const result = await wrapped();

    expect(result).toBeNull();
    const recentErrors = logger.getRecent(10, 'error');
    expect(recentErrors.some(e => e.module === 'ErrorBoundary')).toBe(true);
    expect(window.YouTubePlusErrorRecovery.attemptRecovery).toHaveBeenCalled();
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
      value: Promise.reject(new Error('inner reject')).catch(() => {}),
      configurable: true,
    });

    window.dispatchEvent(rejectionEvent);

    const stats = errorBoundary.getErrorStats();
    expect(stats.totalErrors).toBeGreaterThanOrEqual(1);
  });

  test('critical errors notify but skip recovery attempts', () => {
    window.YouTubePlusErrorRecovery.attemptRecovery.mockClear();
    window.YouTubeUtils.NotificationManager.show.mockClear();

    errorBoundary.logError(new Error('security csp violation detected'));
    const wrapped = errorBoundary.withErrorBoundary(() => {
      throw new Error('security csp violation detected');
    }, 'critical-module');

    wrapped();

    expect(window.YouTubeUtils.NotificationManager.show).toHaveBeenCalled();
    expect(window.YouTubePlusErrorRecovery.attemptRecovery).not.toHaveBeenCalled();
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
});
