/**
 * @jest-environment jsdom
 */

describe('Voting Module', () => {
  const originalRaf = global.requestAnimationFrame;
  const originalCaf = global.cancelAnimationFrame;

  const createOkResponse = data => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  // The list read is keyset-paginated — mocks must answer with the
  // explicit page contract instead of a bare array.
  const createListPage = rows =>
    createOkResponse({ rows, hasMore: false, nextCursorCreatedAt: null, nextCursorId: null });

  let registeredListeners = [];
  let listenerRegistry = new Map();

  const unregisterTrackedListener = key => {
    const entry = listenerRegistry.get(key);
    if (!entry) return;
    entry.target?.removeEventListener?.(entry.type, entry.handler, entry.opts);
    listenerRegistry.delete(key);
    const index = registeredListeners.indexOf(entry);
    if (index >= 0) registeredListeners.splice(index, 1);
  };

  const installBaseGlobals = () => {
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        setSafeHTML: (el, html) => {
          if (el) {
            el.innerHTML = html;
          }
        },
        byId: id => document.getElementById(id),
        $: (selector, root) => (root || document).querySelector(selector),
        t: key => key,
        createHTML: s => s,
        helpers: {
          byId: id => document.getElementById(id),
          $: (selector, root) => (root || document).querySelector(selector),
          $$: sel => Array.from(document.querySelectorAll(sel)),
          t: key => key,
          logger: null,
          createHTML: s => s,
          debounce: fn => fn,
          setTimeout_: (fn, ms) => setTimeout(fn, ms),
        },
        cleanupManager: {
          registerListener: (target, type, handler, opts) => {
            target?.addEventListener?.(type, handler, opts);
            const entry = { target, type, handler, opts };
            registeredListeners.push(entry);
            const key = Symbol('listener-key');
            listenerRegistry.set(key, entry);
            return key;
          },
          unregisterListener: unregisterTrackedListener,
        },
        isSettingsModalOpen: jest.fn(() => false),
        createIsRelevantRoute: (opts = {}) => {
          const {
            watch = false,
            shorts = false,
            channel = false,
            domain = false,
            settingsModal = false,
          } = opts;
          return () => {
            if (settingsModal && window.YouTubeUtils.isSettingsModalOpen()) return true;
            if (domain && !window.YouTubeUtils.isYouTubeDomain()) return false;
            return (
              (window.YouTubeUtils.isWatchRoute() && watch) ||
              (window.YouTubeUtils.isShortsRoute() && shorts) ||
              (window.YouTubeUtils.isChannelRoute() && channel)
            );
          };
        },
        createWithErrorBoundary: _name => fn => fn,
        isWatchRoute: jest.fn(() => window.location.pathname === '/watch'),
        isShortsRoute: jest.fn(() => window.location.pathname.startsWith('/shorts')),
        isYouTubeDomain: jest.fn(() => true),
        isChannelRoute: jest.fn(() => false),
        logSuppressed: jest.fn(),
        whenRelevant: jest.fn(({ onEnter }) => {
          if (onEnter) onEnter();
          return { check: jest.fn(), dispose: jest.fn() };
        }),
        onSectionActive: jest.fn(() => ({ dispose: jest.fn() })),
        safeRequestAnimationFrame: jest.fn(cb => requestAnimationFrame(cb)),
      },
    });

    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        registerListener: (target, type, handler, opts) => {
          target?.addEventListener?.(type, handler, opts);
          const entry = { target, type, handler, opts };
          registeredListeners.push(entry);
          const key = Symbol('listener-key');
          listenerRegistry.set(key, entry);
          return key;
        },
        unregisterListener: unregisterTrackedListener,
        registerAnimationFrame: id => id,
        registerTimeout: id => id,
      },
    });

    Object.defineProperty(window, 'YouTubePlusDOMCache', {
      configurable: true,
      writable: true,
      value: {
        querySelector: (selector, root) => (root || document).querySelector(selector),
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
        createTrustedHTML: s => s,
        createFragment: html => {
          const tpl = document.createElement('template');
          tpl.innerHTML = String(html ?? '');
          return tpl.content;
        },
      },
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn(async () => createOkResponse([])),
    });

    let rafCounter = 0;
    global.requestAnimationFrame = jest.fn(cb => {
      const id = ++rafCounter;
      Promise.resolve().then(() => cb?.(Date.now()));
      return id;
    });
    global.cancelAnimationFrame = jest.fn();
  };

  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // The actor handshake needs WebCrypto subtle, which jsdom
    // does not provide — stub a deterministic digest for the capability hash.
    const deterministicDigest = async (_algorithm, data) => {
      const bytes = new Uint8Array(data instanceof Uint8Array ? data : []);
      let h = 0x12345678;
      const out = new Uint8Array(32);
      for (const b of bytes) h = (h * 31 + b) >>> 0;
      for (let i = 0; i < out.length; i++) {
        out[i] = (h ^ (i * 7)) & 0xff;
        h = (h * 1103515245 + 12345) >>> 0;
      }
      return out.buffer;
    };
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: arr => {
          for (let i = 0; i < arr.length; i++) arr[i] = (i * 7919 + 13) % 256;
          return arr;
        },
        subtle: { digest: deterministicDigest },
      },
    });

    // window.YouTubePlus is normally created by basic.js (build order);
    // voting.js is loaded in isolation here, so provide the same stub.
    if (!window.YouTubePlus) window.YouTubePlus = {};

    mockLocation({
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=dQw4w9WgXcQ',
    });

    installBaseGlobals();
  });

  afterEach(() => {
    registeredListeners.forEach(({ target, type, handler, opts }) => {
      try {
        target?.removeEventListener?.(type, handler, opts);
      } catch (_) {
        /* ignore teardown listener removal error */
      }
    });
    registeredListeners = [];
    listenerRegistry = new Map();
    delete window.YouTubePlusFeatureRegistry;
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCaf;
  });

  test('registers the voting settings section and exposes public API', () => {
    const onSectionActive = jest.fn(() => ({ dispose: jest.fn() }));
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        ...(window.YouTubeUtils || {}),
        onSectionActive,
      },
    });

    jest.resetModules();
    require('../src/voting.js');

    expect(window.YouTubePlus?.Voting).toBeDefined();
    expect(window.YouTubePlusVoting).toBe(window.YouTubePlus.Voting);
    // The settings-modal section lifecycle stays on `onSectionActive`; the
    // route-bound runtime registers through FeatureLifecycle.
    expect(window.YouTubeUtils.whenRelevant).not.toHaveBeenCalled();
    expect(onSectionActive).toHaveBeenCalledWith(
      'voting',
      expect.any(Function),
      expect.any(Function)
    );
    expect(typeof window.YouTubePlus.Voting.init).toBe('function');
    expect(typeof window.YouTubePlus.Voting.vote).toBe('function');
    expect(typeof window.YouTubePlus.Voting.submitFeature).toBe('function');
  });

  test('updateVoteBar renders aggregate count and active state', () => {
    require('../src/voting.js');

    document.body.innerHTML = `
      <div id="yp-vote-bar-fill"></div>
      <div id="yp-vote-bar-count"></div>
      <button id="yp-vote-bar-up"></button>
      <button id="yp-vote-bar-down"></button>
    `;

    window.YouTubePlus.Voting.updateVoteBar(
      { preview_id: { upvotes: 3, downvotes: 1 } },
      { preview_id: 1 },
      'preview_id'
    );

    const fill = document.getElementById('yp-vote-bar-fill');
    const count = document.getElementById('yp-vote-bar-count');
    const up = document.getElementById('yp-vote-bar-up');
    const down = document.getElementById('yp-vote-bar-down');

    expect(fill?.style.background).toContain('75%');
    expect(count?.textContent).toBe('4');
    expect(up?.classList.contains('active')).toBe(true);
    expect(down?.classList.contains('active')).toBe(false);
  });

  test('initSlider marks container initialized and sets default position', () => {
    require('../src/voting.js');

    document.body.innerHTML = `
      <div class="yp-ba-container">
        <div class="yp-ba-after"></div>
        <div class="yp-ba-divider" aria-valuenow="0"></div>
      </div>
    `;

    const container = document.querySelector('.yp-ba-container');
    const divider = document.querySelector('.yp-ba-divider');

    expect(container).toBeTruthy();
    window.YouTubePlus.Voting.initSlider();

    expect(container?.getAttribute('data-slider-init')).toBe('1');
    expect(divider?.getAttribute('aria-valuenow')).toBe('50');
    expect(divider?.style.left).toBe('50%');
  });

  test('getFeatures, submitFeature and vote call Supabase endpoints', async () => {
    // Explicit write opt-in — the default is read-only (A04).
    window.YouTubePlusConfig = { communityWritesEnabled: true };

    const fetchMock = jest.fn(async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      const target = String(url);

      // Community writes require the actor registration handshake —
      // answer the Edge call with a stable actor id.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }

      if (target.includes('rpc/get_feature_requests')) {
        return createListPage([
          { id: 'feature-1', title: 'Feature A', description: 'Desc', status: 'proposed' },
        ]);
      }

      if (target.includes('rpc/submit_feature') && method === 'POST') {
        return createOkResponse({ id: 'feature-2', title: 'New Feature' });
      }

      if (target.includes('rpc/get_vote_counts')) {
        return createOkResponse([]);
      }

      if (target.includes('rpc/cast_vote')) {
        return createOkResponse({ action: 'added' });
      }

      return createOkResponse([]);
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    require('../src/voting.js');

    const features = await window.YouTubePlus.Voting.getFeatures();
    expect(Array.isArray(features)).toBe(true);
    expect(features[0].id).toBe('feature-1');

    const submitResult = await window.YouTubePlus.Voting.submitFeature(
      '  New Feature  ',
      '  Body  '
    );
    expect(submitResult.success).toBe(true);

    const voteResult = await window.YouTubePlus.Voting.vote('feature-1', 1);
    expect(voteResult.success).toBe(true);
    expect(voteResult.action).toBe('added');

    expect(fetchMock).toHaveBeenCalled();
  });

  describe('proxy transport', () => {
    // All community traffic goes through the author proxy. Absolute
    // URLs from server responses are only trusted for the legacy Supabase
    // origin, which is re-pointed at the proxy; any other origin is rejected.
    const LEGACY_ORIGIN = 'https://ldpccocxlrdsyejfhrvc.supabase.co';
    const PROXY_ORIGIN = 'https://vote.diorhc.space';

    const installProxyFetchMock = () => {
      const calls = [];
      const fetchMock = jest.fn(async (url, options = {}) => {
        const target = String(url);
        calls.push({ url: target, method: String(options.method || 'GET').toUpperCase() });

        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) return createListPage([]);
        if (target.includes('rpc/get_preview_feature')) return createOkResponse([]);
        if (target.includes('rpc/get_vote_counts')) return createOkResponse([]);
        if (target.includes('rpc/get_feature_comment_counts')) return createOkResponse([]);
        if (target.includes('rpc/get_feature_images')) {
          return createOkResponse([
            { id: 'img-1', feature_id: 'feature-1', storage_path: 'features/aa/bb.png' },
            {
              id: 'img-2',
              feature_id: 'feature-1',
              storage_path: `${LEGACY_ORIGIN}/storage/v1/object/sign/features/cc/dd.png?token=t`,
            },
            {
              id: 'img-3',
              feature_id: 'feature-1',
              storage_path: 'https://evil.example/steal.png',
            },
          ]);
        }
        if (target.includes('rpc/get_comment_images')) {
          return createOkResponse([
            {
              id: 'cimg-1',
              comment_id: 'comment-1',
              storage_path: `${LEGACY_ORIGIN}/storage/v1/object/sign/comments/ee/ff.png?token=t`,
            },
          ]);
        }
        return createOkResponse([]);
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      return { fetchMock, calls };
    };

    test('no client request ever targets a supabase origin', async () => {
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      const { calls } = installProxyFetchMock();
      require('../src/voting.js');
      const Voting = window.YouTubePlus.Voting;

      await Voting.getFeatures();
      await Voting.getAllVotes(['feature-1']);
      await Voting.VotingApi.getFeatureImages(['feature-1']);
      await Voting.VotingApi.getCommentImages(['comment-1']);
      await Voting.vote('feature-1', 1);
      await Voting.submitFeature('Proxy Title', 'Body');
      await Voting.VotingApi.uploadBinary(
        `${LEGACY_ORIGIN}/storage/v1/upload/sign/features/feature-1/slot-1.png?token=t`,
        new Blob(['x']),
        'image/png'
      );

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.url.startsWith(`${PROXY_ORIGIN}/`)).toBe(true);
        expect(call.url).not.toContain('supabase.co');
      }
    });

    test('media URLs are re-pointed at the proxy and foreign origins are rejected', async () => {
      const { calls } = installProxyFetchMock();
      require('../src/voting.js');
      const api = window.YouTubePlus.Voting.VotingApi;

      const featureImages = await api.getFeatureImages(['feature-1']);
      const urls = (featureImages.images['feature-1'] || []).map(img => img.url);
      expect(urls).toContain(
        `${PROXY_ORIGIN}/storage/v1/object/public/voting-images/features/aa/bb.png`
      );
      expect(urls).toContain(`${PROXY_ORIGIN}/storage/v1/object/sign/features/cc/dd.png?token=t`);
      expect(urls.some(u => u.includes('evil.example'))).toBe(false);
      expect(featureImages.error).toBe('Malformed image row');

      const commentImages = await api.getCommentImages(['comment-1']);
      const commentUrls = (commentImages.images['comment-1'] || []).map(img => img.url);
      expect(commentUrls).toContain(
        `${PROXY_ORIGIN}/storage/v1/object/sign/comments/ee/ff.png?token=t`
      );
      expect(calls.every(c => !c.url.includes('supabase.co'))).toBe(true);
    });

    test('uploadBinary rejects absolute URLs with untrusted origins', async () => {
      const { calls } = installProxyFetchMock();
      require('../src/voting.js');
      const api = window.YouTubePlus.Voting.VotingApi;

      const rejected = await api.uploadBinary(
        'https://evil.example/upload/sign/x.png?token=t',
        new Blob(['x']),
        'image/png'
      );
      expect(rejected.success).toBe(false);
      expect(calls.filter(c => c.url.includes('evil.example'))).toHaveLength(0);

      const ok = await api.uploadBinary(
        `${LEGACY_ORIGIN}/storage/v1/upload/sign/features/feature-1/slot-1.png?token=t`,
        new Blob(['x']),
        'image/png'
      );
      expect(ok.success).toBe(true);
      expect(
        calls.some(
          c =>
            c.url === `${PROXY_ORIGIN}/storage/v1/upload/sign/features/feature-1/slot-1.png?token=t`
        )
      ).toBe(true);
    });
  });

  describe('0.5 protective mode', () => {
    const pgrst202Response = () => ({
      ok: false,
      status: 404,
      json: async () => ({
        code: 'PGRST202',
        message:
          'Could not find the function public.get_feature_requests(p_cursor_created, p_cursor_id, p_limit) in the schema cache',
      }),
    });

    test('PGRST202 on the list read goes read-only with no futile retry', async () => {
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      const fetchMock = jest.fn(async url => {
        const target = String(url);
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        if (target.includes('rpc/get_feature_requests')) return pgrst202Response();
        return createOkResponse([]);
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      require('../src/voting.js');
      const Voting = window.YouTubePlus.Voting;

      const container = document.createElement('div');
      document.body.appendChild(container);
      Voting.createUI(container);
      await Voting.loadFeatures();

      // The panel shows the explicit unavailability state — not a retry that
      // can never succeed.
      const errorText = container.querySelector('.yp-voting-error-text');
      expect(errorText?.textContent).toBe('Community temporarily unavailable');
      expect(container.querySelector('.yp-voting-retry')).toBeNull();

      // Writes are flipped to read-only.
      expect(Voting.isCommunityWritable()).toBe(false);
      const callsBefore = fetchMock.mock.calls.length;
      const voteResult = await Voting.vote('feature-1', 1);
      expect(voteResult.success).toBe(false);
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
    });

    test('a transient 503 keeps the retry state and does not trip protective mode', async () => {
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      const fetchMock = jest.fn(async url => {
        const target = String(url);
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) {
          return { ok: false, status: 503, json: async () => ({ message: 'Service Unavailable' }) };
        }
        return createOkResponse([]);
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      require('../src/voting.js');
      const Voting = window.YouTubePlus.Voting;

      const container = document.createElement('div');
      document.body.appendChild(container);
      Voting.createUI(container);
      await Voting.loadFeatures();

      expect(container.querySelector('.yp-voting-retry')).toBeTruthy();
      expect(container.querySelector('.yp-voting-error-text')?.textContent).toBe(
        "Couldn't load feature requests"
      );
      expect(Voting.isCommunityWritable()).toBe(true);
    });
    describe('vote icon geometry', () => {
      const numbersOf = d => (d.match(/-?\d*\.?\d+/g) || []).map(Number);

      const pathData = svgHtml => {
        const tpl = document.createElement('template');
        tpl.innerHTML = svgHtml;
        return Array.from(tpl.content.querySelectorAll('path')).map(p => p.getAttribute('d'));
      };

      // Solar Dislike = Like mirrored vertically: x stays, y → 24 − y.
      // Absolute commands only (M, L, H, V, C, Z) — mirrors the shipped data.
      const Y_ARGS = { M: [1], L: [1], C: [1, 3, 5], V: [0], H: [], Z: [] };
      function numbersOfFlipY(d) {
        const tokens = d.match(/[A-Z]|-?\d*\.?\d+/g) || [];
        let cmd = 'M';
        let argIdx = 0;
        const out = [];
        for (const t of tokens) {
          if (/[A-Z]/.test(t)) {
            cmd = t;
            argIdx = 0;
            continue;
          }
          const isY = (Y_ARGS[cmd] || []).includes(argIdx);
          argIdx += 1;
          if (cmd === 'M' || cmd === 'L') argIdx %= 2;
          if (cmd === 'C') argIdx %= 6;
          out.push(isY ? 24 - Number(t) : Number(t));
        }
        return out;
      }

      test('dislike paths are the like paths mirrored vertically', () => {
        require('../src/voting.js');
        const renderSvgIcon = window.YouTubePlus.Voting.renderSvgIcon;

        const likePaths = pathData(renderSvgIcon('like'));
        const dislikePaths = pathData(renderSvgIcon('dislike'));
        expect(likePaths.length).toBe(2);
        expect(dislikePaths.length).toBe(2);
        expect(likePaths[0]).not.toBe(dislikePaths[0]);

        for (let p = 0; p < 2; p++) {
          const expected = numbersOfFlipY(likePaths[p]);
          const actual = numbersOf(dislikePaths[p]);
          expect(actual.length).toBe(expected.length);
          for (let i = 0; i < expected.length; i++) {
            expect(Math.abs(actual[i] - expected[i])).toBeLessThan(0.001);
          }
        }
      });

      test('like icon has no segments from the mirrored variant', () => {
        require('../src/voting.js');
        const renderSvgIcon = window.YouTubePlus.Voting.renderSvgIcon;
        const likeHtml = renderSvgIcon('like');
        // The cross-bred segment carries y-values 14.38/13.62 in the
        // upper region (y ≈ 9–11) of the like path — it tears the outline apart.
        expect(likeHtml).not.toContain('C5.62021 14.3837');
        expect(renderSvgIcon('dislike')).not.toContain(
          'C5.62021 14.3837 5.31148 13.6247 5.37839 11.149'
        );
      });
    });
  });

  describe('secure owner transport', () => {
    let originalGmXhr;
    beforeEach(() => {
      originalGmXhr = globalThis.GM_xmlhttpRequest;
    });
    afterEach(() => {
      Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
        configurable: true,
        writable: true,
        value: originalGmXhr,
      });
    });

    test('owner payloads travel through GM_xmlhttpRequest; the page fetch spy never sees p_secret', async () => {
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      const gmCalls = [];
      Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
        configurable: true,
        writable: true,
        value: jest.fn(options => {
          gmCalls.push(options);
          const payload = String(options.url).includes('ytplus-actor-register')
            ? { actorId: 'actor-1' }
            : { action: 'added' };
          setTimeout(() => {
            const text = JSON.stringify(payload);
            options.onload?.({ status: 200, response: text, responseText: text });
          }, 0);
          return {
            abort: () => {
              /* mock */
            },
          };
        }),
      });
      const fetchSpy = jest.fn(async () => {
        throw new Error('page fetch must not be used for owner payloads');
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchSpy,
      });
      require('../src/voting.js');
      const Voting = window.YouTubePlus.Voting;

      const res = await Voting.vote('feature-1', 1);
      expect(res.success).toBe(true);

      const castCall = gmCalls.find(c => String(c.url).includes('rpc/cast_vote'));
      expect(castCall).toBeTruthy();
      expect(String(castCall.data)).toContain('p_secret');
      // The manager transport carries the request deadline.
      expect(castCall.timeout).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test('without the manager transport: public reads use fetch, owner payloads never do', async () => {
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      delete globalThis.GM_xmlhttpRequest;
      const fetchCalls = [];
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: jest.fn(async (url, _options = {}) => {
          fetchCalls.push(String(url));
          const target = String(url);
          if (target.includes('rpc/get_feature_requests')) {
            return createListPage([]);
          }
          return createOkResponse([]);
        }),
      });
      require('../src/voting.js');
      const Voting = window.YouTubePlus.Voting;

      const features = await Voting.getFeatures();
      expect(Array.isArray(features)).toBe(true);
      expect(fetchCalls.some(u => u.includes('rpc/get_feature_requests'))).toBe(true);

      const voteRes = await Voting.vote('feature-1', 1);
      expect(voteRes.success).toBe(false);
      expect(fetchCalls.every(u => !u.includes('rpc/cast_vote'))).toBe(true);
      expect(fetchCalls.every(u => !u.includes('ytplus-actor-register'))).toBe(true);
    });

    test('get_my_votes never sends the owner secret through the shared fetch fallback', async () => {
      delete globalThis.GM_xmlhttpRequest;
      const fetchSpy = jest.fn(async () => createOkResponse([]));
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchSpy,
      });
      require('../src/voting.js');
      const api = window.YouTubePlus.Voting.VotingApi;

      const res = await api.getMyVotes();
      expect(res.error).toBeTruthy();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('DTO strictness & write deadlines', () => {
    let originalGmXhr;
    beforeEach(() => {
      originalGmXhr = globalThis.GM_xmlhttpRequest;
    });
    afterEach(() => {
      Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
        configurable: true,
        writable: true,
        value: originalGmXhr,
      });
    });

    const installVotingApi = fetchResponses => {
      // Owner payloads only travel through GM_xmlhttpRequest — emulate
      // the manager by delegating GM requests to the fetch mock (json-first,
      // matching the setup.js bridge).
      globalThis.GM_xmlhttpRequest = options => {
        const { method = 'GET', url, headers = {}, data, onload, onerror, onabort } = options;
        globalThis
          .fetch(url, { method, headers, body: data })
          .then(async res => {
            let text = '';
            try {
              if (typeof res.json === 'function') text = JSON.stringify(await res.json());
              else if (typeof res.text === 'function') text = await res.text();
            } catch (_e) {
              text = '';
            }
            onload?.({ status: res.status ?? 200, response: text, responseText: text });
          })
          .catch(() => onerror?.());
        return { abort: () => onabort?.() };
      };
      globalThis.fetch = jest.fn(async url => {
        const target = String(url);
        for (const [needle, response] of fetchResponses) {
          if (target.includes(needle)) return response;
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      });
      jest.resetModules();
      delete window.YouTubeSafeDOM;
      delete window.YouTubeTrustedTypes;
      require('../src/voting.js');
      return window.YouTubePlus.Voting.VotingApi;
    };
    test('getMyVotes: a non-array payload is an error, never an empty surface', async () => {
      // Get_my_votes is an owner payload — it only travels through the
      // isolated manager transport, so emulate it (delegating to the mock).
      const api = installVotingApi([
        [
          'rpc/get_my_votes',
          {
            ok: true,
            status: 200,
            json: async () => ({ not: 'an array' }),
            text: async () => JSON.stringify({ not: 'an array' }),
          },
        ],
      ]);

      const res = await api.getMyVotes();
      expect(res.error).toBe('Malformed my-votes response');
      expect(res.userVotes).toEqual({});
    });

    test('getComments: malformed rows surface an error like the neighboring readers', async () => {
      const api = installVotingApi([
        [
          'rpc/get_feature_comments',
          {
            ok: true,
            status: 200,
            json: async () => [
              { id: 'c-1', feature_id: 'feat-1', comment: 'good one' },
              { id: 'c-2' /* missing feature_id + comment */ },
            ],
            text: async () =>
              JSON.stringify([
                { id: 'c-1', feature_id: 'feat-1', comment: 'good one' },
                { id: 'c-2' /* missing feature_id + comment */ },
              ]),
          },
        ],
      ]);

      const res = await api.getComments(['feat-1']);
      // A malformed row is UNKNOWN — an error is surfaced (fail-open
      // to the caller), never silently dropped like a clean empty list.
      expect(res.error).toBe('Malformed comment row');
      // The well-formed sibling row stays visible.
      expect(res.comments['feat-1']).toHaveLength(1);
      expect(res.comments['feat-1'][0].comment).toBe('good one');
    });

    test('writes carry a 15 s deadline through the manager transport', async () => {
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      const gmOptions = [];
      globalThis.GM_xmlhttpRequest = jest.fn(options => {
        gmOptions.push(options);
        const payload = String(options.url).includes('ytplus-actor-register')
          ? { actorId: 'actor-1' }
          : { action: 'added' };
        const text = JSON.stringify(payload);
        setTimeout(() => options.onload?.({ status: 200, response: text, responseText: text }), 0);
        return {
          abort: () => {
            /* mock */
          },
        };
      });
      // The capability hash needs a WebCrypto subtle stub (jsdom lacks it).
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: {
          getRandomValues: arr => {
            for (let i = 0; i < arr.length; i++) arr[i] = (i * 7919 + 13) % 256;
            return arr;
          },
          subtle: {
            digest: async (_alg, data) => {
              const bytes = new Uint8Array(data instanceof Uint8Array ? data : []);
              let h = 0x12345678;
              const out = new Uint8Array(32);
              for (const b of bytes) h = (h * 31 + b) >>> 0;
              for (let i = 0; i < out.length; i++) {
                out[i] = (h ^ (i * 7)) & 0xff;
                h = (h * 1103515245 + 12345) >>> 0;
              }
              return out.buffer;
            },
          },
        },
      });

      jest.resetModules();
      delete window.YouTubeSafeDOM;
      delete window.YouTubeTrustedTypes;
      require('../src/voting.js');
      const api = window.YouTubePlus.Voting.VotingApi;

      const res = await api.castVote('feat-1', 1);
      expect(res.success).toBe(true);

      const castOptions = gmOptions.find(o => String(o.url).includes('rpc/cast_vote'));
      expect(castOptions).toBeTruthy();
      // The write carries the 15 s manager deadline.
      expect(castOptions.timeout).toBe(15000);
    });

    test('uploadBinary accepts only the proxy origin for absolute URLs', async () => {
      const api = installVotingApi([]);

      // Proxy-origin absolute URL: accepted (fetch branch, no GM transport).
      const okRes = await api.uploadBinary(
        'https://vote.diorhc.space/storage/v1/upload/sign/features/aa/bb.png?token=t',
        new Blob(['x']),
        'image/png'
      );
      expect(okRes.success).toBe(true);

      // Foreign origin: refused before any transport.
      const rejected = await api.uploadBinary(
        'https://evil.example/upload/sign/x.png?token=t',
        new Blob(['x']),
        'image/png'
      );
      expect(rejected.success).toBe(false);
      expect(rejected.error).toBe('Untrusted upload URL origin');
    });
  });

  test('createUI renders voting container and form controls', () => {
    require('../src/voting.js');

    const host = document.createElement('div');
    document.body.appendChild(host);
    window.YouTubePlus.Voting.createUI(host);

    expect(host.querySelector('.yp-voting')).toBeTruthy();
    expect(host.querySelector('.yp-voting')).toBeTruthy();
    expect(host.querySelector('#yp-voting-list')).toBeTruthy();
    expect(host.querySelector('#yp-feature-title')).toBeTruthy();
    expect(host.querySelector('#yp-feature-desc')).toBeTruthy();
  });

  test('submitFeature validates empty, duplicate title (atomic RPC dedup) and trims payload', async () => {
    // Explicit write opt-in — the default is read-only (A04).
    window.YouTubePlusConfig = { communityWritesEnabled: true };

    // S1: duplicate-title detection is owned by the submit_feature RPC — the
    // server rejects the duplicate with the canonical error message.
    let duplicateRejected = true;
    const fetchMock = jest.fn(async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      const target = String(url);

      // Community writes require the actor registration handshake —
      // answer the Edge call with a stable actor id.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }

      if (target.includes('rpc/submit_feature') && method === 'POST') {
        if (duplicateRejected) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ message: 'Feature already exists' }),
            text: async () => '{}',
          };
        }
        return createOkResponse({ id: 'f-posted' });
      }

      return createOkResponse([]);
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    require('../src/voting.js');

    const empty = await window.YouTubePlus.Voting.submitFeature('   ', 'desc');
    expect(empty.success).toBe(false);
    expect(empty.error).toContain('Title is required');
    // Only the actor handshake may have fired — no dedup/submit RPC.
    const submitCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('rpc/submit_feature')
    );
    expect(submitCalls).toHaveLength(0);

    const duplicate = await window.YouTubePlus.Voting.submitFeature(' Existing Title ', 'desc');
    expect(duplicate.success).toBe(false);
    expect(duplicate.error).toContain('already exists');

    // Flip the server verdict so the submit passes and the normalize/trim
    // payload path is exercised (no separate client-side dedup request).
    duplicateRejected = false;

    const submit = await window.YouTubePlus.Voting.submitFeature(
      '  New   Feature  ',
      '  body\n\ntext  '
    );
    expect(submit.success).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
    expect(body.p_title).toBe('New Feature');
    expect(body.p_description).toBe('body text');
  });

  test('init handlers open/close comments panel and submit comment with validation', async () => {
    // Explicit write opt-in — the default is read-only (A04).
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    // Use native listeners for this test to exercise click handlers directly.
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        setSafeHTML: (el, html) => {
          if (el) {
            el.innerHTML = html;
          }
        },
        byId: id => document.getElementById(id),
        $: (selector, root) => (root || document).querySelector(selector),
        t: key => key,
        createHTML: s => s,
        helpers: {
          byId: id => document.getElementById(id),
          $: (selector, root) => (root || document).querySelector(selector),
          $$: sel => Array.from(document.querySelectorAll(sel)),
          t: key => key,
          logger: null,
          createHTML: s => s,
          debounce: fn => fn,
          setTimeout_: (fn, ms) => setTimeout(fn, ms),
        },
        cleanupManager: null,
        isSettingsModalOpen: jest.fn(() => false),
        createIsRelevantRoute: (opts = {}) => {
          const {
            watch = false,
            shorts = false,
            channel = false,
            domain = false,
            settingsModal = false,
          } = opts;
          return () => {
            if (settingsModal && window.YouTubeUtils.isSettingsModalOpen()) return true;
            if (domain && !window.YouTubeUtils.isYouTubeDomain()) return false;
            return (
              (window.YouTubeUtils.isWatchRoute() && watch) ||
              (window.YouTubeUtils.isShortsRoute() && shorts) ||
              (window.YouTubeUtils.isChannelRoute() && channel)
            );
          };
        },
        createWithErrorBoundary: _name => fn => fn,
        isWatchRoute: jest.fn(() => window.location.pathname === '/watch'),
        isShortsRoute: jest.fn(() => window.location.pathname.startsWith('/shorts')),
        isYouTubeDomain: jest.fn(() => true),
        isChannelRoute: jest.fn(() => false),
        logSuppressed: jest.fn(),
        whenRelevant: jest.fn(({ onEnter }) => {
          if (onEnter) onEnter();
          return { check: jest.fn(), dispose: jest.fn() };
        }),
        onSectionActive: jest.fn(() => ({ dispose: jest.fn() })),
        safeRequestAnimationFrame: jest.fn(cb => requestAnimationFrame(cb)),
      },
    });

    Object.defineProperty(window, 'YouTubeSafeDOM', {
      configurable: true,
      writable: true,
      value: {
        renderTemplateClone: (container, html) => {
          if (!(container instanceof Element)) return;
          const tpl = document.createElement('template');
          tpl.innerHTML = String(html ?? '');
          container.replaceChildren(tpl.content.cloneNode(true));
        },
        createTrustedHTML: s => s,
        createFragment: html => {
          const tpl = document.createElement('template');
          tpl.innerHTML = String(html ?? '');
          return tpl.content;
        },
      },
    });

    const fetchMock = jest.fn(async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      const target = String(url);

      // Community writes require the actor registration handshake —
      // answer the Edge call with a stable actor id.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }

      if (target.includes('rpc/get_feature_requests')) {
        // RPC contract: the normal list NEVER contains the preview row.
        return createListPage([
          {
            id: 'feature-1',
            title: 'Feature A',
            description: 'Useful feature',
            status: 'in_progress',
          },
        ]);
      }

      if (target.includes('rpc/get_preview_feature')) {
        return createOkResponse([
          {
            id: 'preview-1',
            title: 'Coming soon',
            description: 'A preview of an upcoming YouTube+ feature.',
            status: 'proposed',
          },
        ]);
      }

      if (target.includes('rpc/get_my_votes')) {
        return createOkResponse([{ feature_id: 'preview-1', vote_type: 1 }]);
      }

      if (target.includes('rpc/get_feature_comments')) {
        return createOkResponse([
          {
            id: 'c-1',
            feature_id: 'feature-1',
            comment: 'First comment',
            created_at: '2026-05-30T10:00:00.000Z',
          },
        ]);
      }

      if (target.includes('rpc/submit_comment') && method === 'POST') {
        return createOkResponse({
          id: 'c-2',
          featureId: 'feature-1',
          comment: 'New comment from test',
          createdAt: '2026-06-01T00:00:00Z',
          ownerCapability: 'test-cap-12345678901234567890123456789012345',
        });
      }

      return createOkResponse([]);
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    require('../src/voting.js');

    const host = document.createElement('div');
    document.body.appendChild(host);
    window.YouTubePlus.Voting.createUI(host);
    await window.YouTubePlus.Voting.loadFeatures();
    window.YouTubePlus.Voting.init();

    const commentsOpen = host.querySelector('[data-comments-open="1"]');
    expect(commentsOpen).toBeTruthy();
    commentsOpen.click();

    const panel = document.getElementById('yp-comments-panel');
    expect(panel?.classList.contains('open')).toBe(true);

    const input = document.getElementById('yp-comments-input');
    const submitBtn = document.getElementById('yp-comments-submit');
    expect(input).toBeTruthy();
    expect(submitBtn).toBeTruthy();

    // Empty value: should not send POST
    input.value = '   ';
    submitBtn.click();
    await Promise.resolve();
    expect(
      fetchMock.mock.calls.some(
        ([u, o]) => String(u).includes('rpc/submit_comment') && String(o?.method) === 'POST'
      )
    ).toBe(false);

    input.value = '  New comment from test  ';
    submitBtn.click();
    // The write path now includes the actor handshake before the RPC —
    // flush the full async chain, not just two microtasks.
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(
      fetchMock.mock.calls.some(
        ([u, o]) => String(u).includes('rpc/submit_comment') && String(o?.method) === 'POST'
      )
    ).toBe(true);

    const nonVotingNav = document.createElement('button');
    nonVotingNav.className = 'yp-settings-nav-item';
    nonVotingNav.setAttribute('data-section', 'general');
    document.body.appendChild(nonVotingNav);
    nonVotingNav.click();
    expect(panel?.classList.contains('open')).toBe(false);
  });

  test('vote returns success:false when cast_vote RPC fails', async () => {
    const fetchMock = jest.fn(async (url, _options = {}) => {
      const target = String(url);

      // Community writes require the actor registration handshake —
      // answer the Edge call with a stable actor id.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }

      // cast_vote RPC fails (e.g. invalid client_id, DB error)
      if (target.includes('rpc/cast_vote')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ message: 'client_id is required' }),
          text: async () => '{}',
        };
      }

      return createOkResponse([]);
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    require('../src/voting.js');

    const result = await window.YouTubePlus.Voting.vote('feature-1', 1);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('vote returns action from cast_vote RPC (add/update/remove)', async () => {
    // Explicit write opt-in — the default is read-only (A04).
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);

      // Community writes require the actor registration handshake —
      // answer the Edge call with a stable actor id.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/cast_vote')) {
        const body = JSON.parse(String(options.body || '{}'));
        if (body.p_vote_type === 0) return createOkResponse({ action: 'removed' });
        return createOkResponse({ action: 'updated' });
      }
      return createOkResponse([]);
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    require('../src/voting.js');

    const updated = await window.YouTubePlus.Voting.vote('feature-1', -1);
    expect(updated.success).toBe(true);
    expect(updated.action).toBe('updated');

    const removed = await window.YouTubePlus.Voting.vote('feature-1', 0);
    expect(removed.success).toBe(true);
    expect(removed.action).toBe('removed');
  });

  test('getCommentsByFeatureIds sends the batched id array to the RPC and skips empty input', async () => {
    const fetchMock = jest.fn(async () => createOkResponse([]));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    require('../src/voting.js');
    const voting = window.YouTubePlus.Voting;

    // Empty/garbage input must not hit the network at all.
    const empty = await voting.getCommentsByFeatureIds([]);
    expect(empty).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();

    // Guard branch under test: ids travel as a JSON array argument — no URL
    // interpolation, so ids containing spaces/ampersands need no escaping.
    await voting.getCommentsByFeatureIds(['id with space&comma', 'plain']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('rpc/get_feature_comments');
    expect(JSON.parse(init.body)).toEqual({
      p_feature_ids: ['id with space&comma', 'plain'],
    });
  });

  test('initSlider handles mouse, touch, keyboard events and autoplay', async () => {
    jest.useFakeTimers();
    try {
      require('../src/voting.js');

      document.body.innerHTML = `
        <div class="yp-ba-container" style="width: 400px; height: 200px;">
          <div class="yp-ba-after"></div>
          <div class="yp-ba-divider" aria-valuenow="50"></div>
        </div>
      `;

      const container = document.querySelector('.yp-ba-container');
      const divider = document.querySelector('.yp-ba-divider');

      container.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
        width: 400,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => {
          /* mock */
        },
      });

      window.YouTubePlus.Voting.initSlider();

      // Autoplay timer triggers
      jest.advanceTimersByTime(500);
      expect(divider.classList.contains('autoplay')).toBe(true);

      // Mousedown on container
      container.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
      expect(divider.classList.contains('autoplay')).toBe(false);
      expect(divider.style.left).toBe('25%');

      // Mousemove on window while dragging
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, bubbles: true }));
      jest.advanceTimersByTime(20);
      expect(divider.style.left).toBe('50%');

      // Mouseup on window
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      // Mousemove after mouseup should not update position
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, bubbles: true }));
      jest.advanceTimersByTime(20);
      expect(divider.style.left).toBe('50%');

      // Touch events
      container.dispatchEvent(
        new TouchEvent('touchstart', {
          touches: [{ clientX: 100 }],
          bubbles: true,
        })
      );
      expect(divider.style.left).toBe('25%');

      window.dispatchEvent(
        new TouchEvent('touchmove', {
          touches: [{ clientX: 300 }],
          bubbles: true,
        })
      );
      jest.advanceTimersByTime(20);
      expect(divider.style.left).toBe('75%');

      window.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));

      // Keyboard events on divider
      divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      expect(divider.getAttribute('aria-valuenow')).toBe('73');

      divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(divider.getAttribute('aria-valuenow')).toBe('75');

      // Autoplay resumes after delay
      jest.advanceTimersByTime(3500);
      expect(divider.classList.contains('autoplay')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('slider autoplay stops when the preview detaches (modal close)', () => {
    jest.useFakeTimers();
    try {
      require('../src/voting.js');

      document.body.innerHTML = `
        <div class="yp-ba-container" style="width: 400px; height: 200px;">
          <div class="yp-ba-after"></div>
          <div class="yp-ba-divider" aria-valuenow="50"></div>
        </div>
      `;

      const container = document.querySelector('.yp-ba-container');
      const divider = document.querySelector('.yp-ba-divider');
      container.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
        width: 400,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      });

      const rafSpy = jest.spyOn(window, 'requestAnimationFrame');
      window.YouTubePlus.Voting.initSlider();
      expect(rafSpy.mock.calls.length).toBeGreaterThan(0);

      // Settings modal close removes the preview subtree: the frame loop
      // must stop instead of rescheduling against a detached container.
      container.remove();
      jest.advanceTimersByTime(50);
      const afterStop = rafSpy.mock.calls.length;
      jest.advanceTimersByTime(500);
      expect(rafSpy.mock.calls.length).toBe(afterStop);
      expect(divider.style.left).toBe('50%');

      // A pending resume timer scheduled before close must not resurrect
      // the autoplay animation on a detached preview.
      container.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
      expect(divider.classList.contains('autoplay')).toBe(false);
      jest.advanceTimersByTime(4000);
      expect(divider.classList.contains('autoplay')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the window drag listeners exist only during a drag and never accumulate', () => {
    require('../src/voting.js');

    const windowDragCount = () =>
      registeredListeners.filter(
        l =>
          l.target === window && ['mousemove', 'mouseup', 'touchmove', 'touchend'].includes(l.type)
      ).length;

    // Opening the preview three times registers no window drag listeners.
    for (let i = 0; i < 3; i++) {
      document.body.innerHTML = `
        <div class="yp-ba-container" style="width: 400px; height: 200px;">
          <div class="yp-ba-after"></div>
          <div class="yp-ba-divider" aria-valuenow="50"></div>
        </div>`;
      const c = document.querySelector('.yp-ba-container');
      c.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
        width: 400,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      });
      window.YouTubePlus.Voting.initSlider();
    }
    expect(windowDragCount()).toBe(0);

    // A drag attaches exactly one set of window listeners.
    const container = document.querySelector('.yp-ba-container');
    container.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    expect(windowDragCount()).toBe(4);

    // A second mousedown during the same drag adds no second set.
    container.dispatchEvent(new MouseEvent('mousedown', { clientX: 120, bubbles: true }));
    expect(windowDragCount()).toBe(4);

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(windowDragCount()).toBe(0);
  });

  test('leaving the voting section stops the preview autoplay loop', () => {
    jest.useFakeTimers();
    try {
      require('../src/voting.js');

      document.body.innerHTML = `
        <div class="yp-ba-container" style="width: 400px; height: 200px;">
          <div class="yp-ba-after"></div>
          <div class="yp-ba-divider" aria-valuenow="50"></div>
        </div>`;
      const container = document.querySelector('.yp-ba-container');
      const divider = document.querySelector('.yp-ba-divider');
      container.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 200,
        width: 400,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      });

      window.YouTubePlus.Voting.initSlider();
      expect(divider.classList.contains('autoplay')).toBe(true);

      const call = window.YouTubeUtils.onSectionActive.mock.calls.find(c => c[0] === 'voting');
      expect(typeof call?.[2]).toBe('function');
      call[2]();

      expect(divider.classList.contains('autoplay')).toBe(false);
      const rafSpy = jest.spyOn(window, 'requestAnimationFrame');
      jest.advanceTimersByTime(50);
      const settled = rafSpy.mock.calls.length;
      jest.advanceTimersByTime(500);
      expect(rafSpy.mock.calls.length).toBe(settled);

      // Coming back to the section restarts autoplay on the same preview.
      window.YouTubePlus.Voting.initSlider();
      expect(divider.classList.contains('autoplay')).toBe(true);
      expect(rafSpy.mock.calls.length).toBeGreaterThan(settled);
    } finally {
      jest.useRealTimers();
    }
  });

  test('feature form interactions (toggle, submit validation, cancel, and success)', async () => {
    // Explicit write opt-in — the default is read-only (A04).
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    const fetchMock = jest.fn(async (url, _options = {}) => {
      const target = String(url);

      // Community writes require the actor registration handshake —
      // answer the Edge call with a stable actor id.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/submit_feature')) {
        return createOkResponse({ id: 'new-feature', title: 'Valid Title' });
      }
      return createOkResponse([]);
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    require('../src/voting.js');
    window.YouTubePlus.Voting.init(true);

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = `
      <div class="yp-voting">
        <button id="yp-show-add-feature">+ Add Feature</button>
        <div id="yp-voting-list"></div>
        <div id="yp-voting-add-form" style="display: none;">
          <input type="text" id="yp-feature-title" />
          <textarea id="yp-feature-desc"></textarea>
          <button id="yp-cancel-feature">Cancel</button>
          <button id="yp-submit-feature">Submit</button>
        </div>
      </div>
    `;

    const showBtn = document.getElementById('yp-show-add-feature');
    const form = document.getElementById('yp-voting-add-form');
    const titleInput = document.getElementById('yp-feature-title');
    const descInput = document.getElementById('yp-feature-desc');
    const cancelBtn = document.getElementById('yp-cancel-feature');
    const submitBtn = document.getElementById('yp-submit-feature');

    // Click show
    showBtn.click();
    expect(form.style.display).toBe('block');
    expect(showBtn.style.display).toBe('none');

    // Enter title & desc, then cancel
    titleInput.value = 'Temporary Title';
    descInput.value = 'Temporary Desc';
    cancelBtn.click();
    expect(form.style.display).toBe('none');
    expect(titleInput.value).toBe('');
    expect(descInput.value).toBe('');

    // Click show again
    showBtn.click();
    // Submit with empty title - validation triggers
    submitBtn.click();
    expect(fetchMock).not.toHaveBeenCalled();

    // Fill title and submit
    titleInput.value = 'Valid Title';
    descInput.value = 'Valid Description';
    submitBtn.click();

    await new Promise(r => setTimeout(r, 20));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('rpc/submit_feature'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('comments panel layouts on resize and resets on settings closed', async () => {
    require('../src/voting.js');
    window.YouTubePlus.Voting.init(true);

    const shell = document.createElement('div');
    shell.className = 'yp-settings-shell';
    const settingsPanel = document.createElement('div');
    settingsPanel.className = 'yp-settings-panel';
    document.body.appendChild(shell);
    document.body.appendChild(settingsPanel);

    settingsPanel.getBoundingClientRect = () => ({
      left: 200,
      right: 600,
      top: 50,
      height: 400,
      width: 400,
      bottom: 450,
      x: 200,
      y: 50,
      toJSON: () => {
        /* mock */
      },
    });

    const panel = document.getElementById('yp-comments-panel');
    expect(panel).toBeTruthy();
    panel.classList.add('open');

    // Trigger window resize -> layoutCommentsPanel, coalesced to one call per frame
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 50));
    expect(panel.style.left).toBeTruthy();
    expect(panel.style.top).toBeTruthy();

    // Trigger document youtube-plus-settings-modal-closed -> onSettingsClosed
    document.dispatchEvent(new CustomEvent('youtube-plus-settings-modal-closed'));
    expect(panel.classList.contains('open')).toBe(false);
  });

  test('A/B/C: getFeatureRequests and getPreviewFeature go through the RPC contract with no REST reads', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);

      // Community writes require the actor registration handshake —
      // answer the Edge call with a stable actor id.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/get_preview_feature')) {
        return createOkResponse([
          { id: 'f-preview', title: 'Preview Feature', description: 'desc', status: 'proposed' },
        ]);
      }
      if (target.includes('rpc/get_feature_requests')) {
        return createListPage([
          { id: 'f-1', title: 'Feature 1', description: 'desc', status: 'proposed' },
        ]);
      }
      return createOkResponse([]);
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    require('../src/voting.js');
    const features = await window.YouTubePlus.Voting.VotingApi.getFeatureRequests();
    expect(features.rows.length).toBe(1);

    const call1 = fetchMock.mock.calls[0];
    const url1 = String(call1[0]);
    const opts1 = call1[1] || {};

    // A: the request read goes through the canonical RPC
    expect(url1).toContain('rpc/get_feature_requests');
    // B: it is a POST RPC with a JSON body — no REST query parameters, no
    //    limit/offset/count=exact pagination remnants
    expect(opts1.method).toBe('POST');
    expect(url1).not.toContain('select=');
    expect(url1).not.toContain('limit=');
    expect(url1).not.toContain('offset=');
    const headers1 = opts1.headers;
    const preferHeader = headers1 instanceof Headers ? headers1.get('Prefer') : headers1?.Prefer;
    expect(preferHeader).toBeFalsy();

    // C: the preview read is its own dedicated RPC (identity = feature_type,
    // decided server-side; the client never sends a title or filter)
    const preview = await window.YouTubePlus.Voting.VotingApi.getPreviewFeature();
    expect(preview?.feature?.id).toBe('f-preview');
    const call2 = fetchMock.mock.calls[1];
    const url2 = String(call2[0]);
    expect(url2).toContain('rpc/get_preview_feature');
    expect(url2).not.toContain('select=');

    // No non-rpc Supabase request happened at all (zero REST surface).
    const nonRpc = fetchMock.mock.calls.filter(([u]) => !String(u).includes('/rpc/'));
    expect(nonRpc).toEqual([]);
  });

  test('getAllVotes calls the get_vote_counts RPC with the batched id array', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);

      // Community writes require the actor registration handshake —
      // answer the Edge call with a stable actor id.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/get_vote_counts')) {
        return createOkResponse([
          { feature_id: 'feat-1', upvotes: 42, downvotes: 3 },
          { feature_id: 'feat-2', upvotes: 10, downvotes: 5 },
        ]);
      }
      return createOkResponse([]);
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    require('../src/voting.js');
    const votes = await window.YouTubePlus.Voting.getAllVotes(['feat-1', 'feat-2']);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('rpc/get_vote_counts'),
      expect.anything()
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.p_feature_ids).toEqual(['feat-1', 'feat-2']);
    expect(votes['feat-1']).toEqual({ upvotes: 42, downvotes: 3 });
    expect(votes['feat-2']).toEqual({ upvotes: 10, downvotes: 5 });
  });

  describe('Anonymous write protection & read-only switch', () => {
    test('isCommunityWriteEnabled defaults to READ-ONLY', () => {
      require('../src/voting.js');
      // Without ANY configuration the writes are forbidden — an explicit
      // opt-in is required (N01).
      expect(window.YouTubePlus.Voting.isCommunityWriteEnabled()).toBe(false);

      window.YouTubePlusConfig = { communityWritesEnabled: false };
      expect(window.YouTubePlus.Voting.isCommunityWriteEnabled()).toBe(false);

      // Only an explicit true opts in.
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      expect(window.YouTubePlus.Voting.isCommunityWriteEnabled()).toBe(true);

      // Any other value (undefined/null/0) stays read-only.
      window.YouTubePlusConfig = {};
      expect(window.YouTubePlus.Voting.isCommunityWriteEnabled()).toBe(false);
      delete window.YouTubePlusConfig;
      expect(window.YouTubePlus.Voting.isCommunityWriteEnabled()).toBe(false);
    });

    test('N01: without configuration, vote/submit/comment are rejected with no network calls', async () => {
      const fetchMock = jest.fn();
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      delete window.YouTubePlusConfig;
      require('../src/voting.js');

      const voteResult = await window.YouTubePlus.Voting.vote('feat-123', 1);
      expect(voteResult.success).toBe(false);
      expect(voteResult.error).toContain('read-only mode');

      const submitResult = await window.YouTubePlus.Voting.submitFeature('New Feature', 'Desc');
      expect(submitResult.success).toBe(false);
      expect(submitResult.error).toContain('read-only mode');

      const commentResult = await window.YouTubePlus.Voting.VotingApi.submitComment(
        'feat-123',
        'A comment'
      );
      expect(commentResult.success).toBe(false);
      expect(commentResult.error).toContain('read-only mode');

      const signResult = await window.YouTubePlus.Voting.VotingApi.signUpload({
        target: 'feature',
        parentId: 'feat-123',
        idempotencyKey: '00000000-0000-0000-0000-000000000000',
        ownerCapability: 'cap',
        mimeType: 'image/png',
      });
      expect(signResult.success).toBe(false);
      expect(signResult.error).toContain('read-only mode');

      const finalizeFeatResult = await window.YouTubePlus.Voting.VotingApi.finalizeFeatureImage(
        'feat-123',
        'cap',
        'slot-1'
      );
      expect(finalizeFeatResult.success).toBe(false);
      expect(finalizeFeatResult.error).toContain('read-only mode');

      const finalizeCommResult = await window.YouTubePlus.Voting.VotingApi.finalizeCommentImage(
        'comm-123',
        'cap',
        'slot-1'
      );
      expect(finalizeCommResult.success).toBe(false);
      expect(finalizeCommResult.error).toContain('read-only mode');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('N02: read-only load never creates the preview row (0 mutations, read lookup only)', async () => {
      const requests = [];
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: (url, opts) => {
          requests.push({ url: String(url), method: String(opts?.method || 'GET') });
          if (String(url).includes('rpc/get_feature_requests')) {
            // Read lookup: the preview row does not exist yet.
            return Promise.resolve({ ok: true, json: async () => ({ rows: [], hasMore: false }) });
          }
          if (String(url).includes('rpc/get_my_votes')) {
            return Promise.resolve({ ok: true, json: async () => [] });
          }
          return Promise.resolve({ ok: true, json: async () => [] });
        },
      });
      delete window.YouTubePlusConfig;
      require('../src/voting.js');

      // The load flow only READS: render the voting UI so the list element
      // exists, then run a load.
      const container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);
      await window.YouTubePlus.Voting.loadFeatures();
      const mutating = requests.filter(
        r =>
          (r.method === 'POST' || r.method === 'PATCH' || r.method === 'DELETE') &&
          !/rpc\//.test(r.url)
      );
      expect(mutating).toEqual([]);
      // The read-only preview lookup ran through its dedicated RPC — a READ,
      // never a write (all non-rpc POSTs are already asserted impossible).
      const previewLookup = requests.find(r => r.url.includes('rpc/get_preview_feature'));
      expect(previewLookup).toBeTruthy();
      // Zero non-rpc requests at all: the REST view surface no longer exists.
      const nonRpc = requests.filter(r => !/rpc\//.test(r.url));
      expect(nonRpc).toEqual([]);
    });

    test('vote and submitFeature reject immediately without network calls when writes are disabled', async () => {
      const fetchMock = jest.fn();
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      window.YouTubePlusConfig = { communityWritesEnabled: false };
      require('../src/voting.js');

      const voteResult = await window.YouTubePlus.Voting.vote('feat-123', 1);
      expect(voteResult.success).toBe(false);
      expect(voteResult.error).toContain('read-only mode');

      const submitResult = await window.YouTubePlus.Voting.submitFeature('New Feature', 'Desc');
      expect(submitResult.success).toBe(false);
      expect(submitResult.error).toContain('read-only mode');

      expect(fetchMock).not.toHaveBeenCalled();
      delete window.YouTubePlusConfig;
    });

    test('createUI renders read-only banner and disables add button when writes are disabled', () => {
      window.YouTubePlusConfig = { communityWritesEnabled: false };
      require('../src/voting.js');

      const container = document.createElement('div');
      window.YouTubePlus.Voting.createUI(container);

      const banner = container.querySelector('#yp-voting-readonly-banner');
      expect(banner).not.toBeNull();
      expect(banner.textContent).toContain('read-only mode');

      const addBtn = container.querySelector('#yp-show-add-feature');
      expect(addBtn.disabled).toBe(true);

      delete window.YouTubePlusConfig;
    });
  });

  describe('Database insert contract & RPC writes', () => {
    test('submitFeature invokes rpc/submit_feature with client_id in payload', async () => {
      // Explicit write opt-in — the default is read-only (A04).
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      const fetchMock = jest.fn(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/submit_feature')) {
          return createOkResponse({ id: 'fresh-id' });
        }
        return createOkResponse([]);
      });

      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      require('../src/voting.js');
      const result = await window.YouTubePlus.Voting.submitFeature(
        'My Fresh Feature',
        'A cool description'
      );
      expect(result.success).toBe(true);

      const rpcCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('rpc/submit_feature')
      );
      expect(rpcCall).toBeDefined();
      const [, init] = rpcCall;

      const body = JSON.parse(init.body);
      expect(body.p_title).toBe('My Fresh Feature');
      expect(body.p_description).toBe('A cool description');
      // The third parameter is the OWNER SECRET (proof of
      // possession, verified server-side) — no caller-supplied owner field.
      expect(body.p_secret).toBeDefined();
      expect(typeof body.p_secret).toBe('string');
      expect(body.p_secret.length).toBeGreaterThanOrEqual(43);
      expect(body.p_client_id).toBeUndefined();
    });

    test('submitFeature rejects duplicates via the atomic RPC verdict (no client-side dedup request)', async () => {
      const fetchMock = jest.fn(async (url, _options = {}) => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/submit_feature')) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ message: 'Feature already exists' }),
            text: async () => '{}',
          };
        }
        return createOkResponse([]);
      });

      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      // Explicit write opt-in — the default is read-only (A04).
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      require('../src/voting.js');
      const result = await window.YouTubePlus.Voting.submitFeature(
        'Duplicate Feature',
        'Some desc'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
      // The actor handshake precedes the submit; the ONLY other call
      // was the submit RPC itself (no separate client-side dedup request).
      const rpcCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('rpc/'));
      expect(rpcCalls.length).toBe(1);
      expect(String(rpcCalls[0][0])).toContain('rpc/submit_feature');
    });
  });

  describe('Full list rendering & Stale request cancellation', () => {
    test('D/E: all returned normal feature requests are rendered in one list without pagination controls, and preview is excluded', async () => {
      const mockFeatures = Array.from({ length: 25 }, (_, i) => ({
        id: `feat-${i + 1}`,
        title: `Feature ${i + 1}`,
        description: `Description ${i + 1}`,
        status: 'proposed',
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        feature_type: 'request',
      }));
      // Defense in depth: include a preview item in the returned array to ensure it's filtered out
      mockFeatures.push({
        id: 'feat-preview',
        title: 'Preview In List',
        description: 'Should be filtered out',
        status: 'proposed',
        created_at: new Date().toISOString(),
        feature_type: 'preview',
      });

      const fetchMock = jest.fn(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) {
          return createListPage(mockFeatures);
        }
        if (target.includes('rpc/get_vote_counts')) {
          return createOkResponse([]);
        }
        if (target.includes('rpc/get_feature_comments')) {
          return createOkResponse([]);
        }
        if (target.includes('rpc/get_my_votes')) {
          return createOkResponse([]);
        }
        return createOkResponse([]);
      });

      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      require('../src/voting.js');
      const container = document.createElement('div');
      window.YouTubePlus.Voting.createUI(container);
      document.body.appendChild(container);

      await window.YouTubePlus.Voting.loadFeatures();

      // All 25 normal items rendered in one list without artificial page slicing
      const items = container.querySelectorAll('.yp-voting-item');
      expect(items.length).toBe(25);

      // Preview record never renders as a normal feature request
      const titles = Array.from(container.querySelectorAll('.yp-voting-item-title')).map(
        el => el.textContent
      );
      expect(titles).not.toContain('Preview In List');

      // No pagination controls exist in DOM
      expect(container.querySelector('#yp-voting-pagination')).toBeNull();
      expect(container.querySelector('#yp-voting-prev-btn')).toBeNull();
      expect(container.querySelector('#yp-voting-next-btn')).toBeNull();
      expect(container.querySelector('#yp-voting-page-info')).toBeNull();
    });

    test('loadFeatures ignores stale responses from earlier in-flight requests', async () => {
      let resolveFirst;
      const firstPromise = new Promise(resolve => {
        resolveFirst = resolve;
      });

      let callCount = 0;
      const fetchMock = jest.fn(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) {
          callCount++;
          if (callCount === 1) {
            // First call stalls
            await firstPromise;
            return createListPage([
              {
                id: 'feat-slow',
                title: 'Slow Feature',
                description: 'Stale data',
                status: 'proposed',
              },
            ]);
          }
          // Second call resolves immediately with fast feature
          return createListPage([
            {
              id: 'feat-fast',
              title: 'Fast Feature',
              description: 'Fresh data',
              status: 'proposed',
            },
          ]);
        }
        return createOkResponse([]);
      });

      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      require('../src/voting.js');
      const container = document.createElement('div');
      window.YouTubePlus.Voting.createUI(container);
      document.body.appendChild(container);

      // Start slow request
      const p1 = window.YouTubePlus.Voting.loadFeatures();
      // Start fast request immediately
      const p2 = window.YouTubePlus.Voting.loadFeatures();

      await p2;

      // Ensure fast request is rendered
      let itemTitle = container.querySelector('.yp-voting-item-title');
      expect(itemTitle?.textContent).toBe('Fast Feature');

      // Now resolve the first (slow/stale) request
      resolveFirst();
      await p1;

      // Verify the UI still reflects the newer (fast) request and did not get overwritten by the stale request
      itemTitle = container.querySelector('.yp-voting-item-title');
      expect(itemTitle?.textContent).toBe('Fast Feature');
    });

    test('vote success no longer reloads the list — one card + bar update in place', async () => {
      // A vote updates ONE card and the preview bar in place.
      // The old full-list reload (loadFeatures after every vote) is gone.
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      let loadCount = 0;

      const fetchMock = jest.fn(async (url, _options = {}) => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) {
          loadCount++;
          return createListPage([
            {
              id: 'feat-1',
              title: 'Feature 1',
              description: '',
              status: 'proposed',
              feature_type: 'request',
            },
          ]);
        }
        if (target.includes('rpc/cast_vote')) {
          return createOkResponse({ action: 'added' });
        }
        return createOkResponse([]);
      });

      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      require('../src/voting.js');
      const container = document.createElement('div');
      window.YouTubePlus.Voting.createUI(container);
      document.body.appendChild(container);

      await window.YouTubePlus.Voting.loadFeatures();
      expect(loadCount).toBe(1);

      const voteResult = await window.YouTubePlus.Voting.vote('feat-1', 1);
      expect(voteResult.success).toBe(true);
      // NO full reload after a vote.
      expect(loadCount).toBe(1);
    });

    test('G: feature submission success reloads the complete Voting data', async () => {
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      let loadCount = 0;

      const fetchMock = jest.fn(async (url, options = {}) => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        const method = String(options.method || 'GET').toUpperCase();
        if (target.includes('rpc/get_feature_requests')) {
          loadCount++;
          return createListPage([
            {
              id: 'feat-1',
              title: 'Feature 1',
              description: '',
              status: 'proposed',
              feature_type: 'request',
            },
          ]);
        }
        if (target.includes('rpc/submit_feature') && method === 'POST') {
          return createOkResponse({
            id: 'feat-2',
            title: 'Feature 2',
            description: '',
            status: 'proposed',
          });
        }
        return createOkResponse([]);
      });

      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      require('../src/voting.js');
      const container = document.createElement('div');
      window.YouTubePlus.Voting.createUI(container);
      document.body.appendChild(container);

      await window.YouTubePlus.Voting.loadFeatures();
      expect(loadCount).toBe(1);

      const submitResult = await window.YouTubePlus.Voting.submitFeature(
        'Feature 2',
        'Description'
      );
      expect(submitResult.success).toBe(true);
      expect(loadCount).toBe(2);
    });

    // -- Acceptance fixtures ----------------------------------------

    function makeServerFetch({ failViewAndRpc = false } = {}) {
      return async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) {
          return createListPage(mockRecordSet);
        }
        if (target.includes('rpc/get_vote_counts')) {
          if (failViewAndRpc) {
            return {
              ok: false,
              status: 500,
              json: async () => ({ message: 'down' }),
              headers: { get: () => null },
            };
          }
          return createOkResponse([]);
        }
        if (target.includes('rpc/get_my_votes')) {
          return createOkResponse([]);
        }
        return createOkResponse([]);
      };
    }

    /** Deterministic record set with EQUAL created_at values (tie-breaker). */
    const SAME_TS = '2026-09-01T00:00:00.000Z';
    let mockRecordSet = [];

    test('unavailable aggregates are shown explicitly (RPC failure, no fallback rows)', async () => {
      mockRecordSet = [
        {
          id: 'feat-1',
          title: 'Only One',
          description: '',
          status: 'proposed',
          created_at: SAME_TS,
        },
      ];
      const fetchMock = jest.fn(
        makeServerFetch({ failViewAndRpc: true, rawRows: [], failRaw: true })
      );
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      require('../src/voting.js');
      const container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="yp-vote-bar-fill"></div><div id="yp-vote-bar-count"></div>'
      );
      await window.YouTubePlus.Voting.loadFeatures();

      const countEl = document.getElementById('yp-vote-bar-count');
      expect(countEl.textContent).toContain('unavailable');
    });

    // -- honest failure states ---------------------------

    test('HTTP 503 on the list endpoint shows an explicit error state with retry, not "no requests yet"', async () => {
      const fetchMock = jest.fn(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ message: 'Service Unavailable' }),
            headers: { get: () => null },
          };
        }
        return createListPage([]);
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      require('../src/voting.js');
      const container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="yp-vote-bar-fill"></div><div id="yp-vote-bar-count"></div>'
      );

      await window.YouTubePlus.Voting.loadFeatures();

      // 503 must NEVER render as an empty list.
      expect(container.querySelector('.yp-voting-empty')).toBeNull();
      expect(container.querySelector('.yp-voting-error')).toBeTruthy();
      expect(container.querySelector('.yp-voting-retry')).toBeTruthy();

      // The aggregate bar marks the totals unavailable.
      const countEl = document.getElementById('yp-vote-bar-count');
      expect(countEl.textContent).toContain('unavailable');

      // Retry restores the real data once the server recovers.
      fetchMock.mockImplementation(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) {
          return createListPage([
            { id: 'feat-1', title: 'Recovered Feature', description: '', status: 'proposed' },
          ]);
        }
        return createOkResponse([]);
      });
      container.querySelector('.yp-voting-retry').click();
      await Promise.resolve();
      await new Promise(r => setTimeout(r, 0));
      expect(container.querySelector('.yp-voting-error')).toBeNull();
      expect(container.querySelector('.yp-voting-item-title')?.textContent).toBe(
        'Recovered Feature'
      );
    });

    test('unavailable vote aggregates show unknown card counters, never a fabricated zero', async () => {
      mockRecordSet = [
        {
          id: 'feat-1',
          title: 'Only One',
          description: '',
          status: 'proposed',
          created_at: SAME_TS,
        },
      ];
      // List loads fine; EVERY vote endpoint is down (503).
      const fetchMock = jest.fn(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) {
          return createListPage(mockRecordSet);
        }
        return {
          ok: false,
          status: 503,
          json: async () => ({ message: 'down' }),
          headers: { get: () => null },
        };
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      require('../src/voting.js');
      const container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);
      await window.YouTubePlus.Voting.loadFeatures();

      const total = container.querySelector('.yp-vote-total');
      expect(total).toBeTruthy();
      // The card must not claim "0 votes" when nothing is known.
      expect(total.textContent).not.toContain('0');
      expect(total.textContent).toContain('unavailable');
    });

    test('a real empty list still shows the empty state, and real zero votes show as zero', async () => {
      // (a) Genuine empty list (server answers 200 with no rows).
      let fetchMock = jest.fn(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => '0-0/0' },
            json: async () => ({
              rows: [],
              hasMore: false,
              nextCursorCreatedAt: null,
              nextCursorId: null,
            }),
          };
        }
        return createListPage([]);
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      require('../src/voting.js');
      let container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);
      await window.YouTubePlus.Voting.loadFeatures();
      expect(container.querySelector('.yp-voting-empty')).toBeTruthy();
      expect(container.querySelector('.yp-voting-error')).toBeNull();

      // (b) A feature with zero votes under healthy aggregates shows 0.
      document.body.removeChild(container);
      jest.resetModules();
      fetchMock = jest.fn(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) {
          return createListPage([
            { id: 'feat-zero', title: 'Zero Votes Feature', description: '', status: 'proposed' },
          ]);
        }
        if (target.includes('rpc/get_vote_counts')) {
          return createOkResponse([]); // aggregates healthy; no rows = real zero
        }
        return createOkResponse([]);
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });

      require('../src/voting.js');
      container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);
      await window.YouTubePlus.Voting.loadFeatures();

      const total = container.querySelector('.yp-vote-total');
      expect(total?.textContent).toContain('0');
    });
  });

  describe('V4 Targeted Feature Tests', () => {
    test('Preview discriminator: feature_type === "preview" renders DB title/desc vs 0-preview hide', async () => {
      const fetchMock = jest.fn(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) return createListPage([]);
        if (target.includes('rpc/get_preview_feature')) {
          return createOkResponse([
            {
              id: 'preview-uuid-1',
              title: 'Live Preview Feature',
              description: 'Live Preview Description from DB',
              feature_type: 'preview',
              status: 'in_progress',
            },
          ]);
        }
        if (target.includes('rpc/get_feature_images')) {
          return createOkResponse([
            {
              id: 'img-1',
              feature_id: 'preview-uuid-1',
              storage_path: 'preview-before.webp',
              mime_type: 'image/webp',
              sort_order: 0,
            },
            {
              id: 'img-2',
              feature_id: 'preview-uuid-1',
              storage_path: 'preview-after.webp',
              mime_type: 'image/webp',
              sort_order: 1,
            },
          ]);
        }
        return createOkResponse([]);
      });

      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      require('../src/voting.js');

      const container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);

      await window.YouTubePlus.Voting.loadFeatures();

      const previewEl = document.getElementById('yp-voting-preview');
      expect(previewEl).toBeTruthy();
      expect(previewEl.textContent).toContain('Live Preview Feature');
      expect(previewEl.textContent).toContain('Live Preview Description from DB');

      // Now test 0-preview graceful hide
      fetchMock.mockImplementation(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) return createListPage([]);
        if (target.includes('rpc/get_preview_feature')) {
          return createOkResponse([]);
        }
        return createOkResponse([]);
      });

      await window.YouTubePlus.Voting.loadFeatures();
      expect(previewEl.style.display).toBe('none');
    });

    test('Shared Lightbox Gallery: open, next/prev, escape/arrow keys, focus restoration', () => {
      require('../src/voting.js');
      window.YouTubePlus.Voting.init(true);

      const items = [
        { url: 'https://example.com/img1.webp', caption: 'Image One' },
        { url: 'https://example.com/img2.webp', caption: 'Image Two' },
      ];

      const triggerBtn = document.createElement('button');
      document.body.appendChild(triggerBtn);
      triggerBtn.focus();

      window.YouTubePlus.Voting.VotingGallery.open({ items, initialIndex: 0 });

      const modal = document.getElementById('yp-gallery-modal');
      expect(modal).toBeTruthy();
      expect(modal.classList.contains('open')).toBe(true);

      const counter = modal.querySelector('.yp-gallery-counter');
      expect(counter?.textContent).toContain('1 / 2');

      const nextBtn = /** @type {HTMLElement|null} */ (modal.querySelector('.yp-gallery-next'));
      nextBtn?.click();
      expect(counter?.textContent).toContain('2 / 2');

      const prevBtn = /** @type {HTMLElement|null} */ (modal.querySelector('.yp-gallery-prev'));
      prevBtn?.click();
      expect(counter?.textContent).toContain('1 / 2');

      // Keyboard navigation
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(counter?.textContent).toContain('2 / 2');

      // Escape closes
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(modal.classList.contains('open')).toBe(false);
      expect(document.activeElement).toBe(triggerBtn);
    });

    test('Media pipeline validation: rejects SVG/GIF and files > 5MB', async () => {
      require('../src/voting.js');
      const { VotingMedia } = window.YouTubePlus.Voting;

      const svgFile = new File(['<svg></svg>'], 'image.svg', { type: 'image/svg+xml' });
      const gifFile = new File(['GIF89a'], 'image.gif', { type: 'image/gif' });
      const oversizedFile = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', {
        type: 'image/png',
      });

      expect(VotingMedia.validateFile(svgFile)).toEqual({
        valid: false,
        error: expect.stringMatching(/JPG, PNG, and WebP/),
      });
      expect(VotingMedia.validateFile(gifFile)).toEqual({
        valid: false,
        error: expect.stringMatching(/JPG, PNG, and WebP/),
      });
      expect(VotingMedia.validateFile(oversizedFile)).toEqual({
        valid: false,
        error: expect.stringMatching(/5MB/),
      });

      const validPng = new File(['valid png data'], 'test.png', { type: 'image/png' });
      expect(VotingMedia.validateFile(validPng)).toEqual({ valid: true, error: null });
    });

    test('Partial failure and capability retention: comment saved, failed attachment retried without duplicate comment', async () => {
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      const secretCap = 'CAP_RETAINED_ON_PARTIAL_FAILURE_123456789';
      let commentSubmitCalls = 0;
      let uploadSignCalls = 0;
      let uploadBinaryCalls = 0;

      const fetchMock = jest.fn(async (url, _opts = {}) => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/submit_comment')) {
          commentSubmitCalls++;
          return createOkResponse({
            id: 'comment-uuid-1',
            featureId: 'f-partial',
            comment: 'Comment with image',
            createdAt: new Date().toISOString(),
            ownerCapability: secretCap,
          });
        }
        if (target.includes('functions/v1/ytplus-image-upload')) {
          uploadSignCalls++;
          return createOkResponse({
            // Absolute signed URLs carry the legacy Supabase origin;
            // the client re-points them at the proxy before the PUT.
            signedUrl:
              'https://ldpccocxlrdsyejfhrvc.supabase.co/storage/v1/upload/sign/comment-images/slot-1.webp?token=signed',
            slotId: 'slot-1',
            storagePath: 'comment-images/slot-1.webp',
          });
        }
        if (target.includes('/storage/v1/upload/sign/')) {
          uploadBinaryCalls++;
          // First upload attempt fails (e.g. 500 network error)
          if (uploadBinaryCalls === 1) {
            return { ok: false, status: 500, text: async () => 'Upload failed' };
          }
          // Retry succeeds
          return { ok: true, status: 200, text: async () => '' };
        }
        if (target.includes('rpc/finalize_comment_image')) {
          return createOkResponse({ success: true });
        }
        return createOkResponse([]);
      });

      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      require('../src/voting.js');

      const container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);
      window.YouTubePlus.Voting.init(true);

      await window.YouTubePlus.Voting.openCommentsModal('f-partial', 'Feature Partial');

      // Draft an attachment manually into composer
      const dummyBlob = new Blob(['test-binary'], { type: 'image/webp' });
      window.YouTubePlus.Voting.VotingMedia.trackUrl = jest.fn(() => 'blob:mock-url');

      // Simulate a drafted file
      const draftObj = {
        draftId: '00000000-0000-4000-8000-000000000001',
        blob: dummyBlob,
        mimeType: 'image/webp',
        previewUrl: 'blob:mock-url',
        name: 'test.webp',
        size: dummyBlob.size,
      };

      // Add draft to current drafts
      window.YouTubePlus.Voting.addCommentDraft(draftObj);

      const input = document.getElementById('yp-comments-input');
      const submitBtn = document.getElementById('yp-comments-submit');
      input.value = 'Comment with image';

      // First submit: comment is created, attachment fails on binary upload
      submitBtn.click();
      await new Promise(r => setTimeout(r, 10));

      expect(commentSubmitCalls).toBe(1);
      // Now retry submission: should NOT call submit_comment again!
      submitBtn.click();
      await new Promise(r => setTimeout(r, 10));

      // Verified: submit_comment is called ONLY ONCE, preventing duplicate comment creation
      expect(commentSubmitCalls).toBe(1);
      expect(uploadSignCalls).toBeGreaterThan(0);
    });

    test('Capability privacy: ownerCapability is never stored in DOM or localStorage', async () => {
      window.YouTubePlusConfig = { communityWritesEnabled: true };
      const secretCap = 'SECRET_CAPABILITY_XYZ_123456789012345678901';

      const fetchMock = jest.fn(async url => {
        const target = String(url);

        // Community writes require the actor registration handshake —
        // answer the Edge call with a stable actor id.
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/submit_comment')) {
          return createOkResponse({
            id: 'c-secret',
            featureId: 'f-1',
            comment: 'Secret test comment',
            createdAt: new Date().toISOString(),
            ownerCapability: secretCap,
          });
        }
        return createOkResponse([]);
      });

      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
      });
      require('../src/voting.js');

      const container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);
      window.YouTubePlus.Voting.init(true);

      const panel = document.getElementById('yp-comments-panel');
      expect(panel).toBeTruthy();

      // Open comments modal for f-1
      await window.YouTubePlus.Voting.openCommentsModal('f-1', 'Feature 1');
      const input = document.getElementById('yp-comments-input');
      const submitBtn = document.getElementById('yp-comments-submit');

      input.value = 'Secret test comment';
      submitBtn.click();
      await Promise.resolve();
      await Promise.resolve();

      // Verify ownerCapability is NOT leaked to DOM or Storage
      expect(document.body.innerHTML).not.toContain(secretCap);
      expect(panel.innerHTML).not.toContain(secretCap);
      expect(JSON.stringify(window.localStorage)).not.toContain(secretCap);

      // Closing the modal wipes the session
      const closeBtn = document.getElementById('yp-comments-close');
      closeBtn.click();
      expect(panel.classList.contains('open')).toBe(false);
    });
  });

  describe('Feature Photo Attachments & Carousel', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
      jest.resetModules();
    });

    test('Add form renders photo button before title input in title row', () => {
      require('../src/voting.js');
      const container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);

      const titleRow = document.querySelector('.yp-feature-title-row');
      expect(titleRow).toBeTruthy();

      const addPhotoBtn = document.getElementById('yp-add-photo-btn');
      expect(addPhotoBtn).toBeTruthy();

      const titleInput = document.getElementById('yp-feature-title');
      expect(titleInput).toBeTruthy();

      // Ensure button is before input in the DOM hierarchy
      expect(titleRow.firstElementChild).toBe(addPhotoBtn);

      const previewWrap = document.getElementById('yp-photo-preview-wrap');
      expect(previewWrap).toBeTruthy();
      expect(previewWrap.style.display).toBe('none');
    });

    test('Attaching photos displays carousel and hides add photo button', () => {
      require('../src/voting.js');
      const container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);
      window.YouTubePlus.Voting.init(true);

      const addPhotoBtn = document.getElementById('yp-add-photo-btn');
      const previewWrap = document.getElementById('yp-photo-preview-wrap');

      // Add 1 photo
      window.YouTubePlus.Voting.addPhoto('data:image/png;base64,mock1');
      expect(previewWrap.style.display).toBe('flex');
      expect(addPhotoBtn.style.display).toBe('none');
      expect(window.YouTubePlus.Voting.getAttachedPhotos().length).toBe(1);

      // Single photo does NOT show prev/next buttons
      expect(document.getElementById('yp-photo-prev')).toBeFalsy();
      expect(document.getElementById('yp-photo-next')).toBeFalsy();

      // Add 2nd photo -> carousel mode
      window.YouTubePlus.Voting.addPhoto('data:image/png;base64,mock2');
      expect(window.YouTubePlus.Voting.getAttachedPhotos().length).toBe(2);

      const prevBtn = document.getElementById('yp-photo-prev');
      const nextBtn = document.getElementById('yp-photo-next');
      const indicator = document.querySelector('.yp-photo-indicator');

      expect(prevBtn).toBeTruthy();
      expect(nextBtn).toBeTruthy();
      expect(indicator.textContent).toContain('1 / 2');

      // Click next
      nextBtn.click();
      expect(document.querySelector('.yp-photo-indicator').textContent).toContain('2 / 2');

      // Click delete on active photo
      const deleteBtn = document.getElementById('yp-photo-delete');
      deleteBtn.click();

      // Now 1 photo remains
      expect(window.YouTubePlus.Voting.getAttachedPhotos().length).toBe(1);
      expect(document.getElementById('yp-photo-prev')).toBeFalsy();

      // Delete the remaining photo
      document.getElementById('yp-photo-delete').click();
      expect(window.YouTubePlus.Voting.getAttachedPhotos().length).toBe(0);
      expect(previewWrap.style.display).toBe('none');
      expect(addPhotoBtn.style.display).toBe('inline-flex');
    });

    test('Canceling add feature form resets attached photos and restores add button', () => {
      require('../src/voting.js');
      const container = document.createElement('div');
      document.body.appendChild(container);
      window.YouTubePlus.Voting.createUI(container);
      window.YouTubePlus.Voting.init(true);

      window.YouTubePlus.Voting.addPhoto('data:image/png;base64,mockTest');
      expect(window.YouTubePlus.Voting.getAttachedPhotos().length).toBe(1);

      const cancelBtn = document.getElementById('yp-cancel-feature');
      cancelBtn.click();

      expect(window.YouTubePlus.Voting.getAttachedPhotos().length).toBe(0);
      expect(document.getElementById('yp-photo-preview-wrap').style.display).toBe('none');
      expect(document.getElementById('yp-add-photo-btn').style.display).toBe('inline-flex');
    });
  });

  test('photo buttons and preview alt/aria use the dictionary', async () => {
    const translations = {
      addPhoto: 'Foto hinzufügen',
      deletePhoto: 'Foto löschen',
      votingPreviewBefore: 'Vorher',
      votingPreviewAfter: 'Nachher',
      beforeAfterComparison: 'Vorher-Nachher-Vergleich',
    };
    // Dictionary-backed t/hasTranslation, like the real i18n module provides.
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        ...window.YouTubeUtils,
        hasTranslation: key => key in translations,
        t: key => translations[key] || key,
      },
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn(async url => {
        const target = String(url);
        if (target.includes('functions/v1/ytplus-actor-register')) {
          return createOkResponse({ actorId: 'test-actor' });
        }
        if (target.includes('rpc/get_feature_requests')) return createListPage([]);
        if (target.includes('rpc/get_preview_feature')) {
          return createOkResponse([
            {
              id: 'preview-uuid-1',
              title: 'Live Preview Feature',
              description: '',
              feature_type: 'preview',
              status: 'in_progress',
            },
          ]);
        }
        if (target.includes('rpc/get_feature_images')) {
          return createOkResponse([
            {
              id: 'img-1',
              feature_id: 'preview-uuid-1',
              storage_path: 'before.webp',
              mime_type: 'image/webp',
              sort_order: 0,
            },
            {
              id: 'img-2',
              feature_id: 'preview-uuid-1',
              storage_path: 'after.webp',
              mime_type: 'image/webp',
              sort_order: 1,
            },
          ]);
        }
        return createOkResponse([]);
      }),
    });

    require('../src/voting.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    window.YouTubePlus.Voting.createUI(container);

    // Photo carousel buttons read titles from the dictionary.
    window.YouTubePlus.Voting.addPhoto('https://example.com/a.jpg');
    const wrap = document.getElementById('yp-photo-preview-wrap');
    expect(wrap.querySelector('#yp-photo-add-more').getAttribute('title')).toBe('Foto hinzufügen');
    expect(wrap.querySelector('#yp-photo-delete').getAttribute('title')).toBe('Foto löschen');

    // Preview before/after images: alt and the comparison slider from dictionary.
    await window.YouTubePlus.Voting.loadFeatures();
    const previewEl = document.getElementById('yp-voting-preview');
    expect(previewEl.querySelector('.yp-ba-before img')?.getAttribute('alt')).toBe('Vorher');
    expect(previewEl.querySelector('.yp-ba-after img')?.getAttribute('alt')).toBe('Nachher');
    expect(previewEl.querySelector('.yp-ba-divider')?.getAttribute('aria-label')).toBe(
      'Vorher-Nachher-Vergleich'
    );
  });
});

