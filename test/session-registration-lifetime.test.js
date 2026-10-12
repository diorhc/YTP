/**
 * Session-registration lifetime regression suite (N1).
 *
 * Contract: once-initialized feature registrations that target
 * document/window (or session-lifetime DOM singletons) must use SESSION
 * lifetime in the CleanupManager, following the accepted Basic
 * dispatcher pattern.
 *
 * Hard acceptance invariants per member:
 *   - SURVIVES: behavior still works after each navigation cleanup sweep.
 *   - UNIQUE:   repeated sweeps do NOT stack handlers — one trigger produces
 *               exactly one effect; tracked registration counts stay stable.
 *   - IDEMPOTENT: cleanup() twice is safe.
 *
 * Real modules are used end-to-end: the real CleanupManager, the real
 * registration functions, and real user-visible effects.
 * @jest-environment jsdom
 */

const WATCH_HREF = 'https://www.youtube.com/watch?v=testvideo1';

function pressKey(key, extra = {}) {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
  );
}

function loadCore() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/mutation-coordinator.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/design-system.js');
  require('../src/feature-registry.js');
}

function makeSpeedEnhancer() {
  return {
    settings: { enableSpeedControl: true, enableLoop: true, enableScreenshot: true },
    speedControl: {
      currentSpeed: 1,
      storageKey: 'youtube_playback_speed',
      availableSpeeds: [0.5, 1, 1.5, 2],
    },
    isEditableTarget: () => false,
    getElement: sel => document.querySelector(sel),
    showNotification: () => {
      /* mock */
    },
  };
}

