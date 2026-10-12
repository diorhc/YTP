/**
 * Integration tests for build system
 */

const fs = require('fs');
const path = require('path');

describe('Build System', () => {
  const ROOT = path.resolve(__dirname, '..');
  const BUILD_ORDER_PATH = path.join(ROOT, 'build.order.json');
  const BUILD_SCRIPT_PATH = path.join(ROOT, 'build.js');
  const SRC_DIR = path.join(ROOT, 'src');

  /** Manifest entries may be strings (legacy) or { name, hosts }. */
  const orderEntries = () => JSON.parse(fs.readFileSync(BUILD_ORDER_PATH, 'utf8'));
  const orderNames = entries => entries.map(e => (typeof e === 'string' ? e : e.name));

  test('build.order.json should exist', () => {
    expect(fs.existsSync(BUILD_ORDER_PATH)).toBe(true);
  });

  test('build.order.json should be valid JSON', () => {
    const content = fs.readFileSync(BUILD_ORDER_PATH, 'utf8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test('all modules in build.order.json should exist', () => {
    const buildOrder = orderEntries();
    expect(Array.isArray(buildOrder)).toBe(true);

    orderNames(buildOrder).forEach(
      /** @param {string} filename */ filename => {
        const filePath = path.join(SRC_DIR, filename);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    );
  });

  test('all source files are in build.order.json (except the inlined host policy)', () => {
    const names = orderNames(orderEntries());
    const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js') && f !== 'host-policy.js');

    files.forEach(
      /** @param {string} file */ file => {
        expect(names).toContain(file);
      }
    );
  });

  test('error-boundary.js and logger.js should be the first two modules', () => {
    // error-boundary.js is loaded first so window.YouTubeErrorBoundary is
    // available for the back-compat bridge in logger.js. logger.js follows
    // immediately so window.YouTubePlusLogger is published before consumers.
    const names = orderNames(orderEntries());
    expect(names[0]).toBe('error-boundary.js');
    expect(names[1]).toBe('logger.js');
  });

  test('infrastructure modules should come early in build order', () => {
    const names = orderNames(orderEntries());
    // Check that infrastructure modules are in the first 7
    const firstSeven = names.slice(0, 7);
    expect(firstSeven).toContain('error-boundary.js');
    expect(firstSeven).toContain('logger.js');
    expect(firstSeven).toContain('utils.js');
    // error-boundary.js must be first, logger.js must be before utils.js
    expect(names[0]).toBe('error-boundary.js');
    expect(names.indexOf('logger.js')).toBeGreaterThan(names.indexOf('error-boundary.js'));
    expect(names.indexOf('utils.js')).toBeGreaterThan(names.indexOf('logger.js'));
  });

  test('source files should have valid JavaScript syntax', () => {
    const names = orderNames(orderEntries());

    names.forEach(
      /** @param {string} filename */ filename => {
        const filePath = path.join(SRC_DIR, filename);
        const content = fs.readFileSync(filePath, 'utf8');

        // Basic syntax check - should not throw
        expect(() => {
          // Just check if it's parseable, not executable
          new Function(content);
        }).not.toThrow();
      }
    );
  });

  test('build script supports __YTPLUS_INLINE_CSS__ replacement marker', () => {
    const buildScript = fs.readFileSync(BUILD_SCRIPT_PATH, 'utf8');

    expect(buildScript).toContain("content?.includes('__YTPLUS_INLINE_CSS__')");
    expect(buildScript).toContain('/__YTPLUS_INLINE_CSS__\\(\\s*[\'"]([^\'"]+?)[\'"]\\s*\\)/g');
  });

  test('build embeds the digest-verified English dictionary before the i18n module', () => {
    const vm = require('vm');
    const { execFileSync } = require('child_process');
    const { createHash } = require('crypto');

    const outDir = path.join(ROOT, 'test-results');
    const outPath = path.join(outDir, 'embedded-dictionary-check.user.js');
    fs.mkdirSync(outDir, { recursive: true });
    execFileSync(process.execPath, ['build.js', '--no-lint', '--out', outPath], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 120000,
    });

    const bundle = fs.readFileSync(outPath, 'utf8');
    const blockStart = bundle.indexOf(`globalThis.__YouTubePlusEmbeddedDictionaries__ = `);
    expect(blockStart).toBeGreaterThan(-1);
    // i18n.js reads the payload during its own initialization.
    expect(blockStart).toBeLessThan(bundle.indexOf('// --- MODULE: i18n.js ---'));
    const blockEnd = bundle.indexOf('\n});', blockStart);
    expect(blockEnd).toBeGreaterThan(blockStart);

    const sandbox = vm.createContext({});
    vm.runInContext(bundle.slice(blockStart, blockEnd + 4), sandbox);
    const embedded = vm.runInContext(
      'globalThis.__YouTubePlusEmbeddedDictionaries__.en.data',
      sandbox
    );

    const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'en.json'), 'utf8'));
    expect(embedded).toEqual(shipped);

    // The embedded payload must be the exact bytes the delivery manifest in
    // src/i18n.js pins, otherwise the runtime rejects the offline fallback.
    const canonical = JSON.stringify(embedded, Object.keys(embedded).sort());
    const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
    const manifestEnDigest = fs
      .readFileSync(path.join(ROOT, 'src', 'i18n.js'), 'utf8')
      .match(/"en":\s*"([0-9a-f]{64})"/)?.[1];
    expect(digest).toBe(manifestEnDigest);
  });

  test('readable release keeps every identifier while still compressing', () => {
    const { execFileSync } = require('child_process');

    const outDir = path.join(ROOT, 'test-results');
    const outPath = path.join(outDir, 'readable-release-check.user.js');
    fs.mkdirSync(outDir, { recursive: true });
    execFileSync(process.execPath, ['build.js', '--readable-release', '--out', outPath], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 180000,
    });

    const bundle = fs.readFileSync(outPath, 'utf8');
    // Names that a mangling build renames must survive verbatim: a private
    // helper and a module-local function from different modules.
    expect(bundle).toContain('_installPotHooksOnce');
    expect(bundle).toContain('batchedRowsRpc_');
    // Beautified, not one-statement-per-line minified output.
    expect(bundle.split('\n').length).toBeGreaterThan(10000);
    // The userscript header survives as the preamble.
    expect(bundle.startsWith('// ==UserScript==')).toBe(true);
    expect(bundle).toContain('@downloadURL');

    const unoptimized = outPath.replace(/\.js$/, '.unoptimized.js');
    expect(fs.existsSync(unoptimized)).toBe(true);
    // Compression still happened, it is just not mangling.
    expect(Buffer.byteLength(bundle, 'utf8')).toBeLessThan(
      Buffer.byteLength(fs.readFileSync(unoptimized, 'utf8'))
    );
    expect(() => new Function(bundle)).not.toThrow();
  });

  test('every module runs inside its own host gate and error boundary', () => {
    const vm = require('vm');
    const { execFileSync } = require('child_process');

    const outDir = path.join(ROOT, 'test-results');
    const outPath = path.join(outDir, 'module-boundary-check.user.js');
    fs.mkdirSync(outDir, { recursive: true });
    execFileSync(process.execPath, ['build.js', '--no-lint', '--out', outPath], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 120000,
    });
    const bundle = fs.readFileSync(outPath, 'utf8');
    const names = orderNames(orderEntries());

    /** @param {string} name */
    const segment = name => {
      const start = bundle.indexOf(`// --- MODULE: ${name} ---`);
      expect(start).toBeGreaterThan(-1);
      const next = bundle.indexOf('// --- MODULE: ', start + 1);
      const end = bundle.indexOf('// --- EMBEDDED LOCALE', start + 1);
      const stops = [next, end].filter(n => n > start);
      return bundle.slice(start, stops.length ? Math.min(...stops) : bundle.length).trim();
    };

    for (const name of names) {
      const body = segment(name).replace(/^\/\/ --- MODULE: .*\n+/, '');
      // The host gate wraps the module's own try/catch error boundary.
      expect(body.startsWith('if (window.YouTubePlusHostPolicy')).toBe(true);
      expect(body).toContain(`window.YouTubePlusHostPolicy.runs("${name}")`);
      expect(
        body.endsWith(`console.error("[YouTube+] ${name} failed to initialize", error);\n  }\n}`)
      ).toBe(true);
    }

    // A throw while one module initializes is reported, and the next module
    // still runs. The sandbox policy satisfies the gate.
    const [first, second] = names;
    const failing = segment(first).replace(
      /try \{\n[\s\S]*?\n {2}\} catch \(error\)/,
      'try {\nthrow new Error("boom");\n  } catch (error)'
    );
    const marker = segment(second).replace(
      /try \{\n[\s\S]*?\n {2}\} catch \(error\)/,
      'try {\nglobalThis.reached = true;\n  } catch (error)'
    );
    const errors = [];
    const sandbox = vm.createContext({
      window: { YouTubePlusHostPolicy: { runs: () => true } },
      console: { error: (/** @type {unknown[]} */ ...a) => errors.push(a) },
    });
    vm.runInContext(`${failing}\n${marker}`, sandbox);
    expect(sandbox.reached).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe(`[YouTube+] ${first} failed to initialize`);
    expect(errors[0][1].message).toBe('boom');
  });

  test('a module without "hosts" runs on youtube only; hosts are validated', () => {
    const { normalizeHosts, parseOrderManifest, KNOWN_HOSTS } = require(
      path.join(ROOT, 'build.js')
    );
    expect(KNOWN_HOSTS).toEqual(['youtube', 'myactivity']);

    // Legacy string entries and object entries without hosts default to youtube.
    expect(parseOrderManifest('["a.js", "b.js"]', true)).toEqual([
      { name: 'a.js', hosts: ['youtube'] },
      { name: 'b.js', hosts: ['youtube'] },
    ]);
    expect(
      parseOrderManifest(JSON.stringify([{ name: 'c.js', hosts: ['youtube', 'myactivity'] }]), true)
    ).toEqual([{ name: 'c.js', hosts: ['youtube', 'myactivity'] }]);

    // An unknown host or malformed entry fails the build instead of defaulting.
    expect(() => normalizeHosts(['myspace'], 'x.js')).toThrow(/unknown host/);
    expect(() =>
      parseOrderManifest(JSON.stringify([{ name: 'x.js', hosts: 'youtube' }]), true)
    ).toThrow(/invalid "hosts"/);
    expect(() => parseOrderManifest(JSON.stringify(['']), true)).toThrow(/empty name/);
  });

  test('the legacy string manifest still builds end to end', () => {
    const { execFileSync } = require('child_process');
    const outDir = path.join(ROOT, 'test-results', 'legacy-manifest');
    fs.mkdirSync(outDir, { recursive: true });
    const orderPath = path.join(outDir, 'order.json');
    const outPath = path.join(outDir, 'legacy.user.js');
    fs.writeFileSync(orderPath, JSON.stringify(orderNames(orderEntries()), null, 2));
    execFileSync(
      process.execPath,
      ['build.js', '--no-lint', '--order', orderPath, '--out', outPath],
      { cwd: ROOT, stdio: 'pipe', timeout: 120000 }
    );
    const bundle = fs.readFileSync(outPath, 'utf8');
    // Every legacy entry is youtube-only, and the gate is still emitted.
    expect(bundle).toContain('// --- HOST POLICY (src/host-policy.js, inlined) ---');
    expect(bundle).toContain('if (window.YouTubePlusHostPolicy');
    expect(bundle).toMatch(/"comment\.js":\["youtube"\]/);
  });
});
