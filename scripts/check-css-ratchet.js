#!/usr/bin/env node
// @ts-check
// CSS ratchet for src/: per-file ceilings on CSS patterns that cost
// performance or bypass the design tokens. Ceilings may only go down.
//
// CSS is read with the JavaScript parser from template literals (the same
// detection as the release minifier; `${…}` expressions count as an opaque
// value), from string literals that hold inline declaration lists
// (`cssText`), and from style properties set in JS (`{ transition: '…' }`,
// `el.style.willChange = '…'`).
//
//   transitionAll   `transition` / `transition-property` that lists `all`
//   willChange      any `will-change` declaration
//   rawBlur         `blur(…)` outside a custom property definition
//                   (use the --yt-glass-blur* tokens)
//   rawEasing       `cubic-bezier(…)` outside a custom property definition
//   rawDuration     a literal time in `transition*` / `animation*` outside a
//                   custom property definition
//   rawColor        hex, rgb(a)() or hsl(a)() outside a custom property definition
//   rawRadius       `border-radius` with a length other than 0, 50% or a pill
//                   (999px / 9999px) outside a custom property definition
//   important       `!important`
//   hasBroad        `:has(` anchored on a large YouTube container
//                   (html, body, ytd-app, #content, #page-manager, …)
//   universal       rules whose selector has a bare `*` compound
//
//   node scripts/check-css-ratchet.js                    → enforce
//   node scripts/check-css-ratchet.js --update-baseline  → lower the ceilings
//     to the current values. It never raises a ceiling; a new file starts at
//     its current values.
//   node scripts/check-css-ratchet.js --list <metric> [file]
//                                                        → print each finding
//
// Do not hand-edit css-ratchet.json to make the check pass.

const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { looksLikeCss, walk } = require('./minify-css-templates');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BASELINE = path.join(ROOT, 'css-ratchet.json');
const METRICS = /** @type {const} */ ([
  'transitionAll',
  'willChange',
  'rawBlur',
  'rawEasing',
  'rawDuration',
  'rawColor',
  'rawRadius',
  'important',
  'hasBroad',
  'universal',
]);

/** @typedef {typeof METRICS[number]} Metric */
/** @typedef {{ metric: Metric; line: number; text: string }} Finding */

const EXPR = '__EXPR__';
const BROAD_HAS_ANCHOR =
  /(?:^|[\s>+~(,])(?:html|body|ytd-app|ytd-watch-flexy|ytd-browse|ytd-page-manager|ytd-rich-grid-renderer|ytmusic-app|ytmusic-app-layout|#content|#contents|#page-manager|#columns|#primary|#secondary|#main-panel)(?:\[[^\]]*\]|:not\([^():]*\)|\.[\w-]+|#[\w-]+)*(?::not\()?:has\(/;
/** Inline declaration lists (`el.style.cssText = '…'`, style attributes). */
const INLINE_DECLS = /(?:^|;)\s*-{0,2}[a-z][a-z0-9-]*\s*:\s*[^;{}]+/gi;
/** JS style properties whose string value is checked like a CSS declaration. */
const JS_STYLE_PROPS = {
  transition: 'transition',
  transitionProperty: 'transition-property',
  transitionDuration: 'transition-duration',
  willChange: 'will-change',
  backdropFilter: 'backdrop-filter',
  webkitBackdropFilter: '-webkit-backdrop-filter',
  filter: 'filter',
  animation: 'animation',
};
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi;
const TIME = /(?:^|[\s,(])(?:\d*\.)?\d+m?s\b/g;

/**
 * @param {string} text
 * @returns {string} the text with comments blanked out, offsets kept
 */
function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

/**
 * Walk a CSS text and report every declaration with its rule context.
 * @param {string} css
 * @param {(decl: { prop: string; value: string; selector: string; inKeyframes: boolean; offset: number }) => void} onDecl
 * @param {(rule: { selector: string; offset: number }) => void} onRule
 */
function walkCss(css, onDecl, onRule) {
  const text = blankComments(css);
  /** @type {Array<{ prelude: string; keyframes: boolean }>} */
  const stack = [];
  let start = 0;
  const inKeyframes = () => stack.some(s => s.keyframes);
  const currentSelector = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!stack[i].prelude.startsWith('@')) return stack[i].prelude;
    }
    return '';
  };
  const flushDecl = (/** @type {number} */ end) => {
    const raw = text.slice(start, end);
    const colon = raw.indexOf(':');
    if (colon > 0 && stack.length > 0 && !stack[stack.length - 1].prelude.startsWith('@')) {
      const prop = raw.slice(0, colon).trim().toLowerCase();
      if (/^-{0,2}[a-z][a-z0-9-]*$/.test(prop)) {
        const lead = raw.length - raw.trimStart().length;
        onDecl({
          prop,
          value: raw.slice(colon + 1).trim(),
          selector: currentSelector(),
          inKeyframes: inKeyframes(),
          offset: start + lead,
        });
      }
    }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      const prelude = text.slice(start, i).trim();
      const lead = text.slice(start, i).length - text.slice(start, i).trimStart().length;
      stack.push({ prelude, keyframes: /^@(?:-webkit-)?keyframes\b/.test(prelude) });
      if (prelude && !prelude.startsWith('@') && !inKeyframes()) {
        onRule({ selector: prelude, offset: start + lead });
      }
      start = i + 1;
    } else if (ch === ';') {
      flushDecl(i);
      start = i + 1;
    } else if (ch === '}') {
      flushDecl(i);
      stack.pop();
      start = i + 1;
    }
  }
}

