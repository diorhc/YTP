/**
 * YouTube Plus Modular Build System
 *
 * This build script concatenates multiple JavaScript modules from the src/ directory
 * into a single userscript file (youtube.user.js) with the following features:
 * - Module ordering via build.order.json
 * - Userscript metadata preservation
 * - Optional minification with Terser
 * - Watch mode for development
 * - ESLint validation
 * - Syntax checking
 *
 * Usage:
 *   node build.js              - Standard build
 *   node build.js --watch      - Watch mode with auto-rebuild
 *   node build.js --optimized  - Build with code optimization
 *   node build.js --minify     - Build with full minification
 */

/* Allow console usage in build scripts (these are developer tools, not runtime code) */
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const vm = require('vm');
const { performance } = require('perf_hooks');

// Determine project root: if this script sits in a `src` folder, use parent,
// otherwise use its directory. This prevents scanning the wrong directory
// when the script is placed in the repo root.
const ROOT =
  path.basename(__dirname) === 'src' ? path.resolve(__dirname, '..') : path.resolve(__dirname);
const OUT = path.join(ROOT, 'youtube.user.js');
// exclude basenames only (we'll search in either ROOT or ROOT/src)
const EXCLUDE = new Set(['youtube.user.js', 'userscript.js', 'build.js']);

// Watch debounce ms
const DEBOUNCE_MS = 200;

// Possible order manifest files (JSON array of filenames or plain text lines)
const ORDER_MANIFESTS = ['build.order.json', 'build.order.txt'];

// Performance tracking with better memory management
const perfTimings = new Map();
const startPerfTimer = name => {
  perfTimings.set(name, performance.now());
};
const endPerfTimer = name => {
  const start = perfTimings.get(name);
  if (start) {
    const duration = performance.now() - start;
    perfTimings.delete(name);
    return duration;
  }
  return 0;
};

// Clear old timers periodically to prevent memory leaks
const _cleanPerfTimers = () => {
  if (perfTimings.size > 50) {
    perfTimings.clear();
  }
};

// Cache for metadata extraction and file processing (with size limits)
const MAX_CACHE_SIZE = 100;
const metadataCache = new Map();
const stripMetaCache = new Map();

// Improved cache management with LRU-like behavior
function _manageCacheSize(cache, maxSize = MAX_CACHE_SIZE) {
  if (cache.size > maxSize) {
    const keysToDelete = Array.from(cache.keys()).slice(0, cache.size - maxSize);
    keysToDelete.forEach(key => cache.delete(key));
  }
}

// Build cache for incremental builds
const BUILD_CACHE_FILE = path.join(ROOT, '.build-cache.json');
let buildCache = { files: {}, lastBuild: 0 };

/**
 * Load build cache from disk
 */
function loadBuildCache() {
  try {
    if (fs.existsSync(BUILD_CACHE_FILE)) {
      const data = fs.readFileSync(BUILD_CACHE_FILE, 'utf8');
      buildCache = JSON.parse(data);
      if (verbose) {
        console.log(`Loaded build cache with ${Object.keys(buildCache.files).length} entries`);
      }
    }
  } catch (e) {
    if (verbose) {
      console.warn('Failed to load build cache:', e.message);
    }
    buildCache = { files: {}, lastBuild: 0 };
  }
}

/**
 * Save build cache to disk
 */
function saveBuildCache() {
  try {
    fs.writeFileSync(BUILD_CACHE_FILE, JSON.stringify(buildCache, null, 2), 'utf8');
  } catch (e) {
    if (verbose) console.warn('Failed to save build cache:', e.message);
  }
}

/**
 * Check if file has changed since last build
 * @param {string} filePath - Path to file
 * @returns {boolean} True if file changed or is new
 */
