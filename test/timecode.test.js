/**
 * @jest-environment jsdom
 *
 * Tests the real timecode.js module surface through window.YouTubePlusTimecode.
 * Exercises actual time parsing, token extraction, timestamp stripping,
 * time formatting, and panel generation against real module logic.
 */

describe('Timecode Module (real API)', () => {
  const loadRealDeps = () => {
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/settings-store.js');
    require('../src/safe-dom.js');
    require('../src/i18n.js');
    require('../src/design-system.js');
  };

  const setupTimecodeDeps = () => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    window._ytplusCreateHTML = s => s;
    window._timecodeModuleInitialized = false;

    loadRealDeps();

    const utils = window.YouTubeUtils;
    utils.confirmDialog = jest.fn(() => Promise.resolve(true));
    utils.NotificationManager = { show: jest.fn() };
    utils.createIsRelevantRoute = jest.fn(() => () => true);
    utils.whenRelevant = jest.fn(({ onEnter }) => onEnter());
    jest.spyOn(utils, 't');

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
  };

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusTimecode;
    delete window._timecodeModuleInitialized;

    setupTimecodeDeps();
    require('../src/timecode.js');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('exposes the real API facade on window.YouTubePlusTimecode', () => {
    expect(window.YouTubePlusTimecode).toBeDefined();
    expect(typeof window.YouTubePlusTimecode.parseTime).toBe('function');
    expect(typeof window.YouTubePlusTimecode.parseLeadingTimestampToken).toBe('function');
    expect(typeof window.YouTubePlusTimecode.stripLeadingTimePrefix).toBe('function');
    expect(typeof window.YouTubePlusTimecode.formatTime).toBe('function');
    expect(typeof window.YouTubePlusTimecode.createTimecodePanel).toBe('function');
    expect(window.YouTubePlusTimecode.config).toBeDefined();
  });

  describe('parseTime (real API)', () => {
    test('parses standard timestamp strings into seconds accurately', () => {
      const { parseTime } = window.YouTubePlusTimecode;

      expect(parseTime('1:05')).toBe(65);
      expect(parseTime('01:05')).toBe(65);
      expect(parseTime('1:00:00')).toBe(3600);
      expect(parseTime('0:30')).toBe(30);
      expect(parseTime('00:30')).toBe(30);
    });

    test('handles invalid inputs safely returning null', () => {
      const { parseTime } = window.YouTubePlusTimecode;

      expect(parseTime('invalid')).toBeNull();
      expect(parseTime('')).toBeNull();
      expect(parseTime(null)).toBeNull();
      expect(parseTime(undefined)).toBeNull();
    });
  });

  describe('parseLeadingTimestampToken & stripLeadingTimePrefix (real API)', () => {
    test('extracts leading timestamp and strips delimiters', () => {
      const { parseLeadingTimestampToken, stripLeadingTimePrefix } = window.YouTubePlusTimecode;

      const parsed = parseLeadingTimestampToken('12:34 Introduction to topic');
      expect(parsed).toBeDefined();
      expect(parsed?.token).toBe('12:34');

      const stripped = stripLeadingTimePrefix('12:34 - Introduction to topic');
      expect(stripped).toBe('Introduction to topic');
    });

    test('leaves non-timestamp text unchanged', () => {
      const { stripLeadingTimePrefix } = window.YouTubePlusTimecode;
      expect(stripLeadingTimePrefix('No timestamp here')).toBe('No timestamp here');
    });
  });

  describe('createTimecodePanel (real API)', () => {
    test('builds timecode panel element with correct attributes and classes', () => {
      const { createTimecodePanel } = window.YouTubePlusTimecode;

      const panel = createTimecodePanel();
      expect(panel).toBeDefined();
      expect(panel.id).toBe('timecode-panel');
    });

    test('panel structure matches config defaults and caches dom refs', () => {
      const { createTimecodePanel, state } = window.YouTubePlusTimecode;

      const panel = createTimecodePanel();
      // config defaults: enabled/autoTrackPlayback/export all true
      expect(panel.classList.contains('hidden')).toBe(false);
      expect(panel.classList.contains('auto-tracking')).toBe(true);
      for (const id of [
        'timecode-header',
        'timecode-list',
        'timecode-empty',
        'timecode-form',
        'timecode-form-time',
        'timecode-form-label',
        'timecode-actions',
        'timecode-add-btn',
        'timecode-export-btn',
        'timecode-track-toggle',
      ]) {
        expect(panel.querySelector(`#${id}`)).not.toBeNull();
      }
      // export enabled by default -> button not hidden; tracking active by default
      expect(panel.querySelector('#timecode-export-btn').classList.contains('is-hidden')).toBe(
        false
      );
      expect(panel.querySelector('#timecode-track-toggle').classList.contains('active')).toBe(true);
      expect(state.dom.panel).toBe(panel);
      expect(state.dom.list).toBe(panel.querySelector('#timecode-list'));
    });

    test('createTimecodePanel is idempotent (returns the cached panel)', () => {
      const { createTimecodePanel } = window.YouTubePlusTimecode;

      const first = createTimecodePanel();
      const second = createTimecodePanel();
      expect(second).toBe(first);
      expect(document.querySelectorAll('#timecode-panel')).toHaveLength(1);
    });
  });

  describe('parseTime boundary cases (real API)', () => {
    test('accepts the full 24-hour range and trims whitespace', () => {
      const { parseTime } = window.YouTubePlusTimecode;
      expect(parseTime('24:00:00')).toBe(86400);
      expect(parseTime('  1:05  ')).toBe(65);
      expect(parseTime('1:5:06')).toBe(3906);
    });

    test('rejects out-of-range or malformed values', () => {
      const { parseTime } = window.YouTubePlusTimecode;
      expect(parseTime('24:00:01')).toBeNull(); // > 86400 sanity limit
      expect(parseTime('100:00:00')).toBeNull(); // > 24h
      expect(parseTime('75:30')).toBeNull(); // minutes >= 60
      expect(parseTime('9:99')).toBeNull(); // seconds >= 60
      expect(parseTime('12:34:56.7')).toBeNull(); // fractional seconds unsupported
      expect(parseTime('a:12')).toBeNull(); // non-numeric hour
      expect(parseTime('1234567890123:45')).toBeNull(); // > 12 chars sanity limit
    });
  });

  describe('formatTime delegation (real API)', () => {
    test('delegates to YouTubeUtils.formatTime', () => {
      const { formatTime } = window.YouTubePlusTimecode;
      window.YouTubeUtils.formatTime = jest.fn(() => '<fmt>');

      expect(formatTime(65)).toBe('<fmt>');
      expect(window.YouTubeUtils.formatTime).toHaveBeenCalledWith(65);
    });

    test("falls back to '0:00' when the delegate is missing or falsy", () => {
      const { formatTime } = window.YouTubePlusTimecode;

      delete window.YouTubeUtils.formatTime;
      expect(formatTime(65)).toBe('0:00');

      window.YouTubeUtils.formatTime = () => '';
      expect(formatTime(65)).toBe('0:00');
    });
  });

  describe('parseLeadingTimestampToken strictness (real API)', () => {
    test('parses HH:MM:SS tokens with exact-length components', () => {
      const { parseLeadingTimestampToken } = window.YouTubePlusTimecode;
      expect(parseLeadingTimestampToken('12:34:56 rest')).toEqual({
        token: '12:34:56',
        length: 8,
      });
    });

    test('requires exactly two digits for minutes and seconds', () => {
      const { parseLeadingTimestampToken } = window.YouTubePlusTimecode;
      expect(parseLeadingTimestampToken('1:05 x')).toBeDefined(); // 2-digit minutes OK
      expect(parseLeadingTimestampToken('1:5 x')).toBeNull(); // single-digit minutes rejected
      expect(parseLeadingTimestampToken('12:345')).toBeNull(); // 3-digit seconds rejected
      expect(parseLeadingTimestampToken('12:')).toBeNull(); // truncated
    });

    test('returns null for empty or non-timestamp input', () => {
      const { parseLeadingTimestampToken } = window.YouTubePlusTimecode;
      expect(parseLeadingTimestampToken('')).toBeNull();
      expect(parseLeadingTimestampToken(null)).toBeNull();
      expect(parseLeadingTimestampToken('no digits here')).toBeNull();
    });
  });

  describe('stripLeadingTimePrefix delimiters (real API)', () => {
    test.each([
      ['12:34 - Intro', 'Intro'],
      ['12:34–X', 'X'],
      ['12:34—X', 'X'],
      ['12:34 X', 'X'],
      ['12:34 - - X', '- X'],
      // A colon right after MM:SS starts an (empty) seconds component, so
      // the whole token fails to parse and the text is left untouched.
      ['12:34: X', '12:34: X'],
    ])('strips %j -> %j', (input, expected) => {
      const { stripLeadingTimePrefix } = window.YouTubePlusTimecode;
      expect(stripLeadingTimePrefix(input)).toBe(expected);
    });

    test('strips a colon delimiter after a complete HH:MM:SS token', () => {
      const { stripLeadingTimePrefix } = window.YouTubePlusTimecode;
      expect(stripLeadingTimePrefix('12:34:56 : X')).toBe('X');
    });

    test('leaves text without a leading timestamp unchanged', () => {
      const { stripLeadingTimePrefix } = window.YouTubePlusTimecode;
      expect(stripLeadingTimePrefix('- 12:34 not leading')).toBe('- 12:34 not leading');
    });
  });

  describe('panel position clamping (real API)', () => {
    test('createTimecodePanel applies saved panel position from config', async () => {
      const api = window.YouTubePlusTimecode;

      api.config.panelPosition = { left: 100, top: 200 };

      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);

      await new Promise(r => requestAnimationFrame(() => r()));
      await new Promise(r => setTimeout(r, 0));

      expect(panel.style.left).toBeTruthy();
      expect(panel.style.top).toBeTruthy();
    });
  });

  describe('runtime lifecycle (real API)', () => {
    test('init -> panel -> cleanup runs safely and cleans dom refs', () => {
      const api = window.YouTubePlusTimecode;
      window.YouTubeUtils.getHostname = () => 'www.youtube.com';
      document.body.appendChild(document.createElement('ytd-app'));

      expect(() => api.init()).not.toThrow();
      // init is idempotent once started
      expect(() => api.init()).not.toThrow();

      const panel = api.createTimecodePanel();
      document.body.appendChild(panel);
      // resize handler repositions the live panel
      expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
      expect(() => api.cleanup()).not.toThrow();
      expect(api.state.dom.panel).toBeNull();
      expect(document.getElementById('timecode-panel')).toBeNull();
      // repeated cleanup stays safe
      expect(() => api.cleanup()).not.toThrow();
    });

    test('createTimecodePanel hides export button when config.export is false', () => {
      const api = window.YouTubePlusTimecode;
      api.config.export = false;
      const panel = api.createTimecodePanel();
      const btn = panel.querySelector('#timecode-export-btn');
      expect(btn).not.toBeNull();
      expect(btn.classList.contains('is-hidden')).toBe(true);
    });
  });

  describe('panel click dispatch', () => {
    test('track-toggle click flips tracking state and updates panel classes', () => {
      const api = window.YouTubePlusTimecode;
      const panel = api.createTimecodePanel();
      const toggle = panel.querySelector('#timecode-track-toggle');
      const startText = toggle.textContent;

      toggle.click();

      const { config, state } = api;
      expect(toggle.textContent).not.toBe(startText);
      // config was true by default -> now false, class removed
      expect(config.autoTrackPlayback).toBe(false);
      expect(toggle.classList.contains('active')).toBe(false);
      expect(panel.classList.contains('auto-tracking')).toBe(false);
      expect(state.dom.panel).toBe(panel);
    });

    test('timecode-item click seeks the video (delegated to seekFromItem)', () => {
      const api = window.YouTubePlusTimecode;
      const panel = api.createTimecodePanel();

      const video = document.createElement('video');
      let seekTime = 0;
      Object.defineProperty(video, 'currentTime', {
        configurable: true,
        set: v => {
          seekTime = v;
        },
        get: () => seekTime,
      });
      video.paused = true;
      video.play = jest.fn();
      document.body.appendChild(video);

      const item = document.createElement('div');
      item.className = 'timecode-item';
      item.dataset.time = '42.5';
      panel.querySelector('#timecode-list').appendChild(item);

      item.click();

      expect(seekTime).toBe(42.5);
      expect(video.play).toHaveBeenCalledTimes(1);
    });

    test('delete asks the in-UI dialog and interpolates via t(key, params)', async () => {
      const api = window.YouTubePlusTimecode;
      const panel = api.createTimecodePanel();
      const list = panel.querySelector('#timecode-list');

      const item = document.createElement('div');
      item.className = 'timecode-item';
      item.dataset.index = '0';
      item.dataset.time = '10';
      item.innerHTML =
        '<span class="timecode-label">Intro</span>' +
        '<button class="timecode-action" data-action="delete"></button>';
      list.appendChild(item);

      const confirmSpy = jest.spyOn(window, 'confirm');
      item.querySelector('.timecode-action').click();
      await new Promise(r => setTimeout(r, 0));

      // The message goes through the common interpolation, not a raw .replace.
      expect(window.YouTubeUtils.t).toHaveBeenCalledWith('confirmDelete', { label: 'Intro' });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(window.YouTubeUtils.confirmDialog).toHaveBeenCalledTimes(1);

      // Confirming removes the timecode.
      expect(list.querySelectorAll('.timecode-item')).toHaveLength(0);
    });
  });
});
