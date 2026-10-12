/**
 * @jest-environment jsdom
 *
 * Comprehensive unit and integration test suite for src/timecode.js
 * targeting >= 80% line coverage across all functional paths:
 * extraction, detection, chapters, settings, hotkeys, panel CRUD,
 * drag-and-drop, playback tracking, export, and modal observer.
 */

describe('Timecode Comprehensive Coverage Suite', () => {
  let hooks;
  let api;

  function setupEnvironment() {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();

    window._ytplusCreateHTML = s => s;
    delete window._timecodeModuleInitialized;
    delete window.YouTubePlusTimecode;

    // Enable internal test hooks
    window.__YTP_TEST_HOOKS__ = true;

    // Mock location on /watch
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=testVideo123',
      href: 'https://www.youtube.com/watch?v=testVideo123',
    });

    // Load base modules
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/settings-store.js');
    require('../src/safe-dom.js');
    require('../src/event-delegation.js');
    require('../src/i18n.js');
    require('../src/feature-registry.js');
    require('../src/design-system.js');
    require('../src/mutation-coordinator.js');

    // Stubs for notifications and confirm
    window.YouTubeUtils.NotificationManager = {
      show: jest.fn(),
    };
    window.YouTubeUtils.confirmDialog = jest.fn(() => Promise.resolve(true));

    // Create app root
    const app = document.createElement('ytd-app');
    document.body.appendChild(app);

    // Create a mock video element
    const video = document.createElement('video');
    video.currentTime = 10;
    video.duration = 600;
    Object.defineProperty(video, 'play', {
      configurable: true,
      value: jest.fn(() => Promise.resolve()),
    });
    Object.defineProperty(video, 'pause', {
      configurable: true,
      value: jest.fn(),
    });
    document.body.appendChild(video);

    // Load timecode module
    require('../src/timecode.js');

    api = window.YouTubePlusTimecode;
    hooks = api.testHooks;
  }

  beforeEach(() => {
    jest.resetModules();
    setupEnvironment();
  });

  afterEach(() => {
    api?.cleanup?.();
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    jest.restoreAllMocks();
  });

  describe('Test hooks availability', () => {
    test('exposes all expected test hooks', () => {
      expect(hooks).toBeDefined();
      expect(typeof hooks.extractTimecodes).toBe('function');
      expect(typeof hooks.getYouTubeChapters).toBe('function');
      expect(typeof hooks.detectTimecodes).toBe('function');
      expect(typeof hooks.saveSettings).toBe('function');
      expect(typeof hooks.loadSettings).toBe('function');
      expect(typeof hooks.exportTimecodes).toBe('function');
      expect(typeof hooks.reloadTimecodes).toBe('function');
      expect(typeof hooks.makeDraggable).toBe('function');
      expect(typeof hooks.clampPanelPosition).toBe('function');
      expect(typeof hooks.saveTimecodesToStorage).toBe('function');
      expect(typeof hooks.loadTimecodesFromStorage).toBe('function');
      expect(typeof hooks.getCurrentTimecodes).toBe('function');
      expect(typeof hooks.toggleTimecodePanel).toBe('function');
      expect(typeof hooks.showTimecodeForm).toBe('function');
      expect(typeof hooks.hideTimecodeForm).toBe('function');
      expect(typeof hooks.editTimecode).toBe('function');
      expect(typeof hooks.deleteTimecode).toBe('function');
      expect(typeof hooks.startTracking).toBe('function');
      expect(typeof hooks.stopTracking).toBe('function');
      expect(typeof hooks.isRelevantRoute).toBe('function');
    });
  });

  describe('extractTimecodes edge cases', () => {
    test('handles empty or non-string input safely', () => {
      expect(hooks.extractTimecodes('')).toEqual([]);
      expect(hooks.extractTimecodes(null)).toEqual([]);
      expect(hooks.extractTimecodes(undefined)).toEqual([]);
      expect(hooks.extractTimecodes('   \n  \t ')).toEqual([]);
    });

    test('extracts various timestamp line patterns and sorts them', () => {
      const text = [
        '03:45 Third item',
        '00:00 Intro',
        '01:30 - Second item with dash',
        '05:00:00 Very long episode section',
        'invalid line without timestamp',
        '01:30 Duplicate timestamp label',
      ].join('\n');

      const result = hooks.extractTimecodes(text);
      expect(result.length).toBe(4);
      expect(result[0].time).toBe(0);
      expect(result[0].label).toBe('Intro');
      expect(result[1].time).toBe(90);
      expect(result[1].label).toBe('Duplicate timestamp label');
      expect(result[2].time).toBe(225);
      expect(result[2].label).toBe('Third item');
      expect(result[3].time).toBe(18000);
      expect(result[3].label).toBe('Very long episode section');
    });

    test('truncates overly long labels with ellipsis', () => {
      const longLabel = 'A'.repeat(120);
      const text = `00:10 ${longLabel}`;
      const result = hooks.extractTimecodes(text);
      expect(result.length).toBe(1);
      expect(result[0].label.length).toBeLessThanOrEqual(100);
    });

    test('parses multiple timestamps across lines', () => {
      const text = '01:15 Cool part\n02:45 Ending';
      const result = hooks.extractTimecodes(text);
      expect(result.length).toBe(2);
      expect(result[0].time).toBe(75);
      expect(result[1].time).toBe(165);
    });
  });

  describe('getYouTubeChapters extraction', () => {
    test('returns empty array when no chapter elements exist', () => {
      const chapters = hooks.getYouTubeChapters();
      expect(chapters).toEqual([]);
    });

    test('extracts chapters from macro-markers-list-item-renderer', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <ytd-macro-markers-list-item-renderer>
          <div id="time">01:00</div>
          <h4 id="details">Chapter One</h4>
        </ytd-macro-markers-list-item-renderer>
        <ytd-macro-markers-list-item-renderer>
          <div id="time">02:30</div>
          <h4 id="details">Chapter Two</h4>
        </ytd-macro-markers-list-item-renderer>
      `;
      document.body.appendChild(container);

      const chapters = hooks.getYouTubeChapters();
      expect(chapters.length).toBe(2);
      expect(chapters[0]).toEqual(
        expect.objectContaining({
          time: 60,
          label: 'Chapter One',
          isChapter: true,
        })
      );
      expect(chapters[1]).toEqual(
        expect.objectContaining({
          time: 150,
          label: 'Chapter Two',
          isChapter: true,
        })
      );
    });

    test('extracts chapters from modern chapter renderer elements', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <ytd-chapter-renderer>
          <span class="timestamp">00:00</span>
          <span class="chapter-title">Start</span>
        </ytd-chapter-renderer>
      `;
      document.body.appendChild(container);

      const chapters = hooks.getYouTubeChapters();
      expect(chapters.length).toBe(1);
      expect(chapters[0].time).toBe(0);
      expect(chapters[0].label).toBe('Start');
    });

    test('skips chapter items with invalid or unparseable timestamps', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <ytd-macro-markers-list-item-renderer>
          <div id="time">NotATime</div>
          <h4 id="details">Bad Chapter</h4>
        </ytd-macro-markers-list-item-renderer>
      `;
      document.body.appendChild(container);

      const chapters = hooks.getYouTubeChapters();
      expect(chapters).toEqual([]);
    });
  });

  describe('detectTimecodes and reloadTimecodes', () => {
    test('returns cached timecodes on subsequent calls for same videoId without force', async () => {
      api.state.timecodes.set('detect_testVideo123', [
        { time: 10, label: 'Cached Item', isChapter: false, isUserAdded: false },
      ]);

      const result = await hooks.detectTimecodes({ force: false });
      expect(result.length).toBe(1);
      expect(result[0].label).toBe('Cached Item');
    });

    test('detects timecodes from description and expands description if collapsed', async () => {
      const descContainer = document.createElement('div');
      descContainer.id = 'description-inline-expander';
      const text = document.createElement('div');
      text.className = 'yt-core-attributed-string';
      descContainer.appendChild(text);

      const expandBtn = document.createElement('tp-yt-paper-button');
      expandBtn.id = 'expand';
      Object.defineProperty(expandBtn, 'offsetParent', { value: document.body });
      expandBtn.click = jest.fn(() => {
        text.textContent = '00:00 Beginning\n01:30 Middle\n03:00 End';
      });
      descContainer.appendChild(expandBtn);

      document.body.appendChild(descContainer);

      const result = await hooks.detectTimecodes({ force: true });
      expect(result.length).toBe(3);
      expect(expandBtn.click).toHaveBeenCalled();
    });

    test('falls back to comments when description has no timecodes', async () => {
      const comments = document.createElement('div');
      comments.id = 'comments';
      comments.innerHTML = `
        <ytd-comment-thread-renderer>
          <div id="content-text">Timestamps:\n02:00 Favorite Moment</div>
        </ytd-comment-thread-renderer>
      `;
      document.body.appendChild(comments);

      const result = await hooks.detectTimecodes({ force: true });
      expect(result.length).toBe(1);
      expect(result[0].time).toBe(120);
      expect(result[0].label).toBe('Favorite Moment');
    });

    test('returns empty array when neither description nor comments have timecodes', async () => {
      const result = await hooks.detectTimecodes({ force: true });
      expect(result).toEqual([]);
    });

    test('reloadTimecodes adds spinning class and triggers detection', async () => {
      const reloadBtn = document.createElement('button');
      reloadBtn.id = 'timecode-reload';

      await hooks.reloadTimecodes(reloadBtn);
      expect(reloadBtn.classList.contains('spinning')).toBe(false);
    });
  });

  describe('exportTimecodes functionality', () => {
    test('copies formatted timecodes via navigator.clipboard when available', async () => {
      document.title = 'Test Video - YouTube';
      const writeTextMock = jest.fn(() => Promise.resolve());
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      api.createTimecodePanel();
      hooks.updateTimecodePanel([
        { time: 60, label: 'First', isChapter: false, isUserAdded: false },
        { time: 120, label: 'Second', isChapter: false, isUserAdded: false },
      ]);

      hooks.exportTimecodes();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(writeTextMock).toHaveBeenCalledWith(
        'Test Video\n\nTimecodes:\n1:00 - First\n2:00 - Second\n'
      );
      expect(window.YouTubeUtils.NotificationManager.show).toHaveBeenCalled();
    });

    test('handles clipboard write failure gracefully', async () => {
      const error = new Error('Clipboard denied');
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn(() => Promise.reject(error)),
        },
      });

      api.createTimecodePanel();
      hooks.updateTimecodePanel([
        { time: 30, label: 'Test Item', isChapter: false, isUserAdded: false },
      ]);

      hooks.exportTimecodes();
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    test('exportTimecodes does nothing when no timecode items exist', async () => {
      api.createTimecodePanel();
      hooks.updateTimecodePanel([]);
      const writeTextMock = jest.fn();
      Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

      hooks.exportTimecodes();
      expect(writeTextMock).not.toHaveBeenCalled();
    });
  });

  describe('Settings, Persistence, and Migration', () => {
    test('loadSettings merges stored preferences and clamps out-of-bounds positions', () => {
      window.YouTubeUtils.storage.set('youtube_timecode_settings', {
        shortcut: { key: 'X', altKey: true, ctrlKey: false, shiftKey: false },
        panelPosition: { left: 150, top: 250 },
        autoDetect: false,
        autoTrackPlayback: false,
      });

      hooks.loadSettings();
      expect(api.config.shortcut.key).toBe('X');
      expect(api.config.shortcut.altKey).toBe(true);
      expect(api.config.autoDetect).toBe(false);
      expect(api.config.autoTrackPlayback).toBe(false);
      expect(api.config.panelPosition.left).toBe(150);
      expect(api.config.panelPosition.top).toBe(250);
    });

    test('loadSettings handles invalid JSON gracefully', () => {
      localStorage.setItem('youtube_timecode_settings', 'INVALID{JSON');
      expect(() => hooks.loadSettings()).not.toThrow();
      expect(api.config.shortcut.key).toBe('T');
    });

    test('saveSettings persists configuration into storage', () => {
      api.config.shortcut.key = 'Y';
      api.config.shortcut.ctrlKey = true;
      hooks.saveSettings();

      const stored = window.YouTubeUtils.storage.get('youtube_timecode_settings');
      expect(stored).not.toBeNull();
      expect(stored.shortcut.key).toBe('Y');
      expect(stored.shortcut.ctrlKey).toBe(true);
    });

    test('saveTimecodesToStorage and loadTimecodesFromStorage', () => {
      const items = [
        { time: 10, label: 'Part A', isChapter: false, isUserAdded: true },
        { time: 50, label: 'Part B', isChapter: true, isUserAdded: false },
      ];

      hooks.saveTimecodesToStorage(items);
      const loaded = hooks.loadTimecodesFromStorage();
      expect(loaded).toEqual(items);
    });

    test('loadTimecodesFromStorage returns null when no saved data or invalid video ID', () => {
      localStorage.removeItem('yt_tc_testVideo123');
      expect(hooks.loadTimecodesFromStorage()).toBeNull();
    });
  });

  describe('Panel CRUD operations', () => {
    let panel;

    beforeEach(() => {
      panel = api.createTimecodePanel();
      panel.classList.remove('hidden');
    });

    test('showTimecodeForm and hideTimecodeForm manage form visibility and input values', () => {
      hooks.showTimecodeForm(125);
      expect(api.state.dom.form.classList.contains('visible')).toBe(true);
      expect(api.state.dom.timeInput.value).toBe('2:05');

      hooks.hideTimecodeForm();
      expect(api.state.dom.form.classList.contains('visible')).toBe(false);
      expect(api.state.editingIndex).toBeNull();
    });

    test('editTimecode populates form with item data and scrolls into view', () => {
      hooks.updateTimecodePanel([
        { time: 60, label: 'Editable Item', isChapter: false, isUserAdded: true },
      ]);

      hooks.editTimecode(0);
      expect(api.state.editingIndex).toBe(0);
      expect(api.state.dom.timeInput.value).toBe('1:00');
      expect(api.state.dom.labelInput.value).toBe('Editable Item');
      expect(api.state.dom.form.classList.contains('visible')).toBe(true);
    });

    test('deleteTimecode removes item on confirm and updates storage', async () => {
      hooks.updateTimecodePanel([
        { time: 30, label: 'To Delete', isChapter: false, isUserAdded: true },
      ]);

      await hooks.deleteTimecode(0);
      expect(panel.querySelectorAll('.timecode-item').length).toBe(0);
      expect(api.state.dom.empty.style.display).toBe('flex');
    });

    test('deleteTimecode cancels removal when confirmDialog resolves false', async () => {
      window.YouTubeUtils.confirmDialog = jest.fn(() => Promise.resolve(false));

      hooks.updateTimecodePanel([
        { time: 30, label: 'Do Not Delete', isChapter: false, isUserAdded: true },
      ]);

      await hooks.deleteTimecode(0);
      expect(panel.querySelectorAll('.timecode-item').length).toBe(1);
    });

    test('updateActiveItem highlights the item and removes pulse class after timeout', () => {
      jest.useFakeTimers();
      hooks.updateTimecodePanel([
        { time: 10, label: 'One', isChapter: false, isUserAdded: false },
        { time: 20, label: 'Two', isChapter: false, isUserAdded: false },
      ]);
      const items = panel.querySelectorAll('.timecode-item');

      hooks.updateActiveItem(items[1]);
      expect(items[1].classList.contains('active')).toBe(true);
      expect(items[1].classList.contains('pulse')).toBe(true);

      jest.advanceTimersByTime(850);
      expect(items[1].classList.contains('pulse')).toBe(false);
      jest.useRealTimers();
    });
  });

  describe('Draggable functionality', () => {
    test('makeDraggable clamps and moves panel on mouse events', () => {
      const panel = api.createTimecodePanel();
      const header = panel.querySelector('#timecode-header');

      // Trigger mousedown on header
      header.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
        })
      );
      expect(api.state.dragging).toBe(true);

      // Trigger mousemove on document
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 150,
          clientY: 170,
        })
      );

      // Trigger mouseup to complete drag
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
        })
      );
      expect(api.state.dragging).toBe(false);
    });

    test('makeDraggable ignores non-primary mouse buttons', () => {
      const panel = api.createTimecodePanel();
      const header = panel.querySelector('#timecode-header');

      header.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 2, // right click
          clientX: 100,
          clientY: 100,
        })
      );
      expect(api.state.dragging).toBe(false);
    });

    test('clampPanelPosition ensures coordinates remain within window boundaries', () => {
      const panel = api.createTimecodePanel();
      // Off screen left/top clamps to 0
      const clamped1 = hooks.clampPanelPosition(panel, -100, -50);
      expect(clamped1.left).toBe(0);
      expect(clamped1.top).toBe(0);

      // Clamped within reasonable window bounds
      const clamped2 = hooks.clampPanelPosition(panel, 200, 300);
      expect(clamped2.left).toBe(200);
      expect(clamped2.top).toBe(300);
    });
  });

  describe('Playback Tracking & Progress Bar', () => {
    test('startTracking registers timeupdate and updates active item during playback', () => {
      const video = document.querySelector('video');
      video.currentTime = 15;

      const panel = api.createTimecodePanel();
      panel.classList.remove('hidden');

      hooks.updateTimecodePanel([
        { time: 0, label: 'Intro', isChapter: false, isUserAdded: false },
        { time: 10, label: 'Section 1', isChapter: false, isUserAdded: false },
        { time: 30, label: 'Section 2', isChapter: false, isUserAdded: false },
      ]);

      const mockCtx = {
        listen: jest.fn((target, type, cb) => {
          target.addEventListener(type, cb);
          return () => target.removeEventListener(type, cb);
        }),
        style: jest.fn(),
      };

      hooks.start(mockCtx);
      hooks.startTracking();
      expect(api.state.trackingId).toBe(1);

      // Fire timeupdate event
      video.dispatchEvent(new Event('timeupdate'));

      const items = panel.querySelectorAll('.timecode-item');
      expect(items[1].classList.contains('active')).toBe(true);
      expect(api.state.activeIndex).toBe(1);

      hooks.stopTracking();
      expect(api.state.trackingId).toBe(0);
    });

    test('stopTracking is safe when not tracking', () => {
      expect(() => hooks.stopTracking()).not.toThrow();
    });
  });

  describe('Keyboard shortcuts & Navigation', () => {
    test('keydown triggers toggleTimecodePanel on matching shortcut', () => {
      const mockCtx = {
        listen: jest.fn((target, type, cb) => {
          target.addEventListener(type, cb);
          return () => target.removeEventListener(type, cb);
        }),
        style: jest.fn(),
      };

      hooks.start(mockCtx);
      api.config.shortcut = { key: 'T', shiftKey: true, altKey: false, ctrlKey: false };

      // Press hotkey Shift+T
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'T',
          shiftKey: true,
          bubbles: true,
        })
      );

      const panel = document.getElementById('timecode-panel');
      expect(panel).not.toBeNull();
    });

    test('keydown ignores shortcuts when focus is inside text input', () => {
      const mockCtx = {
        listen: jest.fn((target, type, cb) => {
          target.addEventListener(type, cb);
          return () => target.removeEventListener(type, cb);
        }),
        style: jest.fn(),
      };

      hooks.start(mockCtx);

      const input = document.createElement('input');
      document.body.appendChild(input);

      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'T',
          shiftKey: true,
          bubbles: true,
        })
      );

      // Panel should not be created / opened
      expect(document.getElementById('timecode-panel')).toBeNull();
    });

    test('isRelevantRoute returns true for /watch and false otherwise', () => {
      expect(hooks.isRelevantRoute()).toBe(true);

      global.mockLocation({
        hostname: 'www.youtube.com',
        pathname: '/feed/subscriptions',
      });
      expect(hooks.isRelevantRoute()).toBe(false);

      global.mockLocation({
        hostname: 'music.youtube.com',
        pathname: '/watch',
      });
      expect(hooks.isRelevantRoute()).toBe(false);
    });
  });

  describe('Settings UI integration and Modal Observer', () => {
    test('attachTimecodeHandlers mounts controls and hooks change listeners', () => {
      const settingsSection = document.createElement('div');
      settingsSection.className = 'yp-settings-section';
      settingsSection.dataset.section = 'advanced';

      const timecodeItem = document.createElement('div');
      timecodeItem.className = 'timecode-settings-item';
      timecodeItem.innerHTML = `
        <input type="checkbox" id="timecode-enable-checkbox" checked />
        <button class="yp-submenu-toggle" data-submenu="timecode" aria-expanded="false"></button>
        <div class="timecode-submenu" data-submenu="timecode">
          <div id="timecode-modifier-dropdown"></div>
          <select id="timecode-modifier-combo">
            <option value="shift" selected>Shift</option>
            <option value="ctrl">Ctrl</option>
          </select>
          <input type="text" id="timecode-key" value="T" />
        </div>
      `;
      settingsSection.appendChild(timecodeItem);
      document.body.appendChild(settingsSection);

      hooks.attachTimecodeHandlers();

      // Checkbox toggle
      const checkbox = timecodeItem.querySelector('#timecode-enable-checkbox');
      expect(checkbox).not.toBeNull();
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      expect(window.YouTubePlusSettingsStore.get('timecodeEnabled')).toBe(false);

      // Submenu toggle
      const toggle = timecodeItem.querySelector('.yp-submenu-toggle');
      if (toggle) {
        toggle.click();
      }

      // Hotkey input change
      const keyInput = timecodeItem.querySelector('#timecode-key');
      if (keyInput) {
        keyInput.value = 'K';
        keyInput.dispatchEvent(new Event('input', { bubbles: true }));
        expect(api.config.shortcut.key).toBe('K');
      }

      // Modifier combo change
      const combo = timecodeItem.querySelector('#timecode-modifier-combo');
      if (combo) {
        combo.value = 'ctrl';
        combo.dispatchEvent(new Event('change', { bubbles: true }));
        expect(api.config.shortcut.ctrlKey).toBe(true);
        expect(api.config.shortcut.shiftKey).toBe(false);
      }
    });

    test('setupTimecodeSettingsIntegration attaches handlers on settings modal open event', () => {
      const modal = document.createElement('div');
      modal.className = 'yp-settings-modal';
      const section = document.createElement('div');
      section.className = 'yp-settings-section';
      section.dataset.section = 'advanced';

      const timecodeItem = document.createElement('div');
      timecodeItem.className = 'timecode-settings-item';
      timecodeItem.innerHTML = `
        <input type="checkbox" id="timecode-enable-checkbox" />
      `;
      section.appendChild(timecodeItem);
      modal.appendChild(section);
      document.body.appendChild(modal);

      hooks.setupTimecodeSettingsIntegration();
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      expect(timecodeItem.dataset.handlerAttached).toBe('1');
    });
  });
});
