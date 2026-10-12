/**
 * @jest-environment jsdom
 *
 * Behaviour tests for the Return YouTube Dislike integration in
 * src/enhanced.js: video-id resolution, dislike-button discovery across the
 * YouTube layouts, the hand-off to the shared Stats service, the
 * MutationObserver hot path and the teardown performed on navigation.
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
 * @param {{ location?: Record<string, string>, stats?: boolean, dislikes?: (vid: string) => unknown }} [opts]
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
      ctx.onDispose(() => target.removeEventListener(type, listener));
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

  Object.defineProperty(window, 'YouTubePlusMain', {
    configurable: true,
    writable: true,
    value: { expandLiveChat: jest.fn(), preloadComments: jest.fn() },
  });

  if (opts.stats !== false) {
    Object.defineProperty(window, 'YouTubePlusStats', {
      configurable: true,
      writable: true,
      value: {
        getDislikesData: jest.fn(async vid =>
          typeof opts.dislikes === 'function'
            ? opts.dislikes(vid)
            : { videoId: vid, dislikes: 1234 }
        ),
      },
    });
  }
}

/**
 * Builds the standard watch-page dislike button markup.
 * @returns {HTMLElement} the dislike view model
 */
function buildWatchDislikeButton() {
  const flexy = document.createElement('ytd-watch-flexy');
  const menu = document.createElement('ytd-menu-renderer');
  menu.className = 'ytd-watch-metadata';
  const buttons = document.createElement('div');
  buttons.id = 'top-level-buttons-computed';
  const dislike = document.createElement('dislike-button-view-model');
  dislike.appendChild(document.createElement('button'));
  buttons.appendChild(dislike);
  menu.appendChild(buttons);
  flexy.appendChild(menu);
  document.body.appendChild(flexy);
  return dislike;
}

/** Lets the microtask queue drain so awaited dislike work can settle. */
async function flush() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

/**
 * Advances fake time in small steps, draining microtasks between timers so
 * awaited work inside the module settles in the same order a browser runs it.
 * @param {number} [ms]
 */
async function settle(ms = 500) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    jest.advanceTimersByTime(50);
    await flush();
  }
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

