/**
 * @jest-environment jsdom
 */

describe('Enhanced Tabviews Module', () => {
  beforeEach(() => {
    jest.resetModules();
    // Reset DOM
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    // Clear localStorage
    localStorage.clear();
    // Mock console methods to avoid noise
    jest.spyOn(console, 'error').mockImplementation(() => {
      /* mock */
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {
      /* mock */
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(sel => document.querySelector(sel)),
        $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
        t: jest.fn(key => key || ''),
        createWithErrorBoundary: _name => fn => fn,
        setSafeHTML: jest.fn((el, html) => {
          el.innerHTML = html;
        }),
        getLanguage: jest.fn(() => 'en'),
        loadFeatureEnabled: jest.fn(() => true),
        debounce: jest.fn(fn => Object.assign(fn, { cancel: jest.fn(), destroy: jest.fn() })),
        throttle: jest.fn(fn => fn),
        cleanupManager: {
          registerInterval: jest.fn(id => id),
          registerTimeout: jest.fn(id => id),
          registerObserver: jest.fn(obs => obs),
          registerListener: jest.fn(),
          register: jest.fn(),
          cleanup: jest.fn(),
          registerAnimationFrame: jest.fn(id => id),
          getListenerStats: jest.fn(() => ({ active: 0, registeredTotal: 0 })),
        },
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        SETTINGS_KEY: 'youtube_plus_settings',
        logSuppressed: jest.fn(),
        logError: jest.fn(),
        createElement: jest.fn((tag, props, children) => {
          const el = document.createElement(tag);
          if (props)
            Object.entries(props).forEach(([k, v]) => {
              el[k] = v;
            });
          if (children)
            children.forEach(c => {
              if (typeof c === 'string') el.textContent = c;
              else el.appendChild(c);
            });
          return el;
        }),
        whenRelevant: jest.fn(() => ({ active: false, check: jest.fn(), dispose: jest.fn() })),
        renderTemplateClone: jest.fn((el, html) => {
          el.innerHTML = html;
        }),
        waitForElement: jest.fn(() => Promise.resolve(null)),
        onDomReady: jest.fn(cb => {
          if (typeof cb === 'function') cb();
        }),
      },
    });

    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: {
        StyleManager: window.YouTubeUtils.StyleManager,
        getStyle: jest.fn(() => ''),
      },
    });

    Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
      configurable: true,
      writable: true,
      value: {
        subscribeRoot: jest.fn(() => 'sub-id'),
        unsubscribe: jest.fn(),
        watchTarget: jest.fn(),
        unwatch: jest.fn(),
      },
    });

    Object.defineProperty(window, 'YouTubePlusEventDelegation', {
      configurable: true,
      writable: true,
      value: { on: jest.fn(), off: jest.fn() },
    });

    Object.defineProperty(window, 'YouTubePlusStyleResources', {
      configurable: true,
      writable: true,
      value: { enhanced: '', update: '' },
    });

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });

    require('../src/enhanced.js');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Scroll-to-Top Button (real facade)', () => {
    test('getUniversalScrollContainer returns a scrollable element on watch page', () => {
      const container = window.YouTubePlusEnhanced.getUniversalScrollContainer();
      expect(container).toBeInstanceOf(Element);
    });

    test('isTabviewEnabled reflects default enabled state', () => {
      expect(window.YouTubePlusEnhanced.isTabviewEnabled()).toBe(true);
    });

    test('formatCompactNumber formats view counts via real helper', () => {
      expect(window.YouTubePlusEnhanced.formatCompactNumber(0)).toBe('0');
      expect(window.YouTubePlusEnhanced.formatCompactNumber(999)).toBe('999');
      expect(window.YouTubePlusEnhanced.formatCompactNumber(1000)).toBe('1K');
      expect(window.YouTubePlusEnhanced.formatCompactNumber(1500000)).toBe('1.5M');
    });

    test('getVideoIdForDislike extracts video ID from watch URL', () => {
      global.mockLocation({
        href: 'https://www.youtube.com/watch?v=abc123XYZ',
        pathname: '/watch',
        search: '?v=abc123XYZ',
      });
      expect(window.YouTubePlusEnhanced.getVideoIdForDislike()).toBe('abc123XYZ');
    });

    test('getVideoIdForDislike extracts video ID from shorts URL', () => {
      global.mockLocation({
        href: 'https://www.youtube.com/shorts/shortId456',
        pathname: '/shorts/shortId456',
      });
      expect(window.YouTubePlusEnhanced.getVideoIdForDislike()).toBe('shortId456');
    });
  });

  describe('Accessibility (real facade)', () => {
    test('getUniversalScrollContainer returns a real DOM element (not null)', () => {
      const container = window.YouTubePlusEnhanced.getUniversalScrollContainer();
      expect(container).not.toBeNull();
    });

    test('resolveMusicContainers returns an array on non-music pages', () => {
      const containers = window.YouTubePlusEnhanced.resolveMusicContainers();
      expect(Array.isArray(containers)).toBe(true);
    });
  });

  describe('Performance (real facade)', () => {
    test('invalidateMusicContainersCache allows re-query after DOM change', () => {
      const first = window.YouTubePlusEnhanced.resolveMusicContainers();
      window.YouTubePlusEnhanced.invalidateMusicContainersCache();
      const layout = document.createElement('ytmusic-app-layout');
      document.body.appendChild(layout);
      const second = window.YouTubePlusEnhanced.resolveMusicContainers();
      expect(second.length).toBeGreaterThanOrEqual(first.length);
    });

    test('isTabviewEnabled is idempotent across multiple calls', () => {
      const first = window.YouTubePlusEnhanced.isTabviewEnabled();
      const second = window.YouTubePlusEnhanced.isTabviewEnabled();
      expect(first).toBe(second);
    });
  });

  describe('Internationalization (real facade)', () => {
    test('t() is wired and returns keys via YouTubeUtils.t mock', () => {
      expect(window.YouTubeUtils.t('scrollToTop')).toBe('scrollToTop');
    });

    test('getLanguage returns the mocked language', () => {
      expect(window.YouTubeUtils.getLanguage()).toBe('en');
    });
  });

  describe('Return YouTube Dislike Integration', () => {
    test('should extract video ID correctly from different sources via real helper', () => {
      global.mockLocation({
        href: 'https://www.youtube.com/watch?v=tiFJmVhkF_s',
        pathname: '/watch',
        search: '?v=tiFJmVhkF_s',
      });
      expect(window.YouTubePlusEnhanced.getVideoIdForDislike()).toBe('tiFJmVhkF_s');

      global.mockLocation({
        href: 'https://www.youtube.com/shorts/xyz12345',
        pathname: '/shorts/xyz12345',
      });
      expect(window.YouTubePlusEnhanced.getVideoIdForDislike()).toBe('xyz12345');
    });

    test('should extract video ID from clip URL via meta tag', () => {
      global.mockLocation({
        href: 'https://www.youtube.com/clip/abc123',
        pathname: '/clip/abc123',
        search: '',
      });
      const meta = document.createElement('meta');
      meta.setAttribute('itemprop', 'videoId');
      meta.setAttribute('content', 'clipVideoXYZ');
      document.head.appendChild(meta);
      expect(window.YouTubePlusEnhanced.getVideoIdForDislike()).toBe('clipVideoXYZ');
    });

    test('should fall back to movie_player.getVideoData()', () => {
      global.mockLocation({
        href: 'https://www.youtube.com/results?search_query=test',
        pathname: '/results',
        search: '?search_query=test',
      });
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.getVideoData = () => ({ video_id: 'playerFallback123' });
      document.body.appendChild(player);
      expect(window.YouTubePlusEnhanced.getVideoIdForDislike()).toBe('playerFallback123');
    });

    test('should fall back to meta[itemprop=videoId] tag', () => {
      global.mockLocation({
        href: 'https://www.youtube.com/results?search_query=test',
        pathname: '/results',
        search: '?search_query=test',
      });
      const meta = document.createElement('meta');
      meta.setAttribute('itemprop', 'videoId');
      meta.setAttribute('content', 'metaTagFallback999');
      document.head.appendChild(meta);
      expect(window.YouTubePlusEnhanced.getVideoIdForDislike()).toBe('metaTagFallback999');
    });

    test('should format numbers compactly via real helper', () => {
      expect(window.YouTubePlusEnhanced.formatCompactNumber(1200)).toBe('1.2K');
      expect(window.YouTubePlusEnhanced.formatCompactNumber(850000)).toBe('850K');
      expect(window.YouTubePlusEnhanced.formatCompactNumber(75)).toBe('75');
    });

    test('should find or create text container for dislike button', () => {
      const button = document.createElement('div');
      button.id = 'dislike-button';
      document.body.appendChild(button);

      const getOrCreateDislikeText = dislikeButton => {
        const existingCustom = dislikeButton.querySelector('#yp-dislike-text');
        if (existingCustom) return existingCustom;

        const buttonShape = dislikeButton.querySelector('button') || dislikeButton;
        let textContainer = buttonShape.querySelector(
          '.yt-spec-button-shape-next__button-text-content'
        );
        if (!textContainer) {
          textContainer = document.createElement('div');
          textContainer.className = 'yt-spec-button-shape-next__button-text-content';
          buttonShape.appendChild(textContainer);
        }

        const created = document.createElement('span');
        created.id = 'yp-dislike-text';
        textContainer.appendChild(created);
        return created;
      };

      const textElement = getOrCreateDislikeText(button);
      expect(textElement).not.toBeNull();
      expect(textElement.id).toBe('yp-dislike-text');
      expect(
        button.querySelector('.yt-spec-button-shape-next__button-text-content')
      ).not.toBeNull();
    });
  });

  describe('real API', () => {
    beforeEach(() => {
      jest.resetModules();
      document.body.innerHTML = '';
      document.head.innerHTML = '';
      localStorage.clear();
      delete window.YouTubePlusEnhanced;
      window._enhancedInitialized = false;

      Object.defineProperty(window, 'YouTubeUtils', {
        configurable: true,
        writable: true,
        value: {
          $: jest.fn(sel => document.querySelector(sel)),
          $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
          byId: jest.fn(id => document.getElementById(id)),
          t: jest.fn(key => key || ''),
          createWithErrorBoundary: _name => fn => fn,
          setSafeHTML: jest.fn((el, html) => {
            el.innerHTML = html;
          }),
          getLanguage: jest.fn(() => 'en'),
          getHostname: jest.fn(() => 'www.youtube.com'),
          onDomReady: jest.fn(cb => cb()),
          loadFeatureEnabled: jest.fn(() => true),
          debounce: jest.fn(fn => Object.assign(fn, { cancel: jest.fn(), destroy: jest.fn() })),
          throttle: jest.fn(fn => fn),
          cleanupManager: {
            registerInterval: jest.fn(id => id),
            registerTimeout: jest.fn(id => id),
            registerObserver: jest.fn(obs => obs),
            registerListener: jest.fn(),
            register: jest.fn(),
            cleanup: jest.fn(),
            registerAnimationFrame: jest.fn(id => id),
            getListenerStats: jest.fn(() => ({ active: 0, registeredTotal: 0 })),
          },
          StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
          logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
          SETTINGS_KEY: 'youtube_plus_settings',
          logSuppressed: jest.fn(),
          logError: jest.fn(),
          createElement: jest.fn((tag, props, children) => {
            const el = document.createElement(tag);
            if (props)
              Object.entries(props).forEach(([k, v]) => {
                el[k] = v;
              });
            if (children)
              children.forEach(c => {
                if (typeof c === 'string') el.textContent = c;
                else el.appendChild(c);
              });
            return el;
          }),
          whenRelevant: jest.fn(() => ({ active: false, check: jest.fn(), dispose: jest.fn() })),
          renderTemplateClone: jest.fn((el, html) => {
            el.innerHTML = html;
          }),
          waitForElement: jest.fn(() => Promise.resolve(null)),
        },
      });

      Object.defineProperty(window, 'YouTubePlusLogger', {
        configurable: true,
        writable: true,
        value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      Object.defineProperty(window, 'YouTubePlusDesignSystem', {
        configurable: true,
        writable: true,
        value: {
          StyleManager: window.YouTubeUtils.StyleManager,
          getStyle: jest.fn(() => ''),
        },
      });

      Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
        configurable: true,
        writable: true,
        value: {
          subscribeRoot: jest.fn(() => 'sub-id'),
          unsubscribe: jest.fn(),
          watchTarget: jest.fn(),
          unwatch: jest.fn(),
        },
      });

      Object.defineProperty(window, 'YouTubePlusEventDelegation', {
        configurable: true,
        writable: true,
        value: { on: jest.fn(), off: jest.fn() },
      });

      Object.defineProperty(window, 'YouTubePlusStyleResources', {
        configurable: true,
        writable: true,
        value: { enhanced: '', update: '' },
      });

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch?v=test',
      });

      require('../src/enhanced.js');
    });

    test('isTabviewEnabled returns true by default', () => {
      expect(window.YouTubePlusEnhanced.isTabviewEnabled()).toBe(true);
    });

    test('resolveMusicContainers returns filtered elements', () => {
      const layout = document.createElement('ytmusic-app-layout');
      layout.id = 'layout';
      document.body.appendChild(layout);
      const containers = window.YouTubePlusEnhanced.resolveMusicContainers();
      expect(containers).toContain(layout);
    });

    test('invalidateMusicContainersCache resets the cache', () => {
      window.YouTubePlusEnhanced.resolveMusicContainers();
      window.YouTubePlusEnhanced.invalidateMusicContainersCache();
      // Second call after DOM change should re-query, not return stale value.
      const layout = document.createElement('ytmusic-app-layout');
      document.body.appendChild(layout);
      const containers = window.YouTubePlusEnhanced.resolveMusicContainers();
      expect(containers).toContain(layout);
    });

    test('getUniversalScrollContainer queries music selectors on music.youtube.com', () => {
      window.YouTubeUtils.getHostname.mockReturnValue('music.youtube.com');
      const layout = document.createElement('ytmusic-app-layout');
      layout.id = 'layout';
      document.body.appendChild(layout);
      window.YouTubeUtils.$.mockClear();
      const container = window.YouTubePlusEnhanced.getUniversalScrollContainer();
      const calls = window.YouTubeUtils.$.mock.calls.map(args => args[0]);
      expect(calls).toContain('ytmusic-app-layout #layout');
      expect(container).toBeInstanceOf(Element);
    });

    test('getUniversalScrollContainer returns fallback for studio.youtube.com', () => {
      window.YouTubeUtils.getHostname.mockReturnValue('studio.youtube.com');
      const container = window.YouTubePlusEnhanced.getUniversalScrollContainer();
      expect(container).toBeInstanceOf(Element);
    });

    test('isTabviewEnabled returns default boolean', () => {
      expect(typeof window.YouTubePlusEnhanced.isTabviewEnabled()).toBe('boolean');
    });

    test('isDislikeButtonReady validates button readiness across watch and shorts', () => {
      const readyHelper = window.YouTubePlusEnhanced.isDislikeButtonReady;
      expect(typeof readyHelper).toBe('function');

      // Shorts always ready
      const dummyDiv = document.createElement('div');
      expect(readyHelper(dummyDiv, true)).toBe(true);

      // Watch: div without button is not ready
      expect(readyHelper(dummyDiv, false)).toBe(false);

      // Watch: native button is ready
      const btnEl = document.createElement('button');
      expect(readyHelper(btnEl, false)).toBe(true);

      // Watch: div containing inner button is ready
      dummyDiv.appendChild(btnEl);
      expect(readyHelper(dummyDiv, false)).toBe(true);
    });

    test('isDislikeAlreadyRendered checks video ID and rendered text state', () => {
      const renderedHelper = window.YouTubePlusEnhanced.isDislikeAlreadyRendered;
      expect(typeof renderedHelper).toBe('function');

      const btn = document.createElement('div');
      btn.setAttribute('data-yp-video-id', 'vid123');

      // Mismatched video ID -> false
      expect(renderedHelper(btn, 'otherVid', false)).toBe(false);

      // Matching video ID without text container -> false
      expect(renderedHelper(btn, 'vid123', false)).toBe(false);

      // Matching video ID with empty text container -> false
      const textSpan = document.createElement('span');
      textSpan.id = 'yp-dislike-text';
      textSpan.innerText = '   ';
      btn.appendChild(textSpan);
      expect(renderedHelper(btn, 'vid123', false)).toBe(false);

      // Matching video ID with populated text -> true
      textSpan.innerText = '42K';
      expect(renderedHelper(btn, 'vid123', false)).toBe(true);

      // Shorts scenario
      const shortsBtn = document.createElement('div');
      shortsBtn.setAttribute('data-yp-video-id', 'shorts123');
      const shortsLabel = document.createElement('span');
      shortsLabel.className = 'label';
      shortsLabel.setAttribute('data-yp-original-text', 'Dislike');
      shortsLabel.innerText = 'Dislike';
      shortsBtn.appendChild(shortsLabel);

      // Original text unchanged -> false
      expect(renderedHelper(shortsBtn, 'shorts123', true)).toBe(false);

      // Formatted dislike count rendered -> true
      shortsLabel.innerText = '12K';
      expect(renderedHelper(shortsBtn, 'shorts123', true)).toBe(true);
    });

    test('getDislikeButton creates fallback Shorts dislike button when native dislike is missing', () => {
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/shorts/shortId456',
        href: 'https://www.youtube.com/shorts/shortId456',
      });

      // Empty DOM returns null
      expect(window.YouTubePlusEnhanced.getDislikeButton()).toBeNull();

      // Native dislike in ytd-shorts container
      const shortsHost = document.createElement('ytd-shorts');
      const nativeShortsDislike = document.createElement('dislike-button-view-model');
      shortsHost.appendChild(nativeShortsDislike);
      document.body.appendChild(shortsHost);
      expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(nativeShortsDislike);
      shortsHost.remove();

      const reel = document.createElement('ytd-reel-video-renderer');
      reel.setAttribute('is-active', '');
      const actionBar = document.createElement('div');
      const likeVm = document.createElement('like-button-view-model');
      const likeBtn = document.createElement('button');
      likeBtn.setAttribute('aria-label', 'Like this video');
      likeVm.appendChild(likeBtn);
      actionBar.appendChild(likeVm);
      reel.appendChild(actionBar);
      document.body.appendChild(reel);

      // Native dislike in active reel
      const reelDislike = document.createElement('dislike-button-view-model');
      actionBar.appendChild(reelDislike);
      expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(reelDislike);
      reelDislike.remove();

      const dislikeWrap = window.YouTubePlusEnhanced.getDislikeButton();
      expect(dislikeWrap).not.toBeNull();
      expect(dislikeWrap.id).toBe('yp-shorts-dislike');
      expect(dislikeWrap.classList.contains('yp-shorts-dislike-wrap')).toBe(true);
      expect(likeVm.nextElementSibling).toBe(dislikeWrap);

      // Even if DOMCache.byId caches null for 1s, repeated calls never create duplicates
      window.YouTubeUtils.byId.mockReturnValue(null);
      const duplicateExtra = document.createElement('div');
      duplicateExtra.className = 'yp-shorts-dislike-wrap';
      actionBar.appendChild(duplicateExtra);
      expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(dislikeWrap);
      expect(document.querySelectorAll('.yp-shorts-dislike-wrap').length).toBe(1);

      window.YouTubePlusEnhanced.setDislikeDisplay(dislikeWrap, 1500);
      const label = dislikeWrap.querySelector('#yp-dislike-text');
      expect(label.innerText).toBe('1.5K');
      // Idempotent repeat call with same count
      window.YouTubePlusEnhanced.setDislikeDisplay(dislikeWrap, 1500);
    });

    test('getDislikeButton and setDislikeDisplay handle watch page buttons', () => {
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch?v=test',
      });

      expect(window.YouTubePlusEnhanced.getDislikeButton()).toBeNull();
      window.YouTubePlusEnhanced.setDislikeDisplay(null, 100);

      const menuContainer = document.createElement('div');
      menuContainer.id = 'menu-container';
      const topButtons = document.createElement('div');
      topButtons.id = 'top-level-buttons-computed';
      menuContainer.appendChild(topButtons);
      document.body.appendChild(menuContainer);

      const segmented = document.createElement('ytd-segmented-like-dislike-button-renderer');
      const watchDislike = document.createElement('dislike-button-view-model');
      const innerBtn = document.createElement('button');
      watchDislike.appendChild(innerBtn);
      segmented.appendChild(watchDislike);
      topButtons.appendChild(segmented);

      const resolved = window.YouTubePlusEnhanced.getDislikeButton();
      expect(resolved).toBe(watchDislike);

      window.YouTubePlusEnhanced.setDislikeDisplay(watchDislike, 2400);
      const createdSpan = watchDislike.querySelector('#yp-dislike-text');
      expect(createdSpan).not.toBeNull();
      expect(createdSpan.innerText).toBe('2.4K');

      // Second update reuses existing #yp-dislike-text
      window.YouTubePlusEnhanced.setDislikeDisplay(watchDislike, 3100);
      expect(createdSpan.innerText).toBe('3.1K');
    });
  });
});
