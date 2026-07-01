/**
 * YouTube+ Download Module
 * Unified download system with button UI and download functionality
 * @version 3.0
 */

(function () {
  const U = window.YouTubeUtils;
  const _setSafeHTML = U.setSafeHTML;
  const createVisibilityAwareInterval = /** @type {any} */ (U?.createVisibilityAwareInterval);
  const setTimeout_ = setTimeout.bind(window);
  const DOWNLOAD_STYLE_ID = 'ytp-download-styles';

  // Initialize logger early (logger.js loads before this module in build order)
  const _YouTubePlusLogger = /** @type {any} */ (window).YouTubePlusLogger;
  const logger =
    typeof _YouTubePlusLogger !== 'undefined' && _YouTubePlusLogger
      ? _YouTubePlusLogger.createLogger('Download')
      : {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        };

  const injectDownloadStyles = () => {
    try {
      const css = window.YouTubePlusDesignSystem?.getStyle(DOWNLOAD_STYLE_ID) || '';
      if (!css) return;
      const SM = YouTubeUtils?.StyleManager;
      if (SM && typeof SM.add === 'function') {
        SM.add(DOWNLOAD_STYLE_ID, css);
      }
    } catch (e) {
      logger?.warn?.('[YouTube+ Download] style injection failed:', e);
    }
  };

  /** @param {boolean} enabled */
  const refreshDownloadVisibility = enabled => {
    const btn = /** @type {HTMLElement | null} */ (document.querySelector('.ytp-download-button'));
    const dd = /** @type {HTMLElement | null} */ (document.querySelector('.download-options'));
    if (btn) btn.style.setProperty('display', enabled ? '' : 'none', 'important');
    if (dd) {
      dd.style.setProperty('display', enabled ? '' : 'none', 'important');
      if (!enabled) dd.classList.remove('visible');
    }
  };

  // -------------------------------------------------------------------------
  // PoT (Proof-of-Origin Token) collector
  // -------------------------------------------------------------------------
  // YouTube's `/api/timedtext` endpoint silently returns HTTP 200 with an
  // empty body for ASR (auto-generated) and many translated captions unless
  // the request carries a `pot` (BotGuard) token plus the matching client
  // metadata params. Userscripts cannot generate `pot` themselves, but the
  // YouTube player attaches it to every subtitle request it makes. We hook
  // `fetch`/`XMLHttpRequest` on `unsafeWindow` once at startup, observe the
  // player's own `/api/timedtext` URLs, extract `pot`+`potc`+client params,
  // cache them per `videoId`, and reuse them when downloading subtitles.
  // Verified against video E5XMrPPe1LQ (Russian ASR): without these params
  // every URL variant returns 0 bytes; with them, all formats (srv1/json3/
  // vtt/ttml) and translations return valid content (53-458 KB).
  /** @type {Map<string, Record<string, string>>} */
  const _potParamsByVideoId = new Map();
  const _POT_PARAMS_MAX = 50;
  /** Params copied from a player request to forge our own. */
  const _potCarriedParamNames = [
    'pot',
    'potc',
    'c',
    'cver',
    'cplayer',
    'cos',
    'cosver',
    'cplatform',
    'cbr',
    'cbrver',
    'xorb',
    'xobt',
    'xovt',
  ];
  let _potHooksInstalled = false;
  let _potElicitInflight = false;
  /** @type {Function|null} */
  let _origFetch = null;
  /** @type {Function|null} */
  let _origXhrOpen = null;

  function _pageGlobal() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }

  function _rememberPotFromTimedtextUrl(/** @type {string} */ rawUrl) {
    try {
      if (!rawUrl || rawUrl.indexOf('/api/timedtext') === -1) return;
      const u = new URL(rawUrl, 'https://www.youtube.com');
      const videoId = u.searchParams.get('v');
      const pot = u.searchParams.get('pot');
      if (!(videoId && pot)) return;
      /** @type {Record<string, string>} */
      const collected = {};
      for (const name of _potCarriedParamNames) {
        const value = u.searchParams.get(name);
        if (value != null && value !== '') collected[name] = value;
      }
      _potParamsByVideoId.set(videoId, collected);
      if (_potParamsByVideoId.size > _POT_PARAMS_MAX) {
        const firstKey = _potParamsByVideoId.keys().next().value;
        if (firstKey !== undefined) _potParamsByVideoId.delete(firstKey);
      }
    } catch (_e) {
      // Ignore parse failures — never break the page over a hook side-effect.
    }
  }

  function _installPotHooksOnce() {
    if (_potHooksInstalled) return;
    const pg = _pageGlobal();
    if (!pg || typeof pg !== 'object') return;
    try {
      _origFetch = pg.fetch;
      if (typeof _origFetch === 'function') {
        pg.fetch = function patchedFetch(input, _init) {
          try {
            const inputWithUrl = /** @type {{ url?: unknown }} */ (
              input && typeof input === 'object' ? input : {}
            );
            const url =
              typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.toString()
                  : typeof inputWithUrl.url === 'string'
                    ? inputWithUrl.url
                    : '';
            if (url) _rememberPotFromTimedtextUrl(url);
          } catch (_e) {
            // Never block the player's network requests
          }
          return /** @type {Function} */ (_origFetch).call(this, input, _init);
        };
      }
      const xhrProto = pg.XMLHttpRequest?.prototype;
      if (xhrProto && typeof xhrProto.open === 'function') {
        _origXhrOpen = /** @type {(...args: unknown[]) => void} */ (xhrProto.open);
        const patchedOpen = /** @this {XMLHttpRequest} */ function (
          /** @type {unknown[]} */ ...args
        ) {
          try {
            const url = args[1];
            if (typeof url === 'string') _rememberPotFromTimedtextUrl(url);
          } catch (_e) {
            // Ignore
          }
          return /** @type {Function} */ (_origXhrOpen).apply(this, args);
        };
        xhrProto.open = /** @type {typeof xhrProto.open} */ (patchedOpen);
      }
      _potHooksInstalled = true;
    } catch (_e) {
      // If we cannot patch (sandboxed window), we silently degrade.
    }
  }

  function _uninstallPotHooks() {
    if (!_potHooksInstalled) return;
    const pg = _pageGlobal();
    if (!pg || typeof pg !== 'object') return;
    try {
      if (_origFetch && typeof _origFetch === 'function') {
        pg.fetch = /** @type {typeof fetch} */ (_origFetch);
        _origFetch = null;
      }
      const xhrProto = pg.XMLHttpRequest?.prototype;
      if (_origXhrOpen && xhrProto && typeof _origXhrOpen === 'function') {
        xhrProto.open = /** @type {typeof xhrProto.open} */ (_origXhrOpen);
        _origXhrOpen = null;
      }
      _potHooksInstalled = false;
    } catch (_e) {
      // Best-effort restore
    }
  }
  // Install ASAP so we capture the very first caption request the player makes.
  _installPotHooksOnce();
  if (typeof U?.cleanupManager?.register === 'function') {
    U.cleanupManager.register(_uninstallPotHooks);
  }

  /**
   * Try to elicit a PoT for the currently playing video by briefly toggling
   * the player's caption track. Resolves once a pot has been captured or
   * after a short timeout. Idempotent and never throws.
   * @returns {Promise<boolean>}
   */
  async function _tryElicitPotForCurrentVideo() {
    if (_potElicitInflight) return false;
    _potElicitInflight = true;
    try {
      const pg = _pageGlobal();
      const videoId = (() => {
        try {
          const params = new URLSearchParams(pg.location?.search || '');
          return params.get('v') || '';
        } catch (_e) {
          return '';
        }
      })();
      if (!videoId) return false;
      if (_potParamsByVideoId.has(videoId)) return true;

      const playerEl = pg.document?.querySelector?.('.html5-video-player');
      if (!playerEl) return false;

      // Snapshot current caption state so we can restore it on the user's behalf.
      let priorTrack = null;
      try {
        priorTrack =
          typeof playerEl.getOption === 'function' ? playerEl.getOption('captions', 'track') : null;
      } catch (_e) {
        priorTrack = null;
      }

      // Pick an available track (prefer Russian ASR if present, else first).
      let trackToLoad = null;
      try {
        const list =
          typeof playerEl.getOption === 'function'
            ? playerEl.getOption('captions', 'tracklist', {
                includeAsr: true,
              }) || []
            : [];
        if (Array.isArray(list) && list.length) {
          trackToLoad = list.find(t => t && t.languageCode === 'ru' && t.kind === 'asr') || list[0];
        }
      } catch (_e) {
        trackToLoad = null;
      }

      if (trackToLoad && typeof playerEl.setOption === 'function') {
        try {
          playerEl.setOption('captions', 'track', trackToLoad);
        } catch (_e) {
          // Ignore — fall through to button-click fallback
        }
      } else {
        // Fallback: click the CC button to force a fetch
        try {
          const ccBtn = pg.document?.querySelector?.('.ytp-subtitles-button');
          if (ccBtn && ccBtn.getAttribute('aria-pressed') !== 'true') ccBtn.click();
        } catch (_e) {
          // Ignore
        }
      }

      // Poll for up to ~2s for a pot to land in the cache
      const deadline = Date.now() + 2200;
      while (Date.now() < deadline) {
        if (_potParamsByVideoId.has(videoId)) break;
        await waitMs(120);
      }

      // Restore prior caption state (turn off if it was off, or restore previous track)
      try {
        if (priorTrack && typeof playerEl.setOption === 'function') {
          playerEl.setOption('captions', 'track', priorTrack);
        } else if (typeof playerEl.toggleSubtitles === 'function') {
          // If we turned them on by clicking CC, turn them back off
          const ccBtn = pg.document?.querySelector?.('.ytp-subtitles-button');
          if (ccBtn && ccBtn.getAttribute('aria-pressed') === 'true') ccBtn.click();
        }
      } catch (_e) {
        // Ignore restore failures
      }

      return _potParamsByVideoId.has(videoId);
    } catch (_e) {
      return false;
    } finally {
      _potElicitInflight = false;
    }
  }

  function _getVideoIdFromCandidate(/** @type {string} */ url) {
    try {
      const u = new URL(url, 'https://www.youtube.com');
      return u.searchParams.get('v') || '';
    } catch (_e) {
      return '';
    }
  }

  /**
   * Given a list of candidate timedtext URLs, prepend equivalent variants
   * with PoT+client params applied (when known for the candidate's video).
   * @param {string[]} candidates
   * @returns {string[]}
   */
  function augmentSubtitleCandidatesWithPot(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return candidates || [];
    /** @type {string[]} */
    const augmented = [];
    for (const candidate of candidates) {
      try {
        const videoId = _getVideoIdFromCandidate(candidate);
        const params = videoId ? _potParamsByVideoId.get(videoId) : null;
        if (!params) continue;
        const u = new URL(candidate, 'https://www.youtube.com');
        for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
        augmented.push(u.toString());
      } catch (_e) {
        // Skip malformed candidate
      }
    }
    // De-duplicate while preserving order (augmented first, then originals)
    const merged = augmented.concat(candidates);
    return Array.from(new Set(merged.filter(u => typeof u === 'string' && u.length > 0)));
  }

  const isRelevantRoute = () => {
    return U.isWatchRoute() || U.isShortsRoute();
  };

  const onDomReady =
    U?.onDomReady ||
    (cb => {
      if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', cb, { once: true });
      else cb();
    });

  // Shared DOM helpers from YouTubeUtils
  const $ = (/** @type {string} */ sel) => U.$(sel);

  // Check dependencies
  if (typeof YouTubeUtils === 'undefined') {
    window.YouTubePlusLogger?.error?.('Download', 'YouTubeUtils not found!');
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
      color: 'var(--yt-text-primary)',
      cursor: 'pointer',
    });

    const _ssDisplay = document.createElement('div');
    Object.assign(/** @type {any} */ (_ssDisplay).style || {}, {
      padding: '10px 12px',
      borderRadius: '10px',
      background: 'linear-gradient(135deg, var(--yt-glass-bg), var(--yt-surface-overlay-faint))',
      border: '1px solid var(--yt-glass-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      backdropFilter: 'blur(6px)',
      boxShadow: '0 4px 18px var(--yt-shadow-inset-strong) inset',
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
      background: 'linear-gradient(180deg, var(--yt-glass-bg), var(--yt-surface-overlay-faint))',
      border: '1px solid var(--yt-glass-border)',
      boxShadow: '0 8px 30px var(--yt-shadow-flyout)',
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
      if (!(item && _ssList.contains(item))) return;
      subtitleSelect.value = /** @type {any} */ (item).dataset?.value || '';
      if (_ssList.style) _ssList.style.display = 'none';
    });

    _ssList.addEventListener('mouseover', (/** @type {Event} */ e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const item = target.closest('[data-value]');
      if (!(item && _ssList.contains(item))) return;
      if (/** @type {any} */ (item).style) {
        /** @type {any} */ item.style.background = 'var(--yt-surface-overlay-faint)';
      }
    });

    _ssList.addEventListener('mouseout', (/** @type {MouseEvent} */ e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const item = target.closest('[data-value]');
      if (!(item && _ssList.contains(item))) return;
      const related = e.relatedTarget;
      if (related && item.contains(/** @type {Node} */ (related))) return;
      if (/** @type {any} */ (item).style) {
        /** @type {any} */ item.style.background = 'transparent';
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
          borderBottom: '1px solid var(--yt-surface-overlay-faint)',
          color: 'var(--yt-text-primary)',
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
        if (!(target instanceof Node && subtitleSelect.contains(target))) {
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
    if (U?.t) return U.t(key, params);
    const str = String(key || '');
    if (!params || Object.keys(params).length === 0) return str;
    let result = str;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
  };

  /**
   * Download Configuration
   */
  const DownloadConfig = {
    // cnv.cx conversion backend endpoints
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
    if (U?.getVideoIdFromLocation) return U.getVideoIdFromLocation();
    try {
      const params = new URLSearchParams(window.location.search || '');
      const fromQuery = params.get('v');
      if (fromQuery) return fromQuery;
      const path = window.location.pathname || '';
      const shortsMatch = path.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch?.[1]) return shortsMatch[1];
      const liveMatch = path.match(/^\/live\/([a-zA-Z0-9_-]{11})/);
      if (liveMatch?.[1]) return liveMatch[1];
      const youtuBeMatch = (window.location.href || '').match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
      if (youtuBeMatch?.[1]) return youtuBeMatch[1];
    } catch (_e) {
      U?.logSuppressed?.(_e, 'Download');
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
   * Redact sensitive URL params and IDs before writing debug logs.
   * @param {string} rawUrl
   * @returns {string}
   */
  function sanitizeUrlForLog(rawUrl) {
    try {
      if (!rawUrl || typeof rawUrl !== 'string') return '';
      const u = new URL(rawUrl, window.location.origin || 'https://www.youtube.com');
      const sensitiveParams = [
        'v',
        'videoId',
        'pot',
        'potc',
        'key',
        'token',
        'sig',
        'signature',
        'oauth',
        'authorization',
        'cookie',
      ];
      for (const name of sensitiveParams) {
        if (u.searchParams.has(name)) {
          u.searchParams.set(name, '<redacted>');
        }
      }
      return `${u.origin}${u.pathname}`;
    } catch (_e) {
      return '<redacted-url>';
    }
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
    } catch (_e) {
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
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
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
    } catch (_e) {
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
      } catch (_e) {
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
        } catch (_e) {
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
          logger.warn(
            `Rate limit backoff: ${host} blocked for ${Math.ceil((backoff - now) / 1000)}s more`
          );
          return false;
        }

        const recent = (requests.get(host) || []).filter(t => now - t < timeWindowMs);
        if (recent.length >= maxRequests) {
          // S7: Apply exponential backoff (2s, 4s, 8s, 16s, max 60s)
          const consecutiveHits = Math.min(5, Math.floor(recent.length / maxRequests));
          const backoffMs = Math.min(60000, 2000 * 2 ** consecutiveHits);
          backoffUntil.set(host, now + backoffMs);
          logger.warn(
            `Rate limit: ${recent.length}/${maxRequests} requests to ${host}, backing off ${backoffMs}ms`
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
    /** @type {Map<string, { data: PlayerResponse, ts: number }>} */
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
      set(/** @type {string} */ videoId, /** @type {PlayerResponse} */ data) {
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
   * @returns {Promise<PlayerResponse>} Player data response
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

    const parsed = /** @type {PlayerResponse} */ (JSON.parse(response.responseText));
    _playerDataCache.set(videoId, parsed); // P5: store in cache
    return parsed;
  }

  /**
   * Extract available video qualities from player streaming data.
   * Uses only actual video-capable formats exposed by YouTube for the current video.
   * @param {PlayerResponse | null | undefined} playerData
   * @returns {string[]}
   */
  function extractAvailableVideoQualities(playerData) {
    const streamingData =
      /** @type {{ formats?: Array<{ mimeType?: string, qualityLabel?: string }>, adaptiveFormats?: Array<{ mimeType?: string, qualityLabel?: string }> }} */ (
        /** @type {any} */ (playerData)?.streamingData || {}
      );
    /** @type {Array<{ mimeType?: string, qualityLabel?: string }>} */
    const combined = [
      ...(Array.isArray(streamingData.formats) ? streamingData.formats : []),
      ...(Array.isArray(streamingData.adaptiveFormats) ? streamingData.adaptiveFormats : []),
    ];

    const qualitySet = new Set();
    combined.forEach(format => {
      const mimeType = String(format?.mimeType || '');
      if (!mimeType.includes('video/')) return;

      const qualityLabel = String(format?.qualityLabel || '').trim();
      const match = qualityLabel.match(/(\d{3,4})p/i);
      if (!match) return;

      qualitySet.add(match[1]);
    });

    return Array.from(qualitySet).sort((left, right) => Number(left) - Number(right));
  }

  /**
   * Get the actual available video qualities for the current video.
   * Falls back to watch HTML and then to configured defaults if player data is unavailable.
   * @param {string} videoId
   * @returns {Promise<string[]>}
   */
  async function getAvailableVideoQualities(videoId) {
    if (!videoId) return DownloadConfig.VIDEO_QUALITIES.slice();

    try {
      const playerData = await fetchPlayerData(videoId);
      const actualQualities = extractAvailableVideoQualities(playerData);
      if (actualQualities.length > 0) return actualQualities;
    } catch (error) {
      logger.warn('Primary player quality fetch failed:', error);
    }

    try {
      const fallbackPlayerData = await fetchPlayerResponseFromWatchHtml(videoId);
      const fallbackQualities = extractAvailableVideoQualities(fallbackPlayerData);
      if (fallbackQualities.length > 0) return fallbackQualities;
    } catch (error) {
      logger.warn('Watch HTML quality fallback failed:', error);
    }

    return DownloadConfig.VIDEO_QUALITIES.slice();
  }

  /**
   * Choose the initial quality selection from available options.
   * @param {string[]} qualities
   * @param {string} preferredQuality
   * @returns {string}
   */
  function pickDefaultVideoQuality(qualities, preferredQuality) {
    if (!Array.isArray(qualities) || qualities.length === 0) {
      return preferredQuality || DownloadConfig.DEFAULTS.videoQuality;
    }

    if (qualities.includes(preferredQuality)) return preferredQuality;
    if (qualities.includes(DownloadConfig.DEFAULTS.videoQuality)) {
      return DownloadConfig.DEFAULTS.videoQuality;
    }

    const sorted = qualities.slice().sort((left, right) => Number(left) - Number(right));
    return sorted[sorted.length - 1] || preferredQuality || DownloadConfig.DEFAULTS.videoQuality;
  }

  /**
   * Extract player response from watch HTML when runtime globals are unavailable.
   * @param {string} videoId - Video ID
   * @returns {Promise<PlayerResponse|null>} Parsed player response or null
   * @private
   */
  /**
   * Extract a balanced JSON object starting at the `{` at `startIdx` from `src`.
   * Respects strings and escape sequences so embedded `{}` inside string literals
   * do not throw off the brace counter. Returns null if no balanced object found.
   * @param {string} src
   * @param {number} startIdx
   * @returns {string|null}
   * @private
   */
  function extractBalancedJsonObject(src, startIdx) {
    if (startIdx < 0 || startIdx >= src.length || src[startIdx] !== '{') return null;
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = startIdx; i < src.length; i++) {
      const ch = src[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inStr) {
        if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inStr = false;
        }
        continue;
      }
      if (ch === '"') {
        inStr = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) return src.slice(startIdx, i + 1);
      }
    }
    return null;
  }

  async function fetchPlayerResponseFromWatchHtml(/** @type {string} */ videoId) {
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      const response = await gmXmlHttpRequest({ method: 'GET', url: watchUrl });
      if (response.status !== 200 || !response.responseText) return null;

      const html = String(response.responseText);
      // Locate ytInitialPlayerResponse assignment. Some adblock/userscripts
      // (e.g. jsonPrune) inject extra content after the value, so a lazy regex
      // ending at `;</script>` can capture mangled JSON. Use a balanced-brace
      // scanner that respects string literals to extract the exact object.
      const assignRe = /ytInitialPlayerResponse\s*=\s*\{/g;
      let match;
      while ((match = assignRe.exec(html)) !== null) {
        const braceIdx = match.index + match[0].length - 1;
        const jsonText = extractBalancedJsonObject(html, braceIdx);
        if (!jsonText) continue;
        try {
          return JSON.parse(jsonText);
        } catch (_e) {
          // Try the next occurrence (rare: multiple assignments)
        }
      }
      return null;
    } catch (error) {
      logger.warn('Watch HTML subtitle fallback failed:', error);
      return null;
    }
  }

  /**
   * Try to obtain captions renderer from page runtime state.
   * Helps in browsers where youtubei player request is blocked/limited.
   * @returns {{captions: PlayerCaptionsTracklistRenderer, videoTitle: string}|null}
   * @private
   */
  function getCaptionsFromPageFallback() {
    try {
      const title = getVideoTitle();
      const globalContext = _pageGlobal();

      const initial = globalContext.ytInitialPlayerResponse;
      const initialCaps = initial?.captions?.playerCaptionsTracklistRenderer;
      if (initialCaps) {
        return {
          captions: initialCaps,
          videoTitle: initial?.videoDetails?.title || title,
        };
      }

      const playerEl = U.byId('movie_player');
      /** @type {(HTMLElement & { getPlayerResponse?: () => PlayerResponse | null }) | null} */
      const player = playerEl instanceof HTMLElement ? playerEl : null;
      const response =
        (typeof player?.getPlayerResponse === 'function' && player.getPlayerResponse()) || null;
      const respCaps = response?.captions?.playerCaptionsTracklistRenderer;
      if (respCaps) {
        return {
          captions: respCaps,
          videoTitle: response?.videoDetails?.title || title,
        };
      }

      const ytPlayerResponse = globalContext?.ytplayer?.config?.args?.player_response;
      if (typeof ytPlayerResponse === 'string' && ytPlayerResponse.length > 0) {
        try {
          const parsed = JSON.parse(ytPlayerResponse);
          const parsedCaps = parsed?.captions?.playerCaptionsTracklistRenderer;
          if (parsedCaps) {
            return {
              captions: parsedCaps,
              videoTitle: parsed?.videoDetails?.title || title,
            };
          }
        } catch (_e) {
          U.logSuppressed(_e, 'Download');
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
      } catch (_e) {
        // Non-critical
      }
    }

    // Priority 4: response is an XML/HTML Document object
    if (rawResponse && typeof rawResponse === 'object') {
      const rawDocument = /** @type {Document | XMLDocument | null} */ (rawResponse);
      if (typeof rawDocument?.documentElement?.nodeName === 'string' && window.XMLSerializer) {
        try {
          const serialized = new window.XMLSerializer().serializeToString(rawDocument).trim();
          if (serialized) return serialized;
        } catch (_e) {
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
      } catch (_e) {
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
      } catch (_e) {
        // Non-critical
      }
    }

    // Priority 7: response is a Blob
    if (typeof Blob !== 'undefined' && rawResponse instanceof Blob) {
      try {
        return (await rawResponse.text()).trim();
      } catch (_e) {
        // Non-critical
      }
    }

    // Priority 8: response is a text-like object from userscript APIs
    if (rawResponse && typeof rawResponse === 'object') {
      /** @type {Record<string, unknown> & { text?: unknown; data?: unknown; content?: unknown }} */
      const rawObject = rawResponse;
      const maybeText = rawObject.text || rawObject.data || rawObject.content;
      if (typeof maybeText === 'string' && maybeText.trim()) {
        return maybeText.trim();
      }

      // Some wrappers expose async text() method
      if (typeof rawObject.text === 'function') {
        try {
          const extracted = await rawObject.text();
          if (typeof extracted === 'string' && extracted.trim()) {
            return extracted.trim();
          }
        } catch (_e) {
          // Non-critical
        }
      }
    }

    return '';
  }

  /**
   * Build fallback request profiles for subtitle payload retrieval.
   * @returns {GMRequestProfile[]}
   */
  function getSubtitleRequestProfiles() {
    return [
      {
        method: 'GET',
        withCredentials: true,
        anonymous: false,
        responseType: 'text', // Forces GM_xmlhttpRequest to populate responseText
        headers: {
          Referer: 'https://www.youtube.com/',
          // Avoid gzipped empty-body bug in some GM_xmlhttpRequest implementations.
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
      {
        method: 'GET',
        withCredentials: true,
        anonymous: false,
        // No responseType — lets Firefox return responseXML for XML content
        headers: {
          Referer: 'https://www.youtube.com/',
          'Accept-Encoding': 'identity',
        },
      },
    ];
  }

  /**
   * Parse caption tracks into subtitle objects
   * @param {CaptionTrack[]} captionTracks - Caption track data
   * @returns {SubtitleTrack[]} Subtitle objects
   * @private
   */
  function parseCaptionTracks(captionTracks) {
    return captionTracks.map(track => ({
      name: track.name?.simpleText || track.languageCode,
      languageCode: track.languageCode,
      url: buildSubtitleUrl(track.baseUrl),
      baseUrl: normalizeSubtitleBaseUrl(track.baseUrl),
      isAutoGenerated: track.kind === 'asr',
      trackId: String(track?.vssId || ''),
      kind: String(track?.kind || ''),
    }));
  }

  /**
   * Pick the most suitable caption track for translation or refresh retries.
   * Prefer exact baseUrl/lang/kind matches, then translatable tracks.
   * @param {CaptionTrack[]} captionTracks
   * @param {{ languageCode?: string, isAutoGenerated?: boolean | null, baseUrl?: string, trackId?: string }} [criteria]
   * @returns {CaptionTrack | null}
   */
  function findBestCaptionTrack(captionTracks, criteria = {}) {
    const tracks = Array.isArray(captionTracks) ? captionTracks.filter(Boolean) : [];
    if (tracks.length === 0) return null;

    const wantedLang = String(criteria.languageCode || '').trim();
    const wantedBaseUrl = normalizeSubtitleBaseUrl(criteria.baseUrl || '');
    const wantedTrackId = String(criteria.trackId || '').trim();
    const wantsAuto =
      typeof criteria.isAutoGenerated === 'boolean' ? criteria.isAutoGenerated : null;

    const scoreTrack = (/** @type {CaptionTrack} */ track) => {
      let score = 0;
      const trackBaseUrl = normalizeSubtitleBaseUrl(track?.baseUrl || '');
      const trackLang = String(track?.languageCode || '');
      const trackId = String(track?.vssId || '');
      const trackIsAuto = track?.kind === 'asr';
      const langPrefix = wantedLang ? wantedLang.split('-')[0] : '';

      if (wantedTrackId && trackId && trackId === wantedTrackId) score += 120;
      if (wantedBaseUrl && trackBaseUrl && trackBaseUrl === wantedBaseUrl) score += 100;
      if (wantedLang && trackLang === wantedLang) score += 40;
      else if (langPrefix && trackLang.startsWith(langPrefix)) score += 20;

      if (wantsAuto !== null) {
        score += trackIsAuto === wantsAuto ? 15 : -5;
      }

      if (track?.isTranslatable !== false) score += 5;
      if (trackBaseUrl) score += 2;
      return score;
    };

    return (
      tracks
        .map(track => ({ track, score: scoreTrack(track) }))
        .sort((left, right) => right.score - left.score)[0]?.track || null
    );
  }

  /**
   * Choose the source caption track used for translated subtitle variants.
   * @param {CaptionTrack[]} captionTracks
   * @returns {CaptionTrack | null}
   */
  function getTranslationSourceTrack(captionTracks) {
    return (
      findBestCaptionTrack(captionTracks, { isAutoGenerated: true }) ||
      findBestCaptionTrack(captionTracks) ||
      null
    );
  }

  /**
   * Parse translation languages into subtitle objects
   * @param {CaptionTranslationLanguage[]} translationLanguages - Translation language data
   * @param {CaptionTrack | null} sourceTrack - Source caption track used for translations
   * @returns {SubtitleTrack[]} Auto-translation subtitle objects
   * @private
   */
  function parseTranslationLanguages(translationLanguages, sourceTrack) {
    const sourceBaseUrl = normalizeSubtitleBaseUrl(sourceTrack?.baseUrl || '');
    const sourceLanguageCode = String(sourceTrack?.languageCode || '');
    const sourceTrackId = String(sourceTrack?.vssId || '');
    return translationLanguages.map(lang => ({
      name: lang.languageName?.simpleText || lang.languageCode,
      languageCode: lang.languageCode,
      sourceLanguageCode: sourceLanguageCode || '',
      baseUrl: sourceBaseUrl,
      url: buildSubtitleUrl(sourceBaseUrl),
      isAutoGenerated: sourceTrack?.kind === 'asr',
      trackId: sourceTrackId,
      translateTo: lang.languageCode,
    }));
  }

  /**
   * Create empty subtitle result
   * @param {string} videoId - Video ID
   * @param {string} videoTitle - Video title
   * @returns {SubtitleData} Empty subtitle result
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
   * @returns {Promise<SubtitleData | null>} Subtitle data or null on error
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
      const translationSourceTrack = getTranslationSourceTrack(captionTracks);

      return {
        videoId,
        videoTitle,
        subtitles: parseCaptionTracks(captionTracks),
        autoTransSubtitles: parseTranslationLanguages(translationLanguages, translationSourceTrack),
      };
    } catch (error) {
      logger.error('Error getting subtitles:', error);
      return null;
    }
  }

  /**
   * Parse subtitle XML to cues
   * @param {string} xml - XML subtitle content
   * @returns {SubtitleCue[]} Array of cues
   */
  function parseSubtitleXML(xml) {
    /** @type {SubtitleCue[]} */
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
      } catch (_e) {
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
    const pTagRegex = /<p\b([^>]*)>([\s\S]{0,20000}?)<\/p>/gi;
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
   * @returns {SubtitleCue[]} Array of cues
   */
  function parseSubtitleJSON3(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      const events = Array.isArray(data?.events) ? data.events : [];
      /** @type {SubtitleCue[]} */
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
    } catch (_e) {
      return [];
    }
  }

  /**
   * Parse VTT text to cues
   * @param {string} vttText - VTT subtitle content
   * @returns {SubtitleCue[]} Array of cues
   */
  function parseSubtitleVTT(vttText) {
    /** @type {SubtitleCue[]} */
    const cues = [];
    const blocks = String(vttText || '')
      .replace(/\r/g, '')
      .split(/\n\n+/);

    const parseClockTime = (/** @type {string} */ value) => {
      const raw = String(value || '').trim();
      if (!raw) return 0;
      const parts = raw.split(':');
      if (parts.length !== 2 && parts.length !== 3) return 0;
      const isNumericPart = (/** @type {string} */ part) => {
        if (!part) return false;
        let dotSeen = false;
        for (let i = 0; i < part.length; i += 1) {
          const ch = part[i];
          if (ch >= '0' && ch <= '9') continue;
          if (ch === '.' && !dotSeen) {
            dotSeen = true;
            continue;
          }
          return false;
        }
        return true;
      };
      if (!parts.every(isNumericPart)) return 0;

      let h = 0;
      let m = 0;
      let secPart = '';
      if (parts.length === 2) {
        m = Number(parts[0]);
        secPart = parts[1];
      } else {
        h = Number(parts[0]);
        m = Number(parts[1]);
        secPart = parts[2];
      }

      const dot = secPart.indexOf('.');
      const sec = Number(dot >= 0 ? secPart.slice(0, dot) : secPart);
      const frac = dot >= 0 ? secPart.slice(dot + 1) : '';
      const ms = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0;

      if (
        !(Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(sec) && Number.isFinite(ms))
      ) {
        return 0;
      }
      return h * 3600 + m * 60 + sec + ms / 1000;
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

      const start = parseClockTime(range[0]);
      const end = parseClockTime(range[1].split(' ')[0]);
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
   * @returns {SubtitleCue[]} Array of cues
   */
  function parseSubtitleTTML(ttmlText) {
    /** @type {SubtitleCue[]} */
    const cues = [];
    const normalizedTtml = String(ttmlText || '').replace(/\uFEFF/g, '');
    const pTagRegex = /<p\b([^>]*)>([\s\S]{0,20000}?)<\/p>/gi;

    const parseTtmlTime = (/** @type {string} */ value) => {
      const v = String(value || '').trim();
      if (!v) return 0;

      const last = v[v.length - 1];
      if (last === 's' || last === 'S') {
        const n = Number(v.slice(0, -1));
        return Number.isFinite(n) ? n : 0;
      }

      const parts = v.split(':');
      if (parts.length !== 2 && parts.length !== 3) return 0;
      const isNumericPart = (/** @type {string} */ part) => {
        if (!part) return false;
        let dotSeen = false;
        for (let i = 0; i < part.length; i += 1) {
          const ch = part[i];
          if (ch >= '0' && ch <= '9') continue;
          if (ch === '.' && !dotSeen) {
            dotSeen = true;
            continue;
          }
          return false;
        }
        return true;
      };
      if (!parts.every(isNumericPart)) return 0;

      let h = 0;
      let m = 0;
      let secPart = '';
      if (parts.length === 2) {
        m = Number(parts[0]);
        secPart = parts[1];
      } else {
        h = Number(parts[0]);
        m = Number(parts[1]);
        secPart = parts[2];
      }

      const dot = secPart.indexOf('.');
      const s = Number(dot >= 0 ? secPart.slice(0, dot) : secPart);
      const frac = dot >= 0 ? secPart.slice(dot + 1) : '';
      const ms = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0;
      if (
        !(Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s) && Number.isFinite(ms))
      ) {
        return 0;
      }
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
      } catch (_e) {
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
   * @param {SubtitleCue[]} cues - Array of cues
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
    } catch (_e) {
      const encoded = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      const str = String(inputUrl || '');
      const qPos = str.indexOf('?');
      const hashPos = str.indexOf('#');
      const baseEnd = qPos >= 0 ? qPos : hashPos >= 0 ? hashPos : str.length;
      const base = str.slice(0, baseEnd);
      const hash = hashPos >= 0 ? str.slice(hashPos) : '';
      const queryStart = qPos >= 0 ? qPos + 1 : baseEnd;
      const queryEnd = hashPos >= 0 ? hashPos : str.length;
      const rawQuery = str.slice(queryStart, queryEnd);
      const pairs = rawQuery ? rawQuery.split('&').filter(Boolean) : [];

      let replaced = false;
      for (let i = 0; i < pairs.length; i += 1) {
        const pair = pairs[i];
        const eq = pair.indexOf('=');
        const name = eq >= 0 ? pair.slice(0, eq) : pair;
        if (decodeURIComponent(name) === key) {
          pairs[i] = encoded;
          replaced = true;
        }
      }
      if (!replaced) pairs.push(encoded);
      return `${base}?${pairs.join('&')}${hash}`;
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
    } catch (_e) {
      const str = String(inputUrl || '');
      const qPos = str.indexOf('?');
      if (qPos < 0) return str;
      const hashPos = str.indexOf('#');
      const base = str.slice(0, qPos);
      const hash = hashPos >= 0 ? str.slice(hashPos) : '';
      const query = str.slice(qPos + 1, hashPos >= 0 ? hashPos : str.length);
      const nextPairs = query
        .split('&')
        .filter(Boolean)
        .filter(pair => {
          const eq = pair.indexOf('=');
          const name = eq >= 0 ? pair.slice(0, eq) : pair;
          return decodeURIComponent(name) !== key;
        });
      const nextQuery = nextPairs.join('&');
      return `${base}${nextQuery ? `?${nextQuery}` : ''}${hash}`;
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
    } catch (_e) {
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
    } catch (_e) {
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
    if (!(videoId && languageCode)) return [];

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
      const pageGlobal = /** @type {Window & typeof globalThis & { fetch?: unknown }} */ (
        _pageGlobal()
      );
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
          if (!response?.ok) continue;
          const raw = await response.text();
          const detected = classifySubtitlePayload(raw);
          if (detected) return detected;
        } catch (_e) {
          // Try next candidate
        }
      }
    } catch (_e) {
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

    // If we don't yet have a PoT for this video, try to elicit one once.
    // The YouTube player's own caption requests include `pot`+client params
    // that are required by the server for ASR/translated tracks.
    if (!minimalMode) {
      try {
        const candidateVideoId =
          (candidates || []).map(_getVideoIdFromCandidate).find(Boolean) || '';
        if (candidateVideoId && !_potParamsByVideoId.has(candidateVideoId)) {
          await _tryElicitPotForCurrentVideo();
        }
      } catch (_e) {
        // Non-critical
      }
    }

    const baseNormalized = minimalMode
      ? buildMinimalRateLimitCandidates(candidates)
      : normalizeSubtitleCandidates(candidates);
    const normalizedCandidates = minimalMode
      ? baseNormalized
      : augmentSubtitleCandidatesWithPot(baseNormalized);

    // Try page-context fetch first when available. The page is same-origin with
    // youtube.com and carries the full session, so signed timedtext URLs (and
    // ASR / translated tracks like Russian auto-generated) succeed there even
    // when GM_xmlhttpRequest returns HTTP 200 with an empty body.
    if (!minimalMode) {
      try {
        const earlyPageFetched = await fetchSubtitlePayloadViaPageFetch(normalizedCandidates);
        if (earlyPageFetched && earlyPageFetched.kind !== 'raw') {
          return { payload: earlyPageFetched, hadRateLimit };
        }
        if (earlyPageFetched && !firstNonEmpty) firstNonEmpty = earlyPageFetched;
      } catch (_e) {
        // Non-critical — fall through to GM_xmlhttpRequest loop.
      }
    }

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
        } catch (_e) {
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
   * Trigger a browser file download and revoke the object URL after the click settles.
   * Immediate revocation is flaky in Chromium/Firefox and breaks repeated downloads.
   * @param {Blob} blob
   * @param {string} filename
   * @param {number} [revokeDelayMs=1500]
   */
  function triggerBlobDownload(blob, filename, revokeDelayMs = 1500) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout_(() => URL.revokeObjectURL(blobUrl), Math.max(500, Number(revokeDelayMs) || 1500));
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
   * @param {string} [options.trackId] - Caption track identifier
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
      trackId = '',
    } = options;

    if (!(videoId && (baseUrl || languageCode))) {
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

    // When user explicitly selected auto-translation, never prioritize source
    // tracks, otherwise we may silently download the wrong language.
    const primaryCandidates = translateTo ? translatedCandidates : sourceCandidates;

    // Firefox: still use minimal candidate strategy to reduce 429 bursts, but
    // preserve user intent for translated subtitle downloads.
    const candidates = isFirefox
      ? buildMinimalRateLimitCandidates(
          translateTo ? [...primaryCandidates] : [...sourceNoAsrCandidates, ...sourceCandidates]
        )
      : primaryCandidates;

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

      // Fallback 1: some videos expose captions but reject kind=asr with translation;
      // retry direct timedtext without ASR flag and without tlang.
      if (!payload && isAutoGenerated && !translateTo) {
        const langOnlyAttempt = await fetchSubtitlePayload(sourceNoAsrCandidates);
        payload = langOnlyAttempt.payload;
        hadRateLimit = hadRateLimit || langOnlyAttempt.hadRateLimit;
        sawRateLimit = sawRateLimit || langOnlyAttempt.hadRateLimit;
      }

      // Fallback 2: aggressive minimal retry specifically for 429-heavy sessions.
      if (!payload && hadRateLimit) {
        const rateLimitCandidates = buildMinimalRateLimitCandidates(
          translateTo ? [...translatedCandidates] : [...sourceNoAsrCandidates, ...sourceCandidates]
        );
        const finalAttempt = await fetchSubtitlePayload(rateLimitCandidates, {
          minimalMode: true,
        });
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
          const freshTrack = findBestCaptionTrack(freshTracks, {
            languageCode,
            isAutoGenerated,
            baseUrl,
            trackId,
          });
          if (freshTrack?.baseUrl) {
            const freshBase = normalizeSubtitleBaseUrl(freshTrack.baseUrl);
            const freshCandidates = translateTo
              ? [
                  ...buildSubtitleCandidates(freshBase, translateTo),
                  ...buildDirectSubtitleCandidates(
                    videoId,
                    languageCode,
                    isAutoGenerated,
                    translateTo
                  ),
                ]
              : [
                  ...buildSubtitleCandidates(freshBase, null),
                  ...buildDirectSubtitleCandidates(videoId, languageCode, isAutoGenerated, null),
                  ...buildDirectSubtitleCandidates(videoId, languageCode, false, null),
                ];
            const freshAttempt = await fetchSubtitlePayload(freshCandidates);
            payload = freshAttempt.payload;
            sawRateLimit = sawRateLimit || freshAttempt.hadRateLimit;
          }
        } catch (_e) {
          // Non-critical — fall through to error below
        }
      }

      if (!payload) {
        if (translateTo) {
          throw new Error('Translated subtitle track is unavailable for this video/language');
        }
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
      triggerBlobDownload(blob, filename);

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
   * This is the main download function that uses the cnv.cx conversion backend
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
      // Step 1: Get conversion API key from cnv.cx backend
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
      if (!keyData?.key) {
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
      logger.debug('Requesting conversion...', {
        format: payload?.format,
        videoQuality: payload?.videoQuality,
        audioBitrate: payload?.audioBitrate,
      });
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
      logger.debug('Conversion response received');

      if (!apiDownloadInfo.url) {
        throw new Error('No download URL received from API');
      }

      // Step 4: Download the file
      logger.debug('Downloading file from:', sanitizeUrlForLog(String(apiDownloadInfo.url || '')));
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

              U &&
                /** @type {any} */ (YouTubeUtils).logger?.debug?.(
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
              const filename =
                apiDownloadInfo.filename || `${title}.${format === 'video' ? 'mp4' : 'mp3'}`;
              triggerBlobDownload(blob, sanitizeFilename(filename), 2000);

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
        border: '1px solid var(--yt-surface-overlay-border)',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
        transition:
          'background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.1s cubic-bezier(0.2,0,0,1), box-shadow 0.18s ease',
        color: 'var(--yt-muted-text)',
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
        b.style.color = 'var(--yt-muted-text)';
        b.style.border = '1px solid var(--yt-surface-overlay-border)';
        b.style.boxShadow = 'none';
        b.setAttribute('aria-selected', 'false');
      });

      // Active look: green for main, white text.
      Object.assign(btn.style, {
        background: 'var(--yt-success-accent)',
        color: 'var(--yt-text-primary)',
        border: '1px solid var(--yt-shadow-inset-soft)',
        boxShadow: '0 1px 0 var(--yt-shadow-inset-soft) inset',
      });
      btn.setAttribute('aria-selected', 'true');

      // Notify consumer about tab change (guarded to avoid throwing during early render)
      try {
        onTabChange(btn.dataset.format);
      } catch (_e) {
        // ignore - avoids visual glitches if consumer manipulates DOM before it's fully appended
      }
    }

    // Add click handlers that also remove focus to prevent outline artifacts
    [videoTab, audioTab, subTab].forEach(btn => {
      btn.addEventListener('click', () => {
        setActive(btn);
        try {
          btn.blur();
        } catch {
          /* ignore */
        }
      });
      btn.addEventListener('mousedown', () => {
        btn.style.transform = 'scale(0.96)';
      });
      const resetScale = () => {
        btn.style.transform = '';
      };
      btn.addEventListener('mouseup', resetScale);
      btn.addEventListener('mouseleave', resetScale);
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
    embedLabel.style.color = 'var(--yt-text-primary)';
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
        border: '1px solid var(--yt-surface-soft)',
        background: 'var(--yt-surface-overlay-faint)',
        color: 'var(--yt-text-primary)',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
      });
      btn.addEventListener('click', () => {
        Array.from(formatSelect.children).forEach((/** @type {any} */ c) => {
          c.style.background = 'transparent';
          c.style.color = 'var(--yt-text-primary)';
          c.style.border = '1px solid var(--yt-surface-soft)';
          if (c.setAttribute) c.setAttribute('aria-checked', 'false');
        });
        btn.style.background = 'var(--yt-surface-contrast)';
        btn.style.color = 'var(--yt-success-accent)';
        btn.style.border = '1px solid var(--yt-success-accent-soft)';
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
      border: '1px solid var(--yt-surface-active)',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: '14px',
      color: 'var(--yt-text-primary)',
    });

    const downloadBtn = /** @type {any} */ (document.createElement('button'));
    downloadBtn.type = 'button';
    downloadBtn.textContent = t('download');
    Object.assign(downloadBtn.style || {}, {
      padding: '8px 20px',
      borderRadius: '8px',
      border: '1px solid var(--yt-surface-active)',
      background: 'transparent',
      color: 'var(--yt-text-primary)',
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
      background: 'var(--yt-progress-track)',
      borderRadius: '5px',
      overflow: 'hidden',
      marginBottom: '6px',
    });

    const progressFill = /** @type {any} */ (document.createElement('div'));
    Object.assign(progressFill.style || {}, {
      width: '0%',
      height: '100%',
      background: 'var(--yt-progress-fill)',
      transition: 'width 200ms linear',
    });

    progressBar.appendChild(progressFill);

    const progressText = /** @type {any} */ (document.createElement('div'));
    progressText.style.fontSize = '12px';
    progressText.style.color = 'var(--yt-muted-text)';

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
      logger.error('Error disabling form controls', e);
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
      logger.error('Error enabling form controls', e);
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
      url: subtitle.baseUrl || subtitle.url,
      languageCode: effectiveLanguageCode,
      languageName: subtitle.name,
      isAutoGenerated: !!subtitle.isAutoGenerated,
      format: subtitleFormat,
      translateTo: effectiveTranslateTo,
      trackId: subtitle.trackId || '',
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
    formParts.progressText.style.color = 'var(--yt-danger-text)';

    // Ensure controls are re-enabled even if something goes wrong
    enableFormControls(formParts);

    // Add a safety timeout to force re-enable after 500ms
    setTimeout_(() => {
      try {
        enableFormControls(formParts);
      } catch (e) {
        logger.error('Failed to re-enable controls', e);
      }
    }, 500);

    // Reset progress text color after 3 seconds
    setTimeout_(() => {
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
        logger.error('Download error', err);
        handleDownloadError(formParts, /** @type {any} */ (err));
      } finally {
        // Extra safety: ensure controls are re-enabled
        setTimeout_(() => {
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
        url: autot.url || (autot.baseUrl ? buildSubtitleUrl(autot.baseUrl) : ''),
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

      const videoId = getVideoId() || '';
      const renderToken = String(Date.now()) + Math.random().toString(36).slice(2);
      formParts.qualitySelect.dataset.renderToken = renderToken;
      formParts.qualitySelect.replaceChildren();

      const loadingLabel = document.createElement('div');
      loadingLabel.textContent = t('loading');
      Object.assign(loadingLabel.style || {}, {
        fontSize: '13px',
        color: 'var(--yt-text-secondary)',
        padding: '8px 0',
      });
      formParts.qualitySelect.appendChild(loadingLabel);

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
          border: '1px solid var(--yt-surface-soft)',
          background: 'var(--yt-surface-overlay-faint)',
          color: 'var(--yt-text-primary)',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: '600',
        });

        btn.addEventListener('click', () => {
          Array.from(formParts.qualitySelect.children).forEach((/** @type {any} */ c) => {
            if (c.dataset?.value) {
              c.style.background = 'transparent';
              c.style.color = 'var(--yt-text-primary)';
              c.style.border = '1px solid var(--yt-surface-soft)';
              if (c.setAttribute) c.setAttribute('aria-checked', 'false');
            }
          });
          btn.style.background = 'var(--yt-surface-contrast)';
          btn.style.color = 'var(--yt-success-accent)';
          btn.style.border = '1px solid var(--yt-success-accent-soft)';
          btn.setAttribute('aria-checked', 'true');
          formParts.qualitySelect.value = q;
        });

        return btn;
      }

      void getAvailableVideoQualities(videoId).then(qualities => {
        if (activeFormat !== 'video') return;
        if (formParts.qualitySelect.dataset.renderToken !== renderToken) return;

        const availableQualities =
          Array.isArray(qualities) && qualities.length > 0
            ? qualities
            : DownloadConfig.VIDEO_QUALITIES.slice();
        const lowQuals = availableQualities.filter(q => parseInt(q, 10) <= 1080);
        const highQuals = availableQualities.filter(q => parseInt(q, 10) > 1080);
        const previousQuality = String(formParts.qualitySelect.value || '');

        formParts.qualitySelect.replaceChildren();
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
          lineLeft.style.borderTop = '1px solid var(--yt-surface-overlay-border)';
          const label = /** @type {any} */ (document.createElement('div'));
          label.textContent = t('vp9Label');
          Object.assign(label.style || {}, {
            fontSize: '12px',
            color: 'var(--yt-text-secondary)',
            padding: '0 8px',
          });
          const lineRight = /** @type {any} */ (document.createElement('div'));
          lineRight.style.flex = '1';
          lineRight.style.borderTop = '1px solid var(--yt-surface-overlay-border)';
          labelWrap.appendChild(lineLeft);
          labelWrap.appendChild(label);
          labelWrap.appendChild(lineRight);
          formParts.qualitySelect.appendChild(labelWrap);

          highQuals.forEach(q => formParts.qualitySelect.appendChild(makeQualityButton(q)));
        }

        formParts.qualitySelect.value = pickDefaultVideoQuality(
          availableQualities,
          previousQuality
        );
        const defaultBtn = Array.from(formParts.qualitySelect.children).find(
          c => c.dataset && c.dataset.value === formParts.qualitySelect.value
        );
        if (defaultBtn) defaultBtn.click();
      });

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
        border: '1px solid var(--yt-surface-soft)',
        background: 'var(--yt-surface-overlay-faint)',
        color: 'var(--yt-text-primary)',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
      });

      btn.addEventListener('click', () => {
        Array.from(formParts.qualitySelect.children).forEach((/** @type {any} */ c) => {
          c.style.background = 'transparent';
          c.style.color = 'var(--yt-text-primary)';
          c.style.border = '1px solid var(--yt-surface-soft)';
          if (c.setAttribute) c.setAttribute('aria-checked', 'false');
        });
        btn.style.background = 'var(--yt-surface-contrast)';
        btn.style.color = 'var(--yt-success-accent)';
        btn.style.border = '1px solid var(--yt-success-accent-soft)';
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
      background: 'var(--yt-glass-bg)',
      color: 'var(--yt-text-primary)',
      borderRadius: '12px',
      boxShadow: '0 8px 40px var(--yt-shadow-flyout)',
      fontFamily: 'Arial, sans-serif',
      border: '1px solid var(--yt-surface-overlay-border)',
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
    } catch {
      /* ignore */
    }
  }

  function closeModal() {
    if (!_modalElements) return;
    try {
      // Clean up subtitle select listener to prevent document click leak
      const ss = _modalElements.overlay?.querySelector('[role="listbox"]');
      if (ss && typeof ss.destroy === 'function') ss.destroy();
      if (_modalElements.overlay?.parentNode) {
        _modalElements.overlay.parentNode.removeChild(_modalElements.overlay);
      }
    } catch {
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

      const id = createVisibilityAwareInterval(() => {
        waited += interval;
        if (typeof window.YouTubePlusDownload !== 'undefined') {
          id.stop();
          return resolve(window.YouTubePlusDownload);
        }
        if (waited >= timeout) {
          id.stop();
          return resolve(undefined);
        }
      }, interval);
      // Register with cleanupManager for safe SPA cleanup
      try {
        if (U?.cleanupManager?.register) {
          U.cleanupManager.register(() => id.stop());
        }
      } catch (_e) {
        U.logSuppressed(_e, 'Download');
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
      } catch (_e) {
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
    _setSafeHTML(
      button,
      `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="0.5" d="M3 15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M12 3V16M12 16L16 11.625M12 16L8 11.625" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>
    `
    );
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
      if (!(pendingButton && pendingDropdown)) return;

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
        logger.error('Direct download module not loaded');
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
          await /** @type {any} */ (api).downloadVideo({
            format: 'video',
            quality: '1080',
          });
          return;
        }
      } catch (err) {
        logger.error('Direct download invocation failed', err);
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
      if (!(item && list.contains(item))) return;
      handleOptionActivate(item);
    });

    list.addEventListener('keydown', (/** @type {any} */ e) => {
      const item = e.target?.closest?.('.download-option-item');
      if (!(item && list.contains(item))) return;
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
      injectDownloadStyles();

      try {
        const existingBtn = controls.querySelector('.ytp-download-button');
        if (existingBtn) existingBtn.remove();
      } catch (_e) {
        // ignore
      }

      const videoId = new URLSearchParams(location.search).get('v');
      const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

      const customization = settings.downloadSiteCustomization || {
        externalDownloader: {
          name: 'SSYouTube',
          url: 'https://ssyoutube.com/watch?v={videoId}',
        },
      };

      const enabledSites = settings.downloadSites || {
        externalDownloader: true,
        ytdl: true,
        direct: true,
      };
      const { downloadSites } = buildDownloadSites(customization, enabledSites, videoId, videoUrl);

      const button = /** @type {any} */ (createButtonElement(tFn));

      const existingDownload = $('.download-options');
      if (existingDownload) existingDownload.remove();

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
                if (settings.enableDownload && !(btn && dd)) {
                  try {
                    const controlsEl = $('.ytp-right-controls');
                    if (controlsEl) {
                      // recreate button + dropdown
                      addDownloadButton(/** @type {HTMLElement} */ (controlsEl));
                    }
                  } catch (_e) {
                    /* ignore recreation errors */
                  }
                }

                refreshDownloadVisibility(!!settings.enableDownload);
              } catch {
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
              logger.warn('rebuildDownloadDropdown failed', e);
            }
          };
        }
      } catch (e) {
        logger.warn('expose rebuildDownloadDropdown failed', e);
      }

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

      try {
        document.body.appendChild(dropdown);
      } catch (_e) {
        button.appendChild(dropdown);
      }

      setupDropdownHoverBehavior(button, dropdown);

      controls.insertBefore(button, controls.firstChild);
    };

    /**
     * Refresh download button visibility based on settings
     */
    const refreshDownloadButton = () => {
      const button = getElement('.ytp-download-button');
      let dropdown = $('.download-options');

      // If downloads are enabled but the dropdown/button are missing, recreate them
      if (settings.enableDownload && !(button && dropdown)) {
        try {
          const controlsEl = $('.ytp-right-controls');
          if (controlsEl) {
            addDownloadButton(/** @type {HTMLElement} */ (controlsEl));
            // re-query after creation
            dropdown = $('.download-options');
          }
        } catch (e) {
          logger?.warn?.('[YouTube+] recreate download button failed:', e);
        }
      }

      refreshDownloadVisibility(!!settings.enableDownload);
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
    injectDownloadStyles();
    try {
      U &&
        /** @type {any} */ (YouTubeUtils).logger?.debug?.(
          '[YouTube+ Download] Unified module loaded'
        );
      U &&
        /** @type {any} */ (YouTubeUtils).logger?.debug?.(
          '[YouTube+ Download] Use window.YouTubePlusDownload.downloadVideo() to download'
        );
      U &&
        /** @type {any} */ (YouTubeUtils).logger?.debug?.(
          '[YouTube+ Download] Button manager available'
        );
    } catch (_e) {
      U.logSuppressed(_e, 'Download');
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
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusDownload = window.YouTubePlusDownload;
    }

    // Export button manager for basic.js
    window.YouTubePlusDownloadButton = {
      createDownloadButtonManager:
        /** @type {(config: Record<string, unknown>) => { refreshDownloadButton(): void; addDownloadButton(): void; [key: string]: unknown }} */ (
          /** @type {unknown} */ (createDownloadButtonManager)
        ),
      refreshVisibility: refreshDownloadVisibility,
      injectStyles: injectDownloadStyles,
    };
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusDownloadButton = window.YouTubePlusDownloadButton;
    }
  }

  const ensureInit = () => {
    if (!isRelevantRoute()) return;
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(init, { timeout: 1500 });
    } else {
      setTimeout(init, 0);
    }
  };

  // Download runtime: /watch and /shorts only — the button is
  // shown exclusively on video pages, and the click handler is
  // wired into the runtime so it can guard against clicks that
  // happen during SPA transitions where the route is mid-swap.
  if (U?.whenRelevant) {
    U.whenRelevant({
      name: 'download',
      isRelevant: isRelevantRoute,
      onEnter: ensureInit,
    });
  } else {
    // Fallback: direct initialization
    onDomReady(ensureInit);
  }

  if (typeof U?.cleanupManager?.registerListener === 'function') {
    YouTubeUtils.cleanupManager.registerListener(document, 'yt-navigate-finish', ensureInit, {
      passive: true,
    });
  } else {
    document.addEventListener('yt-navigate-finish', ensureInit, {
      passive: true,
    });
  }
})();