describe('Enhanced Return YouTube Dislike', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetModules();
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    // Let the boot navigation and its dislike retries settle so each test
    // starts from a known state and drives the flow itself.
    await settle(20000);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('renders the dislike count from the shared Stats service on a watch page', async () => {
    const dislike = buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });

    expect(window.YouTubePlusStats.getDislikesData).toHaveBeenCalledWith('vid123');
    const text = dislike.querySelector('#yp-dislike-text');
    expect(text.innerText).toBe('1.2K');
    expect(dislike.getAttribute('data-yp-video-id')).toBe('vid123');
    expect(window.YouTubePlusCleanupManager.registerObserver).toHaveBeenCalled();
    expect(env.subscriptions.has('enhanced::dislikePoll')).toBe(true);
    // No polling timer: a button remount reaches the scoped subscription.
    expect(env.subscriptions.has('enhanced::dislikeRemount')).toBe(true);
    expect(window.YouTubePlusCleanupManager.registerInterval).not.toHaveBeenCalled();
  });

  test('the dislike observer restores the count when YouTube rewrites the label', async () => {
    const dislike = buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });

    const text = dislike.querySelector('#yp-dislike-text');
    text.innerText = 'stale';
    // A real MutationObserver delivers through the microtask queue.
    dislike.appendChild(document.createElement('span'));
    await flush();

    expect(text.innerText).toBe('1.2K');
  });

  test('shows an em dash for an unknown count and asks again after a failure', async () => {
    const stats = window.YouTubePlusStats;
    stats.getDislikesData.mockRejectedValue(new Error('network'));
    const dislike = buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });

    const text = dislike.querySelector('#yp-dislike-text');
    expect(text.innerText).toBe('—');
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    expect(dislike.getAttribute('data-yp-video-id')).toBe('vid123');

    // An em dash is not considered rendered, so the poll asks Stats again.
    const callsBeforePoll = stats.getDislikesData.mock.calls.length;
    stats.getDislikesData.mockResolvedValue({ videoId: 'vid123', dislikes: 1234 });
    await env.coordinator._trigger('enhanced::dislikePoll');
    await flush();
    expect(stats.getDislikesData.mock.calls.length).toBeGreaterThan(callsBeforePoll);
    expect(text.innerText).toBe('1.2K');
  });

  test('a button remount after a failure asks again through the remount subscription', async () => {
    const stats = window.YouTubePlusStats;
    stats.getDislikesData.mockRejectedValue(new Error('network'));
    const dislike = buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });
    const text = dislike.querySelector('#yp-dislike-text');
    expect(text.innerText).toBe('—');

    const callsBefore = stats.getDislikesData.mock.calls.length;
    stats.getDislikesData.mockResolvedValue({ videoId: 'vid123', dislikes: 1234 });
    await env.coordinator._trigger('enhanced::dislikeRemount');
    await flush();
    expect(stats.getDislikesData.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(text.innerText).toBe('1.2K');
  });

  test('treats a non-numeric dislike payload as unknown', async () => {
    window.YouTubePlusStats.getDislikesData.mockResolvedValue({ videoId: 'vid123' });
    const dislike = buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });

    expect(dislike.querySelector('#yp-dislike-text').innerText).toBe('—');
  });

  test('renders an em dash when the Stats service is not loaded yet', async () => {
    jest.resetModules();
    installDeps({ stats: false });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(20000);

    const dislike = buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });

    expect(dislike.querySelector('#yp-dislike-text').innerText).toBe('—');
  });

  test('does not poll for a page that is neither watch nor Shorts', async () => {
    const subscribesBefore = env.coordinator.subscribeRoot.mock.calls.length;
    await navigateTo({
      pathname: '/results',
      search: '?search_query=test',
      href: 'https://www.youtube.com/results?search_query=test',
    });

    expect(env.coordinator._has('enhanced::dislikePoll')).toBe(false);
    expect(env.coordinator.subscribeRoot.mock.calls.length).toBe(subscribesBefore);
  });

  test('keeps waiting while no video id is available', async () => {
    window.YouTubeUtils.getVideoIdFromLocation.mockReturnValue(null);
    window.YouTubeUtils.getVideoIdFromUrl.mockReturnValue(null);
    await navigateTo({
      pathname: '/watch',
      search: '',
      href: 'https://www.youtube.com/watch',
    });

    expect(window.YouTubePlusStats.getDislikesData).not.toHaveBeenCalled();
    expect(document.querySelector('#yp-dislike-text')).toBeNull();
  });

  test('releases the previous observer when the dislike button is replaced', async () => {
    const first = buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });
    const firstObserver = window.YouTubePlusCleanupManager.registerObserver.mock.calls[0][0];

    first.remove();
    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid456',
      href: 'https://www.youtube.com/watch?v=vid456',
    });
    const second = buildWatchDislikeButton();
    await env.coordinator._trigger('enhanced::dislikePoll');
    await flush();

    expect(window.YouTubePlusCleanupManager.unregisterObserver).toHaveBeenCalledWith(firstObserver);
    expect(second.getAttribute('data-yp-video-id')).toBe('vid456');
    expect(window.YouTubePlusCleanupManager.registerObserver.mock.calls.length).toBeGreaterThan(1);
  });

  test('keeps the raw observer when the cleanup manager does not track observers', async () => {
    window.YouTubePlusCleanupManager.registerObserver.mockReturnValue(undefined);
    const dislike = buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });

    expect(dislike.querySelector('#yp-dislike-text').innerText).toBe('1.2K');
  });

  test('survives a MutationObserver that refuses to attach', async () => {
    const original = window.MutationObserver;
    window.MutationObserver = class {
      observe() {
        throw new Error('observe failed');
      }
      disconnect() {
        return undefined;
      }
    };
    try {
      const dislike = buildWatchDislikeButton();
      await navigateTo({
        pathname: '/watch',
        search: '?v=vid123',
        href: 'https://www.youtube.com/watch?v=vid123',
      });

      expect(dislike.querySelector('#yp-dislike-text').innerText).toBe('1.2K');
      expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
    } finally {
      window.MutationObserver = original;
    }
  });

  test('never observes the custom Shorts wrapper', async () => {
    const likeBtn = document.createElement('button');
    likeBtn.setAttribute('aria-label', 'Like this video');
    document.body.appendChild(likeBtn);

    await navigateTo({
      pathname: '/shorts/shortVid',
      search: '',
      href: 'https://www.youtube.com/shorts/shortVid',
    });

    expect(document.getElementById('yp-shorts-dislike')).not.toBeNull();
    expect(window.YouTubePlusCleanupManager.registerObserver).not.toHaveBeenCalled();
  });

  test('stops polling, the slow interval and every rendered artefact on navigation', async () => {
    const dislike = buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });

    await navigateTo({
      pathname: '/feed/subscriptions',
      search: '',
      href: 'https://www.youtube.com/feed/subscriptions',
    });

    expect(env.coordinator.unsubscribe).toHaveBeenCalledWith('enhanced::dislikePoll');
    expect(env.coordinator.unsubscribe).toHaveBeenCalledWith('enhanced::dislikeRemount');
    expect(document.querySelector('#yp-dislike-text')).toBeNull();
    expect(dislike.hasAttribute('data-yp-video-id')).toBe(false);

    const callsAfterCleanup = window.YouTubePlusStats.getDislikesData.mock.calls.length;
    await settle(20000);
    expect(window.YouTubePlusStats.getDislikesData.mock.calls.length).toBe(callsAfterCleanup);
  });

  test('the slow poll stops itself once the page leaves the watch route', async () => {
    buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });
    const callsOnWatch = window.YouTubePlusStats.getDislikesData.mock.calls.length;

    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/feed/subscriptions',
      search: '',
      href: 'https://www.youtube.com/feed/subscriptions',
    });
    await settle(20000);

    expect(window.YouTubePlusStats.getDislikesData.mock.calls.length).toBe(callsOnWatch);
  });

  test('gives up on the dislike poll after the twenty second deadline', async () => {
    buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });

    jest.setSystemTime(Date.now() + 21000);
    await env.coordinator._trigger('enhanced::dislikePoll');
    await flush();

    expect(env.coordinator.unsubscribe).toHaveBeenCalledWith('enhanced::dislikePoll');
    expect(env.coordinator._has('enhanced::dislikePoll')).toBe(false);
  });

  test('restarts cleanly when the watch page is revisited', async () => {
    buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });

    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });

    expect(env.coordinator.unsubscribe).toHaveBeenCalledWith('enhanced::dislikePoll');
    expect(env.subscriptions.has('enhanced::dislikePoll')).toBe(true);
  });
});

