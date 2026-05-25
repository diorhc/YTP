// Update checker module
(function () {
  'use strict';

  const setTimeout_ = setTimeout.bind(window);
  const _createHTML =
    window._ytplusCreateHTML || /** @type {any} */ ((/** @type {string} */ s) => s);
  /**
   * @param {Element} container
   * @param {string} html
   */
  const renderTemplateClone = (container, html) => {
    if (!(container instanceof Element)) return;
    const template = document.createElement('template');
    const range = document.createRange();
    const root = document.body || document.documentElement;
    if (root) range.selectNode(root);
    // eslint-disable-next-line no-unsanitized/method -- pre-sanitized via Trusted Types policy (_createHTML)
    template.content.append(range.createContextualFragment(_createHTML(html)));
    container.replaceChildren(template.content.cloneNode(true));
  };

  const REFRESH_ICON_PATHS = [
    'M21.5 2v6h-6M2.5 22v-6h6',
    'M19.13 11.48A10 10 0 0 0 12 2C6.48 2 2 6.48 2 12c0 .34.02.67.05 1M4.87 12.52A10 10 0 0 0 12 22c5.52 0 10-4.48 10-10 0-.34-.02-.67-.05-1',
  ];

  /**
   * @param {boolean} spinning
   * @returns {SVGSVGElement}
   */
  const createRefreshIconElement = spinning => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.display = 'inline-block';
    svg.style.flexShrink = '0';
    svg.style.verticalAlign = 'middle';
    if (spinning) {
      svg.style.animation = 'spin .8s linear infinite';
    }

    for (const d of REFRESH_ICON_PATHS) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }

    return svg;
  };

  /**
   * @param {HTMLElement} button
   * @param {string} label
   * @param {boolean} spinning
   */
  const setManualCheckButtonContent = (button, label, spinning) => {
    if (!(button instanceof HTMLElement)) return;
    button.replaceChildren(createRefreshIconElement(spinning), document.createTextNode(label));
  };

  // Shared translation helper from YouTubeUtils
  const t = window.YouTubeUtils.t;
  const byId =
    window.YouTubeUtils?.byId ||
    ((/** @type {string} */ id) =>
      /** @type {HTMLElement|null} */ (document['getElementById'](id)));

  // Language helper delegating to global i18n when available
  const getLanguage = () => window.YouTubeUtils.getLanguage();

  /** @type {any} */
  const UPDATE_CONFIG = {
    enabled: true,
    checkInterval: 24 * 60 * 60 * 1000, // 24 hours
    updateUrl: 'https://update.greasyfork.org/scripts/537017/YouTube%20%2B.meta.js',
    currentVersion: '2.4.5',
    storageKey: 'youtube_plus_update_check',
    notificationDuration: 8000,
    autoInstallUrl: 'https://update.greasyfork.org/scripts/537017/YouTube%20%2B.user.js',
    // If true, attempt to automatically initiate installation when an update is found
    // NOTE: This will try to open the install URL (GM_openInTab / window.open / navigation).
    // Keep disabled by default for safety; enable only if you want auto-install behavior.
    autoInstallOnCheck: false,
    // When false, hide the small SVG icon shown at the left of update notifications
    // Set to `true` to show the icon again.
    showNotificationIcon: false,
  };

  const windowRef = typeof window === 'undefined' ? null : window;
  const GM_namespace = windowRef?.GM || null;
  const GM_info_safe = windowRef?.GM_info || null;
  const GM_openInTab_safe = (() => {
    if (windowRef) {
      if (typeof windowRef.GM_openInTab === 'function') {
        return windowRef.GM_openInTab.bind(windowRef);
      }
      if (GM_namespace?.openInTab) {
        return GM_namespace.openInTab.bind(GM_namespace);
      }
    }
    return null;
  })();

  if (GM_info_safe?.script?.version) {
    UPDATE_CONFIG.currentVersion = GM_info_safe.script.version;
  }

  /** @type {any} */
  const updateState = {
    lastCheck: 0,
    lastVersion: UPDATE_CONFIG.currentVersion,
    updateAvailable: false,
    checkInProgress: false,
    updateDetails: null,
  };

  const isVersionString = (/** @type {string} */ value) => {
    const text = String(value || '').trim();
    if (!text) return false;

    const parts = text.split('.');
    if (parts.length < 1 || parts.length > 3) return false;

    return parts.every(
      part => part.length > 0 && Array.from(part).every(ch => ch >= '0' && ch <= '9')
    );
  };

  const extractMetadataField = (/** @type {string} */ text, /** @type {string} */ field) => {
    const prefix = `@${field} `;
    const lines = String(text || '')
      .replace(/\r/g, '')
      .split('\n');

    for (const line of lines) {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith(prefix)) continue;
      return trimmed.slice(prefix.length).trim();
    }

    return '';
  };

  // Pluralization helper for time units (available to this module)
  /**
   * Get Russian plural form index
   * @param {number} num - Number to check
   * @returns {number} Form index (0, 1, or 2)
   */
  function getRussianPluralIndex(num) {
    const mod10 = num % 10;
    const mod100 = num % 100;

    if (mod10 === 1 && mod100 !== 11) return 0;
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 1;
    return 2;
  }

  /**
   * Get plural forms for a unit in Russian
   * @param {string} unit - Time unit
   * @returns {string[]} Array of forms
   */
  function getRussianForms(unit) {
    return (
      {
        day: ['день', 'дня', 'дней'],
        hour: ['час', 'часа', 'часов'],
        minute: ['минута', 'минуты', 'минут'],
      }[unit] || ['дней', 'дней', 'дней']
    );
  }

  /**
   * Get plural forms for a unit in English
   * @param {string} unit - Time unit
   * @returns {string[]} Array of forms
   */
  function getEnglishForms(unit) {
    return (
      {
        day: ['day', 'days'],
        hour: ['hour', 'hours'],
        minute: ['minute', 'minutes'],
      }[unit] || ['minutes', 'minutes']
    );
  }

  function pluralizeTime(/** @type {any} */ n, /** @type {any} */ unit) {
    const lang = getLanguage();
    const num = Math.abs(Number(n)) || 0;

    if (lang === 'ru') {
      const forms = getRussianForms(unit);
      const idx = getRussianPluralIndex(num);
      return `${num} ${forms[idx]}`;
    }

    // English (default)
    const enForms = getEnglishForms(unit);
    return `${num} ${num === 1 ? enForms[0] : enForms[1]}`;
  }

  // Optimized utilities
  /** @type {any} */
  const utils = {
    /**
     * Load update settings from localStorage with validation
     * @returns {void}
     */
    loadSettings: () => {
      try {
        const saved = localStorage.getItem(UPDATE_CONFIG.storageKey);
        if (!saved) {
          return;
        }

        const parsed = JSON.parse(saved);

        // Validate parsed object structure
        if (typeof parsed !== 'object' || parsed === null) {
          window.console.error('[YouTube+][Update]', 'Invalid settings structure');
          return;
        }

        // Validate individual properties with type checking
        if (typeof parsed.lastCheck === 'number' && parsed.lastCheck >= 0) {
          updateState.lastCheck = parsed.lastCheck;
        }

        // Accept version formats like '2.2' or '2.2.0' or 'v2.2.0'
        if (typeof parsed.lastVersion === 'string') {
          const ver = parsed.lastVersion.replace(/^v/i, '').trim();
          if (isVersionString(ver)) {
            updateState.lastVersion = ver;
          }
        }

        if (typeof parsed.updateAvailable === 'boolean') {
          updateState.updateAvailable = parsed.updateAvailable;
        }

        if (parsed.updateDetails && typeof parsed.updateDetails === 'object') {
          // Validate updateDetails properties
          if (
            typeof parsed.updateDetails.version === 'string' &&
            isVersionString(parsed.updateDetails.version)
          ) {
            updateState.updateDetails = parsed.updateDetails;
          }
        }
      } catch (e) {
        window.console.error('[YouTube+][Update]', 'Failed to load update settings:', e);
      }
    },

    /**
     * Save update settings to localStorage
     * @returns {void}
     */
    saveSettings: () => {
      try {
        const dataToSave = {
          lastCheck: updateState.lastCheck,
          lastVersion: updateState.lastVersion,
          updateAvailable: updateState.updateAvailable,
          updateDetails: updateState.updateDetails,
        };

        localStorage.setItem(UPDATE_CONFIG.storageKey, JSON.stringify(dataToSave));
      } catch (e) {
        window.console.error('[YouTube+][Update]', 'Failed to save update settings:', e);
      }
    },

    /**
     * Compare two version strings
     * @param {string} v1 - First version
     * @param {string} v2 - Second version
     * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
     */
    compareVersions: (v1, v2) => {
      // Validate version format
      if (typeof v1 !== 'string' || typeof v2 !== 'string') {
        window.console.error('[YouTube+][Update]', 'Invalid version format - must be strings');
        return 0;
      }

      const normalize = (/** @type {any} */ v) =>
        v
          .replace(/[^\d.]/g, '')
          .split('.')
          .map((/** @type {any} */ n) => parseInt(n, 10) || 0);
      const [parts1, parts2] = [normalize(v1), normalize(v2)];
      const maxLength = Math.max(parts1.length, parts2.length);

      for (let i = 0; i < maxLength; i++) {
        const diff = (parts1[i] || 0) - (parts2[i] || 0);
        if (diff !== 0) {
          return diff;
        }
      }
      return 0;
    },

    /**
     * Parse metadata from update script with validation
     * @param {string} text - Metadata text
     * @returns {any} Parsed metadata with version, description, downloadUrl
     */
    parseMetadata: (/** @type {any} */ text) => {
      // Normalize null/undefined/empty responses silently; only treat genuinely
      // unexpected payloads (non-string, oversized) as errors worth logging.
      if (text === null || text === undefined || text === '') {
        return { version: null, description: '', downloadUrl: UPDATE_CONFIG.autoInstallUrl };
      }
      if (typeof text !== 'string' || text.length > 100000) {
        window.console.warn('[YouTube+][Update]', 'Invalid metadata text');
        return { version: null, description: '', downloadUrl: UPDATE_CONFIG.autoInstallUrl };
      }

      let version = extractMetadataField(text, 'version');
      const description = extractMetadataField(text, 'description');
      const downloadUrl = extractMetadataField(text, 'downloadURL') || UPDATE_CONFIG.autoInstallUrl;

      // Validate extracted version
      if (version) {
        version = version.replace(/^v/i, '').trim();
        // Accept '2.2' or '2.2.0' or '2'
        if (!isVersionString(version)) {
          window.console.error(
            '[YouTube+][Update]',
            'Invalid version format in metadata:',
            version
          );
          return { version: null, description: '', downloadUrl: UPDATE_CONFIG.autoInstallUrl };
        }
      }

      return {
        version,
        description: description.substring(0, 500), // Limit description length
        downloadUrl,
      };
    },

    formatTimeAgo: (/** @type {any} */ timestamp) => {
      if (!timestamp) return t('never');
      const diffMs = Date.now() - timestamp;
      const diffDays = Math.floor(diffMs / 86400000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffMinutes = Math.floor(diffMs / 60000);

      if (diffDays > 0) return pluralizeTime(diffDays, 'day');
      if (diffHours > 0) return pluralizeTime(diffHours, 'hour');
      if (diffMinutes > 0) return pluralizeTime(diffMinutes, 'minute');
      return t('justNow');
    },

    showNotification: (
      /** @type {any} */ text,
      /** @type {any} */ type = 'info',
      /** @type {any} */ duration = 3000
    ) => {
      try {
        YouTubeUtils.NotificationManager.show(text, { type, duration });
      } catch (error) {
        window.YouTubeUtils &&
          /** @type {any} */ (YouTubeUtils).logger &&
          /** @type {any} */ (YouTubeUtils).logger.debug &&
          /** @type {any} */ (YouTubeUtils).logger.debug(
            `[YouTube+] ${type.toUpperCase()}:`,
            text,
            error
          );
      }
    },
  };
  /**
   * Validate update download URL for security
   * @param {string} downloadUrl - URL to validate
   * @returns {{valid: boolean, error: string|null}} Validation result
   */
  const validateDownloadUrl = (/** @type {any} */ downloadUrl) => {
    if (!downloadUrl || typeof downloadUrl !== 'string') {
      return { valid: false, error: 'Invalid download URL for installation' };
    }

    try {
      const parsedUrl = new URL(downloadUrl);
      const allowedDomains = ['update.greasyfork.org', 'greasyfork.org'];

      if (parsedUrl.protocol !== 'https:') {
        return { valid: false, error: 'Only HTTPS URLs allowed for updates' };
      }

      if (!allowedDomains.includes(parsedUrl.hostname)) {
        return { valid: false, error: `Update URL domain not in allowlist: ${parsedUrl.hostname}` };
      }

      return { valid: true, error: null };
    } catch (error) {
      return { valid: false, error: `Invalid URL format: ${/** @type {any} */ (error).message}` };
    }
  };

  /**
   * Mark update as dismissed in session storage
   * @param {Object} details - Update details
   */
  const markUpdateDismissed = (/** @type {any} */ details) => {
    if (details?.version && typeof details.version === 'string') {
      try {
        sessionStorage.setItem('update_dismissed', details.version);
      } catch (err) {
        window.console.error('[YouTube+][Update]', 'Failed to persist dismissal state:', err);
      }
    }
  };

  /**
   * Try different methods to open update URL
   * @param {string} url - URL to open
   * @returns {boolean} Success status
   */
  const tryOpenUpdateUrl = (/** @type {any} */ url) => {
    // Method 1: GM_openInTab
    if (GM_openInTab_safe) {
      try {
        GM_openInTab_safe(url, { active: true, insert: true, setParent: true });
        return true;
      } catch (gmError) {
        window.console.error('[YouTube+] GM_openInTab update install failed:', gmError);
      }
    }

    // Method 2: window.open
    try {
      const popup = window.open(url, '_blank', 'noopener');
      if (popup) return true;
    } catch (popupError) {
      window.console.error('[YouTube+] window.open update install failed:', popupError);
    }

    // Method 3: Navigate
    try {
      window.location.assign(url);
      return true;
    } catch (navigationError) {
      window.console.error('[YouTube+] Navigation to update URL failed:', navigationError);
    }

    return false;
  };

  /**
   * Install update with URL validation
   * @param {Object} details - Update details containing downloadUrl and version
   * @returns {boolean} True if installation initiated successfully
   */
  const installUpdate = (/** @type {any} */ details = updateState.updateDetails) => {
    const downloadUrl = details?.downloadUrl || UPDATE_CONFIG.autoInstallUrl;

    // Validate URL
    const validation = validateDownloadUrl(downloadUrl);
    if (!validation.valid) {
      window.console.error('[YouTube+][Update]', validation.error);
      return false;
    }

    // Try to open URL
    const success = tryOpenUpdateUrl(downloadUrl);
    if (success) {
      markUpdateDismissed(details);
    }

    return success;
  };

  // Enhanced update notification
  const showUpdateNotification = (/** @type {any} */ updateDetails) => {
    // Optionally render notification icon (can be disabled via config)
    const iconHtml = UPDATE_CONFIG.showNotificationIcon
      ? `<div style="background: var(--yt-glass-bg);
                        border-radius: var(--yt-radius-xs); padding: 10px; flex-shrink: 0; border: 1px solid var(--yt-glass-border);
                        backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur);">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12c0 1-1 2-1 2s-1-1-1-2 1-2 1-2 1 1 1 2z"/>
              <path d="m21 12-5-5v3H8v4h8v3l5-5z"/>
            </svg>
          </div>`
      : '';
    const notification = document.createElement('div');
    notification.className = 'youtube-enhancer-notification update-notification';
    notification.setAttribute('role', 'alertdialog');
    notification.setAttribute('aria-label', t('updateAvailableTitle') || 'Update available');
    // Use centralized notification container for consistent placement. Keep visual styles but remove fixed positioning.
    /** @type {any} */ (notification).style.cssText = `
      z-index: 10001; max-width: 360px;
      background: var(--yt-notification-bg); padding: 16px 18px; border-radius: var(--yt-radius-lg);
      color: var(--yt-text-primary);
      box-shadow: var(--yt-shadow);
      border: 1px solid var(--yt-glass-border);
      -webkit-backdrop-filter: var(--yt-glass-blur);
      backdrop-filter: var(--yt-glass-blur);
      animation: slideInFromBottom 0.4s ease-out;
    `;

    renderTemplateClone(
      notification,
      `
        <div style="position: relative; display: flex; align-items: flex-start; gap: 12px;">
            ${iconHtml}
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px;">${t('updateAvailableTitle')}</div>
            <div style="font-size: 13px; opacity: 0.9; margin-bottom: 8px;">
              ${t('version')} ${updateDetails.version}
            </div>
            ${
              updateDetails.changelog || updateDetails.description
                ? (function () {
                    const header = t('changelogHeader');

                    // Prefer fetched changelog, fall back to metadata description
                    const raw =
                      updateDetails.changelog && updateDetails.changelog.length > 0
                        ? updateDetails.changelog
                        : updateDetails.description || '';

                    // Sanitize and normalize incoming text: convert HTML breaks to newlines,
                    // strip tags and decode a few common entities.
                    const sanitize = (/** @type {any} */ s) =>
                      String(s)
                        .replace(/<br\s*\/?>/gi, '\n')
                        .replace(/<\/p>/gi, '\n')
                        .replace(/<[^>]*>?/g, '') // strip complete AND incomplete HTML tags
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#039;/g, "'")
                        .trim();

                    const text = sanitize(raw);

                    // Split into non-empty lines and render each as its own block so wrapping works.
                    const lines = text
                      .split(/\n+/)
                      .map(l => l.trim())
                      .filter(Boolean);
                    const listHtml = lines
                      .map(
                        l =>
                          `<div style="font-size:12px; opacity:0.85; margin-bottom:6px;">${l}</div>`
                      )
                      .join('');

                    return (
                      `<div style="font-size:12px; font-weight:600; opacity:0.95; margin-bottom:6px;">${header}</div>` +
                      `<div style="font-size:12px; line-height:1.4; max-height:120px; overflow-y:auto; padding:8px; background: var(--yt-overlay-deep); border-radius:6px; border:1px solid var(--yt-surface-overlay-border); white-space:normal;">${listHtml}</div>`
                    );
                  })()
                : `<div style="font-size: 12px); opacity: 0.85; margin-bottom: 12px;">${t('newFeatures')}</div>`
            }
            <div style="display: flex; gap: 8px;">
              <button id="update-install-btn" type="button" style="
                background: var(--yt-accent); color: white; border: none;
                padding: 8px 16px; border-radius: var(--yt-radius-xs); cursor: pointer;
                font-size: 13px; font-weight: 700; transition: transform 0.15s ease;
                box-shadow: 0 6px 18px var(--yt-danger-ghost);
                backdrop-filter: var(--yt-glass-blur);
              ">${t('installUpdate')}</button>
              <button id="update-dismiss-btn" type="button" style="
                background: var(--yt-button-bg); color: var(--yt-text-primary);
                border: 1px solid var(--yt-glass-border); padding: 8px 12px;
                border-radius: var(--yt-radius-xs); cursor: pointer; font-size: 13px; transition: all 0.12s ease;
              ">${t('later')}</button>
            </div>
          </div>
          <button id="update-close-btn" aria-label="${t('dismiss')}" style="
            position: absolute; top: -8px; right: -8px; width: 28px; height: 28px;
            border-radius: 50%; border: none; cursor: pointer; display: flex;
            align-items: center; justify-content: center; font-size: 16px; line-height: 1;
            background: var(--yt-button-bg); color: var(--yt-text-primary); transition: background 0.18s ease;
            border: 1px solid var(--yt-glass-border);
          ">&times;</button>
        </div>
        <style>${window.YouTubePlusStyleResources?.update || ''}</style>
      `
    );

    // Append into centralized notification container (created if missing)
    const _containerId = 'youtube-enhancer-notification-container';
    let _container = byId(_containerId);
    if (!_container) {
      _container = document.createElement('div');
      _container.id = _containerId;
      _container.className = 'youtube-enhancer-notification-container';
      try {
        document.body.appendChild(_container);
      } catch (e) {
        document.body.appendChild(notification);
      }
    }
    try {
      _container.insertBefore(notification, _container.firstChild);
    } catch (e) {
      document.body.appendChild(notification);
    }

    const removeNotification = () => {
      // use explicit slide-out animation so it exits downward like the entry
      /** @type {any} */ (notification).style.animation = 'slideOutToBottom 0.35s ease-in forwards';
      setTimeout_(() => notification.remove(), 360);
    };

    // Event handlers
    const installBtn = notification.querySelector('#update-install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', () => {
        const success = installUpdate(updateDetails);
        if (success) {
          removeNotification();
          setTimeout_(() => utils.showNotification(t('installing')), 500);
        } else {
          utils.showNotification(t('manualInstallHint'), 'error', 5000);
          window.open('https://greasyfork.org/en/scripts/537017-youtube', '_blank');
        }
      });
    }

    const dismissBtn = notification.querySelector('#update-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        if (updateDetails?.version) {
          sessionStorage.setItem('update_dismissed', updateDetails.version);
        }
        removeNotification();
      });
    }

    const closeBtn = notification.querySelector('#update-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (updateDetails?.version) {
          sessionStorage.setItem('update_dismissed', updateDetails.version);
        }
        removeNotification();
      });
    }

    // Auto-dismiss
    setTimeout_(() => {
      if (notification.isConnected) removeNotification();
    }, UPDATE_CONFIG.notificationDuration);
  };

  /**
   * Validate update URL
   * @param {string} url - URL to validate
   * @throws {Error} If URL is invalid
   */
  const validateUpdateUrl = (/** @type {any} */ url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Update URL must use HTTPS');
    }
    if (!parsedUrl.hostname.includes('greasyfork.org')) {
      throw new Error('Update URL must be from greasyfork.org');
    }
  };

  /**
   * Fetch update metadata with timeout protection. Accepts a URL so callers can
   * request alternate endpoints (for example the .user.js auto-install URL) as a
   * fallback when the primary metadata does not include a usable version.
   * @param {string} [url=UPDATE_CONFIG.updateUrl] - URL to fetch metadata from
   * @returns {Promise<string>} Metadata text
   */
  const fetchUpdateMetadata = async (url = UPDATE_CONFIG.updateUrl) => {
    // Use GM_xmlhttpRequest if available to avoid CORS issues.
    const fetchMeta = async (/** @type {any} */ requestUrl) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout_(() => reject(new Error('Update check timeout')), 10000);
          GM_xmlhttpRequest({
            method: 'GET',
            url: requestUrl,
            timeout: 10000,
            headers: { Accept: 'text/plain', 'User-Agent': 'YouTube+ UpdateChecker' },
            onload: (/** @type {any} */ response) => {
              clearTimeout(timeoutId);
              if (response.status >= 200 && response.status < 300) resolve(response.responseText);
              else reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
            },
            onerror: (/** @type {any} */ e) => {
              clearTimeout(timeoutId);
              reject(new Error(`Network error: ${e}`));
            },
            ontimeout: () => {
              clearTimeout(timeoutId);
              reject(new Error('Update check timeout'));
            },
          });
        });
      }

      // Fallback to fetch with AbortController timeout
      const controller = new AbortController();
      const timeoutId = setTimeout_(() => controller.abort(), 10000);
      try {
        const res = await fetch(requestUrl, {
          method: 'GET',
          cache: 'no-cache',
          signal: controller.signal,
          headers: { Accept: 'text/plain', 'User-Agent': 'YouTube+ UpdateChecker' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return await res.text();
      } finally {
        clearTimeout(timeoutId);
      }
    };

    return fetchMeta(url);
  };

  /**
   * Handle update availability check results
   * @param {Object} updateDetails - Update details object
   * @param {boolean} force - Whether check was forced
   */
  const handleUpdateResult = (/** @type {any} */ updateDetails, /** @type {any} */ force) => {
    const shouldShowNotification =
      updateState.updateAvailable &&
      (force || sessionStorage.getItem('update_dismissed') !== updateDetails.version);

    if (shouldShowNotification) {
      showUpdateNotification(updateDetails);
      window.YouTubeUtils &&
        /** @type {any} */ (YouTubeUtils).logger &&
        /** @type {any} */ (YouTubeUtils).logger.debug &&
        /** @type {any} */ (YouTubeUtils).logger.debug(
          `YouTube + Update available: ${updateDetails.version}`
        );
      return;
    }

    if (force) {
      const message = updateState.updateAvailable
        ? t('updateAvailableMsg').replace('{version}', updateDetails.version)
        : t('upToDateMsg').replace('{version}', UPDATE_CONFIG.currentVersion);
      utils.showNotification(message);
    }
  };

  /**
   * Determine if error is transient and retryable
   * @param {Error} error - Error object
   * @returns {boolean} True if error is transient
   */
  const isTransientError = (/** @type {any} */ error) => {
    return !!(
      error.name === 'AbortError' ||
      error.name === 'NetworkError' ||
      (error.message && error.message.includes('fetch')) ||
      (error.message && error.message.includes('network'))
    );
  };

  /**
   * Fetch changelog for a specific version from GreasyFork
   * @param {string} version - Version to fetch changelog for
   * @returns {Promise<string>} Changelog text
   */
  const fetchChangelog = async (/** @type {any} */ version) => {
    try {
      const lang = getLanguage();
      const url = `https://greasyfork.org/${lang}/scripts/537017-youtube/versions`;

      const fetchPage = async (/** @type {any} */ requestUrl) => {
        if (typeof GM_xmlhttpRequest !== 'undefined') {
          return new Promise((resolve, reject) => {
            const timeoutId = setTimeout_(
              () => reject(new Error('Changelog fetch timeout')),
              10000
            );
            GM_xmlhttpRequest({
              method: 'GET',
              url: requestUrl,
              timeout: 10000,
              headers: { Accept: 'text/html' },
              onload: (/** @type {any} */ response) => {
                clearTimeout(timeoutId);
                if (response.status >= 200 && response.status < 300) resolve(response.responseText);
                else reject(new Error(`HTTP ${response.status}`));
              },
              onerror: (/** @type {any} */ _e) => {
                clearTimeout(timeoutId);
                reject(new Error('Network error'));
              },
              ontimeout: () => {
                clearTimeout(timeoutId);
                reject(new Error('Timeout'));
              },
            });
          });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout_(() => controller.abort(), 10000);
        try {
          const res = await fetch(requestUrl, {
            method: 'GET',
            cache: 'no-cache',
            signal: controller.signal,
            headers: { Accept: 'text/html' },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.text();
        } finally {
          clearTimeout(timeoutId);
        }
      };

      const html = await fetchPage(url);

      // Parse changelog from HTML
      // Look for version link followed by changelog span
      // Structure: <a ...>v2.4.5</a> ... <span class="version-changelog">...</span>
      const domParser = typeof window.DOMParser === 'function' ? new window.DOMParser() : null;
      if (domParser) {
        try {
          const doc = domParser.parseFromString(html, 'text/html');
          const versionText = String(version || '').trim();
          const anchors = Array.from(doc.querySelectorAll('a'));
          const matchingLink = anchors.find(anchor => {
            const linkText = String(anchor.textContent || '').trim();
            return (
              linkText === versionText ||
              linkText === `v${versionText}` ||
              linkText.includes(versionText)
            );
          });

          const container =
            matchingLink?.closest('li, article, section, div') ||
            matchingLink?.parentElement ||
            null;
          const changelogNode =
            container?.querySelector('.version-changelog') ||
            (matchingLink?.nextElementSibling?.matches?.('.version-changelog')
              ? matchingLink.nextElementSibling
              : null);

          const changelogText = String(changelogNode?.textContent || '').trim();
          if (changelogText) {
            return changelogText
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0)
              .join('\n');
          }
        } catch (e) {
          /* fall through to empty result */
        }
      }

      return '';
    } catch (error) {
      window.console.warn(
        '[YouTube+][Update] Failed to fetch changelog:',
        /** @type {any} */ (error).message
      );
      return '';
    }
  };

  /**
   * Retrieve update details trying primary metadata endpoint first and
   * falling back to the auto-install .user.js URL when necessary.
   * @returns {Promise<any>} Parsed updateDetails object
   */
  const retrieveUpdateDetails = async () => {
    // Attempt primary metadata fetch
    let metaText = await fetchUpdateMetadata(UPDATE_CONFIG.updateUrl);
    let details = utils.parseMetadata(metaText);

    if (!details.version) {
      try {
        const fallbackText = await fetchUpdateMetadata(UPDATE_CONFIG.autoInstallUrl);
        const fallbackDetails = utils.parseMetadata(fallbackText);
        if (fallbackDetails.version) {
          details = fallbackDetails;
          metaText = fallbackText;
        }
      } catch (fallbackErr) {
        if (typeof console !== 'undefined' && window.console.warn) {
          window.console.warn(
            '[YouTube+][Update] Fallback metadata fetch failed:',
            /** @type {any} */ (fallbackErr).message
          );
        }
      }
    }

    // Fetch changelog from GreasyFork versions page and store separately
    if (details.version) {
      try {
        const changelog = await fetchChangelog(details.version);
        // Keep original metadata description but expose fetched changelog on a separate property
        details.changelog = typeof changelog === 'string' && changelog.length > 0 ? changelog : '';
      } catch (changelogErr) {
        window.console.warn(
          '[YouTube+][Update] Failed to fetch changelog:',
          /** @type {any} */ (changelogErr).message
        );
        details.changelog = '';
      }
    } else {
      details.changelog = '';
    }

    return details;
  };

  /**
   * Check for updates with URL validation, timeout protection, and retry logic
   * @param {boolean} force - Force update check even if recently checked
   * @param {number} retryCount - Current retry attempt (for internal use)
   * @returns {Promise<void>}
   */
  /**
   * Check if update check should proceed
   * @param {boolean} force - Force update check
   * @returns {boolean} True if should proceed
   */
  const shouldCheckForUpdates = (/** @type {any} */ force, /** @type {any} */ now) => {
    if (!UPDATE_CONFIG.enabled || updateState.checkInProgress) {
      return false;
    }
    return force || now - updateState.lastCheck >= UPDATE_CONFIG.checkInterval;
  };

  /**
   * Validate update configuration
   * @returns {boolean} True if valid
   * @throws {Error} If configuration is invalid
   */
  const validateUpdateConfiguration = () => {
    try {
      validateUpdateUrl(UPDATE_CONFIG.updateUrl);
      return true;
    } catch (urlError) {
      window.console.error('[YouTube+][Update]', 'Invalid update URL configuration:', urlError);
      throw urlError;
    }
  };

  /**
   * Process successful update details
   * @param {Object} updateDetails - Update details
   * @param {boolean} force - Force flag
   * @param {number} now - Current timestamp
   * @returns {void}
   */
  const processUpdateDetails = (
    /** @type {any} */ updateDetails,
    /** @type {any} */ force,
    /** @type {any} */ now
  ) => {
    updateState.lastCheck = now;
    updateState.lastVersion = updateDetails.version;
    updateState.updateDetails = updateDetails;

    const comparison = utils.compareVersions(UPDATE_CONFIG.currentVersion, updateDetails.version);
    updateState.updateAvailable = comparison < 0;

    handleUpdateResult(updateDetails, force);
    utils.saveSettings();

    // Auto-install if configured and update wasn't dismissed
    if (updateState.updateAvailable && UPDATE_CONFIG.autoInstallOnCheck) {
      try {
        const dismissed = sessionStorage.getItem('update_dismissed');
        if (dismissed !== updateDetails.version) {
          const started = installUpdate(updateDetails);
          if (started) {
            // Persist that we've acted on this update so we don't keep reopening it
            markUpdateDismissed(updateDetails);
            try {
              utils.showNotification(t('installing'));
            } catch (e) {
              // Non-critical, suppressed
            }
          } else {
            window.console.warn(
              '[YouTube+][Update] Auto-install could not be initiated for',
              updateDetails.downloadUrl
            );
          }
        }
      } catch (e) {
        window.console.error('[YouTube+][Update] Auto-installation failed:', e);
      }
    }
  };

  /**
   * Handle missing update information
   * @param {boolean} force - Force flag
   * @returns {void}
   */
  const handleMissingUpdateInfo = (/** @type {any} */ force) => {
    updateState.updateAvailable = false;
    if (force) {
      utils.showNotification(
        t('updateCheckFailed').replace('{msg}', t('noUpdateInfo')),
        'error',
        4000
      );
    }
  };

  /**
   * Handle retry logic for update check
   * @param {Error} error - Error object
   * @param {boolean} force - Force flag
   * @param {number} retryCount - Current retry count
   * @returns {Promise<void>}
   */
  const handleUpdateRetry = async (
    /** @type {any} */ error,
    /** @type {any} */ force,
    /** @type {any} */ retryCount
  ) => {
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 2000;

    if (isTransientError(error) && retryCount < MAX_RETRIES) {
      window.console.warn(
        `[YouTube+][Update] Retry ${retryCount + 1}/${MAX_RETRIES} after error:`,
        error.message
      );
      await new Promise(resolve => setTimeout_(resolve, RETRY_DELAY * Math.pow(2, retryCount)));
      return checkForUpdates(force, retryCount + 1);
    }

    window.console.error('[YouTube+][Update] Check failed after retries:', error);
    if (force) {
      utils.showNotification(t('updateCheckFailed').replace('{msg}', error.message), 'error', 4000);
    }
  };

  /**
   * Check for available updates
   * @param {boolean} force - Force update check
   * @param {number} retryCount - Retry count
   * @returns {Promise<void>}
   */
  const checkForUpdates = async (force = false, retryCount = 0) => {
    const now = Date.now();

    if (!shouldCheckForUpdates(force, now)) {
      return;
    }

    updateState.checkInProgress = true;

    try {
      validateUpdateConfiguration();
      const updateDetails = await retrieveUpdateDetails();

      if (updateDetails.version) {
        processUpdateDetails(updateDetails, force, now);
      } else {
        handleMissingUpdateInfo(force);
      }
    } catch (error) {
      await handleUpdateRetry(error, force, retryCount);
    } finally {
      updateState.checkInProgress = false;
    }
  };

  // Optimized settings UI
  const addUpdateSettings = () => {
    const aboutSection = YouTubeUtils.querySelector(
      '.ytp-plus-settings-section[data-section="about"]'
    );
    if (!aboutSection || YouTubeUtils.querySelector('.update-settings-container')) return;

    const updateContainer = document.createElement('div');
    updateContainer.className = 'update-settings-container';
    /** @type {any} */ (updateContainer).style.cssText = `
        padding: 16px; margin-top: 20px; border-radius: 12px;
        background: var(--yt-surface-overlay-subtle); border: 1px solid var(--yt-surface-overlay-border);
        -webkit-backdrop-filter: blur(10px) saturate(120%);
        backdrop-filter: blur(10px) saturate(120%);
        box-shadow: 0 6px 20px var(--yt-update-card-shadow);
      `;

    const lastCheckTime = utils.formatTimeAgo(updateState.lastCheck);

    renderTemplateClone(
      updateContainer,
      `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--yt-spec-text-primary);">
            ${t('enhancedExperience')}
          </h3>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; 
                    padding: 16px; background: var(--yt-surface-overlay-subtle); border-radius: 10px; margin-bottom: 16px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 14px; font-weight: 600; color: var(--yt-spec-text-primary);">${t('currentVersion')}</span>
              <span style="font-size: 13px; font-weight: 600; color: var(--yt-spec-text-primary); 
                           padding: 3px 10px; background: var(--yt-surface-overlay-soft); border-radius: 12px; 
                           border: 1px solid var(--yt-glass-border);">${UPDATE_CONFIG.currentVersion}</span>
            </div>
            <div style="font-size: 12px; color: var(--yt-spec-text-secondary);">
              ${t('lastChecked')}: <span style="font-weight: 500;">${lastCheckTime}</span>
              ${
                updateState.lastVersion && updateState.lastVersion !== UPDATE_CONFIG.currentVersion
                  ? `<br>${t('latestAvailable')}: <span style="color: var(--yt-update-available-text); font-weight: 600;">${updateState.lastVersion}</span>`
                  : ''
              }
            </div>
          </div>
          
          ${
            updateState.updateAvailable
              ? `
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; 
                          background: linear-gradient(135deg, var(--yt-danger-soft), var(--yt-danger-border)); 
                          border: 1px solid var(--yt-danger-card-border); border-radius: 20px;">
                <div style="width: 6px; height: 6px; background: var(--yt-update-available-dot); border-radius: 50%; animation: pulse 2s infinite;"></div>
                <span style="font-size: 11px; color: var(--yt-update-available-text); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  ${t('updateAvailable')}
                </span>
              </div>
              <button id="install-update-btn" style="background: linear-gradient(135deg, var(--yt-update-install-bg-start), var(--yt-update-install-bg-end)); 
                      color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; 
                      font-size: 12px; font-weight: 600; transition: all 0.3s ease; 
                      box-shadow: 0 4px 12px var(--yt-update-install-shadow);">${t('installUpdate')}</button>
            </div>
          `
              : `
            <div style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; 
                        background: linear-gradient(135deg, var(--yt-success-soft), var(--yt-success-soft-hover)); 
                        border: 1px solid var(--yt-success-accent-soft); border-radius: 20px;">
              <div style="width: 6px; height: 6px; background: var(--yt-success-accent); border-radius: 50%;"></div>
              <span style="font-size: 11px; color: var(--yt-success-accent); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                ${t('upToDate')}
              </span>
            </div>
          `
          }
        </div>
        
        <div style="display: flex; gap: 12px;">
          <button class="ytp-plus-button ytp-plus-button-primary" id="manual-update-check" 
                  style="flex: 1; padding: 12px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; flex-shrink: 0;">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M19.13 11.48A10 10 0 0 0 12 2C6.48 2 2 6.48 2 12c0 .34.02.67.05 1M4.87 12.52A10 10 0 0 0 12 22c5.52 0 10-4.48 10-10 0-.34-.02-.67-.05-1"/>
            </svg>
            ${t('checkForUpdates')}
          </button>
          <button class="ytp-plus-button" id="open-update-page" style="padding: 12px 16px; font-size: 13px; background: var(--yt-button-bg); border: 1px solid var(--yt-glass-border);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15,3 21,3 21,9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
        </div>

        <style>${window.YouTubePlusStyleResources?.update || ''}</style>
      `
    );

    aboutSection.appendChild(updateContainer);

    // Keep custom About actions/footer below update card.
    try {
      const aboutActions = aboutSection.querySelector('.ytp-plus-about-actions');
      const aboutFooter = aboutSection.querySelector('.ytp-plus-about-footer');
      if (aboutActions) aboutSection.appendChild(aboutActions);
      if (aboutFooter) aboutSection.appendChild(aboutFooter);
    } catch (e) {
      // Non-critical, suppressed
    }

    // Event listeners with optimization
    const attachClickHandler = (/** @type {any} */ id, /** @type {any} */ handler) => {
      const element = byId(id);
      if (element) YouTubeUtils.cleanupManager.registerListener(element, 'click', handler);
    };

    // Destructure event parameter to prefer destructuring
    attachClickHandler('manual-update-check', async (/** @type {any} */ evt) => {
      const button =
        evt.currentTarget instanceof HTMLElement
          ? evt.currentTarget
          : evt.target instanceof Element
            ? /** @type {HTMLElement|null} */ (evt.target.closest('#manual-update-check'))
            : null;
      if (!button) return;
      setManualCheckButtonContent(button, t('checkingForUpdates'), true);
      button.disabled = true;

      await checkForUpdates(true);

      setTimeout_(() => {
        setManualCheckButtonContent(button, t('checkForUpdates'), false);
        button.disabled = false;
      }, 1000);
    });

    attachClickHandler('install-update-btn', () => {
      const success = installUpdate();
      if (success) {
        utils.showNotification(t('installing'));
      } else {
        utils.showNotification(t('manualInstallHint'), 'error', 5000);
        window.open('https://greasyfork.org/en/scripts/537017-youtube', '_blank');
      }
    });

    attachClickHandler('open-update-page', () => {
      utils.showNotification(t('updatePageFallback'));
      window.open('https://greasyfork.org/en/scripts/537017-youtube', '_blank');
    });
  };

  // Optimized initialization
  /**
   * Setup initial and periodic update checks
   * @returns {void}
   */
  const setupUpdateChecks = () => {
    // Initial check with delay
    setTimeout_(() => checkForUpdates(), 3000);

    const globalObject = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);
    const previousIntervalId = globalObject.__ytpUpdateCheckIntervalId;
    if (previousIntervalId) {
      clearInterval(previousIntervalId);
      if (YouTubeUtils.cleanupManager?.unregisterInterval) {
        YouTubeUtils.cleanupManager.unregisterInterval(previousIntervalId);
      }
    }

    // Periodic checks - register interval in cleanupManager
    const intervalId = setInterval(() => checkForUpdates(), UPDATE_CONFIG.checkInterval);
    globalObject.__ytpUpdateCheckIntervalId = intervalId;
    YouTubeUtils.cleanupManager.registerInterval(intervalId);
    if (YouTubeUtils.cleanupManager?.registerListener) {
      YouTubeUtils.cleanupManager.registerListener(window, 'beforeunload', () =>
        clearInterval(intervalId)
      );
    } else {
      window.addEventListener('beforeunload', () => clearInterval(intervalId));
    }
  };

  /**
   * Setup settings modal event listener
   * @returns {void}
   */
  const setupSettingsObserver = () => {
    const handler = () => {
      setTimeout_(addUpdateSettings, 100);
    };
    if (YouTubeUtils.cleanupManager?.registerListener) {
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'youtube-plus-settings-modal-opened',
        handler
      );
    } else {
      document.addEventListener('youtube-plus-settings-modal-opened', handler);
    }
  };

  /**
   * Setup click handler for about section
   * @returns {void}
   */
  const setupAboutClickHandler = () => {
    const clickHandler = (/** @type {any} */ evt) => {
      const el = /** @type {HTMLElement} */ (/** @type {any} */ (evt).target);
      if (el.classList?.contains('ytp-plus-settings-nav-item') && el.dataset?.section === 'about') {
        setTimeout_(addUpdateSettings, 50);
      }
    };

    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, {
      passive: true,
      capture: true,
    });
  };

  /**
   * Log initialization status
   * @returns {void}
   */
  const logInitialization = () => {
    try {
      if (
        window.YouTubeUtils &&
        /** @type {any} */ (YouTubeUtils).logger &&
        /** @type {any} */ (YouTubeUtils).logger.debug
      ) {
        /** @type {any} */ (YouTubeUtils).logger.debug('YouTube + Update Checker initialized', {
          version: UPDATE_CONFIG.currentVersion,
          enabled: UPDATE_CONFIG.enabled,
          lastCheck: new Date(updateState.lastCheck).toLocaleString(),
          updateAvailable: updateState.updateAvailable,
        });
      }
    } catch (e) {
      // Non-critical, suppressed
    }
  };

  /**
   * Initialize update checker (runs only once)
   * @returns {void}
   */
  let _initDone = false;
  const init = () => {
    if (_initDone) return;
    _initDone = true;
    utils.loadSettings();
    setupUpdateChecks();
    setupSettingsObserver();
    setupAboutClickHandler();
    logInitialization();
  };

  const isUpdateRelevantRoute = () => {
    const path = location.pathname || '';
    if (location.hostname === 'music.youtube.com') return true;
    return path === '/watch' || path.startsWith('/shorts');
  };

  const isSettingsModalOpen = () => {
    try {
      return Boolean(document.querySelector('.ytp-plus-settings-modal'));
    } catch (e) {
      return false;
    }
  };

  const startUpdateRuntime = () => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  };

  if (window.YouTubePlusLazyLoader?.register) {
    window.YouTubePlusLazyLoader.register('update', startUpdateRuntime, {
      priority: 20,
      delay: 0,
      shouldLoad: () => isUpdateRelevantRoute() || isSettingsModalOpen(),
    });
  } else {
    startUpdateRuntime();
  }
})();
