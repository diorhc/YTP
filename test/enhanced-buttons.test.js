/**
 * @jest-environment jsdom
 *
 * Behaviour tests for the scroll-to-top buttons owned by src/enhanced.js:
 * delegated click/keyboard activation, per-host scroll-container resolution,
 * the button visibility rules, the MutationCoordinator watches and the
 * teardown performed on navigation, setting changes and feature stop.
 */

const mockLocation = globalThis.mockLocation;

/** Mutable handle on the mocked facades for the currently loaded module. */
let env = null;

/** Listener removers kept across module loads so stale instances stay silent. */
let detachFns = [];

/**
 * Feature scope stand-in mirroring the real FeatureScope contract: owned
 * elements, listeners, timers and observers are released on dispose().
 * @returns {object}
 */
function createScope() {
  const disposables = [];
  const scope = {
    active: true,
    listen: jest.fn((target, type, handler, opts) => {
      target?.addEventListener?.(type, handler, opts);
      const off = () => target?.removeEventListener?.(type, handler, opts);
      disposables.push(off);
      return off;
    }),
    timeout: jest.fn(fn => {
      env.scopeTimeouts.push(fn);
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
    onDispose: jest.fn(fn => {
      disposables.push(fn);
    }),
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
 * Installs the facades src/enhanced.js resolves and records the environment
 * used by assertions.
 * @param {{ location?: Record<string, string>, resizeObserver?: boolean, settingsHost?: boolean, featureRegistry?: boolean }} [opts]
 */
function installDeps(opts = {}) {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
  detachFns.forEach(fn => {
    fn();
  });
  detachFns = [];
  // The init guard is not a YouTubePlus* key, so the global afterEach keeps it.
  delete window._enhancedInitialized;
  delete window.YouTubePlusEnhanced;
  delete window.YouTubePlusStats;
  delete window.YouTubePlusSettingsHost;
  delete window.ResizeObserver;

  mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    search: '?v=vid123',
    href: 'https://www.youtube.com/watch?v=vid123',
    ...(opts.location || {}),
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

  const coordinatorCbs = new Map();
  const coordinator = {
    subscribeRoot: jest.fn((id, cb, config) => {
      coordinatorCbs.set(id, cb);
      env.subscriptions.set(id, config);
      return id;
    }),
    unsubscribe: jest.fn(id => {
      coordinatorCbs.delete(id);
    }),
    watchTarget: jest.fn((id, target, cb, config) => {
      coordinatorCbs.set(id, cb);
      env.watchTargets.set(id, { target, config });
    }),
    unwatch: jest.fn(id => {
      coordinatorCbs.delete(id);
    }),
    _trigger: (id, arg) => coordinatorCbs.get(id)?.(arg),
    _has: id => coordinatorCbs.has(id),
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

  env = {
    ctx,
    cleanupManager,
    coordinator,
    storage,
    scopeTimeouts: [],
    retries: [],
    subscriptions: new Map(),
    watchTargets: new Map(),
    settingsCallbacks: new Map(),
    features: [],
  };

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
      debounce: jest.fn(fn => Object.assign(jest.fn(fn), { cancel: jest.fn() })),
      storage,
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
      logSuppressed: jest.fn(),
      isWatchPage: jest.fn(() => window.location.pathname === '/watch'),
      isShortsPage: jest.fn(() => window.location.pathname.startsWith('/shorts')),
      isMusicDomain: jest.fn(() => window.location.hostname === 'music.youtube.com'),
      getVideoIdFromLocation: jest.fn(() => {
        const match = (window.location.search || '').match(/[?&]v=([^&#]+)/);
        return match ? match[1] : null;
      }),
      getVideoIdFromUrl: jest.fn(url => {
        const match = String(url).match(/[?&]v=([^&#]+)/);
        return match ? match[1] : null;
      }),
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
        const scheduler = {
          stop: () => {
            stopped = true;
          },
        };
        env.retries.push({ options, scheduler });
        return scheduler;
      }),
      onDomReady: jest.fn(cb => {
        if (typeof cb === 'function') cb();
      }),
      ObserverRegistry: { track: jest.fn(), untrack: jest.fn() },
      cleanupManager,
    },
  });

  Object.defineProperty(window, 'YouTubePlusCleanupManager', {
    configurable: true,
    writable: true,
    value: cleanupManager,
  });

  if (opts.featureRegistry !== false) {
    Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
      configurable: true,
      writable: true,
      value: {
        FeatureLifecycle: {
          define: jest.fn(def => {
            const feature = {
              ...def,
              sync: jest.fn(() => def.start?.(ctx)),
            };
            env.features.push(feature);
            return feature;
          }),
        },
      },
    });
  } else {
    delete window.YouTubePlusFeatureRegistry;
  }

  if (opts.settingsHost !== false) {
    Object.defineProperty(window, 'YouTubePlusSettingsHost', {
      configurable: true,
      writable: true,
      value: {
        onChange: jest.fn((key, cb) => {
          env.settingsCallbacks.set(key, cb);
          return () => undefined;
        }),
        isEnabled: jest.fn(() => true),
      },
    });
  }

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      StyleManager: window.YouTubeUtils.StyleManager,
      getStyle: jest.fn(key => `.gen-${key}{}`),
    },
  });

  Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
    configurable: true,
    writable: true,
    value: coordinator,
  });

  Object.defineProperty(window, 'YouTubePlusStats', {
    configurable: true,
    writable: true,
    value: { getDislikesData: jest.fn(async vid => ({ videoId: vid, dislikes: 1234 })) },
  });

  if (opts.resizeObserver) {
    const instances = [];
    env.resizeObservers = instances;
    window.ResizeObserver = class {
      /** @param {() => void} cb */
      constructor(cb) {
        this.cb = cb;
        this.targets = [];
        instances.push(this);
      }

      /** @param {Element} el */
      observe(el) {
        this.targets.push(el);
      }

      disconnect() {
        this.targets = [];
      }
    };
  }
}

