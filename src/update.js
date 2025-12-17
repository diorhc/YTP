// Update checker module
(function () {
  'use strict';

  // Use centralized i18n where available to avoid duplicate translation objects
  const _globalI18n =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;
  const t = (key, params = {}) => {
    try {
      if (_globalI18n && typeof _globalI18n.t === 'function') {
        return _globalI18n.t(key, params);
      }
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.t === 'function'
      ) {
        return window.YouTubeUtils.t(key, params);
      }
    } catch {
      // fall through
    }
    if (!key || typeof key !== 'string') return '';
    if (Object.keys(params).length === 0) return key;
    let result = key;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
  };

  // Language helper delegating to global i18n when available
  const getLanguage = () => {
    try {
      if (_globalI18n && typeof _globalI18n.getLanguage === 'function') {
        return _globalI18n.getLanguage();
      }
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.getLanguage === 'function'
      ) {
        return window.YouTubeUtils.getLanguage();
      }
    } catch {
      // fallback
    }
    const lang = document.documentElement.lang || navigator.language || 'en';
    return lang.startsWith('ru') ? 'ru' : 'en';
  };

  const UPDATE_CONFIG = {
    enabled: true,
    checkInterval: 24 * 60 * 60 * 1000, // 24 hours
    updateUrl: 'https://update.greasyfork.org/scripts/537017/YouTube%20%2B.meta.js',
    currentVersion: '2.3.2',
    storageKey: 'youtube_plus_update_check',
    notificationDuration: 8000,
    autoInstallUrl: 'https://update.greasyfork.org/scripts/537017/YouTube%20%2B.user.js',
    // If true, attempt to automatically initiate installation when an update is found
    // NOTE: This will try to open the install URL (GM_openInTab / window.open / navigation).
    // Keep disabled by default for safety; enable only if you want auto-install behavior.
    autoInstallOnCheck: false,
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

  const updateState = {
    lastCheck: 0,
    lastVersion: UPDATE_CONFIG.currentVersion,
    updateAvailable: true,
    checkInProgress: false,
    updateDetails: null,
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
    return {
      day: ['день', 'дня', 'дней'],
      hour: ['час', 'часа', 'часов'],
      minute: ['минута', 'минуты', 'минут'],
    }[unit];
  }

  /**
   * Get plural forms for a unit in English
   * @param {string} unit - Time unit
   * @returns {string[]} Array of forms
   */
  function getEnglishForms(unit) {
    return {
      day: ['day', 'days'],
      hour: ['hour', 'hours'],
      minute: ['minute', 'minutes'],
    }[unit];
  }

  function pluralizeTime(n, unit) {
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
          console.error('[YouTube+][Update]', 'Invalid settings structure');
          return;
        }

        // Validate individual properties with type checking
        if (typeof parsed.lastCheck === 'number' && parsed.lastCheck >= 0) {
          updateState.lastCheck = parsed.lastCheck;
        }

        // Accept version formats like '2.2' or '2.2.0' or 'v2.2.0'
        if (typeof parsed.lastVersion === 'string') {
          const ver = parsed.lastVersion.replace(/^v/i, '');
          if (/^\d+(?:\.\d+){0,2}$/.test(ver)) {
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
            /^\d+\.\d+\.\d+/.test(parsed.updateDetails.version)
          ) {
            updateState.updateDetails = parsed.updateDetails;
          }
        }
      } catch (e) {
        console.error('[YouTube+][Update]', 'Failed to load update settings:', e);
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
        console.error('[YouTube+][Update]', 'Failed to save update settings:', e);
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
        console.error('[YouTube+][Update]', 'Invalid version format - must be strings');
        return 0;
      }

      const normalize = v =>
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
     * @param {string} text - Metadata text
     * @returns {Object} Parsed metadata with version, description, downloadUrl
     */
    parseMetadata: text => {
      if (typeof text !== 'string' || text.length > 100000) {
        console.error('[YouTube+][Update]', 'Invalid metadata text');
        return { version: null, description: '', downloadUrl: UPDATE_CONFIG.autoInstallUrl };
      }

      const extractField = field =>
        text.match(new RegExp(`@${field}\\s+([^\\r\\n]+)`))?.[1]?.trim();

      let version = extractField('version');
      const description = extractField('description') || '';
      const downloadUrl = extractField('downloadURL') || UPDATE_CONFIG.autoInstallUrl;

      // Validate extracted version
      if (version) {
        version = version.replace(/^v/i, '').trim();
        // Accept '2.2' or '2.2.0' or '2'
        if (!/^\d+(?:\.\d+){0,2}$/.test(version)) {
          console.error('[YouTube+][Update]', 'Invalid version format in metadata:', version);
          return { version: null, description: '', downloadUrl: UPDATE_CONFIG.autoInstallUrl };
        }
      }

      return {
        version,
        description: description.substring(0, 500), // Limit description length
        downloadUrl,
      };
    },

    formatTimeAgo: timestamp => {
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

    showNotification: (text, type = 'info', duration = 3000) => {
      try {
        YouTubeUtils.NotificationManager.show(text, { type, duration });
      } catch (error) {
        window.YouTubeUtils &&
          YouTubeUtils.logger &&
          YouTubeUtils.logger.debug &&
          YouTubeUtils.logger.debug(`[YouTube+] ${type.toUpperCase()}:`, text, error);
      }
    },
  };
  /**
   * Validate update download URL for security
   * @param {string} downloadUrl - URL to validate
   * @returns {{valid: boolean, error: string|null}} Validation result
   */
  const validateDownloadUrl = downloadUrl => {
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
      return { valid: false, error: `Invalid URL format: ${error.message}` };
    }
  };

  /**
   * Mark update as dismissed in session storage
   * @param {Object} details - Update details
   */
  const markUpdateDismissed = details => {
    if (details?.version && typeof details.version === 'string') {
      try {
        sessionStorage.setItem('update_dismissed', details.version);
      } catch (err) {
        console.error('[YouTube+][Update]', 'Failed to persist dismissal state:', err);
      }
    }
  };

  /**
   * Try different methods to open update URL
   * @param {string} url - URL to open
   * @returns {boolean} Success status
   */
  const tryOpenUpdateUrl = url => {
    // Method 1: GM_openInTab
    if (GM_openInTab_safe) {
      try {
        GM_openInTab_safe(url, { active: true, insert: true, setParent: true });
        return true;
      } catch (gmError) {
        console.error('[YouTube+] GM_openInTab update install failed:', gmError);
      }
    }

    // Method 2: window.open
    try {
      const popup = window.open(url, '_blank', 'noopener');
      if (popup) return true;
    } catch (popupError) {
      console.error('[YouTube+] window.open update install failed:', popupError);
    }

    // Method 3: Navigate
    try {
      window.location.assign(url);
      return true;
    } catch (navigationError) {
      console.error('[YouTube+] Navigation to update URL failed:', navigationError);
    }

    return false;
  };

  /**
   * Install update with URL validation
   * @param {Object} details - Update details containing downloadUrl and version
   * @returns {boolean} True if installation initiated successfully
   */
  const installUpdate = (details = updateState.updateDetails) => {
    const downloadUrl = details?.downloadUrl || UPDATE_CONFIG.autoInstallUrl;

    // Validate URL
    const validation = validateDownloadUrl(downloadUrl);
    if (!validation.valid) {
      console.error('[YouTube+][Update]', validation.error);
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
  const showUpdateNotification = updateDetails => {
    const notification = document.createElement('div');
    notification.className = 'youtube-enhancer-notification update-notification';
    // Use centralized notification container for consistent placement. Keep visual styles but remove fixed positioning.
    notification.style.cssText = `
    z-index: 10001; max-width: 350px;
    background: linear-gradient(135deg, rgba(255, 69, 0, 0.95), rgba(255, 140, 0, 0.95));
    color: white; padding: 16px 20px; border-radius: 12px;
    box-shadow: 0 8px 32px rgba(255, 69, 0, 0.4); backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.2);
  animation: slideInFromBottom 0.4s ease-out;
    `;

    notification.innerHTML = `
        <div style="position: relative; display: flex; align-items: flex-start; gap: 12px;">
          <div style="background: rgba(255, 255, 255, 0.2); border-radius: 8px; padding: 8px; flex-shrink: 0;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12c0 1-1 2-1 2s-1-1-1-2 1-2 1-2 1 1 1 2z"/>
              <path d="m21 12-5-5v3H8v4h8v3l5-5z"/>
            </svg>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px;">${t('updateAvailableTitle')}</div>
            <div style="font-size: 13px; opacity: 0.9; margin-bottom: 12px;">
              ${t('version')} ${updateDetails.version} • ${updateDetails.description || t('newFeatures')}
            </div>
            <div style="display: flex; gap: 8px;">
              <button id="update-install-btn" style="
                background: rgba(255, 255, 255, 0.9); color: #ff4500; border: none;
                padding: 8px 16px; border-radius: 6px; cursor: pointer;
                font-size: 13px; font-weight: 600; transition: all 0.2s ease;
              ">${t('installUpdate')}</button>
              <button id="update-dismiss-btn" style="
                background: rgba(255, 255, 255, 0.1); color: white;
                border: 1px solid rgba(255, 255, 255, 0.3); padding: 8px 12px;
                border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.2s ease;
              ">${t('later')}</button>
            </div>
          </div>
          <button id="update-close-btn" aria-label="${t('dismiss')}" style="
            position: absolute; top: -6px; right: -6px; width: 24px; height: 24px;
            border-radius: 50%; border: none; cursor: pointer; display: flex;
            align-items: center; justify-content: center; font-size: 16px; line-height: 1;
            background: rgba(255, 255, 255, 0.15); color: white; transition: background 0.2s ease;
          ">&times;</button>
        </div>
        <style>
          @keyframes slideInFromBottom {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }

          @keyframes slideOutToBottom {
            from { transform: translateY(0); opacity: 1; }
            to { transform: translateY(100%); opacity: 0; }
          }

          #update-close-btn:hover {
            background: rgba(255, 255, 255, 0.25);
          }
        </style>
      `;

    // Append into centralized notification container (created if missing)
    const _containerId = 'youtube-enhancer-notification-container';
    let _container = document.getElementById(_containerId);
    if (!_container) {
      _container = document.createElement('div');
      _container.id = _containerId;
      _container.className = 'youtube-enhancer-notification-container';
      try {
        document.body.appendChild(_container);
      } catch {
        document.body.appendChild(notification);
      }
    }
    try {
      _container.insertBefore(notification, _container.firstChild);
    } catch {
      document.body.appendChild(notification);
    }

    const removeNotification = () => {
      // use explicit slide-out animation so it exits downward like the entry
      notification.style.animation = 'slideOutToBottom 0.35s ease-in forwards';
      setTimeout(() => notification.remove(), 360);
    };

    // Event handlers
    const installBtn = notification.querySelector('#update-install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', () => {
        const success = installUpdate(updateDetails);
        if (success) {
          removeNotification();
          setTimeout(() => utils.showNotification(t('installing')), 500);
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
    setTimeout(() => {
      if (notification.isConnected) removeNotification();
    }, UPDATE_CONFIG.notificationDuration);
  };

  /**
   * Validate update URL
   * @param {string} url - URL to validate
   * @throws {Error} If URL is invalid
   */
  const validateUpdateUrl = url => {
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
    const fetchMeta = async requestUrl => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => reject(new Error('Update check timeout')), 10000);
          GM_xmlhttpRequest({
            method: 'GET',
            url: requestUrl,
            timeout: 10000,
            headers: { Accept: 'text/plain', 'User-Agent': 'YouTube+ UpdateChecker' },
            onload: response => {
              clearTimeout(timeoutId);
              if (response.status >= 200 && response.status < 300) resolve(response.responseText);
              else reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
            },
            onerror: e => {
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
      const timeoutId = setTimeout(() => controller.abort(), 10000);
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
  const handleUpdateResult = (updateDetails, force) => {
    const shouldShowNotification =
      updateState.updateAvailable &&
      (force || sessionStorage.getItem('update_dismissed') !== updateDetails.version);

    if (shouldShowNotification) {
      showUpdateNotification(updateDetails);
      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.debug &&
        YouTubeUtils.logger.debug(`YouTube + Update available: ${updateDetails.version}`);
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
  const isTransientError = error => {
    return (
      error.name === 'AbortError' ||
      error.name === 'NetworkError' ||
      (error.message && error.message.includes('fetch')) ||
      (error.message && error.message.includes('network'))
    );
  };

  /**
   * Retrieve update details trying primary metadata endpoint first and
   * falling back to the auto-install .user.js URL when necessary.
   * @returns {Promise<Object>} Parsed updateDetails object
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
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[YouTube+][Update] Fallback metadata fetch failed:', fallbackErr.message);
        }
      }
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
  const shouldCheckForUpdates = (force, now) => {
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
      console.error('[YouTube+][Update]', 'Invalid update URL configuration:', urlError);
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
  const processUpdateDetails = (updateDetails, force, now) => {
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
            } catch {}
          } else {
            console.warn(
              '[YouTube+][Update] Auto-install could not be initiated for',
              updateDetails.downloadUrl
            );
          }
        }
      } catch (e) {
        console.error('[YouTube+][Update] Auto-installation failed:', e);
      }
    }
  };

  /**
   * Handle missing update information
   * @param {boolean} force - Force flag
   * @returns {void}
   */
  const handleMissingUpdateInfo = force => {
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
  const handleUpdateRetry = async (error, force, retryCount) => {
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 2000;

    if (isTransientError(error) && retryCount < MAX_RETRIES) {
      console.warn(
        `[YouTube+][Update] Retry ${retryCount + 1}/${MAX_RETRIES} after error:`,
        error.message
      );
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, retryCount)));
      return checkForUpdates(force, retryCount + 1);
    }

    console.error('[YouTube+][Update] Check failed after retries:', error);
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
    // ✅ Use cached querySelector
    const aboutSection = YouTubeUtils.querySelector(
      '.ytp-plus-settings-section[data-section="about"]'
    );
    if (!aboutSection || YouTubeUtils.querySelector('.update-settings-container')) return;

    const updateContainer = document.createElement('div');
    updateContainer.className = 'update-settings-container';
    updateContainer.style.cssText = `
        padding: 16px; margin-top: 20px; border-radius: 12px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
        border: 1px solid var(--yt-glass-border); backdrop-filter: blur(8px);
      `;

    const lastCheckTime = utils.formatTimeAgo(updateState.lastCheck);

    updateContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--yt-spec-text-primary);">
            ${t('enhancedExperience')}
          </h3>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; 
                    padding: 16px; background: rgba(255, 255, 255, 0.03); border-radius: 10px; margin-bottom: 16px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 14px; font-weight: 600; color: var(--yt-spec-text-primary);">${t('currentVersion')}</span>
              <span style="font-size: 13px; font-weight: 600; color: var(--yt-spec-text-primary); 
                           padding: 3px 10px; background: rgba(255, 255, 255, 0.1); border-radius: 12px; 
                           border: 1px solid rgba(255, 255, 255, 0.2);">${UPDATE_CONFIG.currentVersion}</span>
            </div>
            <div style="font-size: 12px; color: var(--yt-spec-text-secondary);">
              ${t('lastChecked')}: <span style="font-weight: 500;">${lastCheckTime}</span>
              ${
                updateState.lastVersion && updateState.lastVersion !== UPDATE_CONFIG.currentVersion
                  ? `<br>${t('latestAvailable')}: <span style="color: #ff6666; font-weight: 600;">${updateState.lastVersion}</span>`
                  : ''
              }
            </div>
          </div>
          
          ${
            updateState.updateAvailable
              ? `
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; 
                          background: linear-gradient(135deg, rgba(255, 68, 68, 0.2), rgba(255, 68, 68, 0.3)); 
                          border: 1px solid rgba(255, 68, 68, 0.4); border-radius: 20px;">
                <div style="width: 6px; height: 6px; background: #ff4444; border-radius: 50%; animation: pulse 2s infinite;"></div>
                <span style="font-size: 11px; color: #ff6666; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  ${t('updateAvailable')}
                </span>
              </div>
              <button id="install-update-btn" style="background: linear-gradient(135deg, #ff4500, #ff6b35); 
                      color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; 
                      font-size: 12px; font-weight: 600; transition: all 0.3s ease; 
                      box-shadow: 0 4px 12px rgba(255, 69, 0, 0.3);">${t('installUpdate')}</button>
            </div>
          `
              : `
            <div style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; 
                        background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(34, 197, 94, 0.3)); 
                        border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 20px;">
              <div style="width: 6px; height: 6px; background: #22c55e; border-radius: 50%;"></div>
              <span style="font-size: 11px; color: #22c55e; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                ${t('upToDate')}
              </span>
            </div>
          `
          }
        </div>
        
        <div style="display: flex; gap: 12px;">
          <button class="ytp-plus-button ytp-plus-button-primary" id="manual-update-check" 
                  style="flex: 1; padding: 12px; font-size: 13px; font-weight: 600;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M19.13 11.48A10 10 0 0 0 12 2C6.48 2 2 6.48 2 12c0 .34.02.67.05 1M4.87 12.52A10 10 0 0 0 12 22c5.52 0 10-4.48 10-10 0-.34-.02-.67-.05-1"/>
            </svg>
            ${t('checkForUpdates')}
          </button>
          <button class="ytp-plus-button" id="open-update-page" 
                  style="padding: 12px 16px; font-size: 13px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15,3 21,3 21,9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
        </div>

        <style>
          @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.1); } }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        </style>
      `;

    aboutSection.appendChild(updateContainer);

    // Event listeners with optimization
    const attachClickHandler = (id, handler) => {
      const element = document.getElementById(id);
      if (element) YouTubeUtils.cleanupManager.registerListener(element, 'click', handler);
    };

    // Destructure event parameter to prefer destructuring
    attachClickHandler('manual-update-check', async ({ target }) => {
      const button = /** @type {HTMLElement} */ (target);
      const originalHTML = button.innerHTML;

      button.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" 
               style="margin-right: 6px; animation: spin 1s linear infinite;">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M19.13 11.48A10 10 0 0 0 12 2C6.48 2 2 6.48 2 12c0 .34.02.67.05 1M4.87 12.52A10 10 0 0 0 12 22c5.52 0 10-4.48 10-10 0-.34-.02-.67-.05-1"/>
          </svg>
          ${t('checkingForUpdates')}
        `;
      button.disabled = true;

      await checkForUpdates(true);

      setTimeout(() => {
        button.innerHTML = originalHTML;
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
    setTimeout(() => checkForUpdates(), 3000);

    // Periodic checks - register interval in cleanupManager
    const intervalId = setInterval(() => checkForUpdates(), UPDATE_CONFIG.checkInterval);
    YouTubeUtils.cleanupManager.registerInterval(intervalId);
    window.addEventListener('beforeunload', () => clearInterval(intervalId));
  };

  /**
   * Handle settings modal mutation
   * @param {MutationRecord} mutation - Mutation record
   * @param {Object} state - Settings observer state
   * @returns {boolean} True if settings found
   */
  const handleSettingsModalMutation = (mutation, state) => {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
        state.settingsObserved = true;
        setTimeout(addUpdateSettings, 100);
        return true;
      }
    }
    return false;
  };

  /**
   * Handle about nav item mutation
   * @returns {void}
   */
  const handleAboutNavItemMutation = () => {
    const aboutNavItem = YouTubeUtils.querySelector(
      '.ytp-plus-settings-nav-item[data-section="about"].active:not([data-observed])'
    );
    if (aboutNavItem) {
      aboutNavItem.setAttribute('data-observed', '');
      setTimeout(addUpdateSettings, 50);
    }
  };

  /**
   * Create settings modal observer
   * @returns {MutationObserver} Mutation observer
   */
  const createSettingsObserver = () => {
    const state = { settingsObserved: false };

    const observer = new MutationObserver(mutations => {
      if (state.settingsObserved) return;

      for (const mutation of mutations) {
        if (handleSettingsModalMutation(mutation, state)) {
          return;
        }
      }

      handleAboutNavItemMutation();
    });

    return observer;
  };

  /**
   * Setup settings modal observer
   * @returns {void}
   */
  const setupSettingsObserver = () => {
    const observer = createSettingsObserver();
    YouTubeUtils.cleanupManager.registerObserver(observer);

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  };

  /**
   * Setup click handler for about section
   * @returns {void}
   */
  const setupAboutClickHandler = () => {
    const clickHandler = ({ target }) => {
      const el = /** @type {HTMLElement} */ (target);
      if (el.classList?.contains('ytp-plus-settings-nav-item') && el.dataset?.section === 'about') {
        setTimeout(addUpdateSettings, 50);
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
      if (window.YouTubeUtils && YouTubeUtils.logger && YouTubeUtils.logger.debug) {
        YouTubeUtils.logger.debug('YouTube + Update Checker initialized', {
          version: UPDATE_CONFIG.currentVersion,
          enabled: UPDATE_CONFIG.enabled,
          lastCheck: new Date(updateState.lastCheck).toLocaleString(),
          updateAvailable: updateState.updateAvailable,
        });
      }
    } catch {}
  };

  /**
   * Initialize update checker
   * @returns {void}
   */
  const init = () => {
    utils.loadSettings();
    setupUpdateChecks();
    setupSettingsObserver();
    setupAboutClickHandler();
    logInitialization();
  };

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
