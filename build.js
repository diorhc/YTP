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
 *   node build.js --minify     - Build with full minification
 *   node build.js --readable-release - Compress + beautify, no name mangling
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const vm = require('vm');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { minifyCssTemplates } = require('./scripts/minify-css-templates');

// Determine project root: if this script sits in a `src` folder, use parent,
// otherwise use its directory. This prevents scanning the wrong directory
// when the script is placed in the repo root.
const ROOT =
  path.basename(__dirname) === 'src' ? path.resolve(__dirname, '..') : path.resolve(__dirname);
const OUT = path.join(ROOT, 'youtube.user.js');
// exclude basenames only (we'll search in either ROOT or ROOT/src)
const EXCLUDE = new Set(['youtube.user.js', 'userscript.js', 'build.js', 'host-policy.js']);

// Module that reads the embedded offline dictionary; the part carrying the
// dictionary is inserted right after it in the merged bundle.
const I18N_MODULE_NAME = 'i18n.js';
const EMBEDDED_DICTIONARY_GLOBAL = '__YouTubePlusEmbeddedDictionaries__';

// Watch debounce ms
const DEBOUNCE_MS = 150;

// Possible order manifest files (JSON array of filenames or plain text lines)
const ORDER_MANIFESTS = ['build.order.json', 'build.order.txt'];
// Optional manifest override (`--order <path>`), used by tests to build the
// legacy string format end to end.
let ORDER_PATH = null;

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
let pendingBuildCache = {};

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
    Object.assign(buildCache.files, pendingBuildCache);
    fs.writeFileSync(BUILD_CACHE_FILE, JSON.stringify(buildCache, null, 2), 'utf8');
    pendingBuildCache = {};
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
      pendingBuildCache[filePath] = { mtime, size: stats.size };
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

// Pre-compiled regex patterns for better performance
const USERSCRIPT_META_COMMENT_RE =
  /==UserScript==|==\/UserScript==|@name|@version|@description|@author|@license|@match|@grant|@namespace|@downloadURL|@updateURL|@supportURL|@homepageURL|@icon|@run-at|@require|@resource/;

const REGEX_PATTERNS = {
  lineStyleMeta: /\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/,
  blockStyleMeta: /\/\*[\s\S]*?==UserScript==[\s\S]*?==\/UserScript==[\s\S]*?\*\//,
  stripLineMeta: /\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/g,
  stripBlockMeta: /\/\*\s*==UserScript==[\s\S]*?==\/UserScript==\s*\*\//g,
  userscriptMetaComment: USERSCRIPT_META_COMMENT_RE,
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

// package.json is the single hand-edited version: the header @version is
// always written from it, so a release bump never touches userscript.js.
{
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  header = header.replace(/^(\/\/\s*@version\s+)\S+/m, `$1${pkgVersion}`);
}

// Get module files
/** Hosts the bundle knows how to run on. `other` hosts run nothing. */
const KNOWN_HOSTS = ['youtube', 'myactivity'];

/**
 * Normalize one manifest entry's host list. A missing list means youtube-only.
 * @param {unknown} hosts
 * @param {string} name
 * @returns {string[]}
 */
function normalizeHosts(hosts, name) {
  if (hosts === undefined) return ['youtube'];
  if (!Array.isArray(hosts) || hosts.length === 0) {
    throw new Error(
      `[Build Error] Module "${name}" has an invalid "hosts"; expected a non-empty array of ${KNOWN_HOSTS.join('/')}.`
    );
  }
  for (const host of hosts) {
    if (!KNOWN_HOSTS.includes(host)) {
      throw new Error(
        `[Build Error] Module "${name}" lists unknown host "${host}"; allowed hosts: ${KNOWN_HOSTS.join(', ')}.`
      );
    }
  }
  return [...new Set(hosts)];
}

/**
 * Parse an order manifest into `{name, hosts}` entries. Accepts both the
 * legacy string array and the object form; unknown hosts fail the build.
 * @param {string} raw
 * @param {boolean} isJson
 * @returns {Array<{name: string, hosts: string[]}>}
 */
function parseOrderManifest(raw, isJson) {
  if (!isJson) {
    return raw
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(name => ({ name, hosts: ['youtube'] }));
  }
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) {
    throw new Error('[Build Error] build.order.json must be an array.');
  }
  return arr.map((entry, index) => {
    if (typeof entry === 'string') {
      const name = entry.trim();
      if (!name) {
        throw new Error(`[Build Error] build.order.json entry ${index} is an empty name.`);
      }
      return { name, hosts: ['youtube'] };
    }
    if (entry && typeof entry === 'object' && typeof entry.name === 'string' && entry.name.trim()) {
      const name = entry.name.trim();
      return { name, hosts: normalizeHosts(entry.hosts, name) };
    }
    throw new Error(
      `[Build Error] build.order.json entry ${index} must be a string or { name, hosts }.`
    );
  });
}

