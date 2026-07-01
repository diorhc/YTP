/**
 * Tests for the in-memory cache on the canonical settings store
 * (`YouTubePlusSettingsStore`) defined in src/settings-helpers.js.
 *
 * The cache short-circuits `load()` so repeated `get()`/`set()` calls
 * don't re-parse localStorage JSON on every invocation. It is
 * invalidated by `save()`, by cross-tab `storage` events, and by the
 * `youtube-plus-settings-updated` custom event.
 */

describe('YouTubePlusSettingsStore cache', () => {
  /** @type {any} */
  let S;
  /** @type {any} */
  let getItemSpy;
  /** @type {any} */
  let readRawCount;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusSettingsStore;
    delete window.YouTubePlusSettingsHelpers;
    delete window.YouTubePlusLogger;
    delete window.YouTubeUtils;

    getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
    readRawCount = () =>
      getItemSpy.mock.calls.filter(args => args[0] === 'youtube_plus_settings').length;

    require('../src/settings-helpers.js');
    S = window.YouTubePlusSettingsStore;
  });

  afterEach(() => {
    getItemSpy.mockRestore();
  });

  test('get() twice without save() only reads localStorage once', () => {
    localStorage.setItem('youtube_plus_settings', JSON.stringify({ enableFoo: true }));

    S.get('enableFoo');
    const afterFirst = readRawCount();
    S.get('enableFoo');
    const afterSecond = readRawCount();

    expect(afterFirst).toBe(1);
    expect(afterSecond).toBe(1);
  });

  test('set() invalidates the cache so the next get() re-reads', () => {
    S.set('enableFoo', true);
    S.get('enableFoo');
    const baseline = readRawCount();

    S.get('enableFoo');
    expect(readRawCount()).toBe(baseline);

    S.set('enableFoo', false);
    S.get('enableFoo');
    expect(readRawCount()).toBeGreaterThan(baseline);
  });

  test('save() invalidates the cache so the next get() re-reads', () => {
    S.save({ enableFoo: 'first' });
    S.get('enableFoo');
    const baseline = readRawCount();

    S.get('enableFoo');
    expect(readRawCount()).toBe(baseline);

    S.save({ enableFoo: 'second' });
    S.get('enableFoo');
    expect(readRawCount()).toBeGreaterThan(baseline);
  });

  test('cache returns the same object reference on repeated reads', () => {
    S.set('enableFoo', { nested: 1 });
    const ref1 = S.get('enableFoo');
    const ref2 = S.get('enableFoo');
    expect(ref1).toBe(ref2);
  });

  test('storage event from another tab invalidates the cache', () => {
    S.set('enableFoo', 'cached-value');
    S.get('enableFoo');
    const baseline = readRawCount();

    S.get('enableFoo');
    expect(readRawCount()).toBe(baseline);

    window.dispatchEvent(new Event('storage'));
    S.get('enableFoo');
    expect(readRawCount()).toBeGreaterThan(baseline);
  });

  test('youtube-plus-settings-updated event invalidates the cache', () => {
    S.set('enableFoo', 'cached-value');
    S.get('enableFoo');
    const baseline = readRawCount();

    S.get('enableFoo');
    expect(readRawCount()).toBe(baseline);

    window.dispatchEvent(new CustomEvent('youtube-plus-settings-updated'));
    S.get('enableFoo');
    expect(readRawCount()).toBeGreaterThan(baseline);
  });

  test('reset() invalidates the cache via the dispatched event', () => {
    S.set('enableFoo', 'cached-value');
    S.get('enableFoo');
    const baseline = readRawCount();

    S.get('enableFoo');
    expect(readRawCount()).toBe(baseline);

    S.reset();
    S.get('enableFoo');
    expect(readRawCount()).toBeGreaterThan(baseline);
  });

  test('cache is populated with merged defaults on first read', () => {
    S.get('enableDownload');
    const baseline = readRawCount();
    S.get('enableZoom');
    expect(readRawCount()).toBe(baseline);
    expect(S.get('enableDownload')).toBe(true);
    expect(S.get('enableZoom')).toBe(true);
  });
});
