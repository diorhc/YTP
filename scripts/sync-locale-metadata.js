#!/usr/bin/env node
// @ts-check

/**
 * Locale release-metadata sync.
 *
 * Regenerates the AUTO-GENERATED block in src/i18n.js from the actual locales/
 * files and package.json. The manifest backs two build-time contracts: the
 * embedded English dictionary's digest check in build.js, and the release
 * version that names the runtime cache. Remote dictionaries are shape-checked
 * at runtime, not digested, so the per-locale digests are a release fingerprint
 * rather than a delivery proof:
 *
 *   - LOCALE_DELIVERY_MANIFEST — version, keysCount, aggregate candidateDigest
 *     (raw file bytes, same algorithm as check-inventory.js) and per-locale
 *     SHA-256 of the canonical payload form.
 *
 * Usage:
 *   node scripts/sync-locale-metadata.js            # regenerate blocks
 *   node scripts/sync-locale-metadata.js --check    # exit 1 if blocks are stale
 *
 * Run after ANY change under locales/ or a version bump. Never run during
 * build:release — like embed-translations.js this is a developer utility.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');
const I18N_FILE = path.join(ROOT, 'src', 'i18n.js');
const PKG_FILE = path.join(ROOT, 'package.json');

const checkOnly = process.argv.includes('--check');

/**
 * Locale payloads must be flat string records; dangerous keys are stripped so
 * the digest is computed over the same shape the runtime accepts.
 * @param {unknown} data
 * @returns {Record<string, string>}
 */
function sanitizeTranslations(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid translation data: expected an object');
  }
  /** @type {Record<string, string>} */
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid translation entry: key and value must be strings');
    }
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * SHA-256 over the canonical payload form. Stays identical to
 * computeLocaleDigest_() in src/i18n.js, which verifies only the embedded
 * English dictionary against its manifest digest at build time.
 * @param {Record<string, string>} data
 * @returns {string}
 */
function canonicalDigest(data) {
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const pkg = JSON.parse(fs.readFileSync(PKG_FILE, 'utf8'));

const localeFiles = fs
  .readdirSync(LOCALES_DIR)
  .filter(f => f.endsWith('.json'))
  .sort();

const localeNames = localeFiles.map(f => f.replace('.json', ''));

/** @type {Record<string, Record<string, string>>} */
const translations = {};
/** @type {Record<string, string>} */
const localeDigests = {};
const rawHasher = crypto.createHash('sha256');
for (const file of localeFiles) {
  const lang = file.replace('.json', '');
  const raw = fs.readFileSync(path.join(LOCALES_DIR, file));
  translations[lang] = sanitizeTranslations(JSON.parse(raw.toString('utf8')));
  if (Object.keys(translations[lang]).length === 0) {
    console.error(`✗ ${lang}.json has no usable keys`);
    process.exit(1);
  }
  localeDigests[lang] = canonicalDigest(translations[lang]);
  // Hash LF text: a CRLF checkout on Windows must give the same digest as git's LF copy.
  const fileHash = crypto
    .createHash('sha256')
    .update(raw.toString('utf8').replace(/\r\n/g, '\n'))
    .digest('hex');
  rawHasher.update(`${file}:${fileHash}\n`);
}
const candidateDigest = rawHasher.digest('hex');
const keysCount = Object.keys(translations.en || {}).length;
if (!keysCount) {
  console.error('✗ locales/en.json missing');
  process.exit(1);
}
for (const lang of localeNames) {
  if (Object.keys(translations[lang]).length !== keysCount) {
    console.error(
      `✗ ${lang}.json has ${Object.keys(translations[lang]).length} keys, en.json has ${keysCount} — run scripts/check-locale-parity.js`
    );
    process.exit(1);
  }
}

/**
 * Regenerate one AUTO-GENERATED block between its markers. Replaces whole
 * lines so indentation comes solely from the freshly built block.
 * @param {string} content
 * @param {string} name
 * @param {string} newBlock — full block, starts with the START marker line,
 *   ends with a newline after the END marker line
 * @returns {string}
 */
function replaceBlock(content, name, newBlock) {
  const startMarker = `// AUTO-GENERATED-START: ${name}`;
  const endMarker = `// AUTO-GENERATED-END: ${name}`;
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1) {
    console.error(`✗ markers for ${name} not found in src/i18n.js`);
    process.exit(1);
  }
  const lineStart = content.lastIndexOf('\n', start) + 1;
  const lineEnd = content.indexOf('\n', end);
  const endIdx = lineEnd === -1 ? content.length : lineEnd + 1;
  return content.slice(0, lineStart) + newBlock + content.slice(endIdx);
}

