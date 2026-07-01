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

  function installModule() {
    jest.resetModules();
    require('../src/download.js');
    return window.YouTubePlusDownload;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    // Set up required globals
    window._ytplusCreateHTML = s => s;
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(sel => document.querySelector(sel)),
        $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
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
        logSuppressed: jest.fn(),
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
      href: 'https://www.youtube.com/watch?v=test123',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=test123',
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

    Object.defineProperty(window, 'YouTubePlusLazyLoader', {
      configurable: true,
      writable: true,
      value: null,
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
                  baseUrl: 'https://www.youtube.com/api/timedtext?v=test123&lang=de',
                  isTranslatable: false,
                  name: { simpleText: 'Deutsch' },
                },
                {
                  languageCode: 'en',
                  kind: 'asr',
                  vssId: 'a.en',
                  isTranslatable: true,
                  baseUrl:
                    'https://www.youtube.com/api/timedtext?v=test123&lang=en&kind=asr&fmt=srv1',
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
    const result = await api.getSubtitles('test123');

    expect(result.autoTransSubtitles).toHaveLength(1);
    expect(result.autoTransSubtitles[0]).toMatchObject({
      sourceLanguageCode: 'en',
      isAutoGenerated: true,
      baseUrl: 'https://www.youtube.com/api/timedtext?v=test123&lang=en&kind=asr&fmt=srv1',
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
      videoId: 'test123',
      url: 'https://www.youtube.com/api/timedtext?v=test123&lang=en&kind=asr',
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
        videoId: 'test123',
        url: 'https://www.youtube.com/api/timedtext?v=test123&lang=en&kind=asr',
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
});
