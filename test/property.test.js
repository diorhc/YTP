const fc = require('fast-check');

// Deterministic seed for all property tests — set once, never change.
// To replay a failure: fc.assert(..., { seed: PROPERTY_TEST_SEED, path: '...' })
const PROPERTY_TEST_SEED = 20260821;

describe('Property: isSafeUrl', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    delete window._ytplusCreateHTML;
    require('../src/safe-dom.js');
  });

  it('javascript: scheme always rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0 }).map(s => `javascript:${s}`),
        url => {
          expect(window.YouTubeSafeDOM.isSafeUrl(url)).toBe(false);
        }
      ),
      { numRuns: 200, seed: PROPERTY_TEST_SEED }
    );
  });

  it('vbscript: scheme always rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0 }).map(s => `vbscript:${s}`),
        url => {
          expect(window.YouTubeSafeDOM.isSafeUrl(url)).toBe(false);
        }
      ),
      { numRuns: 200, seed: PROPERTY_TEST_SEED }
    );
  });

  it('data: non-image always rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(s => !s.startsWith('image/')),
        s => {
          expect(window.YouTubeSafeDOM.isSafeUrl(`data:${s}`)).toBe(false);
        }
      ),
      { numRuns: 200, seed: PROPERTY_TEST_SEED }
    );
  });

  it('protocol-relative //host always rejected', () => {
    fc.assert(
      fc.property(fc.domain(), host => {
        expect(window.YouTubeSafeDOM.isSafeUrl(`//${host}/path`)).toBe(false);
      }),
      { numRuns: 200, seed: PROPERTY_TEST_SEED }
    );
  });

  it('blob: scheme always rejected', () => {
    fc.assert(
      fc.property(fc.domain(), host => {
        expect(window.YouTubeSafeDOM.isSafeUrl(`blob:https://${host}/uuid`)).toBe(false);
      }),
      { numRuns: 100, seed: PROPERTY_TEST_SEED }
    );
  });

  it('relative (#, /) always accepted', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string().map(s => `#${s}`),
          fc
            .string()
            .filter(s => !s.startsWith('/'))
            .map(s => `/${s}`)
        ),
        url => {
          expect(window.YouTubeSafeDOM.isSafeUrl(url)).toBe(true);
        }
      ),
      { numRuns: 200, seed: PROPERTY_TEST_SEED }
    );
  });

  it('http/https always accepted', () => {
    fc.assert(
      fc.property(
        fc.domain(),
        fc.string({ minLength: 1 }).filter(s => !s.includes(' ')),
        (domain, path) => {
          expect(window.YouTubeSafeDOM.isSafeUrl(`https://${domain}/${path}`)).toBe(true);
          expect(window.YouTubeSafeDOM.isSafeUrl(`http://${domain}/${path}`)).toBe(true);
        }
      ),
      { numRuns: 100, seed: PROPERTY_TEST_SEED }
    );
  });
});

describe('Property: escapeHTML', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    require('../src/safe-dom.js');
  });

  it('output never contains raw < or >', () => {
    fc.assert(
      fc.property(fc.string(), text => {
        const result = window.YouTubeSafeDOM.escapeHTML(text);
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
      }),
      { numRuns: 300, seed: PROPERTY_TEST_SEED }
    );
  });

  it('empty input returns empty string', () => {
    expect(window.YouTubeSafeDOM.escapeHTML('')).toBe('');
    expect(window.YouTubeSafeDOM.escapeHTML(null)).toBe('');
    expect(window.YouTubeSafeDOM.escapeHTML(undefined)).toBe('');
  });
});

describe('Property: normalizeVoteType (real facade)', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusVoting;
    delete window.YouTubePlus;
    delete window.YouTubeUtils;
    window.YouTubeUtils = {
      t: k => k,
      createHTML: s => s,
      setSafeHTML: (el, html) => {
        if (el) el.innerHTML = html;
      },
      createIsRelevantRoute: () => () => true,
      createWithErrorBoundary: () => fn => fn,
      cleanupManager: { registerListener: jest.fn() },
      $: (sel, root) => (root || document).querySelector(sel),
      byId: id => document.getElementById(id),
      isSettingsModalOpen: () => false,
      helpers: {
        $: (sel, root) => (root || document).querySelector(sel),
        byId: id => document.getElementById(id),
        t: k => k,
        createHTML: s => s,
      },
    };
    window.YouTubePlus = {};
    require('../src/voting.js');
  });

  afterEach(() => {
    delete window.YouTubePlusVoting;
    delete window.YouTubePlus;
  });

  it('always returns 1, -1, or 0 (real function)', () => {
    fc.assert(
      fc.property(
        fc.anything().filter(v => typeof v !== 'symbol'),
        value => {
          const result = window.YouTubePlusVoting.normalizeVoteType(value);
          expect([1, -1, 0]).toContain(result);
        }
      ),
      { numRuns: 500, seed: PROPERTY_TEST_SEED }
    );
  });

  it('idempotent: normalize(normalize(x)) === normalize(x)', () => {
    fc.assert(
      fc.property(
        fc.anything().filter(v => typeof v !== 'symbol'),
        value => {
          const once = window.YouTubePlusVoting.normalizeVoteType(value);
          expect(window.YouTubePlusVoting.normalizeVoteType(once)).toBe(once);
        }
      ),
      { numRuns: 500, seed: PROPERTY_TEST_SEED }
    );
  });

  it('1 maps to 1, -1 maps to -1', () => {
    expect(window.YouTubePlusVoting.normalizeVoteType(1)).toBe(1);
    expect(window.YouTubePlusVoting.normalizeVoteType(-1)).toBe(-1);
    expect(window.YouTubePlusVoting.normalizeVoteType('1')).toBe(1);
    expect(window.YouTubePlusVoting.normalizeVoteType('-1')).toBe(-1);
  });

  // Regression: edge cases that must map correctly
  it('regression: NaN/undefined/null/empty-string/bool → 0', () => {
    const nvt = window.YouTubePlusVoting.normalizeVoteType;
    expect(nvt(NaN)).toBe(0);
    expect(nvt(undefined)).toBe(0);
    expect(nvt(null)).toBe(0);
    expect(nvt('')).toBe(0);
    expect(nvt(false)).toBe(0);
    expect(nvt(true)).toBe(1);
    expect(nvt('0')).toBe(0);
    expect(nvt('abc')).toBe(0);
    expect(nvt(Infinity)).toBe(0);
    expect(nvt([])).toBe(0);
    expect(nvt({})).toBe(0);
  });

  it('regression: numeric strings that coerce to 1/-1', () => {
    const nvt = window.YouTubePlusVoting.normalizeVoteType;
    expect(nvt('1.0')).toBe(1);
    expect(nvt('-1.0')).toBe(-1);
    expect(nvt(' 1 ')).toBe(1);
    expect(nvt(' -1 ')).toBe(-1);
  });
});

