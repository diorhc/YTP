/**
 * Tests for the tabview command bridge and the sandbox-side tabview API
 * added to window.YouTubePlusMain.
 *
 * The bridge exists so feature modules stop reaching into tabview internals:
 * before it, theater-overlay code clicked tab buttons directly and set
 * `keep-comments-scroller` with a plain setAttribute, bypassing the lock
 * protocol that owns that attribute in the page context.
 */

describe('tabview bridge — sandbox API', () => {
  /** @type {any[]} */
  let dispatched;
  /** @type {Array<{target:any,type:string,fn:Function}>} */
  let registered;

  beforeEach(() => {
    jest.resetModules();

    Object.defineProperty(globalThis, 'GM_addElement', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: { StyleManager: { add: jest.fn(), remove: jest.fn() } },
    });
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: { loadFeatureEnabled: jest.fn(() => true), logger: null },
    });

    registered = [];
    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        registerListener: jest.fn((target, type, fn) => {
          registered.push({ target, type, fn });
          target.addEventListener(type, fn);
          return fn;
        }),
      },
    });

    dispatched = [];
    const realDispatch = document.dispatchEvent.bind(document);
    jest.spyOn(document, 'dispatchEvent').mockImplementation(ev => {
      dispatched.push(ev);
      return realDispatch(ev);
    });

    delete window.__ytpMainBootDone__;
    delete window.__ytpMainExecDone__;
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('tabview-loaded');

    // The overlay — and therefore the injected page script — activates only on
    // a page that can host it; this suite drives the watch-page path.
    mockLocation({ href: 'https://www.youtube.com/watch?v=bridge-test' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete globalThis.GM_addElement;
    delete window.YouTubePlusDesignSystem;
    delete window.YouTubeUtils;
    delete window.YouTubePlusCleanupManager;
    delete window.__ytpMainBootDone__;
    delete window.__ytpMainExecDone__;
  });

  const load = () => {
    require('../src/main.js');
    return window.YouTubePlusMain;
  };

  test('exposes the documented tabview surface', () => {
    const api = load();
    for (const m of [
      'communicationKey',
      'isEnabled',
      'isReady',
      'getActiveTab',
      'getTabs',
      'switchToTab',
      'preloadComments',
      'releaseCommentsScroller',
      'expandLiveChat',
      'collapseLiveChat',
      'onTabChange',
      'onReady',
    ]) {
      expect(typeof api[m]).toBe('function');
    }
  });

  test('getTabs returns the four tabview tabs', () => {
    expect(load().getTabs()).toEqual(['#tab-info', '#tab-comments', '#tab-videos', '#tab-list']);
  });

  test('isReady reflects the tabview-loaded attribute', () => {
    const api = load();
    expect(api.isReady()).toBe(false);
    document.documentElement.setAttribute('tabview-loaded', '1');
    expect(api.isReady()).toBe(true);
  });

  test('getActiveTab reads tyt-tab off ytd-watch-flexy', () => {
    const api = load();
    expect(api.getActiveTab()).toBe(null);
    const flexy = document.createElement('ytd-watch-flexy');
    flexy.setAttribute('tyt-tab', '#tab-comments');
    document.body.append(flexy);
    expect(api.getActiveTab()).toBe('#tab-comments');
  });

  test('switchToTab sends a switchTab command carrying the tab id', () => {
    const api = load();
    dispatched.length = 0;
    expect(api.switchToTab('#tab-videos')).toBe(true);

    const key = api.communicationKey();
    const ev = dispatched.find(e => e.type === `yp-tabview-cmd::${key}`);
    expect(ev).toBeDefined();
    expect(ev.detail.cmd).toBe('switchTab');
    expect(ev.detail.args).toEqual({ tab: '#tab-videos' });
  });

  test.each([
    ['preloadComments', 'preloadComments'],
    ['releaseCommentsScroller', 'releaseCommentsScroller'],
    ['expandLiveChat', 'expandChat'],
    ['collapseLiveChat', 'collapseChat'],
  ])('%s sends the %s command', (method, cmd) => {
    const api = load();
    dispatched.length = 0;
    api[method]();
    const key = api.communicationKey();
    const ev = dispatched.find(e => e.type === `yp-tabview-cmd::${key}`);
    expect(ev).toBeDefined();
    expect(ev.detail.cmd).toBe(cmd);
  });

  test('onTabChange receives page-context notifications and unsubscribes', () => {
    const api = load();
    const key = api.communicationKey();
    const seen = [];
    const off = api.onTabChange(d => seen.push(d));

    document.dispatchEvent(
      new CustomEvent(`yp-tabview-evt::${key}`, {
        detail: { evt: 'tabchange', detail: { tab: '#tab-info' } },
      })
    );
    expect(seen).toEqual([{ tab: '#tab-info' }]);

    off();
    document.dispatchEvent(
      new CustomEvent(`yp-tabview-evt::${key}`, {
        detail: { evt: 'tabchange', detail: { tab: '#tab-list' } },
      })
    );
    expect(seen).toHaveLength(1);
  });

  test('a subscriber that throws does not break other subscribers', () => {
    const api = load();
    const key = api.communicationKey();
    const seen = [];
    api.onTabChange(() => {
      throw new Error('boom');
    });
    api.onTabChange(d => seen.push(d));

    expect(() =>
      document.dispatchEvent(
        new CustomEvent(`yp-tabview-evt::${key}`, {
          detail: { evt: 'tabchange', detail: { tab: '#tab-videos' } },
        })
      )
    ).not.toThrow();
    expect(seen).toEqual([{ tab: '#tab-videos' }]);
  });

  test('events for other keys are ignored', () => {
    const api = load();
    const seen = [];
    api.onTabChange(d => seen.push(d));
    document.dispatchEvent(
      new CustomEvent('yp-tabview-evt::someone-elses-key', {
        detail: { evt: 'tabchange', detail: { tab: '#tab-info' } },
      })
    );
    expect(seen).toHaveLength(0);
  });

  test('onTabChange ignores a non-function subscriber', () => {
    const api = load();
    expect(typeof api.onTabChange(null)).toBe('function');
  });

  test('the injected page script carries the communication key and the bridge', () => {
    const api = load();
    const attrs = globalThis.GM_addElement.mock.calls[0][2];
    expect(attrs.textContent).toContain(api.communicationKey());
    expect(attrs.textContent).toContain('yp-tabview-cmd::');
    expect(attrs.textContent).toContain('preloadCommentsTab');
    expect(attrs.textContent).toContain('removeKeepCommentsScrollerLock');
  });

  test('sendTabviewCmd returns false and calls logSuppressed when dispatchEvent throws', () => {
    const api = load();
    const logSuppressed = jest.fn();
    window.YouTubeUtils.logSuppressed = logSuppressed;
    jest.spyOn(document, 'dispatchEvent').mockImplementation(() => {
      throw new Error('dispatch failed');
    });
    expect(api.switchToTab('#tab-videos')).toBe(false);
    expect(logSuppressed).toHaveBeenCalled();
  });

  test('ignores events with missing evt or unknown evt without subscribers', () => {
    const api = load();
    const key = api.communicationKey();
    const seen = [];
    api.onTabChange(d => seen.push(d));
    document.dispatchEvent(new CustomEvent(`yp-tabview-evt::${key}`, { detail: null }));
    document.dispatchEvent(new CustomEvent(`yp-tabview-evt::${key}`, { detail: { evt: null } }));
    document.dispatchEvent(
      new CustomEvent(`yp-tabview-evt::${key}`, { detail: { evt: 'unregistered-event' } })
    );
    expect(seen).toHaveLength(0);
  });

  test('onReady receives ready event with tab list and can unsubscribe', () => {
    const api = load();
    const key = api.communicationKey();
    const readySeen = [];
    const off = api.onReady(d => readySeen.push(d));

    document.dispatchEvent(
      new CustomEvent(`yp-tabview-evt::${key}`, {
        detail: { evt: 'ready', detail: { tabs: ['#tab-info', '#tab-comments'] } },
      })
    );
    expect(readySeen).toEqual([{ tabs: ['#tab-info', '#tab-comments'] }]);
    off();
    document.dispatchEvent(
      new CustomEvent(`yp-tabview-evt::${key}`, {
        detail: { evt: 'ready', detail: { tabs: ['#tab-videos'] } },
      })
    );
    expect(readySeen).toHaveLength(1);
  });

  test('falls back to window.addEventListener when YouTubePlusCleanupManager is absent', () => {
    delete window.YouTubePlusCleanupManager;
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    load();
    const call = addEventListenerSpy.mock.calls.find(
      ([event]) => event === 'youtube-plus-settings-updated'
    );
    expect(call).toBeDefined();
  });

  test('falls back to document.documentElement when document.head is missing', () => {
    Object.defineProperty(document, 'head', { configurable: true, value: null });
    try {
      load();
      expect(globalThis.GM_addElement).toHaveBeenCalled();
      const [parent] = globalThis.GM_addElement.mock.calls[0];
      expect(parent).toBe(document.documentElement);
    } finally {
      delete document.head;
    }
  });
});
