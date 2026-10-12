const {
  analyzeCss,
  analyzeSource,
  compare,
  lowerBaseline,
} = require('../scripts/check-css-ratchet');

const metricsOf = css =>
  analyzeCss(css)
    .map(f => f.metric)
    .sort();

describe('check-css-ratchet: analyzeCss', () => {
  test('flags transition: all, including in transition-property and with !important', () => {
    expect(metricsOf('.a{transition:all .2s ease}')).toEqual(['rawDuration', 'transitionAll']);
    expect(metricsOf('.a{transition-property:opacity, all}')).toEqual(['transitionAll']);
    expect(metricsOf('.a{transition:all var(--d) var(--e) !important}')).toEqual([
      'important',
      'transitionAll',
    ]);
  });

  test('a transition with listed properties and token timing is clean', () => {
    expect(metricsOf('.a{transition:opacity var(--yp-dur-fast) var(--yp-ease-standard)}')).toEqual(
      []
    );
    expect(metricsOf('.a{transition:background-color var(--x)}')).toEqual([]);
  });

  test('raw values count outside custom property definitions only', () => {
    const css = `:root{--blur:blur(18px);--ease:cubic-bezier(.2,0,0,1);--c:#fff;--d:.2s}
      .a{backdrop-filter:blur(8px);color:#fff;background:rgba(0,0,0,.5);animation:x .3s cubic-bezier(.4,0,.2,1)}`;
    expect(metricsOf(css)).toEqual(['rawBlur', 'rawColor', 'rawColor', 'rawDuration', 'rawEasing']);
  });

  test('border-radius lengths count unless 0, 50% or a pill', () => {
    expect(metricsOf('.a{border-radius:12px}')).toEqual(['rawRadius']);
    expect(metricsOf('.a{border-radius:0 0 8px 8px}')).toEqual(['rawRadius']);
    expect(
      metricsOf('.a{border-radius:50%}.b{border-radius:999px}.c{border-radius:var(--r)}')
    ).toEqual([]);
  });

  test('colors and blur behind var() are not raw', () => {
    expect(metricsOf('.a{color:var(--c, #fff);backdrop-filter:var(--yt-glass-blur)}')).toEqual([]);
  });

  test('will-change is counted, including inside @keyframes', () => {
    expect(metricsOf('.a{will-change:transform}')).toEqual(['willChange']);
    expect(metricsOf('@keyframes k{from{opacity:0;will-change:opacity}to{opacity:1}}')).toEqual([
      'willChange',
    ]);
  });

  test(':has() is flagged only when anchored on a large YouTube container', () => {
    expect(metricsOf('ytd-app:has(#x:hover) #content{opacity:1}')).toEqual(['hasBroad']);
    expect(metricsOf('#content:not(:has(#c[opened])) #page-manager{margin:0}')).toEqual([
      'hasBroad',
    ]);
    expect(metricsOf('.yp-panel:has(.x){opacity:1}')).toEqual([]);
  });

  test('bare universal selectors are flagged; attribute selectors are not', () => {
    expect(metricsOf('html[data-yp-style="solid"] *{opacity:1}')).toEqual(['universal']);
    expect(metricsOf('#tabs > *{opacity:1}')).toEqual(['universal']);
    expect(metricsOf('[class*="yp-"]{opacity:1}')).toEqual([]);
  });

  test('comments and @media wrappers do not hide or invent declarations', () => {
    const css = '/* transition: all 1s */ @media (min-width:1px){.a{transition:opacity var(--d)}}';
    expect(metricsOf(css)).toEqual([]);
  });
});

describe('check-css-ratchet: analyzeSource', () => {
  test('reads template literals, inline declaration strings and JS style props with line numbers', () => {
    const code = [
      'const css = `',
      '  .a { color: #fff; }',
      '  .b { transition: all .2s; }',
      '`;',
      "el.style.cssText = 'padding:4px;margin:0;backdrop-filter:blur(6px)';",
      "Object.assign(el.style, { transition: 'all .3s ease' });",
      "el.style.willChange = 'transform';",
      'const label = `Hello $' + '{name}`;',
    ].join('\n');
    const found = analyzeSource(code).map(f => `${f.line}:${f.metric}`);
    expect(found).toEqual(
      expect.arrayContaining([
        '2:rawColor',
        '3:transitionAll',
        '3:rawDuration',
        '5:rawBlur',
        '6:transitionAll',
        '7:willChange',
      ])
    );
    expect(found.some(f => f.startsWith('8:'))).toBe(false);
  });
});

describe('check-css-ratchet: baseline', () => {
  test('a value above the ceiling fails; at or below passes', () => {
    const baseline = { 'src/a.js': { transitionAll: 2 } };
    expect(compare({ 'src/a.js': { transitionAll: 2 } }, baseline)).toEqual([]);
    expect(compare({ 'src/a.js': { transitionAll: 3 } }, baseline)).toEqual([
      'src/a.js: transitionAll 3 > ceiling 2',
    ]);
  });

  test('a file without a ceiling must be clean', () => {
    expect(compare({ 'src/new.js': { rawBlur: 1 } }, {})).toEqual([
      'src/new.js: rawBlur 1 > 0 (file has no ceiling yet)',
    ]);
  });

  test('updating the baseline never raises a ceiling', () => {
    const next = lowerBaseline(
      { 'src/a.js': { transitionAll: 5, rawBlur: 1 } },
      { 'src/a.js': { transitionAll: 3, rawBlur: 4 } }
    );
    expect(next['src/a.js'].transitionAll).toBe(3);
    expect(next['src/a.js'].rawBlur).toBe(1);
  });
});
