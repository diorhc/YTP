#!/usr/bin/env node
/*
  update-greasyfork-badges.js
  Fetches GreasyFork install count and version, updates README.md badges.
  Combined script for all GreasyFork badge updates.

  Usage:
    node scripts/update-greasyfork-badges.js <greasyfork-url> [readme-path]

  Example:
    node scripts/update-greasyfork-badges.js https://greasyfork.org/scripts/537017-youtube README.md

*/

const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const FETCH_HEADERS = {
  // GreasyFork (behind Cloudflare) rejects bare "node.js" user agents from CI
  // runners; a browser-like UA plus json-first Accept keeps the fetch working.
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: FETCH_HEADERS });
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

/**
 * The version badge follows a release, not the daily install count, so the
 * version is read from the repository (package.json) instead of being scraped
 * from GreasyFork on every run.
 * @returns {Promise<string|null>}
 */
async function readRepoVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    const raw = typeof pkg?.version === 'string' ? pkg.version.trim() : '';
    return raw ? parseVersionString(raw) : null;
  } catch {
    return null;
  }
}

function parseNumberString(inputStr) {
  if (!inputStr) return null;
  const str = String(inputStr).trim();
  // handle k shorthand
  const kMatch = str.match(/^([\d,.\s]+)\s*k$/i);
  if (kMatch) {
    const n = Number(kMatch[1].replace(/[ ,.]/g, ''));
    if (!Number.isNaN(n)) return Math.round(n * 1000);
  }
  // remove non-digit characters
  const digits = str.replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;
  return Number(digits);
}

function parseVersionString(s) {
  if (!s) return null;
  const m = String(s)
    .trim()
    .match(/(\d+\.[\d.a-zA-Z-]+)/);
  return m ? m[1] : null;
}

// Extract install count from JSON data
function extractInstallCount(json) {
  const installKeys = [
    'total_installs',
    'installs',
    'install_count',
    'installation_count',
    'installationCount',
    'users',
  ];

  for (const k of installKeys) {
    if (json[k] && typeof json[k] !== 'object') {
      const count = parseNumberString(String(json[k]));
      if (count) return count;
    }
  }

  // Look for any numeric properties as fallback
  for (const v of Object.values(json)) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /[0-9]/.test(v)) {
      const n = parseNumberString(v);
      if (n) return n;
    }
  }

  return null;
}

// Extract version from JSON data
function extractVersion(json) {
  const versionKeys = ['version', 'script_version', 'latest_version'];

  for (const k of versionKeys) {
    if (json[k]) {
      const ver = parseVersionString(json[k]);
      if (ver) return ver;
    }
  }

  // Look for any string that looks like a version
  for (const v of Object.values(json)) {
    if (typeof v === 'string') {
      const ver = parseVersionString(v);
      if (ver) return ver;
    }
  }

  return null;
}

// Try to fetch and parse JSON data from endpoint
async function tryFetchJson(url) {
  try {
    const txt = await fetchText(url);
    const json = JSON.parse(txt);
    return {
      installCount: extractInstallCount(json),
      version: extractVersion(json),
    };
  } catch {
    return { installCount: null, version: null };
  }
}

