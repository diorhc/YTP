#!/usr/bin/env node
// @ts-check
/**
 * Facade member usage ratchet: tracks members on window.YouTube* / window.YouTubePlus*
 * that have 0 consumers outside their owner file in src/ (used only by tests or dead).
 *
 * Usage:
 *   node scripts/check-facade-usage.js                    -> enforce ceilings
 *   node scripts/check-facade-usage.js --list             -> list all findings
 *   node scripts/check-facade-usage.js --report           -> print summary report
 *   node scripts/check-facade-usage.js --update-baseline  -> lower ceilings to current
 */

const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const TEST_DIR = path.join(ROOT, 'test');
const BASELINE_PATH = path.join(ROOT, 'facade-ratchet.json');

/**
 * @typedef {object} FacadeFinding
 * @property {string} facade
 * @property {string} owner
 * @property {string} member
 * @property {number} testHits
 */

/**
 * @typedef {object} FacadeBaseline
 * @property {number} total
 * @property {Record<string, number>} byFacade
 * @property {Record<string, string>} trackedFacades
 * @property {Record<string, string[]>} members
 */

/**
 * AST walker helper.
 * @param {any} node
 * @param {(node: any) => void} visitor
 */
function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const k of Object.keys(node)) {
    if (k === 'parent') continue;
    const ch = node[k];
    if (Array.isArray(ch)) {
      for (const c of ch) walk(c, visitor);
    } else if (ch && typeof ch === 'object') {
      walk(ch, visitor);
    }
  }
}

/**
 * Read all JS files in a directory.
 * @param {string} dir
 * @returns {Record<string, string>} map of relPath -> content
 */
function readDirectoryFiles(dir) {
  /** @type {Record<string, string>} */
  const files = {};
  if (!fs.existsSync(dir)) return files;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isFile() && item.name.endsWith('.js')) {
      const full = path.join(dir, item.name);
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      files[rel] = fs.readFileSync(full, 'utf8');
    }
  }
  return files;
}

/**
 * Extract declared members on window[facade] in a given owner file content.
 * @param {string} facade
 * @param {string} code
 * @returns {Set<string>}
 */
function extractDeclaredMembers(facade, code) {
  /** @type {Set<string>} */
  const members = new Set();
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
  } catch {
    return members;
  }

  /** @type {Map<string, any>} */
  const localObjects = new Map();
  walk(ast, n => {
    if (
      n.type === 'VariableDeclarator' &&
      n.id.type === 'Identifier' &&
      n.init &&
      n.init.type === 'ObjectExpression'
    ) {
      localObjects.set(n.id.name, n.init);
    }
  });

  walk(ast, n => {
    if (n.type === 'AssignmentExpression') {
      const left = n.left;
      if (
        left.type === 'MemberExpression' &&
        left.object.type === 'Identifier' &&
        (left.object.name === 'window' || left.object.name === 'unsafeWindow') &&
        left.property.name === facade
      ) {
        let target = n.right;
        if (target.type === 'Identifier' && localObjects.has(target.name)) {
          target = localObjects.get(target.name);
        }
        if (target.type === 'ObjectExpression') {
          for (const p of target.properties) {
            if (p.type === 'Property' && p.key.type === 'Identifier') {
              members.add(p.key.name);
            }
          }
        }
      }
    }
  });

  return members;
}

/**
 * Analyze facade members for test-only or dead exports.
 * @param {Record<string, string>} trackedFacades
 * @param {Record<string, string>} [srcFiles]
 * @param {Record<string, string>} [testFiles]
 * @returns {{ violations: FacadeFinding[], byFacade: Record<string, number>, total: number }}
 */
