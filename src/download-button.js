/**
 * @fileoverview Download button functionality extracted from basic.js
 * This module handles the creation and management of download buttons and dropdowns
 */

/**
 * Helper to wait for download API to be available
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object|undefined>} Download API or undefined
 */
const waitForDownloadAPI = timeout =>
  new Promise(resolve => {
    const interval = 200;
    let waited = 0;

    if (typeof window.YouTubePlusDownload !== 'undefined') {
      return resolve(window.YouTubePlusDownload);
    }

    const id = setInterval(() => {
      waited += interval;
      if (typeof window.YouTubePlusDownload !== 'undefined') {
        clearInterval(id);
        return resolve(window.YouTubePlusDownload);
      }
      if (waited >= timeout) {
        clearInterval(id);
        return resolve(undefined);
      }
    }, interval);
  });

/**
 * Fallback clipboard copy for older browsers
 * @param {string} text - Text to copy
 * @param {Function} t - Translation function
 * @param {Object} NotificationManager - Notification manager
 */
const fallbackCopyToClipboard = (text, t, NotificationManager) => {
  const input = document.createElement('input');
  input.value = text;
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
  NotificationManager.show(t('copiedToClipboard'), {
    duration: 2000,
    type: 'success',
  });
};

/**
 * Build URL from template
 * @param {string} template - URL template
 * @param {string} videoId - Video ID
 * @param {string} videoUrl - Full video URL
 * @returns {string} Built URL
 */
const buildUrl = (template, videoId, videoUrl) =>
  (template || '')
    .replace('{videoId}', videoId || '')
    .replace('{videoUrl}', encodeURIComponent(videoUrl || ''));

/**
 * Create download button element
 * @param {Function} t - Translation function
 * @returns {HTMLElement} Button element
 */
const createButtonElement = t => {
  const button = document.createElement('div');
  button.className = 'ytp-button ytp-download-button';
  button.setAttribute('title', t('downloadOptions'));
  button.setAttribute('tabindex', '0');
  button.setAttribute('role', 'button');
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `
    <svg fill="currentColor" width="24" height="24" viewBox="0 0 256 256" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;vertical-align:middle;">
      <path d="M83.17188,112.83984a4.00026,4.00026,0,0,1,5.65624-5.6582L124,142.34473V40a4,4,0,0,1,8,0V142.34473l35.17188-35.16309a4.00026,4.00026,0,0,1,5.65624,5.6582l-42,41.98926a4.00088,4.00088,0,0,1-5.65624,0ZM216,148a4.0002,4.0002,0,0,0-4,4v56a4.00427,4.00427,0,0,1-4,4H48a4.00427,4.00427,0,0,1-4-4V152a4,4,0,0,0-8,0v56a12.01343,12.01343,0,0,0,12,12H208a12.01343,12.01343,0,0,0,12-12V152A4.0002,4.0002,0,0,0,216,148Z"/>
    </svg>
  `;
  return button;
};

/**
 * Position dropdown below button
 * @param {HTMLElement} button - Button element
 * @param {HTMLElement} dropdown - Dropdown element
 */
const positionDropdown = (button, dropdown) => {
  const rect = button.getBoundingClientRect();
  const left = Math.max(8, rect.left + rect.width / 2 - 75);
  const bottom = Math.max(8, window.innerHeight - rect.top + 12);
  dropdown.style.left = `${left}px`;
  dropdown.style.bottom = `${bottom}px`;
};

/**
 * Download Site Actions - Handle different types of downloads
 */
