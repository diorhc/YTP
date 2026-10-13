/**
 * Branch coverage for src/time.js on the feature-context contract.
 *
 * The module is loaded against a mock YouTubeUtils surface (as time.test.js
 * does) plus a FeatureLifecycle host that hands the module a real-shaped
 * context, so the resume-overlay and A-B loop branches are exercised through
 * the same public facade and the same DOM events the browser delivers.
 * @jest-environment jsdom
 */

/** Load real core modules. */
const loadRealDeps = () => {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
};

/** Proxy wrapping localStorage for test assertions and setup. */
const createStorageRawProxy = () =>
  new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        const val = window.localStorage.getItem(prop);
        if (val === null) return undefined;
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      },
      set(_target, prop, value) {
        if (typeof prop === 'string') {
          if (value === undefined) {
            window.localStorage.removeItem(prop);
          } else {
            window.localStorage.setItem(
              prop,
              typeof value === 'string' ? value : JSON.stringify(value)
            );
          }
        }
        return true;
      },
      deleteProperty(_target, prop) {
        if (typeof prop === 'string') {
          window.localStorage.removeItem(prop);
        }
        return true;
      },
    }
  );

/** Real YouTubeUtils surface with test spies and notification mock. */
const setupTimeUtils = () => {
  loadRealDeps();
  const utils = window.YouTubeUtils;
  const raw = createStorageRawProxy();
  utils.NotificationManager = { show: jest.fn(), remove: jest.fn() };
  jest.spyOn(utils, 'logSuppressed');
  jest.spyOn(utils.storage, 'get');
  jest.spyOn(utils.storage, 'set');
  jest.spyOn(utils, 'loadFeatureEnabled');
  return { utils, raw };
};

/** A feature context with the shape feature-registry.js hands to modules. */
const makeCtx = () => {
  /** @type {Array<() => void>} */
  const releases = [];
  const listenOn = (target, type, handler, opts) => {
    target?.addEventListener?.(type, handler, opts);
    const release = () => target?.removeEventListener?.(type, handler, opts);
    releases.push(release);
    return release;
  };
  const scope = () => {
    const disposals = [];
    /** @type {any[]} */
    const owned = [];
    return {
      listen: listenOn,
      own: el => {
        owned.push(el);
        return el;
      },
      onDispose: fn => disposals.push(fn),
      timeout: (cb, ms) => {
        const id = setTimeout(cb, ms);
        return () => clearTimeout(id);
      },
      frame: cb => {
        cb();
        return () => undefined;
      },
      dispose: () => {
        for (const fn of disposals.splice(0)) fn();
        for (const el of owned.splice(0)) el.remove();
      },
      style: jest.fn(),
      // The real context filters delegated events by selector; the module's own
      // guards are what these tests exercise, so the host hands every event
      // over with its target.
      delegate: (root, type, _selector, handler) =>
        listenOn(root, type, ev => handler(ev, ev.target)),
    };
  };
  return {
    ...scope(),
    scope,
    delegate: (root, type, _selector, handler) =>
      listenOn(root, type, ev => handler(ev, ev.target)),
    /** Test-only: release every listener this context registered. */
    releaseAll: () => {
      for (const release of releases.splice(0)) release();
    },
  };
};

/** Descriptor the last load handed to FeatureLifecycle.define. */
let lastDescriptor = null;

/** Real CleanupManager with a helper to dispose all registered listeners. */
const installCleanupManager = () => {
  if (!window.YouTubePlusCleanupManager) loadRealDeps();
  const cm = window.YouTubePlusCleanupManager;
  cm.disposeAll = () => {
    for (const key of [...cm.listeners.keys()]) cm.unregisterListener(key);
  };
  return cm;
};

/** Load a fresh module instance (the module guards its one-time init). */
const reloadTime = (utils, ctx, options) => {
  jest.resetModules();
  delete window.YouTubePlusTimeLoop;
  delete window.__ytpTimeInitDone__;
  return loadTime(utils, ctx, options);
};

