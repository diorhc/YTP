// Jest test setup file
// Global setup for all tests

// Feature modules publish internal testHooks bags only when this flag is
// on (see U.exposeTestHooks); release pages never receive them.
window.__YTP_TEST_HOOKS__ = true;

const { TextEncoder, TextDecoder } = require('node:util');
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;

// Mock browser APIs
global.localStorage = {
  data: {},
  getItem(key) {
    return this.data[key] || null;
  },
  setItem(key, value) {
    this.data[key] = value;
  },
  removeItem(key) {
    delete this.data[key];
  },
  clear() {
    this.data = {};
  },
  // Storage shape helpers
  get length() {
    return Object.keys(this.data).length;
  },
  key(i) {
    return Object.keys(this.data)[i] || null;
  },
};

global.sessionStorage = {
  data: {},
  getItem(key) {
    return this.data[key] || null;
  },
  setItem(key, value) {
    this.data[key] = value;
  },
  removeItem(key) {
    delete this.data[key];
  },
  clear() {
    this.data = {};
  },
  get length() {
    return Object.keys(this.data).length;
  },
  key(i) {
    return Object.keys(this.data)[i] || null;
  },
};

// Ensure fetch is available (some jsdom/Node combos lack it)
if (typeof global.fetch !== 'function') {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: jest.fn(() =>
      Promise.resolve(
        /** @type {Response} */ ({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          redirected: false,
          type: 'default',
          url: '',
          body: null,
          bodyUsed: false,
          clone: () => /** @type {Response} */ ({}),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          blob: () => Promise.resolve(new Blob()),
          formData: () => Promise.resolve(new FormData()),
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(''),
        })
      )
    ),
  });
}

// Ensure structuredClone is available (Node < 17 / old jsdom)
if (typeof global.structuredClone !== 'function') {
  /**
   * @param {unknown} obj
   * @param {{ transfer?: unknown[] }} [options]
   * @returns {unknown}
   */
  global.structuredClone = (obj, _options) => {
    // Handle primitives and null
    if (obj === null || typeof obj !== 'object') return obj;

    // Handle Date
    if (obj instanceof Date) return new Date(obj.getTime());

    // Handle RegExp
    if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags);

    // Handle Map
    if (obj instanceof Map) {
      const clone = new Map();
      for (const [k, v] of obj) clone.set(global.structuredClone(k), global.structuredClone(v));
      return clone;
    }

    // Handle Set
    if (obj instanceof Set) {
      const clone = new Set();
      for (const v of obj) clone.add(global.structuredClone(v));
      return clone;
    }

    // Handle ArrayBuffer
    if (obj instanceof ArrayBuffer) {
      const clone = obj.slice(0);
      return clone;
    }

    // Handle TypedArrays
    if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
      const clone = new /** @type {typeof obj.constructor} */ (obj.constructor)(
        global.structuredClone(obj.buffer)
      );
      return clone;
    }

    // Handle DataView
    if (obj instanceof DataView) {
      const clone = new DataView(
        global.structuredClone(obj.buffer),
        obj.byteOffset,
        obj.byteLength
      );
      return clone;
    }

    // Handle plain objects and arrays
    if (Array.isArray(obj)) return obj.map(v => global.structuredClone(v));

    /** @type {Record<string, unknown>} */
    const clone = {};
    for (const key of Object.keys(obj)) {
      clone[key] = global.structuredClone(/** @type {Record<string, unknown>} */ (obj)[key]);
    }
    return clone;
  };
}

// Polyfill performance.mark/getEntriesByType/clearMarks for jsdom
if (typeof global.performance.mark !== 'function') {
  /** @type {PerformanceMark[]} */
  const _marks = [];
  global.performance.mark = /** @param {string} name */ name => {
    /** @type {PerformanceMark} */
    const entry = /** @type {PerformanceMark} */ ({
      name,
      entryType: 'mark',
      startTime: Date.now(),
      duration: 0,
      detail: null,
      toJSON: () => ({}),
    });
    _marks.push(entry);
    return entry;
  };
  global.performance.getEntriesByType =
    /** @param {string} type @returns {PerformanceEntryList} */ type =>
      type === 'mark' ? [..._marks] : [];
  global.performance.clearMarks = () => {
    _marks.length = 0;
  };
}

