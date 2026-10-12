const { minifyCssTemplates } = require('../scripts/minify-css-templates');

// A `${border}` placeholder inside the generated template literal.
const BORDER = '$' + '{border}';

const css = `
  .a { color: red; margin: 0 auto; }
  .b > .c { display: flex; gap: 4px; }
  /* note */
  .d:hover { opacity: 0.5; padding: 2px 4px; }
  .e { border: 1px solid ${BORDER}; background: transparent; }
  .f { font-size: 12px; line-height: 1.4; }
`;

describe('minifyCssTemplates', () => {
  test('minifies a CSS template literal and keeps its expressions', () => {
    const code = `const border = 'red';\nconst styles = \`${css}\`;\n`;
    const out = minifyCssTemplates(code);
    expect(out).toContain(
      `\`.a{color:red;margin:0 auto}.b>.c{display:flex;gap:4px}.d:hover{opacity:0.5;padding:2px 4px}.e{border:1px solid ${BORDER};background:transparent}.f{font-size:12px;line-height:1.4}\``
    );
    // The result is still valid code that builds the same rules.
    const fn = new Function(`${out}; return styles;`);
    expect(fn()).toContain('.e{border:1px solid red;');
  });

  test('a backtick in a comment never turns code into CSS', () => {
    const filler = 'x'.repeat(220);
    const code = [
      '/** Members such as `attached498` are patched by name. */',
      'const run = (key, opts = {}) => {',
      `  const label = "${filler}";`,
      '  const enabled = !(opts && opts.enabled === false);',
      '  return { a: { b: 1; }, enabled };'.replace('1;', '1'),
      '};',
      `const styles = \`${css}\`;`,
    ].join('\n');
    const out = minifyCssTemplates(code);
    expect(out).toContain('const enabled = !(opts && opts.enabled === false);');
    expect(out).toContain('/** Members such as `attached498` are patched by name. */');
  });

  test('leaves a template that is not CSS untouched', () => {
    const html = `<div class="row">\n  <span>${'x'.repeat(250)}</span>\n</div>`;
    const code = `const markup = \`${html}\`;`;
    expect(minifyCssTemplates(code)).toBe(code);
  });
  test('minifies CSS whose rules end without a semicolon', () => {
    const tight = `
      .a{color:red}
      .b{display:flex}
      .c{opacity:.5}
      ${'.d{margin:0}\n'.repeat(20)}`;
    const code = `const styles = \`${tight}\`;`;
    const out = minifyCssTemplates(code);
    expect(out).toContain('`.a{color:red}.b{display:flex}.c{opacity:.5}.d{margin:0}');
  });

  test('a JS object literal in a template is not taken for CSS', () => {
    const js = `const o = { a: 1 }; if (x) { y(); }\n${'// filler\n'.repeat(30)}`;
    const code = `const src = \`${js}\`;`;
    expect(minifyCssTemplates(code)).toBe(code);
  });
});
