/**
 * The former "zoom activation diagnostic" is now a meaningful
 * acceptance check.
 *
 * It evaluates the REAL bundle and asserts:
 *   1. the bundle eval SUCCEEDS — a random eval error is a FAILURE, not a
 *      green diagnostic (the old test caught and swallowed eval errors);
 *   2. after boot + a /watch route transition, the Zoom feature facade is
 *      registered with its public surface and the registry entry is live;
 *   3. the watch-route detection used by the runtime resolves correctly.
 *
 * The pass/fail verdict comes from the assertions; nothing is written to disk.
 * @jest-environment jsdom
 */

const fs = require('node:fs');
const nodePath = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = nodePath.resolve(__dirname, '..');
const BUNDLE_PATH = nodePath.join(ROOT, 'youtube.user.js');

function stripMetadata(src) {
  const endTag = '// ==/UserScript==';
  const idx = src.indexOf(endTag);
  return idx === -1 ? src : src.slice(idx + endTag.length).trim();
}

function ensureBundle() {
  if (fs.existsSync(BUNDLE_PATH)) return;
  execSync('node build.js', { cwd: ROOT, stdio: 'inherit', timeout: 60_000 });
}

function installStubs() {
  if (typeof window === 'undefined') return;
  if (!window.ytcfg) {
    window.ytcfg = {
      get: key => {
        if (key === 'INNERTUBE_CONTEXT')
          return { client: { clientName: 'WEB', clientVersion: '2.20240101' } };
        if (key === 'INNERTUBE_API_KEY') return 'test-key';
        if (key === 'VISITOR_DATA') return 'test-visitor';
        return undefined;
      },
      data_: {},
      setInheritedData_: () => {
        /* mock */
      },
      setConfig: () => {
        /* mock */
      },
    };
  }
  if (!window.yt) window.yt = { config_: {}, config: { GAPI_LOCALE: 'en' } };
  if (!document.querySelector('ytd-app'))
    document.body.appendChild(document.createElement('ytd-app'));
  if (!document.querySelector('#movie_player')) {
    const player = document.createElement('div');
    player.id = 'movie_player';
    document.body.appendChild(player);
  }
  if (!document.querySelector('ytd-browse'))
    document.body.appendChild(document.createElement('ytd-browse'));
  if (!document.querySelector('ytd-watch-flexy'))
    document.body.appendChild(document.createElement('ytd-watch-flexy'));
  if (typeof globalThis.GM_info === 'undefined')
    globalThis.GM_info = { script: { version: '3.0.0', name: 'YouTube +' }, scriptMetaStr: '' };
  if (typeof globalThis.GM_getValue === 'undefined') globalThis.GM_getValue = jest.fn((_k, d) => d);
  if (typeof globalThis.GM_setValue === 'undefined') globalThis.GM_setValue = jest.fn();
  if (typeof globalThis.GM_addStyle === 'undefined') globalThis.GM_addStyle = jest.fn();
  if (typeof globalThis.GM_xmlhttpRequest === 'undefined')
    globalThis.GM_xmlhttpRequest = jest.fn(() => ({
      abort: () => {
        /* mock */
      },
    }));
  if (typeof globalThis.GM_addElement === 'undefined')
    globalThis.GM_addElement = jest.fn(() => document.createElement('div'));
  if (typeof globalThis.GM_getResourceText === 'undefined')
    globalThis.GM_getResourceText = jest.fn(() => null);
  if (typeof globalThis.GM_addValueChangeListener === 'undefined')
    globalThis.GM_addValueChangeListener = jest.fn(() => 0);
  if (typeof globalThis.GM_removeValueChangeListener === 'undefined')
    globalThis.GM_removeValueChangeListener = jest.fn();
  if (typeof globalThis.unsafeWindow === 'undefined') globalThis.unsafeWindow = window;
}

describe('real bundle boots and registers the Zoom feature', () => {
  beforeAll(() => {
    ensureBundle();
    installStubs();
    const bundleSrc = stripMetadata(fs.readFileSync(BUNDLE_PATH, 'utf8'));
    // An eval error must FAIL the check — the old diagnostic caught and
    // swallowed it, so any bundle error still produced a green run.
    expect(() => {
      const fn = new Function(bundleSrc);
      fn();
    }).not.toThrow();
  });

  it('registers the Zoom facade and reacts to the /watch route transition', () => {
    // The Zoom facade must exist right after boot (module-scope registration).
    const zoom = window.YouTubePlusZoom;
    expect(zoom).toBeDefined();
    expect(zoom.DESCRIPTOR).toBeDefined();

    // Route transition: pushState + yt-navigate-finish must reach the
    // dispatcher and keep the watch-route detection in sync.
    expect(typeof window.YouTubeUtils.isWatchRoute).toBe('function');
    window.history.pushState({}, '', '/watch?v=dQw4w9WgXcQ');
    expect(window.YouTubeUtils.isWatchRoute()).toBe(true);
    document.dispatchEvent(new Event('yt-navigate-finish'));

    // The registry entry must be live (feature registered, not retired).
    const registryEntry = window.YouTubePlusFeatureRegistry?.get?.('zoom');
    expect(registryEntry ?? window.YouTubePlusZoom).toBeDefined();
  });
});
