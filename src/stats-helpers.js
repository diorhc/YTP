/**
 * Stats Helper Module
 * Extracted helper functions to reduce complexity in stats.js
 */
(function () {
  'use strict';

  /**
   * Extract digits from text string
   * @param {string} text - Text containing numbers
   * @returns {number|null} Extracted number or null
   */
  function extractDigits(text) {
    if (!text || typeof text !== 'string') return null;
    const digits = text.replace(/[^\d]/g, '');
    return digits ? Number(digits) : null;
  }

  /**
   * Find first matching element's text from array of selectors
   * @param {string[]} selectors - Array of CSS selectors
   * @returns {string} Found text or empty string
   */
  function findFirstText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // Prefer aria-label when present
      try {
        const aria = el.getAttribute?.('aria-label');
        if (aria?.trim()) return aria.trim();
      } catch {
        // ignore
      }

      if (el.textContent?.trim()) return el.textContent.trim();
    }
    return '';
  }

  /**
   * Find first matching element's attribute from array of selectors
   * @param {string[]} selectors - Array of CSS selectors
   * @returns {string} Found attribute value or empty string
   */
  function findFirstAttr(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // Common attribute names for images/meta
      const href = el.getAttribute?.('href') || el.getAttribute?.('content');
      if (href) return href;
      if (el.src) return el.src;
    }
    return '';
  }

  /**
   * Try to extract number from aria-label attribute
   * @param {HTMLElement} btn - Toggle button element
   * @returns {number|null} Extracted number or null
   */
  function tryExtractFromAriaLabel(btn) {
    try {
      const ariaEl = btn.querySelector?.('[aria-label]');
      if (!ariaEl) return null;

      const ariaLabel = ariaEl.getAttribute?.('aria-label');
      if (!ariaLabel?.trim()) return null;

      return extractDigits(ariaLabel.trim());
    } catch {
      return null;
    }
  }

  /**
   * Try to extract number from button text content
   * @param {HTMLElement} btn - Toggle button element
   * @returns {number|null} Extracted number or null
   */
  function tryExtractFromButtonText(btn) {
    const anchor = btn.querySelector?.('a');
    const iconBtn = btn.querySelector?.('yt-icon-button');
    const el = anchor || iconBtn || btn;
    const text = el?.textContent?.trim() || '';
    return extractDigits(text);
  }

  /**
   * Extract numeric count from toggle-button renderer element
   * @param {HTMLElement} btn - Toggle button element
   * @returns {number|null} Extracted number or null
   */
  function extractFromToggleButton(btn) {
    if (!btn) return null;

    // Prefer descendant with aria-label
    const fromAria = tryExtractFromAriaLabel(btn);
    if (fromAria !== null) return fromAria;

    // Fallback to button text content
    return tryExtractFromButtonText(btn);
  }

  /**
   * Extract dislike count from toggle button list
   * @returns {number|null} Dislike count or null
   */
  function tryExtractDislikeFromToggles() {
    try {
      const toggleBtns = document.querySelectorAll('ytd-toggle-button-renderer');
      if (toggleBtns?.length > 1) {
        return extractFromToggleButton(toggleBtns[1]);
      }
    } catch {
      // ignore DOM errors
    }
    return null;
  }

  /**
   * Extract views count from page
   * @returns {{views: number|null}} Views object
   */
  function extractViews() {
    const viewsText = findFirstText([
      'ytd-video-view-count-renderer span.view-count',
      'span.view-count',
      'yt-view-count-renderer span',
      'ytd-video-primary-info-renderer #info-strings yt-formatted-string',
    ]);
    const views = extractDigits(viewsText);
    return views === null ? {} : { views };
  }

  /**
   * Extract likes count from page
   * @returns {{likes: number|null}} Likes object
   */
  function extractLikes() {
    const likeBtnSelectors = [
      'ytd-toggle-button-renderer:nth-of-type(1) a',
      '#top-level-buttons-computed ytd-toggle-button-renderer:nth-of-type(1) yt-icon-button',
      'ytd-toggle-button-renderer:nth-of-type(1) yt-formatted-string',
    ];
    const likesText = findFirstText(likeBtnSelectors);
    const likes = extractDigits(likesText);

    if (likes !== null) {
      return { likes };
    }

    // Fallback: check toggle button renderers
    const toggleBtns = document.querySelectorAll('ytd-toggle-button-renderer');
    if (toggleBtns?.length) {
      const likeVal = extractFromToggleButton(toggleBtns[0]);
      if (likeVal !== null) {
        return { likes: likeVal };
      }
    }

    return {};
  }

  /**
   * Extract dislikes count from page
   * @returns {{dislikes: number|null}} Dislikes object
   */
  function extractDislikes() {
    // Try toggle buttons first
    const dislikeCandidate = tryExtractDislikeFromToggles();
    if (dislikeCandidate !== null) {
      return { dislikes: dislikeCandidate };
    }

    // Fallback to second toggle button
    const toggleBtns = document.querySelectorAll('ytd-toggle-button-renderer');
    if (toggleBtns?.length > 1) {
      const dislikeVal = extractFromToggleButton(toggleBtns[1]);
      if (dislikeVal !== null) {
        return { dislikes: dislikeVal };
      }
    }

    return {};
  }

  /**
   * Extract comments count from page
   * @returns {{comments: number|null}} Comments object
   */
  function extractComments() {
    const commentsText = findFirstText([
      '#count > yt-formatted-string',
      'ytd-comments-header-renderer #count',
    ]);
    const comments = extractDigits(commentsText);
    return comments === null ? {} : { comments };
  }

  /**
   * Extract subscribers count from page
   * @returns {{subscribers: number|null}} Subscribers object
   */
  function extractSubscribers() {
    const subsText = findFirstText(['#subscriber-count', 'yt-formatted-string#owner-sub-count']);
    const subscribers = extractDigits(subsText);
    return subscribers === null ? {} : { subscribers };
  }

  /**
   * Extract thumbnail URL from page metadata
   * @returns {{thumbnail: string}} Thumbnail object
   */
  function extractThumbnail() {
    const thumb = findFirstAttr([
      'link[rel="image_src"]',
      'meta[property="og:image"]',
      'meta[name="og:image"]',
      'meta[name="twitter:image"]',
      'meta[itemprop="thumbnailUrl"]',
      'meta[itemprop="image"]',
      '.ytp-thumbnail img',
    ]);
    return thumb ? { thumbnail: thumb } : {};
  }

  /**
   * Extract title from page metadata
   * @returns {{title: string}} Title object
   */
  function extractTitle() {
    const titleMeta = findFirstAttr([
      'meta[property="og:title"]',
      'meta[name="title"]',
      'meta[name="twitter:title"]',
      'meta[itemprop="name"]',
    ]);
    return titleMeta ? { title: titleMeta } : {};
  }

  /**
   * Extract time components from ISO8601 duration match
   * @param {RegExpMatchArray} match - Regex match array
   * @returns {{hours: number, minutes: number, seconds: number}} Time components
   */
  function extractTimeComponents(match) {
    return {
      hours: parseInt(match[1] || '0', 10),
      minutes: parseInt(match[2] || '0', 10),
      seconds: parseInt(match[3] || '0', 10),
    };
  }

  /**
   * Convert time components to total seconds
   * @param {{hours: number, minutes: number, seconds: number}} components - Time components
   * @returns {number} Total seconds
   */
  function convertToSeconds(components) {
    return components.hours * 3600 + components.minutes * 60 + components.seconds;
  }

  /**
   * Parse ISO8601 duration (e.g., PT1H2M3S) to seconds
   * @param {string} iso - ISO8601 duration string
   * @returns {number|null} Duration in seconds or null
   */
  function parseISODuration(iso) {
    if (!iso || typeof iso !== 'string') return null;

    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
    if (!match) return null;

    const components = extractTimeComponents(match);
    return convertToSeconds(components);
  }

  /**
   * Format seconds to HH:MM:SS or MM:SS
   * @param {number} sec - Seconds
   * @returns {string|null} Formatted time string or null
   */
  function formatSeconds(sec) {
    if (!sec || isNaN(Number(sec))) return null;
    const s = Number(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
    return `${m}:${String(ss).padStart(2, '0')}`;
  }

  /**
   * Get duration from meta tags
   * @returns {number|null} Duration in seconds or null
   */
  function getMetaDurationSeconds() {
    const og =
      document.querySelector('meta[property="og:video:duration"]')?.getAttribute('content') ||
      document.querySelector('meta[name="duration"]')?.getAttribute('content');
    if (og && !isNaN(Number(og))) return Number(og);

    const iso = document.querySelector('meta[itemprop="duration"]')?.getAttribute('content');
    if (iso) return parseISODuration(iso);

    return null;
  }

  /**
   * Convert value to number if valid
   * @param {*} v - Value to convert
   * @returns {number|null} Number or null
   */
  function toNumber(v) {
    if (v === undefined || v === null) return null;
    const num = Number(v);
    return isNaN(num) ? null : num;
  }

  /**
   * Get duration from API stats
   * @param {Object} apiStats - API stats object
   * @returns {number|null} Duration in seconds or null
   */
  function getDurationFromAPI(apiStats) {
    if (!apiStats) return null;

    // Try common duration properties
    const candidates = [
      apiStats.duration,
      apiStats.lengthSeconds,
      apiStats.durationSeconds,
      apiStats.videoLength,
    ];

    for (const candidate of candidates) {
      const seconds = toNumber(candidate);
      if (seconds) return seconds;
    }

    return null;
  }

  /**
   * Get duration from player response
   * @returns {number|null} Duration in seconds or null
   */
  function getDurationFromPlayer() {
    try {
      const lengthSeconds = window?.ytInitialPlayerResponse?.videoDetails?.lengthSeconds;
      return toNumber(lengthSeconds);
    } catch {
      return null;
    }
  }

  /**
   * Get duration from various sources
   * @param {Object} apiStats - API stats object
   * @returns {string|null} Formatted duration string or null
   */
  function getDurationFromSources(apiStats) {
    // Try API stats first
    let seconds = getDurationFromAPI(apiStats);

    // Try player response
    if (!seconds) {
      seconds = getDurationFromPlayer();
    }

    // Try metadata as fallback
    if (!seconds) {
      seconds = getMetaDurationSeconds();
    }

    return seconds ? formatSeconds(seconds) : null;
  }

  /**
   * Get country from API stats
   * @param {Object} apiStats - API stats object
   * @returns {string|null} Country code or null
   */
  function getCountryFromAPI(apiStats) {
    if (!apiStats) return null;
    return apiStats.country || apiStats.region || null;
  }

  /**
   * Get countries from player response
   * @returns {string|null} Countries string or null
   */
  function getCountriesFromPlayer() {
    try {
      const countries =
        window?.ytInitialPlayerResponse?.microformat?.playerMicroformatRenderer?.availableCountries;
      if (Array.isArray(countries) && countries.length > 0) {
        return countries.join(', ');
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  /**
   * Get country from various sources
   * @param {Object} apiStats - API stats object
   * @param {Object} pageStats - Page stats object
   * @returns {string|null} Country code or null
   */
  function getCountryFromSources(apiStats, pageStats) {
    // Try API stats first
    const apiCountry = getCountryFromAPI(apiStats);
    if (apiCountry) return apiCountry;

    // Try page stats
    if (pageStats?.country) return pageStats.country;

    // Try player response as fallback
    return getCountriesFromPlayer();
  }

  /**
   * Check if monetization status is defined in API stats
   * @param {Object} apiStats - API stats object
   * @param {Function} t - Translation function
   * @returns {string|null} Monetization status or null
   */
  function checkApiMonetization(apiStats, t) {
    if (apiStats?.monetized !== undefined) {
      return apiStats.monetized ? t('yes') : t('no');
    }
    if (apiStats?.isMonetized !== undefined) {
      return apiStats.isMonetized ? t('yes') : t('no');
    }
    return null;
  }

  /**
   * Check if monetization status is defined in page stats
   * @param {Object} pageStats - Page stats object
   * @param {Function} t - Translation function
   * @returns {string|null} Monetization status or null
   */
  function checkPageMonetization(pageStats, t) {
    if (pageStats?.monetization !== undefined) {
      return pageStats.monetization ? t('yes') : t('no');
    }
    return null;
  }

  /**
   * Check for paid promotion indicators in page content
   * @param {Function} t - Translation function
   * @returns {string|null} Monetization status or null
   */
  function checkPaidPromotion(t) {
    const bodyText = document.body?.innerText || '';
    if (/paid promotion|includes paid promotion|платн/i.test(bodyText)) {
      return t('paidPromotion');
    }
    return null;
  }

  /**
   * Get monetization status from various sources
   * @param {Object} apiStats - API stats object
   * @param {Object} pageStats - Page stats object
   * @param {Function} t - Translation function
   * @returns {string|null} Monetization status or null
   */
  function getMonetizationFromSources(apiStats, pageStats, t = s => s) {
    return (
      checkApiMonetization(apiStats, t) ||
      checkPageMonetization(pageStats, t) ||
      checkPaidPromotion(t) ||
      null
    );
  }

  // Export helpers to global namespace
  if (typeof window !== 'undefined') {
    window.YouTubeStatsHelpers = {
      extractDigits,
      findFirstText,
      findFirstAttr,
      extractFromToggleButton,
      tryExtractDislikeFromToggles,
      extractViews,
      extractLikes,
      extractDislikes,
      extractComments,
      extractSubscribers,
      extractThumbnail,
      extractTitle,
      parseISODuration,
      formatSeconds,
      getMetaDurationSeconds,
      getDurationFromSources,
      getCountryFromSources,
      getMonetizationFromSources,
    };
  }
})();