const createDownloadActions = (t, YouTubeUtils) => {
  /**
   * Handle direct download
   */
  const handleDirectDownload = async () => {
    const api = await waitForDownloadAPI(2000);
    if (!api) {
      console.error('[YouTube+] Direct download module not loaded');
      YouTubeUtils.NotificationManager.show(t('directDownloadModuleNotAvailable'), {
        duration: 3000,
        type: 'error',
      });
      return;
    }

    try {
      if (typeof api.openModal === 'function') {
        api.openModal();
        return;
      }
      if (typeof api.downloadVideo === 'function') {
        await api.downloadVideo({ format: 'video', quality: '1080' });
        return;
      }
    } catch (err) {
      console.error('[YouTube+] Direct download invocation failed:', err);
    }

    YouTubeUtils.NotificationManager.show(t('directDownloadModuleNotAvailable'), {
      duration: 3000,
      type: 'error',
    });
  };

  /**
   * Handle YTDL download - copies URL to clipboard and opens YTDL
   * @param {string} url - YTDL URL
   */
  const handleYTDLDownload = url => {
    const videoId = new URLSearchParams(location.search).get('v');
    const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

    // Copy to clipboard
    navigator.clipboard
      .writeText(videoUrl)
      .then(() => {
        YouTubeUtils.NotificationManager.show(t('copiedToClipboard'), {
          duration: 2000,
          type: 'success',
        });
      })
      .catch(() => {
        // Fallback for older browsers
        fallbackCopyToClipboard(videoUrl, t, YouTubeUtils.NotificationManager);
      });

    // Open YTDL in new tab
    window.open(url, '_blank');
  };

  /**
   * Helper to open download site or trigger direct download
   * @param {string} url - Download URL
   * @param {boolean} isYTDL - Whether this is YTDL download
   * @param {boolean} isDirect - Whether this is direct download
   * @param {HTMLElement} dropdown - Dropdown element to hide
   * @param {HTMLElement} button - Button element
   */
  const openDownloadSite = (url, isYTDL, isDirect, dropdown, button) => {
    dropdown.classList.remove('visible');
    button.setAttribute('aria-expanded', 'false');

    if (isDirect) {
      handleDirectDownload();
      return;
    }

    if (isYTDL) {
      handleYTDLDownload(url);
      return;
    }

    window.open(url, '_blank');
  };

  return { handleDirectDownload, handleYTDLDownload, openDownloadSite };
};

/**
 * Download Sites Configuration Builder
 * @param {Function} t - Translation function
 * @returns {Function} Builder function
 */
const createDownloadSitesBuilder = t => {
  /**
   * Build list of download sites based on settings
   * @param {Object} customization - Site customization settings
   * @param {Object} enabledSites - Enabled sites flags
   * @param {string} videoId - Video ID
   * @param {string} videoUrl - Video URL
   * @returns {Object} Download sites configuration
   */
  return (customization, enabledSites, videoId, videoUrl) => {
    const baseSites = [
      {
        key: 'y2mate',
        name: customization?.y2mate?.name || 'Y2Mate',
        url: buildUrl(
          customization?.y2mate?.url || `https://www.y2mate.com/youtube/{videoId}`,
          videoId,
          videoUrl
        ),
        isYTDL: false,
        isDirect: false,
      },
      {
        key: 'ytdl',
        name: 'by YTDL',
        url: `http://localhost:5005`,
        isYTDL: true,
        isDirect: false,
      },
      {
        key: 'direct',
        name: t('directDownload'),
        url: '#',
        isYTDL: false,
        isDirect: true,
      },
    ];

    const downloadSites = baseSites.filter(s => enabledSites[s.key] !== false);

    return { baseSites, downloadSites };
  };
};

/**
 * Create dropdown options element
 * @param {Array} downloadSites - Download sites configuration
 * @param {HTMLElement} button - Button element
 * @param {Function} openDownloadSite - Click handler
 * @returns {HTMLElement} Dropdown element
 */
const createDropdownOptions = (downloadSites, button, openDownloadSite) => {
  const options = document.createElement('div');
  options.className = 'download-options';
  options.setAttribute('role', 'menu');

  const list = document.createElement('div');
  list.className = 'download-options-list';

  downloadSites.forEach(site => {
    const opt = document.createElement('div');
    opt.className = 'download-option-item';
    opt.textContent = site.name;
    opt.setAttribute('role', 'menuitem');
    opt.setAttribute('tabindex', '0');

    opt.addEventListener('click', () =>
      openDownloadSite(site.url, site.isYTDL, site.isDirect, options, button)
    );

    opt.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        openDownloadSite(site.url, site.isYTDL, site.isDirect, options, button);
      }
    });

    list.appendChild(opt);
  });

  options.appendChild(list);
  return options;
};

