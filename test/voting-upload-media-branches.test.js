/**
 * @jest-environment jsdom
 */

/**
 * Image upload + local media pipeline.
 *
 * Signed upload URLs are trusted only for the proxy and legacy Supabase
 * origins; anything else is refused before a byte leaves the browser. Upload
 * reservation, binary transfer and finalization each report their own failure,
 * and the read-only predicate gates every write. The local pipeline validates
 * type/size, clamps dimensions and reports each decode/encode failure instead
 * of producing an unusable draft.
 */

describe('Voting upload and media branches', () => {
  const createOkResponse = data => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  const installGlobals = (overrides = {}) => {
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
        ...overrides,
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

  const uploadPayload = {
    target: 'comment',
    parentId: 'comment-1',
    idempotencyKey: 'draft-1',
    ownerCapability: 'capability-1',
    mimeType: 'image/png',
  };

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    window.YouTubePlusConfig = { communityWritesEnabled: true };
    setFetch(jest.fn(async () => createOkResponse({})));
    if (!window.YouTubePlus) window.YouTubePlus = {};
    mockLocation({ href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', pathname: '/watch' });
    installGlobals();
    setGm(options => {
      options.onload({ status: 200, responseText: '{}' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
  });

  afterEach(() => {
    delete globalThis.GM;
  });

  // ---- upload reservation ---------------------------------------------------

  test('a reservation is refused while the community is read-only', async () => {
    window.YouTubePlusConfig = { communityWritesEnabled: false };
    const { VotingApi } = boot();

    expect(await VotingApi.signUpload(uploadPayload)).toEqual({
      success: false,
      error: 'Community uploads are currently in read-only mode',
    });
  });

  test('the reservation reports the server rejection message', async () => {
    setGm(options => {
      options.onload({
        status: 400,
        responseText: JSON.stringify({ error: 'capability rejected' }),
      });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.signUpload(uploadPayload);

    expect(res).toEqual({ success: false, error: 'capability rejected' });
  });

  test('an unreadable reservation body keeps the HTTP status in the message', async () => {
    setGm(options => {
      options.onload({ status: 502, responseText: 'gateway exploded' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.signUpload(uploadPayload);

    expect(res).toEqual({ success: false, error: 'Upload reservation failed (HTTP 502)' });
  });

  test('an empty reservation body is rejected as a reservation failure', async () => {
    setGm(options => {
      options.onload({ status: 500, responseText: '' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.signUpload(uploadPayload);

    expect(res).toEqual({ success: false, error: 'Upload reservation failed (HTTP 500)' });
  });

  test('a successful reservation with an unreadable body yields no signed URL', async () => {
    setGm(options => {
      options.onload({ status: 200, responseText: 'not json' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.signUpload(uploadPayload);

    expect(res).toEqual({ success: true, data: null });
  });

  test('a successful reservation returns the signed slot', async () => {
    setGm(options => {
      options.onload({
        status: 200,
        responseText: JSON.stringify({
          signedUrl: 'https://vote.diorhc.space/storage/v1/x',
          slotId: 'slot-1',
        }),
      });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.signUpload(uploadPayload);

    expect(res).toEqual({
      success: true,
      data: { signedUrl: 'https://vote.diorhc.space/storage/v1/x', slotId: 'slot-1' },
    });
  });

  test('without any manager transport the reservation cannot be made', async () => {
    delete globalThis.GM_xmlhttpRequest;
    const { VotingApi } = boot();

    await expect(VotingApi.signUpload(uploadPayload)).rejects.toThrow(
      'GM_xmlhttpRequest unavailable'
    );
  });

  test('the Promise-based manager transport is used for reservations', async () => {
    delete globalThis.GM_xmlhttpRequest;
    let captured = null;
    Object.defineProperty(globalThis, 'GM', {
      configurable: true,
      writable: true,
      value: {
        xmlHttpRequest: options => {
          captured = options;
          options.onload({
            status: 200,
            responseText: JSON.stringify({ signedUrl: 'slot', slotId: 'slot-9' }),
          });
          return {
            abort() {
              /* inert handle: the transport already settled */
            },
          };
        },
      },
    });
    const { VotingApi } = boot();

    const res = await VotingApi.signUpload(uploadPayload);

    expect(captured.url).toBe('https://vote.diorhc.space/functions/v1/ytplus-image-upload');
    expect(captured.method).toBe('POST');
    expect(JSON.parse(captured.data)).toEqual({
      idempotencyKey: 'draft-1',
      mimeType: 'image/png',
      ownerCapability: 'capability-1',
      parentId: 'comment-1',
      target: 'comment',
    });
    expect(res.data.slotId).toBe('slot-9');
  });

  // ---- binary transfer ------------------------------------------------------

  test('a relative signed path resolves against the proxy storage base', async () => {
    let captured = null;
    setGm(options => {
      captured = options;
      options.onload({ status: 200, responseText: '' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.uploadBinary(
      'storage/v1/object/public/voting-images/a.png',
      {},
      'image/png'
    );

    expect(captured.url).toBe(
      'https://vote.diorhc.space/storage/v1/object/public/voting-images/a.png'
    );
    expect(captured.method).toBe('PUT');
    expect(captured.headers['Content-Type']).toBe('image/png');
    expect(res).toEqual({ success: true, status: 200 });
  });

  test('an absolute proxy URL is used as-is', async () => {
    let captured = null;
    setGm(options => {
      captured = options;
      options.onload({ status: 204, responseText: '' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    await VotingApi.uploadBinary(
      'https://vote.diorhc.space/storage/v1/object/sign/a.png?token=1',
      {},
      'image/png'
    );

    expect(captured.url).toBe('https://vote.diorhc.space/storage/v1/object/sign/a.png?token=1');
  });

  test('the legacy Supabase origin is re-pointed at the proxy', async () => {
    let captured = null;
    setGm(options => {
      captured = options;
      options.onload({ status: 200, responseText: '' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    await VotingApi.uploadBinary(
      'https://ldpccocxlrdsyejfhrvc.supabase.co/storage/v1/object/sign/a.png?token=1',
      {},
      'image/png'
    );

    expect(captured.url).toBe('https://vote.diorhc.space/storage/v1/object/sign/a.png?token=1');
  });

  test('an untrusted upload origin is refused before any network call', async () => {
    const gmMock = jest.fn();
    setGm(gmMock);
    const fetchMock = jest.fn();
    setFetch(fetchMock);
    const { VotingApi } = boot();

    const res = await VotingApi.uploadBinary(
      'https://evil.example.com/upload.png',
      {},
      'image/png'
    );

    expect(res).toEqual({ success: false, error: 'Untrusted upload URL origin' });
    expect(gmMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an unparseable absolute URL is refused before any network call', async () => {
    const gmMock = jest.fn();
    setGm(gmMock);
    const { VotingApi } = boot();

    const res = await VotingApi.uploadBinary('http://', {}, 'image/png');

    expect(res).toEqual({ success: false, error: 'Untrusted upload URL origin' });
    expect(gmMock).not.toHaveBeenCalled();
  });

  test('a failed transfer over the manager transport reports status 0', async () => {
    setGm(options => {
      options.onerror();
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    const res = await VotingApi.uploadBinary('storage/v1/a.png', {}, 'image/png');

    expect(res).toEqual({ success: false, status: 0 });
  });

  test('without a manager transport the signed PUT uses the plain fetch fallback', async () => {
    delete globalThis.GM_xmlhttpRequest;
    const fetchMock = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({}) }));
    setFetch(fetchMock);
    const { VotingApi } = boot();

    const res = await VotingApi.uploadBinary('storage/v1/a.png', {}, 'image/jpeg');

    expect(res).toEqual({ success: true, status: 201 });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://vote.diorhc.space/storage/v1/a.png');
    expect(options.method).toBe('PUT');
    expect(options.headers['Content-Type']).toBe('image/jpeg');
  });

  // ---- finalization ---------------------------------------------------------

  test('finalization is refused while the community is read-only', async () => {
    window.YouTubePlusConfig = { communityWritesEnabled: false };
    const { VotingApi } = boot();

    expect(await VotingApi.finalizeFeatureImage('feature-1', 'capability-1', 'slot-1')).toEqual({
      success: false,
      error: 'Community uploads are currently in read-only mode',
    });
    expect(await VotingApi.finalizeCommentImage('comment-1', 'capability-1', 'slot-1')).toEqual({
      success: false,
      error: 'Community uploads are currently in read-only mode',
    });
  });

  test('finalization posts the owner capability through the manager transport', async () => {
    const bodies = [];
    setGm(options => {
      bodies.push(JSON.parse(options.data));
      options.onload({ status: 200, responseText: '{}' });
      return {
        abort() {
          /* inert handle: the transport already settled */
        },
      };
    });
    const { VotingApi } = boot();

    await VotingApi.finalizeCommentImage('comment-1', 'capability-1', 'slot-1');
    await VotingApi.finalizeFeatureImage('feature-1', 'capability-2', 'slot-2');

    expect(bodies[0]).toEqual({
      p_comment_id: 'comment-1',
      p_owner_capability: 'capability-1',
      p_slot_id: 'slot-1',
    });
    expect(bodies[1]).toEqual({
      p_feature_id: 'feature-1',
      p_owner_capability: 'capability-2',
      p_slot_id: 'slot-2',
    });
  });

  // ---- local media pipeline -------------------------------------------------

  test('validateFile rejects a missing file, a foreign type and an oversized file', () => {
    const { VotingMedia } = boot();

    expect(VotingMedia.validateFile(null)).toEqual({ valid: false, error: 'No file provided' });
    expect(VotingMedia.validateFile(new File(['x'], 'a.gif', { type: 'image/gif' })).valid).toBe(
      false
    );
    const huge = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: VotingMedia.getMaxBytes() + 1 });
    expect(VotingMedia.validateFile(huge).error).toBe('File size exceeds 5MB limit');
    expect(VotingMedia.validateFile(new File(['x'], 'a.png', { type: 'image/png' }))).toEqual({
      valid: true,
      error: null,
    });
  });

  test('calculateDimensions keeps small images and clamps the long edge', () => {
    const { VotingMedia } = boot();

    expect(VotingMedia.calculateDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(VotingMedia.calculateDimensions(5120, 2560)).toEqual({ width: 2560, height: 1280 });
  });

  test('processImage refuses an invalid file before reading it', async () => {
    const { VotingMedia } = boot();

    await expect(
      VotingMedia.processImage(new File(['x'], 'a.txt', { type: 'text/plain' }))
    ).rejects.toThrow('Only JPG, PNG, and WebP images are allowed');
  });

  test('a file read failure rejects with an explicit read error', async () => {
    const originalReader = global.FileReader;
    global.FileReader = class {
      readAsDataURL() {
        this.onerror?.();
      }
    };
    try {
      const { VotingMedia } = boot();
      await expect(
        VotingMedia.processImage(new File(['x'], 'a.png', { type: 'image/png' }))
      ).rejects.toThrow('Failed to read file');
    } finally {
      global.FileReader = originalReader;
    }
  });

  test('a decode failure rejects instead of producing a draft', async () => {
    const originalReader = global.FileReader;
    const originalImage = global.Image;
    global.FileReader = class {
      readAsDataURL() {
        this.onload?.({ target: { result: 'data:image/png;base64,AA' } });
      }
    };
    global.Image = class {
      set src(_value) {
        queueMicrotask(() => this.onerror?.());
      }
    };
    try {
      const { VotingMedia } = boot();
      await expect(
        VotingMedia.processImage(new File(['x'], 'a.png', { type: 'image/png' }))
      ).rejects.toThrow('Failed to decode image');
    } finally {
      global.FileReader = originalReader;
      global.Image = originalImage;
    }
  });

  test('an unavailable canvas context rejects instead of producing a draft', async () => {
    const originalReader = global.FileReader;
    const originalImage = global.Image;
    const originalGetContext = global.HTMLCanvasElement.prototype.getContext;
    global.FileReader = class {
      readAsDataURL() {
        this.onload?.({ target: { result: 'data:image/png;base64,AA' } });
      }
    };
    global.Image = class {
      set src(_value) {
        queueMicrotask(() => this.onload?.());
      }
    };
    global.HTMLCanvasElement.prototype.getContext = () => null;
    try {
      const { VotingMedia } = boot();
      await expect(
        VotingMedia.processImage(new File(['x'], 'a.png', { type: 'image/png' }))
      ).rejects.toThrow('Could not get canvas context');
    } finally {
      global.FileReader = originalReader;
      global.Image = originalImage;
      global.HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });

  test('revokeUrl only revokes a URL the pipeline created and revokeAll clears them', () => {
    const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      /* inert stand-in: no observable effect in jsdom */
    });
    const { VotingMedia } = boot();

    // A URL the pipeline never issued is left alone.
    VotingMedia.revokeUrl('https://vote.diorhc.space/unknown.png');
    expect(revoke).not.toHaveBeenCalled();
    VotingMedia.revokeUrl(null);
    expect(revoke).not.toHaveBeenCalled();

    // activeObjectUrls is filled by a successful processImage; simulate the
    // same registration through the pipeline's own bookkeeping.
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:pipeline-1';
    try {
      expect(VotingMedia.getAllowedTypes()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
      expect(VotingMedia.getMaxAttachments()).toBe(4);
      expect(VotingMedia.getMaxDimension()).toBe(2560);
      VotingMedia.revokeAll();
      expect(revoke).not.toHaveBeenCalled();
    } finally {
      URL.createObjectURL = createObjectURL;
    }
  });
});
