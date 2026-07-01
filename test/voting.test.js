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
        // renderTemplateClone is intentionally NOT mocked here: voting.js
        // ships its own range.createContextualFragment-based helper that
        // matches the original pre-modular behaviour (inline event handlers
        // survive parsing in jsdom). Mocking it with template+cloneNode
        // would break the click handlers that voting.test.js exercises.
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
          registerListener: jest.fn(),
        },
        isSettingsModalOpen: jest.fn(() => false),
        isWatchRoute: jest.fn(() => window.location.pathname === '/watch'),
        isShortsRoute: jest.fn(() => window.location.pathname.startsWith('/shorts')),
        isYouTubeDomain: jest.fn(() => true),
        isChannelRoute: jest.fn(() => false),
        logSuppressed: jest.fn(),
        whenRelevant: jest.fn(({ onEnter }) => { if (onEnter) onEnter(); return { check: jest.fn(), dispose: jest.fn() }; }),
        onSectionActive: jest.fn(() => ({ dispose: jest.fn() })),
        safeRequestAnimationFrame: jest.fn(cb => requestAnimationFrame(cb)),
      },
    });

    Object.defineProperty(window, 'YouTubePlusDOMCache', {
      configurable: true,
      writable: true,
      value: {
        querySelector: (selector, root) => (root || document).querySelector(selector),
      },
    });

    Object.defineProperty(window, 'YouTubeSecurityUtils', {
      configurable: true,
      writable: true,
      value: {
        sanitizeText: text => text,
        escapeHtml: text => text,
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

    global.requestAnimationFrame = jest.fn(() => 1);
    global.cancelAnimationFrame = jest.fn();
  };

  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    mockLocation({
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=dQw4w9WgXcQ',
    });

    installBaseGlobals();
  });

  afterEach(() => {
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCaf;
  });

  test('registers via whenRelevant and exposes public API', () => {
    const whenRelevant = jest.fn();
    const onSectionActive = jest.fn();
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        ...(window.YouTubeUtils || {}),
        whenRelevant,
        onSectionActive,
      },
    });

    jest.resetModules();
    require('../src/voting.js');

    expect(window.YouTubePlus?.Voting).toBeDefined();
    expect(whenRelevant).toHaveBeenCalled();
    // The voting module uses two lifecycles: route-bound runtime
    // and section-bound (voting tab) UI injection.
    expect(onSectionActive).toHaveBeenCalledWith('voting', expect.any(Function));
    expect(typeof window.YouTubePlus.Voting.init).toBe('function');
    expect(typeof window.YouTubePlus.Voting.vote).toBe('function');
    expect(typeof window.YouTubePlus.Voting.submitFeature).toBe('function');
  });

  test('updateVoteBar renders aggregate count and active state', () => {
    Object.defineProperty(window, 'YouTubePlusLazyLoader', {
      configurable: true,
      writable: true,
      value: { register: jest.fn() },
    });

    require('../src/voting.js');

    document.body.innerHTML = `
      <div id="ytp-plus-vote-bar-fill"></div>
      <div id="ytp-plus-vote-bar-count"></div>
      <button id="ytp-plus-vote-bar-up"></button>
      <button id="ytp-plus-vote-bar-down"></button>
    `;

    window.YouTubePlus.Voting.updateVoteBar(
      { preview_id: { upvotes: 3, downvotes: 1 } },
      { preview_id: 1 },
      'preview_id'
    );

    const fill = document.getElementById('ytp-plus-vote-bar-fill');
    const count = document.getElementById('ytp-plus-vote-bar-count');
    const up = document.getElementById('ytp-plus-vote-bar-up');
    const down = document.getElementById('ytp-plus-vote-bar-down');

    expect(fill?.style.background).toContain('75%');
    expect(count?.textContent).toBe('4');
    expect(up?.classList.contains('active')).toBe(true);
    expect(down?.classList.contains('active')).toBe(false);
  });

  test('initSlider marks container initialized and sets default position', () => {
    Object.defineProperty(window, 'YouTubePlusLazyLoader', {
      configurable: true,
      writable: true,
      value: { register: jest.fn() },
    });

    require('../src/voting.js');

    document.body.innerHTML = `
      <div class="ytp-plus-ba-container">
        <div class="ytp-plus-ba-after"></div>
        <div class="ytp-plus-ba-divider" aria-valuenow="0"></div>
      </div>
    `;

    const container = document.querySelector('.ytp-plus-ba-container');
    const divider = document.querySelector('.ytp-plus-ba-divider');

    expect(container).toBeTruthy();
    window.YouTubePlus.Voting.initSlider();

    expect(container?.getAttribute('data-slider-init')).toBe('1');
    expect(divider?.getAttribute('aria-valuenow')).toBe('50');
    expect(divider?.style.left).toBe('50%');
  });

  test('getFeatures, submitFeature and vote call Supabase endpoints', async () => {
    Object.defineProperty(window, 'YouTubePlusLazyLoader', {
      configurable: true,
      writable: true,
      value: { register: jest.fn() },
    });

    const fetchMock = jest.fn(async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      const target = String(url);

      if (target.includes('ytplus_feature_requests') && method === 'GET') {
        return createOkResponse([
          { id: 'feature-1', title: 'Feature A', description: 'Desc', status: 'proposed' },
        ]);
      }

      if (target.includes('ytplus_feature_requests') && method === 'POST') {
        return createOkResponse([{ id: 'feature-2', title: 'New Feature' }]);
      }

      if (target.includes('ytplus_feature_votes') && method === 'GET') {
        return createOkResponse([]);
      }

      if (target.includes('ytplus_feature_votes') && method === 'POST') {
        return createOkResponse([{ id: 'vote-1', vote_type: 1 }]);
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

  test('createUI renders voting container and form controls', () => {
    Object.defineProperty(window, 'YouTubePlusLazyLoader', {
      configurable: true,
      writable: true,
      value: { register: jest.fn() },
    });

    require('../src/voting.js');

    const host = document.createElement('div');
    document.body.appendChild(host);
    window.YouTubePlus.Voting.createUI(host);

    expect(host.querySelector('.ytp-plus-voting')).toBeTruthy();
    expect(host.querySelector('.ytp-plus-voting')).toBeTruthy();
    expect(host.querySelector('#ytp-plus-voting-list')).toBeTruthy();
    expect(host.querySelector('#ytp-plus-feature-title')).toBeTruthy();
    expect(host.querySelector('#ytp-plus-feature-desc')).toBeTruthy();
  });

  test('submitFeature validates empty, reserved, duplicate title and trims payload', async () => {
    Object.defineProperty(window, 'YouTubePlusLazyLoader', {
      configurable: true,
      writable: true,
      value: { register: jest.fn() },
    });

    const fetchMock = jest.fn(async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      const target = String(url);

      if (target.includes('ytplus_feature_requests') && method === 'GET') {
        return createOkResponse([{ id: 'f-existing', title: 'existing title' }]);
      }

      if (target.includes('ytplus_feature_requests') && method === 'POST') {
        return createOkResponse([{ id: 'f-posted' }]);
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

    const reserved = await window.YouTubePlus.Voting.submitFeature('__ytp_preview_vote__', 'desc');
    expect(reserved.success).toBe(false);
    expect(reserved.error).toContain('reserved');

    const duplicate = await window.YouTubePlus.Voting.submitFeature(' Existing Title ', 'desc');
    expect(duplicate.success).toBe(false);
    expect(duplicate.error).toContain('already exists');

    // Switch GET response so we can pass duplicate check and verify normalize/trim path
    fetchMock.mockImplementation(async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      const target = String(url);
      if (target.includes('ytplus_feature_requests') && method === 'GET') {
        return createOkResponse([]);
      }
      if (target.includes('ytplus_feature_requests') && method === 'POST') {
        return createOkResponse([{ id: 'f-posted' }]);
      }
      return createOkResponse([]);
    });

    const submit = await window.YouTubePlus.Voting.submitFeature(
      '  New   Feature  ',
      '  body\n\ntext  '
    );
    expect(submit.success).toBe(true);
  });

  test('init handlers open/close comments panel and submit comment with validation', async () => {
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
        isWatchRoute: jest.fn(() => window.location.pathname === '/watch'),
        isShortsRoute: jest.fn(() => window.location.pathname.startsWith('/shorts')),
        isYouTubeDomain: jest.fn(() => true),
        isChannelRoute: jest.fn(() => false),
        logSuppressed: jest.fn(),
        whenRelevant: jest.fn(({ onEnter }) => { if (onEnter) onEnter(); return { check: jest.fn(), dispose: jest.fn() }; }),
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

    Object.defineProperty(window, 'YouTubePlusLazyLoader', {
      configurable: true,
      writable: true,
      value: null,
    });

    const fetchMock = jest.fn(async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      const target = String(url);

      if (target.includes('ytplus_feature_requests') && method === 'GET') {
        return createOkResponse([
          {
            id: 'preview-1',
            title: '__ytp_preview_vote__',
            description: 'Internal row',
            status: 'proposed',
          },
          {
            id: 'feature-1',
            title: 'Feature A',
            description: 'Useful feature',
            status: 'in_progress',
          },
        ]);
      }

      if (target.includes('ytplus_feature_votes?select=feature_id,vote_type,ip_address')) {
        return createOkResponse([
          { feature_id: 'preview-1', vote_type: 1, ip_address: 'someone' },
          { feature_id: 'feature-1', vote_type: 1, ip_address: 'someone' },
        ]);
      }

      if (target.includes('ytplus_feature_votes?select=feature_id,vote_type&ip_address=eq.')) {
        return createOkResponse([{ feature_id: 'preview-1', vote_type: 1 }]);
      }

      if (target.includes('ytplus_feature_comments?select=')) {
        return createOkResponse([
          {
            id: 'c-1',
            feature_id: 'feature-1',
            comment: 'First comment',
            author_ip: 'user-x',
            created_at: '2026-05-30T10:00:00.000Z',
          },
        ]);
      }

      if (target.includes('ytplus_feature_comments') && method === 'POST') {
        return createOkResponse([{ id: 'c-2' }]);
      }

      if (target.includes('ytplus_feature_votes') && method === 'POST') {
        return createOkResponse([{ id: 'v-1', vote_type: 1 }]);
      }

      if (target.includes('ytplus_feature_votes') && method === 'DELETE') {
        return createOkResponse([]);
      }

      if (target.includes('ytplus_feature_votes') && method === 'PATCH') {
        return createOkResponse([{ id: 'v-1', vote_type: -1 }]);
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

    const panel = document.getElementById('ytp-plus-comments-panel');
    expect(panel?.classList.contains('open')).toBe(true);

    const input = document.getElementById('ytp-plus-comments-input');
    const submitBtn = document.getElementById('ytp-plus-comments-submit');
    expect(input).toBeTruthy();
    expect(submitBtn).toBeTruthy();

    // Empty value: should not send POST
    input.value = '   ';
    submitBtn.click();
    await Promise.resolve();
    expect(
      fetchMock.mock.calls.some(
        ([u, o]) => String(u).includes('ytplus_feature_comments') && String(o?.method) === 'POST'
      )
    ).toBe(false);

    input.value = '  New comment from test  ';
    submitBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      fetchMock.mock.calls.some(
        ([u, o]) => String(u).includes('ytplus_feature_comments') && String(o?.method) === 'POST'
      )
    ).toBe(true);

    const nonVotingNav = document.createElement('button');
    nonVotingNav.className = 'ytp-plus-settings-nav-item';
    nonVotingNav.setAttribute('data-section', 'general');
    document.body.appendChild(nonVotingNav);
    nonVotingNav.click();
    expect(panel?.classList.contains('open')).toBe(false);
  });
});
