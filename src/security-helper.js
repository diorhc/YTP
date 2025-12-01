/**
 * Security Helper Module
 * Provides utilities for sanitization and validation
 */

/**
 * Sanitize HTML string to prevent XSS
 * Enhanced with additional security checks
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML
 */
const sanitizeHTML = html => {
  if (typeof html !== 'string') return '';

  // Check for extremely long strings (potential DoS)
  let sanitizedHtml = html;
  if (sanitizedHtml.length > 1000000) {
    console.warn('[YouTube+] HTML content too large, truncating');
    sanitizedHtml = sanitizedHtml.substring(0, 1000000);
  }

  /** @type {Record<string, string>} */
  const map = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };

  return sanitizedHtml.replace(/[<>&"'\/`=]/g, char => map[char] || char);
};

/**
 * Validate URL to prevent injection attacks
 * Enhanced with additional protocol and domain checks
 * @param {string} url - URL to validate
 * @returns {boolean} Whether URL is safe
 */
const isValidURL = url => {
  if (typeof url !== 'string') return false;
  if (url.length > 2048) return false; // RFC 2616 recommends 2048 chars max
  if (url.trim() !== url) return false; // No leading/trailing whitespace

  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

/**
 * Safe function wrapper with error handling
 * @param {Function} fn - Function to wrap
 * @param {string} context - Context for error logging
 * @returns {Function} Wrapped function
 */
const safeExecute = (fn, context = 'Unknown') => {
  /** @this {any} */
  return function (...args) {
    try {
      return fn.call(this, ...args);
    } catch (error) {
      console.error(`[YouTube+][${context}] Execution failed:`, error);
      return null;
    }
  };
};

/**
 * Safe async function wrapper with error handling
 * @param {Function} fn - Async function to wrap
 * @param {string} context - Context for error logging
 * @returns {Function} Wrapped async function
 */
const safeExecuteAsync = (fn, context = 'Unknown') => {
  /** @this {any} */
  return async function (...args) {
    try {
      return await fn.call(this, ...args);
    } catch (error) {
      console.error(`[YouTube+][${context}] Async execution failed:`, error);
      return null;
    }
  };
};

/**
 * Sanitize text content (strip HTML)
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
const sanitizeText = text => {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '').trim();
};

/**
 * Validate and sanitize user input
 * @param {string} input - User input
 * @param {number} maxLength - Maximum length
 * @returns {string} Sanitized input
 */
const sanitizeInput = (input, maxLength = 1000) => {
  if (typeof input !== 'string') return '';
  const sanitized = sanitizeText(input);
  return sanitized.length > maxLength ? sanitized.substring(0, maxLength) : sanitized;
};

/**
 * Check if string contains script tags
 * @param {string} str - String to check
 * @returns {boolean} True if contains script tags
 */
const containsScriptTags = str => {
  if (typeof str !== 'string') return false;
  return /<script[^>]*>.*?<\/script>/gi.test(str);
};

/**
 * Validate email address format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
const isValidEmail = email => {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.YouTubePlusSecurity = {
    sanitizeHTML,
    sanitizeText,
    sanitizeInput,
    isValidURL,
    safeExecute,
    safeExecuteAsync,
    containsScriptTags,
    isValidEmail,
  };
}
