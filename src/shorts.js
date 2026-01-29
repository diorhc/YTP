// Shorts Keyboard controls
(function () {
  'use strict';

  // Use centralized i18n from YouTubePlusI18n or YouTubeUtils
  const t = (key, params = {}) => {
    if (window.YouTubePlusI18n?.t) return window.YouTubePlusI18n.t(key, params);
    if (window.YouTubeUtils?.t) return window.YouTubeUtils.t(key, params);
    // Fallback for initialization phase
    if (!key) return '';
    let result = String(key);
    for (const [k, v] of Object.entries(params || {})) {
      result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return result;
  };

  // Configuration - Using lazy getters for translations to avoid early loading
  const config = {
    enabled: true,
    get shortcuts() {
      return {
        seekBackward: {
          key: 'ArrowLeft',
          get description() {
            return t('seekBackward');
          },
        },
        seekForward: {
          key: 'ArrowRight',
          get description() {
            return t('seekForward');
          },
        },
        volumeUp: {
          key: '+',
          get description() {
            return t('volumeUp');
          },
        },
        volumeDown: {
          key: '-',
          get description() {
            return t('volumeDown');
          },
        },
        mute: {
          key: 'm',
          get description() {
            return t('muteUnmute');
          },
        },
        toggleCaptions: {
          key: 'c',
          get description() {
            return t('toggleCaptions');
          },
        },
        showHelp: {
          key: '?',
          get description() {
            return t('showHideHelp');
          },
          editable: false,
        },
      };
    },
    storageKey: 'youtube_shorts_keyboard_settings',
  };

  // State management
  const state = {
    helpVisible: false,
    lastAction: null,
    actionTimeout: null,
    editingShortcut: null,
    cachedVideo: null,
    lastVideoCheck: 0,
  };

  /**
   * Get the currently active video element in YouTube Shorts with caching
   * Optimizes performance by caching results for 100ms
   * @returns {HTMLVideoElement|null} The active video element or null if not found
   */
  const getCurrentVideo = (() => {
    const selectors = ['ytd-reel-video-renderer[is-active] video', '#shorts-player video', 'video'];

    return () => {
      const now = Date.now();
      if (state.cachedVideo?.isConnected && now - state.lastVideoCheck < 100) {
        return state.cachedVideo;
      }

      for (const selector of selectors) {
        // ✅ Use cached querySelector
        const video = YouTubeUtils.querySelector(selector);
        if (video) {
          state.cachedVideo = video;
          state.lastVideoCheck = now;
          return video;
        }
      }

      state.cachedVideo = null;
      return null;
    };
  })();

  // Optimized utilities
  const utils = {
    /**
     * Check if current page is a YouTube Shorts page
     * @returns {boolean} True if on Shorts page
     */
    isInShortsPage: () => location.pathname.startsWith('/shorts/'),

    /**
     * Check if an input element currently has focus
     * @returns {boolean} True if input/textarea/contenteditable is focused
     */
    isInputFocused: () => {
      const el = document.activeElement;
      return el?.matches?.('input, textarea, [contenteditable="true"]') || el?.isContentEditable;
    },

    /**
     * Load settings from localStorage with validation
     * @returns {void}
     */
    loadSettings: () => {
      try {
        const saved = localStorage.getItem(config.storageKey);
        if (!saved) return;

        const parsed = JSON.parse(saved);
        if (typeof parsed !== 'object' || parsed === null) {
          console.warn('[YouTube+][Shorts]', 'Invalid settings format');
          return;
        }

        // Validate enabled flag
        if (typeof parsed.enabled === 'boolean') {
          config.enabled = parsed.enabled;
        }

        // Validate shortcuts object
        if (parsed.shortcuts && typeof parsed.shortcuts === 'object') {
          const defaultShortcuts = utils.getDefaultShortcuts();

          for (const [action, shortcut] of Object.entries(parsed.shortcuts)) {
            // Only restore valid shortcut actions
            if (!defaultShortcuts[action]) continue;
            if (!shortcut || typeof shortcut !== 'object') continue;

            const { key: sKey, editable: sEditable } =
              /** @type {{ key?: string, editable?: boolean }} */ (shortcut);
            if (typeof sKey === 'string' && sKey.length > 0 && sKey.length <= 20) {
              config.shortcuts[action] = {
                key: sKey,
                description: defaultShortcuts[action].description,
                editable: sEditable !== false,
              };
            }
          }
        }
      } catch (error) {
        console.error('[YouTube+][Shorts]', 'Error loading settings:', error);
      }
    },

    /**
     * Save settings to localStorage with error handling
     * @returns {void}
     */
    saveSettings: () => {
      try {
        const settingsToSave = {
          enabled: config.enabled,
          shortcuts: config.shortcuts,
        };
        localStorage.setItem(config.storageKey, JSON.stringify(settingsToSave));
      } catch (error) {
        console.error('[YouTube+][Shorts]', 'Error saving settings:', error);
      }
    },

    /**
     * Get default keyboard shortcuts configuration
     * @returns {Object} Object containing default shortcut definitions
     */
    getDefaultShortcuts: () => ({
      seekBackward: {
        key: 'ArrowLeft',
        get description() {
          return t('seekBackward');
        },
      },
      seekForward: {
        key: 'ArrowRight',
        get description() {
          return t('seekForward');
        },
      },
      volumeUp: {
        key: '+',
        get description() {
          return t('volumeUp');
        },
      },
      volumeDown: {
        key: '-',
        get description() {
          return t('volumeDown');
        },
      },
      mute: {
        key: 'm',
        get description() {
          return t('muteUnmute');
        },
      },
      toggleCaptions: {
        key: 'c',
        get description() {
          return t('toggleCaptions');
        },
      },
      showHelp: {
        key: '?',
        get description() {
          return t('showHideHelp');
        },
        editable: false,
      },
    }),
  };

  /**
   * Feedback system for displaying temporary notifications in Shorts
   * Uses glassmorphism design for visual feedback
   */
  const feedback = (() => {
    let element = null;

    /**
     * Create or retrieve the feedback element
     * @returns {HTMLElement} The feedback container element
     */
    const create = () => {
      if (element) return element;

      element = document.createElement('div');
      element.id = 'shorts-keyboard-feedback';
      element.style.cssText = `
          position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
          background:var(--shorts-feedback-bg,rgba(255,255,255,.1));
          backdrop-filter:blur(16px) saturate(150%);
          border:1px solid var(--shorts-feedback-border,rgba(255,255,255,.15));
          border-radius:20px;
          color:var(--shorts-feedback-color,#fff);
          padding:18px 32px;font-size:20px;font-weight:700;
          z-index:10000;opacity:0;visibility:hidden;pointer-events:none;
          transition:all .3s cubic-bezier(.4,0,.2,1);text-align:center;
          box-shadow:0 8px 32px rgba(0,0,0,.4);
          background: rgba(155, 155, 155, 0.15);
          border: 1px solid rgba(255,255,255,0.2);
          box-shadow: 0 8px 32px 0 rgba(31,38,135,0.37);
          backdrop-filter: blur(12px) saturate(180%);
          -webkit-backdrop-filter: blur(12px) saturate(180%);
        `;
      document.body.appendChild(element);
      return element;
    };

    return {
      /**
       * Display a feedback message to the user
       * @param {string} text - Message text to display
       * @returns {void}
       */
      show: text => {
        state.lastAction = text;
        clearTimeout(state.actionTimeout);

        const el = create();
        el.textContent = text;

        requestAnimationFrame(() => {
          el.style.opacity = '1';
          el.style.visibility = 'visible';
          el.style.transform = 'translate(-50%, -50%) scale(1.05)';
        });

        state.actionTimeout = setTimeout(() => {
          el.style.opacity = '0';
          el.style.visibility = 'hidden';
          el.style.transform = 'translate(-50%, -50%) scale(0.95)';
        }, 1500);
      },
    };
  })();

  // Optimized actions
  const actions = {
    /**
     * Seek backward 5 seconds in the video
     * @returns {void}
     */
    seekBackward: () => {
      const video = getCurrentVideo();
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - 5);
        feedback.show('-5s');
      }
    },

    /**
     * Seek forward 5 seconds in the video
     * @returns {void}
     */
    seekForward: () => {
      const video = getCurrentVideo();
      if (video) {
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
        feedback.show('+5s');
      }
    },

    /**
     * Toggle captions/subtitles on or off
     * Attempts to click UI button first, then falls back to programmatic toggle
     * @returns {void}
     */
    toggleCaptions: () => {
      // Try to click a captions/subtitles button first
      try {
        const buttons = document.querySelectorAll('button[aria-label]');
        for (const b of buttons) {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          if (
            aria.includes('subtit') ||
            aria.includes('caption') ||
            aria.includes('субтит') ||
            aria.includes('субтитр') ||
            aria.includes('cc')
          ) {
            if (b.offsetParent !== null) {
              b.click();
              // It's hard to know exact state, so try to use textTracks below for feedback
              break;
            }
          }
        }
      } catch {
        // Continue to fallback
      }

      const video = getCurrentVideo();
      if (video && video.textTracks && video.textTracks.length) {
        const tracks = Array.from(video.textTracks).filter(
          tr => tr.kind === 'subtitles' || tr.kind === 'captions' || !tr.kind
        );
        if (tracks.length) {
          const anyShowing = tracks.some(tr => tr.mode === 'showing');
          tracks.forEach(tr => {
            tr.mode = anyShowing ? 'hidden' : 'showing';
          });
          feedback.show(anyShowing ? t('captionsOff') : t('captionsOn'));
          return;
        }
      }

      // If we couldn't toggle via textTracks or button, inform user
      feedback.show(t('captionsUnavailable'));
    },

    /**
     * Increase video volume by 10%
     * @returns {void}
     */
    volumeUp: () => {
      const video = getCurrentVideo();
      if (video) {
        video.volume = Math.min(1, video.volume + 0.1);
        feedback.show(`${Math.round(video.volume * 100)}%`);
      }
    },

    /**
     * Decrease video volume by 10%
     * @returns {void}
     */
    volumeDown: () => {
      const video = getCurrentVideo();
      if (video) {
        video.volume = Math.max(0, video.volume - 0.1);
        feedback.show(`${Math.round(video.volume * 100)}%`);
      }
    },

    /**
     * Toggle video mute state
     * Attempts to click UI mute button first, then falls back to programmatic toggle
     * @returns {void}
     */
    mute: () => {
      const video = getCurrentVideo();

      // Try to click a visible mute/volume button so the player UI updates its icon
      try {
        const buttons = document.querySelectorAll('button[aria-label]');
        for (const b of buttons) {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          if (
            aria.includes('mute') ||
            aria.includes('unmute') ||
            aria.includes('sound') ||
            aria.includes('volume') ||
            aria.includes('звук') ||
            aria.includes('громк')
          ) {
            if (b.offsetParent !== null) {
              b.click();
              // Give the player a moment to update state, then show feedback based on video.muted
              setTimeout(() => {
                const v = getCurrentVideo();
                if (v) feedback.show(v.muted ? '🔇' : '🔊');
              }, 60);
              return;
            }
          }
        }
      } catch {
        // ignore and fallback
      }

      // Fallback: toggle programmatically
      if (video) {
        video.muted = !video.muted;
        feedback.show(video.muted ? '🔇' : '🔊');
      }
    },

    /**
     * Show or hide the keyboard shortcuts help panel
     * @returns {void}
     */
    showHelp: () => helpPanel.toggle(),
  };

  /**
   * Help panel system for displaying keyboard shortcuts reference
   * Provides interactive UI for viewing and editing shortcuts
   */
  const helpPanel = (() => {
    let panel = null;

    /**
     * Create or retrieve the help panel element
     * @returns {HTMLElement} The help panel container element
     */
    const create = () => {
      if (panel) return panel;

      panel = document.createElement('div');
      panel.id = 'shorts-keyboard-help';
      panel.className = 'glass-panel shorts-help-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.tabIndex = -1;

      const render = () => {
        panel.innerHTML = `
            <div class="help-header">
              <h3>${t('keyboardShortcuts')}</h3>
              <button class="ytp-plus-settings-close help-close" type="button" aria-label="${t('closeButton')}">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                </svg>
              </button>
            </div>
            <div class="help-content">
              ${Object.entries(config.shortcuts)
                .map(
                  ([action, shortcut]) =>
                    `<div class="help-item">
                  <kbd data-action="${action}" ${shortcut.editable === false ? 'class="non-editable"' : ''}>${shortcut.key === ' ' ? 'Space' : shortcut.key}</kbd>
                  <span>${shortcut.description}</span>
                </div>`
                )
                .join('')}
            </div>
            <div class="help-footer">
              <button class="ytp-plus-button ytp-plus-button-primary reset-all-shortcuts">${t('resetAll')}</button>
            </div>
          `;

        panel.querySelector('.help-close').onclick = () => helpPanel.hide();
        panel.querySelector('.reset-all-shortcuts').onclick = () => {
          if (confirm(t('resetAllConfirm'))) {
            config.shortcuts = utils.getDefaultShortcuts();
            utils.saveSettings();
            feedback.show(t('shortcutsReset'));
            render();
          }
        };

        panel.querySelectorAll('kbd[data-action]:not(.non-editable)').forEach(kbd => {
          kbd.onclick = () =>
            editShortcut(kbd.dataset.action, config.shortcuts[kbd.dataset.action].key);
        });
      };

      render();
      document.body.appendChild(panel);
      return panel;
    };

    return {
      /**
       * Display the help panel
       * @returns {void}
       */
      show: () => {
        const p = create();
        p.classList.add('visible');
        state.helpVisible = true;
        p.focus();
      },

      /**
       * Hide the help panel
       * @returns {void}
       */
      hide: () => {
        if (panel) {
          panel.classList.remove('visible');
          state.helpVisible = false;
        }
      },

      /**
       * Toggle help panel visibility
       * @returns {void}
       */
      toggle: () => (state.helpVisible ? helpPanel.hide() : helpPanel.show()),

      /**
       * Refresh the help panel by removing and recreating it
       * @returns {void}
       */
      refresh: () => {
        if (panel) {
          panel.remove();
          panel = null;
        }
      },
    };
  })();

  /**
   * Open dialog to edit a keyboard shortcut
   * @param {string} actionKey - The action identifier to edit
   * @param {string} currentKey - The current key binding
   * @returns {void}
   */
  const editShortcut = (actionKey, currentKey) => {
    const dialog = document.createElement('div');
    dialog.className = 'glass-modal shortcut-edit-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
        <div class="glass-panel shortcut-edit-content">
          <h4>${t('editShortcut')}: ${config.shortcuts[actionKey].description}</h4>
          <p>${t('pressAnyKey')}</p>
          <div class="current-shortcut">${t('current')}: <kbd>${currentKey === ' ' ? 'Space' : currentKey}</kbd></div>
          <button class="ytp-plus-button ytp-plus-button-primary shortcut-cancel" type="button">${t('cancel')}</button>
        </div>
      `;

    document.body.appendChild(dialog);
    state.editingShortcut = actionKey;

    const handleKey = e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return cleanup();

      const conflict = Object.keys(config.shortcuts).find(
        key => key !== actionKey && config.shortcuts[key].key === e.key
      );
      if (conflict) {
        feedback.show(t('keyAlreadyUsed', { key: e.key }));
        return;
      }

      config.shortcuts[actionKey].key = e.key;
      utils.saveSettings();
      feedback.show(t('shortcutUpdated'));
      helpPanel.refresh();
      cleanup();
    };

    const cleanup = () => {
      document.removeEventListener('keydown', handleKey, true);
      dialog.remove();
      state.editingShortcut = null;
    };

    dialog.querySelector('.shortcut-cancel').onclick = cleanup;
    // Use parameter destructuring to satisfy prefer-destructuring rule
    dialog.onclick = ({ target }) => {
      // target is expected to be an Element here
      if (target === dialog) cleanup();
    };
    document.addEventListener('keydown', handleKey, true);
  };

  /**
   * Add glassmorphism styles for Shorts keyboard controls
   * Uses CSS custom properties for theme support
   * @returns {void}
   */
  const addStyles = () => {
    if (document.getElementById('shorts-keyboard-styles')) return;

    // ✅ Use StyleManager instead of createElement('style')
    const styles = `
                :root{--shorts-feedback-bg:rgba(255,255,255,.15);--shorts-feedback-border:rgba(255,255,255,.2);--shorts-feedback-color:#fff;--shorts-help-bg:rgba(255,255,255,.15);--shorts-help-border:rgba(255,255,255,.2);--shorts-help-color:#fff;}
                html[dark],body[dark]{--shorts-feedback-bg:rgba(34,34,34,.7);--shorts-feedback-border:rgba(255,255,255,.15);--shorts-feedback-color:#fff;--shorts-help-bg:rgba(34,34,34,.7);--shorts-help-border:rgba(255,255,255,.1);--shorts-help-color:#fff;}
                html:not([dark]){--shorts-feedback-bg:rgba(255,255,255,.95);--shorts-feedback-border:rgba(0,0,0,.08);--shorts-feedback-color:#222;--shorts-help-bg:rgba(255,255,255,.98);--shorts-help-border:rgba(0,0,0,.08);--shorts-help-color:#222;}
                .shorts-help-panel{position:fixed;top:50%;left:25%;transform:translate(-50%,-50%) scale(.9);z-index:10001;opacity:0;visibility:hidden;transition:all .3s ease;width:340px;max-width:95vw;max-height:80vh;overflow:hidden;outline:none;color:var(--shorts-help-color,#fff);}
                .shorts-help-panel.visible{opacity:1;visibility:visible;transform:translate(-50%,-50%) scale(1);}
                .help-header{display:flex;justify-content:space-between;align-items:center;padding:24px 24px 12px;border-bottom:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);}
                html:not([dark]) .help-header{background:rgba(0,0,0,.04);border-bottom:1px solid rgba(0,0,0,.08);}
                .help-header h3{margin:0;font-size:20px;font-weight:700;}
                .help-close{display:flex;align-items:center;justify-content:center;padding:4px;}
                .help-content{padding:18px 24px;max-height:400px;overflow-y:auto;}
                .help-item{display:flex;align-items:center;margin-bottom:14px;gap:18px;}
                .help-item kbd{background:rgba(255,255,255,.15);color:inherit;padding:7px 14px;border-radius:8px;font-family:monospace;font-size:15px;font-weight:700;min-width:60px;text-align:center;border:1.5px solid rgba(255,255,255,.2);cursor:pointer;transition:all .2s;position:relative;}
                html:not([dark]) .help-item kbd{background:rgba(0,0,0,.06);color:#222;border:1.5px solid rgba(0,0,0,.08);}
                .help-item kbd:hover{background:rgba(255,255,255,.22);transform:scale(1.07);}
                .help-item kbd:after{content:"✎";position:absolute;top:-7px;right:-7px;font-size:11px;opacity:0;transition:opacity .2s;}
                .help-item kbd:hover:after{opacity:.7;}
                .help-item kbd.non-editable{cursor:default;opacity:.7;}
                .help-item kbd.non-editable:hover{background:rgba(255,255,255,.15);transform:none;}
                .help-item kbd.non-editable:after{display:none;}
                .help-item span{font-size:15px;color:rgba(255,255,255,.92);}
                html:not([dark]) .help-item span{color:#222;}
                .help-footer{padding:16px 24px 20px;border-top:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);text-align:center;}
                html:not([dark]) .help-footer{background:rgba(0,0,0,.04);border-top:1px solid rgba(0,0,0,.08);}
                .reset-all-shortcuts{display:inline-flex;align-items:center;justify-content:center;gap:var(--yt-space-sm);}
                .shortcut-edit-dialog{z-index:10002;}
                .shortcut-edit-content{padding:28px 32px;min-width:320px;text-align:center;display:flex;flex-direction:column;gap:var(--yt-space-md);color:inherit;}
                html:not([dark]) .shortcut-edit-content{color:#222;}
                .shortcut-edit-content h4{margin:0 0 14px;font-size:17px;font-weight:700;}
                .shortcut-edit-content p{margin:0 0 18px;font-size:15px;color:rgba(255,255,255,.85);}
                html:not([dark]) .shortcut-edit-content p{color:#222;}
                .current-shortcut{margin:18px 0;font-size:15px;}
                .current-shortcut kbd{background:rgba(255,255,255,.15);padding:5px 12px;border-radius:6px;font-family:monospace;border:1.5px solid rgba(255,255,255,.2);}
                html:not([dark]) .current-shortcut kbd{background:rgba(0,0,0,.06);color:#222;border:1.5px solid rgba(0,0,0,.08);}
                .shortcut-cancel{display:inline-flex;align-items:center;justify-content:center;gap:var(--yt-space-sm);}
                @media(max-width:480px){.shorts-help-panel{width:98vw;max-height:85vh}.help-header{padding:16px 10px 8px 10px}.help-content{padding:12px 10px}.help-item{gap:10px}.help-item kbd{min-width:44px;font-size:13px;padding:5px 7px}.shortcut-edit-content{margin:20px;min-width:auto}}
                #shorts-keyboard-feedback{background:var(--shorts-feedback-bg,rgba(255,255,255,.15));color:var(--shorts-feedback-color,#fff);border:1.5px solid var(--shorts-feedback-border,rgba(255,255,255,.2));border-radius:20px;box-shadow:0 8px 32px 0 rgba(31,38,135,.37);backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);}
                html:not([dark]) #shorts-keyboard-feedback{background:var(--shorts-feedback-bg,rgba(255,255,255,.95));color:var(--shorts-feedback-color,#222);border:1.5px solid var(--shorts-feedback-border,rgba(0,0,0,.08));}
            `;
    YouTubeUtils.StyleManager.add('shorts-keyboard-styles', styles);
  };

  /**
   * Main keyboard event handler for Shorts controls
   * Routes keypress events to appropriate actions
   * @param {KeyboardEvent} e - The keyboard event
   * @returns {void}
   */
  const handleKeydown = e => {
    if (
      !config.enabled ||
      !utils.isInShortsPage() ||
      utils.isInputFocused() ||
      state.editingShortcut
    ) {
      return;
    }

    let { key } = e;
    if (e.code === 'NumpadAdd') key = '+';
    else if (e.code === 'NumpadSubtract') key = '-';

    const action = Object.keys(config.shortcuts).find(k => config.shortcuts[k].key === key);
    if (action && actions[action]) {
      e.preventDefault();
      e.stopPropagation();
      actions[action]();
    }
  };

  /**
   * Initialize the Shorts keyboard controls module
   * Sets up event listeners and styles
   * @returns {void}
   */
  const init = () => {
    utils.loadSettings();
    addStyles();

    // ✅ Register listeners in cleanupManager
    YouTubeUtils.cleanupManager.registerListener(document, 'keydown', handleKeydown, true);

    // Prefer destructuring the event parameter
    const clickHandler = ({ target }) => {
      if (state.helpVisible && target?.closest && !target.closest('#shorts-keyboard-help')) {
        helpPanel.hide();
      }
    };
    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state.helpVisible) {
        e.preventDefault();
        helpPanel.hide();
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  if (utils.isInShortsPage() && !localStorage.getItem('shorts_keyboard_help_shown')) {
    setTimeout(() => {
      feedback.show('Press ? for shortcuts');
      localStorage.setItem('shorts_keyboard_help_shown', 'true');
    }, 2000);
  }
})();
