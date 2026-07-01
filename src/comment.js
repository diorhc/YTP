/**
 * Comment Manager Module
 * Provides bulk delete functionality and comment management tools for YouTube
 * @module CommentManager
 */
(function () {
  /**
   * Translation helper - uses centralized i18n system
   * @param {string} key - Translation key
   * @param {Object} params - Interpolation parameters
   * @returns {string} Translated string
   */
  const U = window.YouTubeUtils;
  const { t, logger: commentLogger } = U?.helpers ?? {};

  /**
   * Configuration object for comment manager
   * @const {Object}
   */
  const CONFIG = {
    selectors: {
      deleteButtons:
        'div[class^="VfPpkd-Bz112c-"], button[aria-label*="Delete"], button[aria-label*="Удалить"], button[aria-label*="Remove"]',
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
  /** @type {{ observer: MutationObserver | null, isProcessing: boolean, settingsNavListenerKey: symbol | null, panelCollapsed: boolean, initialized: boolean, settingsIntegrationInitialized: boolean, rootSubId: string | null, navSubId: string | null }} */
  const state = {
    observer: null,
    isProcessing: false,
    settingsNavListenerKey: null,
    panelCollapsed: false,
    initialized: false,
    settingsIntegrationInitialized: false,
    rootSubId: null,
    navSubId: null,
  };

  const COMMENT_HISTORY_URL = (() => {
    let lang = 'en';
    try {
      lang = U.getLanguage();
    } catch (_e) {
      U.logSuppressed(_e, 'Comment');
    }
    return `https://myactivity.google.com/page?hl=${encodeURIComponent(lang)}&utm_medium=web&utm_source=youtube&page=youtube_comments`;
  })();

  const isTrustedMyActivityHost = () => {
    const host = String(location.hostname || '').toLowerCase();
    return host === 'myactivity.google.com' || host.endsWith('.myactivity.google.com');
  };

  const isMyActivityCommentsPage = () => {
    try {
      if (!isTrustedMyActivityHost()) return false;
      const params = new URLSearchParams(location.search || '');
      return params.get('page') === 'youtube_comments';
    } catch (_e) {
      return false;
    }
  };

  const isMyActivityHost = () => {
    try {
      return isTrustedMyActivityHost();
    } catch (_e) {
      return false;
    }
  };

  const canRunCommentManagerRuntime = isMyActivityHost();

  /**
   * @param {EventTarget} target
   * @param {string} event
   * @param {EventListener} handler
   * @param {AddEventListenerOptions} [options]
   * @returns {symbol | null}
   */
  const registerListenerSafe = (target, event, handler, options) => {
    try {
      if (U?.cleanupManager) {
        return U.cleanupManager.registerListener(target, event, handler, options);
      }
    } catch (_e) {
      U.logSuppressed(_e, 'Comment');
    }
    try {
      target.addEventListener(event, handler, options);
    } catch (_e) {
      U.logSuppressed(_e, 'Comment');
    }
    return null;
  };

  /** @param {string} cssText */
  const addStyleBlock = cssText => {
    try {
      const StyleManager = U?.StyleManager;
      if (StyleManager && typeof StyleManager.add === 'function') {
        StyleManager.add('comment-delete-styles', cssText);
      }
    } catch (e) {
      commentLogger?.warn?.('CommentManager', 'Failed to inject comment delete styles', e);
    }
  };

  // Optimized settings
  const settings = {
    load: () => {
      try {
        const saved = localStorage.getItem(CONFIG.storageKey);
        if (saved) CONFIG.enabled = JSON.parse(saved).enabled ?? true;
      } catch (_e) {
        U.logSuppressed(_e, 'Comment');
      }
    },
    save: () => {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({ enabled: CONFIG.enabled }));
      } catch (_e) {
        U.logSuppressed(_e, 'Comment');
      }
    },
  };

  // Shared debounce from YouTubeUtils
  const debounce = U.debounce;

  // Shared DOM helpers from YouTubeUtils
  /** @param {string} sel */
  const $ = sel => U.$(sel);
  /** @param {string} sel */
  const $$ = sel => U.$$(sel);

  /**
   * Log error with error boundary integration
   * @param {string} context - Error context
   * @param {Error|string|unknown} error - Error object or message
   */
  const logError = (context, error) => {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    if (window.YouTubePlusErrorBoundary) {
      window.YouTubePlusErrorBoundary.logError(errorObj, { context });
    } else {
      commentLogger?.error?.('CommentManager', context, error);
    }
  };

  /**
   * Wraps function with error boundary protection
   * @template {Function} T
   * @param {T} fn - Function to wrap
   * @param {string} context - Error context for debugging
   * @returns {T} Wrapped function
   */
  // Use shared withErrorBoundary from YouTubePlusErrorBoundary
  const withErrorBoundary = (fn, context) => {
    if (window.YouTubePlusErrorBoundary?.withErrorBoundary) {
      return /** @type {any} */ (
        window.YouTubePlusErrorBoundary.withErrorBoundary(
          /** @type {(...args: unknown[]) => unknown} */ (/** @type {unknown} */ (fn)),
          'CommentManager'
        )
      );
    }
    /** @param {...any} args */
    const fallback = (...args) => {
      try {
        return fn(...args);
      } catch (e) {
        logError(context, e);
        return null;
      }
    };
    return /** @type {any} */ (fallback);
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
        parent?.querySelector?.(`.${CONFIG.classes.checkbox}`)
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
      const dateElement = commentElement?.querySelector
        ? commentElement.querySelector(
            '[class*="date"],[class*="time"],time,[title*="20"],[aria-label*="ago"]'
          )
        : null;

      if (dateElement && dateElement instanceof Element) {
        dateElement.classList.add(CONFIG.classes.checkboxAnchor);
        checkbox.classList.add(CONFIG.classes.checkboxFloating);
        dateElement.appendChild(checkbox);
      } else if (parent?.insertBefore) {
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
    const container = first?.parentNode?.parentNode;
    if (!(container && container instanceof Element)) return;

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
    U.renderTemplateClone(
      collapseButton,
      `
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
        </svg>
      `
    );

    /** @param {boolean} collapsed */
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

    /**
     * @param {string} label
     * @param {string} className
     * @param {() => void} onClick
     * @param {{ id?: string, disabled?: boolean }} [options]
     */
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

    const refNode = deleteButtons[0]?.parentNode;
    if (refNode?.parentNode) {
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
    if (!(deleteAllButton instanceof HTMLButtonElement)) return;

    const hasChecked = Array.from($$(`.${CONFIG.classes.checkbox}`)).some(cb => cb.checked);
    deleteAllButton.disabled = !hasChecked;
    deleteAllButton.style.opacity = hasChecked ? '1' : '0.6';
  }, 'updateDeleteButtonState');

  /**
   * Delete selected comments with confirmation
   */
  const deleteSelectedComments = withErrorBoundary(() => {
    const checkedBoxes = Array.from($$(`.${CONFIG.classes.checkbox}`)).filter(cb => cb.checked);

    if (!(checkedBoxes.length && confirm(`Delete ${checkedBoxes.length} comment(s)?`))) return;

    state.isProcessing = true;
    checkedBoxes.forEach((checkbox, index) => {
      setTimeout(() => {
        const deleteButton =
          checkbox.nextElementSibling ||
          checkbox.parentElement?.querySelector(CONFIG.selectors.deleteButtons) ||
          null;
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
    const styles = `
  .${CONFIG.classes.checkboxAnchor}{position:relative;display:inline-flex;align-items:center;gap:8px;width:auto;}
        .${CONFIG.classes.checkboxFloating}{position:absolute;top:-4px;right:-32px;margin:0;}
        /* Panel styled to match shorts feedback: glassmorphism, rounded corners, soft shadow */
        .${CONFIG.classes.panel}{position:fixed;top:50%;right:24px;transform:translateY(-50%);display:flex;flex-direction:column;gap:14px;z-index:10000;padding:16px 18px;background:var(--yt-glass-bg);border:1.5px solid var(--yt-glass-border);border-radius:20px;box-shadow:var(--yt-glass-shadow);backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%);min-width:220px;max-width:300px;color:var(--yt-text-primary);transition:transform .22s cubic-bezier(.4,0,.2,1),opacity .22s,box-shadow .2s}
        html[data-ytp-theme="light"] .${CONFIG.classes.panel},html:not([dark]):not([data-ytp-theme="dark"]) .${CONFIG.classes.panel}{background:var(--yt-glass-bg);}
        .${CONFIG.classes.header}{display:flex;align-items:center;justify-content:space-between;gap:12px;}
        .${CONFIG.classes.panel}.is-collapsed{padding:14px 18px;}
        .${CONFIG.classes.panel}.is-collapsed .${CONFIG.classes.title}{font-weight:500;opacity:.85;}
        .${CONFIG.classes.panel}.is-collapsed .${CONFIG.classes.close}{transform:rotate(45deg);}
        .${CONFIG.classes.panel}.is-collapsed .${CONFIG.classes.actions}{display:none!important;}
        .${CONFIG.classes.title}{font-size:15px;font-weight:600;letter-spacing:.3px;}
        .${CONFIG.classes.close}{background:transparent;border:none;cursor:pointer;padding:6px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--yt-text-primary);transition:transform .2s cubic-bezier(0.2,0,0,1),color .2s cubic-bezier(0.2,0,0,1);}
        .${CONFIG.classes.close}:hover{transform:rotate(90deg) scale(1.05);color:var(--yt-accent);}
        .${CONFIG.classes.close}:active{transform:rotate(90deg) scale(0.96) !important;}
        .${CONFIG.classes.actions}{display:flex;flex-direction:column;gap:10px;}
        .${CONFIG.classes.actions}.is-hidden{display:none!important;}
        .${CONFIG.classes.button}{padding:12px 16px;border-radius:var(--yt-radius-md);border:1px solid var(--yt-glass-border);cursor:pointer;font-size:13px;font-weight:500;background:var(--yt-button-bg);color:var(--yt-text-primary);transition:background-color .2s cubic-bezier(0.2,0,0,1),border-color .2s cubic-bezier(0.2,0,0,1),color .2s cubic-bezier(0.2,0,0,1),transform .1s cubic-bezier(0.2,0,0,1),box-shadow .2s cubic-bezier(0.2,0,0,1);text-align:center;}
        .${CONFIG.classes.button}:disabled{opacity:.5;cursor:not-allowed;}
        .${CONFIG.classes.button}:not(:disabled):hover{transform:translateY(-1px);box-shadow:var(--yt-shadow);}
        .${CONFIG.classes.button}:not(:disabled):active{transform:scale(0.96) !important;}
        .${CONFIG.classes.buttonDanger}{background:var(--yt-danger-soft);border-color:var(--yt-danger-border);color:var(--yt-danger-text);}
        .${CONFIG.classes.buttonPrimary}{background:var(--yt-primary-soft);border-color:var(--yt-primary-border);color:var(--yt-primary-text);}
        .${CONFIG.classes.buttonSuccess}{background:var(--yt-success-soft);border-color:var(--yt-success);color:var(--yt-success);}
        .${CONFIG.classes.buttonDanger}:not(:disabled):hover{background:var(--yt-danger-soft-hover);}
        .${CONFIG.classes.buttonPrimary}:not(:disabled):hover{background:var(--yt-primary-soft-hover);}
        .${CONFIG.classes.buttonSuccess}:not(:disabled):hover{background:var(--yt-success-soft-hover);}
         @media(max-width:1280px){
          .${CONFIG.classes.panel}{top:auto;bottom:24px;transform:none;right:16px;}
        }
        @media(max-width:768px){
          .${CONFIG.classes.panel}{position:fixed;left:16px;right:16px;bottom:16px;top:auto;transform:none;max-width:none;}
          .${CONFIG.classes.actions}{flex-direction:row;flex-wrap:wrap;}
          .${CONFIG.classes.button}{flex:1;min-width:140px;}
        }
      `;
    addStyleBlock(styles);
  }, 'addStyles');

  /**
   * Attach click handler to the static Comment Manager button in settings modal
   */
  const attachSettingsHandler = () => {
    try {
      const btn = document.getElementById('open-comment-history-page');
      if (!btn) return;
      if (btn.dataset.handlerAttached) return;
      btn.dataset.handlerAttached = 'true';
      btn.addEventListener('click', () => {
        window.open(COMMENT_HISTORY_URL, '_blank');
      });
    } catch (_e) {
      // non-critical
    }
  };

  const initSettingsIntegration = () => {
    if (state.settingsIntegrationInitialized) return;
    state.settingsIntegrationInitialized = true;

    document.addEventListener('youtube-plus-settings-modal-opened', () => {
      attachSettingsHandler();
    });

    /** @param {Event} e */
    const handleExperimentalNavClick = e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      const navItem = target?.closest?.('.ytp-plus-settings-nav-item');
      if (navItem?.dataset?.section === 'experimental') {
        attachSettingsHandler();
      }
    };

    if (!state.settingsNavListenerKey) {
      state.settingsNavListenerKey = registerListenerSafe(
        document,
        'click',
        handleExperimentalNavClick,
        { passive: true, capture: true }
      );
    }
  };

  /**
   * Initialize comment manager module
   * Sets up observers, event listeners, and initial state
   */
  const init = withErrorBoundary(() => {
    // Early exit if already initialized to prevent duplicate work
    if (state.initialized) return;

    settings.load();
    addStyles();

    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.subscribeRoot) {
      if (!state.rootSubId) {
        state.rootSubId = coordinator.subscribeRoot(
          'comment-manager-runtime',
          debounce(initializeScript, CONFIG.debounceDelay),
          { selector: '#comments, #content' }
        );
      }
    } else {
      commentLogger?.warn?.('CommentManager', 'MutationCoordinator unavailable');
    }

    // Initial setup
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeScript);
    } else {
      initializeScript();
    }

    initSettingsIntegration();
  }, 'init');

  /**
   * Check if current route is relevant for comment manager
   * @returns {boolean} True if on My Activity comments page
   */
  const isRelevantRoute = () => {
    return isMyActivityCommentsPage();
  };

  /**
   * Schedule lazy initialization with route checking
   */
  const scheduleInit = () => {
    if (state.initialized || !isRelevantRoute()) return;

    requestIdleCallback(
      () => {
        if (!state.initialized && isRelevantRoute()) {
          init();
          state.initialized = true;
        }
      },
      { timeout: 2000 }
    );
  };

  initSettingsIntegration();

  if (canRunCommentManagerRuntime) {
    // Navigation observer to trigger lazy init
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.subscribeRoot) {
      if (!state.navSubId) {
        state.navSubId = coordinator.subscribeRoot(
          'comment-manager-navigation',
          debounce(() => {
            if (!state.initialized && isRelevantRoute()) {
              scheduleInit();
            }
            if (state.initialized && state.navSubId) {
              coordinator.unsubscribe(state.navSubId);
              state.navSubId = null;
            }
          }, 300),
          { selector: 'body' }
        );
      }
    } else {
      commentLogger?.warn?.('CommentManager', 'MutationCoordinator unavailable');
    }

    if (U?.whenRelevant) {
      U.whenRelevant({
        name: 'comment.manager',
        isRelevant: isRelevantRoute,
        onEnter: scheduleInit,
      });
    } else {
      scheduleInit();
    }
  }
})();

