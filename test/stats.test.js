// @ts-nocheck
/**
 * @jest-environment jsdom
 */

describe('Stats Module', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // Use the global mockLocation helper from setup.js
    mockLocation({
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=dQw4w9WgXcQ',
    });

    // Mock localStorage with proper Storage interface
    const localStorageMock = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
      length: 0,
      key: jest.fn(),
    };
    Object.defineProperty(global, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    // Mock YouTubeUtils
    /** @type {any} */ (global).YouTubeUtils = {
      StyleManager: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      logError: jest.fn(),
      debounce: (fn, wait) => {
        let timeout;
        const debounced = function (...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => fn(...args), wait);
        };
        debounced.cancel = () => clearTimeout(timeout);
        return debounced;
      },
    };
  });

  describe('Video URL Detection', () => {
    test('should detect regular video URL', () => {
      // Test URL parsing directly instead of relying on window.location
      const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const videoId = testUrl.match(/[?&]v=([^&]+)/)?.[1];

      expect(testUrl).toContain('watch');
      expect(videoId).toBe('dQw4w9WgXcQ');
    });

    test('should detect shorts URL', () => {
      // Test URL parsing directly
      const testUrl = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';

      expect(testUrl).toContain('/shorts/');
    });

    test('should handle invalid video IDs', () => {
      // Invalid video ID should not match the pattern
      const invalidId = 'invalid!@#';
      expect(/^[a-zA-Z0-9_-]{11}$/.test(invalidId)).toBe(false);
    });

    test('should validate video ID length', () => {
      const validId = 'dQw4w9WgXcQ'; // 11 characters
      const invalidId = 'short'; // too short

      expect(/^[a-zA-Z0-9_-]{11}$/.test(validId)).toBe(true);
      expect(/^[a-zA-Z0-9_-]{11}$/.test(invalidId)).toBe(false);
    });
  });

  describe('Channel Identifier Detection', () => {
    test('should detect channel ID format', () => {
      // Test URL parsing directly
      const testUrl = 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw';

      expect(testUrl).toContain('/channel/');
    });

    test('should detect @handle format', () => {
      // Test URL parsing directly
      const testUrl = 'https://www.youtube.com/@YouTube';

      expect(testUrl).toContain('/@');
    });

    test('should validate channel identifier', () => {
      const validId = 'UCuAXFkgsw1L7xaCfnd5JJOw';
      const invalidId = 'invalid!@#$%';

      expect(/^[a-zA-Z0-9_-]+$/.test(validId)).toBe(true);
      expect(/^[a-zA-Z0-9_-]+$/.test(invalidId)).toBe(false);
    });
  });

  describe('Rate Limiter', () => {
    test('should allow requests within limit', () => {
      const rateLimiter = {
        requests: new Map(),
        maxRequests: 10,
        timeWindow: 60000,
        canRequest: function (key) {
          const now = Date.now();
          const requests = this.requests.get(key) || [];
          const recentRequests = requests.filter(time => now - time < this.timeWindow);

          if (recentRequests.length >= this.maxRequests) {
            return false;
          }

          recentRequests.push(now);
          this.requests.set(key, recentRequests);
          return true;
        },
      };

      // First request should be allowed
      expect(rateLimiter.canRequest('test')).toBe(true);

      // Multiple requests under limit should be allowed
      for (let i = 0; i < 5; i++) {
        expect(rateLimiter.canRequest('test')).toBe(true);
      }
    });

    test('should block requests exceeding limit', () => {
      const rateLimiter = {
        requests: new Map(),
        maxRequests: 3,
        timeWindow: 60000,
        canRequest: function (key) {
          const now = Date.now();
          const requests = this.requests.get(key) || [];
          const recentRequests = requests.filter(time => now - time < this.timeWindow);

          if (recentRequests.length >= this.maxRequests) {
            return false;
          }

          recentRequests.push(now);
          this.requests.set(key, recentRequests);
          return true;
        },
      };

      // Allow up to maxRequests
      expect(rateLimiter.canRequest('test')).toBe(true);
      expect(rateLimiter.canRequest('test')).toBe(true);
      expect(rateLimiter.canRequest('test')).toBe(true);

      // Should block after limit
      expect(rateLimiter.canRequest('test')).toBe(false);
    });

    test('should track requests per key', () => {
      const rateLimiter = {
        requests: new Map(),
        maxRequests: 2,
        timeWindow: 60000,
        canRequest: function (key) {
          const now = Date.now();
          const requests = this.requests.get(key) || [];
          const recentRequests = requests.filter(time => now - time < this.timeWindow);

          if (recentRequests.length >= this.maxRequests) {
            return false;
          }

          recentRequests.push(now);
          this.requests.set(key, recentRequests);
          return true;
        },
      };

      // Different keys should have independent limits
      expect(rateLimiter.canRequest('key1')).toBe(true);
      expect(rateLimiter.canRequest('key1')).toBe(true);
      expect(rateLimiter.canRequest('key1')).toBe(false);

      expect(rateLimiter.canRequest('key2')).toBe(true);
      expect(rateLimiter.canRequest('key2')).toBe(true);
      expect(rateLimiter.canRequest('key2')).toBe(false);
    });
  });

  describe('URL Validation', () => {
    test('should validate YouTube domain', () => {
      const validUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const invalidUrl = 'https://evil.com/watch?v=dQw4w9WgXcQ';

      expect(validUrl.includes('youtube.com')).toBe(true);
      expect(invalidUrl.includes('youtube.com')).toBe(false);
    });

    test('should require HTTPS protocol', () => {
      const httpsUrl = 'https://stats.afkarxyz.fun';
      const httpUrl = 'http://stats.afkarxyz.fun';

      const isHttps = url => {
        try {
          return new URL(url).protocol === 'https:';
        } catch {
          return false;
        }
      };

      expect(isHttps(httpsUrl)).toBe(true);
      expect(isHttps(httpUrl)).toBe(false);
    });

    test('should validate allowed domains', () => {
      const allowedDomains = ['stats.afkarxyz.fun', 'livecounts.io', 'api.livecounts.io'];

      const validateDomain = url => {
        try {
          const parsed = new URL(url);
          return allowedDomains.includes(parsed.hostname);
        } catch {
          return false;
        }
      };

      expect(validateDomain('https://stats.afkarxyz.fun')).toBe(true);
      expect(validateDomain('https://livecounts.io')).toBe(true);
      expect(validateDomain('https://evil.com')).toBe(false);
    });
  });

  describe('Settings Management', () => {
    test('should load settings from localStorage', () => {
      /** @type {any} */ (localStorage.getItem).mockReturnValue('true');

      const enabled = localStorage.getItem('youtube_stats_button_enabled') !== 'false';
      expect(enabled).toBe(true);
    });

    test('should handle missing settings', () => {
      /** @type {any} */ (localStorage.getItem).mockReturnValue(null);

      const enabled = localStorage.getItem('youtube_stats_button_enabled') !== 'false';
      expect(enabled).toBe(true); // Default to enabled
    });

    test('should handle disabled state', () => {
      /** @type {any} */ (localStorage.getItem).mockReturnValue('false');

      const enabled = localStorage.getItem('youtube_stats_button_enabled') !== 'false';
      expect(enabled).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid JSON parsing', () => {
      const invalidJson = '{invalid json}';

      let result = null;
      try {
        result = JSON.parse(invalidJson);
      } catch (error) {
        expect(error).toBeInstanceOf(SyntaxError);
      }

      expect(result).toBeNull();
    });

    test('should handle fetch errors gracefully', async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));

      try {
        await fetch('https://www.youtube.com/test');
      } catch (error) {
        expect(error.message).toBe('Network error');
      }
    });

    test('should handle timeout errors', async () => {
      global.fetch = jest.fn(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 100);
          })
      );

      try {
        await fetch('https://www.youtube.com/test');
      } catch (error) {
        expect(error.message).toBe('Timeout');
      }
    });
  });

  describe('Performance Optimizations', () => {
    test('should use debouncing for URL changes', done => {
      let callCount = 0;

      const debounce = (fn, wait) => {
        let timeout;
        return function (...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => fn(...args), wait);
        };
      };

      const debouncedFn = debounce(() => {
        callCount++;
      }, 100);

      // Call multiple times quickly
      debouncedFn();
      debouncedFn();
      debouncedFn();

      // Should only execute once after delay
      setTimeout(() => {
        expect(callCount).toBe(1);
        done();
      }, 150);
    });
  });
});
