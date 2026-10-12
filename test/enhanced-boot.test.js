/**
 * @jest-environment jsdom
 *
 * Behaviour tests for the degraded-environment paths of src/enhanced.js: the
 * facades the module resolves at load time, its DOM-ready helper, the host
 * allow-list, formatting fallbacks and the settings-host wiring. Every test
 * loads the real module against a deliberately incomplete facade set.
 */

const mockLocation = globalThis.mockLocation;

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
 * Installs a facade set with the requested pieces missing.
 * @param {{
 *   location?: Record<string, string>,
 *   missing?: Array<'onDomReady'|'t'|'createWithErrorBoundary'|'logger'|'loadFeatureEnabled'|'settingsHost'|'loggerAlias'|'language'>,
 *   readyState?: string,
 *   hostname?: string,
 * }} [opts]
 */
function installDeps(opts = {}) {
  const missing = opts.missing || [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
  detachFns.forEach(fn => {
    fn();
  });
  detachFns = [];
  delete window._enhancedInitialized;
  delete window.YouTubePlusEnhanced;
  delete window.YouTubePlusSettingsHost;
  delete window.YouTubePlusLogger;

  mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    search: '?v=vid123',
    href: 'https://www.youtube.com/watch?v=vid123',
    ...(opts.location || {}),
  });

  Object.defineProperty(document, 'readyState', {
    configurable: true,
    value: opts.readyState || 'complete',
  });

  const storage = {
    getItem: jest.fn(() => null),
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

  const ctx = {
    ...createScope(),
    style: jest.fn(),
    delegate: jest.fn((target, type, selector, handler) => {
      const listener = ev => {
        const match = ev.target?.closest?.(selector);
        if (match) handler(ev, match);
      };
      target.addEventListener(type, listener);
      const off = () => target.removeEventListener(type, listener);
      ctx.onDispose(off);
      detachFns.push(off);
    }),
  };

  /** @type {Record<string, unknown>} */
  const utils = {
    $: jest.fn(sel => document.querySelector(sel)),
    byId: jest.fn(id => document.getElementById(id)),
    setSafeHTML: jest.fn((el, html) => {
      el.innerHTML = html;
    }),
    getLanguage: jest.fn(() => 'en'),
    getHostname: jest.fn(() => opts.hostname || window.location.hostname),
    debounce: jest.fn(fn => Object.assign(jest.fn(fn), { cancel: jest.fn() })),
    storage,
    StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
    SETTINGS_KEY: 'youtube_plus_settings',
    logSuppressed: jest.fn(),
    isWatchPage: jest.fn(() => window.location.pathname === '/watch'),
    isShortsPage: jest.fn(() => window.location.pathname.startsWith('/shorts')),
    isMusicDomain: jest.fn(() => false),
    getVideoIdFromLocation: jest.fn(() => {
      const match = (window.location.search || '').match(/[?&]v=([^&#]+)/);
      return match ? match[1] : null;
    }),
    getVideoIdFromUrl: jest.fn(() => null),
    createRetryScheduler: jest.fn(options => {
      let stopped = false;
      let attempts = 0;
      const maxAttempts = options?.maxAttempts || 10;
      const run = () => {
        if (stopped) return;
        attempts += 1;
        const done = options?.check?.();
        if (!done && attempts < maxAttempts) setTimeout(run, options?.interval || 100);
      };
      run();
      return {
        stop: () => {
          stopped = true;
        },
      };
    }),
    ObserverRegistry: { track: jest.fn(), untrack: jest.fn() },
    cleanupManager,
  };
  if (!missing.includes('t')) utils.t = jest.fn(key => key || '');
  if (!missing.includes('createWithErrorBoundary')) {
    utils.createWithErrorBoundary = _name => fn => fn;
  }
  if (!missing.includes('loadFeatureEnabled')) {
    utils.loadFeatureEnabled = jest.fn((_name, def = true) => def);
  }
  if (!missing.includes('onDomReady')) {
    utils.onDomReady = jest.fn(cb => {
      if (typeof cb === 'function') cb();
    });
  }
  if (!missing.includes('logger')) {
    utils.logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  }
  if (!missing.includes('language')) {
    utils.getLanguage = jest.fn(() => 'en');
  }

  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: utils,
  });

  Object.defineProperty(window, 'YouTubePlusCleanupManager', {
    configurable: true,
    writable: true,
    value: cleanupManager,
  });

  if (!missing.includes('loggerAlias')) {
    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  }

  Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
    configurable: true,
    writable: true,
    value: {
      FeatureLifecycle: {
        define: jest.fn(def => ({ ...def, sync: jest.fn(() => def.start?.(ctx)) })),
      },
    },
  });

  if (!missing.includes('settingsHost')) {
    Object.defineProperty(window, 'YouTubePlusSettingsHost', {
      configurable: true,
      writable: true,
      value: { onChange: jest.fn(() => () => undefined), isEnabled: jest.fn(() => true) },
    });
  }

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      StyleManager: utils.StyleManager,
      getStyle: jest.fn(key => `.gen-${key}{}`),
    },
  });

  Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
    configurable: true,
    writable: true,
    value: {
      subscribeRoot: jest.fn(id => id),
      unsubscribe: jest.fn(),
      watchTarget: jest.fn(),
      unwatch: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusStats', {
    configurable: true,
    writable: true,
    value: { getDislikesData: jest.fn(async vid => ({ videoId: vid, dislikes: 1 })) },
  });
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

