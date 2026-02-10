/**
 * Modal Event Handlers
 * Extracted from createSettingsModal to reduce complexity
 */

/* global GM_setValue, GM_getValue */

// DOM cache helpers with fallback
const qs = selector => {
  if (window.YouTubeDOMCache && typeof window.YouTubeDOMCache.get === 'function') {
    return window.YouTubeDOMCache.get(selector);
  }
  return document.querySelector(selector);
};

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
    if (!Object.prototype.hasOwnProperty.call(cur, k) || typeof cur[k] !== 'object' || !cur[k]) {
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
const initializeDownloadSites = settings => {
  if (!settings.downloadSites) {
    settings.downloadSites = { externalDownloader: true, ytdl: true, direct: true };
  }
  // Migrate old key if present
  if (
    settings.downloadSites &&
    Object.prototype.hasOwnProperty.call(settings.downloadSites, 'y2mate')
  ) {
    if (!Object.prototype.hasOwnProperty.call(settings.downloadSites, 'externalDownloader')) {
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
        controls.style.display = checkbox.checked ? 'block' : 'none';
      }
    }
  } catch (err) {
    console.warn('[YouTube+] toggle download-site-controls failed:', err);
  }
};

/**
 * Save settings safely
 * @param {Function} saveSettings - Save function
 */
