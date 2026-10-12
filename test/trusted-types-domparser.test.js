/**
 * DOMParser under Trusted Types. update.js routes the fetched changelog HTML
 * through the sanitizing policy before parsing; XML subtitles must NOT go
 * through that policy (it strips the caption tags) and fall back to the regex
 * readers. Real safe-dom policy + update.js; only the userscript-manager
 * surface is mocked.
 * @jest-environment jsdom
 */

const NEWER_METADATA = '// ==UserScript==\n// @version 3.1.0\n// ==/UserScript==';
const CHANGELOG_HTML =
  '<div class="version-item"><a href="#">3.1.0</a>' +
  '<div class="version-changelog">Bug fixes\nPerformance improvements</div></div>';

const setupDeps = () => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';

  // Pretend Trusted Types is available so safe-dom builds its sanitizing
  // policy; this is the Chrome state the parse fix targets.
  Object.defineProperty(window, 'trustedTypes', {
    configurable: true,
    writable: true,
    value: {
      createPolicy: (_name, rules) => ({
        createHTML: value => rules.createHTML(value),
        createScriptURL: value => rules.createScriptURL?.(value) ?? value,
        createScript: value => rules.createScript?.(value) ?? '',
      }),
    },
  });

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

describe('DOMParser under Trusted Types', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusUpdate;
    delete window.YouTubeSafeDOM;
    localStorage.clear();
    sessionStorage.clear();
    setupDeps();
    require('../src/safe-dom.js');
    require('../src/update.js');
  });

  test('the sanitizing policy strips XML caption tags (so XML skips DOMParser)', () => {
    const xml = '<transcript><text start="0" dur="1">hi</text></transcript>';
    const trusted = String(window.YouTubeSafeDOM.createTrustedHTML(xml));
    expect(trusted).not.toContain('<text');
  });

  test('the changelog is still readable after the HTML goes through the policy', async () => {
    globalThis.GM_xmlhttpRequest = jest.fn(options => {
      if (options.url.includes('versions')) {
        options.onload?.({ status: 200, responseText: CHANGELOG_HTML });
      } else {
        options.onload?.({ status: 200, responseText: NEWER_METADATA });
      }
    });

    await window.YouTubePlusUpdate.checkForUpdates(true);

    const notification = document.querySelector('.update-notification');
    expect(notification).toBeTruthy();
    expect(notification.textContent).toContain('Bug fixes');
    expect(window.YouTubePlusUpdate.updateState.updateDetails?.changelog).toContain('Bug fixes');
  });
});
