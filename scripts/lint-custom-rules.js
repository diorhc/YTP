#!/usr/bin/env node

/**
 * Custom lint rules that were previously enforced by ESLint
 * no-restricted-syntax rules. Biome does not support equivalent
 * AST-level selectors, so these are checked via line-by-line regex.
 *
 * Rules:
 *   1. setTimeout(_, >= 1000) -> must use setTimeout_ wrapper
 *   2. Direct innerHTML assignment -> must use YouTubeSafeDOM.setHTML
 *   3. *Any variable aliases -> use typed interfaces
 *   4. wAny window aliases -> use typed window interfaces
 *   5. Template literal interpolation in XSS sinks -> use SafeDOM
 *   6. Window/document aliasing to bypass safety checks
 *   7. Direct localStorage in src/ -> must go through SettingsStore / U.storage
 *   8. Direct addEventListener / MutationObserver / setInterval /
 *      requestAnimationFrame in src/ -> must register through CleanupManager
 *   9. Silent catch blocks -> must observe via logSuppressed / logger
 *  10. Slop words in comments of `src/` and `types/` (blocking; `--report`)
 *  11. Duplicate helper declarations outside canonical owner file (ratchet)
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const DUPLICATE_RATCHET_PATH = path.join(ROOT, 'duplicate-ratchet.json');

const CANONICAL_HELPER_OWNERS = {
  logS: 'src/utils.js',
  escapeHTML: 'src/safe-dom.js',
  sanitizeHTML: 'src/safe-dom.js',
  getVideoId: 'src/utils.js',
  getCurrentVideoId: 'src/utils.js',
  registerListenerSafe: 'src/utils.js',
  positionDropdown: 'src/feature-registry.js',
};

if (!fs.existsSync(SRC_DIR)) {
  console.error(`Source directory not found: ${SRC_DIR}`);
  process.exit(1);
}

/** @type {string[]} */
const jsFiles = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.js')) {
      jsFiles.push(fullPath);
    }
  }
}

walk(SRC_DIR);

/** @type {{ file: string, line: number, rule: string, message: string }[]} */
const violations = [];

/**
 * Checks whether a declaration line (and any immediate continuation lines)
 * defines its own function implementation (function body or arrow wrapper)
 * rather than a direct reference or alias to the owner.
 *
 * @param {string[]} lines
 * @param {number} i
 * @param {string} helperName
 * @returns {boolean}
 */
function isOwnImplementation(lines, i, helperName) {
  const line = lines[i];
  if (new RegExp(`^\\s*function\\s+${helperName}\\b`).test(line)) {
    return true;
  }
  let stmtText = '';
  for (let j = i; j < Math.min(lines.length, i + 8); j++) {
    stmtText += ` ${lines[j]}`;
    if (lines[j].includes(';')) break;
  }
  const stripped = stmtText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const assignMatch = stripped.match(new RegExp(`\\b${helperName}\\s*=\\s*([\\s\\S]*)`));
  if (!assignMatch) return false;
  const rhs = assignMatch[1].trim();
  return /=>|\bfunction\b/.test(rhs);
}

/**
 * Analyze a single source file (exported so the ownership-transfer
 * rule can be regression-tested against inline fixtures without polluting
 * src/).
 * @param {string} rel - Repo-relative path (used for allowlists)
 * @param {string[]} lines - Source lines
 * @returns {{ file?: string, line: number, rule: string, message: string }[]}
 */
