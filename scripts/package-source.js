#!/usr/bin/env node
// @ts-check

/**
 * package-source.js
 *
 * Builds a portable, byte-reproducible source package of YouTube+:
 *
 *   - ZIP container written by a PURE-NODE writer (no shell, no tar — the
 *     `--out` path is never passed through a shell, and the `.zip` extension
 *     always produces a real ZIP readable by standard extractors on every
 *     supported OS);
 *   - strict allowlist with a MANDATORY-PATH check: a missing required path
 *     (build/config, CI definitions, coverage floors, tests,
 *     locales and instructions) fails packaging instead of
 *     silently producing an incomplete archive;
 *   - installed dependencies, VCS state, build outputs and historical
 *     results (*.result.json, *.log, *.zip, test-results/, coverage/) are
 *     never included by default;
 *   - determinism: entries are sorted, timestamps are fixed, payloads are
 *     stored uncompressed — two runs on the same input produce byte-identical
 *     archives;
 *   - the archive is self-describing: it contains source-package-manifest.json
 *     with the SHA-256 of every packaged file (the release-side
 *     release-manifest.json describe BUNDLES and are deliberately
 *     not part of the source package).
 *
 * Usage:
 *   node scripts/package-source.js
 *   node scripts/package-source.js --out dist/youtube-plus-source.zip
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const outArgIdx = process.argv.indexOf('--out');
const targetZip = path.resolve(
  ROOT,
  outArgIdx !== -1 && process.argv[outArgIdx + 1]
    ? process.argv[outArgIdx + 1]
    : path.join('test-results', `youtube-plus-${pkg.version}-source.zip`)
);

// ---------------------------------------------------------------------------
// Mandatory allowlist: every entry MUST exist, otherwise packaging fails.
// (A missing required build/config, CI definition,
// locale or instruction must never yield a silently incomplete archive.)
// ---------------------------------------------------------------------------
const REQUIRED = [
  // source and build configuration
  // build/config
  'build.js',
  'build.order.json',
  'userscript.js',
  'biome.json',
  'jest.config.js',
  'playwright.config.js',
  'tsconfig.json',
  'knip.json',
  'package.json',
  'package-lock.json',
  // tests
  'test/setup.js',
  // CI definitions
  '.github/workflows/ci.yml',
  // floors
  'code-ratchet.json',
  'coverage-ratchet.json',
  // locales
  'locales/en.json',
  'locales/ru.json',
  // instructions
  'README.md',
  'SECURITY.md',
  'LICENSE',

  '.nvmrc',
  // runtime and developer utilities
  'src',
  'scripts',
  'types',
];

const INCLUDE_DIRS = ['src', 'locales', 'scripts', 'test', 'types', 'docs', '.github'];

const INCLUDE_FILES = [
  'package.json',
  'package-lock.json',
  'build.js',
  'build.order.json',
  'userscript.js',
  'biome.json',
  'jest.config.js',
  'playwright.config.js',
  'tsconfig.json',
  'tsconfig.scripts.json',
  'knip.json',
  'code-ratchet.json',
  'coverage-ratchet.json',
  'README.md',
  'SECURITY.md',
  'LICENSE',
  '.nvmrc',
  '.gitignore',
];

// ---------------------------------------------------------------------------
// Mandatory-path gate: a missing required path fails packaging.
// ---------------------------------------------------------------------------
const missing = REQUIRED.filter(rel => !fs.existsSync(path.join(ROOT, rel)));
if (missing.length > 0) {
  console.error('✗ Source packaging aborted — mandatory paths missing:');
  for (const rel of missing) console.error(`  - ${rel}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Exclusions inside copied trees (no installed deps, no historical
// results, no build outputs / archives by default).
// ---------------------------------------------------------------------------
const EXCLUDED_BASENAMES = new Set(['node_modules', '.git', 'test-results', 'coverage']);
const EXCLUDED_SUFFIXES = ['.zip', '.log', '.tmp'];

function isExcluded(/** @type {string} */ base) {
  if (EXCLUDED_BASENAMES.has(base)) return true;
  if (base.endsWith('.result.json')) return true; // historical run outputs
  return EXCLUDED_SUFFIXES.some(s => base.endsWith(s));
}

/** @type {{ relPath: string, absPath: string }[]} */
const files = [];
function collectDir(/** @type {string} */ relDir) {
  const absDir = path.join(ROOT, relDir);
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (isExcluded(entry.name)) continue;
    if (entry.isDirectory()) {
      collectDir(rel);
    } else if (entry.isFile()) {
      files.push({ relPath: rel.replace(/\\/g, '/'), absPath: path.join(absDir, entry.name) });
    }
  }
}
for (const dir of INCLUDE_DIRS) collectDir(dir);
for (const rel of INCLUDE_FILES) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) {
    files.push({ relPath: rel, absPath: abs });
  }
}

// Deterministic order + safe names (ZIP writer requirement).
files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
for (const f of files) {
  if (!/^[A-Za-z0-9.][A-Za-z0-9._+\-/]*$/.test(f.relPath) || f.relPath.includes('..')) {
    console.error(`✗ Source packaging aborted — unsafe entry name: ${f.relPath}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Deterministic ZIP writer (STORE method, fixed DOS timestamps, sorted
// entries). Two runs on the same input produce byte-identical archives.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(/** @type {Buffer} */ buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

// DOS time/date for 1980-01-01 00:00:00 (the earliest representable date).
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

// ---------------------------------------------------------------------------
// Assemble: collect payload entries, then inject the self-describing manifest
// (sorted position computed after the manifest exists).
// ---------------------------------------------------------------------------
const manifestFiles = files.map(f => ({
  path: f.relPath,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(f.absPath)).digest('hex'),
}));
const manifest = {
  format: 'youtube-plus-source-package',
  version: pkg.version,
  entries: manifestFiles.length,
  files: manifestFiles,
};
const manifestJson = JSON.stringify(manifest, null, 2) + '\n';

/** @type {{ relPath: string, absPath: string | null, data: Buffer | null }[]} */
const payloadEntries = [
  {
    relPath: 'source-package-manifest.json',
    absPath: null,
    data: Buffer.from(manifestJson, 'utf8'),
  },
  ...files.map(f => ({ ...f, data: /** @type {Buffer | null} */ (null) })),
].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

// Rebuild the writer input with lazily read payloads (the manifest is
// synthesized, everything else comes from disk).
const zipEntries = payloadEntries.map(e => ({
  relPath: e.relPath,
  read: () =>
    e.data ? e.data : typeof e.absPath === 'string' ? fs.readFileSync(e.absPath) : Buffer.alloc(0),
}));

function writeZip(/** @type {string} */ target) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const e of zipEntries) {
    const nameBuf = Buffer.from(e.relPath, 'utf8');
    const data = e.read();
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method: stored
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); // compressed size
    central.writeUInt32LE(data.length, 24); // uncompressed size
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes (normalized)
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(zipEntries.length, 8);
  eocd.writeUInt16LE(zipEntries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.concat([...localParts, centralBuf, eocd]));
}

if (fs.existsSync(targetZip)) fs.rmSync(targetZip, { force: true });
writeZip(targetZip);

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(targetZip)).digest('hex');
const stat = fs.statSync(targetZip);
console.log(`✓ Source package created: ${targetZip}`);
console.log(`  Entries: ${zipEntries.length} (deterministic ZIP, stored payloads)`);
console.log(`  Size: ${stat.size} bytes (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`  SHA-256: ${sha256}`);