describe('Property: sanitizeHTML (security invariants)', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubeSafeDOM;
    delete window.YouTubeTrustedTypes;
    delete window._ytplusCreateHTML;
    require('../src/safe-dom.js');
  });

  it('never contains script tag in output', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), payload => {
        const html = `<script>${payload}</script>`;
        const result = window.YouTubeSafeDOM.sanitizeHTML(html).toLowerCase();
        expect(result).not.toContain('<script');
      }),
      { numRuns: 200, seed: PROPERTY_TEST_SEED }
    );
  });

  it('never contains blocked tags in output', () => {
    const blockedTags = [
      'iframe',
      'object',
      'embed',
      'form',
      'dialog',
      'details',
      'noscript',
      'template',
    ];
    fc.assert(
      fc.property(fc.constantFrom(...blockedTags), fc.string({ maxLength: 50 }), (tag, content) => {
        const html = `<${tag}>${content}</${tag}>`;
        const result = window.YouTubeSafeDOM.sanitizeHTML(html).toLowerCase();
        expect(result).not.toContain(`<${tag}`);
      }),
      { numRuns: 200, seed: PROPERTY_TEST_SEED }
    );
  });

  it('never contains on* event handlers in output', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('onclick', 'onload', 'onerror', 'onmouseover', 'onfocus', 'onblur'),
        fc.string({ maxLength: 50 }),
        (handler, payload) => {
          const html = `<div ${handler}="${payload}">text</div>`;
          const result = window.YouTubeSafeDOM.sanitizeHTML(html).toLowerCase();
          expect(result).not.toContain(handler);
        }
      ),
      { numRuns: 300, seed: PROPERTY_TEST_SEED }
    );
  });

  it('never contains javascript: in output', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0 }), payload => {
        const html = `<a href="javascript:${payload}">link</a><img src="javascript:${payload}">`;
        const result = window.YouTubeSafeDOM.sanitizeHTML(html).toLowerCase();
        expect(result).not.toContain('javascript:');
      }),
      { numRuns: 200, seed: PROPERTY_TEST_SEED }
    );
  });

  it('safe content survives: div/span/p/b with text', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('div', 'span', 'p', 'b', 'em', 'i'),
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter(s => !s.includes('<') && !s.includes('>') && !s.includes('&')),
        (tag, text) => {
          const html = `<${tag}>${text}</${tag}>`;
          const result = window.YouTubeSafeDOM.sanitizeHTML(html);
          expect(result).toContain(text);
        }
      ),
      { numRuns: 200, seed: PROPERTY_TEST_SEED }
    );
  });

  it('style attribute never survives sanitization', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('div', 'span', 'a', 'img', 'button'),
        fc.string({ maxLength: 30 }),
        (tag, val) => {
          const html = `<${tag} style="${val}">x</${tag}>`;
          const result = window.YouTubeSafeDOM.sanitizeHTML(html).toLowerCase();
          expect(result).not.toMatch(/style\s*=/);
        }
      ),
      { numRuns: 200, seed: PROPERTY_TEST_SEED }
    );
  });

  it('protocol-relative URLs never survive sanitization in href/src', () => {
    fc.assert(
      fc.property(fc.domain(), fc.constantFrom('a', 'img'), (host, tag) => {
        const attr = tag === 'a' ? 'href' : 'src';
        const html = `<${tag} ${attr}="//${host}/steal">x</${tag}>`;
        const result = window.YouTubeSafeDOM.sanitizeHTML(html).toLowerCase();
        expect(result).not.toContain(`//${host}`);
      }),
      { numRuns: 100, seed: PROPERTY_TEST_SEED }
    );
  });
});

// jsdom navigation errors ("Not implemented: navigation except hash changes")
// are emitted through jsdom's VirtualConsole, which bypasses global.console
// and cannot be intercepted via jest.spyOn. These errors are expected and
// harmless — jsdom intentionally stubs navigation. No test needed here; the
// global console mock in test/setup.js silently swallows them.