const loadTime = (utils, ctx, { startFeature = true } = {}) => {
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: utils,
  });
  const featureRegistry = {
    register: jest.fn(),
    FeatureLifecycle: {
      define: descriptor => {
        lastDescriptor = descriptor;
        return {
          sync: () => {
            if (startFeature) descriptor.start(ctx);
          },
          stop: () => descriptor.stop?.(),
        };
      },
    },
  };
  Object.defineProperty(window, 'YouTubePlusFeatureRegistry', {
    configurable: true,
    writable: true,
    value: featureRegistry,
  });
  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: { getStyle: () => '' },
  });
  Object.defineProperty(window, 'YouTubePlusLogger', {
    configurable: true,
    writable: true,
    value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  Object.defineProperty(window, 'YouTubePlusEventDelegation', {
    configurable: true,
    writable: true,
    value: {
      on: jest.fn((root, type, selector, handler) => {
        root.addEventListener(type, ev => {
          const target = ev.target instanceof Element ? ev.target.closest(selector) : null;
          if (target) handler(ev, target);
        });
      }),
      off: jest.fn(),
      attachHoverPopover: jest.fn((anchor, panel, opts) => {
        anchor.addEventListener('mouseenter', opts.show);
        anchor.addEventListener('mouseleave', opts.hide);
        panel.addEventListener('mouseenter', opts.show);
        panel.addEventListener('mouseleave', opts.hide);
        return () => undefined;
      }),
    },
  });
  require('../src/time.js');
  return window.YouTubePlusTimeLoop;
};

/** Player DOM the resume feature mounts its overlay into. */
const mountPlayer = () => {
  document.body.innerHTML =
    '<div id="player-container"><div id="movie_player"><video class="html5-main-video"></video></div></div>';
  const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
  video.play = jest.fn(() => Promise.resolve());
  return video;
};

describe('time.js resume branches', () => {
  /** @type {any} */ let utils;
  /** @type {any} */ let raw;
  /** @type {any} */ let ctx;

  /** Entries out of the versioned standalone resume payload (or {}). */
  const resumeEntries = () => (raw?.ytp_resume_v1 && raw.ytp_resume_v1.entries) || {};

  beforeEach(() => {
    jest.resetModules();
    delete window.__ytpTimeInitDone__;
    delete window.YouTubePlusTimeLoop;
    window.localStorage.clear();
    jest.useFakeTimers();
    const built = setupTimeUtils();
    utils = built.utils;
    raw = built.raw;
    ctx = makeCtx();
  });

  afterEach(() => {
    ctx?.releaseAll?.();
    jest.useRealTimers();
  });

  test('the resume overlay ignores clicks without an action or outside its wrapper', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { vid1: 30 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    const video = document.querySelector('video');
    const overlay = document.getElementById('yt-resume-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute('data-vid')).toBe('vid1');

    // A stray .yp-resume-btn without data-yp-resume-action is a no-op.
    const stray = document.createElement('button');
    stray.className = 'yp-resume-btn';
    overlay.appendChild(stray);
    stray.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('yt-resume-overlay')).not.toBeNull();

    // An action button outside any overlay wrapper is ignored too.
    const orphan = document.createElement('button');
    orphan.className = 'yp-resume-btn';
    orphan.setAttribute('data-yp-resume-action', 'resume');
    document.body.appendChild(orphan);
    orphan.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(video.currentTime).toBe(0);
    expect(document.getElementById('yt-resume-overlay')).not.toBeNull();

    // The real resume button still works through the same delegation.
    const resume = overlay.querySelector('[data-yp-resume-action="resume"]');
    resume.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(video.currentTime).toBe(30);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
  });

  test('the space key resumes playback like Enter does', () => {
    const video = mountPlayer();
    raw.youtube_resume_times_v1 = { vid1: 45 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    const resume = document.querySelector('[data-yp-resume-action="resume"]');
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    resume.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(video.currentTime).toBe(45);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
  });

  test('an unknown key on the overlay button changes nothing', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { vid1: 20 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    const resume = document.querySelector('[data-yp-resume-action="resume"]');
    resume.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.getElementById('yt-resume-overlay')).not.toBeNull();
  });

  test('pausing releases the save listener so later playheads are not stored', () => {
    const video = mountPlayer();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    video.dispatchEvent(new Event('play'));
    video.currentTime = 12;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(2100);
    expect(resumeEntries().vid1.time).toBe(12);

    video.dispatchEvent(new Event('pause'));
    video.currentTime = 90;
    video.dispatchEvent(new Event('timeupdate'));
    expect(resumeEntries().vid1.time).toBe(12);
  });

  test('a throwing playhead read is logged instead of breaking the listener', () => {
    const video = mountPlayer();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    video.dispatchEvent(new Event('play'));
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get() {
        throw new Error('detached media');
      },
    });
    expect(() => video.dispatchEvent(new Event('timeupdate'))).not.toThrow();
    expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
      'Time',
      'Error saving playback time',
      expect.any(Error)
    );
  });

  test('a rejected resume still removes the overlay and logs the failure', () => {
    const video = mountPlayer();
    video.play = jest.fn(() => {
      throw new Error('NotAllowedError');
    });
    raw.youtube_resume_times_v1 = { vid1: 60 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    const resume = document.querySelector('[data-yp-resume-action="resume"]');
    expect(() => resume.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    expect(video.currentTime).toBe(60);
    // The overlay is removed even though playback could not start.
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    expect(window.YouTubePlusLogger.error).toHaveBeenCalledWith(
      'Time',
      'Failed to resume playback',
      expect.any(Error)
    );
  });

  test('a rejected start-over still removes the overlay and logs the failure', () => {
    const video = mountPlayer();
    video.play = jest.fn(() => {
      throw new Error('NotAllowedError');
    });
    raw.youtube_resume_times_v1 = { vid1: 60 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    const restart = document.querySelector('[data-yp-resume-action="restart"]');
    expect(() => restart.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    expect(video.currentTime).toBe(0);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    expect(window.YouTubePlusLogger.error).toHaveBeenCalledWith(
      'Time',
      'Failed to start over',
      expect.any(Error)
    );
  });

  test('a second video does not stack a second overlay', () => {
    const first = mountPlayer();
    raw.youtube_resume_times_v1 = { vid1: 25 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);
    expect(document.getElementById('yt-resume-overlay')).not.toBeNull();

    // The player replaced its <video>: the new element takes the handler and
    // the previous overlay is not duplicated.
    const second = document.createElement('video');
    second.className = 'html5-main-video';
    second.play = jest.fn(() => Promise.resolve());
    first.replaceWith(second);
    document.dispatchEvent(new Event('yt-navigate-finish'));
    jest.advanceTimersByTime(200);

    expect(document.querySelectorAll('#yt-resume-overlay')).toHaveLength(1);
    expect(second._ytpResumeAttached).toBe(true);
    expect(first._ytpResumeAttached).toBeUndefined();
  });

  test('an overlay left over from another video is dropped on the next init', () => {
    const first = mountPlayer();
    raw.youtube_resume_times_v1 = { vid1: 25, vid2: 40 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);
    expect(document.getElementById('yt-resume-overlay').getAttribute('data-vid')).toBe('vid1');

    const second = document.createElement('video');
    second.className = 'html5-main-video';
    second.play = jest.fn(() => Promise.resolve());
    first.replaceWith(second);
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid2',
      href: 'https://www.youtube.com/watch?v=vid2',
    });
    document.dispatchEvent(new Event('yt-navigate-finish'));
    jest.advanceTimersByTime(200);

    const overlay = document.getElementById('yt-resume-overlay');
    expect(overlay.getAttribute('data-vid')).toBe('vid2');
    expect(document.querySelectorAll('#yt-resume-overlay')).toHaveLength(1);
  });

  test('the resume map is capped at 500 entries, evicting the oldest first', () => {
    const video = mountPlayer();
    const seeded = {};
    for (let i = 0; i < 501; i++) seeded[`old${i}`] = i + 10;
    seeded.vid1 = 33;
    raw.youtube_resume_times_v1 = seeded;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    video.dispatchEvent(new Event('play'));
    video.currentTime = 99;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(2500);

    const entries = raw.ytp_resume_v1.entries;
    expect(Object.keys(entries)).toHaveLength(500);
    expect(entries.old0).toBeUndefined();
    expect(entries.old1).toBeUndefined();
    expect(entries.vid1.time).toBe(99);
  });

  test('a debounced save that is superseded does not schedule a second write', () => {
    const video = mountPlayer();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    video.dispatchEvent(new Event('play'));
    video.currentTime = 15;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(900);
    // The throttle lets this one through while the first debounce is pending.
    video.currentTime = 25;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(2500);

    const entries = resumeEntries();
    expect(Object.keys(entries)).toEqual(['vid1']);
    expect(entries.vid1.time).toBe(25);
  });

  test('a legacy entry stored as {time} migrates into the versioned payload', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { vid1: { time: 28, timestamp: Date.now() } };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    expect(document.getElementById('yt-resume-overlay')?.getAttribute('data-vid')).toBe('vid1');
    const video = document.querySelector('video');
    video.dispatchEvent(new Event('play'));
    video.currentTime = 29;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(2200);

    const entries = resumeEntries();
    expect(entries.vid1.time).toBe(29);
    expect(typeof entries.vid1.updatedAt).toBe('number');
  });

  test('a persist merges an entry another tab saved after our hydrate', () => {
    const video = mountPlayer();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    // Another tab (or host) writes its own entry after our empty hydrate; the
    // read-modify-write persist must keep it.
    raw.ytp_resume_v1 = { v: 1, entries: { other: { time: 60, updatedAt: Date.now() } } };

    video.dispatchEvent(new Event('play'));
    video.currentTime = 12;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(2200);

    const entries = resumeEntries();
    expect(entries.other.time).toBe(60);
    expect(entries.vid1.time).toBe(12);
  });

  test('writes are throttled to one persist per minimum interval', () => {
    const video = mountPlayer();
    const previousStore = window.YouTubePlusSettingsStore;
    const writeGmKey = jest.fn(() => true);
    window.YouTubePlusSettingsStore = { readGmKey: jest.fn(() => null), writeGmKey };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);
    try {
      video.dispatchEvent(new Event('play'));
      video.currentTime = 10;
      video.dispatchEvent(new Event('timeupdate'));
      jest.advanceTimersByTime(2200);
      expect(writeGmKey).toHaveBeenCalledTimes(1);

      // A second staged position inside the throttle window waits its turn.
      video.currentTime = 20;
      video.dispatchEvent(new Event('timeupdate'));
      jest.advanceTimersByTime(2600);
      expect(writeGmKey).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(3000);
      expect(writeGmKey).toHaveBeenCalledTimes(2);
    } finally {
      window.YouTubePlusSettingsStore = previousStore;
    }
  });

  test('a storage read failure degrades to an empty map and logs once', () => {
    const video = mountPlayer();
    const previousStore = window.YouTubePlusSettingsStore;
    const readGmKey = jest.fn(() => null);
    readGmKey.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    window.YouTubePlusSettingsStore = {
      readGmKey,
      writeGmKey: jest.fn((key, value) => {
        window.localStorage.setItem(key, value);
        return true;
      }),
    };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    // No saved position is found, so no overlay appears.
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    expect(utils.logSuppressed).toHaveBeenCalledWith(expect.any(Error), 'Time');

    video.dispatchEvent(new Event('play'));
    video.currentTime = 7;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(2500);
    expect(resumeEntries().vid1.time).toBe(7);

    window.YouTubePlusSettingsStore = previousStore;
  });

  test('a storage write failure keeps the in-memory map and logs the error', () => {
    const video = mountPlayer();
    const previousStore = window.YouTubePlusSettingsStore;
    const writeGmKey = jest.fn((key, value) => {
      window.localStorage.setItem(key, value);
      return true;
    });
    window.YouTubePlusSettingsStore = {
      readGmKey: key => window.localStorage.getItem(key),
      writeGmKey,
    };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    video.dispatchEvent(new Event('play'));
    video.currentTime = 42;
    video.dispatchEvent(new Event('timeupdate'));
    jest.advanceTimersByTime(2000);

    writeGmKey.mockImplementation(() => {
      throw new Error('disk full');
    });
    video.currentTime = 43;
    jest.advanceTimersByTime(900);
    video.dispatchEvent(new Event('timeupdate'));
    window.dispatchEvent(new Event('pagehide'));

    expect(utils.logSuppressed).toHaveBeenCalledWith(expect.any(Error), 'Time');
    expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
      'Time',
      'Failed to save resume time',
      expect.any(Error)
    );

    window.YouTubePlusSettingsStore = previousStore;
  });

  test('a video id without a storage entry never shows the overlay', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { other: 90 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    // A saved position of exactly 5s is below the resume threshold.
    raw.youtube_resume_times_v1 = { vid1: 5 };
    document.dispatchEvent(new Event('yt-navigate-finish'));
    jest.advanceTimersByTime(200);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
  });

  test('the overlay mounts into a static player container and restores its position', () => {
    mountPlayer();
    const container = /** @type {HTMLElement} */ (document.getElementById('player-container'));
    container.style.position = 'static';
    raw.youtube_resume_times_v1 = { vid1: 42 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    const featureCtx = ctx;
    loadTime(utils, featureCtx);

    expect(document.getElementById('yt-resume-overlay')?.parentElement).toBe(container);
    expect(container.style.position).toBe('relative');

    // Stopping the feature releases the overlay and the container fix.
    lastDescriptor.stop();
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    expect(container.style.position).toBe('static');
  });

  test('a late-mounted video is picked up through the wait helper', async () => {
    document.body.innerHTML = '<div id="player-container"><div id="movie_player"></div></div>';
    raw.youtube_resume_times_v1 = { vid1: 42 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    const video = document.createElement('video');
    video.play = jest.fn(() => Promise.resolve());
    utils.waitForElement = jest.fn(async () => video);
    loadTime(utils, ctx);

    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    await Promise.resolve();
    await Promise.resolve();

    expect(utils.waitForElement).toHaveBeenCalledWith('video', 1200);
    expect(video._ytpResumeAttached).toBe(true);
    expect(document.getElementById('yt-resume-overlay')?.getAttribute('data-vid')).toBe('vid1');
  });

  test('only a hidden tab flushes the pending write on visibilitychange', () => {
    const video = mountPlayer();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, ctx);

    video.dispatchEvent(new Event('play'));
    video.currentTime = 21;
    video.dispatchEvent(new Event('timeupdate'));

    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('visibilitychange'));
    // Still debounced: a visible tab does not write.
    expect(raw.ytp_resume_v1).toBeUndefined();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('visibilitychange'));
    expect(resumeEntries().vid1.time).toBe(21);
    if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
  });
});

