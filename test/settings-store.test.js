/**
 * Tests for the in-memory cache on the canonical settings store
 * (`YouTubePlusSettingsStore`) defined in src/settings-store.js.
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

    require('../src/settings-store.js');
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

  test('cache returns deep-equal snapshots on repeated reads, protecting cache from mutation leaks', () => {
    S.set('downloadSites', { externalDownloader: true, ytdl: true, direct: true });
    const ref1 = S.get('downloadSites');
    const ref2 = S.get('downloadSites');
    expect(ref1).toStrictEqual(ref2);
    expect(ref1).not.toBe(ref2);

    // Mutating returned snapshot does not leak into cache or subsequent reads
    ref1.externalDownloader = false;
    expect(S.get('downloadSites').externalDownloader).toBe(true);
    expect(S.load().downloadSites.externalDownloader).toBe(true);
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

describe('YouTubePlusSettingsStore single commit pipeline (_commit)', () => {
  let S;
  let setItemSpy;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusSettingsStore;
    delete window.YouTubePlusSettingsHelpers;
    delete window.YouTubePlusFeatureRegistry;
    delete window.YouTubePlusSettingsHost;
    localStorage.clear();

    setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;
  });

  afterEach(() => {
    setItemSpy.mockRestore();
    localStorage.clear();
  });

  test('set() mutates via _commit, persists to storage, updates cache, and dispatches event', () => {
    const eventSpy = jest.fn();
    window.addEventListener('youtube-plus-settings-updated', eventSpy);

    const result = S.set('styles.cleanSideGuide', true);
    expect(result).toBe(true);

    // Cache updated
    expect(S.get('styles.cleanSideGuide')).toBe(true);

    // Storage persisted
    const raw = JSON.parse(localStorage.getItem('youtube_plus_settings'));
    expect(raw.styles.cleanSideGuide).toBe(true);

    // Event dispatched with fresh snapshot
    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(eventSpy.mock.calls[0][0].detail.styles.cleanSideGuide).toBe(true);

    window.removeEventListener('youtube-plus-settings-updated', eventSpy);
  });

  test('update() shallow-merges object at dot-path and persists via _commit', () => {
    const subSpy = jest.fn();
    S.subscribe('speedControlHotkeys', subSpy);

    const result = S.update('speedControlHotkeys', { decrease: '[' });
    expect(result).toBe(true);

    expect(S.get('speedControlHotkeys.decrease')).toBe('[');
    expect(S.get('speedControlHotkeys.increase')).toBe('h'); // preserved
    expect(S.get('speedControlHotkeys.reset')).toBe('b'); // preserved

    expect(subSpy).toHaveBeenCalledTimes(1);
    expect(subSpy.mock.calls[0][0]).toEqual({ decrease: '[', increase: 'h', reset: 'b' });
  });

  test('importSettings() accepts valid JSON string, ignores proto pollution, and commits', () => {
    const eventSpy = jest.fn();
    window.addEventListener('youtube-plus-settings-updated', eventSpy);

    const payload = JSON.stringify({
      enableDownload: false,
      __proto__: { polluted: true },
      styles: { cleanSideGuide: true },
    });

    const ok = S.importSettings(payload);
    expect(ok).toBe(true);
    expect(S.get('enableDownload')).toBe(false);
    expect(S.get('styles.cleanSideGuide')).toBe(true);
    expect({}.polluted).toBeUndefined();
    expect(eventSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener('youtube-plus-settings-updated', eventSpy);
  });

  test('importSettings() accepts valid object and rejects invalid inputs', () => {
    expect(S.importSettings({ enableZoom: false })).toBe(true);
    expect(S.get('enableZoom')).toBe(false);

    expect(S.importSettings(null)).toBe(false);
    expect(S.importSettings(undefined)).toBe(false);
    expect(S.importSettings('not-json')).toBe(false);
    expect(S.importSettings([1, 2, 3])).toBe(false);
    expect(S.importSettings(123)).toBe(false);
  });

  test('importSettings validates keys against KEY_REGISTRY and types against DEFAULTS', () => {
    const eventSpy = jest.fn();
    window.addEventListener('youtube-plus-settings-updated', eventSpy);

    // Unknown top-level key → rejected wholesale, nothing committed.
    expect(S.importSettings({ notARegisteredKey: true })).toBe(false);
    expect(S.get('notARegisteredKey')).toBeUndefined();

    // Type mismatch vs DEFAULTS → rejected, default preserved.
    expect(S.importSettings({ enableDownload: 'yes' })).toBe(false);
    expect(S.get('enableDownload')).toBe(S.DEFAULTS.enableDownload);

    // Unknown nested key → rejected.
    expect(S.importSettings({ styles: { notARegisteredSubKey: true } })).toBe(false);
    expect(S.get('styles.cleanSideGuide')).toBe(S.DEFAULTS.styles.cleanSideGuide);

    // Wrong nested type → rejected.
    expect(S.importSettings({ styles: { cleanSideGuide: 'yes' } })).toBe(false);
    expect(S.importSettings({ styles: 'not-an-object' })).toBe(false);

    // Rejections commit nothing and fire no update event.
    expect(eventSpy).not.toHaveBeenCalled();

    // A fully valid payload still imports through the commit pipeline.
    expect(S.importSettings({ enableDownload: false, styles: { cleanSideGuide: true } })).toBe(
      true
    );
    expect(S.get('enableDownload')).toBe(false);
    expect(S.get('styles.cleanSideGuide')).toBe(true);

    window.removeEventListener('youtube-plus-settings-updated', eventSpy);
  });

  test('cross-tab storage event commits with fromStorage: true without writing back to localStorage', () => {
    const subSpy = jest.fn();
    const eventSpy = jest.fn();
    S.subscribe('styles.cleanSideGuide', subSpy);
    window.addEventListener('youtube-plus-settings-updated', eventSpy);

    // Initial state
    expect(S.get('styles.cleanSideGuide')).toBe(false);

    // Simulate cross-tab writing new value
    localStorage.setItem(
      'youtube_plus_settings',
      JSON.stringify({ styles: { cleanSideGuide: true } })
    );
    const writesExternal = setItemSpy.mock.calls.length;

    // Fire storage event
    const storageEvent = new Event('storage');
    storageEvent.key = 'youtube_plus_settings';
    window.dispatchEvent(storageEvent);

    // Should NOT have written back to localStorage
    expect(setItemSpy.mock.calls.length).toBe(writesExternal);

    // Cache updated and subscribers notified
    expect(S.get('styles.cleanSideGuide')).toBe(true);
    expect(subSpy).toHaveBeenCalledWith(true, 'styles.cleanSideGuide');
    expect(eventSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener('youtube-plus-settings-updated', eventSpy);
  });
});

describe('YouTubePlusSettingsStore subscription semantics', () => {
  let S;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusSettingsStore;
    delete window.YouTubePlusSettingsHelpers;
    localStorage.clear();
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('exact key, parent path, and wildcard subscribers are notified on child property change', () => {
    const childSpy = jest.fn();
    const parentSpy = jest.fn();
    const wildcardSpy = jest.fn();

    S.subscribe('styles.cleanSideGuide', childSpy);
    S.subscribe('styles', parentSpy);
    S.subscribe('*', wildcardSpy);

    S.set('styles.cleanSideGuide', true);

    expect(childSpy).toHaveBeenCalledTimes(1);
    expect(childSpy).toHaveBeenCalledWith(true, 'styles.cleanSideGuide');

    expect(parentSpy).toHaveBeenCalledTimes(1);
    expect(parentSpy.mock.calls[0][0].cleanSideGuide).toBe(true);
    expect(parentSpy.mock.calls[0][1]).toBe('styles');

    expect(wildcardSpy).toHaveBeenCalledTimes(1);
    expect(wildcardSpy.mock.calls[0][0].styles.cleanSideGuide).toBe(true);
  });

  test('child path is notified when parent object is replaced or patched', () => {
    const childSpy = jest.fn();
    S.subscribe('styles.cleanSideGuide', childSpy);

    S.update('styles', { cleanSideGuide: true });

    expect(childSpy).toHaveBeenCalledTimes(1);
    expect(childSpy).toHaveBeenCalledWith(true, 'styles.cleanSideGuide');
  });

  test('feature alias subscriptions are notified on relevant changes', () => {
    const stylesSpy = jest.fn();
    const downloadSpy = jest.fn();
    const speedSpy = jest.fn();
    const loopSpy = jest.fn();
    const screenshotSpy = jest.fn();
    const enhancedSpy = jest.fn();

    S.subscribe('styles', stylesSpy);
    S.subscribe('download', downloadSpy);
    S.subscribe('speed', speedSpy);
    S.subscribe('loop', loopSpy);
    S.subscribe('screenshot', screenshotSpy);
    S.subscribe('enhanced', enhancedSpy);

    // 1. Style change notifies 'styles'
    S.set('styles.cleanSideGuide', true);
    expect(stylesSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).not.toHaveBeenCalled();

    // 2. Download change notifies 'download'
    S.set('enableDownload', false);
    expect(downloadSpy).toHaveBeenCalledTimes(1);

    // 3. Speed change notifies 'speed'
    S.set('speedControlHotkeys.increase', 'k');
    expect(speedSpy).toHaveBeenCalledTimes(1);

    // 4. Loop change notifies 'loop'
    S.set('enableLoop', false);
    expect(loopSpy).toHaveBeenCalledTimes(1);

    // 5. Screenshot change notifies 'screenshot'
    S.set('enableScreenshot', false);
    expect(screenshotSpy).toHaveBeenCalledTimes(1);

    // 6. Enhanced flag change notifies 'enhanced'
    S.set('enableTabview', false);
    expect(enhancedSpy).toHaveBeenCalledTimes(1);
  });

  test('subscription disposer is idempotent and cleanly unregisters', () => {
    const spy = jest.fn();
    const unsub = S.subscribe('enableDownload', spy);

    S.set('enableDownload', false);
    expect(spy).toHaveBeenCalledTimes(1);

    unsub();
    unsub(); // Idempotent call should not throw

    S.set('enableDownload', true);
    expect(spy).toHaveBeenCalledTimes(1); // No new call
  });
});

describe('YouTubePlusSettingsStore key validation & defaults (hasKey, DEFAULTS)', () => {
  let S;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusSettingsStore;
    localStorage.clear();
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;
  });

  test('hasKey correctly identifies registered root keys and valid nested dot-paths', () => {
    // Registered root keys
    expect(S.hasKey('enableDownload')).toBe(true);
    expect(S.hasKey('enableScreenshot')).toBe(true);
    expect(S.hasKey('styles')).toBe(true);
    expect(S.hasKey('speedControlHotkeys')).toBe(true);

    // Registered nested keys
    expect(S.hasKey('styles.cleanSideGuide')).toBe(true);
    expect(S.hasKey('styles.themeVariant')).toBe(true);
    expect(S.hasKey('speedControlHotkeys.increase')).toBe(true);
    expect(S.hasKey('downloadSites.externalDownloader')).toBe(true);

    // Invalid or unknown root keys
    expect(S.hasKey('enableTypo')).toBe(false);
    expect(S.hasKey('nonExistentKey')).toBe(false);

    // Invalid or unknown nested keys
    expect(S.hasKey('styles.unknownProperty')).toBe(false);
    expect(S.hasKey('speedControlHotkeys.unknownKey')).toBe(false);
    expect(S.hasKey('enableDownload.invalidSubkey')).toBe(false);

    // Edge cases
    expect(S.hasKey('')).toBe(false);
    expect(S.hasKey(null)).toBe(false);
    expect(S.hasKey(undefined)).toBe(false);
    expect(S.hasKey(123)).toBe(false);
  });

  test('canonical cleanSideGuide default is false', () => {
    expect(S.DEFAULTS.styles.cleanSideGuide).toBe(false);
    expect(S.get('styles.cleanSideGuide')).toBe(false);
  });
});

describe('YouTubePlusSettingsStore defensive typing and legacy migrations', () => {
  let S;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusSettingsStore;
    localStorage.clear();
  });

  test('type mismatch against default falls back to default value', () => {
    localStorage.setItem(
      'youtube_plus_settings',
      JSON.stringify({
        enableDownload: 'not-a-boolean', // Should be boolean
        styles: {
          cleanSideGuide: 12345, // Should be boolean
          sideVideosColumns: 'two', // Should be number
        },
      })
    );
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;

    expect(S.get('enableDownload')).toBe(true);
    expect(S.get('styles.cleanSideGuide')).toBe(false);
    expect(S.get('styles.sideVideosColumns')).toBe(0);
  });

  test('legacy playlist search flag moves into the store and leaves the legacy key', () => {
    localStorage.setItem(
      'youtube_playlist_search_settings',
      JSON.stringify({ enabled: false, deleteMode: true })
    );
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;

    expect(S.get('enablePlaylistSearch')).toBe(false);
    expect(JSON.parse(localStorage.getItem('youtube_playlist_search_settings'))).toEqual({
      deleteMode: true,
    });
  });

  test('a store value wins over the legacy playlist search flag', () => {
    localStorage.setItem('youtube_plus_settings', JSON.stringify({ enablePlaylistSearch: true }));
    localStorage.setItem('youtube_playlist_search_settings', JSON.stringify({ enabled: false }));
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;

    expect(S.get('enablePlaylistSearch')).toBe(true);
  });

  test.each([
    ['enableAdBlocker', 'youtube_adblocker_settings'],
    ['enablePip', 'youtube_pip_settings'],
  ])('a disabled legacy %s flag reaches the store and leaves the legacy key', (key, legacyKey) => {
    localStorage.setItem(legacyKey, JSON.stringify({ enabled: false, other: 1 }));
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;

    expect(S.get(key)).toBe(false);
    // The module no longer reads its legacy `enabled`, so the migration drops it.
    expect(JSON.parse(localStorage.getItem(legacyKey))).toEqual({ other: 1 });
  });

  test('settings stored under the 2.x names move to the renamed keys at boot', () => {
    localStorage.setItem(
      'youtube_plus_settings',
      JSON.stringify({
        enableZenStyles: false,
        zenStyles: { themeVariant: 'classic', themeStyle: 'solid', cleanSideGuide: true },
      })
    );
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;

    expect(S.get('enableStyles')).toBe(false);
    expect(S.get('styles.themeVariant')).toBe('classic');
    expect(S.get('styles.cleanSideGuide')).toBe(true);
    // Written back at boot, so raw readers (theme bootstrap) see the new shape.
    const stored = JSON.parse(localStorage.getItem('youtube_plus_settings'));
    expect(stored.styles.themeStyle).toBe('solid');
    expect('zenStyles' in stored).toBe(false);
    expect('enableZenStyles' in stored).toBe(false);
  });

  test('an export from 2.x imports into the renamed keys', () => {
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;
    expect(S.importSettings({ zenStyles: { cleanSideGuide: true }, enableZenStyles: false })).toBe(
      true
    );
    expect(S.get('styles.cleanSideGuide')).toBe(true);
    expect(S.get('enableStyles')).toBe(false);
  });

  test('legacy hideSideGuide: true migrates to styles.hideSideGuide: true', () => {
    localStorage.setItem(
      'youtube_plus_settings',
      JSON.stringify({
        hideSideGuide: true,
      })
    );
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;

    expect(S.get('styles.hideSideGuide')).toBe(true);
  });

  test('legacy styles.sideVideosTwoColumns: true migrates to 2 columns enabled', () => {
    localStorage.setItem(
      'youtube_plus_settings',
      JSON.stringify({
        styles: {
          sideVideosTwoColumns: true,
        },
      })
    );
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;

    expect(S.get('styles.sideVideosColumns')).toBe(2);
    expect(S.get('styles.sideVideosColumnsEnabled')).toBe(true);
  });

  test('legacy youtube_plus_all_settings_v2 (basic.js SettingsManager) is migrated', () => {
    localStorage.setItem(
      'youtube_plus_all_settings_v2',
      JSON.stringify({
        speedControl: { enabled: false },
        download: { enabled: false },
      })
    );
    require('../src/settings-store.js');
    S = window.YouTubePlusSettingsStore;

    expect(S.get('enableSpeedControl')).toBe(false);
    expect(S.get('enableDownload')).toBe(false);
    expect(localStorage.getItem('youtube_plus_all_settings_v2')).toBeNull();
  });
});

describe('FeatureRegistry and SettingsHost settingsKey validation', () => {
  let S;
  let FeatureRegistry;
  let SettingsHost;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusSettingsStore;
    delete window.YouTubePlusFeatureRegistry;
    delete window.YouTubePlusSettingsHost;
    localStorage.clear();

    require('../src/settings-store.js');
    require('../src/feature-registry.js');

    S = window.YouTubePlusSettingsStore;
    FeatureRegistry = window.YouTubePlusFeatureRegistry;
    SettingsHost = window.YouTubePlusSettingsHost;
  });

  test('FeatureRegistry.register rejects descriptor with unknown settingsKey and warns', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* mock */
    });

    const registered = FeatureRegistry.register({
      id: 'typo-feature',
      titleKey: 'foo',
      fallbackTitle: 'Foo',
      settingsKey: 'enableTypoFeatureDoesNotExist',
      command: () => true,
    });

    expect(registered).toBe(false);
    expect(FeatureRegistry.has('typo-feature')).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown settings key "enableTypoFeatureDoesNotExist"')
    );

    warnSpy.mockRestore();
  });

  test('FeatureRegistry.register accepts descriptor with registered settingsKey', () => {
    const registered = FeatureRegistry.register({
      id: 'custom-feature',
      titleKey: 'zoom',
      fallbackTitle: 'Zoom',
      settingsKey: 'enableZoom',
      command: () => true,
    });

    expect(registered).toBe(true);
    expect(FeatureRegistry.has('custom-feature')).toBe(true);
  });

  test('SettingsHost.isEnabled returns false on unknown/typo settingsKey and never enables', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* mock */
    });

    expect(SettingsHost.isEnabled('enableTypoNeverRegistered')).toBe(false);
    expect(SettingsHost.isEnabled('enableTypoNeverRegistered', true)).toBe(false); // even with fallback=true!

    warnSpy.mockRestore();
  });

  test('SettingsHost.isEnabled returns store value for valid key', () => {
    expect(SettingsHost.isEnabled('enableDownload')).toBe(true);

    S.set('enableDownload', false);
    expect(SettingsHost.isEnabled('enableDownload')).toBe(false);
  });
});
