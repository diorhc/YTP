/**
 * Settings Modal HTML Helpers
 *
 * Modal HTML builders preserved for backward compatibility with
 * window.YouTubePlusSettingsHelpers. The settings store
 * lives in settings-store.js (window.YouTubePlusSettingsStore).
 * @version 2.5.3
 */

(function () {
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'SettingsHelpers');
  // ============================================================
  // SETTINGS MODAL HTML HELPERS
  // ------------------------------------------------------------
  // These functions are the public API on
  // `window.YouTubePlusSettingsHelpers`; callers (notably
  // basic.js#createSettingsModal) rely on them.
  // ============================================================

  /**
   * Creates the sidebar navigation HTML
   * @param {Function} t - Translation function
   * @returns {string} Sidebar HTML
   */
  function createSettingsSidebar(t) {
    return `
    <div class="yp-settings-nav yp-settings-nav-rail" role="tablist" aria-label="${escapeHTML(t('settingsTitle') || 'Settings')}">
      ${createNavItem('basic', t('basicTab'), createBasicIcon(), true)}
      ${createNavItem('advanced', t('advancedTab'), createAdvancedIcon())}
      ${createNavItem('experimental', t('experimentalTab'), createExperimentalIcon())}
      ${createNavItem('voting', tr(t, 'votingTab'), createVotingIcon())}
      ${createNavItem('report', t('reportTab'), createReportIcon())}
      ${createNavItem('about', t('aboutTab'), createAboutIcon())}
    </div>
  `;
  }

  /**
   * Escape plain text for HTML interpolation. Used by the modal
   * template helpers below so user-controlled values (translation
   * lookups, custom downloader names/URLs) cannot break out of an
   * attribute or inject script tags.
   * @param {string} str
   * @returns {string}
   */
  function escapeHTML(/** @type {string} */ str) {
    if (window.YouTubeSafeDOM?.escapeHTML) return window.YouTubeSafeDOM.escapeHTML(str);
    return window.YouTubeUtils?.escapeHTML?.(str) ?? '';
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
    const sectionEsc = escapeHTML(section);
    const labelEsc = escapeHTML(label);
    return `
    <div class="yp-settings-nav-item${activeClass}" data-section="${sectionEsc}" data-label="${labelEsc}" title="${labelEsc}" role="tab" aria-selected="${active ? 'true' : 'false'}" tabindex="${active ? '0' : '-1'}" aria-label="${labelEsc}">
      ${icon}
      <span class="yp-settings-nav-item-label">${labelEsc}</span>
    </div>
  `;
  }

  /**
   * SVG icon creators.
   * Each returns an inline SVG string used by the settings sidebar.
   */

  /**
   * @returns {string} Basic section icon SVG
   */
  function createBasicIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path opacity="0.5" d="M2 12.2039C2 9.91549 2 8.77128 2.5192 7.82274C3.0384 6.87421 3.98695 6.28551 5.88403 5.10813L7.88403 3.86687C9.88939 2.62229 10.8921 2 12 2C13.1079 2 14.1106 2.62229 16.116 3.86687L18.116 5.10812C20.0131 6.28551 20.9616 6.87421 21.4808 7.82274C22 8.77128 22 9.91549 22 12.2039V13.725C22 17.6258 22 19.5763 20.8284 20.7881C19.6569 22 17.7712 22 14 22H10C6.22876 22 4.34315 22 3.17157 20.7881C2 19.5763 2 17.6258 2 13.725V12.2039Z" stroke="currentColor" stroke-width="1.5"></path> <path d="M15 18H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> </svg>
  `;
  }

  /**
   * @returns {string} Advanced section icon SVG
   */
  function createAdvancedIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path opacity="0.5" d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12" stroke="currentColor" stroke-width="1.5"></path> <path d="M2 14C2 11.1997 2 9.79961 2.54497 8.73005C3.02433 7.78924 3.78924 7.02433 4.73005 6.54497C5.79961 6 7.19974 6 10 6H14C16.8003 6 18.2004 6 19.27 6.54497C20.2108 7.02433 20.9757 7.78924 21.455 8.73005C22 9.79961 22 11.1997 22 14C22 16.8003 22 18.2004 21.455 19.27C20.9757 20.2108 20.2108 20.9757 19.27 21.455C18.2004 22 16.8003 22 14 22H10C7.19974 22 5.79961 22 4.73005 21.455C3.78924 20.9757 3.02433 20.2108 2.54497 19.27C2 18.2004 2 16.8003 2 14Z" stroke="currentColor" stroke-width="1.5"></path> <path d="M9.5 14.4L10.9286 16L14.5 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </svg>
  `;
  }

  /**
   * @returns {string} Experimental section icon SVG
   */
  function createExperimentalIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M9.74872 2.49415L18.1594 7.31987M9.74872 2.49415L2.65093 14.7455C1.31093 17.0584 2.10615 20.0159 4.42709 21.3513C6.74803 22.6867 9.7158 21.8942 11.0558 19.5813L12.5511 17.0003L14.1886 14.1738L15.902 11.2163L18.1594 7.31987M9.74872 2.49415L8.91283 2M18.1594 7.31987L19 7.80374" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M15.9021 11.2164L13.3441 9.74463M14.1887 14.1739L9.98577 11.7557M12.5512 17.0004L9.93848 15.4972" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M22 14.9166C22 16.0672 21.1046 16.9999 20 16.9999C18.8954 16.9999 18 16.0672 18 14.9166C18 14.1967 18.783 13.2358 19.3691 12.6174C19.7161 12.2512 20.2839 12.2512 20.6309 12.6174C21.217 13.2358 22 14.1967 22 14.9166Z" stroke="currentColor" stroke-width="1.5"></path> </svg>
  `;
  }

  /**
   * @returns {string} Report section icon SVG
   */
  function createReportIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M4 6V19C4 20.6569 5.34315 22 7 22H17C18.6569 22 20 20.6569 20 19V9C20 7.34315 18.6569 6 17 6H4ZM4 6V5" stroke="currentColor" stroke-width="1.5"></path> <path d="M18 6.00002V6.75002H18.75V6.00002H18ZM15.7172 2.32614L15.6111 1.58368L15.7172 2.32614ZM4.91959 3.86865L4.81353 3.12619H4.81353L4.91959 3.86865ZM5.07107 6.75002H18V5.25002H5.07107V6.75002ZM18.75 6.00002V4.30604H17.25V6.00002H18.75ZM15.6111 1.58368L4.81353 3.12619L5.02566 4.61111L15.8232 3.0686L15.6111 1.58368ZM4.81353 3.12619C3.91638 3.25435 3.25 4.0227 3.25 4.92895H4.75C4.75 4.76917 4.86749 4.63371 5.02566 4.61111L4.81353 3.12619ZM18.75 4.30604C18.75 2.63253 17.2678 1.34701 15.6111 1.58368L15.8232 3.0686C16.5763 2.96103 17.25 3.54535 17.25 4.30604H18.75ZM5.07107 5.25002C4.89375 5.25002 4.75 5.10627 4.75 4.92895H3.25C3.25 5.9347 4.06532 6.75002 5.07107 6.75002V5.25002Z" fill="currentColor"></path> <path opacity="0.5" d="M8 12H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M8 15.5H13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> </svg>
  `;
  }

  /**
   * @returns {string} About section icon SVG
   */
  function createAboutIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M15.5 9L15.6716 9.17157C17.0049 10.5049 17.6716 11.1716 17.6716 12C17.6716 12.8284 17.0049 13.4951 15.6716 14.8284L15.5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path d="M13.2942 7.17041L12.0001 12L10.706 16.8297" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path d="M8.49994 9L8.32837 9.17157C6.99504 10.5049 6.32837 11.1716 6.32837 12C6.32837 12.8284 6.99504 13.4951 8.32837 14.8284L8.49994 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z" stroke="currentColor" stroke-width="1.5"></path> </svg>
  `;
  }

  /**
   * @returns {string} Voting section icon SVG
   */
  function createVotingIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <circle cx="12" cy="6" r="4" stroke="currentColor" stroke-width="1.5"></circle> <path opacity="0.5" d="M15 13.3271C14.0736 13.1162 13.0609 13 12 13C7.58172 13 4 15.0147 4 17.5C4 19.9853 4 22 12 22C17.6874 22 19.3315 20.9817 19.8068 19.5" stroke="currentColor" stroke-width="1.5"></path> <circle cx="18" cy="16" r="4" stroke="currentColor" stroke-width="1.5"></circle> <path d="M18 14.6667V17.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M16.6665 16L19.3332 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </svg>
  `;
  }

  /**
   * Read a module's stored settings for the modal: from `modules.<name>` when
   * it has content, otherwise from its legacy key. The legacy fallback keeps a
   * preference visible before the module has run and written the blob.
   * @param {string} moduleName
   * @param {string} legacyKey
   * @returns {Record<string, unknown> | null}
   */
  function readModuleSettings(moduleName, legacyKey) {
    try {
      const store = window.YouTubePlusSettingsStore?.moduleBridge?.();
      if (store) {
        const mod = store.getModuleSettings?.(moduleName);
        if (mod && typeof mod === 'object' && Object.keys(mod).length) return mod;
      }
      const raw = window.YouTubeUtils?.storage?.getItem(legacyKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_e) {
      logS(_e);
      return null;
    }
  }

  /**
   * Shortcut object from a module's settings, filling absent fields.
   * @param {string} moduleName
   * @param {string} legacyKey
   * @param {{ ctrlKey: boolean, altKey: boolean, shiftKey: boolean, key: string }} defaultValue
   * @returns {{ ctrlKey: boolean, altKey: boolean, shiftKey: boolean, key: string }}
   */
  function readModuleShortcut(moduleName, legacyKey, defaultValue) {
    const stored = readModuleSettings(moduleName, legacyKey);
    return stored?.shortcut && typeof stored.shortcut === 'object'
      ? { ...defaultValue, ...stored.shortcut }
      : defaultValue;
  }

  /**
   * Read submenu expanded state from storage.
   * @param {string} key - Submenu key (e.g. 'pip', 'timecode')
   * @returns {boolean|null} - true/false if stored, null if missing
   */
  function readSubmenuExpanded(/** @type {string} */ key) {
    try {
      const raw = window.YouTubeUtils?.storage?.getItem('ytp-plus-submenu-states');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed[key] === 'boolean') return parsed[key];
    } catch (_e) {
      logS(_e);
      /* Corrupt submenu state is non-critical; treat as missing. */
    }
    return null;
  }

  /**
   * Build shortcut editor HTML for PiP/Timecode submenu.
   * @param {string} id - Prefix for element IDs (e.g. 'pip', 'timecode')
   * @param {{ ctrlKey: boolean, altKey: boolean, shiftKey: boolean, key: string }} shortcut
   * @param {Function} t - Translation function
   * @returns {string} HTML string
   */
  function buildShortcutEditorHTML(id, shortcut, t) {
    const formatLabel = (/** @type {string} */ value) => {
      const formatter = window.YouTubePlusDesignSystem?.formatModifierComboLabel;
      if (typeof formatter === 'function') {
        return formatter(value, {
          noneLabel: t('none'),
          translatePart: (/** @type {string} */ part) => t(part.toLowerCase()),
        });
      }
      if (value === 'none') return t('none');
      return value
        .split('+')
        .map((/** @type {string} */ k) => t(k.toLowerCase()))
        .map((/** @type {string} */ k) => k.charAt(0).toUpperCase() + k.slice(1))
        .join('+');
    };

    const resolveValue = (
      /** @type {{ ctrlKey: boolean, altKey: boolean, shiftKey: boolean }} */ sc
    ) => {
      const resolver = window.YouTubePlusDesignSystem?.resolveModifierComboValue;
      if (typeof resolver === 'function') return resolver(sc);
      return 'none';
    };

    const modifierValue = resolveValue(shortcut);
    const optionItems =
      window.YouTubePlusDesignSystem?.buildModifierComboOptionItems?.(modifierValue, formatLabel) ||
      '';
    const dropdownItems =
      window.YouTubePlusDesignSystem?.buildModifierComboDropdownItems?.(
        modifierValue,
        formatLabel
      ) || '';

    return `
      <select id="${id}-modifier-combo" class="${id}-hidden-select">
        ${optionItems}
      </select>

      <div class="glass-dropdown" id="${id}-modifier-dropdown">
        <button class="glass-dropdown__toggle" id="${id}-modifier-toggle" type="button" aria-haspopup="listbox" aria-expanded="false">
          <span class="glass-dropdown__label">${formatLabel(modifierValue)}</span>
          <svg class="glass-dropdown__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <ul class="glass-dropdown__list" role="listbox" aria-labelledby="${id}-modifier-toggle">
          ${dropdownItems}
        </ul>
      </div>

      <span class="${id}-shortcut-plus">+</span>
      <input type="text" id="${id}-key" class="${id}-key-input" value="${escapeHTML(shortcut.key)}" maxlength="1" autocomplete="off" spellcheck="false" aria-label="${escapeHTML(t('keyboardShortcut'))}">
    `;
  }

  /**
   * Creates a simple checkbox settings item.
   * @param {string} label - Item label
   * @param {string} description - Item description
   * @param {string} setting - Setting data attribute value
   * @param {boolean} checked - Whether the checkbox is initially checked
   * @returns {string} Settings item HTML
   */
  function createSettingsItem(label, description, setting, checked) {
    const settingEsc = escapeHTML(setting);
    const inputId = `yp-setting-${settingEsc}`;
    return `
    <div class="yp-settings-item">
      <div>
        <label class="yp-settings-item-label" for="${inputId}">${escapeHTML(label)}</label>
        <div class="yp-settings-item-description">${escapeHTML(description)}</div>
      </div>
      <input type="checkbox" id="${inputId}" class="yp-settings-checkbox" data-setting="${settingEsc}" ${checked ? 'checked' : ''}>
    </div>
  `;
  }

  /**
   * Creates a native `<select>` settings item.
   * @param {string} label - Item label
   * @param {string} description - Item description
   * @param {string} setting - Setting data attribute value
   * @param {string|number} value - Currently selected option value
   * @param {Array<{value: string|number, label: string}>} options - Available options
   * @returns {string} Settings item HTML
   */
  function createSettingsSelect(
    /** @type {string} */ label,
    /** @type {string} */ description,
    /** @type {string} */ setting,
    /** @type {string|number} */ value,
    /** @type {Array<{value: string|number, label: string}>} */ options
  ) {
    const settingEsc = escapeHTML(setting);
    const inputId = `yp-setting-${settingEsc}`;
    const opts = options
      .map(
        o =>
          `<option value="${escapeHTML(String(o.value))}"${String(value) === String(o.value) ? ' selected' : ''}>${escapeHTML(o.label)}</option>`
      )
      .join('');
    const selectedOpt = options.find(o => String(o.value) === String(value)) || options[0];
    const selectedLabel = selectedOpt ? selectedOpt.label : '';
    const dropdownItems = options
      .map(
        o =>
          `<li class="glass-dropdown__item" data-value="${escapeHTML(String(o.value))}" role="option"${String(value) === String(o.value) ? ' aria-selected="true"' : ''}>${escapeHTML(o.label)}</li>`
      )
      .join('');
    return `
    <div class="yp-settings-item">
      <div>
        <label class="yp-settings-item-label" for="${inputId}-toggle">${escapeHTML(label)}</label>
        <div class="yp-settings-item-description">${escapeHTML(description)}</div>
      </div>
      <select id="${inputId}" class="yp-settings-select" data-setting="${settingEsc}" style="display:none;" tabindex="-1" aria-hidden="true">${opts}</select>
      <div class="glass-dropdown" id="${inputId}-dropdown">
        <button class="glass-dropdown__toggle" id="${inputId}-toggle" type="button" aria-haspopup="listbox" aria-expanded="false">
          <span class="glass-dropdown__label">${escapeHTML(selectedLabel)}</span>
          <svg class="glass-dropdown__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <ul class="glass-dropdown__list" role="listbox" aria-labelledby="${inputId}-toggle">
          ${dropdownItems}
        </ul>
      </div>
    </div>
  `;
  }

  /**
   * Creates a checkbox row with nested submenu select.
   * @param {string} label
   * @param {string} description
   * @param {string} toggleSetting
   * @param {boolean} checked
   * @param {string} submenuKey
   * @param {string} selectLabel
   * @param {string} selectDescription
   * @param {string} selectSetting
   * @param {string|number} selectValue
   * @param {Array<{value: string|number, label: string}>} options
   * @returns {string}
   */
  function createSettingsToggleWithSelectSubmenu(
    label,
    description,
    toggleSetting,
    checked,
    submenuKey,
    selectLabel,
    selectDescription,
    selectSetting,
    selectValue,
    options
  ) {
    const toggleSettingEsc = escapeHTML(toggleSetting);
    const submenuKeyEsc = escapeHTML(submenuKey);
    const toggleInputId = `yp-setting-${toggleSettingEsc}`;
    return `
    <div class="yp-settings-item yp-settings-item--with-submenu">
      <div>
        <label class="yp-settings-item-label" for="${toggleInputId}">${escapeHTML(label)}</label>
        <div class="yp-settings-item-description">${escapeHTML(description)}</div>
      </div>
      <div class="yp-settings-item-actions">
        <button
          type="button"
          class="yp-submenu-toggle"
          data-submenu="${submenuKeyEsc}"
          aria-label="Toggle ${submenuKeyEsc} submenu"
          aria-expanded="${checked ? 'true' : 'false'}"
          ${checked ? '' : 'disabled'}
          style="display:${checked ? 'inline-flex' : 'none'};"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <input type="checkbox" id="${toggleInputId}" class="yp-settings-checkbox" data-setting="${toggleSettingEsc}" ${checked ? 'checked' : ''} aria-label="${escapeHTML(label)}">
      </div>
    </div>
    <div class="style-side-videos-submenu" data-submenu="${submenuKeyEsc}" style="display:${checked ? 'block' : 'none'};">
      <div class="glass-card yp-settings-submenu-card">
        ${createSettingsSelect(selectLabel, selectDescription, selectSetting, selectValue, options)}
      </div>
    </div>
  `;
  }

  /**
   * Creates the download site option section
   * @param {{ key: string; name: string; description: string; checked: boolean; hasControls: boolean; controls?: string }} site - Site configuration
   * @param {Function} _t - Translation function (unused, kept for API consistency)
   * @returns {string} Download site HTML
   */
  function createDownloadSiteOption(site, _t) {
    const { key, name, description, checked, hasControls, controls } = site;
    const keyEsc = escapeHTML(key);
    const inputId = `download-site-${keyEsc}`;

    return `
    <div class="download-site-option">
      <div class="download-site-header">
        <label for="${inputId}" class="download-site-label">
          <div class="download-site-name">${escapeHTML(name)}</div>
          <div class="download-site-desc">${escapeHTML(description)}</div>
        </label>
        <input type="checkbox" id="${inputId}" class="yp-settings-checkbox" data-setting="downloadSite_${keyEsc}" ${checked ? 'checked' : ''}>
      </div>
      ${hasControls ? `<div class="download-site-controls" style="display:${checked ? 'flex' : 'none'};">${controls}</div>` : ''}
    </div>
  `;
  }

  /**
   * Creates External Downloader customization controls
   * @param {{ name?: string; url?: string }} customization - External downloader customization settings
   * @param {Function} t - Translation function
   * @returns {string} Controls HTML
   */
  function createExternalDownloaderControls(customization, t) {
    const name = customization?.name || 'SSYouTube';
    const url = customization?.url || 'https://ssyoutube.com/watch?v={videoId}';
    const siteNameLabel = t('siteName');
    const urlTemplateLabel = t('urlTemplate');

    return `
    <input type="text" placeholder="${escapeHTML(siteNameLabel)}" value="${escapeHTML(name)}"
        data-site="externalDownloader" data-field="name" class="download-site-input"
        aria-label="${escapeHTML(siteNameLabel)}">
    <input type="text" placeholder="${escapeHTML(urlTemplateLabel)}" value="${escapeHTML(url)}"
      data-site="externalDownloader" data-field="url" class="download-site-input small"
      aria-label="${escapeHTML(urlTemplateLabel)}">
    <div class="download-site-cta">
      <button class="glass-button" id="download-externalDownloader-save">${escapeHTML(t('saveButton'))}</button>
      <button class="glass-button danger" id="download-externalDownloader-reset">${escapeHTML(t('resetButton'))}</button>
    </div>
  `;
  }

  /**
   * Creates YTDL controls
   * @returns {string} Controls HTML
   */
  function createYTDLControls() {
    return `
    <div class="download-site-cta one-btn">
      <button class="glass-button" id="open-ytdl-github">
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
   * @param {YoutubePlusSettings} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Download submenu HTML
   */
  function createDownloadSubmenu(settings, t) {
    const display = settings.enableDownload ? 'block' : 'none';

    const sites = [
      {
        key: 'externalDownloader',
        name: settings.downloadSiteCustomization?.externalDownloader?.name || 'SSYouTube',
        description: t('customDownloader'),
        checked: settings.downloadSites?.externalDownloader,
        hasControls: true,
        controls: createExternalDownloaderControls(
          settings.downloadSiteCustomization?.externalDownloader,
          t
        ),
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
    <div class="download-submenu" data-submenu="download" style="display:${display};">
      <div class="glass-card download-submenu-container">
        ${sites.map(site => createDownloadSiteOption(site, t)).join('')}
      </div>
    </div>
  `;
  }

  /**
   * Small translation helper.
   * @param {Function} t - Translation function
   * @param {string} key - Translation key
   * @returns {string}
   */
  function tr(t, key, fallback = '') {
    try {
      const v = t(key);
      if (typeof v === 'string' && v && v !== key) return v;
    } catch (_e) {
      logS(_e);
      window.YouTubePlusErrorBoundary?.logError?.(
        _e instanceof Error ? _e : new Error(String(_e)),
        { module: 'SettingsHelpers' }
      );
    }
    return fallback || key;
  }

  /**
   * Creates the styles submenu (style.js feature flags)
   * @param {YoutubePlusSettings} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string}
   */
  function createStyleSubmenu(settings, t) {
    const display = settings.enableStyles ? 'block' : 'none';
    const rawSideVideosColumns = Number(settings.styles?.sideVideosColumns);
    const sideVideosColumnsValue = Number.isFinite(rawSideVideosColumns)
      ? Math.max(0, Math.min(2, rawSideVideosColumns))
      : 0;
    const sideVideosColumnsEnabled =
      settings.styles?.sideVideosColumnsEnabled === true || sideVideosColumnsValue > 0;

    const rows = [
      {
        label: tr(t, 'styleThumbnailHoverLabel'),
        desc: tr(t, 'styleThumbnailHoverDesc'),
        key: 'styles.thumbnailHover',
        value: settings.styles?.thumbnailHover,
      },
      {
        label: tr(t, 'styleImmersiveSearchLabel'),
        desc: tr(t, 'styleImmersiveSearchDesc'),
        key: 'styles.immersiveSearch',
        value: settings.styles?.immersiveSearch,
      },
      {
        label: tr(t, 'styleHideVoiceSearchLabel'),
        desc: tr(t, 'styleHideVoiceSearchDesc'),
        key: 'styles.hideVoiceSearch',
        value: settings.styles?.hideVoiceSearch,
      },
      {
        label: tr(t, 'styleTransparentHeaderLabel'),
        desc: tr(t, 'styleTransparentHeaderDesc'),
        key: 'styles.transparentHeader',
        value: settings.styles?.transparentHeader,
      },
      {
        label: tr(t, 'styleHideSideGuideLabel'),
        desc: tr(t, 'styleHideSideGuideDesc'),
        key: 'styles.hideSideGuide',
        value: settings.styles?.hideSideGuide,
      },
      {
        label: tr(t, 'styleCleanSideGuideLabel'),
        desc: tr(t, 'styleCleanSideGuideDesc'),
        key: 'styles.cleanSideGuide',
        value: settings.styles?.cleanSideGuide,
      },
      {
        label: tr(t, 'styleFixFeedLayoutLabel'),
        desc: tr(t, 'styleFixFeedLayoutDesc'),
        key: 'styles.fixFeedLayout',
        value: settings.styles?.fixFeedLayout,
      },
      {
        label: tr(t, 'styleCompactFeedLabel'),
        desc: tr(t, 'styleCompactFeedDesc'),
        key: 'styles.compactFeed',
        value: settings.styles?.compactFeed,
      },
      {
        label: tr(t, 'styleBetterCaptionsLabel'),
        desc: tr(t, 'styleBetterCaptionsDesc'),
        key: 'styles.betterCaptions',
        value: settings.styles?.betterCaptions,
      },
      {
        label: tr(t, 'stylePlayerBlurLabel'),
        desc: tr(t, 'stylePlayerBlurDesc'),
        key: 'styles.playerBlur',
        value: settings.styles?.playerBlur,
      },
      {
        label: tr(t, 'styleTheaterEnhancementsLabel'),
        desc: tr(t, 'styleTheaterEnhancementsDesc'),
        key: 'styles.theaterEnhancements',
        value: settings.styles?.theaterEnhancements,
      },
    ];

    return `
    <div class="style-submenu" data-submenu="style" style="display:${display};">
      <div class="glass-card style-submenu-container">
        ${rows.map(r => createSettingsItem(r.label, r.desc, r.key, r.value)).join('')}
        ${createSettingsToggleWithSelectSubmenu(
          tr(t, 'styleSideVideosColumnsLabel'),
          tr(t, 'styleSideVideosColumnsDesc'),
          'styles.sideVideosColumnsEnabled',
          sideVideosColumnsEnabled,
          'style-side-videos',
          tr(t, 'styleSideVideosColumnsLabel'),
          tr(t, 'styleSideVideosColumnsDesc'),
          'styles.sideVideosColumns',
          sideVideosColumnsValue,
          [
            { value: 0, label: tr(t, 'sideColsDefault') },
            { value: 1, label: tr(t, 'sideColsOne') },
            { value: 2, label: tr(t, 'sideColsTwo') },
          ]
        )}
      </div>
    </div>
  `;
  }

  /**
   * Creates the speed control submenu (hotkey customization)
   * @param {YoutubePlusSettings} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string}
   */
  function createSpeedControlSubmenu(settings, t) {
    const display = settings.enableSpeedControl ? 'block' : 'none';
    const decrease = (settings.speedControlHotkeys?.decrease || 'g').slice(0, 1).toLowerCase();
    const increase = (settings.speedControlHotkeys?.increase || 'h').slice(0, 1).toLowerCase();
    const reset = (settings.speedControlHotkeys?.reset || 'b').slice(0, 1).toLowerCase();

    return `
    <div class="speed-submenu" data-submenu="speed" style="display:${display};">
      <div class="glass-card speed-submenu-container">
        <div class="yp-settings-item speed-hotkeys-row">
          <div class="speed-hotkeys-info">
            <div class="yp-settings-item-label">${tr(t, 'speedHotkeysTitle')}</div>
            <div class="yp-settings-item-description">${tr(t, 'speedHotkeysDesc')}</div>
            <div class="speed-hotkeys-fields">
              <label class="speed-hotkey-field">
                <input
                  type="text"
                  class="speed-hotkey-input"
                  data-speed-hotkey="decrease"
                  value="${escapeHTML(decrease)}"
                  maxlength="1"
                  autocomplete="off"
                  spellcheck="false"
                >
                <span>${tr(t, 'decreaseSpeedHotkey')}</span>
              </label>
              <label class="speed-hotkey-field">
                <input
                  type="text"
                  class="speed-hotkey-input"
                  data-speed-hotkey="increase"
                  value="${escapeHTML(increase)}"
                  maxlength="1"
                  autocomplete="off"
                  spellcheck="false"
                >
                <span>${tr(t, 'increaseSpeedHotkey')}</span>
              </label>
              <label class="speed-hotkey-field">
                <input
                  type="text"
                  class="speed-hotkey-input"
                  data-speed-hotkey="reset"
                  value="${escapeHTML(reset)}"
                  maxlength="1"
                  autocomplete="off"
                  spellcheck="false"
                >
                <span>${tr(t, 'resetButton')}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  }

  /**
   * Creates the loop control submenu (hotkey customization for A → B)
   * @param {YoutubePlusSettings} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string}
   */
  function createLoopSubmenu(settings, t) {
    const display = settings.enableLoop ? 'block' : 'none';
    const setPointA = (settings.loopHotkeys?.setPointA || 'k').slice(0, 1).toLowerCase();
    const setPointB = (settings.loopHotkeys?.setPointB || 'l').slice(0, 1).toLowerCase();
    const resetPoints = (settings.loopHotkeys?.resetPoints || 'o').slice(0, 1).toLowerCase();

    return `
    <div class="loop-submenu loop-submenu-compact" data-submenu="loop" style="display:${display};">
      <div class="yp-settings-item loop-hotkeys-row loop-hotkeys-row-no-margin">
        <div class="loop-hotkeys-info">
          <div class="yp-settings-item-label">${tr(t, 'loopSegmentTitle')}</div>
          <div class="yp-settings-item-description">${tr(t, 'loopSegmentDesc')}</div>
          <div class="loop-hotkeys-fields">
            <label class="loop-hotkey-field">
              <input
                type="text"
                class="loop-hotkey-input"
                data-loop-hotkey="setPointA"
                value="${escapeHTML(setPointA)}"
                maxlength="1"
                autocomplete="off"
                spellcheck="false"
              >
              <span>${tr(t, 'setPointAHotkey')}</span>
            </label>
            <label class="loop-hotkey-field">
              <input
                type="text"
                class="loop-hotkey-input"
                data-loop-hotkey="setPointB"
                value="${escapeHTML(setPointB)}"
                maxlength="1"
                autocomplete="off"
                spellcheck="false"
              >
              <span>${tr(t, 'setPointBHotkey')}</span>
            </label>
            <label class="loop-hotkey-field">
              <input
                type="text"
                class="loop-hotkey-input"
                data-loop-hotkey="resetPoints"
                value="${escapeHTML(resetPoints)}"
                maxlength="1"
                autocomplete="off"
                spellcheck="false"
              >
              <span>${tr(t, 'resetButton')}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  `;
  }

  /**
   * Build a "checkbox + submenu toggle button" header row, shared by the
   * style/speed/download/enhanced/music settings sections. Output must stay
   * byte-identical to the inline markup it replaces.
   * @param {{
   *   inputId?: string,        // if set, label gets for="X" and input gets id="X"
   *   labelHtml: string,       // already-resolved label text (call site passes the exact translation call result)
   *   descHtml: string,
   *   submenuKey: string,      // data-submenu value
   *   ariaLabel: string,       // exact aria-label text
   *   enabled: boolean,        // drives aria-expanded / disabled / style display
   *   dataSetting: string,     // data-setting attribute on the checkbox
   *   checked: boolean         // drives the checkbox's checked attribute (may differ from `enabled`!)
   * }} cfg
   * @returns {string}
   */
  function buildToggleWithSubmenuHeader(cfg) {
    const { inputId, labelHtml, descHtml, submenuKey, ariaLabel, enabled, dataSetting, checked } =
      cfg;
    const forAttr = inputId ? ` for="${inputId}"` : '';
    const idAttr = inputId ? ` id="${inputId}"` : '';
    return `<div class="yp-settings-item yp-settings-item--with-submenu">
        <div>
          <label class="yp-settings-item-label"${forAttr}>${labelHtml}</label>
          <div class="yp-settings-item-description">${descHtml}</div>
        </div>
        <div class="yp-settings-item-actions">
          <button
            type="button"
            class="yp-submenu-toggle"
            data-submenu="${submenuKey}"
            aria-label="${ariaLabel}"
            aria-expanded="${enabled ? 'true' : 'false'}"
            ${enabled ? '' : 'disabled'}
            style="display:${enabled ? 'inline-flex' : 'none'};"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox"${idAttr} class="yp-settings-checkbox" data-setting="${dataSetting}" ${checked ? 'checked' : ''}>
        </div>
      </div>`;
  }

  /**
   * Creates the basic settings section
   * @param {YoutubePlusSettings} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Basic section HTML
   */
  function createBasicSettingsSection(settings, t) {
    const downloadEnabled = !!settings.enableDownload;
    const styleEnabled = settings.enableStyles !== false;
    const speedEnabled = !!settings.enableSpeedControl;
    return `
    <div class="yp-settings-section" data-section="basic">
      ${buildToggleWithSubmenuHeader({
        inputId: 'yp-setting-enableStyles',
        labelHtml: tr(t, 'stylesTitle'),
        descHtml: tr(t, 'stylesDesc'),
        submenuKey: 'style',
        ariaLabel: 'Toggle styles submenu',
        enabled: styleEnabled,
        dataSetting: 'enableStyles',
        checked: styleEnabled,
      })}
      ${createStyleSubmenu(settings, t)}
      ${createSettingsItem(
        tr(t, 'animationsLabel'),
        tr(t, 'animationsDesc'),
        'enableAnimations',
        settings.enableAnimations === true
      )}
      ${buildPerformanceModeHTML(settings, t)}
      ${buildToggleWithSubmenuHeader({
        inputId: 'yp-setting-enableSpeedControl',
        labelHtml: t('speedControl'),
        descHtml: t('speedControlDesc'),
        submenuKey: 'speed',
        ariaLabel: 'Toggle speed submenu',
        enabled: speedEnabled,
        dataSetting: 'enableSpeedControl',
        checked: speedEnabled,
      })}
      ${createSpeedControlSubmenu(settings, t)}
      ${buildScreenshotSettingsHTML(settings, t)}
      ${buildToggleWithSubmenuHeader({
        inputId: 'yp-setting-enableDownload',
        labelHtml: t('downloadButton'),
        descHtml: t('downloadButtonDesc'),
        submenuKey: 'download',
        ariaLabel: 'Toggle download submenu',
        enabled: downloadEnabled,
        dataSetting: 'enableDownload',
        checked: settings.enableDownload,
      })}
      ${createDownloadSubmenu(settings, t)}
      ${createSettingsItem(
        t('adBlocker'),
        t('adBlockerDescription'),
        'enableAdBlocker',
        settings.enableAdBlocker !== false
      )}
    </div>
  `;
  }

  /**
   * Creates the about section with logo
   * @param {Function} t
   * @returns {string} About section HTML
   */
  function createAboutSection(t) {
    return `
    <div class="yp-settings-section hidden" data-section="about">
      <div class="about-section-content">
        <svg class="app-icon" width="90" height="90" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" version="1.1">
          <path d="m23.24,4.62c-0.85,0.45 -2.19,2.12 -4.12,5.13c-1.54,2.41 -2.71,4.49 -3.81,6.8c-0.55,1.14 -1.05,2.2 -1.13,2.35c-0.08,0.16 -0.78,0.7 -1.66,1.28c-1.38,0.91 -1.8,1.29 -1.4,1.28c0.08,0 0.67,-0.35 1.31,-0.77c0.64,-0.42 1.19,-0.76 1.2,-0.74c0.02,0.02 -0.1,0.31 -0.25,0.66c-1.03,2.25 -1.84,5.05 -1.84,6.37c0.01,1.89 0.84,2.67 2.86,2.67c1.08,0 1.94,-0.31 3.66,-1.29c1.84,-1.06 3.03,-1.93 4.18,-3.09c1.69,-1.7 2.91,-3.4 3.28,-4.59c0.59,-1.9 -0.1,-3.08 -2.02,-3.44c-0.87,-0.16 -2.85,-0.14 -3.75,0.06c-1.78,0.38 -2.74,0.76 -2.5,1c0.03,0.03 0.5,-0.1 1.05,-0.28c1.49,-0.48 2.34,-0.59 3.88,-0.53c1.64,0.07 2.09,0.19 2.69,0.75l0.46,0.43l0,0.87c0,0.74 -0.05,0.98 -0.35,1.6c-0.69,1.45 -2.69,3.81 -4.37,5.14c-0.93,0.74 -2.88,1.94 -4.07,2.5c-1.64,0.77 -3.56,0.72 -4.21,-0.11c-0.39,-0.5 -0.5,-1.02 -0.44,-2.11c0.05,-0.85 0.16,-1.32 0.67,-2.86c0.34,-1.01 0.86,-2.38 1.15,-3.04c0.52,-1.18 0.55,-1.22 1.6,-2.14c4.19,-3.65 8.42,-9.4 9.02,-12.26c0.2,-0.94 0.13,-1.46 -0.21,-1.7c-0.31,-0.22 -0.38,-0.21 -0.89,0.06m0.19,0.26c-0.92,0.41 -3.15,3.44 -5.59,7.6c-1.05,1.79 -3.12,5.85 -3.02,5.95c0.07,0.07 1.63,-1.33 2.58,-2.34c1.57,-1.65 3.73,-4.39 4.88,-6.17c1.31,-2.03 2.06,-4.11 1.77,-4.89c-0.13,-0.34 -0.16,-0.35 -0.62,-0.15m11.69,13.32c-0.3,0.6 -1.19,2.54 -1.98,4.32c-1.6,3.62 -1.67,3.71 -2.99,4.34c-1.13,0.54 -2.31,0.85 -3.54,0.92c-0.99,0.06 -1.08,0.04 -1.38,-0.19c-0.28,-0.22 -0.31,-0.31 -0.26,-0.7c0.03,-0.25 0.64,-1.63 1.35,-3.08c1.16,-2.36 2.52,-5.61 2.52,-6.01c0,-0.49 -0.36,0.19 -1.17,2.22c-0.51,1.26 -1.37,3.16 -1.93,4.24c-0.55,1.08 -1.04,2.17 -1.09,2.43c-0.1,0.59 0.07,1.03 0.49,1.28c0.78,0.46 3.3,0.06 5.13,-0.81l0.93,-0.45l-0.66,1.25c-0.7,1.33 -3.36,6.07 -4.31,7.67c-2.02,3.41 -3.96,5.32 -6.33,6.21c-2.57,0.96 -4.92,0.74 -6.14,-0.58c-0.81,-0.88 -0.82,-1.71 -0.04,-3.22c1.22,-2.36 6.52,-6.15 10.48,-7.49c0.52,-0.18 0.95,-0.39 0.95,-0.46c0,-0.21 -0.19,-0.18 -1.24,0.2c-1.19,0.43 -3.12,1.37 -4.34,2.11c-2.61,1.59 -5.44,4.09 -6.13,5.43c-1.15,2.2 -0.73,3.61 1.4,4.6c0.59,0.28 0.75,0.3 2.04,0.3c1.67,0 2.42,-0.18 3.88,-0.89c1.87,-0.92 3.17,-2.13 4.72,-4.41c0.98,-1.44 4.66,-7.88 5.91,-10.33c0.25,-0.49 0.68,-1.19 0.96,-1.56c0.28,-0.37 0.76,-1.15 1.06,-1.73c0.82,-1.59 2.58,-6.10 2.58,-6.6c0,-0.06 -0.07,-0.1 -0.17,-0.1c-0.10,0 -0.39,0.44 -0.71,1.09m-1.34,3.7c-0.93,2.08 -1.09,2.48 -0.87,2.2c0.19,-0.24 1.66,-3.65 1.6,-3.71c-0.02,-0.02 -0.35,0.66 -0.73,1.51" fill="none" fill-rule="evenodd" stroke="currentColor" />
        </svg>
        <h1>YouTube +</h1>
      </div>
      <div class="yp-about-actions">
        <button class="glass-button" id="open-ytp-github" type="button">${escapeHTML(t('openGitHubButton'))}</button>
                <button class="glass-button" id="open-ytp-discussions" type="button">${escapeHTML(t('openDiscussionsButton'))}</button>
                <button class="glass-button" id="open-ytp-greasyfork" type="button">${escapeHTML(t('openGreasyForkButton'))}</button>
      </div>
      <div class="yp-about-footer">
        <div>Made with ❤️ by <a href="https://github.com/diorhc" target="_blank" rel="noopener noreferrer" class="yp-about-author-link" aria-label="diorhc"><svg class="yp-about-author-svg" viewBox="0 0 96 61" width="41" height="26" fill="currentColor" role="img" aria-hidden="true"><path d="M5.8 59.3Q5.7 59.1 5.7 58.8Q5.7 57.3 7.9 53Q10.5 47.7 14.9 41.1Q18 36.3 21.2 32.4Q24.3 28.5 28.4 24.1Q31.8 20.7 31.8 20.4Q31.6 20.4 27.4 23.8Q24.7 26 21 29.1Q17.3 32.2 14.4 34.8Q11.5 37.3 11.2 37.8Q11.2 37.9 11.1 38Q11 38.1 10.9 38.1Q10.8 38.1 10.2 38.5Q9.5 39 8.6 39.8Q4.6 43.2 3.2 43.8Q2.8 44 2.5 44Q2.3 44 1.9 43.8Q1 43.4 1 42.4Q1 41.2 2.3 39.2Q6.1 33.5 9 33.5Q9.2 33.5 9.3 33.5Q9.9 33.7 10.6 34.3Q11.3 34.9 11.5 35.5Q11.6 35.8 11.6 35.8Q11.7 35.9 11.7 35.9Q11.8 35.9 12 35.7Q13.9 34 17.8 30.8Q21.7 27.6 26 24.1Q30.4 20.6 33.7 18.1Q37 15.6 37.7 15.3Q37.8 15.3 37.9 15.4Q38.1 15.4 38.2 15.6Q38.2 15.6 38.2 15.7Q38.2 15.8 38.2 15.9Q38.1 16.1 37.8 16.5Q37.5 16.9 36.9 17.6Q36.3 18.2 35.3 19.3Q34.2 20.4 32.6 22Q30.2 24.6 27.9 27.1Q25.7 29.5 24.7 30.6Q20.2 36.3 15.6 42.7Q11.1 49.2 8.5 53.9Q7.3 56.1 6.9 57.3Q6.4 58.4 6.4 58.8Q6.4 58.9 6.5 59Q6.6 59 6.6 59.1Q6.7 59.2 6.7 59.2Q6.7 59.3 6.6 59.4Q6.4 59.4 6.3 59.4L6.1 59.4Q5.9 59.4 5.8 59.3ZM4.9 41.4Q6.3 40.4 7.6 39.3Q9 38.2 9.9 37.4Q10.9 36.5 10.9 36.3Q10.9 35.1 10 35.1L9.8 35.1Q8.7 35.2 7.1 36.5Q5.5 37.9 3.9 40Q3.2 40.9 2.8 41.7Q2.3 42.5 2.3 42.7Q2.3 42.8 2.4 42.8Q2.5 42.8 2.7 42.7Q3.1 42.5 3.7 42.2Q4.3 41.8 4.9 41.4ZM31.1 30.2Q30.9 30.1 30.9 29.9Q30.9 29.4 32 28.1Q32.9 27 33.4 27Q33.9 27 33.9 27.3Q33.9 27.8 32.9 28.8Q31.6 30.2 31.2 30.2Q31.1 30.2 31.1 30.2ZM22.8 44.8Q21.8 44.2 21.8 42.8Q21.8 42.4 22 41.8Q22.4 39.6 24.5 36.8Q25.7 35.4 26.6 34.6Q27.1 34.3 27.5 34.3Q27.7 34.3 27.9 34.3Q28.5 34.5 28.6 34.9Q28.7 35.2 28.7 35.3Q28.7 35.8 28 36.3Q26.8 37.1 25.6 38.7Q24.3 40.4 23.7 41.6Q23.1 42.9 23.1 43.4Q23.1 43.7 23.2 43.8Q23.2 44 23.5 44Q24.9 44 33.8 38.9Q34.3 38.6 34.9 38.4Q35 38.3 35.1 38.2Q36.5 37.5 37 37.5L37.1 37.5Q37.2 37.5 37.2 37.6Q37.2 37.9 35.8 38.7Q34.3 39.6 32.5 40.6Q30.7 41.7 29.1 42.6Q27.5 43.5 26.6 44Q25.4 44.6 24.8 44.8Q24.1 45.1 23.8 45.1L23.7 45.1Q23.2 45.1 22.8 44.8ZM34.7 44.8Q34.5 44.7 34.3 44.4Q34.2 44.2 34.1 43.9Q33.8 43.3 33.8 42.5Q33.8 41.2 34.5 39.6Q35.7 37 38.6 34.2Q40 32.8 40.3 32.7Q40.6 32.6 40.7 32.6Q41.3 32.6 41.9 33.5Q42.2 33.9 42.2 34.1Q42.3 34.3 42.3 34.5Q42.3 34.7 42.2 35Q42.2 35.3 42.2 35.5Q42.2 35.9 42.4 36.1Q42.8 36.4 44.1 36.5Q44.5 36.5 44.9 36.5Q45.6 36.5 46.3 36.4Q47.4 36.2 48.2 35.6Q48.7 35.3 48.9 35.3Q49 35.3 49 35.4Q49.1 35.4 49.1 35.6Q49.1 35.7 48.9 36Q48.7 36.5 47.8 36.9Q46.7 37.5 45.9 37.5Q45.1 37.6 44.8 37.6Q43.9 37.6 43.1 37.4Q42.7 37.2 42.5 37.2Q42.3 37.1 42.2 37.1Q42.2 37.1 42.1 37.2Q42 37.2 41.9 37.5Q41.8 37.8 41.7 38.2Q40.9 40.5 39 42.7Q37.1 44.8 35.7 45Q35.4 44.9 35.1 44.9Q34.8 44.8 34.7 44.8ZM36.4 43.3Q37.4 42.7 38.5 41.5Q39.6 40.2 40.3 38.6Q40.9 37.3 41 37Q41.1 36.6 41.1 36.4Q41.1 36.1 40.8 36Q40.8 35.9 40.7 35.9Q40.3 35.9 39.4 36.8Q38.4 37.8 37.2 39.2Q36.1 40.7 35.5 42Q35 42.9 35 43.4Q35 43.7 35.3 43.7Q35.7 43.7 36.4 43.3ZM42.5 44.3Q42.3 44 42.3 43.8Q42.3 43.5 42.5 43.1Q42.8 42.4 44.3 40.4Q45.7 38.3 47.2 36.3Q48.8 34.3 49.3 33.8Q49.5 33.7 49.6 33.7L49.7 33.7Q49.8 33.7 50.1 34Q50.6 34.4 50.6 34.8L50.6 34.9Q50.6 35.3 49.9 36.1Q49.6 36.5 49.4 36.8Q49.2 37 49.2 37.1L49.4 37.1Q49.6 37.1 49.8 37.1Q50.4 37.1 51 37.6Q51.5 38.1 52 38.9Q52.5 39.8 53.4 39.8Q53.9 39.8 54.4 39.6Q55 39.4 55.7 38.9Q56.4 38.5 56.9 38.1Q57.4 37.7 57.4 37.5Q57.4 37.4 57.4 37.4Q57.5 37.4 57.6 37.5Q57.7 37.7 57.7 37.8Q57.7 38.4 56.2 39.5Q54.6 40.6 53.5 40.6L53.4 40.6Q52.3 40.5 51.3 39Q50.7 38 50.2 38Q49.4 38 47.7 39.8Q45.9 41.5 44.1 44Q43.5 44.8 43.3 44.8Q43.1 44.8 43.1 44.8Q42.8 44.8 42.5 44.3ZM62.8 44.1Q61.9 43.6 61.9 42.5Q61.9 40.6 64.6 37.1Q65.3 36.2 65.6 35.6Q66 35.1 66 35Q65.8 35 65.2 35.3Q64.4 35.7 63.4 36.4Q62.4 37 61.5 37.6Q60.8 38.2 59.7 39Q58.6 39.9 57.7 40.7Q55.8 42.3 54.8 43Q53.8 43.8 53.6 43.8Q53.3 43.9 53.2 43.9Q53 43.9 52.9 43.6Q52.9 43.2 54.7 40.4Q56.6 37.5 59.3 33.8Q61.9 30.1 64.2 27.1Q67.1 23.4 69.4 20.7Q71.8 17.9 75.4 14.2Q84.6 4.5 89.7 1.9Q91.4 1 92.5 1Q93.2 1 93.7 1.4Q94.2 1.8 94.2 2.6Q94.2 3.5 93.4 5.1Q90.4 10.4 81.9 18Q73.4 25.6 65.7 29.7L63.3 30.9L60.1 35.1Q59.5 35.9 59.1 36.5Q58.4 37.4 57.9 38Q57.4 38.6 57.2 39Q56.9 39.4 56.8 39.6Q56.6 39.8 56.6 39.8Q56.6 39.9 56.6 39.9L56.7 39.9L56.7 39.8Q56.9 39.7 57.3 39.4Q57.7 39 58.2 38.6Q59.7 37.4 61.5 36.3Q63.3 35.1 64.7 34.3Q66.2 33.4 66.7 33.4Q67.1 33.4 67.4 33.9Q67.7 34.3 67.7 34.9Q67.7 35.4 65.9 37.9Q63 41.9 63 42.9Q63 43.2 63.3 43.2Q65.1 43.2 71.2 38.7Q72 38.1 72.5 37.7Q72.9 37.4 73 37.4Q73.1 37.4 73.1 37.5Q73.1 37.6 73 37.7Q72.9 37.9 72.7 38.1Q72.4 38.3 71.4 39Q71 39.4 70.5 39.8Q66.1 43.2 64.5 43.9Q63.9 44.1 63.7 44.2Q63.5 44.3 63.4 44.3L63.2 44.3Q63.1 44.2 62.8 44.1ZM70.4 25.7Q72.7 24.1 75.9 21.6Q79.1 19.1 81.9 16.7Q85.7 13.3 88.6 9.9Q91.6 6.6 92.7 4.4Q93.1 3.3 93.1 2.9Q93.1 2.4 92.8 2.4L92.6 2.4Q91.9 2.4 90.6 3.1Q86.9 5 80.8 11Q74.7 16.9 67.9 25.1Q67 26.3 66.2 27.2Q65.5 28.1 65.3 28.4Q65 28.8 65 28.8Q65 28.9 65.1 28.9Q65.2 28.9 65.4 28.8Q65.6 28.6 66.5 28.2Q67.2 27.8 68.3 27.1Q69.4 26.4 70.4 25.7ZM71 43.8Q70 42.8 70 41.6Q70 41.1 70.2 40.5Q71 37.8 73.8 35.3Q76.5 32.8 79 32.5Q79.4 32.4 79.6 32.4Q79.9 32.4 80 32.5Q80.2 32.6 80.6 33.1Q81.1 33.7 81.1 34.2Q81.1 34.9 80.4 35.5Q79.9 36 79.5 36.2Q79 36.4 78.8 36.4Q78.7 36.4 78.6 36.4Q78.6 36.3 78.8 36.1Q79 35.8 79.3 35.4Q80.1 34.4 80.1 34.1Q80.1 33.8 79.8 33.8L79.6 33.8Q77.9 34.3 76 35.8Q74.1 37.4 72.8 39.3Q71.4 41.1 71.4 42.5Q71.4 42.9 71.5 43Q71.7 43.1 72.2 43.2Q72.4 43.3 72.8 43.3Q74.8 43.3 79.3 41.1Q80.2 40.6 81.4 39.9Q82.5 39.2 83.6 38.5Q84.4 38.1 85 37.7Q85.4 37.5 85.5 37.5Q85.6 37.5 85.7 37.6Q85.7 37.6 85.7 37.7Q85.7 37.8 85.3 38.1L85.3 38.2Q84.7 38.6 83.2 39.7Q81.7 40.7 79.7 41.9Q76.8 43.4 75.2 44Q73.7 44.6 72.6 44.6Q72 44.6 71.7 44.5Q71.4 44.3 71 43.8Z"/></svg></a></div>
        <div>License: MIT</div>
      </div>
    </div>
  `;
  }

  /**
   * Gets YouTube Music settings for the modal HTML render path.
   *
   * Compatibility shim: the public `YouTubePlusSettingsStore`
   * owns persistence now. This function delegates to the store
   * so that the modal HTML continues to read the same merged
   * shape that `SettingsStore.getMusicSettings()` returns, with
   * no behavioral change for existing callers.
   *
   * Falls back to a defaults-only object if the store is not yet
   * ready, throws, or storage is unavailable (e.g. when the
   * page context is sandboxed). This keeps `createMainContent`
   * robust: a single broken accessor must not blank out every
   * section of the settings modal.
   * @returns {{ enableMusic?: boolean; immersiveSearchStyles?: boolean; hoverStyles?: boolean; playerSidebarStyles?: boolean; playerBarStyles?: boolean; centeredPlayerStyles?: boolean; centeredPlayerBarStyles?: boolean; miniPlayerStyles?: boolean; scrollToTopStyles?: boolean; }} YouTube Music settings
   */
  function getMusicSettingsCompat() {
    try {
      const store = window.YouTubePlusSettingsStore;
      return store.getMusicSettings();
    } catch (_e) {
      logS(_e);
      // SettingsStore is missing or threw (e.g. storage blocked,
      // module init order issue, partial load). Return a defaults-only
      // object so the modal still renders every section.
      return {
        enableMusic: true,
        immersiveSearchStyles: false,
        hoverStyles: true,
        playerSidebarStyles: true,
        playerBarStyles: true,
        centeredPlayerStyles: true,
        centeredPlayerBarStyles: true,
        miniPlayerStyles: true,
        scrollToTopStyles: true,
      };
    }
  }

  /**
   * Performance mode: the master switch with a submenu of the route-scoped
   * parts. The submenu follows the master switch like every other submenu.
   * @param {YoutubePlusSettings} settings
   * @param {Function} t
   * @returns {string}
   */
  function buildPerformanceModeHTML(settings, t) {
    const enabled = settings.performanceMode === true;
    return `
      ${buildToggleWithSubmenuHeader({
        inputId: 'yp-setting-performanceMode',
        labelHtml: escapeHTML(tr(t, 'performanceModeLabel')),
        descHtml: escapeHTML(tr(t, 'performanceModeDesc')),
        submenuKey: 'performance-mode',
        ariaLabel: escapeHTML(tr(t, 'performanceModeToggleSubmenu')),
        enabled,
        dataSetting: 'performanceMode',
        checked: enabled,
      })}
      <div class="performance-mode-submenu" data-submenu="performance-mode" style="display:${
        enabled ? 'block' : 'none'
      };">
        <div class="glass-card yp-settings-submenu-card">
          ${createSettingsItem(
            tr(t, 'performanceModeAmbientLabel'),
            tr(t, 'performanceModeAmbientDesc'),
            'performanceModeAmbient',
            settings.performanceModeAmbient !== false
          )}
          ${createSettingsItem(
            tr(t, 'performanceModeHoverPreviewLabel'),
            tr(t, 'performanceModeHoverPreviewDesc'),
            'performanceModeHoverPreview',
            settings.performanceModeHoverPreview !== false
          )}
          ${createSettingsItem(
            tr(t, 'performanceModeContentVisibilityLabel'),
            tr(t, 'performanceModeContentVisibilityDesc'),
            'performanceModeContentVisibility',
            settings.performanceModeContentVisibility !== false
          )}
          ${createSettingsItem(
            tr(t, 'performanceModeLazyChatLabel'),
            tr(t, 'performanceModeLazyChatDesc'),
            'performanceModeLazyChat',
            settings.performanceModeLazyChat !== false
          )}
        </div>
      </div>
    `;
  }

  /**
   * Creates the advanced settings section.
   * Note: other modules may append additional items to this section.
   * @param {YoutubePlusSettings} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Advanced section HTML
   */
  function createAdvancedSettingsSection(settings, t) {
    const musicSettings = getMusicSettingsCompat();
    const musicEnabled = !!musicSettings.enableMusic;
    const enhancedEnabled = settings.enableEnhanced !== false;

    // Enhanced features settings with defaults
    const enhancedSettings = {
      enableTabview: settings.enableTabview !== false,
      enableCommentTranslate: settings.enableCommentTranslate !== false,
      enablePlayAll: settings.enablePlayAll !== false,
      enableResumeTime: settings.enableResumeTime !== false,
      enableZoom: settings.enableZoom !== false,
      enableThumbnail: settings.enableThumbnail !== false,
      enablePlaylistSearch: settings.enablePlaylistSearch !== false,
      enableScrollToTopButton: settings.enableScrollToTopButton !== false,
      enableRememberManualQuality: settings.enableRememberManualQuality !== false,
    };

    return `
    <div class="yp-settings-section hidden" data-section="advanced">
      <div class="yp-settings-group">
        ${buildToggleWithSubmenuHeader({
          labelHtml: tr(t, 'enhancedFeaturesTitle'),
          descHtml: tr(t, 'enhancedFeaturesDesc'),
          submenuKey: 'enhanced',
          ariaLabel: 'Toggle enhanced features submenu',
          enabled: enhancedEnabled,
          dataSetting: 'enableEnhanced',
          checked: enhancedEnabled,
        })}

        <div class="enhanced-submenu" data-submenu="enhanced" style="display:${
          enhancedEnabled ? 'block' : 'none'
        };">
          <div class="glass-card yp-settings-submenu-card">
            <div class="endscreen-settings-slot"></div>
            ${createSettingsItem(
              tr(t, 'enableTabviewLabel'),
              tr(t, 'enableTabviewDesc'),
              'enableTabview',
              enhancedSettings.enableTabview
            )}
            ${createSettingsItem(
              tr(t, 'enableCommentTranslateLabel'),
              tr(t, 'enableCommentTranslateDesc'),
              'enableCommentTranslate',
              enhancedSettings.enableCommentTranslate
            )}
            ${createSettingsItem(
              tr(t, 'enablePlayAllLabel'),
              tr(t, 'enablePlayAllDesc'),
              'enablePlayAll',
              enhancedSettings.enablePlayAll
            )}
            ${createSettingsItem(
              tr(t, 'enableResumeTimeLabel'),
              tr(t, 'enableResumeTimeDesc'),
              'enableResumeTime',
              enhancedSettings.enableResumeTime
            )}
            ${createSettingsItem(
              tr(t, 'enableZoomLabel'),
              tr(t, 'enableZoomDesc'),
              'enableZoom',
              enhancedSettings.enableZoom
            )}
            ${createSettingsItem(
              tr(t, 'thumbnailPreview'),
              tr(t, 'thumbnailPreviewDesc'),
              'enableThumbnail',
              enhancedSettings.enableThumbnail
            )}
            ${createSettingsItem(
              tr(t, 'enablePlaylistSearchLabel'),
              tr(t, 'enablePlaylistSearchDesc'),
              'enablePlaylistSearch',
              enhancedSettings.enablePlaylistSearch
            )}
            ${createSettingsItem(
              tr(t, 'scrollToTopButtonLabel'),
              tr(t, 'scrollToTopButtonDesc'),
              'enableScrollToTopButton',
              enhancedSettings.enableScrollToTopButton
            )}
            ${createSettingsItem(
              tr(t, 'rememberManualQualityLabel'),
              tr(t, 'rememberManualQualityDesc'),
              'enableRememberManualQuality',
              enhancedSettings.enableRememberManualQuality
            )}
            <div class="yp-settings-item yp-settings-item--with-submenu yp-settings-item--top-gap">
              <div>
                <label class="yp-settings-item-label">${tr(t, 'enableLoopLabel')}</label>
                <div class="yp-settings-item-description">${tr(t, 'enableLoopDesc')}</div>
              </div>
              <div class="yp-settings-item-actions">
                <input type="checkbox" class="yp-settings-checkbox" data-setting="enableLoop" ${
                  settings.enableLoop ? 'checked' : ''
                }>
              </div>
            </div>
            ${createLoopSubmenu(settings, t)}
          </div>
        </div>

        ${buildToggleWithSubmenuHeader({
          labelHtml: t('youtubeMusicTitle'),
          descHtml: t('youtubeMusicDesc'),
          submenuKey: 'music',
          ariaLabel: 'Toggle YouTube Music submenu',
          enabled: musicEnabled,
          dataSetting: 'enableMusic',
          checked: !!musicSettings.enableMusic,
        })}

        <div class="music-submenu" data-submenu="music" style="display:${
          musicEnabled ? 'block' : 'none'
        };">
          <div class="glass-card yp-settings-submenu-card">
            ${createSettingsItem(
              t('immersiveSearchLabel'),
              t('immersiveSearchDesc'),
              'immersiveSearchStyles',
              !!musicSettings.immersiveSearchStyles
            )}
            ${createSettingsItem(
              t('sidebarHoverLabel'),
              t('sidebarHoverDesc'),
              'hoverStyles',
              !!musicSettings.hoverStyles
            )}
            ${createSettingsItem(
              t('playerSidebarStylesLabel'),
              t('playerSidebarStylesDesc'),
              'playerSidebarStyles',
              !!musicSettings.playerSidebarStyles
            )}
            ${createSettingsItem(
              t('centeredPlayerLabel'),
              t('centeredPlayerDesc'),
              'centeredPlayerStyles',
              !!musicSettings.centeredPlayerStyles
            )}
            ${createSettingsItem(
              t('playerBarStylesLabel'),
              t('playerBarStylesDesc'),
              'playerBarStyles',
              !!musicSettings.playerBarStyles
            )}
            ${createSettingsItem(
              t('centeredPlayerBarStylesLabel'),
              t('centeredPlayerBarStylesDesc'),
              'centeredPlayerBarStyles',
              !!musicSettings.centeredPlayerBarStyles
            )}
            ${createSettingsItem(
              t('miniPlayerStylesLabel'),
              t('miniPlayerStylesDesc'),
              'miniPlayerStyles',
              !!musicSettings.miniPlayerStyles
            )}
          </div>
        </div>

        ${buildPipSettingsHTML(settings, t)}

        ${buildTimecodeSettingsHTML(settings, t)}
      </div>
    </div>
  `;
  }

  /**
   * Build PiP settings HTML for the Advanced section.
   * @param {YoutubePlusSettings} settings
   * @param {Function} t
   * @returns {string}
   */
  function buildPipSettingsHTML(settings, t) {
    const pipEnabled = settings.enablePip !== false;
    const pipShortcut = readModuleShortcut('pip', 'youtube_pip_settings', {
      key: 'P',
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
    });
    const storedExpanded = readSubmenuExpanded('pip');
    const initialExpanded = typeof storedExpanded === 'boolean' ? storedExpanded : true;
    const submenuVisible = pipEnabled && initialExpanded;

    return `
      <div class="yp-settings-item pip-settings-item yp-settings-item--with-submenu">
        <div>
          <label class="yp-settings-item-label" for="pip-enable-checkbox">${escapeHTML(t('pipTitle'))}</label>
          <div class="yp-settings-item-description">${escapeHTML(t('pipDescription'))}</div>
        </div>
        <div class="yp-settings-item-actions">
          <button
            type="button"
            class="yp-submenu-toggle${pipEnabled ? '' : ' pip-submenu-toggle-hidden'}"
            data-submenu="pip"
            aria-label="${escapeHTML(t('togglePipSubmenu'))}"
            aria-expanded="${initialExpanded ? 'true' : 'false'}"
            ${pipEnabled ? '' : 'disabled'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" class="yp-settings-checkbox" data-setting="enablePip" id="pip-enable-checkbox" ${pipEnabled ? 'checked' : ''}>
        </div>
      </div>

      <div class="pip-submenu pip-submenu-layout${submenuVisible ? '' : ' is-hidden'}" data-submenu="pip">
        <div class="glass-card pip-submenu-card">
          <div class="yp-settings-item pip-shortcut-item">
            <div>
              <label class="yp-settings-item-label">${escapeHTML(t('keyboardShortcut'))}</label>
              <div class="yp-settings-item-description">${escapeHTML(t('pipShortcutDescription'))}</div>
            </div>
            <div class="pip-shortcut-editor">
              ${buildShortcutEditorHTML('pip', pipShortcut, t)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Build Timecode settings HTML for the Advanced section.
   * @param {YoutubePlusSettings} _settings
   * @param {Function} t
   * @returns {string}
   */
  function buildTimecodeSettingsHTML(_settings, t) {
    // The on/off flag lives in the settings store (`timecodeEnabled`); the
    // legacy key only keeps the module preferences (shortcut, position).
    const timecodeEnabled = window.YouTubePlusSettingsStore?.get?.('timecodeEnabled') ?? true;
    const timecodeShortcut = readModuleShortcut('timecode', 'youtube_timecode_settings', {
      key: 'T',
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
    });
    const storedExpanded = readSubmenuExpanded('timecode');
    const initialExpanded = typeof storedExpanded === 'boolean' ? storedExpanded : true;
    const submenuVisible = timecodeEnabled && initialExpanded;

    return `
      <div class="yp-settings-item timecode-settings-item yp-settings-item--with-submenu">
        <div>
          <label class="yp-settings-item-label" for="timecode-enable-checkbox">${escapeHTML(t('enableTimecode'))}</label>
          <div class="yp-settings-item-description">${escapeHTML(t('enableDescription'))}</div>
        </div>
        <div class="yp-settings-item-actions">
          <button
            type="button"
            class="yp-submenu-toggle timecode-submenu-toggle${timecodeEnabled ? '' : ' timecode-submenu-toggle-hidden'}"
            data-submenu="timecode"
            aria-label="${tr(t, 'timecodeSubmenuToggle', 'Toggle timecode submenu')}"
            aria-expanded="${initialExpanded ? 'true' : 'false'}"
            ${timecodeEnabled ? '' : 'disabled'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" id="timecode-enable-checkbox" class="yp-settings-checkbox" data-setting="timecodeEnabled" ${timecodeEnabled ? 'checked' : ''}>
        </div>
      </div>

      <div class="timecode-submenu timecode-submenu-layout${submenuVisible ? '' : ' is-hidden'}" data-submenu="timecode">
        <div class="glass-card timecode-submenu-card">
          <div class="yp-settings-item timecode-settings-item timecode-shortcut-item timecode-shortcut-row">
            <div>
              <label class="yp-settings-item-label">${escapeHTML(t('keyboardShortcut'))}</label>
              <div class="yp-settings-item-description">${escapeHTML(t('shortcutDescription'))}</div>
            </div>
            <div class="timecode-shortcut-editor">
              ${buildShortcutEditorHTML('timecode', timecodeShortcut, t)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Build Screenshot settings HTML for the General section.
   * @param {Record<string, unknown>} settings
   * @param {Function} t
   * @returns {string}
   */
  function buildScreenshotSettingsHTML(settings, t) {
    const screenshotEnabled = settings?.enableScreenshot !== false;
    const screenshotShortcut = readModuleShortcut('screenshot', 'youtube_screenshot_settings', {
      key: 'S',
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
    });
    const storedExpanded = readSubmenuExpanded('screenshot');
    const initialExpanded = typeof storedExpanded === 'boolean' ? storedExpanded : true;
    const submenuVisible = screenshotEnabled && initialExpanded;

    return `
      <div class="yp-settings-item screenshot-settings-item yp-settings-item--with-submenu">
        <div>
          <label class="yp-settings-item-label" for="yp-setting-enableScreenshot">${escapeHTML(t('screenshotButton'))}</label>
          <div class="yp-settings-item-description">${escapeHTML(t('screenshotButtonDesc'))}</div>
        </div>
        <div class="yp-settings-item-actions">
          <button
            type="button"
            class="yp-submenu-toggle screenshot-submenu-toggle${screenshotEnabled ? '' : ' screenshot-submenu-toggle-hidden'}"
            data-submenu="screenshot"
            aria-label="${escapeHTML(t('toggleScreenshotSubmenu'))}"
            aria-expanded="${initialExpanded ? 'true' : 'false'}"
            ${screenshotEnabled ? '' : 'disabled'}
            style="display:${screenshotEnabled ? 'inline-flex' : 'none'};"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" id="yp-setting-enableScreenshot" class="yp-settings-checkbox" data-setting="enableScreenshot" ${screenshotEnabled ? 'checked' : ''}>
        </div>
      </div>

      <div class="screenshot-submenu screenshot-submenu-layout${submenuVisible ? '' : ' is-hidden'}" data-submenu="screenshot" style="display:${submenuVisible ? 'block' : 'none'};">
        <div class="glass-card screenshot-submenu-card">
          <div class="yp-settings-item screenshot-shortcut-item screenshot-shortcut-row">
            <div>
              <label class="yp-settings-item-label">${escapeHTML(t('keyboardShortcut'))}</label>
              <div class="yp-settings-item-description">${escapeHTML(t('screenshotShortcutDescription'))}</div>
            </div>
            <div class="screenshot-shortcut-editor">
              ${buildShortcutEditorHTML('screenshot', screenshotShortcut, t)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /** @param {boolean} on @returns {string} */
  const themeActiveClass = on => (on ? 'active' : '');
  /** @param {boolean} on @returns {string} */
  const themeAriaChecked = on => (on ? 'true' : 'false');

  /**
   * One material-style radio button of a theme card (Glass or Solid).
   * @param {{ layout: string, style: string, activeVariant: string, activeStyle: string, t: Function }} args
   * @returns {string}
   */
  const themeStyleButton = ({ layout, style, activeVariant, activeStyle, t }) => {
    const on = activeVariant === layout && activeStyle === style;
    const label =
      style === 'glass'
        ? tr(t, 'themeVariantGlass', 'Glassmorphism')
        : tr(t, 'themeVariantSolid', 'Solid');
    return `<button type="button" class="yp-theme-style-btn ${themeActiveClass(on)}" role="radio" aria-checked="${themeAriaChecked(on)}" data-layout="${layout}" data-style="${style}">${label}</button>`;
  };

  /**
   * Helper to render the 2 theme layout cards (Vision and Classic)
   * with inner Glass/Solid material style toggle.
   * @param {YoutubePlusSettings} settings
   * @param {Function} t
   * @returns {string}
   */
  function createThemeCardsGrid(settings, t) {
    const rawVariant = settings?.styles?.themeVariant;
    const activeVariant = rawVariant === 'classic' || rawVariant === 'solid' ? 'classic' : 'vision';
    const activeStyle =
      settings?.styles?.themeStyle || (rawVariant === 'solid' ? 'solid' : 'glass');

    return `
    <div class="yp-theme-grid" role="radiogroup" aria-label="${tr(t, 'styleThemeVariantLabel', 'Theme')}">
      <div
        class="yp-theme-card ${themeActiveClass(activeVariant === 'vision')}"
        role="radio"
        tabindex="0"
        aria-checked="${themeAriaChecked(activeVariant === 'vision')}"
        data-setting-card="styles.themeVariant"
        data-value="vision"
      >
        <div class="yp-theme-card-icon">
          <!-- 3D Floating Pods / Vision Icon -->
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="5" width="4.5" height="14" rx="2" opacity="0.9"/>
            <rect x="9.5" y="4" width="11.5" height="16" rx="2.5" opacity="0.45"/>
            <rect x="11.5" y="7" width="7.5" height="2" rx="1" opacity="0.8"/>
            <rect x="11.5" y="11" width="5" height="2" rx="1" opacity="0.8"/>
          </svg>
        </div>
        <span class="yp-theme-card-title">${tr(t, 'themeVariantVision', 'Vision')}</span>
        <span class="yp-theme-card-desc">${tr(t, 'themeVariantVisionDesc', 'Floating pods interface with detached sidebar.')}</span>
        <div class="yp-theme-style-bar" role="radiogroup" aria-label="${tr(t, 'themeVariantMaterial', 'Material')}">
          ${themeStyleButton({ layout: 'vision', style: 'glass', activeVariant, activeStyle, t })}
          ${themeStyleButton({ layout: 'vision', style: 'solid', activeVariant, activeStyle, t })}
        </div>
      </div>
      <div
        class="yp-theme-card ${themeActiveClass(activeVariant === 'classic')}"
        role="radio"
        tabindex="0"
        aria-checked="${themeAriaChecked(activeVariant === 'classic')}"
        data-setting-card="styles.themeVariant"
        data-value="classic"
      >
        <div class="yp-theme-card-icon">
          <!-- Classic Window Monolith Icon -->
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path opacity="0.9" d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3H4V4z"/>
            <path opacity="0.65" d="M4 7h5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"/>
            <path opacity="0.4" d="M9 7h11v13a2 2 0 0 1-2 2H9V7z"/>
          </svg>
        </div>
        <span class="yp-theme-card-title">${tr(t, 'themeVariantClassic', 'Classic')}</span>
        <span class="yp-theme-card-desc">${tr(t, 'themeVariantClassicDesc', 'Monolithic window layout with integrated sidebar.')}</span>
        <div class="yp-theme-style-bar" role="radiogroup" aria-label="${tr(t, 'themeVariantMaterial', 'Material')}">
          ${themeStyleButton({ layout: 'classic', style: 'glass', activeVariant, activeStyle, t })}
          ${themeStyleButton({ layout: 'classic', style: 'solid', activeVariant, activeStyle, t })}
        </div>
      </div>
    </div>
  `;
  }

  /**
   * Creates the experimental settings section with YouTube Music options
   * @param {YoutubePlusSettings} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Experimental section HTML
   */
  function createExperimentalSettingsSection(settings, t) {
    const themePref = settings?.styles?.themePreference || 'device';

    return `
    <div class="yp-settings-section hidden" data-section="experimental">
        <div class="yp-settings-item yp-theme-item">
          <div class="yp-theme-header">
            <div>
              <label class="yp-settings-item-label">${tr(t, 'styleThemeVariantLabel', 'Theme')}</label>
              <div class="yp-settings-item-description">${tr(t, 'styleThemeVariantDesc', 'Choose the visual style and appearance for YouTube+')}</div >
            </div>
            <div class="yp-theme-pref-bar" role="radiogroup" aria-label="${tr(t, 'themePreferenceLabel', 'Appearance')}">
              <button type="button" class="yp-theme-pref-btn ${themePref === 'device' ? 'active' : ''}" role="radio" aria-checked="${themePref === 'device' ? 'true' : 'false'}" data-setting-card="styles.themePreference" data-value="device">${tr(t, 'themePrefDevice', 'Device')}</button>
              <button type="button" class="yp-theme-pref-btn ${themePref === 'dark' ? 'active' : ''}" role="radio" aria-checked="${themePref === 'dark' ? 'true' : 'false'}" data-setting-card="styles.themePreference" data-value="dark">${tr(t, 'themePrefDark', 'Dark')}</button>
              <button type="button" class="yp-theme-pref-btn ${themePref === 'light' ? 'active' : ''}" role="radio" aria-checked="${themePref === 'light' ? 'true' : 'false'}" data-setting-card="styles.themePreference" data-value="light">${tr(t, 'themePrefLight', 'Light')}</button>
            </div>
          </div>
          ${createThemeCardsGrid(settings, t)}
        </div>
        ${createSettingsItem(
          t('statisticsButton'),
          t('statisticsButtonDescription'),
          'enableStatsButton',
          settings.enableStatsButton !== false
        )}
        ${createSettingsItem(
          t('channelStatsTitle'),
          t('channelStatsDescription'),
          'enableChannelStats',
          settings.enableChannelStats !== false
        )}
        <div class="yp-settings-item comment-manager-settings-item">
          <div>
            <label class="yp-settings-item-label">${escapeHTML(t('commentManagement'))}</label>
            <div class="yp-settings-item-description">${escapeHTML(t('bulkDeleteDescription'))}</div>
          </div>
          <button class="yp-button update-open-page-btn comment-manager-settings-open-button" id="open-comment-history-page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15,3 21,3 21,9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
        </div>
    </div>
  `;
  }

  /**
   * Creates the voting section
   * @param {YoutubePlusSettings} _settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Voting section HTML
   */
  function createVotingSection(_settings, t) {
    return `
    <div class="yp-settings-section hidden" data-section="voting">
      <div class="yp-settings-voting-header">
        <h3>${tr(t, 'votingTitle', 'Feature Requests')}</h3>
        <p class="yp-settings-voting-desc">${tr(t, 'votingDesc', 'Vote for features you want to see in YouTube+')}</p>
      </div>

      <div class="yp-voting-preview" id="yp-voting-preview">
        <div class="yp-vote-bar-section" id="yp-vote-bar-section">
          <div class="yp-vote-bar-row">
            <div class="yp-vote-bar-count" id="yp-vote-bar-count">0</div>
            <div class="yp-vote-bar-buttons">
              <div class="yp-vote-bar-track" id="yp-vote-bar-fill"></div>
              <button class="yp-vote-bar-btn" id="yp-vote-bar-up" type="button" aria-label="${tr(t, 'like', 'Like')}" data-vote="1">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>
              </button>
              <button class="yp-vote-bar-btn" id="yp-vote-bar-down" type="button" aria-label="${tr(t, 'dislike', 'Dislike')}" data-vote="-1">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>
              </button>
            </div>
            <button class="yp-voting-comments-icon" data-preview-comments="1" type="button" aria-label="${tr(t, 'comments', 'Comments')} (0)">
              <span>&#128172;</span> 0
            </button>
          </div>
        </div>
      </div>

      <div id="yp-voting-container"></div>
    </div>
  `;
  }

  /**
   * Creates the main content area
   * @param {YoutubePlusSettings} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Main content HTML
   */
  function createMainContent(settings, t) {
    return `
    <div class="yp-settings-main">
      <div class="yp-settings-content">
        ${createBasicSettingsSection(settings, t)}
        ${createAdvancedSettingsSection(settings, t)}
        ${createExperimentalSettingsSection(settings, t)}
        ${createVotingSection(settings, t)}
        <div class="yp-settings-section hidden" data-section="report"></div>
        ${createAboutSection(t)}
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
      createSettingsSelect,
      createDownloadSiteOption,
      createBasicSettingsSection,
      createAdvancedSettingsSection,
      createExperimentalSettingsSection,
      createVotingSection,
      readSubmenuExpanded,
      getMusicSettings: getMusicSettingsCompat,
      buildScreenshotSettingsHTML,
    };
  }
})();
