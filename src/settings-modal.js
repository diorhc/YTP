/**
 * Settings Modal: builds the YouTube+ settings dialog.
 *
 * Owns modal construction (sidebar, topbar, panel, listeners) and the
 * open/restore lifecycle (submenu states, active section restore).
 * The enhancer keeps thin delegators only.
 */
(function () {
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'SettingsModal');
  /**
   * Coerce any thrown value into a real Error instance.
   * @param {unknown} e
   * @returns {Error}
   */
  const ensureErrorObject_ = e => (e instanceof Error ? e : new Error(String(e)));

  /**
   * Factory: create a storage read/write pair with unified error handling.
   * @param {string} key - storage key
   * @returns {{
   *   read: () => string,
   *   write: (value: string) => void
   * }}
   */
  function createLocalStorageFlag_(key) {
    return {
      read: () => {
        // Storage may be disabled or unreadable.
        try {
          return window.YouTubeUtils?.storage?.getItem(key) || '';
        } catch (_e) {
          logS(_e);
          return '';
        }
      },
      write: value => {
        try {
          window.YouTubeUtils?.storage?.setItem(key, value);
        } catch (_e) {
          logS(_e);
          window.YouTubePlusErrorBoundary?.logError?.(ensureErrorObject_(_e), {
            module: 'SettingsModal',
          });
        }
      },
    };
  }

  /**
   * Modal UI session-state helpers.
   *
   * These are NOT settings. They are per-session UI affordances
   * (which submenus are open, which settings tab was last viewed,
   * which settings section a bookmarklet wants to open). They use
   * a dedicated keyspace so they never collide with the settings
   * object in `youtube_plus_settings`.
   *
   * `modal-handlers.js` and `pip.js` share the same keys, so the
   * helper centralizes read/write and documents the boundary.
   * @type {{
   *   submenuStates: { read: () => Record<string, boolean>, write: (next: Record<string, boolean>) => void },
   *   activeNavSection: { read: () => string, write: (id: string) => void },
   *   lastOpenSection: { read: () => string, write: (id: string) => void },
   * }}
   */
  const basicUiState_ = {
    submenuStates: {
      read() {
        // Storage may be unavailable or hold corrupt JSON.
        try {
          const raw = window.YouTubeUtils?.storage?.getItem('ytp-plus-submenu-states');
          const parsed = raw ? JSON.parse(raw) : {};
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
          logS(e);
          YouTubePlusLogger?.warn?.('SettingsModal', 'Submenu state read failed', e);
          return {};
        }
      },
      write(/** @type {Record<string, boolean>} */ next) {
        try {
          window.YouTubeUtils?.storage?.setItem(
            'ytp-plus-submenu-states',
            JSON.stringify(next || {})
          );
        } catch (e) {
          logS(e);
          YouTubePlusLogger?.warn?.('SettingsModal', 'Submenu state write failed', e);
        }
      },
    },
    activeNavSection: createLocalStorageFlag_('ytp-plus-active-nav-section'),
    lastOpenSection: createLocalStorageFlag_('youtube_plus_last_active_section'),
  };

  /**
   * Submenu selector resolver.
   *
   * Both the click-toggle path (handleModalClick → submenu toggle) and
   * the restore-on-open path (createSettingsModal → submenu state
   * restoration) need to find the panel-relative element for a given
   * `data-submenu` key. One shared map keeps the two paths in
   * lockstep and makes future submenus a one-line addition.
   *
   * Unknown keys fall back to a generic `[data-submenu="…"]` selector
   * so feature modules can ship their own submenu cards without
   * needing a basic.js change.
   */
  const basicSubmenuSelector_ = (/** @type {string} */ key) => {
    switch (key) {
      case 'music':
        return `.music-submenu[data-submenu="${key}"]`;
      case 'download':
        return `.download-submenu[data-submenu="${key}"]`;
      case 'style':
        return `.style-submenu[data-submenu="${key}"]`;
      case 'speed':
        return `.speed-submenu[data-submenu="${key}"]`;
      case 'loop':
        return `.loop-submenu[data-submenu="${key}"]`;
      case 'pip':
        return `.pip-submenu[data-submenu="${key}"]`;
      case 'timecode':
        return `.timecode-submenu[data-submenu="${key}"]`;
      case 'enhanced':
        return `.enhanced-submenu[data-submenu="${key}"]`;
      case 'screenshot':
        return `.screenshot-submenu[data-submenu="${key}"]`;
      case 'performance-mode':
        return `.performance-mode-submenu[data-submenu="${key}"]`;
      default:
        return `[data-submenu="${key}"]`;
    }
  };

  /** Clamp a single hotkey value to a single lowercase character. */
  const basicNormalizeSingleHotkey_ = (
    /** @type {unknown} */ value,
    /** @type {string} */ fallback
  ) => {
    const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (candidate) return candidate.slice(0, 1);
    return (
      String(fallback || '')
        .trim()
        .toLowerCase()
        .slice(0, 1) || 'g'
    );
  };

  const t = (/** @type {string} */ key) => window.YouTubeUtils?.t?.(key) || key;

  /** Safe HTML assignment routed through the sanitizer. @param {HTMLElement} el @param {string} html */
  const setSafeHTML = (el, html) => {
    if (typeof window.YouTubeUtils?.setSafeHTML === 'function') {
      window.YouTubeUtils.setSafeHTML(el, html);
    } else {
      window.YouTubeSafeDOM?.setHTML?.(el, html);
    }
  };

  /**
   * Remove listener key or invoke cleanup function safely.
   * @param {symbol | (() => void) | null | undefined} cleanupKeyOrFn
   */
  function removeModalListener_(cleanupKeyOrFn) {
    if (typeof cleanupKeyOrFn === 'function') {
      // One broken disposer must not stop the remaining disposers.
      try {
        cleanupKeyOrFn();
      } catch (_e) {
        logS(_e);
      }
    } else if (cleanupKeyOrFn) {
      window.YouTubePlusCleanupManager?.unregisterListener?.(cleanupKeyOrFn);
    }
  }

  // ONE lifecycle session for the modal. Every close path (re-open,
  // Escape, close button, backdrop, external API) completes THIS
  // session, never a raw modal.remove() that bypasses the disposal.
  /** @type {{ modal: HTMLElement, close: () => void, focusTimer: ReturnType<typeof setTimeout> | null, activationTimer: ReturnType<typeof setTimeout> | null, isDisposed: () => boolean } | null} */
  let activeModalSession = null;

  /**
   * Dispose the active modal session (idempotent). Returns true when a
   * session existed and was completed.
   * @returns {boolean}
   */
  function closeActiveModal() {
    const session = activeModalSession;
    if (!session) return false;
    session.close();
    if (activeModalSession === session) activeModalSession = null;
    return true;
  }

  /** Announce that the settings modal has left the DOM. */
  function dispatchModalClosedEvent_() {
    document.dispatchEvent(
      new CustomEvent('youtube-plus-settings-modal-closed', {
        bubbles: true,
      })
    );
  }

  /**
   * Restore focus to the element that triggered the modal.
   * @param {HTMLElement|null} element
   */
  function restoreFocusToElement_(element) {
    if (element && typeof element.focus === 'function' && element.isConnected) {
      element.focus();
    }
  }

  /**
   * Check if element belongs to the non-active variant surface (Classic vs Vision).
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function isCrossThemeElement_(el) {
    const isClassic = document.documentElement.getAttribute('data-yp-variant') === 'classic';
    const selector = isClassic
      ? '.yp-settings-topbar, .yp-settings-side-actions, .yp-topbar-save'
      : '.yp-settings-classic-sidebar-footer, .yp-settings-classic-close, .yp-classic-save';
    return Boolean(el.closest(selector));
  }

  /**
   * Check if element or any ancestor inside the modal is hidden via CSS computed style.
   * @param {HTMLElement} el
   * @param {HTMLElement} modal
   * @returns {boolean}
   */
  function hasHiddenAncestor_(el, modal) {
    if (!window.getComputedStyle) return false;
    /** @type {HTMLElement | null} */
    let cur = el;
    while (cur && cur !== modal) {
      const s = window.getComputedStyle(cur);
      if (s && (s.display === 'none' || s.visibility === 'hidden')) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  /**
   * Check whether an element is truly visible and focusable inside the modal.
   * @param {HTMLElement} el
   * @param {HTMLElement} modal
   * @returns {boolean}
   */
  function isElementFocusableInModal_(el, modal) {
    if (!(el instanceof HTMLElement) || el.tabIndex < 0) return false;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('.hidden, [hidden], [inert], [aria-hidden="true"]')) return false;
    if (isCrossThemeElement_(el)) return false;
    return !hasHiddenAncestor_(el, modal);
  }

  /**
   * Return list of currently focusable, visible elements within modal.
   * @param {HTMLElement} modal
   * @returns {HTMLElement[]}
   */
  function getModalFocusableElements_(modal) {
    if (!modal.isConnected) return [];
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const nodes = Array.from(modal.querySelectorAll(selector));
    return /** @type {HTMLElement[]} */ (
      nodes.filter(el => isElementFocusableInModal_(/** @type {HTMLElement} */ (el), modal))
    );
  }

  /**
   * Focus containment handler for Tab key inside the modal dialog.
   * @param {KeyboardEvent} e
   * @param {HTMLElement} modal
   */
  function handleModalFocusContainment_(e, modal) {
    const focusable = getModalFocusableElements_(modal);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || active === modal || !modal.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !modal.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  /**
   * Helper to cancel a modal timer safely without throwing.
   * @param {ReturnType<typeof setTimeout> | null | undefined} timer
   * @returns {null}
   */
  function clearModalTimer_(timer) {
    if (timer) clearTimeout(timer);
    return null;
  }

  /**
   * Release all modal dismissal listeners and disconnect elements.
   * @param {Array<symbol | (() => void)>} disposers
   * @param {HTMLElement} modal
   */
  function cleanupModalDisposers_(disposers, modal) {
    for (const cleanup of disposers) {
      removeModalListener_(cleanup);
    }
    disposers.length = 0;
    // The dialog's subtree is discarded: release every listener other
    // modules attached inside it (section widgets, dropdowns, buttons).
    window.YouTubePlusCleanupManager?.disconnectSubtree?.(modal);
  }

  /**
   * Setup dismissal handlers (backdrop/button click, Escape key), focus containment, and focus return.
   * @param {HTMLElement} modal
   * @param {HTMLElement|null} previousActiveElement
   * @param {(() => void)|null} [i18nRefreshHandler=null] Invoked once when
   *   translations become ready, so an already-open modal never keeps raw keys.
   * @returns {() => void} closeModal function
   */
  function setupModalDismissal_(modal, previousActiveElement, i18nRefreshHandler = null) {
    let isClosed = false;
    /** @type {Array<symbol | (() => void)>} */
    const cleanupDisposers = [];
    /** @type {{ modal: HTMLElement, close: () => void, focusTimer: ReturnType<typeof setTimeout> | null, activationTimer: ReturnType<typeof setTimeout> | null, isDisposed: () => boolean }} */
    const session = {
      modal,
      close: () => {},
      focusTimer: null,
      activationTimer: null,
      isDisposed: () => isClosed,
    };

    /** @param {Event} e */
    const keydownHandler = e => {
      if (!(e instanceof KeyboardEvent)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      } else if (e.key === 'Tab') {
        handleModalFocusContainment_(e, modal);
      }
    };

    /** Idempotent single dispose for this modal instance. */
    const closeModal = () => {
      if (isClosed) return;
      isClosed = true;
      session.focusTimer = clearModalTimer_(session.focusTimer);
      session.activationTimer = clearModalTimer_(session.activationTimer);
      cleanupModalDisposers_(cleanupDisposers, modal);
      if (activeModalSession === session) activeModalSession = null;
      dispatchModalClosedEvent_();
      modal.remove();
      restoreFocusToElement_(previousActiveElement);
    };
    session.close = closeModal;
    activeModalSession = session;

    const addDismissalListener = (
      /** @type {EventTarget} */ target,
      /** @type {string} */ event,
      /** @type {EventListener} */ handler
    ) => {
      const keyOrFn =
        window.YouTubeUtils?.registerListenerSafe?.(target, event, handler) ||
        window.YouTubePlusCleanupManager?.registerListener?.(target, event, handler) ||
        null;
      if (keyOrFn !== null && (typeof keyOrFn === 'symbol' || typeof keyOrFn === 'function')) {
        cleanupDisposers.push(/** @type {symbol | (() => void)} */ (keyOrFn));
      }
    };

    addDismissalListener(window, 'keydown', keydownHandler);
    addDismissalListener(window, 'yt-navigate-start', closeModal);
    addDismissalListener(window, 'popstate', closeModal);
    // While translations are still loading, re-render the modal once they
    // become ready so an already-open dialog never keeps raw keys. The
    // listener is detached when the modal closes.
    if (i18nRefreshHandler && !window.YouTubePlusI18n?.isReady?.()) {
      addDismissalListener(window, 'youtube-plus-i18n-ready', i18nRefreshHandler);
    }

    return closeModal;
  }

  /**
   * Restore submenu expanded states from modal UI-state store.
   * @param {HTMLElement} modal
   */
  function restoreModalSubmenuStates_(modal) {
    const submenuStates = basicUiState_.submenuStates.read();
    // Submenu keys come from stored state; the derived selectors are
    // data-built and guarded together.
    try {
      Object.entries(submenuStates).forEach(([key, expanded]) => {
        const toggleBtn = modal.querySelector(`.yp-submenu-toggle[data-submenu="${key}"]`);
        if (toggleBtn instanceof HTMLElement && !toggleBtn.hasAttribute('disabled')) {
          const submenuEl = modal.querySelector(basicSubmenuSelector_(key));
          if (submenuEl instanceof HTMLElement) {
            const isExpanded = !!expanded;
            submenuEl.style.display = isExpanded ? '' : 'none';
            submenuEl.classList.toggle('is-hidden', !isExpanded);
            toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
          }
        }
      });
    } catch (_e) {
      logS(_e);
    }
  }

  /** Resolve the voting container, preferring DOMCache. */
  function getVotingContainer_() {
    const domCache = window.YouTubePlusDOMCache;
    return /** @type {HTMLElement|null} */ (
      domCache?.getElementById?.('yp-voting-container') ||
        document.getElementById('yp-voting-container')
    );
  }

  /** Recreate the voting UI when its container and facade are available. */
  function createVotingUI_(/** @type {HTMLElement|null} */ container) {
    if (container && window.YouTubePlus?.Voting) {
      window.YouTubePlus.Voting.createUI(container);
    }
  }

  /**
   * Snapshot checkbox and select values before the modal shell re-renders.
   * @param {HTMLElement} modal
   * @returns {{ checkedStates: Map<string, boolean>, selectStates: Map<string, string> }}
   */
  function captureModalFormState_(modal) {
    const checkedStates = new Map();
    const selectStates = new Map();
    for (const input of modal.querySelectorAll('input[data-setting]')) {
      if (input instanceof HTMLInputElement && input.dataset.setting) {
        checkedStates.set(input.dataset.setting, input.checked);
      }
    }
    for (const select of /** @type {NodeListOf<HTMLSelectElement>} */ (
      modal.querySelectorAll('select[data-setting]')
    )) {
      if (select.dataset.setting) {
        selectStates.set(select.dataset.setting, select.value);
      }
    }
    return { checkedStates, selectStates };
  }

  /**
   * Sync visual selection in a glass-dropdown when a hidden select changes value.
   * @param {HTMLElement|null|undefined} dd
   * @param {string} val
   */
  function syncDropdownValue_(dd, val) {
    if (!dd) return;
    const item = dd.querySelector(`.glass-dropdown__item[data-value="${val}"]`);
    if (!item) return;
    dd.querySelectorAll('.glass-dropdown__item').forEach(li => {
      li.removeAttribute('aria-selected');
    });
    item.setAttribute('aria-selected', 'true');
    const lbl = dd.querySelector('.glass-dropdown__label');
    if (lbl) lbl.textContent = item.textContent || '';
  }

  /**
   * Reapply the captured checkbox and select values after the re-render.
   * @param {HTMLElement} modal
   * @param {{ checkedStates: Map<string, boolean>, selectStates: Map<string, string> }} formState
   */
  function applyModalFormState_(modal, formState) {
    for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (
      modal.querySelectorAll('input[data-setting]')
    )) {
      const settingKey = input.dataset.setting;
      if (
        input instanceof HTMLInputElement &&
        settingKey &&
        formState.checkedStates.has(settingKey)
      ) {
        input.checked = /** @type {boolean} */ (formState.checkedStates.get(settingKey));
      }
    }
    for (const select of /** @type {NodeListOf<HTMLSelectElement>} */ (
      modal.querySelectorAll('select[data-setting]')
    )) {
      const settingKey = select.dataset.setting;
      if (settingKey && formState.selectStates.has(settingKey)) {
        const val = /** @type {string} */ (formState.selectStates.get(settingKey));
        select.value = val;
        syncDropdownValue_(select.parentElement?.querySelector('.glass-dropdown'), val);
      }
    }
  }

  /**
   * Initialize any glass-dropdown instances within the modal that have not
   * yet been initialized by their owning feature module.
   * @param {HTMLElement} modal
   */
  function initModalDropdowns_(modal) {
    const dropdowns = modal.querySelectorAll('.glass-dropdown');
    for (const dd of dropdowns) {
      if (/** @type {HTMLElement} */ (dd).dataset.ypDropdownInit) continue;
      const id = dd.id;
      let hidden = null;
      if (id?.endsWith('-dropdown')) {
        const baseId = id.slice(0, -9);
        hidden =
          modal.querySelector(`#${baseId}`) ||
          modal.querySelector(`#${baseId}-combo`) ||
          modal.querySelector(`select[id^="${baseId}"]`);
      }
      if (!hidden) {
        const parent = dd.parentElement;
        hidden = parent ? parent.querySelector('select') : null;
      }
      window.YouTubePlusDesignSystem?.initGlassDropdown?.({
        dropdown: /** @type {HTMLElement} */ (dd),
        hiddenSelect: /** @type {HTMLSelectElement|null} */ (hidden),
      });
    }
  }

  /**
   * Toggle the checkbox of a settings item row. Returns true when the row
   * carried a checkbox and the change event was dispatched.
   * @param {HTMLElement} itemRow
   * @returns {boolean}
   */
  function toggleItemRowCheckbox_(itemRow) {
    const checkbox = itemRow.querySelector('.yp-settings-checkbox');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  /**
   * Expand or collapse the submenu behind a toggling button, persisting the
   * expanded state. Returns true when the click was on (or inside) a
   * submenu toggle so callers can stop handling.
   * @param {HTMLElement} target
   * @returns {boolean}
   */
  function handleSubmenuToggle_(target) {
    const submenuToggleBtn = target.closest('.yp-submenu-toggle');
    if (!submenuToggleBtn) return false;
    // Submenu keys arrive from element data; guard the derived selectors.
    try {
      if (
        submenuToggleBtn instanceof HTMLElement &&
        submenuToggleBtn.tagName === 'BUTTON' &&
        submenuToggleBtn.hasAttribute('disabled')
      ) {
        return true;
      }
      const submenuKey = /** @type {HTMLElement} */ (submenuToggleBtn).dataset?.submenu;
      if (!submenuKey) return true;
      const panel = submenuToggleBtn.closest('.yp-settings-panel');
      if (!panel) return true;
      const submenuEl = panel.querySelector(basicSubmenuSelector_(submenuKey));
      if (!(submenuEl instanceof HTMLElement)) return true;

      const computedDisplay = window.getComputedStyle(submenuEl).display;
      const currentlyHidden =
        computedDisplay === 'none' || submenuEl.hidden || submenuEl.classList.contains('is-hidden');
      const nextHidden = !currentlyHidden;
      submenuEl.style.display = nextHidden ? 'none' : '';
      submenuEl.classList.toggle('is-hidden', nextHidden);
      submenuToggleBtn.setAttribute('aria-expanded', nextHidden ? 'false' : 'true');

      // Persist submenu expanded state to modal UI-state store
      const submenuStates = basicUiState_.submenuStates.read();
      submenuStates[submenuKey] = !nextHidden;
      basicUiState_.submenuStates.write(submenuStates);
    } catch (e) {
      logS(e);
      YouTubePlusLogger?.warn?.('SettingsModal', 'Submenu toggle error', e);
    }
    return true;
  }

  /**
   * Backdrop, close buttons, and their closest() variants.
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function isModalCloseTarget_(el) {
    return Boolean(
      el.id === 'yp-close-settings' ||
        el.id === 'yp-close-settings-classic' ||
        el.id === 'yp-close-settings-icon' ||
        el.classList.contains('yp-settings-close') ||
        el.classList.contains('yp-settings-classic-close') ||
        el.closest('.yp-settings-close') ||
        el.closest('.yp-settings-classic-close') ||
        el.closest('#yp-close-settings') ||
        el.closest('#yp-close-settings-classic') ||
        el.closest('#yp-close-settings-icon')
    );
  }

  /** External link buttons inside the modal and their destinations. */
  const MODAL_EXTERNAL_LINKS_ = {
    'open-ytdl-github': 'https://github.com/diorhc/YTDL',
    'open-ytp-github': 'https://github.com/diorhc/YTP',
    'open-ytp-discussions': 'https://github.com/diorhc/YTP/discussions',
    'open-ytp-greasyfork': 'https://greasyfork.org/en/scripts/537017-youtube',
  };

  /**
   * Open the external page when the click landed on a link button.
   * @param {HTMLElement} el
   * @returns {boolean} true when a link was opened
   */
  function openExternalLinkFromModal_(el) {
    for (const [id, url] of Object.entries(MODAL_EXTERNAL_LINKS_)) {
      if (el.id === id || el.closest(`#${id}`)) {
        if (typeof window.YouTubeUtils?.openSafe === 'function') {
          window.YouTubeUtils.openSafe(url, '_blank');
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return true;
      }
    }
    return false;
  }

  /**
   * The Basic enhancer surface the settings modal and its delegates use.
   * @typedef {{
   *   settings: YoutubePlusSettings,
   *   getElement: (selector: string, useCache?: boolean) => Element | null,
   *   insertStyles: () => void,
   *   ensureNonCriticalStyles?: () => void,
   *   handleThemeOptionsClick_: (
   *     target: HTMLElement,
   *     modal: HTMLElement,
   *     handlers: Record<string, unknown>,
   *     context: SettingsModalContext
   *   ) => boolean | undefined,
   *   handleModalClickActions: (
   *     target: HTMLElement,
   *     modal: HTMLElement,
   *     handlers: Record<string, unknown>,
   *     context: SettingsModalContext,
   *     translate: (key: string, params?: Record<string, string | number>) => string
   *   ) => void,
   *   addDownloadButton: (controls?: Element) => void,
   *   addSpeedControlButton: (controls?: Element) => void,
   *   refreshDownloadButton: () => void,
   *   updatePageBasedOnSettings: () => void,
   *   showNotification: (message: string, duration?: number) => void,
   *   saveSettings: () => void,
   * }} SettingsModalEnhancer
   */

  /**
   * Modal click dispatch: submenu toggles, theme options, dismiss targets,
   * external links, item rows, then the per-section action handler.
   * @param {HTMLElement} modal
   * @param {SettingsModalEnhancer} enhancer
   * @param {YouTubePlusModalHandlers} handlers
   * @param {SettingsModalContext} context
   * @param {Event} e
   * @param {() => void} closeModal
   */
  function handleModalClick_(modal, enhancer, handlers, context, e, closeModal) {
    const target = /** @type {HTMLElement} */ (e.target);

    // Submenu toggle buttons (e.g., YouTube Music)
    if (handleSubmenuToggle_(target)) {
      return;
    }

    if (enhancer.handleThemeOptionsClick_(target, modal, handlers, context)) {
      return;
    }

    // Close modal (backdrop or close button)
    if (target === modal || isModalCloseTarget_(target)) {
      closeModal();
      return;
    }

    // External link buttons
    if (openExternalLinkFromModal_(target)) {
      return;
    }

    // Toggle checkboxes when clicking anywhere on the settings item row
    const itemRow = /** @type {HTMLElement|null} */ (target.closest('.yp-settings-item'));
    if (
      itemRow &&
      !target.closest('input, select, button, a, .glass-dropdown, .yp-submenu-toggle')
    ) {
      if (toggleItemRowCheckbox_(itemRow)) {
        return;
      }
    }

    // Handle different actions
    enhancer.handleModalClickActions(target, modal, handlers, context, t);
  }

  /**
   * Select and checkbox change dispatch inside the modal.
   * @param {SettingsModalEnhancer} enhancer
   * @param {YouTubePlusModalHandlers} handlers
   * @param {SettingsModalContext} context
   * @param {HTMLElement} modal
   * @param {Event} e
   */
  function handleSettingsChange_(enhancer, handlers, context, modal, e) {
    const target = /** @type {HTMLElement} */ (e.target);

    // Handle select elements with data-setting
    if (target instanceof HTMLSelectElement && target.dataset?.setting) {
      const setting = target.dataset.setting;
      const rawValue = target.value;
      const numericValue = Number(rawValue);
      const parsedValue = rawValue !== '' && Number.isNaN(numericValue) ? rawValue : numericValue;
      handlers.setSettingByPath(enhancer.settings, setting, parsedValue);
      handlers.applySettingLive(setting, context);
      enhancer.saveSettings();
      return;
    }

    if (!target.classList.contains('yp-settings-checkbox')) return;

    const { dataset } = target;
    const { setting } = dataset;
    if (!setting) return;

    // Download site checkboxes
    if (setting.startsWith('downloadSite_')) {
      const key = setting.replace('downloadSite_', '');
      handlers.handleDownloadSiteToggle(
        target,
        key,
        enhancer.settings,
        enhancer.saveSettings.bind(enhancer)
      );
      return;
    }

    // YouTube Music settings - handle separately
    if (handlers.isMusicSetting?.(setting)) {
      handlers.handleMusicSettingToggle(target, setting);
      return;
    }

    // Simple settings
    handlers.handleSimpleSettingToggle(
      target,
      setting,
      enhancer.settings,
      context,
      enhancer.saveSettings.bind(enhancer),
      modal
    );
  }

  /**
   * Free-editing pass for named text inputs; hotkey inputs are excluded.
   * @param {SettingsModalEnhancer} enhancer
   * @param {YouTubePlusModalHandlers} handlers
   * @param {(key: string) => string} translator
   * @param {Event} e
   */
  function handleSettingsInput_(enhancer, handlers, translator, e) {
    const target = /** @type {HTMLElement} */ (e.target);
    if (
      target.classList.contains('speed-hotkey-input') ||
      target.classList.contains('loop-hotkey-input')
    ) {
      return;
    }

    if (target.classList.contains('download-site-input')) {
      const { site, field } = target.dataset;
      if (site && field) {
        handlers.handleDownloadSiteInput(target, site, field, enhancer.settings, translator);
      }
    }
  }

  /**
   * Persist a normalized single-character hotkey when its input blurs.
   * @param {HTMLInputElement} input
   * @param {YoutubePlusSettings} settings
   * @param {'speedControlHotkeys'|'loopHotkeys'} group
   * @param {string} keyType
   * @param {Record<string, string>} fallbacks single-char fallback per key
   * @param {Record<string, string>} defaults per-group default map
   * @returns {boolean} true when the key type was recognized and persisted
   */
  function commitHotkeyOnBlur_(input, settings, group, keyType, fallbacks, defaults) {
    if (!Object.hasOwn(fallbacks, keyType)) return false;
    const map = settings[group] || (settings[group] = { ...defaults });
    const normalized = basicNormalizeSingleHotkey_(input.value, fallbacks[keyType]);
    /** @type {Record<string, string>} */ (map)[keyType] = normalized;
    input.value = normalized;
    return true;
  }

  /**
   * Blur event dispatch: normalize hotkey inputs when editing ends.
   * @param {SettingsModalEnhancer} enhancer
   * @param {Event} e
   */
  function handleSettingsBlur_(enhancer, e) {
    const target = /** @type {HTMLElement} */ (e.target);

    if (target.classList.contains('speed-hotkey-input')) {
      if (
        commitHotkeyOnBlur_(
          /** @type {HTMLInputElement} */ (target),
          enhancer.settings,
          'speedControlHotkeys',
          target.dataset?.speedHotkey || '',
          { decrease: 'g', increase: 'h', reset: 'b' },
          { decrease: 'g', increase: 'h', reset: 'b' }
        )
      ) {
        enhancer.saveSettings();
      }
      return;
    }

    if (target.classList.contains('loop-hotkey-input')) {
      if (
        commitHotkeyOnBlur_(
          /** @type {HTMLInputElement} */ (target),
          enhancer.settings,
          'loopHotkeys',
          target.dataset?.loopHotkey || '',
          { setPointA: 'k', setPointB: 'l', resetPoints: 'o' },
          { toggleLoop: 'r', setPointA: 'k', setPointB: 'l', resetPoints: 'o' }
        )
      ) {
        enhancer.saveSettings();
      }
    }
  }

  /**
   * Safety: with a group setting enabled and no explicit saved submenu
   * state, keep that submenu visible so users see all available options.
   * @param {HTMLElement} advancedSection
   * @param {Record<string, boolean>} submenuStates
   */
  function ensureAdvancedSubmenusVisible_(advancedSection, submenuStates) {
    const ensureVisibleWhenEnabled = (/** @type {string} */ key, /** @type {string} */ setting) => {
      if (Object.hasOwn(submenuStates, key)) return;
      const checkbox = advancedSection.querySelector(
        `.yp-settings-checkbox[data-setting="${setting}"]`
      );
      const submenu = advancedSection.querySelector(basicSubmenuSelector_(key));
      const toggleBtn = advancedSection.querySelector(`.yp-submenu-toggle[data-submenu="${key}"]`);
      if (
        checkbox instanceof Element &&
        checkbox.classList.contains('yp-settings-checkbox') &&
        /** @type {HTMLInputElement} */ (checkbox).checked &&
        submenu instanceof HTMLElement
      ) {
        submenu.style.display = '';
        submenu.classList.remove('is-hidden');
        if (toggleBtn instanceof HTMLElement) {
          toggleBtn.setAttribute('aria-expanded', 'true');
        }
      }
    };

    ensureVisibleWhenEnabled('enhanced', 'enableEnhanced');
    ensureVisibleWhenEnabled('music', 'enableMusic');
  }

  /**
   * Restore active nav section from storage. The saved value is treated as
   * a hint only: when it does not match a live section, fall back to the
   * first nav item so the modal never opens empty.
   * @param {HTMLElement} modal
   */
  function restoreActiveNavSection_(modal) {
    // Saved section values come from storage; guard the derived selectors.
    try {
      const validSections = new Set(
        Array.from(modal.querySelectorAll('.yp-settings-nav-item')).map(
          item => /** @type {HTMLElement} */ (item).dataset?.section
        )
      );
      const fallbackSection =
        /** @type {HTMLElement | null} */ (modal.querySelector('.yp-settings-nav-item'))?.dataset
          ?.section || null;
      const savedSection = validSections.has(basicUiState_.activeNavSection.read())
        ? basicUiState_.activeNavSection.read()
        : fallbackSection;
      if (savedSection) {
        const navItem = modal.querySelector(
          `.yp-settings-nav-item[data-section="${savedSection}"]`
        );
        if (navItem) {
          window.YouTubePlusModalHandlers.activateSettingsSection(
            /** @type {HTMLElement} */ (navItem),
            modal
          );
          scheduleInitialSectionActivation_(
            modal,
            savedSection,
            /** @type {HTMLElement} */ (navItem).dataset?.label || ''
          );
        }
      }
    } catch (_e) {
      logS(_e);
    }
  }

  /**
   * Build the settings modal DOM.
   * @param {SettingsModalEnhancer} enhancer
   * @param {HTMLElement|null} [previousActiveElement=null]
   * @returns {HTMLElement}
   */
  function createSettingsModal(enhancer, previousActiveElement = null) {
    const modal = document.createElement('div');
    modal.className = 'yp-settings-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('settingsTitle'));

    // Use helper functions from settings-helpers.js
    const helpers = window.YouTubePlusSettingsHelpers;
    const handlers = window.YouTubePlusModalHandlers;

    // The shell is re-renderable: when the dictionary finishes loading while
    // the modal is already open, the same template renders with translations.
    const renderModalShell_ = () => {
      modal.setAttribute('aria-label', t('settingsTitle'));
      setSafeHTML(
        modal,
        `
        <div class="yp-settings-shell">
          <div class="yp-settings-sidebar">
            <h2 class="yp-settings-classic-title">${t('settingsTitle')}</h2>
            ${helpers.createSettingsSidebar(t)}
            <div class="yp-settings-classic-sidebar-footer">
              <button class="yp-button yp-button-primary yp-classic-save" id="yp-save-settings-classic">${t('saveChanges')}</button>
            </div>
          </div>
          <div class="yp-settings-column">
            <div class="yp-settings-topbar">
              <h2 class="yp-settings-title">${t('settingsTitle')}</h2>
              <div class="yp-settings-active-label" id="yp-active-section-label"></div>
              <button class="yp-button yp-button-primary yp-topbar-save" id="yp-save-settings">${t('saveChanges')}</button>
            </div>
            <div class="yp-settings-panel">${helpers.createMainContent(enhancer.settings, t)}</div>
          </div>
          <button class="yp-settings-classic-close" id="yp-close-settings-classic" aria-label="${t('closeButton')}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>
          </button>
          <div class="yp-settings-side-actions">
            <button class="yp-settings-close" id="yp-close-settings" aria-label="${t('closeButton')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>
            </button>
          </div>
        </div>
      `
      );
    };
    renderModalShell_();

    // Keep the topbar active-section label in sync with the active nav item.
    const syncActiveSectionLabel_ = () => {
      const initialNav = /** @type {HTMLElement|null} */ (
        modal.querySelector('.yp-settings-nav-item.active')
      );
      const activeLabel = modal.querySelector('#yp-active-section-label');
      if (activeLabel) {
        activeLabel.textContent = initialNav?.dataset?.label || '';
      }
    };
    syncActiveSectionLabel_();

    /**
     * A dictionary loading while the modal is on screen must not leave it
     * with raw keys: re-render the shell once translations become ready,
     * preserving the user's not-yet-saved checkbox/select state and expanded
     * submenus.
     */
    const refreshModalTranslations_ = () => {
      const formState = captureModalFormState_(modal);
      renderModalShell_();
      applyModalFormState_(modal, formState);
      restoreModalSubmenuStates_(modal);
      syncActiveSectionLabel_();
      initModalDropdowns_(modal);
      createVotingUI_(getVotingContainer_());
    };

    // Context for handlers
    const context = {
      settings: enhancer.settings,
      getElement: enhancer.getElement.bind(enhancer),
      addDownloadButton: enhancer.addDownloadButton.bind(enhancer),
      addSpeedControlButton: enhancer.addSpeedControlButton.bind(enhancer),
      refreshDownloadButton: enhancer.refreshDownloadButton.bind(enhancer),
      updatePageBasedOnSettings: enhancer.updatePageBasedOnSettings.bind(enhancer),
      showNotification: enhancer.showNotification.bind(enhancer),
    };

    const closeModal = setupModalDismissal_(
      modal,
      previousActiveElement,
      refreshModalTranslations_
    );

    // Modal event delegation
    const cmRegister = window.YouTubePlusCleanupManager;
    cmRegister?.registerListener?.(
      modal,
      'click',
      e => handleModalClick_(modal, enhancer, handlers, context, e, closeModal),
      undefined,
      false
    );
    cmRegister?.registerListener?.(
      modal,
      'change',
      e => handleSettingsChange_(enhancer, handlers, context, modal, e),
      undefined,
      false
    );
    cmRegister?.registerListener?.(
      modal,
      'input',
      e => handleSettingsInput_(enhancer, handlers, t, e),
      undefined,
      false
    );
    cmRegister?.registerListener?.(
      modal,
      'blur',
      e => handleSettingsBlur_(enhancer, e),
      true,
      false
    );

    // Allow report module to populate settings
    if (window.YouTubePlusReport && typeof window.YouTubePlusReport.render === 'function') {
      try {
        window.YouTubePlusReport.render(modal);
      } catch (err) {
        // the report section is optional; the rest of the modal still opens
        logS(err);
      }
    }

    // Restore submenu expanded states from modal UI-state store
    restoreModalSubmenuStates_(modal);
    const submenuStates = basicUiState_.submenuStates.read();

    // Safety: if Advanced feature toggles are enabled and no explicit saved submenu state exists,
    // ensure those submenus are visible so users see all available options.
    const advancedSection = modal.querySelector('.yp-settings-section[data-section="advanced"]');
    if (advancedSection instanceof HTMLElement) {
      ensureAdvancedSubmenusVisible_(advancedSection, submenuStates);
    }

    restoreActiveNavSection_(modal);
    initModalDropdowns_(modal);

    return modal;
  }

  /**
   * Broadcast the initial section activation so feature modules that opted in
   * via `onSectionActive` can hydrate UI without waiting for a tab click.
   * @param {HTMLElement} modal
   * @param {string} section
   * @param {string} label
   */
  function scheduleInitialSectionActivation_(modal, section, label) {
    const currentSession = activeModalSession;
    const timer = setTimeout(() => {
      if (currentSession) currentSession.activationTimer = null;
      if (currentSession?.isDisposed?.() || !modal.isConnected) return;
      if (activeModalSession !== currentSession) return;
      document.dispatchEvent(
        new CustomEvent('youtube-plus-settings-section-activated', {
          detail: {
            section,
            label,
          },
          bubbles: true,
        })
      );
    }, 0);
    if (currentSession) {
      currentSession.activationTimer = timer;
    }
  }

  /**
   * Set initial focus into modal for keyboard navigation & screen readers.
   * Returns the deferred focus timer id so the owning session can clear it
   * on dispose no stale focus timer after the modal is gone).
   * @param {HTMLElement} modal
   * @returns {ReturnType<typeof setTimeout>} timer id
   */
  function focusInitialModalElement_(modal) {
    return setTimeout(() => {
      if (!modal.isConnected) return;
      if (activeModalSession?.modal !== modal) return;
      const initial =
        modal.querySelector('.yp-settings-nav-item.active') ||
        modal.querySelector('.yp-settings-close') ||
        modal.querySelector('button');
      if (initial instanceof HTMLElement) {
        initial.focus();
      }
    }, 0);
  }

  /**
   * Dispose any existing modal before opening a new one. Completes the
   * older lifecycle session when one is ours; falls back to a defensive
   * release for foreign/legacy modals without a session.
   * @param {SettingsModalEnhancer} enhancer
   * @returns {Element|null} the released element (or null)
   */
  function disposeExistingModal_(enhancer) {
    const existingModal = enhancer.getElement('.yp-settings-modal', false);
    if (!existingModal) return null;
    if (closeActiveModal()) return existingModal;
    // Foreign/legacy modal without one of our sessions: release it
    // defensively, still announcing the closure exactly once.
    dispatchModalClosedEvent_();
    window.YouTubePlusCleanupManager?.disconnectSubtree?.(existingModal);
    existingModal.remove();
    return existingModal;
  }

  /**
   * Open (or focus) the settings modal. @param {SettingsModalEnhancer} enhancer
   */
  function openSettingsModal(enhancer) {
    enhancer.insertStyles();
    window.YouTubePlusDesignSystem?.repairStyles?.();
    disposeExistingModal_(enhancer);
    const previousActiveElement =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (typeof enhancer.ensureNonCriticalStyles === 'function') {
      enhancer.ensureNonCriticalStyles();
    }
    const modal = createSettingsModal(enhancer, previousActiveElement);
    (document.body || document.documentElement).appendChild(modal);
    if (activeModalSession) {
      activeModalSession.focusTimer = focusInitialModalElement_(modal);
    }
    // Initialize voting system
    const votingContainer = getVotingContainer_();
    if (votingContainer && window.YouTubePlus?.Voting) {
      window.YouTubePlus.Voting.init();
      window.YouTubePlus.Voting.createUI(votingContainer);
    }
    // Notify modules that settings modal is now in DOM
    document.dispatchEvent(
      new CustomEvent('youtube-plus-settings-modal-opened', {
        bubbles: true,
      })
    );
  }

  const settingsModalAPI = {
    create: createSettingsModal,
    open: openSettingsModal,
    // the supported external close path: the same idempotent session
    // dispose used by Escape/backdrop/re-open.
    close: closeActiveModal,
    // The modal owns modal-UI session state (submenu states,
    // last-open section). Basic forwards its single section hint here
    // instead of a duplicated helper.
    basicUiState: basicUiState_,
  };

  window.YouTubePlusSettingsModal = /** @type {YouTubePlusSettingsModal} */ (settingsModalAPI);
})();
