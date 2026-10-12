#!/usr/bin/env node

/**
 * Locale Parity Checker
 *
 * Verifies all locale files have identical key sets to en.json,
 * and validates placeholder consistency across locales.
 *
 * Usage:
 *   node scripts/check-locale-parity.js          # report only
 *   node scripts/check-locale-parity.js --ci     # exit non-zero on issues
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');
const EN_FILE = path.join(LOCALES_DIR, 'en.json');

const ciMode = process.argv.includes('--ci');

// Read en.json as source of truth
const enData = JSON.parse(fs.readFileSync(EN_FILE, 'utf8'));
const enKeys = new Set(Object.keys(enData));

// Extract placeholders from a value: {name}, {count}, etc.
function extractPlaceholders(value) {
  if (typeof value !== 'string') return new Set();
  const matches = value.match(/\{[^}]+\}/g);
  return new Set(matches || []);
}

// Byte values whose Windows-1252 glyph is a symbol rather than the Latin-1
// control at the same code point; 0x81/0x8D/0x8F/0x90/0x9D have no glyph.
const windows1252SymbolByteByCode = new Map(
  [
    [0x80, 0x20ac],
    [0x82, 0x201a],
    [0x83, 0x0192],
    [0x84, 0x201e],
    [0x85, 0x2026],
    [0x86, 0x2020],
    [0x87, 0x2021],
    [0x88, 0x02c6],
    [0x89, 0x2030],
    [0x8a, 0x0160],
    [0x8b, 0x2039],
    [0x8c, 0x0152],
    [0x8e, 0x017d],
    [0x91, 0x2018],
    [0x92, 0x2019],
    [0x93, 0x201c],
    [0x94, 0x201d],
    [0x95, 0x2022],
    [0x96, 0x2013],
    [0x97, 0x2014],
    [0x98, 0x02dc],
    [0x99, 0x2122],
    [0x9a, 0x0161],
    [0x9b, 0x203a],
    [0x9c, 0x0153],
    [0x9e, 0x017e],
    [0x9f, 0x0178],
  ].map(([byte, charCode]) => [charCode, byte])
);

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

// Returns the Windows-1252 byte for a single character, or null when the
// character has no such byte. Every code point up to 0xFF maps to its own
// byte: damaged files contain C1 controls (U+0080–U+009F) wherever the lossy
// round trip kept the raw byte instead of the Windows-1252 symbol.
function cp1252Byte(ch) {
  const code = ch.codePointAt(0);
  if (code <= 0xff) return code;
  return windows1252SymbolByteByCode.get(code) ?? null;
}

// Returns the Windows-1252 bytes that would decode back into the given
// text, or null when some character has no Windows-1252 byte — such text
// cannot be the artifact of that round trip.
function encodeWindows1252(text) {
  const bytes = [];
  for (const ch of text) {
    const byte = cp1252Byte(ch);
    if (byte === null) return null;
    bytes.push(byte);
  }
  return Uint8Array.from(bytes);
}

// A string is damaged when some run of non-ASCII characters, re-encoded as
// Windows-1252 bytes and read back as strict UTF-8, yields different, valid
// text. Runs are checked separately because a string can mix damaged and
// intact letters (e.g. "Æ\u008fn son mövcud"); intact runs fail the strict
// decode instead.
function looksDoubleEncoded(text) {
  if (typeof text !== 'string') return false;
  const runs = text.match(/[^\p{ASCII}]+/gu);
  if (!runs) return false;
  for (const run of runs) {
    let bytes = [];
    const chunks = [];
    for (const ch of run) {
      const byte = cp1252Byte(ch);
      if (byte === null) {
        if (bytes.length) chunks.push(bytes);
        bytes = [];
      } else {
        bytes.push(byte);
      }
    }
    if (bytes.length) chunks.push(bytes);
    for (const chunk of chunks) {
      if (chunk.length < 2) continue;
      try {
        strictUtf8Decoder.decode(Uint8Array.from(chunk));
        return true;
      } catch {
        // Not a valid UTF-8 sequence: the characters are genuine.
      }
    }
  }
  return false;
}

function collectDoubleEncoded(data) {
  const hits = [];
  for (const [key, value] of Object.entries(data)) {
    if (looksDoubleEncoded(key)) {
      hits.push({ key, sample: key });
    } else if (typeof value === 'string' && looksDoubleEncoded(value)) {
      hits.push({ key, sample: value });
    }
  }
  return hits;
}

// Build placeholder map for en.json
const enPlaceholders = {};
for (const [key, value] of Object.entries(enData)) {
  const ph = extractPlaceholders(value);
  if (ph.size > 0) enPlaceholders[key] = ph;
}

const enCorrupted = collectDoubleEncoded(enData);

// Check all locale files
const localeFiles = fs
  .readdirSync(LOCALES_DIR)
  .filter(f => f.endsWith('.json') && f !== 'en.json')
  .sort();

let totalIssues = 0;
const results = [];

for (const file of localeFiles) {
  const lang = file.replace('.json', '');
  const filePath = path.join(LOCALES_DIR, file);

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    results.push({ lang, error: `Failed to parse: ${msg}` });
    totalIssues++;
    continue;
  }

  const keys = new Set(Object.keys(data));
  const missing = [...enKeys].filter(k => !keys.has(k));
  const extra = [...keys].filter(k => !enKeys.has(k));

  // Check placeholder consistency
  const placeholderIssues = [];
  for (const [key, enPh] of Object.entries(enPlaceholders)) {
    if (!keys.has(key)) continue;
    const localePh = extractPlaceholders(data[key]);
    for (const ph of enPh) {
      if (!localePh.has(ph)) {
        placeholderIssues.push({ key, missing: ph });
      }
    }
  }

  const corrupted = collectDoubleEncoded(data);

  if (
    missing.length > 0 ||
    extra.length > 0 ||
    placeholderIssues.length > 0 ||
    corrupted.length > 0
  ) {
    results.push({ lang, missing, extra, placeholderIssues, corrupted });
    totalIssues += missing.length + extra.length + placeholderIssues.length + corrupted.length;
  }
}

// Compute candidate locales digest
const allLocaleFiles = fs
  .readdirSync(LOCALES_DIR)
  .filter(f => f.endsWith('.json'))
  .sort();
const candidateHasher = crypto.createHash('sha256');
for (const f of allLocaleFiles) {
  const fileHash = crypto
    .createHash('sha256')
    // LF text, the same normalization as sync-locale-metadata.js.
    .update(fs.readFileSync(path.join(LOCALES_DIR, f), 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex');
  candidateHasher.update(`${f}:${fileHash}\n`);
}
const candidateDigest = candidateHasher.digest('hex');

// Verify the generated runtime delivery metadata describes THIS
// locale set — one release across src/i18n.js, inventory and manifest.
const pkgData = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const i18nSource = fs.readFileSync(path.join(ROOT, 'src', 'i18n.js'), 'utf8');
const manifestStart = i18nSource.indexOf('// AUTO-GENERATED-START: LOCALE_DELIVERY_MANIFEST');
const manifestEnd = i18nSource.indexOf('// AUTO-GENERATED-END: LOCALE_DELIVERY_MANIFEST');
let manifestBlock = '';
if (manifestStart !== -1 && manifestEnd !== -1) {
  manifestBlock = i18nSource.slice(manifestStart, manifestEnd);
}
function extractGeneratedField(name) {
  const m = manifestBlock.match(new RegExp('^\\s*' + name + ': (["0-9a-zA-Z.$\\{\\}_-]+),$', 'm'));
  return m ? m[1] : null;
}
const metadataIssues = [];
const manifestVersion = extractGeneratedField('version');
const manifestKeysCount = Number(extractGeneratedField('keysCount'));
const manifestDigest = extractGeneratedField('candidateDigest');
if (manifestVersion !== JSON.stringify(pkgData.version)) {
  metadataIssues.push(
    `manifest version ${manifestVersion} != package.json ${JSON.stringify(pkgData.version)}`
  );
}
if (manifestKeysCount !== enKeys.size) {
  metadataIssues.push(`manifest keysCount ${manifestKeysCount} != en.json ${enKeys.size}`);
}
if (manifestDigest !== JSON.stringify(candidateDigest)) {
  metadataIssues.push(
    `manifest candidateDigest != recomputed locales digest (run scripts/sync-locale-metadata.js)`
  );
}
// Per-locale canonical digests: SHA-256 of JSON.stringify(data, sorted keys)
// — the exact form the runtime hashes for delivery verification.
for (const f of allLocaleFiles) {
  const lang = f.replace('.json', '');
  const data = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, f), 'utf8'));
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  const digest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  const expected = manifestBlock.match(new RegExp(`^\\s*"${lang}": "([0-9a-f]{64})",$`, 'm'));
  if (!expected) {
    metadataIssues.push(`LOCALE_DELIVERY_MANIFEST.localeDigests missing ${lang}`);
  } else if (expected[1] !== digest) {
    metadataIssues.push(`localeDigests[${lang}] stale (run scripts/sync-locale-metadata.js)`);
  }
}
if (metadataIssues.length > 0) {
  totalIssues += metadataIssues.length;
  for (const issue of metadataIssues) console.error(`  ${issue}`);
}

// Report
console.log('\nLocale Parity Check\n');
console.log(`  Source: en.json (${enKeys.size} keys)`);
console.log(`  Locales checked: ${localeFiles.length}`);
console.log(
  `  Candidate assets: ${allLocaleFiles.length} files (digest: ${candidateDigest.slice(0, 16)}…)`
);
console.log(`  Issues: ${totalIssues}\n`);

if (results.length === 0 && totalIssues === 0) {
  console.log('All locales have identical key sets to en.json.\n');
} else {
  for (const r of results) {
    if (r.error) {
      console.error(`  ${r.lang}: ${r.error}`);
      continue;
    }
    if (r.missing.length > 0) {
      console.error(
        `  ${r.lang}: missing ${r.missing.length} keys: ${r.missing.slice(0, 5).join(', ')}${r.missing.length > 5 ? ` (+${r.missing.length - 5} more)` : ''}`
      );
    }
    if (r.extra.length > 0) {
      console.error(
        `  ${r.lang}: ${r.extra.length} extra keys: ${r.extra.slice(0, 5).join(', ')}${r.extra.length > 5 ? ` (+${r.extra.length - 5} more)` : ''}`
      );
    }
    if (r.placeholderIssues && r.placeholderIssues.length > 0) {
      for (const pi of r.placeholderIssues.slice(0, 3)) {
        console.error(`  ${r.lang}: key "${pi.key}" missing placeholder ${pi.missing}`);
      }
      if (r.placeholderIssues.length > 3) {
        console.error(`  ${r.lang}: (+${r.placeholderIssues.length - 3} more placeholder issues)`);
      }
    }
    if (r.corrupted && r.corrupted.length > 0) {
      for (const hit of r.corrupted.slice(0, 5)) {
        console.error(
          `  ${r.lang}: key "${hit.key}" is double-encoded: "${hit.sample.replace(/\n/g, '\\n').slice(0, 80)}"`
        );
      }
      if (r.corrupted.length > 5) {
        console.error(`  ${r.lang}: (+${r.corrupted.length - 5} more double-encoded strings)`);
      }
    }
  }
  console.log();
}

if (enCorrupted.length > 0) {
  for (const hit of enCorrupted.slice(0, 5)) {
    console.error(
      `  en.json: key "${hit.key}" is double-encoded: "${hit.sample.replace(/\n/g, '\\n').slice(0, 80)}"`
    );
  }
  if (enCorrupted.length > 5) {
    console.error(`  en.json: (+${enCorrupted.length - 5} more double-encoded strings)`);
  }
  console.log();
}

if (ciMode && totalIssues > 0) {
  console.error(`Failed: ${totalIssues} locale parity issue(s) found.`);
  process.exit(1);
}

module.exports = { looksDoubleEncoded, encodeWindows1252, cp1252Byte };