/**
 * Setup dropdown hover behavior
 * @param {HTMLElement} button - Button element
 * @param {HTMLElement} dropdown - Dropdown element
 */
const setupDropdownHoverBehavior = (button, dropdown) => {
  let downloadHideTimer;

  const showDropdown = () => {
    clearTimeout(downloadHideTimer);
    positionDropdown(button, dropdown);
    dropdown.classList.add('visible');
    button.setAttribute('aria-expanded', 'true');
  };

  const hideDropdown = () => {
    clearTimeout(downloadHideTimer);
    downloadHideTimer = setTimeout(() => {
      dropdown.classList.remove('visible');
      button.setAttribute('aria-expanded', 'false');
    }, 180);
  };

  button.addEventListener('mouseenter', () => {
    clearTimeout(downloadHideTimer);
    showDropdown();
  });

  button.addEventListener('mouseleave', () => {
    clearTimeout(downloadHideTimer);
    downloadHideTimer = setTimeout(hideDropdown, 180);
  });

  dropdown.addEventListener('mouseenter', () => {
    clearTimeout(downloadHideTimer);
    showDropdown();
  });

  dropdown.addEventListener('mouseleave', () => {
    clearTimeout(downloadHideTimer);
    downloadHideTimer = setTimeout(hideDropdown, 180);
  });

  button.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (dropdown.classList.contains('visible')) {
        hideDropdown();
      } else {
        showDropdown();
      }
    }
  });
};

/**
 * Rebuild dropdown with current settings
 * @param {HTMLElement} button - Button element
 * @param {HTMLElement} dropdown - Dropdown element
 * @param {HTMLElement} controls - Controls container
 * @param {Function} buildDownloadSites - Download sites builder
 * @param {Function} openDownloadSite - Click handler
 */
/**
 * Get current video information
 * @returns {Object} Video ID and URL
 */

/**
 * Create download option element
 * @param {Object} site - Site configuration
 * @param {Function} openDownloadSite - Click handler
 * @param {HTMLElement} dropdown - Dropdown element
 * @param {HTMLElement} button - Button element
 * @returns {HTMLElement} Option element
 */
/**
 * Build dropdown list with multiple sites
 * @param {Array} sites - Array of download sites
 * @param {Function} openDownloadSite - Click handler
 * @param {HTMLElement} dropdown - Dropdown element
 * @param {HTMLElement} button - Button element
 */
// buildDropdownList removed; we render list via createDropdownOptions when creating dropdown

// NOTE: rebuildDropdown removed — global rebuild now recreates via manager.addDownloadButton

/**
 * Download Button Manager - Handles download button creation and dropdown management
 * @param {Object} config - Configuration object
 * @param {Object} config.settings - Settings object
 * @param {Function} config.t - Translation function
 * @param {Function} config.getElement - Get element function
 * @param {Object} config.YouTubeUtils - YouTube utilities
 * @returns {Object} Download button manager API
 */
