/**
 * Unit tests for the download button surface: style injection, the site
 * dropdown, the clipboard/YTDL handoff, the hover delegation, the rebuild hook
 * and the feature-lifecycle start/stop pair.
 */

describe('Download button UI', () => {
  const createLogger = () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  });

  /**
   * @param {Record<string, unknown>} settings
   * @param {boolean} [enabled] settings value for enableDownload
   */
  function boot(settings, enabled = true) {
    window.YouTubeUtils.setSafeHTML = jest.fn((el, html) => {
      el.innerHTML = html;
    });
    window.YouTubePlusSettingsStore = {
      get: jest.fn(() => enabled),
      subscribe: jest.fn(() => jest.fn()),
    };
    delete window.YouTubePlusFeatureRegistry;
    jest.resetModules();
    require('../src/feature-registry.js');
    require('../src/download.js');

    const controls = document.createElement('div');
    controls.className = 'ytp-right-controls';
    document.body.appendChild(controls);

    const manager = window.YouTubePlusDownloadButton.createDownloadButtonManager({
      settings,
      t: k => k,
      getElement: sel => document.querySelector(sel),
      YouTubeUtils: window.YouTubeUtils,
    });
    manager.addDownloadButton(controls);
    return { controls, manager };
  }

  const allSites = {
    enableDownload: true,
    downloadSites: { externalDownloader: true, ytdl: true, direct: true },
  };

  const DEFAULT_RECT = {
    left: 400,
    top: 500,
    right: 440,
    bottom: 536,
    width: 40,
    height: 36,
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.resetModules();
    require('../src/utils.js');
    const canonUtils = window.YouTubeUtils;
    window._ytplusCreateHTML = s => s;
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(sel => document.querySelector(sel)),
        $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
        getVideoIdFromUrl: canonUtils.getVideoIdFromUrl,
        getVideoIdFromLocation: jest.fn(canonUtils.getVideoIdFromLocation),
        t: jest.fn(key => key || ''),
        setSafeHTML: jest.fn((el, html) => {
          el.innerHTML = html;
        }),
        openSafe: jest.fn(),
        createVisibilityAwareInterval: jest.fn((cb, delay) => {
          const id = setInterval(cb, delay);
          return {
            active: true,
            stop: () => clearInterval(id),
            pause: () => clearInterval(id),
            resume: jest.fn(),
          };
        }),
        cleanupManager: {
          register: jest.fn(),
          registerInterval: jest.fn(id => id),
          registerTimeout: jest.fn(id => id),
          registerObserver: jest.fn(obs => obs),
          registerListener: jest.fn((target, event, fn, opts) => {
            target.addEventListener(event, fn, opts);
            return Symbol('listener');
          }),
          cleanup: jest.fn(),
          registerAnimationFrame: jest.fn(id => id),
        },
        NotificationManager: { show: jest.fn(), hide: jest.fn() },
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        logError: jest.fn(),
        createElement: jest.fn(tag => document.createElement(tag)),
        loadFeatureEnabled: jest.fn(() => true),
        storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        SETTINGS_KEY: 'youtube_plus_settings',
        isWatchRoute: jest.fn(() => true),
        isShortsRoute: jest.fn(() => false),
        isYouTubeDomain: jest.fn(() => true),
        isChannelRoute: jest.fn(() => false),
        isSettingsModalOpen: jest.fn(() => false),
        createIsRelevantRoute: () => () => true,
        createWithErrorBoundary: _name => fn => fn,
        logSuppressed: jest.fn(),
        getRoute: jest.fn(() => 'watch'),
      },
    });
    Object.defineProperty(window, 'YouTubePlusI18n', {
      configurable: true,
      writable: true,
      value: {
        t: jest.fn(key => key),
        getLanguage: jest.fn(() => 'en'),
        loadTranslations: jest.fn(),
        isReady: jest.fn(() => true),
      },
    });
    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        createLogger: jest.fn(() => createLogger()),
        setLevel: jest.fn(),
        getLevel: jest.fn(() => 'info'),
        getRecent: jest.fn(() => []),
        export: jest.fn(),
        createChild: jest.fn(),
      },
    });
    Object.defineProperty(window, 'YouTubePlusDOMCache', {
      configurable: true,
      writable: true,
      value: {
        get: jest.fn(),
        querySelector: jest.fn(),
        getAll: jest.fn(),
        querySelectorAll: jest.fn(),
        getElementById: jest.fn(),
        waitForElement: jest.fn(),
        invalidate: jest.fn(),
        clear: jest.fn(),
      },
    });

    global.mockLocation({
      href: 'https://www.youtube.com/watch?v=test12345ab',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=test12345ab',
    });
    global.fetch = jest.fn(() => Promise.reject(new Error('network disabled in unit tests')));

    // The dropdown positioner batches into requestAnimationFrame; capture the
    // callback so a test can run the pass explicitly.
    rafCallbacks = [];
    global.requestAnimationFrame = cb => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
  });

  /** @type {Array<FrameRequestCallback>} */
  let rafCallbacks = [];

  const runPositioning = () => {
    const pending = rafCallbacks;
    rafCallbacks = [];
    pending.forEach(cb => {
      cb(0);
    });
  };

  const button = () => /** @type {HTMLElement} */ (document.querySelector('.yp-download-button'));
  const dropdown = () => /** @type {HTMLElement} */ (document.querySelector('.download-options'));
  const items = () => Array.from(document.querySelectorAll('.download-option-item'));
  const notifications = () =>
    window.YouTubeUtils.NotificationManager.show.mock.calls.map(call => String(call[0]));

  describe('style injection', () => {
    test('the design-system stylesheet is registered through StyleManager', () => {
      window.YouTubePlusDesignSystem = {
        getStyle: jest.fn(() => '.yp-download-button{color:red}'),
      };
      boot(allSites);

      expect(window.YouTubeUtils.StyleManager.add).toHaveBeenCalledWith(
        'yp-download-button-styles',
        '.yp-download-button{color:red}'
      );
      delete window.YouTubePlusDesignSystem;
    });

    test('a throwing design system is tolerated', () => {
      window.YouTubePlusDesignSystem = {
        getStyle: jest.fn(() => {
          throw new Error('design system not ready');
        }),
      };
      expect(() => boot(allSites)).not.toThrow();
      expect(button()).toBeTruthy();
      delete window.YouTubePlusDesignSystem;
    });

    test('a design system without the style id injects nothing', () => {
      window.YouTubePlusDesignSystem = { getStyle: jest.fn(() => '') };
      boot(allSites);
      expect(window.YouTubeUtils.StyleManager.add).not.toHaveBeenCalled();
      delete window.YouTubePlusDesignSystem;
    });
  });

  describe('site dropdown', () => {
    test('every enabled site becomes a menu item', () => {
      boot(allSites);
      expect(items().map(i => i.textContent)).toEqual(['SSYouTube', 'by YTDL', 'directDownload']);
      expect(items()[1].getAttribute('data-is-ytdl')).toBe('true');
      expect(items()[2].getAttribute('data-is-direct')).toBe('true');
    });

    test('a disabled site is filtered out of the menu', () => {
      boot({ downloadSites: { externalDownloader: true, ytdl: false, direct: true } });
      expect(items().map(i => i.textContent)).toEqual(['SSYouTube', 'directDownload']);
    });

    test('a customised external downloader name and url are honoured', () => {
      boot({
        downloadSiteCustomization: {
          externalDownloader: {
            name: 'MyMirror',
            url: 'https://mirror.test/?v={videoId}&u={videoUrl}',
          },
        },
        downloadSites: { externalDownloader: true, ytdl: true, direct: true },
      });
      expect(items()[0].textContent).toBe('MyMirror');
      expect(items()[0].getAttribute('data-url')).toBe(
        `https://mirror.test/?v=test12345ab&u=${encodeURIComponent(
          'https://www.youtube.com/watch?v=test12345ab'
        )}`
      );
    });

    test('clicking a site opens it and closes the dropdown', () => {
      boot(allSites);
      /** @type {HTMLElement} */ (items()[0]).click();

      expect(window.YouTubeUtils.openSafe).toHaveBeenCalledWith(
        'https://ssyoutube.com/watch?v=test12345ab',
        '_blank'
      );
      expect(button().getAttribute('aria-expanded')).toBe('false');
      expect(dropdown()?.classList.contains('visible')).toBe(false);
    });

    test('a site can be opened with the keyboard', () => {
      boot(allSites);
      /** @type {HTMLElement} */ (items()[0]).dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
      expect(window.YouTubeUtils.openSafe).toHaveBeenCalled();

      const before = window.YouTubeUtils.openSafe.mock.calls.length;
      items()[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      document
        .querySelector('.download-options-list')
        ?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      expect(window.YouTubeUtils.openSafe.mock.calls.length).toBe(before);
    });

    test('a click on the list background is ignored', () => {
      boot(allSites);
      document
        .querySelector('.download-options-list')
        ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      expect(window.YouTubeUtils.openSafe).not.toHaveBeenCalled();
    });

    test('a click that does not resolve to one of our items is ignored', () => {
      boot(allSites);
      // The dropdown itself carries no activation, and the button only reacts
      // to hover while several sites are configured.
      dropdown()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      button().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      expect(window.YouTubeUtils.openSafe).not.toHaveBeenCalled();
    });

    test('a single enabled site turns the button into a direct action', async () => {
      boot({ downloadSites: { externalDownloader: false, ytdl: false, direct: true } });
      const openModalSpy = jest.spyOn(window.YouTubePlusDownload, 'openModal');

      expect(dropdown()).toBeNull();
      expect(button().style.cursor).toBe('pointer');
      button().click();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(openModalSpy).toHaveBeenCalled();
    });

    test('window.open is used when openSafe is unavailable', () => {
      boot(allSites);
      delete window.YouTubeUtils.openSafe;
      const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
      /** @type {HTMLElement} */ (items()[0]).click();
      expect(openSpy).toHaveBeenCalledWith('https://ssyoutube.com/watch?v=test12345ab', '_blank');
    });
  });

  describe('clipboard and the local YTDL handoff', () => {
    /** @param {unknown} clipboardValue */
    function setClipboard(clipboardValue) {
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: clipboardValue,
      });
    }

    test('the modern clipboard API is preferred', async () => {
      const writeText = jest.fn(() => Promise.resolve());
      setClipboard({ writeText });
      boot(allSites);

      /** @type {HTMLElement} */ (items()[1]).click();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith('https://www.youtube.com/watch?v=test12345ab');
      expect(notifications()).toContain('copiedToClipboard');
      expect(window.YouTubeUtils.openSafe).toHaveBeenCalledWith('http://localhost:5005', '_blank');
      setClipboard(undefined);
    });

    test('the execCommand fallback reports success', async () => {
      setClipboard(undefined);
      document.execCommand = jest.fn(() => true);
      boot(allSites);

      /** @type {HTMLElement} */ (items()[1]).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(notifications()).toContain('copiedToClipboard');
      expect(document.querySelector('.dl-clipboard-proxy')).toBeNull();
    });

    test('the execCommand fallback reports failure', async () => {
      setClipboard(undefined);
      document.execCommand = jest.fn(() => false);
      boot(allSites);

      /** @type {HTMLElement} */ (items()[1]).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(notifications()).toContain('copyFailed');
    });

    test('a throwing execCommand is reported as a copy failure', async () => {
      setClipboard(undefined);
      document.execCommand = jest.fn(() => {
        throw new Error('execCommand removed');
      });
      boot(allSites);

      /** @type {HTMLElement} */ (items()[1]).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(notifications()).toContain('copyFailed');
    });

    test('a rejected clipboard write is reported as a copy failure', async () => {
      setClipboard({ writeText: () => Promise.reject(new Error('denied')) });
      boot(allSites);

      /** @type {HTMLElement} */ (items()[1]).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(notifications()).toContain('copyFailed');
      setClipboard(undefined);
    });

    test('without a video id the current location is copied instead', async () => {
      global.mockLocation({
        href: 'https://www.youtube.com/feed/history',
        pathname: '/feed/history',
        search: '',
      });
      const writeText = jest.fn(() => Promise.resolve());
      setClipboard({ writeText });
      boot(allSites);

      /** @type {HTMLElement} */ (items()[1]).click();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith('https://www.youtube.com/feed/history');
      setClipboard(undefined);
    });
  });

  describe('direct download entry', () => {
    test('a direct entry falls back to downloadVideo when openModal is absent', async () => {
      boot({ downloadSites: { externalDownloader: false, ytdl: false, direct: true } });
      const saved = window.YouTubePlusDownload;
      const downloadVideo = jest.fn(() => Promise.resolve());
      window.YouTubePlusDownload = { downloadVideo };
      try {
        button().click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(downloadVideo).toHaveBeenCalledWith({ format: 'video', quality: '1080' });
      } finally {
        window.YouTubePlusDownload = saved;
      }
    });

    test('an API with neither entry point reports the module as unavailable', async () => {
      boot({ downloadSites: { externalDownloader: false, ytdl: false, direct: true } });
      const saved = window.YouTubePlusDownload;
      window.YouTubePlusDownload = {};
      try {
        button().click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(notifications()).toContain('directDownloadModuleNotAvailable');
      } finally {
        window.YouTubePlusDownload = saved;
      }
    });

    test('a throwing direct download reports the failure', async () => {
      boot({ downloadSites: { externalDownloader: false, ytdl: false, direct: true } });
      const saved = window.YouTubePlusDownload;
      window.YouTubePlusDownload = {
        downloadVideo: () => Promise.reject(new Error('converter offline')),
      };
      try {
        button().click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(notifications()).toContain('directDownloadModuleNotAvailable');
      } finally {
        window.YouTubePlusDownload = saved;
      }
    });

    test('a missing download module reports the module as unavailable', async () => {
      boot({ downloadSites: { externalDownloader: false, ytdl: false, direct: true } });
      const saved = window.YouTubePlusDownload;
      delete window.YouTubePlusDownload;
      try {
        button().click();
        await new Promise(resolve => setTimeout(resolve, 2600));
        expect(notifications()).toContain('directDownloadModuleNotAvailable');
      } finally {
        window.YouTubePlusDownload = saved;
      }
    }, 10000);

    test('the download API is awaited when the module appears after the click', async () => {
      // Without createVisibilityAwareInterval the module falls back to its own
      // setInterval polling, which must pick the API up once it shows up. The
      // helper is captured when the module loads, so it has to be missing
      // before the module is required.
      delete window.YouTubeUtils.createVisibilityAwareInterval;
      boot({ downloadSites: { externalDownloader: false, ytdl: false, direct: true } });
      const api = window.YouTubePlusDownload;
      const openModalSpy = jest.spyOn(api, 'openModal');
      window.YouTubePlusDownload = null;
      button().click();
      window.YouTubePlusDownload = api;
      await new Promise(resolve => setTimeout(resolve, 400));
      expect(openModalSpy).toHaveBeenCalled();
      expect(notifications()).not.toContain('directDownloadModuleNotAvailable');
    });

    test('the YTDL handoff opens a tab directly when openSafe is missing', async () => {
      boot(allSites);
      delete window.YouTubeUtils.openSafe;
      const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
      /** @type {HTMLElement} */ (items()[1]).click();
      await Promise.resolve();
      expect(openSpy).toHaveBeenCalledWith('http://localhost:5005', '_blank');
    });
  });

  describe('hover and keyboard dropdown behaviour', () => {
    test('hovering the button shows the dropdown and leaving hides it', async () => {
      boot(allSites);
      const btn = button();
      btn.getBoundingClientRect = () => /** @type {DOMRect} */ ({ ...DEFAULT_RECT });

      btn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
      runPositioning();
      expect(dropdown()?.classList.contains('visible')).toBe(true);
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      expect(dropdown()?.style.bottom).not.toBe('auto');

      btn.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(dropdown()?.classList.contains('visible')).toBe(false);
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    test('hovering the dropdown itself keeps it open', async () => {
      boot(allSites);
      const btn = button();
      btn.getBoundingClientRect = () => /** @type {DOMRect} */ ({ ...DEFAULT_RECT });
      btn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
      runPositioning();

      const list = /** @type {HTMLElement} */ (document.querySelector('.download-options-list'));
      list.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
      runPositioning();
      expect(dropdown()?.classList.contains('visible')).toBe(true);

      list.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 400));
      expect(dropdown()?.classList.contains('visible')).toBe(false);
    });

    test('an invisible anchor is not positioned', () => {
      boot(allSites);
      const btn = button();
      btn.getBoundingClientRect = () =>
        /** @type {DOMRect} */ ({ ...DEFAULT_RECT, width: 0, height: 0 });
      btn.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
      runPositioning();
      expect(dropdown()?.style.bottom).toBe('');
    });

    test('Enter and Space on the button toggle the dropdown', async () => {
      boot(allSites);
      const btn = button();
      btn.getBoundingClientRect = () => /** @type {DOMRect} */ ({ ...DEFAULT_RECT });

      btn.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      runPositioning();
      expect(dropdown()?.classList.contains('visible')).toBe(true);

      btn.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(dropdown()?.classList.contains('visible')).toBe(false);

      btn.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      expect(dropdown()?.classList.contains('visible')).toBe(false);
    });

    test('keyboard events outside a download button are ignored', () => {
      boot(allSites);
      document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
      document.body.dispatchEvent(new window.MouseEvent('mouseenter'));
      document.body.dispatchEvent(new window.MouseEvent('mouseleave'));
      expect(dropdown()?.classList.contains('visible')).toBe(false);
    });
  });

  describe('rebuild, refresh and stray buttons', () => {
    test('the rebuild hook re-creates the button and its dropdown', () => {
      boot(allSites);
      const first = button();
      document.querySelector('.download-options')?.remove();

      window.YouTubePlusDownloadButton.rebuildDownloadDropdown();
      expect(button()).toBeTruthy();
      expect(button()).not.toBe(first);
      expect(document.querySelector('.download-options')).toBeTruthy();
    });

    test('a rebuild failure is logged instead of escaping', () => {
      boot(allSites);
      const bodySpy = jest.spyOn(document, 'body', 'get').mockImplementation(() => ({
        appendChild() {
          throw new Error('body detached');
        },
      }));
      try {
        expect(() => window.YouTubePlusDownloadButton.rebuildDownloadDropdown()).not.toThrow();
      } finally {
        bodySpy.mockRestore();
      }
    });

    test('the rebuild hook does nothing without a controls container', () => {
      boot(allSites);
      document.querySelector('.ytp-right-controls')?.remove();
      expect(() => window.YouTubePlusDownloadButton.rebuildDownloadDropdown()).not.toThrow();
    });

    test('a recreate failure during refresh is logged instead of escaping', () => {
      const { manager } = boot(allSites);
      document.querySelector('.download-options')?.remove();
      button()?.remove();

      // Only the controls lookup fails, so the failure happens inside the
      // recreate block that owns its error handling.
      const originalQuery = window.YouTubeUtils.$;
      window.YouTubeUtils.$ = jest.fn(sel => {
        if (sel === '.ytp-right-controls') throw new Error('dom query failed');
        return originalQuery(sel);
      });
      try {
        expect(() => manager.refreshDownloadButton()).not.toThrow();
        expect(window.YouTubeUtils.logSuppressed).toHaveBeenCalled();
      } finally {
        window.YouTubeUtils.$ = originalQuery;
      }
    });

    test('a dropdown lookup failure during refresh propagates to the caller', () => {
      const { manager } = boot(allSites);
      window.YouTubeUtils.$ = jest.fn(() => {
        throw new Error('dom query failed');
      });
      // The initial dropdown query is outside the recreate guard, so a broken
      // query helper surfaces instead of being swallowed.
      expect(() => manager.refreshDownloadButton()).toThrow('dom query failed');
    });

    test('refresh re-creates a missing button and hides everything when disabled', () => {
      const { manager } = boot(allSites);
      document.querySelector('.download-options')?.remove();
      button()?.remove();

      manager.refreshDownloadButton();
      expect(button()).toBeTruthy();

      window.YouTubePlusDownloadButton.refreshVisibility(false);
      expect(button().style.display).toBe('none');
      window.YouTubePlusDownloadButton.refreshVisibility(true);
      expect(button().style.display).toBe('');
    });

    test('a hidden classic anchor is found through the button sweep', () => {
      boot(allSites);
      const btn = button();
      btn.getBoundingClientRect = () => /** @type {DOMRect} */ ({ ...DEFAULT_RECT });

      // Hide the mounted anchor and add a second visible one: the positioner
      // must sweep the document instead of trusting the stale reference.
      btn.getBoundingClientRect = () =>
        /** @type {DOMRect} */ ({ ...DEFAULT_RECT, width: 0, height: 0 });
      const fallback = document.createElement('div');
      fallback.className = 'yp-download-button';
      fallback.getBoundingClientRect = () => /** @type {DOMRect} */ ({ ...DEFAULT_RECT });
      document.body.appendChild(fallback);

      fallback.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
      runPositioning();
      expect(dropdown()?.style.bottom).not.toBe('auto');
      expect(dropdown()?.style.bottom).not.toBe('');
    });

    test('stray classic buttons are removed but the Vision dock button is kept', () => {
      const { controls } = boot(allSites);
      const stray = document.createElement('div');
      stray.className = 'yp-download-button';
      const dockBtn = document.createElement('div');
      dockBtn.className = 'yp-download-button';
      dockBtn.id = 'yp-vision-download-btn';
      controls.append(stray, dockBtn);

      window.YouTubePlusDownloadButton.rebuildDownloadDropdown();
      expect(controls.contains(stray)).toBe(false);
      expect(controls.contains(dockBtn)).toBe(true);
      expect(controls.querySelectorAll('.yp-download-button')).toHaveLength(2);
    });
  });

  describe('descriptor', () => {
    test('command clicks a mounted button and reports when there is none', () => {
      boot(allSites);
      const descriptor = window.YouTubePlusDownload.DESCRIPTOR;
      const clickSpy = jest.spyOn(button(), 'click').mockImplementation(() => undefined);

      expect(descriptor.command(null)).toBe(true);
      expect(clickSpy).toHaveBeenCalled();

      document.querySelector('.yp-download-button')?.remove();
      expect(descriptor.command(null)).toBe(false);
    });

    test('mountDock renders through the utils sanitiser and stays idempotent', () => {
      boot(allSites);
      const dock = document.createElement('div');
      document.body.appendChild(dock);

      const dispose = window.YouTubePlusDownload.DESCRIPTOR.mountDock(dock, dock);
      const btn = /** @type {HTMLElement} */ (dock.querySelector('#yp-vision-download-btn'));
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('aria-haspopup')).toBe('true');
      expect(window.YouTubeUtils.setSafeHTML).toHaveBeenCalled();
      expect(typeof dispose).toBe('function');

      const first = btn;
      window.YouTubePlusDownload.DESCRIPTOR.mountDock(dock, dock);
      expect(dock.querySelector('#yp-vision-download-btn')).toBe(first);
    });

    test('mountDock falls back to the shared safe-DOM modules', () => {
      boot(allSites);
      delete window.YouTubeUtils.setSafeHTML;
      window.YouTubePlusSafeDOM = {
        setInnerHTML: jest.fn((el, html) => {
          el.textContent = html.slice(0, 10);
        }),
      };
      const dock = document.createElement('div');
      document.body.appendChild(dock);
      window.YouTubePlusDownload.DESCRIPTOR.mountDock(dock, dock);
      expect(window.YouTubePlusSafeDOM.setInnerHTML).toHaveBeenCalled();

      delete window.YouTubePlusSafeDOM;
      window.YouTubeSafeDOM = { setHTML: jest.fn() };
      const dock2 = document.createElement('div');
      document.body.appendChild(dock2);
      window.YouTubePlusDownload.DESCRIPTOR.mountDock(dock2, dock2);
      expect(window.YouTubeSafeDOM.setHTML).toHaveBeenCalled();
      delete window.YouTubeSafeDOM;
    });

    test('mountDock still builds a button when no sanitiser exists', () => {
      boot(allSites);
      delete window.YouTubeUtils.setSafeHTML;
      const dock = document.createElement('div');
      document.body.appendChild(dock);
      expect(() => window.YouTubePlusDownload.DESCRIPTOR.mountDock(dock, dock)).not.toThrow();
      expect(dock.querySelector('#yp-vision-download-btn')).toBeTruthy();
    });
  });

  describe('feature lifecycle', () => {
    test('enabling the feature later mounts the remembered button', () => {
      let enabled = false;
      window.YouTubeUtils.setSafeHTML = jest.fn((el, html) => {
        el.innerHTML = html;
      });
      window.YouTubePlusSettingsStore = {
        get: jest.fn(() => enabled),
        subscribe: jest.fn((_key, cb) => {
          subscribeCallbacks.push(cb);
          return () => {
            // no-op unsubscribe stub for the settings double
          };
        }),
      };
      /** @type {Array<() => void>} */
      const subscribeCallbacks = [];
      delete window.YouTubePlusFeatureRegistry;
      jest.resetModules();
      require('../src/feature-registry.js');
      require('../src/download.js');

      const controls = document.createElement('div');
      controls.className = 'ytp-right-controls';
      document.body.appendChild(controls);

      const manager = window.YouTubePlusDownloadButton.createDownloadButtonManager({
        settings: allSites,
        t: k => k,
        getElement: sel => document.querySelector(sel),
        YouTubeUtils: window.YouTubeUtils,
      });
      expect(button()).toBeNull();

      enabled = true;
      subscribeCallbacks.forEach(cb => {
        cb(true);
      });
      expect(button()).toBeTruthy();

      // Disabling the feature tears the button, dropdown and hover delegation down.
      enabled = false;
      subscribeCallbacks.forEach(cb => {
        cb(false);
      });
      expect(document.querySelector('.yp-download-button')).toBeNull();
      expect(document.querySelector('.download-options')).toBeNull();
      expect(() => manager.refreshDownloadButton()).not.toThrow();
    });

    test('a feature that never runs leaves the page without a button', () => {
      window.YouTubeUtils.setSafeHTML = jest.fn();
      window.YouTubePlusSettingsStore = {
        get: jest.fn(() => false),
        subscribe: jest.fn(() => () => {
          // no-op unsubscribe stub for a feature that never runs
        }),
      };
      delete window.YouTubePlusFeatureRegistry;
      jest.resetModules();
      require('../src/feature-registry.js');
      require('../src/download.js');

      const manager = window.YouTubePlusDownloadButton.createDownloadButtonManager({
        settings: allSites,
        t: k => k,
        getElement: sel => document.querySelector(sel),
        YouTubeUtils: window.YouTubeUtils,
      });
      manager.addDownloadButton(document.createElement('div'));
      expect(button()).toBeNull();
    });
  });
});
