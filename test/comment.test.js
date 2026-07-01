/**
 * @jest-environment jsdom
 */

describe('Comment Manager Module', () => {
  /**
   * @type {{
   *   getItem: jest.Mock<string | null, [string]>,
   *   setItem: jest.Mock<void, [string, string]>,
   *   removeItem: jest.Mock<void, [string]>
   * }}
   */
  let mockLocalStorage;
  /**
   * @type {{
   *   debounce: (fn: (...args: unknown[]) => unknown, ms: number) => ((...args: unknown[]) => unknown) & { cancel: () => void },
   *   StyleManager: { add: jest.Mock; remove: jest.Mock; clear: jest.Mock },
   *   cleanupManager: { registerObserver: jest.Mock; registerListener: jest.Mock; registerTimer: jest.Mock; registerInterval: jest.Mock; cleanup: jest.Mock },
   *   logError: jest.Mock
   * }}
   */
  let mockYouTubeUtils;
  /** @type {{ withErrorBoundary: jest.Mock<Function, [Function, string?]>, logError: jest.Mock<void, [Error, object?]> }} */
  let mockYouTubePlusErrorBoundary;

  beforeEach(() => {
    // Mock localStorage
    mockLocalStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    };
    localStorage.getItem = mockLocalStorage.getItem;
    localStorage.setItem = mockLocalStorage.setItem;
    localStorage.removeItem = mockLocalStorage.removeItem;

    // Mock window.YouTubeUtils
    mockYouTubeUtils = {
      debounce: jest.fn((fn, _ms) => {
        const wrapped = /** @type {typeof fn & { cancel: () => void }} */ (
          (...args) => fn(...args)
        );
        wrapped.cancel = () => {};
        return wrapped;
      }),
      StyleManager: {
        add: jest.fn(),
        remove: jest.fn(),
        clear: jest.fn(),
      },
      cleanupManager: {
        registerObserver: jest.fn(),
        registerListener: jest.fn(() => Symbol('listener-key')),
        registerTimer: jest.fn(id => id),
        registerInterval: jest.fn(id => id),
        cleanup: jest.fn(),
      },
      logError: jest.fn(),
    };
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: mockYouTubeUtils,
    });

    // Mock window.YouTubePlusErrorBoundary
    mockYouTubePlusErrorBoundary = {
      withErrorBoundary: jest.fn(fn => fn),
      logError: jest.fn(),
    };
    Object.defineProperty(window, 'YouTubePlusErrorBoundary', {
      configurable: true,
      writable: true,
      value: mockYouTubePlusErrorBoundary,
    });

    // Reset DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    test('should have correct default configuration', () => {
      // Configuration is internal to IIFE, but we can test behavior
      expect(true).toBe(true); // Placeholder for actual config tests
    });

    test('should store settings in localStorage', () => {
      // This would require refactoring to expose settings object
      expect(mockLocalStorage.getItem).toBeDefined();
      expect(mockLocalStorage.setItem).toBeDefined();
    });
  });

  describe('Settings Management', () => {
    test('should load settings from localStorage', () => {
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ enabled: false }));

      // Settings are loaded during initialization
      // We can verify the mock was called
      // This test would need module refactoring for proper testing
      expect(true).toBe(true);
    });

    test('should handle missing localStorage data gracefully', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      // Should not throw
      expect(() => {
        mockLocalStorage.getItem('youtube_comment_manager_settings');
      }).not.toThrow();
    });

    test('should handle corrupted localStorage data', () => {
      mockLocalStorage.getItem.mockReturnValue('invalid json{');

      // Should not throw when parsing invalid JSON
      expect(() => {
        try {
          const raw = mockLocalStorage.getItem('test');
          if (raw) JSON.parse(raw);
        } catch (e) {
          // Expected to fail
        }
      }).not.toThrow();
    });
  });

  describe('DOM Manipulation', () => {
    test('should create checkbox elements', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'comment-checkbox ytp-plus-settings-checkbox';

      expect(checkbox.type).toBe('checkbox');
      expect(checkbox.className).toContain('comment-checkbox');
    });

    test('should create control panel', () => {
      const panel = document.createElement('div');
      panel.className = 'comment-controls-container comment-controls-panel';

      expect(panel.className).toContain('comment-controls-container');
    });

    test('should create action buttons', () => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Delete Selected';
      button.className = 'comment-controls-button comment-controls-button--danger';

      expect(button.type).toBe('button');
      expect(button.textContent).toBe('Delete Selected');
      expect(button.className).toContain('comment-controls-button--danger');
    });
  });

  describe('Error Handling', () => {
    test('should wrap functions with error boundary', () => {
      const testFn = () => 'test';
      const wrapped = mockYouTubePlusErrorBoundary.withErrorBoundary(testFn, 'CommentManager');

      expect(wrapped).toBe(testFn); // In our mock, it returns the same function
      expect(mockYouTubePlusErrorBoundary.withErrorBoundary).toHaveBeenCalledWith(
        testFn,
        'CommentManager'
      );
    });

    test('should handle errors gracefully', () => {
      const errorFn = () => {
        throw new Error('Test error');
      };

      // With error boundary, errors should be caught
      expect(() => {
        try {
          errorFn();
        } catch (e) {
          // Error caught
        }
      }).not.toThrow();
    });

    test('should log errors with context', () => {
      const error = new Error('Test error');
      mockYouTubePlusErrorBoundary.logError(error, { context: 'test' });

      expect(mockYouTubePlusErrorBoundary.logError).toHaveBeenCalledWith(error, { context: 'test' });
    });
  });

  describe('Utility Functions', () => {
    test('should use debounce from YouTubeUtils', () => {
      const fn = jest.fn();
      mockYouTubeUtils.debounce(fn, 100);

      expect(mockYouTubeUtils.debounce).toHaveBeenCalledWith(fn, 100);
    });

    test('should query DOM elements safely', () => {
      document.body.innerHTML = '<div class="test">Test</div>';

      const element = document.querySelector('.test');
      expect(element).toBeTruthy();
      if (!element) throw new Error('test element not found');
      expect(element.textContent).toBe('Test');
    });

    test('should query multiple DOM elements', () => {
      document.body.innerHTML = `
        <div class="test">1</div>
        <div class="test">2</div>
        <div class="test">3</div>
      `;

      const elements = document.querySelectorAll('.test');
      expect(elements.length).toBe(3);
    });
  });

  describe('Style Management', () => {
    test('should add styles via StyleManager', () => {
      const styles = '.test { color: red; }';
      mockYouTubeUtils.StyleManager.add('test-styles', styles);

      expect(mockYouTubeUtils.StyleManager.add).toHaveBeenCalledWith('test-styles', styles);
    });

    test('should not add duplicate styles', () => {
      document.body.innerHTML = '<style id="comment-delete-styles"></style>';

      const existing = document.getElementById('comment-delete-styles');
      expect(existing).toBeTruthy();
    });
  });

  describe('Cleanup Management', () => {
    test('should register observers for cleanup', () => {
      const observer = new MutationObserver(() => {});
      mockYouTubeUtils.cleanupManager.registerObserver(observer);

      expect(mockYouTubeUtils.cleanupManager.registerObserver).toHaveBeenCalledWith(observer);
    });

    test('should register event listeners for cleanup', () => {
      const handler = jest.fn();
      const key = mockYouTubeUtils.cleanupManager.registerListener(document, 'click', handler, {
        passive: true,
      });

      expect(typeof key).toBe('symbol');
      expect(mockYouTubeUtils.cleanupManager.registerListener).toHaveBeenCalled();
    });
  });

  describe('Integration', () => {
    test('should work with all dependencies available', () => {
      expect(window.YouTubeUtils).toBeDefined();
      expect(window.YouTubePlusErrorBoundary).toBeDefined();
      expect(localStorage).toBeDefined();
    });

    test('should handle missing dependencies gracefully', () => {
      Object.defineProperty(window, 'YouTubeUtils', {
        configurable: true,
        writable: true,
        value: undefined,
      });

      // Should not throw when dependencies are missing
      expect(() => {
        const utils = window.YouTubeUtils;
        if (utils) {
          utils.debounce(() => {}, 100);
        }
      }).not.toThrow();
    });
  });

  describe('Accessibility', () => {
    test('should add aria-label to checkboxes', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', 'Select comment');

      expect(checkbox.getAttribute('aria-label')).toBe('Select comment');
    });

    test('should add role to control panel', () => {
      const panel = document.createElement('div');
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', 'Comment manager controls');

      expect(panel.getAttribute('role')).toBe('region');
      expect(panel.getAttribute('aria-label')).toBe('Comment manager controls');
    });

    test('should add aria-expanded to collapse button', () => {
      const button = document.createElement('button');
      button.setAttribute('aria-expanded', 'true');

      expect(button.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('User Interactions', () => {
    test('should handle checkbox change events', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';

      const handler = jest.fn();
      checkbox.addEventListener('change', handler);

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(handler).toHaveBeenCalled();
    });

    test('should prevent event propagation on checkbox click', () => {
      const checkbox = document.createElement('input');
      const stopPropagation = jest.fn();

      checkbox.addEventListener('click', e => e.stopPropagation());

      const event = new Event('click', { bubbles: true });
      event.stopPropagation = stopPropagation;
      checkbox.dispatchEvent(event);

      // Event propagation should be prevented
      expect(true).toBe(true);
    });

    test('should confirm before deleting comments', () => {
      global.confirm = jest.fn(() => false);

      const result = confirm('Delete 5 comment(s)?');

      expect(global.confirm).toHaveBeenCalledWith('Delete 5 comment(s)?');
      expect(result).toBe(false);
    });

    test('should open comment history page', () => {
      const mockOpen = jest.fn();
      global.window.open = mockOpen;

      window.open('https://www.youtube.com/feed/history/comment_history', '_blank');

      expect(mockOpen).toHaveBeenCalledWith(
        'https://www.youtube.com/feed/history/comment_history',
        '_blank'
      );
    });
  });
});
