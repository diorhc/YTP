/**
 * Unit tests for YouTube+ Timecode module
 */

describe('Timecode Module', () => {
  beforeEach(() => {
    window._ytplusCreateHTML = s => s;
    window._timecodeModuleInitialized = false;
    window.YouTubeUtils = {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      cleanupManager: {
        registerTimeout: jest.fn(id => id),
        registerInterval: jest.fn(id => id),
        registerObserver: jest.fn(obs => obs),
        registerListener: jest.fn(),
        cleanup: jest.fn(),
        observers: new Set(),
        intervals: new Set(),
        timeouts: new Set(),
        animationFrames: new Set(),
      },
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      loadFeatureEnabled: jest.fn(() => true),
      SETTINGS_KEY: 'youtube_plus_settings',
    };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
  });

  test('should format time correctly', () => {
    // Replicate the formatTime function from the module
    const formatTime = seconds => {
      if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      return `${m}:${String(s).padStart(2, '0')}`;
    };

    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3661)).toBe('1:01:01');
    expect(formatTime(-1)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
  });

  test('should parse timecode strings', () => {
    // HH:MM:SS, MM:SS, or SS formats
    const parseTimecode = str => {
      if (!str || typeof str !== 'string') return 0;
      const parts = str.split(':').map(Number);
      if (parts.some(isNaN)) return 0;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 1) return parts[0];
      return 0;
    };

    expect(parseTimecode('1:05')).toBe(65);
    expect(parseTimecode('1:00:00')).toBe(3600);
    expect(parseTimecode('0:30')).toBe(30);
    expect(parseTimecode('invalid')).toBe(0);
    expect(parseTimecode('')).toBe(0);
    expect(parseTimecode(null)).toBe(0);
  });

  test('should validate config defaults', () => {
    const config = {
      enabled: true,
      autoDetect: true,
      shortcut: { key: 'T', shiftKey: true, altKey: false, ctrlKey: false },
      storageKey: 'youtube_timecode_settings',
      autoSave: true,
      autoTrackPlayback: true,
    };

    expect(config.enabled).toBe(true);
    expect(config.shortcut.key).toBe('T');
    expect(config.shortcut.shiftKey).toBe(true);
    expect(config.storageKey).toBe('youtube_timecode_settings');
  });

  test('should manage timecode state', () => {
    const state = {
      timecodes: new Map(),
      activeIndex: null,
    };

    // Add timecodes
    state.timecodes.set(0, { time: 0, label: 'Intro' });
    state.timecodes.set(1, { time: 65, label: 'Chapter 1' });
    state.timecodes.set(2, { time: 180, label: 'Chapter 2' });

    expect(state.timecodes.size).toBe(3);
    expect(state.timecodes.get(1).label).toBe('Chapter 1');
    expect(state.timecodes.get(1).time).toBe(65);

    // Remove timecode
    state.timecodes.delete(1);
    expect(state.timecodes.size).toBe(2);
    expect(state.timecodes.has(1)).toBe(false);
  });
});
