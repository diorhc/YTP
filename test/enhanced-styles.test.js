/**
 * @jest-environment jsdom
 *
 * Behaviour tests for the interface style bundle and the theater overlay runtime
 * fixes in src/enhanced.js: settings merge and migration, critical and
 * non-critical CSS scheduling, legacy cleanup, and the theater observers that
 * expand live chat and preload comments.
 */

const mockLocation = globalThis.mockLocation;

/** Mutable handle on the mocked facades for the currently loaded module. */
let env = null;

/** Listener removers kept across module loads so stale instances stay silent. */
let detachFns = [];

/**
 * Feature scope stand-in mirroring the real FeatureScope contract.
 * @returns {object}
 */
function createScope() {
  const disposables = [];
  const scope = {
    active: true,
    listen: jest.fn((target, type, handler, opts) => {
      target?.addEventListener?.(type, handler, opts);
      disposables.push(() => target?.removeEventListener?.(type, handler, opts));
    }),
    timeout: jest.fn(fn => {
      fn();
      return disposables.length;
    }),
    observe: jest.fn(obs => {
      disposables.push(() => obs?.disconnect?.());
      return obs;
    }),
    own: jest.fn(el => {
      disposables.push(() => el?.remove?.());
      return el;
    }),
    onDispose: jest.fn(fn => disposables.push(fn)),
    dispose: jest.fn(() => {
      scope.active = false;
      while (disposables.length) {
        try {
          disposables.pop()();
        } catch {
          /* ignore */
        }
      }
    }),
    scope: jest.fn(() => createScope()),
  };
  return scope;
}

/**
 * Installs the facades src/enhanced.js resolves.
 * @param {{ location?: Record<string, string>, storedSettings?: string|null, storeSettings?: unknown, debounce?: boolean, cleanupHelper?: boolean, cleanStyles?: boolean, readyState?: string }} [opts]
 */
