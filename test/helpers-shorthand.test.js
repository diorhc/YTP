/**
 * Characterization tests for the canonical module boot shorthand
 * `YouTubeUtils.helpers` (defined in src/utils.js).
 *
 * Modules destructure these instead of repeating the 6-line preamble:
 *   const { $, $$, byId, t, logger, createHTML, setTimeout_ } = YouTubeUtils.helpers;
 */

describe('YouTubeUtils.helpers shorthand', () => {
  /** @type {any} */
  let U;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubeUtils;
    require('../src/utils.js');
    U = window.YouTubeUtils;
  });

  it('exposes a helpers object', () => {
    expect(U).toBeDefined();
    expect(U.helpers).toBeDefined();
    expect(typeof U.helpers).toBe('object');
  });

  it('mirrors the canonical DOM/i18n helpers by identity', () => {
    expect(U.helpers.$).toBe(U.$);
    expect(U.helpers.$$).toBe(U.$$);
    expect(U.helpers.byId).toBe(U.byId);
    expect(U.helpers.t).toBe(U.t);
    expect(U.helpers.createHTML).toBe(U.createHTML);
    expect(U.helpers.debounce).toBe(U.debounce);
  });

  it('mirrors logger (or null when absent)', () => {
    expect(U.helpers.logger).toBe(U.logger || null);
  });

  it('provides a callable setTimeout_ wrapper', async () => {
    expect(typeof U.helpers.setTimeout_).toBe('function');
    const fired = await new Promise(resolve => {
      U.helpers.setTimeout_(() => resolve(true), 1);
    });
    expect(fired).toBe(true);
  });

  describe('storage.clear', () => {
    it('only removes YouTube Plus keys and preserves unrelated entries', () => {
      localStorage.setItem('youtube_plus_settings', '{"a":1}');
      localStorage.setItem('youtube_voting_state', '{"vote":1}');
      localStorage.setItem('ytp-cache', 'v1');
      localStorage.setItem('youtube-plus-debug', 'on');
      localStorage.setItem('unrelated_extension_data', 'keep');
      localStorage.setItem('yt.other_site', 'keep');

      U.storage.clear();

      expect(localStorage.getItem('youtube_plus_settings')).toBeNull();
      expect(localStorage.getItem('youtube_voting_state')).toBeNull();
      expect(localStorage.getItem('ytp-cache')).toBeNull();
      expect(localStorage.getItem('youtube-plus-debug')).toBeNull();
      expect(localStorage.getItem('unrelated_extension_data')).toBe('keep');
      expect(localStorage.getItem('yt.other_site')).toBe('keep');
    });
  });
});
