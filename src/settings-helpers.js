/**
 * Settings Modal Helpers
 * Helper functions to reduce complexity of settings modal creation
 */

/* global GM_getValue */

(function () {
  'use strict';

  /**
   * Creates the sidebar navigation HTML
   * @param {Function} t - Translation function
   * @returns {string} Sidebar HTML
   */
  function createSettingsSidebar(t) {
    return `
    <div class="ytp-plus-settings-nav ytp-plus-settings-nav-rail">
      ${createNavItem('basic', t('basicTab'), createBasicIcon(), true)}
      ${createNavItem('advanced', t('advancedTab'), createAdvancedIcon())}
      ${createNavItem('experimental', t('experimentalTab'), createExperimentalIcon())}
      ${createNavItem('voting', tr(t, 'votingTab', 'Voting'), createVotingIcon())}
      ${createNavItem('report', t('reportTab'), createReportIcon())}
      ${createNavItem('about', t('aboutTab'), createAboutIcon())}
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
    <div class="ytp-plus-settings-nav-item${activeClass}" data-section="${section}" data-label="${label}" title="${label}" aria-label="${label}">
      ${icon}
      <span class="ytp-plus-settings-nav-item-label">${label}</span>
    </div>
  `;
  }

  /**
   * SVG icon creators
   */
  function createBasicIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path opacity="0.5" d="M2 12.2039C2 9.91549 2 8.77128 2.5192 7.82274C3.0384 6.87421 3.98695 6.28551 5.88403 5.10813L7.88403 3.86687C9.88939 2.62229 10.8921 2 12 2C13.1079 2 14.1106 2.62229 16.116 3.86687L18.116 5.10812C20.0131 6.28551 20.9616 6.87421 21.4808 7.82274C22 8.77128 22 9.91549 22 12.2039V13.725C22 17.6258 22 19.5763 20.8284 20.7881C19.6569 22 17.7712 22 14 22H10C6.22876 22 4.34315 22 3.17157 20.7881C2 19.5763 2 17.6258 2 13.725V12.2039Z" stroke="currentColor" stroke-width="1.5"></path> <path d="M15 18H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> </svg>
  `;
  }

  function createAdvancedIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path opacity="0.5" d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12" stroke="currentColor" stroke-width="1.5"></path> <path d="M2 14C2 11.1997 2 9.79961 2.54497 8.73005C3.02433 7.78924 3.78924 7.02433 4.73005 6.54497C5.79961 6 7.19974 6 10 6H14C16.8003 6 18.2004 6 19.27 6.54497C20.2108 7.02433 20.9757 7.78924 21.455 8.73005C22 9.79961 22 11.1997 22 14C22 16.8003 22 18.2004 21.455 19.27C20.9757 20.2108 20.2108 20.9757 19.27 21.455C18.2004 22 16.8003 22 14 22H10C7.19974 22 5.79961 22 4.73005 21.455C3.78924 20.9757 3.02433 20.2108 2.54497 19.27C2 18.2004 2 16.8003 2 14Z" stroke="currentColor" stroke-width="1.5"></path> <path d="M9.5 14.4L10.9286 16L14.5 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </svg>
  `;
  }

  function createExperimentalIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M9.74872 2.49415L18.1594 7.31987M9.74872 2.49415L2.65093 14.7455C1.31093 17.0584 2.10615 20.0159 4.42709 21.3513C6.74803 22.6867 9.7158 21.8942 11.0558 19.5813L12.5511 17.0003L14.1886 14.1738L15.902 11.2163L18.1594 7.31987M9.74872 2.49415L8.91283 2M18.1594 7.31987L19 7.80374" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M15.9021 11.2164L13.3441 9.74463M14.1887 14.1739L9.98577 11.7557M12.5512 17.0004L9.93848 15.4972" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M22 14.9166C22 16.0672 21.1046 16.9999 20 16.9999C18.8954 16.9999 18 16.0672 18 14.9166C18 14.1967 18.783 13.2358 19.3691 12.6174C19.7161 12.2512 20.2839 12.2512 20.6309 12.6174C21.217 13.2358 22 14.1967 22 14.9166Z" stroke="currentColor" stroke-width="1.5"></path> </svg>
  `;
  }

  function createReportIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M4 6V19C4 20.6569 5.34315 22 7 22H17C18.6569 22 20 20.6569 20 19V9C20 7.34315 18.6569 6 17 6H4ZM4 6V5" stroke="currentColor" stroke-width="1.5"></path> <path d="M18 6.00002V6.75002H18.75V6.00002H18ZM15.7172 2.32614L15.6111 1.58368L15.7172 2.32614ZM4.91959 3.86865L4.81353 3.12619H4.81353L4.91959 3.86865ZM5.07107 6.75002H18V5.25002H5.07107V6.75002ZM18.75 6.00002V4.30604H17.25V6.00002H18.75ZM15.6111 1.58368L4.81353 3.12619L5.02566 4.61111L15.8232 3.0686L15.6111 1.58368ZM4.81353 3.12619C3.91638 3.25435 3.25 4.0227 3.25 4.92895H4.75C4.75 4.76917 4.86749 4.63371 5.02566 4.61111L4.81353 3.12619ZM18.75 4.30604C18.75 2.63253 17.2678 1.34701 15.6111 1.58368L15.8232 3.0686C16.5763 2.96103 17.25 3.54535 17.25 4.30604H18.75ZM5.07107 5.25002C4.89375 5.25002 4.75 5.10627 4.75 4.92895H3.25C3.25 5.9347 4.06532 6.75002 5.07107 6.75002V5.25002Z" fill="currentColor"></path> <path opacity="0.5" d="M8 12H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M8 15.5H13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> </svg>
  `;
  }

  function createAboutIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M15.5 9L15.6716 9.17157C17.0049 10.5049 17.6716 11.1716 17.6716 12C17.6716 12.8284 17.0049 13.4951 15.6716 14.8284L15.5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path d="M13.2942 7.17041L12.0001 12L10.706 16.8297" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path d="M8.49994 9L8.32837 9.17157C6.99504 10.5049 6.32837 11.1716 6.32837 12C6.32837 12.8284 6.99504 13.4951 8.32837 14.8284L8.49994 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z" stroke="currentColor" stroke-width="1.5"></path> </svg>
  `;
  }

  function createVotingIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <circle cx="12" cy="6" r="4" stroke="currentColor" stroke-width="1.5"></circle> <path opacity="0.5" d="M15 13.3271C14.0736 13.1162 13.0609 13 12 13C7.58172 13 4 15.0147 4 17.5C4 19.9853 4 22 12 22C17.6874 22 19.3315 20.9817 19.8068 19.5" stroke="currentColor" stroke-width="1.5"></path> <circle cx="18" cy="16" r="4" stroke="currentColor" stroke-width="1.5"></circle> <path d="M18 14.6667V17.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M16.6665 16L19.3332 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </svg>
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
    const inputId = `ytp-plus-setting-${setting}`;
    return `
    <div class="ytp-plus-settings-item">
      <div>
        <label class="ytp-plus-settings-item-label" for="${inputId}">${label}</label>
        <div class="ytp-plus-settings-item-description">${description}</div>
      </div>
      <input type="checkbox" id="${inputId}" class="ytp-plus-settings-checkbox" data-setting="${setting}" ${checked ? 'checked' : ''}>
    </div>
  `;
  }

  /**
   * @param {any} label
   * @param {any} description
   * @param {any} setting
   * @param {any} value
   * @param {Array<{value: any, label: string}>} options
   */
  function createSettingsSelect(label, description, setting, value, options) {
    const inputId = `ytp-plus-setting-${setting}`;
    const opts = options
      .map(
        o =>
          `<option value="${o.value}"${String(value) === String(o.value) ? ' selected' : ''}>${o.label}</option>`
      )
      .join('');
    return `
    <div class="ytp-plus-settings-item">
      <div>
        <label class="ytp-plus-settings-item-label" for="${inputId}">${label}</label>
        <div class="ytp-plus-settings-item-description">${description}</div>
      </div>
      <select id="${inputId}" class="ytp-plus-settings-select" data-setting="${setting}">${opts}</select>
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
   * @param {any} selectValue
   * @param {Array<{value: any, label: string}>} options
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
    const toggleInputId = `ytp-plus-setting-${toggleSetting}`;
    return `
    <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
      <div>
        <label class="ytp-plus-settings-item-label" for="${toggleInputId}">${label}</label>
        <div class="ytp-plus-settings-item-description">${description}</div>
      </div>
      <div class="ytp-plus-settings-item-actions">
        <button
          type="button"
          class="ytp-plus-submenu-toggle"
          data-submenu="${submenuKey}"
          aria-label="Toggle ${submenuKey} submenu"
          aria-expanded="${checked ? 'true' : 'false'}"
          ${checked ? '' : 'disabled'}
          style="display:${checked ? 'inline-flex' : 'none'};"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <input type="checkbox" id="${toggleInputId}" class="ytp-plus-settings-checkbox" data-setting="${toggleSetting}" ${checked ? 'checked' : ''} aria-label="${label}">
      </div>
    </div>
    <div class="style-side-videos-submenu" data-submenu="${submenuKey}" style="display:${checked ? 'block' : 'none'};margin-left:12px;margin-bottom:8px;">
      <div class="glass-card" style="display:flex;flex-direction:column;gap:8px;">
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
    const inputId = `download-site-${key}`;

    return `
    <div class="download-site-option">
      <div class="download-site-header">
        <label for="${inputId}" class="download-site-label">
          <div class="download-site-name">${name}</div>
          <div class="download-site-desc">${description}</div>
        </label>
        <input type="checkbox" id="${inputId}" class="ytp-plus-settings-checkbox" data-setting="downloadSite_${key}" ${checked ? 'checked' : ''}>
      </div>
      ${hasControls ? `<div class="download-site-controls" style="display:${checked ? 'block' : 'none'};">${controls}</div>` : ''}
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

    return `
    <input type="text" placeholder="${t('siteName')}" value="${name}" 
        data-site="externalDownloader" data-field="name" class="download-site-input"
        aria-label="${t('siteName')}">
    <input type="text" placeholder="${t('urlTemplate')}" value="${url}" 
      data-site="externalDownloader" data-field="url" class="download-site-input small"
      aria-label="${t('urlTemplate')}">
    <div class="download-site-cta">
      <button class="glass-button" id="download-externalDownloader-save">${t('saveButton')}</button>
      <button class="glass-button danger" id="download-externalDownloader-reset">${t('resetButton')}</button>
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2">
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
   * @param {Record<string, any>} settings - Settings object
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
   * Small translation helper with fallback.
   * @param {Function} t - Translation function
   * @param {string} key - Translation key
   * @param {string} fallback - Fallback text if key is missing
   * @returns {string}
   */
  function tr(t, key, fallback) {
    try {
      const v = t(key);
      if (typeof v === 'string' && v && v !== key) return v;
    } catch (e) {
      // Non-critical, suppressed
    }
    return fallback;
  }

  /**
   * Creates the styles submenu (style.js feature flags)
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string}
   */
  function createStyleSubmenu(settings, t) {
    const display = settings.enableZenStyles ? 'block' : 'none';
    const rawSideVideosColumns = Number(settings.zenStyles?.sideVideosColumns);
    const sideVideosColumnsValue = Number.isFinite(rawSideVideosColumns)
      ? Math.max(0, Math.min(2, rawSideVideosColumns))
      : 0;
    const sideVideosColumnsEnabled =
      settings.zenStyles?.sideVideosColumnsEnabled === true || sideVideosColumnsValue > 0;

    const rows = [
      {
        label: tr(t, 'zenStyleThumbnailHoverLabel', 'Thumbnail hover preview'),
        desc: tr(t, 'zenStyleThumbnailHoverDesc', 'Enlarge inline preview player on hover'),
        key: 'zenStyles.thumbnailHover',
        value: settings.zenStyles?.thumbnailHover,
      },
      {
        label: tr(t, 'zenStyleImmersiveSearchLabel', 'Immersive search'),
        desc: tr(t, 'zenStyleImmersiveSearchDesc', 'Centered searchbox experience when focused'),
        key: 'zenStyles.immersiveSearch',
        value: settings.zenStyles?.immersiveSearch,
      },
      {
        label: tr(t, 'zenStyleHideVoiceSearchLabel', 'Hide Voice Search'),
        desc: tr(t, 'zenStyleHideVoiceSearchDesc', 'Remove microphone button from the header'),
        key: 'zenStyles.hideVoiceSearch',
        value: settings.zenStyles?.hideVoiceSearch,
      },
      {
        label: tr(t, 'zenStyleTransparentHeaderLabel', 'Transparent Header'),
        desc: tr(t, 'zenStyleTransparentHeaderDesc', 'Make the top header transparent'),
        key: 'zenStyles.transparentHeader',
        value: settings.zenStyles?.transparentHeader,
      },
      {
        label: tr(t, 'zenStyleHideSideGuideLabel', 'Hide Side Guide'),
        desc: tr(t, 'zenStyleHideSideGuideDesc', 'Completely hide the sidebar guide'),
        key: 'zenStyles.hideSideGuide',
        value: settings.zenStyles?.hideSideGuide,
      },
      {
        label: tr(t, 'zenStyleCleanSideGuideLabel', 'Clean Side Guide'),
        desc: tr(t, 'zenStyleCleanSideGuideDesc', 'Remove Premium/Sports/Settings from sidebar'),
        key: 'zenStyles.cleanSideGuide',
        value: settings.zenStyles?.cleanSideGuide,
      },
      {
        label: tr(t, 'zenStyleFixFeedLayoutLabel', 'Fix Feed Layout'),
        desc: tr(t, 'zenStyleFixFeedLayoutDesc', 'Improve video grid layout on home page'),
        key: 'zenStyles.fixFeedLayout',
        value: settings.zenStyles?.fixFeedLayout,
      },
      {
        label: tr(t, 'zenStyleCompactFeedLabel', 'Compact Feed'),
        desc: tr(
          t,
          'zenStyleCompactFeedDesc',
          'Reduce feed spacing and show quick actions inline on hover'
        ),
        key: 'zenStyles.compactFeed',
        value: settings.zenStyles?.compactFeed,
      },
      {
        label: tr(t, 'zenStyleBetterCaptionsLabel', 'Better Captions'),
        desc: tr(t, 'zenStyleBetterCaptionsDesc', 'Enhanced subtitle styling with blur backdrop'),
        key: 'zenStyles.betterCaptions',
        value: settings.zenStyles?.betterCaptions,
      },
      {
        label: tr(t, 'zenStylePlayerBlurLabel', 'Player Controls Blur'),
        desc: tr(t, 'zenStylePlayerBlurDesc', 'Add blur effect to player controls'),
        key: 'zenStyles.playerBlur',
        value: settings.zenStyles?.playerBlur,
      },
      {
        label: tr(t, 'zenStyleTheaterEnhancementsLabel', 'Theater Enhancements'),
        desc: tr(
          t,
          'zenStyleTheaterEnhancementsDesc',
          'Floating comments panel and improved theater mode'
        ),
        key: 'zenStyles.theaterEnhancements',
        value: settings.zenStyles?.theaterEnhancements,
      },
      {
        label: tr(t, 'zenStyleMiscLabel', 'Misc Enhancements'),
        desc: tr(t, 'zenStyleMiscDesc', 'Compact feed, hover menus, and other minor improvements'),
        key: 'zenStyles.misc',
        value: settings.zenStyles?.misc,
      },
    ];

    return `
    <div class="style-submenu" data-submenu="style" style="display:${display};">
      <div class="glass-card style-submenu-container">
        ${rows.map(r => createSettingsItem(r.label, r.desc, r.key, r.value)).join('')}
        ${createSettingsToggleWithSelectSubmenu(
          tr(t, 'zenStyleSideVideosColumnsLabel', 'Side Videos Columns'),
          tr(
            t,
            'zenStyleSideVideosColumnsDesc',
            'Choose how many columns to use for side videos in Zen mode'
          ),
          'zenStyles.sideVideosColumnsEnabled',
          sideVideosColumnsEnabled,
          'style-side-videos',
          tr(t, 'zenStyleSideVideosColumnsLabel', 'Side Videos Columns'),
          tr(
            t,
            'zenStyleSideVideosColumnsDesc',
            'Choose how many columns to use for side videos in Zen mode'
          ),
          'zenStyles.sideVideosColumns',
          sideVideosColumnsValue,
          [
            { value: 0, label: 'Default (Off)' },
            { value: 1, label: '1 Column' },
            { value: 2, label: '2 Columns' },
          ]
        )}
      </div>
    </div>
  `;
  }

  /**
   * Creates the speed control submenu (hotkey customization)
   * @param {Record<string, any>} settings - Settings object
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
        <div class="ytp-plus-settings-item speed-hotkeys-row">
          <div class="speed-hotkeys-info">
            <div class="ytp-plus-settings-item-label">${tr(t, 'speedHotkeysTitle', 'Keyboard hotkeys')}</div>
            <div class="ytp-plus-settings-item-description">${tr(
              t,
              'speedHotkeysDesc',
              'Use single-letter shortcuts to decrease/increase/reset playback speed'
            )}</div>
            <div class="speed-hotkeys-fields">
              <label class="speed-hotkey-field">                
                <input
                  type="text"
                  class="speed-hotkey-input"
                  data-speed-hotkey="decrease"
                  value="${decrease}"
                  maxlength="1"
                  autocomplete="off"
                  spellcheck="false"
                >
                <span>${tr(t, 'decreaseSpeedHotkey', 'Decrease')}</span>
              </label>
              <label class="speed-hotkey-field">                
                <input
                  type="text"
                  class="speed-hotkey-input"
                  data-speed-hotkey="increase"
                  value="${increase}"
                  maxlength="1"
                  autocomplete="off"
                  spellcheck="false"
                >
                <span>${tr(t, 'increaseSpeedHotkey', 'Increase')}</span>
              </label>
              <label class="speed-hotkey-field">                
                <input
                  type="text"
                  class="speed-hotkey-input"
                  data-speed-hotkey="reset"
                  value="${reset}"
                  maxlength="1"
                  autocomplete="off"
                  spellcheck="false"
                >
                <span>${tr(t, 'resetButton', 'Reset')}</span>
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
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string}
   */
  function createLoopSubmenu(settings, t) {
    const display = settings.enableLoop ? 'block' : 'none';
    const setPointA = (settings.loopHotkeys?.setPointA || 'k').slice(0, 1).toLowerCase();
    const setPointB = (settings.loopHotkeys?.setPointB || 'l').slice(0, 1).toLowerCase();
    const resetPoints = (settings.loopHotkeys?.resetPoints || 'o').slice(0, 1).toLowerCase();

    return `
    <div class="loop-submenu" data-submenu="loop" style="display:${display};margin:0 0 4px 0;">
      <div class="ytp-plus-settings-item loop-hotkeys-row" style="margin-bottom:0;">
        <div class="loop-hotkeys-info">
          <div class="ytp-plus-settings-item-label">${tr(t, 'loopSegmentTitle', 'Loop A → B')}</div>
          <div class="ytp-plus-settings-item-description">${tr(
            t,
            'loopSegmentDesc',
            'Repeat a custom segment of the video (A → B)'
          )}</div>
          <div class="loop-hotkeys-fields" style="margin-top:12px;">
            <label class="loop-hotkey-field">                
              <input
                type="text"
                class="loop-hotkey-input"
                data-loop-hotkey="setPointA"
                value="${setPointA}"
                maxlength="1"
                autocomplete="off"
                spellcheck="false"
              >
              <span>${tr(t, 'setPointAHotkey', 'Set Point A')}</span>
            </label>
            <label class="loop-hotkey-field">                
              <input
                type="text"
                class="loop-hotkey-input"
                data-loop-hotkey="setPointB"
                value="${setPointB}"
                maxlength="1"
                autocomplete="off"
                spellcheck="false"
              >
              <span>${tr(t, 'setPointBHotkey', 'Set Point B')}</span>
            </label>
            <label class="loop-hotkey-field">                
              <input
                type="text"
                class="loop-hotkey-input"
                data-loop-hotkey="resetPoints"
                value="${resetPoints}"
                maxlength="1"
                autocomplete="off"
                spellcheck="false"
              >
              <span>${tr(t, 'resetButton', 'Reset')}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  `;
  }

  /**
   * Creates the basic settings section
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Basic section HTML
   */
  function createBasicSettingsSection(settings, t) {
    const downloadEnabled = !!settings.enableDownload;
    const styleEnabled = settings.enableZenStyles !== false;
    const speedEnabled = !!settings.enableSpeedControl;
    return `
    <div class="ytp-plus-settings-section" data-section="basic">
      <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
        <div>
          <label class="ytp-plus-settings-item-label" for="ytp-plus-setting-enableZenStyles">${tr(
            t,
            'zenStylesTitle',
            'Zen styles'
          )}</label>
          <div class="ytp-plus-settings-item-description">${tr(
            t,
            'zenStylesDesc',
            'Optional UI tweaks and cosmetic improvements'
          )}</div>
        </div>
        <div class="ytp-plus-settings-item-actions">
          <button
            type="button"
            class="ytp-plus-submenu-toggle"
            data-submenu="style"
            aria-label="Toggle styles submenu"
            aria-expanded="${styleEnabled ? 'true' : 'false'}"
            ${styleEnabled ? '' : 'disabled'}
            style="display:${styleEnabled ? 'inline-flex' : 'none'};"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" id="ytp-plus-setting-enableZenStyles" class="ytp-plus-settings-checkbox" data-setting="enableZenStyles" ${
            styleEnabled ? 'checked' : ''
          }>
        </div>
      </div>
      ${createStyleSubmenu(settings, t)}
      <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
        <div>
          <label class="ytp-plus-settings-item-label" for="ytp-plus-setting-enableSpeedControl">${t(
            'speedControl'
          )}</label>
          <div class="ytp-plus-settings-item-description">${t('speedControlDesc')}</div>
        </div>
        <div class="ytp-plus-settings-item-actions">
          <button
            type="button"
            class="ytp-plus-submenu-toggle"
            data-submenu="speed"
            aria-label="Toggle speed submenu"
            aria-expanded="${speedEnabled ? 'true' : 'false'}"
            ${speedEnabled ? '' : 'disabled'}
            style="display:${speedEnabled ? 'inline-flex' : 'none'};"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" id="ytp-plus-setting-enableSpeedControl" class="ytp-plus-settings-checkbox" data-setting="enableSpeedControl" ${
            speedEnabled ? 'checked' : ''
          }>
        </div>
      </div>
      ${createSpeedControlSubmenu(settings, t)}
      ${createSettingsItem(t('screenshotButton'), t('screenshotButtonDesc'), 'enableScreenshot', settings.enableScreenshot)}
      <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
        <div>
          <label class="ytp-plus-settings-item-label" for="ytp-plus-setting-enableDownload">${t(
            'downloadButton'
          )}</label>
          <div class="ytp-plus-settings-item-description">${t('downloadButtonDesc')}</div>
        </div>
        <div class="ytp-plus-settings-item-actions">
          <button
            type="button"
            class="ytp-plus-submenu-toggle"
            data-submenu="download"
            aria-label="Toggle download submenu"
            aria-expanded="${downloadEnabled ? 'true' : 'false'}"
            ${downloadEnabled ? '' : 'disabled'}
            style="display:${downloadEnabled ? 'inline-flex' : 'none'};"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" id="ytp-plus-setting-enableDownload" class="ytp-plus-settings-checkbox" data-setting="enableDownload" ${
            settings.enableDownload ? 'checked' : ''
          }>
        </div>
      </div>
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
      <div class="about-section-content">
        <svg class="app-icon" width="90" height="90" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" version="1.1">
          <path d="m23.24,4.62c-0.85,0.45 -2.19,2.12 -4.12,5.13c-1.54,2.41 -2.71,4.49 -3.81,6.8c-0.55,1.14 -1.05,2.2 -1.13,2.35c-0.08,0.16 -0.78,0.7 -1.66,1.28c-1.38,0.91 -1.8,1.29 -1.4,1.28c0.08,0 0.67,-0.35 1.31,-0.77c0.64,-0.42 1.19,-0.76 1.2,-0.74c0.02,0.02 -0.1,0.31 -0.25,0.66c-1.03,2.25 -1.84,5.05 -1.84,6.37c0.01,1.89 0.84,2.67 2.86,2.67c1.08,0 1.94,-0.31 3.66,-1.29c1.84,-1.06 3.03,-1.93 4.18,-3.09c1.69,-1.7 2.91,-3.4 3.28,-4.59c0.59,-1.9 -0.1,-3.08 -2.02,-3.44c-0.87,-0.16 -2.85,-0.14 -3.75,0.06c-1.78,0.38 -2.74,0.76 -2.5,1c0.03,0.03 0.5,-0.1 1.05,-0.28c1.49,-0.48 2.34,-0.59 3.88,-0.53c1.64,0.07 2.09,0.19 2.69,0.75l0.46,0.43l0,0.87c0,0.74 -0.05,0.98 -0.35,1.6c-0.69,1.45 -2.69,3.81 -4.37,5.14c-0.93,0.74 -2.88,1.94 -4.07,2.5c-1.64,0.77 -3.56,0.72 -4.21,-0.11c-0.39,-0.5 -0.5,-1.02 -0.44,-2.11c0.05,-0.85 0.16,-1.32 0.67,-2.86c0.34,-1.01 0.86,-2.38 1.15,-3.04c0.52,-1.18 0.55,-1.22 1.6,-2.14c4.19,-3.65 8.42,-9.4 9.02,-12.26c0.2,-0.94 0.13,-1.46 -0.21,-1.7c-0.31,-0.22 -0.38,-0.21 -0.89,0.06m0.19,0.26c-0.92,0.41 -3.15,3.44 -5.59,7.6c-1.05,1.79 -3.12,5.85 -3.02,5.95c0.07,0.07 1.63,-1.33 2.58,-2.34c1.57,-1.65 3.73,-4.39 4.88,-6.17c1.31,-2.03 2.06,-4.11 1.77,-4.89c-0.13,-0.34 -0.16,-0.35 -0.62,-0.15m11.69,13.32c-0.3,0.6 -1.19,2.54 -1.98,4.32c-1.6,3.62 -1.67,3.71 -2.99,4.34c-1.13,0.54 -2.31,0.85 -3.54,0.92c-0.99,0.06 -1.08,0.04 -1.38,-0.19c-0.28,-0.22 -0.31,-0.31 -0.26,-0.7c0.03,-0.25 0.64,-1.63 1.35,-3.08c1.16,-2.36 2.52,-5.61 2.52,-6.01c0,-0.49 -0.36,0.19 -1.17,2.22c-0.51,1.26 -1.37,3.16 -1.93,4.24c-0.55,1.08 -1.04,2.17 -1.09,2.43c-0.1,0.59 0.07,1.03 0.49,1.28c0.78,0.46 3.3,0.06 5.13,-0.81l0.93,-0.45l-0.66,1.25c-0.7,1.33 -3.36,6.07 -4.31,7.67c-2.02,3.41 -3.96,5.32 -6.33,6.21c-2.57,0.96 -4.92,0.74 -6.14,-0.58c-0.81,-0.88 -0.82,-1.71 -0.04,-3.22c1.22,-2.36 6.52,-6.15 10.48,-7.49c0.52,-0.18 0.95,-0.39 0.95,-0.46c0,-0.21 -0.19,-0.18 -1.24,0.2c-1.19,0.43 -3.12,1.37 -4.34,2.11c-2.61,1.59 -5.44,4.09 -6.13,5.43c-1.15,2.2 -0.73,3.61 1.4,4.6c0.59,0.28 0.75,0.3 2.04,0.3c1.67,0 2.42,-0.18 3.88,-0.89c1.87,-0.92 3.17,-2.13 4.72,-4.41c0.98,-1.44 4.66,-7.88 5.91,-10.33c0.25,-0.49 0.68,-1.19 0.96,-1.56c0.28,-0.37 0.76,-1.15 1.06,-1.73c0.82,-1.59 2.58,-6.10 2.58,-6.6c0,-0.06 -0.07,-0.1 -0.17,-0.1c-0.10,0 -0.39,0.44 -0.71,1.09m-1.34,3.7c-0.93,2.08 -1.09,2.48 -0.87,2.2c0.19,-0.24 1.66,-3.65 1.6,-3.71c-0.02,-0.02 -0.35,0.66 -0.73,1.51" fill="none" fill-rule="evenodd" stroke="currentColor" />
        </svg>
        <h1>YouTube +</h1>
      </div>
      <div class="ytp-plus-about-actions" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:16px 0;">
        <button class="glass-button" id="open-ytp-github" type="button">GitHub</button>
        <button class="glass-button" id="open-ytp-discussions" type="button">Discussions</button>
        <button class="glass-button" id="open-ytp-greasyfork" type="button">GreasyFork</button>
      </div>
      <div class="ytp-plus-about-footer" style="text-align:center;color:var(--yt-text-secondary);font-size:13px;line-height:1.6;margin-bottom:12px;">        
        <div>Made with ❤️ by <a href="https://github.com/diorhc" target="_blank" rel="noopener noreferrer" style="color:var(--yt-text-primary);font-style:italic;text-decoration:none;">diorhc</a></div>
        <div>License: MIT</div>
      </div>
    </div>
  `;
  }

  /**
   * Gets YouTube Music settings from localStorage or defaults
   * @returns {{ enableMusic: boolean; immersiveSearchStyles: boolean; hoverStyles: boolean; playerSidebarStyles: boolean; centeredPlayerStyles: boolean; playerBarStyles: boolean; centeredPlayerBarStyles: boolean; miniPlayerStyles: boolean; scrollToTopStyles: boolean; }} YouTube Music settings
   */
  function getMusicSettings() {
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

    // Prefer userscript-global storage so youtube.com and music.youtube.com share the setting.
    try {
      if (typeof GM_getValue !== 'undefined') {
        const stored = GM_getValue('youtube-plus-music-settings', null);
        if (typeof stored === 'string' && stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') {
            const merged = { ...defaults };
            const mergedSettings = /** @type {Record<string,any>} */ (merged);
            const parsedSettings = /** @type {Record<string,any>} */ (parsed);
            if (typeof parsed.enableMusic === 'boolean') merged.enableMusic = parsed.enableMusic;
            for (const key of Object.keys(defaults)) {
              if (key === 'enableMusic') continue;
              if (typeof parsedSettings[key] === 'boolean') {
                mergedSettings[key] = parsedSettings[key];
              }
            }

            // Legacy flags mapping
            if (typeof parsed.enableImmersiveSearch === 'boolean') {
              merged.immersiveSearchStyles = parsed.enableImmersiveSearch;
            }
            if (typeof parsed.enableSidebarHover === 'boolean') {
              merged.hoverStyles = parsed.enableSidebarHover;
            }
            if (typeof parsed.enableCenteredPlayer === 'boolean') {
              merged.centeredPlayerStyles = parsed.enableCenteredPlayer;
            }
            if (typeof parsed.enableScrollToTop === 'boolean') {
              merged.scrollToTopStyles = parsed.enableScrollToTop;
            }

            return merged;
          }
        }
      }
    } catch (e) {
      // Non-critical, suppressed
    }

    try {
      const stored = localStorage.getItem('youtube-plus-music-settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          const merged = { ...defaults };
          const mergedSettings2 = /** @type {Record<string,any>} */ (merged);
          const parsedSettings2 = /** @type {Record<string,any>} */ (parsed);
          if (typeof parsed.enableMusic === 'boolean') merged.enableMusic = parsed.enableMusic;
          for (const key of Object.keys(defaults)) {
            if (key === 'enableMusic') continue;
            if (typeof parsedSettings2[key] === 'boolean') {
              mergedSettings2[key] = parsedSettings2[key];
            }
          }

          // Legacy flags mapping
          if (typeof parsed.enableImmersiveSearch === 'boolean') {
            merged.immersiveSearchStyles = parsed.enableImmersiveSearch;
          }
          if (typeof parsed.enableSidebarHover === 'boolean') {
            merged.hoverStyles = parsed.enableSidebarHover;
          }
          if (typeof parsed.enableCenteredPlayer === 'boolean') {
            merged.centeredPlayerStyles = parsed.enableCenteredPlayer;
          }
          if (typeof parsed.enableScrollToTop === 'boolean') {
            merged.scrollToTopStyles = parsed.enableScrollToTop;
          }

          // Backward-compat: enable if any legacy flags are enabled
          const legacyEnabled = !!(
            parsed.enableMusicStyles ||
            parsed.enableMusicEnhancements ||
            parsed.enableImmersiveSearch ||
            parsed.enableSidebarHover ||
            parsed.enableCenteredPlayer ||
            parsed.enableScrollToTop
          );
          if (legacyEnabled && typeof parsed.enableMusic !== 'boolean') merged.enableMusic = true;
          return merged;
        }
      }
    } catch (e) {
      window.console.warn('[YouTube+] Failed to load music settings:', e);
    }
    return defaults;
  }

  /**
   * Creates the advanced settings section.
   * Note: other modules may append additional items to this section.
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Advanced section HTML
   */
  function createAdvancedSettingsSection(settings, t) {
    const musicSettings = getMusicSettings();
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
    <div class="ytp-plus-settings-section hidden" data-section="advanced">
      <div class="ytp-plus-settings-group">
        <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
          <div>
            <label class="ytp-plus-settings-item-label">${tr(t, 'enhancedFeaturesTitle', 'Enhanced Features')}</label>
            <div class="ytp-plus-settings-item-description">${tr(t, 'enhancedFeaturesDesc', 'Additional productivity features and UI enhancements')}</div>
          </div>
          <div class="ytp-plus-settings-item-actions">
            <button
              type="button"
              class="ytp-plus-submenu-toggle"
              data-submenu="enhanced"
              aria-label="Toggle enhanced features submenu"
              aria-expanded="${enhancedEnabled ? 'true' : 'false'}"
              ${enhancedEnabled ? '' : 'disabled'}
              style="display:${enhancedEnabled ? 'inline-flex' : 'none'};"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableEnhanced" ${
              enhancedEnabled ? 'checked' : ''
            }>
          </div>
        </div>

        <div class="enhanced-submenu" data-submenu="enhanced" style="display:${
          enhancedEnabled ? 'block' : 'none'
        };margin-left:12px;margin-bottom:12px;">
          <div class="glass-card" style="display:flex;flex-direction:column;gap:8px;">
            <div class="endscreen-settings-slot"></div>
            ${createSettingsItem(
              tr(t, 'enableTabviewLabel', 'Tabview'),
              tr(
                t,
                'enableTabviewDesc',
                'Show description, comments and related videos in a tab panel on the right'
              ),
              'enableTabview',
              enhancedSettings.enableTabview
            )}
            ${createSettingsItem(
              tr(t, 'enableCommentTranslateLabel', 'Comment Translate'),
              tr(t, 'enableCommentTranslateDesc', 'Add a translate button to each comment'),
              'enableCommentTranslate',
              enhancedSettings.enableCommentTranslate
            )}
            ${createSettingsItem(
              tr(t, 'enablePlayAllLabel', 'Play All Button'),
              tr(t, 'enablePlayAllDesc', 'Add Play All button to playlists and channel pages'),
              'enablePlayAll',
              enhancedSettings.enablePlayAll
            )}
            ${createSettingsItem(
              tr(t, 'enableResumeTimeLabel', 'Resume Playback'),
              tr(t, 'enableResumeTimeDesc', 'Remember video position and offer to resume'),
              'enableResumeTime',
              enhancedSettings.enableResumeTime
            )}
            ${createSettingsItem(
              tr(t, 'enableZoomLabel', 'Video Zoom'),
              tr(t, 'enableZoomDesc', 'Enable zoom and pan controls for video player'),
              'enableZoom',
              enhancedSettings.enableZoom
            )}
            ${createSettingsItem(
              tr(t, 'thumbnailPreview', 'Thumbnail Preview'),
              tr(
                t,
                'thumbnailPreviewDesc',
                'Add a button to thumbnails/avatars/banners to open the original image'
              ),
              'enableThumbnail',
              enhancedSettings.enableThumbnail
            )}
            ${createSettingsItem(
              tr(t, 'enablePlaylistSearchLabel', 'Playlist Search'),
              tr(t, 'enablePlaylistSearchDesc', 'Add search functionality to playlist panels'),
              'enablePlaylistSearch',
              enhancedSettings.enablePlaylistSearch
            )}
            ${createSettingsItem(
              tr(t, 'scrollToTopButtonLabel', 'Scroll to Top'),
              tr(t, 'scrollToTopButtonDesc', 'Show scroll-to-top button on pages'),
              'enableScrollToTopButton',
              enhancedSettings.enableScrollToTopButton
            )}
            ${createSettingsItem(
              tr(t, 'rememberManualQualityLabel', 'Remember Manual Quality'),
              tr(
                t,
                'rememberManualQualityDesc',
                'Keep the last video quality you selected manually when opening the next video'
              ),
              'enableRememberManualQuality',
              enhancedSettings.enableRememberManualQuality
            )}
            <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu" style="margin-top:4px;">
              <div>
                <label class="ytp-plus-settings-item-label">${tr(t, 'enableLoopLabel', 'Loop')}</label>
                <div class="ytp-plus-settings-item-description">${tr(t, 'enableLoopDesc', 'Enable looping of videos and custom segments (A → B)')}</div>
              </div>
              <div class="ytp-plus-settings-item-actions">
                <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableLoop" ${
                  settings.enableLoop ? 'checked' : ''
                }>
              </div>
            </div>
            ${createLoopSubmenu(settings, t)}
          </div>
        </div>

        <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
          <div>
            <label class="ytp-plus-settings-item-label">${t('youtubeMusicTitle')}</label>
            <div class="ytp-plus-settings-item-description">${t('youtubeMusicDesc')}</div>
          </div>
          <div class="ytp-plus-settings-item-actions">
            <button
              type="button"
              class="ytp-plus-submenu-toggle"
              data-submenu="music"
              aria-label="Toggle YouTube Music submenu"
              aria-expanded="${musicEnabled ? 'true' : 'false'}"
              ${musicEnabled ? '' : 'disabled'}
              style="display:${musicEnabled ? 'inline-flex' : 'none'};"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableMusic" ${
              musicSettings.enableMusic ? 'checked' : ''
            }>
          </div>
        </div>

        <div class="music-submenu" data-submenu="music" style="display:${
          musicEnabled ? 'block' : 'none'
        };margin-left:12px;margin-bottom:12px;">
          <div class="glass-card" style="display:flex;flex-direction:column;gap:8px;">
            ${createSettingsItem(
              t('immersiveSearchLabel'),
              t('immersiveSearchDesc'),
              'immersiveSearchStyles',
              musicSettings.immersiveSearchStyles
            )}
            ${createSettingsItem(
              t('sidebarHoverLabel'),
              t('sidebarHoverDesc'),
              'hoverStyles',
              musicSettings.hoverStyles
            )}
            ${createSettingsItem(
              t('playerSidebarStylesLabel'),
              t('playerSidebarStylesDesc'),
              'playerSidebarStyles',
              musicSettings.playerSidebarStyles
            )}
            ${createSettingsItem(
              t('centeredPlayerLabel'),
              t('centeredPlayerDesc'),
              'centeredPlayerStyles',
              musicSettings.centeredPlayerStyles
            )}
            ${createSettingsItem(
              t('playerBarStylesLabel'),
              t('playerBarStylesDesc'),
              'playerBarStyles',
              musicSettings.playerBarStyles
            )}
            ${createSettingsItem(
              t('centeredPlayerBarStylesLabel'),
              t('centeredPlayerBarStylesDesc'),
              'centeredPlayerBarStyles',
              musicSettings.centeredPlayerBarStyles
            )}
            ${createSettingsItem(
              t('miniPlayerStylesLabel'),
              t('miniPlayerStylesDesc'),
              'miniPlayerStyles',
              musicSettings.miniPlayerStyles
            )}
          </div>
        </div>
      </div>
    </div>
  `;
  }

  /**
   * Creates the experimental settings section with YouTube Music options
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Experimental section HTML
   */
  function createExperimentalSettingsSection(settings, t) {
    const themeVariant = settings?.zenStyles?.themeVariant === 'solid' ? 'solid' : 'glass';

    return `
    <div class="ytp-plus-settings-section hidden" data-section="experimental">
        <div class="ytp-plus-settings-item ytp-plus-theme-item">
          <div>
            <label class="ytp-plus-settings-item-label">${tr(t, 'zenStyleThemeVariantLabel', 'Theme')}</label>
            <div class="ytp-plus-settings-item-description">${tr(
              t,
              'zenStyleThemeVariantDesc',
              'Choose the visual style. Solid disables blur and uses opaque surfaces for weaker GPUs.'
            )}</div>
          </div>
          <div class="ytp-plus-theme-grid" role="radiogroup" aria-label="${tr(t, 'zenStyleThemeVariantLabel', 'Theme')}">
            <button
              type="button"
              class="ytp-plus-theme-card ${themeVariant === 'glass' ? 'active' : ''}"
              role="radio"
              aria-checked="${themeVariant === 'glass' ? 'true' : 'false'}"
              data-setting-card="zenStyles.themeVariant"
              data-value="glass"
            >
              <span class="ytp-plus-theme-card-title">${tr(t, 'themeVariantGlass', 'Glassmorphism')}</span>
            </button>
            <button
              type="button"
              class="ytp-plus-theme-card ${themeVariant === 'solid' ? 'active' : ''}"
              role="radio"
              aria-checked="${themeVariant === 'solid' ? 'true' : 'false'}"
              data-setting-card="zenStyles.themeVariant"
              data-value="solid"
            >
              <span class="ytp-plus-theme-card-title">${tr(t, 'themeVariantSolid', 'Solid')}</span>
            </button>
          </div>
        </div>
    </div>
  `;
  }

  /**
   * Creates the voting section
   * @param {Record<string, any>} _settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Voting section HTML
   */
  function createVotingSection(_settings, t) {
    const previewBefore = tr(t, 'votingPreviewBefore', 'Before');
    const previewAfter = tr(t, 'votingPreviewAfter', 'After');

    return `
    <div class="ytp-plus-settings-section hidden" data-section="voting">
      <div class="ytp-plus-settings-voting-header">
        <h3>${tr(t, 'votingTitle', 'Feature Requests')}</h3>
        <p class="ytp-plus-settings-voting-desc">${tr(t, 'votingDesc', 'Vote for features you want to see in YouTube+')}</p>
      </div>

      <div class="ytp-plus-voting-preview">
        <div class="ytp-plus-ba-container">
          <div class="ytp-plus-ba-before">
            <img src="https://i.imgur.com/FVW4tdH.jpeg" alt="${previewBefore}" draggable="false" />
            <span class="ytp-plus-ba-label ytp-plus-ba-label-before">${previewBefore}</span>
          </div>
          <div class="ytp-plus-ba-after">
            <img src="https://i.imgur.com/ljq1KeL.jpeg" alt="${previewAfter}" draggable="false" />
            <span class="ytp-plus-ba-label ytp-plus-ba-label-after">${previewAfter}</span>
          </div>
          <div class="ytp-plus-ba-divider" role="separator" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div>
        </div>

        <div class="ytp-plus-vote-bar-section" id="ytp-plus-vote-bar-section">
          <div class="ytp-plus-vote-bar-buttons">
            <div class="ytp-plus-vote-bar-track" id="ytp-plus-vote-bar-fill"></div>
            <button class="ytp-plus-vote-bar-btn" id="ytp-plus-vote-bar-up" type="button" aria-label="${tr(t, 'like', 'Like')}" data-vote="1">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M20.9751 12.1852L20.2361 12.0574L20.9751 12.1852ZM20.2696 16.265L19.5306 16.1371L20.2696 16.265ZM6.93776 20.4771L6.19055 20.5417H6.19055L6.93776 20.4771ZM6.1256 11.0844L6.87281 11.0198L6.1256 11.0844ZM13.9949 5.22142L14.7351 5.34269V5.34269L13.9949 5.22142ZM13.3323 9.26598L14.0724 9.38725V9.38725L13.3323 9.26598ZM6.69813 9.67749L6.20854 9.10933H6.20854L6.69813 9.67749ZM8.13687 8.43769L8.62646 9.00585H8.62646L8.13687 8.43769ZM10.518 4.78374L9.79207 4.59542L10.518 4.78374ZM10.9938 2.94989L11.7197 3.13821L11.7197 3.13821L10.9938 2.94989ZM12.6676 2.06435L12.4382 2.77841L12.4382 2.77841L12.6676 2.06435ZM12.8126 2.11093L13.0419 1.39687L13.0419 1.39687L12.8126 2.11093ZM9.86194 6.46262L10.5235 6.81599V6.81599L9.86194 6.46262ZM13.9047 3.24752L13.1787 3.43584V3.43584L13.9047 3.24752ZM11.6742 2.13239L11.3486 1.45675L11.3486 1.45675L11.6742 2.13239ZM20.2361 12.0574L19.5306 16.1371L21.0086 16.3928L21.7142 12.313L20.2361 12.0574ZM13.245 21.25H8.59634V22.75H13.245V21.25ZM7.68497 20.4125L6.87281 11.0198L5.37839 11.149L6.19055 20.5417L7.68497 20.4125ZM19.5306 16.1371C19.0238 19.0677 16.3813 21.25 13.245 21.25V22.75C17.0712 22.75 20.3708 20.081 21.0086 16.3928L19.5306 16.1371ZM13.2548 5.10015L12.5921 9.14472L14.0724 9.38725L14.7351 5.34269L13.2548 5.10015ZM7.18772 10.2456L8.62646 9.00585L7.64728 7.86954L6.20854 9.10933L7.18772 10.2456ZM11.244 4.97206L11.7197 3.13821L10.2678 2.76157L9.79207 4.59542L11.244 4.97206ZM12.4382 2.77841L12.5832 2.82498L13.0419 1.39687L12.897 1.3503L12.4382 2.77841ZM10.5235 6.81599C10.8354 6.23198 11.0777 5.61339 11.244 4.97206L9.79207 4.59542C9.65572 5.12107 9.45698 5.62893 9.20041 6.10924L10.5235 6.81599ZM12.5832 2.82498C12.8896 2.92342 13.1072 3.16009 13.1787 3.43584L14.6306 3.05921C14.4252 2.26719 13.819 1.64648 13.0419 1.39687L12.5832 2.82498ZM11.7197 3.13821C11.7547 3.0032 11.8522 2.87913 11.9998 2.80804L11.3486 1.45675C10.8166 1.71309 10.417 2.18627 10.2678 2.76157L11.7197 3.13821ZM11.9998 2.80804C12.1345 2.74311 12.2931 2.73181 12.4382 2.77841L12.897 1.3503C12.3872 1.18655 11.8312 1.2242 11.3486 1.45675L11.9998 2.80804ZM14.1537 10.9842H19.3348V9.4842H14.1537V10.9842ZM14.7351 5.34269C14.8596 4.58256 14.824 3.80477 14.6306 3.0592L13.1787 3.43584C13.3197 3.97923 13.3456 4.54613 13.2548 5.10016L14.7351 5.34269ZM8.59634 21.25C8.12243 21.25 7.726 20.887 7.68497 20.4125L6.19055 20.5417C6.29851 21.7902 7.34269 22.75 8.59634 22.75V21.25ZM8.62646 9.00585C9.30632 8.42 10.0391 7.72267 10.5235 6.81599L9.20041 6.10924C8.85403 6.75767 8.30249 7.30493 7.64728 7.86954L8.62646 9.00585ZM21.7142 12.313C21.9695 10.8365 20.8341 9.4842 19.3348 9.4842V10.9842C19.9014 10.9842 20.3332 11.4959 20.2361 12.0574L21.7142 12.313ZM12.5921 9.14471C12.4344 10.1076 13.1766 10.9842 14.1537 10.9842V9.4842C14.1038 9.4842 14.0639 9.43901 14.0724 9.38725L12.5921 9.14471ZM6.87281 11.0198C6.84739 10.7258 6.96474 10.4378 7.18772 10.2456L6.20854 9.10933C5.62021 9.61631 5.31148 10.3753 5.37839 11.149L6.87281 11.0198Z" fill="currentColor"></path> <path opacity="0.5" d="M3.9716 21.4709L3.22439 21.5355L3.9716 21.4709ZM3 10.2344L3.74721 10.1698C3.71261 9.76962 3.36893 9.46776 2.96767 9.48507C2.5664 9.50239 2.25 9.83274 2.25 10.2344L3 10.2344ZM4.71881 21.4063L3.74721 10.1698L2.25279 10.299L3.22439 21.5355L4.71881 21.4063ZM3.75 21.5129V10.2344H2.25V21.5129H3.75ZM3.22439 21.5355C3.2112 21.383 3.33146 21.2502 3.48671 21.2502V22.7502C4.21268 22.7502 4.78122 22.1281 4.71881 21.4063L3.22439 21.5355ZM3.48671 21.2502C3.63292 21.2502 3.75 21.3686 3.75 21.5129H2.25C2.25 22.1954 2.80289 22.7502 3.48671 22.7502V21.2502Z" fill="currentColor"></path> </svg>
            </button>
            <button class="ytp-plus-vote-bar-btn" id="ytp-plus-vote-bar-down" type="button" aria-label="${tr(t, 'dislike', 'Dislike')}" data-vote="-1">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M20.9751 11.8148L20.2361 11.9426L20.9751 11.8148ZM20.2696 7.73505L19.5306 7.86285L20.2696 7.73505ZM6.93776 3.52293L6.19055 3.45832H6.19055L6.93776 3.52293ZM6.1256 12.9156L6.87281 12.9802L6.1256 12.9156ZM13.9949 18.7786L14.7351 18.6573V18.6573L13.9949 18.7786ZM13.3323 14.734L14.0724 14.6128V14.6128L13.3323 14.734ZM6.69813 14.3225L6.20854 14.8907H6.20854L6.69813 14.3225ZM8.13687 15.5623L8.62646 14.9942H8.62646L8.13687 15.5623ZM10.518 19.2163L9.79207 19.4046L10.518 19.2163ZM10.9938 21.0501L11.7197 20.8618L11.7197 20.8618L10.9938 21.0501ZM12.6676 21.9356L12.4382 21.2216L12.4382 21.2216L12.6676 21.9356ZM12.8126 21.8891L13.0419 22.6031L13.0419 22.6031L12.8126 21.8891ZM9.86194 17.5374L10.5235 17.184V17.184L9.86194 17.5374ZM13.9047 20.7525L13.1787 20.5642V20.5642L13.9047 20.7525ZM11.6742 21.8676L11.3486 22.5433L11.3486 22.5433L11.6742 21.8676ZM20.2361 11.9426L19.5306 7.86285L21.0086 7.60724L21.7142 11.687L20.2361 11.9426ZM13.245 2.75H8.59634V1.25H13.245V2.75ZM7.68497 3.58754L6.87281 12.9802L5.37839 12.851L6.19055 3.45832L7.68497 3.58754ZM19.5306 7.86285C19.0238 4.93226 16.3813 2.75 13.245 2.75V1.25C17.0712 1.25 20.3708 3.91895 21.0086 7.60724L19.5306 7.86285ZM13.2548 18.8998L12.5921 14.8553L14.0724 14.6128L14.7351 18.6573L13.2548 18.8998ZM7.18772 13.7544L8.62646 14.9942L7.64728 16.1305L6.20854 14.8907L7.18772 13.7544ZM11.244 19.0279L11.7197 20.8618L10.2678 21.2384L9.79207 19.4046L11.244 19.0279ZM12.4382 21.2216L12.5832 21.175L13.0419 22.6031L12.897 22.6497L12.4382 21.2216ZM10.5235 17.184C10.8354 17.768 11.0777 18.3866 11.244 19.0279L9.79207 19.4046C9.65572 18.8789 9.45698 18.3711 9.20041 17.8908L10.5235 17.184ZM12.5832 21.175C12.8896 21.0766 13.1072 20.8399 13.1787 20.5642L14.6306 20.9408C14.4252 21.7328 13.819 22.3535 13.0419 22.6031L12.5832 21.175ZM11.7197 20.8618C11.7547 20.9968 11.8522 21.1209 11.9998 21.192L11.3486 22.5433C10.8166 22.2869 10.417 21.8137 10.2678 21.2384L11.7197 20.8618ZM11.9998 21.192C12.1345 21.2569 12.2931 21.2682 12.4382 21.2216L12.897 22.6497C12.3872 22.8135 11.8312 22.7758 11.3486 22.5433L11.9998 21.192ZM14.1537 13.0158H19.3348V14.5158H14.1537V13.0158ZM14.7351 18.6573C14.8596 19.4174 14.824 20.1952 14.6306 20.9408L13.1787 20.5642C13.3197 20.0208 13.3456 19.4539 13.2548 18.8998L14.7351 18.6573ZM8.59634 2.75C8.12243 2.75 7.726 3.11302 7.68497 3.58754L6.19055 3.45832C6.29851 2.20975 7.34269 1.25 8.59634 1.25V2.75ZM8.62646 14.9942C9.30632 15.58 10.0391 16.2773 10.5235 17.184L9.20041 17.8908C8.85403 17.2423 8.30249 16.6951 7.64728 16.1305L8.62646 14.9942ZM21.7142 11.687C21.9695 13.1635 20.8341 14.5158 19.3348 14.5158V13.0158C19.9014 13.0158 20.3332 12.5041 20.2361 11.9426L21.7142 11.687ZM12.5921 14.8553C12.4344 13.8924 13.1766 13.0158 14.1537 13.0158V14.5158C14.1038 14.5158 14.0639 14.561 14.0724 14.6128L12.5921 14.8553ZM6.87281 12.9802C6.84739 13.2742 6.96474 13.5622 7.18772 13.7544L6.20854 14.8907C5.62021 14.3837 5.31148 13.6247 5.37839 12.851L6.87281 12.9802Z" fill="currentColor"></path> <path opacity="0.5" d="M3.9716 2.52911L3.22439 2.4645L3.9716 2.52911ZM3 13.7656L3.74721 13.8302C3.71261 14.2304 3.36893 14.5322 2.96767 14.5149C2.5664 14.4976 2.25 14.1673 2.25 13.7656L3 13.7656ZM4.71881 2.59372L3.74721 13.8302L2.25279 13.701L3.22439 2.4645L4.71881 2.59372ZM3.75 2.48709V13.7656H2.25V2.48709H3.75ZM3.22439 2.4645C3.2112 2.61704 3.33146 2.74983 3.48671 2.74983V1.24983C4.21268 1.24983 4.78122 1.87192 4.71881 2.59372L3.22439 2.4645ZM3.48671 2.74983C3.63292 2.74983 3.75 2.63139 3.75 2.48709H2.25C2.25 1.80457 2.80289 1.24983 3.48671 1.24983V2.74983Z" fill="currentColor"></path> </svg>
            </button>
          </div>
          <div class="ytp-plus-vote-bar-count" id="ytp-plus-vote-bar-count">0</div>
        </div>
      </div>

      <div id="ytp-plus-voting-container"></div>
    </div>
  `;
  }

  /**
   * Creates the main content area
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Main content HTML
   */
  function createMainContent(settings, t) {
    return `
    <div class="ytp-plus-settings-main">
      <div class="ytp-plus-settings-content">
        ${createBasicSettingsSection(settings, t)}
        ${createAdvancedSettingsSection(settings, t)}
        ${createExperimentalSettingsSection(settings, t)}
        ${createVotingSection(settings, t)}
        <div class="ytp-plus-settings-section hidden" data-section="report"></div>
        ${createAboutSection()}
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
      getMusicSettings,
    };
  }
})();
