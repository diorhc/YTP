/**
 * Unit tests for src/main.js outer boot path (the userscript-context IIFE
 * that orchestrates tabview injection).
 *
 * Tests the idempotency guard, GM_addElement invocation, StyleManager
 * registration, and the settings-updated event handler.
 *
 * The inner `executionScript` is exercised in a clean, isolated jsdom realm
 * so its first-run guard cannot be hidden by page fixtures.
 */

describe('main.js outer boot path', () => {
  /** @type {jest.Mock} */
  let gmAddElement;

  beforeEach(() => {
    jest.resetModules();
    // Mock Tampermonkey GM_addElement — used by main.js to inject the
    // page-context executionScript as a <script> element.
    gmAddElement = jest.fn();
    Object.defineProperty(globalThis, 'GM_addElement', {
      configurable: true,
      writable: true,
      value: gmAddElement,
    });

    require('../src/design-system.js');
    const realGetStyle = window.YouTubePlusDesignSystem?.getStyle;

    // Mock YouTubePlusDesignSystem with a StyleManager and real getStyle
    const styleManager = {
      add: jest.fn(),
      remove: jest.fn(),
    };
    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: { StyleManager: styleManager, getStyle: realGetStyle },
    });

    // Mock YouTubeUtils with loadFeatureEnabled
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        loadFeatureEnabled: jest.fn(() => true),
        logger: null,
      },
    });

    // Ensure document.documentElement exists (jsdom may not set it)
    if (!document.documentElement) {
      const html = document.createElement('html');
      document.appendChild(html);
    }

    // Clear idempotency flags
    delete window.__ytpMainBootDone__;
    delete window.__ytpMainExecDone__;

    // The overlay activates only where it can bind (a watch route or an already
    // present watch root). This suite drives the activation path, so it boots
    // on a watch page; the non-watch gate has dedicated tests below.
    mockLocation({ href: 'https://www.youtube.com/watch?v=boot-test' });
  });

  afterEach(() => {
    delete globalThis.GM_addElement;
    delete window.YouTubePlusDesignSystem;
    delete window.YouTubeUtils;
    delete window.YouTubeSafeDOM;
    delete window.YouTubePlusLogger;
    delete window.trustedTypes;
    delete window.__ytpMainBootDone__;
    delete window.__ytpMainExecDone__;
  });

  test('sets __ytpMainBootDone__ idempotency flag on first load', () => {
    require('../src/main.js');
    expect(window.__ytpMainBootDone__).toBe(true);
  });

  test('idempotency guard prevents re-injection on second load', () => {
    // First load
    require('../src/main.js');
    const firstCallCount = gmAddElement.mock.calls.length;

    // Second load — should be a no-op due to __ytpMainBootDone__
    jest.resetModules();
    // Re-set the flag since resetModules resets the require cache but
    // not the window state
    window.__ytpMainBootDone__ = true;
    require('../src/main.js');

    // GM_addElement should not have been called again
    expect(gmAddElement.mock.calls.length).toBe(firstCallCount);
  });

  test('injects executionScript via GM_addElement', () => {
    require('../src/main.js');

    expect(gmAddElement).toHaveBeenCalledTimes(1);
    const [parent, tag, attrs] = gmAddElement.mock.calls[0];
    expect(parent).toBe(document.head || document.documentElement);
    expect(tag).toBe('script');
    // The textContent should contain the serialized executionScript body
    expect(attrs.textContent).toContain('__ytpMainExecDone__');
    expect(attrs.textContent).toContain(
      '//# sourceURL=debug://tabview-youtube/tabview.execution.js'
    );
  });

  test('injects executionScript via document.createElement fallback when GM_addElement is undefined', () => {
    delete globalThis.GM_addElement;
    const targetParent = document.head || document.documentElement;
    const appendSpy = jest.spyOn(targetParent, 'appendChild');

    require('../src/main.js');

    expect(appendSpy).toHaveBeenCalled();
    const appended = appendSpy.mock.calls[0][0];
    expect(appended.tagName.toLowerCase()).toBe('script');
    expect(appended.textContent).toContain('__ytpMainExecDone__');
    appendSpy.mockRestore();
  });

  test('a Trusted Types document without a policy skips the core instead of throwing', () => {
    delete globalThis.GM_addElement;
    Object.defineProperty(window, 'trustedTypes', {
      configurable: true,
      writable: true,
      value: { createPolicy: jest.fn(() => ({ createScript: jest.fn(s => s) })) },
    });
    // No safe-dom policy facade: createTrustedScript is unavailable.
    const debugSpy = jest.fn();
    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: { debug: debugSpy },
    });
    const targetParent = document.head || document.documentElement;
    const appendSpy = jest.spyOn(targetParent, 'appendChild');

    expect(() => require('../src/main.js')).not.toThrow();
    expect(appendSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
    appendSpy.mockRestore();
  });

  test('a Trusted Types document injects the core through createTrustedScript', () => {
    delete globalThis.GM_addElement;
    Object.defineProperty(window, 'trustedTypes', {
      configurable: true,
      writable: true,
      value: {},
    });
    const trusted = '(function () { return "trusted"; })();';
    const createTrustedScript = jest.fn(() => trusted);
    Object.defineProperty(window, 'YouTubeSafeDOM', {
      configurable: true,
      writable: true,
      value: { createTrustedScript },
    });
    const targetParent = document.head || document.documentElement;
    const appendSpy = jest.spyOn(targetParent, 'appendChild');

    expect(() => require('../src/main.js')).not.toThrow();
    expect(createTrustedScript).toHaveBeenCalled();
    const appended = appendSpy.mock.calls[0]?.[0];
    expect(appended?.tagName.toLowerCase()).toBe('script');
    expect(appended?.textContent).toBe(trusted);
    appendSpy.mockRestore();
  });

  test('executes inner boot in a clean page realm without define000', async () => {
    require('../src/main.js');

    const [, , attrs] = gmAddElement.mock.calls[0];
    const iframe = document.createElement('iframe');
    iframe.src = `${window.location.origin}/watch?v=boot-test`;
    document.body.append(iframe);
    const realm = iframe.contentWindow;
    Object.defineProperty(realm, 'localStorage', { value: window.localStorage });
    Object.defineProperty(realm, 'sessionStorage', { value: window.sessionStorage });
    const errorSpy = jest.fn();
    realm.YouTubePlusLogger = {
      createLogger: () => ({
        error: errorSpy,
        warn() {
          /* mock */
        },
        info() {
          /* mock */
        },
        debug() {
          /* mock */
        },
        log() {
          /* mock */
        },
      }),
    };

    expect(realm.CustomElementRegistry.prototype.define000).toBeUndefined();
    realm.IntersectionObserver = class {
      observe() {
        /* mock */
      }
      unobserve() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
    };
    realm.MutationObserver = class {
      observe() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
      takeRecords() {
        return [];
      }
    };
    realm.ResizeObserver = class {
      observe() {
        /* mock */
      }
      unobserve() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
    };
    // The page realm has no YouTubeSafeDOM: the core makes its own policy.
    const createPolicy = jest.fn((_name, rules) => ({ createHTML: rules.createHTML }));
    realm.trustedTypes = { createPolicy };
    realm.eval(attrs.textContent);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(realm.__ytpMainExecDone__).toBe(true);
    expect(errorSpy).not.toHaveBeenCalledWith('error 0xF491', expect.anything());
    expect(createPolicy).toHaveBeenCalledTimes(1);
    expect(createPolicy).toHaveBeenCalledWith('ytplus-tabview', expect.any(Object));
    expect(realm._ytConfigHacks).toBeDefined();
    expect(typeof realm.Element.prototype.setAttribute111).toBe('function');
    expect(typeof realm.Node.prototype.appendChild000).toBe('function');
    iframe.remove();
  });

  test('page-context command bridge handles switchTab with invalid args, collapseChat, and errors', async () => {
    require('../src/main.js');

    const [, , attrs] = gmAddElement.mock.calls[0];
    const iframe = document.createElement('iframe');
    iframe.src = `${window.location.origin}/watch?v=bridge-realm-test`;
    document.body.append(iframe);
    const realm = iframe.contentWindow;
    Object.defineProperty(realm, 'localStorage', { value: window.localStorage });
    Object.defineProperty(realm, 'sessionStorage', { value: window.sessionStorage });
    const warnSpy = jest.fn();
    realm.YouTubePlusLogger = {
      createLogger: () => ({
        error() {
          /* mock */
        },
        warn: warnSpy,
        info() {
          /* mock */
        },
        debug() {
          /* mock */
        },
        log() {
          /* mock */
        },
      }),
    };
    realm.IntersectionObserver = class {
      observe() {
        /* mock */
      }
      unobserve() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
    };
    realm.MutationObserver = class {
      observe() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
      takeRecords() {
        return [];
      }
    };
    realm.ResizeObserver = class {
      observe() {
        /* mock */
      }
      unobserve() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
    };
    realm.eval(attrs.textContent);
    await new Promise(resolve => setTimeout(resolve, 50));

    const key = window.YouTubePlusMain.communicationKey();

    // 1. switchTab with invalid args
    realm.document.dispatchEvent(
      new realm.CustomEvent(`yp-tabview-cmd::${key}`, {
        detail: { cmd: 'switchTab', args: { tab: 'invalid-tab-id' } },
      })
    );
    realm.document.dispatchEvent(
      new realm.CustomEvent(`yp-tabview-cmd::${key}`, {
        detail: { cmd: 'switchTab', args: null },
      })
    );

    // 2. collapseChat command
    realm.document.dispatchEvent(
      new realm.CustomEvent(`yp-tabview-cmd::${key}`, {
        detail: { cmd: 'collapseChat' },
      })
    );

    // 3. invalid command or non-matching detail
    realm.document.dispatchEvent(
      new realm.CustomEvent(`yp-tabview-cmd::${key}`, {
        detail: { cmd: 'nonExistentCommand' },
      })
    );
    realm.document.dispatchEvent(
      new realm.CustomEvent(`yp-tabview-cmd::${key}`, {
        detail: null,
      })
    );

    await new Promise(resolve => setTimeout(resolve, 50));
    iframe.remove();
  });

  test('inner executionScript runs cleanly without YouTubePlusCleanupManager (no error 0xF491)', async () => {
    require('../src/main.js');
    const [, , attrs] = gmAddElement.mock.calls[0];
    const iframe = document.createElement('iframe');
    iframe.src = `${window.location.origin}/watch?v=no-cm-test`;
    document.body.append(iframe);
    const realm = iframe.contentWindow;
    expect(realm.YouTubePlusCleanupManager).toBeUndefined();

    const errorSpy = jest.fn();
    realm.YouTubePlusLogger = {
      createLogger: () => ({
        error: errorSpy,
        warn() {
          /* mock */
        },
        info() {
          /* mock */
        },
        debug() {
          /* mock */
        },
        log() {
          /* mock */
        },
      }),
    };
    realm.IntersectionObserver = class {
      observe() {
        /* mock */
      }
      unobserve() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
    };
    realm.MutationObserver = class {
      observe() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
      takeRecords() {
        return [];
      }
    };
    realm.ResizeObserver = class {
      observe() {
        /* mock */
      }
      unobserve() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
    };

    realm.eval(attrs.textContent);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(realm.__ytpMainExecDone__).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    iframe.remove();
  });

  test('registers tabview CSS via StyleManager when enabled', () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
    require('../src/main.js');

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    expect(styleManager.add).toHaveBeenCalledWith('yp-tabview-core', expect.any(String));
    const css = styleManager.add.mock.calls[0][1];
    expect(css).toContain('[tyt-tab=""] #right-tabs{flex:0 0 auto;min-height:48px}');
    expect(css).toContain('[tyt-tab=""] #right-tabs .tab-content{display:none;border:0}');
    expect(css).toContain('min-height:0;max-height:unset!important');
    expect(css).toContain('--tabview-text-loading:"Loading"');
  });

  test('skips CSS registration when tabview is disabled', () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
    require('../src/main.js');

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    expect(styleManager.add).not.toHaveBeenCalled();
  });

  describe('tabview core injection gating', () => {
    test('enabled flag is passed into the serialized executionScript', () => {
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
      require('../src/main.js');

      expect(gmAddElement).toHaveBeenCalledTimes(1);
      const [, , attrs] = gmAddElement.mock.calls[0];
      expect(attrs.textContent).toContain('{"enabled":true}');
    });

    test('page-realm core is not injected when tabview is disabled', () => {
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
      require('../src/main.js');

      // No page-realm injection at all when the feature is off.
      expect(gmAddElement).not.toHaveBeenCalled();
      expect(window.CustomElementRegistry?.prototype?.define000).toBeUndefined();
      expect(document.documentElement?.getAttribute('tabview-loaded')).toBeNull();
    });

    test('core and CSS are not loaded on a non-watch page', () => {
      mockLocation({ href: 'https://www.youtube.com/feed/subscriptions' });
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
      require('../src/main.js');

      expect(gmAddElement).not.toHaveBeenCalled();
      expect(window.YouTubePlusDesignSystem.StyleManager.add).not.toHaveBeenCalled();
    });

    test('a navigation onto a watch page activates the core and CSS', () => {
      mockLocation({ href: 'https://www.youtube.com/' });
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
      require('../src/main.js');
      expect(gmAddElement).not.toHaveBeenCalled();

      const styleManager = window.YouTubePlusDesignSystem.StyleManager;
      gmAddElement.mockClear();
      styleManager.add.mockClear();

      mockLocation({ href: 'https://www.youtube.com/watch?v=late' });
      document.dispatchEvent(
        new CustomEvent('yt-navigate-finish', { detail: { pageType: 'watch' } })
      );

      expect(gmAddElement).toHaveBeenCalled();
      const last = gmAddElement.mock.calls[gmAddElement.mock.calls.length - 1];
      expect(last[2].textContent).toContain('"enabled":true');
      expect(styleManager.add).toHaveBeenCalledWith('yp-tabview-core', expect.any(String));
    });

    test('leaving a watch page drops the core CSS', () => {
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
      require('../src/main.js');

      const styleManager = window.YouTubePlusDesignSystem.StyleManager;
      styleManager.remove.mockClear();

      mockLocation({ href: 'https://www.youtube.com/@SomeChannel' });
      document.dispatchEvent(
        new CustomEvent('yt-navigate-finish', { detail: { pageType: 'browse' } })
      );

      expect(styleManager.remove).toHaveBeenCalledWith('yp-tabview-core');
    });

    test('a /watch/ sub-path counts as a watch page', () => {
      mockLocation({ href: 'https://www.youtube.com/watch/streams' });
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
      require('../src/main.js');

      expect(gmAddElement).toHaveBeenCalled();
    });

    test('enabling on a non-watch page defers activation to the watch navigation', () => {
      mockLocation({ href: 'https://www.youtube.com/feed/subscriptions' });
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
      require('../src/main.js');

      const styleManager = window.YouTubePlusDesignSystem.StyleManager;
      gmAddElement.mockClear();
      styleManager.add.mockClear();

      window.dispatchEvent(
        new CustomEvent('youtube-plus-settings-updated', { detail: { enableTabview: true } })
      );
      expect(gmAddElement).not.toHaveBeenCalled();
      expect(styleManager.add).not.toHaveBeenCalled();

      mockLocation({ href: 'https://www.youtube.com/watch?v=deferred' });
      document.dispatchEvent(
        new CustomEvent('yt-navigate-finish', { detail: { pageType: 'watch' } })
      );
      expect(gmAddElement).toHaveBeenCalled();
      expect(styleManager.add).toHaveBeenCalledWith('yp-tabview-core', expect.any(String));
    });

    test('a disabled feature toggle never activates the overlay', () => {
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
      require('../src/main.js');

      const styleManager = window.YouTubePlusDesignSystem.StyleManager;
      gmAddElement.mockClear();
      styleManager.add.mockClear();

      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
      window.dispatchEvent(
        new CustomEvent('youtube-plus-settings-updated', { detail: { enableTabview: true } })
      );

      expect(gmAddElement).not.toHaveBeenCalled();
      expect(styleManager.add).not.toHaveBeenCalled();
    });

    test('a StyleManager without add/remove does not crash boot or navigation', () => {
      mockLocation({ href: 'https://www.youtube.com/watch?v=no-sm' });
      window.YouTubePlusDesignSystem = { StyleManager: {} };
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);

      expect(() => require('../src/main.js')).not.toThrow();
      expect(gmAddElement).toHaveBeenCalled();

      mockLocation({ href: 'https://www.youtube.com/' });
      expect(() =>
        document.dispatchEvent(
          new CustomEvent('yt-navigate-finish', { detail: { pageType: 'browse' } })
        )
      ).not.toThrow();
    });

    test('boots on a watch page without any design system', () => {
      delete window.YouTubePlusDesignSystem;
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);

      expect(() => require('../src/main.js')).not.toThrow();
      expect(gmAddElement).toHaveBeenCalled();
    });

    test('activates on a watch navigation even without YouTubeUtils', () => {
      mockLocation({ href: 'https://www.youtube.com/' });
      delete window.YouTubeUtils;
      require('../src/main.js');
      expect(gmAddElement).not.toHaveBeenCalled();

      const styleManager = window.YouTubePlusDesignSystem.StyleManager;
      gmAddElement.mockClear();
      styleManager.add.mockClear();

      mockLocation({ href: 'https://www.youtube.com/watch?v=no-utils' });
      document.dispatchEvent(
        new CustomEvent('yt-navigate-finish', { detail: { pageType: 'watch' } })
      );

      expect(gmAddElement).toHaveBeenCalled();
    });
  });

  test('registers youtube-plus-settings-updated event listener', () => {
    // Spy on addEventListener
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    require('../src/main.js');

    // Should have registered the 'youtube-plus-settings-updated' handler
    const calls = addEventListenerSpy.mock.calls.filter(
      ([event]) => event === 'youtube-plus-settings-updated'
    );
    expect(calls.length).toBe(1);
    addEventListenerSpy.mockRestore();
  });

  test('settings-updated handler adds CSS when tabview enabled', () => {
    require('../src/main.js');

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    styleManager.add.mockClear();

    // Dispatch settings-updated with tabview enabled
    const event = new CustomEvent('youtube-plus-settings-updated', {
      detail: { enableTabview: true },
    });
    window.dispatchEvent(event);

    expect(styleManager.add).toHaveBeenCalledWith('yp-tabview-core', expect.any(String));
  });

  test('enabling Tabview after boot injects the page-realm core once', () => {
    // Tabview was off at boot: no core injection, no styles.
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
    require('../src/main.js');
    expect(gmAddElement).not.toHaveBeenCalled();

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    // The store is updated before the event is fired in production.
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);

    // Enabling in settings injects the core activated, together with styles.
    window.dispatchEvent(
      new CustomEvent('youtube-plus-settings-updated', {
        detail: { enableTabview: true },
      })
    );
    expect(gmAddElement).toHaveBeenCalled();
    const last = gmAddElement.mock.calls[gmAddElement.mock.calls.length - 1];
    expect(last[1]).toBe('script');
    // The late injection must pass the activation flag to the core.
    expect(last[2].textContent).toContain('"enabled":true');
    expect(styleManager.add).toHaveBeenCalledWith('yp-tabview-core', expect.any(String));

    // The core is session-once per realm: another enable never re-injects it.
    const afterFirst = gmAddElement.mock.calls.length;
    window.dispatchEvent(
      new CustomEvent('youtube-plus-settings-updated', {
        detail: { enableTabview: true },
      })
    );
    expect(gmAddElement.mock.calls.length).toBe(afterFirst);
  });

  test('settings-updated handler removes CSS when tabview disabled', () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
    require('../src/main.js');

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    styleManager.add.mockClear();

    // Dispatch settings-updated with tabview disabled
    const event = new CustomEvent('youtube-plus-settings-updated', {
      detail: { enableTabview: false },
    });
    window.dispatchEvent(event);

    expect(styleManager.remove).toHaveBeenCalledWith('yp-tabview-core');
  });

  test('handles missing YouTubePlusDesignSystem.StyleManager gracefully', () => {
    window.YouTubePlusDesignSystem = {};
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);

    // Should not throw when StyleManager is missing
    expect(() => require('../src/main.js')).not.toThrow();
  });

  test('handles missing YouTubeUtils gracefully', () => {
    delete window.YouTubeUtils;

    // Should not throw when YouTubeUtils is missing
    expect(() => require('../src/main.js')).not.toThrow();
  });

  test('settings-updated handler treats absent/malformed detail as enabled', () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
    require('../src/main.js');

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    styleManager.add.mockClear();

    // No detail at all: `e?.detail?.enableTabview !== false` -> true -> add.
    window.dispatchEvent(new CustomEvent('youtube-plus-settings-updated'));
    expect(styleManager.add).toHaveBeenCalledTimes(1);

    // Detail present but field undefined: same default-enable outcome.
    styleManager.add.mockClear();
    window.dispatchEvent(
      new CustomEvent('youtube-plus-settings-updated', {
        detail: { otherKey: 1 },
      })
    );
    expect(styleManager.add).toHaveBeenCalledTimes(1);
  });

  test('settings-updated handler swallows StyleManager failures', () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
    require('../src/main.js');

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    styleManager.add.mockImplementation(() => {
      throw new Error('boom');
    });
    styleManager.remove.mockImplementation(() => {
      throw new Error('boom');
    });

    // Both dispatches hit the try/catch; neither may propagate.
    expect(() =>
      window.dispatchEvent(
        new CustomEvent('youtube-plus-settings-updated', {
          detail: { enableTabview: true },
        })
      )
    ).not.toThrow();
    expect(() =>
      window.dispatchEvent(
        new CustomEvent('youtube-plus-settings-updated', {
          detail: { enableTabview: false },
        })
      )
    ).not.toThrow();
  });

  test('boots after documentElement appears (late-injection path)', async () => {
    // Simulate a page whose <html> is not parsed yet when the userscript
    // starts: main.js must poll until documentElement exists, then inject.
    // documentElement is a prototype getter; shadow it with an own property
    // and drop the shadow to signal "HTML parsed now".
    Object.defineProperty(document, 'documentElement', {
      configurable: true,
      value: null,
    });
    const loadPromise = Promise.resolve().then(() => require('../src/main.js'));
    // Let the module reach its wait loop, then release it.
    await new Promise(resolve => setTimeout(resolve, 25));
    delete document.documentElement;
    await loadPromise;
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(gmAddElement).toHaveBeenCalledTimes(1);
    expect(window.__ytpMainBootDone__).toBe(true);
  });

  describe('facade surface', () => {
    test('communicationKey is namespaced and stable', () => {
      require('../src/main.js');
      const k1 = window.YouTubePlusMain.communicationKey();
      expect(k1).toMatch(/^ck-/);
      expect(window.YouTubePlusMain.communicationKey()).toBe(k1);
    });

    test("isEnabled delegates to loadFeatureEnabled('enableTabview')", () => {
      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
      require('../src/main.js');
      expect(window.YouTubePlusMain.isEnabled()).toBe(false);
      expect(window.YouTubeUtils.loadFeatureEnabled).toHaveBeenCalledWith('enableTabview');

      window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
      expect(window.YouTubePlusMain.isEnabled()).toBe(true);
    });

    test('isEnabled defaults to true when YouTubeUtils vanishes', () => {
      require('../src/main.js');
      const utilRef = window.YouTubeUtils;
      delete window.YouTubeUtils;
      expect(window.YouTubePlusMain.isEnabled()).toBe(true);
      window.YouTubeUtils = utilRef;
    });
  });
});