const manifestEntries = localeNames
  .map(lang => `      ${JSON.stringify(lang)}: ${JSON.stringify(localeDigests[lang])},`)
  .join('\n');

const manifestBlock = [
  `  // AUTO-GENERATED-START: LOCALE_DELIVERY_MANIFEST`,
  `  // Release metadata for the locale delivery contract.`,
  `  // Regenerate with: node scripts/sync-locale-metadata.js`,
  `  // localeDigests: SHA-256 over the sorted JSON payload`,
  `  // of each shipped locales file; a release fingerprint, not a runtime check.`,
  `  // candidateDigest: aggregate over raw file bytes, matching the locale parity`,
  `  // checker. Only the embedded en digest is verified at build time.`,
  `  // biome-ignore format: generated data block`,
  `  /** @type {{ version: string; keysCount: number; candidateDigest: string; localeDigests: Readonly<Record<string, string>> }} */`,
  `  const LOCALE_DELIVERY_MANIFEST = Object.freeze({`,
  `    version: ${JSON.stringify(pkg.version)},`,
  `    keysCount: ${keysCount},`,
  `    candidateDigest: ${JSON.stringify(candidateDigest)},`,
  `    localeDigests: Object.freeze({`,
  manifestEntries,
  `    }),`,
  `  });`,
  `  // AUTO-GENERATED-END: LOCALE_DELIVERY_MANIFEST`,
  '',
].join('\n');

const content = fs.readFileSync(I18N_FILE, 'utf8');
let replacedManifest;
if (!content.includes('LOCALE_DELIVERY_MANIFEST = Object.freeze')) {
  // First generation: insert the manifest block before CANDIDATE_METADATA.
  const anchor = '  const CANDIDATE_METADATA = Object.freeze({';
  const idx = content.indexOf(anchor);
  if (idx === -1) {
    console.error('✗ CANDIDATE_METADATA anchor not found in src/i18n.js');
    process.exit(1);
  }
  replacedManifest = content.slice(0, idx) + manifestBlock + '\n' + content.slice(idx);
} else {
  replacedManifest = replaceBlock(content, 'LOCALE_DELIVERY_MANIFEST', manifestBlock);
}

// CRITICAL_FALLBACK_EN/RU blocks are removed from
// src/i18n.js entirely — there is no offline dictionary fallback to sync.
const updated = replacedManifest;

if (updated.includes('\r\n')) {
  console.error('✗ src/i18n.js would contain CRLF — refusing to write');
  process.exit(1);
}

if (checkOnly) {
  if (updated !== content) {
    console.error(
      '✗ Locale metadata blocks in src/i18n.js are STALE — run: node scripts/sync-locale-metadata.js'
    );
    process.exit(1);
  }
  console.log('✓ Locale metadata blocks are up to date');
  process.exit(0);
}

fs.writeFileSync(I18N_FILE, updated, 'utf8');
console.log(`✓ Regenerated locale metadata blocks in src/i18n.js:`);
console.log(`    version: ${pkg.version}`);
console.log(`    keysCount: ${keysCount} (${localeNames.length} locales)`);
console.log(`    candidateDigest: ${candidateDigest.slice(0, 16)}…`);
