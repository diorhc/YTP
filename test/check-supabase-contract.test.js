/**
 * The Supabase contract check must stay READ-ONLY
 * and must judge exactly the response shapes the voting client consumes.
 * These tests pin both invariants without touching the network.
 */
const {
  CONTRACT_CHECKS,
  DUMMY_SECRET,
  collectClientSurface,
  evaluateCheck,
  validateExpectations,
} = require('../scripts/check-supabase-contract.js');

describe('check-supabase-contract', () => {
  test('check list stays read-only: only get_* RPCs with empty/dummy args and Edge preflight', () => {
    const writeRpcPattern = /rpc\/(cast_vote|submit_feature|submit_comment|finalize_|reserve_)/;

    expect(CONTRACT_CHECKS.length).toBeGreaterThan(0);
    for (const check of CONTRACT_CHECKS) {
      if (check.method === 'OPTIONS') {
        expect(check.path).toMatch(/^\/functions\/v1\//);
        continue;
      }
      expect(check.method).toBe('POST');
      expect(writeRpcPattern.test(check.path)).toBe(false);
      expect(check.path).toMatch(/^\/rest\/v1\/rpc\/get_/);
      // Empty/dummy arguments only: no real IDs, no real secret, small page.
      expect(check.body.p_feature_ids === undefined || check.body.p_feature_ids.length === 0).toBe(
        true
      );
      expect(check.body.p_comment_ids === undefined || check.body.p_comment_ids.length === 0).toBe(
        true
      );
      if (check.body.p_secret !== undefined) {
        expect(check.body.p_secret).toBe(DUMMY_SECRET);
      }
      if (check.body.p_limit !== undefined) {
        expect(check.body.p_limit).toBeLessThanOrEqual(50);
        expect(check.body.p_cursor_created).toBeNull();
        expect(check.body.p_cursor_id).toBeNull();
      }
    }
  });

  test('dummy owner secret matches the 43-char base64url format the server validates', () => {
    expect(DUMMY_SECRET).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(DUMMY_SECRET).toHaveLength(43);
  });

  test('list page validator accepts the client contract and rejects the legacy bare array', () => {
    // Client contract (src/voting.js getFeatureRequests): object page.
    const ok = evaluateCheck(CONTRACT_CHECKS[0], {
      status: 200,
      ok: true,
      json: { rows: [], hasMore: false, nextCursorCreatedAt: null, nextCursorId: null },
    });
    expect(ok.ok).toBe(true);

    // Old 2.x contract: a bare array is NOT a valid page.
    const legacy = evaluateCheck(CONTRACT_CHECKS[0], { status: 200, ok: true, json: [] });
    expect(legacy.ok).toBe(false);

    // hasMore without a usable cursor is malformed (fail closed).
    const dangling = evaluateCheck(CONTRACT_CHECKS[0], {
      status: 200,
      ok: true,
      json: { rows: [{ id: 'x' }], hasMore: true },
    });
    expect(dangling.ok).toBe(false);
  });

  test('evaluateCheck reports HTTP failures with the PostgREST error code', () => {
    const pgrst202 = evaluateCheck(CONTRACT_CHECKS[0], {
      status: 404,
      ok: false,
      json: { code: 'PGRST202', message: 'Could not find the function' },
    });
    expect(pgrst202.ok).toBe(false);
    expect(pgrst202.detail).toContain('PGRST202');

    const network = evaluateCheck(CONTRACT_CHECKS[0], {
      status: 0,
      ok: false,
      json: null,
      error: 'getaddrinfo ENOTFOUND',
    });
    expect(network.ok).toBe(false);
    expect(network.detail).toContain('ENOTFOUND');
  });
});

describe('expectations hygiene', () => {
  test('every expectation targets an endpoint the client actually calls', () => {
    const clientSurface = collectClientSurface();
    expect(clientSurface.rpcNames.has('get_feature_comment_counts')).toBe(true);
    expect(clientSurface.rpcNames.has('get_my_votes')).toBe(true);
    expect(clientSurface.edgeFunctions.has('ytplus-image-upload')).toBe(true);
    // Actor registration was removed from the client — it must never come
    // back as an expectation.
    expect(clientSurface.rpcNames.has('ytplus-actor-register')).toBe(false);
    expect(clientSurface.edgeFunctions.has('ytplus-actor-register')).toBe(false);
    expect(validateExpectations(clientSurface, CONTRACT_CHECKS)).toEqual([]);
  });

  test('the checked surface stays complete: nine client-backed expectations', () => {
    expect(CONTRACT_CHECKS).toHaveLength(9);
  });

  test('stale expectations are rejected: actor registration, p_client_id, no-arg list', () => {
    const clientSurface = collectClientSurface();
    const stale = [
      {
        name: 'actor registration preflight',
        method: 'OPTIONS',
        path: '/functions/v1/ytplus-actor-register',
        validate: () => null,
      },
      {
        name: 'legacy no-argument list page',
        method: 'POST',
        path: '/rest/v1/rpc/get_feature_requests',
        body: {},
        validate: () => null,
      },
      {
        name: 'legacy p_client_id my votes',
        method: 'POST',
        path: '/rest/v1/rpc/get_my_votes',
        body: { p_client_id: 'probe' },
        validate: () => null,
      },
    ];
    const errors = validateExpectations(clientSurface, stale);
    expect(errors).toHaveLength(3);
  });
});
