// Shorts Keyboard Controls — LazyLoader registered as 'shorts'.
//
// Responsibility: keyboard shortcuts for YouTube Shorts (next/previous
//   like/dislike/share, speed control). Persists key bindings in
//   localStorage under `youtube_shorts_keyboard_settings`.
// Public surface: none (self-contained IIFE, registered via LazyLoader).
(function () {
  // Shared helpers from YouTubeUtils (canonical boot shorthand)
  const U = window.YouTubeUtils;
  const { t, logger: shortsLogger, $: qs, setTimeout_ } = U?.helpers ?? {};

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
    /** @type {string|null} */
    lastAction: null,
    /** @type {number|null} */
    actionTimeout: null,
    /** @type {string|null} */
    editingShortcut: null,
    /** @type {HTMLVideoElement|null} */
    cachedVideo: null,
    /** @type {HTMLElement|null} */
    downloadButton: null,
    /** @type {MutationObserver|null} */
    downloadObserver: null,
    downloadEnsureQueued: false,
    lastVideoCheck: 0,
    initialized: false,
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
        const video = YouTubeUtils.querySelector
          ? YouTubeUtils.querySelector(selector)
          : qs(selector);
        if (video) {
          state.cachedVideo = /** @type {HTMLVideoElement} */ (/** @type {unknown} */ (video));
          state.lastVideoCheck = now;
          return state.cachedVideo;
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
      return !!(
        el?.matches?.('input, textarea, [contenteditable="true"]') || el?.isContentEditable
      );
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
          shortsLogger?.warn?.('Shorts', 'Invalid settings format');
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
            const defaultSc = /** @type {Record<string,any>} */ (defaultShortcuts);
            if (!defaultSc[action]) continue;
            if (!shortcut || typeof shortcut !== 'object') continue;

            const { key: sKey, editable: sEditable } =
              /** @type {{ key?: string, editable?: boolean }} */ (shortcut);
            if (typeof sKey === 'string' && sKey.length > 0 && sKey.length <= 20) {
              /** @type {Record<string,any>} */ (config.shortcuts)[action] = {
                key: sKey,
                description: defaultSc[action].description,
                editable: sEditable !== false,
              };
            }
          }
        }
      } catch (error) {
        shortsLogger?.error?.('Shorts', 'Error loading settings', error);
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
        shortsLogger?.error?.('Shorts', 'Error saving settings', error);
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
    /** @type {HTMLElement|null} */
    let element = null;

    /**
     * Create or retrieve the feedback element
     * @returns {HTMLElement} The feedback container element
     */
    const create = () => {
      if (element) return element;

      element = document.createElement('div');
      element.id = 'shorts-keyboard-feedback';
      document.body.appendChild(element);
      element.style.position = 'fixed';
      element.style.top = '50%';
      element.style.left = '50%';
      element.style.transform = 'translate(-50%,-50%)';
      element.style.background = 'var(--yt-shorts-feedback-bg-dark)';
      element.style.backdropFilter = 'blur(12px) saturate(180%)';
      element.style.border = '1px solid var(--yt-shorts-border-light)';
      element.style.borderRadius = '20px';
      element.style.color = 'var(--yt-text-primary,#fff)';
      element.style.padding = '18px 32px';
      element.style.fontSize = '20px';
      element.style.fontWeight = '700';
      element.style.zIndex = '10000';
      element.style.opacity = '0';
      element.style.visibility = 'hidden';
      element.style.pointerEvents = 'none';
      element.style.transition = 'all .3s cubic-bezier(.4,0,.2,1)';
      element.style.textAlign = 'center';
      element.style.boxShadow = '0 8px 32px 0 var(--yt-shorts-shadow-blue)';
      element.style.setProperty('-webkit-backdrop-filter', 'blur(12px) saturate(180%)');
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
        clearTimeout(state.actionTimeout ?? undefined);

        const el = create();
        el.textContent = text;

        requestAnimationFrame(() => {
          el.style.opacity = '1';
          el.style.visibility = 'visible';
          el.style.transform = 'translate(-50%,-50%) scale(1.05)';
        });

        state.actionTimeout = /** @type {number} */ (
          /** @type {unknown} */ (
            setTimeout_(() => {
              el.style.opacity = '0';
              el.style.visibility = 'hidden';
              el.style.transform = 'translate(-50%,-50%) scale(0.95)';
            }, 1500)
          )
        );
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
        const container =
          qs('ytd-shorts-player-controls, ytd-reel-video-renderer, #shorts-player') || document;
        const buttons = container.querySelectorAll('button[aria-label]');
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
      } catch (_e) {
        // Continue to fallback
      }

      const video = getCurrentVideo();
      if (video?.textTracks?.length) {
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
        const container =
          qs('ytd-shorts-player-controls, ytd-reel-video-renderer, #shorts-player') || document;
        const buttons = container.querySelectorAll('button[aria-label]');
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
      } catch (_e) {
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
    /** @type {HTMLElement|null} */
    let panel = null;
    /** @type {AbortController|null} */
    let dragListeners = null;

    /**
     * Enable dragging the help panel by grabbing the help content area
     * @param {HTMLElement} panelEl
     */
    const setupHelpContentDrag = panelEl => {
      dragListeners?.abort();
      dragListeners = new AbortController();

      const { signal } = dragListeners;
      const dragHandle = panelEl.querySelector('.help-content');
      if (!(dragHandle instanceof HTMLElement)) return;

      let dragging = false;
      let offsetX = 0;
      let offsetY = 0;
      let cachedWidth = 0;
      let cachedHeight = 0;

      const stopDragging = () => {
        if (!dragging) return;
        dragging = false;
        panelEl.classList.remove('is-dragging');
      };

      const onPointerMove = /** @param {PointerEvent} ev */ ev => {
        if (!dragging) return;
        const maxLeft = Math.max(0, window.innerWidth - cachedWidth);
        const maxTop = Math.max(0, window.innerHeight - cachedHeight);
        const nextLeft = Math.min(Math.max(0, ev.clientX - offsetX), maxLeft);
        const nextTop = Math.min(Math.max(0, ev.clientY - offsetY), maxTop);
        panelEl.style.left = `${nextLeft}px`;
        panelEl.style.top = `${nextTop}px`;
      };

      const onPointerDown = /** @param {PointerEvent} ev */ ev => {
        if (ev.button !== 0) return;
        const target = ev.target instanceof Element ? ev.target : null;
        if (target?.closest('button,kbd,a,input,textarea,select,label')) return;

        const rect = panelEl.getBoundingClientRect();
        panelEl.style.left = `${rect.left}px`;
        panelEl.style.top = `${rect.top}px`;
        panelEl.style.transform = 'none';

        offsetX = ev.clientX - rect.left;
        offsetY = ev.clientY - rect.top;
        cachedWidth = panelEl.offsetWidth;
        cachedHeight = panelEl.offsetHeight;
        dragging = true;
        panelEl.classList.add('is-dragging');
      };

      const eventOptions = signal ? { signal } : false;
      dragHandle.addEventListener('pointerdown', onPointerDown, eventOptions);
      window.addEventListener('pointermove', onPointerMove, eventOptions);
      window.addEventListener('pointerup', stopDragging, eventOptions);
      window.addEventListener('blur', stopDragging, eventOptions);
    };

    /**
     * Create or retrieve the help panel element
     * @returns {HTMLElement} The help panel container element
     */
    const create = () => {
      if (panel) return panel;

      panel = document.createElement('div');
      panel.id = 'shorts-keyboard-help';
      panel.className = 'shorts-help-panel ytp-plus-shorts-overlay';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.tabIndex = -1;

      const render = () => {
        if (!panel) return;
        const p = /** @type {HTMLElement} */ (panel);
        U.renderTemplateClone(
          p,
          `
            <div class="help-topbar">
              <div class="help-header ytp-plus-settings-title">${t('keyboardShortcuts')}</div>
              <button class="ytp-plus-settings-close help-close" data-shared-close-button="ytp-plus-close-settings" type="button" aria-label="${t('closeButton')}">
                  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                  </svg>
              </button>
            </div>
            <div class="help-body">
              <div class="help-content">
                ${Object.entries(config.shortcuts)
                  .map(([action, shortcut]) => {
                    const sc = /** @type {Record<string,any>} */ (shortcut);
                    const keyVal = shortcut.key === ' ' ? 'Space' : shortcut.key;
                    return `<div class="help-item">
                    <kbd data-action="${window.YouTubeSafeDOM.escapeHTML(action)}" ${sc.editable === false ? 'class="non-editable"' : ''}>${window.YouTubeSafeDOM.escapeHTML(keyVal)}</kbd>
                    <span>${window.YouTubeSafeDOM.escapeHTML(shortcut.description)}</span>
                  </div>`;
                  })
                  .join('')}
              </div>
              <div class="help-actions">
                <button class="ytp-plus-button ytp-plus-button-primary reset-all-shortcuts">${t('resetAll')}</button>
              </div>
            </div>
          `
        );

        const helpClose = p.querySelector('.help-close');
        if (helpClose) helpClose.onclick = () => helpPanel.hide();
        const resetBtn = p.querySelector('.reset-all-shortcuts');
        if (resetBtn) {
          resetBtn.onclick = () => {
            if (confirm(t('resetAllConfirm'))) {
              const defaultShortcuts = utils.getDefaultShortcuts();
              Object.assign(config, { _shortcuts: defaultShortcuts });
              utils.saveSettings();
              feedback.show(t('shortcutsReset'));
              render();
            }
          };
        }

        p.querySelectorAll('kbd[data-action]:not(.non-editable)').forEach(kbd => {
          const kbdEl = /** @type {HTMLElement} */ (kbd);
          kbdEl.onclick = () => {
            const act = kbdEl.getAttribute('data-action') || '';
            const sc = /** @type {Record<string,any>} */ (config.shortcuts);
            editShortcut(act, sc[act]?.key || '');
          };
        });

        setupHelpContentDrag(p);
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
        dragListeners?.abort();
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
    dialog.className = 'glass-modal shortcut-edit-dialog ytp-plus-shortcut-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const sc = /** @type {Record<string,any>} */ (config.shortcuts);
    U.renderTemplateClone(
      dialog,
      `
        <div class="glass-panel shortcut-edit-content">
          <h4>${window.YouTubeSafeDOM.escapeHTML(t('editShortcut'))}: ${window.YouTubeSafeDOM.escapeHTML(sc[actionKey]?.description || actionKey)}</h4>
          <p>${window.YouTubeSafeDOM.escapeHTML(t('pressAnyKey'))}</p>
          <div class="current-shortcut">${window.YouTubeSafeDOM.escapeHTML(t('current'))}: <kbd>${window.YouTubeSafeDOM.escapeHTML(currentKey === ' ' ? 'Space' : currentKey)}</kbd></div>
          <button class="ytp-plus-button ytp-plus-button-primary shortcut-cancel" type="button">${window.YouTubeSafeDOM.escapeHTML(t('cancel'))}</button>
        </div>
      `
    );

    document.body.appendChild(dialog);
    state.editingShortcut = actionKey;

    const handleKey = /** @param {KeyboardEvent} e */ e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return cleanup();

      const conflict = Object.keys(config.shortcuts).find(
        key =>
          key !== actionKey &&
          /** @type {Record<string,any>} */ (config.shortcuts)[key]?.key === e.key
      );
      if (conflict) {
        feedback.show(t('keyAlreadyUsed', { key: e.key }));
        return;
      }

      /** @type {Record<string,any>} */ (config.shortcuts)[actionKey].key = e.key;
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

    const cancelBtn = dialog.querySelector('.shortcut-cancel');
    if (cancelBtn) cancelBtn.onclick = cleanup;
    // Use parameter destructuring to satisfy prefer-destructuring rule
    dialog.onclick = ev => {
      if (ev && ev.target === dialog) cleanup();
    };
    YouTubeUtils.cleanupManager.registerListener(
      document,
      'keydown',
      /** @type {EventListener} */ (handleKey),
      true
    );
  };

  /**
   * Register Shorts keyboard-control styles via the canonical style system.
   * Uses design-system.js getStyle(...) + StyleManager.add so the CSS is
   * owned by the shared host (`#youtube-plus-styles`) and stays in sync
   * with other modules. The byId('shorts-keyboard-styles') guard preserves
   * compatibility with users upgrading from a pre-canonical version of
   * this module that injected a raw `<style id="shorts-keyboard-styles">`
   * element.
   * @returns {void}
   */
  const addStyles = () => {
    const styles = window.YouTubePlusDesignSystem?.getStyle?.('shorts-keyboard-styles') || '';
    const SM = YouTubeUtils?.StyleManager;
    if (SM && typeof SM.add === 'function') {
      SM.add('shorts-keyboard-styles', styles);
    }
  };

  /**
   * Remove Shorts download button if it exists
   */
  const removeShortsDownloadButton = () => {
    if (state.downloadButton?.isConnected) {
      state.downloadButton.remove();
    }
    state.downloadButton = null;
  };

  /**
   * Ensure Shorts download button is visible and wired
   */
  const ensureShortsDownloadButton = () => {
    if (!isOnShortsPage()) {
      removeShortsDownloadButton();
      return;
    }

    const globalSettings = /** @type {{ enableDownload?: boolean }|undefined} */ (
      window.youtubePlus?.settings
    );
    if (globalSettings?.enableDownload === false) {
      removeShortsDownloadButton();
      return;
    }

    const getActiveReel = () =>
      qs('ytd-reel-video-renderer[is-active]') ||
      qs('ytd-reel-video-renderer[is-active="true"]') ||
      qs('#shorts-player ytd-reel-video-renderer');

    const findActionBar = () => {
      const activeReel = getActiveReel();

      const selectors = [
        'ytwReelActionBarViewModelHostDesktop',
        'ytwReelActionBarViewModelHost',
        '[class*="ytwReelActionBarViewModelHostDesktop"]',
        '[class*="ytwReelActionBarViewModelHost"]',
        '.ytwReelActionBarViewModelHostDesktop',
        '.ytwReelActionBarViewModelHost',
        'reel-action-bar-view-model',
        'ytd-reel-player-overlay-renderer #actions',
        '#actions',
      ];

      /** @param {ParentNode} root */
      const pickFrom = root => {
        for (const selector of selectors) {
          const nodes = root.querySelectorAll(selector);
          for (const node of nodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.offsetParent !== null) return node;
          }
        }
        return null;
      };

      if (activeReel instanceof Element) {
        const fromActive = pickFrom(activeReel);
        if (fromActive) return fromActive;
      }

      const fromDocument = pickFrom(document);
      if (fromDocument) return fromDocument;

      if (activeReel instanceof Element) {
        for (const selector of selectors) {
          const candidate = activeReel.querySelector(selector);
          if (candidate instanceof HTMLElement) return candidate;
        }
      }

      return null;
    };

    /** @param {Element} actionBar */
    const findLikeButton = actionBar => {
      if (!(actionBar instanceof Element)) return null;
      const likeSelectors = [
        'like-button-view-model',
        '#like-button',
        'button[aria-label*="Like" i]',
        'button[aria-label*="Нравится" i]',
      ];
      for (const selector of likeSelectors) {
        const node = actionBar.querySelector(selector);
        if (node instanceof HTMLElement) return node;
      }
      return null;
    };

    const findLikeButtonFallback = () => {
      const likeSelectors = [
        'like-button-view-model',
        '#like-button',
        'button[aria-label*="Like" i]',
        'button[aria-label*="Нравится" i]',
      ];

      const activeReel = getActiveReel();
      if (activeReel instanceof Element) {
        for (const selector of likeSelectors) {
          const node = activeReel.querySelector(selector);
          if (node instanceof HTMLElement && node.offsetParent !== null) return node;
        }
      }

      for (const selector of likeSelectors) {
        const node = document.querySelector(selector);
        if (node instanceof HTMLElement && node.offsetParent !== null) return node;
      }

      return null;
    };

    const actionBar = findActionBar();
    const likeButton = actionBar ? findLikeButton(actionBar) : findLikeButtonFallback();
    const likeAnchor =
      likeButton?.closest(
        'like-button-view-model, #like-button, reel-action-view-model, ytw-reel-action-view-model, [class*="ReelActionViewModel"]'
      ) || likeButton;
    if (!(actionBar || likeAnchor)) return;

    if (
      state.downloadButton?.isConnected &&
      likeAnchor instanceof Element &&
      state.downloadButton.nextElementSibling === likeAnchor
    ) {
      return;
    }

    if (state.downloadButton?.isConnected) {
      state.downloadButton.remove();
      state.downloadButton = null;
    }

    const btn = document.createElement('button');
    btn.className = 'ytp-plus-shorts-download';
    btn.type = 'button';
    btn.setAttribute('aria-label', t('download'));
    btn.setAttribute('title', t('downloadOptions') || t('download'));
    U.renderTemplateClone(
      btn,
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="0.5" d="M3 15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 3V16M12 16L16 11.625M12 16L8 11.625" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
    );

    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();

      if (typeof window.YouTubePlusDownload?.openModal === 'function') {
        window.YouTubePlusDownload.openModal();
        return;
      }

      feedback.show(t('directDownloadModuleNotAvailable') || t('downloadNotAvailable'));
    });

    if (likeAnchor instanceof Element && likeAnchor.parentElement) {
      likeAnchor.insertAdjacentElement('beforebegin', btn);
    } else if (actionBar) {
      actionBar.prepend(btn);
    } else {
      return;
    }
    state.downloadButton = btn;
  };

  /**
   * Main keyboard event handler for Shorts controls
   * Routes keypress events to appropriate actions
   * @param {KeyboardEvent} e - The keyboard event
   * @returns {void}
   */
  const handleKeydown = e => {
    if (
      !(config.enabled && utils.isInShortsPage()) ||
      utils.isInputFocused() ||
      state.editingShortcut
    ) {
      return;
    }

    let { key } = e;
    if (e.code === 'NumpadAdd') key = '+';
    else if (e.code === 'NumpadSubtract') key = '-';

    const action = Object.keys(config.shortcuts).find(
      k => /** @type {Record<string,any>} */ (config.shortcuts)[k]?.key === key
    );
    if (action && /** @type {Record<string,any>} */ (actions)[action]) {
      e.preventDefault();
      e.stopPropagation();
      /** @type {Record<string,any>} */ (actions)[action]();
    }
  };

  /**
   * Check if current route is /shorts page
   * @returns {boolean} True if on /shorts/* route
   */
  const isOnShortsPage = () => location.pathname.startsWith('/shorts/');

  /**
   * Cleanup when leaving shorts page
   */
  const cleanup = () => {
    if (!state.initialized) return;

    // Remove help panel if visible
    if (state.helpVisible) {
      helpPanel.hide();
    }

    // Clear any pending timeouts
    if (state.actionTimeout) {
      clearTimeout(state.actionTimeout);
      state.actionTimeout = null;
    }

    // Clear cached video
    state.cachedVideo = null;

    if (state.downloadObserver) {
      state.downloadObserver.disconnect();
      state.downloadObserver = null;
    }
    state.downloadEnsureQueued = false;

    removeShortsDownloadButton();

    state.initialized = false;
  };

  /**
   * Initialize the Shorts keyboard controls module
   * Sets up event listeners and styles
   * @returns {void}
   */
  const init = () => {
    // Strict route guard
    if (!isOnShortsPage()) return;
    if (state.initialized) return;

    state.initialized = true;
    utils.loadSettings();
    addStyles();
    ensureShortsDownloadButton();

    if (!state.downloadObserver) {
      state.downloadObserver = new MutationObserver(() => {
        if (!isOnShortsPage()) return;
        if (state.downloadEnsureQueued) return;
        state.downloadEnsureQueued = true;
        requestAnimationFrame(() => {
          state.downloadEnsureQueued = false;
          ensureShortsDownloadButton();
        });
      });

      state.downloadObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
      if (YouTubeUtils.cleanupManager?.registerObserver) {
        YouTubeUtils.cleanupManager.registerObserver(state.downloadObserver);
      }
    }

    YouTubeUtils.cleanupManager.registerListener(
      document,
      'keydown',
      /** @type {EventListener} */ (handleKeydown),
      true
    );

    // Prefer destructuring the event parameter
    const clickHandler = /** @param {Event} ev */ ev => {
      const tgt = ev.target instanceof Element ? ev.target : null;
      if (state.helpVisible && tgt?.closest && !tgt.closest('#shorts-keyboard-help')) {
        helpPanel.hide();
      }
    };
    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler);

    YouTubeUtils.cleanupManager.registerListener(
      document,
      'keydown',
      /** @type {EventListener} */ (
        /** @param {KeyboardEvent} e */ e => {
          if (e.key === 'Escape' && state.helpVisible) {
            e.preventDefault();
            helpPanel.hide();
          }
        }
      )
    );
  };

  // Route watcher to cleanup when leaving /shorts
  const observeRoute = () => {
    let lastPath = location.pathname;
    let isCurrentlyOnShorts = isOnShortsPage();

    const syncRouteState = () => {
      const currentPath = location.pathname;
      // Quick path check first before expensive isOnShortsPage()
      if (currentPath === lastPath) return;

      lastPath = currentPath;
      const nowOnShorts = isOnShortsPage();

      if (nowOnShorts !== isCurrentlyOnShorts) {
        isCurrentlyOnShorts = nowOnShorts;

        if (!nowOnShorts && state.initialized) {
          // Left shorts page
          cleanup();
        } else if (nowOnShorts && !state.initialized) {
          // Entered shorts page
          init();
        }
      } else if (nowOnShorts) {
        ensureShortsDownloadButton();
      }
    };

    if (YouTubeUtils.cleanupManager?.registerListener) {
      YouTubeUtils.cleanupManager.registerListener(window, 'yt-navigate-finish', syncRouteState);
      YouTubeUtils.cleanupManager.registerListener(window, 'popstate', syncRouteState);
    } else {
      window.addEventListener('yt-navigate-finish', syncRouteState);
      window.addEventListener('popstate', syncRouteState);
    }
  };

  let shortsRuntimeStarted = false;
  const startShortsRuntime = () => {
    if (shortsRuntimeStarted) return;
    shortsRuntimeStarted = true;

    // Initialize if on shorts page
    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          init();
          observeRoute();
        },
        { once: true }
      );
    } else {
      init();
      observeRoute();
    }

    // Show help tip on first visit
    if (isOnShortsPage() && !localStorage.getItem('shorts_keyboard_help_shown')) {
      setTimeout_(() => {
        if (isOnShortsPage()) {
          feedback.show('Press ? for shortcuts');
          localStorage.setItem('shorts_keyboard_help_shown', 'true');
        }
      }, 2000);
    }
  };

  if (U?.whenRelevant) {
    U.whenRelevant({
      name: 'shorts',
      isRelevant: isOnShortsPage,
      onEnter: startShortsRuntime,
    });
  } else {
    if (isOnShortsPage()) startShortsRuntime();
  }
})();
