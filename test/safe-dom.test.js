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
    expect(typeof window._ytplusCreateHTML).toBe('function');
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

  test('createTrustedHTML Trusted Types callback strips tab-separated on* handlers', () => {
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
    const out = window.YouTubeSafeDOM.createTrustedHTML(dirty);
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out.toLowerCase()).not.toContain('alert(1)');
  });

  test('createTrustedHTML Trusted Types callback strips script inside svg context', () => {
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
    const out = window.YouTubeSafeDOM.createTrustedHTML(dirty);
    expect(out.toLowerCase()).not.toContain('alert(1)');
    expect(out.toLowerCase()).not.toContain('<script');
  });

  test('createTrustedHTML Trusted Types callback blocks noscript and template', () => {
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

    const dirty = '<noscript><img src=x onerror=alert(1)></noscript><template><script>alert(2)</script></template>';
    const out = window.YouTubeSafeDOM.createTrustedHTML(dirty);
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
});
