/**
 * The resume-playback feature (src/time.js) on the FeatureLifecycle
 * contract. Real CleanupManager, SettingsStore, EventDelegation and
 * StyleManager; real time.js module (the A-B loop surface stays
 * untouched).
 * @jest-environment jsdom
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/dom-cache.js');
  require('../src/mutation-coordinator.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
}

function counts() {
  const cm = window.YouTubePlusCleanupManager;
  return {
    listeners: cm.getListenerStats().active,
    observers: cm.observers.size,
    delegated: window.YouTubePlusEventDelegation?.getStats?.().totalHandlers ?? 0,
  };
}

const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;
const store = () => window.YouTubePlusSettingsStore;

/** Entries out of the versioned standalone resume payload (or {}). */
function resumeEntries() {
  const stored = localStorage.getItem('ytp_resume_v1');
  if (!stored) return {};
  try {
    return JSON.parse(stored).entries || {};
  } catch {
    return {};
  }
}

/** Seed one saved position under the versioned standalone resume key. */
function seedResume(videoId, seconds) {
  localStorage.setItem(
    'ytp_resume_v1',
    JSON.stringify({ v: 1, entries: { [videoId]: { time: seconds, updatedAt: Date.now() } } })
  );
}

/** Install the runtime DOM the resume feature reads: player container + video. */
function mountPlayer(videoId) {
  document.body.innerHTML = `
    <ytd-app>
      <div id="player-container">
        <div id="movie_player">
          <video class="html5-main-video"></video>
        </div>
      </div>
    </ytd-app>`;
  const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
  // jsdom cannot play media; keep the resume/restart callbacks silent.
  video.play = () => Promise.resolve();
  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    search: `?v=${videoId}`,
    href: `https://www.youtube.com/watch?v=${videoId}`,
  });
}

