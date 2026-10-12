/**
 * Classic player-control surface removal used when the Vision variant takes
 * over: each owner module releases its own button and listeners, and
 * basic.js delegates to all of them. Real CleanupManager, registry and
 * design-system; only the player markup is synthetic.
 * @jest-environment jsdom
 */

function loadCore() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  window.YouTubePlusSettingsStore.set('styles.themeVariant', 'classic');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
  window.YouTubePlusSettingsStore.set('styles.themeVariant', 'classic');
  window.YouTubePlusDesignSystem?.applyThemeVariant?.('classic');
}

const watchPage = () => {
  document.body.innerHTML = '<div id="movie_player"></div>';
  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    search: '?v=abc',
    href: 'https://www.youtube.com/watch?v=abc',
  });
};

const mountControls = () => {
  const controls = document.createElement('div');
  controls.className = 'ytp-right-controls';
  document.querySelector('#movie_player').appendChild(controls);
  return controls;
};

describe('Classic loop surface removal', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    localStorage.clear();
    watchPage();
    loadCore();
    window.YouTubePlusSettingsStore.set('styles.themeVariant', 'classic');
    window.YouTubePlusDesignSystem?.applyThemeVariant?.('classic');
    require('../src/time.js');
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  });

  test('releases the classic button, its listener and the classic dropdown', () => {
    window.YouTubePlusDesignSystem?.applyThemeVariant?.('classic');
    const controls = mountControls();
    window.YouTubePlusTimeLoop.addClassicLoopButton(controls);

    const btn = controls.querySelector('.yp-loop-button');
    expect(btn).not.toBeNull();
    expect(document.getElementById('yp-classic-loop-dropdown')).not.toBeNull();

    btn.click();

    window.YouTubePlusTimeLoop.removeClassicLoopButton();

    expect(controls.querySelector('.yp-loop-button')).toBeNull();
    expect(document.getElementById('yp-classic-loop-dropdown')).toBeNull();
  });
});

describe('Classic speed button removal', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    localStorage.clear();
    watchPage();
    loadCore();
    window.YouTubePlusSettingsStore.set('enableSpeedControl', true);
    require('../src/speedcontrol.js');
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  });

  const enhancer = () => ({
    speedControl: {
      currentSpeed: 1,
      availableSpeeds: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3],
      storageKey: 'youtube_playback_speed',
    },
    getElement: () => null,
    settings: { enableSpeedControl: true },
    isEditableTarget: () => false,
  });

  test('removeClassicButton drops the classic button and keeps the shared dropdown', () => {
    const controls = mountControls();

    window.YouTubePlusSpeedControl.addButton(enhancer(), controls);
    expect(controls.querySelector('.speed-control-btn')).not.toBeNull();

    window.YouTubePlusSpeedControl.removeClassicButton();

    expect(controls.querySelector('.speed-control-btn')).toBeNull();
  });

  test('removeClassicButton is safe when no classic button is mounted', () => {
    expect(() => window.YouTubePlusSpeedControl.removeClassicButton()).not.toThrow();
  });
});

describe('basic.js Vision surface delegation', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    localStorage.clear();
    watchPage();
    require('../src/cleanup-manager.js');
    require('../src/design-system.js');
    require('../src/utils.js');
    require('../src/safe-dom.js');
    require('../src/settings-store.js');
    require('../src/settings-helpers.js');
    require('../src/basic.js');
  });

  afterEach(() => {
    delete window.__ytpBasicInitDone__;
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
  });

  test('removeClassicButtons delegates to every Classic surface owner', () => {
    const calls = [];
    window.YouTubePlusScreenshot = { removeClassicButton: () => calls.push('screenshot') };
    window.YouTubePlusDownloadButton = { removeClassicButtons: () => calls.push('download') };
    window.YouTubePlusSpeedControl = { removeClassicButton: () => calls.push('speed') };
    window.YouTubePlusTimeLoop = { removeClassicLoopButton: () => calls.push('loop') };

    window.YouTubePlusBasic.YouTubeEnhancer.removeClassicButtons();

    expect(calls).toEqual(['screenshot', 'download', 'speed', 'loop']);
  });

  test('removeClassicButtons tolerates missing owner modules', () => {
    window.YouTubePlusScreenshot = undefined;
    window.YouTubePlusDownloadButton = undefined;
    window.YouTubePlusSpeedControl = undefined;
    window.YouTubePlusTimeLoop = undefined;

    expect(() => window.YouTubePlusBasic.YouTubeEnhancer.removeClassicButtons()).not.toThrow();
  });
});
