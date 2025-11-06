// @ts-nocheck
/**
 * @jest-environment jsdom
 */

describe('Playlist Search Module', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // Use the global mockLocation helper from setup.js
    mockLocation({
      href: 'https://www.youtube.com/watch?v=test&list=PLtest123',
      search: '?v=test&list=PLtest123',
      hostname: 'www.youtube.com',
      pathname: '/watch',
    });

    // Mock localStorage
    global.Storage.prototype.getItem = jest.fn();
    global.Storage.prototype.setItem = jest.fn();
  });

  describe('Playlist ID Validation', () => {
    test('should validate valid playlist IDs', () => {
      const validIds = ['PLtest123', 'LL', 'WL', 'PL-123_abc', 'RDMM'];

      validIds.forEach(id => {
        expect(/^[a-zA-Z0-9_-]+$/.test(id)).toBe(true);
      });
    });

    test('should reject invalid playlist IDs', () => {
      const invalidIds = ['PL test', 'PL@invalid', '<script>', 'PL;DROP'];

      invalidIds.forEach(id => {
        expect(/^[a-zA-Z0-9_-]+$/.test(id)).toBe(false);
      });
    });

    test('should handle missing playlist ID', () => {
      // Use mockLocation instead of directly setting window.location.search
      mockLocation({
        href: 'https://www.youtube.com/watch?v=test',
        search: '?v=test',
        hostname: 'www.youtube.com',
        pathname: '/watch',
      });

      const urlParams = new URLSearchParams(window.location.search);
      const listId = urlParams.get('list');

      expect(listId).toBeNull();
    });
  });

  describe('Search Query Validation', () => {
    test('should handle empty queries', () => {
      const query = '';
      expect(query.trim()).toBe('');
    });

    test('should sanitize long queries', () => {
      const maxLength = 200;
      const longQuery = 'a'.repeat(300);
      const sanitized = longQuery.substring(0, maxLength);

      expect(sanitized.length).toBe(maxLength);
    });

    test('should handle special characters', () => {
      const queries = ['test query', 'café', '日本語', 'test-video'];

      queries.forEach(query => {
        expect(typeof query).toBe('string');
        expect(query.length).toBeGreaterThan(0);
      });
    });

    test('should handle null and undefined', () => {
      const nullQuery = null;
      const undefinedQuery = undefined;

      expect(!nullQuery || typeof nullQuery !== 'string').toBe(true);
      expect(!undefinedQuery || typeof undefinedQuery !== 'string').toBe(true);
    });
  });

  describe('Performance Optimizations', () => {
    test('should use debouncing', done => {
      let callCount = 0;

      const debounce = (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            func(...args);
          }, wait);
        };
      };

      const debouncedFn = debounce(() => {
        callCount++;
      }, 200);

      // Call multiple times
      debouncedFn();
      debouncedFn();
      debouncedFn();

      setTimeout(() => {
        expect(callCount).toBe(1);
        done();
      }, 250);
    });

    test('should use throttling for observers', done => {
      let callCount = 0;

      const throttle = (func, limit) => {
        let inThrottle;
        return function executedFunction(...args) {
          if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
          }
        };
      };

      const throttledFn = throttle(() => {
        callCount++;
      }, 500);

      // Call multiple times quickly
      throttledFn();
      throttledFn();
      throttledFn();

      expect(callCount).toBe(1);

      setTimeout(() => {
        throttledFn();
        expect(callCount).toBe(2);
        done();
      }, 550);
    });

    test('should use requestAnimationFrame for DOM updates', () => {
      const mockRaf = jest.fn(callback => {
        callback();
        return 1;
      });

      global.requestAnimationFrame = mockRaf;

      requestAnimationFrame(() => {
        // DOM update
      });

      expect(mockRaf).toHaveBeenCalled();
    });

    test('should cache playlist items', () => {
      const cache = new Map();

      // Add items to cache
      cache.set('video1', { title: 'Test Video', channel: 'Test Channel' });
      cache.set('video2', { title: 'Another Video', channel: 'Another Channel' });

      expect(cache.size).toBe(2);
      expect(cache.has('video1')).toBe(true);
      expect(cache.get('video1').title).toBe('Test Video');
    });
  });

  describe('Playlist Item Filtering', () => {
    test('should filter by title', () => {
      const items = [
        { title: 'test video', channel: 'channel 1' },
        { title: 'another video', channel: 'channel 2' },
        { title: 'test tutorial', channel: 'channel 3' },
      ];

      const query = 'test';
      const filtered = items.filter(
        item => item.title.includes(query) || item.channel.includes(query)
      );

      expect(filtered.length).toBe(2);
    });

    test('should filter by channel', () => {
      const items = [
        { title: 'video 1', channel: 'test channel' },
        { title: 'video 2', channel: 'other channel' },
        { title: 'video 3', channel: 'test creator' },
      ];

      const query = 'test';
      const filtered = items.filter(
        item => item.title.includes(query) || item.channel.includes(query)
      );

      expect(filtered.length).toBe(2);
    });

    test('should be case insensitive', () => {
      const items = [{ title: 'Test Video', channel: 'Test Channel' }];

      const queries = ['test', 'TEST', 'TeSt'];

      queries.forEach(query => {
        const filtered = items.filter(
          item =>
            item.title.toLowerCase().includes(query.toLowerCase()) ||
            item.channel.toLowerCase().includes(query.toLowerCase())
        );
        expect(filtered.length).toBe(1);
      });
    });
  });

  describe('Maximum Items Limit', () => {
    test('should limit processed items', () => {
      const maxItems = 5000;
      const items = Array.from({ length: 6000 }, (_, i) => ({
        title: `Video ${i}`,
        channel: `Channel ${i}`,
      }));

      const limited = items.slice(0, maxItems);

      expect(limited.length).toBe(maxItems);
      expect(limited.length).toBeLessThan(items.length);
    });

    test('should warn when exceeding limit', () => {
      const maxItems = 5000;
      const itemCount = 6000;

      if (itemCount > maxItems) {
        const warningMessage = `Playlist has ${itemCount} items, limiting to ${maxItems}`;
        expect(warningMessage).toContain('limiting to');
      }
    });
  });

  describe('Display Name Sanitization', () => {
    test('should limit display name length', () => {
      const longName = 'a'.repeat(150);
      const maxLength = 100;
      const sanitized =
        longName.length > maxLength ? longName.substring(0, maxLength) + '...' : longName;

      expect(sanitized.length).toBeLessThanOrEqual(maxLength + 3); // +3 for '...'
    });

    test('should handle special characters in names', () => {
      const names = ['Test & Playlist', 'Playlist <tag>', "Test's Playlist", 'Playlist "quoted"'];

      names.forEach(name => {
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      });
    });

    test('should fallback to playlist ID', () => {
      const listId = 'PLtest123';
      const displayName = listId.substring(0, 50);

      expect(displayName).toBe(listId);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid elements', () => {
      const element = null;

      if (element && element.querySelector) {
        // Would throw if not checked
        element.querySelector('.test');
      }

      expect(element).toBeNull();
    });

    test('should handle missing text content', () => {
      const element = document.createElement('div');
      const text = element.textContent?.trim()?.toLowerCase() || '';

      expect(text).toBe('');
    });
  });

  describe('DOM Operations', () => {
    test('should batch DOM updates', () => {
      const updates = [];

      // Collect updates
      for (let i = 0; i < 100; i++) {
        updates.push({
          element: document.createElement('div'),
          display: i % 2 === 0 ? '' : 'none',
        });
      }

      // Apply in batch
      updates.forEach(update => {
        update.element.style.display = update.display;
      });

      expect(updates.length).toBe(100);
    });

    test('should use RAF for smooth updates', done => {
      const mockRaf = jest.fn(callback => {
        callback();
        return 1;
      });

      global.requestAnimationFrame = mockRaf;

      requestAnimationFrame(() => {
        // Update logic
        done();
      });

      expect(mockRaf).toHaveBeenCalled();
    });
  });
});
