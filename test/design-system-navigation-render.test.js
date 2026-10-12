/**
 * StyleManager renders that span a `yt-navigate-start`: the pending render
 * frame is session-scoped, so a style added after the sweep in the same frame
 * still reaches the host. Real CleanupManager, utils.js navigation sweep and
 * design-system.js.
 * @jest-environment jsdom
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/design-system.js');
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

describe('StyleManager render across yt-navigate-start', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    global.mockLocation({ hostname: 'www.youtube.com', pathname: '/' });
    loadChain();
  });

  afterEach(() => {
    window.YouTubePlusDesignSystem?.StyleManager?.clear?.();
  });

  test('styles added before and after a navigation both render in one frame', async () => {
    const sm = window.YouTubePlusDesignSystem.StyleManager;

    sm.add('a', '.render-a { color: red; }');
    // The navigation arrives before the scheduled render frame; the frame must
    // survive it and pick up the later style.
    document.dispatchEvent(new Event('yt-navigate-start'));
    sm.add('b', '.render-b { color: blue; }');

    await nextFrame();

    const host = document.getElementById('youtube-plus-styles');
    expect(host).not.toBeNull();
    expect(host.textContent).toContain('.render-a { color: red; }');
    expect(host.textContent).toContain('.render-b { color: blue; }');
  });

  test('renders through the managed timer when requestAnimationFrame is unavailable', async () => {
    // Let the boot render settle so the next schedule really takes the
    // fallback path instead of piggy-backing on a pending frame.
    await nextFrame();
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = undefined;
    window.requestAnimationFrame = undefined;
    try {
      window.YouTubePlusDesignSystem.StyleManager.add('c', '.render-c { color: green; }');
      await new Promise(resolve => setTimeout(resolve, 20));

      const host = document.getElementById('youtube-plus-styles');
      expect(host).not.toBeNull();
      expect(host.textContent).toContain('.render-c { color: green; }');
    } finally {
      globalThis.requestAnimationFrame = raf;
      window.requestAnimationFrame = raf;
    }
  });

  test('falls back to a plain timeout when the cleanup manager has none', async () => {
    await nextFrame();
    const raf = globalThis.requestAnimationFrame;
    const cm = window.YouTubePlusCleanupManager;
    const originalTimeout = cm.timeout;
    globalThis.requestAnimationFrame = undefined;
    window.requestAnimationFrame = undefined;
    cm.timeout = undefined;
    try {
      window.YouTubePlusDesignSystem.StyleManager.add('d', '.render-d { color: teal; }');
      await new Promise(resolve => setTimeout(resolve, 20));

      const host = document.getElementById('youtube-plus-styles');
      expect(host.textContent).toContain('.render-d { color: teal; }');
    } finally {
      globalThis.requestAnimationFrame = raf;
      window.requestAnimationFrame = raf;
      cm.timeout = originalTimeout;
    }
  });
});