/**
 * jsdom has no layout, so scroll geometry is injected per element.
 * @param {Element} el
 * @param {number} scrollHeight
 * @param {number} clientHeight
 * @returns {Element}
 */
function makeScrollable(el, scrollHeight = 1200, clientHeight = 200) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  // jsdom does not implement Element.scrollTo.
  el.scrollTo = jest.fn();
  return el;
}

/**
 * @param {Element} el
 * @param {{ width: number, height: number }} rect
 */
function setRect(el, rect) {
  el.getBoundingClientRect = () => ({
    width: rect.width,
    height: rect.height,
    top: 0,
    left: 0,
    right: rect.width,
    bottom: rect.height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
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

/** Fires the SPA navigation event and runs the deferred page setup. */
function fireNavigation() {
  document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
  jest.advanceTimersByTime(200);
}

/**
 * Drives a YouTube SPA navigation the way the page does.
 * @param {{ pathname: string, search?: string, href: string, hostname?: string }} location
 */
async function navigateTo(location) {
  mockLocation({ hostname: 'www.youtube.com', ...location });
  document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
  await settle(400);
}

/** @param {string} id */
function topButton(id) {
  const button = document.createElement('button');
  button.id = id;
  button.className = 'top-button';
  return button;
}

describe('Enhanced scroll-to-top buttons', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetModules();
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(20000);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('the universal button follows the window scroll position', () => {
    // The watch page shows the universal button only while Tabview is off.
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    makeScrollable(document.body);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });

    fireNavigation();
    const button = document.getElementById('universal-top-button');
    expect(button).not.toBeNull();
    expect(button.classList.contains('visible')).toBe(false);

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 400 });
    window.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('visible')).toBe(true);

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 10 });
    window.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('visible')).toBe(false);

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    scrollTo.mockRestore();
  });

  test('a top button activates on Enter and Space but not on other keys', () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    makeScrollable(document.body);
    fireNavigation();
    const button = document.getElementById('universal-top-button');

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(scrollTo).not.toHaveBeenCalled();

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(scrollTo).toHaveBeenCalledTimes(1);

    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(scrollTo).toHaveBeenCalledTimes(2);
    scrollTo.mockRestore();
  });

  test('clicks outside a top button are ignored', () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    makeScrollable(document.body);
    fireNavigation();

    const other = document.createElement('button');
    other.className = 'top-button';
    other.id = 'unrelated';
    document.body.appendChild(other);
    other.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    other.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  test('the right-tabs button scrolls the scrolled container and restores its label', () => {
    const rightTabs = makeScrollable(document.createElement('div'));
    rightTabs.id = 'right-tabs';
    const tab = makeScrollable(document.createElement('div'));
    tab.className = 'tab-content-cld';
    rightTabs.appendChild(tab);
    document.body.appendChild(rightTabs);

    fireNavigation();
    const button = document.getElementById('right-tabs-top-button');
    expect(button).not.toBeNull();
    expect(rightTabs.style.position).toBe('relative');

    rightTabs.scrollTop = 320;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rightTabs.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(button.getAttribute('aria-label')).toBe('scrolledToTop');

    jest.advanceTimersByTime(1000);
    expect(button.getAttribute('aria-label')).toBe('scrollToTop');
  });

  test('the right-tabs button falls back to the visible tab and is inert without one', () => {
    const rightTabs = makeScrollable(document.createElement('div'));
    rightTabs.id = 'right-tabs';
    const tab = makeScrollable(document.createElement('div'));
    tab.className = 'tab-content-cld';
    tab.scrollTop = 200;
    rightTabs.appendChild(tab);
    document.body.appendChild(rightTabs);

    fireNavigation();
    const button = document.getElementById('right-tabs-top-button');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tab.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });

    // A tab switch to a page without a visible tab must not throw.
    tab.classList.add('tab-content-hidden');
    env.coordinator._trigger('enhanced::tabChanges', [
      { type: 'attributes', attributeName: 'class', target: tab },
    ]);
    expect(document.getElementById('right-tabs-top-button')).toBe(button);
  });

  test('a tab class change rebinds the scroll listener to the newly visible tab', () => {
    const rightTabs = document.createElement('div');
    rightTabs.id = 'right-tabs';
    const first = document.createElement('div');
    first.className = 'tab-content-cld';
    const second = makeScrollable(document.createElement('div'));
    second.className = 'tab-content-cld tab-content-hidden';
    rightTabs.append(first, second);
    document.body.appendChild(rightTabs);

    fireNavigation();
    const button = document.getElementById('right-tabs-top-button');
    expect(button).not.toBeNull();

    second.classList.remove('tab-content-hidden');
    first.classList.add('tab-content-hidden');
    env.coordinator._trigger('enhanced::tabChanges', [
      { type: 'attributes', attributeName: 'class', target: second },
    ]);

    second.scrollTop = 500;
    second.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('visible')).toBe(true);
  });

  test('the tab observer is dropped when the right tabs disappear before it is wired', () => {
    const rightTabs = makeScrollable(document.createElement('div'));
    rightTabs.id = 'right-tabs';
    rightTabs.appendChild(makeScrollable(document.createElement('div')));
    document.body.appendChild(rightTabs);

    // The retry check and the button creation both see #right-tabs; by the
    // time the observer is wired the container is gone again.
    let seen = 0;
    window.YouTubeUtils.$.mockImplementation(sel =>
      sel === '#right-tabs' ? (seen++ < 2 ? rightTabs : null) : document.querySelector(sel)
    );
    env.settingsCallbacks.get('enableTabview')();

    expect(rightTabs.querySelector('#right-tabs-top-button')).not.toBeNull();
    expect(env.coordinator.subscribeRoot).toHaveBeenCalledWith(
      'enhanced::tabChanges',
      expect.any(Function),
      expect.objectContaining({ selector: '#right-tabs .tab-content-cld' })
    );
    expect(env.coordinator.unsubscribe).toHaveBeenCalledWith('enhanced::tabChanges');
    expect(window.YouTubeUtils.ObserverRegistry.untrack).toHaveBeenCalled();
  });

  test('navigation away stops the tab observer and the retry schedulers', async () => {
    const rightTabs = makeScrollable(document.createElement('div'));
    rightTabs.id = 'right-tabs';
    rightTabs.appendChild(makeScrollable(document.createElement('div')));
    document.body.appendChild(rightTabs);
    fireNavigation();
    expect(document.getElementById('right-tabs-top-button')).not.toBeNull();

    const schedulerCount = env.retries.length;
    await navigateTo({
      pathname: '/feed/subscriptions',
      search: '',
      href: 'https://www.youtube.com/feed/subscriptions',
    });

    expect(env.coordinator.unsubscribe).toHaveBeenCalledWith('enhanced::tabChanges');
    expect(window.YouTubeUtils.ObserverRegistry.untrack).toHaveBeenCalled();
    // No new button work is scheduled after leaving the watch page.
    expect(env.retries.length).toBe(schedulerCount);
  });

  test('the playlist panel button hides itself until the panel is usable', () => {
    const panel = document.createElement('ytd-playlist-panel-renderer');
    const items = document.createElement('div');
    items.id = 'items';
    items.scrollTo = jest.fn();
    panel.appendChild(items);
    document.body.appendChild(panel);
    setRect(panel, { width: 320, height: 480 });
    Object.defineProperty(items, 'offsetHeight', { configurable: true, value: 300 });
    Object.defineProperty(items, 'scrollHeight', { configurable: true, value: 900 });

    fireNavigation();
    const button = document.getElementById('playlist-panel-top-button');
    expect(button).not.toBeNull();
    expect(panel.style.position).toBe('relative');
    // jsdom reports no offsetParent, so the panel counts as collapsed.
    expect(button.style.display).toBe('none');

    panel.style.position = 'fixed';
    env.coordinator._trigger('enhanced::playlistPanelVisibility');
    expect(button.style.display).toBe('');

    setRect(panel, { width: 10, height: 480 });
    env.coordinator._trigger('enhanced::playlistPanelVisibility');
    expect(button.style.display).toBe('none');

    setRect(panel, { width: 320, height: 480 });
    panel.hidden = true;
    env.coordinator._trigger('enhanced::playlistPanelVisibility');
    expect(button.style.display).toBe('none');
  });

  test('the playlist panel button scrolls its items list', () => {
    const panel = document.createElement('ytd-playlist-panel-renderer');
    const items = document.createElement('div');
    items.id = 'items';
    items.scrollTo = jest.fn();
    panel.appendChild(items);
    document.body.appendChild(panel);

    fireNavigation();
    document
      .getElementById('playlist-panel-top-button')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(items.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  test('the playlist panel button is skipped when the panel has no items list', () => {
    const panel = document.createElement('ytd-playlist-panel-renderer');
    document.body.appendChild(panel);

    fireNavigation();
    expect(document.getElementById('playlist-panel-top-button')).toBeNull();
  });

  test('the playlist panel watch is released when the button scope is disposed', () => {
    const panel = document.createElement('ytd-playlist-panel-renderer');
    const items = document.createElement('div');
    items.id = 'items';
    panel.appendChild(items);
    document.body.appendChild(panel);

    fireNavigation();
    expect(env.watchTargets.has('enhanced::playlistPanelVisibility')).toBe(true);
    expect(env.coordinator.watchTarget).toHaveBeenCalledWith(
      'enhanced::playlistPanelVisibility',
      panel,
      expect.any(Function),
      expect.objectContaining({ attributeFilter: ['class', 'style', 'hidden'] })
    );

    // Rebuilding disposes the button scope, which must unwatch the panel.
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
    env.settingsCallbacks.get('enableTabview')();
    expect(env.coordinator.unwatch).toHaveBeenCalledWith('enhanced::playlistPanelVisibility');
  });

  test('a plain click on the page never reaches the playlist scroll handler', () => {
    const panel = document.createElement('ytd-playlist-panel-renderer');
    document.body.appendChild(panel);
    fireNavigation();

    const stray = topButton('playlist-panel-top-button');
    stray.remove();
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('playlist-panel-top-button')).toBeNull();
  });

  test('feature stop removes every button and a stray one from an earlier instance', () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
    makeScrollable(document.body);
    fireNavigation();
    expect(document.getElementById('universal-top-button')).not.toBeNull();

    env.features[0].stop();
    expect(document.getElementById('universal-top-button')).toBeNull();

    const stray = topButton('universal-top-button');
    document.body.appendChild(stray);
    env.features[0].stop();
    expect(document.getElementById('universal-top-button')).toBeNull();
  });

  test('changing the tabview setting rebuilds every button', () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
    makeScrollable(document.body);
    fireNavigation();
    const first = document.getElementById('universal-top-button');

    // A removed button is re-created, and the previous scope is disposed.
    first.remove();
    env.settingsCallbacks.get('enableTabview')();
    const rebuilt = document.getElementById('universal-top-button');
    expect(rebuilt).not.toBeNull();
    expect(rebuilt).not.toBe(first);

    // With Tabview back on, the watch page no longer needs the page-level button.
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
    env.settingsCallbacks.get('enableTabview')();
    expect(document.getElementById('universal-top-button')).toBeNull();
  });

  test('the music container resolver caches within its TTL', () => {
    const layout = document.createElement('ytmusic-app-layout');
    layout.id = 'layout';
    document.body.appendChild(layout);

    const first = window.YouTubePlusEnhanced.resolveMusicContainers();
    const second = window.YouTubePlusEnhanced.resolveMusicContainers();
    expect(second).toBe(first);

    const extra = document.createElement('ytmusic-browse-response');
    document.body.appendChild(extra);
    expect(window.YouTubePlusEnhanced.resolveMusicContainers()).toBe(first);

    window.YouTubePlusEnhanced.invalidateMusicContainersCache();
    expect(window.YouTubePlusEnhanced.resolveMusicContainers()).not.toBe(first);
  });

  test('smooth scrolling falls back to scrollTop when scrollBehavior is missing', () => {
    const playlistPanel = document.createElement('ytd-playlist-panel-renderer');
    const items = document.createElement('div');
    items.id = 'items';
    items.scrollTop = 250;
    playlistPanel.appendChild(items);
    document.body.appendChild(playlistPanel);
    fireNavigation();

    const originalStyle = document.documentElement.style;
    Object.defineProperty(document.documentElement, 'style', {
      configurable: true,
      value: {},
    });
    try {
      document
        .getElementById('playlist-panel-top-button')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } finally {
      Object.defineProperty(document.documentElement, 'style', {
        configurable: true,
        value: originalStyle,
      });
    }
    expect(items.scrollTop).toBe(0);
  });
});

