/**
 * Modal Event Handlers
 * Extracted from createSettingsModal to reduce complexity
 */

(function () {
  /* global GM_setValue, GM_getValue */

  // DOM cache helper from YouTubeUtils
  const U = window.YouTubeUtils;
  const qs = U?.$ || document.querySelector.bind(document);

  /**
   * Safely set a setting by path (supports dot notation)
   * @param {Record<string, any>} settings
   * @param {string} path
   * @param {any} value
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
      cur = cur[k];
    }
    cur[lastKey] = value;
  };

  /**
   * Initialize download sites settings
   * @param {Object} settings - Settings object
   */
  const initializeDownloadSites = (/** @type {any} */ settings) => {
    if (!settings.downloadSites) {
      settings.downloadSites = { externalDownloader: true, ytdl: true, direct: true };
    }
    // Migrate old key if present
    if (settings.downloadSites && Object.hasOwn(settings.downloadSites, 'y2mate')) {
      if (!Object.hasOwn(settings.downloadSites, 'externalDownloader')) {
        settings.downloadSites.externalDownloader = settings.downloadSites.y2mate;
      }
      delete settings.downloadSites.y2mate;
    }
  };

  /**
   * Toggle download site controls visibility
   * @param {HTMLInputElement} checkbox - Checkbox element
   */
  const toggleDownloadSiteControls = checkbox => {
    try {
      const container = checkbox.closest('.download-site-option');
      if (container) {
        const controls = container.querySelector('.download-site-controls');
        if (controls) {
          /** @type {any} */ (controls).style.display = checkbox.checked ? 'block' : 'none';
        }
      }
    } catch (err) {
      window.YouTubePlusLogger?.warn?.(
        'ModalHandlers',
        'toggle download-site-controls failed:',
        err
      );
    }
  };

  /**
   * Save settings safely
   * @param {Function} saveSettings - Save function
   */
  const safelySaveSettings = (/** @type {Function} */ saveSettings) => {
    try {
      saveSettings();
    } catch (err) {
      window.YouTubePlusLogger?.warn?.(
        'ModalHandlers',
        'autosave downloadSite toggle failed:',
        err
      );
    }
  };

  /**
   * Handle download site checkbox toggle
   * @param {HTMLElement} target - Checkbox element
   * @param {string} key - Site key (y2mate, ytdl, direct)
   * @param {Object} settings - Settings object
   * @param {Function} markDirty - Function to mark modal as dirty
   * @param {Function} saveSettings - Function to save settings
   */
  const handleDownloadSiteToggle = (
    /** @type {HTMLElement} */ target,
    /** @type {string} */ key,
    /** @type {any} */ settings,
    /** @type {Function} */ markDirty,
    /** @type {Function} */ saveSettings
  ) => {
    initializeDownloadSites(settings);

    const checkbox = /** @type {HTMLInputElement} */ (target);
    settings.downloadSites[key] = checkbox.checked;

    try {
      markDirty();
    } catch (_e) {
      U.logSuppressed(_e, 'ModalHandlers');
    }

    toggleDownloadSiteControls(checkbox);
    rebuildDownloadDropdown(settings);
    safelySaveSettings(saveSettings);
  };

  /**
   * Handle Download button live toggle
   * @param {Object} context - Context object with methods
   */
  const handleDownloadButtonToggle = (/** @type {any} */ context) => {
    const { settings, getElement, addDownloadButton } = context;
    const controls = getElement('.ytp-right-controls');
    const existing = getElement('.ytp-download-button', false);

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
  const handleSpeedControlToggle = (/** @type {any} */ context) => {
    const { settings, getElement, addSpeedControlButton } = context;
    const controls = getElement('.ytp-right-controls');
    const existing = getElement('.speed-control-btn', false);

    if (settings.enableSpeedControl) {
      if (controls && !existing) addSpeedControlButton(controls);
    } else {
      if (existing) existing.remove();
      const speedOptions = qs('.speed-options');
      if (speedOptions) speedOptions.remove();
    }
  };

  /**
   * Update global settings exposure
   * @param {Object} settings - Settings object
   */
  const updateGlobalSettings = (/** @type {any} */ settings) => {
    if (typeof window !== 'undefined' && window.youtubePlus) {
      window.youtubePlus.settings = window.youtubePlus.settings || settings;
    }
  };

  /**
   * Apply setting changes live to the UI
   * @param {string} setting - Setting key
   * @param {Object} context - Context object with methods
   */
  const applySettingLive = (/** @type {string} */ setting, /** @type {any} */ context) => {
    const { settings, refreshDownloadButton } = context;

    try {
      // Update page elements (show/hide buttons, dropdowns)
      if (context.updatePageBasedOnSettings) {
        context.updatePageBasedOnSettings();
      }

      // Dispatch to specific handlers
      if (setting === 'enableDownload') {
        handleDownloadButtonToggle(context);
      } else if (setting === 'enableSpeedControl') {
        handleSpeedControlToggle(context);
      }

      // Ensure visibility state updates
      if (refreshDownloadButton) {
        refreshDownloadButton();
      }
    } catch (innerErr) {
      window.YouTubePlusLogger?.warn?.(
        'ModalHandlers',
        'live apply specific toggle failed:',
        innerErr
      );
    }

    // Expose updated settings globally for other modules
    updateGlobalSettings(settings);
  };

  /**
   * Handle simple setting checkbox toggle
   * @param {HTMLElement} target - Checkbox element
   * @param {string} setting - Setting key
   * @param {Object} settings - Settings object
   * @param {Object} context - Context object with methods
   * @param {Function} markDirty - Function to mark modal as dirty
   * @param {Function} saveSettings - Function to save settings
   * @param {HTMLElement} modal - Modal element
   */
  const handleSimpleSettingToggle = (
    target,
    setting,
    settings,
    context,
    markDirty,
    saveSettings,
    modal
  ) => {
    const checked = /** @type {HTMLInputElement} */ (target).checked;
    setSettingByPath(settings, setting, checked);

    if (setting === 'zenStyles.sideVideosColumnsEnabled' && checked) {
      const currentValue = Number(/** @type {any} */ (settings).zenStyles?.sideVideosColumns);
      if (!Number.isFinite(currentValue) || currentValue <= 0) {
        setSettingByPath(settings, 'zenStyles.sideVideosColumns', 1);
        const select = modal.querySelector(
          '.style-side-videos-submenu select[data-setting="zenStyles.sideVideosColumns"]'
        );
        if (select instanceof HTMLSelectElement) {
          select.value = '1';
        }
      }
    }

    // Mark modal as dirty
    try {
      markDirty();
    } catch (_e) {
      U.logSuppressed(_e, 'ModalHandlers');
    }

    // Apply settings immediately
    try {
      applySettingLive(setting, context);
    } catch (err) {
      window.YouTubePlusLogger?.warn?.('ModalHandlers', 'apply settings live failed:', err);
    }

    // Persist immediately
    try {
      saveSettings();
    } catch (err) {
      window.YouTubePlusLogger?.warn?.('ModalHandlers', 'autosave simple setting failed:', err);
    }

    // Show/hide submenu for Download
    if (setting === 'enableDownload') {
      const submenu = modal.querySelector('.download-submenu');
      if (submenu) {
        /** @type {any} */ (submenu).style.display = checked ? 'block' : 'none';
      }
      const toggleBtn = modal.querySelector('.ytp-plus-submenu-toggle[data-submenu="download"]');
      if (toggleBtn instanceof HTMLElement) {
        if (checked) {
          toggleBtn.removeAttribute('disabled');
          toggleBtn.setAttribute('aria-expanded', 'true');
          /** @type {any} */ (toggleBtn).style.display = 'inline-flex';
        } else {
          toggleBtn.setAttribute('disabled', '');
          toggleBtn.setAttribute('aria-expanded', 'false');
          /** @type {any} */ (toggleBtn).style.display = 'none';
        }
      }
    }

    // Show/hide submenu for Zen Styles
    if (setting === 'enableZenStyles') {
      const submenu = modal.querySelector('.style-submenu');
      if (submenu) {
        /** @type {any} */ (submenu).style.display = checked ? 'block' : 'none';
      }
      const toggleBtn = modal.querySelector('.ytp-plus-submenu-toggle[data-submenu="style"]');
      if (toggleBtn instanceof HTMLElement) {
        if (checked) {
          toggleBtn.removeAttribute('disabled');
          toggleBtn.setAttribute('aria-expanded', 'true');
          /** @type {any} */ (toggleBtn).style.display = 'inline-flex';
        } else {
          toggleBtn.setAttribute('disabled', '');
          toggleBtn.setAttribute('aria-expanded', 'false');
          /** @type {any} */ (toggleBtn).style.display = 'none';
        }
      }
    }

    if (setting === 'zenStyles.sideVideosColumnsEnabled') {
      const submenu = modal.querySelector(
        '.style-side-videos-submenu[data-submenu="style-side-videos"]'
      );
      if (submenu instanceof HTMLElement) {
        submenu.style.display = checked ? 'block' : 'none';
      }
      const toggleBtn = modal.querySelector(
        '.ytp-plus-submenu-toggle[data-submenu="style-side-videos"]'
      );
      if (toggleBtn instanceof HTMLElement) {
        if (checked) {
          toggleBtn.removeAttribute('disabled');
          toggleBtn.setAttribute('aria-expanded', 'true');
          toggleBtn.style.display = 'inline-flex';
        } else {
          toggleBtn.setAttribute('disabled', '');
          toggleBtn.setAttribute('aria-expanded', 'false');
          toggleBtn.style.display = 'none';
        }
      }
    }

    // Show/hide submenu for Speed Control
    if (setting === 'enableSpeedControl') {
      const submenu = modal.querySelector('.speed-submenu');
      if (submenu) {
        /** @type {any} */ (submenu).style.display = checked ? 'block' : 'none';
      }
      const toggleBtn = modal.querySelector('.ytp-plus-submenu-toggle[data-submenu="speed"]');
      if (toggleBtn instanceof HTMLElement) {
        if (checked) {
          toggleBtn.removeAttribute('disabled');
          toggleBtn.setAttribute('aria-expanded', 'true');
          /** @type {any} */ (toggleBtn).style.display = 'inline-flex';
        } else {
          toggleBtn.setAttribute('disabled', '');
          toggleBtn.setAttribute('aria-expanded', 'false');
          /** @type {any} */ (toggleBtn).style.display = 'none';
        }
      }
    }

    // Show/hide submenu for Enhanced Features
    if (setting === 'enableEnhanced') {
      const submenu = modal.querySelector('.enhanced-submenu');
      if (submenu) {
        /** @type {any} */ (submenu).style.display = checked ? 'block' : 'none';
      }
      const toggleBtn = modal.querySelector('.ytp-plus-submenu-toggle[data-submenu="enhanced"]');
      if (toggleBtn instanceof HTMLElement) {
        if (checked) {
          toggleBtn.removeAttribute('disabled');
          toggleBtn.setAttribute('aria-expanded', 'true');
          /** @type {any} */ (toggleBtn).style.display = 'inline-flex';
        } else {
          toggleBtn.setAttribute('disabled', '');
          toggleBtn.setAttribute('aria-expanded', 'false');
          /** @type {any} */ (toggleBtn).style.display = 'none';
        }
      }
    }

    // Show/hide submenu for Loop
    if (setting === 'enableLoop') {
      const submenu = modal.querySelector('.loop-submenu');
      if (submenu) {
        /** @type {any} */ (submenu).style.display = checked ? 'block' : 'none';
      }
      const toggleBtn = modal.querySelector('.ytp-plus-submenu-toggle[data-submenu="loop"]');
      if (toggleBtn instanceof HTMLElement) {
        if (checked) {
          toggleBtn.removeAttribute('disabled');
          toggleBtn.setAttribute('aria-expanded', 'true');
          /** @type {any} */ (toggleBtn).style.display = 'inline-flex';
        } else {
          toggleBtn.setAttribute('disabled', '');
          toggleBtn.setAttribute('aria-expanded', 'false');
          /** @type {any} */ (toggleBtn).style.display = 'none';
        }
      }
    }
  };

  /**
   * Handle download site customization input
   * @param {HTMLElement} target - Input element
   * @param {string} site - Site key
   * @param {string} field - Field name (name or url)
   * @param {Object} settings - Settings object
   * @param {Function} markDirty - Function to mark modal as dirty
   * @param {Function} t - Translation function
   */
  /**
   * Initialize download site customization settings
   * @param {Object} settings - Settings object
   */
  const initializeDownloadCustomization = (/** @type {any} */ settings) => {
    if (!settings.downloadSiteCustomization) {
      settings.downloadSiteCustomization = {
        externalDownloader: { name: 'SSYouTube', url: 'https://ssyoutube.com/watch?v={videoId}' },
      };
    }
    // Migrate previous customization
    if (
      settings.downloadSiteCustomization &&
      Object.hasOwn(settings.downloadSiteCustomization, 'y2mate')
    ) {
      if (!Object.hasOwn(settings.downloadSiteCustomization, 'externalDownloader')) {
        settings.downloadSiteCustomization.externalDownloader =
          settings.downloadSiteCustomization.y2mate;
      }
      delete settings.downloadSiteCustomization.y2mate;
    }
  };

  /**
   * Initialize specific download site settings
   * @param {Object} settings - Settings object
   * @param {string} site - Site key
   */
  const initializeDownloadSite = (/** @type {any} */ settings, /** @type {string} */ site) => {
    if (!settings.downloadSiteCustomization[site]) {
      settings.downloadSiteCustomization[site] = { name: '', url: '' };
    }
  };

  /**
   * Get fallback name for download site
   * @param {string} site - Site key
   * @param {Function} t - Translation function
   * @returns {string} Fallback name
   */
  const getDownloadSiteFallbackName = (/** @type {string} */ site, /** @type {Function} */ t) => {
    if (site === 'externalDownloader') return 'SSYouTube';
    if (site === 'ytdl') return t('byYTDL');
    return t('directDownload');
  };

  /**
   * Update download site name in UI
   * @param {HTMLElement} target - Input element
   * @param {string} site - Site key
   * @param {Function} t - Translation function
   */
  const updateDownloadSiteName = (
    /** @type {HTMLElement} */ target,
    /** @type {string} */ site,
    /** @type {Function} */ t
  ) => {
    const nameDisplay = target
      .closest('.download-site-option')
      ?.querySelector('.download-site-name');

    if (nameDisplay) {
      const inputValue = /** @type {HTMLInputElement} */ (target).value;
      const fallbackName = getDownloadSiteFallbackName(site, t);
      nameDisplay.textContent = inputValue || fallbackName;
    }
  };

  /**
   * Rebuild download dropdown in UI
   * @param {Object} settings - Settings object
   */
  const rebuildDownloadDropdown = (/** @type {any} */ settings) => {
    try {
      if (
        typeof window !== 'undefined' &&
        window.youtubePlus &&
        typeof window.youtubePlus.rebuildDownloadDropdown === 'function'
      ) {
        window.youtubePlus.settings = window.youtubePlus.settings || settings;
        window.youtubePlus.rebuildDownloadDropdown();
      }
    } catch (err) {
      window.YouTubePlusLogger?.warn?.(
        'ModalHandlers',
        'rebuildDownloadDropdown call failed:',
        err
      );
    }
  };

  /**
   * Handle download site input change
   * @param {HTMLElement} target - Input element
   * @param {string} site - Site key (y2mate, ytdl, direct)
   * @param {string} field - Field name (name, url)
   * @param {Object} settings - Settings object
   * @param {Function} markDirty - Function to mark modal as dirty
   * @param {Function} t - Translation function
   */
  const handleDownloadSiteInput = (
    /** @type {HTMLElement} */ target,
    /** @type {string} */ site,
    /** @type {string} */ field,
    /** @type {any} */ settings,
    /** @type {Function} */ markDirty,
    /** @type {Function} */ t
  ) => {
    initializeDownloadCustomization(settings);
    initializeDownloadSite(settings, site);

    settings.downloadSiteCustomization[site][field] = /** @type {HTMLInputElement} */ (
      target
    ).value;

    try {
      markDirty();
    } catch (_e) {
      U.logSuppressed(_e, 'ModalHandlers');
    }

    if (field === 'name') {
      updateDownloadSiteName(/** @type {any} */ (target), site, t);
    }

    rebuildDownloadDropdown(settings);
  };

  /**
   * Handle Y2Mate save button
   * @param {HTMLElement} target - Button element
   * @param {Object} settings - Settings object
   * @param {Function} saveSettings - Function to save settings
   * @param {Function} showNotification - Function to show notification
   * @param {Function} t - Translation function
   */
  /**
   * Ensure external downloader settings structure exists
   * @param {Object} settings - Settings object
   */
  const ensureExternalDownloaderStructure = (/** @type {any} */ settings) => {
    if (!settings.downloadSiteCustomization) {
      settings.downloadSiteCustomization = {
        externalDownloader: { name: 'SSYouTube', url: 'https://ssyoutube.com/watch?v={videoId}' },
      };
    }
    if (!settings.downloadSiteCustomization.externalDownloader) {
      settings.downloadSiteCustomization.externalDownloader = { name: '', url: '' };
    }
  };

  /**
   * Read external downloader input values from container
   * @param {HTMLElement} container - Container element
   * @param {Object} settings - Settings object
   */
  const readExternalDownloaderInputs = (
    /** @type {HTMLElement} */ container,
    /** @type {any} */ settings
  ) => {
    const nameInput = container.querySelector(
      'input.download-site-input[data-site="externalDownloader"][data-field="name"]'
    );
    const urlInput = container.querySelector(
      'input.download-site-input[data-site="externalDownloader"][data-field="url"]'
    );
    if (nameInput) settings.downloadSiteCustomization.externalDownloader.name = nameInput.value;
    if (urlInput) settings.downloadSiteCustomization.externalDownloader.url = urlInput.value;
  };

  /**
   * Trigger rebuild of the download dropdown if available
   */
  const triggerRebuildDropdown = () => {
    try {
      if (
        typeof window !== 'undefined' &&
        window.youtubePlus &&
        typeof window.youtubePlus.rebuildDownloadDropdown === 'function'
      ) {
        window.youtubePlus.rebuildDownloadDropdown();
      }
    } catch (err) {
      window.YouTubePlusLogger?.warn?.(
        'ModalHandlers',
        'rebuildDownloadDropdown call failed:',
        err
      );
    }
  };

  const handleExternalDownloaderSave = (
    /** @type {HTMLElement} */ target,
    /** @type {any} */ settings,
    /** @type {Function} */ saveSettings,
    /** @type {Function} */ showNotification,
    /** @type {Function} */ t
  ) => {
    ensureExternalDownloaderStructure(settings);

    const container = target.closest('.download-site-option');
    if (container) {
      readExternalDownloaderInputs(/** @type {any} */ (container), settings);
    }

    saveSettings();

    if (window.youtubePlus) {
      window.youtubePlus.settings = window.youtubePlus.settings || settings;
    }
    triggerRebuildDropdown();
    try {
      const msg =
        (t && typeof t === 'function' && t('externalDownloaderSettingsSaved')) ||
        t('y2mateSettingsSaved');
      showNotification(msg);
    } catch (_e) {
      showNotification('Settings saved');
    }
  };

  /**
   * Reset external downloader to default values
   * @param {Object} settings - Settings object
   */
  const resetExternalDownloaderToDefaults = (/** @type {any} */ settings) => {
    ensureExternalDownloaderStructure(settings);
    settings.downloadSiteCustomization.externalDownloader = {
      name: 'SSYouTube',
      url: 'https://ssyoutube.com/watch?v={videoId}',
    };
  };

  /**
   * Update Y2Mate modal inputs
   * @param {HTMLElement} container - Container element
   * @param {Object} settings - Settings object
   */
  const updateExternalDownloaderModalInputs = (
    /** @type {HTMLElement} */ container,
    /** @type {any} */ settings
  ) => {
    const nameInput = container.querySelector(
      'input.download-site-input[data-site="externalDownloader"][data-field="name"]'
    );
    const urlInput = container.querySelector(
      'input.download-site-input[data-site="externalDownloader"][data-field="url"]'
    );
    const nameDisplay = container.querySelector('.download-site-name');

    const edSettings = settings.downloadSiteCustomization.externalDownloader;
    if (nameInput) nameInput.value = edSettings.name;
    if (urlInput) urlInput.value = edSettings.url;
    if (nameDisplay) nameDisplay.textContent = edSettings.name;
  };

  /**
   * Handle Y2Mate reset button
   * @param {HTMLElement} modal - Modal element
   * @param {Object} settings - Settings object
   * @param {Function} saveSettings - Function to save settings
   * @param {Function} showNotification - Function to show notification
   * @param {Function} t - Translation function
   */
  const handleExternalDownloaderReset = (
    /** @type {HTMLElement} */ modal,
    /** @type {any} */ settings,
    /** @type {Function} */ saveSettings,
    /** @type {Function} */ showNotification,
    /** @type {Function} */ t
  ) => {
    resetExternalDownloaderToDefaults(settings);

    const container = modal.querySelector('.download-site-option');
    if (container) {
      updateExternalDownloaderModalInputs(/** @type {any} */ (container), settings);
    }

    saveSettings();

    if (window.youtubePlus) {
      window.youtubePlus.settings = window.youtubePlus.settings || settings;
    }
    triggerRebuildDropdown();
    try {
      const msg =
        (t && typeof t === 'function' && t('externalDownloaderReset')) || t('y2mateReset');
      showNotification(msg);
    } catch (_e) {
      showNotification('Settings reset');
    }
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
    const section = /** @type {any} */ (navItem).dataset?.section;
    const usesFallback = modal.getAttribute('data-ytp-inline-fallback') === 'true';

    modal
      .querySelectorAll('.ytp-plus-settings-nav-item')
      .forEach(item => item.classList.remove('active'));
    modal.querySelectorAll('.ytp-plus-settings-section').forEach(s => {
      s.classList.add('hidden');
      if (usesFallback && s instanceof HTMLElement) s.style.display = 'none';
    });

    navItem.classList.add('active');

    // Update topbar centered label
    const activeLabel = modal.querySelector('#ytp-plus-active-section-label');
    if (activeLabel) {
      activeLabel.textContent = /** @type {any} */ (navItem).dataset?.label || '';
    }

    const targetSection = modal.querySelector(
      `.ytp-plus-settings-section[data-section="${section}"]`
    );
    if (targetSection) {
      targetSection.classList.remove('hidden');
      if (usesFallback && targetSection instanceof HTMLElement) targetSection.style.display = '';
    }

    // Init before/after slider when voting section becomes visible
    if (section === 'voting' && window.YouTubePlus?.Voting?.initSlider) {
      // Use rAF so the section is truly visible before measuring dimensions
      requestAnimationFrame(() => window.YouTubePlus.Voting.initSlider());
    }

    // Persist active nav section so it can be restored on next modal open
    try {
      localStorage.setItem('ytp-plus-active-nav-section', section);
    } catch (_e) {
      U.logSuppressed(_e, 'ModalHandlers');
    }

    // Broadcast the section change so feature modules can opt into
    // "only do work while this section is visible" without going
    // through a central registry. Modules that registered via
    // `YouTubeUtils.onSectionActive(id, onEnter, onLeave)` listen
    // for this event and respond.
    try {
      document.dispatchEvent(
        new CustomEvent('youtube-plus-settings-section-activated', {
          detail: {
            section,
            label: /** @type {any} */ (navItem).dataset?.label || '',
          },
          bubbles: true,
        })
      );
    } catch (_e) {
      U.logSuppressed(_e, 'ModalHandlers');
    }
  };

  /**
   * Handle YouTube Music settings toggle
   * @param {HTMLElement} target - Checkbox element
   * @param {string} setting - Setting key
   * @param {Function} showNotification - Function to show notification
   * @param {Function} t - Translation function
   */
  const handleMusicSettingToggle = (target, setting, showNotification, t) => {
    try {
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

      // Load current music settings (prefer GM storage for cross-subdomain sync)
      /** @type {Record<string, any>} */
      let musicSettings = { ...defaults };

      try {
        if (typeof GM_getValue !== 'undefined') {
          const stored = GM_getValue('youtube-plus-music-settings', null);
          if (typeof stored === 'string' && stored) {
            const parsed = JSON.parse(stored);
            if (parsed && typeof parsed === 'object')
              musicSettings = { ...musicSettings, ...parsed };
          }
        }
      } catch (_e) {
        U.logSuppressed(_e, 'ModalHandlers');
      }

      try {
        const stored = localStorage.getItem('youtube-plus-music-settings');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') musicSettings = { ...musicSettings, ...parsed };
        }
      } catch (_e) {
        U.logSuppressed(_e, 'ModalHandlers');
      }

      musicSettings[setting] = /** @type {HTMLInputElement} */ (target).checked;

      // UI: toggle visibility of music submenu card when main switch changes
      try {
        if (setting === 'enableMusic') {
          const enabled = !!musicSettings.enableMusic;
          const root = /** @type {HTMLElement|null} */ (
            target.closest('.ytp-plus-settings-section') ||
              target.closest('.ytp-plus-settings-panel')
          );
          if (root) {
            const submenu = root.querySelector('.music-submenu[data-submenu="music"]');
            if (submenu instanceof HTMLElement) {
              /** @type {any} */ (submenu).style.display = enabled ? 'block' : 'none';
            }
            const toggleBtn = root.querySelector('.ytp-plus-submenu-toggle[data-submenu="music"]');
            if (toggleBtn instanceof HTMLElement) {
              if (enabled) {
                toggleBtn.removeAttribute('disabled');
                /** @type {any} */ (toggleBtn).style.display = 'inline-flex';
              } else {
                toggleBtn.setAttribute('disabled', '');
                /** @type {any} */ (toggleBtn).style.display = 'none';
              }
              toggleBtn.setAttribute('aria-expanded', enabled ? 'true' : 'false');
            }
          }
        }
      } catch (_e) {
        U.logSuppressed(_e, 'ModalHandlers');
      }

      // Save to localStorage
      localStorage.setItem('youtube-plus-music-settings', JSON.stringify(musicSettings));

      // Save to userscript-global storage so youtube.com and music.youtube.com share settings.
      try {
        if (typeof GM_setValue !== 'undefined') {
          GM_setValue('youtube-plus-music-settings', JSON.stringify(musicSettings));
        }
      } catch (_e) {
        U.logSuppressed(_e, 'ModalHandlers');
      }

      // Apply changes if YouTubeMusic module is available
      if (typeof window !== 'undefined' && window.YouTubeMusic) {
        if (window.YouTubeMusic.saveSettings) {
          window.YouTubeMusic.saveSettings(musicSettings);
        }
        if (window.YouTubeMusic.applySettingsChanges) {
          window.YouTubeMusic.applySettingsChanges();
        }
      }

      // Show notification
      if (showNotification && t) {
        showNotification(t('musicSettingsSaved'));
      }
    } catch (_e) {
      window.YouTubePlusLogger?.warn?.('ModalHandlers', 'handleMusicSettingToggle failed');
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
   * @param {{ dropdown: HTMLElement, hiddenSelect: HTMLSelectElement | null }} opts
   */
  const initGlassDropdown = (
    /** @type {{ dropdown: HTMLElement | null, hiddenSelect: HTMLSelectElement | null }} */ opts
  ) => {
    const dropdown = opts?.dropdown;
    const hidden = opts?.hiddenSelect;
    if (!(dropdown && hidden)) return;
    const toggle = dropdown.querySelector('.glass-dropdown__toggle');
    const list = dropdown.querySelector('.glass-dropdown__list');
    const label = dropdown.querySelector('.glass-dropdown__label');
    if (!(toggle instanceof HTMLElement && list instanceof HTMLElement)) return;

    let items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
    let idx = items.findIndex(it => it.getAttribute('aria-selected') === 'true');
    if (idx < 0) idx = 0;

    const openList = () => {
      dropdown.setAttribute('aria-expanded', 'true');
      list.style.display = 'block';
      items = Array.from(list.querySelectorAll('.glass-dropdown__item'));

      // Auto-detect direction: if there is not enough room above the dropdown
      // inside the nearest scrollable ancestor, open downward instead.
      // This fixes dropdowns that are clipped by overflow-y:auto containers
      // (e.g. the report section at the top of the settings content area).
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
    };
    const closeList = () => {
      dropdown.setAttribute('aria-expanded', 'false');
      list.style.display = 'none';
      list.classList.remove('glass-dropdown__list--down');
    };

    toggle.addEventListener('click', (/** @type {Event} */ e) => {
      e.stopPropagation();
      const expanded = dropdown.getAttribute('aria-expanded') === 'true';
      if (expanded) closeList();
      else openList();
    });

    document.addEventListener('click', (/** @type {Event} */ e) => {
      if (!dropdown.contains(/** @type {Node} */ (e.target))) closeList();
    });

    dropdown.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
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
          hidden.value = /** @type {HTMLElement} */ (it).dataset?.value ?? hidden.value;
          if (label) label.textContent = /** @type {HTMLElement} */ (it).textContent ?? '';
          hidden.dispatchEvent(new Event('change', { bubbles: true }));
          closeList();
        }
      } else if (e.key === 'Escape') {
        closeList();
      }
    });

    list.addEventListener('click', (/** @type {Event} */ e) => {
      const it =
        e.target && /** @type {HTMLElement} */ (e.target).closest?.('.glass-dropdown__item');
      if (!(it instanceof HTMLElement)) return;
      hidden.value = it.dataset?.value ?? hidden.value;
      list
        .querySelectorAll('.glass-dropdown__item')
        .forEach(li => li.removeAttribute('aria-selected'));
      it.setAttribute('aria-selected', 'true');
      if (label) label.textContent = it.textContent ?? '';
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
      closeList();
    });
  };

  /**
   * The canonical ordered list of keyboard-modifier combo values used
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
   * canonical combo strings above. Returns `'none'` if none of the
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
   *   1. `translatePart(part)` callback is provided — each modifier
   *      key is run through it (e.g. for i18n lookup), then
   *      capitalised. This is the mode used by pip.js, where each
   *      "ctrl" / "alt" / "shift" is fed through `t('ctrl')` etc.
   *   2. No callback — modifiers are simply capitalised as English
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
          el => el.offsetParent !== null
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

      container.addEventListener('keydown', handler);
      return () => container.removeEventListener('keydown', handler);
    };

    window.YouTubePlusModalHandlers = /** @type {any} */ ({
      setSettingByPath,
      initializeDownloadSites,
      toggleDownloadSiteControls,
      safelySaveSettings,
      handleDownloadSiteToggle,
      handleSimpleSettingToggle,
      handleDownloadSiteInput,
      handleExternalDownloaderSave,
      handleExternalDownloaderReset,
      handleSidebarNavigation,
      applySettingLive,
      handleMusicSettingToggle,
      isMusicSetting,
      createFocusTrap,
      initGlassDropdown,
      modifierComboValues: MODIFIER_COMBO_VALUES,
      resolveModifierComboValue,
      formatModifierComboLabel,
      buildModifierComboOptionItems,
      buildModifierComboDropdownItems,
    });
  }
})();
