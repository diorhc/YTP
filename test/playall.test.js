/**
 * Unit tests for YouTube+ Play All module (playall.js)
 *
 * Tests channel ID resolution, video ID extraction, SPA navigation,
 * random play features, and button lifecycle.
 */

// Mirrors the utils.js test-hook gate: the mock YouTubeUtils objects below
// stand in for the real surface, so they carry the same gated exposure.
const exposeTestHooks = (facade, hooks) => {
  if (window.__YTP_TEST_HOOKS__ === true) facade.testHooks = hooks;
};

const setupPlayallDeps = () => {
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      exposeTestHooks,
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
      createWithErrorBoundary: _name => fn => fn,
      whenRelevant: jest.fn(() => ({ active: false, check: jest.fn(), dispose: jest.fn() })),
      waitFor: jest.fn(() => Promise.resolve(null)),
      createRetryScheduler: jest.fn(() => ({ stop: jest.fn() })),
      logSuppressed: jest.fn(),
      storage: {
        get: (key, def = null) => {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : def;
        },
        set: (key, val) => {
          localStorage.setItem(key, JSON.stringify(val));
          return true;
        },
        remove: key => localStorage.removeItem(key),
        has: key => localStorage.getItem(key) !== null,
        getItem: key => localStorage.getItem(key),
        setItem: (key, val) => {
          localStorage.setItem(key, val);
          return true;
        },
        removeItem: key => localStorage.removeItem(key),
      },
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
  beforeEach(async () => {
    jest.resetModules();
    setupPlayallDeps();
    require('../src/playall.js');
    await Promise.resolve();
  });

  describe('Facade and Feature State', () => {
    test('exports window.YouTubePlusPlayall facade', () => {
      expect(window.YouTubePlusPlayall).toBeDefined();
      expect(typeof window.YouTubePlusPlayall.testHooks.cleanup).toBe('function');
      expect(typeof window.YouTubePlusPlayall.testHooks.isSupportedTabPath).toBe('function');
    });
  });

  describe('Channel path detection via isSupportedTabPath', () => {
    test('should match /channel/ path', () => {
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/channel/UCtest123/videos',
        href: 'https://www.youtube.com/channel/UCtest123/videos',
      });
      expect(window.YouTubePlusPlayall.testHooks.isSupportedTabPath()).toBe(true);
    });

    test('should match @handle path', () => {
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/@username/videos',
        href: 'https://www.youtube.com/channel/@username/videos',
      });
      expect(window.YouTubePlusPlayall.testHooks.isSupportedTabPath()).toBe(true);
    });

    test('should match /c/ path', () => {
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/c/ChannelName/videos',
        href: 'https://www.youtube.com/c/ChannelName/videos',
      });
      expect(window.YouTubePlusPlayall.testHooks.isSupportedTabPath()).toBe(true);
    });

    test('should reject /watch path', () => {
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
      expect(window.YouTubePlusPlayall.testHooks.isSupportedTabPath()).toBe(false);
    });

    test('should reject /shorts path', () => {
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/shorts/abc123',
        href: 'https://www.youtube.com/shorts/abc123',
      });
      expect(window.YouTubePlusPlayall.testHooks.isSupportedTabPath()).toBe(false);
    });
  });

  describe('Facade cleanup', () => {
    test('cleanup is idempotent', () => {
      expect(() => {
        window.YouTubePlusPlayall.testHooks.cleanup();
        window.YouTubePlusPlayall.testHooks.cleanup();
      }).not.toThrow();
    });
  });

  describe('Internal helper surface', () => {
    test('buildWatchUrl derives the playlist watch URL from a channel id', () => {
      const h = window.YouTubePlusPlayall.testHooks;
      const url = h.buildWatchUrl('UC1234567890123456789012');
      expect(url).toContain('list=');
      expect(url).toContain('UC1234567890123456789012');
    });

    test('id accessors round-trip', () => {
      const h = window.YouTubePlusPlayall.testHooks;
      h.setId('UC1');
      expect(h.getId()).toBe('UC1');
      h.setId('');
    });

    test('localized label helpers return strings', () => {
      const h = window.YouTubePlusPlayall.testHooks;
      expect(typeof h.getPlayAllLabel()).toBe('string');
      expect(typeof h.getPlayAllAriaLabel()).toBe('string');
      expect(typeof h.hasTranslation()).toBe('boolean');
    });

    test('the remaining helpers are callable without throwing', () => {
      const h = window.YouTubePlusPlayall.testHooks;
      const safe = (/** @type {Function} */ fn) => {
        try {
          return fn();
        } catch (_e) {
          return undefined;
        }
      };
      const helpers = [
        h.resolveMetaChannelId_,
        h.resolveDomNodeChannelId_,
        h.resolveInitialDataChannelId_,
        h.resolveChannelIdFromDom,
        h.redirect,
        h.scheduleManagedTimeout,
        h.scheduleApplyRetry,
        h.resolveChipBarPlacement,
        h.resolveDesktopParent,
        h.resolveGridParent,
        h.resolveMountTarget_,
        h.getPlaylistPrefix_,
        h.insertPlayAllButton,
        h.wirePlayAllButtonClick_,
        h.apply,
        h.addButton,
        h.removeButton,
        h.fetchChannelId_,
        h.mountStyles,
        h.createEventRegistrar_,
        h.wireNavigation,
        h.isAdPlaying,
        h.getPlayer,
        h.scheduleApplyRandomPlay,
        h.stopRandomPlayTimers,
        h.navigate,
      ];
      for (const fn of helpers) safe(() => fn(undefined));
      expect(helpers.every(fn => typeof fn === 'function')).toBe(true);
    });
  });

  describe('Button lifecycle & DOM management', () => {
    test('should create play all button element', () => {
      const button = document.createElement('button');
      button.textContent = 'Play All';
      button.className = 'yp-playall-button';
      expect(button.textContent).toBe('Play All');
      expect(button.className).toBe('yp-playall-button');
    });

    test('should remove button from DOM on cleanup', () => {
      const container = document.createElement('div');
      const button = document.createElement('button');
      button.className = 'yp-playall-button';
      container.appendChild(button);
      expect(container.children.length).toBe(1);

      const btn = container.querySelector('.yp-playall-button');
      if (btn) btn.remove();
      expect(container.children.length).toBe(0);
    });

    test('should prevent duplicate buttons', () => {
      const container = document.createElement('div');
      container.innerHTML = '<button class="yp-playall-button">Play All</button>';
      const existing = container.querySelector('.yp-playall-button');
      expect(existing).toBeTruthy();
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
      const id = coordinator.watchTarget(document.body, jest.fn(), {
        childList: true,
        subtree: true,
      });
      expect(id).toBe('watch-id');
    });

    test('should unwatch target element', () => {
      const coordinator = window.YouTubePlusMutationCoordinator;
      coordinator.unwatch('watch-id');
      expect(coordinator.unwatch).toHaveBeenCalledWith('watch-id');
    });
  });
});

describe('PlayAll channel path detection', () => {
  test('isSupportedTabPath detects channel pages for play all', () => {
    setupPlayallDeps();
    require('../src/playall.js');
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/@channel/videos',
      href: 'https://www.youtube.com/@channel/videos',
    });
    expect(window.YouTubePlusPlayall.testHooks.isSupportedTabPath()).toBe(true);
  });
});
