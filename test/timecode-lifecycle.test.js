/**
 * Timecode module (src/timecode.js) on the FeatureLifecycle contract
 * (feature-registry.js). Real CleanupManager, SettingsStore, EventDelegation,
 * MutationCoordinator and DesignSystem; the store key is `timecodeEnabled`
 * and the panel preferences stay in the legacy `youtube_timecode_settings`.
 * @jest-environment jsdom
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
  require('../src/mutation-coordinator.js');
  require('../src/timecode.js');
  // NotificationManager ships with basic.js in the bundle; tests stub it.
  window.YouTubeUtils.NotificationManager = { show: jest.fn() };
}

const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;
const store = () => window.YouTubePlusSettingsStore;

function counts() {
  const cm = window.YouTubePlusCleanupManager;
  return {
    listeners: cm.getListenerStats().active,
    observers: cm.observers.size,
    timeouts: cm.timeouts.size + cm.sessionTimeouts.size,
    delegated: window.YouTubePlusEventDelegation?.getStats?.().totalHandlers ?? 0,
  };
}

const styleText = () => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');

/** Press the panel hotkey (T + shift by default). */
const pressHotkey = () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', shiftKey: true, bubbles: true }));
};

/** A fresh panel is created hidden; the second hotkey press opens it. */
const openPanel = () => {
  pressHotkey();
  pressHotkey();
  const panel = document.getElementById('timecode-panel');
  expect(panel).not.toBeNull();
  expect(panel.classList.contains('hidden')).toBe(false);
  return panel;
};

