/**
 * Unit tests for Logger module
 * @jest-environment jsdom
 */

describe('Logger Module', () => {
  let YouTubePlusLogger;
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeAll(() => {
    // Load the logger module once
    require('../src/logger.js');
    YouTubePlusLogger = window.YouTubePlusLogger;
  });

  beforeEach(() => {
    // Mock console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('createLogger', () => {
    it('should create a logger instance', () => {
      const logger = YouTubePlusLogger.createLogger('TestModule');
      expect(logger).toBeDefined();
      expect(logger.moduleName).toBe('TestModule');
    });

    it('should handle null module name', () => {
      const logger = YouTubePlusLogger.createLogger(null);
      expect(logger.moduleName).toBe('Unknown');
    });
  });

  describe('Logger methods', () => {
    let logger;

    beforeEach(() => {
      // Set log level to DEBUG to allow all log messages
      YouTubePlusLogger.setLevel(YouTubePlusLogger.LogLevel.DEBUG);
      logger = YouTubePlusLogger.createLogger('Test');
    });

    it('should log debug messages', () => {
      logger.debug('test message');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[YouTube+]'),
        'test message'
      );
    });

    it('should log info messages', () => {
      logger.info('info message');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[YouTube+]'),
        'info message'
      );
    });

    it('should log warning messages', () => {
      logger.warn('warning message');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[YouTube+]'),
        'warning message'
      );
    });

    it('should log error messages', () => {
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[YouTube+]'),
        'error message'
      );
    });

    it('should log critical messages', () => {
      logger.critical('critical error');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[YouTube+]'),
        'critical error'
      );
    });

    it('should handle multiple arguments', () => {
      logger.info('message', { data: 'test' }, [1, 2, 3]);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[YouTube+]'),
        'message',
        { data: 'test' },
        [1, 2, 3]
      );
    });
  });

  describe('Configuration', () => {
    let logger;

    beforeEach(() => {
      logger = YouTubePlusLogger.createLogger('Test');
    });

    it('should respect enabled flag', () => {
      YouTubePlusLogger.setEnabled(false);
      logger.info('should not log');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      YouTubePlusLogger.setEnabled(true);
      logger.info('should log');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should set log level by name', () => {
      YouTubePlusLogger.setLevel('error');

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      logger.error('error');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should set log level by number', () => {
      YouTubePlusLogger.setLevel(YouTubePlusLogger.LogLevel.WARN);

      logger.debug('debug');
      logger.info('info');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      logger.warn('warn');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should configure multiple options', () => {
      YouTubePlusLogger.configure({
        enabled: true,
        includeTimestamp: true,
        includeStack: true,
        maxStackLines: 3,
      });

      const error = new Error('test error');
      logger.error('error occurred', error);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle invalid configuration gracefully', () => {
      expect(() => {
        YouTubePlusLogger.configure(null);
        YouTubePlusLogger.configure('invalid');
        YouTubePlusLogger.configure([1, 2, 3]);
      }).not.toThrow();
    });
  });

  describe('Error handling', () => {
    let logger;

    beforeEach(() => {
      logger = YouTubePlusLogger.createLogger('Test');
    });

    it('should include stack traces for errors', () => {
      YouTubePlusLogger.configure({ includeStack: true });
      const error = new Error('test error');
      logger.error('error with stack', error);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const lastCall = consoleErrorSpy.mock.calls[consoleErrorSpy.mock.calls.length - 1];
      expect(lastCall.some(arg => typeof arg === 'string' && arg.includes('Error'))).toBe(true);
    });

    it('should handle logging errors gracefully', () => {
      // Force an error in logging by passing circular reference
      const circular = {};
      circular.self = circular;

      expect(() => {
        logger.info('circular', circular);
      }).not.toThrow();
    });
  });

  describe('Log level filtering', () => {
    let logger;

    beforeEach(() => {
      logger = YouTubePlusLogger.createLogger('Test');
    });

    it('should filter DEBUG when level is INFO', () => {
      YouTubePlusLogger.setLevel('info');
      logger.debug('debug message');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should allow INFO when level is INFO', () => {
      YouTubePlusLogger.setLevel('info');
      logger.info('info message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should allow ERROR when level is WARN', () => {
      YouTubePlusLogger.setLevel('warn');
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should disable all logging with NONE level', () => {
      YouTubePlusLogger.setLevel('none');
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      logger.critical('critical');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('Module name formatting', () => {
    beforeEach(() => {
      // Reset log level to INFO for these tests
      YouTubePlusLogger.setLevel(YouTubePlusLogger.LogLevel.INFO);
    });

    it('should include module name in log output', () => {
      const logger = YouTubePlusLogger.createLogger('TestModule');
      logger.info('test');

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[TestModule]'), 'test');
    });

    it('should handle empty module name', () => {
      const logger = YouTubePlusLogger.createLogger('');
      logger.info('test');

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });
});
