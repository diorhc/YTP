/**
 * safe-dom.js - canonical safe HTML / HTML insertion module.
 *
 * Owns:
 *   - Trusted Types policy + createHTML/createScriptURL/createScript facade
 *   - createHTML / createSafeHTML (TrustedHTML wrapping + sanitization)
 *   - sanitizeHTML (DOM allowlist + URL filter)
 *   - setHTML / renderTemplateClone (canonical insertion paths)
 *   - createFragment (contextual fragment helper)
 *   - setText (text-only safe setter; used by YouTubeSecurityUtils compat)
 *   - isSafeUrl (URL scheme allowlist used by sanitizeHTML)
 *   - escapeHTML (text-to-HTML escape)
 *   - sanitizeAttribute / setAttributeSafe (attribute-level guards)
 *
 * Back-compat only (do not use in new code):
 *   - isValidVideoId / sanitizeText (used by YouTubeSecurityUtils shim)
 *   - YouTubeSecurityUtils.escapeHtml (alias of escapeHTML)
 *
 * Removed from the YouTubeSecurityUtils shim as no src caller referenced
 * them; the canonical YouTubeSafeDOM surface owns safe HTML / sanitization:
 *   - isValidChannelId / isYouTubeUrl / validateNumber (unused)
 *   - createSafeHTML / setInnerHTMLSafe / renderTemplateClone
 *   - setTextContentSafe / sanitizeAttribute / setAttributeSafe
 *
 * Module must remain dependency-free for userscript use.
 */
