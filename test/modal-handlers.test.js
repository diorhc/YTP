/**
 * Unit tests for YouTube+ Modal Handlers module
 */

describe('ModalHandlers', () => {
  /** @typedef {Record<string, unknown>} PlainObject */

  /** @param {PlainObject | null} settings @param {string | null} path @param {unknown} value */
  const setSettingByPath = (settings, path, value) => {
    if (!settings || typeof settings !== 'object') return;
    if (!path || typeof path !== 'string') return;
    if (!path.includes('.')) {
      settings[path] = value;
      return;
    }
    const keys = path.split('.').filter(Boolean);
    if (!keys.length) return;
    const lastKey = keys.pop();
    if (!lastKey) return;

    /** @type {PlainObject} */
    let cur = settings;
    for (const k of keys) {
      const next = cur[k];
      if (!next || typeof next !== 'object') {
        cur[k] = {};
      }
      cur = /** @type {PlainObject} */ (cur[k]);
    }
    cur[lastKey] = value;
  };

  /** @typedef {{ externalDownloader: boolean, ytdl: boolean, direct: boolean }} DownloadSites */
  /** @typedef {{ downloadSites?: DownloadSites }} DownloadSettings */

  /** @param {DownloadSettings} settings */
  const initializeDownloadSites = settings => {
    if (!settings.downloadSites) {
      settings.downloadSites = { externalDownloader: true, ytdl: true, direct: true };
    }
  };

  beforeEach(() => {
    Object.defineProperty(window, 'YouTubeDOMCache', {
      configurable: true,
      writable: true,
      value: {
        get: jest.fn(sel => document.querySelector(sel)),
        getAll: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        querySelector: jest.fn((sel, ctx = document) => ctx.querySelector(sel)),
        querySelectorAll: jest.fn((sel, ctx = document) => Array.from(ctx.querySelectorAll(sel))),
        getElementById: jest.fn(id => document.getElementById(id)),
        waitForElement: jest.fn(async sel => document.querySelector(sel)),
        invalidate: jest.fn(),
        getStats: jest.fn(() => ({})),
      },
    });
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(sel => {
          const el = document.querySelector(sel);
          return el instanceof HTMLElement ? el : null;
        }),
      },
    });
  });

  test('setSettingByPath should set simple key', () => {
    /** @type {PlainObject} */
    const settings = {};
    setSettingByPath(settings, 'volume', 80);
    expect(settings.volume).toBe(80);
  });

  test('setSettingByPath should set nested key', () => {
    /** @type {PlainObject & { download?: { quality?: string } }} */
    const settings = {};
    setSettingByPath(settings, 'download.quality', '1080p');
    expect(settings.download).toBeDefined();
    if (!settings.download) throw new Error('download section was not created');
    expect(settings.download.quality).toBe('1080p');
  });

  test('setSettingByPath should handle invalid inputs', () => {
    /** @type {PlainObject} */
    const settings = {};
    expect(() => setSettingByPath(null, 'key', 'value')).not.toThrow();
    expect(() => setSettingByPath(settings, '', 'value')).not.toThrow();
    expect(() => setSettingByPath(settings, null, 'value')).not.toThrow();
  });

  test('initializeDownloadSites should set defaults', () => {
    /** @type {DownloadSettings} */
    const settings = {};
    initializeDownloadSites(settings);
    expect(settings.downloadSites).toEqual({ externalDownloader: true, ytdl: true, direct: true });
  });

  test('initializeDownloadSites should not overwrite existing', () => {
    /** @type {DownloadSettings} */
    const settings = { downloadSites: { externalDownloader: false, ytdl: true, direct: false } };
    initializeDownloadSites(settings);
    if (!settings.downloadSites) throw new Error('downloadSites is missing');
    expect(settings.downloadSites.externalDownloader).toBe(false);
  });
});
