/**
 * Number formatting utilities for YouTube+ userscript
 * Provides centralized number formatting with localization support
 * @module number-utils
 * @version 1.0.0
 */

(function () {
  'use strict';

  /**
   * Format number with locale-aware thousands separators
   * @param {number|string} num - Number to format
   * @param {string} [locale='en-US'] - Locale for formatting
   * @returns {string} Formatted number string
   */
  const formatNumber = (num, locale = 'en-US') => {
    if (num === null || num === undefined) {
      return '0';
    }

    const parsed = typeof num === 'string' ? parseFloat(num) : num;

    if (Number.isNaN(parsed)) {
      return '0';
    }

    try {
      return new Intl.NumberFormat(locale).format(parsed);
    } catch {
      // Fallback if locale not supported
      return parsed.toLocaleString('en-US');
    }
  };

  /**
   * Format number with compact notation (K, M, B)
   * @param {number|string} num - Number to format
   * @param {number} [decimals=1] - Number of decimal places
   * @param {string} [locale='en-US'] - Locale for formatting
   * @returns {string} Formatted compact number (e.g., "1.2M")
   */
  /**
   * Validate and parse number input
   * @param {number|string} num - Number to parse
   * @returns {number|null} Parsed number or null if invalid
   */
  const parseNumberSafely = num => {
    if (num === null || num === undefined) return null;
    const parsed = typeof num === 'string' ? parseFloat(num) : num;
    return Number.isNaN(parsed) ? null : parsed;
  };

  /**
   * Try formatting with Intl.NumberFormat
   * @param {number} num - Number to format
   * @param {number} decimals - Decimal places
   * @param {string} locale - Locale string
   * @returns {string|null} Formatted string or null
   */
  const tryIntlFormat = (num, decimals, locale) => {
    if (typeof Intl === 'undefined' || !Intl.NumberFormat) return null;

    try {
      return new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: decimals,
      }).format(num);
    } catch {
      return null;
    }
  };

  /**
   * Manual compact number formatting
   * @param {number} num - Number to format
   * @param {number} decimals - Decimal places
   * @returns {string} Formatted string
   */
  const formatCompactManual = (num, decimals) => {
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(decimals)}B`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(decimals)}M`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(decimals)}K`;

    return num.toString();
  };

  const formatCompactNumber = (num, decimals = 1, locale = 'en-US') => {
    const parsed = parseNumberSafely(num);
    if (parsed === null) return '0';

    const intlResult = tryIntlFormat(parsed, decimals, locale);
    if (intlResult) return intlResult;

    return formatCompactManual(parsed, decimals);
  };

  /**
   * Format number with full compact notation (with exact value)
   * @param {number|string} num - Number to format
   * @param {number} [decimals=1] - Number of decimal places for compact form
   * @returns {Object} Object with {short, full} properties
   */
  const formatNumberWithExact = (num, decimals = 1) => {
    const full = formatNumber(num);
    const short = formatCompactNumber(num, decimals);

    return { short, full };
  };

  /**
   * Format bytes to human-readable size
   * @param {number} bytes - Bytes to format
   * @param {number} [decimals=2] - Number of decimal places
   * @returns {string} Formatted size (e.g., "1.23 MB")
   */
  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0 || bytes === null || bytes === undefined) {
      return '0 Bytes';
    }

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));

    return `${size} ${sizes[i]}`;
  };

  /**
   * Format duration in seconds to time string
   * @param {number} seconds - Duration in seconds
   * @param {boolean} [includeHours=false] - Force include hours even if zero
   * @returns {string} Formatted time (e.g., "1:23:45" or "23:45")
   */
  const formatDuration = (seconds, includeHours = false) => {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
      return '0:00';
    }

    const totalSeconds = Math.floor(Math.abs(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const parts = [];

    if (hours > 0 || includeHours) {
      parts.push(hours.toString());
      parts.push(minutes.toString().padStart(2, '0'));
    } else {
      parts.push(minutes.toString());
    }

    parts.push(secs.toString().padStart(2, '0'));

    return parts.join(':');
  };

  /**
   * Parse duration string to seconds
   * @param {string} duration - Duration string (e.g., "1:23:45", "PT1H23M45S")
   * @returns {number} Duration in seconds
   */
  const parseDuration = duration => {
    if (!duration || typeof duration !== 'string') {
      return 0;
    }

    // Handle ISO 8601 duration format (PT1H23M45S)
    if (duration.startsWith('PT')) {
      const hoursMatch = duration.match(/(\d+)H/);
      const minutesMatch = duration.match(/(\d+)M/);
      const secondsMatch = duration.match(/(\d+)S/);

      const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
      const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
      const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;

      return hours * 3600 + minutes * 60 + seconds;
    }

    // Handle time string format (1:23:45 or 23:45)
    const parts = duration.split(':').map(p => parseInt(p, 10));

    if (parts.some(p => Number.isNaN(p))) {
      return 0;
    }

    if (parts.length === 3) {
      // Hours:minutes:seconds
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      // Minutes:seconds
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 1) {
      // Just seconds
      return parts[0];
    }

    return 0;
  };

  /**
   * Format percentage with specified decimals
   * @param {number} value - Value to format as percentage
   * @param {number} [decimals=1] - Number of decimal places
   * @returns {string} Formatted percentage (e.g., "75.5%")
   */
  const formatPercentage = (value, decimals = 1) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '0%';
    }

    return `${value.toFixed(decimals)}%`;
  };

  /**
   * Format ratio as percentage
   * @param {number} numerator - Numerator
   * @param {number} denominator - Denominator
   * @param {number} [decimals=1] - Number of decimal places
   * @returns {string} Formatted percentage
   */
  const formatRatioAsPercentage = (numerator, denominator, decimals = 1) => {
    if (!denominator || denominator === 0) {
      return '0%';
    }

    const percentage = (numerator / denominator) * 100;
    return formatPercentage(percentage, decimals);
  };

  /**
   * Clamp number between min and max
   * @param {number} value - Value to clamp
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number} Clamped value
   */
  const clamp = (value, min, max) => {
    return Math.min(Math.max(value, min), max);
  };

  /**
   * Parse number from string with fallback
   * @param {string|number} value - Value to parse
   * @param {number} [defaultValue=0] - Default value if parsing fails
   * @returns {number} Parsed number or default
   */
  const parseNumber = (value, defaultValue = 0) => {
    if (typeof value === 'number') {
      return Number.isNaN(value) ? defaultValue : value;
    }

    if (typeof value !== 'string') {
      return defaultValue;
    }

    // Remove non-numeric characters except decimal point and minus
    const cleaned = value.replace(/[^\d.-]/g, '');
    const parsed = parseFloat(cleaned);

    return Number.isNaN(parsed) ? defaultValue : parsed;
  };

  /**
   * Format number as ordinal (1st, 2nd, 3rd, etc.)
   * @param {number} num - Number to format
   * @param {string} [locale='en'] - Locale for formatting
   * @returns {string} Formatted ordinal number
   */
  /**
   * Parse number for ordinal formatting
   * @param {string|number} num - Number to parse
   * @returns {number} Parsed number
   */
  const parseOrdinalNumber = num => {
    const parsed = typeof num === 'string' ? parseInt(num, 10) : num;
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  /**
   * Get ordinal suffix using Intl.PluralRules
   * @param {number} num - Number to format
   * @param {string} locale - Locale string
   * @returns {string|null} Ordinal string or null if failed
   */
  const getIntlOrdinal = (num, locale) => {
    if (typeof Intl === 'undefined' || !Intl.PluralRules) return null;

    try {
      const pr = new Intl.PluralRules(locale, { type: 'ordinal' });
      const rule = pr.select(num);

      const suffixes = {
        one: 'st',
        two: 'nd',
        few: 'rd',
        other: 'th',
      };

      return `${num}${suffixes[rule] || 'th'}`;
    } catch {
      return null;
    }
  };

  /**
   * Get English ordinal suffix
   * @param {number} num - Number to format
   * @returns {string} Ordinal suffix
   */
  const getEnglishOrdinalSuffix = num => {
    const j = num % 10;
    const k = num % 100;

    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
  };

  /**
   * Format number as ordinal (1st, 2nd, 3rd, etc.)
   * @param {number|string} num - Number to format
   * @param {string} [locale='en'] - Locale for formatting
   * @returns {string} Formatted ordinal string
   */
  const formatOrdinal = (num, locale = 'en') => {
    const parsed = parseOrdinalNumber(num);
    if (parsed === 0) return '0';

    // Try Intl.PluralRules first
    const intlResult = getIntlOrdinal(parsed, locale);
    if (intlResult) return intlResult;

    // Fallback to English ordinals
    return `${parsed}${getEnglishOrdinalSuffix(parsed)}`;
  };

  /**
   * Format number with units (e.g., "5 videos", "1 video")
   * @param {number} count - Count value
   * @param {string} singular - Singular unit name
   * @param {string} [plural] - Plural unit name (defaults to singular + 's')
   * @returns {string} Formatted count with unit
   */
  const formatWithUnit = (count, singular, plural = null) => {
    const formatted = formatNumber(count);
    const unit = count === 1 ? singular : plural || `${singular}s`;
    return `${formatted} ${unit}`;
  };

  // Export utilities
  const NumberUtils = {
    formatNumber,
    formatCompactNumber,
    formatNumberWithExact,
    formatBytes,
    formatDuration,
    parseDuration,
    formatPercentage,
    formatRatioAsPercentage,
    clamp,
    parseNumber,
    formatOrdinal,
    formatWithUnit,
  };

  // Make available globally
  if (typeof window !== 'undefined') {
    window.YouTubePlusNumberUtils = NumberUtils;
  }

  // Support module exports
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NumberUtils;
  }
})();
