/**
 * Integration tests for constants.js module
 * Tests the actual constants file to ensure proper exports
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Constants Module', () => {
  let constants;
  let windowMock;

  beforeEach(() => {
    // Create a fresh window mock for each test
    windowMock = {};

    // Read and execute the constants.js file
    const constantsPath = path.join(__dirname, '../src/constants.js');
    const constantsCode = fs.readFileSync(constantsPath, 'utf8');

    // Create a sandbox with window mock
    const sandbox = {
      window: windowMock,
      console: console,
    };

    // Execute the code in the sandbox
    vm.createContext(sandbox);
    vm.runInContext(constantsCode, sandbox);

    constants = windowMock.YouTubePlusConstants;
  });

  describe('Module Initialization', () => {
    test('should export YouTubePlusConstants to window', () => {
      expect(constants).toBeDefined();
      expect(typeof constants).toBe('object');
    });

    test('should have all required constant groups', () => {
      expect(constants).toHaveProperty('MODULE_NAMES');
      expect(constants).toHaveProperty('DOWNLOAD_SITES');
      expect(constants).toHaveProperty('SVG_NS');
      expect(constants).toHaveProperty('SELECTORS');
      expect(constants).toHaveProperty('CLASS_NAMES');
      expect(constants).toHaveProperty('STORAGE_KEYS');
      expect(constants).toHaveProperty('API_URLS');
      expect(constants).toHaveProperty('TIMING');
      expect(constants).toHaveProperty('LIMITS');
      expect(constants).toHaveProperty('ERROR_MESSAGES');
      expect(constants).toHaveProperty('URL_PATTERNS');
    });
  });

  describe('MODULE_NAMES', () => {
    test('should have all module names defined', () => {
      const expectedModules = [
        'ADBLOCKER',
        'BASIC',
        'COMMENT',
        'ENHANCED',
        'ERROR_BOUNDARY',
        'I18N',
        'MAIN',
        'MUSIC',
        'PERFORMANCE',
        'PIP',
        'PLAYLIST_SEARCH',
        'REPORT',
        'SHORTS',
        'STATS',
        'STYLE',
        'THUMBNAIL',
        'TIMECODE',
        'UPDATE',
        'UTILS',
      ];

      expectedModules.forEach(module => {
        expect(constants.MODULE_NAMES).toHaveProperty(module);
        expect(constants.MODULE_NAMES[module]).toContain('[YouTube+]');
      });
    });

    test('should have consistent module name format', () => {
      Object.values(constants.MODULE_NAMES).forEach(name => {
        expect(name).toMatch(/^\[YouTube\+\]\[.+\]$/);
      });
    });
  });

  describe('DOWNLOAD_SITES', () => {
    test('should have at least one download site configured', () => {
      const sites = Object.keys(constants.DOWNLOAD_SITES || {});
      expect(sites.length).toBeGreaterThan(0);
    });

    test('should have valid site structure for each configured site', () => {
      Object.values(constants.DOWNLOAD_SITES).forEach(site => {
        expect(site).toHaveProperty('name');
        expect(site).toHaveProperty('url');
        expect(typeof site.name).toBe('string');
        expect(typeof site.url).toBe('string');
        expect(site.url).toMatch(/^https?:\/\//);
      });
    });

    test('should have a placeholder in each download URL', () => {
      Object.values(constants.DOWNLOAD_SITES).forEach(site => {
        // allow either {videoId} or {videoUrl} placeholders depending on the site
        expect(site.url.includes('{videoId}') || site.url.includes('{videoUrl}')).toBe(true);
      });
    });
  });

  describe('SVG_NS', () => {
    test('should have correct SVG namespace', () => {
      expect(constants.SVG_NS).toBe('http://www.w3.org/2000/svg');
    });

    test('should be a string', () => {
      expect(typeof constants.SVG_NS).toBe('string');
    });
  });

  describe('SELECTORS', () => {
    test('should have common YouTube selectors', () => {
      const expectedSelectors = [
        'VIDEO_PLAYER',
        'VIDEO_ELEMENT',
        'PLAYER_CONTAINER',
        'PRIMARY',
        'SECONDARY',
        'COMMENTS',
        'DESCRIPTION',
        'TITLE',
        'CHANNEL_NAME',
        'SUBSCRIBE_BUTTON',
        'LIKE_BUTTON',
      ];

      expectedSelectors.forEach(selector => {
        expect(constants.SELECTORS).toHaveProperty(selector);
        expect(typeof constants.SELECTORS[selector]).toBe('string');
      });
    });

    test('should have valid CSS selectors', () => {
      Object.values(constants.SELECTORS).forEach(selector => {
        expect(selector.length).toBeGreaterThan(0);
        // Should start with # (ID), . (class), or alphanumeric (tag)
        expect(selector).toMatch(/^[.#a-zA-Z]/);
      });
    });
  });

  describe('CLASS_NAMES', () => {
    test('should have class names', () => {
      expect(constants.CLASS_NAMES).toHaveProperty('YTP_BUTTON');
      expect(constants.CLASS_NAMES).toHaveProperty('YTP_SETTINGS_BUTTON');
      expect(constants.CLASS_NAMES).toHaveProperty('HIDDEN');
      expect(constants.CLASS_NAMES).toHaveProperty('ACTIVE');
    });

    test('should be non-empty strings', () => {
      Object.values(constants.CLASS_NAMES).forEach(className => {
        expect(typeof className).toBe('string');
        expect(className.length).toBeGreaterThan(0);
      });
    });
  });

  describe('STORAGE_KEYS', () => {
    test('should have storage keys defined', () => {
      const expectedKeys = [
        'SETTINGS',
        'TIMECODE_SETTINGS',
        'COMMENT_SETTINGS',
        'THEME',
        'LANGUAGE',
      ];

      expectedKeys.forEach(key => {
        expect(constants.STORAGE_KEYS).toHaveProperty(key);
      });
    });

    test('should have unique storage keys', () => {
      const values = Object.values(constants.STORAGE_KEYS);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    test('should have youtube_ prefix', () => {
      Object.values(constants.STORAGE_KEYS).forEach(key => {
        expect(key).toMatch(/^youtube_/);
      });
    });
  });

  describe('API_URLS', () => {
    test('should have API URLs defined', () => {
      expect(constants.API_URLS).toHaveProperty('GITHUB_REPO');
      expect(constants.API_URLS).toHaveProperty('GITHUB_API');
      expect(constants.API_URLS).toHaveProperty('GREASYFORK');
    });

    test('should have valid URLs', () => {
      expect(constants.API_URLS.GITHUB_REPO).toMatch(/^https:\/\/github\.com\//);
      expect(constants.API_URLS.GITHUB_API).toMatch(/^https:\/\/api\.github\.com\//);
      expect(constants.API_URLS.GREASYFORK).toMatch(/^https:\/\/greasyfork\.org\//);
    });
  });

  describe('TIMING', () => {
    test('should have timing constants', () => {
      const expectedTimings = [
        'DEBOUNCE_SHORT',
        'DEBOUNCE_MEDIUM',
        'DEBOUNCE_LONG',
        'THROTTLE',
        'ANIMATION_DURATION',
        'TOAST_DURATION',
        'RETRY_DELAY',
        'OBSERVER_DELAY',
      ];

      expectedTimings.forEach(timing => {
        expect(constants.TIMING).toHaveProperty(timing);
      });
    });

    test('should have positive numbers', () => {
      Object.values(constants.TIMING).forEach(time => {
        expect(typeof time).toBe('number');
        expect(time).toBeGreaterThan(0);
      });
    });

    test('should have reasonable values', () => {
      expect(constants.TIMING.DEBOUNCE_SHORT).toBeLessThan(constants.TIMING.DEBOUNCE_MEDIUM);
      expect(constants.TIMING.DEBOUNCE_MEDIUM).toBeLessThan(constants.TIMING.DEBOUNCE_LONG);
      expect(constants.TIMING.ANIMATION_DURATION).toBeLessThan(1000);
      expect(constants.TIMING.TOAST_DURATION).toBeGreaterThan(1000);
    });
  });

  describe('LIMITS', () => {
    test('should have limit constants', () => {
      const expectedLimits = [
        'MAX_PLAYLIST_ITEMS',
        'MAX_COMMENT_LENGTH',
        'MAX_TITLE_LENGTH',
        'MAX_DESCRIPTION_LENGTH',
        'MAX_RETRIES',
        'RATE_LIMIT_REQUESTS',
        'RATE_LIMIT_WINDOW',
      ];

      expectedLimits.forEach(limit => {
        expect(constants.LIMITS).toHaveProperty(limit);
      });
    });

    test('should have positive integers', () => {
      Object.values(constants.LIMITS).forEach(limit => {
        expect(typeof limit).toBe('number');
        expect(limit).toBeGreaterThan(0);
        expect(Number.isInteger(limit)).toBe(true);
      });
    });

    test('should have reasonable values', () => {
      expect(constants.LIMITS.MAX_PLAYLIST_ITEMS).toBeGreaterThan(100);
      expect(constants.LIMITS.MAX_COMMENT_LENGTH).toBeGreaterThan(1000);
      expect(constants.LIMITS.MAX_RETRIES).toBeLessThan(10);
      expect(constants.LIMITS.RATE_LIMIT_WINDOW).toBeGreaterThanOrEqual(10000);
    });
  });

  describe('ERROR_MESSAGES', () => {
    test('should have error messages defined', () => {
      const expectedMessages = [
        'INVALID_KEY',
        'OBSERVER_DISCONNECT_FAILED',
        'FETCH_FAILED',
        'INVALID_VIDEO_ID',
        'STORAGE_FAILED',
        'PARSE_FAILED',
      ];

      expectedMessages.forEach(msg => {
        expect(constants.ERROR_MESSAGES).toHaveProperty(msg);
      });
    });

    test('should be non-empty strings', () => {
      Object.values(constants.ERROR_MESSAGES).forEach(msg => {
        expect(typeof msg).toBe('string');
        expect(msg.length).toBeGreaterThan(0);
      });
    });
  });

  describe('URL_PATTERNS', () => {
    test('should have URL pattern regex', () => {
      const expectedPatterns = ['VIDEO_ID', 'PLAYLIST_ID', 'SHORTS', 'TIMESTAMP', 'CHANNEL_ID'];

      expectedPatterns.forEach(pattern => {
        expect(constants.URL_PATTERNS).toHaveProperty(pattern);
      });
    });

    test('should be RegExp objects', () => {
      Object.values(constants.URL_PATTERNS).forEach(pattern => {
        // Check if it has RegExp methods (works across VM contexts)
        expect(typeof pattern.test).toBe('function');
        expect(typeof pattern.exec).toBe('function');
        expect(pattern.constructor.name).toBe('RegExp');
      });
    });

    test('should match valid YouTube patterns', () => {
      expect('?v=dQw4w9WgXcQ').toMatch(constants.URL_PATTERNS.VIDEO_ID);
      expect('?list=PLxxxxxx').toMatch(constants.URL_PATTERNS.PLAYLIST_ID);
      expect('/shorts/abcd1234567').toMatch(constants.URL_PATTERNS.SHORTS);
      expect('?t=123').toMatch(constants.URL_PATTERNS.TIMESTAMP);
      expect('/channel/UCxxxxxx').toMatch(constants.URL_PATTERNS.CHANNEL_ID);
    });

    test('should not match invalid patterns', () => {
      expect('invalid').not.toMatch(constants.URL_PATTERNS.VIDEO_ID);
      expect('random').not.toMatch(constants.URL_PATTERNS.PLAYLIST_ID);
      expect('notshorts').not.toMatch(constants.URL_PATTERNS.SHORTS);
    });
  });

  describe('Immutability', () => {
    test('constants should be readable', () => {
      expect(constants.SVG_NS).toBe('http://www.w3.org/2000/svg');
      expect(constants.MODULE_NAMES.MAIN).toBe('[YouTube+][Main]');
    });

    test('should preserve object references', () => {
      const moduleNames1 = constants.MODULE_NAMES;
      const moduleNames2 = constants.MODULE_NAMES;
      expect(moduleNames1).toBe(moduleNames2);
    });
  });
});
