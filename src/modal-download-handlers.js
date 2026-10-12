/**
 * Modal Download Handlers
 * Download-site and external-downloader settings handlers. Members are
 * re-attached to the window.YouTubePlusModalHandlers facade (tests, the
 * design-system widget bridge, and settings-modal.js expect them there),
 * and also exposed standalone for direct consumption.
 */

(function () {
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'ModalDownloadHandlers');
  /**
   * Initialize download sites settings
   * @param {Object} settings - Settings object
   */
  const initializeDownloadSites = (/** @type {YoutubePlusSettings} */ settings) => {
    if (!settings.downloadSites) {
      settings.downloadSites = {
        externalDownloader: true,
        ytdl: true,
        direct: true,
      };
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
        if (controls instanceof HTMLElement) {
          controls.style.display = checkbox.checked ? 'block' : 'none';
        }
      }
    } catch (err) {
      logS(err);
      window.YouTubePlusLogger?.warn?.(
        'ModalHandlers',
        'toggle download-site-controls failed:',
        err
      );
    }
  };
  /**
   * Handle download site checkbox toggle
   * @param {HTMLElement} target - Checkbox element
   * @param {string} key - Site key (y2mate, ytdl, direct)
   * @param {Object} settings - Settings object
   * @param {Function} saveSettings - Function to save settings
   */
  const handleDownloadSiteToggle = (
    /** @type {HTMLElement} */ target,
    /** @type {string} */ key,
    /** @type {YoutubePlusSettings} */ settings,
    saveSettings
  ) => {
    initializeDownloadSites(settings);

    const checkbox = /** @type {HTMLInputElement} */ (target);
    settings.downloadSites[key] = checkbox.checked;

    toggleDownloadSiteControls(checkbox);
    rebuildDownloadDropdown();
    window.YouTubePlusModalHandlers?.safelySaveSettings?.(saveSettings);
  };
  /**
   * Handle download site customization input
   * @param {HTMLElement} target - Input element
   * @param {string} site - Site key
   * @param {string} field - Field name (name or url)
   * @param {Object} settings - Settings object
   * @param {Function} t - Translation function
   */
  /**
   * Initialize download site customization settings
   * @param {Object} settings - Settings object
   */
  const initializeDownloadCustomization = (/** @type {YoutubePlusSettings} */ settings) => {
    if (!settings.downloadSiteCustomization) {
      settings.downloadSiteCustomization = {
        externalDownloader: {
          name: 'SSYouTube',
          url: 'https://ssyoutube.com/watch?v={videoId}',
        },
      };
    }
    // Migrate the stored y2mate customization into the externalDownloader entry
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
  const initializeDownloadSite = (
    /** @type {YoutubePlusSettings} */ settings,
    /** @type {string} */ site
  ) => {
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
  const getDownloadSiteFallbackName = (/** @type {string} */ site, t) => {
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
    t
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
   */
  const rebuildDownloadDropdown = () => {
    try {
      const manager = window.YouTubePlusDownloadButton;
      if (
        typeof window !== 'undefined' &&
        manager &&
        typeof manager.rebuildDownloadDropdown === 'function'
      ) {
        manager.rebuildDownloadDropdown();
      }
    } catch (err) {
      logS(err);
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
   * @param {Function} t - Translation function
   */
  const handleDownloadSiteInput = (
    /** @type {HTMLElement} */ target,
    /** @type {string} */ site,
    /** @type {string} */ field,
    /** @type {YoutubePlusSettings} */ settings,
    t
  ) => {
    initializeDownloadCustomization(settings);
    initializeDownloadSite(settings, site);

    settings.downloadSiteCustomization[site][field] = /** @type {HTMLInputElement} */ (
      target
    ).value;

    if (field === 'name') {
      updateDownloadSiteName(target, site, t);
    }

    rebuildDownloadDropdown();
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
  const ensureExternalDownloaderStructure = (/** @type {YoutubePlusSettings} */ settings) => {
    if (!settings.downloadSiteCustomization) {
      settings.downloadSiteCustomization = {
        externalDownloader: {
          name: 'SSYouTube',
          url: 'https://ssyoutube.com/watch?v={videoId}',
        },
      };
    }
    if (!settings.downloadSiteCustomization.externalDownloader) {
      settings.downloadSiteCustomization.externalDownloader = {
        name: '',
        url: '',
      };
    }
  };

  /**
   * Read external downloader input values from container
   * @param {HTMLElement} container - Container element
   * @param {Object} settings - Settings object
   */
  const readExternalDownloaderInputs = (
    /** @type {HTMLElement} */ container,
    /** @type {YoutubePlusSettings} */ settings
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
   * Save the external downloader inputs, persist and rebuild the dropdown.
   * @param {HTMLElement} target - Button element
   * @param {Object} settings - Settings object
   * @param {Function} saveSettings - Save function
   * @param {Function} showNotification - Notification function
   * @param {Function} t - Translation function
   */
  const handleExternalDownloaderSave = (
    /** @type {HTMLElement} */ target,
    /** @type {YoutubePlusSettings} */ settings,
    saveSettings,
    showNotification,
    t
  ) => {
    ensureExternalDownloaderStructure(settings);

    const container = target.closest('.download-site-option');
    if (container instanceof HTMLElement) {
      readExternalDownloaderInputs(container, settings);
    }

    saveSettings();

    rebuildDownloadDropdown();
    try {
      const msg =
        (t && typeof t === 'function' && t('externalDownloaderSettingsSaved')) || 'Settings saved';
      showNotification(msg);
    } catch (_e) {
      logS(_e);
      showNotification('Settings saved');
    }
  };

  /**
   * Reset external downloader to default values
   * @param {Object} settings - Settings object
   */
  const resetExternalDownloaderToDefaults = (/** @type {YoutubePlusSettings} */ settings) => {
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
    /** @type {YoutubePlusSettings} */ settings
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
    /** @type {YoutubePlusSettings} */ settings,
    saveSettings,
    showNotification,
    t
  ) => {
    resetExternalDownloaderToDefaults(settings);

    const container = modal.querySelector('.download-site-option');
    if (container instanceof HTMLElement) {
      updateExternalDownloaderModalInputs(container, settings);
    }

    saveSettings();

    rebuildDownloadDropdown();
    try {
      const msg =
        (t && typeof t === 'function' && t('externalDownloaderReset')) || 'Settings reset';
      showNotification(msg);
    } catch (_e) {
      logS(_e);
      showNotification('Settings reset');
    }
  };

  const modalDownloadHandlersAPI = {
    initializeDownloadSites,
    toggleDownloadSiteControls,
    handleDownloadSiteToggle,
    initializeDownloadCustomization,
    initializeDownloadSite,
    getDownloadSiteFallbackName,
    updateDownloadSiteName,
    rebuildDownloadDropdown,
    handleDownloadSiteInput,
    ensureExternalDownloaderStructure,
    readExternalDownloaderInputs,
    handleExternalDownloaderSave,
    resetExternalDownloaderToDefaults,
    updateExternalDownloaderModalInputs,
    handleExternalDownloaderReset,
  };

  // Re-attach to the shared modal handlers facade (not frozen; assigned
  // after modal-handlers.js runs, so all consumers keep working unchanged).
  if (window.YouTubePlusModalHandlers) {
    Object.assign(window.YouTubePlusModalHandlers, modalDownloadHandlersAPI);
  }

  window.YouTubePlusModalDownloadHandlers = modalDownloadHandlersAPI;
})();
