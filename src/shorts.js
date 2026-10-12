// Keyboard controls and download button for YouTube Shorts.
// Public surface: window.YouTubePlusShorts (test hooks).
(function () {
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'Shorts');

  const { t, logger: shortsLogger, $: qs } = U?.helpers ?? {};
  const lifecycle = () => window.YouTubePlusFeatureRegistry?.FeatureLifecycle;

  /**
   * A user-rebindable keyboard shortcut.
   * @typedef {{ key: string, description: string, editable?: boolean }} ShortcutEntry
   */

  /**
   * Return default shortcut entries with localized descriptions.
   * @returns {Record<string, ShortcutEntry>}
   */
  const getDefaultShortcuts = () => ({
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
  });

  // `shortcuts` is a plain mutable object: loadSettings and the rebind
  // dialog write into it.
  const config = {
    shortcuts: getDefaultShortcuts(),
    storageKey: 'youtube_shorts_keyboard_settings',
  };

  const state = {
    helpVisible: false,
    /** @type {string|null} */
    lastAction: null,
    /** @type {string|null} */
    editingShortcut: null,
    /** @type {HTMLVideoElement|null} */
    cachedVideo: null,
    lastVideoCheck: 0,
  };

  /** Keyboard feature context while `shortsKeyboard` is on. @type {YouTubePlusFeatureContext | null} */
  let keysCtx = null;
  /** Group for the help panel, feedback and dialogs of the current Shorts page. @type {YouTubePlusFeatureContext | null} */
  let pageScope = null;

  /** @returns {YouTubePlusFeatureContext | null} the page group, created on first use while the feature runs */
  const page = () => {
    if (!pageScope && keysCtx) pageScope = keysCtx.scope();
    return pageScope;
  };

  /**
   * Get active video element in YouTube Shorts (cached 100ms).
   * @returns {HTMLVideoElement|null}
   */
  const getCurrentVideo = (() => {
    const selectors = ['ytd-reel-video-renderer[is-active] video', '#shorts-player video', 'video'];

    return () => {
      const now = Date.now();
      if (state.cachedVideo?.isConnected && now - state.lastVideoCheck < 100) {
        return state.cachedVideo;
      }

      for (const selector of selectors) {
        const video = qs(selector);
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

  /** Apply one stored shortcut entry when its shape is valid. */
  const applyStoredShortcut = (
    /** @type {string} */ action,
    /** @type {unknown} */ shortcut,
    /** @type {Record<string, ShortcutEntry>} */ defaults
  ) => {
    if (!defaults[action]) return;
    if (!shortcut || typeof shortcut !== 'object') return;

    const { key: sKey, editable: sEditable } = /** @type {{ key?: string, editable?: boolean }} */ (
      shortcut
    );
    if (typeof sKey === 'string' && sKey.length > 0 && sKey.length <= 20) {
      config.shortcuts[action] = {
        key: sKey,
        description: defaults[action].description,
        editable: sEditable !== false,
      };
    }
  };

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
      const el = /** @type {HTMLElement | null} */ (document.activeElement);
      return !!(
        el?.matches?.('input, textarea, [contenteditable="true"]') || el?.isContentEditable
      );
    },

    /**
     * Load settings from storage with validation
     * @returns {void}
     */
    loadSettings: () => {
      // Storage may hold corrupt text or be unavailable.
      try {
        const saved = U.storage?.getItem(config.storageKey);
        if (!saved) return;

        const parsed = JSON.parse(saved);
        if (typeof parsed !== 'object' || parsed === null) {
          shortsLogger?.warn?.('Shorts', 'Invalid settings format');
          return;
        }

        // Validate shortcuts object
        if (parsed.shortcuts && typeof parsed.shortcuts === 'object') {
          const defaultShortcuts = utils.getDefaultShortcuts();
          for (const [action, shortcut] of Object.entries(parsed.shortcuts)) {
            applyStoredShortcut(action, shortcut, defaultShortcuts);
          }
        }
      } catch (error) {
        logS(error);
        shortsLogger?.error?.('Shorts', 'Error loading settings', error);
      }
    },

    /**
     * Save settings to storage with error handling
     * @returns {void}
     */
    saveSettings: () => {
      try {
        U.storage?.setItem(config.storageKey, JSON.stringify({ shortcuts: config.shortcuts }));
      } catch (error) {
        logS(error);
        shortsLogger?.error?.('Shorts', 'Error saving settings', error);
      }
    },

    /**
     * Get default keyboard shortcuts configuration.
     * @returns {Object} Object containing default shortcut definitions
     */
    getDefaultShortcuts,
  };

  /**
   * Feedback system for displaying temporary notifications in Shorts
   * Uses glassmorphism design for visual feedback
   */
  const feedback = (() => {
    /** @type {HTMLElement|null} */
    let element = null;
    /** @type {(() => void) | null} */
    let hideRelease = null;

    /**
     * Create or retrieve the feedback element; it belongs to the page group.
     * @param {YouTubePlusFeatureContext} scope
     * @returns {HTMLElement}
     */
    const create = scope => {
      if (element?.isConnected) return element;

      element = document.createElement('div');
      element.id = 'shorts-keyboard-feedback';
      Object.assign(element.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%,-50%)',
        background: 'var(--yt-glass-bg)',
        backdropFilter: 'var(--yt-glass-blur)',
        border: '1px solid var(--yt-glass-border)',
        borderRadius: '20px',
        color: 'var(--yt-text-primary,#fff)',
        padding: '18px 32px',
        fontSize: '20px',
        fontWeight: '700',
        zIndex: '10000',
        opacity: '0',
        visibility: 'hidden',
        pointerEvents: 'none',
        transition: 'all .3s cubic-bezier(.4,0,.2,1)',
        textAlign: 'center',
        boxShadow: 'var(--yt-glass-shadow)',
      });
      element.style.setProperty('-webkit-backdrop-filter', 'var(--yt-glass-blur)');
      scope.own(element);
      document.body.appendChild(element);
      return element;
    };

    return {
      /**
       * Display a short message in the middle of the player.
       * @param {string} text
       */
      show: text => {
        const scope = page();
        if (!scope) return;
        state.lastAction = text;
        const el = create(scope);
        el.textContent = text;

        scope.frame(() => {
          el.style.opacity = '1';
          el.style.visibility = 'visible';
          el.style.transform = 'translate(-50%,-50%) scale(1.05)';
        });

        hideRelease?.();
        hideRelease = scope.timeout(() => {
          hideRelease = null;
          el.style.opacity = '0';
          el.style.visibility = 'hidden';
          el.style.transform = 'translate(-50%,-50%) scale(0.95)';
        }, 1500);
      },
    };
  })();

  /**
   * Click the first visible button whose aria-label contains one of `terms`.
   * The shorts player controls carry these labels; a hit means clicking keeps
   * the player's own UI state in sync.
   * @param {string[]} terms
   * @returns {Element|null} the clicked button, or null when nothing matched
   */
  const clickVisibleButtonByAriaTerms = terms => {
    const container =
      qs('ytd-shorts-player-controls, ytd-reel-video-renderer, #shorts-player') || document;
    const buttons = container.querySelectorAll('button[aria-label]');
    for (const b of buttons) {
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      if (
        terms.some(term => aria.includes(term)) &&
        /** @type {HTMLElement} */ (b).offsetParent !== null
      ) {
        /** @type {HTMLElement} */ (b).click();
        return b;
      }
    }
    return null;
  };

  // Optimized actions
  /** @type {Record<string, () => void>} */
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
      clickVisibleButtonByAriaTerms(['subtit', 'caption', 'субтит', 'субтитр', 'cc']);

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
      const clicked = clickVisibleButtonByAriaTerms([
        'mute',
        'unmute',
        'sound',
        'volume',
        'звук',
        'громк',
      ]);
      if (clicked) {
        // Give the player a moment to update state, then show feedback based on video.muted
        page()?.timeout(() => {
          const v = getCurrentVideo();
          if (v) feedback.show(v.muted ? '🔇' : '🔊');
        }, 60);
        return;
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
   * Help panel listing the shortcuts; a shortcut is edited by clicking it.
   * The panel belongs to the page group, so it goes with the page or the
   * feature.
   */
  const helpPanel = (() => {
    /** @type {HTMLElement|null} */
    let panel = null;
    /** Owns the panel element and its listeners. @type {YouTubePlusFeatureContext | null} */
    let panelScope = null;
    /** Drag wiring of the current render. @type {YouTubePlusFeatureContext | null} */
    let dragScope = null;
    /** @type {(() => void) | null} */
    let helpTrapCleanup = null;

    /**
     * Let the panel be dragged by its content area.
     * @param {YouTubePlusFeatureContext} owner
     * @param {HTMLElement} panelEl
     */
    const setupHelpContentDrag = (owner, panelEl) => {
      dragScope?.dispose();
      dragScope = owner.scope();
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

      dragScope.listen(dragHandle, 'pointerdown', /** @type {EventListener} */ (onPointerDown));
      dragScope.listen(window, 'pointermove', /** @type {EventListener} */ (onPointerMove));
      dragScope.listen(window, 'pointerup', stopDragging);
      dragScope.listen(window, 'blur', stopDragging);
    };

    /**
     * Create or retrieve the help panel element.
     * @param {YouTubePlusFeatureContext} scope page group
     * @returns {HTMLElement}
     */
    const create = scope => {
      if (panel?.isConnected) return panel;

      panelScope = scope.scope();
      const owner = panelScope;
      const p = document.createElement('div');
      panel = p;
      p.id = 'shorts-keyboard-help';
      p.className = 'shorts-help-panel yp-shorts-overlay';
      p.setAttribute('role', 'dialog');
      p.setAttribute('aria-modal', 'true');
      p.tabIndex = -1;

      const render = () => {
        U.renderTemplateClone(
          p,
          `
            <div class="help-topbar">
              <div class="help-header yp-settings-title">${t('keyboardShortcuts')}</div>
              <button class="yp-settings-close help-close" data-shared-close-button="yp-close-settings" type="button" aria-label="${t('closeButton')}">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
                  </svg>
              </button>
            </div>
            <div class="help-body">
              <div class="help-content">
                ${Object.entries(config.shortcuts)
                  .map(([action, shortcut]) => {
                    const keyVal = shortcut.key === ' ' ? 'Space' : shortcut.key;
                    return `<div class="help-item">
                    <kbd data-action="${window.YouTubeSafeDOM.escapeHTML(action)}" ${shortcut.editable === false ? 'class="non-editable"' : ''}>${window.YouTubeSafeDOM.escapeHTML(keyVal)}</kbd>
                    <span>${window.YouTubeSafeDOM.escapeHTML(shortcut.description)}</span>
                  </div>`;
                  })
                  .join('')}
              </div>
              <div class="help-actions">
                <button class="yp-button yp-button-primary reset-all-shortcuts">${t('resetAll')}</button>
              </div>
            </div>
          `
        );
        setupHelpContentDrag(owner, p);
      };

      // One delegated click handler survives every re-render.
      owner.listen(p, 'click', (/** @type {Event} */ ev) => {
        const target = ev.target instanceof Element ? ev.target : null;
        if (!target) return;
        if (target.closest('.help-close')) {
          helpPanel.hide();
          return;
        }
        if (target.closest('.reset-all-shortcuts')) {
          resetAll(render);
          return;
        }
        const kbd = target.closest('kbd[data-action]:not(.non-editable)');
        if (kbd) {
          const act = kbd.getAttribute('data-action') || '';
          editShortcut(act, config.shortcuts[act]?.key || '');
        }
      });

      render();
      owner.own(p);
      owner.onDispose(() => {
        helpTrapCleanup?.();
        helpTrapCleanup = null;
        dragScope = null;
        if (panel === p) {
          panel = null;
          panelScope = null;
          state.helpVisible = false;
        }
      });
      document.body.appendChild(p);
      return p;
    };

    /** @param {() => void} rerender */
    const resetAll = async rerender => {
      // own focus-trapped dialog instead of native confirm().
      const confirmed = await U.confirmDialog({
        message: t('resetAllConfirm'),
        confirmLabel: t('confirm'),
        cancelLabel: t('cancel'),
      });
      if (!(confirmed && keysCtx)) return;
      config.shortcuts = utils.getDefaultShortcuts();
      utils.saveSettings();
      feedback.show(t('shortcutsReset'));
      if (panel?.isConnected) rerender();
    };

    return {
      show: () => {
        const scope = page();
        if (!scope) return;
        const p = create(scope);
        p.classList.add('visible');
        state.helpVisible = true;
        p.focus();
        // a11y: trap Tab inside the open help dialog (shared trap).
        helpTrapCleanup?.();
        helpTrapCleanup = window.YouTubePlusModalHandlers?.createFocusTrap?.(p) || null;
      },

      hide: () => {
        panel?.classList.remove('visible');
        state.helpVisible = false;
        helpTrapCleanup?.();
        helpTrapCleanup = null;
      },

      toggle: () => (state.helpVisible ? helpPanel.hide() : helpPanel.show()),

      /** Drop the panel so the next show renders the current bindings. */
      refresh: () => {
        const wasVisible = state.helpVisible;
        panelScope?.dispose();
        if (wasVisible) helpPanel.show();
      },
    };
  })();

  /**
   * Open the dialog that rebinds one shortcut; it lives in the page group.
   * @param {string} actionKey - The action identifier to edit
   * @param {string} currentKey - The current key binding
   */
  const editShortcut = (actionKey, currentKey) => {
    const scope = page();
    if (!scope) return;
    const dialogScope = scope.scope();
    const dialog = document.createElement('div');
    dialog.className = 'glass-modal shortcut-edit-dialog yp-shortcut-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const sc = config.shortcuts;
    const esc = window.YouTubeSafeDOM.escapeHTML;
    U.renderTemplateClone(
      dialog,
      `
        <div class="glass-panel shortcut-edit-content">
          <h4>${esc(t('editShortcut'))}: ${esc(sc[actionKey]?.description || actionKey)}</h4>
          <p>${esc(t('pressAnyKey'))}</p>
          <div class="current-shortcut">${esc(t('current'))}: <kbd>${esc(currentKey === ' ' ? 'Space' : currentKey)}</kbd></div>
          <button class="yp-button yp-button-primary shortcut-cancel" type="button">${esc(t('cancel'))}</button>
        </div>
      `
    );

    dialogScope.own(dialog);
    document.body.appendChild(dialog);
    state.editingShortcut = actionKey;
    // a11y: trap Tab inside the shortcut-edit dialog while it is open.
    const dialogTrap = window.YouTubePlusModalHandlers?.createFocusTrap?.(dialog) || null;
    dialogScope.onDispose(() => {
      dialogTrap?.();
      state.editingShortcut = null;
    });
    const close = () => dialogScope.dispose();

    const handleKey = /** @param {KeyboardEvent} e */ e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        close();
        return;
      }

      const conflict = Object.keys(config.shortcuts).find(
        key => key !== actionKey && sc[key]?.key === e.key
      );
      if (conflict) {
        feedback.show(t('keyAlreadyUsed', { key: e.key }));
        return;
      }

      sc[actionKey].key = e.key;
      utils.saveSettings();
      feedback.show(t('shortcutUpdated'));
      close();
      helpPanel.refresh();
    };

    dialogScope.listen(dialog, 'click', (/** @type {Event} */ ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (ev.target === dialog || target?.closest('.shortcut-cancel')) close();
    });
    dialogScope.listen(document, 'keydown', /** @type {EventListener} */ (handleKey), true);
  };

  /**
   * Main keyboard handler while the feature runs.
   * @param {KeyboardEvent} e
   */
  const handleKeydown = e => {
    if (!isOnShortsPage() || utils.isInputFocused() || state.editingShortcut) return;

    if (e.key === 'Escape' && state.helpVisible) {
      e.preventDefault();
      helpPanel.hide();
      return;
    }

    let { key } = e;
    if (e.code === 'NumpadAdd') key = '+';
    else if (e.code === 'NumpadSubtract') key = '-';

    const action = Object.keys(config.shortcuts).find(k => config.shortcuts[k]?.key === key);
    const handler = action ? actions[action] : undefined;
    if (handler) {
      e.preventDefault();
      e.stopPropagation();
      handler();
    }
  };

  /** @param {Event} ev */
  const handleOutsideClick = ev => {
    const tgt = ev.target instanceof Element ? ev.target : null;
    if (state.helpVisible && !tgt?.closest('#shorts-keyboard-help')) helpPanel.hide();
  };

  /**
   * Check if current route is /shorts page
   * @returns {boolean} True if on /shorts/* route
   */
  const isOnShortsPage = () => location.pathname.startsWith('/shorts/');

  /** Leaving /shorts drops the help panel, feedback and dialogs of the page. */
  const syncKeysRoute = () => {
    if (isOnShortsPage()) {
      showFirstVisitTip();
      return;
    }
    pageScope?.dispose();
    pageScope = null;
    state.helpVisible = false;
  };

  const showFirstVisitTip = () => {
    if (U.storage?.getItem('shorts_keyboard_help_shown')) return;
    keysCtx?.timeout(() => {
      if (!isOnShortsPage()) return;
      feedback.show('Press ? for shortcuts');
      U.storage?.setItem('shorts_keyboard_help_shown', 'true');
    }, 2000);
  };

  const keysFeature = lifecycle()?.define?.({
    id: 'shortsKeyboard',
    settingsKey: 'shortsKeyboard',
    // Keyboard control exists only on the Shorts player pages.
    routes: ['shorts'],
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      keysCtx = ctx;
      ctx.style(
        'shorts-keyboard-styles',
        window.YouTubePlusDesignSystem?.getStyle?.('shorts-keyboard-styles') || ''
      );
      utils.loadSettings();
      ctx.listen(document, 'keydown', /** @type {EventListener} */ (handleKeydown), true);
      ctx.listen(document, 'click', handleOutsideClick);
      ctx.listen(window, 'yt-navigate-finish', syncKeysRoute);
      ctx.listen(window, 'popstate', syncKeysRoute);
      ctx.onDispose(() => {
        pageScope = null;
        state.helpVisible = false;
        state.editingShortcut = null;
      });
      syncKeysRoute();
    },
    stop() {
      keysCtx = null;
    },
  });

  // ----- Shorts download button (follows `enableDownload`) -----

  /** @type {YouTubePlusFeatureContext | null} */
  let downloadCtx = null;
  /** Group of the current /shorts page. @type {YouTubePlusFeatureContext | null} */
  let downloadPageScope = null;
  /** Group of the current button. @type {YouTubePlusFeatureContext | null} */
  let buttonScope = null;
  /** @type {HTMLElement|null} */
  let downloadButton = null;

  const openDownload = (/** @type {Event} */ ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof window.YouTubePlusDownload?.openModal === 'function') {
      window.YouTubePlusDownload.openModal();
      return;
    }
    const unavailable = t('directDownloadModuleNotAvailable');
    feedback.show(
      unavailable && unavailable !== 'directDownloadModuleNotAvailable'
        ? unavailable
        : 'Direct download module not available'
    );
  };

  /** Place the download button next to the like button of the active Short. */
  const ensureShortsDownloadButton = () => {
    if (!(downloadPageScope && isOnShortsPage())) return;

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
        'button[aria-label*="Like" i]:not([aria-label*="Dislike" i]):not(.yp-shorts-dislike-btn)',
        'button[aria-label*="Нравится" i]:not([aria-label*="Не нравится" i])',
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
        'button[aria-label*="Like" i]:not([aria-label*="Dislike" i]):not(.yp-shorts-dislike-btn)',
        'button[aria-label*="Нравится" i]:not([aria-label*="Не нравится" i])',
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
      downloadButton?.isConnected &&
      likeAnchor instanceof Element &&
      (downloadButton.nextElementSibling === likeAnchor ||
        downloadButton.nextElementSibling?.classList?.contains('shortsStats'))
    ) {
      window.YouTubePlusStats?.initVideoStats?.();
      window.YouTubePlusStats?.ensureShortsStatsButton?.();
      return;
    }

    buttonScope?.dispose();
    buttonScope = downloadPageScope.scope();
    const btn = document.createElement('button');
    btn.className = 'yp-shorts-download';
    btn.type = 'button';
    btn.setAttribute('aria-label', t('download'));
    btn.setAttribute('title', t('downloadOptions') || t('download'));
    U.renderTemplateClone(
      btn,
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="0.5" d="M3 15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 3V16M12 16L16 11.625M12 16L8 11.625" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
    );
    buttonScope.listen(btn, 'click', openDownload);
    buttonScope.own(btn);

    if (likeAnchor instanceof Element && likeAnchor.parentElement) {
      likeAnchor.insertAdjacentElement('beforebegin', btn);
    } else if (actionBar) {
      actionBar.prepend(btn);
    } else {
      buttonScope.dispose();
      buttonScope = null;
      return;
    }
    downloadButton = btn;
    window.YouTubePlusStats?.initVideoStats?.();
    window.YouTubePlusStats?.ensureShortsStatsButton?.();
  };

  /** Build or drop the per-page group when the route changes. */
  const syncDownloadRoute = () => {
    if (!isOnShortsPage()) {
      downloadPageScope?.dispose();
      downloadPageScope = null;
      return;
    }
    if (downloadPageScope) {
      ensureShortsDownloadButton();
      return;
    }
    const scope = downloadCtx?.scope();
    if (!scope) return;
    downloadPageScope = scope;
    scope.onDispose(() => {
      buttonScope = null;
      downloadButton = null;
    });

    /** @type {(() => void) | null} */
    let queued = null;
    const queueEnsure = () => {
      if (queued) return;
      queued = scope.frame(() => {
        queued = null;
        ensureShortsDownloadButton();
      });
    };
    const coordinator = window.YouTubePlusMutationCoordinator;
    const subId = 'shorts::downloadButton';
    coordinator?.subscribeRoot?.(subId, queueEnsure, {
      selector: 'ytd-shorts, #shorts-container, ytd-reel-video-renderer',
      childList: true,
      subtree: true,
      attributes: false,
    });
    scope.onDispose(() => coordinator?.unsubscribe?.(subId));
    ensureShortsDownloadButton();
  };

  const downloadFeature = lifecycle()?.define?.({
    id: 'shortsDownload',
    settingsKey: 'enableDownload',
    // The Shorts download button belongs to the Shorts player pages.
    routes: ['shorts'],
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      downloadCtx = ctx;
      ctx.listen(window, 'yt-navigate-finish', syncDownloadRoute);
      ctx.listen(window, 'popstate', syncDownloadRoute);
      syncDownloadRoute();
    },
    stop() {
      downloadCtx = null;
      downloadPageScope = null;
    },
  });

  U.onDomReady(() => {
    keysFeature?.sync();
    downloadFeature?.sync();
  });

  window.YouTubePlusShorts = {};
  // Test-only surface: internal entry points and state accessors live here,
  // not on the facade root.
  U?.exposeTestHooks?.(window.YouTubePlusShorts, {
    isOnShortsPage,
    getDefaultShortcuts,
    getSettings: () => ({ shortcuts: { ...config.shortcuts } }),
  });
})();
