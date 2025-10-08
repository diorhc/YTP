const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
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
  } catch (e) {
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
          .map((s) => s.trim())
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
  const useSrc =
    fs.existsSync(srcDir) &&
    fs.statSync(srcDir).isDirectory() &&
    fs.readdirSync(srcDir).some((f) => f.endsWith('.js'));
  const baseDir = useSrc ? srcDir : ROOT;
  let files = fs.readdirSync(baseDir).filter((f) => f.endsWith('.js') && !EXCLUDE.has(f));
  // If manifest order exists, use it for ordering
  const manifest = readOrderManifest();
  if (manifest) {
    const ordered = [];
    const rest = new Set(files);
    for (const name of manifest) {
      if (rest.has(name)) {
        ordered.push(name);
        rest.delete(name);
      }
    }
    const others = Array.from(rest).sort();
    return ordered.concat(others).map((fn) => ({ name: fn, dir: baseDir }));
  }
  // put main.js first if present
  files = files.sort((a, b) => {
    if (a === 'main.js') return -1;
    if (b === 'main.js') return 1;
    return a.localeCompare(b);
  });
  return files.map((fn) => ({ name: fn, dir: baseDir }));
}

function buildOnce() {
  // Delegate to buildOnceCustom using default OUT
  return buildOnceCustom(OUT);
}

function watchAndBuild() {
  let timer = null;
  const watcher = fs.watch(ROOT, { recursive: false }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.js')) return;
    if (EXCLUDE.has(filename)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      console.log('Change detected, rebuilding...');
      buildOnce();
    }, DEBOUNCE_MS);
  });
  console.log('Watching for file changes...');
  return watcher;
}

// CLI flags
const args = process.argv.slice(2);
const watch = args.includes('--watch') || args.includes('-w');

// Output override: --out <path> or -o <path>
let OUT_PATH = OUT;
const outIdx = args.findIndex((a) => a === '--out' || a === '-o');
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
function buildOnceCli() {
  const prevOut = OUT;
  try {
    // override OUT for this run
    const originalOut = OUT_PATH;
    // replace global OUT used inside buildOnce by writing to OUT_PATH via closure
    // We'll simply adjust fs.writeFileSync target by temporarily setting a local variable
    // so modify buildOnce to use OUT_PATH variable instead of OUT.
    return buildOnceCustom(OUT_PATH);
  } finally {
    // no-op
  }
}

// New buildOnce variant that accepts out path
function buildOnceCustom(outPath) {
  const files = collectModuleFiles();
  const parts = [header.trim(), '\n'];
  for (const f of files) {
    const p = path.join(f.dir || ROOT, f.name || f);
    const content = readFileSafe(p);
    if (content === null) continue;
    const clean = stripMeta(content).trim();
    const displayName = f.name || f;
    parts.push(`// --- MODULE: ${displayName} ---`);
    parts.push(clean);
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
  try {
    new vm.Script(out, { filename: outPath });
    console.log('Basic syntax check passed (vm.Script)');
  } catch (e) {
    console.error('Syntax check failed:', e && e.message);
    return false;
  }

  // If local eslint exists, run it (optional). If not, try to install it.
  let eslintPath = path.join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'eslint.cmd' : 'eslint'
  );
  if (!fs.existsSync(eslintPath)) {
    eslintPath = ensureLocalEslint();
  }
  if (eslintPath && fs.existsSync(eslintPath)) {
    try {
      console.log('Running eslint...');
      // Prefer flat config if present
      const flatConfig = path.join(ROOT, 'eslint.config.cjs');
      if (fs.existsSync(flatConfig)) {
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
      console.log('ESLint passed');
    } catch (e) {
      console.error('ESLint reported problems (non-zero exit)');
      return false;
    }
  }

  console.log('Done.');
  return true;
}

if (watch) {
  const ok = buildOnceCli();
  if (!ok) console.warn('Initial build failed. Still watching for fixes...');
  watchAndBuild();
} else {
  const ok = buildOnceCli();
  if (!ok) process.exitCode = 2;
}
