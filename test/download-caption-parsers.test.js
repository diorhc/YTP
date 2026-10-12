/**
 * Unit tests for the caption parsers in the download module: the JSON3 event
 * shapes, the WebVTT clock-time scanner and the TTML DOM/regex readers, each
 * exercised through a real subtitle download so the saved payload is observed.
 */

describe('Download caption parsers', () => {
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
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  /**
   * Serve one caption body and capture what the module saves.
   * @param {string} body
   * @returns {string[]} saved blob bodies
   */
  function serveCaptions(body) {
    const OriginalBlob = window.Blob;
    /** @type {string[]} */
    const contents = [];
    window.Blob = jest.fn(function (parts, opts) {
      if (typeof parts?.[0] === 'string') contents.push(parts[0]);
      const blob = new OriginalBlob(parts, opts);
      if (typeof blob.text !== 'function') {
        blob.text = () => Promise.resolve(typeof parts?.[0] === 'string' ? parts[0] : '');
      }
      return blob;
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:caption-parsers'),
    });
    GM_xmlhttpRequest.mockImplementation(options => {
      options.onload({ status: 200, responseText: body });
      return { abort: jest.fn() };
    });
    return contents;
  }

  /**
   * @param {Record<string, unknown>} [overrides]
   * @returns {Record<string, unknown>}
   */
  const request = (overrides = {}) => ({
    videoId: 'captionParser',
    url: 'https://www.youtube.com/api/timedtext?v=captionParser&lang=en',
    languageCode: 'en',
    format: 'srt',
    ...overrides,
  });

  describe('JSON3 events', () => {
    test('a non-array events field yields no cue', async () => {
      serveCaptions(JSON.stringify({ events: 'not-an-array' }));
      const api = installModule();

      await expect(api.downloadSubtitle(request())).rejects.toThrow('Empty subtitle response');
    });

    test('events without usable segments yield no cue', async () => {
      serveCaptions(
        JSON.stringify({ events: [{ tStartMs: 0 }, { segs: 'nope' }, { segs: [{}] }] })
      );
      const api = installModule();

      await expect(api.downloadSubtitle(request())).rejects.toThrow('Empty subtitle response');
    });

    test('an event without a start time is saved from zero', async () => {
      const contents = serveCaptions(
        JSON.stringify({ events: [{ segs: [{ utf8: 'startless cue' }] }] })
      );
      const api = installModule();

      await api.downloadSubtitle(request());

      const out = contents.join('\n');
      expect(out).toContain('startless cue');
      expect(out).toContain('00:00:00,000 -->');
    });

    test('unparseable JSON is rejected instead of saved', async () => {
      serveCaptions('{"events": [ {"tStartMs": 1, ');
      const api = installModule();

      await expect(api.downloadSubtitle(request())).rejects.toThrow('Empty subtitle response');
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    });
  });

  describe('WebVTT clock times', () => {
    test('a whitespace-only block and an unreadable timing line are skipped', async () => {
      const contents = serveCaptions(
        'WEBVTT\n\n00:0x:01.000 --> 00:00:03.000\nunreadable timing\n\n   \n\n' +
          '00:00:05.000-->00:00:07.000\nreadable cue'
      );
      const api = installModule();

      await api.downloadSubtitle(request());

      const out = contents.join('\n');
      expect(out).toContain('readable cue');
      expect(out).toContain('00:00:05,000 --> 00:00:07,000');
      expect(out).toContain('00:00:00,000 --> 00:00:00,000');
    });

    test('a two-part clock time and a fractional cue are both honoured', async () => {
      const contents = serveCaptions(
        'WEBVTT\n\n01:02-->01:04\ntwo part clock\n\n00:00:06.25-->00:00:08.5\nfractional clock'
      );
      const api = installModule();

      await api.downloadSubtitle(request());

      const out = contents.join('\n');
      expect(out).toContain('00:01:02,000 --> 00:01:04,000');
      expect(out).toContain('00:00:06,250 --> 00:00:08,500');
    });
  });

  describe('TTML paragraphs', () => {
    test('the start attribute is used when begin is absent and empty paragraphs are skipped', async () => {
      const contents = serveCaptions(
        '<?xml version="1.0"?><tt><body><div>' +
          '<p start="00:00:02.000" end="00:00:04.000">start attribute cue</p>' +
          '<p begin="00:00:05.000" end="00:00:06.000">   </p>' +
          '</div></body></tt>'
      );
      const api = installModule();

      await api.downloadSubtitle(request());

      const out = contents.join('\n');
      expect(out).toContain('start attribute cue');
      expect(out).toContain('00:00:02,000 --> 00:00:04,000');
    });

    test('a paragraph with neither begin nor start lands at zero', async () => {
      const contents = serveCaptions(
        '<?xml version="1.0"?><tt><body><p>untimed paragraph</p></body></tt>'
      );
      const api = installModule();

      await api.downloadSubtitle(request());

      expect(contents.join('\n')).toContain('00:00:00,000 -->');
    });

    test('a non-numeric seconds suffix is read as zero rather than dropped', async () => {
      const contents = serveCaptions(
        '<?xml version="1.0"?><tt><body><p begin="1xs" end="3xs">bad suffix cue</p></body></tt>'
      );
      const api = installModule();

      await api.downloadSubtitle(request());

      const out = contents.join('\n');
      expect(out).toContain('bad suffix cue');
      expect(out).toContain('00:00:00,000 -->');
    });

    test('an explicit dur wins over end when the DOM parser rejects the payload', async () => {
      const contents = serveCaptions(
        '<tt><body><p begin="00:00:01.000" dur="00:00:02.500">duration attribute cue</p>' +
          '<p begin="00:00:03.000" end="00:00:05.000"></p>' +
          '<p>attribute-less cue</p>'
      );
      const api = installModule();

      await api.downloadSubtitle(request());

      const out = contents.join('\n');
      expect(out).toContain('00:00:01,000 --> 00:00:03,500');
      expect(out).toContain('attribute-less cue');
      expect(out.match(/duration attribute cue/g)).toHaveLength(1);
    });
  });
});