describe('Enhanced dislike button discovery', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetModules();
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(1000);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('resolves the dislike view model from a segmented renderer', () => {
    const menu = document.createElement('ytd-menu-renderer');
    menu.className = 'ytd-watch-metadata';
    const host = document.createElement('div');
    host.id = 'top-level-buttons-computed';
    const segmented = document.createElement('ytd-segmented-like-dislike-button-renderer');
    const like = document.createElement('like-button-view-model');
    const dislike = document.createElement('dislike-button-view-model');
    segmented.append(like, dislike);
    host.appendChild(segmented);
    menu.appendChild(host);
    document.body.appendChild(menu);

    expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(dislike);
  });

  test('resolves a segmented button by its id or by position', () => {
    const menu = document.createElement('ytd-menu-renderer');
    menu.className = 'ytd-watch-metadata';
    const host = document.createElement('div');
    host.id = 'top-level-buttons-computed';
    const segmented = document.createElement('ytd-segmented-like-dislike-button-renderer');
    const byId = document.createElement('div');
    byId.id = 'segmented-dislike-button';
    segmented.append(document.createElement('div'), byId);
    host.appendChild(segmented);
    menu.appendChild(host);
    document.body.appendChild(menu);
    expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(byId);

    // No dislike view model at all: the second child of the container wins.
    const plainHost = document.createElement('div');
    plainHost.id = 'top-level-buttons-computed';
    const first = document.createElement('div');
    const second = document.createElement('div');
    plainHost.append(first, second);
    menu.replaceChildren(plainHost);
    expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(second);
  });

  test('falls back to an aria-labelled button in any supported language', () => {
    const menu = document.createElement('ytd-menu-renderer');
    menu.className = 'ytd-watch-metadata';
    const host = document.createElement('div');
    host.id = 'top-level-buttons-computed';
    const dislike = document.createElement('button');
    dislike.setAttribute('aria-label', 'Dislike this video');
    host.appendChild(dislike);
    menu.appendChild(host);
    document.body.appendChild(menu);

    expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(host);

    dislike.setAttribute('aria-label', 'Не нравится');
    expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(host);
  });

  test('falls back to watch metadata outside the buttons container', () => {
    const metadata = document.createElement('ytd-watch-metadata');
    const dislike = document.createElement('dislike-button-view-model');
    metadata.appendChild(dislike);
    document.body.appendChild(metadata);

    expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(dislike);
  });

  test('returns null when the page exposes no dislike button at all', () => {
    document.body.appendChild(document.createElement('div'));
    expect(window.YouTubePlusEnhanced.getDislikeButton()).toBeNull();
  });

  test('mounts the custom Shorts dislike button once and drops duplicates', () => {
    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/shorts/shortVid',
      search: '',
      href: 'https://www.youtube.com/shorts/shortVid',
    });
    const reel = document.createElement('ytd-reel-video-renderer');
    reel.setAttribute('is-active', '');
    const like = document.createElement('like-button-view-model');
    like.appendChild(document.createElement('button'));
    reel.appendChild(like);
    document.body.appendChild(reel);

    const wrap = window.YouTubePlusEnhanced.getDislikeButton();
    expect(wrap.id).toBe('yp-shorts-dislike');
    expect(like.nextElementSibling).toBe(wrap);

    // A second call reuses the mounted wrapper and removes stray duplicates.
    const stray = document.createElement('div');
    stray.className = 'yp-shorts-dislike-wrap';
    reel.appendChild(stray);
    expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(wrap);
    expect(document.querySelectorAll('.yp-shorts-dislike-wrap').length).toBe(1);
  });

  test('creates no custom Shorts button when there is no like action to anchor to', () => {
    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/shorts/shortVid',
      search: '',
      href: 'https://www.youtube.com/shorts/shortVid',
    });
    document.body.appendChild(document.createElement('ytd-shorts'));

    expect(window.YouTubePlusEnhanced.getDislikeButton()).toBeNull();
    expect(document.getElementById('yp-shorts-dislike')).toBeNull();
  });

  test('prefers the dislike button of the active Shorts reel', () => {
    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/shorts/shortVid',
      search: '',
      href: 'https://www.youtube.com/shorts/shortVid',
    });
    const shorts = document.createElement('ytd-shorts');
    const reel = document.createElement('ytd-reel-video-renderer');
    reel.setAttribute('is-active', 'true');
    const reelDislike = document.createElement('dislike-button-view-model');
    reel.appendChild(reelDislike);
    const containerDislike = document.createElement('dislike-button-view-model');
    shorts.append(reel, containerDislike);
    document.body.appendChild(shorts);

    expect(window.YouTubePlusEnhanced.getDislikeButton()).toBe(reelDislike);
  });
});

