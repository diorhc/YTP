/**
 * Unit tests for the download module's alternative sources and transport
 * guards: cnv.cx conversion retries, Cobalt instance selection, the ANDROID
 * direct-stream picker, blob downloads and the request-log sanitiser.
 */

describe('Download sources and stream transports', () => {
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
        getVideoIdFromLocation: canonUtils.getVideoIdFromLocation,
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
    // jsdom's Blob has no arrayBuffer(); the album-art writer needs one.
    if (typeof window.Blob.prototype.arrayBuffer !== 'function') {
      window.Blob.prototype.arrayBuffer = function () {
        return Promise.resolve(new ArrayBuffer(8));
      };
    }
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:sources-test'),
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  /**
   * Run `fn` with the GM transport removed (the userscript-manager-less page
   * fallback), restoring the shared global afterwards.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function withoutGmTransport(fn) {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'GM_xmlhttpRequest');
    delete globalThis.GM_xmlhttpRequest;
    try {
      return await fn();
    } finally {
      if (saved) Object.defineProperty(globalThis, 'GM_xmlhttpRequest', saved);
    }
  }

  /**
   * @param {(url: string, method?: string) => { status?: number, responseText?: string, response?: unknown, error?: boolean }} responder
   * @returns {{ urls: string[], payloads: Array<Record<string, unknown>> }}
   */
  function serveRequests(responder) {
    /** @type {string[]} */
    const urls = [];
    /** @type {Array<Record<string, unknown>>} */
    const payloads = [];
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      urls.push(url);
      const result = responder(url, String(options.method || 'GET')) || {};
      payloads.push(result);
      if (result.error) {
        options.onerror?.({ status: 0 });
        return { abort: jest.fn() };
      }
      options.onload?.({
        status: result.status ?? 200,
        responseText: result.responseText ?? '',
        response: result.response ?? null,
      });
      return { abort: jest.fn() };
    });
    return { urls, payloads };
  }

  const CONVERT_OK = (extra = {}) => ({
    status: 200,
    responseText: JSON.stringify({
      url: 'https://cdn.example.com/file.mp4',
      filename: 'clip.mp4',
      ...extra,
    }),
  });

  const KEY_OK = { status: 200, responseText: JSON.stringify({ key: 'test-key' }) };

  const CDN_BLOB = { status: 200, response: new window.Blob(['binary payload bytes']) };

  describe('cnv.cx conversion session guards', () => {
    test('a page without a video id refuses to start a download', async () => {
      global.mockLocation({
        href: 'https://www.youtube.com/feed/history',
        pathname: '/feed/history',
        search: '',
      });
      const { urls } = serveRequests(() => CONVERT_OK());
      const api = installModule();

      await expect(api.downloadVideo({ format: 'video' })).rejects.toThrow('Video ID not found');
      expect(urls).toHaveLength(0);
    });

    test('an already-cancelled session never reaches the converter', async () => {
      const { urls } = serveRequests(() => CONVERT_OK());
      const api = installModule();

      await expect(api.downloadVideo({ format: 'video', onCancel: () => true })).rejects.toThrow(
        'Download cancelled'
      );
      expect(urls).toHaveLength(0);
    });

    test('cancelling between the conversion and the file fetch aborts the download', async () => {
      let calls = 0;
      serveRequests(url => (url.includes('/sanity/key') ? KEY_OK : CONVERT_OK()));
      const api = installModule();

      await expect(
        api.downloadVideo({
          format: 'video',
          onCancel: () => {
            calls += 1;
            return calls > 1;
          },
        })
      ).rejects.toThrow('Download cancelled');
    });

    test('a conversion response without a download URL reports the failure detail', async () => {
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : { status: 200, responseText: JSON.stringify({ status: 'error' }) }
      );
      const api = installModule();

      await expect(api.downloadVideo({ format: 'video' })).rejects.toThrow(
        /No download URL received from .* \(error\)/
      );
    });

    test('a key response without a key is rejected', async () => {
      serveRequests(() => ({ status: 200, responseText: JSON.stringify({ nope: true }) }));
      const api = installModule();

      await expect(api.downloadVideo({ format: 'video' })).rejects.toThrow(
        /API key not found in response from \w/
      );
    });

    test('the converter payload asks for vp9 above 1080p and h264 below', async () => {
      /** @type {Record<string, unknown>[]} */
      const bodies = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/sanity/key')) {
          options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
          return { abort: jest.fn() };
        }
        if (url.includes('/converter')) {
          bodies.push(JSON.parse(String(options.data)));
          options.onload({
            status: 200,
            responseText: JSON.stringify({ url: 'https://cdn.example.com/f.mp4' }),
          });
          return { abort: jest.fn() };
        }
        options.onload({ status: 200, response: new window.Blob(['x']) });
        return { abort: jest.fn() };
      });
      const api = installModule();

      await api.downloadVideo({ format: 'video', quality: '2160' });
      await api.downloadVideo({ format: 'video', quality: '720' });
      await api.downloadVideo({ format: 'audio', audioBitrate: '192', embedThumbnail: false });

      expect(bodies[0]).toMatchObject({
        format: 'mp4',
        videoQuality: '2160',
        vCodec: 'vp9',
        audioBitrate: '128',
        filenameStyle: 'pretty',
      });
      expect(bodies[1]).toMatchObject({ vCodec: 'h264', videoQuality: '720' });
      expect(bodies[2]).toEqual({
        link: 'https://www.youtube.com/watch?v=test12345ab',
        format: 'mp3',
        audioBitrate: '192',
        filenameStyle: 'pretty',
      });
    });

    test('the CDN referer follows the converter that served the file', async () => {
      /** @type {Array<Record<string, string>>} */
      const headers = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/sanity/key')) {
          options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
          return { abort: jest.fn() };
        }
        if (url.includes('/converter')) {
          options.onload({
            status: 200,
            responseText: JSON.stringify({ url: 'https://cdn.example.com/f.mp4' }),
          });
          return { abort: jest.fn() };
        }
        headers.push(options.headers || {});
        options.onload({ status: 200, response: new window.Blob(['x']) });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await api.downloadVideo({ format: 'video' });

      expect(headers[0].Referer).toBe('https://mp3yt.is/');
    });

    test('a zero-byte CDN payload aborts before saving anything', async () => {
      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click');
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : url.includes('/converter')
            ? CONVERT_OK()
            : { status: 200, response: new window.Blob([]) }
      );
      const api = installModule();

      await expect(api.downloadVideo({ format: 'video', embedThumbnail: false })).rejects.toThrow(
        'zeroBytesError'
      );
      expect(clickSpy).not.toHaveBeenCalled();
    });

    test('a non-200 CDN response is reported with its status', async () => {
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : url.includes('/converter')
            ? CONVERT_OK()
            : {
                status: 503,
              }
      );
      const api = installModule();

      await expect(api.downloadVideo({ format: 'video' })).rejects.toThrow('Download failed: 503');
    });

    test('progress events are forwarded with a computed percentage', async () => {
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : url.includes('/converter')
            ? CONVERT_OK()
            : { status: 200, response: new window.Blob(['data']), progress: true }
      );
      /** @type {Array<{ loaded: number, total: number, percent: number }>} */
      const progress = [];
      const api = installModule();

      const originalImpl = GM_xmlhttpRequest.getMockImplementation();
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('cdn.example.com')) {
          options.onprogress?.({ loaded: 512, total: 2048 });
        }
        return /** @type {Function} */ (originalImpl)(options);
      });

      await api.downloadVideo({ format: 'video', onProgress: p => progress.push(p) });
      expect(progress).toContainEqual({ loaded: 512, total: 2048, percent: 25 });
    });

    test('a non-https media URL is refused before any transport', async () => {
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : { status: 200, responseText: JSON.stringify({ url: 'http://cdn.example.com/f.mp4' }) }
      );
      const api = installModule();

      await expect(api.downloadVideo({ format: 'video' })).rejects.toThrow(
        'Refused non-https download URL'
      );
    });

    test('the logged media URL drops credentials, ids and tokens', async () => {
      const logger = createLogger();
      window.YouTubePlusLogger.createLogger.mockReturnValue(logger);
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : url.includes('/converter')
            ? {
                status: 200,
                responseText: JSON.stringify({
                  url: 'https://cdn.example.com/f.mp4?sig=secret&pot=token&v=abc',
                }),
              }
            : CDN_BLOB
      );
      const api = installModule();

      await api.downloadVideo({ format: 'video' });

      expect(logger.debug).toHaveBeenCalledWith(
        'Downloading file from:',
        'https://cdn.example.com/f.mp4'
      );
    });

    test('an unparseable media URL is logged fully redacted instead of throwing', async () => {
      const logger = createLogger();
      window.YouTubePlusLogger.createLogger.mockReturnValue(logger);
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : url.includes('/converter')
            ? { status: 200, responseText: JSON.stringify({ url: 'http://' }) }
            : CDN_BLOB
      );
      const api = installModule();

      await expect(api.downloadVideo({ format: 'video' })).rejects.toThrow(
        'Refused non-https download URL'
      );
      expect(logger.debug).toHaveBeenCalledWith('Downloading file from:', '<redacted-url>');
    });

    test('a media URL without sensitive params is logged as origin plus path', async () => {
      const logger = createLogger();
      window.YouTubePlusLogger.createLogger.mockReturnValue(logger);
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : url.includes('/converter')
            ? {
                status: 200,
                responseText: JSON.stringify({
                  url: 'https://cdn.example.com/path/to/file.mp4?cachebust=17',
                }),
              }
            : CDN_BLOB
      );
      const api = installModule();

      await api.downloadVideo({ format: 'video' });

      expect(logger.debug).toHaveBeenCalledWith(
        'Downloading file from:',
        'https://cdn.example.com/path/to/file.mp4'
      );
    });

    test('audio downloads try to embed album art and keep the original blob', async () => {
      const origCreate = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation(tag => {
        const el = origCreate(tag);
        if (String(tag).toLowerCase() === 'img') {
          Object.defineProperty(el, 'src', {
            configurable: true,
            set() {
              setTimeout(() => /** @type {any} */ (el).onerror?.(), 0);
            },
            get: () => '',
          });
        }
        return el;
      });
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : url.includes('/converter')
            ? {
                status: 200,
                responseText: JSON.stringify({ url: 'https://cdn.example.com/a.mp3' }),
              }
            : CDN_BLOB
      );
      const api = installModule();

      await expect(
        api.downloadVideo({ format: 'audio', embedThumbnail: true })
      ).resolves.toBeUndefined();
      expect(window.YouTubeUtils.NotificationManager.show).toHaveBeenCalledWith(
        'downloadCompleted',
        { duration: 3000, type: 'success' }
      );
    });

    test('an ID3 writer failure never loses the downloaded audio', async () => {
      const origCreate = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation(tag => {
        const el = origCreate(tag);
        if (String(tag).toLowerCase() === 'img') {
          Object.defineProperty(el, 'src', {
            configurable: true,
            set() {
              setTimeout(() => {
                el.width = 200;
                el.height = 200;
                /** @type {any} */ (el).onload?.();
              }, 0);
            },
            get: () => '',
          });
        }
        return el;
      });
      jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: jest.fn(),
      });
      jest.spyOn(window.HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
        cb(new window.Blob(['jpeg-bytes']));
      });
      window.ID3Writer = undefined;
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : url.includes('/converter')
            ? {
                status: 200,
                responseText: JSON.stringify({ url: 'https://cdn.example.com/a.mp3' }),
              }
            : CDN_BLOB
      );
      const api = installModule();

      await expect(
        api.downloadVideo({ format: 'audio', embedThumbnail: true })
      ).resolves.toBeUndefined();
    });

    test('an available ID3 writer rewrites the blob and keeps the metadata frames', async () => {
      const origCreate = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation(tag => {
        const el = origCreate(tag);
        if (String(tag).toLowerCase() === 'img') {
          Object.defineProperty(el, 'src', {
            configurable: true,
            set() {
              setTimeout(() => {
                el.width = 100;
                el.height = 300;
                /** @type {any} */ (el).onload?.();
              }, 0);
            },
            get: () => '',
          });
        }
        return el;
      });
      jest.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: jest.fn(),
      });
      const toBlobSpy = jest
        .spyOn(window.HTMLCanvasElement.prototype, 'toBlob')
        .mockImplementation(function (cb) {
          cb(new window.Blob(['jpeg-bytes']));
        });
      /** @type {string[]} */
      const frames = [];
      window.ID3Writer = function FakeID3Writer() {
        this.setFrame = (id, _value) => frames.push(id);
        this.addTag = jest.fn();
        this.arrayBuffer = new ArrayBuffer(16);
      };
      serveRequests(url =>
        url.includes('/sanity/key')
          ? KEY_OK
          : url.includes('/converter')
            ? {
                status: 200,
                responseText: JSON.stringify({
                  url: 'https://cdn.example.com/a.mp3',
                  filename: 'song.mp3',
                }),
              }
            : CDN_BLOB
      );
      const api = installModule();

      await api.downloadVideo({ format: 'audio', embedThumbnail: true });
      expect(toBlobSpy).toHaveBeenCalled();
      expect(frames).toContain('TIT2');
      expect(frames).toContain('APIC');
      delete window.ID3Writer;
    });
  });

  describe('downloadBlobFromUrl transport fallbacks', () => {
    test('without the GM transport the URL opens in a new tab and yields an empty blob', async () => {
      const api = installModule();
      const onRequest = jest.fn();

      const blob = await withoutGmTransport(() =>
        api.downloadBlobFromUrl({
          url: 'https://cdn.example.com/f.mp4',
          onRequest,
        })
      );

      expect(blob.size).toBe(0);
      expect(onRequest).toHaveBeenCalledWith({ abort: expect.any(Function) });
      expect(window.YouTubeUtils.openSafe).toHaveBeenCalledWith(
        'https://cdn.example.com/f.mp4',
        '_blank'
      );
    });

    test('the new-tab fallback uses window.open when openSafe is unavailable', async () => {
      const api = installModule();
      const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
      delete window.YouTubeUtils.openSafe;

      const blob = await withoutGmTransport(() =>
        api.downloadBlobFromUrl({ url: 'https://cdn.example.com/f.mp4' })
      );

      expect(blob.size).toBe(0);
      expect(openSpy).toHaveBeenCalledWith('https://cdn.example.com/f.mp4', '_blank');
    });

    test('a javascript: media URL is refused even though it parses as a URL', async () => {
      const api = installModule();
      await expect(api.downloadBlobFromUrl({ url: 'javascript:alert(1)' })).rejects.toThrow(
        'Refused non-https download URL'
      );
      await expect(api.downloadBlobFromUrl({ url: 'data:text/html,<script>' })).rejects.toThrow(
        'Refused non-https download URL'
      );
      await expect(api.downloadBlobFromUrl({ url: '//cdn.example.com/f.mp4' })).rejects.toThrow(
        'Refused non-https download URL'
      );
    });

    test('a configured deadline rejects with a timeout error', async () => {
      GM_xmlhttpRequest.mockImplementation(options => {
        options.ontimeout?.();
        return { abort: jest.fn() };
      });
      const api = installModule();

      await expect(
        api.downloadBlobFromUrl({ url: 'https://cdn.example.com/f.mp4', timeout: 5000 })
      ).rejects.toThrow('Download timeout');
    });

    test('a network failure is reported distinctly from a bad status', async () => {
      GM_xmlhttpRequest.mockImplementation(options => {
        options.onerror?.({ status: 0 });
        return { abort: jest.fn() };
      });
      const api = installModule();

      await expect(
        api.downloadBlobFromUrl({ url: 'https://cdn.example.com/f.mp4' })
      ).rejects.toThrow('Download failed - network error');
    });
  });

  describe('Cobalt source', () => {
    const COBALT_TUNNEL = (overrides = {}) => ({
      status: 200,
      responseText: JSON.stringify({
        status: 'tunnel',
        url: 'https://tunnel.cobalt.test/file.mp4',
        filename: 'clip.mp4',
        ...overrides,
      }),
    });

    /** @param {(url: string, method: string) => Record<string, unknown> | undefined} responder */
    function serveCobalt(responder) {
      /** @type {string[]} */
      const hosts = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        hosts.push(url);
        const result = responder(url, String(options.method || 'GET')) || { error: true };
        if (result.error) {
          options.onerror?.({ status: 0 });
          return { abort: jest.fn() };
        }
        options.onload?.({
          status: result.status ?? 200,
          responseText: result.responseText ?? '',
          response: result.response ?? null,
        });
        return { abort: jest.fn() };
      });
      return hosts;
    }

    test('an invalid JSON body is reported per instance and the next one is tried', async () => {
      const hosts = serveCobalt((url, method) => {
        if (method === 'GET') return { status: 200, response: new window.Blob(['tunnel bytes']) };
        if (url.includes('rue-cobalt')) return { status: 200, responseText: 'not json at all' };
        return COBALT_TUNNEL();
      });

      const api = installModule();
      await expect(api.downloadViaCobalt({ format: 'video' })).resolves.toBeUndefined();
      expect(hosts.some(h => h.includes('rue-cobalt'))).toBe(true);
      expect(hosts.some(h => h.includes('cobaltapi'))).toBe(true);
    });

    test('a non-tunnel response is reported with the server text', async () => {
      serveCobalt((_url, method) => {
        if (method === 'GET') return { status: 200, response: new window.Blob(['x']) };
        return {
          status: 200,
          responseText: JSON.stringify({ status: 'error', text: 'no api key' }),
        };
      });

      const api = installModule();
      await expect(api.downloadViaCobalt({ format: 'video' })).rejects.toThrow(
        /Cobalt \(.*\) error: no api key/
      );
    });

    test('a tunnel download cancelled before the fetch aborts the download', async () => {
      serveCobalt((_url, method) => {
        if (method === 'GET') return { status: 200, response: new window.Blob(['x']) };
        return COBALT_TUNNEL();
      });
      const api = installModule();

      await expect(
        api.downloadViaCobalt({ format: 'video', onCancel: () => true })
      ).rejects.toThrow('Download cancelled');
    });

    test('an empty tunnel blob ends the attempt without a second download', async () => {
      /** @type {string[]} */
      const hosts = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        const method = String(options.method || 'GET');
        hosts.push(url);
        if (method === 'POST') {
          // Drop the transport before the tunnel file fetch so the new-tab
          // fallback runs and yields an empty blob.
          delete globalThis.GM_xmlhttpRequest;
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              status: 'tunnel',
              url: 'https://tunnel.cobalt.test/file.mp4',
            }),
          });
          return { abort: jest.fn() };
        }
        options.onload({ status: 500, responseText: '' });
        return { abort: jest.fn() };
      });

      const saved = Object.getOwnPropertyDescriptor(globalThis, 'GM_xmlhttpRequest');
      const api = installModule();
      try {
        await api.downloadViaCobalt({ format: 'video' });
      } finally {
        if (saved) Object.defineProperty(globalThis, 'GM_xmlhttpRequest', saved);
      }

      // Only the first instance was contacted: the empty blob is a hard stop.
      const contacted = new Set(hosts.map(h => h.split('/')[2]));
      expect(contacted.size).toBe(1);
      expect(window.YouTubeUtils.openSafe).toHaveBeenCalledWith(
        'https://tunnel.cobalt.test/file.mp4',
        '_blank'
      );
    });

    test('every attempted host is disclosed to the user exactly once', async () => {
      serveCobalt(() => ({ status: 503, responseText: JSON.stringify({ errorMsg: 'down' }) }));
      const api = installModule();

      await expect(api.downloadViaCobalt({ format: 'audio' })).rejects.toThrow(
        /Cobalt \(.*\) failed: 503: down/
      );
      const notices = window.YouTubeUtils.NotificationManager.show.mock.calls
        .map(c => String(c[0]))
        .filter(m => m.startsWith('sourceCobalt'));
      expect(new Set(notices).size).toBe(notices.length);
      expect(notices).toContain('sourceCobalt: rue-cobalt');
    });

    test('discovery stays opt-in and is filtered to bare https origins', async () => {
      window.YouTubePlusSettingsStore = {
        get: jest.fn(key => (key === 'allowCobaltDiscovery' ? true : undefined)),
      };
      /** @type {string[]} */
      const seen = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        seen.push(url);
        if (url.includes('cobalt.directory')) {
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              data: {
                youtube: [
                  'https://good.example',
                  'https://trailing.example/',
                  'http://insecure.example',
                  'https://user:pass@creds.example',
                  'https://withpath.example/v10',
                  'https://withquery.example?a=1',
                  'not a url',
                  null,
                  42,
                ],
              },
            }),
          });
          return { abort: jest.fn() };
        }
        options.onload({ status: 500, responseText: '' });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await expect(api.downloadViaCobalt({ format: 'video' })).rejects.toThrow();

      const attempted = seen.filter(u => !u.includes('cobalt.directory'));
      expect(attempted.some(u => u.includes('good.example'))).toBe(true);
      expect(attempted.some(u => u.includes('trailing.example'))).toBe(true);
      expect(attempted.some(u => u.includes('insecure.example'))).toBe(false);
      expect(attempted.some(u => u.includes('creds.example'))).toBe(false);
      expect(attempted.some(u => u.includes('withpath.example'))).toBe(false);
      expect(attempted.some(u => u.includes('withquery.example'))).toBe(false);
    });

    test('a second discovery within the cache window reuses the cached hosts', async () => {
      window.YouTubePlusSettingsStore = {
        get: jest.fn(key => (key === 'allowCobaltDiscovery' ? true : undefined)),
      };
      let directoryCalls = 0;
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('cobalt.directory')) {
          directoryCalls += 1;
          options.onload({
            status: 200,
            responseText: JSON.stringify({ data: { youtube: ['https://cached.example'] } }),
          });
          return { abort: jest.fn() };
        }
        options.onload({ status: 500, responseText: '' });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await expect(api.downloadViaCobalt({ format: 'video' })).rejects.toThrow();
      await expect(api.downloadViaCobalt({ format: 'video' })).rejects.toThrow();
      expect(directoryCalls).toBe(1);
    });

    test('an expired discovery cache is refetched', async () => {
      window.YouTubePlusSettingsStore = {
        get: jest.fn(key => (key === 'allowCobaltDiscovery' ? true : undefined)),
      };
      let directoryCalls = 0;
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('cobalt.directory')) {
          directoryCalls += 1;
          options.onload({
            status: 200,
            responseText: JSON.stringify({ data: { youtube: ['https://cached.example'] } }),
          });
          return { abort: jest.fn() };
        }
        options.onload({ status: 500, responseText: '' });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await expect(api.downloadViaCobalt({ format: 'video' })).rejects.toThrow();

      const realNow = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 2 * 60 * 60 * 1000);
      try {
        await expect(api.downloadViaCobalt({ format: 'video' })).rejects.toThrow();
      } finally {
        nowSpy.mockRestore();
      }
      expect(directoryCalls).toBe(2);
    });

    test('a failing directory request falls back to the static instances only', async () => {
      window.YouTubePlusSettingsStore = {
        get: jest.fn(key => (key === 'allowCobaltDiscovery' ? true : undefined)),
      };
      /** @type {string[]} */
      const seen = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        seen.push(url);
        if (url.includes('cobalt.directory')) {
          options.onerror?.({ status: 0 });
          return { abort: jest.fn() };
        }
        options.onload({ status: 500, responseText: '' });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await expect(api.downloadViaCobalt({ format: 'video' })).rejects.toThrow();

      const attempted = seen.filter(u => !u.includes('cobalt.directory'));
      expect(attempted.some(u => u.includes('rue-cobalt'))).toBe(true);
      expect(attempted.some(u => u.includes('liubquanti'))).toBe(true);
    });

    test('a directory body that is not valid JSON is ignored', async () => {
      window.YouTubePlusSettingsStore = {
        get: jest.fn(key => (key === 'allowCobaltDiscovery' ? true : undefined)),
      };
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('cobalt.directory')) {
          options.onload({ status: 200, responseText: '<html>directory down</html>' });
          return { abort: jest.fn() };
        }
        options.onload({ status: 500, responseText: '' });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await expect(api.downloadViaCobalt({ format: 'video' })).rejects.toThrow();
    });
  });

  describe('ANDROID direct stream source', () => {
    /**
     * @param {Record<string, unknown>} streamingData
     * @returns {(url: string) => Record<string, unknown>}
     */
    function serveAndroid(streamingData) {
      return url => {
        if (url.includes('/youtubei/v1/player')) {
          return { status: 200, responseText: JSON.stringify({ streamingData }) };
        }
        return { status: 200, response: new window.Blob(['stream bytes']) };
      };
    }

    test('a non-200 player response aborts the download', async () => {
      serveRequests(() => ({ status: 403, responseText: '' }));
      const api = installModule();
      await expect(api.downloadViaDirectStream({ format: 'video' })).rejects.toThrow(
        'Failed to get mobile player data: 403'
      );
    });

    test('a non-OK playability status aborts the download', async () => {
      serveRequests(() => ({
        status: 200,
        responseText: JSON.stringify({
          playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' },
        }),
      }));
      const api = installModule();
      await expect(api.downloadViaDirectStream({ format: 'video' })).rejects.toThrow(
        'Mobile player: Sign in to confirm your age'
      );
    });

    test('a playability reason-less status still aborts', async () => {
      serveRequests(() => ({
        status: 200,
        responseText: JSON.stringify({ playabilityStatus: { status: 'UNPLAYABLE' } }),
      }));
      const api = installModule();
      await expect(api.downloadViaDirectStream({ format: 'video' })).rejects.toThrow(
        'Mobile player: UNPLAYABLE'
      );
    });

    test('an audio request with no m4a stream reports that no stream is available', async () => {
      serveRequests(
        serveAndroid({
          adaptiveFormats: [
            { url: 'https://r.example/a.webm', mimeType: 'audio/webm; codecs="opus"' },
          ],
        })
      );
      const api = installModule();
      await expect(
        api.downloadViaDirectStream({ format: 'audio', audioBitrate: '128' })
      ).rejects.toThrow('noStreamAvailable');
    });

    test('an audio request saves the best m4a at or below the requested bitrate', async () => {
      /** @type {string[]} */
      const fetched = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/youtubei/v1/player')) {
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              streamingData: {
                adaptiveFormats: [
                  {
                    url: 'https://r.example/high.m4a',
                    mimeType: 'audio/mp4; codecs="mp4a"',
                    bitrate: 256000,
                  },
                  {
                    url: 'https://r.example/mid.m4a',
                    mimeType: 'audio/mp4; codecs="mp4a"',
                    bitrate: 128000,
                  },
                  {
                    url: 'https://r.example/low.m4a',
                    mimeType: 'audio/mp4; codecs="mp4a"',
                    bitrate: 64000,
                  },
                ],
              },
            }),
          });
          return { abort: jest.fn() };
        }
        fetched.push(url);
        options.onload({ status: 200, response: new window.Blob(['audio']) });
        return { abort: jest.fn() };
      });
      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click');

      const api = installModule();
      await api.downloadViaDirectStream({ format: 'audio', audioBitrate: '128' });

      expect(fetched).toEqual(['https://r.example/mid.m4a']);
      expect(clickSpy.mock.instances[0].download).toMatch(/\.m4a$/);
    });

    test('an over-cap audio request falls back to the highest available bitrate', async () => {
      /** @type {string[]} */
      const fetched = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/youtubei/v1/player')) {
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              streamingData: {
                adaptiveFormats: [
                  {
                    url: 'https://r.example/high.m4a',
                    mimeType: 'audio/mp4; codecs="mp4a"',
                    bitrate: 256000,
                  },
                ],
              },
            }),
          });
          return { abort: jest.fn() };
        }
        fetched.push(url);
        options.onload({ status: 200, response: new window.Blob(['audio']) });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await api.downloadViaDirectStream({ format: 'audio', audioBitrate: '64' });
      expect(fetched).toEqual(['https://r.example/high.m4a']);
    });

    test('a quality above 360p uses the adaptive video track plus companion audio', async () => {
      /** @type {string[]} */
      const fetched = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/youtubei/v1/player')) {
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              streamingData: {
                adaptiveFormats: [
                  {
                    url: 'https://r.example/v720-avc.mp4',
                    mimeType: 'video/mp4; codecs="avc1.4d401f"',
                    height: 720,
                  },
                  {
                    url: 'https://r.example/v720-vp9.webm',
                    mimeType: 'video/webm; codecs="vp9"',
                    height: 720,
                  },
                  {
                    url: 'https://r.example/a.m4a',
                    mimeType: 'audio/mp4; codecs="mp4a"',
                    bitrate: 128000,
                  },
                ],
              },
            }),
          });
          return { abort: jest.fn() };
        }
        fetched.push(url);
        options.onload({ status: 200, response: new window.Blob(['stream']) });
        return { abort: jest.fn() };
      });
      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click');

      const api = installModule();
      await api.downloadViaDirectStream({ format: 'video', quality: '1080' });

      expect(fetched).toEqual(['https://r.example/v720-avc.mp4', 'https://r.example/a.m4a']);
      expect(clickSpy.mock.instances.map(a => a.download)).toEqual([
        expect.stringContaining('(sourceVideoNoAudio).mp4'),
        expect.stringContaining('(audio).m4a'),
      ]);
    });

    test('a failing companion audio track does not fail the video download', async () => {
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/youtubei/v1/player')) {
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              streamingData: {
                adaptiveFormats: [
                  {
                    url: 'https://r.example/v.mp4',
                    mimeType: 'video/mp4; codecs="avc1"',
                    height: 480,
                  },
                  {
                    url: 'https://r.example/a.m4a',
                    mimeType: 'audio/mp4; codecs="mp4a"',
                    bitrate: 128000,
                  },
                ],
              },
            }),
          });
          return { abort: jest.fn() };
        }
        if (url.endsWith('a.m4a')) {
          options.onload({ status: 502, response: null });
          return { abort: jest.fn() };
        }
        options.onload({ status: 200, response: new window.Blob(['stream']) });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await expect(
        api.downloadViaDirectStream({ format: 'video', quality: '720' })
      ).resolves.toBeUndefined();
      expect(window.YouTubeUtils.NotificationManager.show).toHaveBeenCalledWith(
        'downloadCompleted',
        { duration: 3000, type: 'success' }
      );
    });

    test('a video request with no usable stream reports that none is available', async () => {
      serveRequests(
        serveAndroid({
          adaptiveFormats: [
            { url: 'https://r.example/v.webm', mimeType: 'video/webm; codecs="vp9"' },
          ],
        })
      );
      const api = installModule();
      // No usable height anywhere, so the adaptive picker has nothing to offer.
      await expect(
        api.downloadViaDirectStream({ format: 'video', quality: '1080' })
      ).rejects.toThrow('noStreamAvailable');
    });

    test('an empty streaming data block reports that no stream is available', async () => {
      serveRequests(serveAndroid({}));
      const api = installModule();
      await expect(
        api.downloadViaDirectStream({ format: 'video', quality: '720' })
      ).rejects.toThrow('noStreamAvailable');
    });

    test('a progressive stream below the cap is used for 360p requests', async () => {
      /** @type {string[]} */
      const fetched = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/youtubei/v1/player')) {
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              streamingData: {
                formats: [
                  {
                    url: 'https://r.example/360.mp4',
                    mimeType: 'video/mp4; codecs="avc1"',
                    qualityLabel: '360p',
                  },
                  {
                    url: 'https://r.example/720.mp4',
                    mimeType: 'video/mp4; codecs="avc1"',
                    qualityLabel: '720p',
                  },
                ],
              },
            }),
          });
          return { abort: jest.fn() };
        }
        fetched.push(url);
        options.onload({ status: 200, response: new window.Blob(['stream']) });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await api.downloadViaDirectStream({ format: 'video', quality: '360' });
      expect(fetched).toEqual(['https://r.example/360.mp4']);
    });

    test('a cancelled session stops before the stream is fetched', async () => {
      /** @type {string[]} */
      const fetched = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/youtubei/v1/player')) {
          options.onload({
            status: 200,
            responseText: JSON.stringify({ streamingData: { formats: [] } }),
          });
          return { abort: jest.fn() };
        }
        fetched.push(url);
        return { abort: jest.fn() };
      });

      let calls = 0;
      const api = installModule();
      await expect(
        api.downloadViaDirectStream({
          format: 'video',
          onCancel: () => {
            calls += 1;
            return calls > 1;
          },
        })
      ).rejects.toThrow('Download cancelled');
      expect(fetched).toHaveLength(0);
    });
  });

  describe('transport rate limiting', () => {
    test('a malformed URL is rate limited under the unknown host bucket', async () => {
      const { urls } = serveRequests(() => ({ status: 200, responseText: 'ok' }));
      const api = installModule();

      await expect(api.gmXmlHttpRequest({ url: 'not a url at all' })).resolves.toMatchObject({
        status: 200,
        responseText: 'ok',
      });
      expect(urls).toEqual(['not a url at all']);
    });

    test('a blocking signal aborts the GM request even when abort throws', async () => {
      const controller = new AbortController();
      controller.abort();
      GM_xmlhttpRequest.mockImplementation(options => {
        options.onabort?.();
        return {
          abort: () => {
            throw new Error('handle already released');
          },
        };
      });
      const api = installModule();

      await expect(
        api.gmXmlHttpRequest({
          url: 'https://www.youtube.com/api/timedtext',
          signal: controller.signal,
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
    });

    test('a later abort reaches an in-flight GM request whose abort throws', async () => {
      const controller = new AbortController();
      /** @type {Array<{ abort: () => void }>} */
      const handles = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const handle = {
          abort: () => {
            // A real manager can throw from abort(); the module must survive it
            // and still end the request.
            Promise.resolve().then(() => options.onabort?.());
            throw new Error('handle already released');
          },
        };
        handles.push(handle);
        setTimeout(() => controller.abort(), 0);
        return handle;
      });
      const api = installModule();

      await expect(
        api.gmXmlHttpRequest({
          url: 'https://www.youtube.com/api/timedtext',
          signal: controller.signal,
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(handles).toHaveLength(1);
    });
  });
});
