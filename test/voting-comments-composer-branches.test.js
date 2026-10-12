/**
 * @jest-environment jsdom
 */

/**
 * Comments panel and attachment composer.
 *
 * The panel distinguishes "no comments" from "comments unavailable" and always
 * offers a way forward; comment attachments open the shared gallery. The
 * composer reflects content state on its submit button, accepts attachments
 * from the file picker, drag and drop and paste, enforces the attachment cap,
 * and keeps a partial upload recoverable with Retry instead of losing the
 * posted comment.
 */

describe('Voting comments panel and composer branches', () => {
  /** Listeners registered by the module under test, released after each test. */
  let registeredListeners = [];
  const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
  };

  const createOkResponse = data => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

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
            registeredListeners.push({ target, type, handler, opts });
            return Symbol('listener');
          },
          unregisterListener: key => {
            const entry = registeredListeners.find(e => e.key === key);
            if (!entry) return;
            entry.target?.removeEventListener?.(entry.type, entry.handler, entry.opts);
          },
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

  const delegatedFetch = () => {
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

  const rpcBodies = (mock, name) =>
    mock.mock.calls
      .map(([url, options]) => ({
        url: String(url),
        body: options?.body ? JSON.parse(options.body) : null,
      }))
      .filter(call => call.url.includes(name))
      .map(call => call.body);

  const stubWorkingCanvas = () => {
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
      .mockImplementation(function (cb) {
        cb(new window.Blob(['image-bytes'], { type: 'image/png' }));
      });
    const originalImage = global.Image;
    global.Image = class {
      constructor() {
        this.naturalWidth = 3200;
        this.naturalHeight = 1600;
      }
      set src(_value) {
        queueMicrotask(() => this.onload?.());
      }
    };
    return {
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
    delegatedFetch();
  });

  afterEach(() => {
    for (const { target, type, handler, opts } of registeredListeners) {
      try {
        target?.removeEventListener?.(type, handler, opts);
      } catch (_e) {
        // a detached node throws on some jsdom versions; the entry is dropped anyway
      }
    }
    registeredListeners = [];
  });

  // ---- panel states ---------------------------------------------------------

  test('an empty feature shows the empty state, not an error', async () => {
    setFetch(
      jest.fn(async url =>
        String(url).includes('get_feature_comments') ? createOkResponse([]) : createOkResponse([])
      )
    );
    const { openCommentsModal } = boot();

    await openCommentsModal('f-1', 'Feature One');

    const list = document.getElementById('yp-comments-list');
    expect(list.querySelector('.yp-comments-empty')).not.toBeNull();
    expect(list.querySelector('.yp-comments-error')).toBeNull();
    expect(document.getElementById('yp-comments-feature-title').textContent).toBe(' · Feature One');
    expect(document.getElementById('yp-comments-panel').classList.contains('open')).toBe(true);
  });

  test('a failed comments load is unavailable with Retry, and Retry recovers', async () => {
    let commentCalls = 0;
    const fetchMock = jest.fn(async url => {
      if (String(url).includes('get_feature_comments')) {
        commentCalls += 1;
        if (commentCalls === 1)
          return { ok: false, status: 500, json: async () => ({ message: 'down' }) };
        return createOkResponse([
          {
            id: 'c-1',
            feature_id: 'f-1',
            comment: 'Back online',
            created_at: '2026-01-01T00:00:00Z',
          },
        ]);
      }
      return createOkResponse([]);
    });
    setFetch(fetchMock);
    const { openCommentsModal } = boot();

    await openCommentsModal('f-1', 'Feature One');

    const list = document.getElementById('yp-comments-list');
    expect(list.querySelector('.yp-comments-error')).not.toBeNull();
    // "unavailable", never an empty list that reads as "no comments".
    expect(list.querySelector('.yp-comments-empty-text').textContent).toContain('unavailable');

    list.querySelector('.yp-comments-retry').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(commentCalls).toBe(2);
    expect(list.querySelector('.yp-comment-body').textContent).toBe('Back online');
  });

  test('comment attachments render a strip that opens the gallery', async () => {
    setFetch(
      jest.fn(async url => {
        const target = String(url);
        if (target.includes('get_feature_comments')) {
          return createOkResponse([
            { id: 'c-1', feature_id: 'f-1', comment: 'Look', created_at: '2026-01-01' },
          ]);
        }
        if (target.includes('get_comment_images')) {
          return createOkResponse([
            { comment_id: 'c-1', storage_path: 'voting-images/a.png' },
            { comment_id: 'c-1', storage_path: 'voting-images/b.png' },
          ]);
        }
        return createOkResponse([]);
      })
    );
    const { openCommentsModal, VotingGallery } = boot();

    await openCommentsModal('f-1', 'Feature One');

    const thumbs = document.querySelectorAll('.yp-comment-thumb');
    expect(thumbs.length).toBe(2);
    expect(document.querySelector('.yp-comment-footer').textContent.length).toBeGreaterThan(0);

    thumbs[1].click();
    expect(VotingGallery.isOpen()).toBe(true);
    expect(VotingGallery.items.map(i => i.url)).toEqual([
      'https://vote.diorhc.space/storage/v1/object/public/voting-images/voting-images/a.png',
      'https://vote.diorhc.space/storage/v1/object/public/voting-images/voting-images/b.png',
    ]);
    expect(VotingGallery.currentIndex).toBe(1);
  });

  test('the composer is replaced by a read-only notice in protective mode', async () => {
    window.YouTubePlusConfig = { communityWritesEnabled: false };
    setFetch(jest.fn(async () => createOkResponse([])));
    const { openCommentsModal } = boot();

    await openCommentsModal('f-1', 'Feature One');

    const composer = document.getElementById('yp-comment-composer');
    expect(composer.querySelector('.yp-voting-readonly-banner')).not.toBeNull();
    expect(document.getElementById('yp-comments-input')).toBeNull();
  });

  test('the close button, Escape and the navigation event all dismiss the panel', async () => {
    setFetch(jest.fn(async () => createOkResponse([])));
    const { openCommentsModal } = boot();
    await openCommentsModal('f-1', 'Feature One');
    const panel = document.getElementById('yp-comments-panel');

    document.getElementById('yp-comments-close').click();
    expect(panel.classList.contains('open')).toBe(false);

    await openCommentsModal('f-1', 'Feature One');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.classList.contains('open')).toBe(false);

    // A key that is not Escape never closes the panel.
    await openCommentsModal('f-1', 'Feature One');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }));
    expect(panel.classList.contains('open')).toBe(true);

    window.dispatchEvent(new window.Event('yt-navigate-start'));
    expect(panel.classList.contains('open')).toBe(false);
  });

  // ---- composer state -------------------------------------------------------

  test('typing enables the submit button and Enter posts the comment', async () => {
    const fetchMock = jest.fn(async url => {
      if (String(url).includes('rpc/submit_comment')) {
        return createOkResponse({
          id: 'c-9',
          featureId: 'f-1',
          comment: 'Nice',
          createdAt: '2026-01-01',
        });
      }
      return createOkResponse([]);
    });
    setFetch(fetchMock);
    const { openCommentsModal } = boot();
    await openCommentsModal('f-1', 'Feature One');

    const textarea = document.getElementById('yp-comments-input');
    const submit = document.getElementById('yp-comments-submit');
    expect(submit.classList.contains('active')).toBe(false);
    expect(submit.getAttribute('aria-disabled')).toBe('true');

    textarea.value = 'Nice';
    textarea.dispatchEvent(new window.Event('input'));
    expect(submit.classList.contains('active')).toBe(true);
    expect(submit.getAttribute('aria-disabled')).toBe('false');

    textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(rpcBodies(fetchMock, 'submit_comment')).toHaveLength(1);
    expect(rpcBodies(fetchMock, 'submit_comment')[0].p_comment).toBe('Nice');
    expect(textarea.value).toBe('');
    expect(submit.classList.contains('active')).toBe(false);
    expect(document.getElementById('yp-comment-status').textContent).toContain('Comment posted');
  });

  test('Shift+Enter inserts a newline instead of submitting', async () => {
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    const { openCommentsModal } = boot();
    await openCommentsModal('f-1', 'Feature One');
    const textarea = document.getElementById('yp-comments-input');

    textarea.value = 'line';
    textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(rpcBodies(fetchMock, 'submit_comment')).toHaveLength(0);
    expect(textarea.value).toBe('line');
  });

  test('an empty comment is refused without a request', async () => {
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    const { openCommentsModal } = boot();
    await openCommentsModal('f-1', 'Feature One');

    document.getElementById('yp-comments-submit').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(rpcBodies(fetchMock, 'submit_comment')).toHaveLength(0);
    expect(document.getElementById('yp-comment-status').textContent).toBe('Please write a comment');
  });

  test('a rejected comment shows the server error and re-enables submit', async () => {
    const fetchMock = jest.fn(async url => {
      if (String(url).includes('rpc/submit_comment')) {
        return { ok: false, status: 400, json: async () => ({ message: 'duplicate comment' }) };
      }
      return createOkResponse([]);
    });
    setFetch(fetchMock);
    const { openCommentsModal } = boot();
    await openCommentsModal('f-1', 'Feature One');

    const textarea = document.getElementById('yp-comments-input');
    const submit = document.getElementById('yp-comments-submit');
    textarea.value = 'Nice';
    submit.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('yp-comment-status').textContent).toBe('duplicate comment');
    expect(submit.disabled).toBe(false);
    expect(textarea.value).toBe('Nice');
  });

  // ---- attachments ----------------------------------------------------------

  test('a draft attachment renders in the strip and can be removed again', () => {
    const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      /* inert stand-in: no observable effect in jsdom */
    });
    const { openCommentsModal, addCommentDraft } = boot();
    setFetch(jest.fn(async () => createOkResponse([])));

    return openCommentsModal('f-1', 'Feature One').then(() => {
      addCommentDraft({
        draftId: 'd-1',
        previewUrl: 'blob:one',
        mimeType: 'image/png',
        status: 'pending',
      });
      addCommentDraft({
        draftId: 'd-2',
        previewUrl: 'blob:two',
        mimeType: 'image/png',
        status: 'error',
      });

      const strip = document.getElementById('yp-attachment-strip');
      expect(strip.style.display).toBe('flex');
      expect(strip.querySelectorAll('.yp-attachment-item').length).toBe(2);
      // A failed draft is visibly marked as failed.
      expect(strip.querySelectorAll('.yp-attachment-item.error').length).toBe(1);
      expect(document.getElementById('yp-attachment-count').textContent).toBe('(2/4)');
      // An attachment alone enables submit.
      expect(document.getElementById('yp-comments-submit').classList.contains('active')).toBe(true);

      strip.querySelectorAll('.yp-attachment-remove')[0].click();
      expect(document.getElementById('yp-attachment-count').textContent).toBe('(1/4)');
      // Only URLs the pipeline created are revoked; these drafts were
      // injected directly, so the browser owns them.
      expect(revoke).not.toHaveBeenCalled();

      strip.querySelectorAll('.yp-attachment-remove')[0].click();
      expect(document.getElementById('yp-attachment-strip').style.display).toBe('none');
    });
  });

  test('the file picker, drag and drop and paste all add an attachment', async () => {
    const canvas = stubWorkingCanvas();
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    const { openCommentsModal } = boot();
    try {
      await openCommentsModal('f-1', 'Feature One');
      const composer = document.getElementById('yp-comment-composer');
      const fileInput = document.getElementById('yp-comment-file-input');
      const picker = jest.spyOn(fileInput, 'click').mockImplementation(() => {
        /* inert stand-in: no observable effect in jsdom */
      });

      document.getElementById('yp-comment-add-photo-btn').click();
      expect(picker).toHaveBeenCalled();

      const file = new window.File(['bytes'], 'photo.png', { type: 'image/png' });
      Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
      fileInput.dispatchEvent(new window.Event('change'));
      await flush();
      expect(document.getElementById('yp-attachment-count').textContent).toBe('(1/4)');

      composer.dispatchEvent(new window.Event('dragover', { cancelable: true }));
      expect(composer.classList.contains('dragover')).toBe(true);
      composer.dispatchEvent(new window.Event('dragleave'));
      expect(composer.classList.contains('dragover')).toBe(false);

      const drop = new window.Event('drop', { cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', {
        value: { files: [new window.File(['bytes'], 'dropped.png', { type: 'image/png' })] },
      });
      composer.dispatchEvent(drop);
      await flush();
      expect(document.getElementById('yp-attachment-count').textContent).toBe('(2/4)');

      const paste = new window.Event('paste');
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          items: [
            { type: 'text/plain', getAsFile: () => null },
            {
              type: 'image/png',
              getAsFile: () => new window.File(['x'], 'pasted.png', { type: 'image/png' }),
            },
          ],
        },
      });
      composer.dispatchEvent(paste);
      await flush();
      expect(document.getElementById('yp-attachment-count').textContent).toBe('(3/4)');

      // A paste without clipboard data is inert.
      composer.dispatchEvent(new window.Event('paste'));
      await flush();
      expect(document.getElementById('yp-attachment-count').textContent).toBe('(3/4)');
    } finally {
      canvas.restore();
    }
  });

  test('the attachment cap is enforced and a bad file reports its own error', async () => {
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    const { openCommentsModal, addCommentDraft } = boot();
    await openCommentsModal('f-1', 'Feature One');

    for (let i = 0; i < 4; i++) {
      addCommentDraft({
        draftId: `d-${i}`,
        previewUrl: `blob:${i}`,
        mimeType: 'image/png',
        status: 'pending',
      });
    }
    const addBtn = document.getElementById('yp-comment-add-photo-btn');
    expect(addBtn.disabled).toBe(true);

    const fileInput = document.getElementById('yp-comment-file-input');
    Object.defineProperty(fileInput, 'files', {
      value: [new window.File(['x'], 'extra.png', { type: 'image/png' })],
      configurable: true,
    });
    fileInput.dispatchEvent(new window.Event('change'));
    await flush();

    expect(document.getElementById('yp-attachment-count').textContent).toBe('(4/4)');
    expect(document.getElementById('yp-comment-status').textContent).toBe(
      'Maximum 4 images allowed'
    );
  });

  test('an unusable attachment reports the pipeline error and leaves the others alone', async () => {
    const fetchMock = jest.fn(async () => createOkResponse([]));
    setFetch(fetchMock);
    const { openCommentsModal } = boot();
    await openCommentsModal('f-1', 'Feature One');

    const fileInput = document.getElementById('yp-comment-file-input');
    Object.defineProperty(fileInput, 'files', {
      value: [new window.File(['x'], 'notes.txt', { type: 'text/plain' })],
      configurable: true,
    });
    fileInput.dispatchEvent(new window.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('yp-comment-status').textContent).toBe(
      'Only JPG, PNG, and WebP images are allowed'
    );
    expect(document.getElementById('yp-attachment-count').textContent).toBe('(0/4)');
  });

  test('a failed attachment upload keeps the posted comment and offers Retry', async () => {
    const fetchMock = jest.fn(async url => {
      const target = String(url);
      if (target.includes('rpc/submit_comment')) {
        return createOkResponse({
          id: 'c-7',
          featureId: 'f-1',
          comment: 'Nice',
          ownerCapability: 'cap',
        });
      }
      if (target.includes('functions/v1/ytplus-image-upload')) {
        return { ok: false, status: 409, json: async () => ({ error: 'slot taken' }) };
      }
      if (target.includes('get_feature_comments')) {
        return createOkResponse([
          { id: 'c-7', feature_id: 'f-1', comment: 'Nice', created_at: '2026-01-01' },
        ]);
      }
      return createOkResponse([]);
    });
    setFetch(fetchMock);
    const { openCommentsModal, addCommentDraft } = boot();
    await openCommentsModal('f-1', 'Feature One');
    addCommentDraft({
      draftId: 'd-1',
      previewUrl: 'blob:one',
      mimeType: 'image/png',
      status: 'pending',
    });

    const textarea = document.getElementById('yp-comments-input');
    textarea.value = 'Nice';
    document.getElementById('yp-comments-submit').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const status = document.getElementById('yp-comment-status');
    expect(status.textContent).toContain('Comment posted, but some photos failed');
    // The comment itself exists — the retry only re-runs the upload.
    expect(rpcBodies(fetchMock, 'submit_comment')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('ytplus-image-upload'))).toBe(
      true
    );

    document.getElementById('yp-retry-upload').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(rpcBodies(fetchMock, 'submit_comment')).toHaveLength(1);
  });

  test('the success notice clears itself after a few seconds', async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.fn(async url => {
        if (String(url).includes('rpc/submit_comment')) {
          return createOkResponse({
            id: 'c-3',
            featureId: 'f-1',
            comment: 'Hi',
            createdAt: '2026-01-01',
          });
        }
        return createOkResponse([]);
      });
      setFetch(fetchMock);
      const { openCommentsModal } = boot();
      await openCommentsModal('f-1', 'Feature One');

      const textarea = document.getElementById('yp-comments-input');
      textarea.value = 'Hi';
      document.getElementById('yp-comments-submit').click();
      await jest.advanceTimersByTimeAsync(0);

      const status = document.getElementById('yp-comment-status');
      expect(status.textContent).toBe('Comment posted!');
      await jest.advanceTimersByTimeAsync(3000);
      expect(status.textContent).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });
});
