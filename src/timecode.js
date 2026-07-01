// YouTube Timecode Panel — no canonical window symbol (self-initializing IIFE).
//
// Responsibility: clickable timestamp links in video descriptions,
//   progress-bar chapter markers, and timecode navigation helpers.
//   Uses `__ytpTimeInitDone__` guard for idempotent boot.
// Public surface: none (self-contained, no LazyLoader registration).
(function () {
  // Shared helpers from YouTubeUtils (canonical boot shorthand)
  const U = window.YouTubeUtils;
  const { $, $$, byId, setTimeout_ } = U?.helpers ?? {};
  const throttle = U?.throttle;
  const waitForElement = U?.waitForElement;

  // Prevent multiple initializations
  if (window._timecodeModuleInitialized) return;
  window._timecodeModuleInitialized = true;

  // Shared translation helper from YouTubeUtils
  const t = window.YouTubeUtils?.t || ((/** @type {string} */ key) => key || '');
  const timecodeLogger = window.YouTubeUtils?.logger || null;

  // Configuration
  /** @type {any} */
  const config = {
    enabled: true,
    autoDetect: true,
    shortcut: { key: 'T', shiftKey: true, altKey: false, ctrlKey: false },
    storageKey: 'youtube_timecode_settings',
    autoSave: true,
    autoTrackPlayback: true,
    panelPosition: null,
    export: true,
  };

  // State management
  /** @type {any} */
  const state = {
    timecodes: new Map(),
    dom: {},
    isReloading: false,
    activeIndex: null,
    trackingId: 0,
    dragging: false,
    editingIndex: null,
    resizeListenerKey: null,
    settingsIntegrationStarted: false,
  };

  let initStarted = false;

  const isRelevantRoute = () => window.YouTubeUtils.isWatchRoute();

  const scheduleInitRetry = () => {
    const retryScheduler = /** @type {any} */ (YouTubeUtils).createRetryScheduler;
    if (typeof retryScheduler === 'function') {
      retryScheduler({
        label: 'timecode-init',
        interval: 120,
        maxAttempts: 30,
        check: () => {
          const root =
            (typeof YouTubeUtils.querySelector === 'function' &&
              YouTubeUtils.querySelector('ytd-app')) ||
            $('ytd-app');
          if (!root) return false;
          init();
          return true;
        },
      });
      return;
    }

    const rafId = requestAnimationFrame(init);
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
   * Load settings from localStorage with error handling
   * @returns {void}
   */
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(config.storageKey);
      if (!saved) return;

      const parsed = JSON.parse(saved);
      if (typeof parsed !== 'object' || parsed === null) {
        timecodeLogger?.warn?.('Timecode', 'Invalid settings format');
        return;
      }

      // Validate and merge settings
      if (typeof parsed.enabled === 'boolean') {
        config.enabled = parsed.enabled;
      }
      if (typeof parsed.autoDetect === 'boolean') {
        config.autoDetect = parsed.autoDetect;
      }
      if (typeof parsed.autoSave === 'boolean') {
        config.autoSave = parsed.autoSave;
      }
      if (typeof parsed.autoTrackPlayback === 'boolean') {
        config.autoTrackPlayback = parsed.autoTrackPlayback;
      }
      if (typeof parsed.export === 'boolean') {
        config.export = parsed.export;
      }

      // Validate shortcut object
      if (parsed.shortcut && typeof parsed.shortcut === 'object') {
        if (typeof parsed.shortcut.key === 'string') {
          config.shortcut.key = parsed.shortcut.key;
        }
        if (typeof parsed.shortcut.shiftKey === 'boolean') {
          config.shortcut.shiftKey = parsed.shortcut.shiftKey;
        }
        if (typeof parsed.shortcut.altKey === 'boolean') {
          config.shortcut.altKey = parsed.shortcut.altKey;
        }
        if (typeof parsed.shortcut.ctrlKey === 'boolean') {
          config.shortcut.ctrlKey = parsed.shortcut.ctrlKey;
        }
      }

      // Validate panel position
      if (parsed.panelPosition && typeof parsed.panelPosition === 'object') {
        const { left, top } = parsed.panelPosition;
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
      }
    } catch (error) {
      timecodeLogger?.error?.('Timecode', 'Error loading settings', error);
    }
  };

  /**
   * Save settings to localStorage with error handling
   * @returns {void}
   */
  const saveSettings = () => {
    try {
      const settingsToSave = {
        enabled: config.enabled,
        autoDetect: config.autoDetect,
        shortcut: config.shortcut,
        autoSave: config.autoSave,
        autoTrackPlayback: config.autoTrackPlayback,
        panelPosition: config.panelPosition,
        export: config.export,
      };
      localStorage.setItem(config.storageKey, JSON.stringify(settingsToSave));
    } catch (error) {
      timecodeLogger?.error?.('Timecode', 'Error saving settings', error);
    }
  };

  /**
   * Clamp panel position within viewport bounds
   * @param {HTMLElement} panel - Panel element
   * @param {number} left - Desired left position
   * @param {number} top - Desired top position
   * @returns {{left: number, top: number}} Clamped position
   */
  const clampPanelPosition = (panel, left, top) => {
    try {
      if (!(panel && panel instanceof HTMLElement)) {
        timecodeLogger?.warn?.('Timecode', 'Invalid panel element');
        return { left: 0, top: 0 };
      }

      // Validate input coordinates
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
      // Single getBoundingClientRect read; use rect.width/rect.height
      // directly instead of also reading offsetWidth/offsetHeight which
      // trigger separate forced layouts.
      const width = rect.width || 0;
      const height = rect.height || 0;

      const maxLeft = Math.max(0, window.innerWidth - width);
      const maxTop = Math.max(0, window.innerHeight - height);

      return {
        left: Math.min(Math.max(0, left), maxLeft),
        top: Math.min(Math.max(0, top), maxTop),
      };
    } catch (error) {
      timecodeLogger?.error?.('Timecode', 'Error clamping panel position', error);
      return { left: 0, top: 0 };
    }
  };

  /**
   * Save panel position to settings
   * @param {number} left - Left position
   * @param {number} top - Top position
   * @returns {void}
   */
  /**
   * Save panel position to configuration and localStorage
   * @param {number} left - X coordinate in pixels
   * @param {number} top - Y coordinate in pixels
   * @returns {void}
   */
  const savePanelPosition = (left, top) => {
    try {
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
    } catch (error) {
      timecodeLogger?.error?.('Timecode', 'Error saving panel position', error);
    }
  };

  /**
   * Apply saved panel position to a panel element
   * @param {HTMLElement} panel - The panel element to position
   * @returns {void}
   */
  const applySavedPanelPosition = (/** @type {any} */ panel) => {
    if (!(panel && config.panelPosition)) return;

    requestAnimationFrame(() => {
      const { left, top } = clampPanelPosition(
        panel,
        config.panelPosition.left,
        config.panelPosition.top
      );
      /** @type {any} */ (panel).style.left = `${left}px`;
      /** @type {any} */ (panel).style.top = `${top}px`;
      /** @type {any} */ (panel).style.right = 'auto';
    });
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

    // Try sliding window approach for partial duplicates
    // Search for the longest repeating pattern
    const minPatternLength = Math.max(2, Math.floor(words.length / 4));
    const maxPatternLength = Math.floor(words.length / 2);

    for (let len = maxPatternLength; len >= minPatternLength; len--) {
      const pattern = words.slice(0, len).join(' ');
      const patternWords = words.slice(0, len);

      // Check if this pattern appears again anywhere in the text
      for (let offset = 1; offset <= words.length - len; offset++) {
        let matchCount = 0;
        let partialWordMatch = false;
        const testWords = words.slice(offset, Math.min(offset + len, words.length));

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

    return cleaned;
  }; /**
   * Parse time string to seconds with validation
   * @param {string} timeStr - Time string (MM:SS or HH:MM:SS)
   * @returns {number|null} Seconds or null if invalid
   */
  const parseTime = (/** @type {any} */ timeStr) => {
    try {
      if (!timeStr || typeof timeStr !== 'string') return null;

      const str = timeStr.trim();
      if (str.length === 0 || str.length > 12) return null; // Sanity check

      // Handle HH:MM:SS format
      let match = str.match(/^(\d+):(\d{1,2}):(\d{2})$/);
      if (match) {
        const [, h, m, s] = match.map(Number);
        // Validate ranges
        if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s)) return null;
        if (m >= 60 || s >= 60 || h < 0 || m < 0 || s < 0) return null;
        const total = h * 3600 + m * 60 + s;
        // Sanity check: max 24 hours
        return total <= 86400 ? total : null;
      }

      // Handle MM:SS format
      match = str.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        const [, m, s] = match.map(Number);
        // Validate ranges
        if (Number.isNaN(m) || Number.isNaN(s)) return null;
        if (m >= 60 || s >= 60 || m < 0 || s < 0) return null;
        return m * 60 + s;
      }

      return null;
    } catch (error) {
      timecodeLogger?.error?.('Timecode', 'Error parsing time', error);
      return null;
    }
  };

  /**
   * Extract timecodes from text with validation
   * @param {string} text - Text containing timecodes
   * @returns {Array<{time: number, label: string, originalText: string}>} Extracted timecodes
   */
  const extractTimecodes = text => {
    try {
      if (!text || typeof text !== 'string') return [];

      // Security: limit text length to prevent DoS
      if (text.length > 50000) {
        timecodeLogger?.warn?.('Timecode', 'Text too long, truncating');
        text = text.substring(0, 50000);
      }

      /** @type {Array<{time: number, label: string, originalText: string}>} */
      const timecodes = [];
      const lines = String(text || '')
        .replace(/\r/g, '')
        .split('\n');
      const maxIterations = 1000; // Prevent runaway parsing on malformed input

      for (let i = 0; i < lines.length && i < maxIterations; i += 1) {
        const line = lines[i].trim();
        if (!line) continue;

        const timeMatch = parseLeadingTimestampToken(line);
        if (!timeMatch) continue;

        const time = parseTime(timeMatch.token);
        if (time === null) continue;

        let label = stripLeadingTimePrefix(line.slice(timeMatch.length));
        label = label
          .trim()
          .replace(/^\d+[.)]\s*/, '')
          .replace(/\s+/g, ' ')
          .substring(0, 100);

        const originalLabel = label;
        label = label.replace(/[<>"']/g, '');
        label = removeDuplicateText(label);

        if (originalLabel !== label && label.length > 0) {
          timecodeLogger?.warn?.(
            'Timecode',
            `Description deduplicated: ${originalLabel} -> ${label}`
          );
        }

        const existingIdx = timecodes.findIndex(tc => tc.time === time);
        if (existingIdx !== -1) {
          if ((label || '').length > (timecodes[existingIdx].label || '').length) {
            timecodes[existingIdx] = {
              time,
              label: label || '',
              originalText: timeMatch.token,
            };
          }
        } else {
          timecodes.push({
            time,
            label: label || '',
            originalText: timeMatch.token,
          });
        }
      }

      if (lines.length > maxIterations) {
        timecodeLogger?.warn?.('Timecode', 'Maximum iterations reached during extraction');
      }

      return timecodes.sort((a, b) => a.time - b.time);
    } catch (error) {
      timecodeLogger?.error?.('Timecode', 'Error extracting timecodes', error);
      return [];
    }
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
    try {
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
    } catch (error) {
      YouTubeUtils.logError(
        'TimecodePanel',
        'collectCommentsText failed',
        /** @type {any} */ (error)
      );
      return '';
    }
  };

  const expandDescriptionIfNeeded = async () => {
    for (const selector of DESCRIPTION_EXPANDERS) {
      const button = $(selector);
      if (!button) continue;

      const ariaExpanded = button.getAttribute('aria-expanded');
      if (ariaExpanded === 'true') return false;

      const ariaLabel = button.getAttribute('aria-label')?.toLowerCase();
      if (ariaLabel?.includes('less')) return false;

      if (button.offsetParent !== null) {
        try {
          /** @type {HTMLElement} */ (button).click();
          await sleep(400);
          return true;
        } catch (error) {
          timecodeLogger?.warn?.('Timecode', 'Failed to click expand button', error);
        }
      }
    }

    const inlineExpander = $('ytd-text-inline-expander[collapsed]');
    if (inlineExpander) {
      try {
        inlineExpander.removeAttribute('collapsed');
      } catch (error) {
        YouTubeUtils.logError(
          'TimecodePanel',
          'Failed to expand description',
          /** @type {any} */ (error)
        );
      }
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
  const getCurrentVideoId = () => new URLSearchParams(window.location.search).get('v');

  // Detection
  const detectTimecodes = async (/** @type {any} */ options = {}) => {
    const { force = false } = options;

    if (!config.enabled) return [];
    if (!(force || config.autoDetect)) return [];

    const videoId = getCurrentVideoId();
    if (!videoId) return [];

    const cacheKey = `detect_${videoId}`;
    if (!force && state.timecodes.has(cacheKey)) {
      const cached = state.timecodes.get(cacheKey);
      if (Array.isArray(cached) && cached.length) {
        return cached;
      }
      state.timecodes.delete(cacheKey);
    }

    await ensureDescriptionReady();

    const uniqueMap = new Map();
    const descriptionText = collectDescriptionText();

    if (descriptionText) {
      const extracted = extractTimecodes(descriptionText);
      extracted.forEach(tc => {
        if (tc.time >= 0) {
          uniqueMap.set(tc.time.toString(), tc);
        }
      });
    }

    // Get native chapters
    const chapters = getYouTubeChapters();

    chapters.forEach(chapter => {
      if (chapter.time >= 0) {
        const key = chapter.time.toString();
        const existing = uniqueMap.get(key);
        // Prefer chapter label if existing label is empty or duplicate
        if (existing && chapter.label && chapter.label.length > existing.label.length) {
          uniqueMap.set(key, {
            ...existing,
            label: chapter.label,
            isChapter: true,
          });
        } else if (!existing) {
          uniqueMap.set(key, chapter);
        } else {
          // Mark existing as chapter
          uniqueMap.set(key, { ...existing, isChapter: true });
        }
      }
    });

    // If no timecodes from description/chapters, try scanning visible comments
    if (uniqueMap.size === 0) {
      try {
        const commentsText = collectCommentsText();
        if (commentsText) {
          const extractedComments = extractTimecodes(commentsText);
          extractedComments.forEach(tc => {
            if (tc.time >= 0) uniqueMap.set(tc.time.toString(), tc);
          });
        }
      } catch (error) {
        YouTubeUtils.logError(
          'TimecodePanel',
          'Comment scanning failed',
          /** @type {any} */ (error)
        );
      }
    }

    const result = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
    const hadExistingItems = state.dom.list?.childElementCount > 0;

    if (result.length > 0) {
      updateTimecodePanel(result);
      state.timecodes.set(cacheKey, result);
      if (config.autoSave) saveTimecodesToStorage(result);
    } else {
      if (force || !hadExistingItems) {
        updateTimecodePanel([]);
      }
      if (force) {
        state.timecodes.delete(cacheKey);
      }
    }

    return result;
  };

  /**
   * Reload timecodes by re-detecting them from the current video
   * @param {HTMLElement|null} [buttonOverride=null] - Optional reload button element
   * @returns {Promise<void>}
   */
  const reloadTimecodes = async (/** @type {any} */ buttonOverride = null) => {
    const button = buttonOverride || state.dom.reloadButton || byId('timecode-reload');

    if (state.isReloading || !config.enabled) return;

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
      YouTubeUtils.logError('TimecodePanel', 'Reload failed', /** @type {any} */ (error));
      showNotification(t('reloadError'));
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('loading');
      }
      state.isReloading = false;
    }
  };

  /**
   * Extract chapter markers from YouTube's native chapter system
   * @returns {Array<{time: number, label: string, isChapter: boolean}>} Array of chapter objects
   */
  const getYouTubeChapters = () => {
    // Расширенный поиск глав/эпизодов
    const selectors = [
      'ytd-macro-markers-list-item-renderer',
      'ytd-chapter-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id*="description-chapters"] ytd-macro-markers-list-item-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id*="description-chapters"] #details',
      '#structured-description ytd-horizontal-card-list-renderer ytd-macro-markers-list-item-renderer',
    ];

    const items = $$(selectors.join(', '));
    const chapters = new Map();

    items.forEach(item => {
      // Попробуем разные способы извлечения времени и заголовка
      const timeSelectors = ['.time-info', '.timestamp', '#time', 'span[id*="time"]'];
      const titleSelectors = ['.marker-title', '.chapter-title', '#details', 'h4', '.title'];

      let timeText = null;
      for (const sel of timeSelectors) {
        const el = item.querySelector(sel);
        if (el?.textContent) {
          timeText = el.textContent;
          break;
        }
      }

      let titleText = null;
      for (const sel of titleSelectors) {
        const el = item.querySelector(sel);
        if (el?.textContent) {
          titleText = el.textContent;
          break;
        }
      }

      if (timeText) {
        const time = parseTime(timeText.trim());
        if (time !== null) {
          // Очищаем заголовок от лишних пробелов и переносов строк
          let cleanTitle = titleText?.trim().replace(/\s+/g, ' ') || '';

          // Debug logging
          if (cleanTitle && cleanTitle.length > 0) {
            timecodeLogger?.warn?.('Timecode', `Debug raw chapter title: ${cleanTitle}`);
          }

          // Remove time prefix if present in label
          cleanTitle = stripLeadingTimePrefix(cleanTitle);

          // Remove duplicate text (some YouTube chapters repeat the title)
          const deduplicated = removeDuplicateText(cleanTitle);

          if (cleanTitle !== deduplicated) {
            timecodeLogger?.warn?.(
              'Timecode',
              `Removed duplicate: ${cleanTitle} -> ${deduplicated}`
            );
          }

          cleanTitle = deduplicated;
          chapters.set(time.toString(), {
            time,
            label: cleanTitle,
            isChapter: true,
          });
        }
      }
    });
    const result = Array.from(chapters.values()).sort((a, b) => a.time - b.time);
    return result;
  };

  // Settings panel
  const attachTimecodeHandlers = () => {
    const advancedSection = $('.ytp-plus-settings-section[data-section="advanced"]');
    if (!advancedSection) return;
    const enableItem = advancedSection.querySelector('.timecode-settings-item');
    if (!enableItem || /** @type {HTMLElement} */ (enableItem).dataset.handlerAttached) return;
    /** @type {HTMLElement} */ (enableItem).dataset.handlerAttached = '1';

    const submenuWrap = advancedSection.querySelector('.timecode-submenu[data-submenu="timecode"]');
    const getSubmenuExpanded = () => {
      try {
        const raw = localStorage.getItem('ytp-plus-submenu-states');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.timecode === 'boolean') return parsed.timecode;
      } catch (_e) {
        U.logSuppressed(_e, 'Timecode');
      }
      return null;
    };

    window.YouTubePlusDesignSystem?.initGlassDropdown?.({
      dropdown: byId('timecode-modifier-dropdown'),
      hiddenSelect: byId('timecode-modifier-combo'),
    });

    const enableCheckbox = byId('timecode-enable-checkbox');
    if (enableCheckbox instanceof HTMLInputElement) {
      enableCheckbox.addEventListener('change', _e => {
        config.enabled = enableCheckbox.checked;
        const submenuToggle = enableItem.querySelector(
          '.ytp-plus-submenu-toggle[data-submenu="timecode"]'
        );
        if (submenuToggle instanceof HTMLElement) {
          if (config.enabled) {
            const stored = getSubmenuExpanded();
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
        }
        toggleTimecodePanel(config.enabled);
        saveSettings();
      });
    }

    const modifierCombo = byId('timecode-modifier-combo');
    if (modifierCombo instanceof HTMLSelectElement) {
      modifierCombo.addEventListener('change', _e => {
        const value = modifierCombo.value;
        config.shortcut.ctrlKey = value.includes('ctrl');
        config.shortcut.altKey = value.includes('alt');
        config.shortcut.shiftKey = value.includes('shift');
        saveSettings();
      });
    }

    const keyInput = byId('timecode-key');
    if (keyInput instanceof HTMLInputElement) {
      keyInput.addEventListener('input', _e => {
        if (keyInput.value) {
          config.shortcut.key = keyInput.value.toUpperCase();
          saveSettings();
        }
      });
      keyInput.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
        e.stopPropagation();
      });
    }
  };

  // CSS
  const insertTimecodeStyles = () => {
    if (byId('timecode-panel-styles')) return;

    const styles = window.YouTubePlusDesignSystem?.getStyle?.('timecode-panel-styles') || '';
    YouTubeUtils.StyleManager.add('timecode-panel-styles', styles);
  };

  // Panel creation
  const createTimecodePanel = () => {
    if (state.dom.panel) return state.dom.panel;

    // Remove any existing panels (for redundancy)
    $$('#timecode-panel').forEach(p => p.remove());

    const panel = document.createElement('div');
    panel.id = 'timecode-panel';
    panel.className = config.enabled ? '' : 'hidden';
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

    // Event delegation
    panel.addEventListener('click', handlePanelClick);
    makeDraggable(panel);

    document.body.appendChild(panel);
    applySavedPanelPosition(panel);
    return panel;
  };

  // Event handling
  const handlePanelClick = (/** @type {any} */ e) => {
    const { target } = e;
    const item = target.closest('.timecode-item');

    // Use closest so clicks on child SVG/path elements are detected
    const reloadButton = target.closest
      ? target.closest('#timecode-reload')
      : target.id === 'timecode-reload'
        ? target
        : null;
    if (reloadButton) {
      e.preventDefault();
      reloadTimecodes(reloadButton);
      return;
    }

    const closeButton = target.closest
      ? target.closest('#timecode-close')
      : target.id === 'timecode-close'
        ? target
        : null;
    if (closeButton) {
      toggleTimecodePanel(false);
    } else if (target.id === 'timecode-add-btn') {
      const video = YouTubeUtils.querySelector ? YouTubeUtils.querySelector('video') : $('video');
      if (video) showTimecodeForm(video.currentTime);
    } else if (target.id === 'timecode-track-toggle') {
      config.autoTrackPlayback = !config.autoTrackPlayback;
      target.textContent = config.autoTrackPlayback ? t('tracking') : t('track');
      target.classList.toggle('active', config.autoTrackPlayback);
      state.dom.panel.classList.toggle('auto-tracking', config.autoTrackPlayback);
      saveSettings();
      if (config.autoTrackPlayback) startTracking();
    } else if (target.id === 'timecode-export-btn') {
      exportTimecodes();
    } else if (target.id === 'timecode-form-cancel') {
      hideTimecodeForm();
    } else if (target.id === 'timecode-form-save') {
      saveTimecodeForm();
    } else if (target.classList.contains('timecode-action')) {
      e.stopPropagation();
      const action = target.dataset.action;
      const index = parseInt(target.closest('.timecode-item').dataset.index, 10);

      if (action === 'edit') {
        editTimecode(index);
      } else if (action === 'delete') {
        deleteTimecode(index);
      }
    } else if (item && !target.closest('.timecode-actions')) {
      const time = parseFloat(item.dataset.time);
      const video = $('video');
      if (video && !Number.isNaN(time)) {
        /** @type {HTMLVideoElement} */ (video).currentTime = time;
        if (video.paused) video.play();
        updateActiveItem(item);
      }
    }
  };

  // Edit timecode
  const editTimecode = (/** @type {any} */ index) => {
    const timecodes = getCurrentTimecodes();
    if (index < 0 || index >= timecodes.length) return;

    const timecode = timecodes[index];
    state.editingIndex = index;

    // Update item appearance
    const item = state.dom.list.querySelector(`.timecode-item[data-index="${index}"]`);
    if (item) {
      item.classList.add('editing');
      // Hide other editing items
      state.dom.list.querySelectorAll('.timecode-item.editing').forEach((/** @type {any} */ el) => {
        if (el !== item) el.classList.remove('editing');
      });
    }

    showTimecodeForm(timecode.time, timecode.label);
  };

  // Delete timecode
  const deleteTimecode = (/** @type {any} */ index) => {
    const timecodes = getCurrentTimecodes();
    if (index < 0 || index >= timecodes.length) return;

    const timecode = timecodes[index];

    // Don't allow deletion of native YouTube chapters
    if (timecode.isChapter && !timecode.isUserAdded) {
      showNotification(t('cannotDeleteChapter'));
      return;
    }

    // Confirm deletion
    if (!confirm(t('confirmDelete').replace('{label}', timecode.label))) return;

    timecodes.splice(index, 1);
    updateTimecodePanel(timecodes);
    saveTimecodesToStorage(timecodes);
    showNotification(t('timecodeDeleted'));
  };

  // Form handling
  const showTimecodeForm = (
    /** @type {any} */ currentTime,
    /** @type {any} */ existingLabel = ''
  ) => {
    const { form, timeInput, labelInput } = state.dom;
    form.classList.add('visible');
    timeInput.value = formatTime(currentTime);
    labelInput.value = existingLabel;
    requestAnimationFrame(() => labelInput.focus());
  };

  const hideTimecodeForm = () => {
    state.dom.form.classList.remove('visible');
    state.editingIndex = null;
    // Remove editing class from all items
    state.dom.list?.querySelectorAll('.timecode-item.editing').forEach((/** @type {any} */ el) => {
      el.classList.remove('editing');
    });
  };

  const saveTimecodeForm = () => {
    const { timeInput, labelInput } = state.dom;
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

    const exportBtn = state.dom.panel?.querySelector('#timecode-export-btn');
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
      navigator.clipboard.writeText(content).then(() => {
        showNotification(t('timecodesCopied'));
      });
    }
  };

  // Panel updates
  const updateTimecodePanel = (/** @type {any} */ timecodes) => {
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
        .map((/** @type {any} */ tc, /** @type {any} */ i) => {
          const timeStr = formatTime(tc.time);
          // Only use label if it exists and is different from time
          let rawLabel = tc.label?.trim() || '';

          // Remove time prefix from label if it starts with the same time
          rawLabel = stripLeadingTimePrefix(rawLabel);

          // Remove duplicate text in label (final safety check)
          const beforeDedup = rawLabel;
          rawLabel = removeDuplicateText(rawLabel);

          if (beforeDedup !== rawLabel && rawLabel.length > 0) {
            timecodeLogger?.warn?.(
              'Timecode',
              `Display deduplicated: ${beforeDedup} -> ${rawLabel}`
            );
          }

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
          const escapeMap = /** @type {any} */ ({
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&#39;',
          });
          const safeLabel = displayLabel.replace(
            /[<>&"']/g,
            (/** @type {any} */ c) => escapeMap[c]
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
        })
        .join('')
    );
  };

  const updateActiveItem = (/** @type {any} */ activeItem) => {
    const items = state.dom.list?.querySelectorAll('.timecode-item');
    if (!items) return;

    items.forEach((/** @type {any} */ item) => item.classList.remove('active', 'pulse'));
    if (activeItem) {
      activeItem.classList.add('active', 'pulse');
      setTimeout(() => activeItem.classList.remove('pulse'), 800);
    }
  };

  // Tracking
  const startTracking = () => {
    if (state.trackingId) return;

    const track = () => {
      try {
        const video = $('video');
        const { panel, currentTime, list } = state.dom;

        // Stop tracking if essential elements are missing or panel is hidden
        if (!(video && panel) || panel.classList.contains('hidden') || !config.autoTrackPlayback) {
          if (state.trackingId) {
            cancelAnimationFrame(state.trackingId);
            state.trackingId = 0;
          }
          return;
        }

        // Update current time display
        if (currentTime && !Number.isNaN(video.currentTime)) {
          currentTime.textContent = formatTime(video.currentTime);
        }

        // Update active item
        const items = list?.querySelectorAll('.timecode-item');
        if (items?.length) {
          let activeIndex = -1;
          let nextIndex = -1;

          for (let i = 0; i < items.length; i++) {
            const timeData = items[i].dataset.time;
            if (!timeData) continue;

            const time = parseFloat(timeData);
            if (Number.isNaN(time)) continue;

            if (video.currentTime >= time) {
              activeIndex = i;
            } else if (nextIndex === -1) {
              nextIndex = i;
            }
          }

          // Update active state
          if (state.activeIndex !== activeIndex) {
            // Remove previous active state
            if (state.activeIndex !== null && state.activeIndex >= 0 && items[state.activeIndex]) {
              items[state.activeIndex].classList.remove('active');
            }

            // Set new active state
            if (activeIndex >= 0 && items[activeIndex]) {
              items[activeIndex].classList.add('active');
              try {
                items[activeIndex].scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                });
              } catch (_e) {
                // Fallback for browsers that don't support smooth scrolling
                items[activeIndex].scrollIntoView(false);
              }
            }

            state.activeIndex = activeIndex;
          }

          // Update progress bar
          if (activeIndex >= 0 && nextIndex >= 0 && items[activeIndex]) {
            const currentTimeData = items[activeIndex].dataset.time;
            const nextTimeData = items[nextIndex].dataset.time;

            if (currentTimeData && nextTimeData) {
              const current = parseFloat(currentTimeData);
              const next = parseFloat(nextTimeData);

              if (!(Number.isNaN(current) || Number.isNaN(next)) && next > current) {
                const progress = ((video.currentTime - current) / (next - current)) * 100;
                const progressEl = items[activeIndex].querySelector('.timecode-progress');
                if (progressEl) {
                  const clampedProgress = Math.min(100, Math.max(0, progress));
                  progressEl.style.width = `${clampedProgress}%`;
                }
              }
            }
          }
        }

        // Continue tracking if enabled
        if (config.autoTrackPlayback) {
          state.trackingId = requestAnimationFrame(track);
        }
      } catch (error) {
        timecodeLogger?.warn?.('Timecode', 'Tracking error', error);
        // Stop tracking on error to prevent infinite error loops
        if (state.trackingId) {
          cancelAnimationFrame(state.trackingId);
          state.trackingId = 0;
        }
      }
    };

    state.trackingId = requestAnimationFrame(track);
  };

  // Stop tracking function
  const stopTracking = () => {
    if (state.trackingId) {
      cancelAnimationFrame(state.trackingId);
      state.trackingId = 0;
    }
  };

  // Drag functionality
  const makeDraggable = (/** @type {any} */ panel) => {
    const header = panel.querySelector('#timecode-header');
    if (!header) return;

    /** @type {any} */ let startX;
    /** @type {any} */ let startY;
    /** @type {any} */ let startLeft;
    /** @type {any} */ let startTop;

    const mouseDownHandler = (/** @type {any} */ e) => {
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

      const handleMove = (/** @type {any} */ event) => {
        if (!state.dragging) return;

        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        const { left, top } = clampPanelPosition(panel, startLeft + deltaX, startTop + deltaY);

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';
      };

      const handleUp = () => {
        if (!state.dragging) return;

        state.dragging = false;
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);

        const rectAfter = panel.getBoundingClientRect();
        const { left, top } = clampPanelPosition(panel, rectAfter.left, rectAfter.top);

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';

        savePanelPosition(left, top);
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    };

    YouTubeUtils.cleanupManager.registerListener(header, 'mousedown', mouseDownHandler);
  };

  // Storage
  const saveTimecodesToStorage = (/** @type {any} */ timecodes) => {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) return;

    try {
      const minimal = timecodes.map((/** @type {any} */ tc) => ({
        t: tc.time,
        l: tc.label?.trim() || '',
        c: tc.isChapter,
        u: tc.isUserAdded,
      }));
      localStorage.setItem(`yt_tc_${videoId}`, JSON.stringify(minimal));
    } catch (_e) {
      U.logSuppressed(_e, 'Timecode');
    }
  };

  const loadTimecodesFromStorage = () => {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) return null;

    try {
      const data = localStorage.getItem(`yt_tc_${videoId}`);
      return data
        ? JSON.parse(data)
            .map((/** @type {any} */ tc) => ({
              time: tc.t,
              label: tc.l,
              isChapter: tc.c,
              isUserAdded: tc.u,
            }))
            .sort((/** @type {any} */ a, /** @type {any} */ b) => a.time - b.time)
        : null;
    } catch (_e) {
      return null;
    }
  };

  const getCurrentTimecodes = () => {
    const items = state.dom.list?.querySelectorAll('.timecode-item');
    if (!items) return [];

    return Array.from(items)
      .map((/** @type {any} */ item) => {
        const time = parseFloat(item.dataset.time);
        const labelEl = item.querySelector('.timecode-label');
        // Only use label if element exists and has actual text content
        const label = labelEl?.textContent?.trim() || '';

        return {
          time,
          label: label, // Keep original label (can be empty)
          isChapter: item.classList.contains('has-chapter'),
          isUserAdded: !item.classList.contains('has-chapter'),
        };
      })
      .sort((a, b) => a.time - b.time);
  };

  // Toggle panel
  const toggleTimecodePanel = (/** @type {any} */ show = undefined) => {
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
        detectTimecodes().catch((/** @type {any} */ err) => {
          timecodeLogger?.error?.('Timecode', 'Detection failed', err);
        });
      }

      if (config.autoTrackPlayback) startTracking();
    } else if (state.trackingId) {
      cancelAnimationFrame(state.trackingId);
      state.trackingId = 0;
    }
  };

  // Navigation handling
  const setupNavigation = () => {
    let currentVideoId = new URLSearchParams(window.location.search).get('v');

    const handleNavigationChange = () => {
      const newVideoId = new URLSearchParams(window.location.search).get('v');
      if (newVideoId === currentVideoId || window.location.pathname !== '/watch') return;

      currentVideoId = newVideoId;
      state.activeIndex = null;
      state.editingIndex = null;
      state.timecodes.clear();

      if (config.enabled && state.dom.panel && !state.dom.panel.classList.contains('hidden')) {
        const saved = loadTimecodesFromStorage();
        if (saved?.length) {
          updateTimecodePanel(saved);
        } else if (config.autoDetect) {
          setTimeout(
            () =>
              detectTimecodes().catch(err => {
                timecodeLogger?.error?.('Timecode', 'Detection failed', err);
              }),
            500
          );
        }
        if (config.autoTrackPlayback) startTracking();
      }
    };

    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'yt-navigate-finish',
        handleNavigationChange
      );
    } else {
      document.addEventListener('yt-navigate-finish', handleNavigationChange);
    }
  };

  // Keyboard shortcuts
  const setupKeyboard = () => {
    const keydownHandler = (/** @type {any} */ e) => {
      if (!config.enabled) return;

      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (target.matches?.('input, textarea, [contenteditable]')) return;

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
    if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
      YouTubeUtils.cleanupManager.registerListener(document, 'keydown', keydownHandler);
    } else {
      document.addEventListener('keydown', keydownHandler);
    }
  };

  // Cleanup on unload
  const cleanup = () => {
    stopTracking();
    if (state.dom.panel) {
      state.dom.panel.remove();
      state.dom.panel = null;
    }
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
      document.addEventListener('youtube-plus-settings-modal-opened', settingsModalHandler);
    }

    const clickHandler = (/** @type {any} */ e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const navItem = target?.closest?.('.ytp-plus-settings-nav-item');
      if (navItem?.dataset?.section === 'advanced') {
        attachTimecodeHandlers();
      }
    };
    if (YouTubeUtils.cleanupManager?.registerListener) {
      YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);
    } else {
      document.addEventListener('click', clickHandler, true);
    }
  };

  // Initialize
  const init = () => {
    if (initStarted) return;
    // Runtime only on www.youtube.com (not music/studio/iframes)
    if (U?.getHostname?.() !== 'www.youtube.com' || window.frameElement) return;
    if (!isRelevantRoute()) return;

    const appRoot =
      (typeof YouTubeUtils?.querySelector === 'function' &&
        YouTubeUtils.querySelector('ytd-app')) ||
      $('ytd-app');

    if (!appRoot) {
      scheduleInitRetry();
      return;
    }

    initStarted = true;

    loadSettings();
    insertTimecodeStyles();
    setupKeyboard();
    setupNavigation();

    // Settings modal observer
    /** @type {string | null} */ let modalObserverSubId = null;
    /** @type {ReturnType<typeof setTimeout> | null} */ let modalObserverTimeout = null;

    const attachModalObserver = (/** @type {any} */ modalEl) => {
      if (!(modalEl && modalEl instanceof Element)) return;
      const coordinator = window.YouTubePlusMutationCoordinator;
      if (modalObserverSubId && coordinator?.unsubscribe) {
        try {
          coordinator.unsubscribe(modalObserverSubId);
        } catch (_e) {
          U.logSuppressed(_e, 'Timecode');
        }
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
          // Debounce modal observer to reduce unnecessary checks
          if (modalObserverTimeout) return;
          modalObserverTimeout = setTimeout(() => {
            modalObserverTimeout = null;
            if (
              $('.ytp-plus-settings-section[data-section="advanced"]:not(.hidden)') &&
              !$('.timecode-settings-item')
            ) {
              attachTimecodeHandlers();
            }
          }, 30);
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

    // Settings modal integration — use event instead of body MutationObserver
    const settingsModalHandler = () => {
      const modal = $('.ytp-plus-settings-modal');
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
      document.addEventListener('youtube-plus-settings-modal-opened', settingsModalHandler);
    }

    const clickHandler = (/** @type {any} */ e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const navItem = target?.closest?.('.ytp-plus-settings-nav-item');
      if (navItem?.dataset?.section === 'advanced') {
        attachTimecodeHandlers();
      }
    };
    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);

    if (config.enabled && !state.resizeListenerKey) {
      const onResize = throttle(() => {
        if (!state.dom.panel) return;

        const rect = state.dom.panel.getBoundingClientRect();
        const { left, top } = clampPanelPosition(state.dom.panel, rect.left, rect.top);

        state.dom.panel.style.left = `${left}px`;
        state.dom.panel.style.top = `${top}px`;
        state.dom.panel.style.right = 'auto';

        savePanelPosition(left, top);
      }, 200);

      state.resizeListenerKey = YouTubeUtils.cleanupManager.registerListener(
        window,
        'resize',
        onResize
      );
    }
  };

  const handleNavigate = () => {
    setupTimecodeSettingsIntegration();
    if (!isRelevantRoute()) {
      if (initStarted) cleanup();
      return;
    }
    init();
  };

  // Register settings modal listener at module scope so it fires
  // regardless of route. Without this, the settings UI integration
  // would only be registered after whenRelevant decides the route is
  // relevant or the user clicks the Advanced tab, causing a race
  // condition where opening the modal on a non-/watch page would
  // miss the event.
  document.addEventListener('youtube-plus-settings-modal-opened', () => {
    try {
      setupTimecodeSettingsIntegration();
      attachTimecodeHandlers();
    } catch (_e) {
      /* non-critical */
    }
  });

  // timecode runtime: /watch only. The settings UI is wired in
  // setupTimecodeSettingsIntegration, which hooks a click listener
  // that runs the inject when the user opens the "Advanced" tab.
  // That listener self-guards via state.settingsIntegrationStarted,
  // so we do not also need a separate onSectionActive subscription.
  if (window.YouTubeUtils?.whenRelevant) {
    window.YouTubeUtils.whenRelevant({
      name: 'timecode',
      isRelevant: isRelevantRoute,
      onEnter: handleNavigate,
    });
  } else {
    // Fallback: direct initialization
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', handleNavigate, {
        once: true,
      });
    } else {
      handleNavigate();
    }
  }

  // Settings UI integration must be reachable from the Advanced tab
  // regardless of route, so the user can configure shortcuts even on
  // /home, /feed/*, etc. The integration is idempotent and self-guards
  // via state.settingsIntegrationStarted.
  if (window.YouTubeUtils?.onSectionActive) {
    window.YouTubeUtils.onSectionActive('advanced', () => {
      try {
        setupTimecodeSettingsIntegration();
        attachTimecodeHandlers();
      } catch (_e) {
        // Non-critical: settings UI is best-effort
      }
    });
  }

  if (typeof window.YouTubeUtils?.cleanupManager?.registerListener === 'function') {
    YouTubeUtils.cleanupManager.registerListener(document, 'yt-navigate-finish', handleNavigate, {
      passive: true,
    });
  } else {
    document.addEventListener('yt-navigate-finish', handleNavigate, {
      passive: true,
    });
  }

  // Cleanup on beforeunload
  window.addEventListener('beforeunload', cleanup);
})();
