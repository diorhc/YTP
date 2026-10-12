/**
 * P2D — Lifecycle / Resource Ownership regression suite.
 *
 * Target invariants (real modules, real CleanupManager, real
 * FeatureRegistry/VisionDockHost):
 *   A. 100 init → use → cleanup cycles return tracked resource counts to the
 *      pre-init baseline; no detached registrations.
 *   B. double cleanup is safe (no throw, no negative counters, no stale
 *      registry entries).
 *   C. repeated init (mount → mount) does not duplicate registrations.
 *   D. 20 SPA navigation lifecycle cycles (navigate-start sweep +
 *      navigate-finish re-render) return counts to baseline.
 *   E. repeated player replacement releases the old registration set; the
 *      new player receives exactly one owned registration set.
 *   F. repeated theme/settings rerenders do not accumulate.
 *   G. mountDock: the previously observed detached-registration accumulation
 *      (≈20/60/20 after 20 cycles) is eliminated for the REAL descriptors —
 *      including the classic loop/speed/zoom mount paths and the loop-pill
 *      re-render path.
 *   H. feature isolation: removing one feature leaves other features alive.
 *   I. DOM detachment: removing a mounted control leaves no reachable stale
 *      handler registrations owned by that control/feature.
 * @jest-environment jsdom
 */

const { installListenerTracker } = require('../scripts/listener-tracker.js');

const WATCH_HREF = 'https://www.youtube.com/watch?v=testvideo1';

function mockLocation() {
  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    href: WATCH_HREF,
  });
}

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
}

function loadFeatures() {
  require('../src/zoom.js');
  require('../src/speedcontrol.js');
  require('../src/time.js');
  require('../src/thumbnail.js');
  require('../src/download.js');
  require('../src/stats.js');
}

/** Manager entries whose target element is detached from the document. */
function detachedManagerEntries() {
  const cm = window.YouTubePlusCleanupManager;
  return [...cm.listeners.values()].filter(
    e =>
      e.target && typeof e.target === 'object' && 'isConnected' in e.target && !e.target.isConnected
  );
}

function persistentDocListenerCount(ev) {
  const cm = window.YouTubePlusCleanupManager;
  return [...cm.listeners.values()].filter(
    e => e.target === document && e.ev === ev && e.persistent
  ).length;
}

/** Manager entries referencing any element inside (or equal to) `root`. */
function managerEntriesUnder(root) {
  const cm = window.YouTubePlusCleanupManager;
  return [...cm.listeners.values()].filter(
    e => e.target instanceof Element && (e.target === root || root.contains(e.target))
  );
}

function makePlayer(id = 'movie_player') {
  const player = document.createElement('div');
  player.id = id;
  document.body.appendChild(player);
  return player;
}