/**
 * Reads and validates the order manifest.
 * @returns {Array<{name: string, hosts: string[]}>|null} Entries or null when no manifest exists
 */
function readOrderManifest() {
  const candidates = ORDER_PATH
    ? [path.isAbsolute(ORDER_PATH) ? ORDER_PATH : path.resolve(process.cwd(), ORDER_PATH)]
    : ORDER_MANIFESTS.map(name => path.join(ROOT, name));
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    let raw;
    try {
      raw = fs.readFileSync(p, 'utf8');
    } catch (e) {
      globalThis.console.error(`[Build Error] Failed to read order manifest ${p}:`, e.message);
      return null;
    }
    // Validation errors propagate: an unknown host or a malformed entry must
    // fail the build, never silently fall back to the default ordering.
    return parseOrderManifest(raw, p.endsWith('.json'));
  }
  if (verbose) {
    globalThis.console.warn('[Build Warning] No order manifest found. Using default ordering.');
  }
  return null;
}

/**
 * The host policy, emitted before the first module so every gate can consult
 * it. Mirrors the `utils.js` policy: `other` runs nothing; a module with no
 * table entry runs on youtube only.
 * @param {Array<{name: string, hosts: string[]}>} files
 * @returns {string}
 */
function buildHostPolicyPrelude(files) {
  /** @type {Record<string, string[]>} */
  const table = {};
  for (const f of files) table[f.name] = f.hosts;
  // Inline the single-source policy module and bind the manifest table. `module`
  // is undefined in the bundle, so its CommonJS export guard is skipped.
  const source = fs.readFileSync(path.join(ROOT, 'src', 'host-policy.js'), 'utf8').trim();
  return [
    '// --- HOST POLICY (src/host-policy.js, inlined) ---',
    '(function () {',
    source,
    `  window.YouTubePlusHostPolicy = createHostPolicy(${JSON.stringify(table)});`,
    '})();',
    '',
  ].join('\n');
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
    for (const entry of manifest) {
      if (rest.has(entry.name)) {
        ordered.push({ ...rest.get(entry.name), hosts: entry.hosts });
        rest.delete(entry.name);
      } else {
        throw new Error(
          `[Build Error] Module "${entry.name}" listed in build.order.json but not found in src/. ` +
            `Remove it from build.order.json or add the missing file.`
        );
      }
    }
    const others = Array.from(rest.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (others.length > 0) {
      throw new Error(
        `[Build Error] ${others.length} module(s) in src/ not listed in build.order.json: ${others.map(f => f.name).join(', ')}. ` +
          `Add them to build.order.json to define their load order.`
      );
    }
    return ordered;
  }

  // Default: put main.js first, then alphabetically by basename, preserving dirs
  files.sort((a, b) => {
    if (a.name === 'main.js') return -1;
    if (b.name === 'main.js') return 1;
    return a.name.localeCompare(b.name);
  });
  return files.map(f => ({ ...f, hosts: ['youtube'] }));
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
// Readable release: compress + beautify but NO name mangling at all, so the
// published userscript keeps every identifier (local, function, property)
// exactly as written in src/. GreasyFork serves these bytes verbatim, so a
// stack trace or a DOM property dump in a user report must be greppable
// against the repository.
if (args.includes('--optimized')) {
  globalThis.console.error('[Build Error] Unknown build mode --optimized; use --readable-release.');
  process.exit(1);
}
const readableRelease = args.includes('--readable-release');
// Dry-run: build everything but skip writing output (useful for CI validation)
const dryRun = args.includes('--dry-run');
if (minify || readableRelease) {
  noLint = true;
  if (verbose) {
    globalThis.console.log(
      'Minified/readable build requested: skipping lint validation and post-processing the merged source'
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

// Order manifest override: --order <path> (tests build the legacy string form).
const orderIdx = args.findIndex(a => a === '--order' || a === '-O');
if (orderIdx !== -1 && args.length > orderIdx + 1) {
  ORDER_PATH = path.resolve(process.cwd(), args[orderIdx + 1]);
}

/**
 * Generates the bundle part carrying the offline English dictionary.
 * The runtime trusts the payload only after the same SHA-256 verification as
 * network delivery, so the build must reject a locales/en.json whose canonical
 * digest does not match the delivery manifest baked into src/i18n.js — a
 * stale or tampered dictionary is a build error, never a silently degraded
 * runtime.
 * @returns {string}
 */
function buildEmbeddedDictionaryPart() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'en.json'), 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('locales/en.json must contain an object of string translations');
  }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') {
      throw new Error(`locales/en.json entry "${key}" is not a string translation`);
    }
  }
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  const digest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

  const i18nSource = fs.readFileSync(path.join(ROOT, 'src', I18N_MODULE_NAME), 'utf8');
  const manifestBlock = i18nSource.match(
    /AUTO-GENERATED-START: LOCALE_DELIVERY_MANIFEST[\s\S]*?AUTO-GENERATED-END: LOCALE_DELIVERY_MANIFEST/
  );
  if (!manifestBlock) {
    throw new Error('Locale delivery manifest block not found in src/i18n.js');
  }
  const expectedDigest = manifestBlock[0].match(/"en":\s*"([0-9a-f]{64})"/)?.[1];
  if (!expectedDigest) {
    throw new Error('English locale digest not found in the locale delivery manifest');
  }
  if (digest !== expectedDigest) {
    throw new Error(
      `locales/en.json digest ${digest} does not match the delivery manifest ${expectedDigest}; ` +
        'run node scripts/sync-locale-metadata.js'
    );
  }
  return (
    `// --- EMBEDDED LOCALE: locales/en.json (digest verified at build time) ---\n` +
    `globalThis.${EMBEDDED_DICTIONARY_GLOBAL} = Object.freeze({\n` +
    `  en: Object.freeze({ data: ${canonical} })\n` +
    '});'
  );
}

