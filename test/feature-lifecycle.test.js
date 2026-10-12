/**
 * FeatureLifecycle contract (feature-registry.js) and its first user, the
 * scroll-to-top feature in enhanced.js. Real CleanupManager, SettingsStore,
 * EventDelegation and StyleManager.
 * @jest-environment jsdom
 */

function mockWatchLocation() {
  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/results',
    search: '?search_query=test',
    href: 'https://www.youtube.com/results?search_query=test',
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

function counts() {
  const cm = window.YouTubePlusCleanupManager;
  return {
    listeners: cm.getListenerStats().active,
    observers: cm.observers.size + cm.sessionObservers.size,
    delegated: window.YouTubePlusEventDelegation?.getStats?.().totalHandlers ?? 0,
  };
}

const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;
const store = () => window.YouTubePlusSettingsStore;

describe('FeatureLifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    mockWatchLocation();
    loadChain();
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('nothing starts before sync; afterwards the host follows the setting', () => {
    store().set('enableScrollToTopButton', true);
    const start = jest.fn();
    const stop = jest.fn();
    const handle = lifecycle().define({
      id: 'probe',
      settingsKey: 'enableScrollToTopButton',
      start,
      stop,
    });

    store().set('enableScrollToTopButton', false);
    store().set('enableScrollToTopButton', true);
    expect(start).not.toHaveBeenCalled();

    handle.sync();
    expect(start).toHaveBeenCalledTimes(1);
    expect(handle.isRunning()).toBe(true);

    store().set('enableScrollToTopButton', false);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(handle.isRunning()).toBe(false);

    store().set('enableScrollToTopButton', true);
    expect(start).toHaveBeenCalledTimes(2);
  });

  test('stop releases every resource acquired through ctx', () => {
    store().set('enableScrollToTopButton', true);
    const before = counts();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onTimer = jest.fn();
    jest.useFakeTimers();

    const handle = lifecycle().define({
      id: 'probe',
      settingsKey: 'enableScrollToTopButton',
      start(ctx) {
        ctx.listen(window, 'scroll', jest.fn());
        ctx.listen(target, 'click', jest.fn());
        ctx.delegate(document, 'click', '.probe', jest.fn());
        ctx.observe(new MutationObserver(jest.fn())).observe(target, { childList: true });
        ctx.timeout(onTimer, 1000);
        ctx.style('probe-style', '.probe{color:red}');
        const node = ctx.own(document.createElement('span'));
        node.id = 'probe-node';
        document.body.appendChild(node);
        const child = ctx.scope();
        child.listen(target, 'keydown', jest.fn());
      },
    });
    handle.sync();

    const running = counts();
    expect(running.listeners).toBe(before.listeners + 3);
    expect(running.observers).toBe(before.observers + 1);
    expect(running.delegated).toBe(before.delegated + 1);
    expect(document.getElementById('probe-node')).not.toBeNull();
    expect(window.YouTubePlusDesignSystem.StyleManager.has('probe-style')).toBe(true);

    store().set('enableScrollToTopButton', false);
    jest.advanceTimersByTime(2000);
    jest.useRealTimers();

    expect(counts()).toEqual(before);
    expect(document.getElementById('probe-node')).toBeNull();
    expect(onTimer).not.toHaveBeenCalled();
    expect(window.YouTubePlusDesignSystem.StyleManager.has('probe-style')).toBe(false);
  });

  test('10 on/off cycles return to the starting counts', () => {
    store().set('enableScrollToTopButton', true);
    const handle = lifecycle().define({
      id: 'probe',
      settingsKey: 'enableScrollToTopButton',
      start(ctx) {
        ctx.listen(window, 'resize', jest.fn());
        ctx.scope().listen(window, 'scroll', jest.fn());
      },
    });
    handle.sync();
    store().set('enableScrollToTopButton', false);
    const baseline = counts();

    for (let i = 0; i < 10; i++) {
      store().set('enableScrollToTopButton', true);
      store().set('enableScrollToTopButton', false);
    }
    expect(counts()).toEqual(baseline);
  });

  test('a disposed scope releases only its own group and cannot re-acquire', () => {
    const ctx = lifecycle().createContext('probe');
    const keep = jest.fn();
    const drop = jest.fn();
    ctx.listen(window, 'probe-event', keep);
    const child = ctx.scope();
    child.listen(window, 'probe-event', drop);

    child.dispose();
    child.listen(window, 'probe-event', drop);
    window.dispatchEvent(new Event('probe-event'));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(drop).not.toHaveBeenCalled();

    ctx.dispose();
    window.dispatchEvent(new Event('probe-event'));
    expect(keep).toHaveBeenCalledTimes(1);
  });

  test('restart runs stop then start; list and active report state', () => {
    store().set('enableScrollToTopButton', true);
    const seen = [];
    const handle = lifecycle().define({
      id: 'probe',
      settingsKey: 'enableScrollToTopButton',
      start(ctx) {
        seen.push(['start', ctx.active]);
        ctx.onDispose(() => seen.push(['disposed', ctx.active]));
      },
      stop: () => seen.push(['stop']),
    });
    expect(lifecycle().list()).toContain('probe');
    expect(lifecycle().define({ id: 'probe', start: jest.fn() })).toBeNull();

    handle.sync();
    handle.restart();
    expect(seen).toEqual([['start', true], ['stop'], ['disposed', false], ['start', true]]);
    expect(lifecycle().isRunning('probe')).toBe(true);
  });

  test('interval and frame are released on dispose and tracked while pending', () => {
    jest.useFakeTimers();
    const cm = window.YouTubePlusCleanupManager;
    const ctx = lifecycle().createContext('probe');
    const tick = jest.fn();
    const onFrame = jest.fn();
    ctx.interval(tick, 100);
    ctx.frame(onFrame);
    expect(cm.intervals.size + cm.sessionIntervals.size).toBeGreaterThan(0);
    jest.advanceTimersByTime(250);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenCalledTimes(1);

    const late = jest.fn();
    ctx.frame(late);
    ctx.dispose();
    jest.advanceTimersByTime(500);
    jest.useRealTimers();
    expect(tick).toHaveBeenCalledTimes(2);
    expect(late).not.toHaveBeenCalled();
  });

  test('without an event delegator, delegate is a safe no-op', () => {
    const delegator = window.YouTubePlusEventDelegation;
    window.YouTubePlusEventDelegation = undefined;
    try {
      const ctx = lifecycle().createContext('probe');
      const release = ctx.delegate(document, 'click', '.x', jest.fn());
      expect(typeof release).toBe('function');
      release();
      ctx.dispose();
    } finally {
      window.YouTubePlusEventDelegation = delegator;
    }
  });

  test('a start that throws leaves nothing running', () => {
    store().set('enableScrollToTopButton', true);
    const before = counts();
    const handle = lifecycle().define({
      id: 'probe',
      settingsKey: 'enableScrollToTopButton',
      start(ctx) {
        ctx.listen(window, 'scroll', jest.fn());
        throw new Error('boom');
      },
    });
    handle.sync();
    expect(handle.isRunning()).toBe(false);
    expect(counts()).toEqual(before);
  });
});

