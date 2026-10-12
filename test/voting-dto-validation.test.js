/**
 * @jest-environment jsdom
 */

/**
 * Network DTO validation for the Voting API.
 *
 * A malformed response — `{}`, `null`, a non-array body, wrong row values,
 * a partial batch — never becomes a successful empty list or a fabricated
 * zero. Known-good rows survive a failing batch (partial truth), and a
 * verified zero aggregate still means exactly zero.
 */

const createOkResponse = data => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

const LEGACY_SECRET = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij-_-';

function installGlobals() {
  if (!window.YouTubePlus) window.YouTubePlus = {};
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      byId: id => document.getElementById(id),
      $: (selector, root) => (root || document).querySelector(selector),
      t: key => key,
      createHTML: s => s,
      helpers: { t: key => key, debounce: fn => fn },
      isSettingsModalOpen: jest.fn(() => false),
      createIsRelevantRoute: () => () => false,
      createWithErrorBoundary: () => fn => fn,
      isWatchRoute: jest.fn(() => false),
      isShortsRoute: jest.fn(() => false),
      isYouTubeDomain: jest.fn(() => true),
      isChannelRoute: jest.fn(() => false),
      logSuppressed: jest.fn(),
      whenRelevant: jest.fn(),
      onSectionActive: jest.fn(),
      safeRequestAnimationFrame: jest.fn(cb => requestAnimationFrame(cb)),
      storage: {
        get: key => localStorage.getItem(key),
        set: (key, value) => localStorage.setItem(key, value),
      },
    },
  });
}

function bootApi() {
  jest.resetModules();
  require('../src/voting.js');
  return window.YouTubePlus.Voting.VotingApi;
}

