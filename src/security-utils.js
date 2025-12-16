/**
 * Security utilities for YouTube+ userscript
 * Provides sanitization, validation, and security helpers
 */
(function () {
  'use strict';

  /**
   * Validate YouTube video ID format
   * @param {string} id - Video ID to validate
   * @returns {boolean} True if valid YouTube video ID
   */
  function isValidVideoId(id) {
    if (!id || typeof id !== 'string') return false;
    // YouTube video IDs are exactly 11 characters: alphanumeric, dash, underscore
    return /^[a-zA-Z0-9_-]{11}$/.test(id);
  }

  /**
   * Validate YouTube channel ID format
   * @param {string} id - Channel ID to validate
   * @returns {boolean} True if valid YouTube channel ID
   */
  function isValidChannelId(id) {
    if (!id || typeof id !== 'string') return false;
    // YouTube channel IDs start with UC and are 24 characters
    return /^UC[a-zA-Z0-9_-]{22}$/.test(id);
  }

  /**
   * Validate URL is from YouTube domain
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid YouTube URL
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
    } catch {
      return false;
    }
  }

  /**
   * Sanitize text content for safe display
   * Removes HTML tags and dangerous characters
   * @param {string} text - Text to sanitize
   * @returns {string} Sanitized text
   */
  function sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  }

  /**
   * Sanitize HTML by encoding special characters
   * @param {string} html - HTML string to sanitize
   * @returns {string} Sanitized HTML
   */
  function escapeHtml(html) {
    if (!html || typeof html !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  }

  /**
   * Create safe HTML using TrustedTypes if available
   * Falls back to identity function if not available
   * @param {string} html - HTML string to make safe
   * @returns {string|TrustedHTML} Safe HTML
   */
  function createSafeHTML(html) {
    if (typeof window._ytplusCreateHTML === 'function') {
      return window._ytplusCreateHTML(html);
    }
    // Fallback for when TrustedTypes not available
    return html;
  }

  /**
   * Set innerHTML safely with optional sanitization
   * @param {HTMLElement} element - Target element
   * @param {string} html - HTML content to set
   * @param {boolean} sanitize - Whether to escape HTML (default: false for trusted content)
   */
  function setInnerHTMLSafe(element, html, sanitize = false) {
    if (!element || !(element instanceof HTMLElement)) {
      console.error('[Security] Invalid element for setInnerHTMLSafe');
      return;
    }
    const content = sanitize ? escapeHtml(html) : html;
    element.innerHTML = createSafeHTML(content);
  }

  /**
   * Set text content safely (always escapes HTML)
   * @param {HTMLElement} element - Target element
   * @param {string} text - Text content to set
   */
  function setTextContentSafe(element, text) {
    if (!element || !(element instanceof HTMLElement)) {
      console.error('[Security] Invalid element for setTextContentSafe');
      return;
    }
    element.textContent = text || '';
  }

  /**
   * Validate and sanitize attribute value
   * @param {string} attrName - Attribute name
   * @param {string} attrValue - Attribute value
   * @returns {string|null} Sanitized value or null if invalid
   */
  function sanitizeAttribute(attrName, attrValue) {
    if (!attrName || typeof attrName !== 'string') return null;
    if (attrValue === null || attrValue === undefined) return '';

    // Block dangerous attributes
    const dangerousAttrs = ['onload', 'onerror', 'onclick', 'onmouseover'];
    if (dangerousAttrs.some(attr => attrName.toLowerCase().startsWith(attr))) {
      console.warn(`[Security] Blocked dangerous attribute: ${attrName}`);
      return null;
    }

    const valueStr = String(attrValue);

    // Special handling for href and src
    if (attrName.toLowerCase() === 'href' || attrName.toLowerCase() === 'src') {
      // Check for javascript protocol (security check, not script URL usage)
      // eslint-disable-next-line no-script-url
      if (valueStr.toLowerCase().startsWith('javascript:')) {
        console.warn(`[Security] Blocked javascript protocol in ${attrName}`);
        return null;
      }
      if (
        valueStr.toLowerCase().startsWith('data:') &&
        !valueStr.toLowerCase().startsWith('data:image/')
      ) {
        console.warn(`[Security] Blocked non-image data: URI in ${attrName}`);
        return null;
      }
    }

    return valueStr;
  }

  /**
   * Set attribute safely with validation
   * @param {HTMLElement} element - Target element
   * @param {string} attrName - Attribute name
   * @param {string} attrValue - Attribute value
   * @returns {boolean} Success status
   */
  function setAttributeSafe(element, attrName, attrValue) {
    if (!element || !(element instanceof HTMLElement)) {
      console.error('[Security] Invalid element for setAttributeSafe');
      return false;
    }

    const sanitizedValue = sanitizeAttribute(attrName, attrValue);
    if (sanitizedValue === null) return false;

    try {
      element.setAttribute(attrName, sanitizedValue);
      return true;
    } catch (error) {
      console.error('[Security] setAttribute failed:', error);
      return false;
    }
  }

  /**
   * Validate number is within safe range
   * @param {*} value - Value to validate
   * @param {number} min - Minimum allowed value
   * @param {number} max - Maximum allowed value
   * @returns {number|null} Validated number or null if invalid
   */
  function validateNumber(value, min = -Infinity, max = Infinity) {
    const num = Number(value);
    if (isNaN(num) || !isFinite(num)) return null;
    if (num < min || num > max) return null;
    return num;
  }

  /**
   * Rate limiter for preventing abuse
   */
  class RateLimiter {
    constructor(maxRequests = 10, timeWindow = 60000) {
      this.maxRequests = maxRequests;
      this.timeWindow = timeWindow;
      this.requests = new Map();
    }

    /**
     * Check if request is allowed
     * @param {string} key - Request identifier
     * @returns {boolean} Whether request is allowed
     */
    canRequest(key) {
      const now = Date.now();
      const requests = this.requests.get(key) || [];

      // Remove old requests outside time window
      const recentRequests = requests.filter(time => now - time < this.timeWindow);

      if (recentRequests.length >= this.maxRequests) {
        console.warn(
          `[Security] Rate limit exceeded for ${key}. Max ${this.maxRequests} requests per ${this.timeWindow}ms.`
        );
        return false;
      }

      recentRequests.push(now);
      this.requests.set(key, recentRequests);
      return true;
    }

    /**
     * Clear rate limiter state
     */
    clear() {
      this.requests.clear();
    }
  }

  /**
   * Create fetch with timeout wrapper
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @param {number} timeout - Timeout in milliseconds (default: 10000)
   * @returns {Promise<Response>} Fetch promise with timeout
   */
  function fetchWithTimeout(url, options = {}, timeout = 10000) {
    return Promise.race([
      fetch(url, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), timeout)),
    ]);
  }

  /**
   * Validate JSON response structure
   * @param {Object} data - JSON data to validate
   * @param {Object} schema - Expected schema (simple validation)
   * @returns {boolean} True if valid
   */
  function validateJSONSchema(data, schema) {
    if (!data || typeof data !== 'object') return false;
    if (!schema || typeof schema !== 'object') return true;

    for (const key in schema) {
      if (schema[key].required && !(key in data)) {
        console.warn(`[Security] Missing required field: ${key}`);
        return false;
      }
      if (key in data && schema[key].type && typeof data[key] !== schema[key].type) {
        console.warn(
          `[Security] Invalid type for field ${key}: expected ${schema[key].type}, got ${typeof data[key]}`
        );
        return false;
      }
    }
    return true;
  }

  // Export utilities to window for use across modules
  if (typeof window !== 'undefined') {
    window.YouTubeSecurityUtils = {
      isValidVideoId,
      isValidChannelId,
      isYouTubeUrl,
      sanitizeText,
      escapeHtml,
      createSafeHTML,
      setInnerHTMLSafe,
      setTextContentSafe,
      sanitizeAttribute,
      setAttributeSafe,
      validateNumber,
      RateLimiter,
      fetchWithTimeout,
      validateJSONSchema,
    };
  }
})();
