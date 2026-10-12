#!/usr/bin/env node
// Push-scope guard: local-only paths must never reach the remote.
//
// Why this is a check and not a file shuffle: `git push` transmits commits
// that already exist, and a commit's tree is immutable. By the time a
// pre-push hook runs, the objects are built — moving files into docs/ and
// back afterwards would change nothing about what the remote receives. The
// only things a hook can do are refuse the push or rewrite history, so the
// guarantee has to live here instead, where it also protects CI.
//
// Forbidden paths are the agent's local state and the local notes folder.
// They belong on disk, never in the repository:
//
//   node scripts/check-push-scope.js              → index + work tree
//   node scripts/check-push-scope.js --ref HEAD   → one committed tree
//   node scripts/check-push-scope.js --stdin      → pre-push refs from stdin
//
// Exit 0 when the scope is clean, 1 with a per-path report otherwise.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Exact names, and directory prefixes (a trailing slash means "and below").
const FORBIDDEN = ['AGENTS.md', '.serena/', 'docs/', 'e2e/', 'graphify-out/'];

/**
 * @param {string[]} args
 * @returns {{ mode: 'index' | 'ref' | 'stdin', ref: string | null }}
 */
function parseArgs(args) {
  const refIdx = args.indexOf('--ref');
  if (refIdx !== -1) {
    const ref = args[refIdx + 1];
    if (!ref || ref.startsWith('--')) {
      console.error('✗ --ref needs a value, e.g. --ref HEAD');
      process.exit(2);
    }
    return { mode: 'ref', ref };
  }
  if (args.includes('--stdin')) return { mode: 'stdin', ref: null };
  return { mode: 'index', ref: null };
}

/** @param {string[]} args @returns {string} */
function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** @param {string} file @returns {string | null} the matching rule, or null */
function violationFor(file) {
  const normalized = file.replace(/\\/g, '/');
  for (const rule of FORBIDDEN) {
    if (rule.endsWith('/')) {
      if (normalized === rule.slice(0, -1) || normalized.startsWith(rule)) return rule;
    } else if (normalized === rule || normalized.endsWith(`/${rule}`)) {
      return rule;
    }
  }
  return null;
}

/** @param {string[]} files @param {string} label */
function report(files, label) {
  /** @type {Map<string, string[]>} */
  const hits = new Map();
  for (const file of files) {
    const rule = violationFor(file);
    if (!rule) continue;
    if (!hits.has(rule)) hits.set(rule, []);
    /** @type {string[]} */ (hits.get(rule)).push(file);
  }
  if (hits.size === 0) return true;
  console.error(`✗ Local-only paths would leave the machine (${label}):`);
  for (const [rule, matched] of hits) {
    console.error(`  ${rule} (${matched.length}):`);
    for (const file of matched.slice(0, 10)) console.error(`    ${file}`);
    if (matched.length > 10) console.error(`    … and ${matched.length - 10} more`);
  }
  console.error(
    '\nThese are untracked by design. Unstage them with\n' +
      '  git rm --cached -r -- <path>\n' +
      'and keep them in .gitignore. The files stay on disk; the repository\n' +
      'simply never learns about them.'
  );
  return false;
}

function main() {
  const { mode, ref } = parseArgs(process.argv.slice(2));

  if (mode === 'index') {
    // Everything git currently tracks, i.e. what the next commit would contain.
    const ok = report(git(['ls-files', '--cached']).split('\n').filter(Boolean), 'index');
    if (!ok) process.exit(1);
    console.log(`✓ Push scope clean (${FORBIDDEN.length} local-only rules, index + work tree)`);
    return;
  }

  if (mode === 'ref') {
    const files = git(['ls-tree', '-r', '--name-only', /** @type {string} */ (ref)]).split('\n');
    if (!report(files.filter(Boolean), String(ref))) process.exit(1);
    console.log(`✓ Push scope clean (${ref})`);
    return;
  }

  // pre-push form: stdin lines are "<local ref> <local sha> <remote ref> <remote sha>".
  const input = fs.readFileSync(0, 'utf8').trim();
  const shas = new Set(
    input
      .split('\n')
      .map(line => line.trim().split(/\s+/))
      .filter(parts => parts.length >= 2)
      .map(parts => parts[1])
  );
  if (shas.size === 0) {
    console.log('✓ Push scope clean (no refs to check)');
    return;
  }
  let ok = true;
  for (const sha of shas) {
    const files = git(['ls-tree', '-r', '--name-only', sha]).split('\n').filter(Boolean);
    ok = report(files, sha) && ok;
  }
  if (!ok) process.exit(1);
  console.log(`✓ Push scope clean (${shas.size} ref(s))`);
}

if (require.main === module) main();
module.exports = { FORBIDDEN, violationFor };