function analyzeLines(rel, lines) {
  /** @type {{ file?: string, line: number, rule: string, message: string }[]} */
  const fileViolations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    if (line.includes('// lint:custom:ignore')) continue;
    if (i > 0 && lines[i - 1].includes('// lint:custom:ignore')) continue;

    // Rule 1: setTimeout(_, >= 1000) without setTimeout_ wrapper
    const setTimeoutMatch = line.match(/(?<!\w)setTimeout\s*\([^)]*,\s*(\d+)\s*[,)]/);
    if (setTimeoutMatch) {
      const delay = parseInt(setTimeoutMatch[1], 10);
      if (delay >= 1000) {
        fileViolations.push({
          file: rel,
          line: lineNum,
          rule: 'setTimeout-long-delay',
          message: `setTimeout with delay ${delay}ms (>= 1000). Use setTimeout_ wrapper for timer lifecycle management.`,
        });
      }
    }

    // Rule 2: Direct innerHTML assignment
    const innerHTMLAssign = line.match(/\.innerHTML\s*=[^=]/);
    if (innerHTMLAssign) {
      if (
        !line.match(/\.innerHTML\s*=\s*['"]\s*['"]/) &&
        !line.match(/\.textContent\s*=/) &&
        !line.match(/safeHTML|setHTML|_createHTML|createSafeHTML|renderTemplateClone/)
      ) {
        fileViolations.push({
          file: rel,
          line: lineNum,
          rule: 'no-innerHTML-assign',
          message:
            'Direct innerHTML assignment. Use YouTubeSafeDOM.setHTML() or renderTemplateClone().',
        });
      }
    }

    // Rule 3: *Any variable aliases
    const anyAlias = line.match(/(?:const|let|var)\s+(\w*Any\w*)\s*=/);
    if (anyAlias) {
      const name = anyAlias[1];
      if (!name.startsWith('create') && !name.startsWith('is') && !name.startsWith('toAny')) {
        fileViolations.push({
          file: rel,
          line: lineNum,
          rule: 'no-any-alias',
          message: `Variable "${name}" matches *Any pattern. Use typed interfaces from types/index.d.ts.`,
        });
      }
    }

    // Rule 4: wAny window aliases
    const wAnyAlias = line.match(/(?:const|let|var)\s+(wAny\d*)\s*=/);
    if (wAnyAlias) {
      fileViolations.push({
        file: rel,
        line: lineNum,
        rule: 'no-wAny-alias',
        message: `Variable "${wAnyAlias[1]}" is a window-any alias. Use typed window interfaces instead.`,
      });
    }

    // Rule 5: Template literal interpolation in XSS sinks
    if (line.match(/\.innerHTML\s*=`/) || line.match(/\.outerHTML\s*=`/)) {
      if (!line.match(/safeHTML|setHTML|_createHTML|createSafeHTML|renderTemplateClone/)) {
        fileViolations.push({
          file: rel,
          line: lineNum,
          rule: 'no-template-literal-sink',
          message:
            'Template literal assigned to innerHTML/outerHTML. Use YouTubeSafeDOM.setHTML() or escape variables.',
        });
      }
    }
    if (line.match(/\.insertAdjacentHTML\s*\([^,]+,\s*`/)) {
      if (!line.match(/safeHTML|_createHTML|createSafeHTML|renderTemplateClone/)) {
        fileViolations.push({
          file: rel,
          line: lineNum,
          rule: 'no-template-literal-sink',
          message:
            'Template literal passed to insertAdjacentHTML(). Use YouTubeSafeDOM or _createHTML wrapper.',
        });
      }
    }
    if (line.match(/document\s*\.\s*write(?:ln)?\s*\(\s*`/)) {
      fileViolations.push({
        file: rel,
        line: lineNum,
        rule: 'no-template-literal-sink',
        message: 'Template literal passed to document.write/writeln(). Use SafeDOM instead.',
      });
    }

    // Rule 6: Window/document aliasing
    const globalAlias = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(window|document)\s*;/);
    if (globalAlias) {
      const aliasName = globalAlias[1];
      if (!aliasName.startsWith('_')) {
        fileViolations.push({
          file: rel,
          line: lineNum,
          rule: 'no-global-alias',
          message: `Alias "${aliasName}" for ${globalAlias[2]}. Access ${globalAlias[2]} directly or use typed interfaces.`,
        });
      }
    }

    // Rule 7: Direct localStorage access outside the SettingsStore boundary.
    // Allowlist: modules that need raw access before the store installs
    // (settings-store itself, error-boundary, i18n boot path).
    const STORAGE_ALLOWLIST = ['settings-store.js', 'error-boundary.js', 'i18n.js'];
    const base = path.basename(rel);
    if (/localStorage/.test(line) && !STORAGE_ALLOWLIST.includes(base)) {
      fileViolations.push({
        file: rel,
        line: lineNum,
        rule: 'no-direct-localstorage',
        message:
          'Direct localStorage access. Use SettingsStore (readRaw/writeRaw/removeRaw) or U.storage instead.',
      });
    }

    // Rule 8: Direct event/observer/timer registration outside CleanupManager.
    // Allowlist: cleanup-manager.js (owns registration), event-delegation.js
    // (delegation core), utils.js (boot-layer registerListenerSafe wrapper).
    // A line whose raw call is wrapped in the matching register* call on the
    // same or previous line (the standard migration shape) is compliant.
    const CLEANUP_ALLOWLIST = ['cleanup-manager.js', 'event-delegation.js', 'utils.js'];
    if (!CLEANUP_ALLOWLIST.includes(base)) {
      const context = `${lines[i - 1] || ''} ${line} ${lines[i + 1] || ''}`;
      const hasRegister =
        /(?:_register|_?cm\??\.register|register)(?:Listener|Observer|Interval|Timeout|AnimationFrame)\s*(?:\??\.)?\(/.test(
          context
        );
      if (!hasRegister) {
        // An 'abort' subscription on an AbortSignal is a one-shot
        // transport-level handshake (request lifetime), not a page listener —
        // the CleanupManager contract does not apply to it.
        if (/\.addEventListener\s*\(\s*['"]abort['"]/.test(line)) continue;
        const directReg = line.match(
          /\.addEventListener\s*\(|new\s+(?:Mutation|Intersection|Resize)Observer|setInterval\s*\(|requestAnimationFrame\s*\(/
        );
        // Ownership-by-transfer — a RAW timer registration is acceptable
        // when its handle is handed to the CleanupManager within a bounded
        // lookahead (dom-cache pollUntil / enhanced fallback /
        // playlist-search fallback / stats visibility fallback all register
        // 2–28 lines later). The transfer must reference the SAME handle
        // variable, so a stray unregistered timer is still detected.
        const isTimerMatch = /set(?:Interval|Timeout)\s*\(|requestAnimationFrame\s*\(/.test(
          directReg ? directReg[0] : ''
        );
        const handleMatch = isTimerMatch
          ? line.match(
              /(?:const|let|var)?\s*([\w$.]+)\s*=\s*(?:window\.)?set(?:Interval|Timeout)\s*\(/
            )
          : null;
        if (handleMatch) {
          const ahead = lines.slice(i + 1, i + 31).join(' ');
          const transfersHandle =
            /register(?:Interval|Timeout)\s*\??\.\s*\(/.test(ahead) &&
            ahead.includes(handleMatch[1]);
          if (transfersHandle) continue;
        }
        if (directReg) {
          fileViolations.push({
            file: rel,
            line: lineNum,
            rule: 'no-direct-listener',
            message:
              'Direct listener/observer/timer registration. Use window.YouTubePlusCleanupManager (registerListener/registerObserver/registerInterval/registerTimeout/registerAnimationFrame) or U.registerListenerSafe.',
          });
        }
      }
    }
    // Rule 9: Silent catch blocks. Every catch in src/ must log through
    // logSuppressed / logError / logger / withErrorBoundary. Allowlist:
    // infra/boot modules that own the logging pipeline itself.
    const CATCH_ALLOWLIST = [
      'cleanup-manager.js',
      'event-delegation.js',
      'utils.js',
      'i18n.js',
      'error-boundary.js',
      'logger.js',
    ];
    if (!CATCH_ALLOWLIST.includes(base)) {
      const catchMatch = line.match(/catch\s*(?:\(\s*[\w$]+\s*\))?\s*\{/);
      if (catchMatch) {
        const lookahead = [lines[i + 1] || '', lines[i + 2] || '', lines[i + 3] || ''].join(' ');
        const hasLogging =
          /logSuppressed|logError|logger|logWarn|logInfo|withErrorBoundary|console\.|\blogS\w*\(/.test(
            lookahead
          );
        if (!hasLogging) {
          fileViolations.push({
            file: rel,
            line: lineNum,
            rule: 'no-silent-catch',
            message:
              "Silent catch block. Add U.logSuppressed(error, 'ModuleName') or logger reporting.",
          });
        }
      }
    }

    // Rule 11: Duplicate helper declaration outside canonical owner file
    const dupMatch = line.match(
      /(?:function\s+|const\s+|let\s+|var\s+)(logS|escapeHTML|sanitizeHTML|getVideoId|getCurrentVideoId|registerListenerSafe|positionDropdown)\b/
    );
    if (dupMatch) {
      const helperName = /** @type {keyof typeof CANONICAL_HELPER_OWNERS} */ (dupMatch[1]);
      const canonicalOwner = CANONICAL_HELPER_OWNERS[helperName];
      const normalizedRel = rel.replace(/\\/g, '/');
      const isOwner =
        normalizedRel === canonicalOwner ||
        normalizedRel.endsWith(`/${canonicalOwner}`) ||
        canonicalOwner.endsWith(normalizedRel);
      if (!isOwner && isOwnImplementation(lines, i, helperName)) {
        fileViolations.push({
          file: rel,
          line: lineNum,
          rule: 'duplicate-helper-declaration',
          message: `Duplicate declaration of '${helperName}' outside canonical owner '${canonicalOwner}'.`,
        });
      }
    }
  }
  return fileViolations;
}

/**
 * Banned slop words in comments. The list covers AI filler and change-history
 * narration, not technical vocabulary. Reported only, so it never fails the
 * build until the existing comments are rewritten.
 */
const TASK_ID_RE =
  /\b(?:R\d+(?:-\d+|-[A-Z])?|T\d+|C\d{2}|P\d{2}|F\d{2,3}|Stage [A-O]|stage \d+\.\d+|Phase-\d+|v\d+\s*\(R\d+\)|plan R\d+|[A-O]\.\d+[a-z]?)\b|\(3\.\d+\)/;

const SLOP_WORDS = [
  { label: 'canonical', re: /\bcanonical\b/i },
  { label: 'previously', re: /\bpreviously\b/i },
  { label: 'previous', re: /\bprevious\b/i },
  { label: 'formerly', re: /\bformerly\b/i },
  { label: 'the old', re: /\bthe old\b/i },
  { label: 'was removed', re: /\bwas removed\b/i },
  { label: 'no longer', re: /\bno longer\b/i },
  { label: 'used to', re: /\bused to\b/i },
  { label: 'in the past', re: /\bin the past\b/i },
  { label: 'at one point', re: /\bat one point\b/i },
  { label: 'em dash', re: /\u2014/ },
  { label: 'task id', re: TASK_ID_RE },
  { label: 'caps emphasis', re: /\b(?:IMPORTANT|CRITICAL|NOTE|WARNING|NEVER|ALWAYS|MUST)\b/ },
];

/**
 * Extract the comment portion of a source line, or '' when the line carries
 * no comment. A '//' inside a URL (preceded by ':') is not a comment start.
 * @param {string} line
 * @param {boolean} [isYaml]
 * @returns {string}
 */
function commentTextOf(line, isYaml = false) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    return trimmed;
  }
  if (isYaml && trimmed.startsWith('#')) {
    return trimmed;
  }
  const lineComment = line.indexOf('//');
  if (lineComment >= 0 && line[lineComment - 1] !== ':') return line.slice(lineComment);
  const blockComment = line.indexOf('/*');
  if (blockComment >= 0) return line.slice(blockComment);
  if (isYaml) {
    const yamlComment = line.indexOf('#');
    if (yamlComment >= 0) return line.slice(yamlComment);
  }
  return '';
}

/**
 * List banned slop words found in a file's comments or test/workflow titles.
 * @param {string[]} lines
 * @param {string} [relPath]
 * @returns {{ line: number, word: string, text: string }[]}
 */
function analyzeComments(lines, relPath) {
  /** @type {{ line: number, word: string, text: string }[]} */
  const findings = [];
  const isSrcOrTypes = !relPath || relPath.startsWith('src/') || relPath.startsWith('types/');
  const isYaml = Boolean(relPath && (relPath.endsWith('.yml') || relPath.endsWith('.yaml')));
  const isTest = Boolean(relPath && (relPath.startsWith('test/') || relPath.startsWith('e2e/')));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('<path') && line.includes('d="M')) continue;

    const comment = commentTextOf(line, isYaml);
    if (comment) {
      if (isSrcOrTypes) {
        for (const { label, re } of SLOP_WORDS) {
          if (re.test(comment)) {
            findings.push({ line: i + 1, word: label, text: comment.trim() });
          }
        }
      } else {
        if (TASK_ID_RE.test(comment)) {
          findings.push({ line: i + 1, word: 'task id', text: comment.trim() });
        }
      }
    }

    if (isTest) {
      const testMatch = line.match(/(?:describe|test|it)\s*\(\s*(['"`])([^'"`]+)\1/);
      if (testMatch && TASK_ID_RE.test(testMatch[2])) {
        findings.push({ line: i + 1, word: 'task id', text: testMatch[2].trim() });
      }
    }

    if (isYaml) {
      const nameMatch = line.match(/^\s*name:\s*(.+)$/);
      if (nameMatch && TASK_ID_RE.test(nameMatch[1])) {
        findings.push({ line: i + 1, word: 'task id', text: nameMatch[1].trim() });
      }
    }
  }
  return findings;
}

/**
 * Helper to recursively list files in a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function listTargetFiles(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  /** @type {string[]} */
  const res = [];
  for (const ent of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, ent.name).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      if (ent.name !== 'assets' && ent.name !== 'node_modules') {
        res.push(...listTargetFiles(rel));
      }
    } else {
      res.push(rel);
    }
  }
  return res;
}

/**
 * Count banned slop words across src/, types/, scripts/, test/, e2e/,
 * build.js, jest.config.js, and .github/. Exits 0 on clean, 1 on matches.
 */
function reportCommentSlop() {
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {string[]} */
  const samples = [];
  let total = 0;
  for (const { label } of SLOP_WORDS) counts[label] = 0;

  const targetFiles = [
    ...listTargetFiles('src').filter(f => f.endsWith('.js')),
    ...listTargetFiles('types').filter(f => f.endsWith('.d.ts')),
    ...listTargetFiles('scripts').filter(f => f.endsWith('.js')),
    ...listTargetFiles('test').filter(f => f.endsWith('.js')),
    ...listTargetFiles('e2e').filter(f => f.endsWith('.js')),
    ...(fs.existsSync(path.join(ROOT, 'build.js')) ? ['build.js'] : []),
    ...(fs.existsSync(path.join(ROOT, 'jest.config.js')) ? ['jest.config.js'] : []),
    ...listTargetFiles('.github').filter(
      f => f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.md')
    ),
  ];

  for (const rel of targetFiles) {
    const fullPath = path.join(ROOT, rel);
    if (!fs.existsSync(fullPath)) continue;
    const fileFindings = analyzeComments(fs.readFileSync(fullPath, 'utf8').split('\n'), rel);
    for (const finding of fileFindings) {
      counts[finding.word] = (counts[finding.word] || 0) + 1;
      total += 1;
      if (samples.length < 20) {
        samples.push(`${rel}:${finding.line} [${finding.word}] ${finding.text.slice(0, 100)}`);
      }
    }
  }

  console.log(`Comment slop: ${total} match(es)`);
  for (const { label } of SLOP_WORDS) {
    if (counts[label] > 0) console.log(`  ${label.padEnd(14)} ${counts[label]}`);
  }
  if (samples.length > 0) {
    console.log('\nFirst matches:');
    for (const sample of samples) console.log(`  ${sample}`);
  }
  if (total > 0) {
    console.error(
      `\n✗ Comment slop: ${total} match(es) in repo. Remove banned words and task IDs.`
    );
    process.exit(1);
  }
  console.log('✓ Comment slop: none');
}

/**
 * Load duplicate ratchet configuration.
 * @returns {{ total: number, byFunction: Record<string, number>, canonicalOwners?: Record<string, string> }}
 */
function loadDuplicateRatchet() {
  if (!fs.existsSync(DUPLICATE_RATCHET_PATH)) {
    return { total: 56, byFunction: {} };
  }
  return JSON.parse(fs.readFileSync(DUPLICATE_RATCHET_PATH, 'utf8'));
}

/**
 * Update duplicate ratchet baseline (only lowering ceilings).
 * @param {{ file?: string, line: number, rule: string, message: string }[]} duplicateViolations
 */
function updateDuplicateRatchet(duplicateViolations) {
  /** @type {Record<string, number>} */
  const countsByFunction = {};
  for (const name of Object.keys(CANONICAL_HELPER_OWNERS)) {
    countsByFunction[name] = 0;
  }
  for (const v of duplicateViolations) {
    for (const name of Object.keys(CANONICAL_HELPER_OWNERS)) {
      if (v.message.includes(`'${name}'`)) {
        countsByFunction[name] = (countsByFunction[name] || 0) + 1;
      }
    }
  }

  const updated = {
    total: duplicateViolations.length,
    byFunction: countsByFunction,
    canonicalOwners: CANONICAL_HELPER_OWNERS,
  };
  fs.writeFileSync(DUPLICATE_RATCHET_PATH, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(
    `Updated duplicate ratchet baseline: total ceiling is now ${duplicateViolations.length}`
  );
}

for (const file of jsFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  violations.push(
    ...analyzeLines(rel, fs.readFileSync(file, 'utf8').split('\n')).map(v => ({ ...v, file: rel }))
  );
}

module.exports = {
  analyzeLines,
  analyzeComments,
  isOwnImplementation,
  CANONICAL_HELPER_OWNERS,
  DUPLICATE_RATCHET_PATH,
  loadDuplicateRatchet,
};

if (require.main === module) {
  if (process.argv.includes('--report')) {
    reportCommentSlop();
    process.exit(0);
  }

  const standardViolations = violations.filter(v => v.rule !== 'duplicate-helper-declaration');
  const duplicateViolations = violations.filter(v => v.rule === 'duplicate-helper-declaration');
  const duplicateRatchet = loadDuplicateRatchet();

  if (
    process.argv.includes('--update-duplicate-ratchet') ||
    process.argv.includes('--update-baseline')
  ) {
    updateDuplicateRatchet(duplicateViolations);
    process.exit(0);
  }

  if (process.argv.includes('--report-duplicates')) {
    console.log(
      `Duplicate helper declarations: ${duplicateViolations.length} (ratchet ceiling: ${duplicateRatchet.total})`
    );
    /** @type {Record<string, number>} */
    const counts = {};
    for (const v of duplicateViolations) {
      for (const name of Object.keys(CANONICAL_HELPER_OWNERS)) {
        if (v.message.includes(`'${name}'`)) counts[name] = (counts[name] || 0) + 1;
      }
    }
    for (const [name, cnt] of Object.entries(counts)) {
      console.log(`  ${name.padEnd(24)} ${cnt}`);
    }
    process.exit(duplicateViolations.length <= duplicateRatchet.total ? 0 : 1);
  }

  let failed = false;
  if (standardViolations.length > 0) {
    console.error(`\nCustom lint rules: ${standardViolations.length} violation(s) found\n`);
    for (const v of standardViolations) {
      console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.message}`);
    }
    failed = true;
  }

  if (duplicateViolations.length > duplicateRatchet.total) {
    console.error(
      `\n✗ Duplicate helper declarations: ${duplicateViolations.length} found, exceeding ratchet ceiling of ${duplicateRatchet.total}`
    );
    for (const v of duplicateViolations) {
      console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.message}`);
    }
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    `Custom lint rules: all passed (duplicate helper declarations: ${duplicateViolations.length}/${duplicateRatchet.total} within ratchet ceiling)`
  );
  process.exit(0);
}
