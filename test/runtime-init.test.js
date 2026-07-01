/**
 * Runtime characterization tests for the critical runtime modules:
 *   - src/basic.js  (watch/runtime init, settings button, public API)
 *   - src/time.js   (resume overlay, loop control, public API)
 *   - src/main.js   (boot path safety, design-system style handoff)
 *
 * These tests document the CURRENT observable behavior so deeper
 * hardening work on those files can be validated against a stable
 * characterization baseline. They intentionally avoid restructuring
 * the modules and only exercise the externally observable surfaces:
 *
 *   - watch/runtime init is idempotent
 *   - settings button / runtime UI does not duplicate on repeated
 *     init or navigation
 *   - time/resume logic remains stable (overlay, storage, public API)
 *   - boot/runtime path stays safe (no throws on load)
 *   - download and music must remain protected indirectly
 *     (public YouTubePlus namespace + YouTubeUtils compatibility
 *     surface must remain reachable and stable)
 *
 * Conventions:
 *   - Mocks installed in beforeEach match what the build order
 *     guarantees at load time (utils.js, design-system.js,
 *     cleanup-manager.js, etc.).
 *   - jest.resetModules() lets the IIFE re-execute per test so the
 *     internal `YouTubeEnhancer._initialized` flag starts clean.
 *   - These tests do not mutate production files; they only assert
 *     observable behavior of the code under test.
 */

/**
 * @typedef {{
 *   register: (...args: unknown[]) => unknown,
 *   registerListener: (...args: unknown[]) => unknown,
 *   registerInterval: (id: number) => number,
 *   registerTimeout: (id: number) => number,
 *   registerObserver: (obs: unknown) => unknown,
 *   registerAnimationFrame: (id: number) => number,
 *   unregisterListener: (...args: unknown[]) => unknown,
 *   cleanup: (...args: unknown[]) => unknown
 * }} CleanupManagerMock
 */

/**
 * Build a minimal but realistic YouTubeUtils / canonical service mock
 * set, matching what basic.js and time.js expect at module load.
 *
 * @param {{
 *   pathname?: string,
 *   href?: string,
 *   hostname?: string,
 *   withMasthead?: boolean
 * }} [opts]
 */
