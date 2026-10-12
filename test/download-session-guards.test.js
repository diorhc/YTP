/**
 * Unit tests for the download module's session guards and page-runtime
 * fallbacks: caption discovery from the page runtime, the translation
 * fallback, album-art canvas failures, queue-manager teardown and the
 * modal focus trap.
 */

describe('Download session and page-runtime fallbacks', () => {
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
      value: jest.fn(() => 'blob:session-guards'),
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  const notifications = () =>
    window.YouTubeUtils.NotificationManager.show.mock.calls.map(call => String(call[0]));

  /** Answer the player request with a failure so the page fallbacks are used. */
  function failPlayerRequest() {
    GM_xmlhttpRequest.mockImplementation(options => {
      options.onload({ status: 500, responseText: '' });
      return { abort: jest.fn() };
    });
  }

  const CAPTIONS = {
    captionTracks: [
      {
        baseUrl: 'https://www.youtube.com/api/timedtext?v=runtime&lang=en',
        name: { simpleText: 'English' },
        languageCode: 'en',
        kind: 'standard',
      },
    ],
    translationLanguages: [{ languageCode: 'es', languageName: { simpleText: 'Spanish' } }],
  };

  describe('caption discovery from the page runtime', () => {
    test('the movie player response is used when the player API is blocked', async () => {
      failPlayerRequest();
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.getPlayerResponse = () => ({
        videoDetails: { title: 'Runtime player title' },
        captions: { playerCaptionsTracklistRenderer: CAPTIONS },
      });
      document.body.appendChild(player);
      const api = installModule();

      const result = await api.getSubtitles('runtime1');

      expect(result?.videoTitle).toBe('Runtime player title');
      expect(result?.subtitles.map(track => track.languageCode)).toEqual(['en']);
    });

    test('the ytplayer config player_response is parsed when no element answers', async () => {
      failPlayerRequest();
      window.ytplayer = {
        config: {
          args: {
            player_response: JSON.stringify({
              videoDetails: { title: 'Config player title' },
              captions: { playerCaptionsTracklistRenderer: CAPTIONS },
            }),
          },
        },
      };
      const api = installModule();

      const result = await api.getSubtitles('runtime2');

      expect(result?.videoTitle).toBe('Config player title');
      expect(result?.subtitles[0]?.name).toBe('English');
      expect(result?.autoTransSubtitles.map(lang => lang.languageCode)).toEqual(['es']);
      delete window.ytplayer;
    });

    test('an unparseable player_response degrades to an empty subtitle result', async () => {
      failPlayerRequest();
      window.ytplayer = { config: { args: { player_response: '{not json' } } };
      const api = installModule();

      await expect(api.getSubtitles('runtime3')).resolves.toMatchObject({
        subtitles: [],
        autoTransSubtitles: [],
      });
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
      delete window.ytplayer;
    });

    test('a throwing page runtime is logged instead of escaping', async () => {
      failPlayerRequest();
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get() {
          throw new Error('page runtime unavailable');
        },
      });
      const api = installModule();

      await expect(api.getSubtitles('runtime4')).resolves.toMatchObject({ subtitles: [] });
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
      delete window.ytInitialPlayerResponse;
    });
  });

  describe('translation fallback', () => {
    test('the module keeps working when the utils facade carries no translator', async () => {
      const api = installModule(utils => {
        delete utils.t;
      });

      await api.enqueueDownload({ format: 'video', quality: '720' }).catch(() => undefined);

      // Labels come from the built-in key itself; nothing crashes without i18n.
      expect(window.YouTubeUtils.NotificationManager.show).toHaveBeenCalled();
    });
  });

  describe('album art embedding failures', () => {
    /**
     * Serve cnv.cx and make every thumbnail image resolve its load event.
     * @param {() => unknown} canvasContext
     * @param {(cb: (blob: unknown) => void) => void} toBlob
     */
    function serveAudioWithArt(canvasContext, toBlob) {
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/sanity/key')) {
          options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
          return { abort: jest.fn() };
        }
        if (url.includes('/converter')) {
          options.onload({
            status: 200,
            responseText: JSON.stringify({ url: 'https://cdn.example.com/a.mp3' }),
          });
          return { abort: jest.fn() };
        }
        options.onload({ status: 200, response: new window.Blob(['audio bytes']) });
        return { abort: jest.fn() };
      });
      const originalCreate = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation(tag => {
        const el = originalCreate(tag);
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
      jest
        .spyOn(window.HTMLCanvasElement.prototype, 'getContext')
        .mockImplementation(canvasContext);
      jest.spyOn(window.HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob);
    }

    test('a canvas without a 2d context still saves the untouched audio', async () => {
      serveAudioWithArt(
        () => null,
        function (cb) {
          cb(new window.Blob(['art']));
        }
      );
      const api = installModule();

      await expect(
        api.downloadVideo({ format: 'audio', audioBitrate: '128', embedThumbnail: true })
      ).resolves.toBeUndefined();

      expect(notifications()).toContain('downloadCompleted');
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    test('a canvas that cannot produce a blob still saves the untouched audio', async () => {
      serveAudioWithArt(
        () => ({ drawImage: jest.fn() }),
        function (cb) {
          cb(null);
        }
      );
      const api = installModule();

      await expect(
        api.downloadVideo({ format: 'audio', audioBitrate: '128', embedThumbnail: true })
      ).resolves.toBeUndefined();

      expect(notifications()).toContain('downloadCompleted');
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });
  });

  describe('conversion session guards', () => {
    test('cancelling right after the conversion never fetches the file', async () => {
      /** @type {string[]} */
      const urls = [];
      let converted = false;
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        urls.push(url);
        if (url.includes('/sanity/key')) {
          options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
          return { abort: jest.fn() };
        }
        if (url.includes('/converter')) {
          converted = true;
          options.onload({
            status: 200,
            responseText: JSON.stringify({ url: 'https://cdn.example.com/f.mp4' }),
          });
          return { abort: jest.fn() };
        }
        options.onload({ status: 200, response: new window.Blob(['payload']) });
        return { abort: jest.fn() };
      });
      const api = installModule();

      await expect(
        api.downloadVideo({
          format: 'video',
          // Only cancels once the conversion has answered.
          onCancel: () => converted,
        })
      ).rejects.toThrow('Download cancelled');
      expect(urls.some(url => url.includes('cdn.example.com'))).toBe(false);
    });

    test('a source failure that names a cancellation stops the whole ladder', async () => {
      /** @type {string[]} */
      const attempted = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        attempted.push(url);
        if (url.includes('/sanity/key')) {
          options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
          return { abort: jest.fn() };
        }
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            status: 'error',
            text: 'the user cancelled this conversion',
          }),
        });
        return { abort: jest.fn() };
      });
      const api = installModule();

      await expect(api.enqueueDownload({ format: 'video' })).rejects.toThrow(/cancelled/i);
      // Only cnv.cx was tried: a cancellation is not retried on another source.
      expect(attempted.some(url => url.includes('/converter'))).toBe(true);
      expect(attempted.some(url => url.includes('/youtubei/v1/player'))).toBe(false);
      expect(document.querySelector('.yp-download-manager-item-info')?.textContent).toContain(
        'downloadCancelled'
      );
    });

    test('without a manager the file opens in a new tab and nothing is saved', async () => {
      const saved = Object.getOwnPropertyDescriptor(globalThis, 'GM_xmlhttpRequest');
      delete globalThis.GM_xmlhttpRequest;
      global.fetch = jest.fn(url => {
        if (String(url).includes('/sanity/key')) {
          return Promise.resolve({
            status: 200,
            url: String(url),
            text: () => Promise.resolve(JSON.stringify({ key: 'k' })),
          });
        }
        return Promise.resolve({
          status: 200,
          url: String(url),
          text: () => Promise.resolve(JSON.stringify({ url: 'https://cdn.example.com/f.mp4' })),
        });
      });
      try {
        const api = installModule();
        await api.downloadVideo({ format: 'video' });

        expect(window.YouTubeUtils.openSafe).toHaveBeenCalledWith(
          'https://cdn.example.com/f.mp4',
          '_blank'
        );
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(notifications()).not.toContain('downloadCompleted');
      } finally {
        if (saved) Object.defineProperty(globalThis, 'GM_xmlhttpRequest', saved);
      }
    });

    test('a full queue refuses further work and surfaces the warning', async () => {
      // Every queued item stays active, so the eleventh request is refused.
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/sanity/key')) {
          options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
          return { abort: jest.fn() };
        }
        return { abort: jest.fn() };
      });
      const api = installModule();

      const queued = [];
      for (let i = 0; i < 10; i += 1) {
        queued.push(
          api.enqueueDownload({ format: 'video', quality: '720' }).catch(() => undefined)
        );
      }
      await new Promise(resolve => setTimeout(resolve, 10));

      await expect(api.enqueueDownload({ format: 'video' })).rejects.toThrow(
        'Download queue is full'
      );
      expect(notifications()).toContain('downloadQueueFull');
      queued.forEach(promise => {
        promise.catch(() => undefined);
      });
    });
  });

  describe('queue manager teardown', () => {
    test('the registered teardown cancels an active download whose abort throws', async () => {
      let abortAttempts = 0;
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
        return {
          abort: () => {
            abortAttempts += 1;
            throw new Error('handle already gone');
          },
        };
      });
      const api = installModule();

      const queued = api.enqueueDownload({ format: 'video' });
      queued.catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 10));

      // The module hands its panel teardown to the cleanup host at load time.
      const teardown = window.YouTubeUtils.cleanupManager.register.mock.calls
        .map(call => call[0])
        .find(fn => typeof fn === 'function');
      expect(teardown).toBeInstanceOf(Function);
      teardown();

      expect(abortAttempts).toBeGreaterThan(0);
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
      expect(document.querySelector('.yp-download-manager')).toBeNull();
    });

    test('a panel animation failure still shows the panel', async () => {
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/sanity/key')) {
          options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
          return { abort: jest.fn() };
        }
        options.onload({
          status: 200,
          responseText: JSON.stringify({ url: 'https://cdn.example.com/f.mp4' }),
        });
        return { abort: jest.fn() };
      });
      const realRaf = global.requestAnimationFrame;
      global.requestAnimationFrame = () => {
        throw new Error('animation frame unavailable');
      };
      try {
        const api = installModule();
        await api.enqueueDownload({ format: 'video' }).catch(() => undefined);

        const panel = document.querySelector('.yp-download-manager');
        expect(panel?.classList.contains('visible')).toBe(true);
        expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
      } finally {
        global.requestAnimationFrame = realRaf;
      }
    });

    test('cancelling an item whose abort handle throws still reports the cancellation', async () => {
      let abortAttempts = 0;
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
        // The media transfer hangs with a handle that refuses to abort.
        return {
          abort: () => {
            abortAttempts += 1;
            throw new Error('handle already gone');
          },
        };
      });
      const api = installModule();

      const queued = api.enqueueDownload({ format: 'video' });
      queued.catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 10));

      document.querySelector('.yp-download-manager-item-cancel')?.click();

      expect(document.querySelector('.yp-download-manager-item-info')?.textContent).toContain(
        'Cancelled'
      );
      expect(abortAttempts).toBeGreaterThan(0);
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();

      // Removing the item later retries the same failing handle.
      window.YouTubeUtils.logSuppressed.mockClear();
      await new Promise(resolve => setTimeout(resolve, 1200));
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
      expect(
        document.querySelector('.yp-download-manager-item')?.classList.contains('removing')
      ).toBe(true);
    }, 10000);
  });

  describe('Cobalt instance handling', () => {
    /** Answer the Cobalt directory listing and the per-instance POST calls. */
    function serveCobalt(directoryBody, instanceResponder) {
      /** @type {string[]} */
      const urls = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        urls.push(url);
        if (url.includes('cobalt.directory')) {
          options.onload({ status: 200, responseText: directoryBody });
          return { abort: jest.fn() };
        }
        const result = instanceResponder(url) || {};
        options.onload({ status: result.status ?? 200, responseText: result.responseText ?? '' });
        return { abort: jest.fn() };
      });
      return urls;
    }

    test('directory entries given as objects are accepted and malformed ones dropped', async () => {
      window.YouTubePlusSettingsStore = {
        get: key => key === 'allowCobaltDiscovery',
      };
      const urls = serveCobalt(
        JSON.stringify({
          data: {
            youtube: [
              'https://plain.example',
              { api: 'https://object.example/' },
              { api: 'http://insecure.example' },
              { api: 'https://user:pass@creds.example' },
              { api: 'https://with-path.example/api' },
              { nope: true },
              null,
            ],
          },
        }),
        () => ({ status: 503, responseText: '' })
      );
      const api = installModule();

      await api.downloadViaCobalt({ format: 'video' }).catch(() => undefined);

      const attempted = urls.filter(url => !url.includes('cobalt.directory'));
      expect(attempted.some(url => url.startsWith('https://plain.example'))).toBe(true);
      // The trailing slash is normalised away before the instance is contacted.
      expect(attempted.some(url => url.startsWith('https://object.example'))).toBe(true);
      expect(attempted.some(url => url.includes('insecure.example'))).toBe(false);
      expect(attempted.some(url => url.includes('creds.example'))).toBe(false);
      expect(attempted.some(url => url.includes('with-path.example'))).toBe(false);
    });

    test('cancelling before the first instance stops the ladder', async () => {
      const urls = serveCobalt('{}', () => ({ status: 503, responseText: '' }));
      const api = installModule();
      let checks = 0;

      await expect(
        api.downloadViaCobalt({
          format: 'video',
          onCancel: () => {
            checks += 1;
            // The session guard sees "not cancelled"; the loop guard does not.
            return checks > 1;
          },
        })
      ).rejects.toThrow('Download cancelled');
      expect(urls.filter(url => !url.includes('cobalt.directory'))).toHaveLength(0);
    });

    test('a cancelled tunnel download never fetches the tunnel file', async () => {
      const urls = serveCobalt('{}', url =>
        url.endsWith('/')
          ? {
              status: 200,
              responseText: JSON.stringify({
                status: 'tunnel',
                url: 'https://tunnel.example/f.mp4',
              }),
            }
          : { status: 200, responseText: '' }
      );
      const api = installModule();
      let checks = 0;

      await expect(
        api.downloadViaCobalt({
          format: 'video',
          onCancel: () => {
            checks += 1;
            return checks > 2;
          },
        })
      ).rejects.toThrow('Download cancelled');
      expect(urls.some(url => url.includes('tunnel.example'))).toBe(false);
    });
  });

  describe('modal focus trap', () => {
    test('reopening the modal releases the previous trap', async () => {
      const release = jest.fn();
      window.YouTubePlusModalHandlers = {
        createFocusTrap: jest.fn(() => release),
      };
      const api = installModule();

      api.openModal();
      api.openModal();
      expect(release).toHaveBeenCalledTimes(1);

      delete window.YouTubePlusModalHandlers;
    });

    test('a throwing focus-trap release is swallowed on reopen and on close', async () => {
      window.YouTubePlusModalHandlers = {
        createFocusTrap: jest.fn(() => () => {
          throw new Error('trap already gone');
        }),
      };
      const api = installModule();

      api.openModal();
      expect(() => api.openModal()).not.toThrow();
      expect(() => document.dispatchEvent(new window.KeyboardEvent('keydown'))).not.toThrow();
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();

      delete window.YouTubePlusModalHandlers;
    });
  });
});