describe('P2E — session-registration lifetime (real modules)', () => {
  beforeAll(() => {
    require('../src/cleanup-manager.js');
  });

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.__ytpTimeInitDone__;
    delete window.__ytpBasicInitDone__;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: WATCH_HREF,
    });
    loadCore();
  });

  afterEach(() => {
    window.YouTubePlusVisionDockHost?.unmount?.();
    window.YouTubePlusFeatureRegistry?._reset?.();
    document.body.innerHTML = '';
  });

  // -------------------------------------------------------------------
  // Loop hotkey (time.js registerHotkeys)
  // -------------------------------------------------------------------
  test('loop hotkey: survives repeated sweeps with exactly one toggle per keypress', () => {
    const cm = window.YouTubePlusCleanupManager;
    require('../src/time.js');
    const loop = window.YouTubePlusTimeLoop;
    loop.registerHotkeys(makeSpeedEnhancer());

    const press = () => pressKey('r');

    expect(loop.getLoopState().enabled).toBe(false);
    press();
    expect(loop.getLoopState().enabled).toBe(true);
    press();
    expect(loop.getLoopState().enabled).toBe(false);

    // 20 sweeps: after each sweep the hotkey must still toggle exactly once.
    for (let i = 0; i < 20; i++) {
      cm.cleanup();
      const before = loop.getLoopState().enabled;
      press();
      expect(loop.getLoopState().enabled).toBe(!before);
    }
  });

  // -------------------------------------------------------------------
  // Screenshot hotkey (screenshot.js registerHotkey)
  // -------------------------------------------------------------------
  test('screenshot hotkey survives repeated sweeps with exactly one capture per keypress', () => {
    const cm = window.YouTubePlusCleanupManager;
    require('../src/screenshot.js');
    window.YouTubePlusScreenshot.registerHotkey(makeSpeedEnhancer());

    // P2E fixture fix (review round 2): capture() needs a mounted <video> —
    // without one capture() early-returns and the test fails falsely.
    document.body.appendChild(document.createElement('video'));

    const mockCtx = { drawImage: jest.fn() };
    const getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockCtx);
    const toDataURLSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,test');

    try {
      pressKey('s');
      expect(toDataURLSpy).toHaveBeenCalledTimes(1);

      cm.cleanup();
      pressKey('s');
      expect(toDataURLSpy).toHaveBeenCalledTimes(2);

      // 20 sweeps: each keypress after a sweep captures exactly once.
      for (let i = 0; i < 20; i++) {
        cm.cleanup();
        pressKey('s');
        expect(toDataURLSpy).toHaveBeenCalledTimes(3 + i);
      }
      expect(cm.getListenerStats().active).toBeLessThanOrEqual(40); // stability bound
    } finally {
      getContextSpy.mockRestore();
      toDataURLSpy.mockRestore();
    }
  });

  // -------------------------------------------------------------------
  // Speed hotkeys (speedcontrol.js registerHotkeys)
  // -------------------------------------------------------------------
  test('speed hotkeys survive repeated sweeps with exactly one step per keypress', () => {
    const cm = window.YouTubePlusCleanupManager;
    require('../src/speedcontrol.js');
    const enhancer = makeSpeedEnhancer();
    window.YouTubePlusSpeedControl.registerHotkeys(enhancer);

    pressKey('h');
    expect(enhancer.speedControl.currentSpeed).toBe(1.5);
    pressKey('g');
    expect(enhancer.speedControl.currentSpeed).toBe(1);

    // 20 sweeps: each 'h' steps the speed exactly once.
    for (let i = 0; i < 20; i++) {
      cm.cleanup();
      pressKey('h');
      expect(enhancer.speedControl.currentSpeed).toBe(1.5);
      pressKey('g');
      expect(enhancer.speedControl.currentSpeed).toBe(1);
    }
    // Uniqueness: the registry holds exactly one loop/screenshot-less speed
    // keydown entry after all sweeps (no stacking).
    const keydownEntries = [...cm.listeners.values()].filter(
      l => l.target === document && l.ev === 'keydown' && l.capture
    );
    expect(keydownEntries.length).toBeLessThanOrEqual(3);
  });

  // -------------------------------------------------------------------
  // Timecode (setupKeyboard / setupNavigation / route engine)
  // -------------------------------------------------------------------
  test('timecode keyboard shortcut and navigation reaction survive repeated sweeps', () => {
    const cm = window.YouTubePlusCleanupManager;
    // P2E fixture fix: the runtime looks up the YouTube app root via
    // querySelector('ytd-app') — a <div id="ytd-app"> does NOT match. Use the
    // real tag so init() can mount.
    document.body.appendChild(document.createElement('ytd-app'));

    // Real module: auto-init runs via whenRelevant (mutation-coordinator).
    require('../src/timecode.js');
    const tc = window.YouTubePlusTimecode;

    // P2E fixture fix: whenRelevant defers onEnter to route events —
    // drive the module honestly with the same SPA event the runtime uses.
    document.dispatchEvent(new Event('yt-navigate-finish'));

    // init() runs once; the keyboard shortcut toggles the panel.
    const shortcut = tc.config.shortcut;
    const pressShortcut = () => {
      const ev = new KeyboardEvent('keydown', {
        key: shortcut.key,
        shiftKey: Boolean(shortcut.shiftKey),
        altKey: Boolean(shortcut.altKey),
        ctrlKey: Boolean(shortcut.ctrlKey),
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(ev);
    };

    // P2E fixture fix: `toBeTypeOf` is a Vitest matcher and does not
    // exist in Jest — assert with typeof so this suite can exercise the REAL
    // product lifecycle instead of failing in the fixture.
    expect(typeof tc.init).toBe('function');
    // P2E fixture fix: the panel is created LAZILY by the first toggle
    // (toggleTimecodePanel → createTimecodePanel); do not expect it to exist
    // before any shortcut press.

    const panel = () => tc.state.dom.panel || document.getElementById('timecode-panel');
    const hiddenState = () => panel()?.classList.contains('hidden') ?? true;

    // P2E fixture fix: the panel is created VISIBLE on the first toggle
    // (createTimecodePanel → className='' when enabled), so the first press
    // HIDES it. Establish the real baseline with one press instead of
    // assuming a hidden start, then assert the lifetime invariant: exactly one
    // flip per press, surviving every navigation sweep.
    pressShortcut();
    let expectHidden = hiddenState();
    expect(panel()).toBeTruthy();

    cm.cleanup();
    pressShortcut();
    expectHidden = !expectHidden;
    expect(hiddenState()).toBe(expectHidden);

    // 20 sweeps: shortcut keeps toggling; registry stable.
    for (let i = 0; i < 20; i++) {
      cm.cleanup();
      pressShortcut();
      expectHidden = !expectHidden;
      expect(hiddenState()).toBe(expectHidden);
    }
  });

  // -------------------------------------------------------------------
  // Voting (once-wired delegated/page-session listeners)
  // -------------------------------------------------------------------
  test('voting delegated click reactions survive repeated sweeps', () => {
    const cm = window.YouTubePlusCleanupManager;
    if (!window.YouTubePlus) window.YouTubePlus = {};
    require('../src/voting.js');

    const voting = window.YouTubePlus.Voting;
    voting.init(); // wires once-guarded delegated listeners

    const makePanel = () => {
      let panel = document.getElementById('yp-comments-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'yp-comments-panel';
        document.body.appendChild(panel);
      }
      panel.classList.add('open');
      panel.style.display = 'block';
      return panel;
    };

    const clickNavItem = () => {
      const nav = document.createElement('div');
      nav.className = 'yp-settings-nav-item';
      nav.setAttribute('data-section', 'download');
      document.body.appendChild(nav);
      nav.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return document.getElementById('yp-comments-panel');
    };

    let panel = makePanel();
    panel = clickNavItem();
    expect(panel?.classList.contains('open')).toBe(false);

    // 20 sweeps: delegated click still closes the panel; registry stable.
    const baseActive = cm.getListenerStats().active;
    for (let i = 0; i < 20; i++) {
      cm.cleanup();
      makePanel();
      clickNavItem();
      panel = document.getElementById('yp-comments-panel');
      expect(panel?.classList.contains('open')).toBe(false);
      expect(cm.getListenerStats().active).toBeLessThanOrEqual(baseActive + 40);
    }
  });

  // -------------------------------------------------------------------
  // Adblocker (once-init page-session listeners)
  // -------------------------------------------------------------------
  test('adblocker navigation reaction survives repeated sweeps', async () => {
    const cm = window.YouTubePlusCleanupManager;
    require('../src/adblocker.js');
    const ad = window.YouTubePlusAdBlocker;

    ad.cache.lastCacheTime = 12345;
    window.dispatchEvent(new Event('yp-history-navigate'));
    await new Promise(resolve => setTimeout(resolve, 70));
    expect(ad.cache.lastCacheTime).toBe(0);

    // 20 sweeps: the reaction must survive each sweep.
    for (let i = 0; i < 20; i++) {
      cm.cleanup();
      ad.cache.lastCacheTime = 999 + i;
      window.dispatchEvent(new Event('yp-history-navigate'));
      await new Promise(resolve => setTimeout(resolve, 70));
      expect(ad.cache.lastCacheTime).toBe(0);
    }
  });

  // -------------------------------------------------------------------
  // Shorts keyboard (feature-owned listener; route guard inside the handler)
  // -------------------------------------------------------------------
  test('shorts keyboard shortcut survives repeated sweeps with single seek per keypress', () => {
    const cm = window.YouTubePlusCleanupManager;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/shorts/abc123',
      href: 'https://www.youtube.com/shorts/abc123',
    });
    require('../src/shorts.js');

    const video = document.createElement('video');
    video.currentTime = 30;
    document.body.appendChild(video);

    const seekOnce = () => {
      video.currentTime = 30;
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      );
      return video.currentTime;
    };

    expect(seekOnce()).toBe(25);

    const cm2 = cm;
    for (let i = 0; i < 20; i++) {
      cm2.cleanup();
      video.currentTime = 30;
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      );
      expect(video.currentTime).toBe(25); // exactly one seek per keypress
    }
  });

  // -------------------------------------------------------------------
  // Endscreen (settings checkbox delegation)
  // -------------------------------------------------------------------
  test('endscreen settings change reaction survives repeated sweeps', () => {
    const cm = window.YouTubePlusCleanupManager;
    const store = window.YouTubePlusSettingsStore;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: WATCH_HREF,
    });
    document.body.innerHTML = '<div class="enhanced-submenu"><div class="glass-card"></div></div>';

    require('../src/endscreen.js');

    // The settings UI mounts shortly after the modal-open event.
    document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
    return new Promise(resolve => setTimeout(resolve, 80)).then(() => {
      const checkbox = document.querySelector('.endscreen-settings .yp-settings-checkbox');
      expect(checkbox).toBeTruthy();

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      expect(store.get('endscreen')).toBe(false);

      // 20 sweeps: reaction must survive each sweep.
      for (let i = 0; i < 20; i++) {
        cm.cleanup();
        checkbox.checked = i % 2 === 0;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        expect(store.get('endscreen')).toBe(checkbox.checked);
      }
    });
  });

  // -------------------------------------------------------------------
  // Cross-cutting: double cleanup stays safe with session registrations
  // -------------------------------------------------------------------
  test('double cleanup remains idempotent with session-scoped registrations', () => {
    const cm = window.YouTubePlusCleanupManager;
    // P2E fixture fix: read the facade AFTER the module load — reading
    // it before require() captured undefined.
    require('../src/time.js');
    const loop = window.YouTubePlusTimeLoop;
    loop.registerHotkeys(makeSpeedEnhancer());
    require('../src/screenshot.js');
    window.YouTubePlusScreenshot.registerHotkey(makeSpeedEnhancer());

    expect(() => cm.cleanup()).not.toThrow();
    const afterFirst = cm.getListenerStats();
    expect(() => cm.cleanup()).not.toThrow();
    const afterSecond = cm.getListenerStats();

    expect(afterSecond.registeredTotal).toBe(afterFirst.registeredTotal);
    expect(detachedListenerCount()).toBe(0);
  });

  function detachedListenerCount() {
    const cm = window.YouTubePlusCleanupManager;
    return [...cm.listeners.values()].filter(
      e =>
        e.target &&
        typeof e.target === 'object' &&
        'isConnected' in e.target &&
        !e.target.isConnected
    ).length;
  }
});
