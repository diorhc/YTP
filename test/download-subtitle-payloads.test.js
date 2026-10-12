/**
 * Unit tests for the subtitle payload extraction, classification and parsing
 * paths in the download module: the GM/fetch response shapes, the caption
 * format detectors and the paced retry/fallback ladder.
 */

describe('Download subtitle payload handling', () => {
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

  /** Capture the text of every blob the module saves through the download anchor. */
  function captureDownloadedText() {
    const OriginalBlob = window.Blob;
    /** @type {string[]} */
    const contents = [];
    // jsdom's Blob has no text()/arrayBuffer(); give the instances the module
    // receives a reader so the real code path can be exercised.
    window.Blob = jest.fn(function (parts, opts) {
      const raw = typeof parts?.[0] === 'string' ? parts[0] : '';
      if (typeof parts?.[0] === 'string') contents.push(parts[0]);
      const blob = new OriginalBlob(parts, opts);
      if (typeof blob.text !== 'function') blob.text = () => Promise.resolve(raw);
      return blob;
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:subtitle-test'),
    });
    return contents;
  }

  /** Bytes allocated in the jsdom realm so `instanceof ArrayBuffer` holds. */
  function toBytes(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
    return bytes;
  }

  /**
   * @param {string | ((url: string) => { status?: number, response?: unknown, responseText?: string })} responder
   * @returns {string[]}
   */
  function serveSubtitles(responder) {
    /** @type {string[]} */
    const urls = [];
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      urls.push(url);
      const result = typeof responder === 'function' ? responder(url) : responder;
      options.onload(
        typeof result === 'string'
          ? { status: 200, responseText: result }
          : { status: 200, response: null, responseText: '', ...result }
      );
      return { abort: jest.fn() };
    });
    return urls;
  }

  const BASE_URL = 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en';

  describe('GM/fetch response body shapes', () => {
    test('a responseXML document is serialized into cues', async () => {
      const contents = captureDownloadedText();
      const doc = new window.DOMParser().parseFromString(
        '<?xml version="1.0"?><transcript><text start="1.5" dur="2.25">xml document body</text></transcript>',
        'text/xml'
      );
      serveSubtitles({ status: 200, responseXML: doc, responseText: null });

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        languageName: 'English',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('xml document body');
      expect(contents.join('\n')).toContain('00:00:01,500 --> 00:00:03,750');
    });

    test('a raw XMLDocument in the response field is serialized into cues', async () => {
      const contents = captureDownloadedText();
      const doc = new window.DOMParser().parseFromString(
        '<transcript><text start="0" dur="1">raw doc field</text></transcript>',
        'text/xml'
      );
      serveSubtitles({ status: 200, response: doc });

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('raw doc field');
    });

    test('an ArrayBuffer body is decoded as UTF-8', async () => {
      const contents = captureDownloadedText();
      const json3 = JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'arraybuffer body' }] }],
      });
      serveSubtitles({ status: 200, response: toBytes(json3).buffer });

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('arraybuffer body');
    });

    test('a typed-array body is decoded from its byte offset', async () => {
      const contents = captureDownloadedText();
      const json3 = JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'typed array body' }] }],
      });
      const bytes = toBytes(json3);
      serveSubtitles({ status: 200, response: bytes.subarray(0) });

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('typed array body');
    });

    test('a Blob body is read as text', async () => {
      const contents = captureDownloadedText();
      const json3 = JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'blob body' }] }],
      });
      serveSubtitles({ status: 200, response: new window.Blob([json3]) });

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('blob body');
    });

    test('a string response field is trimmed and used', async () => {
      const contents = captureDownloadedText();
      serveSubtitles({
        status: 200,
        response:
          '\n  ' +
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'string field' }] }],
          }) +
          '  ',
      });

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('string field');
    });

    test('a text-like wrapper with an async text() method is unwrapped', async () => {
      const contents = captureDownloadedText();
      const json3 = JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'async text wrapper' }] }],
      });
      serveSubtitles({
        status: 200,
        response: {
          text: () => Promise.resolve(json3),
        },
      });

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('async text wrapper');
    });

    test('a text-like wrapper with data/content fields is unwrapped', async () => {
      const contents = captureDownloadedText();
      const json3 = JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'data field' }] }],
      });
      serveSubtitles({ status: 200, response: { data: json3 } });

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('data field');

      const second = captureDownloadedText();
      serveSubtitles({ status: 200, response: { content: json3 } });
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });
      expect(second.join('\n')).toContain('data field');
    });

    test('a text-like wrapper whose text() rejects degrades to an empty body', async () => {
      serveSubtitles({
        status: 200,
        response: {
          text: () => Promise.reject(new Error('cannot read body')),
        },
      });

      const api = installModule();
      await expect(
        api.downloadSubtitle({
          videoId: 'test12345ab',
          url: BASE_URL,
          languageCode: 'en',
          format: 'srt',
        })
      ).rejects.toThrow('Empty subtitle response');
    });

    test('an HTML error page body is never treated as subtitles', async () => {
      serveSubtitles(
        '<!DOCTYPE html><html><body><p>Error 429</p></body></html> and more padding text'
      );

      const api = installModule();
      await expect(
        api.downloadSubtitle({
          videoId: 'test12345ab',
          url: BASE_URL,
          languageCode: 'en',
          format: 'srt',
        })
      ).rejects.toThrow('Empty subtitle response');
    });
  });

  describe('caption format detection', () => {
    test('WebVTT with millisecond cues and markup is converted to SRT', async () => {
      const contents = captureDownloadedText();
      const vtt = [
        'WEBVTT',
        '',
        '1',
        '00:00:01.000-->00:00:03.500',
        '<v Speaker>Hello <b>there</b></v>',
        '',
        '2',
        '00:01:02.250-->00:01:04.750',
        'Second line',
        '',
      ].join('\n');
      serveSubtitles(vtt);

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      const out = contents.join('\n');
      expect(out).toContain('Hello there');
      expect(out).toContain('00:01:02,250 --> 00:01:04,750');
    });

    // Suspected weakness (kept as observed behaviour, not an endorsement): the
    // end timestamp is read with `split(' ')[0]`, so the space real VTT files
    // put after `-->` yields an empty token and every cue loses its duration.
    test('a space after the WebVTT arrow collapses every cue duration to zero', async () => {
      const contents = captureDownloadedText();
      const vtt = ['WEBVTT', '', '1', '00:00:01.000 --> 00:00:03.500', 'spaced arrow', ''].join(
        '\n'
      );
      serveSubtitles(vtt);

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('00:00:01,000 --> 00:00:01,000');
    });

    test('WebVTT blocks without a timing line or without text are skipped', async () => {
      const contents = captureDownloadedText();
      const vtt = [
        'WEBVTT',
        '',
        'NOTE this block has no timing line',
        '',
        '1',
        '00:00:01.000 --> 00:00:02.000',
        '',
        '2',
        '00:00:03.000 --> 00:00:04.000',
        'Only real cue',
        '',
      ].join('\n');
      serveSubtitles(vtt);

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'txt',
      });

      expect(contents.join('\n')).toBe('Only real cue');
    });

    test('TTML with a seconds suffix is converted to SRT', async () => {
      const contents = captureDownloadedText();
      const ttml = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>',
        '<p begin="1.5s" end="3.5s">ttml seconds cue</p>',
        '</div></body></tt>',
      ].join('\n');
      serveSubtitles(ttml);

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      const out = contents.join('\n');
      expect(out).toContain('ttml seconds cue');
      expect(out).toContain('00:00:01,500 --> 00:00:03,500');
    });

    test('TTML with an explicit dur wins over end', async () => {
      const contents = captureDownloadedText();
      const ttml =
        '<tt><body><div><p begin="00:00:02.000" end="00:00:09.000" dur="2.500s">dur cue</p></div></body></tt>';
      serveSubtitles(ttml);

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('00:00:02,000 --> 00:00:04,500');
    });

    test('a malformed TTML root falls back to the regex scanner', async () => {
      const contents = captureDownloadedText();
      const ttml =
        '<tt><body><p begin="00:00:01.000" end="00:00:02.000">regex &amp; <br/>fallback</p>';
      serveSubtitles(ttml);

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'txt',
      });

      expect(contents.join('\n')).toContain('regex & fallback');
    });

    test('SRV3 <p> millisecond cues are converted to SRT', async () => {
      const contents = captureDownloadedText();
      const srv3 = '<transcript><p t="1500" d="2500">srv3 cue</p></transcript>';
      serveSubtitles(srv3);

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      const out = contents.join('\n');
      expect(out).toContain('srv3 cue');
      expect(out).toContain('00:00:01,500 --> 00:00:04,000');
    });

    test('SRV3 <p> cues without a duration fall back to a two second span', async () => {
      const contents = captureDownloadedText();
      serveSubtitles('<transcript><p t="1000">no duration</p></transcript>');

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('00:00:01,000 --> 00:00:03,000');
    });

    test('CDATA and nested <s> spans survive the text-tag scanner', async () => {
      const contents = captureDownloadedText();
      const xml =
        '<transcript><text start="1" dur="1"><![CDATA[cdata & text]]></text>' +
        '<text start="2" dur="1"><s>first</s><s>second</s></text></transcript>';
      serveSubtitles(xml);

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'txt',
      });

      const out = contents.join('\n');
      expect(out).toContain('cdata & text');
      expect(out).toContain('firstsecond');
    });

    test('numeric HTML entities are decoded, unknown ones are preserved', async () => {
      const contents = captureDownloadedText();
      const xml =
        '<transcript><text start="1" dur="1">&#65;&#x42;&notreal;&nbsp;end</text></transcript>';
      serveSubtitles(xml);

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'txt',
      });

      const out = contents.join('\n');
      expect(out).toContain('AB');
      expect(out).toContain('&notreal;');
    });

    test('a long unrecognised payload is saved as raw XML-converted cues', async () => {
      const contents = captureDownloadedText();
      serveSubtitles('plain transcript line that is definitely long enough to be kept');

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'xml',
      });

      expect(contents.join('\n')).toContain('<transcript>');
    });

    test('JSON that carries no usable events is rejected', async () => {
      serveSubtitles(JSON.stringify({ events: [{ tStartMs: 0, segs: [] }] }));

      const api = installModule();
      await expect(
        api.downloadSubtitle({
          videoId: 'test12345ab',
          url: BASE_URL,
          languageCode: 'en',
          format: 'srt',
        })
      ).rejects.toThrow('Empty subtitle response');
    });

    test('a body shorter than the classifier floor is rejected', async () => {
      serveSubtitles('tiny');

      const api = installModule();
      await expect(
        api.downloadSubtitle({
          videoId: 'test12345ab',
          url: BASE_URL,
          languageCode: 'en',
          format: 'srt',
        })
      ).rejects.toThrow('Empty subtitle response');
    });
  });

  describe('argument validation and error messages', () => {
    test('a missing video id or subtitle source is rejected before any request', async () => {
      const urls = serveSubtitles('{}');
      const api = installModule();

      await expect(api.downloadSubtitle({ languageCode: 'en' })).rejects.toThrow(
        'Video ID and subtitle source are required'
      );
      await expect(api.downloadSubtitle({ videoId: 'test12345ab' })).rejects.toThrow(
        'Video ID and subtitle source are required'
      );
      expect(urls).toHaveLength(0);
    });

    test('an unavailable translation reports a translation-specific error', async () => {
      serveSubtitles({ status: 429, responseText: '' });

      const api = installModule();
      await expect(
        api.downloadSubtitle({
          videoId: 'test12345ab',
          url: BASE_URL,
          languageCode: 'en',
          translateTo: 'fr',
          format: 'srt',
        })
      ).rejects.toThrow('Translated subtitle track is unavailable for this video/language');
    });

    test('HTTP 429 across the whole ladder reports the rate-limit hint', async () => {
      const urls = serveSubtitles({ status: 429, responseText: '' });

      const api = installModule();
      await expect(
        api.downloadSubtitle({
          videoId: 'test12345ab',
          url: `${BASE_URL}&fmt=json3&kind=asr`,
          languageCode: 'en',
          format: 'srt',
        })
      ).rejects.toThrow(/HTTP 429/);

      // The minimal retry set must drop fmt/tlang/kind before re-requesting.
      expect(urls.some(u => u.includes('fmt='))).toBe(true);
      expect(urls.some(u => !u.includes('fmt=') && !u.includes('kind='))).toBe(true);
    }, 20000);

    test('a translated download requests the tlang candidates first', async () => {
      const contents = captureDownloadedText();
      const json3 = JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 400, segs: [{ utf8: 'bonjour' }] }],
      });
      const urls = serveSubtitles(json3);

      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        languageName: 'English',
        translateTo: 'fr',
        format: 'srt',
      });

      expect(urls[0]).toContain('tlang=fr');
      expect(contents.join('\n')).toContain('bonjour');
    });

    test('a non-429 failure is reported as an empty response', async () => {
      serveSubtitles({ status: 500, responseText: '' });

      const api = installModule();
      await expect(
        api.downloadSubtitle({
          videoId: 'test12345ab',
          url: BASE_URL,
          languageCode: 'en',
          format: 'srt',
        })
      ).rejects.toThrow('Empty subtitle response');
    });

    test('the page fetch is used when the GM transport yields nothing usable', async () => {
      serveSubtitles({ status: 200, responseText: '' });
      const json3 = JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 400, segs: [{ utf8: 'page fetched cue' }] }],
      });
      global.fetch = jest.fn(() =>
        Promise.resolve({ ok: true, url: BASE_URL, text: () => Promise.resolve(json3) })
      );

      const contents = captureDownloadedText();
      const api = installModule();
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('page fetched cue');
    });

    test('an aborted page fetch stops the candidate walk immediately', async () => {
      serveSubtitles({ status: 200, responseText: '' });
      const controller = new AbortController();
      global.fetch = jest.fn(() => {
        controller.abort();
        return Promise.resolve({ ok: true, url: BASE_URL, text: () => Promise.resolve('') });
      });

      const api = installModule();
      await expect(
        api.downloadSubtitle({
          videoId: 'test12345ab',
          url: BASE_URL,
          languageCode: 'en',
          format: 'srt',
        })
      ).rejects.toThrow('Empty subtitle response');
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('getSubtitles track selection', () => {
    test('translation languages inherit the source track metadata', async () => {
      serveSubtitles({
        status: 200,
        responseText: JSON.stringify({
          videoDetails: { title: 'Track demo' },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  languageCode: 'de',
                  kind: 'asr',
                  vssId: 'a.de',
                  isTranslatable: false,
                  name: { simpleText: 'Deutsch' },
                  baseUrl:
                    'https://www.youtube.com/api/timedtext?v=test12345ab&lang=de&amp;kind=asr',
                },
                {
                  languageCode: 'en',
                  vssId: 'a.en',
                  name: { simpleText: 'English' },
                  baseUrl: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
                },
              ],
              translationLanguages: [
                { languageCode: 'fr', languageName: { simpleText: 'French' } },
                { languageCode: 'de', languageName: { simpleText: 'Deutsch (auto)' } },
              ],
            },
          },
        }),
      });

      const api = installModule();
      const data = await api.getSubtitles('test12345ab');

      expect(data?.videoTitle).toBe('Track demo');
      expect(data?.subtitles?.map(s => s.languageCode)).toEqual(['de', 'en']);
      expect(data?.autoTransSubtitles).toHaveLength(2);
      const fr = data?.autoTransSubtitles?.[0];
      // The ASR track wins the translation-source contest because an explicit
      // auto-generated preference is scored above translatability.
      expect(fr?.languageCode).toBe('fr');
      expect(fr?.sourceLanguageCode).toBe('de');
      expect(fr?.isAutoGenerated).toBe(true);
      expect(fr?.url).toContain('lang=de');
      expect(fr?.url).toContain('fmt=srv1');
    });

    test('a video with no captions yields an empty subtitle result', async () => {
      serveSubtitles({ status: 200, responseText: JSON.stringify({ videoDetails: {} }) });

      const api = installModule();
      const data = await api.getSubtitles('test12345ab');

      expect(data).toEqual({
        videoId: 'test12345ab',
        videoTitle: 'video',
        subtitles: [],
        autoTransSubtitles: [],
      });
    });

    test('a player API failure falls back to the watch page HTML', async () => {
      serveSubtitles(url => {
        if (url.includes('/youtubei/v1/player')) {
          return { status: 503, responseText: '' };
        }
        if (url.includes('/watch?v=')) {
          const captions = {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  languageCode: 'ja',
                  name: { simpleText: 'Japanese' },
                  baseUrl: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=ja',
                },
              ],
              translationLanguages: [],
            },
          };
          return {
            status: 200,
            responseText: `var ytInitialPlayerResponse = ${JSON.stringify({
              videoDetails: { title: 'HTML fallback' },
              captions,
            })};`,
          };
        }
        return { status: 404, responseText: '' };
      });

      const api = installModule();
      const data = await api.getSubtitles('test12345ab');

      expect(data?.videoTitle).toBe('HTML fallback');
      expect(data?.subtitles?.[0]?.languageCode).toBe('ja');
    });

    test('a mangled ytInitialPlayerResponse falls through to the next assignment', async () => {
      serveSubtitles(url => {
        if (url.includes('/youtubei/v1/player')) return { status: 500, responseText: '' };
        if (url.includes('/watch?v=')) {
          return {
            status: 200,
            responseText:
              'var ytInitialPlayerResponse = {"videoDetails":{"title":"broken"},};' +
              'var ytInitialPlayerResponse = {"videoDetails":{"title":"second"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"languageCode":"ko","name":{"simpleText":"Korean"},"baseUrl":"https://www.youtube.com/api/timedtext?v=test12345ab&lang=ko"}],"translationLanguages":[]}}};',
          };
        }
        return { status: 404, responseText: '' };
      });

      const api = installModule();
      const data = await api.getSubtitles('test12345ab');

      expect(data?.videoTitle).toBe('second');
      expect(data?.subtitles?.[0]?.languageCode).toBe('ko');
    });

    test('watch HTML without any player response yields no captions', async () => {
      serveSubtitles(url =>
        url.includes('/watch?v=')
          ? { status: 200, responseText: '<html><body>no player data</body></html>' }
          : { status: 500, responseText: '' }
      );

      const api = installModule();
      const data = await api.getSubtitles('test12345ab');

      expect(data?.subtitles).toEqual([]);
    });

    test('a player response exposing 4K is reflected in the quality list', async () => {
      serveSubtitles({
        status: 200,
        responseText: JSON.stringify({
          streamingData: {
            adaptiveFormats: [
              { mimeType: 'video/webm; codecs="vp9"', qualityLabel: '4320p60' },
              { mimeType: 'video/webm; codecs="vp9"', qualityLabel: '1080p60' },
              { mimeType: 'audio/mp4; codecs="opus"', qualityLabel: 'tiny' },
            ],
          },
        }),
      });

      const api = installModule();
      api.openModal();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();
      await Promise.resolve();

      const values = Array.from(document.querySelectorAll('.yp-download-quality button'))
        .map(btn => btn.getAttribute('data-value'))
        .filter(Boolean);
      expect(values).toEqual(['1080', '4320']);
    });
  });
});
