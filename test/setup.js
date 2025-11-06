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
// This works by using Object.defineProperty to avoid jsdom's navigation interception
global.mockLocation = locationConfig => {
  // Check if our mock is already installed (it has our custom methods)
  // @ts-ignore - checking for jest mock property
  const isOurMock =
    // @ts-ignore - checking for jest mock property
    window.location && typeof window.location.assign === 'function' && window.location.assign.mock;

  if (isOurMock) {
    // Our mock is already there, just update properties directly
    window.location.href = locationConfig.href || 'https://www.youtube.com/';
    window.location.hostname = locationConfig.hostname || 'www.youtube.com';
    window.location.pathname = locationConfig.pathname || '/';
    window.location.search = locationConfig.search !== undefined ? locationConfig.search : '';
    window.location.hash = locationConfig.hash !== undefined ? locationConfig.hash : '';
    // @ts-ignore - mocking read-only property
    window.location.origin = locationConfig.origin || 'https://www.youtube.com';
    window.location.protocol = locationConfig.protocol || 'https:';
    window.location.host = locationConfig.host || 'www.youtube.com';
    window.location.port = locationConfig.port !== undefined ? locationConfig.port : '';

    // Apply any additional properties
    Object.keys(locationConfig).forEach(key => {
      if (!(key in window.location) || locationConfig[key] !== undefined) {
        window.location[key] = locationConfig[key];
      }
    });
  } else {
    // First time setup - create the mock
    try {
      delete window.location;
    } catch (e) {
      // Can't delete, that's ok
    }

    const locationMock = {
      href: locationConfig.href || 'https://www.youtube.com/',
      hostname: locationConfig.hostname || 'www.youtube.com',
      pathname: locationConfig.pathname || '/',
      search: locationConfig.search !== undefined ? locationConfig.search : '',
      hash: locationConfig.hash !== undefined ? locationConfig.hash : '',
      origin: locationConfig.origin || 'https://www.youtube.com',
      protocol: locationConfig.protocol || 'https:',
      host: locationConfig.host || 'www.youtube.com',
      port: locationConfig.port !== undefined ? locationConfig.port : '',
      assign: jest.fn(),
      replace: jest.fn(),
      reload: jest.fn(),
      toString() {
        return this.href;
      },
    };

    // Apply any additional properties from config
    Object.keys(locationConfig).forEach(key => {
      if (!(key in locationMock)) {
        locationMock[key] = locationConfig[key];
      }
    });

    // Debug: log what we're setting
    if (process.env.DEBUG_LOCATION) {
      console.log('[mockLocation] Creating new mock with href:', locationMock.href);
    }

    try {
      Object.defineProperty(window, 'location', {
        value: locationMock,
        writable: true,
        configurable: true,
      });
    } catch (defError) {
      // Can't define - jsdom might have it locked
      // This shouldn't happen but just in case
      console.warn('Could not define location mock:', defError.message);
    }
  }
}; // Reset mocks before each test
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  jest.clearAllMocks();

  // Don't reset location here - let individual tests control it
});
