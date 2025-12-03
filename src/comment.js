/**
 * Comment Manager Module
 * Provides bulk delete functionality and comment management tools for YouTube
 * @module CommentManager
 */
(function () {
  'use strict';

  // Internationalization (i18n) system
  const i18n = {
    en: {
      commentManager: 'Comment Manager',
      deleteSelected: 'Delete Selected',
      selectAll: 'Select All',
      clearAll: 'Clear All',
      selectComment: 'Select comment',
      togglePanel: 'Toggle panel',
      commentManagerControls: 'Comment manager controls',
      commentManagement: 'Comment Management',
      enableCommentManager: 'Enable comment manager',
      bulkDeleteDescription: 'Add checkboxes and bulk delete functionality to your comments',
    },
    ru: {
      commentManager: 'Менеджер комментариев',
      deleteSelected: 'Удалить выбранные',
      selectAll: 'Выбрать все',
      clearAll: 'Очистить все',
      selectComment: 'Выбрать комментарий',
      togglePanel: 'Переключить панель',
      commentManagerControls: 'Управление менеджером комментариев',
      commentManagement: 'Управление комментариями',
      enableCommentManager: 'Включить менеджер комментариев',
      bulkDeleteDescription: 'Добавить чекбоксы и функцию массового удаления к вашим комментариям',
    },
  };

  // Get browser language
  function getLanguage() {
    const lang = document.documentElement.lang || navigator.language || 'en';
    return lang.startsWith('ru') ? 'ru' : 'en';
  }

  // Translation function: prefer central i18n (embedded) when available,
  // otherwise fall back to module-local translations (keeps existing en/ru behavior).
  function t(key, params = {}) {
    try {
      if (typeof window !== 'undefined') {
        // Prefer explicit YouTubePlusI18n if present
        if (window.YouTubePlusI18n && typeof window.YouTubePlusI18n.t === 'function') {
          return window.YouTubePlusI18n.t(key, params);
        }
        // Otherwise, prefer YouTubeUtils.t if available
        if (window.YouTubeUtils && typeof window.YouTubeUtils.t === 'function') {
          return window.YouTubeUtils.t(key, params);
        }
      }
    } catch {
      // ignore and fall back to local i18n
    }

    const lang = getLanguage();
    const str = (i18n[lang] && i18n[lang][key]) || i18n.en[key] || key;
    if (!params || Object.keys(params).length === 0) return str;
    let result = str;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
  }

  /**
   * Configuration object for comment manager
   * @const {Object}
   */
  const CONFIG = {
    selectors: {
      deleteButtons: 'div[class^="VfPpkd-Bz112c-"]',
      menuButton: '[aria-haspopup="menu"]',
    },
    classes: {
      checkbox: 'comment-checkbox',
      checkboxAnchor: 'comment-checkbox-anchor',
      checkboxFloating: 'comment-checkbox-floating',
      container: 'comment-controls-container',
      panel: 'comment-controls-panel',
      header: 'comment-controls-header',
      title: 'comment-controls-title',
      actions: 'comment-controls-actions',
      button: 'comment-controls-button',
      buttonDanger: 'comment-controls-button--danger',
      buttonPrimary: 'comment-controls-button--primary',
      buttonSuccess: 'comment-controls-button--success',
      close: 'comment-controls-close',
      deleteButton: 'comment-controls-button-delete',
    },
    debounceDelay: 100,
    deleteDelay: 200,
    enabled: true,
    storageKey: 'youtube_comment_manager_settings',
  };

  // State management
  const state = {
    observer: null,
    isProcessing: false,
    settingsNavListenerKey: null,
    panelCollapsed: false,
  };

  // Optimized settings
  const settings = {
    load: () => {
      try {
        const saved = localStorage.getItem(CONFIG.storageKey);
        if (saved) CONFIG.enabled = JSON.parse(saved).enabled ?? true;
      } catch {}
    },
    save: () => {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({ enabled: CONFIG.enabled }));
      } catch {}
    },
  };

  // Utility functions: use shared debounce when available
  const debounce = (func, wait) => {
    try {
      const utilDebounce = window.YouTubeUtils && window.YouTubeUtils.debounce;
      if (typeof utilDebounce === 'function') {
        // Call the util to get a debounced function (instead of returning the util itself)
        const debounced = utilDebounce(func, wait);
        if (typeof debounced === 'function') return debounced;
        // If utilDebounce didn't return a function, fall back to local implementation
      }

      return ((f, w) => {
        let timeout;
        return (...args) => {
          clearTimeout(timeout);
          timeout = setTimeout(() => f(...args), w);
        };
      })(func, wait);
    } catch {
      // fallback
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    }
  };

  /**
   * Safely query a single element
   * @param {string} selector - CSS selector
   * @returns {HTMLElement|null} The first matching element or null
   */
  const $ = selector => /** @type {HTMLElement|null} */ (document.querySelector(selector));

  /**
   * Safely query multiple elements
   * @param {string} selector - CSS selector
   * @returns {NodeListOf<HTMLElement>} NodeList of matching elements
   */
  const $$ = selector =>
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(selector));

  /**
   * Log error with error boundary integration
   * @param {string} context - Error context
   * @param {Error|string|unknown} error - Error object or message
   */
  const logError = (context, error) => {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    if (window.YouTubeErrorBoundary) {
      window.YouTubeErrorBoundary.logError(errorObj, { context });
    } else {
      console.error(`[YouTube+][CommentManager] ${context}:`, error);
    }
  };

  /**
   * Wraps function with error boundary protection
   * @template {Function} T
   * @param {T} fn - Function to wrap
   * @param {string} context - Error context for debugging
   * @returns {T} Wrapped function
   */
  const withErrorBoundary = (fn, context) => {
    if (window.YouTubeErrorBoundary?.withErrorBoundary) {
      return /** @type {T} */ (window.YouTubeErrorBoundary.withErrorBoundary(fn, 'CommentManager'));
    }
    return /** @type {any} */ (
      (...args) => {
        try {
          return fn(...args);
        } catch (error) {
          logError(context, error);
          return null;
        }
      }
    );
  };

  /**
   * Add checkboxes to comment elements for selection
   * Core functionality for bulk operations
   */
  const addCheckboxes = withErrorBoundary(() => {
    if (!CONFIG.enabled || state.isProcessing) return;

    const deleteButtons = $$(CONFIG.selectors.deleteButtons);

    deleteButtons.forEach(button => {
      const parent = button.parentNode;
      if (
        button.closest(CONFIG.selectors.menuButton) ||
        (parent && parent.querySelector && parent.querySelector(`.${CONFIG.classes.checkbox}`))
      ) {
        return;
      }

      const commentElement =
        button.closest('[class*="comment"]') || button.closest('[role="article"]') || parent;

      if (commentElement && commentElement instanceof Element) {
        if (!commentElement.hasAttribute('data-comment-text')) {
          commentElement.setAttribute(
            'data-comment-text',
            (commentElement.textContent || '').toLowerCase()
          );
        }
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = `${CONFIG.classes.checkbox} ytp-plus-settings-checkbox`;
      checkbox.setAttribute('aria-label', t('selectComment'));

      checkbox.addEventListener('change', updateDeleteButtonState);
      checkbox.addEventListener('click', e => e.stopPropagation());

      // Optimized positioning
      const dateElement =
        commentElement && commentElement.querySelector
          ? commentElement.querySelector(
              '[class*="date"],[class*="time"],time,[title*="20"],[aria-label*="ago"]'
            )
          : null;

      if (dateElement && dateElement instanceof Element) {
        dateElement.classList.add(CONFIG.classes.checkboxAnchor);
        checkbox.classList.add(CONFIG.classes.checkboxFloating);
        dateElement.appendChild(checkbox);
      } else if (parent && parent.insertBefore) {
        parent.insertBefore(checkbox, button);
      }
    });
  }, 'addCheckboxes');

  /**
   * Add control panel with bulk action buttons
   */
  const addControlButtons = withErrorBoundary(() => {
    if (!CONFIG.enabled || $(`.${CONFIG.classes.container}`)) return;

    const deleteButtons = $$(CONFIG.selectors.deleteButtons);
    if (!deleteButtons.length) return;

    const first = deleteButtons[0];
    const container = first && first.parentNode && first.parentNode.parentNode;
    if (!container || !(container instanceof Element)) return;

    const panel = document.createElement('div');
    panel.className = `${CONFIG.classes.container} ${CONFIG.classes.panel} glass-panel`;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', t('commentManagerControls'));

    const header = document.createElement('div');
    header.className = CONFIG.classes.header;

    const title = document.createElement('div');
    title.className = CONFIG.classes.title;
    title.textContent = t('commentManager');

    const collapseButton = document.createElement('button');
    collapseButton.className = `${CONFIG.classes.close} ytp-plus-settings-close`;
    collapseButton.setAttribute('type', 'button');
    collapseButton.setAttribute('aria-expanded', String(!state.panelCollapsed));
    collapseButton.setAttribute('aria-label', t('togglePanel'));
    collapseButton.innerHTML = `
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
        </svg>
      `;

    const togglePanelState = collapsed => {
      state.panelCollapsed = collapsed;
      header.classList.toggle('is-collapsed', collapsed);
      actions.classList.toggle('is-hidden', collapsed);
      collapseButton.setAttribute('aria-expanded', String(!collapsed));
      panel.classList.toggle('is-collapsed', collapsed);
    };

    collapseButton.addEventListener('click', () => {
      state.panelCollapsed = !state.panelCollapsed;
      togglePanelState(state.panelCollapsed);
    });

    header.append(title, collapseButton);

    const actions = document.createElement('div');
    actions.className = CONFIG.classes.actions;

    const createActionButton = (label, className, onClick, options = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = `${CONFIG.classes.button} ${className}`;
      if (options.id) button.id = options.id;
      if (options.disabled) button.disabled = true;
      button.addEventListener('click', onClick);
      return button;
    };

    const deleteAllButton = createActionButton(
      t('deleteSelected'),
      `${CONFIG.classes.buttonDanger} ${CONFIG.classes.deleteButton}`,
      deleteSelectedComments,
      { disabled: true }
    );

    const selectAllButton = createActionButton(t('selectAll'), CONFIG.classes.buttonPrimary, () => {
      $$(`.${CONFIG.classes.checkbox}`).forEach(cb => (cb.checked = true));
      updateDeleteButtonState();
    });

    const clearAllButton = createActionButton(t('clearAll'), CONFIG.classes.buttonSuccess, () => {
      $$(`.${CONFIG.classes.checkbox}`).forEach(cb => (cb.checked = false));
      updateDeleteButtonState();
    });

    actions.append(deleteAllButton, selectAllButton, clearAllButton);
    togglePanelState(state.panelCollapsed);

    panel.append(header, actions);

    const refNode = deleteButtons[0] && deleteButtons[0].parentNode;
    if (refNode && refNode.parentNode) {
      container.insertBefore(panel, refNode);
    } else {
      container.appendChild(panel);
    }
  }, 'addControlButtons');

  /**
   * Update delete button state based on checkbox selection
   */
  const updateDeleteButtonState = withErrorBoundary(() => {
    const deleteAllButton = $(`.${CONFIG.classes.deleteButton}`);
    if (!deleteAllButton) return;

    const hasChecked = Array.from($$(`.${CONFIG.classes.checkbox}`)).some(cb => cb.checked);
    deleteAllButton.disabled = !hasChecked;
    deleteAllButton.style.opacity = hasChecked ? '1' : '0.6';
  }, 'updateDeleteButtonState');

  /**
   * Delete selected comments with confirmation
   */
  const deleteSelectedComments = withErrorBoundary(() => {
    const checkedBoxes = Array.from($$(`.${CONFIG.classes.checkbox}`)).filter(cb => cb.checked);

    if (!checkedBoxes.length || !confirm(`Delete ${checkedBoxes.length} comment(s)?`)) return;

    state.isProcessing = true;
    checkedBoxes.forEach((checkbox, index) => {
      setTimeout(() => {
        const deleteButton =
          checkbox.nextElementSibling ||
          checkbox.parentNode.querySelector(CONFIG.selectors.deleteButtons);
        deleteButton?.click();
      }, index * CONFIG.deleteDelay);
    });

    setTimeout(() => (state.isProcessing = false), checkedBoxes.length * CONFIG.deleteDelay + 1000);
  }, 'deleteSelectedComments');

  /**
   * Clean up all comment manager elements
   */
  const cleanup = withErrorBoundary(() => {
    $$(`.${CONFIG.classes.checkbox}`).forEach(el => el.remove());
    $(`.${CONFIG.classes.container}`)?.remove();
  }, 'cleanup');

  /**
   * Initialize or cleanup script based on enabled state
   */
  const initializeScript = withErrorBoundary(() => {
    if (CONFIG.enabled) {
      addCheckboxes();
      addControlButtons();
      updateDeleteButtonState();
    } else {
      cleanup();
    }
  }, 'initializeScript');

  /**
   * Add enhanced CSS styles for comment manager UI
   */
  const addStyles = withErrorBoundary(() => {
    if ($('#comment-delete-styles')) return;

    const styles = `
  .${CONFIG.classes.checkboxAnchor}{position:relative;display:inline-flex;align-items:center;gap:8px;width:auto;}
        .${CONFIG.classes.checkboxFloating}{position:absolute;top:-4px;right:-32px;margin:0;}
        /* Panel styled to match shorts feedback: glassmorphism, rounded corners, soft shadow */
        .${CONFIG.classes.panel}{position:fixed;top:50%;right:24px;transform:translateY(-50%);display:flex;flex-direction:column;gap:14px;z-index:10000;padding:16px 18px;background:var(--yt-glass-bg);border:1.5px solid var(--yt-glass-border);border-radius:20px;box-shadow:0 12px 40px rgba(0,0,0,0.45);backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%);min-width:220px;max-width:300px;color:var(--yt-text-primary);transition:transform .22s cubic-bezier(.4,0,.2,1),opacity .22s,box-shadow .2s}
        html:not([dark]) .${CONFIG.classes.panel}{background:var(--yt-glass-bg);}
        .${CONFIG.classes.header}{display:flex;align-items:center;justify-content:space-between;gap:12px;}
        .${CONFIG.classes.panel}.is-collapsed{padding:14px 18px;}
        .${CONFIG.classes.panel}.is-collapsed .${CONFIG.classes.title}{font-weight:500;opacity:.85;}
        .${CONFIG.classes.panel}.is-collapsed .${CONFIG.classes.close}{transform:rotate(45deg);}
        .${CONFIG.classes.panel}.is-collapsed .${CONFIG.classes.actions}{display:none!important;}
        .${CONFIG.classes.title}{font-size:15px;font-weight:600;letter-spacing:.3px;}
        .${CONFIG.classes.close}{background:transparent;border:none;cursor:pointer;padding:6px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--yt-text-primary);transition:all .2s ease;}
        .${CONFIG.classes.close}:hover{transform:rotate(90deg) scale(1.05);color:var(--yt-accent);}
        .${CONFIG.classes.actions}{display:flex;flex-direction:column;gap:10px;}
        .${CONFIG.classes.actions}.is-hidden{display:none!important;}
        .${CONFIG.classes.button}{padding:12px 16px;border-radius:var(--yt-radius-md);border:1px solid var(--yt-glass-border);cursor:pointer;font-size:13px;font-weight:500;background:var(--yt-button-bg);color:var(--yt-text-primary);transition:all .2s ease;text-align:center;}
        .${CONFIG.classes.button}:disabled{opacity:.5;cursor:not-allowed;}
        .${CONFIG.classes.button}:not(:disabled):hover{transform:translateY(-1px);box-shadow:var(--yt-shadow);}
        .${CONFIG.classes.buttonDanger}{background:rgba(255,99,71,.12);border-color:rgba(255,99,71,.25);color:#ff5c5c;}
        .${CONFIG.classes.buttonPrimary}{background:rgba(33,150,243,.12);border-color:rgba(33,150,243,.25);color:#2196f3;}
        .${CONFIG.classes.buttonSuccess}{background:rgba(76,175,80,.12);border-color:rgba(76,175,80,.25);color:#4caf50;}
        .${CONFIG.classes.buttonDanger}:not(:disabled):hover{background:rgba(255,99,71,.22);}
        .${CONFIG.classes.buttonPrimary}:not(:disabled):hover{background:rgba(33,150,243,.22);}
        .${CONFIG.classes.buttonSuccess}:not(:disabled):hover{background:rgba(76,175,80,.22);}
        @media(max-width:1280px){
          .${CONFIG.classes.panel}{top:auto;bottom:24px;transform:none;right:16px;}
        }
        @media(max-width:768px){
          .${CONFIG.classes.panel}{position:fixed;left:16px;right:16px;bottom:16px;top:auto;transform:none;max-width:none;}
          .${CONFIG.classes.actions}{flex-direction:row;flex-wrap:wrap;}
          .${CONFIG.classes.button}{flex:1;min-width:140px;}
        }
      `;
    YouTubeUtils.StyleManager.add('comment-delete-styles', styles);
  }, 'addStyles');

  /**
   * Add comment manager settings to YouTube+ settings panel
   */
  const addCommentManagerSettings = withErrorBoundary(() => {
    const advancedSection = $('.ytp-plus-settings-section[data-section="advanced"]');
    if (!advancedSection) return;

    // If already exists, move it to the bottom to ensure Comment Manager is last
    const existing = $('.comment-manager-settings-item');
    if (existing) {
      try {
        advancedSection.appendChild(existing);
      } catch {
        // ignore
      }
      return;
    }

    const settingsItem = document.createElement('div');
    settingsItem.className = 'ytp-plus-settings-item comment-manager-settings-item';
    settingsItem.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">${t('commentManagement')}</label>
          <div class="ytp-plus-settings-item-description">${t('bulkDeleteDescription')}</div>
        </div>
        <button class="ytp-plus-button" id="open-comment-history-page" style="margin:0 0 0 30px;padding:12px 16px;font-size:13px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15,3 21,3 21,9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      `;

    // Append to end (ensure it's the bottom-most item)
    advancedSection.appendChild(settingsItem);

    $('#open-comment-history-page').addEventListener('click', () => {
      window.open('https://www.youtube.com/feed/history/comment_history', '_blank');
    });
  }, 'addCommentManagerSettings');

  /**
   * Initialize comment manager module
   * Sets up observers, event listeners, and initial state
   */
  const init = withErrorBoundary(() => {
    settings.load();
    addStyles();

    // Setup observer with throttling
    state.observer?.disconnect();
    state.observer = new MutationObserver(debounce(initializeScript, CONFIG.debounceDelay));

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(state.observer);

    // ✅ Safe observe with document.body check
    if (document.body) {
      state.observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        state.observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    // Initial setup
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeScript);
    } else {
      initializeScript();
    }

    // Settings modal integration
    const settingsObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
            setTimeout(addCommentManagerSettings, 100);
            return;
          }
        }
      }
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(settingsObserver);

    // ✅ Safe observe with document.body check
    if (document.body) {
      settingsObserver.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        settingsObserver.observe(document.body, { childList: true, subtree: true });
      });
    }

    const handleAdvancedNavClick = e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (target.dataset?.section === 'advanced') {
        setTimeout(addCommentManagerSettings, 50);
      }
    };

    if (!state.settingsNavListenerKey) {
      state.settingsNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
        document,
        'click',
        handleAdvancedNavClick,
        { passive: true, capture: true }
      );
    }
  }, 'init');

  // Start the module
  init();
})();
