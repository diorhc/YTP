/**
 * @jest-environment jsdom
 */

// V4 FINAL PRODUCTION E2E REGRESSION TESTS
//
// Reproduces the production failures observed in the real browser E2E:
//   ONE submit click produced TWO submit_feature RPCs (duplicate card).
//   Vote clicks produced ZERO cast_vote RPCs (no server-side trace).
//
// These tests drive the REAL click paths (delegated document handler +
// per-render direct listeners) exactly as the production settings page does.

describe('V4 production stabilization', () => {
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
  const flushed = async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  };

  const installGlobals = () => {
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        setSafeHTML: (el, html) => {
          if (el) el.innerHTML = html;
        },
        byId: id => document.getElementById(id),
        $: (selector, root) => (root || document).querySelector(selector),
        t: key => key,
        cleanupManager: {
          registerListener: (target, type, handler, opts) => {
            target?.addEventListener?.(type, handler, opts);
            registeredListeners.push({ target, type, handler, opts });
            return Symbol('listener-key');
          },
        },
        isSettingsModalOpen: jest.fn(() => false),
        logSuppressed: jest.fn(),
        whenRelevant: jest.fn(() => ({ check: jest.fn(), dispose: jest.fn() })),
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
          registeredListeners.push({ target, type, handler, opts });
          return Symbol('listener-key');
        },
        registerAnimationFrame: id => id,
        registerTimeout: id => id,
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
  };

  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    if (!window.YouTubePlus) window.YouTubePlus = {};
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    registeredListeners = [];

    // The actor handshake needs WebCrypto subtle, which jsdom
    // does not provide — stub a deterministic digest for the capability hash.
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: arr => {
          for (let i = 0; i < arr.length; i++) arr[i] = (i * 7919 + 13) % 256;
          return arr;
        },
        subtle: {
          digest: async (_algorithm, data) => {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
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

    installGlobals();
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
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCaf;
  });

  // ---- Duplicate feature submission ---------------------------------

  test('ONE submit click issues EXACTLY ONE submit_feature RPC (dual-path regression)', async () => {
    let submitFeatureCalls = 0;
    const fetchMock = jest.fn(async (url, _opts = {}) => {
      const target = String(url);

      // Actor registration handshake precedes every community write.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/submit_feature')) {
        submitFeatureCalls += 1;
        return createOkResponse({
          id: 'f-' + submitFeatureCalls,
          title: 'Test',
          description: 'test new features',
          status: 'proposed',
          featureType: 'request',
          createdAt: new Date().toISOString(),
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

    const title = document.getElementById('yp-feature-title');
    const desc = document.getElementById('yp-feature-desc');
    title.value = 'Test';
    desc.value = 'test new features';

    // ONE user action: single click on the submit button
    const submitBtn = document.getElementById('yp-submit-feature');
    expect(submitBtn).toBeTruthy();
    submitBtn.click();
    await flushed();
    await new Promise(r => setTimeout(r, 5));

    expect(submitFeatureCalls).toBe(1);
  });

  test('rapid double click while first submit is pending still yields EXACTLY ONE submit_feature RPC', async () => {
    let submitFeatureCalls = 0;
    let resolveSubmit;
    const submitPromise = new Promise(resolve => {
      resolveSubmit = resolve;
    });
    const fetchMock = jest.fn(async (url, _opts = {}) => {
      const target = String(url);

      // Actor registration handshake precedes every community write.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/submit_feature')) {
        submitFeatureCalls += 1;
        return new Promise(resolve =>
          setTimeout(() => {
            resolve(createOkResponse({ id: 'f-' + submitFeatureCalls, featureType: 'request' }));
            resolveSubmit();
          }, 10)
        );
      }
      if (target.includes('rpc/get_feature_requests')) return createListPage([]);
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

    document.getElementById('yp-feature-title').value = 'Test';
    document.getElementById('yp-feature-desc').value = 'test new features';

    const submitBtn = document.getElementById('yp-submit-feature');
    submitBtn.click();
    submitBtn.click();
    await new Promise(r => setTimeout(r, 20));
    await submitPromise;
    await flushed();

    expect(submitFeatureCalls).toBe(1);
  });

  test('repeated createUI + init does not duplicate feature-submit listeners', async () => {
    let submitFeatureCalls = 0;
    const fetchMock = jest.fn(async url => {
      const target = String(url);

      // Actor registration handshake precedes every community write.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/submit_feature')) {
        submitFeatureCalls += 1;
        return createOkResponse({ id: 'f-1', featureType: 'request' });
      }
      return createOkResponse([]);
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    require('../src/voting.js');

    // Simulate repeated settings-tab activations: the SAME container is
    // re-rendered in place (production behavior — createUI replaces content).
    const container = document.createElement('div');
    document.body.appendChild(container);
    for (let i = 0; i < 3; i += 1) {
      window.YouTubePlus.Voting.createUI(container);
      window.YouTubePlus.Voting.init(true);
    }

    document.getElementById('yp-feature-title').value = 'Test';
    document.getElementById('yp-feature-desc').value = 'test new features';
    document.getElementById('yp-submit-feature').click();
    await flushed();

    expect(submitFeatureCalls).toBe(1);
  });

  // ---- Voting --------------------------------------------------------

  const setupVoteScenario = async ({ myVotes = [] } = {}) => {
    const castVoteCalls = [];
    const fetchMock = jest.fn(async (url, opts = {}) => {
      const target = String(url);

      // Actor registration handshake precedes every community write.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/cast_vote')) {
        castVoteCalls.push(JSON.parse(opts.body || '{}'));
        return createOkResponse({ action: 'added' });
      }
      if (target.includes('rpc/get_preview_feature')) {
        return createOkResponse([
          {
            id: PREVIEW_ID,
            title: 'Preview',
            description: '',
            status: 'proposed',
            feature_type: 'preview',
          },
        ]);
      }
      if (target.includes('rpc/get_feature_requests')) {
        return createListPage([
          {
            id: FEATURE_ID,
            title: 'Test',
            description: 'test new features',
            status: 'proposed',
            feature_type: 'request',
          },
        ]);
      }
      if (target.includes('rpc/get_vote_counts')) {
        return createOkResponse([{ feature_id: FEATURE_ID, upvotes: 1, downvotes: 0 }]);
      }
      if (target.includes('rpc/get_my_votes')) {
        return createOkResponse(myVotes);
      }
      return createOkResponse([]);
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    require('../src/voting.js');
    return { castVoteCalls, fetchMock };
  };

  const FEATURE_ID = '20997c02-f912-468c-95ca-388ca23bd935';
  const PREVIEW_ID = 'd096166d-450e-461d-834f-cb2e87858612';

  test('ONE vote click on a feature card causes EXACTLY ONE cast_vote RPC with the canonical body', async () => {
    const { castVoteCalls } = await setupVoteScenario({ myVotes: [] });

    const container = document.createElement('div');
    document.body.appendChild(container);
    window.YouTubePlus.Voting.createUI(container);
    window.YouTubePlus.Voting.init(true);
    await window.YouTubePlus.Voting.loadFeatures();
    await flushed();

    const voteBtn = container.querySelector('.yp-voting-item .yp-vote-btn[data-vote="1"]');
    expect(voteBtn).toBeTruthy();
    voteBtn.click();
    await flushed();
    await new Promise(r => setTimeout(r, 5));

    expect(castVoteCalls.length).toBe(1);
    // The third parameter is the OWNER SECRET (proof of
    // possession, verified server-side) — no caller-supplied owner field.
    expect(castVoteCalls[0]).toEqual({
      p_feature_id: FEATURE_ID,
      p_vote_type: 1,
      p_secret: expect.any(String),
    });
    expect(castVoteCalls[0].p_secret).not.toMatch(/^__/);
  });

  test('cast_vote action added/updated/removed handled — one card update in place, NO full reload', async () => {
    // prior vote state: the user already voted +1, so the click toggles to
    // removal (vote_type 0) — the 'removed' action path.
    const { castVoteCalls, fetchMock } = await setupVoteScenario({
      myVotes: [{ feature_id: FEATURE_ID, vote_type: 1 }],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    window.YouTubePlus.Voting.createUI(container);
    window.YouTubePlus.Voting.init(true);

    const listReads = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('rpc/get_feature_requests'))
        .length;

    const res1 = await window.YouTubePlus.Voting.vote(FEATURE_ID, 1);
    expect(res1.success).toBe(true);
    await flushed();

    expect(castVoteCalls.length).toBe(1);
    expect(castVoteCalls[0].p_vote_type).toBe(1);
    // A successful vote NO LONGER triggers the full-list reload —
    // the affected card + the vote bar update in place instead.
    expect(listReads()).toBe(0);

    // toggle path: the second intended action sends the removal vote_type 0,
    // which the server handles as action='removed' — still one cast_vote per
    // intended action.
    const res2 = await window.YouTubePlus.Voting.vote(FEATURE_ID, 0);
    expect(res2.success).toBe(true);
    expect(castVoteCalls.length).toBe(2);
    expect(castVoteCalls[1].p_vote_type).toBe(0);
  });

  test('get_my_votes maps returned rows into rendered user vote state', async () => {
    const myVotesRows = [{ feature_id: FEATURE_ID, vote_type: 1 }];
    const fetchMock = jest.fn(async url => {
      const target = String(url);

      // Actor registration handshake precedes every community write.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/get_my_votes')) return createOkResponse(myVotesRows);
      if (target.includes('rpc/get_preview_feature')) return createOkResponse([]);
      if (target.includes('rpc/get_feature_requests')) {
        return createListPage([
          {
            id: FEATURE_ID,
            title: 'Feature',
            description: '',
            status: 'proposed',
            feature_type: 'request',
          },
        ]);
      }
      if (target.includes('rpc/get_vote_counts')) {
        return createOkResponse([{ feature_id: FEATURE_ID, upvotes: 3, downvotes: 0 }]);
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
    await flushed();

    const item = container.querySelector('.yp-voting-item');
    expect(item?.getAttribute('data-feature-id')).toBe(FEATURE_ID);
    const upBtn = item?.querySelector('.yp-vote-btn[data-vote="1"]');
    expect(upBtn?.classList.contains('active')).toBe(true);
    const downBtn = item?.querySelector('.yp-vote-btn[data-vote="-1"]');
    expect(downBtn?.classList.contains('active')).toBe(false);
  });

  test('normal list excludes preview; preview rendered separately', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);

      // Actor registration handshake precedes every community write.
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/get_preview_feature')) {
        return createOkResponse([
          {
            id: PREVIEW_ID,
            title: 'Preview Title',
            description: 'Preview Desc',
            status: 'proposed',
            feature_type: 'preview',
          },
        ]);
      }
      if (target.includes('rpc/get_feature_requests')) {
        return createListPage([
          {
            id: FEATURE_ID,
            title: 'Normal Feature',
            description: '',
            status: 'proposed',
            feature_type: 'request',
          },
          {
            id: PREVIEW_ID,
            title: 'Should Not Appear',
            status: 'proposed',
            feature_type: 'preview',
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
    await flushed();

    const listHtml = container.querySelector('#yp-voting-list')?.innerHTML || '';
    expect(listHtml).toContain('Normal Feature');
    expect(listHtml).not.toContain('Should Not Appear');
    expect(listHtml).not.toContain('Preview Title');
  });
});
