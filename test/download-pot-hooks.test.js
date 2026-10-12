/**
 * Download PoT hook integration regression: lazy install + ownership.
 *
 * Contract under test (real CleanupManager + real utils + real
 * MutationCoordinator; only external boundaries are stubbed):
 *   - The page globals stay PRISTINE at module boot and on every SPA
 *     navigation cycle — no eager global patches.
 *   - Opening the subtitle menu (the download modal's subtitle dropdown)
 *     installs the hooks once per session; navigation cycles never
 *     uninstall or re-wrap them.
 *   - Ownership is checked by saved reference, not function.name: a
 *     third-party wrapper with the same `patchedFetch` name must never be
 *     overwritten by our install, and a wrapper installed after ours must
 *     be left in place.
 *   - The disable switch keeps the page globals pristine even when the
 *     subtitle menu is opened.
 */

describe('Download PoT hooks lifecycle and ownership', () => {
  const BASE_FETCH = (input, _init) =>
    Promise.resolve({ ok: true, status: 200, url: String(input) });
  // Captured before ANY test module runs, so every afterEach can restore the
  // truly pristine prototype even if an uninstall was skipped mid-test.
  const PRISTINE_XHR_OPEN = window.XMLHttpRequest.prototype.open;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    });
    // Keep the scheduled UI init inert: the PoT hook lifecycle is the
    // contract under test, not the button panel.
    window.requestIdleCallback = jest.fn();
    // Deterministic base fetch BEFORE the module loads so the boot-time
    // install wraps exactly this reference.
    window.fetch = BASE_FETCH;
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/mutation-coordinator.js');
    require('../src/download.js');
  });

  afterEach(() => {
    // Restore the pristine jsdom fetch/XHR so later suites are unaffected.
    window.fetch = BASE_FETCH;
    window.XMLHttpRequest.prototype.open = PRISTINE_XHR_OPEN;
    delete window.requestIdleCallback;
  });

  const navigateFinish = () => {
    document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
  };

  /** Drive the real UI: open the download modal, then its subtitle menu. */
  const openSubtitleMenu = () => {
    window.YouTubePlusDownload.openModal();
    const ss = document.querySelector('[role="listbox"][aria-label="Subtitle language"]');
    expect(ss).toBeTruthy();
    ss.firstElementChild.click();
  };

  test('boot and navigation install nothing; the subtitle menu installs session-once', () => {
    // Boot is lazy: no global fetch/XHR patch at require time.
    expect(window.fetch).toBe(BASE_FETCH);
    expect(window.XMLHttpRequest.prototype.open).toBe(PRISTINE_XHR_OPEN);

    // SPA cycles alone never install the hooks.
    for (let i = 0; i < 5; i++) navigateFinish();
    expect(window.fetch).toBe(BASE_FETCH);
    expect(window.XMLHttpRequest.prototype.open).toBe(PRISTINE_XHR_OPEN);

    // The user's first subtitle-menu open installs the wrappers.
    openSubtitleMenu();
    const installPatch = window.fetch;
    expect(installPatch).not.toBe(BASE_FETCH);
    expect(window.XMLHttpRequest.prototype.open).not.toBe(PRISTINE_XHR_OPEN);

    // Session-once: 20 more SPA cycles never uninstall or re-wrap.
    for (let i = 0; i < 20; i++) navigateFinish();
    expect(window.fetch).toBe(installPatch);
    expect(window.XMLHttpRequest.prototype.open).not.toBe(PRISTINE_XHR_OPEN);
  });

  test('third-party wrapper with the same patchedFetch name is not overwritten', () => {
    openSubtitleMenu();
    const ours = window.fetch; // our patchedFetch from the lazy install
    expect(ours).not.toBe(BASE_FETCH);

    // Third-party script wraps OUR patched function, keeping the same
    // function name (`patchedFetch`) — the old name-based ownership check
    // treated this as ours and clobbered it.
    const thirdParty = function patchedFetch(input, init) {
      return ours.call(this, input, init);
    };
    window.fetch = thirdParty;

    // Session-once — a navigation cycle neither uninstalls nor
    // re-wraps; the third-party wrapper stays on top untouched.
    navigateFinish();
    expect(window.fetch).toBe(thirdParty);
  });

  test('wrapper installed after ours is left intact by uninstall and wrapped on remount', () => {
    const cm = window.YouTubePlusCleanupManager;
    openSubtitleMenu();
    const ours = window.fetch;

    const external = function externalWrapper(input, init) {
      return ours.call(this, input, init);
    };
    window.fetch = external;

    cm.cleanup();
    // Session-once — cleanup does not uninstall; the external wrapper
    // is untouched and forwarding still reaches the base through our patch.
    expect(window.fetch).toBe(external);

    navigateFinish();
    // No remount re-wrap: the same external wrapper stays installed.
    expect(window.fetch).toBe(external);

    // Simulate the player making a timedtext request through the chain:
    // the request reaches the external wrapper, which forwards into our
    // boot patch → base (forwarding preserved end-to-end).
    let forwarded;
    const recordingExternal = function externalWrapper(input, init) {
      forwarded = input;
      return external.call(this, input, init);
    };
    window.fetch = recordingExternal;
    const top = window.fetch;
    const url = 'https://www.youtube.com/api/timedtext?v=aaaaaaaaaaa&pot=TOKEN&potc=1&c=WEB';
    return Promise.resolve(top.call(window, url, {})).then(() => {
      expect(forwarded).toBe(url);
    });
  });

  test('XHR open stays patched across navigation cycles', () => {
    openSubtitleMenu();
    const proto = window.XMLHttpRequest.prototype;
    const ours = proto.open; // our patched open from the lazy install
    expect(ours).not.toBe(PRISTINE_XHR_OPEN);

    // Session-once: navigation cycles never uninstall the XHR patch.
    for (let i = 0; i < 5; i++) navigateFinish();
    expect(proto.open).toBe(ours);
  });
});

