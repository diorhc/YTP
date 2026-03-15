/**
 * Unit tests for YouTube+ LazyLoader module
 */

describe('LazyLoader', () => {
  let lazyLoader;

  beforeEach(() => {
    delete window.YouTubePlusLazyLoader;
    window.YouTubeUtils = {
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    };

    // Reset module cache so the IIFE re-executes
    jest.resetModules();

    require('../src/lazy-loader');
    lazyLoader = window.YouTubePlusLazyLoader;
  });

  afterEach(() => {
    if (lazyLoader) lazyLoader.clear();
  });

  test('should be exported to window.YouTubePlusLazyLoader', () => {
    expect(lazyLoader).toBeDefined();
    expect(typeof lazyLoader.register).toBe('function');
    expect(typeof lazyLoader.load).toBe('function');
    expect(typeof lazyLoader.loadAll).toBe('function');
    expect(typeof lazyLoader.isLoaded).toBe('function');
  });

  test('should register a module', () => {
    const fn = jest.fn();
    lazyLoader.register('test-mod', fn, { priority: 1 });
    const stats = lazyLoader.getStats();
    expect(stats.totalModules).toBe(1);
    expect(stats.loadedModules).toBe(0);
  });

  test('should load a registered module', async () => {
    const fn = jest.fn();
    lazyLoader.register('test-mod', fn);
    const result = await lazyLoader.load('test-mod');
    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(lazyLoader.isLoaded('test-mod')).toBe(true);
  });

  test('should return false for unknown module', async () => {
    const result = await lazyLoader.load('nonexistent');
    expect(result).toBe(false);
  });

  test('should not double-load a module', async () => {
    const fn = jest.fn();
    lazyLoader.register('once', fn);
    await lazyLoader.load('once');
    await lazyLoader.load('once');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('should load all modules sorted by priority', async () => {
    const order = [];
    lazyLoader.register('low', () => order.push('low'), { priority: 0 });
    lazyLoader.register('high', () => order.push('high'), { priority: 10 });
    lazyLoader.register('mid', () => order.push('mid'), { priority: 5 });

    const count = await lazyLoader.loadAll();
    expect(count).toBe(3);
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  test('should handle module load failure gracefully', async () => {
    lazyLoader.register('failing', () => {
      throw new Error('Module init failed');
    });
    const result = await lazyLoader.load('failing');
    expect(result).toBe(false);
  });

  test('should provide correct stats', async () => {
    lazyLoader.register('a', jest.fn());
    lazyLoader.register('b', jest.fn());
    await lazyLoader.load('a');

    const stats = lazyLoader.getStats();
    expect(stats.totalModules).toBe(2);
    expect(stats.loadedModules).toBe(1);
    expect(stats.loadingPercentage).toBe(50);
    expect(stats.unloadedModules).toBe(1);
  });

  test('should clear all modules', () => {
    lazyLoader.register('x', jest.fn());
    lazyLoader.clear();
    const stats = lazyLoader.getStats();
    expect(stats.totalModules).toBe(0);
  });

  test('should not register duplicate modules', () => {
    lazyLoader.register('dup', jest.fn());
    lazyLoader.register('dup', jest.fn());
    expect(lazyLoader.getStats().totalModules).toBe(1);
  });
});