function hasFileChanged(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const mtime = stats.mtimeMs;
    const cached = buildCache.files[filePath];

    if (!cached || cached.mtime !== mtime) {
      buildCache.files[filePath] = { mtime, size: stats.size };
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

// Pre-compiled regex patterns for better performance
const REGEX_PATTERNS = {
  lineStyleMeta: /\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/,
  blockStyleMeta: /\/\*[\s\S]*?==UserScript==[\s\S]*?==\/UserScript==[\s\S]*?\*\//,
  stripLineMeta: /\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/g,
  stripBlockMeta: /\/\*\s*==UserScript==[\s\S]*?==\/UserScript==\s*\*\//g,
  regexPattern: /\/(?:[^\\/\n]|\\.)+\/[gimsuvy]*/g,
  whitespace: /[ \t]+/g,
  multipleNewlines: /\n{3,}/g,
  leadingWhitespace: /^(\s+)/,
  trailingWhitespace: /\s+$/,
  surroundingWhitespace: /^\s+|\s+$/g,
  regexContext: /[=([{:;!&|?+\-*%^~,]$|return$|match$|test$|replace$|split$|exec$/,
  regexFlags: /[gimsuyv]/,
};

/**
 * Safely read a file, returning null on error
 * @param {string} p - File path
 * @returns {string|null} File content or null
 */
function readFileSafe(p) {
  try {
    if (!p || typeof p !== 'string') {
      console.error('[Build Error] Invalid file path provided');
      return null;
    }
    if (!fs.existsSync(p)) {
      console.warn(`[Build Warning] File not found: ${p}`);
      return null;
    }
    const stats = fs.statSync(p);
    if (!stats.isFile()) {
      console.warn(`[Build Warning] Path is not a file: ${p}`);
      return null;
    }
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    console.error(`[Build Error] Failed to read file ${p}:`, err.message);
    if (err.code === 'EACCES') {
      console.error('[Build Error] Permission denied. Check file permissions.');
    } else if (err.code === 'EMFILE') {
      console.error('[Build Error] Too many open files. Try closing other applications.');
    }
    return null;
  }
}

/**
 * Extract userscript metadata block from content
 * @param {string} content - File content
 * @returns {string|null} Metadata block or null
 */
function extractMeta(content) {
  if (!content) return null;

  // Check cache first
  const cacheKey = content.substring(0, 500); // Use first 500 chars as cache key
  if (metadataCache.has(cacheKey)) {
    return metadataCache.get(cacheKey);
  }

  // Match either a // style userscript meta block or a /* */ block
  const m1 = content.match(REGEX_PATTERNS.lineStyleMeta);
  if (m1) {
    metadataCache.set(cacheKey, m1[0]);
    _manageCacheSize(metadataCache);
    return m1[0];
  }
  const m2 = content.match(REGEX_PATTERNS.blockStyleMeta);
  if (m2) {
    metadataCache.set(cacheKey, m2[0]);
    _manageCacheSize(metadataCache);
    return m2[0];
  }

  metadataCache.set(cacheKey, null);
  _manageCacheSize(metadataCache);
  return null;
}

/**
 * Remove userscript metadata blocks from content
 * @param {string} content - File content
 * @returns {string} Content without metadata
 */
function stripMeta(content) {
  if (!content) return '';

  // Use content hash instead of full content for better cache efficiency
  const cacheKey = content.length + '_' + content.substring(0, 100);

  // Check cache first
  if (stripMetaCache.has(cacheKey)) {
    return stripMetaCache.get(cacheKey);
  }

  // remove any userscript meta blocks so they don't duplicate in modules
  const result = content
    .replace(REGEX_PATTERNS.stripLineMeta, '')
    .replace(REGEX_PATTERNS.stripBlockMeta, '');

  stripMetaCache.set(cacheKey, result);
  _manageCacheSize(stripMetaCache);
  return result;
}

/**
 * Advanced optimizer that removes all comments (block, line, JSDoc) and normalizes whitespace
 * while preserving string literals and keeping code readable.
 *
 * Optimization steps:
 * 1. Preserve userscript header metadata
 * 2. Remove all block comments and JSDoc
 * 3. Remove all standalone line comments
 * 4. Normalize whitespace (remove extra spaces/blank lines)
 * 5. Reconstruct code with optimized body
 *
 * @param {string} code - Full code including header
 * @param {string} headerBlock - The userscript header block to preserve
 * @returns {string} Optimized code with reduced size but readable structure
 */
/**
 * Check if character is likely start of a regex based on context
 * @param {string} resultSoFar
 * @returns {boolean}
 */
function _isRegexContext(resultSoFar) {
  const beforeTrimmed = resultSoFar.trimEnd();
  const lastChars = beforeTrimmed.slice(-10);
  return REGEX_PATTERNS.regexContext.test(lastChars);
}

/**
 * Process regex flags after closing /
 * @param {string} line
 * @param {number} startIdx
 * @returns {{endIdx: number, flags: string}}
 */
function _consumeRegexFlags(line, startIdx) {
  let flags = '';
  let idx = startIdx;
  while (idx + 1 < line.length && REGEX_PATTERNS.regexFlags.test(line[idx + 1])) {
    idx++;
    flags += line[idx];
  }
  return { endIdx: idx, flags };
}

/**
 * Process string literal character
 * @param {string} line
 * @param {number} j
 * @param {string} stringChar
 * @returns {{newIdx: number, chars: string, closed: boolean}}
 */
function _processStringChar(line, j, stringChar) {
  const ch = line[j];
  if (ch === '\\' && j + 1 < line.length) {
    return { newIdx: j + 1, chars: ch + line[j + 1], closed: false };
  }
  if (ch === stringChar) {
    return { newIdx: j, chars: ch, closed: true };
  }
  return { newIdx: j, chars: ch, closed: false };
}

/**
 * Process regex literal character
 * @param {string} line
 * @param {number} j
 * @returns {{newIdx: number, chars: string, closed: boolean}}
 */
function _processRegexChar(line, j) {
  const ch = line[j];
  if (ch === '\\' && j + 1 < line.length) {
    return { newIdx: j + 1, chars: ch + line[j + 1], closed: false };
  }
  if (ch === '/') {
    const flagInfo = _consumeRegexFlags(line, j);
    return { newIdx: flagInfo.endIdx, chars: ch + flagInfo.flags, closed: true };
  }
  return { newIdx: j, chars: ch, closed: false };
}

/**
 * Remove comments from code while preserving string literals and regex literals.
 * Handles line and block comments (including multi-line) and avoids touching strings and regexes.
 * @param {string} src
 * @returns {string}
 */
function _removeCommentsPreserveStrings(src) {
  const lines = src.split('\n');
  const out = new Array(lines.length);
  let outIdx = 0;
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (inBlock) {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) continue;
      inBlock = false;
      line = line.slice(endIdx + 2);
    }

    let result = '';
    let inString = false;
    let stringChar = '';
    let inRegex = false;
    const lineLength = line.length;

    for (let j = 0; j < lineLength; j++) {
      const ch = line[j];
      const next = line[j + 1];

      // Handle string start
      if (!inString && !inRegex && (ch === '"' || ch === "'" || ch === '`')) {
        inString = true;
        stringChar = ch;
        result += ch;
        continue;
      }

      // Process string content
      if (inString) {
        const info = _processStringChar(line, j, stringChar);
        result += info.chars;
        j = info.newIdx;
        if (info.closed) {
          inString = false;
          stringChar = '';
        }
        continue;
      }

      // Handle regex start
      if (
        !inString &&
        !inRegex &&
        ch === '/' &&
        _isRegexContext(result) &&
        next !== '/' &&
        next !== '*'
      ) {
        inRegex = true;
        result += ch;
        continue;
      }

      // Process regex content
      if (inRegex) {
        const info = _processRegexChar(line, j);
        result += info.chars;
        j = info.newIdx;
        if (info.closed) inRegex = false;
        continue;
      }

      // Handle block comments
      if (ch === '/' && next === '*') {
        const rest = line.slice(j + 2);
        const closing = rest.indexOf('*/');
        if (closing !== -1) {
          j = j + 2 + closing + 1;
          result += ' ';
          continue;
        }
        inBlock = true;
        break;
      }

      // Handle line comments
      if (ch === '/' && next === '/') break;

      result += ch;
    }

    out[outIdx++] = result;
  }

  // Trim to actual size if we skipped lines
  if (outIdx < out.length) {
    out.length = outIdx;
  }

  return out.join('\n');
}

/**
 * Normalize whitespace for readability and compactness.
 * - trims trailing spaces
 * - collapses multiple spaces/tabs to a single space
 * - preserves up to 4 leading spaces of indentation
 * - preserves regex literals to avoid breaking them
 */
function _normalizeWhitespace(src) {
  const lines = src.split('\n');
  const processedLines = new Array(lines.length);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // First, preserve regex literals by temporarily replacing them
    const regexMatches = [];
    const tempLine = line.replace(REGEX_PATTERNS.regexPattern, match => {
      regexMatches.push(match);
      return `__REGEX_${regexMatches.length - 1}__`;
    });

    // Now process whitespace on the line with placeholders
    let processed = tempLine.replace(REGEX_PATTERNS.trailingWhitespace, '');
    processed = processed.replace(REGEX_PATTERNS.whitespace, ' ');
    const leadingMatch = processed.match(REGEX_PATTERNS.leadingWhitespace);
    if (leadingMatch) {
      const indent = Math.min(leadingMatch[1].length, 4);
      processed = ' '.repeat(indent) + processed.trim();
    }

    // Restore regex literals
    for (let j = 0; j < regexMatches.length; j++) {
      processed = processed.replace(`__REGEX_${j}__`, regexMatches[j]);
    }

    processedLines[i] = processed;
  }

  return processedLines
    .join('\n')
    .replace(REGEX_PATTERNS.multipleNewlines, '\n\n')
    .replace(REGEX_PATTERNS.surroundingWhitespace, '');
}

function simpleOptimize(code, headerBlock) {
  if (!code) return '';

  startPerfTimer('simpleOptimize');

  const headerText = headerBlock || extractMeta(code) || '';
  let body = headerText ? code.replace(headerText, '') : code;

  // remove comments safely
  startPerfTimer('removeComments');
  body = _removeCommentsPreserveStrings(body);
  if (verbose) {
    const commentsDuration = endPerfTimer('removeComments');
    console.log(`  ⏱️  Comment removal: ${commentsDuration.toFixed(2)}ms`);
  }

  // remove empty lines (optimized with array pre-allocation estimate)
  startPerfTimer('removeEmptyLines');
  const lines = body.split('\n');
  const nonEmptyLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      nonEmptyLines.push(lines[i]);
    }
  }
  body = nonEmptyLines.join('\n');
  if (verbose) {
    const emptyLinesDuration = endPerfTimer('removeEmptyLines');
    console.log(`  ⏱️  Empty line removal: ${emptyLinesDuration.toFixed(2)}ms`);
  }

  // normalize whitespace
  startPerfTimer('normalizeWhitespace');
  body = _normalizeWhitespace(body);
  if (verbose) {
    const whitespaceDuration = endPerfTimer('normalizeWhitespace');
    console.log(`  ⏱️  Whitespace normalization: ${whitespaceDuration.toFixed(2)}ms`);
  }

  const finalCode = `${(headerText ? `${headerText.trim()}\n\n` : '') + body.trim()}\n`;

  const totalDuration = endPerfTimer('simpleOptimize');
  if (verbose) console.log(`  ⏱️  Total optimization: ${totalDuration.toFixed(2)}ms`);

  return finalCode;
}