async function tryJsonEndpoint(baseUrl) {
  // try several variants to reach JSON endpoint
  const candidates = [];
  try {
    const u = new URL(baseUrl);
    // append .json to path
    candidates.push(`${u.href.replace(/\/?$/, '')}.json`);
    // replace locale segment like /ru/ or /en/ -> remove
    const pathNoLocale = u.pathname.replace(/^\/(ru|en|fr|de|es)\//, '/');
    const u2 = new URL(u.origin + pathNoLocale);
    candidates.push(`${u2.href.replace(/\/?$/, '')}.json`);
  } catch {
    candidates.push(`${baseUrl}.json`);
  }

  /** @type {number|null} */
  let installCount = null;
  /** @type {string|null} */
  let version = null;

  for (const c of candidates) {
    const { installCount: foundInstalls, version: foundVersion } = await tryFetchJson(c);
    if (!installCount) installCount = foundInstalls;
    if (!version) version = foundVersion;

    if (installCount && version) break;
  }

  return { installCount, version };
}

async function tryScrapeHtml(url) {
  const html = await fetchText(url);
  /** @type {number|null} */
  let installCount = null;
  /** @type {string|null} */
  let version = null;

  // Try to find install count
  const installPatterns = [
    /([\d,.\s]+)\s*(?:установки|установок|Установки|Установки|устано)/i,
    /(?:Installs|Installations|installs|Install)[:\s<\-\n]{0,30}([\d,.kK\s]+)/i,
    /class="attribute-value">\s*([\d,.kK\s]+)\s*<\/dd>[\s\S]{0,80}?<dt[^>]*>\s*(?:Installs|Установки)/i,
  ];

  for (const re of installPatterns) {
    const m = html.match(re);
    if (m && m[1]) {
      installCount = parseNumberString(m[1]);
      if (installCount) break;
    }
  }

  // Try to find version
  const versionPatterns = [
    /<dt[^>]*>\s*(?:Version|Версия)\s*<\/dt>\s*<dd[^>]*>\s*([^<\n]+)\s*<\/dd>/i,
    /(?:Version|Версия)[:\s]{0,10}([0-9]+\.[0-9][0-9a-zA-Z.-]*)/i,
    /class="attribute-value">\s*([0-9]+\.[0-9][0-9a-zA-Z.-]*)\s*<\/dd>[\s\S]{0,80}?<dt[^>]*>\s*(?:Version|Версия)/i,
  ];

  for (const re of versionPatterns) {
    const m = html.match(re);
    if (m && m[1]) {
      version = parseVersionString(m[1]);
      if (version) break;
    }
  }

  // Fallback for install count: find first reasonable number
  if (!installCount) {
    const allNums = [...html.matchAll(/([0-9]{2,}[0-9,.\skK]*)/g)];
    if (allNums.length > 0) {
      installCount = parseNumberString(allNums[0][1]);
    }
  }

  // Fallback for version: find semver-like string
  if (!version) {
    const any = html.match(/(\d+\.[0-9A-Za-z.-]+\.[0-9A-Za-z.-]+)/);
    if (any) version = any[1];
  }

  return { installCount, version };
}

async function updateReadme(readmePath, installCount, version, targetUrl) {
  let content = await fs.readFile(readmePath, 'utf8');

  // Create badges as an HTML block matching README style:
  // - flat-square style
  // - fixed height (25)
  // - spacing with non-breaking spaces
  const downloadsBadgeUrl = `https://img.shields.io/badge/downloads-${installCount}-blue?style=flat-square`;
  const versionBadgeUrl = `https://img.shields.io/badge/version-${encodeURIComponent(
    version
  )}-blue?style=flat-square`;

  // Determine Release/Install link: if README already had a Release link in the markers, reuse it
  const defaultReleaseHref =
    'https://github.com/diorhc/YTP/releases/latest/download/youtube.user.js';
  let releaseHref = defaultReleaseHref;

  const downloadsStart = '<!-- GREASYFORK_INSTALLS:START -->';
  const downloadsEnd = '<!-- GREASYFORK_INSTALLS:END -->';
  const hasMarkers = content.includes(downloadsStart) && content.includes(downloadsEnd);
  if (hasMarkers) {
    const badgeRe = new RegExp(`${downloadsStart}[\\s\\S]*?${downloadsEnd}`, 'm');
    const match = content.match(badgeRe);
    if (match && match[0]) {
      const block = match[0];
      const hrefs = [...block.matchAll(/<a\s+href="([^"]+)"/g)].map(m => m[1]);
      if (hrefs.length >= 3 && hrefs[2]) releaseHref = hrefs[2];
    }
  }

  const releaseBadgeUrl = `https://img.shields.io/badge/Release-Install-brightgreen?style=flat-square`;

  // Build badges HTML to match existing README (height 25, &nbsp;&nbsp; separators)
  const badgesLine = `
<p align="center">
  <a href="${targetUrl}">
    <img alt="downloads" src="${downloadsBadgeUrl}" height="25" />
  </a>&nbsp;&nbsp;
  <a href="${targetUrl}">
    <img alt="version" src="${versionBadgeUrl}" height="25" />
  </a>&nbsp;&nbsp;
  <a href="${releaseHref}">
    <img alt="Release" src="${releaseBadgeUrl}" height="25" />
  </a>
</p>
`;

  // Check if markers exist and update or insert accordingly
  if (hasMarkers) {
    // Update existing badges between markers
    const badgeRe = new RegExp(`${downloadsStart}[\\s\\S]*?${downloadsEnd}`, 'm');
    content = content.replace(badgeRe, `${downloadsStart}\n\n${badgesLine}\n\n${downloadsEnd}`);
  } else {
    // Insert new badges after first images or at top
    const insertAfter = /^(\s*!\[.*\]\([^)]*\)\s*\n){1,2}/m;
    const match = content.match(insertAfter);
    const badgeBlock = `${downloadsStart}\n\n${badgesLine}\n\n${downloadsEnd}\n`;

    if (match) {
      const insertIdx = (match.index ?? 0) + match[0].length;
      content = `${content.slice(0, insertIdx)}\n${badgeBlock}\n${content.slice(insertIdx)}`;
    } else {
      content = `${badgeBlock}\n${content}`;
    }
  }

  await fs.writeFile(readmePath, content, 'utf8');
  console.log('✓ Updated', readmePath);
  console.log('  Downloads:', installCount);
  console.log('  Version:', version);
}

async function main() {
  if (!globalThis.fetch) {
    console.error('Node runtime must support global fetch (Node 18+).');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/update-greasyfork-badges.js <greasyfork-url> [readme-path]');
    process.exit(1);
  }

  const targetUrl = args[0];
  const readmePath = args[1] || 'README.md';

  console.log('📥 Fetching GreasyFork install count for', targetUrl);

  // Only the install count changes daily; the version comes from the repo so a
  // GreasyFork version-scrape failure can no longer fail the whole run.
  /** @type {string|null} */
  let version = await readRepoVersion();
  /** @type {number|null} */
  let installCount = null;

  // Try JSON endpoint first
  try {
    const { installCount: jsonInstalls, version: jsonVersion } = await tryJsonEndpoint(targetUrl);
    installCount = jsonInstalls;
    if (!version) version = jsonVersion;
  } catch {
    // ignore
  }

  // Try HTML scraping if we're still missing data
  if (!installCount || !version) {
    try {
      const { installCount: htmlInstalls, version: htmlVersion } = await tryScrapeHtml(targetUrl);
      if (!installCount) installCount = htmlInstalls;
      if (!version) version = htmlVersion;
    } catch (err) {
      console.error(
        'Failed to fetch or parse GreasyFork page:',
        err instanceof Error ? err.message : err
      );
    }
  }

  if (!installCount) {
    console.error('Could not determine install count from GreasyFork.');
    console.error('Install count:', installCount || 'NOT FOUND');
    process.exit(2);
  }

  if (!version) {
    console.error('Could not determine version (package.json is missing a version?).');
    process.exit(2);
  }

  await updateReadme(readmePath, installCount, version, targetUrl);
}

main().catch(err => {
  console.error(err);
  process.exit(10);
});