function analyzeFacadeUsage(
  trackedFacades,
  srcFiles = readDirectoryFiles(SRC_DIR),
  testFiles = readDirectoryFiles(TEST_DIR)
) {
  /** @type {FacadeFinding[]} */
  const violations = [];
  /** @type {Record<string, number>} */
  const byFacade = {};

  for (const [facade, ownerPath] of Object.entries(trackedFacades)) {
    const ownerCode = srcFiles[ownerPath];
    if (!ownerCode) continue;

    const declared = extractDeclaredMembers(facade, ownerCode);
    let facadeViolationCount = 0;

    for (const member of declared) {
      // Check if accessed in any src file other than the owner file
      const pat = new RegExp(`(?:window\\.)?${facade}(?:\\?\\.|\\.)${member}\\b`);
      let usedInOtherSrc = false;

      for (const [relPath, content] of Object.entries(srcFiles)) {
        if (relPath === ownerPath) continue;
        if (pat.test(content)) {
          usedInOtherSrc = true;
          break;
        }
      }

      if (!usedInOtherSrc) {
        // Count hits in test files
        let testHits = 0;
        for (const content of Object.values(testFiles)) {
          if (pat.test(content) || (content.includes(facade) && content.includes(member))) {
            testHits += 1;
          }
        }

        violations.push({
          facade,
          owner: ownerPath,
          member,
          testHits,
        });
        facadeViolationCount += 1;
      }
    }

    byFacade[facade] = facadeViolationCount;
  }

  return {
    violations,
    byFacade,
    total: violations.length,
  };
}

/**
 * Load baseline configuration.
 * @returns {FacadeBaseline}
 */
function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`Baseline file not found at ${BASELINE_PATH}`);
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

/**
 * Update baseline file, only lowering ceilings.
 * @param {FacadeBaseline} currentBaseline
 * @param {Record<string, number>} currentCounts
 * @param {FacadeFinding[]} currentViolations
 */
function updateBaseline(currentBaseline, currentCounts, currentViolations) {
  const updated = { ...currentBaseline };
  let newTotal = 0;

  for (const [facade, ceiling] of Object.entries(currentBaseline.byFacade)) {
    const current = currentCounts[facade] ?? 0;
    if (current > ceiling) {
      throw new Error(
        `Cannot update baseline: ${facade} has ${current} violations exceeding ceiling ${ceiling}`
      );
    }
    updated.byFacade[facade] = Math.min(ceiling, current);
    newTotal += updated.byFacade[facade];
  }

  updated.total = newTotal;
  /** @type {Record<string, string[]>} */
  const membersByFacade = {};
  for (const v of currentViolations) {
    membersByFacade[v.facade] = membersByFacade[v.facade] || [];
    membersByFacade[v.facade].push(v.member);
  }
  updated.members = membersByFacade;

  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`Updated facade ratchet baseline: total ceiling is now ${newTotal}`);
}

function main() {
  const baseline = loadBaseline();
  const results = analyzeFacadeUsage(baseline.trackedFacades);

  if (process.argv.includes('--update-baseline')) {
    updateBaseline(baseline, results.byFacade, results.violations);
    process.exit(0);
  }

  if (process.argv.includes('--list')) {
    console.log(`Facade violations (${results.total} total):`);
    for (const v of results.violations) {
      console.log(`  ${v.facade}.${v.member} (${v.owner}, test references: ${v.testHits})`);
    }
    process.exit(0);
  }

  if (process.argv.includes('--report')) {
    console.log(`Facade usage: ${results.total} violations (ceiling: ${baseline.total})`);
    for (const [facade, count] of Object.entries(results.byFacade)) {
      const ceiling = baseline.byFacade[facade] ?? 0;
      console.log(`  ${facade.padEnd(28)} ${count} / ${ceiling}`);
    }
    process.exit(results.total <= baseline.total ? 0 : 1);
  }

  // Enforcement check
  let exceeded = false;
  for (const [facade, count] of Object.entries(results.byFacade)) {
    const ceiling = baseline.byFacade[facade] ?? 0;
    if (count > ceiling) {
      console.error(`✗ ${facade}: ${count} violation(s) exceed ratchet ceiling of ${ceiling}`);
      exceeded = true;
    }
  }

  if (results.total > baseline.total) {
    console.error(
      `✗ Total facade violations (${results.total}) exceed ratchet ceiling of ${baseline.total}`
    );
    exceeded = true;
  }

  if (exceeded) {
    console.error(
      '\nFacade check failed. Members used only by tests must be routed through U.exposeTestHooks.'
    );
    process.exit(1);
  }

  console.log(`✓ Facade usage: ${results.total} violation(s) (ceiling: ${baseline.total})`);
}

module.exports = {
  analyzeFacadeUsage,
  extractDeclaredMembers,
  loadBaseline,
  BASELINE_PATH,
};

if (require.main === module) {
  main();
}
