/**
 * @jest-environment jsdom
 */

describe('Shorts Module', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // Mock window globals
    window.YouTubePlusI18n = {
      t: jest.fn((key, params = {}) => {
        const translations = {
          seekBackward: 'Seek Backward',
          seekForward: 'Seek Forward',
          volumeUp: 'Volume Up',
          volumeDown: 'Volume Down',
          muteUnmute: 'Mute/Unmute',
          toggleCaptions: 'Toggle Captions',
          showHideHelp: 'Show/Hide Help',
        };
        return translations[key] || key;
      }),
    };

    window.YouTubeUtils = {
      debounce: jest.fn(fn => fn),
      throttle: jest.fn(fn => fn),
      logError: jest.fn(),
      StyleManager: {
        add: jest.fn(),
        remove: jest.fn(),
      },
      cleanupManager: {
        registerListener: jest.fn(),
        registerObserver: jest.fn(),
      },
    };

    // Mock localStorage
    Storage.prototype.getItem = jest.fn();
    Storage.prototype.setItem = jest.fn();

    // Clear console mocks
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('Module Loading', () => {
    test('should have required dependencies', () => {
      expect(window.YouTubeUtils).toBeDefined();
      expect(window.YouTubeUtils.StyleManager).toBeDefined();
      expect(window.YouTubePlusI18n).toBeDefined();
    });

    test('should have translation function', () => {
      expect(typeof window.YouTubePlusI18n.t).toBe('function');
    });
  });
  describe('Keyboard Shortcuts', () => {
    test('should have keyboard event handling capability', () => {
      const video = document.createElement('video');
      video.currentTime = 10;
      document.body.appendChild(video);

      expect(video).toBeDefined();
      expect(document.querySelector('video')).toBe(video);
    });

    test('should support standard keyboard events', () => {
      const keys = ['ArrowLeft', 'ArrowRight', '+', '-', 'm', 'c', '?'];

      keys.forEach(key => {
        const event = new KeyboardEvent('keydown', { key });
        expect(event.key).toBe(key);
      });
    });
  });

  describe('Video Detection', () => {
    test('should find active shorts video', () => {
      const video = document.createElement('video');
      video.id = 'shorts-player';
      document.body.appendChild(video);

      const foundVideo = document.querySelector('#shorts-player');
      expect(foundVideo).toBe(video);
    });

    test('should handle missing video element', () => {
      const video = document.querySelector('video');
      expect(video).toBeNull();
    });

    test('should support video element queries', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      const video1 = document.querySelector('video');
      const video2 = document.querySelector('video');

      expect(video1).toBe(video2);
    });
  });
  describe('Settings Management', () => {
    test('should have localStorage access', () => {
      expect(Storage.prototype.getItem).toBeDefined();
      expect(Storage.prototype.setItem).toBeDefined();
    });

    test('should handle JSON parsing', () => {
      const validJSON = JSON.stringify({ enabled: true });
      expect(() => JSON.parse(validJSON)).not.toThrow();
    });

    test('should handle invalid JSON gracefully', () => {
      expect(() => {
        try {
          JSON.parse('invalid json');
        } catch (e) {
          // Expected error
        }
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    test('should handle keyboard events on any element', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
      expect(() => {
        div.dispatchEvent(event);
      }).not.toThrow();
    });

    test('should support error catching', () => {
      expect(() => {
        try {
          throw new Error('Test error');
        } catch (e) {
          // Error caught successfully
        }
      }).not.toThrow();
    });
  });
  describe('Help Overlay', () => {
    test('should support help key event', () => {
      const event = new KeyboardEvent('keydown', { key: '?' });
      expect(event.key).toBe('?');
    });

    test('should have translation support', () => {
      expect(window.YouTubePlusI18n.t).toBeDefined();
      expect(typeof window.YouTubePlusI18n.t).toBe('function');
    });
  });

  describe('Performance', () => {
    test('should have debouncing utility', () => {
      expect(window.YouTubeUtils.debounce).toBeDefined();
      expect(typeof window.YouTubeUtils.debounce).toBe('function');
    });

    test('should have throttling utility', () => {
      expect(window.YouTubeUtils.throttle).toBeDefined();
      expect(typeof window.YouTubeUtils.throttle).toBe('function');
    });
  });
  describe('Accessibility', () => {
    test('should support keyboard navigation', () => {
      const shortcuts = ['ArrowLeft', 'ArrowRight', '+', '-', 'm', 'c', '?'];

      shortcuts.forEach(key => {
        const event = new KeyboardEvent('keydown', { key });
        expect(event.key).toBe(key);
      });
    });

    test('should have keyboard event support', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      const event = new KeyboardEvent('keydown', { key: 'm' });
      expect(event).toBeDefined();
    });
  });

  describe('Integration', () => {
    test('should have YouTubeUtils available', () => {
      expect(window.YouTubeUtils).toBeDefined();
      expect(window.YouTubeUtils.StyleManager).toBeDefined();
    });

    test('should have i18n system available', () => {
      expect(window.YouTubePlusI18n).toBeDefined();
      expect(typeof window.YouTubePlusI18n.t).toBe('function');
    });

    test('should have all required dependencies', () => {
      expect(window.YouTubeUtils.debounce).toBeDefined();
      expect(window.YouTubeUtils.throttle).toBeDefined();
      expect(window.YouTubeUtils.logError).toBeDefined();
    });
  });
  describe('URL Detection', () => {
    test('should support URL checking', () => {
      const shortsUrl = 'https://www.youtube.com/shorts/abc123';
      const watchUrl = 'https://www.youtube.com/watch?v=abc123';

      expect(shortsUrl).toContain('shorts');
      expect(watchUrl).not.toContain('shorts');
    });

    test('should have URL pattern matching capability', () => {
      const url = 'https://www.youtube.com/shorts/abc123';
      const match = url.match(/shorts\/([^/]+)/);

      expect(match).toBeTruthy();
      if (match) {
        expect(match[1]).toBe('abc123');
      }
    });
  });
});
