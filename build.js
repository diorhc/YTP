const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const vm = require('vm');

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

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}
function extractMeta(content) {
  if (!content) return null;
  // Match either a // style userscript meta block or a /* */ block
  const lineStyle = /\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/;
  const blockStyle = /\/\*[\s\S]*?==UserScript==[\s\S]*?==\/UserScript==[\s\S]*?\*\//;
  const m1 = content.match(lineStyle);
  if (m1) return m1[0];
  const m2 = content.match(blockStyle);
  if (m2) return m2[0];
  return null;
}

function stripMeta(content) {
  if (!content) return '';
  // remove any userscript meta blocks so they don't duplicate in modules
  return content
    .replace(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/g, '')
    .replace(/\/\*\s*==UserScript==[\s\S]*?==\/UserScript==\s*\*\//g, '');
}

// Read header metadata
let header = null;
const userMetaPath = path.join(ROOT, 'userscript.js');
const existingMetaPath = path.join(ROOT, 'youtube.user.js');

const userMetaContent = readFileSafe(userMetaPath);
if (userMetaContent) header = extractMeta(userMetaContent);
if (!header) {
  const existing = readFileSafe(existingMetaPath);
  if (existing) header = extractMeta(existing);
}

if (!header) {
  console.warn(
    'Warning: metadata block not found in userscript.js or youtube.user.js. A default header will be used.'
  );
  header = `// ==UserScript==\n// @name YouTube + UserScript (built)\n// @version 0.0\n// ==/UserScript==\n`;
}

// Get module files
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
      console.warn('Failed to read order manifest', p, e && e.message);
    }
  }
  return null;
}

function collectModuleFiles() {
  const srcDir = path.join(ROOT, 'src');
  const useSrc = fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory();
  const baseDir = useSrc ? srcDir : ROOT;

  // Recursively walk directory and collect .js files (exclude build & output)
  function walk(dir) {
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
  }

  const files = walk(baseDir);

  // If manifest order exists, use it for ordering by basename (keep path from files)
  const manifest = readOrderManifest();
  if (manifest) {
    const rest = new Map(files.map(f => [f.name, f]));
    const ordered = [];
    for (const name of manifest) {
      if (rest.has(name)) {
        ordered.push(rest.get(name));
        rest.delete(name);
      }
    }
    const others = Array.from(rest.values()).sort((a, b) => a.name.localeCompare(b.name));
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
    watcher.on('all', (event, filePath) => {
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
    const watcher = fs.watch(watchDir, { recursive: false }, (eventType, filename) => {
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
const noEslint = args.includes('--no-eslint');
const verbose = args.includes('--verbose') || args.includes('-v');
const minify = args.includes('--minify') || args.includes('-m');

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

// Wrap buildOnce to use OUT_PATH
async function buildOnceCli() {
  try {
    return await buildOnceCustom(OUT_PATH);
  } catch (err) {
    console.error('Build failed:', err.message);
    if (verbose) console.error(err.stack);
    return false;
  }
}

// New buildOnce variant that accepts out path (async for minification)
async function buildOnceCustom(outPath) {
  if (verbose) console.log(`Starting build process for ${outPath}...`);

  const files = collectModuleFiles();
  if (verbose) console.log(`Found ${files.length} module(s) to merge`);

  const parts = [header.trim(), '\n'];
  for (const f of files) {
    const p = path.join(f.dir || ROOT, f.name || f);
    const content = readFileSafe(p);
    if (content === null) {
      if (verbose) console.warn(`Warning: Could not read ${p}`);
      continue;
    }
    const clean = stripMeta(content).trim();
    const displayName = f.name || f;
    parts.push(`// --- MODULE: ${displayName} ---`);
    parts.push(clean);
    if (verbose) console.log(`  ✓ Merged: ${displayName}`);
  }

  const out = parts.join('\n\n') + '\n';
  fs.writeFileSync(outPath, out, 'utf8');
  console.log(`Built ${outPath} from ${files.length} modules:`);
  for (const f of files) {
    const fp = path.join(f.dir || ROOT, f.name || f);
    const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
    console.log(' -', rel);
  }

  // Syntax check using vm
  if (verbose) console.log('Running syntax validation...');
  try {
    new vm.Script(out, { filename: outPath });
    console.log('Basic syntax check passed (vm.Script)');
  } catch (e) {
    console.error('Syntax check failed:', e && e.message);
    return false;
  }

  // If local eslint exists, run it (optional). If not, try to install it.
  if (noEslint) {
    if (verbose) console.log('Skipping ESLint (--no-eslint flag)');
  } else {
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
    if (eslintPath && fs.existsSync(eslintPath)) {
      try {
        console.log('Running eslint...');
        // Prefer flat config if present
        const flatConfig = path.join(ROOT, 'eslint.config.cjs');
        if (fs.existsSync(flatConfig)) {
          if (verbose) console.log(`Using flat config: ${flatConfig}`);
          // Flat config is auto-loaded by ESLint; avoid incompatible flags
          execSync(`"${eslintPath}" "${outPath}"`, { stdio: 'inherit' });
        } else {
          const configPath = path.join(ROOT, '.eslintrc.cjs');
          if (fs.existsSync(configPath)) {
            execSync(`"${eslintPath}" --config "${configPath}" "${outPath}"`, { stdio: 'inherit' });
          } else {
            execSync(`"${eslintPath}" "${outPath}"`, { stdio: 'inherit' });
          }
        }
        if (verbose) console.log('ESLint validation passed');
        console.log('ESLint passed');
      } catch {
        console.error('ESLint reported problems (non-zero exit)');
        return false;
      }
    }
  }

  // Minify if requested
  if (minify) {
    if (verbose) console.log('Minifying output...');
    try {
      const terser = require('terser');
      const minified = await terser.minify(out, {
        compress: {
          dead_code: true,
          drop_console: false,
          drop_debugger: true,
          keep_classnames: true,
          keep_fnames: true,
        },
        mangle: false,
        format: {
          comments:
            /==UserScript==|==\/UserScript==|@name|@version|@description|@author|@license|@match|@grant/,
          preamble: header.trim(),
        },
      });

      if (minified.code) {
        fs.writeFileSync(outPath, minified.code, 'utf8');
        const originalSize = Buffer.byteLength(out, 'utf8');
        const minifiedSize = Buffer.byteLength(minified.code, 'utf8');
        const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(2);
        console.log(
          `Minified: ${(originalSize / 1024).toFixed(2)}KB → ${(minifiedSize / 1024).toFixed(2)}KB (saved ${savings}%)`
        );
      }
    } catch (e) {
      console.warn('Minification failed:', e.message);
      if (verbose) console.error(e);
    }
  }

  console.log('Done.');
  return true;
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