describe('time.js video id resolution fallbacks', () => {
  /** @type {any} */ let utils;
  /** @type {any} */ let raw;
  /** @type {any} */ let ctx;

  beforeEach(() => {
    jest.resetModules();
    delete window.__ytpTimeInitDone__;
    delete window.YouTubePlusTimeLoop;
    window.localStorage.clear();
    const built = setupTimeUtils();
    utils = built.utils;
    raw = built.raw;
    ctx = makeCtx();
    // The fallbacks only run when the URL helper is unavailable.
    delete utils.getVideoIdFromLocation;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '',
      href: 'https://www.youtube.com/watch',
    });
  });

  test('the canonical link query parameter provides the video id', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { canonicalid: 20 };
    document.head.innerHTML =
      '<link rel="canonical" href="https://www.youtube.com/watch?v=canonicalid">';
    loadTime(utils, ctx);

    expect(document.getElementById('yt-resume-overlay')?.getAttribute('data-vid')).toBe(
      'canonicalid'
    );
  });

  test('a canonical /watch/ path provides the video id', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { pathid: 20 };
    document.head.innerHTML = '<link rel="canonical" href="https://www.youtube.com/watch/pathid">';
    loadTime(utils, ctx);

    expect(document.getElementById('yt-resume-overlay')?.getAttribute('data-vid')).toBe('pathid');
  });

  test('a canonical /shorts/ path provides the video id', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { pathid: 20 };
    document.head.innerHTML = '<link rel="canonical" href="https://www.youtube.com/shorts/pathid">';
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/shorts/pathid',
      search: '',
      href: 'https://www.youtube.com/shorts/pathid',
    });
    loadTime(utils, ctx);

    expect(document.getElementById('yt-resume-overlay')?.getAttribute('data-vid')).toBe('pathid');
  });

  test('the player response is used when no URL source resolves an id', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { responseid: 20 };
    window.ytInitialPlayerResponse = { videoDetails: { videoId: 'responseid' } };
    loadTime(utils, ctx);

    expect(document.getElementById('yt-resume-overlay')?.getAttribute('data-vid')).toBe(
      'responseid'
    );
    delete window.ytInitialPlayerResponse;
  });

  test('the location path is the last resort for the video id', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { pathid: 20 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch/pathid',
      search: '',
      href: 'https://www.youtube.com/watch/pathid',
    });
    loadTime(utils, ctx);

    expect(document.getElementById('yt-resume-overlay')?.getAttribute('data-vid')).toBe('pathid');
  });

  test('an unparsable canonical link leaves the overlay out without throwing', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { vid1: 20 };
    // A canonical href the URL parser rejects: the id lookup gives up quietly.
    document.head.innerHTML = '<link rel="canonical" href="https://[invalid">';
    expect(() => loadTime(utils, ctx)).not.toThrow();
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    expect(utils.logSuppressed).toHaveBeenCalled();
    // jsdom raises its own URL error type, so assert on the reported failure.
    expect(utils.logSuppressed.mock.calls[0][0].message).toContain('Invalid URL');
    expect(utils.logSuppressed.mock.calls[0][1]).toBe('Time');
  });

  test('an empty player response video id does not resolve an overlay', () => {
    mountPlayer();
    raw.youtube_resume_times_v1 = { vid1: 20 };
    window.ytInitialPlayerResponse = { videoDetails: { videoId: '' } };
    loadTime(utils, ctx);
    expect(document.getElementById('yt-resume-overlay')).toBeNull();
    delete window.ytInitialPlayerResponse;
  });
});

