/**
 * Regression tests for the custom-lint timer ownership rule.
 *
 * The `no-direct-listener` rule must accept a RAW timer registration whose
 * handle is handed to the CleanupManager within a bounded lookahead
 * (ownership-by-transfer — dom-cache pollUntil, enhanced fallback,
 * playlist-search fallback, stats visibility fallback), and must still flag
 * a stray timer with no managed transfer (negative fixture).
 */

const { analyzeLines, analyzeComments } = require('../scripts/lint-custom-rules');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'lint-custom-rules.js');

describe('custom-lint timer ownership analysis', () => {
  test('ownership-by-transfer: raw setInterval with registerInterval lookahead passes', () => {
    const violations = analyzeLines('fixtures/positive.js', [
      'function pollUntil() {',
      '  const id = setInterval(() => {',
      '    if (check()) clearInterval(id);',
      '  }, 500);',
      "  window.YouTubePlusCleanupManager?.registerInterval?.(id, { scope: 'session' });",
      '}',
    ]);
    expect(violations.filter(v => v.rule === 'no-direct-listener')).toHaveLength(0);
  });

  test('stray unregistered setInterval is flagged (negative fixture)', () => {
    const violations = analyzeLines('fixtures/negative.js', [
      'function setup() {',
      '  const id = setInterval(() => tick(), 500);',
      '  // no registerInterval anywhere',
      '}',
    ]);
    const flagged = violations.filter(v => v.rule === 'no-direct-listener');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].line).toBe(2);
  });

  test('optional-chaining transfer (registerInterval?.()) is recognized', () => {
    const violations = analyzeLines('fixtures/positive-optional.js', [
      'function setup() {',
      '  state.fallbackTimerId = setInterval(() => rescan(), 800);',
      '  window.YouTubePlusCleanupManager?.registerInterval?.(state.fallbackTimerId);',
      '}',
    ]);
    expect(violations.filter(v => v.rule === 'no-direct-listener')).toHaveLength(0);
  });

  test('a different timer without transfer within the lookahead is still flagged', () => {
    const violations = analyzeLines('fixtures/negative-far.js', [
      'function setup() {',
      '  const id = setInterval(() => tick(), 500);',
      '  unrelatedCode();',
      '  window.YouTubePlusCleanupManager?.registerInterval?.(otherId);',
      '}',
    ]);
    expect(violations.filter(v => v.rule === 'no-direct-listener')).toHaveLength(1);
  });

  test('the four production timer sites are ownership-clean (no violations)', () => {
    // Mirrors the four timer registrations: each raw
    // setInterval transfers its handle to the CleanupManager.
    const cases = [
      [
        'src/dom-cache.js',
        "      const id = setInterval(() => {\n        clearInterval(id);\n      }, interval);\n      window.YouTubePlusCleanupManager?.registerInterval?.(id, {\n        scope: 'session',\n      });",
      ],
      [
        'src/enhanced.js',
        '      const rawInterval = setInterval(async () => {\n        checkButton();\n      }, 5000);\n      dislikeFallbackIntervalId = rawInterval;\n      window.YouTubePlusCleanupManager?.registerInterval?.(rawInterval);',
      ],
      [
        'src/playlist-search.js',
        '    state.observerFallbackTimerId = setInterval(() => {\n      rescan();\n    }, config.observerThrottleMs);\n    window.YouTubePlusCleanupManager?.registerInterval?.(state.observerFallbackTimerId);',
      ],
      [
        'src/stats.js',
        '      const id = setInterval(() => {\n        if (!document.hidden) callback();\n      }, delay);\n      window.YouTubePlusCleanupManager?.registerInterval?.(id);',
      ],
    ];
    for (const [file, snippet] of cases) {
      const violations = analyzeLines(file, snippet.split('\n'));
      expect(violations.filter(v => v.rule === 'no-direct-listener')).toHaveLength(0);
    }
  });
});