// Polyfill URL.createObjectURL and URL.revokeObjectURL for jsdom
if (typeof URL !== 'undefined') {
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = jest.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`);
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    URL.revokeObjectURL = jest.fn();
  }
}
// expose GM_xmlhttpRequest on both global and window to match how code references it
const gmMock = jest.fn();
Object.defineProperty(globalThis, 'GM_xmlhttpRequest', {
  configurable: true,
  writable: true,
  value: gmMock,
});
Object.defineProperty(window, 'GM_xmlhttpRequest', {
  configurable: true,
  writable: true,
  value: gmMock,
});
Object.defineProperty(globalThis, 'unsafeWindow', {
  configurable: true,
  writable: true,
  value: window,
});

// Polyfill AbortController for jsdom / older Node if missing.
if (typeof globalThis.AbortController === 'undefined') {
  class AbortSignalPolyfill {
    constructor() {
      this.aborted = false;
      /** @type {Set<Function>} */
      this._listeners = new Set();
    }
    addEventListener(type, listener) {
      if (type === 'abort') this._listeners.add(listener);
    }
    removeEventListener(type, listener) {
      if (type === 'abort') this._listeners.delete(listener);
    }
    dispatchEvent() {
      // no-op polyfill
    }
  }
  globalThis.AbortController = class AbortControllerPolyfill {
    constructor() {
      this.signal = new AbortSignalPolyfill();
    }
    abort() {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this.signal._listeners.forEach(listener => {
        try {
          listener();
        } catch (_e) {
          /* ignore */
        }
      });
    }
  };
}

// Install the real CleanupManager in every jsdom test file. Source modules now
// register listeners/observers/timers through it via optional chaining; without
// it those calls are silent no-ops and listeners never attach.
// cleanup-manager.test.js deletes the key in its own beforeEach and re-requires
// the module, so per-suite behavior is unaffected.
require('../src/cleanup-manager.js');

// Mock console methods for cleaner test output
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Helper function to mock window.location in jsdom
// Uses Object.defineProperty for strict-safe behavior

/**
 * @typedef {{ href?: string; hostname?: string; pathname?: string; search?: string; hash?: string; origin?: string; protocol?: string; host?: string; port?: string; [key: string]: unknown }} LocationConfig
 */

/** @param {LocationConfig} locationConfig */
const mockLocationFn = locationConfig => {
  const href = locationConfig.href || 'https://www.youtube.com/';
  let parsedUrl;
  try {
    parsedUrl = new URL(href);
  } catch {
    parsedUrl = new URL('https://www.youtube.com/');
  }

  /** @type {Record<string, unknown>} */
  const locationObj = {
    href: locationConfig.href || parsedUrl.href,
    hostname: locationConfig.hostname || parsedUrl.hostname,
    pathname: locationConfig.pathname || parsedUrl.pathname,
    search: locationConfig.search !== undefined ? locationConfig.search : parsedUrl.search,
    hash: locationConfig.hash !== undefined ? locationConfig.hash : parsedUrl.hash,
    origin: locationConfig.origin || parsedUrl.origin,
    protocol: locationConfig.protocol || parsedUrl.protocol,
    host: locationConfig.host || locationConfig.hostname || parsedUrl.host,
    port: locationConfig.port !== undefined ? locationConfig.port : parsedUrl.port,
    assign: jest.fn(),
    replace: jest.fn(),
    reload: jest.fn(),
    toString: () => locationConfig.href || parsedUrl.href,
  };

  // Apply any additional custom properties from locationConfig
  for (const key of Object.keys(locationConfig)) {
    if (locationConfig[key] !== undefined) {
      locationObj[key] = locationConfig[key];
    }
  }

  const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');

  // Prefer redefining when configurable; newer jsdom can expose non-configurable location.
  if (locationDescriptor?.configurable) {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: locationObj,
    });
    return;
  }

  // Fallback for non-configurable location: drive URL via History API.
  try {
    window.history.replaceState({}, '', String(locationObj.href || 'https://www.youtube.com/'));
  } catch {
    // ignore; some tests may run without history support
  }

  // Patch location methods where possible so tests can assert calls.
  const setLocationMethod = (/** @type {string} */ name, /** @type {any} */ value) => {
    try {
      Object.defineProperty(window.location, name, {
        configurable: true,
        writable: true,
        value,
      });
    } catch {
      // ignore; read-only properties are acceptable fallback
    }
  };

  setLocationMethod('assign', locationObj.assign);
  setLocationMethod('replace', locationObj.replace);
  setLocationMethod('reload', locationObj.reload);
  setLocationMethod('toString', locationObj.toString);
};

// Expose mockLocation on globalThis via defineProperty to avoid implicit-any global index
Object.defineProperty(globalThis, 'mockLocation', {
  configurable: true,
  writable: true,
  value: mockLocationFn,
});

// Reset mocks before each test
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  jest.clearAllMocks();

  // Voting.js routes community traffic through
  // GM_xmlhttpRequest when the manager provides it. Tests emulate the manager
  // by delegating GM requests to the (per-test mocked) global fetch, so
  // existing fetch mocks keep driving every suite. Tests that need a raw GM
  // mock (e.g. the secure-transport spy suite) override this in place.
  const gmTransport = /** @type {any} */ (globalThis).GM_xmlhttpRequest;
  if (typeof gmTransport?.mockImplementation === 'function') {
    gmTransport.mockImplementation(options => {
      const { method = 'GET', url, headers = {}, data, onload, onerror, onabort, signal } = options;
      let settled = false;
      globalThis
        .fetch(url, { method, headers, body: data, signal })
        .then(async res => {
          if (settled) return;
          settled = true;
          let text = '';
          try {
            if (typeof res.json === 'function') text = JSON.stringify(await res.json());
            else if (typeof res.text === 'function') text = await res.text();
          } catch (_e) {
            text = '';
          }
          onload?.({ status: res.status ?? 200, response: text, responseText: text });
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          (
            onerror ||
            onabort ||
            (() => {
              /* noop */
            })
          )?.();
        });
      return { abort: () => onabort?.() };
    });
  }

  // Minimal SettingsStore raw-IO shim so utils.storage (which now delegates to
  // the store boundary) behaves like plain localStorage when a test has not
  // installed the real store. Re-installed per test because the afterEach
  // cleanup below wipes every window.YouTubePlus* key.
  if (!window.YouTubePlusSettingsStore) {
    window.YouTubePlusSettingsStore = {
      readRaw: key => localStorage.getItem(key),
      writeRaw: (key, value) => {
        localStorage.setItem(key, value);
        return true;
      },
      // Standalone-key IO (outside the blob), same localStorage fallback the
      // real store uses when GM storage is unavailable.
      readGmKey: key => localStorage.getItem(key),
      writeGmKey: (key, value) => {
        localStorage.setItem(key, value);
        return true;
      },
      removeRaw: key => {
        localStorage.removeItem(key);
      },
      clearRaw: prefixes => {
        let removed = 0;
        const ls = window.localStorage;
        for (let i = 0; i < ls.length; i++) {
          const key = ls.key(i);
          if (key && prefixes.some(p => key.startsWith(p))) removed += 1;
        }
        for (const key of [...Array(ls.length)].map((_, i) => ls.key(i))) {
          if (key && prefixes.some(p => key.startsWith(p))) {
            ls.removeItem(key);
          }
        }
        return removed;
      },
    };
  }

  // Don't reset location here - let individual tests control it
});

// Isolate tests under --randomize: clear module cache and all YouTubePlus* /
// legacy facade keys so a leak in one suite cannot seed state in another.
// Mirrors the cleanup the audit (PR1) recommends; runs after every test.
afterEach(() => {
  jest.resetModules();

  // Drop every canonical facade (window.YouTubePlus<Feature>) and the legacy
  // aliases (YouTubeUtils, YouTubeStats, YouTubeMusic, YouTubeSafeDOM, …) so
  // the next suite starts from a clean window.
  // Object.keys() misses non-enumerable defineProperty assignments, so scan
  // a known allowlist plus any enumerable YouTubePlus* / youtubePlus* keys.
  const knownLegacyKeys = [
    'YouTubeUtils',
    'YouTubeSafeDOM',
    'YouTubeTrustedTypes',
    'YouTubeStats',
    'YouTubeMusic',
    'youtubeMusic',
    'youtubePlusEndscreen',
    '__ytpBasicInitDone__',
    '__ytp_history_wrapped',
  ];
  const enumerableKeys = Object.keys(window).filter(
    k => k.startsWith('YouTubePlus') || k.startsWith('youtubePlus') || knownLegacyKeys.includes(k)
  );
  // Non-enumerable legacy keys set via Object.defineProperty still need
  // explicit deletion; Object.keys() won't list them.
  const nonEnumerableKeys = knownLegacyKeys.filter(k => k in window && !enumerableKeys.includes(k));
  // NEVER delete the settings-store pair: facade-contract restores canonical+alias
  // from beforeAll capture and relies on identity (alias === canonical). The shim
  // installed by beforeEach when canonical is missing would otherwise replace the
  // real store between afterEach and the next beforeEach.
  // Same for the cleanup-manager pair: required once at the top of this file,
  // migrated src code registers every listener through it via optional chaining,
  // so wiping it silently no-ops all listener registration.
  const settingsStoreKeys = [
    'YouTubePlusSettingsStore',
    'youtubePlusSettingsStore',
    'YouTubePlusCleanupManager',
    'youtubePlusCleanupManager',
  ];
  const keysToDelete = [...enumerableKeys, ...nonEnumerableKeys].filter(
    k => !settingsStoreKeys.includes(k)
  );
  for (const k of keysToDelete) {
    try {
      delete window[k];
    } catch {
      // Some jsdom props are non-configurable; force via defineProperty.
      Object.defineProperty(window, k, {
        configurable: true,
        value: undefined,
        writable: true,
      });
    }
  }

  // Reset DOM so injected styles/nodes from one suite don't bleed into next.
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});
