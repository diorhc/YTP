/** @jest-environment jsdom */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ARTIFACTS, computeSha256, verifyReleasePackage } = require('../scripts/release');
const ROOT = path.resolve(__dirname, '..');
const version = require('../package.json').version;
let dir;
const manifestPath = () => path.join(dir, 'release-manifest.json');
const editManifest = edit => {
  const value = JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));
  edit(value);
  fs.writeFileSync(manifestPath(), JSON.stringify(value));
};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-release-test-'));
  for (const file of ARTIFACTS)
    fs.writeFileSync(
      path.join(dir, file),
      `// ==UserScript==\n// @version ${version}\n// @match https://www.youtube.com/*\n// @grant GM_getValue\n// ==/UserScript==\n(function () { return 1; })();\n`
    );
  fs.writeFileSync(
    manifestPath(),
    JSON.stringify({
      version,
      gitSha: null,
      lockSha256: computeSha256(path.join(ROOT, 'package-lock.json')),
      artifacts: ARTIFACTS.map(file => ({
        file,
        sha256: computeSha256(path.join(dir, file)),
        bytes: fs.statSync(path.join(dir, file)).size,
      })),
    })
  );
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
test('verification accepts a complete package without modifying it', () => {
  const before = fs.readdirSync(dir).map(file => [file, computeSha256(path.join(dir, file))]);
  expect(verifyReleasePackage({ packageDir: dir }).ok).toBe(true);
  expect(fs.readdirSync(dir).map(file => [file, computeSha256(path.join(dir, file))])).toEqual(
    before
  );
});
test.each(ARTIFACTS)('rejects modified bytes in %s', file => {
  fs.appendFileSync(path.join(dir, file), '// modified');
  expect(verifyReleasePackage({ packageDir: dir }).ok).toBe(false);
});
test.each(ARTIFACTS)('rejects missing %s', file => {
  fs.unlinkSync(path.join(dir, file));
  expect(verifyReleasePackage({ packageDir: dir }).ok).toBe(false);
});
test('rejects duplicate or unknown entries', () => {
  editManifest(value => {
    value.artifacts[1] = value.artifacts[0];
  });
  expect(verifyReleasePackage({ packageDir: dir }).ok).toBe(false);
});
test('rejects stale lockfile digest', () => {
  editManifest(value => {
    value.lockSha256 = '0'.repeat(64);
  });
  expect(verifyReleasePackage({ packageDir: dir }).ok).toBe(false);
});
test('rejects mismatched manifest version', () => {
  editManifest(value => {
    value.version = '9.9.9';
  });
  expect(verifyReleasePackage({ packageDir: dir }).ok).toBe(false);
});
test('rejects a wrong metadata version even with matching file hash', () => {
  const file = ARTIFACTS[0];
  const target = path.join(dir, file);
  fs.writeFileSync(
    target,
    fs.readFileSync(target, 'utf8').replace(`@version ${version}`, '@version 9.9.9')
  );
  editManifest(value => {
    value.artifacts[0].sha256 = computeSha256(target);
  });
  expect(verifyReleasePackage({ packageDir: dir }).errors.join(' ')).toContain('metadata version');
});
test('release tag requires matching version and an identified source commit', () => {
  expect(verifyReleasePackage({ packageDir: dir, tag: 'v9.9.9' }).ok).toBe(false);
  expect(verifyReleasePackage({ packageDir: dir, tag: `v${version}` }).ok).toBe(false);
});
test('CLI rejects a corrupted package with a nonzero exit', () => {
  fs.unlinkSync(path.join(dir, ARTIFACTS[0]));
  const result = spawnSync(process.execPath, ['scripts/release.js', 'verify', '--dir', dir], {
    cwd: ROOT,
  });
  expect(result.status).toBe(1);
});
describe('GreasyFork size band for the readable bundle', () => {
  // Short lines keep the "GreasyFork flags minified lines" rule satisfied, so
  // only the size ratio decides the verdict.
  const writeBundleOfRatio = ratio => {
    const target = path.join(dir, ARTIFACTS[0]);
    const header = `// ==UserScript==\n// @version ${version}\n// @match https://www.youtube.com/*\n// @grant GM_getValue\n// ==/UserScript==\n`;
    const budget = Math.floor(2 * 1024 * 1024 * ratio) - header.length;
    fs.writeFileSync(target, header + '// x\n'.repeat(Math.floor(budget / 5)));
    const manifest = JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));
    const entry = manifest.artifacts.find(a => a.file === ARTIFACTS[0]);
    entry.sha256 = computeSha256(target);
    entry.bytes = fs.statSync(target).size;
    fs.writeFileSync(manifestPath(), JSON.stringify(manifest));
  };
  test('accepts a bundle under 85% of the 2 MiB limit', () => {
    writeBundleOfRatio(0.8);
    expect(verifyReleasePackage({ packageDir: dir }).ok).toBe(true);
  });
  test('still accepts a bundle between 85% and 95% (warning only)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* mock */
    });
    writeBundleOfRatio(0.9);
    const result = verifyReleasePackage({ packageDir: dir });
    const warnings = warn.mock.calls.flat().join(' ');
    warn.mockRestore();
    expect(result.ok).toBe(true);
    expect(warnings).toContain('% of the size limit');
  });
  test('refuses a bundle above 95% of the 2 MiB limit', () => {
    writeBundleOfRatio(0.96);
    const result = verifyReleasePackage({ packageDir: dir });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('95% hard stop');
  });
});
