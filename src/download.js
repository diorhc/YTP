/**
 * YouTube+ Download Module
 * Unified download system with button UI and download functionality
 * @version 3.0
 */

(function () {
  'use strict';
  const _createHTML = window._ytplusCreateHTML || ((/** @type {string} */ s) => s);

  const isRelevantRoute = () => {
    try {
      const path = location.pathname || '';
      return path === '/watch' || path.startsWith('/shorts');
    } catch (e) {
      return false;
    }
  };

  const onDomReady = (/** @type {() => void} */ cb) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb, { once: true });
    } else {
      cb();
    }
  };

  // Shared DOM helpers from YouTubeUtils
  const $ = (/** @type {string} */ sel) =>
    window.YouTubeUtils?.$(sel) || document.querySelector(sel);

  // Check dependencies
  if (typeof YouTubeUtils === 'undefined') {
    console.error('[YouTube+ Download] YouTubeUtils not found!');
    return;
  }

  // Create a custom glassmorphic subtitle dropdown control
  function createSubtitleSelect() {
    const subtitleSelect = document.createElement('div');
    subtitleSelect.setAttribute('role', 'listbox');
    subtitleSelect.setAttribute('aria-expanded', 'false');
    subtitleSelect.setAttribute('aria-label', 'Subtitle language');
    subtitleSelect.setAttribute('tabindex', '0');
    Object.assign(/** @type {any} */ (subtitleSelect).style || {}, {
      position: 'relative',
      width: '100%',
      marginBottom: '8px',
      fontSize: '14px',
      color: '#fff',
      cursor: 'pointer',
    });

    const _ssDisplay = document.createElement('div');
    Object.assign(/** @type {any} */ (_ssDisplay).style || {}, {
      padding: '10px 12px',
      borderRadius: '10px',
      background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      backdropFilter: 'blur(6px)',
      boxShadow: '0 4px 18px rgba(0,0,0,0.35) inset',
    });
    const _ssLabel = document.createElement('div');
    if (_ssLabel.style) {
      _ssLabel.style.flex = '1';
      _ssLabel.style.overflow = 'hidden';
      _ssLabel.style.textOverflow = 'ellipsis';
      _ssLabel.style.whiteSpace = 'nowrap';
    }
    _ssLabel.textContent = t('loading');
    const _ssChevron = document.createElement('div');
    _ssChevron.textContent = '▾';
    if (_ssChevron.style) _ssChevron.style.opacity = '0.8';
    _ssDisplay.appendChild(_ssLabel);
    _ssDisplay.appendChild(_ssChevron);

    const _ssList = document.createElement('div');
    Object.assign(/** @type {any} */ (_ssList).style || {}, {
      position: 'absolute',
      top: 'calc(100% + 8px)',
      left: '0',
      right: '0',
      maxHeight: '220px',
      overflowY: 'auto',
      borderRadius: '10px',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
      backdropFilter: 'blur(8px)',
      zIndex: '9999',
      display: 'none',
    });

    subtitleSelect.appendChild(_ssDisplay);
    subtitleSelect.appendChild(_ssList);

    _ssList.addEventListener('click', (/** @type {Event} */ e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const item = target.closest('[data-value]');
      if (!item || !_ssList.contains(item)) return;
      subtitleSelect.value = /** @type {any} */ (item).dataset?.value || '';
      if (_ssList.style) _ssList.style.display = 'none';
    });

    _ssList.addEventListener('mouseover', (/** @type {Event} */ e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const item = target.closest('[data-value]');
      if (!item || !_ssList.contains(item)) return;
      if (/** @type {any} */ (item).style) /** @type {any} */ {
        item.style.background = 'rgba(255,255,255,0.02)';
      }
    });

    _ssList.addEventListener('mouseout', (/** @type {MouseEvent} */ e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const item = target.closest('[data-value]');
      if (!item || !_ssList.contains(item)) return;
      const related = e.relatedTarget;
      if (related && item.contains(/** @type {Node} */ (related))) return;
      if (/** @type {any} */ (item).style) /** @type {any} */ {
        item.style.background = 'transparent';
      }
    });

    subtitleSelect._options = [];
    subtitleSelect._value = '';
    subtitleSelect._disabled = false;

    subtitleSelect.setPlaceholder = (/** @type {string} */ text) => {
      _ssLabel.textContent = text || '';
      subtitleSelect._options = [];
      _ssList.replaceChildren();
      subtitleSelect._value = '';
    };

    subtitleSelect.setOptions = (/** @type {any[]} */ options) => {
      subtitleSelect._options = options || [];
      _ssList.replaceChildren();
      subtitleSelect._options.forEach((/** @type {any} */ opt) => {
        const item = document.createElement('div');
        item.textContent = opt.text;
        /** @type {any} */ (item).dataset.value = String(opt.value);
        Object.assign(/** @type {any} */ (item).style || {}, {
          padding: '10px 12px',
          cursor: 'pointer',
          borderBottom: '1px solid rgba(255,255,255,0.02)',
          color: '#fff',
        });
        _ssList.appendChild(item);
      });
      if (subtitleSelect._options.length > 0) {
        subtitleSelect.value = String(subtitleSelect._options[0].value);
      } else {
        subtitleSelect._value = '';
        _ssLabel.textContent = t('noSubtitles');
      }
    };

    Object.defineProperty(subtitleSelect, 'value', {
      get() {
        return subtitleSelect._value;
      },
      set(v) {
        subtitleSelect._value = String(v);
        const found = subtitleSelect._options.find(
          (/** @type {any} */ o) => String(o.value) === subtitleSelect._value
        );
        _ssLabel.textContent = found ? found.text : '';
      },
    });

    Object.defineProperty(subtitleSelect, 'disabled', {
      get() {
        return subtitleSelect._disabled;
      },
      set(v) {
        subtitleSelect._disabled = !!v;
        if (_ssDisplay.style) _ssDisplay.style.opacity = subtitleSelect._disabled ? '0.5' : '1';
        if (subtitleSelect.style) {
          subtitleSelect.style.pointerEvents = subtitleSelect._disabled ? 'none' : 'auto';
        }
      },
    });

    _ssDisplay.addEventListener('click', () => {
      if (subtitleSelect._disabled) return;
      const isOpen = _ssList.style ? _ssList.style.display !== 'none' : false;
      if (_ssList.style) _ssList.style.display = isOpen ? 'none' : '';
      subtitleSelect.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    });

    // Keyboard navigation for accessibility (#24)
    subtitleSelect.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      if (subtitleSelect._disabled) return;
      const isOpen = _ssList.style ? _ssList.style.display !== 'none' : false;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (_ssList.style) _ssList.style.display = isOpen ? 'none' : '';
        subtitleSelect.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        if (_ssList.style) _ssList.style.display = 'none';
        subtitleSelect.setAttribute('aria-expanded', 'false');
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) {
          if (_ssList.style) _ssList.style.display = '';
          subtitleSelect.setAttribute('aria-expanded', 'true');
        }
        const opts = subtitleSelect._options;
        if (opts.length === 0) return;
        const currentIdx = opts.findIndex(
          (/** @type {any} */ o) => String(o.value) === subtitleSelect._value
        );
        const nextIdx =
          e.key === 'ArrowDown'
            ? Math.min(currentIdx + 1, opts.length - 1)
            : Math.max(currentIdx - 1, 0);
        subtitleSelect.value = String(opts[nextIdx].value);
      }
    });

    const _ac = new AbortController();
    document.addEventListener(
      'click',
      (/** @type {Event} */ e) => {
        const target = e.target;
        if (!(target instanceof Node) || !subtitleSelect.contains(target)) {
          if (_ssList.style) _ssList.style.display = 'none';
          subtitleSelect.setAttribute('aria-expanded', 'false');
        }
      },
      { signal: _ac.signal }
    );

    subtitleSelect.destroy = () => _ac.abort();

    return subtitleSelect;
  }

  const { NotificationManager } = YouTubeUtils;

  // Translation helper: resolve from centralized i18n with fallback
  const t = (/** @type {string} */ key, /** @type {Record<string, any>} */ params = {}) => {
    if (window.YouTubeUtils?.t) return window.YouTubeUtils.t(key, params);
    const str = String(key || '');
    if (!params || Object.keys(params).length === 0) return str;
    let result = str;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
  };

  // Initialize logger (logger is defined in build order before this module)
  const _YouTubePlusLogger = /** @type {any} */ (window).YouTubePlusLogger;
  const logger =
    typeof _YouTubePlusLogger !== 'undefined' && _YouTubePlusLogger
      ? _YouTubePlusLogger.createLogger('Download')
      : {
          debug: () => {},
          info: () => {},
          warn: console.warn.bind(console),
          error: console.error.bind(console),
        };

  /**
   * Download Configuration
   */
  const DownloadConfig = {
    // TubeInsights API endpoints (mp3yt.is backend)
    API: {
      KEY_URL: 'https://cnv.cx/v2/sanity/key',
      CONVERT_URL: 'https://cnv.cx/v2/converter',
    },

    // HTTP headers for API requests
    HEADERS: {
      'Content-Type': 'application/json',
      Origin: 'https://mp3yt.is',
      Accept: '*/*',
      'User-Agent': typeof navigator !== 'undefined' ? navigator.userAgent : '',
    },

    // Available video qualities (144p to 4K)
    VIDEO_QUALITIES: ['144', '240', '360', '480', '720', '1080', '1440', '2160'],

    // Available audio bitrates (kbps)
    AUDIO_BITRATES: ['64', '128', '192', '256', '320'],

    // Default download options
    DEFAULTS: {
      format: 'video', // 'video' or 'audio'
      videoQuality: '1080',
      audioBitrate: '320',
      embedThumbnail: true,
    },
  };

  /**
   * Get current YouTube video ID
   * @returns {string|null} Video ID or null
   */
  function getVideoId() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const fromQuery = params.get('v');
      if (fromQuery) return fromQuery;

      const path = window.location.pathname || '';
      const shortsMatch = path.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch && shortsMatch[1]) return shortsMatch[1];

      const liveMatch = path.match(/^\/live\/([a-zA-Z0-9_-]{11})/);
      if (liveMatch && liveMatch[1]) return liveMatch[1];

      const youtuBeMatch = (window.location.href || '').match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
      if (youtuBeMatch && youtuBeMatch[1]) return youtuBeMatch[1];
    } catch (e) {
      // Non-critical, suppressed
    }
    return null;
  }

  /**
   * Get current video URL
   * @returns {string} Full video URL
   */
  function getVideoUrl() {
    const videoId = getVideoId();
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : window.location.href;
  }

  /**
   * Get video title from page
   * @returns {string} Video title or 'video'
   */
  function getVideoTitle() {
    try {
      const titleElement =
        $('h1.ytd-video-primary-info-renderer yt-formatted-string') ||
        $('h1.title yt-formatted-string') ||
        $('ytd-watch-metadata h1');
      return titleElement ? titleElement.textContent.trim() : 'video';
    } catch (e) {
      return 'video';
    }
  }

  /**
   * Sanitize filename for safe file system operations
   * @param {string} filename - Original filename
   * @returns {string} Sanitized filename
   */
  function sanitizeFilename(filename) {
    return filename
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202f\ufeff]/g, '') // S8: strip Unicode control chars
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200); // Limit length
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - Byte count
   * @returns {string} Formatted string (e.g., "8.5 MB")
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Create GM_xmlhttpRequest wrapper with callbacks
   * @param {any} options - Request options
   * @param {Function} resolve - Promise resolve function
   * @param {Function} reject - Promise reject function
   * @returns {any} GM_xmlhttpRequest options
   */
  function createGmRequestOptions(options, resolve, reject) {
    return {
      ...options,
      onload: (/** @type {any} */ response) => {
        if (options.onload) options.onload(response);
        resolve(response);
      },
      onerror: (/** @type {any} */ error) => {
        if (options.onerror) options.onerror(error);
        reject(error);
      },
      ontimeout: () => {
        if (options.ontimeout) options.ontimeout();
        reject(new Error('Request timeout'));
      },
    };
  }

  /**
   * Build response-like object from fetch response
   * @param {Response} resp - Fetch response
   * @returns {any} Response-like object
   */
  function buildResponseObject(resp) {
    return {
      status: resp.status,
      statusText: resp.statusText,
      finalUrl: resp.url,
      headers: {},
      responseText: null,
      response: null,
    };
  }

  /**
   * Try to extract text from response
   * @param {Response} resp - Fetch response
   * @param {any} responseLike - Response-like object to populate
   */
  async function extractResponseText(resp, responseLike) {
    try {
      responseLike.responseText = await resp.text();
    } catch (e) {
      responseLike.responseText = null;
    }
  }

  /**
   * Try to extract blob from response if needed
   * @param {Response} resp - Fetch response
   * @param {any} responseLike - Response-like object to populate
   * @param {string} responseType - Expected response type
   */
  async function extractResponseBlob(resp, responseLike, responseType) {
    if (responseType === 'blob') {
      try {
        responseLike.response = await resp.blob();
      } catch (e) {
        responseLike.response = null;
      }
    }
  }

  /**
   * Execute fetch-based request as fallback
   * @param {any} options - Request options
   * @returns {Promise<any>} Response object
   */
  async function executeFetchFallback(options) {
    const fetchOpts = {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.data || options.body || undefined,
    };

    const resp = await fetch(options.url, fetchOpts);
    const responseLike = buildResponseObject(resp);

    await extractResponseText(resp, responseLike);
    await extractResponseBlob(resp, responseLike, options.responseType);

    if (options.onload) options.onload(responseLike);
    return responseLike;
  }

  // ---------------------------------------------------------------------------
  // S6: API rate limiter — prevents hammering YouTube/external APIs
  // S7: Exponential backoff on rate-limit hits
  // ---------------------------------------------------------------------------
  const _downloadRateLimiter = (() => {
    const maxRequests = 15; // max requests per time window
    const timeWindowMs = 60000; // 1 minute window

    // Paths that should never be rate-limited (subtitle/caption data fetches).
    // These are direct content requests, not API calls to external services.
    const RATE_LIMIT_EXEMPT_PATHS = ['/api/timedtext', '/api/timedtext_ui'];

    /** @type {Map<string, number[]>} */
    const requests = new Map();
    /** @type {Map<string, number>} S7: per-host backoff until timestamp */
    const backoffUntil = new Map();

    return {
      /**
       * Check whether a request to the given host is allowed.
       * Implements exponential backoff when rate limit is exceeded (S7).
       * @param {string} url - Full request URL
       * @returns {boolean} true if the request may proceed
       */
      canRequest(url) {
        let host = 'unknown';
        let pathname = '';
        try {
          const parsed = new URL(url);
          host = parsed.hostname;
          pathname = parsed.pathname;
        } catch (e) {
          /* keep 'unknown' */
        }

        // Exempt timedtext and other direct-content paths from rate limiting
        if (RATE_LIMIT_EXEMPT_PATHS.some(p => pathname.startsWith(p))) {
          return true;
        }

        const now = Date.now();

        // S7: Check backoff
        const backoff = backoffUntil.get(host) || 0;
        if (now < backoff) {
          console.warn(
            `[YouTube+ Download] Rate limit backoff: ${host} blocked for ${Math.ceil((backoff - now) / 1000)}s more`
          );
          return false;
        }

        const recent = (requests.get(host) || []).filter(t => now - t < timeWindowMs);
        if (recent.length >= maxRequests) {
          // S7: Apply exponential backoff (2s, 4s, 8s, 16s, max 60s)
          const consecutiveHits = Math.min(5, Math.floor(recent.length / maxRequests));
          const backoffMs = Math.min(60000, 2000 * Math.pow(2, consecutiveHits));
          backoffUntil.set(host, now + backoffMs);
          console.warn(
            `[YouTube+ Download] Rate limit: ${recent.length}/${maxRequests} requests to ${host}, backing off ${backoffMs}ms`
          );
          return false;
        }
        recent.push(now);
        requests.set(host, recent);
        return true;
      },
    };
  })();

  /**
   * Promise wrapper for GM_xmlhttpRequest
   * @param {any} options - Request options
   * @returns {Promise<any>} Response object
   */
  function gmXmlHttpRequest(options) {
    return new Promise((resolve, reject) => {
      // S6: enforce rate limiting per host before making the request
      if (options.url && !_downloadRateLimiter.canRequest(options.url)) {
        reject(new Error('[YouTube+ Download] Rate limit exceeded — request blocked'));
        return;
      }

      // Prefer GM_xmlhttpRequest (userscript/extension context) because it can bypass CORS.
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest(createGmRequestOptions(options, resolve, reject));
        return;
      }

      // Violentmonkey/Tampermonkey modern API fallback
      const gmApi = /** @type {any} */ (globalThis).GM;
      if (gmApi && typeof gmApi.xmlHttpRequest === 'function') {
        gmApi.xmlHttpRequest(createGmRequestOptions(options, resolve, reject));
        return;
      }

      // Fallback for page context: try using fetch(). Note: fetch() is subject to CORS and
      // may fail where GM_xmlhttpRequest would succeed. This fallback attempts to mimic
      // a similar response shape used by the rest of the code.
      (async () => {
        try {
          const responseLike = await executeFetchFallback(options);
          resolve(responseLike);
        } catch (err) {
          if (options.onerror) options.onerror(err);
          reject(err);
        }
      })();
    });
  }

  /**
   * Create square album art from YouTube thumbnail
   * @param {string} thumbnailUrl - Thumbnail URL
   * @returns {Promise<Blob>} Album art blob
   */
  function createSquareAlbumArt(thumbnailUrl) {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height);
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          canvas.width = 0;
          canvas.height = 0;
          reject(new Error('Failed to get canvas context'));
          return;
        }

        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);

        canvas.toBlob(
          blob => {
            // Release canvas memory after blob is created
            canvas.width = 0;
            canvas.height = 0;
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
          },
          'image/jpeg',
          0.95
        );
      };

      img.onerror = () => reject(new Error('Failed to load thumbnail'));
      img.src = thumbnailUrl;
    });
  }

  /**
   * Embed album art and metadata into MP3 file
   * Requires ID3Writer library (browser-id3-writer)
   *
   * @param {Blob} mp3Blob - Original MP3 blob
   * @param {Blob} albumArtBlob - Album art image blob
   * @param {any} metadata - Metadata (title, artist, album)
   * @returns {Promise<Blob>} MP3 blob with embedded metadata
   */
  async function embedAlbumArtToMP3(mp3Blob, albumArtBlob, metadata) {
    try {
      if (typeof window.ID3Writer === 'undefined') {
        logger.warn('ID3Writer not available, skipping album art embedding');
        return mp3Blob;
      }

      const arrayBuffer = await mp3Blob.arrayBuffer();
      const writer = new window.ID3Writer(arrayBuffer);

      // Set metadata
      if (metadata.title) {
        writer.setFrame('TIT2', metadata.title);
      }
      if (metadata.artist) {
        writer.setFrame('TPE1', [metadata.artist]);
      }
      if (metadata.album) {
        writer.setFrame('TALB', metadata.album);
      }

      // Embed album art
      if (albumArtBlob) {
        const coverArrayBuffer = await albumArtBlob.arrayBuffer();
        writer.setFrame('APIC', {
          type: 3, // Cover (front)
          data: coverArrayBuffer,
          description: 'Cover',
        });
      }

      writer.addTag();
      /* global Blob */
      return new Blob([writer.arrayBuffer], { type: 'audio/mpeg' });
    } catch (error) {
      logger.error('Error embedding album art:', error);
      return mp3Blob;
    }
  }

  /**
   * Get available subtitles for a video
   * @param {string} videoId - YouTube video ID
   * @returns {Promise<any>} Subtitle data
   */

  // ---------------------------------------------------------------------------
  // P5: TTL-based in-memory cache for player data (subtitles + formats)
  // Prevents redundant API calls when user opens the download dialog multiple times.
  // ---------------------------------------------------------------------------
  const _playerDataCache = (() => {
    const TTL_MS = 5 * 60 * 1000; // 5 minutes
    /** @type {Map<string, { data: any, ts: number }>} */
    const store = new Map();
    return {
      get(/** @type {string} */ videoId) {
        const entry = store.get(videoId);
        if (!entry) return null;
        if (Date.now() - entry.ts > TTL_MS) {
          store.delete(videoId);
          return null;
        }
        return entry.data;
      },
      set(/** @type {string} */ videoId, /** @type {any} */ data) {
        // Evict oldest entry when cache exceeds 10 videos to bound memory
        if (store.size >= 10) {
          const oldestKey = store.keys().next().value;
          if (typeof oldestKey === 'string') store.delete(oldestKey);
        }
        store.set(videoId, { data, ts: Date.now() });
      },
    };
  })();

  /**
   * Fetch player data from YouTube API
   * @param {string} videoId - Video ID
   * @returns {Promise<any>} Player data response
   * @private
   */
  async function fetchPlayerData(videoId) {
    // P5: serve from cache when available
    const cached = _playerDataCache.get(videoId);
    if (cached) return cached;

    const response = await gmXmlHttpRequest({
      method: 'POST',
      url: 'https://www.youtube.com/youtubei/v1/player',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': DownloadConfig.HEADERS['User-Agent'],
      },
      data: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240304.00.00',
          },
        },
        videoId,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`Failed to get player data: ${response.status}`);
    }

    const parsed = JSON.parse(response.responseText);
    _playerDataCache.set(videoId, parsed); // P5: store in cache
    return parsed;
  }

  /**
   * Extract player response from watch HTML when runtime globals are unavailable.
   * @param {string} videoId - Video ID
   * @returns {Promise<any|null>} Parsed player response or null
   * @private
   */
  async function fetchPlayerResponseFromWatchHtml(videoId) {
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      const response = await gmXmlHttpRequest({ method: 'GET', url: watchUrl });
      if (response.status !== 200 || !response.responseText) return null;

      const html = String(response.responseText);
      const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/);
      if (!match || !match[1]) return null;

      return JSON.parse(match[1]);
    } catch (error) {
      logger.warn('Watch HTML subtitle fallback failed:', error);
      return null;
    }
  }

  /**
   * Try to obtain captions renderer from page runtime state.
   * Helps in browsers where youtubei player request is blocked/limited.
   * @returns {{captions: any, videoTitle: string}|null}
   * @private
   */
  function getCaptionsFromPageFallback() {
    try {
      const title = getVideoTitle();
      const globalContext =
        typeof unsafeWindow !== 'undefined'
          ? /** @type {any} */ (unsafeWindow)
          : /** @type {any} */ (window);

      const initial = globalContext.ytInitialPlayerResponse;
      const initialCaps = initial?.captions?.playerCaptionsTracklistRenderer;
      if (initialCaps) {
        return { captions: initialCaps, videoTitle: initial?.videoDetails?.title || title };
      }

      const playerEl = document.getElementById('movie_player');
      const player = /** @type {any} */ (playerEl);
      const response =
        (typeof player?.getPlayerResponse === 'function' && player.getPlayerResponse()) || null;
      const respCaps = response?.captions?.playerCaptionsTracklistRenderer;
      if (respCaps) {
        return { captions: respCaps, videoTitle: response?.videoDetails?.title || title };
      }

      const ytPlayerResponse = globalContext?.ytplayer?.config?.args?.player_response;
      if (typeof ytPlayerResponse === 'string' && ytPlayerResponse.length > 0) {
        try {
          const parsed = JSON.parse(ytPlayerResponse);
          const parsedCaps = parsed?.captions?.playerCaptionsTracklistRenderer;
          if (parsedCaps) {
            return { captions: parsedCaps, videoTitle: parsed?.videoDetails?.title || title };
          }
        } catch (e) {
          // Non-critical, suppressed
        }
      }
    } catch (error) {
      logger.warn('Subtitle fallback extraction failed:', error);
    }
    return null;
  }

  /**
   * Build subtitle URL with format parameter
   * @param {string} baseUrl - Base subtitle URL
   * @returns {string} Complete subtitle URL
   * @private
   */
  function buildSubtitleUrl(baseUrl) {
    const normalized = normalizeSubtitleBaseUrl(baseUrl);
    if (!normalized) return '';
    if (!normalized.includes('fmt=')) {
      return `${normalized}&fmt=srv1`;
    }
    return normalized;
  }

  /**
   * Normalize subtitle base URL from player response.
   * @param {string} baseUrl - Raw subtitle URL
   * @returns {string} Normalized URL
   */
  function normalizeSubtitleBaseUrl(baseUrl) {
    const raw = String(baseUrl || '').trim();
    if (!raw) return '';
    return raw.replace(/&amp;/g, '&');
  }

  /**
   * Extract textual body from GM/fetch response shapes.
   * Handles multiple response formats: responseText, responseXML, response (string/object/ArrayBuffer).
   * @param {any} response - Response object
   * @returns {Promise<string>}
   */
  async function extractSubtitleBody(response) {
    // Priority 1: responseText (most common, always a string)
    const text = String(response?.responseText || '').trim();
    if (text) return text;

    const rawResponse = response?.response;

    // Priority 2: response is already a string (happens when responseType is omitted or 'text')
    if (typeof rawResponse === 'string' && rawResponse.trim()) {
      return rawResponse.trim();
    }

    // Priority 3: responseXML document
    const xmlDoc = response?.responseXML;
    if (xmlDoc && window.XMLSerializer) {
      try {
        const serialized = new window.XMLSerializer().serializeToString(xmlDoc).trim();
        if (serialized) return serialized;
      } catch (e) {
        // Non-critical
      }
    }

    // Priority 4: response is an XML/HTML Document object
    if (rawResponse && typeof rawResponse === 'object') {
      const rawDocument = /** @type {any} */ (rawResponse);
      if (typeof rawDocument?.documentElement?.nodeName === 'string' && window.XMLSerializer) {
        try {
          const serialized = new window.XMLSerializer().serializeToString(rawDocument).trim();
          if (serialized) return serialized;
        } catch (e) {
          // Non-critical
        }
      }
    }

    // Priority 5: response is an ArrayBuffer (when responseType: 'arraybuffer')
    if (rawResponse && rawResponse instanceof ArrayBuffer) {
      try {
        if (window.TextDecoder) {
          return new window.TextDecoder('utf-8').decode(rawResponse).trim();
        }
        return '';
      } catch (e) {
        return '';
      }
    }

    // Priority 6: response is an ArrayBuffer view (Uint8Array, DataView, etc.)
    if (rawResponse && ArrayBuffer.isView(rawResponse)) {
      try {
        const view = /** @type {ArrayBufferView} */ (rawResponse);
        const sliced = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
        if (window.TextDecoder) {
          return new window.TextDecoder('utf-8').decode(sliced).trim();
        }
      } catch (e) {
        // Non-critical
      }
    }

    // Priority 7: response is a Blob
    if (typeof Blob !== 'undefined' && rawResponse instanceof Blob) {
      try {
        return (await rawResponse.text()).trim();
      } catch (e) {
        // Non-critical
      }
    }

    // Priority 8: response is a text-like object from userscript APIs
    if (rawResponse && typeof rawResponse === 'object') {
      const maybeText =
        /** @type {any} */ (rawResponse).text ||
        /** @type {any} */ (rawResponse).data ||
        /** @type {any} */ (rawResponse).content;
      if (typeof maybeText === 'string' && maybeText.trim()) {
        return maybeText.trim();
      }

      // Some wrappers expose async text() method
      if (typeof (/** @type {any} */ (rawResponse).text) === 'function') {
        try {
          const extracted = await /** @type {any} */ (rawResponse).text();
          if (typeof extracted === 'string' && extracted.trim()) {
            return extracted.trim();
          }
        } catch (e) {
          // Non-critical
        }
      }
    }

    return '';
  }

  /**
   * Build fallback request profiles for subtitle payload retrieval.
   * @returns {any[]}
   */
  function getSubtitleRequestProfiles() {
    return [
      {
        method: 'GET',
        withCredentials: true,
        anonymous: false,
        responseType: 'text', // Forces GM_xmlhttpRequest to populate responseText
        headers: { Referer: 'https://www.youtube.com/' },
      },
      {
        method: 'GET',
        withCredentials: true,
        anonymous: false,
        // No responseType — lets Firefox return responseXML for XML content
      },
    ];
  }

  /**
   * Parse caption tracks into subtitle objects
   * @param {any[]} captionTracks - Caption track data
   * @returns {any[]} Subtitle objects
   * @private
   */
  function parseCaptionTracks(captionTracks) {
    return captionTracks.map(track => ({
      name: track.name?.simpleText || track.languageCode,
      languageCode: track.languageCode,
      url: buildSubtitleUrl(track.baseUrl),
      baseUrl: normalizeSubtitleBaseUrl(track.baseUrl),
      isAutoGenerated: track.kind === 'asr',
    }));
  }

  /**
   * Parse translation languages into subtitle objects
   * @param {any[]} translationLanguages - Translation language data
   * @param {string} baseUrl - Base URL for translations (from source caption track)
   * @param {string} sourceLanguageCode - Language code of the source caption track
   * @returns {any[]} Auto-translation subtitle objects
   * @private
   */
  function parseTranslationLanguages(translationLanguages, baseUrl, sourceLanguageCode) {
    return translationLanguages.map(lang => ({
      name: lang.languageName?.simpleText || lang.languageCode,
      languageCode: lang.languageCode,
      sourceLanguageCode: sourceLanguageCode || '',
      baseUrl: normalizeSubtitleBaseUrl(baseUrl),
      url: buildSubtitleUrl(baseUrl),
      isAutoGenerated: true,
      translateTo: lang.languageCode,
    }));
  }

  /**
   * Create empty subtitle result
   * @param {string} videoId - Video ID
   * @param {string} videoTitle - Video title
   * @returns {any} Empty subtitle result
   * @private
   */
  function createEmptySubtitleResult(videoId, videoTitle) {
    return {
      videoId,
      videoTitle,
      subtitles: [],
      autoTransSubtitles: [],
    };
  }

  /**
   * Get subtitles for a video
   * @param {string} videoId - Video ID
   * @returns {Promise<any>} Subtitle data or null on error
   */
  async function getSubtitles(videoId) {
    try {
      let data = null;
      try {
        data = await fetchPlayerData(videoId);
      } catch (error) {
        logger.warn('Primary subtitle API request failed, trying page fallback:', error);
      }

      let fallback = getCaptionsFromPageFallback();
      if (!fallback) {
        const parsedFromHtml = await fetchPlayerResponseFromWatchHtml(videoId);
        if (parsedFromHtml?.captions?.playerCaptionsTracklistRenderer) {
          fallback = {
            captions: parsedFromHtml.captions.playerCaptionsTracklistRenderer,
            videoTitle: parsedFromHtml?.videoDetails?.title || getVideoTitle(),
          };
        }
      }

      const videoTitle = data?.videoDetails?.title || fallback?.videoTitle || 'video';
      const captions =
        data?.captions?.playerCaptionsTracklistRenderer || fallback?.captions || null;

      if (!captions) {
        return createEmptySubtitleResult(videoId, videoTitle);
      }

      const captionTracks = captions.captionTracks || [];
      const translationLanguages = captions.translationLanguages || [];
      const baseUrl = captionTracks[0]?.baseUrl || '';
      const sourceLanguageCode = captionTracks[0]?.languageCode || '';

      return {
        videoId,
        videoTitle,
        subtitles: parseCaptionTracks(captionTracks),
        autoTransSubtitles: parseTranslationLanguages(
          translationLanguages,
          baseUrl,
          sourceLanguageCode
        ),
      };
    } catch (error) {
      logger.error('Error getting subtitles:', error);
      return null;
    }
  }

  /**
   * Parse subtitle XML to cues
   * @param {string} xml - XML subtitle content
   * @returns {any[]} Array of cues
   */
  function parseSubtitleXML(xml) {
    /** @type {any[]} */
    const cues = [];
    const normalizedXml = String(xml || '').replace(/\uFEFF/g, '');
    const domParser = typeof window.DOMParser === 'function' ? new window.DOMParser() : null;

    if (domParser) {
      try {
        const doc = domParser.parseFromString(normalizedXml, 'text/xml');
        const rootName = doc.documentElement?.nodeName?.toLowerCase?.() || '';
        const hasParserError =
          rootName === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0;

        if (!hasParserError) {
          const nodes = Array.from(doc.getElementsByTagName('text'));
          nodes.forEach(node => {
            const start = parseFloat(node.getAttribute('start') || '0');
            const duration = parseFloat(node.getAttribute('dur') || '0');
            const text = decodeHTMLEntities(String(node.textContent || '').trim());
            if (!text) return;
            cues.push({ start, duration, text });
          });
        }
      } catch (e) {
        /* empty */
      }
    }

    if (cues.length > 0) {
      return cues;
    }

    // O1: Regex is created per-call intentionally — .exec() is stateful (lastIndex).
    // Pre-compilation at module level would require manual lastIndex reset.
    const textTagRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let match;

    while ((match = textTagRegex.exec(normalizedXml)) !== null) {
      const attrs = match[1] || '';
      const startRaw = /\bstart\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '0';
      const durRaw = /\bdur\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '0';
      const start = parseFloat(startRaw || '0');
      const duration = parseFloat(durRaw || '0');
      let text = match[2] || '';

      text = text.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
      text = decodeHTMLEntities(text.replace(/<br\s*\/?>/gi, ' ').trim());
      text = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) continue;
      cues.push({ start, duration, text });
    }

    // srv3 format: <p t="1234" d="2000"><s>..</s></p>
    const pTagRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    while ((match = pTagRegex.exec(normalizedXml)) !== null) {
      const attrs = match[1] || '';
      const inner = match[2] || '';

      const tMsRaw = /\bt="([^"]+)"/i.exec(attrs)?.[1] || '0';
      const dMsRaw = /\bd="([^"]+)"/i.exec(attrs)?.[1] || '0';

      const start = Math.max(0, Number(tMsRaw) / 1000);
      const duration = Math.max(0, Number(dMsRaw) / 1000);

      const assembled = inner.includes('<s')
        ? inner
            .replace(/<s\b[^>]*>/gi, '')
            .replace(/<\/s>/gi, '')
            .replace(/<br\s*\/?>/gi, ' ')
        : inner;

      const text = decodeHTMLEntities(
        assembled
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );

      if (!text) continue;
      cues.push({
        start,
        duration: duration > 0 ? duration : 2,
        text,
      });
    }

    return cues;
  }

  /**
   * Decode HTML entities.
   * O2: Uses single regex + lookup map instead of multiple split/join passes.
   * @param {string} text - Text with HTML entities
   * @returns {string} Decoded text
   */
  const _htmlEntityMap = /** @type {Record<string, string>} */ ({
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
    apos: "'",
    nbsp: ' ',
  });
  function decodeHTMLEntities(/** @type {string} */ text) {
    // Single pass: match &name; and &#decimal; and &#xhex; patterns
    return text.replace(
      /&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g,
      (/** @type {string} */ match, /** @type {string} */ entity) => {
        // Named entity
        if (_htmlEntityMap[entity]) return _htmlEntityMap[entity];
        // Numeric decimal: &#123;
        if (entity.startsWith('#') && !entity.startsWith('#x')) {
          const num = parseInt(entity.slice(1), 10);
          return num > 0 && num < 0x10ffff ? String.fromCharCode(num) : match;
        }
        // Numeric hex: &#xAB;
        if (entity.startsWith('#x')) {
          const num = parseInt(entity.slice(2), 16);
          return num > 0 && num < 0x10ffff ? String.fromCharCode(num) : match;
        }
        return match;
      }
    );
  }

  /**
   * Convert cues to SRT format
   * @param {any[]} cues - Array of cues
   * @returns {string} SRT formatted text
   */
  function convertToSRT(cues) {
    let srt = '';
    cues.forEach((cue, index) => {
      const startTime = formatSRTTime(cue.start);
      const endTime = formatSRTTime(cue.start + cue.duration);
      const text = cue.text.replace(/\n/g, ' ').trim();

      srt += `${index + 1}\n`;
      srt += `${startTime} --> ${endTime}\n`;
      srt += `${text}\n\n`;
    });

    return srt;
  }

  /**
   * Format time for SRT (HH:MM:SS,mmm)
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time
   */
  function formatSRTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
  }

  /**
   * Convert cues to plain text
   * @param {any[]} cues - Array of cues
   * @returns {string} Plain text
   */
  function convertToTXT(cues) {
    return cues.map(cue => cue.text.trim()).join('\n');
  }

  /**
   * Parse subtitle JSON3 to cues
   * @param {string} jsonText - JSON3 subtitle content
   * @returns {any[]} Array of cues
   */
  function parseSubtitleJSON3(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      const events = Array.isArray(data?.events) ? data.events : [];
      /** @type {any[]} */
      const cues = [];

      events.forEach((/** @type {any} */ event) => {
        const segs = Array.isArray(event?.segs) ? event.segs : [];
        const text = segs
          .map((/** @type {any} */ seg) => String(seg?.utf8 || ''))
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text) return;

        const start = Number(event?.tStartMs || 0) / 1000;
        const duration = Math.max(0, Number(event?.dDurationMs || 0) / 1000);
        cues.push({ start, duration, text });
      });

      return cues;
    } catch (e) {
      return [];
    }
  }

  /**
   * Parse VTT text to cues
   * @param {string} vttText - VTT subtitle content
   * @returns {any[]} Array of cues
   */
  function parseSubtitleVTT(vttText) {
    /** @type {any[]} */
    const cues = [];
    const blocks = String(vttText || '')
      .replace(/\r/g, '')
      .split(/\n\n+/);

    const parseVttTime = (/** @type {string} */ value) => {
      const raw = value.trim();
      const m = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
      if (!m) return 0;
      const h = Number(m[1] || 0);
      const min = Number(m[2] || 0);
      const sec = Number(m[3] || 0);
      const ms = Number((m[4] || '0').padEnd(3, '0'));
      return h * 3600 + min * 60 + sec + ms / 1000;
    };

    blocks.forEach((/** @type {string} */ block) => {
      const lines = block
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return;
      if (lines[0] === 'WEBVTT') return;

      const timeIndex = lines.findIndex(line => line.includes('-->'));
      if (timeIndex < 0) return;

      const range = lines[timeIndex].split('-->');
      if (range.length < 2) return;

      const start = parseVttTime(range[0]);
      const end = parseVttTime(range[1].split(' ')[0]);
      const duration = Math.max(0, end - start);
      const text = lines
        .slice(timeIndex + 1)
        .join(' ')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) return;
      cues.push({ start, duration, text });
    });

    return cues;
  }

  /**
   * Parse TTML subtitles to cues
   * @param {string} ttmlText - TTML subtitle content
   * @returns {any[]} Array of cues
   */
  function parseSubtitleTTML(ttmlText) {
    /** @type {any[]} */
    const cues = [];
    const normalizedTtml = String(ttmlText || '').replace(/\uFEFF/g, '');
    const pTagRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;

    const parseTtmlTime = (/** @type {string} */ value) => {
      const v = String(value || '').trim();
      if (!v) return 0;
      if (/^\d+(?:\.\d+)?s$/.test(v)) return parseFloat(v);
      const match = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
      if (!match) return 0;
      const h = Number(match[1] || 0);
      const m = Number(match[2] || 0);
      const s = Number(match[3] || 0);
      const ms = Number((match[4] || '0').padEnd(3, '0'));
      return h * 3600 + m * 60 + s + ms / 1000;
    };

    const domParser = typeof window.DOMParser === 'function' ? new window.DOMParser() : null;
    if (domParser) {
      try {
        const doc = domParser.parseFromString(normalizedTtml, 'text/xml');
        const rootName = doc.documentElement?.nodeName?.toLowerCase?.() || '';
        const hasParserError =
          rootName === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0;

        if (!hasParserError) {
          const nodes = Array.from(doc.getElementsByTagName('p'));
          nodes.forEach(node => {
            const start = parseTtmlTime(
              node.getAttribute('begin') || node.getAttribute('start') || ''
            );
            const end = parseTtmlTime(node.getAttribute('end') || '');
            const dur = parseTtmlTime(node.getAttribute('dur') || '');
            const duration = dur || Math.max(0, end - start);
            const text = decodeHTMLEntities(
              String(node.textContent || '')
                .replace(/\s+/g, ' ')
                .trim()
            );
            if (!text) return;
            cues.push({ start, duration, text });
          });
        }
      } catch (e) {
        /* empty */
      }
    }

    if (cues.length > 0) return cues;

    let match;
    while ((match = pTagRegex.exec(normalizedTtml)) !== null) {
      const attrs = match[1] || '';
      const inner = match[2] || '';

      const begin = /\bbegin\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '';
      const end = /\bend\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '';
      const dur = /\bdur\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '';

      const start = parseTtmlTime(begin);
      let duration = 0;
      if (dur) duration = parseTtmlTime(dur);
      else if (end) duration = Math.max(0, parseTtmlTime(end) - start);

      const text = decodeHTMLEntities(
        inner
          .replace(/<br\s*\/?\s*>/gi, ' ')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
      if (!text) continue;
      cues.push({ start, duration, text });
    }

    return cues;
  }

  /**
   * Escape XML entities
   * @param {string} text - Raw text
   * @returns {string} Escaped text
   */
  function escapeXML(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Convert cues to transcript XML
   * @param {any[]} cues - Array of cues
   * @returns {string} XML transcript
   */
  function convertToXML(cues) {
    const body = cues
      .map(cue => {
        const start = Number(cue?.start || 0);
        const duration = Number(cue?.duration || 0);
        const text = escapeXML(String(cue?.text || '').trim());
        return `<text start="${start.toFixed(3)}" dur="${duration.toFixed(3)}">${text}</text>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="utf-8"?><transcript>${body}</transcript>`;
  }

  /**
   * Set or replace query parameter in URL string
   * @param {string} inputUrl - Input URL
   * @param {string} key - Query key
   * @param {string} value - Query value
   * @returns {string} Updated URL
   */
  function setQueryParam(inputUrl, key, value) {
    try {
      const url = new URL(inputUrl);
      url.searchParams.set(key, value);
      return url.toString();
    } catch (e) {
      const encoded = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      const re = new RegExp(`([?&])${key}=[^&]*`);
      if (re.test(inputUrl)) return inputUrl.replace(re, `$1${encoded}`);
      return `${inputUrl}${inputUrl.includes('?') ? '&' : '?'}${encoded}`;
    }
  }

  /**
   * Remove query parameter from URL string.
   * @param {string} inputUrl
   * @param {string} key
   * @returns {string}
   */
  function removeQueryParam(inputUrl, key) {
    try {
      const url = new URL(inputUrl);
      url.searchParams.delete(key);
      return url.toString();
    } catch (e) {
      const re = new RegExp(`([?&])${key}=[^&]*`, 'g');
      const cleaned = String(inputUrl || '')
        .replace(re, '$1')
        .replace(/\?&/, '?');
      return cleaned.replace(/[?&]$/, '');
    }
  }

  /**
   * Check whether URL is a valid http(s) URL.
   * @param {string} inputUrl
   * @returns {boolean}
   */
  function isHttpUrl(inputUrl) {
    try {
      const parsed = new URL(String(inputUrl || ''));
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  /**
   * Keep only unique, valid http(s) subtitle candidates.
   * @param {string[]} urls
   * @returns {string[]}
   */
  function normalizeSubtitleCandidates(urls) {
    return Array.from(new Set((urls || []).filter(u => isHttpUrl(u))));
  }

  /**
   * Sleep helper for paced retries.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  /**
   * Build minimal candidates for rate-limit recovery.
   * Keeps only lean URLs (without fmt) and prioritizes no-translation/no-asr variants.
   * @param {string[]} candidates
   * @returns {string[]}
   */
  function buildMinimalRateLimitCandidates(candidates) {
    const preferred = [];
    for (const candidate of normalizeSubtitleCandidates(candidates)) {
      const noFmt = removeQueryParam(candidate, 'fmt');
      const noTlang = removeQueryParam(noFmt, 'tlang');
      const noAsr = removeQueryParam(noTlang, 'kind');
      preferred.push(noAsr);
      preferred.push(noTlang);
      preferred.push(noFmt);
    }
    return normalizeSubtitleCandidates(preferred).slice(0, 3);
  }

  /**
   * Build candidate subtitle URLs with multiple formats.
   * Strips any pre-existing `tlang` and `fmt` params from baseUrl before
   * adding new ones to prevent parameter duplication.
   * @param {string} baseUrl - Base subtitle URL
   * @param {string | null} translateTo - Target language
   * @returns {string[]} Candidate URLs
   */
  function buildSubtitleCandidates(baseUrl, translateTo) {
    if (!baseUrl) return [];

    // Strip any pre-existing tlang/fmt to prevent duplication
    let resolved = baseUrl;
    try {
      const url = new URL(resolved);
      url.searchParams.delete('tlang');
      url.searchParams.delete('fmt');
      resolved = url.toString();
    } catch (e) {
      // Fallback: strip via regex if URL is malformed
      resolved = resolved.replace(/[&?]tlang=[^&]*/g, '').replace(/[&?]fmt=[^&]*/g, '');
      // Fix dangling ? or &
      resolved = resolved.replace(/\?&/, '?').replace(/\?$/, '');
    }

    if (translateTo) {
      resolved = setQueryParam(resolved, 'tlang', translateTo);
    }

    // Build candidates with different subtitle formats
    const candidates = [
      resolved, // Try base URL without fmt first
      setQueryParam(resolved, 'fmt', 'srv1'),
      setQueryParam(resolved, 'fmt', 'json3'),
      setQueryParam(resolved, 'fmt', 'srv3'),
      setQueryParam(resolved, 'fmt', 'vtt'),
    ];

    return normalizeSubtitleCandidates(candidates);
  }

  /**
   * Build direct timedtext candidates when base URL is missing or expired.
   * @param {string} videoId - Video ID
   * @param {string} languageCode - Subtitle language
   * @param {boolean} isAutoGenerated - Whether source track is ASR
   * @param {string | null} translateTo - Target language
   * @returns {string[]} Candidate URLs
   */
  function buildDirectSubtitleCandidates(videoId, languageCode, isAutoGenerated, translateTo) {
    if (!videoId || !languageCode) return [];

    const base = 'https://www.youtube.com/api/timedtext';
    const common = new URLSearchParams({
      v: videoId,
      lang: languageCode,
    });
    if (isAutoGenerated) {
      common.set('kind', 'asr');
    }
    if (translateTo) {
      common.set('tlang', translateTo);
    }

    const withFmt = (fmt = '') => {
      const q = new URLSearchParams(common);
      if (fmt) q.set('fmt', fmt);
      return `${base}?${q.toString()}`;
    };

    return normalizeSubtitleCandidates([
      withFmt(),
      withFmt('srv1'),
      withFmt('srv3'),
      withFmt('json3'),
      withFmt('vtt'),
    ]);
  }

  /**
   * Try to detect subtitle payload format and validate parsed cues.
   * @param {string} raw
   * @returns {{ text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null}
   */
  function classifySubtitlePayload(raw) {
    const text = String(raw || '').trim();
    if (!text || text.length < 10) return null;

    // Reject HTML error pages
    if (
      text.includes('<!DOCTYPE') ||
      text.includes('<html') ||
      text.includes('</html>') ||
      /^\s*<!DOCTYPE/i.test(text)
    ) {
      return null;
    }

    if (text.startsWith('{')) {
      const cues = parseSubtitleJSON3(text);
      if (cues.length > 0) return { text, kind: 'json3' };
      return null;
    }

    if (text.includes('WEBVTT') || text.includes('-->')) {
      const cues = parseSubtitleVTT(text);
      if (cues.length > 0) return { text, kind: 'vtt' };
      return null;
    }

    if (text.includes('<transcript') || text.includes('<text')) {
      const cues = parseSubtitleXML(text);
      if (cues.length > 0) return { text, kind: 'xml' };
    }

    if (text.includes('<tt') || text.includes('<p ')) {
      const cues = parseSubtitleTTML(text);
      if (cues.length > 0) return { text, kind: 'ttml' };
    }

    if (text.length > 20) return { text, kind: 'raw' };
    return null;
  }

  /**
   * Firefox/userscript fallback: fetch subtitles via page-context fetch.
   * This avoids userscript CORS/sandbox edge-cases when timedtext requests fail.
   * @param {string[]} candidates
   * @returns {Promise<{ text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null>}
   */
  async function fetchSubtitlePayloadViaPageFetch(candidates) {
    try {
      const pageGlobal =
        typeof unsafeWindow !== 'undefined' ? /** @type {any} */ (unsafeWindow) : window;
      const pageFetch = pageGlobal?.fetch;
      if (typeof pageFetch !== 'function') return null;

      for (const candidateUrl of normalizeSubtitleCandidates(candidates)) {
        try {
          const response = await pageFetch(candidateUrl, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: { Accept: '*/*' },
          });
          if (!response || !response.ok) continue;
          const raw = await response.text();
          const detected = classifySubtitlePayload(raw);
          if (detected) return detected;
        } catch (e) {
          // Try next candidate
        }
      }
    } catch (e) {
      // Ignore and let caller handle final failure
    }
    return null;
  }

  /**
   * Try to download subtitle payload from candidate URLs
   * @param {string[]} candidates - Candidate URLs
   * @param {{ minimalMode?: boolean }} [options]
   * @returns {Promise<{ payload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null, hadRateLimit: boolean }>} Payload with metadata
   */
  async function fetchSubtitlePayload(candidates, options = {}) {
    /** @type {{ text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null} */
    let firstNonEmpty = null;
    let hadRateLimit = false;
    const minimalMode = options.minimalMode === true;
    const allProfiles = getSubtitleRequestProfiles();
    const profiles = minimalMode ? allProfiles.slice(0, 1) : allProfiles;

    const normalizedCandidates = minimalMode
      ? buildMinimalRateLimitCandidates(candidates)
      : normalizeSubtitleCandidates(candidates);

    for (const candidateUrl of normalizedCandidates) {
      for (const profile of profiles) {
        try {
          const response = await gmXmlHttpRequest({
            ...profile,
            url: candidateUrl,
          });

          const status = Number(response?.status || 0);
          if (status === 429) {
            hadRateLimit = true;
            // Pace retries to avoid repeating 429 bursts.
            await waitMs(350);
            continue;
          }
          // Only accept successful HTTP responses. status=0 is ambiguous in
          // GM_xmlhttpRequest (could be CORS block or local redirect).
          if (status !== 0 && !(status >= 200 && status < 400)) continue;

          const raw = await extractSubtitleBody(response);
          const detected = classifySubtitlePayload(raw);
          if (detected && detected.kind !== 'raw') {
            return { payload: detected, hadRateLimit };
          }
          if (!firstNonEmpty && detected) firstNonEmpty = detected;
        } catch (e) {
          // Try next request profile/candidate.
        }
      }

      if (hadRateLimit) {
        await waitMs(220);
      }
    }

    // Last-resort fallback for Firefox/userscript sandbox edge cases.
    if (!firstNonEmpty) {
      const pageFetched = await fetchSubtitlePayloadViaPageFetch(normalizedCandidates);
      if (pageFetched) {
        return { payload: pageFetched, hadRateLimit };
      }
    }

    // Minimal retry after cooldown when upstream responded with 429.
    if (!firstNonEmpty && hadRateLimit && !minimalMode) {
      await waitMs(1200);
      return fetchSubtitlePayload(normalizedCandidates, { minimalMode: true });
    }

    return { payload: firstNonEmpty, hadRateLimit };
  }

  /**
   * Download subtitle file
   * @param {object} options - Download options
   * @param {string} options.videoId - Video ID
   * @param {string} options.url - Subtitle URL
   * @param {string} options.languageCode - Language code
   * @param {string} options.languageName - Language name
   * @param {boolean} [options.isAutoGenerated=false] - Whether subtitle is auto-generated
   * @param {string} [options.format='srt'] - Format: 'srt', 'txt', 'xml'
   * @param {string | null} [options.translateTo] - Target language code for translation
   * @returns {Promise<void>}
   */
  async function downloadSubtitle(options = /** @type {any} */ ({})) {
    const {
      videoId,
      url: baseUrl,
      languageCode,
      languageName,
      isAutoGenerated = false,
      format = 'srt',
      translateTo = null,
    } = options;

    if (!videoId || (!baseUrl && !languageCode)) {
      throw new Error('Video ID and subtitle source are required');
    }

    const title = getVideoTitle();

    const isFirefox = /firefox/i.test(navigator.userAgent || '');
    const translatedCandidates = [
      ...buildSubtitleCandidates(baseUrl, translateTo),
      ...buildDirectSubtitleCandidates(videoId, languageCode, isAutoGenerated, translateTo),
    ];
    const sourceCandidates = [
      ...buildSubtitleCandidates(baseUrl, null),
      ...buildDirectSubtitleCandidates(videoId, languageCode, isAutoGenerated, null),
    ];
    const sourceNoAsrCandidates = [
      ...buildSubtitleCandidates(removeQueryParam(String(baseUrl || ''), 'tlang'), null),
      ...buildDirectSubtitleCandidates(videoId, languageCode, false, null),
    ];

    // Firefox: prefer minimal source candidates first to avoid timedtext 429 bursts
    // that are frequently triggered by translated ASR requests.
    const candidates = isFirefox
      ? buildMinimalRateLimitCandidates([
          ...sourceNoAsrCandidates,
          ...sourceCandidates,
          ...translatedCandidates,
        ])
      : translatedCandidates;

    NotificationManager.show(t('subtitleDownloading'), {
      duration: 2000,
      type: 'info',
    });

    let sawRateLimit = false;

    try {
      let { payload, hadRateLimit } = await fetchSubtitlePayload(candidates, {
        minimalMode: isFirefox,
      });
      sawRateLimit = sawRateLimit || hadRateLimit;

      if (!payload && hadRateLimit) {
        await waitMs(900);
      }

      // Fallback 1: if translated subtitles fail (404 is common for some target langs),
      // retry source captions without tlang.
      if (!payload && translateTo) {
        const sourceAttempt = await fetchSubtitlePayload(sourceCandidates);
        payload = sourceAttempt.payload;
        hadRateLimit = hadRateLimit || sourceAttempt.hadRateLimit;
        sawRateLimit = sawRateLimit || sourceAttempt.hadRateLimit;
      }

      // Fallback 2: some videos expose captions but reject kind=asr with translation;
      // retry direct timedtext without ASR flag and without tlang.
      if (!payload && isAutoGenerated) {
        const langOnlyAttempt = await fetchSubtitlePayload(sourceNoAsrCandidates);
        payload = langOnlyAttempt.payload;
        hadRateLimit = hadRateLimit || langOnlyAttempt.hadRateLimit;
        sawRateLimit = sawRateLimit || langOnlyAttempt.hadRateLimit;
      }

      // Fallback 3: aggressive minimal retry specifically for 429-heavy sessions.
      if (!payload && hadRateLimit) {
        const rateLimitCandidates = buildMinimalRateLimitCandidates([
          ...sourceNoAsrCandidates,
          ...sourceCandidates,
          ...translatedCandidates,
        ]);
        const finalAttempt = await fetchSubtitlePayload(rateLimitCandidates, { minimalMode: true });
        payload = finalAttempt.payload;
        sawRateLimit = sawRateLimit || finalAttempt.hadRateLimit;
      }

      // Fallback 4: Signed timedtext URLs expire after a few hours and YouTube returns
      // HTTP 200 with an empty body instead of 403. Re-fetch the watch page to get fresh
      // signed URLs and retry the download with those.
      if (!payload) {
        try {
          const freshPlayerResponse = await fetchPlayerResponseFromWatchHtml(videoId);
          const freshTracks =
            freshPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
          // Find a matching track by language code (exact match, then prefix match)
          const freshTrack =
            freshTracks.find(
              (/** @type {any} */ t) => String(t?.languageCode || '') === languageCode
            ) ||
            freshTracks.find((/** @type {any} */ t) =>
              String(t?.languageCode || '').startsWith(languageCode.split('-')[0])
            );
          if (freshTrack?.baseUrl) {
            const freshBase = normalizeSubtitleBaseUrl(freshTrack.baseUrl);
            const freshCandidates = [
              ...buildSubtitleCandidates(freshBase, translateTo),
              ...buildSubtitleCandidates(freshBase, null),
              ...buildDirectSubtitleCandidates(videoId, languageCode, isAutoGenerated, translateTo),
              ...buildDirectSubtitleCandidates(videoId, languageCode, false, null),
            ];
            const freshAttempt = await fetchSubtitlePayload(freshCandidates);
            payload = freshAttempt.payload;
            sawRateLimit = sawRateLimit || freshAttempt.hadRateLimit;
          }
        } catch (e) {
          // Non-critical — fall through to error below
        }
      }

      if (!payload) {
        throw new Error('Empty subtitle response');
      }

      const subtitleText = payload.text;
      const subtitleKind = payload.kind;

      /** @type {any[]} */
      let cues = [];
      if (subtitleKind === 'xml') cues = parseSubtitleXML(subtitleText);
      else if (subtitleKind === 'json3') cues = parseSubtitleJSON3(subtitleText);
      else if (subtitleKind === 'vtt') cues = parseSubtitleVTT(subtitleText);
      else if (subtitleKind === 'ttml') cues = parseSubtitleTTML(subtitleText);
      else {
        cues = parseSubtitleXML(subtitleText);
        if (cues.length === 0) cues = parseSubtitleJSON3(subtitleText);
        if (cues.length === 0) cues = parseSubtitleVTT(subtitleText);
        if (cues.length === 0) cues = parseSubtitleTTML(subtitleText);
      }

      let content;
      let extension;

      if (format === 'xml') {
        content = subtitleKind === 'xml' ? subtitleText : convertToXML(cues);
        extension = 'xml';
      } else {
        if (cues.length === 0) {
          throw new Error('No subtitle cues found');
        }

        if (format === 'srt') {
          content = convertToSRT(cues);
          extension = 'srt';
        } else if (format === 'txt') {
          content = convertToTXT(cues);
          extension = 'txt';
        } else {
          content = subtitleKind === 'xml' ? subtitleText : convertToXML(cues);
          extension = 'xml';
        }
      }

      // Create filename
      const langSuffix = translateTo ? `${languageCode}-${translateTo}` : languageCode;
      const filename = sanitizeFilename(`${title} - ${languageName} (${langSuffix}).${extension}`);

      // Download file
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      NotificationManager.show(t('subtitleDownloaded'), {
        duration: 3000,
        type: 'success',
      });

      logger.debug('Subtitle downloaded:', filename);
    } catch (error) {
      if (
        sawRateLimit &&
        String(/** @type {any} */ (error)?.message || '') === 'Empty subtitle response'
      ) {
        /** @type {any} */ (error).message =
          'YouTube temporarily limited subtitle requests (HTTP 429). Please retry in 20-60 seconds.';
      }
      logger.error('Error downloading subtitle:', error);
      NotificationManager.show(
        `${t('subtitleDownloadFailed')} ${/** @type {any} */ (error).message}`,
        {
          duration: 5000,
          type: 'error',
        }
      );
      throw error;
    }
  }

  /**
   * Download video or audio from YouTube
   *
   * This is the main download function that uses TubeInsights API (mp3yt.is)
   * to convert and download YouTube videos/audio.
   *
   * @param {object} options - Download options
   * @param {string} [options.format='video'] - Format: 'video' or 'audio'
   * @param {string} [options.quality='1080'] - Video quality: '144', '240', '360', '480', '720', '1080', '1440', '2160'
   * @param {string} [options.audioBitrate='320'] - Audio bitrate: '64', '128', '192', '256', '320'
   * @param {boolean} [options.embedThumbnail=true] - Embed thumbnail in audio file (requires ID3Writer)
   * @param {Function} [options.onProgress=null] - Progress callback (progress) => void
   * @returns {Promise<void>} Resolves when download completes
   *
   * @example
   * // Download 1080p video
   * await downloadVideo({ format: 'video', quality: '1080' });
   *
   * // Download 320kbps audio with album art
   * await downloadVideo({
   *   format: 'audio',
   *   audioBitrate: '320',
   *   embedThumbnail: true
   * });
   */
  async function downloadVideo(options = {}) {
    const {
      format = DownloadConfig.DEFAULTS.format,
      quality = DownloadConfig.DEFAULTS.videoQuality,
      audioBitrate = DownloadConfig.DEFAULTS.audioBitrate,
      embedThumbnail = DownloadConfig.DEFAULTS.embedThumbnail,
      onProgress = null,
    } = options;

    const videoId = getVideoId();
    if (!videoId) {
      throw new Error('Video ID not found');
    }

    const videoUrl = getVideoUrl();
    const title = getVideoTitle();

    // Show loading notification
    NotificationManager.show(t('startingDownload'), {
      duration: 2000,
      type: 'info',
    });

    try {
      // Step 1: Get API key from TubeInsights endpoint
      logger.debug('Fetching API key...');
      const keyResponse = await gmXmlHttpRequest({
        method: 'GET',
        url: DownloadConfig.API.KEY_URL,
        headers: DownloadConfig.HEADERS,
      });

      if (keyResponse.status !== 200) {
        throw new Error(`Failed to get API key: ${keyResponse.status}`);
      }

      const keyData = JSON.parse(keyResponse.responseText);
      if (!keyData || !keyData.key) {
        throw new Error('API key not found in response');
      }

      const { key } = keyData;
      logger.debug('API key obtained');

      // Step 2: Prepare conversion payload
      let payload;
      if (format === 'video') {
        // Use VP9 codec for 1440p and above, H264 for lower qualities
        const codec = parseInt(quality, 10) > 1080 ? 'vp9' : 'h264';
        payload = {
          link: videoUrl,
          format: 'mp4',
          audioBitrate: '128',
          videoQuality: quality,
          filenameStyle: 'pretty',
          vCodec: codec,
        };
      } else {
        payload = {
          link: videoUrl,
          format: 'mp3',
          audioBitrate,
          filenameStyle: 'pretty',
        };
      }

      // Step 3: Request conversion
      logger.debug('Requesting conversion...', payload);
      const customHeaders = {
        ...DownloadConfig.HEADERS,
        key,
      };

      const downloadResponse = await gmXmlHttpRequest({
        method: 'POST',
        url: DownloadConfig.API.CONVERT_URL,
        headers: customHeaders,
        data: JSON.stringify(payload),
      });

      if (downloadResponse.status !== 200) {
        throw new Error(`Conversion failed: ${downloadResponse.status}`);
      }

      const apiDownloadInfo = JSON.parse(downloadResponse.responseText);
      logger.debug('Conversion response:', apiDownloadInfo);

      if (!apiDownloadInfo.url) {
        throw new Error('No download URL received from API');
      }

      // Step 4: Download the file
      logger.debug('Downloading file from:', apiDownloadInfo.url);
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'undefined') {
          // Fallback: open in new tab
          logger.warn('GM_xmlhttpRequest not available, opening in new tab');
          window.open(apiDownloadInfo.url, '_blank');
          resolve();
          return;
        }

        GM_xmlhttpRequest({
          method: 'GET',
          url: apiDownloadInfo.url,
          responseType: 'blob',
          headers: {
            'User-Agent': DownloadConfig.HEADERS['User-Agent'],
            Referer: 'https://mp3yt.is/',
            Accept: '*/*',
          },
          onprogress: (/** @type {any} */ progress) => {
            if (onProgress) {
              onProgress({
                loaded: progress.loaded,
                total: progress.total,
                percent: progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0,
              });
            }
          },
          onload: async (/** @type {any} */ response) => {
            if (response.status === 200 && response.response) {
              let blob = response.response;

              if (blob.size === 0) {
                reject(new Error(t('zeroBytesError')));
                return;
              }

              window.YouTubeUtils &&
                /** @type {any} */ (YouTubeUtils).logger?.debug &&
                /** @type {any} */ (YouTubeUtils).logger.debug(
                  `[Download] File downloaded: ${formatBytes(blob.size)}`
                );

              // Embed thumbnail for audio files
              if (format === 'audio' && embedThumbnail) {
                try {
                  logger.debug('Embedding album art...');
                  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
                  const albumArt = await createSquareAlbumArt(thumbnailUrl);
                  blob = await embedAlbumArtToMP3(blob, albumArt, { title });
                  logger.debug('Album art embedded successfully');
                } catch (error) {
                  logger.error('Failed to embed album art:', error);
                  // Continue with download even if album art embedding fails
                }
              }

              // Create download link and trigger download
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = blobUrl;

              const filename =
                apiDownloadInfo.filename || `${title}.${format === 'video' ? 'mp4' : 'mp3'}`;
              a.download = sanitizeFilename(filename);

              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);

              // Clean up blob URL after download
              setTimeout(() => URL.revokeObjectURL(blobUrl), 100);

              NotificationManager.show(t('downloadCompleted'), {
                duration: 3000,
                type: 'success',
              });

              logger.debug('Download completed:', filename);
              resolve();
            } else {
              reject(new Error(`Download failed: ${response.status}`));
            }
          },
          onerror: () => reject(new Error('Download failed - network error')),
          ontimeout: () => reject(new Error('Download timeout')),
        });
      });
    } catch (error) {
      logger.error('Error:', /** @type {any} */ (error));
      NotificationManager.show(`${t('downloadFailed')} ${/** @type {any} */ (error).message}`, {
        duration: 5000,
        type: 'error',
      });
      throw error;
    }
  }

  /**
   * Initialize module
   * This module doesn't create any UI, just exposes the API
   */
  // --- Modal UI for Direct Download (lightweight, self-contained) ---
  /** @type {any} */
  let _modalElements = null;

  function createTabButtons(/** @type {(format: string) => void} */ onTabChange) {
    const tabContainer = document.createElement('div');
    tabContainer.setAttribute('role', 'tablist');
    Object.assign(/** @type {any} */ (tabContainer).style || {}, {
      display: 'flex',
      gap: '8px',
      padding: '12px',
      justifyContent: 'center',
      alignItems: 'center',
      background: 'transparent',
    });

    const videoTab = /** @type {any} */ (document.createElement('button'));
    videoTab.textContent = t('videoTab');
    videoTab.dataset.format = 'video';

    const audioTab = /** @type {any} */ (document.createElement('button'));
    audioTab.textContent = t('audioTab');
    audioTab.dataset.format = 'audio';

    const subTab = /** @type {any} */ (document.createElement('button'));
    subTab.textContent = t('subtitleTab');
    subTab.dataset.format = 'subtitle';

    [videoTab, audioTab, subTab].forEach(btn => {
      Object.assign(btn.style, {
        flex: 'initial',
        padding: '8px 18px',
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
        transition: 'all 0.18s ease',
        color: '#666',
        borderRadius: '999px',
      });
      // Accessibility & artifact prevention
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.style.outline = 'none';
      btn.style.userSelect = 'none';
    });

    function setActive(/** @type {any} */ btn) {
      // Reset all to inactive style
      [videoTab, audioTab, subTab].forEach(b => {
        b.style.background = 'transparent';
        b.style.color = '#666';
        b.style.border = '1px solid rgba(255,255,255,0.06)';
        b.style.boxShadow = 'none';
        b.setAttribute('aria-selected', 'false');
      });

      // Active look: green for main, white text.
      Object.assign(btn.style, {
        background: '#10c56a',
        color: '#fff',
        border: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 1px 0 rgba(0,0,0,0.04) inset',
      });
      btn.setAttribute('aria-selected', 'true');

      // Notify consumer about tab change (guarded to avoid throwing during early render)
      try {
        onTabChange(btn.dataset.format);
      } catch (e) {
        // ignore - avoids visual glitches if consumer manipulates DOM before it's fully appended
      }
    }

    // Add click handlers that also remove focus to prevent outline artifacts
    [videoTab, audioTab, subTab].forEach(btn => {
      btn.addEventListener('click', () => {
        setActive(btn);
        try {
          btn.blur();
        } catch (e) {
          /* ignore */
          void e; // Non-critical, suppressed
          /* ignore */
        }
      });
    });

    tabContainer.appendChild(videoTab);
    tabContainer.appendChild(audioTab);
    tabContainer.appendChild(subTab);

    // Arrow key navigation for tab buttons (accessibility)
    tabContainer.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tabs = [videoTab, audioTab, subTab];
      const idx = tabs.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
      if (idx < 0) return;
      e.preventDefault();
      const next =
        e.key === 'ArrowRight'
          ? tabs[(idx + 1) % tabs.length]
          : tabs[(idx - 1 + tabs.length) % tabs.length];
      next.focus();
      next.click();
    });

    // Set initial active tab after buttons are appended to DOM to avoid first-render artifacts
    // setTimeout 0 yields the same-tick deferred execution without blocking
    setTimeout(() => setActive(videoTab), 0);

    return tabContainer;
  }

  function buildModalForm() {
    // Quality selection container (we will render custom pill buttons into this div)
    const qualitySelect = /** @type {any} */ (document.createElement('div'));
    qualitySelect.role = 'radiogroup';
    // allow using .value property like the select element
    qualitySelect.value = DownloadConfig.DEFAULTS.videoQuality;
    Object.assign(qualitySelect.style || {}, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '10px',
      padding: '12px 6px',
      borderRadius: '10px',
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
    });

    const embedCheckbox = document.createElement('input');
    embedCheckbox.type = 'checkbox';
    embedCheckbox.checked = DownloadConfig.DEFAULTS.embedThumbnail;

    const embedLabel = /** @type {any} */ (document.createElement('label'));
    embedLabel.style.fontSize = '13px';
    embedLabel.style.display = 'flex';
    embedLabel.style.alignItems = 'center';
    embedLabel.style.gap = '6px';
    embedLabel.style.color = '#fff';
    // Keep the embed thumbnail option always enabled but hidden from the UI
    embedLabel.style.display = 'none';
    embedLabel.appendChild(embedCheckbox);
    embedLabel.appendChild(document.createTextNode(t('embedThumbnail')));

    const subtitleWrapper = /** @type {any} */ (document.createElement('div'));
    subtitleWrapper.style.display = 'none';

    const subtitleSelect = createSubtitleSelect();

    // Subtitle format buttons (SRT/TXT/XML) rendered as pill buttons
    const formatSelect = /** @type {any} */ (document.createElement('div'));
    formatSelect.role = 'radiogroup';
    formatSelect.value = 'srt';
    Object.assign(formatSelect.style || {}, {
      display: 'flex',
      gap: '8px',
      padding: '6px 0',
      borderRadius: '6px',
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
    });
    ['srt', 'txt', 'xml'].forEach((/** @type {string} */ fmt) => {
      const btn = /** @type {any} */ (document.createElement('button'));
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.dataset.value = fmt;
      btn.textContent = fmt.toUpperCase();
      Object.assign(btn.style || {}, {
        padding: '6px 12px',
        borderRadius: '999px',
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
      });
      btn.addEventListener('click', () => {
        Array.from(formatSelect.children).forEach((/** @type {any} */ c) => {
          c.style.background = 'transparent';
          c.style.color = '#fff';
          c.style.border = '1px solid rgba(255,255,255,0.08)';
          if (c.setAttribute) c.setAttribute('aria-checked', 'false');
        });
        btn.style.background = '#111';
        btn.style.color = '#10c56a';
        btn.style.border = '1px solid rgba(16,197,106,0.15)';
        btn.setAttribute('aria-checked', 'true');
        formatSelect.value = fmt;
      });
      formatSelect.appendChild(btn);
    });
    // select default
    const _defaultFmtBtn = /** @type {any} */ (
      Array.from(formatSelect.children).find(
        (/** @type {any} */ c) => c.dataset?.value === formatSelect.value
      )
    );
    if (_defaultFmtBtn) _defaultFmtBtn.click();

    subtitleWrapper.appendChild(subtitleSelect);
    subtitleWrapper.appendChild(formatSelect);

    const cancelBtn = /** @type {any} */ (document.createElement('button'));
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('cancel');
    Object.assign(cancelBtn.style || {}, {
      padding: '8px 16px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.12)',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: '14px',
      color: '#fff',
    });

    const downloadBtn = /** @type {any} */ (document.createElement('button'));
    downloadBtn.type = 'button';
    downloadBtn.textContent = t('download');
    Object.assign(downloadBtn.style || {}, {
      padding: '8px 20px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.12)',
      background: 'transparent',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
    });

    const progressWrapper = /** @type {any} */ (document.createElement('div'));
    progressWrapper.style.display = 'none';
    progressWrapper.style.marginTop = '12px';

    const progressBar = /** @type {any} */ (document.createElement('div'));
    Object.assign(progressBar.style || {}, {
      width: '100%',
      height: '3px',
      background: '#e0e0e0',
      borderRadius: '5px',
      overflow: 'hidden',
      marginBottom: '6px',
    });

    const progressFill = /** @type {any} */ (document.createElement('div'));
    Object.assign(progressFill.style || {}, {
      width: '0%',
      height: '100%',
      background: '#1a73e8',
      transition: 'width 200ms linear',
    });

    progressBar.appendChild(progressFill);

    const progressText = /** @type {any} */ (document.createElement('div'));
    progressText.style.fontSize = '12px';
    progressText.style.color = '#666';

    progressWrapper.appendChild(progressBar);
    progressWrapper.appendChild(progressText);

    return {
      qualitySelect,
      embedLabel,
      subtitleWrapper,
      subtitleSelect,
      formatSelect,
      cancelBtn,
      downloadBtn,
      progressWrapper,
      progressFill,
      progressText,
    };
  }

  /**
   * Disable form controls during download
   * @param {any} formParts - Form elements
   */
  function disableFormControls(/** @type {any} */ formParts) {
    try {
      if (formParts.qualitySelect) formParts.qualitySelect.disabled = true;
      if (formParts.downloadBtn) {
        formParts.downloadBtn.disabled = true;
        formParts.downloadBtn.style.opacity = '0.5';
        formParts.downloadBtn.style.cursor = 'not-allowed';
      }
      if (formParts.cancelBtn) formParts.cancelBtn.disabled = true;
    } catch (e) {
      console.error('Error disabling form controls:', e);
    }
  }

  /**
   * Enable form controls after download
   * @param {any} formParts - Form elements
   */
  function enableFormControls(/** @type {any} */ formParts) {
    try {
      if (formParts.qualitySelect) formParts.qualitySelect.disabled = false;
      if (formParts.downloadBtn) formParts.downloadBtn.disabled = false;
      if (formParts.cancelBtn) formParts.cancelBtn.disabled = false;

      // Reset button styles to ensure they're clickable
      if (formParts.downloadBtn) {
        formParts.downloadBtn.style.opacity = '1';
        formParts.downloadBtn.style.cursor = 'pointer';
        formParts.downloadBtn.style.pointerEvents = 'auto';
      }
    } catch (e) {
      console.error('Error enabling form controls:', e);
    }
  }

  /**
   * Initialize progress display
   * @param {any} formParts - Form elements
   */
  function initializeProgress(/** @type {any} */ formParts) {
    formParts.progressWrapper.style.display = '';
    formParts.progressFill.style.width = '0%';
    formParts.progressText.textContent = t('starting');
  }

  /**
   * Handle subtitle download
   * @param {any} formParts - Form elements
   * @param {Function} getSubtitlesData - Function to get subtitles data
   */
  async function handleSubtitleDownload(
    /** @type {any} */ formParts,
    /** @type {any} */ getSubtitlesData
  ) {
    const subtitlesData = getSubtitlesData();
    const selectedIndex = parseInt(formParts.subtitleSelect.value, 10);
    const subtitle = subtitlesData.all[selectedIndex];
    const subtitleFormat = formParts.formatSelect.value;

    if (!subtitle) {
      throw new Error(t('noSubtitleSelected'));
    }

    const videoId = getVideoId() || '';
    // For auto-translated subtitles, use the source track language as the primary
    // languageCode (for timedtext API `lang` param) and the target as `translateTo`.
    const effectiveLanguageCode = subtitle.sourceLanguageCode || subtitle.languageCode;
    const effectiveTranslateTo = subtitle.translateTo || null;
    await downloadSubtitle({
      videoId,
      url: subtitle.url,
      languageCode: effectiveLanguageCode,
      languageName: subtitle.name,
      isAutoGenerated: !!subtitle.isAutoGenerated,
      format: subtitleFormat,
      translateTo: effectiveTranslateTo,
    });
  }

  /**
   * Handle video/audio download
   * @param {any} formParts - Form elements
   * @param {string} format - Download format
   */
  async function handleMediaDownload(formParts, format) {
    const opts = {
      format,
      quality: formParts.qualitySelect.value,
      audioBitrate: formParts.qualitySelect.value,
      embedThumbnail: format === 'audio',
      onProgress: (/** @type {any} */ p) => {
        const loaded = Number(p?.loaded || 0);
        const total = Number(p?.total || 0);
        const hasTotal = Number.isFinite(total) && total > 0;
        let percent = Number(p?.percent || 0);

        if (hasTotal) {
          percent = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
          formParts.progressFill.style.width = `${percent}%`;
          formParts.progressText.textContent = `${percent}% • ${formatBytes(loaded)} / ${formatBytes(total)}`;
          return;
        }

        // Indeterminate progress fallback for servers that don't send content-length.
        const pseudoPercent = Math.min(95, Math.max(5, Math.round(Math.log2(loaded + 1) * 4)));
        formParts.progressFill.style.width = `${pseudoPercent}%`;
        formParts.progressText.textContent = `${t('downloading')} • ${formatBytes(loaded)} / —`;
      },
    };

    await downloadVideo(opts);
  }

  /**
   * Complete download and close modal
   * @param {any} formParts - Form elements
   */
  function completeDownload(formParts) {
    formParts.progressText.textContent = t('completed');
    setTimeout(() => closeModal(), 800);
  }

  /**
   * Handle download error
   * @param {any} formParts - Form elements
   * @param {Error} err - Error object
   */
  function handleDownloadError(formParts, err) {
    const errorMsg = err?.message || 'Unknown error';
    formParts.progressText.textContent = `${t('downloadFailed')} ${errorMsg}`;
    formParts.progressText.style.color = '#ff5555';

    // Ensure controls are re-enabled even if something goes wrong
    enableFormControls(formParts);

    // Add a safety timeout to force re-enable after 500ms
    setTimeout(() => {
      try {
        enableFormControls(formParts);
      } catch (e) {
        console.error('Failed to re-enable controls:', e);
      }
    }, 500);

    // Reset progress text color after 3 seconds
    setTimeout(() => {
      formParts.progressText.style.color = '#fff';
    }, 3000);
  }

  function wireModalEvents(
    /** @type {any} */ formParts,
    /** @type {any} */ activeFormatGetter,
    /** @type {any} */ getSubtitlesData
  ) {
    formParts.cancelBtn.addEventListener('click', () => closeModal());

    formParts.downloadBtn.addEventListener('click', async () => {
      // Prevent multiple simultaneous downloads
      if (formParts.downloadBtn.disabled) return;

      disableFormControls(formParts);
      initializeProgress(formParts);

      const format = activeFormatGetter();

      try {
        if (format === 'subtitle') {
          await handleSubtitleDownload(formParts, getSubtitlesData);
        } else {
          await handleMediaDownload(formParts, format);
        }
        completeDownload(formParts);
      } catch (err) {
        console.error('[Download Error]:', err);
        handleDownloadError(formParts, /** @type {any} */ (err));
      } finally {
        // Extra safety: ensure controls are re-enabled
        setTimeout(() => {
          if (formParts.downloadBtn && !formParts.downloadBtn.disabled) {
            return; // Already enabled
          }
          enableFormControls(formParts);
        }, 1000);
      }
    });
  }

  /**
   * Load subtitles into the provided form parts and fill subtitlesData
   * Separated from createModalUI to reduce function length for linting.
   */
  async function loadSubtitlesForForm(
    /** @type {any} */ formParts,
    /** @type {any} */ subtitlesData
  ) {
    const videoId = getVideoId();
    if (!videoId) return;

    formParts.subtitleSelect.setPlaceholder(t('loading'));
    formParts.subtitleSelect.disabled = true;

    try {
      const data = await getSubtitles(videoId);
      if (!data) {
        formParts.subtitleSelect.setPlaceholder(t('noSubtitles'));
        return;
      }

      subtitlesData.original = data.subtitles;
      subtitlesData.translated = data.autoTransSubtitles.map((/** @type {any} */ autot) => ({
        ...autot,
        url: autot.url || data.subtitles[0]?.url || '',
        translateTo: autot.languageCode,
      }));
      subtitlesData.all = [...subtitlesData.original, ...subtitlesData.translated];

      if (subtitlesData.all.length === 0) {
        formParts.subtitleSelect.setPlaceholder(t('noSubtitles'));
        return;
      }

      const opts = subtitlesData.all.map((/** @type {any} */ sub, /** @type {number} */ idx) => ({
        value: idx,
        text: sub.name + (sub.translateTo ? t('autoTranslateSuffix') : ''),
      }));
      formParts.subtitleSelect.setOptions(opts);
      formParts.subtitleSelect.disabled = false;
    } catch (err) {
      logger.error('Failed to load subtitles:', err);
      formParts.subtitleSelect.setPlaceholder(t('subtitleLoadError'));
    }
  }

  /**
   * Update quality/options UI depending on active format.
   * Extracted from createModalUI to satisfy max-lines-per-function.
   */
  function updateQualityOptionsForForm(
    /** @type {any} */ formParts,
    /** @type {any} */ activeFormat,
    /** @type {any} */ subtitlesData
  ) {
    if (activeFormat === 'subtitle') {
      formParts.qualitySelect.style.display = 'none';
      formParts.embedLabel.style.display = 'none';
      formParts.subtitleWrapper.style.display = 'block';
      loadSubtitlesForForm(formParts, subtitlesData);
      return;
    }

    if (activeFormat === 'video') {
      formParts.qualitySelect.style.display = 'flex';
      formParts.embedLabel.style.display = 'none';
      formParts.subtitleWrapper.style.display = 'none';

      // Render custom pill buttons for video qualities, split low/high and show VP9 label
      formParts.qualitySelect.replaceChildren();
      const lowQuals = DownloadConfig.VIDEO_QUALITIES.filter(q => parseInt(q, 10) <= 1080);
      const highQuals = DownloadConfig.VIDEO_QUALITIES.filter(q => parseInt(q, 10) > 1080);

      function makeQualityButton(/** @type {string} */ q) {
        const btn = /** @type {any} */ (document.createElement('button'));
        btn.type = 'button';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', 'false');
        btn.dataset.value = q;
        btn.textContent = `${q}p`;
        Object.assign(btn.style || {}, {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderRadius: '999px',
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.02)',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: '600',
        });

        btn.addEventListener('click', () => {
          Array.from(formParts.qualitySelect.children).forEach((/** @type {any} */ c) => {
            if (c.dataset && c.dataset.value) {
              c.style.background = 'transparent';
              c.style.color = '#fff';
              c.style.border = '1px solid rgba(255,255,255,0.08)';
              if (c.setAttribute) c.setAttribute('aria-checked', 'false');
            }
          });
          btn.style.background = '#111';
          btn.style.color = '#10c56a';
          btn.style.border = '1px solid rgba(16,197,106,0.15)';
          btn.setAttribute('aria-checked', 'true');
          formParts.qualitySelect.value = q;
        });

        return btn;
      }

      lowQuals.forEach(q => formParts.qualitySelect.appendChild(makeQualityButton(q)));

      if (highQuals.length > 0) {
        const labelWrap = /** @type {any} */ (document.createElement('div'));
        Object.assign(labelWrap.style || {}, {
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          width: '100%',
          margin: '8px 0',
        });
        const lineLeft = /** @type {any} */ (document.createElement('div'));
        lineLeft.style.flex = '1';
        lineLeft.style.borderTop = '1px solid rgba(255,255,255,0.06)';
        const label = /** @type {any} */ (document.createElement('div'));
        label.textContent = t('vp9Label');
        Object.assign(label.style || {}, {
          fontSize: '12px',
          color: 'rgba(255,255,255,0.7)',
          padding: '0 8px',
        });
        const lineRight = /** @type {any} */ (document.createElement('div'));
        lineRight.style.flex = '1';
        lineRight.style.borderTop = '1px solid rgba(255,255,255,0.06)';
        labelWrap.appendChild(lineLeft);
        labelWrap.appendChild(label);
        labelWrap.appendChild(lineRight);
        formParts.qualitySelect.appendChild(labelWrap);

        highQuals.forEach(q => formParts.qualitySelect.appendChild(makeQualityButton(q)));
      }

      // select default
      formParts.qualitySelect.value = DownloadConfig.DEFAULTS.videoQuality;
      const defaultBtn = Array.from(formParts.qualitySelect.children).find(
        c => c.dataset && c.dataset.value === formParts.qualitySelect.value
      );
      if (defaultBtn) defaultBtn.click();

      return;
    }

    // audio
    formParts.qualitySelect.style.display = 'flex';
    formParts.embedLabel.style.display = 'flex';
    formParts.subtitleWrapper.style.display = 'none';

    // Render pill buttons for audio bitrates
    formParts.qualitySelect.replaceChildren();
    DownloadConfig.AUDIO_BITRATES.forEach((/** @type {string} */ b) => {
      const btn = /** @type {any} */ (document.createElement('button'));
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.dataset.value = b;
      btn.textContent = `${b} kbps`;
      Object.assign(btn.style || {}, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '999px',
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
      });

      btn.addEventListener('click', () => {
        Array.from(formParts.qualitySelect.children).forEach((/** @type {any} */ c) => {
          c.style.background = 'transparent';
          c.style.color = '#fff';
          c.style.border = '1px solid rgba(255,255,255,0.08)';
          if (c.setAttribute) c.setAttribute('aria-checked', 'false');
        });
        btn.style.background = '#111';
        btn.style.color = '#10c56a';
        btn.style.border = '1px solid rgba(16,197,106,0.15)';
        btn.setAttribute('aria-checked', 'true');
        formParts.qualitySelect.value = b;
      });

      formParts.qualitySelect.appendChild(btn);
    });
    formParts.qualitySelect.value = DownloadConfig.DEFAULTS.audioBitrate;
    const defaultAudioBtn = Array.from(formParts.qualitySelect.children).find(
      c => c.dataset.value === formParts.qualitySelect.value
    );
    if (defaultAudioBtn) defaultAudioBtn.click();
    // Do not show the embed thumbnail control in the UI; embedding is always enabled
    formParts.embedLabel.style.display = 'none';
  }

  function createModalUI() {
    if (_modalElements) return _modalElements;

    let activeFormat = 'video';
    const subtitlesData = { all: [], original: [], translated: [] };

    const overlay = /** @type {any} */ (document.createElement('div'));
    Object.assign(overlay.style || {}, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '999999',
    });

    const box = /** @type {any} */ (document.createElement('div'));
    Object.assign(box.style || {}, {
      width: '420px',
      maxWidth: '94%',
      background: 'rgba(20,20,20,0.64)',
      color: '#fff',
      borderRadius: '12px',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      fontFamily: 'Arial, sans-serif',
      border: '1px solid rgba(255,255,255,0.06)',
      backdropFilter: 'blur(8px)',
    });

    const formParts = buildModalForm();

    const tabContainer = createTabButtons(format => {
      activeFormat = format;
      updateQualityOptionsForForm(formParts, activeFormat, subtitlesData);
    });

    const content = /** @type {any} */ (document.createElement('div'));
    content.style.padding = '16px';
    content.appendChild(formParts.qualitySelect);
    content.appendChild(formParts.embedLabel);
    content.appendChild(formParts.subtitleWrapper);
    content.appendChild(formParts.progressWrapper);

    const btnRow = /** @type {any} */ (document.createElement('div'));
    Object.assign(btnRow.style || {}, {
      display: 'flex',
      gap: '8px',
      padding: '16px',
      justifyContent: 'center',
    });
    btnRow.appendChild(formParts.cancelBtn);
    btnRow.appendChild(formParts.downloadBtn);

    box.appendChild(tabContainer);
    box.appendChild(content);
    box.appendChild(btnRow);
    overlay.appendChild(box);

    updateQualityOptionsForForm(formParts, activeFormat, subtitlesData);
    wireModalEvents(
      formParts,
      () => activeFormat,
      () => subtitlesData
    );
    _modalElements = { overlay, box, ...formParts };
    return _modalElements;
  }

  function openModal() {
    const els = createModalUI();
    if (!els) return;
    try {
      if (!document.body.contains(els.overlay)) document.body.appendChild(els.overlay);
    } catch (e) {
      /* ignore */
      void e; // Non-critical, suppressed
      /* ignore */
    }
  }

  function closeModal() {
    if (!_modalElements) return;
    try {
      // Clean up subtitle select listener to prevent document click leak
      const ss = _modalElements.overlay?.querySelector('[role="listbox"]');
      if (ss && typeof ss.destroy === 'function') ss.destroy();
      if (_modalElements.overlay && _modalElements.overlay.parentNode) {
        _modalElements.overlay.parentNode.removeChild(_modalElements.overlay);
      }
    } catch (e) {
      /* ignore */
      void e; // Non-critical, suppressed
      /* ignore */
    }
    _modalElements = null;
  }

  // ============================================================================
  // DOWNLOAD BUTTON UI (merged from download-button.js)
  // ============================================================================

  /**
   * Helper to wait for download API to be available
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Object|undefined>} Download API or undefined
   */
  const waitForDownloadAPI = timeout =>
    new Promise(resolve => {
      const interval = 200;
      let waited = 0;

      if (typeof window.YouTubePlusDownload !== 'undefined') {
        return resolve(window.YouTubePlusDownload);
      }

      const id = setInterval(() => {
        waited += interval;
        if (typeof window.YouTubePlusDownload !== 'undefined') {
          clearInterval(id);
          return resolve(window.YouTubePlusDownload);
        }
        if (waited >= timeout) {
          clearInterval(id);
          return resolve(undefined);
        }
      }, interval);
      // Register with cleanupManager for safe SPA cleanup
      try {
        if (window.YouTubeUtils?.cleanupManager?.registerInterval) {
          window.YouTubeUtils.cleanupManager.registerInterval(id);
        }
      } catch (e) {
        // Non-critical, suppressed
      }
    });

  /**
   * Fallback clipboard copy with modern API priority
   * @param {string} text - Text to copy
   * @param {Function} tFn - Translation function
   * @param {any} notificationMgr - Notification manager
   */
  const fallbackCopyToClipboard = async (text, tFn, notificationMgr) => {
    try {
      // Modern Clipboard API (preferred)
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        notificationMgr.show(tFn('copiedToClipboard'), {
          duration: 2000,
          type: 'success',
        });
        return;
      }

      // Fallback: textarea + Selection API for older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      Object.assign(ta.style, {
        position: 'fixed',
        left: '-9999px',
        top: '-9999px',
        opacity: '0',
      });
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);

      let copied = false;
      try {
        // execCommand is deprecated but still the only sync fallback
        copied = document.execCommand('copy');
      } catch (e) {
        logger.warn('[Download] execCommand copy not supported');
      }
      document.body.removeChild(ta);

      if (copied) {
        notificationMgr.show(tFn('copiedToClipboard'), {
          duration: 2000,
          type: 'success',
        });
      } else {
        notificationMgr.show(tFn('copyFailed') || 'Copy failed', {
          duration: 2000,
          type: 'error',
        });
      }
    } catch (e) {
      logger.warn('[Download] Clipboard copy failed:', e);
      notificationMgr.show(tFn('copyFailed') || 'Copy failed', {
        duration: 2000,
        type: 'error',
      });
    }
  };

  /**
   * Build URL from template
   * @param {string} template - URL template
   * @param {string} videoId - Video ID
   * @param {string} videoUrl - Full video URL
   * @returns {string} Built URL
   */
  const buildUrl = (template, videoId, videoUrl) =>
    (template || '')
      .replace('{videoId}', videoId || '')
      .replace('{videoUrl}', encodeURIComponent(videoUrl || ''));

  /**
   * Create download button element
   * @param {Function} tFn - Translation function
   * @returns {HTMLElement} Button element
   */
  const createButtonElement = tFn => {
    const button = document.createElement('div');
    button.className = 'ytp-button ytp-download-button';
    button.setAttribute('title', tFn('downloadOptions'));
    button.setAttribute('tabindex', '0');
    button.setAttribute('role', 'button');
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = _createHTML(`
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;vertical-align:middle;">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    `);
    return button;
  };

  /**
   * Position dropdown below button (batched with RAF)
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} dropdown - Dropdown element
   */
  const positionDropdown = (() => {
    /** @type {any} */ let rafId = null;
    /** @type {any} */ let pendingButton = null;
    /** @type {any} */ let pendingDropdown = null;

    const applyPosition = () => {
      if (!pendingButton || !pendingDropdown) return;

      const rect = pendingButton.getBoundingClientRect();
      const left = Math.max(8, rect.left + rect.width / 2 - 75);
      const bottom = Math.max(8, window.innerHeight - rect.top + 12);
      pendingDropdown.style.left = `${left}px`;
      pendingDropdown.style.bottom = `${bottom}px`;

      rafId = null;
      pendingButton = null;
      pendingDropdown = null;
    };

    return (/** @type {any} */ button, /** @type {any} */ dropdown) => {
      pendingButton = button;
      pendingDropdown = dropdown;

      if (rafId !== null) return; // Already scheduled
      rafId = requestAnimationFrame(applyPosition);
    };
  })();

  /**
   * Download Site Actions - Handle different types of downloads
   */
  const createDownloadActions = (/** @type {any} */ tFn, /** @type {any} */ ytUtils) => {
    /**
     * Handle direct download
     */
    const handleDirectDownload = async () => {
      const api = await waitForDownloadAPI(2000);
      if (!api) {
        console.error('[YouTube+] Direct download module not loaded');
        ytUtils.NotificationManager.show(tFn('directDownloadModuleNotAvailable'), {
          duration: 3000,
          type: 'error',
        });
        return;
      }

      try {
        if (typeof (/** @type {any} */ (api).openModal) === 'function') {
          /** @type {any} */ (api).openModal();
          return;
        }
        if (typeof (/** @type {any} */ (api).downloadVideo) === 'function') {
          await /** @type {any} */ (api).downloadVideo({ format: 'video', quality: '1080' });
          return;
        }
      } catch (err) {
        console.error('[YouTube+] Direct download invocation failed:', err);
      }

      ytUtils.NotificationManager.show(tFn('directDownloadModuleNotAvailable'), {
        duration: 3000,
        type: 'error',
      });
    };

    /**
     * Handle YTDL download - copies URL to clipboard and opens YTDL
     * @param {string} url - YTDL URL
     */
    const handleYTDLDownload = url => {
      const videoId = new URLSearchParams(location.search).get('v');
      const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

      // Copy to clipboard
      navigator.clipboard
        .writeText(videoUrl)
        .then(() => {
          ytUtils.NotificationManager.show(tFn('copiedToClipboard'), {
            duration: 2000,
            type: 'success',
          });
        })
        .catch(() => {
          fallbackCopyToClipboard(videoUrl, tFn, ytUtils.NotificationManager);
        });

      // Open YTDL in new tab
      window.open(url, '_blank');
    };

    /**
     * Helper to open download site or trigger direct download
     * @param {string} url - Download URL
     * @param {boolean} isYTDL - Whether this is YTDL download
     * @param {boolean} isDirect - Whether this is direct download
     * @param {HTMLElement} dropdown - Dropdown element to hide
     * @param {HTMLElement} button - Button element
     */
    const openDownloadSite = (url, isYTDL, isDirect, dropdown, button) => {
      dropdown.classList.remove('visible');
      button.setAttribute('aria-expanded', 'false');

      if (isDirect) {
        handleDirectDownload();
        return;
      }

      if (isYTDL) {
        handleYTDLDownload(url);
        return;
      }

      window.open(url, '_blank');
    };

    return { handleDirectDownload, handleYTDLDownload, openDownloadSite };
  };

  /**
   * Download Sites Configuration Builder
   * @param {Function} tFn - Translation function
   * @returns {Function} Builder function
   */
  const createDownloadSitesBuilder = tFn => {
    return (
      /** @type {any} */ customization,
      /** @type {any} */ enabledSites,
      /** @type {any} */ videoId,
      /** @type {any} */ videoUrl
    ) => {
      const baseSites = [
        {
          key: 'externalDownloader',
          name: customization?.externalDownloader?.name || 'SSYouTube',
          url: buildUrl(
            customization?.externalDownloader?.url || `https://ssyoutube.com/watch?v={videoId}`,
            videoId,
            videoUrl
          ),
          isYTDL: false,
          isDirect: false,
        },
        {
          key: 'ytdl',
          name: 'by YTDL',
          url: `http://localhost:5005`,
          isYTDL: true,
          isDirect: false,
        },
        {
          key: 'direct',
          name: tFn('directDownload'),
          url: '#',
          isYTDL: false,
          isDirect: true,
        },
      ];

      const downloadSites = baseSites.filter(s => enabledSites[s.key] !== false);
      return { baseSites, downloadSites };
    };
  };

  /**
   * Create dropdown options element
   * @param {any[]} downloadSites - Download sites configuration
   * @param {HTMLElement} button - Button element
   * @param {Function} openDownloadSiteFn - Click handler
   * @returns {HTMLElement} Dropdown element
   */
  const createDropdownOptions = (downloadSites, button, openDownloadSiteFn) => {
    const options = document.createElement('div');
    options.className = 'download-options';
    options.setAttribute('role', 'menu');

    const list = document.createElement('div');
    list.className = 'download-options-list';

    downloadSites.forEach(site => {
      const opt = /** @type {any} */ (document.createElement('div'));
      opt.className = 'download-option-item';
      opt.textContent = site.name;
      opt.setAttribute('role', 'menuitem');
      opt.setAttribute('tabindex', '0');

      opt.dataset.url = site.url;
      opt.dataset.isYtdl = site.isYTDL ? 'true' : 'false';
      opt.dataset.isDirect = site.isDirect ? 'true' : 'false';

      list.appendChild(opt);
    });

    const handleOptionActivate = (/** @type {any} */ item) => {
      if (!item) return;
      openDownloadSiteFn(
        item.dataset.url,
        item.dataset.isYtdl === 'true',
        item.dataset.isDirect === 'true',
        options,
        button
      );
    };

    list.addEventListener('click', (/** @type {any} */ e) => {
      const item = e.target?.closest?.('.download-option-item');
      if (!item || !list.contains(item)) return;
      handleOptionActivate(item);
    });

    list.addEventListener('keydown', (/** @type {any} */ e) => {
      const item = e.target?.closest?.('.download-option-item');
      if (!item || !list.contains(item)) return;
      if (e.key === 'Enter' || e.key === ' ') {
        handleOptionActivate(item);
      }
    });

    options.appendChild(list);
    return options;
  };

  /**
   * Setup dropdown hover behavior with event delegation
   * Uses WeakMap to store timers per button/dropdown pair
   */
  const setupDropdownHoverBehavior = (() => {
    let initialized = false;
    const dropdownTimers = new WeakMap();

    const getTimer = (/** @type {any} */ element) => dropdownTimers.get(element);
    const setTimer = (/** @type {any} */ element, /** @type {any} */ timerId) =>
      dropdownTimers.set(element, timerId);
    const clearTimer = (/** @type {any} */ element) => {
      const timerId = getTimer(element);
      if (timerId !== undefined) {
        clearTimeout(timerId);
        dropdownTimers.delete(element);
      }
    };

    const showDropdown = (/** @type {any} */ button, /** @type {any} */ dropdown) => {
      clearTimer(button);
      clearTimer(dropdown);
      positionDropdown(button, dropdown);
      dropdown.classList.add('visible');
      button.setAttribute('aria-expanded', 'true');
    };

    const hideDropdown = (/** @type {any} */ button, /** @type {any} */ dropdown) => {
      clearTimer(button);
      clearTimer(dropdown);
      const timerId = setTimeout(() => {
        dropdown.classList.remove('visible');
        button.setAttribute('aria-expanded', 'false');
      }, 180);
      setTimer(button, timerId);
    };

    const initDelegation = () => {
      if (initialized) return;
      initialized = true;

      // Mouseenter/mouseleave delegation on document with capture phase
      document.addEventListener(
        'mouseenter',
        e => {
          const button = /** @type {any} */ (e.target)?.closest?.('.ytp-download-button');
          if (button) {
            const dropdown = $('.download-options');
            if (dropdown) {
              clearTimer(button);
              clearTimer(dropdown);
              showDropdown(button, dropdown);
            }
            return;
          }

          const dropdown = /** @type {any} */ (e.target)?.closest?.('.download-options');
          if (dropdown) {
            const button = $('.ytp-download-button');
            if (button) {
              clearTimer(button);
              clearTimer(dropdown);
              showDropdown(button, dropdown);
            }
          }
        },
        true
      );

      document.addEventListener(
        'mouseleave',
        e => {
          const button = /** @type {any} */ (e.target)?.closest?.('.ytp-download-button');
          if (button) {
            const dropdown = $('.download-options');
            if (dropdown) {
              clearTimer(button);
              clearTimer(dropdown);
              const timerId = setTimeout(() => hideDropdown(button, dropdown), 180);
              setTimer(button, timerId);
            }
            return;
          }

          const dropdown = /** @type {any} */ (e.target)?.closest?.('.download-options');
          if (dropdown) {
            const button = $('.ytp-download-button');
            if (button) {
              clearTimer(button);
              clearTimer(dropdown);
              const timerId = setTimeout(() => hideDropdown(button, dropdown), 180);
              setTimer(dropdown, timerId);
            }
          }
        },
        true
      );

      // Keydown delegation for Enter/Space on button
      document.addEventListener('keydown', e => {
        const button = /** @type {any} */ (e.target)?.closest?.('.ytp-download-button');
        if (!button) return;

        if (e.key === 'Enter' || e.key === ' ') {
          const dropdown = $('.download-options');
          if (!dropdown) return;

          if (dropdown.classList.contains('visible')) {
            hideDropdown(button, dropdown);
          } else {
            showDropdown(button, dropdown);
          }
        }
      });
    };

    // Return function that just initializes delegation once
    return (/** @type {any} */ _button, /** @type {any} */ _dropdown) => {
      initDelegation();
    };
  })();

  /**
   * Download Button Manager - Handles download button creation and dropdown management
   * @param {object} config - Configuration object
   * @param {any} config.settings - Settings object
   * @param {Function} config.t - Translation function
   * @param {Function} config.getElement - Get element function
   * @param {any} config.YouTubeUtils - YouTube utilities
   * @returns {any} Download button manager API
   */
  const createDownloadButtonManager = config => {
    const { settings, t: tFn, getElement, YouTubeUtils: ytUtils } = config;

    const actions = createDownloadActions(tFn, ytUtils);
    const buildDownloadSites = createDownloadSitesBuilder(tFn);

    /**
     * Add download button to controls
     * @param {HTMLElement} controls - Controls container
     */
    const addDownloadButton = controls => {
      if (!settings.enableDownload) return;

      try {
        const existingBtn = controls.querySelector('.ytp-download-button');
        if (existingBtn) existingBtn.remove();
      } catch (e) {
        // ignore
      }

      const videoId = new URLSearchParams(location.search).get('v');
      const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

      const customization = settings.downloadSiteCustomization || {
        externalDownloader: { name: 'SSYouTube', url: 'https://ssyoutube.com/watch?v={videoId}' },
      };

      const enabledSites = settings.downloadSites || {
        externalDownloader: true,
        ytdl: true,
        direct: true,
      };
      const { downloadSites } = buildDownloadSites(customization, enabledSites, videoId, videoUrl);

      const button = /** @type {any} */ (createButtonElement(tFn));

      if (downloadSites.length === 1) {
        const singleSite = downloadSites[0];
        button.style.cursor = 'pointer';
        const tempDropdown = document.createElement('div');
        button.addEventListener('click', () =>
          actions.openDownloadSite(
            singleSite.url,
            singleSite.isYTDL,
            singleSite.isDirect,
            tempDropdown,
            button
          )
        );
        controls.insertBefore(button, controls.firstChild);
        return;
      }

      const dropdown = createDropdownOptions(downloadSites, button, actions.openDownloadSite);

      const existingDownload = $('.download-options');
      if (existingDownload) existingDownload.remove();

      try {
        document.body.appendChild(dropdown);
      } catch (e) {
        button.appendChild(dropdown);
      }

      setupDropdownHoverBehavior(button, dropdown);

      try {
        if (typeof window !== 'undefined') {
          /** @type {any} */ (window).youtubePlus = /** @type {any} */ (window).youtubePlus || {};
          /** @type {any} */ (window).youtubePlus.downloadButtonManager =
            /** @type {any} */ (window).youtubePlus.downloadButtonManager || {};

          /** @type {any} */ (window).youtubePlus.downloadButtonManager.addDownloadButton = (
            /** @type {any} */ controlsArg
          ) => addDownloadButton(controlsArg);
          /** @type {any} */ (window).youtubePlus.downloadButtonManager.refreshDownloadButton =
            () => {
              try {
                const btn = $('.ytp-download-button');
                const dd = $('.download-options');

                // If we should show downloads but the elements are missing, attempt to recreate
                if (settings.enableDownload && (!btn || !dd)) {
                  try {
                    const controlsEl = $('.ytp-right-controls');
                    if (controlsEl) {
                      // recreate button + dropdown
                      addDownloadButton(/** @type {HTMLElement} */ (controlsEl));
                    }
                  } catch (e) {
                    /* ignore recreation errors */
                  }
                }

                if (settings.enableDownload) {
                  if (btn && /** @type {any} */ (btn).style) /** @type {any} */ {
                    btn.style.display = '';
                  }
                  if (dd && /** @type {any} */ (dd).style) /** @type {any} */ {
                    dd.style.display = '';
                  }
                } else {
                  if (btn && /** @type {any} */ (btn).style) /** @type {any} */ {
                    btn.style.display = 'none';
                  }
                  if (dd && /** @type {any} */ (dd).style) /** @type {any} */ {
                    dd.style.display = 'none';
                  }
                }
              } catch (e) {
                /* ignore */
                void e; // Non-critical, suppressed
                /* ignore */
              }
            };

          /** @type {any} */ (window).youtubePlus.rebuildDownloadDropdown = () => {
            try {
              const controlsEl = $('.ytp-right-controls');
              if (!controlsEl) return;
              /** @type {any} */ (window).youtubePlus.downloadButtonManager.addDownloadButton(
                /** @type {HTMLElement} */ (controlsEl)
              );
              /** @type {any} */ (window).youtubePlus.settings =
                /** @type {any} */ (window).youtubePlus.settings || settings;
            } catch (e) {
              console.warn('[YouTube+] rebuildDownloadDropdown failed:', e);
            }
          };
        }
      } catch (e) {
        console.warn('[YouTube+] expose rebuildDownloadDropdown failed:', e);
      }

      controls.insertBefore(button, controls.firstChild);
    };

    /**
     * Refresh download button visibility based on settings
     */
    const refreshDownloadButton = () => {
      const button = getElement('.ytp-download-button');
      let dropdown = $('.download-options');

      // If downloads are enabled but the dropdown/button are missing, recreate them
      if (settings.enableDownload && (!button || !dropdown)) {
        try {
          const controlsEl = $('.ytp-right-controls');
          if (controlsEl) {
            addDownloadButton(/** @type {HTMLElement} */ (controlsEl));
            // re-query after creation
            dropdown = $('.download-options');
          }
        } catch (e) {
          logger && logger.warn && logger.warn('[YouTube+] recreate download button failed:', e);
        }
      }

      if (settings.enableDownload) {
        if (button && /** @type {any} */ (button).style) /** @type {any} */ {
          button.style.display = '';
        }
        if (dropdown && /** @type {any} */ (dropdown).style) /** @type {any} */ {
          dropdown.style.display = '';
        }
      } else {
        if (button && /** @type {any} */ (button).style) /** @type {any} */ {
          button.style.display = 'none';
        }
        if (dropdown && /** @type {any} */ (dropdown).style) /** @type {any} */ {
          dropdown.style.display = 'none';
        }
      }
    };

    return {
      addDownloadButton,
      refreshDownloadButton,
    };
  };

  // ============================================================================
  // MODULE INITIALIZATION
  // ============================================================================

  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    try {
      window.YouTubeUtils &&
        /** @type {any} */ (YouTubeUtils).logger &&
        /** @type {any} */ (YouTubeUtils).logger.debug &&
        /** @type {any} */ (YouTubeUtils).logger.debug('[YouTube+ Download] Unified module loaded');
      window.YouTubeUtils &&
        /** @type {any} */ (YouTubeUtils).logger &&
        /** @type {any} */ (YouTubeUtils).logger.debug &&
        /** @type {any} */ (YouTubeUtils).logger.debug(
          '[YouTube+ Download] Use window.YouTubePlusDownload.downloadVideo() to download'
        );
      window.YouTubeUtils &&
        /** @type {any} */ (YouTubeUtils).logger &&
        /** @type {any} */ (YouTubeUtils).logger.debug &&
        /** @type {any} */ (YouTubeUtils).logger.debug(
          '[YouTube+ Download] Button manager available'
        );
    } catch (e) {
      // Non-critical, suppressed
    }
  }

  // Export public API
  if (typeof window !== 'undefined') {
    window.YouTubePlusDownload = {
      downloadVideo,

      // Subtitle functions
      getSubtitles,
      downloadSubtitle,

      // Utility functions
      getVideoId,
      getVideoUrl,
      getVideoTitle,
      sanitizeFilename,
      formatBytes,

      // Configuration
      DownloadConfig,

      // UI: open modal for user selection
      openModal,

      // Initialize (called automatically)
      init,
    };

    // Export button manager for basic.js
    window.YouTubePlusDownloadButton = {
      createDownloadButtonManager:
        /** @type {(config: Record<string, unknown>) => { refreshDownloadButton(): void; addDownloadButton(): void; [key: string]: unknown }} */ (
          /** @type {unknown} */ (createDownloadButtonManager)
        ),
    };
  }

  // Export module to global scope for module loader
  if (typeof window !== 'undefined') {
    window.YouTubeDownload = {
      init,
      openModal,
      getVideoId,
      getVideoTitle,
      version: '3.0',
    };
  }

  const ensureInit = () => {
    if (!isRelevantRoute()) return;
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(init, { timeout: 1500 });
    } else {
      setTimeout(init, 0);
    }
  };

  // Register with LazyLoader for deferred initialization
  if (window.YouTubePlusLazyLoader) {
    window.YouTubePlusLazyLoader.register('download', ensureInit, { priority: 2 });
  } else {
    // Fallback: direct initialization
    onDomReady(ensureInit);
  }

  if (typeof window.YouTubeUtils?.cleanupManager?.registerListener === 'function') {
    YouTubeUtils.cleanupManager.registerListener(document, 'yt-navigate-finish', ensureInit, {
      passive: true,
    });
  } else {
    document.addEventListener('yt-navigate-finish', ensureInit, { passive: true });
  }
})();
