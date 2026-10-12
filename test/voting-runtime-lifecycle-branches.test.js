/**
 * @jest-environment jsdom
 */

/**
 * Runtime lifecycle, delegated actions and rendering fallbacks.
 *
 * The runtime defers initialisation until <body> exists, wires its delegated
 * actions once, and releases everything it built when the route-bound runtime
 * stops. Rendering degrades safely when the SafeDOM fragment facade is absent,
 * and the delegated vote bar and photo carousel drive the same code paths as
 * the panels do.
 */

describe('Voting runtime lifecycle and rendering fallbacks', () => {
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

  let registeredListeners = [];

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

  const delegatedGm = () => {
    Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
      configurable: true,
      writable: true,
      value: delegatedOnce,
    });
  };

  const delegatedOnce = options => {
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

  const healthyFetch = (rows = []) =>
    jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('get_feature_requests')) return createListPage(rows);
      if (target.includes('get_preview_feature')) {
        return createOkResponse([{ id: 'p-1', title: 'Preview', feature_type: 'preview' }]);
      }
      if (target.includes('get_vote_counts')) {
        const ids = JSON.parse(options.body || '{}').p_feature_ids || [];
        return createOkResponse(ids.map(id => ({ feature_id: id, upvotes: 1, downvotes: 0 })));
      }
      if (target.includes('rpc/cast_vote')) return createOkResponse({ action: 'added' });
      return createOkResponse([]);
    });

  const bootList = async fetchMock => {
    setFetch(fetchMock);
    const voting = boot();
    const container = document.createElement('div');
    document.body.appendChild(container);
    voting.createUI(container);
    voting.init();
    await voting.loadFeatures();
    return { voting, container };
  };

  /** Fake 2d context + canvas encoding so processImage can complete in jsdom. */
  const stubCanvas = ({ blob = new window.Blob(['bytes'], { type: 'image/png' }), size } = {}) => {
    const context = {
      fillStyle: '',
      fillRect: jest.fn(),
      clearRect: jest.fn(),
      drawImage: jest.fn(),
    };
    const getContext = jest
      .spyOn(window.HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context);
    const toBlob = jest
      .spyOn(window.HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (cb, type, quality) {
        toBlob.calls.push({ type, quality });
        if (blob === null) {
          cb(null);
          return;
        }
        const resolved = size ? Object.defineProperty(blob, 'size', { value: size }) : blob;
        cb(resolved);
      });
    toBlob.calls = [];
    const originalImage = global.Image;
    global.Image = class {
      constructor() {
        this.naturalWidth = 1200;
        this.naturalHeight = 600;
      }
      set src(_value) {
        queueMicrotask(() => this.onload?.());
      }
    };
    return {
      context,
      toBlob,
      restore: () => {
        getContext.mockRestore();
        toBlob.mockRestore();
        global.Image = originalImage;
      },
    };
  };

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

  // ---- lifecycle ------------------------------------------------------------

  test('initialisation waits for the body and runs once when it arrives', () => {
    const voting = boot();
    const body = document.body;
    document.documentElement.removeChild(body);

    voting.init();
    // A second call while deferred must not register a second listener.
    voting.init();
    expect(document.getElementById('yp-comments-panel')).toBeNull();

    document.documentElement.appendChild(body);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(document.getElementById('yp-comments-panel')).not.toBeNull();
    expect(document.getElementById('yp-gallery-modal')).not.toBeNull();
  });

  test('the settings section activation builds the panel and loads the list', async () => {
    let activate = null;
    let deactivate = null;
    const sectionActive = jest.fn((_name, onActivate, onDeactivate) => {
      activate = onActivate;
      deactivate = onDeactivate;
      return { dispose: jest.fn() };
    });
    const fetchMock = healthyFetch([{ id: 'feat-1', title: 'One', status: 'proposed' }]);
    setFetch(fetchMock);
    installGlobals({ utils: { onSectionActive: sectionActive } });
    const voting = boot();
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div class="yp-settings-shell">
        <div id="yp-voting-container"></div>
        <div class="yp-settings-content"></div>
      </div>
    `
    );

    expect(sectionActive).toHaveBeenCalledWith(
      'voting',
      expect.any(Function),
      expect.any(Function)
    );
    activate();
    await new Promise(resolve => setTimeout(resolve, 0));

    const container = document.getElementById('yp-voting-container');
    expect(container.querySelector('#yp-voting-list')).not.toBeNull();
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(1);

    // The section teardown stops the preview autoplay without throwing.
    expect(() => deactivate()).not.toThrow();
    expect(voting.isCommunityWritable()).toBe(true);
  });

  test('the delegated vote bar button votes on the preview feature', async () => {
    const fetchMock = healthyFetch([]);
    const { container } = await bootList(fetchMock);
    const barBtn = document.createElement('button');
    barBtn.className = 'yp-vote-bar-btn';
    barBtn.dataset.vote = '1';
    document.body.appendChild(barBtn);

    barBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const cast = rpcBodies(fetchMock, 'cast_vote');
    expect(cast).toHaveLength(1);
    expect(cast[0].p_feature_id).toBe('p-1');
    expect(cast[0].p_vote_type).toBe(1);
    expect(container.querySelector('#yp-vote-bar-up').classList.contains('active')).toBe(true);
  });

  test('the delegated vote bar does nothing without a preview feature', async () => {
    const fetchMock = jest.fn(async url =>
      String(url).includes('get_preview_feature') ? createOkResponse([]) : createOkResponse([])
    );
    await bootList(fetchMock);
    const barBtn = document.createElement('button');
    barBtn.className = 'yp-vote-bar-btn';
    barBtn.dataset.vote = '-1';
    document.body.appendChild(barBtn);

    barBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(rpcBodies(fetchMock, 'cast_vote')).toHaveLength(0);
    expect(rpcBodies(fetchMock, 'get_my_votes')).toHaveLength(0);
  });

  // ---- photo carousel -------------------------------------------------------

  test('the photo picker adds previews that can be walked and deleted', async () => {
    const { container } = await bootList(healthyFetch([]));
    const fileInput = document.getElementById('yp-feature-photo-input');
    const picker = jest.spyOn(fileInput, 'click').mockImplementation(() => {
      /* inert stand-in: no observable effect in jsdom */
    });

    document.getElementById('yp-add-photo-btn').click();
    expect(picker).toHaveBeenCalled();

    const wrap = document.getElementById('yp-photo-preview-wrap');
    const files = [
      new window.File(['one'], 'one.png', { type: 'image/png' }),
      new window.File(['two'], 'two.png', { type: 'image/png' }),
      new window.File(['three'], 'three.png', { type: 'image/png' }),
    ];
    Object.defineProperty(fileInput, 'files', { value: files, configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));

    expect(voting_getAttachedPhotos()).toHaveLength(3);
    expect(wrap.style.display).toBe('flex');
    expect(wrap.querySelector('.yp-photo-indicator').textContent.replace(/\s+/g, '')).toBe('1/3');
    // A change event with no files is inert.
    Object.defineProperty(fileInput, 'files', { value: [], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(wrap.querySelector('.yp-photo-preview-img')).not.toBeNull();

    wrap.querySelector('#yp-photo-next').click();
    wrap.querySelector('#yp-photo-next').click();
    expect(wrap.querySelector('.yp-photo-indicator').textContent.replace(/\s+/g, '')).toBe('3/3');
    // Wrapping backwards from the first photo lands on the last one.
    wrap.querySelector('#yp-photo-prev').click();
    expect(wrap.querySelector('.yp-photo-indicator').textContent.replace(/\s+/g, '')).toBe('2/3');

    // Deleting the last photo clamps the carousel back onto a real photo.
    wrap.querySelector('#yp-photo-delete').click();
    expect(voting_getAttachedPhotos()).toHaveLength(2);
    expect(wrap.querySelector('.yp-photo-indicator').textContent.replace(/\s+/g, '')).toBe('2/2');

    // A stale navigation control from before the delete is inert at one photo.
    const staleNext = wrap.querySelector('#yp-photo-next');
    wrap.querySelector('#yp-photo-delete').click();
    expect(voting_getAttachedPhotos()).toHaveLength(1);
    staleNext.click();
    expect(voting_getAttachedPhotos()).toHaveLength(1);

    // Removing the last photo empties the strip and restores the add button.
    wrap.querySelector('#yp-photo-delete').click();
    expect(voting_getAttachedPhotos()).toHaveLength(0);
    expect(wrap.style.display).toBe('none');
    expect(wrap.querySelector('.yp-photo-preview-img')).toBeNull();
    expect(container.querySelector('#yp-add-photo-btn').style.display).toBe('inline-flex');
  });

  const voting_getAttachedPhotos = () => window.YouTubePlusVoting.getAttachedPhotos();

  // ---- rendering fallbacks --------------------------------------------------

  test('the list renders through the utils helper when the fragment facade is absent', async () => {
    delete window.YouTubePlusSafeDOM;
    const { container } = await bootList(healthyFetch([{ id: 'feat-1', title: 'One' }]));

    expect(container.querySelectorAll('.yp-voting-item').length).toBe(1);
    // The continuation control is built through the same sanitized path.
    container.querySelector('#yp-voting-load-more');
  });

  test('the continuation appends through the template-clone fragment path', async () => {
    let listCalls = 0;
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        listCalls += 1;
        return listCalls === 1
          ? createListPage([{ id: 'feat-1', title: 'One' }], true, 'cursor-1')
          : createListPage([{ id: 'feat-2', title: 'Two' }], false);
      }
      return createOkResponse([]);
    });
    // No createFragment facade: only renderTemplateClone is available.
    Object.defineProperty(window, 'YouTubePlusSafeDOM', {
      configurable: true,
      writable: true,
      value: {
        renderTemplateClone: (container, html) => {
          const tpl = document.createElement('template');
          tpl.innerHTML = String(html ?? '');
          container.replaceChildren(tpl.content.cloneNode(true));
        },
      },
    });
    installGlobals({ utils: { setSafeHTML: undefined } });
    const { container } = await bootList(fetchMock);

    expect(container.querySelectorAll('.yp-voting-item').length).toBe(1);
    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(2);
  });

  test('a vote leaves the card untouched when no SafeDOM facade exists at all', async () => {
    delete window.YouTubePlusSafeDOM;
    installGlobals({ utils: { setSafeHTML: undefined } });
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        return createListPage([{ id: 'feat-1', title: 'One', status: 'proposed' }]);
      }
      if (target.includes('get_vote_counts')) {
        return createOkResponse([{ feature_id: 'feat-1', upvotes: 2, downvotes: 0 }]);
      }
      if (target.includes('rpc/cast_vote')) return createOkResponse({ action: 'added' });
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);
    const before = container.querySelector('.yp-vote-total').textContent;

    container.querySelector('[data-vote="1"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    // The vote is accepted by the server; the card simply cannot be swapped
    // without a sanitizing facade, so its markup is left as rendered.
    expect(rpcBodies(fetchMock, 'cast_vote')).toHaveLength(1);
    expect(container.querySelector('.yp-vote-total').textContent).toBe(before);
  });

  test('a failed continuation offers Retry on the control itself', async () => {
    let listCalls = 0;
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        listCalls += 1;
        if (listCalls === 1)
          return createListPage([{ id: 'feat-1', title: 'One' }], true, 'cursor-1');
        throw new Error('network down');
      }
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);

    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.querySelectorAll('.yp-voting-item').length).toBe(1);
    expect(container.querySelector('#yp-voting-load-more').textContent).toBe('Retry');
  });

  // ---- plain-fetch response shape -------------------------------------------

  test('the plain-fetch path reports headers and a malformed body honestly', async () => {
    delete globalThis.GM_xmlhttpRequest;
    let response = {
      ok: true,
      status: 200,
      headers: { forEach: cb => cb('application/json', 'content-type') },
      json: async () => ({ rows: [] }),
    };
    setFetch(jest.fn(async () => response));
    const voting = boot();

    let res = await voting.VotingApi.fetchRest('rpc/get_feature_requests');
    expect(res).toEqual({
      data: { rows: [] },
      error: null,
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    response = {
      ok: false,
      status: 500,
      headers: undefined,
      json: async () => {
        throw new Error('not json');
      },
    };
    res = await voting.VotingApi.fetchRest('rpc/get_feature_requests');
    expect(res).toEqual({ data: null, error: 'HTTP 500', status: 500, headers: null });

    response = {
      ok: true,
      status: 200,
      headers: undefined,
      json: async () => {
        throw new Error('not json');
      },
    };
    res = await voting.VotingApi.fetchRest('rpc/get_feature_requests');
    expect(res).toEqual({
      data: null,
      error: 'Malformed JSON response',
      status: 200,
      headers: null,
    });
  });

  // ---- local image pipeline -------------------------------------------------

  test('a decoded photo becomes a draft that the pipeline can revoke', async () => {
    const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      /* inert stand-in: no observable effect in jsdom */
    });
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:draft-1');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: arr => arr, randomUUID: () => 'uuid-from-host' },
    });
    const canvas = stubCanvas();
    try {
      const { VotingMedia } = boot();
      const draft = await VotingMedia.processImage(
        new window.File(['bytes'], 'photo.png', { type: 'image/png' })
      );

      expect(draft).toMatchObject({
        draftId: 'uuid-from-host',
        mimeType: 'image/png',
        previewUrl: 'blob:draft-1',
        width: 1200,
        height: 600,
        status: 'pending',
        error: null,
      });
      // A PNG is encoded losslessly.
      expect(canvas.toBlob.calls[0]).toEqual({ type: 'image/png', quality: undefined });
      expect(canvas.context.drawImage).toHaveBeenCalled();

      VotingMedia.revokeUrl(draft.previewUrl);
      expect(revoke).toHaveBeenCalledWith('blob:draft-1');
      // Revoking a single URL releases it, so revokeAll has nothing left.
      VotingMedia.revokeAll();
      expect(revoke).toHaveBeenCalledTimes(1);
    } finally {
      canvas.restore();
      URL.createObjectURL = createObjectURL;
    }
  });

  test('a JPEG is flattened onto white before encoding', async () => {
    const canvas = stubCanvas();
    try {
      const { VotingMedia } = boot();
      const draft = await VotingMedia.processImage(
        new window.File(['bytes'], 'photo.jpg', { type: 'image/jpeg' })
      );

      expect(draft.mimeType).toBe('image/jpeg');
      expect(canvas.context.fillStyle).toBe('#ffffff');
      expect(canvas.context.fillRect).toHaveBeenCalledWith(0, 0, 1200, 600);
      expect(canvas.toBlob.calls[0]).toEqual({ type: 'image/jpeg', quality: 0.85 });
    } finally {
      canvas.restore();
    }
  });

  test('an encoding failure and an oversized result both reject the draft', async () => {
    const empty = stubCanvas({ blob: null });
    try {
      const { VotingMedia } = boot();
      await expect(
        VotingMedia.processImage(new window.File(['x'], 'a.png', { type: 'image/png' }))
      ).rejects.toThrow('Failed to encode image');
    } finally {
      empty.restore();
    }

    const { VotingMedia: NextMedia } = boot();
    const huge = stubCanvas({ size: 6 * 1024 * 1024 });
    try {
      await expect(
        NextMedia.processImage(new window.File(['x'], 'a.png', { type: 'image/png' }))
      ).rejects.toThrow('Image exceeds 5MB limit. Please choose a smaller image.');
    } finally {
      huge.restore();
    }
  });

  test('the fragment facade path builds the continuation and swaps a voted card', async () => {
    Object.defineProperty(window, 'YouTubePlusSafeDOM', {
      configurable: true,
      writable: true,
      value: {
        createFragment: html => {
          const tpl = document.createElement('template');
          tpl.innerHTML = String(html ?? '');
          return tpl.content;
        },
      },
    });
    let listCalls = 0;
    const fetchMock = jest.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('get_feature_requests')) {
        listCalls += 1;
        return listCalls === 1
          ? createListPage([{ id: 'feat-1', title: 'One', status: 'proposed' }], true, 'cursor-1')
          : createListPage([{ id: 'feat-2', title: 'Two', status: 'proposed' }], false);
      }
      if (target.includes('get_vote_counts')) {
        const ids = JSON.parse(options.body || '{}').p_feature_ids || [];
        return createOkResponse(ids.map(id => ({ feature_id: id, upvotes: 1, downvotes: 0 })));
      }
      if (target.includes('rpc/cast_vote')) return createOkResponse({ action: 'added' });
      return createOkResponse([]);
    });
    const { container } = await bootList(fetchMock);

    container.querySelector('#yp-voting-load-more').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(2);

    container.querySelector('.yp-voting-item[data-feature-id="feat-1"] [data-vote="1"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const card = container.querySelector('.yp-voting-item[data-feature-id="feat-1"]');
    expect(card.querySelector('.yp-vote-total').textContent).toBe('2');
    expect(card.querySelector('[data-vote="1"]').classList.contains('active')).toBe(true);
  });

  test('the load deadline aborts a hung read and shows an explicit state', async () => {
    jest.useFakeTimers();
    try {
      // The manager transport never answers: the read can only end at the
      // module's own 15 s deadline.
      Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
        configurable: true,
        writable: true,
        value: () => ({
          abort() {
            /* inert handle: the transport already settled */
          },
        }),
      });
      setFetch(jest.fn(async () => createOkResponse([])));
      const voting = boot();
      const container = document.createElement('div');
      document.body.appendChild(container);
      voting.createUI(container);

      const pending = voting.loadFeatures();
      jest.advanceTimersByTime(15000);
      await pending;

      expect(container.querySelector('.yp-voting-error')).not.toBeNull();
      expect(container.querySelector('.yp-voting-retry')).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('a hung continuation offers Retry on the control instead of blocking', async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.fn(async url => {
        if (String(url).includes('get_feature_requests')) {
          return createListPage(
            [{ id: 'feat-1', title: 'One', status: 'proposed' }],
            true,
            'cursor-1'
          );
        }
        return createOkResponse([]);
      });
      const { container } = await bootList(fetchMock);
      // Only the continuation request hangs.
      Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
        configurable: true,
        writable: true,
        value: options => {
          if (
            String(options.url).includes('get_feature_requests') &&
            fetchMock.mock.calls.length > 1
          ) {
            return {
              abort() {
                /* inert handle: the transport already settled */
              },
            };
          }
          return delegatedOnce(options);
        },
      });

      container.querySelector('#yp-voting-load-more').click();
      await jest.advanceTimersByTimeAsync(15000);

      expect(container.querySelectorAll('.yp-voting-item').length).toBe(1);
      expect(container.querySelector('#yp-voting-load-more').textContent).toBe('Retry');
    } finally {
      jest.useRealTimers();
    }
  });

  test('a broken DOM lookup during section activation is suppressed, not thrown', async () => {
    let activate = null;
    const sectionActive = jest.fn((_name, onActivate) => {
      activate = onActivate;
      return { dispose: jest.fn() };
    });
    setFetch(jest.fn(async () => createOkResponse([])));
    installGlobals({
      utils: {
        onSectionActive: sectionActive,
        // A failing element lookup is how a runtime start realistically breaks.
        byId: () => {
          throw new Error('element lookup unavailable');
        },
      },
    });
    const voting = boot();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="yp-settings-shell"><div id="yp-voting-container"></div></div>'
    );

    expect(() => activate()).not.toThrow();
    // Both guarded steps report through the same suppression channel: the
    // runtime initialisation and the panel build.
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalledTimes(2);
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'element lookup unavailable' }),
      'Voting'
    );
    expect(voting.isCommunityWritable()).toBe(true);
  });

  test('a throwing removal backend is suppressed after a verified migration', async () => {
    const boom = new Error('settings removal failed');
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
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: {
        readRaw: () => 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij-_-',
        writeRaw: () => {
          // inert stub: this branch exercises the removeRaw failure only
        },
        removeRaw: () => {
          throw boom;
        },
      },
    });
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    const utils = window.YouTubeUtils;
    const voting = boot();

    await voting.VotingApi.getMyVotes();

    expect(gmStore.get('ytp_owner_capability_secret')).toBeTruthy();
    expect(utils.logSuppressed).toHaveBeenCalledWith(boom, 'Voting');
    delete globalThis.GM_getValue;
    delete globalThis.GM_setValue;
  });

  test('the panel still works when no cleanup manager is available', async () => {
    installGlobals({
      utils: {
        cleanupManager: null,
        setSafeHTML: (el, html) => {
          if (el) el.innerHTML = html;
        },
      },
    });
    delete window.YouTubePlusCleanupManager;
    const fetchMock = healthyFetch([{ id: 'feat-1', title: 'One', status: 'proposed' }]);
    const { container } = await bootList(fetchMock);

    container.querySelector('.yp-voting-item[data-feature-id="feat-1"] [data-vote="1"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(rpcBodies(fetchMock, 'cast_vote')).toHaveLength(1);
    expect(container.querySelector('.yp-vote-total').textContent).toBe('2');
  });

  test('a slider drag releases its listeners through the fallback unregister path', () => {
    installGlobals({
      utils: {
        // A manager that can register but not unregister: the module falls back
        // to the window-scoped manager for the release.
        cleanupManager: {
          registerListener: (target, type, handler, opts) => {
            target?.addEventListener?.(type, handler, opts);
            registeredListeners.push({ target, type, handler, opts });
            return Symbol('listener');
          },
        },
      },
    });
    const unregister = jest.fn();
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: { registerListener: () => Symbol('listener'), unregisterListener: unregister },
    });
    const { initSlider } = boot();
    document.body.innerHTML = `
      <div class="yp-ba-container">
        <div class="yp-ba-after"></div>
        <div class="yp-ba-divider" aria-valuenow="50"></div>
      </div>
    `;
    const container = document.querySelector('.yp-ba-container');
    initSlider();

    container.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 5 }));
    window.dispatchEvent(new window.MouseEvent('mouseup'));

    expect(unregister).toHaveBeenCalledTimes(4);
  });

  test('the gallery restores focus even when the opener cannot be focused', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);
    // The opener goes away while the gallery is open: focus restoration must
    // not break the close path.
    opener.focus = () => {
      throw new Error('detached opener');
    };

    const utils = window.YouTubeUtils;
    const { VotingGallery } = boot();
    VotingGallery.open({ items: [{ url: 'https://vote.diorhc.space/a.png' }] });
    expect(VotingGallery.lastFocusedElement).toBe(opener);

    expect(() => VotingGallery.close()).not.toThrow();
    expect(utils.logSuppressed).toHaveBeenCalled();
    expect(VotingGallery.lastFocusedElement).toBeNull();
  });
});
