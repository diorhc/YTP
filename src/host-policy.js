// Single source of truth for the host policy: which host classes the bundle
// runs modules on. build.js inlines this file into the bundle prologue with the
// manifest table, and tests load it directly. It is not itself a gated module.

/**
 * Build the host policy from a module name -> hosts table.
 * @param {Record<string, string[]>} [table]
 * @returns {YouTubePlusHostPolicy}
 */
function createHostPolicy(table) {
  /** @type {Record<string, string[]>} */
  const hosts = table || {};

  /** @returns {string} lowercase hostname, or empty for file:// fixtures */
  function hostname() {
    return String(
      (typeof location !== 'undefined' && location && location.hostname) || ''
    ).toLowerCase();
  }

  /** @returns {'youtube'|'myactivity'|'other'} */
  function hostClass() {
    const host = hostname();
    if (host === 'myactivity.google.com') return 'myactivity';
    if (host === 'youtube.com' || /(^|\.)youtube\.com$/.test(host)) return 'youtube';
    // Loopback and file:// fixtures behave as youtube; @match only ever runs on
    // youtube/myactivity, so this cannot widen production reach.
    if (isFixtureHost(host)) return 'youtube';
    return 'other';
  }

  /**
   * True only on the origin that owns the shared settings blob and on
   * loopback/file fixtures. Other youtube subdomains read the blob but must
   * not seed it, because their localStorage is a separate store.
   * @returns {boolean}
   */
  function ownsSharedSettings() {
    const host = hostname();
    return host === 'www.youtube.com' || host === 'youtube.com' || isFixtureHost(host);
  }

  /** @param {string} host @returns {boolean} */
  function isFixtureHost(host) {
    return (
      host === '' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]'
    );
  }

  return {
    hostClass,
    ownsSharedSettings,
    table: hosts,
    /**
     * @param {string} name
     * @returns {boolean}
     */
    runs(name) {
      const cls = hostClass();
      if (cls === 'other') return false;
      const list = hosts[name];
      if (!list) return cls === 'youtube';
      return list.indexOf(cls) !== -1;
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createHostPolicy };
}
