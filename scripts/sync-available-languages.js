#!/usr/bin/env node

/**
 * Sync AVAILABLE_LANGUAGES in src/i18n.js with locale files.
 *
 * Reads locales/*.json, generates the AVAILABLE_LANGUAGES array,
 * and patches src/i18n.js between auto-generation markers.
 *
 * Usage:
 *   node scripts/sync-available-languages.js          # report only
 *   node scripts/sync-available-languages.js --ci     # exit non-zero if out of sync
 *   node scripts/sync-available-languages.js --write  # patch i18n.js in place
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');
const I18N_FILE = path.join(ROOT, 'src', 'i18n.js');

const ciMode = process.argv.includes('--ci');
const writeMode = process.argv.includes('--write');

// Discover available languages from locale files
const languages = fs
  .readdirSync(LOCALES_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace('.json', ''))
  .sort();

// Generate the array literal (2-space indent to match i18n.js)
const arrayLines = languages.map(l => `    '${l}'`).join(',\n');
const arrayStr = `const AVAILABLE_LANGUAGES = [\n${arrayLines},\n  ];`;

// Generate the CRITICAL_FALLBACK_EN literal from locales/en.json
const enFilePath = path.join(LOCALES_DIR, 'en.json');
const enData = JSON.parse(fs.readFileSync(enFilePath, 'utf8'));
const fallbackData = { ...enData, offline: 'Offline' };
const fallbackEntries = Object.entries(fallbackData)
  .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  .join(',\n');
const fallbackStr = `/** @type {Readonly<Record<string, string>>} */\n  const CRITICAL_FALLBACK_EN = Object.freeze({\n${fallbackEntries},\n  });`;

// Generate the CRITICAL_FALLBACK_RU literal from locales/ru.json
const ruFilePath = path.join(LOCALES_DIR, 'ru.json');
let ruFallbackStr = '';
/** @type {Record<string, string> | null} */
let ruData = null;
if (fs.existsSync(ruFilePath)) {
  ruData = JSON.parse(fs.readFileSync(ruFilePath, 'utf8'));
  const ruFallbackData = { ...ruData, offline: 'Офлайн' };
  const ruFallbackEntries = Object.entries(ruFallbackData)
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n');
  ruFallbackStr = `/** @type {Readonly<Record<string, string>>} */\n  const CRITICAL_FALLBACK_RU = Object.freeze({\n${ruFallbackEntries},\n  });`;
}

// Read i18n.js
let content = fs.readFileSync(I18N_FILE, 'utf8');

const startMarker = '// AUTO-GENERATED-START: AVAILABLE_LANGUAGES';
const endMarker = '// AUTO-GENERATED-END: AVAILABLE_LANGUAGES';
const fbStartMarker = '// AUTO-GENERATED-START: CRITICAL_FALLBACK_EN';
const fbEndMarker = '// AUTO-GENERATED-END: CRITICAL_FALLBACK_EN';
const fbRuStartMarker = '// AUTO-GENERATED-START: CRITICAL_FALLBACK_RU';
const fbRuEndMarker = '// AUTO-GENERATED-END: CRITICAL_FALLBACK_RU';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find AVAILABLE_LANGUAGES markers in i18n.js');
  process.exit(1);
}

let modified = false;
let issues = 0;

// 1. Check & sync AVAILABLE_LANGUAGES
const currentInner = content.slice(startIdx + startMarker.length, endIdx).trim();
if (currentInner === arrayStr) {
  console.log(`AVAILABLE_LANGUAGES is already in sync (${languages.length} languages).`);
} else {
  issues++;
  console.log(`AVAILABLE_LANGUAGES needs updating (${languages.length} languages from locales/)`);
  if (writeMode) {
    content =
      content.slice(0, startIdx + startMarker.length) +
      `\n  ${arrayStr}\n  ` +
      content.slice(endIdx);
    modified = true;
    console.log(`  Patched AVAILABLE_LANGUAGES in src/i18n.js`);
  }
}

// 2. Check & sync CRITICAL_FALLBACK_EN (if markers present)
const fbStartIdx = content.indexOf(fbStartMarker);
const fbEndIdx = content.indexOf(fbEndMarker);

if (fbStartIdx !== -1 && fbEndIdx !== -1) {
  const fbBlock = content.slice(fbStartIdx + fbStartMarker.length, fbEndIdx);
  const fbKeys = new Set(
    [...fbBlock.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([a-zA-Z0-9_$]+))\s*:/gm)].map(
      m => m[1] || m[2] || m[3]
    )
  );
  const enKeys = Object.keys(enData);
  const missing = enKeys.filter(k => !fbKeys.has(k));

  if (missing.length === 0 && fbKeys.size >= enKeys.length) {
    console.log(`CRITICAL_FALLBACK_EN is already in sync (${enKeys.length} keys).`);
  } else {
    issues++;
    console.log(
      `CRITICAL_FALLBACK_EN needs updating (${missing.length} missing keys from locales/en.json)`
    );
    if (writeMode) {
      content =
        content.slice(0, fbStartIdx + fbStartMarker.length) +
        `\n  ${fallbackStr}\n  ` +
        content.slice(fbEndIdx);
      modified = true;
      console.log(`  Patched CRITICAL_FALLBACK_EN in src/i18n.js`);
    }
  }
}

// 3. Check & sync CRITICAL_FALLBACK_RU (if markers present)
const fbRuStartIdx = content.indexOf(fbRuStartMarker);
const fbRuEndIdx = content.indexOf(fbRuEndMarker);

if (fbRuStartIdx !== -1 && fbRuEndIdx !== -1 && ruData) {
  const fbRuBlock = content.slice(fbRuStartIdx + fbRuStartMarker.length, fbRuEndIdx);
  const fbRuKeys = new Set(
    [...fbRuBlock.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([a-zA-Z0-9_$]+))\s*:/gm)].map(
      m => m[1] || m[2] || m[3]
    )
  );
  const ruKeys = Object.keys(ruData);
  const missingRu = ruKeys.filter(k => !fbRuKeys.has(k));

  if (missingRu.length === 0 && fbRuKeys.size >= ruKeys.length) {
    console.log(`CRITICAL_FALLBACK_RU is already in sync (${ruKeys.length} keys).`);
  } else {
    issues++;
    console.log(
      `CRITICAL_FALLBACK_RU needs updating (${missingRu.length} missing keys from locales/ru.json)`
    );
    if (writeMode) {
      content =
        content.slice(0, fbRuStartIdx + fbRuStartMarker.length) +
        `\n  ${ruFallbackStr}\n  ` +
        content.slice(fbRuEndIdx);
      modified = true;
      console.log(`  Patched CRITICAL_FALLBACK_RU in src/i18n.js`);
    }
  }
}

if (modified) {
  fs.writeFileSync(I18N_FILE, content, 'utf8');
}

if (ciMode && issues > 0) {
  console.error('Run with --write to fix: node scripts/sync-available-languages.js --write');
  process.exit(1);
} else if (!writeMode && issues > 0) {
  console.log('  Use --write to update src/i18n.js');
}