function installDeps(opts = {}) {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
  detachFns.forEach(fn => {
    fn();
  });
  detachFns = [];
  delete window._enhancedInitialized;
  delete window.YouTubePlusEnhanced;
  delete window.YouTubePlusSettingsStore;
  delete window.requestIdleCallback;
  delete window.cancelIdleCallback;

  mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    search: '?v=vid123',
    href: 'https://www.youtube.com/watch?v=vid123',
    ...(opts.location || {}),
  });

  if (opts.readyState) {
    Object.defineProperty(document, 'readyState', { configurable: true, value: opts.readyState });
  } else {
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
  }

  const storage = {
    getItem: jest.fn(() => opts.storedSettings ?? null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  };

  const cleanupManager = {
    registerInterval: jest.fn(id => id),
    registerTimeout: jest.fn(id => id),
    registerObserver: jest.fn(obs => obs),
    unregisterObserver: jest.fn(),
    registerListener: jest.fn((target, type, handler, options) => {
      const capture = options === true || Boolean(options?.capture);
      target?.addEventListener?.(type, handler, capture);
      const off = () => target?.removeEventListener?.(type, handler, capture);
      detachFns.push(off);
      return off;
    }),
    register: jest.fn(fn => fn),
    cleanup: jest.fn(),
    registerAnimationFrame: jest.fn(id => id),
  };

  const coordinatorCbs = new Map();
  const coordinator = {
    subscribeRoot: jest.fn((id, cb) => {
      coordinatorCbs.set(id, cb);
      return id;
    }),
    unsubscribe: jest.fn(id => coordinatorCbs.delete(id)),
    watchTarget: jest.fn((id, target, cb) => {
      coordinatorCbs.set(id, cb);
      env.watched.push({ id, target });
    }),
    unwatch: jest.fn(id => coordinatorCbs.delete(id)),
    _trigger: (id, arg) => coordinatorCbs.get(id)?.(arg),
  };

  const ctx = { ...createScope(), style: jest.fn(), delegate: jest.fn() };

  env = { cleanupManager, coordinator, storage, ctx, watched: [] };
  /** Runs every function handed to the cleanup manager so far. */
  env.runCleanups = () => cleanupManager.register.mock.calls.map(call => call[0]);

  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      $: jest.fn(sel => document.querySelector(sel)),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      createWithErrorBoundary: _name => fn => fn,
      setSafeHTML: jest.fn((el, html) => {
        el.innerHTML = html;
      }),
      getLanguage: jest.fn(() => 'en'),
      getHostname: jest.fn(() => window.location.hostname),
      loadFeatureEnabled: jest.fn((_name, def = true) => def),
      ...(opts.debounce === false
        ? {}
        : { debounce: jest.fn(fn => Object.assign(jest.fn(fn), { cancel: jest.fn() })) }),
      storage,
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
      logSuppressed: jest.fn(),
      isWatchPage: jest.fn(() => window.location.pathname === '/watch'),
      isShortsPage: jest.fn(() => window.location.pathname.startsWith('/shorts')),
      isMusicDomain: jest.fn(() => false),
      getVideoIdFromLocation: jest.fn(() => null),
      getVideoIdFromUrl: jest.fn(() => null),
      createRetryScheduler: jest.fn(() => ({ stop: jest.fn() })),
      onDomReady: jest.fn(cb => {
        if (typeof cb === 'function') cb();
      }),
      ObserverRegistry: { track: jest.fn(), untrack: jest.fn() },
      cleanupManager,
    },
  });

  if (opts.cleanupHelper === false) {
    // The utils helper is missing while the global manager still works, which
    // is the fallback the theater IIFE has to cope with.
    window.YouTubeUtils.cleanupManager = {
      register: jest.fn(fn => fn),
      registerListener: undefined,
    };
  }

  Object.defineProperty(window, 'YouTubePlusCleanupManager', {
    configurable: true,
    writable: true,
    value: cleanupManager,
  });

  Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
    configurable: true,
    writable: true,
    value: {
      FeatureLifecycle: {
        define: jest.fn(def => ({ ...def, sync: jest.fn(() => def.start?.(ctx)) })),
      },
    },
  });

  Object.defineProperty(window, 'YouTubePlusSettingsHost', {
    configurable: true,
    writable: true,
    value: { onChange: jest.fn(() => () => undefined), isEnabled: jest.fn(() => true) },
  });

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      StyleManager: window.YouTubeUtils.StyleManager,
      getStyle: jest.fn(key => (opts.cleanStyles ? '' : `.gen-${key}{}`)),
    },
  });

  Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
    configurable: true,
    writable: true,
    value: coordinator,
  });

  Object.defineProperty(window, 'YouTubePlusMain', {
    configurable: true,
    writable: true,
    value: { expandLiveChat: jest.fn(), preloadComments: jest.fn() },
  });

  if (opts.storeSettings !== undefined) {
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: {
        load: jest.fn(() =>
          typeof opts.storeSettings === 'function' ? opts.storeSettings() : opts.storeSettings
        ),
      },
    });
  }
}

/** Lets the microtask queue drain. */
async function flush() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

/**
 * Advances fake time in small steps so awaited work settles in browser order.
 * @param {number} [ms]
 */
async function settle(ms = 400) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    jest.advanceTimersByTime(50);
    await flush();
  }
}

/**
 * @param {{ [key: string]: unknown }} detail
 */
function emitSettings(detail) {
  window.dispatchEvent(new CustomEvent('youtube-plus-settings-updated', { detail }));
}

/** Styles written under the critical StyleManager key by the latest apply. */
function criticalCss() {
  const calls = window.YouTubeUtils.StyleManager.add.mock.calls.filter(
    c => c[0] === 'style-features'
  );
  return calls.length ? calls[calls.length - 1][1] : '';
}

/** Styles written under the non-critical StyleManager key by the latest apply. */
function nonCriticalCss() {
  const calls = window.YouTubeUtils.StyleManager.add.mock.calls.filter(
    c => c[0] === 'style-features-noncritical'
  );
  return calls.length ? calls[calls.length - 1][1] : '';
}

/**
 * @param {string[]} attributes
 * @returns {HTMLElement}
 */
