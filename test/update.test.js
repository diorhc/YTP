/**
 * @jest-environment jsdom
 *
 * Tests the real update.js module surface through window.YouTubePlusUpdate.
 * Exercises actual version comparison, metadata parsing, time formatting,
 * and settings persistence against real module logic.
 */

describe('Update Module', () => {
  const setupUpdateDeps = () => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    const utils = {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      cleanupManager: {
        registerInterval: jest.fn(id => id),
        registerTimeout: jest.fn(id => id),
        // The real manager schedules through setTimeout; the mocks mirror it.
        timeout: jest.fn((fn, ms) => setTimeout(fn, ms)),
        registerObserver: jest.fn(obs => obs),
        registerListener: jest.fn((target, type, handler, opts) => {
          target?.addEventListener?.(type, handler, opts);
          return Symbol('listener-key');
        }),
        register: jest.fn(),
        cleanup: jest.fn(),
        registerAnimationFrame: jest.fn(id => id),
        getListenerStats: jest.fn(() => ({ active: 0, registeredTotal: 0 })),
      },
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      loadFeatureEnabled: jest.fn(() => true),
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
      NotificationManager: { show: jest.fn(), remove: jest.fn() },
      getLanguage: jest.fn(() => 'en'),
      renderTemplateClone: jest.fn((el, html) => {
        el.innerHTML = html;
      }),
      onSectionActive: jest.fn(() => ({ dispose: jest.fn() })),
      logSuppressed: jest.fn(),
      storage: {
        get: (key, def = null) => {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : def;
        },
        set: (key, val) => {
          localStorage.setItem(key, JSON.stringify(val));
          return true;
        },
        remove: key => localStorage.removeItem(key),
        has: key => localStorage.getItem(key) !== null,
        getItem: key => localStorage.getItem(key),
        setItem: (key, val) => {
          localStorage.setItem(key, val);
          return true;
        },
        removeItem: key => localStorage.removeItem(key),
      },
      openSafe: jest.fn(() => true),
      // The installed version, as the userscript manager reports it.
      getScriptVersion: () => '3.0.0',
    };
    window.open = jest.fn(() => ({}));

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: utils,
    });

    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: {
        StyleManager: window.YouTubeUtils.StyleManager,
        getStyle: jest.fn(() => ''),
      },
    });

    Object.defineProperty(window, 'YouTubePlusSafeDOM', {
      configurable: true,
      writable: true,
      value: {
        sanitizeHTML: jest.fn(s => s),
        setHTML: jest.fn((el, h) => {
          el.innerHTML = h;
        }),
      },
    });

    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        registerListener: (target, type, handler, opts) => {
          target?.addEventListener?.(type, handler, opts);
          return Symbol('listener-key');
        },
        registerInterval: jest.fn(id => id),
        registerTimeout: jest.fn(id => id),
        cleanup: jest.fn(),
      },
    });

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
  };

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusUpdate;
    localStorage.clear();
    sessionStorage.clear();

    setupUpdateDeps();
    require('../src/update.js');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('exposes the real API facade on window.YouTubePlusUpdate', () => {
    expect(window.YouTubePlusUpdate).toBeDefined();
    expect(typeof window.YouTubePlusUpdate.compareVersions).toBe('function');
    expect(typeof window.YouTubePlusUpdate.parseMetadata).toBe('function');
    expect(typeof window.YouTubePlusUpdate.formatTimeAgo).toBe('function');
    expect(typeof window.YouTubePlusUpdate.loadSettings).toBe('function');
    expect(typeof window.YouTubePlusUpdate.saveSettings).toBe('function');
    expect(typeof window.YouTubePlusUpdate.checkForUpdates).toBe('function');
  });

  test('init wires the update runtime once', () => {
    jest.useFakeTimers();
    try {
      window.YouTubePlusUpdate.init();
      window.YouTubePlusUpdate.init();

      expect(window.YouTubePlusCleanupManager.registerInterval).toHaveBeenCalledTimes(1);
      // E7: the session-scoped check interval must be registered exactly once,
      // on the canonical manager, and must never leak into the page-scope set.
      expect(window.YouTubePlusCleanupManager.registerInterval).toHaveBeenCalledWith(
        expect.anything(),
        { scope: 'session' }
      );
      expect(window.YouTubeUtils.cleanupManager.registerListener).toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  describe('compareVersions (real API)', () => {
    test('accurately compares semver version strings', () => {
      const { compareVersions } = window.YouTubePlusUpdate;

      expect(compareVersions('2.5.3', '2.5.2')).toBeGreaterThan(0);
      expect(compareVersions('2.5.2', '2.5.3')).toBeLessThan(0);
      expect(compareVersions('2.5.2', '2.5.2')).toBe(0);
      expect(compareVersions('3.0.0', '2.9.9')).toBeGreaterThan(0);
      expect(compareVersions('2.5.10', '2.5.9')).toBeGreaterThan(0);
    });

    test('handles invalid version inputs gracefully', () => {
      const { compareVersions } = window.YouTubePlusUpdate;
      expect(compareVersions(null, '2.5.2')).toBe(0);
      expect(compareVersions('2.5.2', undefined)).toBe(0);
    });
  });

  describe('parseMetadata (real API)', () => {
    test('extracts version and description from userscript metadata header', () => {
      const metadata = `
// ==UserScript==
// @name         YouTube +
// @version      2.6.0
// @description  A powerful YouTube enhancement script
// @author       diorhc
// ==/UserScript==
      `;

      const parsed = window.YouTubePlusUpdate.parseMetadata(metadata);
      expect(parsed.version).toBe('2.6.0');
      expect(parsed.description).toBe('A powerful YouTube enhancement script');
    });

    test('handles malformed or empty metadata gracefully', () => {
      const emptyParsed = window.YouTubePlusUpdate.parseMetadata('');
      expect(emptyParsed.version).toBeNull();

      const nullParsed = window.YouTubePlusUpdate.parseMetadata(null);
      expect(nullParsed.version).toBeNull();

      const invalidParsed = window.YouTubePlusUpdate.parseMetadata('Random text without header');
      expect(invalidParsed.version).toBeNull();
    });
  });

  describe('formatTimeAgo (real API)', () => {
    test('formats recent timestamp relative to current time', () => {
      const now = Date.now();
      const justNow = window.YouTubePlusUpdate.formatTimeAgo(now - 30 * 1000);
      expect(typeof justNow).toBe('string');
      expect(justNow.length).toBeGreaterThan(0);

      const hoursAgo = window.YouTubePlusUpdate.formatTimeAgo(now - 3 * 3600 * 1000);
      expect(typeof hoursAgo).toBe('string');
    });

    test('handles zero / null timestamp gracefully', () => {
      const never = window.YouTubePlusUpdate.formatTimeAgo(0);
      expect(typeof never).toBe('string');
    });
  });

  describe('Settings persistence (real API)', () => {
    test('saves and restores update state in localStorage', () => {
      window.YouTubePlusUpdate.updateState.lastCheck = 1700000000000;
      window.YouTubePlusUpdate.updateState.lastVersion = '3.0.0';
      window.YouTubePlusUpdate.updateState.updateAvailable = true;

      window.YouTubePlusUpdate.saveSettings();

      const raw = localStorage.getItem('ytp_update_check_v1');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw || '{}');
      expect(parsed.lastCheck).toBe(1700000000000);
      expect(parsed.updateAvailable).toBe(true);

      window.YouTubePlusUpdate.updateState.lastCheck = 0;
      window.YouTubePlusUpdate.updateState.updateAvailable = false;

      window.YouTubePlusUpdate.loadSettings();
      expect(window.YouTubePlusUpdate.updateState.lastCheck).toBe(1700000000000);
      expect(window.YouTubePlusUpdate.updateState.updateAvailable).toBe(true);
    });

    test('a check recorded on one host is read by the next host that boots', () => {
      // Stands in for the GM storage every host shares.
      const shared = new Map();
      const previousStore = window.YouTubePlusSettingsStore;
      window.YouTubePlusSettingsStore = {
        readGmKey: key => (shared.has(key) ? shared.get(key) : null),
        writeGmKey: (key, value) => {
          shared.set(key, value);
          return true;
        },
      };
      try {
        // Host A records a fresh check under the shared key.
        const seenAt = Date.now();
        window.YouTubePlusUpdate.updateState.lastCheck = seenAt;
        window.YouTubePlusUpdate.saveSettings();
        expect(shared.has('ytp_update_check_v1')).toBe(true);

        // Host B boots fresh and reads the shared key instead of defaulting to
        // 0, so its start-up check is skipped by the 24h interval rule.
        jest.resetModules();
        delete window.YouTubePlusUpdate;
        require('../src/update.js');
        window.YouTubePlusUpdate.loadSettings();
        expect(window.YouTubePlusUpdate.updateState.lastCheck).toBe(seenAt);
      } finally {
        window.YouTubePlusSettingsStore = previousStore;
      }
    });
  });

  describe('checkForUpdates runtime flow (real API)', () => {
    test('executes update check and handles newer version notification', async () => {
      const meta = `
// ==UserScript==
// @name         YouTube +
// @version      3.1.0
// @description  Next release
// ==/UserScript==
      `;
      globalThis.GM_xmlhttpRequest = jest.fn(options => {
        options.onload?.({
          status: 200,
          responseText: meta,
        });
      });

      await window.YouTubePlusUpdate.checkForUpdates(true);

      expect(window.YouTubePlusUpdate.updateState.updateAvailable).toBe(true);
      expect(window.YouTubePlusUpdate.updateState.lastVersion).toBe('3.1.0');
    });

    test('handles up-to-date and error cases in checkForUpdates', async () => {
      // Up-to-date case
      const sameMeta = `
// ==UserScript==
// @name YouTube +
// @version 2.5.3
// ==/UserScript==
      `;
      globalThis.GM_xmlhttpRequest = jest.fn(options => {
        options.onload?.({ status: 200, responseText: sameMeta });
      });
      await window.YouTubePlusUpdate.checkForUpdates(true);
      expect(window.YouTubePlusUpdate.updateState.updateAvailable).toBe(false);

      // Missing update info case
      globalThis.GM_xmlhttpRequest = jest.fn(options => {
        options.onload?.({ status: 200, responseText: '' });
      });
      await window.YouTubePlusUpdate.checkForUpdates(true);
      expect(window.YouTubePlusUpdate.updateState.updateAvailable).toBe(false);

      // Non-forced check when interval has not elapsed
      window.YouTubePlusUpdate.updateState.lastCheck = Date.now();
      await window.YouTubePlusUpdate.checkForUpdates(false);

      // Error case with retry
      globalThis.GM_xmlhttpRequest = jest.fn(options => {
        options.onerror?.(new Error('network failure'));
      });
      await window.YouTubePlusUpdate.checkForUpdates(true);
    });

    test('interacts with notification buttons after update is found', async () => {
      const meta = `
// ==UserScript==
// @name YouTube +
// @version 3.1.0
// ==/UserScript==
      `;
      globalThis.GM_xmlhttpRequest = jest.fn(options => {
        options.onload?.({ status: 200, responseText: meta });
      });
      await window.YouTubePlusUpdate.checkForUpdates(true);

      const notification = document.querySelector('.update-notification');
      expect(notification).toBeTruthy();

      const installBtn = notification.querySelector('#update-install-btn');
      if (installBtn) {
        installBtn.click();
      }

      const dismissBtn = notification.querySelector('#update-dismiss-btn');
      if (dismissBtn) {
        dismissBtn.click();
      }
    });

    test('addUpdateSettings injects settings card and handles buttons', async () => {
      const aboutSection = document.createElement('div');
      aboutSection.className = 'yp-settings-section';
      aboutSection.setAttribute('data-section', 'about');
      document.body.appendChild(aboutSection);

      document.dispatchEvent(new CustomEvent('youtube-plus-settings-modal-opened'));

      await new Promise(r => setTimeout(r, 150));

      const card = aboutSection.querySelector('.update-settings-container');
      expect(card).toBeTruthy();

      const manualCheckBtn = aboutSection.querySelector('#manual-update-check');
      expect(manualCheckBtn).toBeTruthy();
      manualCheckBtn.click();

      const openPageBtn = aboutSection.querySelector('#open-update-page');
      expect(openPageBtn).toBeTruthy();
      openPageBtn.click();
    });
  });

  describe('formatTimeAgo & parseMetadata & loadSettings branches', () => {
    test('formatTimeAgo handles various time ranges', () => {
      const now = Date.now();
      expect(typeof window.YouTubePlusUpdate.formatTimeAgo(now - 2 * 86400000)).toBe('string');
      expect(typeof window.YouTubePlusUpdate.formatTimeAgo(now - 5 * 60000)).toBe('string');
      expect(typeof window.YouTubePlusUpdate.formatTimeAgo(now - 1000)).toBe('string');
      expect(typeof window.YouTubePlusUpdate.formatTimeAgo(0)).toBe('string');
    });

    test('parseMetadata handles payload variants', () => {
      const metaWithUrl = `
// ==UserScript==
// @name YouTube +
// @version 2.7.0
// @downloadURL https://update.greasyfork.org/scripts/537017/YouTube%20%2B.user.js
// ==/UserScript==
      `;
      expect(window.YouTubePlusUpdate.parseMetadata(metaWithUrl).downloadUrl).toContain(
        'greasyfork.org'
      );
      expect(window.YouTubePlusUpdate.parseMetadata({ responseText: metaWithUrl }).version).toBe(
        '2.7.0'
      );
      expect(window.YouTubePlusUpdate.parseMetadata('a'.repeat(100005)).version).toBeNull();
      expect(
        window.YouTubePlusUpdate.parseMetadata(
          '// ==UserScript==\n// @version invalid\n// ==/UserScript=='
        ).version
      ).toBeNull();
    });

    test('loadSettings validates input structure', () => {
      localStorage.setItem(
        'youtube_plus_update_check',
        JSON.stringify({
          lastCheck: 500,
          lastVersion: 'v2.8.0',
          updateAvailable: true,
          updateDetails: { version: '2.8.0' },
        })
      );
      window.YouTubePlusUpdate.loadSettings();
      expect(window.YouTubePlusUpdate.updateState.lastVersion).toBe('2.8.0');
      expect(window.YouTubePlusUpdate.updateState.updateDetails?.version).toBe('2.8.0');

      // Invalid JSON structure
      localStorage.setItem('youtube_plus_update_check', 'null');
      window.YouTubePlusUpdate.loadSettings();

      localStorage.setItem(
        'youtube_plus_update_check',
        JSON.stringify({
          lastVersion: 'invalid',
          updateDetails: { version: 'bad-format' },
        })
      );
      window.YouTubePlusUpdate.loadSettings();
    });

    test('saveSettings and loadSettings handle storage exceptions gracefully', () => {
      const origSetItem = window.YouTubeUtils.storage.setItem;
      window.YouTubeUtils.storage.setItem = () => {
        throw new Error('quota exceeded');
      };
      expect(() => window.YouTubePlusUpdate.saveSettings()).not.toThrow();
      window.YouTubeUtils.storage.setItem = origSetItem;

      const origGetItem = window.YouTubeUtils.storage.getItem;
      window.YouTubeUtils.storage.getItem = () => {
        throw new Error('access denied');
      };
      expect(() => window.YouTubePlusUpdate.loadSettings()).not.toThrow();
      window.YouTubeUtils.storage.getItem = origGetItem;
    });

    test('compareVersions handles non-string and mismatched inputs', () => {
      // @ts-expect-error test non-string types
      expect(window.YouTubePlusUpdate.compareVersions(123, '1.0.0')).toBe(0);
      // @ts-expect-error test non-string types
      expect(window.YouTubePlusUpdate.compareVersions('1.0.0', null)).toBe(0);
    });

    test('handles changelog and fallback metadata retrieval flows', async () => {
      const meta = '// ==UserScript==\n// @version 3.1.0\n// ==/UserScript==';
      const changelogHtml =
        '<div class="version-item"><a href="#">3.1.0</a><div class="version-changelog">Bug fixes\nPerformance improvements</div></div>';

      globalThis.GM_xmlhttpRequest = jest.fn(options => {
        if (options.url.includes('versions')) {
          options.onload?.({ status: 200, responseText: changelogHtml });
        } else {
          options.onload?.({ status: 200, responseText: meta });
        }
      });

      await window.YouTubePlusUpdate.checkForUpdates(true);
      const notification = document.querySelector('.update-notification');
      expect(notification).toBeTruthy();

      const closeBtn = notification?.querySelector('#update-close-btn');
      if (closeBtn) {
        /** @type {HTMLElement} */ (closeBtn).click();
      }

      // Fallback metadata flow when primary has no version
      globalThis.GM_xmlhttpRequest = jest.fn(options => {
        if (options.url.endsWith('.meta.js')) {
          options.onload?.({ status: 200, responseText: '// ==UserScript==\n// ==/UserScript==' });
        } else if (options.url.endsWith('.user.js')) {
          options.onload?.({
            status: 200,
            responseText: '// ==UserScript==\n// @version 3.2.0\n// ==/UserScript==',
          });
        } else {
          options.onload?.({ status: 200, responseText: changelogHtml });
        }
      });
      await window.YouTubePlusUpdate.checkForUpdates(true);
    });
  });
});
