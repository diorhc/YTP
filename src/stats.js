/**
 * Stats module: video statistics panel and channel statistics overlay. Each
 * half is its own IIFE with independent init guards, DOM, listeners and CSS;
 * merging them would tangle state in one 4000+ line scope.
 */
/**
 * Fetch with a bounded deadline. The timer is cleared once the response
 * settles so no background timer outlives the request.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [ms]
 * @returns {Promise<Response>}
 */
function fetchWithDeadline_(url, options = {}, ms = 10000) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ms) : null;
  return fetch(url, controller ? { ...options, signal: controller.signal } : options).finally(
    () => {
      if (timer !== null) clearTimeout(timer);
    }
  );
}

/**
 * Accept a counter payload only when every number it carries is finite and
 * non-negative and at least one number is present. Shape-agnostic so both
 * counter services are covered without assuming field names.
 * @param {unknown} data
 * @returns {boolean}
 */
function numbersAreValidCounts_(data) {
  if (!data || typeof data !== 'object') return false;
  let sawNumber = false;
  /** @type {unknown[]} */
  const stack = [data];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node === 'number') {
      if (!Number.isFinite(node) || node < 0) return false;
      sawNumber = true;
      continue;
    }
    if (Array.isArray(node)) {
      for (const value of node) stack.push(value);
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    for (const value of Object.values(node)) stack.push(value);
  }
  return sawNumber;
}

// Exposed so both counter fetch paths share one predicate and guard-branch
// tests exercise the same code production uses.
if (typeof window !== 'undefined') {
  window.YouTubePlusStats = Object.assign(window.YouTubePlusStats || {}, {
    numbersAreValidCounts: numbersAreValidCounts_,
  });
}

/**
 * @typedef {{
 *   likes: number | null,
 *   dislikes: number | null,
 *   rating: number | null
 * }} RydVotesAggregate
 */

/**
 * @typedef {{
 *   videoId?: string,
 *   title?: string,
 *   author?: string | null,
 *   authorHandle?: string | null,
 *   views?: number | null,
 *   likes?: number | null,
 *   dislikes?: number | null,
 *   rating?: number | null,
 *   thumbnail?: string | null,
 *   duration?: string | number | null,
 *   country?: string | null,
 *   monetized?: boolean | null,
 *   channelId?: string,
 *   comments?: number | null,
 *   subscribers?: string | number | null,
 *   liveViewer?: number | string | null,
 *   [key: string]: unknown
 * }} VideoStatsData
 */

/**
 * @typedef {{
 *   followerCount: number,
 *   bottomOdos: [number, number],
 *   error?: boolean,
 *   subscriberCount?: number,
 *   viewCount?: number,
 *   videoCount?: number,
 *   [key: string]: unknown
 * }} LivecountsChannelStats
 */

/**
 * @typedef {{
 *   views?: number | null,
 *   likes?: number | null,
 *   dislikes?: number | null,
 *   comments?: number | null,
 *   subscribers?: string | number | null,
 *   title?: string,
 *   author?: string | null,
 *   authorHandle?: string | null,
 *   thumbnail?: string | null,
 *   monetized?: boolean | null,
 *   country?: string | null,
 *   duration?: string | number | null,
 *   [key: string]: unknown
 * }} PageStatsData
 */

/**
 * @typedef {{
 *   monetization?: string | null,
 *   country?: string | null,
 *   duration?: string | null
 * }} ExtraMetadata
 */

/**
 * @typedef {{
 *   context: {
 *     client: {
 *       clientName: string,
 *       clientVersion: string,
 *       hl: string,
 *       gl: string
 *     }
 *   },
 *   videoId?: string,
 *   browseId?: string,
 *   continuation?: string
 * }} InnerTubeRequestBody
 */

/**
 * @typedef {{
 *   method: string,
 *   headers: Record<string, string>,
 *   body: string
 * }} InnerTubeFetchOptions
 */

/**
 * @typedef {{
 *   views?: number | string | null,
 *   likes?: number | string | null,
 *   dislikes?: number | string | null,
 *   comments?: number | string | null,
 *   liveViewer?: number | string | null,
 *   title: string,
 *   thumbUrl: string,
 *   country?: string | null,
 *   monetized?: boolean | null,
 *   duration?: string | number | null,
 *   author?: string | null,
 *   authorHandle?: string | null
 * }} ExtractedVideoFields
 */

/**
 * @typedef {{
 *   label: string,
 *   value: number | null | undefined,
 *   exact: number | string | null | undefined,
 *   iconClass: string,
 *   iconSvg: string
 * }} VideoStatCardDef
 */

/**
 * @typedef {{
 *   overlay: HTMLElement | null,
 *   isUpdating: boolean,
 *   intervalId: { stop?: () => void } | null,
 *   currentChannelName: string | null,
 *   currentChannelId: string | null,
 *   enabled: boolean,
 *   updateInterval: number,
 *   overlayOpacity: number,
 *   lastSuccessfulStats: Map<string, { stats: LivecountsChannelStats, timestamp: number }>,
 *   previousStats: Map<string, LivecountsChannelStats>,
 *   channelIdCache: Map<string, string>,
 *   lastChannelIdWarnAt: number,
 *   previousUrl: string,
 *   isChecking: boolean,
 *   documentListenerKeys: Set<symbol>,
 *   overlayEnsureScheduler: { stop?: () => void } | null,
 *   pageObserversAttached: boolean,
 *   navigationListenerAttached: boolean,
 * }} ChannelStatsState
 */

function createTouchFeedbackShape_() {
  const touchFeedback = document.createElement('yt-touch-feedback-shape');
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
  return touchFeedback;
}

/**
 * Read a design-system style bundle so a feature can inject it through its
 * own context when the matching UI is built.
 * @param {string} styleId
 * @returns {string}
 */
function getStatsStyles_(styleId) {
  return window.YouTubePlusDesignSystem?.getStyle?.(styleId) || '';
}