// Read header metadata
let header = null;
let headerSource = null;
// Prefer metadata from a dedicated `userscript.js` (authoritative source), then src/userscript.js, then existing youtube.user.js
const metaCandidates = [
  path.join(ROOT, 'userscript.js'),
  path.join(ROOT, 'src', 'userscript.js'),
  path.join(ROOT, 'youtube.user.js'),
];

for (const p of metaCandidates) {
  const content = readFileSafe(p);
  if (!content) continue;
  const found = extractMeta(content);
  if (found) {
    header = found;
    headerSource = p;
    break;
  }
}

if (header) {
  console.log(`Using userscript metadata from: ${path.relative(ROOT, headerSource)}`);
} else {
  console.warn(
    'Warning: metadata block not found in userscript.js or youtube.user.js. A default header will be used.'
  );
  header = `// ==UserScript==\n// @name YouTube + UserScript (built)\n// @version 0.0\n// ==/UserScript==\n`;
}

// Get module files
/**
 * Reads order manifest from build.order.json or build.order.txt
 * @returns {string[]|null} Array of module filenames or null if not found
 */
function readOrderManifest() {
  for (const name of ORDER_MANIFESTS) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      if (name.endsWith('.json')) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.map(String);
      } else {
        return raw
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);
      }
    } catch (e) {
      console.error(`[Build Error] Failed to read order manifest ${p}:`, e.message);
      return null;
    }
  }
  if (verbose) {
    console.warn('[Build Warning] No order manifest found. Using default ordering.');
  }
  return null;
}

