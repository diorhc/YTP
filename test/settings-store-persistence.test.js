/**
 * SettingsStore persistence
 * transactionality, authoritative previous state, and recursive path
 * subscriptions.
 *
 * Contracts under test (real SettingsStore + real CleanupManager):
 *   - A FAILED persistence (quota/security/serialization) must NOT report
 *     success: no success return, no settings-updated event, no subscriber
 *     notification, and the snapshot stays consistent with the last
 *     persisted state .
 *   - Subscribers on deep dot-paths are notified when a deeper leaf changes
 *     R: ecursive diff with parent+leaf semantics.
 *   - Direct saves work in isolation: the previous state for change
 *     detection comes from the authoritative persisted state, not from
 *     Sequential saves after the store's own cache invalidation
 *     notify exactly once each with or without FeatureRegistry.
 *   - Cross-tab storage events produce exactly one expected notification.
 */

describe('SettingsStore persistence, snapshots and subscriptions', () => {
  // The store module is designed for single evaluation per page (module-level
  // listeners/caches). Load it once per FILE and isolate tests via storage
  // reset — jest.resetModules here would leave the PREVIOUS module instance's
  // window-level listeners attached (the new module's unregister-by-key cannot
  // reach them), which is a harness artifact, not a product defect.
  beforeAll(() => {
    require('../src/cleanup-manager.js');
    require('../src/settings-store.js');
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    window.YouTubePlusSettingsStore?.reset?.();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('failed persistence (QuotaExceeded) is not reported as success', () => {
    const store = window.YouTubePlusSettingsStore;
    // First load primes the cache from (empty) storage + defaults.
    store.load();
    expect(store.get('enableScreenshot')).toBe(true);

    let events = 0;
    window.addEventListener('youtube-plus-settings-updated', () => {
      events++;
    });
    let notified = 0;
    store.subscribe('enableScreenshot', () => {
      notified++;
    });

    // Force the persistence failure (native jsdom storage: spy the prototype,
    // mirroring the approach in settings-store.test.js).
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    setItemSpy.mockImplementation(() => {
      const e = new Error('Exceeded storage quota');
      e.name = 'QuotaExceededError';
      throw e;
    });

    let ok = false;
    try {
      ok = store.set('enableScreenshot', false);
    } finally {
      setItemSpy.mockRestore();
    }

    expect(ok).toBe(false);
    expect(events).toBe(0);
    expect(notified).toBe(0);
    // Snapshot consistency: the store still exposes the last persisted value.
    expect(store.get('enableScreenshot')).toBe(true);
    // And a follow-up real write works again (no poisoned state).
    expect(store.set('enableScreenshot', false)).toBe(true);
    expect(store.get('enableScreenshot')).toBe(false);
  });

  test('b: SecurityError and serialization failures also fail closed', () => {
    const store = window.YouTubePlusSettingsStore;
    store.load();
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    setItemSpy.mockImplementation(() => {
      const e = new Error('denied');
      e.name = 'SecurityError';
      throw e;
    });
    let ok = false;
    try {
      ok = store.set('enableZoom', false);
    } finally {
      setItemSpy.mockRestore();
    }
    expect(ok).toBe(false);
    expect(store.get('enableZoom')).toBe(true);

    // Serialization failure: a circular value can never be stringified.
    const circular = {};
    circular.self = circular;
    let ok2 = false;
    try {
      ok2 = store.set('enableZoom', circular);
    } catch (_e) {
      ok2 = false;
    }
    expect(ok2).toBe(false);
    expect(store.get('enableZoom')).toBe(true);
  });

  test('a subscriber on a deeply nested path is notified when the leaf changes', () => {
    const store = window.YouTubePlusSettingsStore;
    store.load();
    let deep = 0;
    let deepValue = null;
    store.subscribe('downloadSiteCustomization.externalDownloader.name', v => {
      deep++;
      deepValue = v;
    });
    let parentCalls = 0;
    store.subscribe('downloadSiteCustomization.externalDownloader', () => {
      parentCalls++;
    });

    const result = store.set(
      'downloadSiteCustomization.externalDownloader.name',
      'Custom Downloader'
    );

    expect(result).toBe(true);
    expect(store.get('downloadSiteCustomization.externalDownloader.name')).toBe(
      'Custom Downloader'
    );
    expect(deep).toBe(1);
    expect(deepValue).toBe('Custom Downloader');
    expect(parentCalls).toBe(1);
  });

  test('sequential direct saves notify once each in isolation (no FeatureRegistry)', () => {
    const store = window.YouTubePlusSettingsStore;
    /** @type {boolean[]} */
    const vals = [];
    store.subscribe('enableDownload', v => {
      vals.push(v);
    });

    const first = store.load();
    const savedFalse = store.save({ ...first, enableDownload: false });
    expect(savedFalse).toBe(true);
    vals.length = 0;

    // Direct save right after the store's own settings-updated invalidation:
    // previous must come from the authoritative persisted state (false),
    // not from DEFAULTS (true), so this save notifies exactly once.
    const savedTrue = store.save({ ...first, enableDownload: true });
    expect(savedTrue).toBe(true);
    expect(vals).toEqual([true]);
    expect(store.get('enableDownload')).toBe(true);
  });

  test('shape: same flow with a FeatureRegistry-like listener stays correct', () => {
    const store = window.YouTubePlusSettingsStore;
    // Simulate the FeatureRegistry consumer: reads the store when the
    // settings-updated event fires (fills the cache), then a direct save.
    /** @type {boolean[]} */
    const vals = [];
    store.subscribe('enableDownload', v => {
      vals.push(v);
    });
    window.addEventListener('youtube-plus-settings-updated', () => {
      store.load(); // the registry handler reads the store
    });

    const first = store.load();
    store.save({ ...first, enableDownload: false });
    vals.length = 0;
    store.save({ ...first, enableDownload: true });
    expect(vals).toEqual([true]);
    expect(store.get('enableDownload')).toBe(true);
  });

  test('cross-tab storage events notify exactly once for the actual change', () => {
    const store = window.YouTubePlusSettingsStore;
    store.load();
    /** @type {boolean[]} */
    const vals = [];
    store.subscribe('enableScreenshot', v => {
      vals.push(v);
    });

    // Another tab writes the canonical key directly.
    localStorage.setItem('youtube_plus_settings', JSON.stringify({ enableScreenshot: false }));
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'youtube_plus_settings',
        newValue: JSON.stringify({ enableScreenshot: false }),
      })
    );

    expect(store.get('enableScreenshot')).toBe(false);
    expect(vals).toEqual([false]);
  });
});