// Stats button and menu
(function () {
  const U = window.YouTubeUtils;
  // Dock click registration key + stable per-button closure, so
  // repeated mountDock calls dedup to a single live registration.
  let statsDockKey = /** @type {symbol | null} */ (null);
  /** @type {WeakMap<HTMLElement, (e: Event) => void>} */
  const statsClickHandlers = new WeakMap();
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U.logSuppressed?.(_err, _label || 'Stats');

  if (window.__ytpVideoStatsModuleInit) return;

  /** @type {YouTubePlusFeatureContext | null} */
  let videoStatsCtx = null;
  /** @type {((ctx: YouTubePlusFeatureContext) => void) | null} */
  let videoStatsEnter = null;
  /** @type {(() => void) | null} */
  let videoStatsExit = null;

  // Unified listener registration helper: uses cleanupManager, or falls back to
  // addEventListener. Declared at module scope (not inside initVideoStats)
  // because the module-scope registration below also uses it.
  /**
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListenerOrEventListenerObject} handler
   * @param {AddEventListenerOptions | boolean} [opts]
   */
  // Shared helper: delegates to YouTubeUtils.
  const registerListenerSafe = (target, type, handler, opts) =>
    /** @type {symbol | null} */ (U.registerListenerSafe?.(target, type, handler, opts));

  /** @type {YouTubePlusFeatureDescriptor | null} */
  let DESCRIPTOR = null;

  // Locale-aware counter parsing. Handles localized display forms
  // ("1.234.567 Aufrufe", "1,2 тыс. просмотров", "1.2K", "1,2 млн", "0")
  // and returns an exact integer. Returns 0 for a real "0": the caller must
  // distinguish "no data" by a null/undefined check, never by truthiness.
  // Returns null when nothing numeric can be extracted.
  //
  // YouTube emits different single-letter suffixes per interface language
  // (Turkish "B" = bin, Indonesian "M" = miliar, Vietnamese "N/Tr/T"), and
  // Hindi counts scale by लाख/करोड़, which one shared table cannot resolve,
  // so the document language picks the table. The EN-style K/M/B fallback
  // applies only to English and unknown locales; unambiguous markers
  // (млн/тыс/Mio./mln/千/万/萬/만/億/亿/억…) stay in the shared fallback.
  /** @type {Record<string, Array<[RegExp, number]>>} */
  const LANG_SUFFIX_MARKERS_ = {
    en: [
      [/\bthousand\b/i, 1e3],
      [/\bmillion\b/i, 1e6],
      [/\bbillion\b/i, 1e9],
    ],
    ru: [
      [/млрд/i, 1e9],
      [/млн/i, 1e6],
      [/тыс\.?/i, 1e3],
    ],
    uk: [
      [/млрд/i, 1e9],
      [/млн/i, 1e6],
      [/тис\.?/i, 1e3],
    ],
    be: [
      [/млрд/i, 1e9],
      [/млн/i, 1e6],
      [/тыс\.?/i, 1e3],
    ],
    de: [
      [/mrd\.?/i, 1e9],
      [/mio\.?/i, 1e6],
      [/tsd\.?/i, 1e3],
    ],
    fr: [
      [/(?<=\d)\s*md\.?\b/i, 1e9],
      [/(?<=\d)\s*m\.?\b/i, 1e6],
      [/(?<=\d)\s*k\.?\b/i, 1e3],
    ],
    es: [
      // "1,2 mil M" is mil millones (1e9), which must win over plain "mil".
      [/\bmil\s*m\b/i, 1e9],
      [/\bmm\b/i, 1e9],
      [/\bmil\b/i, 1e3],
      [/(?<=\d)\s*m\.?\b/i, 1e6],
    ],
    pt: [
      [/\bbi\b/i, 1e9],
      [/\bmi\b/i, 1e6],
      [/\bmil\b/i, 1e3],
    ],
    it: [
      [/\bmrd\b|\bmld\b/i, 1e9],
      [/\bmln\b/i, 1e6],
      [/\bmila\b/i, 1e3],
    ],
    pl: [
      [/\bmld\b/i, 1e9],
      [/\bmln\b/i, 1e6],
      [/tys\.?/i, 1e3],
    ],
    nl: [
      [/\bmld\b/i, 1e9],
      [/\bmln\b/i, 1e6],
      [/(?<=\d)\s*k\.?\b/i, 1e3],
      [/\bdzd\.?/i, 1e3],
    ],
    ja: [
      [/億/i, 1e8],
      [/万/i, 1e4],
      [/千/i, 1e3],
    ],
    ko: [
      [/억/i, 1e8],
      [/만/i, 1e4],
      [/천/i, 1e3],
    ],
    'zh-cn': [
      [/亿/i, 1e8],
      [/万/i, 1e4],
      [/千/i, 1e3],
    ],
    'zh-tw': [
      [/億/i, 1e8],
      [/萬/i, 1e4],
      [/千/i, 1e3],
    ],
    tr: [
      [/(?<=\d)\s*mr\.?\b/i, 1e9],
      [/(?<=\d)\s*mn\.?\b/i, 1e6],
      [/(?<=\d)\s*b\b/i, 1e3],
      [/\bbin\b/i, 1e3],
    ],
    id: [
      [/(?<=\d)\s*m\.?\b/i, 1e9],
      [/\bjt\b/i, 1e6],
      [/\brb\b/i, 1e3],
    ],
    vi: [
      [/(?<=\d)\s*tr\b/i, 1e6],
      [/(?<=\d)\s*t\.?\b/i, 1e9],
      [/(?<=\d)\s*n\b/i, 1e3],
    ],
    hi: [
      [/करोड़/i, 1e7],
      [/लाख/i, 1e5],
      // Both the precomposed (ज़) and the combining-nukta spelling occur.
      [/हज़ार|हज़ार|हजार/i, 1e3],
    ],
    ar: [
      [/مليار/i, 1e9],
      [/مليون/i, 1e6],
      [/ألف/i, 1e3],
    ],
    bg: [
      [/млрд/i, 1e9],
      [/млн/i, 1e6],
      [/хил\.?/i, 1e3],
    ],
    kk: [
      [/млрд/i, 1e9],
      [/млн/i, 1e6],
      [/мың/i, 1e3],
    ],
    ky: [
      [/млрд/i, 1e9],
      [/млн/i, 1e6],
      [/миң/i, 1e3],
    ],
    uz: [
      [/mlrd/i, 1e9],
      [/mln/i, 1e6],
      [/ming/i, 1e3],
    ],
    az: [
      [/mlrd/i, 1e9],
      [/mln/i, 1e6],
      [/min/i, 1e3],
    ],
  };

  /** Shared fallback: unambiguous multi-letter markers, same for every language. */
  /** @type {Array<[RegExp, number]>} */
  const SHARED_SUFFIX_MARKERS_ = [
    [/billion/i, 1e9],
    [/million/i, 1e6],
    [/thousand/i, 1e3],
    [/млрд/i, 1e9],
    [/млн/i, 1e6],
    [/тыс\.?|тис\.?/i, 1e3],
    [/mrd\.?/i, 1e9],
    [/mio\.?/i, 1e6],
    [/\bbln\b/i, 1e9],
    [/\bmln\b/i, 1e6],
    [/\bmil\b/i, 1e3],
    [/\bkk\b/i, 1e3],
    [/千/i, 1e3],
    [/万|萬/i, 1e4],
    [/만/i, 1e4],
    [/億|亿/i, 1e8],
    [/억/i, 1e8],
  ];

  /** Interface language for suffix resolution, normalized to a table key. */
  function resolveCountLangKey_() {
    const raw = String(document?.documentElement?.lang || '').toLowerCase();
    if (!raw) return '';
    if (raw.startsWith('zh')) {
      return raw.includes('tw') || raw.includes('hant') ? 'zh-tw' : 'zh-cn';
    }
    return raw.split('-')[0];
  }

  /**
   * The PAGE window (userscript sandboxes wrap it; unsafeWindow is the real
   * one), where player data lives, not in the sandbox. Same pattern as
   * pip.js/download.js.
   * @returns {Window & typeof globalThis}
   */
  function getPageGlobal() {
    try {
      if (typeof unsafeWindow !== 'undefined') {
        const unwrapped = /** @type {{ wrappedJSObject?: unknown }} */ (unsafeWindow)
          .wrappedJSObject;
        if (unwrapped && typeof unwrapped === 'object')
          return /** @type {Window & typeof globalThis} */ (unwrapped);
        return unsafeWindow;
      }
    } catch (_e) {
      logS(_e);
    }
    return window;
  }

  /**
   * Player-supplied details are accepted only for the video currently on
   * screen, so a stale response for an earlier video cannot feed the current
   * card.
   * @param {PlayerResponseData['videoDetails'] | null | undefined} details
   * @param {string|null} currentVideoId
   * @returns {boolean}
   */
  function isOwnVideoDetails_(details, currentVideoId) {
    if (!details || typeof details !== 'object') return false;
    if (details.viewCount == null || details.viewCount === '') return false;
    return typeof details.videoId === 'string' && details.videoId === currentVideoId;
  }

  /**
   * Largest thousand-grouped integer in a string ("along with 12,345
   * others" → 12345), or null. Numbers without a separator group are
   * ignored so a fractional display value ("1,2 लाख") never becomes a
   * fake count.
   * @param {unknown} rawText
   * @returns {number|null}
   */
  function extractLargestInteger_(rawText) {
    if (rawText == null) return null;
    const runs = String(rawText).match(
      /\d{1,3}(?:[\s\u00a0\u202f,.']\d{3})+(?![\d\u00a0\u202f,.'])/g
    );
    if (!runs) return null;
    let best = null;
    for (const run of runs) {
      const num = Number(run.replace(/[\s\u00a0\u202f,.']/g, ''));
      if (Number.isFinite(num) && (best === null || num > best)) best = num;
    }
    return best;
  }

  /**
   * @param {string|null|undefined} rawText
   * @returns {string|null}
   */
  function normalizeLocalizedDigits_(rawText) {
    if (rawText == null) return null;
    const text = String(rawText)
      .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06f0-\u06f9]/g, d => String(d.charCodeAt(0) - 0x06f0))
      .replace(/\u066b/g, '.')
      .replace(/\u066c/g, ',')
      .trim();
    return text || null;
  }

  /**
   * @param {string} text
   * @param {Array<[RegExp, number]>} [markers]
   * @returns {{ multiplier: number, cleanText: string } | null}
   */
  function matchSuffixMarker_(text, markers) {
    for (const [re, mult] of markers || []) {
      if (re.test(text)) {
        return { multiplier: mult, cleanText: text.replace(re, ' ') };
      }
    }
    return null;
  }

  /**
   * @param {string} text
   * @returns {{ multiplier: number, cleanText: string }}
   */
  function resolveSingleLetterMultiplier_(text) {
    const letter = text.match(/(\d)\s*([kmb])\b/i);
    if (letter && letter.index != null) {
      const unit = letter[2].toLowerCase();
      const multiplier = unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : 1e9;
      const cleanText =
        text.slice(0, letter.index + 1) + text.slice(letter.index + letter[0].length);
      return { multiplier, cleanText };
    }
    return { multiplier: 1, cleanText: text };
  }

  /**
   * @param {string} text
   * @param {string} langKey
   * @returns {{ multiplier: number, cleanText: string }}
   */
  function resolveCountMultiplier_(text, langKey) {
    const langMarkers = LANG_SUFFIX_MARKERS_[langKey];
    const matched =
      matchSuffixMarker_(text, langMarkers) || matchSuffixMarker_(text, SHARED_SUFFIX_MARKERS_);
    if (matched) return matched;

    if (!langMarkers || langKey === 'en') {
      return resolveSingleLetterMultiplier_(text);
    }
    return { multiplier: 1, cleanText: text };
  }

  /**
   * @param {string} run
   * @returns {string}
   */
  function normalizeNumericRun_(run) {
    const hasComma = run.includes(',');
    const hasDot = run.includes('.');
    if (hasComma && hasDot) {
      if (run.lastIndexOf(',') > run.lastIndexOf('.')) {
        return run.replace(/\./g, '').replace(',', '.');
      }
      return run.replace(/,/g, '');
    }
    if (hasComma || hasDot) {
      const sep = hasComma ? ',' : '.';
      const parts = run.split(sep);
      const grouped = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
      return grouped ? parts.join('') : run.replace(sep, '.');
    }
    return run;
  }

  /**
   * @param {string|null|undefined} rawText
   * @returns {number|null}
   */
  function parseLocalizedCount_(rawText) {
    const text = normalizeLocalizedDigits_(rawText);
    if (!text) return null;

    const { multiplier, cleanText } = resolveCountMultiplier_(text, resolveCountLangKey_());
    const runs = cleanText.match(/\d[\d.,\s]*\d|\d/g);
    if (!runs || runs.length === 0) return null;
    const run = runs.sort((a, b) => b.length - a.length)[0].replace(/\s+/g, '');

    const normalized = normalizeNumericRun_(run);
    const num = Number(normalized);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * multiplier);
  }

  const initVideoStats = () => {
    if (window.__ytpVideoStatsModuleInit) return;
    window.__ytpVideoStatsModuleInit = true;
    const _setSafeHTML = U.setSafeHTML;
    const setTimeout_ = setTimeout.bind(window);

    // Shared helpers from YouTubeUtils
    const utils = U;
    const $ = utils.$;
    const $$ = utils.$$;

    // Shared translation helper, declared before "inject now" so
    // addSettingsUI() doesn't hit TDZ on `t`.
    const t = U.t;

    // Settings state needed by addSettingsUI(), which runs via retry scheduler
    // even on Studio (before the isStudioPage guard returns).
    const SETTINGS_KEY = 'enableStatsButton';
    const STATS_ICON_ID = 'yp-stats-universal-icon';
    const STATS_ICON_SELECTOR = `#${STATS_ICON_ID}, .shortsStats, .videoStats:not(.vision-dock-btn)[data-yp-stats-icon="true"], .videoStats:not(.vision-dock-btn)`;

    /** @returns {boolean} the stats-button flag from the settings store */
    const isStatsButtonEnabled = () =>
      window.YouTubePlusSettingsStore?.get?.(SETTINGS_KEY) !== false;

    let statsButtonEnabled = isStatsButtonEnabled();

    let statsInitialized = false;

    const isStatsRelevant = () => {
      const path = location.pathname || '';
      if (path === '/watch' || path.startsWith('/shorts')) return true;
      return U.isChannelPage?.(location.href);
    };

    // Shared translation helper from YouTubeUtils
    const escapeHtml = window.YouTubeSafeDOM?.escapeHTML || window.YouTubeUtils?.escapeHTML;

    let previousUrl = location.href;
    let isChecking = false;
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
      videoStatsCtx?.style('yp-video-stats-styles', getStatsStyles_('yp-video-stats-styles'));
    }

    let statsModalStylesAdded = false;

    /**
     * Inject the stats modal CSS right before the modal is inserted, so a
     * page that never opens it costs nothing for its rules.
     * @returns {void}
     */
    function ensureStatsModalStyles() {
      if (statsModalStylesAdded || !videoStatsCtx) return;
      statsModalStylesAdded = true;
      videoStatsCtx.style(
        'yp-video-stats-modal-styles',
        getStatsStyles_('yp-video-stats-modal-styles')
      );
    }

    /**
     * Validate if a string is a valid YouTube video ID
     * @param {string} id - Video ID to validate
     * @returns {boolean} True if valid
     */
    // Local validation; YouTubeSafeDOM.isValidVideoId is the primary implementation.
    const isValidVideoId = /** @type {(id: string | null) => boolean} */ (
      window.YouTubeSafeDOM?.isValidVideoId ||
        /** @type {(id: string | null) => boolean} */ (
          id => !!id && /^[a-zA-Z0-9_-]{11}$/.test(/** @type {string} */ (id))
        )
    );

    /**
     * Watch URL for a video ID taken from the current page.
     * @returns {string|null} Full YouTube watch URL or null
     */
    function getVideoIdFromParams() {
      const videoId = U.getVideoIdFromUrl(window.location.href);
      return isValidVideoId(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
    }

    /**
     * Shorts URL for a video ID taken from the given shorts URL.
     * @param {string} url - Current URL
     * @returns {string|null} Full YouTube shorts URL or null
     */
    function getVideoIdFromShorts(url) {
      const videoId = U.getVideoIdFromUrl(url);
      if (isValidVideoId(videoId)) {
        return `https://www.youtube.com/shorts/${videoId}`;
      }
      return null;
    }

    /**
     * Determine the current YouTube video URL from query params or shorts path
     * @returns {string|null} Full YouTube video/shorts URL or null
     */
    function getCurrentVideoUrl() {
      const url = window.location.href;

      // Validate the host is YouTube itself or a subdomain, not a look-alike.
      if (!/(^|\.)youtube\.com$/.test(window.location.hostname || '')) {
        return null;
      }

      // Shorts pages keep the /shorts/ form; everything else uses ?v=
      if ((window.location.pathname || '').startsWith('/shorts/')) {
        return getVideoIdFromShorts(url);
      }

      return getVideoIdFromParams();
    }

    /**
     * Get channel identifier with validation
     * @returns {string} Channel identifier
     */
    function getChannelIdentifier() {
      const url = window.location.href;
      let identifier = '';

      if (url.includes('/channel/')) {
        identifier = url.split('/channel/')[1]?.split('/')[0] || '';
      } else if (url.includes('/@')) {
        identifier = url.split('/@')[1]?.split('/')[0] || '';
      }

      // Validate identifier (alphanumeric, dashes, underscores)
      if (identifier && /^[a-zA-Z0-9_-]+$/.test(identifier)) {
        return identifier;
      }

      return '';
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
        logS(error);
        U.logError?.('Stats', 'Invalid URL for channel check', error);
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
        logS(_e);
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
        logS(error);
        if (error instanceof Error && error.name === 'AbortError') {
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
        logS(parseError);
        U.logError?.('Stats', 'Failed to parse ytInitialData', parseError);
        return null;
      }
    }

    /**
     * Extract tab URL from tab renderer
     * @param {ChannelTabRenderer} tab - Tab object
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
     * @param {ChannelFeatureFlags} flags - Flags object with hasStreams and hasShorts
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
        logS(error);
        U.logError?.('Stats', 'Channel tab check failed', error);
      } finally {
        isChecking = false;
      }
    }

    /**
     * Check for URL changes with debouncing
     */
    const runUrlChangeCheck = () => {
      const currentUrl = location.href;
      if (currentUrl !== previousUrl) {
        previousUrl = currentUrl;
        checkAndInsertIcon();
        if (U.isChannelPage?.(currentUrl)) {
          setTimeout(() => checkChannelTabs(currentUrl), 500);
        }
      }
    };

    const checkUrlChange = U.debounce(runUrlChangeCheck, 300);

    function createStatsIcon() {
      const icon = document.createElement('button');
      icon.type = 'button';
      // universal icon matching YouTube player buttons
      icon.className = 'ytp-button videoStats yp-stats-button';
      icon.id = STATS_ICON_ID;
      icon.setAttribute('data-yp-stats-icon', 'true');
      icon.setAttribute('title', U.t?.('videoStats') || 'Video Stats');
      icon.setAttribute('aria-label', U.t?.('videoStats') || 'Video Stats');
      _setSafeHTML(icon, BAR_CHART_ICON_SVG);

      window.YouTubePlusCleanupManager?.registerListener?.(
        icon,
        'click',
        e => {
          e.preventDefault();
          e.stopPropagation();
          const videoUrl = getCurrentVideoUrl();
          if (videoUrl) {
            const videoId = U.getVideoIdFromUrl(videoUrl);
            if (videoId) {
              openStatsModal('video', videoId);
            }
          }
        },
        undefined,
        false
      );

      return icon;
    }

    /**
     * Find target container for stats button
     * @returns {Element|null}
     */
    function findStatsMountTarget() {
      const isShorts = (window.location.pathname || '').startsWith('/shorts');
      if (isShorts) {
        const dlBtn = document.querySelector('.yp-shorts-download');
        if (dlBtn?.parentElement) return dlBtn.parentElement;
        const activeReel =
          document.querySelector('ytd-reel-video-renderer[is-active]') ||
          document.querySelector('ytd-reel-video-renderer[is-active="true"]') ||
          document.querySelector('#shorts-player ytd-reel-video-renderer');
        const root = /** @type {ParentNode} */ (activeReel || document);
        const likeEl = root.querySelector(
          'like-button-view-model, #like-button, button[aria-label*="Like" i]:not([aria-label*="Dislike" i]):not(.yp-shorts-dislike-btn), button[aria-label*="Нравится" i]:not([aria-label*="Не нравится" i])'
        );
        const likeAnchor =
          likeEl?.closest?.(
            'like-button-view-model, #like-button, reel-action-view-model, ytw-reel-action-view-model, [class*="ReelActionViewModel"]'
          ) || likeEl;
        if (likeAnchor?.parentElement) return likeAnchor.parentElement;
        return root.querySelector(
          'ytwReelActionBarViewModelHostDesktop, ytwReelActionBarViewModelHost, [class*="ytwReelActionBarViewModelHost"], reel-action-bar-view-model, ytd-reel-player-overlay-renderer #actions, #actions'
        );
      }

      const controls = $('.ytp-right-controls');
      const isWatch = window.YouTubeUtils?.isWatchPage?.(window.location.href) ?? false;
      if (controls && isWatch) return controls;

      return null;
    }

    /**
     * Disconnect a stats node's tracked listeners/observers before removing it.
     * @param {Element | null | undefined} el
     */
    function removeStatsNode_(el) {
      if (!el) return;
      window.YouTubePlusCleanupManager?.disconnectForElement?.(el);
      el.remove();
    }

    function clearStatsIcons_() {
      document.querySelectorAll(STATS_ICON_SELECTOR).forEach(removeStatsNode_);
    }

    /**
     * @param {NodeListOf<Element> | Element[]} existingIcons
     * @param {Element | null} keepIcon
     */
    function removeDuplicateStatsIcons_(existingIcons, keepIcon) {
      if (existingIcons.length <= 1) return;
      existingIcons.forEach(icon => {
        if (icon !== keepIcon) {
          removeStatsNode_(icon);
        }
      });
    }

    /**
     * @param {Element} statsIcon
     * @param {Element} target
     * @param {boolean} isShorts
     */
    function positionStatsIcon_(statsIcon, target, isShorts) {
      if (isShorts) {
        const dlBtn = target.querySelector('.yp-shorts-download');
        if (dlBtn) {
          if (dlBtn.nextElementSibling !== statsIcon) {
            dlBtn.insertAdjacentElement('afterend', statsIcon);
          }
          return;
        }
      }
      if (statsIcon.parentNode !== target) {
        target.insertBefore(statsIcon, target.firstChild);
      }
    }

    /**
     * Insert the universal stats icon into player controls or Shorts action bar
     * @returns {void}
     */
    function insertUniversalIcon() {
      if (!statsButtonEnabled) return;

      const target = findStatsMountTarget();
      if (!target) {
        clearStatsIcons_();
        return;
      }

      if (
        window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision' &&
        target.classList.contains('ytp-right-controls')
      ) {
        clearStatsIcons_();
        return;
      }

      const existingIcons = Array.from(document.querySelectorAll(STATS_ICON_SELECTOR));
      let statsIcon = /** @type {HTMLElement | null} */ (document.getElementById(STATS_ICON_ID));
      if (!statsIcon && existingIcons.length > 0) {
        statsIcon = /** @type {HTMLElement} */ (existingIcons[0]);
      }
      removeDuplicateStatsIcons_(existingIcons, statsIcon);

      if (!statsIcon) {
        statsIcon = createStatsIcon();
      }
      const isShorts = (window.location.pathname || '').startsWith('/shorts');
      statsIcon.id = STATS_ICON_ID;
      statsIcon.className = isShorts
        ? 'shortsStats yp-stats-button'
        : 'ytp-button videoStats yp-stats-button';
      statsIcon.setAttribute('data-yp-stats-icon', 'true');

      positionStatsIcon_(statsIcon, target, isShorts);
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
      button.classList.add('yp-stats-btn');

      window.YouTubePlusCleanupManager?.registerListener?.(
        button,
        'click',
        (/** @type {MouseEvent} */ e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        },
        undefined,
        false
      );

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', viewBox);
      svg.classList.add('yp-stats-icon');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', svgPath);
      svg.appendChild(path);

      const buttonText = document.createElement('div');
      buttonText.className = `yt-spec-button-shape-next__button-text-content ${className}-text`;
      buttonText.textContent = text;
      buttonText.classList.add('yp-stats-btn-text');

      const touchFeedback = createTouchFeedbackShape_();
      touchFeedback.classList.add('yp-stats-touch-feedback');

      button.appendChild(svg);
      button.appendChild(buttonText);
      button.appendChild(touchFeedback);
      buttonViewModel.appendChild(button);

      return buttonViewModel;
    }

    /**
     * InnerTube API configuration.
     *
     * The InnerTube key is YouTube's public web-player API key, published by the
     * page window in `ytcfg`. It is read from there at runtime; when the page
     * does not expose it (or uses a different config shape) the InnerTube calls
     * are skipped instead of shipping a hardcoded key in the bundle.
     */

    /**
     * Resolve the InnerTube API key from YouTube's runtime config.
     * @returns {string} InnerTube API key, or an empty string when unavailable
     */
    function getInnerTubeApiKey() {
      try {
        // Read `ytcfg` from the PAGE window: the sandbox `window` does not
        // carry YouTube's page globals (same reason extractViews reads
        // `ytInitialPlayerResponse` through getPageGlobal()).
        const page = getPageGlobal();
        const cfg = page.ytcfg;
        if (cfg && typeof cfg.get === 'function') {
          const k = cfg.get('INNERTUBE_API_KEY');
          if (k && typeof k === 'string') return k;
        }
        if (cfg?.data_?.INNERTUBE_API_KEY) {
          return /** @type {string} */ (cfg.data_.INNERTUBE_API_KEY);
        }
        if (page.yt?.config_?.INNERTUBE_API_KEY) {
          return /** @type {string} */ (page.yt.config_.INNERTUBE_API_KEY);
        }
      } catch (_e) {
        logS(_e);
      }
      return '';
    }

    const INNERTUBE_CLIENT_VERSION_FALLBACK = '2.20250312.01.00';

    /**
     * Get the current InnerTube client version dynamically from YouTube's config,
     * falling back to a hardcoded value if runtime extraction fails.
     * @returns {string} InnerTube client version
     */
    function getInnerTubeClientVersion() {
      try {
        // Try to extract from YouTube's runtime config (PAGE window).
        const page = getPageGlobal();
        const cfg = page.ytcfg;
        if (cfg && typeof cfg.get === 'function') {
          const version = cfg.get('INNERTUBE_CLIENT_VERSION');
          if (version && typeof version === 'string') return version;
        }
        // Try ytcfg.data_ directly
        if (cfg?.data_?.INNERTUBE_CLIENT_VERSION) {
          return /** @type {string} */ (cfg.data_.INNERTUBE_CLIENT_VERSION);
        }
        // Try yt.config_
        if (page.yt?.config_?.INNERTUBE_CLIENT_VERSION) {
          return /** @type {string} */ (page.yt.config_.INNERTUBE_CLIENT_VERSION);
        }
      } catch (_e) {
        logS(_e);
        // Extraction failed, use fallback
      }
      return INNERTUBE_CLIENT_VERSION_FALLBACK;
    }

    /**
     * Fetch video stats from InnerTube API (more complete data)
     * @param {string} videoId - Video ID
     * @returns {Promise<VideoStatsData|null>} Video stats with views, likes, country, monetization
     */
    /**
     * Create InnerTube API request body
     * @param {string} videoId - Video ID
     * @returns {InnerTubeRequestBody} Request body
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
     * @param {InnerTubeRequestBody} body - Request body
     * @returns {InnerTubeFetchOptions} Fetch options
     */
    function createInnerTubeFetchOptions(body) {
      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-YouTube-Client-Name': '1',
          'X-YouTube-Client-Version': getInnerTubeClientVersion(),
        },
        body: JSON.stringify(body),
      };
    }

    /**
     * Extract best thumbnail URL from details
     * @param {PlayerResponseData['videoDetails']} details - Video details
     * @returns {string|null} Thumbnail URL
     */
    function extractThumbnailUrl(details) {
      const thumbnails = details?.thumbnail?.thumbnails;
      return thumbnails?.[thumbnails.length - 1]?.url || null;
    }

    /**
     * Parse video stats from InnerTube response
     * @param {PlayerResponseData} data - InnerTube response data
     * @returns {VideoStatsData} Parsed video stats
     */
    function parseVideoStatsFromResponse(data) {
      const details = data?.videoDetails || {};
      const microformat = data?.microformat?.playerMicroformatRenderer || {};

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
     * Depth-first search through an InnerTube response graph, returning the
     * first value its `pick` selector resolves from a visited node. Modern
     * channel pages reach the About panel (creator country) through a header
     * continuation token instead of exposing the country in the header.
     * @param {unknown} root
     * @param {(record: Record<string, unknown>) => string | null} pick
     * @returns {string|null}
     */
    function findInResponseGraph_(root, pick) {
      /** @type {unknown[]} */
      const stack = [root];
      const seen = new WeakSet();
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        const record = /** @type {Record<string, unknown>} */ (node);
        const hit = pick(record);
        if (hit) return hit;
        for (const key of Object.keys(record)) stack.push(record[key]);
      }
      return null;
    }

    /**
     * Fetch the channel creator's country from InnerTube browse API
     * @param {string} channelId - YouTube channel ID (UCxxxx)
     * @returns {Promise<string|null>} Country code/name or null
     */
    async function fetchChannelCountryFromInnerTube(channelId) {
      if (!channelId) return null;
      try {
        const apiKey = getInnerTubeApiKey();
        if (!apiKey) return null;
        const url = `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`;
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
        const response = await fetchWithDeadline_(url, createInnerTubeFetchOptions(body), 10000);
        if (!response.ok) return null;
        const data = await response.json();
        // Try multiple header paths: YouTube returns c4TabbedHeaderRenderer for
        // older-UI channels and pageHeaderRenderer for newer-UI channels.
        // Also check frameworkUpdates mutations for new-UI country metadata.
        const country =
          data?.header?.c4TabbedHeaderRenderer?.country ||
          data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.find?.(
            (/** @type {{ text?: { content?: string } } | undefined} */ p) =>
              p?.text?.content?.length === 2
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
        if (country) return country;

        // Modern channel pages omit the creator country from the header. It
        // lives in the About panel, reached through a continuation token
        // embedded in the header.
        const continuationToken = findInResponseGraph_(data?.header, record => {
          const command = record.continuationCommand;
          if (command && typeof command === 'object') {
            const token = /** @type {Record<string, unknown>} */ (command).token;
            if (typeof token === 'string' && token) return token;
          }
          return null;
        });
        if (!continuationToken) return null;
        const aboutResponse = await fetchWithDeadline_(
          url,
          createInnerTubeFetchOptions({ context: body.context, continuation: continuationToken }),
          10000
        );
        if (!aboutResponse.ok) return null;
        return findInResponseGraph_(await aboutResponse.json(), record => {
          const about = record.aboutChannelViewModel;
          if (about && typeof about === 'object') {
            const country = /** @type {Record<string, unknown>} */ (about).country;
            if (typeof country === 'string' && country) return country;
          }
          return null;
        });
      } catch (_e) {
        logS(_e);
        return null;
      }
    }

    /**
     * Fetch video stats from InnerTube API
     * @param {string} videoId - Video ID
     * @returns {Promise<VideoStatsData|null>} Video stats or null
     */
    async function fetchVideoStatsInnerTube(videoId) {
      if (!videoId) return null;

      try {
        const apiKey = getInnerTubeApiKey();
        if (!apiKey) {
          window.YouTubePlusLogger?.warn?.(
            'Stats',
            'InnerTube API key is unavailable from ytcfg; skipping the stats request'
          );
          return null;
        }
        const url = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`;
        const response = await fetchWithDeadline_(
          url,
          createInnerTubeFetchOptions(createInnerTubeRequestBody(videoId)),
          10000
        );

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
        logS(error);
        window.YouTubePlusLogger?.error?.('Stats', 'InnerTube fetch error:', error);
        return null;
      }
    }

    /**
     * Fetch video or channel stats from API (combines InnerTube + RYD)
     * @param {string} type - 'video' or 'channel'
     * @param {string} id - Video ID or Channel ID
     * @returns {Promise<{ ok: boolean, status: number, data: VideoStatsData | LivecountsChannelStats | null, url?: string }>} Stats data or null on error
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
        const response = await fetchWithDeadline_(
          endpoint,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
            },
          },
          10000
        );

        if (!response.ok) {
          window.YouTubePlusLogger?.warn?.(
            'Stats',
            `Failed to fetch ${type} stats:`,
            response.status
          );
          return {
            ok: false,
            status: response.status,
            data: null,
            url: endpoint,
          };
        }

        const data = await response.json();
        if (!numbersAreValidCounts_(data)) {
          // A malformed counter payload is a failed request, not a partial result.
          return { ok: false, status: response.status, data: null, url: endpoint };
        }
        return { ok: true, status: response.status, data, url: endpoint };
      } catch (error) {
        logS(error);
        U.logError?.('Stats', `Failed to fetch ${type} stats`, error);
        return { ok: false, status: 0, data: null };
      }
    }

    /**
     * Attempt to read basic video stats from the current page DOM as a fallback
     * Returns an object with views, likes, comments, subscribers when available
     */
    /**
     * @param {PlayerResponseData['videoDetails'] | null | undefined} details
     * @param {string|null} currentVideoId
     * @returns {number|null}
     */
    function extractViewsFromDetails_(details, currentVideoId) {
      if (!isOwnVideoDetails_(details, currentVideoId)) return null;
      const count = Number(details?.viewCount);
      return Number.isFinite(count) ? count : null;
    }

    /**
     * @param {(Window & typeof globalThis & { ytInitialPlayerResponse?: PlayerResponseData }) | null | undefined} pageGlobal
     * @param {string|null} currentVideoId
     * @returns {number|null}
     */
    function extractViewsFromPlayer_(pageGlobal, currentVideoId) {
      const doc = pageGlobal?.document || document;
      const playerEl = /** @type {(HTMLElement & { wrappedJSObject?: unknown }) | null} */ (
        doc.getElementById?.('movie_player') || document.getElementById('movie_player')
      );
      const livePlayer =
        /** @type {(HTMLElement & { getPlayerResponse?: () => PlayerResponseData | null | undefined }) | null} */ (
          playerEl?.wrappedJSObject || playerEl
        );
      let liveDetails = null;
      try {
        liveDetails = livePlayer?.getPlayerResponse?.()?.videoDetails;
      } catch (_e) {
        // page player object denied or not ready (cross-context access)
        logS(_e);
      }
      const liveViews = extractViewsFromDetails_(liveDetails, currentVideoId);
      if (liveViews != null) return liveViews;

      const initialDetails = pageGlobal?.ytInitialPlayerResponse?.videoDetails;
      return extractViewsFromDetails_(initialDetails, currentVideoId);
    }

    /**
     * Get video stats from current page DOM
     * Refactored to use helper functions and reduce complexity
     * @returns {PageStatsData|null} Stats object or null
     */
    function getPageVideoStats() {
      // Extraction is DOM-based, with exact numbers taken from the player response when available.
      const fallbackHelpers = {
        extractViews() {
          const currentVideoId = U.getVideoIdFromLocation?.();
          const viewsFromPlayer = extractViewsFromPlayer_(getPageGlobal(), currentVideoId);
          if (viewsFromPlayer != null) return { views: viewsFromPlayer };

          const el = $('yt-view-count-renderer, #count .view-count');
          const text = el?.textContent ? el.textContent.trim() : '';
          const views = parseLocalizedCount_(text);
          return views == null ? {} : { views };
        },
        extractLikes() {
          const btn =
            $('like-button-view-model button[aria-label]') ||
            $('#segmented-like-button button[aria-label]') ||
            $('ytd-toggle-button-renderer button[aria-label]') ||
            $('ytd-toggle-button-renderer[is-icon-button] yt-formatted-string') ||
            $(
              '#top-level-buttons-computed ytd-toggle-button-renderer:first-child yt-formatted-string'
            );
          const label = btn?.getAttribute?.('aria-label') || '';
          const exact = extractLargestInteger_(label);
          if (exact != null) return { likes: exact };
          const text = btn?.textContent ? btn.textContent.trim() : '';
          const likes = parseLocalizedCount_(text);
          return likes == null ? {} : { likes };
        },
        extractDislikes() {
          return {};
        },
        extractComments() {
          const el = $('#count > ytd-comment-thread-renderer, ytd-comments-header-renderer #count');
          const text = el?.textContent ? el.textContent.trim() : '';
          const comments = parseLocalizedCount_(text);
          return comments == null ? {} : { comments };
        },
        extractSubscribers() {
          const el = $('#owner-sub-count, #subscriber-count');
          const text = el?.textContent ? el.textContent.trim() : '';
          return text ? { subscribers: text } : {};
        },
        extractThumbnail() {
          const meta = /** @type {{ href?: string, content?: string } | null} */ (
            $('link[rel="image_src"]') || $('meta[property="og:image"]')
          );
          const url = meta && (meta.href || meta.content) ? meta.href || meta.content : null;
          return url ? { thumbnail: url } : {};
        },
        extractTitle() {
          const el = $('h1.title yt-formatted-string') || $('h1');
          const text = el?.textContent ? el.textContent.trim() : '';
          return text ? { title: text } : {};
        },
        extractAuthor() {
          const handleEl =
            $('ytd-video-owner-renderer #channel-handle') ||
            $('ytd-video-owner-renderer yt-formatted-string.ytd-channel-name a') ||
            $('#owner ytd-channel-name a') ||
            $('ytd-video-owner-renderer #owner-name a');
          const handleText = handleEl?.textContent?.trim() || '';
          const handle = handleText.startsWith('@') ? handleText : null;
          const nameEl =
            $('ytd-video-owner-renderer #channel-name') ||
            $('ytd-video-owner-renderer #owner-name');
          const authorName = nameEl?.textContent?.trim() || null;
          if (handle || authorName) {
            return { authorHandle: handle, author: authorName };
          }
          return {};
        },
      };

      const result = Object.assign(
        {},
        fallbackHelpers.extractViews(),
        fallbackHelpers.extractLikes(),
        fallbackHelpers.extractDislikes(),
        fallbackHelpers.extractComments(),
        fallbackHelpers.extractSubscribers(),
        fallbackHelpers.extractThumbnail(),
        fallbackHelpers.extractTitle(),
        fallbackHelpers.extractAuthor()
      );

      return Object.keys(result).length > 0 ? result : null;
    }

    /**
     * Core stats card renderer: assembles icon, label, value and exact into one HTML structure.
     * @param {string} iconHtml - Complete icon div HTML or empty string
     * @param {string} labelHtml - Label div HTML or empty string
     * @param {string} valueHtml - Value div HTML or empty string
     * @param {string} exactHtml - Exact div HTML or empty string
     * @returns {string} Complete stats-card HTML fragment
     * @private
     */
    function _buildStatCard(iconHtml, labelHtml, valueHtml, exactHtml) {
      return `
        <div class="stats-card">
          ${iconHtml}
          <div class="stats-info">
            ${labelHtml}
            ${valueHtml}
            ${exactHtml}
          </div>
        </div>
      `;
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
      const iconHtml = `<div class="stats-icon ${iconClass}">${iconSvg}</div>`;
      const labelHtml = `<div class="stats-label">${t(labelKey)}</div>`;
      const valueHtml = `<div class="stats-value">${formatNumber(Number(value))}</div>`;
      const exactHtml = `<div class="stats-exact">${(value || 0).toLocaleString()}</div>`;
      return _buildStatCard(iconHtml, labelHtml, valueHtml, exactHtml);
    }

    /**
     * @param {boolean} showValue
     * @param {unknown} value
     * @returns {string}
     */
    function resolveCardDisplayVal_(showValue, value) {
      if (!showValue) return '';
      return value == null ? t('unknown') : String(value);
    }

    /**
     * @param {boolean} showIcon
     * @param {string} iconOrClass
     * @returns {{ iconContent: string, extraClass: string }}
     */
    function resolveCardIconParts_(showIcon, iconOrClass) {
      if (!showIcon || typeof iconOrClass !== 'string' || !iconOrClass) {
        return { iconContent: '', extraClass: '' };
      }
      if (iconOrClass.includes('<')) {
        return { iconContent: iconOrClass, extraClass: '' };
      }
      return { iconContent: '', extraClass: ` ${iconOrClass}` };
    }

    /**
     * Build a minimal stats card that displays only a value and/or icon
     * @param {unknown} value - Value to display
     * @param {string} [iconOrClass=''] - SVG markup or a CSS class name
     * @param {{showValue: boolean, showIcon: boolean}} [options] - Display options
     * @returns {string} HTML fragment or empty string
     * @private
     */
    function buildValueOnlyCard(
      /** @type {unknown} */ value,
      /** @type {string} */ iconOrClass = '',
      /** @type {{showValue: boolean, showIcon: boolean}} */ options = {
        showValue: true,
        showIcon: true,
      }
    ) {
      const showValue = Boolean(options?.showValue);
      const showIcon = Boolean(options?.showIcon);
      if (!(showValue || showIcon)) return '';

      const displayVal = resolveCardDisplayVal_(showValue, value);
      const { iconContent, extraClass } = resolveCardIconParts_(showIcon, iconOrClass);

      const iconHtml = `<div class="stats-icon${extraClass}">${iconContent}</div>`;
      const valueHtml = showValue ? `<div class="stats-value">${displayVal}</div>` : '';
      return _buildStatCard(iconHtml, '', valueHtml, '');
    }

    /**
     * Build stat cards for all metrics
     * @param {PageStatsData} pageStats - Page statistics
     * @returns {Array<string>} Array of card HTML strings
     * @private
     */
    /** Shared globe artwork for country meta cards. */
    const GLOBE_ICON_SVG =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';

    // Shared stat-card icon artwork (single set reused by page + video cards).
    const STAT_ICON_SVGS = {
      views:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
      likes:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>',
      dislikes:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg>',
      comments:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    };

    function buildStatCards(/** @type {PageStatsData} */ pageStats) {
      const cardConfigs = [
        {
          value: pageStats.views,
          key: 'views',
          icon: 'stats-icon-views',
          svg: STAT_ICON_SVGS.views,
        },
        {
          value: pageStats.likes,
          key: 'likes',
          icon: 'stats-icon-likes',
          svg: STAT_ICON_SVGS.likes,
        },
        {
          value: pageStats.dislikes,
          key: 'dislikes',
          icon: 'stats-icon-dislikes',
          svg: STAT_ICON_SVGS.dislikes,
        },
        {
          value: pageStats.comments,
          key: 'comments',
          icon: 'stats-icon-comments',
          svg: STAT_ICON_SVGS.comments,
        },
      ];

      return cardConfigs
        .map(config => buildPageStatCard(config.value, config.key, config.icon, config.svg))
        .filter(card => card);
    }

    // getThumbnailUrl is defined once below (after getFirstAvailableField): the
    // active signature is (stats, id).

    /**
     * Build extra metadata cards
     * @param {ExtraMetadata} extras - Extra metadata
     * @returns {string} HTML for extra cards
     * @private
     */
    function buildExtraCards(/** @type {ExtraMetadata} */ extras) {
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
     * @param {ExtraMetadata} extras - Extra metadata
     * @returns {string} Complete HTML
     * @private
     */
    function buildThumbnailLayout(
      /** @type {string} */ titleHtml,
      /** @type {string} */ thumbUrl,
      /** @type {string} */ gridHtml,
      /** @type {ExtraMetadata} */ extras
    ) {
      const extraCards = buildExtraCards(extras);
      const leftHtml = `<div class="stats-thumb-left"><img class="stats-thumb-img" src="${thumbUrl}" alt="thumbnail"><div class="stats-thumb-extras">${extraCards}</div></div>`;
      return `${titleHtml}<div class="stats-thumb-row">${leftHtml}${gridHtml}</div>`;
    }

    /**
     * Render page statistics fallback view
     * @param {HTMLElement} container - Container element
     * @param {PageStatsData} pageStats - Page statistics
     * @param {string} id - Video ID
     */
    function renderPageFallback(
      /** @type {HTMLElement} */ container,
      /** @type {PageStatsData} */ pageStats,
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

      // getThumbnailUrl signature is (stats, id): pass pageStats first, id second.
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
     * @param {number|string|null} [exact]
     * @param {string} [iconClass]
     * @param {string} [iconSvg]
     * @returns {string}
     */
    function makeStatsCard(labelKey, value, exact = null, iconClass = '', iconSvg = '') {
      const display = value == null ? t('unknown') : formatNumber(value);
      let exactText = '—';
      if (exact !== null && exact !== undefined) {
        const numExact = Number(exact);
        exactText = !Number.isNaN(numExact) ? Math.floor(numExact).toLocaleString() : String(exact);
      }
      const iconHtml = `<div class="stats-icon ${iconClass}">${iconSvg}</div>`;
      const labelHtml = `<div class="stats-label">${t(labelKey)}</div>`;
      const valueHtml = `<div class="stats-value">${display}</div>`;
      const exactHtml = `<div class="stats-exact">${exactText}</div>`;
      return _buildStatCard(iconHtml, labelHtml, valueHtml, exactHtml);
    }

    /**
     * Get first available field from stats object
     * @param {Record<string, unknown> | null | undefined} stats - Stats object
     * @param {string[]} fields - Field names to check
     * @returns {unknown} First available value or null
     */
    function getFirstAvailableField(
      /** @type {Record<string, unknown> | null | undefined} */ stats,
      /** @type {string[]} */ ...fields
    ) {
      for (const field of fields) {
        if (stats?.[field] != null) return stats[field];
      }
      return null;
    }

    /**
     * Get thumbnail URL for video
     * @param {Record<string, unknown> | null | undefined} stats - Stats object
     * @param {string} id - Video ID
     * @returns {string} Thumbnail URL
     */
    function getThumbnailUrl(
      /** @type {Record<string, unknown> | null | undefined} */ stats,
      /** @type {string} */ id
    ) {
      const raw = typeof stats?.thumbnail === 'string' ? stats.thumbnail : null;
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
          logS(_e);
          // Invalid URL - fall through to constructed URL
        }
      }
      return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
    }

    /**
     * Extract video fields from stats object
     * @param {Record<string, unknown> | null | undefined} stats - Stats data
     * @param {string} id - Video ID
     * @returns {ExtractedVideoFields} Extracted fields
     */
    function extractVideoFields(
      /** @type {Record<string, unknown> | null | undefined} */ stats,
      /** @type {string} */ id
    ) {
      return {
        views: /** @type {number | string | null} */ (
          getFirstAvailableField(stats, 'liveViews', 'views', 'viewCount')
        ),
        likes: /** @type {number | string | null} */ (
          getFirstAvailableField(stats, 'liveLikes', 'likes', 'likeCount')
        ),
        dislikes: /** @type {number | string | null} */ (
          getFirstAvailableField(stats, 'dislikes', 'liveDislikes', 'dislikeCount')
        ),
        comments: /** @type {number | string | null} */ (
          getFirstAvailableField(stats, 'liveComments', 'comments', 'commentCount')
        ),
        liveViewer: /** @type {number | string | null} */ (
          getFirstAvailableField(stats, 'liveViewer', 'live_viewers')
        ),
        title: (typeof stats?.title === 'string' && stats.title) || document.title || '',
        thumbUrl: getThumbnailUrl(stats, id),
        country: /** @type {string | null} */ (getFirstAvailableField(stats, 'country')),
        monetized: typeof stats?.monetized === 'boolean' ? stats.monetized : null,
        duration: /** @type {string | number | null} */ (getFirstAvailableField(stats, 'duration')),
        author: /** @type {string | null} */ (getFirstAvailableField(stats, 'author')),
        authorHandle: /** @type {string | null} */ (getFirstAvailableField(stats, 'authorHandle')),
      };
    }

    /**
     * Merge API-provided video stats with page-derived stats
     * Simplified to use helper function for field extraction
     * @param {VideoStatsData|null|undefined} apiStats - API stats
     * @param {PageStatsData|null|undefined} pageStats - Page stats
     * @returns {VideoStatsData} Merged stats
     */
    function mergeVideoStats(
      /** @type {VideoStatsData|null|undefined} */ apiStats,
      /** @type {PageStatsData|null|undefined} */ pageStats
    ) {
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
        views: /** @type {number | null} */ (getValue('views', 'viewCount')),
        likes: /** @type {number | null} */ (getValue('likes', 'likeCount')),
        dislikes: /** @type {number | null} */ (getValue('dislikes')),
        comments: /** @type {number | null} */ (getValue('comments', 'commentCount')),
        thumbnail: /** @type {string | null} */ (getValue('thumbnail')),
        title: /** @type {string | undefined} */ (getValue('title')),
        liveViewer: /** @type {number | string | null} */ (getValue('liveViewer')),
        // Preserve extra metadata when available (duration, country, monetization)
        duration: /** @type {string | number | null} */ (getValue('duration')),
        country: /** @type {string | null} */ (getValue('country')),
        monetized: /** @type {boolean | null} */ (
          getValue('monetized', 'isMonetized', 'monetization')
        ),
        author: /** @type {string | null} */ (getValue('author')),
        authorHandle: /** @type {string | null} */ (getValue('authorHandle')),
      };
    }

    /**
     * Extract extra metadata (duration, monetization, country) from API or page
     * @param {VideoStatsData|null|undefined} apiStats - API stats
     * @param {PageStatsData|null|undefined} pageStats - Page stats
     * @returns {ExtraMetadata} Metadata
     */
    function getVideoExtras(
      /** @type {VideoStatsData|null|undefined} */ apiStats,
      /** @type {PageStatsData|null|undefined} */ pageStats
    ) {
      // Metadata comes from the stats objects themselves.
      const rawDuration = apiStats?.duration ?? pageStats?.duration ?? null;
      const duration = rawDuration != null ? String(rawDuration) : null;
      const rawCountry = apiStats?.country ?? pageStats?.country ?? null;
      const country = rawCountry != null ? String(rawCountry) : null;

      // Monetization can be boolean or descriptive string
      let monetization = null;
      if (apiStats?.monetized != null) {
        monetization = apiStats.monetized === true ? t('yes') : t('no');
      } else if (pageStats?.monetized != null) {
        monetization = pageStats.monetized === true ? t('yes') : t('no');
      }

      return { duration, country, monetization };
    }

    /**
     * Shared close behavior for stats modal close buttons.
     * prefer the overlay's bound close fn, fall back to removing it.
     * @param {Event} e
     * @param {HTMLElement} overlay
     */
    const closeOverlayFromEvent = (e, overlay) => {
      e.preventDefault();
      e.stopPropagation();
      const closeFn = /** @type {HTMLElement & { _ytpCloseOverlay?: () => void }} */ (overlay)
        ._ytpCloseOverlay;
      if (typeof closeFn === 'function') closeFn();
      else overlay.remove();
    };

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
      closeBtn.className = 'stats-modal-close thumbnail-modal-action-btn yp-settings-close';
      closeBtn.setAttribute('data-shared-close-button', 'yp-close-settings');
      _setSafeHTML(
        closeBtn,
        `
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>
        `
      );
      closeBtn.title = t('closeButton') || t('close');
      closeBtn.setAttribute('aria-label', t('closeButton') || t('close'));
      window.YouTubePlusCleanupManager?.registerListener?.(
        closeBtn,
        'click',
        (/** @type {MouseEvent} */ e) => closeOverlayFromEvent(e, overlay),
        undefined,
        false
      );
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
      content.className = 'stats-modal-content yp-modal-content';

      // Classic Header (Concept B)
      const classicHeader = document.createElement('div');
      classicHeader.className = 'stats-classic-header';
      _setSafeHTML(
        classicHeader,
        `
        <div class="stats-classic-title-group">
          <div class="stats-classic-icon">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
          </div>
          <span class="stats-classic-title">${t('videoStats') || 'Video Analytics'}</span>
          <span class="stats-classic-channel-badge" id="stats-classic-channel-badge"></span>
        </div>
        <button class="stats-classic-close-btn" title="${t('closeButton') || t('close') || 'Close'}" aria-label="${t('closeButton') || t('close') || 'Close'}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      `
      );
      const classicCloseBtn = classicHeader.querySelector('.stats-classic-close-btn');
      if (classicCloseBtn) {
        window.YouTubePlusCleanupManager?.registerListener?.(
          classicCloseBtn,
          'click',
          (/** @type {Event} */ e) => closeOverlayFromEvent(e, overlay),
          undefined,
          false
        );
      }

      const body = document.createElement('div');
      body.className = 'stats-modal-body';
      body.appendChild(createLoadingSpinner());

      content.appendChild(classicHeader);
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
      // Store the element that had focus, for restoration.
      const previouslyFocused = document.activeElement;

      // Single AbortController for all modal listeners (esc/backdrop/buttons).
      // Aborting in any close path auto-removes every listener registered with
      // this signal, so no handler leaks regardless of how the modal closes.
      const modalController = new AbortController();
      const restoreFocus = () => {
        try {
          if (previouslyFocused) /** @type {HTMLElement} */ (previouslyFocused).focus();
        } catch (_e) {
          logS(_e);
        }
      };
      const closeOverlay = () => {
        overlay.remove();
        restoreFocus();
        modalController.abort();
      };

      // Expose closeOverlay on the overlay so close-button handlers can call it
      /** @type {HTMLElement & { _ytpCloseOverlay?: () => void }} */ (overlay)._ytpCloseOverlay =
        closeOverlay;

      // Close when clicking outside
      window.YouTubePlusCleanupManager?.registerListener?.(
        overlay,
        'click',
        (/** @type {MouseEvent} */ event) => {
          const { target } = event;
          if (target === overlay) closeOverlay();
        },
        undefined,
        false
      );

      // ESC to close
      window.YouTubePlusCleanupManager?.registerListener?.(
        window,
        'keydown',
        /** @param {KeyboardEvent} e */ e => {
          if (e.key === 'Escape') closeOverlay();
        },
        { capture: true, signal: modalController.signal },
        true
      );

      // Move focus into the modal after it's appended
      window.YouTubePlusCleanupManager?.registerAnimationFrame?.(
        requestAnimationFrame(() => {
          const focusTarget = overlay.querySelector('button, [tabindex="0"]');
          if (focusTarget) /** @type {HTMLElement} */ (focusTarget).focus();
        })
      );

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
            {
              selector: null,
              childList: true,
              attributes: false,
              subtree: true,
            }
          );
        }
      }
    }

    /**
     * Render error message in modal
     * @param {HTMLElement} body - Body element
     * @param {{ status?: number, url?: string } | null | undefined} result - Fetch result
     * @returns {void}
     */
    function renderErrorMessage(body, result) {
      const statusText = result?.status ? ` (${result.status})` : '';
      const endpointHint = result?.url ? `<div class="stats-result-url">${result.url}</div>` : '';
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
     * @param {{ status?: number, url?: string } | null | undefined} result - Fetch result
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
     * @param {VideoStatsData | LivecountsChannelStats | null} stats - Stats data
     * @param {string} id - Video/channel ID
     * @returns {void}
     */
    function displayStatsBasedOnType(body, type, stats, id) {
      if (type === 'video') {
        const pageStats = getPageVideoStats();
        const merged = mergeVideoStats(/** @type {VideoStatsData | null} */ (stats), pageStats);
        displayVideoStats(body, merged, id);
      } else {
        displayChannelStats(body, /** @type {Record<string, unknown>} */ (stats || {}));
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

      ensureStatsModalStyles();

      // Remove existing overlays
      $$('.stats-modal-overlay').forEach(el => el.remove());

      // Create modal structure
      const overlay = document.createElement('div');
      overlay.className = 'stats-modal-overlay yp-modal-overlay';

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
     * @param {VideoStatsData} stats - Stats data
     */
    /**
     * Get stat card definitions for video stats
     * @param {ExtractedVideoFields} fields - Extracted video fields
     * @returns {VideoStatCardDef[]} Card definitions
     */
    function getVideoStatDefinitions(fields) {
      const { views, likes, dislikes, comments } = fields;
      return [
        {
          label: 'views',
          value: typeof views === 'number' ? views : null,
          exact: typeof views === 'number' ? views : null,
          iconClass: 'stats-icon-views',
          iconSvg: STAT_ICON_SVGS.views,
        },
        {
          label: 'likes',
          value: typeof likes === 'number' ? likes : null,
          exact: typeof likes === 'number' ? likes : null,
          iconClass: 'stats-icon-likes',
          iconSvg: STAT_ICON_SVGS.likes,
        },
        {
          label: 'dislikes',
          value: typeof dislikes === 'number' ? dislikes : null,
          exact: typeof dislikes === 'number' ? dislikes : null,
          iconClass: 'stats-icon-dislikes',
          iconSvg: STAT_ICON_SVGS.dislikes,
        },
        {
          label: 'comments',
          value: typeof comments === 'number' ? comments : null,
          exact: typeof comments === 'number' ? comments : null,
          iconClass: 'stats-icon-comments',
          iconSvg: STAT_ICON_SVGS.comments,
        },
      ];
    }

    /**
     * Create live viewer stats card if available
     * @param {number | string | null | undefined} liveViewer - Live viewer count
     * @returns {string} HTML string or empty string
     */
    function createLiveViewerCard(liveViewer) {
      if (liveViewer === undefined || liveViewer === null) return '';
      const numViewer = typeof liveViewer === 'number' ? liveViewer : null;
      return makeStatsCard(
        'liveViewers',
        numViewer,
        numViewer,
        'stats-icon-viewers',
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`
      );
    }

    /**
     * Build a meta card HTML structure (icon + label + value)
     * @param {string} iconClass - CSS class for icon div
     * @param {string} iconContent - HTML content for icon (SVG or img)
     * @param {string} label - Card label text
     * @param {string} value - Card value text
     * @param {string} [extraIconAttrs=''] - Additional attributes for icon div (e.g., 'data-fallback-icon="globe"')
     * @returns {string} HTML string
     */
    function _buildMetaCard(iconClass, iconContent, label, value, extraIconAttrs = '') {
      const iconDiv = extraIconAttrs
        ? `<div class="stats-icon ${iconClass}" ${extraIconAttrs}>${iconContent}</div>`
        : `<div class="stats-icon ${iconClass}">${iconContent}</div>`;
      return `<div class="stats-card stats-card--compact">${iconDiv}<div class="stats-info"><div class="stats-label">${label}</div><div class="stats-value">${value}</div></div></div>`;
    }

    /**
     * Create monetization meta card
     * @param {ExtraMetadata} extras - Video extras
     * @param {VideoStatsData} [stats] - Stats object
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
      return _buildMetaCard(
        'stats-icon-subscribers',
        monIcon,
        t('monetization'),
        monetizationValue
      );
    }

    /**
     * Create country meta card with flag
     * @param {ExtraMetadata} extras - Video extras
     * @returns {string} HTML string
     */
    function createCountryCard(extras) {
      const countryValue = escapeHtml(extras.country || t('unknown'));
      // Country codes must be exactly 2 uppercase letters (ISO 3166-1 alpha-2)
      const rawCode =
        extras.country && extras.country !== t('unknown') ? extras.country.toUpperCase() : '';
      const countryCode = /^[A-Z]{2}$/.test(rawCode) ? rawCode : '';
      const globeIcon = GLOBE_ICON_SVG;

      if (countryCode) {
        const flagUrl = `https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.3.2/flags/4x3/${countryCode.toLowerCase()}.svg`;
        const flagImg = `<img class="country-flag" src="${flagUrl}" alt="${countryCode}" width="32" height="24"/>`;
        return _buildMetaCard(
          'stats-icon-views',
          flagImg,
          t('country'),
          countryCode,
          'data-fallback-icon="globe"'
        );
      }
      return _buildMetaCard('stats-icon-views', globeIcon, t('country'), countryValue);
    }

    /**
     * Create duration meta card
     * @param {ExtraMetadata} extras - Video extras
     * @returns {string} HTML string
     */
    /**
     * Zero-pad a number to two digits (helper for duration formatting).
     * @param {number} n
     * @returns {string}
     */
    function padTwo(/** @type {number} */ n) {
      return String(n).padStart(2, '0');
    }

    function secToHms(/** @type {number} */ sec) {
      sec = Math.max(0, Math.floor(Number(sec) || 0));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      if (h > 0) return `${h}:${padTwo(m)}:${padTwo(s)}`;
      return `${m}:${padTwo(s)}`;
    }

    function parseIso8601DurationToSeconds(/** @type {string} */ s) {
      const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(s);
      if (!match) return null;
      const [, hStr, mStr, sStr] = match;
      if (!(hStr || mStr || sStr)) return null;
      const h = hStr ? parseInt(hStr, 10) : 0;
      const m = mStr ? parseInt(mStr, 10) : 0;
      const sec = sStr ? parseInt(sStr, 10) : 0;
      return h * 3600 + m * 60 + sec;
    }

    function formatColonDuration(/** @type {string} */ s) {
      const colonParts = s.split(':');
      if (colonParts.length !== 2 && colonParts.length !== 3) return null;
      const allDigits = colonParts.every(part => part.length > 0 && /^\d+$/.test(part));
      if (!(allDigits && colonParts.slice(1).every(part => part.length <= 2))) return null;
      const parts = colonParts.map(p => {
        const trimmed = p.replace(/^0+/, '');
        return trimmed === '' ? '0' : trimmed;
      });
      if (parts.length === 2) {
        const [mm, ss] = parts;
        return `${Number(mm)}:${padTwo(Number(ss))}`;
      }
      const [hh, mm, ss] = parts;
      return `${Number(hh)}:${padTwo(Number(mm))}:${padTwo(Number(ss))}`;
    }

    function formatStringDuration(/** @type {string} */ s) {
      if (/^\d+$/.test(s)) return secToHms(Number(s));

      // ISO 8601 duration PT#H#M#S
      if (s.length > 2 && s[0].toUpperCase() === 'P' && s[1].toUpperCase() === 'T') {
        const total = parseIso8601DurationToSeconds(s);
        if (total !== null) return secToHms(total);
      }

      // Already colon formatted like M:SS or H:MM:SS
      const colon = formatColonDuration(s);
      if (colon) return colon;

      // fallback: return as-is (useful when API already provides formatted text)
      return s || null;
    }

    function formatDuration(/** @type {number|string|null|undefined} */ value) {
      if (value == null) return null;

      // number -> seconds
      if (typeof value === 'number' && Number.isFinite(value)) return secToHms(value);

      // numeric string
      if (typeof value === 'string') return formatStringDuration(value.trim());

      return null;
    }
    function createDurationCard(/** @type {ExtraMetadata} */ extras) {
      const raw = extras?.duration ?? null;
      const formatted = formatDuration(raw);
      const durationValue = formatted || (raw ? String(raw) : null) || t('unknown');
      const durationIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
      return _buildMetaCard('stats-icon-videos', durationIcon, t('duration'), durationValue);
    }

    /**
     * Build metadata cards HTML
     * @param {VideoStatsData} stats - Stats object
     * @param {ExtraMetadata} extras - Video extras
     * @returns {string} HTML string
     */
    function buildMetaCardsHtml(
      /** @type {VideoStatsData} */ stats,
      /** @type {ExtraMetadata} */ extras
    ) {
      const cards = [
        createMonetizationCard(extras, stats),
        createCountryCard(extras),
        createDurationCard(extras),
      ];
      return cards.filter(Boolean).join('');
    }

    /**
     * @param {VideoStatCardDef[]} defs
     * @param {string} label
     * @returns {string}
     */
    function buildCardFromDef_(defs, label) {
      const def = defs.find(d => d.label === label);
      if (!def) return '';
      return makeStatsCard(
        def.label,
        def.value ?? null,
        def.exact ?? null,
        def.iconClass,
        def.iconSvg
      );
    }

    /**
     * @param {VideoStatCardDef[]} defs
     * @param {number | string | null | undefined} liveViewer
     * @returns {string}
     */
    function buildMainStatsGridHtml_(defs, liveViewer) {
      const viewsHtml = buildCardFromDef_(defs, 'views');
      const likesHtml = buildCardFromDef_(defs, 'likes');
      const dislikesHtml = buildCardFromDef_(defs, 'dislikes');
      const commentsHtml = buildCardFromDef_(defs, 'comments');
      const pairHtml =
        likesHtml || dislikesHtml
          ? `<div class="stats-card-pair">${likesHtml}${dislikesHtml}</div>`
          : '';
      const parts = [viewsHtml, pairHtml, commentsHtml].filter(Boolean);
      const liveViewerCard = createLiveViewerCard(liveViewer);
      if (liveViewerCard) parts.push(liveViewerCard);
      return `<div class="stats-grid">${parts.join('')}</div>`;
    }

    /**
     * @param {unknown} author
     * @param {unknown} authorHandle
     * @returns {{ authorBigHtml: string, safeAuthor: string, safeHandle: string }}
     */
    function buildAuthorBigHtml_(author, authorHandle) {
      const safeAuthor = author ? escapeHtml(String(author)) : '';
      const safeHandle = authorHandle ? escapeHtml(String(authorHandle)) : '';
      if (!(safeHandle || safeAuthor)) return { authorBigHtml: '', safeAuthor, safeHandle };

      const inner = safeHandle
        ? `<a class="stats-author-handle-big" href="https://www.youtube.com/${encodeURIComponent(
            String(authorHandle)
          )}" target="_blank" rel="noopener noreferrer">${safeHandle}</a>`
        : `<span class="stats-author-name-big">${safeAuthor}</span>`;
      return {
        authorBigHtml: `<div class="stats-author-big">${inner}</div>`,
        safeAuthor,
        safeHandle,
      };
    }

    /**
     * @param {HTMLElement} container
     * @param {string} safeHandle
     * @param {string} safeAuthor
     */
    function updateClassicChannelBadge_(container, safeHandle, safeAuthor) {
      if (!(safeHandle || safeAuthor)) return;
      const badgeEl = container
        .closest('.stats-modal-content')
        ?.querySelector('#stats-classic-channel-badge');
      if (badgeEl) {
        badgeEl.textContent = safeHandle || `@${safeAuthor}`;
        /** @type {HTMLElement} */ (badgeEl).style.display = 'inline-block';
      }
    }

    /**
     * @param {ExtractedVideoFields} fields
     * @param {VideoStatsData} stats
     * @param {string} sideColumnHtml
     * @returns {string}
     */
    function buildVideoStatsLayoutHtml_(fields, stats, sideColumnHtml) {
      const { title, thumbUrl } = fields;
      const safeTitle = escapeHtml(title);
      const titleHtml = safeTitle
        ? `<div class="stats-thumb-title-centered">${safeTitle}</div>`
        : '';
      if (!thumbUrl) {
        return `${titleHtml}${sideColumnHtml}`;
      }
      const extras = getVideoExtras(stats, null);
      const metaCardsHtml = buildMetaCardsHtml(stats, extras);
      const metaExtrasHtml = metaCardsHtml
        ? `<div class="stats-thumb-extras stats-thumb-extras--wrap">${metaCardsHtml}</div>`
        : '';
      const leftHtml = `<div class="stats-thumb-left"><img class="stats-thumb-img" src="${thumbUrl}" alt="thumbnail">${metaExtrasHtml}</div>`;
      return `${titleHtml}<div class="stats-thumb-row">${leftHtml}${sideColumnHtml}</div>`;
    }

    /**
     * Display video statistics
     * @param {HTMLElement} container - Container element
     * @param {VideoStatsData} stats - Stats data
     * @param {string} id - Video ID
     */
    function displayVideoStats(container, stats, id) {
      const fields = extractVideoFields(stats, id);
      const { liveViewer, author, authorHandle } = fields;
      const defs = getVideoStatDefinitions(fields);

      const gridHtml = buildMainStatsGridHtml_(defs, liveViewer);
      const { authorBigHtml, safeAuthor, safeHandle } = buildAuthorBigHtml_(author, authorHandle);
      const sideColumnHtml = `<div class="stats-side-column">${gridHtml}${authorBigHtml}</div>`;

      _setSafeHTML(container, buildVideoStatsLayoutHtml_(fields, stats, sideColumnHtml));
      updateClassicChannelBadge_(container, safeHandle, safeAuthor);
      setupFlagImageErrorHandlers(container);
    }

    /**
     * Setup error handlers for country flag images to prevent XSS
     * @param {HTMLElement} container - Container element
     */
    function setupFlagImageErrorHandlers(container) {
      const flagImages = $$('.country-flag', container);
      const globeIcon = GLOBE_ICON_SVG;

      flagImages.forEach((/** @type {Element} */ img) => {
        window.YouTubePlusCleanupManager?.registerListener?.(
          img,
          'error',
          /** @this {HTMLImageElement} */
          function () {
            const iconContainer = /** @type {HTMLElement | null} */ (this.parentElement);
            if (iconContainer && iconContainer.dataset.fallbackIcon === 'globe') {
              this.style.display = 'none';
              _setSafeHTML(iconContainer, globeIcon);
            }
          },
          { once: true },
          false
        );
      });
    }

    /**
     * Display channel statistics
     * @param {HTMLElement} container - Container element
     * @param {LivecountsChannelStats | Record<string, unknown>} stats - Stats data
     */
    function displayChannelStats(container, stats) {
      const { liveSubscriber, liveViews, liveVideos } = /** @type {Record<string, number>} */ (
        stats
      );

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

    function createStatsMainButtonViewModel_() {
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
        '<svg viewBox="0 0 512 512" width="20" height="20" fill="currentColor"><path d="M500 89c13.8-11 16-31.2 5-45s-31.2-16-45-5L319.4 151.5 211.2 70.4c-11.7-8.8-27.8-8.5-39.2 .6L12 199c-13.8 11-16 31.2-5 45s31.2 16 45 5L192.6 136.5l108.2 81.1c11.7 8.8 27.8 8.5 39.2-.6L500 89zM160 256l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32zM32 352l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32zm288-64c-17.7 0-32 14.3-32 32l0 128c0 17.7 14.3 32 32 32s32-14.3 32-32l0-128c0-17.7-14.3-32-32-32zm96-32l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32z"/></svg>'
      );
      const svg = iconWrap.firstElementChild;

      const buttonText = document.createElement('div');
      buttonText.className = 'yt-spec-button-shape-next__button-text-content main-stats-text';
      buttonText.textContent = t('stats');
      if (buttonText.style) {
        buttonText.style.display = 'flex';
        buttonText.style.alignItems = 'center';
      }

      const touchFeedback = createTouchFeedbackShape_();
      if (touchFeedback.style) touchFeedback.style.borderRadius = 'inherit';

      if (svg) {
        mainButton.appendChild(svg);
      }
      mainButton.appendChild(buttonText);
      mainButton.appendChild(touchFeedback);
      mainButtonViewModel.appendChild(mainButton);
      return mainButtonViewModel;
    }

    /**
     * @param {string} label
     * @param {string} pathData
     * @param {string} viewBox
     * @param {string} className
     * @returns {HTMLElement}
     */
    function createStatsMenuButtonContainer_(label, pathData, viewBox, className) {
      const container = document.createElement('div');
      container.className = `stats-menu-button ${className}-container`;
      const btn = createButton(label, pathData, viewBox, className, () => {
        const channelId = getChannelIdentifier();
        if (channelId) {
          openStatsModal('channel', channelId);
        }
      });
      container.appendChild(btn);
      return container;
    }

    function createStatsHorizontalMenu_() {
      const horizontalMenu = document.createElement('div');
      horizontalMenu.className = 'stats-horizontal-menu';

      horizontalMenu.appendChild(
        createStatsMenuButtonContainer_(
          t('channel'),
          'M64 48c-8.8 0-16 7.2-16 16l0 288c0 8.8 7.2 16 16 16l512 0c8.8 0 16-7.2 16-16l0-288c0-8.8-7.2-16-16-16L64 48zM0 64C0 28.7 28.7 0 64 0L576 0c35.3 0 64 28.7 64 64l0 288c0 35.3-28.7 64-64 64L64 416c-35.3 0-64-28.7-64-64L0 64zM120 464l400 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-400 0c-13.3 0-24-10.7-24-24s10.7-24 24-24z',
          '0 0 640 512',
          'channel-stats'
        )
      );

      if (channelFeatures.hasStreams) {
        horizontalMenu.appendChild(
          createStatsMenuButtonContainer_(
            t('live'),
            'M99.8 69.4c10.2 8.4 11.6 23.6 3.2 33.8C68.6 144.7 48 197.9 48 256s20.6 111.3 55 152.8c8.4 10.2 7 25.3-3.2 33.8s-25.3 7-33.8-3.2C24.8 389.6 0 325.7 0 256S24.8 122.4 66 72.6c8.4-10.2 23.6-11.6 33.8-3.2zm376.5 0c10.2-8.4 25.3-7 33.8 3.2c41.2 49.8 66 113.8 66 183.4s-24.8 133.6-66 183.4c-8.4 10.2-23.6 11.6-33.8 3.2s-11.6-23.6-3.2-33.8c34.3-41.5 55-94.7 55-152.8s-20.6-111.3-55-152.8c-8.4-10.2-7-25.3 3.2-33.8zM248 256a40 40 0 1 1 80 0 40 40 0 1 1 -80 0zm-61.1-78.5C170 199.2 160 226.4 160 256s10 56.8 26.9 78.5c8.1 10.5 6.3 25.5-4.2 33.7s-25.5 6.3-33.7-4.2c-23.2-29.8-37-67.3-37-108s13.8-78.2 37-108c8.1-10.5 23.2-12.3 33.7-4.2s12.3 23.2 4.2 33.7zM427 148c23.2 29.8 37 67.3 37 108s-13.8 78.2-37 108c-8.1 10.5-23.2 12.3-33.7 4.2s-12.3-23.2-4.2-33.7C406 312.8 416 285.6 416 256s-10-56.8-26.9-78.5c-8.1-10.5-6.3-25.5 4.2-33.7s25.5-6.3 33.7 4.2z',
            '0 0 576 512',
            'live-stats'
          )
        );
      }

      if (channelFeatures.hasShorts) {
        horizontalMenu.appendChild(
          createStatsMenuButtonContainer_(
            t('shorts'),
            'M80 48c-8.8 0-16 7.2-16 16l0 384c0 8.8 7.2 16 16 16l224 0c8.8 0 16-7.2 16-16l0-384c0-8.8-7.2-16-16-16L80 48zM16 64C16 28.7 44.7 0 80 0L304 0c35.3 0 64 28.7 64 64l0 384c0 35.3-28.7 64-64 64L80 512c-35.3 0-64-28.7-64-64L16 64zM160 400l64 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-64 0c-8.8 0-16-7.2-16-16s7.2-16 16-16z',
            '0 0 384 512',
            'shorts-stats'
          )
        );
      }

      return horizontalMenu;
    }

    function resolveActionContainer_() {
      const modernContainer = /** @type {HTMLElement | null} */ (
        $('#owner #top-row #buttons, #top-row #owner #buttons, #buttons.ytd-video-owner-renderer')
      );
      if (modernContainer) return modernContainer;

      const joinButton = /** @type {HTMLElement | null} */ (
        $('.yt-flexible-actions-view-model-wiz__action:not(.stats-menu-container)')
      );
      if (joinButton?.parentElement) return joinButton.parentElement;

      return /** @type {HTMLElement | null} */ ($('#subscribe-button + #buttons'));
    }

    /**
     * Create and insert the stats horizontal menu below the video owner actions
     * @returns {HTMLElement|undefined} The inserted menu container or undefined
     */
    function createStatsMenu() {
      if (!statsButtonEnabled || $('.stats-menu-container')) return undefined;

      const containerDiv = document.createElement('div');
      containerDiv.className = 'yt-flexible-actions-view-model-wiz__action stats-menu-container';
      containerDiv.appendChild(createStatsMainButtonViewModel_());
      containerDiv.appendChild(createStatsHorizontalMenu_());

      const actionContainer = resolveActionContainer_();
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
      addStyles();
      insertUniversalIcon();
    }

    /**
     * Initialize the video stats module: channel-tab analysis only. Styles,
     * icon, menu and navigation listeners are acquired through the feature's
     * context on each route entry.
     * @returns {void}
     */
    function init() {
      if (U.isStudioPage?.()) return;
      if (U.isChannelPage?.(location.href)) {
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
          logS(e);
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

    const handleNavigate = () => {
      scheduleInit();
      if (!(statsInitialized && statsButtonEnabled)) return;
      checkAndInsertIcon();
      checkAndAddMenu();
      if (U.isChannelPage?.(location.href)) {
        checkChannelTabs(location.href);
      }
    };

    // Safety net: LazyLoader dispatches yp:nav-refresh after every SPA nav.
    // Re-evaluate icon/menu presence so we don't depend solely on the
    // yt-navigate-finish listener which can race with DOM re-mounts.
    const _navRefreshHandler = () => {
      if (statsInitialized && statsButtonEnabled) {
        checkAndInsertIcon();
        checkAndAddMenu();
      }
    };

    const handleAction = (/** @type {Event} */ event) => {
      scheduleInit();
      if (!(statsInitialized && statsButtonEnabled)) return;
      const ev = /** @type {CustomEvent<{ actionName?: string }>} */ (event);
      if (ev.detail && ev.detail.actionName === 'yt-reload-continuation-items-command') {
        checkAndInsertIcon();
        checkAndAddMenu();
      }
    };

    // Route-scoped stats button and menu: styles, insertion and the listeners
    // that keep them in sync. The feature acquires these through its context,
    // so leaving a listed route releases them.
    videoStatsEnter = ctx => {
      videoStatsCtx = ctx;
      addStyles();
      scheduleInit();
      // The stats-button flag is written by the settings modal's general
      // handler and the feature lifecycle restarts this feature on the change,
      // so re-read it on every entry instead of tracking it locally.
      statsButtonEnabled = isStatsButtonEnabled();
      if (statsButtonEnabled) {
        checkAndInsertIcon();
        checkAndAddMenu();
      }
      ctx.listen(window, 'yp-history-navigate', checkUrlChange, { passive: true });
      ctx.listen(window, 'popstate', checkUrlChange, { passive: true });
      ctx.listen(document, 'yt-navigate-finish', handleNavigate, { passive: true });
      ctx.listen(window, 'yp:nav-refresh', _navRefreshHandler, { passive: true });
      ctx.listen(document, 'yt-action', handleAction, { passive: true });
    };

    videoStatsExit = () => {
      clearStatsIcons_();
      $$('.stats-menu-container').forEach(removeStatsNode_);
      statsInitialized = false;
      statsModalStylesAdded = false;
      videoStatsCtx = null;
    };

    if (typeof window !== 'undefined') {
      window.YouTubePlusStats = Object.assign(window.YouTubePlusStats || {}, {
        openStatsModal,
        initVideoStats,
        ensureShortsStatsButton: checkAndInsertIcon,
        // exported for direct test-table coverage and for any
        // caller that needs locale-aware count parsing.
        parseLocalizedCount: parseLocalizedCount_,
        // Player/DOM extraction surface: the like-button aria-label and the
        // live-player precedence are otherwise unreachable from unit tests.
        getPageVideoStats,
      });
    }
  }; // end initVideoStats

  // --- FeatureRegistry descriptor: stats (Vision dock surface) ---
  /** Shared bar-chart artwork: dock descriptor + page icon both use it. */
  const BAR_CHART_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>';

  DESCRIPTOR = Object.freeze({
    id: 'stats',
    titleKey: 'videoStats',
    fallbackTitle: 'Stats',
    settingsKey: 'enableStatsButton',
    iconSVG: BAR_CHART_ICON_SVG,
    command(/** @type {unknown} */ _shim) {
      const videoId = U.getVideoIdFromUrl(window.location.href);
      if (videoId) {
        if (typeof window.YouTubePlusStats?.openStatsModal !== 'function') {
          initVideoStats();
        }
        if (typeof window.YouTubePlusStats?.openStatsModal === 'function') {
          window.YouTubePlusStats.openStatsModal('video', videoId);
          return true;
        }
      }
      return false;
    },
    mountDock(/** @type {HTMLElement} */ player, /** @type {HTMLElement} */ dock) {
      void player;
      const isEnabled = () => window.YouTubePlusSettingsStore?.get?.('enableStatsButton') !== false;
      if (!isEnabled()) {
        // Release the existing registration before removing the button.
        if (statsDockKey) {
          window.YouTubePlusCleanupManager?.unregisterListener?.(statsDockKey);
          statsDockKey = null;
        }
        dock.querySelector('#yp-vision-stats-btn')?.remove();
        return () => {};
      }
      let btn = /** @type {HTMLButtonElement|null} */ (dock.querySelector('#yp-vision-stats-btn'));
      if (!btn) {
        btn = /** @type {HTMLButtonElement} */ (document.createElement('button'));
        btn.type = 'button';
        btn.className = 'vision-dock-btn yp-vision-stats-btn yp-stats-button';
        btn.id = 'yp-vision-stats-btn';
        const title = U.t?.('videoStats') || 'Stats';
        btn.setAttribute('title', title);
        btn.setAttribute('aria-label', title);
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('role', 'button');
        U.renderTemplateClone?.(btn, BAR_CHART_ICON_SVG);
        dock.appendChild(btn);
      }
      // stable per-button closure so re-mounts dedup to one registration.
      let clickFn = statsClickHandlers.get(btn);
      if (!clickFn) {
        clickFn = /** @type {(e: Event) => void} */ (
          e => {
            e.preventDefault();
            e.stopPropagation();
            DESCRIPTOR?.command?.();
          }
        );
        statsClickHandlers.set(btn, clickFn);
      }
      statsDockKey = window.YouTubePlusCleanupManager?.registerListener?.(
        btn,
        'click',
        clickFn,
        undefined,
        false
      );
      // Idempotent dispose; the host calls it on remove/unmount/replace.
      return () => {
        if (statsDockKey) {
          window.YouTubePlusCleanupManager?.unregisterListener?.(statsDockKey);
          statsDockKey = null;
        }
      };
    },
  });

  if (typeof window !== 'undefined') {
    window.YouTubePlusStats = Object.assign(window.YouTubePlusStats || {}, {
      DESCRIPTOR,
      // Pure parser exported at module scope, testable without initVideoStats.
      parseLocalizedCount: parseLocalizedCount_,
    });
    window.YouTubeStats = window.YouTubePlusStats;
    window.YouTubePlusFeatureRegistry?.register?.(DESCRIPTOR);
  }

  // ── Shared RYD fetch service ──
  // Registered at module scope so every consumer (enhanced dislike buttons,
  // stats modal) can use it once this module loads, independent of
  // route-gated initVideoStats and feature toggles. Consumers resolve it
  // lazily at call time; no hidden local copy of the transport is kept.
  //
  // Contract in-flight dedupe per video ID (concurrent consumers
  // share ONE network call), a shared 8s fetch deadline whose timer is
  // cleared in finally, a bounded TTL cache (cap 100, FIFO eviction plus an
  // expired-entry sweep), and strict validation that keeps real zeros apart
  // from unknown/error. A failed, hung or shapeless response resolves to
  // null and is never cached; per-consumer abandonment is safe (the shared
  // promise is never aborted by one consumer).
  const DISLIKES_TTL_MS = 30000;
  const DISLIKES_CACHE_CAP = 100;
  const DISLIKES_FETCH_DEADLINE_MS = 8000;
  const inFlightDislikes = new Map();
  const dislikesCache = new Map();

  /** @param {unknown} v @returns {number|null} */
  const toFiniteNumber_ = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  /** @param {unknown} v @returns {number|null} finite non-negative count */
  const toCount_ = v => {
    const n = toFiniteNumber_(v);
    return n !== null && n >= 0 ? n : null;
  };

  /**
   * Bounded-cache eviction sweep expired entries on every insert,
   * then drop the oldest inserts (Map iteration is insertion-ordered) until
   * under the cap. All growth sources stay bounded, including mass
   * navigation, and expired entries never linger past the next write.
   * @returns {void}
   */
  function evictDislikesCache_() {
    const now = Date.now();
    for (const [key, entry] of dislikesCache) {
      if (now >= entry.expiresAt) dislikesCache.delete(key);
    }
    while (dislikesCache.size >= DISLIKES_CACHE_CAP) {
      const oldest = dislikesCache.keys().next();
      if (oldest.done) break;
      dislikesCache.delete(oldest.value);
    }
  }

  /**
   * Validate a raw RYD payload. Valid zeros stay zeros; strings/objects/
   * missing fields are unknown (null) per field, never coerced into a
   * count. Returns null for shapeless bodies or payloads with no known
   * field at all, never a silent empty success.
   * @param {unknown} data
   * @returns {{likes: number | null; dislikes: number | null; rating: number | null} | null}
   */
  function parseRydVotes_(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const row = /** @type {Record<string, unknown>} */ (data);
    const result = {
      likes: toCount_(row.likes),
      dislikes: toCount_(row.dislikes),
      rating: toFiniteNumber_(row.rating),
    };
    if (result.likes === null && result.dislikes === null && result.rating === null) return null;
    return result;
  }

  /**
   * Fetch the RYD aggregate for one video. Resolves to
   * `{likes, dislikes, rating}` with valid numbers kept as-is (real zeros
   * stay zeros) and unknown fields as null; resolves to null when the
   * response is an error, hangs past the deadline or has no known field,
   * never a silent empty success.
   * @param {string} videoId - Video ID
   * @returns {Promise<{likes: number | null; dislikes: number | null; rating: number | null} | null>}
   */
  /**
   * GM_xmlhttpRequest transport (Tampermonkey/Violentmonkey/Greasemonkey).
   * @param {string} videoId
   * @returns {Promise<{likes: number | null; dislikes: number | null; rating: number | null} | null>}
   */
  function fetchRydVotesGM_(/** @type {string} */ videoId) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(
        () => reject(new Error('RYD request deadline')),
        DISLIKES_FETCH_DEADLINE_MS
      );
      const done = /** @type {(v: RydVotesAggregate | null) => void} */ (
        value => {
          clearTimeout(timeoutId);
          resolve(value);
        }
      );
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(videoId)}`,
        timeout: DISLIKES_FETCH_DEADLINE_MS,
        headers: { Accept: 'application/json' },
        /** @param {GMResponseLike} r */
        onload: r => {
          clearTimeout(timeoutId);
          // A non-2xx response is unknown, never a zero aggregate.
          if (r.status >= 200 && r.status < 300) {
            let parsed;
            try {
              parsed = JSON.parse(r.responseText || 'null');
            } catch (parseErr) {
              logS(parseErr);
              done(null);
              return;
            }
            done(parseRydVotes_(parsed));
          } else {
            reject(new Error(`HTTP ${r.status}`));
          }
        },
        /** @param {unknown} err */
        onerror: err => {
          clearTimeout(timeoutId);
          reject(err || new Error('network'));
        },
        ontimeout: () => {
          clearTimeout(timeoutId);
          reject(new Error('RYD request timeout'));
        },
      });
    }).then(
      aggregate => aggregate,
      e => {
        // A deadline/HTTP/network rejection is unknown, never a zero.
        logS(e);
        return null;
      }
    );
  }

  /**
   * fetch transport with an AbortController deadline (managers without GM).
   * @param {string} videoId
   * @returns {Promise<{likes: number | null; dislikes: number | null; rating: number | null} | null>}
   */
  async function fetchRydVotesHttp_(/** @type {string} */ videoId) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), DISLIKES_FETCH_DEADLINE_MS)
      : null;
    try {
      const response = await fetch(
        `https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(videoId)}`,
        controller ? { signal: controller.signal } : undefined
      );
      // A non-2xx response is unknown, never a zero aggregate.
      if (!response.ok) return null;

      return parseRydVotes_(await response.json());
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  async function fetchDislikesData(/** @type {string} */ videoId) {
    if (!videoId) return null;

    // TTL cache: a fresh aggregate is served without a network call; an
    // expired one is evicted.
    const cached = dislikesCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    dislikesCache.delete(videoId);

    // In-flight dedupe: concurrent consumers share one shared promise.
    const inflight = inFlightDislikes.get(videoId);
    if (inflight) return inflight;

    const promise = (async () => {
      // defer until browser is idle (non-critical enrichment data)
      await new Promise(resolve => {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(resolve, { timeout: 3000 });
        } else {
          setTimeout(resolve, 0);
        }
      });
      try {
        // One result store; both transports stay available: GM_xmlhttpRequest
        // where the manager provides it, plain fetch otherwise. Each carries
        // its own deadline; the timer is cleared in finally.
        const aggregate =
          typeof GM_xmlhttpRequest === 'function'
            ? await fetchRydVotesGM_(videoId)
            : await fetchRydVotesHttp_(videoId);
        return aggregate;
      } catch (error) {
        logS(error);
        window.YouTubePlusLogger?.error?.('Stats', 'Failed to fetch dislikes:', error);
        return null;
      } finally {
        inFlightDislikes.delete(videoId);
      }
    })();

    inFlightDislikes.set(videoId, promise);
    const result = await promise;
    // Only verified aggregates are cached; failures/unknown retry on the next
    // consumer action.
    if (result) {
      evictDislikesCache_();
      dislikesCache.set(videoId, {
        value: result,
        expiresAt: Date.now() + DISLIKES_TTL_MS,
      });
    }
    return result;
  }

  if (typeof window !== 'undefined') {
    window.YouTubePlusStats = Object.assign(window.YouTubePlusStats || {}, {
      initVideoStats,
      /** The shared RYD fetch service. */
      getDislikesData: fetchDislikesData,
      /** Bounded-cache/in-flight observability for tests and benchmarks. */
      getDislikesServiceStats: () => ({
        cached: dislikesCache.size,
        inFlight: inFlightDislikes.size,
        cap: DISLIKES_CACHE_CAP,
      }),
    });
  }

  // The settings-modal listener stays at module scope so the experimental
  // toggle is wired on any page, matching where the settings UI opens.
  registerListenerSafe(document, 'youtube-plus-settings-modal-opened', initVideoStats, {
    once: false,
  });

  const videoStatsFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'videoStats',
    settingsKey: 'enableStatsButton',
    // Stats buttons and menus render on video and channel pages only.
    routes: ['watch', 'shorts', 'channel'],
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      videoStatsCtx = ctx;
      initVideoStats();
      videoStatsEnter?.(ctx);
    },
    stop() {
      videoStatsExit?.();
    },
  });

  // Starts on a listed page, then follows navigation between routes.
  U.onDomReady(() => videoStatsFeature?.sync());
})();

// ═══════════════════════════════════════════════════════════════════
// Channel Stats IIFE: separate scope for channel-level statistics
// ═══════════════════════════════════════════════════════════════════
(function () {
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U.logSuppressed?.(_err, _label || 'Stats');
  if (window.__ytpChannelStatsModuleInit) return;

  /** @type {YouTubePlusFeatureContext | null} */
  let channelStatsCtx = null;
  /** @type {((ctx: YouTubePlusFeatureContext) => void) | null} */
  let channelStatsEnter = null;
  /** @type {(() => void) | null} */
  let channelStatsExit = null;

  // Unified listener registration helper: uses cleanupManager, or falls back to
  // addEventListener. Declared at module scope (not inside initChannelStats)
  // because the module-scope registration below also uses it.
  // Shared helper: delegates to YouTubeUtils.
  /**
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListenerOrEventListenerObject} handler
   * @param {AddEventListenerOptions | boolean | { owner?: HTMLElement }} [opts]
   * @returns {symbol | null}
   */
  const registerListenerSafe = (target, type, handler, opts) =>
    /** @type {symbol | null} */ (U.registerListenerSafe?.(target, type, handler, opts));

  const initChannelStats = () => {
    if (window.__ytpChannelStatsModuleInit) return;
    window.__ytpChannelStatsModuleInit = true;

    const _setSafeHTML = U.setSafeHTML;
    // utils.js is an earlier build-order dependency and always provides the
    // visibility-aware scheduler, so there is no fallback to keep in sync.
    const createVisibilityAwareInterval =
      /** @type {(callback: () => void, delay: number) => { stop: () => void; pause: () => void; resume: () => void; active: boolean }} */ (
        U.createVisibilityAwareInterval
      );
    const setTimeout_ = setTimeout.bind(window);
    // Shared helpers from YouTubeUtils (separate IIFE scope requires local aliases)
    const $ = U.$;
    const byId = U.byId;

    // Shared translation helper, declared before "inject now" so
    // addSettingsUI() doesn't hit TDZ on `t`.
    const t = U.t;

    const _safeLS = window.YouTubeUtils.storage;

    /** Module namespace in the shared settings blob. */
    const MODULE_NAME = 'channelStats';
    const SETTINGS_KEY = 'enableChannelStats';

    /** @returns {YouTubePlusSettingsStore | null} the store when the blob bridge is active */
    const bridgedStore = () => window.YouTubePlusSettingsStore?.moduleBridge?.() ?? null;

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
    };

    /**
     * Channel-overlay settings, owned by this namespace in the shared blob (or
     * the legacy `youtubeEnhancer*`/`show-*` keys before the blob exists).
     * @type {{
     *   interval: number, opacity: number, fontSize: number, fontFamily: string,
     *   showSubscribers: boolean, showViews: boolean, showVideos: boolean
     * }}
     */
    const channelStatsSettings = {
      interval: CONFIG.DEFAULT_UPDATE_INTERVAL,
      opacity: CONFIG.DEFAULT_OVERLAY_OPACITY,
      fontSize: 24,
      fontFamily: 'Rubik, sans-serif',
      showSubscribers: true,
      showViews: true,
      showVideos: true,
    };

    /** @type {Readonly<Record<string, 'showSubscribers'|'showViews'|'showVideos'>>} */
    const SHOW_SETTING_KEYS = Object.freeze({
      subscribers: 'showSubscribers',
      views: 'showViews',
      videos: 'showVideos',
    });

    /** @param {string} option @param {boolean} shown */
    const setSectionShown_ = (option, shown) => {
      const key = SHOW_SETTING_KEYS[option];
      if (key) channelStatsSettings[key] = shown;
    };

    /** @param {string} option @returns {boolean} */
    const isSectionShown_ = option => {
      const key = SHOW_SETTING_KEYS[option];
      return !key || channelStatsSettings[key] !== false;
    };

    /** @returns {typeof channelStatsSettings} the pre-blob legacy shape */
    const readLegacyChannelSettings = () => ({
      interval:
        parseInt(_safeLS.getItem('youtubeEnhancerInterval') || '', 10) ||
        CONFIG.DEFAULT_UPDATE_INTERVAL,
      opacity:
        parseFloat(_safeLS.getItem('youtubeEnhancerOpacity') || '') ||
        CONFIG.DEFAULT_OVERLAY_OPACITY,
      fontSize: parseInt(_safeLS.getItem('youtubeEnhancerFontSize') || '', 10) || 24,
      fontFamily: _safeLS.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif',
      showSubscribers: _safeLS.getItem('show-subscribers') !== 'false',
      showViews: _safeLS.getItem('show-views') !== 'false',
      showVideos: _safeLS.getItem('show-videos') !== 'false',
    });

    /** @param {unknown} value @param {number} fallback @returns {number} */
    const positiveNumber_ = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    /** @param {unknown} value @param {boolean} fallback @returns {boolean} */
    const booleanOr_ = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

    /** @param {Record<string, unknown>|null|undefined} parsed */
    const applyChannelSettings = parsed => {
      if (!parsed || typeof parsed !== 'object') return;
      channelStatsSettings.interval = positiveNumber_(
        parsed.interval,
        channelStatsSettings.interval
      );
      channelStatsSettings.opacity = positiveNumber_(parsed.opacity, channelStatsSettings.opacity);
      channelStatsSettings.fontSize = positiveNumber_(
        parsed.fontSize,
        channelStatsSettings.fontSize
      );
      if (typeof parsed.fontFamily === 'string' && parsed.fontFamily) {
        channelStatsSettings.fontFamily = parsed.fontFamily;
      }
      channelStatsSettings.showSubscribers = booleanOr_(
        parsed.showSubscribers,
        channelStatsSettings.showSubscribers
      );
      channelStatsSettings.showViews = booleanOr_(parsed.showViews, channelStatsSettings.showViews);
      channelStatsSettings.showVideos = booleanOr_(
        parsed.showVideos,
        channelStatsSettings.showVideos
      );
    };

    // From the blob once it exists (migrating the legacy keys on first read),
    // otherwise the legacy keys stay authoritative.
    const loadChannelSettings = () => {
      const store = bridgedStore();
      if (store) {
        const mod = store.getModuleSettings(MODULE_NAME);
        if (mod && Object.keys(mod).length) {
          applyChannelSettings(mod);
          return;
        }
        applyChannelSettings(readLegacyChannelSettings());
        store.updateModuleSettings(MODULE_NAME, { ...channelStatsSettings });
        return;
      }
      applyChannelSettings(readLegacyChannelSettings());
    };

    /** Persist the live settings through the bridge, or the legacy keys. */
    const saveChannelSettings = () => {
      const store = bridgedStore();
      if (store) {
        store.updateModuleSettings(MODULE_NAME, { ...channelStatsSettings });
        return;
      }
      _safeLS.setItem('youtubeEnhancerInterval', String(channelStatsSettings.interval));
      _safeLS.setItem('youtubeEnhancerOpacity', String(channelStatsSettings.opacity));
      _safeLS.setItem('youtubeEnhancerFontSize', String(channelStatsSettings.fontSize));
      _safeLS.setItem('youtubeEnhancerFontFamily', channelStatsSettings.fontFamily);
      _safeLS.setItem('show-subscribers', String(channelStatsSettings.showSubscribers));
      _safeLS.setItem('show-views', String(channelStatsSettings.showViews));
      _safeLS.setItem('show-videos', String(channelStatsSettings.showVideos));
    };

    loadChannelSettings();

    // Global state management
    const state = /** @type {ChannelStatsState} */ ({
      overlay: null,
      isUpdating: false,
      intervalId: null,
      currentChannelName: null,
      currentChannelId: null,
      enabled: window.YouTubePlusSettingsStore?.get?.(SETTINGS_KEY) !== false,
      updateInterval: channelStatsSettings.interval,
      overlayOpacity: channelStatsSettings.opacity,
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

    // LRU-evicting set helper for bounded Maps (max 50 entries)
    const MAX_CACHE_ENTRIES = 50;
    const boundedCacheSet = (
      /** @type {Map<unknown, unknown>} */ map,
      /** @type {unknown} */ key,
      /** @type {unknown} */ value
    ) => {
      if (map.size >= MAX_CACHE_ENTRIES) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
      }
      map.set(key, value);
    };

    // Utility functions
    const utils = {
      /** @param {string} message @param {...unknown} args */
      log: (message, ...args) => {
        U.logger?.debug?.('[YouTube+][Stats]', message, ...args);
      },

      /** @param {string} message @param {...unknown} args */
      warn: (message, ...args) => {
        if (U.logger?.warn) U.logger.warn('[YouTube+][Stats]', message, ...args);
        else window.console.warn('[YouTube+][Stats]', message, ...args);
      },

      /** @param {string} message @param {...unknown} args */
      error: (message, ...args) => {
        if (U.logger?.error) U.logger.error('[YouTube+][Stats]', message, ...args);
        else window.console.error('[YouTube+][Stats]', message, ...args);
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
     * @returns {Promise<Record<string, unknown>|null>} The parsed channel data or null on error
     */
    async function fetchChannel(url) {
      if (state.isChecking) return null;
      state.isChecking = true;

      try {
        const response = await fetchWithDeadline_(url, { credentials: 'same-origin' }, 10000);

        if (!response.ok) return null;

        const html = await response.text();
        const match = html.match(/var ytInitialData = (.+?);<\/script>/);
        return match?.[1] ? JSON.parse(match[1]) : null;
      } catch (error) {
        logS(error);
        utils.warn('Failed to fetch channel data:', error);
        return null;
      } finally {
        state.isChecking = false;
      }
    }

    /**
     * Fetch basic channel metadata (name and ID) from a channel page
     * @param {string} url - Channel page URL
     * @returns {Promise<{channelName: string, channelId: string | null}|null>} Channel info or null
     */
    async function getChannelInfo(/** @type {string} */ url) {
      const data =
        /** @type {{ metadata?: { channelMetadataRenderer?: { title?: string, externalId?: string } } } | null} */ (
          await fetchChannel(url)
        );
      if (!data) return null;

      const channelName = data?.metadata?.channelMetadataRenderer?.title || t('unknown');
      const channelId = data?.metadata?.channelMetadataRenderer?.externalId || null;

      return { channelName, channelId };
    }

    /**
     * Detect SPA navigation to a channel page and fetch channel info
     * @returns {void}
     */
    function checkUrlChange() {
      const currentUrl = location.href;
      if (currentUrl !== state.previousUrl) {
        state.previousUrl = currentUrl;
        if (U.isChannelPage?.(currentUrl)) {
          setTimeout(() => getChannelInfo(currentUrl), 500);
        }
      }
    }

    // YouTube SPA navigation: yt-navigate-finish fires for all pushState and
    // replaceState transitions on youtube.com, so wrapping the history APIs is
    // redundant and creates an ever-growing wrapper chain across modules.
    registerListenerSafe(document, 'yt-navigate-finish', checkUrlChange, {
      passive: true,
    });
    registerListenerSafe(window, 'popstate', checkUrlChange, { passive: true });

    /**
     * Initialize the channel stats overlay, fonts, and listeners
     * @returns {void}
     */
    function init() {
      if (U.isStudioPage?.()) return;
      utils.log('Initializing YouTube Enhancer v1.6');

      loadFonts();

      utils.log('YouTube Enhancer initialized successfully');
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
     * Inject channel stats overlay CSS
     * @returns {void}
     */
    function addStyles() {
      channelStatsCtx?.style('yp-video-stats-styles', getStatsStyles_('yp-video-stats-styles'));
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
      menu.classList.add('yp-stats-channel-menu');
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
      displayLabel.classList.add('yp-stats-display-label');
      displaySection.appendChild(displayLabel);

      // Use event delegation for all checkboxes
      window.YouTubePlusCleanupManager?.registerListener?.(
        displaySection,
        'change',
        (/** @type {Event} */ e) => {
          const checkbox = e.target;
          if (
            checkbox instanceof HTMLInputElement &&
            checkbox.type === 'checkbox' &&
            checkbox.id.startsWith('show-')
          ) {
            const option = checkbox.id.replace('show-', '');
            setSectionShown_(option, checkbox.checked);
            saveChannelSettings();
            updateDisplayState();
          }
        },
        undefined,
        false
      );
      // Render options as single-line settings items using shared classes
      OPTIONS.forEach(option => {
        const item = document.createElement('div');
        item.className = 'yp-settings-item';

        const left = document.createElement('div');

        const label = document.createElement('label');
        label.className = 'yp-settings-item-label';
        label.htmlFor = `show-${option}`;
        label.textContent = t(option);
        left.appendChild(label);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `show-${option}`;
        checkbox.checked = isSectionShown_(option);
        checkbox.className = 'yp-settings-checkbox';

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
    /**
     * @param {Element | HTMLElement | null | undefined} overlay
     * @param {'fontSize' | 'fontFamily'} property
     * @param {string} value
     */
    function updateOverlayNumbersStyle_(overlay, property, value) {
      if (!overlay) return;
      overlay
        .querySelectorAll('.subscribers-number,.views-number,.videos-number')
        .forEach((/** @type {Element} */ el) => {
          if (el instanceof HTMLElement && el.style) {
            el.style[property] = value;
          }
        });
    }

    /**
     * @param {EventTarget | null} target
     * @param {HTMLElement} controlsSection
     */
    function handleFontSizeSliderChange_(target, controlsSection) {
      if (!(target instanceof HTMLElement && target.classList.contains('font-size-slider'))) return;
      const input = /** @type {HTMLInputElement} */ (target);
      const fontSizeValue = controlsSection.querySelector('.font-size-value');
      if (fontSizeValue) fontSizeValue.textContent = `${input.value}px`;
      channelStatsSettings.fontSize = Number(input.value) || channelStatsSettings.fontSize;
      updateOverlayNumbersStyle_(state.overlay, 'fontSize', `${input.value}px`);
    }

    /**
     * @param {EventTarget | null} target
     * @param {HTMLElement} controlsSection
     */
    function handleIntervalSliderChange_(target, controlsSection) {
      if (!(target instanceof HTMLElement && target.classList.contains('interval-slider'))) return;
      const input = /** @type {HTMLInputElement} */ (target);
      const newInterval = parseInt(input.value, 10) * 1000;
      const intervalValue = controlsSection.querySelector('.interval-value');
      if (intervalValue) intervalValue.textContent = `${input.value}s`;
      state.updateInterval = newInterval;
      channelStatsSettings.interval = newInterval;

      if (state.intervalId) {
        state.intervalId.stop?.();
        state.intervalId = createVisibilityAwareInterval(() => {
          if (state.overlay && state.currentChannelName) {
            updateOverlayContent(state.overlay, state.currentChannelName);
          }
        }, newInterval);
      }
    }

    /**
     * @param {EventTarget | null} target
     * @param {HTMLElement} controlsSection
     */
    function handleOpacitySliderChange_(target, controlsSection) {
      if (!(target instanceof HTMLElement && target.classList.contains('opacity-slider'))) return;
      const input = /** @type {HTMLInputElement} */ (target);
      const newOpacity = parseInt(input.value, 10) / 100;
      const opacityValue = controlsSection.querySelector('.opacity-value');
      if (opacityValue) opacityValue.textContent = `${input.value}%`;
      state.overlayOpacity = newOpacity;
      channelStatsSettings.opacity = newOpacity;

      if (state.overlay) {
        state.overlay.style.backgroundColor = `rgba(0, 0, 0, ${newOpacity})`;
      }
    }

    function createControlsSection() {
      const controlsSection = document.createElement('div');
      if (controlsSection.style) controlsSection.style.flex = '1';

      // Use event delegation for all sliders and selects
      window.YouTubePlusCleanupManager?.registerListener?.(
        controlsSection,
        'input',
        (/** @type {Event} */ e) => {
          const target = e.target;
          handleFontSizeSliderChange_(target, controlsSection);
          handleIntervalSliderChange_(target, controlsSection);
          handleOpacitySliderChange_(target, controlsSection);
        },
        undefined,
        false
      );

      // Persist once the slider settles: dragging must not rewrite the store on
      // every input step.
      window.YouTubePlusCleanupManager?.registerListener?.(
        controlsSection,
        'change',
        () => saveChannelSettings(),
        undefined,
        false
      );

      // Font family selector - using glass-dropdown style
      const fontLabel = document.createElement('label');
      fontLabel.textContent = t('fontFamily');
      fontLabel.classList.add('yp-stats-font-label');

      const fonts = [
        { name: 'Rubik', value: 'Rubik, sans-serif' },
        { name: 'Impact', value: 'Impact, Charcoal, sans-serif' },
        { name: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
        { name: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
      ];
      const savedFont = channelStatsSettings.fontFamily;
      const savedFontName = fonts.find(f => f.value === savedFont)?.name || 'Rubik';

      // Hidden native select for compatibility
      const fontSelect = document.createElement('select');
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
      const fontDropdown = document.createElement('div');
      fontDropdown.className = 'glass-dropdown';
      fontDropdown.id = 'stats-font-dropdown';
      fontDropdown.tabIndex = 0;
      fontDropdown.setAttribute('role', 'listbox');
      fontDropdown.setAttribute('aria-expanded', 'false');
      fontDropdown.style.marginBottom = '12px';
      _setSafeHTML(
        fontDropdown,
        `
      <button class="glass-dropdown__toggle" type="button" aria-haspopup="listbox" aria-expanded="false">
        <span class="glass-dropdown__label">${savedFontName}</span>
        <svg class="glass-dropdown__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <ul class="glass-dropdown__list" role="listbox" style="display:none;">
        ${fonts
          .map(f => {
            const sel = f.value === savedFont ? ' aria-selected="true"' : '';
            return `<li class="glass-dropdown__item" data-value="${f.value}" role="option"${sel}>${f.name}</li>`;
          })
          .join('')}
      </ul>
    `
      );

      // Initialize glass dropdown via shared design system component if available
      window.YouTubePlusDesignSystem?.initGlassDropdown?.({
        dropdown: fontDropdown,
        hiddenSelect: fontSelect,
        onChange: (/** @type {string} */ val) => {
          channelStatsSettings.fontFamily = val;
          saveChannelSettings();
          updateOverlayNumbersStyle_(state.overlay, 'fontFamily', val);
        },
      });

      // Font size slider
      const fontSizeLabel = document.createElement('label');
      fontSizeLabel.textContent = t('fontSize');
      fontSizeLabel.classList.add('yp-stats-font-label');

      const fontSizeSlider = document.createElement('input');
      fontSizeSlider.type = 'range';
      fontSizeSlider.min = '16';
      fontSizeSlider.max = '72';
      fontSizeSlider.value = String(channelStatsSettings.fontSize);
      fontSizeSlider.step = '1';
      fontSizeSlider.className = 'font-size-slider';

      const fontSizeValue = document.createElement('div');
      fontSizeValue.className = 'font-size-value';
      fontSizeValue.textContent = `${fontSizeSlider.value}px`;
      fontSizeValue.classList.add('yp-stats-font-value');

      // Update interval slider
      const intervalLabel = document.createElement('label');
      intervalLabel.textContent = t('updateInterval');
      intervalLabel.classList.add('yp-stats-font-label');

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
      intervalValue.classList.add('yp-stats-font-value');

      // Opacity slider
      const opacityLabel = document.createElement('label');
      opacityLabel.textContent = t('backgroundOpacity');
      opacityLabel.classList.add('yp-stats-font-label');

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
      opacityValue.classList.add('yp-stats-font-value');

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
      const spinnerContainer = document.createElement('div');
      spinnerContainer.classList.add('yp-stats-spinner');
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
      container.className = 'channel-stat channel-stat--hidden';

      const numberContainer = document.createElement('div');
      numberContainer.className = 'channel-stat-number-col';

      const differenceElement = document.createElement('div');
      differenceElement.classList.add(`${className}-difference`, 'channel-stat-difference');

      const digitContainer = createNumberContainer();
      digitContainer.classList.add(`${className}-number`, 'channel-stat-number');

      numberContainer.appendChild(differenceElement);
      numberContainer.appendChild(digitContainer);

      const labelContainer = document.createElement('div');
      labelContainer.className = 'channel-stat-label-row';

      const icon = createSVGIcon(iconPath);
      icon.classList.add('channel-stat-icon');

      const labelElement = document.createElement('div');
      labelElement.classList.add(`${className}-label`, 'channel-stat-label');

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
      // Dynamic values: overlay opacity and the user-chosen number font.
      overlay.style.backgroundColor = `rgba(0, 0, 0, ${state.overlayOpacity})`;
      overlay.style.setProperty('--yt-stats-font-family', channelStatsSettings.fontFamily);
      overlay.style.setProperty('--yt-stats-font-size', `${channelStatsSettings.fontSize}px`);
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

      window.YouTubePlusCleanupManager?.registerListener?.(
        settingsButton,
        'click',
        (/** @type {MouseEvent} */ e) => {
          e.stopPropagation();
          toggleMenu(!settingsMenu.classList.contains('show'));
        },
        undefined,
        false
      );

      window.YouTubePlusCleanupManager?.registerListener?.(
        settingsButton,
        'keydown',
        (/** @type {KeyboardEvent} */ e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleMenu(!settingsMenu.classList.contains('show'));
          }
        },
        undefined,
        false
      );

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

      const clickKey = registerListenerSafe(document, 'click', clickHandler);
      const keyKey = registerListenerSafe(document, 'keydown', keyHandler);
      if (clickKey) state.documentListenerKeys.add(clickKey);
      if (keyKey) state.documentListenerKeys.add(keyKey);
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
     * @returns {Promise<unknown>} Parsed JSON response
     */
    function fetchWithGM(
      /** @type {string} */ url,
      /** @type {Record<string, string>} */ headers = {}
    ) {
      const requestHeaders = {
        Accept: 'application/json',
        ...headers,
      };
      // Read from `window`, as before the typing pass: where the grant is only a
      // sandbox variable this falls back to fetch().
      const gm = /** @type {{ GM_xmlhttpRequest?: typeof GM_xmlhttpRequest }} */ (
        /** @type {unknown} */ (window)
      ).GM_xmlhttpRequest;
      if (typeof gm === 'function') {
        return new Promise((resolve, reject) => {
          gm({
            method: 'GET',
            url,
            headers: requestHeaders,
            timeout: 10000,
            onload: (/** @type {GMResponseLike} */ response) => {
              if (response.status >= 200 && response.status < 300) {
                try {
                  resolve(JSON.parse(String(response.responseText)));
                } catch (parseError) {
                  logS(parseError);
                  const message =
                    parseError instanceof Error ? parseError.message : String(parseError);
                  reject(new Error(`Failed to parse response: ${message}`));
                }
              } else {
                reject(new Error(`Failed to fetch: ${response.status}`));
              }
            },
            onerror: (/** @type {unknown} */ error) => reject(error),
            ontimeout: () => reject(new Error('Request timed out')),
          });
        });
      }

      utils.warn('GM_xmlhttpRequest unavailable, falling back to fetch API');
      return fetchWithDeadline_(
        url,
        {
          method: 'GET',
          headers: requestHeaders,
          credentials: 'omit',
          mode: 'cors',
        },
        10000
      )
        .then((/** @type {Response} */ response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status}`);
          }
          return response.json();
        })
        .catch((/** @type {unknown} */ error) => {
          utils.error('Fallback fetch failed:', error);
          throw error;
        });
    }

    /**
     * @param {string | null | undefined} cacheKey
     * @param {string} channelId
     * @returns {string}
     */
    function cacheChannelId_(cacheKey, channelId) {
      state.currentChannelId = channelId;
      if (cacheKey) boundedCacheSet(state.channelIdCache, cacheKey, channelId);
      return channelId;
    }

    /**
     * @returns {string | null}
     */
    function resolveChannelIdFromDom_() {
      const metaTag = /** @type {HTMLMetaElement | null} */ ($('meta[itemprop="channelId"]'));
      if (metaTag?.content) return metaTag.content;

      const urlMatch = window.location.href.match(/channel\/(UC[\w-]+)/);
      if (urlMatch?.[1]) return urlMatch[1];

      const initialData =
        /** @type {{ metadata?: { channelMetadataRenderer?: { externalId?: string } }, header?: { c4TabbedHeaderRenderer?: { channelId?: string } } } | undefined} */ (
          window.ytInitialData
        );
      const id =
        initialData?.metadata?.channelMetadataRenderer?.externalId ||
        initialData?.header?.c4TabbedHeaderRenderer?.channelId;
      if (id && /^UC[\w-]{22}$/.test(id)) return id;

      if (window.ytcfg?.get) {
        const cfgId = window.ytcfg.get('CHANNEL_ID');
        if (cfgId && /^UC[\w-]{22}$/.test(cfgId)) return cfgId;
      }

      return null;
    }

    /**
     * @param {number} [maxAttempts=10]
     * @param {number} [interval=100]
     * @returns {Promise<string | null>}
     */
    function pollChannelIdFromDom_(maxAttempts = 10, interval = 100) {
      return new Promise(resolve => {
        let attempts = 0;
        const tick = () => {
          attempts += 1;
          const id = resolveChannelIdFromDom_();
          if (id) return resolve(id);
          if (attempts >= maxAttempts) return resolve(null);
          setTimeout(tick, interval);
        };
        tick();
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
        return state.channelIdCache.get(cacheKey) || null;
      }

      if (state.currentChannelId) {
        return state.currentChannelId;
      }

      if (typeof channelName === 'string' && /^UC[\w-]{22}$/.test(channelName)) {
        return cacheChannelId_(cacheKey, channelName);
      }

      const channelId = resolveChannelIdFromDom_() || (await pollChannelIdFromDom_());
      if (channelId) {
        return cacheChannelId_(cacheKey, channelId);
      }

      // Last resort: fetch the channel page HTML and parse ytInitialData.
      const channelInfo = await getChannelInfo(window.location.href);
      if (channelInfo?.channelId) {
        return cacheChannelId_(cacheKey, channelInfo.channelId);
      }

      return null;
    }

    /**
     * Fetch channel statistics with retry logic and fallback
     * @param {string} channelId - Channel ID
     * @returns {Promise<LivecountsChannelStats>} Channel stats
     */
    /** @type {Record<string, number>} */
    const SUBSCRIBER_MULTIPLIERS = {
      k: 1e3,
      m: 1e6,
      b: 1e9,
    };

    /**
     * @param {string} raw
     * @returns {number}
     */
    function parseSubscriberRawText_(raw) {
      if (!raw) return 0;
      const num = parseFloat(raw);
      if (Number.isNaN(num)) return 0;
      const suffix = raw.slice(-1).toLowerCase();
      const mult = SUBSCRIBER_MULTIPLIERS[suffix] || 1;
      return Math.round(num * mult);
    }

    /**
     * Extract subscriber count from page DOM as a best-effort fallback
     * @returns {number}
     */
    function extractSubscriberCountFromDom() {
      const subEl =
        document.querySelector('#subscriber-count') ||
        document.querySelector('yt-formatted-string#subscriber-count');
      const raw = subEl?.textContent?.replace(/[^0-9.KkMmBb]/g, '') || '';
      return parseSubscriberRawText_(raw);
    }

    /**
     * Fetch with retry + exponential backoff; returns stats or null.
     * @template {LivecountsChannelStats} T
     * @param {string} channelId
     * @param {() => Promise<T | null>} fetchFn
     * @returns {Promise<{stats: T | null, lastError: unknown}>}
     */
    async function fetchStatsWithRetries(channelId, fetchFn) {
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
            return { stats, lastError };
          }
        } catch (err) {
          logS(err);
          lastError = err;
          if (attempt < CONFIG.MAX_RETRIES) {
            const delay = Math.min(1000 * 2 ** attempt, 10000);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      return { stats: null, lastError };
    }

    /**
     * @param {string} channelId
     * @returns {Promise<LivecountsChannelStats>}
     */
    async function fetchChannelStats(channelId) {
      const fetchFn = async () => {
        const stats = await fetchWithGM(`${STATS_API_URL}${channelId}`, {
          origin: 'https://livecounts.io',
          referer: 'https://livecounts.io/',
        });
        // A malformed counter payload is a failure, never a partial result.
        return numbersAreValidCounts_(stats) ? /** @type {LivecountsChannelStats} */ (stats) : null;
      };

      // Retry with exponential backoff
      const { stats, lastError } = await fetchStatsWithRetries(channelId, fetchFn);
      if (stats) return stats;

      // Try cached data
      const cached = state.lastSuccessfulStats.get(channelId);
      if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
        return cached.stats;
      }

      // Fallback: extract subscriber count from page DOM
      const fallbackCount = extractSubscriberCountFromDom();

      if (lastError) {
        utils.error('Failed to fetch channel stats:', lastError);
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
    /** Remove every overlay together with the listeners inside it. */
    function removeOverlays() {
      // Direct query, not the DOM cache: a cached miss would leave the overlay.
      const overlays = new Set(document.querySelectorAll('.channel-banner-overlay'));
      if (state.overlay) overlays.add(state.overlay);
      for (const existingOverlay of overlays) {
        // The overlay's settings panel and dropdown are discarded with it.
        window.YouTubePlusCleanupManager?.disconnectSubtree?.(existingOverlay);
        existingOverlay.remove();
      }
      state.overlay = null;
    }

    function clearExistingOverlay() {
      removeOverlays();
      if (state.intervalId) {
        state.intervalId.stop?.();
        state.intervalId = null;
      }
      if (state.documentListenerKeys?.size) {
        state.documentListenerKeys.forEach(key => {
          U.cleanupManager?.unregisterListener?.(key);
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
      digit.className = 'channel-stat-digit';
      return digit;
    }

    /**
     * Create a comma separator span element
     * @returns {HTMLSpanElement} Comma element
     */
    function createCommaElement() {
      const comma = document.createElement('span');
      comma.textContent = ',';
      comma.className = 'channel-stat-comma';
      return comma;
    }

    /**
     * Create the flex number container for digit groups
     * @returns {HTMLDivElement} Number container
     */
    function createNumberContainer() {
      const container = document.createElement('div');
      container.className = 'channel-stat-number-row';
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
          window.YouTubePlusCleanupManager?.registerAnimationFrame?.(requestAnimationFrame(update));
        }
      }

      window.YouTubePlusCleanupManager?.registerAnimationFrame?.(requestAnimationFrame(update));
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

      const containers = overlay.querySelectorAll('.channel-stat--hidden');
      containers.forEach((/** @type {Element} */ container) => {
        container.classList.remove('channel-stat--hidden');
      });

      const icons = overlay.querySelectorAll('svg[style*="display: none"]');
      icons.forEach((/** @type {Element} */ icon) => {
        if (icon instanceof SVGElement || icon instanceof HTMLElement) {
          if (icon.style) icon.style.display = 'block';
        }
      });
    }

    /**
     * Render the numeric difference between current and earlier stat values.
     * @param {HTMLElement} element - Difference element
     * @param {number} currentValue - Current stat value
     * @param {number} previousValue - Earlier stat value
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
        difference > 0 ? 'yp-stats-change-positive' : 'yp-stats-change-negative'
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

      const statContainers = overlay.querySelectorAll('.channel-stat');
      if (!statContainers.length) return;

      let visibleCount = 0;
      /** @type {Element[]} */
      const visibleContainers = [];

      statContainers.forEach((/** @type {Element} */ container) => {
        const numberContainer = container.querySelector('[class$="-number"]');
        if (!numberContainer) return;

        // The number element carries several classes, so match the section by
        // its known `<option>-number` class rather than by trimming the string.
        const type =
          OPTIONS.find(option => numberContainer.classList.contains(`${option}-number`)) || '';

        const isVisible = isSectionShown_(type);

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
      const fontSize = String(channelStatsSettings.fontSize);
      const fontFamily = channelStatsSettings.fontFamily;
      updateOverlayNumbersStyle_(overlay, 'fontSize', `${fontSize}px`);
      updateOverlayNumbersStyle_(overlay, 'fontFamily', fontFamily);

      if (/** @type {HTMLElement} */ (overlay).style)
        /** @type {HTMLElement} */ (overlay).style.display = 'flex';
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
     * @param {LivecountsChannelStats} stats - Stats object with error
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
     * Get the earlier stat value for comparison.
     * @param {string} channelId - Channel ID
     * @param {string} className - Stat type class name
     * @returns {number|null} Earlier value or null
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
     * @param {LivecountsChannelStats} stats - Stats object
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
     * @param {HTMLElement} overlay
     * @param {string} channelName
     */
    function handleMissingChannelId_(overlay, channelName) {
      const now = Date.now();
      if (now - state.lastChannelIdWarnAt > 15000) {
        state.lastChannelIdWarnAt = now;
        utils.warn('Skipping overlay update: channel ID is not available yet');
      }
      setTimeout(() => {
        if (overlay?.isConnected && channelName === state.currentChannelName) {
          updateOverlayContent(overlay, channelName);
        }
      }, 500);
    }

    /**
     * @param {HTMLElement} overlay
     * @param {string} channelId
     * @param {string} channelName
     * @param {LivecountsChannelStats} stats
     */
    function applyChannelStatsUpdate_(overlay, channelId, channelName, stats) {
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
          handleMissingChannelId_(overlay, channelName);
          return;
        }
        state.currentChannelId = channelId;
        const stats = await fetchChannelStats(channelId);

        // Check if channel changed during async operations
        if (channelName !== state.currentChannelName) {
          return;
        }

        applyChannelStatsUpdate_(overlay, channelId, channelName, stats);
      } catch (error) {
        logS(error);
        utils.error('Failed to update overlay content:', error);
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
      // utils.js is an earlier build-order dependency and always provides the
      // coordinator-backed scheduler, so there is no inline fallback to keep
      // in sync.
      const factory = U.createRetryScheduler;
      if (typeof factory !== 'function') return null;
      return /** @type {{ stop: () => void } | null} */ (/** @type {unknown} */ (factory(opts)));
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
        state.intervalId.stop?.();
        state.intervalId = null;
      }
    }

    /**
     * Create debounced update function
     * @param {HTMLElement} overlay - Overlay element
     * @param {string} channelName - Channel name
     * @returns {() => void} Debounced update function
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
        state.intervalId.stop?.();
      }
      const debouncedUpdate = createDebouncedUpdate(overlay, channelName);
      state.intervalId = createVisibilityAwareInterval(debouncedUpdate, state.updateInterval);
    }

    /**
     * Add overlay to channel page banner
     * @param {HTMLElement} bannerElement - Banner element
     */
    function addOverlay(bannerElement) {
      // Deferred callers (the 100 ms toggle delay, page observers) can land
      // after the feature was switched off again.
      if (!state.enabled) return;
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

      // Banner must actually be rendered (non-zero size); empty <div> shells
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
          if (!U.isChannelPage?.()) {
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
      if (!U.isChannelPage?.()) {
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
      if (!state.enabled || state.pageObserversAttached || !channelStatsCtx) return undefined;
      state.pageObserversAttached = true;

      const debouncedBannerUpdate = U.debounce(handleBannerUpdate, 150);

      channelStatsCtx.listen(document, 'yt-navigate-finish', debouncedBannerUpdate, {
        passive: true,
      });
      channelStatsCtx.listen(document, 'yt-page-data-updated', debouncedBannerUpdate, {
        passive: true,
      });

      return undefined;
    }

    /**
     * Register SPA navigation listeners for channel page overlay lifecycle
     * @returns {void}
     */
    function addNavigationListener() {
      if (!state.enabled || state.navigationListenerAttached || !channelStatsCtx) return;
      state.navigationListenerAttached = true;

      const _navHandler = () => {
        if (U.isChannelPage?.()) {
          ensureOverlayForCurrentPage();
          utils.log('Navigated to channel page');
        } else {
          clearExistingOverlay();
          state.currentChannelName = null;
          stopOverlayEnsureScheduler();
          utils.log('Navigated away from channel page');
        }
      };
      channelStatsCtx.listen(document, 'yt-navigate-finish', _navHandler, { passive: true });

      // Safety net: LazyLoader dispatches yp:nav-refresh after every SPA nav.
      // Re-render channel overlay so it appears when arriving at /@channel via
      // in-page navigation (not only on hard reload).
      const navRefreshHandler = () => {
        _navHandler();
      };
      channelStatsCtx.listen(window, 'yp:nav-refresh', navRefreshHandler, { passive: true });
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
    registerListenerSafe(window, 'beforeunload', cleanup);

    if (typeof window !== 'undefined') {
      window.YouTubePlusStats = Object.assign(window.YouTubePlusStats || {}, {
        init,
        cleanup,
      });
    }

    // Route-scoped overlay: styles, observers, navigation listeners and the
    // live-counter interval are acquired through the feature context, so
    // leaving the channel route releases them.
    channelStatsEnter = ctx => {
      channelStatsCtx = ctx;
      // The channel-stats flag is written by the settings modal's general
      // handler and the feature lifecycle restarts this feature on the change,
      // so re-read it on every entry instead of tracking it locally.
      state.enabled = window.YouTubePlusSettingsStore?.get?.(SETTINGS_KEY) !== false;
      addStyles();
      // Blob changes arrive through the unified event; only channelStats keys
      // matter. Re-read and re-apply so another tab's change reaches the overlay.
      ctx.listen(window, 'youtube-plus-settings-updated', (/** @type {Event} */ e) => {
        if (window.YouTubePlusSettingsStore?.affectsModule?.(e, MODULE_NAME) === false) return;
        loadChannelSettings();
        state.overlayOpacity = channelStatsSettings.opacity;
        state.updateInterval = channelStatsSettings.interval;
        if (state.overlay) {
          state.overlay.style.backgroundColor = `rgba(0, 0, 0, ${state.overlayOpacity})`;
        }
        updateDisplayState();
      });
      if (!state.enabled) return;
      observePageChanges();
      addNavigationListener();
      if (U.isChannelPage?.(location.href)) {
        getChannelInfo(location.href);
        ensureOverlayForCurrentPage();
      }
    };

    channelStatsExit = () => {
      clearExistingOverlay();
      stopOverlayEnsureScheduler();
      state.pageObserversAttached = false;
      state.navigationListenerAttached = false;
      channelStatsCtx = null;
    };

    // One-time module setup: fonts and default display flags. The route work
    // runs through channelStatsEnter once the feature starts.
    init();
  }; // end initChannelStats

  // The settings-modal listener stays at module scope so the experimental
  // toggle is wired on any page, matching where the settings UI opens.
  registerListenerSafe(document, 'youtube-plus-settings-modal-opened', initChannelStats, {
    once: false,
  });

  const channelStatsFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'channelStats',
    settingsKey: 'enableChannelStats',
    // The live-counter overlay belongs to the channel banner only.
    routes: ['channel'],
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      channelStatsCtx = ctx;
      initChannelStats();
      channelStatsEnter?.(ctx);
    },
    stop() {
      channelStatsExit?.();
    },
  });

  // Starts on the channel route, then follows navigation.
  U.onDomReady(() => channelStatsFeature?.sync());
})();
