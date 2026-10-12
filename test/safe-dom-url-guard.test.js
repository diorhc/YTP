/**
 * The attribute-level URL guard must use
 * the SAME allowlist/normalization as the HTML sanitizer (isSafeUrl), via
 * the PUBLIC setter — not just an internal helper.
 *
 * Browsers strip tab/newline/CR characters inside a URL scheme, so a naive
 * `startsWith('javascript:')` check is bypassable with `java\tscript:...`:
 * the DOM normalizes the protocol back to javascript: and the link becomes
 * executable. The attribute path previously kept such values while
 * sanitizeHTML correctly dropped them .
 */

describe('attribute URL guard agrees with the sanitizer', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    require('../src/safe-dom.js');
  });

  const anchor = () => document.createElement('a');

  test('control characters inside the scheme are rejected via the public setter', () => {
    const s = window.YouTubeSafeDOM;
    expect(s.setAttributeSafe(anchor(), 'href', 'java\tscript:alert(1)')).toBe(false);
    expect(s.setAttributeSafe(anchor(), 'href', 'java\nscript:alert(1)')).toBe(false);
    expect(s.setAttributeSafe(anchor(), 'href', 'java\rscript:alert(1)')).toBe(false);
  });

  test('plain dangerous schemes are rejected (case-insensitive)', () => {
    const s = window.YouTubeSafeDOM;
    expect(s.setAttributeSafe(anchor(), 'href', 'javascript:alert(1)')).toBe(false);
    expect(s.setAttributeSafe(anchor(), 'href', 'JaVaScRiPt:alert(1)')).toBe(false);
    expect(s.setAttributeSafe(anchor(), 'href', ' vbscript:msgbox ')).toBe(false);
    expect(s.setAttributeSafe(anchor(), 'src', 'javascript:alert(1)')).toBe(false);
  });

  test('data: URIs follow the sanitizer image-only allowlist', () => {
    const s = window.YouTubeSafeDOM;
    expect(s.setAttributeSafe(anchor(), 'src', 'data:image/png;base64,AAAA')).toBe(true);
    expect(s.setAttributeSafe(anchor(), 'href', 'data:text/html,<script>alert(1)</script>')).toBe(
      false
    );
    expect(s.setAttributeSafe(anchor(), 'href', 'data:image/svg+xml,<svg/>')).toBe(true);
  });

  test('relative and allowed absolute URLs still pass', () => {
    const s = window.YouTubeSafeDOM;
    expect(s.setAttributeSafe(anchor(), 'href', 'https://www.youtube.com/watch?v=x')).toBe(true);
    expect(s.setAttributeSafe(anchor(), 'href', '/watch?v=x')).toBe(true);
    expect(s.setAttributeSafe(anchor(), 'href', '#section')).toBe(true);
    expect(s.setAttributeSafe(anchor(), 'href', 'mailto:support@example.com')).toBe(true);
  });

  test('protocol-relative scheme is rejected consistently with the sanitizer', () => {
    const s = window.YouTubeSafeDOM;
    expect(s.setAttributeSafe(anchor(), 'href', '//evil.example/x')).toBe(false);
  });

  test('the HTML sanitizer agrees with the attribute guard on the same values', () => {
    const s = window.YouTubeSafeDOM;
    const cases = [
      'java\tscript:alert(1)',
      'javascript:alert(1)',
      'vbscript:alert(1)',
      'https://www.youtube.com/watch?v=x',
      '/relative/path',
      '#anchor',
      'data:image/png;base64,AAAA',
      'data:text/html,<b>x</b>',
    ];
    for (const value of cases) {
      const el = anchor();
      const attrAccepted = s.setAttributeSafe(el, 'href', value);
      // Sanitizer verdict on the same value: does a link with this href
      // survive sanitizeHTML?
      const survived = s.sanitizeHTML(`<a href="${value}">x</a>`).includes('<a ');
      // The guard must never ACCEPT what the sanitizer rejects.
      expect(attrAccepted).toBe(survived);
    }
  });

  test('SVG xlink:href goes through the same URL guard', () => {
    const s = window.YouTubeSafeDOM;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    expect(s.setAttributeSafe(svg, 'xlink:href', 'javascript:alert(1)')).toBe(false);
    expect(s.setAttributeSafe(svg, 'xlink:href', 'https://www.youtube.com/')).toBe(true);
    expect(svg.getAttribute('xlink:href')).toBe('https://www.youtube.com/');
  });
});
