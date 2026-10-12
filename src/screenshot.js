// Captures video player frames to download or copy to clipboard.
// Public surface: window.YouTubePlusScreenshot.
(function () {
  const logger = window.YouTubeUtils?.logger || window.YouTubePlusLogger || null;
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'Screenshot');

  /**
   * The subset of basic.js's page enhancer this module reads.
   * @typedef {{
   *   getElement?: (selector: string, useCache?: boolean) => Element | null,
   *   showNotification?: (message: string, duration?: number) => void,
   *   isEditableTarget?: (target: EventTarget | null) => boolean
   * }} EnhancerLike
   */

  // Camera icon shared with the registry descriptor.
  const FEATURE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="0.5" d="M7.142 18.9706C5.18539 18.8995 3.99998 18.6568 3.17157 17.8284C2 16.6569 2 14.7712 2 11C2 7.22876 2 5.34315 3.17157 4.17157C4.34315 3 6.22876 3 10 3H14C17.7712 3 19.6569 3 20.8284 4.17157C22 5.34315 22 7.22876 22 11C22 14.7712 22 16.6569 20.8284 17.8284C20.0203 18.6366 18.8723 18.8873 17 18.965" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path d="M9.94955 16.0503C10.8806 15.1192 11.3461 14.6537 11.9209 14.6234C11.9735 14.6206 12.0261 14.6206 12.0787 14.6234C12.6535 14.6537 13.119 15.1192 14.0501 16.0503C16.0759 18.0761 17.0888 19.089 16.8053 19.963C16.7809 20.0381 16.7506 20.1112 16.7147 20.1815C16.2973 21 14.8648 21 11.9998 21C9.13482 21 7.70233 21 7.28489 20.1815C7.249 20.1112 7.21873 20.0381 7.19436 19.963C6.91078 19.089 7.92371 18.0761 9.94955 16.0503Z" stroke="currentColor" stroke-width="1.5"></path></svg>';

  /**
   * Resolve video element from enhancer or player selectors.
   * @param {EnhancerLike | null} [enhancer]
   * @returns {HTMLVideoElement | null}
   */
  const resolveVideo = enhancer => {
    const candidate =
      (typeof enhancer?.getElement === 'function' ? enhancer.getElement('video', false) : null) ||
      document.querySelector('video.html5-main-video') ||
      document.querySelector('#movie_player video') ||
      document.querySelector('video');
    return candidate instanceof HTMLVideoElement ? candidate : null;
  };

  const showNotification = (
    /** @type {EnhancerLike | null | undefined} */ enhancer,
    /** @type {string} */ message,
    duration = 2000
  ) => {
    if (typeof enhancer?.showNotification === 'function') {
      enhancer.showNotification(message, duration);
      return;
    }
    const pc = window.YouTubePlusPopoverController;
    if (pc && typeof pc.showToast === 'function') {
      pc.showToast(message, { duration });
      return;
    }
    U?.NotificationManager?.show?.(message, { duration, type: 'info' });
  };

  /**
   * @param {EnhancerLike | null} [enhancer]
   * @returns {boolean}
   */
  function capture(enhancer) {
    const video = resolveVideo(enhancer);
    if (!video) return false;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || video.clientWidth || 1920;
    canvas.height = video.videoHeight || video.clientHeight || 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const videoTitle = document.title.replace(/\s-\sYouTube$/, '').trim() || 'video';
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${videoTitle}.png`;

    try {
      link.click();
      const translated = typeof U?.t === 'function' ? U.t('screenshotSaved') : null;
      const message =
        translated && translated !== 'screenshotSaved' ? translated : 'Screenshot saved';
      showNotification(enhancer, message, 2000);
      return true;
    } catch (err) {
      logS(err);
      U?.logError?.('Screenshot', 'Screenshot download failed', err);
      const translatedFail = typeof U?.t === 'function' ? U.t('screenshotFailed') : null;
      const failMsg =
        translatedFail && translatedFail !== 'screenshotFailed'
          ? translatedFail
          : 'Screenshot failed';
      showNotification(enhancer, failMsg, 3000);
      return false;
    }
  }

  const DESCRIPTOR = Object.freeze({
    id: 'screenshot',
    titleKey: 'takeScreenshot',
    fallbackTitle: 'Take screenshot',
    settingsKey: 'enableScreenshot',
    hotkey: { key: 's', allowShift: false, allowModifiers: false },
    iconSVG: FEATURE_SVG,
    command(/** @type {unknown} */ shim) {
      return capture(/** @type {EnhancerLike} */ (shim));
    },
  });

  if (typeof window !== 'undefined') {
    window.YouTubePlusFeatureRegistry?.register?.(DESCRIPTOR);
  }

  /** @type {YouTubePlusFeatureContext | null} */
  let shotCtx = null;
  /** @type {YouTubePlusFeatureContext | null} */
  let classicScope = null;
  /** @type {YouTubePlusFeatureContext | null} */
  let hotkeyScope = null;
  /** @type {EnhancerLike | null} */
  let lastEnhancer = null;

  /** @param {YouTubePlusFeatureContext | null} scope */
  const renewScope = scope => {
    scope?.dispose();
    return shotCtx ? shotCtx.scope() : null;
  };

  /**
   * Add the Classic-surface screenshot button from the shared descriptor.
   * @param {EnhancerLike | null} enhancer
   * @param {Element | null} controls
   */
  function addButton(enhancer, controls) {
    if (enhancer) lastEnhancer = enhancer;
    if (!(shotCtx && controls)) return;
    if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') return;
    classicScope = renewScope(classicScope);
    if (!classicScope) return;
    controls.querySelector?.('.yp-screenshot-button')?.remove();
    const desc = window.YouTubePlusFeatureRegistry?.get?.('screenshot') || DESCRIPTOR;
    const button = window.YouTubePlusPlayerActionHost.createButton(desc, {
      className: 'ytp-button yp-screenshot-button',
    });
    classicScope.listen(button, 'click', () => capture(lastEnhancer));
    classicScope.own(button);
    controls.insertBefore(button, controls.firstChild);
  }

  /** @type {{ key: string, shiftKey: boolean, altKey: boolean, ctrlKey: boolean }} */
  const DEFAULT_SHORTCUT = Object.freeze({
    key: 'S',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
  });

  const STORAGE_KEY = 'youtube_screenshot_settings';

  /** @type {{ shortcut: { key: string, shiftKey: boolean, altKey: boolean, ctrlKey: boolean }, storageKey: string }} */
  const screenshotSettings = {
    shortcut: { ...DEFAULT_SHORTCUT },
    storageKey: STORAGE_KEY,
  };

  /** Module namespace in the shared settings blob. */
  const MODULE_NAME = 'screenshot';

  /** @returns {YouTubePlusSettingsStore | null} the store when the blob bridge is active */
  const sharedStore = () => window.YouTubePlusSettingsStore?.moduleBridge?.() ?? null;

  /**
   * Apply a stored settings object to the live shortcut, normalizing values.
   * @param {Record<string, unknown>|null|undefined} parsed
   */
  function applyShortcutSettings(parsed) {
    const sc =
      /** @type {{ key?: unknown; shiftKey?: unknown; altKey?: unknown; ctrlKey?: unknown } | null | undefined} */ (
        parsed?.shortcut
      );
    if (sc && typeof sc === 'object') {
      if (typeof sc.key === 'string' && sc.key.trim().length > 0) {
        screenshotSettings.shortcut.key = sc.key.trim().charAt(0).toUpperCase();
      }
      if (typeof sc.shiftKey === 'boolean') screenshotSettings.shortcut.shiftKey = sc.shiftKey;
      if (typeof sc.altKey === 'boolean') screenshotSettings.shortcut.altKey = sc.altKey;
      if (typeof sc.ctrlKey === 'boolean') screenshotSettings.shortcut.ctrlKey = sc.ctrlKey;
    }
  }

  /** @returns {Record<string, unknown>|null|undefined} legacy key payload */
  function readLegacySettings() {
    return /** @type {Record<string, unknown>|null|undefined} */ (
      U?.storage?.get?.(screenshotSettings.storageKey)
    );
  }

  /**
   * Read shortcut preferences. From the shared blob once it exists (migrating
   * the legacy key on first read), otherwise from the legacy key.
   */
  function loadSettings() {
    const store = sharedStore();
    if (store) {
      const mod = store.getModuleSettings(MODULE_NAME);
      if (mod && Object.keys(mod).length) {
        applyShortcutSettings(mod);
        return;
      }
      applyShortcutSettings(readLegacySettings());
      saveSettings();
      return;
    }
    applyShortcutSettings(readLegacySettings());
  }

  /** Persist shortcut preferences through the shared settings bridge. */
  function saveSettings() {
    const store = sharedStore();
    if (store) {
      store.updateModuleSettings(MODULE_NAME, { shortcut: { ...screenshotSettings.shortcut } });
      return;
    }
    U?.storage?.set?.(screenshotSettings.storageKey, {
      shortcut: screenshotSettings.shortcut,
    });
  }

  /**
   * Format modifier flags into a combo string.
   * @param {{ ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean }} sc
   * @returns {string}
   */
  const getModifierCombo = sc => {
    const resolver = window.YouTubePlusDesignSystem?.resolveModifierComboValue;
    if (typeof resolver === 'function') return resolver(sc);
    const parts = [];
    if (sc?.ctrlKey) parts.push('ctrl');
    if (sc?.altKey) parts.push('alt');
    if (sc?.shiftKey) parts.push('shift');
    return parts.length ? parts.join('+') : 'none';
  };

  /**
   * @param {Element | null | unknown} targetOrEvent
   * @returns {{ root: Element, item: HTMLElement } | null}
   */
  function resolveSettingsRoot(targetOrEvent) {
    const container = targetOrEvent instanceof Element ? targetOrEvent : null;
    const root =
      container ||
      document.querySelector('.yp-settings-modal') ||
      document.querySelector('.screenshot-submenu') ||
      document.body;
    if (!root) return null;
    const item =
      root.querySelector('.screenshot-settings-item') ||
      root.querySelector('.screenshot-submenu') ||
      (root instanceof HTMLElement &&
      (root.classList.contains('screenshot-settings-item') ||
        root.classList.contains('screenshot-submenu'))
        ? root
        : null);
    if (!(item instanceof HTMLElement) || item.dataset.handlerAttached === '1') return null;
    item.dataset.handlerAttached = '1';
    return { root, item };
  }

  /**
   * @param {Element | null} dd
   * @param {string} combo
   */
  function syncDropdownLabel(dd, combo) {
    if (!(dd instanceof HTMLElement)) return;
    const labelEl = dd.querySelector('.glass-dropdown__label');
    if (!labelEl) return;
    const formatLabel = window.YouTubePlusDesignSystem?.formatModifierComboLabel;
    if (typeof formatLabel === 'function') {
      labelEl.textContent = formatLabel(combo, {
        noneLabel: U?.t?.('none') || 'None',
        translatePart: (/** @type {string} */ part) => U?.t?.(part.toLowerCase()) || part,
      });
    } else {
      labelEl.textContent = combo;
    }
  }

  /**
   * @param {Element} root
   * @param {string} combo
   */
  function wireModifierInputs(root, combo) {
    const dd = /** @type {HTMLSelectElement | null} */ (
      root.querySelector('#screenshot-modifier-dropdown')
    );
    const sel = /** @type {HTMLSelectElement | HTMLInputElement | null} */ (
      root.querySelector('#screenshot-modifier-combo') ||
        root.querySelector('#screenshot-modifier-dropdown')
    );

    if (dd && sel && dd !== sel) {
      window.YouTubePlusDesignSystem?.initGlassDropdown?.({
        dropdown: dd,
        hiddenSelect: sel,
      });
    }

    if (dd && 'value' in dd) {
      /** @type {HTMLSelectElement} */ (dd).value = combo;
    }

    const onModifierChange = (/** @type {HTMLSelectElement | HTMLInputElement} */ el) => {
      const val = el.value;
      if (sel && sel !== el) sel.value = val;
      if (dd && dd !== el && 'value' in dd) /** @type {HTMLSelectElement} */ (dd).value = val;
      screenshotSettings.shortcut.ctrlKey = val.includes('ctrl');
      screenshotSettings.shortcut.altKey = val.includes('alt');
      screenshotSettings.shortcut.shiftKey = val.includes('shift');
      saveSettings();
    };

    if (sel instanceof HTMLSelectElement || sel instanceof HTMLInputElement) {
      sel.value = combo;
      syncDropdownLabel(dd, combo);
      window.YouTubePlusCleanupManager?.registerListener?.(
        sel,
        'change',
        () => onModifierChange(sel),
        undefined,
        false
      );
    }
    if (dd && dd !== sel && dd.tagName === 'SELECT') {
      window.YouTubePlusCleanupManager?.registerListener?.(
        dd,
        'change',
        () => onModifierChange(/** @type {HTMLSelectElement} */ (dd)),
        undefined,
        false
      );
    }
  }

  /**
   * @param {Element} root
   */
  function wireKeyField(root) {
    const keyField = root.querySelector('#screenshot-key');
    if (!(keyField instanceof HTMLInputElement)) return;
    if (screenshotSettings.shortcut.key) {
      keyField.value = screenshotSettings.shortcut.key;
    }
    window.YouTubePlusCleanupManager?.registerListener?.(
      keyField,
      'input',
      () => {
        const char = keyField.value.trim().charAt(0);
        if (char) {
          screenshotSettings.shortcut.key = char.toUpperCase();
          keyField.value = screenshotSettings.shortcut.key;
          saveSettings();
        }
      },
      undefined,
      false
    );
    window.YouTubePlusCleanupManager?.registerListener?.(
      keyField,
      'keydown',
      (/** @type {KeyboardEvent} */ e) => {
        e.stopPropagation();
      },
      undefined,
      false
    );
  }

  /**
   * Wire modifier dropdown and key input in settings modal.
   * @param {Element | null | unknown} [targetOrEvent]
   */
  function attachSettingsHandlers(targetOrEvent) {
    const context = resolveSettingsRoot(targetOrEvent);
    if (!context) return;

    loadSettings();

    const combo = getModifierCombo(screenshotSettings.shortcut);
    wireModifierInputs(context.root, combo);
    wireKeyField(context.root);
  }

  const setupSettingsIntegration = () => {
    window.YouTubePlusCleanupManager?.registerListener?.(
      document,
      'youtube-plus-settings-modal-opened',
      attachSettingsHandlers,
      undefined,
      false
    );
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'storage',
      (/** @type {StorageEvent} */ e) => {
        if (e?.key === screenshotSettings.storageKey) {
          loadSettings();
        }
      },
      undefined,
      false
    );
    // Blob changes arrive through the unified event; only screenshot keys matter.
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'youtube-plus-settings-updated',
      (/** @type {CustomEvent & { changedKeys?: string[] }} */ e) => {
        if (window.YouTubePlusSettingsStore?.affectsModule?.(e, MODULE_NAME) === false) return;
        loadSettings();
      },
      undefined,
      false
    );
  };

  /** @param {KeyboardEvent} e */
  const onHotkey = e => {
    if (!e?.key) return;
    const sc = screenshotSettings.shortcut;
    const pressedKey = e.key.toUpperCase();
    const targetKey = (sc.key || 'S').toUpperCase();
    if (pressedKey !== targetKey) return;
    if (Boolean(e.shiftKey) !== Boolean(sc.shiftKey)) return;
    if (Boolean(e.altKey) !== Boolean(sc.altKey)) return;
    if (Boolean(e.ctrlKey) !== Boolean(sc.ctrlKey)) return;
    if (e.metaKey) return;

    const enhancer = lastEnhancer;
    const target = document.activeElement;
    const editable =
      typeof enhancer?.isEditableTarget === 'function'
        ? enhancer.isEditableTarget(target)
        : (U?.isEditableTarget?.(target) ?? false);
    if (editable) return;
    e.preventDefault();
    capture(enhancer);
  };

  const attachHotkey = () => {
    hotkeyScope = renewScope(hotkeyScope);
    hotkeyScope?.listen(document, 'keydown', /** @type {EventListener} */ (onHotkey));
  };

  /**
   * Register keyboard shortcut listener.
   * @param {EnhancerLike} [enhancer]
   */
  function registerHotkey(enhancer) {
    if (enhancer) lastEnhancer = enhancer;
    attachHotkey();
  }

  /** Release the Classic screenshot button and its click listener. */
  const removeClassicButton = () => {
    classicScope?.dispose();
    classicScope = null;
  };

  const screenshotFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'screenshot',
    settingsKey: 'enableScreenshot',
    // The hotkey captures whatever video is playing, Shorts included; the
    // button renders on the watch player.
    routes: ['watch', 'shorts'],
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      shotCtx = ctx;
      attachHotkey();
      // In the Vision variant the dock button comes from VisionDockHost.
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() !== 'vision') {
        addButton(lastEnhancer, document.querySelector('.ytp-right-controls'));
      }
    },
    stop() {
      removeClassicButton();
      hotkeyScope?.dispose();
      hotkeyScope = null;
      shotCtx = null;
    },
  });

  loadSettings();
  setupSettingsIntegration();

  if (typeof window !== 'undefined') {
    window.YouTubePlusScreenshot = /** @type {YouTubePlusScreenshot} */ ({
      DESCRIPTOR,
      addButton,
      removeClassicButton,
      registerHotkey,
      loadSettings,
      saveSettings,
      getSettings: () => screenshotSettings,
      attachSettingsHandlers,
    });
    // Test-only hooks.
    U?.exposeTestHooks?.(window.YouTubePlusScreenshot, {
      capture,
      screenshotSettings,
      loadSettings,
      saveSettings,
      attachSettingsHandlers,
      onHotkey,
    });
  }

  screenshotFeature?.sync();
  logger?.debug?.('screenshot', 'Screenshot module loaded');
})();