describe('time.js module bootstrap fallbacks', () => {
  /** @type {any} */ let utils;

  beforeEach(() => {
    jest.resetModules();
    delete window.__ytpTimeInitDone__;
    delete window.YouTubePlusTimeLoop;
    delete document.readyState;
    window.localStorage.clear();
    document.head.innerHTML = '';
    utils = setupTimeUtils().utils;
  });

  test('re-requiring the module is a no-op once the init flag is set', () => {
    loadTime(utils, makeCtx());
    const facade = window.YouTubePlusTimeLoop;
    jest.resetModules();
    require('../src/time.js');
    expect(window.YouTubePlusTimeLoop).toBe(facade);
  });

  test('without a utils translation helper the key is used and placeholders replaced', () => {
    delete utils.t;
    const loop = loadTime(utils, makeCtx());
    const pill = document.createElement('div');
    document.body.appendChild(pill);
    loop.populateVisionLoopPill(pill, { enabled: false, pointA: 1, pointB: null });
    // renderVisionLoopPreviewCard has no placeholders of its own, so the
    // fallback is observed through a translated key with a placeholder.
    expect(pill.querySelector('.yp-vision-loop-cards')).not.toBeNull();
    expect(pill.textContent).toContain('noPreview');
  });

  test('without a utils format helper the module formats H:MM:SS and --:-- itself', () => {
    delete utils.formatTime;
    const loop = loadTime(utils, makeCtx());
    const video = document.createElement('video');
    document.body.appendChild(video);

    Object.defineProperty(video, 'currentTime', { configurable: true, value: 3661 });
    loop.setLoopPoint('A');
    expect(utils.NotificationManager.show).toHaveBeenCalledWith('loopPointASet: 1:01:01', {
      duration: 1500,
      type: 'success',
    });

    Object.defineProperty(video, 'currentTime', { configurable: true, value: Number.NaN });
    loop.setLoopPoint('B');
    expect(utils.NotificationManager.show).toHaveBeenCalledWith('loopPointBSet: --:--', {
      duration: 1500,
      type: 'success',
    });

    Object.defineProperty(video, 'currentTime', { configurable: true, value: -5 });
    loop.setLoopPoint('B');
    expect(utils.NotificationManager.show).toHaveBeenCalledWith('loopPointBSet: --:--', {
      duration: 1500,
      type: 'success',
    });
  });

  test('without onDomReady the module runs the callback or waits for DOMContentLoaded', () => {
    delete utils.onDomReady;
    const registered = [];
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        registerListener: jest.fn((target, type, handler) => {
          registered.push({ target, type, handler });
        }),
      },
    });

    const readyDescriptor = Object.getOwnPropertyDescriptor(document, 'readyState');
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    loadTime(utils, makeCtx());
    expect(registered.filter(r => r.type === 'DOMContentLoaded')).toHaveLength(0);
    expect(window.YouTubePlusTimeLoop).toBeDefined();

    jest.resetModules();
    delete window.YouTubePlusTimeLoop;
    delete window.__ytpTimeInitDone__;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
    loadTime(utils, makeCtx(), { startFeature: false });
    const domLoaded = registered.filter(r => r.type === 'DOMContentLoaded');
    expect(domLoaded).toHaveLength(1);
    expect(domLoaded[0].type).toBe('DOMContentLoaded');

    if (readyDescriptor) {
      Object.defineProperty(document, 'readyState', readyDescriptor);
    } else {
      delete document.readyState;
    }
  });

  test('without a cleanup manager the hotkeys land on the global fallback', () => {
    utils.cleanupManager = {};
    const registered = [];
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        registerListener: jest.fn((target, type, handler) => {
          registered.push({ target, type, handler });
        }),
      },
    });

    loadTime(utils, makeCtx());
    expect(registered.some(r => r.type === 'keydown' && r.target === document)).toBe(true);
  });

  test('a throwing cleanup manager during hotkey registration logs a warning', () => {
    const realRegister = window.YouTubePlusCleanupManager?.registerListener;
    utils.cleanupManager = {};
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        registerListener: (target, type, ...args) => {
          if (type === 'keydown') {
            throw new Error('registration failed');
          }
          return realRegister?.call(window.YouTubePlusCleanupManager, target, type, ...args);
        },
      },
    });

    loadTime(utils, makeCtx());
    expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
      'Time',
      'Failed to register loop keyboard shortcuts',
      expect.any(Error)
    );
  });

  test('without a utils translation helper placeholders are interpolated', () => {
    delete utils.t;
    mountPlayer();
    const raw = createStorageRawProxy();
    raw.youtube_resume_times_v1 = { vid1: 60 };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loadTime(utils, makeCtx());
    const overlay = document.getElementById('yt-resume-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain('1:00');
  });

  test('with no cleanup manager at all the hotkey registration is skipped', () => {
    delete utils.cleanupManager;
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(() => loadTime(utils, makeCtx())).not.toThrow();
    expect(window.YouTubePlusTimeLoop).toBeDefined();
  });
});

