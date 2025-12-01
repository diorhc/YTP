/**
 * URL and ID extraction utilities for YouTube+ userscript
 * Provides centralized functions for parsing YouTube URLs and extracting IDs
 * @module url-utils
 * @version 1.0.0
 */

(function () {
  'use strict';

  /**
   * Extract video ID from various YouTube URL formats
   * Supports: watch, embed, shorts, youtu.be, and URL parameters
   * @param {string} [url] - YouTube URL (defaults to current page URL)
   * @returns {string|null} Video ID or null if not found
   */
  /**
   * Try extracting video ID from URL parameters
   * @param {string} url - URL string
   * @returns {string|null} Video ID or null
   */
  const tryExtractFromParams = url => {
    try {
      const urlObj = new URL(url, window.location.origin);
      const vParam = urlObj.searchParams.get('v');
      return vParam && isValidVideoId(vParam) ? vParam : null;
    } catch {
      return null;
    }
  };

  /**
   * Try extracting video ID from URL patterns
   * @param {string} url - URL string
   * @returns {string|null} Video ID or null
   */
  const tryExtractFromPatterns = url => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match?.[1]) return match[1];
    }

    return null;
  };

  const extractVideoId = (url = window.location.href) => {
    if (!url || typeof url !== 'string') return null;

    try {
      // Try URL parameters first (most common case)
      const fromParams = tryExtractFromParams(url);
      if (fromParams) return fromParams;

      // Try pattern matching
      return tryExtractFromPatterns(url);
    } catch (error) {
      console.error('[URLUtils] Error extracting video ID:', error);
      return null;
    }
  };

  /**
   * Extract channel ID or handle from YouTube URL
   * Supports: /channel/, /c/, /@handle, /user/
   * @param {string} [url] - YouTube URL (defaults to current page URL)
   * @returns {Object|null} Object with {type, id} or null
   */
  /**
   * Channel identifier pattern matchers
   */
  const channelPatterns = [
    { type: 'channel', regex: /^\/channel\/([a-zA-Z0-9_-]+)/, prefix: '' },
    { type: 'handle', regex: /^\/@([a-zA-Z0-9_-]+)/, prefix: '@' },
    { type: 'custom', regex: /^\/c\/([a-zA-Z0-9_-]+)/, prefix: '' },
    { type: 'user', regex: /^\/user\/([a-zA-Z0-9_-]+)/, prefix: '' },
  ];

  /**
   * Try to match pathname against a channel pattern
   * @param {string} pathname - URL pathname
   * @param {Object} pattern - Pattern configuration
   * @returns {Object|null} Match result or null
   */
  const tryMatchChannelPattern = (pathname, pattern) => {
    const match = pathname.match(pattern.regex);
    if (match && match[1]) {
      return {
        type: pattern.type,
        id: pattern.prefix ? `${pattern.prefix}${match[1]}` : match[1],
      };
    }
    return null;
  };

  /**
   * Extract channel identifier from YouTube URL
   * @param {string} [url] - YouTube URL (defaults to current page URL)
   * @returns {Object|null} Channel identifier {type, id} or null
   */
  const extractChannelIdentifier = (url = window.location.href) => {
    if (!url || typeof url !== 'string') {
      return null;
    }

    try {
      const urlObj = new URL(url, window.location.origin);
      const { pathname } = urlObj;

      for (const pattern of channelPatterns) {
        const result = tryMatchChannelPattern(pathname, pattern);
        if (result) return result;
      }

      return null;
    } catch (error) {
      console.error('[URLUtils] Error extracting channel identifier:', error);
      return null;
    }
  };

  /**
   * Extract playlist ID from YouTube URL
   * @param {string} [url] - YouTube URL (defaults to current page URL)
   * @returns {string|null} Playlist ID or null
   */
  const extractPlaylistId = (url = window.location.href) => {
    if (!url || typeof url !== 'string') {
      return null;
    }

    try {
      const urlObj = new URL(url, window.location.origin);
      const listParam = urlObj.searchParams.get('list');

      if (listParam && isValidPlaylistId(listParam)) {
        return listParam;
      }

      return null;
    } catch (error) {
      console.error('[URLUtils] Error extracting playlist ID:', error);
      return null;
    }
  };

  /**
   * Extract shorts video ID from URL
   * @param {string} [url] - YouTube URL (defaults to current page URL)
   * @returns {string|null} Shorts video ID or null
   */
  const extractShortsId = (url = window.location.href) => {
    if (!url || typeof url !== 'string') {
      return null;
    }

    try {
      const match = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
      return match && match[1] ? match[1] : null;
    } catch (error) {
      console.error('[URLUtils] Error extracting shorts ID:', error);
      return null;
    }
  };

  /**
   * Validate if string is a valid YouTube video ID (11 characters)
   * @param {string} id - ID to validate
   * @returns {boolean} True if valid video ID
   */
  const isValidVideoId = id => {
    return typeof id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(id);
  };

  /**
   * Validate if string is a valid YouTube playlist ID
   * @param {string} id - ID to validate
   * @returns {boolean} True if valid playlist ID
   */
  const isValidPlaylistId = id => {
    return typeof id === 'string' && /^(PL|FL|UU|LL|RD|OL)[a-zA-Z0-9_-]+$/.test(id);
  };

  /**
   * Validate if string is a valid YouTube channel ID
   * @param {string} id - ID to validate
   * @returns {boolean} True if valid channel ID
   */
  const isValidChannelId = id => {
    return typeof id === 'string' && /^UC[a-zA-Z0-9_-]{22}$/.test(id);
  };

  /**
   * Check if URL is a YouTube watch page
   * @param {string} [url] - URL to check (defaults to current page URL)
   * @returns {boolean} True if watch page
   */
  const isWatchPage = (url = window.location.href) => {
    try {
      const urlObj = new URL(url, window.location.origin);
      return urlObj.pathname === '/watch' && urlObj.searchParams.has('v');
    } catch {
      return false;
    }
  };

  /**
   * Check if URL is a YouTube channel page
   * @param {string} [url] - URL to check (defaults to current page URL)
   * @returns {boolean} True if channel page
   */
  const isChannelPage = (url = window.location.href) => {
    try {
      const urlObj = new URL(url, window.location.origin);
      const { pathname } = urlObj;
      return (
        pathname.startsWith('/channel/') ||
        pathname.startsWith('/@') ||
        pathname.startsWith('/c/') ||
        pathname.startsWith('/user/')
      );
    } catch {
      return false;
    }
  };

  /**
   * Check if URL is a YouTube shorts page
   * @param {string} [url] - URL to check (defaults to current page URL)
   * @returns {boolean} True if shorts page
   */
  const isShortsPage = (url = window.location.href) => {
    try {
      const urlObj = new URL(url, window.location.origin);
      return urlObj.pathname.startsWith('/shorts/');
    } catch {
      return false;
    }
  };

  /**
   * Check if URL is YouTube Studio
   * @param {string} [url] - URL to check (defaults to current page URL)
   * @returns {boolean} True if Studio page
   */
  const isStudioPage = (url = window.location.href) => {
    try {
      const urlObj = new URL(url, window.location.origin);
      return urlObj.hostname === 'studio.youtube.com';
    } catch {
      return false;
    }
  };

  /**
   * Build YouTube watch URL from video ID
   * @param {string} videoId - Video ID
   * @param {Object} [params={}] - Additional URL parameters
   * @returns {string} Full YouTube watch URL
   */
  const buildWatchUrl = (videoId, params = {}) => {
    if (!isValidVideoId(videoId)) {
      throw new Error('Invalid video ID');
    }

    const url = new URL('https://www.youtube.com/watch');
    url.searchParams.set('v', videoId);

    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  };

  /**
   * Build YouTube channel URL from channel identifier
   * @param {string} identifier - Channel ID, handle, or custom name
   * @param {string} [type='channel'] - Type: 'channel', 'handle', 'custom', 'user'
   * @returns {string} Full YouTube channel URL
   */
  const buildChannelUrl = (identifier, type = 'channel') => {
    if (!identifier || typeof identifier !== 'string') {
      throw new Error('Invalid channel identifier');
    }

    const baseUrl = 'https://www.youtube.com';

    switch (type) {
      case 'channel':
        return `${baseUrl}/channel/${identifier}`;
      case 'handle':
        return `${baseUrl}/@${identifier.replace(/^@/, '')}`;
      case 'custom':
        return `${baseUrl}/c/${identifier}`;
      case 'user':
        return `${baseUrl}/user/${identifier}`;
      default:
        throw new Error(`Unknown channel URL type: ${type}`);
    }
  };

  /**
   * Build YouTube thumbnail URL from video ID
   * @param {string} videoId - Video ID
   * @param {string} [quality='hqdefault'] - Thumbnail quality: maxresdefault, sddefault, hqdefault, mqdefault, default
   * @returns {string} Thumbnail URL
   */
  const buildThumbnailUrl = (videoId, quality = 'hqdefault') => {
    if (!isValidVideoId(videoId)) {
      throw new Error('Invalid video ID');
    }

    const validQualities = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default'];
    const q = validQualities.includes(quality) ? quality : 'hqdefault';

    return `https://i.ytimg.com/vi/${videoId}/${q}.jpg`;
  };

  /**
   * Parse URL parameters into object
   * @param {string} [url] - URL to parse (defaults to current page URL)
   * @returns {Object} Object with parameter key-value pairs
   */
  const parseUrlParams = (url = window.location.href) => {
    try {
      const urlObj = new URL(url, window.location.origin);
      const params = {};

      for (const [key, value] of urlObj.searchParams.entries()) {
        params[key] = value;
      }

      return params;
    } catch (error) {
      console.error('[URLUtils] Error parsing URL params:', error);
      return {};
    }
  };

  /**
   * Get current page type
   * @returns {string} Page type: 'watch', 'channel', 'shorts', 'search', 'home', 'studio', 'unknown'
   */
  const getPageType = () => {
    const url = window.location.href;

    if (isStudioPage(url)) return 'studio';
    if (isWatchPage(url)) return 'watch';
    if (isShortsPage(url)) return 'shorts';
    if (isChannelPage(url)) return 'channel';
    if (window.location.pathname === '/results') return 'search';
    if (window.location.pathname === '/' || window.location.pathname === '') return 'home';

    return 'unknown';
  };

  /**
   * Sanitize URL for safe usage (remove tracking params)
   * @param {string} url - URL to sanitize
   * @param {string[]} [removeParams=['feature', 'si', 'kw', 'pp']] - Params to remove
   * @returns {string} Sanitized URL
   */
  const sanitizeUrl = (url, removeParams = ['feature', 'si', 'kw', 'pp']) => {
    try {
      const urlObj = new URL(url, window.location.origin);

      for (const param of removeParams) {
        urlObj.searchParams.delete(param);
      }

      return urlObj.toString();
    } catch (error) {
      console.error('[URLUtils] Error sanitizing URL:', error);
      return url;
    }
  };

  // Export utilities
  const URLUtils = {
    extractVideoId,
    extractChannelIdentifier,
    extractPlaylistId,
    extractShortsId,
    isValidVideoId,
    isValidPlaylistId,
    isValidChannelId,
    isWatchPage,
    isChannelPage,
    isShortsPage,
    isStudioPage,
    buildWatchUrl,
    buildChannelUrl,
    buildThumbnailUrl,
    parseUrlParams,
    getPageType,
    sanitizeUrl,
  };

  // Make available globally
  if (typeof window !== 'undefined') {
    window.YouTubePlusURLUtils = URLUtils;
  }

  // Support module exports
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = URLUtils;
  }
})();
