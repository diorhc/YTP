// YouTube Timecode Panel
(function () {
  'use strict';

  // DOM Cache Helper - reduces repeated queries
  const getCache = () => typeof window !== 'undefined' && window.YouTubeDOMCache;
  /**
   * Query single element with optional caching
   * @param {string} sel - CSS selector
   * @param {Element|Document} [ctx] - Context element
   * @returns {Element|null}
   */
  const $ = (sel, ctx) =>
    getCache()?.querySelector(sel, ctx) || (ctx || document).querySelector(sel);
  /**
   * Query all elements with optional caching
   * @param {string} sel - CSS selector
   * @param {Element|Document} [ctx] - Context element
   * @returns {Element[]}
   */
  const $$ = (sel, ctx) =>
    getCache()?.querySelectorAll(sel, ctx) || Array.from((ctx || document).querySelectorAll(sel));
  /**
   * Get element by ID with optional caching
   * @param {string} id - Element ID
   * @returns {Element|null}
   */
  const byId = id => getCache()?.getElementById(id) || document.getElementById(id);

  // Early exit for embeds to prevent duplicate panels - ✅ Use cached querySelector
  if (window.location.hostname !== 'www.youtube.com' || window.frameElement) {
    return;
  }

  // Prevent multiple initializations
  if (window._timecodeModuleInitialized) return;
  window._timecodeModuleInitialized = true;

  /**
   * Translation helper - uses centralized i18n system
   * Falls back to key if translation not available
   * @param {string} key - Translation key
   * @param {Object} params - Interpolation parameters
   * @returns {string} Translated string
   */
  const t = (key, params = {}) => {
    try {
      if (typeof window !== 'undefined') {
        if (window.YouTubePlusI18n && typeof window.YouTubePlusI18n.t === 'function') {
          return window.YouTubePlusI18n.t(key, params);
        }
        if (window.YouTubeUtils && typeof window.YouTubeUtils.t === 'function') {
          return window.YouTubeUtils.t(key, params);
        }
      }
    } catch {
      // Fallback to key if central i18n unavailable
    }
    return key;
  };

  // Configuration
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
  const state = {
    timecodes: new Map(),
    dom: {},
    isReloading: false,
    activeIndex: null,
    trackingId: 0,
    dragging: false,
    editingIndex: null,
    resizeListenerKey: null,
  };

  let initStarted = false;

  const scheduleInitRetry = () => {
    const timeoutId = setTimeout(init, 250);
    YouTubeUtils.cleanupManager?.registerTimeout?.(timeoutId);
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
        console.warn('[Timecode] Invalid settings format');
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
          !isNaN(left) &&
          !isNaN(top) &&
          left >= 0 &&
          top >= 0
        ) {
          config.panelPosition = { left, top };
        }
      }
    } catch (error) {
      console.error('[Timecode] Error loading settings:', error);
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
      console.error('[Timecode] Error saving settings:', error);
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
      if (!panel || !(panel instanceof HTMLElement)) {
        console.warn('[Timecode] Invalid panel element');
        return { left: 0, top: 0 };
      }

      // Validate input coordinates
      if (typeof left !== 'number' || typeof top !== 'number' || isNaN(left) || isNaN(top)) {
        console.warn('[Timecode] Invalid position coordinates');
        return { left: 0, top: 0 };
      }

      const rect = panel.getBoundingClientRect();
      const width = rect.width || panel.offsetWidth || 0;
      const height = rect.height || panel.offsetHeight || 0;

      const maxLeft = Math.max(0, window.innerWidth - width);
      const maxTop = Math.max(0, window.innerHeight - height);

      return {
        left: Math.min(Math.max(0, left), maxLeft),
        top: Math.min(Math.max(0, top), maxTop),
      };
    } catch (error) {
      console.error('[Timecode] Error clamping panel position:', error);
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
      if (typeof left !== 'number' || typeof top !== 'number' || isNaN(left) || isNaN(top)) {
        console.warn('[Timecode] Invalid position coordinates for saving');
        return;
      }
      config.panelPosition = { left, top };
      saveSettings();
    } catch (error) {
      console.error('[Timecode] Error saving panel position:', error);
    }
  };

  /**
   * Apply saved panel position to a panel element
   * @param {HTMLElement} panel - The panel element to position
   * @returns {void}
   */
  const applySavedPanelPosition = panel => {
    if (!panel || !config.panelPosition) return;

    requestAnimationFrame(() => {
      const { left, top } = clampPanelPosition(
        panel,
        config.panelPosition.left,
        config.panelPosition.top
      );
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
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

  /**
   * Format seconds into HH:MM:SS or MM:SS time string
   * @param {number} seconds - Number of seconds to format
   * @returns {string} Formatted time string
   */
  const formatTime = seconds => {
    if (isNaN(seconds)) return '00:00';
    seconds = Math.round(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

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
  const parseTime = timeStr => {
    try {
      if (!timeStr || typeof timeStr !== 'string') return null;

      const str = timeStr.trim();
      if (str.length === 0 || str.length > 12) return null; // Sanity check

      // Handle HH:MM:SS format
      let match = str.match(/^(\d+):(\d{1,2}):(\d{2})$/);
      if (match) {
        const [, h, m, s] = match.map(Number);
        // Validate ranges
        if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
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
        if (isNaN(m) || isNaN(s)) return null;
        if (m >= 60 || s >= 60 || m < 0 || s < 0) return null;
        return m * 60 + s;
      }

      return null;
    } catch (error) {
      console.error('[Timecode] Error parsing time:', error);
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
        console.warn('[Timecode] Text too long, truncating');
        text = text.substring(0, 50000);
      }

      const timecodes = [];
      const seen = new Set();
      const patterns = [
        /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(.+?)$/gm,
        /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+?)$/gm,
        /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:]\s*([^\n\r]{1,100}?)(?=\s*\d{1,2}:\d{2}|\s*$)/g,
        /(\d{1,2}:\d{2}(?::\d{2})?)\s*[–—-]\s*([^\n]+)/gm,
        /^(\d{1,2}:\d{2}(?::\d{2})?)\s*(.+)$/gm,
      ];

      for (const pattern of patterns) {
        let match;
        let iterations = 0;
        const maxIterations = 1000; // Prevent infinite loops

        while ((match = pattern.exec(text)) !== null && iterations++ < maxIterations) {
          const time = parseTime(match[1]);
          if (time !== null && !seen.has(time)) {
            seen.add(time);
            // Sanitize label text - only use match[2] if it exists and is not empty
            let label = (match[2] || '')
              .trim()
              .replace(/^\d+[\.\)]\s*/, '')
              .replace(/\s+/g, ' ') // Normalize whitespace
              .substring(0, 100); // Limit label length

            // Debug logging
            const originalLabel = label;

            // Remove potentially dangerous characters
            label = label.replace(/[<>\"']/g, '');

            // Remove duplicate text in label
            label = removeDuplicateText(label);

            if (originalLabel !== label && label.length > 0) {
              console.warn('[Timecode] Description deduplicated:', originalLabel, '->', label);
            }

            // Only add if we have actual content (time is always added, label can be empty)
            timecodes.push({ time, label: label || '', originalText: match[1] });
          }
        }

        if (iterations >= maxIterations) {
          console.warn('[Timecode] Maximum iterations reached during extraction');
        }
      }

      return timecodes.sort((a, b) => a.time - b.time);
    } catch (error) {
      console.error('[Timecode] Error extracting timecodes:', error);
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
      YouTubeUtils.logError('TimecodePanel', 'collectCommentsText failed', error);
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
      if (ariaLabel && ariaLabel.includes('less')) return false;

      if (button.offsetParent !== null) {
        try {
          /** @type {HTMLElement} */ (button).click();
          await sleep(400);
          return true;
        } catch (error) {
          console.warn('[Timecode] Failed to click expand button:', error);
        }
      }
    }

    const inlineExpander = $('ytd-text-inline-expander[collapsed]');
    if (inlineExpander) {
      try {
        inlineExpander.removeAttribute('collapsed');
      } catch (error) {
        YouTubeUtils.logError('TimecodePanel', 'Failed to expand description', error);
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
        await YouTubeUtils.waitForElement(DESCRIPTION_SELECTOR_COMBINED, 1500);
      } catch {
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
  const detectTimecodes = async (options = {}) => {
    const { force = false } = options;

    if (!config.enabled) return [];
    if (!force && !config.autoDetect) return [];

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
          uniqueMap.set(key, { ...existing, label: chapter.label, isChapter: true });
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
        YouTubeUtils.logError('TimecodePanel', 'Comment scanning failed', error);
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
  const reloadTimecodes = async (buttonOverride = null) => {
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
        showNotification(t('foundTimecodes').replace('{count}', result.length));
      } else {
        updateTimecodePanel([]);
        showNotification(t('noTimecodesFound'));
      }
    } catch (error) {
      YouTubeUtils.logError('TimecodePanel', 'Reload failed', error);
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
            console.warn('[Timecode Debug] Raw chapter title:', cleanTitle);
          }

          // Remove time prefix if present in label
          cleanTitle = cleanTitle.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*[-–—:]?\s*/, '');

          // Remove duplicate text (some YouTube chapters repeat the title)
          const deduplicated = removeDuplicateText(cleanTitle);

          if (cleanTitle !== deduplicated) {
            console.warn('[Timecode] Removed duplicate:', cleanTitle, '->', deduplicated);
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
  const addTimecodePanelSettings = () => {
    // ✅ Use cached querySelector
    const advancedSection = YouTubeUtils.querySelector
      ? YouTubeUtils.querySelector('.ytp-plus-settings-section[data-section="advanced"]')
      : $('.ytp-plus-settings-section[data-section="advanced"]');
    if (
      !advancedSection ||
      (YouTubeUtils.querySelector
        ? YouTubeUtils.querySelector('.timecode-settings-item')
        : $('.timecode-settings-item'))
    ) {
      return;
    }

    const { ctrlKey, altKey, shiftKey } = config.shortcut;
    const modifierValue =
      [
        ctrlKey && altKey && shiftKey && 'ctrl+alt+shift',
        ctrlKey && altKey && 'ctrl+alt',
        ctrlKey && shiftKey && 'ctrl+shift',
        altKey && shiftKey && 'alt+shift',
        ctrlKey && 'ctrl',
        altKey && 'alt',
        shiftKey && 'shift',
      ].find(Boolean) || 'none';

    const enableDiv = document.createElement('div');
    enableDiv.className = 'ytp-plus-settings-item timecode-settings-item';
    enableDiv.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">${t('enableTimecode')}</label>
          <div class="ytp-plus-settings-item-description">${t('enableDescription')}</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enabled" ${config.enabled ? 'checked' : ''}>
      `;

    const shortcutDiv = document.createElement('div');
    shortcutDiv.className = 'ytp-plus-settings-item timecode-settings-item timecode-shortcut-item';
    shortcutDiv.style.display = config.enabled ? 'flex' : 'none';
    shortcutDiv.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">${t('keyboardShortcut')}</label>
          <div class="ytp-plus-settings-item-description">${t('shortcutDescription')}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <!-- Hidden native select kept for programmatic compatibility -->
          <select id="timecode-modifier-combo" style="display:none;">
            ${[
              'none',
              'ctrl',
              'alt',
              'shift',
              'ctrl+alt',
              'ctrl+shift',
              'alt+shift',
              'ctrl+alt+shift',
            ]
              .map(
                v =>
                  `<option value="${v}" ${v === modifierValue ? 'selected' : ''}>${
                    v === 'none'
                      ? 'None'
                      : v
                          .split('+')
                          .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                          .join('+')
                  }</option>`
              )
              .join('')}
          </select>

          <div class="glass-dropdown" id="timecode-modifier-dropdown" tabindex="0" role="listbox" aria-expanded="false">
            <button class="glass-dropdown__toggle" type="button" aria-haspopup="listbox">
              <span class="glass-dropdown__label">${
                modifierValue === 'none'
                  ? 'None'
                  : modifierValue
                      .split('+')
                      .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                      .join('+')
              }</span>
              <svg class="glass-dropdown__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <ul class="glass-dropdown__list" role="presentation">
              ${[
                'none',
                'ctrl',
                'alt',
                'shift',
                'ctrl+alt',
                'ctrl+shift',
                'alt+shift',
                'ctrl+alt+shift',
              ]
                .map(v => {
                  const label =
                    v === 'none'
                      ? 'None'
                      : v
                          .split('+')
                          .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                          .join('+');
                  const sel = v === modifierValue ? ' aria-selected="true"' : '';
                  return `<li class="glass-dropdown__item" data-value="${v}" role="option"${sel}>${label}</li>`;
                })
                .join('')}
            </ul>
          </div>

          <span style="color:inherit;opacity:0.8;">+</span>
          <input type="text" id="timecode-key" value="${config.shortcut.key}" maxlength="1" style="width: 30px; text-align: center; background: rgba(34, 34, 34, var(--yt-header-bg-opacity)); color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 4px;">
        </div>
      `;

    advancedSection.append(enableDiv, shortcutDiv);

    // Initialize custom glass dropdown interactions
    const initGlassDropdown = () => {
      const hiddenSelect = byId('timecode-modifier-combo');
      const dropdown = byId('timecode-modifier-dropdown');
      if (!hiddenSelect || !dropdown) return;

      const toggle = $('.glass-dropdown__toggle', dropdown);
      const list = $('.glass-dropdown__list', dropdown);
      const label = $('.glass-dropdown__label', dropdown);

      let items = Array.from($$('.glass-dropdown__item', list));
      let idx = items.findIndex(it => it.getAttribute('aria-selected') === 'true');
      if (idx < 0) idx = 0;

      const closeList = () => {
        dropdown.setAttribute('aria-expanded', 'false');
        list.style.display = 'none';
      };

      const openList = () => {
        dropdown.setAttribute('aria-expanded', 'true');
        list.style.display = 'block';
        items = Array.from($$('.glass-dropdown__item', list));
      };

      // Set initial state
      closeList();

      toggle.addEventListener('click', () => {
        const expanded = dropdown.getAttribute('aria-expanded') === 'true';
        if (expanded) closeList();
        else openList();
      });

      // Click outside to close
      document.addEventListener('click', e => {
        if (!dropdown.contains(e.target)) closeList();
      });

      // Item selection
      list.addEventListener('click', e => {
        const it = e.target.closest('.glass-dropdown__item');
        if (!it) return;
        const val = it.dataset.value;
        hiddenSelect.value = val;
        // update aria-selected
        list
          .querySelectorAll('.glass-dropdown__item')
          .forEach(li => li.removeAttribute('aria-selected'));
        it.setAttribute('aria-selected', 'true');
        idx = items.indexOf(it);
        label.textContent = it.textContent;
        // trigger change to reuse existing save logic
        hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
        closeList();
      });

      // keyboard support with arrow navigation
      dropdown.addEventListener('keydown', e => {
        const expanded = dropdown.getAttribute('aria-expanded') === 'true';
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (!expanded) openList();
          idx = Math.min(idx + 1, items.length - 1);
          items.forEach(it => it.removeAttribute('aria-selected'));
          items[idx].setAttribute('aria-selected', 'true');
          items[idx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (!expanded) openList();
          idx = Math.max(idx - 1, 0);
          items.forEach(it => it.removeAttribute('aria-selected'));
          items[idx].setAttribute('aria-selected', 'true');
          items[idx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!expanded) {
            openList();
            return;
          }
          const it = items[idx];
          if (it) {
            hiddenSelect.value = it.dataset.value;
            hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
            label.textContent = it.textContent;
            closeList();
          }
        } else if (e.key === 'Escape') {
          closeList();
        }
      });
    };

    // Defer init to ensure elements are in DOM
    setTimeout(initGlassDropdown, 0);

    // Event listeners
    advancedSection.addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (target.matches && target.matches('.ytp-plus-settings-checkbox[data-setting="enabled"]')) {
        config.enabled = /** @type {HTMLInputElement} */ (target).checked;
        shortcutDiv.style.display = config.enabled ? 'flex' : 'none';
        toggleTimecodePanel(config.enabled);
        saveSettings();
      }
    });

    byId('timecode-modifier-combo')?.addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLSelectElement} */ (e.target);
      const value = target.value;
      config.shortcut.ctrlKey = value.includes('ctrl');
      config.shortcut.altKey = value.includes('alt');
      config.shortcut.shiftKey = value.includes('shift');
      saveSettings();
    });

    byId('timecode-key')?.addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      if (target.value) {
        config.shortcut.key = target.value.toUpperCase();
        saveSettings();
      }
    });
  };

  // CSS
  const insertTimecodeStyles = () => {
    if (byId('timecode-panel-styles')) return;

    // ✅ Use StyleManager instead of createElement('style')
    const styles = `
        :root{--tc-panel-bg:rgba(255,255,255,0.06);--tc-panel-border:rgba(255,255,255,0.12);--tc-panel-color:#fff}
        html[dark],body[dark]{--tc-panel-bg:rgba(34,34,34,0.75);--tc-panel-border:rgba(255,255,255,0.12);--tc-panel-color:#fff}
        html:not([dark]){--tc-panel-bg:rgba(255,255,255,0.95);--tc-panel-border:rgba(0,0,0,0.08);--tc-panel-color:#222}
        #timecode-panel{position:fixed;right:20px;top:80px;background:var(--tc-panel-bg);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,0.45);width:320px;max-height:70vh;z-index:10000;color:var(--tc-panel-color);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);border:1.5px solid var(--tc-panel-border);transition:transform .28s cubic-bezier(.4,0,.2,1),opacity .28s;overflow:hidden;display:flex;flex-direction:column}
        #timecode-panel.hidden{transform:translateX(300px);opacity:0;pointer-events:none}
        #timecode-panel.auto-tracking{box-shadow:0 12px 48px rgba(255,0,0,0.12);border-color:rgba(255,0,0,0.25)}
        #timecode-header{display:flex;justify-content:space-between;align-items:center;padding:14px;border-bottom:1px solid rgba(255,255,255,0.04);background:linear-gradient(180deg, rgba(255,255,255,0.02), transparent);cursor:move}
        #timecode-title{font-weight:600;margin:0;font-size:15px;user-select:none;display:flex;align-items:center;gap:8px}
        #timecode-tracking-indicator{width:8px;height:8px;background:red;border-radius:50%;opacity:0;transition:opacity .3s}
        #timecode-panel.auto-tracking #timecode-tracking-indicator{opacity:1}
        #timecode-current-time{font-family:monospace;font-size:12px;padding:2px 6px;background:rgba(255,0,0,.3);border-radius:3px;margin-left:auto}
        #timecode-header-controls{display:flex;align-items:center;gap:6px}
        #timecode-reload,#timecode-close{background:transparent;border:none;color:inherit;cursor:pointer;width:28px;height:28px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background .18s,color .18s}
        #timecode-reload:hover,#timecode-close:hover{background:rgba(255,255,255,0.04)}
        #timecode-reload.loading{animation:timecode-spin .8s linear infinite}
        #timecode-list{overflow-y:auto;padding:8px 0;max-height:calc(70vh - 80px);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent}
        #timecode-list::-webkit-scrollbar{width:6px}
        #timecode-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3);border-radius:3px}
        .timecode-item{padding:10px 14px;display:flex;align-items:center;cursor:pointer;transition:background-color .16s,transform .12s;border-left:3px solid transparent;position:relative;border-radius:8px;margin:6px 10px}
        .timecode-item:hover{background:rgba(255,255,255,0.04);transform:translateY(-2px)}
        .timecode-item:hover .timecode-actions{opacity:1}
        .timecode-item.active{background:linear-gradient(90deg, rgba(255,68,68,0.12), rgba(255,68,68,0.04));border-left-color:#ff6666;box-shadow:inset 0 0 0 1px rgba(255,68,68,0.03)}
        .timecode-item.active.pulse{animation:pulse .8s ease-out}
        .timecode-item.editing{background:linear-gradient(90deg, rgba(255,170,0,0.08), rgba(255,170,0,0.03));border-left-color:#ffaa00}
        .timecode-item.editing .timecode-actions{opacity:1}
        @keyframes pulse{0%{transform:scale(1)}50%{transform:scale(1.02)}100%{transform:scale(1)}}
        @keyframes timecode-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .timecode-time{font-family:monospace;margin-right:10px;color:rgba(255,255,255,.8);font-size:13px;min-width:45px;flex-shrink:0}
        .timecode-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;flex:1;margin-left:4px}
        .timecode-item:not(:has(.timecode-label)) .timecode-time{flex:1;text-align:left}
        .timecode-item.has-chapter .timecode-time{color:#ff4444}
        .timecode-progress{width:0;height:2px;background:#ff4444;position:absolute;bottom:0;left:0;transition:width .3s;opacity:.8}
        .timecode-actions{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;gap:4px;opacity:0;transition:opacity .2s;background:rgba(0,0,0,.8);border-radius:4px;padding:2px}
        .timecode-action{background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;padding:4px;font-size:12px;border-radius:2px;transition:color .2s,background-color .2s}
        .timecode-action:hover{color:#fff;background:rgba(255,255,255,.2)}
        .timecode-action.edit:hover{color:#ffaa00}
        .timecode-action.delete:hover{color:#ff4444}
        #timecode-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;text-align:center;color:rgba(255,255,255,.7);font-size:13px}
        #timecode-form{padding:12px;border-top:1px solid rgba(255,255,255,.04);display:none}
        #timecode-form.visible{display:block}
        #timecode-form input{width:100%;margin-bottom:8px;padding:8px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:4px;color:#fff;font-size:13px}
        #timecode-form input::placeholder{color:rgba(255,255,255,.6)}
        #timecode-form-buttons{display:flex;gap:8px;justify-content:flex-end}
        #timecode-form-buttons button{padding:6px 12px;border:none;border-radius:4px;cursor:pointer;font-size:12px;transition:background-color .2s}
        #timecode-form-cancel{background:rgba(255,255,255,.2);color:#fff}
        #timecode-form-cancel:hover{background:rgba(255,255,255,.3)}
        #timecode-form-save{background:#ff4444;color:#fff}
        #timecode-form-save:hover{background:#ff6666}
        #timecode-actions{padding:10px;border-top:1px solid rgba(255,255,255,.04);display:flex;gap:8px;background:linear-gradient(180deg,transparent,rgba(0,0,0,0.03))}
        #timecode-actions button{padding:8px 12px;border:none;border-radius:8px;cursor:pointer;font-size:13px;transition:background .18s;color:inherit;background:rgba(255,255,255,0.02)}
        #timecode-actions button:hover{background:rgba(255,255,255,0.04)}
        #timecode-track-toggle.active{background:linear-gradient(90deg,#ff6b6b,#ff4444);color:#fff}
        `;
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

    panel.innerHTML = `
        <div id="timecode-header">
          <h3 id="timecode-title">
            <div id="timecode-tracking-indicator"></div>
            ${t('timecodes')}
            <span id="timecode-current-time"></span>
          </h3>
          <div id="timecode-header-controls">
            <button id="timecode-reload" title="${t('reload')}" aria-label="${t('reload')}">⟳</button>
            <button id="timecode-close" title="${t('close')}" aria-label="${t('close')}">
              <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
              </svg>
            </button>
          </div>
        </div>
        <div id="timecode-list"></div>
        <div id="timecode-empty">
          <div>${t('noTimecodesFound')}</div>
          <div style="margin-top:5px;font-size:12px">${t('clickToAdd')}</div>
        </div>
        <div id="timecode-form">
          <input type="text" id="timecode-form-time" placeholder="${t('timePlaceholder')}">
          <input type="text" id="timecode-form-label" placeholder="${t('labelPlaceholder')}">
          <div id="timecode-form-buttons">
            <button type="button" id="timecode-form-cancel">${t('cancel')}</button>
            <button type="button" id="timecode-form-save" class="save">${t('save')}</button>
          </div>
        </div>
        <div id="timecode-actions">
          <button id="timecode-add-btn">${t('add')}</button>
          <button id="timecode-export-btn" ${config.export ? '' : 'style="display:none"'}>${t('export')}</button>
          <button id="timecode-track-toggle" class="${config.autoTrackPlayback ? 'active' : ''}">${config.autoTrackPlayback ? t('tracking') : t('track')}</button>
        </div>
      `;

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
  const handlePanelClick = e => {
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
      // ✅ Use cached querySelector
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
      const video = document.querySelector('video');
      if (video && !isNaN(time)) {
        /** @type {HTMLVideoElement} */ (video).currentTime = time;
        if (video.paused) video.play();
        updateActiveItem(item);
      }
    }
  };

  // Edit timecode
  const editTimecode = index => {
    const timecodes = getCurrentTimecodes();
    if (index < 0 || index >= timecodes.length) return;

    const timecode = timecodes[index];
    state.editingIndex = index;

    // Update item appearance
    const item = state.dom.list.querySelector(`.timecode-item[data-index="${index}"]`);
    if (item) {
      item.classList.add('editing');
      // Hide other editing items
      state.dom.list.querySelectorAll('.timecode-item.editing').forEach(el => {
        if (el !== item) el.classList.remove('editing');
      });
    }

    showTimecodeForm(timecode.time, timecode.label);
  };

  // Delete timecode
  const deleteTimecode = index => {
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
  const showTimecodeForm = (currentTime, existingLabel = '') => {
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
    state.dom.list?.querySelectorAll('.timecode-item.editing').forEach(el => {
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
      exportBtn.style.backgroundColor = 'rgba(0,220,0,0.8)';
      setTimeout(() => {
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
  const updateTimecodePanel = timecodes => {
    const { list, empty } = state.dom;
    if (!list || !empty) return;

    const isEmpty = !timecodes.length;
    empty.style.display = isEmpty ? 'flex' : 'none';
    list.style.display = isEmpty ? 'none' : 'block';

    if (isEmpty) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = timecodes
      .map((tc, i) => {
        const timeStr = formatTime(tc.time);
        // Only use label if it exists and is different from time
        let rawLabel = tc.label?.trim() || '';

        // Remove time prefix from label if it starts with the same time
        const timePattern = /^\d{1,2}:\d{2}(?::\d{2})?\s*[-–—:]?\s*/;
        rawLabel = rawLabel.replace(timePattern, '');

        // Remove duplicate text in label (final safety check)
        const beforeDedup = rawLabel;
        rawLabel = removeDuplicateText(rawLabel);

        if (beforeDedup !== rawLabel && rawLabel.length > 0) {
          console.warn('[Timecode] Display deduplicated:', beforeDedup, '->', rawLabel);
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
        const safeLabel = displayLabel.replace(
          /[<>&"']/g,
          c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]
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
      .join('');
  };

  const updateActiveItem = activeItem => {
    const items = state.dom.list?.querySelectorAll('.timecode-item');
    if (!items) return;

    items.forEach(item => item.classList.remove('active', 'pulse'));
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
        const video = document.querySelector('video');
        const { panel, currentTime, list } = state.dom;

        // Stop tracking if essential elements are missing or panel is hidden
        if (!video || !panel || panel.classList.contains('hidden') || !config.autoTrackPlayback) {
          if (state.trackingId) {
            cancelAnimationFrame(state.trackingId);
            state.trackingId = 0;
          }
          return;
        }

        // Update current time display
        if (currentTime && !isNaN(video.currentTime)) {
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
            if (isNaN(time)) continue;

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
                items[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
              } catch {
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

              if (!isNaN(current) && !isNaN(next) && next > current) {
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
        console.warn('Timecode tracking error:', error);
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
  const makeDraggable = panel => {
    const header = panel.querySelector('#timecode-header');
    if (!header) return;

    let startX, startY, startLeft, startTop;

    const mouseDownHandler = e => {
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

      const handleMove = event => {
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

    // ✅ Register the mousedown listener for cleanup
    YouTubeUtils.cleanupManager.registerListener(header, 'mousedown', mouseDownHandler);
  };

  // Storage
  const saveTimecodesToStorage = timecodes => {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) return;

    try {
      const minimal = timecodes.map(tc => ({
        t: tc.time,
        l: tc.label?.trim() || '',
        c: tc.isChapter || false,
        u: tc.isUserAdded || false,
      }));
      localStorage.setItem(`yt_tc_${videoId}`, JSON.stringify(minimal));
    } catch {}
  };

  const loadTimecodesFromStorage = () => {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) return null;

    try {
      const data = localStorage.getItem(`yt_tc_${videoId}`);
      return data
        ? JSON.parse(data)
            .map(tc => ({
              time: tc.t,
              label: tc.l,
              isChapter: tc.c,
              isUserAdded: tc.u || false,
            }))
            .sort((a, b) => a.time - b.time)
        : null;
    } catch {
      return null;
    }
  };

  const getCurrentTimecodes = () => {
    const items = state.dom.list?.querySelectorAll('.timecode-item');
    if (!items) return [];

    return Array.from(items)
      .map(item => {
        const time = parseFloat(item.dataset.time);
        const labelEl = item.querySelector('.timecode-label');
        // Only use label if element exists and has actual text content
        const label = labelEl?.textContent?.trim() || '';

        return {
          time,
          label: label, // Keep original label (can be empty)
          isChapter: item.classList.contains('has-chapter'),
          isUserAdded: !item.classList.contains('has-chapter') || false,
        };
      })
      .sort((a, b) => a.time - b.time);
  };

  // Toggle panel
  const toggleTimecodePanel = show => {
    // Close any existing panels first (cleanup)
    document.querySelectorAll('#timecode-panel').forEach(panel => {
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
        detectTimecodes().catch(err => console.error('[Timecode] Detection failed:', err));
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

      // ✅ Обновляем панель только если она уже открыта
      if (config.enabled && state.dom.panel && !state.dom.panel.classList.contains('hidden')) {
        const saved = loadTimecodesFromStorage();
        if (saved?.length) {
          updateTimecodePanel(saved);
        } else if (config.autoDetect) {
          setTimeout(
            () =>
              detectTimecodes().catch(err => console.error('[Timecode] Detection failed:', err)),
            500
          );
        }
        if (config.autoTrackPlayback) startTracking();
      }
    };

    document.addEventListener('yt-navigate-finish', handleNavigationChange);

    // Also watch for URL changes using MutationObserver as a fallback
    const observer = new MutationObserver(() => {
      const newVideoId = new URLSearchParams(window.location.search).get('v');
      if (newVideoId !== currentVideoId) {
        handleNavigationChange();
      }
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(observer);

    // ✅ Safe observe with document.body check
    if (document.body) {
      observer.observe(document.body, { subtree: true, childList: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { subtree: true, childList: true });
      });
    }
  };

  // Keyboard shortcuts
  const setupKeyboard = () => {
    document.addEventListener('keydown', e => {
      // ✅ Проверяем, включена ли функция в настройках
      if (!config.enabled) return;

      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (target.matches && target.matches('input, textarea, [contenteditable]')) return;

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
    });
  };

  // Cleanup on unload
  const cleanup = () => {
    stopTracking();
    if (state.dom.panel) {
      state.dom.panel.remove();
      state.dom.panel = null;
    }
  };

  // Initialize
  const init = () => {
    if (initStarted) return;

    const appRoot =
      (typeof YouTubeUtils?.querySelector === 'function' &&
        YouTubeUtils.querySelector('ytd-app')) ||
      document.querySelector('ytd-app');

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
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
            setTimeout(addTimecodePanelSettings, 100);
            return;
          }
        }
      }

      if (
        document.querySelector(
          '.ytp-plus-settings-section[data-section="advanced"]:not(.hidden)'
        ) &&
        !document.querySelector('.timecode-settings-item')
      ) {
        setTimeout(addTimecodePanelSettings, 50);
      }
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(observer);

    // ✅ Safe observe with document.body check
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        });
      });
    }

    // ✅ Register global click listener in cleanupManager
    const clickHandler = e => {
      if (
        /** @type {HTMLElement} */ (e.target).classList?.contains('ytp-plus-settings-nav-item') &&
        /** @type {HTMLElement} */ (e.target).dataset.section === 'advanced'
      ) {
        setTimeout(addTimecodePanelSettings, 50);
      }
    };
    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);

    // ✅ Больше не создаём панель автоматически - только по шорткату
    if (config.enabled && !state.resizeListenerKey) {
      const onResize = YouTubeUtils.throttle(() => {
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

  // Start on document ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Cleanup on beforeunload
  window.addEventListener('beforeunload', cleanup);
})();
