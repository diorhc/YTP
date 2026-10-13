/**
 * Feature Voting System: RPC-only contract.
 * Backend is production Supabase, schema ytp_feature. The browser has no direct
 * table or schema access; every read and write goes through public RPCs.
 */

(function () {
  const setTimeout_ = setTimeout.bind(window);
  const clearTimeout_ = clearTimeout.bind(window);
  const U = window.YouTubeUtils;
  const _setSafeHTML = (/** @type {Element} */ el, /** @type {string} */ html) => {
    if (U?.setSafeHTML) {
      U.setSafeHTML(el, html);
    } else if (window.YouTubeSafeDOM?.renderTemplateClone) {
      window.YouTubeSafeDOM.renderTemplateClone(el, html);
    }
  };
  const byId = (/** @type {string} */ id) =>
    /** @type {HTMLElement|null} */ (U?.byId ? U.byId(id) : document.getElementById(id));
  const $ = (/** @type {string} */ selector, /** @type {Document|Element} */ root = document) =>
    /** @type {HTMLElement|null} */ ((root || document).querySelector(selector));

  /**
   * A registered listener. `never[]` is the honest "any arity, any argument"
   * rest: every concrete DOM handler type is assignable to it, and unlike
   * `any[]` it carries no escape hatch into the module's own signatures.
   * @typedef {(...args: never[]) => unknown} ListenerFn
   */

  const _registerListener = (
    /** @type {EventTarget} */ target,
    /** @type {string} */ type,
    /** @type {ListenerFn} */ handler,
    /** @type {AddEventListenerOptions|boolean} */ options = false,
    /** @type {boolean|'session'} */ persistent = false
  ) => {
    // The cleanup manager's slot is wider than this module's listener type, so
    // the forward narrows the parameter type once instead of at every call site.
    const forward = /** @type {Parameters<typeof U.cleanupManager.registerListener>[2]} */ (
      /** @type {unknown} */ (handler)
    );
    if (U?.cleanupManager) {
      return U.cleanupManager.registerListener(target, type, forward, options, persistent);
    }
    if (window.YouTubePlusCleanupManager) {
      return window.YouTubePlusCleanupManager.registerListener(
        target,
        type,
        forward,
        options,
        persistent
      );
    }
    // lint:custom:ignore
    return target?.addEventListener?.(type, /** @type {EventListener} */ (handler), options);
  };

  const _unregisterListener = (/** @type {unknown} */ key) => {
    if (typeof key !== 'symbol') return;
    if (U?.cleanupManager?.unregisterListener) U.cleanupManager.unregisterListener(key);
    else window.YouTubePlusCleanupManager?.unregisterListener?.(key);
  };

  /**
   * Register a runtime listener. With a feature context the listener is
   * released when the feature stops; without one it lives for the session.
   * @param {YouTubePlusFeatureContext|null} ctx
   * @param {EventTarget} target
   * @param {string} type
   * @param {ListenerFn} handler
   * @param {AddEventListenerOptions|boolean} [options]
   */
  const _runtimeListener = (ctx, target, type, handler, options = false) => {
    if (ctx) {
      return ctx.listen(
        target,
        type,
        /** @type {EventListener} */ (/** @type {unknown} */ (handler)),
        options
      );
    }
    return _registerListener(target, type, handler, options, 'session');
  };

  if (typeof window === 'undefined') return;

  const isSettingsModalOpen = () => Boolean(U?.isSettingsModalOpen?.());

  const tf = (/** @type {string} */ key, /** @type {string} */ fallback) => {
    if (typeof U?.hasTranslation === 'function') {
      return U.hasTranslation(key) ? U.t(key) : fallback;
    }
    const val = U?.t ? U.t(key) : null;
    return val && val !== key ? val : fallback;
  };

  function escapeHtml(/** @type {string} */ str) {
    if (!str) return '';
    if (window.YouTubeSafeDOM?.escapeHTML) return window.YouTubeSafeDOM.escapeHTML(str);
    if (window.YouTubeSecurityUtils?.escapeHtml) {
      return window.YouTubeSecurityUtils.escapeHtml(str);
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeUserText(/** @type {unknown} */ value) {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function storageGet(/** @type {string} */ key) {
    try {
      if (window.YouTubePlusSettingsStore?.readRaw) {
        return window.YouTubePlusSettingsStore.readRaw(key);
      }
      if (U?.storage?.get) {
        const val = U.storage.get(key);
        return typeof val === 'string' ? val : null;
      }
    } catch (_e) {
      U?.logSuppressed?.(_e, 'Voting');
    }
    return null;
  }

  function storageSet(/** @type {string} */ key, /** @type {string} */ value) {
    try {
      if (window.YouTubePlusSettingsStore?.writeRaw) {
        window.YouTubePlusSettingsStore.writeRaw(key, value);
      } else if (U?.storage?.set) {
        U.storage.set(key, value);
      }
    } catch (_e) {
      U?.logSuppressed?.(_e, 'Voting');
    }
  }

  function storageRemove(/** @type {string} */ key) {
    try {
      if (window.YouTubePlusSettingsStore?.removeRaw) {
        window.YouTubePlusSettingsStore.removeRaw(key);
      } else if (U?.storage) {
        U.storage.removeItem(key);
      }
    } catch (e) {
      U?.logSuppressed?.(e, 'Voting');
    }
  }

  // ---- ISOLATED OWNER-CAPABILITY STORAGE ------------------------------------
  // The capability secret lives in the userscript manager's isolated GM
  // storage, where same-origin page scripts cannot read it. Supports the sync
  // (GM_getValue/GM_setValue/GM_deleteValue) and async (GM.getValue/GM.setValue/
  // GM.deleteValue) manager variants; the settings store is only a fallback for
  // managers without GM storage.

  const OWNER_SECRET_GM_KEY = 'ytp_owner_capability_secret';
  const OWNER_SECRET_LEGACY_KEY = 'ytp_owner_secret';

  /**
   * The manager's Promise-based GM storage surface. Only the two members the
   * owner-secret adapter uses are declared; the rest of the API is irrelevant
   * here.
   * @typedef {{ getValue: (key: string) => Promise<unknown>, setValue: (key: string, value: string) => Promise<unknown> }} GmAsyncStorage
   */

  /** @returns {GmAsyncStorage|null} the async GM storage API, or null */
  const gmAsyncStorage_ = () => {
    const gm = /** @type {{ GM?: GmAsyncStorage }} */ (/** @type {unknown} */ (globalThis)).GM;
    return gm && typeof gm.getValue === 'function' && typeof gm.setValue === 'function' ? gm : null;
  };

  /**
   * Detect the isolated GM storage variant of this manager.
   * @returns {'sync' | 'async' | 'none'}
   */
  function detectOwnerStorageVariant_() {
    try {
      if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') return 'sync';
    } catch (e) {
      U?.logSuppressed?.(e, 'Voting');
    }
    const gmApi = gmAsyncStorage_();
    try {
      if (gmApi && typeof gmApi.getValue === 'function' && typeof gmApi.setValue === 'function') {
        return 'async';
      }
    } catch (e) {
      U?.logSuppressed?.(e, 'Voting');
    }
    return 'none';
  }

  /**
   * Read the capability secret from isolated GM storage.
   * @returns {Promise<string | null | undefined>} undefined when no GM
   *   storage variant exists at all (caller uses the fallback path).
   */
  async function ownerStorageGet_() {
    const variant = detectOwnerStorageVariant_();
    const gmApi = gmAsyncStorage_();
    try {
      if (variant === 'sync') {
        const v = GM_getValue(OWNER_SECRET_GM_KEY);
        return typeof v === 'string' ? v : null;
      }
      if (variant === 'async' && gmApi) {
        const v = await gmApi.getValue(OWNER_SECRET_GM_KEY);
        return typeof v === 'string' ? v : null;
      }
    } catch (e) {
      U?.logSuppressed?.(e, 'Voting');
    }
    return undefined;
  }

  /**
   * Write the capability secret into isolated GM storage and VERIFY the
   * write is readable before the caller acts on it.
   * @param {string} value
   * @returns {Promise<boolean>}
   */
  async function ownerStorageSetVerified_(value) {
    const variant = detectOwnerStorageVariant_();
    const gmApi = gmAsyncStorage_();
    try {
      if (variant === 'sync') {
        GM_setValue(OWNER_SECRET_GM_KEY, value);
        return GM_getValue(OWNER_SECRET_GM_KEY) === value;
      }
      if (variant === 'async' && gmApi) {
        await gmApi.setValue(OWNER_SECRET_GM_KEY, value);
        return (await gmApi.getValue(OWNER_SECRET_GM_KEY)) === value;
      }
    } catch (e) {
      U?.logSuppressed?.(e, 'Voting');
    }
    return false;
  }

  // Vote ownership is proof-of-possession of a 32-byte client-held secret.
  // The raw secret lives in the ISOLATED GM storage (see the adapter above),
  // sent ONLY as the p_secret RPC argument (TLS) for server-side
  // verification against sha256; it is never logged and never exposed
  // through any facade, page bridge or settings export.

  /** @param {unknown} s @returns {s is string} base64url 32-byte secret shape */
  function isValidSecretFormat_(s) {
    return typeof s === 'string' && s.length >= 43 && s.length <= 200;
  }

  /** Drop the legacy plaintext copy after a verified GM write. */
  function removeLegacySecret_() {
    storageRemove(OWNER_SECRET_LEGACY_KEY);
  }

  /**
   * The owner secret resolves once per session through this single-flight
   * promise. Without it, two concurrent first callers (the "my votes" load and
   * pre-vote registration) could each see empty storage and mint different
   * secrets; the losing secret is unrecoverable and ownership checks against it
   * fail. Reset only on failure so a later action can retry.
   * @type {Promise<string | null> | null}
   */
  let ownerSecretPromise = null;

  async function resolveOwnerSecret_() {
    // 1. The isolated GM storage is the capability's home.
    const stored = await ownerStorageGet_();
    if (stored !== undefined && isValidSecretFormat_(stored)) return stored;

    // 2. One-time migration of the legacy plaintext copy: read → validate
    // → write the SAME secret into GM storage → verify readable → only
    // then drop the plaintext copy.
    const legacy = storageGet(OWNER_SECRET_LEGACY_KEY);
    if (isValidSecretFormat_(legacy)) {
      if (await ownerStorageSetVerified_(legacy)) {
        removeLegacySecret_();
        return legacy;
      }
      // GM storage unavailable: keep the legacy value so the existing identity
      // survives; never silently mint a new one.
      return legacy;
    }

    // 3. Fresh identity: first use, or storage that could not be read.
    const bytes = new Uint8Array(32);
    (window.crypto || /** @type {{ msCrypto?: Crypto }} */ (window).msCrypto).getRandomValues(
      bytes
    );
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const secret = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (!(await ownerStorageSetVerified_(secret))) {
      // No isolated storage in this manager: keep the settings-store path
      // so the identity still persists (historical behavior).
      storageSet(OWNER_SECRET_LEGACY_KEY, secret);
    }
    return secret;
  }

  function getOwnerSecret() {
    if (!ownerSecretPromise) {
      ownerSecretPromise = resolveOwnerSecret_().catch(err => {
        // Reset on error: the failure is not memoized, so a later action
        // retries the read/generation from scratch.
        ownerSecretPromise = null;
        U?.logSuppressed?.(err, 'Voting');
        return null;
      });
    }
    return ownerSecretPromise;
  }

  // ---- ISOLATED OWNER TRANSPORT --------------------------------------------
  // The page-context fetch may be wrapped by YouTube, other extensions or
  // scripts (Tampermonkey "page" injection, @grant none, some Violentmonkey
  // builds). Owner payloads (p_secret / p_owner_capability) must never
  // travel through that shared fetch: they go through
  // GM_xmlhttpRequest, which also carries the request deadline. Public
  // reads keep the plain fetch fallback when the manager transport is
  // missing.
  const OWNER_REQUEST_TIMEOUT_MS = 15000;

  function gmTransportAvailable_() {
    const host = /** @type {{ GM_xmlhttpRequest?: unknown, GM?: { xmlHttpRequest?: unknown } }} */ (
      /** @type {unknown} */ (globalThis)
    );
    return (
      typeof host.GM_xmlhttpRequest === 'function' || typeof host.GM?.xmlHttpRequest === 'function'
    );
  }

  /**
   * A caught value read as an error-like record, without widening it to `any`.
   * @param {unknown} value
   * @returns {{ name?: unknown, message?: unknown }}
   */
  const asErrorLike_ = value =>
    /** @type {{ name?: unknown, message?: unknown }} */ (/** @type {unknown} */ (value));

  /**
   * @typedef {{ message?: unknown, code?: unknown }} RpcErrorBody
   * @typedef {unknown[] | RpcErrorBody | null} RpcResponseBody
   */

  /**
   * The manager's GM_xmlhttpRequest surface, narrowed to what the owner
   * transport uses. Typed structurally because the manager injects it as a
   * bare global with no interface declaration.
   * @typedef {(details: { method: string, url: string, headers: Record<string, string>, data?: BodyInit | null, timeout?: number, onload: (res: GmResponse) => void, onerror: () => void, ontimeout: () => void, onabort: () => void }) => { abort?: () => void } | void} GmRequestFn
   */
  /**
   * @typedef {{ status: number, response?: unknown, responseText?: unknown }} GmResponse
   */

  function gmHttp_(
    /** @type {string} */ url,
    /** @type {{ method?: string, headers?: Record<string, string>, body?: BodyInit | null, timeout?: number, signal?: AbortSignal }} */ options = {}
  ) {
    const {
      method = 'GET',
      headers = {},
      body = undefined,
      timeout = OWNER_REQUEST_TIMEOUT_MS,
      signal = undefined,
    } = options;
    return new Promise((resolve, reject) => {
      const host =
        /** @type {{ GM_xmlhttpRequest?: GmRequestFn, GM?: { xmlHttpRequest?: GmRequestFn } }} */ (
          /** @type {unknown} */ (globalThis)
        );
      const requestFn =
        typeof host.GM_xmlhttpRequest === 'function'
          ? host.GM_xmlhttpRequest
          : host.GM?.xmlHttpRequest;
      if (typeof requestFn !== 'function') {
        reject(new Error('GM_xmlhttpRequest unavailable'));
        return;
      }
      let settled = false;
      /** @type {{ abort?: () => void } | null} */
      const handle = /** @type {{ abort?: () => void } | null} */ (
        requestFn({
          method,
          url,
          headers,
          data: body,
          timeout,
          onload: (/** @type {GmResponse} */ res) => {
            if (settled) return;
            settled = true;
            const text = String(res.response ?? res.responseText ?? '');
            resolve({
              ok: res.status >= 200 && res.status < 300,
              status: res.status,
              responseText: text,
            });
          },
          onerror: () => {
            if (settled) return;
            settled = true;
            reject(new Error('Network request failed'));
          },
          ontimeout: () => {
            if (settled) return;
            settled = true;
            reject(new Error('Request timed out'));
          },
          onabort: () => {
            if (settled) return;
            settled = true;
            reject(new DOMException('Aborted', 'AbortError'));
          },
        })
      );
      const onAbort = () => {
        if (settled) return;
        settled = true;
        try {
          handle?.abort?.();
        } catch (_e) {
          U?.logSuppressed?.(_e, 'Voting');
        }
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /**
   * Fetch hands back a Headers object; the DTO carries a plain record so the
   * value stays inspectable after the request is done. A response without a
   * headers object (a mocked transport, a bare body) yields null.
   * @param {Headers|undefined} headers
   * @returns {Record<string, string>|null}
   */
  function headersToObject(headers) {
    if (!headers || typeof headers.forEach !== 'function') return null;
    /** @type {Record<string, string>} */
    const out = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  function parseHttpBody_(
    /** @type {number} */ status,
    /** @type {RpcResponseBody} */ json,
    /** @type {Record<string, string>|null} */ headers = null
  ) {
    if (status < 200 || status >= 300) {
      let message = `HTTP ${status}`;
      const reported =
        typeof json === 'object' && json !== null
          ? /** @type {{ message?: unknown, code?: unknown }} */ (json)
          : null;
      if (typeof reported?.message === 'string') message = reported.message;
      if (reported?.code === 'PGRST202') {
        markCommunityServerUnavailable_();
      }
      return { data: null, error: message, status, headers };
    }
    return { data: json, error: null, status, headers };
  }

  /**
   * Vote ownership needs no separate actor handshake: the p_secret RPC
   * argument itself is the server-verified capability, so writes are
   * guarded only by the client read-only hint and the server contract.
   */
  async function assertCommunityWritable(/** @type {string} */ kind) {
    if (!isCommunityWritable()) {
      return { ok: false, error: `Community ${kind} are currently in read-only mode` };
    }
    return { ok: true };
  }

  function normalizeVoteType(/** @type {unknown} */ voteType) {
    try {
      const n = Number(voteType);
      if (n === 1) return 1;
      if (n === -1) return -1;
    } catch (e) {
      // A hostile valueOf/toString can make Number() throw.
      U?.logSuppressed?.(e, 'Voting');
    }
    return 0;
  }

  function renderSvgIcon(/** @type {string} */ name) {
    if (name === 'like') {
      return '<svg class="yp-vote-icon" viewBox="0 0 24 24" fill="none"><path d="M20.9751 12.1852L20.2361 12.0574L20.9751 12.1852ZM20.2696 16.265L19.5306 16.1371L20.2696 16.265ZM6.93776 20.4771L6.19055 20.5417H6.19055L6.93776 20.4771ZM6.1256 11.0844L6.87281 11.0198L6.1256 11.0844ZM13.9949 5.22142L14.7351 5.34269V5.34269L13.9949 5.22142ZM13.3323 9.26598L14.0724 9.38725V9.38725L13.3323 9.26598ZM6.69813 9.67749L6.20854 9.10933H6.20854L6.69813 9.67749ZM8.13687 8.43769L8.62646 9.00585H8.62646L8.13687 8.43769ZM10.518 4.78374L9.79207 4.59542L10.518 4.78374ZM10.9938 2.94989L11.7197 3.13821L11.7197 3.13821L10.9938 2.94989ZM12.6676 2.06435L12.4382 2.77841L12.4382 2.77841L12.6676 2.06435ZM12.8126 2.11093L13.0419 1.39687L13.0419 1.39687L12.8126 2.11093ZM9.86194 6.46262L10.5235 6.81599V6.81599L9.86194 6.46262ZM13.9047 3.24752L13.1787 3.43584V3.43584L13.9047 3.24752ZM11.6742 2.13239L11.3486 1.45675L11.3486 1.45675L11.6742 2.13239ZM20.2361 12.0574L19.5306 16.1371L21.0086 16.3928L21.7142 12.313L20.2361 12.0574ZM13.245 21.25H8.59634V22.75H13.245V21.25ZM7.68497 20.4125L6.87281 11.0198L5.37839 11.149L6.19055 20.5417L7.68497 20.4125ZM19.5306 16.1371C19.0238 19.0677 16.3813 21.25 13.245 21.25V22.75C17.0712 22.75 20.3708 20.081 21.0086 16.3928L19.5306 16.1371ZM13.2548 5.10015L12.5921 9.14472L14.0724 9.38725L14.7351 5.34269L13.2548 5.10015ZM7.18772 10.2456L8.62646 9.00585L7.64728 7.86954L6.20854 9.10933L7.18772 10.2456ZM11.244 4.97206L11.7197 3.13821L10.2678 2.76157L9.79207 4.59542L11.244 4.97206ZM12.4382 2.77841L12.5832 2.82498L13.0419 1.39687L12.897 1.3503L12.4382 2.77841ZM10.5235 6.81599C10.8354 6.23198 11.0777 5.61339 11.244 4.97206L9.79207 4.59542C9.65572 5.12107 9.45698 5.62893 9.20041 6.10924L10.5235 6.81599ZM12.5832 2.82498C12.8896 2.92342 13.1072 3.16009 13.1787 3.43584L14.6306 3.05921C14.4252 2.26719 13.819 1.64648 13.0419 1.39687L12.5832 2.82498ZM11.7197 3.13821C11.7547 3.0032 11.8522 2.87913 11.9998 2.80804L11.3486 1.45675C10.8166 1.71309 10.417 2.18627 10.2678 2.76157L11.7197 3.13821ZM11.9998 2.80804C12.1345 2.74311 12.2931 2.73181 12.4382 2.77841L12.897 1.3503C12.3872 1.18655 11.8312 1.2242 11.3486 1.45675L11.9998 2.80804ZM14.1537 10.9842H19.3348V9.4842H14.1537V10.9842ZM14.7351 5.34269C14.8596 4.58256 14.824 3.80477 14.6306 3.0592L13.1787 3.43584C13.3197 3.97923 13.3456 4.54613 13.2548 5.10016L14.7351 5.34269ZM8.59634 21.25C8.12243 21.25 7.726 20.887 7.68497 20.4125L6.19055 20.5417C6.29851 21.7902 7.34269 22.75 8.59634 22.75V21.25ZM8.62646 9.00585C9.30632 8.42 10.0391 7.72267 10.5235 6.81599L9.20041 6.10924C8.85403 6.75767 8.30249 7.30493 7.64728 7.86954L8.62646 9.00585ZM21.7142 12.313C21.9695 10.8365 20.8341 9.4842 19.3348 9.4842V10.9842C19.9014 10.9842 20.3332 11.4959 20.2361 12.0574L21.7142 12.313ZM12.5921 9.14471C12.4344 10.1076 13.1766 10.9842 14.1537 10.9842V9.4842C14.1038 9.4842 14.0639 9.43901 14.0724 9.38725L12.5921 9.14471ZM6.87281 11.0198C6.84739 10.7258 6.96474 10.4378 7.18772 10.2456L6.20854 9.10933C5.62021 9.61631 5.31148 10.3753 5.37839 11.149L6.87281 11.0198Z" fill="currentColor"></path><path opacity="0.5" d="M3.9716 21.4709L3.22439 21.5355L3.9716 21.4709ZM3 10.2344L3.74721 10.1698C3.71261 9.76962 3.36893 9.46776 2.96767 9.48507C2.5664 9.50239 2.25 9.83274 2.25 10.2344L3 10.2344ZM4.71881 21.4063L3.74721 10.1698L2.25279 10.299L3.22439 21.5355L4.71881 21.4063ZM3.75 21.5129V10.2344H2.25V21.5129H3.75ZM3.22439 21.5355C3.2112 21.383 3.33146 21.2502 3.48671 21.2502V22.7502C4.21268 22.7502 4.78122 22.1281 4.71881 21.4063L3.22439 21.5355ZM3.48671 21.2502C3.63292 21.2502 3.75 21.3686 3.75 21.5129H2.25C2.25 22.1954 2.80289 22.7502 3.48671 22.7502V21.2502Z" fill="currentColor"></path></svg>';
    }
    return '<svg class="yp-vote-icon" viewBox="0 0 24 24" fill="none"><path d="M20.9751 11.8148L20.2361 11.9426L20.9751 11.8148ZM20.2696 7.73505L19.5306 7.86285L20.2696 7.73505ZM6.93776 3.52293L6.19055 3.45832H6.19055L6.93776 3.52293ZM6.1256 12.9156L6.87281 12.9802L6.1256 12.9156ZM13.9949 18.7786L14.7351 18.6573V18.6573L13.9949 18.7786ZM13.3323 14.734L14.0724 14.6128V14.6128L13.3323 14.734ZM6.69813 14.3225L6.20854 14.8907H6.20854L6.69813 14.3225ZM8.13687 15.5623L8.62646 14.9942H8.62646L8.13687 15.5623ZM10.518 19.2163L9.79207 19.4046L10.518 19.2163ZM10.9938 21.0501L11.7197 20.8618L11.7197 20.8618L10.9938 21.0501ZM12.6676 21.9356L12.4382 21.2216L12.4382 21.2216L12.6676 21.9356ZM12.8126 21.8891L13.0419 22.6031L13.0419 22.6031L12.8126 21.8891ZM9.86194 17.5374L10.5235 17.184V17.184L9.86194 17.5374ZM13.9047 20.7525L13.1787 20.5642V20.5642L13.9047 20.7525ZM11.6742 21.8676L11.3486 22.5433L11.3486 22.5433L11.6742 21.8676ZM20.2361 11.9426L19.5306 7.86285L21.0086 7.60724L21.7142 11.687L20.2361 11.9426ZM13.245 2.75H8.59634V1.25H13.245V2.75ZM7.68497 3.58754L6.87281 12.9802L5.37839 12.851L6.19055 3.45832L7.68497 3.58754ZM19.5306 7.86285C19.0238 4.93226 16.3813 2.75 13.245 2.75V1.25C17.0712 1.25 20.3708 3.91895 21.0086 7.60724L19.5306 7.86285ZM13.2548 18.8998L12.5921 14.8553L14.0724 14.6128L14.7351 18.6573L13.2548 18.8998ZM7.18772 13.7544L8.62646 14.9942L7.64728 16.1305L6.20854 14.8907L7.18772 13.7544ZM11.244 19.0279L11.7197 20.8618L10.2678 21.2384L9.79207 19.4046L11.244 19.0279ZM12.4382 21.2216L12.5832 21.175L13.0419 22.6031L12.897 22.6497L12.4382 21.2216ZM10.5235 17.184C10.8354 17.768 11.0777 18.3866 11.244 19.0279L9.79207 19.4046C9.65572 18.8789 9.45698 18.3711 9.20041 17.8908L10.5235 17.184ZM12.5832 21.175C12.8896 21.0766 13.1072 20.8399 13.1787 20.5642L14.6306 20.9408C14.4252 21.7328 13.819 22.3535 13.0419 22.6031L12.5832 21.175ZM11.7197 20.8618C11.7547 20.9968 11.8522 21.1209 11.9998 21.192L11.3486 22.5433C10.8166 22.2869 10.417 21.8137 10.2678 21.2384L11.7197 20.8618ZM11.9998 21.192C12.1345 21.2569 12.2931 21.2682 12.4382 21.2216L12.897 22.6497C12.3872 22.8135 11.8312 22.7758 11.3486 22.5433L11.9998 21.192ZM14.1537 13.0158H19.3348V14.5158H14.1537V13.0158ZM14.7351 18.6573C14.8596 19.4174 14.824 20.1952 14.6306 20.9408L13.1787 20.5642C13.3197 20.0208 13.3456 19.4539 13.2548 18.8998L14.7351 18.6573ZM8.59634 2.75C8.12243 2.75 7.726 3.11302 7.68497 3.58754L6.19055 3.45832C6.29851 2.20975 7.34269 1.25 8.59634 1.25V2.75ZM8.62646 14.9942C9.30632 15.58 10.0391 16.2773 10.5235 17.184L9.20041 17.8908C8.85403 17.2423 8.30249 16.6951 7.64728 16.1305L8.62646 14.9942ZM21.7142 11.687C21.9695 13.1635 20.8341 14.5158 19.3348 14.5158V13.0158C19.9014 13.0158 20.3332 12.5041 20.2361 11.9426L21.7142 11.687ZM12.5921 14.8553C12.4344 13.8924 13.1766 13.0158 14.1537 13.0158V14.5158C14.1038 14.5158 14.0639 14.561 14.0724 14.6128L12.5921 14.8553ZM6.87281 12.9802C6.84739 13.2742 6.96474 13.5622 7.18772 13.7544L6.20854 14.8907C5.62021 14.3837 5.31148 13.6247 5.37839 12.851L6.87281 12.9802Z" fill="currentColor"></path><path opacity="0.5" d="M3.9716 2.52911L3.22439 2.4645L3.9716 2.52911ZM3 13.7656L3.74721 13.8302C3.71261 14.2304 3.36893 14.5322 2.96767 14.5149C2.5664 14.4976 2.25 14.1673 2.25 13.7656L3 13.7656ZM4.71881 2.59372L3.74721 13.8302L2.25279 13.701L3.22439 2.4645L4.71881 2.59372ZM3.75 2.48709V13.7656H2.25V2.48709H3.75ZM3.22439 2.4645C3.2112 2.61704 3.33146 2.74983 3.48671 2.74983V1.24983C4.21268 1.24983 4.78122 1.87192 4.71881 2.59372L3.22439 2.4645ZM3.48671 2.74983C3.63292 2.74983 3.75 2.63139 3.75 2.48709H2.25C2.25 1.80457 2.80289 1.24983 3.48671 1.24983V2.74983Z" fill="currentColor"></path></svg>';
  }

  // ---- CONFIGURATION & CONSTANTS -------------------------------------------
  // Community traffic goes through the author proxy. The client embeds no
  // Supabase key; the proxy adds the public anon key itself.
  const SUPABASE_URL = 'https://vote.diorhc.space';
  // Absolute URLs from server responses are trusted only for the legacy
  // Supabase origin (re-pointed at SUPABASE_URL by resolveMediaUrl_);
  // any other origin is rejected.
  const LEGACY_SUPABASE_ORIGIN = 'https://ldpccocxlrdsyejfhrvc.supabase.co';
  const BUCKET_ID = 'voting-images';
  const IMAGE_BASE_URL = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_ID}/`;
  const MAX_ATTACHMENTS = 4;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MiB
  const MAX_IMAGE_DIMENSION = 2560; // Long edge clamp
  const ALLOWED_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
  const LOAD_DEADLINE_MS = 15000;
  // Bounded reads: page size and batch ID lists are contract constants
  // mirrored by server-side caps (schema.sql).
  const PAGE_SIZE = 50;
  const MAX_BATCH_IDS = 200;

  /** Resolve a server-provided media path. Relative paths resolve
   * against the proxy's public storage base; absolute URLs are trusted only
   * for the legacy Supabase origin (re-pointed at SUPABASE_URL) and rejected
   * for any other origin. Returns null when the URL must be dropped. */
  function resolveMediaUrl_(/** @type {string} */ rawPath) {
    const raw = String(rawPath || '');
    if (!/^https?:\/\//i.test(raw)) {
      return `${IMAGE_BASE_URL}${raw}`;
    }
    try {
      const parsed = new URL(raw);
      if (parsed.origin === LEGACY_SUPABASE_ORIGIN) {
        return `${SUPABASE_URL}${parsed.pathname}${parsed.search}`;
      }
      return null;
    } catch (_e) {
      U?.logSuppressed?.(_e, 'Voting');
      return null;
    }
  }

  /**
   * Split an ID list into server-cap-sized batches (schema.sql rejects a
   * batch larger than MAX_BATCH_IDS with a contract error).
   * @param {string[]} ids
   * @returns {string[][]}
   */
  function chunkIds(ids) {
    /** @type {string[][]} */
    const chunks = [];
    for (let i = 0; i < ids.length; i += MAX_BATCH_IDS) {
      chunks.push(ids.slice(i, i + MAX_BATCH_IDS));
    }
    return chunks;
  }

  /**
   * Shared batch loop behind the five aggregate readers (vote counts, feature
   * images, comment counts, comments, comment images): chunk the IDs, call the
   * RPC, validate the page through asRowPayload_, hand every accepted row to
   * `handleRow`, and keep the first error (a page with non-object entries
   * counts as malformed). A failing chunk degrades the aggregate to partial
   * without erasing rows already collected.
   * @param {{ rpc: (fn: string, params: RpcParams, signal?: AbortSignal) => Promise<{ error: string | null, data: unknown }> }} api
   * @param {string} fnName RPC name @param {string} paramName RPC param
   * @param {string[]} ids filtered IDs @param {AbortSignal|undefined} signal
   * @param {(row: Record<string, unknown>) => string | null} handleRow error message or null
   * @param {string} malformedMsg error for a malformed page
   * @returns {Promise<{ error: string | null }>}
   */
  async function batchedRowsRpc_(api, fnName, paramName, ids, signal, handleRow, malformedMsg) {
    /** @type {string|null} */
    let firstError = null;
    for (const chunk of chunkIds(ids)) {
      const res = await api.rpc(fnName, { [paramName]: chunk }, signal);
      if (res.error) {
        firstError = firstError || res.error;
        continue;
      }
      const payload = asRowPayload_(res.data);
      if (!payload.ok) {
        // A malformed body is unavailable, never an empty but successful page.
        firstError = firstError || malformedMsg;
        continue;
      }
      // A non-object entry is a malformed row: it is dropped, never
      // rendered, and the aggregate reports the page as malformed.
      if (payload.rows.length !== /** @type {unknown[]} */ (res.data).length) {
        firstError = firstError || malformedMsg;
      }
      for (const row of payload.rows) {
        const rowError = handleRow(row);
        if (rowError) firstError = firstError || rowError;
      }
    }
    return { error: firstError };
  }

  // ---- DTO VALIDATION (small local validators) ------------------------------
  // Rows must be objects with known fields, counts must be finite
  // non-negative numbers, IDs must be non-empty strings. A malformed FIELD
  // is unknown (the row is skipped, the rest of the batch stays visible);
  // a malformed PAGE is an error, never a successful empty list or zero.

  /**
   * @typedef {Record<string, unknown>} RpcParams
   * @typedef {{ rows: Record<string, unknown>[], error: string | null, hasMore: boolean, nextCursor: { createdAt: string, id: string } | null }} VotingFeatureList
   */

  /**
   * A row-payload shape check: an array of objects, or a shape error.
   * @param {unknown} data
   * @returns {{ ok: true; rows: Record<string, unknown>[] } | { ok: false }}
   */
  function asRowPayload_(data) {
    if (!Array.isArray(data)) return { ok: false };
    const rows = data.filter(
      /** @type {(r: unknown) => r is Record<string, unknown>} */ (
        r => Boolean(r) && typeof r === 'object' && !Array.isArray(r)
      )
    );
    return { ok: true, rows };
  }

  /**
   * The `get_feature_requests` page: the row array plus the keyset cursor.
   * @param {unknown} data
   * @returns {VotingFeatureListPage|null} null when the page is malformed
   */
  function asListPage(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const page =
      /** @type {{ rows?: unknown, hasMore?: unknown, nextCursorCreatedAt?: unknown, nextCursorId?: unknown }} */ (
        data
      );
    if (!Array.isArray(page.rows) || typeof page.hasMore !== 'boolean') return null;
    return /** @type {VotingFeatureListPage} */ (page);
  }

  /** @param {unknown} v @returns {string | null} non-empty string ID or unknown */
  function asIdText_(v) {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  }

  /** @param {unknown} v @returns {number | null} finite non-negative count or unknown */
  function asCount_(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    return Math.floor(v);
  }

  // ---- COMMUNITY WRITE PREDICATE -------------------------------------------
  // Protective mode: when the deployed server does not match the client
  // contract (PGRST202 on a read-RPC or an Edge 404), retrying cannot help
  // until the server is migrated. The panel goes read-only with an explicit
  // unavailability state instead of a futile Retry loop.
  let communityServerUnavailable = false;
  function markCommunityServerUnavailable_() {
    communityServerUnavailable = true;
  }
  function isCommunityServerUnavailable() {
    return communityServerUnavailable;
  }

  function isCommunityWritable() {
    if (communityServerUnavailable) return false;
    return window.YouTubePlusConfig?.communityWritesEnabled === true;
  }
  const isCommunityWriteEnabled = isCommunityWritable;

  /**
   * @param {string} url
   * @param {Record<string, string>} headers
   * @param {RequestInit & { ownerPayload?: boolean }} options
   */
  const fetchRestViaGm_ = async (url, headers, options) => {
    try {
      const res = await gmHttp_(url, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        signal: /** @type {AbortSignal|undefined} */ (options.signal ?? undefined),
      });
      let json = null;
      let parseFailed = false;
      try {
        json = res.responseText ? JSON.parse(res.responseText) : null;
      } catch (e) {
        // Malformed body is reported below as an explicit unavailable state.
        U?.logSuppressed?.(e, 'Voting');
        parseFailed = true;
      }
      if (parseFailed || res.responseText === '') {
        return {
          data: null,
          error: 'Malformed JSON response',
          status: res.status,
          headers: null,
        };
      }
      return parseHttpBody_(res.status, json);
    } catch (err) {
      const caught = asErrorLike_(err);
      if (caught?.name === 'AbortError') throw err;
      U?.logSuppressed?.(err, 'Voting');
      return {
        data: null,
        error: /** @type {string} */ (caught?.message) || 'Network request failed',
        status: 0,
        headers: null,
      };
    }
  };

  /**
   * @param {string} url
   * @param {Record<string, string>} headers
   * @param {RequestInit & { ownerPayload?: boolean }} options
   */
  const fetchRestViaFetch_ = async (url, headers, options) => {
    const res = await fetch(url, {
      ...options,
      headers,
      // every request carries a 15 s deadline (owner payloads and public
      // reads alike) so a hung request can never keep the UI in progress.
      signal: options.signal || AbortSignal.timeout(OWNER_REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      let json = null;
      try {
        json = await res.json();
      } catch (e) {
        U?.logSuppressed?.(e, 'Voting');
        json = null;
      }
      return parseHttpBody_(res.status, json, headersToObject(res.headers));
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      U?.logSuppressed?.(e, 'Voting');
      return {
        data: null,
        error: 'Malformed JSON response',
        status: res.status,
        headers: headersToObject(res.headers),
      };
    }
    return { data, error: null, status: res.status, headers: headersToObject(res.headers) };
  };

  /**
   * Resolve batched image rows into per-owner-id URL lists, dropping rows
   * whose storage path is not a trusted origin.
   * @param {{ rpc: (fn: string, params: RpcParams, signal?: AbortSignal) => Promise<{ error: string | null, data: unknown }> }} api
   * @param {string[]} ids
   * @param {AbortSignal|undefined} signal
   * @param {{ rpc: string, param: string, idField: string }} spec
   * @returns {Promise<{ images: Record<string, VotingResolvedImage[]>, error: string | null }>}
   */
  const fetchImageRows_ = async (api, ids, signal, spec) => {
    const clean = (ids || []).filter(Boolean);
    if (clean.length === 0) return { images: {}, error: null };

    /** @type {Record<string, VotingResolvedImage[]>} */
    const images = {};
    const { error } = await batchedRowsRpc_(
      api,
      spec.rpc,
      spec.param,
      clean,
      signal,
      img => {
        const id = asIdText_(img?.[spec.idField]);
        const path = asIdText_(img?.storage_path);
        const fullUrl = path ? resolveMediaUrl_(path) : null;
        // An untrusted origin in storage_path is dropped, never rendered.
        if (!(id && fullUrl)) return 'Malformed image row';
        (images[id] ||= []).push(
          /** @type {VotingResolvedImage} */ (/** @type {unknown} */ ({ ...img, url: fullUrl }))
        );
        return null;
      },
      'Malformed images response'
    );
    return { images, error };
  };

  // ---- VOTING API -----------------------------------------------------------
  const VotingApi = {
    isCommunityWritable,
    isCommunityWriteEnabled,

    async fetchRest(
      /** @type {string} */ path,
      /** @type {RequestInit & { ownerPayload?: boolean }} */ options = {}
    ) {
      const url = `${SUPABASE_URL}/rest/v1/${path}`;
      const headers = {};
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';

      // when the manager transport exists, every RPC travels
      // through GM_xmlhttpRequest so owner payloads (p_secret /
      // p_owner_capability) never touch the shared page fetch.
      if (gmTransportAvailable_()) {
        return fetchRestViaGm_(url, headers, options);
      }
      // Without the isolated transport, owner payloads are never sent through
      // the page-context fetch; public reads keep the plain fetch fallback.
      if (options.ownerPayload) {
        return { data: null, error: 'Owner transport unavailable', status: 0, headers: null };
      }
      return fetchRestViaFetch_(url, headers, options);
    },

    async rpc(
      /** @type {string} */ fnName,
      /** @type {RpcParams} */ args = {},
      /** @type {AbortSignal|undefined} */ signal = undefined
    ) {
      // payloads carrying the owner secret or capability must
      // never fall back to the shared page fetch.
      const ownerPayload =
        args !== null &&
        typeof args === 'object' &&
        ('p_secret' in args || 'p_owner_capability' in args);
      return this.fetchRest(`rpc/${fnName}`, {
        method: 'POST',
        body: JSON.stringify(args),
        signal,
        ownerPayload,
      });
    },

    // --- Reads (RPC-only) ---
    // Every read DTO distinguishes { data, error, partial, cursor }: an error
    // is never conflated with empty data, and the list page carries an explicit
    // continuation cursor.
    /** @returns {Promise<VotingFeatureList>} */
    async getFeatureRequests(
      /** @type {{ cursor?: { createdAt: string, id: string } | null, limit?: number, signal?: AbortSignal }} */ options = {}
    ) {
      const { cursor = null, limit = PAGE_SIZE, signal = undefined } = options || {};
      const res = await this.rpc(
        'get_feature_requests',
        {
          p_limit: limit,
          p_cursor_created: cursor?.createdAt ?? null,
          p_cursor_id: cursor?.id ?? null,
        },
        signal
      );
      const page = asListPage(res.data);
      if (res.error || !page) {
        return {
          rows: [],
          error: res.error || 'Malformed list response',
          hasMore: false,
          nextCursor: null,
        };
      }
      const rows = page.rows.filter(
        /** @type {(r: unknown) => r is VotingFeatureRow} */ (
          r => Boolean(r) && typeof r === 'object' && !Array.isArray(r)
        )
      );
      const hasMore = page.hasMore;
      const nextCursor =
        hasMore && page.nextCursorCreatedAt && page.nextCursorId
          ? {
              createdAt: String(page.nextCursorCreatedAt),
              id: String(page.nextCursorId),
            }
          : null;
      if (hasMore && !nextCursor) {
        // Fail closed: a page that claims more data without a usable cursor
        // can never masquerade as the complete dataset.
        return {
          rows,
          error: 'Malformed list response (hasMore without cursor)',
          hasMore: false,
          nextCursor: null,
        };
      }
      return { rows, error: null, hasMore, nextCursor };
    },

    /** @returns {Promise<VotingPreviewFeature>} */
    async getPreviewFeature(/** @type {AbortSignal|undefined} */ signal = undefined) {
      const res = await this.rpc('get_preview_feature', {}, signal);
      if (res.error) {
        return { feature: null, error: res.error };
      }
      const payload = asRowPayload_(res.data);
      if (!payload.ok) {
        // A malformed body is unavailable, never "no preview feature".
        return { feature: null, error: 'Malformed preview response' };
      }
      return {
        feature: payload.rows.length > 0 ? /** @type {VotingFeatureRow} */ (payload.rows[0]) : null,
        error: null,
      };
    },

    /** @returns {Promise<{ votes: Record<string, { upvotes: number, downvotes: number }>, error: string | null }>} */
    async getVoteCounts(
      /** @type {string[]} */ featureIds,
      /** @type {AbortSignal|undefined} */ signal = undefined
    ) {
      const ids = (featureIds || []).filter(Boolean);
      if (ids.length === 0) return { votes: {}, error: null };

      /** @type {Record<string, { upvotes: number, downvotes: number }>} */
      const votes = {};
      const { error } = await batchedRowsRpc_(
        this,
        'get_vote_counts',
        'p_feature_ids',
        ids,
        signal,
        row => {
          const id = asIdText_(row?.feature_id);
          const upvotes = asCount_(row?.upvotes);
          const downvotes = asCount_(row?.downvotes);
          if (!id || upvotes === null || downvotes === null) {
            // A malformed row is unknown, never a fabricated zero aggregate.
            return 'Malformed vote count row';
          }
          votes[id] = { upvotes, downvotes };
          return null;
        },
        'Malformed vote counts response'
      );
      return { votes, error };
    },

    /** @returns {Promise<{ userVotes: Record<string, number>, error: string | null }>} */
    async getMyVotes(/** @type {AbortSignal|undefined} */ signal = undefined) {
      // Private history is fetched with the owner secret; a guessed
      // ID string returns an empty (unregistered) surface.
      const res = await this.rpc('get_my_votes', { p_secret: await getOwnerSecret() }, signal);
      /** @type {Record<string, number>} */
      const userVotes = {};
      if (res.error) {
        return { userVotes, error: res.error };
      }
      // A non-array payload is a malformed response: an error is surfaced,
      // never silently conflated with "no votes".
      if (!Array.isArray(res.data)) {
        return { userVotes, error: 'Malformed my-votes response' };
      }
      res.data.forEach(row => {
        const v = /** @type {VotingMyVoteRow} */ (/** @type {unknown} */ (row));
        const voteType = normalizeVoteType(v.vote_type);
        if (voteType && v.feature_id) userVotes[v.feature_id] = voteType;
      });
      return { userVotes, error: null };
    },

    /** @returns {Promise<VotingFeatureImages>} */
    async getFeatureImages(
      /** @type {string[]} */ featureIds,
      /** @type {AbortSignal|undefined} */ signal = undefined
    ) {
      return fetchImageRows_(this, featureIds, signal, {
        rpc: 'get_feature_images',
        param: 'p_feature_ids',
        idField: 'feature_id',
      });
    },

    /**
     * Card comment counts as a lightweight aggregate; the full comment text
     * is only fetched on demand through getComments.
     */
    /** @returns {Promise<{ counts: Record<string, number>, error: string | null }>} */
    async getCommentCounts(
      /** @type {string[]} */ featureIds,
      /** @type {AbortSignal|undefined} */ signal = undefined
    ) {
      const ids = (featureIds || []).filter(Boolean);
      if (ids.length === 0) return { counts: {}, error: null };

      /** @type {Record<string, number>} */
      const counts = {};
      const { error } = await batchedRowsRpc_(
        this,
        'get_feature_comment_counts',
        'p_feature_ids',
        ids,
        signal,
        row => {
          const id = asIdText_(row?.feature_id);
          const count = asCount_(row?.comment_count);
          // A malformed row is unknown, never a fabricated zero count.
          if (!id || count === null) return 'Malformed comment count row';
          counts[id] = count;
          return null;
        },
        'Malformed comment counts response'
      );
      return { counts, error };
    },

    /** @returns {Promise<VotingComments>} */
    async getComments(
      /** @type {string[]} */ featureIds,
      /** @type {AbortSignal|undefined} */ signal = undefined
    ) {
      const ids = (featureIds || []).filter(Boolean);
      if (ids.length === 0) return { comments: {}, error: null };

      /** @type {Record<string, VotingCommentRow[]>} */
      const comments = {};
      const { error } = await batchedRowsRpc_(
        this,
        'get_feature_comments',
        'p_feature_ids',
        ids,
        signal,
        c => {
          const id = asIdText_(c?.feature_id);
          // A malformed row is surfaced like in the neighboring readers, never
          // silently dropped.
          const ok = id && asIdText_(c?.id) && typeof c.comment === 'string';
          if (!ok) return 'Malformed comment row';
          (comments[id] ||= []).push(/** @type {VotingCommentRow} */ (/** @type {unknown} */ (c)));
          return null;
        },
        'Malformed comments response'
      );
      return { comments, error };
    },

    /** @returns {Promise<VotingCommentImages>} */
    async getCommentImages(
      /** @type {string[]} */ commentIds,
      /** @type {AbortSignal|undefined} */ signal = undefined
    ) {
      return fetchImageRows_(this, commentIds, signal, {
        rpc: 'get_comment_images',
        param: 'p_comment_ids',
        idField: 'comment_id',
      });
    },

    // --- Writes ---
    async castVote(/** @type {string} */ featureId, /** @type {number} */ voteType) {
      const writable = await assertCommunityWritable('voting');
      if (!writable.ok) {
        return { success: false, error: writable.error };
      }
      const normalizedVote = normalizeVoteType(voteType);
      const res = await this.rpc('cast_vote', {
        p_feature_id: featureId,
        p_vote_type: normalizedVote,
        p_secret: await getOwnerSecret(),
      });

      if (res.error) {
        return { success: false, error: res.error };
      }
      return {
        success: true,
        action: res.data?.action || (normalizedVote === 0 ? 'removed' : 'added'),
      };
    },

    async submitFeature(/** @type {string} */ title, /** @type {string} */ description) {
      const writable = await assertCommunityWritable('submissions');
      if (!writable.ok) {
        return { success: false, error: writable.error };
      }
      const cleanTitle = normalizeUserText(title).slice(0, 200);
      const cleanDesc = normalizeUserText(description).slice(0, 2000);

      if (!cleanTitle) {
        return { success: false, error: 'Title is required' };
      }

      // Duplicate-title detection is owned ATOMICALLY by the submit_feature
      // RPC (no client-side lookup round trip, no TOCTOU). The RPC raises the
      // exact same user-visible error string through res.error.
      const res = await this.rpc('submit_feature', {
        p_title: cleanTitle,
        p_description: cleanDesc,
        p_secret: await getOwnerSecret(),
      });

      if (res.error) {
        return { success: false, error: res.error };
      }
      return { success: true, data: res.data };
    },

    async submitComment(/** @type {string} */ featureId, /** @type {string} */ commentText) {
      const writable = await assertCommunityWritable('comments');
      if (!writable.ok) {
        return { success: false, error: writable.error };
      }
      const cleanText = normalizeUserText(commentText);
      if (!cleanText || cleanText.length > 1000) {
        return { success: false, error: 'Comment must be 1 to 1000 characters' };
      }

      const res = await this.rpc('submit_comment', {
        p_feature_id: featureId,
        p_comment: cleanText,
        p_secret: await getOwnerSecret(),
      });

      if (res.error || !res.data) {
        return { success: false, error: res.error || 'Failed to submit comment' };
      }

      return {
        success: true,
        comment: {
          id: res.data.id,
          featureId: res.data.featureId,
          comment: res.data.comment,
          createdAt: res.data.createdAt,
        },
        ownerCapability: res.data.ownerCapability,
      };
    },

    async signUpload(
      /** @type {{ target: 'feature'|'comment', parentId: string, idempotencyKey: string, ownerCapability: string, mimeType: string }} */ payload
    ) {
      if (!isCommunityWritable()) {
        return { success: false, error: 'Community uploads are currently in read-only mode' };
      }

      const requestBody = JSON.stringify({
        idempotencyKey: payload.idempotencyKey,
        mimeType: payload.mimeType,
        ownerCapability: payload.ownerCapability,
        parentId: payload.parentId,
        target: payload.target,
      });

      const res = await gmHttp_(`${SUPABASE_URL}/functions/v1/ytplus-image-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: requestBody,
      });

      if (!res.ok) {
        let errMessage = `Upload reservation failed (HTTP ${res.status})`;
        try {
          const errData = JSON.parse(res.responseText || '{}');
          if (errData?.error) errMessage = errData.error;
        } catch (_e) {
          U?.logSuppressed?.(_e, 'Voting');
        }
        return { success: false, error: errMessage };
      }

      let data = null;
      try {
        data = JSON.parse(res.responseText || '{}');
      } catch (_e) {
        U?.logSuppressed?.(_e, 'Voting');
        data = null;
      }
      return { success: true, data };
    },

    async uploadBinary(
      /** @type {string} */ signedUrl,
      /** @type {Blob} */ blob,
      /** @type {string} */ mimeType
    ) {
      let fullUrl;
      if (typeof signedUrl === 'string' && /^https?:\/\//i.test(signedUrl)) {
        // absolute signed URLs are accepted ONLY for the proxy
        // origin (as-is) and the legacy Supabase origin (re-pointed at the
        // proxy). Anything else is refused before any network call.
        try {
          const parsed = new URL(signedUrl);
          if (parsed.origin === SUPABASE_URL) {
            fullUrl = signedUrl;
          } else {
            const rewritten = resolveMediaUrl_(signedUrl);
            if (!rewritten) {
              return { success: false, error: 'Untrusted upload URL origin' };
            }
            fullUrl = rewritten;
          }
        } catch (_e) {
          U?.logSuppressed?.(_e, 'Voting');
          return { success: false, error: 'Untrusted upload URL origin' };
        }
      } else {
        fullUrl = `${SUPABASE_URL}/storage/v1/${String(signedUrl || '').replace(/^\/?(storage\/v1\/)?/, '')}`;
      }

      // The signed PUT carries a one-time token in the URL. Route it through
      // the isolated manager transport when available; the plain fetch fallback
      // is acceptable here since no owner payload is inside.
      if (gmTransportAvailable_()) {
        try {
          const res = await gmHttp_(fullUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': mimeType,
            },
            body: blob,
          });
          return { success: res.ok, status: res.status };
        } catch (_e) {
          U?.logSuppressed?.(_e, 'Voting');
          return { success: false, status: 0 };
        }
      }

      const res = await fetch(fullUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
        },
        body: blob,
      });

      return { success: res.ok, status: res.status };
    },

    async finalizeFeatureImage(
      /** @type {string} */ featureId,
      /** @type {string} */ ownerCapability,
      /** @type {string} */ slotId
    ) {
      if (!isCommunityWritable()) {
        return { success: false, error: 'Community uploads are currently in read-only mode' };
      }
      return this.rpc('finalize_feature_image', {
        p_feature_id: featureId,
        p_owner_capability: ownerCapability,
        p_slot_id: slotId,
      });
    },

    async finalizeCommentImage(
      /** @type {string} */ commentId,
      /** @type {string} */ ownerCapability,
      /** @type {string} */ slotId
    ) {
      if (!isCommunityWritable()) {
        return { success: false, error: 'Community uploads are currently in read-only mode' };
      }
      return this.rpc('finalize_comment_image', {
        p_comment_id: commentId,
        p_owner_capability: ownerCapability,
        p_slot_id: slotId,
      });
    },
  };

  // ---- SHARED MEDIA PIPELINE (VOTING MEDIA) --------------------------------
  const activeObjectUrls = new Set();

  const VotingMedia = {
    getAllowedTypes: () => ALLOWED_IMAGE_TYPES,
    getMaxAttachments: () => MAX_ATTACHMENTS,
    getMaxBytes: () => MAX_IMAGE_BYTES,
    getMaxDimension: () => MAX_IMAGE_DIMENSION,

    revokeUrl(/** @type {string} */ url) {
      if (url && activeObjectUrls.has(url)) {
        URL.revokeObjectURL(url);
        activeObjectUrls.delete(url);
      }
    },

    revokeAll() {
      activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
      activeObjectUrls.clear();
    },

    validateFile(/** @type {File} */ file) {
      if (!file) return { valid: false, error: 'No file provided' };
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return {
          valid: false,
          error: tf('invalidFileType', 'Only JPG, PNG, and WebP images are allowed'),
        };
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return { valid: false, error: tf('fileTooLarge', 'File size exceeds 5MB limit') };
      }
      return { valid: true, error: null };
    },

    calculateDimensions(/** @type {number} */ width, /** @type {number} */ height) {
      const maxDim = MAX_IMAGE_DIMENSION;
      if (width <= maxDim && height <= maxDim) {
        return { width, height };
      }
      const ratio = maxDim / Math.max(width, height);
      return {
        width: Math.round(width * ratio),
        height: Math.round(height * ratio),
      };
    },

    async processImage(/** @type {File} */ file) {
      const validation = this.validateFile(file);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid image file');
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error('Failed to decode image'));
          img.onload = () => {
            const { width, height } = this.calculateDimensions(img.naturalWidth, img.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('Could not get canvas context'));
              return;
            }

            if (file.type === 'image/jpeg') {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, width, height);
            } else {
              ctx.clearRect(0, 0, width, height);
            }

            ctx.drawImage(img, 0, 0, width, height);

            const mimeType = file.type;
            const quality = mimeType === 'image/png' ? undefined : 0.85;

            canvas.toBlob(
              blob => {
                if (!blob) {
                  reject(new Error('Failed to encode image'));
                  return;
                }
                if (blob.size > MAX_IMAGE_BYTES) {
                  reject(
                    new Error(
                      tf('imageTooLarge', 'Image exceeds 5MB limit. Please choose a smaller image.')
                    )
                  );
                  return;
                }
                const previewUrl = URL.createObjectURL(blob);
                activeObjectUrls.add(previewUrl);

                resolve({
                  draftId: generateUUID(),
                  file,
                  blob,
                  mimeType,
                  previewUrl,
                  width,
                  height,
                  size: blob.size,
                  status: 'pending',
                  error: null,
                });
              },
              mimeType,
              quality
            );
          };
          img.src = String(reader.result);
        };
        reader.readAsDataURL(file);
      });
    },
  };

  // ---- SHARED LIGHTBOX GALLERY (VOTING GALLERY) -----------------------------
  const VotingGallery = {
    modalEl: /** @type {HTMLElement|null} */ (null),
    items: /** @type {Array<{ url: string, caption?: string }>} */ ([]),
    currentIndex: 0,
    lastFocusedElement: /** @type {HTMLElement|null} */ (null),
    initialized: false,

    ensureDom(ctx = runtimeCtx) {
      if (this.modalEl) return;
      let modal = /** @type {HTMLElement|null} */ (byId('yp-gallery-modal'));
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'yp-gallery-modal';
        modal.className = 'yp-gallery-modal';
        modal.style.display = 'none';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', tf('imageGallery', 'Image gallery'));
        modal.tabIndex = -1;

        _setSafeHTML(
          modal,
          `
          <div class="yp-gallery-backdrop"></div>
          <div class="yp-gallery-content">
            <button type="button" class="yp-gallery-close" aria-label="${tf('close', 'Close')}">&times;</button>
            <div class="yp-gallery-img-container">
              <img class="yp-gallery-img" src="" alt="" />
            </div>
            <div class="yp-gallery-nav">
              <button type="button" class="yp-gallery-prev" aria-label="${tf('previous', 'Previous')}">&larr;</button>
              <span class="yp-gallery-counter"></span>
              <button type="button" class="yp-gallery-next" aria-label="${tf('next', 'Next')}">&rarr;</button>
            </div>
            <div class="yp-gallery-caption"></div>
          </div>`
        );
        document.body.appendChild(modal);
      }
      this.modalEl = modal;
      if (ctx) ctx.own(modal);

      if (!this.initialized) {
        this.initialized = true;
        const closeBtn = modal.querySelector('.yp-gallery-close');
        const backdrop = modal.querySelector('.yp-gallery-backdrop');
        const prevBtn = modal.querySelector('.yp-gallery-prev');
        const nextBtn = modal.querySelector('.yp-gallery-next');

        if (closeBtn) _runtimeListener(ctx, closeBtn, 'click', () => this.close());
        if (backdrop) _runtimeListener(ctx, backdrop, 'click', () => this.close());
        if (prevBtn) _runtimeListener(ctx, prevBtn, 'click', () => this.prev());
        if (nextBtn) _runtimeListener(ctx, nextBtn, 'click', () => this.next());

        _runtimeListener(ctx, window, 'keydown', (/** @type {KeyboardEvent} */ e) => {
          if (!this.isOpen()) return;
          if (e.key === 'Escape') {
            this.close();
            e.preventDefault();
          } else if (e.key === 'ArrowLeft') {
            this.prev();
            e.preventDefault();
          } else if (e.key === 'ArrowRight') {
            this.next();
            e.preventDefault();
          }
        });
      }
    },

    isOpen() {
      return Boolean(this.modalEl && this.modalEl.style.display !== 'none');
    },

    open({
      items = /** @type {Array<{ url: string, caption?: string }>} */ ([]),
      initialIndex = 0,
    } = {}) {
      if (!items || items.length === 0) return;
      this.ensureDom();
      this.items = items;
      this.currentIndex = Math.max(0, Math.min(initialIndex, items.length - 1));
      this.lastFocusedElement = /** @type {HTMLElement|null} */ (document.activeElement);

      if (this.modalEl) {
        this.modalEl.style.display = 'flex';
        this.modalEl.classList.add('open');
        this.updateView();
        const closeBtn = /** @type {HTMLElement|null} */ (
          this.modalEl.querySelector('.yp-gallery-close')
        );
        closeBtn?.focus();
      }
    },

    close() {
      if (this.modalEl) {
        this.modalEl.style.display = 'none';
        this.modalEl.classList.remove('open');
      }
      this.items = [];
      if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
        try {
          this.lastFocusedElement.focus();
        } catch (_e) {
          U?.logSuppressed?.(_e, 'Voting');
        }
      }
      this.lastFocusedElement = null;
    },

    next() {
      if (this.items.length <= 1) return;
      this.currentIndex = (this.currentIndex + 1) % this.items.length;
      this.updateView();
    },

    prev() {
      if (this.items.length <= 1) return;
      this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
      this.updateView();
    },

    updateView() {
      if (!this.modalEl || this.items.length === 0) return;
      const item = this.items[this.currentIndex];
      const img = /** @type {HTMLImageElement|null} */ (
        this.modalEl.querySelector('.yp-gallery-img')
      );
      const counter = this.modalEl.querySelector('.yp-gallery-counter');
      const caption = this.modalEl.querySelector('.yp-gallery-caption');
      const prevBtn = /** @type {HTMLElement|null} */ (
        this.modalEl.querySelector('.yp-gallery-prev')
      );
      const nextBtn = /** @type {HTMLElement|null} */ (
        this.modalEl.querySelector('.yp-gallery-next')
      );

      if (img) {
        img.src = item.url;
        img.alt = item.caption || `Image ${this.currentIndex + 1}`;
      }
      if (counter) {
        counter.textContent = `${this.currentIndex + 1} / ${this.items.length}`;
      }
      if (caption) {
        caption.textContent = item.caption || '';
      }
      if (prevBtn) prevBtn.style.display = this.items.length > 1 ? '' : 'none';
      if (nextBtn) nextBtn.style.display = this.items.length > 1 ? '' : 'none';
    },
  };

  // ---- VOTING SYSTEM UI RUNTIME ---------------------------------------------
  /** @type {YouTubePlusFeatureContext|null} */
  let runtimeCtx = null;
  let votingInitialized = false;
  let activeLoadGeneration = 0;
  /** @type {AbortController|null} */
  let activeLoadAbort = null;
  let currentCommentsFeatureId = '';

  /** In-memory session for comment submission partial-failure recovery; never written to DOM or storage. */
  /** @type {VotingUploadSession|null} */
  let currentCommentSession = null;

  /** Drafted images in attachment composer */
  /** @type {VotingImageDraft[]} */
  let commentDrafts = [];

  let delegatedListenersWired = false;
  let voteInFlight = false;
  let votingInitDeferred = false;

  function initVoting(force = false, ctx = runtimeCtx) {
    if (ctx) runtimeCtx = ctx;
    if (votingInitialized && !force) return;
    // At document-start <body> does not exist yet; the comments panel and
    // the gallery attach to it, so initialization waits for the DOM.
    if (!document.body) {
      if (!votingInitDeferred) {
        votingInitDeferred = true;
        _runtimeListener(
          runtimeCtx,
          document,
          'DOMContentLoaded',
          () => {
            votingInitDeferred = false;
            initVoting(force);
          },
          { once: true }
        );
      }
      return;
    }
    votingInitialized = true;
    initCommentsPanel(runtimeCtx);
    VotingGallery.ensureDom(runtimeCtx);
    if (!delegatedListenersWired) {
      delegatedListenersWired = true;
      wireDelegatedListeners(runtimeCtx);
    }
  }

  /** Release the route-bound runtime and let a later start rebuild it. */
  function stopVotingRuntime() {
    closeCommentsModal();
    runtimeCtx = null;
    votingInitialized = false;
    delegatedListenersWired = false;
    VotingGallery.modalEl = null;
    VotingGallery.initialized = false;
    VotingGallery.items = [];
  }

  async function handleDelegatedBarClick(/** @type {HTMLElement} */ barBtn) {
    const previewRes = await VotingApi.getPreviewFeature();
    const previewFeature = previewRes.feature;
    if (!previewFeature?.id) return;
    const voteVal = Number(barBtn.dataset.vote) || 0;
    const myVotesRes = await VotingApi.getMyVotes();
    const currentVote = myVotesRes.userVotes[previewFeature.id] || 0;
    const targetVote = currentVote === voteVal ? 0 : voteVal;
    await vote(previewFeature.id, targetVote);
  }

  /** @type {string[]} */
  let attachedPhotos = [];
  let currentPhotoIndex = 0;

  function renderPhotoCarousel() {
    const wrap = byId('yp-photo-preview-wrap');
    const addBtn = byId('yp-add-photo-btn');
    if (!wrap) return;

    if (attachedPhotos.length === 0) {
      wrap.style.display = 'none';
      wrap.replaceChildren();
      if (addBtn) addBtn.style.display = 'inline-flex';
      return;
    }

    if (addBtn) addBtn.style.display = 'none';
    wrap.style.display = 'flex';

    if (currentPhotoIndex >= attachedPhotos.length) {
      currentPhotoIndex = Math.max(0, attachedPhotos.length - 1);
    }

    const currentImg = attachedPhotos[currentPhotoIndex];
    const isMulti = attachedPhotos.length > 1;

    let html = `
      <img src="${escapeHtml(currentImg)}" class="yp-photo-preview-img" alt="${escapeHtml(tf('attachedPhoto', 'Attached photo'))} ${currentPhotoIndex + 1}" />
    `;

    if (isMulti) {
      html += `
        <button type="button" class="yp-photo-nav-btn yp-photo-nav-prev" id="yp-photo-prev" title="${escapeHtml(tf('previousPhoto', 'Previous photo'))}">❮</button>
        <button type="button" class="yp-photo-nav-btn yp-photo-nav-next" id="yp-photo-next" title="${escapeHtml(tf('nextPhoto', 'Next photo'))}">❯</button>
        <div class="yp-photo-indicator">${currentPhotoIndex + 1} / ${attachedPhotos.length}</div>
      `;
    }

    html += `
      <div class="yp-photo-top-actions">
        <button type="button" class="yp-photo-action-btn" id="yp-photo-add-more" title="${escapeHtml(tf('addPhoto', 'Add Photo'))}">+</button>
        <button type="button" class="yp-photo-action-btn delete" id="yp-photo-delete" title="${escapeHtml(tf('deletePhoto', 'Delete Photo'))}">✕</button>
      </div>
    `;

    _setSafeHTML(wrap, html);
  }

  function resetAttachedPhotos() {
    attachedPhotos = [];
    currentPhotoIndex = 0;
    const fileInput = /** @type {HTMLInputElement|null} */ (byId('yp-feature-photo-input'));
    if (fileInput) fileInput.value = '';
    renderPhotoCarousel();
  }

  function handleAddPhotosClick() {
    const fileInput = /** @type {HTMLInputElement|null} */ (byId('yp-feature-photo-input'));
    if (fileInput) fileInput.click();
  }

  function handlePhotoFilesSelected(/** @type {Event} */ e) {
    const target = /** @type {HTMLInputElement|null} */ (e.target);
    const files = target?.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    let loadedCount = 0;
    const totalFiles = fileList.length;

    fileList.forEach(file => {
      const reader = new FileReader();
      reader.onload = loadEvent => {
        const result = loadEvent.target?.result;
        if (typeof result === 'string') {
          attachedPhotos.push(result);
        }
        loadedCount++;
        if (loadedCount === totalFiles) {
          renderPhotoCarousel();
        }
      };
      reader.readAsDataURL(file);
    });

    if (target) target.value = '';
  }

  function handleDelegatedShowAdd() {
    const formEl = byId('yp-voting-add-form');
    const showBtnEl = byId('yp-show-add-feature');
    if (formEl) formEl.style.display = 'block';
    if (showBtnEl) showBtnEl.style.display = 'none';
    const titleInput = /** @type {HTMLInputElement|null} */ (byId('yp-feature-title'));
    titleInput?.focus();
  }

  function handleDelegatedCancel() {
    const formEl = byId('yp-voting-add-form');
    const showBtnEl = byId('yp-show-add-feature');
    if (formEl) formEl.style.display = 'none';
    if (showBtnEl) showBtnEl.style.display = 'block';
    const titleInput = /** @type {HTMLInputElement|null} */ (byId('yp-feature-title'));
    const descInput = /** @type {HTMLTextAreaElement|null} */ (byId('yp-feature-desc'));
    const statusEl = byId('yp-feature-form-status');
    if (titleInput) titleInput.value = '';
    if (descInput) descInput.value = '';
    if (statusEl) statusEl.textContent = '';
    resetAttachedPhotos();
  }

  function handleDelegatedSubmitFeature() {
    const titleInput = /** @type {HTMLInputElement|null} */ (byId('yp-feature-title'));
    const descInput = /** @type {HTMLTextAreaElement|null} */ (byId('yp-feature-desc'));
    const statusEl = byId('yp-feature-form-status');
    const formEl = byId('yp-voting-add-form');
    const showBtnEl = byId('yp-show-add-feature');
    if (titleInput && descInput) {
      handleFeatureSubmit(titleInput, descInput, statusEl, formEl, showBtnEl);
    }
  }

  /** @param {number} delta Step the photo carousel by `delta`, wrapping. */
  const stepPhotoCarousel_ = delta => {
    if (attachedPhotos.length <= 1) return;
    currentPhotoIndex = (currentPhotoIndex + delta + attachedPhotos.length) % attachedPhotos.length;
    renderPhotoCarousel();
  };

  const deleteCurrentPhoto_ = () => {
    if (attachedPhotos.length === 0) return;
    attachedPhotos.splice(currentPhotoIndex, 1);
    if (currentPhotoIndex >= attachedPhotos.length) {
      currentPhotoIndex = Math.max(0, attachedPhotos.length - 1);
    }
    renderPhotoCarousel();
  };

  /**
   * Map a delegated click target to the action its selector triggers.
   * @param {Element} target
   * @returns {(() => void) | null}
   */
  const resolveDelegatedClickAction_ = target => {
    /** @type {[string, () => void][]} */
    const actions = [
      ['#yp-show-add-feature', handleDelegatedShowAdd],
      ['#yp-cancel-feature', handleDelegatedCancel],
      ['#yp-submit-feature', handleDelegatedSubmitFeature],
      ['#yp-add-photo-btn', handleAddPhotosClick],
      ['#yp-photo-add-more', handleAddPhotosClick],
      ['#yp-photo-prev', () => stepPhotoCarousel_(-1)],
      ['#yp-photo-next', () => stepPhotoCarousel_(1)],
      ['#yp-photo-delete', deleteCurrentPhoto_],
      ['#yp-comments-submit', handleSubmitComment],
    ];
    for (const [selector, action] of actions) {
      if (target.closest(selector)) return action;
    }
    return null;
  };

  function wireDelegatedListeners(ctx = runtimeCtx) {
    // Document-level delegates for the panel, vote bar and settings nav.
    // `delegatedListenersWired` keeps them single while the runtime runs;
    // releasing the runtime resets the guard so a later start wires them again.
    _runtimeListener(
      ctx,
      document,
      'click',
      (/** @type {MouseEvent} */ e) => {
        const target = /** @type {Element|null} */ (e.target);
        if (!target) return;

        const navItem = target.closest('.yp-settings-nav-item');
        if (navItem && navItem.getAttribute('data-section') !== 'voting') {
          closeCommentsModal();
          return;
        }

        const barBtn = /** @type {HTMLElement|null} */ (target.closest('.yp-vote-bar-btn'));
        if (barBtn) {
          handleDelegatedBarClick(barBtn);
          return;
        }
        resolveDelegatedClickAction_(target)?.();
      },
      false
    );

    _runtimeListener(
      ctx,
      document,
      'change',
      (/** @type {Event} */ e) => {
        const target = /** @type {HTMLInputElement|null} */ (e.target);
        if (target && target.id === 'yp-feature-photo-input') {
          handlePhotoFilesSelected(e);
        }
      },
      false
    );
  }

  function ensureCommentsStyles() {
    const ds = window.YouTubePlusDesignSystem;
    const css = ds?.getStyle?.('yp-comments-modal-style');
    if (!css) return;
    (U?.StyleManager || ds?.StyleManager)?.add?.('yp-comments-modal-style', css);
  }

  function initCommentsPanel(ctx = runtimeCtx) {
    let panel = byId('yp-comments-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'yp-comments-panel';
    panel.className = 'yp-comments-panel yp-comments-sidepanel';
    panel.style.display = 'none';

    _setSafeHTML(
      panel,
      `
      <div class="yp-comments-header">
        <div class="yp-comments-title-wrap">
          <span class="yp-comments-heading">${tf('comments', 'Comments')}</span>
          <span id="yp-comments-feature-title" class="yp-comments-feature-title"></span>
        </div>
        <button type="button" id="yp-comments-close" class="yp-comments-close" aria-label="${tf('close', 'Close')}">&times;</button>
      </div>
      <div id="yp-comments-list" class="yp-comments-list"></div>
      <div id="yp-comment-composer" class="yp-comment-composer"></div>`
    );

    document.body.appendChild(panel);
    if (ctx) ctx.own(panel);

    const closeBtn = panel.querySelector('#yp-comments-close');
    if (closeBtn) {
      _runtimeListener(ctx, closeBtn, 'click', () => closeCommentsModal(), false);
    }

    // The panel's reactions share its lifetime: released with the feature
    // context, or for the session when no context owns the panel.
    /** @type {number | null} */
    let resizeFrame = null;
    _runtimeListener(
      ctx,
      window,
      'resize',
      () => {
        if (resizeFrame || !panel?.classList.contains('open')) return;
        // lint:custom:ignore one layout per frame; the frame releases itself
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = null;
          if (panel?.classList.contains('open')) layoutCommentsPanel(panel);
        });
      },
      false
    );

    _runtimeListener(
      ctx,
      document,
      'keydown',
      (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Escape' && panel?.classList.contains('open')) {
          closeCommentsModal();
        }
      },
      false
    );

    _runtimeListener(
      ctx,
      document,
      'youtube-plus-settings-modal-closed',
      () => {
        closeCommentsModal();
      },
      false
    );

    return panel;
  }

  /**
   * Dock the comments panel beside the (shifted) settings shell on wide screens.
   * @param {HTMLElement} panel
   * @param {Element} shell
   * @param {DOMRect} pRect
   */
  const layoutCommentsPanelDocked_ = (panel, shell, pRect) => {
    const pWidth = 380;
    const gap = 14;
    const sWidth = /** @type {HTMLElement} */ (shell).offsetWidth || 740;
    const totalWidth = sWidth + gap + pWidth;
    const leftMargin = Math.max(16, Math.round((window.innerWidth - totalWidth) / 2));
    const unshiftedShellLeft = Math.round((window.innerWidth - sWidth) / 2);
    const shiftX = leftMargin - unshiftedShellLeft;
    /** @type {HTMLElement} */ (shell).style.transform = `translateX(${shiftX}px)`;
    panel.style.left = `${leftMargin + sWidth + gap}px`;
    panel.style.top = `${Math.round(pRect.top)}px`;
    panel.style.width = `${pWidth}px`;
    panel.style.height = `${Math.round(pRect.height)}px`;
  };

  /**
   * Stack the comments panel over the settings content (classic or narrow).
   * @param {HTMLElement} panel
   * @param {Element|null|undefined} shell
   * @param {Element} settingsPanel
   * @param {DOMRect} pRect
   * @param {boolean} isClassic
   */
  const layoutCommentsPanelInline_ = (panel, shell, settingsPanel, pRect, isClassic) => {
    if (shell) /** @type {HTMLElement} */ (shell).style.transform = '';
    const contentEl = isClassic ? $('.yp-settings-content') || settingsPanel : settingsPanel;
    const cRect =
      typeof contentEl.getBoundingClientRect === 'function'
        ? contentEl.getBoundingClientRect()
        : pRect;
    const width = isClassic
      ? Math.min(520, (cRect?.width ?? 400) - 32)
      : Math.min(480, window.innerWidth - 32);
    const cLeft = cRect?.left ?? 0;
    const cWidth = cRect?.width ?? 400;
    const leftPos = Math.round(cLeft + (cWidth - width) / 2);
    panel.style.left = `${Math.max(10, leftPos)}px`;
    panel.style.top = isClassic
      ? `${Math.round((cRect?.top ?? 0) + 16)}px`
      : `${Math.round(pRect.top)}px`;
    panel.style.width = `${Math.max(300, Math.round(width))}px`;
    panel.style.height = isClassic
      ? `${Math.max(300, Math.round((cRect?.height ?? 400) - 32))}px`
      : `${Math.round(pRect.height)}px`;
  };

  function layoutCommentsPanel(/** @type {HTMLElement} */ panel) {
    const settingsPanel = $('.yp-settings-panel');
    if (!settingsPanel) return;
    const shell = $('.yp-settings-shell');
    const pRect = settingsPanel.getBoundingClientRect();
    const isClassic = document.documentElement.getAttribute('data-yp-variant') === 'classic';

    if (!isClassic && shell && window.innerWidth >= 1024) {
      layoutCommentsPanelDocked_(panel, shell, pRect);
    } else {
      layoutCommentsPanelInline_(panel, shell, settingsPanel, pRect, isClassic);
    }
  }

  function closeCommentsModal() {
    const panel = byId('yp-comments-panel');
    if (panel) {
      panel.classList.remove('open');
      panel.style.display = 'none';
    }
    const shell = $('.yp-settings-shell');
    if (shell) {
      shell.style.transform = '';
    }
    currentCommentsFeatureId = '';
    currentCommentSession = null; // Wipe capability from memory
    commentDrafts = [];
    VotingMedia.revokeAll();
  }

  async function openCommentsModal(
    /** @type {string} */ featureId,
    /** @type {string} */ featureTitle = ''
  ) {
    initVoting();
    ensureCommentsStyles();
    const panel = byId('yp-comments-panel');
    if (!panel) return;

    currentCommentsFeatureId = featureId;
    currentCommentSession = null;
    commentDrafts = [];
    VotingMedia.revokeAll();

    const titleEl = byId('yp-comments-feature-title');
    if (titleEl) titleEl.textContent = featureTitle ? ` · ${featureTitle}` : '';

    panel.style.display = 'flex';
    panel.classList.add('open');
    layoutCommentsPanel(panel);

    renderCommentComposer();
    await loadFeatureComments(featureId);
  }

  async function loadFeatureComments(/** @type {string} */ featureId) {
    const listEl = byId('yp-comments-list');
    if (!listEl) return;
    _setSafeHTML(
      listEl,
      `<div class="yp-comments-loading">${escapeHtml(tf('loading', 'Loading comments...'))}</div>`
    );

    const commentsRes = await VotingApi.getComments([featureId]);
    if (commentsRes.error) {
      // A failed comments load shows an explicit unavailable state with Retry,
      // never an empty list that reads as "no comments".
      _setSafeHTML(
        listEl,
        `<div class="yp-comments-error">
          <div class="yp-comments-empty-text">${escapeHtml(tf('votesUnavailable', 'unavailable'))}</div>
          <button type="button" class="yp-comments-retry">${escapeHtml(tf('retry', 'Retry'))}</button>
        </div>`
      );
      const retryBtn = listEl.querySelector('.yp-comments-retry');
      if (retryBtn) {
        _registerListener(retryBtn, 'click', () => {
          loadFeatureComments(featureId);
        });
      }
      return;
    }
    const comments = commentsRes.comments[featureId] || [];

    if (comments.length === 0) {
      _setSafeHTML(
        listEl,
        `<div class="yp-comments-empty">
          <div class="yp-comments-empty-icon">💬</div>
          <div class="yp-comments-empty-text">${escapeHtml(tf('noComments', 'No comments yet. Be the first to comment!'))}</div>
        </div>`
      );
      return;
    }

    const commentIds = comments.map(c => c.id);
    const imagesRes = await VotingApi.getCommentImages(commentIds);
    const imagesMap = imagesRes.images || {};

    let html = '';
    comments.forEach(c => {
      const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString() : '';
      const images = imagesMap[c.id] || [];
      let imagesHtml = '';
      if (images.length > 0) {
        imagesHtml =
          `<div class="yp-comment-images-strip">` +
          images
            .map(
              (img, idx) => `
            <img class="yp-comment-thumb" src="${escapeHtml(img.url)}" data-comment-id="${escapeHtml(c.id)}" data-img-idx="${idx}" alt="" />
          `
            )
            .join('') +
          `</div>`;
      }
      html += `
        <div class="yp-comment-item">
          <div class="yp-comment-body">${escapeHtml(c.comment)}</div>
          ${imagesHtml}
          <div class="yp-comment-footer">${escapeHtml(dateStr)}</div>
        </div>`;
    });

    _setSafeHTML(listEl, html);

    // Wire gallery on comment images
    const thumbEls = listEl.querySelectorAll('.yp-comment-thumb');
    thumbEls.forEach(thumb => {
      _registerListener(thumb, 'click', () => {
        const cId = thumb.getAttribute('data-comment-id');
        const idx = Number(thumb.getAttribute('data-img-idx')) || 0;
        const cImages = imagesMap[cId || ''] || [];
        if (cImages.length > 0) {
          /** @type {Array<{ url: string, caption?: string }>} */
          const galleryItems = cImages.map(img => ({
            url: img.url,
            caption: tf('commentAttachment', 'Comment attachment'),
          }));
          VotingGallery.open({
            items: galleryItems,
            initialIndex: idx,
          });
        }
      });
    });
  }

  function renderCommentComposer() {
    const composerEl = byId('yp-comment-composer');
    if (!composerEl) return;

    if (!isCommunityWritable()) {
      _setSafeHTML(
        composerEl,
        `<div class="yp-voting-readonly-banner">${escapeHtml(tf('commentsReadOnly', 'Comments are currently in read-only mode'))}</div>`
      );
      return;
    }

    _setSafeHTML(
      composerEl,
      `
      <div class="yp-composer-box">
        <div id="yp-attachment-strip" class="yp-attachment-strip" style="display:none;"></div>
        <textarea id="yp-comments-input" class="yp-comment-input" placeholder="${escapeHtml(tf('addCommentPlaceholder', 'Write a comment (max 1000 characters)...'))}" maxlength="1000" rows="1"></textarea>
        <div class="yp-composer-bottom-bar">
          <div class="yp-composer-left-actions">
            <input type="file" id="yp-comment-file-input" accept="image/jpeg,image/png,image/webp" multiple style="display:none;" />
            <button type="button" id="yp-comment-add-photo-btn" class="yp-comment-add-photo-btn" title="${escapeHtml(tf('addPhoto', 'Add Photo'))}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
              <span>${escapeHtml(tf('addPhoto', 'Add Photo'))}</span>
              <span id="yp-attachment-count">(0/4)</span>
            </button>
            <span id="yp-comment-status" class="yp-comment-status"></span>
          </div>
          <div class="yp-composer-right-actions">
            <button type="button" id="yp-comments-submit" class="yp-submit-comment" aria-label="${escapeHtml(tf('submit', 'Submit'))}" title="${escapeHtml(tf('submit', 'Submit'))}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 4l-6.5 6.5 1.42 1.42L11 7.83V20h2V7.83l4.08 4.09 1.42-1.42L12 4z"/></svg>
            </button>
          </div>
        </div>
      </div>`
    );

    wireComposerControls(composerEl);
    updateAttachmentStrip();
  }

  /**
   * Reflect the composer content (typed text or attached drafts) on the
   * submit button's active and aria-disabled state.
   * @param {Element|null} submitBtn
   * @param {HTMLTextAreaElement|null} textarea
   */
  const syncComposerSubmitState = (submitBtn, textarea) => {
    if (!(submitBtn && textarea)) return;
    const hasContent = Boolean(textarea.value.trim() || commentDrafts.length > 0);
    submitBtn.classList.toggle('active', hasContent);
    submitBtn.setAttribute('aria-disabled', hasContent ? 'false' : 'true');
  };

  function wireComposerControls(/** @type {HTMLElement} */ composerEl) {
    const fileInput = /** @type {HTMLInputElement|null} */ (byId('yp-comment-file-input'));
    const addPhotoBtn = byId('yp-comment-add-photo-btn') || byId('yp-add-photo-btn');
    const textarea = /** @type {HTMLTextAreaElement|null} */ (byId('yp-comments-input'));
    const submitBtn = byId('yp-comments-submit');

    const syncSubmitState = () => syncComposerSubmitState(submitBtn, textarea);

    if (textarea) {
      _registerListener(textarea, 'input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(120, textarea.scrollHeight)}px`;
        syncSubmitState();
      });
      _registerListener(textarea, 'keydown', (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSubmitComment();
        }
      });
    }

    if (addPhotoBtn && fileInput) {
      _registerListener(addPhotoBtn, 'click', () => fileInput.click());
      _registerListener(fileInput, 'change', async () => {
        if (fileInput.files) {
          await handleAttachmentFiles(Array.from(fileInput.files));
          fileInput.value = '';
        }
      });
    }

    if (composerEl) {
      _registerListener(composerEl, 'dragover', (/** @type {DragEvent} */ e) => {
        e.preventDefault();
        composerEl.classList.add('dragover');
      });
      _registerListener(composerEl, 'dragleave', () => composerEl.classList.remove('dragover'));
      _registerListener(composerEl, 'drop', async (/** @type {DragEvent} */ e) => {
        e.preventDefault();
        composerEl.classList.remove('dragover');
        if (e.dataTransfer?.files) {
          await handleAttachmentFiles(Array.from(e.dataTransfer.files));
        }
      });
      _registerListener(composerEl, 'paste', async (/** @type {ClipboardEvent} */ e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            const f = items[i].getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length > 0) {
          await handleAttachmentFiles(files);
        }
      });
    }
  }

  async function handleAttachmentFiles(/** @type {File[]} */ files) {
    const statusEl = byId('yp-comment-status');
    const remainingSlots = MAX_ATTACHMENTS - commentDrafts.length;
    if (remainingSlots <= 0) {
      if (statusEl) statusEl.textContent = tf('maxImagesReached', 'Maximum 4 images allowed');
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    for (const file of filesToProcess) {
      try {
        const draft = await VotingMedia.processImage(file);
        commentDrafts.push(draft);
      } catch (err) {
        U?.logSuppressed?.(err, 'Voting');
        if (statusEl) {
          statusEl.textContent =
            /** @type {string} */ (
              /** @type {{ message?: unknown }} */ (/** @type {unknown} */ (err))?.message
            ) || 'Error processing image';
        }
      }
    }
    updateAttachmentStrip();
  }

  function updateAttachmentStrip() {
    const stripEl = byId('yp-attachment-strip');
    const countEl = byId('yp-attachment-count');
    const addPhotoBtn = /** @type {HTMLButtonElement|null} */ (
      byId('yp-comment-add-photo-btn') || byId('yp-add-photo-btn')
    );
    const textarea = /** @type {HTMLTextAreaElement|null} */ (byId('yp-comments-input'));
    const submitBtn = byId('yp-comments-submit');

    if (countEl) countEl.textContent = `(${commentDrafts.length}/${MAX_ATTACHMENTS})`;
    if (addPhotoBtn) addPhotoBtn.disabled = commentDrafts.length >= MAX_ATTACHMENTS;
    syncComposerSubmitState(submitBtn, textarea);
    if (!stripEl) return;

    if (commentDrafts.length === 0) {
      stripEl.style.display = 'none';
      _setSafeHTML(stripEl, '');
      return;
    }

    stripEl.style.display = 'flex';
    let html = '';
    commentDrafts.forEach((draft, idx) => {
      html += `
        <div class="yp-attachment-item ${draft.status === 'error' ? 'error' : ''}">
          <img src="${escapeHtml(draft.previewUrl)}" alt="" />
          <button type="button" class="yp-attachment-remove" data-remove-idx="${idx}" aria-label="${tf('remove', 'Remove')}">&times;</button>
        </div>`;
    });
    _setSafeHTML(stripEl, html);

    const removeBtns = stripEl.querySelectorAll('.yp-attachment-remove');
    removeBtns.forEach(btn => {
      _registerListener(btn, 'click', () => {
        const idx = Number(btn.getAttribute('data-remove-idx'));
        if (Number.isFinite(idx) && commentDrafts[idx]) {
          VotingMedia.revokeUrl(commentDrafts[idx].previewUrl);
          commentDrafts.splice(idx, 1);
          updateAttachmentStrip();
        }
      });
    });
  }

  async function ensureCommentCreated(/** @type {string} */ featureId, /** @type {string} */ text) {
    if (currentCommentSession) return { success: true };
    const commentRes = await VotingApi.submitComment(featureId, text);
    if (!(commentRes.success && commentRes.comment)) {
      return { success: false, error: commentRes.error || 'Failed to submit comment' };
    }
    currentCommentSession = {
      featureId,
      commentId: commentRes.comment.id,
      ownerCapability: commentRes.ownerCapability,
      pendingDrafts: [...commentDrafts],
    };
    return { success: true };
  }

  async function uploadSingleDraft(
    /** @type {VotingUploadSession} */ session,
    /** @type {VotingImageDraft} */ draft
  ) {
    const signRes = await VotingApi.signUpload({
      target: 'comment',
      parentId: session.commentId,
      idempotencyKey: draft.draftId,
      ownerCapability: session.ownerCapability,
      mimeType: draft.mimeType,
    });
    if (!(signRes.success && signRes.data?.signedUrl)) return false;

    const uploadRes = await VotingApi.uploadBinary(
      signRes.data.signedUrl,
      draft.blob,
      draft.mimeType
    );
    if (!uploadRes.success) return false;

    const finalizeRes = await VotingApi.finalizeCommentImage(
      session.commentId,
      session.ownerCapability,
      signRes.data.slotId
    );
    return !finalizeRes.error;
  }

  async function uploadSessionDrafts(/** @type {VotingUploadSession} */ session) {
    while (session.pendingDrafts.length > 0) {
      const draft = session.pendingDrafts[0];
      const ok = await uploadSingleDraft(session, draft);
      if (!ok) {
        draft.status = 'error';
        return false;
      }
      VotingMedia.revokeUrl(draft.previewUrl);
      session.pendingDrafts.shift();
      const draftIdx = commentDrafts.indexOf(draft);
      if (draftIdx !== -1) commentDrafts.splice(draftIdx, 1);
      updateAttachmentStrip();
    }
    return true;
  }

  function handleCommentFailure(/** @type {HTMLElement|null} */ statusEl) {
    if (!statusEl) return;
    _setSafeHTML(
      statusEl,
      `${escapeHtml(tf('partialUploadError', 'Comment posted, but some photos failed.'))} <button type="button" id="yp-retry-upload" class="yp-retry-btn">${escapeHtml(tf('retry', 'Retry'))}</button>`
    );
    const retryBtn = statusEl.querySelector('#yp-retry-upload');
    if (retryBtn) {
      _registerListener(retryBtn, 'click', () => handleSubmitComment());
    }
  }

  function handleCommentSuccess(/** @type {HTMLElement|null} */ statusEl) {
    currentCommentSession = null;
    commentDrafts = [];
    VotingMedia.revokeAll();
    updateAttachmentStrip();
    const textarea = /** @type {HTMLTextAreaElement|null} */ (byId('yp-comments-input'));
    if (textarea) {
      textarea.style.height = 'auto';
    }
    const submitBtn = byId('yp-comments-submit');
    if (submitBtn) {
      submitBtn.classList.remove('active');
      submitBtn.setAttribute('aria-disabled', 'true');
    }
    if (statusEl) statusEl.textContent = tf('commentSuccess', 'Comment posted!');
    setTimeout_(() => {
      if (statusEl && statusEl.textContent === tf('commentSuccess', 'Comment posted!')) {
        statusEl.textContent = '';
      }
    }, 3000);
  }

  let isSubmittingComment = false;
  async function handleSubmitComment() {
    if (isSubmittingComment) return;
    const textarea = /** @type {HTMLTextAreaElement|null} */ (byId('yp-comments-input'));
    const statusEl = byId('yp-comment-status');
    const submitBtn = /** @type {HTMLButtonElement|null} */ (byId('yp-comments-submit'));
    if (!(textarea && submitBtn)) return;

    const text = normalizeUserText(textarea.value);
    if (!(text || currentCommentSession)) {
      if (statusEl) statusEl.textContent = tf('commentRequired', 'Please write a comment');
      return;
    }

    isSubmittingComment = true;
    try {
      submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = tf('submitting', 'Submitting...');

      const creation = await ensureCommentCreated(currentCommentsFeatureId, text);
      if (!creation.success) {
        submitBtn.disabled = false;
        if (statusEl) statusEl.textContent = creation.error || 'Failed to submit comment';
        return;
      }
      textarea.value = '';
      textarea.style.height = 'auto';

      const session = currentCommentSession;
      if (!session) {
        submitBtn.disabled = false;
        return;
      }
      const ok = await uploadSessionDrafts(session);
      submitBtn.disabled = false;

      if (!ok) {
        handleCommentFailure(statusEl);
        loadFeatureComments(session.featureId);
        return;
      }

      handleCommentSuccess(statusEl);
      loadFeatureComments(currentCommentsFeatureId);
    } finally {
      isSubmittingComment = false;
    }
  }

  // ---- PREVIEW RENDERING & BEFORE/AFTER SLIDER ------------------------------
  function buildPreviewMediaHtml(
    /** @type {VotingResolvedImage[]} */ images,
    /** @type {VotingFeatureRow} */ previewFeature
  ) {
    if (images.length === 1) {
      return `
        <div class="yp-preview-single-img">
          <img src="${escapeHtml(images[0].url)}" alt="${escapeHtml(previewFeature.title)}" class="yp-preview-img-click" />
        </div>`;
    }
    if (images.length >= 2) {
      const beforeImg = images[0]?.url || '';
      const afterImg = images[1]?.url || '';
      let stripHtml = '';
      if (images.length > 2) {
        stripHtml =
          `
          <div class="yp-preview-extra-strip">` +
          images
            .slice(2)
            .map(
              (/** @type {VotingResolvedImage} */ img, /** @type {number} */ i) => `
            <img src="${escapeHtml(img.url)}" data-extra-idx="${i + 2}" class="yp-preview-strip-thumb" alt="" />
          `
            )
            .join('') +
          `</div>`;
      }
      return `
        <div class="yp-ba-container" style="width: 100%; height: 260px;">
          <div class="yp-ba-before">
            <img src="${escapeHtml(beforeImg)}" alt="${escapeHtml(tf('votingPreviewBefore', 'Before'))}" draggable="false" />
            <span class="yp-ba-label yp-ba-label-before">${escapeHtml(tf('votingPreviewBefore', 'Before'))}</span>
          </div>
          <div class="yp-ba-after" style="clip-path: inset(0 0 0 50%);">
            <img src="${escapeHtml(afterImg)}" alt="${escapeHtml(tf('votingPreviewAfter', 'After'))}" draggable="false" />
            <span class="yp-ba-label yp-ba-label-after">${escapeHtml(tf('votingPreviewAfter', 'After'))}</span>
          </div>
          <div class="yp-ba-divider" style="left: 50%;" role="slider" aria-label="${escapeHtml(tf('beforeAfterComparison', 'Before and after comparison'))}" aria-valuenow="50" aria-valuemin="2" aria-valuemax="98" tabindex="0">
            <div class="yp-ba-handle"></div>
          </div>
        </div>
        ${stripHtml}`;
    }
    return '';
  }

  function wirePreviewInteractions(
    /** @type {HTMLElement} */ previewContainer,
    /** @type {VotingFeatureRow} */ previewFeature,
    /** @type {VotingResolvedImage[]} */ images
  ) {
    if (images.length > 0) {
      const imgEls = previewContainer.querySelectorAll(
        '.yp-preview-img-click, .yp-preview-strip-thumb'
      );
      imgEls.forEach((/** @type {Element} */ el) => {
        _registerListener(el, 'click', () => {
          const extraIdx = Number(el.getAttribute('data-extra-idx')) || 0;
          /** @type {Array<{ url: string, caption?: string }>} */
          const galleryItems = images.map((/** @type {VotingResolvedImage} */ img) => ({
            url: img.url,
            caption: previewFeature.title,
          }));
          VotingGallery.open({
            items: galleryItems,
            initialIndex: extraIdx,
          });
        });
      });
    }

    const voteBtns = previewContainer.querySelectorAll('.yp-vote-bar-btn, .yp-vote-btn');
    voteBtns.forEach((/** @type {Element} */ btn) => {
      _registerListener(btn, 'click', async () => {
        const voteVal = Number(btn.getAttribute('data-vote')) || 0;
        const currentActive = btn.classList.contains('active');
        const targetVote = currentActive ? 0 : voteVal;
        await vote(previewFeature.id, targetVote);
      });
    });

    const commBtn = previewContainer.querySelector('[data-preview-comments="1"]');
    if (commBtn) {
      _registerListener(commBtn, 'click', () => {
        openCommentsModal(previewFeature.id, previewFeature.title);
      });
    }

    if (images.length >= 2) {
      initSlider();
    }
  }

  function renderPreview(
    /** @type {VotingFeatureRow|null} */ previewFeature,
    /** @type {VotingResolvedImage[]} */ previewImages = [],
    /** @type {VotingVoteTotals} */ previewVotes = { upvotes: 0, downvotes: 0 },
    /** @type {number} */ userVote = 0,
    /** @type {number|null} */ commentCount = 0
  ) {
    const previewContainer = byId('yp-voting-preview');
    if (!previewContainer) return;

    if (!previewFeature) {
      previewContainer.style.display = 'none';
      previewContainer.replaceChildren();
      return;
    }

    previewContainer.style.display = '';
    const images = Array.isArray(previewImages) ? previewImages : [];
    const totalVotes = (previewVotes.upvotes || 0) + (previewVotes.downvotes || 0);
    const upPct =
      totalVotes > 0 ? Math.round(((previewVotes.upvotes || 0) / totalVotes) * 100) : 50;
    const mediaHtml = buildPreviewMediaHtml(images, previewFeature);
    const voteDisabledAttr = isCommunityWritable() ? '' : 'disabled';
    const readOnlyTip = isCommunityWritable() ? '' : ' (read-only)';

    _setSafeHTML(
      previewContainer,
      `
      <div class="yp-preview-card" data-feature-id="${escapeHtml(previewFeature.id)}">
        <div class="yp-preview-header" style="display:none;" aria-hidden="true">
          <div class="yp-preview-title">${escapeHtml(previewFeature.title)}</div>
          <div class="yp-preview-desc">${escapeHtml(previewFeature.description || '')}</div>
        </div>
        ${mediaHtml}
        <div class="yp-vote-bar-section" id="yp-vote-bar-section">
          <div class="yp-vote-bar-row">
            <div class="yp-vote-bar-count" id="yp-vote-bar-count">${totalVotes}</div>
            <div class="yp-vote-bar-buttons">
              <div class="yp-vote-bar-track" id="yp-vote-bar-fill" style="background:linear-gradient(to right, var(--yt-success) ${upPct}%, var(--yt-danger) ${upPct}%);"></div>
              <button class="yp-vote-bar-btn ${userVote === 1 ? 'active' : ''}" id="yp-vote-bar-up" data-vote="1" ${voteDisabledAttr} type="button" aria-label="${tf('like', 'Like')}${readOnlyTip}">
                ${renderSvgIcon('like')}
              </button>
              <button class="yp-vote-bar-btn ${userVote === -1 ? 'active' : ''}" id="yp-vote-bar-down" data-vote="-1" ${voteDisabledAttr} type="button" aria-label="${tf('dislike', 'Dislike')}${readOnlyTip}">
                ${renderSvgIcon('dislike')}
              </button>
            </div>
            <button class="yp-voting-comments-icon" data-preview-comments="1" type="button" aria-label="${tf('comments', 'Comments')} (${commentCount === null ? tf('votesUnavailable', 'unavailable') : commentCount})">
              <span>&#128172;</span> ${commentCount === null ? '–' : commentCount}
            </button>
          </div>
        </div>
      </div>`
    );

    wirePreviewInteractions(previewContainer, previewFeature, images);
  }

  /** Set by initSlider; stops the live preview autoplay loop and drag listeners. */
  /** @type {(() => void) | null} */
  let stopSliderAutoplay_ = null;
  /** Set by initSlider; restarts autoplay on the same preview when the section returns. */
  /** @type {(() => void) | null} */
  let resumeSliderAutoplay_ = null;

  function initSlider() {
    const container = /** @type {HTMLElement} */ ($('.yp-ba-container'));
    if (!container) return;
    if (container.dataset.sliderInit) {
      resumeSliderAutoplay_?.();
      return;
    }
    container.dataset.sliderInit = '1';

    const afterEl = /** @type {HTMLElement} */ (container.querySelector('.yp-ba-after'));
    const divider = /** @type {HTMLElement} */ (container.querySelector('.yp-ba-divider'));
    if (!(afterEl && divider)) return;

    let dragging = false;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let resumeTimer = null;
    /** @type {number|null} */
    let rafId = null;

    function setPosition(/** @type {number} */ pct, manual = false) {
      const clamped = Math.max(2, Math.min(98, pct));
      afterEl.style.clipPath = `inset(0 0 0 ${clamped}%)`;
      if (manual) {
        divider.style.left = `${clamped}%`;
      }
      divider.setAttribute('aria-valuenow', String(Math.round(clamped)));
    }

    function getPct(/** @type {number} */ clientX) {
      const rect = container.getBoundingClientRect();
      if (!rect.width) return 50;
      return ((clientX - rect.left) / rect.width) * 100;
    }

    function stopAutoplay() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = null;
    }

    function pauseAutoplay() {
      divider.classList.remove('autoplay');
      stopAutoplay();
      resumeTimer = setTimeout_(() => {
        // Modal close detaches the preview: nothing left to animate.
        if (!container.isConnected) return;
        divider.classList.add('autoplay');
        startAutoplayRaf();
      }, 3000);
    }

    // Preview frames are not registered with the cleanup manager: the loop
    // cancels itself when the preview detaches or the voting section leaves.
    const scheduleFrame = (/** @type {FrameRequestCallback} */ cb) => {
      // lint:custom:ignore
      return requestAnimationFrame(cb);
    };

    function startAutoplayRaf() {
      if (rafId) return;
      const loop = () => {
        // Modal close / preview re-render detaches the container;
        // stop the self-rescheduling frame loop then.
        if (!(container.isConnected && divider.classList.contains('autoplay'))) {
          rafId = null;
          return;
        }
        const rect = container.getBoundingClientRect();
        const dRect = divider.getBoundingClientRect();
        const pct = rect.width
          ? ((dRect.left + dRect.width / 2 - rect.left) / rect.width) * 100
          : 50;
        setPosition(pct, false);
        rafId = scheduleFrame(loop);
      };
      rafId = scheduleFrame(loop);
    }

    // The window listeners exist only while a drag is in progress.
    /** @type {Array<ReturnType<typeof _registerListener>>} */
    let dragKeys = [];
    const endDrag = () => {
      dragging = false;
      for (const key of dragKeys) _unregisterListener(key);
      dragKeys = [];
    };
    const startDrag = () => {
      if (dragKeys.length) return;
      dragging = true;
      dragKeys = [
        _registerListener(window, 'mousemove', (/** @type {MouseEvent} */ e) => {
          if (dragging) setPosition(getPct(e.clientX), true);
        }),
        _registerListener(window, 'mouseup', () => endDrag()),
        _registerListener(
          window,
          'touchmove',
          (/** @type {TouchEvent} */ e) => {
            if (dragging && e.touches[0]) setPosition(getPct(e.touches[0].clientX), true);
          },
          { passive: true }
        ),
        _registerListener(window, 'touchend', () => endDrag()),
      ];
    };

    _registerListener(container, 'mousedown', (/** @type {MouseEvent} */ e) => {
      startDrag();
      pauseAutoplay();
      setPosition(getPct(e.clientX), true);
      e.preventDefault();
    });

    _registerListener(
      container,
      'touchstart',
      (/** @type {TouchEvent} */ e) => {
        startDrag();
        pauseAutoplay();
        if (e.touches[0]) setPosition(getPct(e.touches[0].clientX), true);
      },
      { passive: true }
    );

    _registerListener(divider, 'keydown', (/** @type {KeyboardEvent} */ e) => {
      pauseAutoplay();
      let current = Number(divider.getAttribute('aria-valuenow')) || 50;
      if (e.key === 'ArrowLeft') {
        current = Math.max(2, current - 2);
        setPosition(current, true);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        current = Math.min(98, current + 2);
        setPosition(current, true);
        e.preventDefault();
      }
    });

    stopSliderAutoplay_ = () => {
      divider.classList.remove('autoplay');
      stopAutoplay();
      endDrag();
    };
    resumeSliderAutoplay_ = () => {
      if (!container.isConnected || divider.classList.contains('autoplay')) return;
      divider.classList.add('autoplay');
      startAutoplayRaf();
    };

    setPosition(50, true);
    divider.classList.add('autoplay');
    startAutoplayRaf();
  }

  // ---- AGGREGATE VOTE BAR ---------------------------------------------------
  function updateVoteBar(
    /** @type {Record<string, VotingVoteTotals>} */ allVotes = {},
    /** @type {Record<string, number>} */ userVotes = {},
    /** @type {string|null} */ previewFeatureId = null,
    /** @type {'ok'|'partial'|'unavailable'} */ countsState = 'ok'
  ) {
    const fillEl = byId('yp-vote-bar-fill');
    const countEl = byId('yp-vote-bar-count');
    const upBtn = byId('yp-vote-bar-up');
    const downBtn = byId('yp-vote-bar-down');
    if (!(fillEl && countEl)) return;

    if (countsState === 'unavailable') {
      fillEl.style.background = 'var(--yt-border, #444)';
      countEl.textContent = tf('votesUnavailable', 'unavailable');
      return;
    }

    const previewVotes = previewFeatureId
      ? allVotes[previewFeatureId] || { upvotes: 0, downvotes: 0 }
      : { upvotes: 0, downvotes: 0 };

    const totalUp = previewVotes.upvotes || 0;
    const totalDown = previewVotes.downvotes || 0;
    const total = totalUp + totalDown;

    let countText = total > 0 ? `${total}` : '0';
    if (countsState === 'partial') countText = `${total}+`;

    const pct = total > 0 ? Math.round((totalUp / total) * 100) : 50;
    fillEl.style.background = `linear-gradient(to right, var(--yt-success) ${pct}%, var(--yt-danger) ${pct}%)`;
    countEl.textContent = countText;

    const previewUserVote = previewFeatureId ? userVotes[previewFeatureId] || 0 : 0;
    if (upBtn) upBtn.classList.toggle('active', previewUserVote === 1);
    if (downBtn) downBtn.classList.toggle('active', previewUserVote === -1);
  }

  // ---- FEATURE LIST RENDERING -----------------------------------------------
  // DB status values (schema.sql CHECK) → candidate i18n keys. Unmapped
  // values fall back to the raw DB string (fail-open label, never a raw key).
  /** @type {Readonly<Record<string, string>>} */
  const FEATURE_STATUS_I18N_KEYS = Object.freeze({
    proposed: 'statusProposed',
    in_progress: 'statusInProgress',
    completed: 'statusCompleted',
  });

  /**
   * @param {VotingFeatureRow} f
   * @param {{ upvotes?: number, downvotes?: number } | null | undefined} voteInfo -
   *   raw aggregate for this feature; null/undefined with a non-'ok' state
   *   means UNKNOWN (rendered as unavailable, never as 0)
   * @param {number} userVote
   * @param {number|null} commentCount - null = aggregate unknown/unavailable
   * @param {VotingResolvedImage[]} images
   * @param {string} countsState
   */
  /**
   * Comment count label and aria text; null means unknown, never 0.
   * @param {number|null} count
   * @returns {{ label: string, aria: string }}
   */
  function commentCountParts(count) {
    const unknown = count === null || count === undefined;
    return {
      label: unknown ? '–' : String(count),
      aria: unknown ? tf('votesUnavailable', 'unavailable') : String(count),
    };
  }

  function renderFeatureItemHtml(
    /** @type {VotingFeatureRow} */ f,
    /** @type {VotingVoteTotals|null} */ voteInfo,
    /** @type {number} */ userVote,
    /** @type {number} */ commentCount,
    /** @type {VotingResolvedImage[]} */ images = [],
    /** @type {string} */ countsState = 'ok'
  ) {
    // 'ok' means the aggregate is authoritative: an absent row is a genuine
    // zero. In 'partial' a missing row is unknown; 'unavailable' means nothing
    // is known. Never fabricate a zero for an unknown state.
    const hasKnownVotes = countsState === 'ok' || (countsState === 'partial' && voteInfo != null);
    const totalVotes = hasKnownVotes
      ? (voteInfo?.upvotes || 0) + (voteInfo?.downvotes || 0)
      : tf('votesUnavailable', 'unavailable');
    const isNum = typeof totalVotes === 'number';
    const upPct =
      isNum && totalVotes > 0 ? Math.round(((voteInfo?.upvotes || 0) / totalVotes) * 100) : 50;
    const voteDisabledAttr = isCommunityWritable() ? '' : 'disabled';
    const statusLabel = String(f.status || 'proposed');
    // Chip text goes through i18n (candidate status keys); the CSS class must
    // stay the raw DB value so styling is locale-independent.
    const statusKey = FEATURE_STATUS_I18N_KEYS[statusLabel];
    const statusText = statusKey ? tf(statusKey, statusLabel) : statusLabel;
    const { label: commentCountLabel, aria: commentCountAria } = commentCountParts(commentCount);

    let imagesHtml = '';
    if (images.length > 0) {
      imagesHtml =
        `<div class="yp-feature-thumbs-strip">` +
        images
          .map(
            (img, i) => `
          <img class="yp-feature-thumb" src="${escapeHtml(img.url)}" data-feature-id="${escapeHtml(f.id)}" data-img-idx="${i}" alt="" />
        `
          )
          .join('') +
        `</div>`;
    }

    return `
      <div class="yp-voting-item" data-feature-id="${escapeHtml(f.id)}">
        <div class="yp-voting-item-content">
          <div class="yp-voting-item-title">${escapeHtml(f.title)}</div>
          <div class="yp-voting-item-desc">${escapeHtml(f.description || '')}</div>
          ${imagesHtml}
          <div class="yp-voting-item-status-row">
            <span class="yp-voting-item-status status-${escapeHtml(statusLabel)}">${escapeHtml(statusText)}</span>
            <button class="yp-voting-comments-icon" data-comments-open="1" type="button" aria-label="${tf('comments', 'Comments')} (${commentCountAria})">
              <span>&#128172;</span> ${commentCountLabel}
            </button>
          </div>
        </div>
        <div class="yp-voting-item-votes">
          <span class="yp-voting-item-status status-${escapeHtml(statusLabel)}">${escapeHtml(statusText)}</span>
          <div class="yp-voting-pill">
            <div class="yp-voting-score">
              <span class="yp-vote-total">${totalVotes}</span>
            </div>
            <div class="yp-voting-buttons">
              <div class="yp-vote-bar-track yp-voting-buttons-track" data-bar-pct="${upPct}"></div>
              <button class="yp-vote-btn ${userVote === 1 ? 'active' : ''}" data-vote="1" ${voteDisabledAttr} type="button" aria-label="${tf('like', 'Like')}">
                ${renderSvgIcon('like')}
              </button>
              <button class="yp-vote-btn ${userVote === -1 ? 'active' : ''}" data-vote="-1" ${voteDisabledAttr} type="button" aria-label="${tf('dislike', 'Dislike')}">
                ${renderSvgIcon('dislike')}
              </button>
            </div>
            <button class="yp-voting-comments-icon" data-comments-open="1" type="button" aria-label="${tf('comments', 'Comments')} (${commentCountAria})">
              <span>&#128172;</span> ${commentCountLabel}
            </button>
          </div>
        </div>
      </div>`;
  }

  /**
   * Paint each vote bar's success/danger split from its data-bar-pct. Applied
   * after insert, on live nodes, because the inline `background` shorthand
   * gradient does not survive the safe-HTML style sanitizer.
   * @param {ParentNode} root
   */
  const applyVoteTrackGradients_ = root => {
    for (const el of root.querySelectorAll('.yp-vote-bar-track[data-bar-pct]')) {
      const pct = Math.max(0, Math.min(100, Number(el.getAttribute('data-bar-pct'))));
      /** @type {HTMLElement} */ (el).style.background =
        `linear-gradient(to right, var(--yt-success) ${pct}%, var(--yt-danger) ${pct}%)`;
    }
  };

  function wireFeatureListInteractions(
    /** @type {HTMLElement} */ listEl,
    /** @type {Record<string, VotingResolvedImage[]>} */ featureImagesMap,
    /** @type {ParentNode | null} */ scope = null
  ) {
    // the scope limits wiring to freshly appended cards so the
    // accumulated list is never re-listened.
    const root = scope || listEl;
    applyVoteTrackGradients_(root);
    const voteBtns = root.querySelectorAll('.yp-vote-btn');
    voteBtns.forEach((/** @type {Element} */ btn) => {
      _registerListener(btn, 'click', async () => {
        const itemEl = btn.closest('.yp-voting-item');
        const fId = itemEl?.getAttribute('data-feature-id');
        if (!fId) return;
        const voteVal = Number(btn.getAttribute('data-vote')) || 0;
        const currentActive = btn.classList.contains('active');
        const targetVote = currentActive ? 0 : voteVal;
        await vote(fId, targetVote);
      });
    });

    const commBtns = root.querySelectorAll('.yp-voting-comments-icon');
    commBtns.forEach((/** @type {Element} */ btn) => {
      _registerListener(btn, 'click', () => {
        const itemEl = btn.closest('.yp-voting-item');
        const fId = itemEl?.getAttribute('data-feature-id');
        const fTitle = itemEl?.querySelector('.yp-voting-item-title')?.textContent || '';
        if (fId) openCommentsModal(fId, fTitle);
      });
    });

    // the continuation control appends the next keyset page.
    const loadMoreBtn = root.querySelector('#yp-voting-load-more');
    if (loadMoreBtn) {
      loadMoreListenerKey = /** @type {symbol|null} */ (
        _registerListener(loadMoreBtn, 'click', () => {
          if (featureListLoadingMore) return;
          featureListLoadingMore = true;
          loadFeaturesPage(true);
        })
      );
    }

    const fImgEls = root.querySelectorAll('.yp-feature-thumb');
    fImgEls.forEach((/** @type {Element} */ imgEl) => {
      _registerListener(imgEl, 'click', () => {
        const fId = imgEl.getAttribute('data-feature-id');
        const idx = Number(imgEl.getAttribute('data-img-idx')) || 0;
        const fImages = featureImagesMap[fId || ''] || [];
        if (fImages.length > 0) {
          /** @type {Array<{ url: string, caption?: string }>} */
          const galleryItems = fImages.map((/** @type {VotingResolvedImage} */ img) => ({
            url: img.url,
            caption: tf('featureAttachment', 'Feature attachment'),
          }));
          VotingGallery.open({
            items: galleryItems,
            initialIndex: idx,
          });
        }
      });
    });
  }

  function renderFeatureList(
    /** @type {HTMLElement} */ listEl,
    /** @type {VotingFeatureRow[]} */ items,
    /** @type {Record<string, VotingVoteTotals>} */ votes,
    /** @type {Record<string, number>} */ userVotes,
    /** @type {Record<string, number>} */ commentCounts,
    /** @type {Record<string, VotingResolvedImage[]>} */ featureImagesMap,
    /** @type {string} */ countsState,
    /** @type {string} */ commentsState
  ) {
    if (items.length === 0) {
      _setSafeHTML(
        listEl,
        `<div class="yp-voting-empty">${escapeHtml(tf('noFeaturesYet', 'No feature requests found.'))}</div>`
      );
      return;
    }

    const cardsHtml = featureCardsHtml(
      items,
      votes,
      userVotes,
      commentCounts,
      featureImagesMap,
      countsState,
      commentsState
    );

    let html = cardsHtml;
    if (featureListHasMore) {
      html += loadMoreRowHtml_();
    }
    _setSafeHTML(listEl, html);
    wireFeatureListInteractions(listEl, featureImagesMap);
  }

  /** Card markup for a subset of items (shared by full render and append). */
  function featureCardsHtml(
    /** @type {VotingFeatureRow[]} */ items,
    /** @type {Record<string, VotingVoteTotals>} */ votes,
    /** @type {Record<string, number>} */ userVotes,
    /** @type {Record<string, number>} */ commentCounts,
    /** @type {Record<string, VotingResolvedImage[]>} */ featureImagesMap,
    /** @type {string} */ countsState,
    /** @type {string} */ commentsState
  ) {
    let html = '';
    items.forEach((/** @type {VotingFeatureRow} */ f) => {
      // A missing aggregate row is unknown when the aggregate itself is
      // partial/unavailable, never a fabricated zero.
      const uVote = userVotes[f.id] || 0;
      const cCount =
        commentsState === 'ok' ? commentCounts[f.id] || 0 : (commentCounts[f.id] ?? null);
      const fImages = featureImagesMap[f.id] || [];
      html += renderFeatureItemHtml(f, votes[f.id], uVote, cCount, fImages, countsState);
    });
    return html;
  }

  // ---- LOAD FEATURES WITH CANCELLATION ---------------------------------------
  // Pagination state: the loaded list accumulates page by page;
  // a full reload always restarts from page 1.
  /** @type {{ createdAt: string, id: string } | null} */
  let featureListCursor = null;
  let featureListHasMore = false;
  /** @type {VotingFeatureRow[]} */
  let featureListItems = [];
  let featureListLoadingMore = false;

  // the per-ID aggregate caches. A continuation page requests
  // details for the NEW IDs only, so the cost of loading the next page is
  // bounded by the page size, never by the whole loaded history.
  /** @type {Record<string, VotingVoteTotals>} */
  let featureVotesCache = {};
  /** @type {Record<string, number>} */
  let featureUserVotesCache = {};
  /** @type {Record<string, number>} */
  let featureCommentCountsCache = {};
  /** @type {Record<string, VotingResolvedImage[]>} */
  let featureImagesCache = {};
  /** @type {'ok'|'partial'|'unavailable'} */
  let featureVotesState = 'ok';
  /** @type {'ok'|'partial'|'unavailable'} */
  let featureCommentsState = 'ok';
  /** @type {symbol|null} cleanup key of the current load-more listener */
  let loadMoreListenerKey = null;
  function resetFeatureCaches_() {
    featureVotesCache = {};
    featureUserVotesCache = {};
    featureCommentCountsCache = {};
    featureImagesCache = {};
    featureVotesState = 'ok';
    featureCommentsState = 'ok';
  }

  /**
   * Honest state merge: a known-good page never upgrades a partial one, and
   * an unavailable page degrades the whole aggregate view.
   * @param {'ok'|'partial'|'unavailable'} a
   * @param {'ok'|'partial'|'unavailable'} b
   * @returns {'ok'|'partial'|'unavailable'}
   */
  function mergeAggregateState_(a, b) {
    if (a === 'ok') return b;
    if (b === 'ok') return a;
    return a === 'unavailable' || b === 'unavailable' ? 'unavailable' : 'partial';
  }

  /**
   * Merge one page's verified aggregate DTOs into the per-ID caches.
   * userVotes is the caller's full current state (replace), the rest are
   * per-ID accumulations (assign).
   */
  function mergeFeatureBatchResults_(
    /** @type {VotingVoteCounts} */ votesRes,
    /** @type {VotingMyVotes} */ myVotesRes,
    /** @type {VotingCommentCounts} */ countsRes,
    /** @type {VotingFeatureImages} */ imagesRes
  ) {
    const incomingVotes = votesRes.votes || {};
    const incomingCounts = countsRes.counts || {};
    Object.assign(featureVotesCache, incomingVotes);
    featureUserVotesCache = { ...(myVotesRes.userVotes || {}) };
    Object.assign(featureCommentCountsCache, incomingCounts);
    Object.assign(featureImagesCache, imagesRes.images || {});
    const aggregateState = (
      /** @type {{ error: string | null }} */ res,
      /** @type {Record<string, unknown>} */ data
    ) => (res.error ? (Object.keys(data).length > 0 ? 'partial' : 'unavailable') : 'ok');
    featureVotesState = mergeAggregateState_(
      featureVotesState,
      /** @type {'ok'|'partial'|'unavailable'} */ (aggregateState(votesRes, incomingVotes))
    );
    featureCommentsState = mergeAggregateState_(
      featureCommentsState,
      /** @type {'ok'|'partial'|'unavailable'} */ (aggregateState(countsRes, incomingCounts))
    );
  }

  /**
   * Append a page: build only the new cards, wire only them, and insert before
   * the continuation control. The accumulated DOM and its listeners are never
   * rebuilt, and the replaced load-more control's cleanup registration is
   * released.
   * @param {HTMLElement} listEl
   * @param {VotingFeatureRow[]} newItems
   */
  function appendFeatureListPage_(
    /** @type {HTMLElement} */ listEl,
    /** @type {VotingFeatureRow[]} */ newItems
  ) {
    const previousLoadMoreRow = listEl.querySelector('.yp-voting-load-more-row');
    if (previousLoadMoreRow) {
      if (loadMoreListenerKey) {
        window.YouTubePlusCleanupManager?.unregisterListener?.(loadMoreListenerKey);
        U?.cleanupManager?.unregisterListener?.(loadMoreListenerKey);
        loadMoreListenerKey = null;
      }
      previousLoadMoreRow.remove();
    }
    if (newItems.length === 0) {
      renderLoadMoreControl_(listEl);
      return;
    }
    const cardsHtml =
      featureCardsHtml(
        newItems,
        featureVotesCache,
        featureUserVotesCache,
        featureCommentCountsCache,
        featureImagesCache,
        featureVotesState,
        featureCommentsState
      ) + (featureListHasMore ? loadMoreRowHtml_() : '');
    const frag = createSafeFragment_(cardsHtml);
    // Wire only the new cards; the accumulated list is never re-listened.
    wireFeatureListInteractions(listEl, featureImagesCache, frag);
    const reference = listEl.querySelector('.yp-voting-load-more-row');
    if (reference) {
      listEl.insertBefore(frag, reference);
    } else {
      listEl.appendChild(frag);
    }
  }

  /** Load-more continuation row (shared by full render and append). */
  function loadMoreRowHtml_() {
    return (
      `<div class="yp-voting-load-more-row">` +
      `<button type="button" id="yp-voting-load-more" class="yp-voting-load-more">${escapeHtml(tf('loadMore', 'Load more'))}</button>` +
      `</div>`
    );
  }

  function renderLoadMoreControl_(/** @type {HTMLElement} */ listEl) {
    listEl.querySelector('.yp-voting-load-more-row')?.remove();
    const frag = createSafeFragment_(loadMoreRowHtml_());
    wireFeatureListInteractions(listEl, featureImagesCache, frag);
    listEl.appendChild(frag);
  }

  /** Sanitized fragment creation through the SafeDOM facade. */
  function createSafeFragment_(/** @type {string} */ html) {
    if (window.YouTubePlusSafeDOM?.createFragment) {
      return window.YouTubePlusSafeDOM.createFragment(html);
    }
    // Sanitize into a detached container first, then move the children into
    // a fragment, avoiding innerHTML assignment. Use a plain div: a <template>
    // container would route children into .content instead.
    const container = document.createElement('div');
    if (U?.setSafeHTML) {
      U.setSafeHTML(container, html);
    } else if (window.YouTubePlusSafeDOM?.renderTemplateClone) {
      window.YouTubePlusSafeDOM.renderTemplateClone(container, html);
    }
    const frag = document.createDocumentFragment();
    while (container.firstChild) frag.appendChild(container.firstChild);
    return frag;
  }

  function updatePreviewFromData(
    /** @type {VotingFeatureRow|null} */ previewFeature,
    /** @type {Record<string, VotingResolvedImage[]>} */ featureImagesMap,
    /** @type {Record<string, VotingVoteTotals>} */ votes,
    /** @type {Record<string, number>} */ userVotes,
    /** @type {Record<string, number>} */ commentCounts,
    /** @type {'ok'|'partial'|'unavailable'} */ commentsState = 'ok'
  ) {
    if (!previewFeature) {
      renderPreview(null);
      return;
    }
    const pImages = featureImagesMap[previewFeature.id] || [];
    const pVotes = votes[previewFeature.id] || { upvotes: 0, downvotes: 0 };
    const pUserVote = userVotes[previewFeature.id] || 0;
    const pCommentCount =
      commentsState === 'ok'
        ? commentCounts[previewFeature.id] || 0
        : (commentCounts[previewFeature.id] ?? null);
    renderPreview(previewFeature, pImages, pVotes, pUserVote, pCommentCount);
  }

  async function fetchFeatureBatchDetails(
    /** @type {VotingFeatureRow[]} */ items,
    /** @type {VotingFeatureRow|null} */ previewFeature,
    /** @type {AbortSignal|undefined} */ signal = undefined
  ) {
    const featureIds = items.map(f => String(f.id));
    if (previewFeature?.id) {
      featureIds.push(previewFeature.id);
    }
    return Promise.all([
      VotingApi.getVoteCounts(featureIds, signal),
      VotingApi.getMyVotes(signal),
      VotingApi.getCommentCounts(featureIds, signal),
      VotingApi.getFeatureImages(featureIds, signal),
    ]);
  }

  async function loadFeatures() {
    // A full reload (initial load, vote/submit refresh) restarts pagination
    // and drops the accumulated aggregate caches.
    featureListCursor = null;
    featureListHasMore = false;
    featureListItems = [];
    featureListLoadingMore = false;
    resetFeatureCaches_();
    await loadFeaturesPage(false);
  }

  /**
   * A failed first page is a full error state; a failed continuation keeps
   * the loaded pages and offers Retry on the control itself.
   */
  function handleListPageError_(
    /** @type {HTMLElement} */ listEl,
    /** @type {boolean} */ append,
    /** @type {VotingPreviewFeature} */ previewRes
  ) {
    if (append) {
      renderLoadMoreRetry(listEl);
    } else {
      renderListErrorState(listEl, previewRes.feature?.id || null);
    }
  }

  function handlePageFailure_(
    /** @type {HTMLElement} */ listEl,
    /** @type {boolean} */ append,
    /** @type {number} */ myGeneration
  ) {
    if (myGeneration !== activeLoadGeneration) return;
    if (append) {
      renderLoadMoreRetry(listEl);
    } else {
      renderListErrorState(listEl, null);
    }
  }

  /**
   * Refresh the preview block and the vote bar from the accumulated caches.
   * @param {VotingFeatureRow | null} previewFeature
   */
  const refreshVotingGlobalSurfaces_ = previewFeature => {
    updatePreviewFromData(
      previewFeature,
      featureImagesCache,
      featureVotesCache,
      featureUserVotesCache,
      featureCommentCountsCache,
      featureCommentsState
    );
    updateVoteBar(
      featureVotesCache,
      featureUserVotesCache,
      previewFeature?.id || null,
      featureVotesState
    );
  };

  /**
   * Render the loaded page: in append mode only the new cards are wired;
   * a full page re-renders the list. The preview and vote bar are refreshed
   * from the accumulated caches in both cases.
   * @param {HTMLElement} listEl
   * @param {boolean} append
   * @param {VotingFeatureRow[]} pageItems
   * @param {VotingFeatureRow | null} previewFeature
   */
  const renderLoadedFeatures_ = (listEl, append, pageItems, previewFeature) => {
    if (append) {
      appendFeatureListPage_(listEl, pageItems);
      refreshVotingGlobalSurfaces_(previewFeature);
      return;
    }
    refreshVotingGlobalSurfaces_(previewFeature);
    renderFeatureList(
      listEl,
      featureListItems,
      featureVotesCache,
      featureUserVotesCache,
      featureCommentCountsCache,
      featureImagesCache,
      featureVotesState,
      featureCommentsState
    );
  };

  async function loadFeaturesPage(/** @type {boolean} */ append) {
    const listEl = byId('yp-voting-list');
    if (!listEl) return;

    const myGeneration = ++activeLoadGeneration;

    activeLoadAbort?.abort();
    const abortController = new AbortController();
    activeLoadAbort = abortController;
    const deadlineTimer = setTimeout_(() => abortController.abort(), LOAD_DEADLINE_MS);
    const signal = abortController.signal;

    try {
      const [reqResult, previewRes] = await Promise.all([
        VotingApi.getFeatureRequests({
          cursor: append ? featureListCursor : null,
          signal,
        }),
        VotingApi.getPreviewFeature(signal),
      ]);

      if (myGeneration !== activeLoadGeneration) return;

      if (reqResult.error) {
        handleListPageError_(listEl, append, previewRes);
        return;
      }

      // A preview error is honest on the DTO ({feature, error}) and never
      // blocks the list; the block hides instead of claiming that no preview
      // exists.
      const previewFeature = previewRes.error ? null : previewRes.feature;
      if (previewRes.error) {
        U?.logSuppressed?.(new Error(previewRes.error), 'Voting');
      }

      const pageItems = (reqResult.rows || [])
        .filter(f => f.feature_type !== 'preview')
        .map(f => /** @type {VotingFeatureRow} */ (f));
      featureListItems = append ? featureListItems.concat(pageItems) : pageItems;
      featureListHasMore = reqResult.hasMore === true;
      featureListCursor = reqResult.nextCursor;

      // the continuation requests details for the NEW page only;
      // aggregates accumulate in per-ID caches, so the cost of the next page
      // is bounded by its size, not by the whole loaded history.
      const itemsToFetch = append ? pageItems : featureListItems;
      const [votesRes, myVotesRes, countsRes, imagesRes] = await fetchFeatureBatchDetails(
        itemsToFetch,
        previewFeature,
        signal
      );

      if (myGeneration !== activeLoadGeneration) return;

      mergeFeatureBatchResults_(votesRes, myVotesRes, countsRes, imagesRes);

      renderLoadedFeatures_(listEl, append, pageItems, previewFeature);
    } catch (_e) {
      U?.logSuppressed?.(_e, 'Voting');
      handlePageFailure_(listEl, append, myGeneration);
    } finally {
      clearTimeout_(deadlineTimer);
      if (append) featureListLoadingMore = false;
    }
  }

  /**
   *the continuation control. On failure it offers Retry
   * without wiping the pages the user already has.
   * @param {HTMLElement} listEl
   */
  function renderLoadMoreRetry(listEl) {
    listEl.querySelector('.yp-voting-load-more-row')?.remove();
    const row = document.createElement('div');
    row.className = 'yp-voting-load-more-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'yp-voting-load-more';
    btn.className = 'yp-voting-load-more';
    btn.textContent = tf('retry', 'Retry');
    _registerListener(btn, 'click', () => {
      if (featureListLoadingMore) return;
      featureListLoadingMore = true;
      loadFeaturesPage(true);
    });
    row.appendChild(btn);
    listEl.appendChild(row);
  }

  function renderListErrorState(
    /** @type {HTMLElement} */ listEl,
    /** @type {string|null} */ previewFeatureId
  ) {
    // A contract mismatch (PGRST202 / Edge 404) is not transient: Retry cannot
    // help, so the panel shows an explicit unavailability state without a
    // retry control.
    if (isCommunityServerUnavailable()) {
      _setSafeHTML(
        listEl,
        `
      <div class="yp-voting-error">
        <div class="yp-voting-error-text">${escapeHtml(tf('communityUnavailable', 'Community temporarily unavailable'))}</div>
      </div>`
      );
      updateVoteBar({}, {}, previewFeatureId, 'unavailable');
      return;
    }
    _setSafeHTML(
      listEl,
      `
      <div class="yp-voting-error">
        <div class="yp-voting-error-text">${escapeHtml(tf('votingLoadError', "Couldn't load feature requests"))}</div>
        <button class="yp-voting-retry" type="button">${escapeHtml(tf('retry', 'Retry'))}</button>
      </div>`
    );
    const retryBtn = listEl.querySelector('.yp-voting-retry');
    if (retryBtn) {
      _registerListener(retryBtn, 'click', () => {
        loadFeatures();
      });
    }
    updateVoteBar({}, {}, previewFeatureId, 'unavailable');
  }

  /** Update ONE card in place after a vote. Returns the fresh
   * aggregate, or null when the card is not in the loaded list (preview-only
   * vote). The current user vote comes from featureUserVotesCache.
   * @param {string} featureId
   * @param {number} targetVote 0 = removed, ±1 = added/updated
   * @param {{ upvotes?: number, downvotes?: number }} [voteInfo] fresh
   *   aggregate returned by cast_vote; when absent the cache aggregate is
   *   adjusted locally.
   * @returns {{ upvotes: number, downvotes: number } | null}
   */
  function applyLocalVoteUpdate_(featureId, targetVote, voteInfo) {
    const prev = featureUserVotesCache[featureId] || 0;
    // Only ±1 transitions change the public aggregates; a re-vote with the
    // same target changes nothing. When the server returns a fresh aggregate
    // it wins; otherwise the cache aggregate is adjusted locally.
    const votes = { ...(voteInfo || featureVotesCache[featureId] || {}) };
    if (targetVote !== prev) {
      if (prev === 1) votes.upvotes = Math.max(0, (votes.upvotes || 0) - 1);
      if (prev === -1) votes.downvotes = Math.max(0, (votes.downvotes || 0) - 1);
      if (targetVote === 1) votes.upvotes = (votes.upvotes || 0) + 1;
      if (targetVote === -1) votes.downvotes = (votes.downvotes || 0) + 1;
    }
    featureUserVotesCache = { ...featureUserVotesCache, [featureId]: targetVote };
    featureVotesCache[featureId] = { upvotes: votes.upvotes || 0, downvotes: votes.downvotes || 0 };
    return featureVotesCache[featureId];
  }

  /**
   * Swap one rendered card for a freshly built card, using the SafeDOM
   * fragment path when available (same sanitizer contract as
   * createSafeFragment_, never raw innerHTML).
   * @param {string} featureId
   * @param {Element} itemEl
   * @param {string} cardHtml
   */
  const replaceCardHtml_ = (featureId, itemEl, cardHtml) => {
    const selector = `.yp-voting-item[data-feature-id="${featureId}"]`;
    if (window.YouTubePlusSafeDOM?.createFragment) {
      const fresh = window.YouTubePlusSafeDOM.createFragment(cardHtml).querySelector(selector);
      if (fresh) itemEl.replaceWith(fresh);
      return;
    }
    if (U?.setSafeHTML) {
      const tpl = document.createElement('template');
      U.setSafeHTML(tpl, cardHtml);
      const fresh = tpl.content.querySelector(selector);
      if (fresh) itemEl.replaceWith(fresh);
      return;
    }
    createSafeFragment_(cardHtml);
  };

  /** Re-render one card plus the preview vote bar in place from the caches,
   * without a full-list reload.
   * @param {string} featureId
   */
  function refreshOneCard_(featureId) {
    const listEl = byId('yp-voting-list');
    if (listEl) {
      const itemEl = listEl.querySelector(`.yp-voting-item[data-feature-id="${featureId}"]`);
      const f = featureListItems.find(item => item.id === featureId);
      if (itemEl && f) {
        const countsState = featureCommentsState;
        const uVote = featureUserVotesCache[featureId] || 0;
        const cCount =
          countsState === 'ok'
            ? featureCommentCountsCache[featureId] || 0
            : (featureCommentCountsCache[featureId] ?? null);
        const fImages = featureImagesCache[featureId] || [];
        const cardHtml = renderFeatureItemHtml(
          f,
          featureVotesCache[featureId],
          uVote,
          cCount,
          fImages,
          featureVotesState
        );
        replaceCardHtml_(featureId, itemEl, cardHtml);
        const freshItem = listEl.querySelector(`.yp-voting-item[data-feature-id="${featureId}"]`);
        if (freshItem) wireFeatureListInteractions(listEl, featureImagesCache, freshItem);
      }
    }
    // The preview vote bar reflects the same caches.
    updateVoteBar(featureVotesCache, featureUserVotesCache, featureId, featureVotesState);
  }

  async function vote(/** @type {string} */ featureId, /** @type {number} */ voteType) {
    if (voteInFlight) return { success: false, error: 'Vote already in progress' };
    voteInFlight = true;
    try {
      const res = await VotingApi.castVote(featureId, voteType);
      if (res.success) {
        // update ONE card + the bar in place from the response
        // and caches. A full list reload happens only on Retry/panel open.
        const serverAction = res.action;
        const target = serverAction === 'removed' || serverAction === 'none' ? 0 : voteType;
        applyLocalVoteUpdate_(featureId, target);
        refreshOneCard_(featureId);
      }
      return res;
    } finally {
      voteInFlight = false;
    }
  }

  async function submitFeature(/** @type {string} */ title, /** @type {string} */ description) {
    const res = await VotingApi.submitFeature(title, description);
    if (res.success) {
      loadFeatures();
    }
    return res;
  }

  // ---- VOTING SETTINGS TAB UI BUILDER ---------------------------------------
  function createVotingUI(/** @type {HTMLElement} */ container) {
    if (!container) return;
    const isWritable = isCommunityWritable();

    let readonlyBannerHtml = '';
    if (!isWritable) {
      readonlyBannerHtml = `
        <div id="yp-voting-readonly-banner" class="yp-voting-readonly-banner">
          ${escapeHtml(tf('votingReadOnly', 'Community feature voting is currently in read-only mode.'))}
        </div>`;
    }

    const hasExistingPreview = !!document.getElementById('yp-voting-preview');
    const previewPlaceholder = hasExistingPreview
      ? ''
      : '<div class="yp-voting-preview" id="yp-voting-preview" style="display:none;"></div>';

    _setSafeHTML(
      container,
      `
      <div class="yp-voting">
        ${readonlyBannerHtml}
        ${previewPlaceholder}
        <div class="yp-voting-header">
          <div class="yp-voting-header-title">${escapeHtml(tf('featureRequests', 'Feature Requests'))}</div>
          <button id="yp-show-add-feature" class="yp-voting-add-btn" type="button" ${isWritable ? '' : 'disabled'}>
            + ${escapeHtml(tf('addFeature', 'Add Feature'))}
          </button>
        </div>
        <div id="yp-voting-add-form" class="yp-voting-add-form" style="display: none;">
          <input type="file" id="yp-feature-photo-input" accept="image/*" multiple style="display: none;" />
          <div id="yp-photo-preview-wrap" class="yp-photo-preview-wrap" style="display: none;"></div>
          <div class="yp-feature-title-row">
            <button type="button" id="yp-add-photo-btn" class="yp-add-photo-btn" title="${escapeHtml(tf('addPhoto', 'Add Photo'))}">
              <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </button>
            <input type="text" id="yp-feature-title" class="yp-input" placeholder="${escapeHtml(tf('featureTitlePlaceholder', 'Feature title (max 200 chars)...'))}" maxlength="200" />
          </div>
          <textarea id="yp-feature-desc" class="yp-textarea" placeholder="${escapeHtml(tf('featureDescPlaceholder', 'Feature description (optional, max 2000 chars)...'))}" maxlength="2000"></textarea>
          <div class="yp-form-actions yp-voting-form-actions">
            <span id="yp-feature-form-status" class="yp-form-status"></span>
            <button id="yp-cancel-feature" class="yp-voting-cancel" type="button">${escapeHtml(tf('cancel', 'Cancel'))}</button>
            <button id="yp-submit-feature" class="yp-voting-submit" type="button">${escapeHtml(tf('submit', 'Submit'))}</button>
          </div>
        </div>
        <div id="yp-voting-list" class="yp-voting-list"></div>
      </div>`
    );
    resetAttachedPhotos();
  }

  let featureSubmitInFlight = false;
  async function handleFeatureSubmit(
    /** @type {HTMLInputElement|null} */ titleInput,
    /** @type {HTMLTextAreaElement|null} */ descInput,
    /** @type {HTMLElement|null} */ statusEl,
    /** @type {HTMLElement|null} */ form,
    /** @type {HTMLElement|null} */ showBtn
  ) {
    if (!(titleInput && descInput)) return;
    // Single-flight: ONE user action must issue at most ONE submit_feature RPC.
    if (featureSubmitInFlight) return;
    const title = normalizeUserText(titleInput.value);
    if (!title) {
      if (statusEl) statusEl.textContent = tf('titleRequired', 'Title is required');
      return;
    }
    const desc = normalizeUserText(descInput.value);

    const submitBtn = /** @type {HTMLButtonElement | null} */ (
      document.getElementById('yp-submit-feature')
    );
    const setStatus = (/** @type {string} */ msg) => {
      if (statusEl) statusEl.textContent = msg;
    };

    featureSubmitInFlight = true;
    if (submitBtn) submitBtn.disabled = true;
    setStatus(tf('submitting', 'Submitting...'));
    try {
      const res = await submitFeature(title, desc);
      if (!res.success) {
        setStatus(res.error || 'Failed to submit feature');
        return;
      }

      if (form) form.style.display = 'none';
      if (showBtn) showBtn.style.display = '';
      titleInput.value = '';
      descInput.value = '';
      setStatus('');
      resetAttachedPhotos();
    } finally {
      featureSubmitInFlight = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function ensurePreviewFeature(
    /** @type {VotingFeatureRow[]=} */ _features,
    /** @type {AbortSignal=} */ signal
  ) {
    // Public-surface wrapper: preview is looked up by feature_type = 'preview',
    // never by title.
    return VotingApi.getPreviewFeature(signal);
  }

  function getFacadeVoting() {
    return VotingSystem;
  }

  // ---- PUBLIC FACADE --------------------------------------------------------
  const VotingSystem = {
    init: initVoting,
    createUI: createVotingUI,
    loadFeatures,
    getFeatures: async () => {
      const res = await VotingApi.getFeatureRequests();
      return res.rows;
    },
    getAllVotes: async (/** @type {string[]} */ featureIds = []) => {
      const res = await VotingApi.getVoteCounts(featureIds);
      return res.votes;
    },
    getCommentsByFeatureIds: async (/** @type {string[]} */ featureIds = []) => {
      const res = await VotingApi.getComments(featureIds);
      return res.comments;
    },
    vote,
    submitFeature,
    initSlider,
    updateVoteBar,
    openCommentsModal,
    closeCommentsModal,
    ensurePreviewFeature,
    getFacadeVoting,
    addCommentDraft: (/** @type {VotingImageDraft} */ draft) => {
      commentDrafts.push(draft);
      updateAttachmentStrip();
    },
    normalizeVoteType,
    renderSvgIcon,
    isCommunityWritable,
    isCommunityWriteEnabled,
    VotingApi,
    VotingMedia,
    VotingGallery,
    getAttachedPhotos: () => [...attachedPhotos],
    addPhoto: (/** @type {string} */ url) => {
      attachedPhotos.push(url);
      renderPhotoCarousel();
    },
    resetAttachedPhotos,
  };

  // The YouTubePlus facade root is created by basic.js (declared dependency,
  // guaranteed earlier in build.order.json); voting only extends it.
  window.YouTubePlus.Voting = VotingSystem;
  window.YouTubePlus.VotingMedia = VotingMedia;
  window.YouTubePlus.VotingGallery = VotingGallery;
  window.YouTubePlusVoting = VotingSystem;

  // Route-bound runtime: the comments panel and gallery run on watch, shorts
  // and channel pages. The settings modal drives its own section lifecycle, so
  // the runtime stays off while that modal is open.
  const votingRuntimeFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'voting.runtime',
    routes: ['watch', 'shorts', 'channel'],
    when: () => !isSettingsModalOpen(),
    start(ctx) {
      initVoting(true, ctx);
    },
    stop: stopVotingRuntime,
  });
  votingRuntimeFeature?.sync();

  if (U?.onSectionActive) {
    U.onSectionActive(
      'voting',
      () => {
        try {
          initVoting(true);
        } catch (_e) {
          U?.logSuppressed?.(_e, 'Voting');
        }
        try {
          const votingContainer = /** @type {HTMLElement|null} */ (byId('yp-voting-container'));
          if (votingContainer) {
            VotingSystem.createUI(votingContainer);
            VotingSystem.loadFeatures();
          }
        } catch (_e) {
          U?.logSuppressed?.(_e, 'Voting');
        }
        U.safeRequestAnimationFrame?.(() => {
          VotingSystem.initSlider();
        });
      },
      () => {
        stopSliderAutoplay_?.();
      }
    );
  }

  _registerListener(window, 'yt-navigate-start', () => {
    closeCommentsModal();
  });
})();
