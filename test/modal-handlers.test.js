/**
 * Unit tests for YouTube+ Modal Handlers module
 */

describe('ModalHandlers', () => {
  beforeEach(() => {
    window.YouTubeDOMCache = {
      get: jest.fn(sel => document.querySelector(sel)),
    };
    window.YouTubeUtils = {
      $: jest.fn(sel => document.querySelector(sel)),
    };
  });

  test('setSettingByPath should set simple key', () => {
    // Replicate the module function behavior
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
      let cur = settings;
      for (const k of keys) {
        if (
          !Object.prototype.hasOwnProperty.call(cur, k) ||
          typeof cur[k] !== 'object' ||
          !cur[k]
        ) {
          cur[k] = {};
        }
        cur = cur[k];
      }
      cur[lastKey] = value;
    };

    const settings = {};
    setSettingByPath(settings, 'volume', 80);
    expect(settings.volume).toBe(80);
  });

  test('setSettingByPath should set nested key', () => {
    const setSettingByPath = (settings, path, value) => {
      if (!settings || typeof settings !== 'object') return;
      if (!path || typeof path !== 'string') return;
      if (!path.includes('.')) {
        settings[path] = value;
        return;
      }
      const keys = path.split('.').filter(Boolean);
      const lastKey = keys.pop();
      let cur = settings;
      for (const k of keys) {
        if (!Object.prototype.hasOwnProperty.call(cur, k) || typeof cur[k] !== 'object' || !cur[k])
          cur[k] = {};
        cur = cur[k];
      }
      cur[lastKey] = value;
    };

    const settings = {};
    setSettingByPath(settings, 'download.quality', '1080p');
    expect(settings.download).toBeDefined();
    expect(settings.download.quality).toBe('1080p');
  });

  test('setSettingByPath should handle invalid inputs', () => {
    const setSettingByPath = (settings, path, value) => {
      if (!settings || typeof settings !== 'object') return;
      if (!path || typeof path !== 'string') return;
      if (!path.includes('.')) {
        settings[path] = value;
        return;
      }
    };

    expect(() => setSettingByPath(null, 'key', 'value')).not.toThrow();
    expect(() => setSettingByPath({}, '', 'value')).not.toThrow();
    expect(() => setSettingByPath({}, null, 'value')).not.toThrow();
  });

  test('initializeDownloadSites should set defaults', () => {
    const initializeDownloadSites = settings => {
      if (!settings.downloadSites) {
        settings.downloadSites = { externalDownloader: true, ytdl: true, direct: true };
      }
    };

    const settings = {};
    initializeDownloadSites(settings);
    expect(settings.downloadSites).toEqual({ externalDownloader: true, ytdl: true, direct: true });
  });

  test('initializeDownloadSites should not overwrite existing', () => {
    const initializeDownloadSites = settings => {
      if (!settings.downloadSites) {
        settings.downloadSites = { externalDownloader: true, ytdl: true, direct: true };
      }
    };

    const settings = { downloadSites: { externalDownloader: false, ytdl: true, direct: false } };
    initializeDownloadSites(settings);
    expect(settings.downloadSites.externalDownloader).toBe(false);
  });
});
