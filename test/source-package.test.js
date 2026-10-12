/**
 * @jest-environment jsdom
 */

/**
 * Clean and complete source package.
 *
 * Always-on checks (fast): packaging succeeds, is byte-deterministic, the
 * archive carries the mandatory surface (CI definitions, coverage
 * floors, locales, instructions), never leaks installed deps /
 * build outputs / historical results, and its in-archive manifest matches the
 * actual payload bytes. Heavy install/build-from-unpacked acceptance lives in
 * the gated RUN_SOURCE_PACKAGE_INTEGRATION=1 suite.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PKG_SCRIPT = path.join(ROOT, 'scripts', 'package-source.js');

function sha256(/** @type {Buffer | string} */ data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Minimal independent ZIP reader (EOCD + central directory + stored payloads). */
function readZip(/** @type {string} */ file) {
  const buf = fs.readFileSync(file);
  // EOCD: scan backwards for the signature (our writer writes no comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('ZIP EOCD not found');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  /** @type {{ name: string, crc: number, size: number, payload: Buffer }[]} */
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    // Local header: 30 bytes + name (+ extra) then the stored payload.
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    entries.push({
      name,
      crc,
      size,
      payload: buf.slice(dataStart, dataStart + size),
    });
    p += 46 + nameLen;
  }
  return { count, entries };
}

describe('source package', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-srcpkg-test-'));

  afterEach(() => {
    for (const f of fs.readdirSync(outDir)) {
      fs.rmSync(path.join(outDir, f), { force: true, recursive: true });
    }
  });

  afterAll(() => {
    fs.rmSync(outDir, { force: true, recursive: true });
  });

  function pack(/** @type {string} */ outName) {
    const out = path.join(outDir, outName);
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [PKG_SCRIPT, '--out', out], { cwd: ROOT, encoding: 'utf8' });
    return out;
  }

  test('two runs on the same input produce byte-identical archives', () => {
    const a = pack('a.zip');
    const b = pack('b.zip');
    expect(sha256(fs.readFileSync(a))).toBe(sha256(fs.readFileSync(b)));
    expect(path.extname(a)).toBe('.zip');
  });

  test('archive structure: sorted entries, mandatory surface present, forbidden leaks absent', () => {
    const { count, entries } = readZip(pack('structure.zip'));

    // Sorted order (deterministic normalization).
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].name < entries[i].name).toBe(true);
    }
    expect(count).toBe(entries.length);

    const names = new Set(entries.map(e => e.name));
    // Mandatory surface: CI, coverage floors, tests, locales, config.
    const mandatory = [
      '.github/workflows/ci.yml',
      'coverage-ratchet.json',
      'locales/en.json',
      'locales/ru.json',
      'test/setup.js',
      'build.js',
      'build.order.json',
      'biome.json',
      'jest.config.js',
      'package.json',
      'package-lock.json',
      'README.md',
      'source-package-manifest.json',
    ];
    for (const m of mandatory) {
      expect(names.has(m)).toBe(true);
    }

    // No historical results, installed deps, build outputs or archives leak in.
    const forbiddenPrefixes = [
      'node_modules/',
      '.git/',
      'coverage/',
      'test-results/',
      'architecture/',
      'infrastructure/',
      'tools/',
    ];
    for (const e of entries) {
      for (const prefix of forbiddenPrefixes) {
        expect(e.name.startsWith(prefix)).toBe(false);
      }
      expect(e.name.endsWith('.result.json')).toBe(false);
      expect(e.name.endsWith('.zip')).toBe(false);
      expect(e.name.endsWith('.log')).toBe(false);
    }
    // Release artifacts describe BUNDLES — not part of a SOURCE package.
    expect(names.has('release-manifest.json')).toBe(false);
    for (const retired of [
      'sbom.json',
      'inventory.json',
      'complexity-baseline.json',
      'css-parity-snapshot.json',
    ])
      expect(names.has(retired)).toBe(false);
    expect(names.has('youtube.user.js')).toBe(false);
    expect(names.has('youtube.user.min.js')).toBe(false);
    expect(count).toBe(entries.length);
  });

  test('in-archive manifest matches the actual payload of every entry', () => {
    const { entries } = readZip(pack('manifest.zip'));
    const byName = new Map(entries.map(e => [e.name, e]));
    const manifest = JSON.parse(
      /** @type {{ payload: Buffer }} */ (
        byName.get('source-package-manifest.json')
      ).payload.toString('utf8')
    );
    expect(manifest.format).toBe('youtube-plus-source-package');
    expect(manifest.files.length).toBe(entries.length - 1);

    for (const f of manifest.files) {
      const entry = byName.get(f.path);
      expect(entry).toBeTruthy();
      expect(sha256(/** @type {{ payload: Buffer }} */ (entry).payload)).toBe(f.sha256);
    }
  });

  test('a missing mandatory path FAILS packaging (no silently incomplete archive)', () => {
    const floorFile = path.join(ROOT, 'coverage-ratchet.json');
    // Same-volume backup: cross-device rename is not permitted.
    const backup = floorFile + '.missing-test';
    fs.renameSync(floorFile, backup);
    try {
      const out = path.join(outDir, 'negative.zip');
      let exit = 0;
      try {
        require('node:child_process').execFileSync(process.execPath, [PKG_SCRIPT, '--out', out], {
          stdio: 'pipe',
          encoding: 'utf8',
        });
      } catch (err) {
        exit = /** @type {any} */ (err).status ?? 1;
      }
      expect(exit).not.toBe(0);
      expect(fs.existsSync(out)).toBe(false);
    } finally {
      fs.renameSync(backup, floorFile);
    }
  });
});