/**
 * Runs a module in its own block. A synchronous throw while the module
 * initializes is reported once, and the modules after it still load.
 * @param {string} name - Module file name
 * @param {string} code - Module source
 * @returns {string} Wrapped source
 */
function wrapModule(name, code) {
  const message = JSON.stringify(`[YouTube+] ${name} failed to initialize`);
  // Gate first: the module body only runs on a host its manifest entry allows.
  // With no policy loaded, only youtube runs (fail-closed).
  const gate = `if (window.YouTubePlusHostPolicy ? window.YouTubePlusHostPolicy.runs(${JSON.stringify(name)}) : (window.location && /(^|\\.)youtube\\.com$/i.test(String(window.location.hostname || "")))) {`;
  return `${gate}\n  try {\n${code}\n  } catch (error) {\n    console.error(${message}, error);\n  }\n}`;
}

/**
 * Merges module files into a single output string
 * @param {Array} files - Array of file objects
 * @returns {{code: string, mergedCount: number, skippedCount: number, changedCount: number}} Merged code and stats
 */
async function mergeModuleFiles(files) {
  startPerfTimer('mergeModuleFiles');

  const parts = [header.trim(), '\n'];
  parts.push(
    buildHostPolicyPrelude(files.map(f => ({ name: f.name, hosts: f.hosts || ['youtube'] })))
  );
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
    parts.push(wrapModule(displayName, clean));
    if (verbose) globalThis.console.log(`  ✓ Merged: ${displayName}`);
    mergedCount++;
  }

  // The embedded dictionary is part of the produced bundle, so a missing
  // insertion point must fail the build instead of silently shipping raw
  // keys as the offline fallback.
  const i18nPartIndex = parts.indexOf(`// --- MODULE: ${I18N_MODULE_NAME} ---`);
  if (i18nPartIndex === -1) {
    throw new Error(
      `Module ${I18N_MODULE_NAME} was not merged; the build cannot embed the English dictionary fallback`
    );
  }
  // Before i18n.js: the module requests English synchronously during its own
  // initialization, so the payload must already be assigned by then.
  parts.splice(i18nPartIndex, 0, buildEmbeddedDictionaryPart());

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
      readableRelease
        ? 'Building readable release (compress + beautify, no mangling)...'
        : minify
          ? 'Minifying output...'
          : 'Optimizing output (strip comments/whitespace)...'
    );
  }

  try {
    if (readableRelease) {
      return await performReadableRelease(code, outPath);
    }

    return await performTerserMinification(code, outPath);
  } catch (e) {
    globalThis.console.error('[Build Error] Minification failed:', e?.message);
    if (verbose) globalThis.console.error(e?.stack);
    return false;
  }
}