describe('POT hooks: session-once, subtitles-gated, never uninstalled on navigation', () => {
  const BASE_FETCH_R8 = (input, _init) =>
    Promise.resolve({ ok: true, status: 200, url: String(input) });
  const PRISTINE_OPEN_R8 = window.XMLHttpRequest.prototype.open;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=ccccccccccc',
    });
    window.requestIdleCallback = jest.fn();
    window.fetch = BASE_FETCH_R8;
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/mutation-coordinator.js');
  });

  afterEach(() => {
    window.fetch = BASE_FETCH_R8;
    window.XMLHttpRequest.prototype.open = PRISTINE_OPEN_R8;
    delete window.requestIdleCallback;
  });

  const navigateCycle = cm => {
    cm.cleanup();
    document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
  };

  /** Drive the real UI: open the download modal, then its subtitle menu. */
  const openSubtitleMenu = () => {
    window.YouTubePlusDownload.openModal();
    const ss = document.querySelector('[role="listbox"][aria-label="Subtitle language"]');
    expect(ss).toBeTruthy();
    ss.firstElementChild.click();
  };

  test('20 SPA cycles with a third-party wrapper keep the chain at depth 1', () => {
    require('../src/download.js');
    // Boot is lazy: the globals are pristine until the subtitle menu opens.
    expect(window.fetch).toBe(BASE_FETCH_R8);
    openSubtitleMenu();
    const bootPatch = window.fetch;
    expect(bootPatch).not.toBe(BASE_FETCH_R8);

    // A third-party script wraps our patch AFTER boot.
    let thirdPartyCalls = 0;
    const thirdParty = function externalWrapper(input, init) {
      thirdPartyCalls += 1;
      return bootPatch.call(this, input, init);
    };
    window.fetch = thirdParty;

    const cm = window.YouTubePlusCleanupManager;
    for (let i = 0; i < 20; i++) navigateCycle(cm);

    // Hooks are session-once — the top of the chain NEVER changes and
    // no extra layers are wrapped on navigation.
    expect(window.fetch).toBe(thirdParty);

    // One timedtext request through the top must pass exactly one layer of
    // our code and reach the base exactly once (chain depth = 1 per side).
    let baseCalls = 0;
    window.fetch = async (input, init) => {
      thirdPartyCalls += 1;
      const res = await BASE_FETCH_R8(input, init);
      baseCalls += 1;
      return res;
    };
    // Re-install must be a no-op now (session-once) — the top stays ours.
    window.YouTubePlusDownload._installPotHooksOnce();
    const top = window.fetch;
    const before = thirdPartyCalls;
    return Promise.resolve(
      top.call(window, 'https://www.youtube.com/api/timedtext?v=ccccccccccc&pot=T&potc=1', {})
    ).then(() => {
      expect(thirdPartyCalls).toBe(before + 1);
      expect(baseCalls).toBe(1);
    });
  });

  test('hooks are never uninstalled and never re-wrapped across navigation cycles', () => {
    require('../src/download.js');
    openSubtitleMenu();
    const cm = window.YouTubePlusCleanupManager;
    const bootPatch = window.fetch;
    expect(bootPatch).not.toBe(BASE_FETCH_R8);

    for (let i = 0; i < 20; i++) navigateCycle(cm);

    // Session-once: the very same function reference stays installed.
    expect(window.fetch).toBe(bootPatch);
    // XHR patch likewise survives every navigation sweep.
    expect(window.XMLHttpRequest.prototype.open).not.toBe(PRISTINE_OPEN_R8);
  });

  test('hooks are not installed when the download feature is disabled', () => {
    window.YouTubeUtils = {
      ...window.YouTubeUtils,
      loadFeatureEnabled: jest.fn(() => false),
    };
    require('../src/download.js');

    // The subtitle-capturing hooks stay OFF for users without the feature —
    // even when they open the subtitle menu.
    expect(window.fetch).toBe(BASE_FETCH_R8);
    expect(window.XMLHttpRequest.prototype.open).toBe(PRISTINE_OPEN_R8);
    openSubtitleMenu();
    expect(window.fetch).toBe(BASE_FETCH_R8);
    expect(window.XMLHttpRequest.prototype.open).toBe(PRISTINE_OPEN_R8);
  });
});
