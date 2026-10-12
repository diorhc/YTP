describe('YouTubeSafeDOM', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    delete window._ytplusCreateHTML;
    delete window.trustedTypes;
    require('../src/safe-dom.js');
  });

  test('sanitizeHTML removes script tags and on* attributes', () => {
    const dirty = '<div onclick="alert(1)">x</div><script>alert(2)</script>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('<div>x</div>');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick=');
  });

  test('sanitizeHTML strips javascript: href', () => {
    const dirty = '<a href="javascript:alert(1)">bad</a>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('<a>bad</a>');
    expect(clean).not.toContain('javascript:');
  });

  test('setHTML sanitizes by default', () => {
    const el = document.createElement('div');
    window.YouTubeSafeDOM.setHTML(el, '<img src=x onerror=alert(1) />');

    expect(el.innerHTML).toContain('<img src="x">');
    expect(el.innerHTML).not.toContain('onerror');
  });

  test('sanitizeHTML strips svg onload handlers', () => {
    const dirty = '<svg onload="alert(1)"><circle cx="1" cy="1" r="1"></circle></svg>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('<svg>');
    expect(clean).not.toContain('onload=');
  });

  test('sanitizeHTML removes srcdoc attribute from iframes', () => {
    const dirty = '<iframe srcdoc="<script>alert(1)</script>" src="https://example.com"></iframe>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('srcdoc=');
  });

  test('sanitizeHTML strips dangerous formaction values', () => {
    const dirty = '<button formaction="javascript:alert(1)">go</button>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('<button>go</button>');
    expect(clean).not.toContain('formaction=');
  });

  test('sanitizeHTML strips data:text/html URLs', () => {
    const dirty = '<a href="data:text/html,<script>alert(1)</script>">x</a>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('<a>x</a>');
    expect(clean).not.toContain('data:text/html');
  });

  test('exports shared Trusted Types facade and createHTML wrapper', () => {
    expect(window.YouTubeTrustedTypes).toBeDefined();
    expect(typeof window.YouTubeTrustedTypes.createHTML).toBe('function');
    expect(window.YouTubeSafeDOM.createTrustedHTML('<b>x</b>')).toContain('<b>x</b>');
  });

  test('setHTML preserves TrustedHTML-like values for contextual fragment sinks', () => {
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    delete window._ytplusCreateHTML;

    const trustedValue = {
      __html: '<div data-safe="1">ok</div>',
      toString() {
        throw new Error('TrustedHTML should not be coerced to string');
      },
    };

    window.trustedTypes = {
      createPolicy: jest.fn((_name, rules) => ({
        createHTML: value => {
          trustedValue.__html = rules.createHTML(value);
          return trustedValue;
        },
        createScriptURL: value => value,
        createScript: value => value,
      })),
    };

    const originalCreateContextualFragment = Range.prototype.createContextualFragment;
    const received = [];
    Range.prototype.createContextualFragment = jest.fn(function (value) {
      received.push(value);
      const html = value && typeof value === 'object' && '__html' in value ? value.__html : value;
      return originalCreateContextualFragment.call(this, html);
    });

    require('../src/safe-dom.js');

    const el = document.createElement('div');
    window.YouTubeSafeDOM.setHTML(el, '<div data-safe="1">ok</div>', { sanitize: false });

    expect(received.at(-1)).toBe(trustedValue);
    expect(el.innerHTML).toContain('data-safe="1"');

    Range.prototype.createContextualFragment = originalCreateContextualFragment;
  });

  test('createTrustedHTML Trusted Types callback neutralises nested/malformed script confusion', () => {
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    delete window._ytplusCreateHTML;
    delete window.trustedTypes;

    window.trustedTypes = {
      createPolicy: (_name, rules) => ({
        createHTML: rules.createHTML,
        createScriptURL: rules.createScriptURL,
        createScript: rules.createScript,
      }),
    };

    require('../src/safe-dom.js');

    const dirty = '<scr<script>ipt>alert(1)</script>';
    const out = window.YouTubeSafeDOM.createTrustedHTML(dirty);

    const container = document.createElement('div');
    container.innerHTML = out;
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelectorAll('script').length).toBe(0);
  });

  test('createHTML sanitises tab-separated on* handlers via TT callback', () => {
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    delete window._ytplusCreateHTML;
    delete window.trustedTypes;

    window.trustedTypes = {
      createPolicy: (_name, rules) => ({
        createHTML: rules.createHTML,
        createScriptURL: rules.createScriptURL,
        createScript: rules.createScript,
      }),
    };

    require('../src/safe-dom.js');

    const dirty = '<div\tonclick="alert(1)">x</div>';
    const out = window.YouTubeSafeDOM.createHTML(dirty);
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out.toLowerCase()).not.toContain('alert(1)');
  });

  test('createHTML sanitises script inside svg context via TT callback', () => {
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    delete window._ytplusCreateHTML;
    delete window.trustedTypes;

    window.trustedTypes = {
      createPolicy: (_name, rules) => ({
        createHTML: rules.createHTML,
        createScriptURL: rules.createScriptURL,
        createScript: rules.createScript,
      }),
    };

    require('../src/safe-dom.js');

    const dirty = '<svg><script>alert(1)</script></svg>';
    const out = window.YouTubeSafeDOM.createHTML(dirty);
    expect(out.toLowerCase()).not.toContain('alert(1)');
    expect(out.toLowerCase()).not.toContain('<script');
  });

  test('createHTML sanitises noscript and template via TT callback', () => {
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    delete window._ytplusCreateHTML;
    delete window.trustedTypes;

    window.trustedTypes = {
      createPolicy: (_name, rules) => ({
        createHTML: rules.createHTML,
        createScriptURL: rules.createScriptURL,
        createScript: rules.createScript,
      }),
    };

    require('../src/safe-dom.js');

    const dirty =
      '<noscript><img src=x onerror=alert(1)></noscript><template><script>alert(2)</script></template>';
    const out = window.YouTubeSafeDOM.createHTML(dirty);
    expect(out.toLowerCase()).not.toContain('<noscript');
    expect(out.toLowerCase()).not.toContain('<template');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out.toLowerCase()).not.toContain('alert(1)');
    expect(out.toLowerCase()).not.toContain('alert(2)');
  });

  test('createTrustedHTML Trusted Types callback allows safe markup and works on innerHTML sink', () => {
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    delete window._ytplusCreateHTML;
    delete window.trustedTypes;

    window.trustedTypes = {
      createPolicy: (_name, rules) => ({
        createHTML: rules.createHTML,
        createScriptURL: rules.createScriptURL,
        createScript: rules.createScript,
      }),
    };

    require('../src/safe-dom.js');

    const trusted = window.YouTubeSafeDOM.createTrustedHTML('<b>ok</b>');
    const div = document.createElement('div');
    expect(() => {
      div.innerHTML = /** @type {any} */ (trusted);
    }).not.toThrow();
    expect(div.querySelector('b')?.textContent).toBe('ok');
  });

  test('renderTemplateClone sanitizes dangerous tags and event attributes', () => {
    const el = document.createElement('div');
    window.YouTubeSafeDOM.renderTemplateClone(
      el,
      '<div class="safe"><script>alert(1)</script><a href="javascript:alert(2)" onclick="alert(3)">link</a></div>'
    );
    expect(el.querySelector('script')).toBeNull();
    const link = el.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBeNull();
    expect(link?.getAttribute('onclick')).toBeNull();
    expect(link?.textContent).toBe('link');
  });

  test('sanitizeAttribute blocks vbscript: and javascript: URLs', () => {
    expect(window.YouTubeSafeDOM.sanitizeAttribute('href', 'javascript:alert(1)')).toBeNull();
    expect(window.YouTubeSafeDOM.sanitizeAttribute('href', 'vbscript:msgbox(1)')).toBeNull();
    expect(window.YouTubeSafeDOM.sanitizeAttribute('src', 'VBSCRIPT:msgbox(1)')).toBeNull();
    expect(window.YouTubeSafeDOM.sanitizeAttribute('href', 'https://youtube.com')).toBe(
      'https://youtube.com'
    );
    expect(window.YouTubeSafeDOM.sanitizeAttribute('href', 'data:text/html,bad')).toBeNull();
    expect(window.YouTubeSafeDOM.sanitizeAttribute('src', 'data:image/png;base64,abc')).toBe(
      'data:image/png;base64,abc'
    );
    expect(window.YouTubeSafeDOM.sanitizeAttribute('onclick', 'alert(1)')).toBeNull();
    expect(window.YouTubeSafeDOM.sanitizeAttribute('', 'val')).toBeNull();
    expect(window.YouTubeSafeDOM.sanitizeAttribute('title', null)).toBe('');
  });

  test('setText safely updates textContent without parsing HTML', () => {
    const el = document.createElement('div');
    window.YouTubeSafeDOM.setText(el, '<b>raw text</b>');
    expect(el.textContent).toBe('<b>raw text</b>');
    expect(el.querySelector('b')).toBeNull();

    window.YouTubeSafeDOM.setText(el, null);
    expect(el.textContent).toBe('');
  });

  test('escapeHTML escapes special HTML characters', () => {
    expect(window.YouTubeSafeDOM.escapeHTML('<script>alert("x & y")</script>')).toContain(
      '&lt;script&gt;'
    );
    expect(window.YouTubeSafeDOM.escapeHTML('')).toBe('');
    expect(window.YouTubeSafeDOM.escapeHTML(null)).toBe('');
  });

  test('setAttributeSafe validates and sets safe attributes on elements', () => {
    const el = document.createElement('a');
    expect(window.YouTubeSafeDOM.setAttributeSafe(el, 'href', 'https://example.com')).toBe(true);
    expect(el.getAttribute('href')).toBe('https://example.com');

    expect(window.YouTubeSafeDOM.setAttributeSafe(el, 'href', 'javascript:alert(1)')).toBe(false);
    expect(window.YouTubeSafeDOM.setAttributeSafe(el, 'onclick', 'alert(1)')).toBe(false);
  });

  test('isSafeUrl allows safe protocols and relative URLs, rejects dangerous schemes', () => {
    expect(window.YouTubeSafeDOM.isSafeUrl('https://youtube.com')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('http://youtube.com')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('/watch?v=123')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('#comments')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('mailto:test@example.com')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:image/png;base64,xxx')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:image/jpeg;base64,xxx')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:image/webp;base64,xxx')).toBe(true);

    expect(window.YouTubeSafeDOM.isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('vbscript:msgbox(1)')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:text/html,bad')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:application/javascript,bad')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('blob:https://youtube.com/uuid')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('//evil.com/path')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('  ')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl(123)).toBe(false);
  });

  test('createHTML converts and handles nullish values safely', () => {
    expect(window.YouTubeSafeDOM.createHTML(null)).toBe('');
    expect(window.YouTubeSafeDOM.createHTML(undefined)).toBe('');
    expect(window.YouTubeSafeDOM.createHTML(123)).toBe('123');
    expect(window.YouTubeSafeDOM.createHTML('<div>test</div>')).toContain('<div>test</div>');
  });

  test('createFragment sanitizes untrusted input in non-TrustedTypes environment (Firefox/jsdom)', () => {
    delete window.trustedTypes;
    const dirty =
      '<div><span>safe</span><script>alert("xss")</script><img src="x" onerror="alert(1)"><a href="javascript:alert(2)">link</a></div>';
    const fragment = window.YouTubeSafeDOM.createFragment(dirty);

    const container = document.createElement('div');
    container.appendChild(fragment);

    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.querySelector('span')?.textContent).toBe('safe');
  });

  test('createFragment preserves inert Tabview state attributes without allowing handlers', () => {
    const fragment = window.YouTubeSafeDOM.createFragment(`
      <a tyt-tab-content="#tab-info" tyt-di="tab" onclick="alert(1)">Info</a>
      <div id="tab-info" tyt-hidden userscript-scrollbar-render></div>
      <svg><path vector-effect="non-scaling-stroke" onload="alert(2)"></path></svg>
    `);
    const container = document.createElement('div');
    container.append(fragment);

    const button = container.querySelector('a');
    const panel = container.querySelector('#tab-info');
    const path = container.querySelector('path');
    expect(button?.getAttribute('tyt-tab-content')).toBe('#tab-info');
    expect(button?.getAttribute('tyt-di')).toBe('tab');
    expect(button?.hasAttribute('onclick')).toBe(false);
    expect(panel?.hasAttribute('tyt-hidden')).toBe(true);
    expect(panel?.hasAttribute('userscript-scrollbar-render')).toBe(true);
    expect(path?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(path?.hasAttribute('onload')).toBe(false);
  });

  test('renderTemplateClone and setHTML sanitize malicious input into element', () => {
    const el = document.createElement('div');
    window.YouTubeSafeDOM.renderTemplateClone(
      el,
      '<div onclick="alert(1)"><iframe srcdoc="<b>bad</b>"></iframe><b>valid</b></div>'
    );
    expect(el.querySelector('b')?.textContent).toBe('valid');
    expect(el.innerHTML).not.toContain('onclick');
    expect(el.innerHTML).not.toContain('<iframe');
  });

  test('sanitizeHTML strips dialog modal overlay (acceptance payload)', () => {
    const dirty =
      '<dialog open id="yp-modal" style="position:fixed;inset:0;z-index:2147483647;background:white"><a href="https://evil.example/collect">Security update</a><img src="https://evil.example/pixel"></dialog>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).not.toContain('<dialog');
    expect(clean).not.toContain('style=');
    expect(clean).not.toContain('id=');
    expect(clean).not.toContain('evil.example');
  });

  test('sanitizeHTML removes disallowed tags (details, form, object, embed, noscript, template)', () => {
    const dirty =
      '<details><summary>x</summary></details><form><input></form><object data="x"></object><embed><noscript><b>n</b></noscript><template>t</template><b>kept</b>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('<b>kept</b>');
    expect(clean).not.toContain('<details');
    expect(clean).not.toContain('<form');
    expect(clean).not.toContain('<object');
    expect(clean).not.toContain('<embed');
    expect(clean).not.toContain('<noscript');
    expect(clean).not.toContain('<template');
  });

  test('sanitizeHTML preserves safe display style and id but strips name', () => {
    const dirty = '<div id="x" name="y" style="display:none" class="ok">ok</div>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('id="x"');
    expect(clean).toContain('style="display: none"');
    expect(clean).not.toContain('name=');
  });

  test('sanitizeHTML preserves data-* attributes', () => {
    const dirty = '<div data-action="open" data-feature-id="abc" class="c">x</div>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('data-action="open"');
    expect(clean).toContain('data-feature-id="abc"');
  });

  test('sanitizeHTML strips non-allowlisted attributes from allowed tags', () => {
    const dirty = '<div contenteditable="true" tabindex="0" data-x="1">x</div>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('tabindex="0"');
    expect(clean).toContain('data-x="1"');
    expect(clean).not.toContain('contenteditable');
  });

  test('sanitizeHTML preserves SVG child attributes (viewBox, d, points, stroke-*)', () => {
    const dirty =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3L21 21"></path><polyline points="6 9 12 15 18 9"></polyline></svg>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean.toLowerCase()).toContain('viewbox="0 0 24 24"');
    expect(clean).toContain('stroke-width="2"');
    expect(clean).toContain('<path d="M3 3L21 21"></path>');
    expect(clean).toContain('points="6 9 12 15 18 9"');
  });

  test('sanitizeHTML preserves input attributes (type, placeholder, maxlength, value, checked)', () => {
    const dirty =
      '<input type="text" placeholder="hi" maxlength="5" value="abc" checked autocomplete="off" spellcheck="false">';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('type="text"');
    expect(clean).toContain('placeholder="hi"');
    expect(clean).toContain('maxlength="5"');
    expect(clean).toContain('value="abc"');
    expect(clean).toContain('autocomplete="off"');
    expect(clean).toContain('spellcheck="false"');
  });

  test('sanitizeHTML preserves label for= and option value/selected', () => {
    const dirty =
      '<label for="inp">L</label><select><option value="a" selected>A</option><option value="b">B</option></select>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('for="inp"');
    expect(clean).toContain('value="a"');
    expect(clean).toContain('selected');
  });

  test('sanitizeHTML preserves a target/rel attributes', () => {
    const dirty =
      '<a href="https://github.com/x" target="_blank" rel="noopener noreferrer" class="link">x</a>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain('href="https://github.com/x"');
  });

  test('isSafeUrl blocks protocol-relative URLs (//host)', () => {
    expect(window.YouTubeSafeDOM.isSafeUrl('//evil.com/path')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('//evil.com')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('  //evil.com  ')).toBe(false);
  });

  test('isSafeUrl blocks blob: URIs', () => {
    expect(window.YouTubeSafeDOM.isSafeUrl('blob:https://example.com/uuid')).toBe(false);
  });

  test('isSafeUrl narrows data: to image subtypes only', () => {
    expect(window.YouTubeSafeDOM.isSafeUrl('data:image/png;base64,x')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:image/jpeg;base64,x')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:image/gif;base64,x')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:image/webp;base64,x')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:image/svg+xml,<svg>')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:image/avif;base64,x')).toBe(true);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:application/json,{}')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('data:text/html,<script>')).toBe(false);
  });

  test('isSafeUrl fails closed on empty and whitespace', () => {
    expect(window.YouTubeSafeDOM.isSafeUrl('')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl('   ')).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl(null)).toBe(false);
    expect(window.YouTubeSafeDOM.isSafeUrl(undefined)).toBe(false);
  });

  test('sanitizeHTML keeps approved layout styles and strips dangerous CSS', () => {
    const dirty =
      '<div style="display:none;position:fixed;background:url(javascript:alert(1));opacity:0.8">x</div>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);
    expect(clean).toContain('display: none');
    expect(clean).toContain('opacity: 0.8');
    expect(clean).not.toContain('position');
    expect(clean).not.toContain('url(');
    expect(clean).not.toContain('javascript:');
    const container = document.createElement('div');
    container.innerHTML = clean;
    expect(container.firstElementChild?.textContent).toBe('x');
  });

  test('sanitizeHTML preserves headings and safe styles required by settings UI', () => {
    const dirty =
      '<div><h1>YouTube +</h1><h2>Settings</h2><div class="submenu" style="display:none">x</div></div>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);
    const container = document.createElement('div');
    container.innerHTML = clean;

    expect(container.querySelector('h1')?.textContent).toBe('YouTube +');
    expect(container.querySelector('h2')?.textContent).toBe('Settings');
    expect(container.querySelector('.submenu')?.style.display).toBe('none');
  });

  test('sanitizeHTML blocks //host URLs in href', () => {
    const dirty = '<a href="//evil.com/steal">link</a>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);
    expect(clean).not.toContain('href=');
    expect(clean).toContain('link');
  });

  test('sanitizeHTML blocks blob: URLs in img src', () => {
    const dirty = '<img src="blob:https://evil.com/x">';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);
    expect(clean).not.toContain('src=');
  });

  test('sanitizeHTML narrows data: to image subtypes in img src', () => {
    const ok = window.YouTubeSafeDOM.sanitizeHTML('<img src="data:image/png;base64,abc">');
    expect(ok).toContain('src=');
    const bad = window.YouTubeSafeDOM.sanitizeHTML('<img src="data:text/html,<script>">');
    expect(bad).not.toContain('src=');
  });

  test('createTrustedHTML is pure TT wrapping (no sanitization)', () => {
    const raw = '<script>alert(1)</script>';
    const wrapped = window.YouTubeSafeDOM.createTrustedHTML(raw);
    expect(wrapped).toContain('<script>');
    expect(wrapped).toContain('alert(1)');
  });

  test('createHTML sanitizes then wraps in TrustedHTML', () => {
    const dirty = '<script>alert(1)</script><b>ok</b>';
    const result = window.YouTubeSafeDOM.createHTML(dirty);
    expect(result).not.toContain('<script>');
    expect(result).toContain('<b>ok</b>');
  });

  test('createHTML returns empty string for nullish input', () => {
    expect(window.YouTubeSafeDOM.createHTML(null)).toBe('');
    expect(window.YouTubeSafeDOM.createHTML(undefined)).toBe('');
  });

  test('security regression: known malicious payloads are neutralised', () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<iframe srcdoc="<script>alert(1)</script>">',
      '<a href="javascript:alert(1)">x</a>',
      '<button formaction="javascript:alert(1)">x</button>',
      '<div style="background:url(javascript:alert(1))">x</div>',
      '<img src="data:text/html,<script>alert(1)</script>">',
      '<img src="//evil.com/steal">',
      '<img src="blob:https://evil.com/x">',
      '<scr<script>ipt>alert(1)</script>',
      '<div onmouseover="alert(1)">x</div>',
      '<input onfocus="alert(1)" autofocus>',
      '<body onload="alert(1)">',
      '<video poster="javascript:alert(1)">',
      '<link href="javascript:alert(1)">',
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
      '<object data="javascript:alert(1)">',
      '<embed src="javascript:alert(1)">',
      '<style>body{background:url("javascript:alert(1)")}</style>',
      '<math><mtext><table><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=1>">',
    ];
    for (const payload of payloads) {
      const clean = window.YouTubeSafeDOM.sanitizeHTML(payload);
      expect(clean).not.toContain('alert(1)');
      expect(clean).not.toMatch(/onerror|onload|onfocus|onmouseover|onsubmit/i);
      expect(clean).not.toContain('javascript:');
      expect(clean).not.toContain('//evil.com');
      expect(clean).not.toContain('blob:');
    }
  });

  // ---------------------------------------------------------------------
  // Functional/ARIA attributes survive without weakening guards
  // ---------------------------------------------------------------------
  test('sanitizeHTML preserves disabled on read-only controls (mouse/keyboard inert)', () => {
    const dirty =
      '<button type="button" disabled class="yp-vote-btn" data-vote="1" aria-label="Like">Click</button>' +
      '<input type="text" disabled readonly required placeholder="locked">' +
      '<textarea disabled readonly placeholder="locked"></textarea>' +
      '<select disabled><option value="a" disabled>opt</option></select>' +
      '<option disabled>standalone</option>';

    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    // The disabled state survives on every interactive element.
    expect((clean.match(/disabled/g) || []).length).toBe(6);
    expect(clean).toContain('readonly');
    expect(clean).toContain('required');

    // Behavioral: a sanitized disabled button is inert for mouse and keyboard.
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.YouTubeSafeDOM.setHTML(
      host,
      '<button type="button" disabled id="ro-btn">Click</button>'
    );
    const roButton = document.getElementById('ro-btn');
    expect(roButton?.disabled).toBe(true);
    let clicks = 0;
    roButton?.addEventListener('click', () => clicks++);
    roButton?.click();
    roButton?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clicks).toBe(0);
  });

  test('sanitizeHTML preserves slider min/max/value/step, numeric ARIA and accessible name', () => {
    const dirty =
      '<div class="yp-ba-divider" role="slider" aria-label="Before and after comparison" ' +
      'aria-valuenow="50" aria-valuemin="2" aria-valuemax="98" aria-orientation="horizontal" ' +
      'tabindex="0"></div>' +
      '<input type="range" min="2" max="98" step="1" value="50" aria-labelledby="ba-label">';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    expect(clean).toContain('aria-valuenow="50"');
    expect(clean).toContain('aria-valuemin="2"');
    expect(clean).toContain('aria-valuemax="98"');
    expect(clean).toContain('aria-orientation="horizontal"');
    expect(clean).toContain('aria-label="Before and after comparison"');
    expect(clean).toContain('aria-labelledby="ba-label"');
    expect(clean).toContain('min="2"');
    expect(clean).toContain('max="98"');
    expect(clean).toContain('step="1"');
    expect(clean).toContain('value="50"');
  });

  test('sanitizeHTML rejects malformed numeric ARIA values (fail-closed validation)', () => {
    const dirty =
      '<div role="slider" aria-valuenow="50;url(javascript:alert(1))" aria-valuemin="&lt;script&gt;" ' +
      'aria-valuemax="2 3" tabindex="0"></div>';
    const clean = window.YouTubeSafeDOM.sanitizeHTML(dirty);

    // Invalid numeric values are stripped together with any payload inside.
    expect(clean).not.toContain('aria-valuenow="50;');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('aria-valuemax="2 3"');
    // The element itself and its safe attributes survive.
    expect(clean).toContain('role="slider"');
    expect(clean).toContain('tabindex="0"');
  });

  test('real voting read-only template renders disabled vote buttons through setHTML', () => {
    // Mirrors src/voting.js renderPreview/renderFeatureCard read-only mode:
    const template =
      '<div class="yp-preview-card">' +
      '<button class="yp-vote-bar-btn" id="yp-vote-bar-up" data-vote="1" disabled type="button" aria-label="Like">' +
      '</button>' +
      '<button class="yp-vote-bar-btn" id="yp-vote-bar-down" data-vote="-1" disabled type="button" aria-label="Dislike">' +
      '</button>' +
      '</div>';

    const host = document.createElement('div');
    document.body.appendChild(host);
    window.YouTubeSafeDOM.setHTML(host, template);

    const upButton = document.getElementById('yp-vote-bar-up');
    const downButton = document.getElementById('yp-vote-bar-down');
    expect(upButton?.disabled).toBe(true);
    expect(downButton?.disabled).toBe(true);

    // Read-only declaration is exposed to assistive technology.
    expect(upButton?.getAttribute('aria-label')).toBe('Like');
  });

  test('sanitizeHTML preserves the before/after divider slider from the voting template', () => {
    // Mirrors src/voting.js renderPreview: the real divider markup goes through
    // setHTML on every /watch mount.
    const template =
      '<div class="yp-ba-divider" style="left: 50%;" role="slider" ' +
      'aria-label="Before and after comparison" aria-valuenow="50" aria-valuemin="2" ' +
      'aria-valuemax="98" tabindex="0"></div>';

    const host = document.createElement('div');
    document.body.appendChild(host);
    window.YouTubeSafeDOM.setHTML(host, template);

    const divider = host.querySelector('.yp-ba-divider');
    expect(divider).toBeTruthy();
    expect(divider?.getAttribute('role')).toBe('slider');
    expect(divider?.getAttribute('aria-valuenow')).toBe('50');
    expect(divider?.getAttribute('aria-valuemin')).toBe('2');
    expect(divider?.getAttribute('aria-valuemax')).toBe('98');
    expect(divider?.getAttribute('aria-label')).toBe('Before and after comparison');
    expect(divider?.getAttribute('tabindex')).toBe('0');
  });

  test('sanitizeHTML keeps the dangerous-element and URL guards (regression corpus)', () => {
    const payloads = [
      '<button onclick="alert(1)" formaction="javascript:alert(2)">x</button>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '<object data="data:text/html,<script>alert(1)</script>"></object>',
      '<embed src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
      '<style>@import url("//evil.com")</style>',
      '<textarea onfocus="alert(1)" formaction="javascript:alert(2)">x</textarea>',
      '<option onmouseover="alert(1)" value="x">opt</option>',
      '<select onchange="alert(1)" disabled></select>',
    ];
    for (const payload of payloads) {
      const clean = window.YouTubeSafeDOM.sanitizeHTML(payload);
      expect(clean).not.toContain('alert(1)');
      expect(clean).not.toMatch(/onerror|onload|onfocus|onmouseover|onsubmit|onclick|onchange/i);
      expect(clean).not.toContain('javascript:');
      expect(clean).not.toContain('//evil.com');
    }
  });

  test('fragment, attribute and text helpers keep their fail-closed edge branches', () => {
    const S = window.YouTubeSafeDOM;

    // createFragment with no input yields an empty fragment.
    const empty = S.createFragment(null);
    expect(empty.childNodes.length).toBe(0);

    // setAttributeSafe rejects a non-element target.
    expect(S.setAttributeSafe(null, 'title', 'x')).toBe(false);

    // setAttributeSafe fails closed when the DOM rejects the write.
    const el = document.createElement('div');
    el.setAttribute = () => {
      throw new Error('blocked');
    };
    expect(S.setAttributeSafe(el, 'title', 'x')).toBe(false);

    // sanitizeText strips markup, scheme and handler text.
    const text = S.sanitizeText('<b>a</b> javascript:alert onerror=1');
    expect(text).not.toContain('<');
    expect(text).not.toContain('javascript:');
    expect(text).not.toContain('onerror=');

    // isValidVideoId accepts only the 11-character id shape.
    expect(S.isValidVideoId('dQw4w9WgXcQ')).toBe(true);
    expect(S.isValidVideoId('short')).toBe(false);

    // A URL that cannot be parsed fails closed, and a style value that could
    // load a resource is dropped.
    expect(S.isSafeUrl('http://[bad')).toBe(false);
    expect(
      S.sanitizeHTML('<div style="background:url(//evil.example/x);color:red">t</div>')
    ).not.toContain('url(');
  });
});

