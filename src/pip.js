// YouTube Picture-in-Picture settings
(function () {
  'use strict';

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

  const getVideoElement = () => {
    const candidate =
      (typeof YouTubeUtils?.querySelector === 'function' && YouTubeUtils.querySelector('video')) ||
      document.querySelector('video');

    if (candidate && candidate.tagName && candidate.tagName.toLowerCase() === 'video') {
      return /** @type {HTMLVideoElement} */ (candidate);
    }

    return null;
  };

  const waitForMetadata = video => {
    if (!video) return Promise.reject(new Error('No video element available'));

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
        reject(new Error('Video metadata failed to load'));
      };

      let timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Timed out waiting for video metadata'));
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
   * Load settings from localStorage
   * @returns {void}
   */
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(pipSettings.storageKey);
      if (saved) Object.assign(pipSettings, JSON.parse(saved));
    } catch (e) {
      console.error('Error loading PiP settings:', e);
    }
  };

  /**
   * Save settings to localStorage
   * @returns {void}
   */
  const saveSettings = () => {
    try {
      localStorage.setItem(pipSettings.storageKey, JSON.stringify(pipSettings));
    } catch (e) {
      console.error('Error saving PiP settings:', e);
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
  const addPipSettingsToModal = () => {
    // ✅ Use cached querySelector
    const advancedSection = YouTubeUtils.querySelector(
      '.ytp-plus-settings-section[data-section="advanced"]'
    );
    if (!advancedSection || YouTubeUtils.querySelector('.pip-settings-item')) return;

    // Add styles if they don't exist
    // ✅ Use StyleManager instead of createElement('style')
    if (!document.getElementById('pip-styles')) {
      const styles = `
          .pip-shortcut-editor { display: flex; align-items: center; gap: 8px; }
          .pip-shortcut-editor select, #pip-key {background: rgba(34, 34, 34, var(--yt-header-bg-opacity)); color: var(--yt-spec-text-primary); border: 1px solid var(--yt-spec-10-percent-layer); border-radius: var(--yt-radius-sm); padding: 4px;}
        `;
      YouTubeUtils.StyleManager.add('pip-styles', styles);
    }

    // Enable/disable toggle
    const enableItem = document.createElement('div');
    enableItem.className = 'ytp-plus-settings-item pip-settings-item';
    enableItem.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Picture-in-Picture</label>
          <div class="ytp-plus-settings-item-description">Add Picture-in-Picture functionality with keyboard shortcut</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enablePiP" id="pip-enable-checkbox" ${pipSettings.enabled ? 'checked' : ''}>
      `;
    advancedSection.appendChild(enableItem);

    // Shortcut settings
    const shortcutItem = document.createElement('div');
    shortcutItem.className = 'ytp-plus-settings-item pip-shortcut-item';
    shortcutItem.style.display = pipSettings.enabled ? 'flex' : 'none';

    const { ctrlKey, altKey, shiftKey } = pipSettings.shortcut;
    const modifierValue =
      ctrlKey && altKey && shiftKey
        ? 'ctrl+alt+shift'
        : ctrlKey && altKey
          ? 'ctrl+alt'
          : ctrlKey && shiftKey
            ? 'ctrl+shift'
            : altKey && shiftKey
              ? 'alt+shift'
              : ctrlKey
                ? 'ctrl'
                : altKey
                  ? 'alt'
                  : shiftKey
                    ? 'shift'
                    : 'none';

    shortcutItem.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">PiP Keyboard Shortcut</label>
          <div class="ytp-plus-settings-item-description">Customize keyboard combination to toggle PiP mode</div>
        </div>
        <div class="pip-shortcut-editor">
          <select id="pip-modifier-combo">
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
                          .replace(/\+/g, '+')
                          .split('+')
                          .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                          .join('+')
                  }</option>`
              )
              .join('')}
          </select>
          <span>+</span>
          <input type="text" id="pip-key" value="${pipSettings.shortcut.key}" maxlength="1" style="width: 30px; text-align: center;">
        </div>
      `;
    advancedSection.appendChild(shortcutItem);

    // Event listeners
    document.getElementById('pip-enable-checkbox').addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      pipSettings.enabled = target.checked;
      shortcutItem.style.display = pipSettings.enabled ? 'flex' : 'none';
      saveSettings();
    });

    document.getElementById('pip-modifier-combo').addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLSelectElement} */ (e.target);
      const value = target.value;
      pipSettings.shortcut.ctrlKey = value.includes('ctrl');
      pipSettings.shortcut.altKey = value.includes('alt');
      pipSettings.shortcut.shiftKey = value.includes('shift');
      saveSettings();
    });

    document.getElementById('pip-key').addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      if (target.value) {
        pipSettings.shortcut.key = target.value.toUpperCase();
        saveSettings();
      }
    });

    document.getElementById('pip-key').addEventListener('keydown', e => e.stopPropagation());
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
        void togglePictureInPicture(video);
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
    const target = /** @type {EventTarget & HTMLElement} */ (e.target);
    if (target.classList && target.classList.contains('ytp-plus-settings-nav-item')) {
      if (target.dataset?.section === 'advanced') {
        setTimeout(addPipSettingsToModal, 50);
      }
    }
  };
  YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);
})();