/**
 * Collects all JavaScript module files from src directory
 * @returns {Array<{name: string, dir: string}>} Array of file objects with name and directory
 */
function collectModuleFiles() {
  const srcDir = path.join(ROOT, 'src');
  const useSrc = fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory();
  const baseDir = useSrc ? srcDir : ROOT;

  if (!useSrc && verbose) {
    console.warn('[Build Warning] src/ directory not found. Scanning root directory instead.');
  }

  /**
   * Recursively walks directory and collects .js files
   * @param {string} dir - Directory to walk
   * @returns {Array<{name: string, dir: string}>} Array of file objects
   */
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const out = [];
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          out.push(...walk(p));
        } else if (ent.isFile() && ent.name.endsWith('.js') && !EXCLUDE.has(ent.name)) {
          out.push({ name: ent.name, dir });
        }
      }
      return out;
    } catch (e) {
      console.error(`[Build Error] Failed to read directory ${dir}:`, e.message);
      return [];
    }
  }

  const files = walk(baseDir);
  if (files.length === 0) {
    console.error('[Build Error] No JavaScript module files found!');
    console.error(`[Build Error] Searched in: ${baseDir}`);
    console.error('[Build Error] Make sure your source files are in the src/ directory');
    throw new Error('No module files found for build');
  }

  if (verbose) {
    console.log(`[Build Info] Found ${files.length} module file(s)`);
  }

  // If manifest order exists, use it for ordering by basename (keep path from files)
  const manifest = readOrderManifest();
  if (manifest) {
    const rest = new Map(files.map(f => [f.name, f]));
    const ordered = [];
    for (const name of manifest) {
      if (rest.has(name)) {
        ordered.push(rest.get(name));
        rest.delete(name);
      } else {
        console.warn(`[Build Warning] Module "${name}" listed in manifest but not found in src/`);
        console.warn(`[Build Warning] Available modules: ${Array.from(rest.keys()).join(', ')}`);
      }
    }
    const others = Array.from(rest.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (others.length > 0) {
      console.warn(
        `[Build Warning] ${others.length} module(s) not in manifest: ${others.map(f => f.name).join(', ')}`
      );
      console.warn('[Build Warning] Consider adding these to build.order.json');
    }
    return ordered.concat(others);
  }

  // Default: put main.js first, then alphabetically by basename, preserving dirs
  files.sort((a, b) => {
    if (a.name === 'main.js') return -1;
    if (b.name === 'main.js') return 1;
    return a.name.localeCompare(b.name);
  });
  return files;
}

/**
 * Build the userscript once to the default output location
 * @returns {boolean} True if build succeeded, false otherwise
 */
function buildOnce() {
  // Delegate to buildOnceCustom using default OUT
  return buildOnceCustom(OUT);
}

