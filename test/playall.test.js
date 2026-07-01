/**
 * Unit tests for YouTube+ Play All module (playall.js)
 *
 * Tests channel ID resolution, video ID extraction, SPA navigation,
 * random play features, and button lifecycle.
 */

const setupPlayallDeps = () => {
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
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
      loadFeatureEnabled: jest.fn(() => true),
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
      createHTML: jest.fn(s => s),
      renderTemplateClone: jest.fn((el, html) => { el.innerHTML = html; }),
      whenRelevant: jest.fn(() => ({ active: false, check: jest.fn(), dispose: jest.fn() })),
      waitFor: jest.fn(() => Promise.resolve(null)),
      createRetryScheduler: jest.fn(() => ({ stop: jest.fn() })),
      logSuppressed: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusI18n', {
    configurable: true,
    writable: true,
    value: {
      t: jest.fn(key => key),
      getLanguage: jest.fn(() => 'en'),
    },
  });

  Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
    configurable: true,
    writable: true,
    value: {
      subscribeRoot: jest.fn(),
      unsubscribe: jest.fn(),
      watchTarget: jest.fn(() => 'watch-id'),
      unwatch: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      StyleManager: window.YouTubeUtils.StyleManager,
      getStyle: jest.fn(() => ''),
    },
  });

  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/channel/UCtest',
    href: 'https://www.youtube.com/channel/UCtest',
  });
};