describe('Enhanced dislike rendering helpers', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetModules();
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(1000);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('falls back to a malformed percent-encoded video id in the query string', () => {
    window.YouTubeUtils.getVideoIdFromLocation.mockReturnValue(null);
    window.YouTubeUtils.getVideoIdFromUrl.mockReturnValue(null);
    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=%E0%A4%A',
      href: 'https://www.youtube.com/watch?v=%E0%A4%A',
    });

    expect(window.YouTubePlusEnhanced.getVideoIdForDislike()).toBe('%E0%A4%A');
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
  });

  test('continues past a player API that throws and reads the meta tag', () => {
    window.YouTubeUtils.getVideoIdFromLocation.mockReturnValue(null);
    window.YouTubeUtils.getVideoIdFromUrl.mockReturnValue(null);
    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '',
      href: 'https://www.youtube.com/watch',
    });
    const player = document.createElement('div');
    player.id = 'movie_player';
    player.getVideoData = () => {
      throw new Error('player not ready');
    };
    document.body.appendChild(player);
    const meta = document.createElement('meta');
    meta.setAttribute('itemprop', 'videoId');
    meta.setAttribute('content', 'metaFallback');
    document.head.appendChild(meta);

    expect(window.YouTubePlusEnhanced.getVideoIdForDislike()).toBe('metaFallback');
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
  });

  test('reads a clip id from the identifier meta tag', () => {
    window.YouTubeUtils.getVideoIdFromLocation.mockReturnValue(null);
    window.YouTubeUtils.getVideoIdFromUrl.mockReturnValue(null);
    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/clip/clip123',
      search: '',
      href: 'https://www.youtube.com/clip/clip123',
    });
    const meta = document.createElement('meta');
    meta.setAttribute('itemprop', 'identifier');
    meta.setAttribute('content', 'clipSource');
    document.head.appendChild(meta);

    expect(window.YouTubePlusEnhanced.getVideoIdForDislike()).toBe('clipSource');
  });

  test('renders the count into the Shorts label and restores it on cleanup', async () => {
    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/shorts/shortVid',
      search: '',
      href: 'https://www.youtube.com/shorts/shortVid',
    });
    const reel = document.createElement('ytd-reel-video-renderer');
    reel.setAttribute('is-active', '');
    const dislike = document.createElement('dislike-button-view-model');
    const label = document.createElement('span');
    label.className = 'label';
    label.innerText = 'Dislike';
    dislike.appendChild(label);
    reel.appendChild(dislike);
    document.body.appendChild(reel);

    window.YouTubePlusEnhanced.setDislikeDisplay(dislike, 4200);
    expect(label.innerText).toBe('4.2K');
    expect(label.getAttribute('data-yp-original-text')).toBe('Dislike');

    // A second render keeps the remembered original text.
    window.YouTubePlusEnhanced.setDislikeDisplay(dislike, 9100);
    expect(label.innerText).toBe('9.1K');
    expect(label.getAttribute('data-yp-original-text')).toBe('Dislike');

    await navigateTo({
      pathname: '/feed/subscriptions',
      search: '',
      href: 'https://www.youtube.com/feed/subscriptions',
    });
    expect(label.innerText).toBe('Dislike');
    expect(label.hasAttribute('data-yp-original-text')).toBe(false);
  });

  test('renders the count into a shadow text container and adds its stylesheet once', () => {
    const dislike = document.createElement('dislike-button-view-model');
    const button = document.createElement('button');
    dislike.appendChild(button);
    document.body.appendChild(dislike);

    window.YouTubePlusEnhanced.setDislikeDisplay(dislike, 1500);
    expect(dislike.querySelector('#yp-dislike-text').innerText).toBe('1.5K');

    const shadowHost = document.createElement('div');
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    const innerButton = document.createElement('button');
    const textContent = document.createElement('div');
    textContent.className = 'yt-spec-button-shape-next__button-text-content';
    innerButton.appendChild(textContent);
    shadow.appendChild(innerButton);
    document.body.appendChild(shadowHost);

    window.YouTubePlusEnhanced.setDislikeDisplay(shadowHost, 2500);
    expect(shadow.querySelectorAll('#yp-dislike-text').length).toBe(1);
    expect(shadow.querySelector('#yp-dislike-text').innerText).toBe('2.5K');
    expect(shadow.querySelectorAll('#yp-dislike-style').length).toBe(1);
  });

  test('creates a text container next to the button icon when none exists', () => {
    const dislike = document.createElement('dislike-button-view-model');
    const button = document.createElement('button');
    const icon = document.createElement('span');
    icon.className = 'yt-spec-button-shape-next__icon';
    button.appendChild(icon);
    dislike.appendChild(button);
    document.body.appendChild(dislike);

    window.YouTubePlusEnhanced.setDislikeDisplay(dislike, 30000);

    const textContent = button.querySelector('.yt-spec-button-shape-next__button-text-content');
    expect(textContent.parentElement).toBe(button);
    expect(icon.nextElementSibling).toBe(textContent);
    expect(textContent.querySelector('#yp-dislike-text').innerText).toBe('30K');
    expect(button.style.minWidth).toBe('fit-content');
  });

  test('widens the dislike button so the rendered count stays visible', () => {
    const host = document.createElement('ytDislikeButtonViewModelHost');
    const dislike = document.createElement('dislike-button-view-model');
    const button = document.createElement('button');
    dislike.appendChild(button);
    host.appendChild(dislike);
    document.body.appendChild(host);

    window.YouTubePlusEnhanced.setDislikeDisplay(dislike, 12);

    expect(dislike.style.minWidth).toBe('auto');
    expect(dislike.querySelector('#yp-dislike-text').innerText).toBe('12');
    // The module also widens the closest ytDislikeButtonViewModelHost, but
    // jsdom matches that mixed-case type selector case-sensitively, so the
    // lookup never resolves here (browsers lowercase HTML type selectors).
  });

  test('a watch page label is only rendered once per distinct count', () => {
    const dislike = document.createElement('dislike-button-view-model');
    dislike.appendChild(document.createElement('button'));
    document.body.appendChild(dislike);

    window.YouTubePlusEnhanced.setDislikeDisplay(dislike, 5000);
    const text = dislike.querySelector('#yp-dislike-text');
    expect(text.innerText).toBe('5K');

    // Same value: no style churn, and the same node is reused.
    window.YouTubePlusEnhanced.setDislikeDisplay(dislike, 5000);
    expect(dislike.querySelector('#yp-dislike-text')).toBe(text);

    // A null count is an explicit unknown and renders as an em dash.
    window.YouTubePlusEnhanced.setDislikeDisplay(dislike, null);
    expect(text.innerText).toBe('—');
  });

  test('cleanup also removes rendered counts that live inside shadow roots', async () => {
    const dislike = buildWatchDislikeButton();
    await navigateTo({
      pathname: '/watch',
      search: '?v=vid123',
      href: 'https://www.youtube.com/watch?v=vid123',
    });
    expect(dislike.querySelector('#yp-dislike-text')).not.toBeNull();

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowButton = document.createElement('button');
    shadowButton.id = 'segmented-dislike-button';
    const shadowSpan = document.createElement('span');
    shadowSpan.id = 'yp-dislike-text';
    shadowSpan.setAttribute('data-yp-video-id', 'vid123');
    shadowButton.appendChild(shadowSpan);
    shadow.appendChild(shadowButton);
    document.body.appendChild(host);

    await navigateTo({
      pathname: '/feed/subscriptions',
      search: '',
      href: 'https://www.youtube.com/feed/subscriptions',
    });

    expect(shadow.querySelector('#yp-dislike-text')).toBeNull();
    expect(shadowButton.hasAttribute('data-yp-video-id')).toBe(false);
  });
});
