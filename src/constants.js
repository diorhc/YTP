/**
 *
 * @fileoverview Centralized constants for the YouTube Plus userscript
 * @author diorhc
 * @version 2.2
 *
 */

/**
 * Module names for logging - optimized for size
 * @type {Object.<string, string>}
 */
const MODULE_PREFIX = '[YouTube+]';
const MODULE_NAMES = {
  ADBLOCKER: `${MODULE_PREFIX}[Ad]`,
  BASIC: `${MODULE_PREFIX}[B]`,
  COMMENT: `${MODULE_PREFIX}[C]`,
  ENHANCED: `${MODULE_PREFIX}[E]`,
  ERROR_BOUNDARY: `${MODULE_PREFIX}[Err]`,
  I18N: `${MODULE_PREFIX}[i18n]`,
  MAIN: `${MODULE_PREFIX}[Main]`,
  MUSIC: `${MODULE_PREFIX}[Mus]`,
  PERFORMANCE: `${MODULE_PREFIX}[Perf]`,
  PIP: `${MODULE_PREFIX}[PIP]`,
  PLAYLIST_SEARCH: `${MODULE_PREFIX}[PL]`,
  REPORT: `${MODULE_PREFIX}[Rep]`,
  SHORTS: `${MODULE_PREFIX}[S]`,
  STATS: `${MODULE_PREFIX}[St]`,
  STYLE: `${MODULE_PREFIX}[Sty]`,
  THUMBNAIL: `${MODULE_PREFIX}[Th]`,
  TIMECODE: `${MODULE_PREFIX}[TC]`,
  UPDATE: `${MODULE_PREFIX}[Upd]`,
  UTILS: `${MODULE_PREFIX}[U]`,
};

/**
 * Download site URLs for video downloading features
 * @type {Object.<string, {name: string, url: string}>}
 */
const DOWNLOAD_SITES = {
  Y2MATE: {
    name: 'Y2Mate',
    url: 'https://www.y2mate.com/youtube/{videoId}',
  },
};

/**
 * SVG namespace for creating SVG elements
 * @type {string}
 * @const
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Common CSS selectors used across modules
 * @type {Object.<string, string>}
 */
const SELECTORS = {
  VIDEO_PLAYER: '.html5-video-player',
  VIDEO_ELEMENT: 'video',
  PLAYER_CONTAINER: '#movie_player',
  PRIMARY: '#primary',
  SECONDARY: '#secondary',
  COMMENTS: '#comments',
  DESCRIPTION: '#description',
  TITLE: 'h1.ytd-watch-metadata',
  CHANNEL_NAME: 'ytd-channel-name',
  SUBSCRIBE_BUTTON: '#subscribe-button',
  LIKE_BUTTON: 'like-button-view-model',
};

/**
 * Common CSS class names
 * @type {Object.<string, string>}
 */
const CLASS_NAMES = {
  YTP_BUTTON: 'ytp-button',
  YTP_SETTINGS_BUTTON: 'ytp-settings-button',
  HIDDEN: 'hidden',
  ACTIVE: 'active',
};

/**
 * LocalStorage keys for persisting settings
 * @type {Object.<string, string>}
 */
const STORAGE_KEYS = {
  SETTINGS: 'youtube_plus_settings',
  TIMECODE_SETTINGS: 'youtube_timecode_settings',
  COMMENT_SETTINGS: 'youtube_comment_manager_settings',
  THEME: 'youtube_plus_theme',
  LANGUAGE: 'youtube_plus_language',
};

/**
 * API endpoints and external URLs
 * @type {Object.<string, string>}
 */
const API_URLS = {
  GITHUB_REPO: 'https://github.com/diorhc/YTP',
  GITHUB_API: 'https://api.github.com/repos/diorhc/YTP/releases/latest',
  GREASYFORK: 'https://greasyfork.org/scripts/YOUR_SCRIPT_ID',
};

/**
 * Timing constants in milliseconds
 * @type {Object.<string, number>}
 */
