// Stats button and menu
(function () {
  'use strict';

  // Do not run this module inside YouTube Studio (studio.youtube.com)
  const isStudioPage = () => {
    try {
      const host = location.hostname || '';
      const href = location.href || '';
      return (
        host.includes('studio.youtube.com') ||
        host.includes('studio.') ||
        href.includes('studio.youtube.com')
      );
    } catch {
      return false;
    }
  };

  if (isStudioPage()) return;

  // Use centralized i18n where available to avoid duplicate translation objects
  const _globalI18n =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;
  const t = (key, params = {}) => {
    try {
      if (_globalI18n && typeof _globalI18n.t === 'function') {
        return _globalI18n.t(key, params);
      }
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.t === 'function'
      ) {
        return window.YouTubeUtils.t(key, params);
      }
    } catch {
      // fall through
    }
    if (!key || typeof key !== 'string') return '';
    if (Object.keys(params).length === 0) return key;
    let result = key;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
  };

  // Glassmorphism styles for stats button and menu (shorts-keyboard-feedback look)
  const styles = `
            .videoStats{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-left:8px;background:rgba(255,255,255,0.12);box-shadow:0 12px 30px rgba(0,0,0,0.32);backdrop-filter:blur(10px) saturate(160%);-webkit-backdrop-filter:blur(10px) saturate(160%);border:1.25px solid rgba(255,255,255,0.12);transition:transform .18s ease,background .18s}
            html[dark] .videoStats{background:rgba(24,24,24,0.68);border:1.25px solid rgba(255,255,255,0.08)}html:not([dark]) .videoStats{background:rgba(255,255,255,0.12);border:1.25px solid rgba(0,0,0,0.06)}.videoStats:hover{transform:translateY(-2px)}.videoStats svg{width:18px;height:18px;fill:var(--yt-spec-text-primary,#030303)}html[dark] .videoStats svg{fill:#fff}html:not([dark]) .videoStats svg{fill:#222}
            .shortsStats{display:flex;align-items:center;justify-content:center;margin-top:16px;margin-bottom:16px;width:48px;height:48px;border-radius:50%;cursor:pointer;background:rgba(255,255,255,0.12);box-shadow:0 12px 30px rgba(0,0,0,0.32);backdrop-filter:blur(10px) saturate(160%);-webkit-backdrop-filter:blur(10px) saturate(160%);border:1.25px solid rgba(255,255,255,0.12);transition:transform .22s ease}html[dark] .shortsStats{background:rgba(24,24,24,0.68);border:1.25px solid rgba(255,255,255,0.08)}html:not([dark]) .shortsStats{background:rgba(255,255,255,0.12);border:1.25px solid rgba(0,0,0,0.06)}
            .shortsStats:hover{transform:translateY(-3px)}.shortsStats svg{width:24px;height:24px;fill:#222}html[dark] .shortsStats svg{fill:#fff}html:not([dark]) .shortsStats svg{fill:#222}
            .stats-menu-container{position:relative;display:inline-block}.stats-horizontal-menu{position:absolute;display:flex;left:100%;top:0;height:100%;visibility:hidden;opacity:0;transition:visibility 0s,opacity 0.2s linear;z-index:100}.stats-menu-container:hover .stats-horizontal-menu{visibility:visible;opacity:1}.stats-menu-button{margin-left:8px;white-space:nowrap}
            /* Modal overlay and container with glassmorphism */
            .stats-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.55));z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeInModal .18s;backdrop-filter:blur(20px) saturate(170%);-webkit-backdrop-filter:blur(20px) saturate(170%)}
            .stats-modal-container{max-width:1100px;max-height:calc(100vh - 32px);display:flex;flex-direction:column}
            .stats-modal-content{background:rgba(24,24,24,0.92);border-radius:20px;box-shadow:0 18px 40px rgba(0,0,0,0.45);overflow:hidden;display:flex;flex-direction:column;animation:scaleInModal .18s;border:1.5px solid rgba(255,255,255,0.08);backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%)}
            html[dark] .stats-modal-content{background:rgba(24, 24, 24, 0.25)}
            html:not([dark]) .stats-modal-content{background:rgba(255,255,255,0.95);color:#222;border:1.25px solid rgba(0,0,0,0.06)}
            .stats-modal-close{background:transparent;border:none;color:#fff;font-size:36px;line-height:1;width:36px;height:36px;cursor:pointer;transition:transform .15s ease,color .15s;display:flex;align-items:center;justify-content:center;border-radius:8px;padding:0}
            .stats-modal-close:hover{color:#ff6b6b;transform:scale(1.1)}
            html:not([dark]) .stats-modal-close{color:#666}
            html:not([dark]) .stats-modal-close:hover{color:#ff6b6b}            
            /* Modal body */
            .stats-modal-body{padding:16px;overflow:visible;flex:1;display:flex;flex-direction:column}
            /* Thumbnail preview */
            /* Thumbnail/title layout: title centered above a row with image left and stats grid right */
            .stats-thumb-title-centered{font-size:16px;font-weight:600;color:#fff;margin:0 0 12px 0;text-align:center}
            html:not([dark]) .stats-thumb-title-centered{color:#111}
            .stats-thumb-row{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
            .stats-thumb-img{width:36vw;max-width:420px;height:auto;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid rgba(255,255,255,0.06);max-height:44vh}
            html:not([dark]) .stats-thumb-img{border:1px solid rgba(0,0,0,0.06)}
            /* ensure the grid takes remaining horizontal space */
            .stats-thumb-row .stats-grid{flex:1;min-width:0}
            .stats-thumb-left{display:flex;flex-direction:column;align-items:center;gap:8px}
            .stats-thumb-left .stats-thumb-sub{font-size:13px;color:rgba(255,255,255,0.65)}
            html:not([dark]) .stats-thumb-left .stats-thumb-sub{color:rgba(0,0,0,0.6)}
            /* extras row under thumbnail: inline, single line */
            .stats-thumb-extras{display:flex;flex-direction:row;gap:10px;align-items:center;margin-top:8px}
            .stats-thumb-extras .stats-card{padding:8px 10px}
            .stats-thumb-meta{display:flex;flex-direction:column;justify-content:center}
            .stats-thumb-sub{font-size:13px;color:rgba(255,255,255,0.65)}
            html:not([dark]) .stats-thumb-sub{color:rgba(0,0,0,0.6)}            
            /* Loading state */
            .stats-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:#fff}
            html:not([dark]) .stats-loader{color:#666}
            .stats-spinner{width:60px;height:60px;animation:spin 1s linear infinite;margin-bottom:16px}
            .stats-spinner circle{stroke-dasharray:80;stroke-dashoffset:60;animation:dash 1.5s ease-in-out infinite}            
            /* Error state */
            .stats-error{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:#ff6b6b;text-align:center}
            .stats-error-icon{width:60px;height:60px;margin-bottom:16px;stroke:#ff6b6b}            
            /* Stats grid */
            .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}            
            /* Stats card */
            .stats-card{background:rgba(255,255,255,0.05);border-radius:12px;padding:12px;display:flex;align-items:center;gap:12px;border:1px solid rgba(255,255,255,0.08);transition:transform .18s ease,box-shadow .18s ease}
            html:not([dark]) .stats-card{background:rgba(0,0,0,0.03);border:1px solid rgba(0,0,0,0.1)}
            .stats-card:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,0,0,0.3)}            
            /* Stats icon */
            .stats-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
            .stats-icon svg{width:24px;height:24px}
            .stats-icon-views{background:rgba(59,130,246,0.15);color:#3b82f6}
            .stats-icon-likes{background:rgba(34,197,94,0.15);color:#22c55e}
            .stats-icon-dislikes{background:rgba(239,68,68,0.15);color:#ef4444}
            .stats-icon-comments{background:rgba(168,85,247,0.15);color:#a855f7}
            .stats-icon-viewers{background:rgba(234,179,8,0.15);color:#eab308}
            .stats-icon-subscribers{background:rgba(236,72,153,0.15);color:#ec4899}
            .stats-icon-videos{background:rgba(14,165,233,0.15);color:#0ea5e9}
            /* Pair likes/dislikes into a single grid cell */
            .stats-card-pair{display:flex;gap:8px;align-items:stretch}
            .stats-card-pair .stats-card{flex:1;margin:0}
            @media(max-width:480px){.stats-card-pair{flex-direction:column}}            
            /* Stats info */
            .stats-info{flex:1;min-width:0}
            .stats-label{font-size:13px;color:rgba(255,255,255,0.72);margin-bottom:4px;font-weight:500}
            html:not([dark]) .stats-label{color:rgba(0,0,0,0.6)}
            .stats-value{font-size:20px;font-weight:700;color:#fff;line-height:1.2;margin-bottom:2px}
            html:not([dark]) .stats-value{color:#111}
            .stats-exact{font-size:13px;color:rgba(255,255,255,0.5);font-weight:400}
            html:not([dark]) .stats-exact{color:rgba(0,0,0,0.5)}            
            /* Animations */
            @keyframes fadeInModal{from{opacity:0}to{opacity:1}}
            @keyframes scaleInModal{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}
            @keyframes spin{to{transform:rotate(360deg)}}
            @keyframes dash{0%{stroke-dashoffset:80}50%{stroke-dashoffset:10}100%{stroke-dashoffset:80}}            
            /* Responsive */
            @media(max-width:768px){.stats-modal-container{width:95vw}.stats-grid{grid-template-columns:1fr}.stats-card{padding:16px}}
        `;

  // Settings state
  const SETTINGS_KEY = 'youtube_stats_button_enabled';
  let statsButtonEnabled = localStorage.getItem(SETTINGS_KEY) !== 'false';

  let previousUrl = location.href;
  let isChecking = false;
  let experimentalNavListenerKey = null;
  let channelFeatures = {
    hasStreams: false,
    hasShorts: false,
  };

  /**
   * Rate limiter for API calls
   * @type {Object}
   */
  const rateLimiter = {
    requests: new Map(),
    maxRequests: 10,
    timeWindow: 60000, // 1 minute

    /**
     * Check if request is allowed
     * @param {string} key - Request identifier
     * @returns {boolean} Whether request is allowed
     */
    canRequest: key => {
      const now = Date.now();
      const requests = rateLimiter.requests.get(key) || [];

      // Remove old requests outside time window
      const recentRequests = requests.filter(time => now - time < rateLimiter.timeWindow);

      if (recentRequests.length >= rateLimiter.maxRequests) {
        console.warn(
          `[YouTube+][Stats] Rate limit exceeded for ${key}. Max ${rateLimiter.maxRequests} requests per minute.`
        );
        return false;
      }

      recentRequests.push(now);
      rateLimiter.requests.set(key, recentRequests);
      return true;
    },

    /**
     * Clear rate limiter state
     */
    clear: () => {
      rateLimiter.requests.clear();
    },
  };

  function addStyles() {
    if (!document.querySelector('#youtube-enhancer-styles')) {
      // ✅ Use StyleManager instead of createElement('style')
      YouTubeUtils.StyleManager.add('youtube-enhancer-styles', styles);
    }
  }

  /**
   * Get current video URL with validation
   * @returns {string|null} Valid YouTube video URL or null
   */
  /**
   * Validate if a string is a valid YouTube video ID
   * @param {string} id - Video ID to validate
   * @returns {boolean} True if valid
   */
  function isValidVideoId(id) {
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id);
  }

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
      YouTubeUtils?.logError?.('Stats', 'Failed to get video URL', error);
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
      YouTubeUtils?.logError?.('Stats', 'Failed to get channel identifier', error);
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
        console.warn('[YouTube+][Stats] Invalid domain for channel check');
        return false;
      }
      return true;
    } catch (error) {
      YouTubeUtils?.logError?.('Stats', 'Invalid URL for channel check', error);
      return false;
    }
  }

  /**
   * Fetch channel page HTML with timeout
   * @param {string} url - URL to fetch
   * @returns {Promise<string|null>} HTML content or null on error
   */
  async function fetchChannelHtml(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

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
        console.warn(`[YouTube+][Stats] HTTP ${response.status} when checking channel tabs`);
        return null;
      }

      const html = await response.text();

      // Limit response size to prevent memory issues
      if (html.length > 5000000) {
        // 5MB limit
        console.warn('[YouTube+][Stats] Response too large, skipping parse');
        return null;
      }

      return html;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.warn('[YouTube+][Stats] Channel check timed out');
      }
      throw error;
    }
  }

  /**
   * Extract YouTube initial data from HTML
   * @param {string} html - HTML content
   * @returns {Object|null} Parsed YouTube data or null
   */
  function extractYouTubeData(html) {
    const match = html.match(/var ytInitialData = (.+?);<\/script>/);

    if (!match || !match[1]) {
      return null;
    }

    try {
      return JSON.parse(match[1]);
    } catch (parseError) {
      YouTubeUtils?.logError?.('Stats', 'Failed to parse ytInitialData', parseError);
      return null;
    }
  }

  /**
   * Analyze channel tabs for streams and shorts
   * @param {Object} data - YouTube initial data
   * @returns {{hasStreams: boolean, hasShorts: boolean}} Channel features
   */
  /**
   * Extract tab URL from tab renderer
   * @param {Object} tab - Tab object
   * @returns {string|null} Tab URL or null
   */
  function getTabUrl(tab) {
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
   * @param {Object} data - Channel data
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
   * @param {Object} flags - Flags object with hasStreams and hasShorts
   */
  function updateContentTypeFlags(tabUrl, flags) {
    if (!flags.hasStreams && isStreamsTab(tabUrl)) {
      flags.hasStreams = true;
    }
    if (!flags.hasShorts && isShortsTab(tabUrl)) {
      flags.hasShorts = true;
    }
  }

  /**
   * Analyze channel tabs to determine available content types
   * @param {Object} data - Channel data
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
    const existingMenu = document.querySelector('.stats-menu-container');
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
      if (!html) {
        isChecking = false;
        return;
      }

      const data = extractYouTubeData(html);
      if (!data) {
        isChecking = false;
        return;
      }

      channelFeatures = analyzeChannelTabs(data);
      refreshStatsMenu();
    } catch (error) {
      YouTubeUtils?.logError?.('Stats', 'Failed to check channel tabs', error);
    } finally {
      isChecking = false;
    }
  }

  /**
   * Check if URL is a channel page
   * @param {string} url - URL to check
   * @returns {boolean} Whether URL is a channel page
   */
  function isChannelPage(url) {
    try {
      return (
        url &&
        typeof url === 'string' &&
        url.includes('youtube.com/') &&
        (url.includes('/channel/') || url.includes('/@')) &&
        !url.includes('/video/') &&
        !url.includes('/watch')
      );
    } catch {
      return false;
    }
  }

  /**
   * Check for URL changes with debouncing
   */
  const checkUrlChange =
    YouTubeUtils?.debounce?.(() => {
      try {
        const currentUrl = location.href;
        if (currentUrl !== previousUrl) {
          previousUrl = currentUrl;
          if (isChannelPage(currentUrl)) {
            setTimeout(() => checkChannelTabs(currentUrl), 500);
          }
        }
      } catch (error) {
        YouTubeUtils?.logError?.('Stats', 'URL change check failed', error);
      }
    }, 300) ||
    function () {
      try {
        const currentUrl = location.href;
        if (currentUrl !== previousUrl) {
          previousUrl = currentUrl;
          if (isChannelPage(currentUrl)) {
            setTimeout(() => checkChannelTabs(currentUrl), 500);
          }
        }
      } catch (error) {
        console.error('[YouTube+][Stats] URL change check failed:', error);
      }
    };

  function createStatsIcon() {
    const icon = document.createElement('div');
    // single universal icon for all pages
    icon.className = 'videoStats';

    const SVG_NS = window.YouTubePlusConstants?.SVG_NS || 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute(
      'd',
      'M500 89c13.8-11 16-31.2 5-45s-31.2-16-45-5L319.4 151.5 211.2 70.4c-11.7-8.8-27.8-8.5-39.2 .6L12 199c-13.8 11-16 31.2-5 45s31.2 16 45 5L192.6 136.5l108.2 81.1c11.7 8.8 27.8 8.5 39.2-.6L500 89zM160 256l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32zM32 352l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32zm288-64c-17.7 0-32 14.3-32 32l0 128c0 17.7 14.3 32 32 32s32-14.3 32-32l0-128c0-17.7-14.3-32-32-32zm96-32l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32z'
    );

    svg.appendChild(path);
    icon.appendChild(svg);

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

  function insertUniversalIcon() {
    if (!statsButtonEnabled) return;

    // Try to insert into masthead area (requested: "style-scope ytd-masthead").
    // Prefer element matching 'ytd-masthead.style-scope' if present, otherwise fallback to 'ytd-masthead'.
    let masthead = document.querySelector('ytd-masthead.style-scope');
    if (!masthead) masthead = document.querySelector('ytd-masthead');

    if (!masthead || document.querySelector('.videoStats')) return;

    const statsIcon = createStatsIcon();

    // Preferred target: element with id="end" and class containing 'style-scope' inside masthead
    let endElem = masthead.querySelector('#end.style-scope.ytd-masthead');
    if (!endElem) endElem = masthead.querySelector('#end');

    if (endElem) {
      // Insert as first child of #end so it appears at the beginning
      endElem.insertBefore(statsIcon, endElem.firstChild);
    } else {
      // Fallback: append to masthead
      masthead.appendChild(statsIcon);
    }
  }

  function createButton(text, svgPath, viewBox, className, onClick) {
    const buttonViewModel = document.createElement('button-view-model');
    buttonViewModel.className = `yt-spec-button-view-model ${className}-view-model`;

    const button = document.createElement('button');
    button.className = `yt-spec-button-shape-next yt-spec-button-shape-next--outline yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--enable-backdrop-filter-experiment ${className}-button`;
    button.setAttribute('aria-disabled', 'false');
    button.setAttribute('aria-label', text);
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.gap = '8px';

    button.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.style.width = '20px';
    svg.style.height = '20px';
    svg.style.fill = 'currentColor';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', svgPath);
    svg.appendChild(path);

    const buttonText = document.createElement('div');
    buttonText.className = `yt-spec-button-shape-next__button-text-content ${className}-text`;
    buttonText.textContent = text;
    buttonText.style.display = 'flex';
    buttonText.style.alignItems = 'center';

    const touchFeedback = document.createElement('yt-touch-feedback-shape');
    touchFeedback.style.borderRadius = 'inherit';

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
   * InnerTube API configuration
   */
  const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const INNERTUBE_CLIENT_VERSION = '2.20201209.01.00';

  /**
   * Fetch video stats from InnerTube API (more complete data)
   * @param {string} videoId - Video ID
   * @returns {Promise<Object|null>} Video stats with views, likes, country, monetization
   */
  /**
   * Create InnerTube API request body
   * @param {string} videoId - Video ID
   * @returns {Object} Request body
   */
  function createInnerTubeRequestBody(videoId) {
    return {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: INNERTUBE_CLIENT_VERSION,
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
   * @returns {Object} Fetch options
   */
  function createInnerTubeFetchOptions(videoId) {
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': INNERTUBE_CLIENT_VERSION,
      },
      body: JSON.stringify(createInnerTubeRequestBody(videoId)),
    };
  }

  /**
   * Extract best thumbnail URL from details
   * @param {Object} details - Video details
   * @returns {string|null} Thumbnail URL
   */
  function extractThumbnailUrl(details) {
    const thumbnails = details.thumbnail?.thumbnails;
    return thumbnails?.[thumbnails.length - 1]?.url || null;
  }

  /**
   * Parse video stats from InnerTube response
   * @param {Object} data - InnerTube response data
   * @returns {Object} Parsed video stats
   */
  function parseVideoStatsFromResponse(data) {
    const details = data.videoDetails || {};
    const microformat = data.microformat?.playerMicroformatRenderer || {};

    return {
      videoId: details.videoId,
      title: details.title,
      views: details.viewCount ? parseInt(details.viewCount, 10) : null,
      likes: null, // Will be fetched separately
      thumbnail: extractThumbnailUrl(details),
      duration: details.lengthSeconds,
      country: microformat.availableCountries?.[0] || null,
      monetized: microformat.isFamilySafe !== undefined,
      channelId: details.channelId,
    };
  }

  /**
   * Fetch video stats from InnerTube API
   * @param {string} videoId - Video ID
   * @returns {Promise<Object|null>} Video stats or null
   */
  async function fetchVideoStatsInnerTube(videoId) {
    if (!videoId) return null;

    try {
      const url = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`;
      const response = await fetch(url, createInnerTubeFetchOptions(videoId));

      if (!response.ok) {
        console.warn(`[YouTube+][Stats] InnerTube API failed:`, response.status);
        return null;
      }

      const data = await response.json();
      return parseVideoStatsFromResponse(data);
    } catch (error) {
      console.error('[YouTube+][Stats] InnerTube fetch error:', error);
      return null;
    }
  }

  /**
   * Fetch dislikes from Return YouTube Dislike API
   * @param {string} videoId - Video ID
   * @returns {Promise<Object|null>} Likes and dislikes data
   */
  async function fetchDislikesData(videoId) {
    if (!videoId) return null;

    try {
      const response = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`);
      if (!response.ok) return null;

      const data = await response.json();
      return {
        likes: data.likes || null,
        dislikes: data.dislikes || null,
        rating: data.rating || null,
      };
    } catch (error) {
      console.error('[YouTube+][Stats] Failed to fetch dislikes:', error);
      return null;
    }
  }

  /**
   * Fetch video or channel stats from API (combines InnerTube + RYD)
   * @param {string} type - 'video' or 'channel'
   * @param {string} id - Video ID or Channel ID
   * @returns {Promise<Object|null>} Stats data or null on error
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
        const dislikeData = await fetchDislikesData(id);
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
        console.warn(`[YouTube+][Stats] Failed to fetch ${type} stats:`, response.status);
        return { ok: false, status: response.status, data: null, url: endpoint };
      }

      const data = await response.json();
      return { ok: true, status: response.status, data, url: endpoint };
    } catch (error) {
      YouTubeUtils?.logError?.('Stats', `Failed to fetch ${type} stats`, error);
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
   * @returns {Object|null} Stats object or null
   */
  function getPageVideoStats() {
    try {
      // Use centralized helpers from YouTubeStatsHelpers when available.
      // If not present (some runtime environments), provide a lightweight
      // DOM-based fallback to avoid noisy errors and still surface basic stats.
      const helpers = window.YouTubeStatsHelpers || {};

      const fallbackHelpers = {
        extractViews() {
          try {
            const el = document.querySelector('yt-view-count-renderer, #count .view-count');
            const text = el && el.textContent ? el.textContent.trim() : '';
            const match = text.replace(/[^0-9,\.]/g, '').replace(/,/g, '');
            return match ? { views: Number(match) || null } : {};
          } catch {
            return {};
          }
        },
        extractLikes() {
          try {
            const btn =
              document.querySelector(
                'ytd-toggle-button-renderer[is-icon-button] yt-formatted-string'
              ) ||
              document.querySelector(
                '#top-level-buttons-computed ytd-toggle-button-renderer:first-child yt-formatted-string'
              );
            const text = btn && btn.textContent ? btn.textContent.trim() : '';
            const match = text.replace(/[^0-9,\.]/g, '').replace(/,/g, '');
            return match ? { likes: Number(match) || null } : {};
          } catch {
            return {};
          }
        },
        extractDislikes() {
          // Dislike counts may not be available; return empty
          return {};
        },
        extractComments() {
          try {
            const el = document.querySelector(
              '#count > ytd-comment-thread-renderer, ytd-comments-header-renderer #count'
            );
            const text = el && el.textContent ? el.textContent.trim() : '';
            const match = text.replace(/[^0-9,\.]/g, '').replace(/,/g, '');
            return match ? { comments: Number(match) || null } : {};
          } catch {
            return {};
          }
        },
        extractSubscribers() {
          try {
            const el = document.querySelector('#owner-sub-count, #subscriber-count');
            const text = el && el.textContent ? el.textContent.trim() : '';
            return text ? { subscribers: text } : {};
          } catch {
            return {};
          }
        },
        extractThumbnail() {
          try {
            const meta =
              document.querySelector('link[rel="image_src"]') ||
              document.querySelector('meta[property="og:image"]');
            const url = meta && (meta.href || meta.content) ? meta.href || meta.content : null;
            return url ? { thumbnail: url } : {};
          } catch {
            return {};
          }
        },
        extractTitle() {
          try {
            const el =
              document.querySelector('h1.title yt-formatted-string') ||
              document.querySelector('h1');
            const text = el && el.textContent ? el.textContent.trim() : '';
            return text ? { title: text } : {};
          } catch {
            return {};
          }
        },
      };

      const use = helpers && helpers.extractViews ? helpers : fallbackHelpers;

      // Merge all extracted stats (helpers may return partial objects)
      const result = Object.assign(
        {},
        use.extractViews?.() || {},
        use.extractLikes?.() || {},
        use.extractDislikes?.() || {},
        use.extractComments?.() || {},
        use.extractSubscribers?.() || {},
        use.extractThumbnail?.() || {},
        use.extractTitle?.() || {}
      );

      return Object.keys(result).length > 0 ? result : null;
    } catch (e) {
      YouTubeUtils?.logError?.('Stats', 'Failed to read page stats', e);
      return null;
    }
  }

  /**
   * Render a small grid from page-derived stats into container
   * @param {HTMLElement} container
   * @param {Object} pageStats
   */
  // Helper to create a stats card HTML when value exists
  function buildPageStatCard(value, labelKey, iconClass, iconSvg) {
    if (value === undefined || value === null) return '';
    return `
        <div class="stats-card">
          <div class="stats-icon ${iconClass}">
            ${iconSvg}
          </div>
          <div class="stats-info">
            <div class="stats-label">${t(labelKey)}</div>
            <div class="stats-value">${formatNumber(value)}</div>
            <div class="stats-exact">${(value || 0).toLocaleString()}</div>
          </div>
        </div>
      `;
  }

  // Helper to create a stats-card that shows only a value (no label)
  // iconOrClass can be either an HTML string (SVG) or a class name like 'stats-icon-views'
  function buildValueOnlyCard(
    value,
    iconOrClass = '',
    options = { showValue: true, showIcon: true }
  ) {
    const { showValue, showIcon } = options;
    if (!showValue && !showIcon) return '';

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
   * @param {Object} pageStats - Page statistics
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

  /**
   * Get thumbnail URL from various sources
   * @param {string} id - Video ID
   * @param {Object} pageStats - Page statistics
   * @returns {string} Thumbnail URL or empty string
   * @private
   */
  function getThumbnailUrl(id, pageStats) {
    if (pageStats && pageStats.thumbnail) {
      return pageStats.thumbnail;
    }
    if (id) {
      return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
    return '';
  }

  /**
   * Build extra metadata cards
   * @param {Object} extras - Extra metadata
   * @returns {string} HTML for extra cards
   * @private
   */
  function buildExtraCards(extras) {
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
   * @param {Object} extras - Extra metadata
   * @returns {string} Complete HTML
   * @private
   */
  function buildThumbnailLayout(titleHtml, thumbUrl, gridHtml, extras) {
    const extraCards = buildExtraCards(extras);
    const leftHtml = `<div class="stats-thumb-left"><img class="stats-thumb-img" src="${thumbUrl}" alt="thumbnail"><div class="stats-thumb-extras">${extraCards}</div></div>`;
    return `${titleHtml}<div class="stats-thumb-row">${leftHtml}${gridHtml}</div>`;
  }

  /**
   * Render page statistics fallback view
   * @param {HTMLElement} container - Container element
   * @param {Object} pageStats - Page statistics
   * @param {string} id - Video ID
   */
  function renderPageFallback(container, pageStats, id) {
    // Build stat cards
    const cards = buildStatCards(pageStats);
    const gridHtml = `<div class="stats-grid">${cards.join('')}</div>`;

    // Get title
    const title = (pageStats && pageStats.title) || document.title || '';
    const titleHtml = title ? `<div class="stats-thumb-title-centered">${title}</div>` : '';

    // Get thumbnail and extras
    const thumbUrl = getThumbnailUrl(id, pageStats);
    const extras = getVideoExtras(null, pageStats, id);

    // Render appropriate layout
    if (thumbUrl) {
      container.innerHTML = buildThumbnailLayout(titleHtml, thumbUrl, gridHtml, extras);
    } else {
      container.innerHTML = `${titleHtml}${gridHtml}`;
    }
  }

  /**
   * Format number with K/M/B suffixes
   * @param {number} num - Number to format
   * @returns {string} Formatted number
   */
  function formatNumber(num) {
    if (!num || isNaN(num)) return '0';
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
      exactText = !isNaN(numExact) ? Math.floor(numExact).toLocaleString() : String(exact);
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
   * @param {Object} stats
   * @returns {{views: number|null, likes: number|null, dislikes: number|null, comments: number|null, liveViewer: number|null, title: string, thumbUrl: string, country: string|null, monetized: boolean|null}}
   */
  /**
   * Extract video fields from stats object
   * Simplified by using more consistent field access
   * @param {Object} stats - Stats object
   * @param {string} id - Video ID
   * @returns {Object} Extracted fields
   */
  /**
   * Get first available field from stats object
   * @param {Object} stats - Stats object
   * @param {string[]} fields - Field names to check
   * @returns {*} First available value or null
   */
  function getFirstAvailableField(stats, ...fields) {
    for (const field of fields) {
      if (stats?.[field] != null) return stats[field];
    }
    return null;
  }

  /**
   * Get thumbnail URL for video
   * @param {Object} stats - Stats object
   * @param {string} id - Video ID
   * @returns {string} Thumbnail URL
   */
  function getThumbnailUrl(stats, id) {
    return stats?.thumbnail || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
  }

  /**
   * Extract video fields from stats object
   * @param {Object} stats - Stats data
   * @param {string} id - Video ID
   * @returns {Object} Extracted fields
   */
  function extractVideoFields(stats, id) {
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
    };
  }

  /**
   * Merge API-provided video stats with page-derived stats
   * Simplified to use helper function for field extraction
   * @param {Object|null} apiStats - API stats
   * @param {Object|null} pageStats - Page stats
   * @returns {Object} Merged stats
   */
  function mergeVideoStats(apiStats, pageStats) {
    if (!pageStats) return apiStats || {};

    const getValue = (...fields) => {
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
    };
  }

  /**
   * Extract extra metadata (duration, monetization, country) from API or page
   * @param {Object|null} apiStats - API stats
   * @param {Object|null} pageStats - Page stats
   * @returns {{duration: string|null, monetization: string|null, country: string|null}} Metadata
   */
  function getVideoExtras(apiStats, pageStats) {
    const helpers = window.YouTubeStatsHelpers || {};
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
    closeBtn.className = 'thumbnail-modal-close thumbnail-modal-action-btn';
    closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
            </svg>
            `;
    closeBtn.title = t('close');
    closeBtn.setAttribute('aria-label', t('close'));
    closeBtn.addEventListener('click', e => {
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
    loader.innerHTML = `
      <svg class="stats-spinner" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4"></circle>
      </svg>
      <p>${t('loadingStats')}</p>
    `;
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

    const content = document.createElement('div');
    content.className = 'stats-modal-content';

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
    // Close when clicking outside
    overlay.addEventListener('click', ({ target }) => {
      if (target === overlay) overlay.remove();
    });

    // ESC to close
    function escHandler(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        window.removeEventListener('keydown', escHandler, true);
      }
    }
    window.addEventListener('keydown', escHandler, true);
  }

  /**
   * Render error message in modal
   * @param {HTMLElement} body - Body element
   * @param {Object} result - Fetch result
   * @returns {void}
   */
  function renderErrorMessage(body, result) {
    const statusText = result?.status ? ` (${result.status})` : '';
    const endpointHint = result?.url
      ? `<div style="margin-top:8px;font-size:12px;opacity:0.8;word-break:break-all">${result.url}</div>`
      : '';
    body.innerHTML = `
        <div class="stats-error">
          <svg class="stats-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>${t('failedToLoadStats')}${statusText}</p>
          ${endpointHint}
        </div>
      `;
  }

  /**
   * Handle failed stats fetch
   * @param {HTMLElement} body - Body element
   * @param {Object} result - Fetch result
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
   * @param {Object} stats - Stats data
   * @param {string} id - Video/channel ID
   * @returns {void}
   */
  function displayStatsBasedOnType(body, type, stats, id) {
    if (type === 'video') {
      try {
        const pageStats = getPageVideoStats();
        const merged = mergeVideoStats(stats, pageStats);
        displayVideoStats(body, merged, id);
      } catch {
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
    if (!type || !id) {
      console.error('[YouTube+][Stats] Invalid parameters for modal');
      return;
    }

    // Remove existing overlays (cache NodeList to avoid repeated lookups)
    const existingOverlays = document.querySelectorAll('.stats-modal-overlay');
    for (let i = 0; i < existingOverlays.length; i++) {
      try {
        existingOverlays[i].remove();
      } catch {
        /* ignore individual failures */
      }
    }

    // Create modal structure
    const overlay = document.createElement('div');
    overlay.className = 'stats-modal-overlay';

    const { body, container } = createStatsModalStructure(overlay);
    overlay.appendChild(container);

    setupModalEventHandlers(overlay);
    document.body.appendChild(overlay);

    // Fetch and display stats
    const result = await fetchStats(type, id);

    if (!result?.ok) {
      handleFailedFetch(body, result, id);
      return;
    }

    displayStatsBasedOnType(body, type, result.data, id);
  }

  /**
   * Display video statistics
   * @param {HTMLElement} container - Container element
   * @param {Object} stats - Stats data
   */
  /**
   * Get stat card definitions for video stats
   * @param {Object} fields - Extracted video fields
   * @returns {Array} Card definitions
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
   * @param {Object} extras - Video extras
   * @param {Object} stats - Stats object
   * @returns {string} HTML string
   */
  function createMonetizationCard(extras, stats) {
    const monetizationValue = extras.monetization || t('unknown');
    const isMonetized = extras.monetization === t('yes') || stats?.monetized === true;
    const monIcon = isMonetized
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
    return `<div class="stats-card" style="padding:10px;"><div class="stats-icon stats-icon-subscribers">${monIcon}</div><div class="stats-info"><div class="stats-label" style="font-size:12px;">${t('monetization')}</div><div class="stats-value" style="font-size:16px;">${monetizationValue}</div></div></div>`;
  }

  /**
   * Create country meta card with flag
   * @param {Object} extras - Video extras
   * @returns {string} HTML string
   */
  function createCountryCard(extras) {
    const countryValue = extras.country || t('unknown');
    const countryCode =
      extras.country && extras.country !== t('unknown') ? extras.country.toUpperCase() : '';
    const globeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;

    if (countryCode) {
      const flagUrl = `https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.3.2/flags/4x3/${countryCode.toLowerCase()}.svg`;
      return `<div class="stats-card" style="padding:10px;"><div class="stats-icon stats-icon-views"><img src="${flagUrl}" alt="${countryCode}" width="32" height="24" style="border-radius:4px;" onerror="this.style.display='none';this.parentElement.innerHTML='${globeIcon}'"/></div><div class="stats-info"><div class="stats-label" style="font-size:12px;">${t('country')}</div><div class="stats-value" style="font-size:16px;">${countryCode}</div></div></div>`;
    }
    return `<div class="stats-card" style="padding:10px;"><div class="stats-icon stats-icon-views">${globeIcon}</div><div class="stats-info"><div class="stats-label" style="font-size:12px;">${t('country')}</div><div class="stats-value" style="font-size:16px;">${countryValue}</div></div></div>`;
  }

  /**
   * Create duration meta card
   * @param {Object} extras - Video extras
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

    function pad(n) {
      return String(n).padStart(2, '0');
    }

    function secToHms(sec) {
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
      const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(s);
      if (iso) {
        const h = parseInt(iso[1] || '0', 10);
        const m = parseInt(iso[2] || '0', 10);
        const sec = parseInt(iso[3] || '0', 10);
        const total = h * 3600 + m * 60 + sec;
        return secToHms(total);
      }

      // Already colon formatted like M:SS or H:MM:SS
      if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) {
        const parts = s.split(':').map(p => p.replace(/^0+(\d)/, '$1'));
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

      // fallback: return as-is (useful when API already provides formatted text)
      return s || null;
    }

    return null;
  }
  function createDurationCard(extras) {
    const raw = extras?.duration ?? null;
    const formatted = formatDuration(raw);
    const durationValue = formatted || (raw ? String(raw) : null) || t('unknown');
    const durationIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
    return `<div class="stats-card" style="padding:10px;"><div class="stats-icon stats-icon-videos">${durationIcon}</div><div class="stats-info"><div class="stats-label" style="font-size:12px;">${t('duration')}</div><div class="stats-value" style="font-size:16px;">${durationValue}</div></div></div>`;
  }

  /**
   * Build metadata cards HTML
   * @param {Object} stats - Stats object
   * @param {Object} extras - Video extras
   * @returns {string} HTML string
   */
  function buildMetaCardsHtml(stats, extras) {
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
   * @param {Object} stats - Stats data
   * @param {string} id - Video ID
   */
  function displayVideoStats(container, stats, id) {
    const fields = extractVideoFields(stats, id);
    const { liveViewer, title, thumbUrl } = fields;

    const titleHtml = title ? `<div class="stats-thumb-title-centered">${title}</div>` : '';
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

    const parts = [viewsHtml, pairHtml, commentsHtml].filter(Boolean);

    const liveViewerCard = createLiveViewerCard(liveViewer);
    if (liveViewerCard) parts.push(liveViewerCard);

    const gridHtml = `<div class="stats-grid">${parts.join('')}</div>`;

    if (thumbUrl) {
      const extras = getVideoExtras(stats, null);
      const metaCardsHtml = buildMetaCardsHtml(stats, extras);
      const metaExtrasHtml = metaCardsHtml
        ? `<div class="stats-thumb-extras" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">${metaCardsHtml}</div>`
        : '';
      const leftHtml = `<div class="stats-thumb-left"><img class="stats-thumb-img" src="${thumbUrl}" alt="thumbnail">${metaExtrasHtml}</div>`;
      container.innerHTML = `${titleHtml}<div class="stats-thumb-row">${leftHtml}${gridHtml}</div>`;
    } else {
      container.innerHTML = `${titleHtml}${gridHtml}`;
    }
  }

  /**
   * Display channel statistics
   * @param {HTMLElement} container - Container element
   * @param {Object} stats - Stats data
   */
  function displayChannelStats(container, stats) {
    const { liveSubscriber, liveViews, liveVideos } = stats;

    container.innerHTML = `
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
    `;
  }

  function createStatsMenu() {
    if (!statsButtonEnabled) return undefined;
    if (document.querySelector('.stats-menu-container')) {
      return undefined;
    }

    const containerDiv = document.createElement('div');
    containerDiv.className = 'yt-flexible-actions-view-model-wiz__action stats-menu-container';

    const mainButtonViewModel = document.createElement('button-view-model');
    mainButtonViewModel.className = 'yt-spec-button-view-model main-stats-view-model';

    const mainButton = document.createElement('button');
    mainButton.className =
      'yt-spec-button-shape-next yt-spec-button-shape-next--outline yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--enable-backdrop-filter-experiment main-stats-button';
    mainButton.setAttribute('aria-disabled', 'false');
    mainButton.setAttribute('aria-label', t('stats'));
    mainButton.style.display = 'flex';
    mainButton.style.alignItems = 'center';
    mainButton.style.justifyContent = 'center';
    mainButton.style.gap = '8px';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.style.width = '20px';
    svg.style.height = '20px';
    svg.style.fill = 'currentColor';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M500 89c13.8-11 16-31.2 5-45s-31.2-16-45-5L319.4 151.5 211.2 70.4c-11.7-8.8-27.8-8.5-39.2 .6L12 199c-13.8 11-16 31.2-5 45s31.2 16 45 5L192.6 136.5l108.2 81.1c11.7 8.8 27.8 8.5 39.2-.6L500 89zM160 256l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32zM32 352l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32zm288-64c-17.7 0-32 14.3-32 32l0 128c0 17.7 14.3 32 32 32s32-14.3 32-32l0-128c0-17.7-14.3-32-32-32zm96-32l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32z'
    );
    svg.appendChild(path);

    const buttonText = document.createElement('div');
    buttonText.className = 'yt-spec-button-shape-next__button-text-content main-stats-text';
    buttonText.textContent = t('stats');
    buttonText.style.display = 'flex';
    buttonText.style.alignItems = 'center';

    const touchFeedback = document.createElement('yt-touch-feedback-shape');
    touchFeedback.style.borderRadius = 'inherit';

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

    mainButton.appendChild(svg);
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

    const joinButton = document.querySelector(
      '.yt-flexible-actions-view-model-wiz__action:not(.stats-menu-container)'
    );
    if (joinButton) {
      joinButton.parentNode.appendChild(containerDiv);
    } else {
      const buttonContainer = document.querySelector('#subscribe-button + #buttons');
      if (buttonContainer) {
        buttonContainer.appendChild(containerDiv);
      }
    }

    return containerDiv;
  }

  function checkAndAddMenu() {
    if (!statsButtonEnabled) return;
    const joinButton = document.querySelector(
      '.yt-flexible-actions-view-model-wiz__action:not(.stats-menu-container)'
    );
    const statsMenu = document.querySelector('.stats-menu-container');

    if (joinButton && !statsMenu) {
      createStatsMenu();
    }
  }

  function checkAndInsertIcon() {
    if (!statsButtonEnabled) return;
    // Always ensure universal icon is present in the masthead
    insertUniversalIcon();
  }

  function addSettingsUI() {
    const section = document.querySelector(
      '.ytp-plus-settings-section[data-section="experimental"]'
    );
    if (!section || section.querySelector('.stats-button-settings-item')) return;

    const item = document.createElement('div');
    item.className = 'ytp-plus-settings-item stats-button-settings-item';
    item.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">${t('statisticsButton')}</label>
          <div class="ytp-plus-settings-item-description">${t('statisticsButtonDescription')}</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" ${statsButtonEnabled ? 'checked' : ''}>
      `;
    section.appendChild(item);

    item.querySelector('input').addEventListener('change', e => {
      const { target } = e;
      const input = /** @type {EventTarget & HTMLInputElement} */ (target);
      statsButtonEnabled = input.checked;
      localStorage.setItem(SETTINGS_KEY, statsButtonEnabled ? 'true' : 'false');
      // Remove all stats buttons and menus
      document.querySelectorAll('.videoStats,.stats-menu-container').forEach(el => el.remove());
      if (statsButtonEnabled) {
        checkAndInsertIcon();
        checkAndAddMenu();
      }
    });
  }

  // Observe settings modal for experimental section
  const settingsObserver = new MutationObserver(mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addSettingsUI, 50);
        }
      }
    }
    if (document.querySelector('.ytp-plus-settings-nav-item[data-section="experimental"].active')) {
      setTimeout(addSettingsUI, 50);
    }
  });

  // ✅ Register observer in cleanupManager
  YouTubeUtils.cleanupManager.registerObserver(settingsObserver);

  // ✅ Safe observe with document.body check
  if (document.body) {
    settingsObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      settingsObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  const handleExperimentalNavClick = e => {
    const { target } = e;
    const el = /** @type {EventTarget & HTMLElement} */ (target);
    if (
      el.classList?.contains('ytp-plus-settings-nav-item') &&
      el.dataset?.section === 'experimental'
    ) {
      setTimeout(addSettingsUI, 50);
    }
  };

  if (!experimentalNavListenerKey) {
    experimentalNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'click',
      handleExperimentalNavClick,
      true
    );
  }

  function init() {
    addStyles();
    if (statsButtonEnabled) {
      checkAndInsertIcon();
      checkAndAddMenu();
    }

    history.pushState = (function (f) {
      /** @this {any} */
      return function (...args) {
        const fAny = /** @type {any} */ (f);
        const result = fAny.call(this, ...args);
        checkUrlChange();
        return result;
      };
    })(history.pushState);

    history.replaceState = (function (f) {
      /** @this {any} */
      return function (...args) {
        const fAny = /** @type {any} */ (f);
        const result = fAny.call(this, ...args);
        checkUrlChange();
        return result;
      };
    })(history.replaceState);

    window.addEventListener('popstate', checkUrlChange);

    if (isChannelPage(location.href)) {
      checkChannelTabs(location.href);
    }
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        if (statsButtonEnabled) {
          checkAndInsertIcon();
          checkAndAddMenu();
        }
      }
    }
  });

  // ✅ Safe observe with document.body check
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('yt-navigate-finish', () => {
    if (statsButtonEnabled) {
      checkAndInsertIcon();
      checkAndAddMenu();
      if (isChannelPage(location.href)) {
        checkChannelTabs(location.href);
      }
    }
  });

  document.addEventListener('yt-action', event => {
    const ev = /** @type {CustomEvent<any>} */ (event);
    if (ev.detail && ev.detail.actionName === 'yt-reload-continuation-items-command') {
      if (statsButtonEnabled) {
        checkAndInsertIcon();
        checkAndAddMenu();
      }
    }
  });
})();

// count
(function () {
  'use strict';

  // Do not run this module inside YouTube Studio (studio.youtube.com)
  const isStudioPageCount = () => {
    try {
      const host = location.hostname || '';
      const href = location.href || '';
      return (
        host.includes('studio.youtube.com') ||
        host.includes('studio.') ||
        href.includes('studio.youtube.com')
      );
    } catch {
      return false;
    }
  };

  if (isStudioPageCount()) return;

  // Use centralized i18n to avoid duplication
  const _globalI18n_stats =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;
  const t = (key, params = {}) => {
    try {
      if (_globalI18n_stats && typeof _globalI18n_stats.t === 'function') {
        return _globalI18n_stats.t(key, params);
      }
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.t === 'function'
      ) {
        return window.YouTubeUtils.t(key, params);
      }
    } catch {
      // fallback
    }
    if (!key || typeof key !== 'string') return '';
    if (Object.keys(params).length === 0) return key;
    let result = key;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
  };

  // Enhanced configuration with better defaults
  const CONFIG = {
    OPTIONS: ['subscribers', 'views', 'videos'],
    FONT_LINK: 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;700&display=swap',
    STATS_API_URL: 'https://api.livecounts.io/youtube-live-subscriber-counter/stats/',
    DEFAULT_UPDATE_INTERVAL: 2000,
    DEFAULT_OVERLAY_OPACITY: 0.75,
    MAX_RETRIES: 3,
    CACHE_DURATION: 300000, // 5 minutes
    DEBOUNCE_DELAY: 100,
    STORAGE_KEY: 'youtube_channel_stats_settings',
  };

  // Global state management
  const state = {
    overlay: null,
    isUpdating: false,
    intervalId: null,
    currentChannelName: null,
    enabled: localStorage.getItem(CONFIG.STORAGE_KEY) !== 'false',
    updateInterval:
      parseInt(localStorage.getItem('youtubeEnhancerInterval'), 10) ||
      CONFIG.DEFAULT_UPDATE_INTERVAL,
    overlayOpacity:
      parseFloat(localStorage.getItem('youtubeEnhancerOpacity')) || CONFIG.DEFAULT_OVERLAY_OPACITY,
    lastSuccessfulStats: new Map(),
    previousStats: new Map(),
    previousUrl: location.href,
    isChecking: false,
    documentListenerKeys: new Set(),
  };

  // Utility functions
  const utils = {
    log: (message, ...args) => {
      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.debug &&
        YouTubeUtils.logger.debug('[YouTube+][Stats]', message, ...args);
    },

    warn: (message, ...args) => {
      console.warn('[YouTube+][Stats]', message, ...args);
    },

    error: (message, ...args) => {
      console.error('[YouTube+][Stats]', message, ...args);
    },

    // Use shared debounce from YouTubeUtils
    debounce:
      window.YouTubeUtils?.debounce ||
      ((func, wait) => {
        let timeout;
        return function executedFunction(...args) {
          const later = () => {
            clearTimeout(timeout);
            func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
        };
      }),
  };

  const { OPTIONS } = CONFIG;
  const { FONT_LINK } = CONFIG;
  const { STATS_API_URL } = CONFIG;

  /**
   * Fetches channel data from YouTube
   * @param {string} url - The channel URL to fetch
   * @returns {Promise<Object|null>} The parsed channel data or null on error
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
      return match && match[1] ? JSON.parse(match[1]) : null;
    } catch (error) {
      utils.warn('Failed to fetch channel data:', error);
      return null;
    } finally {
      state.isChecking = false;
    }
  }

  async function getChannelInfo(url) {
    const data = await fetchChannel(url);
    if (!data) return null;

    try {
      const channelName = data?.metadata?.channelMetadataRenderer?.title || t('unknown');
      const channelId = data?.metadata?.channelMetadataRenderer?.externalId || null;

      return { channelName, channelId };
    } catch {
      return null;
    }
  }

  function isChannelPageUrl(url) {
    return (
      url.includes('youtube.com/') &&
      (url.includes('/channel/') || url.includes('/@')) &&
      !url.includes('/video/') &&
      !url.includes('/watch')
    );
  }

  function checkUrlChange() {
    const currentUrl = location.href;
    if (currentUrl !== state.previousUrl) {
      state.previousUrl = currentUrl;
      if (isChannelPageUrl(currentUrl)) {
        setTimeout(() => getChannelInfo(currentUrl), 500);
      }
    }
  }

  history.pushState = (function (f) {
    /** @this {any} */
    return function (...args) {
      f.call(this, ...args);
      checkUrlChange();
    };
  })(history.pushState);

  history.replaceState = (function (f) {
    /** @this {any} */
    return function (...args) {
      f.call(this, ...args);
      checkUrlChange();
    };
  })(history.replaceState);

  window.addEventListener('popstate', checkUrlChange);
  setInterval(checkUrlChange, 1000);

  function init() {
    try {
      utils.log('Initializing YouTube Enhancer v1.6');

      loadFonts();
      initializeLocalStorage();
      addStyles();
      if (state.enabled) {
        observePageChanges();
        addNavigationListener();

        if (isChannelPageUrl(location.href)) {
          getChannelInfo(location.href);
        }
      }

      utils.log('YouTube Enhancer initialized successfully');
    } catch (error) {
      utils.error('Failed to initialize YouTube Enhancer:', error);
    }
  }

  function loadFonts() {
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = FONT_LINK;
    (document.head || document.documentElement).appendChild(fontLink);
  }

  function initializeLocalStorage() {
    OPTIONS.forEach(option => {
      if (localStorage.getItem(`show-${option}`) === null) {
        localStorage.setItem(`show-${option}`, 'true');
      }
    });
  }

  function addStyles() {
    // ✅ Use StyleManager instead of createElement('style')
    const styles = `
        .channel-banner-overlay{position:absolute;top:0;left:0;width:100%;height:100%;border-radius:12px;z-index:10;display:flex;justify-content:space-around;align-items:center;color:#fff;font-family:var(--stats-font-family,'Rubik',sans-serif);font-size:var(--stats-font-size,24px);box-sizing:border-box;transition:background-color .3s ease;backdrop-filter:blur(2px)}
        .settings-button{position:absolute;top:8px;right:8px;width:24px;height:24px;cursor:pointer;z-index:2;transition:transform .2s;opacity:.7}
        .settings-button:hover{transform:scale(1.1);opacity:1}
        .settings-menu{position:absolute;top:35px;right:8px;background:rgba(0,0,0,.95);padding:12px;border-radius:8px;z-index:10;display:none;backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.1);min-width:320px}
        .settings-menu.show{display:block}
        .stat-container{display:flex;flex-direction:column;align-items:center;justify-content:center;visibility:hidden;width:33%;height:100%;padding:0 1rem}
        .number-container{display:flex;align-items:center;justify-content:center;font-weight:700;min-height:3rem}
        .label-container{display:flex;align-items:center;margin-top:.5rem;font-size:1.2rem;opacity:.9}
        .label-container svg{width:1.5rem;height:1.5rem;margin-right:.5rem}
        .difference{font-size:1.8rem;height:2rem;margin-bottom:.5rem;transition:opacity .3s}
        .spinner-container{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;justify-content:center;align-items:center}
        .loading-spinner{animation:spin 1s linear infinite}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @media(max-width:768px){.channel-banner-overlay{flex-direction:column;padding:8px;min-height:160px}.settings-menu{width:280px;right:4px}}
        .setting-group{margin-bottom:12px}
        .setting-group:last-child{margin-bottom:0}
        .setting-group label{display:block;margin-bottom:4px;font-weight:600;color:#fff;font-size:14px}
        .setting-group input[type="range"]{width:100%;margin:4px 0}
        .setting-group input[type="checkbox"]{margin-right:8px}
        .setting-value{color:#aaa;font-size:12px;margin-top:2px}
        `;
    YouTubeUtils.StyleManager.add('channel-stats-overlay', styles);
  }

  function createSettingsButton() {
    const button = document.createElement('div');
    button.className = 'settings-button';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 0 512 512');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'white');
    path.setAttribute(
      'd',
      'M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z'
    );

    svg.appendChild(path);
    button.appendChild(svg);

    return button;
  }

  function createSettingsMenu() {
    const menu = document.createElement('div');
    menu.className = 'settings-menu';
    menu.style.gap = '15px';
    menu.style.width = '360px';
    menu.setAttribute('tabindex', '-1');
    menu.setAttribute('aria-modal', 'true');

    const displaySection = createDisplaySection();
    const controlsSection = createControlsSection();

    menu.appendChild(displaySection);
    menu.appendChild(controlsSection);

    return menu;
  }

  function createDisplaySection() {
    const displaySection = document.createElement('div');
    displaySection.style.flex = '1';

    const displayLabel = document.createElement('label');
    displayLabel.textContent = t('displayOptions');
    displayLabel.style.marginBottom = '10px';
    displayLabel.style.display = 'block';
    displayLabel.style.fontSize = '16px';
    displayLabel.style.fontWeight = 'bold';
    displaySection.appendChild(displayLabel);

    OPTIONS.forEach(option => {
      const checkboxContainer = document.createElement('div');
      checkboxContainer.style.display = 'flex';
      checkboxContainer.style.alignItems = 'center';
      checkboxContainer.style.marginTop = '5px';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `show-${option}`;
      checkbox.checked = localStorage.getItem(`show-${option}`) !== 'false';
      // ✅ Применяем стиль как в настройках
      checkbox.className = 'ytp-plus-settings-checkbox';

      const checkboxLabel = document.createElement('label');
      checkboxLabel.htmlFor = `show-${option}`;
      checkboxLabel.textContent = t(option);
      checkboxLabel.style.cursor = 'pointer';
      checkboxLabel.style.color = 'white';
      checkboxLabel.style.fontSize = '14px';
      checkboxLabel.style.marginLeft = '8px';

      checkbox.addEventListener('change', () => {
        localStorage.setItem(`show-${option}`, String(checkbox.checked));
        updateDisplayState();
      });

      checkboxContainer.appendChild(checkbox);
      checkboxContainer.appendChild(checkboxLabel);
      displaySection.appendChild(checkboxContainer);
    });

    return displaySection;
  }

  function createControlsSection() {
    const controlsSection = document.createElement('div');
    controlsSection.style.flex = '1';

    // Font family selector
    const fontLabel = document.createElement('label');
    fontLabel.textContent = t('fontFamily');
    fontLabel.style.display = 'block';
    fontLabel.style.marginBottom = '5px';
    fontLabel.style.fontSize = '16px';
    fontLabel.style.fontWeight = 'bold';

    const fontSelect = document.createElement('select');
    fontSelect.className = 'font-family-select';
    fontSelect.style.width = '100%';
    fontSelect.style.marginBottom = '10px';
    const fonts = [
      { name: 'Rubik', value: 'Rubik, sans-serif' },
      { name: 'Impact', value: 'Impact, Charcoal, sans-serif' },
      { name: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
      { name: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
    ];
    const savedFont = localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif';
    fonts.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.value;
      opt.textContent = f.name;
      if (f.value === savedFont) opt.selected = true;
      fontSelect.appendChild(opt);
    });

    fontSelect.addEventListener('change', e => {
      const { target } = e;
      const select = /** @type {EventTarget & HTMLSelectElement} */ (target);
      localStorage.setItem('youtubeEnhancerFontFamily', select.value);
      if (state.overlay) {
        // Only update .subscribers-number, .views-number, .videos-number
        state.overlay
          .querySelectorAll('.subscribers-number,.views-number,.videos-number')
          .forEach(el => {
            el.style.fontFamily = select.value;
          });
      }
    });

    // Font size slider
    const fontSizeLabel = document.createElement('label');
    fontSizeLabel.textContent = t('fontSize');
    fontSizeLabel.style.display = 'block';
    fontSizeLabel.style.marginBottom = '5px';
    fontSizeLabel.style.fontSize = '16px';
    fontSizeLabel.style.fontWeight = 'bold';

    const fontSizeSlider = document.createElement('input');
    fontSizeSlider.type = 'range';
    fontSizeSlider.min = '16';
    fontSizeSlider.max = '72';
    fontSizeSlider.value = localStorage.getItem('youtubeEnhancerFontSize') || '24';
    fontSizeSlider.step = '1';
    fontSizeSlider.className = 'font-size-slider';

    const fontSizeValue = document.createElement('div');
    fontSizeValue.className = 'font-size-value';
    fontSizeValue.textContent = `${fontSizeSlider.value}px`;
    fontSizeValue.style.fontSize = '14px';
    fontSizeValue.style.marginBottom = '15px';

    fontSizeSlider.addEventListener('input', e => {
      const { target } = e;
      const input = /** @type {EventTarget & HTMLInputElement} */ (target);
      fontSizeValue.textContent = `${input.value}px`;
      localStorage.setItem('youtubeEnhancerFontSize', input.value);
      if (state.overlay) {
        // Only update .subscribers-number, .views-number, .videos-number
        state.overlay
          .querySelectorAll('.subscribers-number,.views-number,.videos-number')
          .forEach(el => {
            el.style.fontSize = `${input.value}px`;
          });
      }
    });

    // ...existing code...
    const intervalLabel = document.createElement('label');
    intervalLabel.textContent = t('updateInterval');
    intervalLabel.style.display = 'block';
    intervalLabel.style.marginBottom = '5px';
    intervalLabel.style.fontSize = '16px';
    intervalLabel.style.fontWeight = 'bold';

    const intervalSlider = document.createElement('input');
    intervalSlider.type = 'range';
    intervalSlider.min = '2';
    intervalSlider.max = '10';
    intervalSlider.value = String(state.updateInterval / 1000);
    intervalSlider.step = '1';
    intervalSlider.className = 'interval-slider';

    const intervalValue = document.createElement('div');
    intervalValue.className = 'interval-value';
    intervalValue.textContent = `${intervalSlider.value}s`;
    intervalValue.style.marginBottom = '15px';
    intervalValue.style.fontSize = '14px';

    intervalSlider.addEventListener('input', e => {
      const { target } = e;
      const input = /** @type {EventTarget & HTMLInputElement} */ (target);
      const newInterval = parseInt(input.value, 10) * 1000;
      intervalValue.textContent = `${input.value}s`;
      state.updateInterval = newInterval;
      localStorage.setItem('youtubeEnhancerInterval', String(newInterval));

      if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = setInterval(() => {
          updateOverlayContent(state.overlay, state.currentChannelName);
        }, newInterval);

        // ✅ Register interval in cleanupManager
        YouTubeUtils.cleanupManager.registerInterval(state.intervalId);
      }
    });

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = t('backgroundOpacity');
    opacityLabel.style.display = 'block';
    opacityLabel.style.marginBottom = '5px';
    opacityLabel.style.fontSize = '16px';
    opacityLabel.style.fontWeight = 'bold';

    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.min = '50';
    opacitySlider.max = '90';
    opacitySlider.value = String(state.overlayOpacity * 100);
    opacitySlider.step = '5';
    opacitySlider.className = 'opacity-slider';

    const opacityValue = document.createElement('div');
    opacityValue.className = 'opacity-value';
    opacityValue.textContent = `${opacitySlider.value}%`;
    opacityValue.style.fontSize = '14px';

    opacitySlider.addEventListener('input', e => {
      const { target } = e;
      const input = /** @type {EventTarget & HTMLInputElement} */ (target);
      const newOpacity = parseInt(input.value, 10) / 100;
      opacityValue.textContent = `${input.value}%`;
      state.overlayOpacity = newOpacity;
      localStorage.setItem('youtubeEnhancerOpacity', String(newOpacity));

      if (state.overlay) {
        state.overlay.style.backgroundColor = `rgba(0, 0, 0, ${newOpacity})`;
      }
    });

    controlsSection.appendChild(fontLabel);
    controlsSection.appendChild(fontSelect);
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

  function createSpinner() {
    const spinnerContainer = document.createElement('div');
    spinnerContainer.style.position = 'absolute';
    spinnerContainer.style.top = '0';
    spinnerContainer.style.left = '0';
    spinnerContainer.style.width = '100%';
    spinnerContainer.style.height = '100%';
    spinnerContainer.style.display = 'flex';
    spinnerContainer.style.justifyContent = 'center';
    spinnerContainer.style.alignItems = 'center';
    spinnerContainer.classList.add('spinner-container');

    const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spinner.setAttribute('viewBox', '0 0 512 512');
    spinner.setAttribute('width', '64');
    spinner.setAttribute('height', '64');
    spinner.classList.add('loading-spinner');
    spinner.style.animation = 'spin 1s linear infinite';

    const secondaryPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    secondaryPath.setAttribute(
      'd',
      'M0 256C0 114.9 114.1 .5 255.1 0C237.9 .5 224 14.6 224 32c0 17.7 14.3 32 32 32C150 64 64 150 64 256s86 192 192 192c69.7 0 130.7-37.1 164.5-92.6c-3 6.6-3.3 14.8-1 22.2c1.2 3.7 3 7.2 5.4 10.3c1.2 1.5 2.6 3 4.1 4.3c.8 .7 1.6 1.3 2.4 1.9c.4 .3 .8 .6 1.3 .9s.9 .6 1.3 .8c5 2.9 10.6 4.3 16 4.3c11 0 21.8-5.7 27.7-16c-44.3 76.5-127 128-221.7 128C114.6 512 0 397.4 0 256z'
    );
    secondaryPath.style.opacity = '0.4';
    secondaryPath.style.fill = 'white';

    const primaryPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    primaryPath.setAttribute(
      'd',
      'M224 32c0-17.7 14.3-32 32-32C397.4 0 512 114.6 512 256c0 46.6-12.5 90.4-34.3 128c-8.8 15.3-28.4 20.5-43.7 11.7s-20.5-28.4-11.7-43.7c16.3-28.2 25.7-61 25.7-96c0-106-86-192-192-192c-17.7 0-32-14.3-32-32z'
    );
    primaryPath.style.fill = 'white';

    spinner.appendChild(secondaryPath);
    spinner.appendChild(primaryPath);
    spinnerContainer.appendChild(spinner);
    return spinnerContainer;
  }

  function createSVGIcon(path) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 640 512');
    svg.setAttribute('width', '2rem');
    svg.setAttribute('height', '2rem');
    svg.style.marginRight = '0.5rem';
    svg.style.display = 'none';

    const svgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svgPath.setAttribute('d', path);
    svgPath.setAttribute('fill', 'white');

    svg.appendChild(svgPath);
    return svg;
  }

  function createStatContainer(className, iconPath) {
    const container = document.createElement('div');
    Object.assign(container.style, {
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
    Object.assign(numberContainer.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    });

    const differenceElement = document.createElement('div');
    differenceElement.classList.add(`${className}-difference`);
    Object.assign(differenceElement.style, {
      fontSize: '2.5rem',
      height: '2.5rem',
      marginBottom: '1rem',
    });

    const digitContainer = createNumberContainer();
    digitContainer.classList.add(`${className}-number`);
    Object.assign(digitContainer.style, {
      fontSize: `${localStorage.getItem('youtubeEnhancerFontSize') || '24'}px`,
      fontWeight: 'bold',
      lineHeight: '1',
      height: '4rem',
      fontFamily: localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif',
      letterSpacing: '0.025em',
    });

    numberContainer.appendChild(differenceElement);
    numberContainer.appendChild(digitContainer);

    const labelContainer = document.createElement('div');
    Object.assign(labelContainer.style, {
      display: 'flex',
      alignItems: 'center',
      marginTop: '0.5rem',
    });

    const icon = createSVGIcon(iconPath);
    Object.assign(icon.style, {
      width: '2rem',
      height: '2rem',
      marginRight: '0.75rem',
    });

    const labelElement = document.createElement('div');
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
    Object.assign(overlay.style, {
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
      fontFamily: localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif',
      fontSize: `${localStorage.getItem('youtubeEnhancerFontSize') || '24'}px`,
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
    if (window.innerWidth <= 768) {
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
    const toggleMenu = show => {
      settingsMenu.classList.toggle('show', show);
      settingsButton.setAttribute('aria-expanded', show);
      if (show) settingsMenu.focus();
    };

    settingsButton.addEventListener('click', e => {
      e.stopPropagation();
      toggleMenu(!settingsMenu.classList.contains('show'));
    });

    settingsButton.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleMenu(!settingsMenu.classList.contains('show'));
      }
    });

    // Register document-level event handlers
    const clickHandler = e => {
      const node = /** @type {EventTarget & Node} */ (e.target);
      if (!settingsMenu.contains(node) && !settingsButton.contains(node)) {
        toggleMenu(false);
      }
    };

    const keyHandler = e => {
      if (e.key === 'Escape' && settingsMenu.classList.contains('show')) {
        toggleMenu(false);
        settingsButton.focus();
      }
    };

    const clickKey = YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler);
    const keyKey = YouTubeUtils.cleanupManager.registerListener(document, 'keydown', keyHandler);
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

  function createOverlay(bannerElement) {
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

  function fetchWithGM(url, headers = {}) {
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
          onload: response => {
            if (response.status >= 200 && response.status < 300) {
              try {
                resolve(JSON.parse(response.responseText));
              } catch (parseError) {
                reject(new Error(`Failed to parse response: ${parseError.message}`));
              }
            } else {
              reject(new Error(`Failed to fetch: ${response.status}`));
            }
          },
          onerror: error => reject(error),
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
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }
        return response.json();
      })
      .catch(error => {
        utils.error('Fallback fetch failed:', error);
        throw error;
      });
  }

  async function fetchChannelId(_channelName) {
    // Try meta tag first
    const metaTag = document.querySelector('meta[itemprop="channelId"]');
    if (metaTag && metaTag.content) return metaTag.content;

    // Try URL pattern
    const urlMatch = window.location.href.match(/channel\/(UC[\w-]+)/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];

    // Try ytInitialData
    const channelInfo = await getChannelInfo(window.location.href);
    if (channelInfo && channelInfo.channelId) return channelInfo.channelId;
    throw new Error('Could not determine channel ID');
  }

  /**
   * Fetch channel statistics with retry logic and fallback
   * Refactored to use channel-stats-helpers module
   * @param {string} channelId - Channel ID
   * @returns {Promise<Object>} Channel stats
   */
  async function fetchChannelStats(channelId) {
    const helpers =
      typeof window !== 'undefined' && window.YouTubePlusChannelStatsHelpers
        ? window.YouTubePlusChannelStatsHelpers
        : null;

    if (!helpers) {
      utils.error('Channel stats helpers not loaded');
      return {
        followerCount: 0,
        bottomOdos: [0, 0],
        error: true,
        timestamp: Date.now(),
      };
    }

    try {
      // Attempt to fetch with retry logic
      const fetchFn = () =>
        fetchWithGM(`${STATS_API_URL}${channelId}`, {
          origin: 'https://livecounts.io',
          referer: 'https://livecounts.io/',
        });

      const stats = await helpers.fetchWithRetry(fetchFn, CONFIG.MAX_RETRIES, utils);

      // If fetch succeeded, cache and return
      if (stats) {
        helpers.cacheStats(state.lastSuccessfulStats, channelId, stats);
        return stats;
      }

      // Try to use cached data if fetch failed
      const cachedStats = helpers.getCachedStats(
        state.lastSuccessfulStats,
        channelId,
        CONFIG.CACHE_DURATION,
        utils
      );

      if (cachedStats) {
        return cachedStats;
      }

      // Fallback: try to extract subscriber count from page
      const fallbackCount = helpers.extractSubscriberCountFromPage();
      if (fallbackCount > 0) {
        utils.log('Extracted fallback subscriber count:', fallbackCount);
      }

      return helpers.createFallbackStats(fallbackCount);
    } catch (error) {
      utils.error('Failed to fetch channel stats:', error);
      return helpers.createFallbackStats(0);
    }
  }

  function clearExistingOverlay() {
    const existingOverlay = document.querySelector('.channel-banner-overlay');
    if (existingOverlay) {
      try {
        existingOverlay.remove();
      } catch {
        console.warn('[YouTube+] Failed to remove overlay');
      }
    }
    if (state.intervalId) {
      try {
        clearInterval(state.intervalId);
        // ✅ Unregister from cleanupManager if it was registered
        YouTubeUtils.cleanupManager.unregisterInterval(state.intervalId);
      } catch {
        console.warn('[YouTube+] Failed to clear interval');
      }
      state.intervalId = null;
    }
    if (state.documentListenerKeys && state.documentListenerKeys.size) {
      state.documentListenerKeys.forEach(key => {
        try {
          YouTubeUtils.cleanupManager.unregisterListener(key);
        } catch {
          console.warn('[YouTube+] Failed to unregister listener');
        }
      });
      state.documentListenerKeys.clear();
    }
    if (state.lastSuccessfulStats) state.lastSuccessfulStats.clear();
    if (state.previousStats) state.previousStats.clear();
    state.isUpdating = false;
    state.overlay = null;
    utils.log('Cleared existing overlay');
  }

  function createDigitElement() {
    const digit = document.createElement('span');
    Object.assign(digit.style, {
      display: 'inline-block',
      width: '0.6em',
      textAlign: 'center',
      marginRight: '0.025em',
      marginLeft: '0.025em',
    });
    return digit;
  }

  function createCommaElement() {
    const comma = document.createElement('span');
    comma.textContent = ',';
    Object.assign(comma.style, {
      display: 'inline-block',
      width: '0.3em',
      textAlign: 'center',
    });
    return comma;
  }

  function createNumberContainer() {
    const container = document.createElement('div');
    Object.assign(container.style, {
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

  function updateDigits(container, newValue) {
    const newValueStr = newValue.toString();
    const digitGroups = splitIntoDigitGroups(newValueStr);

    clearContainer(container);
    renderDigitGroups(container, digitGroups);
    animateDigitChanges(container, digitGroups);
  }

  function animateDigit(element, start, end) {
    const duration = 1000;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = Math.round(start + (end - start) * easeOutQuart);
      element.textContent = current;

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  }

  function showContent(overlay) {
    const spinnerContainer = overlay.querySelector('.spinner-container');
    if (spinnerContainer) {
      spinnerContainer.remove();
    }

    const containers = overlay.querySelectorAll('div[style*="visibility: hidden"]');
    containers.forEach(container => {
      container.style.visibility = 'visible';
    });

    const icons = overlay.querySelectorAll('svg[style*="display: none"]');
    icons.forEach(icon => {
      icon.style.display = 'block';
    });
  }

  function updateDifferenceElement(element, currentValue, previousValue) {
    if (!previousValue) return;

    const difference = currentValue - previousValue;
    if (difference === 0) {
      element.textContent = '';
      return;
    }

    const sign = difference > 0 ? '+' : '';
    element.textContent = `${sign}${difference.toLocaleString()}`;
    element.style.color = difference > 0 ? '#1ed760' : '#f3727f';

    setTimeout(() => {
      element.textContent = '';
    }, 1000);
  }

  function updateDisplayState() {
    const overlay = document.querySelector('.channel-banner-overlay');
    if (!overlay) return;

    const statContainers = overlay.querySelectorAll('div[style*="width"]');
    if (!statContainers.length) return;

    let visibleCount = 0;
    const visibleContainers = [];

    statContainers.forEach(container => {
      const numberContainer = container.querySelector('[class$="-number"]');
      if (!numberContainer) return;

      const type = numberContainer.className.replace('-number', '');

      const isVisible = localStorage.getItem(`show-${type}`) !== 'false';

      if (isVisible) {
        container.style.display = 'flex';
        visibleCount++;
        visibleContainers.push(container);
      } else {
        container.style.display = 'none';
      }
    });

    visibleContainers.forEach(container => {
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
    const fontSize = localStorage.getItem('youtubeEnhancerFontSize') || '24';
    const fontFamily = localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif';
    overlay.querySelectorAll('.subscribers-number,.views-number,.videos-number').forEach(el => {
      el.style.fontSize = `${fontSize}px`;
      el.style.fontFamily = fontFamily;
    });

    overlay.style.display = 'flex';
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
   * @param {Object} stats - Stats object with error
   * @returns {void}
   */
  function handleStatsError(overlay, stats) {
    const containers = overlay.querySelectorAll('[class$="-number"]');
    containers.forEach(container => {
      if (container.classList.contains('subscribers-number') && stats.followerCount > 0) {
        updateDigits(container, stats.followerCount);
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
      updateDigits(numberContainer, value);
    }

    if (differenceElement && state.previousStats.has(channelId)) {
      const previousValue = getPreviousStatValue(channelId, className);
      if (previousValue !== null) {
        updateDifferenceElement(differenceElement, value, previousValue);
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
   * @param {Object} stats - Stats object
   * @returns {void}
   */
  function updateAllStatElements(overlay, channelId, stats) {
    updateStatElement(overlay, channelId, 'subscribers', stats.followerCount, 'Subscribers');
    updateStatElement(overlay, channelId, 'views', stats.bottomOdos[0], 'Views');
    updateStatElement(overlay, channelId, 'videos', stats.bottomOdos[1], 'Videos');
  }

  /**
   * Show error state in overlay
   * @param {HTMLElement} overlay - Overlay element
   * @returns {void}
   */
  function showOverlayError(overlay) {
    const containers = overlay.querySelectorAll('[class$="-number"]');
    containers.forEach(container => {
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
    state.isUpdating = true;

    try {
      const channelId = await fetchChannelId(channelName);
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
      utils.error('Failed to update overlay content:', error);
      showOverlayError(overlay);
    } finally {
      state.isUpdating = false;
    }
  }

  // Add settings UI to experimental section
  function addSettingsUI() {
    const section = document.querySelector(
      '.ytp-plus-settings-section[data-section="experimental"]'
    );
    if (!section || section.querySelector('.count-settings-item')) return;

    const item = document.createElement('div');
    item.className = 'ytp-plus-settings-item count-settings-item';
    item.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">${t('channelStatsTitle')}</label>
          <div class="ytp-plus-settings-item-description">${t('channelStatsDescription')}</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" ${state.enabled ? 'checked' : ''}>
      `;
    section.appendChild(item);

    item.querySelector('input').addEventListener('change', e => {
      const { target } = e;
      const input = /** @type {EventTarget & HTMLInputElement} */ (target);
      state.enabled = input.checked;
      localStorage.setItem(CONFIG.STORAGE_KEY, state.enabled ? 'true' : 'false');
      if (state.enabled) {
        observePageChanges();
        addNavigationListener();
        setTimeout(() => {
          const bannerElement = document.getElementById('page-header-banner-sizer');
          if (bannerElement && isChannelPage()) {
            addOverlay(bannerElement);
          }
        }, 100);
      } else {
        clearExistingOverlay();
      }
    });
  }

  // Observe settings modal for experimental section
  const settingsObserver = new MutationObserver(mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addSettingsUI, 100);
          return;
        }
      }
    }
    if (document.querySelector('.ytp-plus-settings-nav-item[data-section="experimental"].active')) {
      setTimeout(addSettingsUI, 50);
    }
  });
  YouTubeUtils.cleanupManager.registerObserver(settingsObserver);

  // ✅ Safe observe with document.body check
  if (document.body) {
    settingsObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      settingsObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  const experimentalNavClickHandler = e => {
    const { target } = e;
    const el = /** @type {EventTarget & HTMLElement} */ (target);
    if (
      el.classList?.contains('ytp-plus-settings-nav-item') &&
      el.dataset?.section === 'experimental'
    ) {
      setTimeout(addSettingsUI, 50);
    }
  };

  const listenerKey = YouTubeUtils.cleanupManager.registerListener(
    document,
    'click',
    experimentalNavClickHandler,
    true
  );
  state.documentListenerKeys.add(listenerKey);

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
  function shouldSkipOverlay(channelName) {
    return !channelName || (channelName === state.currentChannelName && state.overlay);
  }

  /**
   * Ensure banner element has proper positioning
   * @param {HTMLElement} bannerElement - Banner element
   */
  function ensureBannerPosition(bannerElement) {
    if (bannerElement && !bannerElement.style.position) {
      bannerElement.style.position = 'relative';
    }
  }

  /**
   * Clear existing update interval
   */
  function clearUpdateInterval() {
    if (state.intervalId) {
      clearInterval(state.intervalId);
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
    const debouncedUpdate = createDebouncedUpdate(overlay, channelName);
    state.intervalId = setInterval(debouncedUpdate, state.updateInterval);
    YouTubeUtils.cleanupManager.registerInterval(state.intervalId);
  }

  /**
   * Add overlay to channel page banner
   * @param {HTMLElement} bannerElement - Banner element
   */
  function addOverlay(bannerElement) {
    const channelName = extractChannelName(window.location.pathname);

    if (shouldSkipOverlay(channelName)) {
      return;
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

  function isChannelPage() {
    return (
      window.location.pathname.startsWith('/@') ||
      window.location.pathname.startsWith('/channel/') ||
      window.location.pathname.startsWith('/c/')
    );
  }

  /**
   * Find banner element with fallback selectors
   * @returns {HTMLElement|null} Banner element
   */
  function findBannerElement() {
    let bannerElement = document.getElementById('page-header-banner-sizer');

    if (!bannerElement) {
      const alternatives = [
        '[id*="banner"]',
        '.ytd-c4-tabbed-header-renderer',
        '#channel-header',
        '.channel-header',
      ];

      for (const selector of alternatives) {
        bannerElement = document.querySelector(selector);
        if (bannerElement) break;
      }
    }

    return bannerElement;
  }

  /**
   * Ensure banner has proper positioning
   * @param {HTMLElement} bannerElement - Banner element
   * @returns {void}
   */
  function ensureBannerPositioning(bannerElement) {
    if (bannerElement.style.position !== 'relative') {
      bannerElement.style.position = 'relative';
    }
  }

  /**
   * Handle page update for banner overlay
   * @returns {void}
   */
  function handleBannerUpdate() {
    const bannerElement = findBannerElement();

    if (bannerElement && isChannelPage()) {
      ensureBannerPositioning(bannerElement);
      addOverlay(bannerElement);
    } else if (!isChannelPage()) {
      clearExistingOverlay();
      state.currentChannelName = null;
    }
  }

  /**
   * Cleanup observer timeout
   * @param {MutationObserver} observer - Observer instance
   * @returns {void}
   */
  function clearObserverTimeout(observer) {
    if (/** @type {any} */ (observer)._timeout) {
      YouTubeUtils.cleanupManager.unregisterTimeout(/** @type {any} */ (observer)._timeout);
      clearTimeout(/** @type {any} */ (observer)._timeout);
    }
  }

  /**
   * Setup observer for monitoring page changes
   * @param {MutationObserver} observer - Observer instance
   * @returns {void}
   */
  function setupObserver(observer) {
    const observerConfig = {
      childList: true,
      subtree: true,
      attributes: false,
    };

    if (document.body) {
      observer.observe(document.body, observerConfig);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, observerConfig);
      });
    }
  }

  /**
   * Observe page changes and update banner overlay
   * @returns {MutationObserver|undefined} Observer instance
   */
  function observePageChanges() {
    if (!state.enabled) return undefined;

    const observer = new MutationObserver(_mutations => {
      clearObserverTimeout(observer);

      /** @type {any} */ (observer)._timeout = YouTubeUtils.cleanupManager.registerTimeout(
        setTimeout(handleBannerUpdate, 100)
      );
    });

    setupObserver(observer);

    // Store timeout reference for cleanup
    /** @type {any} */ (observer)._timeout = null;

    // Store observer for cleanup on page unload
    if (typeof state.observers === 'undefined') {
      state.observers = [];
    }
    state.observers.push(observer);

    return observer;
  }

  function addNavigationListener() {
    if (!state.enabled) return;

    window.addEventListener('yt-navigate-finish', () => {
      if (isChannelPage()) {
        const bannerElement = document.getElementById('page-header-banner-sizer');
        if (bannerElement) {
          addOverlay(bannerElement);
          utils.log('Navigated to channel page');
        }
      } else {
        clearExistingOverlay();
        state.currentChannelName = null;
        utils.log('Navigated away from channel page');
      }
    });
  }

  // Cleanup function for page unload
  function cleanup() {
    // Disconnect all observers
    if (state.observers && Array.isArray(state.observers)) {
      state.observers.forEach(observer => {
        try {
          observer.disconnect();
        } catch (e) {
          console.warn('[YouTube+] Failed to disconnect observer:', e);
        }
      });
      state.observers = [];
    }

    // Clear overlay and intervals
    clearExistingOverlay();

    utils.log('Cleanup completed');
  }

  // Register cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

  // Export module to global scope for module loader
  if (typeof window !== 'undefined') {
    window.YouTubeStats = {
      init,
      cleanup,
      version: '2.3',
    };
  }

  init();
})();