/**
 * @param {string} css
 * @returns {Array<{ metric: Metric; offset: number; text: string }>}
 */
function analyzeCss(css) {
  /** @type {Array<{ metric: Metric; offset: number; text: string }>} */
  const out = [];
  const add = (
    /** @type {Metric} */ metric,
    /** @type {number} */ offset,
    /** @type {string} */ text
  ) => out.push({ metric, offset, text: text.replace(/\s+/g, ' ').slice(0, 160) });

  walkCss(
    css,
    decl => {
      const { prop, value, offset } = decl;
      const shown = `${prop}: ${value}`;
      const isToken = prop.startsWith('--');
      if (/!\s*important/i.test(value)) add('important', offset, shown);
      if (prop === 'will-change') add('willChange', offset, `${decl.selector} { ${shown} }`);
      if (
        (prop === 'transition' || prop === 'transition-property') &&
        /(?:^|[\s,])all(?:[\s,]|$)/i.test(value.replace(/!\s*important/i, ''))
      ) {
        add('transitionAll', offset, shown);
      }
      if (isToken) return;
      if (/\bblur\(/i.test(value)) add('rawBlur', offset, shown);
      if (/\bcubic-bezier\(/i.test(value)) add('rawEasing', offset, shown);
      if (/^(?:transition|animation)(?:-duration|-delay)?$/.test(prop)) {
        const withoutVars = value.replace(/var\([^)]*\)/g, '');
        if (TIME.test(withoutVars)) add('rawDuration', offset, shown);
        TIME.lastIndex = 0;
      }
      if (/^border(?:-[a-z]+)?-radius$/.test(prop)) {
        const lengths =
          value.replace(/var\([^)]*\)/g, '').match(/(?:\d*\.)?\d+(?:px|r?em)\b/g) || [];
        if (lengths.some(l => !/^(?:0(?:px|r?em)|999px|9999px)$/.test(l)))
          add('rawRadius', offset, shown);
      }
      const colorless = value.replace(/var\([^)]*\)/g, '');
      if (COLOR.test(colorless)) add('rawColor', offset, shown);
      COLOR.lastIndex = 0;
    },
    rule => {
      for (const part of rule.selector.split(',')) {
        const sel = part.trim();
        if (BROAD_HAS_ANCHOR.test(sel)) add('hasBroad', rule.offset, sel);
        if (/(?:^|[\s>+~])\*(?:$|[\s>+~:[])/.test(sel)) add('universal', rule.offset, sel);
      }
    }
  );
  return out;
}

