/**
 * @jest-environment jsdom
 */

/**
 * Isolated owner-capability storage contract.
 *
 * The capability secret lives in the userscript manager's isolated GM
 * storage — never in origin localStorage. A one-time migration moves the
 * legacy plaintext copy: read → validate → write the SAME secret → verify
 * readable → only then drop the plaintext copy. A storage failure never
 * silently mints a new identity, so existing upload/vote ownership
 * survives. A new tab reads the same secret; page-origin storage contains
 * no capability.
 */

const OWNER_GM_KEY = 'ytp_owner_capability_secret';
const OWNER_LEGACY_KEY = 'ytp_owner_secret';
const LEGACY_SECRET = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij-_-'; // 43+ chars

const originalRaf = global.requestAnimationFrame;
const originalCaf = global.cancelAnimationFrame;

let registeredListeners = [];

function createOkResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function installBaseGlobals() {
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      byId: id => document.getElementById(id),
      $: (selector, root) => (root || document).querySelector(selector),
      t: key => key,
      createHTML: s => s,
      helpers: {
        byId: id => document.getElementById(id),
        $: (selector, root) => (root || document).querySelector(selector),
        t: key => key,
        createHTML: s => s,
        debounce: fn => fn,
        setTimeout_: (fn, ms) => setTimeout(fn, ms),
      },
      cleanupManager: {
        registerListener: (target, type, handler, opts) => {
          target?.addEventListener?.(type, handler, opts);
          registeredListeners.push({ target, type, handler, opts });
          return Symbol('listener-key');
        },
      },
      isSettingsModalOpen: jest.fn(() => false),
      createIsRelevantRoute: () => () => false,
      createWithErrorBoundary: () => fn => fn,
      isWatchRoute: jest.fn(() => true),
      isShortsRoute: jest.fn(() => false),
      isYouTubeDomain: jest.fn(() => true),
      isChannelRoute: jest.fn(() => false),
      logSuppressed: jest.fn(),
      whenRelevant: jest.fn(),
      onSectionActive: jest.fn(),
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
    value: jest.fn(async () => createOkResponse({ rows: [], hasMore: false })),
  });

  let rafCounter = 0;
  global.requestAnimationFrame = jest.fn(cb => {
    const id = ++rafCounter;
    Promise.resolve().then(() => cb?.(Date.now()));
    return id;
  });
  global.cancelAnimationFrame = jest.fn();
}

/** GM storage backed by a Map — simulates the manager's isolated store. */
function installGMStorage(store) {
  Object.defineProperty(globalThis, 'GM_getValue', {
    configurable: true,
    writable: true,
    value: jest.fn(key => (store.has(key) ? store.get(key) : undefined)),
  });
  Object.defineProperty(globalThis, 'GM_setValue', {
    configurable: true,
    writable: true,
    value: jest.fn((key, value) => {
      store.set(key, value);
    }),
  });
  Object.defineProperty(globalThis, 'GM_deleteValue', {
    configurable: true,
    writable: true,
    value: jest.fn(key => {
      store.delete(key);
    }),
  });
}

function installCryptoStub() {
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
}

function bootVoting() {
  jest.resetModules();
  require('../src/voting.js');
  return window.YouTubePlus.Voting;
}