describe('time.js A-B loop control branches', () => {
  /** @type {any} */ let utils;
  /** @type {any} */ let raw;
  /** @type {any} */ let loop;
  /** @type {any} */ let ctx;
  /** @type {any} */ let cm;

  /** Video with a duration the progress-bar rendering can use. */
  const mountVideo = (duration = 100) => {
    document.body.innerHTML = '<video></video><div class="ytp-progress-bar-container"></div>';
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    Object.defineProperty(video, 'duration', { configurable: true, value: duration });
    return video;
  };

  beforeEach(() => {
    jest.resetModules();
    delete window.__ytpTimeInitDone__;
    delete window.YouTubePlusTimeLoop;
    window.localStorage.clear();
    const built = setupTimeUtils();
    utils = built.utils;
    raw = built.raw;
    ctx = makeCtx();
    cm = installCleanupManager();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loop = loadTime(utils, ctx);
  });

  afterEach(() => {
    ctx?.releaseAll?.();
    cm?.disposeAll?.();
  });

  test('every hotkey drives its own loop action', () => {
    const video = mountVideo();
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 20, writable: true });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    expect(loop.getLoopState().enabled).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(loop.getLoopState().pointA).toBe(20);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    expect(loop.getLoopState().pointB).toBe(20);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    const cleared = loop.getLoopState();
    expect(cleared.pointA).toBeNull();
    expect(cleared.pointB).toBeNull();
  });

  test('the loop listener snaps the playhead back to the range start', () => {
    const video = mountVideo();
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 10, writable: true });
    loop.setLoopPoint('A');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 40, writable: true });
    loop.setLoopPoint('B');
    loop.toggleLoop();

    Object.defineProperty(video, 'currentTime', { configurable: true, value: 39, writable: true });
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.currentTime).toBe(39);

    Object.defineProperty(video, 'currentTime', { configurable: true, value: 41, writable: true });
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.currentTime).toBe(10);
  });

  test('toggling off stops the loop, releases the listener and notifies', () => {
    const video = mountVideo();
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 10, writable: true });
    loop.setLoopPoint('A');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 40, writable: true });
    loop.setLoopPoint('B');

    loop.toggleLoop();
    expect(video.loop).toBe(false);
    expect(utils.NotificationManager.show).toHaveBeenCalledWith('loopEnabled', {
      duration: 1500,
      type: 'success',
    });

    loop.toggleLoop();
    expect(video.loop).toBe(false);
    expect(utils.NotificationManager.show).toHaveBeenCalledWith('loopDisabled', {
      duration: 1500,
      type: 'info',
    });

    // The listener is gone: a later timeupdate no longer seeks back.
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 90, writable: true });
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.currentTime).toBe(90);
  });

  test('toggling with no points sets plain video looping, and reset restores it', () => {
    const video = mountVideo();
    loop.toggleLoop();
    expect(video.loop).toBe(true);

    loop.resetLoopPoints();
    expect(utils.NotificationManager.show).toHaveBeenCalledWith('loopPointsReset', {
      duration: 1500,
      type: 'info',
    });
    expect(video.loop).toBe(true);
    expect(loop.getLoopState().pointA).toBeNull();
  });

  test('loop actions are inert while the feature flag is off', () => {
    const video = mountVideo();
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 10, writable: true });
    utils.loadFeatureEnabled.mockReturnValue(false);

    loop.toggleLoop();
    loop.setLoopPoint('A');
    loop.resetLoopPoints();

    const state = loop.getLoopState();
    expect(state.enabled).toBe(false);
    expect(state.pointA).toBeNull();
    expect(video.loop).toBe(false);
    expect(raw.youtube_loop_state).toBeUndefined();
  });

  test('setLoopPoint and reset tolerate a missing video element', () => {
    mountVideo();
    document.querySelector('video').remove();
    expect(() => loop.setLoopPoint('A')).not.toThrow();
    expect(loop.getLoopState().pointA).toBeNull();
    loop.toggleLoop();
    loop.toggleLoop();
    expect(() => loop.resetLoopPoints()).not.toThrow();
  });

  test('applyLoopStateToCurrentVideo mirrors the stored state onto the video', () => {
    const video = mountVideo();
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 10, writable: true });
    loop.setLoopPoint('A');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 40, writable: true });
    loop.setLoopPoint('B');
    loop.toggleLoop();

    loop.applyLoopStateToCurrentVideo();
    expect(video.loop).toBe(false);
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 55, writable: true });
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.currentTime).toBe(10);

    loop.resetLoopPoints();
    loop.applyLoopStateToCurrentVideo();
    expect(video.loop).toBe(true);

    loop.toggleLoop();
    loop.applyLoopStateToCurrentVideo();
    expect(video.loop).toBe(false);
  });

  test('a stored loop state is applied to the video after its delay', () => {
    jest.useFakeTimers();
    const video = mountVideo();
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 10, writable: true });
    loop.setLoopPoint('A');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 40, writable: true });
    loop.setLoopPoint('B');
    loop.toggleLoop();
    const stored = raw.ytp_loop_v1;
    loop.resetLoopPoints();

    // Reload with the saved state present: it is re-read on the next page.
    raw.ytp_loop_v1 = stored;
    const reloaded = reloadTime(utils, ctx, { startFeature: false });
    jest.advanceTimersByTime(1200);
    jest.useRealTimers();

    expect(reloaded.getLoopState()).toMatchObject({ enabled: true, pointA: 10, pointB: 40 });
  });

  test('a non-numeric stored point is dropped instead of restored', () => {
    jest.useFakeTimers();
    mountVideo();
    raw.ytp_loop_v1 = { v: 1, videoId: 'vid1', enabled: true, pointA: 'nope', pointB: 30 };
    const reloaded = reloadTime(utils, ctx, { startFeature: false });
    jest.advanceTimersByTime(1200);
    jest.useRealTimers();

    expect(reloaded.getLoopState()).toMatchObject({ enabled: true, pointA: null, pointB: 30 });
  });

  test('a stored loop state for another video is neither applied nor erased', () => {
    jest.useFakeTimers();
    mountVideo();
    const stored = { v: 1, videoId: 'othervid', enabled: true, pointA: 5, pointB: 15 };
    raw.ytp_loop_v1 = stored;
    const reloaded = reloadTime(utils, ctx, { startFeature: false });
    jest.advanceTimersByTime(1200);
    jest.useRealTimers();

    expect(reloaded.getLoopState()).toMatchObject({ enabled: false, pointA: null, pointB: null });
    // The other video's saved state is left intact for when it comes back.
    expect(raw.ytp_loop_v1).toEqual(stored);
  });

  test('a stored loop payload that is not an object leaves the loop off', () => {
    jest.useFakeTimers();
    mountVideo();
    raw.ytp_loop_v1 = 'null';
    const reloaded = reloadTime(utils, ctx, { startFeature: false });
    jest.advanceTimersByTime(1200);
    jest.useRealTimers();

    expect(reloaded.getLoopState()).toMatchObject({ enabled: false, pointA: null, pointB: null });
  });

  test('a non-numeric stored B point is dropped instead of restored', () => {
    jest.useFakeTimers();
    mountVideo();
    raw.ytp_loop_v1 = { v: 1, videoId: 'vid1', enabled: true, pointA: 20, pointB: 'bad' };
    const reloaded = reloadTime(utils, ctx, { startFeature: false });
    jest.advanceTimersByTime(1200);
    jest.useRealTimers();

    expect(reloaded.getLoopState()).toMatchObject({ enabled: true, pointA: 20, pointB: null });
  });

  test('an unreadable stored loop state leaves the loop off', () => {
    jest.useFakeTimers();
    const previousStore = window.YouTubePlusSettingsStore;
    window.YouTubePlusSettingsStore = {
      readGmKey: () => {
        throw new Error('corrupt');
      },
      writeGmKey: jest.fn(() => true),
    };
    const reloaded = reloadTime(utils, makeCtx(), { startFeature: false });
    // The deferred load is what actually reads storage.
    jest.advanceTimersByTime(1200);
    jest.useRealTimers();

    expect(reloaded.getLoopState()).toMatchObject({ enabled: false, pointA: null, pointB: null });
    expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
      'Time',
      'Failed to load loop state',
      expect.any(Error)
    );
    window.YouTubePlusSettingsStore = previousStore;
  });

  test('a failing loop-state write is reported and does not throw', () => {
    mountVideo();
    const previousStore = window.YouTubePlusSettingsStore;
    window.YouTubePlusSettingsStore = {
      readGmKey: () => null,
      writeGmKey: jest.fn(() => {
        throw new Error('disk full');
      }),
    };
    expect(() => loop.toggleLoop()).not.toThrow();
    expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
      'Time',
      'Failed to save loop state',
      expect.any(Error)
    );
    window.YouTubePlusSettingsStore = previousStore;
  });

  test('a throwing standalone write inside the loop write is swallowed and logged', () => {
    mountVideo();
    const previousStore = window.YouTubePlusSettingsStore;
    const writeGmKey = jest.fn(() => {
      throw new Error('no standalone storage');
    });
    window.YouTubePlusSettingsStore = { readGmKey: () => null, writeGmKey };
    expect(() => loop.toggleLoop()).not.toThrow();
    expect(writeGmKey).toHaveBeenCalled();
    expect(utils.logSuppressed).toHaveBeenCalledWith(expect.any(Error), 'Time');
    window.YouTubePlusSettingsStore = previousStore;
  });

  test('the progress bar shows a single point, then the whole range', () => {
    const video = mountVideo(100);
    const bar = document.querySelector('.ytp-progress-bar-container');

    Object.defineProperty(video, 'currentTime', { configurable: true, value: 20, writable: true });
    loop.setLoopPoint('A');
    const indicator = document.querySelector('.yp-loop-indicator');
    expect(indicator).not.toBeNull();
    expect(indicator.style.left).toBe('20%');
    expect(indicator.style.width).toBe('2px');
    expect(bar.querySelector('.yp-loop-bubble-a')).not.toBeNull();
    expect(bar.querySelector('.yp-loop-bubble-b')).toBeNull();
    expect(bar.querySelector('.yp-loop-bubble-a').className).toContain('classic-loop-bubble');

    Object.defineProperty(video, 'currentTime', { configurable: true, value: 60, writable: true });
    loop.setLoopPoint('B');
    expect(bar.querySelector('.yp-loop-bubble-b')).not.toBeNull();
    expect(document.querySelector('.yp-loop-indicator').style.left).toBe('20%');

    // Resetting the points takes the indicator and both bubbles down again.
    loop.resetLoopPoints();
    expect(document.querySelector('.yp-loop-indicator')).toBeNull();
    expect(bar.querySelector('.yp-loop-bubble-a')).toBeNull();
    expect(bar.querySelector('.yp-loop-bubble-b')).toBeNull();
  });

  test('a lone point B is rendered as a single marker too', () => {
    const video = mountVideo(100);
    const bar = document.querySelector('.ytp-progress-bar-container');

    Object.defineProperty(video, 'currentTime', { configurable: true, value: 75, writable: true });
    loop.setLoopPoint('B');

    const indicator = document.querySelector('.yp-loop-indicator');
    expect(indicator.style.left).toBe('75%');
    expect(indicator.style.width).toBe('2px');
    expect(bar.querySelector('.yp-loop-bubble-b')).not.toBeNull();
    expect(bar.querySelector('.yp-loop-bubble-a')).toBeNull();
  });

  test('moving point A removes the stale bubble of the other point', () => {
    const video = mountVideo(100);
    const bar = document.querySelector('.ytp-progress-bar-container');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 20, writable: true });
    loop.setLoopPoint('A');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 60, writable: true });
    loop.setLoopPoint('B');
    expect(bar.querySelectorAll('.yp-loop-bubble-a').length).toBe(1);
  });

  test('the vision variant renders its own bubble markup', () => {
    document.documentElement.setAttribute('data-yp-variant', 'vision');
    const video = mountVideo(100);
    const bar = document.querySelector('.ytp-progress-bar-container');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 25, writable: true });
    loop.setLoopPoint('A');
    const bubble = bar.querySelector('.yp-loop-bubble-a');
    expect(bubble.className).toContain('vision-loop-bubble');
    expect(bubble.querySelector('.yp-loop-badge-pill').textContent).toBe('A');
    expect(bubble.querySelector('.yp-loop-badge-time').textContent).toBe('0:25');
    document.documentElement.removeAttribute('data-yp-variant');
  });

  test('the layout attribute and the body class also select the vision bubbles', () => {
    document.documentElement.setAttribute('data-yp-layout', 'vision');
    let video = mountVideo(100);
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 25, writable: true });
    loop.setLoopPoint('A');
    expect(document.querySelector('.yp-loop-bubble-a').className).toContain('vision-loop-bubble');
    document.documentElement.removeAttribute('data-yp-layout');

    loop.resetLoopPoints();
    document.body.classList.add('yp-vision-layout');
    video = mountVideo(100);
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 30, writable: true });
    loop.setLoopPoint('A');
    expect(document.querySelector('.yp-loop-bubble-a').className).toContain('vision-loop-bubble');
    document.body.classList.remove('yp-vision-layout');
  });

  test('progress-bar rendering is skipped without a duration or a progress bar', () => {
    const video = mountVideo();
    Object.defineProperty(video, 'duration', { configurable: true, value: Number.NaN });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 20, writable: true });
    loop.setLoopPoint('A');
    expect(document.querySelector('.yp-loop-indicator')).toBeNull();

    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    loop.setLoopPoint('B');
    document.querySelector('.ytp-progress-bar-container').remove();
    loop.setLoopPoint('A');
    expect(document.querySelector('.yp-loop-indicator')).toBeNull();
  });

  test('every supported progress-bar host is found', () => {
    const hosts = [
      '<div class="ytp-scrubber-container"></div>',
      '<div role="slider" aria-label="video progress bar"></div>',
      '<div class="html5-progress-bar"></div>',
    ];

    for (const hostMarkup of hosts) {
      document.body.innerHTML = `<video></video>${hostMarkup}`;
      const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
      const host = /** @type {HTMLElement} */ (video.nextElementSibling);
      Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
      Object.defineProperty(video, 'currentTime', { configurable: true, value: 20 });
      // A set point is what makes updateLoopProgressBar render at all.
      loop.setLoopPoint('A');
      expect(host.querySelector('.yp-loop-indicator')).not.toBeNull();
      expect(host.querySelector('.yp-loop-indicator')).not.toBeNull();
      loop.resetLoopPoints();
    }

    // Last resort: a slider inside the playback UI element.
    document.body.innerHTML =
      '<video></video><div class="html5-video-player"><div role="slider"></div></div>';
    const playerVideo = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    Object.defineProperty(playerVideo, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(playerVideo, 'currentTime', { configurable: true, value: 20 });
    const slider = /** @type {HTMLElement} */ (document.querySelector('[role="slider"]'));
    loop.setLoopPoint('A');
    expect(slider.querySelector('.yp-loop-indicator')).not.toBeNull();
  });

  test('the indicator host is made a positioning context when it is static', () => {
    const video = mountVideo(100);
    const bar = /** @type {HTMLElement} */ (document.querySelector('.ytp-progress-bar-container'));
    bar.style.position = 'static';
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 20, writable: true });
    loop.setLoopPoint('A');
    expect(bar.style.position).toBe('relative');
  });

  test('a loop frame is captured from the video for the preview card', () => {
    const drawImage = jest.fn();
    const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    });
    const toDataURL = jest
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/jpeg;base64,LOOPFRAME');

    const video = mountVideo();
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 20, writable: true });

    loop.setLoopPoint('A');
    expect(drawImage).toHaveBeenCalled();
    expect(loop.getLoopState().frameA).toBe('data:image/jpeg;base64,LOOPFRAME');

    getContext.mockRestore();
    toDataURL.mockRestore();
  });

  test('a canvas failure leaves the loop frame empty', () => {
    const getContext = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => {
        throw new Error('tainted canvas');
      });
    const video = mountVideo();
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 20, writable: true });

    loop.setLoopPoint('A');
    expect(loop.getLoopState().frameA).toBeNull();
    expect(loop.captureCurrentFrame()).toBeNull();
    getContext.mockRestore();
  });

  test('refreshVisibility also drives the classic dropdown and the vision pill', () => {
    const controls = document.createElement('div');
    document.body.appendChild(controls);
    loop.addClassicLoopButton(controls);

    const player = document.createElement('div');
    const dock = document.createElement('div');
    document.body.append(player, dock);
    loop.DESCRIPTOR.mountDock(player, dock);
    const dropdown = document.getElementById('yp-classic-loop-dropdown');
    const pill = document.getElementById('yp-vision-loop-pill');
    dropdown.classList.add('visible');
    pill.classList.add('visible');

    loop.refreshVisibility(false);
    expect(dropdown.style.display).toBe('none');
    expect(dropdown.classList.contains('visible')).toBe(false);
    expect(pill.style.display).toBe('none');
    expect(pill.classList.contains('visible')).toBe(false);

    loop.refreshVisibility(true);
    expect(dropdown.style.display).toBe('');
    expect(pill.style.display).toBe('');
  });
});