describe('scroll-to-top on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    delete window._enhancedInitialized;
    mockWatchLocation();
    loadChain();
  });

  afterEach(() => {
    lifecycle()?._reset?.();
    delete window._enhancedInitialized;
  });

  function loadEnhanced() {
    jest.useFakeTimers();
    require('../src/enhanced.js');
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  }

  test('toggling the setting adds and fully removes the button, styles and listeners', () => {
    store().set('enableScrollToTopButton', false);
    loadEnhanced();
    expect(lifecycle().isRunning('scrollToTop')).toBe(false);
    expect(document.getElementById('universal-top-button')).toBeNull();
    const baseline = counts();

    for (let i = 0; i < 10; i++) {
      store().set('enableScrollToTopButton', true);
      expect(document.getElementById('universal-top-button')).not.toBeNull();
      store().set('enableScrollToTopButton', false);
    }

    expect(document.getElementById('universal-top-button')).toBeNull();
    expect(counts()).toEqual(baseline);
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    expect(css).not.toContain('.top-button{');
  });

  test('turning the feature off leaves Return YouTube Dislike alone', () => {
    store().set('enableScrollToTopButton', true);
    loadEnhanced();
    const dislike = document.createElement('span');
    dislike.id = 'yp-dislike-text';
    document.body.appendChild(dislike);

    store().set('enableScrollToTopButton', false);
    expect(document.getElementById('yp-dislike-text')).not.toBeNull();
  });
});

