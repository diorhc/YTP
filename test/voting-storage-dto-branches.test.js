/**
 * @jest-environment jsdom
 */

/**
 * Storage fallbacks, escaping fallbacks and DTO guards.
 *
 * The capability storage prefers the settings store, then the utils storage
 * shim, and survives a throwing backend instead of breaking the module. HTML
 * escaping degrades from the SafeDOM helper to the security helper to the
 * module's own escaping — with a hostile payload rendered as text, never as
 * markup. Aggregate readers report malformed rows and pages as errors, and a
 * media URL from an untrusted origin is dropped before it is rendered.
 */

describe('Voting storage, escaping and DTO guard branches', () => {
  const createOkResponse = data => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  const installGlobals = ({ utils = {}, safeDom = {} } = {}) => {
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
        safeRequestAnimationFrame: jest.fn(cb => cb(0)),
        ...utils,
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
        ...safeDom,
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

  const boot = () => {
    jest.resetModules();
    require('../src/voting.js');
    return window.YouTubePlusVoting;
  };

  const legacySecret = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij-_-';

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    window.YouTubePlusConfig = { communityWritesEnabled: true };
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
    setFetch(jest.fn(async () => createOkResponse([])));
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
  });

  afterEach(() => {
    delete globalThis.GM;
  });

  // ---- capability storage fallbacks ----------------------------------------

  test('without the settings store a fresh capability persists through the utils storage', async () => {
    delete window.YouTubePlusSettingsStore;
    const store = { data: new Map(), get: jest.fn(), set: jest.fn(), removeItem: jest.fn() };
    store.get.mockImplementation(key => store.data.get(key) ?? null);
    store.set.mockImplementation((key, value) => store.data.set(key, value));
    installGlobals({ utils: { storage: store } });

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

    expect(typeof sentSecret).toBe('string');
    expect(store.set).toHaveBeenCalledWith('ytp_owner_secret', sentSecret);
    expect(store.data.get('ytp_owner_secret')).toBe(sentSecret);
  });

  test('a verified GM migration drops the legacy copy through the utils storage', async () => {
    delete window.YouTubePlusSettingsStore;
    const gmStore = new Map();
    Object.defineProperty(globalThis, 'GM_getValue', {
      configurable: true,
      writable: true,
      value: jest.fn(key => gmStore.get(key)),
    });
    Object.defineProperty(globalThis, 'GM_setValue', {
      configurable: true,
      writable: true,
      value: jest.fn((key, value) => gmStore.set(key, value)),
    });
    const store = { get: jest.fn(() => legacySecret), set: jest.fn(), removeItem: jest.fn() };
    installGlobals({ utils: { storage: store } });

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

    expect(sentSecret).toBe(legacySecret);
    expect(gmStore.get('ytp_owner_capability_secret')).toBe(legacySecret);
    expect(store.removeItem).toHaveBeenCalledWith('ytp_owner_secret');
  });

  test('a storage backend that throws is suppressed and the module keeps working', async () => {
    const boom = new Error('settings backend exploded');
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: {
        readRaw: () => {
          throw boom;
        },
        writeRaw: () => {
          throw boom;
        },
        removeRaw: () => {
          throw boom;
        },
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
    const utils = window.YouTubeUtils;
    const { VotingApi } = boot();

    await VotingApi.getMyVotes();

    expect(typeof sentSecret).toBe('string');
    expect(utils.logSuppressed).toHaveBeenCalledWith(boom, 'Voting');
  });

  test('with no storage backend at all the capability is still generated', async () => {
    delete window.YouTubePlusSettingsStore;
    installGlobals({ utils: { storage: null } });
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
    expect(sentSecret.length).toBeGreaterThanOrEqual(43);
  });

  // ---- escaping fallbacks ---------------------------------------------------

  test('comment bodies are escaped by the security helper when SafeDOM has none', async () => {
    installGlobals({ safeDom: { escapeHTML: undefined } });
    Object.defineProperty(window, 'YouTubeSecurityUtils', {
      configurable: true,
      writable: true,
      value: {
        escapeHtml: text =>
          String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      },
    });
    setFetch(
      jest.fn(async url => {
        if (String(url).includes('get_feature_comments')) {
          return createOkResponse([
            { id: 'c-1', feature_id: 'f-1', comment: '<b>bold</b>', created_at: null },
          ]);
        }
        return createOkResponse([]);
      })
    );
    const { openCommentsModal } = boot();

    await openCommentsModal('f-1', 'Feature');

    const body = document.querySelector('.yp-comment-body');
    expect(body.textContent).toBe('<b>bold</b>');
    expect(body.querySelector('b')).toBeNull();
    expect(body.innerHTML).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  test('with no escaping helper a hostile comment payload renders as inert text', async () => {
    installGlobals({
      utils: { setSafeHTML: undefined },
      safeDom: { escapeHTML: undefined },
    });
    Object.defineProperty(window, 'YouTubeSecurityUtils', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const payload = '<img src=x onerror="window.__pwned=true">';
    setFetch(
      jest.fn(async url => {
        if (String(url).includes('get_feature_comments')) {
          return createOkResponse([{ id: 'c-1', feature_id: 'f-1', comment: payload }]);
        }
        return createOkResponse([]);
      })
    );
    const { openCommentsModal } = boot();

    await openCommentsModal('f-1', 'Feature');

    const list = document.getElementById('yp-comments-list');
    // The payload is text, never markup: no element was injected and the
    // handler never ran.
    expect(list.querySelector('img')).toBeNull();
    expect(window.__pwned).toBeUndefined();
    expect(list.querySelector('.yp-comment-body').textContent).toBe(payload);
    expect(list.innerHTML).toContain('&lt;img');
  });

  test('without a translation helper the UI falls back to the built-in copy', async () => {
    installGlobals({ utils: { t: undefined, hasTranslation: undefined } });
    setFetch(
      jest.fn(async url => {
        if (String(url).includes('get_feature_requests')) {
          return createOkResponse({ rows: [], hasMore: false });
        }
        return createOkResponse([]);
      })
    );
    const { createUI, loadFeatures } = boot();
    const container = document.createElement('div');
    document.body.appendChild(container);
    createUI(container);
    await loadFeatures();

    expect(container.querySelector('.yp-voting-empty').textContent).toContain(
      'No feature requests found.'
    );
  });

  test('a hostile vote type normalises to no vote and is reported as suppressed', () => {
    const utils = window.YouTubeUtils;
    const { normalizeVoteType } = boot();

    expect(normalizeVoteType(Symbol('vote'))).toBe(0);
    expect(utils.logSuppressed).toHaveBeenCalled();
    expect(normalizeVoteType('1')).toBe(1);
    expect(normalizeVoteType('-1')).toBe(-1);
    expect(normalizeVoteType('nonsense')).toBe(0);
    expect(normalizeVoteType(undefined)).toBe(0);
  });

  // ---- DTO guards -----------------------------------------------------------

  test('a page claiming more data without a cursor fails closed', async () => {
    setGm(options => {
      options.onload({
        status: 200,
        responseText: JSON.stringify({
          rows: [{ id: 'f-1', title: 'One' }],
          hasMore: true,
          nextCursorCreatedAt: null,
          nextCursorId: null,
        }),
      });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getFeatureRequests();

    expect(res.error).toBe('Malformed list response (hasMore without cursor)');
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeNull();
    // The verified rows are kept; only the continuation claim is refused.
    expect(res.rows).toHaveLength(1);
  });

  test('an empty ID list never reaches the network', async () => {
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    const { VotingApi } = boot();

    expect(await VotingApi.getVoteCounts(null)).toEqual({ votes: {}, error: null });
    expect(await VotingApi.getCommentCounts(undefined)).toEqual({ counts: {}, error: null });
    expect(await VotingApi.getComments([])).toEqual({ comments: {}, error: null });
    expect(await VotingApi.getFeatureImages([])).toEqual({ images: {}, error: null });
    expect(await VotingApi.getCommentImages(null)).toEqual({ images: {}, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('malformed rows are reported and never rendered as data', async () => {
    setGm(options => {
      const target = String(options.url);
      if (target.includes('get_feature_comments')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify([
            { id: 'c-1', feature_id: 'f-1', comment: 'ok' },
            { id: 'c-2', feature_id: '   ', comment: 'blank id' },
            { feature_id: 'f-1', comment: 'missing id' },
          ]),
        });
        return {
          abort() {
            /* inert handle: the transport already settled */
          },
        };
      }
      options.onload({ status: 200, responseText: '["not-a-row"]' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const counts = await VotingApi.getVoteCounts(['f-1']);
    const comments = await VotingApi.getComments(['f-1']);

    expect(counts.error).toBe('Malformed vote counts response');
    expect(counts.votes).toEqual({});
    // Only the well-formed comment row survives; both malformed rows report.
    expect(comments.error).toBe('Malformed comment row');
    expect(Object.keys(comments.comments)).toEqual(['f-1']);
    expect(comments.comments['f-1'].map(c => c.comment)).toEqual(['ok']);
  });

  test('media from an untrusted origin is dropped, the legacy origin is re-pointed', async () => {
    setGm(options => {
      options.onload({
        status: 200,
        responseText: JSON.stringify([
          { feature_id: 'ok', storage_path: 'voting-images/ok.png' },
          {
            feature_id: 'legacy',
            storage_path:
              'https://ldpccocxlrdsyejfhrvc.supabase.co/storage/v1/object/public/voting-images/l.png',
          },
          { feature_id: 'evil', storage_path: 'https://evil.example.com/x.png' },
          { feature_id: 'broken', storage_path: 'http://' },
          { feature_id: 'nopath' },
          { feature_id: 'blank', storage_path: '   ' },
        ]),
      });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getFeatureImages([
      'ok',
      'legacy',
      'evil',
      'broken',
      'nopath',
      'blank',
    ]);

    expect(Object.keys(res.images).sort()).toEqual(['legacy', 'ok']);
    expect(res.images.ok[0].url).toBe(
      'https://vote.diorhc.space/storage/v1/object/public/voting-images/voting-images/ok.png'
    );
    expect(res.images.legacy[0].url).toBe(
      'https://vote.diorhc.space/storage/v1/object/public/voting-images/l.png'
    );
    expect(res.error).toBe('Malformed image row');
  });

  test('a malformed comment count row keeps the aggregate honest', async () => {
    setGm(options => {
      options.onload({
        status: 200,
        responseText: JSON.stringify([
          { feature_id: 'f-1', comment_count: 4 },
          { feature_id: 'f-2', comment_count: -1 },
          { feature_id: 'f-3', comment_count: 'many' },
        ]),
      });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getCommentCounts(['f-1', 'f-2', 'f-3']);

    expect(res.counts).toEqual({ 'f-1': 4 });
    expect(res.error).toBe('Malformed comment count row');
  });

  test('a malformed my-votes payload is an error, not an empty history', async () => {
    setGm(options => {
      options.onload({ status: 200, responseText: '{"rows":[]}' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    expect(await VotingApi.getMyVotes()).toEqual({
      userVotes: {},
      error: 'Malformed my-votes response',
    });
  });

  test('my-votes rows with an unusable vote type are skipped', async () => {
    setGm(options => {
      options.onload({
        status: 200,
        responseText: JSON.stringify([
          { feature_id: 'f-1', vote_type: 1 },
          { feature_id: 'f-2', vote_type: 'nonsense' },
          { feature_id: '', vote_type: -1 },
        ]),
      });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.getMyVotes();

    expect(res).toEqual({ userVotes: { 'f-1': 1 }, error: null });
  });

  test('a malformed preview payload is unavailable, not "no preview feature"', async () => {
    setGm(options => {
      options.onload({ status: 200, responseText: 'null' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    expect(await VotingApi.getPreviewFeature()).toEqual({
      feature: null,
      error: 'Malformed preview response',
    });
  });

  test('an empty preview page means no preview, with no error', async () => {
    setGm(options => {
      options.onload({ status: 200, responseText: '[]' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    expect(await VotingApi.getPreviewFeature()).toEqual({ feature: null, error: null });
  });

  test('a vote without a server action falls back to the requested direction', async () => {
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    setGm(options => {
      options.onload({ status: 200, responseText: '{}' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    expect(await VotingApi.castVote('f-1', -1)).toEqual({ success: true, action: 'added' });
    expect(await VotingApi.castVote('f-1', 0)).toEqual({ success: true, action: 'removed' });
  });

  test('blank and oversized comment text never reaches the server', async () => {
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    const { VotingApi } = boot();

    expect(await VotingApi.submitComment('f-1', '   ')).toEqual({
      success: false,
      error: 'Comment must be 1 to 1000 characters',
    });
    expect(await VotingApi.submitComment('f-1', undefined)).toEqual({
      success: false,
      error: 'Comment must be 1 to 1000 characters',
    });
    expect((await VotingApi.submitComment('f-1', 'x'.repeat(1001))).error).toBe(
      'Comment must be 1 to 1000 characters'
    );
    expect((await VotingApi.submitFeature('   ', 'desc')).error).toBe('Title is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a comment submission without a body is a failure, not a silent success', async () => {
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    setGm(options => {
      options.onload({ status: 200, responseText: 'null' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    expect(await VotingApi.submitComment('f-1', 'hello')).toEqual({
      success: false,
      error: 'Failed to submit comment',
    });
  });

  test('a title is trimmed and truncated to the contract length', async () => {
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    let body = null;
    setGm(options => {
      body = JSON.parse(options.data);
      options.onload({ status: 200, responseText: '{"id":"f-new"}' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.submitFeature(`  ${'a'.repeat(260)}\n`, '  b  c  ');

    expect(res).toEqual({ success: true, data: { id: 'f-new' } });
    expect(body.p_title).toHaveLength(200);
    expect(body.p_description).toBe('b c');
  });
});
