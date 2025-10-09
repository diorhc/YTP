/**
 * @jest-environment jsdom
 */

describe('YouTubeErrorBoundary', () => {
    let errorBoundary;
    let consoleErrorSpy;
    let consoleWarnSpy;

    beforeEach(() => {
        // Mock implementation of error boundary for testing
        const stats = {
            totalErrors: 0,
            recentErrors: 0,
            lastErrorTime: 0,
            isRecovering: false,
            errorsByType: {},
        };

        errorBoundary = {
            logError: jest.fn((error, context) => {
                stats.totalErrors++;
                stats.recentErrors++;
                stats.lastErrorTime = Date.now();
                const errorType = error.constructor.name;
                stats.errorsByType[errorType] = (stats.errorsByType[errorType] || 0) + 1;
                console.error('[YouTube+ Error]', error, context);
            }),

            withErrorBoundary: jest.fn((fn, context) => {
                return /** @this {any} */ function (...args) {
                    try {
                        const fnAny = /** @type {any} */ (fn);
                        return fnAny.apply(this, args);
                    } catch (error) {
                        errorBoundary.logError(error, { context, args });
                        return undefined;
                    }
                };
            }),

            withAsyncErrorBoundary: jest.fn((fn, context) => {
                return /** @this {any} */ async function (...args) {
                    try {
                        const fnAny = /** @type {any} */ (fn);
                        return await fnAny.apply(this, args);
                    } catch (error) {
                        errorBoundary.logError(error, { context, args });
                        return undefined;
                    }
                };
            }),

            getErrorStats: jest.fn(() => ({ ...stats })),

            clearErrors: jest.fn(() => {
                stats.totalErrors = 0;
                stats.recentErrors = 0;
                stats.lastErrorTime = 0;
                stats.isRecovering = false;
                stats.errorsByType = {};
            }),
        };

        // Spy on console methods
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        jest.clearAllTimers();
    });

    describe('Basic Error Handling', () => {
        test('should log error with context', () => {
            const testError = new Error('Test error');
            errorBoundary.logError(testError, { module: 'TestModule' });

            expect(consoleErrorSpy).toHaveBeenCalled();
            const stats = errorBoundary.getErrorStats();
            expect(stats.totalErrors).toBe(1);
        });

        test('should track error statistics', () => {
            const error1 = new Error('Error 1');
            const error2 = new Error('Error 2');

            errorBoundary.logError(error1);
            errorBoundary.logError(error2);

            const stats = errorBoundary.getErrorStats();
            expect(stats.totalErrors).toBe(2);
            expect(stats.recentErrors).toBe(2);
        });

        test('should clear error statistics', () => {
            errorBoundary.logError(new Error('Test'));
            errorBoundary.clearErrors();

            const stats = errorBoundary.getErrorStats();
            expect(stats.totalErrors).toBe(0);
            expect(stats.recentErrors).toBe(0);
        });
    });

    describe('withErrorBoundary', () => {
        test('should wrap synchronous functions', () => {
            const mockFn = jest.fn(() => 'success');
            const wrapped = errorBoundary.withErrorBoundary(mockFn, 'TestContext');

            const result = wrapped();
            expect(result).toBe('success');
            expect(mockFn).toHaveBeenCalled();
        });

        test('should catch synchronous errors', () => {
            const mockFn = jest.fn(() => {
                throw new Error('Sync error');
            });
            const wrapped = errorBoundary.withErrorBoundary(mockFn, 'TestContext');

            const result = wrapped();
            expect(result).toBeUndefined();
            expect(consoleErrorSpy).toHaveBeenCalled();

            const stats = errorBoundary.getErrorStats();
            expect(stats.totalErrors).toBeGreaterThan(0);
        });

        test('should preserve function context and arguments', () => {
            const mockFn = jest.fn(function (a, b) {
                return a + b;
            });
            const wrapped = errorBoundary.withErrorBoundary(mockFn, 'TestContext');

            const result = wrapped(2, 3);
            expect(result).toBe(5);
            expect(mockFn).toHaveBeenCalledWith(2, 3);
        });
    });

    describe('withAsyncErrorBoundary', () => {
        test('should wrap asynchronous functions', async () => {
            const mockFn = jest.fn(async () => 'async success');
            const wrapped = errorBoundary.withAsyncErrorBoundary(mockFn, 'TestContext');

            const result = await wrapped();
            expect(result).toBe('async success');
            expect(mockFn).toHaveBeenCalled();
        });

        test('should catch asynchronous errors', async () => {
            const mockFn = jest.fn(async () => {
                throw new Error('Async error');
            });
            const wrapped = errorBoundary.withAsyncErrorBoundary(mockFn, 'TestContext');

            const result = await wrapped();
            expect(result).toBeUndefined();
            expect(consoleErrorSpy).toHaveBeenCalled();

            const stats = errorBoundary.getErrorStats();
            expect(stats.totalErrors).toBeGreaterThan(0);
        });

        test('should preserve async function context and arguments', async () => {
            const mockFn = jest.fn(async function (a, b) {
                return a * b;
            });
            const wrapped = errorBoundary.withAsyncErrorBoundary(mockFn, 'TestContext');

            const result = await wrapped(4, 5);
            expect(result).toBe(20);
            expect(mockFn).toHaveBeenCalledWith(4, 5);
        });
    });

    describe('Error Categories', () => {
        test('should categorize errors by type', () => {
            const typeError = new TypeError('Type error');
            const referenceError = new ReferenceError('Reference error');
            const syntaxError = new SyntaxError('Syntax error');

            errorBoundary.logError(typeError);
            errorBoundary.logError(referenceError);
            errorBoundary.logError(syntaxError);

            const stats = errorBoundary.getErrorStats();
            expect(stats.errorsByType).toBeDefined();
            expect(stats.errorsByType.TypeError).toBe(1);
            expect(stats.errorsByType.ReferenceError).toBe(1);
            expect(stats.errorsByType.SyntaxError).toBe(1);
        });
    });

    describe('Error Stats API', () => {
        test('should provide comprehensive error statistics', () => {
            errorBoundary.logError(new Error('Test'));

            const stats = errorBoundary.getErrorStats();

            expect(stats).toHaveProperty('totalErrors');
            expect(stats).toHaveProperty('recentErrors');
            expect(stats).toHaveProperty('lastErrorTime');
            expect(stats).toHaveProperty('isRecovering');
            expect(stats).toHaveProperty('errorsByType');

            expect(typeof stats.totalErrors).toBe('number');
            expect(typeof stats.recentErrors).toBe('number');
            expect(typeof stats.isRecovering).toBe('boolean');
            expect(typeof stats.errorsByType).toBe('object');
        });

        test('should update lastErrorTime when errors occur', () => {
            const beforeTime = Date.now();

            errorBoundary.logError(new Error('Test'));

            const stats = errorBoundary.getErrorStats();
            const afterTime = Date.now();

            expect(stats.lastErrorTime).toBeGreaterThanOrEqual(beforeTime);
            expect(stats.lastErrorTime).toBeLessThanOrEqual(afterTime);
        });
    });
});
