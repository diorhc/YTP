#!/usr/bin/env node
// Coverage ratchet — freezes per-file and global coverage floors from
// coverage/coverage-summary.json into coverage-ratchet.json. CI fails when
// any tracked metric drops below its frozen floor (1pt integer tolerance).
//
// Enforces coverage floors from coverage-ratchet.json:
//   - `node scripts/check-coverage-ratchet.js`                 → enforce
//   - `node scripts/check-coverage-ratchet.js --update-baseline` → refreeze
//     after a genuine coverage improvement; review the diff.
//
// Do NOT hand-edit coverage-ratchet.json or lower floors to make CI pass.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SUMMARY = path.join(ROOT, 'coverage', 'coverage-summary.json');
const BASELINE = path.join(ROOT, 'coverage-ratchet.json');
// Coverage a browser suite writes; checked only when the report exists.
const TABVIEW_REPORT = path.join(ROOT, 'test-results', 'tabview-coverage.json');
const E2E_KEY = 'src/main#executionScript';

// Metrics tracked per file / globally. Lines tracks identically to statements
// for this codebase (v8), so it is skipped.
const METRICS = ['statements', 'branches', 'functions'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function floorPct(entry) {
  const out = {};
  for (const m of METRICS) out[m] = Math.floor(entry[m].pct);
  return out;
}

function buildBaseline(summary, existing) {
  const baseline = { global: floorPct(summary.total), files: {} };
  for (const [k, v] of Object.entries(summary)) {
    if (k === 'total') continue;
    const rel = k.replace(/^.*[\\/]src[\\/]/, 'src/').replace(/\.js$/, '');
    if (rel.startsWith('src/')) baseline.files[rel] = floorPct(v);
  }
  // The browser suite's floor is not derived from the jest summary; keep it.
  if (existing?.e2e) baseline.e2e = existing.e2e;
  return baseline;
}

/**
 * Violations for the floors that need a browser suite. Empty when the report
 * has not been generated, so a jest-only run is never blocked.
 * @returns {string[]}
 */
function e2eViolations() {
  if (!fs.existsSync(TABVIEW_REPORT)) return [];
  const floor = readJson(BASELINE)?.e2e?.[E2E_KEY]?.lines;
  if (typeof floor !== 'number') return [];
  const report = readJson(TABVIEW_REPORT);
  const actual = Math.floor(Number(report?.percentage));
  if (!Number.isFinite(actual)) return [`e2e ${E2E_KEY}: report has no percentage`];
  if (actual < floor) return [`e2e ${E2E_KEY}: lines ${actual}% < floor ${floor}%`];
  return [];
}

function main() {
  const update = process.argv.includes('--update-baseline');

  if (process.argv.includes('--update-e2e-baseline')) {
    const report = readJson(TABVIEW_REPORT);
    if (!report || typeof report.percentage !== 'number') {
      console.error(
        '✗ ' +
          path.relative(ROOT, TABVIEW_REPORT) +
          ' not found. Run `npm run test:e2e:tabview-coverage` first.'
      );
      process.exit(2);
    }
    const baseline = readJson(BASELINE) || { global: {}, files: {} };
    baseline.e2e = baseline.e2e || {};
    baseline.e2e[E2E_KEY] = { lines: Math.floor(report.percentage) };
    fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
    console.log('✓ e2e floor pinned: ' + E2E_KEY + ' lines ' + Math.floor(report.percentage) + '%');
    return;
  }

  if (!fs.existsSync(SUMMARY)) {
    console.error(
      '✗ ' + path.relative(ROOT, SUMMARY) + ' not found. Run `npx jest --coverage` first.'
    );
    process.exit(2);
  }

  if (update) {
    const summary = readJson(SUMMARY);
    fs.writeFileSync(
      BASELINE,
      JSON.stringify(buildBaseline(summary, readJson(BASELINE)), null, 2) + '\n'
    );
    console.log(
      '✓ Baseline written to ' +
        path.relative(ROOT, BASELINE) +
        ' (' +
        Object.keys(readJson(BASELINE).files).length +
        ' files)'
    );
    return;
  }

  const baseline = readJson(BASELINE);
  if (!baseline) {
    console.error(
      '✗ ' + path.relative(ROOT, BASELINE) + ' missing. Generate with --update-baseline.'
    );
    process.exit(2);
  }

  const summary = readJson(SUMMARY);
  const failures = [];

  const check = (label, floorEntry, actualEntry) => {
    for (const m of METRICS) {
      const floor = floorEntry[m];
      const actual = actualEntry[m].pct;
      if (actual < floor) {
        failures.push(
          '  ' + label + ': ' + m + ' ' + actual.toFixed(2) + '% < floor ' + floor + '%'
        );
      }
    }
  };

  check('(global)', baseline.global, summary.total);
  for (const [rel, floors] of Object.entries(baseline.files)) {
    // Summary keys are absolute paths; resolve by suffix match on src/<name>.
    const key = Object.keys(summary).find(
      k => k !== 'total' && k.replace(/^.*[\\/]src[\\/]/, 'src/').replace(/\.js$/, '') === rel
    );
    if (!key) {
      failures.push('  ' + rel + ': vanished from coverage report (file removed?)');
      continue;
    }
    check(rel, floors, summary[key]);
  }
  for (const violation of e2eViolations()) failures.push('  ' + violation);

  if (failures.length > 0) {
    console.error('✗ Coverage ratchet — ' + failures.length + ' regression(s):');
    for (const f of failures) console.error(f);
    console.error(
      '\nIf this follows a genuine refactor that RAISES coverage, run ' +
        '`node scripts/check-coverage-ratchet.js --update-baseline` and review the diff.\n' +
        'Never lower floors to make a build pass.'
    );
    if (failures.some(f => f.includes('e2e '))) {
      console.error(
        'For the tabview e2e floor, rerun `npm run test:e2e:tabview-coverage` to ' +
          'refresh the report, then `node scripts/check-coverage-ratchet.js --update-e2e-baseline`.'
      );
    }
    process.exit(1);
  }

  console.log(
    '✓ Coverage ratchet OK (' +
      Object.keys(baseline.files).length +
      ' files + global' +
      (fs.existsSync(TABVIEW_REPORT) ? ' + tabview e2e' : '') +
      ', 1pt tolerance)'
  );
}

if (require.main === module) main();

module.exports = { e2eViolations, buildBaseline };
