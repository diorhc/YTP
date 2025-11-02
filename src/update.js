// Update checker module
(function () {
  'use strict';

  // Internationalization
  const i18n = {
    en: {
      updateAvailableTitle: 'YouTube + Update Available',
      version: 'Version',
      newFeatures: 'New features and improvements',
      installUpdate: 'Install Update',
      later: 'Later',
      enhancedExperience: 'Enhanced YouTube experience with powerful features',
      currentVersion: 'Current Version',
      lastChecked: 'Last checked',
      latestAvailable: 'Latest available',
      updateAvailable: 'Update Available',
      installing: 'Installing...',
      checkingForUpdates: 'Checking for updates...',
      upToDate: 'Up to date',
      checkForUpdates: 'Check for Updates',
      autoCheckUpdates: 'Automatically check for updates',
      manualInstallHint:
        'Could not open update automatically. Download it manually from GreasyFork.',
      updatePageFallback: 'Opening update page...',
      // Time / small messages
      never: 'Never',
      justNow: 'Just now',
      daysAgo: '{n}d ago',
      hoursAgo: '{n}h ago',
      minutesAgo: '{n}m ago',
      updateAvailableMsg: 'Update {version} available!',
      upToDateMsg: "You're using the latest version ({version})",
      updateCheckFailed: 'Update check failed: {msg}',
      dismiss: 'Dismiss',
    },
    ru: {
      updateAvailableTitle: 'Доступно обновление YouTube +',
      version: 'Версия',
      newFeatures: 'Новые функции и улучшения',
      installUpdate: 'Установить обновление',
      later: 'Позже',
      enhancedExperience: 'Расширенные возможности YouTube с мощными функциями',
      currentVersion: 'Текущая версия',
      lastChecked: 'Последняя проверка',
      latestAvailable: 'Доступна версия',
      updateAvailable: 'Доступно обновление',
      installing: 'Установка...',
      checkingForUpdates: 'Проверка обновлений...',
      upToDate: 'Актуальная версия',
      checkForUpdates: 'Проверить обновления',
      autoCheckUpdates: 'Автоматически проверять обновления',
      manualInstallHint:
        'Не удалось открыть обновление автоматически. Загрузите его вручную с GreasyFork.',
      updatePageFallback: 'Открываю страницу обновления...',
      // Time / small messages
      never: 'Никогда',
      justNow: 'Только что',
      daysAgo: '{n}д',
      hoursAgo: '{n}ч',
      minutesAgo: '{n}м',
      updateAvailableMsg: 'Доступно обновление {version}!',
      upToDateMsg: 'Вы используете последнюю версию ({version})',
      updateCheckFailed: 'Проверка обновлений не удалась: {msg}',
      dismiss: 'Закрыть',
    },
  };

  function getLanguage() {
    const lang = document.documentElement.lang || navigator.language || 'en';
    return lang.startsWith('ru') ? 'ru' : 'en';
  }

  function t(key) {
    const lang = getLanguage();
    return i18n[lang][key] || i18n.en[key] || key;
  }

  const UPDATE_CONFIG = {
    enabled: true,
    checkInterval: 24 * 60 * 60 * 1000, // 24 hours
    updateUrl: 'https://update.greasyfork.org/scripts/537017/YouTube%20%2B.meta.js',
    currentVersion: '2.0.2',
    storageKey: 'youtube_plus_update_check',
    notificationDuration: 8000,
    autoInstallUrl: 'https://update.greasyfork.org/scripts/537017/YouTube%20%2B.user.js',
  };

  const windowRef = typeof window !== 'undefined' ? window : null;
  const GM_namespace = windowRef?.GM || null;
  const GM_info_safe = windowRef?.GM_info || null;
  const GM_openInTab_safe = (() => {
    if (!windowRef) return null;
    if (typeof windowRef.GM_openInTab === 'function') return windowRef.GM_openInTab.bind(windowRef);
    if (GM_namespace?.openInTab) return GM_namespace.openInTab.bind(GM_namespace);
    return null;
  })();

  if (GM_info_safe?.script?.version) {
    UPDATE_CONFIG.currentVersion = GM_info_safe.script.version;
  }

  const updateState = {
    lastCheck: 0,
    lastVersion: UPDATE_CONFIG.currentVersion,
    updateAvailable: false,
    checkInProgress: false,
    updateDetails: null,
  };

  // Pluralization helper for time units (available to this module)
  function pluralizeTime(n, unit) {
    const lang = getLanguage();
    const num = Math.abs(Number(n)) || 0;

    if (lang === 'ru') {
      const forms = {
        day: ['день', 'дня', 'дней'],
        hour: ['час', 'часа', 'часов'],
        minute: ['минута', 'минуты', 'минут'],
      }[unit];
      const mod10 = num % 10;
      const mod100 = num % 100;
      let idx = 2;
      if (mod10 === 1 && mod100 !== 11) idx = 0;
      else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) idx = 1;
      return `${num} ${forms[idx]}`;
    }

    // English (default)
    const enForms = {
      day: ['day', 'days'],
      hour: ['hour', 'hours'],
      minute: ['minute', 'minutes'],
    }[unit];
    return `${num} ${num === 1 ? enForms[0] : enForms[1]}`;
  }

  // Optimized utilities
  const utils = {
    loadSettings: () => {
      try {
        const saved = localStorage.getItem(UPDATE_CONFIG.storageKey);
        if (saved) Object.assign(updateState, JSON.parse(saved));
      } catch (e) {
        console.warn('[YouTube+] Failed to load update settings:', e);
      }
    },

    saveSettings: () => {
      try {
        localStorage.setItem(
          UPDATE_CONFIG.storageKey,
          JSON.stringify({
            lastCheck: updateState.lastCheck,
            lastVersion: updateState.lastVersion,
            updateAvailable: updateState.updateAvailable,
            updateDetails: updateState.updateDetails,
          })
        );
      } catch (e) {
        console.warn('[YouTube+] Failed to save update settings:', e);
      }
    },

    compareVersions: (v1, v2) => {
      const normalize = v =>
        v
          .replace(/[^\d.]/g, '')
          .split('.')
          .map(n => parseInt(n) || 0);
      const [parts1, parts2] = [normalize(v1), normalize(v2)];
      const maxLength = Math.max(parts1.length, parts2.length);

      for (let i = 0; i < maxLength; i++) {
        const diff = (parts1[i] || 0) - (parts2[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    },

    parseMetadata: text => {
      const extractField = field =>
        text.match(new RegExp(`@${field}\\s+([^\\r\\n]+)`))?.[1]?.trim();
      return {
        version: extractField('version'),
        description: extractField('description') || '',
        downloadUrl: extractField('downloadURL') || UPDATE_CONFIG.autoInstallUrl,
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
        console.log(`[YouTube+] ${type.toUpperCase()}:`, text, error);
      }
    },
  };

  const installUpdate = (details = updateState.updateDetails) => {
    const downloadUrl = details?.downloadUrl || UPDATE_CONFIG.autoInstallUrl;
    if (!downloadUrl) {
      console.warn('[YouTube+] No download URL provided for update installation');
      return false;
    }

    const markDismissed = () => {
      if (details?.version) {
        try {
          sessionStorage.setItem('update_dismissed', details.version);
        } catch (err) {
          console.warn('[YouTube+] Failed to persist dismissal state:', err);
        }
      }
    };

    try {
      if (GM_openInTab_safe) {
        GM_openInTab_safe(downloadUrl, { active: true, insert: true, setParent: true });
        markDismissed();
        return true;
      }
    } catch (gmError) {
      console.error('[YouTube+] GM_openInTab update install failed:', gmError);
    }

    try {
      const popup = window.open(downloadUrl, '_blank', 'noopener');
      if (popup) {
        markDismissed();
        return true;
      }
    } catch (popupError) {
      console.error('[YouTube+] window.open update install failed:', popupError);
    }

    try {
      window.location.assign(downloadUrl);
      markDismissed();
      return true;
    } catch (navigationError) {
      console.error('[YouTube+] Navigation to update URL failed:', navigationError);
    }

    return false;
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

  // Optimized update checker
  const checkForUpdates = async (force = false) => {
    if (!UPDATE_CONFIG.enabled || updateState.checkInProgress) return;

    const now = Date.now();
    if (!force && now - updateState.lastCheck < UPDATE_CONFIG.checkInterval) return;

    updateState.checkInProgress = true;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(UPDATE_CONFIG.updateUrl, {
        method: 'GET',
        cache: 'no-cache',
        signal: controller.signal,
        headers: { Accept: 'text/plain', 'User-Agent': 'YouTube+ UpdateChecker' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const metaText = await response.text();
      const updateDetails = utils.parseMetadata(metaText);

      if (updateDetails.version) {
        updateState.lastCheck = now;
        updateState.lastVersion = updateDetails.version;
        updateState.updateDetails = updateDetails;

        const comparison = utils.compareVersions(
          UPDATE_CONFIG.currentVersion,
          updateDetails.version
        );
        updateState.updateAvailable = comparison < 0;

        if (
          updateState.updateAvailable &&
          (force || sessionStorage.getItem('update_dismissed') !== updateDetails.version)
        ) {
          showUpdateNotification(updateDetails);
          console.log(`YouTube + Update available: ${updateDetails.version}`);
        } else if (force) {
          if (updateState.updateAvailable) {
            utils.showNotification(
              t('updateAvailableMsg').replace('{version}', updateDetails.version)
            );
          } else {
            utils.showNotification(
              t('upToDateMsg').replace('{version}', UPDATE_CONFIG.currentVersion)
            );
          }
        }

        utils.saveSettings();
      }
    } catch (error) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('Update check failed:', error);
      }
      if (force) {
        utils.showNotification(
          t('updateCheckFailed').replace('{msg}', error.message),
          'error',
          4000
        );
      }
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

    attachClickHandler('manual-update-check', async e => {
      const button = /** @type {EventTarget & HTMLElement} */ (e.target);
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
  const init = () => {
    utils.loadSettings();

    // Initial check with delay
    setTimeout(() => checkForUpdates(), 3000);

    // Periodic checks
    // ✅ Register interval in cleanupManager
    const intervalId = setInterval(() => checkForUpdates(), UPDATE_CONFIG.checkInterval);
    YouTubeUtils.cleanupManager.registerInterval(intervalId);
    window.addEventListener('beforeunload', () => clearInterval(intervalId));

    // Optimized settings modal observer
    let settingsObserved = false;
    const observer = new MutationObserver(mutations => {
      if (settingsObserved) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
            settingsObserved = true;
            setTimeout(addUpdateSettings, 100);
            return;
          }
        }
      }

      // ✅ Use cached querySelector
      const aboutNavItem = YouTubeUtils.querySelector(
        '.ytp-plus-settings-nav-item[data-section="about"].active:not([data-observed])'
      );
      if (aboutNavItem) {
        aboutNavItem.setAttribute('data-observed', '');
        setTimeout(addUpdateSettings, 50);
      }
    });

    // ✅ Register observer in cleanupManager
    YouTubeUtils.cleanupManager.registerObserver(observer);

    // ✅ Safe observe with document.body check
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    // Optimized click handler
    // ✅ Register global listener in cleanupManager
    const clickHandler = e => {
      const target = /** @type {EventTarget & HTMLElement} */ (e.target);
      if (
        target.classList?.contains('ytp-plus-settings-nav-item') &&
        target.dataset?.section === 'about'
      ) {
        setTimeout(addUpdateSettings, 50);
      }
    };
    YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, {
      passive: true,
      capture: true,
    });

    if (typeof console !== 'undefined' && console.log) {
      console.log('YouTube + Update Checker initialized', {
        version: UPDATE_CONFIG.currentVersion,
        enabled: UPDATE_CONFIG.enabled,
        lastCheck: new Date(updateState.lastCheck).toLocaleString(),
        updateAvailable: updateState.updateAvailable,
      });
    }
  };

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
