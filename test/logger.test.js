/**
 * Unit tests for YouTube+ Logger module
 */

describe('YouTubePlusLogger', () => {
  /** @type {YouTubePlusLogger | null} */
  let logger = null;

  beforeEach(() => {
    // Reset window globals
    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(window, '__ytpDevMode', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    // Reset module cache so the IIFE re-executes on each require
    jest.resetModules();

    // Load the logger module
    require('../src/logger');
    logger = window.YouTubePlusLogger || null;
  });

  afterEach(() => {
    if (logger) logger.clear();
  });

  test('should be exported to window.YouTubePlusLogger', () => {
    expect(logger).toBeDefined();
    if (!logger) throw new Error('logger not initialized');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  test('should log error messages', () => {
    if (!logger) throw new Error('logger not initialized');
    logger.error('test', 'something failed', new Error('test error'));
    const recent = logger.getRecent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].level).toBe('error');
    expect(recent[0].module).toBe('test');
    expect(recent[0].message).toBe('something failed');
  });

  test('should log warn messages', () => {
    if (!logger) throw new Error('logger not initialized');
    logger.warn('module1', 'a warning');
    const recent = logger.getRecent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].level).toBe('warn');
  });

  test('should respect log level filtering', () => {
    if (!logger) throw new Error('logger not initialized');
    logger.setLevel('error');
    logger.warn('test', 'should be filtered');
    logger.info('test', 'should be filtered');
    logger.debug('test', 'should be filtered');
    logger.error('test', 'should pass');
    const recent = logger.getRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].level).toBe('error');
  });

  test('should set and get log level', () => {
    if (!logger) throw new Error('logger not initialized');
    logger.setLevel('debug');
    expect(logger.getLevel()).toBe('debug');
    logger.setLevel('error');
    expect(logger.getLevel()).toBe('error');
  });

  test('should preserve previously set level', () => {
    if (!logger) throw new Error('logger not initialized');
    logger.setLevel('warn');
    expect(logger.getLevel()).toBe('warn');
  });

  test('should keep buffer under max size', () => {
    if (!logger) throw new Error('logger not initialized');
    logger.setLevel('debug');
    for (let i = 0; i < 250; i++) {
      logger.debug('test', `message ${i}`);
    }
    const recent = logger.getRecent(300);
    expect(recent.length).toBeLessThanOrEqual(200);
  });

  test('should export logs as JSON', () => {
    if (!logger) throw new Error('logger not initialized');
    logger.error('test', 'test message');
    const exported = logger.export();
    const parsed = JSON.parse(exported);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test('should provide stats', () => {
    if (!logger) throw new Error('logger not initialized');
    logger.error('mod1', 'err1');
    logger.warn('mod2', 'warn1');
    const stats = logger.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.byLevel.error).toBe(1);
    expect(stats.byLevel.warn).toBe(1);
    expect(stats.byModule.mod1).toBe(1);
    expect(stats.byModule.mod2).toBe(1);
  });

  test('should clear all log entries', () => {
    if (!logger) throw new Error('logger not initialized');
    logger.error('test', 'message');
    logger.clear();
    expect(logger.getRecent(10)).toHaveLength(0);
    expect(logger.getStats().totalEntries).toBe(0);
  });

  test('should filter recent by level', () => {
    if (!logger) throw new Error('logger not initialized');
    logger.setLevel('debug');
    logger.error('test', 'error msg');
    logger.warn('test', 'warn msg');
    logger.debug('test', 'debug msg');
    const errors = logger.getRecent(10, 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].level).toBe('error');
  });
});
