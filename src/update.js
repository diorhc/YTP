// Update Checker: LazyLoader registered as 'update'.
//
// Responsibility: check for new YTP releases on GitHub, display a
//   notification banner, and manage the dismiss/snooze state.
// Public surface: window.YouTubePlusUpdate.
(function () {
  const setTimeout_ = setTimeout.bind(window);

  /**
   * @typedef {Object} UpdateConfig
   * @property {boolean} enabled
   * @property {number} checkInterval
   * @property {string} updateUrl
   * @property {string} currentVersion
   * @property {string} storageKey
   * @property {number} notificationDuration
   * @property {string} autoInstallUrl
   * @property {boolean} autoInstallOnCheck
   * @property {boolean} showNotificationIcon
   */

  /**
   * @typedef {Object} UpdateDetails
   * @property {string | null} version
   * @property {string} description
   * @property {string} downloadUrl
   * @property {string} [changelog]
   */

  /**
   * @typedef {Object} UpdateState
   * @property {number} lastCheck
   * @property {string} lastVersion
   * @property {boolean} updateAvailable
   * @property {boolean} checkInProgress
   * @property {UpdateDetails | null} updateDetails
   */

  /**
   * @param {string} id
   * @param {string} css
   */
  const injectStyles = (id, css) => {
    const SM = window.YouTubeUtils?.StyleManager;
    if (SM && typeof SM.add === 'function') {
      SM.add(id, css);
      return;
    }
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
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
  const t = window.YouTubeUtils?.t || ((/** @type {string} */ key) => key || '');
  const updateLogger = window.YouTubeUtils?.logger || null;
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'Update');

  const byId = window.YouTubeUtils.byId;

  // Language helper delegating to global i18n when available
  const getLanguage = () => window.YouTubeUtils.getLanguage();

  /** @type {UpdateConfig} */
  const UPDATE_CONFIG = {
    enabled: true,
    checkInterval: 24 * 60 * 60 * 1000, // 24 hours
    updateUrl: 'https://update.greasyfork.org/scripts/537017/YouTube%20%2B.meta.js',
    // From the userscript metadata (GM_info), never a hardcoded literal.
    currentVersion: U?.getScriptVersion?.() ?? 'dev',
    storageKey: 'ytp_update_check_v1',
    notificationDuration: 8000,
    autoInstallUrl: 'https://update.greasyfork.org/scripts/537017/YouTube%20%2B.user.js',
    // If true, automatically initiate installation when an update is found. This
    // opens the install URL (GM_openInTab / window.open / navigation); default off.
    autoInstallOnCheck: false,
    // When false, hide the small SVG icon shown at the left of update notifications
    // Set to `true` to show the icon again.
    showNotificationIcon: false,
  };

  /** The pre-standalone-key name of the update-check payload. */
  const LEGACY_UPDATE_STORAGE_KEY = 'youtube_plus_update_check';

  /**
   * Read the stored update payload, migrating the legacy localStorage key once.
   * @returns {string|null}
   */
  const readUpdateSettingsRaw_ = () => {
    const current = window.YouTubePlusSettingsStore?.readGmKey?.(UPDATE_CONFIG.storageKey) ?? null;
    if (current) return current;
    const legacy = U?.storage?.getItem?.(LEGACY_UPDATE_STORAGE_KEY) ?? null;
    if (!legacy) return null;
    window.YouTubePlusSettingsStore?.writeGmKey?.(UPDATE_CONFIG.storageKey, legacy);
    return legacy;
  };

  const windowRef = typeof window === 'undefined' ? null : window;
  const GM_namespace = windowRef?.GM || null;
  const GM_openInTab_safe = (() => {
    if (windowRef) {
      if (typeof windowRef.GM_openInTab === 'function') {
        return windowRef.GM_openInTab.bind(windowRef);
      }
      if (GM_namespace?.openInTab) {
        return /** @type {(url: string, options?: { active?: boolean; insert?: boolean; setParent?: boolean }) => unknown} */ (
          GM_namespace.openInTab
        ).bind(GM_namespace);
      }
    }
    return null;
  })();

  /** @type {UpdateState} */
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
      const trimmed = line
        .trimStart()
        .replace(/^\/\/\s*/, '')
        .replace(/^\/\*\s*/, '');
      if (!trimmed.startsWith(prefix)) continue;
      return trimmed.slice(prefix.length).trim();
    }

    return '';
  };

  function pluralizeTime(/** @type {number} */ n, /** @type {'day' | 'hour' | 'minute'} */ unit) {
    const num = Math.abs(Number(n)) || 0;
    if (unit === 'day') return t('daysAgo', { n: num });
    if (unit === 'hour') return t('hoursAgo', { n: num });
    return t('minutesAgo', { n: num });
  }

  // Optimized utilities
  const utils = {
    /**
     * Load update settings from storage with validation
     * @returns {void}
     */
    loadSettings: () => {
      try {
        const saved = readUpdateSettingsRaw_();
        if (!saved) return;

        const parsed = JSON.parse(saved);

        // Validate parsed object structure
        if (typeof parsed !== 'object' || parsed === null) {
          updateLogger?.error?.('Update', 'Invalid settings structure');
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
        logS(e);
        updateLogger?.error?.('Update', 'Failed to load update settings', e);
      }
    },

    /**
     * Save update settings to storage
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

        window.YouTubePlusSettingsStore?.writeGmKey?.(
          UPDATE_CONFIG.storageKey,
          JSON.stringify(dataToSave)
        );
      } catch (e) {
        logS(e);
        updateLogger?.error?.('Update', 'Failed to save update settings', e);
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
        updateLogger?.error?.('Update', 'Invalid version format - must be strings');
        return 0;
      }

      const normalize = (/** @type {string} */ v) =>
        v
          .replace(/[^\d.]/g, '')
          .split('.')
          .map(n => parseInt(n, 10) || 0);
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
     * @param {unknown} text - Metadata text
     * @returns {UpdateDetails} Parsed metadata with version, description, downloadUrl
     */
    parseMetadata: (/** @type {unknown} */ text) => {
      // Normalize null/undefined/empty responses silently; only treat genuinely
      // unexpected payloads (non-string, oversized) as errors worth logging.
      if (text === null || text === undefined || text === '') {
        return {
          version: null,
          description: '',
          downloadUrl: UPDATE_CONFIG.autoInstallUrl,
        };
      }
      /** @type {string} */
      let rawText = '';
      if (typeof text === 'string') {
        rawText = text;
      } else if (
        text &&
        typeof text === 'object' &&
        'responseText' in text &&
        typeof (/** @type {{ responseText?: unknown }} */ (text).responseText) === 'string'
      ) {
        rawText = /** @type {string} */ (
          /** @type {{ responseText: string }} */ (text).responseText
        );
      } else {
        updateLogger?.debug?.('Update', `Skipping non-string metadata payload: ${typeof text}`);
        return {
          version: null,
          description: '',
          downloadUrl: UPDATE_CONFIG.autoInstallUrl,
        };
      }
      if (rawText.length > 100000) {
        updateLogger?.debug?.('Update', `Skipping oversized metadata payload: ${rawText.length}`);
        return {
          version: null,
          description: '',
          downloadUrl: UPDATE_CONFIG.autoInstallUrl,
        };
      }

      const normalized = rawText.replace(/\r/g, '');
      if (!(normalized.includes('==UserScript==') || normalized.includes('@version'))) {
        updateLogger?.debug?.('Update', 'Skipping non-userscript metadata response');
        return {
          version: null,
          description: '',
          downloadUrl: UPDATE_CONFIG.autoInstallUrl,
        };
      }

      let version = extractMetadataField(normalized, 'version');
      const description = extractMetadataField(normalized, 'description');
      const downloadUrl =
        extractMetadataField(normalized, 'downloadURL') || UPDATE_CONFIG.autoInstallUrl;

      // Validate extracted version
      if (version) {
        version = version.replace(/^v/i, '').trim();
        // Accept '2.2' or '2.2.0' or '2'
        if (!isVersionString(version)) {
          updateLogger?.error?.('Update', `Invalid version format in metadata: ${version}`);
          return {
            version: null,
            description: '',
            downloadUrl: UPDATE_CONFIG.autoInstallUrl,
          };
        }
      }

      return {
        version,
        description: description.substring(0, 500), // Limit description length
        downloadUrl,
      };
    },

    formatTimeAgo: (/** @type {number | null | undefined} */ timestamp) => {
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
      /** @type {string} */ text,
      /** @type {string} */ type = 'info',
      /** @type {number} */ duration = 3000
    ) => {
      YouTubeUtils.NotificationManager.show(text, { type, duration });
    },
  };
  /**
   * Validate update URL
   * @param {string} url - URL to validate
   * @throws {Error} If URL is invalid
   */
  const validateUpdateUrl = (/** @type {string} */ url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Update URL must use HTTPS');
    }
    if (!parsedUrl.hostname.includes('greasyfork.org')) {
      throw new Error('Update URL must be from greasyfork.org');
    }
  };

  /**
   * Validate update download URL for security
   * @param {string} downloadUrl - URL to validate
   * @returns {{valid: boolean, error: string|null}} Validation result
   */
  const validateDownloadUrl = (/** @type {string} */ downloadUrl) => {
    if (!downloadUrl || typeof downloadUrl !== 'string') {
      return { valid: false, error: 'Invalid download URL for installation' };
    }

    // `new URL` rejects malformed input text.
    try {
      const parsedUrl = new URL(downloadUrl);
      const allowedDomains = ['update.greasyfork.org', 'greasyfork.org'];

      if (parsedUrl.protocol !== 'https:') {
        return { valid: false, error: 'Only HTTPS URLs allowed for updates' };
      }

      if (!allowedDomains.includes(parsedUrl.hostname)) {
        return {
          valid: false,
          error: `Update URL domain not in allowlist: ${parsedUrl.hostname}`,
        };
      }

      return { valid: true, error: null };
    } catch (error) {
      logS(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        valid: false,
        error: `Invalid URL format: ${errorMessage}`,
      };
    }
  };

  /**
   * Mark update as dismissed in session storage
   * @param {UpdateDetails | null | undefined} details - Update details
   */
  const markUpdateDismissed = (/** @type {UpdateDetails | null | undefined} */ details) => {
    if (details?.version && typeof details.version === 'string') {
      try {
        sessionStorage.setItem('update_dismissed', details.version);
      } catch (err) {
        logS(err);
        updateLogger?.error?.('Update', 'Failed to persist dismissal state', err);
      }
    }
  };

  /**
   * Open the update URL in a new tab only. Reports whether a tab was
   * requested; the current tab is never navigated, so a blocked popup cannot
   * replace the page the user is on.
   * @param {string} url - URL to open
   * @returns {boolean} Success status
   */
  const tryOpenUpdateUrl = (/** @type {string} */ url) => {
    // Method 1: GM_openInTab (the GM api rejects in odd managers)
    if (GM_openInTab_safe) {
      try {
        GM_openInTab_safe(url, { active: true, insert: true, setParent: true });
        return true;
      } catch (gmError) {
        logS(gmError);
        updateLogger?.error?.('Update', 'GM_openInTab update install failed', gmError);
      }
    }

    // Method 2: a new tab through the scheme-checked helper, which reports
    // whether the URL was allowed.
    if (typeof U?.openSafe === 'function') {
      return U.openSafe(url, '_blank');
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  };

  /**
   * Install update with URL validation
   * @param {UpdateDetails | null} [details=updateState.updateDetails] - Update details containing downloadUrl and version
   * @returns {boolean} True if installation initiated successfully
   */
  const installUpdate = (
    /** @type {UpdateDetails | null} */ details = updateState.updateDetails
  ) => {
    const downloadUrl = details?.downloadUrl || UPDATE_CONFIG.autoInstallUrl;

    // Validate URL
    const validation = validateDownloadUrl(downloadUrl);
    if (!validation.valid) {
      updateLogger?.error?.('Update', validation.error || 'Update URL validation failed');
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
  /** @param {UpdateDetails} updateDetails */
  const showUpdateNotification = (/** @type {UpdateDetails} */ updateDetails) => {
    // Optionally render notification icon (can be disabled via config)
    const iconHtml = UPDATE_CONFIG.showNotificationIcon
      ? `<div class="update-notification-icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12c0 1-1 2-1 2s-1-1-1-2 1-2 1-2 1 1 1 2z"/>
              <path d="m21 12-5-5v3H8v4h8v3l5-5z"/>
            </svg>
          </div>`
      : '';
    const notification = document.createElement('div');
    notification.className =
      'youtube-enhancer-notification update-notification update-notification-card';
    notification.setAttribute('role', 'alertdialog');
    notification.setAttribute('aria-label', t('updateAvailableTitle'));

    injectStyles(
      'yp-update-notification-styles',
      (window.YouTubePlusDesignSystem?.getStyle?.('yp-update-notification-styles') || '') +
        (window.YouTubePlusStyleResources?.update || '')
    );

    window.YouTubeUtils.renderTemplateClone(
      notification,
      `
        <div class="update-notification-layout">
            ${iconHtml}
          <div class="update-notification-content">
            <div class="update-notification-title">${t('updateAvailableTitle')}</div>
            <div class="update-notification-version">
              ${t('version')} ${updateDetails.version}
            </div>
            ${
              updateDetails.changelog || updateDetails.description
                ? (
                    function () {
                      const header = t('changelogHeader');

                      // Prefer fetched changelog, fall back to metadata description.
                      // SECURITY: `raw` is escaped via textContent and re-parsed
                      // through YouTubeSafeDOM; regex sanitizers break on nested tags.
                      const safeDom = window.YouTubeSafeDOM;
                      const rawText =
                        updateDetails.changelog && updateDetails.changelog.length > 0
                          ? updateDetails.changelog
                          : updateDetails.description || '';
                      const normalized = String(rawText)
                        .replace(/<br\s*\/?>/gi, '\n')
                        .replace(/<\/(p|div|li)>/gi, '\n')
                        .replace(/\r\n?/g, '\n');

                      const escapeHtml = /** @type {(s: string) => string} */ (
                        s =>
                          typeof safeDom?.escapeHTML === 'function' ? safeDom.escapeHTML(s) : ''
                      );

                      const escapedHeader = escapeHtml(header);
                      const lines = normalized
                        .split(/\n+/)
                        .map(l => l.trim())
                        .filter(Boolean);
                      const listHtml = lines
                        .map(l => `<div class="update-changelog-line">${escapeHtml(l)}</div>`)
                        .join('');

                      return (
                        `<div class="update-changelog-header">${escapedHeader}</div>` +
                        `<div class="update-changelog-box">${listHtml}</div>`
                      );
                    }
                  )()
                : `<div class="update-changelog-fallback">${t('newFeatures')}</div>`
            }
            <div class="update-notification-actions">
              <button id="update-install-btn" class="update-install-btn" type="button">${t('installUpdate')}</button>
              <button id="update-dismiss-btn" class="update-dismiss-btn" type="button">${t('later')}</button>
            </div>
          </div>
          <button id="update-close-btn" class="update-close-btn" aria-label="${t('dismiss')}">&times;</button>
        </div>
      `
    );

    // Append into centralized notification container (created if missing)
    const _containerId = 'youtube-enhancer-notification-container';
    let _container = byId(_containerId);
    if (!_container) {
      _container = document.createElement('div');
      _container.id = _containerId;
      _container.className = 'youtube-enhancer-notification-container';
      document.body.appendChild(_container);
    }
    _container.insertBefore(notification, _container.firstChild);

    const removeNotification = () => {
      // use explicit slide-out animation so it exits downward like the entry
      notification.style.animation = 'slideOutToBottom 0.35s ease-in forwards';
      window.YouTubeUtils?.cleanupManager?.timeout?.(() => notification.remove(), 360);
    };

    // Event handlers
    const installBtn = notification.querySelector('#update-install-btn');
    if (installBtn) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        installBtn,
        'click',
        () => {
          const success = installUpdate(updateDetails);
          if (success) {
            removeNotification();
            window.YouTubeUtils?.cleanupManager?.timeout?.(
              () => utils.showNotification(t('installing')),
              500
            );
          } else {
            utils.showNotification(t('manualInstallHint'), 'error', 5000);
            U?.openSafe
              ? U.openSafe('https://greasyfork.org/en/scripts/537017-youtube', '_blank')
              : window.open(
                  'https://greasyfork.org/en/scripts/537017-youtube',
                  '_blank',
                  'noopener'
                );
          }
        },
        undefined,
        false
      );
    }

    const dismissBtn = notification.querySelector('#update-dismiss-btn');
    if (dismissBtn) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        dismissBtn,
        'click',
        () => {
          if (updateDetails?.version) {
            sessionStorage.setItem('update_dismissed', updateDetails.version);
          }
          removeNotification();
        },
        undefined,
        false
      );
    }

    const closeBtn = notification.querySelector('#update-close-btn');
    if (closeBtn) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        closeBtn,
        'click',
        () => {
          if (updateDetails?.version) {
            sessionStorage.setItem('update_dismissed', updateDetails.version);
          }
          removeNotification();
        },
        undefined,
        false
      );
    }

    // Auto-dismiss
    window.YouTubeUtils?.cleanupManager?.timeout?.(() => {
      if (notification.isConnected) removeNotification();
    }, UPDATE_CONFIG.notificationDuration);
  };

  /**
   * Fetch remote text through GM_xmlhttpRequest when available, falling
   * back to fetch with an abort timeout. Transport aborts keep raw timers:
   * they must fire even across navigation sweeps.
   * @param {string} url
   * @param {Record<string, string>} headers
   * @param {string} timeoutLabel prefix for timeout/error messages
   * @returns {Promise<string>} Response body text
   */
  const fetchRemoteText = async (url, headers, timeoutLabel) => {
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout_(() => reject(new Error(`${timeoutLabel} timeout`)), 10000);
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: 10000,
          headers,
          onload: (/** @type {GMResponseLike} */ response) => {
            clearTimeout(timeoutId);
            if (response.status >= 200 && response.status < 300)
              resolve(/** @type {string} */ (response.responseText));
            else reject(new Error(`HTTP ${response.status}: ${response.statusText || ''}`));
          },
          onerror: (/** @type {unknown} */ e) => {
            clearTimeout(timeoutId);
            reject(new Error(`Network error: ${e}`));
          },
          ontimeout: () => {
            clearTimeout(timeoutId);
            reject(new Error(`${timeoutLabel} timeout`));
          },
        });
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout_(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-cache',
        signal: controller.signal,
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.text();
    } finally {
      clearTimeout(timeoutId);
    }
  };

  /**
   * Fetch update metadata with timeout protection. Accepts a URL so callers can
   * request alternate endpoints (for example the .user.js auto-install URL) as a
   * fallback when the primary metadata does not include a usable version.
   * @param {string} [url=UPDATE_CONFIG.updateUrl] - URL to fetch metadata from
   * @returns {Promise<string>} Metadata text
   */
  const fetchUpdateMetadata = (url = UPDATE_CONFIG.updateUrl) =>
    fetchRemoteText(
      url,
      { Accept: 'text/plain', 'User-Agent': 'YouTube+ UpdateChecker' },
      'Update check'
    );

  /**
   * Handle update availability check results
   * @param {UpdateDetails} updateDetails - Update details object
   * @param {boolean} force - Whether check was forced
   */
  const handleUpdateResult = (
    /** @type {UpdateDetails} */ updateDetails,
    /** @type {boolean} */ force
  ) => {
    const shouldShowNotification =
      updateState.updateAvailable &&
      (force || sessionStorage.getItem('update_dismissed') !== updateDetails.version);

    if (shouldShowNotification) {
      showUpdateNotification(updateDetails);
      window.YouTubeUtils?.logger?.debug?.(`YouTube + Update available: ${updateDetails.version}`);
      return;
    }

    if (force) {
      const message = updateState.updateAvailable
        ? t('updateAvailableMsg').replace('{version}', updateDetails.version || '')
        : t('upToDateMsg').replace('{version}', UPDATE_CONFIG.currentVersion);
      utils.showNotification(message);
    }
  };

  /**
   * Determine if error is transient and retryable
   * @param {unknown} error - Error object
   * @returns {boolean} True if error is transient
   */
  const isTransientError = (/** @type {unknown} */ error) => {
    if (!error || typeof error !== 'object') return false;
    const err = /** @type {{ name?: string; message?: string }} */ (error);
    return !!(
      err.name === 'AbortError' ||
      err.name === 'NetworkError' ||
      err.message?.includes('fetch') ||
      err.message?.includes('network')
    );
  };

  /**
   * Fetch changelog for a specific version from GreasyFork
   * @param {string} version - Version to fetch changelog for
   * @returns {Promise<string>} Changelog text
   */
  const fetchChangelog = async (/** @type {string} */ version) => {
    try {
      const lang = getLanguage();
      const url = `https://greasyfork.org/${lang}/scripts/537017-youtube/versions`;
      const html = await fetchRemoteText(url, { Accept: 'text/html' }, 'Changelog fetch');

      // Parse changelog from HTML
      // Look for version link followed by changelog span
      // Structure: <a ...>vX.Y.Z</a> ... <span class="version-changelog">...</span>
      const domParser = typeof window.DOMParser === 'function' ? new window.DOMParser() : null;
      if (domParser) {
        // Trusted Types: the plain-string sink throws under
        // `require-trusted-types-for 'script'`, so route the fetched HTML
        // through the policy (the allowlist keeps the markup this reads).
        const safeChangelogHtml = window.YouTubeSafeDOM?.createTrustedHTML?.(html) ?? html;
        const doc = domParser.parseFromString(safeChangelogHtml, 'text/html');
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
          matchingLink?.closest('li, article, section, div') || matchingLink?.parentElement || null;
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
      }

      return '';
    } catch (error) {
      logS(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateLogger?.warn?.('Update', `Failed to fetch changelog: ${errorMessage}`);
      return '';
    }
  };

  /**
   * Fetch changelog for a given version safely
   * @param {string} version
   * @returns {Promise<string>}
   */
  const fetchVersionChangelog = async version => {
    try {
      const changelog = await fetchChangelog(version);
      return typeof changelog === 'string' && changelog.length > 0 ? changelog : '';
    } catch (changelogErr) {
      logS(changelogErr);
      const changelogMessage =
        changelogErr instanceof Error ? changelogErr.message : String(changelogErr);
      updateLogger?.warn?.('Update', `Failed to fetch changelog: ${changelogMessage}`);
      return '';
    }
  };

  /**
   * Retrieve update details trying primary metadata endpoint first and
   * falling back to the auto-install .user.js URL when necessary.
   * @returns {Promise<UpdateDetails>} Parsed updateDetails object
   */
  const retrieveUpdateDetails = async () => {
    // Attempt primary metadata fetch
    const metaText = await fetchUpdateMetadata(UPDATE_CONFIG.updateUrl);
    let details = utils.parseMetadata(metaText);

    if (!details.version) {
      try {
        const fallbackText = await fetchUpdateMetadata(UPDATE_CONFIG.autoInstallUrl);
        const fallbackDetails = utils.parseMetadata(fallbackText);
        if (fallbackDetails.version) {
          details = fallbackDetails;
        }
      } catch (fallbackErr) {
        logS(fallbackErr);
        const fallbackMessage =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        updateLogger?.warn?.('Update', `Fallback metadata fetch failed: ${fallbackMessage}`);
      }
    }

    details.changelog = details.version ? await fetchVersionChangelog(details.version) : '';
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
   * @param {number} now - Current timestamp
   * @returns {boolean} True if should proceed
   */
  const shouldCheckForUpdates = (/** @type {boolean} */ force, /** @type {number} */ now) => {
    if (!UPDATE_CONFIG.enabled || updateState.checkInProgress) {
      return false;
    }
    return force || now - updateState.lastCheck >= UPDATE_CONFIG.checkInterval;
  };

  /**
   * Validate the update configuration; throws on a bad URL (the caller's
   * catch owns the logging/retry).
   * @returns {boolean} True if valid
   */
  const validateUpdateConfiguration = () => {
    validateUpdateUrl(UPDATE_CONFIG.updateUrl);
    return true;
  };

  /**
   * Process successful update details
   * @param {UpdateDetails} updateDetails - Update details
   * @param {boolean} force - Force flag
   * @param {number} now - Current timestamp
   * @returns {void}
   */
  const processUpdateDetails = (
    /** @type {UpdateDetails} */ updateDetails,
    /** @type {boolean} */ force,
    /** @type {number} */ now
  ) => {
    updateState.lastCheck = now;
    updateState.lastVersion = updateDetails.version || UPDATE_CONFIG.currentVersion;
    updateState.updateDetails = updateDetails;

    const comparison = utils.compareVersions(
      UPDATE_CONFIG.currentVersion,
      updateDetails.version || ''
    );
    updateState.updateAvailable = comparison < 0;

    handleUpdateResult(updateDetails, force);
    utils.saveSettings();

    // Auto-install if configured and update wasn't dismissed; reads
    // sessionStorage (which can be blocked in sandboxed documents).
    if (updateState.updateAvailable && UPDATE_CONFIG.autoInstallOnCheck) {
      try {
        const dismissed = sessionStorage.getItem('update_dismissed');
        if (dismissed !== updateDetails.version) {
          const started = installUpdate(updateDetails);
          if (started) {
            // Persist that we've acted on this update so we don't keep reopening it
            markUpdateDismissed(updateDetails);
            utils.showNotification(t('installing'));
          } else {
            updateLogger?.warn?.(
              'Update',
              `Auto-install could not be initiated for ${updateDetails.downloadUrl}`
            );
          }
        }
      } catch (e) {
        logS(e);
        updateLogger?.error?.('Update', 'Auto-installation failed', e);
      }
    }
  };

  /**
   * Handle missing update information
   * @param {boolean} force - Force flag
   * @returns {void}
   */
  const handleMissingUpdateInfo = (/** @type {boolean} */ force) => {
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
   * @param {unknown} error - Error object
   * @param {boolean} force - Force flag
   * @param {number} retryCount - Current retry count
   * @returns {Promise<void>}
   */
  const handleUpdateRetry = async (
    /** @type {unknown} */ error,
    /** @type {boolean} */ force,
    /** @type {number} */ retryCount
  ) => {
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 2000;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (isTransientError(error) && retryCount < MAX_RETRIES) {
      updateLogger?.warn?.(
        'Update',
        `Retry ${retryCount + 1}/${MAX_RETRIES} after error: ${errorMessage}`
      );
      await /** @type {Promise<void>} */ (
        new Promise(resolve => {
          YouTubeUtils?.cleanupManager?.timeout?.(() => resolve(), RETRY_DELAY * 2 ** retryCount);
        })
      );
      return checkForUpdates(force, retryCount + 1);
    }

    updateLogger?.error?.('Update', 'Check failed after retries', error);
    if (force) {
      utils.showNotification(t('updateCheckFailed').replace('{msg}', errorMessage), 'error', 4000);
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
      logS(error);
      await handleUpdateRetry(error, force, retryCount);
    } finally {
      updateState.checkInProgress = false;
    }
  };

  // Optimized settings UI
  const addUpdateSettings = () => {
    const aboutSection = document.querySelector('.yp-settings-section[data-section="about"]');
    if (!(aboutSection instanceof HTMLElement)) return;
    if (aboutSection.querySelector('.update-settings-container')) return;

    const updateContainer = document.createElement('div');
    updateContainer.className = 'update-settings-container update-settings-card';

    const lastCheckTime = utils.formatTimeAgo(updateState.lastCheck);

    injectStyles(
      'yp-update-settings-styles',
      (window.YouTubePlusDesignSystem?.getStyle?.('yp-update-settings-styles') || '') +
        (window.YouTubePlusStyleResources?.update || '')
    );

    window.YouTubeUtils.renderTemplateClone(
      updateContainer,
      `
        <div class="update-settings-header">
          <h3 class="update-settings-title">
            ${t('enhancedExperience')}
          </h3>
        </div>

        <div class="update-settings-status-card">
          <div>
            <div class="update-settings-version-row">
              <span class="update-settings-label">${t('currentVersion')}</span>
              <span class="update-settings-pill">${UPDATE_CONFIG.currentVersion}</span>
            </div>
            <div class="update-settings-meta">
              ${t('lastChecked')}: <span class="update-settings-meta-strong">${lastCheckTime}</span>
              ${
                updateState.lastVersion && updateState.lastVersion !== UPDATE_CONFIG.currentVersion
                  ? `<br>${t('latestAvailable')}: <span class="update-settings-latest">${updateState.lastVersion}</span>`
                  : ''
              }
            </div>
          </div>

          ${
            updateState.updateAvailable
              ? `
            <div class="update-status-col">
              <div class="update-status-badge update-status-badge--available">
                <div class="update-status-dot update-status-dot--available"></div>
                <span class="update-status-text update-status-text--available">
                  ${t('updateAvailable')}
                </span>
              </div>
              <button id="install-update-btn" class="update-install-inline-btn">${t('installUpdate')}</button>
            </div>
          `
              : `
            <div class="update-status-badge update-status-badge--ok">
              <div class="update-status-dot update-status-dot--ok"></div>
              <span class="update-status-text update-status-text--ok">
                ${t('upToDate')}
              </span>
            </div>
          `
          }
        </div>

        <div class="update-settings-actions">
            <button class="yp-button yp-button-primary update-check-btn" id="manual-update-check">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="update-refresh-icon">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M19.13 11.48A10 10 0 0 0 12 2C6.48 2 2 6.48 2 12c0 .34.02.67.05 1M4.87 12.52A10 10 0 0 0 12 22c5.52 0 10-4.48 10-10 0-.34-.02-.67-.05-1"/>
            </svg>
            ${t('checkForUpdates')}
          </button>
          <button class="yp-button update-open-page-btn" id="open-update-page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15,3 21,3 21,9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
        </div>
      `
    );

    aboutSection.appendChild(updateContainer);

    // Keep custom About actions/footer below update card.
    const aboutActions = aboutSection.querySelector('.yp-about-actions');
    const aboutFooter = aboutSection.querySelector('.yp-about-footer');
    if (aboutActions) aboutSection.appendChild(aboutActions);
    if (aboutFooter) aboutSection.appendChild(aboutFooter);

    // Event listeners with optimization
    const attachClickHandler = (
      /** @type {string} */ id,
      /** @type {(evt: Event) => void} */ handler
    ) => {
      const element = byId(id);
      if (element) YouTubeUtils.cleanupManager.registerListener(element, 'click', handler);
    };

    // Destructure event parameter to prefer destructuring
    attachClickHandler('manual-update-check', async (/** @type {Event} */ evt) => {
      const button =
        evt.currentTarget instanceof HTMLButtonElement
          ? evt.currentTarget
          : evt.target instanceof Element
            ? evt.target.closest('button#manual-update-check')
            : null;
      if (!(button instanceof HTMLButtonElement)) return;
      setManualCheckButtonContent(button, t('checkingForUpdates'), true);
      button.disabled = true;

      await checkForUpdates(true);

      window.YouTubeUtils?.cleanupManager?.timeout?.(() => {
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
        U?.openSafe
          ? U.openSafe('https://greasyfork.org/en/scripts/537017-youtube', '_blank')
          : window.open('https://greasyfork.org/en/scripts/537017-youtube', '_blank', 'noopener');
      }
    });

    attachClickHandler('open-update-page', () => {
      utils.showNotification(t('updatePageFallback'));
      U?.openSafe
        ? U.openSafe('https://greasyfork.org/en/scripts/537017-youtube', '_blank')
        : window.open('https://greasyfork.org/en/scripts/537017-youtube', '_blank', 'noopener');
    });
  };

  // Optimized initialization
  /**
   * Setup initial and periodic update checks
   * @returns {void}
   */
  const setupUpdateChecks = () => {
    // Initial check with delay
    window.YouTubeUtils?.cleanupManager?.timeout?.(() => checkForUpdates(), 3000);

    const globalObject =
      /** @type {typeof globalThis & { __ytpUpdateCheckIntervalId?: ReturnType<typeof setInterval> }} */ (
        typeof window !== 'undefined' ? window : globalThis
      );
    const previousIntervalId = globalObject.__ytpUpdateCheckIntervalId;
    if (previousIntervalId) {
      clearInterval(previousIntervalId);
      if (YouTubeUtils.cleanupManager?.unregisterInterval) {
        YouTubeUtils.cleanupManager.unregisterInterval(previousIntervalId);
      }
    }

    // Periodic checks: one registration in session scope. The id must not land
    // in the page-scope set, or per-navigation cleanup would clear it early.
    const intervalId = setInterval(() => checkForUpdates(), UPDATE_CONFIG.checkInterval);
    window.YouTubePlusCleanupManager?.registerInterval?.(intervalId, {
      scope: 'session',
    });
    globalObject.__ytpUpdateCheckIntervalId = intervalId;
    YouTubeUtils.cleanupManager?.registerListener?.(window, 'beforeunload', () =>
      clearInterval(intervalId)
    );
  };

  /**
   * Setup settings modal event listener
   * @returns {void}
   */
  const setupSettingsObserver = () => {
    const handler = () => {
      window.YouTubeUtils?.cleanupManager?.timeout?.(addUpdateSettings, 100);
    };
    YouTubeUtils.cleanupManager?.registerListener?.(
      document,
      'youtube-plus-settings-modal-opened',
      handler
    );
  };

  /**
   * Setup click handler for about section
   * @returns {void}
   */
  const setupAboutClickHandler = () => {
    const clickHandler = (/** @type {Event} */ evt) => {
      const target = evt.target instanceof Element ? evt.target : null;
      const navItem = target?.closest('.yp-settings-nav-item');
      if (navItem instanceof HTMLElement && navItem.dataset.section === 'about') {
        window.YouTubeUtils?.cleanupManager?.timeout?.(addUpdateSettings, 50);
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
    if (updateLogger?.debug) {
      updateLogger.debug('YouTube + Update Checker initialized', {
        version: UPDATE_CONFIG.currentVersion,
        enabled: UPDATE_CONFIG.enabled,
        lastCheck: new Date(updateState.lastCheck).toLocaleString(),
        updateAvailable: updateState.updateAvailable,
      });
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
    // If the about section is already in the DOM (i.e. the user
    // activated the About tab before init ran), populate it now.
    // `setupSettingsObserver` only fires on the *next* modal-open
    // event, so without this direct call the section would stay
    // empty until the modal is closed and reopened.
    if (document.querySelector('.yp-settings-section[data-section="about"]')) {
      window.YouTubeUtils?.cleanupManager?.timeout?.(addUpdateSettings, 0);
    }
    logInitialization();
  };

  const startUpdateRuntime = () => {
    if (document.readyState === 'loading') {
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'DOMContentLoaded',
        init,
        { once: true },
        true
      );
    } else {
      init();
    }
  };

  // Register settings modal listener at module scope so it fires
  // regardless of which tab section is active. Without this, the
  // listener inside init() -> setupSettingsObserver() would only be
  // registered after the About tab is activated, causing a race
  // condition where opening the modal before clicking About would
  // miss the event.
  window.YouTubePlusCleanupManager?.registerListener?.(
    document,
    'youtube-plus-settings-modal-opened',
    () => {
      if (!_initDone) {
        init();
      } else {
        window.YouTubeUtils?.cleanupManager?.timeout?.(addUpdateSettings, 100);
      }
    },
    undefined,
    true
  );

  const publicAPI = {
    compareVersions: utils.compareVersions,
    parseMetadata: utils.parseMetadata,
    formatTimeAgo: utils.formatTimeAgo,
    loadSettings: utils.loadSettings,
    saveSettings: utils.saveSettings,
    checkForUpdates,
    UPDATE_CONFIG,
    updateState,
    init,
  };
  window.YouTubePlusUpdate = publicAPI;

  // Section-gated: the only consumer is the "About" tab. Opening it fires the
  // section-activated event, which starts the runtime; no route gate is needed.
  if (window.YouTubeUtils?.onSectionActive) {
    window.YouTubeUtils.onSectionActive('about', startUpdateRuntime);
  } else if (typeof window !== 'undefined') {
    // Fallback: ensure the runtime is wired so the "Check for
    // updates" button still works if the helper surface is
    // unavailable for some reason.
    startUpdateRuntime();
  }
})();
