/**
 * Unit tests for the ANDROID direct-stream format pickers: codec and quality
 * selection, the muxed/adaptive ladder and the empty-blob guards. Every case
 * asserts which media URLs the picker actually requested.
 */

describe('Download direct-stream format pickers', () => {
  const createLogger = () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  });

  function installModule() {
    jest.resetModules();
    require('../src/download.js');
    return window.YouTubePlusDownload;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.resetModules();
    require('../src/utils.js');
    const canonUtils = window.YouTubeUtils;
    window._ytplusCreateHTML = s => s;
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(sel => document.querySelector(sel)),
        $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
        getVideoIdFromUrl: canonUtils.getVideoIdFromUrl,
        getVideoIdFromLocation: jest.fn(canonUtils.getVideoIdFromLocation),
        t: jest.fn(key => key || ''),
        openSafe: jest.fn(),
        createVisibilityAwareInterval: jest.fn((cb, delay) => {
          const id = setInterval(cb, delay);
          return {
            active: true,
            stop: () => clearInterval(id),
            pause: () => clearInterval(id),
            resume: jest.fn(),
          };
        }),
        cleanupManager: {
          register: jest.fn(),
          registerInterval: jest.fn(id => id),
          registerTimeout: jest.fn(id => id),
          registerObserver: jest.fn(obs => obs),
          registerListener: jest.fn((target, event, fn, opts) => {
            target.addEventListener(event, fn, opts);
            return Symbol('listener');
          }),
          cleanup: jest.fn(),
          registerAnimationFrame: jest.fn(id => id),
        },
        NotificationManager: { show: jest.fn(), hide: jest.fn() },
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        logError: jest.fn(),
        createElement: jest.fn(tag => document.createElement(tag)),
        loadFeatureEnabled: jest.fn(() => true),
        storage: {
          get: jest.fn(),
          set: jest.fn(),
          remove: jest.fn(),
          getItem: jest.fn(() => null),
          setItem: jest.fn(),
        },
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        SETTINGS_KEY: 'youtube_plus_settings',
        isWatchRoute: jest.fn(() => window.location.pathname === '/watch'),
        isShortsRoute: jest.fn(() => false),
        isYouTubeDomain: jest.fn(() => true),
        isChannelRoute: jest.fn(() => false),
        isSettingsModalOpen: jest.fn(() => false),
        createIsRelevantRoute: () => () => true,
        createWithErrorBoundary: _name => fn => fn,
        logSuppressed: jest.fn(),
        getRoute: jest.fn(() => 'watch'),
      },
    });
    Object.defineProperty(window, 'YouTubePlusI18n', {
      configurable: true,
      writable: true,
      value: {
        t: jest.fn(key => key),
        getLanguage: jest.fn(() => 'en'),
        loadTranslations: jest.fn(),
        isReady: jest.fn(() => true),
      },
    });
    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        createLogger: jest.fn(() => createLogger()),
        setLevel: jest.fn(),
        getLevel: jest.fn(() => 'info'),
        getRecent: jest.fn(() => []),
        export: jest.fn(),
        createChild: jest.fn(),
      },
    });
    Object.defineProperty(window, 'YouTubePlusDOMCache', {
      configurable: true,
      writable: true,
      value: {
        get: jest.fn(),
        querySelector: jest.fn(),
        getAll: jest.fn(),
        querySelectorAll: jest.fn(),
        getElementById: jest.fn(),
        waitForElement: jest.fn(),
        invalidate: jest.fn(),
        clear: jest.fn(),
      },
    });

    global.mockLocation({
      href: 'https://www.youtube.com/watch?v=test12345ab',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=test12345ab',
    });
    global.fetch = jest.fn(() => Promise.reject(new Error('network disabled in unit tests')));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:stream-pickers'),
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  /**
   * @param {Record<string, unknown>} streamingData
   * @returns {string[]} every requested URL, in order
   */
  function serveAndroid(streamingData) {
    /** @type {string[]} */
    const urls = [];
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      urls.push(url);
      if (url.includes('/youtubei/v1/player')) {
        options.onload({ status: 200, responseText: JSON.stringify({ streamingData }) });
        return { abort: jest.fn() };
      }
      options.onload({ status: 200, response: new window.Blob(['stream bytes']) });
      return { abort: jest.fn() };
    });
    return urls;
  }

  /** The player request is bookkeeping; only media URLs are interesting. */
  const mediaOnly = urls => urls.filter(url => !url.includes('/youtubei/v1/player'));

  /**
   * Serve the direct stream without a userscript manager: media downloads fall
   * back to opening a new tab and resolve with a synthetic empty blob.
   * @param {Record<string, unknown>} streamingData
   * @returns {string[]} every requested URL, in order
   */
  async function serveAndroidWithoutManager(streamingData) {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'GM_xmlhttpRequest');
    delete globalThis.GM_xmlhttpRequest;
    /** @type {string[]} */
    const urls = [];
    global.fetch = jest.fn(url => {
      urls.push(String(url));
      if (String(url).includes('/youtubei/v1/player')) {
        return Promise.resolve({
          status: 200,
          url: String(url),
          text: () => Promise.resolve(JSON.stringify({ streamingData })),
        });
      }
      return Promise.resolve({
        status: 200,
        url: String(url),
        blob: () => Promise.resolve(new window.Blob([])),
      });
    });
    const api = installModule();
    return {
      api,
      urls,
      restore: () =>
        saved ? Object.defineProperty(globalThis, 'GM_xmlhttpRequest', saved) : undefined,
    };
  }

  const notifications = () =>
    window.YouTubeUtils.NotificationManager.show.mock.calls.map(call => String(call[0]));

  describe('video track selection', () => {
    test('an h264 track is preferred over vp9 at the same height', async () => {
      const urls = serveAndroid({
        adaptiveFormats: [
          { url: 'https://r.example/vp9-1080', mimeType: 'video/webm; codecs="vp9"', height: 1080 },
          {
            url: 'https://r.example/avc1-1080',
            mimeType: 'video/mp4; codecs="avc1.640028"',
            height: 1080,
          },
          {
            url: 'https://r.example/avc1-2160',
            mimeType: 'video/mp4; codecs="avc1.640033"',
            height: 2160,
          },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'video', quality: '1080' });

      expect(urls[urls.length - 1]).toBe('https://r.example/avc1-1080');
    });

    test('two tracks at the same height are separated by the preferred codec', async () => {
      const urls = serveAndroid({
        adaptiveFormats: [
          {
            url: 'https://r.example/avc1-baseline-1080',
            mimeType: 'video/mp4; codecs="avc1.42001f"',
            height: 1080,
          },
          {
            url: 'https://r.example/avc1-high-1080',
            mimeType: 'video/mp4; codecs="avc1.640028"',
            height: 1080,
          },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'video', quality: '1080' });

      // The order is stable, so the first h264 candidate wins the tie.
      expect(mediaOnly(urls)).toEqual(['https://r.example/avc1-baseline-1080']);
    });

    test('a quality label is used when the format exposes no height', async () => {
      const urls = serveAndroid({
        adaptiveFormats: [
          {
            url: 'https://r.example/label-only',
            mimeType: 'video/mp4; codecs="avc1"',
            qualityLabel: '720p',
          },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'video', quality: '1080' });

      expect(urls).toContain('https://r.example/label-only');
    });

    test('with no h264 track at all the highest available video track is used', async () => {
      const urls = serveAndroid({
        adaptiveFormats: [
          { url: 'https://r.example/vp9-360', mimeType: 'video/webm; codecs="vp9"', height: 360 },
          { url: 'https://r.example/vp9-480', mimeType: 'video/webm; codecs="vp9"', height: 480 },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'video', quality: '720' });

      expect(urls).toContain('https://r.example/vp9-480');
    });

    test('a format without a url is never fetched', async () => {
      const urls = serveAndroid({
        adaptiveFormats: [
          { mimeType: 'video/mp4; codecs="avc1"', height: 1080 },
          { url: 'https://r.example/only-one', mimeType: 'video/mp4; codecs="avc1"', height: 720 },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'video', quality: '1080' });

      expect(mediaOnly(urls)).toEqual(['https://r.example/only-one']);
    });

    test('an unreadable quality falls back to the 1080p ladder', async () => {
      const urls = serveAndroid({
        adaptiveFormats: [
          { url: 'https://r.example/avc1-720', mimeType: 'video/mp4; codecs="avc1"', height: 720 },
          {
            url: 'https://r.example/avc1-1080',
            mimeType: 'video/mp4; codecs="avc1"',
            height: 1080,
          },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'video', quality: 'best' });

      expect(urls).toContain('https://r.example/avc1-1080');
    });

    test('a non-array streamingData block reports that no stream is available', async () => {
      serveAndroid({ formats: 'nope', adaptiveFormats: { nope: true } });
      const api = installModule();

      await expect(
        api.downloadViaDirectStream({ format: 'video', quality: '1080' })
      ).rejects.toThrow('noStreamAvailable');
    });
  });

  describe('muxed progressive ladder', () => {
    test('a 240p muxed track is used for a 360p request', async () => {
      const urls = serveAndroid({
        formats: [
          {
            url: 'https://r.example/muxed-240',
            mimeType: 'video/mp4; codecs="avc1.42001E, mp4a"',
            height: 240,
          },
        ],
        adaptiveFormats: [],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'video', quality: '360' });

      expect(mediaOnly(urls)).toEqual(['https://r.example/muxed-240']);
      expect(notifications()).toContain('downloadCompleted');
    });

    test('a muxed track above the cap is used when nothing fits', async () => {
      const urls = serveAndroid({
        formats: [
          { url: 'https://r.example/muxed-480', mimeType: 'video/mp4; codecs="avc1"', height: 480 },
          { url: 'https://r.example/muxed-720', mimeType: 'video/mp4; codecs="avc1"', height: 720 },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'video', quality: '360' });

      expect(mediaOnly(urls)).toEqual(['https://r.example/muxed-720']);
    });

    test('a progressive audio-only entry is not treated as muxed video', async () => {
      const urls = serveAndroid({
        formats: [
          { url: 'https://r.example/progressive-audio', mimeType: 'audio/mp4; codecs="mp4a"' },
        ],
        adaptiveFormats: [
          {
            url: 'https://r.example/adaptive-avc1',
            mimeType: 'video/mp4; codecs="avc1"',
            height: 360,
          },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'video', quality: '360' });

      expect(mediaOnly(urls)).toEqual([
        'https://r.example/adaptive-avc1',
        'https://r.example/progressive-audio',
      ]);
    });

    test('an empty muxed blob ends the request without saving anything', async () => {
      const { api, urls, restore } = await serveAndroidWithoutManager({
        formats: [
          { url: 'https://r.example/muxed-360', mimeType: 'video/mp4; codecs="avc1"', height: 360 },
        ],
      });
      try {
        await api.downloadViaDirectStream({ format: 'video', quality: '360' });

        expect(window.YouTubeUtils.openSafe).toHaveBeenCalledWith(
          'https://r.example/muxed-360',
          '_blank'
        );
        expect(mediaOnly(urls)).toEqual([]);
        expect(notifications()).not.toContain('downloadCompleted');
        expect(URL.createObjectURL).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  });

  describe('audio track selection', () => {
    test('an unparseable bitrate request saves the highest m4a track', async () => {
      const urls = serveAndroid({
        adaptiveFormats: [
          {
            url: 'https://r.example/m4a-128',
            mimeType: 'audio/mp4; codecs="mp4a"',
            bitrate: 128000,
          },
          { url: 'https://r.example/m4a-64', mimeType: 'audio/mp4; codecs="mp4a"', bitrate: 64000 },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'audio', audioBitrate: 'best' });

      expect(urls[urls.length - 1]).toBe('https://r.example/m4a-128');
    });

    test('a track without a bitrate is still selectable', async () => {
      const urls = serveAndroid({
        adaptiveFormats: [
          { url: 'https://r.example/m4a-nobitrate', mimeType: 'audio/mp4; codecs="mp4a"' },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'audio', audioBitrate: '128' });

      expect(mediaOnly(urls)).toEqual(['https://r.example/m4a-nobitrate']);
      expect(notifications()).toContain('downloadCompleted');
    });

    test('an empty audio blob saves nothing', async () => {
      const { api, restore } = await serveAndroidWithoutManager({
        adaptiveFormats: [
          {
            url: 'https://r.example/m4a-128',
            mimeType: 'audio/mp4; codecs="mp4a"',
            bitrate: 128000,
          },
        ],
      });
      try {
        await api.downloadViaDirectStream({ format: 'audio', audioBitrate: '128' });

        expect(window.YouTubeUtils.openSafe).toHaveBeenCalledWith(
          'https://r.example/m4a-128',
          '_blank'
        );
        expect(notifications()).not.toContain('downloadCompleted');
        expect(URL.createObjectURL).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    test('an m4a track without the mp4 container is skipped', async () => {
      serveAndroid({
        adaptiveFormats: [
          {
            url: 'https://r.example/webm-audio',
            mimeType: 'audio/webm; codecs="opus"',
            bitrate: 160000,
          },
        ],
      });
      const api = installModule();

      await expect(
        api.downloadViaDirectStream({ format: 'audio', audioBitrate: '128' })
      ).rejects.toThrow('noStreamAvailable');
    });
  });

  describe('adaptive video companion audio', () => {
    test('an empty video track skips the companion audio entirely', async () => {
      const { api, restore } = await serveAndroidWithoutManager({
        adaptiveFormats: [
          {
            url: 'https://r.example/avc1-1080',
            mimeType: 'video/mp4; codecs="avc1"',
            height: 1080,
          },
          {
            url: 'https://r.example/m4a-128',
            mimeType: 'audio/mp4; codecs="mp4a"',
            bitrate: 128000,
          },
        ],
      });
      try {
        await api.downloadViaDirectStream({ format: 'video', quality: '1080' });

        expect(window.YouTubeUtils.openSafe).toHaveBeenCalledTimes(1);
        expect(window.YouTubeUtils.openSafe).toHaveBeenCalledWith(
          'https://r.example/avc1-1080',
          '_blank'
        );
        expect(notifications()).not.toContain('downloadCompleted');
      } finally {
        restore();
      }
    });

    test('a saved adaptive video also saves its companion audio track', async () => {
      const urls = serveAndroid({
        adaptiveFormats: [
          {
            url: 'https://r.example/avc1-1080',
            mimeType: 'video/mp4; codecs="avc1"',
            height: 1080,
          },
          {
            url: 'https://r.example/m4a-128',
            mimeType: 'audio/mp4; codecs="mp4a"',
            bitrate: 128000,
          },
        ],
      });
      const api = installModule();

      await api.downloadViaDirectStream({ format: 'video', quality: '1080' });

      expect(mediaOnly(urls)).toEqual(['https://r.example/avc1-1080', 'https://r.example/m4a-128']);
      // One save for the video track and one for its audio companion.
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
      expect(notifications()).toContain('downloadCompleted');
    });
  });
});
