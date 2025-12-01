/**
 * Validation Utility Module
 * Shared utilities for input validation and sanitization
 */

window.YouTubePlusValidationUtils = (() => {
  'use strict';

  /**
   * Validate URL
   * @param {string} url - URL to validate
   * @returns {boolean}
   */
  const isValidURL = url => {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  /**
   * Validate email address
   * @param {string} email - Email to validate
   * @returns {boolean}
   */
  const isValidEmail = email => {
    if (typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  /**
   * Validate YouTube video ID
   * @param {string} videoId - Video ID to validate
   * @returns {boolean}
   */
  const isValidVideoId = videoId => {
    if (typeof videoId !== 'string') return false;
    return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
  };

  /**
   * Validate YouTube playlist ID
   * @param {string} playlistId - Playlist ID to validate
   * @returns {boolean}
   */
  const isValidPlaylistId = playlistId => {
    if (typeof playlistId !== 'string') return false;
    return /^[a-zA-Z0-9_-]+$/.test(playlistId);
  };

  /**
   * Sanitize HTML string
   * @param {string} html - HTML to sanitize
   * @returns {string}
   */
  const sanitizeHTML = html => {
    if (typeof html !== 'string') return '';
    return html.replace(/[<>&"'\/`=]/g, char => {
      const entities = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;',
      };
      return entities[char] || char;
    });
  };

  /**
   * Sanitize filename
   * @param {string} filename - Filename to sanitize
   * @returns {string}
   */
  const sanitizeFilename = filename => {
    if (typeof filename !== 'string') return '';
    return filename.replace(/[^a-z0-9_\-\.]/gi, '_').substring(0, 255);
  };

  /**
   * Validate and parse number
   * @param {any} value - Value to parse
   * @param {number} defaultValue - Default value if invalid
   * @param {Object} options - Options for validation
   * @returns {number}
   */
  const parseNumber = (value, defaultValue = 0, options = {}) => {
    const { min = -Infinity, max = Infinity, integer = false } = options;

    const num = Number(value);
    if (isNaN(num)) return defaultValue;

    let result = Math.max(min, Math.min(max, num));
    if (integer) result = Math.floor(result);

    return result;
  };

  /**
   * Validate object has required properties
   * @param {Object} obj - Object to validate
   * @param {string[]} requiredProps - Required property names
   * @returns {boolean}
   */
  const hasRequiredProps = (obj, requiredProps) => {
    if (!obj || typeof obj !== 'object') return false;
    return requiredProps.every(prop => prop in obj);
  };

  /**
   * Validate string is not empty
   * @param {string} str - String to validate
   * @returns {boolean}
   */
  const isNonEmptyString = str => {
    return typeof str === 'string' && str.trim().length > 0;
  };

  /**
   * Validate array is not empty
   * @param {any} arr - Array to validate
   * @returns {boolean}
   */
  const isNonEmptyArray = arr => {
    return Array.isArray(arr) && arr.length > 0;
  };

  /**
   * Validate color string (hex, rgb, rgba)
   * @param {string} color - Color string to validate
   * @returns {boolean}
   */
  const isValidColor = color => {
    if (typeof color !== 'string') return false;

    // Hex color
    if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) return true;

    // RGB/RGBA
    if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(color)) return true;

    // Named colors (basic validation)
    const namedColors = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'transparent'];
    return namedColors.includes(color.toLowerCase());
  };

  /**
   * Validate timestamp format (HH:MM:SS or MM:SS)
   * @param {string} timestamp - Timestamp to validate
   * @returns {boolean}
   */
  const isValidTimestamp = timestamp => {
    if (typeof timestamp !== 'string') return false;
    return /^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(timestamp);
  };

  /**
   * Parse timestamp to seconds
   * @param {string} timestamp - Timestamp (HH:MM:SS or MM:SS or SS)
   * @returns {number} Seconds
   */
  const parseTimestamp = timestamp => {
    if (!isValidTimestamp(timestamp) && !/^\d+$/.test(timestamp)) return 0;

    const parts = String(timestamp).split(':').map(Number);

    if (parts.length === 1) return parts[0]; // Seconds only
    if (parts.length === 2) return parts[0] * 60 + parts[1]; // MM:SS
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS

    return 0;
  };

  /**
   * Format seconds to timestamp
   * @param {number} seconds - Seconds
   * @param {boolean} includeHours - Include hours even if 0
   * @returns {string} Formatted timestamp
   */
  const formatTimestamp = (seconds, includeHours = false) => {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '0:00';

    const validSeconds = Math.max(0, Math.floor(seconds));

    const hours = Math.floor(validSeconds / 3600);
    const minutes = Math.floor((validSeconds % 3600) / 60);
    const secs = validSeconds % 60;

    const pad = num => String(num).padStart(2, '0');

    if (hours > 0 || includeHours) {
      return `${hours}:${pad(minutes)}:${pad(secs)}`;
    }

    return `${minutes}:${pad(secs)}`;
  };

  /**
   * Validate quality string
   * @param {string} quality - Quality string to validate
   * @returns {boolean}
   */
  const isValidQuality = quality => {
    if (typeof quality !== 'string') return false;
    const validQualities = [
      '144p',
      '240p',
      '360p',
      '480p',
      '720p',
      '1080p',
      '1440p',
      '2160p',
      'auto',
    ];
    return validQualities.includes(quality.toLowerCase());
  };

  /**
   * Clamp value between min and max
   * @param {number} value - Value to clamp
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number}
   */
  const clamp = (value, min, max) => {
    return Math.max(min, Math.min(max, value));
  };

  // Public API
  return {
    isValidURL,
    isValidEmail,
    isValidVideoId,
    isValidPlaylistId,
    sanitizeHTML,
    sanitizeFilename,
    parseNumber,
    hasRequiredProps,
    isNonEmptyString,
    isNonEmptyArray,
    isValidColor,
    isValidTimestamp,
    parseTimestamp,
    formatTimestamp,
    isValidQuality,
    clamp,
  };
})();
