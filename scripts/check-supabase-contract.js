#!/usr/bin/env node
/**
 * check-supabase-contract — read-only verification of the Supabase contract
 * the voting client (src/voting.js) depends on.
 *
 * READ-ONLY BY DESIGN:
 *   - POST only to read-RPC (`get_*`) with empty or dummy arguments
 *     (dummy owner secret, empty id batches, p_limit: 1);
 *   - OPTIONS preflight to the image-upload Edge function;
 *   - NO cast_vote / submit_* / finalize_* / reserve_* calls, no INSERT/UPDATE.
 *
 * Run in the release job BEFORE publication; exits non-zero when any check
 * does not match the client's expected response shape.
 *
 * Target: positional arg, else SUPABASE_CONTRACT_URL, else the client proxy
 * (https://vote.diorhc.space). Optional SUPABASE_CONTRACT_APIKEY for direct
 * Supabase targets that require an anon key — the proxy adds it itself.
 */

const fs = require('node:fs');
const path = require('node:path');

const CLIENT_VERSION = require('../package.json').version;

/** 43-char base64url — same shape the client mints and the server validates. */
const DUMMY_SECRET = 'A'.repeat(43);
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_TARGET = 'https://vote.diorhc.space';

function describeJson(json) {
  if (json === null) return 'null';
  if (Array.isArray(json)) return `array(length=${json.length})`;
  if (typeof json === 'object') return `object(keys=${Object.keys(json).slice(0, 6).join(',')})`;
  return typeof json;
}

/** Client contract: object page {rows, hasMore[, nextCursor*]} — fail closed. */
function validateListPage(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return `expected an object page {rows, hasMore}, got ${describeJson(json)}`;
  }
  if (!Array.isArray(json.rows)) return 'rows must be an array';
  if (typeof json.hasMore !== 'boolean') return 'hasMore must be a boolean';
  if (
    json.hasMore === true &&
    (typeof json.nextCursorCreatedAt !== 'string' || typeof json.nextCursorId !== 'string')
  ) {
    return 'hasMore=true requires string nextCursorCreatedAt/nextCursorId';
  }
  return null;
}

/** Array-returning read RPCs (rows may be empty — that is a valid read). */
function validateArray(json) {
  if (!Array.isArray(json)) return `expected an array, got ${describeJson(json)}`;
  return null;
}

/**
 * Client call surface, derived from src/voting.js — the single source of
 * truth for which RPCs and Edge functions the bundle actually uses.
 * @returns {{ rpcNames: Set<string>, edgeFunctions: Set<string> }}
 */
