/**
 * Video-bound speed listeners must survive element REUSE.
 *
 * YouTube keeps the same <video> element across SPA transitions. The old
 * contract detached the non-persistent listeners on every yt-navigate-start
 * sweep but left `video._ytpSpeedListenerAttached === true`, so a reused
 * video never re-attached: 0 handlers while the marker claimed otherwise,
 * and the saved speed was never applied again.
 *
 * Contract:
 *   - attach: exactly the 5 video listeners (3 speed, 2 loop) + saved speed applied;
 *   - the speed listeners belong to the running speed feature and survive the
 *     navigation sweep; the loop hooks are page-scoped, so the sweep removes
 *     them AND resets their marker;
 *   - reused video: re-attach works, speed re-applied, no stacking;
 *   - a NEW video after cleanup gets its own set.
 * @jest-environment jsdom
 */

const WATCH_HREF = 'https://www.youtube.com/watch?v=testvideo1';

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

function makeEnhancer() {
  return {
    settings: { enableSpeedControl: true, enableLoop: true },
    speedControl: {
      currentSpeed: 2,
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

describe('video-bound speed listeners and the reuse marker', () => {
  /** @type {any} */
  let enhancer;
  /** @type {HTMLVideoElement} */
  let video;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.__ytpBasicInitDone__;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: WATCH_HREF,
    });
    loadCore();

    require('../src/speedcontrol.js');
    enhancer = makeEnhancer();
    // The speed value is owned by the Speed Control module —
    // the test seeds the OWNER state (the enhancer copy is a mirror).
    window.YouTubePlusSpeedControl.setSpeed?.(2);
    const player = document.createElement('div');
    player.id = 'movie_player';
    video = /** @type {HTMLVideoElement} */ (document.createElement('video'));
    player.appendChild(video);
    document.body.appendChild(player);
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    window.YouTubePlusFeatureRegistry?._reset?.();
    document.body.innerHTML = '';
  });

  function trackedOnVideo() {
    const cm = window.YouTubePlusCleanupManager;
    return [...cm.listeners.values()].filter(entry => entry.target === video).length;
  }

  test('reused video re-attaches after each cleanup with exactly one listener set', () => {
    const cm = window.YouTubePlusCleanupManager;

    window.YouTubePlusSpeedControl.setupVideoObserver(enhancer);
    expect(trackedOnVideo()).toBe(5);
    expect(video._ytpLoopHooksAttached).toBe(true);
    expect(video.playbackRate).toBe(2);

    // Navigation sweep: the loop hooks go AND their marker resets; the speed
    // feature keeps its own listeners.
    cm.cleanup();
    expect(trackedOnVideo()).toBe(3);
    expect(video._ytpLoopHooksAttached).toBeFalsy();

    // The SAME video element (YouTube reuse case) re-attaches and applies the
    // current speed — before the fix this stayed at 0 handlers.
    window.YouTubePlusSpeedControl.setupVideoObserver(enhancer);
    expect(trackedOnVideo()).toBe(5);
    expect(video.playbackRate).toBe(2);

    // 20 reuse cycles: repeated mount must not accumulate handlers.
    for (let i = 0; i < 20; i++) {
      cm.cleanup();
      window.YouTubePlusSpeedControl.setupVideoObserver(enhancer);
    }
    expect(trackedOnVideo()).toBe(5);
    expect(video.playbackRate).toBe(2);
  });

  test('a NEW video after cleanup receives its own full listener set', () => {
    const cm = window.YouTubePlusCleanupManager;

    window.YouTubePlusSpeedControl.setupVideoObserver(enhancer);
    expect(trackedOnVideo()).toBe(5);
    cm.cleanup();

    // Fresh video element takes the old one's place (real SPA behaviour).
    video.remove();
    video = /** @type {HTMLVideoElement} */ (document.createElement('video'));
    document.getElementById('movie_player')?.appendChild(video);

    window.YouTubePlusSpeedControl.setupVideoObserver(enhancer);
    expect(trackedOnVideo()).toBe(5);
    expect(video.playbackRate).toBe(2);
  });
});