describe('Voting runtime on the FeatureLifecycle route contract', () => {
  /** @type {Array<{ target: EventTarget, type: string, handler: EventListener, opts: AddEventListenerOptions | boolean | undefined }>} */
  let registered = [];
  /** @type {Map<string, string>} */
  const styleRegistry = new Map();

  const setRoute = (/** @type {string} */ pathname) => {
    mockLocation({
      hostname: 'www.youtube.com',
      pathname,
      search: '',
      href: `https://www.youtube.com${pathname}`,
    });
  };

  const installGlobals = () => {
    if (!window.YouTubePlus) window.YouTubePlus = {};
    window.YouTubePlusConfig = { communityWritesEnabled: false };

    const cm = {
      listeners: new Map(),
      observers: new Set(),
      intervals: new Set(),
      sessionIntervals: new Set(),
      timeouts: new Set(),
      animationFrames: new Set(),
      registerListener: (
        /** @type {EventTarget} */ target,
        /** @type {string} */ type,
        /** @type {EventListener} */ handler,
        /** @type {AddEventListenerOptions | boolean | undefined} */ opts
      ) => {
        target?.addEventListener?.(type, handler, opts);
        const entry = { target, type, handler, opts };
        registered.push(entry);
        const key = Symbol('listener-key');
        cm.listeners.set(key, entry);
        return key;
      },
      unregisterListener: (/** @type {symbol} */ key) => {
        const entry = cm.listeners.get(key);
        if (!entry) return;
        entry.target?.removeEventListener?.(entry.type, entry.handler, entry.opts);
        cm.listeners.delete(key);
        const index = registered.indexOf(entry);
        if (index >= 0) registered.splice(index, 1);
      },
      registerObserver: (/** @type {unknown} */ observer) => observer,
      unregisterObserver: jest.fn(),
      registerInterval: (/** @type {number} */ id) => {
        cm.intervals.add(id);
        return id;
      },
      unregisterInterval: (/** @type {number} */ id) => cm.intervals.delete(id),
      registerAnimationFrame: (/** @type {number} */ id) => {
        cm.animationFrames.add(id);
        return id;
      },
      unregisterAnimationFrame: (/** @type {number} */ id) => cm.animationFrames.delete(id),
      disconnectForElement: jest.fn(),
      getListenerStats: () => ({ active: cm.listeners.size }),
      cleanup: jest.fn(),
    };
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: cm,
    });

    const styleManager = {
      styles: styleRegistry,
      add: (/** @type {string} */ id, /** @type {string} */ css) => styleRegistry.set(id, css),
      remove: (/** @type {string} */ id) => styleRegistry.delete(id),
      has: (/** @type {string} */ id) => styleRegistry.has(id),
      get: (/** @type {string} */ id) => styleRegistry.get(id),
      clear: () => styleRegistry.clear(),
    };

    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: {
        getStyle: (/** @type {string} */ id) =>
          id === 'yp-comments-modal-style' ? '.yp-comments-panel{color:red}' : '',
        StyleManager: styleManager,
        getThemeVariant: () => 'classic',
      },
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        setSafeHTML: (/** @type {Element} */ el, /** @type {string} */ html) => {
          if (el) el.innerHTML = html;
        },
        byId: (/** @type {string} */ id) => document.getElementById(id),
        $: (/** @type {string} */ selector, /** @type {Document | Element} */ root) =>
          (root || document).querySelector(selector),
        t: (/** @type {string} */ key) => key,
        createHTML: (/** @type {string} */ s) => s,
        helpers: {
          byId: (/** @type {string} */ id) => document.getElementById(id),
          $: (/** @type {string} */ selector, /** @type {Document | Element} */ root) =>
            (root || document).querySelector(selector),
          $$: (/** @type {string} */ sel) => Array.from(document.querySelectorAll(sel)),
          t: (/** @type {string} */ key) => key,
          logger: null,
          createHTML: (/** @type {string} */ s) => s,
          debounce: (/** @type {Function} */ fn) => fn,
          setTimeout_: (/** @type {Function} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms),
        },
        cleanupManager: cm,
        StyleManager: styleManager,
        isSettingsModalOpen: jest.fn(() => false),
        getRoute: () => {
          const p = window.location.pathname || '/';
          if (p === '/watch') return 'watch';
          if (p.startsWith('/shorts')) return 'shorts';
          if (p === '/') return 'home';
          if (p === '/results') return 'search';
          if (p.startsWith('/@') || p.startsWith('/channel/')) return 'channel';
          return 'other';
        },
        logSuppressed: jest.fn(),
        onSectionActive: jest.fn(() => ({ dispose: jest.fn() })),
        safeRequestAnimationFrame: jest.fn(cb => requestAnimationFrame(cb)),
      },
    });

    Object.defineProperty(window, 'YouTubeSafeDOM', {
      configurable: true,
      writable: true,
      value: {
        escapeHTML: (/** @type {string} */ text) => text,
        renderTemplateClone: (/** @type {Element} */ container, /** @type {string} */ html) => {
          if (!container || container.nodeType !== 1) return;
          const tpl = document.createElement('template');
          tpl.innerHTML = String(html ?? '');
          container.replaceChildren(tpl.content.cloneNode(true));
        },
        createTrustedHTML: (/** @type {string} */ s) => s,
        createFragment: (/** @type {string} */ html) => {
          const tpl = document.createElement('template');
          tpl.innerHTML = String(html ?? '');
          return tpl.content;
        },
      },
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
      })),
    });

    delete window.YouTubePlusFeatureRegistry;
    require('../src/feature-registry.js');
  };

  const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;
  const styleHas = () => window.YouTubePlusDesignSystem.StyleManager.has('yp-comments-modal-style');
  const docDelegates = () =>
    registered.filter(l => l.target === document && (l.type === 'click' || l.type === 'change'))
      .length;
  const orphanedListeners = () =>
    registered.filter(
      l => l.target && typeof l.target.nodeType === 'number' && !l.target.isConnected
    ).length;

  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    registered = [];
    styleRegistry.clear();
    setRoute('/watch');
    installGlobals();
  });

  afterEach(() => {
    for (const { target, type, handler, opts } of registered) {
      target?.removeEventListener?.(type, handler, opts);
    }
    registered = [];
    lifecycle()?._reset?.();
    delete window.YouTubePlusFeatureRegistry;
    delete window.YouTubePlusDesignSystem;
  });

  test('off-route the runtime never starts', () => {
    setRoute('/results');
    require('../src/voting.js');

    expect(lifecycle().isRunning('voting.runtime')).toBe(false);
    expect(document.getElementById('yp-comments-panel')).toBeNull();
    expect(document.getElementById('yp-gallery-modal')).toBeNull();
    expect(styleHas()).toBe(false);
  });

  test('on-route the runtime starts and owns its surface', () => {
    require('../src/voting.js');

    expect(lifecycle().isRunning('voting.runtime')).toBe(true);
    expect(document.getElementById('yp-comments-panel')).not.toBeNull();
    expect(document.getElementById('yp-gallery-modal')).not.toBeNull();
    expect(styleHas()).toBe(false);
    expect(docDelegates()).toBeGreaterThan(0);
  });

  test('leaving the route releases the runtime DOM and listeners', () => {
    require('../src/voting.js');
    expect(document.getElementById('yp-comments-panel')).not.toBeNull();

    setRoute('/results');
    window.dispatchEvent(new Event('yp-history-navigate'));

    expect(lifecycle().isRunning('voting.runtime')).toBe(false);
    expect(document.getElementById('yp-comments-panel')).toBeNull();
    expect(document.getElementById('yp-gallery-modal')).toBeNull();
    // The comments style is injected when the comments panel opens, so a page
    // that never opens it never pays for its rules.
    expect(styleHas()).toBe(false);
    expect(docDelegates()).toBe(0);
    expect(orphanedListeners()).toBe(0);
  });

  test('re-entering the route starts the runtime again', () => {
    require('../src/voting.js');
    setRoute('/results');
    window.dispatchEvent(new Event('yp-history-navigate'));
    expect(document.getElementById('yp-comments-panel')).toBeNull();

    setRoute('/watch');
    window.dispatchEvent(new Event('yp-history-navigate'));

    expect(lifecycle().isRunning('voting.runtime')).toBe(true);
    expect(document.getElementById('yp-comments-panel')).not.toBeNull();
    expect(styleHas()).toBe(false);
    expect(docDelegates()).toBeGreaterThan(0);
  });

  test('opening the comments panel without the stylesheet bundle is tolerated', async () => {
    require('../src/voting.js');
    window.YouTubePlusDesignSystem.getStyle = () => '';
    await window.YouTubePlus.Voting.openCommentsModal('f-styleless', 'Feature Styleless');
    expect(document.getElementById('yp-comments-panel')).not.toBeNull();
    expect(styleHas()).toBe(false);
  });

  test('the runtime stays off while the settings modal is open', () => {
    window.YouTubeUtils.isSettingsModalOpen.mockReturnValue(true);
    require('../src/voting.js');
    expect(lifecycle().isRunning('voting.runtime')).toBe(false);
    expect(document.getElementById('yp-comments-panel')).toBeNull();

    window.YouTubeUtils.isSettingsModalOpen.mockReturnValue(false);
    window.dispatchEvent(new Event('yp-history-navigate'));
    expect(lifecycle().isRunning('voting.runtime')).toBe(true);
    expect(document.getElementById('yp-comments-panel')).not.toBeNull();
  });
});
