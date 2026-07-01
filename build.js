// @ts-nocheck
/**
 * YouTube Plus Modular Build System
 *
 * This build script concatenates multiple JavaScript modules from the src/ directory
 * into a single userscript file (youtube.user.js) with the following features:
 * - Module ordering via build.order.json
 * - Userscript metadata preservation
 * - Optional minification with Terser
 * - Watch mode for development
 * - Biome validation
 * - Syntax checking
 *
 * Usage:
 *   node build.js              - Standard build
 *   node build.js --watch      - Watch mode with auto-rebuild
 *   node build.js --optimized  - Build with code optimization
 *   node build.js --minify     - Build with full minification
 */

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

// Watch debounce ms (optimized)
const DEBOUNCE_MS = 150;

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

// Cache for metadata extraction and file processing (with size limits)
const MAX_CACHE_SIZE = 200; // Increased for better performance
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
        globalThis.console.log(
          `Loaded build cache with ${Object.keys(buildCache.files).length} entries`
        );
      }
    }
  } catch (e) {
    if (verbose) {
      globalThis.console.warn('Failed to load build cache:', e.message);
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
    if (verbose) globalThis.console.warn('Failed to save build cache:', e.message);
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
      globalThis.console.error('[Build Error] Invalid file path provided');
      return null;
    }
    if (!fs.existsSync(p)) {
      globalThis.console.warn(`[Build Warning] File not found: ${p}`);
      return null;
    }
    const stats = fs.statSync(p);
    if (!stats.isFile()) {
      globalThis.console.warn(`[Build Warning] Path is not a file: ${p}`);
      return null;
    }
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    globalThis.console.error(`[Build Error] Failed to read file ${p}:`, err.message);
    if (err.code === 'EACCES') {
      globalThis.console.error('[Build Error] Permission denied. Check file permissions.');
    } else if (err.code === 'EMFILE') {
      globalThis.console.error(
        '[Build Error] Too many open files. Try closing other applications.'
      );
    }
    return null;
  }
}

/**
 * Safely read a file asynchronously, returning null on error
 * @param {string} p - File path
 * @returns {Promise<string|null>} File content or null
 */
async function readFileSafeAsync(p) {
  try {
    if (!p || typeof p !== 'string') {
      globalThis.console.error('[Build Error] Invalid file path provided');
      return null;
    }
    const stats = await fs.promises.stat(p);
    if (!stats.isFile()) {
      globalThis.console.warn(`[Build Warning] Path is not a file: ${p}`);
      return null;
    }
    return await fs.promises.readFile(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      globalThis.console.warn(`[Build Warning] File not found: ${p}`);
    } else {
      globalThis.console.error(`[Build Error] Failed to read file ${p}:`, err.message);
      if (err.code === 'EACCES') {
        globalThis.console.error('[Build Error] Permission denied. Check file permissions.');
      } else if (err.code === 'EMFILE') {
        globalThis.console.error(
          '[Build Error] Too many open files. Try closing other applications.'
        );
      }
    }
    return null;
  }
}

/**
 * Inline CSS resources referenced from JS modules via __YTPLUS_INLINE_CSS__('relative/path.css').
 * @param {string} content
 * @param {string} filePath
 * @returns {string}
 */
function inlineCssResources(content, filePath) {
  if (!content?.includes('__YTPLUS_INLINE_CSS__')) return content;

  return content.replace(
    /__YTPLUS_INLINE_CSS__\(\s*['"]([^'"]+?)['"]\s*\)/g,
    (_match, resourcePath) => {
      const resolved = path.resolve(path.dirname(filePath), String(resourcePath).trim());
      const css = readFileSafe(resolved);
      if (css === null) {
        globalThis.console.warn(
          `[Build Warning] CSS resource not found for inline marker in ${path.relative(ROOT, filePath)}: ${String(resourcePath).trim()}`
        );
        return '""';
      }
      return JSON.stringify(css);
    }
  );
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
    return {
      newIdx: flagInfo.endIdx,
      chars: ch + flagInfo.flags,
      closed: true,
    };
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
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (inBlock) {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) continue;
      inBlock = false;
      line = line.slice(endIdx + 2);
    }

    let result = '';
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