// Comment Translation Button
// Restores the "Translate to ..." button that YouTube removed from comments.
(function () {
  const U = window.YouTubeUtils;
  const t = U?.t || (k => k);
  const logger = U?.logger || null;

  const TRANSLATE_BTN_CLASS = 'ytp-comment-translate-btn';
  const TRANSLATED_ATTR = 'data-ytp-translated';
  const ORIGINAL_ATTR = 'data-ytp-original-text';
  const SETTINGS_KEY = U?.SETTINGS_KEY || 'youtube_plus_settings';
  const _setSafeHTML = U?.setSafeHTML;
  const setTimeout_ = setTimeout;

  /** @type {string | null} */
  let translateObserver = null;

  const $ = (/** @type {string} */ sel) => U.$(sel);
  const $$ = (/** @type {string} */ sel) => U.$$(sel);

  /** @type {Record<string, string>} */
  const LANG_MAP = {
    ng: 'en',
    // Canonical BCP 47 codes
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    ko: 'ko',
    ja: 'ja',
    nl: 'nl',
    be: 'be',
    bg: 'bg',
    kk: 'kk',
    ky: 'ky',
    uz: 'uz',
    uk: 'uk',
    'zh-hans': 'zh-CN',
    'zh-hant': 'zh-TW',
    'zh-cn': 'zh-CN',
    'zh-tw': 'zh-TW',
    'zh-hk': 'zh-TW',
    iw: 'he',
    jv: 'jw',
    'sr-latn': 'sr',
    'pt-br': 'pt',
    'pt-pt': 'pt',
    ar: 'ar',
    az: 'az',
    cs: 'cs',
    da: 'da',
    de: 'de',
    el: 'el',
    en: 'en',
    es: 'es',
    fi: 'fi',
    fr: 'fr',
    hi: 'hi',
    hr: 'hr',
    hu: 'hu',
    id: 'id',
    it: 'it',
    lt: 'lt',
    lv: 'lv',
    ms: 'ms',
    no: 'no',
    pl: 'pl',
    ro: 'ro',
    ru: 'ru',
    sk: 'sk',
    sl: 'sl',
    sq: 'sq',
    sv: 'sv',
    th: 'th',
    tr: 'tr',
    vi: 'vi',
  };

  const toGoogleLang = (/** @type {any} */ code) => {
    if (!code) return 'en';
    const lower = String(code).toLowerCase();
    if (LANG_MAP[lower]) return LANG_MAP[lower];
    const base = lower.split('-')[0];
    return LANG_MAP[base] || base || 'en';
  };

  const getUserLanguage = () => {
    try {
      return toGoogleLang(U?.getLanguage?.());
    } catch (_e) {
      return toGoogleLang(navigator.language) || 'en';
    }
  };

  const translateText = async (/** @type {string} */ text, /** @type {string} */ targetLang) => {
    const controller = new AbortController();
    const timerId = setTimeout_(() => controller.abort(), 8000);
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        return data[0].map((/** @type {any} */ s) => s?.[0] || '').join('');
      }
    } catch (e) {
      if (/** @type {any} */ (e)?.name !== 'AbortError') {
        logger?.warn?.('CommentTranslate', 'Translation failed', e);
      }
    } finally {
      clearTimeout(timerId);
    }
    return null;
  };

  const getTranslateLabel = () => t('translateComment');
  const getShowOriginalLabel = () => t('showOriginal');

  const injectStyles = (() => {
    let injected = false;
    return () => {
      if (injected) return;
      injected = true;
      const css = `
        .${TRANSLATE_BTN_CLASS}{
          display:inline-flex;align-items:center;gap:4px;
          background:none;border:none;cursor:pointer;
          color:var(--yt-text-secondary);
          font-size:1.2rem;line-height:1.8rem;font-weight:400;
          padding:4px 0;margin-top:4px;
          font-family:'Roboto','Arial',sans-serif;
          transition:color .2s;
        }
        .${TRANSLATE_BTN_CLASS}:hover{color:var(--yt-text-primary);}
        .${TRANSLATE_BTN_CLASS}[disabled]{opacity:.5;cursor:wait;}
        .${TRANSLATE_BTN_CLASS} svg{flex-shrink:0;}
      `;
      try {
        const StyleManager = U?.StyleManager;
        if (StyleManager && typeof StyleManager.add === 'function') {
          StyleManager.add('ytp-comment-translate-styles', css);
        }
      } catch (e) {
        logger?.warn?.('CommentTranslate', 'Failed to inject translate styles', e);
      }
    };
  })();

  const translateIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;

  const isCommentTranslateEnabled = (settings = null) => {
    try {
      const currentSettings =
        settings ||
        /** @type {any} */ (window).youtubePlus?.settings ||
        (() => {
          const store = /** @type {any} */ (window).YouTubePlusSettingsStore;
          if (store && typeof store.load === 'function') {
            return store.load();
          }
          const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
          return parsed && typeof parsed === 'object' ? parsed : {};
        })();
      return currentSettings?.enableCommentTranslate !== false;
    } catch (_e) {
      return true;
    }
  };

  const removeTranslateButtons = () => {
    $$(`.${TRANSLATE_BTN_CLASS}`).forEach(btn => btn.remove());
    $$(`[${TRANSLATED_ATTR}][${ORIGINAL_ATTR}]`).forEach(node => {
      const original = node.getAttribute(ORIGINAL_ATTR);
      if (original) node.textContent = original;
      node.removeAttribute(TRANSLATED_ATTR);
      node.removeAttribute(ORIGINAL_ATTR);
    });
  };

  const stopTranslateObserver = () => {
    if (!translateObserver) return;
    window.YouTubePlusMutationCoordinator?.unwatch?.(translateObserver);
    translateObserver = null;
  };

  const addTranslateButton = (/** @type {Element} */ commentEl) => {
    if (commentEl.querySelector(`.${TRANSLATE_BTN_CLASS}`)) return;

    const contentEl = commentEl.querySelector(
      '#content-text.ytd-comment-view-model, ' +
        '#content-text.ytd-comment-renderer, ' +
        'yt-attributed-string#content-text, ' +
        'yt-formatted-string#content-text, ' +
        '#content-text'
    );
    if (!contentEl) return;

    const text = (contentEl.textContent || '').trim();
    if (!text || text.length < 2) return;

    const userLang = getUserLanguage();
    const btn = document.createElement('button');
    btn.className = TRANSLATE_BTN_CLASS;
    btn.type = 'button';
    _setSafeHTML?.(btn, `${translateIcon} ${getTranslateLabel()}`);
    btn.setAttribute('aria-label', getTranslateLabel());

    btn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();

      if (contentEl.hasAttribute(TRANSLATED_ATTR)) {
        const original = contentEl.getAttribute(ORIGINAL_ATTR);
        if (original) {
          contentEl.textContent = original;
          contentEl.removeAttribute(TRANSLATED_ATTR);
          _setSafeHTML?.(btn, `${translateIcon} ${getTranslateLabel()}`);
          btn.setAttribute('aria-label', getTranslateLabel());
        }
        return;
      }

      btn.disabled = true;
      _setSafeHTML?.(btn, `${translateIcon} ...`);

      const originalText = contentEl.textContent || '';
      const translated = await translateText(originalText, userLang);

      if (translated && translated !== originalText) {
        contentEl.setAttribute(ORIGINAL_ATTR, originalText);
        contentEl.setAttribute(TRANSLATED_ATTR, 'true');
        contentEl.textContent = translated;
        _setSafeHTML?.(btn, `${translateIcon} ${getShowOriginalLabel()}`);
        btn.setAttribute('aria-label', getShowOriginalLabel());
      } else {
        _setSafeHTML?.(btn, `${translateIcon} ${getTranslateLabel()}`);
        btn.setAttribute('aria-label', getTranslateLabel());
      }

      btn.disabled = false;
    });

    const actionBar = commentEl.querySelector(
      '#action-buttons, ytd-comment-action-buttons-renderer, #toolbar'
    );
    if (actionBar) {
      actionBar.parentElement?.insertBefore(btn, actionBar);
    } else {
      contentEl.after(btn);
    }
  };

  const processComments = () => {
    const commentSelectors = [
      'ytd-comment-view-model',
      'ytd-comment-renderer',
      'ytd-comment-thread-renderer',
    ];
    for (const sel of commentSelectors) {
      $$(sel).forEach(node => {
        if (node instanceof Element) addTranslateButton(node);
      });
    }
  };

  /** @type {ReturnType<typeof setTimeout> | null} */
  let processTimeout = null;
  const scheduleProcess = () => {
    if (processTimeout) clearTimeout(processTimeout);
    processTimeout = setTimeout_(processComments, 300);
  };

  const startTranslateFeature = (settings = null) => {
    if (!isCommentTranslateEnabled(settings)) {
      stopTranslateObserver();
      removeTranslateButtons();
      return;
    }

    injectStyles();
    processComments();

    if (translateObserver) return;

    const commentsContainer = $('#comments, #tab-comments, #content');
    const target = commentsContainer || document.body;
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.watchTarget) {
      translateObserver = 'comment::translateComments';
      coordinator.watchTarget(
        translateObserver,
        target,
        (/** @type {MutationRecord[]} */ mutations) => {
          let hasNewComments = false;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (!(node instanceof Element)) continue;
              if (
                node.matches?.(
                  'ytd-comment-view-model, ytd-comment-renderer, ytd-comment-thread-renderer'
                ) ||
                node.querySelector?.('ytd-comment-view-model, ytd-comment-renderer, #content-text')
              ) {
                hasNewComments = true;
                break;
              }
            }
            if (hasNewComments) break;
          }
          if (hasNewComments) scheduleProcess();
        },
        { childList: true, attributes: false, subtree: true }
      );
    }
  };

  const scheduleInit = () => {
    const isVideoPage = location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
    if (!isVideoPage) return;

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => startTranslateFeature(), { timeout: 3000 });
    } else {
      setTimeout_(startTranslateFeature, 1500);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInit, { once: true });
  } else {
    scheduleInit();
  }

  window.addEventListener('yt-navigate-finish', scheduleInit, {
    passive: true,
  });
  window.addEventListener('youtube-plus-settings-updated', e => {
    const detail = /** @type {any} */ (e)?.detail;
    if (isCommentTranslateEnabled(detail)) {
      startTranslateFeature(detail);
      return;
    }
    stopTranslateObserver();
    removeTranslateButtons();
  });
})();
