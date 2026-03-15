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
// Uses per-property Object.defineProperty since jsdom's window.location is non-configurable
global.mockLocation = locationConfig => {
  const props = {
    href: locationConfig.href || 'https://www.youtube.com/',
    hostname: locationConfig.hostname || 'www.youtube.com',
    pathname: locationConfig.pathname || '/',
    search: locationConfig.search !== undefined ? locationConfig.search : '',
    hash: locationConfig.hash !== undefined ? locationConfig.hash : '',
    origin: locationConfig.origin || 'https://www.youtube.com',
    protocol: locationConfig.protocol || 'https:',
    host: locationConfig.host || locationConfig.hostname || 'www.youtube.com',
    port: locationConfig.port !== undefined ? locationConfig.port : '',
  };

  // Define each property individually on the existing location object
  // Individual properties of jsdom's Location ARE configurable, even though
  // the location property on window is not
  for (const [key, value] of Object.entries(props)) {
    try {
      Object.defineProperty(window.location, key, {
        get: () => value,
        configurable: true,
      });
    } catch {
      // Fallback: direct assignment (works if our mock is already installed)
      try {
        window.location[key] = value;
      } catch {
        /* cannot set - ignore */
      }
    }
  }

  // Apply any additional custom properties
  Object.keys(locationConfig).forEach(key => {
    if (!(key in props) && locationConfig[key] !== undefined) {
      try {
        Object.defineProperty(window.location, key, {
          get: () => locationConfig[key],
          configurable: true,
        });
      } catch {
        /* ignore */
      }
    }
  });
}; // Reset mocks before each test
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  jest.clearAllMocks();

  // Don't reset location here - let individual tests control it
});
