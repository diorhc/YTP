/**
 * Unit tests for the subtitle download pipeline's fallback ordering and the
 * modal's inline progress/error surfaces: the auto-generated language-only
 * retry, the Firefox candidate strategy, output-format fallbacks, binary body
 * decoding without a TextDecoder and the modal progress/error rendering.
 */

describe('Download subtitle pipeline and modal feedback', () => {
  const createLogger = () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  });

  /**
   * @param {(utils: Record<string, any>) => void} [mutateUtils]
   */
  function installModule(mutateUtils) {
    jest.resetModules();
    if (mutateUtils) mutateUtils(window.YouTubeUtils);
    require('../src/download.js');
    return window.YouTubePlusDownload;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.resetModules();
    require('../src/utils.js');
    const canonUtils = window.YouTubeUtils;
    window._ytplusCreateHTML = s => s;
    /** @type {Map<string, string>} */
    const store = new Map();
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
          getItem: jest.fn(key => store.get(key) ?? null),
          setItem: jest.fn((key, value) => {
            store.set(key, value);
          }),
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
      value: jest.fn(() => 'blob:pipeline'),
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  const BASE_URL = 'https://www.youtube.com/api/timedtext?v=pipeline1&lang=en';

  /** Capture what the module saves and serve one caption body per request rule. */
  function serveCaptions(responder) {
    const OriginalBlob = window.Blob;
    /** @type {string[]} */
    const contents = [];
    /** @type {string[]} */
    const urls = [];
    window.Blob = jest.fn(function (parts, opts) {
      if (typeof parts?.[0] === 'string') contents.push(parts[0]);
      const blob = new OriginalBlob(parts, opts);
      if (typeof blob.text !== 'function') {
        blob.text = () => Promise.resolve(typeof parts?.[0] === 'string' ? parts[0] : '');
      }
      return blob;
    });
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      urls.push(url);
      responder(url, options);
      return { abort: jest.fn() };
    });
    return { contents, urls };
  }

  const captionXml = text => `<transcript><text start="1" dur="2">${text}</text></transcript>`;

  /** Emulate a Firefox user agent so the module picks the minimal strategy. */
  function asFirefox() {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
    });
  }

  afterEach(() => {
    // The user agent is global: restore it so one case cannot leak into another.
    delete window.navigator.userAgent;
  });

  describe('candidate strategies', () => {
    test('a Firefox session walks the lean candidates first', async () => {
      asFirefox();
      const { contents, urls } = serveCaptions((_url, options) => {
        options.onload({ status: 200, responseText: captionXml('firefox cue') });
      });
      const api = installModule();

      await api.downloadSubtitle({
        videoId: 'pipeline1',
        url: BASE_URL,
        languageCode: 'en',
        isAutoGenerated: true,
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('firefox cue');
      // The minimal strategy never asks for a format variant.
      expect(urls.every(url => !url.includes('fmt='))).toBe(true);
    });

    // Suspected weakness (kept as observed behaviour, not an endorsement): the
    // minimal Firefox candidate builder strips `tlang`, so a translated request
    // silently downloads the source track instead of the requested translation.
    test('a translated Firefox session drops the translation parameter', async () => {
      asFirefox();
      const { contents, urls } = serveCaptions((_url, options) => {
        options.onload({ status: 200, responseText: captionXml('translated cue') });
      });
      const api = installModule();

      await api.downloadSubtitle({
        videoId: 'pipeline1',
        url: BASE_URL,
        languageCode: 'en',
        translateTo: 'es',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('translated cue');
      expect(urls.some(url => url.includes('tlang=es'))).toBe(false);
    });

    test('an auto-generated track is retried without the ASR flag', async () => {
      /** @type {string[]} */
      const attempted = [];
      const { contents } = serveCaptions((url, options) => {
        attempted.push(url);
        if (url.includes('kind=asr')) {
          options.onerror({ status: 400 });
          return;
        }
        options.onload({ status: 200, responseText: captionXml('language only cue') });
      });
      // A relative source URL contributes no candidate of its own, so the ASR
      // walk is the only one the first attempt can try.
      const api = installModule();

      await api.downloadSubtitle({
        videoId: 'pipeline1',
        url: '/api/timedtext?expire=1&lang=en',
        languageCode: 'en',
        isAutoGenerated: true,
        format: 'srt',
      });

      expect(attempted.some(url => url.includes('kind=asr'))).toBe(true);
      expect(attempted.some(url => !url.includes('kind=asr'))).toBe(true);
      expect(contents.join('\n')).toContain('language only cue');
    });

    test('a failed blob revocation never breaks the saved subtitle', async () => {
      const { contents } = serveCaptions((_url, options) => {
        options.onload({ status: 200, responseText: captionXml('revoked cue') });
      });
      const realRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = jest.fn(() => {
        throw new Error('revocation refused');
      });
      try {
        const api = installModule();
        await api.downloadSubtitle({
          videoId: 'pipeline1',
          url: BASE_URL,
          languageCode: 'en',
          format: 'srt',
        });
        // The object URL is revoked on a deferred timer after the save.
        await new Promise(resolve => setTimeout(resolve, 2200));
      } finally {
        URL.revokeObjectURL = realRevoke;
      }

      expect(contents.join('\n')).toContain('revoked cue');
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    }, 10000);

    test('a page-context fetch rescues a blocked manager request', async () => {
      // Firefox skips the early page fetch, so the fallback ladder has to try it.
      asFirefox();
      const { contents } = serveCaptions((_url, options) => {
        options.onerror({ status: 403 });
      });
      global.fetch = jest.fn(url =>
        Promise.resolve({
          ok: true,
          status: 200,
          url: String(url),
          text: () => Promise.resolve(captionXml('page fetched cue')),
        })
      );
      const api = installModule();

      await api.downloadSubtitle({
        videoId: 'pipeline1',
        url: BASE_URL,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('page fetched cue');
    });

    test('an unknown output format is saved as converted transcript XML', async () => {
      const { contents } = serveCaptions((_url, options) => {
        options.onload({ status: 200, responseText: captionXml('fallback format cue') });
      });
      const api = installModule();

      await api.downloadSubtitle({
        videoId: 'pipeline1',
        url: BASE_URL,
        languageCode: 'en',
        format: 'vtt',
      });

      const out = contents.join('\n');
      expect(out).toContain('<transcript>');
      expect(out).toContain('fallback format cue');
    });
  });

  describe('binary caption bodies', () => {
    /** Bytes allocated in the jsdom realm so `instanceof ArrayBuffer` holds. */
    function toBytes(text) {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
      return bytes;
    }

    test('an ArrayBuffer body without a TextDecoder yields no usable payload', async () => {
      serveCaptions((_url, options) => {
        options.onload({
          status: 200,
          response: toBytes(captionXml('binary cue')).buffer,
        });
      });
      const realDecoder = window.TextDecoder;
      delete window.TextDecoder;
      try {
        const api = installModule();
        await expect(
          api.downloadSubtitle({
            videoId: 'pipeline1',
            url: BASE_URL,
            languageCode: 'en',
            format: 'srt',
          })
        ).rejects.toThrow('Empty subtitle response');
      } finally {
        window.TextDecoder = realDecoder;
      }
    });

    test('a throwing TextDecoder degrades to an empty payload', async () => {
      serveCaptions((_url, options) => {
        options.onload({ status: 200, response: toBytes(captionXml('binary cue')).buffer });
      });
      const realDecoder = window.TextDecoder;
      window.TextDecoder = function () {
        throw new Error('decoder unavailable');
      };
      try {
        const api = installModule();
        await expect(
          api.downloadSubtitle({
            videoId: 'pipeline1',
            url: BASE_URL,
            languageCode: 'en',
            format: 'srt',
          })
        ).rejects.toThrow('Empty subtitle response');
        expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
      } finally {
        window.TextDecoder = realDecoder;
      }
    });

    test('an XML document body that cannot be serialised is reported as empty', async () => {
      const doc = new window.DOMParser().parseFromString(captionXml('serialised cue'), 'text/xml');
      serveCaptions((_url, options) => {
        options.onload({ status: 200, responseXML: doc });
      });
      const realSerializer = window.XMLSerializer;
      window.XMLSerializer = function () {
        throw new Error('serializer unavailable');
      };
      try {
        const api = installModule();
        await expect(
          api.downloadSubtitle({
            videoId: 'pipeline1',
            url: BASE_URL,
            languageCode: 'en',
            format: 'srt',
          })
        ).rejects.toThrow('Empty subtitle response');
        expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
      } finally {
        window.XMLSerializer = realSerializer;
      }
    });
  });

  describe('modal progress and error surfaces', () => {
    /** Open the modal, click download and report progress while the transfer hangs. */
    function openModalAndDownload({ withTotal }) {
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
        options.onprogress?.(withTotal ? { loaded: 512, total: 1024 } : { loaded: 4096, total: 0 });
        // The transfer never settles, so the inline progress stays visible.
        return { abort: jest.fn() };
      });
      const api = installModule();
      api.openModal();
      document.querySelector('.yp-download-btn.primary')?.click();
      return api;
    }

    test('a determinate progress event renders percentage and sizes', async () => {
      openModalAndDownload({ withTotal: true });
      await new Promise(resolve => setTimeout(resolve, 30));

      const progressText = /** @type {HTMLElement} */ (
        document.querySelector('.yp-download-progress-text')
      );
      const fill = /** @type {HTMLElement} */ (
        document.querySelector('.yp-download-progress-fill')
      );
      expect(progressText.textContent).toBe('50% • 512 B / 1 KB');
      expect(fill.style.width).toBe('50%');
    });

    test('an indeterminate progress event renders a bounded percentage', async () => {
      openModalAndDownload({ withTotal: false });
      await new Promise(resolve => setTimeout(resolve, 30));

      const progressText = /** @type {HTMLElement} */ (
        document.querySelector('.yp-download-progress-text')
      );
      const fill = /** @type {HTMLElement} */ (
        document.querySelector('.yp-download-progress-fill')
      );
      expect(progressText.textContent).toBe('downloading • 4 KB / —');
      expect(fill.style.width).toBe('48%');
    });

    test('a failed download restores the controls and resets the error styling', async () => {
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
        // The CDN refuses the file, so the failure surfaces without retries.
        options.onload({ status: 500, response: null });
        return { abort: jest.fn() };
      });
      const api = installModule();
      api.openModal();
      const btn = /** @type {HTMLButtonElement} */ (
        document.querySelector('.yp-download-btn.primary')
      );
      btn.click();
      await new Promise(resolve => setTimeout(resolve, 60));

      const progressText = /** @type {HTMLElement} */ (
        document.querySelector('.yp-download-progress-text')
      );
      expect(progressText.textContent).toContain('downloadFailed');
      expect(btn.disabled).toBe(false);
      expect(progressText.style.color).toBe('var(--yt-danger-text)');

      // A safety timer re-enables the controls, and the colour resets later on.
      await new Promise(resolve => setTimeout(resolve, 600));
      expect(btn.disabled).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 2600));
      expect(progressText.style.color).toBe('rgb(255, 255, 255)');
    }, 15000);
  });
});
