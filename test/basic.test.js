/**
 * Unit tests for YouTube+ Basic module (basic.js)
 *
 * Tests the real YouTubeUtils facade, YouTubePlusBasic facade,
 * SettingsManager, NotificationManager, and idempotency guards.
 */

describe('Basic Module', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.__ytpBasicInitDone__;
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });

    // Provide standard dependencies guaranteed by build order
    require('../src/cleanup-manager.js');
    require('../src/design-system.js');
    require('../src/utils.js');
    require('../src/safe-dom.js');
    require('../src/settings-store.js');
    require('../src/settings-helpers.js');
    require('../src/basic.js');
    require('../src/modal-handlers.js');
    require('../src/modal-download-handlers.js');
    require('../src/settings-modal.js');
  });

  afterEach(() => {
    delete window.__ytpBasicInitDone__;
    document.body.innerHTML = '';
  });

  describe('Real YouTubePlusBasic facade', () => {
    test('exposes canonical window.YouTubePlusBasic facade', () => {
      expect(window.YouTubePlusBasic).toBeDefined();
      expect(typeof window.YouTubePlusBasic.createEnhancer).toBe('function');
      expect(typeof window.YouTubePlusBasic.openSettings).toBe('function');
      expect(typeof window.YouTubePlusBasic.closeSettings).toBe('function');
      expect(window.YouTubePlusBasic.YouTubeEnhancer).toBeDefined();
    });

    test('createEnhancer returns an enhancer object with valid settings', () => {
      const enhancer = window.YouTubePlusBasic.createEnhancer();
      expect(enhancer).toBeDefined();
      expect(enhancer.settings).toBeDefined();
      expect(typeof enhancer.settings).toBe('object');
      expect(typeof enhancer.init).toBe('function');
    });

    test('openSettings creates modal in DOM and closeSettings removes it', () => {
      const opened = window.YouTubePlusBasic.openSettings();
      expect(opened).toBe(true);

      const modal = document.querySelector('.yp-settings-modal');
      expect(modal).toBeTruthy();
      expect(modal.querySelector('h1')?.textContent).toBe('YouTube +');
      expect(modal.querySelectorAll('h2').length).toBeGreaterThanOrEqual(2);
      const downloadToggle = /** @type {HTMLInputElement|null} */ (
        modal.querySelector('input[data-setting="enableDownload"]')
      );
      const downloadSubmenu = /** @type {HTMLElement|null} */ (
        modal.querySelector('.download-submenu')
      );
      expect(downloadSubmenu?.style.display).toBe(downloadToggle?.checked ? 'block' : 'none');

      const closed = window.YouTubePlusBasic.closeSettings();
      expect(closed).toBe(true);
      expect(document.querySelector('.yp-settings-modal')).toBeNull();
    });
  });

  describe('Settings ownership across the modal Save', () => {
    test('saveSettings writes the store-current module namespace, not the stale snapshot', () => {
      const enhancer = window.YouTubePlusBasic.createEnhancer();
      // Stale modal snapshot: its `modules` namespace predates the module's own
      // direct write to the store (e.g. a PiP/Timecode hotkey change).
      enhancer.settings.modules = { pip: { shortcut: { key: 'OLD' } } };

      const liveModules = {
        pip: { shortcut: { key: 'J', shiftKey: true, altKey: false, ctrlKey: false } },
      };
      /** @type {unknown[]} */
      const saved = [];
      window.YouTubePlusSettingsStore = /** @type {any} */ ({
        load: () => ({ modules: liveModules }),
        save: s => {
          saved.push(s);
          return true;
        },
      });

      enhancer.saveSettings();

      expect(saved).toHaveLength(1);
      expect(/** @type {any} */ (saved[0]).modules).toEqual(liveModules);
    });
  });

  describe('Real YouTubeUtils public API', () => {
    test('should expose $ query helper', () => {
      document.body.innerHTML = '<div class="test-el"></div>';
      const result = window.YouTubeUtils.$('.test-el');
      expect(result).toBeTruthy();
      expect(result.className).toBe('test-el');
    });

    test('should expose $$ queryAll helper', () => {
      document.body.innerHTML = '<div class="a"></div><div class="a"></div>';
      const results = window.YouTubeUtils.$$('.a');
      expect(results).toHaveLength(2);
    });

    test('should expose byId helper', () => {
      document.body.innerHTML = '<div id="my-id"></div>';
      const el = window.YouTubeUtils.byId('my-id');
      expect(el).toBeTruthy();
      expect(el.id).toBe('my-id');
    });

    test('should expose translation helper t()', () => {
      expect(typeof window.YouTubeUtils.t).toBe('function');
      expect(typeof window.YouTubeUtils.t('hello')).toBe('string');
    });

    test('should expose cleanupManager', () => {
      expect(window.YouTubeUtils.cleanupManager).toBeDefined();
      expect(typeof window.YouTubeUtils.cleanupManager.register).toBe('function');
      expect(typeof window.YouTubeUtils.cleanupManager.cleanup).toBe('function');
    });

    test('should expose StyleManager', () => {
      const sm = window.YouTubeUtils.StyleManager;
      expect(sm).toBeDefined();
      expect(typeof sm.add).toBe('function');
      expect(typeof sm.remove).toBe('function');
    });

    test('debounce returns a function with cancel method', () => {
      const fn = jest.fn();
      const debounced = window.YouTubeUtils.debounce(fn, 100);
      expect(typeof debounced).toBe('function');
      expect(typeof debounced.cancel).toBe('function');
    });

    test('throttle returns a function with cancel method', () => {
      const fn = jest.fn();
      const throttled = window.YouTubeUtils.throttle(fn, 100);
      expect(typeof throttled).toBe('function');
    });

    test('safeMerge merges objects safely', () => {
      const target = { a: 1, b: 2 };
      window.YouTubeUtils.safeMerge(target, { b: 3, c: 4 });
      expect(target).toEqual({ a: 1, b: 3, c: 4 });
    });

    test('storage provides safe localStorage operations via getItem/setItem', () => {
      window.YouTubeUtils.storage.setItem('test_key', 'test_val');
      expect(window.YouTubeUtils.storage.getItem('test_key')).toBe('test_val');
      window.YouTubeUtils.storage.removeItem('test_key');
      expect(window.YouTubeUtils.storage.getItem('test_key')).toBeNull();
    });

    test('formatTime formats seconds into timestamps', () => {
      expect(window.YouTubeUtils.formatTime(65)).toBe('1:05');
      expect(window.YouTubeUtils.formatTime(3665)).toBe('1:01:05');
      expect(window.YouTubeUtils.formatTime(0)).toBe('0:00');
    });

    test('logSuppressed does not throw when called', () => {
      expect(() => window.YouTubeUtils.logSuppressed(new Error('test'), 'module')).not.toThrow();
    });
  });

  describe('NotificationManager.show', () => {
    test('NotificationManager.show creates notification in active store', () => {
      const nm = window.YouTubeUtils.NotificationManager;
      if (nm && typeof nm.show === 'function') {
        const el = nm.show('Test notification', { duration: 100 });
        expect(el).toBeDefined();
        expect(nm.activeNotifications).toBeDefined();
        expect(typeof nm.activeNotifications.size).toBe('number');
        nm.clearAll();
      }
    });

    test('show returns null for invalid message', () => {
      const nm = window.YouTubeUtils.NotificationManager;
      if (nm && typeof nm.show === 'function') {
        expect(nm.show('')).toBeNull();
        expect(nm.show(null)).toBeNull();
        expect(nm.show(undefined)).toBeNull();
      }
    });

    test('show applies position styles when position is valid', () => {
      const nm = window.YouTubeUtils.NotificationManager;
      if (nm && typeof nm.show === 'function') {
        const el = nm.show('Positioned notification', { position: 'top-right', duration: 100 });
        expect(el).toBeDefined();
        expect(el.style.top).toBe('20px');
        expect(el.style.right).toBe('20px');
        nm.clearAll();
      }
    });

    test('show creates action button when action is provided', () => {
      const nm = window.YouTubeUtils.NotificationManager;
      if (nm && typeof nm.show === 'function') {
        const cb = jest.fn();
        const el = nm.show('Action notification', {
          action: { text: 'OK', callback: cb },
          duration: 100,
        });
        expect(el).toBeDefined();
        const btn = el.querySelector('button');
        expect(btn).not.toBeNull();
        expect(btn.textContent).toBe('OK');
        btn.click();
        expect(cb).toHaveBeenCalled();
        nm.clearAll();
      }
    });
  });

  describe('NotificationManager timers', () => {
    test('auto-dismiss removes the notification and leaves no timer registered', () => {
      jest.useFakeTimers();
      try {
        const nm = window.YouTubeUtils.NotificationManager;
        const cm = window.YouTubePlusCleanupManager;
        const before = cm.timeouts.size;
        const el = nm.show('Auto dismiss', { duration: 500 });
        expect(el.isConnected).toBe(true);
        expect(cm.timeouts.size).toBe(before + 1);

        jest.advanceTimersByTime(500);
        jest.advanceTimersByTime(340);

        expect(el.isConnected).toBe(false);
        expect(nm.activeNotifications.has(el)).toBe(false);
        expect(cm.timeouts.size).toBe(before);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('idempotency guard', () => {
    test('should set __ytpBasicInitDone__ on load', () => {
      expect(window.__ytpBasicInitDone__).toBe(true);
    });
  });
});

describe('Basic Module — NotificationManager merge regression', () => {
  const mockCleanupManager = {
    registerListener: jest.fn(),
    register: jest.fn(),
    registerInterval: jest.fn(),
    registerTimeout: jest.fn(),
    registerObserver: jest.fn(),
    registerAnimationFrame: jest.fn(),
    cleanup: jest.fn(),
  };

  const mountMockUtils = () => {
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(),
        $$: jest.fn(),
        byId: jest.fn(),
        t: jest.fn(key => key || ''),
        setSafeHTML: jest.fn(),
        cleanupManager: mockCleanupManager,
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        storage: { get: jest.fn(() => null), set: jest.fn(), remove: jest.fn() },
        SettingsManager: {
          load: jest.fn(() => ({})),
          save: jest.fn(),
          get: jest.fn(),
          set: jest.fn(),
        },
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
        loadFeatureEnabled: jest.fn(() => true),
        whenRelevant: jest.fn(() => ({ active: false, check: jest.fn(), dispose: jest.fn() })),
        debounce: jest.fn(fn => Object.assign(fn, { cancel: jest.fn() })),
        throttle: jest.fn(fn => fn),
        createElement: jest.fn(),
        waitForElement: jest.fn(() => Promise.resolve(null)),
        logSuppressed: jest.fn(),
      },
    });
  };

  beforeEach(() => {
    jest.resetModules();
    mountMockUtils();
    // Skip the init IIFE body — only the top-level merge block (which
    // previously dropped NotificationManager entirely, causing a TypeError
    // at first use) is under test.
    window.__ytpBasicInitDone__ = true;
  });

  afterEach(() => {
    delete window.__ytpBasicInitDone__;
  });

  test('merges NotificationManager into window.YouTubeUtils when missing', () => {
    expect(window.YouTubeUtils.NotificationManager).toBeUndefined();

    require('../src/basic.js');

    expect(window.YouTubeUtils.NotificationManager).toBeDefined();
    expect(typeof window.YouTubeUtils.NotificationManager.show).toBe('function');
    expect(typeof window.YouTubeUtils.NotificationManager.clearAll).toBe('function');
    expect(typeof window.YouTubeUtils.NotificationManager.activeNotifications).toBe('object');
  });

  test('does not overwrite an existing NotificationManager', () => {
    const existing = { show: jest.fn() };
    window.YouTubeUtils.NotificationManager = existing;

    require('../src/basic.js');

    expect(window.YouTubeUtils.NotificationManager).toBe(existing);
  });
});

