/**
 * @jest-environment jsdom
 *
 * Behaviour tests for the manual playback-quality memory in src/enhanced.js:
 * reading the player quality menu, the persisted preference, the guarded
 * application to the player and the feature/navigation triggers.
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

const QUALITY_KEY = 'youtube_plus_manual_playback_quality';

/** Mirrors the store's changed-key routing for the module filters. */
function affectsModuleStub(event, name, alsoKeys = []) {
  const keys = event?.changedKeys;
  if (!Array.isArray(keys)) return true;
  return keys.some(
    k =>
      k === 'modules' ||
      k === `modules.${name}` ||
      k.startsWith(`modules.${name}.`) ||
      alsoKeys.includes(k)
  );
}

/**
 * Installs the facades src/enhanced.js resolves.
 * @param {{ location?: Record<string, string>, storedQuality?: string, featureEnabled?: boolean }} [opts]
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

  mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    search: '?v=vid123',
    href: 'https://www.youtube.com/watch?v=vid123',
    ...(opts.location || {}),
  });

  const stored = new Map();
  if (opts.storedQuality) stored.set(QUALITY_KEY, opts.storedQuality);
  const storage = {
    getItem: jest.fn(key => (stored.has(key) ? stored.get(key) : null)),
    setItem: jest.fn((key, value) => stored.set(key, String(value))),
    removeItem: jest.fn(key => stored.delete(key)),
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

  const ctx = { ...createScope(), style: jest.fn(), delegate: jest.fn() };

  env = { storage, cleanupManager, ctx, featureEnabled: opts.featureEnabled !== false };

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
      loadFeatureEnabled: jest.fn(name =>
        name === 'enableRememberManualQuality' ? env.featureEnabled : true
      ),
      debounce: jest.fn(fn => Object.assign(jest.fn(fn), { cancel: jest.fn() })),
      storage,
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
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
      createRetryScheduler: jest.fn(() => ({ stop: jest.fn() })),
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

  Object.defineProperty(window, 'YouTubePlusSettingsStore', {
    configurable: true,
    writable: true,
    // Only the changed-key router; no moduleBridge, so the quality memory keeps
    // reading the legacy key in this suite.
    value: { affectsModule: affectsModuleStub },
  });

  Object.defineProperty(window, 'YouTubePlusStats', {
    configurable: true,
    writable: true,
    value: { getDislikesData: jest.fn(async vid => ({ videoId: vid, dislikes: 1 })) },
  });
}

/**
 * Creates a movie_player stub.
 * @param {{ quality?: string, levels?: string[], setters?: boolean, failLevels?: boolean }} [opts]
 * @returns {HTMLElement}
 */
function createPlayer(opts = {}) {
  const player = document.createElement('div');
  player.id = 'movie_player';
  const state = { quality: opts.quality ?? 'hd720' };
  player.getPlaybackQuality = jest.fn(() => state.quality);
  player.getAvailableQualityLevels = jest.fn(() => {
    if (opts.failLevels) throw new Error('player metadata not ready');
    return opts.levels ?? ['hd1080', 'hd720', 'medium', 'auto'];
  });
  if (opts.setters !== false) {
    player.setPlaybackQualityRange = jest.fn();
    player.setPlaybackQuality = jest.fn(target => {
      state.quality = target;
    });
  }
  document.body.appendChild(player);
  return player;
}

/**
 * Adds a quality menu item and clicks it like the player does.
 * @param {{ label?: string, value?: string|null }} opts
 */
function clickQualityMenuItem(opts) {
  const menu = document.createElement('div');
  menu.className = 'ytp-panel-menu';
  const item = document.createElement('div');
  item.className = 'ytp-menuitem';
  if (opts.value) item.setAttribute('data-value', opts.value);
  item.textContent = opts.label ?? '';
  menu.appendChild(item);
  document.body.appendChild(menu);
  item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return item;
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
async function settle(ms = 6000) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    jest.advanceTimersByTime(50);
    await flush();
  }
}

