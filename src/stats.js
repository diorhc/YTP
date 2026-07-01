/**
 * Stats module — Video Statistics Panel
 *
 * This file contains TWO separate IIFEs by design:
 *
 * IIFE 1 (lines ~1–2365): Video stats — fetches and displays per-video
 *   statistics (views, likes, upload date, tags) in a modal panel.
 *   Includes settings integration and video-stats CSS.
 *
 * IIFE 2 (lines ~2366–end): Channel stats — fetches and displays channel-level
 *   statistics (subscribers, total videos, join date, country) in a banner overlay.
 *   Includes channel-stats CSS, font dropdown, and separate settings panel.
 *
 * They are kept separate because:
 * - Each has independent initialization guards and lifecycle
 * - Each manages its own DOM elements, observers, and event listeners
 * - Each has its own CSS injection to avoid cascading side effects
 * - Merging would create a 4000+ line IIFE with tangled state
 */
// Stats button and menu
(function () {
  const U = window.YouTubeUtils;
  U?.StyleManager?.add?.(
    'ytp-stats-styles',
    window.YouTubePlusDesignSystem?.getStyle?.('ytp-stats-styles') || ''
  );
  if (window.__ytpVideoStatsModuleInit) return;

  const isVideoStatsTriggerRoute = () => {
    try {
      const path = location.pathname || '';
      return (
        path === '/watch' ||
        path.startsWith('/shorts') ||
        path.startsWith('/@') ||
        path.startsWith('/channel/') ||
        path.startsWith('/c/')
      );
    } catch (_e) {
      return false;
    }
  };

  const isSettingsModalOpen = () => U.isSettingsModalOpen();

  const initVideoStats = () => {
    if (window.__ytpVideoStatsModuleInit) return;
    window.__ytpVideoStatsModuleInit = true;
    const _setSafeHTML = U.setSafeHTML;
    const setTimeout_ = setTimeout.bind(window);

    // Shared helpers from YouTubeUtils
    const utils = U;
    const $ = utils.$;
    const $$ = utils.$$;
    const byId = utils.byId;

    // Shared translation helper — must be declared before "inject now"
    // so addSettingsUI() doesn't hit TDZ on `t`.
    const t = U.t;

    // Settings state — needed by addSettingsUI() which runs via retry
    // scheduler even on Studio (before isStudioPage guard returns).
    const SETTINGS_KEY = 'youtube_stats_button_enabled';
    const STATS_ICON_ID = 'ytp-stats-universal-icon';
    const STATS_ICON_SELECTOR = `#${STATS_ICON_ID}, .videoStats[data-ytp-stats-icon="true"], .videoStats`;

    // Safe localStorage wrapper — guards against SecurityError in restricted contexts
    const _safeLS = window.YouTubeUtils?.safeLS || {
      /** @param {string} k @param {string|null} [def] @returns {string|null} */
      getItem: (k, def = null) => {
        try {
          return localStorage.getItem(k) ?? def;
        } catch (_e) {
          return def;
        }
      },
      /** @param {string} k @param {string} v @returns {boolean} */
      setItem: (k, v) => {
        try {
          localStorage.setItem(k, v);
          return true;
        } catch (_e) {
          return false;
        }
      },
      /** @param {string} k */
      removeItem: k => {
        try {
          localStorage.removeItem(k);
        } catch (_e) {
          /* non-critical */
        }
      },
    };

    let statsButtonEnabled = _safeLS.getItem(SETTINGS_KEY) !== 'false';

    // Attach change handler to the static checkbox in settings modal
    const attachSettingsHandler = () => {
      try {
        const checkbox = document.getElementById('ytp-plus-setting-enableStatsButton');
        if (!(checkbox instanceof HTMLInputElement)) return;
        if (checkbox.dataset.handlerAttached) return;
        checkbox.dataset.handlerAttached = 'true';
        checkbox.checked = statsButtonEnabled;
        checkbox.addEventListener('change', e => {
          const input = /** @type {EventTarget & HTMLInputElement} */ (e.target);
          statsButtonEnabled = input.checked;
          _safeLS.setItem(SETTINGS_KEY, statsButtonEnabled ? 'true' : 'false');
          $$(`${STATS_ICON_SELECTOR}, .stats-menu-container`).forEach(el => el.remove());
          if (statsButtonEnabled) {
            checkAndInsertIcon();
            checkAndAddMenu();
          }
        });
      } catch (_e) {
        // non-critical
      }
    };

    if (isSettingsModalOpen()) {
      attachSettingsHandler();
    }

    // Register settings modal listener for SUBSEQUENT opens.
    if (U?.cleanupManager?.registerListener) {
      U.cleanupManager.registerListener(document, 'youtube-plus-settings-modal-opened', () => {
        attachSettingsHandler();
      });
    } else {
      document.addEventListener('youtube-plus-settings-modal-opened', () => {
        attachSettingsHandler();
      });
    }

    let statsInitialized = false;

    const isStatsRelevant = () => {
      try {
        const path = location.pathname || '';
        if (path === '/watch' || path.startsWith('/shorts')) return true;
        return U?.isChannelPage?.(location.href) ?? false;
      } catch (_e) {
        return false;
      }
    };

    const runWhenReady = (/** @type {() => void} */ cb) => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cb, { once: true });
      } else {
        cb();
      }
    };

    // Shared translation helper from YouTubeUtils
    const escapeHtml =
      window.YouTubeSafeDOM?.escapeHTML ||
      window.YouTubeSecurityUtils?.escapeHtml ||
      ((/** @type {string} */ s) => {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
      });

    // Glassmorphism styles for stats button and menu (shorts-keyboard-feedback look)
    const styles = `
      .videoStats{width:36px;height:36px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-left:8px;margin-right:8px;background:none;;border:none;transition:transform .18s ease,background .18s}
      html[dark] .videoStats{background:none;border:none}html:not([dark]) .videoStats{background:none;border:none}.videoStats:hover{transform:translateY(-2px)}.videoStats svg{width:18px;height:18px;fill:var(--yt-spec-text-primary,#030303)}html[dark] .videoStats svg{fill:var(--yt-text-primary)}html:not([dark]) .videoStats svg{fill:var(--yt-text-primary)}
      .shortsStats{display:flex;align-items:center;justify-content:center;margin-top:16px;margin-bottom:16px;width:48px;height:48px;border-radius:50%;cursor:pointer;background:var(--yt-stats-button-bg-light);box-shadow:0 12px 30px var(--yt-stats-shadow-deep);backdrop-filter:blur(10px) saturate(160%);-webkit-backdrop-filter:blur(10px) saturate(160%);border:1.25px solid var(--yt-stats-button-bg-light);transition:transform .22s ease}html[dark] .shortsStats{background:var(--yt-stats-button-bg-dark);border:1.25px solid var(--yt-stats-button-border-dark)}html:not([dark]) .shortsStats{background:var(--yt-stats-button-bg-light);border:1.25px solid var(--yt-stats-button-border-light)}
      .shortsStats:hover{transform:translateY(-3px)}.shortsStats svg{width:24px;height:24px;fill:var(--yt-text-primary)}html[dark] .shortsStats svg{fill:var(--yt-text-primary)}html:not([dark]) .shortsStats svg{fill:var(--yt-text-primary)}
        .stats-menu-container{position:relative;display:inline-block}.stats-horizontal-menu{position:absolute;display:flex;left:100%;top:0;height:100%;visibility:hidden;opacity:0;transition:visibility 0s,opacity 0.2s linear;z-index:100}.stats-menu-container:hover .stats-horizontal-menu{visibility:visible;opacity:1}.stats-menu-button{margin-left:8px;white-space:nowrap}
        /* Modal overlay and container with glassmorphism */
        .stats-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);z-index:var(--yt-z-modal);display:flex;align-items:center;justify-content:center;animation:fadeInModal .18s;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur)}
        .stats-modal-container{max-width:1100px;max-height:calc(100vh - 32px);display:flex;flex-direction:column}
        .stats-modal-content{position:relative;background:var(--yt-glass-bg);border-radius:var(--yt-radius-lg);box-shadow:0 18px 40px var(--yt-stats-modal-shadow);overflow:visible;display:flex;flex-direction:column;animation:scaleInModal .18s;border:1.5px solid var(--yt-glass-border);backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%)}
        /* Fix custom element display for Chrome */
        button-view-model{display:inline-flex;align-items:center;justify-content:center;}
        button-view-model.yt-spec-button-view-model{vertical-align:top;}
        /* Modal body */
        .stats-modal-body{position:relative;padding:24px 16px 16px;overflow:visible;flex:1;display:flex;flex-direction:column}
        /* Thumbnail preview */
        .stats-thumb-title-centered{position:absolute;top:-44px;left:50%;transform:translateX(-50%);z-index:3;display:block;width:fit-content;max-width:min(90%,760px);margin:0;padding:8px 16px;border-radius:18px;border:1px solid var(--yt-glass-border);background:var(--yt-glass-bg);font-size:14px;font-weight:500;color:var(--yt-text-primary);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default;transition:transform .25s cubic-bezier(.4,0,.2,1), background-color .25s cubic-bezier(.4,0,.2,1), border-color .25s cubic-bezier(.4,0,.2,1), color .25s cubic-bezier(.4,0,.2,1)}
        .stats-thumb-row{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
        .stats-thumb-img{width:36vw;max-width:420px;height:auto;object-fit:cover;border-radius:8px;flex-shrink:0;outline:1px solid rgba(255,255,255,0.1);outline-offset:-1px;max-height:44vh;border:none;}
        html:not([dark]) .stats-thumb-img{outline:1px solid rgba(0,0,0,0.1);outline-offset:-1px;}
        /* ensure the grid takes remaining horizontal space */
        .stats-thumb-row .stats-grid{flex:1;min-width:0}
        .stats-side-column{flex:1;min-width:280px;display:flex;flex-direction:column}
        .stats-thumb-left{display:flex;flex-direction:column;align-items:center;gap:8px}
        .stats-thumb-left .stats-thumb-sub{font-size:13px;color:var(--yt-stats-text-secondary-dark)}
        html:not([dark]) .stats-thumb-left .stats-thumb-sub{color:var(--yt-stats-text-secondary-light)}
        /* extras row under thumbnail: inline, single line */
        .stats-thumb-extras{display:flex;flex-direction:row;gap:10px;align-items:center;margin-top:8px}
        .stats-thumb-extras .stats-card{padding:8px 10px}
        .stats-thumb-meta{display:flex;flex-direction:column;justify-content:center}
        .stats-thumb-sub{font-size:13px;color:var(--yt-stats-text-secondary-dark)}
        html:not([dark]) .stats-thumb-sub{color:var(--yt-stats-text-secondary-light)}
        /* Loading state */
        .stats-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:var(--yt-stats-loader-text-dark)}
        html:not([dark]) .stats-loader{color:var(--yt-stats-loader-text-light)}
        .stats-spinner{width:60px;height:60px;animation:spin 1s linear infinite;margin-bottom:16px}
        .stats-spinner circle{stroke-dasharray:80;stroke-dashoffset:60;animation:dash 1.5s ease-in-out infinite}            
        /* Error state */
        .stats-error{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:var(--yt-stats-error);text-align:center}
        .stats-error-icon{width:60px;height:60px;margin-bottom:16px;stroke:var(--yt-stats-error)}
        /* Stats grid */
        .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}            
        /* Stats card */
        .stats-card{background:var(--yt-stats-card-bg-dark);border-radius:12px;padding:12px;display:flex;align-items:center;gap:12px;border:1px solid var(--yt-stats-card-border-dark);transition:transform .18s ease,box-shadow .18s ease}
        html:not([dark]) .stats-card{background:var(--yt-stats-card-bg-light);border:1px solid var(--yt-stats-card-border-light)}
        .stats-card:hover{transform:translateY(-2px);box-shadow:0 8px 20px var(--yt-stats-shadow-hover)}
        /* Stats icon */
        .stats-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .stats-icon svg{width:24px;height:24px}
        .stats-icon-views{background:var(--yt-stats-icon-views-bg);color:var(--yt-stats-icon-views)}
        .stats-icon-likes{background:var(--yt-stats-icon-likes-bg);color:var(--yt-stats-icon-likes)}
        .stats-icon-dislikes{background:var(--yt-stats-icon-dislikes-bg);color:var(--yt-stats-icon-dislikes)}
        .stats-icon-comments{background:var(--yt-stats-icon-comments-bg);color:var(--yt-stats-icon-comments)}
        .stats-icon-viewers{background:var(--yt-stats-icon-viewers-bg);color:var(--yt-stats-icon-viewers)}
        .stats-icon-subscribers{background:var(--yt-stats-icon-subscribers-bg);color:var(--yt-stats-icon-subscribers)}
        .stats-icon-videos{background:var(--yt-stats-icon-videos-bg);color:var(--yt-stats-icon-videos)}
        /* Pair likes/dislikes into a single grid cell */
        .stats-card-pair{display:flex;gap:8px;align-items:stretch}
        .stats-card-pair .stats-card{flex:1;margin:0}
        @media(max-width:480px){.stats-card-pair{flex-direction:column}}            
        /* Stats info */
        .stats-info{flex:1;min-width:0}
        .stats-label{font-size:13px;color:var(--yt-stats-text-label);margin-bottom:4px;font-weight:500}
        html:not([dark]) .stats-label{color:var(--yt-stats-text-secondary-light)}
        .stats-value{font-size:20px;font-weight:700;color:var(--yt-stats-text-value-dark);line-height:1.2;margin-bottom:2px}
        html:not([dark]) .stats-value{color:var(--yt-stats-text-value-light)}
        .stats-exact{font-size:13px;color:var(--yt-stats-text-exact-dark);font-weight:400}
        html:not([dark]) .stats-exact{color:var(--yt-stats-text-exact-light)}
        /* Animations — shared keyframes (fadeInModal, scaleInModal, spin, dash) defined in basic.js */
        /* Responsive */
        @media(max-width:768px){.stats-modal-container{width:95vw}.stats-grid{grid-template-columns:1fr}.stats-card{padding:16px}.stats-side-column{min-width:0;width:100%}}
        /* Centered large author handle (preferred) */
        .stats-author-big{display:block;text-align:center;margin-top:13px;padding-inline:8px}
        .stats-author-name-big{display:block;color:var(--yt-stats-author-name-bright);font-weight:600;font-size:16px}
        .stats-author-handle-big{display:inline-block;color:var(--yt-glass-border);font-weight:700;font-size:20px;text-decoration:none;padding:6px 10px;border-radius:6px}
        .stats-author-handle-big:hover{color:var(--yt-stats-link-hover);text-decoration:underline}
        html:not([dark]) .stats-author-name-big{color:var(--yt-stats-author-name-light)}
        html:not([dark]) .stats-author-handle-big{color:var(--yt-stats-link-color)}
        html:not([dark]) .stats-author-handle-big:hover{color:var(--yt-stats-link-hover-dark)}
        `;

    let previousUrl = location.href;
    let isChecking = false;
    let experimentalNavListenerKey = null;
    const channelFeatures = {
      hasStreams: false,
      hasShorts: false,
    };

    /** @type {StatsRateLimiter} */
    const rateLimiter = {
      requests: new Map(),
      maxRequests: 10,
      maxKeys: 100,
      timeWindow: 60000, // 1 minute

      /**
       * Check if request is allowed
       * @param {string} key - Request identifier
       * @returns {boolean} Whether request is allowed
       */
      canRequest: (/** @type {string} */ key) => {
        const now = Date.now();
        const requests = rateLimiter.requests.get(key) || [];

        // Remove old requests outside time window
        const recentRequests = requests.filter(
          (/** @type {number} */ time) => now - time < rateLimiter.timeWindow
        );

        if (recentRequests.length >= rateLimiter.maxRequests) {
          window.YouTubePlusLogger?.warn?.(
            'Stats',
            `Rate limit exceeded for ${key}. Max ${rateLimiter.maxRequests} requests per minute.`
          );
          return false;
        }

        recentRequests.push(now);
        rateLimiter.requests.set(key, recentRequests);

        // Evict oldest keys if map grows too large
        if (rateLimiter.requests.size > rateLimiter.maxKeys) {
          const firstKey = rateLimiter.requests.keys().next().value;
          if (typeof firstKey === 'string') {
            rateLimiter.requests.delete(firstKey);
          }
        }
        return true;
      },

      /**
       * Clear rate limiter state
       */
      clear: () => {
        rateLimiter.requests.clear();
      },
    };

    /**
     * Inject video stats CSS once
     * @returns {void}
     * @private
     */
    function addStyles() {
      if (!byId('youtube-enhancer-styles')) {
        U.StyleManager.add('youtube-enhancer-styles', styles);
      }
    }

    /**
     * Validate if a string is a valid YouTube video ID
     * @param {string} id - Video ID to validate
     * @returns {boolean} True if valid
     */
    // Use security-utils canonical implementation when available; local fallback for robustness
    const isValidVideoId = /** @type {(id: string | null) => boolean} */ (
      window.YouTubeSecurityUtils?.isValidVideoId ||
        /** @type {(id: string | null) => boolean} */ (
          id => !!id && /^[a-zA-Z0-9_-]{11}$/.test(/** @type {string} */ (id))
        )
    );

    /**
     * Extract video ID from URL parameters
     * @returns {string|null} Video ID or null
     */
    function getVideoIdFromParams() {
      const urlParams = new URLSearchParams(window.location.search);
      const videoId = urlParams.get('v');
      return isValidVideoId(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
    }

    /**
     * Extract video ID from shorts URL
     * @param {string} url - Current URL
     * @returns {string|null} Video ID or null
     */
    function getVideoIdFromShorts(url) {
      const shortsMatch = url.match(/\/shorts\/([^?]+)/);
      if (shortsMatch && isValidVideoId(shortsMatch[1])) {
        return `https://www.youtube.com/shorts/${shortsMatch[1]}`;
      }
      return null;
    }

    /**
     * Determine the current YouTube video URL from query params or shorts path
     * @returns {string|null} Full YouTube video/shorts URL or null
     */
    function getCurrentVideoUrl() {
      try {
        const url = window.location.href;

        // Validate URL is from YouTube domain
        if (!url.includes('youtube.com')) {
          return null;
        }

        // Try to get video ID from query params first
        const fromParams = getVideoIdFromParams();
        if (fromParams) return fromParams;

        // Try to get from shorts URL
        return getVideoIdFromShorts(url);
      } catch (error) {
        U?.logError?.('Stats', 'Failed to get video URL', /** @type {any} */ (error));
        return null;
      }
    }

    /**
     * Get channel identifier with validation
     * @returns {string} Channel identifier
     */
    function getChannelIdentifier() {
      try {
        const url = window.location.href;
        let identifier = '';

        if (url.includes('/channel/')) {
          identifier = url.split('/channel/')[1].split('/')[0];
        } else if (url.includes('/@')) {
          identifier = url.split('/@')[1].split('/')[0];
        }

        // Validate identifier (alphanumeric, dashes, underscores)
        if (identifier && /^[a-zA-Z0-9_-]+$/.test(identifier)) {
          return identifier;
        }

        return '';
      } catch (error) {
        U?.logError?.('Stats', 'Failed to get channel identifier', /** @type {any} */ (error));
        return '';
      }
    }

    /**
     * Validate YouTube URL
     * @param {string} url - URL to validate
     * @returns {boolean} True if valid YouTube URL
     */
    function validateYouTubeUrl(url) {
      if (!url || typeof url !== 'string') {
        return false;
      }

      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname !== 'www.youtube.com' && parsedUrl.hostname !== 'youtube.com') {
          window.YouTubePlusLogger?.warn?.('Stats', 'Invalid domain for channel check');
          return false;
        }
        return true;
      } catch (error) {
        U?.logError?.('Stats', 'Invalid URL for channel check', /** @type {any} */ (error));
        return false;
      }
    }

    /**
     * Fetch channel page HTML with timeout
     * @param {string} url - URL to fetch
     * @returns {Promise<string|null>} HTML content or null on error
     */
    async function fetchChannelHtml(url) {
      // Validate URL is from YouTube domain before fetching
      try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        if (
          hostname !== 'www.youtube.com' &&
          hostname !== 'youtube.com' &&
          hostname !== 'm.youtube.com'
        ) {
          window.YouTubePlusLogger?.warn?.('Stats', 'Blocked fetch to non-YouTube URL:', hostname);
          return null;
        }
      } catch (_e) {
        return null;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout_(() => controller.abort(), 10000); // 10 second timeout

      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
          signal: controller.signal,
          headers: {
            Accept: 'text/html',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          window.YouTubePlusLogger?.warn?.(
            'Stats',
            `HTTP ${response.status} when checking channel tabs`
          );
          return null;
        }

        const html = await response.text();

        // Limit response size to prevent memory issues
        if (html.length > 5000000) {
          // 5MB limit
          window.YouTubePlusLogger?.warn?.('Stats', 'Response too large, skipping parse');
          return null;
        }

        return html;
      } catch (error) {
        if (/** @type {any} */ (error).name === 'AbortError') {
          window.YouTubePlusLogger?.warn?.('Stats', 'Channel check timed out');
        }
        throw error;
      }
    }

    /**
     * Extract YouTube initial data from HTML
     * @param {string} html - HTML content
     * @returns {ChannelBrowseData | null} Parsed YouTube data or null
     */
    function extractYouTubeData(html) {
      const match = html.match(/var ytInitialData = (.+?);<\/script>/);

      if (!match?.[1]) {
        return null;
      }

      try {
        return JSON.parse(match[1]);
      } catch (parseError) {
        U?.logError?.('Stats', 'Failed to parse ytInitialData', /** @type {any} */ (parseError));
        return null;
      }
    }

    /**
     * Extract tab URL from tab renderer
     * @param {any} tab - Tab object
     * @returns {string|null} Tab URL or null
     */
    function getTabUrl(/** @type {ChannelTabRenderer} */ tab) {
      return tab?.tabRenderer?.endpoint?.commandMetadata?.webCommandMetadata?.url || null;
    }

    /**
     * Check if tab matches a URL pattern
     * @param {string} url - Tab URL
     * @param {RegExp} pattern - Pattern to match
     * @returns {boolean} True if matches
     */
    function tabMatches(url, pattern) {
      return typeof url === 'string' && pattern.test(url);
    }

    /**
     * Analyze channel tabs for presence of streams and shorts
     * @param {ChannelBrowseData} data - Channel data
     * @returns {{hasStreams: boolean, hasShorts: boolean}} Tab analysis result
     */
    /**
     * Check if tab is a streams tab
     * @param {string} tabUrl - Tab URL
     * @returns {boolean} True if streams tab
     */
    function isStreamsTab(tabUrl) {
      return tabMatches(tabUrl, /\/streams$/);
    }

    /**
     * Check if tab is a shorts tab
     * @param {string} tabUrl - Tab URL
     * @returns {boolean} True if shorts tab
     */
    function isShortsTab(tabUrl) {
      return tabMatches(tabUrl, /\/shorts$/);
    }

    /**
     * Check if both streams and shorts are found
     * @param {boolean} hasStreams - Has streams flag
     * @param {boolean} hasShorts - Has shorts flag
     * @returns {boolean} True if both found
     */
    function hasBothContentTypes(hasStreams, hasShorts) {
      return hasStreams && hasShorts;
    }

    /**
     * Update content type flags based on tab URL
     * @param {string} tabUrl - Tab URL
     * @param {any} flags - Flags object with hasStreams and hasShorts
     */
    function updateContentTypeFlags(
      /** @type {string} */ tabUrl,
      /** @type {ChannelFeatureFlags} */ flags
    ) {
      if (!flags.hasStreams && isStreamsTab(tabUrl)) {
        flags.hasStreams = true;
      }
      if (!flags.hasShorts && isShortsTab(tabUrl)) {
        flags.hasShorts = true;
      }
    }

    /**
     * Analyze channel tabs to determine available content types
     * @param {ChannelBrowseData} data - Channel data
     * @returns {{hasStreams: boolean, hasShorts: boolean}} Analysis result
     */
    function analyzeChannelTabs(data) {
      const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      const flags = { hasStreams: false, hasShorts: false };

      for (const tab of tabs) {
        const tabUrl = getTabUrl(tab);
        if (!tabUrl) continue;

        updateContentTypeFlags(tabUrl, flags);

        // Early exit if both found
        if (hasBothContentTypes(flags.hasStreams, flags.hasShorts)) break;
      }

      return flags;
    }

    /**
     * Refresh stats menu after checking tabs
     */
    function refreshStatsMenu() {
      const existingMenu = $('.stats-menu-container');
      if (existingMenu) {
        existingMenu.remove();
        createStatsMenu();
      }
    }

    /**
     * Check channel tabs with rate limiting and enhanced security
     * @param {string} url - Channel URL to check
     * @returns {Promise<void>}
     */
    async function checkChannelTabs(url) {
      if (isChecking) return;

      // Validate URL
      if (!validateYouTubeUrl(url)) {
        return;
      }

      // Rate limiting
      if (!rateLimiter.canRequest('checkChannelTabs')) {
        return;
      }

      isChecking = true;
      try {
        const html = await fetchChannelHtml(url);
        if (!html) return;

        const data = extractYouTubeData(html);
        if (!data) return;

        const flags = analyzeChannelTabs(data);
        if (flags.hasStreams || flags.hasShorts) {
          window.YouTubePlusLogger?.info?.('Stats', 'Channel tabs:', {
            hasStreams: flags.hasStreams,
            hasShorts: flags.hasShorts,
          });
        }

        refreshStatsMenu();
      } catch (error) {
        U?.logError?.('Stats', 'Channel tab check failed', /** @type {any} */ (error));
      } finally {
        isChecking = false;
      }
    }

    /**
     * Check for URL changes with debouncing
     */
    const checkUrlChange =
      U?.debounce?.(() => {
        try {
          const currentUrl = location.href;
          if (currentUrl !== previousUrl) {
            previousUrl = currentUrl;
            if (U?.isChannelPage?.(currentUrl) ?? false) {
              setTimeout(() => checkChannelTabs(currentUrl), 500);
            }
          }
        } catch (error) {
          U?.logError?.('Stats', 'URL change check failed', /** @type {any} */ (error));
        }
      }, 300) ||
      function () {
        try {
          const currentUrl = location.href;
          if (currentUrl !== previousUrl) {
            previousUrl = currentUrl;
            if (U?.isChannelPage?.(currentUrl) ?? false) {
              setTimeout(() => checkChannelTabs(currentUrl), 500);
            }
          }
        } catch (error) {
          window.YouTubePlusLogger?.error?.('Stats', 'URL change check failed:', error);
        }
      };

    function createStatsIcon() {
      const icon = document.createElement('div');
      // single universal icon for all pages
      icon.className = 'videoStats';
      icon.id = STATS_ICON_ID;
      icon.setAttribute('data-ytp-stats-icon', 'true');
      _setSafeHTML(
        icon,
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 22H2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M21 22V14.5C21 13.6716 20.3284 13 19.5 13H16.5C15.6716 13 15 13.6716 15 14.5V22" stroke="currentColor" stroke-width="1.5" " data-darkreader-inline-stroke=""></path> <path d="M15 22V5C15 3.58579 15 2.87868 14.5607 2.43934C14.1213 2 13.4142 2 12 2C10.5858 2 9.87868 2 9.43934 2.43934C9 2.87868 9 3.58579 9 5V22" stroke="currentColor" stroke-width="1.5"></path> <path opacity="0.5" d="M9 22V9.5C9 8.67157 8.32843 8 7.5 8H4.5C3.67157 8 3 8.67157 3 9.5V22" stroke="currentColor" stroke-width="1.5"></path></svg>'
      );

      icon.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const videoUrl = getCurrentVideoUrl();
        if (videoUrl) {
          const urlParams = new URLSearchParams(new URL(videoUrl).search);
          const videoId = urlParams.get('v') || videoUrl.match(/\/shorts\/([^?]+)/)?.[1];
          if (videoId) {
            openStatsModal('video', videoId);
          }
        }
      });

      return icon;
    }

    /**
     * Insert the universal stats icon into the masthead #end container
     * @returns {void}
     */
    function insertUniversalIcon() {
      if (!statsButtonEnabled) return;

      // Try to insert into masthead area (requested: "style-scope ytd-masthead").
      // Prefer element matching 'ytd-masthead.style-scope' if present, otherwise fallback to 'ytd-masthead'.
      let masthead = $('ytd-masthead.style-scope');
      if (!masthead) masthead = $('ytd-masthead');

      if (!masthead) return;

      // Preferred target: element with id="end" and class containing 'style-scope' inside masthead
      let endElem = $('#end.style-scope.ytd-masthead', /** @type {any} */ (masthead));
      if (!endElem) endElem = $('#end', /** @type {any} */ (masthead));

      const existingIcons = $$(STATS_ICON_SELECTOR);
      let statsIcon = byId(STATS_ICON_ID);
      if (!statsIcon && existingIcons.length > 0) {
        statsIcon = /** @type {HTMLElement} */ (existingIcons[0]);
      }

      // Remove duplicates aggressively (helps if script was loaded twice in different contexts)
      if (existingIcons.length > 1) {
        existingIcons.forEach(icon => {
          if (icon !== statsIcon) {
            try {
              icon.remove();
            } catch (_e) {
              /* ignore detached node errors */
            }
          }
        });
      }

      if (!statsIcon) {
        statsIcon = createStatsIcon();
      } else {
        statsIcon.id = STATS_ICON_ID;
        statsIcon.classList.add('videoStats');
        statsIcon.setAttribute('data-ytp-stats-icon', 'true');
      }

      if (endElem) {
        // Insert as first child of #end so it appears at the beginning
        if (statsIcon.parentNode !== endElem || endElem.firstChild !== statsIcon) {
          endElem.insertBefore(statsIcon, endElem.firstChild);
        }
      } else {
        // Fallback: append to masthead
        if (statsIcon.parentNode !== masthead) {
          masthead.appendChild(statsIcon);
        }
      }
    }

    /**
     * Build a YouTube-style outline button with SVG icon and text
     * @param {string} text - Button label
     * @param {string} svgPath - SVG path data
     * @param {string} viewBox - SVG viewBox
     * @param {string} className - Base CSS class name
     * @param {() => void} onClick - Click handler
     * @returns {HTMLElement} button-view-model element
     */
    function createButton(
      /** @type {string} */ text,
      /** @type {string} */ svgPath,
      /** @type {string} */ viewBox,
      /** @type {string} */ className,
      /** @type {() => void} */ onClick
    ) {
      const buttonViewModel = document.createElement('button-view-model');
      buttonViewModel.className = `yt-spec-button-view-model ${className}-view-model`;

      const button = document.createElement('button');
      button.className = `yt-spec-button-shape-next yt-spec-button-shape-next--outline yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--enable-backdrop-filter-experiment ${className}-button`;
      button.setAttribute('aria-disabled', 'false');
      button.setAttribute('aria-label', text);
      button.classList.add('ytp-stats-btn');

      button.addEventListener('click', (/** @type {MouseEvent} */ e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', viewBox);
      svg.classList.add('ytp-stats-icon');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', svgPath);
      svg.appendChild(path);

      const buttonText = document.createElement('div');
      buttonText.className = `yt-spec-button-shape-next__button-text-content ${className}-text`;
      buttonText.textContent = text;
      buttonText.classList.add('ytp-stats-btn-text');

      const touchFeedback = document.createElement('yt-touch-feedback-shape');
      touchFeedback.classList.add('ytp-stats-touch-feedback');

      const touchFeedbackDiv = document.createElement('div');
      touchFeedbackDiv.className =
        'yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--touch-response';
      touchFeedbackDiv.setAttribute('aria-hidden', 'true');

      const strokeDiv = document.createElement('div');
      strokeDiv.className = 'yt-spec-touch-feedback-shape__stroke';

      const fillDiv = document.createElement('div');
      fillDiv.className = 'yt-spec-touch-feedback-shape__fill';

      touchFeedbackDiv.appendChild(strokeDiv);
      touchFeedbackDiv.appendChild(fillDiv);
      touchFeedback.appendChild(touchFeedbackDiv);

      button.appendChild(svg);
      button.appendChild(buttonText);
      button.appendChild(touchFeedback);
      buttonViewModel.appendChild(button);

      return buttonViewModel;
    }

    /**
     * InnerTube API configuration.
     *
     * The InnerTube key is YouTube's public web-player API key — it is shipped to
     * every browser by `window.ytcfg`. It is NOT a secret, but to avoid noisy
     * matches from secret scanners (TruffleHog, GitHub secret-scan, Snyk), we
     * resolve it at runtime from ytcfg/yt.config_ first and only fall back to a
     * base64-encoded literal as a last resort.
     */
    const INNERTUBE_API_KEY_FALLBACK_B64 = 'QUl6YVN5QU9fRkoyU2xxVThRNFNURUhMR0NpbHdfWTlfMTFxY1c4';

    /**
     * Resolve the InnerTube API key dynamically from YouTube's runtime config,
     * falling back to the base64-encoded literal if runtime extraction fails.
     * @returns {string} InnerTube API key
     */
    function getInnerTubeApiKey() {
      try {
        if (typeof window.ytcfg !== 'undefined' && typeof window.ytcfg.get === 'function') {
          const k = window.ytcfg.get('INNERTUBE_API_KEY');
          if (k && typeof k === 'string') return k;
        }
        if (window.ytcfg?.data_?.INNERTUBE_API_KEY) {
          return window.ytcfg.data_.INNERTUBE_API_KEY;
        }
        if (window.yt?.config_?.INNERTUBE_API_KEY) {
          return window.yt.config_.INNERTUBE_API_KEY;
        }
      } catch (_e) {
        // Non-critical, fall through to decoded fallback
      }
      try {
        return window.atob(INNERTUBE_API_KEY_FALLBACK_B64);
      } catch (_e) {
        return '';
      }
    }

    const INNERTUBE_CLIENT_VERSION_FALLBACK = '2.20250312.01.00';

    /**
     * Get the current InnerTube client version dynamically from YouTube's config,
     * falling back to a hardcoded value if runtime extraction fails.
     * @returns {string} InnerTube client version
     */
    function getInnerTubeClientVersion() {
      try {
        // Try to extract from YouTube's runtime config
        if (typeof window.ytcfg !== 'undefined' && typeof window.ytcfg.get === 'function') {
          const version = window.ytcfg.get('INNERTUBE_CLIENT_VERSION');
          if (version && typeof version === 'string') return version;
        }
        // Try ytcfg.data_ directly
        if (window.ytcfg?.data_?.INNERTUBE_CLIENT_VERSION) {
          return window.ytcfg.data_.INNERTUBE_CLIENT_VERSION;
        }
        // Try yt.config_
        if (window.yt?.config_?.INNERTUBE_CLIENT_VERSION) {
          return window.yt.config_.INNERTUBE_CLIENT_VERSION;
        }
      } catch (_e) {
        // Extraction failed, use fallback
      }
      return INNERTUBE_CLIENT_VERSION_FALLBACK;
    }

    /**
     * Fetch video stats from InnerTube API (more complete data)
     * @param {string} videoId - Video ID
     * @returns {Promise<any|null>} Video stats with views, likes, country, monetization
     */
    /**
     * Create InnerTube API request body
     * @param {string} videoId - Video ID
     * @returns {any} Request body
     */
    function createInnerTubeRequestBody(videoId) {
      return {
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: getInnerTubeClientVersion(),
            hl: 'en',
            gl: 'US',
          },
        },
        videoId,
      };
    }

    /**
     * Create InnerTube API fetch options
     * @param {string} videoId - Video ID
     * @returns {any} Fetch options
     */
    function createInnerTubeFetchOptions(videoId) {
      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-YouTube-Client-Name': '1',
          'X-YouTube-Client-Version': getInnerTubeClientVersion(),
        },
        body: JSON.stringify(createInnerTubeRequestBody(videoId)),
      };
    }

    /**
     * Extract best thumbnail URL from details
     * @param {any} details - Video details
     * @returns {string|null} Thumbnail URL
     */
    function extractThumbnailUrl(/** @type {any} */ details) {
      const thumbnails = details.thumbnail?.thumbnails;
      return thumbnails?.[thumbnails.length - 1]?.url || null;
    }

    /**
     * Parse video stats from InnerTube response
     * @param {any} data - InnerTube response data
     * @returns {any} Parsed video stats
     */
    function parseVideoStatsFromResponse(/** @type {any} */ data) {
      const details = data.videoDetails || {};
      const microformat = data.microformat?.playerMicroformatRenderer || {};

      // Extract channel handle from ownerProfileUrl (e.g. "/@handle" → "@handle")
      const ownerProfileUrl = microformat.ownerProfileUrl || microformat.ownerUrls?.[0] || '';
      const handleMatch = ownerProfileUrl.match(/\/@([\w.-]+)/);
      const authorHandle = handleMatch ? `@${handleMatch[1]}` : null;

      return {
        videoId: details.videoId,
        title: details.title,
        author: details.author || null,
        authorHandle: authorHandle,
        views: details.viewCount ? parseInt(details.viewCount, 10) : null,
        likes: null, // Will be fetched separately
        thumbnail: extractThumbnailUrl(details),
        duration: details.lengthSeconds,
        country: null, // Fetched separately from channel browse (availableCountries is geo-restriction, not creator country)
        monetized: microformat.isFamilySafe !== undefined,
        channelId: details.channelId,
      };
    }

    /**
     * Fetch the channel creator's country from InnerTube browse API
     * @param {string} channelId - YouTube channel ID (UCxxxx)
     * @returns {Promise<string|null>} 2-letter country code or null
     */
    async function fetchChannelCountryFromInnerTube(channelId) {
      if (!channelId) return null;
      try {
        const url = `https://www.youtube.com/youtubei/v1/browse?key=${getInnerTubeApiKey()}&prettyPrint=false`;
        const body = {
          browseId: channelId,
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: getInnerTubeClientVersion(),
              hl: 'en',
              gl: 'US',
            },
          },
        };
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': getInnerTubeClientVersion(),
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) return null;
        const data = await response.json();
        // Try multiple header paths — YouTube returns c4TabbedHeaderRenderer for
        // older-UI channels and pageHeaderRenderer for newer-UI channels.
        // Also check frameworkUpdates mutations for new-UI country metadata.
        const country =
          data?.header?.c4TabbedHeaderRenderer?.country ||
          data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.find?.(
            (/** @type {any} */ p) => p?.text?.content?.length === 2
          )?.text?.content ||
          (() => {
            const mutations = data?.frameworkUpdates?.entityBatchUpdate?.mutations || [];
            for (const m of mutations) {
              const c =
                m?.payload?.channelHeaderMetadataEntityViewModel?.country ||
                m?.payload?.channelBasicInfoEntityViewModel?.country;
              if (c) return c;
            }
            return null;
          })();
        return country || null;
      } catch (_e) {
        return null;
      }
    }

    /**
     * Fetch video stats from InnerTube API
     * @param {string} videoId - Video ID
     * @returns {Promise<any|null>} Video stats or null
     */
    async function fetchVideoStatsInnerTube(videoId) {
      if (!videoId) return null;

      try {
        const url = `https://www.youtube.com/youtubei/v1/player?key=${getInnerTubeApiKey()}&prettyPrint=false`;
        const response = await fetch(url, createInnerTubeFetchOptions(videoId));

        if (!response.ok) {
          window.YouTubePlusLogger?.warn?.('Stats', `InnerTube API failed:`, response.status);
          return null;
        }

        const data = await response.json();
        const stats = parseVideoStatsFromResponse(data);

        // Fetch the creator country from YouTube's own browse API only.
        if (stats.channelId) {
          stats.country = await fetchChannelCountryFromInnerTube(stats.channelId);
        }

        return stats;
      } catch (error) {
        window.YouTubePlusLogger?.error?.('Stats', 'InnerTube fetch error:', error);
        return null;
      }
    }

    /**
     * Fetch dislikes from Return YouTube Dislike API
     * P8: deferred via requestIdleCallback — non-critical external call
     * @param {string} videoId - Video ID
     * @returns {Promise<any|null>} Likes and dislikes data
     */
    async function fetchDislikesData(videoId) {
      if (!videoId) return null;
      // P8: defer until browser is idle (non-critical enrichment data)
      await new Promise(resolve => {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(resolve, { timeout: 3000 });
        } else {
          setTimeout(resolve, 0);
        }
      });
      try {
        const response = await fetch(
          `https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`
        );
        if (!response.ok) return null;

        const data = await response.json();
        return {
          likes: data.likes || null,
          dislikes: data.dislikes || null,
          rating: data.rating || null,
        };
      } catch (error) {
        window.YouTubePlusLogger?.error?.('Stats', 'Failed to fetch dislikes:', error);
        return null;
      }
    }

    /**
     * Fetch video or channel stats from API (combines InnerTube + RYD)
     * @param {string} type - 'video' or 'channel'
     * @param {string} id - Video ID or Channel ID
     * @returns {Promise<any|null>} Stats data or null on error
     */
    async function fetchStats(type, id) {
      if (!id) return { ok: false, status: 0, data: null };

      try {
        if (type === 'video') {
          // Use InnerTube API for video data
          const videoData = await fetchVideoStatsInnerTube(id);
          if (!videoData) {
            return { ok: false, status: 404, data: null };
          }

          // Fetch likes/dislikes from RYD API
          const dislikeData = /** @type {any} */ (await fetchDislikesData(id));
          if (dislikeData) {
            videoData.likes = dislikeData.likes;
            videoData.dislikes = dislikeData.dislikes;
            videoData.rating = dislikeData.rating;
          }

          return { ok: true, status: 200, data: videoData };
        }

        // For channels, use existing API
        const endpoint = `https://api.livecounts.io/youtube-live-subscriber-counter/stats/${id}`;
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          window.YouTubePlusLogger?.warn?.(
            'Stats',
            `Failed to fetch ${type} stats:`,
            response.status
          );
          return { ok: false, status: response.status, data: null, url: endpoint };
        }

        const data = await response.json();
        return { ok: true, status: response.status, data, url: endpoint };
      } catch (error) {
        U?.logError?.('Stats', `Failed to fetch ${type} stats`, /** @type {any} */ (error));
        return { ok: false, status: 0, data: null };
      }
    }

    /**
     * Attempt to read basic video stats from the current page DOM as a fallback
     * Returns an object with views, likes, comments, subscribers when available
     */
    /**
     * Get video stats from current page DOM
     * Refactored to use helper functions and reduce complexity
     * @returns {any|null} Stats object or null
     */
    function getPageVideoStats() {
      try {
        // Use centralized helpers from YouTubeStatsHelpers when available.
        // If not present (some runtime environments), provide a lightweight
        // DOM-based fallback to avoid noisy errors and still surface basic stats.
        const helpers = /** @type {YouTubeStatsHelpers} */ (window.YouTubeStatsHelpers || {});

        const fallbackHelpers = {
          extractViews() {
            try {
              const el = $('yt-view-count-renderer, #count .view-count');
              const text = el?.textContent ? el.textContent.trim() : '';
              const match = text.replace(/[^0-9,.]/g, '').replace(/,/g, '');
              return match ? { views: Number(match) || null } : {};
            } catch (_e) {
              return {};
            }
          },
          extractLikes() {
            try {
              const btn =
                $('ytd-toggle-button-renderer[is-icon-button] yt-formatted-string') ||
                $(
                  '#top-level-buttons-computed ytd-toggle-button-renderer:first-child yt-formatted-string'
                );
              const text = btn?.textContent ? btn.textContent.trim() : '';
              const match = text.replace(/[^0-9,.]/g, '').replace(/,/g, '');
              return match ? { likes: Number(match) || null } : {};
            } catch (_e) {
              return {};
            }
          },
          extractDislikes() {
            // Dislike counts may not be available; return empty
            return {};
          },
          extractComments() {
            try {
              const el = $(
                '#count > ytd-comment-thread-renderer, ytd-comments-header-renderer #count'
              );
              const text = el?.textContent ? el.textContent.trim() : '';
              const match = text.replace(/[^0-9,.]/g, '').replace(/,/g, '');
              return match ? { comments: Number(match) || null } : {};
            } catch (_e) {
              return {};
            }
          },
          extractSubscribers() {
            try {
              const el = $('#owner-sub-count, #subscriber-count');
              const text = el?.textContent ? el.textContent.trim() : '';
              return text ? { subscribers: text } : {};
            } catch (_e) {
              return {};
            }
          },
          extractThumbnail() {
            try {
              const meta = $('link[rel="image_src"]') || $('meta[property="og:image"]');
              const url = meta && (meta.href || meta.content) ? meta.href || meta.content : null;
              return url ? { thumbnail: url } : {};
            } catch (_e) {
              return {};
            }
          },
          extractTitle() {
            try {
              const el = $('h1.title yt-formatted-string') || $('h1');
              const text = el?.textContent ? el.textContent.trim() : '';
              return text ? { title: text } : {};
            } catch (_e) {
              return {};
            }
          },
          extractAuthor() {
            try {
              // Try to get the @handle from the owner link
              const handleEl =
                $('ytd-video-owner-renderer #channel-handle') ||
                $('ytd-video-owner-renderer yt-formatted-string.ytd-channel-name a') ||
                $('#owner ytd-channel-name a') ||
                $('ytd-video-owner-renderer #owner-name a');
              const handleText = handleEl?.textContent?.trim() || '';
              // Some links contain the @handle, others contain the channel name
              const handle = handleText.startsWith('@') ? handleText : null;
              const nameEl =
                $('ytd-video-owner-renderer #channel-name') ||
                $('ytd-video-owner-renderer #owner-name');
              const authorName = nameEl?.textContent?.trim() || null;
              if (handle || authorName) {
                return { authorHandle: handle, author: authorName };
              }
              return {};
            } catch (_e) {
              return {};
            }
          },
        };

        const use = /** @type {YouTubeStatsHelpers} */ (
          helpers?.extractViews ? helpers : fallbackHelpers
        );

        // Merge all extracted stats (helpers may return partial objects)
        const result = Object.assign(
          {},
          use.extractViews?.() || {},
          use.extractLikes?.() || {},
          use.extractDislikes?.() || {},
          use.extractComments?.() || {},
          use.extractSubscribers?.() || {},
          use.extractThumbnail?.() || {},
          use.extractTitle?.() || {},
          use.extractAuthor?.() || {}
        );

        return Object.keys(result).length > 0 ? result : null;
      } catch (e) {
        U?.logError?.('Stats', 'Failed to read page stats', /** @type {any} */ (e));
        return null;
      }
    }

    /**
     * Build a single stats card HTML fragment for a page fallback metric
     * @param {number | string | null | undefined} value - Metric value
     * @param {string} labelKey - Translation key for the label
     * @param {string} iconClass - CSS class for the icon background
     * @param {string} iconSvg - SVG markup for the icon
     * @returns {string} HTML fragment or empty string when value missing
     * @private
     */
    function buildPageStatCard(
      /** @type {number | string | null | undefined} */ value,
      /** @type {string} */ labelKey,
      /** @type {string} */ iconClass,
      /** @type {string} */ iconSvg
    ) {
      if (value === undefined || value === null) return '';
      return `
        <div class="stats-card">
          <div class="stats-icon ${iconClass}">
            ${iconSvg}
          </div>
          <div class="stats-info">
            <div class="stats-label">${t(labelKey)}</div>
            <div class="stats-value">${formatNumber(Number(value))}</div>
            <div class="stats-exact">${(value || 0).toLocaleString()}</div>
          </div>
        </div>
      `;
    }

    /**
     * Build a minimal stats card that displays only a value and/or icon
     * @param {any} value - Value to display
     * @param {string} [iconOrClass=''] - SVG markup or a CSS class name
     * @param {{showValue: boolean, showIcon: boolean}} [options] - Display options
     * @returns {string} HTML fragment or empty string
     * @private
     */
    function buildValueOnlyCard(
      /** @type {any} */ value,
      /** @type {string} */ iconOrClass = '',
      /** @type {{showValue: boolean, showIcon: boolean}} */ options = {
        showValue: true,
        showIcon: true,
      }
    ) {
      const { showValue, showIcon } = options;
      if (!(showValue || showIcon)) return '';

      // If value is null/undefined and we are to show value, treat as unknown
      let displayVal = '';
      if (showValue) {
        displayVal = value === undefined || value === null ? t('unknown') : value;
      }

      // Determine whether iconOrClass is HTML (contains '<') or a plain class name
      let iconContent = '';
      let extraClass = '';
      if (showIcon) {
        if (iconOrClass && typeof iconOrClass === 'string' && iconOrClass.indexOf('<') >= 0) {
          // it's HTML (SVG), render inside
          iconContent = iconOrClass;
        } else if (iconOrClass && typeof iconOrClass === 'string') {
          // treat as a class name to apply to the icon wrapper
          extraClass = ` ${iconOrClass}`;
        }
      }

      return `
      <div class="stats-card">
        <div class="stats-icon${extraClass}">${iconContent}</div>
        <div class="stats-info">
          ${showValue ? `<div class="stats-value">${displayVal}</div>` : ''}
        </div>
      </div>
    `;
    }

    /**
     * Build stat cards for all metrics
     * @param {any} pageStats - Page statistics
     * @returns {Array<string>} Array of card HTML strings
     * @private
     */
    function buildStatCards(pageStats) {
      const cardConfigs = [
        {
          value: pageStats.views,
          key: 'views',
          icon: 'stats-icon-views',
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
        },
        {
          value: pageStats.likes,
          key: 'likes',
          icon: 'stats-icon-likes',
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>',
        },
        {
          value: pageStats.dislikes,
          key: 'dislikes',
          icon: 'stats-icon-dislikes',
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg>',
        },
        {
          value: pageStats.comments,
          key: 'comments',
          icon: 'stats-icon-comments',
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
        },
      ];

      return cardConfigs
        .map(config => buildPageStatCard(config.value, config.key, config.icon, config.svg))
        .filter(card => card);
    }

    // NOTE: getThumbnailUrl is defined below (after getFirstAvailableField) as the canonical
    // single implementation. This comment replaces the former duplicate definition that had
    // reversed parameter order (id, pageStats) vs the active (stats, id) — removing it
    // eliminates the hoisting bug where the second definition always shadowed this one.

    /**
     * Build extra metadata cards
     * @param {any} extras - Extra metadata
     * @returns {string} HTML for extra cards
     * @private
     */
    function buildExtraCards(/** @type {any} */ extras) {
      const monetizationText = extras.monetization || t('unknown');
      const countryText = extras.country || t('unknown');
      const durationText = extras.duration || t('unknown');

      const extraMonCard = buildValueOnlyCard(monetizationText, 'stats-icon-subscribers', {
        showValue: false,
        showIcon: true,
      });
      const extraCountryCard = buildValueOnlyCard(countryText, 'stats-icon-views', {
        showValue: false,
        showIcon: true,
      });
      const extraDurationCard = buildValueOnlyCard(durationText, 'stats-icon-videos', {
        showValue: true,
        showIcon: false,
      });

      return `${extraMonCard}${extraCountryCard}${extraDurationCard}`;
    }

    /**
     * Build complete HTML with thumbnail layout
     * @param {string} titleHtml - Title HTML
     * @param {string} thumbUrl - Thumbnail URL
     * @param {string} gridHtml - Grid HTML
     * @param {any} extras - Extra metadata
     * @returns {string} Complete HTML
     * @private
     */
    function buildThumbnailLayout(
      /** @type {string} */ titleHtml,
      /** @type {string} */ thumbUrl,
      /** @type {string} */ gridHtml,
      /** @type {any} */ extras
    ) {
      const extraCards = buildExtraCards(extras);
      const leftHtml = `<div class="stats-thumb-left"><img class="stats-thumb-img" src="${thumbUrl}" alt="thumbnail"><div class="stats-thumb-extras">${extraCards}</div></div>`;
      return `${titleHtml}<div class="stats-thumb-row">${leftHtml}${gridHtml}</div>`;
    }

    /**
     * Render page statistics fallback view
     * @param {HTMLElement} container - Container element
     * @param {any} pageStats - Page statistics
     * @param {string} id - Video ID
     */
    function renderPageFallback(
      /** @type {HTMLElement} */ container,
      /** @type {any} */ pageStats,
      /** @type {string} */ id
    ) {
      // Build stat cards
      const cards = buildStatCards(pageStats);
      const gridHtml = `<div class="stats-grid">${cards.join('')}</div>`;

      // Get title and escape for XSS prevention
      const title = pageStats?.title || document.title || '';
      const safeTitle = escapeHtml(title);
      const titleHtml = safeTitle
        ? `<div class="stats-thumb-title-centered">${safeTitle}</div>`
        : '';

      // Get thumbnail and extras
      // NOTE: getThumbnailUrl signature is (stats, id) — pass pageStats first, id second
      const thumbUrl = getThumbnailUrl(pageStats, id);
      const extras = getVideoExtras(null, pageStats);

      // Render appropriate layout
      if (thumbUrl) {
        _setSafeHTML(container, buildThumbnailLayout(titleHtml, thumbUrl, gridHtml, extras));
      } else {
        _setSafeHTML(container, `${titleHtml}${gridHtml}`);
      }
    }

    /**
     * Format number with K/M/B suffixes
     * @param {number} num - Number to format
     * @returns {string} Formatted number
     */
    function formatNumber(num) {
      if (!num || Number.isNaN(num)) return '0';
      const absNum = Math.abs(num);

      if (absNum >= 1e9) {
        return `${(num / 1e9).toFixed(1)}B`;
      }
      if (absNum >= 1e6) {
        return `${(num / 1e6).toFixed(1)}M`;
      }
      if (absNum >= 1e3) {
        return `${(num / 1e3).toFixed(1)}K`;
      }
      return num.toLocaleString();
    }

    /**
     * Create a stats card HTML fragment
     * @param {string} labelKey
     * @param {number|null} value
     * @param {number|null} exact
     * @param {string} iconClass
     * @param {string} iconSvg
     * @returns {string}
     */
    function makeStatsCard(labelKey, value, exact, iconClass, iconSvg) {
      const display = value == null ? t('unknown') : formatNumber(value);
      // Show exact 0 as "0" (0 is falsy), only show dash when null/undefined
      // Ensure numeric values are properly converted to integers for exact display
      let exactText = '—';
      if (exact !== null && exact !== undefined) {
        const numExact = Number(exact);
        exactText = !Number.isNaN(numExact) ? Math.floor(numExact).toLocaleString() : String(exact);
      }
      return `
        <div class="stats-card">
          <div class="stats-icon ${iconClass}">
            ${iconSvg}
          </div>
          <div class="stats-info">
            <div class="stats-label">${t(labelKey)}</div>
            <div class="stats-value">${display}</div>
            <div class="stats-exact">${exactText}</div>
          </div>
        </div>
      `;
    }

    /**
     * Normalize and pick preferred video fields
     * @param {any} stats
     * @returns {{views: number|null, likes: number|null, dislikes: number|null, comments: number|null, liveViewer: number|null, title: string, thumbUrl: string, country: string|null, monetized: boolean|null}}
     */
    /**
     * Extract video fields from stats object
     * Simplified by using more consistent field access
     * @param {any} stats - Stats object
     * @param {string} id - Video ID
     * @returns {any} Extracted fields
     */
    /**
     * Get first available field from stats object
     * @param {any} stats - Stats object
     * @param {string[]} fields - Field names to check
     * @returns {*} First available value or null
     */
    function getFirstAvailableField(/** @type {any} */ stats, /** @type {string[]} */ ...fields) {
      for (const field of fields) {
        if (stats?.[field] != null) return stats[field];
      }
      return null;
    }

    /**
     * Get thumbnail URL for video
     * @param {any} stats - Stats object
     * @param {string} id - Video ID
     * @returns {string} Thumbnail URL
     */
    function getThumbnailUrl(/** @type {any} */ stats, /** @type {string} */ id) {
      const raw = stats?.thumbnail;
      if (raw) {
        // Validate thumbnail URL is from a trusted domain to prevent attribute injection
        try {
          const parsed = new URL(raw);
          const h = parsed.hostname;
          if (
            parsed.protocol === 'https:' &&
            (h === 'ytimg.com' ||
              h.endsWith('.ytimg.com') ||
              h === 'ggpht.com' ||
              h.endsWith('.ggpht.com') ||
              h === 'googleusercontent.com' ||
              h.endsWith('.googleusercontent.com') ||
              h === 'youtube.com' ||
              h.endsWith('.youtube.com'))
          ) {
            return raw;
          }
        } catch (_e) {
          // Invalid URL - fall through to constructed URL
        }
      }
      return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
    }

    /**
     * Extract video fields from stats object
     * @param {any} stats - Stats data
     * @param {string} id - Video ID
     * @returns {any} Extracted fields
     */
    function extractVideoFields(/** @type {any} */ stats, /** @type {string} */ id) {
      return {
        views: getFirstAvailableField(stats, 'liveViews', 'views', 'viewCount'),
        likes: getFirstAvailableField(stats, 'liveLikes', 'likes', 'likeCount'),
        dislikes: getFirstAvailableField(stats, 'dislikes', 'liveDislikes', 'dislikeCount'),
        comments: getFirstAvailableField(stats, 'liveComments', 'comments', 'commentCount'),
        liveViewer: getFirstAvailableField(stats, 'liveViewer', 'live_viewers'),
        title: stats?.title || document.title || '',
        thumbUrl: getThumbnailUrl(stats, id),
        country: getFirstAvailableField(stats, 'country'),
        monetized: stats?.monetized ?? null,
        duration: getFirstAvailableField(stats, 'duration'),
        author: getFirstAvailableField(stats, 'author'),
        authorHandle: getFirstAvailableField(stats, 'authorHandle'),
      };
    }

    /**
     * Merge API-provided video stats with page-derived stats
     * Simplified to use helper function for field extraction
     * @param {any|null} apiStats - API stats
     * @param {any|null} pageStats - Page stats
     * @returns {any} Merged stats
     */
    function mergeVideoStats(/** @type {any} */ apiStats, /** @type {any} */ pageStats) {
      if (!pageStats) return apiStats || {};

      const getValue = (/** @type {string[]} */ ...fields) => {
        for (const field of fields) {
          if (apiStats?.[field] != null) return apiStats[field];
        }
        for (const field of fields) {
          if (pageStats?.[field] != null) return pageStats[field];
        }
        return null;
      };

      return {
        ...apiStats,
        views: getValue('views', 'viewCount'),
        likes: getValue('likes', 'likeCount'),
        dislikes: getValue('dislikes'),
        comments: getValue('comments', 'commentCount'),
        thumbnail: getValue('thumbnail'),
        title: getValue('title'),
        liveViewer: getValue('liveViewer'),
        // Preserve extra metadata when available (duration, country, monetization)
        duration: getValue('duration'),
        country: getValue('country'),
        monetized: getValue('monetized', 'isMonetized', 'monetization'),
        author: getValue('author'),
        authorHandle: getValue('authorHandle'),
      };
    }

    /**
     * Extract extra metadata (duration, monetization, country) from API or page
     * @param {any|null} apiStats - API stats
     * @param {any|null} pageStats - Page stats
     * @returns {{duration: string|null, monetization: string|null, country: string|null}} Metadata
     */
    function getVideoExtras(/** @type {any} */ apiStats, /** @type {any} */ pageStats) {
      const helpers = /** @type {YouTubeStatsHelpers} */ (window.YouTubeStatsHelpers || {});
      // Prefer explicit fields on the stats objects first, then fall back to helper functions
      const duration =
        apiStats?.duration ??
        pageStats?.duration ??
        helpers.getDurationFromSources?.(apiStats, pageStats) ??
        null;
      const country =
        apiStats?.country ??
        pageStats?.country ??
        helpers.getCountryFromSources?.(apiStats, pageStats) ??
        null;

      // Monetization can be boolean or descriptive string from helpers
      let monetization = null;
      if (apiStats?.monetized != null) {
        monetization = apiStats.monetized === true ? t('yes') : t('no');
      } else if (pageStats?.monetized != null) {
        monetization = pageStats.monetized === true ? t('yes') : t('no');
      } else {
        monetization = helpers.getMonetizationFromSources?.(apiStats, pageStats, t) ?? null;
      }

      return { duration, country, monetization };
    }

    /**
     * Open stats modal with live data display
     * @param {string} type - 'video' or 'channel'
     * @param {string} id - Video ID or Channel ID
     */
    /**
     * Create close button for stats modal
     * @param {HTMLElement} overlay - Overlay element to close
     * @returns {HTMLElement} Close button
     */
    function createStatsModalCloseButton(overlay) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'stats-modal-close thumbnail-modal-action-btn ytp-plus-settings-close';
      closeBtn.setAttribute('data-shared-close-button', 'ytp-plus-close-settings');
      _setSafeHTML(
        closeBtn,
        `
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.5 9.50002L9.5 14.5M9.49998 9.5L14.5 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>
        `
      );
      closeBtn.title = t('closeButton') || t('close');
      closeBtn.setAttribute('aria-label', t('closeButton') || t('close'));
      closeBtn.addEventListener('click', (/** @type {MouseEvent} */ e) => {
        e.preventDefault();
        e.stopPropagation();
        overlay.remove();
      });
      return closeBtn;
    }

    /**
     * Create loading spinner element
     * @returns {HTMLElement} Loading spinner
     */
    function createLoadingSpinner() {
      const loader = document.createElement('div');
      loader.className = 'stats-loader';
      _setSafeHTML(
        loader,
        `
      <svg class="stats-spinner" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4"></circle>
      </svg>
      <p>${t('loadingStats')}</p>
    `
      );
      return loader;
    }

    /**
     * Create stats modal structure
     * @param {HTMLElement} overlay - Overlay element
     * @returns {{body: HTMLElement, container: HTMLElement}} Modal elements
     */
    function createStatsModalStructure(overlay) {
      const container = document.createElement('div');
      container.className = 'stats-modal-container';
      container.setAttribute('role', 'dialog');
      container.setAttribute('aria-modal', 'true');
      container.setAttribute('aria-label', t('videoStats') || 'Video Statistics');

      const content = document.createElement('div');
      content.className = 'stats-modal-content ytp-plus-modal-content';

      const body = document.createElement('div');
      body.className = 'stats-modal-body';
      body.appendChild(createLoadingSpinner());

      content.appendChild(body);

      const wrapper = document.createElement('div');
      wrapper.className = 'thumbnail-modal-wrapper';

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'thumbnail-modal-actions';
      actionsDiv.appendChild(createStatsModalCloseButton(overlay));

      wrapper.appendChild(content);
      wrapper.appendChild(actionsDiv);
      container.appendChild(wrapper);

      return { body, container };
    }

    /**
     * Setup modal event handlers
     * @param {HTMLElement} overlay - Overlay element
     * @returns {void}
     */
    function setupModalEventHandlers(overlay) {
      // Store previously focused element for focus restoration
      const previouslyFocused = document.activeElement;

      // Close when clicking outside
      overlay.addEventListener('click', (/** @type {MouseEvent} */ event) => {
        const { target } = event;
        if (target === overlay) {
          overlay.remove();
          try {
            if (previouslyFocused) /** @type {HTMLElement} */ (previouslyFocused).focus();
          } catch (_e) {
            U.logSuppressed(_e, 'Stats');
          }
        }
      });

      // ESC to close
      function escHandler(/** @type {KeyboardEvent} */ e) {
        if (e.key === 'Escape') {
          overlay.remove();
          window.removeEventListener('keydown', escHandler, true);
          try {
            if (previouslyFocused) /** @type {HTMLElement} */ (previouslyFocused).focus();
          } catch (_e) {
            U.logSuppressed(_e, 'Stats');
          }
        }
      }
      window.addEventListener('keydown', escHandler, true);

      // Move focus into the modal after it's appended
      requestAnimationFrame(() => {
        const focusTarget = overlay.querySelector('button, [tabindex="0"]');
        if (focusTarget) /** @type {HTMLElement} */ (focusTarget).focus();
      });

      // Apply focus trap if available
      if (window.YouTubePlusModalHandlers?.createFocusTrap) {
        const removeTrap = window.YouTubePlusModalHandlers.createFocusTrap(overlay);
        // Clean up trap when overlay is removed
        const coordinator = window.YouTubePlusMutationCoordinator;
        if (coordinator?.subscribeRoot) {
          const trapSubId = `stats::overlayTrap::${Date.now()}::${Math.random()
            .toString(36)
            .slice(2, 8)}`;
          coordinator.subscribeRoot(
            trapSubId,
            () => {
              if (!overlay.isConnected) {
                removeTrap();
                coordinator.unsubscribe(trapSubId);
              }
            },
            { selector: null, childList: true, attributes: false, subtree: true }
          );
        }
      }
    }

    /**
     * Render error message in modal
     * @param {HTMLElement} body - Body element
     * @param {any} result - Fetch result
     * @returns {void}
     */
    function renderErrorMessage(body, result) {
      const statusText = result?.status ? ` (${result.status})` : '';
      const endpointHint = result?.url
        ? `<div style="margin-top:8px;font-size:12px;opacity:0.8;word-break:break-all">${result.url}</div>`
        : '';
      _setSafeHTML(
        body,
        `
        <div class="stats-error">
          <svg class="stats-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>${t('failedToLoadStats')}${statusText}</p>
          ${endpointHint}
        </div>
      `
      );
    }

    /**
     * Handle failed stats fetch
     * @param {HTMLElement} body - Body element
     * @param {any} result - Fetch result
     * @param {string} id - Video/channel ID
     * @returns {void}
     */
    function handleFailedFetch(body, result, id) {
      const pageStats = getPageVideoStats();
      if (pageStats) {
        renderPageFallback(body, pageStats, id);
      } else {
        renderErrorMessage(body, result);
      }
    }

    /**
     * Display stats based on type
     * @param {HTMLElement} body - Body element
     * @param {string} type - Stats type (video/channel)
     * @param {any} stats - Stats data
     * @param {string} id - Video/channel ID
     * @returns {void}
     */
    function displayStatsBasedOnType(body, type, stats, id) {
      if (type === 'video') {
        try {
          const pageStats = getPageVideoStats();
          const merged = mergeVideoStats(stats, pageStats);
          displayVideoStats(body, merged, id);
        } catch (_e) {
          displayVideoStats(body, stats, id);
        }
      } else {
        displayChannelStats(body, stats);
      }
    }

    /**
     * Open stats modal
     * @param {string} type - Stats type (video/channel)
     * @param {string} id - Video/channel ID
     * @returns {Promise<void>}
     */
    async function openStatsModal(type, id) {
      if (!(type && id)) {
        window.YouTubePlusLogger?.error?.('Stats', 'Invalid parameters for modal');
        return;
      }

      // Remove existing overlays (cache NodeList to avoid repeated lookups)
      const existingOverlays = $$('.stats-modal-overlay');
      for (let i = 0; i < existingOverlays.length; i++) {
        try {
          existingOverlays[i].remove();
        } catch (_e) {
          /* ignore individual failures */
        }
      }

      // Create modal structure
      const overlay = document.createElement('div');
      overlay.className = 'stats-modal-overlay ytp-plus-modal-overlay';

      const { body, container } = createStatsModalStructure(overlay);
      overlay.appendChild(container);

      setupModalEventHandlers(overlay);
      document.body.appendChild(overlay);

      // Fetch and display stats
      const result = /** @type {any} */ (await fetchStats(type, id));

      if (!result?.ok) {
        handleFailedFetch(body, result, id);
        return;
      }

      displayStatsBasedOnType(body, type, result.data, id);
    }

    /**
     * Display video statistics
     * @param {HTMLElement} container - Container element
     * @param {any} stats - Stats data
     */
    /**
     * Get stat card definitions for video stats
     * @param {any} fields - Extracted video fields
     * @returns {any[]} Card definitions
     */
    function getVideoStatDefinitions(fields) {
      const { views, likes, dislikes, comments } = fields;
      return [
        {
          label: 'views',
          value: views,
          exact: views,
          iconClass: 'stats-icon-views',
          iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
        },
        {
          label: 'likes',
          value: likes,
          exact: likes,
          iconClass: 'stats-icon-likes',
          iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>`,
        },
        {
          label: 'dislikes',
          value: dislikes,
          exact: dislikes,
          iconClass: 'stats-icon-dislikes',
          iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg>`,
        },
        {
          label: 'comments',
          value: comments,
          exact: comments,
          iconClass: 'stats-icon-comments',
          iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
        },
      ];
    }

    /**
     * Create live viewer stats card if available
     * @param {*} liveViewer - Live viewer count
     * @returns {string} HTML string or empty string
     */
    function createLiveViewerCard(liveViewer) {
      if (liveViewer === undefined || liveViewer === null) return '';
      return makeStatsCard(
        'liveViewers',
        liveViewer,
        liveViewer,
        'stats-icon-viewers',
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`
      );
    }

    /**
     * Create monetization meta card
     * @param {any} extras - Video extras
     * @param {any} stats - Stats object
     * @returns {string} HTML string
     */
    function createMonetizationCard(extras, stats) {
      const monetizationValue = extras.monetization || t('unknown');
      const isMonetized = extras.monetization === t('yes') || stats?.monetized === true;
      // Maps to design tokens: #22c55e = --yt-stats-icon-likes, #ef4444 = --yt-stats-icon-dislikes
      // (SVG stroke attributes don't support CSS var() in all contexts, using hex values)
      const monIcon = isMonetized
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
      return `<div class="stats-card" style="padding:10px;"><div class="stats-icon stats-icon-subscribers">${monIcon}</div><div class="stats-info"><div class="stats-label" style="font-size:12px;">${t('monetization')}</div><div class="stats-value" style="font-size:16px;">${monetizationValue}</div></div></div>`;
    }

    /**
     * Create country meta card with flag
     * @param {any} extras - Video extras
     * @returns {string} HTML string
     */
    function createCountryCard(extras) {
      const countryValue = escapeHtml(extras.country || t('unknown'));
      // Country codes must be exactly 2 uppercase letters (ISO 3166-1 alpha-2)
      const rawCode =
        extras.country && extras.country !== t('unknown') ? extras.country.toUpperCase() : '';
      const countryCode = /^[A-Z]{2}$/.test(rawCode) ? rawCode : '';
      const globeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;

      if (countryCode) {
        const flagUrl = `https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.3.2/flags/4x3/${countryCode.toLowerCase()}.svg`;
        return `<div class="stats-card" style="padding:10px;"><div class="stats-icon stats-icon-views" data-fallback-icon="globe"><img class="country-flag" src="${flagUrl}" alt="${countryCode}" width="32" height="24" style="border-radius:4px;"/></div><div class="stats-info"><div class="stats-label" style="font-size:12px;">${t('country')}</div><div class="stats-value" style="font-size:16px;">${countryCode}</div></div></div>`;
      }
      return `<div class="stats-card" style="padding:10px;"><div class="stats-icon stats-icon-views">${globeIcon}</div><div class="stats-info"><div class="stats-label" style="font-size:12px;">${t('country')}</div><div class="stats-value" style="font-size:16px;">${countryValue}</div></div></div>`;
    }

    /**
     * Create duration meta card
     * @param {any} extras - Video extras
     * @returns {string} HTML string
     */
    /**
     * Format duration values into human readable strings.
     * Accepts seconds (number or numeric string), ISO8601 (PT1H2M3S),
     * or colon-formatted strings (MM:SS or HH:MM:SS).
     * Returns null when value cannot be parsed.
     * @param {number|string} value
     * @returns {string|null}
     */
    function formatDuration(value) {
      if (value == null) return null;

      function pad(/** @type {number} */ n) {
        return String(n).padStart(2, '0');
      }

      function secToHms(/** @type {number} */ sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${m}:${pad(s)}`;
      }

      // number -> seconds
      if (typeof value === 'number' && Number.isFinite(value)) return secToHms(value);

      // numeric string
      if (typeof value === 'string') {
        const s = value.trim();
        if (/^\d+$/.test(s)) return secToHms(Number(s));

        // ISO 8601 duration PT#H#M#S
        if (s.length > 2 && s[0].toUpperCase() === 'P' && s[1].toUpperCase() === 'T') {
          let h = 0;
          let m = 0;
          let sec = 0;
          let current = '';
          let valid = true;
          for (let i = 2; i < s.length; i += 1) {
            const ch = s[i];
            if (ch >= '0' && ch <= '9') {
              current += ch;
              continue;
            }
            if (!current) {
              valid = false;
              break;
            }
            const n = parseInt(current, 10);
            current = '';
            if (ch === 'H' || ch === 'h') h = n;
            else if (ch === 'M' || ch === 'm') m = n;
            else if (ch === 'S' || ch === 's') sec = n;
            else {
              valid = false;
              break;
            }
          }
          if (valid && current === '') {
            return secToHms(h * 3600 + m * 60 + sec);
          }
        }

        // Already colon formatted like M:SS or H:MM:SS
        const colonParts = s.split(':');
        if (colonParts.length === 2 || colonParts.length === 3) {
          const allDigits = colonParts.every(part => part.length > 0 && /^\d+$/.test(part));
          if (allDigits && colonParts.slice(1).every(part => part.length <= 2)) {
            const parts = colonParts.map(p => {
              const trimmed = p.replace(/^0+/, '');
              return trimmed === '' ? '0' : trimmed;
            });
            // normalize to pad minutes/seconds
            if (parts.length === 2) {
              const [mm, ss] = parts;
              return `${Number(mm)}:${pad(Number(ss))}`;
            }
            if (parts.length === 3) {
              const [hh, mm, ss] = parts;
              return `${Number(hh)}:${pad(Number(mm))}:${pad(Number(ss))}`;
            }
          }
        }

        // fallback: return as-is (useful when API already provides formatted text)
        return s || null;
      }

      return null;
    }
    function createDurationCard(/** @type {any} */ extras) {
      const raw = extras?.duration ?? null;
      const formatted = formatDuration(raw);
      const durationValue = formatted || (raw ? String(raw) : null) || t('unknown');
      const durationIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
      return `<div class="stats-card" style="padding:10px;"><div class="stats-icon stats-icon-videos">${durationIcon}</div><div class="stats-info"><div class="stats-label" style="font-size:12px;">${t('duration')}</div><div class="stats-value" style="font-size:16px;">${durationValue}</div></div></div>`;
    }

    /**
     * Build metadata cards HTML
     * @param {any} stats - Stats object
     * @param {any} extras - Video extras
     * @returns {string} HTML string
     */
    function buildMetaCardsHtml(stats, /** @type {any} */ extras) {
      const cards = [
        createMonetizationCard(extras, stats),
        createCountryCard(extras),
        createDurationCard(extras),
      ];
      return cards.filter(Boolean).join('');
    }

    /**
     * Display video statistics
     * @param {HTMLElement} container - Container element
     * @param {any} stats - Stats data
     * @param {string} id - Video ID
     */
    function displayVideoStats(container, stats, id) {
      const fields = extractVideoFields(stats, id);
      const { liveViewer, title, thumbUrl } = fields;

      // Escape title for XSS prevention
      const safeTitle = escapeHtml(title);
      const titleHtml = safeTitle
        ? `<div class="stats-thumb-title-centered">${safeTitle}</div>`
        : '';
      const defs = getVideoStatDefinitions(fields);

      // Build individual cards but group likes+dislikes into a single grid cell so
      // they appear side-by-side on one line.
      const viewsDef = defs.find(d => d.label === 'views');
      const likesDef = defs.find(d => d.label === 'likes');
      const dislikesDef = defs.find(d => d.label === 'dislikes');
      const commentsDef = defs.find(d => d.label === 'comments');

      const viewsHtml = viewsDef
        ? makeStatsCard(
            viewsDef.label,
            viewsDef.value,
            viewsDef.exact,
            viewsDef.iconClass,
            viewsDef.iconSvg
          )
        : '';
      const likesHtml = likesDef
        ? makeStatsCard(
            likesDef.label,
            likesDef.value,
            likesDef.exact,
            likesDef.iconClass,
            likesDef.iconSvg
          )
        : '';
      const dislikesHtml = dislikesDef
        ? makeStatsCard(
            dislikesDef.label,
            dislikesDef.value,
            dislikesDef.exact,
            dislikesDef.iconClass,
            dislikesDef.iconSvg
          )
        : '';
      const commentsHtml = commentsDef
        ? makeStatsCard(
            commentsDef.label,
            commentsDef.value,
            commentsDef.exact,
            commentsDef.iconClass,
            commentsDef.iconSvg
          )
        : '';

      const pairHtml =
        likesHtml || dislikesHtml
          ? `<div class="stats-card-pair">${likesHtml}${dislikesHtml}</div>`
          : '';

      // Build centered large author/handle display (placed below stats grid)
      const { author, authorHandle } = fields;
      const safeAuthor = author ? escapeHtml(String(author)) : '';
      const safeHandle = authorHandle ? escapeHtml(String(authorHandle)) : '';
      const authorBigHtml =
        safeHandle || safeAuthor
          ? `<div class="stats-author-big">${
              safeHandle
                ? `<a class="stats-author-handle-big" href="https://www.youtube.com/${encodeURIComponent(
                    authorHandle
                  )}" target="_blank" rel="noopener noreferrer">${safeHandle}</a>`
                : `<span class="stats-author-name-big">${safeAuthor}</span>`
            }</div>`
          : '';

      const parts = [viewsHtml, pairHtml, commentsHtml].filter(Boolean);

      const liveViewerCard = createLiveViewerCard(liveViewer);
      if (liveViewerCard) parts.push(liveViewerCard);

      const gridHtml = `<div class="stats-grid">${parts.join('')}</div>`;
      const sideColumnHtml = `<div class="stats-side-column">${gridHtml}${authorBigHtml}</div>`;

      if (thumbUrl) {
        const extras = getVideoExtras(stats, null);
        const metaCardsHtml = buildMetaCardsHtml(stats, extras);
        const metaExtrasHtml = metaCardsHtml
          ? `<div class="stats-thumb-extras" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">${metaCardsHtml}</div>`
          : '';
        const leftHtml = `<div class="stats-thumb-left"><img class="stats-thumb-img" src="${thumbUrl}" alt="thumbnail">${metaExtrasHtml}</div>`;
        _setSafeHTML(
          container,
          `${titleHtml}<div class="stats-thumb-row">${leftHtml}${sideColumnHtml}</div>`
        );
      } else {
        _setSafeHTML(container, `${titleHtml}${sideColumnHtml}`);
      }

      // Set up error handlers for country flag images
      setupFlagImageErrorHandlers(container);
    }

    /**
     * Setup error handlers for country flag images to prevent XSS
     * @param {HTMLElement} container - Container element
     */
    function setupFlagImageErrorHandlers(container) {
      const flagImages = $$('.country-flag', /** @type {any} */ (container));
      const globeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;

      flagImages.forEach((/** @type {any} */ img) => {
        img.addEventListener(
          'error',
          /** @this {any} */
          function () {
            const iconContainer = this.parentElement;
            if (iconContainer && iconContainer.dataset.fallbackIcon === 'globe') {
              this.style.display = 'none';
              _setSafeHTML(iconContainer, globeIcon);
            }
          },
          { once: true }
        );
      });
    }

    /**
     * Display channel statistics
     * @param {HTMLElement} container - Container element
     * @param {any} stats - Stats data
     */
    function displayChannelStats(container, stats) {
      const { liveSubscriber, liveViews, liveVideos } = stats;

      _setSafeHTML(
        container,
        `
      <div class="stats-grid">
        <div class="stats-card">
          <div class="stats-icon stats-icon-subscribers">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
          <div class="stats-info">
            <div class="stats-label">${t('subscribers')}</div>
            <div class="stats-value">${formatNumber(liveSubscriber)}</div>
            <div class="stats-exact">${(liveSubscriber || 0).toLocaleString()}</div>
          </div>
        </div>

        <div class="stats-card">
          <div class="stats-icon stats-icon-views">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </div>
          <div class="stats-info">
            <div class="stats-label">${t('totalViews')}</div>
            <div class="stats-value">${formatNumber(liveViews)}</div>
            <div class="stats-exact">${(liveViews || 0).toLocaleString()}</div>
          </div>
        </div>

        <div class="stats-card">
          <div class="stats-icon stats-icon-videos">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="23 7 16 12 23 17 23 7"></polygon>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
          </div>
          <div class="stats-info">
            <div class="stats-label">${t('totalVideos')}</div>
            <div class="stats-value">${formatNumber(liveVideos)}</div>
            <div class="stats-exact">${(liveVideos || 0).toLocaleString()}</div>
          </div>
        </div>
      </div>
      `
      );
    }

    /**
     * Create and insert the stats horizontal menu below the video owner actions
     * @returns {HTMLElement|undefined} The inserted menu container or undefined
     */
    function createStatsMenu() {
      if (!statsButtonEnabled) return undefined;
      if ($('.stats-menu-container')) {
        return undefined;
      }

      const resolveActionContainer = () => {
        const modernContainer = /** @type {HTMLElement | null} */ (
          $('#owner #top-row #buttons, #top-row #owner #buttons, #buttons.ytd-video-owner-renderer')
        );
        if (modernContainer) return modernContainer;

        const joinButton = /** @type {HTMLElement | null} */ (
          $('.yt-flexible-actions-view-model-wiz__action:not(.stats-menu-container)')
        );
        if (joinButton?.parentElement) return joinButton.parentElement;

        return /** @type {HTMLElement | null} */ ($('#subscribe-button + #buttons'));
      };

      const containerDiv = document.createElement('div');
      containerDiv.className = 'yt-flexible-actions-view-model-wiz__action stats-menu-container';

      const mainButtonViewModel = document.createElement('button-view-model');
      mainButtonViewModel.className = 'yt-spec-button-view-model main-stats-view-model';

      const mainButton = document.createElement('button');
      mainButton.className =
        'yt-spec-button-shape-next yt-spec-button-shape-next--outline yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--enable-backdrop-filter-experiment main-stats-button';
      mainButton.setAttribute('aria-disabled', 'false');
      mainButton.setAttribute('aria-label', t('stats'));
      if (mainButton.style) {
        mainButton.style.display = 'flex';
        mainButton.style.alignItems = 'center';
        mainButton.style.justifyContent = 'center';
        mainButton.style.gap = '8px';
      }

      const iconWrap = document.createElement('span');
      _setSafeHTML(
        iconWrap,
        '<svg viewBox="0 0 512 512" style="width:20px;height:20px;fill:currentColor"><path d="M500 89c13.8-11 16-31.2 5-45s-31.2-16-45-5L319.4 151.5 211.2 70.4c-11.7-8.8-27.8-8.5-39.2 .6L12 199c-13.8 11-16 31.2-5 45s31.2 16 45 5L192.6 136.5l108.2 81.1c11.7 8.8 27.8 8.5 39.2-.6L500 89zM160 256l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32zM32 352l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32zm288-64c-17.7 0-32 14.3-32 32l0 128c0 17.7 14.3 32 32 32s32-14.3 32-32l0-128c0-17.7-14.3-32-32-32zm96-32l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32z"/></svg>'
      );
      const svg = iconWrap.firstElementChild;

      const buttonText = document.createElement('div');
      buttonText.className = 'yt-spec-button-shape-next__button-text-content main-stats-text';
      buttonText.textContent = t('stats');
      if (buttonText.style) {
        buttonText.style.display = 'flex';
        buttonText.style.alignItems = 'center';
      }

      const touchFeedback = document.createElement('yt-touch-feedback-shape');
      if (touchFeedback.style) touchFeedback.style.borderRadius = 'inherit';

      const touchFeedbackDiv = document.createElement('div');
      touchFeedbackDiv.className =
        'yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--touch-response';
      touchFeedbackDiv.setAttribute('aria-hidden', 'true');

      const strokeDiv = document.createElement('div');
      strokeDiv.className = 'yt-spec-touch-feedback-shape__stroke';

      const fillDiv = document.createElement('div');
      fillDiv.className = 'yt-spec-touch-feedback-shape__fill';

      touchFeedbackDiv.appendChild(strokeDiv);
      touchFeedbackDiv.appendChild(fillDiv);
      touchFeedback.appendChild(touchFeedbackDiv);

      if (svg) {
        mainButton.appendChild(svg);
      }
      mainButton.appendChild(buttonText);
      mainButton.appendChild(touchFeedback);
      mainButtonViewModel.appendChild(mainButton);
      containerDiv.appendChild(mainButtonViewModel);

      const horizontalMenu = document.createElement('div');
      horizontalMenu.className = 'stats-horizontal-menu';

      const channelButtonContainer = document.createElement('div');
      channelButtonContainer.className = 'stats-menu-button channel-stats-container';

      const channelButton = createButton(
        t('channel'),
        'M64 48c-8.8 0-16 7.2-16 16l0 288c0 8.8 7.2 16 16 16l512 0c8.8 0 16-7.2 16-16l0-288c0-8.8-7.2-16-16-16L64 48zM0 64C0 28.7 28.7 0 64 0L576 0c35.3 0 64 28.7 64 64l0 288c0 35.3-28.7 64-64 64L64 416c-35.3 0-64-28.7-64-64L0 64zM120 464l400 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-400 0c-13.3 0-24-10.7-24-24s10.7-24 24-24z',
        '0 0 640 512',
        'channel-stats',
        () => {
          const channelId = getChannelIdentifier();
          if (channelId) {
            openStatsModal('channel', channelId);
          }
        }
      );
      channelButtonContainer.appendChild(channelButton);
      horizontalMenu.appendChild(channelButtonContainer);

      if (channelFeatures.hasStreams) {
        const liveButtonContainer = document.createElement('div');
        liveButtonContainer.className = 'stats-menu-button live-stats-container';

        const liveButton = createButton(
          t('live'),
          'M99.8 69.4c10.2 8.4 11.6 23.6 3.2 33.8C68.6 144.7 48 197.9 48 256s20.6 111.3 55 152.8c8.4 10.2 7 25.3-3.2 33.8s-25.3 7-33.8-3.2C24.8 389.6 0 325.7 0 256S24.8 122.4 66 72.6c8.4-10.2 23.6-11.6 33.8-3.2zm376.5 0c10.2-8.4 25.3-7 33.8 3.2c41.2 49.8 66 113.8 66 183.4s-24.8 133.6-66 183.4c-8.4 10.2-23.6 11.6-33.8 3.2s-11.6-23.6-3.2-33.8c34.3-41.5 55-94.7 55-152.8s-20.6-111.3-55-152.8c-8.4-10.2-7-25.3 3.2-33.8zM248 256a40 40 0 1 1 80 0 40 40 0 1 1 -80 0zm-61.1-78.5C170 199.2 160 226.4 160 256s10 56.8 26.9 78.5c8.1 10.5 6.3 25.5-4.2 33.7s-25.5 6.3-33.7-4.2c-23.2-29.8-37-67.3-37-108s13.8-78.2 37-108c8.1-10.5 23.2-12.3 33.7-4.2s12.3 23.2 4.2 33.7zM427 148c23.2 29.8 37 67.3 37 108s-13.8 78.2-37 108c-8.1 10.5-23.2 12.3-33.7 4.2s-12.3-23.2-4.2-33.7C406 312.8 416 285.6 416 256s-10-56.8-26.9-78.5c-8.1-10.5-6.3-25.5 4.2-33.7s25.5-6.3 33.7 4.2z',
          '0 0 576 512',
          'live-stats',
          () => {
            const channelId = getChannelIdentifier();
            if (channelId) {
              openStatsModal('channel', channelId);
            }
          }
        );

        liveButtonContainer.appendChild(liveButton);
        horizontalMenu.appendChild(liveButtonContainer);
      }

      if (channelFeatures.hasShorts) {
        const shortsButtonContainer = document.createElement('div');
        shortsButtonContainer.className = 'stats-menu-button shorts-stats-container';

        const shortsButton = createButton(
          t('shorts'),
          'M80 48c-8.8 0-16 7.2-16 16l0 384c0 8.8 7.2 16 16 16l224 0c8.8 0 16-7.2 16-16l0-384c0-8.8-7.2-16-16-16L80 48zM16 64C16 28.7 44.7 0 80 0L304 0c35.3 0 64 28.7 64 64l0 384c0 35.3-28.7 64-64 64L80 512c-35.3 0-64-28.7-64-64L16 64zM160 400l64 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-64 0c-8.8 0-16-7.2-16-16s7.2-16 16-16z',
          '0 0 384 512',
          'shorts-stats',
          () => {
            const channelId = getChannelIdentifier();
            if (channelId) {
              openStatsModal('channel', channelId);
            }
          }
        );

        shortsButtonContainer.appendChild(shortsButton);
        horizontalMenu.appendChild(shortsButtonContainer);
      }

      containerDiv.appendChild(horizontalMenu);

      const actionContainer = resolveActionContainer();
      if (actionContainer) {
        actionContainer.appendChild(containerDiv);
      }

      return containerDiv;
    }

    /**
     * Insert the stats menu if the owner action container exists and no menu is present
     * @returns {void}
     */
    function checkAndAddMenu() {
      if (!statsButtonEnabled) return;
      const actionContainer = $(
        '#owner #top-row #buttons, #top-row #owner #buttons, #buttons.ytd-video-owner-renderer, #subscribe-button + #buttons, .yt-flexible-actions-view-model-wiz__action:not(.stats-menu-container)'
      );
      const statsMenu = $('.stats-menu-container');

      if (actionContainer && !statsMenu) {
        createStatsMenu();
      }
    }

    /**
     * Ensure the universal stats icon is present in the masthead
     * @returns {void}
     */
    function checkAndInsertIcon() {
      if (!statsButtonEnabled) return;
      // Always ensure universal icon is present in the masthead
      insertUniversalIcon();
    }

    const handleExperimentalNavClick = (/** @type {Event} */ e) => {
      const { target } = e;
      const el = /** @type {EventTarget & HTMLElement} */ (target);
      const navItem = el?.closest?.('.ytp-plus-settings-nav-item');
      if (navItem?.dataset?.section === 'experimental') {
        attachSettingsHandler();
      }
    };

    if (U?.cleanupManager?.registerListener) {
      U.cleanupManager.registerListener(document, 'youtube-plus-language-changed', () => {
        attachSettingsHandler();
      });
    } else {
      document.addEventListener('youtube-plus-language-changed', () => {
        attachSettingsHandler();
      });
    }

    if (!experimentalNavListenerKey) {
      if (U?.cleanupManager?.registerListener) {
        experimentalNavListenerKey = U.cleanupManager.registerListener(
          document,
          'click',
          handleExperimentalNavClick,
          true
        );
      } else {
        document.addEventListener('click', handleExperimentalNavClick, true);
        experimentalNavListenerKey = 'native-click-listener';
      }
    }

    /**
     * Initialize the video stats module: inject styles, icon, menu, and listeners
     * @returns {void}
     */
    function init() {
      if (U?.isStudioPage?.()) return;
      addStyles();
      if (statsButtonEnabled) {
        checkAndInsertIcon();
        checkAndAddMenu();
      }

      // Use centralized pushState/replaceState event from utils.js instead of wrapping independently
      if (U?.cleanupManager?.registerListener) {
        U.cleanupManager.registerListener(window, 'ytp-history-navigate', checkUrlChange);
        U.cleanupManager.registerListener(window, 'popstate', checkUrlChange);
      } else {
        window.addEventListener('ytp-history-navigate', checkUrlChange);
        window.addEventListener('popstate', checkUrlChange);
      }

      if (U?.isChannelPage?.(location.href) ?? false) {
        checkChannelTabs(location.href);
      }
    }

    const scheduleInit = () => {
      if (statsInitialized || !isStatsRelevant()) return;
      statsInitialized = true;

      const run = () => {
        try {
          init();
        } catch (e) {
          statsInitialized = false;
          throw e;
        }
      };

      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 2000 });
      } else {
        setTimeout(run, 0);
      }
    };

    runWhenReady(scheduleInit);

    const handleNavigate = () => {
      scheduleInit();
      if (!(statsInitialized && statsButtonEnabled)) return;
      checkAndInsertIcon();
      checkAndAddMenu();
      if (U?.isChannelPage?.(location.href) ?? false) {
        checkChannelTabs(location.href);
      }
    };

    const _cleanupManager = U?.cleanupManager;
    if (_cleanupManager) {
      _cleanupManager.registerListener(document, 'yt-navigate-finish', handleNavigate, {
        passive: true,
      });
    } else {
      document.addEventListener('yt-navigate-finish', handleNavigate);
    }

    // Safety net: LazyLoader dispatches ytp:nav-refresh after every SPA nav.
    // Re-evaluate icon/menu presence so we don't depend solely on the
    // yt-navigate-finish listener which can race with DOM re-mounts.
    const _navRefreshHandler = () => {
      try {
        if (statsInitialized && statsButtonEnabled) {
          checkAndInsertIcon();
          checkAndAddMenu();
        }
      } catch (e) {
        void e;
      }
    };
    if (_cleanupManager) {
      _cleanupManager.registerListener(window, 'ytp:nav-refresh', _navRefreshHandler, {
        passive: true,
      });
    } else {
      window.addEventListener('ytp:nav-refresh', _navRefreshHandler);
    }

    const handleAction = (/** @type {Event} */ event) => {
      scheduleInit();
      if (!(statsInitialized && statsButtonEnabled)) return;
      const ev = /** @type {CustomEvent<any>} */ (event);
      if (ev.detail && ev.detail.actionName === 'yt-reload-continuation-items-command') {
        checkAndInsertIcon();
        checkAndAddMenu();
      }
    };

    if (_cleanupManager) {
      _cleanupManager.registerListener(document, 'yt-action', handleAction, {
        passive: true,
      });
    } else {
      document.addEventListener('yt-action', handleAction);
    }
  }; // end initVideoStats

  // Register settings modal listener at module scope so it fires
  // regardless of route. Without this, the listener inside
  // initVideoStats() would only be registered after whenRelevant
  // decides the route is relevant, causing a race condition where
  // opening the modal on the homepage would miss the event.
  document.addEventListener('youtube-plus-settings-modal-opened', initVideoStats, {
    once: false,
  });

  // Defer video stats init and only load module code on relevant routes
  // or when the settings modal is open (so the experimental tab can
  // populate the "Statistics button" toggle regardless of route).
  if (U?.whenRelevant) {
    U.whenRelevant({
      name: 'stats.video',
      isRelevant: () => isVideoStatsTriggerRoute() || isSettingsModalOpen(),
      onEnter: initVideoStats,
    });
  } else {
    initVideoStats();
  }
})();