function watchAndBuild() {
  let timer = null;
  const srcDir = path.join(ROOT, 'src');
  const watchDir = fs.existsSync(srcDir) ? srcDir : ROOT;
  // Prefer chokidar for reliable recursive watching; fall back to fs.watch
  try {
    // Try to require chokidar (may be installed as devDependency)
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(watchDir, { ignoreInitial: true });
    watcher.on('all', (_event, filePath) => {
      if (!filePath || !filePath.endsWith('.js')) return;
      const filename = path.basename(filePath);
      if (EXCLUDE.has(filename)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        console.log(`\n[${new Date().toLocaleTimeString()}] Change detected: ${filePath}`);
        console.log('Rebuilding...');
        buildOnce();
      }, DEBOUNCE_MS);
    });
    console.log(`Watching (chokidar) for changes in: ${path.relative(process.cwd(), watchDir)}/`);
    return watcher;
  } catch {
    const watcher = fs.watch(watchDir, { recursive: false }, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.js')) return;
      if (EXCLUDE.has(filename)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        console.log(`\n[${new Date().toLocaleTimeString()}] Change detected: ${filename}`);
        console.log('Rebuilding...');
        buildOnce();
      }, DEBOUNCE_MS);
    });
    console.log(
      `Watching (fs.watch fallback) for changes in: ${path.relative(process.cwd(), watchDir)}/`
    );
    return watcher;
  }
}

// CLI flags
const args = process.argv.slice(2);
const watch = args.includes('--watch') || args.includes('-w');
let noEslint = args.includes('--no-eslint');
const verbose = args.includes('--verbose') || args.includes('-v');
const minify = args.includes('--minify') || args.includes('-m');
// New: optimized flag — performs aggressive trimming (remove comments/whitespace) and skips ESLint for speed
const optimized = args.includes('--optimized');
if (optimized) {
  // For backward compatibility with previous `--no-eslint` behaviour (build:fast), skip ESLint
  noEslint = true;
  if (verbose) {
    console.log(
      'Optimized build requested: skipping ESLint and performing aggressive minification'
    );
  }
}
// Optional pretty / sourcemap flags for minify
const minifyPretty = args.includes('--pretty') || args.includes('--minify-pretty');
const minifySourceMap = args.includes('--sourcemap') || args.includes('--map');

// Output override: --out <path> or -o <path>
let OUT_PATH = OUT;
const outIdx = args.findIndex(a => a === '--out' || a === '-o');
if (outIdx !== -1 && args.length > outIdx + 1) {
  OUT_PATH = path.resolve(process.cwd(), args[outIdx + 1]);
}

// Helper to ensure eslint is installed locally; creates package.json if missing
function ensureLocalEslint() {
  const eslintBin = path.join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'eslint.cmd' : 'eslint'
  );
  if (fs.existsSync(eslintBin)) return eslintBin;

  const pkgPath = path.join(ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    try {
      fs.writeFileSync(
        pkgPath,
        JSON.stringify({ name: 'youtube-plus-modular-build', private: true }, null, 2)
      );
      console.log('Created minimal package.json');
    } catch (e) {
      console.warn('Could not create package.json:', e && e.message);
      return null;
    }
  }

  try {
    console.log('Installing ESLint locally (this may take a moment)...');
    execSync('npm install --no-audit --no-fund eslint --save-dev', { cwd: ROOT, stdio: 'inherit' });
    if (fs.existsSync(eslintBin)) return eslintBin;
  } catch (e) {
    console.warn('Automatic ESLint installation failed:', e && e.message);
    return null;
  }
  return null;
}

/**
 * Merges module files into a single output string
 * @param {Array} files - Array of file objects
 * @returns {{code: string, mergedCount: number, skippedCount: number, changedCount: number}} Merged code and stats
 */
function mergeModuleFiles(files) {
  startPerfTimer('mergeModuleFiles');

  const parts = [header.trim(), '\n'];
  let mergedCount = 0;
  let skippedCount = 0;
  let changedCount = 0;

  // Read all files in parallel for better performance
  const fileContents = files.map(f => {
    const filePath = typeof f === 'string' ? f : path.join(f.dir, f.name);
    const p = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
    const displayName = typeof f === 'string' ? path.basename(f) : f.name;
    const changed = hasFileChanged(p);
    if (changed) changedCount++;
    return { path: p, displayName, content: readFileSafe(p), changed };
  }); // Process all file contents
  for (const { path: p, displayName, content } of fileContents) {
    if (content === null) {
      console.warn(`⚠️  Could not read: ${path.relative(ROOT, p)}`);
      skippedCount++;
      continue;
    }

    const clean = stripMeta(content).trim();
    if (!clean) {
      console.warn(`⚠️  Empty module: ${path.relative(ROOT, p)}`);
      skippedCount++;
      continue;
    }

    parts.push(`// --- MODULE: ${displayName} ---`);
    parts.push(clean);
    if (verbose) console.log(`  ✓ Merged: ${displayName}`);
    mergedCount++;
  }

  const mergedCode = `${parts.join('\n\n')}\n`;

  const duration = endPerfTimer('mergeModuleFiles');
  if (verbose) {
    console.log(`  ⏱️  Merge time: ${duration.toFixed(2)}ms`);
    if (changedCount < mergedCount) {
      console.log(
        `  📦 Changed files: ${changedCount}/${mergedCount} (${((changedCount / mergedCount) * 100).toFixed(1)}%)`
      );
    }
  }

  return {
    code: mergedCode,
    mergedCount,
    skippedCount,
    changedCount,
  };
} /**
 * Validates syntax using vm.Script
 * @param {string} code - Code to validate
 * @param {string} outPath - Output path for error reporting
 * @returns {boolean} True if valid
 */