const TIMING = {
  DEBOUNCE_SHORT: 100,
  DEBOUNCE_MEDIUM: 250,
  DEBOUNCE_LONG: 500,
  THROTTLE: 100,
  ANIMATION_DURATION: 300,
  TOAST_DURATION: 3000,
  RETRY_DELAY: 1000,
  OBSERVER_DELAY: 100,
};

/**
 * Feature limits and thresholds
 * @type {Object.<string, number>}
 */
const LIMITS = {
  MAX_PLAYLIST_ITEMS: 5000,
  MAX_COMMENT_LENGTH: 10000,
  MAX_TITLE_LENGTH: 100,
  MAX_DESCRIPTION_LENGTH: 500,
  MAX_RETRIES: 3,
  RATE_LIMIT_REQUESTS: 10,
  RATE_LIMIT_WINDOW: 60000, // 1 minute
};

/**
 * Standard error messages for consistency
 * @type {Object.<string, string>}
 */
const ERROR_MESSAGES = {
  INVALID_KEY: 'Key must be a non-empty string',
  OBSERVER_DISCONNECT_FAILED: 'Observer disconnect failed',
  FETCH_FAILED: 'Failed to fetch data',
  INVALID_VIDEO_ID: 'Invalid video ID',
  STORAGE_FAILED: 'Failed to save to localStorage',
  PARSE_FAILED: 'Failed to parse JSON',
};

/**
 * Regular expressions for parsing YouTube URLs
 * @type {Object.<string, RegExp>}
 */
const URL_PATTERNS = {
  VIDEO_ID: /[?&]v=([^&]+)/,
  PLAYLIST_ID: /[?&]list=([^&]+)/,
  SHORTS: /\/shorts\/([^/?]+)/,
  TIMESTAMP: /[?&]t=(\d+)/,
  CHANNEL_ID: /\/(channel|c|user)\/([^/?]+)/,
};

/**
 * UI element identifiers and class names
 * @type {Object.<string, string>}
 */
const UI_IDS = {
  // Download button
  DOWNLOAD_BUTTON: '.ytp-download-button',

  // Scroll to top buttons
  RIGHT_TABS_TOP_BUTTON: 'right-tabs-top-button',
  UNIVERSAL_TOP_BUTTON: 'universal-top-button',
  PLAYLIST_PANEL_TOP_BUTTON: 'playlist-panel-top-button',
  YTMUSIC_SIDE_PANEL_TOP_BUTTON: 'ytmusic-side-panel-top-button',

  // Stats menu
  STATS_MENU_CONTAINER: '.stats-menu-container',

  // Timecode
  TIMECODE_PANEL: 'ytplus-timecode-panel',

  // Thumbnail
  THUMBNAIL_STYLES: 'ytplus-thumbnail-styles',
  THUMBNAIL_MODAL_ACTION_BTN: 'thumbnail-modal-action-btn',

  // Settings
  SETTINGS_NAV_ITEM: 'ytp-plus-settings-nav-item',
};

/**
 * SVG icons used across the application
 * @type {Object.<string, string>}
 */
const SVG_ICONS = {
  ARROW_UP:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
  SETTINGS:
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>',
};

/**
 * Storage key prefixes for different features
 * @type {Object.<string, string>}
 */
const STORAGE_PREFIXES = {
  TIMECODE: 'youtube_timecode_',
  COMMENT: 'youtube_comment_',
  SETTINGS: 'youtubeEnhancer',
};

/**
 * Export all constants to global window object for cross-module access
 * @global
 */
if (typeof window !== 'undefined') {
  window.YouTubePlusConstants = {
    MODULE_NAMES,
    DOWNLOAD_SITES,
    SVG_NS,
    SELECTORS,
    CLASS_NAMES,
    STORAGE_KEYS,
    API_URLS,
    TIMING,
    LIMITS,
    ERROR_MESSAGES,
    URL_PATTERNS,
    UI_IDS,
    SVG_ICONS,
    STORAGE_PREFIXES,
  };
}