describe('Enhanced scroll-to-top buttons on YouTube Music and Studio', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetModules();
    installDeps();
    // jsdom cannot navigate to another origin, so the Music host is faked.
    window.YouTubeUtils.getHostname.mockReturnValue('music.youtube.com');
    window.YouTubeUtils.isMusicDomain.mockReturnValue(true);
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(20000);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('the music button stays above the app overlays and follows its containers', () => {
    const layout = document.createElement('ytmusic-app-layout');
    const inner = document.createElement('div');
    inner.id = 'layout';
    inner.scrollTop = 0;
    makeScrollable(inner, 2000, 400);
    layout.appendChild(inner);
    document.body.appendChild(layout);

    window.YouTubePlusEnhanced.invalidateMusicContainersCache();
    env.settingsCallbacks.get('enableTabview')();
    const button = document.getElementById('universal-top-button');
    expect(button).not.toBeNull();
    expect(button.style.zIndex).toBe('10000');
    expect(button.classList.contains('visible')).toBe(false);

    inner.scrollTop = 600;
    inner.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('visible')).toBe(true);
  });

  test('the music side panel button anchors inside the queue panel', () => {
    const queue = document.createElement('ytmusic-player-queue');
    const contents = document.createElement('div');
    contents.id = 'contents';
    contents.scrollTop = 0;
    makeScrollable(contents, 900, 200);
    queue.appendChild(contents);
    document.body.appendChild(queue);

    fireNavigation();
    const button = document.getElementById('music-side-top-button');
    expect(button).not.toBeNull();
    expect(button.parentElement).toBe(contents);
    expect(contents.style.position).toBe('relative');
    expect(button.style.bottom).toBe('16px');

    contents.scrollTop = 400;
    contents.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('visible')).toBe(true);

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(contents.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  test('the music side panel button is found through the player page roots', () => {
    const page = document.createElement('ytmusic-player-page');
    const panel = document.createElement('div');
    panel.id = 'right-content';
    panel.scrollTop = 0;
    makeScrollable(panel, 800, 200);
    page.appendChild(panel);
    document.body.appendChild(page);

    fireNavigation();
    expect(document.getElementById('music-side-top-button')).not.toBeNull();
  });

  test('a missing music queue is retried and the retry stops with the feature', () => {
    expect(document.getElementById('music-side-top-button')).toBeNull();
    const entry = env.retries.find(e => e.options.maxAttempts === 8);
    expect(entry).toBeDefined();
    expect(entry.options.interval).toBe(500);

    const queue = document.createElement('ytmusic-player-queue');
    const contents = document.createElement('div');
    contents.id = 'contents';
    makeScrollable(contents, 900, 200);
    queue.appendChild(contents);
    document.body.appendChild(queue);
    entry.scheduler.stop();
    env.coordinator._trigger('enhanced::musicSidePanel');

    expect(document.getElementById('music-side-top-button')).not.toBeNull();

    env.features[0].stop();
    expect(document.getElementById('music-side-top-button')).toBeNull();
  });

  test('the music button also watches a container outside the music cache', () => {
    const content = makeScrollable(document.createElement('div'));
    content.id = 'content';
    document.body.appendChild(content);

    // The music container cache was filled while the layout was absent, so
    // this container is only reachable through the extra music candidates.
    env.settingsCallbacks.get('enableTabview')();
    const button = document.getElementById('universal-top-button');
    expect(button).not.toBeNull();

    // The Music branch watches the window as well, so a window scroll also
    // consults the extra container.
    window.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('visible')).toBe(false);

    content.scrollTop = 700;
    window.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('visible')).toBe(true);
  });

  test('the queue retry check mounts the button once the panel appears', () => {
    const entry = env.retries.find(e => e.options.maxAttempts === 8);
    expect(entry).toBeDefined();

    // Nothing to mount yet: the check asks for another attempt.
    expect(entry.options.check()).toBe(false);

    const queue = document.createElement('ytmusic-player-queue');
    const contents = makeScrollable(document.createElement('div'));
    contents.id = 'contents';
    queue.appendChild(contents);
    document.body.appendChild(queue);

    expect(entry.options.check()).toBe(true);
    expect(contents.querySelector('#music-side-top-button')).not.toBeNull();
    // A mounted button makes the check complete immediately.
    expect(entry.options.check()).toBe(true);
  });

  test('music navigation also refreshes the page buttons on popstate', async () => {
    makeScrollable(document.body);
    window.dispatchEvent(new Event('popstate'));
    await settle(400);

    expect(env.subscriptions.has('enhanced::musicSidePanel')).toBe(true);
    expect(env.subscriptions.get('enhanced::musicSidePanel').selector).toBe(
      'ytmusic-player-page, ytmusic-app-layout, ytmusic-app, #layout'
    );
    expect(document.getElementById('universal-top-button')).not.toBeNull();
  });

  test('the universal music button scrolls the window as well as its containers', () => {
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const layout = document.createElement('ytmusic-app-layout');
    const inner = document.createElement('div');
    inner.id = 'layout';
    inner.scrollTop = 300;
    inner.scrollTo = jest.fn();
    makeScrollable(inner, 2000, 400);
    layout.appendChild(inner);
    document.body.appendChild(layout);

    fireNavigation();
    document
      .getElementById('universal-top-button')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(inner.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    scrollTo.mockRestore();
  });
});

