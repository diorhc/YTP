/**
 * @jest-environment jsdom
 */

/**
 * Owner payload transport contract.
 *
 * Community RPCs and uploads carry the capability secret, so they may never
 * fall back to the shared page fetch: without the manager transport the DTO
 * reports an explicit unavailability instead of leaking the payload. Through
 * GM_xmlhttpRequest every failure mode (network error, timeout, abort,
 * malformed or empty body, contract 404) has to surface as an honest error —
 * never as an empty-but-successful read.
 */

describe('Voting owner transport branches', () => {
  const createOkResponse = data => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  const installGlobals = (overrides = {}) => {
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        byId: id => document.getElementById(id),
        $: (selector, root) => (root || document).querySelector(selector),
        t: key => key,
        setSafeHTML: (el, html) => {
          if (el) el.innerHTML = html;
        },
        cleanupManager: null,
        logSuppressed: jest.fn(),
        onSectionActive: jest.fn(),
        isSettingsModalOpen: jest.fn(() => false),
        whenRelevant: jest.fn(),
        safeRequestAnimationFrame: jest.fn(cb => cb(0)),
        ...overrides,
      },
    });
    Object.defineProperty(window, 'YouTubeSafeDOM', {
      configurable: true,
      writable: true,
      value: {
        escapeHTML: text => text,
        renderTemplateClone: (container, html) => {
          if (!container || container.nodeType !== 1) return;
          const tpl = document.createElement('template');
          tpl.innerHTML = String(html ?? '');
          container.replaceChildren(tpl.content.cloneNode(true));
        },
        createFragment: html => {
          const tpl = document.createElement('template');
          tpl.innerHTML = String(html ?? '');
          return tpl.content;
        },
      },
    });
    if (!window.YouTubePlus) window.YouTubePlus = {};
  };

  const setFetch = mock => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: mock });
  };

  const setGm = impl => {
    Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
      configurable: true,
      writable: true,
      value: impl,
    });
  };

  /**
   * Emulate the userscript manager: owner traffic goes through the transport,
   * which delegates to the per-test fetch mock.
   */
  const setDelegatingGm = () => {
    setGm(options => {
      const { method = 'GET', url, headers = {}, data, onload, onerror, onabort } = options;
      let settled = false;
      Promise.resolve()
        .then(() => globalThis.fetch(url, { method, headers, body: data }))
        .then(async res => {
          if (settled) return;
          settled = true;
          let text = '';
          try {
            text = JSON.stringify(await res.json());
          } catch (_e) {
            text = '';
          }
          onload?.({ status: res.status ?? 200, response: text, responseText: text });
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          onerror?.();
        });
      return { abort: () => onabort?.() };
    });
  };

  const boot = () => {
    jest.resetModules();
    require('../src/voting.js');
    return window.YouTubePlusVoting;
  };

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: arr => {
          for (let i = 0; i < arr.length; i++) arr[i] = (i * 7919 + 13) % 256;
          return arr;
        },
      },
    });
    if (!window.YouTubePlus) window.YouTubePlus = {};
    mockLocation({ href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', pathname: '/watch' });
    installGlobals();
    setDelegatingGm();
  });

  afterEach(() => {
    delete globalThis.GM;
  });

  test('without the manager transport an owner payload is refused, not sent through fetch', async () => {
    delete globalThis.GM_xmlhttpRequest;
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    const { VotingApi } = boot();

    const res = await VotingApi.getMyVotes();

    expect(res).toEqual({ userVotes: {}, error: 'Owner transport unavailable' });
    // The capability never leaves through the shared page fetch.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('without the manager transport a public read still uses the plain fetch fallback', async () => {
    delete globalThis.GM_xmlhttpRequest;
    const fetchMock = jest.fn(async () =>
      createOkResponse([{ feature_id: 'f-1', upvotes: 3, downvotes: 1 }])
    );
    setFetch(fetchMock);
    const { VotingApi } = boot();

    const res = await VotingApi.getVoteCounts(['f-1']);

    expect(res).toEqual({ votes: { 'f-1': { upvotes: 3, downvotes: 1 } }, error: null });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/rest/v1/rpc/get_vote_counts');
  });

  test('a non-JSON error body keeps the HTTP status as the reported error', async () => {
    delete globalThis.GM_xmlhttpRequest;
    setFetch(
      jest.fn(async () => ({
        ok: false,
        status: 502,
        // A proxy HTML/error string: not an object, so no reported message.
        json: async () => 'upstream unavailable',
      }))
    );
    const { VotingApi } = boot();

    const res = await VotingApi.getVoteCounts(['f-1']);

    expect(res).toEqual({ votes: {}, error: 'HTTP 502' });
  });

  test('PGRST202 marks the community unavailable and every later write is refused', async () => {
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    setGm(options => {
      options.onload({
        status: 404,
        responseText: JSON.stringify({
          code: 'PGRST202',
          message: 'Could not find the function cast_vote',
        }),
      });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    expect(VotingApi.isCommunityWritable()).toBe(true);
    const res = await VotingApi.castVote('f-1', 1);

    expect(res).toEqual({ success: false, error: 'Could not find the function cast_vote' });
    // Protective mode: a contract mismatch is not transient, so the whole
    // community surface goes read-only instead of offering a futile retry.
    expect(VotingApi.isCommunityWritable()).toBe(false);
    expect((await VotingApi.submitFeature('Title', 'Desc')).error).toContain('read-only');
  });

  test('a malformed body over the manager transport is an error, not an empty page', async () => {
    setGm(options => {
      options.onload({ status: 200, responseText: 'not json at all' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getVoteCounts(['f-1']);

    expect(res).toEqual({ votes: {}, error: 'Malformed JSON response' });
  });

  test('an empty manager body is an error, not a successful empty aggregate', async () => {
    setGm(options => {
      options.onload({ status: 200, response: '', responseText: '' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getFeatureRequests();

    expect(res.error).toBe('Malformed JSON response');
    expect(res.rows).toEqual([]);
  });

  test('a manager network failure surfaces the transport error message', async () => {
    setGm(options => {
      options.onerror();
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getPreviewFeature();

    expect(res).toEqual({ feature: null, error: 'Network request failed' });
  });

  test('a manager request that throws a non-Error falls back to a generic message', async () => {
    setGm(() => {
      throw 'transport exploded';
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getPreviewFeature();

    expect(res).toEqual({ feature: null, error: 'Network request failed' });
  });

  test('a manager timeout is reported as an explicit timeout state, not a hang', async () => {
    setGm(options => {
      options.ontimeout();
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getPreviewFeature();

    expect(res).toEqual({ feature: null, error: 'Request timed out' });
  });

  test('an aborted owner request rejects with AbortError and never resolves as empty', async () => {
    setGm(options => {
      options.onabort();
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    await expect(VotingApi.getPreviewFeature()).rejects.toThrow('Aborted');
  });

  test('an already aborted signal aborts before the manager answers', async () => {
    const ac = new AbortController();
    ac.abort();
    let settled = null;
    setGm(options => {
      settled = options;
      // A manager handle that cannot even be aborted: the reject must not
      // depend on it.
      return undefined;
    });
    const { VotingApi } = boot();

    await expect(
      VotingApi.fetchRest('rpc/get_feature_requests', { signal: ac.signal })
    ).rejects.toThrow('Aborted');
    expect(settled).not.toBeNull();
  });

  test('an abort that cannot reach the manager still rejects and is reported as suppressed', async () => {
    const ac = new AbortController();
    const utils = window.YouTubeUtils;
    setGm(() => ({
      abort() {
        throw new Error('manager abort failed');
      },
    }));
    const { VotingApi } = boot();

    const pending = VotingApi.fetchRest('rpc/get_feature_requests', { signal: ac.signal });
    ac.abort();

    await expect(pending).rejects.toThrow('Aborted');
    expect(utils.logSuppressed).toHaveBeenCalled();
  });

  test('a manager that settles twice keeps the first answer', async () => {
    setGm(options => {
      options.onload({
        status: 200,
        responseText: '[{"feature_id":"f-1","upvotes":1,"downvotes":0}]',
      });
      options.onload({ status: 500, responseText: '[]' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getVoteCounts(['f-1']);

    expect(res).toEqual({ votes: { 'f-1': { upvotes: 1, downvotes: 0 } }, error: null });
  });

  test('a body with neither response nor responseText is malformed, not empty', async () => {
    setGm(options => {
      options.onload({ status: 200 });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getPreviewFeature();

    expect(res).toEqual({ feature: null, error: 'Malformed JSON response' });
  });

  test('a GET without an explicit method is sent as GET through the manager', async () => {
    let captured = null;
    setGm(options => {
      captured = options;
      options.onload({ status: 200, responseText: '{"rows":[],"hasMore":false}' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    await VotingApi.fetchRest('rpc/get_feature_requests');

    expect(captured.method).toBe('GET');
    expect(captured.url).toBe('https://vote.diorhc.space/rest/v1/rpc/get_feature_requests');
  });

  test('the async GM storage variant stores and verifies the owner capability', async () => {
    // A Promise-based manager: GM_getValue/GM_setValue are absent entirely.
    delete globalThis.GM_getValue;
    delete globalThis.GM_setValue;
    const gmStore = new Map();
    Object.defineProperty(globalThis, 'GM', {
      configurable: true,
      writable: true,
      value: {
        getValue: jest.fn(async key => gmStore.get(key)),
        setValue: jest.fn(async (key, value) => {
          gmStore.set(key, value);
        }),
      },
    });
    let sentSecret = null;
    setFetch(
      jest.fn(async (url, options = {}) => {
        if (String(url).includes('get_my_votes')) {
          sentSecret = JSON.parse(String(options.body || '{}')).p_secret;
        }
        return createOkResponse([]);
      })
    );
    const { VotingApi } = boot();

    const res = await VotingApi.getMyVotes();

    expect(res.error).toBeNull();
    expect(typeof sentSecret).toBe('string');
    // The capability lives in the manager's isolated store, not in storage.
    expect(gmStore.get('ytp_owner_capability_secret')).toBe(sentSecret);
    expect(localStorage.getItem('ytp_owner_capability_secret')).toBeNull();
  });

  test('a partially implemented GM object is not mistaken for a storage API', async () => {
    Object.defineProperty(globalThis, 'GM', {
      configurable: true,
      writable: true,
      value: { getValue: () => 'x' },
    });
    delete globalThis.GM_getValue;
    delete globalThis.GM_setValue;
    let sentSecret = null;
    setFetch(
      jest.fn(async (url, options = {}) => {
        if (String(url).includes('get_my_votes')) {
          sentSecret = JSON.parse(String(options.body || '{}')).p_secret;
        }
        return createOkResponse([]);
      })
    );
    const { VotingApi } = boot();

    await VotingApi.getMyVotes();

    // No usable isolated storage → the settings-store fallback keeps the identity.
    expect(typeof sentSecret).toBe('string');
    expect(localStorage.getItem('ytp_owner_secret')).toBe(sentSecret);
  });
});
