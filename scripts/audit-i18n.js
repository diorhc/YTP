#!/usr/bin/env node
'use strict';

/**
 * i18n Audit Script
 *
 * Scans src/ for i18n key usage patterns and compares against
 * locales/en.json to find:
 *   - Unused keys (defined in en.json but never referenced in src/)
 *   - Missing keys (referenced in src/ but not defined in en.json)
 *
 * Usage:
 *   node scripts/audit-i18n.js          # full audit with report
 *   node scripts/audit-i18n.js --ci     # exit non-zero on issues
 *   node scripts/audit-i18n.js --unused # only list unused keys
 *   node scripts/audit-i18n.js --missing # only list missing keys
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const LOCALE_FILE = path.join(ROOT, 'locales', 'en.json');

// Patterns that indicate an i18n key is being used
// Matches: t('key'), tr(t, 'key'), i18n.t('key'), translate('key')
const KEY_PATTERNS = [
  /(?:t|tr|translate)\s*\(\s*(?:t,\s*)?['"]([^'"]+)['"]\s*[),]/g,
  /i18n\s*\.\s*t\s*\(\s*['"]([^'"]+)['"]\s*[),]/g,
  /\.t\s*\(\s*['"]([^'"]+)['"]\s*[),]/g,
];

// Dynamic/skip patterns — keys used via variables (not statically detectable)
const SKIP_PATTERNS = [
  /^tab-/,
  /^ytp-/,
  /^tyt-/,
  /data-/,
  /^attr-/,
  /^yt-/,
  /^ytd-/,
  /^ytm-/,
];

function readSourceFiles() {
  const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
  const contents = {};
  for (const file of files) {
    contents[file] = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  }
  return contents;
}

function loadLocaleKeys() {
  const raw = fs.readFileSync(LOCALE_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return new Set(Object.keys(parsed));
}

function findUsedKeys(sourceFiles) {
  const used = new Set();

  for (const [file, content] of Object.entries(sourceFiles)) {
    for (const pattern of KEY_PATTERNS) {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        const key = match[1].trim();
        if (key) {
          used.add(key);
        }
      }
    }
  }

  return used;
}

function shouldSkip(key) {
  return SKIP_PATTERNS.some(p => p.test(key));
}

function main() {
  const args = process.argv.slice(2);
  const ciMode = args.includes('--ci');
  const showUnused = args.includes('--unused');
  const showMissing = args.includes('--missing');
  const allMode = !showUnused && !showMissing;

  console.log('\n🔍 i18n Audit\n');

  const sourceFiles = readSourceFiles();
  const localeKeys = loadLocaleKeys();
  const usedKeys = findUsedKeys(sourceFiles);

  // Unused keys: in locale but not found in src/
  const unused = [...localeKeys].filter(k => !usedKeys.has(k) && !shouldSkip(k));
  unused.sort();

  // Missing keys: used in src/ but not in locale
  const missing = [...usedKeys].filter(k => !localeKeys.has(k));
  missing.sort();

  console.log(`  Locale keys (en.json):    ${localeKeys.size}`);
  console.log(`  Keys used in src/:        ${usedKeys.size}`);
  console.log(`  Unused keys:              ${unused.length}`);
  console.log(`  Missing keys:             ${missing.length}`);

  if ((allMode || showUnused) && unused.length > 0) {
    console.log(`\n📦 Unused keys (in en.json but not found in src/):\n`);
    for (const key of unused) {
      console.log(`  - ${key}`);
    }
  }

  if ((allMode || showMissing) && missing.length > 0) {
    console.log(`\n⚠️  Missing keys (used in src/ but not in en.json):\n`);
    // Filter known false positives (CSS class names, selectors, etc.)
    const likelyMissing = missing.filter(k => !shouldSkip(k));
    for (const key of likelyMissing) {
      console.log(`  - ${key}`);
    }
    if (likelyMissing.length < missing.length) {
      console.log(`\n  (${missing.length - likelyMissing.length} additional skipped as likely non-key strings)`);
    }
  }

  console.log();

  if (ciMode && (unused.length > 0 || missing.length > 0)) {
    const msg =
      `i18n audit failed: ${unused.length} unused keys, ${missing.length} missing keys`;
    console.error(`❌ ${msg}`);
    process.exit(1);
  }

  console.log(unused.length === 0 && missing.length === 0
    ? '✅ All i18n keys are properly used and accounted for.'
    : '📋 Review the findings above.');
}

main();
