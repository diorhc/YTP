// YouTube Timecode Panel
(function () {
  'use strict';

  // Early exit for embeds to prevent duplicate panels - ✅ Use cached querySelector
  if (window.location.hostname !== 'www.youtube.com' || window.frameElement) {
    return;
  }

  // Prevent multiple initializations
  if (window._timecodeModuleInitialized) return;
  window._timecodeModuleInitialized = true;

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
   * Validate and apply boolean settings
   * @param {Object} parsed - Parsed settings object
   * @returns {void}
   */
  const applyBooleanSettings = parsed => {
    const booleanFields = ['enabled', 'autoDetect', 'autoSave', 'autoTrackPlayback', 'export'];
    booleanFields.forEach(field => {
      const value = field === 'export' ? parsed.export : parsed[field];
      if (typeof value === 'boolean') {
        config[field] = value;
      }
    });
  };

  /**
   * Validate and apply shortcut settings
   * @param {Object} shortcut - Shortcut settings object
   * @returns {void}
   */
  const applyShortcutSettings = shortcut => {
    if (!shortcut || typeof shortcut !== 'object') return;

    const shortcutFields = {
      key: 'string',
      shiftKey: 'boolean',
      altKey: 'boolean',
      ctrlKey: 'boolean',
    };

    Object.entries(shortcutFields).forEach(([field, expectedType]) => {
      if (typeof shortcut[field] === expectedType) {
        config.shortcut[field] = shortcut[field];
      }
    });
  };

  /**
   * Validate panel position coordinates
   * @param {number} left - Left coordinate
   * @param {number} top - Top coordinate
   * @returns {boolean} Whether coordinates are valid
   */
  const isValidPanelPosition = (left, top) => {
    return (
      typeof left === 'number' &&
      typeof top === 'number' &&
      !isNaN(left) &&
      !isNaN(top) &&
      left >= 0 &&
      top >= 0
    );
  };

  /**
   * Validate and apply panel position settings
   * @param {Object} panelPosition - Panel position object
   * @returns {void}
   */
  const applyPanelPosition = panelPosition => {
    if (!panelPosition || typeof panelPosition !== 'object') return;

    const { left, top } = panelPosition;
    if (isValidPanelPosition(left, top)) {
      config.panelPosition = { left, top };
    }
  };

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
        console.warn('[YouTube+][Timecode]', 'Invalid settings format');
        return;
      }

      // Apply settings using helper functions
      applyBooleanSettings(parsed);
      applyShortcutSettings(parsed.shortcut);
      applyPanelPosition(parsed.panelPosition);
    } catch (error) {
      console.error('[YouTube+][Timecode]', 'Error loading settings:', error);
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
      console.error('[YouTube+][Timecode]', 'Error saving settings:', error);
    }
  };

  /**
   * Clamp panel position within viewport bounds
   * @param {HTMLElement} panel - Panel element
   * @param {number} left - Desired left position
   * @param {number} top - Desired top position
   * @returns {{left: number, top: number}} Clamped position
   */
  /**
   * Validate panel element
   * @param {*} panel - Panel to validate
   * @returns {boolean} True if valid
   */
  const isValidPanel = panel => {
    return panel && panel instanceof HTMLElement;
  };

  /**
   * Validate position coordinates
   * @param {*} left - Left coordinate
   * @param {*} top - Top coordinate
   * @returns {boolean} True if valid
   */
  const areValidCoordinates = (left, top) => {
    return typeof left === 'number' && typeof top === 'number' && !isNaN(left) && !isNaN(top);
  };

  /**
   * Get panel dimensions
   * @param {HTMLElement} panel - Panel element
   * @returns {{width: number, height: number}} Panel dimensions
   */
  const getPanelDimensions = panel => {
    const rect = panel.getBoundingClientRect();
    return {
      width: rect.width || panel.offsetWidth || 0,
      height: rect.height || panel.offsetHeight || 0,
    };
  };

  /**
   * Clamp value between min and max
   * @param {number} value - Value to clamp
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number} Clamped value
   */
  const clamp = (value, min, max) => Math.min(Math.max(min, value), max);

  /**
   * Clamp panel position to viewport bounds
   * @param {HTMLElement} panel - Panel element
   * @param {number} left - Desired left position
   * @param {number} top - Desired top position
   * @returns {{left: number, top: number}} Clamped position
   */
  const clampPanelPosition = (panel, left, top) => {
    try {
      if (!isValidPanel(panel)) {
        console.warn('[YouTube+][Timecode]', 'Invalid panel element');
        return { left: 0, top: 0 };
      }

      if (!areValidCoordinates(left, top)) {
        console.warn('[YouTube+][Timecode]', 'Invalid position coordinates');
        return { left: 0, top: 0 };
      }

      const { width, height } = getPanelDimensions(panel);
      const maxLeft = Math.max(0, window.innerWidth - width);
      const maxTop = Math.max(0, window.innerHeight - height);

      return {
        left: clamp(left, 0, maxLeft),
        top: clamp(top, 0, maxTop),
      };
    } catch (error) {
      console.error('[YouTube+][Timecode]', 'Error clamping panel position:', error);
      return { left: 0, top: 0 };
    }
  };

  /**
   * Save panel position to settings
   * @param {number} left - Left position
   * @param {number} top - Top position
   * @returns {void}
   */
  const savePanelPosition = (left, top) => {
    try {
      if (typeof left !== 'number' || typeof top !== 'number' || isNaN(left) || isNaN(top)) {
        console.warn('[YouTube+][Timecode]', 'Invalid position coordinates for saving');
        return;
      }
      config.panelPosition = { left, top };
      saveSettings();
    } catch (error) {
      console.error('[YouTube+][Timecode]', 'Error saving panel position:', error);
    }
  };

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

  const showNotification = (message, duration = 2000, type = 'info') => {
    YouTubeUtils.NotificationManager.show(message, { duration, type });
  };

  // Time utilities
  const formatTime = seconds => {
    if (isNaN(seconds)) return '00:00';
    const roundedSeconds = Math.round(seconds);
    const h = Math.floor(roundedSeconds / 3600);
    const m = Math.floor((roundedSeconds % 3600) / 60);
    const s = roundedSeconds % 60;
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  /**
   * Parse time string to seconds with validation
   * @param {string} timeStr - Time string (MM:SS or HH:MM:SS)
   * @returns {number|null} Seconds or null if invalid
   */
  /* eslint-disable complexity */
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
      console.error('[YouTube+][Timecode]', 'Error parsing time:', error);
      return null;
    }
  };
  /* eslint-enable complexity */

  /**
   * Extract timecodes from text with validation
   * @param {string} text - Text containing timecodes
   * @returns {Array<{time: number, label: string, originalText: string}>} Extracted timecodes
   */
  /* eslint-disable max-depth */
  const extractTimecodes = text => {
    try {
      if (!text || typeof text !== 'string') return [];

      // Security: limit text length to prevent DoS
      let processedText = text;
      if (processedText.length > 50000) {
        console.warn('[YouTube+][Timecode]', 'Text too long, truncating');
        processedText = processedText.substring(0, 50000);
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

        while ((match = pattern.exec(processedText)) !== null && iterations++ < maxIterations) {
          const time = parseTime(match[1]);
          if (time !== null && !seen.has(time)) {
            seen.add(time);
            // Sanitize label text
            let label = (match[2] || formatTime(time))
              .trim()
              .replace(/^\d+[\.\)]\s*/, '')
              .substring(0, 100); // Limit label length

            // Remove potentially dangerous characters
            label = label.replace(/[<>\"']/g, '');

            if (label) {
              timecodes.push({ time, label, originalText: match[1] });
            }
          }
        }

        if (iterations >= maxIterations) {
          console.warn('[YouTube+][Timecode]', 'Maximum iterations reached during extraction');
        }
      }

      return timecodes.sort((a, b) => a.time - b.time);
    } catch (error) {
      console.error('[YouTube+][Timecode]', 'Error extracting timecodes:', error);
      return [];
    }
  };
  /* eslint-enable max-depth */

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

  const sleep = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));

  const collectDescriptionText = () => {
    const snippets = [];
    DESCRIPTION_SELECTORS.forEach(selector => {
      document.querySelectorAll(selector).forEach(node => {
        const text = node?.textContent?.trim();
        if (text) {
          snippets.push(text);
        }
      });
    });
    return snippets.join('\n');
  };

  /**
   * Check if button is already expanded
   * @param {HTMLElement} button - Button to check
   * @returns {boolean} True if already expanded
   */
  const isButtonExpanded = button => {
    const ariaExpanded = button.getAttribute('aria-expanded');
    if (ariaExpanded === 'true') return true;

    const ariaLabel = button.getAttribute('aria-label')?.toLowerCase();
    return ariaLabel && ariaLabel.includes('less');
  };

  /**
   * Try to click expand button
   * @param {HTMLElement} button - Button to click
   * @returns {Promise<boolean>} True if clicked successfully
   */
  const tryClickExpandButton = async button => {
    if (button.offsetParent === null) return false;

    try {
      /** @type {HTMLElement} */ (button).click();
      await sleep(400);
      return true;
    } catch (error) {
      console.warn('[YouTube+][Timecode]', 'Failed to click expand button:', error);
      return false;
    }
  };

  /**
   * Try to expand inline expander
   * @returns {Promise<boolean>} True if expanded
   */
  const tryExpandInlineExpander = async () => {
    const inlineExpander = document.querySelector('ytd-text-inline-expander[collapsed]');
    if (!inlineExpander) return false;

    try {
      inlineExpander.removeAttribute('collapsed');
      await sleep(300);
      return true;
    } catch (error) {
      YouTubeUtils.logError('TimecodePanel', 'Failed to expand description', error);
      return false;
    }
  };

  const expandDescriptionIfNeeded = async () => {
    for (const selector of DESCRIPTION_EXPANDERS) {
      const button = document.querySelector(selector);
      if (!button) continue;
      if (isButtonExpanded(button)) return false;

      const clicked = await tryClickExpandButton(button);
      if (clicked) return true;
    }

    return await tryExpandInlineExpander();
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
        if (tc.time >= 0 && tc.label?.trim()) {
          uniqueMap.set(tc.time.toString(), tc);
        }
      });
    }

    // Get native chapters
    const chapters = getYouTubeChapters();

    chapters.forEach(chapter => {
      if (chapter.time >= 0 && chapter.label?.trim()) {
        uniqueMap.set(chapter.time.toString(), chapter);
      }
    });

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

  const reloadTimecodes = async (buttonOverride = null) => {
    const button =
      buttonOverride || state.dom.reloadButton || document.getElementById('timecode-reload');

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
   * Extract text content from element using selectors
   * @param {HTMLElement} item - Parent element
   * @param {string[]} selectors - Array of selectors to try
   * @returns {string|null} Text content or null
   */
  const extractTextFromSelectors = (item, selectors) => {
    for (const sel of selectors) {
      const el = item.querySelector(sel);
      if (el?.textContent) {
        return el.textContent;
      }
    }
    return null;
  };

  /**
   * Parse and create chapter object
   * @param {string|null} timeText - Time text
   * @param {string|null} titleText - Title text
   * @returns {Object|null} Chapter object or null
   */
  const createChapterObject = (timeText, titleText) => {
    if (!timeText) return null;

    const time = parseTime(timeText.trim());
    if (time === null) return null;

    const cleanTitle = titleText?.trim().replace(/\s+/g, ' ') || formatTime(time);
    return {
      time,
      label: cleanTitle,
      isChapter: true,
    };
  };

  const getYouTubeChapters = () => {
    // Расширенный поиск глав/эпизодов
    const selectors = [
      'ytd-macro-markers-list-item-renderer',
      'ytd-chapter-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id*="description-chapters"] ytd-macro-markers-list-item-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id*="description-chapters"] #details',
      '#structured-description ytd-horizontal-card-list-renderer ytd-macro-markers-list-item-renderer',
    ];

    const items = document.querySelectorAll(selectors.join(', '));
    const chapters = new Map();

    const timeSelectors = ['.time-info', '.timestamp', '#time', 'span[id*="time"]'];
    const titleSelectors = ['.marker-title', '.chapter-title', '#details', 'h4', '.title'];

    items.forEach(item => {
      const timeText = extractTextFromSelectors(item, timeSelectors);
      const titleText = extractTextFromSelectors(item, titleSelectors);

      const chapter = createChapterObject(timeText, titleText);
      if (chapter) {
        chapters.set(chapter.time.toString(), chapter);
      }
    });

    return Array.from(chapters.values()).sort((a, b) => a.time - b.time);
  };

  // Settings panel
  /**
   * Build modifier combination string from active keys
   * @param {boolean} ctrlKey - Ctrl key active
   * @param {boolean} altKey - Alt key active
   * @param {boolean} shiftKey - Shift key active
   * @returns {string[]} Array of active modifier keys
   */
  const buildModifierParts = (ctrlKey, altKey, shiftKey) => {
    const parts = [];
    if (ctrlKey) parts.push('ctrl');
    if (altKey) parts.push('alt');
    if (shiftKey) parts.push('shift');
    return parts;
  };

  /**
   * Calculate modifier key combination value from config
   * @returns {string} Modifier combination string
   */
  const getModifierValue = () => {
    const { ctrlKey, altKey, shiftKey } = config.shortcut;
    const parts = buildModifierParts(ctrlKey, altKey, shiftKey);
    return parts.length > 0 ? parts.join('+') : 'none';
  };

  /**
   * Create enable/disable checkbox element
   * @returns {HTMLDivElement} Enable checkbox container
   */
  const createEnableCheckbox = () => {
    const enableDiv = document.createElement('div');
    enableDiv.className = 'ytp-plus-settings-item timecode-settings-item';
    enableDiv.innerHTML = `
      <div>
        <label class="ytp-plus-settings-item-label">${t('enableTimecode')}</label>
        <div class="ytp-plus-settings-item-description">${t('enableDescription')}</div>
      </div>
      <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enabled" ${config.enabled ? 'checked' : ''}>
    `;
    return enableDiv;
  };

  /**
   * Create shortcut configuration element
   * @returns {HTMLDivElement} Shortcut configuration container
   */
  const createShortcutConfig = () => {
    const shortcutDiv = document.createElement('div');
    shortcutDiv.className = 'ytp-plus-settings-item timecode-settings-item timecode-shortcut-item';
    shortcutDiv.style.display = config.enabled ? 'flex' : 'none';
    shortcutDiv.innerHTML = `
      <div>
        <label class="ytp-plus-settings-item-label">${t('keyboardShortcut')}</label>
        <div class="ytp-plus-settings-item-description">${t('shortcutDescription')}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <div id="timecode-modifier-combo"></div>
        <span>+</span>
        <input type="text" id="timecode-key" value="${config.shortcut.key}" maxlength="1" style="width: 30px; text-align: center; background: rgba(34, 34, 34, var(--yt-header-bg-opacity)); color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 4px;">
      </div>
    `;
    return shortcutDiv;
  };

  /**
   * Setup event listeners for enable checkbox
   * @param {HTMLElement} advancedSection - Parent section
   * @param {HTMLDivElement} shortcutDiv - Shortcut configuration div
   */
  const setupEnableListener = (advancedSection, shortcutDiv) => {
    advancedSection.addEventListener('change', e => {
      const el = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (el.matches && el.matches('.ytp-plus-settings-checkbox[data-setting="enabled"]')) {
        config.enabled = /** @type {HTMLInputElement} */ (el).checked;
        shortcutDiv.style.display = config.enabled ? 'flex' : 'none';
        toggleTimecodePanel(config.enabled);
        saveSettings();
      }
    });
  };

  /**
   * Create label for modifier key
   * @param {string} value - Modifier value
   * @returns {string} Formatted label
   */
  const createModifierLabel = value => {
    if (value === 'none') return t('none');
    return value
      .split('+')
      .map(k => k.charAt(0).toUpperCase() + k.slice(1))
      .join('+');
  };

  /**
   * Setup custom modifier select
   * @param {string} modifierValue - Current modifier value
   */
  const setupModifierSelect = modifierValue => {
    const native = document.getElementById('timecode-modifier-combo');
    if (!native) return;

    const opts = [
      'none',
      'ctrl',
      'alt',
      'shift',
      'ctrl+alt',
      'ctrl+shift',
      'alt+shift',
      'ctrl+alt+shift',
    ];

    const factory = window.YouTubePlusHelpers?.DOM?.createCustomSelect;
    if (typeof factory !== 'function') return;

    const custom = factory();
    custom.setOptions(opts.map(v => ({ value: v, text: createModifierLabel(v) })));
    custom.value = modifierValue;

    try {
      native.parentNode.replaceChild(custom, native);
    } catch {
      return; // Fallback: leave native select
    }

    custom.addEventListener('change', () => {
      const value = custom.value || '';
      config.shortcut.ctrlKey = value.includes('ctrl');
      config.shortcut.altKey = value.includes('alt');
      config.shortcut.shiftKey = value.includes('shift');
      saveSettings();
    });
  };

  /**
   * Setup key input listener
   */
  const setupKeyInputListener = () => {
    document.getElementById('timecode-key')?.addEventListener('input', e => {
      const input = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      if (input.value) {
        config.shortcut.key = input.value.toUpperCase();
        saveSettings();
      }
    });
  };

  const addTimecodePanelSettings = () => {
    const advancedSection = YouTubeUtils.querySelector(
      '.ytp-plus-settings-section[data-section="advanced"]'
    );
    if (!advancedSection || YouTubeUtils.querySelector('.timecode-settings-item')) return;

    const modifierValue = getModifierValue();
    const enableDiv = createEnableCheckbox();
    const shortcutDiv = createShortcutConfig();

    advancedSection.append(enableDiv, shortcutDiv);

    setupEnableListener(advancedSection, shortcutDiv);
    setupModifierSelect(modifierValue);
    setupKeyInputListener();
  };

  // CSS
  const insertTimecodeStyles = () => {
    if (document.getElementById('timecode-panel-styles')) return;

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
                .timecode-time{font-family:monospace;margin-right:10px;color:rgba(255,255,255,.8);font-size:13px;min-width:45px}
                .timecode-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;flex:1}
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
    document.querySelectorAll('#timecode-panel').forEach(p => p.remove());

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
  /* eslint-disable complexity */
  const handlePanelClick = e => {
    const { target } = e;
    const item = target.closest('.timecode-item');

    // Use closest so clicks on child SVG/path elements are detected
    let reloadButton = null;
    if (target.closest) {
      reloadButton = target.closest('#timecode-reload');
    } else if (target.id === 'timecode-reload') {
      reloadButton = target;
    }

    if (reloadButton) {
      e.preventDefault();
      reloadTimecodes(reloadButton);
      return;
    }

    let closeButton = null;
    if (target.closest) {
      closeButton = target.closest('#timecode-close');
    } else if (target.id === 'timecode-close') {
      closeButton = target;
    }
    if (closeButton) {
      toggleTimecodePanel(false);
    } else if (target.id === 'timecode-add-btn') {
      // ✅ Use cached querySelector
      const video = YouTubeUtils.querySelector('video');
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
      const { action } = target.dataset;
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
  /* eslint-enable complexity */

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
      label: labelValue || formatTime(time),
      isUserAdded: true,
      isChapter: false,
    };

    if (state.editingIndex === null) {
      // Adding new timecode
      timecodes.push(newTimecode);
      showNotification(t('timecodeAdded'));
    } else {
      // Editing existing timecode
      const oldTimecode = timecodes[state.editingIndex];
      if (oldTimecode.isChapter && !oldTimecode.isUserAdded) {
        showNotification(t('cannotEditChapter'));
        hideTimecodeForm();
        return;
      }

      timecodes[state.editingIndex] = { ...oldTimecode, ...newTimecode };
      showNotification(t('timecodeUpdated'));
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
      content += `${formatTime(tc.time)} - ${tc.label}\n`;
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
        const label = (tc.label?.trim() || timeStr).replace(
          /[<>&"']/g,
          c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]
        );
        const isEditable = !tc.isChapter || tc.isUserAdded;

        return `
          <div class="timecode-item ${tc.isChapter ? 'has-chapter' : ''}" data-time="${tc.time}" data-index="${i}">
            <div class="timecode-time">${timeStr}</div>
            <div class="timecode-label" title="${label}">${label}</div>
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

  /**
   * Find active and next timecode indices based on current video time
   * @param {NodeListOf<Element>} items - Timecode items
   * @param {number} currentVideoTime - Current video time
   * @returns {{activeIndex: number, nextIndex: number}} Active and next indices
   */
  const findActiveTimecodeIndices = (items, currentVideoTime) => {
    let activeIndex = -1;
    let nextIndex = -1;

    for (let i = 0; i < items.length; i++) {
      const timeData = items[i].dataset.time;
      if (!timeData) continue;

      const time = parseFloat(timeData);
      if (isNaN(time)) continue;

      if (currentVideoTime >= time) {
        activeIndex = i;
      } else if (nextIndex === -1) {
        nextIndex = i;
      }
    }

    return { activeIndex, nextIndex };
  };

  /**
   * Update active state for timecode items
   * @param {NodeListOf<Element>} items - Timecode items
   * @param {number} activeIndex - New active index
   */
  const updateActiveTimecodeState = (items, activeIndex) => {
    if (state.activeIndex === activeIndex) return;

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
  };

  /**
   * Update progress bar for active timecode item
   * @param {NodeListOf<Element>} items - Timecode items
   * @param {number} activeIndex - Active item index
   * @param {number} nextIndex - Next item index
   * @param {number} currentVideoTime - Current video time
   */
  const updateTimecodeProgressBar = (items, activeIndex, nextIndex, currentVideoTime) => {
    if (activeIndex < 0 || nextIndex < 0 || !items[activeIndex]) return;

    const currentTimeData = items[activeIndex].dataset.time;
    const nextTimeData = items[nextIndex].dataset.time;

    if (!currentTimeData || !nextTimeData) return;

    const current = parseFloat(currentTimeData);
    const next = parseFloat(nextTimeData);

    if (isNaN(current) || isNaN(next) || next <= current) return;

    const progress = ((currentVideoTime - current) / (next - current)) * 100;
    const progressEl = items[activeIndex].querySelector('.timecode-progress');
    if (progressEl) {
      const clampedProgress = Math.min(100, Math.max(0, progress));
      progressEl.style.width = `${clampedProgress}%`;
    }
  };

  /**
   * Should stop tracking based on current state
   * @param {HTMLVideoElement | null} video - Video element
   * @param {HTMLElement | null} panel - Panel element
   * @returns {boolean} True if should stop tracking
   */
  const shouldStopTracking = (video, panel) => {
    return !video || !panel || panel.classList.contains('hidden') || !config.autoTrackPlayback;
  };

  // Tracking
  /**
   * Cancel and clear tracking animation frame
   */
  const cancelTracking = () => {
    if (state.trackingId) {
      cancelAnimationFrame(state.trackingId);
      state.trackingId = 0;
    }
  };

  /**
   * Update current time display
   * @param {HTMLElement} currentTimeEl - Current time element
   * @param {number} currentTime - Current video time
   */
  const updateCurrentTimeDisplay = (currentTimeEl, currentTime) => {
    if (currentTimeEl && !isNaN(currentTime)) {
      currentTimeEl.textContent = formatTime(currentTime);
    }
  };

  /**
   * Update timecode items based on video time
   * @param {NodeList} items - Timecode items
   * @param {number} currentTime - Current video time
   */
  const updateTimecodeItems = (items, currentTime) => {
    if (!items?.length) return;
    const { activeIndex, nextIndex } = findActiveTimecodeIndices(items, currentTime);
    updateActiveTimecodeState(items, activeIndex);
    updateTimecodeProgressBar(items, activeIndex, nextIndex, currentTime);
  };

  /**
   * Start tracking playback and updating UI
   */
  const startTracking = () => {
    if (state.trackingId) return;

    const track = () => {
      try {
        const video = document.querySelector('video');
        const { panel, currentTime, list } = state.dom;

        // Stop tracking if essential elements are missing or panel is hidden
        if (shouldStopTracking(video, panel)) {
          cancelTracking();
          return;
        }

        updateCurrentTimeDisplay(currentTime, video.currentTime);
        updateTimecodeItems(list?.querySelectorAll('.timecode-item'), video.currentTime);

        // Continue tracking if enabled
        if (config.autoTrackPlayback) {
          state.trackingId = requestAnimationFrame(track);
        }
      } catch (error) {
        console.warn('[YouTube+][Timecode]', 'Tracking error:', error);
        cancelTracking();
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
        l: tc.label?.trim() || formatTime(tc.time),
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
      .map(item => ({
        time: parseFloat(item.dataset.time),
        label:
          item.querySelector('.timecode-label')?.textContent ||
          formatTime(parseFloat(item.dataset.time)),
        isChapter: item.classList.contains('has-chapter'),
        isUserAdded: !item.classList.contains('has-chapter') || false,
      }))
      .sort((a, b) => a.time - b.time);
  };

  // Toggle panel
  const toggleTimecodePanel = show => {
    // Close any existing panels first (cleanup)
    document.querySelectorAll('#timecode-panel').forEach(panel => {
      if (panel !== state.dom.panel) panel.remove();
    });

    const panel = state.dom.panel || createTimecodePanel();
    const shouldShow = show === undefined ? panel.classList.contains('hidden') : show;

    panel.classList.toggle('hidden', !shouldShow);

    if (shouldShow) {
      applySavedPanelPosition(panel);

      const saved = loadTimecodesFromStorage();
      if (saved?.length) {
        updateTimecodePanel(saved);
      } else if (config.autoDetect) {
        detectTimecodes().catch(err =>
          console.error('[YouTube+][Timecode]', 'Detection failed:', err)
        );
      }

      if (config.autoTrackPlayback) startTracking();
    } else if (state.trackingId) {
      cancelAnimationFrame(state.trackingId);
      state.trackingId = 0;
    }
  };

  /**
   * Reset timecode state for new video
   */
  const resetTimecodeState = () => {
    state.activeIndex = null;
    state.editingIndex = null;
    state.timecodes.clear();
  };

  /**
   * Update panel content when navigation occurs
   */
  const updatePanelOnNavigation = () => {
    const saved = loadTimecodesFromStorage();
    if (saved?.length) {
      updateTimecodePanel(saved);
    } else if (config.autoDetect) {
      setTimeout(
        () =>
          detectTimecodes().catch(err =>
            console.error('[YouTube+][Timecode]', 'Detection failed:', err)
          ),
        500
      );
    }
    if (config.autoTrackPlayback) startTracking();
  };

  /**
   * Check if panel should be updated
   * @returns {boolean} True if panel should be updated
   */
  const shouldUpdatePanel = () => {
    return config.enabled && state.dom.panel && !state.dom.panel.classList.contains('hidden');
  };

  /**
   * Setup navigation observer for video changes
   * @param {string} currentVideoId - Current video ID
   * @param {Function} handleNavigationChange - Navigation change handler
   */
  const setupNavigationObserver = (currentVideoId, handleNavigationChange) => {
    const observer = new MutationObserver(() => {
      const newVideoId = getCurrentVideoId();
      if (newVideoId !== currentVideoId) {
        handleNavigationChange();
      }
    });

    YouTubeUtils.cleanupManager.registerObserver(observer);

    if (document.body) {
      observer.observe(document.body, { subtree: true, childList: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { subtree: true, childList: true });
      });
    }
  };

  // Navigation handling
  const setupNavigation = () => {
    let currentVideoId = getCurrentVideoId();

    const handleNavigationChange = () => {
      const newVideoId = getCurrentVideoId();
      if (newVideoId === currentVideoId || window.location.pathname !== '/watch') return;

      currentVideoId = newVideoId;
      resetTimecodeState();

      if (shouldUpdatePanel()) {
        updatePanelOnNavigation();
      }
    };

    document.addEventListener('yt-navigate-finish', handleNavigationChange);
    setupNavigationObserver(currentVideoId, handleNavigationChange);
  };

  // Keyboard shortcuts
  const setupKeyboard = () => {
    document.addEventListener('keydown', e => {
      // ✅ Проверяем, включена ли функция в настройках
      if (!config.enabled) return;

      const { target } = e;
      const el = /** @type {EventTarget & HTMLElement} */ (target);
      if (el.matches && el.matches('input, textarea, [contenteditable]')) return;

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
  /**
   * Setup settings modal observer
   * @returns {MutationObserver} Configured observer
   * @private
   */
  const setupSettingsObserver = () => {
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

    YouTubeUtils.cleanupManager.registerObserver(observer);
    return observer;
  };

  /**
   * Start observing document body
   * @param {MutationObserver} observer - Observer to start
   * @private
   */
  const startObserving = observer => {
    const observerConfig = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    };

    if (document.body) {
      observer.observe(document.body, observerConfig);
    } else {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          observer.observe(document.body, observerConfig);
        },
        { once: true }
      );
    }
  };

  /**
   * Setup settings click handler
   * @private
   */
  const setupSettingsClickHandler = () => {
    const clickHandler = e => {
      const { target } = e;
      const el = /** @type {HTMLElement} */ (target);
      if (
        el.classList?.contains('ytp-plus-settings-nav-item') &&
        el.dataset.section === 'advanced'
      ) {
        setTimeout(addTimecodePanelSettings, 50);
      }
    };
    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);
  };

  /**
   * Setup resize handler for panel repositioning
   * @private
   */
  const setupResizeHandler = () => {
    if (!config.enabled || state.resizeListenerKey) return;

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
  };

  /**
   * Initialize timecode module
   * @private
   */
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

    // Load configuration and setup UI
    loadSettings();
    insertTimecodeStyles();
    setupKeyboard();
    setupNavigation();

    // Setup observers and handlers
    const observer = setupSettingsObserver();
    startObserving(observer);
    setupSettingsClickHandler();
    setupResizeHandler();
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
