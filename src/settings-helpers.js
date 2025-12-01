/**
 * Settings Modal Helpers
 * Helper functions to reduce complexity of settings modal creation
 */

/**
 * Creates the sidebar navigation HTML
 * @param {Function} t - Translation function
 * @returns {string} Sidebar HTML
 */
function createSettingsSidebar(t) {
  return `
    <div class="ytp-plus-settings-sidebar">
      <div class="ytp-plus-settings-sidebar-header">
        <h2 class="ytp-plus-settings-title">${t('settingsTitle')}</h2>                
      </div>
      <div class="ytp-plus-settings-nav">
        ${createNavItem('basic', t('basicTab'), createBasicIcon(), true)}
        ${createNavItem('advanced', t('advancedTab'), createAdvancedIcon())}
        ${createNavItem('experimental', t('experimentalTab'), createExperimentalIcon())}
        ${createNavItem('report', t('reportTab'), createReportIcon())}
        ${createNavItem('about', t('aboutTab'), createAboutIcon())}
      </div>
    </div>
  `;
}

/**
 * Creates a single navigation item
 * @param {string} section - Section identifier
 * @param {string} label - Nav item label
 * @param {string} icon - SVG icon
 * @param {boolean} active - Whether this item is active
 * @returns {string} Nav item HTML
 */
function createNavItem(section, label, icon, active = false) {
  const activeClass = active ? ' active' : '';
  return `
    <div class="ytp-plus-settings-nav-item${activeClass}" data-section="${section}">
      ${icon}
      ${label}
    </div>
  `;
}

/**
 * SVG icon creators
 */
function createBasicIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="9" cy="9" r="2"/>
      <path d="m21 15-3.086-3.086a2 2 0 0 0-1.414-.586H13l-2-2v3h6l3 3"/>
    </svg>
  `;
}

function createAdvancedIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="m12 1 0 6m0 6 0 6"/>
      <path d="m17.5 6.5-4.5 4.5m0 0-4.5 4.5m9-9L12 12l5.5 5.5"/>
    </svg>
  `;
}

function createExperimentalIcon() {
  return `
    <svg width="64px" height="64px" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M18.019 4V15.0386L6.27437 39.3014C5.48686 40.9283 6.16731 42.8855 7.79421 43.673C8.23876 43.8882 8.72624 44 9.22013 44H38.7874C40.5949 44 42.0602 42.5347 42.0602 40.7273C42.0602 40.2348 41.949 39.7488 41.7351 39.3052L30.0282 15.0386V4H18.019Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"></path> 
      <path d="M10.9604 29.9998C13.1241 31.3401 15.2893 32.0103 17.4559 32.0103C19.6226 32.0103 21.7908 31.3401 23.9605 29.9998C26.1088 28.6735 28.2664 28.0103 30.433 28.0103C32.5997 28.0103 34.7755 28.6735 36.9604 29.9998" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path>
    </svg>
  `;
}

function createReportIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="12" y1="18" x2="12" y2="12"></line>
      <line x1="12" y1="9" x2="12.01" y2="9"></line>
    </svg>
  `;
}

function createAboutIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="m9 12 2 2 4-4"/>
    </svg>
  `;
}

/**
 * Creates a settings checkbox item
 * @param {string} label - Item label
 * @param {string} description - Item description
 * @param {string} setting - Setting data attribute
 * @param {boolean} checked - Whether checkbox is checked
 * @returns {string} Settings item HTML
 */
function createSettingsItem(label, description, setting, checked) {
  return `
    <div class="ytp-plus-settings-item">
      <div>
        <label class="ytp-plus-settings-item-label">${label}</label>
        <div class="ytp-plus-settings-item-description">${description}</div>
      </div>
      <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="${setting}" ${checked ? 'checked' : ''}>
    </div>
  `;
}

/**
 * Creates the download site option section
 * @param {Object} site - Site configuration
 * @param {Function} _t - Translation function (unused, kept for API consistency)
 * @returns {string} Download site HTML
 */
function createDownloadSiteOption(site, _t) {
  const { key, name, description, checked, hasControls, controls } = site;

  return `
    <div class="download-site-option">
      <div class="download-site-header">
        <div>
          <div class="download-site-name">${name}</div>
          <div class="download-site-desc">${description}</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="downloadSite_${key}" ${checked ? 'checked' : ''}>
      </div>
      ${hasControls ? `<div class="download-site-controls" style="display:${checked ? 'block' : 'none'};">${controls}</div>` : ''}
    </div>
  `;
}

/**
 * Creates Y2Mate customization controls
 * @param {Object} customization - Y2Mate customization settings
 * @param {Function} t - Translation function
 * @returns {string} Controls HTML
 */
