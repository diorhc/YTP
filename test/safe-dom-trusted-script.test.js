/**
 * @jest-environment jsdom
 *
 * safe-dom owns the single Trusted Types policy, so it also wraps script
 * strings for our own injections. The policy may be absent (no Trusted Types or
 * a refused policy), in which case the wrapper returns null and the caller
 * skips the sink instead of throwing.
 */

/** @param {unknown} trustedTypes undefined removes the global entirely. */
function loadSafeDom(trustedTypes) {
  jest.resetModules();
  if (trustedTypes === undefined) {
    delete window.trustedTypes;
  } else {
    Object.defineProperty(window, 'trustedTypes', {
      configurable: true,
      writable: true,
      value: trustedTypes,
    });
  }
  delete window.YouTubeSafeDOM;
  require('../src/safe-dom.js');
  return window.YouTubeSafeDOM;
}

afterEach(() => {
  delete window.trustedTypes;
  delete window.YouTubeSafeDOM;
  delete window.YouTubeTrustedTypes;
});

test('createTrustedScript returns null without Trusted Types', () => {
  const safe = loadSafeDom(undefined);
  expect(safe.createTrustedScript('x = 1')).toBeNull();
});

test('createTrustedScript returns null when the policy has no createScript', () => {
  const safe = loadSafeDom({
    createPolicy: (_name, rules) => ({ createHTML: value => rules.createHTML(value) }),
  });
  expect(safe.createTrustedScript('x = 1')).toBeNull();
});

test('createTrustedScript wraps the text through the policy createScript rule', () => {
  const safe = loadSafeDom({
    createPolicy: (_name, rules) => ({
      createHTML: value => rules.createHTML(value),
      createScript: value => rules.createScript(value),
    }),
  });
  expect(safe.createTrustedScript('x = 1')).toBe('x = 1');
  // A non-string is coerced, never passed through raw.
  expect(safe.createTrustedScript(/** @type {any} */ (null))).toBe('');
});
