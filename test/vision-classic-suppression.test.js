/**
 * @jest-environment jsdom
 */

describe('Vision classic button suppression and immediate dock mounting', () => {
  const setupDom = () => {
    document.body.innerHTML = `
      <div id="movie_player" class="html5-video-player">
        <video class="video-stream html5-main-video"></video>
        <div class="ytp-chrome-bottom">
          <div class="ytp-chrome-controls">
            <div class="ytp-right-controls"></div>
          </div>
        </div>
      </div>
    `;
    global.mockLocation?.({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=dQw4w9WgXcQ',
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  };

  const loadChain = (themeVariant = 'vision') => {
    jest.resetModules();
    delete window.__ytpBasicInitDone__;
    delete window.__ytpTimeInitDone__;
    delete window.__ytpZoomInitialized__;
    delete window.__ytplusThemeSync;
    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    delete window.YouTubePlusSettingsStore;
    delete window.YouTubePlusBasic;
    delete window.YouTubePlusVisionDockHost;
    delete window.YouTubePlusFeatureRegistry;
    delete window.YouTubePlusDownloadButton;
    delete window.YouTubePlusScreenshot;
    delete window.YouTubePlusSpeedControl;
    delete window.YouTubePlusTimeLoop;
    delete window.YouTubePlusZoom;
    localStorage.clear();

    // Set theme preference before design-system reads it
    localStorage.setItem(
      'youtube_plus_settings',
      JSON.stringify({
        styles: { themeVariant },
        enableScreenshot: true,
        enableDownload: true,
        enableSpeedControl: true,
        enableLoop: true,
        enableZoom: true,
      })
    );

    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/settings-store.js');
    require('../src/design-system.js');
    require('../src/feature-registry.js');
    require('../src/basic.js');
    require('../src/download.js');
    require('../src/screenshot.js');
    require('../src/zoom.js');
    require('../src/speedcontrol.js');
    require('../src/time.js');
  };

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    const cm = window.YouTubePlusCleanupManager;
    cm?.cleanup?.();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  test('under vision theme, feature owners suppress classic buttons before and after dock mount', () => {
    setupDom();
    loadChain('vision');

    expect(window.YouTubePlusDesignSystem.getThemeVariant()).toBe('vision');

    const controls = document.querySelector('.ytp-right-controls');
    const player = document.querySelector('#movie_player');
    expect(controls).not.toBeNull();
    expect(player).not.toBeNull();

    // Prior to VisionDockHost.mount(), attempt to add controls via basic enhancer and feature modules
    const enhancer = window.YouTubePlusBasic.YouTubeEnhancer;
    enhancer.addCustomButtons();

    // Also directly call each feature owner's mount methods
    window.YouTubePlusScreenshot?.addButton?.(controls);
    window.YouTubePlusDownloadButton?.addDownloadButton?.(controls);
    window.YouTubePlusSpeedControl?.addButton?.(enhancer, controls);
    window.YouTubePlusTimeLoop?.addClassicLoopButton?.(controls);

    const zoomWrap = document.createElement('div');
    zoomWrap.id = 'yp-zoom-control';
    window.YouTubePlusZoom?.setupZoomButton?.(player, zoomWrap);

    // 1. Assert no classic buttons exist in .ytp-right-controls
    expect(controls.querySelector('.yp-screenshot-button')).toBeNull();
    expect(controls.querySelector('.yp-download-button')).toBeNull();
    expect(controls.querySelector('.speed-control-btn')).toBeNull();
    expect(controls.querySelector('.yp-loop-button')).toBeNull();
    expect(controls.querySelector('#yp-zoom-button')).toBeNull();

    // 2. Assert #yp-zoom-control is not visible if present
    const zoomControl = document.getElementById('yp-zoom-control');
    if (zoomControl) {
      expect(zoomControl.style.opacity).toBe('0');
      expect(zoomControl.style.pointerEvents).toBe('none');
    }

    // 3. Mount VisionDockHost
    const dock = window.YouTubePlusVisionDockHost.mount(player);
    expect(dock).not.toBeNull();
    expect(dock.classList.contains('vision-top-center-dock')).toBe(true);
    expect(dock.children.length).toBeGreaterThan(0);

    // 4. Assert still no classic buttons exist in .ytp-right-controls
    expect(controls.querySelector('.yp-screenshot-button')).toBeNull();
    expect(controls.querySelector('.yp-download-button')).toBeNull();
    expect(controls.querySelector('.speed-control-btn')).toBeNull();
    expect(controls.querySelector('.yp-loop-button')).toBeNull();
    expect(controls.querySelector('#yp-zoom-button')).toBeNull();
  });

  test('under classic theme, classic buttons are inserted into .ytp-right-controls', () => {
    setupDom();
    loadChain('classic');

    expect(window.YouTubePlusDesignSystem.getThemeVariant()).toBe('classic');

    const controls = document.querySelector('.ytp-right-controls');
    expect(controls).not.toBeNull();

    const enhancer = window.YouTubePlusBasic.YouTubeEnhancer;
    enhancer.addCustomButtons();

    // In classic mode, classic buttons are inserted into .ytp-right-controls
    expect(controls.querySelector('.yp-screenshot-button')).not.toBeNull();
    expect(controls.querySelector('.yp-download-button')).not.toBeNull();
    expect(controls.querySelector('.speed-control-btn')).not.toBeNull();
    expect(controls.querySelector('.yp-loop-button')).not.toBeNull();
  });
});
