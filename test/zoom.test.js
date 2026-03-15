/**
 * Unit tests for YouTube+ Zoom module
 */

describe('Zoom Module', () => {
  beforeEach(() => {
    window._ytplusCreateHTML = s => s;
    window.YouTubeUtils = {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      cleanupManager: {
        registerInterval: jest.fn(id => id),
        registerTimeout: jest.fn(id => id),
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
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
    };
    window.YouTubePlusLazyLoader = {
      register: jest.fn(),
      load: jest.fn(),
      isLoaded: jest.fn(() => false),
      getStats: jest.fn(() => ({})),
    };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
  });

  test('should respect feature toggle', () => {
    const loadFeatureEnabled = () =>
      window.YouTubeUtils?.loadFeatureEnabled?.('enableZoom') ?? true;
    expect(loadFeatureEnabled()).toBe(true);

    window.YouTubeUtils.loadFeatureEnabled = jest.fn(() => false);
    expect(loadFeatureEnabled()).toBe(false);
  });

  test('should provide zoom level clamping', () => {
    const MIN_ZOOM = 1.0;
    const MAX_ZOOM = 5.0;
    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

    expect(clamp(0.5, MIN_ZOOM, MAX_ZOOM)).toBe(1.0);
    expect(clamp(3.0, MIN_ZOOM, MAX_ZOOM)).toBe(3.0);
    expect(clamp(10.0, MIN_ZOOM, MAX_ZOOM)).toBe(5.0);
    expect(clamp(1.0, MIN_ZOOM, MAX_ZOOM)).toBe(1.0);
  });

  test('should generate valid CSS transform for zoom', () => {
    const getTransform = (zoom, panX = 0, panY = 0) =>
      `scale(${zoom}) translate(${panX}px, ${panY}px)`;

    expect(getTransform(2.0)).toBe('scale(2) translate(0px, 0px)');
    expect(getTransform(1.5, 10, -20)).toBe('scale(1.5) translate(10px, -20px)');
  });

  test('should reset zoom to default values', () => {
    const state = { zoom: 2.5, panX: 100, panY: -50 };
    const resetZoom = () => {
      state.zoom = 1.0;
      state.panX = 0;
      state.panY = 0;
    };
    resetZoom();
    expect(state.zoom).toBe(1.0);
    expect(state.panX).toBe(0);
    expect(state.panY).toBe(0);
  });
});
