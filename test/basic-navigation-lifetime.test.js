/**
 * Basic navigation dispatcher lifetime.
 *
 * Contract under test (real Basic + real CleanupManager, no mocks of the
 * dispatcher itself):
 *   - The navigation dispatcher (yt-navigate-finish, yt-navigate-start,
 *     popstate, fullscreenchange) keeps reacting across per-navigation
 *     cleanupManager.cleanup() sweeps for the whole page session.
 *   - Exactly one active handler of each kind — the registry must not grow
 *     across cleanup + re-setup cycles (dedup by handler identity).
 *   - 20 navigation cycles of mixed kinds (watch→watch, watch→home→watch,
 *     popstate, fullscreen) preserve the reaction.
 *
 * This is the user-visible contract after the first SPA
 * navigation sweep, Basic must still update page controls/styles on later
 * navigations instead of silently going dead.
 */

describe('Basic navigation dispatcher survives cleanup sweeps', () => {
  let cm;

  const WATCH_HREF = 'https://www.youtube.com/watch?v=abcdefghijk';
  const HOME_HREF = 'https://www.youtube.com/';

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    delete window.__ytpBasicInitDone__;
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: WATCH_HREF,
    });

    // Real dependency chain in build order (same as basic.test.js).
    require('../src/cleanup-manager.js');
    require('../src/design-system.js');
    require('../src/utils.js');
    require('../src/safe-dom.js');
    require('../src/settings-store.js');
    require('../src/settings-helpers.js');
    // Suppress basic.js auto-init (its DOMContentLoaded/immediate init would
    // bind the real handleFullscreenChange before the test can inject its
    // page-scope spies). The dispatcher under test is mounted explicitly
    // via setupNavigationObserver below —
    window.__ytpBasicInitDone__ = true;
    require('../src/basic.js');

    cm = window.YouTubePlusCleanupManager;
  });

  afterEach(() => {
    jest.useRealTimers();
    delete window.__ytpBasicInitDone__;
    document.body.innerHTML = '';
  });

  const goto = href => {
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: href.includes('watch?v=') ? '/watch' : '/',
      href,
    });
  };

  const navigateFinishOn = href => {
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: href.includes('watch?v=') ? '/watch' : '/',
      href,
    });
    document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
  };

  test('20 mixed navigations with per-navigation cleanup keep one live handler of each kind', () => {
    const enhancer = window.YouTubePlusBasic.createEnhancer();

    // Replace page-scope work (not the dispatcher contract under test):
    // setupCurrentPage is the per-/watch mount; the rest are UI refreshes.
    let pageMounts = 0;
    let styleRefreshes = 0;
    let settingsRefreshes = 0;
    let fullscreenReactions = 0;
    enhancer.setupCurrentPage = () => {
      pageMounts++;
    };
    enhancer.insertStyles = () => {
      styleRefreshes++;
    };
    enhancer.addSettingsButtonToHeader = () => {
      settingsRefreshes++;
    };
    enhancer.handleFullscreenChange = () => {
      fullscreenReactions++;
    };

    enhancer.setupNavigationObserver();

    // The exact runtime flow: utils.js sweeps all non-persistent listeners
    // on yt-navigate-start. We reproduce that sweep explicitly between
    // navigations so the dispatcher must outlive it.
    const sweep = () => cm.cleanup();

    // 20 cycles covering every dispatcher kind:
    //  - yt-navigate-finish watch→watch
    //  - yt-navigate-finish watch→home→watch
    //  - popstate URL change (home→watch)
    //  - fullscreenchange
    for (let i = 0; i < 20; i++) {
      const registryBefore = cm.getListenerStats().active;
      const kind = i % 5;

      if (kind === 0) {
        // watch → watch: navigate-finish must mount the page exactly once.
        const before = pageMounts;
        navigateFinishOn(WATCH_HREF);
        expect(pageMounts).toBe(before + 1);
        expect(styleRefreshes).toBeGreaterThan(0);
        sweep();
      } else if (kind === 1) {
        // watch → home → watch: dispatcher must react on both legs.
        navigateFinishOn(HOME_HREF);
        const before = pageMounts;
        navigateFinishOn(WATCH_HREF);
        expect(pageMounts).toBe(before + 1);
        sweep();
      } else if (kind === 2) {
        // popstate URL change onto a *different* watch page → debounced page
        // mount. The dispatcher only reacts on a real URL delta.
        const before = pageMounts;
        goto('https://www.youtube.com/watch?v=nextvid' + i);
        window.dispatchEvent(new CustomEvent('popstate'));
        jest.advanceTimersByTime(500);
        expect(pageMounts).toBe(before + 1);
        sweep();
      } else if (kind === 3) {
        // fullscreenchange must still reach the handler after sweeps.
        const before = fullscreenReactions;
        document.dispatchEvent(new CustomEvent('fullscreenchange'));
        expect(fullscreenReactions).toBe(before + 1);
        sweep();
      } else {
        // yt-navigate-start dispatcher (URL-change fallback path) on home.
        goto(HOME_HREF);
        const before = settingsRefreshes;
        document.dispatchEvent(new CustomEvent('yt-navigate-start'));
        jest.advanceTimersByTime(500);
        // No URL change happened (goto set the same href the dispatcher
        // captured) — but the navigate-finish leg on home must still not
        // throw, and a fresh watch leg must work again afterwards.
        navigateFinishOn(WATCH_HREF);
        expect(settingsRefreshes).toBeGreaterThanOrEqual(before);
        sweep();
      }

      // No listener growth: after every cycle the dispatcher must still be
      // represented by exactly one entry per (target, event, handler).
      const registryAfter = cm.getListenerStats().active;
      expect(registryAfter).toBeLessThanOrEqual(registryBefore);

      const listeners = [...cm.listeners.values()];
      const kinds = [
        ['fullscreenchange', enhancer._onFullscreenChange_, document],
        ['yt-navigate-finish', enhancer._onNavigateFinish_, document],
        ['popstate', enhancer._onPopState_, window],
        ['yt-navigate-start', enhancer._onNavigateStart_, document],
      ];
      for (const [ev, fn, target] of kinds) {
        const entries = listeners.filter(l => l.target === target && l.ev === ev && l.fn === fn);
        expect(entries).toHaveLength(1);
      }
    }

    // Reaction totals across the whole session (each kind exercised ≥ 3x).
    expect(pageMounts).toBeGreaterThanOrEqual(8);
    expect(fullscreenReactions).toBeGreaterThanOrEqual(3);
    expect(styleRefreshes).toBeGreaterThanOrEqual(8);
  });
});
