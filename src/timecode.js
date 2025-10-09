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
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(config.storageKey);
      if (saved) Object.assign(config, JSON.parse(saved));
    } catch {}
  };

  const saveSettings = () => {
    try {
      localStorage.setItem(config.storageKey, JSON.stringify(config));
    } catch {}
  };

  const clampPanelPosition = (panel, left, top) => {
    if (!panel) return { left: 0, top: 0 };

    const rect = panel.getBoundingClientRect();
    const width = rect.width || panel.offsetWidth || 0;
    const height = rect.height || panel.offsetHeight || 0;

    const maxLeft = Math.max(0, window.innerWidth - width);
    const maxTop = Math.max(0, window.innerHeight - height);

    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  };

  const savePanelPosition = (left, top) => {
    config.panelPosition = { left, top };
    saveSettings();
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
    seconds = Math.round(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const parseTime = timeStr => {
    if (!timeStr) return null;
    const str = timeStr.trim();

    // Handle HH:MM:SS format
    let match = str.match(/^(\d+):(\d{1,2}):(\d{2})$/);
    if (match) {
      const [, h, m, s] = match.map(Number);
      return m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
    }

    // Handle MM:SS format
    match = str.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const [, m, s] = match.map(Number);
      return m < 60 && s < 60 ? m * 60 + s : null;
    }

    return null;
  };

  // Timecode extraction
  const extractTimecodes = text => {
    if (!text) return [];

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
      while ((match = pattern.exec(text)) !== null) {
        const time = parseTime(match[1]);
        if (time !== null && !seen.has(time)) {
          seen.add(time);
          const label = (match[2] || formatTime(time))
            .trim()
            .replace(/^\d+[\.\)]\s*/, '')
            .substring(0, 100);
          if (label) {
            timecodes.push({ time, label, originalText: match[1] });
          }
        }
      }
    }

    return timecodes.sort((a, b) => a.time - b.time);
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

  const expandDescriptionIfNeeded = async () => {
    for (const selector of DESCRIPTION_EXPANDERS) {
      const button = document.querySelector(selector);
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

    const inlineExpander = document.querySelector('ytd-text-inline-expander[collapsed]');
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
        showNotification(`Найдено таймкодов: ${result.length}`);
      } else {
        updateTimecodePanel([]);
        showNotification('Таймкоды не найдены');
      }
    } catch (error) {
      YouTubeUtils.logError('TimecodePanel', 'Reload failed', error);
      showNotification('Ошибка при обновлении таймкодов');
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('loading');
      }
      state.isReloading = false;
    }
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
          const cleanTitle = titleText?.trim().replace(/\s+/g, ' ') || formatTime(time);
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
    const advancedSection = YouTubeUtils.querySelector(
      '.ytp-plus-settings-section[data-section="advanced"]'
    );
    if (!advancedSection || YouTubeUtils.querySelector('.timecode-settings-item')) return;

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
          <label class="ytp-plus-settings-item-label">Timecode Panel</label>
          <div class="ytp-plus-settings-item-description">Enable video timecode/chapter panel with quick navigation</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enabled" ${config.enabled ? 'checked' : ''}>
      `;

    const shortcutDiv = document.createElement('div');
    shortcutDiv.className = 'ytp-plus-settings-item timecode-settings-item timecode-shortcut-item';
    shortcutDiv.style.display = config.enabled ? 'flex' : 'none';
    shortcutDiv.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Keyboard Shortcut</label>
          <div class="ytp-plus-settings-item-description">Customize keyboard combination to toggle Timecode Panel</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <select id="timecode-modifier-combo" style="background: rgba(34, 34, 34, 0.6); color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 4px;">
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
          <span>+</span>
          <input type="text" id="timecode-key" value="${config.shortcut.key}" maxlength="1" style="width: 30px; text-align: center; background: rgba(34, 34, 34, 0.6); color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 4px;">
        </div>
      `;

    advancedSection.append(enableDiv, shortcutDiv);

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

    document.getElementById('timecode-modifier-combo')?.addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLSelectElement} */ (e.target);
      const value = target.value;
      config.shortcut.ctrlKey = value.includes('ctrl');
      config.shortcut.altKey = value.includes('alt');
      config.shortcut.shiftKey = value.includes('shift');
      saveSettings();
    });

    document.getElementById('timecode-key')?.addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      if (target.value) {
        config.shortcut.key = target.value.toUpperCase();
        saveSettings();
      }
    });
  };

  // CSS
  const insertTimecodeStyles = () => {
    if (document.getElementById('timecode-panel-styles')) return;

    // ✅ Use StyleManager instead of createElement('style')
    const styles = `
                #timecode-panel{position:fixed;right:20px;top:80px;background:rgba(34,34,34,.9);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.4);width:250px;max-height:70vh;z-index:9999;color:#fff;backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);transition:transform .3s,opacity .3s;overflow:hidden;display:flex;flex-direction:column}
                #timecode-panel.hidden{transform:translateX(270px);opacity:0;pointer-events:none}
                #timecode-panel.auto-tracking{border-color:rgba(255,0,0,.5)}
                #timecode-header{display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.3);cursor:move}
                #timecode-title{font-weight:500;margin:0;font-size:14px;user-select:none;display:flex;align-items:center;gap:8px}
                #timecode-tracking-indicator{width:8px;height:8px;background:red;border-radius:50%;opacity:0;transition:opacity .3s}
                #timecode-panel.auto-tracking #timecode-tracking-indicator{opacity:1}
                #timecode-current-time{font-family:monospace;font-size:12px;padding:2px 6px;background:rgba(255,0,0,.3);border-radius:3px;margin-left:auto}
                #timecode-header-controls{display:flex;align-items:center;gap:6px}
                #timecode-reload,#timecode-close{background:0 0;border:none;color:rgba(255,255,255,.7);cursor:pointer;width:24px;height:24px;padding:0;display:flex;align-items:center;justify-content:center;transition:color .2s}
                #timecode-reload:hover,#timecode-close:hover{color:#fff}
                #timecode-reload.loading{animation:timecode-spin .8s linear infinite}
                #timecode-list{overflow-y:auto;padding:8px 0;max-height:calc(70vh - 80px);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent}
                #timecode-list::-webkit-scrollbar{width:6px}
                #timecode-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3);border-radius:3px}
                .timecode-item{padding:8px 12px;display:flex;align-items:center;cursor:pointer;transition:background-color .2s;border-left:3px solid transparent;position:relative}
                .timecode-item:hover{background:rgba(255,255,255,.1)}
                .timecode-item:hover .timecode-actions{opacity:1}
                .timecode-item.active{background:rgba(255,0,0,.25);border-left-color:red}
                .timecode-item.active.pulse{animation:pulse .8s ease-out}
                .timecode-item.editing{background:rgba(255,255,0,.15);border-left-color:#ffaa00}
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
                #timecode-form{padding:10px;border-top:1px solid rgba(255,255,255,.1);display:none}
                #timecode-form.visible{display:block}
                #timecode-form input{width:100%;margin-bottom:8px;padding:8px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:4px;color:#fff;font-size:13px}
                #timecode-form input::placeholder{color:rgba(255,255,255,.6)}
                #timecode-form-buttons{display:flex;gap:8px;justify-content:flex-end}
                #timecode-form-buttons button{padding:6px 12px;border:none;border-radius:4px;cursor:pointer;font-size:12px;transition:background-color .2s}
                #timecode-form-cancel{background:rgba(255,255,255,.2);color:#fff}
                #timecode-form-cancel:hover{background:rgba(255,255,255,.3)}
                #timecode-form-save{background:#ff4444;color:#fff}
                #timecode-form-save:hover{background:#ff6666}
                #timecode-actions{padding:8px;border-top:1px solid rgba(255,255,255,.1);display:flex;gap:8px;background:rgba(0,0,0,.2)}
                #timecode-actions button{padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;transition:background-color .2s;background:rgba(255,255,255,.2);color:#fff}
                #timecode-actions button:hover{background:rgba(255,255,255,.3)}
                #timecode-track-toggle.active{background:#ff4444!important}
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
            Timecodes
            <span id="timecode-current-time"></span>
          </h3>
          <div id="timecode-header-controls">
            <button id="timecode-reload" title="Reload timecodes" aria-label="Reload timecodes">⟳</button>
            <button id="timecode-close" title="Close" aria-label="Close timecode panel">×</button>
          </div>
        </div>
        <div id="timecode-list"></div>
        <div id="timecode-empty">
          <div>No timecodes found</div>
          <div style="margin-top:5px;font-size:12px">Click + to add current time</div>
        </div>
        <div id="timecode-form">
          <input type="text" id="timecode-form-time" placeholder="Time (e.g., 1:30)">
          <input type="text" id="timecode-form-label" placeholder="Label (optional)">
          <div id="timecode-form-buttons">
            <button type="button" id="timecode-form-cancel">Cancel</button>
            <button type="button" id="timecode-form-save" class="save">Save</button>
          </div>
        </div>
        <div id="timecode-actions">
          <button id="timecode-add-btn">+ Add</button>
          <button id="timecode-export-btn" ${config.export ? '' : 'style="display:none"'}>Export</button>
          <button id="timecode-track-toggle" class="${config.autoTrackPlayback ? 'active' : ''}">${config.autoTrackPlayback ? 'Tracking' : 'Track'}</button>
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

    const reloadButton =
      target.id === 'timecode-reload' ? target : target.closest('#timecode-reload');
    if (reloadButton) {
      e.preventDefault();
      reloadTimecodes(reloadButton);
      return;
    }

    if (target.id === 'timecode-close') {
      toggleTimecodePanel(false);
    } else if (target.id === 'timecode-add-btn') {
      // ✅ Use cached querySelector
      const video = YouTubeUtils.querySelector('video');
      if (video) showTimecodeForm(video.currentTime);
    } else if (target.id === 'timecode-track-toggle') {
      config.autoTrackPlayback = !config.autoTrackPlayback;
      target.textContent = config.autoTrackPlayback ? 'Tracking' : 'Track';
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
      const index = parseInt(target.closest('.timecode-item').dataset.index);

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
      showNotification('Cannot delete YouTube chapters');
      return;
    }

    // Confirm deletion
    if (!confirm(`Delete timecode "${timecode.label}"?`)) return;

    timecodes.splice(index, 1);
    updateTimecodePanel(timecodes);
    saveTimecodesToStorage(timecodes);
    showNotification('Timecode deleted');
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
      showNotification('Invalid time format');
      return;
    }

    const timecodes = getCurrentTimecodes();
    const newTimecode = {
      time,
      label: labelValue || formatTime(time),
      isUserAdded: true,
      isChapter: false,
    };

    if (state.editingIndex !== null) {
      // Editing existing timecode
      const oldTimecode = timecodes[state.editingIndex];
      if (oldTimecode.isChapter && !oldTimecode.isUserAdded) {
        showNotification('Cannot edit YouTube chapters');
        hideTimecodeForm();
        return;
      }

      timecodes[state.editingIndex] = { ...oldTimecode, ...newTimecode };
      showNotification('Timecode updated');
    } else {
      // Adding new timecode
      timecodes.push(newTimecode);
      showNotification('Timecode added');
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
      showNotification('No timecodes to export');
      return;
    }

    const exportBtn = state.dom.panel?.querySelector('#timecode-export-btn');
    if (exportBtn) {
      exportBtn.textContent = 'Copied!';
      exportBtn.style.backgroundColor = 'rgba(0,220,0,0.8)';
      setTimeout(() => {
        exportBtn.textContent = 'Export';
        exportBtn.style.backgroundColor = '';
      }, 2000);
    }

    const videoTitle = document.title.replace(/\s-\sYouTube$/, '');
    let content = `${videoTitle}\n\nTimecodes:\n`;
    timecodes.forEach(tc => (content += `${formatTime(tc.time)} - ${tc.label}\n`));

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(content).then(() => {
        showNotification('Timecodes copied to clipboard');
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
                <button class="timecode-action edit" data-action="edit" title="Edit">✎</button>
                <button class="timecode-action delete" data-action="delete" title="Delete">✕</button>
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

    if (config.enabled) {
      createTimecodePanel();

      if (!state.resizeListenerKey) {
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

      const saved = loadTimecodesFromStorage();
      if (saved?.length) {
        updateTimecodePanel(saved);
      } else if (config.autoDetect) {
        setTimeout(
          () => detectTimecodes().catch(err => console.error('[Timecode] Detection failed:', err)),
          1500
        );
      }
      if (config.autoTrackPlayback) startTracking();
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