function createY2MateControls(customization, t) {
  const name = customization?.name || 'Y2Mate';
  const url = customization?.url || 'https://www.y2mate.com/youtube/{videoId}';

  return `
    <input type="text" placeholder="${t('siteName')}" value="${name}" 
        data-site="y2mate" data-field="name" class="download-site-input" 
        style="width:100%;margin-top:6px;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:12px;">
    <input type="text" placeholder="${t('urlTemplate')}" value="${url}" 
      data-site="y2mate" data-field="url" class="download-site-input" 
      style="width:100%;margin-top:4px;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:11px;">
    <div class="download-site-cta">
      <button class="glass-button" id="download-y2mate-save" style="padding:6px 10px;font-size:12px;">${t('saveButton')}</button>
      <button class="glass-button" id="download-y2mate-reset" style="padding:6px 10px;font-size:12px;background:rgba(255,0,0,0.12);">${t('resetButton')}</button>
    </div>
  `;
}

/**
 * Creates YTDL controls
 * @returns {string} Controls HTML
 */
function createYTDLControls() {
  return `
    <div style="display:flex;gap:8px;align-items:center;width:100%;">
      <button class="glass-button" id="open-ytdl-github" style="margin:0;padding:10px 14px;font-size:13px;flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15,3 21,3 21,9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        GitHub
      </button>
    </div>
  `;
}

/**
 * Creates the download submenu with all site options
 * @param {Object} settings - Settings object
 * @param {Function} t - Translation function
 * @returns {string} Download submenu HTML
 */
function createDownloadSubmenu(settings, t) {
  const display = settings.enableDownload ? 'block' : 'none';

  const sites = [
    {
      key: 'y2mate',
      name: settings.downloadSiteCustomization?.y2mate?.name || 'Y2Mate',
      description: t('customDownloader'),
      checked: settings.downloadSites?.y2mate,
      hasControls: true,
      controls: createY2MateControls(settings.downloadSiteCustomization?.y2mate, t),
    },
    {
      key: 'ytdl',
      name: t('byYTDL'),
      description: t('customDownload'),
      checked: settings.downloadSites?.ytdl,
      hasControls: true,
      controls: createYTDLControls(),
    },
    {
      key: 'direct',
      name: t('directDownload'),
      description: t('directDownloadDesc'),
      checked: settings.downloadSites?.direct,
      hasControls: false,
    },
  ];

  return `
    <div class="download-submenu" style="display:${display};margin-left:12px;margin-bottom:12px;">
      <div class="glass-card" style="display:flex;flex-direction:column;gap:8px;">
        ${sites.map(site => createDownloadSiteOption(site, t)).join('')}
      </div>
    </div>
  `;
}

/**
 * Creates the basic settings section
 * @param {Object} settings - Settings object
 * @param {Function} t - Translation function
 * @returns {string} Basic section HTML
 */
function createBasicSettingsSection(settings, t) {
  return `
    <div class="ytp-plus-settings-section" data-section="basic">
      ${createSettingsItem(t('speedControl'), t('speedControlDesc'), 'enableSpeedControl', settings.enableSpeedControl)}
      ${createSettingsItem(t('screenshotButton'), t('screenshotButtonDesc'), 'enableScreenshot', settings.enableScreenshot)}
      ${createSettingsItem(t('downloadButton'), t('downloadButtonDesc'), 'enableDownload', settings.enableDownload)}
      ${createDownloadSubmenu(settings, t)}
    </div>
  `;
}

/**
 * Creates the about section with logo
 * @returns {string} About section HTML
 */
