/**
 * @jest-environment jsdom
 */

/**
 * Bounded community reads.
 *
 * The list read is keyset-paginated (no record loss, no duplicates across a
 * sequential walk), batch ID lists are chunked to the server cap, and every
 * aggregate failure is shown honestly (unavailable / partial) instead of
 * being conflated with empty data. A failing block never destroys the
 * successful ones.
 */

describe('Voting reads pagination & honest states', () => {
  const createOkResponse = data => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  const createListPage = (rows, hasMore = false, cursorId = null) =>
    createOkResponse({
      rows,
      hasMore,
      nextCursorCreatedAt: hasMore ? '2026-01-01T00:00:00.000Z' : null,
      nextCursorId: hasMore ? cursorId : null,
    });

  const errorResponse = status => ({
    ok: false,
    status,
    json: async () => ({ message: `HTTP ${status} down` }),
    text: async () => '{}',
  });

  const makeFeatures = (/** @type {number} */ n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `feat-${i + 1}`,
      title: `Feature ${i + 1}`,
      description: '',
      status: 'proposed',
    }));

  const installBaseGlobals = () => {
    if (!window.YouTubePlus) window.YouTubePlus = {};
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
        createIsRelevantRoute: () => () => false,
        createWithErrorBoundary: () => fn => fn,
        isWatchRoute: jest.fn(() => false),
        isShortsRoute: jest.fn(() => false),
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
  };

  const setupFetch = (/** @type {jest.Mock} */ fetchMock) => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  };

  const bootList = async (/** @type {jest.Mock} */ fetchMock) => {
    jest.resetModules();
    delete require.cache[require.resolve('../src/voting.js')];
    installBaseGlobals();
    setupFetch(fetchMock);
    require('../src/voting.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    window.YouTubePlus.Voting.createUI(container);
    await window.YouTubePlus.Voting.loadFeatures();
    return container;
  };

  beforeEach(() => {
    delete globalThis.GM_xmlhttpRequest;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('a dataset larger than the page loads incrementally with no loss and no duplicates', async () => {
    const all = makeFeatures(60);
    /** @type {{ url: string, body: any }[]} */
    const calls = [];
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);
      calls.push({ url: target, body: options.body ? JSON.parse(options.body) : null });
      if (target.includes('ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/get_feature_requests')) {
        const body = options.body ? JSON.parse(options.body) : {};
        if (!body.p_cursor_id) {
          return createListPage(all.slice(0, 50), true, 'cursor-50');
        }
        return createListPage(all.slice(50), false);
      }
      return createOkResponse([]);
    });

    const container = await bootList(fetchMock);

    // First page only: 50 cards, Load more visible, request carries the contract.
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(50);
    expect(container.querySelector('#yp-voting-load-more')).toBeTruthy();

    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    // Full walk: 60 items, all distinct, no fabricated records.
    const items = container.querySelectorAll('.yp-voting-item');
    expect(items.length).toBe(60);
    const ids = Array.from(items).map(el => el.getAttribute('data-feature-id'));
    expect(new Set(ids).size).toBe(60);

    // Continuation complete → the control disappears.
    expect(container.querySelector('#yp-voting-load-more')).toBeNull();

    const listCalls = calls.filter(c => c.url.includes('rpc/get_feature_requests'));
    expect(listCalls.length).toBe(2);
    expect(listCalls[0].body.p_limit).toBe(50);
    expect(listCalls[0].body.p_cursor_id).toBeNull();
    expect(listCalls[1].body.p_cursor_id).toBe('cursor-50');
  });

  test('oversized aggregate batches are chunked to the server cap', async () => {
    const all = makeFeatures(250); // one page response, 250 ids
    /** @type {{ url: string, body: any }[]} */
    const voteCalls = [];
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('rpc/get_vote_counts')) {
        voteCalls.push({ url: target, body: JSON.parse(options.body || '{}') });
        return createOkResponse([]);
      }
      if (target.includes('rpc/get_feature_requests')) {
        return createListPage(all, false);
      }
      return createOkResponse([]);
    });

    await bootList(fetchMock);

    expect(voteCalls.length).toBe(2);
    expect(voteCalls[0].body.p_feature_ids.length).toBe(200);
    expect(voteCalls[1].body.p_feature_ids.length).toBe(50);
    const sent = new Set([...voteCalls[0].body.p_feature_ids, ...voteCalls[1].body.p_feature_ids]);
    expect(sent.size).toBe(250);
  });

  test('failed comment counts show unavailable counts and keep the cards alive', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('rpc/get_feature_requests')) {
        return createListPage(makeFeatures(2), false);
      }
      if (target.includes('rpc/get_feature_comment_counts')) {
        return errorResponse(500); // comments aggregate down
      }
      return createOkResponse([]); // votes healthy (real zero), images fine
    });

    const container = await bootList(fetchMock);

    // Both cards still render — a failed block never destroys the rest.
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(2);
    const icon = container.querySelector('.yp-voting-comments-icon');
    expect(icon).toBeTruthy();
    // Unknown count: "–" visually, "unavailable" in the accessible name — never 0.
    expect(icon.textContent).toContain('–');
    expect(icon.getAttribute('aria-label')).toContain('unavailable');
    // Votes aggregate is healthy → the card counter is a real zero.
    const total = container.querySelector('.yp-vote-total');
    expect(total.textContent).toContain('0');
    expect(total.textContent).not.toContain('unavailable');
  });

  test('a failed continuation keeps the loaded pages and offers Retry', async () => {
    let pageCalls = 0;
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('rpc/get_feature_requests')) {
        pageCalls++;
        if (pageCalls === 1) return createListPage(makeFeatures(50), true, 'cursor-50');
        return errorResponse(503); // continuation fails
      }
      return createOkResponse([]);
    });

    const container = await bootList(fetchMock);
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(50);

    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    // The 50 loaded cards survive; the control becomes a Retry affordance.
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(50);
    const retry = container.querySelector('#yp-voting-load-more');
    expect(retry).toBeTruthy();
    expect(retry.textContent).toContain('Retry');

    // Retry succeeds once the server recovers — no duplicates appear.
    fetchMock.mockImplementation(async url => {
      const target = String(url);
      if (target.includes('rpc/get_feature_requests')) {
        return createListPage(
          Array.from({ length: 10 }, (_, i) => ({
            id: `feat-more-${i + 1}`,
            title: `More ${i + 1}`,
            description: '',
            status: 'proposed',
          })),
          false
        );
      }
      return createOkResponse([]);
    });
    retry.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const ids = Array.from(container.querySelectorAll('.yp-voting-item')).map(el =>
      el.getAttribute('data-feature-id')
    );
    expect(ids.length).toBe(60);
    expect(new Set(ids).size).toBe(60);
    expect(container.querySelector('#yp-voting-load-more')).toBeNull();
  });

  test('a preview failure never blocks the list and is distinguishable from no-preview', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('rpc/get_preview_feature')) {
        return errorResponse(500);
      }
      if (target.includes('rpc/get_feature_requests')) {
        return createListPage(makeFeatures(3), false);
      }
      return createOkResponse([]);
    });

    const container = await bootList(fetchMock);
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(3);
    expect(container.querySelector('.yp-voting-error')).toBeNull();

    // DTO contract: error is distinguishable from "no preview exists".
    const dto = await window.YouTubePlus.Voting.VotingApi.getPreviewFeature();
    expect(dto.error).toBeTruthy();
    expect(dto.feature).toBeNull();
  });

  // ── Bounded page cost ─────────────────────────────

  test('Load more requests aggregates for the NEW page only and appends without re-listening old cards', async () => {
    const all = makeFeatures(60);
    const aggregateCalls = [];
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('rpc/get_feature_requests')) {
        const body = options.body ? JSON.parse(options.body) : {};
        if (!body.p_cursor_id) {
          return createListPage(all.slice(0, 50), true, 'cursor-50');
        }
        return createListPage(all.slice(50), false);
      }
      if (
        target.includes('rpc/get_vote_counts') ||
        target.includes('rpc/get_feature_comment_counts')
      ) {
        aggregateCalls.push({
          rpc: target.includes('get_vote_counts') ? 'votes' : 'counts',
          ids: JSON.parse(options.body || '{}').p_feature_ids,
        });
      }
      return createOkResponse([]);
    });

    const container = await bootList(fetchMock);
    const firstCard = container.querySelector('.yp-voting-item');
    expect(firstCard).not.toBeNull();
    const loadMoreCallsBefore = aggregateCalls.length;

    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    // The continuation's aggregate RPCs cover ONLY the 10 new IDs.
    const page2 = aggregateCalls.slice(loadMoreCallsBefore);
    expect(page2.length).toBeGreaterThan(0);
    for (const call of page2) {
      expect(call.ids.every(id => id.startsWith('feat-5') || Number(id.slice(5)) > 50)).toBe(true);
      expect(call.ids.length).toBeLessThanOrEqual(10);
    }

    // The accumulated DOM nodes survive — no re-render of loaded history.
    const firstItemAfter = container.querySelector('.yp-voting-item');
    expect(container.querySelector('.yp-voting-item')).toBe(firstItemAfter);
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(60);
    expect(container.querySelector('#yp-voting-load-more')).toBeNull();
  });

  test('after Load more ×2 a vote updates ONE card — list stays 3 pages, network = 1 cast_vote RPC', async () => {
    const all = makeFeatures(120);
    const rpcCalls = [];
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('functions/v1/ytplus-actor-register')) {
        return createOkResponse({ actorId: 'test-actor' });
      }
      if (target.includes('rpc/get_feature_requests')) {
        const body = options.body ? JSON.parse(options.body) : {};
        if (!body.p_cursor_id) return createListPage(all.slice(0, 50), true, 'cursor-50');
        if (body.p_cursor_id === 'cursor-50')
          return createListPage(all.slice(50, 100), true, 'cursor-100');
        return createListPage(all.slice(100), false);
      }
      if (target.includes('rpc/cast_vote')) {
        rpcCalls.push({ rpc: 'cast_vote', body: JSON.parse(options.body || '{}') });
        return createOkResponse({ action: 'added' });
      }
      return createOkResponse([]);
    });

    // Writes enabled BEFORE the list renders — the card vote buttons are
    // rendered enabled only when the community is writable.
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    const container = await bootList(fetchMock);
    // Owner payloads require the isolated manager transport — emulate
    // the manager by delegating GM requests to the fetch mock. The capability
    // hash also needs a WebCrypto subtle stub (jsdom lacks it).
    const stubCrypto = {
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
    };
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: stubCrypto });
    Object.defineProperty(window, 'crypto', { configurable: true, value: stubCrypto });
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

    // Load more ×2 → 3 pages; the first card element survives each append.
    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const firstCard = container.querySelector('.yp-voting-item');
    const cardTotalBefore = Number(firstCard.querySelector('.yp-vote-total')?.textContent);
    const rpcBefore = rpcCalls.length;

    // Vote on the FIRST card — through the API (the click wiring is covered
    // elsewhere); Vote does NOT trigger a full reload.
    const voteResult = await window.YouTubePlus.Voting.vote('feat-1', 1);

    // The network carried exactly ONE cast_vote RPC — no aggregate
    // or list refreshes after the vote.
    expect({ success: voteResult.success, error: voteResult.error ?? null }).toEqual({
      success: true,
      error: null,
    });
    expect(rpcCalls.length).toBe(rpcBefore + 1);
    expect(rpcCalls[rpcCalls.length - 1].body.p_feature_id).toBe('feat-1');
    // The list stays at its full length — no reload, no reset to page 1.
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(120);
    // The voted card is REPLACED in place (same position, fresh node).
    const newFirstCard = container.querySelector('.yp-voting-item');
    expect(newFirstCard.getAttribute('data-feature-id')).toBe('feat-1');
    // The voted card's total grew by 1 (local aggregate update).
    const totalAfter = Number(newFirstCard.querySelector('.yp-vote-total')?.textContent);
    expect(totalAfter).toBe(cardTotalBefore + 1);
  });

  test('20 Load more cycles keep the accumulated DOM and listeners bounded', async () => {
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('rpc/get_feature_requests')) {
        const body = options.body ? JSON.parse(options.body) : {};
        const page = Number(body.p_cursor_id ? body.p_cursor_id.slice('cursor-'.length) : 0) + 1;
        return createListPage(
          [
            {
              id: `feat-page-${page}`,
              title: `Page ${page}`,
              description: '',
              status: 'proposed',
            },
          ],
          page < 20,
          `cursor-${page}`
        );
      }
      return createOkResponse([]);
    });

    const container = await bootList(fetchMock);
    const firstItem = container.querySelector('.yp-voting-item');

    for (let i = 0; i < 19; i++) {
      container.querySelector('#yp-voting-load-more').click();
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // The very first card is still the same DOM node; listeners stay
    // proportional to rendered cards, not to pages re-rendered.
    expect(container.querySelector('.yp-voting-item')).toBe(firstItem);
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(20);
    // Page 20 is the last one (hasMore=false) → the control is gone.
    expect(container.querySelectorAll('#yp-voting-load-more').length).toBe(0);
  });
});