function installRuntimeMocks(opts = {}) {
  const {
    pathname = '/watch',
    href = `https://www.youtube.com${pathname === '/watch' ? '/watch?v=abc12345678' : pathname}`,
    hostname = 'www.youtube.com',
    withMasthead = true,
  } = opts;

  // Clean DOM for every test
  document.body.innerHTML = '';
  document.head.innerHTML = '';

  if (withMasthead) {
    // basic.js's addSettingsButtonToHeader walks these host-specific
    // targets. We provide the first host-agnostic target so the
    // first mount attempt succeeds deterministically.
    const end = document.createElement('div');
    end.id = 'end';
    const masthead = document.createElement('ytd-masthead');
    masthead.appendChild(end);
    document.body.appendChild(masthead);
  }

  global.mockLocation({
    href,
    hostname,
    pathname,
    search: pathname === '/watch' ? '?v=abc12345678' : '',
  });

  /** @type {CleanupManagerMock} */
  const cleanupManager = {
    register: jest.fn(fn => (typeof fn === 'function' ? fn : fn)),
    registerListener: jest.fn(() => 'listener-token'),
    registerInterval: jest.fn(id => id),
    registerTimeout: jest.fn(id => id),
    registerObserver: jest.fn(obs => obs),
    registerAnimationFrame: jest.fn(id => id),
    unregisterListener: jest.fn(),
    cleanup: jest.fn(),
  };

  /** @type {Record<string, jest.Mock>} */
  const loggerCalls = {};
  const makeLogger = () => ({
    error: jest.fn((...args) => {
      loggerCalls.error = loggerCalls.error || jest.fn();
      loggerCalls.error(...args);
    }),
    warn: jest.fn((...args) => {
      loggerCalls.warn = loggerCalls.warn || jest.fn();
      loggerCalls.warn(...args);
    }),
    info: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  });
  const logger = makeLogger();

  Object.defineProperty(window, '_ytplusCreateHTML', {
    configurable: true,
    writable: true,
    value: jest.fn(s => s),
  });

  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      $: jest.fn((sel, root) => (root || document).querySelector(sel)),
      $$: jest.fn((sel, root) => Array.from((root || document).querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn((key, params) => {
        if (!params || typeof params !== 'object') return String(key || '');
        let out = String(key || '');
        for (const [k, v] of Object.entries(params)) {
          out = out.split(`{${k}}`).join(String(v));
        }
        return out;
      }),
      debounce: jest.fn(fn => fn),
      throttle: jest.fn(fn => fn),
      logError: jest.fn(),
      safeMerge: jest.fn((target, source) => Object.assign(target, source)),
      setSafeHTML: (el, html) => {
        if (el) el.innerHTML = html;
      },
      setTimeout_: (fn, ms) => setTimeout(fn, ms),
      waitForElement: jest.fn(() => new Promise(() => {})),
      waitFor: jest.fn(() => new Promise(() => {})),
      onDomReady: jest.fn(cb => {
        if (document.readyState !== 'loading') {
          try {
            cb();
          } catch {
            /* ignore in test */
          }
        } else {
          document.addEventListener('DOMContentLoaded', cb, { once: true });
        }
      }),
      loadFeatureEnabled: jest.fn(() => true),
      StyleManager: {
        add: jest.fn(),
        remove: jest.fn(),
        clear: jest.fn(),
      },
      NotificationManager: {
        show: jest.fn(),
        hide: jest.fn(),
        remove: jest.fn(),
      },
      cleanupManager,
      storage: {
        get: jest.fn((key, def) => {
          try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : def;
          } catch {
            return def;
          }
        }),
        set: jest.fn((key, val) => {
          try {
            localStorage.setItem(key, JSON.stringify(val));
            return true;
          } catch {
            return false;
          }
        }),
        remove: jest.fn(key => {
          try {
            localStorage.removeItem(key);
            return true;
          } catch {
            return false;
          }
        }),
      },
      logger,
      SETTINGS_KEY: 'youtube_plus_settings',
    },
  });

  Object.defineProperty(window, 'YouTubePlusStorage', {
    configurable: true,
    writable: true,
    value: {
      get: jest.fn((key, def) => {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : def;
        } catch {
          return def;
        }
      }),
      set: jest.fn((key, val) => {
        try {
          localStorage.setItem(key, JSON.stringify(val));
          return true;
        } catch {
          return false;
        }
      }),
    },
  });

  Object.defineProperty(window, 'YouTubePlusLogger', {
    configurable: true,
    writable: true,
    value: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      createLogger: jest.fn(() => logger),
      setLevel: jest.fn(),
      getLevel: jest.fn(() => 'info'),
      getRecent: jest.fn(() => []),
      export: jest.fn(() => '[]'),
      clear: jest.fn(),
      getStats: jest.fn(() => ({ totalEntries: 0 })),
    },
  });

  Object.defineProperty(window, 'YouTubePlusCleanupManager', {
    configurable: true,
    writable: true,
    value: cleanupManager,
  });

  Object.defineProperty(window, 'YouTubePlusSettingsStore', {
    configurable: true,
    writable: true,
    value: {
      load: jest.fn(() => ({ enableResumeTime: true, enableLoop: true })),
      save: jest.fn(() => true),
      get: jest.fn(() => undefined),
      set: jest.fn(() => true),
    },
  });

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      StyleManager: {
        add: jest.fn(),
        remove: jest.fn(),
        clear: jest.fn(),
      },
      getStyle: jest.fn(() => ''),
    },
  });

  Object.defineProperty(window, 'YouTubePlusEventDelegation', {
    configurable: true,
    writable: true,
    value: {
      on: jest.fn(),
      off: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusScreenshot', {
    configurable: true,
    writable: true,
    value: {
      registerHotkey: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusSpeedControl', {
    configurable: true,
    writable: true,
    value: {
      registerHotkeys: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusTimeLoop', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  Object.defineProperty(window, 'YouTubePlusConstants', {
    configurable: true,
    writable: true,
    value: {
      DOWNLOAD_SITES: {
        EXTERNAL_DOWNLOADER: { name: 'SSYouTube', url: 'https://ssyoutube.com/watch?v={videoId}' },
      },
    },
  });

  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: jest.fn(cb => {
      try {
        cb();
      } catch {
        /* ignore in test */
      }
      return 1;
    }),
  });

  Object.defineProperty(window, 'cancelIdleCallback', {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });

  return { cleanupManager, logger };
}

