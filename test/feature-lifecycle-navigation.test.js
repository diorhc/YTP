/**
 * FeatureLifecycle resources across an SPA navigation. Frames, intervals and
 * observers acquired through a feature context are session-scoped: the
 * `yt-navigate-start` sweep must not cancel them while the feature keeps
 * running on its route. Only ctx.dispose() releases them.
 * Real CleanupManager, utils.js navigation wiring and feature-registry.js.
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
}

const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;

/** A short real-time wait for requestAnimationFrame / MutationObserver. */
const settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

describe('feature context resources and SPA navigation', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    global.mockLocation({ hostname: 'www.youtube.com', pathname: '/' });
    loadChain();
  });

  afterEach(() => {
    lifecycle()?._reset?.();
    jest.useRealTimers();
  });

  test('a ctx frame survives yt-navigate-start while the feature runs', async () => {
    const ctx = lifecycle().createContext('probe');
    let runs = 0;
    ctx.frame(() => {
      runs++;
    });

    document.dispatchEvent(new Event('yt-navigate-start'));
    await settle();

    expect(runs).toBe(1);
    ctx.dispose();
  });

  test('a ctx observer keeps observing after yt-navigate-start', async () => {
    const ctx = lifecycle().createContext('probe2');
    let hits = 0;
    const el = document.createElement('div');
    document.body.appendChild(el);

    ctx.observe(new MutationObserver(() => hits++)).observe(el, { childList: true });
    document.dispatchEvent(new Event('yt-navigate-start'));
    el.appendChild(document.createElement('span'));
    await settle(20);

    expect(hits).toBe(1);
    ctx.dispose();
  });

  test('a ctx interval keeps ticking after yt-navigate-start', async () => {
    const ctx = lifecycle().createContext('probe4');
    let ticks = 0;
    ctx.interval(() => {
      ticks++;
    }, 20);

    document.dispatchEvent(new Event('yt-navigate-start'));
    await settle(90);

    expect(ticks).toBeGreaterThan(0);
    ctx.dispose();
  });

  test('the frame gate flag clears once the frame runs and can be re-armed', async () => {
    const ctx = lifecycle().createContext('probe3');
    /** @type {(() => void) | null} */
    let queued = null;
    let runs = 0;
    const queue = () => {
      if (queued) return;
      queued = ctx.frame(() => {
        queued = null;
        runs++;
      });
    };

    queue();
    document.dispatchEvent(new Event('yt-navigate-start'));
    await settle();
    expect(runs).toBe(1);
    expect(queued).toBeNull();

    queue();
    await settle();
    expect(runs).toBe(2);
    ctx.dispose();
  });

  test('after ctx.dispose the frame, the interval and the observer stay released', async () => {
    jest.useFakeTimers();
    const ctx = lifecycle().createContext('probe5');
    const el = document.createElement('div');
    document.body.appendChild(el);

    let mutated = 0;
    const observer = new MutationObserver(() => mutated++);
    ctx.observe(observer).observe(el, { childList: true });
    el.appendChild(document.createElement('i'));
    await Promise.resolve();
    await Promise.resolve();
    expect(mutated).toBe(1);

    const tick = jest.fn();
    const onFrame = jest.fn();
    ctx.interval(tick, 20);
    ctx.frame(onFrame);

    ctx.dispose();
    expect(ctx.active).toBe(false);

    el.appendChild(document.createElement('i'));
    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();

    expect(mutated).toBe(1);
    expect(tick).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
