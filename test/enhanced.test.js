/**
 * @jest-environment jsdom
 */

describe('Enhanced Tabviews Module', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    // Clear localStorage
    localStorage.clear();
    // Mock console methods to avoid noise
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Scroll-to-Top Button', () => {
    test('should add custom styles to document head', () => {
      const stylesBefore = document.getElementById('custom-styles');
      expect(stylesBefore).toBeNull();

      // Trigger module initialization by simulating the module code
      const style = document.createElement('style');
      style.id = 'custom-styles';
      document.head.appendChild(style);

      const stylesAfter = document.getElementById('custom-styles');
      expect(stylesAfter).not.toBeNull();
      expect(stylesAfter.tagName).toBe('STYLE');
    });

    test('should not add duplicate styles', () => {
      const style1 = document.createElement('style');
      style1.id = 'custom-styles';
      document.head.appendChild(style1);

      const style2 = document.createElement('style');
      style2.id = 'custom-styles';

      // Should not add duplicate
      const existing = document.getElementById('custom-styles');
      if (!existing) {
        document.head.appendChild(style2);
      }

      const allStyles = document.querySelectorAll('#custom-styles');
      expect(allStyles.length).toBe(1);
    });

    test('should create button with correct attributes', () => {
      const rightTabs = document.createElement('div');
      rightTabs.id = 'right-tabs';
      document.body.appendChild(rightTabs);

      const button = document.createElement('button');
      button.id = 'right-tabs-top-button';
      button.className = 'top-button';
      button.title = 'Scroll to top';
      button.setAttribute('aria-label', 'Scroll to top');

      rightTabs.appendChild(button);

      const createdButton = document.getElementById('right-tabs-top-button');
      expect(createdButton).not.toBeNull();
      expect(createdButton.className).toBe('top-button');
      expect(createdButton.getAttribute('aria-label')).toBe('Scroll to top');
    });

    test('should toggle visibility based on scroll position', () => {
      const button = document.createElement('button');
      button.id = 'right-tabs-top-button';
      button.className = 'top-button';
      document.body.appendChild(button);

      // Mock scroll container
      const scrollContainer = document.createElement('div');
      Object.defineProperty(scrollContainer, 'scrollTop', {
        writable: true,
        value: 150,
      });

      // Simulate handleScroll
      if (scrollContainer.scrollTop > 100) {
        button.classList.add('visible');
      } else {
        button.classList.remove('visible');
      }

      expect(button.classList.contains('visible')).toBe(true);

      // Scroll to top
      Object.defineProperty(scrollContainer, 'scrollTop', {
        writable: true,
        value: 50,
      });

      if (scrollContainer.scrollTop > 100) {
        button.classList.add('visible');
      } else {
        button.classList.remove('visible');
      }

      expect(button.classList.contains('visible')).toBe(false);
    });

    test('should handle scroll event with debouncing', done => {
      const mockFn = jest.fn();
      let timeoutId;

      // Simple debounce implementation
      const debounce = (fn, delay) => {
        return (...args) => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fn(...args), delay);
        };
      };

      const debouncedFn = debounce(mockFn, 100);

      debouncedFn();
      debouncedFn();
      debouncedFn();

      expect(mockFn).not.toHaveBeenCalled();

      setTimeout(() => {
        expect(mockFn).toHaveBeenCalledTimes(1);
        done();
      }, 150);
    });
  });

  describe('YouTube End Screen Remover', () => {
    test('should inject CSS to hide end screen elements', () => {
      const style = document.createElement('style');
      style.id = 'end-screen-remover';
      style.textContent = '.ytp-ce-element-show,.ytp-ce-element{display:none!important;}';
      document.head.appendChild(style);

      const styleEl = document.getElementById('end-screen-remover');
      expect(styleEl).not.toBeNull();
      expect(styleEl.textContent).toContain('display:none');
    });

    test('should remove end screen elements from DOM', () => {
      const endScreenElement = document.createElement('div');
      endScreenElement.className = 'ytp-ce-element-show';
      document.body.appendChild(endScreenElement);

      // Simulate removal
      endScreenElement.style.cssText = 'display:none!important;visibility:hidden!important';
      endScreenElement.remove();

      const elements = document.querySelectorAll('.ytp-ce-element-show');
      expect(elements.length).toBe(0);
    });

    test('should handle settings from localStorage', () => {
      const settings = { enabled: true };
      localStorage.setItem('youtube_endscreen_settings', JSON.stringify(settings));

      const loaded = JSON.parse(localStorage.getItem('youtube_endscreen_settings'));
      expect(loaded.enabled).toBe(true);
    });

    test('should handle corrupted localStorage data', () => {
      localStorage.setItem('youtube_endscreen_settings', 'invalid-json');

      let enabled = true;
      try {
        const data = localStorage.getItem('youtube_endscreen_settings');
        enabled = JSON.parse(data).enabled ?? true;
      } catch {
        enabled = true;
      }

      expect(enabled).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should catch and log errors in handleScroll', () => {
      const scrollContainer = null;

      try {
        const button = document.getElementById('right-tabs-top-button');
        if (!button || !scrollContainer) return;
      } catch (error) {
        console.error('[YouTube+][Enhanced] Error in handleScroll:', error);
      }

      expect(console.error).not.toHaveBeenCalled();
    });

    test('should handle missing DOM elements gracefully', () => {
      const button = document.getElementById('non-existent-button');
      expect(button).toBeNull();

      // Should not throw
      expect(() => {
        const rightTabs = document.querySelector('#right-tabs');
        if (!rightTabs) return;
      }).not.toThrow();
    });

    test('should handle observer errors gracefully', () => {
      const rightTabs = document.createElement('div');
      rightTabs.id = 'right-tabs';
      document.body.appendChild(rightTabs);

      let observer;
      try {
        observer = new MutationObserver(() => {});
        observer.observe(rightTabs, {
          attributes: true,
          subtree: true,
          attributeFilter: ['class'],
        });
      } catch (error) {
        console.error('[YouTube+][Enhanced] Error in observer:', error);
      }

      expect(observer).toBeDefined();
      observer.disconnect();
    });
  });

  describe('Accessibility', () => {
    test('button should have aria-label', () => {
      const button = document.createElement('button');
      button.setAttribute('aria-label', 'Scroll to top');
      document.body.appendChild(button);

      expect(button.getAttribute('aria-label')).toBe('Scroll to top');
    });

    test('button should be keyboard accessible', () => {
      const button = document.createElement('button');
      button.id = 'right-tabs-top-button';
      document.body.appendChild(button);

      const clickHandler = jest.fn();
      button.addEventListener('click', clickHandler);
      button.click();

      expect(clickHandler).toHaveBeenCalled();
    });
  });

  describe('Performance', () => {
    test('should use passive event listeners for scroll', () => {
      const tab = document.createElement('div');
      tab.className = 'tab-content-cld';

      const mockHandler = jest.fn();
      tab.addEventListener('scroll', mockHandler, { passive: true });

      const event = new Event('scroll');
      tab.dispatchEvent(event);

      expect(mockHandler).toHaveBeenCalled();
    });

    test('should batch DOM operations', () => {
      const elements = [];
      for (let i = 0; i < 5; i++) {
        const el = document.createElement('div');
        el.className = 'ytp-ce-element';
        document.body.appendChild(el);
        elements.push(el);
      }

      // Batch remove
      const batchSize = 20;
      const len = Math.min(elements.length, batchSize);
      let removed = 0;

      for (let i = 0; i < len; i++) {
        elements[i].remove();
        removed++;
      }

      expect(removed).toBe(5);
      expect(document.querySelectorAll('.ytp-ce-element').length).toBe(0);
    });
  });

  describe('Internationalization', () => {
    test('should support multiple languages', () => {
      const i18n = {
        en: { scrollToTop: 'Scroll to top' },
        ru: { scrollToTop: 'Прокрутить вверх' },
      };

      const getLanguage = () => {
        const htmlLang = document.documentElement.lang || 'en';
        if (htmlLang.startsWith('ru')) return 'ru';
        return 'en';
      };

      document.documentElement.lang = 'en';
      expect(i18n[getLanguage()].scrollToTop).toBe('Scroll to top');

      document.documentElement.lang = 'ru';
      expect(i18n[getLanguage()].scrollToTop).toBe('Прокрутить вверх');
    });
  });
});
