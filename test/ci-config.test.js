const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');
const workflows = fs
  .readdirSync(WORKFLOW_DIR)
  .filter(file => file.endsWith('.yml'))
  .map(file => ({ file, text: fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8') }));
const ci = fs.readFileSync(path.join(WORKFLOW_DIR, 'ci.yml'), 'utf8');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
test('package engines and lockfile stay consistent', () => {
  expect(lock.packages[''].engines).toEqual(pkg.engines);
  expect(lock.packages[''].version).toBe(pkg.version);
});
test('every third-party action is pinned to a full commit SHA', () => {
  for (const { file, text } of workflows) {
    for (const [, action, ref] of text.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@(\S+)/g)) {
      // Local reusable workflows (./path) are repository code, not actions.
      if (action.startsWith('.')) continue;
      expect({ file, ref: ref.split('#')[0].trim() }).toEqual({
        file,
        ref: expect.stringMatching(/^[0-9a-f]{40}$/),
      });
    }
  }
});
test('workflows never inherit secrets wholesale', () => {
  for (const { file, text } of workflows) {
    expect({ file, has: /\n\s*secrets:\s*inherit\b/.test(text) }).toEqual({ file, has: false });
  }
  expect(ci).not.toContain('\n  greasyfork:');
});

// CI is deliberately scoped to release, code quality and security. Tests run
// locally (`npm run verify`); they are not a gate on the pushed tree.
test('CI never runs the test suite', () => {
  for (const token of [
    'test:unit',
    'test:ci',
    'test:e2e',
    'test:release-integration',
    'test:source-package-integration',
    'check-coverage-ratchet',
    'budget:startup',
    'npm run verify',
    'jest',
    'playwright',
  ]) {
    expect({ token, present: ci.includes(token) }).toEqual({ token, present: false });
  }
});

test('code quality job typechecks, lints, checks locales and builds the release candidate', () => {
  const from = ci.indexOf('\n  code-quality:');
  const to = ci.indexOf('\n  security:', from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  const job = ci.slice(from, to);

  for (const step of [
    'node scripts/check-push-scope.js --ref HEAD',
    'npm run typecheck',
    'npm run lint',
    'npm run knip',
    'npm run check:locales',
    'node scripts/lint-custom-rules.js',
    'npm run check:code-ratchet',
    'npm run check:facade-usage',
    'node scripts/check-version-consistency.js',
    'run: npm run build:release',
    'run: npm run release:verify',
  ]) {
    expect(job).toContain(step);
  }
  // The candidate is built before its artifacts are uploaded.
  const upload = job.indexOf('name: release-assets');
  expect(upload).toBeGreaterThan(-1);
  expect(job.indexOf('run: npm run build:release')).toBeLessThan(upload);
  for (const artifact of ['youtube.user.js', 'youtube.user.min.js']) {
    expect(job).toContain(artifact);
  }
});

test('security job runs advisories and static scans', () => {
  const from = ci.indexOf('\n  security:');
  const to = ci.indexOf('\n  release:', from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  const job = ci.slice(from, to);

  expect(job).toContain('run: npm run security');
  expect(job).toContain('node scripts/security-innerhtml-scan.js');
  expect(job).toContain('node scripts/check-secrets.js');
});

test('publication requires code quality and security, an explicit version tag and verified bytes', () => {
  const release = ci.slice(ci.indexOf('\n  release:'));
  expect(release).toMatch(/needs:\s*\[\s*code-quality,\s*security\s*\]/);
  expect(release).toContain("startsWith(github.ref, 'refs/tags/')");
  expect(release).toContain('--verify-tag');
  expect(release).toContain('release.js verify --dir dist --tag');
  expect(release).not.toContain('build:release');
});