/**
 * Minify CSS inside JavaScript template literals.
 * Only targets template literals that are overwhelmingly CSS (>60% CSS-like lines).
 * Uses safe transforms that won't break JS code inside template expressions.
 * @param {string} code
 * @returns {string}
 */
function minifyCSSInTemplateLiterals(code) {
  return code.replace(/`([^`]{200,})`/g, (match, inner) => {
    // Must have newlines (multi-line) and braces
    if (!inner.includes('\n') || !inner.includes('{')) return match;
    // Skip if has many template expressions (likely mixed JS/HTML)
    const exprCount = (inner.match(/\$\{/g) || []).length;
    if (exprCount > 15) return match;

    // Count lines that look like CSS vs total non-empty lines
    const lines = inner.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 5) return match;

    let cssLines = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      // CSS patterns: selectors, properties, closing braces, @rules
      if (
        /^[.#@:[\w*>~+\-,\s]+\{/.test(trimmed) || // selector {
        /^[a-z-]+\s*:\s*.+;/.test(trimmed) || // property: value;
        /^\}/.test(trimmed) || // } closing
        /^@(media|keyframes|font-face|import|supports)/.test(trimmed) || // @rules
        /^(from|to|\d+%)\s*\{/.test(trimmed) || // keyframe steps
        trimmed === ''
      ) {
        cssLines++;
      }
    }

    const cssRatio = cssLines / lines.length;
    if (cssRatio < 0.6) return match; // not enough CSS content, skip

    let minified = inner;
    // Remove CSS comments
    minified = minified.replace(/\/\*[\s\S]*?\*\//g, '');
    // Collapse newlines and leading whitespace, but preserve spaces around ${} expressions
    minified = minified.replace(/\n\s*/g, ' ');
    // Collapse whitespace around CSS braces only
    minified = minified.replace(/\s*\{\s*/g, '{');
    minified = minified.replace(/\s*\}\s*/g, '}');
    minified = minified.replace(/\s*;\s*/g, ';');
    // Only collapse around colons if it's clearly a CSS property (word-colon pattern)
    minified = minified.replace(/([a-z-])\s*:\s*/gi, '$1:');
    // Collapse around commas in selectors
    minified = minified.replace(/\s*,\s*/g, ',');
    // Clean up multiple spaces
    minified = minified.replace(/ {2,}/g, ' ');
    minified = minified.trim();

    // Only use minified if meaningfully shorter
    if (minified.length < inner.length * 0.8) {
      return '`' + minified + '`';
    }
    return match;
  });
}

function simpleOptimize(code, headerBlock) {
  if (!code) return '';

  startPerfTimer('simpleOptimize');

  const headerText = headerBlock || extractMeta(code) || '';
  let body = headerText ? code.replace(headerText, '') : code;

  // minify CSS inside template literals FIRST (before comment removal collapses newlines)
  startPerfTimer('minifyCSS');
  const beforeCSS = body.length;
  body = minifyCSSInTemplateLiterals(body);
  const cssSaved = beforeCSS - body.length;
  const cssDuration = endPerfTimer('minifyCSS');
  if (verbose) {
    globalThis.console.log(
      `  ⏱️  CSS minification: ${cssDuration.toFixed(2)}ms (saved ${(cssSaved / 1024).toFixed(1)}KB)`
    );
  }

  // remove comments safely (optimized)
  startPerfTimer('removeComments');
  body = _removeCommentsPreserveStrings(body);
  const commentsDuration = endPerfTimer('removeComments');
  if (verbose && commentsDuration > 10) {
    globalThis.console.log(`  ⏱️  Comment removal: ${commentsDuration.toFixed(2)}ms`);
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
    globalThis.console.log(`  ⏱️  Empty line removal: ${emptyLinesDuration.toFixed(2)}ms`);
  }

  // normalize whitespace
  startPerfTimer('normalizeWhitespace');
  body = _normalizeWhitespace(body);
  if (verbose) {
    const whitespaceDuration = endPerfTimer('normalizeWhitespace');
    globalThis.console.log(`  ⏱️  Whitespace normalization: ${whitespaceDuration.toFixed(2)}ms`);
  }

  const finalCode = `${(headerText ? `${headerText.trim()}\n\n` : '') + body.trim()}\n`;

  const totalDuration = endPerfTimer('simpleOptimize');
  if (verbose) globalThis.console.log(`  ⏱️  Total optimization: ${totalDuration.toFixed(2)}ms`);

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
  globalThis.console.log(`Using userscript metadata from: ${path.relative(ROOT, headerSource)}`);
} else {
  globalThis.console.warn(
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
      globalThis.console.error(`[Build Error] Failed to read order manifest ${p}:`, e.message);
      return null;
    }
  }
  if (verbose) {
    globalThis.console.warn('[Build Warning] No order manifest found. Using default ordering.');
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
    globalThis.console.warn(
      '[Build Warning] src/ directory not found. Scanning root directory instead.'
    );
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
      globalThis.console.error(`[Build Error] Failed to read directory ${dir}:`, e.message);
      return [];
    }
  }

  const files = walk(baseDir);
  if (files.length === 0) {
    globalThis.console.error('[Build Error] No JavaScript module files found!');
    globalThis.console.error(`[Build Error] Searched in: ${baseDir}`);
    globalThis.console.error('[Build Error] Make sure your source files are in the src/ directory');
    throw new Error('No module files found for build');
  }

  if (verbose) {
    globalThis.console.log(`[Build Info] Found ${files.length} module file(s)`);
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
        globalThis.console.warn(
          `[Build Warning] Module "${name}" listed in manifest but not found in src/`
        );
        globalThis.console.warn(
          `[Build Warning] Available modules: ${Array.from(rest.keys()).join(', ')}`
        );
      }
    }
    const others = Array.from(rest.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (others.length > 0) {
      globalThis.console.warn(
        `[Build Warning] ${others.length} module(s) not in manifest: ${others.map(f => f.name).join(', ')}`
      );
      globalThis.console.warn('[Build Warning] Consider adding these to build.order.json');
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
 * Build the userscript once to the default output location.
 * Returns a Promise<boolean> — callers in watch mode must await it
 * to detect build failures.
 * @returns {Promise<boolean>} True if build succeeded, false otherwise
 */
async function buildOnce() {
  try {
    return await buildOnceCustom(OUT);
  } catch (err) {
    globalThis.console.error('Build failed:', err?.message || err);
    return false;
  }
}

function watchAndBuild() {
  let timer = null;
  const srcDir = path.join(ROOT, 'src');
  const watchDir = fs.existsSync(srcDir) ? srcDir : ROOT;

  /** @param {string} label */
  const scheduleRebuild = label => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      globalThis.console.log(`\n[${new Date().toLocaleTimeString()}] Change detected: ${label}`);
      globalThis.console.log('Rebuilding...');
      const ok = await buildOnce();
      if (!ok) globalThis.console.error('Rebuild failed — waiting for next change');
    }, DEBOUNCE_MS);
  };

  // Prefer chokidar for reliable recursive watching; fall back to fs.watch
  try {
    // Try to require chokidar (may be installed as devDependency)
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(watchDir, { ignoreInitial: true });
    watcher.on('all', (_event, filePath) => {
      if (!filePath || (!filePath.endsWith('.js') && !filePath.endsWith('.css'))) return;
      const filename = path.basename(filePath);
      if (EXCLUDE.has(filename)) return;
      scheduleRebuild(filePath);
    });
    globalThis.console.log(
      `Watching (chokidar) for changes in: ${path.relative(process.cwd(), watchDir)}/`
    );
    return watcher;
  } catch {
    const watcher = fs.watch(watchDir, { recursive: false }, (_eventType, filename) => {
      if (!filename || (!filename.endsWith('.js') && !filename.endsWith('.css'))) return;
      if (EXCLUDE.has(filename)) return;
      scheduleRebuild(filename);
    });
    globalThis.console.log(
      `Watching (fs.watch fallback) for changes in: ${path.relative(process.cwd(), watchDir)}/`
    );
    return watcher;
  }
}

// CLI flags
const args = process.argv.slice(2);
const watch = args.includes('--watch') || args.includes('-w');
let noLint = args.includes('--no-lint') || args.includes('--no-biome');
const verbose = args.includes('--verbose') || args.includes('-v');
const minify = args.includes('--minify') || args.includes('-m');
// New: optimized flag — performs aggressive trimming (remove comments/whitespace) and skips lint for speed
const optimized = args.includes('--optimized');
// Dry-run: build everything but skip writing output (useful for CI validation)
const dryRun = args.includes('--dry-run');
if (optimized) {
  noLint = true;
  if (verbose) {
    globalThis.console.log(
      'Optimized build requested: skipping lint validation and performing aggressive minification'
    );
  }
}
if (dryRun) {
  globalThis.console.log('Dry-run mode: build will run but no files will be written');
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

/**
 * Merges module files into a single output string
 * @param {Array} files - Array of file objects
 * @returns {{code: string, mergedCount: number, skippedCount: number, changedCount: number}} Merged code and stats
 */
async function mergeModuleFiles(files) {
  startPerfTimer('mergeModuleFiles');

  const parts = [header.trim(), '\n'];
  let mergedCount = 0;
  let skippedCount = 0;
  let changedCount = 0;

  const filePaths = files.map(f => {
    const filePath = typeof f === 'string' ? f : path.join(f.dir, f.name);
    const p = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
    const displayName = typeof f === 'string' ? path.basename(f) : f.name;
    const changed = hasFileChanged(p);
    if (changed) changedCount++;
    return { path: p, displayName, changed };
  });

  const contents = await Promise.all(filePaths.map(({ path: p }) => readFileSafeAsync(p)));

  for (let i = 0; i < filePaths.length; i++) {
    const { path: p, displayName } = filePaths[i];
    const content = contents[i];
    if (content === null) {
      globalThis.console.warn(`⚠️  Could not read: ${path.relative(ROOT, p)}`);
      skippedCount++;
      continue;
    }

    const clean = inlineCssResources(stripMeta(content), p).trim();
    if (!clean) {
      globalThis.console.warn(`⚠️  Empty module: ${path.relative(ROOT, p)}`);
      skippedCount++;
      continue;
    }

    parts.push(`// --- MODULE: ${displayName} ---`);
    parts.push(clean);
    if (verbose) globalThis.console.log(`  ✓ Merged: ${displayName}`);
    mergedCount++;
  }

  const mergedCode = `${parts.join('\n\n')}\n`;

  const duration = endPerfTimer('mergeModuleFiles');
  if (verbose) {
    globalThis.console.log(`  ⏱️  Merge time: ${duration.toFixed(2)}ms`);
    if (changedCount < mergedCount) {
      globalThis.console.log(
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
  if (verbose) globalThis.console.log('Running syntax validation...');
  try {
    new vm.Script(code, { filename: outPath });
    globalThis.console.log('✓ Basic syntax check passed (vm.Script)');
    return true;
  } catch (e) {
    globalThis.console.error('❌ Syntax check failed:', e?.message);
    if (verbose && e.stack) {
      globalThis.console.error('Stack trace:', e.stack);
    }
    return false;
  }
}

/**
 * Runs Biome lint validation on the output file
 * @param {string} outPath - Output file path
 * @returns {boolean} True if lint passes
 */
function runBiomeValidation(_outPath) {
  if (noLint) {
    if (verbose) globalThis.console.log('Skipping lint (--no-lint flag)');
    return true;
  }

  if (verbose) globalThis.console.log('Preparing Biome validation...');

  try {
    globalThis.console.log('Running Biome validation...');
    execSync(`npx biome check --no-errors-on-unmatched "src"`, {
      stdio: 'inherit',
    });

    if (verbose) globalThis.console.log('✓ Biome validation passed');
    globalThis.console.log('✓ Biome passed');
    return true;
  } catch (err) {
    globalThis.console.error('❌ Biome reported problems');
    if (verbose) {
      globalThis.console.error('Biome exit code:', err.status || 'unknown');
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
    globalThis.console.log(
      minify ? 'Minifying output...' : 'Optimizing output (strip comments/whitespace)...'
    );
  }

  try {
    const isOptimized = optimized && !minify;

    if (isOptimized) {
      return await performSimpleOptimization(code, outPath);
    }

    return await performTerserMinification(code, outPath);
  } catch (e) {
    globalThis.console.error('[Build Error] Minification/optimization failed:', e?.message);
    if (verbose) globalThis.console.error(e?.stack);
    return false;
  }
}

/**
 * Performs simple optimization without mangling
 * Uses Terser with compression (no mangling) for better size reduction while keeping readability
 * @param {string} code - Code to optimize
 * @param {string} outPath - Output file path
 * @returns {Promise<boolean>} True if successful
 */
async function performSimpleOptimization(code, outPath) {
  if (verbose) globalThis.console.log('Running optimized build (Terser compress, no mangle)');

  // Write unoptimized code for debugging
  const debugPath = outPath.replace('.js', '.unoptimized.js');
  fs.writeFileSync(debugPath, code, 'utf8');
  globalThis.console.log(`✓ Wrote unoptimized code to ${path.basename(debugPath)} for debugging`);

  try {
    const terser = require('terser');

    // Remove metadata block that will be re-added via preamble
    const codeToOptimize = code
      .replace(REGEX_PATTERNS.stripLineMeta, '')
      .replace(REGEX_PATTERNS.stripBlockMeta, '');

    // Pre-minify CSS inside JS template literals so the design-system
    // style bundles (CSS variables, components, feature flags) get
    // collapsed before Terser runs. Without this pass the optimize
    // build ships a lot of CSS whitespace and indentation that adds
    // ~40-60 KB to the bundle.
    const cssMinStart = Date.now();
    const cssMinBefore = codeToOptimize.length;
    const codeAfterCSS = minifyCSSInTemplateLiterals(codeToOptimize);
    const cssMinSaved = cssMinBefore - codeAfterCSS.length;
    if (verbose) {
      const cssMinMs = Date.now() - cssMinStart;
      globalThis.console.log(
        `  ⏱️  CSS template minify: ${cssMinMs}ms (saved ${(cssMinSaved / 1024).toFixed(1)}KB)`
      );
    }

    // Reuse the production-grade compress options (5 passes, full
    // boolean/inlining/hoisting/sequences/toplevel) but force the
    // name-preservation and drop-console-off settings we want for the
    // readable "optimized" debug build. We still mangle local variable
    // and parameter names so the bundle size is comparable to the
    // production minified build, while keeping class names and
    // identifiers matching the public window.* exports intact for
    // debuggability.
    //
    // `pure_funcs` strips non-side-effect console calls (log/info/debug)
    // that have no return value. `console.warn` and `console.error` are
    // kept because removing them could hide real runtime issues while
    // debugging the optimized build.
    const baseCompress = getTerserCompressOptions();
    const compress = {
      ...baseCompress,
      drop_console: false,
      pure_funcs: ['console.log', 'console.info', 'console.debug'],
      keep_classnames: true,
      keep_fnames: false,
      toplevel: true,
    };

    const result = await terser.minify(codeAfterCSS, {
      compress,
      mangle: {
        // Mangle local variables, parameters, and private (underscore /
        // dollar-prefixed) property names. Top-level identifiers and
        // public window.* exports stay readable thanks to the reserved
        // list. Function names are dropped where unused to mirror the
        // minify build while leaving class names visible.
        properties: {
          regex: /^_[a-zA-Z_$0-9]+$/,
          reserved: ['_yt_player'],
        },
        toplevel: false,
        keep_classnames: true,
        keep_fnames: false,
        reserved: [
          'YouTubeUtils',
          'YouTubePlusI18n',
          'YouTubeEnhancer',
          'YouTubeErrorBoundary',
          'YouTubePlusLogger',
          'YouTubePlusCleanupManager',
          'YouTubeSafeDOM',
          'YouTubeSecurityUtils',
          'YouTubeTrustedTypes',
          'YouTubePlusDesignSystem',
          'YouTubeDOMCache',
          'YouTubePlusLazyLoader',
          'YouTubePlusRegistry',
          'YouTubePlusSettingsStore',
          'YouTubePlusSettingsHelpers',
          'YouTubePlusModalHandlers',
          'YouTubePlusEventDelegation',
          'YouTubePlusEmbeddedTranslations',
          'YouTubePlusTimeLoop',
          'youtubePlusReport',
          'window',
          'document',
          'unsafeWindow',
        ],
      },
      format: {
        comments:
          /==UserScript==|==\/UserScript==|@name|@version|@description|@author|@license|@match|@grant|@namespace|@downloadURL|@updateURL|@supportURL|@homepageURL|@icon|@run-at|@require|@resource/,
        preamble: header.trim(),
        semicolons: true,
        braces: true,
        beautify: true,
        indent_level: 0,
        wrap_iife: true,
        ecma: 2020,
      },
      parse: { ecma: 2020 },
      ecma: 2020,
      module: false,
      // IMPORTANT: Keep toplevel:false so that `executionScript` and other
      // top-level identifiers are NOT mangled. The executionScript function
      // is serialized via toString() and injected into the page — if Terser
      // renames it, the injected script still works, but debugging becomes
      // impossible because stack traces use the mangled name.
      // Root-level toplevel:true would OVERRIDE mangle.toplevel:false below.
      toplevel: false,
      keep_classnames: true,
      keep_fnames: true,
    });

    if (result.error || !result.code) {
      globalThis.console.warn(
        '[Build Warning] Terser optimization failed, falling back to simple optimizer'
      );
      const finalCode = simpleOptimize(code, header);
      fs.writeFileSync(outPath, finalCode, 'utf8');
      return true;
    }

    fs.writeFileSync(outPath, result.code, 'utf8');

    const originalSize = Buffer.byteLength(code, 'utf8');
    const optimizedSize = Buffer.byteLength(result.code, 'utf8');
    const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(2);

    globalThis.console.log(
      `✓ Optimized: ${(originalSize / 1024).toFixed(2)}KB → ${(optimizedSize / 1024).toFixed(2)}KB (saved ${savings}%)`
    );
    return true;
  } catch (e) {
    globalThis.console.warn(
      '[Build Warning] Terser not available, using simple optimizer:',
      e.message
    );
    const finalCode = simpleOptimize(code, header);
    fs.writeFileSync(outPath, finalCode, 'utf8');
    const originalSize = Buffer.byteLength(code, 'utf8');
    const optimizedSize = Buffer.byteLength(finalCode, 'utf8');
    const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(2);
    globalThis.console.log(
      `✓ Optimized: ${(originalSize / 1024).toFixed(2)}KB → ${(optimizedSize / 1024).toFixed(2)}KB (saved ${savings}%)`
    );
    return true;
  }
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
    drop_console: minify, // Drop console in minified production build
    drop_debugger: true, // Remove debugger statements

    // Keep names in non-minified modes for debugging
    keep_classnames: !minify,
    keep_fnames: !minify,
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
    toplevel: minify, // Allow top-level compression in full minify mode
    keep_fargs: false, // Remove unused function arguments

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
      toplevel: minify, // Mangle top-level names only in minify mode
      keep_classnames: !minify,
      keep_fnames: !minify,
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
    toplevel: minify, // Enable top-level compression in minify mode
    nameCache: null,
    ie8: false,
    keep_classnames: !minify,
    keep_fnames: !minify,
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
    globalThis.console.log('Terser options:', JSON.stringify(terserOpts, null, 2));
  }

  // Remove any userscript metadata block from the code before minifying.
  // Terser will re-insert the header via `format.preamble`, so keeping the
  // original header in the input would duplicate it in the output.
  const codeToMinify = code
    .replace(REGEX_PATTERNS.stripLineMeta, '')
    .replace(REGEX_PATTERNS.stripBlockMeta, '');

  // Pre-minify CSS inside JS template literals (design-system stylesheets)
  // so the whitespace-heavy style bundles get collapsed before Terser runs.
  const codeAfterCSS = minifyCSSInTemplateLiterals(codeToMinify);

  const minified = await terser.minify(codeAfterCSS, terserOpts);

  if (minified.error) {
    globalThis.console.error('[Build Error] Terser minification error:', minified.error);
    return false;
  }

  if (!minified?.code) {
    globalThis.console.error('[Build Error] Minification produced no output');
    return false;
  }

  // Check for warnings
  if (minified.warnings && minified.warnings.length > 0) {
    globalThis.console.warn('[Build Warning] Terser warnings:');
    minified.warnings.forEach(w => globalThis.console.warn(`  - ${w}`));
  }

  let finalCode = minified.code;

  if (minifySourceMap && minified.map) {
    const mapPath = `${outPath}.map`;
    fs.writeFileSync(mapPath, minified.map, 'utf8');
    finalCode = `${finalCode}\n//# sourceMappingURL=${path.basename(mapPath)}\n`;
    if (verbose) globalThis.console.log(`✓ Source map written: ${mapPath}`);
  }

  fs.writeFileSync(outPath, finalCode, 'utf8');

  const originalSize = Buffer.byteLength(code, 'utf8');
  const minifiedSize = Buffer.byteLength(finalCode, 'utf8');
  const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(2);
  const savedKb = ((originalSize - minifiedSize) / 1024).toFixed(2);

  globalThis.console.log(
    `✓ Minified: ${(originalSize / 1024).toFixed(2)}KB → ${(minifiedSize / 1024).toFixed(2)}KB (saved ${savedKb}KB / ${savings}%)`
  );

  if (minifyPretty) {
    globalThis.console.log('✓ Pretty minify enabled: output is formatted for readability');
  }
  if (minifySourceMap) {
    globalThis.console.log(`✓ Source map: ${path.basename(outPath)}.map`);
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

  if (verbose) globalThis.console.log(`Starting build process for ${outPath}...`);

  startPerfTimer('collectModules');
  const files = collectModuleFiles();
  const collectDuration = endPerfTimer('collectModules');
  if (verbose) {
    globalThis.console.log(
      `Found ${files.length} module(s) to merge (${collectDuration.toFixed(2)}ms)`
    );
  }

  // Merge module files
  const { code, mergedCount, skippedCount } = await mergeModuleFiles(files);

  if (skippedCount > 0) {
    globalThis.console.warn(`⚠️  Skipped ${skippedCount} module(s) due to errors or empty content`);
  }

  startPerfTimer('writeFile');
  if (dryRun) {
    globalThis.console.log(
      `  ✓ Dry-run: would write ${outPath} (${(Buffer.byteLength(code, 'utf8') / 1024).toFixed(2)}KB)`
    );
  } else {
    fs.writeFileSync(outPath, code, 'utf8');
  }
  const writeDuration = endPerfTimer('writeFile');

  const fileSize = (Buffer.byteLength(code, 'utf8') / 1024).toFixed(2);
  globalThis.console.log(
    `\n✓ Built ${path.relative(ROOT, outPath)} from ${mergedCount} modules (${fileSize}KB, ${writeDuration.toFixed(2)}ms):`
  );

  for (const f of files) {
    const filePath = typeof f === 'string' ? f : path.join(f.dir, f.name);
    const fp = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
    const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
    globalThis.console.log('  ✓', rel);
  }

  // Validate syntax
  startPerfTimer('validateSyntax');
  if (!validateSyntax(code, outPath)) {
    return false;
  }
  const validateDuration = endPerfTimer('validateSyntax');
  if (verbose) globalThis.console.log(`  ⏱️  Syntax validation: ${validateDuration.toFixed(2)}ms`);

  // Run Biome lint (skip in dry-run mode)
  startPerfTimer('biome');
  if (!dryRun && !runBiomeValidation(outPath)) {
    return false;
  }
  const biomeDuration = endPerfTimer('biome');
  if (!noLint && verbose) globalThis.console.log(`  ⏱️  Biome: ${biomeDuration.toFixed(2)}ms`);

  // Optimize or minify if requested (skip in dry-run mode)
  if ((minify || optimized) && !dryRun) {
    startPerfTimer('optimize');
    if (!(await optimizeOrMinify(code, outPath))) {
      return false;
    }
    const optimizeDuration = endPerfTimer('optimize');
    if (verbose) globalThis.console.log(`  ⏱️  Optimization: ${optimizeDuration.toFixed(2)}ms`);
  }

  const totalDuration = endPerfTimer('totalBuild');
  const dryRunTag = dryRun ? ' (dry-run)' : '';
  globalThis.console.log(
    `✓ Build completed successfully in ${(totalDuration / 1000).toFixed(2)}s${dryRunTag}`
  );

  // Save build cache for next incremental build (skip in dry-run)
  if (!watch && !dryRun) {
    buildCache.lastBuild = Date.now();
    saveBuildCache();
  }

  // Log performance summary if verbose
  if (verbose) {
    globalThis.console.log('\n📊 Performance Summary:');
    globalThis.console.log(`  Total: ${(totalDuration / 1000).toFixed(2)}s`);
    globalThis.console.log(
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
    globalThis.console.error('Build failed:', err?.message);
    if (verbose) globalThis.console.error(err?.stack);
    return false;
  }
}

if (watch) {
  buildOnceCli().then(ok => {
    if (!ok) globalThis.console.warn('Initial build failed. Still watching for fixes...');
    watchAndBuild();
  });
} else {
  buildOnceCli().then(ok => {
    if (!ok) process.exitCode = 2;
  });
}
