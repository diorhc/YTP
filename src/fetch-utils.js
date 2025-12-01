/**
 * Fetch utilities for YouTube+ userscript
 * Provides centralized fetch functionality with timeout, retry, and error handling
 * @module fetch-utils
 * @version 1.0.0
 */

(function () {
  'use strict';

  /**
   * Default timeout for fetch requests (milliseconds)
   * @const {number}
   */
  const DEFAULT_TIMEOUT = 10000;

  /**
   * Default maximum retry attempts
   * @const {number}
   */
  const DEFAULT_MAX_RETRIES = 3;

  /**
   * Default base delay for exponential backoff (milliseconds)
   * @const {number}
   */
  const DEFAULT_BASE_DELAY = 1000;

  /**
   * Fetch with timeout support using AbortController
   * @param {string} url - URL to fetch
   * @param {Object} [options={}] - Fetch options
   * @param {number} [timeoutMs=DEFAULT_TIMEOUT] - Timeout in milliseconds
   * @returns {Promise<Response>} Fetch response
   * @throws {Error} On timeout or fetch failure
   */
  const fetchWithTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  };

  /**
   * Fetch with retry logic and exponential backoff
   * @param {string} url - URL to fetch
   * @param {Object} [options={}] - Fetch options
   * @param {number} [maxRetries=DEFAULT_MAX_RETRIES] - Maximum retry attempts
   * @param {number} [baseDelay=DEFAULT_BASE_DELAY] - Base delay for exponential backoff
   * @param {number} [timeoutMs=DEFAULT_TIMEOUT] - Timeout per attempt
   * @returns {Promise<Response>} Fetch response
   * @throws {Error} After all retries exhausted
   */
  const fetchWithRetry = async (
    url,
    options = {},
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelay = DEFAULT_BASE_DELAY,
    timeoutMs = DEFAULT_TIMEOUT
  ) => {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetchWithTimeout(url, options, timeoutMs);

        // Check if response is OK (status 200-299)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return response;
      } catch (error) {
        lastError = error;

        // Don't retry on last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 0.3 * delay; // Add 0-30% jitter
        const totalDelay = delay + jitter;

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, totalDelay));
      }
    }

    throw new Error(
      `Failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`
    );
  };

  /**
   * Fetch JSON with automatic parsing and error handling
   * @param {string} url - URL to fetch
   * @param {Object} [options={}] - Fetch options
   * @param {number} [timeoutMs=DEFAULT_TIMEOUT] - Timeout in milliseconds
   * @returns {Promise<any>} Parsed JSON response
   * @throws {Error} On fetch failure or JSON parsing error
   */
  const fetchJSON = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT) => {
    const response = await fetchWithTimeout(url, options, timeoutMs);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('Response is not JSON');
    }

    return response.json();
  };

  /**
   * Fetch text with timeout support
   * @param {string} url - URL to fetch
   * @param {Object} [options={}] - Fetch options
   * @param {number} [timeoutMs=DEFAULT_TIMEOUT] - Timeout in milliseconds
   * @returns {Promise<string>} Response text
   * @throws {Error} On fetch failure
   */
  const fetchText = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT) => {
    const response = await fetchWithTimeout(url, options, timeoutMs);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.text();
  };

  /**
   * Fetch HTML and parse as document
   * @param {string} url - URL to fetch
   * @param {Object} [options={}] - Fetch options
   * @param {number} [timeoutMs=DEFAULT_TIMEOUT] - Timeout in milliseconds
   * @returns {Promise<Document>} Parsed HTML document
   * @throws {Error} On fetch failure or parsing error
   */
  const fetchHTML = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT) => {
    const html = await fetchText(url, options, timeoutMs);
    // eslint-disable-next-line no-undef
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    if (!doc) {
      throw new Error('Failed to parse HTML');
    }

    return doc;
  };

  /**
   * Fetch with GM_xmlhttpRequest (for userscript environments)
   * Provides CORS bypass and cookie support
   * @param {string} url - URL to fetch
   * @param {Object} [options={}] - Request options
   * @param {string} [options.method='GET'] - HTTP method
   * @param {Object} [options.headers={}] - Request headers
   * @param {string|FormData} [options.body] - Request body
   * @param {number} [options.timeout=DEFAULT_TIMEOUT] - Timeout in milliseconds
   * @returns {Promise<Object>} Response object with responseText, status, headers
   * @throws {Error} On request failure
   */
  const gmFetch = (url, options = {}) => {
    return new Promise((resolve, reject) => {
      // Check if GM_xmlhttpRequest is available
      /* eslint-disable no-undef */
      if (typeof GM_xmlhttpRequest === 'undefined' && typeof GM?.xmlHttpRequest === 'undefined') {
        reject(new Error('GM_xmlhttpRequest not available'));
        return;
      }

      const gmRequest =
        typeof GM_xmlhttpRequest === 'undefined' ? GM.xmlHttpRequest : GM_xmlhttpRequest;
      /* eslint-enable no-undef */

      const { method = 'GET', headers = {}, body = null, timeout = DEFAULT_TIMEOUT } = options;

      gmRequest({
        method,
        url,
        headers,
        data: body,
        timeout,
        onload: response => {
          resolve({
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            statusText: response.statusText,
            headers: response.responseHeaders,
            text: () => Promise.resolve(response.responseText),
            json: () => Promise.resolve(JSON.parse(response.responseText)),
          });
        },
        onerror: error => {
          reject(new Error(`GM fetch failed: ${error}`));
        },
        ontimeout: () => {
          reject(new Error(`GM fetch timeout after ${timeout}ms`));
        },
      });
    });
  };

  /**
   * Batch fetch multiple URLs with concurrency control
   * @param {string[]} urls - Array of URLs to fetch
   * @param {Object} [options={}] - Fetch options
   * @param {number} [concurrency=5] - Maximum concurrent requests
   * @param {Function} [onProgress] - Progress callback (completed, total)
   * @returns {Promise<Array>} Array of results (success) or errors
   */
  const batchFetch = async (urls, options = {}, concurrency = 5, onProgress = null) => {
    const results = new Array(urls.length);
    let completed = 0;
    let index = 0;

    const fetchNext = async () => {
      const currentIndex = index++;
      if (currentIndex >= urls.length) return;

      try {
        const response = await fetchWithTimeout(urls[currentIndex], options);
        results[currentIndex] = { success: true, data: response };
      } catch (error) {
        results[currentIndex] = { success: false, error };
      }

      completed++;
      if (onProgress) {
        onProgress(completed, urls.length);
      }

      await fetchNext();
    };

    // Start concurrent fetches
    const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => fetchNext());
    await Promise.all(workers);

    return results;
  };

  /**
   * Check if URL is reachable (HEAD request)
   * @param {string} url - URL to check
   * @param {number} [timeoutMs=5000] - Timeout in milliseconds
   * @returns {Promise<boolean>} True if URL is reachable
   */
  const isUrlReachable = async (url, timeoutMs = 5000) => {
    try {
      const response = await fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs);
      return response.ok;
    } catch {
      return false;
    }
  };

  /**
   * Download file as blob
   * @param {string} url - URL to download
   * @param {Object} [options={}] - Fetch options
   * @param {number} [timeoutMs=DEFAULT_TIMEOUT] - Timeout in milliseconds
   * @returns {Promise<Blob>} File blob
   * @throws {Error} On download failure
   */
  const downloadBlob = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT) => {
    const response = await fetchWithTimeout(url, options, timeoutMs);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.blob();
  };

  // Export utilities
  const FetchUtils = {
    fetchWithTimeout,
    fetchWithRetry,
    fetchJSON,
    fetchText,
    fetchHTML,
    gmFetch,
    batchFetch,
    isUrlReachable,
    downloadBlob,
    DEFAULT_TIMEOUT,
    DEFAULT_MAX_RETRIES,
    DEFAULT_BASE_DELAY,
  };

  // Make available globally
  if (typeof window !== 'undefined') {
    window.YouTubePlusFetchUtils = FetchUtils;
  }

  // Support module exports
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FetchUtils;
  }
})();
