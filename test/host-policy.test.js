/**
 * Host policy: which host classes a module runs on. The implementation is a
 * single module (src/host-policy.js) that the build inlines into the bundle
 * prologue with the manifest table; both forms are covered here. jsdom pins
 * location.hostname, so the host mapping is exercised through the pure factory
 * in a vm sandbox.
 * @jest-environment jsdom
 */

describe('src/host-policy.js', () => {
  const { createHostPolicy } = require('../src/host-policy.js');

  test('carries the table and defaults a missing entry to youtube-only', () => {
    const policy = createHostPolicy({ dual: ['youtube', 'myactivity'], yt: ['youtube'] });
    expect(policy.table).toEqual({ dual: ['youtube', 'myactivity'], yt: ['youtube'] });
    // The jsdom host is www.youtube.com.
    expect(policy.hostClass()).toBe('youtube');
    expect(policy.runs('dual')).toBe(true);
    expect(policy.runs('yt')).toBe(true);
    expect(policy.ownsSharedSettings()).toBe(true);
  });

  test('an empty table is a valid youtube-only policy', () => {
    const policy = createHostPolicy();
    expect(policy.hostClass()).toBe('youtube');
    expect(policy.runs('anything')).toBe(true);
  });
});

describe('build host policy prologue', () => {
  const vm = require('vm');
  const { buildHostPolicyPrelude } = require('../build.js');

  /** Run the emitted prologue in a sandbox for the given host. */
  const runAt = host => {
    const prelude = buildHostPolicyPrelude([
      { name: 'dual.js', hosts: ['youtube', 'myactivity'] },
      { name: 'yt.js', hosts: ['youtube'] },
    ]);
    const sandbox = vm.createContext({ window: {}, location: { hostname: host } });
    vm.runInContext(prelude, sandbox);
    return vm.runInContext('window.YouTubePlusHostPolicy', sandbox);
  };

  test('dual modules run on youtube and myactivity; youtube-only only on youtube', () => {
    const yt = runAt('www.youtube.com');
    expect(yt.hostClass()).toBe('youtube');
    expect(yt.runs('dual.js')).toBe(true);
    expect(yt.runs('yt.js')).toBe(true);

    const my = runAt('myactivity.google.com');
    expect(my.hostClass()).toBe('myactivity');
    expect(my.runs('dual.js')).toBe(true);
    expect(my.runs('yt.js')).toBe(false);

    const other = runAt('evil.example');
    expect(other.hostClass()).toBe('other');
    expect(other.runs('dual.js')).toBe(false);
    expect(other.runs('yt.js')).toBe(false);

    // Loopback and file:// (empty hostname) fixtures behave as youtube.
    expect(runAt('127.0.0.1').hostClass()).toBe('youtube');
    expect(runAt('localhost').hostClass()).toBe('youtube');
    expect(runAt('').hostClass()).toBe('youtube');

    // A module not in the table defaults to youtube-only.
    expect(runAt('www.youtube.com').runs('not-listed.js')).toBe(true);
    expect(runAt('myactivity.google.com').runs('not-listed.js')).toBe(false);
  });

  test('only the owning origin may seed the shared settings blob', () => {
    expect(runAt('www.youtube.com').ownsSharedSettings()).toBe(true);
    expect(runAt('youtube.com').ownsSharedSettings()).toBe(true);
    // Loopback and file:// fixtures own it too (test origins, never matched).
    expect(runAt('localhost').ownsSharedSettings()).toBe(true);
    expect(runAt('').ownsSharedSettings()).toBe(true);

    // Separate localStorage stores must never seed the shared blob.
    expect(runAt('m.youtube.com').ownsSharedSettings()).toBe(false);
    expect(runAt('music.youtube.com').ownsSharedSettings()).toBe(false);
    expect(runAt('studio.youtube.com').ownsSharedSettings()).toBe(false);
    expect(runAt('myactivity.google.com').ownsSharedSettings()).toBe(false);
    expect(runAt('evil.example').ownsSharedSettings()).toBe(false);
  });
});
