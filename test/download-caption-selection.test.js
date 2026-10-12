/**
 * Unit tests for caption-track selection in the download module: how tracks
 * and translation languages are mapped into subtitle entries, how the best
 * source track is scored, and the refresh of expired signed timedtext URLs
 * from a fresh watch-page fetch.
 */

describe('Download caption-track selection', () => {
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
        setSafeHTML: jest.fn((el, html) => {
          el.innerHTML = html;
        }),
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
  });

  /**
   * Serve one player response for a video.
   * @param {Record<string, unknown>} playerResponse
   * @returns {string[]} every requested URL, in order
   */
  function servePlayer(playerResponse) {
    /** @type {string[]} */
    const urls = [];
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      urls.push(url);
      options.onload({ status: 200, responseText: JSON.stringify(playerResponse) });
      return { abort: jest.fn() };
    });
    return urls;
  }

  describe('track mapping', () => {
    test('a track without a simple name falls back to its language code', async () => {
      servePlayer({
        videoDetails: { title: 'Named tracks' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: 'https://www.youtube.com/api/timedtext?v=trackMap1&amp;lang=en',
                languageCode: 'en',
                vssId: 'en.vss',
              },
              {
                baseUrl:
                  'https://www.youtube.com/api/timedtext?v=trackMap1&amp;lang=de&amp;fmt=srv3',
                name: { simpleText: 'Deutsch' },
                languageCode: 'de',
                kind: 'asr',
                isTranslatable: false,
              },
            ],
            translationLanguages: [{ languageCode: 'fr' }],
          },
        },
      });
      const api = installModule();

      const result = await api.getSubtitles('trackMap1');
      const [english, german] = result?.subtitles ?? [];
      const [french] = result?.autoTransSubtitles ?? [];

      expect(english.name).toBe('en');
      expect(english.isAutoGenerated).toBe(false);
      expect(english.trackId).toBe('en.vss');
      // An HTML-escaped base URL is unescaped and gets a default format.
      expect(english.baseUrl).toBe('https://www.youtube.com/api/timedtext?v=trackMap1&lang=en');
      expect(english.url).toContain('fmt=srv1');
      // A base URL that already carries a format is left alone.
      expect(german.baseUrl).toContain('fmt=srv3');
      expect(german.isAutoGenerated).toBe(true);
      expect(german.kind).toBe('asr');
      // Translations inherit the ASR source track and fall back to the code.
      expect(french.name).toBe('fr');
      expect(french.sourceLanguageCode).toBe('de');
      expect(french.isAutoGenerated).toBe(true);
      expect(french.translateTo).toBe('fr');
      expect(french.baseUrl).toContain('lang=de');
    });

    test('a track list without any entries yields an empty subtitle result', async () => {
      servePlayer({
        videoDetails: { title: 'No captions' },
        captions: { playerCaptionsTracklistRenderer: {} },
      });
      const api = installModule();

      await expect(api.getSubtitles('trackMap2')).resolves.toMatchObject({
        videoId: 'trackMap2',
        videoTitle: 'No captions',
        subtitles: [],
        autoTransSubtitles: [],
      });
    });

    test('a malformed track list is reported as no subtitles at all', async () => {
      servePlayer({
        videoDetails: { title: 'Broken captions' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: 'not-an-array' } },
      });
      const api = installModule();

      await expect(api.getSubtitles('trackMap3')).resolves.toBeNull();
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    });
  });

  describe('expired signed URL refresh', () => {
    test('a fresh watch page supplies new signed URLs for the same track', async () => {
      const originalBase = 'https://www.youtube.com/api/timedtext?v=expired1&lang=en&expire=1';
      const freshBase = 'https://www.youtube.com/api/timedtext?v=expired1&lang=en&expire=999';
      /** @type {string[]} */
      const requested = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        requested.push(url);
        if (url.startsWith('https://www.youtube.com/watch')) {
          options.onload({
            status: 200,
            responseText: [
              '<script>var ytInitialPlayerResponse = ',
              JSON.stringify({
                videoDetails: { title: 'Refreshed' },
                captions: {
                  playerCaptionsTracklistRenderer: {
                    captionTracks: [
                      { baseUrl: freshBase, languageCode: 'en', vssId: 'fresh.vss' },
                      { baseUrl: originalBase, languageCode: 'en-GB', vssId: 'other.vss' },
                    ],
                  },
                },
              }),
              ';</script>',
            ].join(''),
          });
          return { abort: jest.fn() };
        }
        if (url.includes('/api/timedtext')) {
          if (url.includes('expire=999')) {
            options.onload({
              status: 200,
              responseText: '<transcript><text start="1" dur="2">refreshed cue</text></transcript>',
            });
            return { abort: jest.fn() };
          }
          // Every signed variant of the expired URL answers with an empty body.
          options.onload({ status: 200, responseText: '' });
          return { abort: jest.fn() };
        }
        return { abort: jest.fn() };
      });
      const api = installModule();

      const result = await api.downloadSubtitle({
        videoId: 'expired1',
        url: originalBase,
        languageCode: 'en',
        trackId: 'fresh.vss',
        format: 'srt',
      });

      expect(requested.some(url => url.startsWith(originalBase))).toBe(true);
      expect(requested.some(url => url.startsWith(freshBase))).toBe(true);
      expect(result).toBeUndefined();
    });

    test('a watch page request that fails leaves the download failing', async () => {
      /** @type {string[]} */
      const requested = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        requested.push(url);
        options.onerror({ status: 0 });
        return { abort: jest.fn() };
      });
      const api = installModule();

      await expect(
        api.downloadSubtitle({
          videoId: 'expired3',
          url: 'https://www.youtube.com/api/timedtext?v=expired3&lang=en',
          languageCode: 'en',
          format: 'srt',
        })
      ).rejects.toThrow('Empty subtitle response');
      expect(requested.some(url => url.startsWith('https://www.youtube.com/watch'))).toBe(true);
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    });

    test('a translated track is refreshed with translated candidates', async () => {
      const originalBase = 'https://www.youtube.com/api/timedtext?v=expired4&lang=en&expire=1';
      const freshBase = 'https://www.youtube.com/api/timedtext?v=expired4&lang=en&expire=999';
      /** @type {string[]} */
      const requested = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        requested.push(url);
        if (url.startsWith('https://www.youtube.com/watch')) {
          options.onload({
            status: 200,
            responseText: `<script>var ytInitialPlayerResponse = ${JSON.stringify({
              videoDetails: { title: 'Refreshed translation' },
              captions: {
                playerCaptionsTracklistRenderer: {
                  captionTracks: [{ baseUrl: freshBase, languageCode: 'en', vssId: 'fresh.vss' }],
                },
              },
            })};</script>`,
          });
          return { abort: jest.fn() };
        }
        if (url.includes('expire=999') && url.includes('tlang=es')) {
          options.onload({
            status: 200,
            responseText:
              '<transcript><text start="1" dur="2">fresh translation</text></transcript>',
          });
          return { abort: jest.fn() };
        }
        options.onerror({ status: 400 });
        return { abort: jest.fn() };
      });
      const api = installModule();

      await api.downloadSubtitle({
        videoId: 'expired4',
        url: originalBase,
        languageCode: 'en',
        trackId: 'fresh.vss',
        translateTo: 'es',
        format: 'srt',
      });

      expect(requested.some(url => url.startsWith(originalBase) && url.includes('tlang=es'))).toBe(
        true
      );
      expect(requested.some(url => url.startsWith(freshBase) && url.includes('tlang=es'))).toBe(
        true
      );
    });

    test('a watch page without any player response leaves the download failing', async () => {
      /** @type {string[]} */
      const requested = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        requested.push(url);
        if (url.startsWith('https://www.youtube.com/watch')) {
          options.onload({ status: 200, responseText: '<html><body>no player</body></html>' });
          return { abort: jest.fn() };
        }
        options.onerror({ status: 400 });
        return { abort: jest.fn() };
      });
      const api = installModule();

      await expect(
        api.downloadSubtitle({
          videoId: 'expired2',
          url: 'https://www.youtube.com/api/timedtext?v=expired2&lang=en',
          languageCode: 'en',
          format: 'srt',
        })
      ).rejects.toThrow('Empty subtitle response');
      expect(requested.some(url => url.startsWith('https://www.youtube.com/watch'))).toBe(true);
    });
  });
});
