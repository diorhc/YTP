/**
 * safe-dom.js: safe HTML / HTML insertion module.
 *
 * Owns:
 *   - Trusted Types policy + createTrustedHTML facade
 *   - createHTML (sanitize then TT wrap) / createSafeHTML (alias)
 *   - sanitizeHTML (DOM allowlist filter, returns plain string)
 *   - setHTML / renderTemplateClone (insertion paths)
 *   - createFragment (contextual fragment helper)
 *   - setText (text-only safe setter)
 *   - isSafeUrl (URL scheme allowlist used by sanitizeHTML)
 *   - escapeHTML (text-to-HTML escape)
 *   - sanitizeAttribute / setAttributeSafe (attribute-level guards)
 *
 * Back-compat only (do not use in new code):
 *   - isValidVideoId / sanitizeText (legacy validators)
 *
 * Module must remain dependency-free for userscript use.
 */
// @ts-check
(function () {
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'SafeDOM');
  const TRUSTED_TYPES_POLICY_NAME = 'youtubeplus#sanitize';
  let isPolicyHTMLSanitizing = false;
  const getLogger = () =>
    (typeof window !== 'undefined' && window.YouTubePlusLogger) ||
    (typeof window !== 'undefined' && window.YouTubeUtils && window.YouTubeUtils.logger) ||
    null;

  const ALLOWED_TAGS = new Set([
    'A',
    'B',
    'BR',
    'BUTTON',
    'CIRCLE',
    'DIV',
    'EM',
    'G',
    'H1',
    'H2',
    'H3',
    'H4',
    'HEADER',
    'I',
    'IMG',
    'INPUT',
    'KBD',
    'LABEL',
    'LI',
    'LINE',
    'OPTION',
    'P',
    'PAPER-RIPPLE',
    'PATH',
    'POLYGON',
    'POLYLINE',
    'RECT',
    'SECONDARY-WRAPPER',
    'SELECT',
    'SPAN',
    'SVG',
    'TABVIEW-VIEW-POS-THEAD',
    'TEXTAREA',
    'UL',
  ]);

  const GLOBAL_ATTRS = new Set([
    'class',
    'id',
    'role',
    'title',
    'tabindex',
    'aria-label',
    'aria-modal',
    'aria-pressed',
    'aria-hidden',
    'aria-live',
    'aria-expanded',
    'aria-selected',
    'aria-checked',
    // functional/ARIA attributes required by code-authored
    // templates (read-only controls, sliders, described UI). The numeric
    // slider trio carries VALUE validation in sanitizeElementAttribute.
    'aria-disabled',
    'aria-describedby',
    'aria-labelledby',
    'aria-controls',
    'aria-orientation',
    'aria-valuenow',
    'aria-valuemin',
    'aria-valuemax',
  ]);

  // Numeric slider ARIA attributes: values must be plain numbers
  // (value validation, fail-closed).
  const NUMERIC_ARIA_ATTRS = new Set(['aria-valuenow', 'aria-valuemin', 'aria-valuemax']);
  const NUMERIC_ARIA_VALUE = /^-?\d+(?:\.\d+)?$/;

  // Internal attributes are inert state markers consumed by YouTube+'s own
  // DOM logic. They must survive sanitization, while event handlers, URL
  // attributes and arbitrary custom attributes remain blocked.
  const INTERNAL_ATTR_PREFIXES = ['tyt-'];
  const INTERNAL_ATTRS = new Set(['userscript-scrollbar-render']);

  const SVG_ATTRS = new Set([
    'width',
    'height',
    'viewbox',
    'fill',
    'xmlns',
    'xmlns:svg',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'd',
    'points',
    'opacity',
    'x1',
    'y1',
    'x2',
    'y2',
    'cx',
    'cy',
    'r',
    'x',
    'y',
    'rx',
    'ry',
    'preserveaspectratio',
    'version',
    'vector-effect',
  ]);

  const URL_ATTRS = new Set(['href', 'src']);

  const LENGTH_STYLE_PROPERTIES = new Set([
    'border-radius',
    'font-size',
    'gap',
    'height',
    'margin-top',
    'padding',
    'width',
  ]);
  /** @type {Record<string, Set<string>>} */
  const STYLE_ENUM_VALUES = {
    display: new Set(['none', 'block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex']),
    fill: new Set(['currentcolor', 'none']),
    'flex-wrap': new Set(['nowrap', 'wrap', 'wrap-reverse']),
    'word-break': new Set(['break-all', 'break-word', 'normal']),
  };
  const SAFE_LENGTH_VALUE =
    /^(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw))(?:\s+(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw))){0,3}$/i;
  const SAFE_GRADIENT_VALUE =
    /^linear-gradient\(\s*to\s+(?:right|left|top|bottom)\s*,\s*var\(--[a-z0-9-]+\)\s+\d+(?:\.\d+)?%\s*,\s*var\(--[a-z0-9-]+\)\s+\d+(?:\.\d+)?%\s*\)$/i;

  /** @type {Record<string, Set<string>>} */
  const TAG_ATTRS = {
    A: new Set(['href', 'target', 'rel']),
    IMG: new Set(['src', 'alt']),
    INPUT: new Set([
      'type',
      'placeholder',
      'checked',
      'maxlength',
      'min',
      'max',
      'step',
      'value',
      'autocomplete',
      'spellcheck',
      // read-only / disabled controls must survive sanitization.
      'disabled',
      'readonly',
      'required',
    ]),
    TEXTAREA: new Set(['placeholder', 'maxlength', 'disabled', 'readonly', 'required']),
    LABEL: new Set(['for']),
    OPTION: new Set(['value', 'selected', 'disabled']),
    SELECT: new Set(['disabled']),
    BUTTON: new Set(['type', 'disabled']),
    SVG: SVG_ATTRS,
    PATH: SVG_ATTRS,
    G: SVG_ATTRS,
    CIRCLE: SVG_ATTRS,
    LINE: SVG_ATTRS,
    POLYLINE: SVG_ATTRS,
    POLYGON: SVG_ATTRS,
    RECT: SVG_ATTRS,
  };

  // ---------------------------------------------------------------------
  // Trusted Types policy + facade
  // ---------------------------------------------------------------------

  /** @typedef {ReturnType<NonNullable<typeof trustedTypes>['createPolicy']>} TrustedTypesPolicy */

  /** @type {{ policyName: string, isSupported: boolean, getPolicy: () => TrustedTypesPolicy | null, createHTML: (html: string) => string } | null} */
  let trustedTypesFacade = null;

  /**
   * Lazily create a named Trusted Types policy shared across the userscript.
   *safe-dom is the single TT owner; the policy object is never
   * published; callers go through the facade functions below.
   * @returns {TrustedTypesPolicy | null}
   */
  /** @type {TrustedTypesPolicy | null} */
  let cachedPolicy = null;
  function getTrustedTypesPolicy() {
    if (cachedPolicy) return cachedPolicy;
    if (typeof window === 'undefined' || typeof window.trustedTypes === 'undefined') {
      return null;
    }

    try {
      const policy = window.trustedTypes.createPolicy(TRUSTED_TYPES_POLICY_NAME, {
        // Sink-level protection: everything routed through the policy
        // is sanitized, even when a caller forgets to run sanitizeHTML first.
        // The reentrancy guard lets sanitizeHTML's own DOM building pass raw.
        createHTML: /** @param {string} value */ value => {
          if (isPolicyHTMLSanitizing) {
            return typeof value === 'string' ? value : String(value == null ? '' : value);
          }
          isPolicyHTMLSanitizing = true;
          try {
            return sanitizeHTML(
              typeof value === 'string' ? value : String(value == null ? '' : value)
            );
          } finally {
            isPolicyHTMLSanitizing = false;
          }
        },
        // Scripts the runtime injects itself (the page-realm Tabview core).
        // Only our own generated text reaches this policy; nothing from the DOM.
        createScript: /** @param {string} value */ value =>
          typeof value === 'string' ? value : String(value == null ? '' : value),
      });

      cachedPolicy = policy;

      return policy;
    } catch (_e) {
      logS(_e);
      return cachedPolicy || null;
    }
  }

  /**
   * Wrap a string as TrustedHTML via the named policy. The policy itself
   * sanitizes, so the sink-level path is safe even for raw input.
   * @param {string} html
   * @returns {string}
   */
  function createTrustedHTML(html) {
    const normalized = typeof html === 'string' ? html : String(html == null ? '' : html);
    const policy = getTrustedTypesPolicy();
    return policy ? policy.createHTML(normalized) : normalized;
  }

  /**
   * Wrap a string as TrustedScript through the same named policy. Returns null
   * when Trusted Types has no usable policy (unsupported document, or the policy
   * was refused), so the caller skips the sink instead of throwing a TypeError.
   * @param {string} text
   * @returns {string | null}
   */
  function createTrustedScript(text) {
    const policy = getTrustedTypesPolicy();
    if (!policy || typeof policy.createScript !== 'function') return null;
    const normalized = typeof text === 'string' ? text : String(text == null ? '' : text);
    return /** @type {string} */ (/** @type {unknown} */ (policy.createScript(normalized)));
  }

  /**
   * Trusted Types is owned by a named policy, never the global `default`
   * policy: a default policy re-sanitizes YouTube's own markup through our
   * allowlist for the whole page.
   */

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
    if (!normalized) return false;
    if (normalized.startsWith('#')) return true;
    if (normalized.startsWith('//')) return false;
    if (normalized.startsWith('/')) return true;

    const lower = normalized.toLowerCase();
    if (lower.startsWith('java' + 'script:')) return false;
    if (lower.startsWith('vbscript:')) return false;
    if (lower.startsWith('data:')) {
      return /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|avif)\b/.test(lower);
    }

    try {
      const url = new URL(normalized, location.origin);
      return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
    } catch (_e) {
      logS(_e);
      return false;
    }
  }

  /**
   * Keep only the small inline-style subset used by code-authored templates.
   * Values capable of loading resources or executing legacy CSS extensions
   * are rejected before property-specific validation.
   * @param {string} property
   * @param {string} value
   * @returns {boolean}
   */
  function isSafeInlineStyleValue(property, value) {
    const normalized = value.trim();
    if (!normalized || /[\\<>]/.test(normalized)) return false;
    if (
      /(?:url\s*\(|expression\s*\(|@import|javascript:|vbscript:|behavior\s*:|-moz-binding)/i.test(
        normalized
      )
    ) {
      return false;
    }

    const enumValues = STYLE_ENUM_VALUES[property];
    if (enumValues) return enumValues.has(normalized.toLowerCase());
    if (LENGTH_STYLE_PROPERTIES.has(property)) return SAFE_LENGTH_VALUE.test(normalized);
    if (property === 'opacity') return /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(normalized);
    if (property === 'background') return SAFE_GRADIENT_VALUE.test(normalized);
    return false;
  }

  /**
   * Parse an inline declaration list and serialize only approved declarations.
   * @param {string} value
   * @returns {string}
   */
  function sanitizeInlineStyle(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    const probe = document.createElement('div');
    probe.setAttribute('style', value);
    const declarations = [];

    for (let index = 0; index < probe.style.length; index += 1) {
      const property = probe.style.item(index).toLowerCase();
      const propertyValue = probe.style.getPropertyValue(property).trim();
      if (probe.style.getPropertyPriority(property)) continue;
      if (!isSafeInlineStyleValue(property, propertyValue)) continue;
      declarations.push(`${property}: ${propertyValue}`);
    }

    return declarations.join('; ');
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
    const fragment = range.createContextualFragment(/** @type {string} */ (safeHTML));
    // Always guarantee DOM-level sanitization across all environments (including Firefox / non-TrustedTypes)
    sanitizeFragment(fragment);
    return fragment;
  }

  /**
   * @param {string} name
   * @param {Set<string>} tagAttributes
   * @returns {boolean}
   */
  function isAllowedAttribute(name, tagAttributes) {
    if (name.startsWith('data-')) return true;
    if (GLOBAL_ATTRS.has(name) || tagAttributes.has(name)) return true;
    if (INTERNAL_ATTRS.has(name)) return true;
    return INTERNAL_ATTR_PREFIXES.some(prefix => name.startsWith(prefix));
  }

  /**
   * @param {Element} element
   * @param {Attr} attribute
   * @param {Set<string>} tagAttributes
   */
  function sanitizeElementAttribute(element, attribute, tagAttributes) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith('on') || name === 'srcdoc' || name === 'name') {
      element.removeAttribute(attribute.name);
      return;
    }
    if (name === 'style') {
      const safeStyle = sanitizeInlineStyle(attribute.value);
      if (safeStyle) element.setAttribute('style', safeStyle);
      else element.removeAttribute(attribute.name);
      return;
    }
    if (!isAllowedAttribute(name, tagAttributes)) {
      element.removeAttribute(attribute.name);
      return;
    }
    // Numeric slider ARIA values must be plain numbers;
    // anything else is rejected (fail-closed value validation).
    if (NUMERIC_ARIA_ATTRS.has(name) && !NUMERIC_ARIA_VALUE.test(attribute.value.trim())) {
      element.removeAttribute(attribute.name);
      return;
    }
    if (URL_ATTRS.has(name) && !isSafeUrl(attribute.value)) {
      element.removeAttribute(attribute.name);
    }
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
      const tag = element.tagName.toUpperCase();
      if (!ALLOWED_TAGS.has(tag)) {
        toRemove.push(element);
        continue;
      }

      const tagAttributes = TAG_ATTRS[tag] || new Set();
      for (const attribute of Array.from(element.attributes)) {
        sanitizeElementAttribute(element, attribute, tagAttributes);
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
   * Sanitize then convert to TrustedHTML. Entry point for untrusted input.
   * @param {string} html
   * @returns {string}
   */
  function createSafeHTML(html) {
    const sanitized = sanitizeHTML(html);
    return createTrustedHTML(sanitized);
  }

  /**
   * Safe HTML creator. Sanitizes input then returns a TrustedHTML
   * value (or plain string on hosts without Trusted Types).
   * @param {string|unknown} html
   * @returns {string}
   */
  function createHTML(html) {
    if (html == null) return '';
    if (typeof html !== 'string') return String(html);
    return createTrustedHTML(sanitizeHTML(html));
  }

  // ---------------------------------------------------------------------
  // Element setters (insertion paths)
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
      typeof html === 'string' ? createSafeHTML(html) : html == null ? createSafeHTML('') : html;
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
    // The attribute path uses the same allowlist and normalization as the HTML
    // sanitizer (isSafeUrl): a bare startsWith check is bypassable with control
    // characters in the scheme (the DOM normalizes `java\tscript:` to
    // `javascript:`) and disagrees on protocol-relative and non-image data: URIs.
    if (lowerName === 'href' || lowerName === 'src' || lowerName === 'xlink:href') {
      if (!isSafeUrl(valueStr)) {
        getLogger()?.warn?.('Security', `Blocked dangerous URL in ${attrName}`);
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
    // SVG elements (SVGAElement xlink:href) are legitimate targets;
    // the guard is about the VALUE, not the element kind.
    if (!(element instanceof Element) || typeof element.setAttribute !== 'function') {
      getLogger()?.error?.('Security', 'Invalid element for setAttributeSafe');
      return false;
    }

    const sanitizedValue = sanitizeAttribute(attrName, attrValue);
    if (sanitizedValue === null) return false;

    try {
      element.setAttribute(attrName, sanitizedValue);
      return true;
    } catch (e) {
      logS(e);
      getLogger()?.error?.('Security', 'setAttribute failed', e);
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Back-compat: legacy validators. These do not belong canonically to safe
  // HTML insertion but are kept here as a stable bridge for current callers.
  // New code must not depend on them.
  // ---------------------------------------------------------------------

  /**
   * Validate YouTube video ID format.
   * @deprecated Use a module-local helper.
   * @param {string} id
   * @returns {boolean}
   */
  function isValidVideoId(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
  }

  /**
   * Sanitize plain text for safe display.
   * @deprecated New code should sanitize through the HTML allowlist path.
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
    };

    window.YouTubeTrustedTypes = trustedTypesFacade;

    /** @type {YouTubeSafeDOM} */
    const safeDOM = {
      // --- safe HTML / insertion ---
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
      createTrustedScript,
      getTrustedTypesPolicy,
      // --- attribute guards ---
      sanitizeAttribute,
      setAttributeSafe,
      isSafeUrl,
      isValidVideoId,
      sanitizeText,
    };
    window.YouTubeSafeDOM = safeDOM;
    window.YouTubePlusSafeDOM = safeDOM;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = typeof window !== 'undefined' ? window.YouTubeSafeDOM : {};
  }
})();
