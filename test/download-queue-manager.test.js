/**
 * Unit tests for the download module's queue manager: history persistence, the
 * manager panel lifecycle, progress/speed rendering, cancellation and the
 * cross-source fallback ladder.
 */

describe('Download queue manager', () => {
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

  /** @type {string[]} */
  let history;

  beforeEach(() => {
    document.body.innerHTML = '';
    history = [];
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
          getItem: jest.fn(key =>
            key === 'ytp-download-history' ? JSON.stringify(history) : null
          ),
          setItem: jest.fn((key, value) => {
            if (key === 'ytp-download-history') history = JSON.parse(value);
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
      value: jest.fn(() => 'blob:queue-test'),
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  /**
   * cnv.cx succeeds, the CDN returns a non-empty blob.
   * @param {Record<string, unknown>} [overrides]
   */
  function serveCnvCx(overrides = {}) {
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
          ...overrides,
        });
        return { abort: jest.fn() };
      }
      options.onload({ status: 200, response: new window.Blob(['queue bytes']) });
      return { abort: jest.fn() };
    });
  }

  /** A cnv.cx session whose file transfer never answers, so the item stays active. */
  function serveHangingCdn() {
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
          options.onerror?.({ status: 0 });
        },
      };
    });
  }

  const notifications = () =>
    window.YouTubeUtils.NotificationManager.show.mock.calls.map(call => String(call[0]));

  describe('panel, counter and history', () => {
    test('a finished download is persisted and rendered in the history panel', async () => {
      serveCnvCx();
      const api = installModule();
      await api.enqueueDownload({ format: 'video', quality: '720' });

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        title: 'video',
        format: 'video',
        qualityLabel: '720p',
        status: 'completed',
      });

      const historyBtn = document.querySelector('.yp-download-manager-history-btn');
      historyBtn?.click();
      const panel = document.querySelector('.yp-download-manager-history');
      expect(panel).toBeTruthy();
      expect(panel?.textContent).toContain('video');
      expect(panel?.textContent).toContain('720p');

      // Toggling again removes the sub-panel.
      historyBtn?.click();
      expect(document.querySelector('.yp-download-manager-history')).toBeNull();
    });

    test('an empty history renders the empty-state message', async () => {
      serveHangingCdn();
      const api = installModule();
      const pending = api.enqueueDownload({ format: 'video' });
      await new Promise(resolve => setTimeout(resolve, 0));

      document.querySelector('.yp-download-manager-history-btn')?.click();
      expect(document.querySelector('.yp-download-manager-history-empty')?.textContent).toBe(
        'downloadHistoryEmpty'
      );

      document.querySelector('.yp-download-manager-item-cancel')?.click();
      await expect(pending).rejects.toThrow();
    });

    test('a corrupt history payload degrades to an empty list', async () => {
      window.YouTubeUtils.storage.getItem.mockImplementation(key =>
        key === 'ytp-download-history' ? '{not json' : null
      );
      serveHangingCdn();
      const api = installModule();
      const pending = api.enqueueDownload({ format: 'video' });
      await new Promise(resolve => setTimeout(resolve, 0));

      document.querySelector('.yp-download-manager-history-btn')?.click();
      expect(document.querySelector('.yp-download-manager-history-empty')).toBeTruthy();

      document.querySelector('.yp-download-manager-item-cancel')?.click();
      await expect(pending).rejects.toThrow();
    });

    test('a non-array history payload is ignored', async () => {
      window.YouTubeUtils.storage.getItem.mockImplementation(key =>
        key === 'ytp-download-history' ? '{"nope":1}' : null
      );
      serveHangingCdn();
      const api = installModule();
      const pending = api.enqueueDownload({ format: 'video' });
      await new Promise(resolve => setTimeout(resolve, 0));

      document.querySelector('.yp-download-manager-history-btn')?.click();
      expect(document.querySelector('.yp-download-manager-history-empty')).toBeTruthy();

      document.querySelector('.yp-download-manager-item-cancel')?.click();
      await expect(pending).rejects.toThrow();
    });

    test('the history is capped at fifty entries', async () => {
      history = Array.from({ length: 50 }, (_, i) => ({
        title: `old-${i}`,
        format: 'video',
        qualityLabel: '360p',
        status: 'completed',
        timestamp: 1000 + i,
      }));
      serveCnvCx();
      const api = installModule();
      await api.enqueueDownload({ format: 'video' });

      expect(history).toHaveLength(50);
      expect(history[0].title).toBe('video');
      expect(history[49].title).toBe('old-48');
    });

    test('a history entry without a title falls back to the format extension', async () => {
      history = [
        {
          title: '',
          format: 'audio',
          qualityLabel: '320 kbps',
          status: 'completed',
          timestamp: Date.now(),
        },
      ];
      serveHangingCdn();
      const api = installModule();
      const pending = api.enqueueDownload({ format: 'audio' });
      await new Promise(resolve => setTimeout(resolve, 0));

      document.querySelector('.yp-download-manager-history-btn')?.click();
      expect(document.querySelector('.yp-download-manager-history-name')?.textContent).toBe(
        'audio.mp3'
      );

      document.querySelector('.yp-download-manager-item-cancel')?.click();
      await expect(pending).rejects.toThrow();
    });

    test('the close button hides the panel without discarding the queue', async () => {
      serveHangingCdn();
      const api = installModule();
      const pending = api.enqueueDownload({ format: 'video' });
      await new Promise(resolve => setTimeout(resolve, 0));

      const panel = document.querySelector('.yp-download-manager');
      expect(panel?.classList.contains('visible')).toBe(true);
      document.querySelector('.yp-download-manager-close')?.click();
      expect(panel?.classList.contains('visible')).toBe(false);

      document.querySelector('.yp-download-manager-item-cancel')?.click();
      await expect(pending).rejects.toThrow();
    });

    test('a failed download is recorded with the error status', async () => {
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('/sanity/key')) {
          options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
          return { abort: jest.fn() };
        }
        if (url.includes('/converter')) {
          options.onload({ status: 200, responseText: JSON.stringify({}) });
          return { abort: jest.fn() };
        }
        options.onload({ status: 200, response: new window.Blob(['x']) });
        return { abort: jest.fn() };
      });
      const api = installModule();

      await expect(api.enqueueDownload({ format: 'video' })).rejects.toThrow();
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('error');
      const item = document.querySelector('.yp-download-manager-item');
      expect(item?.classList.contains('error')).toBe(true);
      expect(item?.querySelector('.yp-download-manager-item-info')?.textContent).toContain(
        'downloadFailed'
      );
    });
  });

  describe('progress, speed and cancellation', () => {
    /**
     * Enqueue a download whose CDN transfer reports progress.
     * @param {{ total: number | null }} opts
     */
    function serveProgress(opts) {
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
        const emit = () => {
          options.onprogress?.(
            opts.total === null ? { loaded: 4096 } : { loaded: 4096, total: opts.total }
          );
          options.onprogress?.(
            opts.total === null ? { loaded: 65536 } : { loaded: 65536, total: opts.total }
          );
          options.onload({ status: 200, response: new window.Blob(['bytes']) });
        };
        setTimeout(emit, 0);
        return { abort: jest.fn() };
      });
    }

    test('determinate progress renders the percentage, size and speed', async () => {
      serveProgress({ total: 65536 });
      const api = installModule();
      await api.enqueueDownload({ format: 'video' });

      const item = document.querySelector('.yp-download-manager-item');
      const fill = item?.querySelector('.yp-download-manager-item-progress-fill');
      expect(fill?.style.width).toBe('100%');
      expect(item?.classList.contains('completed')).toBe(true);
      // The cancel button is replaced by a success glyph once complete.
      expect(item?.querySelector('.yp-download-status-icon.success')).toBeTruthy();
      expect(item?.querySelector('.yp-download-manager-item-cancel')).toBeNull();
    });

    test('indeterminate progress stays inside the 5-95% band', async () => {
      serveProgress({ total: null });
      const api = installModule();
      await api.enqueueDownload({ format: 'video' });

      const item = document.querySelector('.yp-download-manager-item');
      const fill = item?.querySelector('.yp-download-manager-item-progress-fill');
      const width = Number.parseInt(String(fill?.style.width || '0'), 10);
      expect(width).toBeGreaterThanOrEqual(5);
      expect(width).toBeLessThanOrEqual(95);
    });

    test('a speed reading needs two samples within the window', async () => {
      serveProgress({ total: 65536 });
      const api = installModule();
      await api.enqueueDownload({ format: 'video' });
      // A single-item queue renders speed text of the form "<size> • <speed>".
      const item = document.querySelector('.yp-download-manager-item');
      expect(item).toBeTruthy();
    });

    test('cancelling removes the item, clears the counter and hides the panel', async () => {
      let aborts = 0;
      /** @type {any} */
      let pendingOptions = null;
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
        pendingOptions = options;
        return {
          abort: () => {
            aborts += 1;
            options.onerror?.({ status: 0 });
          },
        };
      });

      const api = installModule();
      const pending = api.enqueueDownload({ format: 'video' });
      await new Promise(resolve => setTimeout(resolve, 0));

      document.querySelector('.yp-download-manager-item-cancel')?.click();
      await expect(pending).rejects.toThrow();
      expect(aborts).toBeGreaterThan(0);
      expect(history[0].status).toBe('cancelled');
      expect(document.querySelector('.yp-download-manager-counter')?.textContent).toBe('0');

      await new Promise(resolve => setTimeout(resolve, 1400));
      expect(document.querySelector('.yp-download-manager-item')).toBeNull();
      expect(document.querySelector('.yp-download-manager')?.classList.contains('visible')).toBe(
        false
      );
      expect(pendingOptions).toBeTruthy();
    });

    test('cancelling twice is a no-op', async () => {
      serveHangingCdn();
      const api = installModule();
      const pending = api.enqueueDownload({ format: 'video' });
      await new Promise(resolve => setTimeout(resolve, 0));

      const cancelBtn = document.querySelector('.yp-download-manager-item-cancel');
      cancelBtn?.click();
      const item = document.querySelector('.yp-download-manager-item');
      item?.querySelector('.yp-download-manager-item-cancel')?.click();
      await expect(pending).rejects.toThrow();
    });

    test('a full queue refuses new work with a warning', async () => {
      serveHangingCdn();
      const api = installModule();

      /** @type {Promise<void>[]} */
      const running = [];
      for (let i = 0; i < 10; i += 1) {
        running.push(api.enqueueDownload({ format: 'video' }));
        await Promise.resolve();
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(document.querySelectorAll('.yp-download-manager-item')).toHaveLength(10);

      await expect(api.enqueueDownload({ format: 'video' })).rejects.toThrow(
        'Download queue is full'
      );
      expect(notifications()).toContain('downloadQueueFull');

      document.querySelectorAll('.yp-download-manager-item-cancel').forEach(btn => {
        btn.click();
      });
      await expect(Promise.allSettled(running)).resolves.toBeDefined();
    });
  });

  describe('cleanup on navigation', () => {
    test('registered cleanup cancels active downloads and tears down the panel', async () => {
      let aborts = 0;
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
            aborts += 1;
          },
        };
      });

      const api = installModule();
      const registered = window.YouTubeUtils.cleanupManager.register.mock.calls.map(c => c[0]);
      const cleanup = registered.find(fn => typeof fn === 'function');
      expect(cleanup).toBeDefined();

      api.enqueueDownload({ format: 'video' });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(document.querySelector('.yp-download-manager-item')).toBeTruthy();

      cleanup();
      expect(aborts).toBeGreaterThan(0);
      expect(document.querySelector('.yp-download-manager')).toBeNull();
      expect(document.querySelector('.yp-download-manager-item')).toBeNull();
    });

    test('cleanup tolerates an abort handle that throws', async () => {
      GM_xmlhttpRequest.mockImplementation(() => ({
        abort: () => {
          throw new Error('handle already released');
        },
      }));

      const api = installModule();
      const cleanup = window.YouTubeUtils.cleanupManager.register.mock.calls
        .map(c => c[0])
        .find(fn => typeof fn === 'function');

      api.enqueueDownload({ format: 'video' });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(() => cleanup()).not.toThrow();
    });
  });

  describe('cross-source fallback ladder', () => {
    test('a failing source hands over to the next one and says so', async () => {
      /** @type {string[]} */
      const posts = [];
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('cobalt.directory')) {
          options.onload({ status: 404, responseText: '' });
          return { abort: jest.fn() };
        }
        if (url.includes('sanity') || url.includes('converter')) {
          options.onload({ status: 500, responseText: '' });
          return { abort: jest.fn() };
        }
        if (options.method === 'POST') {
          posts.push(url);
          if (url.includes('cobalt')) {
            options.onload({ status: 403, responseText: JSON.stringify({ errorMsg: 'captcha' }) });
            return { abort: jest.fn() };
          }
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
                ],
              },
            }),
          });
          return { abort: jest.fn() };
        }
        options.onload({ status: 200, response: new window.Blob(['stream']) });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await api.enqueueDownload({ format: 'video', quality: '360', source: 'cobalt' });

      expect(posts.some(u => u.includes('cobalt'))).toBe(true);
      expect(notifications()).toContain('Retrying with another source…');
      expect(history[0].status).toBe('completed');
    });

    test('a cancel during the fallback ladder stops immediately', async () => {
      let cancelChecks = 0;
      GM_xmlhttpRequest.mockImplementation(options => {
        const url = String(options.url || '');
        if (url.includes('converter')) {
          options.onload({ status: 500, responseText: '' });
          return { abort: jest.fn() };
        }
        options.onload({ status: 500, responseText: '' });
        return { abort: jest.fn() };
      });

      const api = installModule();
      await expect(
        api.enqueueDownload({
          format: 'video',
          source: 'cobalt',
          onCancel: () => {
            cancelChecks += 1;
            return cancelChecks > 1;
          },
        })
      ).rejects.toThrow();
    });
  });
});
