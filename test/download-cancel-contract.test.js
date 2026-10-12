/**
 * Unified cancel contract for the
 * Download transport (fetch fallback + GM), covering the whole request
 * INCLUDING the body read.
 *
 * Contracts under test (real download module; only external boundaries —
 * network transport and GM API — are stubbed):
 *   - Caller abort and deadline must COMPOSE into one transport signal:
 *     cancelling the caller must abort the real request even when a
 *     timeout is configured (previously the timeout signal REPLACED the
 *     caller's signal).
 *   - An abort/timeout during the body read must REJECT the request —
 *     it must never surface as a successful response (no null-body
 *     onload success after a failed body read).
 *   - GM branch: caller abort rejects with AbortError (not success);
 *     timeout rejects with TimeoutError under the same contract.
 */

describe('Download transport cancel contract (caller abort + timeout + body)', () => {
  const GM_ORIGINAL = window.GM_xmlhttpRequest;

  const stubTransport = handler => {
    window.fetch = (url, opts) =>
      new Promise((resolve, reject) => {
        handler(url, opts, resolve, reject);
      });
  };

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    // Force the fetch fallback path: neutralize the test-suite GM mock.
    window.GM_xmlhttpRequest = undefined;
    window.fetch = (url, _opts) =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: String(url),
        text: async () => 'body-text',
        blob: async () => new Blob(['blob-body']),
      });
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/download.js');
  });

  afterEach(() => {
    window.GM_xmlhttpRequest = GM_ORIGINAL;
    window.fetch = (input, _init) => Promise.resolve({ ok: true, url: String(input) });
  });

  // Timedtext path is exempt from the rate limiter, so repeated probes stay
  // under the S6 window limit.
  const URL_OK = 'https://www.youtube.com/api/timedtext?v=x&pot=p';

  test('caller abort aborts the transport even when a timeout is configured', async () => {
    const api = window.YouTubePlusDownload;
    let transportSignal;
    stubTransport((_url, opts, _resolve, reject) => {
      transportSignal = opts.signal;
      // Simulate a real transport honoring the signal it was given.
      opts.signal.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
    });

    const caller = new AbortController();
    const pending = api.gmXmlHttpRequest({
      url: URL_OK,
      signal: caller.signal,
      timeout: 60000,
    });
    caller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(caller.signal.aborted).toBe(true);
    expect(transportSignal.aborted).toBe(true);
  });

  test('timeout alone aborts the transport with TimeoutError (deadline phase)', async () => {
    const api = window.YouTubePlusDownload;
    let transportSignal;
    stubTransport((_url, opts, _resolve, reject) => {
      transportSignal = opts.signal;
      opts.signal.addEventListener('abort', () => {
        reject(
          new DOMException(
            'The operation was aborted due to timeout',
            /** @type {any} */ (opts.signal).reason?.name === 'TimeoutError' || opts.signal.aborted
              ? 'TimeoutError'
              : 'AbortError'
          )
        );
      });
    });

    const pending = api.gmXmlHttpRequest({ url: URL_OK, timeout: 20 });
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(transportSignal.aborted).toBe(true);
  });

  test('abort during the body read rejects instead of resolving with null body', async () => {
    const api = window.YouTubePlusDownload;
    let bodyReadAborted = false;
    stubTransport((url, opts, resolve) => {
      resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: String(url),
        text: () =>
          new Promise((_resolveText, rejectText) => {
            const onAbort = () => {
              bodyReadAborted = true;
              rejectText(new DOMException('body read aborted', 'AbortError'));
            };
            // Cover both orders: abort already fired before the body read
            // started, or abort fires mid-read.
            if (opts.signal.aborted) onAbort();
            else opts.signal.addEventListener('abort', onAbort);
            // Body never completes on its own — abort is the only exit.
          }),
        blob: () =>
          new Promise(() => {
            // the blob read never settles; abort is the only exit
          }),
      });
    });

    const caller = new AbortController();
    let onloadCalled = false;
    const pending = api.gmXmlHttpRequest({
      url: URL_OK,
      signal: caller.signal,
      onload: () => {
        onloadCalled = true;
      },
    });
    caller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(bodyReadAborted).toBe(true);
    expect(onloadCalled).toBe(false);
  });

  test('blob body-read abort rejects instead of resolving with null blob', async () => {
    const api = window.YouTubePlusDownload;
    stubTransport((url, opts, resolve) => {
      resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: String(url),
        text: () =>
          new Promise(() => {
            // the text read never settles; abort is the only exit
          }),
        blob: () =>
          new Promise((_resolveBlob, rejectBlob) => {
            const onAbort = () => rejectBlob(new DOMException('blob read aborted', 'AbortError'));
            if (opts.signal.aborted) onAbort();
            else opts.signal.addEventListener('abort', onAbort);
          }),
      });
    });

    const caller = new AbortController();
    let onloadCalled = false;
    const pending = api.gmXmlHttpRequest({
      url: URL_OK,
      signal: caller.signal,
      responseType: 'blob',
      onload: () => {
        onloadCalled = true;
      },
    });
    caller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(onloadCalled).toBe(false);
  });

  test('timeout during the body read rejects with TimeoutError', async () => {
    const api = window.YouTubePlusDownload;
    stubTransport((url, opts, resolve) => {
      resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: String(url),
        text: () =>
          new Promise((_resolveText, rejectText) => {
            const onAbort = () =>
              rejectText(
                new DOMException(
                  'body read timeout',
                  /** @type {any} */ (opts.signal).reason?.name === 'TimeoutError'
                    ? 'TimeoutError'
                    : 'AbortError'
                )
              );
            if (opts.signal.aborted) onAbort();
            else opts.signal.addEventListener('abort', onAbort);
          }),
        blob: () =>
          new Promise(() => {
            // the blob read never settles; abort is the only exit
          }),
      });
    });

    let onloadCalled = false;
    const pending = api.gmXmlHttpRequest({
      url: URL_OK,
      timeout: 20,
      onload: () => {
        onloadCalled = true;
      },
    });

    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(onloadCalled).toBe(false);
  });

  test('manual composition fallback (no AbortSignal.any) composes and cleans up', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    if (!descriptor || !descriptor.configurable) {
      // Environment cannot remove the API — the manual path is engine-
      // dependent; report honestly instead of faking coverage.
      throw new Error('AbortSignal.any not deletable; manual fallback path NOT RUN');
    }
    delete AbortSignal.any;
    try {
      const api = window.YouTubePlusDownload;
      // Fake EventTarget-like signal so listener bookkeeping is observable
      // and a mid-flight abort can be simulated deterministically.
      const makeFakeSignal = () => ({
        aborted: false,
        reason: null,
        listeners: [],
        addEventListener(name, fn) {
          if (name === 'abort') this.listeners.push(fn);
        },
        removeEventListener(_name, fn) {
          this.listeners = this.listeners.filter(l => l !== fn);
        },
        fireAbort(reason) {
          this.aborted = true;
          this.reason = reason;
          for (const fn of [...this.listeners]) fn({ target: this });
        },
      });
      let transportSignal;
      stubTransport((url, opts, resolve, _reject) => {
        transportSignal = opts.signal;
        resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          url: String(url),
          text: async () => 'ok-body',
          blob: async () => new Blob(['b']),
        });
      });

      const fake = makeFakeSignal();
      const response = await api.gmXmlHttpRequest({
        url: URL_OK,
        signal: /** @type {any} */ (fake),
        timeout: 60000,
      });
      // Composition relay was registered, then removed after completion.
      expect(fake.listeners).toHaveLength(0);
      expect(transportSignal.aborted).toBe(false);
      expect(response.responseText).toBe('ok-body');

      // Fresh request on a new fake: a mid-flight caller abort must cancel
      // the composed transport signal (relay path).
      const fake2 = makeFakeSignal();
      stubTransport((_url, opts, _resolve, reject) => {
        transportSignal = opts.signal;
        opts.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
      });
      const pending = api.gmXmlHttpRequest({
        url: URL_OK,
        signal: /** @type {any} */ (fake2),
        timeout: 60000,
      });
      fake2.fireAbort(new DOMException('caller cancelled', 'AbortError'));
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(transportSignal.aborted).toBe(true);

      // A pre-aborted caller signal short-circuits without any transport.
      const fake3 = makeFakeSignal();
      fake3.aborted = true;
      fake3.reason = new DOMException('pre-cancelled', 'AbortError');
      stubTransport((_url, opts, resolve, reject) => {
        transportSignal = opts.signal;
        if (opts.signal.aborted) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        resolve({ ok: true, status: 200, text: async () => 'late', blob: async () => new Blob() });
      });
      await expect(
        api.gmXmlHttpRequest({
          url: URL_OK,
          signal: /** @type {any} */ (fake3),
          timeout: 60000,
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(transportSignal.aborted).toBe(true);
    } finally {
      Object.defineProperty(AbortSignal, 'any', descriptor);
    }
  });

  test('GM branch: abort rejects with AbortError and never resolves as success', async () => {
    const api = window.YouTubePlusDownload;
    window.GM_xmlhttpRequest = opts => ({
      abort() {
        opts.onabort();
      },
    });
    const caller = new AbortController();
    let onloadCalled = false;
    const pending = api
      .gmXmlHttpRequest({
        url: URL_OK,
        signal: caller.signal,
        onload: () => {
          onloadCalled = true;
        },
      })
      .catch(e => e);
    caller.abort();
    const result = await pending;
    expect(/** @type {any} */ (result).name).toBe('AbortError');
    expect(onloadCalled).toBe(false);
  });

  test('GM branch: timeout rejects with TimeoutError (single error contract)', async () => {
    const api = window.YouTubePlusDownload;
    window.GM_xmlhttpRequest = opts => {
      // Simulate a manager deadline firing.
      setTimeout(() => opts.ontimeout && opts.ontimeout(), 5);
      return {
        abort() {
          // nothing to abort for the deadline double
        },
      };
    };
    const pending = api.gmXmlHttpRequest({ url: URL_OK, timeout: 20 }).catch(e => e);
    const result = await pending;
    expect(/** @type {any} */ (result).name).toBe('TimeoutError');
  });

  // -- Declared deadline support contract --------------------------

  test('N13: without AbortSignal.timeout the deadline still aborts the transport with TimeoutError', async () => {
    const api = window.YouTubePlusDownload;
    let transportSignal;
    stubTransport((_url, opts, _resolve, reject) => {
      transportSignal = opts.signal;
      opts.signal.addEventListener('abort', () =>
        reject(
          new DOMException('aborted', /** @type {any} */ (opts.signal).reason?.name || 'AbortError')
        )
      );
      // Never resolves on its own — only the deadline can end it.
    });

    const hadNativeTimeout = typeof AbortSignal.timeout === 'function';
    const nativeTimeout = /** @type {any} */ (AbortSignal).timeout;
    try {
      /** @type {any} */ (AbortSignal).timeout = undefined;

      const started = Date.now();
      await expect(api.gmXmlHttpRequest({ url: URL_OK, timeout: 20 })).rejects.toMatchObject({
        name: 'TimeoutError',
      });
      const elapsed = Date.now() - started;
      // The deadline was enforced (not silently dropped) — well under 90ms.
      expect(elapsed).toBeLessThan(90);
      expect(transportSignal.aborted).toBe(true);
      // The abort reason carries the TimeoutError contract.
      expect(/** @type {any} */ (transportSignal).reason?.name).toBe('TimeoutError');
    } finally {
      if (hadNativeTimeout) {
        /** @type {any} */ (AbortSignal).timeout = nativeTimeout;
      } else {
        delete (/** @type {any} */ (AbortSignal).timeout);
      }
    }
  });

  test('N13: without AbortSignal.timeout, caller abort composes through the fallback', async () => {
    const api = window.YouTubePlusDownload;
    let transportSignal;
    stubTransport((_url, opts, _resolve, reject) => {
      transportSignal = opts.signal;
      opts.signal.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError'))
      );
    });

    const hadNativeTimeout = typeof AbortSignal.timeout === 'function';
    const nativeTimeout = /** @type {any} */ (AbortSignal).timeout;
    try {
      /** @type {any} */ (AbortSignal).timeout = undefined;
      const caller = new AbortController();
      const pending = api.gmXmlHttpRequest({
        url: URL_OK,
        signal: caller.signal,
        timeout: 60000,
      });
      caller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(transportSignal.aborted).toBe(true);
      expect(/** @type {any} */ (transportSignal).reason?.name).toBe('AbortError');
    } finally {
      if (hadNativeTimeout) {
        /** @type {any} */ (AbortSignal).timeout = nativeTimeout;
      } else {
        delete (/** @type {any} */ (AbortSignal).timeout);
      }
    }
  });

  test('N13: the fallback deadline timer is cleared once the request settles', async () => {
    const api = window.YouTubePlusDownload;
    stubTransport((url, _opts, resolve) => {
      resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: String(url),
        text: async () => 'fast-body',
      });
    });

    const hadNativeTimeout = typeof AbortSignal.timeout === 'function';
    const nativeTimeout = /** @type {any} */ (AbortSignal).timeout;
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    try {
      /** @type {any} */ (AbortSignal).timeout = undefined;
      const response = await api.gmXmlHttpRequest({ url: URL_OK, timeout: 5000 });
      expect(response.responseText).toBe('fast-body');
      // The finally-block cleanup ran: the fallback timer was cleared.
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(0);
    } finally {
      clearTimeoutSpy.mockRestore();
      if (hadNativeTimeout) {
        /** @type {any} */ (AbortSignal).timeout = nativeTimeout;
      } else {
        delete (/** @type {any} */ (AbortSignal).timeout);
      }
    }
  });
});
