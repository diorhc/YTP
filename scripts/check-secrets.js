#!/usr/bin/env node
/**
 * check-secrets.js
 *
 * Blocks potential hardcoded secrets in src/ (port of the former inline CI grep,
 * so the same check runs locally via `npm run ci` and in CI one-to-one).
 *
 * 1. Named secrets: token/key/secret assigned a long literal value.
 * 2. Credential-shaped literals (JWTs, API keys): 40+ chars containing a dot
 *    segment, regardless of variable naming.
 *
 * Allowlist: Supabase anon key in src/voting.js (public by design, RLS-enforced
 * server-side; see allowlist comment at its declaration) and the i18n
 * setting-path descriptors `key: 'styles.*'` in settings-helpers.js.
 *
 * Exit 0 = clean, exit 1 = potential secret found.
 */
// @ts-check

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
// Targeted allowlist: only the exact public Supabase anonymous key string
// (intentionally embedded in client code for RLS-enforced public API access;
// see src/voting.js). Whole-file exclusions are forbidden.
const ALLOWLISTED_LITERALS = new Set([
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkcGNjb2N4bHJkc3llamZocnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMTAyNDYsImV4cCI6MjA4Nzc4NjI0Nn0.QfwrAG4SMJBPLoP-Mcq3hETQXt0ezinoi0CpN57Zn90',
]);

const NAMED_SECRET = /(token|key|secret)\s*[:=]\s*["'][A-Za-z0-9_.-]{25,}/;
const CREDENTIAL_LITERAL = /["'][A-Za-z0-9_.-]{40,}[.][A-Za-z0-9_.-]{6,}["']/;
// Targeted span allowlist: exempt specific i18n descriptors (e.g. key: 'styles.*')
// without whole-line bypass so extraneous secrets on the same line are detected (A15).
const I18N_DESCRIPTOR_PATTERN = /\bkey\s*:\s*['"`]styles\.[A-Za-z0-9_.-]+['"`]/g;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') return [];
      return walk(fullPath);
    }
    return entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

function scanContent(content, filename = 'test.js') {
  const findings = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    // Literal-level allowlisting: strip out specific allowed public literals from the line,
    // so that only the allowed literal itself is exempted. If any other secret or credential
    // appears on the same line, it will still be detected without whole-line bypass.
    let sanitizedLine = line;
    for (const lit of ALLOWLISTED_LITERALS) {
      if (sanitizedLine.includes(lit)) {
        sanitizedLine = sanitizedLine.split(lit).join('"__ALLOWLISTED_PUBLIC_LITERAL__"');
      }
    }

    // Span-level allowlisting: replace legitimate i18n setting path descriptors with a short placeholder
    // so they do not trigger NAMED_SECRET while preventing line-wide bypass of real secrets (A15).
    sanitizedLine = sanitizedLine.replace(I18N_DESCRIPTOR_PATTERN, 'key: "__ALLOWED_I18N__"');

    if (NAMED_SECRET.test(sanitizedLine)) {
      findings.push(`${filename}:${i + 1}: potential named secret`);
    }
    if (CREDENTIAL_LITERAL.test(sanitizedLine)) {
      findings.push(`${filename}:${i + 1}: credential-shaped literal`);
    }
  });
  return findings;
}

function run() {
  const findings = [];
  const scanTargets = [SRC_DIR];

  for (const dir of scanTargets) {
    for (const file of walk(dir)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf8');
      findings.push(...scanContent(content, rel));
    }
  }

  if (findings.length > 0) {
    console.error('::error::Potential secrets found:');
    for (const finding of findings) console.error(`  ${finding}`);
    process.exit(1);
  }

  console.log('✅ Secret check passed');
}

module.exports = {
  scanContent,
  ALLOWLISTED_LITERALS,
  run,
};

if (require.main === module) {
  run();
}