/**
 * Replace leading indentation (Terser's 2 spaces per level) with tabs so the
 * beautified readable bundle stays inside GreasyFork's size band. A line that
 * begins inside a template literal is string content and is left untouched; the
 * AST is used to find those ranges.
 * @param {string} code
 * @returns {string}
 */
function reindentWithTabs(code) {
  const acorn = require('acorn');
  /** @type {Array<[number, number]>} */
  const templateRanges = [];
  try {
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (
        node.type === 'TemplateLiteral' &&
        typeof node.start === 'number' &&
        typeof node.end === 'number'
      ) {
        templateRanges.push([node.start, node.end]);
      }
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) {
          for (const item of value) walk(item);
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
          walk(value);
        }
      }
    };
    walk(ast);
    templateRanges.sort((a, b) => a[0] - b[0]);
  } catch (_e) {
    // Unparseable output is left verbatim rather than risk corrupting it.
    return code;
  }

  /** @param {number} offset */
  const inTemplate = offset => {
    let lo = 0;
    let hi = templateRanges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [start, end] = templateRanges[mid];
      if (offset < start) hi = mid - 1;
      else if (offset >= end) lo = mid + 1;
      else return true;
    }
    return false;
  };

  const out = [];
  let offset = 0;
  for (const line of code.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    out.push(
      inTemplate(lineStart) ? line : line.replace(/^(?: {2})+/, m => '\t'.repeat(m.length / 2))
    );
  }
  return out.join('\n');
}

/**
 * Builds the readable release bundle: Terser compression only, with mangling
 * switched off entirely (no local renames, no property renames) and the output
 * beautified. The userscript metadata block is preserved as the preamble and
 * the userscript header comments are kept, so the published file is
 * byte-comparable with src/ by name.
 *
 * The unoptimized merged source is still written next to the bundle: it is the
 * exact input Terser consumed, which is what a reviewer needs when the
 * compressed output misbehaves.
 * @param {string} code - Merged source
 * @param {string} outPath - Output file path
 * @returns {Promise<boolean>} True if successful
 */