describe('resume playback on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    delete window.__ytpTimeInitDone__;
    loadChain();
  });

  afterEach(() => {
    lifecycle()?._reset?.();
    jest.useRealTimers();
    delete window.__ytpTimeInitDone__;
  });

  /** Load the real time.js module; module-level pending timers fire now. */
  const loadTimeModule = () => {
    jest.useFakeTimers();
    require('../src/time.js');
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  };

  test('nothing runs before sync; afterwards the host follows the setting', () => {
    store().set('enableResumeTime', false);
    mountPlayer('syncstate1');
    loadTimeModule();
    expect(lifecycle().isRunning('resumeTime')).toBe(false);
    expect(window.YouTubePlusTimeLoop).toBeDefined();
    expect(document.getElementById('yt-resume-overlay')).toBeNull();

    store().set('enableResumeTime', true);
    expect(lifecycle().isRunning('resumeTime')).toBe(true);
    store().set('enableResumeTime', false);
    expect(lifecycle().isRunning('resumeTime')).toBe(false);
  });

  test('10 on/off cycles return listener, observer and delegation counts to baseline', () => {
    store().set('enableResumeTime', false);
    mountPlayer('cycles1');
    loadTimeModule();
    const baseline = counts();

    for (let i = 0; i < 10; i++) {
      store().set('enableResumeTime', true);
      expect(lifecycle().isRunning('resumeTime')).toBe(true);
      store().set('enableResumeTime', false);
      expect(lifecycle().isRunning('resumeTime')).toBe(false);
    }

    expect(counts()).toEqual(baseline);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-resume-overlay-styles')).toBe(false);
  });

  test('the overlay appears for a saved timestamp, resumes on click, and saves playhead', () => {
    store().set('enableResumeTime', false);
    mountPlayer('overres1');
    loadTimeModule();

    seedResume('overres1', 45);
    jest.useFakeTimers();
    store().set('enableResumeTime', true);

    const overlay = document.getElementById('yt-resume-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('data-vid')).toBe('overres1');
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-resume-overlay-styles')).toBe(true);

    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    video.dispatchEvent(new Event('play'));
    video.currentTime = 77;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(3000);
    expect(resumeEntries().overres1.time).toBe(77);

    overlay.dispatchEvent(new CustomEvent('yp:resume'));
    expect(video.currentTime).toBe(45);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    jest.useRealTimers();

    // The style stays while the feature runs; stopping removes it.
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-resume-overlay-styles')).toBe(true);
    store().set('enableResumeTime', false);
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-resume-overlay-styles')).toBe(false);
  });

  test('a click on the overlay resume button runs the action through the delegated handler', () => {
    store().set('enableResumeTime', false);
    mountPlayer('clickres1');
    loadTimeModule();

    seedResume('clickres1', 33);
    jest.useFakeTimers();
    store().set('enableResumeTime', true);

    const overlay = document.getElementById('yt-resume-overlay');
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    const resume = /** @type {HTMLElement} */ (
      overlay?.querySelector('.yp-resume-btn[data-yp-resume-action="resume"]')
    );
    expect(resume).not.toBeNull();

    resume.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(video.currentTime).toBe(33);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    jest.useRealTimers();
  });

  test('Enter on the overlay restart button runs the action through the delegated handler', () => {
    store().set('enableResumeTime', false);
    mountPlayer('keyres1');
    loadTimeModule();

    seedResume('keyres1', 40);
    jest.useFakeTimers();
    store().set('enableResumeTime', true);

    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    const restart = /** @type {HTMLElement} */ (
      document.querySelector('.yp-resume-btn[data-yp-resume-action="restart"]')
    );
    expect(restart).not.toBeNull();

    restart.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(video.currentTime).toBe(0);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    jest.useRealTimers();
  });

  test('off removes overlay, video flag and CSS; on works again', () => {
    store().set('enableResumeTime', false);
    mountPlayer('offtest1');
    loadTimeModule();
    const baseline = counts();

    seedResume('offtest1', 30);
    store().set('enableResumeTime', true);
    expect(document.getElementById('yt-resume-overlay')).not.toBeNull();
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    expect(video._ytpResumeAttached).toBe(true);

    store().set('enableResumeTime', false);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    expect(video._ytpResumeAttached).toBeUndefined();
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-resume-overlay-styles')).toBe(false);
    expect(counts()).toEqual(baseline);

    // Restarting the setting re-attaches to the same video; saving works.
    store().set('enableResumeTime', true);
    expect(document.getElementById('yt-resume-overlay')).not.toBeNull();
    expect(video._ytpResumeAttached).toBe(true);
    jest.useFakeTimers();
    video.dispatchEvent(new Event('play'));
    video.currentTime = 55;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(3000);
    jest.useRealTimers();
    expect(resumeEntries().offtest1.time).toBe(55);
  });

  test('a pending debounced write survives going off; late timers stay silent', () => {
    store().set('enableResumeTime', false);
    mountPlayer('persist1');
    loadTimeModule();
    const baseline = counts();

    jest.useFakeTimers();
    store().set('enableResumeTime', true);
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    video.dispatchEvent(new Event('play'));
    video.currentTime = 123;
    video.dispatchEvent(new Event('timeupdate'));
    store().set('enableResumeTime', false);
    jest.advanceTimersByTime(10000);
    jest.useRealTimers();

    expect(resumeEntries().persist1.time).toBe(123);
    expect(counts()).toEqual(baseline);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
  });

  test('the overlay auto-hides after its window while the feature stays on', () => {
    store().set('enableResumeTime', false);
    mountPlayer('autohide1');
    loadTimeModule();
    seedResume('autohide1', 20);

    jest.useFakeTimers();
    store().set('enableResumeTime', true);
    expect(document.getElementById('yt-resume-overlay')).not.toBeNull();
    const runningCounts = counts();
    jest.advanceTimersByTime(10500);
    jest.useRealTimers();

    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    expect(lifecycle().isRunning('resumeTime')).toBe(true);
    // Hiding the overlay releases its two button listeners while the feature
    // keeps running.
    expect(counts().listeners).toBe(runningCounts.listeners - 2);
  });

  test('a late-mounted video is picked up by the wait fallback', async () => {
    store().set('enableResumeTime', false);
    document.body.innerHTML = '<div id="player-container"><div id="movie_player"></div></div>';
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=latevid1',
      href: 'https://www.youtube.com/watch?v=latevid1',
    });
    seedResume('latevid1', 42);
    loadTimeModule();
    store().set('enableResumeTime', true);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();

    const video = document.createElement('video');
    video.className = 'html5-main-video';
    video.play = () => Promise.resolve();
    /** @type {HTMLElement} */ (document.querySelector('#movie_player')).appendChild(video);

    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(video._ytpResumeAttached).toBe(true);
    expect(document.getElementById('yt-resume-overlay')).not.toBeNull();
  });

  test('a late wait resolution never attaches after the feature stops', async () => {
    store().set('enableResumeTime', false);
    document.body.innerHTML = '<div id="player-container"><div id="movie_player"></div></div>';
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=latevid2',
      href: 'https://www.youtube.com/watch?v=latevid2',
    });
    seedResume('latevid2', 42);
    loadTimeModule();
    store().set('enableResumeTime', true);

    const video = document.createElement('video');
    video.className = 'html5-main-video';
    /** @type {HTMLElement} */ (document.querySelector('#movie_player')).appendChild(video);
    store().set('enableResumeTime', false);

    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(video._ytpResumeAttached).toBeUndefined();
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
  });

  test('without a wait helper the init gives up cleanly on a missing video', () => {
    store().set('enableResumeTime', false);
    document.body.innerHTML = '<div id="movie_player"></div>';
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=nowait1',
      href: 'https://www.youtube.com/watch?v=nowait1',
    });
    loadChain();
    delete window.YouTubeUtils.waitForElement;
    delete window.YouTubeUtils.waitFor;
    require('../src/time.js');
    expect(() => store().set('enableResumeTime', true)).not.toThrow();
    expect(document.querySelector('video')).toBeNull();
    store().set('enableResumeTime', false);
  });

  test('navigating off a watch page removes the overlay; saving keeps working', async () => {
    store().set('enableResumeTime', false);
    mountPlayer('routetest1');
    seedResume('routetest1', 42);
    loadTimeModule();
    store().set('enableResumeTime', true);
    expect(document.getElementById('yt-resume-overlay')).not.toBeNull();

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/results',
      search: '?search_query=x',
      href: 'https://www.youtube.com/results?search_query=x',
    });
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(document.getElementById('yt-resume-overlay')).toBeNull();

    // Back on the watch page the attached video keeps saving; the overlay
    // reappears only with the next attach (no re-attach while the flag is
    // set on the still-connected video).
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=routetest1',
      href: 'https://www.youtube.com/watch?v=routetest1',
    });
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await new Promise(resolve => setTimeout(resolve, 400));
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    video.dispatchEvent(new Event('play'));
    video.currentTime = 77;
    video.dispatchEvent(new Event('timeupdate'));
    await new Promise(resolve => setTimeout(resolve, 2500));
    expect(resumeEntries().routetest1.time).toBe(77);
  });

  test('pending writes flush on visibilitychange and pagehide while running', () => {
    store().set('enableResumeTime', false);
    mountPlayer('flush1');
    loadTimeModule();
    jest.useFakeTimers();
    store().set('enableResumeTime', true);
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    video.dispatchEvent(new Event('play'));
    video.currentTime = 88;
    video.dispatchEvent(new Event('timeupdate'));

    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('visibilitychange'));
    expect(resumeEntries().flush1.time).toBe(88);

    video.currentTime = 99;
    jest.advanceTimersByTime(900);
    video.dispatchEvent(new Event('timeupdate'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('pagehide'));
    expect(resumeEntries().flush1.time).toBe(99);
    jest.useRealTimers();
    if (hiddenDescriptor) {
      Object.defineProperty(document, 'hidden', hiddenDescriptor);
    }
    store().set('enableResumeTime', false);
  });

  test('corrupted resume storage falls back to an empty map and saving still works', () => {
    store().set('enableResumeTime', false);
    mountPlayer('corrupt1');
    localStorage.setItem('ytp_resume_v1', 'junk-not-json');
    loadTimeModule();
    jest.useFakeTimers();
    store().set('enableResumeTime', true);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    video.dispatchEvent(new Event('play'));
    video.currentTime = 66;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(3000);
    jest.useRealTimers();
    expect(resumeEntries().corrupt1.time).toBe(66);
    store().set('enableResumeTime', false);
  });

  test('the container position fix is restored when the feature stops', () => {
    store().set('enableResumeTime', false);
    document.body.innerHTML =
      '<div id="movie_player"><video class="html5-main-video"></video></div>';
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    video.play = () => Promise.resolve();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=posfix1',
      href: 'https://www.youtube.com/watch?v=posfix1',
    });
    seedResume('posfix1', 42);
    const player = /** @type {HTMLElement} */ (document.getElementById('movie_player'));
    // jsdom computes no layout: give the container an inline static so the
    // fix-and-restore branch runs as it does on the real container.
    player.style.position = 'static';
    loadTimeModule();
    store().set('enableResumeTime', true);

    expect(document.getElementById('yt-resume-overlay')?.parentElement).toBe(player);
    expect(player.style.position).toBe('relative');

    store().set('enableResumeTime', false);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    expect(player.style.position).toBe('static');
  });

  test('without any player container the overlay lands on body', () => {
    store().set('enableResumeTime', false);
    document.body.innerHTML = '<video class="html5-main-video"></video>';
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    video.play = () => Promise.resolve();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=bodyfix1',
      href: 'https://www.youtube.com/watch?v=bodyfix1',
    });
    seedResume('bodyfix1', 42);
    loadTimeModule();
    store().set('enableResumeTime', true);
    const overlay = document.getElementById('yt-resume-overlay');
    expect(overlay?.parentElement).toBe(document.body);
    expect(overlay?.style.position).toBe('fixed');
    store().set('enableResumeTime', false);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
  });
});