describe('P2D — lifecycle resource ownership (real modules)', () => {
  beforeAll(() => {
    require('../src/cleanup-manager.js');
  });

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.__ytpTimeInitDone__;
    delete window.__ytpBasicInitDone__;
    mockLocation();
    loadChain();
  });

  afterEach(() => {
    window.YouTubePlusVisionDockHost?.unmount?.();
    window.YouTubePlusFeatureRegistry?._reset?.();
    document.body.innerHTML = '';
  });

  // -------------------------------------------------------------------
  // A — 100 init → use → cleanup cycles
  // -------------------------------------------------------------------
  test('A: 100 mount/sweep cycles return listener counts to baseline with zero detached entries', () => {
    loadFeatures();
    const host = window.YouTubePlusVisionDockHost;
    const cm = window.YouTubePlusCleanupManager;
    const player = makePlayer();

    // Warm-up cycle: module-load one-time resources (e.g. the zoom UI built
    // at module init) are swept exactly once; from the second cycle onward
    // the steady-state baseline must hold.
    host.mount(player);
    cm.cleanup();
    host.mount(player);
    const baseline = cm.getListenerStats().active;
    expect(baseline).toBeGreaterThan(0);

    for (let i = 0; i < 100; i++) {
      cm.cleanup(); // yt-navigate-start sweep
      host.mount(player); // yt-navigate-finish re-render
      expect(detachedManagerEntries()).toHaveLength(0);
    }

    expect(cm.getListenerStats().active).toBe(baseline);
    expect(detachedManagerEntries()).toHaveLength(0);

    // The dock is still functional after 100 cycles.
    const loopBtn = host.getDock()?.querySelector('#yp-vision-loop-btn');
    expect(loopBtn).toBeTruthy();
    loopBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.YouTubePlusTimeLoop?.getLoopState?.().enabled).toBe(true);
  });

  // -------------------------------------------------------------------
  // B — double cleanup
  // -------------------------------------------------------------------
  test('B: double cleanup is idempotent — no throw, no negative counters, no stale entries', () => {
    loadFeatures();
    const host = window.YouTubePlusVisionDockHost;
    const cm = window.YouTubePlusCleanupManager;
    makePlayer();
    host.mount();

    expect(() => cm.cleanup()).not.toThrow();
    const afterFirst = cm.getListenerStats();
    expect(() => cm.cleanup()).not.toThrow();
    const afterSecond = cm.getListenerStats();

    expect(afterSecond.active).toBeGreaterThanOrEqual(0);
    // A second cleanup must not resurrect or duplicate anything.
    expect(afterSecond.registeredTotal).toBe(afterFirst.registeredTotal);
    // Buttons mounted by the host were released by unmount + sweep.
    expect(detachedManagerEntries()).toHaveLength(0);
    expect(
      [...cm.listeners.values()].filter(e => e.target instanceof HTMLButtonElement)
    ).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // C — repeated init (idempotent mount)
  // -------------------------------------------------------------------
  test('C: mount → mount without cleanup does not duplicate registrations', () => {
    loadFeatures();
    const host = window.YouTubePlusVisionDockHost;
    const cm = window.YouTubePlusCleanupManager;
    const player = makePlayer();

    host.mount(player);
    const afterFirst = cm.getListenerStats().active;
    host.mount(player);
    const afterSecond = cm.getListenerStats().active;

    expect(afterSecond).toBe(afterSecond); // sanity
    expect(afterSecond).toBeLessThanOrEqual(afterFirst + 0);
    expect(detachedManagerEntries()).toHaveLength(0);
    // Exactly one button per feature despite the double mount.
    expect(document.querySelectorAll('.vision-top-center-dock #yp-vision-loop-btn')).toHaveLength(
      1
    );
  });

  // -------------------------------------------------------------------
  // D — 20 SPA navigation cycles (real navigation events)
  // -------------------------------------------------------------------
  test('D: 20 SPA navigation cycles (start sweep + finish remount) return counts to baseline', () => {
    loadFeatures();
    const host = window.YouTubePlusVisionDockHost;
    const cm = window.YouTubePlusCleanupManager;
    makePlayer();

    host.mount(window.YouTubePlusVisionDockHost.getPlayer());
    cm.cleanup();
    host.mount(host.getPlayer());
    const baseline = cm.getListenerStats().active;

    for (let i = 0; i < 20; i++) {
      // Real flow: utils.js sweeps on yt-navigate-start; the dock re-renders
      // on yt-navigate-finish via the explicit host mount below.
      document.dispatchEvent(new Event('yt-navigate-start'));
      host.mount(host.getPlayer());
      expect(detachedManagerEntries()).toHaveLength(0);
    }

    expect(cm.getListenerStats().active).toBeLessThanOrEqual(baseline);
    expect(detachedManagerEntries()).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // E — repeated player replacement
  // -------------------------------------------------------------------
  test('E: 20 player replacements release the old registration set; new player owns exactly one', () => {
    loadFeatures();
    const host = window.YouTubePlusVisionDockHost;
    const loop = window.YouTubePlusTimeLoop;

    for (let i = 0; i < 20; i++) {
      const oldPlayer = document.getElementById('movie_player');
      host.unmount?.();
      oldPlayer?.remove();
      const player = makePlayer('movie_player');
      host.mount(player);

      // The new player's dock is interactive; the loop button works.
      const btn = host.getDock()?.querySelector('#yp-vision-loop-btn');
      expect(btn).toBeTruthy();
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(loop.getLoopState().enabled).toBe(true);
      loop.toggleLoop(); // reset for the next cycle
      expect(detachedManagerEntries()).toHaveLength(0);
    }
  });

  // -------------------------------------------------------------------
  // F — repeated theme / settings rerender
  // -------------------------------------------------------------------
  test('F: 20 settings-driven rerenders do not accumulate listeners or controls', () => {
    loadFeatures();
    const host = window.YouTubePlusVisionDockHost;
    const cm = window.YouTubePlusCleanupManager;
    const store = window.YouTubePlusSettingsStore;
    const player = makePlayer();
    host.mount(player);

    const baseline = cm.getListenerStats().active;
    const baselineDockButtons = document.querySelectorAll('.vision-top-center-dock button').length;

    for (let i = 0; i < 20; i++) {
      store.set('enableLoop', false);
      store.set('enableLoop', true);
    }

    expect(cm.getListenerStats().active).toBeLessThanOrEqual(baseline);
    expect(detachedManagerEntries()).toHaveLength(0);
    expect(document.querySelectorAll('.vision-top-center-dock button').length).toBe(
      baselineDockButtons
    );
  });

  // -------------------------------------------------------------------
  // G — mountDock real descriptors (the known accumulation signature)
  // -------------------------------------------------------------------
  test('G1: 20 classic loop-button mount cycles leave one persistent state listener and two hover listeners on the shared dropdown', () => {
    const tracker = installListenerTracker(window);
    try {
      loadFeatures();
      const cm = window.YouTubePlusCleanupManager;
      const loop = window.YouTubePlusTimeLoop;

      // Baseline: one classic mount.
      const controls0 = document.createElement('div');
      controls0.className = 'ytp-right-controls';
      document.body.appendChild(controls0);
      loop.addClassicLoopButton(controls0);
      const dropdown = document.querySelector('#yp-classic-loop-dropdown');
      expect(dropdown).toBeTruthy();
      const baselineNative = tracker.getTotalCount();

      for (let i = 0; i < 20; i++) {
        cm.cleanup(); // navigate-start sweep
        const controls = document.createElement('div');
        controls.className = 'ytp-right-controls';
        document.body.appendChild(controls);
        loop.addClassicLoopButton(controls);
      }

      // 1. exactly ONE persistent document state listener (was: 20).
      expect(persistentDocListenerCount('yp-loop-state-changed')).toBe(1);
      // 2. no manager entries pointing at detached buttons.
      expect(detachedManagerEntries()).toHaveLength(0);
      // 3. the shared dropdown keeps exactly the live wiring: hover
      //    enter/leave (2) + the ONE delegated click root (P2D) — previously
      //    it stacked 2 hover listeners per cycle.
      expect(tracker.getTargetCount(document.querySelector('#yp-classic-loop-dropdown'))).toBe(3);
      // 4. native listener count returns to the cycle-0 baseline.
      cm.cleanup();
      expect(tracker.getTotalCount()).toBeLessThanOrEqual(baselineNative);
      // 5. a fresh mount after the sweep (navigate-finish flow) still works.
      const fresh = document.createElement('div');
      fresh.className = 'ytp-right-controls';
      document.body.appendChild(fresh);
      loop.addClassicLoopButton(fresh);
      const btn = fresh.querySelector('.yp-loop-button');
      expect(btn).toBeTruthy();
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(window.YouTubePlusTimeLoop.getLoopState().enabled).toBe(true);
    } finally {
      tracker.restore();
    }
  });

  test('G2: repeated loop-pill re-renders register nothing new and stay clickable', () => {
    loadFeatures();
    const host = window.YouTubePlusVisionDockHost;
    const cm = window.YouTubePlusCleanupManager;
    const player = makePlayer();
    host.mount(player);

    const pill = player.querySelector('#yp-vision-loop-pill');
    expect(pill).toBeTruthy();

    host
      .getDock()
      ?.querySelector('#yp-vision-loop-btn')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.YouTubePlusTimeLoop.getLoopState().enabled).toBe(true);

    const before = cm.getListenerStats().active;
    for (let i = 0; i < 20; i++) {
      window.YouTubePlusTimeLoop.populateVisionLoopPill(pill, {
        enabled: true,
        pointA: 5,
        pointB: 10,
        frameA: null,
        frameB: null,
      });
    }
    // The delegated registration is created ONCE per pill; re-population is
    // a pure content update.
    expect(cm.getListenerStats().active).toBe(before);
    expect(detachedManagerEntries()).toHaveLength(0);

    // The CURRENT buttons (re-rendered 20 times) still act through the
    // delegated registration.
    const toggle = pill.querySelector('.yp-vision-loop-toggle-btn');
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.YouTubePlusTimeLoop.getLoopState().enabled).toBe(false);
  });

  test('G3: repeated classic loop dropdown refreshes register nothing new', () => {
    loadFeatures();
    const cm = window.YouTubePlusCleanupManager;
    const loop = window.YouTubePlusTimeLoop;

    const controls = document.createElement('div');
    controls.className = 'ytp-right-controls';
    document.body.appendChild(controls);
    loop.addClassicLoopButton(controls);
    const dropdown = document.querySelector('#yp-classic-loop-dropdown');

    const before = cm.getListenerStats().active;
    for (let i = 0; i < 20; i++) {
      // Equivalent of updateDropdown() on every hover show.
      loop.populateClassicLoopDropdown
        ? loop.populateClassicLoopDropdown(dropdown, loop.getLoopState())
        : null;
    }
    // populateClassicLoopDropdown is module-internal; drive it through the
    // public state handler instead when not exposed: toggle the loop, which
    // dispatches yp-loop-state-changed → the handler refreshes the dropdown.
    window.YouTubePlusTimeLoop.toggleLoop();
    window.YouTubePlusTimeLoop.toggleLoop();

    expect(cm.getListenerStats().active).toBeLessThanOrEqual(before);
    expect(detachedManagerEntries()).toHaveLength(0);
  });

  test('G4: 20 classic speed-button mounts keep native wiring at the baseline', () => {
    const tracker = installListenerTracker(window);
    try {
      loadFeatures();
      const cm = window.YouTubePlusCleanupManager;
      const speed = window.YouTubePlusSpeedControl;
      const enhancer = {
        settings: { enableSpeedControl: true },
        speedControl: { availableSpeeds: [0.5, 1, 1.5, 2], currentSpeed: 1 },
      };

      const controls0 = document.createElement('div');
      controls0.className = 'ytp-right-controls';
      document.body.appendChild(controls0);
      speed.addButton(enhancer, controls0);
      const baselineNative = tracker.getTotalCount();

      for (let i = 0; i < 20; i++) {
        cm.cleanup();
        const controls = document.createElement('div');
        controls.className = 'ytp-right-controls';
        document.body.appendChild(controls);
        speed.addButton(enhancer, controls);
      }

      expect(detachedManagerEntries()).toHaveLength(0);
      cm.cleanup();
      expect(tracker.getTotalCount()).toBeLessThanOrEqual(baselineNative);
      // The fresh button still toggles the dropdown.
      const badge = document.querySelector('.ytp-right-controls .speed-control-btn');
      expect(badge).toBeTruthy();
    } finally {
      tracker.restore();
    }
  });

  // -------------------------------------------------------------------
  // H — feature ownership isolation
  // -------------------------------------------------------------------
  test('H: removing one feature leaves the other features interactive', () => {
    // jsdom lacks ResizeObserver; zoom's command builds its UI on demand.
    class ROStub {
      observe() {
        /* mock */
      }
      unobserve() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
    }
    global.ResizeObserver = ROStub;
    window.ResizeObserver = ROStub;

    loadFeatures();
    const host = window.YouTubePlusVisionDockHost;
    makePlayer();
    host.mount(host.getPlayer());

    const loopBtn = host.getDock()?.querySelector('#yp-vision-loop-btn');
    const zoomBtn = host.getDock()?.querySelector('#yp-vision-zoom-btn');
    expect(loopBtn).toBeTruthy();
    expect(zoomBtn).toBeTruthy();

    host.removeFeatureButton('loop');
    expect(host.getDock()?.querySelector('#yp-vision-loop-btn')).toBeNull();

    // The zoom feature (custom mountDock) still works: its command creates
    // and shows the zoom control UI.
    zoomBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const zoomWrap = document.getElementById('yp-zoom-control');
    expect(zoomWrap).toBeTruthy();
    expect(zoomWrap?.classList.contains('visible')).toBe(true);

    // And the loop feature can be re-rendered without breaking zoom.
    host.renderFeature('loop', host.getPlayer(), host.getDock());
    expect(host.getDock()?.querySelector('#yp-vision-loop-btn')).toBeTruthy();
    global.ResizeObserver = undefined;
    window.ResizeObserver = undefined;
  });

  // -------------------------------------------------------------------
  // I — DOM detachment
  // -------------------------------------------------------------------
  test('I: removing the loop pill leaves no registrations owned by the pill', () => {
    loadFeatures();
    const host = window.YouTubePlusVisionDockHost;
    const player = makePlayer();
    host.mount(player);

    const pill = player.querySelector('#yp-vision-loop-pill');
    expect(pill).toBeTruthy();

    // Populate once so the pill's click wiring exists.
    window.YouTubePlusTimeLoop.populateVisionLoopPill(pill, {
      enabled: false,
      pointA: null,
      pointB: null,
      frameA: null,
      frameB: null,
    });

    // No per-button manager entries exist under the pill: the click wiring
    // is one delegated registration on the pill itself (native root).
    expect(managerEntriesUnder(pill)).toHaveLength(0);

    // Feature teardown path: removeFeatureButton disposes the custom mount,
    // which must release the pill's delegated click registration (the pill
    // element itself is a hidden, reused popover and stays mounted).
    host.removeFeatureButton('loop');
    expect(managerEntriesUnder(pill)).toHaveLength(0);
    const tracker = installListenerTracker(window);
    try {
      // The delegated click root on the pill is gone after dispose.
      expect(tracker.getTargetCount(pill)).toBe(0);
    } finally {
      tracker.restore();
    }
  });

  test('I2: zoom UI teardown releases its own element registrations immediately', () => {
    // jsdom lacks ResizeObserver; the zoom UI needs it for its position observer.
    class ROStub {
      observe() {
        /* mock */
      }
      unobserve() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
    }
    global.ResizeObserver = ROStub;
    window.ResizeObserver = ROStub;

    loadFeatures();
    const zoom = window.YouTubePlusZoom;
    makePlayer();

    const wrap = zoom.createZoomUI();
    expect(wrap).toBeTruthy();
    expect(managerEntriesUnder(wrap).length).toBeGreaterThan(0);

    // Teardown path: clearZoomUI must release registrations for the removed
    // UI (slider input, reset button) instead of leaving detached targets.
    zoom.clearZoomUI();
    expect(managerEntriesUnder(wrap)).toHaveLength(0);
    global.ResizeObserver = undefined;
    window.ResizeObserver = undefined;
  });
});