describe('comment slop word check', () => {
  test('flags banned words in line and block comments', () => {
    const findings = analyzeComments([
      '// The canonical source of truth.',
      ' * previously this lived elsewhere',
      'const ok = 1;',
    ]);
    expect(findings.map(f => f.word)).toEqual(['canonical', 'previously']);
    expect(findings[0].line).toBe(1);
    expect(findings[1].line).toBe(2);
  });

  test('ignores banned words outside comments (identifiers, strings, URLs)', () => {
    const findings = analyzeComments([
      'const canonical = store.load();',
      "const url = 'https://example.com/canonical';",
      'notAComment("previously");',
    ]);
    expect(findings).toHaveLength(0);
  });

  test('flags a trailing comment after code', () => {
    const findings = analyzeComments(['doThing(); // the old path']);
    expect(findings.map(f => f.word)).toEqual(['the old']);
  });

  test('flags "previous" and "previously" as distinct words', () => {
    const findings = analyzeComments([
      '// the previous wiring',
      '// previously this lived elsewhere',
    ]);
    expect(findings.map(f => f.word)).toEqual(['previous', 'previously']);
  });

  test('flags task IDs in comments and test names outside src', () => {
    const findings = analyzeComments(
      [
        '/' + '/ The fix for issue ' + 'R4-01',
        "test('" + 'T04' + " - basic navigation test', () => {});",
        "describe('Feature suite (" + 'F13' + ")', () => {});",
      ],
      'test/sample.test.js'
    );
    expect(findings).toHaveLength(3);
    expect(findings.map(f => f.word)).toEqual(['task id', 'task id', 'task id']);
  });
});

describe('the slop check is blocking', () => {
  test('exits 0 on the clean repository', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--report'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toContain('Comment slop: 0 match(es)');
  });

  test('exits 1 when a source comment contains a banned word', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-slop-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(path.join(dir, 'src', 'x.js'), '// the old path\n');
      let code = 0;
      try {
        execFileSync(process.execPath, [SCRIPT, '--report'], { cwd: dir, stdio: 'pipe' });
      } catch (error) {
        code = error.status;
      }
      expect(code).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('duplicate helper declarations ratchet check', () => {
  test('declaration in canonical owner file is permitted', () => {
    const violations = analyzeLines('src/utils.js', [
      'const logS = (err, label) => { /* canonical */ };',
    ]);
    expect(violations.filter(v => v.rule === 'duplicate-helper-declaration')).toHaveLength(0);
  });

  test('declaration outside canonical owner file is flagged when defining own implementation', () => {
    const violations = analyzeLines('src/sample-other.js', [
      'const logS = (err, label) => { /* duplicate */ };',
    ]);
    const dups = violations.filter(v => v.rule === 'duplicate-helper-declaration');
    expect(dups).toHaveLength(1);
    expect(dups[0].message).toContain('Duplicate declaration of');
    expect(dups[0].message).toContain('src/utils.js');
  });

  test('single-line delegation to owner without own body is permitted outside owner', () => {
    const violations = analyzeLines('src/sample-other.js', [
      "const logS = U.makeLogS('Sample');",
      'const escapeHTML = window.YouTubeSafeDOM.escapeHTML;',
      'const getVideoId = U.getVideoIdFromUrl;',
    ]);
    expect(violations.filter(v => v.rule === 'duplicate-helper-declaration')).toHaveLength(0);
  });

  test('arrow wrapper or function body outside owner is flagged', () => {
    const violations = analyzeLines('src/sample-other.js', [
      "const logS = (e, l) => U.logSuppressed(e, l || 'X');",
      'function escapeHTML(str) { return str; }',
    ]);
    const dups = violations.filter(v => v.rule === 'duplicate-helper-declaration');
    expect(dups).toHaveLength(2);
  });

  test('duplicate-ratchet.json baseline matches 56 total ceiling', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'duplicate-ratchet.json'), 'utf8'));
    expect(baseline.total).toBe(56);
    expect(baseline.byFunction.logS).toBe(37);
    expect(baseline.byFunction.escapeHTML).toBe(3);
    expect(baseline.byFunction.sanitizeHTML).toBe(2);
    expect(baseline.byFunction.getVideoId).toBe(3);
    expect(baseline.byFunction.getCurrentVideoId).toBe(5);
    expect(baseline.byFunction.registerListenerSafe).toBe(3);
    expect(baseline.byFunction.positionDropdown).toBe(3);
  });

  test('lint-custom-rules CLI --report-duplicates prints helper counts', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--report-duplicates'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toContain('Duplicate helper declarations: 54');
    expect(out).toContain('logS');
    expect(out).toContain('escapeHTML');
  });
});