function validateSyntax(code, outPath) {
  if (verbose) console.log('Running syntax validation...');
  try {
    new vm.Script(code, { filename: outPath });
    console.log('✓ Basic syntax check passed (vm.Script)');
    return true;
  } catch (e) {
    console.error('❌ Syntax check failed:', e && e.message);
    if (verbose && e.stack) {
      console.error('Stack trace:', e.stack);
    }
    return false;
  }
}

/**
 * Gets ESLint command for the given configuration
 * @param {string} eslintPath - Path to ESLint executable
 * @param {string} outPath - Output file path
 * @returns {string} ESLint command to execute
 */
function getEslintCommand(eslintPath, outPath) {
  const flatConfig = path.join(ROOT, 'eslint.config.cjs');

  if (fs.existsSync(flatConfig)) {
    if (verbose) console.log(`Using flat config: ${flatConfig}`);
    return `"${eslintPath}" --no-warn-ignored "${outPath}"`;
  }

  const configPath = path.join(ROOT, '.eslintrc.cjs');
  const configArg = fs.existsSync(configPath) ? `--config "${configPath}"` : '';
  return `"${eslintPath}" --no-warn-ignored ${configArg} "${outPath}"`;
}

/**
 * Runs ESLint validation on the output file
 * @param {string} outPath - Output file path
 * @returns {boolean} True if ESLint passes
 */
function runEslintValidation(outPath) {
  if (noEslint) {
    if (verbose) console.log('Skipping ESLint (--no-eslint flag)');
    return true;
  }

  if (verbose) console.log('Preparing ESLint validation...');

  let eslintPath = path.join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'eslint.cmd' : 'eslint'
  );

  if (!fs.existsSync(eslintPath)) {
    if (verbose) console.log('ESLint not found locally, attempting installation...');
    eslintPath = ensureLocalEslint();
  }

  if (!eslintPath || !fs.existsSync(eslintPath)) {
    return true;
  }

  try {
    console.log('Running ESLint validation...');
    const command = getEslintCommand(eslintPath, outPath);
    execSync(command, { stdio: 'inherit' });

    if (verbose) console.log('✓ ESLint validation passed');
    console.log('✓ ESLint passed');
    return true;
  } catch (err) {
    console.error('❌ ESLint reported problems');
    if (verbose) {
      console.error('ESLint exit code:', err.status || 'unknown');
    }
    return false;
  }
}

/**
 * Optimizes or minifies the code
 * @param {string} code - Code to optimize
 * @param {string} outPath - Output file path
 * @returns {Promise<boolean>} True if successful
 */
async function optimizeOrMinify(code, outPath) {
  if (verbose) {
    console.log(
      minify ? 'Minifying output...' : 'Optimizing output (strip comments/whitespace)...'
    );
  }

  try {
    const isOptimized = optimized && !minify;

    if (isOptimized) {
      return performSimpleOptimization(code, outPath);
    }

    return await performTerserMinification(code, outPath);
  } catch (e) {
    console.error('[Build Error] Minification/optimization failed:', e && e.message);
    if (verbose) console.error(e && e.stack);
    return false;
  }
}

/**
 * Performs simple optimization without mangling
 * @param {string} code - Code to optimize
 * @param {string} outPath - Output file path
 * @returns {boolean} True if successful
 */
function performSimpleOptimization(code, outPath) {
  if (verbose) console.log('Running simple optimizer (no mangling/compression)');

  // Write unoptimized code for debugging
  const debugPath = outPath.replace('.js', '.unoptimized.js');
  fs.writeFileSync(debugPath, code, 'utf8');
  console.log(`✓ Wrote unoptimized code to ${path.basename(debugPath)} for debugging`);

  const finalCode = simpleOptimize(code, header);
  fs.writeFileSync(outPath, finalCode, 'utf8');

  const originalSize = Buffer.byteLength(code, 'utf8');
  const optimizedSize = Buffer.byteLength(finalCode, 'utf8');
  const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(2);

  console.log(
    `✓ Optimized: ${(originalSize / 1024).toFixed(2)}KB → ${(optimizedSize / 1024).toFixed(2)}KB (saved ${savings}%)`
  );
  return true;
} /**
 * Creates Terser compression options with advanced optimizations
 * @returns {object|false} Compression options or false
 */
