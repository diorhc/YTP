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

// Reset mocks before each test
beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    jest.clearAllMocks();
});
