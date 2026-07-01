/**
 * Unit tests for the runtime-activation helpers in utils.js:
 *   - whenRelevant
 *   - on
 *   - group
 *   - onSectionActive
 *
 * These are the primitives the modules use to opt in to per-route,
 * per-feature, and per-settings-section lifecycles without going
 * through a central registry.
 */

describe('YouTubeUtils runtime activation helpers (src/utils.js)', () => {
  /** @type {any} */
  let U;
  /** @type {Record<string, any>} */
  let mockLogger;

  beforeEach(() => {
    jest.resetModules();
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
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
    test('fires onEnter immediately when the predicate is true on construction', () => {
      const onEnter = jest.fn();
      U.whenRelevant({
        name: 'test',
        isRelevant: () => true,
        onEnter,
      });
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    test('does not fire onEnter when the predicate is false on construction', () => {
      const onEnter = jest.fn();
      U.whenRelevant({
        name: 'test',
        isRelevant: () => false,
        onEnter,
      });
      expect(onEnter).not.toHaveBeenCalled();
    });

    test('re-evaluates the predicate on the default signal set', () => {
      const predicate = jest.fn().mockReturnValue(false);
      const onEnter = jest.fn();
      const handle = U.whenRelevant({
        name: 'test',
        isRelevant: predicate,
        onEnter,
      });
      expect(onEnter).not.toHaveBeenCalled();

      predicate.mockReturnValue(true);
      document.dispatchEvent(new Event('yt-navigate-finish'));
      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(handle.active).toBe(true);
    });

    test('re-evaluates on youtube-plus-settings-modal-opened (document)', () => {
      const predicate = jest.fn().mockReturnValue(false);
      const onEnter = jest.fn();
      U.whenRelevant({
        name: 'test',
        isRelevant: predicate,
        onEnter,
      });

      predicate.mockReturnValue(true);
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    test('re-evaluates on youtube-plus-settings-updated', () => {
      const predicate = jest.fn().mockReturnValue(false);
      const onEnter = jest.fn();
      U.whenRelevant({
        name: 'test',
        isRelevant: predicate,
        onEnter,
      });

      predicate.mockReturnValue(true);
      window.dispatchEvent(new CustomEvent('youtube-plus-settings-updated', { detail: {} }));
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    test('fires onLeave when the predicate flips back to false', () => {
      let relevant = true;
      const onEnter = jest.fn();
      const onLeave = jest.fn();
      const handle = U.whenRelevant({
        name: 'test',
        isRelevant: () => relevant,
        onEnter,
        onLeave,
      });
      expect(onEnter).toHaveBeenCalledTimes(1);

      relevant = false;
      document.dispatchEvent(new Event('yt-navigate-finish'));
      expect(onLeave).toHaveBeenCalledTimes(1);
      expect(handle.active).toBe(false);
    });

    test('does not double-fire onEnter while already active', () => {
      const onEnter = jest.fn();
      U.whenRelevant({
        name: 'test',
        isRelevant: () => true,
        onEnter,
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      document.dispatchEvent(new Event('yt-navigate-finish'));
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    test('keeps state inactive when onEnter throws, and retries on next signal', () => {
      const predicate = jest.fn().mockReturnValue(true);
      let shouldThrow = true;
      const onEnter = jest.fn(() => {
        if (shouldThrow) throw new Error('boom');
      });
      const handle = U.whenRelevant({
        name: 'test',
        isRelevant: predicate,
        onEnter,
      });

      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(handle.active).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();

      shouldThrow = false;
      document.dispatchEvent(new Event('yt-navigate-finish'));
      expect(onEnter).toHaveBeenCalledTimes(2);
      expect(handle.active).toBe(true);
    });

    test('treats a throwing isRelevant as inactive and does not crash', () => {
      let throwPredicate = true;
      const onEnter = jest.fn();
      U.whenRelevant({
        name: 'test',
        isRelevant: () => {
          if (throwPredicate) throw new Error('predicate exploded');
          return true;
        },
        onEnter,
      });
      expect(onEnter).not.toHaveBeenCalled();

      throwPredicate = false;
      document.dispatchEvent(new Event('yt-navigate-finish'));
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    test('dispose() removes listeners and stops reacting to signals', () => {
      const predicate = jest.fn().mockReturnValue(false);
      const onEnter = jest.fn();
      const handle = U.whenRelevant({
        name: 'test',
        isRelevant: predicate,
        onEnter,
      });
      handle.dispose();

      predicate.mockReturnValue(true);
      document.dispatchEvent(new Event('yt-navigate-finish'));
      expect(onEnter).not.toHaveBeenCalled();
    });

    test('honours a custom signal set', () => {
      const predicate = jest.fn().mockReturnValue(false);
      const onEnter = jest.fn();
      U.whenRelevant({
        name: 'test',
        isRelevant: predicate,
        onEnter,
        signals: ['custom-event'],
      });

      predicate.mockReturnValue(true);
      // The default signal should not trigger this.
      document.dispatchEvent(new Event('yt-navigate-finish'));
      expect(onEnter).not.toHaveBeenCalled();

      document.dispatchEvent(new Event('custom-event'));
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    test('check() can be called manually to force re-evaluation', () => {
      let relevant = false;
      const onEnter = jest.fn();
      const handle = U.whenRelevant({
        name: 'test',
        isRelevant: () => relevant,
        onEnter,
      });
      expect(onEnter).not.toHaveBeenCalled();

      relevant = true;
      handle.check();
      expect(onEnter).toHaveBeenCalledTimes(1);
    });
  });

  describe('on', () => {
    test('attaches a listener and returns a disposer that removes it', () => {
      const handler = jest.fn();
      const dispose = U.on(window, 'yt-navigate-finish', handler);
      window.dispatchEvent(new Event('yt-navigate-finish'));
      expect(handler).toHaveBeenCalledTimes(1);

      dispose();
      window.dispatchEvent(new Event('yt-navigate-finish'));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('passes options through to addEventListener', () => {
      const target = document.createElement('div');
      document.body.appendChild(target);
      const handler = jest.fn();
      const dispose = U.on(target, 'click', handler, { once: true });
      target.click();
      target.click();
      expect(handler).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  describe('group', () => {
    test('runs every disposer in one call', () => {
      const a = jest.fn();
      const b = jest.fn();
      const c = jest.fn();
      const disposeAll = U.group(a, b, c);
      disposeAll();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      expect(c).toHaveBeenCalledTimes(1);
    });

    test('continues even if one disposer throws', () => {
      const a = jest.fn();
      const bad = jest.fn(() => {
        throw new Error('disposer boom');
      });
      const c = jest.fn();
      const disposeAll = U.group(a, bad, c);
      expect(() => disposeAll()).not.toThrow();
      expect(a).toHaveBeenCalledTimes(1);
      expect(c).toHaveBeenCalledTimes(1);
    });
  });

  describe('onSectionActive', () => {
    test('fires onEnter when the named section becomes active', () => {
      const onEnter = jest.fn();
      const handle = U.onSectionActive('voting', onEnter);
      document.dispatchEvent(
        new CustomEvent('youtube-plus-settings-section-activated', {
          detail: { section: 'voting', label: 'Voting' },
        })
      );
      expect(onEnter).toHaveBeenCalledTimes(1);
      handle.dispose();
    });

    test('ignores activation events for other sections', () => {
      const onEnter = jest.fn();
      const handle = U.onSectionActive('voting', onEnter);
      document.dispatchEvent(
        new CustomEvent('youtube-plus-settings-section-activated', {
          detail: { section: 'about', label: 'About' },
        })
      );
      expect(onEnter).not.toHaveBeenCalled();
      handle.dispose();
    });

    test('fires onLeave when the modal is closed', () => {
      const onEnter = jest.fn();
      const onLeave = jest.fn();
      const handle = U.onSectionActive('voting', onEnter, onLeave);

      document.dispatchEvent(
        new CustomEvent('youtube-plus-settings-section-activated', {
          detail: { section: 'voting', label: 'Voting' },
        })
      );
      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(onLeave).not.toHaveBeenCalled();

      document.dispatchEvent(new CustomEvent('youtube-plus-settings-modal-closed'));
      expect(onLeave).toHaveBeenCalledTimes(1);
      handle.dispose();
    });

    test('dispose() removes both listeners', () => {
      const onEnter = jest.fn();
      const onLeave = jest.fn();
      const handle = U.onSectionActive('voting', onEnter, onLeave);
      handle.dispose();

      document.dispatchEvent(
        new CustomEvent('youtube-plus-settings-section-activated', {
          detail: { section: 'voting' },
        })
      );
      document.dispatchEvent(new CustomEvent('youtube-plus-settings-modal-closed'));
      expect(onEnter).not.toHaveBeenCalled();
      expect(onLeave).not.toHaveBeenCalled();
    });

    test('keeps the helper inert if the activation event is missing', () => {
      const onEnter = jest.fn();
      // No event dispatched — the helper should simply not call onEnter.
      const handle = U.onSectionActive('voting', onEnter);
      expect(onEnter).not.toHaveBeenCalled();
      handle.dispose();
    });
  });
});