function createAboutSection() {
  return `
    <div class="ytp-plus-settings-section hidden" data-section="about">
      <svg class="app-icon" width="90" height="90" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" version="1.1">
        <path d="m23.24,4.62c-0.85,0.45 -2.19,2.12 -4.12,5.13c-1.54,2.41 -2.71,4.49 -3.81,6.8c-0.55,1.14 -1.05,2.2 -1.13,2.35c-0.08,0.16 -0.78,0.7 -1.66,1.28c-1.38,0.91 -1.8,1.29 -1.4,1.28c0.08,0 0.67,-0.35 1.31,-0.77c0.64,-0.42 1.19,-0.76 1.2,-0.74c0.02,0.02 -0.1,0.31 -0.25,0.66c-1.03,2.25 -1.84,5.05 -1.84,6.37c0.01,1.89 0.84,2.67 2.86,2.67c1.08,0 1.94,-0.31 3.66,-1.29c1.84,-1.06 3.03,-1.93 4.18,-3.09c1.69,-1.7 2.91,-3.4 3.28,-4.59c0.59,-1.9 -0.1,-3.08 -2.02,-3.44c-0.87,-0.16 -2.85,-0.14 -3.75,0.06c-1.78,0.38 -2.74,0.76 -2.5,1c0.03,0.03 0.5,-0.1 1.05,-0.28c1.49,-0.48 2.34,-0.59 3.88,-0.53c1.64,0.07 2.09,0.19 2.69,0.75l0.46,0.43l0,0.87c0,0.74 -0.05,0.98 -0.35,1.6c-0.69,1.45 -2.69,3.81 -4.37,5.14c-0.93,0.74 -2.88,1.94 -4.07,2.5c-1.64,0.77 -3.56,0.72 -4.21,-0.11c-0.39,-0.5 -0.5,-1.02 -0.44,-2.11c0.05,-0.85 0.16,-1.32 0.67,-2.86c0.34,-1.01 0.86,-2.38 1.15,-3.04c0.52,-1.18 0.55,-1.22 1.6,-2.14c4.19,-3.65 8.42,-9.4 9.02,-12.26c0.2,-0.94 0.13,-1.46 -0.21,-1.7c-0.31,-0.22 -0.38,-0.21 -0.89,0.06m0.19,0.26c-0.92,0.41 -3.15,3.44 -5.59,7.6c-1.05,1.79 -3.12,5.85 -3.02,5.95c0.07,0.07 1.63,-1.33 2.58,-2.34c1.57,-1.65 3.73,-4.39 4.88,-6.17c1.31,-2.03 2.06,-4.11 1.77,-4.89c-0.13,-0.34 -0.16,-0.35 -0.62,-0.15m11.69,13.32c-0.3,0.6 -1.19,2.54 -1.98,4.32c-1.6,3.62 -1.67,3.71 -2.99,4.34c-1.13,0.54 -2.31,0.85 -3.54,0.92c-0.99,0.06 -1.08,0.04 -1.38,-0.19c-0.28,-0.22 -0.31,-0.31 -0.26,-0.7c0.03,-0.25 0.64,-1.63 1.35,-3.08c1.16,-2.36 2.52,-5.61 2.52,-6.01c0,-0.49 -0.36,0.19 -1.17,2.22c-0.51,1.26 -1.37,3.16 -1.93,4.24c-0.55,1.08 -1.04,2.17 -1.09,2.43c-0.1,0.59 0.07,1.03 0.49,1.28c0.78,0.46 3.3,0.06 5.13,-0.81l0.93,-0.45l-0.66,1.25c-0.7,1.33 -3.36,6.07 -4.31,7.67c-2.02,3.41 -3.96,5.32 -6.33,6.21c-2.57,0.96 -4.92,0.74 -6.14,-0.58c-0.81,-0.88 -0.82,-1.71 -0.04,-3.22c1.22,-2.36 6.52,-6.15 10.48,-7.49c0.52,-0.18 0.95,-0.39 0.95,-0.46c0,-0.21 -0.19,-0.18 -1.24,0.2c-1.19,0.43 -3.12,1.37 -4.34,2.11c-2.61,1.59 -5.44,4.09 -6.13,5.43c-1.15,2.2 -0.73,3.61 1.4,4.6c0.59,0.28 0.75,0.3 2.04,0.3c1.67,0 2.42,-0.18 3.88,-0.89c1.87,-0.92 3.17,-2.13 4.72,-4.41c0.98,-1.44 4.66,-7.88 5.91,-10.33c0.25,-0.49 0.68,-1.19 0.96,-1.56c0.28,-0.37 0.76,-1.15 1.06,-1.73c0.82,-1.59 2.58,-6.1 2.58,-6.6c0,-0.06 -0.07,-0.1 -0.17,-0.1c-0.10,0 -0.39,0.44 -0.71,1.09m-1.34,3.7c-0.93,2.08 -1.09,2.48 -0.87,2.2c0.19,-0.24 1.66,-3.65 1.6,-3.71c-0.02,-0.02 -0.35,0.66 -0.73,1.51" fill="none" fill-rule="evenodd" stroke="currentColor" />
      </svg>
      <h1>YouTube +</h1><br><br>
    </div>
  `;
}

/**
 * Creates the main content area
 * @param {Object} settings - Settings object
 * @param {Function} t - Translation function
 * @returns {string} Main content HTML
 */
function createMainContent(settings, t) {
  return `
    <div class="ytp-plus-settings-main">
      <div class="ytp-plus-settings-sidebar-close">
        <button class="ytp-plus-settings-close" aria-label="${t('closeButton')}">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
          </svg>
        </button>
      </div>              
      <div class="ytp-plus-settings-content">                
        ${createBasicSettingsSection(settings, t)}
        <div class="ytp-plus-settings-section hidden" data-section="advanced"></div>
        <div class="ytp-plus-settings-section hidden" data-section="experimental"></div>
        <div class="ytp-plus-settings-section hidden" data-section="report"></div>
        ${createAboutSection()}
      </div>
      <div class="ytp-plus-footer">
        <button class="ytp-plus-button ytp-plus-button-primary" id="ytp-plus-save-settings">${t('saveChanges')}</button>
      </div>
    </div>
  `;
}

// Export helper functions to window
if (typeof window !== 'undefined') {
  window.YouTubePlusSettingsHelpers = {
    createSettingsSidebar,
    createMainContent,
    createSettingsItem,
    createDownloadSiteOption,
    createBasicSettingsSection,
  };
}
