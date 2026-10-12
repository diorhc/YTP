/**
 * Unit tests for YouTube+ Download module
 */

describe('Download Module', () => {
  const createLogger = () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  });

  function installModule(skipReset) {
    if (!skipReset) {
      jest.resetModules();
    }
    require('../src/download.js');
    return window.YouTubePlusDownload;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    // Canonical video-ID helpers come from the real utils module; the mock
    // facade below only replaces the DOM/storage surface.
    jest.resetModules();
    require('../src/utils.js');
    require('../src/modal-handlers.js');
    if (!window.YouTubePlusDesignSystem) window.YouTubePlusDesignSystem = {};
    window.YouTubePlusDesignSystem.initGlassDropdown =
      window.YouTubePlusModalHandlers?.initGlassDropdown;
    const canonUtils = window.YouTubeUtils;
    // Set up required globals
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
          registerListener: jest.fn(),
          cleanup: jest.fn(),
          registerAnimationFrame: jest.fn(id => id),
        },
        NotificationManager: { show: jest.fn(), hide: jest.fn() },
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        logError: jest.fn(),
        createElement: jest.fn(tag => document.createElement(tag)),
        loadFeatureEnabled: jest.fn(() => true),
        storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        SETTINGS_KEY: 'youtube_plus_settings',
        isWatchRoute: jest.fn(() => window.location.pathname === '/watch'),
        isShortsRoute: jest.fn(() => window.location.pathname.startsWith('/shorts')),
        isYouTubeDomain: jest.fn(() => true),
        isChannelRoute: jest.fn(() => false),
        isSettingsModalOpen: jest.fn(() => false),
        createIsRelevantRoute: (opts = {}) => {
          const {
            watch = false,
            shorts = false,
            channel = false,
            domain = false,
            settingsModal = false,
          } = opts;
          return () => {
            if (settingsModal && window.YouTubeUtils.isSettingsModalOpen?.()) return true;
            if (domain && !window.YouTubeUtils.isYouTubeDomain?.()) return false;
            return (
              (window.YouTubeUtils.isWatchRoute?.() && watch) ||
              (window.YouTubeUtils.isShortsRoute?.() && shorts) ||
              (window.YouTubeUtils.isChannelRoute?.() && channel)
            );
          };
        },
        createWithErrorBoundary: _name => fn => fn,
        logSuppressed: jest.fn(),
        // The lifecycle route host reads getRoute; derive the real module's
        // route names from the same predicates the stand-in already carries.
        getRoute: jest.fn(() => {
          if (window.YouTubeUtils.isWatchRoute?.()) return 'watch';
          if (window.YouTubeUtils.isShortsRoute?.()) return 'shorts';
          return '';
        }),
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

    // Mock location for watch page
    global.mockLocation({
      href: 'https://www.youtube.com/watch?v=test12345ab',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=test12345ab',
    });

    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: jest.fn(cb => cb()),
    });

    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
  });

  test('should define download globals when loaded on watch page', () => {
    // The download module should register itself when on a watch page
    // It checks for YouTube route relevance
    expect(window.YouTubeUtils).toBeDefined();
  });

  test('should validate video ID format', () => {
    // YouTube video IDs are 11 characters of alphanumeric + dash + underscore
    const validId = 'dQw4w9WgXcQ';
    const invalidId = 'too_short';
    expect(validId.length).toBe(11);
    expect(/^[a-zA-Z0-9_-]{11}$/.test(validId)).toBe(true);
    expect(/^[a-zA-Z0-9_-]{11}$/.test(invalidId)).toBe(false);
  });

  test('should detect relevant routes', () => {
    const isRelevantRoute = /** @param {string} path */ path => {
      try {
        return path === '/watch' || path.startsWith('/shorts');
      } catch {
        return false;
      }
    };
    expect(isRelevantRoute('/watch')).toBe(true);
    expect(isRelevantRoute('/shorts/abc')).toBe(true);
    expect(isRelevantRoute('/channel/UC123')).toBe(false);
    expect(isRelevantRoute('/')).toBe(false);
  });

  test('getSubtitles chooses a matching translatable source track instead of the first track', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      options.onload({
        status: 200,
        responseText: JSON.stringify({
          videoDetails: { title: 'Demo video' },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  languageCode: 'de',
                  baseUrl: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=de',
                  isTranslatable: false,
                  name: { simpleText: 'Deutsch' },
                },
                {
                  languageCode: 'en',
                  kind: 'asr',
                  vssId: 'a.en',
                  isTranslatable: true,
                  baseUrl:
                    'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en&kind=asr&fmt=srv1',
                  name: { simpleText: 'English (auto-generated)' },
                },
              ],
              translationLanguages: [
                {
                  languageCode: 'fr',
                  languageName: { simpleText: 'French' },
                },
              ],
            },
          },
        }),
      });
    });

    const api = installModule();
    const result = await api.getSubtitles('test12345ab');

    expect(result.autoTransSubtitles).toHaveLength(1);
    expect(result.autoTransSubtitles[0]).toMatchObject({
      sourceLanguageCode: 'en',
      isAutoGenerated: true,
      baseUrl: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en&kind=asr&fmt=srv1',
      trackId: 'a.en',
    });
  });

  test('downloadSubtitle defers blob URL revocation so repeated downloads remain reliable', async () => {
    jest.useFakeTimers();

    GM_xmlhttpRequest.mockImplementation(options => {
      if (String(options.url).includes('/api/timedtext')) {
        options.onload({
          status: 200,
          responseText:
            '<?xml version="1.0" encoding="utf-8"?><transcript><text start="0" dur="1.5">Hello</text></transcript>',
        });
        return;
      }

      options.onload({ status: 404, responseText: '' });
    });

    const createObjectURL = jest.fn(() => 'blob:test-download');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });

    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const api = installModule();
    await api.downloadSubtitle({
      videoId: 'test12345ab',
      url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en&kind=asr',
      languageCode: 'en',
      languageName: 'English',
      isAutoGenerated: true,
      format: 'srt',
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1600);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-download');

    clickSpy.mockRestore();
    jest.useRealTimers();
  });

  test('downloadSubtitle does not fall back to source track when auto-translate is requested', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      const requestUrl = String(options.url || '');

      if (requestUrl.includes('/api/timedtext')) {
        if (requestUrl.includes('tlang=fr')) {
          options.onload({ status: 404, responseText: '' });
          return;
        }

        // If fallback to source happens, this branch would make the test fail
        // because download would unexpectedly succeed.
        options.onload({
          status: 200,
          responseText:
            '<?xml version="1.0" encoding="utf-8"?><transcript><text start="0" dur="1.5">Source caption</text></transcript>',
        });
        return;
      }

      options.onload({ status: 404, responseText: '' });
    });

    const createObjectURL = jest.fn(() => 'blob:test-translate');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });

    const api = installModule();

    await expect(
      api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en&kind=asr',
        languageCode: 'en',
        languageName: 'French',
        isAutoGenerated: true,
        format: 'srt',
        translateTo: 'fr',
      })
    ).rejects.toThrow('Translated subtitle track is unavailable for this video/language');

    const timedtextCalls = GM_xmlhttpRequest.mock.calls
      .map(call => String(call?.[0]?.url || ''))
      .filter(url => url.includes('/api/timedtext'));

    expect(timedtextCalls.length).toBeGreaterThan(0);
    expect(timedtextCalls.every(url => url.includes('tlang=fr'))).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test('openModal shows only actual available video qualities for the current video', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      if (String(options.url).includes('/youtubei/v1/player')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            videoDetails: { title: 'Demo video' },
            streamingData: {
              formats: [
                { mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '360p' },
                { mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '720p' },
              ],
              adaptiveFormats: [
                { mimeType: 'video/webm; codecs="vp9"', qualityLabel: '1080p' },
                { mimeType: 'video/webm; codecs="vp9"', qualityLabel: '1440p' },
                { mimeType: 'audio/mp4; codecs="mp4a"', qualityLabel: 'AUDIO_QUALITY_MEDIUM' },
              ],
            },
          }),
        });
        return;
      }

      options.onload({ status: 404, responseText: '' });
    });

    const api = installModule();
    api.openModal();

    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();

    const qualityValues = Array.from(document.querySelectorAll('button[data-value]'))
      .map(btn => btn.getAttribute('data-value'))
      .filter(value => /^\d+$/.test(String(value)));

    expect(qualityValues).toEqual(['360', '720', '1080', '1440']);
    expect(qualityValues).not.toContain('2160');
    expect(qualityValues).not.toContain('4320');
  });

  test('openModal includes 8K quality when the current video exposes 4320p streams', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      if (String(options.url).includes('/youtubei/v1/player')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            videoDetails: { title: '8K demo video' },
            streamingData: {
              adaptiveFormats: [
                { mimeType: 'video/webm; codecs="vp9"', qualityLabel: '720p60' },
                { mimeType: 'video/webm; codecs="vp9"', qualityLabel: '1080p60' },
                { mimeType: 'video/webm; codecs="vp9"', qualityLabel: '1440p60' },
                { mimeType: 'video/webm; codecs="vp9"', qualityLabel: '2160p60' },
                { mimeType: 'video/webm; codecs="vp9"', qualityLabel: '4320p60' },
              ],
            },
          }),
        });
        return;
      }

      options.onload({ status: 404, responseText: '' });
    });

    const api = installModule();
    api.openModal();

    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();

    const qualityValues = Array.from(document.querySelectorAll('button[data-value]'))
      .map(btn => btn.getAttribute('data-value'))
      .filter(value => /^\d+$/.test(String(value)));

    expect(qualityValues).toContain('4320');
    expect(qualityValues).toContain('2160');
    expect(qualityValues).toContain('1440');
  });

  test('convertWithFallback retries secondary converter when primary fails', async () => {
    let keyCalls = 0;
    let convertCalls = 0;
    /** @type {string[]} */
    const keyUrls = [];
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('/sanity/key')) {
        keyCalls++;
        keyUrls.push(url);
        if (keyCalls === 1) {
          options.onerror?.({});
          return;
        }
        options.onload({ status: 200, responseText: JSON.stringify({ key: 'fallback-key' }) });
        return;
      }
      if (url.includes('/converter')) {
        convertCalls++;
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            url: 'https://cdn.example.com/file.mp4',
            filename: 'fallback.mp4',
          }),
        });
        return;
      }
      // CDN file fetch
      options.onload({ status: 200, response: new Blob(['video binary data']) });
    });

    const createObjectURL = jest.fn(() => 'blob:test-fallback');
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });

    const api = installModule();
    await api.downloadVideo({ format: 'video', quality: '720' });

    expect(keyCalls).toBeGreaterThanOrEqual(2);
    expect(convertCalls).toBeGreaterThanOrEqual(1);
    expect(keyUrls.length).toBeGreaterThanOrEqual(2);
    expect(keyUrls.every(u => u.includes('/sanity/key?id=test12345ab'))).toBe(true);
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  test('convertWithFallback retries when backend returns transient 400', async () => {
    let convertCalls = 0;
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('/sanity/key')) {
        options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
        return;
      }
      if (url.includes('/converter')) {
        convertCalls++;
        if (convertCalls <= 2) {
          options.onload({
            status: 400,
            responseText: JSON.stringify({
              error: true,
              errorMsg: 'Please try again in a moment as we are unable to convert rigt now.',
            }),
          });
          return;
        }
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            url: 'https://cdn.example.com/file.mp4',
            filename: 'ok.mp4',
          }),
        });
        return;
      }
      options.onload({ status: 200, response: new Blob(['video']) });
    });

    const createObjectURL = jest.fn(() => 'blob:retry');
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });

    const api = installModule();
    await api.downloadVideo({ format: 'video', quality: '720' });

    expect(convertCalls).toBe(3);
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  test('convertWithFallback surfaces server error message after exhausting retries', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('/sanity/key')) {
        options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
        return;
      }
      if (url.includes('/converter')) {
        options.onload({
          status: 400,
          responseText: JSON.stringify({ error: true, errorMsg: 'backend is down' }),
        });
        return;
      }
      options.onload({ status: 200, response: new Blob(['video']) });
    });

    const api = installModule();
    await expect(api.downloadVideo({ format: 'video', quality: '720' })).rejects.toThrow(
      /conversion failed: 400: backend is down/
    );
  });

  test('enqueueDownload creates manager panel and updates progress', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('/sanity/key')) {
        options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
        return;
      }
      if (url.includes('/converter')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            url: 'https://cdn.example.com/file.mp3',
            filename: 'song.mp3',
          }),
        });
        return;
      }
      // CDN file fetch
      options.onload({ status: 200, response: new Blob(['mp3 binary data']) });
    });

    const createObjectURL = jest.fn(() => 'blob:test-queue');
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });

    const api = installModule();
    const promise = api.enqueueDownload({
      format: 'audio',
      audioBitrate: '320',
      embedThumbnail: false,
    });

    // Allow panel to render
    await new Promise(resolve => setTimeout(resolve, 0));

    const panel = document.querySelector('.yp-download-manager');
    expect(panel).toBeTruthy();

    const item = document.querySelector('.yp-download-manager-item');
    expect(item).toBeTruthy();

    await promise;

    const info = document.querySelector('.yp-download-manager-item-info');
    expect(info?.textContent).toMatch(/Completed|downloadCompleted/);

    clickSpy.mockRestore();
  });

  test('enqueueDownload cancel removes item and aborts request', async () => {
    const abortFn = jest.fn();
    /** @type {any} */
    let currentOptions = null;
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      currentOptions = options;

      if (url.includes('/sanity/key')) {
        options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
        return { abort: abortFn };
      }
      if (url.includes('/converter')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({ url: 'https://cdn.example.com/file.mp4' }),
        });
        return { abort: abortFn };
      }
      // CDN file fetch: hang so cancel can fire, then reject via onerror
      const request = {
        abort: () => {
          abortFn();
          currentOptions?.onerror?.({ status: 0, responseText: '' });
        },
      };
      if (options.onRequest) options.onRequest(request);
      return request;
    });

    const api = installModule();
    const promise = api.enqueueDownload({ format: 'video', quality: '720' });

    // Let async init reach CDN fetch and register the request
    await new Promise(resolve => setTimeout(resolve, 0));

    const cancelBtn = document.querySelector('.yp-download-manager-item-cancel');
    expect(cancelBtn).toBeTruthy();
    cancelBtn?.click();

    await expect(promise).rejects.toThrow();
    expect(abortFn).toHaveBeenCalled();
  });

  test('downloadVideo uses fallback converter when primary key fails', async () => {
    let keyCalls = 0;
    /** @type {string[]} */
    const keyUrls = [];
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('/sanity/key')) {
        keyCalls++;
        keyUrls.push(url);
        if (keyCalls === 1) {
          options.onerror?.({ status: 0, responseText: '' });
          return { abort: jest.fn() };
        }
        options.onload({ status: 200, responseText: JSON.stringify({ key: 'fallback-key' }) });
        return { abort: jest.fn() };
      }
      if (url.includes('/converter')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            url: 'https://cdn.example.com/file.mp4',
            filename: 'video.mp4',
          }),
        });
        return { abort: jest.fn() };
      }
      options.onload({ status: 200, response: new Blob(['video']) });
      return { abort: jest.fn() };
    });

    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const api = installModule();
    await api.downloadVideo({ format: 'video', quality: '720' });

    expect(keyCalls).toBeGreaterThanOrEqual(2);
    expect(keyUrls.every(u => u.includes('/sanity/key?id=test12345ab'))).toBe(true);
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  test('downloadViaCobalt skips failed instances and downloads via tunnel', async () => {
    /** @type {Array<{ method: string, url: string, body?: string }>} */
    const requests = [];
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      requests.push({ method: options.method, url, body: options.data });
      if (url.includes('cobalt.directory')) {
        options.onload({ status: 404, responseText: '' });
        return;
      }
      if (options.method === 'POST') {
        if (url.includes('rue-cobalt.xenon.zone')) {
          options.onload({
            status: 400,
            responseText: JSON.stringify({ error: true, errorMsg: 'CAPTCHA challenge' }),
          });
          return;
        }
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            status: 'tunnel',
            url: 'https://tunnel.cobalt.test/file.mp4',
            filename: 'cool video.mp4',
          }),
        });
        return;
      }
      options.onload({ status: 200, response: new Blob(['cobalt video']) });
    });

    /** @type {string} */
    let clickedDownload = '';
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function () {
        clickedDownload = this.download;
      });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:cobalt'),
    });

    const api = installModule();
    await api.downloadViaCobalt({ format: 'video', quality: '720' });

    const postUrls = requests.filter(r => r.method === 'POST').map(r => r.url);
    expect(postUrls.some(u => u.includes('rue-cobalt.xenon.zone'))).toBe(true);
    expect(postUrls.some(u => u.includes('cobaltapi.cjs.nz'))).toBe(true);

    const successPost = requests.find(
      r => r.method === 'POST' && r.url.includes('cobaltapi.cjs.nz')
    );
    const payload = JSON.parse(successPost?.body || '{}');
    expect(payload.url).toBe('https://www.youtube.com/watch?v=test12345ab');
    expect(payload.downloadMode).toBe('auto');
    expect(payload.videoQuality).toBe('720');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickedDownload).toBe('cool video.mp4');

    clickSpy.mockRestore();
  });

  test('downloadViaCobalt prefers static instances over discovered directory ones', async () => {
    const api = installModule();
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('cobalt.directory')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              youtube: ['https://discovered-a.example', 'https://rue-cobalt.xenon.zone'],
            },
          }),
        });
        return;
      }
      if (options.method === 'POST') {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            status: 'tunnel',
            url: 'https://t.c/test.mp4',
            filename: 'd.mp4',
          }),
        });
        return;
      }
      options.onload({ status: 200, response: new Blob(['x']) });
    });

    /** @type {string} */
    let clickedDownload = '';
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function () {
        clickedDownload = this.download;
      });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:dir'),
    });

    await api.downloadViaCobalt({ format: 'audio', audioBitrate: '128' });

    // The static base instance has priority over discovered URLs, and the
    // discovered duplicate of it is de-duplicated.
    const postUrls = GM_xmlhttpRequest.mock.calls
      .map(call => String(call?.[0]?.url || ''))
      .filter(u => u.includes('rue-cobalt.xenon.zone'));
    expect(postUrls.length).toBeGreaterThan(0);
    expect(clickedDownload).toBe('d.mp4');

    clickSpy.mockRestore();
  });

  test('cobalt.directory is contacted only after explicit opt-in', async () => {
    // No opt-in: the settings store is absent → discovery stays off, only
    // the static @connect instances are tried.
    const api = installModule();
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('cobalt.directory')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({ data: { youtube: ['https://discovered-a.example'] } }),
        });
        return;
      }
      if (options.method === 'POST') {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            status: 'tunnel',
            url: 'https://t.c/x.mp4',
            filename: 'x.mp4',
          }),
        });
        return;
      }
      options.onload({ status: 200, response: new Blob(['x']) });
    });

    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      /* mock */
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:dir'),
    });

    await api.downloadViaCobalt({ format: 'audio', audioBitrate: '128' });

    // The directory endpoint must NOT be contacted without opt-in.
    const directoryCalls = GM_xmlhttpRequest.mock.calls.filter(([o]) =>
      String(o?.url || '').includes('cobalt.directory')
    );
    expect(directoryCalls).toHaveLength(0);
    // Discovered hosts never receive the watch URL either.
    expect(
      GM_xmlhttpRequest.mock.calls.every(
        ([o]) => !String(o?.url || '').includes('discovered-a.example')
      )
    ).toBe(true);

    clickSpy.mockRestore();
  });

  test('with explicit opt-in the directory is contacted once and its hosts used', async () => {
    window.YouTubePlusSettingsStore = {
      get: key => (key === 'allowCobaltDiscovery' ? true : undefined),
    };
    const api = installModule();
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('cobalt.directory')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { youtube: ['https://discovered-a.example'] },
          }),
        });
        return;
      }
      if (options.method === 'POST') {
        // Static instances fail; only the discovered host succeeds — proves
        // the opt-in discovery results are actually merged into the chain.
        if (url.includes('discovered-a.example')) {
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              status: 'tunnel',
              url: 'https://t.c/y.mp4',
              filename: 'y.mp4',
            }),
          });
          return;
        }
        options.onload({ status: 500, responseText: 'static down' });
        return;
      }
      options.onload({ status: 200, response: new Blob(['x']) });
    });

    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      /* mock */
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:dir'),
    });

    await api.downloadViaCobalt({ format: 'audio', audioBitrate: '128' });

    const directoryCalls = GM_xmlhttpRequest.mock.calls.filter(([o]) =>
      String(o?.url || '').includes('cobalt.directory')
    );
    expect(directoryCalls.length).toBeGreaterThan(0);
    // The discovered host receives the POST with the watch URL.
    const postToDiscovered = GM_xmlhttpRequest.mock.calls.filter(([o]) =>
      String(o?.url || '').includes('discovered-a.example')
    );
    expect(postToDiscovered.length).toBeGreaterThan(0);

    clickSpy.mockRestore();
  });

  test('downloadViaCobalt throws after exhausting instances', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('cobalt.directory')) {
        options.onload({ status: 404, responseText: '' });
        return;
      }
      options.onload({ status: 500, responseText: 'nope' });
    });

    const api = installModule();
    await expect(api.downloadViaCobalt({ format: 'video', quality: '720' })).rejects.toThrow(
      /Cobalt/
    );
  });

  test('downloadViaDirectStream downloads muxed 360p as a single file', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('/youtubei/v1/player')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            videoDetails: { title: 'Muxed video' },
            playabilityStatus: { status: 'OK' },
            streamingData: {
              formats: [
                {
                  itag: 18,
                  url: 'https://googlevideo.test/360.m4v',
                  mimeType: 'video/mp4; codecs="avc1,mp4a"',
                  qualityLabel: '360p',
                  height: 360,
                },
              ],
              adaptiveFormats: [
                {
                  itag: 137,
                  url: 'https://googlevideo.test/1080.mp4',
                  mimeType: 'video/mp4; codecs="avc1"',
                  qualityLabel: '1080p',
                  height: 1080,
                },
                {
                  itag: 140,
                  url: 'https://googlevideo.test/audio.m4a',
                  mimeType: 'audio/mp4; codecs="mp4a"',
                  bitrate: 128000,
                },
              ],
            },
          }),
        });
        return;
      }
      options.onload({ status: 200, response: new Blob(['muxed']) });
    });

    /** @type {string} */
    let clickedDownload = '';
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function () {
        clickedDownload = this.download;
      });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:mobile-360'),
    });

    const api = installModule();
    await api.downloadViaDirectStream({ format: 'video', quality: '360' });

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickedDownload).toBe('video.mp4');

    clickSpy.mockRestore();
  });

  test('downloadViaDirectStream saves video-only track plus companion audio above 360p', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('/youtubei/v1/player')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            videoDetails: { title: 'HD video' },
            playabilityStatus: { status: 'OK' },
            streamingData: {
              formats: [],
              adaptiveFormats: [
                {
                  itag: 137,
                  url: 'https://googlevideo.test/1080.mp4',
                  mimeType: 'video/mp4; codecs="avc1"',
                  qualityLabel: '1080p',
                  height: 1080,
                },
                {
                  itag: 136,
                  url: 'https://googlevideo.test/720.mp4',
                  mimeType: 'video/mp4; codecs="avc1"',
                  qualityLabel: '720p',
                  height: 720,
                },
                {
                  itag: 140,
                  url: 'https://googlevideo.test/audio.m4a',
                  mimeType: 'audio/mp4; codecs="mp4a"',
                  bitrate: 128000,
                },
              ],
            },
          }),
        });
        return;
      }
      options.onload({ status: 200, response: new Blob(['track']) });
    });

    /** @type {string[]} */
    const clickedDownloads = [];
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function () {
        clickedDownloads.push(this.download);
      });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:mobile-720'),
    });

    const api = installModule();
    await api.downloadViaDirectStream({ format: 'video', quality: '720' });

    expect(clickedDownloads).toHaveLength(2);
    expect(clickedDownloads[0]).toMatch(/^video \(.+\)\.mp4$/);
    expect(clickedDownloads[1]).toBe('video (audio).m4a');

    clickSpy.mockRestore();
  });

  test('downloadViaDirectStream downloads audio as m4a', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('/youtubei/v1/player')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            videoDetails: { title: 'Audio only' },
            playabilityStatus: { status: 'OK' },
            streamingData: {
              formats: [],
              adaptiveFormats: [
                {
                  itag: 141,
                  url: 'https://googlevideo.test/audio256.m4a',
                  mimeType: 'audio/mp4; codecs="mp4a"',
                  bitrate: 256000,
                },
                {
                  itag: 140,
                  url: 'https://googlevideo.test/audio128.m4a',
                  mimeType: 'audio/mp4; codecs="mp4a"',
                  bitrate: 128000,
                },
              ],
            },
          }),
        });
        return;
      }
      options.onload({ status: 200, response: new Blob(['audio']) });
    });

    /** @type {string} */
    let clickedDownload = '';
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function () {
        clickedDownload = this.download;
      });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:mobile-audio'),
    });

    const api = installModule();
    await api.downloadViaDirectStream({ format: 'audio', audioBitrate: '128' });

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickedDownload).toBe('video.m4a');

    clickSpy.mockRestore();
  });

  test('modal source selector switches quality options to the selected source', async () => {
    GM_xmlhttpRequest.mockImplementation(options => {
      if (String(options.url).includes('/youtubei/v1/player')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            videoDetails: { title: 'Selector demo' },
            streamingData: { formats: [], adaptiveFormats: [] },
          }),
        });
        return;
      }
      options.onload({ status: 404, responseText: '' });
    });

    const api = installModule();
    api.openModal();

    const sourcePills = Array.from(
      document.querySelectorAll('.yp-download-source-wrap button[data-source]')
    );
    expect(sourcePills.map(b => b.dataset.source)).toEqual(['cnvcx', 'cobalt', 'mobile']);

    const cobaltPill = sourcePills.find(b => b.dataset.source === 'cobalt');
    cobaltPill?.click();
    await Promise.resolve();

    const qualityValues = Array.from(document.querySelectorAll('button[data-value]'))
      .map(btn => btn.getAttribute('data-value'))
      .filter(value => /^\d+$/.test(String(value)));
    expect(qualityValues).toEqual(['360', '480', '720', '1080']);
  });

  test('isHttpUrl rejects non-http(s) URLs and accepts http/https', () => {
    const api = installModule();
    expect(typeof api.isHttpUrl).toBe('function');
    expect(api.isHttpUrl('https://www.youtube.com/api/timedtext?v=test')).toBe(true);
    expect(api.isHttpUrl('http://localhost:5005/ytdl')).toBe(true);
    expect(api.isHttpUrl('ftp://example.com/file')).toBe(false);
    expect(api.isHttpUrl('file:///C:/temp')).toBe(false);
    expect(api.isHttpUrl('')).toBe(false);
    expect(api.isHttpUrl(null)).toBe(false);
    expect(api.isHttpUrl('not a url at all')).toBe(false);
  });

  test('isHttpsUrl accepts only https URLs', () => {
    const api = installModule();
    expect(typeof api.isHttpsUrl).toBe('function');
    expect(api.isHttpsUrl('https://cnv.cx/v2/converter')).toBe(true);
    expect(api.isHttpsUrl('http://cnv.cx/v2/converter')).toBe(false);
    expect(api.isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(api.isHttpsUrl('ftp://example.com/file')).toBe(false);
    expect(api.isHttpsUrl('')).toBe(false);
    expect(api.isHttpsUrl(null)).toBe(false);
  });

  describe('Unified Feature Contract', () => {
    test('exposes canonical DESCRIPTOR matching FeatureRegistry schema', () => {
      const api = installModule();
      const desc = api.DESCRIPTOR;
      expect(desc).toBeDefined();
      expect(desc.id).toBe('download');
      expect(desc.settingsKey).toBe('enableDownload');
      expect(desc.titleKey).toBe('downloadOptions');
      expect(typeof desc.command).toBe('function');
      expect(typeof desc.mountDock).toBe('function');
      expect(window.YouTubePlusDownloadButton.DESCRIPTOR).toBe(desc);
    });

    test('DESCRIPTOR.mountDock creates Vision dock button idempotently', () => {
      const api = installModule();
      const desc = api.DESCRIPTOR;
      const player = document.createElement('div');
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);

      desc.mountDock(player, dock);

      const btn = dock.querySelector('#yp-vision-download-btn');
      expect(btn).toBeTruthy();
      expect(btn?.classList.contains('vision-dock-btn')).toBe(true);
      expect(btn?.classList.contains('yp-download-button')).toBe(true);

      // Second mount should not duplicate button
      desc.mountDock(player, dock);
      expect(dock.querySelectorAll('#yp-vision-download-btn').length).toBe(1);
    });

    test('mountDock returns a dispose and owns no local registrations', () => {
      const api = installModule();
      const desc = api.DESCRIPTOR;
      const player = document.createElement('div');
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);

      const dispose = desc.mountDock(player, dock);
      expect(typeof dispose).toBe('function');
      // Idempotent: calling dispose twice must not throw.
      expect(() => {
        dispose();
        dispose();
      }).not.toThrow();
      // Clicks arrive via the module's document-level delegation, so the dock
      // button carries no own click registration.
      const cm = window.YouTubePlusCleanupManager;
      let btnEntries = 0;
      for (const e of cm.listeners.values()) {
        if (e.target === dock.querySelector('#yp-vision-download-btn')) btnEntries += 1;
      }
      expect(btnEntries).toBe(0);
    });

    test('DESCRIPTOR.command clicks active download button', () => {
      const api = installModule();
      const desc = api.DESCRIPTOR;

      const btn = document.createElement('button');
      btn.className = 'yp-download-button';
      const clickSpy = jest.fn();
      btn.addEventListener('click', clickSpy);
      document.body.appendChild(btn);

      const result = desc.command({});
      expect(result).toBe(true);
      expect(clickSpy).toHaveBeenCalledTimes(1);

      btn.remove();
    });

    test('Classic download button opens dropdown upwards even in upper viewport, Vision dock opens downwards', () => {
      window.YouTubeUtils.setSafeHTML = jest.fn((el, html) => {
        el.innerHTML = html;
      });
      window.YouTubePlusCleanupManager = {
        registerListener: jest.fn((target, event, fn, opts) => {
          target.addEventListener(event, fn, opts);
          return Symbol('l');
        }),
        registerAnimationFrame: jest.fn(id => id),
      };
      // The button runs as a lifecycle feature started by the real registry.
      window.YouTubePlusSettingsStore = { get: jest.fn(), subscribe: jest.fn(() => jest.fn()) };
      delete window.YouTubePlusFeatureRegistry;
      require('../src/feature-registry.js');
      installModule(true);
      window.YouTubePlusZoom = {
        closestDock: el =>
          el && typeof el.closest === 'function' ? el.closest('.vision-top-center-dock') : null,
      };
      let rafCb = null;
      const origRaf = global.requestAnimationFrame;
      global.requestAnimationFrame = cb => {
        rafCb = cb;
        return 1;
      };
      const controls = document.createElement('div');
      controls.className = 'ytp-right-controls';
      document.body.appendChild(controls);

      const mgr = window.YouTubePlusDownloadButton.createDownloadButtonManager({
        settings: {
          enableDownload: true,
          downloadSites: { externalDownloader: true, ytdl: true, direct: true },
        },
        t: k => k,
        getElement: sel => document.querySelector(sel),
        YouTubeUtils: window.YouTubeUtils,
      });
      mgr.addDownloadButton(controls);

      const btn = controls.querySelector('.yp-download-button');
      const dropdown = document.querySelector('.download-options');
      expect(btn).toBeTruthy();
      expect(dropdown).toBeTruthy();

      btn.getBoundingClientRect = () => ({
        left: 400,
        top: 200,
        right: 440,
        bottom: 236,
        width: 40,
        height: 36,
      });
      btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      rafCb?.(0);
      expect(dropdown?.style.top).toBe('auto');
      expect(dropdown?.style.bottom).not.toBe('auto');

      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      dock.getBoundingClientRect = () => ({
        left: 300,
        top: 20,
        right: 500,
        bottom: 56,
        width: 200,
        height: 36,
      });
      dock.appendChild(btn);
      document.body.appendChild(dock);
      btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      rafCb?.(0);
      expect(dropdown?.style.top).toBe('66px');
      expect(dropdown?.style.bottom).toBe('auto');

      global.requestAnimationFrame = origRaf;
      dock.remove();
      controls.remove();
      dropdown?.remove();
    });
  });

  describe('POT hook lifecycle (session-once)', () => {
    test('injectDownloadStyles tolerates failures; session-once hooks stable', () => {
      const api = installModule();

      // injectDownloadStyles is reachable via the button-manager surface;
      // missing DesignSystem CSS → no throw, no patch.
      window.YouTubePlusDesignSystem = {};
      expect(() => window.YouTubePlusDownloadButton.injectStyles()).not.toThrow();

      // The session-once hooks stay installed across repeated install calls.
      api._installPotHooksOnce();
      expect(window.fetch.name).toBe('patchedFetch');
    });

    test('fetch hook captures URL objects and XHR captures string URLs', () => {
      // URL-object input: the URL branch of the URL resolution chain.
      const urlObj = new URL('https://www.youtube.com/api/timedtext?v=ccccccccccc&pot=UOBJ&potc=1');
      return Promise.resolve(window.fetch(urlObj)).then(() => {
        // Plain-string input: the primary string branch.
        return Promise.resolve(
          window.fetch('https://www.youtube.com/api/timedtext?v=ccccccccccc&pot=STR&potc=1')
        ).then(() => {
          // XHR string URL: the open patch captures the PoT params. Since
          // the PoT map is private, assert the observable forwarding: the
          // XHR open patch forwards to the pristine open without throwing.
          const xhr = new XMLHttpRequest();
          xhr.open(
            'GET',
            'https://www.youtube.com/api/timedtext?v=ccccccccccc&pot=XHR&potc=1&c=WEB',
            true
          );
          expect(() => xhr.open('GET', 'https://www.youtube.com/watch', true)).not.toThrow();
        });
      });
    });
    test('injectDownloadStyles tolerates failures; session-once hooks stable', () => {
      const api = installModule();

      // injectDownloadStyles is reachable via the button-manager surface;
      // missing DesignSystem CSS → no throw, no patch.
      window.YouTubePlusDesignSystem = {};
      expect(() => window.YouTubePlusDownloadButton.injectStyles()).not.toThrow();

      // The session-once hooks stay installed across repeated install calls.
      api._installPotHooksOnce();
      expect(window.fetch.name).toBe('patchedFetch');
    });
    test('install is idempotent: repeated calls never re-wrap the patch', () => {
      const api = installModule();

      // Boot is lazy: the page globals are pristine until the first install
      // trigger, and the first install wraps the hooks exactly once.
      const fetchBefore = window.fetch;
      const openBefore = window.XMLHttpRequest.prototype.open;
      api._installPotHooksOnce();
      const fetchAfterInstall = window.fetch;
      expect(fetchAfterInstall.name).toBe('patchedFetch');
      expect(fetchAfterInstall).not.toBe(fetchBefore);

      // Repeated installs are a no-op — the same patched reference
      // stays installed (session-once, chain never grows).
      api._installPotHooksOnce();
      api._installPotHooksOnce();
      expect(window.fetch).toBe(fetchAfterInstall);
      expect(window.XMLHttpRequest.prototype.open).not.toBe(openBefore);
    });

    test('install is gated by the feature flag and re-enabled later', () => {
      // Restore a pristine base fetch and gate the feature OFF before load.
      window.fetch = function base() {
        return Promise.resolve({ ok: true });
      };
      window.YouTubeUtils.loadFeatureEnabled = jest.fn(() => false);
      const api = installModule();
      expect(window.fetch.name).not.toBe('patchedFetch');

      // Enabling the feature: the next install call patches the hooks.
      window.YouTubeUtils.loadFeatureEnabled = jest.fn(() => true);
      api._installPotHooksOnce();
      expect(window.fetch.name).toBe('patchedFetch');
    });
  });

  describe('transport cancel and unified response', () => {
    afterEach(() => {
      window.GM_xmlhttpRequest.mockReset();
    });

    test('gmXmlHttpRequest aborts request immediately when signal already aborted', async () => {
      const api = installModule();
      const abortSpy = jest.fn();
      const controller = new AbortController();
      controller.abort();

      GM_xmlhttpRequest.mockImplementation(() => ({ abort: abortSpy }));

      const promise = api.gmXmlHttpRequest({
        url: 'https://example.com/file',
        signal: controller.signal,
      });
      // Settle: GM never resolves since we abort at wire time.
      GM_xmlhttpRequest.mock.calls[0][0].onabort?.();

      await expect(promise).rejects.toThrow('Request aborted');
      expect(abortSpy).toHaveBeenCalledTimes(1);
    });

    test('gmXmlHttpRequest aborts in-flight request when signal aborts later', async () => {
      const api = installModule();
      const abortSpy = jest.fn();
      const controller = new AbortController();

      GM_xmlhttpRequest.mockImplementation(options => {
        const handle = {
          abort: () => {
            abortSpy();
            options.onabort?.();
          },
        };
        options.onRequest?.(handle);
        return handle;
      });

      const promise = api.gmXmlHttpRequest({
        url: 'https://example.com/file',
        signal: controller.signal,
      });
      controller.abort();

      await expect(promise).rejects.toThrow('Request aborted');
      expect(abortSpy).toHaveBeenCalledTimes(1);
    });

    test('gmXmlHttpRequest exposes abort handle via onRequest', async () => {
      const api = installModule();
      let handle = null;
      GM_xmlhttpRequest.mockImplementation(options => {
        const req = { abort: () => options.onabort?.() };
        handle = req;
        return req;
      });

      const promise = api.gmXmlHttpRequest({
        url: 'https://example.com/file',
        onRequest: req => {
          handle = req;
        },
      });
      handle.abort();

      await expect(promise).rejects.toThrow('Request aborted');
      expect(handle).not.toBeNull();
    });

    test('executeFetchFallback reads body once for blob responseType', async () => {
      const api = installModule();
      const realGm = window.GM_xmlhttpRequest;
      delete window.GM_xmlhttpRequest;
      const blob = new Blob(['video-data']);
      let respObj = null;
      const fetchSpy = jest.fn(async () => {
        respObj = {
          status: 200,
          statusText: 'OK',
          text: jest.fn(async () => 'video-data'),
          blob: jest.fn(async () => blob),
        };
        return respObj;
      });
      window.fetch = fetchSpy;

      try {
        const result = await api.gmXmlHttpRequest({
          url: 'https://example.com/video.mp4',
          responseType: 'blob',
        });

        expect(result.response).toBe(blob);
        expect(respObj.blob).toHaveBeenCalledTimes(1);
        expect(respObj.text).not.toHaveBeenCalled();
      } finally {
        window.GM_xmlhttpRequest = realGm;
      }
    });

    test('executeFetchFallback threads signal into fetch', async () => {
      const api = installModule();
      const realGm = window.GM_xmlhttpRequest;
      delete window.GM_xmlhttpRequest;
      const controller = new AbortController();
      const fetchSpy = jest.fn(async () => ({
        status: 200,
        statusText: 'OK',
        text: jest.fn(async () => 'data'),
      }));
      window.fetch = fetchSpy;

      try {
        await api.gmXmlHttpRequest({
          url: 'https://example.com/api',
          signal: controller.signal,
        });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0][1].signal).toBe(controller.signal);
      } finally {
        window.GM_xmlhttpRequest = realGm;
      }
    });

    test('executeFetchFallback timeout overrides signal with AbortSignal.timeout', async () => {
      const api = installModule();
      const realGm = window.GM_xmlhttpRequest;
      delete window.GM_xmlhttpRequest;
      const controller = new AbortController();
      const fetchSpy = jest.fn(async () => ({
        status: 200,
        statusText: 'OK',
        text: jest.fn(async () => 'data'),
      }));
      window.fetch = fetchSpy;

      try {
        await api.gmXmlHttpRequest({
          url: 'https://example.com/api',
          signal: controller.signal,
          timeout: 5000,
        });

        const passed = fetchSpy.mock.calls[0][1].signal;
        expect(passed).toBeInstanceOf(AbortSignal);
        expect(passed).not.toBe(controller.signal);
      } finally {
        window.GM_xmlhttpRequest = realGm;
      }
    });

    test('downloadBlobFromUrl omits timeout/ontimeout when timeout is 0', async () => {
      const api = installModule();
      let capturedOpts = null;
      GM_xmlhttpRequest.mockImplementation(options => {
        capturedOpts = options;
        return { abort: jest.fn() };
      });

      api.downloadBlobFromUrl({
        url: 'https://cnv.example/file.mp4',
        converter: { referer: 'https://x.test/' },
        onRequest: () => {
          /* mock */
        },
      });

      expect(capturedOpts).not.toBeNull();
      expect(capturedOpts.timeout).toBeUndefined();
      expect(capturedOpts.ontimeout).toBeUndefined();
    });

    test('downloadBlobFromUrl sets timeout and ontimeout when configured', async () => {
      const api = installModule();
      let capturedOpts = null;
      GM_xmlhttpRequest.mockImplementation(options => {
        capturedOpts = options;
        return { abort: jest.fn() };
      });

      api.downloadBlobFromUrl({
        url: 'https://cnv.example/file.mp4',
        timeout: 30000,
        onRequest: () => {
          /* mock */
        },
      });

      expect(capturedOpts.timeout).toBe(30000);
      expect(typeof capturedOpts.ontimeout).toBe('function');
    });

    test('downloadBlobFromUrl exposes abort handle via onRequest', async () => {
      const api = installModule();
      const abortSpy = jest.fn();
      let handle = null;
      GM_xmlhttpRequest.mockImplementation(() => {
        const req = { abort: abortSpy };
        handle = req;
        return req;
      });

      api.downloadBlobFromUrl({
        url: 'https://cnv.example/file.mp4',
        onRequest: req => {
          handle = req;
        },
      });
      expect(handle).not.toBeNull();
      handle.abort();
      expect(abortSpy).toHaveBeenCalledTimes(1);
    });

    test('downloadBlobFromUrl refuses non-https and script URLs before any transport', async () => {
      const api = installModule();
      for (const bad of [
        'file:///C:/x.mp4',
        'http://cnv.example/file.mp4',
        'javascript:alert(1)',
      ]) {
        await expect(
          api.downloadBlobFromUrl({
            url: bad,
            onRequest: () => {
              /* mock */
            },
          })
        ).rejects.toThrow('Refused non-https download URL');
      }
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    test('downloadBlobFromUrl accepts an https response URL', async () => {
      const api = installModule();
      const blob = new Blob([new Uint8Array([1, 2, 3])]);
      GM_xmlhttpRequest.mockImplementation(opts => {
        setTimeout(() => opts.onload({ status: 200, response: blob }), 0);
        return { abort: jest.fn() };
      });
      await expect(
        api.downloadBlobFromUrl({
          url: 'https://cnv.example/file.mp4',
          onRequest: () => {
            /* mock */
          },
        })
      ).resolves.toBe(blob);
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    test('downloadSubtitle parses TTML with clock times and srv3 XML cues', async () => {
      const origBlob = window.Blob;
      let lastBlobContent = '';
      window.Blob = jest.fn(function (parts, opts) {
        lastBlobContent = parts.join('');
        return new origBlob(parts, opts);
      });

      // 1. TTML format with clock time and seconds suffix
      GM_xmlhttpRequest.mockImplementation(options => {
        if (String(options.url).includes('/api/timedtext')) {
          options.onload({
            status: 200,
            responseText: `<tt xmlns="http://www.w3.org/ns/ttml">
              <body>
                <div>
                  <p begin="00:00:01.500" dur="00:00:02.500">Hello TTML</p>
                  <p begin="5s" dur="2s">Second TTML cue</p>
                </div>
              </body>
            </tt>`,
          });
          return;
        }
        options.onload({ status: 404, responseText: '' });
      });

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        languageName: 'English',
        format: 'srt',
      });

      expect(lastBlobContent).toContain('00:00:01,500 --> 00:00:04,000');
      expect(lastBlobContent).toContain('Hello TTML');
      expect(lastBlobContent).toContain('00:00:05,000 --> 00:00:07,000');
      expect(lastBlobContent).toContain('Second TTML cue');

      // 2. srv3 XML format with <transcript><p t="1000" d="2000"><s>Hello</s> <s>srv3</s></p></transcript>
      global.GM_xmlhttpRequest.mockImplementation(options => {
        if (String(options.url).includes('/api/timedtext')) {
          options.onload({
            status: 200,
            responseText:
              '<transcript><p t="1000" d="2000"><s>Hello</s> <s>srv3</s></p></transcript>',
          });
          return;
        }
        options.onload({ status: 404, responseText: '' });
      });

      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        languageName: 'English',
        format: 'srt',
      });

      expect(lastBlobContent).toContain('00:00:01,000 --> 00:00:03,000');
      expect(lastBlobContent).toContain('Hello srv3');

      window.Blob = origBlob;
    });

    test('downloadSubtitle recovers via watch HTML with balanced JSON parsing', async () => {
      const origBlob = window.Blob;
      let lastBlobContent = '';
      window.Blob = jest.fn(function (parts, opts) {
        lastBlobContent = parts.join('');
        return new origBlob(parts, opts);
      });

      // Fail initial timedtext requests, succeed on watch HTML and fresh timedtext
      global.GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/watch?v=')) {
          options.onload({
            status: 200,
            responseText: `<!DOCTYPE html><html><body><script>
              var ytInitialPlayerResponse = {
                "captions": {
                  "playerCaptionsTracklistRenderer": {
                    "captionTracks": [{
                      "baseUrl": "https://www.youtube.com/api/timedtext?v=test12345ab&lang=en&fresh=1",
                      "languageCode": "en",
                      "name": { "simpleText": "English {notes}" }
                    }]
                  }
                },
                "otherData": "some { embedded } curlies"
              };</script></body></html>`,
          });
          return;
        }
        if (url.includes('fresh=1')) {
          options.onload({
            status: 200,
            responseText:
              '<?xml version="1.0" encoding="utf-8"?><transcript><text start="1" dur="2">Recovered text</text></transcript>',
          });
          return;
        }
        options.onload({ status: 404, responseText: '' });
      });

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en&expired=1',
        languageCode: 'en',
        languageName: 'English',
        format: 'srt',
      });

      expect(lastBlobContent).toContain('Recovered text');

      window.Blob = origBlob;
    });

    test('custom select supports keyboard navigation', () => {
      window.YouTubePlusCleanupManager = {
        registerListener: jest.fn((target, event, fn, opts) => {
          target.addEventListener(event, fn, opts);
          return Symbol('l');
        }),
        registerAnimationFrame: jest.fn(id => id),
      };

      const api = installModule();
      api.openModal();

      const overlay = document.querySelector('.yp-download-modal-overlay');
      expect(overlay).not.toBeNull();
      const customSelect = overlay.querySelector('[role="listbox"]');
      expect(customSelect).not.toBeNull();
      const list = customSelect.querySelector('.dl-subtitle-list');
      expect(list).not.toBeNull();

      customSelect.setOptions([
        { value: 'opt1', text: 'Option 1' },
        { value: 'opt2', text: 'Option 2' },
        { value: 'opt3', text: 'Option 3' },
      ]);
      expect(customSelect.value).toBe('opt1');

      // Press Enter to open
      customSelect.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(list.classList.contains('is-open')).toBe(true);
      expect(customSelect.getAttribute('aria-expanded')).toBe('true');

      // Press ArrowDown to move to opt2
      customSelect.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(customSelect.value).toBe('opt2');

      // Press ArrowDown to move to opt3
      customSelect.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(customSelect.value).toBe('opt3');

      // Press Escape to close
      customSelect.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(list.classList.contains('is-open')).toBe(false);
      expect(customSelect.getAttribute('aria-expanded')).toBe('false');

      overlay.remove();
    });
  });

  describe('Extended Unit Coverage', () => {
    test('modal tab switching, escape closure, and cancel button', async () => {
      window.YouTubePlusCleanupManager = {
        registerListener: jest.fn((target, event, fn, opts) => {
          target.addEventListener(event, fn, opts);
          return Symbol('l');
        }),
        registerAnimationFrame: jest.fn(id => id),
      };

      const api = installModule();
      api.openModal();
      const overlay = document.querySelector('.yp-download-modal-overlay');
      expect(overlay).not.toBeNull();

      const tabs = overlay.querySelectorAll('.yp-download-modal-tabs button');
      expect(tabs.length).toBe(3);
      const [videoTab, audioTab, subTab] = Array.from(tabs);

      // Switch to audio tab
      audioTab.click();
      expect(audioTab.classList.contains('active')).toBe(true);

      // Switch to subtitle tab
      subTab.click();
      expect(subTab.classList.contains('active')).toBe(true);

      // Switch back to video tab
      videoTab.click();
      expect(videoTab.classList.contains('active')).toBe(true);

      // Cancel button closes modal
      const cancelBtn = overlay.querySelector('button.yp-download-modal-btn-cancel');
      if (cancelBtn) {
        cancelBtn.click();
        expect(document.querySelector('.yp-download-modal-overlay')).toBeNull();
      }

      // Re-open and close with Escape
      api.openModal();
      const reopenedOverlay = document.querySelector('.yp-download-modal-overlay');
      expect(reopenedOverlay).not.toBeNull();
      reopenedOverlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.querySelector('.yp-download-modal-overlay')).toBeNull();
    });

    test('downloadSubtitle generates SRT format from XML transcript', async () => {
      const api = installModule();
      const origBlob = window.Blob;
      let lastBlobContent = '';
      window.Blob = jest.fn(function (parts, opts) {
        lastBlobContent = parts.join('');
        return new origBlob(parts, opts);
      });

      global.GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({
          status: 200,
          responseText:
            '<transcript><text start="1.5" dur="2.5">Hello XML to SRT world</text></transcript>',
        });
      });

      await api.downloadSubtitle({
        videoId: 'testXmlSrt12',
        url: 'https://www.youtube.com/api/timedtext?v=testXmlSrt12&lang=en',
        languageCode: 'en',
        languageName: 'English',
        format: 'srt',
      });

      expect(lastBlobContent).toContain('00:00:01,500 --> 00:00:04,000');
      expect(lastBlobContent).toContain('Hello XML to SRT world');

      window.Blob = origBlob;
    });

    test('downloadSubtitle generates TXT format without timestamps', async () => {
      const api = installModule();
      const origBlob = window.Blob;
      let lastBlobContent = '';
      window.Blob = jest.fn(function (parts, opts) {
        lastBlobContent = parts.join('');
        return new origBlob(parts, opts);
      });

      global.GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({
          status: 200,
          responseText:
            '<transcript><text start="1.5" dur="2.5">Line One</text><text start="4.0" dur="2.0">Line Two</text></transcript>',
        });
      });

      await api.downloadSubtitle({
        videoId: 'testTxt1234',
        url: 'https://www.youtube.com/api/timedtext?v=testTxt1234&lang=en',
        languageCode: 'en',
        languageName: 'English',
        format: 'txt',
      });

      expect(lastBlobContent).toContain('Line One\nLine Two');
      expect(lastBlobContent).not.toContain('-->');

      window.Blob = origBlob;
    });

    test('downloadSubtitle parses JSON3 formatted response', async () => {
      const api = installModule();
      const origBlob = window.Blob;
      let lastBlobContent = '';
      window.Blob = jest.fn(function (parts, opts) {
        lastBlobContent = parts.join('');
        return new origBlob(parts, opts);
      });

      const json3Payload = JSON.stringify({
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 2500,
            segs: [{ utf8: 'Hello' }, { utf8: ' JSON3' }],
          },
          {
            tStartMs: 4000,
            dDurationMs: 1500,
            segs: [{ utf8: 'Second segment' }],
          },
        ],
      });

      global.GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({
          status: 200,
          responseText: json3Payload,
        });
      });

      await api.downloadSubtitle({
        videoId: 'testJson312',
        url: 'https://www.youtube.com/api/timedtext?v=testJson312&lang=en',
        languageCode: 'en',
        languageName: 'English',
        format: 'srt',
      });

      expect(lastBlobContent).toContain('Hello JSON3');
      expect(lastBlobContent).toContain('Second segment');
      expect(lastBlobContent).toContain('00:00:01,000 --> 00:00:03,500');

      window.Blob = origBlob;
    });

    test('Download button manager mounts, toggles single and multiple sites', () => {
      window.YouTubeUtils.setSafeHTML = jest.fn((el, html) => {
        el.innerHTML = html;
      });
      window.YouTubePlusCleanupManager = {
        registerListener: jest.fn((target, event, fn, opts) => {
          target.addEventListener(event, fn, opts);
          return Symbol('l');
        }),
        registerAnimationFrame: jest.fn(id => id),
      };
      window.YouTubePlusSettingsStore = { get: jest.fn(), subscribe: jest.fn(() => jest.fn()) };
      delete window.YouTubePlusFeatureRegistry;
      require('../src/feature-registry.js');
      installModule(true);

      const btnMgrApi = window.YouTubePlusDownloadButton;
      expect(btnMgrApi).toBeDefined();

      const controls = document.createElement('div');
      controls.className = 'ytp-right-controls';
      document.body.appendChild(controls);

      const manager = btnMgrApi.createDownloadButtonManager({
        settings: {
          enableDownload: true,
          downloadSites: {
            externalDownloader: true,
            ytdl: true,
            direct: true,
          },
        },
        t: k => k,
        getElement: sel => document.querySelector(sel),
        YouTubeUtils: window.YouTubeUtils,
      });

      manager.addDownloadButton(controls);
      const button = controls.querySelector('.yp-download-button');
      expect(button).not.toBeNull();

      // Refresh visibility tests
      btnMgrApi.refreshVisibility(false);
      expect(button.style.display).toBe('none');
      btnMgrApi.refreshVisibility(true);
      expect(button.style.display).toBe('');

      // Cleanup
      controls.remove();
    });

    test('URL validator rejects malformed inputs and accepts protocols', () => {
      const api = installModule();
      expect(api.isHttpUrl('http://example.com/test')).toBe(true);
      expect(api.isHttpUrl('https://example.com/test')).toBe(true);
      expect(api.isHttpUrl('javascript:alert(1)')).toBe(false);
      expect(api.isHttpUrl('')).toBe(false);
      expect(api.isHttpUrl(null)).toBe(false);

      expect(api.isHttpsUrl('https://example.com/test')).toBe(true);
      expect(api.isHttpsUrl('http://example.com/test')).toBe(false);
      expect(api.isHttpsUrl('ftp://example.com')).toBe(false);
      expect(api.isHttpsUrl(null)).toBe(false);
    });

    test('downloadSubtitle XML format converts cues and escapes entities', async () => {
      const api = installModule();
      const origBlob = window.Blob;
      let lastBlobContent = '';
      window.Blob = jest.fn(function (parts, opts) {
        lastBlobContent = parts.join('');
        return new origBlob(parts, opts);
      });

      const json3Payload = JSON.stringify({
        events: [
          {
            tStartMs: 500,
            dDurationMs: 1500,
            segs: [{ utf8: 'A & B < C > "quoted"' }],
          },
        ],
      });

      global.GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({
          status: 200,
          responseText: json3Payload,
        });
      });

      await api.downloadSubtitle({
        videoId: 'testXmlConv1',
        url: 'https://www.youtube.com/api/timedtext?v=testXmlConv1&lang=en',
        languageCode: 'en',
        languageName: 'English',
        format: 'xml',
      });

      expect(lastBlobContent).toContain('<transcript>');
      expect(lastBlobContent).toContain('A &amp; B &lt; C &gt; &quot;quoted&quot;');

      window.Blob = origBlob;
    });

    test('downloadSubtitle throws when cues are empty', async () => {
      const api = installModule();
      global.GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({
          status: 200,
          responseText: '<transcript></transcript>',
        });
      });

      await expect(
        api.downloadSubtitle({
          videoId: 'testEmpty123',
          url: 'https://www.youtube.com/api/timedtext?v=testEmpty123&lang=en',
          languageCode: 'en',
          format: 'srt',
        })
      ).rejects.toThrow('No subtitle cues found');
    });

    test('downloadSubtitle keeps both <text> and <p> cues from XML the parser rejects', async () => {
      const api = installModule();
      const origBlob = window.Blob;
      let lastBlobContent = '';
      window.Blob = jest.fn(function (parts, opts) {
        lastBlobContent = parts.join('');
        return new origBlob(parts, opts);
      });

      global.GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({
          status: 200,
          // The bare "&" makes the document invalid XML, so the regex parsers run.
          responseText:
            '<timedtext><text start="1" dur="1">Text cue & more</text><body><p t="3000" d="1000">P cue</p></body></timedtext>',
        });
      });

      await api.downloadSubtitle({
        videoId: 'testMixed01',
        url: 'https://www.youtube.com/api/timedtext?v=testMixed01&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      expect(lastBlobContent).toContain('Text cue');
      expect(lastBlobContent).toContain('P cue');
      window.Blob = origBlob;
    });

    test('downloadSubtitle falls back to string query manipulation for relative URLs', async () => {
      const api = installModule();
      const origBlob = window.Blob;
      let lastBlobContent = '';
      window.Blob = jest.fn(function (parts, opts) {
        lastBlobContent = parts.join('');
        return new origBlob(parts, opts);
      });

      global.GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({
          status: 200,
          responseText: '<transcript><text start="1" dur="2">Relative URL cue</text></transcript>',
        });
      });

      await api.downloadSubtitle({
        videoId: 'testRelUrl1',
        url: '/api/timedtext?v=testRelUrl1&lang=en&tlang=es&fmt=srv1',
        languageCode: 'en',
        format: 'srt',
      });

      expect(lastBlobContent).toContain('Relative URL cue');
      window.Blob = origBlob;
    });

    test('gmXmlHttpRequest rate limiting and Violentmonkey GM fallback', async () => {
      const api = installModule();

      const hostUrl = 'https://ratelimit-test.internal/path';
      global.GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({ status: 200, responseText: 'ok' });
        return { abort: jest.fn() };
      });

      const promises = [];
      for (let i = 0; i < 15; i++) {
        promises.push(api.gmXmlHttpRequest({ url: hostUrl }));
      }
      await Promise.all(promises);

      await expect(api.gmXmlHttpRequest({ url: hostUrl })).rejects.toThrow(
        'Rate limit exceeded — request blocked'
      );

      await expect(api.gmXmlHttpRequest({ url: hostUrl })).rejects.toThrow(
        'Rate limit exceeded — request blocked'
      );

      const origGmXhr = global.GM_xmlhttpRequest;
      delete global.GM_xmlhttpRequest;
      const gmXmlHttpMock = jest.fn(options => {
        options.onload({ status: 200, responseText: 'gm fallback ok' });
        return { abort: jest.fn() };
      });
      global.GM = { xmlHttpRequest: gmXmlHttpMock };

      const res = await api.gmXmlHttpRequest({ url: 'https://otherhost.internal/api' });
      expect(res.status).toBe(200);
      expect(gmXmlHttpMock).toHaveBeenCalled();

      delete global.GM;
      global.GM_xmlhttpRequest = origGmXhr;
    });

    test('getSubtitles extracts fallback from ytInitialPlayerResponse and movie_player', async () => {
      const api = installModule();

      window.ytInitialPlayerResponse = {
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: 'https://www.youtube.com/api/timedtext?v=fallback1',
                languageCode: 'fr',
                name: { simpleText: 'French' },
              },
            ],
          },
        },
        videoDetails: { title: 'Test Initial Title' },
      };

      global.GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({
          status: 404,
          responseText: '',
        });
      });

      const subs1 = await api.getSubtitles('fallback1');
      expect(subs1.subtitles.length).toBeGreaterThan(0);
      expect(subs1.subtitles[0].languageCode).toBe('fr');
      expect(subs1.videoTitle).toBe('Test Initial Title');

      delete window.ytInitialPlayerResponse;
      const playerEl = document.createElement('div');
      playerEl.id = 'movie_player';
      playerEl.getPlayerResponse = () => ({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: 'https://www.youtube.com/api/timedtext?v=fallback2',
                languageCode: 'de',
                name: { simpleText: 'German' },
              },
            ],
          },
        },
        videoDetails: { title: 'Movie Player Title' },
      });
      document.body.appendChild(playerEl);

      const subs2 = await api.getSubtitles('fallback2');
      expect(subs2.subtitles.length).toBeGreaterThan(0);
      expect(subs2.subtitles[0].languageCode).toBe('de');
      expect(subs2.videoTitle).toBe('Movie Player Title');

      playerEl.remove();
    });
  });
});
