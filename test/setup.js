// Jest test setup file
// Global setup for all tests

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
  global.structuredClone = (obj, options) => {
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
      const clone = new DataView(global.structuredClone(obj.buffer), obj.byteOffset, obj.byteLength);
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

// Mock userscript globals
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

  // Don't reset location here - let individual tests control it
});