const createDownloadButtonManager = config => {
  const { settings, t, getElement, YouTubeUtils } = config;

  const actions = createDownloadActions(t, YouTubeUtils);
  const buildDownloadSites = createDownloadSitesBuilder(t);

  /**
   * Add download button to controls
   * @param {HTMLElement} controls - Controls container
   */
  const addDownloadButton = controls => {
    if (!settings.enableDownload) return;

    // Remove any existing button inside controls to avoid stale references
    try {
      const existingBtn = controls.querySelector('.ytp-download-button');
      if (existingBtn) existingBtn.remove();
    } catch {
      // ignore
    }

    const videoId = new URLSearchParams(location.search).get('v');
    const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

    const customization = settings.downloadSiteCustomization || {
      y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
    };

    const enabledSites = settings.downloadSites || { y2mate: true, ytdl: true, direct: true };

    const { downloadSites } = buildDownloadSites(customization, enabledSites, videoId, videoUrl);

    const button = createButtonElement(t);

    // If only one site is active, direct click without dropdown
    if (downloadSites.length === 1) {
      const singleSite = downloadSites[0];
      button.style.cursor = 'pointer';
      const tempDropdown = document.createElement('div'); // Temporary for signature compatibility
      button.addEventListener('click', () =>
        actions.openDownloadSite(
          singleSite.url,
          singleSite.isYTDL,
          singleSite.isDirect,
          tempDropdown,
          button
        )
      );
      controls.insertBefore(button, controls.firstChild);
      return;
    }

    // Create dropdown
    const dropdown = createDropdownOptions(downloadSites, button, actions.openDownloadSite);

    // Remove existing dropdown to avoid duplicates
    const existingDownload = document.querySelector('.download-options');
    if (existingDownload) existingDownload.remove();

    // Append to body to avoid positioning issues
    try {
      document.body.appendChild(dropdown);
    } catch {
      button.appendChild(dropdown);
    }

    // Setup hover behavior
    setupDropdownHoverBehavior(button, dropdown);

    // Expose manager and rebuild helper globally so SPA navigation handlers can recreate
    try {
      if (typeof window !== 'undefined') {
        window.youtubePlus = window.youtubePlus || {};
        // attach the current manager API so callers can recreate/refresh reliably
        window.youtubePlus.downloadButtonManager = window.youtubePlus.downloadButtonManager || {};
        // store minimal API (we keep a reference to addDownloadButton and refreshDownloadButton)
        window.youtubePlus.downloadButtonManager.addDownloadButton =
          window.youtubePlus.downloadButtonManager.addDownloadButton || (() => {});
        window.youtubePlus.downloadButtonManager.refreshDownloadButton =
          window.youtubePlus.downloadButtonManager.refreshDownloadButton || (() => {});

        // update to point to functions for this manager instance
        window.youtubePlus.downloadButtonManager.addDownloadButton = controlsArg =>
          addDownloadButton(controlsArg);
        window.youtubePlus.downloadButtonManager.refreshDownloadButton = () => {
          try {
            // try to find button and dropdown and apply visibility rules
            const btn = document.querySelector('.ytp-download-button');
            const dd = document.querySelector('.download-options');
            if (settings.enableDownload) {
              if (btn) btn.style.display = '';
              if (dd) dd.style.display = '';
            } else {
              if (btn) btn.style.display = 'none';
              if (dd) dd.style.display = 'none';
            }
          } catch {
            /* ignore */
          }
        };

        // Provide a convenience rebuild function used by SPA navigation handlers.
        window.youtubePlus.rebuildDownloadDropdown = () => {
          try {
            const controlsEl = document.querySelector('.ytp-right-controls');
            if (!controlsEl) return;
            // call the manager to (re)create the button and dropdown for current controls
            window.youtubePlus.downloadButtonManager.addDownloadButton(controlsEl);
            // ensure settings pointer is available globally
            window.youtubePlus.settings = window.youtubePlus.settings || settings;
          } catch (e) {
            console.warn('[YouTube+] rebuildDownloadDropdown failed:', e);
          }
        };
      }
    } catch (e) {
      console.warn('[YouTube+] expose rebuildDownloadDropdown failed:', e);
    }

    controls.insertBefore(button, controls.firstChild);
  };

  /**
   * Refresh download button visibility based on settings
   */
  const refreshDownloadButton = () => {
    const button = getElement('.ytp-download-button');
    const dropdown = document.querySelector('.download-options');

    if (settings.enableDownload) {
      if (button) button.style.display = '';
      if (dropdown) dropdown.style.display = '';
    } else {
      if (button) button.style.display = 'none';
      if (dropdown) dropdown.style.display = 'none';
    }
  };

  return {
    addDownloadButton,
    refreshDownloadButton,
  };
};

// Export for use in basic.js
if (typeof window !== 'undefined') {
  window.YouTubePlusDownloadButton = { createDownloadButtonManager };
}