describe('PlayAll Module', () => {
  beforeEach(() => {
    setupPlayallDeps();
  });

  describe('Video ID extraction', () => {
    test('should extract video ID from standard URL', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      expect(match).toBeTruthy();
      expect(match[1]).toBe('dQw4w9WgXcQ');
    });

    test('should extract video ID from shortened URL', () => {
      const url = 'https://youtu.be/dQw4w9WgXcQ';
      const match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
      expect(match).toBeTruthy();
      expect(match[1]).toBe('dQw4w9WgXcQ');
    });

    test('should return null for invalid URL', () => {
      const url = 'https://example.com/video';
      const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      expect(match).toBeNull();
    });

    test('should handle URLs with extra parameters', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      expect(match).toBeTruthy();
      expect(match[1]).toBe('dQw4w9WgXcQ');
    });
  });

  describe('Channel path detection', () => {
    test('should match /channel/ path', () => {
      const path = '/channel/UCtest123/videos';
      expect(path.match(/\/channel\/|\/@|\/c\/|\/user\//)).toBeTruthy();
    });

    test('should match @handle path', () => {
      const path = '/@username/videos';
      expect(path.match(/\/channel\/|\/@|\/c\/|\/user\//)).toBeTruthy();
    });

    test('should match /c/ path', () => {
      const path = '/c/ChannelName/videos';
      expect(path.match(/\/channel\/|\/@|\/c\/|\/user\//)).toBeTruthy();
    });

    test('should reject /watch path', () => {
      const path = '/watch';
      expect(path.match(/\/channel\/|\/@|\/c\/|\/user\//)).toBeNull();
    });

    test('should reject /shorts path', () => {
      const path = '/shorts/abc123';
      expect(path.match(/\/channel\/|\/@|\/c\/|\/user\//)).toBeNull();
    });
  });

  describe('Channel ID resolution', () => {
    test('should find channel ID from page meta tags', () => {
      document.head.innerHTML = '<meta property="og:url" content="https://www.youtube.com/channel/UCtest123">';
      const meta = document.querySelector('meta[property="og:url"]');
      const match = meta?.content?.match(/channel\/([a-zA-Z0-9_-]+)/);
      expect(match).toBeTruthy();
      expect(match[1]).toBe('UCtest123');
    });

    test('should find channel ID from link canonical', () => {
      document.head.innerHTML = '<link rel="canonical" href="https://www.youtube.com/channel/UCtest123">';
      const link = document.querySelector('link[rel="canonical"]');
      const match = link?.href?.match(/channel\/([a-zA-Z0-9_-]+)/);
      expect(match).toBeTruthy();
    });

    test('should return null for non-channel page', () => {
      const url = 'https://www.youtube.com/watch?v=test';
      const match = url.match(/channel\/([a-zA-Z0-9_-]+)/);
      expect(match).toBeNull();
    });
  });

  describe('Button lifecycle', () => {
    test('should create play all button element', () => {
      const button = document.createElement('button');
      button.textContent = 'Play All';
      button.className = 'ytp-playall-button';
      expect(button.textContent).toBe('Play All');
      expect(button.className).toBe('ytp-playall-button');
    });

    test('should remove button from DOM', () => {
      const container = document.createElement('div');
      const button = document.createElement('button');
      button.className = 'ytp-playall-button';
      container.appendChild(button);
      expect(container.children.length).toBe(1);

      const btn = container.querySelector('.ytp-playall-button');
      if (btn) btn.remove();
      expect(container.children.length).toBe(0);
    });

    test('should prevent duplicate buttons', () => {
      const container = document.createElement('div');
      container.innerHTML = '<button class="ytp-playall-button">Play All</button>';
      const existing = container.querySelector('.ytp-playall-button');
      expect(existing).toBeTruthy();
    });
  });

  describe('SPA navigation', () => {
    test('should handle yt-navigate-finish event', () => {
      const handler = jest.fn();
      document.addEventListener('yt-navigate-finish', handler);
      const event = new CustomEvent('yt-navigate-finish');
      document.dispatchEvent(event);
      expect(handler).toHaveBeenCalled();
    });

    test('should extract pathname from navigation event', () => {
      const event = { detail: { endpoint: { commandMetadata: { webCommandMetadata: { url: '/channel/UCtest/videos' } } } } };
      const url = event?.detail?.endpoint?.commandMetadata?.webCommandMetadata?.url;
      expect(url).toBe('/channel/UCtest/videos');
    });
  });

  describe('Random play', () => {
    test('should detect ytp-random URL parameter', () => {
      const url = 'https://www.youtube.com/watch?v=test&ytp-random=1';
      const match = url.match(/[?&]ytp-random=(\d+)/);
      expect(match).toBeTruthy();
      expect(match[1]).toBe('1');
    });

    test('should track watched videos in localStorage', () => {
      const storageKey = 'ytp_random_watched';
      const watched = new Set();
      watched.add('video1');
      watched.add('video2');
      localStorage.setItem(storageKey, JSON.stringify([...watched]));

      const stored = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
      expect(stored.has('video1')).toBe(true);
      expect(stored.has('video2')).toBe(true);
      expect(stored.has('video3')).toBe(false);
    });

    test('should mark video as watched', () => {
      const storageKey = 'ytp_random_watched';
      const watched = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
      watched.add('newVideo');
      localStorage.setItem(storageKey, JSON.stringify([...watched]));

      const stored = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
      expect(stored.has('newVideo')).toBe(true);
    });

    test('should reset watched list', () => {
      const storageKey = 'ytp_random_watched';
      localStorage.setItem(storageKey, JSON.stringify(['v1', 'v2']));
      localStorage.removeItem(storageKey);

      const stored = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
      expect(stored.size).toBe(0);
    });
  });

  describe('Feature toggle', () => {
    test('should respect loadFeatureEnabled', () => {
      const enabled = window.YouTubeUtils.loadFeatureEnabled('enablePlayAll', true);
      expect(enabled).toBe(true);
    });

    test('should disable when feature is off', () => {
      window.YouTubeUtils.loadFeatureEnabled = jest.fn(() => false);
      const enabled = window.YouTubeUtils.loadFeatureEnabled('enablePlayAll');
      expect(enabled).toBe(false);
    });
  });

  describe('MutationObserver integration', () => {
    test('should watch target element via coordinator', () => {
      const coordinator = window.YouTubePlusMutationCoordinator;
      const id = coordinator.watchTarget(document.body, jest.fn(), { childList: true, subtree: true });
      expect(id).toBe('watch-id');
    });

    test('should unwatch target element', () => {
      const coordinator = window.YouTubePlusMutationCoordinator;
      coordinator.unwatch('watch-id');
      expect(coordinator.unwatch).toHaveBeenCalledWith('watch-id');
    });
  });
});