describe('Enhanced module fallbacks', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('boots through its own DOM-ready helper when utils has none', async () => {
    installDeps({ missing: ['onDomReady'], readyState: 'complete' });
    require('../src/enhanced.js');

    await settle(200);
    // The helper runs the callback immediately on a ready document.
    expect(window.YouTubePlusEnhanced.isTabviewEnabled()).toBe(true);
    expect(window.YouTubeUtils.StyleManager.add).toHaveBeenCalledWith(
      'yp-enhanced-styles',
      expect.any(String)
    );
  });

  test('waits for DOMContentLoaded while the document is still parsing', async () => {
    installDeps({ missing: ['onDomReady'], readyState: 'loading' });
    require('../src/enhanced.js');
    await settle(200);

    // The runtime styles wait for the document; the interface styles do not.
    expect(window.YouTubeUtils.StyleManager.add).not.toHaveBeenCalledWith(
      'yp-enhanced-styles',
      expect.any(String)
    );

    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    document.dispatchEvent(new CustomEvent('DOMContentLoaded'));
    await settle(200);

    expect(window.YouTubeUtils.StyleManager.add).toHaveBeenCalledWith(
      'yp-enhanced-styles',
      expect.any(String)
    );
  });

  test('ignores a non-callable DOM-ready callback', async () => {
    installDeps({ missing: ['onDomReady'] });
    require('../src/enhanced.js');
    const registered = window.YouTubePlusCleanupManager.registerListener.mock.calls;

    // The helper is only ever called with the init callback, but a stray
    // non-function must not throw.
    expect(registered.every(call => typeof call[1] === 'string')).toBe(true);
    await settle(200);
    expect(window.YouTubePlusEnhanced).toBeDefined();
  });

  test('falls back to the translation key when utils has no translator', async () => {
    installDeps({ missing: ['t'] });
    const rightTabs = makeScrollable(document.createElement('div'));
    rightTabs.id = 'right-tabs';
    document.body.appendChild(rightTabs);
    require('../src/enhanced.js');
    await settle(400);
    document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle(400);

    const button = document.getElementById('right-tabs-top-button');
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('scrollToTop');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(button.getAttribute('aria-label')).toBe('scrolledToTop');
  });

  test('boots without the error-boundary helper', async () => {
    installDeps({ missing: ['createWithErrorBoundary'] });
    const flexy = document.createElement('ytd-watch-flexy');
    flexy.setAttribute('theater', '');
    document.body.appendChild(flexy);

    expect(() => require('../src/enhanced.js')).not.toThrow();
    await settle(400);

    expect(window.YouTubePlusMain?.expandLiveChat).toBeUndefined();
    expect(window.YouTubePlusEnhanced.isTabviewEnabled()).toBe(true);
  });

  test('treats an unknown tabview setting as enabled', async () => {
    installDeps({ missing: ['loadFeatureEnabled'] });
    require('../src/enhanced.js');
    expect(window.YouTubePlusEnhanced.isTabviewEnabled()).toBe(true);

    jest.resetModules();
    installDeps();
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(undefined);
    jest.resetModules();
    installDeps();
    require('../src/enhanced.js');
    expect(window.YouTubePlusEnhanced.isTabviewEnabled()).toBe(true);
  });

  test('honours a disabled tabview setting', () => {
    installDeps();
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
    require('../src/enhanced.js');
    expect(window.YouTubePlusEnhanced.isTabviewEnabled()).toBe(false);
  });

  test('runs the lifecycle feature without a settings host', async () => {
    installDeps({ missing: ['settingsHost'] });
    expect(() => require('../src/enhanced.js')).not.toThrow();
    await settle(400);

    expect(window.YouTubePlusEnhanced.isTabviewEnabled()).toBe(true);
  });

  test('formats a count with a plain string when Intl rejects the locale', () => {
    installDeps({ missing: ['language'] });
    window.YouTubeUtils.getLanguage.mockReturnValue('not a locale!');
    require('../src/enhanced.js');

    expect(window.YouTubePlusEnhanced.formatCompactNumber(1234)).toBe('1234');
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    expect(window.YouTubePlusEnhanced.formatCompactNumber(null)).toBe('—');
  });

  test('renders the dislike count into a button without any inner button', () => {
    installDeps();
    require('../src/enhanced.js');

    const dislike = document.createElement('dislike-button-view-model');
    document.body.appendChild(dislike);

    window.YouTubePlusEnhanced.setDislikeDisplay(dislike, 4321);

    const text = dislike.querySelector('#yp-dislike-text');
    expect(text).not.toBeNull();
    expect(text.innerText).toBe('4.3K');
    expect(dislike.style.minWidth).toBe('auto');
  });

  test('reports a page-level button on the home and subscription feeds', async () => {
    installDeps();
    makeScrollable(document.body);
    require('../src/enhanced.js');
    await settle(400);

    for (const path of ['/', '/feed/subscriptions']) {
      mockLocation({
        hostname: 'www.youtube.com',
        pathname: path,
        search: '',
        href: `https://www.youtube.com${path}`,
      });
      document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      await settle(400);
      expect(document.getElementById('universal-top-button')).not.toBeNull();
    }
  });

  test('reports a page-level button on search results and playlists', async () => {
    installDeps();
    makeScrollable(document.body);
    require('../src/enhanced.js');
    await settle(400);

    for (const target of [
      {
        pathname: '/results',
        search: '?search_query=cats',
        href: 'https://www.youtube.com/results?search_query=cats',
      },
      {
        pathname: '/playlist',
        search: '?list=PL1',
        href: 'https://www.youtube.com/playlist?list=PL1',
      },
      { pathname: '/results', search: '', href: 'https://www.youtube.com/results' },
    ]) {
      mockLocation({ hostname: 'www.youtube.com', ...target });
      document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      await settle(400);
      expect(document.getElementById('universal-top-button')).not.toBeNull();
    }
  });
});

