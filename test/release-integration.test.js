/**
 * Real release integration test.
 *
 * Unlike test/release-package.test.js (hermetic unit fixtures for the
 * verifier), this suite executes the REAL release pipeline exactly as the
 * release chain does:
 *
 *   1. `npm run build:release` with RELEASE_STAGING_DIR pointing at a fresh,
 *      empty temp directory (proves the pipeline works without files left by
 *      a previous run);
 *   2. verifies the assembled package bytes with scripts/release.js —
 *      the verifier must NOT rebuild anything (checked via byte snapshots);
 *   3. negative controls at the process level: a tampered bundle byte and a
 *      deleted mandatory artifact must exit non-zero.
 *
 * Collected only when RUN_RELEASE_INTEGRATION=1, which `npm run
 * test:release-integration` sets; a plain `jest` run does not collect this
 * file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { verifyReleasePackage, computeSha256 } = require('../scripts/release');

const ROOT = path.resolve(__dirname, '..');

const PACKAGE_FILES = ['youtube.user.js', 'youtube.user.min.js', 'release-manifest.json'];

describe('Release integration: build once, then verify the built bytes', () => {
  jest.setTimeout(900000);

  let stagingDir;

  const packageSnapshot = dir => {
    const snapshot = {};
    for (const file of PACKAGE_FILES) {
      snapshot[file] = computeSha256(path.join(dir, file));
    }
    return snapshot;
  };

  const copyPackage = target => {
    fs.mkdirSync(target, { recursive: true });
    for (const file of PACKAGE_FILES) {
      fs.copyFileSync(path.join(stagingDir, file), path.join(target, file));
    }
    return target;
  };

  beforeAll(() => {
    stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-relint-'));
    // The staging directory starts empty: the pipeline must not depend on
    // artifacts left by any previous run.
    expect(fs.readdirSync(stagingDir)).toHaveLength(0);

    // Invoke the release pipeline directly through node: spawning npm.cmd
    // requires shell:true on Windows (CVE-2024-27980 mitigation, EINVAL), and
    // passing args with shell:true triggers DEP0190. The npm script wiring is
    // asserted separately by test/ci-config.test.js.
    execFileSync(process.execPath, [path.join('scripts', 'release.js'), 'build'], {
      cwd: ROOT,
      env: { ...process.env, RELEASE_STAGING_DIR: stagingDir },
      stdio: 'inherit',
      shell: false,
    });
  });

  afterAll(() => {
    if (stagingDir && fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  });

  test('fresh build:release assembles a complete package in the staging directory', () => {
    for (const file of PACKAGE_FILES) {
      expect(fs.existsSync(path.join(stagingDir, file))).toBe(true);
    }

    const manifest = JSON.parse(
      fs.readFileSync(path.join(stagingDir, 'release-manifest.json'), 'utf8')
    );
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(manifest.version).toBe(pkg.version);

    // The built bundle must carry the same version as the package metadata.
    const bundleHeader = fs
      .readFileSync(path.join(stagingDir, 'youtube.user.js'), 'utf8')
      .slice(0, 4000);
    const headerVersion = bundleHeader.match(/@version\s+(\S+)/);
    expect(headerVersion).not.toBeNull();
    expect(headerVersion[1]).toBe(pkg.version);
  }, 900000);

  test('verifier accepts the freshly built package and does not rebuild any bytes', () => {
    const before = packageSnapshot(stagingDir);

    const result = verifyReleasePackage({ packageDir: stagingDir });
    expect(result.ok).toBe(true);
    expect(result.version).toBe(
      JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
    );
    expect(result.artifacts).toHaveLength(2);

    // Promotion verifies bytes in place; nothing may be regenerated.
    const after = packageSnapshot(stagingDir);
    expect(after).toEqual(before);
  }, 120000);

  test('promotion CLI exits non-zero when one bundle byte is altered', () => {
    const tampered = copyPackage(fs.mkdtempSync(path.join(os.tmpdir(), 'yp-relint-tamper-')));
    const minPath = path.join(tampered, 'youtube.user.min.js');
    fs.writeFileSync(minPath, `${fs.readFileSync(minPath, 'utf8')}\n// tampered byte`, 'utf8');

    let exitCode = 0;
    try {
      execFileSync(process.execPath, ['scripts/release.js', 'verify', '--dir', tampered], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    } catch (err) {
      exitCode = err.status ?? 0;
    }
    expect(exitCode).not.toBe(0);

    fs.rmSync(tampered, { recursive: true, force: true });
  }, 120000);

  test('promotion CLI exits non-zero when a mandatory artifact is missing', () => {
    const broken = copyPackage(fs.mkdtempSync(path.join(os.tmpdir(), 'yp-relint-missing-')));
    fs.unlinkSync(path.join(broken, 'youtube.user.js'));

    let exitCode = 0;
    try {
      execFileSync(process.execPath, ['scripts/release.js', 'verify', '--dir', broken], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    } catch (err) {
      exitCode = err.status ?? 0;
    }
    expect(exitCode).not.toBe(0);

    fs.rmSync(broken, { recursive: true, force: true });
  }, 120000);
});
