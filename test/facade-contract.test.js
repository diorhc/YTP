/**
 * Facade contract tests — single source of truth for the canonical
 * window.* / unsafeWindow.* surface exposed by every module.
 *
 * Public browser API contract (kept directly in these runtime tests).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE_PATH = process.env.TEST_BUNDLE_PATH
  ? path.resolve(ROOT, process.env.TEST_BUNDLE_PATH)
  : path.join(ROOT, 'youtube.user.js');
function stripMetadata(src) {
  const endTag = '// ==/UserScript==';
  const idx = src.indexOf(endTag);
  return idx === -1 ? src : src.slice(idx + endTag.length).trim();
}

function isBundleStale() {
  if (!fs.existsSync(BUNDLE_PATH)) return true;
  const bundleMtime = fs.statSync(BUNDLE_PATH).mtimeMs;
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'));
  for (const f of srcFiles) {
    if (fs.statSync(path.join(ROOT, 'src', f)).mtimeMs > bundleMtime) {
      return true;
    }
  }
  return false;
}

function ensureBundle() {
  if (process.env.TEST_BUNDLE_PATH) {
    if (!fs.existsSync(BUNDLE_PATH)) {
      throw new Error(`[facade-contract] Specified TEST_BUNDLE_PATH not found: ${BUNDLE_PATH}`);
    }
  } else if (isBundleStale()) {
    console.log('[facade-contract] Bundle is missing or stale — rebuilding...');
    execSync('node build.js --readable-release --no-lint', {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 60_000,
    });
    if (!fs.existsSync(BUNDLE_PATH)) {
      throw new Error('Build completed but youtube.user.js still not found');
    }
  }
  const content = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  console.log(
    `[facade-contract] Testing bundle: ${path.basename(BUNDLE_PATH)} (sha256: ${hash.slice(0, 12)}…, size: ${content.length} bytes)`
  );
}

function installStubs() {
  if (typeof window === 'undefined') return;

  if (!window.ytcfg) {
    window.ytcfg = {
      get: () => undefined,
      data_: {},
      setInheritedData_: () => {
        /* mock */
      },
      setConfig: () => {
        /* mock */
      },
    };
  }
  if (!window.yt) {
    window.yt = { config_: {}, config: { GAPI_LOCALE: 'en' } };
  }
  const origGet = window.ytcfg.get.bind(window.ytcfg);
  window.ytcfg.get = key => {
    if (key === 'INNERTUBE_CONTEXT') {
      return { client: { clientName: 'WEB', clientVersion: '2.20240101' } };
    }
    if (key === 'INNERTUBE_API_KEY') return 'test-key';
    if (key === 'VISITOR_DATA') return 'test-visitor';
    if (key === 'DELEGATION_ID') return '';
    if (key === 'DATASYNC_ID') return '';
    if (key === 'ID_TOKEN') return '';
    return origGet(key);
  };

  if (!document.querySelector('ytd-app')) {
    document.body.appendChild(document.createElement('ytd-app'));
  }
  if (!document.querySelector('#movie_player')) {
    const player = document.createElement('div');
    player.id = 'movie_player';
    document.body.appendChild(player);
  }
  if (!document.querySelector('#movie_player video')) {
    const video = document.createElement('video');
    document.querySelector('#movie_player').appendChild(video);
  }
  if (!document.querySelector('ytd-browse')) {
    document.body.appendChild(document.createElement('ytd-browse'));
  }
  if (!document.querySelector('ytd-watch-flexy')) {
    document.body.appendChild(document.createElement('ytd-watch-flexy'));
  }

  if (typeof globalThis.GM_info === 'undefined') {
    globalThis.GM_info = {
      script: { version: '3.0.0', name: 'YouTube +' },
      scriptMetaStr: '',
    };
  }
  if (typeof globalThis.GM_getValue === 'undefined') {
    globalThis.GM_getValue = jest.fn((_key, def) => def);
  }
  if (typeof globalThis.GM_setValue === 'undefined') {
    globalThis.GM_setValue = jest.fn();
  }
  if (typeof globalThis.GM_addStyle === 'undefined') {
    globalThis.GM_addStyle = jest.fn();
  }
  if (typeof globalThis.GM_xmlhttpRequest === 'undefined') {
    globalThis.GM_xmlhttpRequest = jest.fn(() => ({
      abort: () => {
        /* mock */
      },
    }));
  }
  if (typeof globalThis.GM_addElement === 'undefined') {
    globalThis.GM_addElement = jest.fn(() => document.createElement('div'));
  }
  if (typeof globalThis.GM_getResourceText === 'undefined') {
    globalThis.GM_getResourceText = jest.fn(() => null);
  }
  if (typeof globalThis.GM_addValueChangeListener === 'undefined') {
    globalThis.GM_addValueChangeListener = jest.fn(() => 0);
  }
  if (typeof globalThis.GM_removeValueChangeListener === 'undefined') {
    globalThis.GM_removeValueChangeListener = jest.fn();
  }

  if (typeof globalThis.unsafeWindow === 'undefined') {
    globalThis.unsafeWindow = window;
  }
}

