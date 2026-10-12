/**
 * The update installer opens a new tab and never navigates the current one.
 * A `noopener` window handle is always null, so the installer uses
 * U.openSafe's boolean instead of the handle. Real update.js through
 * window.YouTubePlusUpdate; only the userscript-manager surface is mocked.
 *
 * jsdom exposes `location.assign` as a non-configurable own property, so the
 * test asserts the observable consequence: a blocked/failed open falls back to
 * the manual-install hint (no navigation of the current tab), and a successful
 * open does not.
 * @jest-environment jsdom
 */

const setupUpdateDeps = () => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';

  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      cleanupManager: {
        registerInterval: jest.fn(id => id),
        registerTimeout: jest.fn(id => id),
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
      getScriptVersion: () => '3.0.0',
    },
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

const NEWER_METADATA = `
// ==UserScript==
// @name YouTube +
// @version 3.1.0
// ==/UserScript==
`;

/** Run the update check and click the install button on the notification. */
const clickInstall = async () => {
  globalThis.GM_xmlhttpRequest = jest.fn(options => {
    options.onload?.({ status: 200, responseText: NEWER_METADATA });
  });
  await window.YouTubePlusUpdate.checkForUpdates(true);
  const notification = document.querySelector('.update-notification');
  expect(notification).toBeTruthy();
  const installBtn = notification.querySelector('#update-install-btn');
  expect(installBtn).toBeTruthy();
  installBtn.click();
  return notification;
};

describe('update install opens a tab instead of navigating', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusUpdate;
    localStorage.clear();
    sessionStorage.clear();
    setupUpdateDeps();
    require('../src/update.js');
  });

  test('a successful openSafe opens a tab and does not fall back to the current tab', async () => {
    window.YouTubeUtils.openSafe.mockReturnValue(true);
    const hrefBefore = window.location.href;

    const notification = await clickInstall();

    expect(window.YouTubeUtils.openSafe).toHaveBeenCalledWith(
      expect.stringContaining('greasyfork.org'),
      '_blank'
    );
    // Success path: the card is dismissed and the manual hint is not shown.
    await new Promise(resolve => setTimeout(resolve, 420));
    expect(notification.isConnected).toBe(false);
    expect(window.YouTubeUtils.NotificationManager.show).not.toHaveBeenCalledWith(
      'manualInstallHint',
      expect.anything()
    );
    expect(window.location.href).toBe(hrefBefore);
  });

  test('a blocked URL shows the manual hint and never navigates the current tab', async () => {
    window.YouTubeUtils.openSafe.mockReturnValue(false);
    const hrefBefore = window.location.href;

    const notification = await clickInstall();

    expect(window.YouTubeUtils.openSafe).toHaveBeenCalled();
    expect(window.YouTubeUtils.NotificationManager.show).toHaveBeenCalledWith('manualInstallHint', {
      type: 'error',
      duration: 5000,
    });
    // The card stays; the page was not replaced by the install URL.
    expect(notification.isConnected).toBe(true);
    expect(window.location.href).toBe(hrefBefore);
  });
});
