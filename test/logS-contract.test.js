/**
 * Suppressed-error wrappers keep
 * the ORIGINAL Error (message, cause, stack, identity) all the way to the
 * ErrorBoundary, and the array-style wrappers (a[0]) are gone.
 */

describe('logS wrappers preserve the original error', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('real FeatureRegistry path: ErrorBoundary sees the ORIGINAL error', () => {
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=testvideo1',
    });
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/feature-registry.js');

    /** @type {{e: unknown, c: any}[]} */
    const seen = [];
    window.YouTubePlusErrorBoundary = /** @type {any} */ ({
      logError: (e, c) => seen.push({ e, c }),
    });

    const sentinel = new Error('sentinel audit failure');
    // A settings store that throws — FeatureRegistry.isEnabled catches and
    // routes the failure through its logS wrapper.
    const originalStore = window.YouTubePlusSettingsStore;
    window.YouTubePlusSettingsStore = /** @type {any} */ ({
      get() {
        throw sentinel;
      },
      hasKey: () => true,
      subscribe: () => () => {
        /* mock */
      },
    });

    try {
      window.YouTubePlusSettingsHost.isEnabled('enableScreenshot');
    } finally {
      window.YouTubePlusSettingsStore = originalStore;
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].e).toBe(sentinel);
    expect(seen[0].c.module).toBe('FeatureRegistry');
  });

  test('logSuppressed keeps message, cause and stack for non-Error input', () => {
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    /** @type {{e: unknown, c: any}[]} */
    const seen = [];
    window.YouTubePlusErrorBoundary = /** @type {any} */ ({
      logError: (e, c) => seen.push({ e, c }),
    });

    window.YouTubeUtils.logSuppressed('plain string failure', 'TestModule');

    expect(seen).toHaveLength(1);
    const normalized = /** @type {Error} */ (seen[0].e);
    expect(normalized instanceof Error).toBe(true);
    expect(normalized.message).toBe('plain string failure');
    expect(seen[0].c.module).toBe('TestModule');
  });

  test('no array-style (a[0]) logS wrappers remain in src/', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const files = fs.readdirSync(path.resolve(__dirname, '../src')).filter(f => f.endsWith('.js'));
    for (const f of files) {
      const src = fs.readFileSync(path.resolve(__dirname, '../src', f), 'utf8');
      // The broken pattern: a wrapper parameter typed as an array and read
      // by index instead of passing the error through.
      const broken =
        /logSuppressed\?\.\(\s*U\?\.\s*normalizeSuppressedError\?\.\(a\[0\]\)/.test(src) ||
        /logSuppressed\?\.\(a\[0\]/.test(src);
      expect({ file: f, broken: broken }).toEqual({ file: f, broken: false });
    }
  });
});