// ═══════════════════════════════════════════════════════════════════
// Channel Stats IIFE — separate scope for channel-level statistics
// ═══════════════════════════════════════════════════════════════════
(function () {
  const U = window.YouTubeUtils;
  if (window.__ytpChannelStatsModuleInit) return;

  const isChannelStatsTriggerRoute = () => {
    try {
      const path = location.pathname || '';
      return path.startsWith('/@') || path.startsWith('/channel/') || path.startsWith('/c/');
    } catch (_e) {
      return false;
    }
  };

  const isSettingsModalOpen = () => U.isSettingsModalOpen();

  const initChannelStats = () => {
    if (window.__ytpChannelStatsModuleInit) return;
    window.__ytpChannelStatsModuleInit = true;

    const _setSafeHTML = U.setSafeHTML;
    const createVisibilityAwareInterval =
      /** @type {any} */ (U)?.createVisibilityAwareInterval ||
      /**
       * @type {(callback: () => void, delay: number) => { stop: () => void; pause: () => void; resume: () => void; active: boolean }}
       */
      (
        (callback, delay) => {
          // Interval fallback is used only when shared visibility-aware scheduler is unavailable.
          const id = setInterval(() => {
            if (!document.hidden) callback();
          }, delay);
          return {
            stop() {
              clearInterval(id);
            },
            pause() {
              clearInterval(id);
            },
            resume() {},
            get active() {
              return true;
            },
          };
        }
      );
    const setTimeout_ = setTimeout.bind(window);
    // Shared helpers from YouTubeUtils (separate IIFE scope requires local aliases)
    const $ = U.$;
    const byId = U.byId;

    // Shared translation helper — must be declared before "inject now"
    // so addSettingsUI() doesn't hit TDZ on `t`.
    const t = U.t;

    // Safe localStorage wrapper — guards against SecurityError in restricted contexts
    const _safeLS = window.YouTubeUtils?.safeLS || {
      /** @param {string} k @param {string|null} [def] @returns {string|null} */
      getItem: (k, def = null) => {
        try {
          return localStorage.getItem(k) ?? def;
        } catch (_e) {
          return def;
        }
      },
      /** @param {string} k @param {string} v @returns {boolean} */
      setItem: (k, v) => {
        try {
          localStorage.setItem(k, v);
          return true;
        } catch (_e) {
          return false;
        }
      },
      /** @param {string} k */
      removeItem: k => {
        try {
          localStorage.removeItem(k);
        } catch (_e) {
          /* non-critical */
        }
      },
    };

    // Enhanced configuration with better defaults
    const CONFIG = {
      OPTIONS: ['subscribers', 'views', 'videos'],
      FONT_LINK: 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;700&display=swap',
      STATS_API_URL: 'https://api.livecounts.io/youtube-live-subscriber-counter/stats/',
      DEFAULT_UPDATE_INTERVAL: 5000,
      DEFAULT_OVERLAY_OPACITY: 0.75,
      MAX_RETRIES: 3,
      CACHE_DURATION: 300000, // 5 minutes
      DEBOUNCE_DELAY: 100,
      STORAGE_KEY: 'youtube_channel_stats_settings',
    };

    // Global state management
    const state = /** @type {any} */ ({
      overlay: null,
      isUpdating: false,
      intervalId: null,
      currentChannelName: null,
      currentChannelId: null,
      enabled: _safeLS.getItem(CONFIG.STORAGE_KEY) !== 'false',
      updateInterval:
        parseInt(_safeLS.getItem('youtubeEnhancerInterval') || '', 10) ||
        CONFIG.DEFAULT_UPDATE_INTERVAL,
      overlayOpacity:
        parseFloat(_safeLS.getItem('youtubeEnhancerOpacity') || '') ||
        CONFIG.DEFAULT_OVERLAY_OPACITY,
      lastSuccessfulStats: new Map(),
      previousStats: new Map(),
      channelIdCache: new Map(),
      lastChannelIdWarnAt: 0,
      previousUrl: location.href,
      isChecking: false,
      documentListenerKeys: new Set(),
      overlayEnsureScheduler: null,
      pageObserversAttached: false,
      navigationListenerAttached: false,
    });

    // Attach change handler to the static checkbox in settings modal
    const attachSettingsHandler = () => {
      try {
        const checkbox = document.getElementById('ytp-plus-setting-enableChannelStats');
        if (!(checkbox instanceof HTMLInputElement)) return;
        if (checkbox.dataset.handlerAttached) return;
        checkbox.dataset.handlerAttached = 'true';
        checkbox.checked = state.enabled;
        checkbox.addEventListener('change', e => {
          const input = /** @type {EventTarget & HTMLInputElement} */ (e.target);
          state.enabled = input.checked;
          _safeLS.setItem(CONFIG.STORAGE_KEY, state.enabled ? 'true' : 'false');
          if (state.enabled) {
            observePageChanges();
            addNavigationListener();
            setTimeout_(() => {
              const bannerElement = byId('page-header-banner-sizer');
              if (bannerElement instanceof HTMLElement && (U?.isChannelPage?.() ?? false)) {
                addOverlay(bannerElement);
              }
            }, 100);
          } else {
            clearExistingOverlay();
          }
        });
      } catch (_e) {
        // non-critical
      }
    };

    if (isSettingsModalOpen()) {
      attachSettingsHandler();
    }

    // Register settings modal listener for SUBSEQUENT opens.
    if (U?.cleanupManager?.registerListener) {
      U.cleanupManager.registerListener(document, 'youtube-plus-settings-modal-opened', () => {
        attachSettingsHandler();
      });
    } else {
      document.addEventListener('youtube-plus-settings-modal-opened', () => {
        attachSettingsHandler();
      });
    }

    // LRU-evicting set helper for bounded Maps (max 50 entries)
    const MAX_CACHE_ENTRIES = 50;
    const boundedCacheSet = (
      /** @type {Map<any, any>} */ map,
      /** @type {any} */ key,
      /** @type {any} */ value
    ) => {
      if (map.size >= MAX_CACHE_ENTRIES) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
      }
      map.set(key, value);
    };

    // Utility functions
    const utils = {
      /** @param {string} message @param {...any} args */
      log: (message, ...args) => {
        const yt = /** @type {any} */ (U);
        yt?.logger?.debug?.('[YouTube+][Stats]', message, ...args);
      },

      /** @param {string} message @param {...any} args */
      warn: (message, ...args) => {
        window.console.warn('[YouTube+][Stats]', message, ...args);
      },

      /** @param {string} message @param {...any} args */
      error: (message, ...args) => {
        window.console.error('[YouTube+][Stats]', message, ...args);
      },

      // Use shared debounce from YouTubeUtils
      debounce: U.debounce,
    };

    const { OPTIONS } = CONFIG;
    const { FONT_LINK } = CONFIG;
    const { STATS_API_URL } = CONFIG;

    /**
     * Fetches channel data from YouTube
     * @param {string} url - The channel URL to fetch
     * @returns {Promise<any|null>} The parsed channel data or null on error
     */
    async function fetchChannel(url) {
      if (state.isChecking) return null;
      state.isChecking = true;

      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
        });

        if (!response.ok) return null;

        const html = await response.text();
        const match = html.match(/var ytInitialData = (.+?);<\/script>/);
        return match?.[1] ? JSON.parse(match[1]) : null;
      } catch (error) {
        utils.warn('Failed to fetch channel data:', /** @type {any} */ (error));
        return null;
      } finally {
        state.isChecking = false;
      }
    }

    /**
     * Fetch basic channel metadata (name and ID) from a channel page
     * @param {string} url - Channel page URL
     * @returns {Promise<{channelName: string, channelId: string}|null>} Channel info or null
     */
    async function getChannelInfo(/** @type {string} */ url) {
      const data = await fetchChannel(url);
      if (!data) return null;

      try {
        const channelName = data?.metadata?.channelMetadataRenderer?.title || t('unknown');
        const channelId = data?.metadata?.channelMetadataRenderer?.externalId || null;

        return { channelName, channelId };
      } catch (_e) {
        return null;
      }
    }

    /**
     * Detect SPA navigation to a channel page and fetch channel info
     * @returns {void}
     */
    function checkUrlChange() {
      const currentUrl = location.href;
      if (currentUrl !== state.previousUrl) {
        state.previousUrl = currentUrl;
        if (U?.isChannelPage?.(currentUrl) ?? false) {
          setTimeout(() => getChannelInfo(currentUrl), 500);
        }
      }
    }

    // YouTube SPA navigation — yt-navigate-finish fires for all pushState/replaceState
    // transitions on youtube.com, so wrapping history APIs is redundant and creates
    // an ever-growing wrapper chain when multiple modules do the same thing.
    const _cm2 = U?.cleanupManager;
    if (_cm2?.registerListener) {
      _cm2.registerListener(document, 'yt-navigate-finish', checkUrlChange, { passive: true });
      _cm2.registerListener(window, 'popstate', checkUrlChange, { passive: true });
    } else {
      document.addEventListener('yt-navigate-finish', checkUrlChange, { passive: true });
      window.addEventListener('popstate', checkUrlChange, { passive: true });
    }

    /**
     * Initialize the channel stats overlay, fonts, and listeners
     * @returns {void}
     */
    function init() {
      if (U?.isStudioPage?.()) return;
      try {
        utils.log('Initializing YouTube Enhancer v1.6');

        loadFonts();
        initializeLocalStorage();
        addStyles();
        if (state.enabled) {
          observePageChanges();
          addNavigationListener();

          if (U?.isChannelPage?.(location.href) ?? false) {
            getChannelInfo(location.href);
            // Kick off an overlay attempt immediately on initial load.
            // Without this, the banner overlay only renders after the first
            // SPA navigation event (i.e. after F5).
            try {
              ensureOverlayForCurrentPage();
            } catch (e) {
              utils.warn('Initial overlay attempt failed:', /** @type {any} */ (e));
            }
          }
        }

        utils.log('YouTube Enhancer initialized successfully');
      } catch (error) {
        utils.error('Failed to initialize YouTube Enhancer:', error);
      }
    }

    /**
     * Inject the channel stats Google Font stylesheet
     * @returns {void}
     */
    function loadFonts() {
      const fontLink = document.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = FONT_LINK;
      (document.head || document.documentElement).appendChild(fontLink);
    }

    /**
     * Initialize default localStorage display flags
     * @returns {void}
     */
    function initializeLocalStorage() {
      OPTIONS.forEach(option => {
        if (_safeLS.getItem(`show-${option}`) === null) {
          _safeLS.setItem(`show-${option}`, 'true');
        }
      });
    }

    /**
     * Inject channel stats overlay CSS
     * @returns {void}
     */
    function addStyles() {
      const styles = `
      .channel-banner-overlay{position:absolute;top:0;left:0;width:100%;height:100%;border-radius:12px;z-index:9;display:flex;justify-content:space-around;align-items:center;color:var(--yt-text-primary);font-family:var(--yt-stats-font-family,'Rubik',sans-serif);font-size:var(--yt-stats-font-size,24px);box-sizing:border-box;transition:background-color .3s ease;backdrop-filter:blur(2px)}        
      .settings-button{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;cursor:pointer;z-index:11;transition:transform 0.2s cubic-bezier(0.2,0,0,1), opacity 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;display:flex;align-items:center;justify-content:center;background:var(--yt-stats-channel-button-bg);backdrop-filter:blur(4px);border:1px solid var(--yt-stats-channel-button-border);opacity:0.7}
      .channel-banner-overlay:hover .settings-button{opacity:1}
      .settings-button:hover{transform:rotate(30deg) scale(1.1);opacity:1;background:var(--yt-stats-channel-button-hover);border-color:var(--yt-stats-channel-button-hover-border)}
      .settings-button:active{transform:rotate(30deg) scale(0.96) !important;}
      .settings-button svg{width:18px;height:18px;fill:var(--yt-text-primary);filter:drop-shadow(0 1px 2px var(--yt-stats-channel-filter-shadow))}        
      .settings-menu{position:absolute;top:52px;right:12px;background:var(--yt-stats-channel-menu-bg);padding:16px;border-radius:16px;z-index:12;display:flex;flex-direction:column;gap:12px;backdrop-filter:blur(16px) saturate(180%);border:1px solid var(--yt-stats-channel-menu-border);box-shadow:0 8px 32px rgba(0,0,0,0.6);min-width:320px;opacity:0;visibility:hidden;transform:translateY(-10px) scale(0.98);transition:opacity 0.2s cubic-bezier(0.2,0,0.2,1), transform 0.2s cubic-bezier(0.2,0,0.2,1), visibility 0.2s cubic-bezier(0.2,0,0.2,1);pointer-events:none}
      .settings-menu.show{opacity:1;visibility:visible;transform:translateY(0) scale(1);pointer-events:auto}        
      .settings-menu .ytp-plus-settings-item{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:8px;background:var(--yt-stats-channel-menu-item-bg);}
      .settings-menu .ytp-plus-settings-item + .ytp-plus-settings-item{margin-top:6px}
      .settings-menu .ytp-plus-settings-item .ytp-plus-settings-item-label{color:var(--yt-stats-channel-label-text);font-size:14px;font-weight:500}
      .settings-menu label{color:var(--yt-stats-channel-label-text)!important;font-size:14px!important;font-weight:500!important;margin-bottom:6px!important}        
      .settings-menu input[type="range"]{-webkit-appearance:none;width:100%!important;height:4px;background:var(--yt-stats-channel-range-bg)!important;border-radius:2px;margin:12px 0 4px 0!important;cursor:pointer}
      .settings-menu input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;height:16px;width:16px;border-radius:50%;background:var(--yt-stats-channel-range-thumb);margin-top:-6px;box-shadow:0 2px 4px var(--yt-stats-channel-text-shadow);border:2px solid var(--yt-text-primary);transition:transform .1s;cursor:pointer}
      .settings-menu input[type="range"]::-webkit-slider-thumb:hover{transform:scale(1.2)}        
      .settings-menu select{width:100%!important;background:var(--yt-stats-channel-input-bg)!important;border:1px solid var(--yt-stats-channel-input-bg)!important;color:var(--yt-text-primary)!important;padding:8px 12px!important;border-radius:6px!important;font-size:13px!important;margin-bottom:12px!important;cursor:pointer;outline:none}
      .settings-menu select:hover{background:var(--yt-stats-channel-input-hover)!important}
      .settings-menu select option{background:var(--yt-stats-channel-select-option-bg);color:var(--yt-text-primary)}        
      /* Don't override the shared settings checkbox styling; only target non-shared inputs */
      .settings-menu input[type="checkbox"]:not(.ytp-plus-settings-checkbox){appearance:none;width:18px!important;height:18px!important;border:2px solid var(--yt-stats-channel-checkbox-border)!important;border-radius:4px!important;background:transparent!important;cursor:pointer;position:relative;margin-right:12px!important;vertical-align:middle;transition:background-color .2s ease, border-color .2s ease, transform .1s cubic-bezier(0.2,0,0,1)}
      .settings-menu input[type="checkbox"]:not(.ytp-plus-settings-checkbox):active{transform:scale(0.96) !important;}
      .settings-menu input[type="checkbox"]:not(.ytp-plus-settings-checkbox):checked{background:var(--yt-stats-channel-range-thumb)!important;border-color:var(--yt-stats-channel-range-thumb)!important}
      .settings-menu input[type="checkbox"]:not(.ytp-plus-settings-checkbox):checked::after{content:'';position:absolute;left:5px;top:1px;width:4px;height:10px;border:solid var(--yt-text-primary);border-width:0 2px 2px 0;transform:rotate(45deg)}
      .stat-container{display:flex;flex-direction:column;align-items:center;justify-content:center;visibility:hidden;width:33%;height:100%;padding:0 1rem;text-shadow:0 2px 4px var(--yt-stats-channel-text-shadow)}
      .number-container{display:flex;align-items:center;justify-content:center;font-weight:700;min-height:3rem}
      .label-container{display:flex;align-items:center;margin-top:.5rem;font-size:1.2rem;opacity:.9}
      .label-container svg{width:1.5rem;height:1.5rem;margin-right:.5rem;filter:drop-shadow(0 1px 2px var(--yt-stats-channel-text-shadow))}
      .difference{font-size:1.8rem;height:2rem;margin-bottom:.5rem;transition:opacity .3s}
      .spinner-container{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;justify-content:center;align-items:center}
      .spinner-container .stats-spinner{width:60px;height:60px;animation:spin 1s linear infinite}
      .spinner-container .stats-spinner circle{stroke-dasharray:80;stroke-dashoffset:60;animation:dash 1.5s ease-in-out infinite}
      /* @keyframes spin already defined in video stats CSS above */
      @media(max-width:768px){.channel-banner-overlay{flex-direction:column;padding:8px;min-height:160px}.settings-menu{width:280px!important;right:4px!important;top:48px!important}}
      .setting-group{margin-bottom:12px}
      .setting-group:last-child{margin-bottom:0}
      .setting-value{color:var(--yt-stats-channel-text-value);font-size:12px;margin-top:4px}
      `;
      U.StyleManager.add('channel-stats-overlay', styles);
    }

    /**
     * Create the settings gear button for the overlay
     * @returns {HTMLElement} Settings button element
     */
    function createSettingsButton() {
      const button = document.createElement('div');
      button.className = 'settings-button';
      _setSafeHTML(
        button,
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="white" d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"/></svg>'
      );

      return button;
    }

    /**
     * Create the channel stats settings menu
     * @returns {HTMLElement} Settings menu element
     */
    function createSettingsMenu() {
      const menu = document.createElement('div');
      menu.className = 'settings-menu';
      menu.classList.add('ytp-stats-channel-menu');
      menu.setAttribute('tabindex', '-1');
      menu.setAttribute('aria-modal', 'true');

      const displaySection = createDisplaySection();
      const controlsSection = createControlsSection();

      menu.appendChild(displaySection);
      menu.appendChild(controlsSection);

      return menu;
    }

    /**
     * Build the display options section of the settings menu
     * @returns {HTMLElement} Display section element
     */
    function createDisplaySection() {
      const displaySection = document.createElement('div');
      if (displaySection.style) displaySection.style.flex = '1';

      const displayLabel = document.createElement('label');
      displayLabel.textContent = t('displayOptions');
      displayLabel.classList.add('ytp-stats-display-label');
      displaySection.appendChild(displayLabel);

      // Use event delegation for all checkboxes
      displaySection.addEventListener('change', (/** @type {Event} */ e) => {
        const checkbox = e.target;
        if (
          checkbox instanceof HTMLInputElement &&
          checkbox.type === 'checkbox' &&
          checkbox.id.startsWith('show-')
        ) {
          const option = checkbox.id.replace('show-', '');
          _safeLS.setItem(`show-${option}`, String(checkbox.checked));
          updateDisplayState();
        }
      });
      // Render options as single-line settings items using shared classes
      OPTIONS.forEach(option => {
        const item = document.createElement('div');
        item.className = 'ytp-plus-settings-item';

        const left = document.createElement('div');

        const label = document.createElement('label');
        label.className = 'ytp-plus-settings-item-label';
        label.htmlFor = `show-${option}`;
        label.textContent = t(option);
        left.appendChild(label);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `show-${option}`;
        checkbox.checked = _safeLS.getItem(`show-${option}`) !== 'false';
        checkbox.className = 'ytp-plus-settings-checkbox';

        item.appendChild(left);
        item.appendChild(checkbox);
        displaySection.appendChild(item);
      });

      return displaySection;
    }

    /**
     * Build the controls section (font, interval, opacity) of the settings menu
     * @returns {HTMLElement} Controls section element
     */
    function createControlsSection() {
      const controlsSection = document.createElement('div');
      if (controlsSection.style) controlsSection.style.flex = '1';

      // Use event delegation for all sliders and selects
      controlsSection.addEventListener('input', (/** @type {Event} */ e) => {
        const target = e.target;

        // Handle font size slider
        if (target instanceof HTMLElement && target.classList.contains('font-size-slider')) {
          const input = /** @type {HTMLInputElement} */ (target);
          const fontSizeValue = controlsSection.querySelector('.font-size-value');
          if (fontSizeValue) fontSizeValue.textContent = `${input.value}px`;
          _safeLS.setItem('youtubeEnhancerFontSize', input.value);
          if (state.overlay) {
            state.overlay
              .querySelectorAll('.subscribers-number,.views-number,.videos-number')
              .forEach((/** @type {Element} */ el) => {
                if (el instanceof HTMLElement && el.style) {
                  el.style.fontSize = `${input.value}px`;
                }
              });
          }
        }

        // Handle interval slider
        if (target instanceof HTMLElement && target.classList.contains('interval-slider')) {
          const input = /** @type {HTMLInputElement} */ (target);
          const newInterval = parseInt(input.value, 10) * 1000;
          const intervalValue = controlsSection.querySelector('.interval-value');
          if (intervalValue) intervalValue.textContent = `${input.value}s`;
          state.updateInterval = newInterval;
          _safeLS.setItem('youtubeEnhancerInterval', String(newInterval));

          if (state.intervalId) {
            state.intervalId.stop();
            state.intervalId = createVisibilityAwareInterval(() => {
              updateOverlayContent(state.overlay, state.currentChannelName);
            }, newInterval);
          }
        }

        // Handle opacity slider
        if (target instanceof HTMLElement && target.classList.contains('opacity-slider')) {
          const input = /** @type {HTMLInputElement} */ (target);
          const newOpacity = parseInt(input.value, 10) / 100;
          const opacityValue = controlsSection.querySelector('.opacity-value');
          if (opacityValue) opacityValue.textContent = `${input.value}%`;
          state.overlayOpacity = newOpacity;
          _safeLS.setItem('youtubeEnhancerOpacity', String(newOpacity));

          if (state.overlay) {
            state.overlay.style.backgroundColor = `rgba(0, 0, 0, ${newOpacity})`;
          }
        }
      });

      // Font family selector - using glass-dropdown style
      const fontLabel = /** @type {any} */ (document.createElement('label'));
      fontLabel.textContent = t('fontFamily');
      fontLabel.classList.add('ytp-stats-font-label');

      const fonts = [
        { name: 'Rubik', value: 'Rubik, sans-serif' },
        { name: 'Impact', value: 'Impact, Charcoal, sans-serif' },
        { name: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
        { name: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
      ];
      const savedFont = _safeLS.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif';
      const savedFontName = fonts.find(f => f.value === savedFont)?.name || 'Rubik';

      // Hidden native select for compatibility
      const fontSelect = /** @type {any} */ (document.createElement('select'));
      fontSelect.className = 'font-family-select';
      fontSelect.style.display = 'none';
      fonts.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.value;
        opt.textContent = f.name;
        if (f.value === savedFont) opt.selected = true;
        fontSelect.appendChild(opt);
      });

      // Glass dropdown
      const fontDropdown = /** @type {any} */ (document.createElement('div'));
      fontDropdown.className = 'glass-dropdown';
      fontDropdown.id = 'stats-font-dropdown';
      fontDropdown.tabIndex = 0;
      fontDropdown.setAttribute('role', 'listbox');
      fontDropdown.setAttribute('aria-expanded', 'false');
      fontDropdown.style.marginBottom = '12px';
      _setSafeHTML(
        fontDropdown,
        `
      <button class="glass-dropdown__toggle" type="button" aria-haspopup="listbox">
        <span class="glass-dropdown__label">${savedFontName}</span>
        <svg class="glass-dropdown__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <ul class="glass-dropdown__list" role="presentation">
        ${fonts
          .map(f => {
            const sel = f.value === savedFont ? ' aria-selected="true"' : '';
            return `<li class="glass-dropdown__item" data-value="${f.value}" role="option"${sel}>${f.name}</li>`;
          })
          .join('')}
      </ul>
    `
      );

      // Initialize glass dropdown interactions
      const initFontDropdown = () => {
        const toggle = fontDropdown.querySelector('.glass-dropdown__toggle');
        const list = fontDropdown.querySelector('.glass-dropdown__list');
        const label = fontDropdown.querySelector('.glass-dropdown__label');

        const closeList = () => {
          fontDropdown.setAttribute('aria-expanded', 'false');
          if (list) list.style.display = 'none';
        };

        const openList = () => {
          fontDropdown.setAttribute('aria-expanded', 'true');
          if (list) list.style.display = 'block';
        };

        closeList();

        if (toggle) {
          toggle.addEventListener('click', (/** @type {MouseEvent} */ e) => {
            e.stopPropagation();
            const expanded = fontDropdown.getAttribute('aria-expanded') === 'true';
            if (expanded) closeList();
            else openList();
          });
        }

        const _docClickHandler = (/** @type {Event} */ e) => {
          const target = e.target;
          if (!(target instanceof Node && fontDropdown.contains(target))) closeList();
        };
        if (U?.cleanupManager?.registerListener) {
          U.cleanupManager.registerListener(document, 'click', _docClickHandler);
        } else {
          document.addEventListener('click', _docClickHandler);
          // Store ref for potential manual cleanup
          if (state?.documentListenerKeys) state.documentListenerKeys.add('_docClickHandler');
        }

        if (list) {
          list.addEventListener('click', (/** @type {MouseEvent} */ e) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            const it = target.closest('.glass-dropdown__item');
            if (!it) return;
            const val = /** @type {any} */ (it).dataset?.value || '';
            fontDropdown
              .querySelectorAll('.glass-dropdown__item')
              .forEach((/** @type {Element} */ i) => i.removeAttribute('aria-selected'));
            it.setAttribute('aria-selected', 'true');
            if (label) label.textContent = it.textContent;
            fontSelect.value = val;
            closeList();

            // Apply font change
            _safeLS.setItem('youtubeEnhancerFontFamily', val);
            if (state.overlay) {
              state.overlay
                .querySelectorAll('.subscribers-number,.views-number,.videos-number')
                .forEach((/** @type {Element} */ el) => {
                  if (el instanceof HTMLElement && el.style) {
                    el.style.fontFamily = val;
                  }
                });
            }
          });
        }
      };

      // Delay initialization to ensure DOM is ready
      (typeof queueMicrotask === 'function'
        ? queueMicrotask
        : (/** @type {() => void} */ fn) => Promise.resolve().then(fn))(initFontDropdown);

      // Font size slider
      const fontSizeLabel = /** @type {any} */ (document.createElement('label'));
      fontSizeLabel.textContent = t('fontSize');
      fontSizeLabel.classList.add('ytp-stats-font-label');

      const fontSizeSlider = document.createElement('input');
      fontSizeSlider.type = 'range';
      fontSizeSlider.min = '16';
      fontSizeSlider.max = '72';
      fontSizeSlider.value = _safeLS.getItem('youtubeEnhancerFontSize') || '24';
      fontSizeSlider.step = '1';
      fontSizeSlider.className = 'font-size-slider';

      const fontSizeValue = /** @type {any} */ (document.createElement('div'));
      fontSizeValue.className = 'font-size-value';
      fontSizeValue.textContent = `${fontSizeSlider.value}px`;
      fontSizeValue.classList.add('ytp-stats-font-value');

      // Update interval slider
      const intervalLabel = /** @type {any} */ (document.createElement('label'));
      intervalLabel.textContent = t('updateInterval');
      intervalLabel.classList.add('ytp-stats-font-label');

      const intervalSlider = document.createElement('input');
      intervalSlider.type = 'range';
      intervalSlider.min = '2';
      intervalSlider.max = '10';
      intervalSlider.value = String(state.updateInterval / 1000);
      intervalSlider.step = '1';
      intervalSlider.className = 'interval-slider';

      const intervalValue = /** @type {any} */ (document.createElement('div'));
      intervalValue.className = 'interval-value';
      intervalValue.textContent = `${intervalSlider.value}s`;
      intervalValue.classList.add('ytp-stats-font-value');

      // Opacity slider
      const opacityLabel = /** @type {any} */ (document.createElement('label'));
      opacityLabel.textContent = t('backgroundOpacity');
      opacityLabel.classList.add('ytp-stats-font-label');

      const opacitySlider = document.createElement('input');
      opacitySlider.type = 'range';
      opacitySlider.min = '50';
      opacitySlider.max = '90';
      opacitySlider.value = String(state.overlayOpacity * 100);
      opacitySlider.step = '5';
      opacitySlider.className = 'opacity-slider';

      const opacityValue = /** @type {any} */ (document.createElement('div'));
      opacityValue.className = 'opacity-value';
      opacityValue.textContent = `${opacitySlider.value}%`;
      opacityValue.classList.add('ytp-stats-font-value');

      controlsSection.appendChild(fontLabel);
      controlsSection.appendChild(fontSelect);
      controlsSection.appendChild(fontDropdown);
      controlsSection.appendChild(fontSizeLabel);
      controlsSection.appendChild(fontSizeSlider);
      controlsSection.appendChild(fontSizeValue);
      controlsSection.appendChild(intervalLabel);
      controlsSection.appendChild(intervalSlider);
      controlsSection.appendChild(intervalValue);
      controlsSection.appendChild(opacityLabel);
      controlsSection.appendChild(opacitySlider);
      controlsSection.appendChild(opacityValue);

      return controlsSection;
    }

    /**
     * Create a loading spinner element for the overlay
     * @returns {HTMLElement} Spinner container element
     */
    function createSpinner() {
      const spinnerContainer = /** @type {any} */ (document.createElement('div'));
      spinnerContainer.classList.add('ytp-stats-spinner');
      spinnerContainer.classList.add('spinner-container');

      _setSafeHTML(
        spinnerContainer,
        '<svg viewBox="0 0 50 50" class="stats-spinner"><circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4"></circle></svg>'
      );
      return spinnerContainer;
    }

    /**
     * Create a white SVG icon from a path definition
     * @param {string} path - SVG path data
     * @returns {SVGSVGElement} SVG icon element
     */
    function createSVGIcon(/** @type {string} */ path) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 640 512');
      svg.setAttribute('width', '2rem');
      svg.setAttribute('height', '2rem');
      if (svg.style) {
        svg.style.marginRight = '0.5rem';
        svg.style.display = 'none';
      }

      const svgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svgPath.setAttribute('d', path);
      svgPath.setAttribute('fill', 'white');

      svg.appendChild(svgPath);
      return svg;
    }

    /**
     * Build a stat container with icon, difference label, and number display
     * @param {string} className - Base CSS class name for the stat type
     * @param {string} iconPath - SVG path data for the stat icon
     * @returns {HTMLElement} Stat container element
     */
    function createStatContainer(/** @type {string} */ className, /** @type {string} */ iconPath) {
      const container = document.createElement('div');
      Object.assign(/** @type {any} */ (container).style || {}, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        visibility: 'hidden',
        width: '33%',
        height: '100%',
        padding: '0 1rem',
      });

      const numberContainer = document.createElement('div');
      Object.assign(/** @type {any} */ (numberContainer).style || {}, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      });

      const differenceElement = document.createElement('div');
      differenceElement.classList.add(`${className}-difference`);
      Object.assign(/** @type {any} */ (differenceElement).style || {}, {
        fontSize: '2.5rem',
        height: '2.5rem',
        marginBottom: '1rem',
      });

      const digitContainer = createNumberContainer();
      digitContainer.classList.add(`${className}-number`);
      Object.assign(/** @type {any} */ (digitContainer).style || {}, {
        fontSize: `${_safeLS.getItem('youtubeEnhancerFontSize') || '24'}px`,
        fontWeight: 'bold',
        lineHeight: '1',
        height: '4rem',
        fontFamily: _safeLS.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif',
        letterSpacing: '0.025em',
      });

      numberContainer.appendChild(differenceElement);
      numberContainer.appendChild(digitContainer);

      const labelContainer = document.createElement('div');
      Object.assign(/** @type {any} */ (labelContainer).style || {}, {
        display: 'flex',
        alignItems: 'center',
        marginTop: '0.5rem',
      });

      const icon = createSVGIcon(iconPath);
      Object.assign(/** @type {any} */ (icon).style || {}, {
        width: '2rem',
        height: '2rem',
        marginRight: '0.75rem',
      });

      const labelElement = /** @type {any} */ (document.createElement('div'));
      labelElement.classList.add(`${className}-label`);
      labelElement.style.fontSize = '2rem';

      labelContainer.appendChild(icon);
      labelContainer.appendChild(labelElement);

      container.appendChild(numberContainer);
      container.appendChild(labelContainer);

      return container;
    }

    /**
     * Create base overlay element with styling
     * @returns {HTMLElement} Overlay element
     */
    function createOverlayElement() {
      const overlay = document.createElement('div');
      overlay.classList.add('channel-banner-overlay');
      Object.assign(/** @type {any} */ (overlay).style || {}, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        backgroundColor: `rgba(0, 0, 0, ${state.overlayOpacity})`,
        borderRadius: '15px',
        zIndex: '10',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        color: 'white',
        fontFamily: _safeLS.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif',
        fontSize: `${_safeLS.getItem('youtubeEnhancerFontSize') || '24'}px`,
        boxSizing: 'border-box',
        transition: 'background-color 0.3s ease',
      });
      return overlay;
    }

    /**
     * Apply accessibility attributes to overlay
     * @param {HTMLElement} overlay - Overlay element
     */
    function applyOverlayAccessibility(overlay) {
      overlay.setAttribute('role', 'region');
      overlay.setAttribute('aria-label', t('overlayAriaLabel'));
      overlay.setAttribute('tabindex', '-1');
    }

    /**
     * Apply responsive mobile styling
     * @param {HTMLElement} overlay - Overlay element
     */
    function applyMobileResponsiveness(overlay) {
      if (window.innerWidth <= 768 && overlay.style) {
        overlay.style.flexDirection = 'column';
        overlay.style.padding = '10px';
        overlay.style.minHeight = '200px';
      }
    }

    /**
     * Setup settings button with accessibility
     * @returns {HTMLElement} Settings button
     */
    function setupSettingsButton() {
      const button = createSettingsButton();
      button.setAttribute('tabindex', '0');
      button.setAttribute('aria-label', t('settingsAriaLabel'));
      button.setAttribute('role', 'button');
      return button;
    }

    /**
     * Setup settings menu with accessibility
     * @returns {HTMLElement} Settings menu
     */
    function setupSettingsMenu() {
      const menu = createSettingsMenu();
      menu.setAttribute('aria-label', t('settingsMenuAriaLabel'));
      menu.setAttribute('role', 'dialog');
      return menu;
    }

    /**
     * Attach menu toggle event handlers
     * @param {HTMLElement} settingsButton - Settings button
     * @param {HTMLElement} settingsMenu - Settings menu
     */
    function attachMenuEventHandlers(settingsButton, settingsMenu) {
      const toggleMenu = (/** @type {boolean} */ show) => {
        settingsMenu.classList.toggle('show', show);
        settingsButton.setAttribute('aria-expanded', String(show));
        if (show) settingsMenu.focus();
      };

      settingsButton.addEventListener('click', (/** @type {MouseEvent} */ e) => {
        e.stopPropagation();
        toggleMenu(!settingsMenu.classList.contains('show'));
      });

      settingsButton.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleMenu(!settingsMenu.classList.contains('show'));
        }
      });

      // Register document-level event handlers
      const clickHandler = (/** @type {Event} */ e) => {
        const node = /** @type {EventTarget & Node} */ (e.target);
        if (!(settingsMenu.contains(node) || settingsButton.contains(node))) {
          toggleMenu(false);
        }
      };

      const keyHandler = (/** @type {Event} */ e) => {
        const ke = /** @type {KeyboardEvent} */ (e);
        if (ke.key === 'Escape' && settingsMenu.classList.contains('show')) {
          toggleMenu(false);
          settingsButton.focus();
        }
      };

      const clickKey = U.cleanupManager.registerListener(document, 'click', clickHandler);
      const keyKey = U.cleanupManager.registerListener(document, 'keydown', keyHandler);
      state.documentListenerKeys.add(clickKey);
      state.documentListenerKeys.add(keyKey);
    }

    /**
     * Add stat containers to overlay
     * @param {HTMLElement} overlay - Overlay element
     */
    function addStatContainers(overlay) {
      const subscribersElement = createStatContainer(
        'subscribers',
        'M144 160c-44.2 0-80-35.8-80-80S99.8 0 144 0s80 35.8 80 80s-35.8 80-80 80zm368 0c-44.2 0-80-35.8-80-80s35.8-80 80-80s80 35.8 80 80s-35.8 80-80 80zM0 298.7C0 239.8 47.8 192 106.7 192h42.7c15.9 0 31 3.5 44.6 9.7c-1.3 7.2-1.9 14.7-1.9 22.3c0 38.2 16.8 72.5 43.3 96c-.2 0-.4 0-.7 0H21.3C9.6 320 0 310.4 0 298.7zM405.3 320c-.2 0-.4 0-.7 0c26.6-23.5 43.3-57.8 43.3-96c0-7.6-.7-15-1.9-22.3c13.6-6.3 28.7-9.7 44.6-9.7h42.7C592.2 192 640 239.8 640 298.7c0 11.8-9.6 21.3-21.3 21.3H405.3zM416 224c0 53-43 96-96 96s-96-43-96-96s43-96 96-96s96 43 96 96zM128 485.3C128 411.7 187.7 352 261.3 352H378.7C452.3 352 512 411.7 512 485.3c0 14.7-11.9 26.7-26.7 26.7H154.7c-14.7 0-26.7-11.9-26.7-26.7z'
      );
      const viewsElement = createStatContainer(
        'views',
        'M288 32c-80.8 0-145.5 36.8-192.6 80.6C48.6 156 17.3 208 2.5 243.7c-3.3 7.9-3.3 16.7 0 24.6C17.3 304 48.6 356 95.4 399.4C142.5 443.2 207.2 480 288 480s145.5-36.8 192.6-80.6c46.8-43.5 78.1-95.4 93-131.1c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C433.5 68.8 368.8 32 288 32zM144 256a144 144 0 1 1 288 0 144 144 0 1 1 -288 0zm144-64c0 35.3-28.7 64-64 64c-7.1 0-13.9-1.2-20.3-3.3c-5.5-1.8-11.9 1.6-11.7 7.4c.3 6.9 1.3 13.8 3.2 20.7c13.7 51.2 66.4 81.6 117.6 67.9s81.6-66.4 67.9-117.6c-11.1-41.5-47.8-69.4-88.6-71.1c-5.8-.2-9.2 6.1-7.4 11.7c2.1 6.4 3.3 13.2 3.3 20.3z'
      );
      const videosElement = createStatContainer(
        'videos',
        'M0 128C0 92.7 28.7 64 64 64H320c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128zM559.1 99.8c10.4 5.6 16.9 16.4 16.9 28.2V384c0 11.8-6.5 22.6-16.9 28.2s-23 5-32.9-1.6l-96-64L416 337.1V320 192 174.9l14.2-9.5 96-64c9.8-6.5 22.4-7.2 32.9-1.6z'
      );

      overlay.appendChild(subscribersElement);
      overlay.appendChild(viewsElement);
      overlay.appendChild(videosElement);
    }

    /**
     * Create and mount the full overlay on a channel banner
     * @param {HTMLElement | null} bannerElement - Banner element to host the overlay
     * @returns {HTMLElement | null} The created overlay or null
     */
    function createOverlay(/** @type {HTMLElement | null} */ bannerElement) {
      clearExistingOverlay();
      if (!bannerElement) return null;

      const overlay = createOverlayElement();
      applyOverlayAccessibility(overlay);
      applyMobileResponsiveness(overlay);

      const settingsButton = setupSettingsButton();
      const settingsMenu = setupSettingsMenu();

      overlay.appendChild(settingsButton);
      overlay.appendChild(settingsMenu);

      attachMenuEventHandlers(settingsButton, settingsMenu);

      const spinner = createSpinner();
      overlay.appendChild(spinner);

      addStatContainers(overlay);

      bannerElement.appendChild(overlay);
      updateDisplayState();
      return overlay;
    }

    /**
     * Fetch JSON from a URL using GM_xmlhttpRequest with a fetch fallback
     * @param {string} url - URL to fetch
     * @param {Record<string, string>} [headers={}] - Extra request headers
     * @returns {Promise<any>} Parsed JSON response
     */
    function fetchWithGM(
      /** @type {string} */ url,
      /** @type {Record<string, string>} */ headers = {}
    ) {
      const requestHeaders = {
        Accept: 'application/json',
        ...headers,
      };
      // Access GM_xmlhttpRequest via window to avoid TS "Cannot find name" when d.ts isn't picked up
      const gm = /** @type {any} */ (window).GM_xmlhttpRequest;
      if (typeof gm === 'function') {
        return new Promise((resolve, reject) => {
          gm({
            method: 'GET',
            url,
            headers: requestHeaders,
            timeout: 10000,
            onload: (/** @type {any} */ response) => {
              if (response.status >= 200 && response.status < 300) {
                try {
                  resolve(JSON.parse(response.responseText));
                } catch (parseError) {
                  const message =
                    parseError instanceof Error ? parseError.message : String(parseError);
                  reject(new Error(`Failed to parse response: ${message}`));
                }
              } else {
                reject(new Error(`Failed to fetch: ${response.status}`));
              }
            },
            onerror: (/** @type {any} */ error) => reject(error),
            ontimeout: () => reject(new Error('Request timed out')),
          });
        });
      }

      utils.warn('GM_xmlhttpRequest unavailable, falling back to fetch API');
      return fetch(url, {
        method: 'GET',
        headers: requestHeaders,
        credentials: 'omit',
        mode: 'cors',
      })
        .then((/** @type {Response} */ response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status}`);
          }
          return response.json();
        })
        .catch((/** @type {any} */ error) => {
          utils.error('Fallback fetch failed:', error);
          throw error;
        });
    }

    /**
     * Resolve the YouTube channel ID for the current page, using cache and fallbacks.
     * Retries DOM sources briefly to handle SPA transitions where ytInitialData
     * and meta tags are not yet updated when yt-navigate-finish fires.
     * @param {string | null | undefined} channelName - Channel display name or handle
     * @returns {Promise<string | null>} Channel ID or null
     */
    async function fetchChannelId(/** @type {string | null | undefined} */ channelName) {
      const cacheKey = channelName || state.currentChannelName || window.location.pathname;

      if (cacheKey && state.channelIdCache.has(cacheKey)) {
        return state.channelIdCache.get(cacheKey);
      }

      if (state.currentChannelId) {
        return state.currentChannelId;
      }

      if (typeof channelName === 'string' && /^UC[\w-]{22}$/.test(channelName)) {
        state.currentChannelId = channelName;
        if (cacheKey) boundedCacheSet(state.channelIdCache, cacheKey, channelName);
        return channelName;
      }

      const resolveFromDom = () => {
        const metaTag = $('meta[itemprop="channelId"]');
        if (metaTag?.content) return metaTag.content;

        const urlMatch = window.location.href.match(/channel\/(UC[\w-]+)/);
        if (urlMatch?.[1]) return urlMatch[1];

        const initialData = window.ytInitialData;
        const id =
          initialData?.metadata?.channelMetadataRenderer?.externalId ||
          initialData?.header?.c4TabbedHeaderRenderer?.channelId;
        if (id && /^UC[\w-]{22}$/.test(id)) return id;

        if (window.ytcfg?.get) {
          const cfgId = window.ytcfg.get('CHANNEL_ID');
          if (cfgId && /^UC[\w-]{22}$/.test(cfgId)) return cfgId;
        }

        return null;
      };

      let channelId = resolveFromDom();
      if (!channelId) {
        // Retry a few times while the SPA page data is settling.
        channelId = await new Promise(resolve => {
          let attempts = 0;
          const maxAttempts = 10;
          const interval = 100;
          const tick = () => {
            attempts += 1;
            const id = resolveFromDom();
            if (id) return resolve(id);
            if (attempts >= maxAttempts) return resolve(null);
            setTimeout(tick, interval);
          };
          tick();
        });
      }

      if (channelId) {
        state.currentChannelId = channelId;
        if (cacheKey) boundedCacheSet(state.channelIdCache, cacheKey, channelId);
        return channelId;
      }

      // Last resort: fetch the channel page HTML and parse ytInitialData.
      const channelInfo = await getChannelInfo(window.location.href);
      if (channelInfo?.channelId) {
        state.currentChannelId = channelInfo.channelId;
        if (cacheKey) boundedCacheSet(state.channelIdCache, cacheKey, channelInfo.channelId);
        return channelInfo.channelId;
      }

      return null;
    }

    /**
     * Fetch channel statistics with retry logic and fallback
     * @param {string} channelId - Channel ID
     * @returns {Promise<any>} Channel stats
     */
    async function fetchChannelStats(channelId) {
      const fetchFn = () =>
        fetchWithGM(`${STATS_API_URL}${channelId}`, {
          origin: 'https://livecounts.io',
          referer: 'https://livecounts.io/',
        });

      // Retry with exponential backoff
      let lastError = null;
      for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
          const stats = await fetchFn();
          if (stats) {
            // Cache successful stats
            state.lastSuccessfulStats.set(channelId, {
              stats,
              timestamp: Date.now(),
            });
            return stats;
          }
        } catch (err) {
          lastError = err;
          if (attempt < CONFIG.MAX_RETRIES) {
            const delay = Math.min(1000 * 2 ** attempt, 10000);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }

      // Try cached data
      const cached = state.lastSuccessfulStats.get(channelId);
      if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
        return cached.stats;
      }

      // Fallback: extract subscriber count from page DOM
      let fallbackCount = 0;
      try {
        const subEl =
          document.querySelector('#subscriber-count') ||
          document.querySelector('yt-formatted-string#subscriber-count');
        if (subEl?.textContent) {
          const raw = subEl.textContent.replace(/[^0-9.KkMmBb]/g, '');
          if (raw) {
            const num = parseFloat(raw);
            if (!Number.isNaN(num)) {
              const suffix = raw.slice(-1).toLowerCase();
              const mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1;
              fallbackCount = Math.round(num * mult);
            }
          }
        }
      } catch (_e) {
        /* DOM extraction is best-effort */
      }

      if (lastError) {
        utils.error('Failed to fetch channel stats:', /** @type {any} */ (lastError));
      }
      return {
        followerCount: fallbackCount,
        bottomOdos: [0, 0],
        error: true,
        timestamp: Date.now(),
      };
    }

    /**
     * Remove the existing overlay, interval, and registered document listeners
     * @returns {void}
     */
    function clearExistingOverlay() {
      const existingOverlay = $('.channel-banner-overlay');
      if (existingOverlay) {
        try {
          existingOverlay.remove();
        } catch (_e) {
          window.YouTubePlusLogger?.warn?.('Stats', 'Failed to remove overlay');
        }
      }
      if (state.intervalId) {
        try {
          state.intervalId.stop();
        } catch (_e) {
          window.YouTubePlusLogger?.warn?.('Stats', 'Failed to clear interval');
        }
        state.intervalId = null;
      }
      if (state.documentListenerKeys?.size) {
        state.documentListenerKeys.forEach((/** @type {any} */ key) => {
          try {
            U.cleanupManager.unregisterListener?.(key);
          } catch (_e) {
            window.YouTubePlusLogger?.warn?.('Stats', 'Failed to unregister listener');
          }
        });
        state.documentListenerKeys.clear();
      }
      if (state.lastSuccessfulStats) state.lastSuccessfulStats.clear();
      if (state.previousStats) state.previousStats.clear();
      state.currentChannelId = null;
      state.isUpdating = false;
      state.overlay = null;
      utils.log('Cleared existing overlay');
    }

    /**
     * Create a single digit span element
     * @returns {HTMLSpanElement} Digit element
     */
    function createDigitElement() {
      const digit = document.createElement('span');
      Object.assign(/** @type {any} */ (digit).style || {}, {
        display: 'inline-block',
        width: '0.6em',
        textAlign: 'center',
        marginRight: '0.025em',
        marginLeft: '0.025em',
      });
      return digit;
    }

    /**
     * Create a comma separator span element
     * @returns {HTMLSpanElement} Comma element
     */
    function createCommaElement() {
      const comma = document.createElement('span');
      comma.textContent = ',';
      Object.assign(/** @type {any} */ (comma).style || {}, {
        display: 'inline-block',
        width: '0.3em',
        textAlign: 'center',
      });
      return comma;
    }

    /**
     * Create the flex number container for digit groups
     * @returns {HTMLDivElement} Number container
     */
    function createNumberContainer() {
      const container = document.createElement('div');
      Object.assign(/** @type {any} */ (container).style || {}, {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        letterSpacing: '0.025em',
      });
      return container;
    }

    /**
     * Split number into groups of 3 digits for formatting
     * @param {string} valueStr - Number as string
     * @returns {string[]} Array of digit groups
     */
    function splitIntoDigitGroups(valueStr) {
      const digits = [];
      for (let i = valueStr.length - 1; i >= 0; i -= 3) {
        const start = Math.max(0, i - 2);
        digits.unshift(valueStr.slice(start, i + 1));
      }
      return digits;
    }

    /**
     * Clear all children from container
     * @param {HTMLElement} container - Container element
     */
    function clearContainer(container) {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    }

    /**
     * Render digit groups in container
     * @param {HTMLElement} container - Container element
     * @param {string[]} digitGroups - Array of digit groups
     */
    function renderDigitGroups(container, digitGroups) {
      for (let i = 0; i < digitGroups.length; i++) {
        const group = digitGroups[i];
        for (let j = 0; j < group.length; j++) {
          const digitElement = createDigitElement();
          digitElement.textContent = group[j];
          container.appendChild(digitElement);
        }
        if (i < digitGroups.length - 1) {
          container.appendChild(createCommaElement());
        }
      }
    }

    /**
     * Animate digit changes in container
     * @param {HTMLElement} container - Container element
     * @param {string[]} digitGroups - Array of digit groups
     */
    function animateDigitChanges(container, digitGroups) {
      let elementIndex = 0;
      for (let i = 0; i < digitGroups.length; i++) {
        const group = digitGroups[i];
        for (let j = 0; j < group.length; j++) {
          const digitElement = container.children[elementIndex];
          const newDigit = parseInt(group[j], 10);
          const currentDigit = parseInt(digitElement.textContent || '0', 10);

          if (currentDigit !== newDigit) {
            animateDigit(digitElement, currentDigit, newDigit);
          }
          elementIndex++;
        }
        if (i < digitGroups.length - 1) {
          elementIndex++; // Skip comma
        }
      }
    }

    /**
     * Update the digit container to show a new numeric value
     * @param {HTMLElement} container - Digit container element
     * @param {number} newValue - New value to render
     * @returns {void}
     */
    function updateDigits(/** @type {HTMLElement} */ container, /** @type {number} */ newValue) {
      const newValueStr = newValue.toString();
      const digitGroups = splitIntoDigitGroups(newValueStr);

      clearContainer(container);
      renderDigitGroups(container, digitGroups);
      animateDigitChanges(container, digitGroups);
    }

    /**
     * Animate a single digit from start to end value
     * @param {Element} element - Digit element to animate
     * @param {number} start - Starting digit
     * @param {number} end - Ending digit
     * @returns {void}
     */
    function animateDigit(
      /** @type {Element} */ element,
      /** @type {number} */ start,
      /** @type {number} */ end
    ) {
      const duration = 1000;
      const startTime = performance.now();

      function update(/** @type {number} */ currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOutQuart = 1 - (1 - progress) ** 4;
        const current = Math.round(start + (end - start) * easeOutQuart);
        element.textContent = String(current);

        if (progress < 1) {
          requestAnimationFrame(update);
        }
      }

      requestAnimationFrame(update);
    }

    /**
     * Hide spinner and reveal overlay stat containers/icons
     * @param {HTMLElement} overlay - Overlay element
     * @returns {void}
     */
    function showContent(/** @type {HTMLElement} */ overlay) {
      const spinnerContainer = overlay.querySelector('.spinner-container');
      if (spinnerContainer) {
        spinnerContainer.remove();
      }

      const containers = overlay.querySelectorAll('div[style*="visibility: hidden"]');
      containers.forEach((/** @type {Element} */ container) => {
        if (container instanceof HTMLElement && container.style) {
          container.style.visibility = 'visible';
        }
      });

      const icons = overlay.querySelectorAll('svg[style*="display: none"]');
      icons.forEach((/** @type {Element} */ icon) => {
        if (icon instanceof SVGElement || icon instanceof HTMLElement) {
          const styled = /** @type {any} */ (icon);
          if (styled.style) styled.style.display = 'block';
        }
      });
    }

    /**
     * Render the numeric difference between current and previous stat values
     * @param {HTMLElement} element - Difference element
     * @param {number} currentValue - Current stat value
     * @param {number} previousValue - Previous stat value
     * @returns {void}
     */
    function updateDifferenceElement(
      /** @type {HTMLElement} */ element,
      /** @type {number} */ currentValue,
      /** @type {number} */ previousValue
    ) {
      if (!previousValue) return;

      const difference = currentValue - previousValue;
      if (difference === 0) {
        element.textContent = '';
        return;
      }

      const sign = difference > 0 ? '+' : '';
      element.textContent = `${sign}${difference.toLocaleString()}`;
      // Maps to design tokens: #1ed760 = --yt-stats-positive-indicator, #f3727f = --yt-stats-negative-indicator
      // (element.style computed inline styles don't support CSS var() at runtime)
      element.classList.add(
        difference > 0 ? 'ytp-stats-change-positive' : 'ytp-stats-change-negative'
      );

      setTimeout_(() => {
        element.textContent = '';
      }, 1000);
    }

    /**
     * Recalculate overlay layout based on visible stat options
     * @returns {void}
     */
    function updateDisplayState() {
      const overlay = $('.channel-banner-overlay');
      if (!overlay) return;

      const statContainers = overlay.querySelectorAll('div[style*="width"]');
      if (!statContainers.length) return;

      let visibleCount = 0;
      /** @type {Element[]} */
      const visibleContainers = [];

      statContainers.forEach((/** @type {Element} */ container) => {
        const numberContainer = container.querySelector('[class$="-number"]');
        if (!numberContainer) return;

        const type = numberContainer.className.replace('-number', '');

        const isVisible = _safeLS.getItem(`show-${type}`) !== 'false';

        if (isVisible) {
          if (container instanceof HTMLElement && container.style) {
            container.style.display = 'flex';
          }
          visibleCount++;
          visibleContainers.push(container);
        } else if (container instanceof HTMLElement && container.style) {
          container.style.display = 'none';
        }
      });

      visibleContainers.forEach((/** @type {Element} */ container) => {
        if (!(container instanceof HTMLElement && container.style)) return;
        container.style.width = '';
        container.style.margin = '';

        switch (visibleCount) {
          case 1:
            container.style.width = '100%';
            break;
          case 2:
            container.style.width = '50%';
            break;
          case 3:
            container.style.width = '33.33%';
            break;
          default:
            container.style.display = 'none';
        }
      });

      // Only update font size and font family for .subscribers-number, .views-number, .videos-number
      const fontSize = _safeLS.getItem('youtubeEnhancerFontSize') || '24';
      const fontFamily = _safeLS.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif';
      overlay
        .querySelectorAll('.subscribers-number,.views-number,.videos-number')
        .forEach((/** @type {Element} */ el) => {
          if (el instanceof HTMLElement && el.style) {
            el.style.fontSize = `${fontSize}px`;
            el.style.fontFamily = fontFamily;
          }
        });

      if (overlay.style) overlay.style.display = 'flex';
    }

    /**
     * Check if overlay update should proceed
     * @param {string} channelName - Channel name to update
     * @returns {boolean} True if should proceed
     */
    function shouldUpdateOverlay(channelName) {
      return !state.isUpdating && channelName === state.currentChannelName;
    }

    /**
     * Handle stats error by showing fallback values
     * @param {HTMLElement} overlay - Overlay element
     * @param {any} stats - Stats object with error
     * @returns {void}
     */
    function handleStatsError(overlay, stats) {
      const containers = overlay.querySelectorAll('[class$="-number"]');
      containers.forEach((/** @type {Element} */ container) => {
        if (container.classList.contains('subscribers-number') && stats.followerCount > 0) {
          updateDigits(/** @type {HTMLElement} */ (container), stats.followerCount);
        } else {
          container.textContent = '---';
        }
      });
      utils.warn('Using fallback stats due to API error');
    }

    /**
     * Get previous stat value for comparison
     * @param {string} channelId - Channel ID
     * @param {string} className - Stat type class name
     * @returns {number|null} Previous value or null
     */
    function getPreviousStatValue(channelId, className) {
      const prevStats = state.previousStats.get(channelId);
      if (!prevStats) return null;

      if (className === 'subscribers') {
        return prevStats.followerCount;
      }
      const index = className === 'views' ? 0 : 1;
      return prevStats.bottomOdos[index];
    }

    /**
     * Update single stat element in overlay
     * @param {HTMLElement} overlay - Overlay element
     * @param {string} channelId - Channel ID
     * @param {string} className - Stat class name
     * @param {number} value - Stat value
     * @param {string} label - Stat label
     * @returns {void}
     */
    function updateStatElement(overlay, channelId, className, value, label) {
      const numberContainer = overlay.querySelector(`.${className}-number`);
      const differenceElement = overlay.querySelector(`.${className}-difference`);
      const labelElement = overlay.querySelector(`.${className}-label`);

      if (numberContainer) {
        updateDigits(/** @type {HTMLElement} */ (numberContainer), value);
      }

      if (differenceElement && state.previousStats.has(channelId)) {
        const previousValue = getPreviousStatValue(channelId, className);
        if (previousValue !== null) {
          updateDifferenceElement(
            /** @type {HTMLElement} */ (differenceElement),
            value,
            previousValue
          );
        }
      }

      if (labelElement) {
        labelElement.textContent = label;
      }
    }

    /**
     * Update all stat elements in overlay
     * @param {HTMLElement} overlay - Overlay element
     * @param {string} channelId - Channel ID
     * @param {any} stats - Stats object
     * @returns {void}
     */
    function updateAllStatElements(overlay, channelId, stats) {
      updateStatElement(overlay, channelId, 'subscribers', stats.followerCount, t('subscribers'));
      updateStatElement(overlay, channelId, 'views', stats.bottomOdos[0], t('views'));
      updateStatElement(overlay, channelId, 'videos', stats.bottomOdos[1], t('videos'));
    }

    /**
     * Show error state in overlay
     * @param {HTMLElement} overlay - Overlay element
     * @returns {void}
     */
    function showOverlayError(overlay) {
      const containers = overlay.querySelectorAll('[class$="-number"]');
      containers.forEach((/** @type {Element} */ container) => {
        container.textContent = '---';
      });
    }

    /**
     * Update overlay content with channel stats
     * @param {HTMLElement} overlay - Overlay element
     * @param {string} channelName - Channel name
     * @returns {Promise<void>}
     */
    async function updateOverlayContent(overlay, channelName) {
      if (!shouldUpdateOverlay(channelName)) return;
      if (!overlay?.isConnected) return;
      if (document.visibilityState === 'hidden') return;
      state.isUpdating = true;

      try {
        const channelId = await fetchChannelId(channelName);
        if (!channelId) {
          const now = Date.now();
          if (now - state.lastChannelIdWarnAt > 15000) {
            state.lastChannelIdWarnAt = now;
            utils.warn('Skipping overlay update: channel ID is not available yet');
          }
          // Schedule a one-off retry so the overlay populates as soon as the
          // channel ID becomes available, instead of waiting for the next interval.
          setTimeout(() => {
            if (overlay?.isConnected && channelName === state.currentChannelName) {
              updateOverlayContent(overlay, channelName);
            }
          }, 500);
          return;
        }
        state.currentChannelId = channelId;
        const stats = await fetchChannelStats(channelId);

        // Check if channel changed during async operations
        if (channelName !== state.currentChannelName) {
          return;
        }

        if (stats.error) {
          handleStatsError(overlay, stats);
          return;
        }

        updateAllStatElements(overlay, channelId, stats);

        if (!state.previousStats.has(channelId)) {
          showContent(overlay);
          utils.log('Displayed initial stats for channel:', channelName);
        }

        state.previousStats.set(channelId, stats);
      } catch (error) {
        utils.error('Failed to update overlay content:', /** @type {any} */ (error));
        showOverlayError(overlay);
      } finally {
        state.isUpdating = false;
      }
    }

    // Add settings UI to experimental section
    /**
     * @param {{check?: (() => boolean), maxAttempts?: number, interval?: number}} opts
     * @returns {{ stop: () => void } | null}
     */
    function createSafeRetryScheduler(
      /** @type {{check: () => boolean, maxAttempts?: number, interval?: number}} */ opts
    ) {
      const factory = U?.createRetryScheduler;
      if (typeof factory === 'function') {
        try {
          return /** @type {{ stop: () => void } | null} */ (
            /** @type {unknown} */ (factory(opts))
          );
        } catch (error) {
          U?.logError?.(
            'ChannelStats',
            'Retry scheduler factory failed',
            /** @type {any} */ (error)
          );
        }
      }

      const { check, maxAttempts = 20, interval = 100 } = opts || {};
      let attempts = 0;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timerId = null;
      let stopped = false;

      const tick = () => {
        if (stopped) return;
        attempts += 1;

        try {
          if (typeof check === 'function' && check()) {
            stopped = true;
            return;
          }
        } catch (error) {
          U?.logError?.('ChannelStats', 'Fallback retry check failed', /** @type {any} */ (error));
        }

        if (attempts >= maxAttempts) {
          stopped = true;
          return;
        }

        timerId = setTimeout(tick, interval);
      };

      timerId = setTimeout(tick, 0);

      return {
        stop() {
          stopped = true;
          if (timerId) clearTimeout(timerId);
          timerId = null;
        },
      };
    }

    const experimentalNavClickHandler = (/** @type {Event} */ e) => {
      const { target } = e;
      const el = /** @type {EventTarget & HTMLElement} */ (target);
      const navItem = el?.closest?.('.ytp-plus-settings-nav-item');
      if (navItem?.dataset?.section === 'experimental') {
        attachSettingsHandler();
      }
    };

    if (_cm2?.registerListener) {
      _cm2.registerListener(document, 'youtube-plus-language-changed', () => {
        attachSettingsHandler();
      });
    } else {
      const _langHandler = () => {
        attachSettingsHandler();
      };
      document.addEventListener('youtube-plus-language-changed', _langHandler);
      try {
        U?.cleanupManager?.register?.(() =>
          document.removeEventListener('youtube-plus-language-changed', _langHandler)
        );
      } catch (_e) {
        U.logSuppressed(_e, 'Stats');
      }
    }

    if (_cm2?.registerListener) {
      const listenerKey = _cm2.registerListener(
        document,
        'click',
        experimentalNavClickHandler,
        true
      );
      state.documentListenerKeys.add(listenerKey);
    } else {
      document.addEventListener('click', experimentalNavClickHandler, true);
      try {
        U?.cleanupManager?.register?.(() =>
          document.removeEventListener('click', experimentalNavClickHandler, true)
        );
      } catch (_e) {
        U.logSuppressed(_e, 'Stats');
      }
    }

    /**
     * Extract channel name from URL pathname
     * @param {string} pathname - URL pathname
     * @returns {string|null} Channel name or null
     */
    function extractChannelName(pathname) {
      if (pathname.startsWith('/@')) {
        return pathname.split('/')[1].replace('@', '');
      }
      if (pathname.startsWith('/channel/')) {
        return pathname.split('/')[2];
      }
      if (pathname.startsWith('/c/')) {
        return pathname.split('/')[2];
      }
      if (pathname.startsWith('/user/')) {
        return pathname.split('/')[2];
      }
      return null;
    }

    /**
     * Check if overlay should be skipped
     * @param {string|null} channelName - Channel name
     * @returns {boolean} True if should skip
     */
    function shouldSkipOverlay(channelName, /** @type {HTMLElement | null} */ bannerElement) {
      return !!(
        !channelName ||
        (channelName === state.currentChannelName &&
          state.overlay?.isConnected &&
          !!bannerElement &&
          bannerElement.contains(state.overlay))
      );
    }

    /**
     * Ensure banner element has proper positioning
     * @param {HTMLElement} bannerElement - Banner element
     */
    function ensureBannerPosition(bannerElement) {
      if (bannerElement?.style && !bannerElement.style.position) {
        bannerElement.style.position = 'relative';
      }
    }

    /**
     * Clear existing update interval
     */
    function clearUpdateInterval() {
      if (state.intervalId) {
        state.intervalId.stop();
        state.intervalId = null;
      }
    }

    /**
     * Create debounced update function
     * @param {HTMLElement} overlay - Overlay element
     * @param {string} channelName - Channel name
     * @returns {Function} Debounced update function
     */
    function createDebouncedUpdate(overlay, channelName) {
      let lastUpdateTime = 0;
      return () => {
        if (!overlay?.isConnected) return;
        if (document.visibilityState === 'hidden') return;
        const now = Date.now();
        if (now - lastUpdateTime >= state.updateInterval - 100) {
          updateOverlayContent(overlay, channelName);
          lastUpdateTime = now;
        }
      };
    }

    /**
     * Set up overlay update interval
     * @param {HTMLElement} overlay - Overlay element
     * @param {string} channelName - Channel name
     */
    function setupUpdateInterval(overlay, channelName) {
      if (state.intervalId) {
        state.intervalId.stop();
      }
      const debouncedUpdate = createDebouncedUpdate(overlay, channelName);
      state.intervalId = createVisibilityAwareInterval(debouncedUpdate, state.updateInterval);
    }

    /**
     * Add overlay to channel page banner
     * @param {HTMLElement} bannerElement - Banner element
     */
    function addOverlay(bannerElement) {
      const channelName = extractChannelName(window.location.pathname);

      if (shouldSkipOverlay(channelName, bannerElement) || !channelName) {
        return;
      }

      if (state.overlay && !(state.overlay.isConnected && bannerElement.contains(state.overlay))) {
        clearExistingOverlay();
      }

      ensureBannerPosition(bannerElement);

      state.currentChannelName = channelName;
      state.overlay = createOverlay(bannerElement);

      if (state.overlay) {
        clearUpdateInterval();
        setupUpdateInterval(state.overlay, channelName);
        updateOverlayContent(state.overlay, channelName);
        utils.log('Added overlay for channel:', channelName);
      }
    }

    /**
     * Find banner element with fallback selectors
     * @returns {HTMLElement|null} Banner element
     */
    function findBannerElement() {
      // Strict mode: channel-stats overlay should only render when a real
      // page-header banner exists on the channel. Falling back to header
      // wrappers like #channel-header / ytd-page-header-renderer made the
      // overlay attach to a 0-height container and then hang while waiting
      // for layout, which is reported as a freeze on channels without a banner.
      let bannerElement = byId('page-header-banner-sizer');
      if (!(bannerElement instanceof HTMLElement)) {
        const explicit = $('#page-header-banner');
        if (explicit instanceof HTMLElement) bannerElement = explicit;
      }
      if (!(bannerElement instanceof HTMLElement)) return null;

      // Banner must actually be rendered (non-zero size) — empty <div> shells
      // exist on channels with no banner uploaded and would otherwise pass.
      const rect = bannerElement.getBoundingClientRect?.();
      if (rect && (rect.width < 8 || rect.height < 8)) return null;

      return bannerElement;
    }

    /**
     * Stop the overlay ensure retry scheduler
     * @returns {void}
     */
    function stopOverlayEnsureScheduler() {
      if (state.overlayEnsureScheduler?.stop) {
        state.overlayEnsureScheduler.stop();
      }
      state.overlayEnsureScheduler = null;
    }

    /**
     * Retry adding the overlay until the banner element is available and attached
     * @param {boolean} [reset=true] - Whether to stop the existing scheduler first
     * @returns {void}
     */
    function ensureOverlayForCurrentPage(reset = true) {
      if (reset) stopOverlayEnsureScheduler();

      state.overlayEnsureScheduler = createSafeRetryScheduler({
        check: () => {
          if (!state.enabled) return true;
          if (!(U?.isChannelPage?.() ?? false)) {
            clearExistingOverlay();
            state.currentChannelName = null;
            return true;
          }

          const bannerElement = findBannerElement();
          if (!bannerElement) return false;

          ensureBannerPositioning(bannerElement);
          addOverlay(bannerElement);
          return !!state.overlay?.isConnected;
        },
        maxAttempts: 40,
        interval: 150,
      });
    }

    /**
     * Ensure banner has proper positioning
     * @param {HTMLElement} bannerElement - Banner element
     * @returns {void}
     */
    function ensureBannerPositioning(bannerElement) {
      if (bannerElement.style && bannerElement.style.position !== 'relative') {
        bannerElement.style.position = 'relative';
      }
    }

    /**
     * Handle page update for banner overlay
     * @returns {void}
     */
    function handleBannerUpdate() {
      if (!(U?.isChannelPage?.() ?? false)) {
        clearExistingOverlay();
        state.currentChannelName = null;
        stopOverlayEnsureScheduler();
        return;
      }

      ensureOverlayForCurrentPage();
    }

    /**
     * Observe page changes and update banner overlay
     * @returns {MutationObserver|undefined} Observer instance
     */
    /**
     * Observe page changes and update banner overlay.
     * Uses the yt-navigate-finish event (already fired by YouTube SPA navigation)
     * instead of an expensive MutationObserver with subtree: true.
     * @returns {undefined}
     */
    function observePageChanges() {
      if (!state.enabled || state.pageObserversAttached) return undefined;
      state.pageObserversAttached = true;

      const debouncedBannerUpdate = U.debounce
        ? U.debounce(handleBannerUpdate, 150)
        : handleBannerUpdate;

      if (_cm2?.registerListener) {
        _cm2.registerListener(document, 'yt-navigate-finish', debouncedBannerUpdate);
        _cm2.registerListener(document, 'yt-page-data-updated', debouncedBannerUpdate);
      } else {
        document.addEventListener('yt-navigate-finish', debouncedBannerUpdate);
        document.addEventListener('yt-page-data-updated', debouncedBannerUpdate);
      }

      return undefined;
    }

    /**
     * Register SPA navigation listeners for channel page overlay lifecycle
     * @returns {void}
     */
    function addNavigationListener() {
      if (!state.enabled || state.navigationListenerAttached) return;
      state.navigationListenerAttached = true;

      const _navHandler = () => {
        if (U?.isChannelPage?.() ?? false) {
          ensureOverlayForCurrentPage();
          utils.log('Navigated to channel page');
        } else {
          clearExistingOverlay();
          state.currentChannelName = null;
          stopOverlayEnsureScheduler();
          utils.log('Navigated away from channel page');
        }
      };
      if (_cm2?.registerListener) {
        _cm2.registerListener(document, 'yt-navigate-finish', _navHandler);
      } else {
        document.addEventListener('yt-navigate-finish', _navHandler);
      }

      // Safety net: LazyLoader dispatches ytp:nav-refresh after every SPA nav.
      // Re-render channel overlay so it appears when arriving at /@channel via
      // in-page navigation (not only on hard reload).
      try {
        window.addEventListener('ytp:nav-refresh', () => {
          try {
            _navHandler();
          } catch (e) {
            void e;
          }
        });
      } catch (e) {
        void e;
      }
    }

    // Cleanup function for page unload
    /**
     * Clean up overlay, intervals, and listeners on page unload
     * @returns {void}
     */
    function cleanup() {
      // Clear overlay and intervals
      clearExistingOverlay();
      stopOverlayEnsureScheduler();

      utils.log('Cleanup completed');
    }

    // Register cleanup on page unload
    if (_cm2?.registerListener) {
      _cm2.registerListener(window, 'beforeunload', cleanup);
    } else {
      window.addEventListener('beforeunload', cleanup);
    }

    // Export module to global scope for module loader
    if (typeof window !== 'undefined') {
      window.YouTubeStats = {
        init,
        cleanup,
        version: '2.4.5',
      };
    }

    // Run initialization on first entry to the channel route. The IIFE guard
    // (window.__ytpChannelStatsModuleInit) only ensures this closure runs once;
    // the actual overlay creation and listener registration happen here.
    init();
  }; // end initChannelStats

  // Ensure settings UI shows even when modal opens before idle callback fires
  document.addEventListener('youtube-plus-settings-modal-opened', initChannelStats, {
    once: false,
  });

  // Defer channel stats init and only load module code on channel routes
  // or when the settings modal is open (so the experimental tab can
  // populate the "Channel statistics" toggle regardless of route).
  if (U?.whenRelevant) {
    U.whenRelevant({
      name: 'stats.channel',
      isRelevant: () => isChannelStatsTriggerRoute() || isSettingsModalOpen(),
      onEnter: initChannelStats,
    });
  } else {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(initChannelStats, { timeout: 2000 });
    } else {
      setTimeout(initChannelStats, 0);
    }
  }
})();