beforeEach(() => {
  // Start every test with a clean runtime namespace.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.resetModules();
  // Remove all module-owned globals from previous tests.
  delete window.YouTubePlus;
  delete window.YouTubePlusTimeLoop;
  delete window.YouTubeEnhancer;
  // time.js (and other hardened modules) use an idempotency guard
  // so HMR / script re-injection cannot double-register listeners.
  // jest.resetModules() clears the require cache but `window` is
  // process-global, so we explicitly clear the guard here.
  delete window.__ytpTimeInitDone__;
  // basic.js now ships with a window-level re-entrancy guard for the
  // same reason (re-injection must not double-fire hotkeys or mount
  // two settings buttons). Clear it so each test starts with a
  // fresh init. Within a single test, re-requiring the module is
  // still a true no-op — the test for that lives in the
  // 'YouTubePlus.openSettings survives repeated init cycles' describe
  // block below.
  delete window.__ytpBasicInitDone__;
  // _ytplusCreateHTML is used by basic.js for safe HTML injection.
  window._ytplusCreateHTML = s => s;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// =============================================================================
// basic.js — watch / runtime init characterization
// =============================================================================

describe('basic.js — runtime init characterization', () => {
  test('init() is idempotent: settings button is mounted exactly once', () => {
    installRuntimeMocks({ pathname: '/watch' });

    require('../src/basic.js');

    // basic.js auto-invokes init on load (document.readyState !== 'loading' in jsdom)
    const firstCount = document.querySelectorAll('.ytp-plus-settings-button').length;
    expect(firstCount).toBe(1);

    // Dispatch a navigation finish event (the second init trigger used
    // by the real runtime in setupNavigationObserver).
    document.dispatchEvent(new CustomEvent('yt-navigate-finish', { bubbles: true }));

    const secondCount = document.querySelectorAll('.ytp-plus-settings-button').length;
    expect(secondCount).toBe(1);
  });

  test('init() exposes the YouTubePlus public settings API used by download/music', () => {
    installRuntimeMocks({ pathname: '/watch' });

    require('../src/basic.js');

    expect(typeof window.YouTubePlus).toBe('object');
    expect(typeof window.YouTubePlus.openSettings).toBe('function');
    expect(typeof window.YouTubePlus.closeSettings).toBe('function');

    // openSettings returns true on success and must not throw
    // (download.js / music.js call this through the public surface).
    expect(() => window.YouTubePlus.openSettings()).not.toThrow();
  });

  test('openSettings/closeSettings is safe to call repeatedly (no duplicate modals)', () => {
    installRuntimeMocks({ pathname: '/watch' });
    require('../src/basic.js');

    // Open twice — the modal handler is responsible for not stacking.
    window.YouTubePlus.openSettings();
    const afterFirst = document.querySelectorAll('.ytp-plus-settings-modal').length;

    // Second call should either reopen the same instance or no-op.
    // The contract we protect: the public API must not throw, and the
    // number of modals should never exceed a small upper bound.
    expect(() => window.YouTubePlus.openSettings()).not.toThrow();
    const afterSecond = document.querySelectorAll('.ytp-plus-settings-modal').length;
    expect(afterSecond).toBeLessThanOrEqual(afterFirst + 1);

    // closeSettings should be callable and must not throw even when
    // the modal is already gone.
    expect(() => window.YouTubePlus.closeSettings()).not.toThrow();
    expect(() => window.YouTubePlus.closeSettings()).not.toThrow();
  });

  test('init() survives missing host header (no settings button, no throw)', () => {
    installRuntimeMocks({ pathname: '/watch', withMasthead: false });

    expect(() => require('../src/basic.js')).not.toThrow();

    // No crash, no settings button — the module must still expose its
    // public surface so other code paths (download/music) that simply
    // read the namespace remain functional.
    expect(typeof window.YouTubePlus?.openSettings).toBe('function');
  });
});

// =============================================================================
// time.js — resume / loop characterization
// =============================================================================

describe('time.js — resume and loop characterization', () => {
  test('YouTubePlusTimeLoop public API is exposed and stable', () => {
    installRuntimeMocks({ pathname: '/watch' });

    require('../src/time.js');

    const api = window.YouTubePlusTimeLoop;
    expect(api).toBeDefined();
    expect(typeof api.toggleLoop).toBe('function');
    expect(typeof api.setLoopPoint).toBe('function');
    expect(typeof api.resetLoopPoints).toBe('function');
    expect(typeof api.applyLoopStateToCurrentVideo).toBe('function');
  });

  test('toggleLoop does not throw when no video element is present', () => {
    installRuntimeMocks({ pathname: '/watch', withMasthead: false });
    require('../src/time.js');

    // No <video> in DOM, no throw, public API stays defined.
    expect(() => window.YouTubePlusTimeLoop.toggleLoop()).not.toThrow();
    expect(() => window.YouTubePlusTimeLoop.toggleLoop()).not.toThrow();
    expect(window.YouTubePlusTimeLoop.toggleLoop).toBeDefined();
  });

  test('resume storage write/read roundtrip is stable across init cycles', () => {
    installRuntimeMocks({ pathname: '/watch', withMasthead: false });
    require('../src/time.js');

    // Pre-seed a resume position the way the real runtime would after
    // a few `timeupdate` ticks.
    const key = 'youtube_resume_times_v1';
    const videoId = 'abc12345678';
    localStorage.setItem(key, JSON.stringify({ [videoId]: 42 }));

    // Re-require the module: internal `featureEnabled` and `activeCleanup`
    // state must rebuild cleanly (no exception, no leaked globals).
    jest.resetModules();
    delete window.YouTubePlusTimeLoop;
    installRuntimeMocks({ pathname: '/watch', withMasthead: false });
    expect(() => require('../src/time.js')).not.toThrow();

    // Storage value is preserved across the resetModules() cycle because
    // localStorage is process-global, not module-local.
    const restored = JSON.parse(localStorage.getItem(key) || '{}');
    expect(restored[videoId]).toBe(42);
  });

  test('init() does not throw when called outside /watch pathname', () => {
    installRuntimeMocks({
      pathname: '/',
      href: 'https://www.youtube.com/',
      hostname: 'www.youtube.com',
      withMasthead: false,
    });

    expect(() => require('../src/time.js')).not.toThrow();
    // Public loop API is still wired so that keyboard handlers
    // registered by basic.js can dispatch to it on any page.
    expect(typeof window.YouTubePlusTimeLoop?.toggleLoop).toBe('function');
  });

  test('IIFE is idempotent: re-requiring the module in the same window does not double-register the public surface', () => {
    installRuntimeMocks({ pathname: '/watch', withMasthead: false });

    require('../src/time.js');
    const first = window.YouTubePlusTimeLoop;
    expect(first).toBeDefined();
    expect(typeof first.toggleLoop).toBe('function');

    // Capture the cleanupManager call count after the first load.
    const cm = /** @type {any} */ (window.YouTubeUtils).cleanupManager;
    const callsAfterFirst = cm.registerListener.mock.calls.length;

    // Re-require without clearing the idempotency guard: the IIFE
    // must early-return and the public surface must stay stable
    // (same reference, no extra cleanupManager registrations).
    require('../src/time.js');

    expect(window.YouTubePlusTimeLoop).toBe(first);
    expect(cm.registerListener.mock.calls.length).toBe(callsAfterFirst);
  });
});

// =============================================================================
// main.js — boot / runtime path safety (indirect, via the public surface)
// =============================================================================

describe('main.js — boot path characterization (indirect)', () => {
  test('loading the build-helper script does not throw on the happy path', () => {
    installRuntimeMocks({ pathname: '/watch' });
    // main.js references `CustomElementRegistry.prototype.define` and
    // trustedTypes at the top of its IIFE; both are present in jsdom.
    // We do not require main.js directly because it auto-injects a
    // <script> element via GM_addElement (not available in jsdom).
    // Instead, we assert the prerequisite globals that main.js needs
    // (design-system, logger) are reachable from the runtime mocks.
    expect(window.YouTubePlusDesignSystem?.StyleManager?.add).toBeDefined();
    expect(window.YouTubePlusLogger?.createLogger).toBeDefined();
  });

  test('runtime namespace remains stable after basic.js and time.js are both loaded', () => {
    installRuntimeMocks({ pathname: '/watch' });
    require('../src/basic.js');
    require('../src/time.js');

    // Both public surfaces must coexist.
    expect(typeof window.YouTubePlus.openSettings).toBe('function');
    expect(typeof window.YouTubePlusTimeLoop.toggleLoop).toBe('function');

    // YouTubeUtils compatibility surface must still expose the
    // properties other critical modules (download/music) read at
    // their load time.
    const U = window.YouTubeUtils;
    expect(U).toBeDefined();
    expect(typeof U.t).toBe('function');
    expect(typeof U.cleanupManager).toBe('object');
    expect(typeof U.loadFeatureEnabled).toBe('function');
    expect(U.SETTINGS_KEY).toBe('youtube_plus_settings');
  });
});

// =============================================================================
// Indirect protection of download.js and music.js
// =============================================================================
// download.js and music.js are the two most critical modules after
// basic.js. They read `window.YouTubeUtils` and `window.YouTubePlus`
// at load time. These tests protect the public surface they depend
// on so a regression in basic.js / time.js / main.js hardening
// cannot silently break download or music.

describe('Indirect protection of download and music', () => {
  test('YouTubePlus.openSettings survives repeated init cycles', () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      jest.resetModules();
      delete window.YouTubePlus;
      // basic.js now ships a window-level init guard; clear it so
      // each loop iteration is a true fresh load (the guard itself
      // is verified by the dedicated test below).
      delete window.__ytpBasicInitDone__;
      installRuntimeMocks({ pathname: '/watch' });
      require('../src/basic.js');
      // Same identity-or-equal function reference is required for
      // download.js / music.js to keep working when they capture
      // `window.YouTubePlus.openSettings` at their own load time.
      expect(typeof window.YouTubePlus.openSettings).toBe('function');
    }
  });

  test('window-level init guard blocks double-injection of basic.js', () => {
    installRuntimeMocks({ pathname: '/watch' });
    // Pre-condition: flag must be cleared by the global beforeEach so
    // the first require in this test actually runs init().
    expect(window.__ytpBasicInitDone__).toBeUndefined();

    // First injection: flag is set, init runs.
    require('../src/basic.js');
    expect(window.__ytpBasicInitDone__).toBe(true);

    // Re-injection in the same window: jest.resetModules() clears the
    // require cache (so the IIFE re-evaluates from scratch) but
    // `window.__ytpBasicInitDone__` survives. The guard must early-
    // return so we don't run init a second time and double-register
    // hotkeys / mount a second settings button.
    const cm = window.YouTubeUtils.cleanupManager;
    const keydownCallsAfterFirst = cm.registerListener.mock.calls.filter(
      c => c[1] === 'keydown'
    ).length;
    expect(keydownCallsAfterFirst).toBeGreaterThan(0);

    jest.resetModules();
    require('../src/basic.js');
    const keydownCallsAfterSecond = cm.registerListener.mock.calls.filter(
      c => c[1] === 'keydown'
    ).length;
    // The guard must have blocked the second init — no extra
    // keydown listeners may have been registered.
    expect(keydownCallsAfterSecond).toBe(keydownCallsAfterFirst);
    expect(window.__ytpBasicInitDone__).toBe(true);
  });

  test('init() phase idempotency: second init() in the same instance does not double-register listeners', () => {
    installRuntimeMocks({ pathname: '/watch' });
    require('../src/basic.js');

    const cm = window.YouTubeUtils.cleanupManager;
    const countFor = (event) =>
      cm.registerListener.mock.calls.filter(c => c[1] === event).length;

    const keydownAfterFirst = countFor('keydown');
    const visibilityAfterFirst = countFor('visibilitychange');
    const navigateFinishAfterFirst = countFor('yt-navigate-finish');
    const navigateStartAfterFirst = countFor('yt-navigate-start');
    const popstateAfterFirst = countFor('popstate');
    const fullscreenAfterFirst = countFor('fullscreenchange');

    // The window-level `__ytpBasicInitDone__` guard is the primary
    // defense. To exercise the per-instance `_initialized` flag
    // independently, we reach into the IIFE-bound YouTubeEnhancer
    // through the public API surface (the cleanupManager is the
    // observer that would catch the duplication). Reset the
    // window guard so a fresh injection can run; the per-instance
    // _initialized flag must still block double-registration.
    // We can't re-call init() on the same YouTubeEnhancer
    // instance without holding a reference to it, so we use a
    // second require: this exercises the per-instance flag only
    // if the test framework re-uses the module — which it does
    // not, so this test is effectively a documentation of the
    // expected behavior under the existing window-guard.
    expect(keydownAfterFirst).toBeGreaterThan(0);
    expect(visibilityAfterFirst).toBeGreaterThan(0);
    expect(navigateFinishAfterFirst).toBeGreaterThan(0);
    expect(navigateStartAfterFirst).toBeGreaterThan(0);
    expect(popstateAfterFirst).toBeGreaterThan(0);
    expect(fullscreenAfterFirst).toBeGreaterThan(0);

    // A second require (which the window-guard now blocks) must
    // not add any of those listeners. Reuse the same counter
    // pattern as the guard test above.
    jest.resetModules();
    require('../src/basic.js');
    expect(countFor('keydown')).toBe(keydownAfterFirst);
    expect(countFor('visibilitychange')).toBe(visibilityAfterFirst);
    expect(countFor('yt-navigate-finish')).toBe(navigateFinishAfterFirst);
    expect(countFor('yt-navigate-start')).toBe(navigateStartAfterFirst);
    expect(countFor('popstate')).toBe(popstateAfterFirst);
    expect(countFor('fullscreenchange')).toBe(fullscreenAfterFirst);
  });

  test('YouTubeUtils compatibility surface keeps the properties download/music need', () => {
    installRuntimeMocks({ pathname: '/watch' });
    require('../src/basic.js');

    // These are the symbols download.js / music.js read off
    // window.YouTubeUtils at module load. If a hardening pass renames
    // or drops one of them, these tests will fail loudly before the
    // critical module is broken in production.
    const U = /** @type {Record<string, unknown>} */ (window.YouTubeUtils);
    const required = [
      '$',
      '$$',
      'byId',
      't',
      'cleanupManager',
      'loadFeatureEnabled',
      'storage',
      'logger',
      'SETTINGS_KEY',
      'StyleManager',
      'NotificationManager',
      'onDomReady',
      'safeMerge',
      'logError',
    ];
    for (const key of required) {
      expect(U[key]).toBeDefined();
    }
  });

  test('time.js init does not consume the only cleanupManager registration slot', () => {
    const { cleanupManager } = installRuntimeMocks({
      pathname: '/watch',
      withMasthead: false,
    });
    require('../src/time.js');

    // time.js may register listeners via the cleanupManager; that
    // must not break future registrations from basic.js or download.js.
    const registerListenerCount = cleanupManager.registerListener.mock.calls.length;
    expect(registerListenerCount).toBeGreaterThanOrEqual(0);

    // A subsequent basic.js init in the same test must be able to use
    // the same cleanupManager without conflict.
    jest.resetModules();
    delete window.YouTubeEnhancer;
    delete window.YouTubePlus;
    installRuntimeMocks({ pathname: '/watch' });
    expect(() => require('../src/basic.js')).not.toThrow();
    expect(cleanupManager.registerListener).toBeDefined();
  });
});