/**
 * `{ transition: 'all .3s' }` or `el.style.transition = 'all .3s'`.
 * @param {{ type: string; [key: string]: unknown }} node
 * @returns {{ prop: string; value: string; start: number } | null}
 */
function jsStyleDeclaration(node) {
  /** @type {unknown} */
  let key = null;
  /** @type {unknown} */
  let valueNode = null;
  if (node.type === 'Property') {
    key = node.key;
    valueNode = node.value;
  } else if (node.type === 'AssignmentExpression') {
    const left =
      /** @type {{ type?: string; property?: unknown; object?: { type?: string; property?: { name?: string } } }} */ (
        node.left
      );
    if (left?.type !== 'MemberExpression' || left.object?.property?.name !== 'style') return null;
    key = left.property;
    valueNode = node.right;
  } else {
    return null;
  }
  const k = /** @type {{ name?: string; value?: unknown }} */ (key);
  const name = typeof k?.name === 'string' ? k.name : typeof k?.value === 'string' ? k.value : '';
  const prop = /** @type {Record<string, string>} */ (JS_STYLE_PROPS)[name];
  const v = /** @type {{ type?: string; value?: unknown; start?: number }} */ (valueNode);
  if (!prop || v?.type !== 'Literal' || typeof v.value !== 'string') return null;
  return { prop, value: v.value, start: /** @type {number} */ (v.start) };
}

/**
 * Extract CSS template literals from one source file.
 * @param {string} code
 * @returns {Array<{ css: string; toCodeOffset: (offset: number) => number }>}
 */
function extractCss(code) {
  const ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowHashBang: true,
  });
  /** @type {Array<{ css: string; toCodeOffset: (offset: number) => number }>} */
  const out = [];
  walk(ast, node => {
    if (node.type === 'Literal' && typeof node.value === 'string') {
      const value = /** @type {string} */ (node.value);
      const start = /** @type {number} */ (node.start) + 1;
      if (!value.includes('{') && (value.match(INLINE_DECLS) || []).length >= 3) {
        out.push({ css: `x{${value}}`, toCodeOffset: offset => start + Math.max(0, offset - 2) });
      }
      return;
    }
    const styleProp = jsStyleDeclaration(node);
    if (styleProp) {
      out.push({
        css: `x{${styleProp.prop}:${styleProp.value}}`,
        toCodeOffset: () => styleProp.start,
      });
      return;
    }
    if (node.type !== 'TemplateLiteral') return;
    const quasis = /** @type {Array<{ start: number; end: number }>} */ (node.quasis);
    /** @type {Array<{ textStart: number; codeStart: number }>} */
    const segments = [];
    let css = '';
    quasis.forEach((q, i) => {
      segments.push({ textStart: css.length, codeStart: q.start });
      css += code.slice(q.start, q.end);
      if (i < quasis.length - 1) css += EXPR;
    });
    if (!looksLikeCss(css, { minLength: 40, minRules: 1 })) {
      if (!css.includes('{') && (css.match(INLINE_DECLS) || []).length >= 3) {
        out.push({
          css: `x{${css}}`,
          toCodeOffset: offset => quasis[0].start + Math.max(0, offset - 2),
        });
      }
      return;
    }
    out.push({
      css,
      toCodeOffset: offset => {
        let seg = segments[0];
        for (const s of segments) if (s.textStart <= offset) seg = s;
        return seg.codeStart + (offset - seg.textStart);
      },
    });
  });
  return out;
}

/**
 * @param {string} code
 * @returns {Finding[]}
 */