describe('Trusted Types ownership', () => {
  /** Emulate a userscript-manager TT registry: creating 'default' sets it. */
  const installTT = () => {
    const tt = { defaultPolicy: null };
    tt.createPolicy = (name, rules) => {
      const policy = {
        name,
        createHTML: value => ({ __tt: true, html: String(rules.createHTML(value)) }),
      };
      if (name === 'default') tt.defaultPolicy = policy;
      return policy;
    };
    Object.defineProperty(window, 'trustedTypes', {
      configurable: true,
      writable: true,
      value: tt,
    });
    return tt;
  };

  afterEach(() => {
    delete window.trustedTypes;
  });

  test('safe-dom creates only the named policy; policy createHTML sanitizes; policy object is not published', () => {
    const tt = installTT();
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    delete window._ytplusCreateHTML;
    require('../src/safe-dom.js');

    // Only the single named owner — no 'default' policy is created.
    expect(tt.defaultPolicy).toBeNull();
    // The policy object itself is not published through the facade.
    expect(window.YouTubeTrustedTypes.policy).toBeUndefined();

    // Sink-level protection: the named policy's createHTML sanitizes.
    const trusted = window.YouTubeSafeDOM.createTrustedHTML('<img src=x onerror=alert(1)>');
    expect(String(trusted.__html ?? trusted)).not.toContain('onerror');
  });

  /** Reinstall safe-dom with a TT registry whose policy exposes the raw rules. */
  const installTTWithRules = createPolicy => {
    const tt = { defaultPolicy: null, rules: null };
    tt.createPolicy = createPolicy
      ? (name, rules) => {
          tt.rules = rules;
          return createPolicy(name, rules);
        }
      : (name, rules) => {
          tt.rules = rules;
          tt.defaultPolicy = null;
          // A real Trusted Types value stringifies to its markup; jsdom sinks
          // rely on that coercion, so the stub must behave the same way.
          const wrap = value => ({
            __tt: true,
            html: String(value),
            toString() {
              return this.html;
            },
          });
          return {
            name,
            createHTML: value => wrap(rules.createHTML(value)),
          };
        };
    Object.defineProperty(window, 'trustedTypes', {
      configurable: true,
      writable: true,
      value: tt,
    });
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    require('../src/safe-dom.js');
    return tt;
  };

  test('the named policy rules themselves normalize non-string and nested input', () => {
    const tt = installTTWithRules();
    const S = window.YouTubeSafeDOM;
    // The policy is created lazily on first use.
    S.getTrustedTypesPolicy();
    const rules = tt.rules;

    // createHTML is idempotent while it is already sanitizing (reentrancy) and
    // stringifies non-string / nullish input instead of trusting it.
    expect(String(rules.createHTML(42))).toBe('42');
    expect(String(rules.createHTML(null))).toBe('');
    expect(String(rules.createHTML('<b>ok</b>'))).toContain('ok');
  });

  test('facade helpers normalize non-string input before wrapping', () => {
    installTTWithRules();
    const S = window.YouTubeSafeDOM;

    expect(String(S.createTrustedHTML(42).html)).toBe('42');
    expect(String(S.createTrustedHTML(null).html)).toBe('');
  });

  test('policy creation failure fails closed to the unsanitized caller path', () => {
    installTTWithRules(() => {
      throw new Error('policy refused');
    });

    expect(window.YouTubeSafeDOM.getTrustedTypesPolicy()).toBeNull();
    // Without a policy the facade returns its input unchanged; sanitization is
    // then guaranteed by the DOM-level pass in sanitizeHTML/createFragment.
    expect(window.YouTubeSafeDOM.createTrustedHTML('<b>ok</b>')).toBe('<b>ok</b>');
    expect(window.YouTubeSafeDOM.sanitizeHTML('<img src=x onerror=alert(1)>')).not.toContain(
      'onerror'
    );
  });

  test('a TT-enforced page sink still throws TypeError for string innerHTML after boot', () => {
    const tt = installTT();
    jest.resetModules();
    require('../src/safe-dom.js');

    const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true,
      get() {
        return originalDescriptor.get.call(this);
      },
      set(value) {
        // Browser contract under `require-trusted-types-for 'script'` with
        // defaultPolicy === null: raw strings are rejected at the sink.
        if (typeof value === 'string' && !tt.defaultPolicy) {
          originalDescriptor.set.call(this, value);
          throw new TypeError("This document requires 'TrustedHTML' assignments.");
        }
        originalDescriptor.set.call(this, value);
      },
    });
    try {
      const el = document.createElement('div');
      expect(() => {
        el.innerHTML = '<img src=x onerror=alert(1)>';
      }).toThrow(TypeError);
    } finally {
      Object.defineProperty(Element.prototype, 'innerHTML', originalDescriptor);
    }
  });

  test('main.js creates no default policy — safe-dom is the single TT owner', async () => {
    jest.resetModules();
    Object.defineProperty(globalThis, 'GM_addElement', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    require('../src/design-system.js');
    const realGetStyle = window.YouTubePlusDesignSystem?.getStyle;
    window.YouTubePlusDesignSystem = {
      StyleManager: { add: jest.fn(), remove: jest.fn() },
      getStyle: realGetStyle,
    };
    require('../src/cleanup-manager.js');
    require('../src/utils.js');

    // The overlay (and therefore the injected page script) activates only where
    // it can bind, so boot on a watch page for this inspection.
    mockLocation({ href: 'https://www.youtube.com/watch?v=safe-dom-tt' });

    require('../src/main.js');

    // The duplicated default-policy block lived inside the serialized
    // executionScript that runs in the PAGE realm — execute it there.
    const [, , attrs] = globalThis.GM_addElement.mock.calls[0];
    const iframe = document.createElement('iframe');
    iframe.src = `${window.location.origin}/watch?v=safe-dom-tt`;
    document.body.append(iframe);
    const realm = iframe.contentWindow;
    const realmTT = { defaultPolicy: null };
    realmTT.createPolicy = (name, rules) => {
      const policy = {
        name,
        createHTML: value => ({ __tt: true, html: String(rules.createHTML(value)) }),
      };
      if (name === 'default') realmTT.defaultPolicy = policy;
      return policy;
    };
    Object.defineProperty(realm, 'trustedTypes', {
      configurable: true,
      writable: true,
      value: realmTT,
    });
    realm.YouTubePlusLogger = {
      createLogger: () => ({
        error() {
          /* mock */
        },
        warn() {
          /* mock */
        },
        info() {
          /* mock */
        },
        debug() {
          /* mock */
        },
        log() {
          /* mock */
        },
      }),
    };
    realm.IntersectionObserver = class {
      observe() {
        /* mock */
      }
      unobserve() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
    };
    realm.MutationObserver = class {
      observe() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
      takeRecords() {
        return [];
      }
    };
    realm.ResizeObserver = class {
      observe() {
        /* mock */
      }
      unobserve() {
        /* mock */
      }
      disconnect() {
        /* mock */
      }
    };
    realm.eval(attrs.textContent);
    // Let the realm's async boot path settle before tearing the frame down.
    await new Promise(resolve => setTimeout(resolve, 50));
    iframe.remove();

    expect(realmTT.defaultPolicy).toBeNull();
  });
});
