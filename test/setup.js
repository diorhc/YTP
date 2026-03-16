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
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    })
  );
}

// Ensure structuredClone is available (Node < 17 / old jsdom)
if (typeof global.structuredClone !== 'function') {
  global.structuredClone = obj => JSON.parse(JSON.stringify(obj));
}

// Polyfill performance.mark/getEntriesByType/clearMarks for jsdom
if (typeof global.performance.mark !== 'function') {
  const _marks = [];
  global.performance.mark = name => _marks.push({ name, entryType: 'mark', startTime: Date.now() });
  global.performance.getEntriesByType = type => (type === 'mark' ? [..._marks] : []);
  global.performance.clearMarks = () => {
    _marks.length = 0;
  };
}

// Mock userscript globals
// expose GM_xmlhttpRequest on both global and window to match how code references it
global.GM_xmlhttpRequest = jest.fn();
global.window.GM_xmlhttpRequest = global.GM_xmlhttpRequest;
global.unsafeWindow = global.window;

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
// Uses delete + reassign pattern for reliable cross-platform behavior
global.mockLocation = locationConfig => {
  const href = locationConfig.href || 'https://www.youtube.com/';
  let parsedUrl;
  try {
    parsedUrl = new URL(href);
  } catch {
    parsedUrl = new URL('https://www.youtube.com/');
  }

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

  // Delete and recreate window.location (works in both jsdom versions)
  delete window.location;
  window.location = locationObj;
};

// Reset mocks before each test
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  jest.clearAllMocks();

  // Don't reset location here - let individual tests control it
});
