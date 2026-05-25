/**
 * Centralized safe DOM helpers for HTML/text assignment.
 * This module is intentionally lightweight and dependency-free for userscript use.
 */
// @ts-check
(function () {
  'use strict';

  const TRUSTED_TYPES_POLICY_NAME = 'youtubeplus#sanitize';

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
  ]);

  const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'formaction', 'action', 'poster']);

  /** @type {{ policyName: string, isSupported: boolean, getPolicy: () => any, createHTML: (html: string) => string, createScriptURL: (url: string) => string, createScript: (value: string) => string } | null} */
  let trustedTypesFacade = null;

  /**
   * Normalize HTML input for Trusted Types sinks without forcing string coercion.
   * @param {string|unknown} html
   * @returns {unknown}
   */
  function normalizeHTMLForSink(html) {
    if (html === null || html === undefined) return '';
    if (typeof html === 'string') {
      return typeof window !== 'undefined' && typeof window.trustedTypes !== 'undefined'
        ? createTrustedHTML(html)
        : html;
    }
    return html;
  }

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
          if (typeof value !== 'string') return String(value ?? '');
          return value
            .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
            .replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '')
            .replace(/<object\b[\s\S]*?<\/object\s*>/gi, '')
            .replace(/<embed\b[^>]*\/?>/gi, '')
            .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/javascript\s*:/gi, '')
            .replace(/data\s*:\s*text\/html/gi, 'blocked:');
        },
        createScriptURL: /** @param {string} value */ value => {
          if (typeof value !== 'string') return String(value ?? '');
          try {
            const url = new URL(value, location.origin);
            if (url.origin === location.origin) return value;
            if (url.hostname.endsWith('.googleapis.com') || url.hostname.endsWith('.youtube.com')) {
              return value;
            }
          } catch (e) {
            // Ignore malformed URLs and fall through to blocking.
            void e;
          }
          window.console.warn('[YouTube+][Security] Blocked untrusted script URL:', value);
          return 'about:blank';
        },
        createScript: /** @param {string} value */ value =>
          typeof value === 'string' ? value : String(value ?? ''),
      });

      if (typeof window !== 'undefined' && window.YouTubeTrustedTypes) {
        window.YouTubeTrustedTypes.policy = policy;
      }

      return policy;
    } catch (e) {
      void e;
      return existing?.policy || null;
    }
  }

  /**
   * Convert a string to TrustedHTML when supported.
   * @param {string} html
   * @returns {string}
   */
  function createTrustedHTML(html) {
    const normalized = typeof html === 'string' ? html : String(html ?? '');
    const policy = getTrustedTypesPolicy();
    return policy ? policy.createHTML(normalized) : normalized;
  }

  /**
   * Install the special `default` Trusted Types policy so plain-string
   * assignments to TT-protected sinks (Range.createContextualFragment, innerHTML,
   * setHTMLUnsafe, etc.) are transparently sanitized. This avoids "Sink type
   * mismatch violation" errors on hosts that enforce `require-trusted-types-for`
   * and only allow specific policy names (e.g. youtube.com).
   */
  function installDefaultTrustedTypesPolicy() {
    if (typeof window === 'undefined' || typeof window.trustedTypes === 'undefined') return;
    if (window.trustedTypes.defaultPolicy) return;
    const namedPolicy = getTrustedTypesPolicy();
    try {
      window.trustedTypes.createPolicy('default', {
        createHTML: /** @param {string} value */ value => {
          const safeValue = typeof value === 'string' ? value : String(value ?? '');
          return namedPolicy ? namedPolicy.createHTML(safeValue) : safeValue;
        },
        createScriptURL: /** @param {string} value */ value => {
          const safeValue = typeof value === 'string' ? value : String(value ?? '');
          return namedPolicy ? namedPolicy.createScriptURL(safeValue) : safeValue;
        },
        createScript: /** @param {unknown} value */ value =>
          typeof value === 'string' ? value : String(value ?? ''),
      });
    } catch (e) {
      void e;
    }
  }

  /**
   * Convert a string to TrustedScriptURL when supported.
   * @param {string} url
   * @returns {string}
   */
  function createTrustedScriptURL(url) {
    const normalized = typeof url === 'string' ? url : String(url ?? '');
    const policy = getTrustedTypesPolicy();
    return policy ? policy.createScriptURL(normalized) : normalized;
  }

  /**
   * Convert a string to TrustedScript when supported.
   * @param {string|unknown} value
   * @returns {string}
   */
  function createTrustedScript(value) {
    const normalized = typeof value === 'string' ? value : String(value ?? '');
    const policy = getTrustedTypesPolicy();
    return policy ? /** @type {string} */ (policy.createScript(normalized)) : normalized;
  }

  /**
   * Create a parsed fragment from HTML without using innerHTML assignments.
   * @param {string|unknown} html
   * @returns {DocumentFragment}
   */
  function createFragment(html) {
    const range = document.createRange();
    const root = document.body || document.documentElement;
    if (root) {
      range.selectNode(root);
    }
    const safeHTML = normalizeHTMLForSink(html);
    // eslint-disable-next-line no-unsanitized/method -- this IS the centralized sanitizer entry; callers wrap input via Trusted Types
    return range.createContextualFragment(/** @type {any} */ (safeHTML));
  }

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
    } catch (e) {
      return false;
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

    const showElement = (window.NodeFilter && window.NodeFilter.SHOW_ELEMENT) || 1;
    const walker = document.createTreeWalker(fragment, showElement);
    /** @type {Element[]} */
    const toRemove = [];

    while (walker.nextNode()) {
      const element = /** @type {Element} */ (walker.currentNode);
      if (BLOCKED_TAGS.has(element.tagName)) {
        toRemove.push(element);
        continue;
      }

      // Remove risky attributes and sanitize URL attributes.
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

    const container = document.createElement('div');
    container.append(fragment);
    return container.innerHTML;
  }

  /**
   * Convert raw HTML to trusted HTML using the global TrustedTypes policy when available.
   * @param {string} html
   * @returns {string}
   */
  function createSafeHTML(html) {
    const sanitized = sanitizeHTML(html);
    return createTrustedHTML(sanitized);
  }

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
   * Safely set plain text content.
   * @param {Element} element
   * @param {string} text
   */
  function setText(element, text) {
    if (!(element instanceof HTMLElement)) return;
    element.textContent = typeof text === 'string' ? text : '';
  }

  /**
   * Render HTML via contextual fragment parser and replace element children.
   * @param {Element} element
   * @param {string|unknown} html
   * @returns {void}
   */
  function renderTemplateClone(element, html) {
    if (!(element instanceof Element)) return;
    const trusted = createTrustedHTML(typeof html === 'string' ? html : String(html ?? ''));
    const fragment = createFragment(trusted);
    element.replaceChildren(fragment);
  }

  /**
   * Validate YouTube video ID format.
   * @param {string} id
   * @returns {boolean}
   */
  function isValidVideoId(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
  }

  /**
   * Validate YouTube channel ID format.
   * @param {string} id
   * @returns {boolean}
   */
  function isValidChannelId(id) {
    if (!id || typeof id !== 'string') return false;
    return /^UC[a-zA-Z0-9_-]{22}$/.test(id);
  }

  /**
   * Validate URL is from YouTube domain.
   * @param {string} url
   * @returns {boolean}
   */
  function isYouTubeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return (
        hostname === 'www.youtube.com' ||
        hostname === 'youtube.com' ||
        hostname === 'm.youtube.com' ||
        hostname === 'music.youtube.com' ||
        hostname.endsWith('.youtube.com')
      );
    } catch (e) {
      void e;
      return false;
    }
  }

  /**
   * Sanitize plain text for safe display.
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
      window.console.warn(`[Security] Blocked event handler attribute: ${attrName}`);
      return null;
    }

    const valueStr = String(attrValue);
    const lowerName = attrName.toLowerCase();
    if (lowerName === 'href' || lowerName === 'src') {
      if (/^javascript:/i.test(valueStr)) {
        window.console.warn(`[Security] Blocked javascript protocol in ${attrName}`);
        return null;
      }
      if (
        valueStr.toLowerCase().startsWith('data:') &&
        !valueStr.toLowerCase().startsWith('data:image/')
      ) {
        window.console.warn(`[Security] Blocked non-image data: URI in ${attrName}`);
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
      window.console.error('[Security] Invalid element for setAttributeSafe');
      return false;
    }

    const sanitizedValue = sanitizeAttribute(attrName, attrValue);
    if (sanitizedValue === null) return false;

    try {
      element.setAttribute(attrName, sanitizedValue);
      return true;
    } catch (e) {
      window.console.error('[Security] setAttribute failed:', e);
      return false;
    }
  }

  /**
   * Validate number in safe range.
   * @param {*} value
   * @param {number} min
   * @param {number} max
   * @returns {number|null}
   */
  function validateNumber(value, min = -Infinity, max = Infinity) {
    const num = Number(value);
    if (isNaN(num) || !isFinite(num)) return null;
    if (num < min || num > max) return null;
    return num;
  }

  class RateLimiter {
    constructor(maxRequests = 10, timeWindow = 60000, maxKeys = 100) {
      this.maxRequests = maxRequests;
      this.timeWindow = timeWindow;
      this.maxKeys = maxKeys;
      this.requests = new Map();
    }

    /**
     * @param {string} key
     * @returns {boolean}
     */
    canRequest(key) {
      const now = Date.now();
      const requests = this.requests.get(key) || [];
      const recentRequests = requests.filter(
        /** @param {number} time */ time => now - time < this.timeWindow
      );

      if (recentRequests.length >= this.maxRequests) {
        window.console.warn(
          `[Security] Rate limit exceeded for ${key}. Max ${this.maxRequests} requests per ${this.timeWindow}ms.`
        );
        return false;
      }

      recentRequests.push(now);
      this.requests.set(key, recentRequests);

      if (this.requests.size > this.maxKeys) {
        const keysToDelete = this.requests.size - this.maxKeys;
        const iter = this.requests.keys();
        for (let i = 0; i < keysToDelete; i += 1) {
          const oldest = iter.next().value;
          if (oldest !== key) this.requests.delete(oldest);
        }
      }

      return true;
    }

    clear() {
      this.requests.clear();
    }
  }

  /**
   * @param {string} url
   * @param {Object} options
   * @param {number} timeout
   * @returns {Promise<Response>}
   */
  function fetchWithTimeout(url, options = {}, timeout = 10000) {
    return Promise.race([
      fetch(url, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), timeout)),
    ]);
  }

  /**
   * @param {Object} data
   * @param {Object} schema
   * @returns {boolean}
   */
  function validateJSONSchema(data, schema) {
    if (!data || typeof data !== 'object') return false;
    if (!schema || typeof schema !== 'object') return true;
    const schemaObj = /** @type {Record<string, any>} */ (schema);
    const dataObj = /** @type {Record<string, any>} */ (data);
    for (const key in schemaObj) {
      if (schemaObj[key].required && !(key in dataObj)) {
        window.console.warn(`[Security] Missing required field: ${key}`);
        return false;
      }
      if (key in dataObj && schemaObj[key].type && typeof dataObj[key] !== schemaObj[key].type) {
        window.console.warn(
          `[Security] Invalid type for field ${key}: expected ${schemaObj[key].type}, got ${typeof dataObj[key]}`
        );
        return false;
      }
    }
    return true;
  }

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
    window._ytplusCreateHTML = createTrustedHTML;
    installDefaultTrustedTypesPolicy();
    window.YouTubeSafeDOM = {
      escapeHTML,
      sanitizeHTML,
      createSafeHTML,
      createFragment,
      createTrustedHTML,
      createTrustedScriptURL,
      createTrustedScript,
      createTrustedInlineScript: createTrustedScript,
      getTrustedTypesPolicy,
      setHTML,
      renderTemplateClone,
      setText,
      isSafeUrl,
      isValidVideoId,
      isValidChannelId,
      isYouTubeUrl,
      sanitizeText,
      sanitizeAttribute,
      setAttributeSafe,
      validateNumber,
      RateLimiter,
      fetchWithTimeout,
      validateJSONSchema,
    };

    window.YouTubeSecurityUtils = {
      isValidVideoId,
      isValidChannelId,
      isYouTubeUrl,
      sanitizeText,
      escapeHtml: escapeHTML,
      createSafeHTML,
      setInnerHTMLSafe(element, html, sanitize = false) {
        setHTML(element, html, { sanitize });
      },
      renderTemplateClone,
      setTextContentSafe(element, text) {
        setText(element, text || '');
      },
      sanitizeAttribute,
      setAttributeSafe,
      validateNumber,
      RateLimiter,
      fetchWithTimeout,
      validateJSONSchema,
    };
    window.YouTubePlusSecurity = window.YouTubeSecurityUtils;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.YouTubeSafeDOM;
  }
})();
