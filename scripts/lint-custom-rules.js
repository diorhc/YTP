#!/usr/bin/env node
'use strict';

/**
 * Custom lint rules that were previously enforced by ESLint
 * no-restricted-syntax rules. Biome does not support equivalent
 * AST-level selectors, so these are checked via line-by-line regex.
 *
 * Rules:
 *   1. setTimeout(_, >= 1000) → must use setTimeout_ wrapper
 *   2. Direct innerHTML assignment → must use YouTubeSafeDOM.setHTML
 *   3. *Any variable aliases → use typed interfaces
 *   4. wAny window aliases → use typed window interfaces
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');

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

for (const file of jsFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // Skip lines with inline lint ignore (current or previous line)
    if (line.includes('// lint:custom:ignore')) continue;
    if (i > 0 && lines[i - 1].includes('// lint:custom:ignore')) continue;

    // Rule 1: setTimeout(_, >= 1000) without setTimeout_ wrapper
    // Matches: setTimeout(fn, 1000) or setTimeout(fn, 2000) etc.
    // But NOT: setTimeout_(fn, ...) (the wrapper)
    // Also NOT: setTimeout_ which is the wrapper itself
    const setTimeoutMatch = line.match(
      /(?<!\w)setTimeout\s*\([^)]*,\s*(\d+)\s*[,\)]/
    );
    if (setTimeoutMatch) {
      const delay = parseInt(setTimeoutMatch[1], 10);
      if (delay >= 1000) {
        violations.push({
          file: rel,
          line: lineNum,
          rule: 'setTimeout-long-delay',
          message: `setTimeout with delay ${delay}ms (>= 1000). Use setTimeout_ wrapper for timer lifecycle management.`,
        });
      }
    }

    // Rule 2: Direct innerHTML assignment
    // Matches: foo.innerHTML = ... but NOT: foo.innerHTML === (comparison)
    const innerHTMLAssign = line.match(/\.innerHTML\s*=[^=]/);
    if (innerHTMLAssign) {
      // Allow empty string assignment and safe-dom patterns
      if (!line.match(/\.innerHTML\s*=\s*['"]\s*['"]/) &&
          !line.match(/\.textContent\s*=/) &&
          !line.match(/safeHTML|setHTML|_createHTML|createSafeHTML|renderTemplateClone/)) {
        violations.push({
          file: rel,
          line: lineNum,
          rule: 'no-innerHTML-assign',
          message: 'Direct innerHTML assignment. Use YouTubeSafeDOM.setHTML() or renderTemplateClone().',
        });
      }
    }

    // Rule 3: *Any variable aliases (e.g. wAny, settingsAny)
    const anyAlias = line.match(
      /(?:const|let|var)\s+(\w*Any\w*)\s*=/
    );
    if (anyAlias) {
      const name = anyAlias[1];
      // Allow known safe patterns: createAny, isAny (function names)
      if (!name.startsWith('create') && !name.startsWith('is') && !name.startsWith('toAny')) {
        violations.push({
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
      violations.push({
        file: rel,
        line: lineNum,
        rule: 'no-wAny-alias',
        message: `Variable "${wAnyAlias[1]}" is a window-any alias. Use typed window interfaces instead.`,
      });
    }
  }
}

if (violations.length === 0) {
  console.log('Custom lint rules: all passed');
  process.exit(0);
}

console.error(`\nCustom lint rules: ${violations.length} violation(s) found\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.message}`);
}
console.error('');
process.exit(1);