function applyFixture(fixture) {
  if (!fixture) return true;
  switch (fixture) {
    case 'watch':
      try {
        window.history.pushState({}, '', '/watch?v=dQw4w9WgXcQ');
      } catch {
        /* ignore jsdom pushState restrictions */
      }
      document.dispatchEvent(new Event('yt-navigate-finish'));
      return true;
    case 'shorts':
      try {
        window.history.pushState({}, '', '/shorts/abc123');
      } catch {
        /* ignore jsdom pushState restrictions */
      }
      document.dispatchEvent(new Event('yt-navigate-finish'));
      return true;
    case 'channel':
      try {
        window.history.pushState({}, '', '/@TestChannel/videos');
      } catch {
        /* ignore jsdom pushState restrictions */
      }
      document.dispatchEvent(new Event('yt-navigate-finish'));
      return true;
    case 'playlist':
      try {
        window.history.pushState({}, '', '/playlist?list=PL123');
      } catch {
        /* ignore jsdom pushState restrictions */
      }
      document.dispatchEvent(new Event('yt-navigate-finish'));
      return true;
    case 'music':
      try {
        window.history.pushState({}, '', 'https://music.youtube.com/watch?v=abc');
      } catch {
        /* ignore jsdom pushState restrictions */
      }
      return window.location.hostname === 'music.youtube.com';
    case 'settings-modal-opened':
      delete window.__ytpChannelStatsModuleInit;
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      return true;
    case 'core':
      return true;
    default:
      return true;
  }
}

function ensureDomElements() {
  if (!document.querySelector('ytd-app')) {
    document.body.appendChild(document.createElement('ytd-app'));
  }
  if (!document.querySelector('#movie_player')) {
    const player = document.createElement('div');
    player.id = 'movie_player';
    document.body.appendChild(player);
  }
  if (!document.querySelector('#movie_player video')) {
    const video = document.createElement('video');
    const player = document.querySelector('#movie_player');
    if (player) player.appendChild(video);
  }
  if (!document.querySelector('ytd-browse')) {
    document.body.appendChild(document.createElement('ytd-browse'));
  }
  if (!document.querySelector('ytd-watch-flexy')) {
    document.body.appendChild(document.createElement('ytd-watch-flexy'));
  }
}

function captureFacades(target) {
  for (const k of Object.keys(window)) {
    if (
      k.startsWith('YouTubePlus') ||
      k.startsWith('YouTube') ||
      k.startsWith('youtubePlus') ||
      k.startsWith('youtube')
    ) {
      if (window[k] !== undefined) target[k] = window[k];
    }
  }
}