describe('time.js classic loop dropdown and vision pill', () => {
  /** @type {any} */ let utils;
  /** @type {any} */ let loop;
  /** @type {any} */ let ctx;
  /** @type {any} */ let cm;

  /** Give the button and its container a box so the popover positioning runs. */
  const stubRects = (btn, box = { width: 20, height: 20, left: 300, top: 400, bottom: 420 }) => {
    btn.getBoundingClientRect = () => ({ ...box, right: box.left + box.width });
  };

  beforeEach(() => {
    jest.resetModules();
    delete window.__ytpTimeInitDone__;
    delete window.YouTubePlusTimeLoop;
    window.localStorage.clear();
    const built = setupTimeUtils();
    utils = built.utils;
    ctx = makeCtx();
    cm = installCleanupManager();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
    loop = loadTime(utils, ctx);
  });

  afterEach(() => {
    ctx?.releaseAll?.();
    cm?.disposeAll?.();
  });

  test('hovering the classic loop button fills, positions and shows the dropdown', () => {
    document.body.innerHTML = '<video></video><div id="controls"></div>';
    const video = document.querySelector('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 20, writable: true });
    loop.setLoopPoint('A');

    const controls = document.getElementById('controls');
    loop.addClassicLoopButton(controls);
    const btn = controls.querySelector('.yp-loop-button');
    stubRects(btn);
    btn.dispatchEvent(new MouseEvent('mouseenter'));

    const dropdown = document.getElementById('yp-classic-loop-dropdown');
    expect(dropdown.classList.contains('visible')).toBe(true);
    expect(dropdown.querySelector('.yp-classic-set-a-item.has-point')).not.toBeNull();
    expect(dropdown.querySelector('.yp-classic-loop-time-badge').textContent).toBe('0:20');
    expect(dropdown.style.left).toBe('310px');
    expect(dropdown.style.bottom).toBe(`${window.innerHeight - 400 + 10}px`);
    expect(btn.style.color).toBe('');

    loop.toggleLoop();
    expect(dropdown.querySelector('.yp-classic-loop-status-badge').textContent).toBe('stateOn');
    expect(btn.style.color).toBe('var(--yt-accent, #ff0033)');

    btn.dispatchEvent(new MouseEvent('mouseleave'));
    expect(dropdown.classList.contains('visible')).toBe(false);
  });

  test('a collapsed dropdown button keeps its old position', () => {
    document.body.innerHTML = '<div id="controls"></div>';
    const controls = document.getElementById('controls');
    loop.addClassicLoopButton(controls);
    const btn = controls.querySelector('.yp-loop-button');
    // jsdom has no layout: a zero-sized box leaves the placement untouched.
    stubRects(btn, { width: 0, height: 0, left: 0, top: 0, bottom: 0 });
    btn.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.getElementById('yp-classic-loop-dropdown').style.left).toBe('');
  });

  test('every classic dropdown item runs its loop action', () => {
    document.body.innerHTML = '<video></video><div id="controls"></div>';
    const video = document.querySelector('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 15, writable: true });
    const controls = document.getElementById('controls');
    loop.addClassicLoopButton(controls);
    const btn = controls.querySelector('.yp-loop-button');
    stubRects(btn);
    // Hovering is what fills the dropdown; before that it holds no items.
    btn.dispatchEvent(new MouseEvent('mouseenter'));
    const dropdown = document.getElementById('yp-classic-loop-dropdown');
    expect(dropdown.classList.contains('visible')).toBe(true);

    dropdown.querySelector('.yp-classic-set-a-item').click();
    expect(loop.getLoopState().pointA).toBe(15);
    dropdown.querySelector('.yp-classic-set-b-item').click();
    expect(loop.getLoopState().pointB).toBe(15);
    dropdown.querySelector('.yp-classic-loop-toggle-item').click();
    expect(loop.getLoopState().enabled).toBe(true);
    dropdown.querySelector('.yp-classic-reset-item').click();
    expect(loop.getLoopState().pointA).toBeNull();
  });

  test('a replaced dropdown releases the previous delegation', () => {
    document.body.innerHTML = '<div id="controls"></div>';
    const controls = document.getElementById('controls');
    loop.addClassicLoopButton(controls);
    const first = document.getElementById('yp-classic-loop-dropdown');
    // The page re-rendered the shared dropdown: a new element takes its place.
    first.remove();
    const second = document.createElement('div');
    second.id = 'yp-classic-loop-dropdown';
    document.body.appendChild(second);
    loop.addClassicLoopButton(document.createElement('div'));

    expect(window.YouTubePlusEventDelegation.off).toHaveBeenCalledWith(
      first,
      'click',
      '.yp-classic-loop-toggle-item',
      expect.any(Function)
    );
    expect(document.getElementById('yp-classic-loop-dropdown')).toBe(second);
  });

  test('without a delegation surface the dropdown renders but wires no clicks', () => {
    document.body.innerHTML = '<video></video><div id="controls"></div>';
    const video = document.querySelector('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 15, writable: true });
    loop = reloadTime(utils, ctx);
    // The loader installs a delegation shim, so the surface has to be removed
    // after the reload and before the button is mounted.
    Object.defineProperty(window, 'YouTubePlusEventDelegation', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const controls = document.getElementById('controls');
    loop.addClassicLoopButton(controls);
    const btn = controls.querySelector('.yp-loop-button');
    stubRects(btn);

    const dropdown = document.getElementById('yp-classic-loop-dropdown');
    expect(dropdown).not.toBeNull();
    // Neither the hover popover nor the click delegation exists, so the panel
    // is never populated and never shown.
    btn.dispatchEvent(new MouseEvent('mouseenter'));
    expect(dropdown.classList.contains('visible')).toBe(false);
    expect(dropdown.querySelector('.yp-classic-loop-toggle-item')).toBeNull();

    // The button keeps its own cleanup-manager click registration.
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(loop.getLoopState().enabled).toBe(true);
  });

  test('a controls element that rejects insertion is swallowed', () => {
    const detached = {
      querySelector: () => null,
      insertBefore: () => {
        throw new Error('controls replaced');
      },
    };
    expect(() => loop.addClassicLoopButton(detached)).not.toThrow();
    expect(() => loop.addClassicLoopButton(null)).not.toThrow();
  });

  test('the vision dock button toggles the loop and its dispose releases everything', () => {
    const player = document.createElement('div');
    const dock = document.createElement('div');
    document.body.append(player, dock);
    player.getBoundingClientRect = () => ({ top: 0, left: 0, width: 400, height: 300 });

    const dispose = loop.DESCRIPTOR.mountDock(player, dock);
    const btn = dock.querySelector('#yp-vision-loop-btn');
    const pill = player.querySelector('#yp-vision-loop-pill');
    stubRects(btn, { width: 24, height: 24, left: 120, top: 260, bottom: 284 });

    btn.dispatchEvent(new MouseEvent('mouseenter'));
    expect(pill.classList.contains('visible')).toBe(true);
    expect(pill.querySelector('.yp-vision-loop-toggle-btn')).not.toBeNull();
    expect(pill.style.left).toBe(`${120 + 12}px`);
    expect(pill.style.top).toBe(`${284 + 10}px`);
    btn.dispatchEvent(new MouseEvent('mouseleave'));
    expect(pill.classList.contains('visible')).toBe(false);

    const before = loop.getLoopState().enabled;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(loop.getLoopState().enabled).toBe(!before);

    dispose();
    expect(window.YouTubePlusEventDelegation.off).toHaveBeenCalledWith(
      pill,
      'click',
      '.yp-vision-loop-toggle-btn',
      expect.any(Function)
    );
  });

  test('the vision pill cards drive the loop through their delegation', () => {
    document.body.innerHTML = '<video></video>';
    const video = document.querySelector('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 12, writable: true });

    const player = document.createElement('div');
    const dock = document.createElement('div');
    document.body.append(player, dock);
    loop.DESCRIPTOR.mountDock(player, dock);
    const pill = player.querySelector('#yp-vision-loop-pill');
    loop.populateVisionLoopPill(pill, { enabled: false, pointA: null, pointB: null });

    pill.querySelector('.yp-vision-set-a-btn').click();
    expect(loop.getLoopState().pointA).toBe(12);
    pill.querySelector('.yp-vision-set-b-btn').click();
    expect(loop.getLoopState().pointB).toBe(12);
    pill.querySelector('.yp-vision-loop-toggle-btn').click();
    expect(loop.getLoopState().enabled).toBe(true);
    pill.querySelector('.yp-vision-reset-btn').click();
    expect(loop.getLoopState().pointA).toBeNull();
  });

  test('the loop state listener leaves a hidden pill and a missing facade alone', () => {
    const player = document.createElement('div');
    const dock = document.createElement('div');
    document.body.append(player, dock);
    loop.DESCRIPTOR.mountDock(player, dock);
    const pill = player.querySelector('#yp-vision-loop-pill');

    // A pill without the visible class is skipped entirely.
    document.dispatchEvent(new CustomEvent('yp-loop-state-changed'));
    expect(pill.querySelector('.yp-vision-loop-cards')).toBeNull();

    pill.classList.add('visible');
    delete window.YouTubePlusTimeLoop;
    document.dispatchEvent(new CustomEvent('yp-loop-state-changed'));
    // The handler falls back to an empty state instead of throwing.
    expect(pill.querySelector('.yp-vision-loop-toggle-btn').textContent).toContain('loopState');
  });

  test('the classic state listener ignores a missing loop facade', () => {
    document.body.innerHTML = '<video></video><div id="controls"></div>';
    const controls = document.getElementById('controls');
    loop.addClassicLoopButton(controls);
    const btn = controls.querySelector('.yp-loop-button');
    stubRects(btn);
    btn.dispatchEvent(new MouseEvent('mouseenter'));
    const dropdown = document.getElementById('yp-classic-loop-dropdown');
    dropdown.classList.add('visible');
    const badge = dropdown.querySelector('.yp-classic-loop-status-badge');
    expect(badge.textContent).toBe('stateOff');

    // Without the facade the handler returns before recoloring the buttons or
    // refreshing the visible dropdown, so the rendered markup is untouched.
    delete window.YouTubePlusTimeLoop;
    expect(() => document.dispatchEvent(new CustomEvent('yp-loop-state-changed'))).not.toThrow();
    expect(dropdown.querySelector('.yp-classic-loop-status-badge')).toBe(badge);
    expect(badge.textContent).toBe('stateOff');
  });

  test('the dock button falls back to the SafeDOM surfaces when utils has none', () => {
    delete utils.setSafeHTML;
    const setInnerHTML = jest.fn();
    Object.defineProperty(window, 'YouTubePlusSafeDOM', {
      configurable: true,
      writable: true,
      value: { setInnerHTML },
    });

    const player = document.createElement('div');
    const dock = document.createElement('div');
    document.body.append(player, dock);
    loop.DESCRIPTOR.mountDock(player, dock);
    expect(setInnerHTML).toHaveBeenCalledWith(
      dock.querySelector('#yp-vision-loop-btn'),
      expect.stringContaining('<svg')
    );

    // Without the newer facade the legacy one is used instead.
    Object.defineProperty(window, 'YouTubePlusSafeDOM', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const setHTML = jest.fn();
    Object.defineProperty(window, 'YouTubeSafeDOM', {
      configurable: true,
      writable: true,
      value: { setHTML },
    });
    const dock2 = document.createElement('div');
    document.body.appendChild(dock2);
    loop.DESCRIPTOR.mountDock(player, dock2);
    expect(setHTML).toHaveBeenCalled();
  });

  test('a mount without a player surface returns a no-op disposer', () => {
    const dock = document.createElement('div');
    document.body.appendChild(dock);
    const dispose = loop.DESCRIPTOR.mountDock(null, dock);
    expect(typeof dispose).toBeNull;
    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
  });
});

describe('time.js loop hotkey settings and migration', () => {
  /** @type {any} */ let utils;

  const installStore = store => {
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: store,
    });
  };

  beforeEach(() => {
    jest.resetModules();
    delete window.__ytpTimeInitDone__;
    delete window.YouTubePlusTimeLoop;
    window.localStorage.clear();
    utils = setupTimeUtils().utils;
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=vid1',
      href: 'https://www.youtube.com/watch?v=vid1',
    });
  });

  test('legacy default hotkeys are migrated to the current keys once', () => {
    const set = jest.fn();
    // A real store keeps what it was given, so the keystroke below re-reads the
    // migrated map instead of the legacy one.
    let stored = { toggleLoop: 'r', setPointA: 'l', setPointB: 'o', resetPoints: 'k' };
    installStore({
      get: jest.fn(() => stored),
      set: jest.fn((key, value) => {
        set(key, value);
        stored = value;
        return true;
      }),
    });

    const loop = loadTime(utils, makeCtx());
    expect(set).toHaveBeenCalledWith('loopHotkeys', {
      toggleLoop: 'r',
      setPointA: 'k',
      setPointB: 'l',
      resetPoints: 'o',
    });

    // The migrated keys drive the loop from then on.
    document.body.innerHTML = '<video></video>';
    const video = document.querySelector('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 33, writable: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(loop.getLoopState().pointA).toBe(33);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    expect(loop.getLoopState().pointB).toBe(33);
    expect(set).toHaveBeenCalledTimes(1);
  });

  test('current hotkeys are left untouched', () => {
    const set = jest.fn();
    installStore({
      get: jest.fn(() => ({ toggleLoop: 'q', setPointA: 'w', setPointB: 'e', resetPoints: 'r' })),
      set,
    });
    loadTime(utils, makeCtx());
    expect(set).not.toHaveBeenCalled();
  });

  test('a hotkey store that cannot be read falls back to the defaults', () => {
    installStore({
      get: key => {
        if (key === 'loopHotkeys') throw new Error('settings unavailable');
        return true;
      },
      set: jest.fn(),
    });
    const loop = loadTime(utils, makeCtx());
    document.body.innerHTML = '<video></video>';
    const video = document.querySelector('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 5, writable: true });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(loop.getLoopState().pointA).toBe(5);
    expect(window.YouTubePlusLogger.warn).toHaveBeenCalledWith(
      'Time',
      'Failed to read loop hotkeys',
      expect.any(Error)
    );
  });

  test('a store without a setter does not break the hotkey path', () => {
    installStore({ get: () => ({}) });
    expect(() => loadTime(utils, makeCtx())).not.toThrow();
    expect(window.YouTubePlusTimeLoop).toBeDefined();
  });
});
