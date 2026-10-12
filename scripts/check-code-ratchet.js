#!/usr/bin/env node
// Code ratchet for src/ and types/: per-file ceilings that may only go down.
//
//   complexity  biome noExcessiveCognitiveComplexity warnings
//   catches     `catch` clauses
//   anyTypes    JSDoc types that contain `any` or the `*` wildcard
//   clones      jscpd clones the file takes part in (same options as
//               `npm run check:duplication`)
//   slop        comment lines with a banned word (scripts/lint-custom-rules.js)
//
// types/*.d.ts files are tracked too: `anyTypes` counts `any` in their code.
//
//   node scripts/check-code-ratchet.js                    → enforce
//   node scripts/check-code-ratchet.js --update-baseline  → lower the ceilings
//     to the current values. It never raises a ceiling; a new file starts at
//     its current values.
//
// Do not hand-edit code-ratchet.json to make the check pass.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const acorn = require('acorn');
const { analyzeComments } = require('./lint-custom-rules');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BASELINE = path.join(ROOT, 'code-ratchet.json');
const METRICS = ['complexity', 'catches', 'anyTypes', 'clones', 'slop'];
const TYPES = path.join(ROOT, 'types');

/** @param {string[]} args */
function runNode(args) {
  try {
    return execFileSync(process.execPath, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // Both tools exit non-zero when they report findings; stdout still holds them.
    const stdout = /** @type {{ stdout?: unknown }} */ (error)?.stdout;
    return typeof stdout === 'string' ? stdout : '';
  }
}

/** @param {string} file */
const rel = file => path.relative(ROOT, path.resolve(ROOT, file)).split(path.sep).join('/');

/** @returns {Record<string, number>} */
function measureComplexity() {
  const raw = runNode([
    path.join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome'),
    'lint',
    '--only=complexity/noExcessiveCognitiveComplexity',
    '--reporter=json',
    '--max-diagnostics=none',
    'src',
  ]);
  if (!raw.trim()) throw new Error('Biome produced no JSON report for src');
  /** @type {Record<string, number>} */
  const out = {};
  for (const d of JSON.parse(raw).diagnostics || []) {
    if (d.category !== 'lint/complexity/noExcessiveCognitiveComplexity') continue;
    const file = rel(d.location.path);
    out[file] = (out[file] || 0) + 1;
  }
  return out;
}

/** @returns {Record<string, number>} */
function measureClones() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-jscpd-'));
  try {
    runNode([
      path.join(ROOT, 'node_modules', 'jscpd', 'run-jscpd.js'),
      'src',
      '--max-lines',
      '100000',
      '--min-lines',
      '5',
      '--min-tokens',
      '50',
      '--reporters',
      'json',
      '--output',
      outDir,
      '--silent',
    ]);
    const report = JSON.parse(fs.readFileSync(path.join(outDir, 'jscpd-report.json'), 'utf8'));
    /** @type {Record<string, number>} */
    const out = {};
    for (const dup of report.duplicates || []) {
      for (const side of [dup.firstFile, dup.secondFile]) {
        // jscpd reports names relative to the scanned directory.
        const file = `src/${path.basename(side.name)}`;
        out[file] = (out[file] || 0) + 1;
      }
    }
    return out;
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

/** @param {unknown} node @param {(n: any) => void} visit */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const n = /** @type {Record<string, unknown>} */ (node);
  if (typeof n.type === 'string') visit(n);
  for (const key of Object.keys(n)) {
    if (key !== 'loc') walk(n[key], visit);
  }
}

/** @param {string} source */
function countCatches(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  let count = 0;
  walk(ast, n => {
    if (n.type === 'CatchClause') count++;
  });
  return count;
}

/** @param {string} source */
function countAnyTypes(source) {
  let count = 0;
  for (const comment of source.match(/\/\*\*[\s\S]*?\*\//g) || []) {
    // Drop the leading `*` of each comment line so only the type text is tested.
    const body = comment.replace(/\n\s*\*(?!\/)/g, '\n');
    for (const type of body.match(/\{[^{}]*\}/g) || []) {
      if (/\bany\b/.test(type) || /(?:^|[{<|(,[\s])\*(?=\s*(?:[}>|),\]]|$))/.test(type)) count++;
    }
  }
  return count;
}

function measure() {
  const complexity = measureComplexity();
  const clones = measureClones();
  /** @type {Record<string, Record<string, number>>} */
  const files = {};
  for (const name of fs.readdirSync(SRC).sort()) {
    if (!name.endsWith('.js')) continue;
    const file = `src/${name}`;
    const source = fs.readFileSync(path.join(SRC, name), 'utf8');
    files[file] = {
      complexity: complexity[file] || 0,
      catches: countCatches(source),
      anyTypes: countAnyTypes(source),
      clones: clones[file] || 0,
      slop: analyzeComments(source.split('\n')).length,
    };
  }
  for (const name of fs.readdirSync(TYPES).sort()) {
    if (!name.endsWith('.d.ts')) continue;
    const source = fs.readFileSync(path.join(TYPES, name), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    files[`types/${name}`] = {
      complexity: 0,
      catches: 0,
      anyTypes: (code.match(/\bany\b/g) || []).length,
      clones: 0,
      slop: analyzeComments(source.split('\n')).length,
    };
  }
  return files;
}

/** @param {Record<string, Record<string, number>>} files */
function totals(files) {
  /** @type {Record<string, number>} */
  const sum = {};
  for (const m of METRICS) sum[m] = Object.values(files).reduce((a, f) => a + f[m], 0);
  return sum;
}

function main() {
  const update = process.argv.includes('--update-baseline');
  const current = measure();
  const baseline = fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    : { files: {} };

  if (update) {
    /** @type {Record<string, Record<string, number>>} */
    const next = {};
    for (const [file, values] of Object.entries(current)) {
      const old = baseline.files[file];
      next[file] = {};
      for (const m of METRICS) {
        next[file][m] = old && old[m] != null ? Math.min(old[m], values[m]) : values[m];
      }
    }
    fs.writeFileSync(
      BASELINE,
      `${JSON.stringify({ totals: totals(next), files: next }, null, 2)}\n`
    );
    console.log(`✓ code-ratchet.json written: ${JSON.stringify(totals(next))}`);
    return;
  }

  const failures = [];
  const lowered = [];
  for (const [file, values] of Object.entries(current)) {
    const ceiling = baseline.files[file];
    if (!ceiling) {
      failures.push(`${file}: not in code-ratchet.json (run with --update-baseline)`);
      continue;
    }
    for (const m of METRICS) {
      if (ceiling[m] == null)
        failures.push(`${file}: no ${m} ceiling (run with --update-baseline)`);
      else if (values[m] > ceiling[m]) failures.push(`${file}: ${m} ${values[m]} > ${ceiling[m]}`);
      else if (values[m] < ceiling[m]) lowered.push(`${file}: ${m} ${ceiling[m]} → ${values[m]}`);
    }
  }

  console.log(`Code ratchet: ${JSON.stringify(totals(current))}`);
  if (lowered.length) {
    console.log('Lower, run `node scripts/check-code-ratchet.js --update-baseline`:');
    for (const line of lowered) console.log(`  ${line}`);
  }
  if (failures.length) {
    console.error('✗ Code ratchet exceeded:');
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log('✓ Code ratchet holds');
}

main();