function buildTheaterFlexy(attributes) {
  const flexy = document.createElement('ytd-watch-flexy');
  for (const name of attributes) flexy.setAttribute(name, '');
  document.body.appendChild(flexy);
  const chat = document.createElement('ytd-live-chat-frame');
  chat.id = 'chat';
  document.body.appendChild(chat);
  return flexy;
}

describe('Enhanced interface style bundle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('applies the critical and non-critical bundles for the enabled flags', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    emitSettings({
      enableStyles: true,
      styles: {
        themeVariant: 'vision',
        themeStyle: 'glass',
        hideSideGuide: true,
        fixFeedLayout: true,
        theaterEnhancements: true,
        thumbnailHover: true,
        transparentHeader: true,
        playerBlur: true,
        compactFeed: true,
      },
    });
    await settle();

    expect(criticalCss()).toContain('.gen-yp-cls-prevention{}');
    expect(criticalCss()).toContain('.gen-yp-hide-side-guide{}');
    expect(criticalCss()).toContain('.gen-yp-fix-feed-layout{}');
    expect(criticalCss()).toContain('.gen-yp-theater-enhancements{}');
    expect(nonCriticalCss()).toContain('.gen-yp-thumbnail-hover{}');
    expect(nonCriticalCss()).toContain('.gen-yp-transparent-header{}');
    expect(nonCriticalCss()).toContain('.gen-yp-player-blur{}');
    expect(nonCriticalCss()).toContain('.gen-yp-compact-feed{}');
  });

  test('adds the solid theme block for a legacy solid theme', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    emitSettings({ enableStyles: true, styles: { themeVariant: 'solid' } });
    await settle();

    expect(criticalCss()).toContain('.gen-yp-theme-solid{}');
  });

  test('skips the glass-only captions block for a solid theme', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    emitSettings({
      enableStyles: true,
      styles: { themeStyle: 'solid', betterCaptions: true, playerBlur: true },
    });
    await settle();

    expect(nonCriticalCss()).not.toContain('.gen-yp-better-captions{}');
    expect(nonCriticalCss()).toContain('.gen-yp-player-blur{}');
  });

  test('removes both bundles when interface styles are switched off', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    emitSettings({ enableStyles: false });

    expect(window.YouTubeUtils.StyleManager.remove).toHaveBeenCalledWith('style-features');
    expect(window.YouTubeUtils.StyleManager.remove).toHaveBeenCalledWith(
      'style-features-noncritical'
    );
  });

  test('removes both bundles when no style flag produces any css', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    window.YouTubePlusDesignSystem.getStyle.mockReturnValue('');

    emitSettings({
      enableStyles: true,
      styles: {
        themeStyle: 'glass',
        thumbnailHover: false,
        immersiveSearch: false,
        hideVoiceSearch: false,
        transparentHeader: false,
        hideSideGuide: false,
        cleanSideGuide: false,
        fixFeedLayout: false,
        betterCaptions: false,
        playerBlur: false,
        theaterEnhancements: false,
        compactFeed: false,
        sideVideosColumnsEnabled: false,
      },
    });

    expect(criticalCss()).toBe('');
    expect(window.YouTubeUtils.StyleManager.remove).toHaveBeenCalled();
  });

  test('drops the legacy style elements when styles are applied', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    const legacyCritical = document.createElement('style');
    legacyCritical.id = 'yp-features';
    document.head.appendChild(legacyCritical);
    const legacyNonCritical = document.createElement('style');
    legacyNonCritical.id = 'yp-features-noncritical';
    document.head.appendChild(legacyNonCritical);

    emitSettings({ enableStyles: true, styles: { thumbnailHover: true } });
    await settle();

    expect(document.getElementById('yp-features')).toBeNull();
    expect(document.getElementById('yp-features-noncritical')).toBeNull();
  });

  test('re-applies the styles from storage after an SPA navigation', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle();

    // Navigation re-applies with the non-critical bundle in the same pass.
    expect(nonCriticalCss()).toContain('.gen-yp-thumbnail-hover{}');
  });

  test('sets and clears the side-video grid variables', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    emitSettings({
      enableStyles: true,
      styles: { sideVideosColumnsEnabled: true, sideVideosColumns: 2 },
    });
    await settle();

    expect(document.documentElement.style.getPropertyValue('--yp-side-cols')).toBe('2');
    expect(document.documentElement.style.getPropertyValue('--yp-side-width')).toBe('200%');
    expect(nonCriticalCss()).toContain('.gen-yp-side-videos-grid{}');

    emitSettings({
      enableStyles: true,
      styles: { sideVideosColumnsEnabled: false, sideVideosColumns: 2 },
    });
    await settle();

    expect(document.documentElement.style.getPropertyValue('--yp-side-cols')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--yp-side-width')).toBe('');
  });

  test('uses a single column width and ignores an invalid column count', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    emitSettings({
      enableStyles: true,
      styles: { sideVideosColumnsEnabled: true, sideVideosColumns: 1 },
    });
    await settle();
    expect(document.documentElement.style.getPropertyValue('--yp-side-width')).toBe('100%');

    emitSettings({
      enableStyles: true,
      styles: { sideVideosColumnsEnabled: true, sideVideosColumns: 'many' },
    });
    await settle();
    expect(document.documentElement.style.getPropertyValue('--yp-side-cols')).toBe('');
    expect(nonCriticalCss()).not.toContain('.gen-yp-side-videos-grid{}');
  });

  test('migrates the legacy hideSideGuide flag', async () => {
    installDeps({
      storeSettings: {
        enableStyles: true,
        hideSideGuide: true,
        styles: { hideSideGuide: false },
      },
    });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    // An event without a detail re-reads the stored settings, which is where
    // the legacy migration happens.
    window.dispatchEvent(new Event('youtube-plus-settings-updated'));
    await settle();

    expect(criticalCss()).toContain('.gen-yp-hide-side-guide{}');
  });

  test('migrates a legacy two-column layout when no column count is stored', async () => {
    installDeps({
      storeSettings: {
        enableStyles: true,
        styles: { sideVideosColumns: '', sideVideosTwoColumns: true },
      },
    });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    window.dispatchEvent(new Event('youtube-plus-settings-updated'));
    await settle();

    expect(document.documentElement.style.getPropertyValue('--yp-side-cols')).toBe('2');
    expect(document.documentElement.style.getPropertyValue('--yp-side-width')).toBe('200%');
    expect(nonCriticalCss()).toContain('.gen-yp-side-videos-grid{}');
  });

  test('the legacy two-column flag keeps an explicitly stored column count', async () => {
    installDeps({
      storeSettings: {
        enableStyles: true,
        styles: { sideVideosColumns: 1, sideVideosTwoColumns: true },
      },
    });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    window.dispatchEvent(new Event('youtube-plus-settings-updated'));
    await settle();

    // The legacy flag enables the grid, but the stored count is not migrated.
    expect(document.documentElement.style.getPropertyValue('--yp-side-cols')).toBe('1');
    expect(document.documentElement.style.getPropertyValue('--yp-side-width')).toBe('100%');
  });

  test('keeps an unusable stored column count at zero', async () => {
    installDeps({
      storeSettings: {
        enableStyles: true,
        styles: { sideVideosColumns: 'many', sideVideosColumnsEnabled: true },
      },
    });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    window.dispatchEvent(new Event('youtube-plus-settings-updated'));
    await settle();

    expect(document.documentElement.style.getPropertyValue('--yp-side-cols')).toBe('');
    expect(nonCriticalCss()).not.toContain('.gen-yp-side-videos-grid{}');
  });

  test('derives the grid flag from the column count when it is not a boolean', async () => {
    installDeps({
      storeSettings: {
        enableStyles: true,
        styles: { sideVideosColumns: 2, sideVideosColumnsEnabled: 'yes' },
      },
    });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    window.dispatchEvent(new Event('youtube-plus-settings-updated'));
    await settle();

    expect(document.documentElement.style.getPropertyValue('--yp-side-cols')).toBe('2');
  });

  test('reads style settings from the settings store', async () => {
    installDeps({
      storeSettings: { enableStyles: true, styles: { transparentHeader: true } },
    });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    window.dispatchEvent(new Event('youtube-plus-settings-updated'));
    await settle();

    expect(window.YouTubePlusSettingsStore.load).toHaveBeenCalled();
    expect(nonCriticalCss()).toContain('.gen-yp-transparent-header{}');
  });

  test('falls back to storage when the settings store cannot load', async () => {
    installDeps({
      storedSettings: JSON.stringify({
        enableStyles: true,
        styles: { immersiveSearch: true },
      }),
    });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle();

    expect(nonCriticalCss()).toContain('.gen-yp-immersive-search{}');
  });

  test('survives stored settings that cannot be parsed', async () => {
    installDeps({ storedSettings: '{not json' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    expect(window.YouTubeUtils.logger.warn).toHaveBeenCalledWith(
      'Enhanced',
      'Styles settings parse error',
      expect.any(Error)
    );

    // The defaults still produce the always-on CLS prevention bundle.
    window.dispatchEvent(new Event('youtube-plus-settings-updated'));
    await settle();
    expect(criticalCss()).toContain('.gen-yp-cls-prevention{}');
  });

  test('ignores a settings payload that is not an object', async () => {
    installDeps({ storedSettings: '"a string"' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle();

    expect(criticalCss()).toContain('.gen-yp-cls-prevention{}');
  });

  test('ignores a style block that is not an object', async () => {
    installDeps({ storeSettings: { enableStyles: true, styles: 'nope' } });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle();

    // The defaults are used instead of the malformed block.
    expect(nonCriticalCss()).toContain('.gen-yp-thumbnail-hover{}');
  });

  test('removes the searchbox listeners through the cleanup registration', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    const searchbox = document.createElement('yt-searchbox');
    const input = document.createElement('input');
    searchbox.appendChild(input);
    document.body.appendChild(searchbox);
    input.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(searchbox.style.willChange).toBe('transform');

    env.runCleanups().forEach(fn => {
      fn();
    });
    searchbox.style.willChange = '';
    input.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(searchbox.style.willChange).toBe('');

    // The focusout handler is gone as well.
    searchbox.style.willChange = 'transform';
    input.dispatchEvent(new Event('focusout', { bubbles: true }));
    expect(searchbox.style.willChange).toBe('transform');
  });

  test('reports a style injection failure instead of breaking the page', async () => {
    installDeps();
    window.YouTubeUtils.StyleManager.add.mockImplementation(() => {
      throw new Error('style host unavailable');
    });

    expect(() => require('../src/enhanced.js')).not.toThrow();
    await settle(200);

    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    expect(window.YouTubeUtils.logger.error).toHaveBeenCalledWith(
      'Enhanced',
      'youtube-styles injection failed',
      expect.any(Error)
    );
  });
});

describe('Enhanced theater overlay runtime fixes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('expands live chat and preloads comments for a theater page', async () => {
    installDeps();
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);

    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();
    expect(window.YouTubePlusMain.preloadComments).toHaveBeenCalled();
  });

  test('treats the full-bleed and requested theater layouts as theater', async () => {
    installDeps();
    buildTheaterFlexy(['full-bleed-player']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);
    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();

    window.YouTubePlusMain.expandLiveChat.mockClear();
    document.body.innerHTML = '';
    buildTheaterFlexy(['theater-requested_']);
    env.coordinator._trigger('enhanced::overlayFlexy');
    await settle(200);
    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();
  });

  test('does nothing in fullscreen, in the default layout or off the watch page', async () => {
    installDeps();
    buildTheaterFlexy(['theater', 'fullscreen']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);
    expect(window.YouTubePlusMain.expandLiveChat).not.toHaveBeenCalled();

    document.querySelector('ytd-watch-flexy').removeAttribute('fullscreen');
    env.coordinator._trigger('enhanced::overlayFlexy');
    await settle(200);
    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();

    window.YouTubePlusMain.expandLiveChat.mockClear();
    document.querySelector('ytd-watch-flexy').removeAttribute('theater');
    env.coordinator._trigger('enhanced::overlayFlexy');
    await settle(200);
    expect(window.YouTubePlusMain.expandLiveChat).not.toHaveBeenCalled();

    buildTheaterFlexy(['theater']);
    window.YouTubeUtils.isWatchPage.mockReturnValue(false);
    env.coordinator._trigger('enhanced::overlayFlexy');
    await settle(200);
    expect(window.YouTubePlusMain.expandLiveChat).not.toHaveBeenCalled();
  });

  test('does nothing while the theater enhancement is disabled', async () => {
    installDeps({ storeSettings: { enableStyles: false } });
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);
    expect(window.YouTubePlusMain.expandLiveChat).not.toHaveBeenCalled();

    window.YouTubePlusMain.expandLiveChat.mockClear();
    env.coordinator._trigger('enhanced::overlayFlexy');
    window.YouTubePlusSettingsStore.load.mockReturnValue({
      enableStyles: true,
      styles: { theaterEnhancements: false },
    });
    await settle(200);
    expect(window.YouTubePlusMain.expandLiveChat).not.toHaveBeenCalled();
  });

  test('runs when no settings are stored at all', async () => {
    installDeps();
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);

    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();
  });

  test('reads the theater setting from raw storage', async () => {
    installDeps({
      storedSettings: JSON.stringify({ styles: { theaterEnhancements: false } }),
    });
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);

    expect(window.YouTubePlusMain.expandLiveChat).not.toHaveBeenCalled();
  });

  test('survives stored settings that cannot be parsed', async () => {
    installDeps({ storedSettings: 'not json at all' });
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);

    // Unparsable settings fall back to "enabled".
    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();
  });

  test('ignores a stored settings payload that is not an object', async () => {
    installDeps({ storedSettings: '42' });
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);

    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();
  });

  test('re-attaches the overlay observers after navigation', async () => {
    installDeps();
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);

    document.body.innerHTML = '';
    const replacement = buildTheaterFlexy(['theater']);
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle(400);

    const watchedTargets = env.watched.filter(entry => entry.id === 'enhanced::overlayFlexy');
    expect(watchedTargets[watchedTargets.length - 1].target).toBe(replacement);
    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();
  });

  test('unwatches the overlay observers through the cleanup registration', async () => {
    installDeps();
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);

    env.runCleanups().forEach(fn => {
      fn();
    });

    expect(window.YouTubePlusMutationCoordinator.unwatch).toHaveBeenCalledWith(
      'enhanced::overlayFlexy'
    );
    expect(window.YouTubePlusMutationCoordinator.unwatch).toHaveBeenCalledWith(
      'enhanced::overlayChat'
    );
  });

  test('registers the navigation handler without the utils cleanup helper', async () => {
    installDeps({ cleanupHelper: false });
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);

    document.body.innerHTML = '';
    buildTheaterFlexy(['theater']);
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle(400);

    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();
  });

  test('defers the overlay observers until the document is ready', async () => {
    installDeps({ readyState: 'loading' });
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();
    await settle(200);

    expect(window.YouTubePlusMutationCoordinator.watchTarget).not.toHaveBeenCalled();
    expect(window.YouTubePlusMain.expandLiveChat).not.toHaveBeenCalled();

    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    document.dispatchEvent(new CustomEvent('DOMContentLoaded'));
    await settle(400);

    expect(window.YouTubePlusMutationCoordinator.watchTarget).toHaveBeenCalled();
    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();
  });

  test('falls back to a timer debounce when utils.debounce is unavailable', async () => {
    installDeps({ debounce: false });
    buildTheaterFlexy(['theater']);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    window.YouTubeUtils.StyleManager.add.mockClear();

    expect(window.YouTubePlusMain.expandLiveChat).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);

    expect(window.YouTubePlusMain.expandLiveChat).toHaveBeenCalled();
  });
});