/** Capture the p_secret sent by one RPC round trip. */
async function captureSecret(voting) {
  let body = null;
  const fetchMock = jest.fn(async (url, options = {}) => {
    if (String(url).includes('get_my_votes')) {
      body = JSON.parse(String(options.body || '{}'));
      return createOkResponse([]);
    }
    return createOkResponse({ rows: [], hasMore: false });
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
  await voting.VotingApi.getMyVotes();
  return body;
}

describe('isolated owner-capability storage', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    installCryptoStub();
    if (!window.YouTubePlus) window.YouTubePlus = {};
    globalThis.mockLocation({
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
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCaf;
    delete globalThis.GM_getValue;
    delete globalThis.GM_setValue;
    delete globalThis.GM_deleteValue;
  });

  test('migration: the legacy secret moves to GM storage, keeps ownership, and the plaintext copy is dropped', async () => {
    const gmStore = new Map();
    installGMStorage(gmStore);
    localStorage.setItem(OWNER_LEGACY_KEY, LEGACY_SECRET);

    const voting = bootVoting();
    const body = await captureSecret(voting);

    // The SAME identity is preserved — the legacy value is what was sent.
    expect(body.p_secret).toBe(LEGACY_SECRET);
    // The isolated GM storage now holds it; origin localStorage does not.
    expect(gmStore.get(OWNER_GM_KEY)).toBe(LEGACY_SECRET);
    expect(localStorage.getItem(OWNER_LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(OWNER_GM_KEY)).toBeNull();
  });

  test('a new tab reads the same secret from GM storage (no regeneration)', async () => {
    const gmStore = new Map();
    installGMStorage(gmStore);

    const first = bootVoting();
    const firstBody = await captureSecret(first);
    expect(typeof firstBody.p_secret).toBe('string');

    // Simulate a new tab: a fresh module instance, same manager storage.
    const second = bootVoting();
    const secondBody = await captureSecret(second);
    expect(secondBody.p_secret).toBe(firstBody.p_secret);
  });

  test('two concurrent getMyVotes() on empty storage share ONE owner secret', async () => {
    const gmStore = new Map();
    installGMStorage(gmStore);

    // Simulate real entropy: the deterministic stub masks the race because
    // every generation yields identical bytes. Each call must differ.
    let generation = 0;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: arr => {
          generation += 1;
          for (let i = 0; i < arr.length; i++) {
            arr[i] = (i * 31 + generation * 7919) % 256;
          }
          return arr;
        },
      },
    });

    const voting = bootVoting();
    const secrets = [];
    const fetchMock = jest.fn(async (url, options = {}) => {
      if (String(url).includes('get_my_votes')) {
        secrets.push(JSON.parse(String(options.body || '{}')).p_secret);
        return createOkResponse([]);
      }
      return createOkResponse({ rows: [], hasMore: false });
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    await Promise.all([voting.VotingApi.getMyVotes(), voting.VotingApi.getMyVotes()]);

    expect(secrets.length).toBe(2);
    expect(secrets[0]).toBeTruthy();
    // The race sent two DIFFERENT secrets before the fix — the first
    // RPC's secret was lost forever.
    expect(secrets[1]).toBe(secrets[0]);
    // The shared secret is exactly what lives in GM storage.
    expect(gmStore.get(OWNER_GM_KEY)).toBe(secrets[0]);
  });

  test('a failed generation resets the memoized promise so a later action can retry', async () => {
    const gmStore = new Map();
    installGMStorage(gmStore);

    // Break the crypto host: generation throws, getOwnerSecret returns null.
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    });

    const voting = bootVoting();
    await voting.VotingApi.getMyVotes(); // first attempt: generation fails, null secret

    // Restore a working crypto host; the retry must re-attempt generation
    // instead of serving the memoized failure.
    installCryptoStub();
    const body = await captureSecret(voting);
    expect(typeof body.p_secret).toBe('string');
    expect(gmStore.get(OWNER_GM_KEY)).toBe(body.p_secret);
  });

  test('fresh install without GM storage keeps the historical settings-store path', async () => {
    const voting = bootVoting();
    const body = await captureSecret(voting);

    expect(typeof body.p_secret).toBe('string');
    // No isolated storage → the identity persists in the settings store.
    expect(localStorage.getItem(OWNER_LEGACY_KEY)).toBe(body.p_secret);
  });

  test('a failing GM write never silently mints a new identity', async () => {
    Object.defineProperty(globalThis, 'GM_getValue', {
      configurable: true,
      writable: true,
      value: jest.fn(() => {
        throw new Error('storage quota');
      }),
    });
    Object.defineProperty(globalThis, 'GM_setValue', {
      configurable: true,
      writable: true,
      value: jest.fn(() => {
        throw new Error('storage quota');
      }),
    });
    localStorage.setItem(OWNER_LEGACY_KEY, LEGACY_SECRET);

    const voting = bootVoting();
    const body = await captureSecret(voting);

    // The legacy identity is still in force and NOT deleted.
    expect(body.p_secret).toBe(LEGACY_SECRET);
    expect(localStorage.getItem(OWNER_LEGACY_KEY)).toBe(LEGACY_SECRET);
  });

  test('page-origin localStorage contains no capability after migration', async () => {
    const gmStore = new Map();
    installGMStorage(gmStore);
    localStorage.setItem(OWNER_LEGACY_KEY, LEGACY_SECRET);

    const voting = bootVoting();
    await captureSecret(voting);

    const rawKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      rawKeys.push(localStorage.key(i));
    }
    expect(rawKeys).not.toContain(OWNER_LEGACY_KEY);
    expect(rawKeys).not.toContain(OWNER_GM_KEY);
    for (const k of rawKeys) {
      expect(String(localStorage.getItem(k))).not.toContain(LEGACY_SECRET);
    }
  });
});