function getTerserCompressOptions() {
  if (minifyPretty) {
    return false;
  }

  return {
    // Remove dead code and unreachable code
    dead_code: true,
    drop_console: false, // Keep console logs for userscript debugging
    drop_debugger: true, // Remove debugger statements

    // Keep names for better debugging and compatibility
    keep_classnames: true,
    keep_fnames: true,
    keep_infinity: true,

    // Advanced optimizations - increase passes for better compression
    passes: optimized || minify ? 5 : 3, // More passes for better results
    pure_getters: true, // Assume getters have no side effects
    unsafe: false, // Don't use unsafe optimizations
    unsafe_comps: false,
    unsafe_Function: false,
    unsafe_math: false,
    unsafe_proto: false,
    unsafe_regexp: false,
    unsafe_undefined: false,

    // Optimization settings
    arrows: true, // Convert functions to arrow functions where possible
    booleans: true, // Optimize boolean expressions
    collapse_vars: true, // Collapse single-use variables
    comparisons: true, // Optimize comparisons
    computed_props: true, // Optimize computed property access
    conditionals: true, // Optimize if-s and conditional expressions
    evaluate: true, // Evaluate constant expressions
    hoist_funs: true, // Hoist function declarations
    hoist_props: true, // Hoist properties from constant object/array literals
    hoist_vars: false, // Don't hoist var declarations (can make debugging harder)
    if_return: true, // Optimize if/return and if/continue
    inline: 3, // Inline functions (level 3 = aggressive)
    join_vars: true, // Join consecutive var statements
    loops: true, // Optimize loops
    negate_iife: true, // Negate IIFE where safe
    properties: true, // Optimize property access
    reduce_vars: true, // Reduce variables assigned with and used as constant values
    sequences: true, // Join consecutive simple statements with commas
    side_effects: true, // Remove expressions with no side effects
    switches: true, // Remove duplicate and unreachable switch branches
    typeofs: true, // Optimize typeof expressions
    unused: true, // Drop unreferenced functions and variables

    // Additional size optimizations
    toplevel: false, // Don't compress top-level scope for userscript compatibility
    keep_fargs: false, // Remove unused function arguments
    drop_console: false, // Keep console for debugging (can change to true for production)

    // Global definitions (helps with dead code elimination)
    global_defs: {
      DEBUG: false,
    },
  };
}

/**
 * Creates Terser format options with improved output formatting
 * @returns {object} Format options
 */
function getTerserFormatOptions() {
  // For optimized builds, remove ALL comments except userscript metadata
  const userscriptMetaRegex =
    /==UserScript==|==\/UserScript==|@name|@version|@description|@author|@license|@match|@grant|@namespace|@downloadURL|@updateURL|@supportURL|@homepageURL|@icon|@run-at|@require|@resource/;

  const baseOptions = {
    comments: optimized || minify ? userscriptMetaRegex : 'some',
    preamble: header.trim(),
    semicolons: true,
    preserve_annotations: false, // Remove @__PURE__ in production for smaller size
  };

  if (minifyPretty) {
    return {
      ...baseOptions,
      beautify: true,
      indent_level: 2,
      indent_start: 0,
      quote_style: 1,
      wrap_iife: false,
      wrap_func_args: true,
      braces: true,
      keep_quoted_props: false,
    };
  }

  return {
    ...baseOptions,
    ascii_only: false,
    braces: false,
    ecma: 2020,
    indent_level: 0,
    keep_numbers: false,
    quote_keys: false,
    quote_style: 3,
    wrap_iife: true,
  };
}

/**
 * Performs Terser minification with advanced optimization
 * @param {string} code - Code to minify
 * @param {string} outPath - Output file path
 * @returns {Promise<boolean>} True if successful
 */
async function performTerserMinification(code, outPath) {
  const terser = require('terser');

  const terserOpts = {
    compress: getTerserCompressOptions(),
    // Enable mangling for maximum compression (but keep function/class names for debugging)
    mangle: !minifyPretty && {
      properties: false, // Don't mangle property names
      toplevel: false, // Don't mangle top-level names
      keep_classnames: true,
      keep_fnames: true,
      reserved: ['YouTubeUtils', 'YouTubePlusI18n', 'YouTubeEnhancer', 'window', 'document'], // Reserved names
    },
    format: getTerserFormatOptions(),
    // Parse options
    parse: {
      ecma: 2020, // Support modern JavaScript
      bare_returns: false,
      html5_comments: false,
      shebang: false,
    },
    // Additional optimization options
    ecma: 2020,
    module: false,
    toplevel: false, // Don't compress top-level scope (needed for userscripts)
    nameCache: null,
    ie8: false,
    keep_classnames: true,
    keep_fnames: true,
    safari10: false,
  };

  if (minifySourceMap) {
    terserOpts.sourceMap = {
      filename: path.basename(outPath),
      url: `${path.basename(outPath)}.map`,
      includeSources: true,
    };
  }

  if (verbose) {
    console.log('Terser options:', JSON.stringify(terserOpts, null, 2));
  }

  const minified = await terser.minify(code, terserOpts);

  if (minified.error) {
    console.error('[Build Error] Terser minification error:', minified.error);
    return false;
  }

  if (!minified || !minified.code) {
    console.error('[Build Error] Minification produced no output');
    return false;
  }

  // Check for warnings
  if (minified.warnings && minified.warnings.length > 0) {
    console.warn('[Build Warning] Terser warnings:');
    minified.warnings.forEach(w => console.warn(`  - ${w}`));
  }

  let finalCode = minified.code;

  if (minifySourceMap && minified.map) {
    const mapPath = `${outPath}.map`;
    fs.writeFileSync(mapPath, minified.map, 'utf8');
    finalCode = `${finalCode}\n//# sourceMappingURL=${path.basename(mapPath)}\n`;
    if (verbose) console.log(`✓ Source map written: ${mapPath}`);
  }

  fs.writeFileSync(outPath, finalCode, 'utf8');

  const originalSize = Buffer.byteLength(code, 'utf8');
  const minifiedSize = Buffer.byteLength(finalCode, 'utf8');
  const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(2);
  const savedKb = ((originalSize - minifiedSize) / 1024).toFixed(2);

  console.log(
    `✓ Minified: ${(originalSize / 1024).toFixed(2)}KB → ${(minifiedSize / 1024).toFixed(2)}KB (saved ${savedKb}KB / ${savings}%)`
  );

  if (minifyPretty) {
    console.log('✓ Pretty minify enabled: output is formatted for readability');
  }
  if (minifySourceMap) {
    console.log(`✓ Source map: ${path.basename(outPath)}.map`);
  }

  return true;
}

