/**
 * @fileoverview Channel stats fetching helpers - Extracted from stats.js
 * Reduces complexity of fetchChannelStats function
 */

/**
 * Parse subscriber count string with K/M/B suffixes
 * @param {string} countText - Text containing count (e.g., "1.5M" or "1,234K")
 * @returns {number} Parsed count as number
 */
const parseSubscriberCount = countText => {
  const subMatch = countText.match(/[\d,\.]+[KMB]?/);
  if (!subMatch) return 0;

  const raw = subMatch[0].replace(/,/g, '');
  const numCount = Number(raw.replace(/[KMB]/, '')) || 0;

  if (raw.includes('K')) {
    return Math.floor(numCount * 1000);
  }
  if (raw.includes('M')) {
    return Math.floor(numCount * 1000000);
  }
  if (raw.includes('B')) {
    return Math.floor(numCount * 1000000000);
  }

  return Math.floor(numCount);
};

/**
 * Try to extract subscriber count from page DOM
 * @returns {number} Subscriber count or 0 if not found
 */
const extractSubscriberCountFromPage = () => {
  const subCountSelectors = [
    '#subscriber-count',
    '.yt-subscription-button-subscriber-count-branded-horizontal',
    '[id*="subscriber"]',
    '.ytd-subscribe-button-renderer',
  ];

  for (const selector of subCountSelectors) {
    const subCountElem = document.querySelector(selector);
    if (subCountElem) {
      const subText = subCountElem.textContent || subCountElem.innerText || '';
      const count = parseSubscriberCount(subText);
      if (count > 0) {
        return count;
      }
    }
  }

  return 0;
};

/**
 * Create fallback stats object
 * @param {number} followerCount - Extracted follower count
 * @returns {Object} Fallback stats object
 */
const createFallbackStats = followerCount => ({
  followerCount,
  bottomOdos: [0, 0],
  error: true,
  timestamp: Date.now(),
});

/**
 * Validate stats response structure
 * @param {Object} stats - Stats response to validate
 * @returns {boolean} Whether stats are valid
 */
const isValidStatsResponse = stats => {
  return stats && typeof stats.followerCount !== 'undefined';
};

/**
 * Get cached stats if recent enough
 * @param {Map} cache - Cache map
 * @param {string} channelId - Channel ID
 * @param {number} cacheDuration - Cache duration in milliseconds
 * @param {Object} utils - Utilities object with log function
 * @returns {Object|null} Cached stats or null
 */
const getCachedStats = (cache, channelId, cacheDuration, utils) => {
  if (!cache.has(channelId)) return null;

  const cached = cache.get(channelId);
  const isRecent = Date.now() - cached.timestamp < cacheDuration;

  if (isRecent) {
    utils.log('Using cached stats for channel:', channelId);
    return cached;
  }

  return null;
};

/**
 * Perform retry with exponential backoff
 * @param {number} retryNumber - Current retry number (1-indexed)
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<void>}
 */
const exponentialBackoff = (retryNumber, maxRetries) => {
  const delay = 1000 * (maxRetries - retryNumber + 2);
  return new Promise(resolve => setTimeout(resolve, delay));
};

/**
 * Attempt to fetch stats with retry logic
 * @param {Function} fetchFn - Fetch function
 * @param {number} maxRetries - Maximum retries
 * @param {Object} utils - Utilities object
 * @returns {Promise<Object|null>} Stats or null if all retries failed
 */
const fetchWithRetry = async (fetchFn, maxRetries, utils) => {
  let retries = maxRetries;

  while (retries > 0) {
    try {
      const stats = await fetchFn();

      // Validate response structure
      if (!isValidStatsResponse(stats)) {
        throw new Error('Invalid stats response structure');
      }

      return stats;
    } catch (e) {
      utils.warn('Fetch attempt failed:', e.message);
      retries--;

      if (retries > 0) {
        await exponentialBackoff(retries, maxRetries);
      }
    }
  }

  return null;
};

/**
 * Cache successful stats response
 * @param {Map} cache - Cache map
 * @param {string} channelId - Channel ID
 * @param {Object} stats - Stats to cache
 */
const cacheStats = (cache, channelId, stats) => {
  cache.set(channelId, {
    ...stats,
    timestamp: Date.now(),
  });
};

// Export helpers for use in stats.js
if (typeof window !== 'undefined') {
  window.YouTubePlusChannelStatsHelpers = {
    parseSubscriberCount,
    extractSubscriberCountFromPage,
    createFallbackStats,
    isValidStatsResponse,
    getCachedStats,
    exponentialBackoff,
    fetchWithRetry,
    cacheStats,
  };
}
