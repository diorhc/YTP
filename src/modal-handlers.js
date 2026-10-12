/**
 * Modal Event Handlers
 * Extracted from createSettingsModal to reduce complexity
 */

(function () {
  // DOM cache helper from YouTubeUtils
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ err, /** @type {string|undefined} */ label = undefined) =>
    U?.logSuppressed?.(err, label || 'ModalHandlers');
  const qs = U?.$ || document.querySelector.bind(document);

  /**
   * Safely set a setting by path (supports dot notation)
   * @param {Record<string, unknown>} settings
   * @param {string} path
   * @param {unknown} value
   */
  const setSettingByPath = (settings, path, value) => {
    if (!settings || typeof settings !== 'object') return;
    if (!path || typeof path !== 'string') return;

    // Fast path: simple key
    if (!path.includes('.')) {
      settings[path] = value;
      return;
    }

    const keys = path.split('.').filter(Boolean);
    if (!keys.length) return;
    const lastKey = keys.pop();
    if (!lastKey) return;

    let cur = settings;
    for (const k of keys) {
      if (!Object.hasOwn(cur, k) || typeof cur[k] !== 'object' || !cur[k]) {
        cur[k] = {};
      }
      cur = /** @type {Record<string, unknown>} */ (cur[k]);
    }
    cur[lastKey] = value;
  };

  /**
   * Save settings safely
   * @param {() => void} saveSettings - Save function
   */
  const safelySaveSettings = (/** @type {() => void} */ saveSettings) => {
    try {
      saveSettings();
    } catch (err) {
      // storage full or disabled; the toggle stays applied for this page
      logS(err);
    }
  };

  /**
   * Handle Download button live toggle
   * @param {Object} context - Context object with methods
   */
  const handleDownloadButtonToggle = (/** @type {SettingsModalContext} */ context) => {
    const { settings, getElement, addDownloadButton } = context;
    const controls = getElement('.ytp-right-controls');
    const existing = getElement('.yp-download-button', false);

    if (settings.enableDownload) {
      // create button if missing
      if (controls && !existing) addDownloadButton(controls);
    } else {
      // remove button + dropdown if present
      if (existing) existing.remove();
      const dropdown = qs('.download-options');
      if (dropdown) dropdown.remove();
    }
  };

  /**
   * Handle Speed Control live toggle
   * @param {Object} context - Context object with methods
   */
  const handleSpeedControlToggle = (/** @type {SettingsModalContext} */ context) => {
    const { settings, getElement, addSpeedControlButton } = context;
    const isEnabled = Boolean(settings?.enableSpeedControl);

    // The feature module owns visibility & options display
    if (window.YouTubePlusSpeedControl?.refreshVisibility) {
      window.YouTubePlusSpeedControl.refreshVisibility(isEnabled);
    }

    const controls = getElement('.ytp-right-controls');
    const existing = getElement('.speed-control-btn', false);

    if (isEnabled) {
      if (controls && !existing && typeof addSpeedControlButton === 'function') {
        addSpeedControlButton(controls);
      }
    } else {
      if (existing) existing.remove();
      const speedOptions = qs('.speed-options');
      if (speedOptions) speedOptions.remove();
    }
  };

  const setTimeout_ = setTimeout.bind(window);

  /**
   * Reload the page so YouTube re-renders natively in the newly-chosen
   * theme. Preserves current playback position
   * on /watch pages so the reload doesn't lose the user's place in a video.
   * @param {SettingsModalContext} context
   */
  const scheduleThemeReload = (/** @type {SettingsModalContext} */ context) => {
    const t = window.YouTubeUtils?.t;
    const message =
      (typeof t === 'function' && t('themeReloadNotice')) ||
      'Reloading so YouTube fully applies the new theme…';
    context?.showNotification?.(message, 1800);

    const doReload = () => {
      // URL construction or the navigation itself can fail on restricted
      // pages; the plain reload is the fallback.
      try {
        const url = new URL(window.location.href);
        const video = /** @type {HTMLVideoElement|null} */ (
          document.querySelector('video.video-stream')
        );
        if (video && Number.isFinite(video.currentTime) && video.currentTime > 1) {
          url.searchParams.set('t', `${Math.floor(video.currentTime)}s`);
        }
        window.location.href = url.toString();
      } catch (_e) {
        logS(_e);
        window.location.reload();
      }
    };

    const cm = U?.cleanupManager;
    if (cm?.timeout) {
      cm.timeout(doReload, 1200);
    } else {
      setTimeout_(doReload, 1200);
    }
  };

  /**
   * Toggle a settings submenu's visibility together with its associated
   * toggle button's disabled/aria-expanded/display state.
   * @param {HTMLElement} modal
   * @param {string} submenuSelector
   * @param {string} toggleBtnSelector
   * @param {boolean} checked
   * @param {string} [toggleDisplayValue] - display value when enabled (default 'inline-flex')
   */
  const toggleSubmenuVisibility = (
    modal,
    submenuSelector,
    toggleBtnSelector,
    checked,
    toggleDisplayValue = 'inline-flex'
  ) => {
    const submenu = modal.querySelector(submenuSelector);
    if (submenu instanceof HTMLElement) {
      submenu.style.display = checked ? 'block' : 'none';
    }
    const toggleBtn = modal.querySelector(toggleBtnSelector);
    if (toggleBtn instanceof HTMLElement) {
      if (checked) {
        toggleBtn.removeAttribute('disabled');
        toggleBtn.setAttribute('aria-expanded', 'true');
        toggleBtn.style.display = toggleDisplayValue;
      } else {
        toggleBtn.setAttribute('disabled', '');
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.style.display = 'none';
      }
    }
  };

  /**
   * Apply setting changes live to the UI
   * @param {string} setting - Setting key
   * @param {Object} context - Context object with methods
   */
  const applySettingLiveSteps_ = (
    /** @type {string} */ setting,
    /** @type {SettingsModalContext} */ context
  ) => {
    const { settings, refreshDownloadButton } = context;

    // Update page elements (show/hide buttons, dropdowns)
    if (context.updatePageBasedOnSettings) {
      context.updatePageBasedOnSettings();
    }

    // Dispatch to specific handlers
    if (setting === 'enableDownload') {
      handleDownloadButtonToggle(context);
    } else if (setting === 'enableSpeedControl') {
      handleSpeedControlToggle(context);
    } else if (setting === 'styles.themePreference') {
      // Write PREF cookie via design-system, then reload so YouTube
      // re-renders natively in the chosen theme.
      const ds = window.YouTubePlusDesignSystem;
      const pref = settings?.styles?.themePreference || 'device';
      if (ds && typeof ds.applyThemePreference === 'function') {
        ds.applyThemePreference(pref);
      }
      scheduleThemeReload(context);
    } else if (setting === 'styles.themeVariant' || setting === 'styles.themeStyle') {
      // Apply theme variant and material style immediately via design-system
      const ds = window.YouTubePlusDesignSystem;
      if (ds && typeof ds.applyThemeVariant === 'function') {
        ds.applyThemeVariant(
          settings?.styles?.themeVariant || 'vision',
          settings?.styles?.themeStyle || 'glass'
        );
      }
      // Rebuild the player button surface for the new variant:
      // Classic buttons in `.ytp-right-controls` and the Vision Dock are
      // mounted per-variant, so a live variant switch must
      // remount them instead of waiting for next SPA navigation.
      window.YouTubePlusBasic?.YouTubeEnhancer?.addCustomButtons?.();
      window.YouTubePlusZoom?.rebuildUI?.();
    }

    // Ensure visibility state updates
    if (refreshDownloadButton) {
      refreshDownloadButton();
    }
  };

  /**
   * Apply a changed setting to the page now. Other modules do the work, so a
   * failure in one of them is logged and the caller still saves the setting.
   * @param {string} setting - Setting key
   * @param {SettingsModalContext} context - Context object with methods
   */
  const applySettingLive = (
    /** @type {string} */ setting,
    /** @type {SettingsModalContext} */ context
  ) => {
    try {
      applySettingLiveSteps_(setting, context);
    } catch (err) {
      logS(err);
    }
  };

  /**
   * Handle simple setting checkbox toggle
   * @param {HTMLElement} target - Checkbox element
   * @param {string} setting - Setting key
   * @param {YoutubePlusSettings} settings - Settings object
   * @param {SettingsModalContext} context - Context object with methods
   * @param {() => void} saveSettings - Function to save settings
   * @param {HTMLElement} modal - Modal element
   */
  const handleSimpleSettingToggle = (
    /** @type {HTMLInputElement} */ target,
    /** @type {string} */ setting,
    /** @type {YoutubePlusSettings} */ settings,
    /** @type {SettingsModalContext} */ context,
    /** @type {() => void} */ saveSettings,
    /** @type {HTMLElement} */ modal
  ) => {
    const checked = /** @type {HTMLInputElement} */ (target).checked;
    setSettingByPath(settings, setting, checked);

    if (setting === 'styles.sideVideosColumnsEnabled' && checked) {
      const currentValue = Number(settings.styles?.sideVideosColumns);
      if (!Number.isFinite(currentValue) || currentValue <= 0) {
        setSettingByPath(settings, 'styles.sideVideosColumns', 1);
        const select = modal.querySelector(
          '.style-side-videos-submenu select[data-setting="styles.sideVideosColumns"]'
        );
        if (select instanceof HTMLSelectElement) {
          select.value = '1';
        }
      }
    }

    // Apply settings immediately
    applySettingLive(setting, context);

    // Persist immediately
    saveSettings();

    // Data-driven submenu toggle: setting key → [submenuSelector, toggleBtnSelector]
    const submenuMap = {
      enableDownload: ['.download-submenu', '.yp-submenu-toggle[data-submenu="download"]'],
      enableStyles: ['.style-submenu', '.yp-submenu-toggle[data-submenu="style"]'],
      'styles.sideVideosColumnsEnabled': [
        '.style-side-videos-submenu[data-submenu="style-side-videos"]',
        '.yp-submenu-toggle[data-submenu="style-side-videos"]',
      ],
      enableSpeedControl: ['.speed-submenu', '.yp-submenu-toggle[data-submenu="speed"]'],
      enableEnhanced: ['.enhanced-submenu', '.yp-submenu-toggle[data-submenu="enhanced"]'],
      enableLoop: ['.loop-submenu', '.yp-submenu-toggle[data-submenu="loop"]'],
      enableScreenshot: ['.screenshot-submenu', '.yp-submenu-toggle[data-submenu="screenshot"]'],
      enablePip: ['.pip-submenu', '.yp-submenu-toggle[data-submenu="pip"]'],
      performanceMode: [
        '.performance-mode-submenu',
        '.yp-submenu-toggle[data-submenu="performance-mode"]',
      ],
    };
    const submenu = submenuMap[/** @type {keyof typeof submenuMap} */ (setting)];
    if (submenu) {
      toggleSubmenuVisibility(modal, submenu[0], submenu[1], checked);
    }
  };

  /**
   * Swap the active settings nav item and make its section the visible one.
   * Returns the activated section id.
   * @param {HTMLElement} navItem
   * @param {HTMLElement} modal
   * @returns {string | undefined}
   */
  const activateSettingsSection = (navItem, modal) => {
    const section = navItem.dataset?.section;
    modal.querySelectorAll('.yp-settings-nav-item').forEach(item => {
      item.classList.remove('active');
      item.setAttribute('aria-selected', 'false');
      item.setAttribute('tabindex', '-1');
    });
    modal.querySelectorAll('.yp-settings-section').forEach(s => {
      s.classList.add('hidden');
    });

    navItem.classList.add('active');
    navItem.setAttribute('aria-selected', 'true');
    navItem.setAttribute('tabindex', '0');

    // Update topbar centered label
    const activeLabel = modal.querySelector('#yp-active-section-label');
    if (activeLabel) {
      activeLabel.textContent = navItem.dataset?.label || '';
    }

    const targetSection = modal.querySelector(`.yp-settings-section[data-section="${section}"]`);
    if (targetSection) {
      targetSection.classList.remove('hidden');
    }
    return section;
  };

  /**
   * Handle sidebar navigation
   * @param {HTMLElement} navItem - Navigation item element
   * @param {HTMLElement} modal - Modal element
   */
  const handleSidebarNavigation = (
    /** @type {HTMLElement} */ navItem,
    /** @type {HTMLElement} */ modal
  ) => {
    const section = activateSettingsSection(navItem, modal);

    // Init before/after slider when voting section becomes visible
    if (section === 'voting' && window.YouTubePlusVoting?.initSlider) {
      // Use rAF so the section is truly visible before measuring dimensions
      window.YouTubePlusCleanupManager?.registerAnimationFrame?.(
        requestAnimationFrame(() => window.YouTubePlusVoting.initSlider())
      );
    }

    // Persist active nav section so it can be restored on next modal open
    // Storage can be disabled or full.
    try {
      U?.storage?.setItem?.('ytp-plus-active-nav-section', /** @type {string} */ (section));
    } catch (_e) {
      logS(_e);
    }

    // Broadcast the section change so feature modules can opt into
    // "only do work while this section is visible" without going
    // through a central registry. Modules that registered via
    // `YouTubeUtils.onSectionActive(id, onEnter, onLeave)` listen
    // for this event and respond.
    document.dispatchEvent(
      new CustomEvent('youtube-plus-settings-section-activated', {
        detail: {
          section,
          label: navItem.dataset?.label || '',
        },
        bubbles: true,
      })
    );
  };

  /**
   * Mirror the music switch state onto its submenu card.
   * @param {HTMLElement} target - Checkbox or toggle element
   * @param {boolean} enabled - Whether the music setting is checked
   */
  const syncMusicSubmenuVisibility_ = (target, enabled) => {
    const root = /** @type {HTMLElement|null} */ (
      target.closest('.yp-settings-section') || target.closest('.yp-settings-panel')
    );
    if (!root) return;
    const submenu = root.querySelector('.music-submenu[data-submenu="music"]');
    if (submenu instanceof HTMLElement) {
      submenu.style.display = enabled ? 'block' : 'none';
    }
    const toggleBtn = root.querySelector('.yp-submenu-toggle[data-submenu="music"]');
    if (toggleBtn instanceof HTMLElement) {
      if (enabled) {
        toggleBtn.removeAttribute('disabled');
        toggleBtn.style.display = 'inline-flex';
      } else {
        toggleBtn.setAttribute('disabled', '');
        toggleBtn.style.display = 'none';
      }
      toggleBtn.setAttribute('aria-expanded', enabled ? 'true' : 'false');
    }
  };

  /**
   * Handle YouTube Music settings toggle
   * @param {HTMLElement} target - Checkbox element
   * @param {string} setting - Setting key
   */
  const handleMusicSettingToggle = (target, setting) => {
    const defaults = {
      enableMusic: true,
      immersiveSearchStyles: true,
      hoverStyles: true,
      playerSidebarStyles: true,
      centeredPlayerStyles: true,
      playerBarStyles: true,
      centeredPlayerBarStyles: true,
      miniPlayerStyles: true,
      scrollToTopStyles: true,
    };

    const allowedKeys = new Set(Object.keys(defaults));
    if (!allowedKeys.has(setting)) return;

    const checked = /** @type {HTMLInputElement} */ (target).checked;

    // Delegate to the music settings store helpers when available
    const store = window.YouTubePlusSettingsStore;
    const helpers =
      /** @type {Partial<YouTubePlusSettingsStore & YouTubePlusSettingsHelpers> | null} */ (
        window.YouTubePlusSettingsHelpers || window.YouTubePlusSettingsStore
      );
    let musicSettings;

    if (helpers?.updateMusicSettings && helpers?.getMusicSettings) {
      helpers.updateMusicSettings({ [setting]: checked });
      musicSettings = helpers.getMusicSettings();
    } else if (store?.updateMusicSettings && store?.getMusicSettings) {
      // The store music bridge is the single writer; the change lands in the
      // shared blob (or the legacy key it mirrors) and the module re-applies it.
      store.updateMusicSettings({ [setting]: checked });
      musicSettings = store.getMusicSettings();
    }
    // Without the store bridge the toggle stays on this page and is not persisted.
    musicSettings = musicSettings ?? { ...defaults, [setting]: checked };

    // UI: toggle visibility of music submenu card when main switch changes
    if (setting === 'enableMusic') {
      syncMusicSubmenuVisibility_(target, !!checked);
    }

    // Apply changes if YouTubeMusic / YouTubePlusMusic module is available
    const musicModule = window.YouTubePlusMusic || window.YouTubeMusic;
    if (musicModule) {
      if (typeof musicModule.saveSettings === 'function') {
        musicModule.saveSettings(musicSettings);
      }
      if (typeof musicModule.applySettingsChanges === 'function') {
        musicModule.applySettingsChanges();
      }
    }
  };

  /**
   * Check if a setting is a YouTube Music setting
   * @param {string} setting - Setting key
   * @returns {boolean} True if it's a music setting
   */
  const isMusicSetting = (/** @type {string} */ setting) => {
    return (
      setting === 'enableMusic' ||
      setting === 'immersiveSearchStyles' ||
      setting === 'hoverStyles' ||
      setting === 'playerSidebarStyles' ||
      setting === 'centeredPlayerStyles' ||
      setting === 'playerBarStyles' ||
      setting === 'centeredPlayerBarStyles' ||
      setting === 'miniPlayerStyles' ||
      setting === 'scrollToTopStyles'
    );
  };

  /**
   * Initialise a custom glass-style dropdown (button + listbox).
   *
   * The visible UI is a `glass-dropdown` markup block (a toggle button and
   * a listbox of options). The actual form value lives on a hidden native
   * `<select>` so that existing change-handler logic in basic.js and
   * elsewhere keeps working unchanged. Picking an item in the listbox
   * updates the hidden select, dispatches a bubbling `change` event, and
   * collapses the listbox.
   *
   * Imported from the original `initPipDropdown` in pip.js (2.3.1) and
   * generalised so that all four call sites (pip, timecode, report, stats)
   * share one implementation.
   *
   * @param {{ dropdown: HTMLElement | null, hiddenSelect?: HTMLSelectElement | null, onOpen?: () => void, onChange?: (val: string) => void }} opts
   */
  const initGlassDropdown = (
    /** @type {{ dropdown: HTMLElement | null, hiddenSelect?: HTMLSelectElement | null, onOpen?: () => void, onChange?: (val: string) => void }} */ opts
  ) => {
    const dropdown = opts?.dropdown;
    const hidden =
      opts?.hiddenSelect ||
      dropdown?.querySelector('select') ||
      (dropdown?.parentElement instanceof HTMLElement
        ? dropdown.parentElement.querySelector('select')
        : null);
    if (!dropdown) return;
    if (dropdown.hasAttribute('data-yp-dropdown-init')) return;
    dropdown.setAttribute('data-yp-dropdown-init', 'true');

    const toggle = dropdown.querySelector('.glass-dropdown__toggle');
    const list = dropdown.querySelector('.glass-dropdown__list');
    const label = dropdown.querySelector('.glass-dropdown__label');
    if (!(toggle instanceof HTMLElement && list instanceof HTMLElement)) return;

    // Accessibility roles & states
    toggle.setAttribute('type', 'button');
    toggle.setAttribute('aria-haspopup', 'listbox');
    toggle.setAttribute('aria-expanded', 'false');
    list.setAttribute('role', 'listbox');
    list.setAttribute('tabindex', '-1');

    /** @type {HTMLElement[]} */
    let items = Array.from(
      /** @type {NodeListOf<HTMLElement>} */ (list.querySelectorAll('.glass-dropdown__item'))
    );
    items.forEach(it => {
      if (!it.hasAttribute('role')) it.setAttribute('role', 'option');
    });

    let idx = items.findIndex(it => it.getAttribute('aria-selected') === 'true');
    if (idx < 0) idx = 0;

    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
    const openList = () => {
      toggle.setAttribute('aria-expanded', 'true');
      dropdown.setAttribute('aria-expanded', 'true');
      list.style.display = 'block';
      list.classList.add('is-open');
      items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
      items.forEach(it => {
        if (!it.hasAttribute('role')) it.setAttribute('role', 'option');
      });

      // Auto-detect direction: if there is not enough room above the dropdown
      // inside the nearest scrollable ancestor, open downward instead.
      list.classList.remove('glass-dropdown__list--down');
      let scrollParent = dropdown.parentElement;
      while (scrollParent && scrollParent !== document.body) {
        const overflowY = window.getComputedStyle(scrollParent).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
          break;
        }
        scrollParent = scrollParent.parentElement;
      }
      if (scrollParent) {
        const toggleRect = toggle.getBoundingClientRect();
        const parentRect = scrollParent.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const spaceAbove = toggleRect.top - parentRect.top;
        const estimatedListHeight =
          listRect.height > 0 ? listRect.height : Math.min(items.length * 36, 220);
        if (spaceAbove < estimatedListHeight + 8) {
          list.classList.add('glass-dropdown__list--down');
        }
      }

      opts?.onOpen?.();
    };
    const closeList = () => {
      toggle.setAttribute('aria-expanded', 'false');
      dropdown.setAttribute('aria-expanded', 'false');
      list.style.display = 'none';
      list.classList.remove('is-open');
      list.classList.remove('glass-dropdown__list--down');
    };

    /**
     * Commit an item as selected: update the hidden value, listbox marks,
     * the visible label and dispatch the change for the settings pipeline.
     * @param {HTMLElement} item
     */
    const commitItem = item => {
      const val = item.dataset?.value ?? (hidden ? hidden.value : '');
      if (hidden) {
        hidden.value = val;
      }
      if ('_value' in dropdown) {
        /** @type {HTMLElement & { value?: string }} */ (dropdown).value = val;
      }
      list
        .querySelectorAll('.glass-dropdown__item')
        .forEach(li => li.removeAttribute('aria-selected'));
      item.setAttribute('aria-selected', 'true');
      if (label) label.textContent = item.textContent ?? '';
      if (hidden) {
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }
      opts?.onChange?.(val);
      closeList();
      if (typeof toggle.focus === 'function') toggle.focus();
    };

    /**
     * Update the listbox selection to a target index and sync the values.
     * @param {number} targetIdx
     */
    const updateSelectionToIndex = targetIdx => {
      items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
      if (items.length === 0) return;
      idx = Math.min(Math.max(targetIdx, 0), items.length - 1);
      items.forEach(it => it.removeAttribute('aria-selected'));
      items[idx].setAttribute('aria-selected', 'true');
      if (typeof items[idx]?.scrollIntoView === 'function') {
        items[idx].scrollIntoView({ block: 'nearest' });
      }
      const currentVal = items[idx].dataset?.value ?? '';
      if (hidden) {
        hidden.value = currentVal;
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if ('_value' in dropdown) {
        /** @type {HTMLElement & { value?: string }} */ (dropdown).value = currentVal;
      }
      if (label) label.textContent = items[idx].textContent ?? '';
      opts?.onChange?.(currentVal);
    };

    /**
     * Move the listbox selection one step and open the list first when it
     * was closed (mirrors the native select behavior).
     * @param {number} delta
     */
    const moveSelection = delta => {
      if (!isOpen()) openList();
      updateSelectionToIndex(idx + delta);
    };

    window.YouTubePlusCleanupManager?.registerListener?.(
      toggle,
      'click',
      (/** @type {Event} */ e) => {
        e.stopPropagation();
        const expanded = isOpen();
        if (expanded) closeList();
        else openList();
      },
      undefined,
      false
    );

    // Owned by the dropdown: removing its dialog releases this listener too.
    window.YouTubePlusCleanupManager?.registerListener?.(
      document,
      'click',
      (/** @type {Event} */ e) => {
        if (!dropdown.contains(/** @type {Node} */ (e.target))) closeList();
      },
      /** @type {AddEventListenerOptions & { owner?: HTMLElement }} */ ({ owner: dropdown }),
      true
    );

    const handleKeyNav = (/** @type {KeyboardEvent} */ e) => {
      const key = e.key;
      if (key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1);
      } else if (key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1);
      } else if (key === 'Home' && isOpen()) {
        e.preventDefault();
        updateSelectionToIndex(0);
      } else if (key === 'End' && isOpen()) {
        e.preventDefault();
        items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
        updateSelectionToIndex(items.length - 1);
      }
    };

    const handleKeyCommitOrDismiss = (/** @type {KeyboardEvent} */ e) => {
      const key = e.key;
      if (key === 'Escape' && isOpen()) {
        e.preventDefault();
        e.stopPropagation();
        closeList();
        if (typeof toggle.focus === 'function') toggle.focus();
      } else if (key === 'Tab' && isOpen()) {
        closeList();
      } else if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        if (!isOpen()) {
          openList();
          return;
        }
        items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
        const it = items[idx];
        if (it) commitItem(it);
      }
    };

    window.YouTubePlusCleanupManager?.registerListener?.(
      dropdown,
      'keydown',
      (/** @type {KeyboardEvent} */ e) => {
        if (
          toggle.getAttribute('aria-disabled') === 'true' ||
          /** @type {HTMLElement & { _disabled?: boolean }} */ (dropdown)._disabled === true
        ) {
          return;
        }
        handleKeyNav(e);
        handleKeyCommitOrDismiss(e);
      },
      undefined,
      false
    );

    window.YouTubePlusCleanupManager?.registerListener?.(
      list,
      'click',
      (/** @type {Event} */ e) => {
        const it =
          e.target && /** @type {HTMLElement} */ (e.target).closest?.('.glass-dropdown__item');
        if (!(it instanceof HTMLElement)) return;
        commitItem(it);
      },
      undefined,
      false
    );
  };

  /**
   * The ordered list of keyboard-modifier combo values used
   * by the PiP and Timecode shortcut editors. The dropdowns iterate
   * over this array to render `<option>` and `<li>` markup, and the
   * resolver reads the same order to turn a `(ctrlKey, altKey,
   * shiftKey)` triple back into a string.
   *
   * Order matters: more-specific combos come after less-specific ones
   * so the dropdown reads as a natural progression from "no modifier"
   * up to "all three held".
   */
  const MODIFIER_COMBO_VALUES = [
    'none',
    'ctrl',
    'alt',
    'shift',
    'ctrl+alt',
    'ctrl+shift',
    'alt+shift',
    'ctrl+alt+shift',
  ];

  /**
   * Translate a `(ctrlKey, altKey, shiftKey)` triple into one of the
   * combo strings above. Returns `'none'` if none of the
   * modifiers are held.
   *
   * @param {{ ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean }} shortcut
   * @returns {string} Combo value (one of MODIFIER_COMBO_VALUES)
   */
  const resolveModifierComboValue = (
    /** @type {{ ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean }} */ shortcut
  ) => {
    const ctrl = !!shortcut?.ctrlKey;
    const alt = !!shortcut?.altKey;
    const shift = !!shortcut?.shiftKey;
    if (ctrl && alt && shift) return 'ctrl+alt+shift';
    if (ctrl && alt) return 'ctrl+alt';
    if (ctrl && shift) return 'ctrl+shift';
    if (alt && shift) return 'alt+shift';
    if (ctrl) return 'ctrl';
    if (alt) return 'alt';
    if (shift) return 'shift';
    return 'none';
  };

  /**
   * Format a combo value for display. Two rendering modes are
   * supported, controlled by the `opts` argument:
   *
   *   1. `translatePart(part)` callback is provided: each modifier
   *      key is run through it (e.g. for i18n lookup), then
   *      capitalised. This is the mode used by pip.js, where each
   *      "ctrl" / "alt" / "shift" is fed through `t('ctrl')` etc.
   *   2. No callback: modifiers are simply capitalised as English
   *      ("Ctrl", "Alt", "Shift"). This is the fallback used by
   *      timecode.js, which renders the default English form.
   *
   * The special value `'none'` is rendered as `opts.noneLabel` (or
   * the literal string `'None'` if not provided).
   *
   * @param {string} value Combo value (one of MODIFIER_COMBO_VALUES)
   * @param {{ noneLabel?: string, translatePart?: (part: string) => string }} [opts]
   * @returns {string} Display label
   */
  const formatModifierComboLabel = (
    /** @type {string} */ value,
    /** @type {{ noneLabel?: string, translatePart?: (part: string) => string } | undefined} */ opts
  ) => {
    if (value === 'none') return opts?.noneLabel || 'None';
    const translate = opts?.translatePart;
    return value
      .split('+')
      .map(k => (translate ? translate(k) : k))
      .map(k => (typeof k === 'string' && k.length ? k.charAt(0).toUpperCase() + k.slice(1) : k))
      .join('+');
  };

  /**
   * Render the `<option>` elements for the hidden native `<select>`
   * that backs a glass-dropdown. The selected value gets `selected`,
   * matching the original 2.5.1 behaviour where the user could
   * inspect the form value via the native control.
   *
   * @param {string} selectedValue Currently-selected combo value
   * @param {(value: string) => string} formatLabel Label formatter
   * @returns {string} HTML string of `<option>` elements
   */
  const buildModifierComboOptionItems = (
    /** @type {string} */ selectedValue,
    /** @type {(value: string) => string} */ formatLabel
  ) =>
    MODIFIER_COMBO_VALUES.map(
      v =>
        `<option value="${v}"${v === selectedValue ? ' selected' : ''}>${formatLabel(v)}</option>`
    ).join('');

  /**
   * Render the `<li>` elements for a glass-dropdown listbox. The
   * selected value gets `aria-selected="true"`, matching the ARIA
   * listbox pattern used elsewhere in the modal.
   *
   * @param {string} selectedValue Currently-selected combo value
   * @param {(value: string) => string} formatLabel Label formatter
   * @returns {string} HTML string of `<li>` elements
   */
  const buildModifierComboDropdownItems = (
    /** @type {string} */ selectedValue,
    /** @type {(value: string) => string} */ formatLabel
  ) =>
    MODIFIER_COMBO_VALUES.map(
      v =>
        `<li class="glass-dropdown__item" data-value="${v}" role="option"${
          v === selectedValue ? ' aria-selected="true"' : ''
        }>${formatLabel(v)}</li>`
    ).join('');

  // Export handlers
  if (typeof window !== 'undefined') {
    /**
     * Create a focus trap within a container element.
     * Cycles Tab/Shift+Tab through focusable elements inside `container`.
     * Returns a cleanup function to remove the listener.
     * @param {HTMLElement} container - The modal/dialog element to trap focus in
     * @returns {() => void} Cleanup function
     */
    const createFocusTrap = (/** @type {HTMLElement} */ container) => {
      const FOCUSABLE =
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

      const handler = (/** @type {KeyboardEvent} */ e) => {
        if (e.key !== 'Tab') return;
        const focusable = Array.from(container.querySelectorAll(FOCUSABLE)).filter(
          el => /** @type {HTMLElement} */ (el).offsetParent !== null
        );
        if (focusable.length === 0) return;

        const first = /** @type {HTMLElement} */ (focusable[0]);
        const last = /** @type {HTMLElement} */ (focusable[focusable.length - 1]);

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      window.YouTubePlusCleanupManager?.registerListener?.(
        container,
        'keydown',
        handler,
        undefined,
        false
      );
      return () => container.removeEventListener('keydown', handler);
    };

    /**
     * Dispatches generic settings-modal click actions (sidebar nav, save,
     * external downloader save/reset). Extracted from Basic's enhancer object.
     * @param {HTMLElement} target - Click target
     * @param {HTMLElement} modal - Modal element
     * @param {YouTubePlusModalHandlers & YouTubePlusModalDownloadHandlers} handlers - Modal handlers facade (core + download members)
     * @param {SettingsModalContext} context - Settings + disposition callbacks
     * @param {(key: string, params?: Record<string, string | number>) => string} translate - Translation function
     */
    function handleModalClickActions(target, modal, handlers, context, translate) {
      const saveSettings = context.saveSettingsBound || context.saveSettings;
      const showNotification = context.showNotificationBound || context.showNotification;

      // Sidebar navigation
      const navItem = /** @type {HTMLElement | null} */ (
        target.classList?.contains('yp-settings-nav-item')
          ? target
          : target.closest?.('.yp-settings-nav-item')
      );
      if (navItem) {
        handlers.handleSidebarNavigation(navItem, modal);
        return;
      }

      // Save button
      if (
        target.id === 'yp-save-settings' ||
        target.id === 'yp-save-settings-classic' ||
        target.id === 'yp-save-settings-icon' ||
        target.closest('#yp-save-settings') ||
        target.closest('#yp-save-settings-classic')
      ) {
        saveSettings?.();
        document.dispatchEvent(
          new CustomEvent('youtube-plus-settings-modal-closed', {
            bubbles: true,
          })
        );
        modal.remove();
        showNotification?.(translate('settingsSaved'));
        return;
      }

      // External downloader save
      if (target.id === 'download-externalDownloader-save') {
        handlers.handleExternalDownloaderSave(
          target,
          context.settings,
          // The downstream contract hard-calls the binding callbacks; the cast
          // only documents that, and the runtime passes the value through.
          /** @type {() => void} */ (saveSettings),
          /** @type {() => void} */ (showNotification),
          translate
        );
        return;
      }

      // External downloader reset
      if (target.id === 'download-externalDownloader-reset') {
        handlers.handleExternalDownloaderReset(
          modal,
          context.settings,
          /** @type {() => void} */ (saveSettings),
          /** @type {() => void} */ (showNotification),
          translate
        );
      }
    }

    /** Toggle the active/aria-checked state over matched element nodes. */
    function setActiveAriaState_(
      /** @type {NodeListOf<HTMLElement>} */ nodes,
      /** @type {(node: HTMLElement) => boolean} */ isMatch
    ) {
      nodes.forEach(node => {
        const isActive = isMatch(node);
        node.classList.toggle('active', isActive);
        node.setAttribute('aria-checked', isActive ? 'true' : 'false');
      });
    }

    /** Sync the style-button row against a retained material style. */
    function syncThemeStyleButtons_(
      /** @type {HTMLElement} */ modal,
      /** @type {string|undefined} */ layout,
      /** @type {string|undefined} */ style
    ) {
      setActiveAriaState_(
        modal.querySelectorAll('.yp-theme-style-btn'),
        btn => btn.dataset.layout === layout && btn.dataset.style === style
      );
    }

    /**
     * Mark the layout card and style-button pair matching the choice active.
     * @param {HTMLElement} modal
     * @param {string|undefined} layout
     * @param {string|undefined} style
     */
    function activateThemeSelection_(modal, layout, style) {
      setActiveAriaState_(
        modal.querySelectorAll('.yp-theme-card'),
        card => card.dataset.value === layout
      );
      syncThemeStyleButtons_(modal, layout, style);
    }

    /** Reflect the chosen preference button highlight inside its bar. */
    function activateThemePrefButton_(
      /** @type {Element} */ group,
      /** @type {HTMLElement} */ chosen
    ) {
      setActiveAriaState_(group.querySelectorAll('.yp-theme-pref-btn'), btn => btn === chosen);
    }

    /** Reflect the chosen variant card plus the style row of the retained style. */
    function activateThemeVariantCards_(
      /** @type {Element} */ grid,
      /** @type {HTMLElement} */ modal,
      /** @type {HTMLElement} */ chosen,
      /** @type {string|undefined} */ layout,
      /** @type {string|undefined} */ style
    ) {
      setActiveAriaState_(grid.querySelectorAll('.yp-theme-card'), card => card === chosen);
      syncThemeStyleButtons_(modal, layout, style);
    }

    /**
     * Apply a material style-button choice: write both settings, sync the
     * card/style visuals, live-apply and save.
     */
    function handleThemeStyleButton_(
      /** @type {HTMLElement} */ styleBtn,
      /** @type {HTMLElement} */ modal,
      /** @type {YouTubePlusModalHandlers} */ handlers,
      /** @type {SettingsModalContext} */ context,
      /** @type {(() => void) | undefined} */ saveSettings
    ) {
      const settings = context.settings;
      const layout = styleBtn.dataset.layout;
      const style = styleBtn.dataset.style;
      if (layout && style) {
        handlers.setSettingByPath(settings, 'styles.themeVariant', layout);
        handlers.setSettingByPath(settings, 'styles.themeStyle', style);
        activateThemeSelection_(modal, layout, style);
        handlers.applySettingLive('styles.themeVariant', context);
        saveSettings?.();
      }
    }

    /**
     * Apply a settings-card choice (preference or variant): write the
     * setting, sync its control group, live-apply and save.
     */
    function handleThemeOptionCard_(
      /** @type {HTMLElement} */ themeOption,
      /** @type {HTMLElement} */ modal,
      /** @type {YouTubePlusModalHandlers} */ handlers,
      /** @type {SettingsModalContext} */ context,
      /** @type {(() => void) | undefined} */ saveSettings
    ) {
      const settings = context.settings;
      const setting = themeOption.dataset.settingCard;
      const value = themeOption.dataset.value;
      if (setting && typeof value === 'string') {
        handlers.setSettingByPath(settings, setting, value);
        if (setting === 'styles.themePreference') {
          const group = themeOption.closest('.yp-theme-pref-bar');
          if (group) {
            activateThemePrefButton_(group, themeOption);
          }
        } else if (setting === 'styles.themeVariant') {
          const grid = themeOption.closest('.yp-theme-grid');
          if (grid) {
            activateThemeVariantCards_(
              grid,
              modal,
              themeOption,
              value,
              settings?.styles?.themeStyle || 'glass'
            );
          }
        }
        handlers.applySettingLive(setting, context);
        saveSettings?.();
      }
    }

    /**
     * Handles clicks on theme cards, appearance toggles, and material style buttons.
     * Extracted from Basic's enhancer object.
     * @param {HTMLElement} target - Click target
     * @param {HTMLElement} modal - Modal element
     * @param {YouTubePlusModalHandlers} handlers - Modal handlers facade
     * @param {SettingsModalContext} context - Context object (carries settings + saveSettings)
     * @returns {boolean} true if handled
     */
    function handleThemeOptionsClick(target, modal, handlers, context) {
      const saveSettings = context.saveSettingsBound || context.saveSettings;
      const styleBtn = target.closest('.yp-theme-style-btn[data-layout][data-style]');
      if (styleBtn instanceof HTMLElement) {
        handleThemeStyleButton_(styleBtn, modal, handlers, context, saveSettings);
        return true;
      }

      const themeOption = target.closest(
        '.yp-theme-card[data-setting-card][data-value],.yp-theme-pref-btn[data-setting-card][data-value]'
      );
      if (themeOption instanceof HTMLElement) {
        handleThemeOptionCard_(themeOption, modal, handlers, context, saveSettings);
        return true;
      }
      return false;
    }

    window.YouTubePlusModalHandlers = /** @type {YouTubePlusModalHandlers} */ ({
      setSettingByPath,
      safelySaveSettings,
      handleSimpleSettingToggle,
      activateSettingsSection,
      handleSidebarNavigation,
      applySettingLive,
      handleMusicSettingToggle,
      isMusicSetting,
      createFocusTrap,
      initGlassDropdown,
      handleModalClickActions,
      handleThemeOptionsClick,
      resolveModifierComboValue,
      formatModifierComboLabel,
      buildModifierComboOptionItems,
      buildModifierComboDropdownItems,
    });
  }
})();
