/**
 * Unit tests for the runtime-activation helpers exposed on YouTubeUtils.
 *
 * utils.js now proxies `whenRelevant` and `onSectionActive` to the canonical
 * implementation in mutation-coordinator.js; `on`/`group` were removed because
 * they had no consumers. This file tests the proxy integration, not the
 * internal implementation of the coordinator.
 */

describe('YouTubeUtils runtime activation helpers (src/utils.js)', () => {
  /** @type {any} */
  let U;
  /** @type {Record<string, any>} */
  let mockLogger;
  /** @type {jest.Mock} */
  let whenRelevant;
  /** @type {jest.Mock} */
  let onSectionActive;

  beforeEach(() => {
    jest.resetModules();
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    whenRelevant = jest.fn(() => ({ active: false, check: jest.fn(), dispose: jest.fn() }));
    onSectionActive = jest.fn(() => ({ dispose: jest.fn() }));

    Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
      configurable: true,
      writable: true,
      value: { whenRelevant, onSectionActive },
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        logger: mockLogger,
      },
    });

    require('../src/utils.js');
    U = window.YouTubeUtils;
  });

  describe('whenRelevant', () => {
    test('proxies calls to YouTubePlusMutationCoordinator.whenRelevant', () => {
      const opts = { name: 'test', isRelevant: () => true, onEnter: jest.fn() };
      U.whenRelevant(opts);
      expect(whenRelevant).toHaveBeenCalledWith(opts);
    });

    test('returns the coordinator handle', () => {
      const handle = { active: true, check: jest.fn(), dispose: jest.fn() };
      whenRelevant.mockReturnValue(handle);
      expect(U.whenRelevant({ name: 'test', isRelevant: () => true })).toBe(handle);
    });
  });

  describe('onSectionActive', () => {
    test('proxies calls to YouTubePlusMutationCoordinator.onSectionActive', () => {
      const onEnter = jest.fn();
      U.onSectionActive('voting', onEnter);
      expect(onSectionActive).toHaveBeenCalledWith('voting', onEnter);
    });

    test('passes onLeave when provided', () => {
      const onEnter = jest.fn();
      const onLeave = jest.fn();
      U.onSectionActive('voting', onEnter, onLeave);
      expect(onSectionActive).toHaveBeenCalledWith('voting', onEnter, onLeave);
    });

    test('returns the coordinator handle', () => {
      const handle = { dispose: jest.fn() };
      onSectionActive.mockReturnValue(handle);
      expect(U.onSectionActive('voting', jest.fn())).toBe(handle);
    });
  });
});
