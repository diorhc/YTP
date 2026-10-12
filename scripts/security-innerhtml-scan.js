#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

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

// YouTube enforces Trusted Types (require-trusted-types-for 'script'): ANY
// string assigned to innerHTML/outerHTML throws there — an empty literal too.
// Clear with replaceChildren() and render through the safe wrappers.
const suspiciousInnerHTML = /\.innerHTML\s*=(?!=)/;
const innerHTMLAllowList = [];

const suspiciousOuterHTML = /\.outerHTML\s*=(?!=)/;
const suspiciousDocumentWrite = /document\s*\.\s*write(ln)?\s*\(/;

// Only calls that actually SANITIZE count as safe wrappers here.
// `_createHTML` / `_ytplusCreateHTML` / `createTrustedHTML` are pass-through
// Trusted Types wraps, NOT sanitizers, so they must never silence a finding.
const safeWrapperPattern =
  /sanitizeHTML\s*\(|createSafeHTML\s*\(|\.setHTML\s*\(|renderTemplateClone\s*\(|escapeHTML\s*\(/;

/**
 * Decide whether an expression builds HTML dynamically (i.e. can carry
 * interpolated data into an XSS sink). Static literals are always allowed.
 * @param {any} node
 * @returns {boolean}
 */
function isDynamicHtmlExpression(node) {
  if (!node) return false;
  if (node.type === 'TemplateLiteral') return node.expressions.length > 0;
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return isDynamicHtmlExpression(node.left) || isDynamicHtmlExpression(node.right);
  }
  if (node.type === 'CallExpression') {
    // Pass-through Trusted Types wraps do not sanitize: dynamic content
    // routed through them still reaches the sink unsanitized.
    const callee = node.callee;
    const name = callee.type === 'Identifier' ? callee.name : callee.property?.name || '';
    if (/^(_createHTML|_ytplusCreateHTML|createHTML|createTrustedHTML)$/.test(name)) {
      return node.arguments.some(isDynamicHtmlExpression);
    }
  }
  return false;
}

/**
 * Parse source with acorn and walk the AST looking for:
 *   1. Template literal strings in XSS sinks (innerHTML, insertAdjacentHTML, document.write)
 *   2. Aliasing of `window` or `document` to a local variable, then calling
 *      dangerous methods on the alias (e.g. const w = window; w.location = x)
 * @param {string} source
 * @param {string} relPath
 * @returns {string[]}
 */
function astScan(source, relPath) {
  /** @type {string[]} */
  const findings = [];
  let ast;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      locations: true,
    });
  } catch {
    return findings;
  }

  /** @type {Map<string, {node: any, origin: string}>} */
  const aliases = new Map();

  function loc(node) {
    return `${relPath}:${node.loc.start.line}`;
  }

  /**
   * @param {any} node
   * @param {any} parent
   */
  function visit(node, parent = null) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parent);
      return;
    }

    if (node.type === 'VariableDeclarator' && node.id && node.id.name && node.init) {
      const init = node.init;
      if (init.type === 'Identifier' && (init.name === 'window' || init.name === 'document')) {
        aliases.set(node.id.name, { node: init, origin: init.name });
      }
    }

    if (
      node.type === 'AssignmentExpression' &&
      node.left &&
      node.left.type === 'MemberExpression'
    ) {
      const obj = node.left.object;
      const prop = node.left.property;
      const propName = prop.type === 'Identifier' ? prop.name : prop.value;
      if (propName === 'innerHTML' || propName === 'outerHTML') {
        if (isDynamicHtmlExpression(node.right)) {
          findings.push(
            `${loc(node)}: [ast-template] ${propName} assignment with dynamic expression`
          );
        }
        let target = '';
        if (obj.type === 'Identifier') target = obj.name;
        else if (obj.type === 'MemberExpression') {
          const inner = obj.object;
          const innerProp = obj.property;
          const innerName = innerProp.type === 'Identifier' ? innerProp.name : innerProp.value;
          if (inner.type === 'Identifier' && aliases.has(inner.name)) {
            const alias = aliases.get(inner.name);
            if (alias) {
              target = `${alias.origin}.${innerName}`;
            }
          }
        }
        if (target) {
          const aliased = obj.type === 'Identifier' && aliases.has(obj.name);
          if (aliased || target.includes('window') || target.includes('document')) {
            findings.push(
              `${loc(node)}: [ast-alias] ${propName} assignment through aliased "${target}"`
            );
          }
        }
      }
    }

    if (node.type === 'CallExpression' && node.callee) {
      const callee = node.callee;
      let methodName = '';

      if (callee.type === 'MemberExpression') {
        const prop = callee.property;
        methodName = prop.type === 'Identifier' ? prop.name : prop.value;
      }

      const sinks = ['write', 'writeln', 'insertAdjacentHTML'];
      if (sinks.includes(methodName)) {
        // insertAdjacentHTML carries the HTML payload in argument #2
        // (argument #1 is the insertion position).
        const htmlArgs =
          methodName === 'insertAdjacentHTML' ? node.arguments.slice(1) : node.arguments;
        if (htmlArgs.some(isDynamicHtmlExpression)) {
          findings.push(`${loc(node)}: [ast-template] template literal in ${methodName}() sink`);
        }
      }

      if (methodName === 'setAttribute' && node.arguments.length >= 2) {
        const nameArg = node.arguments[0];
        const valArg = node.arguments[1];
        const dangerousAttrs = ['href', 'src', 'formaction', 'xlink:href'];
        const attrName = nameArg && nameArg.type === 'Literal' ? String(nameArg.value) : null;
        if (
          attrName &&
          dangerousAttrs.includes(attrName) &&
          valArg &&
          valArg.type === 'TemplateLiteral' &&
          valArg.expressions.length > 0
        ) {
          findings.push(
            `${loc(node)}: [ast-template] template literal in setAttribute("${attrName}") sink`
          );
        }
      }
    }

    if (node.type === 'MemberExpression' && node.object && node.property) {
      const propName =
        node.property.type === 'Identifier' ? node.property.name : node.property.value;
      if (
        propName === 'location' ||
        propName === 'assign' ||
        propName === 'replace' ||
        propName === 'open'
      ) {
        let objName = '';
        if (node.object.type === 'Identifier') objName = node.object.name;
        if (objName && aliases.has(objName)) {
          if (parent && parent.type === 'AssignmentExpression' && parent.left === node) {
            findings.push(
              `${loc(node)}: [ast-alias] location assignment through aliased "${objName}"`
            );
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item.type === 'string') {
            visit(item, node);
          }
        }
      } else if (child && typeof child.type === 'string') {
        visit(child, node);
      }
    }
  }

  visit(ast);
  return findings;
}

/** @type {string[]} */
const findings = [];

for (const filePath of jsFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (
      suspiciousInnerHTML.test(line) &&
      !innerHTMLAllowList.some(allowed => line.includes(allowed)) &&
      !safeWrapperPattern.test(line)
    ) {
      findings.push(`${rel}:${i + 1}: ${line.trim()}`);
    }

    if (suspiciousOuterHTML.test(line) && !safeWrapperPattern.test(line)) {
      findings.push(`${rel}:${i + 1}: ${line.trim()}`);
    }

    if (suspiciousDocumentWrite.test(line)) {
      findings.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  }

  const astFindings = astScan(content, rel);
  findings.push(...astFindings);
}

if (findings.length > 0) {
  console.error('Potential unsafe innerHTML usage found:');
  for (const finding of findings) {
    console.error(finding);
  }
  process.exit(1);
}

console.log('CSP compatibility check passed');
