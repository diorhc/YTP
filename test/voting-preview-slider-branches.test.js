/**
 * @jest-environment jsdom
 */

/**
 * Preview rendering, before/after comparison and panel layout.
 *
 * The preview block adapts to the media it receives: a single photo opens the
 * gallery directly, two photos drive the comparison slider and extra photos
 * get an index strip. Vote and comment controls stay wired to the same feature,
 * and the comments panel docks beside a wide settings shell while a narrow or
 * classic layout stacks it over the settings content.
 */

describe('Voting preview, slider and panel layout branches', () => {
  const createOkResponse = data => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  let registeredListeners = [];

  const unregisterListener = key => {
    const index = registeredListeners.findIndex(entry => entry.key === key);
    if (index < 0) return;
    const entry = registeredListeners[index];
    entry.target?.removeEventListener?.(entry.type, entry.handler, entry.opts);
    registeredListeners.splice(index, 1);
  };

  const installGlobals = () => {
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
            const key = Symbol('listener');
            registeredListeners.push({ target, type, handler, opts, key });
            return key;
          },
          unregisterListener,
        },
        logSuppressed: jest.fn(),
        onSectionActive: jest.fn(),
        isSettingsModalOpen: jest.fn(() => false),
        safeRequestAnimationFrame: jest.fn(cb => cb(0)),
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

  const boot = () => {
    jest.resetModules();
    require('../src/voting.js');
    return window.YouTubePlusVoting;
  };

  const bootWithPreview = async (previewImages, extra = {}) => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_preview_feature')) {
        return createOkResponse([{ id: 'p-1', title: 'Preview', feature_type: 'preview' }]);
      }
      if (target.includes('get_feature_images')) {
        return createOkResponse(previewImages);
      }
      if (target.includes('get_feature_requests')) {
        return createOkResponse({ rows: extra.rows ?? [], hasMore: false });
      }
      if (target.includes('get_vote_counts')) {
        return createOkResponse([{ feature_id: 'p-1', upvotes: 2, downvotes: 2 }]);
      }
      if (target.includes('get_feature_comment_counts')) {
        return createOkResponse([{ feature_id: 'p-1', comment_count: 3 }]);
      }
      if (target.includes('get_my_votes')) {
        return createOkResponse(extra.myVotes ?? []);
      }
      if (target.includes('rpc/cast_vote')) {
        return createOkResponse({ action: 'added' });
      }
      return createOkResponse([]);
    });
    setFetch(fetchMock);
    const voting = boot();
    const container = document.createElement('div');
    document.body.appendChild(container);
    voting.createUI(container);
    await voting.loadFeatures();
    return { voting, container, fetchMock };
  };

  const manualRaf = () => {
    const queue = [];
    let id = 0;
    const raf = jest.fn(cb => {
      queue.push(cb);
      id += 1;
      return id;
    });
    global.requestAnimationFrame = raf;
    window.requestAnimationFrame = raf;
    return {
      raf,
      // Run one queued frame, the way the browser would.
      step: (timestamp = 0) => {
        const next = queue.shift();
        if (next) next(timestamp);
        return Boolean(next);
      },
      size: () => queue.length,
      restore: () => {
        global.requestAnimationFrame = undefined;
        window.requestAnimationFrame = undefined;
      },
    };
  };

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-yp-variant');
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    setFetch(jest.fn(async () => createOkResponse([])));
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

  // ---- preview rendering ----------------------------------------------------

  test('a single preview photo opens the gallery on click', async () => {
    const { voting, container } = await bootWithPreview([
      { feature_id: 'p-1', storage_path: 'voting-images/only.png' },
    ]);

    const preview = document.getElementById('yp-voting-preview');
    expect(preview.style.display).toBe('');
    expect(preview.querySelector('.yp-preview-single-img')).not.toBeNull();
    // No comparison without a second photo.
    expect(preview.querySelector('.yp-ba-container')).toBeNull();
    expect(container.querySelector('#yp-vote-bar-count').textContent).toBe('4');

    preview.querySelector('.yp-preview-img-click').click();
    expect(voting.VotingGallery.isOpen()).toBe(true);
    expect(voting.VotingGallery.items).toEqual([
      {
        url: 'https://vote.diorhc.space/storage/v1/object/public/voting-images/voting-images/only.png',
        caption: 'Preview',
      },
    ]);
  });

  test('two photos drive the comparison slider and extra photos get an index strip', async () => {
    const { voting } = await bootWithPreview([
      { feature_id: 'p-1', storage_path: 'before.png' },
      { feature_id: 'p-1', storage_path: 'after.png' },
      { feature_id: 'p-1', storage_path: 'extra.png' },
    ]);

    const preview = document.getElementById('yp-voting-preview');
    const container = preview.querySelector('.yp-ba-container');
    expect(container).not.toBeNull();
    expect(container.dataset.sliderInit).toBe('1');
    const thumbs = preview.querySelectorAll('.yp-preview-strip-thumb');
    expect(thumbs.length).toBe(1);
    expect(thumbs[0].getAttribute('data-extra-idx')).toBe('2');

    // The strip thumbnail opens the gallery at its own index.
    thumbs[0].click();
    expect(voting.VotingGallery.currentIndex).toBe(2);
    expect(voting.VotingGallery.items).toHaveLength(3);
  });

  test('an authoritative comment aggregate renders a real zero on a card without rows', async () => {
    const { container } = await bootWithPreview([], {
      rows: [{ id: 'f-1', title: 'A feature', status: 'proposed' }],
    });

    const previewComments = document.querySelector('[data-preview-comments="1"]');
    expect(previewComments.textContent).toContain('3');
    const cardComments = container.querySelector('.yp-voting-item .yp-voting-comments-icon');
    expect(cardComments.textContent).toContain('0');
    expect(cardComments.getAttribute('aria-label')).not.toContain('unavailable');
  });

  test('the preview vote buttons cast a vote and the comments button opens the panel', async () => {
    const { fetchMock } = await bootWithPreview([], {
      rows: [{ id: 'f-1', title: 'A feature', status: 'proposed' }],
    });

    const preview = document.getElementById('yp-voting-preview');
    preview.querySelector('#yp-vote-bar-up').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const castBodies = fetchMock.mock.calls
      .map(([url, options]) => ({
        url: String(url),
        body: options?.body ? JSON.parse(options.body) : null,
      }))
      .filter(call => call.url.includes('cast_vote'));
    expect(castBodies).toHaveLength(1);
    expect(castBodies[0].body.p_feature_id).toBe('p-1');
    expect(castBodies[0].body.p_vote_type).toBe(1);

    preview.querySelector('[data-preview-comments="1"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById('yp-comments-panel').classList.contains('open')).toBe(true);
  });

  test('a failed preview hides the block instead of claiming there is none', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('get_preview_feature')) {
        return { ok: false, status: 500, json: async () => ({ message: 'down' }) };
      }
      if (target.includes('get_feature_requests')) {
        return createOkResponse({ rows: [{ id: 'f-1', title: 'A feature' }], hasMore: false });
      }
      return createOkResponse([]);
    });
    setFetch(fetchMock);
    const voting = boot();
    const container = document.createElement('div');
    document.body.appendChild(container);
    voting.createUI(container);
    await voting.loadFeatures();

    expect(document.getElementById('yp-voting-preview').style.display).toBe('none');
    expect(container.querySelectorAll('.yp-voting-item').length).toBe(1);
  });

  test('an absent preview container is not rendered into', async () => {
    const { voting } = await bootWithPreview([]);
    document.body.innerHTML = '';

    // No preview block in the DOM: rendering is a no-op, not a throw.
    await expect(voting.loadFeatures()).resolves.toBeUndefined();
  });

  // ---- comparison slider ----------------------------------------------------

  test('the slider drags, clamps and releases its window listeners', () => {
    const frames = manualRaf();
    try {
      const { initSlider } = boot();
      document.body.innerHTML = `
        <div class="yp-ba-container">
          <div class="yp-ba-after"></div>
          <div class="yp-ba-divider" aria-valuenow="0"></div>
        </div>
      `;
      const container = document.querySelector('.yp-ba-container');
      const divider = document.querySelector('.yp-ba-divider');
      initSlider();

      container.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 10 }));
      // jsdom reports a zero-width box, so the divider centres itself.
      expect(divider.getAttribute('aria-valuenow')).toBe('50');
      expect(container.querySelector('.yp-ba-after').style.clipPath).toBe('inset(0 0 0 50%)');

      window.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 10 }));
      window.dispatchEvent(new window.MouseEvent('mouseup'));
      // After mouseup the drag listeners are gone.
      const windowListenerTypes = registeredListeners
        .filter(entry => entry.target === window)
        .map(entry => entry.type);
      expect(windowListenerTypes).toEqual(expect.not.arrayContaining(['mousemove']));
    } finally {
      frames.restore();
    }
  });

  test('the divider responds to arrow keys and stops at its bounds', () => {
    const frames = manualRaf();
    try {
      const { initSlider } = boot();
      document.body.innerHTML = `
        <div class="yp-ba-container">
          <div class="yp-ba-after"></div>
          <div class="yp-ba-divider" aria-valuenow="50"></div>
        </div>
      `;
      const divider = document.querySelector('.yp-ba-divider');
      initSlider();

      divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(divider.getAttribute('aria-valuenow')).toBe('48');
      divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(divider.getAttribute('aria-valuenow')).toBe('50');
      for (let i = 0; i < 40; i++) {
        divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
      }
      expect(divider.getAttribute('aria-valuenow')).toBe('98');
      // A key that is not an arrow only pauses autoplay.
      divider.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
      expect(divider.getAttribute('aria-valuenow')).toBe('98');
    } finally {
      frames.restore();
    }
  });

  test('autoplay advances the divider and stops itself when the preview detaches', () => {
    const frames = manualRaf();
    try {
      const { initSlider } = boot();
      document.body.innerHTML = `
        <div class="yp-ba-container">
          <div class="yp-ba-after"></div>
          <div class="yp-ba-divider" aria-valuenow="50"></div>
        </div>
      `;
      const container = document.querySelector('.yp-ba-container');
      const divider = document.querySelector('.yp-ba-divider');
      container.getBoundingClientRect = () => ({ left: 0, width: 800, top: 0, height: 200 });
      divider.getBoundingClientRect = () => ({ left: 320, width: 20, top: 0, height: 20 });

      initSlider();
      expect(divider.classList.contains('autoplay')).toBe(true);

      // One autoplay frame positions the divider from the measured geometry.
      frames.step();
      expect(divider.getAttribute('aria-valuenow')).toBe('41');

      // The preview is re-rendered away: the loop must cancel itself.
      container.remove();
      frames.step();
      expect(frames.step()).toBe(false);
    } finally {
      frames.restore();
    }
  });

  test('a second init resumes autoplay, and a partial container is ignored', () => {
    const frames = manualRaf();
    try {
      const { initSlider } = boot();
      document.body.innerHTML = `
        <div class="yp-ba-container">
          <div class="yp-ba-after"></div>
          <div class="yp-ba-divider" aria-valuenow="50"></div>
        </div>
      `;
      const divider = document.querySelector('.yp-ba-divider');
      initSlider();

      divider.classList.remove('autoplay');
      initSlider();
      expect(divider.classList.contains('autoplay')).toBe(true);

      // No container at all, and a container without the comparison layers.
      document.body.innerHTML = '';
      expect(() => initSlider()).not.toThrow();
      document.body.innerHTML = '<div class="yp-ba-container"></div>';
      expect(() => initSlider()).not.toThrow();
      document.body.innerHTML = `
        <div class="yp-ba-container">
          <div class="yp-ba-divider"></div>
        </div>
      `;
      expect(() => initSlider()).not.toThrow();
      expect(document.querySelector('.yp-ba-container').dataset.sliderInit).toBe('1');
    } finally {
      frames.restore();
    }
  });

  // ---- comments panel layout ------------------------------------------------

  const settingsShell = () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div class="yp-settings-shell">
        <div class="yp-settings-panel"></div>
        <div class="yp-settings-content"></div>
      </div>
    `
    );
  };

  test('a wide shell docks the comments panel beside the settings', async () => {
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    settingsShell();
    const { openCommentsModal } = boot();

    await openCommentsModal('f-1', 'Feature One');

    const panel = document.getElementById('yp-comments-panel');
    expect(panel.style.width).toBe('380px');
    expect(panel.style.left).not.toBe('');
    expect(document.querySelector('.yp-settings-shell').style.transform).toMatch(/translateX\(/);
  });

  test('the classic variant stacks the panel over the settings content', async () => {
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    document.documentElement.setAttribute('data-yp-variant', 'classic');
    settingsShell();
    const { openCommentsModal } = boot();

    await openCommentsModal('f-1', 'Feature One');

    const panel = document.getElementById('yp-comments-panel');
    expect(Number.parseInt(panel.style.width, 10)).toBeGreaterThanOrEqual(300);
    // The docked shell transform is cleared when the layout goes inline.
    expect(document.querySelector('.yp-settings-shell').style.transform).toBe('');
  });

  test('a narrow shell without a settings panel leaves the panel unpositioned', async () => {
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    const { openCommentsModal } = boot();

    await openCommentsModal('f-1', 'Feature One');

    const panel = document.getElementById('yp-comments-panel');
    expect(panel.classList.contains('open')).toBe(true);
    expect(panel.style.left).toBe('');
  });
});
