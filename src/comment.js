/**
 * Comment Manager Module
 * Provides bulk delete functionality and comment management tools for YouTube
 * @module CommentManager
 */
// Shared listener helper for both comment IIFEs (same file, same realm). It
// resolves YouTubeUtils at call time; `utils.js` and `cleanup-manager.js` load
// before this module, so the manager is available when it runs.
/**
 * @param {EventTarget} target
 * @param {string} event
 * @param {EventListener} handler
 * @param {AddEventListenerOptions} [options]
 * @returns {symbol | null}
 */
function registerListenerSafe(target, event, handler, options) {
  return window.YouTubeUtils.cleanupManager.registerListener(target, event, handler, options);
}
(function () {
  /**
   * Translation helper - uses centralized i18n system
   * @param {string} key - Translation key
   * @param {Object} params - Interpolation parameters
   * @returns {string} Translated string
   */
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'CommentTranslate');
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
    const lang = U.getLanguage() || 'en';
    return `https://myactivity.google.com/page?hl=${encodeURIComponent(lang)}&utm_medium=web&utm_source=youtube&page=youtube_comments`;
  })();

  const isTrustedMyActivityHost = () => {
    const host = String(location.hostname || '').toLowerCase();
    return host === 'myactivity.google.com' || host.endsWith('.myactivity.google.com');
  };

  const isMyActivityCommentsPage = () => {
    if (!isTrustedMyActivityHost()) return false;
    const params = new URLSearchParams(location.search || '');
    return params.get('page') === 'youtube_comments';
  };

  const isMyActivityHost = () => isTrustedMyActivityHost();

  const canRunCommentManagerRuntime = isMyActivityHost();

  /** @param {string} cssText */
  const addStyleBlock = cssText => {
    const StyleManager = U?.StyleManager;
    if (StyleManager && typeof StyleManager.add === 'function') {
      StyleManager.add('comment-delete-styles', cssText);
    }
  };

  // Optimized settings
  const settings = {
    load: () => {
      try {
        const saved = U.storage?.getItem(CONFIG.storageKey);
        if (saved) CONFIG.enabled = JSON.parse(saved).enabled ?? true;
      } catch (_e) {
        logS(_e);
      }
    },
    save: () => {
      try {
        U.storage?.setItem(CONFIG.storageKey, JSON.stringify({ enabled: CONFIG.enabled }));
      } catch (_e) {
        logS(_e);
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

  /** Shared error-boundary wrapper for this module's flows. */
  const withErrorBoundary = U.createWithErrorBoundary('CommentManager');

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

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = `${CONFIG.classes.checkbox} yp-settings-checkbox`;
      checkbox.setAttribute('aria-label', t('selectComment'));

      registerListenerSafe(
        checkbox,
        'change',
        /** @type {EventListener} */ (updateDeleteButtonState)
      );
      registerListenerSafe(
        checkbox,
        'click',
        /** @type {EventListener} */ (e => e.stopPropagation())
      );

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
    collapseButton.className = `${CONFIG.classes.close} yp-settings-close`;
    collapseButton.setAttribute('type', 'button');
    collapseButton.setAttribute('aria-expanded', String(!state.panelCollapsed));
    collapseButton.setAttribute('aria-label', t('togglePanel'));
    U.renderTemplateClone(
      collapseButton,
      `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
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

    registerListenerSafe(
      collapseButton,
      'click',
      /** @type {EventListener} */ (
        () => {
          state.panelCollapsed = !state.panelCollapsed;
          togglePanelState(state.panelCollapsed);
        }
      )
    );

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
      registerListenerSafe(button, 'click', /** @type {EventListener} */ (onClick));
      return button;
    };

    const deleteAllButton = createActionButton(
      t('deleteSelected'),
      `${CONFIG.classes.buttonDanger} ${CONFIG.classes.deleteButton}`,
      deleteSelectedComments,
      { disabled: true }
    );

    const selectAllButton = createActionButton(t('selectAll'), CONFIG.classes.buttonPrimary, () => {
      $$(`.${CONFIG.classes.checkbox}`).forEach(cb => {
        /** @type {HTMLInputElement} */ (cb).checked = true;
      });
      updateDeleteButtonState();
    });

    const clearAllButton = createActionButton(t('clearAll'), CONFIG.classes.buttonSuccess, () => {
      $$(`.${CONFIG.classes.checkbox}`).forEach(cb => {
        /** @type {HTMLInputElement} */ (cb).checked = false;
      });
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

    const hasChecked = Array.from($$(`.${CONFIG.classes.checkbox}`)).some(
      cb => /** @type {HTMLInputElement} */ (cb).checked
    );
    deleteAllButton.disabled = !hasChecked;
    deleteAllButton.style.opacity = hasChecked ? '1' : '0.6';
  }, 'updateDeleteButtonState');

  /**
   * Delete selected comments with confirmation
   */
  const deleteSelectedComments = withErrorBoundary(async () => {
    const checkedBoxes = Array.from($$(`.${CONFIG.classes.checkbox}`)).filter(
      cb => /** @type {HTMLInputElement} */ (cb).checked
    );

    if (!checkedBoxes.length) return;

    // own focus-trapped dialog instead of the page-blocking
    // native confirm; the message goes through the dictionary interpolation.
    const confirmed = await U.confirmDialog({
      message: t('deleteCommentsConfirm', { count: checkedBoxes.length }),
      confirmLabel: t('confirm'),
      cancelLabel: t('cancel'),
    });
    if (!confirmed) return;

    state.isProcessing = true;
    checkedBoxes.forEach((checkbox, index) => {
      setTimeout(() => {
        const deleteButton =
          checkbox.nextElementSibling ||
          checkbox.parentElement?.querySelector(CONFIG.selectors.deleteButtons) ||
          null;
        /** @type {HTMLElement | null} */ (deleteButton)?.click();
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
    const styles = window.YouTubePlusDesignSystem?.getStyle?.('comment-delete-styles') || '';
    addStyleBlock(styles);
  }, 'addStyles');

  /**
   * Attach click handler to the static Comment Manager button in settings modal
   */
  const attachSettingsHandler = () => {
    const btn = document.getElementById('open-comment-history-page');
    if (!btn) return;
    if (btn.dataset.handlerAttached) return;
    btn.dataset.handlerAttached = 'true';
    registerListenerSafe(
      btn,
      'click',
      /** @type {EventListener} */ (
        () => {
          if (typeof U?.openSafe === 'function') {
            U.openSafe(COMMENT_HISTORY_URL, '_blank');
          } else {
            window.open(COMMENT_HISTORY_URL, '_blank', 'noopener,noreferrer');
          }
        }
      )
    );
  };

  const initSettingsIntegration = () => {
    if (state.settingsIntegrationInitialized) return;
    state.settingsIntegrationInitialized = true;

    registerListenerSafe(document, 'youtube-plus-settings-modal-opened', () => {
      attachSettingsHandler();
    });

    /** @param {Event} e */
    const handleExperimentalNavClick = e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      const navItem = /** @type {HTMLElement | null} */ (
        target?.closest?.('.yp-settings-nav-item')
      );
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
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'DOMContentLoaded',
        initializeScript,
        undefined,
        true
      );
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

  window.YouTubePlusComment ||= /** @type {YouTubePlusComment} */ ({});
  // Test-only surface: internal manager steps live here, not on the facade
  // root, so the public API stays limited to observable behavior.
  U?.exposeTestHooks?.(window.YouTubePlusComment, {
    isMyActivityCommentsPage,
    isTrustedMyActivityHost,
    isMyActivityHost,
    settings,
    CONFIG,
    addCheckboxes,
    addControlButtons,
    deleteSelectedComments,
    updateDeleteButtonState,
  });
})();

// Comment Translation Button
// Restores the "Translate to ..." button that YouTube removed from comments.
(function () {
  const U = window.YouTubeUtils;
  // The translate button belongs to YouTube comment threads, not to the
  // myactivity comment-history page.
  if (window.YouTubePlusHostPolicy?.hostClass?.() === 'myactivity') return;
  const t = U?.t || (k => k);
  const logger = U?.logger || null;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'Comment');

  const TRANSLATE_BTN_CLASS = 'yp-comment-translate-btn';
  const TRANSLATED_ATTR = 'data-yp-translated';
  const ORIGINAL_ATTR = 'data-yp-original-text';
  const TRANSLATE_STYLE_ID = 'yp-comment-translate-styles';
  const TRANSLATE_WATCH_ID = 'comment::translateComments';
  const _setSafeHTML = U?.setSafeHTML;
  const setTimeout_ = setTimeout;

  // FeatureLifecycle contract (feature-registry.js): translateCtx exists only
  // while the setting is on; every translate resource is released with it.
  /** @type {YouTubePlusFeatureContext | null} */
  let translateCtx = null;
  /** @type {string | null} */
  let translateObserver = null;
  /** @type {(() => void) | null} */
  let processRelease = null;
  // Translation requests started from a button click; aborted when the
  // feature stops so a late response cannot reach the page.
  /** @type {Set<AbortController>} */
  const translateAbortControllers = new Set();

  const $ = (/** @type {string} */ sel) => U.$(sel);
  const $$ = (/** @type {string} */ sel) => U.$$(sel);

  /** @type {Record<string, string>} */
  const LANG_MAP = {
    ng: 'en',
    // BCP 47 language codes
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

  /** @param {unknown} code */
  const toGoogleLang = code => {
    if (!code) return 'en';
    const lower = String(code).toLowerCase();
    if (LANG_MAP[lower]) return LANG_MAP[lower];
    const base = lower.split('-')[0];
    return LANG_MAP[base] || base || 'en';
  };

  const getUserLanguage = () => toGoogleLang(U?.getLanguage?.());

  /** Upper bound on the translated text accepted from the service. */
  const TRANSLATE_MAX_LENGTH = 5000;

  /**
   * Extract the translated text from a Google Translate payload. Returns null
   * when the shape is not the expected nested array of segments, a segment is
   * not a string, or the joined text is longer than the limit.
   * @param {unknown} data
   * @returns {string | null}
   */
  const parseTranslatePayload_ = data => {
    if (!Array.isArray(data)) return null;
    const segments = data[0];
    if (!Array.isArray(segments) || segments.length === 0) return null;
    let out = '';
    for (const segment of segments) {
      if (!Array.isArray(segment) || typeof segment[0] !== 'string') return null;
      out += segment[0];
    }
    if (out.length > TRANSLATE_MAX_LENGTH) return null;
    return out;
  };

  /**
   * Fetch a translation. An optional external abort signal (the feature's
   * per-request controller) is relayed onto the internal request signal.
   */
  const translateText = async (
    /** @type {string} */ text,
    /** @type {string} */ targetLang,
    /** @type {AbortSignal | null} */ externalSignal = null
  ) => {
    const controller = new AbortController();
    const terminateRequest = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', terminateRequest, { once: true });
    }
    const timerId = setTimeout_(() => controller.abort(), 8000);
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return parseTranslatePayload_(data);
    } catch (e) {
      logS(e);
      if (/** @type {{ name?: string } | null} */ (e)?.name !== 'AbortError') {
        logger?.warn?.('CommentTranslate', 'Translation failed', e);
      }
    } finally {
      clearTimeout(timerId);
      externalSignal?.removeEventListener?.('abort', terminateRequest);
    }
    return null;
  };

  const getTranslateLabel = () => t('translateComment');
  const getShowOriginalLabel = () => t('showOriginal');

  const translateIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;

  /**
   * Drop every translate button and restore the original untranslated text
   * on translated comments. Each button's click registration is released
   * together with the element.
   */
  const removeTranslateButtons = () => {
    $$(`.${TRANSLATE_BTN_CLASS}`).forEach(btn => {
      window.YouTubePlusCleanupManager?.disconnectForElement?.(btn);
      btn.remove();
    });
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

  /**
   * Insert a translate button for one comment thread. The button and its
   * click listener belong to the running feature and go when it stops; a
   * late response cannot touch the page after that.
   * @param {Element} commentEl
   */
  const addTranslateButton = commentEl => {
    const group = translateCtx;
    if (!group) return;
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
    const translateClick = /** @type {EventListener} */ (
      async e => {
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
        const abort = new AbortController();
        translateAbortControllers.add(abort);
        const translated = await translateText(originalText, userLang, abort.signal);
        translateAbortControllers.delete(abort);

        // Once the owner context is gone (stopped, or a restart replaced it),
        // or the button left the DOM, the response must not touch the page.
        if (!(group.active && group === translateCtx && btn.isConnected)) return;

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
      }
    );
    // Feature-owned click registration: it stays with the button through the
    // per-navigation sweep and is released when the feature stops.
    group.listen(btn, 'click', translateClick);

    const actionBar = commentEl.querySelector(
      '#action-buttons, ytd-comment-action-buttons-renderer, #toolbar'
    );
    if (actionBar) {
      actionBar.parentElement?.insertBefore(btn, actionBar);
    } else {
      contentEl.after(btn);
    }
    group.own(btn);
  };

  const processComments = () => {
    if (!translateCtx) return;
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

  /** Debounce button processing through the feature's timer budget. */
  const scheduleProcess = () => {
    const ctx = translateCtx;
    if (!ctx) return;
    processRelease?.();
    processRelease = ctx.timeout(processComments, 300);
  };

  /**
   * Detect comment nodes appearing in a mutation batch.
   * @param {MutationRecord[]} mutations
   * @returns {boolean}
   */
  const mutationHasNewComments = mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (
          node.matches?.(
            'ytd-comment-view-model, ytd-comment-renderer, ytd-comment-thread-renderer'
          ) ||
          node.querySelector?.('ytd-comment-view-model, ytd-comment-renderer, #content-text')
        ) {
          return true;
        }
      }
    }
    return false;
  };

  /** Re-process comments after SPA navigation; lazy comment loads flow through the watch. */
  const handleNavigate = () => {
    const isVideoPage = location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
    if (!isVideoPage) return;
    scheduleProcess();
  };

  /** @param {YouTubePlusFeatureContext} ctx */
  const startTranslate = ctx => {
    translateCtx = ctx;
    ctx.onDispose(() => {
      for (const controller of translateAbortControllers) controller.abort();
      translateAbortControllers.clear();
    });
    ctx.style(
      TRANSLATE_STYLE_ID,
      window.YouTubePlusDesignSystem?.getStyle?.(TRANSLATE_STYLE_ID) || ''
    );
    processComments();

    const commentsContainer = $('#comments, #tab-comments, #content');
    const target = commentsContainer || document.body;
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.watchTarget) {
      translateObserver = TRANSLATE_WATCH_ID;
      ctx.onDispose(() => stopTranslateObserver());
      coordinator.watchTarget(
        translateObserver,
        target,
        (/** @type {MutationRecord[]} */ mutations) => {
          if (mutationHasNewComments(mutations)) scheduleProcess();
        },
        { childList: true, attributes: false, subtree: true }
      );
    }

    ctx.listen(window, 'yt-navigate-finish', handleNavigate, { passive: true });
  };

  const stopTranslate = () => {
    stopTranslateObserver();
    removeTranslateButtons();
    processRelease = null;
    translateCtx = null;
  };

  const commentTranslateFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'commentTranslate',
    settingsKey: 'enableCommentTranslate',
    // Translation buttons belong to comment sections on video pages only.
    routes: ['watch', 'shorts'],
    start: startTranslate,
    stop: stopTranslate,
  });

  // Starts the feature when its setting is on, then follows the setting.
  U.onDomReady(() => commentTranslateFeature?.sync());

  // The translate IIFE may run before the manager IIFE, so its hook call
  // carries the existing bag with it.
  window.YouTubePlusComment ||= /** @type {YouTubePlusComment} */ ({});
  const facade = window.YouTubePlusComment;
  U?.exposeTestHooks?.(facade, {
    ...facade.testHooks,
    addTranslateButton,
    processComments,
    removeTranslateButtons,
  });
})();