describe('Enhanced scroll-to-top boot paths', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete window.requestIdleCallback;
    delete window.ResizeObserver;
  });

  test('boots through requestIdleCallback when the browser provides it', () => {
    installDeps({
      location: {
        pathname: '/feed/subscriptions',
        search: '',
        href: 'https://www.youtube.com/feed/subscriptions',
      },
    });
    makeScrollable(document.body);
    const idleCallback = jest.fn(cb => {
      cb({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    });
    global.requestIdleCallback = idleCallback;

    require('../src/enhanced.js');
    expect(idleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 4000 });
    expect(document.getElementById('universal-top-button')).not.toBeNull();
  });

  test('reports an initialization failure instead of throwing', () => {
    installDeps();
    window.YouTubeUtils.getHostname.mockImplementation(() => {
      throw new Error('host lookup failed');
    });

    expect(() => require('../src/enhanced.js')).not.toThrow();
    jest.advanceTimersByTime(0);

    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    expect(window.YouTubeUtils.logger.error).toHaveBeenCalledWith(
      'Enhanced',
      'Error in initialization',
      expect.any(Error)
    );
  });

  test('starts without a lifecycle registry or a settings host', () => {
    installDeps({ featureRegistry: false, settingsHost: false });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);

    expect(window.YouTubePlusEnhanced.isTabviewEnabled()).toBe(true);
    expect(env.features.length).toBe(0);
  });

  test('watches the playlist panel with a ResizeObserver when the API exists', () => {
    installDeps({ resizeObserver: true });
    const panel = document.createElement('ytd-playlist-panel-renderer');
    const items = document.createElement('div');
    items.id = 'items';
    panel.appendChild(items);
    document.body.appendChild(panel);

    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);

    expect(env.resizeObservers.length).toBeGreaterThan(0);
    const observer = env.resizeObservers[env.resizeObservers.length - 1];
    expect(observer.targets).toEqual([panel, items]);
    expect(() => observer.cb([], observer)).not.toThrow();
  });

  test('a dislike check that throws is reported and retried', async () => {
    installDeps();
    window.YouTubeUtils.$.mockImplementation(sel => {
      if (String(sel).includes('top-level-buttons-computed')) throw new Error('dom race');
      return document.querySelector(sel);
    });

    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(400);

    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
  });

  test('an initialization failure inside the dislike setup is reported', async () => {
    installDeps();
    env.coordinator.subscribeRoot.mockImplementation(id => {
      if (id === 'enhanced::dislikePoll') throw new Error('coordinator down');
      return id;
    });

    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(400);

    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    expect(window.YouTubeUtils.logger.warn).toHaveBeenCalledWith(
      'Enhanced',
      'Failed to initialize Return YouTube Dislike',
      expect.any(Error)
    );
  });
});