function analyzeSource(code) {
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (/** @type {number} */ offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  /** @type {Finding[]} */
  const findings = [];
  for (const block of extractCss(code)) {
    for (const f of analyzeCss(block.css)) {
      findings.push({ metric: f.metric, line: lineOf(block.toCodeOffset(f.offset)), text: f.text });
    }
  }
  return findings;
}

/** @returns {Record<string, Finding[]>} */
function analyzeSrc() {
  /** @type {Record<string, Finding[]>} */
  const out = {};
  for (const name of fs.readdirSync(SRC).sort()) {
    if (!name.endsWith('.js')) continue;
    const findings = analyzeSource(fs.readFileSync(path.join(SRC, name), 'utf8'));
    if (findings.length) out[`src/${name}`] = findings;
  }
  return out;
}

/**
 * @param {Finding[]} findings
 * @returns {Record<string, number>}
 */
function countByMetric(findings) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const f of findings) counts[f.metric] = (counts[f.metric] || 0) + 1;
  return counts;
}

/**
 * @param {Record<string, Record<string, number>>} current
 * @param {Record<string, Record<string, number>>} baseline
 * @returns {string[]} violations
 */
function compare(current, baseline) {
  /** @type {string[]} */
  const errors = [];
  for (const [file, counts] of Object.entries(current)) {
    const ceil = baseline[file];
    for (const metric of METRICS) {
      const value = counts[metric] || 0;
      if (!ceil) {
        if (value > 0) errors.push(`${file}: ${metric} ${value} > 0 (file has no ceiling yet)`);
        continue;
      }
      const max = ceil[metric] || 0;
      if (value > max) errors.push(`${file}: ${metric} ${value} > ceiling ${max}`);
    }
  }
  return errors;
}

/**
 * @param {Record<string, Record<string, number>>} current
 * @param {Record<string, Record<string, number>>} baseline
 * @returns {Record<string, Record<string, number>>}
 */
function lowerBaseline(current, baseline) {
  /** @type {Record<string, Record<string, number>>} */
  const next = {};
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const file of [...files].sort()) {
    const cur = current[file] || {};
    if (!current[file] && baseline[file]) continue;
    /** @type {Record<string, number>} */
    const row = {};
    for (const metric of METRICS) {
      const value = cur[metric] || 0;
      const old = baseline[file]?.[metric];
      row[metric] = old === undefined ? value : Math.min(old, value);
    }
    next[file] = row;
  }
  return next;
}

function main() {
  const args = process.argv.slice(2);
  const findings = analyzeSrc();
  /** @type {Record<string, Record<string, number>>} */
  const current = {};
  for (const [file, list] of Object.entries(findings)) current[file] = countByMetric(list);

  const listIdx = args.indexOf('--list');
  if (listIdx !== -1) {
    const metric = args[listIdx + 1];
    const onlyFile = args[listIdx + 2];
    for (const [file, list] of Object.entries(findings)) {
      if (onlyFile && file !== onlyFile && file !== `src/${onlyFile}`) continue;
      for (const f of list)
        if (!metric || f.metric === metric)
          console.log(`${file}:${f.line}  ${f.metric}  ${f.text}`);
    }
    return;
  }

  /** @type {Record<string, Record<string, number>>} */
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};

  /** @type {Record<string, number>} */
  const totals = {};
  for (const counts of Object.values(current)) {
    for (const metric of METRICS) totals[metric] = (totals[metric] || 0) + (counts[metric] || 0);
  }

  if (args.includes('--update-baseline')) {
    fs.writeFileSync(BASELINE, `${JSON.stringify(lowerBaseline(current, baseline), null, 2)}\n`);
    console.log(`CSS ratchet baseline written: ${JSON.stringify(totals)}`);
    return;
  }

  console.log(`CSS ratchet: ${JSON.stringify(totals)}`);
  const errors = compare(current, baseline);
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(
      'See each finding with: node scripts/check-css-ratchet.js --list <metric> <file>'
    );
    process.exitCode = 1;
    return;
  }
  console.log('✓ CSS ratchet holds');
}

if (require.main === module) main();

module.exports = { analyzeCss, analyzeSource, compare, lowerBaseline, METRICS };