async function performReadableRelease(code, outPath) {
  if (verbose) globalThis.console.log('Running readable release build (compress, no mangle)');

  const debugPath = outPath.replace(/\.js$/, '.unoptimized.js');
  fs.writeFileSync(debugPath, code, 'utf8');
  globalThis.console.log(`✓ Wrote unoptimized code to ${path.basename(debugPath)} for debugging`);

  try {
    const terser = require('terser');

    // The header is re-emitted through format.preamble, so drop the copy the
    // merge embedded to avoid a duplicated metadata block.
    const codeToOptimize = code
      .replace(REGEX_PATTERNS.stripLineMeta, '')
      .replace(REGEX_PATTERNS.stripBlockMeta, '');

    const codeAfterCSS = minifyCssTemplates(codeToOptimize);

    // Console output is part of the published behavior, and `pure_funcs`
    // would otherwise delete log/info/debug calls from the shipped file.
    const compress = {
      ...getTerserCompressOptions(),
      drop_console: false,
      pure_funcs: [],
      keep_classnames: true,
      keep_fnames: true,
      keep_infinity: true,
      toplevel: true,
    };

    const result = await terser.minify(codeAfterCSS, {
      compress,
      // No mangling: every identifier and every property name survives
      // verbatim. This is the whole point of the readable release.
      mangle: false,
      format: {
        // Keep the userscript header comments, drop the rest.
        comments: USERSCRIPT_META_COMMENT_RE,
        preamble: header.trim(),
        beautify: true,
        braces: true,
        semicolons: true,
        indent_level: 2,
        wrap_iife: true,
        ecma: 2020,
      },
      parse: { ecma: 2020 },
      ecma: 2020,
      module: false,
      toplevel: false,
      keep_classnames: true,
      keep_fnames: true,
    });

    if (result.error || !result.code) {
      globalThis.console.error(
        '[Build Error] Readable release build failed:',
        result.error || 'Build produced no output'
      );
      return false;
    }

    // Tabs instead of Terser's 2-space indent shrink the published readable
    // bundle without touching template-literal content.
    const output = reindentWithTabs(result.code);
    fs.writeFileSync(outPath, output, 'utf8');

    const originalSize = Buffer.byteLength(code, 'utf8');
    const readableSize = Buffer.byteLength(output, 'utf8');
    const savings = ((1 - readableSize / originalSize) * 100).toFixed(2);

    globalThis.console.log(
      `✓ Readable release: ${(originalSize / 1024).toFixed(2)}KB → ${(readableSize / 1024).toFixed(2)}KB (compressed ${savings}%, names preserved)`
    );
    return true;
  } catch (e) {
    globalThis.console.error('[Build Error] Readable release build failed:', e.message);
    if (verbose) globalThis.console.error(e.stack);
    return false;
  }
}

/**
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
    passes: minify ? 6 : 3, // More passes for better results
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
  const baseOptions = {
    comments: minify ? USERSCRIPT_META_COMMENT_RE : 'some',
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
  const codeAfterCSS = minifyCssTemplates(codeToMinify);

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
 * Log summary and list of merged module files
 * @param {Array<string|{ dir: string, name: string }>} files
 * @param {number} mergedCount
 * @param {string} fileSize
 * @param {number} writeDuration
 * @param {string} outPath
 */
function logBuiltFilesSummary(files, mergedCount, fileSize, writeDuration, outPath) {
  globalThis.console.log(
    `\n✓ Built ${path.relative(ROOT, outPath)} from ${mergedCount} modules (${fileSize}KB, ${writeDuration.toFixed(2)}ms):`
  );
  for (const f of files) {
    const filePath = typeof f === 'string' ? f : path.join(f.dir, f.name);
    const fp = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
    const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
    globalThis.console.log('  ✓', rel);
  }
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
  logBuiltFilesSummary(files, mergedCount, fileSize, writeDuration, outPath);

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

  // Minify or readable release if requested (skip in dry-run mode)
  if ((minify || readableRelease) && !dryRun) {
    startPerfTimer('optimize');
    if (!(await optimizeOrMinify(code, outPath))) {
      return false;
    }
    const optimizeDuration = endPerfTimer('optimize');
    if (verbose) globalThis.console.log(`  ⏱️  Optimization: ${optimizeDuration.toFixed(2)}ms`);
  }

  // NOTE: release-manifest.json is generated by scripts/release.js
  // after build:release completes both readable and minified builds.
  // Single-invocation manifests are no longer written here to avoid overwrite races.

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

if (require.main === module) {
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
}

// Test-facing surface: manifest parsing/validation and the module wrapper.
module.exports = {
  KNOWN_HOSTS,
  normalizeHosts,
  parseOrderManifest,
  readOrderManifest,
  buildHostPolicyPrelude,
  wrapModule,
};
