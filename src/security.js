/**
 * Security and Input Validation Utilities for YouTube Plus
 * Provides centralized security functions for XSS prevention, URL validation, and input sanitization
 */

(function () {
  'use strict';

  /**
   * Validation patterns
   * @type {Object.<string, RegExp>}
   */
  const PATTERNS = {
    URL: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)$/,
    VIDEO_ID: /^[a-zA-Z0-9_-]{11}$/,
    EMAIL: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
    STORAGE_KEY: /^[a-zA-Z0-9_.-]{1,100}$/,
    SAFE_STRING: /^[a-zA-Z0-9\s._-]{0,1000}$/,
  };

  /**
   * Maximum safe string lengths
   * @type {Object.<string, number>}
   */
  const MAX_LENGTHS = {
    URL: 2048,
    VIDEO_ID: 11,
    EMAIL: 254,
    STORAGE_KEY: 100,
    STORAGE_VALUE: 5242880, // 5MB
    HTML_CONTENT: 1000000, // 1MB
    USER_INPUT: 10000,
    TITLE: 500,
    DESCRIPTION: 5000,
  };

  /**
   * Dangerous HTML patterns to block
   * @type {RegExp[]}
   */
  const DANGEROUS_PATTERNS = [
    /<script[\s\S]*?<\/script>/gi,
    /<iframe[\s\S]*?<\/iframe>/gi,
    /javascript:/gi,
    /data:text\/html/gi,
    /on\w+\s*=/gi, // Event handlers like onclick=
    /<embed[\s\S]*?>/gi,
    /<object[\s\S]*?<\/object>/gi,
  ];

  /**
   * Allowed protocols for URLs
   * @type {Set<string>}
   */
  const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

  /**
   * Sanitize HTML string to prevent XSS attacks
   * @param {string} html - HTML string to sanitize
   * @param {Object} [options] - Sanitization options
   * @param {boolean} [options.allowLinks=false] - Allow anchor tags
   * @param {boolean} [options.allowBasicFormatting=false] - Allow basic formatting tags
   * @returns {string} Sanitized HTML
   */
  const sanitizeHTML = (html, options = {}) => {
    if (typeof html !== 'string') return '';

    let sanitizedHtml = html;

    // Check length
    if (sanitizedHtml.length > MAX_LENGTHS.HTML_CONTENT) {
      console.warn('[YouTube+][Security] HTML content exceeds maximum length, truncating');
      sanitizedHtml = sanitizedHtml.substring(0, MAX_LENGTHS.HTML_CONTENT);
    }

    // Remove dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      sanitizedHtml = sanitizedHtml.replace(pattern, '');
    }

    // Escape HTML entities
    const escapeMap = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;',
    };

    let sanitized = sanitizedHtml.replace(/[<>&"'`=/]/g, char => escapeMap[char] || char);

    // Optionally allow certain tags
    if (options.allowLinks) {
      // Very basic link restoration - be cautious
      sanitized = sanitized.replace(
        /&lt;a\s+href=&quot;(https?:\/\/[^&]+)&quot;&gt;([^&]+)&lt;\/a&gt;/gi,
        '<a href="$1" rel="noopener noreferrer" target="_blank">$2</a>'
      );
    }

    if (options.allowBasicFormatting) {
      const allowedTags = ['b', 'i', 'u', 'strong', 'em', 'br'];
      for (const tag of allowedTags) {
        sanitized = sanitized.replace(new RegExp(`&lt;${tag}&gt;`, 'gi'), `<${tag}>`);
        sanitized = sanitized.replace(new RegExp(`&lt;/${tag}&gt;`, 'gi'), `</${tag}>`);
      }
    }

    return sanitized;
  };

  /**
   * Validate and sanitize URL
   * @param {string} url - URL to validate
   * @param {Object} [options] - Validation options
   * @param {boolean} [options.requireHttps=false] - Require HTTPS protocol
   * @param {string[]} [options.allowedDomains] - List of allowed domains
   * @returns {{valid: boolean, sanitized: string|null, error: string|null}} Validation result
   */
  const validateURL = (url, options = {}) => {
    const result = {
      valid: false,
      sanitized: null,
      error: null,
    };

    try {
      // Type check
      if (typeof url !== 'string') {
        result.error = 'URL must be a string';
        return result;
      }

      // Length check
      if (url.length > MAX_LENGTHS.URL) {
        result.error = `URL exceeds maximum length of ${MAX_LENGTHS.URL} characters`;
        return result;
      }

      // Whitespace check
      if (url.trim() !== url) {
        result.error = 'URL contains leading or trailing whitespace';
        return result;
      }

      // Parse URL
      const parsed = new URL(url);

      // Protocol check
      if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        result.error = `Protocol ${parsed.protocol} not allowed`;
        return result;
      }

      // HTTPS requirement
      if (options.requireHttps && parsed.protocol !== 'https:') {
        result.error = 'HTTPS required';
        return result;
      }

      // Domain whitelist
      if (options.allowedDomains && options.allowedDomains.length > 0) {
        const isAllowed = options.allowedDomains.some(
          domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
        );
        if (!isAllowed) {
          result.error = `Domain ${parsed.hostname} not in whitelist`;
          return result;
        }
      }

      result.valid = true;
      result.sanitized = parsed.toString();
    } catch (error) {
      result.error = `Invalid URL: ${error.message}`;
    }

    return result;
  };

  /**
   * Validate YouTube video ID
   * @param {string} videoId - Video ID to validate
   * @returns {boolean} Whether the video ID is valid
   */
  const validateVideoId = videoId => {
    if (typeof videoId !== 'string') return false;
    return PATTERNS.VIDEO_ID.test(videoId);
  };

  /**
   * Validate email address
   * @param {string} email - Email to validate
   * @returns {boolean} Whether the email is valid
   */
  const validateEmail = email => {
    if (typeof email !== 'string') return false;
    if (email.length > MAX_LENGTHS.EMAIL) return false;
    return PATTERNS.EMAIL.test(email);
  };

  /**
   * Validate storage key
   * @param {string} key - Storage key to validate
   * @returns {boolean} Whether the key is valid
   */
  const validateStorageKey = key => {
    if (typeof key !== 'string') return false;
    if (key.length === 0 || key.length > MAX_LENGTHS.STORAGE_KEY) return false;
    return PATTERNS.STORAGE_KEY.test(key);
  };

  /**
   * Sanitize user input
   * @param {string} input - User input to sanitize
   * @param {Object} [options] - Sanitization options
   * @param {number} [options.maxLength] - Maximum allowed length
   * @param {boolean} [options.allowNewlines=true] - Allow newline characters
   * @param {boolean} [options.trim=true] - Trim whitespace
   * @returns {string} Sanitized input
   */
  const sanitizeInput = (input, options = {}) => {
    if (typeof input !== 'string') return '';

    const maxLength = options.maxLength || MAX_LENGTHS.USER_INPUT;
    const allowNewlines = options.allowNewlines !== false;
    const shouldTrim = options.trim !== false;

    let sanitized = input;

    // Trim if requested
    if (shouldTrim) {
      sanitized = sanitized.trim();
    }

    // Remove newlines if not allowed
    if (!allowNewlines) {
      sanitized = sanitized.replace(/[\r\n]+/g, ' ');
    }

    // Truncate to max length
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }

    // Remove null bytes and other control characters (except newlines/tabs if allowed)
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    return sanitized;
  };

  /**
   * Create a Content Security Policy (CSP) nonce
   * @returns {string} Random nonce value
   */
  const generateNonce = () => {
    const array = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(array);
    } else {
      // Fallback to Math.random for non-secure contexts
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  };

  /**
   * Check if running in a secure context
   * @returns {boolean} Whether context is secure
   */
  const isSecureContext = () => {
    return (
      typeof window !== 'undefined' &&
      (window.isSecureContext || window.location.protocol === 'https:')
    );
  };

  /**
   * Validate JSON structure
   * @param {string} jsonString - JSON string to validate
   * @param {number} [maxSize] - Maximum size in bytes
   * @returns {{valid: boolean, parsed: any, error: string|null}} Validation result
   */
  const validateJSON = (jsonString, maxSize = MAX_LENGTHS.STORAGE_VALUE) => {
    const result = {
      valid: false,
      parsed: null,
      error: null,
    };

    try {
      if (typeof jsonString !== 'string') {
        result.error = 'Input must be a string';
        return result;
      }

      if (jsonString.length > maxSize) {
        result.error = `JSON exceeds maximum size of ${maxSize} bytes`;
        return result;
      }

      result.parsed = JSON.parse(jsonString);
      result.valid = true;
    } catch (error) {
      result.error = `Invalid JSON: ${error.message}`;
    }

    return result;
  };

  /**
   * Rate limiter for preventing abuse
   */
  class RateLimiter {
    /**
     * Create a rate limiter
     * @param {number} maxCalls - Maximum calls allowed
     * @param {number} windowMs - Time window in milliseconds
     */
    constructor(maxCalls, windowMs) {
      this.maxCalls = maxCalls;
      this.windowMs = windowMs;
      this.calls = [];
    }

    /**
     * Check if action is allowed
     * @param {string} [key='default'] - Key for tracking different actions
     * @returns {boolean} Whether action is allowed
     */
    isAllowed(key = 'default') {
      const now = Date.now();
      const windowStart = now - this.windowMs;

      // Filter out old calls (keep all recent calls regardless of key)
      this.calls = this.calls.filter(call => call.timestamp > windowStart);

      // Count calls for this specific key
      const keyCallCount = this.calls.filter(call => call.key === key).length;

      // Check if under limit for this key
      if (keyCallCount < this.maxCalls) {
        this.calls.push({ key, timestamp: now });
        return true;
      }

      return false;
    }

    /**
     * Reset rate limiter
     */
    reset() {
      this.calls = [];
    }
  }

  // Expose to window
  if (typeof window !== 'undefined') {
    /** @type {any} */ (window).YouTubePlusSecurity = {
      sanitizeHTML,
      validateURL,
      validateVideoId,
      validateEmail,
      validateStorageKey,
      sanitizeInput,
      generateNonce,
      isSecureContext,
      validateJSON,
      RateLimiter,
      PATTERNS,
      MAX_LENGTHS,
    };
  }

  console.log('[YouTube+] Security module initialized');
})();