/**
 * Main build function with reduced complexity
 * @param {string} outPath - Output file path
 * @returns {Promise<boolean>} True if build succeeded
 */
async function buildOnceCustom(outPath) {
  startPerfTimer('totalBuild');

  // Load build cache for incremental builds
  if (!watch) {
    loadBuildCache();
  }

  if (verbose) console.log(`Starting build process for ${outPath}...`);

  startPerfTimer('collectModules');
  const files = collectModuleFiles();
  const collectDuration = endPerfTimer('collectModules');
  if (verbose) {
    console.log(`Found ${files.length} module(s) to merge (${collectDuration.toFixed(2)}ms)`);
  }

  // Merge module files
  const { code, mergedCount, skippedCount } = mergeModuleFiles(files);

  if (skippedCount > 0) {
    console.warn(`⚠️  Skipped ${skippedCount} module(s) due to errors or empty content`);
  }

  startPerfTimer('writeFile');
  fs.writeFileSync(outPath, code, 'utf8');
  const writeDuration = endPerfTimer('writeFile');

  const fileSize = (Buffer.byteLength(code, 'utf8') / 1024).toFixed(2);
  console.log(
    `\n✓ Built ${path.relative(ROOT, outPath)} from ${mergedCount} modules (${fileSize}KB, ${writeDuration.toFixed(2)}ms):`
  );

  for (const f of files) {
    const filePath = typeof f === 'string' ? f : path.join(f.dir, f.name);
    const fp = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
    const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
    console.log('  ✓', rel);
  }

  // Validate syntax
  startPerfTimer('validateSyntax');
  if (!validateSyntax(code, outPath)) {
    return false;
  }
  const validateDuration = endPerfTimer('validateSyntax');
  if (verbose) console.log(`  ⏱️  Syntax validation: ${validateDuration.toFixed(2)}ms`);

  // Run ESLint
  startPerfTimer('eslint');
  if (!runEslintValidation(outPath)) {
    return false;
  }
  const eslintDuration = endPerfTimer('eslint');
  if (!noEslint && verbose) console.log(`  ⏱️  ESLint: ${eslintDuration.toFixed(2)}ms`);

  // Optimize or minify if requested
  if (minify || optimized) {
    startPerfTimer('optimize');
    if (!(await optimizeOrMinify(code, outPath))) {
      return false;
    }
    const optimizeDuration = endPerfTimer('optimize');
    if (verbose) console.log(`  ⏱️  Optimization: ${optimizeDuration.toFixed(2)}ms`);
  }

  const totalDuration = endPerfTimer('totalBuild');
  console.log(`✓ Build completed successfully in ${(totalDuration / 1000).toFixed(2)}s`);

  // Save build cache for next incremental build
  if (!watch) {
    buildCache.lastBuild = Date.now();
    saveBuildCache();
  }

  // Log performance summary if verbose
  if (verbose) {
    console.log('\n📊 Performance Summary:');
    console.log(`  Total: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(
      `  Throughput: ${Math.round((code.split('\n').length / totalDuration) * 1000)} lines/sec`
    );
  }

  return true;
}

// Helper wrapper for CLI entry (calls async buildOnceCustom)
async function buildOnceCli() {
  try {
    return await buildOnceCustom(OUT_PATH);
  } catch (err) {
    console.error('Build failed:', err && err.message);
    if (verbose) console.error(err && err.stack);
    return false;
  }
}

if (watch) {
  buildOnceCli().then(ok => {
    if (!ok) console.warn('Initial build failed. Still watching for fixes...');
    watchAndBuild();
  });
} else {
  buildOnceCli().then(ok => {
    if (!ok) process.exitCode = 2;
  });
}
