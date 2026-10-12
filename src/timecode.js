// YouTube Timecode Panel (self-initializing IIFE).
//
// Responsibility: clickable timestamp links in video descriptions,
//   progress-bar chapter markers, and timecode navigation helpers.
//   Uses `__ytpTimeInitDone__` guard for idempotent boot.
// Public surface: window.YouTubePlusTimecode.
(function () {
  // Shared helpers from YouTubeUtils (boot shorthand)
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'Timecode');

  const { $, $$, byId, setTimeout_ } = U?.helpers ?? {};
  const throttle = U?.throttle;
  const waitForElement = U?.waitForElement;

  // Prevent multiple initializations
  if (window._timecodeModuleInitialized) return;
  window._timecodeModuleInitialized = true;

  // Shared translation helper from YouTubeUtils
  const t = window.YouTubeUtils?.t || ((/** @type {string} */ key) => key || '');
  const timecodeLogger = window.YouTubeUtils?.logger || null;

  /**
   * @typedef {Object} TimecodePanelPosition
   * @property {number} left
   * @property {number} top
   */

  /**
   * @typedef {Object} TimecodeShortcut
   * @property {string} key
   * @property {boolean} shiftKey
   * @property {boolean} altKey
   * @property {boolean} ctrlKey
   */

  /**
   * @typedef {Object} TimecodeSettings
   * @property {boolean} autoDetect
   * @property {TimecodeShortcut} shortcut
   * @property {string} storageKey
   * @property {boolean} autoSave
   * @property {boolean} autoTrackPlayback
   * @property {TimecodePanelPosition | null} panelPosition
   * @property {boolean} export
   */

  // Configuration. The on/off flag is the settings-store key
  // `timecodeEnabled`, driven by the FeatureLifecycle host; the module
  // preferences live in `modules.timecode` of the shared blob, with the legacy
  // key as the pre-blob fallback.
  /** @type {TimecodeSettings} */
  const config = {
    autoDetect: true,
    shortcut: { key: 'T', shiftKey: true, altKey: false, ctrlKey: false },
    storageKey: 'youtube_timecode_settings',
    autoSave: true,
    autoTrackPlayback: true,
    panelPosition: null,
    export: true,
  };

  /** Module namespace in the shared settings blob. */
  const MODULE_NAME = 'timecode';

  /** @returns {YouTubePlusSettingsStore | null} the store when the blob bridge is active */
  const bridgedStore = () => window.YouTubePlusSettingsStore?.moduleBridge?.() ?? null;

  /**
   * @typedef {Object} TimecodeDomCache
   * @property {HTMLElement | null} panel
   * @property {HTMLElement | null} list
   * @property {HTMLElement | null} empty
   * @property {HTMLElement | null} form
   * @property {HTMLInputElement | null} timeInput
   * @property {HTMLInputElement | null} labelInput
   * @property {HTMLElement | null} currentTime
   * @property {HTMLElement | null} trackToggle
   * @property {HTMLElement | null} reloadButton
   */

  /**
   * @typedef {Object} TimecodeState
   * @property {Map<string, Array<{ time: number, label: string }>>} timecodes
   * @property {TimecodeDomCache} dom
   * @property {boolean} isReloading
   * @property {number | null} activeIndex
   * @property {number} trackingId
   * @property {boolean} dragging
   * @property {number | null} editingIndex
   * @property {boolean} settingsIntegrationStarted
   */

  // State management
  /** @type {TimecodeState} */
  const state = {
    timecodes: new Map(),
    dom: {
      panel: null,
      list: null,
      empty: null,
      form: null,
      timeInput: null,
      labelInput: null,
      currentTime: null,
      trackToggle: null,
      reloadButton: null,
    },
    isReloading: false,
    activeIndex: null,
    trackingId: 0,
    dragging: false,
    editingIndex: null,
    settingsIntegrationStarted: false,
  };

  let initStarted = false;

  // Runtime resources follow the FeatureLifecycle contract
  // (feature-registry.js): `timecodeCtx` exists only while the
  // `timecodeEnabled` setting is on; `uiScope` owns the living panel group
  // when it has been opened, and `timeUpdateRelease`/`resizeRelease` keep
  // the releases handed out by the context.
  /** @type {FeatureContext | null} */
  let timecodeCtx = null;
  /** @type {FeatureScope | null} */
  let uiScope = null;
  /** @type {(() => void) | null} */
  let timeUpdateRelease = null;

  const TIMECODE_STYLE_ID = 'timecode-panel-styles';

  const isRelevantRoute = U.createIsRelevantRoute({ watch: true });

  const scheduleInitRetry = () => {
    const retryScheduler = U.createRetryScheduler;
    if (typeof retryScheduler === 'function') {
      retryScheduler({
        label: 'timecode-init',
        interval: 120,
        maxAttempts: 30,
        check: () => {
          const root = $('ytd-app');
          if (!root) return false;
          init();
          return true;
        },
      });
      return;
    }

    const rafId = window.YouTubePlusCleanupManager?.registerAnimationFrame?.(
      requestAnimationFrame(init)
    );
    YouTubeUtils.cleanupManager?.registerAnimationFrame?.(rafId);
  };

  const parseLeadingTimestampToken = (/** @type {string} */ input) => {
    const s = String(input || '');
    let i = 0;
    const readNumber = () => {
      const start = i;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i += 1;
      return i > start ? s.slice(start, i) : '';
    };

    const a = readNumber();
    if (!a || i >= s.length || s[i] !== ':') return null;
    i += 1;
    const b = readNumber();
    if (b.length !== 2) return null;

    if (i < s.length && s[i] === ':') {
      i += 1;
      const c = readNumber();
      if (c.length !== 2) return null;
      return { token: `${a}:${b}:${c}`, length: i };
    }

    return { token: `${a}:${b}`, length: i };
  };

  const stripLeadingTimePrefix = (/** @type {string} */ value) => {
    const input = String(value || '').trimStart();
    const parsed = parseLeadingTimestampToken(input);
    if (!parsed) return input;

    let rest = input.slice(parsed.length).trimStart();
    if (
      rest.startsWith('-') ||
      rest.startsWith('–') ||
      rest.startsWith('—') ||
      rest.startsWith(':')
    ) {
      rest = rest.slice(1).trimStart();
    }

    return rest;
  };

  // Utilities
  /**
   * Load settings from storage with error handling
   * @returns {void}
   */
  const mergeShortcutConfig_ = (/** @type {Record<string, unknown> | null | undefined} */ sc) => {
    if (!sc || typeof sc !== 'object') return;
    if (typeof sc.key === 'string') config.shortcut.key = sc.key;
    if (typeof sc.shiftKey === 'boolean') config.shortcut.shiftKey = sc.shiftKey;
    if (typeof sc.altKey === 'boolean') config.shortcut.altKey = sc.altKey;
    if (typeof sc.ctrlKey === 'boolean') config.shortcut.ctrlKey = sc.ctrlKey;
  };

  const mergePanelPositionConfig_ = (
    /** @type {Record<string, unknown> | null | undefined} */ pos
  ) => {
    if (!pos || typeof pos !== 'object') return;
    const { left, top } = pos;
    if (
      typeof left === 'number' &&
      typeof top === 'number' &&
      !Number.isNaN(left) &&
      !Number.isNaN(top) &&
      left >= 0 &&
      top >= 0
    ) {
      config.panelPosition = { left, top };
    }
  };

  /**
   * Apply a stored settings object to the live config.
   * @param {Record<string, unknown> | null | undefined} parsed
   */
  const applyTimecodeSettings_ = parsed => {
    if (!parsed || typeof parsed !== 'object') return;
    if (typeof parsed.autoDetect === 'boolean') config.autoDetect = parsed.autoDetect;
    if (typeof parsed.autoSave === 'boolean') config.autoSave = parsed.autoSave;
    if (typeof parsed.autoTrackPlayback === 'boolean') {
      config.autoTrackPlayback = parsed.autoTrackPlayback;
    }
    if (typeof parsed.export === 'boolean') config.export = parsed.export;
    mergeShortcutConfig_(/** @type {Record<string, unknown>} */ (parsed.shortcut));
    mergePanelPositionConfig_(/** @type {Record<string, unknown>} */ (parsed.panelPosition));
  };

  /** @returns {Record<string, unknown> | null | undefined} legacy key payload */
  const readLegacySettings = () => {
    return /** @type {Record<string, unknown> | null | undefined} */ (
      U?.storage?.get(config.storageKey)
    );
  };

  /**
   * Load settings. From `modules.timecode` once the blob exists (migrating the
   * legacy key on first read), otherwise from the legacy key.
   */
  const loadSettings = () => {
    try {
      const store = bridgedStore();
      if (store) {
        const mod = store.getModuleSettings(MODULE_NAME);
        if (mod && Object.keys(mod).length) {
          applyTimecodeSettings_(mod);
          return;
        }
        applyTimecodeSettings_(readLegacySettings());
        saveSettings();
        return;
      }
      applyTimecodeSettings_(readLegacySettings());
    } catch (error) {
      logS(error);
      timecodeLogger?.error?.('Timecode', 'Error loading settings', error);
    }
  };

  /**
   * Save settings through the shared bridge, or the legacy key before the blob.
   * @returns {void}
   */
  const saveSettings = () => {
    const settingsToSave = {
      autoDetect: config.autoDetect,
      shortcut: config.shortcut,
      autoSave: config.autoSave,
      autoTrackPlayback: config.autoTrackPlayback,
      panelPosition: config.panelPosition,
      export: config.export,
    };
    const store = bridgedStore();
    if (store) {
      store.updateModuleSettings(MODULE_NAME, settingsToSave);
      return;
    }
    try {
      U?.storage?.set(config.storageKey, settingsToSave);
    } catch (error) {
      logS(error);
      timecodeLogger?.error?.('Timecode', 'Error saving settings', error);
    }
  };

  /**
   * Clamp panel position within viewport bounds
   * @param {HTMLElement | null | undefined} panel - Panel element
   * @param {number} left - Desired left position
   * @param {number} top - Desired top position
   * @returns {{left: number, top: number}} Clamped position
   */
  const clampPanelPosition = (panel, left, top) => {
    if (!(panel && panel instanceof HTMLElement)) {
      timecodeLogger?.warn?.('Timecode', 'Invalid panel element');
      return { left: 0, top: 0 };
    }

    if (
      typeof left !== 'number' ||
      typeof top !== 'number' ||
      Number.isNaN(left) ||
      Number.isNaN(top)
    ) {
      timecodeLogger?.warn?.('Timecode', 'Invalid position coordinates');
      return { left: 0, top: 0 };
    }

    const rect = panel.getBoundingClientRect();
    const width = rect.width || 0;
    const height = rect.height || 0;

    const maxLeft = Math.max(0, window.innerWidth - width);
    const maxTop = Math.max(0, window.innerHeight - height);

    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  };

  /**
   * Apply clamped position to panel element
   * @param {HTMLElement} panel - Panel element to position
   * @param {number} left - Desired left position
   * @param {number} top - Desired top position
   * @param {boolean} [persist=false] - Whether to save position to storage
   * @returns {void}
   */
  const applyClampedPosition = (panel, left, top, persist = false) => {
    const { left: clampedLeft, top: clampedTop } = clampPanelPosition(panel, left, top);
    panel.style.left = `${clampedLeft}px`;
    panel.style.top = `${clampedTop}px`;
    panel.style.right = 'auto';
    if (persist) {
      savePanelPosition(clampedLeft, clampedTop);
    }
  };

  /**
   * Save panel position to configuration and storage
   * @param {number} left - X coordinate in pixels
   * @param {number} top - Y coordinate in pixels
   * @returns {void}
   */
  const savePanelPosition = (left, top) => {
    if (
      typeof left !== 'number' ||
      typeof top !== 'number' ||
      Number.isNaN(left) ||
      Number.isNaN(top)
    ) {
      timecodeLogger?.warn?.('Timecode', 'Invalid position coordinates for saving');
      return;
    }
    config.panelPosition = { left, top };
    saveSettings();
  };

  /**
   * Apply saved panel position to a panel element
   * @param {HTMLElement | null | undefined} panel - The panel element to position
   * @returns {void}
   */
  const applySavedPanelPosition = panel => {
    if (!(panel && config.panelPosition)) return;

    window.YouTubePlusCleanupManager?.registerAnimationFrame?.(
      requestAnimationFrame(() => {
        const pos = config.panelPosition;
        if (!pos) return;
        applyClampedPosition(panel, pos.left, pos.top, false);
      })
    );
  };

  /**
   * Display a notification message to the user
   * @param {string} message - The message to display
   * @param {number} [duration=2000] - Duration in milliseconds
   * @param {string} [type='info'] - Notification type (info, success, warning, error)
   * @returns {void}
   */
  const showNotification = (message, duration = 2000, type = 'info') => {
    YouTubeUtils.NotificationManager.show(message, { duration, type });
  };

  const formatTime = (/** @type {number} */ seconds) =>
    window.YouTubeUtils?.formatTime?.(seconds) || '0:00';

  /**
   * Remove duplicate text patterns from a string
   * @param {string} text - Text to deduplicate
   * @returns {string} Deduplicated text
   */
  const removeDuplicateText = text => {
    if (!text || text.length < 10) return text;

    let cleaned = text.trim();

    // Remove trailing ellipsis and truncation markers
    cleaned = cleaned.replace(/\s*\.{2,}$/, '').replace(/\s*…$/, '');

    const words = cleaned.split(/\s+/);
    if (words.length < 4) return cleaned; // Too short to have meaningful duplicates

    // Try exact half split first
    const half = Math.floor(words.length / 2);
    if (half >= 2) {
      const firstHalf = words.slice(0, half).join(' ');
      const secondHalf = words.slice(half, half * 2).join(' ');
      if (firstHalf === secondHalf) {
        return firstHalf;
      }
    }

    return findRepeatingWordPattern(words) || cleaned;
  };

  /**
   * Sliding-window search for the longest repeating word pattern in the text
   * @param {string[]} words - Words of the cleaned text
   * @returns {string|null} The repeating pattern, or null if none found
   */
  const findRepeatingWordPattern = words => {
    const minPatternLength = Math.max(2, Math.floor(words.length / 4));
    const maxPatternLength = Math.floor(words.length / 2);

    for (let len = maxPatternLength; len >= minPatternLength; len--) {
      const pattern = words.slice(0, len).join(' ');
      const patternWords = words.slice(0, len);

      // Check if this pattern appears again anywhere in the text
      for (let offset = 1; offset <= words.length - len; offset++) {
        const testWords = words.slice(offset, Math.min(offset + len, words.length));
        const { matchCount, partialWordMatch } = scorePatternMatch(patternWords, testWords);

        // If 70%+ of the pattern matches (allowing for partial words), it's a duplicate
        const similarity = matchCount / patternWords.length;
        const effectiveMatches = Math.floor(matchCount);
        if (
          similarity >= 0.7 &&
          (effectiveMatches >= 2 || (matchCount >= 1.5 && partialWordMatch))
        ) {
          return pattern;
        }
      }
    }

    return null;
  };

  /**
   * Score how well a pattern matches a candidate word window (partial words get 0.8 credit)
   * @param {string[]} patternWords - Reference pattern words
   * @param {string[]} testWords - Candidate words
   * @returns {{matchCount: number, partialWordMatch: boolean}}
   */
  const scorePatternMatch = (patternWords, testWords) => {
    let matchCount = 0;
    let partialWordMatch = false;

    for (let i = 0; i < patternWords.length; i++) {
      const patternWord = patternWords[i];
      const testWord = testWords[i];

      if (!testWord) break;

      // Exact match
      if (patternWord === testWord) {
        matchCount++;
      }
      // Partial match (for truncated words like "сте..." vs "стекла")
      else if (testWord.length >= 3 && patternWord.startsWith(testWord)) {
        matchCount += 0.8; // Partial credit
        partialWordMatch = true;
      } else if (patternWord.length >= 3 && testWord.startsWith(patternWord)) {
        matchCount += 0.8; // Partial credit
        partialWordMatch = true;
      }
    }

    return { matchCount, partialWordMatch };
  };

  /**
   * Remove duplicates from timecode label and log result
   * @param {string} before - Label before deduplication
   * @param {string} after - Label after deduplication
   * @param {string} context - Log message context ('Description' | 'Removed' | 'Display')
   * @returns {void}
   */
  const logTimecodeDeduplication = (before, after, context) => {
    if (before !== after && after.length > 0) {
      const messages = {
        Description: `Description deduplicated: ${before} -> ${after}`,
        Removed: `Removed duplicate: ${before} -> ${after}`,
        Display: `Display deduplicated: ${before} -> ${after}`,
      };
      const message = messages[/** @type {keyof typeof messages} */ (context)] || messages.Display;
      timecodeLogger?.warn?.('Timecode', message);
    }
  };

  const parseHms_ = (/** @type {string} */ str) => {
    const match = str.match(/^(\d+):(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const [, h, m, s] = match.map(Number);
    if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s)) return null;
    if (m >= 60 || s >= 60 || h < 0 || m < 0 || s < 0) return null;
    const total = h * 3600 + m * 60 + s;
    return total <= 86400 ? total : null;
  };

  const parseMs_ = (/** @type {string} */ str) => {
    const match = str.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const [, m, s] = match.map(Number);
    if (Number.isNaN(m) || Number.isNaN(s)) return null;
    if (m >= 60 || s >= 60 || m < 0 || s < 0) return null;
    return m * 60 + s;
  };

  /**
   * Parse time string to seconds with validation
   * @param {string | null | undefined} timeStr - Time string (MM:SS or HH:MM:SS)
   * @returns {number|null} Seconds or null if invalid
   */
  const parseTime = timeStr => {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const str = timeStr.trim();
    if (str.length === 0 || str.length > 12) return null;
    return parseHms_(str) ?? parseMs_(str);
  };

  const parseTimecodeLine_ = (/** @type {string} */ line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const timeMatch = parseLeadingTimestampToken(trimmed);
    if (!timeMatch) return null;

    const time = parseTime(timeMatch.token);
    if (time === null) return null;

    let label = stripLeadingTimePrefix(trimmed.slice(timeMatch.length))
      .trim()
      .replace(/^\d+[.)]\s*/, '')
      .replace(/\s+/g, ' ')
      .substring(0, 100);

    const originalLabel = label;
    label = removeDuplicateText(label.replace(/[<>"']/g, ''));
    logTimecodeDeduplication(originalLabel, label, 'Description');

    return {
      time,
      label: label || '',
      originalText: timeMatch.token,
    };
  };

  /**
   * Extract timecodes from text with validation
   * @param {string | null | undefined} text - Text containing timecodes
   * @returns {Array<{time: number, label: string, originalText: string}>} Extracted timecodes
   */
  const extractTimecodes = text => {
    if (!text || typeof text !== 'string') return [];

    const safeText = text.length > 50000 ? text.substring(0, 50000) : text;
    if (text.length > 50000) {
      timecodeLogger?.warn?.('Timecode', 'Text too long, truncating');
    }

    const lines = safeText.replace(/\r/g, '').split('\n');
    const maxIterations = 1000;
    const byTime = new Map();

    const limit = Math.min(lines.length, maxIterations);
    for (let i = 0; i < limit; i += 1) {
      const parsed = parseTimecodeLine_(lines[i]);
      if (!parsed) continue;

      const existing = byTime.get(parsed.time);
      if (!existing || (parsed.label || '').length > (existing.label || '').length) {
        byTime.set(parsed.time, parsed);
      }
    }

    if (lines.length > maxIterations) {
      timecodeLogger?.warn?.('Timecode', 'Maximum iterations reached during extraction');
    }

    return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  };

  const DESCRIPTION_SELECTORS = [
    '#description-inline-expander yt-attributed-string',
    '#description-inline-expander yt-formatted-string',
    '#description-inline-expander ytd-text-inline-expander',
    '#description-inline-expander .yt-core-attributed-string',
    '#description ytd-text-inline-expander',
    '#description ytd-expandable-video-description-body-renderer',
    '#description.ytd-watch-metadata yt-formatted-string',
    '#description.ytd-watch-metadata #description-inline-expander',
    '#tab-info ytd-expandable-video-description-body-renderer yt-formatted-string',
    '#tab-info ytd-expandable-video-description-body-renderer yt-attributed-string',
    '#structured-description ytd-text-inline-expander',
    '#structured-description yt-formatted-string',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"] yt-formatted-string',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"] yt-attributed-string',
    'ytd-watch-metadata #description',
    'ytd-watch-metadata #description-inline-expander',
    '#description',
  ];

  const DESCRIPTION_SELECTOR_COMBINED = DESCRIPTION_SELECTORS.join(',');

  const DESCRIPTION_EXPANDERS = [
    '#description-inline-expander yt-button-shape button',
    '#description-inline-expander tp-yt-paper-button#expand',
    '#description-inline-expander tp-yt-paper-button[aria-label]',
    'ytd-watch-metadata #description-inline-expander yt-button-shape button',
    'ytd-text-inline-expander[collapsed] yt-button-shape button',
    'ytd-text-inline-expander[collapsed] tp-yt-paper-button#expand',
    'ytd-expandable-video-description-body-renderer #expand',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"] #expand',
  ];

  /**
   * Sleep/delay utility using Promises
   * @param {number} [ms=250] - Milliseconds to wait
   * @returns {Promise<void>}
   */
  const sleep = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Collect and concatenate text from video description using multiple selectors
   * @returns {string} Concatenated description text
   */
  const collectDescriptionText = () => {
    /** @type {string[]} */
    const snippets = [];
    DESCRIPTION_SELECTORS.forEach(selector => {
      $$(selector).forEach(node => {
        const text = node?.textContent?.trim();
        if (text) {
          snippets.push(text);
        }
      });
    });
    return snippets.join('\n');
  };

  // Collect visible comments text (top-level few comments) to search for timecodes
  const COMMENT_SELECTORS = [
    'ytd-comment-thread-renderer #content-text',
    'ytd-comment-renderer #content-text',
    'ytd-comment-thread-renderer yt-formatted-string#content-text',
    'ytd-comment-renderer yt-formatted-string#content-text',
    '#comments ytd-comment-thread-renderer #content-text',
  ];

  /**
   * Collect text from visible comments to search for timecodes
   * @param {number} [maxComments=30] - Maximum number of comments to collect
   * @returns {string} Concatenated comments text
   */
  const collectCommentsText = (maxComments = 30) => {
    /** @type {string[]} */
    const snippets = [];
    for (const sel of COMMENT_SELECTORS) {
      $$(sel).forEach(node => {
        if (snippets.length >= maxComments) return;
        const text = node?.textContent?.trim();
        if (text) snippets.push(text);
      });
      if (snippets.length >= maxComments) break;
    }
    return snippets.join('\n');
  };

  const expandDescriptionIfNeeded = async () => {
    for (const selector of DESCRIPTION_EXPANDERS) {
      const button = $(selector);
      if (!button) continue;

      const ariaExpanded = button.getAttribute('aria-expanded');
      if (ariaExpanded === 'true') return false;

      const ariaLabel = button.getAttribute('aria-label')?.toLowerCase();
      if (ariaLabel?.includes('less')) return false;

      if (
        /** @type {HTMLElement} */ (button).offsetParent !== null &&
        button instanceof HTMLElement
      ) {
        button.click();
        await sleep(400);
        return true;
      }
    }

    const inlineExpander = $('ytd-text-inline-expander[collapsed]');
    if (inlineExpander) {
      inlineExpander.removeAttribute('collapsed');
      await sleep(300);
      return true;
    }

    return false;
  };

  const ensureDescriptionReady = async () => {
    const initialText = collectDescriptionText();
    if (initialText) return;

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await waitForElement(DESCRIPTION_SELECTOR_COMBINED, 1500);
      } catch (_e) {
        logS(_e);
        // Continue trying
      }

      await sleep(200);
      const expanded = await expandDescriptionIfNeeded();

      await sleep(expanded ? 500 : 200);
      const text = collectDescriptionText();

      if (text && text.length > initialText.length) {
        return;
      }
    }
  };
  const getCurrentVideoId = () => U.getVideoIdFromLocation();

  // Detection
  const checkDetectionCache_ = (/** @type {string} */ videoId, /** @type {boolean} */ force) => {
    const cacheKey = `detect_${videoId}`;
    if (!force && state.timecodes.has(cacheKey)) {
      const cached = state.timecodes.get(cacheKey);
      if (Array.isArray(cached) && cached.length) return { cacheKey, cached };
      state.timecodes.delete(cacheKey);
    }
    return { cacheKey, cached: null };
  };

  const mergeChaptersIntoMap_ = (
    /** @type {Map<string, { time: number, label: string, isChapter?: boolean }>} */ uniqueMap,
    /** @type {Array<{ time: number, label: string, isChapter?: boolean }>} */ chapters
  ) => {
    for (const chapter of chapters) {
      if (chapter.time < 0) continue;
      const key = chapter.time.toString();
      const existing = uniqueMap.get(key);
      if (existing && chapter.label && chapter.label.length > existing.label.length) {
        uniqueMap.set(key, { ...existing, label: chapter.label, isChapter: true });
      } else if (!existing) {
        uniqueMap.set(key, chapter);
      } else {
        uniqueMap.set(key, { ...existing, isChapter: true });
      }
    }
  };

  const scanCommentsIfEmpty_ = (
    /** @type {Map<string, { time: number, label: string, isChapter?: boolean }>} */ uniqueMap
  ) => {
    if (uniqueMap.size > 0) return;
    const commentsText = collectCommentsText();
    if (!commentsText) return;
    const extractedComments = extractTimecodes(commentsText);
    for (const tc of extractedComments) {
      if (tc.time >= 0) uniqueMap.set(tc.time.toString(), tc);
    }
  };

  const applyDetectedResults_ = (
    /** @type {string} */ cacheKey,
    /** @type {Array<{ time: number, label: string }>} */ result,
    /** @type {boolean} */ force
  ) => {
    const hadExisting = Boolean(state.dom.list?.childElementCount);
    if (result.length > 0) {
      updateTimecodePanel(result);
      state.timecodes.set(cacheKey, result);
      if (config.autoSave) saveTimecodesToStorage(result);
    } else {
      if (force || !hadExisting) updateTimecodePanel([]);
      if (force) state.timecodes.delete(cacheKey);
    }
  };

  /**
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<Array<{ time: number, label: string }>>}
   */
  const detectTimecodes = async (options = {}) => {
    const { force = false } = options;
    if (!(force || config.autoDetect)) return [];

    const videoId = getCurrentVideoId();
    if (!videoId) return [];

    const { cacheKey, cached } = checkDetectionCache_(videoId, force);
    if (cached) return cached;

    await ensureDescriptionReady();

    /** @type {Map<string, { time: number, label: string, isChapter?: boolean }>} */
    const uniqueMap = new Map();
    const descriptionText = collectDescriptionText();
    if (descriptionText) {
      for (const tc of extractTimecodes(descriptionText)) {
        if (tc.time >= 0) uniqueMap.set(tc.time.toString(), tc);
      }
    }

    mergeChaptersIntoMap_(uniqueMap, getYouTubeChapters());
    scanCommentsIfEmpty_(uniqueMap);

    const result = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
    applyDetectedResults_(cacheKey, result, force);
    return result;
  };

  /**
   * Reload timecodes by re-detecting them from the current video
   * @param {HTMLElement|null} [buttonOverride=null] - Optional reload button element
   * @returns {Promise<void>}
   */
  const reloadTimecodes = async (buttonOverride = null) => {
    const button = /** @type {HTMLButtonElement | null} */ (
      buttonOverride || state.dom.reloadButton || byId('timecode-reload')
    );

    if (state.isReloading) return;

    state.isReloading = true;
    if (button) {
      button.disabled = true;
      button.classList.add('loading');
    }

    try {
      const result = await detectTimecodes({ force: true });

      if (Array.isArray(result) && result.length) {
        showNotification(t('foundTimecodes').replace('{count}', String(result.length)));
      } else {
        updateTimecodePanel([]);
        showNotification(t('noTimecodesFound'));
      }
    } catch (error) {
      logS(error);
      YouTubeUtils.logError('TimecodePanel', 'Reload failed', /** @type {unknown} */ (error));
      showNotification(t('reloadError'));
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('loading');
      }
      state.isReloading = false;
    }
  };

  const queryFirstText_ = (/** @type {Element} */ root, /** @type {string[]} */ selectors) => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el?.textContent) return el.textContent;
    }
    return null;
  };

  const extractChapterItem_ = (/** @type {Element} */ item) => {
    const timeSelectors = ['.time-info', '.timestamp', '#time', 'span[id*="time"]'];
    const titleSelectors = ['.marker-title', '.chapter-title', '#details', 'h4', '.title'];

    const timeText = queryFirstText_(item, timeSelectors);
    if (!timeText) return null;
    const time = parseTime(timeText.trim());
    if (time === null) return null;

    const titleText = queryFirstText_(item, titleSelectors);
    let cleanTitle = titleText?.trim().replace(/\s+/g, ' ') || '';
    if (cleanTitle.length > 0) {
      timecodeLogger?.warn?.('Timecode', `Debug raw chapter title: ${cleanTitle}`);
    }
    cleanTitle = stripLeadingTimePrefix(cleanTitle);
    const deduplicated = removeDuplicateText(cleanTitle);
    logTimecodeDeduplication(cleanTitle, deduplicated, 'Removed');

    return {
      time,
      label: deduplicated,
      isChapter: true,
    };
  };

  /**
   * Extract chapter markers from YouTube's native chapter system
   * @returns {Array<{time: number, label: string, isChapter: boolean}>} Array of chapter objects
   */
  const getYouTubeChapters = () => {
    const selectors = [
      'ytd-macro-markers-list-item-renderer',
      'ytd-chapter-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id*="description-chapters"] ytd-macro-markers-list-item-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id*="description-chapters"] #details',
      '#structured-description ytd-horizontal-card-list-renderer ytd-macro-markers-list-item-renderer',
    ];

    const items = $$(selectors.join(', '));
    const chapters = new Map();
    for (const item of items) {
      const chapter = extractChapterItem_(item);
      if (chapter) chapters.set(chapter.time.toString(), chapter);
    }
    return Array.from(chapters.values()).sort((a, b) => a.time - b.time);
  };

  const updateTimecodeSubmenuState_ = (
    /** @type {Element} */ enableItem,
    /** @type {Element | null} */ submenuWrap,
    /** @type {boolean} */ checked
  ) => {
    const submenuToggle = enableItem.querySelector('.yp-submenu-toggle[data-submenu="timecode"]');
    if (!(submenuToggle instanceof HTMLElement)) return;

    if (checked) {
      const stored = window.YouTubePlusSettingsHelpers?.readSubmenuExpanded?.('timecode') ?? null;
      const nextExpanded = typeof stored === 'boolean' ? stored : true;
      submenuToggle.removeAttribute('disabled');
      submenuToggle.classList.remove('timecode-submenu-toggle-hidden');
      submenuToggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
      if (submenuWrap instanceof HTMLElement)
        submenuWrap.classList.toggle('is-hidden', !nextExpanded);
    } else {
      submenuToggle.setAttribute('disabled', '');
      submenuToggle.classList.add('timecode-submenu-toggle-hidden');
      if (submenuWrap instanceof HTMLElement) submenuWrap.classList.add('is-hidden');
    }
  };

  const handleTimecodeCheckboxChange_ = (
    /** @type {HTMLInputElement} */ enableCheckbox,
    /** @type {Element} */ enableItem,
    /** @type {Element | null} */ submenuWrap
  ) => {
    const checked = enableCheckbox.checked;
    window.YouTubePlusSettingsStore?.set?.('timecodeEnabled', checked);
    updateTimecodeSubmenuState_(enableItem, submenuWrap, checked);
    if (checked) {
      toggleTimecodePanel(true);
    } else if (!timecodeCtx && state.dom.panel) {
      cleanup();
    }
  };

  // Settings panel
  const attachTimecodeHandlers = () => {
    ensureTimecodeStyles();
    const advancedSection = $('.yp-settings-section[data-section="advanced"]');
    if (!advancedSection) return;
    const enableItem = advancedSection.querySelector('.timecode-settings-item');
    if (!enableItem || /** @type {HTMLElement} */ (enableItem).dataset.handlerAttached) return;
    /** @type {HTMLElement} */ (enableItem).dataset.handlerAttached = '1';

    const submenuWrap = advancedSection.querySelector('.timecode-submenu[data-submenu="timecode"]');

    window.YouTubePlusDesignSystem?.initGlassDropdown?.({
      dropdown: byId('timecode-modifier-dropdown'),
      hiddenSelect: byId('timecode-modifier-combo'),
    });

    const enableCheckbox = byId('timecode-enable-checkbox');
    if (enableCheckbox instanceof HTMLInputElement) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        enableCheckbox,
        'change',
        () => handleTimecodeCheckboxChange_(enableCheckbox, enableItem, submenuWrap),
        undefined,
        false
      );
    }

    const modifierCombo = byId('timecode-modifier-combo');
    if (modifierCombo instanceof HTMLSelectElement) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        modifierCombo,
        'change',
        _e => {
          const value = modifierCombo.value;
          config.shortcut.ctrlKey = value.includes('ctrl');
          config.shortcut.altKey = value.includes('alt');
          config.shortcut.shiftKey = value.includes('shift');
          saveSettings();
        },
        undefined,
        false
      );
    }

    const keyInput = byId('timecode-key');
    if (keyInput instanceof HTMLInputElement) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        keyInput,
        'input',
        _e => {
          if (keyInput.value) {
            config.shortcut.key = keyInput.value.toUpperCase();
            saveSettings();
          }
        },
        undefined,
        false
      );
      window.YouTubePlusCleanupManager?.registerListener?.(
        keyInput,
        'keydown',
        (/** @type {KeyboardEvent} */ e) => {
          e.stopPropagation();
        },
        undefined,
        false
      );
    }
  };

  // The panel and settings-submenu CSS enter through the feature ctx right
  // before that UI is built, not at start: a watch page that never opens the
  // panel pays nothing for its rules.
  let timecodeStylesAdded = false;
  const ensureTimecodeStyles = () => {
    if (timecodeStylesAdded || !timecodeCtx) return;
    timecodeStylesAdded = true;
    timecodeCtx.style(
      TIMECODE_STYLE_ID,
      window.YouTubePlusDesignSystem?.getStyle?.(TIMECODE_STYLE_ID) || ''
    );
  };

  // Panel creation
  const createTimecodePanel = () => {
    if (state.dom.panel) return state.dom.panel;
    ensureTimecodeStyles();

    // Remove any existing panels (for redundancy)
    $$('#timecode-panel').forEach(p => p.remove());

    const panel = document.createElement('div');
    panel.id = 'timecode-panel';
    panel.className = '';
    if (config.autoTrackPlayback) panel.classList.add('auto-tracking');

    window.YouTubeUtils.renderTemplateClone(
      panel,
      `
        <div id="timecode-header">
          <h3 id="timecode-title">
            <div id="timecode-tracking-indicator"></div>
            ${t('timecodes')}
            <span id="timecode-current-time"></span>
          </h3>
          <div id="timecode-header-controls">
            <button id="timecode-reload" title="${t('reload')}" aria-label="${t('reload')}">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6"/>
                <path d="M19.13 11.48A10 10 0 0 0 12 2C6.48 2 2 6.48 2 12c0 .34.02.67.05 1M4.87 12.52A10 10 0 0 0 12 22c5.52 0 10-4.48 10-10 0-.34-.02-.67-.05-1"/>
              </svg>
            </button>
            <button id="timecode-close" title="${t('close')}" aria-label="${t('close')}">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6L18 18M18 6L6 18"/>
              </svg>
            </button>
          </div>
        </div>
        <div id="timecode-list"></div>
        <div id="timecode-empty">
          <div>${t('noTimecodesFound')}</div>
          <div class="timecode-empty-hint">${t('clickToAdd')}</div>
        </div>
        <div id="timecode-form">
          <input type="text" id="timecode-form-time" placeholder="${t('timePlaceholder')}">
          <input type="text" id="timecode-form-label" placeholder="${t('labelPlaceholder')}">
          <div id="timecode-form-buttons">
            <button type="button" id="timecode-form-cancel">${t('cancel')}</button>
            <button type="button" id="timecode-form-save" class="save">${t('saveButton')}</button>
          </div>
        </div>
        <div id="timecode-actions">
          <button id="timecode-add-btn">${t('add')}</button>
          <button id="timecode-export-btn" class="${config.export ? '' : 'is-hidden'}">${t('export')}</button>
          <button id="timecode-track-toggle" class="${config.autoTrackPlayback ? 'active' : ''}">${config.autoTrackPlayback ? t('tracking') : t('track')}</button>
        </div>
      `
    );

    // Cache DOM elements
    state.dom = {
      panel,
      list: panel.querySelector('#timecode-list'),
      empty: panel.querySelector('#timecode-empty'),
      form: panel.querySelector('#timecode-form'),
      timeInput: panel.querySelector('#timecode-form-time'),
      labelInput: panel.querySelector('#timecode-form-label'),
      currentTime: panel.querySelector('#timecode-current-time'),
      trackToggle: panel.querySelector('#timecode-track-toggle'),
      reloadButton: panel.querySelector('#timecode-reload'),
    };

    // The living panel group: when the feature ctx is running, the panel
    // element, its delegations and its drag listeners are owned by a
    // scope that stops with the feature; manual callers keep the
    // CleanupManager registrations.
    const scope = timecodeCtx?.scope?.() ?? null;
    if (scope) {
      uiScope?.dispose();
      uiScope = scope;
      scope.own(panel);
      scope.onDispose(resetDomRefs);
    }

    // Event delegation
    const delegator = window.YouTubePlusEventDelegation;
    if (delegator?.on) {
      /** @type {(() => void)[]} */
      const offs = [];
      /**
       * Register one panel delegation and collect its release.
       * @param {string} selector
       * @param {(e: Event, el: HTMLElement) => void} handler
       */
      const onPanelClick = (selector, handler) => {
        const off = delegator.on(panel, 'click', selector, handler);
        if (typeof off === 'function') offs.push(off);
      };

      onPanelClick('#timecode-reload', (/** @type {Event} */ e, /** @type {HTMLElement} */ el) => {
        e.preventDefault();
        reloadTimecodes(el);
      });
      onPanelClick('#timecode-close', () => {
        toggleTimecodePanel(false);
      });
      onPanelClick('#timecode-add-btn', () => {
        const video = /** @type {HTMLVideoElement | null} */ ($('video'));
        if (video) showTimecodeForm(video.currentTime);
      });
      onPanelClick(
        '#timecode-track-toggle',
        (/** @type {Event} */ _e, /** @type {HTMLElement} */ el) => {
          config.autoTrackPlayback = !config.autoTrackPlayback;
          el.textContent = config.autoTrackPlayback ? t('tracking') : t('track');
          el.classList.toggle('active', config.autoTrackPlayback);
          state.dom.panel?.classList.toggle('auto-tracking', config.autoTrackPlayback);
          saveSettings();
          if (config.autoTrackPlayback) startTracking();
        }
      );
      onPanelClick('#timecode-export-btn', () => {
        exportTimecodes();
      });
      onPanelClick('#timecode-form-cancel', () => {
        hideTimecodeForm();
      });
      onPanelClick('#timecode-form-save', () => {
        saveTimecodeForm();
      });
      onPanelClick('.timecode-action', (/** @type {Event} */ e, /** @type {HTMLElement} */ el) => {
        e.stopPropagation();
        const action = el.dataset.action;
        const parentItem = /** @type {HTMLElement | null} */ (el.closest('.timecode-item'));
        const index = parseInt(parentItem?.dataset?.index ?? '', 10);
        if (action === 'edit') {
          editTimecode(index);
        } else if (action === 'delete') {
          deleteTimecode(index);
        }
      });
      onPanelClick('.timecode-item', (/** @type {Event} */ e, /** @type {HTMLElement} */ el) => {
        const evtTarget = /** @type {HTMLElement | null} */ (e.target);
        if (evtTarget?.closest('.timecode-actions')) return;
        const time = parseFloat(el.dataset.time ?? '');
        const video = /** @type {HTMLVideoElement | null} */ ($('video'));
        if (video && !Number.isNaN(time)) {
          /** @type {HTMLVideoElement} */ (video).currentTime = time;
          if (video.paused) video.play();
          updateActiveItem(el);
        }
      });
      if (scope) {
        scope.onDispose(() => {
          for (const off of offs) off?.();
        });
      }
    } else {
      window.YouTubePlusCleanupManager?.registerListener?.(
        panel,
        'click',
        handlePanelClick,
        undefined,
        false
      );
    }
    makeDraggable(panel, scope);

    document.body.appendChild(panel);
    applySavedPanelPosition(panel);
    return panel;
  };

  // Event handling
  const closestById = (/** @type {Element} */ target, /** @type {string} */ id) =>
    /** @type {HTMLElement | null} */ (
      target.closest ? target.closest(id) : target.id === id ? target : null
    );

  const handleChromeButtons = (/** @type {Event} */ e, /** @type {Element} */ target) => {
    const reloadButton = closestById(target, '#timecode-reload');
    if (reloadButton) {
      e.preventDefault();
      reloadTimecodes(reloadButton);
      return true;
    }
    if (closestById(target, '#timecode-close')) {
      toggleTimecodePanel(false);
      return true;
    }
    return false;
  };

  const handleItemAction = (/** @type {Event} */ e, /** @type {HTMLElement} */ target) => {
    e.stopPropagation();
    const action = target.dataset.action;
    const parent = target.closest('.timecode-item');
    const index = parseInt(/** @type {HTMLElement} */ (parent)?.dataset?.index || '', 10);
    if (action === 'edit') {
      editTimecode(index);
    } else if (action === 'delete') {
      deleteTimecode(index);
    }
  };

  const seekFromItem = (/** @type {HTMLElement} */ item) => {
    const time = parseFloat(item.dataset.time || '');
    const video = /** @type {HTMLVideoElement | null} */ ($('video'));
    if (video && !Number.isNaN(time)) {
      /** @type {HTMLVideoElement} */ (video).currentTime = time;
      if (video.paused) video.play();
      updateActiveItem(item);
    }
  };

  const handleTrackToggle = (/** @type {HTMLElement} */ target) => {
    config.autoTrackPlayback = !config.autoTrackPlayback;
    target.textContent = config.autoTrackPlayback ? t('tracking') : t('track');
    target.classList.toggle('active', config.autoTrackPlayback);
    state.dom.panel?.classList.toggle('auto-tracking', config.autoTrackPlayback);
    saveSettings();
    if (config.autoTrackPlayback) startTracking();
  };

  const handlePanelClick = (/** @type {Event} */ e) => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    if (!target) return;
    const item = /** @type {HTMLElement | null} */ (target.closest('.timecode-item'));
    if (handleChromeButtons(e, target)) return;

    if (target.id === 'timecode-add-btn') {
      const video = /** @type {HTMLVideoElement | null} */ ($('video'));
      if (video) showTimecodeForm(video.currentTime);
    } else if (target.id === 'timecode-track-toggle') {
      handleTrackToggle(target);
    } else if (target.id === 'timecode-export-btn') {
      exportTimecodes();
    } else if (target.id === 'timecode-form-cancel') {
      hideTimecodeForm();
    } else if (target.id === 'timecode-form-save') {
      saveTimecodeForm();
    } else if (target.classList.contains('timecode-action')) {
      handleItemAction(e, target);
    } else if (item && !target.closest('.timecode-actions')) {
      seekFromItem(item);
    }
  };

  // Edit timecode
  const editTimecode = (/** @type {number} */ index) => {
    const timecodes = getCurrentTimecodes();
    if (index < 0 || index >= timecodes.length) return;

    const timecode = timecodes[index];
    state.editingIndex = index;

    // Update item appearance
    const item = state.dom.list?.querySelector(`.timecode-item[data-index="${index}"]`);
    if (item) {
      item.classList.add('editing');
      // Hide other editing items
      state.dom.list
        ?.querySelectorAll('.timecode-item.editing')
        .forEach((/** @type {Element} */ el) => {
          if (el !== item) el.classList.remove('editing');
        });
    }

    showTimecodeForm(timecode.time, timecode.label);
  };

  // Delete timecode
  const deleteTimecode = async (/** @type {number} */ index) => {
    const timecodes = getCurrentTimecodes();
    if (index < 0 || index >= timecodes.length) return;

    const timecode = timecodes[index];

    // Don't allow deletion of native YouTube chapters
    if (timecode.isChapter && !timecode.isUserAdded) {
      showNotification(t('cannotDeleteChapter'));
      return;
    }

    // Confirm deletion own focus-trapped dialog; interpolation
    // goes through the common t(key, params), not a raw .replace).
    const confirmed = await U.confirmDialog({
      message: t('confirmDelete', { label: timecode.label }),
      confirmLabel: t('confirm'),
      cancelLabel: t('cancel'),
    });
    if (!confirmed) return;

    timecodes.splice(index, 1);
    updateTimecodePanel(timecodes);
    saveTimecodesToStorage(timecodes);
    showNotification(t('timecodeDeleted'));
  };

  // Form handling
  const showTimecodeForm = (
    /** @type {number} */ currentTime,
    /** @type {string} */ existingLabel = ''
  ) => {
    const { form, timeInput, labelInput } = state.dom;
    if (!(form && timeInput && labelInput)) return;
    form.classList.add('visible');
    timeInput.value = formatTime(currentTime);
    labelInput.value = existingLabel;
    window.YouTubePlusCleanupManager?.registerAnimationFrame?.(
      requestAnimationFrame(() => labelInput.focus())
    );
  };

  const hideTimecodeForm = () => {
    state.dom.form?.classList.remove('visible');
    state.editingIndex = null;
    // Remove editing class from all items
    state.dom.list
      ?.querySelectorAll('.timecode-item.editing')
      .forEach((/** @type {Element} */ el) => {
        el.classList.remove('editing');
      });
  };

  const saveTimecodeForm = () => {
    const { timeInput, labelInput } = state.dom;
    if (!(timeInput && labelInput)) return;
    const timeValue = timeInput.value.trim();
    const labelValue = labelInput.value.trim();

    const time = parseTime(timeValue);
    if (time === null) {
      showNotification(t('invalidTimeFormat'));
      return;
    }

    const timecodes = getCurrentTimecodes();
    const newTimecode = {
      time,
      label: labelValue || '',
      isUserAdded: true,
      isChapter: false,
    };

    if (state.editingIndex !== null) {
      // Editing existing timecode
      const oldTimecode = timecodes[state.editingIndex];
      if (oldTimecode.isChapter && !oldTimecode.isUserAdded) {
        showNotification(t('cannotEditChapter'));
        hideTimecodeForm();
        return;
      }

      timecodes[state.editingIndex] = { ...oldTimecode, ...newTimecode };
      showNotification(t('timecodeUpdated'));
    } else {
      // Adding new timecode
      timecodes.push(newTimecode);
      showNotification(t('timecodeAdded'));
    }

    const sorted = timecodes.sort((a, b) => a.time - b.time);
    updateTimecodePanel(sorted);
    saveTimecodesToStorage(sorted);
    hideTimecodeForm();
  };

  // Export
  const exportTimecodes = () => {
    const timecodes = getCurrentTimecodes();
    if (!timecodes.length) {
      showNotification(t('noTimecodesToExport'));
      return;
    }

    const exportBtn = /** @type {HTMLElement | null} */ (
      state.dom.panel?.querySelector('#timecode-export-btn')
    );
    if (exportBtn) {
      exportBtn.textContent = t('copied');
      exportBtn.style.backgroundColor = 'var(--yt-timecode-export-success-bg)';
      setTimeout_(function () {
        exportBtn.textContent = t('export');
        exportBtn.style.backgroundColor = '';
      }, 2000);
    }

    const videoTitle = document.title.replace(/\s-\sYouTube$/, '');
    let content = `${videoTitle}\n\nTimecodes:\n`;
    timecodes.forEach(tc => {
      const label = tc.label?.trim();
      content += label ? `${formatTime(tc.time)} - ${label}\n` : `${formatTime(tc.time)}\n`;
    });

    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(content)
        .then(() => {
          showNotification(t('timecodesCopied'));
        })
        .catch(err => {
          logS(err);
          timecodeLogger?.warn?.('Timecode', 'Clipboard write failed', err);
        });
    }
  };

  // Panel updates
  const updateTimecodePanel = (
    /** @type {Array<{ time: number, label?: string, isChapter?: boolean, isUserAdded?: boolean, originalText?: string }>} */ timecodes
  ) => {
    const { list, empty } = state.dom;
    if (!(list && empty)) return;

    const isEmpty = !timecodes.length;
    empty.style.display = isEmpty ? 'flex' : 'none';
    list.style.display = isEmpty ? 'none' : 'block';

    if (isEmpty) {
      list.replaceChildren();
      return;
    }

    window.YouTubeUtils.renderTemplateClone(
      list,
      timecodes
        .map(
          (
            /** @type {{ time: number, label?: string, isChapter?: boolean, isUserAdded?: boolean, originalText?: string }} */ tc,
            /** @type {number} */ i
          ) => {
            const timeStr = formatTime(tc.time);
            // Only use label if it exists and is different from time
            let rawLabel = tc.label?.trim() || '';

            // Remove time prefix from label if it starts with the same time
            rawLabel = stripLeadingTimePrefix(rawLabel);

            // Remove duplicate text in label (final safety check)
            const beforeDedup = rawLabel;
            rawLabel = removeDuplicateText(rawLabel);
            logTimecodeDeduplication(beforeDedup, rawLabel, 'Display');

            // Normalize time comparisons (remove leading zeros for comparison)
            const normalizedTime = timeStr.replace(/^0+:/, '');
            const normalizedLabel = rawLabel.replace(/^0+:/, '');

            const hasCustomLabel =
              rawLabel &&
              rawLabel !== timeStr &&
              normalizedLabel !== normalizedTime &&
              rawLabel !== tc.originalText &&
              rawLabel.length > 0;
            const displayLabel = hasCustomLabel ? rawLabel : '';
            const escapeMap = /** @type {Record<string, string>} */ ({
              '<': '&lt;',
              '>': '&gt;',
              '&': '&amp;',
              '"': '&quot;',
              "'": '&#39;',
            });
            const safeLabel = displayLabel.replace(
              /[<>&"']/g,
              (/** @type {string} */ c) => escapeMap[c] || c
            );
            const isEditable = !tc.isChapter || tc.isUserAdded;

            return `
          <div class="timecode-item ${tc.isChapter ? 'has-chapter' : ''}" data-time="${tc.time}" data-index="${i}">
            <div class="timecode-time">${timeStr}</div>
            ${safeLabel ? `<div class="timecode-label" title="${safeLabel}">${safeLabel}</div>` : ''}
            <div class="timecode-progress"></div>
            ${
              isEditable
                ? `
              <div class="timecode-actions">
                <button class="timecode-action edit" data-action="edit" title="${t('edit')}">✎</button>
                <button class="timecode-action delete" data-action="delete" title="${t('delete')}">✕</button>
              </div>
            `
                : ''
            }
          </div>
        `;
          }
        )
        .join('')
    );
  };

  const updateActiveItem = (/** @type {HTMLElement | null} */ activeItem) => {
    const items = state.dom.list?.querySelectorAll('.timecode-item');
    if (!items) return;

    items.forEach((/** @type {Element} */ item) => item.classList.remove('active', 'pulse'));
    if (activeItem) {
      activeItem.classList.add('active', 'pulse');
      setTimeout(() => activeItem.classList.remove('pulse'), 800);
    }
  };

  // Tracking
  // Uses the video's `timeupdate` event (~4 Hz during playback) instead of a
  // requestAnimationFrame loop: no per-frame DOM queries or style writes.
  const startTracking = () => {
    if (state.trackingId) return;

    const video = /** @type {HTMLVideoElement | null} */ ($('video'));
    if (!video) return;
    if (!timecodeCtx) return;

    const updateCurrentTimeDisplay = () => {
      const { currentTime } = state.dom;
      if (currentTime && !Number.isNaN(video.currentTime)) {
        currentTime.textContent = formatTime(video.currentTime);
      }
    };

    /** @param {NodeListOf<Element>} items */
    const computeActiveIndex = items => {
      let activeIndex = -1;
      let nextIndex = -1;
      for (let i = 0; i < items.length; i++) {
        const timeData = /** @type {HTMLElement} */ (items[i]).dataset.time;
        if (!timeData) continue;
        const time = parseFloat(timeData);
        if (Number.isNaN(time)) continue;
        if (video.currentTime >= time) {
          activeIndex = i;
        } else if (nextIndex === -1) {
          nextIndex = i;
        }
      }
      return { activeIndex, nextIndex };
    };

    /** @param {Element} item */
    const scrollItemIntoView = item => {
      if (typeof item?.scrollIntoView !== 'function') return;
      try {
        item.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      } catch (_e) {
        logS(_e);
        // Fallback for browsers that don't support smooth scrolling
        item.scrollIntoView(false);
      }
    };

    /**
     * @param {NodeListOf<Element>} items
     * @param {number} activeIndex
     */
    const updateActiveItemState = (items, activeIndex) => {
      if (state.activeIndex === activeIndex) return;
      // Clear the active class from the item that held it
      if (state.activeIndex !== null && state.activeIndex >= 0 && items[state.activeIndex]) {
        items[state.activeIndex].classList.remove('active');
      }
      // Set new active state
      if (activeIndex >= 0 && items[activeIndex]) {
        items[activeIndex].classList.add('active');
        scrollItemIntoView(items[activeIndex]);
      }
      state.activeIndex = activeIndex;
    };

    /**
     * @param {NodeListOf<Element>} items
     * @param {number} activeIndex
     * @param {number} nextIndex
     */
    const updateProgressBar = (items, activeIndex, nextIndex) => {
      if (!(activeIndex >= 0 && nextIndex >= 0 && items[activeIndex])) return;
      const currentTimeData = /** @type {HTMLElement} */ (items[activeIndex]).dataset.time;
      const nextTimeData = /** @type {HTMLElement} */ (items[nextIndex]).dataset.time;
      if (!(currentTimeData && nextTimeData)) return;
      const current = parseFloat(currentTimeData);
      const next = parseFloat(nextTimeData);
      if (Number.isNaN(current) || Number.isNaN(next) || next <= current) return;
      const progress = ((video.currentTime - current) / (next - current)) * 100;
      const progressEl = /** @type {HTMLElement | null} */ (
        items[activeIndex].querySelector('.timecode-progress')
      );
      if (progressEl) {
        const clampedProgress = Math.min(100, Math.max(0, progress));
        progressEl.style.width = `${clampedProgress}%`;
      }
    };

    const onTimeUpdate = () => {
      try {
        const { panel, list } = state.dom;

        // Stop tracking if essential elements are missing, the panel is
        // hidden, or tracking was disabled. Re-bind if the video element
        // was swapped by an SPA navigation.
        if (
          !(panel && video.isConnected) ||
          panel.classList.contains('hidden') ||
          !config.autoTrackPlayback
        ) {
          const shouldRebind = config.autoTrackPlayback && video.isConnected === false;
          stopTracking();
          if (shouldRebind) startTracking();
          return;
        }

        // Update current time display
        updateCurrentTimeDisplay();

        // Update active item
        const items = list?.querySelectorAll('.timecode-item');
        if (!items?.length) return;

        const { activeIndex, nextIndex } = computeActiveIndex(items);
        updateActiveItemState(items, activeIndex);
        updateProgressBar(items, activeIndex, nextIndex);
      } catch (error) {
        logS(error);
        timecodeLogger?.warn?.('Timecode', 'Tracking error', error);
        // Stop tracking on error to prevent infinite error loops
        stopTracking();
      }
    };

    timeUpdateRelease = timecodeCtx.listen(video, 'timeupdate', onTimeUpdate);
    state.trackingId = 1;
  };

  const stopTracking = () => {
    if (!state.trackingId) return;
    timeUpdateRelease?.();
    timeUpdateRelease = null;
    state.trackingId = 0;
  };

  // Drag functionality
  /**
   * @param {HTMLElement} panel
   * @param {FeatureScope | null} [scope] owning group; without it the drag listeners are
   * CleanupManager-tracked only (manual facade callers)
   */
  const makeDraggable = (panel, scope) => {
    const header = panel.querySelector('#timecode-header');
    if (!header) return;

    /**
     * Register a drag listener that lives until its own release is called
     * (or the owning group is disposed).
     * @param {EventTarget} target
     * @param {string} type
     * @param {EventListener} fn
     * @param {AddEventListenerOptions} [opts]
     * @returns {() => void}
     */
    const addDragListener = (target, type, fn, opts) => {
      if (scope?.listen) return scope.listen(target, type, fn, opts);
      const key = window.YouTubePlusCleanupManager?.registerListener?.(target, type, fn, opts);
      if (!key) return () => {};
      return () => window.YouTubePlusCleanupManager?.unregisterListener?.(key);
    };

    /** @type {number} */ let startX;
    /** @type {number} */ let startY;
    /** @type {number} */ let startLeft;
    /** @type {number} */ let startTop;

    const mouseDownHandler = (/** @type {Event} */ evt) => {
      const e = /** @type {MouseEvent} */ (evt);
      if (e.button !== 0) return;

      state.dragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = panel.getBoundingClientRect();

      if (!panel.style.left) {
        panel.style.left = `${rect.left}px`;
      }
      if (!panel.style.top) {
        panel.style.top = `${rect.top}px`;
      }

      panel.style.right = 'auto';

      startLeft = parseFloat(panel.style.left) || rect.left;
      startTop = parseFloat(panel.style.top) || rect.top;

      /** @type {number | null} */
      let moveRaf = null;
      /** @type {MouseEvent | null} */
      let pendingEvent = null;

      const handleMove = (/** @type {Event} */ evt) => {
        if (!state.dragging) return;
        const event = /** @type {MouseEvent} */ (evt);
        pendingEvent = event;
        if (moveRaf) return;

        moveRaf = window.YouTubePlusCleanupManager?.registerAnimationFrame?.(
          requestAnimationFrame(() => {
            moveRaf = null;
            if (!(state.dragging && pendingEvent)) return;
            const deltaX = pendingEvent.clientX - startX;
            const deltaY = pendingEvent.clientY - startY;
            const { left, top } = clampPanelPosition(panel, startLeft + deltaX, startTop + deltaY);

            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            panel.style.right = 'auto';
          })
        );
      };

      const handleUp = () => {
        if (!state.dragging) return;

        state.dragging = false;
        if (moveRaf) {
          cancelAnimationFrame(moveRaf);
          moveRaf = null;
        }
        for (const off of upRelease) off?.();
        upRelease.length = 0;

        const rectAfter = panel.getBoundingClientRect();
        applyClampedPosition(panel, rectAfter.left, rectAfter.top, true);
      };

      /** @type {(() => void)[]} */
      const upRelease = [
        addDragListener(document, 'mousemove', handleMove),
        addDragListener(document, 'mouseup', handleUp),
      ];
    };

    if (scope?.listen) {
      scope.listen(header, 'mousedown', mouseDownHandler);
    } else {
      YouTubeUtils.cleanupManager.registerListener(header, 'mousedown', mouseDownHandler);
    }
  };

  // Storage
  const saveTimecodesToStorage = (
    /** @type {Array<{ time: number, label?: string, isChapter?: boolean, isUserAdded?: boolean }>} */ timecodes
  ) => {
    const videoId = getCurrentVideoId();
    if (!videoId) return;

    try {
      const minimal = timecodes.map(tc => ({
        t: tc.time,
        l: tc.label?.trim() || '',
        c: tc.isChapter,
        u: tc.isUserAdded,
      }));
      U.storage?.setItem(`yt_tc_${videoId}`, JSON.stringify(minimal));
    } catch (_e) {
      logS(_e);
    }
  };

  const loadTimecodesFromStorage = () => {
    const videoId = getCurrentVideoId();
    if (!videoId) return null;

    try {
      const data = U.storage?.getItem(`yt_tc_${videoId}`);
      return data
        ? JSON.parse(data)
            .map((/** @type {{ t: number, l?: string, c?: boolean, u?: boolean }} */ tc) => ({
              time: tc.t,
              label: tc.l,
              isChapter: tc.c,
              isUserAdded: tc.u,
            }))
            .sort(
              (/** @type {{ time: number }} */ a, /** @type {{ time: number }} */ b) =>
                a.time - b.time
            )
        : null;
    } catch (_e) {
      logS(_e);
      return null;
    }
  };

  const getCurrentTimecodes = () => {
    const items = state.dom.list?.querySelectorAll('.timecode-item');
    if (!items) return [];

    return Array.from(items)
      .map(item => {
        const htmlItem = /** @type {HTMLElement} */ (item);
        const time = parseFloat(htmlItem.dataset.time || '0');
        const labelEl = htmlItem.querySelector('.timecode-label');
        // Only use label if element exists and has actual text content
        const label = labelEl?.textContent?.trim() || '';

        return {
          time,
          label: label, // Keep original label (can be empty)
          isChapter: htmlItem.classList.contains('has-chapter'),
          isUserAdded: !htmlItem.classList.contains('has-chapter'),
        };
      })
      .sort((a, b) => a.time - b.time);
  };

  // Toggle panel
  const toggleTimecodePanel = (/** @type {boolean | undefined} */ show = undefined) => {
    // Close any existing panels first (cleanup)
    $$('#timecode-panel').forEach(panel => {
      if (panel !== state.dom.panel) panel.remove();
    });

    const panel = state.dom.panel || createTimecodePanel();
    if (show === undefined) show = panel.classList.contains('hidden');

    panel.classList.toggle('hidden', !show);

    if (show) {
      applySavedPanelPosition(panel);

      const saved = loadTimecodesFromStorage();
      if (saved?.length) {
        updateTimecodePanel(saved);
      } else if (config.autoDetect) {
        detectTimecodes().catch((/** @type {unknown} */ err) => {
          timecodeLogger?.error?.('Timecode', 'Detection failed', err);
        });
      }

      if (config.autoTrackPlayback) startTracking();
    } else {
      stopTracking();
    }
  };

  // Navigation handling
  const setupNavigation = () => {
    let currentVideoId = getCurrentVideoId();

    const handleNavigationChange = () => {
      const newVideoId = getCurrentVideoId();
      if (newVideoId === currentVideoId || window.location.pathname !== '/watch') return;

      currentVideoId = newVideoId;
      state.activeIndex = null;
      state.editingIndex = null;
      state.timecodes.clear();

      if (state.dom.panel && !state.dom.panel.classList.contains('hidden')) {
        const saved = loadTimecodesFromStorage();
        if (saved?.length) {
          updateTimecodePanel(saved);
        } else if (config.autoDetect) {
          // Feature-owned: the detection timer is cancelled when the
          // lifecycle stop releases the context.
          timecodeCtx?.timeout(
            () =>
              detectTimecodes().catch((/** @type {unknown} */ err) => {
                timecodeLogger?.error?.('Timecode', 'Detection failed', err);
              }),
            500
          );
        }
        if (config.autoTrackPlayback) startTracking();
      }
    };

    if (timecodeCtx) {
      timecodeCtx.listen(document, 'yt-navigate-finish', handleNavigationChange);
    }
  };

  // Keyboard shortcuts
  const setupKeyboard = () => {
    const keydownHandler = (/** @type {Event} */ evt) => {
      const e = /** @type {KeyboardEvent} */ (evt);
      const target = /** @type {HTMLElement | null} */ (e.target);
      if (target?.matches?.('input, textarea, [contenteditable]')) return;

      const { key, shiftKey, altKey, ctrlKey } = config.shortcut;
      if (
        e.key.toUpperCase() === key &&
        e.shiftKey === shiftKey &&
        e.altKey === altKey &&
        e.ctrlKey === ctrlKey
      ) {
        e.preventDefault();
        toggleTimecodePanel();
      }
    };

    if (timecodeCtx) {
      // Owned by the feature: typing the hotkey only works while the
      // toggle is on, and the listener follows the lifecycle stop.
      timecodeCtx.listen(document, 'keydown', keydownHandler);
    }
  };

  // Cleanup on unload
  // Release the living panel group; when no group exists (a manual facade
  // call created the panel) the DOM refs are dropped after the element.
  const resetDomRefs = () => {
    state.dom = {
      panel: null,
      list: null,
      empty: null,
      form: null,
      timeInput: null,
      labelInput: null,
      currentTime: null,
      trackToggle: null,
      reloadButton: null,
    };
  };

  const cleanup = () => {
    stopTracking();
    if (uiScope) {
      uiScope.dispose();
      uiScope = null;
    } else if (state.dom.panel) {
      state.dom.panel.remove();
      resetDomRefs();
    }
  };

  /** @param {FeatureContext} ctx */
  const start = ctx => {
    timecodeCtx = ctx;
    init();
    setupKeyboard();
    setupNavigation();

    // Keep a dragged panel inside the viewport on window resizes.
    ctx.listen(
      window,
      'resize',
      throttle(() => {
        if (!state.dom.panel) return;
        const rect = state.dom.panel.getBoundingClientRect();
        applyClampedPosition(state.dom.panel, rect.left, rect.top, true);
      }, 200),
      { passive: true }
    );
  };

  const stop = () => {
    cleanup();
    timecodeCtx = null;
    timecodeStylesAdded = false;
  };

  const setupTimecodeSettingsIntegration = () => {
    if (state.settingsIntegrationStarted) return;
    state.settingsIntegrationStarted = true;

    // Ensure UI reflects persisted values even when opened outside /watch.
    loadSettings();

    const settingsModalHandler = () => {
      attachTimecodeHandlers();
    };
    if (YouTubeUtils.cleanupManager?.registerListener) {
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'youtube-plus-settings-modal-opened',
        settingsModalHandler
      );
    } else {
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'youtube-plus-settings-modal-opened',
        settingsModalHandler,
        undefined,
        true
      );
    }

    const delegator = window.YouTubePlusEventDelegation;
    if (delegator?.on) {
      delegator.on(document, 'click', '.yp-settings-nav-item[data-section="advanced"]', () =>
        attachTimecodeHandlers()
      );
    } else {
      const clickHandler = (/** @type {MouseEvent} */ e) => {
        const target = /** @type {HTMLElement | null} */ (e.target);
        const navItem = target?.closest?.('.yp-settings-nav-item');
        if (navItem && /** @type {HTMLElement} */ (navItem).dataset?.section === 'advanced') {
          attachTimecodeHandlers();
        }
      };
      if (YouTubeUtils.cleanupManager?.registerListener) {
        YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);
      } else {
        window.YouTubePlusCleanupManager?.registerListener?.(
          document,
          'click',
          clickHandler,
          true,
          true
        );
      }
    }

    // Blob changes arrive through the unified event; only timecode keys matter.
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'youtube-plus-settings-updated',
      (/** @type {CustomEvent & { changedKeys?: string[] }} */ e) => {
        if (window.YouTubePlusSettingsStore?.affectsModule?.(e, MODULE_NAME) === false) return;
        loadSettings();
        attachTimecodeHandlers();
      },
      undefined,
      true
    );
  };

  // Initialize
  const init = () => {
    if (initStarted) return;
    // Runtime only on www.youtube.com (not music/studio/iframes)
    if (U?.getHostname?.() !== 'www.youtube.com' || window.frameElement) return;
    if (!isRelevantRoute()) return;

    const appRoot = $('ytd-app');

    if (!appRoot) {
      scheduleInitRetry();
      return;
    }

    initStarted = true;

    loadSettings();

    /** @type {string | null} */ let modalObserverSubId = null;
    /** @type {ReturnType<typeof setTimeout> | number | null} */
    let modalObserverTimeout = null;

    const attachModalObserver = (/** @type {Element | null | undefined} */ modalEl) => {
      if (!(modalEl && modalEl instanceof Element)) return;
      const coordinator = window.YouTubePlusMutationCoordinator;
      if (modalObserverSubId && coordinator?.unsubscribe) {
        coordinator.unsubscribe(modalObserverSubId);
        modalObserverSubId = null;
      }

      if (!coordinator?.watchTarget) return;

      modalObserverSubId = `timecode::settingsModal::${Date.now()}::${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      coordinator.watchTarget(
        modalObserverSubId,
        modalEl,
        () => {
          // Debounce modal observer to reduce unnecessary checks; the shared
          // manager drops the entry once it fires and on navigation cleanup.
          if (modalObserverTimeout) return;
          modalObserverTimeout =
            YouTubeUtils.cleanupManager?.timeout?.(() => {
              modalObserverTimeout = null;
              if (
                $('.yp-settings-section[data-section="advanced"]:not(.hidden)') &&
                !$('.timecode-settings-item')
              ) {
                attachTimecodeHandlers();
              }
            }, 30) ?? null;
        },
        {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        }
      );

      if (YouTubeUtils.cleanupManager?.register) {
        YouTubeUtils.cleanupManager.register(() => {
          if (modalObserverSubId && coordinator?.unsubscribe) {
            coordinator.unsubscribe(modalObserverSubId);
            modalObserverSubId = null;
          }
        });
      }
    };

    // Settings modal integration: react to the event, not a body MutationObserver.
    const settingsModalHandler = () => {
      const modal = $('.yp-settings-modal');
      if (modal) {
        attachModalObserver(modal);
        attachTimecodeHandlers();
      }
    };
    if (YouTubeUtils.cleanupManager?.registerListener) {
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'youtube-plus-settings-modal-opened',
        settingsModalHandler
      );
    } else {
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'youtube-plus-settings-modal-opened',
        settingsModalHandler,
        undefined,
        true
      );
    }

    // Starts the feature when its setting is on, then follows the setting.
    timecodeFeature?.sync();
  };

  /**
   * Timecode runtime on the FeatureLifecycle contract: only the panel,
   * hotkey, navigation reaction, styles and resize repositioning belong to
   * the feature context; the settings integration above stays at module
   * scope so the checkbox keeps working while the feature is off.
   * @type {{ sync: () => void } | null | undefined}
   */
  const timecodeFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'timecode',
    settingsKey: 'timecodeEnabled',
    // Timestamp panels and the hotkey live on the watch player only.
    routes: ['watch'],
    start,
    stop,
  });

  // Arm the Advanced-tab wiring at boot (idempotent), then the lifecycle
  // host follows the `timecodeEnabled` setting and the watch route.
  setupTimecodeSettingsIntegration();
  timecodeFeature?.sync();

  // Settings UI integration must be reachable from the Advanced tab
  // regardless of route, so the user can configure shortcuts even on
  // /home, /feed/*, etc. The integration is idempotent and self-guards
  // via state.settingsIntegrationStarted.
  if (window.YouTubeUtils?.onSectionActive) {
    window.YouTubeUtils.onSectionActive('advanced', () => {
      setupTimecodeSettingsIntegration();
      attachTimecodeHandlers();
    });
  }

  const publicAPI = {
    parseTime,
    parseLeadingTimestampToken,
    stripLeadingTimePrefix,
    formatTime,
    createTimecodePanel,
    config,
    state,
    init,
    cleanup,
  };
  window.YouTubePlusTimecode = publicAPI;

  // Test-only surface: internal entry points and state accessors live here,
  // not on the facade root.
  U?.exposeTestHooks?.(publicAPI, {
    detectTimecodes,
    extractTimecodes,
    getYouTubeChapters,
    saveSettings,
    loadSettings,
    exportTimecodes,
    reloadTimecodes,
    updateTimecodePanel,
    updateActiveItem,
    makeDraggable,
    clampPanelPosition,
    applyClampedPosition,
    applySavedPanelPosition,
    savePanelPosition,
    saveTimecodesToStorage,
    loadTimecodesFromStorage,
    getCurrentTimecodes,
    toggleTimecodePanel,
    showTimecodeForm,
    hideTimecodeForm,
    editTimecode,
    deleteTimecode,
    startTracking,
    stopTracking,
    setupKeyboard,
    setupNavigation,
    attachTimecodeHandlers,
    setupTimecodeSettingsIntegration,
    isRelevantRoute,
    start,
    stop,
    timecodeFeature,
    timecodeLogger,
  });

  // Cleanup on beforeunload
  window.YouTubePlusCleanupManager?.registerListener?.(
    window,
    'beforeunload',
    cleanup,
    undefined,
    true
  );
})();
