// YouTube Picture-in-Picture settings
(function () {
  'use strict';

  // Use centralized i18n where available
  const _globalI18n_pip =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;
  const t = (key, params = {}) => {
    try {
      if (_globalI18n_pip && typeof _globalI18n_pip.t === 'function') {
        return _globalI18n_pip.t(key, params);
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

  /**
   * PiP settings configuration
   * @type {Object}
   * @property {boolean} enabled - Whether PiP is enabled
   * @property {Object} shortcut - Keyboard shortcut configuration
   * @property {string} storageKey - LocalStorage key for persistence
   */
  const pipSettings = {
    enabled: true,
    shortcut: { key: 'P', shiftKey: true, altKey: false, ctrlKey: false },
    storageKey: 'youtube_pip_settings',
  };

  const PIP_SESSION_KEY = 'youtube_plus_pip_session';

  /**
   * Get video element with validation
   * @returns {HTMLVideoElement|null} Video element or null if not found
   */
  const getVideoElement = () => {
    try {
      const candidate =
        (typeof YouTubeUtils?.querySelector === 'function' &&
          YouTubeUtils.querySelector('video')) ||
        document.querySelector('video');

      if (candidate && candidate.tagName && candidate.tagName.toLowerCase() === 'video') {
        return /** @type {HTMLVideoElement} */ (candidate);
      }

      return null;
    } catch (error) {
      console.error('[YouTube+][PiP]', 'Error getting video element:', error);
      return null;
    }
  };

  /**
   * Wait for video metadata to load with timeout
   * @param {HTMLVideoElement} video - Video element
   * @returns {Promise<void>} Resolves when metadata is loaded
   */
  const waitForMetadata = video => {
    if (!video) {
      return Promise.reject(new Error('[PiP] Invalid video element'));
    }

    if (video.readyState >= 1 && !video.seeking) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };

      const onLoaded = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('[PiP] Video metadata failed to load'));
      };

      let timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('[PiP] Timed out waiting for video metadata'));
      }, 3000);

      const registeredTimeout = YouTubeUtils?.cleanupManager?.registerTimeout?.(timeoutId);
      if (registeredTimeout) {
        timeoutId = registeredTimeout;
      }

      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  };

  const setSessionActive = isActive => {
    try {
      if (isActive) {
        sessionStorage.setItem(PIP_SESSION_KEY, 'true');
      } else {
        sessionStorage.removeItem(PIP_SESSION_KEY);
      }
    } catch {}
  };

  const wasSessionActive = () => {
    try {
      return sessionStorage.getItem(PIP_SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  };

  /**
   * Load settings from localStorage with validation
   * @returns {void}
   */
  /**
   * Validate and merge shortcut settings
   * @param {Object} parsedShortcut - Parsed shortcut object
   * @returns {void}
   */
  const mergeShortcutSettings = parsedShortcut => {
    if (!parsedShortcut || typeof parsedShortcut !== 'object') return;

    if (typeof parsedShortcut.key === 'string' && parsedShortcut.key.length > 0) {
      pipSettings.shortcut.key = parsedShortcut.key;
    }
    if (typeof parsedShortcut.shiftKey === 'boolean') {
      pipSettings.shortcut.shiftKey = parsedShortcut.shiftKey;
    }
    if (typeof parsedShortcut.altKey === 'boolean') {
      pipSettings.shortcut.altKey = parsedShortcut.altKey;
    }
    if (typeof parsedShortcut.ctrlKey === 'boolean') {
      pipSettings.shortcut.ctrlKey = parsedShortcut.ctrlKey;
    }
  };

  /**
   * Validate parsed settings object
   * @param {*} parsed - Parsed settings
   * @returns {boolean} True if valid
   */
  const isValidSettings = parsed => {
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn('[YouTube+][PiP]', 'Invalid settings format');
      return false;
    }
    return true;
  };

  /**
   * Load settings from localStorage
   * @returns {void}
   */
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(pipSettings.storageKey);
      if (!saved) return;

      const parsed = JSON.parse(saved);
      if (!isValidSettings(parsed)) return;

      // Merge enabled setting
      if (typeof parsed.enabled === 'boolean') {
        pipSettings.enabled = parsed.enabled;
      }

      // Merge shortcut settings
      mergeShortcutSettings(parsed.shortcut);
    } catch (e) {
      console.error('[YouTube+][PiP]', 'Error loading settings:', e);
    }
  };

  /**
   * Save settings to localStorage with error handling
   * @returns {void}
   */
  const saveSettings = () => {
    try {
      const settingsToSave = {
        enabled: pipSettings.enabled,
        shortcut: pipSettings.shortcut,
      };
      localStorage.setItem(pipSettings.storageKey, JSON.stringify(settingsToSave));
    } catch (e) {
      console.error('[YouTube+][PiP]', 'Error saving settings:', e);
    }
  };

  /**
   * Get current PiP element as HTMLVideoElement when available
   * @returns {HTMLVideoElement|null}
   */
  const getCurrentPiPElement = () => {
    const current = document.pictureInPictureElement;
    if (current && typeof current === 'object' && 'tagName' in current) {
      const tag = /** @type {{ tagName?: string }} */ (current).tagName;
      if (typeof tag === 'string' && tag.toLowerCase() === 'video') {
        return /** @type {HTMLVideoElement} */ (/** @type {unknown} */ (current));
      }
    }
    return null;
  };

  /**
   * Toggle Picture-in-Picture mode
   * @param {HTMLVideoElement} video - The video element
   * @returns {Promise<void>}
   */
  const togglePictureInPicture = async video => {
    if (!pipSettings.enabled || !video) return;

    try {
      const currentPiP = getCurrentPiPElement();

      if (currentPiP && currentPiP !== video) {
        await document.exitPictureInPicture();
        setSessionActive(false);
      }

      if (getCurrentPiPElement() === video) {
        await document.exitPictureInPicture();
        setSessionActive(false);
        return;
      }

      if (video.disablePictureInPicture) {
        throw new Error('Picture-in-Picture is disabled by the video element');
      }

      await waitForMetadata(video);

      await video.requestPictureInPicture();
      setSessionActive(true);
    } catch (error) {
      console.error('[YouTube+][PiP] Failed to toggle Picture-in-Picture:', error);
    }
  };

  /**
   * Add PiP settings UI to advanced settings modal
   * @returns {void}
   */
  /**
   * Initialize PiP styles
   * @private
   */
  const initPipStyles = () => {
    if (!document.getElementById('pip-styles')) {
      const styles = `
          .pip-shortcut-editor { display: flex; align-items: center; gap: 8px; }
          .pip-shortcut-editor select, #pip-key {background: rgba(34, 34, 34, var(--yt-header-bg-opacity)); color: var(--yt-spec-text-primary); border: 1px solid var(--yt-spec-10-percent-layer); border-radius: var(--yt-radius-sm); padding: 4px;}
        `;
      YouTubeUtils.StyleManager.add('pip-styles', styles);
    }
  };

  /**
   * Get modifier string from settings
   * @returns {string} Modifier combination string
   * @private
   */
  const getModifierValue = () => {
    const { ctrlKey, altKey, shiftKey } = pipSettings.shortcut;
    const mods = [];
    if (ctrlKey) mods.push('ctrl');
    if (altKey) mods.push('alt');
    if (shiftKey) mods.push('shift');
    return mods.length > 0 ? mods.join('+') : 'none';
  };

  /**
   * Create enable toggle item
   * @param {HTMLElement} advancedSection - Parent section
   * @returns {HTMLElement} Shortcut item for later reference
   * @private
   */
  const createEnableToggle = advancedSection => {
    const enableItem = document.createElement('div');
    enableItem.className = 'ytp-plus-settings-item pip-settings-item';
    enableItem.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">${t('pipTitle')}</label>
          <div class="ytp-plus-settings-item-description">${t('pipDescription')}</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enablePiP" id="pip-enable-checkbox" ${pipSettings.enabled ? 'checked' : ''}>
      `;
    advancedSection.appendChild(enableItem);

    const shortcutItem = createShortcutItem();
    advancedSection.appendChild(shortcutItem);

    return shortcutItem;
  };

  /**
   * Create shortcut configuration item
   * @returns {HTMLElement} Shortcut item element
   * @private
   */
  const createShortcutItem = () => {
    const shortcutItem = document.createElement('div');
    shortcutItem.className = 'ytp-plus-settings-item pip-shortcut-item';
    shortcutItem.style.display = pipSettings.enabled ? 'flex' : 'none';

    shortcutItem.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">${t('pipShortcutTitle')}</label>
          <div class="ytp-plus-settings-item-description">${t('pipShortcutDescription')}</div>
        </div>
        <div class="pip-shortcut-editor">
          <div id="pip-modifier-combo"></div>
          <span>+</span>
          <input type="text" id="pip-key" value="${pipSettings.shortcut.key}" maxlength="1" style="width: 30px; text-align: center;">
        </div>
      `;

    return shortcutItem;
  };

  /**
   * Setup enable checkbox event handler
   * @param {HTMLElement} shortcutItem - Shortcut item to toggle
   * @private
   */
  const setupEnableCheckbox = shortcutItem => {
    document.getElementById('pip-enable-checkbox').addEventListener('change', e => {
      const { target } = /** @type {{ target: EventTarget & HTMLInputElement }} */ (e);
      const { checked } = /** @type {HTMLInputElement} */ (target);
      pipSettings.enabled = checked;
      shortcutItem.style.display = pipSettings.enabled ? 'flex' : 'none';
      saveSettings();
    });
  };

  /**
   * Create label for modifier value
   * @param {string} v - Modifier value
   * @returns {string} Formatted label
   * @private
   */
  const createModifierLabel = v => {
    if (v === 'none') return t('none');
    return v
      .replace(/\+/g, '+')
      .split('+')
      .map(k => t(k.toLowerCase()))
      .join('+')
      .split('+')
      .map(k => k.charAt(0).toUpperCase() + k.slice(1))
      .join('+');
  };

  /**
   * Setup custom modifier select
   * @param {string} modifierValue - Current modifier value
   * @private
   */
  const setupModifierSelect = modifierValue => {
    const native = document.getElementById('pip-modifier-combo');
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
      return;
    }

    custom.addEventListener('change', () => {
      const value = custom.value || '';
      pipSettings.shortcut.ctrlKey = value.includes('ctrl');
      pipSettings.shortcut.altKey = value.includes('alt');
      pipSettings.shortcut.shiftKey = value.includes('shift');
      saveSettings();
    });
  };

  /**
   * Setup key input handler
   * @private
   */
  const setupKeyInput = () => {
    document.getElementById('pip-key').addEventListener('input', e => {
      const { target } = /** @type {{ target: EventTarget & HTMLInputElement }} */ (e);
      const { value: val } = /** @type {HTMLInputElement} */ (target);
      if (val) {
        pipSettings.shortcut.key = val.toUpperCase();
        saveSettings();
      }
    });

    document.getElementById('pip-key').addEventListener('keydown', e => e.stopPropagation());
  };

  /**
   * Add PiP settings to modal
   * @private
   */
  const addPipSettingsToModal = () => {
    const advancedSection = YouTubeUtils.querySelector(
      '.ytp-plus-settings-section[data-section="advanced"]'
    );
    if (!advancedSection || YouTubeUtils.querySelector('.pip-settings-item')) return;

    initPipStyles();
    const shortcutItem = createEnableToggle(advancedSection);
    setupEnableCheckbox(shortcutItem);
    setupModifierSelect(getModifierValue());
    setupKeyInput();
  };

  // Initialize
  loadSettings();

  // Event listeners
  document.addEventListener('keydown', e => {
    if (!pipSettings.enabled) return;
    const { shiftKey, altKey, ctrlKey, key } = pipSettings.shortcut;
    if (
      e.shiftKey === shiftKey &&
      e.altKey === altKey &&
      e.ctrlKey === ctrlKey &&
      e.key.toUpperCase() === key
    ) {
      // ✅ Use cached querySelector and guard by tagName to avoid referencing DOM lib types in TS
      const video = getVideoElement();
      if (video) {
        togglePictureInPicture(video);
      }
      e.preventDefault();
    }
  });

  window.addEventListener('storage', e => {
    if (e.key === pipSettings.storageKey) {
      loadSettings();
    }
  });

  window.addEventListener('load', () => {
    if (!pipSettings.enabled || !wasSessionActive() || document.pictureInPictureElement) {
      return;
    }

    const resumePiP = () => {
      const video = getVideoElement();
      if (!video) return;

      togglePictureInPicture(video).catch(() => {
        // If resume fails we reset the session flag to avoid loops
        setSessionActive(false);
      });
    };

    const ensureCleanup = handler => {
      if (!handler) return;
      try {
        document.removeEventListener('pointerdown', handler, true);
      } catch {}
    };

    const cleanupListeners = () => {
      ensureCleanup(pointerListener);
      ensureCleanup(keyListener);
    };

    const pointerListener = () => {
      cleanupListeners();
      resumePiP();
    };

    const keyListener = () => {
      cleanupListeners();
      resumePiP();
    };

    document.addEventListener('pointerdown', pointerListener, { once: true, capture: true });
    document.addEventListener('keydown', keyListener, { once: true, capture: true });
  });

  // DOM observers for the settings modal
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addPipSettingsToModal, 100);
        }
      }
    }

    document.addEventListener('leavepictureinpicture', () => {
      setSessionActive(false);
    });
    // Check for section changes - ✅ Use cached querySelector
    if (YouTubeUtils.querySelector('.ytp-plus-settings-nav-item[data-section="advanced"].active')) {
      // If advanced section is active and our settings aren't there yet, add them
      if (!YouTubeUtils.querySelector('.pip-settings-item')) {
        setTimeout(addPipSettingsToModal, 50);
      }
    }
  });

  // ✅ Register observer in cleanupManager
  YouTubeUtils.cleanupManager.registerObserver(observer);

  // ✅ Safe observe with document.body check
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // ✅ Register global click listener in cleanupManager
  const clickHandler = e => {
    const { target } = /** @type {{ target: EventTarget & HTMLElement }} */ (e);
    if (target?.classList && target.classList.contains('ytp-plus-settings-nav-item')) {
      if (target.dataset?.section === 'advanced') {
        setTimeout(addPipSettingsToModal, 50);
      }
    }
  };
  YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);
})();