describe('speed and zoom on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <div id="movie_player">
        <video class="video-stream html5-main-video"></video>
        <div class="ytp-chrome-bottom"><div class="ytp-right-controls"></div></div>
      </div>`;
    localStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=abc',
      href: 'https://www.youtube.com/watch?v=abc',
    });
    if (typeof global.ResizeObserver !== 'function') {
      global.ResizeObserver = class {
        observe = jest.fn();
        disconnect = jest.fn();
      };
    }
    loadChain();
    require('../src/zoom.js');
    require('../src/speedcontrol.js');
    require('../src/download.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  const enhancer = () => ({
    speedControl: {
      currentSpeed: 1,
      availableSpeeds: [0.5, 1, 1.5, 2],
      storageKey: 'youtube_playback_speed',
    },
    settings: { speedControlHotkeys: { decrease: 'g', increase: 'h', reset: 'b' } },
    isEditableTarget: () => false,
  });

  const mountSpeed = () => {
    const api = window.YouTubePlusSpeedControl;
    const e = enhancer();
    api.registerHotkeys(e);
    api.setupVideoObserver(e);
    api.addButton(e, document.querySelector('.ytp-right-controls'));
  };

  const css = () => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');

  test('speed: 10 on/off cycles leave no listeners, DOM or CSS behind', () => {
    // The Classic variant mounts the player-controls button; Vision uses the dock.
    store().set('styles.themeVariant', 'classic');
    store().set('enableSpeedControl', true);
    mountSpeed();
    store().set('enableSpeedControl', false);
    const baseline = counts();

    for (let i = 0; i < 10; i++) {
      store().set('enableSpeedControl', true);
      expect(document.querySelector('.speed-control-btn')).not.toBeNull();
      expect(document.querySelector('.speed-options')).not.toBeNull();
      store().set('enableSpeedControl', false);
    }

    expect(counts()).toEqual(baseline);
    expect(document.querySelector('.speed-control-btn')).toBeNull();
    expect(document.querySelector('.speed-options')).toBeNull();
    expect(document.getElementById('speed-indicator')).toBeNull();
    expect(css()).not.toContain('.speed-options');
  });

  test('speed: after switching back on, hotkeys and the video rate work again', () => {
    store().set('enableSpeedControl', true);
    mountSpeed();
    store().set('enableSpeedControl', false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(localStorage.getItem('youtube_playback_speed')).toBeNull();

    store().set('enableSpeedControl', true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(localStorage.getItem('youtube_playback_speed')).toBe('1.5');
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    video.playbackRate = 3;
    video.dispatchEvent(new Event('ratechange'));
    expect(video.playbackRate).toBe(1.5);
  });

  test('zoom: 10 on/off cycles leave no listeners, observers, DOM or CSS behind', () => {
    store().set('enableZoom', true);
    window.YouTubePlusZoom.initZoom?.();
    expect(document.getElementById('yp-zoom-control')).not.toBeNull();
    store().set('enableZoom', false);
    const baseline = counts();

    for (let i = 0; i < 10; i++) {
      store().set('enableZoom', true);
      expect(document.getElementById('yp-zoom-control')).not.toBeNull();
      expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-zoom-styles')).toBe(true);
      store().set('enableZoom', false);
    }

    expect(counts()).toEqual(baseline);
    expect(document.getElementById('yp-zoom-control')).toBeNull();
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-zoom-styles')).toBe(false);
    const video = /** @type {HTMLVideoElement} */ (document.querySelector('video'));
    expect(video.style.transform).toBe('');
  });

  test('download: 10 on/off cycles leave no listeners or DOM behind and the menu still works', () => {
    store().set('styles.themeVariant', 'classic');
    store().set('enableDownload', true);
    const manager = window.YouTubePlusDownloadButton.createDownloadButtonManager({
      settings: {
        enableDownload: true,
        downloadSites: { externalDownloader: true, ytdl: true, direct: true },
      },
      t: k => k,
      getElement: sel => document.querySelector(sel),
      YouTubeUtils: window.YouTubeUtils,
    });
    manager.addDownloadButton(document.querySelector('.ytp-right-controls'));
    store().set('enableDownload', false);
    const baseline = counts();

    for (let i = 0; i < 10; i++) {
      store().set('enableDownload', true);
      expect(document.querySelectorAll('.ytp-right-controls .yp-download-button')).toHaveLength(1);
      expect(document.querySelectorAll('.download-options')).toHaveLength(1);
      store().set('enableDownload', false);
    }

    expect(counts()).toEqual(baseline);
    expect(document.querySelector('.ytp-right-controls .yp-download-button')).toBeNull();
    expect(document.querySelector('.download-options')).toBeNull();

    store().set('enableDownload', true);
    const button = document.querySelector('.ytp-right-controls .yp-download-button');
    button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.querySelector('.download-options')?.classList.contains('visible')).toBe(true);
  });
});
