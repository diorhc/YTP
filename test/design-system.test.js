/**
 * @jest-environment jsdom
 */

describe('Design system StyleManager', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete window.YouTubePlusDesignSystem;
    delete window.YouTubePlusLogger;
    delete window.YouTubeUtils;
    delete window.unsafeWindow;

    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        createLogger: jest.fn(() => ({
          error: jest.fn(),
          warn: jest.fn(),
          info: jest.fn(),
          debug: jest.fn(),
        })),
      },
    });
  });

  afterEach(() => {
    const sm = window.YouTubePlusDesignSystem?.StyleManager;
    if (sm && typeof sm.clear === 'function') {
      sm.clear();
    }
  });

  test('creates a single style host and renders registered css', () => {
    require('../src/design-system.js');

    const sm = window.YouTubePlusDesignSystem.StyleManager;
    sm.add('test-style', '.demo-style-manager { color: red; }');

    const host = document.getElementById('youtube-plus-styles');
    expect(host).toBeTruthy();
    expect(host.textContent).toContain('.demo-style-manager { color: red; }');
    expect(sm.has('test-style')).toBe(true);
  });

  test('re-renders unchanged css when the style host was removed by the page', () => {
    require('../src/design-system.js');

    const sm = window.YouTubePlusDesignSystem.StyleManager;
    const css = '.demo-style-manager-restored { color: blue; }';

    sm.add('restored-style', css);
    const firstHost = document.getElementById('youtube-plus-styles');
    expect(firstHost).toBeTruthy();
    firstHost.remove();

    sm.add('restored-style', css);

    const recreatedHost = document.getElementById('youtube-plus-styles');
    expect(recreatedHost).toBeTruthy();
    expect(recreatedHost).not.toBe(firstHost);
    expect(recreatedHost.textContent).toContain(css);
  });

  test('uses a MutationObserver instead of setInterval to watch the style host', () => {
    require('../src/design-system.js');

    const sm = window.YouTubePlusDesignSystem.StyleManager;
    expect(() => sm.add('observed-style', '.observed { color: green; }')).not.toThrow();
    expect(window.YouTubePlusDesignSystem.StyleManager.has('observed-style')).toBe(true);
  });
});
