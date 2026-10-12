/**
 * Unit tests for the download module's PoT (Proof-of-Origin Token) capture and
 * elicitation internals: the fetch/XHR hooks, the per-video parameter cache and
 * the player caption-toggle elicitation flow.
 */

describe('Download PoT elicitation and cache', () => {
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
        isShortsRoute: jest.fn(() => window.location.pathname.startsWith('/shorts')),
        isYouTubeDomain: jest.fn(() => true),
        isChannelRoute: jest.fn(() => false),
        isSettingsModalOpen: jest.fn(() => false),
        createIsRelevantRoute: () => () => true,
        createWithErrorBoundary: _name => fn => fn,
        logSuppressed: jest.fn(),
        getRoute: jest.fn(() => (window.location.pathname === '/watch' ? 'watch' : '')),
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

    // jest resets mock implementations between tests, so the shared shim from
    // test/setup.js resolves to undefined. Every test installs its own fetch so
    // the page-fetch pre-pass is deterministic and never touches the network.
    global.fetch = jest.fn(() => Promise.reject(new Error('network disabled in unit tests')));
  });

  /** Collect every URL the module requests through the GM transport. */
  /**
   * @param {string | ((url: string) => string)} payloadFor
   * @returns {string[]}
   */
  function collectRequests(payloadFor) {
    /** @type {string[]} */
    const urls = [];
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      urls.push(url);
      const urlBody = typeof payloadFor === 'function' ? payloadFor(url) : payloadFor || '';
      options.onload({ status: 200, responseText: urlBody });
      return { abort: jest.fn() };
    });
    return urls;
  }

  const JSON3_PAYLOAD = JSON.stringify({
    events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hello' }] }],
  });

  describe('page-global resolution and install guards', () => {
    test('hooks degrade silently when the page global is not an object', () => {
      Object.defineProperty(globalThis, 'unsafeWindow', {
        configurable: true,
        writable: true,
        value: null,
      });
      const api = installModule();

      expect(() => api._installPotHooksOnce()).not.toThrow();
      // The real fetch must be untouched when there is nothing to patch.
      expect(window.fetch.__ytpPlusPotPatch).toBeUndefined();
    });

    test('hooks fall back to window when unsafeWindow is not defined at all', () => {
      delete globalThis.unsafeWindow;
      const api = installModule();

      api._installPotHooksOnce();
      expect(window.fetch.__ytpPlusPotPatch).toBe(true);
    });

    test('a throwing page transport is swallowed and fetch stays patched', () => {
      const originalXHR = window.XMLHttpRequest;
      Object.defineProperty(window, 'XMLHttpRequest', {
        configurable: true,
        get() {
          throw new Error('sandboxed window');
        },
      });
      try {
        const api = installModule();

        expect(() => api._installPotHooksOnce()).not.toThrow();
        // fetch was patched before the XHR access blew up, and the module
        // stayed usable instead of aborting the subtitle feature.
        expect(window.fetch.__ytpPlusPotPatch).toBe(true);
      } finally {
        Object.defineProperty(window, 'XMLHttpRequest', {
          configurable: true,
          writable: true,
          value: originalXHR,
        });
      }
    });
  });

  describe('fetch and XHR interception input shapes', () => {
    test('a captured pot is attached to the module own subtitle requests', async () => {
      const api = installModule();
      api._installPotHooksOnce();

      await window
        .fetch(
          'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en&pot=TOKEN1&potc=2&c=WEB&cver=1'
        )
        .catch(() => undefined);

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        languageName: 'English',
        format: 'srt',
      });

      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every(u => u.includes('pot=TOKEN1'))).toBe(true);
      expect(urls.every(u => u.includes('potc=2'))).toBe(true);
    });

    test('URL objects and request-like objects are both unwrapped', async () => {
      const api = installModule();
      api._installPotHooksOnce();

      // URL instance branch
      await window
        .fetch(new URL('https://www.youtube.com/api/timedtext?v=test12345ab&lang=en&pot=URLTOKEN'))
        .catch(() => undefined);
      // Plain request-like object with a string url
      await window
        .fetch({ url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en&pot=OBJTOKEN' })
        .catch(() => undefined);
      // No url at all: ignored, must not throw
      await window.fetch(1234).catch(() => undefined);
      await window.fetch({ toString: () => 'nope' }).catch(() => undefined);

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      // The cache keeps the most recent capture only.
      expect(urls.every(u => u.includes('pot=OBJTOKEN'))).toBe(true);
      expect(urls.some(u => u.includes('pot=URLTOKEN'))).toBe(false);
    });

    test('timedtext URLs without a video id or pot are ignored', async () => {
      const api = installModule();
      api._installPotHooksOnce();

      await window
        .fetch('https://www.youtube.com/api/timedtext?pot=NOVIDEO')
        .catch(() => undefined);
      await window
        .fetch('https://www.youtube.com/api/timedtext?v=test12345ab&pot=')
        .catch(() => undefined);
      await window.fetch('https://www.youtube.com/api/other?v=x&pot=y').catch(() => undefined);

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      expect(urls.every(u => !u.includes('pot='))).toBe(true);
    });

    test('XHR open captures string URLs and ignores non-string ones', async () => {
      const api = installModule();
      api._installPotHooksOnce();

      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://www.youtube.com/api/timedtext?v=test12345ab&pot=XHRTOKEN');
      // Non-string url argument must be ignored without throwing.
      xhr.open('GET', new URL('https://www.youtube.com/api/timedtext?v=other'));
      try {
        xhr.open('GET', undefined);
      } catch (_e) {
        // jsdom rejects undefined urls; the hook must not have thrown first.
      }

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      expect(urls.every(u => u.includes('pot=XHRTOKEN'))).toBe(true);
    });

    test('the per-video cache evicts its oldest entry beyond the cap', async () => {
      const api = installModule();
      api._installPotHooksOnce();

      const firstId = 'aaaaaaaaaaa';
      await window
        .fetch(`https://www.youtube.com/api/timedtext?v=${firstId}&pot=OLDEST`)
        .catch(() => undefined);
      for (let i = 0; i < 60; i += 1) {
        const id = `vid${String(i).padStart(7, '0')}`;
        await window
          .fetch(`https://www.youtube.com/api/timedtext?v=${id}&pot=NEW${i}`)
          .catch(() => undefined);
      }

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: firstId,
        url: `https://www.youtube.com/api/timedtext?v=${firstId}&lang=en`,
        languageCode: 'en',
        format: 'srt',
      });

      expect(urls.every(u => !u.includes('pot=OLDEST'))).toBe(true);
    });

    test('an unparseable capture URL is ignored without breaking the page', async () => {
      const api = installModule();
      api._installPotHooksOnce();

      // `%` sequences that URLSearchParams cannot parse must not throw.
      await window
        .fetch('https://www.youtube.com/api/timedtext?v=test12345ab&pot=%E0%A4%A')
        .catch(() => undefined);

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      expect(urls.length).toBeGreaterThan(0);
    });
  });

  describe('caption-toggle elicitation', () => {
    /**
     * @param {{ tracks?: unknown, priorTrack?: unknown, noPlayerOptions?: boolean }} opts
     */
    function mountPlayer(opts = {}) {
      const player = document.createElement('div');
      player.className = 'html5-video-player';
      if (!opts.noPlayerOptions) {
        player.getOption = jest.fn((kind, sub) =>
          kind === 'captions' && sub === 'tracklist'
            ? opts.tracks
            : kind === 'captions' && sub === 'track'
              ? opts.priorTrack
              : undefined
        );
        player.setOption = jest.fn((kind, sub, value) => {
          if (kind === 'captions' && sub === 'track' && value && typeof value === 'object') {
            // The real player answers a caption switch by issuing its own
            // timedtext request; emulate that so the wait loop can observe a pot.
            const trackId = String(value.languageCode || 'en');
            window
              .fetch(
                `https://www.youtube.com/api/timedtext?v=test12345ab&lang=${trackId}&pot=ELICITED`
              )
              .catch(() => undefined);
          }
        });
      }
      document.body.appendChild(player);

      const ccBtn = document.createElement('button');
      ccBtn.className = 'ytp-subtitles-button';
      ccBtn.setAttribute('aria-pressed', 'false');
      ccBtn.click = jest.fn(function () {
        this.setAttribute(
          'aria-pressed',
          this.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'
        );
      });
      document.body.appendChild(ccBtn);
      return { player, ccBtn };
    }

    test('toggling the caption track captures a pot that is then reused', async () => {
      const api = installModule();
      mountPlayer({
        tracks: [
          { languageCode: 'de', kind: 'asr' },
          { languageCode: 'ru', kind: 'asr' },
        ],
        priorTrack: { languageCode: 'de' },
      });

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      expect(urls.every(u => u.includes('pot=ELICITED'))).toBe(true);
    });

    test('a page with no player element yields no pot', async () => {
      const api = installModule();
      document.body.innerHTML = '<div class="unrelated"></div>';

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      expect(urls.every(u => !u.includes('pot='))).toBe(true);
    });

    test('a watch page without a v parameter is never elicited', async () => {
      global.mockLocation({
        href: 'https://www.youtube.com/feed/subscriptions',
        pathname: '/feed/subscriptions',
        search: '',
      });
      const api = installModule();
      mountPlayer({ tracks: [{ languageCode: 'en', kind: 'asr' }] });

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      expect(urls.every(u => !u.includes('pot='))).toBe(true);
    });

    test('falling back to the CC button when the player has no setOption', async () => {
      const api = installModule();
      const { player, ccBtn } = mountPlayer({ noPlayerOptions: true });
      player.getOption = undefined;

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      // No pot exists yet, and the CC button click is the documented fallback.
      expect(ccBtn.click).toHaveBeenCalled();
      expect(urls.every(u => !u.includes('pot='))).toBe(true);
    });

    test('a player whose getOption throws is tolerated', async () => {
      const api = installModule();
      const { player } = mountPlayer();
      player.getOption = jest.fn(() => {
        throw new Error('captions module not ready');
      });

      const urls = collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      expect(urls.length).toBeGreaterThan(0);
    });

    test('restore falls back to the CC button when there is no prior track', async () => {
      const api = installModule();
      const { player, ccBtn } = mountPlayer({ tracks: [] });
      player.toggleSubtitles = jest.fn();

      collectRequests(JSON3_PAYLOAD);
      await api.downloadSubtitle({
        videoId: 'test12345ab',
        url: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
        languageCode: 'en',
        format: 'srt',
      });

      // The elicitation click pressed CC and the restore click toggled it back.
      expect(ccBtn.click).toHaveBeenCalledTimes(2);
      expect(ccBtn.getAttribute('aria-pressed')).toBe('false');
      expect(player.toggleSubtitles).toBeDefined();
    });
  });
});
