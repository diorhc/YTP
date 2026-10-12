/**
 * @jest-environment jsdom
 */

/**
 * Feature list state, aggregate honesty and vote transitions.
 *
 * A failed aggregate never fabricates zeros: partial data renders a "N+"
 * total and unavailable counts render as unknown. Votes update exactly one
 * card from the local aggregate, honour the server's action, refuse to overlap
 * and keep working when the list is stale, partial or paged.
 */

describe('Voting feature list state branches', () => {
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
    json: async () => ({ message: `HTTP ${status}` }),
  });

  let registeredListeners = [];

  const installGlobals = (utilsOverrides = {}) => {
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
        cleanupManager: {
          registerListener: (target, type, handler, opts) => {
            target?.addEventListener?.(type, handler, opts);
            registeredListeners.push({ target, type, handler, opts });
            return Symbol('listener');
          },
          unregisterListener: jest.fn(),
        },
        logSuppressed: jest.fn(),
        onSectionActive: jest.fn(),
        isSettingsModalOpen: jest.fn(() => false),
        safeRequestAnimationFrame: jest.fn(cb => cb(0)),
        ...utilsOverrides,
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

  const delegatedGm = () => {
    Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
      configurable: true,
      writable: true,
      value: options => {
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
      },
    });
  };

  const boot = () => {
    jest.resetModules();
    require('../src/voting.js');
    return window.YouTubePlusVoting;
  };

  const rpcBodies = (mock, name) =>
    mock.mock.calls
      .map(([url, options]) => ({
        url: String(url),
        body: options?.body ? JSON.parse(options.body) : null,
      }))
      .filter(call => call.url.includes(name))
      .map(call => call.body);

  const makeFeatures = count =>
    Array.from({ length: count }, (_, i) => ({
      id: `feat-${i + 1}`,
      title: `Feature ${i + 1}`,
      description: '',
      status: 'proposed',
    }));

  /**
   * Boot the panel with a list of features and the given aggregate behaviour.
   * @param {jest.Mock} fetchMock
   */
  const bootList = async fetchMock => {
    setFetch(fetchMock);
    const voting = boot();
    const container = document.createElement('div');
    document.body.appendChild(container);
    voting.createUI(container);
    await voting.loadFeatures();
    return { voting, container };
  };

  const healthyAggregates = (rows, { counts = 'ok', votes = 'ok' } = {}) =>
    jest.fn(async (url, options) => {
      const target = String(url);
      if (target.includes('get_feature_requests')) return createListPage(rows);
      if (target.includes('get_vote_counts')) {
        if (votes === 'error') return errorResponse(500);
        const ids = JSON.parse(options.body || '{}').p_feature_ids || [];
        return createOkResponse(ids.map(id => ({ feature_id: id, upvotes: 2, downvotes: 1 })));
      }
      if (target.includes('get_feature_comment_counts')) {
        if (counts === 'error') return errorResponse(500);
        const ids = JSON.parse(options.body || '{}').p_feature_ids || [];
        return createOkResponse(ids.map(id => ({ feature_id: id, comment_count: 1 })));
      }
      return createOkResponse([]);
    });

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    setFetch(jest.fn(async () => createOkResponse([])));
    delegatedGm();
    if (!window.YouTubePlus) window.YouTubePlus = {};
    mockLocation({ href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', pathname: '/watch' });
    installGlobals();
  });

  afterEach(() => {
    for (const { target, type, handler, opts } of registeredListeners) {
      try {
        target?.removeEventListener?.(type, handler, opts);
      } catch (_e) {
        // detached nodes can refuse removal; the entry is dropped anyway
      }
    }
    registeredListeners = [];
  });

  test('a bare array list page is malformed, never an empty valid page', async () => {
    const fetchMock = jest.fn(async url =>
      String(url).includes('get_feature_requests')
        ? createOkResponse([{ id: 'f-1', title: 'One' }])
        : createOkResponse([])
    );
    setFetch(fetchMock);
    const voting = boot();

    const res = await voting.VotingApi.getFeatureRequests();

    expect(res).toEqual({
      rows: [],
      error: 'Malformed list response',
      hasMore: false,
      nextCursor: null,
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('get_feature_requests'))).toBe(
      true
    );
  });

  test('a partial aggregate shows a partial total and unavailable comment counts', async () => {
    const rows = makeFeatures(250);
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('get_feature_requests')) return createListPage(rows);
      if (target.includes('get_preview_feature')) {
        return createOkResponse([{ id: 'p-1', title: 'Preview', feature_type: 'preview' }]);
      }
      if (target.includes('get_vote_counts')) {
        const ids = JSON.parse(options.body || '{}').p_feature_ids || [];
        // The first chunk is unavailable; the rest arrives. The aggregate is
        // therefore partial, not a fabricated zero.
        if (ids.length === 200) return errorResponse(500);
        return createOkResponse(ids.map(id => ({ feature_id: id, upvotes: 3, downvotes: 1 })));
      }
      if (target.includes('get_feature_comment_counts')) return errorResponse(500);
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);

    const cards = container.querySelectorAll('.yp-voting-item');
    expect(cards.length).toBe(250);
    // Rows that did arrive are counted on the card.
    const lastTotal = cards[249].querySelector('.yp-vote-total').textContent;
    expect(lastTotal).toBe('4');
    // The unavailable chunk is unknown, never 0.
    const firstTotal = cards[0].querySelector('.yp-vote-total').textContent;
    expect(firstTotal).toBe('unavailable');
    expect(
      container.querySelector('.yp-voting-item .yp-voting-comments-icon').textContent
    ).toContain('–');
    // The vote bar reflects the same partial state as a partial count.
    expect(container.querySelector('#yp-vote-bar-count').textContent).toBe('4+');
    // The preview comment count stays unknown as well.
    const previewComments = document.querySelector('[data-preview-comments="1"]');
    expect(previewComments.textContent).toContain('–');
    expect(previewComments.getAttribute('aria-label')).toContain('unavailable');
  });

  test('a vote updates one card, toggles off and switches direction', async () => {
    let action = 'added';
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        return createListPage([{ id: 'feat-1', title: 'One', status: 'proposed' }]);
      }
      if (target.includes('get_vote_counts')) {
        return createOkResponse([{ feature_id: 'feat-1', upvotes: 3, downvotes: 1 }]);
      }
      if (target.includes('get_feature_comment_counts')) {
        return createOkResponse([{ feature_id: 'feat-1', comment_count: 2 }]);
      }
      if (target.includes('rpc/cast_vote')) {
        action = JSON.parse(options.body || '{}').p_vote_type === 0 ? 'removed' : 'added';
        return createOkResponse({ action });
      }
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);
    const total = () =>
      Number(
        container.querySelector('.yp-voting-item[data-feature-id="feat-1"] .yp-vote-total')
          .textContent
      );
    const up = () =>
      container.querySelector('.yp-voting-item[data-feature-id="feat-1"] [data-vote="1"]');
    const down = () =>
      container.querySelector('.yp-voting-item[data-feature-id="feat-1"] [data-vote="-1"]');

    expect(total()).toBe(4);
    up().click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(total()).toBe(5);
    expect(up().classList.contains('active')).toBe(true);

    // Clicking the active button again removes the vote.
    up().click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(total()).toBe(4);
    expect(up().classList.contains('active')).toBe(false);

    // Switching direction moves the vote to the other side: the downvote is
    // added while the removed upvote no longer counts.
    down().click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(total()).toBe(5);
    expect(down().classList.contains('active')).toBe(true);
    expect(up().classList.contains('active')).toBe(false);

    expect(rpcBodies(fetchMock, 'cast_vote').map(b => b.p_vote_type)).toEqual([1, 0, -1]);
  });

  test('a card vote keeps unavailable comment counts unavailable after the refresh', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        return createListPage([{ id: 'feat-1', title: 'One', status: 'in_progress' }]);
      }
      if (target.includes('get_vote_counts')) {
        return createOkResponse([{ feature_id: 'feat-1', upvotes: 2, downvotes: 0 }]);
      }
      if (target.includes('get_feature_comment_counts')) return errorResponse(500);
      if (target.includes('rpc/cast_vote')) return createOkResponse({ action: 'added' });
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);
    const card = () => container.querySelector('.yp-voting-item[data-feature-id="feat-1"]');

    // The mapped status label goes through i18n; the class stays the DB value.
    // The unmapped-locale label falls back to the raw DB value for display.
    expect(card().querySelector('.yp-voting-item-status').textContent).toBe('in_progress');
    expect(card().querySelector('.yp-voting-item-status').className).toContain(
      'status-in_progress'
    );

    card().querySelector('[data-vote="1"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const refreshed = container.querySelector('.yp-voting-item[data-feature-id="feat-1"]');
    expect(refreshed.querySelector('.yp-vote-total').textContent).toBe('3');
    expect(refreshed.querySelector('.yp-voting-comments-icon').textContent).toContain('–');
  });

  test('an unmapped status value renders the raw database label', async () => {
    const fetchMock = healthyAggregates([{ id: 'f-1', title: 'One', status: 'rejected_by_board' }]);
    const { container } = await bootList(fetchMock);

    const status = container.querySelector('.yp-voting-item-status');
    expect(status.textContent).toBe('rejected_by_board');
    expect(status.className).toContain('status-rejected_by_board');
  });

  test('overlapping votes are refused without a second request', async () => {
    let release = null;
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        return createListPage([{ id: 'feat-1', title: 'One', status: 'proposed' }]);
      }
      if (target.includes('rpc/cast_vote')) {
        await new Promise(resolve => {
          release = resolve;
        });
        return createOkResponse({ action: 'added' });
      }
      return createOkResponse([]);
    });
    const { voting } = await bootList(fetchMock);

    const first = voting.vote('feat-1', 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const second = await voting.vote('feat-1', -1);
    release?.();
    await first;

    expect(second).toEqual({ success: false, error: 'Vote already in progress' });
    expect(rpcBodies(fetchMock, 'cast_vote')).toHaveLength(1);
  });

  test('a vote control without a feature id never reaches the server', async () => {
    const fetchMock = healthyAggregates([{ id: '', title: 'No id', status: 'proposed' }]);
    const { container } = await bootList(fetchMock);

    container.querySelector('.yp-voting-item [data-vote="1"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(rpcBodies(fetchMock, 'cast_vote')).toHaveLength(0);
  });

  test('a vote control with an unusable direction casts a no-op vote', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        return createListPage([{ id: 'feat-1', title: 'One', status: 'proposed' }]);
      }
      if (target.includes('rpc/cast_vote')) return createOkResponse({ action: 'removed' });
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);

    const up = container.querySelector('.yp-voting-item[data-feature-id="feat-1"] [data-vote="1"]');
    up.setAttribute('data-vote', '');
    up.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(rpcBodies(fetchMock, 'cast_vote')[0].p_vote_type).toBe(0);
  });

  test('the card comments control opens the panel without a title when there is none', async () => {
    const fetchMock = healthyAggregates([{ id: 'feat-1', title: '', status: 'proposed' }]);
    const { container } = await bootList(fetchMock);

    container
      .querySelector('.yp-voting-item[data-feature-id="feat-1"] .yp-voting-comments-icon')
      .click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const panel = document.getElementById('yp-comments-panel');
    expect(panel.classList.contains('open')).toBe(true);
    expect(document.getElementById('yp-comments-feature-title').textContent).toBe('');
  });

  test('a card image opens the gallery for that feature', async () => {
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        return createListPage([{ id: 'feat-1', title: 'One', status: 'proposed' }]);
      }
      if (target.includes('get_feature_images')) {
        const ids = JSON.parse(options.body || '{}').p_feature_ids || [];
        return createOkResponse(
          ids.flatMap(id => [
            { feature_id: id, storage_path: `${id}-one.png` },
            { feature_id: id, storage_path: `${id}-two.png` },
          ])
        );
      }
      return createOkResponse([]);
    });
    const { container, voting } = await bootList(fetchMock);

    const thumbs = container.querySelectorAll('.yp-feature-thumb');
    expect(thumbs.length).toBe(2);
    thumbs[1].click();
    expect(voting.VotingGallery.isOpen()).toBe(true);
    expect(voting.VotingGallery.items).toHaveLength(2);
    expect(voting.VotingGallery.currentIndex).toBe(1);
    expect(voting.VotingGallery.items[0].caption).toBe('Feature attachment');
  });

  test('the continuation control ignores a second click while a page is loading', async () => {
    let listCalls = 0;
    const fetchMock = healthyAggregates([], { counts: 'error' });
    fetchMock.mockImplementation(async url => {
      if (String(url).includes('get_feature_requests')) {
        listCalls += 1;
        return listCalls === 1
          ? createListPage(makeFeatures(50), true, 'cursor-50')
          : createListPage(makeFeatures(1), false);
      }
      if (String(url).includes('get_feature_comment_counts')) return errorResponse(500);
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);

    container.querySelector('#yp-voting-load-more').click();
    // The same control is clicked again before the page resolved.
    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(listCalls).toBe(2);
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(51);
  });

  test('an empty continuation page keeps the loaded cards and the control', async () => {
    let listCalls = 0;
    const fetchMock = healthyAggregates([]);
    fetchMock.mockImplementation(async url => {
      if (String(url).includes('get_feature_requests')) {
        listCalls += 1;
        // The server keeps claiming more data but returns nothing.
        return listCalls === 1
          ? createListPage(makeFeatures(50), true, 'cursor-50')
          : createListPage([], true, 'cursor-99');
      }
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);

    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.querySelectorAll('.yp-voting-item').length).toBe(50);
    expect(container.querySelector('#yp-voting-load-more')).not.toBeNull();
  });

  test('a failed first page offers Retry, and a failed continuation keeps the loaded page', async () => {
    let listCalls = 0;
    let failing = true;
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        listCalls += 1;
        if (listCalls === 1) return errorResponse(503);
        if (failing) return errorResponse(503);
        return createListPage(makeFeatures(50), true, 'cursor-50');
      }
      if (target.includes('get_preview_feature')) {
        return createOkResponse([{ id: 'p-1', title: 'Preview', feature_type: 'preview' }]);
      }
      return createOkResponse([]);
    });
    const { voting, container } = await bootList(fetchMock);

    expect(container.querySelector('.yp-voting-error')).not.toBeNull();

    failing = false;
    container.querySelector('.yp-voting-retry').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(50);

    // Now the continuation fails: the loaded page survives with Retry on the
    // continuation control itself.
    failing = true;
    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.querySelectorAll('.yp-voting-item').length).toBe(50);
    expect(container.querySelector('#yp-voting-load-more').textContent).toBe('Retry');
    expect(voting.isCommunityWritable()).toBe(true);
  });

  test('a transport failure surfaces the load error state', async () => {
    let failing = true;
    const fetchMock = jest.fn(async url => {
      if (String(url).includes('get_feature_requests')) {
        if (failing) throw new Error('network down');
        return createListPage([{ id: 'feat-1', title: 'One', status: 'proposed' }]);
      }
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);

    expect(container.querySelector('.yp-voting-error')).not.toBeNull();
    expect(container.querySelector('.yp-voting-retry')).not.toBeNull();

    failing = false;
    container.querySelector('.yp-voting-retry').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.querySelectorAll('.yp-voting-item').length).toBe(1);
  });

  test('a stale load never renders over a newer one', async () => {
    let releaseStale = null;
    let listCalls = 0;
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        listCalls += 1;
        if (listCalls === 1) {
          // The first load is slow: a second load overtakes it.
          await new Promise(resolve => {
            releaseStale = resolve;
          });
          return createListPage([{ id: 'stale-1', title: 'Stale', status: 'proposed' }]);
        }
        return createListPage([{ id: 'fresh-1', title: 'Fresh', status: 'proposed' }]);
      }
      return createOkResponse([]);
    });
    setFetch(fetchMock);
    const voting = boot();
    const container = document.createElement('div');
    document.body.appendChild(container);
    voting.createUI(container);

    const stale = voting.loadFeatures();
    await new Promise(resolve => setTimeout(resolve, 0));
    const fresh = voting.loadFeatures();
    await fresh;
    releaseStale();
    await stale;
    await new Promise(resolve => setTimeout(resolve, 0));

    const ids = Array.from(container.querySelectorAll('.yp-voting-item')).map(el =>
      el.getAttribute('data-feature-id')
    );
    expect(ids).toEqual(['fresh-1']);
  });

  test('a contract mismatch shows an unavailable state without a Retry control', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ code: 'PGRST202', message: 'Could not find the function' }),
        };
      }
      if (target.includes('get_preview_feature')) {
        return createOkResponse([{ id: 'p-1', title: 'Preview', feature_type: 'preview' }]);
      }
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);

    expect(container.querySelector('.yp-voting-error')).not.toBeNull();
    // Retrying cannot fix a contract mismatch, so no Retry is offered.
    expect(container.querySelector('.yp-voting-retry')).toBeNull();
  });

  test('the feature form reports a missing title, a rejection and a success', async () => {
    let result = {
      ok: false,
      status: 400,
      json: async () => ({ message: 'title already exists' }),
    };
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_feature_requests')) return createListPage([]);
      if (target.includes('rpc/submit_feature')) return result;
      return createOkResponse([]);
    });
    const { voting } = await bootList(fetchMock);
    voting.init();
    const status = document.getElementById('yp-feature-form-status');
    const title = document.getElementById('yp-feature-title');
    const desc = document.getElementById('yp-feature-desc');
    const submit = document.getElementById('yp-submit-feature');

    submit.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(status.textContent).toBe('Title is required');
    expect(rpcBodies(fetchMock, 'submit_feature')).toHaveLength(0);

    title.value = 'New feature';
    desc.value = 'Description';
    submit.click();
    submit.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    // A single user action issues at most one submit_feature RPC.
    expect(rpcBodies(fetchMock, 'submit_feature')).toHaveLength(1);
    expect(status.textContent).toBe('title already exists');

    result = createOkResponse({ id: 'feat-new' });
    title.value = 'New feature';
    submit.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('yp-voting-add-form').style.display).toBe('none');
    expect(document.getElementById('yp-show-add-feature').style.display).toBe('');
    expect(title.value).toBe('');
    expect(desc.value).toBe('');
    expect(status.textContent).toBe('');
    expect(submit.disabled).toBe(false);
  });

  test('the form is inert without its inputs', async () => {
    const fetchMock = healthyAggregates([]);
    const { voting, container } = await bootList(fetchMock);
    voting.init();

    document.getElementById('yp-feature-desc').remove();
    document.getElementById('yp-feature-title').value = 'New feature';
    document.getElementById('yp-submit-feature').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(rpcBodies(fetchMock, 'submit_feature')).toHaveLength(0);
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(0);
  });

  test('the show and cancel controls open and reset the form', async () => {
    const { voting } = await bootList(healthyAggregates([]));
    voting.init();
    const form = document.getElementById('yp-voting-add-form');
    const show = document.getElementById('yp-show-add-feature');
    const title = document.getElementById('yp-feature-title');

    show.click();
    expect(form.style.display).toBe('block');
    expect(show.style.display).toBe('none');
    title.value = 'draft';

    document.getElementById('yp-cancel-feature').click();
    expect(form.style.display).toBe('none');
    expect(show.style.display).toBe('block');
    expect(title.value).toBe('');
    expect(document.getElementById('yp-feature-form-status').textContent).toBe('');
  });

  test('createUI without a container is a no-op and the read-only banner is shown', () => {
    const voting = boot();

    expect(() => voting.createUI(null)).not.toThrow();

    window.YouTubePlusConfig = { communityWritesEnabled: false };
    const container = document.createElement('div');
    document.body.appendChild(container);
    voting.createUI(container);
    const rebuilt = document.createElement('div');
    document.body.appendChild(rebuilt);
    voting.createUI(rebuilt);

    expect(rebuilt.querySelector('#yp-voting-readonly-banner')).not.toBeNull();
    expect(rebuilt.querySelector('#yp-show-add-feature').disabled).toBe(true);
    // The preview placeholder is not inserted twice when one already exists.
    expect(container.querySelectorAll('#yp-voting-preview').length).toBe(1);
    expect(rebuilt.querySelectorAll('#yp-voting-preview').length).toBe(0);
  });

  test('the public preview surface is the preview feature, never a title lookup', async () => {
    const fetchMock = jest.fn(async url => {
      if (String(url).includes('get_preview_feature')) {
        return createOkResponse([{ id: 'p-1', title: 'Preview' }]);
      }
      return createOkResponse([]);
    });
    const { voting } = await bootList(fetchMock);

    const before = rpcBodies(fetchMock, 'get_preview_feature').length;
    const res = await voting.ensurePreviewFeature();
    expect(res.feature.id).toBe('p-1');
    expect(rpcBodies(fetchMock, 'get_preview_feature')).toHaveLength(before + 1);
    expect(voting.getFacadeVoting()).toBe(voting);
  });
});