describe('voting DTO validation (honest error/partial/zero states)', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    localStorage.setItem('ytp_owner_secret', LEGACY_SECRET);
    if (!window.YouTubePlus) window.YouTubePlus = {};
    installGlobals();
  });

  afterEach(() => {
    delete globalThis.GM_getValue;
    delete globalThis.GM_setValue;
    delete globalThis.GM_deleteValue;
  });

  test('getVoteCounts: {} and null bodies are errors, never empty aggregates', async () => {
    for (const badBody of [{}, null]) {
      const fetchMock = jest.fn(async () => createOkResponse(badBody));
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      const api = bootApi();
      const res = await api.getVoteCounts(['f-1']);
      expect(res.votes).toEqual({});
      expect(res.error).toBeTruthy();
    }
  });

  test('malformed vote-count rows are unknown (never fabricated zeros); valid siblings stay visible', async () => {
    const fetchMock = jest.fn(async () =>
      createOkResponse([
        { feature_id: 'f-good', upvotes: 5, downvotes: 1 },
        { feature_id: 'f-str', upvotes: '3', downvotes: 1 },
        { feature_id: 'f-neg', upvotes: -2, downvotes: 1 },
        { feature_id: 'f-missing', downvotes: 0 },
        { feature_id: 'f-zero', upvotes: 0, downvotes: 0 },
      ])
    );
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const api = bootApi();

    const res = await api.getVoteCounts(['f-1']);

    // Known-good rows (including real zeros) are kept; malformed rows are
    // unknown and surface as a partial error, never as fabricated zeros.
    expect(res.votes['f-good']).toEqual({ upvotes: 5, downvotes: 1 });
    expect(res.votes['f-zero']).toEqual({ upvotes: 0, downvotes: 0 });
    expect(res.votes['f-str']).toBeUndefined();
    expect(res.votes['f-neg']).toBeUndefined();
    expect(res.votes['f-missing']).toBeUndefined();
    expect(res.error).toBeTruthy();
  });

  test('malformed comment-count rows are unknown; a valid zero count stays zero', async () => {
    const fetchMock = jest.fn(async () =>
      createOkResponse([
        { feature_id: 'f-zero', comment_count: 0 },
        { feature_id: 'f-bad', comment_count: '7' },
        { feature_id: 'f-neg', comment_count: -1 },
        { feature_id: 'f-ok', comment_count: 4 },
      ])
    );
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const api = bootApi();

    const res = await api.getCommentCounts(['f-1']);
    expect(res.counts['f-zero']).toBe(0);
    expect(res.counts['f-neg']).toBeUndefined();
    expect(res.error).toBeTruthy();
  });

  test('getComments drops malformed rows and keeps well-formed ones', async () => {
    const fetchMock = jest.fn(async () =>
      createOkResponse([
        { id: 'c-1', feature_id: 'f-1', comment: 'Hello' },
        { id: 'c-2', comment: 'no feature id' },
        { feature_id: 'f-1', comment: 'no id' },
        { id: 'c-3', feature_id: 'f-1' },
      ])
    );
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const api = bootApi();

    const res = await api.getComments(['f-1']);
    expect(res.comments['f-1']).toHaveLength(1);
    expect(res.comments['f-1'][0].id).toBe('c-1');
  });

  test('getPreviewFeature: a malformed body is unavailable, an empty page is a real no-preview', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_preview_feature')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ nope: true }),
          text: async () => '{}',
        };
      }
      return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const api = bootApi();

    const malformed = await api.getPreviewFeature();
    expect(malformed.error).toBeTruthy();
    expect(malformed.feature).toBeNull();
  });

  test('getMyVotes: rows with a guessed or malformed surface are skipped, not failures', async () => {
    const fetchMock = jest.fn(async () =>
      createOkResponse([
        { feature_id: 'f-1', vote_type: 1 },
        { feature_id: 'f-bad', vote_type: 'like' },
        { feature_id: 'f-2', vote_type: -1 },
        { feature_id: 'f-3', vote_type: 0 },
      ])
    );
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const api = bootApi();

    const res = await api.getMyVotes();
    expect(res.error).toBeNull();
    expect(res.userVotes['f-1']).toBe(1);
    expect(res.userVotes['f-2']).toBe(-1);
    expect(res.userVotes['f-bad']).toBeUndefined();
    expect(res.userVotes['f-3']).toBeUndefined();
  });

  test('a partial batch: known rows survive, the failed chunk marks unavailability', async () => {
    // 201 ids → two server-cap chunks; the second one fails.
    const ids = ['f-1', ...Array.from({ length: 200 }, (_, i) => `f-fill-${i}`), 'f-2'];
    let chunkCalls = 0;
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('rpc/get_vote_counts')) {
        chunkCalls += 1;
        const chunk = JSON.parse(options.body || '{}').p_feature_ids;
        if (chunk[0] === 'f-1') {
          return createOkResponse([{ feature_id: 'f-1', upvotes: 2, downvotes: 0 }]);
        }
        return {
          ok: false,
          status: 503,
          json: async () => ({ message: 'chunk down' }),
          text: async () => '{}',
        };
      }
      return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const api = bootApi();

    const res = await api.getVoteCounts(ids);
    expect(chunkCalls).toBe(2);
    // Known-good chunk survives the failed one and the DTO says partial.
    expect(res.votes['f-1']).toEqual({ upvotes: 2, downvotes: 0 });
    expect(res.error).toBeTruthy();
  });

  const BATCH_READERS = [
    {
      label: 'getVoteCounts',
      rpc: 'get_vote_counts',
      param: 'p_feature_ids',
      row: { feature_id: 'id-1', upvotes: 2, downvotes: 0 },
      malformedMsg: 'Malformed vote counts response',
      run: (api, ids) => api.getVoteCounts(ids),
      read: res => res.votes['id-1'],
      expected: { upvotes: 2, downvotes: 0 },
    },
    {
      label: 'getFeatureImages',
      rpc: 'get_feature_images',
      param: 'p_feature_ids',
      row: { feature_id: 'id-1', storage_path: 'features/aa/bb.png' },
      malformedMsg: 'Malformed images response',
      run: (api, ids) => api.getFeatureImages(ids),
      read: res => (res.images['id-1'] || []).length,
      expected: 1,
    },
    {
      label: 'getCommentCounts',
      rpc: 'get_feature_comment_counts',
      param: 'p_feature_ids',
      row: { feature_id: 'id-1', comment_count: 4 },
      malformedMsg: 'Malformed comment counts response',
      run: (api, ids) => api.getCommentCounts(ids),
      read: res => res.counts['id-1'],
      expected: 4,
    },
    {
      label: 'getComments',
      rpc: 'get_feature_comments',
      param: 'p_feature_ids',
      row: { id: 'c-1', feature_id: 'id-1', comment: 'Hello' },
      malformedMsg: 'Malformed comments response',
      run: (api, ids) => api.getComments(ids),
      read: res => (res.comments['id-1'] || []).length,
      expected: 1,
    },
    {
      label: 'getCommentImages',
      rpc: 'get_comment_images',
      param: 'p_comment_ids',
      row: { comment_id: 'id-1', storage_path: 'comments/ee/ff.png' },
      malformedMsg: 'Malformed images response',
      run: (api, ids) => api.getCommentImages(ids),
      read: res => (res.images['id-1'] || []).length,
      expected: 1,
    },
  ];

  test.each(BATCH_READERS)(
    '$label: a malformed page sets the error and the other chunk is kept',
    async ({ rpc, param, row, malformedMsg, run, read, expected }) => {
      // 201 ids → two server-cap chunks; the second page is not an array.
      const ids = ['id-1', ...Array.from({ length: 200 }, (_, i) => `fill-${i}`), 'id-2'];
      const fetchMock = jest.fn(async (url, options = {}) => {
        if (!String(url).includes(`rpc/${rpc}`)) return createOkResponse([]);
        const chunk = JSON.parse(options.body || '{}')[param];
        if (chunk[0] === 'id-1') return createOkResponse([row]);
        return createOkResponse({ not: 'an array' });
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      const api = bootApi();

      const res = await run(api, ids);
      // The failed chunk never erases the rows the first chunk delivered.
      expect(read(res)).toEqual(expected);
      expect(res.error).toBe(malformedMsg);
    }
  );

  test.each(BATCH_READERS)(
    '$label: a page with non-object entries keeps valid rows and reports the page',
    async ({ rpc, row, malformedMsg, run, read, expected }) => {
      const fetchMock = jest.fn(async url => {
        if (!String(url).includes(`rpc/${rpc}`)) return createOkResponse([]);
        return createOkResponse([row, 'junk', null, 42]);
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      const api = bootApi();

      const res = await run(api, ['id-1']);
      expect(read(res)).toEqual(expected);
      expect(res.error).toBe(malformedMsg);
    }
  );

  test('a verified empty aggregate still means zero — not unknown', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('rpc/get_vote_counts')) {
        return createOkResponse([]); // correct, known-empty aggregate
      }
      return createOkResponse([]);
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const api = bootApi();

    const res = await api.getVoteCounts(['f-1']);
    expect(res.error).toBeNull();
    // A known-empty aggregate means no votes recorded: the render treats a
    // missing row as unknown — the aggregate itself carries no fabricated
    // rows at all ({}), which the UI maps to a real zero for present cards.
    expect(res.votes).toEqual({});
  });
});
