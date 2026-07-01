/**
 * Tests for src/dom-cache.js focused on the null-result TTL.
 *
 * A getElementById miss used to cache `{ element: null, timestamp }`
 * with the live-element `maxAge` (5s) instead of the shorter
 * `nullMaxAge` (1s), which kept a "not found" result sticky 5x
 * longer than intended after the element was inserted into the DOM.
 */

describe('YouTubeDOMCache getElementById null TTL', () => {
  /** @type {any} */
  let cache;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusDOMCache;
    delete window.YouTubeUtils;
    delete window.unsafeWindow;

    // The DOM cache attaches to YouTubeUtils.domCache when available,
    // so we need a stub to avoid the "YouTubeUtils not found" path.
    window.YouTubeUtils = {};
    require('../src/dom-cache.js');
    cache = window.YouTubePlusDOMCache;
  });

  test('null result expires after nullMaxAge, not maxAge', () => {
    jest.useFakeTimers();
    try {
      const nowSpy = jest.spyOn(Date, 'now');

      // First lookup: element doesn't exist yet, cache the null.
      nowSpy.mockReturnValue(0);
      expect(cache.getElementById('does-not-exist')).toBeNull();

      // Insert the element before the TTL elapses.
      const el = document.createElement('div');
      el.id = 'does-not-exist';
      document.body.appendChild(el);

      // Track how many times the cache re-queries the DOM.
      const spy = jest.spyOn(document, 'getElementById');

      // 1.5s later: past nullMaxAge (1s) but well within the old
      // buggy maxAge (5s). With the fix the null entry is stale
      // and the cache re-queries; with the old code it would have
      // returned the cached null.
      nowSpy.mockReturnValue(1500);
      const result = cache.getElementById('does-not-exist');
      expect(result).toBe(el);
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
      nowSpy.mockRestore();
      el.remove();
    } finally {
      jest.useRealTimers();
    }
  });

  test('null result stays cached for the full nullMaxAge window', () => {
    jest.useFakeTimers();
    try {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(0);

      expect(cache.getElementById('still-missing')).toBeNull();

      const spy = jest.spyOn(document, 'getElementById');
      // 500ms later: well within nullMaxAge (1s), should not re-query.
      nowSpy.mockReturnValue(500);
      expect(cache.getElementById('still-missing')).toBeNull();
      expect(spy).not.toHaveBeenCalled();

      spy.mockRestore();
      nowSpy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  test('live element result is cached for the full maxAge window', () => {
    jest.useFakeTimers();
    try {
      const el = document.createElement('div');
      el.id = 'live-element';
      document.body.appendChild(el);

      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(0);

      expect(cache.getElementById('live-element')).toBe(el);

      const spy = jest.spyOn(document, 'getElementById');
      // 2s later: past nullMaxAge (1s) but well within maxAge (5s).
      nowSpy.mockReturnValue(2000);
      expect(cache.getElementById('live-element')).toBe(el);
      expect(spy).not.toHaveBeenCalled();

      spy.mockRestore();
      nowSpy.mockRestore();
      el.remove();
    } finally {
      jest.useRealTimers();
    }
  });
});