describe('Enhanced manual playback quality', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('remembers the quality picked from the player menu', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);

    clickQualityMenuItem({ label: '720p60' });
    jest.advanceTimersByTime(200);
    await flush();

    expect(env.storage.setItem).toHaveBeenCalledWith(QUALITY_KEY, 'hd720');
  });

  test('remembers a quality that is only named by the menu value', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);

    clickQualityMenuItem({ label: 'HD', value: 'hd1440' });
    jest.advanceTimersByTime(200);
    await flush();

    expect(env.storage.setItem).toHaveBeenCalledWith(QUALITY_KEY, 'hd1440');
  });

  test('clears the remembered quality when the player is set back to auto', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);

    clickQualityMenuItem({ label: 'Auto' });
    jest.advanceTimersByTime(200);
    await flush();

    expect(env.storage.removeItem).toHaveBeenCalledWith(QUALITY_KEY);
    expect(env.storage.setItem).not.toHaveBeenCalled();
  });

  test('ignores clicks outside the quality menu and unlabelled items', async () => {
    installDeps();
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);

    const outside = document.createElement('button');
    outside.textContent = '1080p';
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    clickQualityMenuItem({ label: 'Something else' });
    jest.advanceTimersByTime(200);
    await flush();

    expect(env.storage.setItem).not.toHaveBeenCalled();
    expect(env.storage.removeItem).not.toHaveBeenCalled();
  });

  test('falls back to the live player quality for an unrecognised hint', async () => {
    installDeps();
    const player = createPlayer({ quality: 'hd720' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);

    clickQualityMenuItem({ label: 'HD' });
    jest.advanceTimersByTime(300);
    await settle(1000);

    expect(env.storage.setItem).toHaveBeenCalledWith(QUALITY_KEY, 'hd720');
    expect(player.getAvailableQualityLevels).toHaveBeenCalled();
  });

  test('does not touch the player once the feature is switched off mid-flight', async () => {
    installDeps({ storedQuality: 'hd1080' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    // The retry batch is already scheduled; the player only shows up after the
    // feature has been switched off.
    env.featureEnabled = false;
    const player = createPlayer({ quality: 'hd720' });
    await settle(1000);

    expect(player.getAvailableQualityLevels).not.toHaveBeenCalled();
    expect(player.setPlaybackQuality).not.toHaveBeenCalled();
  });

  test('a new apply batch is skipped while the player reports the remembered quality', async () => {
    installDeps({ storedQuality: 'hd1080' });
    const player = createPlayer({ quality: 'hd1080' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();
    expect(player.setPlaybackQuality).toHaveBeenCalledTimes(1);

    // Metadata loading schedules another batch; the per-video memo now
    // short-circuits it.
    const video = document.createElement('video');
    document.body.appendChild(video);
    video.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
    await settle(2000);

    expect(player.setPlaybackQuality).toHaveBeenCalledTimes(1);
  });

  test('survives a storage backend that rejects the player quality cache write', async () => {
    installDeps({ storedQuality: 'hd1080' });
    createPlayer({ quality: 'hd720' });
    env.storage.setItem.mockImplementation(key => {
      if (key === 'yt-player-quality') throw new Error('quota exceeded');
    });

    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await expect(settle(1000)).resolves.toBeUndefined();

    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
  });

  test('remembers nothing while the feature is disabled', async () => {
    installDeps({ featureEnabled: false });
    createPlayer({ quality: 'hd720' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);

    clickQualityMenuItem({ label: '1080p' });
    clickQualityMenuItem({ label: 'HD' });
    jest.advanceTimersByTime(300);
    await settle(1000);

    expect(env.storage.setItem).not.toHaveBeenCalled();
    expect(env.storage.removeItem).not.toHaveBeenCalled();
  });

  test('applies the remembered quality to the player and persists it', async () => {
    installDeps({ storedQuality: 'hd1080' });
    const player = createPlayer({ quality: 'hd720' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();

    expect(player.setPlaybackQualityRange).toHaveBeenCalledWith('hd1080', 'hd1080');
    expect(player.setPlaybackQuality).toHaveBeenCalledWith('hd1080');
    const persisted = JSON.parse(
      env.storage.setItem.mock.calls.find(c => c[0] === 'yt-player-quality')[1]
    );
    expect(persisted.data).toBe('hd1080');
    expect(persisted.expiration).toBeGreaterThan(Date.now());
  });

  test('steps down the ranking when the preferred level is unavailable', async () => {
    installDeps({ storedQuality: 'hd2160' });
    const player = createPlayer({ quality: 'hd720', levels: ['hd1080', 'medium', 'auto'] });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();

    expect(player.setPlaybackQualityRange).toHaveBeenCalledWith('hd1080', 'hd1080');
  });

  test('falls back to auto for a remembered value outside the ranking', async () => {
    installDeps({ storedQuality: 'bogus-level' });
    const player = createPlayer({ quality: 'medium' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();

    expect(player.setPlaybackQuality).toHaveBeenCalledWith('auto');
  });

  test('waits until the player publishes more than auto', async () => {
    installDeps({ storedQuality: 'hd1080' });
    let calls = 0;
    const player = document.createElement('div');
    player.id = 'movie_player';
    player.getPlaybackQuality = jest.fn(() => 'hd720');
    player.getAvailableQualityLevels = jest.fn(() => {
      calls += 1;
      return calls < 3 ? ['auto'] : ['hd1080', 'hd720', 'auto'];
    });
    player.setPlaybackQualityRange = jest.fn();
    player.setPlaybackQuality = jest.fn();
    document.body.appendChild(player);

    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();

    expect(calls).toBeGreaterThanOrEqual(3);
    expect(player.setPlaybackQuality).toHaveBeenCalledWith('hd1080');
  });

  test('stops retrying once the player reports the remembered quality', async () => {
    installDeps({ storedQuality: 'hd1080' });
    const player = createPlayer({ quality: 'hd1080' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();

    // Sixteen attempts are scheduled, but only the first one touches the player.
    expect(player.setPlaybackQuality).toHaveBeenCalledTimes(1);
  });

  test('a navigation refresh re-applies the remembered quality', async () => {
    installDeps({ storedQuality: 'hd1080' });
    const player = createPlayer({ quality: 'hd720' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();
    expect(player.setPlaybackQuality).toHaveBeenCalledTimes(1);

    // Navigation resets the per-video memo, so the quality is set again.
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle(1000);
    expect(player.setPlaybackQuality).toHaveBeenCalledTimes(2);
  });

  test('reapplies after a navigation refresh and after a settings update', async () => {
    installDeps({ storedQuality: 'hd1080' });
    const player = createPlayer({ quality: 'hd720' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();
    expect(player.setPlaybackQuality).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new CustomEvent('yp:nav-refresh'));
    await settle(1000);
    expect(player.setPlaybackQuality).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new CustomEvent('youtube-plus-settings-updated'));
    await settle(1000);
    expect(player.setPlaybackQuality).toHaveBeenCalledTimes(3);
  });

  test('re-applies the remembered quality when the feature is turned back on', async () => {
    installDeps({ storedQuality: 'hd1080', featureEnabled: false });
    const player = createPlayer({ quality: 'hd720' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(1000);
    expect(player.setPlaybackQuality).not.toHaveBeenCalled();

    // The feature-key change alone must re-run the apply flow, not just the
    // module namespace.
    env.featureEnabled = true;
    window.dispatchEvent(
      Object.assign(new CustomEvent('youtube-plus-settings-updated'), {
        changedKeys: ['enableRememberManualQuality'],
      })
    );
    await settle(1000);
    expect(player.setPlaybackQuality).toHaveBeenCalledWith('hd1080');
  });

  test('copes with a player that does not expose the quality setters', async () => {
    installDeps({ storedQuality: 'hd1080' });
    const player = createPlayer({ setters: false });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);

    await expect(settle()).resolves.toBeUndefined();
    expect(env.storage.setItem.mock.calls.some(c => c[0] === 'yt-player-quality')).toBe(true);
    expect(player.getAvailableQualityLevels).toHaveBeenCalled();
  });

  test('reports a player that fails while listing its levels', async () => {
    installDeps({ storedQuality: 'hd1080' });
    createPlayer({ failLevels: true });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(1000);

    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
  });

  test('applies on Shorts and ignores pages without a video', async () => {
    installDeps({
      storedQuality: 'hd1080',
      location: {
        pathname: '/feed/subscriptions',
        search: '',
        href: 'https://www.youtube.com/feed/subscriptions',
      },
    });
    const player = createPlayer({ quality: 'hd720' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(1000);
    expect(player.setPlaybackQuality).not.toHaveBeenCalled();

    mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/shorts/shortVid',
      search: '',
      href: 'https://www.youtube.com/shorts/shortVid',
    });
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle(2000);

    expect(player.setPlaybackQuality).toHaveBeenCalledWith('hd1080');
  });

  test('ignores an unknown stored quality and metadata from non-video elements', async () => {
    installDeps({ storedQuality: 'unknown' });
    const player = createPlayer({ quality: 'hd720' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(1000);
    expect(player.setPlaybackQuality).not.toHaveBeenCalled();

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
    await settle(1000);
    expect(player.setPlaybackQuality).not.toHaveBeenCalled();

    // A real video element also re-runs the check, and the unknown preference
    // is still not applied.
    const video = document.createElement('video');
    document.body.appendChild(video);
    video.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
    await settle(1000);
    expect(player.getPlaybackQuality).not.toHaveBeenCalled();
    expect(player.setPlaybackQuality).not.toHaveBeenCalled();
  });

  test('survives a storage backend that throws', async () => {
    installDeps({ storedQuality: 'hd1080' });
    env.storage.getItem.mockImplementation(() => {
      throw new Error('storage denied');
    });
    env.storage.setItem.mockImplementation(() => {
      throw new Error('storage full');
    });
    createPlayer({ quality: 'hd720' });

    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await expect(settle(1000)).resolves.toBeUndefined();
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();

    clickQualityMenuItem({ label: '1080p' });
    jest.advanceTimersByTime(200);
    await flush();
    expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
  });

  test('skips the whole flow while the feature is disabled', async () => {
    installDeps({ storedQuality: 'hd1080', featureEnabled: false });
    const player = createPlayer({ quality: 'hd720' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);

    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle(2000);

    expect(player.getAvailableQualityLevels).not.toHaveBeenCalled();
    expect(player.setPlaybackQuality).not.toHaveBeenCalled();
  });

  test('waits for the player element to appear', async () => {
    installDeps({ storedQuality: 'hd1080' });
    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle(1000);

    const player = createPlayer({ quality: 'hd720' });
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await settle(1000);

    expect(player.setPlaybackQuality).toHaveBeenCalledWith('hd1080');
  });
});

describe('Enhanced quality through the shared blob', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    delete window.YouTubePlusSettingsStore;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete window.YouTubePlusSettingsStore;
  });

  /** @param {{ hasSharedSettings: () => boolean, getModuleSettings: () => unknown, updateModuleSettings: jest.Mock }} store */
  const installStore = store => {
    /** @type {any} */
    const bridged = {
      ...store,
      affectsModule: affectsModuleStub,
      moduleBridge: () => (store.hasSharedSettings() ? bridged : null),
    };
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: bridged,
    });
  };

  test('migrates the legacy quality into modules.enhanced when the blob exists', async () => {
    installDeps({ storedQuality: 'hd1080' });
    const updateModuleSettings = jest.fn();
    installStore({
      hasSharedSettings: () => true,
      getModuleSettings: () => ({}),
      updateModuleSettings,
    });
    const player = createPlayer({ quality: 'hd720' });

    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();

    expect(updateModuleSettings).toHaveBeenCalledWith('enhanced', { playbackQuality: 'hd1080' });
    expect(player.setPlaybackQuality).toHaveBeenCalledWith('hd1080');
  });

  test('without the blob the legacy quality stays authoritative', async () => {
    installDeps({ storedQuality: 'hd1080' });
    const updateModuleSettings = jest.fn();
    installStore({
      hasSharedSettings: () => false,
      getModuleSettings: () => ({}),
      updateModuleSettings,
    });
    const player = createPlayer({ quality: 'hd720' });

    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();

    expect(updateModuleSettings).not.toHaveBeenCalled();
    expect(player.setPlaybackQuality).toHaveBeenCalledWith('hd1080');
  });

  test('a quality change from another tab is applied to the live player', async () => {
    installDeps();
    let mod = { playbackQuality: 'hd1080' };
    installStore({
      hasSharedSettings: () => true,
      getModuleSettings: () => mod,
      updateModuleSettings: jest.fn(),
    });
    const player = createPlayer({ quality: 'hd720' });

    require('../src/enhanced.js');
    jest.advanceTimersByTime(0);
    await settle();
    expect(player.setPlaybackQuality).toHaveBeenCalledWith('hd1080');

    mod = { playbackQuality: 'medium' };
    player.setPlaybackQuality.mockClear();
    window.dispatchEvent(
      Object.assign(new CustomEvent('youtube-plus-settings-updated'), {
        changedKeys: ['modules.enhanced.playbackQuality'],
      })
    );
    await settle();

    expect(player.setPlaybackQuality).toHaveBeenCalledWith('medium');
  });
});