// @ts-check
(function () {
  const TRUSTED_TYPES_POLICY_NAME = 'youtubeplus#sanitize';
  let isSanitizing = false;
  let isDefaultPolicyHTMLReentrant = false;
  const getLogger = () =>
    (typeof window !== 'undefined' && window.YouTubePlusLogger) ||
    (typeof window !== 'undefined' && window.YouTubeUtils && window.YouTubeUtils.logger) ||
    null;

  const BLOCKED_TAGS = new Set([
    'SCRIPT',
    'IFRAME',
    'OBJECT',
    'EMBED',
    'LINK',
    'META',
    'STYLE',
    'BASE',
    'FORM',
    'NOSCRIPT',
    'TEMPLATE',
  ]);

  const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'formaction', 'action', 'poster']);

  // ---------------------------------------------------------------------
  // Trusted Types policy + facade
  // ---------------------------------------------------------------------

  /** @type {{ policyName: string, isSupported: boolean, getPolicy: () => any, createHTML: (html: string) => string, createScriptURL: (url: string) => string, createScript: (value: string) => string } | null} */
  let trustedTypesFacade = null;

  /**
   * Lazily create a named Trusted Types policy shared across the userscript.
   * @returns {any}
   */
  function getTrustedTypesPolicy() {
    if (typeof window === 'undefined' || typeof window.trustedTypes === 'undefined') {
      return null;
    }

    const existing = /** @type {{ policy?: any } | undefined} */ (window.YouTubeTrustedTypes);
    if (existing?.policy) {
      return existing.policy;
    }

    try {
      const policy = window.trustedTypes.createPolicy(TRUSTED_TYPES_POLICY_NAME, {
        createHTML: /** @param {string} value */ value => {
          if (typeof value !== 'string') return String(value == null ? '' : value);
          if (!value) return '';
          if (isSanitizing) {
            return value;
          }
          isSanitizing = true;
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(value, 'text/html');
            // DOMParser wraps bare text in <html><head></head><body>...</body></html>
            const fragment = document.createDocumentFragment();
            if (doc.body) {
              fragment.append(...doc.body.childNodes);
            } else if (doc.documentElement) {
              fragment.append(...doc.documentElement.childNodes);
            }
            sanitizeFragment(fragment);
            const container = document.createElement('div');
            container.append(fragment);
            return container.innerHTML;
          } finally {
            isSanitizing = false;
          }
        },
        createScriptURL: /** @param {string} value */ value => {
          if (typeof value !== 'string') return String(value == null ? '' : value);
          try {
            const url = new URL(value, location.origin);
            if (url.origin === location.origin) return value;
            if (url.hostname.endsWith('.googleapis.com') || url.hostname.endsWith('.youtube.com')) {
              return value;
            }
          } catch {
            // Ignore malformed URLs and fall through to blocking.
          }
          getLogger()?.warn?.('Security', 'Blocked untrusted script URL', value);
          return 'about:blank';
        },
        createScript: () => {
          getLogger()?.warn?.('Security', 'Blocked Trusted Types createScript call');
          return '';
        },
      });

      if (typeof window !== 'undefined' && window.YouTubeTrustedTypes) {
        window.YouTubeTrustedTypes.policy = policy;
      }

      return policy;
    } catch {
      return existing?.policy || null;
    }
  }

  /**
   * Convert a string to TrustedHTML when supported.
   * Canonical entry: this is what `createHTML` resolves to.
   * @param {string} html
   * @returns {string}
   */
  function createTrustedHTML(html) {
    const normalized = typeof html === 'string' ? html : String(html == null ? '' : html);
    const policy = getTrustedTypesPolicy();
    return policy ? policy.createHTML(normalized) : normalized;
  }

  /**
   * Convert a string to TrustedScriptURL when supported.
   * @param {string} url
   * @returns {string}
   */
  function createTrustedScriptURL(url) {
    const normalized = typeof url === 'string' ? url : String(url == null ? '' : url);
    const policy = getTrustedTypesPolicy();
    return policy ? policy.createScriptURL(normalized) : normalized;
  }

  /**
   * Convert a value to TrustedScript when supported.
   * @param {string|unknown} value
   * @returns {string}
   */
  function createTrustedScript(value) {
    const normalized = typeof value === 'string' ? value : String(value == null ? '' : value);
    const policy = getTrustedTypesPolicy();
    return policy ? /** @type {string} */ (policy.createScript(normalized)) : normalized;
  }

  /**
   * Install the special `default` Trusted Types policy so plain-string
   * assignments to TT-protected sinks (Range.createContextualFragment, innerHTML,
   * setHTMLUnsafe, etc.) are transparently sanitized. This avoids
   * "Sink type mismatch violation" errors on hosts that enforce
   * `require-trusted-types-for` and only allow specific policy names
   * (e.g. youtube.com).
   */
  function installDefaultTrustedTypesPolicy() {
    if (typeof window === 'undefined' || typeof window.trustedTypes === 'undefined') return;
    if (window.trustedTypes.defaultPolicy) return;
    const namedPolicy = getTrustedTypesPolicy();
    try {
      window.trustedTypes.createPolicy('default', {
        createHTML: /** @param {string} value */ value => {
          if (isDefaultPolicyHTMLReentrant) {
            return typeof value === 'string' ? value : String(value == null ? '' : value);
          }
          isDefaultPolicyHTMLReentrant = true;
          try {
            const safeValue =
              typeof value === 'string' ? value : String(value == null ? '' : value);
            return namedPolicy ? namedPolicy.createHTML(safeValue) : safeValue;
          } finally {
            isDefaultPolicyHTMLReentrant = false;
          }
        },
        createScriptURL: /** @param {string} value */ value => {
          const safeValue = typeof value === 'string' ? value : String(value == null ? '' : value);
          return namedPolicy ? namedPolicy.createScriptURL(safeValue) : safeValue;
        },
        createScript: () => {
          getLogger()?.warn?.('Security', 'Blocked default Trusted Types createScript call');
          return '';
        },
      });
    } catch {
      /* no-op */
    }
  }

  // ---------------------------------------------------------------------
  // URL scheme guard (used by sanitizeHTML)
  // ---------------------------------------------------------------------

  /**
   * Accept only safe URL schemes/values for URL-bearing attributes.
   * @param {string} value
   * @returns {boolean}
   */
  function isSafeUrl(value) {
    if (typeof value !== 'string') return false;
    const normalized = value.trim();
    if (!normalized) return true;
    if (normalized.startsWith('#') || normalized.startsWith('/')) return true;

    const lower = normalized.toLowerCase();
    if (lower.startsWith('java' + 'script:')) return false;
    if (lower.startsWith('vbscript:')) return false;
    if (lower.startsWith('data:') && !lower.startsWith('data:image/')) return false;

    try {
      const url = new URL(normalized, location.origin);
      return ['http:', 'https:', 'mailto:', 'tel:', 'blob:'].includes(url.protocol);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Fragment + sanitization
  // ---------------------------------------------------------------------

  /**
   * Create a parsed fragment from HTML without using innerHTML assignments.
   * Accepts either a string or an already-trusted value (e.g. TrustedHTML).
   * @param {string|unknown} html
   * @returns {DocumentFragment}
   */
  function createFragment(html) {
    const range = document.createRange();
    const root = document.body || document.documentElement;
    if (root) {
      range.selectNode(root);
    }
    let safeHTML = html;
    if (typeof html === 'string') {
      safeHTML = createTrustedHTML(html);
    } else if (html == null) {
      safeHTML = '';
    }
    // this IS the centralized sanitizer entry; callers wrap input via Trusted Types
    return range.createContextualFragment(/** @type {any} */ (safeHTML));
  }

  /**
   * DOM-allowlist sanitization core. Walks the supplied fragment in place,
   * dropping blocked tags and stripping dangerous / unsafe attributes.
   * Shared by the public `sanitizeHTML` entry and the Trusted Types
   * `createHTML` policy callback so the policy cannot be bypassed by
   * regex-non-greedy / nested / control-char tricks.
   * @param {DocumentFragment} fragment
   * @returns {void}
   */
  function sanitizeFragment(fragment) {
    const showElement = window.NodeFilter?.SHOW_ELEMENT || 1;
    const walker = document.createTreeWalker(fragment, showElement);
    /** @type {Element[]} */
    const toRemove = [];

    while (walker.nextNode()) {
      const element = /** @type {Element} */ (walker.currentNode);
      if (BLOCKED_TAGS.has(element.tagName.toUpperCase())) {
        toRemove.push(element);
        continue;
      }

      const attrs = Array.from(element.attributes);
      for (const attr of attrs) {
        const name = attr.name.toLowerCase();
        const value = attr.value;

        if (name.startsWith('on') || name === 'srcdoc') {
          element.removeAttribute(attr.name);
          continue;
        }

        if (URL_ATTRS.has(name) && !isSafeUrl(value)) {
          element.removeAttribute(attr.name);
        }
      }
    }

    for (const el of toRemove) {
      el.remove();
    }
  }

  /**
   * Sanitize HTML through a conservative DOM allowlist pass.
   * @param {string} html
   * @returns {string}
   */
  function sanitizeHTML(html) {
    if (typeof html !== 'string' || html.length === 0) return '';

    const fragment = createFragment(createTrustedHTML(html));
    sanitizeFragment(fragment);

    const container = document.createElement('div');
    container.append(fragment);
    return container.innerHTML;
  }

  /**
   * Convert raw HTML to trusted HTML using the global TrustedTypes policy
   * when available, after a sanitization pass.
   * @param {string} html
   * @returns {string}
   */
  function createSafeHTML(html) {
    const sanitized = sanitizeHTML(html);
    return createTrustedHTML(sanitized);
  }

  /**
   * Canonical safe HTML creator. Returns a TrustedHTML value (or plain string
   * on hosts without Trusted Types). For already-trusted input, returns it
   * unchanged so the contextual-fragment sink receives the same value.
   * @param {string|unknown} html
   * @returns {string}
   */
  function createHTML(html) {
    if (html == null) return '';
    if (typeof html !== 'string') return String(html);
    return createTrustedHTML(html);
  }

  // ---------------------------------------------------------------------
  // Element setters (canonical insertion paths)
  // ---------------------------------------------------------------------

  /**
   * Safely set HTML content on an element.
   * @param {Element} element
   * @param {string} html
   * @param {{sanitize?: boolean}} [options]
   */
  function setHTML(element, html, options = {}) {
    if (!(element instanceof HTMLElement)) return;
    const shouldSanitize = options.sanitize !== false;
    const content = shouldSanitize ? createSafeHTML(html) : html;
    const fragment = createFragment(content || '');
    element.replaceChildren(fragment);
  }

  /**
   * Render HTML via contextual fragment parser and replace element children.
   * @param {Element} element
   * @param {string|unknown} html
   * @returns {void}
   */
  function renderTemplateClone(element, html) {
    if (!(element instanceof Element)) return;
    const trusted =
      typeof html === 'string'
        ? createTrustedHTML(html)
        : html == null
          ? createTrustedHTML('')
          : html;
    const fragment = createFragment(trusted);
    element.replaceChildren(fragment);
  }

  /**
   * Safely set plain text content.
   * @param {Element} element
   * @param {string} text
   */
  function setText(element, text) {
    if (!(element instanceof HTMLElement)) return;
    element.textContent = typeof text === 'string' ? text : '';
  }

  // ---------------------------------------------------------------------
  // Text/attribute escape (HTML context helpers)
  // ---------------------------------------------------------------------

  /**
   * Escape plain text for HTML context.
   * @param {string} input
   * @returns {string}
   */
  function escapeHTML(input) {
    if (typeof input !== 'string' || input.length === 0) return '';
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
  }

  /**
   * Validate and sanitize attribute value.
   * @param {string} attrName
   * @param {string} attrValue
   * @returns {string|null}
   */
  function sanitizeAttribute(attrName, attrValue) {
    if (!attrName || typeof attrName !== 'string') return null;
    if (attrValue === null || attrValue === undefined) return '';

    if (/^on[a-z]/i.test(attrName)) {
      getLogger()?.warn?.('Security', `Blocked event handler attribute: ${attrName}`);
      return null;
    }

    const valueStr = String(attrValue);
    const lowerName = attrName.toLowerCase();
    if (lowerName === 'href' || lowerName === 'src') {
      if (/^javascript:/i.test(valueStr)) {
        getLogger()?.warn?.('Security', `Blocked javascript protocol in ${attrName}`);
        return null;
      }
      if (
        valueStr.toLowerCase().startsWith('data:') &&
        !valueStr.toLowerCase().startsWith('data:image/')
      ) {
        getLogger()?.warn?.('Security', `Blocked non-image data: URI in ${attrName}`);
        return null;
      }
    }

    return valueStr;
  }

  /**
   * Set attribute safely with validation.
   * @param {Element} element
   * @param {string} attrName
   * @param {string} attrValue
   * @returns {boolean}
   */
  function setAttributeSafe(element, attrName, attrValue) {
    if (!(element instanceof HTMLElement)) {
      getLogger()?.error?.('Security', 'Invalid element for setAttributeSafe');
      return false;
    }

    const sanitizedValue = sanitizeAttribute(attrName, attrValue);
    if (sanitizedValue === null) return false;

    try {
      element.setAttribute(attrName, sanitizedValue);
      return true;
    } catch (e) {
      getLogger()?.error?.('Security', 'setAttribute failed', e);
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Back-compat: legacy validators (YouTubeSecurityUtils surface)
  // These do not belong canonically to safe HTML insertion but are kept here
  // as a stable bridge for current callers. New code must not depend on them.
  // ---------------------------------------------------------------------

  /**
   * Validate YouTube video ID format.
   * @deprecated Use a module-local helper or the YouTubeSafeDOM
   *   validator surface (not currently exposed). Kept for
   *   `YouTubeSecurityUtils.isValidVideoId` callers.
   * @param {string} id
   * @returns {boolean}
   */
  function isValidVideoId(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
  }

  /**
   * Sanitize plain text for safe display.
   * @deprecated Kept for `YouTubeSecurityUtils.sanitizeText` callers;
   *   new code should sanitize through the HTML allowlist path.
   * @param {string} text
   * @returns {string}
   */
  function sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/[<>]/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+=/gi, '')
      .trim();
  }

  // ---------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------

  if (typeof window !== 'undefined') {
    trustedTypesFacade = {
      policyName: TRUSTED_TYPES_POLICY_NAME,
      isSupported: typeof window.trustedTypes !== 'undefined',
      getPolicy: getTrustedTypesPolicy,
      createHTML: createTrustedHTML,
      createScriptURL: createTrustedScriptURL,
      createScript: createTrustedScript,
    };

    window.YouTubeTrustedTypes = trustedTypesFacade;
    // Canonical createHTML alias exposed as a top-level helper for callers
    // that do not import the safe-dom bundle directly.
    window._ytplusCreateHTML = createTrustedHTML;
    installDefaultTrustedTypesPolicy();

    /** @type {YouTubeSafeDOM} */
    const safeDOM = {
      // --- canonical safe HTML / insertion ---
      createHTML,
      createSafeHTML,
      createFragment,
      sanitizeHTML,
      setHTML,
      renderTemplateClone,
      setText,
      escapeHTML,
      // --- Trusted Types ---
      createTrustedHTML,
      createTrustedScriptURL,
      createTrustedScript,
      createTrustedInlineScript: createTrustedScript,
      getTrustedTypesPolicy,
      // --- attribute guards ---
      sanitizeAttribute,
      setAttributeSafe,
      isSafeUrl,
      isValidVideoId,
      sanitizeText,
    };
    window.YouTubeSafeDOM = safeDOM;
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubeSafeDOM = safeDOM;
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = typeof window !== 'undefined' ? window.YouTubeSafeDOM : {};
  }
})();
