/**
 * @jest-environment jsdom
 *
 * Tests exercise the real AdBlocker object exported by src/adblocker.js.
 * Earlier versions of this file only asserted strings and mocked a local
 * harness; now every test calls the real module surface.
 */

describe('Adblocker Module', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusAdBlocker;
    delete window.AdBlocker;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    window._ytplusCreateHTML = s => s;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });

    const cleanupManager = {
      registerInterval: jest.fn(id => id),
      registerTimeout: jest.fn(id => id),
      registerObserver: jest.fn(obs => obs),
      // Add the real listener so ctx-wired reactions and the registry's
      // navigation listener actually fire on dispatched events.
      registerListener: jest.fn((target, event, fn, opts) => {
        target?.addEventListener?.(event, fn, opts);
        return Symbol('listener');
      }),
      unregisterListener: jest.fn(),
      cleanup: jest.fn(),
      registerAnimationFrame: jest.fn(id => id),
      register: jest.fn(),
      timeout: jest.fn(),
    };

    // The ctx-based wiring reads window.YouTubePlusCleanupManager while the
    // module's own boot-time reactions still use U.cleanupManager; both read
    // the same mock.
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: cleanupManager,
    });
    // The lifecycle gate reads this store; `get` stays undefined (= enabled).
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: { get: jest.fn(), subscribe: jest.fn(() => jest.fn()) },
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn((sel, ctx = document) => ctx.querySelector(sel)),
        $$: jest.fn((sel, ctx = document) => Array.from(ctx.querySelectorAll(sel))),
        t: jest.fn(key => key || ''),
        cleanupManager,
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        loadFeatureEnabled: jest.fn(() => true),
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        logSuppressed: jest.fn(),
        SETTINGS_KEY: 'youtube_plus_settings',
        createWithErrorBoundary: jest.fn(_label => fn => fn),
        // Mirrors the real utils route mapping for the lifecycle gate.
        getRoute: jest.fn(() => {
          const p = window.location.pathname || '/';
          if (p === '/watch') return 'watch';
          if (p.startsWith('/shorts')) return 'shorts';
          if (p === '/') return 'home';
          if (p === '/results') return 'search';
          if (p.startsWith('/feed/')) return 'feed';
          if (p.startsWith('/@') || p.startsWith('/channel/')) return 'channel';
          return 'other';
        }),
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
        loadTranslations: jest.fn(),
        isReady: jest.fn(() => true),
      },
    });

    Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
      configurable: true,
      writable: true,
      value: {
        watchTarget: jest.fn(),
        unwatch: jest.fn(),
        subscribeRoot: jest.fn(),
        unsubscribe: jest.fn(),
      },
    });

    delete window.YouTubePlusFeatureRegistry;
    require('../src/feature-registry.js');
    require('../src/adblocker.js');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should have required globals for initialization', () => {
    expect(window._ytplusCreateHTML).toBeDefined();
    expect(window.YouTubeUtils).toBeDefined();
    expect(window.YouTubeUtils.$).toBeDefined();
  });

  test('real AdBlocker exposes canonical YouTubePlusAdBlocker and AdBlocker facades', () => {
    expect(window.YouTubePlusAdBlocker).toBeDefined();
    expect(window.AdBlocker).toBe(window.YouTubePlusAdBlocker);
    expect(typeof window.YouTubePlusAdBlocker.skipAd).toBe('function');
    expect(typeof window.YouTubePlusAdBlocker.dismissAdBlockerWarning).toBe('function');
    expect(typeof window.YouTubePlusAdBlocker.addCss).toBe('function');
    expect(typeof window.YouTubePlusAdBlocker.removeCss).toBe('function');
    expect(typeof window.YouTubePlusAdBlocker.removeElements).toBe('function');
    expect(typeof window.YouTubePlusAdBlocker.settings.load).toBe('function');
    expect(typeof window.YouTubePlusAdBlocker.settings.save).toBe('function');
  });

  test('real AdBlocker defines ad-related CSS selectors', () => {
    const selectors = window.AdBlocker.selectors;
    expect(selectors.ads).toContain('.ytp-ad-overlay-container');
    expect(selectors.elements).toContain('#masthead-ad');
    expect(selectors.removal).toContain('ytd-ad-slot-renderer');
  });

  test('removeElements handles missing ad elements gracefully', () => {
    expect(() => window.AdBlocker.removeElements()).not.toThrow();
  });

  test('addCss injects styles through StyleManager when enabled', () => {
    window.AdBlocker.addCss();

    expect(window.YouTubeUtils.StyleManager.add).toHaveBeenCalledWith(
      'yt-ab-styles',
      expect.stringContaining('.ytp-ad-overlay-container')
    );
  });

  test('the runtime no longer carries its own enable flag', () => {
    // The main `enableAdBlocker` switch and the feature lifecycle own the
    // on/off state; the module is only loaded while it is running.
    expect(window.AdBlocker.config.enabled).toBeUndefined();
  });

  test('removeCss removes styles through StyleManager', () => {
    window.AdBlocker.removeCss();
    expect(window.YouTubeUtils.StyleManager.remove).toHaveBeenCalledWith('yt-ab-styles');
  });

  test('settings.save persists the logging preference and load restores it', () => {
    window.AdBlocker.config.enableLogging = true;

    window.AdBlocker.settings.save();
    expect(localStorage.getItem('youtube_adblocker_settings')).toContain('"enableLogging":true');

    window.AdBlocker.config.enableLogging = false;

    window.AdBlocker.settings.load();
    expect(window.AdBlocker.config.enableLogging).toBe(true);
  });

  test('skipAd does not throw when no player is present', () => {
    document.body.innerHTML = '';
    window.AdBlocker.state.lastSkipAttempt = 0;

    expect(() => window.AdBlocker.skipAd()).not.toThrow();
  });

  test('skipAd clicks the first visible skip button when an ad is showing', () => {
    window.AdBlocker.state.lastSkipAttempt = 0;

    const moviePlayer = document.createElement('div');
    moviePlayer.id = 'movie_player';
    moviePlayer.classList.add('ad-showing');

    const skipButton = document.createElement('button');
    skipButton.className = 'ytp-ad-skip-button';
    skipButton.textContent = 'Skip Ad';

    // jsdom always returns an empty bounding rect. Stub getBoundingClientRect
    // so the real skipAd code sees the button as visible.
    skipButton.getBoundingClientRect = () => ({
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      right: 100,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    moviePlayer.appendChild(skipButton);
    document.body.appendChild(moviePlayer);

    const clickSpy = jest.spyOn(skipButton, 'click');

    window.AdBlocker.skipAd();

    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
    moviePlayer.remove();
  });

  test('dismissAdBlockerWarning clicks the allow button on an enforcement message', () => {
    const enforcement = document.createElement('ytd-enforcement-message-view-model');
    const allowBtn = document.createElement('button');
    allowBtn.textContent = 'Allow YouTube ads';
    enforcement.appendChild(allowBtn);
    document.body.appendChild(enforcement);

    const clickSpy = jest.spyOn(allowBtn, 'click');

    window.AdBlocker.dismissAdBlockerWarning();

    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
    enforcement.remove();
  });

  describe('skip strategies', () => {
    test('skipAd mutes and seeks through the ad when no skip button is visible', () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.classList.add('ad-showing');
      document.body.appendChild(player);
      const video = /** @type {any} */ (document.createElement('video'));
      video.className = 'html5-main-video';
      // jsdom's media getters report no metadata; hand the stub its duration.
      Object.defineProperty(video, 'duration', { value: 30, configurable: true });
      document.body.appendChild(video);
      window.AdBlocker.state.lastSkipAttempt = 0;

      window.AdBlocker.skipAd();

      expect(video.muted).toBe(true);
      expect(video.currentTime).toBe(29.9);
    });

    test('skipAd clicks the overlay close control as the last strategy', () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.classList.add('ad-showing');
      document.body.appendChild(player);
      const close = document.createElement('button');
      close.className = 'ytp-ad-overlay-close-button';
      document.body.appendChild(close);
      const clickSpy = jest.spyOn(close, 'click');
      window.AdBlocker.state.lastSkipAttempt = 0;

      window.AdBlocker.skipAd();
      expect(clickSpy).toHaveBeenCalled();
    });

    test('skipAd throttles repeated attempts within 300ms', () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.classList.add('ad-showing');
      document.body.appendChild(player);
      const close = document.createElement('button');
      close.className = 'ytp-ad-overlay-close-button';
      document.body.appendChild(close);
      const clickSpy = jest.spyOn(close, 'click');
      window.AdBlocker.state.lastSkipAttempt = 0;

      window.AdBlocker.skipAd();
      // Immediate second attempt is throttled away.
      window.AdBlocker.skipAd();
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('warning dismissal strategies', () => {
    test('dismisses a paper-dialog warning through its dismiss button', () => {
      const dialog = document.createElement('tp-yt-paper-dialog');
      dialog.textContent = 'Ad blockers are not allowed on YouTube';
      const dismissBtn = document.createElement('button');
      dismissBtn.className = 'dismiss-button';
      dismissBtn.textContent = 'Dismiss';
      dialog.appendChild(dismissBtn);
      document.body.appendChild(dialog);
      const clickSpy = jest.spyOn(dismissBtn, 'click');

      window.AdBlocker.dismissAdBlockerWarning();
      expect(clickSpy).toHaveBeenCalled();
    });

    test('a warning dialog without matching buttons is hidden and removed', () => {
      const dialog = document.createElement('tp-yt-paper-dialog');
      dialog.textContent = 'Ads will be blocked';
      document.body.appendChild(dialog);

      window.AdBlocker.dismissAdBlockerWarning();
      expect(dialog.isConnected).toBe(false);
    });

    test('non-warning dialogs are left untouched', () => {
      const dialog = document.createElement('tp-yt-paper-dialog');
      dialog.textContent = 'Rate this video';
      document.body.appendChild(dialog);

      window.AdBlocker.dismissAdBlockerWarning();
      expect(dialog.isConnected).toBe(true);
    });

    test('visible backdrops are hidden to free interaction', () => {
      const backdrop = document.createElement('tp-yt-iron-overlay-backdrop');
      Object.defineProperty(backdrop, 'offsetParent', { value: document.body, configurable: true });
      backdrop.style.display = 'block';
      document.body.appendChild(backdrop);

      window.AdBlocker.dismissAdBlockerWarning();
      expect(backdrop.style.display).toBe('none');
    });
  });

  describe('element removal scheduling', () => {
    test('removeElements clears ad nodes through the registered frame', () => {
      jest.useFakeTimers();
      try {
        const masthead = document.createElement('div');
        masthead.id = 'masthead-ad';
        document.body.appendChild(masthead);

        const gridItem = document.createElement('ytd-rich-item-renderer');
        const adSlot = document.createElement('ytd-ad-slot-renderer');
        gridItem.appendChild(adSlot);
        document.body.appendChild(gridItem);

        const container = document.createElement('div');
        container.className = 'ad-container';
        container.appendChild(document.createElement('ad-slot-renderer'));
        document.body.appendChild(container);

        window.AdBlocker.removeElements();
        jest.advanceTimersByTime(20);

        expect(masthead.isConnected).toBe(false);
        expect(gridItem.isConnected).toBe(false);
        expect(container.isConnected).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    test('removeElements schedules through requestIdleCallback when defined', () => {
      window.requestIdleCallback = jest.fn(cb => cb());
      jest.useFakeTimers();
      try {
        const ad = document.createElement('div');
        ad.id = 'masthead-ad';
        document.body.appendChild(ad);

        window.AdBlocker.removeElements();
        jest.advanceTimersByTime(20);
        expect(ad.isConnected).toBe(false);
      } finally {
        jest.useRealTimers();
        delete window.requestIdleCallback;
      }
    });
  });

  describe('initialization wiring', () => {
    test('registers the class watcher, ctx reactions and the ad-slot watcher', () => {
      const cm = window.YouTubePlusCleanupManager;
      const coordinator = window.YouTubePlusMutationCoordinator;

      // The boot ran inside beforeEach: the ctx reactions were wired.
      expect(cm.registerListener).toHaveBeenCalledWith(
        document,
        'playing',
        expect.any(Function),
        expect.objectContaining({ capture: true, passive: true }),
        true
      );
      expect(cm.registerListener).toHaveBeenCalledWith(
        window,
        'yp-history-navigate',
        expect.any(Function),
        false,
        true
      );
      expect(coordinator.subscribeRoot).toHaveBeenCalledWith(
        'adblocker::adSlots',
        expect.any(Function),
        expect.objectContaining({ selector: expect.stringContaining('ytd-ad-slot-renderer') })
      );

      // The absent player is waited for through a root subscription:
      // no repeating retry timer exists.
      expect(cm.timeout).not.toHaveBeenCalled();
      expect(coordinator.subscribeRoot).toHaveBeenCalledWith(
        'adblocker::moviePlayerWait',
        expect.any(Function),
        expect.objectContaining({ selector: '#movie_player' })
      );
    });

    test('the watcher attaches to the movie player once it exists', () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      document.body.appendChild(player);

      jest.resetModules();
      delete window.YouTubePlusFeatureRegistry;
      require('../src/feature-registry.js');
      require('../src/adblocker.js');

      expect(window.YouTubePlusMutationCoordinator.watchTarget).toHaveBeenCalledWith(
        'adblocker::moviePlayerClass',
        player,
        expect.any(Function),
        expect.objectContaining({ attributeFilter: ['class'] })
      );
    });

    test('mutations inside the watched player do not re-attach the watcher', () => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      document.body.appendChild(player);

      jest.resetModules();
      delete window.YouTubePlusFeatureRegistry;
      require('../src/feature-registry.js');
      require('../src/adblocker.js');

      const coordinator = window.YouTubePlusMutationCoordinator;
      // The latest registration belongs to this boot's runtime.
      const waitCall = coordinator.subscribeRoot.mock.calls
        .filter(c => c[0] === 'adblocker::moviePlayerWait')
        .at(-1);
      expect(waitCall).toBeTruthy();
      coordinator.watchTarget.mockClear();
      coordinator.unwatch.mockClear();

      // The wait subscription fires for every batch inside the player.
      waitCall[1]();
      waitCall[1]();
      expect(coordinator.watchTarget).not.toHaveBeenCalled();
      expect(coordinator.unwatch).not.toHaveBeenCalled();

      // A replaced player is attached again.
      player.remove();
      const next = document.createElement('div');
      next.id = 'movie_player';
      document.body.appendChild(next);
      waitCall[1]();
      expect(coordinator.watchTarget).toHaveBeenCalledWith(
        'adblocker::moviePlayerClass',
        next,
        expect.any(Function),
        expect.objectContaining({ attributeFilter: ['class'] })
      );
    });

    test('the setting off leaves no feature subscriptions and no timers', () => {
      // The beforeEach boot wired the runtime once; only the DELTA after the
      // re-require with the setting off counts.
      const cm = window.YouTubePlusCleanupManager;
      cm.registerListener.mockClear();
      cm.timeout.mockClear();
      const coordinator = window.YouTubePlusMutationCoordinator;
      coordinator.subscribeRoot.mockClear();
      coordinator.watchTarget.mockClear();

      window.YouTubePlusSettingsStore.get = jest.fn(key =>
        key === 'enableAdBlocker' ? false : undefined
      );
      jest.resetModules();
      delete window.YouTubePlusAdBlocker;
      delete window.AdBlocker;
      delete window.YouTubePlusFeatureRegistry;
      require('../src/feature-registry.js');
      require('../src/adblocker.js');
      // The runtime never wired: no coordinator work, no delayed reactions.
      expect(coordinator.subscribeRoot).not.toHaveBeenCalled();
      expect(coordinator.watchTarget).not.toHaveBeenCalled();
      expect(cm.registerListener.mock.calls.some(c => c[1] === 'playing')).toBe(false);
      // The only navigation reaction is the registry's shared page-scope
      // sync (opts undefined); the feature's own ctx reaction is absent.
      expect(
        cm.registerListener.mock.calls.some(c => c[1] === 'yp-history-navigate' && c[3] === false)
      ).toBe(false);
      expect(cm.timeout).not.toHaveBeenCalled();
    });

    test('leaving the route releases the watcher, subscriptions and CSS', () => {
      const cm = window.YouTubePlusCleanupManager;
      const coordinator = window.YouTubePlusMutationCoordinator;
      expect(window.YouTubePlusFeatureRegistry.FeatureLifecycle.isRunning('adblocker')).toBe(true);

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/@channel/videos',
        href: 'https://www.youtube.com/@channel/videos',
      });
      window.dispatchEvent(new Event('yp-history-navigate'));

      expect(window.YouTubePlusFeatureRegistry.FeatureLifecycle.isRunning('adblocker')).toBe(false);
      expect(coordinator.unsubscribe).toHaveBeenCalledWith('adblocker::adSlots');
      expect(coordinator.unsubscribe).toHaveBeenCalledWith('adblocker::moviePlayerWait');
      expect(coordinator.unwatch).toHaveBeenCalledWith('adblocker::moviePlayerClass');
      expect(window.YouTubeUtils.StyleManager.remove).toHaveBeenCalledWith('yt-ab-styles');
      expect(window.YouTubePlusAdBlocker.state.adSlotSubId).toBeNull();
      expect(window.YouTubePlusAdBlocker.state.moviePlayerSubId).toBeNull();
      expect(cm.timeout).not.toHaveBeenCalledWith(expect.any(Function), 1500);
    });
  });

  describe('storage failure handling', () => {
    test('load falls back to safe defaults on corrupt storage text', () => {
      localStorage.setItem('youtube_adblocker_settings', 'corrupt-json-{');
      window.AdBlocker.config.enableLogging = true;

      window.AdBlocker.settings.load();
      expect(window.AdBlocker.config.enableLogging).toBe(false);
      expect(window.YouTubeUtils.logger.error).toHaveBeenCalled();
    });

    test('save swallows storage errors and reports them', () => {
      const throwingStorage = window.YouTubeUtils.storage;
      throwingStorage.setItem = () => {
        throw new Error('quota');
      };

      window.AdBlocker.settings.save();
      expect(window.YouTubeUtils.logger.error).toHaveBeenCalled();
    });
  });

  // Real CleanupManager, real MutationCoordinator and real registry drive
  // the runtime the way production does: nothing here stubs the delivery
  // paths, so subscription-driven re-attach and removal are exercised.
  describe('lifecycle runtime (real modules)', () => {
    beforeEach(async () => {
      jest.resetModules();
      // Drop every mock facade the outer beforeEach installed: the real
      // modules skip installation when their facade already exists.
      delete window.YouTubePlusAdBlocker;
      delete window.AdBlocker;
      delete window.YouTubeUtils;
      delete window.YouTubePlusI18n;
      delete window.YouTubePlusMutationCoordinator;
      delete window.YouTubePlusCleanupManager;
      delete window.YouTubePlusSettingsStore;
      delete window.YouTubePlusDesignSystem;
      delete window.YouTubePlusDOMCache;
      delete window.YouTubePlusLogger;
      delete window.YouTubePlusEventDelegation;
      // Retire the previous test's registry entries; a taken id makes the
      // re-required feature's define() return null and nothing ever starts.
      window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
      delete window.YouTubePlusFeatureRegistry;
      delete window.__ytpMainBootDone__;
      localStorage.clear();
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch?v=test',
      });
      require('../src/cleanup-manager.js');
      require('../src/utils.js');
      require('../src/settings-store.js');
      require('../src/safe-dom.js');
      require('../src/mutation-coordinator.js');
      require('../src/event-delegation.js');
      require('../src/i18n.js');
      require('../src/design-system.js');
      require('../src/feature-registry.js');
      require('../src/adblocker.js');
      // The outer beforeEach muted the console; restore passthrough so any
      // runtime error from the wiring is visible in the test output.
      jest.spyOn(console, 'error');
      jest.spyOn(console, 'warn');
      // The boot's own frame/release reactions settle on the real schedule.
      await new Promise(resolve => setTimeout(resolve, 30));
    });

    afterEach(() => {
      window.YouTubePlusFeatureRegistry?._reset?.();
      document.body.innerHTML = '';
      jest.restoreAllMocks();
    });

    test('a player mounted after boot gains the class watcher and skips its ad', async () => {
      expect(window.YouTubePlusFeatureRegistry.FeatureLifecycle.isRunning('adblocker')).toBe(true);
      // The boot registered both root subscriptions (the wait + the slots).
      expect(window.YouTubePlusMutationCoordinator.getStats().rootSubscribers).toBe(2);

      const video = /** @type {any} */ (document.createElement('video'));
      video.className = 'html5-main-video';
      Object.defineProperty(video, 'duration', { value: 30, configurable: true });
      document.body.appendChild(video);

      // The wait subscription delivers the player's insertion and re-attaches
      // the class watcher.
      const player = document.createElement('div');
      player.id = 'movie_player';
      document.body.appendChild(player);
      await new Promise(resolve => setTimeout(resolve, 120));

      player.classList.add('ad-showing');
      // The play reaction runs the same delayed check one more time.
      document.dispatchEvent(new Event('playing'));
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(video.muted).toBe(true);
      expect(video.currentTime).toBeGreaterThan(29);
    });

    test('an ad-slot node inserted after boot is removed by the subscription', async () => {
      const slot = document.createElement('ytd-ad-slot-renderer');
      document.body.appendChild(slot);
      await new Promise(resolve => setTimeout(resolve, 120));

      expect(slot.isConnected).toBe(false);
    });
  });

  test('the module no longer binds the settings checkbox itself', () => {
    // The settings modal's general handler writes `enableAdBlocker`; the module
    // no longer registers a duplicate change handler on the checkbox.
    expect(window.AdBlocker.attachSettingsHandler).toBeUndefined();
  });
});
