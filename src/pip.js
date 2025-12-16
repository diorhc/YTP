// YouTube Picture-in-Picture settings
(function () {
  'use strict';

  /**
   * Translation helper - uses centralized i18n system
   * @param {string} key - Translation key
   * @param {Object} params - Interpolation parameters
   * @returns {string} Translated string
   */
  function t(key, params = {}) {
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
  }

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
      console.error('[PiP] Error getting video element:', error);
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
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(pipSettings.storageKey);
      if (!saved) return;

      const parsed = JSON.parse(saved);
      if (typeof parsed !== 'object' || parsed === null) {
        console.warn('[PiP] Invalid settings format');
        return;
      }

      // Validate and merge settings
      if (typeof parsed.enabled === 'boolean') {
        pipSettings.enabled = parsed.enabled;
      }

      // Validate shortcut object
      if (parsed.shortcut && typeof parsed.shortcut === 'object') {
        if (typeof parsed.shortcut.key === 'string' && parsed.shortcut.key.length > 0) {
          pipSettings.shortcut.key = parsed.shortcut.key;
        }
        if (typeof parsed.shortcut.shiftKey === 'boolean') {
          pipSettings.shortcut.shiftKey = parsed.shortcut.shiftKey;
        }
        if (typeof parsed.shortcut.altKey === 'boolean') {
          pipSettings.shortcut.altKey = parsed.shortcut.altKey;
        }
        if (typeof parsed.shortcut.ctrlKey === 'boolean') {
          pipSettings.shortcut.ctrlKey = parsed.shortcut.ctrlKey;
        }
      }
    } catch (e) {
      console.error('[PiP] Error loading settings:', e);
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
      console.error('[PiP] Error saving settings:', e);
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
          <label class="ytp-plus-settings-item-label">${t('pipTitle')}</label>
          <div class="ytp-plus-settings-item-description">${t('pipDescription')}</div>
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
          <label class="ytp-plus-settings-item-label">${t('pipShortcutTitle')}</label>
          <div class="ytp-plus-settings-item-description">${t('pipShortcutDescription')}</div>
        </div>
        <div class="pip-shortcut-editor">
          <!-- hidden native select kept for compatibility -->
          <select id="pip-modifier-combo" style="display:none;">
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
                      ? t('none')
                      : v
                          .replace(/\+/g, '+')
                          .split('+')
                          .map(k => t(k.toLowerCase()))
                          .join('+')
                          .split('+')
                          .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                          .join('+')
                  }</option>`
              )
              .join('')}
          </select>

          <div class="glass-dropdown" id="pip-modifier-dropdown" tabindex="0" role="listbox" aria-expanded="false">
            <button class="glass-dropdown__toggle" type="button" aria-haspopup="listbox">
              <span class="glass-dropdown__label">${
                modifierValue === 'none'
                  ? t('none')
                  : modifierValue
                      .replace(/\+/g, '+')
                      .split('+')
                      .map(k => t(k.toLowerCase()))
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
                      ? t('none')
                      : v
                          .replace(/\+/g, '+')
                          .split('+')
                          .map(k => t(k.toLowerCase()))
                          .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                          .join('+');
                  const sel = v === modifierValue ? ' aria-selected="true"' : '';
                  return `<li class="glass-dropdown__item" data-value="${v}" role="option"${sel}>${label}</li>`;
                })
                .join('')}
            </ul>
          </div>

          <span>+</span>
          <input type="text" id="pip-key" value="${pipSettings.shortcut.key}" maxlength="1" style="width: 30px; text-align: center;">
        </div>
      `;
    advancedSection.appendChild(shortcutItem);

    // Initialize glass dropdown interactions for PiP selector
    const initPipDropdown = () => {
      const hidden = document.getElementById('pip-modifier-combo');
      const dropdown = document.getElementById('pip-modifier-dropdown');
      if (!hidden || !dropdown) return;

      const toggle = dropdown.querySelector('.glass-dropdown__toggle');
      const list = dropdown.querySelector('.glass-dropdown__list');
      const label = dropdown.querySelector('.glass-dropdown__label');
      let items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
      let idx = items.findIndex(it => it.getAttribute('aria-selected') === 'true');
      if (idx < 0) idx = 0;

      const openList = () => {
        dropdown.setAttribute('aria-expanded', 'true');
        list.style.display = 'block';
        items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
      };
      const closeList = () => {
        dropdown.setAttribute('aria-expanded', 'false');
        list.style.display = 'none';
      };

      toggle.addEventListener('click', () => {
        const expanded = dropdown.getAttribute('aria-expanded') === 'true';
        if (expanded) closeList();
        else openList();
      });

      document.addEventListener('click', e => {
        if (!dropdown.contains(e.target)) closeList();
      });

      // Arrow-key navigation and selection
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
            hidden.value = it.dataset.value;
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
            label.textContent = it.textContent;
            closeList();
          }
        } else if (e.key === 'Escape') {
          closeList();
        }
      });

      list.addEventListener('click', e => {
        const it = e.target.closest('.glass-dropdown__item');
        if (!it) return;
        const val = it.dataset.value;
        hidden.value = val;
        list
          .querySelectorAll('.glass-dropdown__item')
          .forEach(li => li.removeAttribute('aria-selected'));
        it.setAttribute('aria-selected', 'true');
        label.textContent = it.textContent;
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
        closeList();
      });
    };

    setTimeout(initPipDropdown, 0);

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
