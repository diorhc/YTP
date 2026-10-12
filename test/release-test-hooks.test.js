/**
 * @jest-environment jsdom
 *
 * Release-bundle gate for the testHooks surface: pages that run without the
 * test flag (every real user) must not see any facade's internal hook bag,
 * while the same bundle driven with window.__YTP_TEST_HOOKS__ === true does
 * expose them (that is the unit-test setup path).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE_PATH = path.join(ROOT, 'youtube.user.js');

/** Facades whose modules publish a testHooks bag. */
const HOOKED_FACADES = [
  'YouTubePlusScreenshot',
  'YouTubePlusPip',
  'YouTubePlusThumbnail',
  'YouTubePlusShorts',
  'YouTubePlusComment',
  'YouTubePlusEndscreen',
  'YouTubePlusPlayall',
  'YouTubePlusZoom',
];

const BOOT_GUARD_KEYS = [
  '__ytpBasicInitDone__',
  '__ytpMainExecDone__',
  '__ytpMainBootDone__',
  '__ytpTimeInitDone__',
  '__ytpDebug__',
  '__ytp_history_wrapped',
  '_enhancedInitialized',
  '_timecodeModuleInitialized',
  '_playlistSearchInitialized',
  '__ytpVideoStatsModuleInit',
  '__ytpChannelStatsModuleInit',
];

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
  if (!isBundleStale()) return;
  console.log('[release-test-hooks] Bundle is missing or stale — rebuilding...');
  execSync('node build.js --readable-release', {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 60_000,
  });
  if (!fs.existsSync(BUNDLE_PATH)) {
    throw new Error('Build completed but youtube.user.js still not found');
  }
}

function installStubs() {
  if (!window.ytcfg) {
    window.ytcfg = {
      get: () => undefined,
      data_: {},
      setInheritedData_: () => undefined,
      setConfig: () => undefined,
    };
  }
  if (!window.yt) {
    window.yt = { config_: {}, config: { GAPI_LOCALE: 'en' } };
  }
  if (typeof globalThis.GM_info === 'undefined') {
    globalThis.GM_info = { script: { version: '3.0.0', name: 'YouTube +' }, scriptMetaStr: '' };
  }
  for (const [name, value] of [
    ['GM_getValue', (_key, def) => def],
    ['GM_setValue', () => undefined],
    ['GM_addStyle', () => undefined],
    ['GM_xmlhttpRequest', () => ({ abort: () => undefined })],
    ['GM_addElement', () => document.createElement('div')],
    ['GM_getResourceText', () => null],
    ['GM_addValueChangeListener', () => 0],
    ['GM_removeValueChangeListener', () => undefined],
  ]) {
    if (typeof globalThis[name] === 'undefined') {
      globalThis[name] = jest.fn(value);
    }
  }
  if (typeof globalThis.unsafeWindow === 'undefined') {
    globalThis.unsafeWindow = window;
  }
  for (const selector of ['ytd-app', '#movie_player', 'ytd-browse', 'ytd-watch-flexy']) {
    if (!document.querySelector(selector)) {
      const el = document.createElement(selector.startsWith('#') ? 'div' : selector);
      if (selector === '#movie_player') el.id = 'movie_player';
      document.body.appendChild(el);
    }
  }
  if (!document.querySelector('#movie_player video')) {
    const video = document.createElement('video');
    document.querySelector('#movie_player').appendChild(video);
  }
}

/** Re-keys the URL to a watch page and fires YouTube's navigation event. */
function applyWatchFixture() {
  try {
    window.history.pushState({}, '', '/watch?v=dQw4w9WgXcQ');
  } catch {
    // jsdom may refuse history writes; the navigate event alone still drives
    // the route-gated facades.
  }
  document.dispatchEvent(new Event('yt-navigate-finish'));
}

function captureFacades(target) {
  for (const k of Object.keys(window)) {
    if (k.startsWith('YouTube') || k.startsWith('youtube')) {
      if (window[k] !== undefined && window[k] !== null) target[k] = window[k];
    }
  }
}

function restoreFacades(saved) {
  for (const [k, v] of Object.entries(saved)) {
    if (window[k] === undefined || window[k] === null) {
      try {
        Object.defineProperty(window, k, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: v,
        });
      } catch {
        window[k] = v;
      }
    }
  }
}

/** Clears facades and boot guards so the bundle executes from scratch again. */
function resetWindowRuntime() {
  for (const k of Object.getOwnPropertyNames(window)) {
    if (k.startsWith('YouTube') || k.startsWith('youtube') || k.startsWith('YTP')) {
      try {
        delete window[k];
      } catch {
        Object.defineProperty(window, k, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: undefined,
        });
      }
    }
  }
  for (const k of BOOT_GUARD_KEYS) {
    try {
      delete window[k];
    } catch {
      Object.defineProperty(window, k, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: undefined,
      });
    }
  }
  document.body.innerHTML = '';
  document.head.innerHTML = '';
}

function hasOwnTestHooks(value) {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, 'testHooks');
}

describe('release bundle without the test flag', () => {
  /** @type {Record<string, any>} */
  const saved = {};
  let evalError = null;

  beforeAll(() => {
    ensureBundle();
    delete window.__YTP_TEST_HOOKS__;
    installStubs();
    try {
      const src = stripMetadata(fs.readFileSync(BUNDLE_PATH, 'utf8'));
      new Function(src)();
      applyWatchFixture();
    } catch (err) {
      evalError = err;
    }
    captureFacades(saved);
  });

  beforeEach(() => {
    restoreFacades(saved);
  });

  afterEach(() => {
    captureFacades(saved);
  });

  it('bundle evaluates without fatal error and hooks stay hidden', () => {
    expect.hasAssertions();
    if (evalError) throw evalError;
    expect(window.YouTubeUtils).toBeDefined();
  });

  it('no facade object carries a testHooks property', () => {
    expect.hasAssertions();
    const offenders = Object.values(saved).filter(hasOwnTestHooks);
    expect(offenders).toEqual([]);
  });

  test.each(HOOKED_FACADES)('%s does not expose testHooks', name => {
    expect.hasAssertions();
    const facade = saved[name];
    expect(facade).toBeDefined();
    expect(hasOwnTestHooks(facade)).toBe(false);
  });
});

describe('release bundle with the test flag set', () => {
  /** @type {Record<string, any>} */
  const saved = {};
  let evalError = null;

  beforeAll(() => {
    resetWindowRuntime();
    window.__YTP_TEST_HOOKS__ = true;
    installStubs();
    try {
      const src = stripMetadata(fs.readFileSync(BUNDLE_PATH, 'utf8'));
      new Function(src)();
      applyWatchFixture();
    } catch (err) {
      evalError = err;
    }
    captureFacades(saved);
  });

  beforeEach(() => {
    restoreFacades(saved);
  });

  afterEach(() => {
    captureFacades(saved);
  });

  it('bundle evaluates without fatal error', () => {
    expect.hasAssertions();
    if (evalError) throw evalError;
    expect(window.YouTubeUtils).toBeDefined();
  });

  test.each(HOOKED_FACADES)('%s exposes testHooks with the flag on', name => {
    expect.hasAssertions();
    const facade = saved[name];
    expect(facade).toBeDefined();
    expect(hasOwnTestHooks(facade)).toBe(true);
    expect(typeof facade.testHooks).toBe('object');
  });
});