function collectClientSurface() {
  const source = fs.readFileSync(path.join(__dirname, '../src/voting.js'), 'utf8');
  const rpcNames = new Set();
  for (const match of source.matchAll(/rpc\(\s*'([a-z0-9_]+)'/g)) {
    rpcNames.add(match[1]);
  }
  // The five aggregate readers share one batch loop, so their RPC name is a
  // literal argument: some pass it straight to batchedRowsRpc_, the image
  // readers pass it in the spec object consumed by fetchImageRows_.
  for (const match of source.matchAll(/batchedRowsRpc_\(\s*this,\s*'([a-z0-9_]+)'/g)) {
    rpcNames.add(match[1]);
  }
  for (const match of source.matchAll(/rpc:\s*'([a-z0-9_]+)'/g)) {
    rpcNames.add(match[1]);
  }
  const edgeFunctions = new Set();
  for (const match of source.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) {
    edgeFunctions.add(match[1]);
  }
  return { rpcNames, edgeFunctions };
}

/**
 * Stale expectations poison the release verdict: a check for an endpoint the
 * client no longer calls (actor registration, the no-argument
 * get_feature_requests, p_client_id overloads) can still pass against an
 * old-contract server and mask a real mismatch. Every expectation must
 * target the client's live call surface.
 * @param {{ rpcNames: Set<string>, edgeFunctions: Set<string> }} clientSurface
 * @param {typeof CONTRACT_CHECKS} checks
 * @returns {string[]} human-readable violations, empty when the list is clean
 */
function validateExpectations(clientSurface, checks) {
  const errors = [];
  for (const check of checks) {
    const rpcMatch = check.path.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
    const edgeMatch = check.path.match(/^\/functions\/v1\/([a-z0-9-]+)$/);
    if (rpcMatch && !clientSurface.rpcNames.has(rpcMatch[1])) {
      errors.push(`${check.name}: rpc/${rpcMatch[1]} is not called by the client`);
    }
    if (edgeMatch && !clientSurface.edgeFunctions.has(edgeMatch[1])) {
      errors.push(`${check.name}: ${edgeMatch[1]} is not called by the client`);
    }
    const bodyText = check.body === undefined ? '' : JSON.stringify(check.body);
    if (bodyText.includes('p_client_id')) {
      errors.push(`${check.name}: stale p_client_id argument expectation`);
    }
    if (
      rpcMatch &&
      rpcMatch[1] === 'get_feature_requests' &&
      (check.body === undefined || !('p_limit' in check.body))
    ) {
      errors.push(`${check.name}: no-argument get_feature_requests expectation`);
    }
  }
  return errors;
}

const CONTRACT_CHECKS = [
  {
    name: 'get_feature_requests page contract',
    method: 'POST',
    path: '/rest/v1/rpc/get_feature_requests',
    body: { p_limit: 1, p_cursor_created: null, p_cursor_id: null },
    validate: validateListPage,
  },
  {
    name: 'get_my_votes with dummy owner secret',
    method: 'POST',
    path: '/rest/v1/rpc/get_my_votes',
    body: { p_secret: DUMMY_SECRET },
    validate: validateArray,
  },
  {
    name: 'get_feature_comment_counts empty batch',
    method: 'POST',
    path: '/rest/v1/rpc/get_feature_comment_counts',
    body: { p_feature_ids: [] },
    validate: validateArray,
  },
  {
    name: 'get_vote_counts empty batch',
    method: 'POST',
    path: '/rest/v1/rpc/get_vote_counts',
    body: { p_feature_ids: [] },
    validate: validateArray,
  },
  {
    name: 'get_preview_feature empty args',
    method: 'POST',
    path: '/rest/v1/rpc/get_preview_feature',
    body: {},
    validate: validateArray,
  },
  {
    name: 'get_feature_images empty batch',
    method: 'POST',
    path: '/rest/v1/rpc/get_feature_images',
    body: { p_feature_ids: [] },
    validate: validateArray,
  },
  {
    name: 'get_feature_comments empty batch',
    method: 'POST',
    path: '/rest/v1/rpc/get_feature_comments',
    body: { p_feature_ids: [] },
    validate: validateArray,
  },
  {
    name: 'get_comment_images empty batch',
    method: 'POST',
    path: '/rest/v1/rpc/get_comment_images',
    body: { p_comment_ids: [] },
    validate: validateArray,
  },
  {
    name: 'ytplus-image-upload CORS preflight',
    method: 'OPTIONS',
    path: '/functions/v1/ytplus-image-upload',
    body: undefined,
    validate: (_json, res) => (res.ok ? null : `expected 2xx preflight, got HTTP ${res.status}`),
  },
];

/**
 * Judge one check against a response without any network access.
 * @param {{ validate: (json: any, res: any) => string | null }} check
 * @param {{ status: number, ok: boolean, json: any, error?: string }} response
 * @returns {{ ok: boolean, detail: string }}
 */
function evaluateCheck(check, response) {
  if (response.error) {
    return { ok: false, detail: `network error: ${response.error}` };
  }
  if (!response.ok) {
    const code = response.json && response.json.code ? ` ${response.json.code}` : '';
    const message = response.json && response.json.message ? ` — ${response.json.message}` : '';
    return { ok: false, detail: `HTTP ${response.status}${code}${message}` };
  }
  const shapeError = check.validate(response.json, response);
  if (shapeError) {
    return { ok: false, detail: shapeShape(shapeError) };
  }
  return { ok: true, detail: `HTTP ${response.status}, shape OK` };
}

function shapeShape(detail) {
  return `shape mismatch: ${detail}`;
}

function resolveTarget() {
  return process.argv[2] || process.env.SUPABASE_CONTRACT_URL || DEFAULT_TARGET;
}

async function performCheck(target, check) {
  const headers = {};
  if (check.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const apiKey = process.env.SUPABASE_CONTRACT_APIKEY;
  if (apiKey) {
    headers.apikey = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }
  try {
    const res = await fetch(`${target}${check.path}`, {
      method: check.method,
      headers,
      body: check.body === undefined ? undefined : JSON.stringify(check.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    /** @type {any} */
    let json = null;
    try {
      json = await res.json();
    } catch (_e) {
      json = null;
    }
    return { res, json };
  } catch (err) {
    return {
      res: { status: 0, ok: false },
      json: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  // Offline expectations guard runs first: stale endpoints in the check list
  // must fail the run without touching the network.
  const expectationErrors = validateExpectations(collectClientSurface(), CONTRACT_CHECKS);
  if (expectationErrors.length > 0) {
    console.error('Stale expectations — checks reference endpoints the client does not call:');
    for (const error of expectationErrors) {
      console.error(`  - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--selfcheck')) {
    console.log(
      `Expectations match the client call surface: ${CONTRACT_CHECKS.length} checks, no stale endpoints.`
    );
    return;
  }

  const target = resolveTarget().replace(/\/+$/, '');
  console.log(`check-supabase-contract (READ-ONLY) → ${target}`);
  console.log('  only read-RPC (get_*) with empty/dummy args + OPTIONS; no writes.\n');

  const failures = [];
  for (const check of CONTRACT_CHECKS) {
    const { res, json, error } = await performCheck(target, check);
    const verdict = evaluateCheck(check, { status: res.status, ok: res.ok, json, error });
    const marker = verdict.ok ? 'OK  ' : 'FAIL';
    console.log(`${marker} ${check.name}${verdict.ok ? '' : ` — ${verdict.detail}`}`);
    if (!verdict.ok) {
      failures.push({ name: check.name, detail: verdict.detail });
    }
  }

  console.log(
    `\n${CONTRACT_CHECKS.length - failures.length}/${CONTRACT_CHECKS.length} checks passed`
  );
  if (failures.length > 0) {
    console.error(`\nContract mismatches (client ${CLIENT_VERSION} vs deployed endpoint):`);
    for (const failure of failures) {
      console.error(`  - ${failure.name}: ${failure.detail}`);
    }
    console.error('\nHint: PGRST202/404 on get_* RPCs means the voting_v5_secret_contract');
    console.error('migration (plan 0.3) is not applied yet, or the proxy does not route it.');
    process.exitCode = 1;
  } else {
    console.log(`Contract matches the client ${CLIENT_VERSION} expectations.`);
  }
}

module.exports = {
  CONTRACT_CHECKS,
  DUMMY_SECRET,
  collectClientSurface,
  evaluateCheck,
  validateExpectations,
};

if (require.main === module) {
  main();
}
