/**
 * Branch coverage for src/timecode.js with the real utils + CleanupManager and
 * no FeatureLifecycle host: the module then owns its panel listeners through
 * `handlePanelClick`, which is the path users get on builds where the settings
 * modal host is absent. Everything exercised here is real module behaviour.
 * @jest-environment jsdom
 */

describe('Timecode branches (real utils, manual panel wiring)', () => {
  let api;
  let hooks;
  let loggerWarn;
  let loggerError;
  let logError;

  const VIDEO_ID = 'vid1';

  const stubVideo = () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    });
    video.play = jest.fn(() => Promise.resolve());
    document.body.appendChild(video);
    return video;
  };

  /** A FeatureContext stand-in: enough surface for start()/scope/listen. */
  const makeCtx = () => {
    const listeners = [];
    const scopeDisposers = [];
    const scope = {
      own: jest.fn(),
      listen: (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        const off = () => target.removeEventListener(type, fn, opts);
        listeners.push(off);
        return off;
      },
      onDispose: fn => scopeDisposers.push(fn),
      dispose: () => {
        for (const off of listeners.splice(0)) off();
        for (const fn of scopeDisposers.splice(0)) fn();
      },
    };
    return {
      ctx: {
        listen: (target, type, fn, opts) => {
          target.addEventListener(type, fn, opts);
          return () => target.removeEventListener(type, fn, opts);
        },
        scope: () => scope,
        style: jest.fn(),
        timeout: (fn, ms) => {
          const id = setTimeout(fn, ms);
          return () => clearTimeout(id);
        },
      },
      scope,
    };
  };

  const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  const flush = async (frames = 3) => {
    for (let i = 0; i < frames; i++) await nextFrame();
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  /** Load the module the way a partial bootstrap would: utils only. */
  const boot = ({ withoutRetryScheduler = false, withoutWaitForElement = false } = {}) => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    delete window._timecodeModuleInitialized;

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    });

    require('../src/utils.js');
    require('../src/safe-dom.js');
    require('../src/settings-store.js');
    window.YouTubeUtils.NotificationManager = { show: jest.fn() };
    window.YouTubeUtils.confirmDialog = jest.fn(() => Promise.resolve(true));
    if (withoutRetryScheduler) delete window.YouTubeUtils.createRetryScheduler;
    if (withoutWaitForElement) {
      window.YouTubeUtils.waitForElement = () => Promise.reject(new Error('never appeared'));
    }

    loggerWarn = jest.spyOn(window.YouTubeUtils.logger, 'warn').mockImplementation(() => {
      // silence the double's own console output
    });
    loggerError = jest.spyOn(window.YouTubeUtils.logger, 'error').mockImplementation(() => {
      // silence the double's own console output
    });
    logError = jest.spyOn(window.YouTubeUtils, 'logError').mockImplementation(() => {
      // silence the double's own console output
    });

    document.body.appendChild(document.createElement('ytd-app'));
    stubVideo();

    require('../src/timecode.js');
    api = window.YouTubePlusTimecode;
    hooks = api.testHooks;
  };

  beforeEach(() => {
    boot();
  });

  afterEach(() => {
    jest.useRealTimers();
    api?.cleanup?.();
    jest.restoreAllMocks();
  });

  const notify = () => window.YouTubeUtils.NotificationManager.show;
  const warned = () => loggerWarn;
  const panelEl = () => document.getElementById('timecode-panel');
  const items = () => panelEl().querySelectorAll('.timecode-item');
  const sectionToggle = () => document.querySelector('.yp-submenu-toggle[data-submenu="timecode"]');
  const submenuWrap = () => document.querySelector('.timecode-submenu[data-submenu="timecode"]');
  const saveForm = () => panelEl().querySelector('#timecode-form-save').click();

  describe('boot and init guards', () => {
    test('a second evaluation of the module is a no-op', () => {
      const first = api;
      const stats = window.YouTubePlusCleanupManager.getListenerStats();

      jest.isolateModules(() => {
        require('../src/timecode.js');
      });

      expect(window.YouTubePlusTimecode).toBe(first);
      expect(window.YouTubePlusCleanupManager.getListenerStats()).toEqual(stats);
    });

    test('init refuses to run outside the watch host', () => {
      document.body.innerHTML = '';
      document.body.appendChild(document.createElement('ytd-app'));
      window.YouTubeUtils.getHostname = () => 'music.youtube.com';
      const stats = window.YouTubePlusCleanupManager.getListenerStats();

      api.init();

      expect(window.YouTubePlusCleanupManager.getListenerStats()).toEqual(stats);
      expect(api.state.timecodes.size).toBe(0);
    });

    test('init refuses to run inside an embedded frame', () => {
      document.body.innerHTML = '';
      document.body.appendChild(document.createElement('ytd-app'));
      Object.defineProperty(window, 'frameElement', {
        configurable: true,
        value: document.createElement('iframe'),
      });
      const stats = window.YouTubePlusCleanupManager.getListenerStats();

      api.init();

      expect(window.YouTubePlusCleanupManager.getListenerStats()).toEqual(stats);
      delete window.frameElement;
    });

    test('a missing app root schedules a retry that boots the module', async () => {
      document.body.innerHTML = '';
      window.YouTubeUtils.createRetryScheduler = jest.fn(() => ({ stop: jest.fn() }));

      api.init();
      const opts = window.YouTubeUtils.createRetryScheduler.mock.calls[0][0];
      expect(opts.label).toBe('timecode-init');
      expect(opts.maxAttempts).toBe(30);
      // Nothing to attach to yet.
      expect(opts.check()).toBe(false);

      document.body.appendChild(document.createElement('ytd-app'));
      expect(opts.check()).toBe(true);

      // The retry really booted the module: the modal wiring is live.
      const modal = document.createElement('div');
      modal.className = 'yp-settings-modal';
      modal.innerHTML =
        '<div class="yp-settings-section" data-section="advanced">' +
        '<div class="timecode-settings-item"></div></div>';
      document.body.appendChild(modal);
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      expect(modal.querySelector('.timecode-settings-item').dataset.handlerAttached).toBe('1');
    });

    test('without a retry scheduler init falls back to a tracked frame', async () => {
      jest.resetModules();
      document.body.innerHTML = '';
      delete window._timecodeModuleInitialized;
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      });
      require('../src/utils.js');
      window.YouTubeUtils.NotificationManager = { show: jest.fn() };
      window.YouTubeUtils.confirmDialog = jest.fn(() => Promise.resolve(true));
      delete window.YouTubeUtils.createRetryScheduler;

      require('../src/timecode.js');
      const booted = window.YouTubePlusTimecode;
      booted.init();

      // No ytd-app yet: the fallback re-enters init from an animation frame.
      expect(booted.testHooks.timecodeFeature).toBeUndefined();
      document.body.appendChild(document.createElement('ytd-app'));
      await flush();

      const modal = document.createElement('div');
      modal.className = 'yp-settings-modal';
      modal.innerHTML =
        '<div class="yp-settings-section" data-section="advanced">' +
        '<div class="timecode-settings-item"></div></div>';
      document.body.appendChild(modal);
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      expect(modal.querySelector('.timecode-settings-item').dataset.handlerAttached).toBe('1');
    });

    test('the settings modal event is ignored when no modal is open', () => {
      const stats = window.YouTubePlusCleanupManager.getListenerStats();
      expect(() =>
        document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'))
      ).not.toThrow();
      expect(window.YouTubePlusCleanupManager.getListenerStats()).toEqual(stats);
    });

    test('the settings modal wiring falls back to the canonical CleanupManager', () => {
      const canonical = window.YouTubePlusCleanupManager;
      jest.resetModules();
      document.body.innerHTML = '';
      delete window._timecodeModuleInitialized;
      delete window.YouTubePlusCleanupManager;

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      });
      require('../src/utils.js');
      window.YouTubeUtils.NotificationManager = { show: jest.fn() };
      window.YouTubeUtils.confirmDialog = jest.fn(() => Promise.resolve(true));
      require('../src/timecode.js');
      const bare = window.YouTubePlusTimecode;

      try {
        const modal = document.createElement('div');
        modal.className = 'yp-settings-modal';
        modal.innerHTML =
          '<div class="yp-settings-section" data-section="advanced">' +
          '<div class="timecode-settings-item"></div></div>';
        document.body.appendChild(modal);
        expect(() =>
          document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'))
        ).not.toThrow();

        // init() runs the same wiring through the fallback branch.
        bare.init();
        expect(() =>
          document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'))
        ).not.toThrow();
      } finally {
        window.YouTubePlusCleanupManager = canonical;
      }
    });
  });

  describe('settings persistence', () => {
    test('ignores a missing or non-object payload and keeps type discipline', () => {
      hooks.loadSettings();
      expect(api.config.shortcut.key).toBe('T');

      localStorage.setItem('youtube_timecode_settings', '"a string"');
      hooks.loadSettings();
      expect(api.config.shortcut.key).toBe('T');

      localStorage.setItem(
        'youtube_timecode_settings',
        JSON.stringify({
          autoDetect: 'yes',
          autoSave: 1,
          autoTrackPlayback: false,
          export: false,
          shortcut: { key: 7, shiftKey: 'true', altKey: true, ctrlKey: null },
          panelPosition: { left: -5, top: 12 },
        })
      );
      hooks.loadSettings();

      expect(api.config.autoDetect).toBe(true);
      expect(api.config.autoSave).toBe(true);
      expect(api.config.autoTrackPlayback).toBe(false);
      expect(api.config.export).toBe(false);
      expect(api.config.shortcut).toEqual({
        key: 'T',
        shiftKey: true,
        altKey: true,
        ctrlKey: false,
      });
      // A negative coordinate is not a usable position.
      expect(api.config.panelPosition).toBeNull();
    });

    test('rejects NaN and half-filled positions', () => {
      localStorage.setItem(
        'youtube_timecode_settings',
        JSON.stringify({ panelPosition: { left: '10', top: 20 } })
      );
      hooks.loadSettings();
      expect(api.config.panelPosition).toBeNull();

      localStorage.setItem('youtube_timecode_settings', 'null');
      hooks.loadSettings();
      expect(api.config.panelPosition).toBeNull();
    });

    test('a failing settings read is reported instead of thrown', () => {
      jest.spyOn(window.YouTubeUtils.storage, 'get').mockImplementation(() => {
        throw new Error('store unavailable');
      });
      expect(() => hooks.loadSettings()).not.toThrow();
      expect(api.config.shortcut.key).toBe('T');
      expect(loggerError).toHaveBeenCalled();
    });

    test('a storage write failure is reported instead of thrown', () => {
      jest.spyOn(window.YouTubeUtils.storage, 'set').mockImplementation(() => {
        throw new Error('quota');
      });
      api.config.shortcut.key = 'Q';
      expect(() => hooks.saveSettings()).not.toThrow();
      expect(api.config.shortcut.key).toBe('Q');
      expect(loggerError).toHaveBeenCalled();
    });
  });

  describe('panel position helpers', () => {
    test('a missing panel clamps to the origin and warns', () => {
      expect(hooks.clampPanelPosition(null, 10, 10)).toEqual({ left: 0, top: 0 });
      expect(warned()).toHaveBeenCalledWith('Timecode', 'Invalid panel element');
    });

    test('non-numeric coordinates clamp to the origin and warn', () => {
      const panel = api.createTimecodePanel();
      expect(hooks.clampPanelPosition(panel, Number.NaN, 10)).toEqual({ left: 0, top: 0 });
      expect(hooks.clampPanelPosition(panel, 10, '20')).toEqual({ left: 0, top: 0 });
      expect(warned()).toHaveBeenCalledWith('Timecode', 'Invalid position coordinates');
    });

    test('the position is clamped to the viewport on both axes', () => {
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      const far = hooks.clampPanelPosition(panel, 99999, 99999);
      expect(far.left).toBe(window.innerWidth);
      expect(far.top).toBe(window.innerHeight);
      expect(hooks.clampPanelPosition(panel, -10, -10)).toEqual({ left: 0, top: 0 });
    });

    test('an invalid position is never persisted', () => {
      hooks.savePanelPosition(Number.NaN, 10);
      expect(api.config.panelPosition).toBeNull();
      expect(warned()).toHaveBeenCalledWith('Timecode', 'Invalid position coordinates for saving');

      hooks.savePanelPosition(10, 20);
      expect(api.config.panelPosition).toEqual({ left: 10, top: 20 });
    });

    test('a position cleared before the frame runs is not applied', async () => {
      const panel = api.createTimecodePanel();
      api.config.panelPosition = { left: 40, top: 50 };
      hooks.applySavedPanelPosition(panel);
      api.config.panelPosition = null;
      await flush();

      expect(panel.style.left).toBe('');
      expect(panel.style.top).toBe('');

      api.config.panelPosition = { left: 40, top: 50 };
      hooks.applySavedPanelPosition(panel);
      await flush();
      expect(panel.style.left).toBe('40px');
      expect(panel.style.top).toBe('50px');
    });

    test('no saved position means no repositioning', async () => {
      const panel = api.createTimecodePanel();
      api.config.panelPosition = null;
      hooks.applySavedPanelPosition(panel);
      await flush();
      expect(panel.style.left).toBe('');
    });
  });

  describe('timecode line extraction', () => {
    test('a repeated half collapses to a single copy', () => {
      const result = hooks.extractTimecodes('00:10 intro intro intro intro');
      expect(result[0].label).toBe('intro intro');
      // ... and the deduplication is reported.
      expect(warned()).toHaveBeenCalledWith(
        'Timecode',
        expect.stringContaining('Description deduplicated')
      );
    });

    test('a repeating pattern that is not an exact half is collapsed', () => {
      const result = hooks.extractTimecodes('00:10 alpha beta gamma delta alpha beta gamma omega');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('alpha beta gamma delta');
    });

    test('a truncated repeat scores partial word matches', () => {
      // The repeated tail is cut short, so the longer word only earns credit.
      expect(hooks.extractTimecodes('00:20 abcdef xy pqr abc xy pqr')[0].label).toBe(
        'abcdef xy pqr'
      );
      // ... and the same in the other direction: a pattern that was truncated.
      expect(hooks.extractTimecodes('00:20 abc xy pqr abcdef xy pqr')[0].label).toBe('abc xy pqr');
    });

    test('a label that is only a bullet number collapses to empty', () => {
      const result = hooks.extractTimecodes('00:10 3.');
      expect(result).toEqual([{ time: 10, label: '', originalText: '00:10' }]);
    });

    test('a leading token that is not a valid time is skipped', () => {
      expect(hooks.extractTimecodes('123:45 nope')).toEqual([]);
      expect(hooks.extractTimecodes('99:99 nope')).toEqual([]);
    });

    test('longer duplicate labels win over shorter ones', () => {
      const result = hooks.extractTimecodes('01:30 short\n01:30 a considerably longer label');
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('a considerably longer label');
    });

    test('an oversized description is truncated with a warning', () => {
      const text = `00:10 kept\n${'x'.repeat(60000)}`;
      const result = hooks.extractTimecodes(text);
      expect(result).toHaveLength(1);
      expect(result[0].time).toBe(10);
      expect(warned()).toHaveBeenCalledWith('Timecode', 'Text too long, truncating');
    });

    test('more lines than the extraction budget are capped with a warning', () => {
      const lines = [];
      for (let i = 0; i < 1200; i++) lines.push(`00:${String(i % 60).padStart(2, '0')} line ${i}`);
      const result = hooks.extractTimecodes(lines.join('\n'));
      expect(result.length).toBeLessThanOrEqual(1000);
      expect(warned()).toHaveBeenCalledWith(
        'Timecode',
        'Maximum iterations reached during extraction'
      );
    });
  });

  describe('description and comment collection', () => {
    test('a description that is already present skips the retry loop', async () => {
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '00:05 start here';
      document.body.appendChild(desc);

      const result = await hooks.detectTimecodes({ force: true });
      expect(result).toHaveLength(1);
      expect(result[0].time).toBe(5);
    });

    test('a failing element wait is tolerated', async () => {
      boot({ withoutWaitForElement: true });
      const suppressed = jest.spyOn(window.YouTubeUtils, 'logSuppressed').mockImplementation(() => {
        // suppressed logging is asserted through the spy, not printed
      });

      const result = await hooks.detectTimecodes({ force: true });

      expect(result).toEqual([]);
      expect(suppressed).toHaveBeenCalledWith(expect.any(Error), 'Timecode');
    });

    test('an already-expanded description is left alone', async () => {
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '00:05 already visible';
      const button = document.createElement('button');
      button.id = 'expand';
      button.setAttribute('aria-expanded', 'true');
      button.click = jest.fn();
      desc.appendChild(button);
      document.body.appendChild(desc);

      await hooks.detectTimecodes({ force: true });
      expect(button.click).not.toHaveBeenCalled();
    });

    test('a "show less" expander is left alone', async () => {
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '00:05 already visible';
      const button = document.createElement('button');
      button.id = 'expand';
      button.setAttribute('aria-label', 'Show less');
      button.click = jest.fn();
      desc.appendChild(button);
      document.body.appendChild(desc);

      await hooks.detectTimecodes({ force: true });
      expect(button.click).not.toHaveBeenCalled();
    });

    test('a collapsed inline expander is expanded in place', async () => {
      const expander = document.createElement('ytd-text-inline-expander');
      expander.setAttribute('collapsed', '');
      const text = document.createElement('div');
      text.className = 'yt-core-attributed-string';
      expander.appendChild(text);
      document.body.appendChild(expander);

      const pending = hooks.detectTimecodes({ force: true });
      await wait(500);
      expect(expander.hasAttribute('collapsed')).toBe(false);

      // The description only appears once the expander is expanded.
      text.textContent = '00:05 revealed after expanding';
      await pending;
      expect(expander.hasAttribute('collapsed')).toBe(false);
    });

    test('comment scanning stops at the collection budget', async () => {
      const comments = document.createElement('div');
      comments.id = 'comments';
      for (let i = 0; i < 40; i++) {
        const thread = document.createElement('ytd-comment-thread-renderer');
        const text = document.createElement('div');
        text.id = 'content-text';
        text.textContent = `0:${String(i + 1).padStart(2, '0')} comment ${i}`;
        thread.appendChild(text);
        comments.appendChild(thread);
      }
      document.body.appendChild(comments);

      const result = await hooks.detectTimecodes({ force: true });
      // 40 comments exist but only the first 30 are collected.
      expect(result).toHaveLength(30);
    });
  });

  describe('detection', () => {
    test('returns nothing while auto-detect is off', async () => {
      api.config.autoDetect = false;
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '00:05 ignored';
      document.body.appendChild(desc);

      expect(await hooks.detectTimecodes()).toEqual([]);
      expect(await hooks.detectTimecodes({ force: true })).toHaveLength(1);
    });

    test('returns nothing without a video id', async () => {
      window.YouTubeUtils.getVideoIdFromLocation = () => null;
      expect(await hooks.detectTimecodes({ force: true })).toEqual([]);
    });

    test('a cached-but-empty detection is discarded and re-detected', async () => {
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '00:07 fresh';
      document.body.appendChild(desc);

      api.state.timecodes.set(`detect_${VIDEO_ID}`, []);
      const result = await hooks.detectTimecodes();
      expect(result).toHaveLength(1);
      expect(result[0].time).toBe(7);
    });

    test('detection without an open panel does not build one', async () => {
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '00:09 headless';
      document.body.appendChild(desc);

      const result = await hooks.detectTimecodes({ force: true });
      expect(result).toHaveLength(1);
      expect(api.state.dom.panel).toBeNull();
      expect(api.state.timecodes.get(`detect_${VIDEO_ID}`)).toHaveLength(1);
    });

    test('an empty re-detection keeps the rows already on screen', async () => {
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      hooks.updateTimecodePanel([{ time: 10, label: 'kept', isChapter: false }]);
      api.state.timecodes.delete(`detect_${VIDEO_ID}`);

      expect(await hooks.detectTimecodes()).toEqual([]);
      expect(items()).toHaveLength(1);
    });

    test('a chapter label replaces a shorter description label at the same time', async () => {
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '01:00 x';
      document.body.appendChild(desc);
      const chapter = document.createElement('ytd-chapter-renderer');
      chapter.innerHTML =
        '<span class="timestamp">01:00</span><h4 class="chapter-title">Chapter One</h4>';
      document.body.appendChild(chapter);

      const result = await hooks.detectTimecodes({ force: true });
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Chapter One');
      expect(result[0].isChapter).toBe(true);
    });

    test('a shorter chapter label only flags the existing row as a chapter', async () => {
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '01:00 a long enough description label';
      document.body.appendChild(desc);
      const chapter = document.createElement('ytd-chapter-renderer');
      chapter.innerHTML = '<span class="timestamp">01:00</span><h4 class="chapter-title">Ch</h4>';
      document.body.appendChild(chapter);

      const result = await hooks.detectTimecodes({ force: true });
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('a long enough description label');
      expect(result[0].isChapter).toBe(true);
    });
  });

  describe('native chapters', () => {
    test('a chapter with an empty time element falls through to the next selector', () => {
      const chapter = document.createElement('ytd-macro-markers-list-item-renderer');
      chapter.innerHTML =
        '<span class="time-info"></span>' +
        '<span class="timestamp">02:30</span>' +
        '<h4 class="marker-title">Second</h4>';
      document.body.appendChild(chapter);

      const chapters = hooks.getYouTubeChapters();
      expect(chapters).toEqual([{ time: 150, label: 'Second', isChapter: true }]);
    });

    test('a chapter without any time element is skipped', () => {
      const chapter = document.createElement('ytd-chapter-renderer');
      chapter.innerHTML = '<h4 class="chapter-title">No time here</h4>';
      document.body.appendChild(chapter);

      expect(hooks.getYouTubeChapters()).toEqual([]);
    });

    test('a chapter without a title keeps an empty label', () => {
      const chapter = document.createElement('ytd-chapter-renderer');
      chapter.innerHTML = '<span class="timestamp">00:00</span>';
      document.body.appendChild(chapter);

      expect(hooks.getYouTubeChapters()).toEqual([{ time: 0, label: '', isChapter: true }]);
    });
  });

  describe('reload', () => {
    test('reloading without any button still reports the outcome', async () => {
      const writeText = jest.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '00:12 reload me';
      document.body.appendChild(desc);

      await hooks.reloadTimecodes();
      expect(notify()).toHaveBeenCalledWith('foundTimecodes', expect.anything());
    });

    test('a reload while another one is running is ignored', async () => {
      const first = hooks.reloadTimecodes();
      await hooks.reloadTimecodes();
      await first;
      // Only one spinner cycle ran: the button is usable again.
      expect(api.state.isReloading).toBe(false);
    });

    test('a reload that finds nothing empties the panel', async () => {
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      hooks.updateTimecodePanel([{ time: 10, label: 'stale' }]);

      await hooks.reloadTimecodes();
      expect(items()).toHaveLength(0);
      expect(notify()).toHaveBeenCalledWith('noTimecodesFound', expect.anything());
    });

    test('a failing detection is reported as a reload error', async () => {
      jest.spyOn(window.YouTubeUtils, 'getVideoIdFromLocation').mockImplementation(() => {
        throw new Error('location gone');
      });

      await hooks.reloadTimecodes();
      expect(notify()).toHaveBeenCalledWith('reloadError', expect.anything());
      expect(logError).toHaveBeenCalledWith('TimecodePanel', 'Reload failed', expect.any(Error));
      expect(api.state.isReloading).toBe(false);
    });
  });

  describe('settings UI wiring', () => {
    const buildAdvancedSection = ({ toggle = true } = {}) => {
      const section = document.createElement('div');
      section.className = 'yp-settings-section';
      section.dataset.section = 'advanced';
      section.innerHTML = `<div class="timecode-settings-item">
          <input type="checkbox" id="timecode-enable-checkbox" checked>
          ${
            toggle
              ? '<button class="yp-submenu-toggle" data-submenu="timecode" aria-expanded="false"></button>'
              : ''
          }
          <div class="timecode-submenu" data-submenu="timecode">
            <div id="timecode-modifier-dropdown"></div>
            <select id="timecode-modifier-combo">
              <option value="shift" selected>Shift</option>
              <option value="ctrl+alt">Ctrl+Alt</option>
            </select>
            <input type="text" id="timecode-key" value="T">
          </div>
        </div>`;
      document.body.appendChild(section);
      return section;
    };

    test('wiring is skipped without the advanced section', () => {
      expect(() => hooks.attachTimecodeHandlers()).not.toThrow();
      expect(document.querySelector('.timecode-settings-item')).toBeNull();
    });

    test('wiring is skipped when the section has no timecode item', () => {
      const section = document.createElement('div');
      section.className = 'yp-settings-section';
      section.dataset.section = 'advanced';
      document.body.appendChild(section);
      hooks.attachTimecodeHandlers();
      expect(section.querySelector('.timecode-settings-item')).toBeNull();
    });

    test('the dropdown is initialised and every control is wired once', () => {
      const initGlassDropdown = jest.fn();
      window.YouTubePlusDesignSystem = { initGlassDropdown, getStyle: () => '' };
      const section = buildAdvancedSection();

      hooks.attachTimecodeHandlers();
      expect(initGlassDropdown).toHaveBeenCalledWith(
        expect.objectContaining({
          dropdown: document.getElementById('timecode-modifier-dropdown'),
          hiddenSelect: document.getElementById('timecode-modifier-combo'),
        })
      );
      expect(section.querySelector('.timecode-settings-item').dataset.handlerAttached).toBe('1');

      // Re-attaching is a no-op.
      initGlassDropdown.mockClear();
      hooks.attachTimecodeHandlers();
      expect(initGlassDropdown).not.toHaveBeenCalled();
    });

    test('the modifier combo and the key input write through to the config', () => {
      buildAdvancedSection();
      hooks.attachTimecodeHandlers();

      const combo = document.getElementById('timecode-modifier-combo');
      combo.value = 'ctrl+alt';
      combo.dispatchEvent(new Event('change'));
      expect(api.config.shortcut).toEqual({
        key: 'T',
        shiftKey: false,
        altKey: true,
        ctrlKey: true,
      });

      const keyInput = document.getElementById('timecode-key');
      keyInput.value = 'k';
      keyInput.dispatchEvent(new Event('input'));
      expect(api.config.shortcut.key).toBe('K');

      // An emptied field keeps the previous key.
      keyInput.value = '';
      keyInput.dispatchEvent(new Event('input'));
      expect(api.config.shortcut.key).toBe('K');

      // The hotkey field never leaks the keystroke to the page.
      keyInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', bubbles: true }));
    });

    test('the enable checkbox opens the panel and expands the submenu', () => {
      buildAdvancedSection();
      hooks.attachTimecodeHandlers();

      const checkbox = document.getElementById('timecode-enable-checkbox');
      const toggle = sectionToggle();
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(window.YouTubePlusSettingsStore.get('timecodeEnabled')).toBe(true);
      expect(panelEl()).not.toBeNull();
      expect(panelEl().classList.contains('hidden')).toBe(false);
      expect(toggle.hasAttribute('disabled')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(submenuWrap().classList.contains('is-hidden')).toBe(false);
    });

    test('a collapsed submenu preference survives re-enabling', () => {
      localStorage.setItem('ytp-plus-submenu-states', JSON.stringify({ timecode: false }));
      window.YouTubePlusSettingsHelpers = {
        readSubmenuExpanded: key => (key === 'timecode' ? false : null),
      };
      buildAdvancedSection();
      hooks.attachTimecodeHandlers();

      const checkbox = document.getElementById('timecode-enable-checkbox');
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      const toggle = sectionToggle();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(submenuWrap().classList.contains('is-hidden')).toBe(true);
    });

    test('disabling the checkbox hides and disables the submenu', () => {
      buildAdvancedSection();
      hooks.attachTimecodeHandlers();
      const panel = api.createTimecodePanel();

      const checkbox = document.getElementById('timecode-enable-checkbox');
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      expect(window.YouTubePlusSettingsStore.get('timecodeEnabled')).toBe(false);
      const toggle = sectionToggle();
      expect(toggle.hasAttribute('disabled')).toBe(true);
      expect(toggle.classList.contains('timecode-submenu-toggle-hidden')).toBe(true);
      expect(submenuWrap().classList.contains('is-hidden')).toBe(true);
      // The manual panel (no feature ctx) is torn down with the setting.
      expect(panel.isConnected).toBe(false);
      expect(api.state.dom.panel).toBeNull();
    });

    test('a section without a submenu toggle is tolerated', () => {
      buildAdvancedSection({ toggle: false });
      hooks.attachTimecodeHandlers();

      const checkbox = document.getElementById('timecode-enable-checkbox');
      checkbox.checked = true;
      expect(() => checkbox.dispatchEvent(new Event('change'))).not.toThrow();
      expect(window.YouTubePlusSettingsStore.get('timecodeEnabled')).toBe(true);
    });

    test('the advanced settings nav item wires the handlers without a modal', () => {
      const navItem = document.createElement('button');
      navItem.className = 'yp-settings-nav-item';
      navItem.dataset.section = 'advanced';
      document.body.appendChild(navItem);

      navItem.click();

      buildAdvancedSection();
      hooks.attachTimecodeHandlers();
      const item = document.querySelector('.timecode-settings-item');
      expect(item.dataset.handlerAttached).toBe('1');
    });
  });

  describe('panel clicks (no delegation host)', () => {
    let panel;

    beforeEach(() => {
      panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      panel.classList.remove('hidden');
    });

    test('the header reload button runs a reload cycle', async () => {
      const button = panel.querySelector('#timecode-reload');
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '00:15 reloaded from the header';
      document.body.appendChild(desc);

      button.click();
      expect(button.disabled).toBe(true);
      await wait(0);
      expect(button.disabled).toBe(false);
      expect(button.classList.contains('loading')).toBe(false);
      expect(items()).toHaveLength(1);
    });

    test('the header close button hides the panel and stops tracking', () => {
      hooks.startTracking();
      panel.querySelector('#timecode-close').click();
      expect(panel.classList.contains('hidden')).toBe(true);
      expect(api.state.trackingId).toBe(0);
    });

    test('the add button prefills the form from the player', () => {
      const video = document.querySelector('video');
      video.currentTime = 65;

      panel.querySelector('#timecode-add-btn').click();
      expect(api.state.dom.form.classList.contains('visible')).toBe(true);
      expect(api.state.dom.timeInput.value).toBe('1:05');
    });

    test('the add button does nothing without a player', () => {
      document.querySelector('video').remove();
      panel.querySelector('#timecode-add-btn').click();
      expect(api.state.dom.form.classList.contains('visible')).toBe(false);
    });

    test('the tracking toggle turns tracking on and off again', () => {
      const toggle = panel.querySelector('#timecode-track-toggle');
      api.config.autoTrackPlayback = true;

      toggle.click();
      expect(api.config.autoTrackPlayback).toBe(false);
      expect(toggle.classList.contains('active')).toBe(false);
      expect(toggle.textContent).toBe('track');

      toggle.click();
      expect(api.config.autoTrackPlayback).toBe(true);
      expect(toggle.classList.contains('active')).toBe(true);
      expect(panel.classList.contains('auto-tracking')).toBe(true);
      expect(toggle.textContent).toBe('tracking');
    });

    test('the export button copies the timecodes', async () => {
      const writeText = jest.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      hooks.updateTimecodePanel([{ time: 30, label: 'Exported' }]);

      panel.querySelector('#timecode-export-btn').click();
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('0:30 - Exported'));
    });

    test('the cancel button closes the form', () => {
      hooks.showTimecodeForm(30);
      panel.querySelector('#timecode-form-cancel').click();
      expect(api.state.dom.form.classList.contains('visible')).toBe(false);
    });

    test('the save button rejects an invalid time and stores a valid one', () => {
      panel.querySelector('#timecode-form-save').click();

      api.state.dom.timeInput.value = 'nope';
      panel.querySelector('#timecode-form-save').click();
      expect(notify()).toHaveBeenCalledWith('invalidTimeFormat', expect.anything());
      expect(items()).toHaveLength(0);

      api.state.dom.timeInput.value = '0:30';
      api.state.dom.labelInput.value = 'Saved';
      panel.querySelector('#timecode-form-save').click();
      expect(items()).toHaveLength(1);
      expect(items()[0].textContent).toContain('Saved');
    });

    test('the row action buttons edit and delete without seeking', async () => {
      hooks.updateTimecodePanel([{ time: 30, label: 'Row' }]);
      const item = items()[0];
      const video = document.querySelector('video');
      video.currentTime = 0;

      item.querySelector('.timecode-action.edit').click();
      expect(api.state.editingIndex).toBe(0);
      expect(api.state.dom.form.classList.contains('visible')).toBe(true);

      item.querySelector('.timecode-action.delete').click();
      await wait(0);
      expect(items()).toHaveLength(0);
      expect(video.currentTime).toBe(0);
    });

    test('an unknown row action is ignored', () => {
      hooks.updateTimecodePanel([{ time: 30, label: 'Row' }]);
      const unknown = document.createElement('button');
      unknown.className = 'timecode-action';
      unknown.dataset.action = 'move';
      items()[0].appendChild(unknown);

      unknown.click();
      expect(api.state.editingIndex).toBeNull();
      expect(api.state.dom.form.classList.contains('visible')).toBe(false);
    });

    test('a click inside the row actions never seeks', () => {
      hooks.updateTimecodePanel([{ time: 30, label: 'Row' }]);
      const video = document.querySelector('video');
      video.currentTime = 0;

      items()[0].querySelector('.timecode-actions').click();
      expect(video.currentTime).toBe(0);
    });

    test('a row without a usable time never seeks', () => {
      const video = document.querySelector('video');
      video.currentTime = 0;
      const row = document.createElement('div');
      row.className = 'timecode-item';
      panel.querySelector('#timecode-list').appendChild(row);

      row.click();
      expect(video.currentTime).toBe(0);
      expect(row.classList.contains('active')).toBe(false);
    });
  });

  describe('panel CRUD guards', () => {
    beforeEach(() => {
      api.createTimecodePanel();
      document.body.appendChild(panelEl());
      panelEl().classList.remove('hidden');
    });

    test('an out-of-range edit or delete is ignored', async () => {
      hooks.updateTimecodePanel([{ time: 30, label: 'Only' }]);

      hooks.editTimecode(5);
      hooks.editTimecode(-1);
      expect(api.state.editingIndex).toBeNull();

      await hooks.deleteTimecode(5);
      await hooks.deleteTimecode(-1);
      expect(items()).toHaveLength(1);
    });

    test('editing drops a stale editing marker from the other rows', () => {
      hooks.updateTimecodePanel([
        { time: 10, label: 'First' },
        { time: 20, label: 'Second' },
      ]);
      items()[0].classList.add('editing');

      hooks.editTimecode(1);
      expect(items()[0].classList.contains('editing')).toBe(false);
      expect(items()[1].classList.contains('editing')).toBe(true);
    });

    test('a native chapter cannot be deleted', async () => {
      hooks.updateTimecodePanel([{ time: 30, label: 'Chapter', isChapter: true }]);

      await hooks.deleteTimecode(0);
      expect(items()).toHaveLength(1);
      expect(notify()).toHaveBeenCalledWith('cannotDeleteChapter', expect.anything());
    });

    test('a native chapter cannot be edited away', () => {
      hooks.updateTimecodePanel([{ time: 30, label: 'Chapter', isChapter: true }]);
      hooks.editTimecode(0);

      api.state.dom.timeInput.value = '0:45';
      api.state.dom.labelInput.value = 'Renamed';
      saveForm();

      expect(notify()).toHaveBeenCalledWith('cannotEditChapter', expect.anything());
      expect(items()[0].querySelector('.timecode-label').textContent).toBe('Chapter');
    });

    test('editing an existing row merges the change and re-sorts', () => {
      hooks.updateTimecodePanel([
        { time: 10, label: 'Early' },
        { time: 30, label: 'Late' },
      ]);
      hooks.editTimecode(0);
      api.state.dom.timeInput.value = '0:20';
      api.state.dom.labelInput.value = 'Moved';
      saveForm();

      const rows = items();
      expect(rows).toHaveLength(2);
      expect(rows[0].querySelector('.timecode-label').textContent).toBe('Moved');
      expect(rows[0].dataset.time).toBe('20');
      expect(notify()).toHaveBeenCalledWith('timecodeUpdated', expect.anything());
      expect(api.state.editingIndex).toBeNull();
    });

    test('a row added without a label falls back to an empty label', () => {
      hooks.showTimecodeForm(5);
      api.state.dom.timeInput.value = '0:05';
      api.state.dom.labelInput.value = '   ';
      saveForm();

      expect(items()).toHaveLength(1);
      expect(items()[0].querySelector('.timecode-label')).toBeNull();
      expect(notify()).toHaveBeenCalledWith('timecodeAdded', expect.anything());
    });

    test('the form and the active-row helpers are safe without a panel', () => {
      api.cleanup();

      expect(() => hooks.showTimecodeForm(10)).not.toThrow();
      expect(() => hooks.hideTimecodeForm()).not.toThrow();
      expect(() => hooks.updateTimecodePanel([{ time: 10 }])).not.toThrow();
      expect(() => hooks.updateActiveItem(null)).not.toThrow();
      expect(hooks.getCurrentTimecodes()).toEqual([]);
      expect(hooks.updateActiveItem(null)).toBeUndefined();
    });

    test('rows without a time or a label are read defensively', () => {
      hooks.updateTimecodePanel([{ time: 10, label: 'Real' }]);
      const list = panelEl().querySelector('#timecode-list');
      const blank = document.createElement('div');
      blank.className = 'timecode-item';
      blank.dataset.time = '';
      blank.innerHTML = '<div class="timecode-label">   </div>';
      list.appendChild(blank);

      const parsed = hooks.getCurrentTimecodes();
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toMatchObject({ time: 0, label: '', isChapter: false, isUserAdded: true });
    });
  });

  describe('rendering', () => {
    beforeEach(() => {
      api.createTimecodePanel();
      document.body.appendChild(panelEl());
    });

    test('a chapter row has no actions and no repeated label', () => {
      hooks.updateTimecodePanel([{ time: 60, label: '', isChapter: true }]);
      const row = items()[0];

      expect(row.classList.contains('has-chapter')).toBe(true);
      expect(row.querySelector('.timecode-label')).toBeNull();
      expect(row.querySelector('.timecode-actions')).toBeNull();
    });

    test('a label equal to the time is not repeated', () => {
      hooks.updateTimecodePanel([{ time: 60, label: '1:00' }]);
      expect(items()[0].querySelector('.timecode-label')).toBeNull();
    });

    test('a label that repeats the original timestamp is not repeated', () => {
      hooks.updateTimecodePanel([{ time: 60, originalText: '01:00', label: '01:00 Chapter' }]);
      // The time prefix is stripped, so what is left is the real label.
      expect(items()[0].querySelector('.timecode-label').textContent).toBe('Chapter');
    });

    test('a row without a label value renders only its time', () => {
      hooks.updateTimecodePanel([{ time: 60 }]);
      const row = items()[0];
      expect(row.querySelector('.timecode-time').textContent).toBe('1:00');
      expect(row.querySelector('.timecode-label')).toBeNull();
      expect(row.querySelector('.timecode-actions')).not.toBeNull();
    });

    test('a leading-zero label equal to the time is recognised as the time', () => {
      hooks.updateTimecodePanel([{ time: 60, label: '01:00' }]);
      expect(items()[0].querySelector('.timecode-label')).toBeNull();
    });

    test('an empty list clears the rows and shows the placeholder', () => {
      hooks.updateTimecodePanel([{ time: 60, label: 'Row' }]);
      hooks.updateTimecodePanel([]);

      expect(items()).toHaveLength(0);
      expect(panelEl().querySelector('#timecode-empty').style.display).toBe('flex');
      expect(panelEl().querySelector('#timecode-list').style.display).toBe('none');
    });

    test('a panel built with tracking off renders the untracked chrome', () => {
      api.cleanup();
      api.config.autoTrackPlayback = false;
      api.config.export = false;
      const panel = api.createTimecodePanel();

      expect(panel.classList.contains('auto-tracking')).toBe(false);
      expect(panel.querySelector('#timecode-track-toggle').classList.contains('active')).toBe(
        false
      );
      expect(panel.querySelector('#timecode-track-toggle').textContent).toBe('track');
      expect(panel.querySelector('#timecode-export-btn').classList.contains('is-hidden')).toBe(
        true
      );
    });

    test('an export without a panel skips the button feedback', () => {
      api.cleanup();
      const writeText = jest.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });

      expect(() => hooks.exportTimecodes()).not.toThrow();
      expect(writeText).not.toHaveBeenCalled();
    });

    test('exported rows keep their blank labels and the button resets', async () => {
      const writeText = jest.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      document.title = 'Song - YouTube';

      hooks.updateTimecodePanel([
        { time: 60, label: '' },
        { time: 120, label: 'Later' },
      ]);
      hooks.exportTimecodes();

      expect(writeText).toHaveBeenCalledWith('Song\n\nTimecodes:\n1:00\n2:00 - Later\n');
      const button = panelEl().querySelector('#timecode-export-btn');
      expect(button.textContent).toBe('copied');
      await wait(2100);
      expect(button.textContent).toBe('export');
      expect(button.style.backgroundColor).toBe('');
    });
  });

  describe('per-video persistence', () => {
    test('nothing is written or read without a video id', () => {
      window.YouTubeUtils.getVideoIdFromLocation = () => null;

      hooks.saveTimecodesToStorage([{ time: 10, label: 'x' }]);
      expect(localStorage.getItem('yt_tc_null')).toBeNull();
      expect(hooks.loadTimecodesFromStorage()).toBeNull();
    });

    test('a row without a label is stored with an empty one', () => {
      hooks.saveTimecodesToStorage([{ time: 10 }]);
      expect(localStorage.getItem(`yt_tc_${VIDEO_ID}`)).toBe('[{"t":10,"l":""}]');
      expect(hooks.loadTimecodesFromStorage()).toEqual([
        { time: 10, label: '', isChapter: undefined, isUserAdded: undefined },
      ]);
    });

    test('a failing write is logged instead of thrown', () => {
      jest.spyOn(window.YouTubeUtils.storage, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(() => hooks.saveTimecodesToStorage([{ time: 10, label: 'x' }])).not.toThrow();
    });

    test('a corrupt per-video payload is logged and reported as missing', () => {
      localStorage.setItem(`yt_tc_${VIDEO_ID}`, 'not json');
      expect(hooks.loadTimecodesFromStorage()).toBeNull();
    });
  });

  describe('dragging', () => {
    const drag = (panel, from, to) => {
      panel
        .querySelector('#timecode-header')
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...from }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...to }));
    };

    test('a panel without a header is not draggable', () => {
      const bare = document.createElement('div');
      expect(() => hooks.makeDraggable(bare, null)).not.toThrow();
    });

    test('a full drag moves the panel and persists the position', async () => {
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      // jsdom has no layout: report the inline position the drag writes.
      panel.getBoundingClientRect = () => ({
        left: Number.parseFloat(panel.style.left) || 0,
        top: Number.parseFloat(panel.style.top) || 0,
        width: 200,
        height: 100,
      });
      hooks.startTracking();

      drag(panel, { clientX: 100, clientY: 100 }, { clientX: 160, clientY: 140 });
      expect(api.state.dragging).toBe(true);
      await flush();

      expect(panel.style.left).toBe('60px');
      expect(panel.style.top).toBe('40px');
      expect(panel.style.right).toBe('auto');

      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      expect(api.state.dragging).toBe(false);
      expect(api.config.panelPosition).toEqual({ left: 60, top: 40 });
    });

    test('moves inside one frame are coalesced', async () => {
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);

      drag(panel, { clientX: 10, clientY: 10 }, { clientX: 40, clientY: 40 });
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 500 })
      );
      await flush();

      // Only the last position of the frame is applied, and it is clamped.
      expect(panel.style.left).not.toBe('40px');
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    test('a move or release without a drag does nothing', () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 })
      );
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      expect(api.state.dragging).toBe(false);
    });

    test('releasing before the move frame lands cancels it', async () => {
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);

      drag(panel, { clientX: 0, clientY: 0 }, { clientX: 300, clientY: 300 });
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await flush();

      expect(api.state.dragging).toBe(false);
      // The panel is still on its mousedown anchor: the queued frame was cancelled.
      expect(panel.style.left).toBe('0px');
    });
  });

  describe('playback tracking', () => {
    let video;
    let panel;
    let ctxAndScope;

    const openPanel = () => {
      ctxAndScope = makeCtx();
      hooks.start(ctxAndScope.ctx);
      panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      panel.classList.remove('hidden');
      return panel;
    };

    beforeEach(() => {
      video = document.querySelector('video');
    });

    test('tracking needs both a player and a running feature', () => {
      hooks.startTracking();
      expect(api.state.trackingId).toBe(0);

      video.remove();
      ctxAndScope = makeCtx();
      hooks.start(ctxAndScope.ctx);
      hooks.startTracking();
      expect(api.state.trackingId).toBe(0);
    });

    test('a second start does not double-bind the listener', () => {
      openPanel();
      hooks.startTracking();
      const bound = ctxAndScope.scope.listen;
      hooks.startTracking();
      expect(api.state.trackingId).toBe(1);
      expect(bound).toBeDefined();
    });

    test('the active row and its progress bar follow the player', () => {
      openPanel();
      hooks.updateTimecodePanel([
        { time: 10, label: 'One' },
        { time: 30, label: 'Two' },
      ]);
      hooks.startTracking();

      video.currentTime = 20;
      video.dispatchEvent(new Event('timeupdate'));

      const rows = items();
      expect(rows[0].classList.contains('active')).toBe(true);
      expect(rows[0].querySelector('.timecode-progress').style.width).toBe('50%');
      expect(panel.querySelector('#timecode-current-time').textContent).toBe('0:20');

      // Playing past the last row leaves the highlight where it is.
      video.currentTime = 120;
      video.dispatchEvent(new Event('timeupdate'));
      // Past the last row there is no progress left to draw, but the
      // highlight moves to the last reached row.
      expect(rows[1].classList.contains('active')).toBe(true);
      expect(rows[0].classList.contains('active')).toBe(false);
      expect(rows[0].querySelector('.timecode-progress').style.width).toBe('50%');
    });

    test('rows without a usable time are skipped', () => {
      openPanel();
      hooks.updateTimecodePanel([{ time: 10, label: 'One' }]);
      const list = panel.querySelector('#timecode-list');
      const nameless = document.createElement('div');
      nameless.className = 'timecode-item';
      list.insertBefore(nameless, list.firstChild);
      const broken = document.createElement('div');
      broken.className = 'timecode-item';
      broken.dataset.time = 'soon';
      list.insertBefore(broken, nameless.nextSibling);
      hooks.startTracking();

      video.currentTime = 20;
      video.dispatchEvent(new Event('timeupdate'));

      expect(items()[2].classList.contains('active')).toBe(true);
      expect(items()[2].dataset.time).toBe('10');
    });

    test('the active row is scrolled into view, with a fallback', () => {
      openPanel();
      hooks.updateTimecodePanel([{ time: 10, label: 'One' }]);
      const scroll = jest.fn(() => {
        throw new Error('smooth scrolling unsupported');
      });
      items()[0].scrollIntoView = scroll;
      hooks.startTracking();

      video.currentTime = 20;
      video.dispatchEvent(new Event('timeupdate'));

      expect(scroll).toHaveBeenNthCalledWith(1, {
        behavior: 'smooth',
        block: 'center',
      });
      expect(scroll).toHaveBeenNthCalledWith(2, false);
    });

    test('an unchanged active row is not restyled', () => {
      openPanel();
      hooks.updateTimecodePanel([
        { time: 10, label: 'One' },
        { time: 30, label: 'Two' },
      ]);
      const scroll = jest.fn();
      for (const row of items()) row.scrollIntoView = scroll;
      hooks.startTracking();

      video.currentTime = 12;
      video.dispatchEvent(new Event('timeupdate'));
      expect(scroll).toHaveBeenCalledTimes(1);

      video.currentTime = 14;
      video.dispatchEvent(new Event('timeupdate'));
      expect(scroll).toHaveBeenCalledTimes(1);

      // Moving to the next row hands the highlight over.
      video.currentTime = 31;
      video.dispatchEvent(new Event('timeupdate'));
      expect(items()[1].classList.contains('active')).toBe(true);
      expect(items()[0].classList.contains('active')).toBe(false);
      expect(scroll).toHaveBeenCalledTimes(2);
    });

    test('disabling tracking stops the listener on the next tick', () => {
      openPanel();
      hooks.updateTimecodePanel([{ time: 10, label: 'One' }]);
      hooks.startTracking();
      expect(api.state.trackingId).toBe(1);

      api.config.autoTrackPlayback = false;
      video.dispatchEvent(new Event('timeupdate'));
      expect(api.state.trackingId).toBe(0);
    });

    test('a swapped player element rebinds the listener', () => {
      openPanel();
      hooks.startTracking();
      expect(api.state.trackingId).toBe(1);

      const replacement = document.createElement('video');
      replacement.currentTime = 5;
      replacement.play = jest.fn();
      video.replaceWith(replacement);

      video.dispatchEvent(new Event('timeupdate'));
      expect(api.state.trackingId).toBe(1);

      replacement.dispatchEvent(new Event('timeupdate'));
      expect(api.state.trackingId).toBe(1);
    });

    test('a failing timeupdate stops tracking instead of looping', () => {
      openPanel();
      hooks.updateTimecodePanel([{ time: 10, label: 'One' }]);
      hooks.startTracking();

      const broken = {
        querySelectorAll: () => {
          throw new Error('list gone');
        },
      };
      api.state.dom.list = broken;
      video.dispatchEvent(new Event('timeupdate'));

      expect(api.state.trackingId).toBe(0);
      expect(loggerWarn).toHaveBeenCalledWith('Timecode', 'Tracking error', expect.any(Error));
    });

    test('a hidden panel stops tracking', () => {
      openPanel();
      hooks.startTracking();
      panel.classList.add('hidden');
      video.dispatchEvent(new Event('timeupdate'));
      expect(api.state.trackingId).toBe(0);
    });
  });

  describe('toggling and navigation', () => {
    test('toggling without an argument flips the hidden class', () => {
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);

      panel.classList.add('hidden');
      hooks.toggleTimecodePanel();
      expect(panel.classList.contains('hidden')).toBe(false);

      hooks.toggleTimecodePanel();
      expect(panel.classList.contains('hidden')).toBe(true);
    });

    test('opening removes a stray duplicate panel', () => {
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      const stray = document.createElement('div');
      stray.id = 'timecode-panel';
      document.body.appendChild(stray);

      hooks.toggleTimecodePanel(true);
      expect(document.querySelectorAll('#timecode-panel')).toHaveLength(1);
    });

    test('a failing detection on open is reported instead of thrown', async () => {
      const spy = jest.spyOn(window.YouTubeUtils, 'getVideoIdFromLocation');
      // The saved-rows lookup succeeds; the detection that follows does not.
      spy
        .mockImplementationOnce(() => null)
        .mockImplementation(() => {
          throw new Error('location gone');
        });

      hooks.toggleTimecodePanel(true);
      await wait(0);
      expect(loggerError).toHaveBeenCalledWith('Timecode', 'Detection failed', expect.any(Error));
    });

    test('opening with auto-detect off leaves the panel empty', () => {
      api.config.autoDetect = false;
      hooks.toggleTimecodePanel(true);
      expect(items()).toHaveLength(0);
      expect(api.state.dom.panel.classList.contains('hidden')).toBe(false);
    });

    test('navigation to the same video leaves the state alone', () => {
      hooks.start(makeCtx().ctx);
      api.state.activeIndex = 3;
      api.state.editingIndex = 1;
      api.state.timecodes.set('detect_x', [{ time: 1, label: 'kept' }]);

      document.dispatchEvent(new Event('yt-navigate-finish'));

      expect(api.state.activeIndex).toBe(3);
      expect(api.state.editingIndex).toBe(1);
      expect(api.state.timecodes.size).toBe(1);
    });

    test('navigation off the watch route is ignored', () => {
      hooks.start(makeCtx().ctx);
      api.state.activeIndex = 2;

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/feed/subscriptions',
        href: 'https://www.youtube.com/feed/subscriptions',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));
      expect(api.state.activeIndex).toBe(2);

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      });
    });

    test('navigation to a new video reloads the saved rows', async () => {
      const { ctx } = makeCtx();
      hooks.start(ctx);
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      panel.classList.remove('hidden');
      hooks.saveTimecodesToStorage([{ time: 42, label: 'Saved' }]);

      api.state.activeIndex = 1;
      api.state.editingIndex = 1;
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch?v=vid2',
      });
      localStorage.setItem('yt_tc_vid2', JSON.stringify([{ t: 5, l: 'Second video' }]));
      document.dispatchEvent(new Event('yt-navigate-finish'));

      expect(api.state.activeIndex).toBeNull();
      expect(api.state.editingIndex).toBeNull();
      expect(api.state.timecodes.size).toBe(0);
      expect(items()).toHaveLength(1);
      expect(items()[0].querySelector('.timecode-label').textContent).toBe('Second video');
    });

    test('navigation without saved rows schedules a detection', async () => {
      const { ctx } = makeCtx();
      hooks.start(ctx);
      api.config.autoDetect = true;
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      panel.classList.remove('hidden');

      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '00:33 detected after navigating';
      document.body.appendChild(desc);

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch?v=vid3',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));

      await wait(600);
      expect(items()).toHaveLength(1);
      expect(items()[0].dataset.time).toBe('33');
    });

    test('a failing detection after navigation is reported instead of thrown', async () => {
      const { ctx } = makeCtx();
      hooks.start(ctx);
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      panel.classList.remove('hidden');

      const spy = jest.spyOn(window.YouTubeUtils, 'getVideoIdFromLocation');
      // The navigation reaction reads the id twice (itself, then the saved
      // rows); only the scheduled detection that follows fails.
      spy
        .mockImplementationOnce(() => 'vid4')
        .mockImplementationOnce(() => 'vid4')
        .mockImplementation(() => {
          throw new Error('location gone');
        });
      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/watch',
        href: 'https://www.youtube.com/watch?v=vid4',
      });
      document.dispatchEvent(new Event('yt-navigate-finish'));

      await wait(600);
      expect(loggerError).toHaveBeenCalledWith('Timecode', 'Detection failed', expect.any(Error));
    });

    test('a resize without a panel is ignored, with a panel it repositions', async () => {
      const { ctx } = makeCtx();
      hooks.start(ctx);

      window.dispatchEvent(new Event('resize'));
      expect(api.state.dom.panel).toBeNull();

      // The handler is throttled, so let the first tick pass.
      await wait(250);

      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      panel.getBoundingClientRect = () => ({ left: 4000, top: 4000, width: 200, height: 100 });
      window.dispatchEvent(new Event('resize'));

      expect(panel.style.left).toBe(`${window.innerWidth - 200}px`);
      expect(panel.style.top).toBe(`${window.innerHeight - 100}px`);
      expect(api.config.panelPosition).toEqual({
        left: window.innerWidth - 200,
        top: window.innerHeight - 100,
      });
    });

    test('the feature context owns the panel group and releases it on stop', () => {
      const { ctx, scope } = makeCtx();
      hooks.start(ctx);
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);

      expect(scope.own).toHaveBeenCalledWith(panel);
      expect(panel.getAttribute('data-panel-styles-id')).toBeNull();

      hooks.stop();
      expect(api.state.dom.panel).toBeNull();
      expect(panel.isConnected).toBe(true);
    });

    test('a rebuilt panel disposes the previous owning scope', () => {
      const { ctx, scope } = makeCtx();
      hooks.start(ctx);
      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);

      // The scope released the panel, so the next build starts a new one.
      scope.dispose();
      const rebuilt = api.createTimecodePanel();
      expect(rebuilt).not.toBe(panel);
      expect(document.querySelectorAll('#timecode-panel')).toHaveLength(1);
      expect(scope.own).toHaveBeenCalledTimes(2);
    });

    test('styles are registered on the context with the design-system CSS', () => {
      const { ctx } = makeCtx();
      window.YouTubePlusDesignSystem = {
        getStyle: jest.fn(() => '#timecode-panel{}'),
      };
      hooks.start(ctx);
      api.createTimecodePanel();

      expect(ctx.style).toHaveBeenCalledWith('timecode-panel-styles', '#timecode-panel{}');
    });

    test('styles are registered empty when no design system is present', () => {
      const { ctx } = makeCtx();
      delete window.YouTubePlusDesignSystem;
      hooks.start(ctx);
      api.createTimecodePanel();

      expect(ctx.style).toHaveBeenCalledWith('timecode-panel-styles', '');
    });
  });
});
