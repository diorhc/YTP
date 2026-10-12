#!/usr/bin/env node

/**
 * i18n Audit Script (AST-based)
 *
 * Uses acorn to parse src/*.js and extract i18n key usage via AST walking.
 * Compares against locales/en.json to find:
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

// Dynamic/skip patterns — keys used via variables (not statically detectable)
const SKIP_PATTERNS = [/^tab-/, /^ytp-/, /^tyt-/, /data-/, /^attr-/, /^yt-/, /^ytd-/, /^ytm-/];
const TRANSLATOR_IDENTIFIERS = new Set([
  't',
  'translate',
  'translatedOr',
  'tr',
  'tf',
  'tFn',
  'i18nT',
]);
const DYNAMIC_I18N_KEYS = new Set([
  // settings-helpers.js: shortcut modifier callback
  'alt',
  'ctrl',
  'shift',
  // stats.js: card definition -> makeStatsCard/buildPageStatCard
  'dislikes',
  'likes',
  'liveViewers',
  // playlist-search.js: route-dependent placeholder key
  'searchPlaceholder',
  'searchPlaceholderPlaylistPage',
  // download.js: reportDownloadError failedKey
  'subtitleDownloadFailed',
  // voting.js: status chip renders the DB status via FEATURE_STATUS_I18N_KEYS
  // lookup (proposed/in_progress/completed are data values, not literals)
  'statusProposed',
  'statusInProgress',
  'statusCompleted',
]);

// ---------------------------------------------------------------------------
// Minimal AST walker (no external dependency)
// ---------------------------------------------------------------------------

/**
 * @param {any} node
 * @param {(node: any) => void} visitor
 */
function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visitor(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && item.type) walk(item, visitor);
      }
    } else if (child && typeof child === 'object' && child.type) {
      walk(child, visitor);
    }
  }
}

// ---------------------------------------------------------------------------
// Key extraction from AST
// ---------------------------------------------------------------------------

/**
 * @param {any} node
 * @returns {string | null}
 */
function getStringValue(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.quasis.length === 1) return node.quasis[0].value.raw;
  return null;
}

/**
 * Extract i18n keys from an AST.
 * Patterns matched:
 *   - t('key') / translate('key') / translatedOr('key') / tf('key') / tFn('key') / i18nT('key')
 *   - tr(t, 'key') / tr(i18n, 'key')
 *   - obj.t('key') / i18n.t('key') / YouTubeUtils.t('key')
 * @param {any} ast
 * @returns {Set<string>}
 */
function extractKeysFromAST(ast) {
  const keys = new Set();

  walk(ast, node => {
    // Feature descriptors name their title key; the player hosts render it
    // with U.t(desc.titleKey).
    if (
      node.type === 'Property' &&
      !node.computed &&
      node.key.type === 'Identifier' &&
      node.key.name === 'titleKey'
    ) {
      const key = getStringValue(node.value);
      if (key) keys.add(key);
      return;
    }
    if (node.type !== 'CallExpression') return;
    const { callee, arguments: args } = node;

    if (callee.type === 'Identifier' && TRANSLATOR_IDENTIFIERS.has(callee.name)) {
      const keyIndex = callee.name === 'tr' ? 1 : 0;
      const key = args.length > keyIndex ? getStringValue(args[keyIndex]) : null;
      if (key) keys.add(key);
      return;
    }

    // obj.t('key') — member expression calls like i18n.t('key'), YouTubeUtils.t('key')
    if (
      callee.type === 'MemberExpression' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 't' &&
      !callee.computed
    ) {
      const key = args.length >= 1 ? getStringValue(args[0]) : null;
      if (key) keys.add(key);
      return;
    }
  });

  return keys;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
  const used = new Set(DYNAMIC_I18N_KEYS);

  for (const content of Object.values(sourceFiles)) {
    let ast;
    try {
      // Lazy-require acorn to keep startup fast when acorn is not needed
      const acorn = require('acorn');
      ast = acorn.parse(content, {
        ecmaVersion: 2022,
        sourceType: 'module',
        allowReturnOutsideFunction: true,
        locations: false,
      });
    } catch {
      // Fallback: skip files that fail to parse (e.g. non-standard syntax)
      continue;
    }

    const keys = extractKeysFromAST(ast);
    for (const key of keys) {
      used.add(key);
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
  const allMode = !(showUnused || showMissing);

  console.log('\ni18n Audit (AST)\n');

  const sourceFiles = readSourceFiles();
  const localeKeys = loadLocaleKeys();
  const usedKeys = findUsedKeys(sourceFiles);

  // Unused keys: in locale but not found in src/
  const unused = [...localeKeys].filter(k => !(usedKeys.has(k) || shouldSkip(k)));
  unused.sort();

  // Missing keys: used in src/ but not in locale
  const missing = [...usedKeys].filter(k => !localeKeys.has(k));
  missing.sort();

  console.log(`  Locale keys (en.json):    ${localeKeys.size}`);
  console.log(`  Keys used in src/:        ${usedKeys.size}`);
  console.log(`  Unused keys:              ${unused.length}`);
  console.log(`  Missing keys:             ${missing.length}`);

  if ((allMode || showUnused) && unused.length > 0) {
    console.log(`\nUnused keys (in en.json but not found in src/):\n`);
    for (const key of unused) {
      console.log(`  - ${key}`);
    }
  }

  if ((allMode || showMissing) && missing.length > 0) {
    console.log(`\nMissing keys (used in src/ but not in en.json):\n`);
    const likelyMissing = missing.filter(k => !shouldSkip(k));
    for (const key of likelyMissing) {
      console.log(`  - ${key}`);
    }
    if (likelyMissing.length < missing.length) {
      console.log(
        `\n  (${missing.length - likelyMissing.length} additional skipped as likely non-key strings)`
      );
    }
  }

  console.log();

  if (ciMode && (unused.length > 0 || missing.length > 0)) {
    const msg = `i18n audit failed: ${unused.length} unused keys, ${missing.length} missing keys`;
    console.error(`Failed: ${msg}`);
    process.exit(1);
  }

  console.log(
    unused.length === 0 && missing.length === 0
      ? 'All i18n keys are properly used and accounted for.'
      : 'Review the findings above.'
  );
}

main();
