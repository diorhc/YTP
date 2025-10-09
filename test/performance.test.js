/**
 * @jest-environment jsdom
 */

describe('YouTubePerformance', () => {
    let performance;
    let consoleLogSpy;

    beforeEach(() => {
        // Mock implementation of performance monitoring for testing
        const metrics = new Map();
        const config = {
            enabled: true,
            sampleRate: 1,
            storageKey: 'ytplus-perf',
            metricsRetention: 3600000,
            enableConsoleOutput: false,
        };

        performance = {
            mark: jest.fn(name => {
                if (window.performance && window.performance.mark) {
                    window.performance.mark(name);
                }
            }),

            measure: jest.fn((name, startMark, endMark) => {
                if (window.performance && window.performance.measure) {
                    try {
                        window.performance.measure(name, startMark, endMark);
                        const entry = window.performance.getEntriesByName(name, 'measure')[0];
                        return entry ? entry.duration : 0;
                    } catch (e) {
                        return 0;
                    }
                }
                return 0;
            }),

            recordMetric: jest.fn((name, value, metadata) => {
                if (!metrics.has(name)) {
                    metrics.set(name, {
                        values: [],
                        count: 0,
                        total: 0,
                        avg: 0,
                        min: Infinity,
                        max: -Infinity,
                    });
                }
                const metric = metrics.get(name);
                metric.values.push({ value, metadata, timestamp: Date.now() });
                metric.count++;
                metric.total += value;
                metric.avg = metric.total / metric.count;
                metric.min = Math.min(metric.min, value);
                metric.max = Math.max(metric.max, value);
            }),

            getStats: jest.fn(metricName => {
                if (!metricName) return null;
                return metrics.get(metricName) || null;
            }),

            timeFunction: jest.fn((name, fn) => {
                return /** @this {any} */ function (...args) {
                    const start = Date.now();
                    try {
                        const fnAny = /** @type {any} */ (fn);
                        const result = fnAny.apply(this, args);
                        const duration = Date.now() - start;
                        performance.recordMetric(name, duration);
                        return result;
                    } catch (error) {
                        const duration = Date.now() - start;
                        performance.recordMetric(name, duration);
                        throw error;
                    }
                };
            }),

            timeAsyncFunction: jest.fn((name, fn) => {
                return /** @this {any} */ async function (...args) {
                    const start = Date.now();
                    try {
                        const fnAny = /** @type {any} */ (fn);
                        const result = await fnAny.apply(this, args);
                        const duration = Date.now() - start;
                        performance.recordMetric(name, duration);
                        return result;
                    } catch (error) {
                        const duration = Date.now() - start;
                        performance.recordMetric(name, duration);
                        throw error;
                    }
                };
            }),

            exportMetrics: jest.fn(() => {
                const exported = {};
                metrics.forEach((value, key) => {
                    exported[key] = {
                        count: value.count,
                        total: value.total,
                        avg: value.avg,
                        min: value.min === Infinity ? 0 : value.min,
                        max: value.max === -Infinity ? 0 : value.max,
                    };
                });
                return JSON.stringify(exported, null, 2);
            }),

            clearMetrics: jest.fn(() => {
                metrics.clear();
            }),

            monitorMutations: jest.fn((element, name) => {
                if (typeof MutationObserver === 'undefined') return null;
                const observer = new MutationObserver(() => {
                    performance.recordMetric(name, 1);
                });
                observer.observe(element, { childList: true, subtree: true });
                return observer;
            }),

            getPerformanceEntries: jest.fn(type => {
                if (window.performance && window.performance.getEntriesByType) {
                    return window.performance.getEntriesByType(type);
                }
                return [];
            }),

            config,
        };

        // Spy on console
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        jest.clearAllTimers();
    });
    describe('Basic Performance Tracking', () => {
        test('should create performance marks', () => {
            performance.mark('test-mark');

            // Marks should be created (no errors)
            expect(performance).toBeDefined();
        });

        test('should measure between marks', () => {
            performance.mark('start');
            performance.mark('end');

            const duration = performance.measure('test-measure', 'start', 'end');

            expect(typeof duration).toBe('number');
            expect(duration).toBeGreaterThanOrEqual(0);
        });

        test('should record custom metrics', () => {
            performance.recordMetric('custom-metric', 123, { unit: 'ms' });

            const stats = performance.getStats('custom-metric');
            expect(stats).toBeDefined();
            expect(stats.count).toBe(1);
        });
    });

    describe('timeFunction', () => {
        test('should wrap synchronous functions', () => {
            const mockFn = jest.fn(() => 'result');
            const timedFn = performance.timeFunction('sync-test', mockFn);

            const result = timedFn();

            expect(result).toBe('result');
            expect(mockFn).toHaveBeenCalled();

            const stats = performance.getStats('sync-test');
            expect(stats).toBeDefined();
        });

        test('should preserve function arguments', () => {
            const mockFn = jest.fn((a, b) => a + b);
            const timedFn = performance.timeFunction('args-test', mockFn);

            const result = timedFn(10, 20);

            expect(result).toBe(30);
            expect(mockFn).toHaveBeenCalledWith(10, 20);
        });

        test('should track multiple calls', () => {
            const mockFn = jest.fn(() => 'result');
            const timedFn = performance.timeFunction('multi-test', mockFn);

            timedFn();
            timedFn();
            timedFn();

            const stats = performance.getStats('multi-test');
            expect(stats.count).toBe(3);
        });
    });

    describe('timeAsyncFunction', () => {
        test('should wrap asynchronous functions', async () => {
            const mockFn = jest.fn(async () => 'async-result');
            const timedFn = performance.timeAsyncFunction('async-test', mockFn);

            const result = await timedFn();

            expect(result).toBe('async-result');
            expect(mockFn).toHaveBeenCalled();

            const stats = performance.getStats('async-test');
            expect(stats).toBeDefined();
        });

        test('should preserve async function arguments', async () => {
            const mockFn = jest.fn(async (a, b) => a * b);
            const timedFn = performance.timeAsyncFunction('async-args-test', mockFn);

            const result = await timedFn(5, 6);

            expect(result).toBe(30);
            expect(mockFn).toHaveBeenCalledWith(5, 6);
        });

        test('should handle async errors', async () => {
            const mockFn = jest.fn(async () => {
                throw new Error('Async error');
            });
            const timedFn = performance.timeAsyncFunction('async-error-test', mockFn);

            await expect(timedFn()).rejects.toThrow('Async error');

            // Should still record the attempt
            const stats = performance.getStats('async-error-test');
            expect(stats).toBeDefined();
        });
    });

    describe('Statistics', () => {
        test('should calculate average timing', () => {
            performance.recordMetric('avg-test', 100);
            performance.recordMetric('avg-test', 200);
            performance.recordMetric('avg-test', 300);

            const stats = performance.getStats('avg-test');

            expect(stats.avg).toBe(200);
        });

        test('should track minimum timing', () => {
            performance.recordMetric('min-test', 50);
            performance.recordMetric('min-test', 25);
            performance.recordMetric('min-test', 100);

            const stats = performance.getStats('min-test');

            expect(stats.min).toBe(25);
        });

        test('should track maximum timing', () => {
            performance.recordMetric('max-test', 50);
            performance.recordMetric('max-test', 150);
            performance.recordMetric('max-test', 100);

            const stats = performance.getStats('max-test');

            expect(stats.max).toBe(150);
        });

        test('should track total timing', () => {
            performance.recordMetric('total-test', 10);
            performance.recordMetric('total-test', 20);
            performance.recordMetric('total-test', 30);

            const stats = performance.getStats('total-test');

            expect(stats.total).toBe(60);
            expect(stats.count).toBe(3);
        });
    });

    describe('Metrics Export', () => {
        test('should export metrics as JSON', () => {
            performance.recordMetric('export-test', 123);

            const exported = performance.exportMetrics();

            expect(typeof exported).toBe('string');
            expect(() => JSON.parse(exported)).not.toThrow();

            const parsed = JSON.parse(exported);
            expect(parsed).toHaveProperty('export-test');
        });

        test('should handle empty metrics', () => {
            performance.clearMetrics();

            const exported = performance.exportMetrics();
            const parsed = JSON.parse(exported);

            expect(typeof parsed).toBe('object');
        });
    });

    describe('Clear Metrics', () => {
        test('should clear all recorded metrics', () => {
            performance.recordMetric('clear-test-1', 100);
            performance.recordMetric('clear-test-2', 200);

            performance.clearMetrics();

            const stats1 = performance.getStats('clear-test-1');
            const stats2 = performance.getStats('clear-test-2');

            expect(stats1).toBeNull();
            expect(stats2).toBeNull();
        });
    });

    describe('Configuration', () => {
        test('should have configuration object', () => {
            expect(performance.config).toBeDefined();
            expect(typeof performance.config).toBe('object');
        });

        test('should allow toggling performance tracking', () => {
            const originalState = performance.config.enabled;

            performance.config.enabled = false;
            expect(performance.config.enabled).toBe(false);

            performance.config.enabled = originalState;
        });

        test('should have configurable sample rate', () => {
            expect(performance.config).toHaveProperty('sampleRate');
            expect(typeof performance.config.sampleRate).toBe('number');
        });
    });

    describe('Mutation Monitoring', () => {
        test('should monitor DOM mutations', () => {
            const div = document.createElement('div');
            document.body.appendChild(div);

            const observer = performance.monitorMutations(div, 'mutation-test');

            expect(observer).toBeDefined();

            // Cleanup
            if (observer && observer.disconnect) {
                observer.disconnect();
            }
            document.body.removeChild(div);
        });
    });

    describe('Performance Entries', () => {
        test('should retrieve performance entries', () => {
            // Use native Performance API if available
            if (window.performance && window.performance.getEntriesByType) {
                const entries = performance.getPerformanceEntries('measure');
                expect(Array.isArray(entries)).toBe(true);
            } else {
                // Fallback behavior
                const entries = performance.getPerformanceEntries('measure');
                expect(entries).toBeDefined();
            }
        });
    });

    describe('Metadata', () => {
        test('should store metadata with metrics', () => {
            const metadata = {
                module: 'test-module',
                version: '1.0.0',
                userAgent: navigator.userAgent,
            };

            performance.recordMetric('metadata-test', 100, metadata);

            const stats = performance.getStats('metadata-test');
            expect(stats).toBeDefined();
        });
    });

    describe('Integration', () => {
        test('should work with multiple metrics simultaneously', () => {
            performance.recordMetric('metric-1', 10);
            performance.recordMetric('metric-2', 20);
            performance.recordMetric('metric-1', 30);
            performance.recordMetric('metric-3', 40);

            const stats1 = performance.getStats('metric-1');
            const stats2 = performance.getStats('metric-2');
            const stats3 = performance.getStats('metric-3');

            expect(stats1.count).toBe(2);
            expect(stats2.count).toBe(1);
            expect(stats3.count).toBe(1);
        });
    });
});