describe('timecode on the lifecycle contract', () => {
  const api = () => window.YouTubePlusTimecode;

  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window._timecodeModuleInitialized;

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=lifecycle',
    });

    loadChain();
    store().set('timecodeEnabled', false);
    document.body.appendChild(document.createElement('ytd-app'));
    require('../src/timecode.js');
    // The module registers itself on yt-navigate-finish; boot the runtime
    // once so init() syncs the lifecycle host.
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });

  afterEach(() => {
    lifecycle()?._reset?.();
    jest.useRealTimers();
  });

  test('10 on/off cycles return to the starting counts and leave no panel or CSS', () => {
    store().set('timecodeEnabled', true);
    expect(lifecycle().isRunning('timecode')).toBe(true);

    const video = document.createElement('video');
    document.body.appendChild(video);

    // The panel CSS waits for the panel: a running feature with no panel open
    // registers none.
    expect(window.YouTubePlusDesignSystem.StyleManager.has('timecode-panel-styles')).toBe(false);
    openPanel();
    expect(window.YouTubePlusDesignSystem.StyleManager.has('timecode-panel-styles')).toBe(true);
    expect(window.YouTubePlusEventDelegation.getStats().totalHandlers).toBeGreaterThan(0);

    store().set('timecodeEnabled', false);
    expect(lifecycle().isRunning('timecode')).toBe(false);
    expect(document.getElementById('timecode-panel')).toBeNull();
    expect(api().state.dom.panel).toBeNull();
    expect(window.YouTubePlusDesignSystem.StyleManager.has('timecode-panel-styles')).toBe(false);

    const baseline = counts();
    const css = styleText();

    for (let i = 0; i < 10; i++) {
      store().set('timecodeEnabled', true);
      expect(document.getElementById('timecode-panel')).toBeNull();
      openPanel();
      store().set('timecodeEnabled', false);
      expect(document.getElementById('timecode-panel')).toBeNull();
    }

    expect(counts()).toEqual(baseline);
    expect(styleText()).toBe(css);
  });

  test('the panel keeps adding and seeking timecodes after off/on cycles', async () => {
    const video = document.createElement('video');
    document.body.appendChild(video);

    store().set('timecodeEnabled', true);
    const panel = openPanel();

    // Add a timecode through the form: 10s with a custom label.
    panel.querySelector('#timecode-add-btn').click();
    expect(panel.querySelector('#timecode-form')).not.toBeNull();
    api().state.dom.timeInput.value = '0:10';
    api().state.dom.labelInput.value = 'Intro chapter';
    panel.querySelector('#timecode-form-save').click();
    expect(panel.querySelectorAll('.timecode-item')).toHaveLength(1);
    expect(localStorage.getItem('yt_tc_lifecycle')).toContain('"t":10');

    // Seek through the list item delegation.
    panel.querySelector('.timecode-item').click();
    expect(video.currentTime).toBe(10);

    // Off removes the panel, on rebuilds it and the hotkey still works.
    store().set('timecodeEnabled', false);
    expect(document.getElementById('timecode-panel')).toBeNull();

    store().set('timecodeEnabled', true);
    const rebuilt = openPanel();
    expect(rebuilt).not.toBeNull();
    // The saved timecode reloads into the rebuilt panel.
    expect(rebuilt.querySelectorAll('.timecode-item')).toHaveLength(1);
    expect(rebuilt.querySelector('.timecode-label')?.textContent).toBe('Intro chapter');
    expect(lifecycle().isRunning('timecode')).toBe(true);
  });

  test('tracking follows the timeupdate and the navigation reaction rebuilds state', async () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      value: 0,
      writable: true,
    });
    document.body.appendChild(video);
    api().config.autoDetect = false;

    store().set('timecodeEnabled', true);
    const panel = openPanel();
    expect(api().state.trackingId).toBe(1);

    // The timeupdate listener is owned by the feature and reacts.
    video.currentTime = 5;
    video.dispatchEvent(new Event('timeupdate'));
    expect(panel.querySelector('#timecode-current-time').textContent).toBe('0:05');

    // Off stops tracking; a late timeupdate reaches nobody.
    store().set('timecodeEnabled', false);
    video.dispatchEvent(new Event('timeupdate'));
    expect(api().state.trackingId).toBe(0);

    store().set('timecodeEnabled', true);
    openPanel();
    expect(api().state.trackingId).toBe(1);

    // SPA navigation to another video clears the per-video caches, the
    // panel survives (the navigation reaction keeps it loaded).
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=nextvideo',
    });
    document.dispatchEvent(new Event('yt-navigate-finish'));
    expect(api().state.timecodes.size).toBe(0);
    expect(document.querySelectorAll('#timecode-panel')).toHaveLength(1);
  });

  describe('legacy flag migration in the settings store', () => {
    test('copies enabled once and drops the flag from the legacy JSON', () => {
      jest.resetModules();
      document.head.innerHTML = '';
      document.body.innerHTML = '';
      localStorage.clear();
      delete window._timecodeModuleInitialized;

      localStorage.setItem(
        'youtube_timecode_settings',
        JSON.stringify({
          enabled: false,
          autoDetect: true,
          shortcut: { key: 'T', shiftKey: true, altKey: false, ctrlKey: false },
          autoSave: true,
          autoTrackPlayback: true,
          export: true,
        })
      );

      require('../src/settings-store.js');
      const legacyStore = window.YouTubePlusSettingsStore;
      expect(legacyStore.get('timecodeEnabled')).toBe(false);
      expect(legacyStore.hasKey('timecodeEnabled')).toBe(true);

      const legacy = JSON.parse(localStorage.getItem('youtube_timecode_settings'));
      expect(legacy.enabled).toBeUndefined();
      expect(legacy.autoDetect).toBe(true);
      expect(legacy.shortcut).toEqual({ key: 'T', shiftKey: true, altKey: false, ctrlKey: false });

      // A store value that already exists is never overwritten by legacy data.
      jest.resetModules();
      localStorage.setItem('youtube_plus_settings', JSON.stringify({ timecodeEnabled: true }));
      localStorage.setItem('youtube_timecode_settings', JSON.stringify({ enabled: false }));
      require('../src/settings-store.js');
      expect(window.YouTubePlusSettingsStore.get('timecodeEnabled')).toBe(true);
      expect(JSON.parse(localStorage.getItem('youtube_timecode_settings')).enabled).toBeUndefined();
    });

    test('settings modal checkbox reflects the store key', () => {
      jest.resetModules();
      document.head.innerHTML = '';
      document.body.innerHTML = '';
      localStorage.clear();
      localStorage.setItem('youtube_plus_settings', JSON.stringify({ timecodeEnabled: false }));
      require('../src/settings-store.js');
      require('../src/settings-helpers.js');

      const html = window.YouTubePlusSettingsHelpers.createAdvancedSettingsSection(
        window.YouTubePlusSettingsStore.load(),
        key => key
      );

      expect(html).toContain('data-setting="timecodeEnabled"');
      expect(html).toContain('timecode-settings-item');
      // The store says off — the checkbox is not pre-checked and the
      // submenu stays hidden.
      expect(html.match(/id="timecode-enable-checkbox"[^>]*checked/)).toBeNull();
    });
  });
});