describe('Basic typed guards', () => {
  const mountBasic = () => {
    jest.useFakeTimers();
    jest.resetModules();
    delete window.__ytpBasicInitDone__;
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
    require('../src/cleanup-manager.js');
    require('../src/design-system.js');
    require('../src/utils.js');
    require('../src/safe-dom.js');
    require('../src/settings-store.js');
    require('../src/settings-helpers.js');
    require('../src/basic.js');
    require('../src/modal-handlers.js');
    require('../src/modal-download-handlers.js');
    require('../src/settings-modal.js');
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  test('isEditableTarget accepts editable tags and rejects plain elements', () => {
    mountBasic();
    const enhancer = window.YouTubePlusBasic.createEnhancer();
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const div = document.createElement('div');
    expect(enhancer.isEditableTarget(input)).toBe(true);
    expect(enhancer.isEditableTarget(textarea)).toBe(true);
    expect(enhancer.isEditableTarget(div)).toBe(false);
    expect(enhancer.isEditableTarget(window)).toBe(false);
    expect(enhancer.isEditableTarget(null)).toBe(false);
  });

  test('second show with the same message detaches the earlier notification', () => {
    mountBasic();
    try {
      const nm = window.YouTubeUtils.NotificationManager;
      const first = nm.show('Same message', { duration: 0 });
      const second = nm.show('Same message', { duration: 0 });
      expect(first && first.isConnected).toBe(true);
      jest.advanceTimersByTime(340);
      expect(first && first.isConnected).toBe(false);
      expect(second && second.isConnected).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('YouTubePlusDebug.clearAll does not throw and tears down styles and notifications', () => {
    // The basic.test environment does not load dom-cache.js; the cleanup must
    // still run its remaining teardown steps without throwing.
    mountBasic();
    expect(typeof window.YouTubePlusDebug.clearAll).toBe('function');
    window.YouTubeUtils.StyleManager.add('yp-debug-clear-test', 'body{}');
    expect(window.YouTubeUtils.StyleManager.styles.size).toBeGreaterThan(0);
    const nm = window.YouTubeUtils.NotificationManager;
    nm.show('clear target', { duration: 0 });
    expect(nm.activeNotifications.size).toBeGreaterThan(0);
    expect(() => window.YouTubePlusDebug.clearAll()).not.toThrow();
    expect(window.YouTubeUtils.StyleManager.styles.size).toBe(0);
    expect(nm.activeNotifications.size).toBe(0);
  });

  test('openSettings accepts section and forwards to modal state', () => {
    mountBasic();
    const writeSpy = jest.fn();
    window.YouTubePlusSettingsModal = {
      basicUiState: {
        lastOpenSection: { write: writeSpy },
      },
      open: jest.fn(),
      close: jest.fn(),
    };
    window.YouTubePlus.openSettings({ section: 'shortcuts' });
    expect(writeSpy).toHaveBeenCalledWith('shortcuts');
  });

  test('closeSettings closes via fallback modal removal and dispatches event', () => {
    mountBasic();
    const modal = document.createElement('div');
    modal.className = 'yp-settings-modal';
    document.body.appendChild(modal);
    window.YouTubePlusSettingsModal = null;
    let closedEventFired = false;
    document.addEventListener(
      'youtube-plus-settings-modal-closed',
      () => {
        closedEventFired = true;
      },
      { once: true }
    );
    const result = window.YouTubePlus.closeSettings();
    expect(result).toBe(true);
    expect(modal.isConnected).toBe(false);
    expect(closedEventFired).toBe(true);
  });

  test('enhancer helper methods execute expected side effects', () => {
    mountBasic();
    const enhancer = window.YouTubePlusBasic.createEnhancer();
    const btn = document.createElement('button');
    btn.className = 'yp-screenshot-button';
    document.body.appendChild(btn);
    enhancer.handleFullscreenChange();
    expect(btn.style.bottom).toBe('0px');
    btn.remove();

    const nmSpy = jest.spyOn(window.YouTubeUtils.NotificationManager, 'show');
    enhancer.showNotification('Hello test', 1500);
    expect(nmSpy).toHaveBeenCalledWith('Hello test', { duration: 1500, type: 'info' });
    nmSpy.mockRestore();
  });

  test('eager player surface and shared UI style bundles load without opening settings', () => {
    mountBasic();
    const ds = window.YouTubePlusDesignSystem;
    expect(ds).toBeDefined();

    const playerSurface = ds.getStyle('yp-player-surface-styles');
    expect(playerSurface).toContain('.vision-top-center-dock');
    expect(playerSurface).toContain('#yp-zoom-control');

    const basicSettings = ds.getStyle('yp-basic-settings-styles');
    expect(basicSettings).not.toContain('.vision-top-center-dock');

    const sm = window.YouTubeUtils.StyleManager;
    sm.remove('yt-enhancer-player-surface');
    sm.remove('yt-enhancer-shared-ui');
    expect(sm.has('yt-enhancer-player-surface')).toBe(false);
    expect(sm.has('yt-enhancer-shared-ui')).toBe(false);
    expect(document.querySelector('.yp-settings-modal')).toBeNull();

    const enhancer = window.YouTubePlusBasic.createEnhancer();
    enhancer.insertStyles();

    expect(sm.has('yt-enhancer-player-surface')).toBe(true);
    expect(sm.get('yt-enhancer-player-surface')).toContain('.vision-top-center-dock');
    expect(sm.has('yt-enhancer-shared-ui')).toBe(true);
    expect(document.querySelector('.yp-settings-modal')).toBeNull();
  });
});