const safelySaveSettings = saveSettings => {
  try {
    saveSettings();
  } catch (err) {
    console.warn('[YouTube+] autosave downloadSite toggle failed:', err);
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
const handleDownloadSiteToggle = (target, key, settings, markDirty, saveSettings) => {
  initializeDownloadSites(settings);

  const checkbox = /** @type {HTMLInputElement} */ (target);
  settings.downloadSites[key] = checkbox.checked;

  try {
    markDirty();
  } catch {}

  toggleDownloadSiteControls(checkbox);
  rebuildDownloadDropdown(settings);
  safelySaveSettings(saveSettings);
};

/**
 * Handle Download button live toggle
 * @param {Object} context - Context object with methods
 */
const handleDownloadButtonToggle = context => {
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
const handleSpeedControlToggle = context => {
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
const updateGlobalSettings = settings => {
  if (typeof window !== 'undefined' && window.youtubePlus) {
    window.youtubePlus.settings = window.youtubePlus.settings || settings;
  }
};

/**
 * Apply setting changes live to the UI
 * @param {string} setting - Setting key
 * @param {Object} context - Context object with methods
 */
const applySettingLive = (setting, context) => {
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
    console.warn('[YouTube+] live apply specific toggle failed:', innerErr);
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

  // Mark modal as dirty
  try {
    markDirty();
  } catch {}

  // Apply settings immediately
  try {
    applySettingLive(setting, context);
  } catch (err) {
    console.warn('[YouTube+] apply settings live failed:', err);
  }

  // Persist immediately
  try {
    saveSettings();
  } catch (err) {
    console.warn('[YouTube+] autosave simple setting failed:', err);
  }

  // Show/hide submenu for Download
  if (setting === 'enableDownload') {
    const submenu = modal.querySelector('.download-submenu');
    if (submenu) {
      submenu.style.display = checked ? 'block' : 'none';
    }
    const toggleBtn = modal.querySelector('.ytp-plus-submenu-toggle[data-submenu="download"]');
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

  // Show/hide submenu for Zen Styles
  if (setting === 'enableZenStyles') {
    const submenu = modal.querySelector('.style-submenu');
    if (submenu) {
      submenu.style.display = checked ? 'block' : 'none';
    }
    const toggleBtn = modal.querySelector('.ytp-plus-submenu-toggle[data-submenu="style"]');
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

  // Show/hide submenu for Enhanced Features
  if (setting === 'enableEnhanced') {
    const submenu = modal.querySelector('.enhanced-submenu');
    if (submenu) {
      submenu.style.display = checked ? 'block' : 'none';
    }
    const toggleBtn = modal.querySelector('.ytp-plus-submenu-toggle[data-submenu="enhanced"]');
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
const initializeDownloadCustomization = settings => {
  if (!settings.downloadSiteCustomization) {
    settings.downloadSiteCustomization = {
      externalDownloader: { name: 'SSYouTube', url: 'https://ssyoutube.com/watch?v={videoId}' },
    };
  }
  // Migrate previous customization
  if (
    settings.downloadSiteCustomization &&
    Object.prototype.hasOwnProperty.call(settings.downloadSiteCustomization, 'y2mate')
  ) {
    if (
      !Object.prototype.hasOwnProperty.call(
        settings.downloadSiteCustomization,
        'externalDownloader'
      )
    ) {
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
const initializeDownloadSite = (settings, site) => {
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
const getDownloadSiteFallbackName = (site, t) => {
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
const updateDownloadSiteName = (target, site, t) => {
  const nameDisplay = target.closest('.download-site-option')?.querySelector('.download-site-name');

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
const rebuildDownloadDropdown = settings => {
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
    console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
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
const handleDownloadSiteInput = (target, site, field, settings, markDirty, t) => {
  initializeDownloadCustomization(settings);
  initializeDownloadSite(settings, site);

  settings.downloadSiteCustomization[site][field] = /** @type {HTMLInputElement} */ (target).value;

  try {
    markDirty();
  } catch {}

  if (field === 'name') {
    updateDownloadSiteName(target, site, t);
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
const ensureExternalDownloaderStructure = settings => {
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
const readExternalDownloaderInputs = (container, settings) => {
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
    console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
  }
};

const handleExternalDownloaderSave = (target, settings, saveSettings, showNotification, t) => {
  ensureExternalDownloaderStructure(settings);

  const container = target.closest('.download-site-option');
  if (container) {
    readExternalDownloaderInputs(container, settings);
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
  } catch {
    showNotification('Settings saved');
  }
};

/**
 * Reset external downloader to default values
 * @param {Object} settings - Settings object
 */
const resetExternalDownloaderToDefaults = settings => {
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
const updateExternalDownloaderModalInputs = (container, settings) => {
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
const handleExternalDownloaderReset = (modal, settings, saveSettings, showNotification, t) => {
  resetExternalDownloaderToDefaults(settings);

  const container = modal.querySelector('.download-site-option');
  if (container) {
    updateExternalDownloaderModalInputs(container, settings);
  }

  saveSettings();

  if (window.youtubePlus) {
    window.youtubePlus.settings = window.youtubePlus.settings || settings;
  }
  triggerRebuildDropdown();
  try {
    const msg = (t && typeof t === 'function' && t('externalDownloaderReset')) || t('y2mateReset');
    showNotification(msg);
  } catch {
    showNotification('Settings reset');
  }
};

/**
 * Handle sidebar navigation
 * @param {HTMLElement} navItem - Navigation item element
 * @param {HTMLElement} modal - Modal element
 */
const handleSidebarNavigation = (navItem, modal) => {
  const { dataset } = navItem;
  const { section } = dataset;

  modal
    .querySelectorAll('.ytp-plus-settings-nav-item')
    .forEach(item => item.classList.remove('active'));
  modal.querySelectorAll('.ytp-plus-settings-section').forEach(s => s.classList.add('hidden'));

  navItem.classList.add('active');

  const targetSection = modal.querySelector(
    `.ytp-plus-settings-section[data-section="${section}"]`
  );
  if (targetSection) targetSection.classList.remove('hidden');

  // Persist active nav section so it can be restored on next modal open
  try {
    localStorage.setItem('ytp-plus-active-nav-section', section);
  } catch {}
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
          if (parsed && typeof parsed === 'object') musicSettings = { ...musicSettings, ...parsed };
        }
      }
    } catch {}

    try {
      const stored = localStorage.getItem('youtube-plus-music-settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') musicSettings = { ...musicSettings, ...parsed };
      }
    } catch {}

    musicSettings[setting] = /** @type {HTMLInputElement} */ (target).checked;

    // UI: toggle visibility of music submenu card when main switch changes
    try {
      if (setting === 'enableMusic') {
        const enabled = !!musicSettings.enableMusic;
        const root = /** @type {HTMLElement|null} */ (
          target.closest('.ytp-plus-settings-section') || target.closest('.ytp-plus-settings-panel')
        );
        if (root) {
          const submenu = root.querySelector('.music-submenu[data-submenu="music"]');
          if (submenu instanceof HTMLElement) {
            submenu.style.display = enabled ? 'block' : 'none';
          }
          const toggleBtn = root.querySelector('.ytp-plus-submenu-toggle[data-submenu="music"]');
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
        }
      }
    } catch {}

    // Save to localStorage
    localStorage.setItem('youtube-plus-music-settings', JSON.stringify(musicSettings));

    // Save to userscript-global storage so youtube.com and music.youtube.com share settings.
    try {
      if (typeof GM_setValue !== 'undefined') {
        GM_setValue('youtube-plus-music-settings', JSON.stringify(musicSettings));
      }
    } catch {}

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
  } catch {
    console.warn('[YouTube+] handleMusicSettingToggle failed');
  }
};

/**
 * Check if a setting is a YouTube Music setting
 * @param {string} setting - Setting key
 * @returns {boolean} True if it's a music setting
 */
const isMusicSetting = setting => {
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

// Export handlers
if (typeof window !== 'undefined') {
  window.YouTubePlusModalHandlers = {
    handleDownloadSiteToggle,
    handleSimpleSettingToggle,
    handleDownloadSiteInput,
    handleExternalDownloaderSave,
    handleExternalDownloaderReset,
    handleSidebarNavigation,
    applySettingLive,
    handleMusicSettingToggle,
    isMusicSetting,
  };
}
