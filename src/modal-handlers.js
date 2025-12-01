/**
 * Modal Event Handlers
 * Extracted from createSettingsModal to reduce complexity
 */

/**
 * Initialize download sites settings
 * @param {Object} settings - Settings object
 */
const initializeDownloadSites = settings => {
  if (!settings.downloadSites) {
    settings.downloadSites = { y2mate: true, ytdl: true, direct: true };
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
    const dropdown = document.querySelector('.download-options');
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
    const speedOptions = document.querySelector('.speed-options');
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
  settings[setting] = /** @type {HTMLInputElement} */ (target).checked;

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
      submenu.style.display = /** @type {HTMLInputElement} */ (target).checked ? 'block' : 'none';
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
      y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
    };
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
  if (site === 'y2mate') return 'Y2Mate';
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
 * Ensure Y2Mate settings structure exists
 * @param {Object} settings - Settings object
 */
const ensureY2MateStructure = settings => {
  if (!settings.downloadSiteCustomization) {
    settings.downloadSiteCustomization = {
      y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
    };
  }
  if (!settings.downloadSiteCustomization.y2mate) {
    settings.downloadSiteCustomization.y2mate = { name: '', url: '' };
  }
};

/**
 * Read Y2Mate input values from container
 * @param {HTMLElement} container - Container element
 * @param {Object} settings - Settings object
 */
const readY2MateInputs = (container, settings) => {
  const nameInput = container.querySelector(
    'input.download-site-input[data-site="y2mate"][data-field="name"]'
  );
  const urlInput = container.querySelector(
    'input.download-site-input[data-site="y2mate"][data-field="url"]'
  );
  if (nameInput) settings.downloadSiteCustomization.y2mate.name = nameInput.value;
  if (urlInput) settings.downloadSiteCustomization.y2mate.url = urlInput.value;
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

const handleY2MateSave = (target, settings, saveSettings, showNotification, t) => {
  ensureY2MateStructure(settings);

  const container = target.closest('.download-site-option');
  if (container) {
    readY2MateInputs(container, settings);
  }

  saveSettings();

  if (window.youtubePlus) {
    window.youtubePlus.settings = window.youtubePlus.settings || settings;
  }
  triggerRebuildDropdown();
  showNotification(t('y2mateSettingsSaved'));
};

/**
 * Reset Y2Mate to default values
 * @param {Object} settings - Settings object
 */
const resetY2MateToDefaults = settings => {
  ensureY2MateStructure(settings);
  settings.downloadSiteCustomization.y2mate = {
    name: 'Y2Mate',
    url: 'https://www.y2mate.com/youtube/{videoId}',
  };
};

/**
 * Update Y2Mate modal inputs
 * @param {HTMLElement} container - Container element
 * @param {Object} settings - Settings object
 */
const updateY2MateModalInputs = (container, settings) => {
  const nameInput = container.querySelector(
    'input.download-site-input[data-site="y2mate"][data-field="name"]'
  );
  const urlInput = container.querySelector(
    'input.download-site-input[data-site="y2mate"][data-field="url"]'
  );
  const nameDisplay = container.querySelector('.download-site-name');

  const y2mateSettings = settings.downloadSiteCustomization.y2mate;
  if (nameInput) nameInput.value = y2mateSettings.name;
  if (urlInput) urlInput.value = y2mateSettings.url;
  if (nameDisplay) nameDisplay.textContent = y2mateSettings.name;
};

/**
 * Handle Y2Mate reset button
 * @param {HTMLElement} modal - Modal element
 * @param {Object} settings - Settings object
 * @param {Function} saveSettings - Function to save settings
 * @param {Function} showNotification - Function to show notification
 * @param {Function} t - Translation function
 */
const handleY2MateReset = (modal, settings, saveSettings, showNotification, t) => {
  resetY2MateToDefaults(settings);

  const container = modal.querySelector('.download-site-option');
  if (container) {
    updateY2MateModalInputs(container, settings);
  }

  saveSettings();

  if (window.youtubePlus) {
    window.youtubePlus.settings = window.youtubePlus.settings || settings;
  }
  triggerRebuildDropdown();
  showNotification(t('y2mateReset'));
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
};

// Export handlers
if (typeof window !== 'undefined') {
  window.YouTubePlusModalHandlers = {
    handleDownloadSiteToggle,
    handleSimpleSettingToggle,
    handleDownloadSiteInput,
    handleY2MateSave,
    handleY2MateReset,
    handleSidebarNavigation,
    applySettingLive,
  };
}