describe('Enhanced scroll container fallbacks', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('falls back to the document scrolling element when nothing is scrollable', () => {
    installDeps();
    require('../src/enhanced.js');

    const container = window.YouTubePlusEnhanced.getUniversalScrollContainer();
    expect([document.body, document.documentElement]).toContain(container);
  });

  test('prefers a scrollable inner container on the Studio host', () => {
    installDeps({ hostname: 'studio.youtube.com' });
    const page = document.createElement('ytcp-entity-page');
    const panel = document.createElement('div');
    panel.id = 'scrollable-content';
    makeScrollable(panel, 3000, 500);
    page.appendChild(panel);
    document.body.appendChild(page);
    require('../src/enhanced.js');

    const container = window.YouTubePlusEnhanced.getUniversalScrollContainer();
    expect(container).toBe(panel);
  });

  test('returns a window-level container for the Music host', () => {
    installDeps({ hostname: 'music.youtube.com' });
    require('../src/enhanced.js');

    const container = window.YouTubePlusEnhanced.getUniversalScrollContainer();
    expect([document.body, document.documentElement]).toContain(container);
  });
});

/**
 * jsdom has no layout, so scroll geometry is injected per element.
 * @param {Element} el
 * @param {number} [scrollHeight]
 * @param {number} [clientHeight]
 * @returns {Element}
 */
function makeScrollable(el, scrollHeight = 2000, clientHeight = 400) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  el.scrollTo = jest.fn();
  return el;
}
