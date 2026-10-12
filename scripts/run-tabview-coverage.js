#!/usr/bin/env node
// @ts-check
// Measures how much of src/main.js#executionScript the tabview e2e specs run.
// The tabview core executes in the page realm, where jest sees almost none of
// it. This builds the unminified bundle (so the injected text is byte-identical
// to src/main.js), runs the tabview specs in Chromium with `page.coverage`, and
// maps the coverage back to src/main.js lines. Run after `npx jest --coverage`
// so the ratchet can check the written floor.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { e2eViolations } = require('./check-coverage-ratchet');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'test-results');
const WORK_DIR = path.join(ROOT, 'coverage-temp');
// Playwright clears `test-results/` when a run starts, so the bundle and the raw
// rows live under `coverage-temp/`; only the report uses `test-results/`.
const BUNDLE = path.join(WORK_DIR, 'tabview-coverage.user.js');
const RAW = path.join(WORK_DIR, 'tabview-coverage.raw.jsonl');
const REPORT = path.join(OUT_DIR, 'tabview-coverage.json');
const SPECS = [
  'e2e/tabview-lifecycle.spec.js',
  'e2e/tabview-user-scenarios.spec.js',
  'e2e/tabview-stress.spec.js',
];

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function buildBundle() {
  // `--no-lint` only skips Biome on the merged output; the code is unchanged.
  const result = spawnSync(process.execPath, ['build.js', '--no-lint', '--out', BUNDLE], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) fail('could not build the unminified bundle');
}

function runSpecs() {
  const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  const result = spawnSync(
    process.execPath,
    [cli, 'test', ...SPECS, '--workers=1', '--reporter=line'],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        TABVIEW_COVERAGE: '1',
        TEST_BUNDLE_PATH: BUNDLE,
        TABVIEW_COVERAGE_OUT: RAW,
      },
    }
  );
  if (result.status !== 0) fail('tabview e2e specs failed');
}

/** @returns {{ rows: Array<{ firstLine: number, lastLine: number, lines: number[] }> }} */
function readRows() {
  if (!fs.existsSync(RAW)) fail('no coverage rows collected (is page.coverage available?)');
  const text = fs.readFileSync(RAW, 'utf8').trim();
  if (!text) fail('no coverage rows collected');
  const parsed = text
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const error = parsed.find(row => row.error);
  if (error) fail(`coverage mapping failed: ${error.error}`);
  return { rows: parsed };
}

/** @param {Array<{ firstLine: number, lastLine: number, lines: number[] }>} rows */
function summarize(rows) {
  const firstLine = Math.min(...rows.map(row => row.firstLine));
  const lastLine = Math.max(...rows.map(row => row.lastLine));
  const covered = new Set();
  for (const row of rows) for (const line of row.lines) covered.add(line);

  const totalLines = lastLine - firstLine + 1;
  let coveredLines = 0;
  for (let line = firstLine; line <= lastLine; line++) {
    if (covered.has(line)) coveredLines++;
  }
  /** @type {Array<{ start: number, end: number, lines: number }>} */
  const uncoveredRanges = [];
  let runStart = -1;
  for (let line = firstLine; line <= lastLine + 1; line++) {
    const missing = line <= lastLine && !covered.has(line);
    if (missing) {
      if (runStart < 0) runStart = line;
    } else if (runStart >= 0) {
      uncoveredRanges.push({ start: runStart, end: line - 1, lines: line - runStart });
      runStart = -1;
    }
  }
  uncoveredRanges.sort((a, b) => b.lines - a.lines || a.start - b.start);
  const percentage = totalLines ? (coveredLines / totalLines) * 100 : 0;
  return {
    firstLine,
    lastLine,
    coveredLines,
    totalLines,
    percentage,
    uncoveredRanges: uncoveredRanges.slice(0, 10),
  };
}

function writeReport() {
  const { rows } = readRows();
  const summary = summarize(rows);
  const payload = {
    source: 'src/main.js#executionScript',
    sourceURL: 'debug://tabview-youtube/tabview.execution.js',
    bundle: path.relative(ROOT, BUNDLE).replace(/\\/g, '/'),
    coveredLines: summary.coveredLines,
    totalLines: summary.totalLines,
    percentage: Number(summary.percentage.toFixed(2)),
    uncoveredRanges: summary.uncoveredRanges,
  };
  fs.writeFileSync(REPORT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `✓ Tabview e2e coverage of src/main.js#executionScript: ${summary.coveredLines}/${summary.totalLines} lines (${summary.percentage.toFixed(2)}%)`
  );
  for (const range of payload.uncoveredRanges) {
    console.log(`  uncovered ${range.start}-${range.end} (${range.lines} lines)`);
  }
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.rmSync(RAW, { force: true });
  fs.rmSync(REPORT, { force: true });
  buildBundle();
  runSpecs();
  writeReport();
  const violations = e2eViolations();
  if (violations.length) fail(violations.join('; '));
}

if (require.main === module) main();

module.exports = { summarize };
