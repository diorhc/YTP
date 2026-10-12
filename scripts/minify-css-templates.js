// @ts-check
// Minify the CSS inside template literals of the merged bundle.
//
// Template literals are found with a JavaScript parser, never by matching
// backticks in the raw text: a backtick in a comment or a string would pair
// with the wrong one and rewrite ordinary code as if it were CSS. Only the
// literal text between `${…}` expressions is rewritten; expressions are kept
// byte for byte.

const acorn = require('acorn');

/** A literal counts as CSS when at least this share of its `{…}` blocks hold declarations. */
const CSS_RULE_RATIO = 0.6;
const MIN_LENGTH = 200;
const MAX_EXPRESSIONS = 15;

/**
 * @param {string} text
 * @param {{ minLength?: number; minRules?: number }} [options]
 */
function looksLikeCss(text, { minLength = MIN_LENGTH, minRules = 3 } = {}) {
  if (text.length < minLength || !text.includes('{')) return false;
  const rules = text.match(/\{[^{}]*\}/g) || [];
  if (rules.length < minRules) return false;
  const cssRules = rules.filter(rule => /[a-z-]+\s*:\s*[^;{}]+(?:;|\}$)/.test(rule)).length;
  return cssRules / rules.length >= CSS_RULE_RATIO;
}

/** @param {string} text */
function minifyCssText(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n\s*/g, ' ')
    .replace(/\s*\{\s*/g, '{')
    .replace(/\s*\}\s*/g, '}')
    .replace(/\s*;\s*/g, ';')
    .replace(/([a-z-])\s*:\s*/gi, '$1:')
    .replace(/\s*,\s*/g, ',')
    .replace(/([a-z\])"'.#_])\s+([a-z[.)#_>:~+])/gi, '$1 $2')
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/;\}/g, '}')
    .replace(/ {2,}/g, ' ');
}

/**
 * @param {unknown} node
 * @param {(node: { type: string; [key: string]: unknown }) => void} visit
 */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const record = /** @type {{ type?: unknown; [key: string]: unknown }} */ (node);
  if (typeof record.type === 'string') {
    visit(/** @type {{ type: string; [key: string]: unknown }} */ (record));
  }
  for (const key of Object.keys(record)) walk(record[key], visit);
}

/**
 * @param {string} code merged bundle source
 * @returns {string} the same source with CSS template literals minified
 */
function minifyCssTemplates(code) {
  const ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowHashBang: true,
  });

  /** @type {Array<{ start: number; end: number; text: string }>} */
  const edits = [];
  walk(ast, node => {
    if (node.type !== 'TemplateLiteral') return;
    const quasis = /** @type {Array<{ start: number; end: number }>} */ (node.quasis);
    const expressions = /** @type {unknown[]} */ (node.expressions);
    if (expressions.length > MAX_EXPRESSIONS) return;
    const texts = quasis.map(q => code.slice(q.start, q.end));
    if (!looksLikeCss(texts.join(''))) return;
    texts.forEach((text, i) => {
      let next = minifyCssText(text);
      if (i === 0) next = next.trimStart();
      if (i === texts.length - 1) next = next.trimEnd();
      if (next !== text) edits.push({ start: quasis[i].start, end: quasis[i].end, text: next });
    });
  });

  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

module.exports = { minifyCssTemplates, looksLikeCss, walk };
