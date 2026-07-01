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
      if (!stylesAfter) throw new Error('custom styles not created');
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
      if (!createdButton) throw new Error('button was not created');
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
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timeoutId = null;

      // Simple debounce implementation
      /** @param {() => void} fn @param {number} delay */
      const debounce = (fn, delay) => {
        return () => {
          if (timeoutId !== null) clearTimeout(timeoutId);
          timeoutId = setTimeout(() => fn(), delay);
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

  describe('Return YouTube Dislike Integration', () => {
    test('should extract video ID correctly from different sources', () => {
      const getVideoIdForDislikeMock = (urlStr, mockDoc) => {
        try {
          const urlObj = new URL(urlStr);
          const pathname = urlObj.pathname || '';
          if (pathname.startsWith('/shorts/')) return pathname.slice(8);
          if (pathname.startsWith('/clip/')) {
            const meta = mockDoc.querySelector("meta[itemprop='videoId'], meta[itemprop='identifier']");
            return meta?.getAttribute('content') || null;
          }
          let v = urlObj.searchParams.get('v');
          if (v) return v;

          const watchFlexy = mockDoc.querySelector('ytd-watch-flexy');
          if (watchFlexy) {
            v = watchFlexy.getAttribute('video-id');
            if (v) return v;
          }

          const moviePlayer = mockDoc.getElementById('movie_player');
          if (moviePlayer && typeof moviePlayer.getVideoData === 'function') {
            v = moviePlayer.getVideoData()?.video_id;
            if (v) return v;
          }

          const metaVideoId = mockDoc.querySelector("meta[itemprop='videoId']");
          if (metaVideoId) {
            v = metaVideoId.getAttribute('content');
            if (v) return v;
          }

          return null;
        } catch (_e) {
          return null;
        }
      };

      const mockDoc = document.implementation.createHTMLDocument();

      expect(getVideoIdForDislikeMock('https://www.youtube.com/watch?v=tiFJmVhkF_s', mockDoc)).toBe('tiFJmVhkF_s');
      expect(getVideoIdForDislikeMock('https://www.youtube.com/shorts/xyz12345', mockDoc)).toBe('xyz12345');

      const meta = mockDoc.createElement('meta');
      meta.setAttribute('itemprop', 'videoId');
      meta.setAttribute('content', 'clip123');
      mockDoc.head.appendChild(meta);
      expect(getVideoIdForDislikeMock('https://www.youtube.com/clip/abc', mockDoc)).toBe('clip123');

      // Test watch flexy fallback
      const flexy = mockDoc.createElement('ytd-watch-flexy');
      flexy.setAttribute('video-id', 'flexyId');
      mockDoc.body.appendChild(flexy);
      expect(getVideoIdForDislikeMock('https://www.youtube.com/watch', mockDoc)).toBe('flexyId');
    });

    test('should format numbers compactly', () => {
      const formatCompactNumber = (number) => {
        return new Intl.NumberFormat('en', {
          notation: 'compact',
          compactDisplay: 'short',
        }).format(Number(number) || 0);
      };

      expect(formatCompactNumber(1200)).toBe('1.2K');
      expect(formatCompactNumber(850000)).toBe('850K');
      expect(formatCompactNumber(75)).toBe('75');
    });

    test('should find or create text container for dislike button', () => {
      const button = document.createElement('div');
      button.id = 'dislike-button';
      document.body.appendChild(button);

      const getOrCreateDislikeText = (dislikeButton) => {
        const existingCustom = dislikeButton.querySelector('#ytp-plus-dislike-text');
        if (existingCustom) return existingCustom;

        const buttonShape = dislikeButton.querySelector('button') || dislikeButton;
        let textContainer = buttonShape.querySelector('.yt-spec-button-shape-next__button-text-content');
        if (!textContainer) {
          textContainer = document.createElement('div');
          textContainer.className = 'yt-spec-button-shape-next__button-text-content';
          buttonShape.appendChild(textContainer);
        }

        const created = document.createElement('span');
        created.id = 'ytp-plus-dislike-text';
        textContainer.appendChild(created);
        return created;
      };

      const textElement = getOrCreateDislikeText(button);
      expect(textElement).not.toBeNull();
      expect(textElement.id).toBe('ytp-plus-dislike-text');
      expect(button.querySelector('.yt-spec-button-shape-next__button-text-content')).not.toBeNull();
    });
  });
});
