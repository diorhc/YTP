/**
 * @jest-environment jsdom
 *
 * Tests the real stats.js module surface through window.YouTubeStats / window.YouTubePlusStats.
 * Exercises lifecycle initialization, teardown, and version verification on the real exported API.
 */

describe('Stats Module (real API)', () => {
  const setupStatsDeps = () => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    delete window.__ytpVideoStatsModuleInit;
    delete window.__ytpChannelStatsModuleInit;
    delete window.YouTubeStats;
    delete window.YouTubePlusStats;

    mockLocation({
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=dQw4w9WgXcQ',
    });

    localStorage.clear();

    // Canonical video-ID helpers come from the real utils module.
    require('../src/utils.js');
    const canonUtils = window.YouTubeUtils;

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        StyleManager: { add: jest.fn(), remove: jest.fn() },
        getVideoIdFromUrl: canonUtils.getVideoIdFromUrl,
        getVideoIdFromLocation: canonUtils.getVideoIdFromLocation,
        logError: jest.fn(),
        debounce: fn => fn,
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        $: jest.fn((sel, ctx = document) => (ctx || document).querySelector(sel)),
        $$: jest.fn((sel, ctx = document) => Array.from((ctx || document).querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
        t: jest.fn(key => key || ''),
        loadFeatureEnabled: jest.fn(() => true),
        SETTINGS_KEY: 'youtube_plus_settings',
        createWithErrorBoundary: jest.fn(() => fn => fn),
        logSuppressed: jest.fn(),
        registerListenerSafe: (target, event, handler, options) => {
          const cm = window.YouTubeUtils?.cleanupManager;
          if (cm && typeof cm.registerListener === 'function') {
            return cm.registerListener(target, event, handler, options);
          }
          if (target && typeof target.addEventListener === 'function') {
            target.addEventListener(event, handler, options);
          }
          return null;
        },
        onDomReady: cb => cb(),
        getRoute: () => {
          const p = window.location.pathname || '/';
          if (p === '/watch') return 'watch';
          if (p.startsWith('/shorts')) return 'shorts';
          if (/^\/@|\/channel\/|\/c\/|\/user\//.test(p)) return 'channel';
          return 'other';
        },
        whenRelevant: jest.fn(({ onEnter }) => onEnter()),
        isSettingsModalOpen: jest.fn(() => false),
        createRetryScheduler: jest.fn(() => ({ stop: jest.fn() })),
        createVisibilityAwareInterval: jest.fn(() => ({
          stop: jest.fn(),
          pause: jest.fn(),
          resume: jest.fn(),
          active: true,
        })),
        cleanupManager: {
          registerInterval: jest.fn(id => id),
          registerTimeout: jest.fn(id => id),
          registerObserver: jest.fn(obs => obs),
          registerListener: jest.fn((target, event, handler) => {
            target.addEventListener(event, handler);
            return { dispose: () => target.removeEventListener(event, handler) };
          }),
          register: jest.fn(),
          cleanup: jest.fn(),
          registerAnimationFrame: jest.fn(id => id),
        },
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
        renderTemplateClone: jest.fn((el, html) => {
          if (el) el.innerHTML = html;
        }),
        setSafeHTML: jest.fn((el, html) => {
          if (el) el.innerHTML = html;
        }),
      },
    });

    const settingsStoreValues = {};
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: {
        get: jest.fn(key => settingsStoreValues[key]),
        set: jest.fn((key, value) => {
          settingsStoreValues[key] = value;
          return true;
        }),
        affectsModule: jest.fn(() => true),
      },
    });

    const featureRegistryMap = new Map();
    Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
      configurable: true,
      writable: true,
      value: {
        register: jest.fn(desc => featureRegistryMap.set(desc.id, desc)),
        get: jest.fn(id => featureRegistryMap.get(id)),
        has: jest.fn(id => featureRegistryMap.has(id)),
        _map: featureRegistryMap,
        // Minimal route-aware host: start/stop per def.routes so the module
        // wires its real init exactly as the production lifecycle does.
        FeatureLifecycle: {
          define: jest.fn(def => {
            if (!def || typeof def.start !== 'function') return null;
            const makeCtx = () => ({
              style: jest.fn(),
              listen: jest.fn(() => jest.fn()),
              own: el => el,
              onDispose: jest.fn(),
              scope: () => makeCtx(),
              dispose: jest.fn(),
            });
            const ctx = makeCtx();
            let running = false;
            const matches = () => {
              const route = window.YouTubeUtils.getRoute();
              return !def.routes?.length || def.routes.includes(route);
            };
            return {
              sync() {
                const should = matches();
                if (should && !running) {
                  running = true;
                  def.start(ctx);
                } else if (!should && running) {
                  running = false;
                  def.stop?.();
                }
              },
              isRunning: () => running,
              restart() {
                def.stop?.();
                running = false;
                this.sync();
              },
            };
          }),
          _reset: jest.fn(),
        },
      },
    });

    Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
      configurable: true,
      writable: true,
      value: {
        subscribeRoot: jest.fn(() => 'sub-id'),
        unsubscribe: jest.fn(),
        watchTarget: jest.fn(() => 'watch-id'),
        unwatch: jest.fn(),
      },
    });
  };

  beforeEach(() => {
    jest.resetModules();
    setupStatsDeps();
    require('../src/stats.js');
    // The settings-modal listener is the off-route path that initializes the
    // channel scope; dispatch it so its API is available on the watch route.
    document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('real stats module exposes window.YouTubeStats and window.YouTubePlusStats', () => {
    expect(window.YouTubeStats).toBeDefined();
    expect(window.YouTubePlusStats).toBe(window.YouTubeStats);
    expect(typeof window.YouTubeStats.init).toBe('function');
    expect(typeof window.YouTubeStats.cleanup).toBe('function');
  });

  test('cleanup runs safely without exceptions', () => {
    expect(() => {
      window.YouTubeStats.cleanup();
    }).not.toThrow();
  });

  test('init initializes stats overlay without errors', () => {
    expect(() => {
      window.YouTubeStats.init();
    }).not.toThrow();
  });

  // Load-matrix: the module resolves its escapeHtml binding at require time
  // (`YouTubeSafeDOM?.escapeHTML || YouTubeUtils?.escapeHTML`). The default
  // harness above covers the safe-dom-absent outcome; this covers the
  // safe-dom-present (preferred) outcome.
  test('loads when YouTubeSafeDOM provides the preferred escapeHTML', () => {
    jest.resetModules();
    setupStatsDeps();
    Object.defineProperty(window, 'YouTubeSafeDOM', {
      configurable: true,
      writable: true,
      value: { escapeHTML: s => `sd:${s}` },
    });
    expect(() => require('../src/stats.js')).not.toThrow();
    document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
    expect(typeof window.YouTubeStats.init).toBe('function');
  });

  // Booting with the settings modal open is the path real users hit when the
  // modal opens before the idle callback: both stats scopes initialize
  // immediately. The checkbox belongs to the modal's general handler now.
  test('modal open at boot initializes both scopes without owning the checkbox', () => {
    jest.resetModules();
    setupStatsDeps();
    window.YouTubeUtils.isSettingsModalOpen = jest.fn(() => true);

    const checkbox = document.createElement('input');
    checkbox.id = 'yp-setting-enableStatsButton';
    document.body.appendChild(checkbox);

    require('../src/stats.js');
    document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));

    // Both scopes initialize: video stats through its watch-route start,
    // channel stats through the settings-modal listener (its route is off).
    expect(window.__ytpVideoStatsModuleInit).toBe(true);
    expect(window.__ytpChannelStatsModuleInit).toBe(true);
    const store = window.YouTubePlusSettingsStore;
    expect(store.set).not.toHaveBeenCalled();

    // The module attaches no handler of its own; the modal's general handler
    // is the single writer.
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.dataset.handlerAttached).toBeUndefined();
    expect(store.set).not.toHaveBeenCalledWith('enableStatsButton', false);
  });

  describe('Vision Dock Stats Integration', () => {
    test('exports openStatsModal and initVideoStats to window.YouTubePlusStats', () => {
      expect(typeof window.YouTubePlusStats.openStatsModal).toBe('function');
      expect(typeof window.YouTubePlusStats.initVideoStats).toBe('function');
    });

    test('registers stats in FeatureRegistry and mountDock creates button and triggers modal', () => {
      const statsDesc = window.YouTubePlusFeatureRegistry.get('stats');
      expect(statsDesc).toBeDefined();
      expect(statsDesc.id).toBe('stats');

      const player = document.createElement('div');
      const dock = document.createElement('div');
      document.body.appendChild(player);
      document.body.appendChild(dock);

      statsDesc.mountDock(player, dock);

      const btn = dock.querySelector('#yp-vision-stats-btn');
      expect(btn).not.toBeNull();
      expect(btn.classList.contains('vision-dock-btn')).toBe(true);
      expect(btn.classList.contains('yp-vision-stats-btn')).toBe(true);

      // Mock openStatsModal to verify click trigger
      const openModalSpy = jest.fn();
      window.YouTubePlusStats.openStatsModal = openModalSpy;

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(openModalSpy).toHaveBeenCalledWith('video', 'dQw4w9WgXcQ');
    });

    test('exports canonical DESCRIPTOR on window.YouTubePlusStats with required contract', () => {
      const desc = window.YouTubePlusStats.DESCRIPTOR;
      expect(desc).toBeDefined();
      expect(desc.id).toBe('stats');
      expect(desc.titleKey).toBe('videoStats');
      expect(typeof desc.iconSVG).toBe('string');
      expect(typeof desc.command).toBe('function');
      expect(typeof desc.mountDock).toBe('function');
    });

    test('mountDock is idempotent and does not create duplicate buttons', () => {
      const statsDesc = window.YouTubePlusFeatureRegistry.get('stats');
      const player = document.createElement('div');
      const dock = document.createElement('div');

      statsDesc.mountDock(player, dock);
      statsDesc.mountDock(player, dock);

      const buttons = dock.querySelectorAll('#yp-vision-stats-btn');
      expect(buttons.length).toBe(1);
    });

    test('U05: stats click survives sweep + re-mount; dispose releases it', () => {
      const statsDesc = window.YouTubePlusFeatureRegistry.get('stats');
      const player = document.createElement('div');
      const dock = document.createElement('div');
      const cm = window.YouTubePlusCleanupManager;
      const countEntries = () => {
        let n = 0;
        for (const e of cm.listeners.values()) {
          if (e.target === dock.querySelector('#yp-vision-stats-btn')) n += 1;
        }
        return n;
      };

      let dispose = statsDesc.mountDock(player, dock);
      expect(typeof dispose).toBe('function');
      expect(countEntries()).toBe(1);

      // Direct re-mount: stable closure dedups, no stacking.
      dispose = statsDesc.mountDock(player, dock);
      expect(countEntries()).toBe(1);

      cm.cleanup();
      expect(countEntries()).toBe(0);
      dispose = statsDesc.mountDock(player, dock);
      expect(countEntries()).toBe(1);
      dispose();
      expect(countEntries()).toBe(0);
    });

    test('mountDock cleans up button when the stats button flag is off', () => {
      window.YouTubePlusSettingsStore.set('enableStatsButton', false);
      const statsDesc = window.YouTubePlusFeatureRegistry.get('stats');
      const player = document.createElement('div');
      const dock = document.createElement('div');
      const existingBtn = document.createElement('button');
      existingBtn.id = 'yp-vision-stats-btn';
      dock.appendChild(existingBtn);

      statsDesc.mountDock(player, dock);

      expect(dock.querySelector('#yp-vision-stats-btn')).toBeNull();
    });

    test('command executes and returns true on watch route', () => {
      const statsDesc = window.YouTubePlusFeatureRegistry.get('stats');
      const openModalSpy = jest.fn();
      window.YouTubePlusStats.openStatsModal = openModalSpy;

      const result = statsDesc.command();
      expect(result).toBe(true);
      expect(openModalSpy).toHaveBeenCalledWith('video', 'dQw4w9WgXcQ');
    });

    test('ensureShortsStatsButton mounts .shortsStats in Shorts action bar instead of masthead', () => {
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/shorts/shortId456',
        href: 'https://www.youtube.com/shorts/shortId456',
      });

      const reel = document.createElement('ytd-reel-video-renderer');
      reel.setAttribute('is-active', '');
      const actions = document.createElement('div');
      actions.id = 'actions';
      const dlBtn = document.createElement('button');
      dlBtn.className = 'yp-shorts-download';
      const likeVm = document.createElement('like-button-view-model');
      actions.appendChild(dlBtn);
      actions.appendChild(likeVm);
      reel.appendChild(actions);
      document.body.appendChild(reel);

      window.YouTubePlusStats.ensureShortsStatsButton();

      const statsBtn = actions.querySelector('#yp-stats-universal-icon');
      expect(statsBtn).not.toBeNull();
      expect(statsBtn.classList.contains('shortsStats')).toBe(true);
      expect(dlBtn.nextElementSibling).toBe(statsBtn);

      // Also works when download button is absent and only like-button-view-model is present
      dlBtn.remove();
      statsBtn.remove();
      window.YouTubePlusStats.ensureShortsStatsButton();
      const statsBtnFallback = actions.querySelector('#yp-stats-universal-icon');
      expect(statsBtnFallback).not.toBeNull();
      expect(statsBtnFallback.classList.contains('shortsStats')).toBe(true);

      // Navigating to a non-video page (e.g. /feed/subscriptions) removes the icon and never mounts in masthead
      const masthead = document.createElement('ytd-masthead');
      const end = document.createElement('div');
      end.id = 'end';
      masthead.appendChild(end);
      document.body.appendChild(masthead);
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/feed/subscriptions',
        href: 'https://www.youtube.com/feed/subscriptions',
      });
      window.YouTubePlusStats.ensureShortsStatsButton();
      expect(document.getElementById('yp-stats-universal-icon')).toBeNull();
      expect(masthead.querySelector('#yp-stats-universal-icon')).toBeNull();
    });
  });
});
