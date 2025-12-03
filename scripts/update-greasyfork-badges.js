#!/usr/bin/env node
/*
  update-greasyfork-badges.js
  Fetches GreasyFork install count and version, updates README.md badges.
  Combined script for all GreasyFork badge updates.

  Usage:
    node scripts/update-greasyfork-badges.js <greasyfork-url> [readme-path]

  Example:
    node scripts/update-greasyfork-badges.js https://greasyfork.org/ru/scripts/537017-youtube README.md

*/
'use strict';

const fs = require('fs/promises');
const { URL } = require('url');

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'node.js' } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return await res.text();
}

function parseNumberString(inputStr) {
  if (!inputStr) return null;
  const str = String(inputStr).trim();
  // handle k shorthand
  const kMatch = str.match(/^([\d,.\s]+)\s*k$/i);
  if (kMatch) {
    const n = Number(kMatch[1].replace(/[ ,\.]/g, ''));
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
    .match(/(\d+\.[\d\.a-zA-Z-]+)/);
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

  let installCount = null;
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
  let installCount = null;
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
    /(?:Version|Версия)[:\s]{0,10}([0-9]+\.[0-9][0-9a-zA-Z\.-]*)/i,
    /class="attribute-value">\s*([0-9]+\.[0-9][0-9a-zA-Z\.-]*)\s*<\/dd>[\s\S]{0,80}?<dt[^>]*>\s*(?:Version|Версия)/i,
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
    const allNums = [...html.matchAll(/([0-9]{2,}[0-9,\.\skK]*)/g)];
    if (allNums.length > 0) {
      installCount = parseNumberString(allNums[0][1]);
    }
  }

  // Fallback for version: find semver-like string
  if (!version) {
    const any = html.match(/(\d+\.[0-9A-Za-z\.-]+\.[0-9A-Za-z\.-]+)/);
    if (any) version = any[1];
  }

  return { installCount, version };
}

async function updateReadme(readmePath, installCount, version, targetUrl) {
  let content = await fs.readFile(readmePath, 'utf8');

  // Create badges as an HTML block so we can scale and center them
  const downloadsBadgeUrl = `https://img.shields.io/badge/downloads-${installCount}-blue`;
  const versionBadgeUrl = `https://img.shields.io/badge/version-${encodeURIComponent(
    version
  )}-blue`;
  const installBadgeUrl = `https://img.shields.io/badge/GreasyFork-Install-brightgreen`;

  // Slightly scale badges and center them. Use inline HTML to ensure centering
  // and size control on GitHub README.
  const badgesLine = `
<div style="text-align:center">
  <a href="${targetUrl}" style="display:inline-block;margin:0 15px;">
    <img alt="downloads" src="${downloadsBadgeUrl}" style="transform:scale(1.15);transform-origin:center;" />
  </a>
  <a href="${targetUrl}" style="display:inline-block;margin:0 15px;">
    <img alt="version" src="${versionBadgeUrl}" style="transform:scale(1.15);transform-origin:center;" />
  </a>
  <a href="${targetUrl}" style="display:inline-block;margin:0 15px;">
    <img alt="Install Script" src="${installBadgeUrl}" style="transform:scale(1.15);transform-origin:center;" />
  </a>
</div>
`;

  // Markers for badge section
  const downloadsStart = '<!-- GREASYFORK_INSTALLS:START -->';
  const downloadsEnd = '<!-- GREASYFORK_INSTALLS:END -->';

  // Check if markers exist
  const hasMarkers = content.includes(downloadsStart) && content.includes(downloadsEnd);

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
      const insertIdx = match.index + match[0].length;
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

  console.log('📥 Fetching GreasyFork data for', targetUrl);

  let installCount = null;
  let version = null;

  // Try JSON endpoint first
  try {
    const { installCount: jsonInstalls, version: jsonVersion } = await tryJsonEndpoint(targetUrl);
    installCount = jsonInstalls;
    version = jsonVersion;
  } catch {
    // ignore
  }

  // Try HTML scraping if we're missing data
  if (!installCount || !version) {
    try {
      const { installCount: htmlInstalls, version: htmlVersion } = await tryScrapeHtml(targetUrl);
      if (!installCount) installCount = htmlInstalls;
      if (!version) version = htmlVersion;
    } catch (err) {
      console.error('Failed to fetch or parse GreasyFork page:', err.message || err);
    }
  }

  if (!installCount || !version) {
    console.error('Could not determine install count or version from GreasyFork.');
    console.error('Install count:', installCount || 'NOT FOUND');
    console.error('Version:', version || 'NOT FOUND');
    process.exit(2);
  }

  await updateReadme(readmePath, installCount, version, targetUrl);
}

main().catch(err => {
  console.error(err);
  process.exit(10);
});
