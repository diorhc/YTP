#!/usr/bin/env node
// @ts-check

/**
 * run-source-package-integration.js
 *
 * Full self-sufficiency proof for the source package:
 *   1. package the current tree (scripts/package-source.js);
 *   2. extract it into an isolated temp directory with a standard OS extractor;
 *   3. install dependencies from the package's OWN lockfile (npm ci);
 *   4. build the release package from the UNPACKED tree (build:release) and
 *      verify the existing artifacts;
 *   5. prove the unpacked-tree bundles are byte-identical to the ones built
 *      from the working tree.
 *
 * Steps 2–5 run strictly inside the temp directory: the unpacked tree must be
 * self-sufficient. The working tree is only the byte-comparison reference.
 *
 * Run explicitly with npm run test:source-package-integration.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function sha256(/** @type {string} */ p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function extract(/** @type {string} */ zip, /** @type {string} */ dest) {
  if (process.platform === 'win32') {
    // Prefer Windows' bsdtar (reads ZIP containers); the PATH 'tar' may be a
    // GNU tar (git-bash) that cannot. Fall back to Expand-Archive.
    const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    try {
      execFileSync(systemTar, ['-xf', zip, '-C', dest], { stdio: 'inherit' });
      return;
    } catch {
      console.warn('System32 tar extraction failed, falling back to Expand-Archive...');
    }
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}'`,
      ],
      { stdio: 'inherit' }
    );
  } else {
    // GNU tar cannot read ZIP containers — use the standard unzip tool.
    execFileSync('unzip', ['-q', zip, '-d', dest], { stdio: 'inherit' });
  }
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yp-srcpkg-int-'));
  const zip = path.join(tmp, 'source.zip');
  const unpacked = path.join(tmp, 'unpacked');
  fs.mkdirSync(unpacked, { recursive: true });
  try {
    console.log('[srcpkg-int] 1. Packaging the current tree...');
    execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'package-source.js'), '--out', zip],
      {
        cwd: ROOT,
        stdio: 'inherit',
      }
    );
    if (!fs.existsSync(zip)) throw new Error('source package was not created');

    console.log('[srcpkg-int] 2. Extracting into an isolated directory...');
    extract(zip, unpacked);

    // In-archive manifest integrity (independent of the packaging script).
    const manifest = JSON.parse(
      fs.readFileSync(path.join(unpacked, 'source-package-manifest.json'), 'utf8')
    );
    for (const f of manifest.files) {
      const p = path.join(unpacked, f.path);
      if (!fs.existsSync(p) || sha256(p) !== f.sha256) {
        throw new Error(`manifest integrity check failed for ${f.path}`);
      }
    }
    if (manifest.files.length !== manifest.entries) {
      throw new Error('manifest entry count mismatch');
    }
    console.log('  ✓ in-archive manifest verified (every entry matches its SHA-256)');

    console.log('[srcpkg-int] 3. npm ci from the package lockfile...');
    // npm provides the actual CLI path across Windows and Unix.
    const npmCli = process.env.npm_execpath;
    if (!npmCli || !fs.existsSync(npmCli)) {
      throw new Error('Run via npm run test:source-package-integration');
    }
    execFileSync(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], {
      cwd: unpacked,
      stdio: 'inherit',
    });

    console.log('[srcpkg-int] 4. Release build + verification from the unpacked tree...');
    execFileSync(process.execPath, ['scripts/release.js', 'build'], {
      cwd: unpacked,
      stdio: 'inherit',
    });
    execFileSync(process.execPath, ['scripts/release.js', 'verify'], {
      cwd: unpacked,
      stdio: 'inherit',
    });

    console.log('[srcpkg-int] 5. Byte-parity against the working-tree build...');
    for (const artifact of ['youtube.user.js', 'youtube.user.min.js']) {
      const unpackedPath = path.join(unpacked, artifact);
      const rootPath = path.join(ROOT, artifact);
      if (!fs.existsSync(rootPath)) {
        throw new Error(
          `working-tree reference artifact missing: ${artifact} (run npm run build:release first)`
        );
      }
      const same = sha256(unpackedPath) === sha256(rootPath);
      if (!same) throw new Error(`bundle mismatch for ${artifact}`);
      console.log(`  ✓ ${artifact}: byte-identical to the working-tree build`);
    }

    console.log('[srcpkg-int] SOURCE PACKAGE SELF-SUFFICIENCY PROOF PASSED');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
