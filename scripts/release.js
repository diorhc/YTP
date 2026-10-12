#!/usr/bin/env node

// Build once; verify and publish those exact bytes. No database is needed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = ['youtube.user.js', 'youtube.user.min.js'];
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// GreasyFork publishable band for the readable bundle: warn early, refuse late.
const GREASYFORK_WARN_RATIO = 0.85;
const GREASYFORK_HARD_LIMIT_RATIO = 0.95;
const computeSha256 = file =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
/**
 * @param {{ packageDir?: string, tag?: string }} [options]
 */
function verifyReleasePackage({ packageDir = ROOT, tag } = {}) {
  const errors = [];
  try {
    const manifest = readJson(path.join(packageDir, 'release-manifest.json'));
    const pkg = readJson(path.join(ROOT, 'package.json'));
    if (!STABLE_VERSION.test(manifest.version) || manifest.version !== pkg.version) {
      errors.push('Release version must match the stable package.json version');
    }
    if (manifest.lockSha256 !== computeSha256(path.join(ROOT, 'package-lock.json')))
      errors.push('Lockfile hash mismatch');
    if (tag !== undefined) {
      if (tag !== `v${manifest.version}`) errors.push('Tag/version mismatch');
      if (!/^[a-f0-9]{40,64}$/.test(manifest.gitSha || '') || manifest.gitSha !== gitHead()) {
        errors.push('Release commit does not match the checked-out tag');
      }
    }
    if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== ARTIFACTS.length) {
      errors.push('Both release artifacts are required exactly once');
    }
    for (const file of ARTIFACTS) {
      const entries = (manifest.artifacts || []).filter(entry => entry.file === file);
      if (entries.length !== 1) {
        errors.push(`Missing or duplicate artifact: ${file}`);
        continue;
      }
      const entry = entries[0];
      const target = path.join(packageDir, file);
      const bytes = fs.readFileSync(target);
      if (entry.sha256 !== computeSha256(target) || entry.bytes !== bytes.length)
        errors.push(`Artifact hash/size mismatch: ${file}`);
      const code = bytes.toString('utf8');
      const header = code.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==/m)?.[0];
      if (!header || header.match(/^\/\/\s*@version\s+(\S+)/m)?.[1] !== manifest.version)
        errors.push(`Userscript metadata version mismatch: ${file}`);
      if (!header?.includes('@match') || !header?.includes('@grant'))
        errors.push(`Incomplete metadata: ${file}`);
      if (file === ARTIFACTS[0]) {
        // GreasyFork: code length is capped at 2 MiB characters, and any line
        // over 5000 characters containing "function" is flagged as minified.
        // The publishable band is narrow, so warn at 85% and refuse at 95%
        // instead of discovering the hard cap during publication.
        const chars = Array.from(code).length;
        const limit = 2 * 1024 * 1024;
        const percent = (chars / limit) * 100;
        if (chars > limit * GREASYFORK_HARD_LIMIT_RATIO) {
          errors.push(
            `GreasyFork userscript uses ${percent.toFixed(1)}% of the 2 MiB limit, above the ${GREASYFORK_HARD_LIMIT_RATIO * 100}% hard stop`
          );
        } else if (chars > limit * GREASYFORK_WARN_RATIO) {
          console.warn(
            `Warning: GreasyFork userscript uses ${percent.toFixed(1)}% of the size limit`
          );
        }
        if (code.split('\n').some(line => line.length > 5000 && line.includes('function'))) {
          errors.push('GreasyFork userscript contains a line GreasyFork flags as minified');
        }
      }
      new vm.Script(code, { filename: file });
    }
    return {
      ok: errors.length === 0,
      errors,
      version: manifest.version,
      artifacts: manifest.artifacts,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [...errors, msg] };
  }
}
async function buildRelease(outputDir = ROOT) {
  const pkg = readJson(path.join(ROOT, 'package.json'));
  const lock = readJson(path.join(ROOT, 'package-lock.json'));
  if (
    !STABLE_VERSION.test(pkg.version) ||
    lock.version !== pkg.version ||
    lock.packages[''].version !== pkg.version
  ) {
    throw new Error('package.json and package-lock.json must have the same stable version');
  }
  fs.mkdirSync(outputDir, { recursive: true });
  // The readable bundle (compress + beautify, no name mangling) is the file
  // GreasyFork serves and the one a user report is read against; GitHub also
  // gets it, plus the fully minified build. The compressed readable output has
  // no long minified lines, so it passes GreasyFork's minification check.
  /** @type {Array<[string, string[]]>} */
  const buildTargets = [
    [ARTIFACTS[0], ['--readable-release']],
    [ARTIFACTS[1], ['--minify']],
  ];
  for (const [file, flags] of buildTargets) {
    execFileSync(process.execPath, ['build.js', ...flags, '--out', path.join(outputDir, file)], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  }
  const manifest = {
    version: pkg.version,
    gitSha: gitHead(),
    lockSha256: computeSha256(path.join(ROOT, 'package-lock.json')),
    artifacts: ARTIFACTS.map(file => ({
      file,
      sha256: computeSha256(path.join(outputDir, file)),
      bytes: fs.statSync(path.join(outputDir, file)).size,
    })),
  };
  fs.writeFileSync(
    path.join(outputDir, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  const result = verifyReleasePackage({ packageDir: outputDir });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  console.log(`Release ${pkg.version}: both artifacts verified`);
}
async function main() {
  try {
    const option = flag => {
      const index = process.argv.indexOf(flag);
      if (index < 0) return undefined;
      if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--'))
        throw new Error(`Missing value: ${flag}`);
      return process.argv[index + 1];
    };
    const outputDir = path.resolve(option('--dir') || process.env.RELEASE_STAGING_DIR || ROOT);
    if (process.argv[2] === 'build') await buildRelease(outputDir);
    else if (process.argv[2] === 'verify') {
      const result = verifyReleasePackage({ packageDir: outputDir, tag: option('--tag') });
      if (!result.ok) throw new Error(result.errors.join('\n'));
      console.log(`Release ${result.version}: artifact integrity verified`);
    } else
      throw new Error(
        'Usage: node scripts/release.js build|verify [--dir directory] [--tag vX.Y.Z]'
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { ARTIFACTS, computeSha256, verifyReleasePackage, buildRelease };