describe('Public facade contract', () => {
  let evalError = null;
  const savedFacades = {};

  beforeAll(() => {
    ensureBundle();
    installStubs();

    const bundleSrc = stripMetadata(fs.readFileSync(BUNDLE_PATH, 'utf8'));
    try {
      const fn = new Function(bundleSrc);
      fn();
    } catch (err) {
      evalError = err;
    }

    captureFacades(savedFacades);
    for (const k of ['YouTubeStats', 'YouTubeMusic', 'YouTubePlusStyleResources']) {
      if (window[k] !== undefined) savedFacades[k] = window[k];
    }
  });

  beforeEach(() => {
    for (const [k, v] of Object.entries(savedFacades)) {
      if (v !== undefined && (window[k] === undefined || window[k] === null)) {
        try {
          Object.defineProperty(window, k, {
            configurable: true,
            writable: true,
            value: v,
          });
        } catch {
          window[k] = v;
        }
      }
    }
    ensureDomElements();
  });

  afterEach(() => {
    captureFacades(savedFacades);
  });

  it('bundle evaluated without fatal error and created core facades', () => {
    expect.hasAssertions();
    if (evalError) {
      throw evalError;
    }
    expect(window.YouTubeSafeDOM).toBeDefined();
    expect(window.YouTubePlusErrorBoundary).toBeDefined();
    expect(window.YouTubePlusCleanupManager).toBeDefined();
    expect(window.YouTubeUtils).toBeDefined();
  });

  // Music has a separate real-origin suite in music.test.js.
  const facades = [
    ['YouTubePlusErrorBoundary', ''],
    ['YouTubePlusLogger', ''],
    ['YouTubePlusCleanupManager', ''],
    ['YouTubeUtils', ''],
    ['YouTubePlusConfig', ''],
    ['YouTubePlusScrollManager', ''],
    ['YouTubePlusSettingsStore', ''],
    ['YouTubePlusDesignSystem', ''],
    ['YouTubeSafeDOM', ''],
    ['YouTubeTrustedTypes', ''],
    ['YouTubePlusDOMCache', ''],
    ['YouTubePlusMutationCoordinator', ''],
    ['YouTubePlusEventDelegation', ''],
    ['YouTubePlusI18n', ''],
    ['YouTubePlusI18nLoader', ''],
    ['YouTubePlusSettingsHelpers', ''],
    ['YouTubePlusFeatureRegistry', ''],
    ['YouTubePlusVisionDockHost', ''],
    ['YouTubePlusSettingsHost', ''],
    ['YouTubePlusPlayerActionHost', ''],
    ['YouTubePlusPopoverController', ''],
    ['YouTubePlusSpeedControl', ''],
    ['YouTubePlusScreenshot', ''],
    ['YouTubePlusPerformance', ''],
    ['YouTubePerformance', ''],
    ['YouTubePlusBasic', ''],
    ['YouTubePlus', ''],
    ['YouTubePlusDebug', ''],
    ['YouTubePlusMain', ''],
    ['YouTubePlusModalHandlers', ''],
    ['YouTubePlusModalDownloadHandlers', ''],
    ['YouTubePlusSettingsModal', ''],
    ['YouTubePlusDownload', 'watch'],
    ['YouTubePlusDownloadButton', ''],
    ['YouTubePlusEnhanced', ''],
    ['YouTubePlusAdBlocker', ''],
    ['YouTubePlusPip', ''],
    ['YouTubePlusTimecode', 'watch'],
    ['YouTubePlusPlaylistSearch', ''],
    ['YouTubePlusThumbnail', ''],
    ['YouTubePlusShorts', ''],
    ['YouTubePlusStats', 'settings-modal-opened'],
    ['YouTubeStats', 'settings-modal-opened'],
    ['YouTubePlusComment', ''],
    ['YouTubePlusReport', ''],
    ['YouTubePlusUpdate', ''],
    ['YouTubePlusEndscreen', ''],
    ['YouTubePlusPlayall', ''],
    ['YouTubePlusTimeLoop', ''],
    ['YouTubePlusZoom', 'watch'],
    ['YouTubePlusVoting', 'watch'],
  ];
  test.each(facades)('%s is available in its route fixture', (name, fixture) => {
    expect(applyFixture(fixture)).toBe(true);
    expect(window[name]).toBeDefined();
    expect(window[name]).not.toBeNull();
  });
});
