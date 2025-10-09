// count
(function () {
  'use strict';

  // Enhanced configuration with better defaults
  const CONFIG = {
    OPTIONS: ['subscribers', 'views', 'videos'],
    FONT_LINK: 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;700&display=swap',
    STATS_API_URL: 'https://api.livecounts.io/youtube-live-subscriber-counter/stats/',
    DEFAULT_UPDATE_INTERVAL: 2000,
    DEFAULT_OVERLAY_OPACITY: 0.75,
    MAX_RETRIES: 3,
    CACHE_DURATION: 300000, // 5 minutes
    DEBOUNCE_DELAY: 100,
    STORAGE_KEY: 'youtube_channel_stats_settings',
  };

  // Global state management
  const state = {
    overlay: null,
    isUpdating: false,
    intervalId: null,
    currentChannelName: null,
    enabled: localStorage.getItem(CONFIG.STORAGE_KEY) !== 'false',
    updateInterval:
      parseInt(localStorage.getItem('youtubeEnhancerInterval')) || CONFIG.DEFAULT_UPDATE_INTERVAL,
    overlayOpacity:
      parseFloat(localStorage.getItem('youtubeEnhancerOpacity')) || CONFIG.DEFAULT_OVERLAY_OPACITY,
    lastSuccessfulStats: new Map(),
    previousStats: new Map(),
    previousUrl: location.href,
    isChecking: false,
    documentListenerKeys: new Set(),
  };

  // Utility functions
  const utils = {
    log: (message, ...args) => {
      console.log(`[YouTube Enhancer] ${message}`, ...args);
    },

    warn: (message, ...args) => {
      console.warn(`[YouTube Enhancer] ${message}`, ...args);
    },

    error: (message, ...args) => {
      console.error(`[YouTube Enhancer] ${message}`, ...args);
    },

    // Use shared debounce from YouTubeUtils
    debounce:
      window.YouTubeUtils?.debounce ||
      ((func, wait) => {
        let timeout;
        return function executedFunction(...args) {
          const later = () => {
            clearTimeout(timeout);
            func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
        };
      }),
  };

  const OPTIONS = CONFIG.OPTIONS;
  const FONT_LINK = CONFIG.FONT_LINK;
  const STATS_API_URL = CONFIG.STATS_API_URL;

  /**
   * Fetches channel data from YouTube
   * @param {string} url - The channel URL to fetch
   * @returns {Promise<Object|null>} The parsed channel data or null on error
   */
  async function fetchChannel(url) {
    if (state.isChecking) return null;
    state.isChecking = true;

    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
      });

      if (!response.ok) return null;

      const html = await response.text();
      const match = html.match(/var ytInitialData = (.+?);<\/script>/);
      return match && match[1] ? JSON.parse(match[1]) : null;
    } catch (error) {
      utils.warn('Failed to fetch channel data:', error);
      return null;
    } finally {
      state.isChecking = false;
    }
  }

  async function getChannelInfo(url) {
    const data = await fetchChannel(url);
    if (!data) return null;

    try {
      const channelName = data?.metadata?.channelMetadataRenderer?.title || 'Unknown';
      const channelId = data?.metadata?.channelMetadataRenderer?.externalId || null;

      return { channelName, channelId };
    } catch {
      return null;
    }
  }

  function isChannelPageUrl(url) {
    return (
      url.includes('youtube.com/') &&
      (url.includes('/channel/') || url.includes('/@')) &&
      !url.includes('/video/') &&
      !url.includes('/watch')
    );
  }

  function checkUrlChange() {
    const currentUrl = location.href;
    if (currentUrl !== state.previousUrl) {
      state.previousUrl = currentUrl;
      if (isChannelPageUrl(currentUrl)) {
        setTimeout(() => getChannelInfo(currentUrl), 500);
      }
    }
  }

  history.pushState = (function (f) {
    /** @this {any} */
    return function () {
      f.apply(this, arguments);
      checkUrlChange();
    };
  })(history.pushState);

  history.replaceState = (function (f) {
    /** @this {any} */
    return function () {
      f.apply(this, arguments);
      checkUrlChange();
    };
  })(history.replaceState);

  window.addEventListener('popstate', checkUrlChange);
  setInterval(checkUrlChange, 1000);

  function init() {
    try {
      utils.log('Initializing YouTube Enhancer v1.6');

      loadFonts();
      initializeLocalStorage();
      addStyles();
      if (state.enabled) {
        observePageChanges();
        addNavigationListener();

        if (isChannelPageUrl(location.href)) {
          getChannelInfo(location.href);
        }
      }

      utils.log('YouTube Enhancer initialized successfully');
    } catch (error) {
      utils.error('Failed to initialize YouTube Enhancer:', error);
    }
  }

  function loadFonts() {
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = FONT_LINK;
    document.head.appendChild(fontLink);
  }

  function initializeLocalStorage() {
    OPTIONS.forEach(option => {
      if (localStorage.getItem(`show-${option}`) === null) {
        localStorage.setItem(`show-${option}`, 'true');
      }
    });
  }

  function addStyles() {
    // ✅ Use StyleManager instead of createElement('style')
    const styles = `
        .channel-banner-overlay{position:absolute;top:0;left:0;width:100%;height:100%;border-radius:12px;z-index:10;display:flex;justify-content:space-around;align-items:center;color:#fff;font-family:var(--stats-font-family,'Rubik',sans-serif);font-size:var(--stats-font-size,24px);box-sizing:border-box;transition:background-color .3s ease;backdrop-filter:blur(2px)}
        .settings-button{position:absolute;top:8px;right:8px;width:24px;height:24px;cursor:pointer;z-index:2;transition:transform .2s;opacity:.7}
        .settings-button:hover{transform:scale(1.1);opacity:1}
        .settings-menu{position:absolute;top:35px;right:8px;background:rgba(0,0,0,.95);padding:12px;border-radius:8px;z-index:10;display:none;backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.1);min-width:320px}
        .settings-menu.show{display:block}
        .stat-container{display:flex;flex-direction:column;align-items:center;justify-content:center;visibility:hidden;width:33%;height:100%;padding:0 1rem}
        .number-container{display:flex;align-items:center;justify-content:center;font-weight:700;min-height:3rem}
        .label-container{display:flex;align-items:center;margin-top:.5rem;font-size:1.2rem;opacity:.9}
        .label-container svg{width:1.5rem;height:1.5rem;margin-right:.5rem}
        .difference{font-size:1.8rem;height:2rem;margin-bottom:.5rem;transition:opacity .3s}
        .spinner-container{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;justify-content:center;align-items:center}
        .loading-spinner{animation:spin 1s linear infinite}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @media(max-width:768px){.channel-banner-overlay{flex-direction:column;padding:8px;min-height:160px}.settings-menu{width:280px;right:4px}}
        .setting-group{margin-bottom:12px}
        .setting-group:last-child{margin-bottom:0}
        .setting-group label{display:block;margin-bottom:4px;font-weight:600;color:#fff;font-size:14px}
        .setting-group input[type="range"]{width:100%;margin:4px 0}
        .setting-group input[type="checkbox"]{margin-right:8px}
        .setting-value{color:#aaa;font-size:12px;margin-top:2px}
        `;
    YouTubeUtils.StyleManager.add('channel-stats-overlay', styles);
  }

  function createSettingsButton() {
    const button = document.createElement('div');
    button.className = 'settings-button';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 0 512 512');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'white');
    path.setAttribute(
      'd',
      'M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z'
    );

    svg.appendChild(path);
    button.appendChild(svg);

    return button;
  }

  function createSettingsMenu() {
    const menu = document.createElement('div');
    menu.className = 'settings-menu';
    menu.style.gap = '15px';
    menu.style.width = '360px';
    menu.setAttribute('tabindex', '-1');
    menu.setAttribute('aria-modal', 'true');

    const displaySection = createDisplaySection();
    const controlsSection = createControlsSection();

    menu.appendChild(displaySection);
    menu.appendChild(controlsSection);

    return menu;
  }

  function createDisplaySection() {
    const displaySection = document.createElement('div');
    displaySection.style.flex = '1';

    const displayLabel = document.createElement('label');
    displayLabel.textContent = 'Display Options';
    displayLabel.style.marginBottom = '10px';
    displayLabel.style.display = 'block';
    displayLabel.style.fontSize = '16px';
    displayLabel.style.fontWeight = 'bold';
    displaySection.appendChild(displayLabel);

    OPTIONS.forEach(option => {
      const checkboxContainer = document.createElement('div');
      checkboxContainer.style.display = 'flex';
      checkboxContainer.style.alignItems = 'center';
      checkboxContainer.style.marginTop = '5px';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `show-${option}`;
      checkbox.checked = localStorage.getItem(`show-${option}`) !== 'false';
      // ✅ Применяем стиль как в настройках
      checkbox.className = 'ytp-plus-settings-checkbox';

      const checkboxLabel = document.createElement('label');
      checkboxLabel.htmlFor = `show-${option}`;
      checkboxLabel.textContent = option.charAt(0).toUpperCase() + option.slice(1);
      checkboxLabel.style.cursor = 'pointer';
      checkboxLabel.style.color = 'white';
      checkboxLabel.style.fontSize = '14px';
      checkboxLabel.style.marginLeft = '8px';

      checkbox.addEventListener('change', () => {
        localStorage.setItem(`show-${option}`, String(checkbox.checked));
        updateDisplayState();
      });

      checkboxContainer.appendChild(checkbox);
      checkboxContainer.appendChild(checkboxLabel);
      displaySection.appendChild(checkboxContainer);
    });

    return displaySection;
  }

  function createControlsSection() {
    const controlsSection = document.createElement('div');
    controlsSection.style.flex = '1';

    // Font family selector
    const fontLabel = document.createElement('label');
    fontLabel.textContent = 'Font Family';
    fontLabel.style.display = 'block';
    fontLabel.style.marginBottom = '5px';
    fontLabel.style.fontSize = '16px';
    fontLabel.style.fontWeight = 'bold';

    const fontSelect = document.createElement('select');
    fontSelect.className = 'font-family-select';
    fontSelect.style.width = '100%';
    fontSelect.style.marginBottom = '10px';
    const fonts = [
      { name: 'Rubik', value: 'Rubik, sans-serif' },
      { name: 'Impact', value: 'Impact, Charcoal, sans-serif' },
      { name: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
      { name: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
    ];
    const savedFont = localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif';
    fonts.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.value;
      opt.textContent = f.name;
      if (f.value === savedFont) opt.selected = true;
      fontSelect.appendChild(opt);
    });

    fontSelect.addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLSelectElement} */ (e.target);
      localStorage.setItem('youtubeEnhancerFontFamily', target.value);
      if (state.overlay) {
        // Only update .subscribers-number, .views-number, .videos-number
        state.overlay
          .querySelectorAll('.subscribers-number,.views-number,.videos-number')
          .forEach(el => {
            el.style.fontFamily = target.value;
          });
      }
    });

    // Font size slider
    const fontSizeLabel = document.createElement('label');
    fontSizeLabel.textContent = 'Font Size';
    fontSizeLabel.style.display = 'block';
    fontSizeLabel.style.marginBottom = '5px';
    fontSizeLabel.style.fontSize = '16px';
    fontSizeLabel.style.fontWeight = 'bold';

    const fontSizeSlider = document.createElement('input');
    fontSizeSlider.type = 'range';
    fontSizeSlider.min = '16';
    fontSizeSlider.max = '72';
    fontSizeSlider.value = localStorage.getItem('youtubeEnhancerFontSize') || '24';
    fontSizeSlider.step = '1';
    fontSizeSlider.className = 'font-size-slider';

    const fontSizeValue = document.createElement('div');
    fontSizeValue.className = 'font-size-value';
    fontSizeValue.textContent = `${fontSizeSlider.value}px`;
    fontSizeValue.style.fontSize = '14px';
    fontSizeValue.style.marginBottom = '15px';

    fontSizeSlider.addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      fontSizeValue.textContent = `${target.value}px`;
      localStorage.setItem('youtubeEnhancerFontSize', target.value);
      if (state.overlay) {
        // Only update .subscribers-number, .views-number, .videos-number
        state.overlay
          .querySelectorAll('.subscribers-number,.views-number,.videos-number')
          .forEach(el => {
            el.style.fontSize = `${target.value}px`;
          });
      }
    });

    // ...existing code...
    const intervalLabel = document.createElement('label');
    intervalLabel.textContent = 'Update Interval';
    intervalLabel.style.display = 'block';
    intervalLabel.style.marginBottom = '5px';
    intervalLabel.style.fontSize = '16px';
    intervalLabel.style.fontWeight = 'bold';

    const intervalSlider = document.createElement('input');
    intervalSlider.type = 'range';
    intervalSlider.min = '2';
    intervalSlider.max = '10';
    intervalSlider.value = String(state.updateInterval / 1000);
    intervalSlider.step = '1';
    intervalSlider.className = 'interval-slider';

    const intervalValue = document.createElement('div');
    intervalValue.className = 'interval-value';
    intervalValue.textContent = `${intervalSlider.value}s`;
    intervalValue.style.marginBottom = '15px';
    intervalValue.style.fontSize = '14px';

    intervalSlider.addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      const newInterval = parseInt(target.value) * 1000;
      intervalValue.textContent = `${target.value}s`;
      state.updateInterval = newInterval;
      localStorage.setItem('youtubeEnhancerInterval', String(newInterval));

      if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = setInterval(() => {
          updateOverlayContent(state.overlay, state.currentChannelName);
        }, newInterval);

        // ✅ Register interval in cleanupManager
        YouTubeUtils.cleanupManager.registerInterval(state.intervalId);
      }
    });

    const opacityLabel = document.createElement('label');
    opacityLabel.textContent = 'Background Opacity';
    opacityLabel.style.display = 'block';
    opacityLabel.style.marginBottom = '5px';
    opacityLabel.style.fontSize = '16px';
    opacityLabel.style.fontWeight = 'bold';

    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.min = '50';
    opacitySlider.max = '90';
    opacitySlider.value = String(state.overlayOpacity * 100);
    opacitySlider.step = '5';
    opacitySlider.className = 'opacity-slider';

    const opacityValue = document.createElement('div');
    opacityValue.className = 'opacity-value';
    opacityValue.textContent = `${opacitySlider.value}%`;
    opacityValue.style.fontSize = '14px';

    opacitySlider.addEventListener('input', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      const newOpacity = parseInt(target.value) / 100;
      opacityValue.textContent = `${target.value}%`;
      state.overlayOpacity = newOpacity;
      localStorage.setItem('youtubeEnhancerOpacity', String(newOpacity));

      if (state.overlay) {
        state.overlay.style.backgroundColor = `rgba(0, 0, 0, ${newOpacity})`;
      }
    });

    controlsSection.appendChild(fontLabel);
    controlsSection.appendChild(fontSelect);
    controlsSection.appendChild(fontSizeLabel);
    controlsSection.appendChild(fontSizeSlider);
    controlsSection.appendChild(fontSizeValue);
    controlsSection.appendChild(intervalLabel);
    controlsSection.appendChild(intervalSlider);
    controlsSection.appendChild(intervalValue);
    controlsSection.appendChild(opacityLabel);
    controlsSection.appendChild(opacitySlider);
    controlsSection.appendChild(opacityValue);

    return controlsSection;
  }

  function createSpinner() {
    const spinnerContainer = document.createElement('div');
    spinnerContainer.style.position = 'absolute';
    spinnerContainer.style.top = '0';
    spinnerContainer.style.left = '0';
    spinnerContainer.style.width = '100%';
    spinnerContainer.style.height = '100%';
    spinnerContainer.style.display = 'flex';
    spinnerContainer.style.justifyContent = 'center';
    spinnerContainer.style.alignItems = 'center';
    spinnerContainer.classList.add('spinner-container');

    const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spinner.setAttribute('viewBox', '0 0 512 512');
    spinner.setAttribute('width', '64');
    spinner.setAttribute('height', '64');
    spinner.classList.add('loading-spinner');
    spinner.style.animation = 'spin 1s linear infinite';

    const secondaryPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    secondaryPath.setAttribute(
      'd',
      'M0 256C0 114.9 114.1 .5 255.1 0C237.9 .5 224 14.6 224 32c0 17.7 14.3 32 32 32C150 64 64 150 64 256s86 192 192 192c69.7 0 130.7-37.1 164.5-92.6c-3 6.6-3.3 14.8-1 22.2c1.2 3.7 3 7.2 5.4 10.3c1.2 1.5 2.6 3 4.1 4.3c.8 .7 1.6 1.3 2.4 1.9c.4 .3 .8 .6 1.3 .9s.9 .6 1.3 .8c5 2.9 10.6 4.3 16 4.3c11 0 21.8-5.7 27.7-16c-44.3 76.5-127 128-221.7 128C114.6 512 0 397.4 0 256z'
    );
    secondaryPath.style.opacity = '0.4';
    secondaryPath.style.fill = 'white';

    const primaryPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    primaryPath.setAttribute(
      'd',
      'M224 32c0-17.7 14.3-32 32-32C397.4 0 512 114.6 512 256c0 46.6-12.5 90.4-34.3 128c-8.8 15.3-28.4 20.5-43.7 11.7s-20.5-28.4-11.7-43.7c16.3-28.2 25.7-61 25.7-96c0-106-86-192-192-192c-17.7 0-32-14.3-32-32z'
    );
    primaryPath.style.fill = 'white';

    spinner.appendChild(secondaryPath);
    spinner.appendChild(primaryPath);
    spinnerContainer.appendChild(spinner);
    return spinnerContainer;
  }

  function createSVGIcon(path) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 640 512');
    svg.setAttribute('width', '2rem');
    svg.setAttribute('height', '2rem');
    svg.style.marginRight = '0.5rem';
    svg.style.display = 'none';

    const svgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svgPath.setAttribute('d', path);
    svgPath.setAttribute('fill', 'white');

    svg.appendChild(svgPath);
    return svg;
  }

  function createStatContainer(className, iconPath) {
    const container = document.createElement('div');
    Object.assign(container.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      visibility: 'hidden',
      width: '33%',
      height: '100%',
      padding: '0 1rem',
    });

    const numberContainer = document.createElement('div');
    Object.assign(numberContainer.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    });

    const differenceElement = document.createElement('div');
    differenceElement.classList.add(`${className}-difference`);
    Object.assign(differenceElement.style, {
      fontSize: '2.5rem',
      height: '2.5rem',
      marginBottom: '1rem',
    });

    const digitContainer = createNumberContainer();
    digitContainer.classList.add(`${className}-number`);
    Object.assign(digitContainer.style, {
      fontSize: (localStorage.getItem('youtubeEnhancerFontSize') || '24') + 'px',
      fontWeight: 'bold',
      lineHeight: '1',
      height: '4rem',
      fontFamily: localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif',
      letterSpacing: '0.025em',
    });

    numberContainer.appendChild(differenceElement);
    numberContainer.appendChild(digitContainer);

    const labelContainer = document.createElement('div');
    Object.assign(labelContainer.style, {
      display: 'flex',
      alignItems: 'center',
      marginTop: '0.5rem',
    });

    const icon = createSVGIcon(iconPath);
    Object.assign(icon.style, {
      width: '2rem',
      height: '2rem',
      marginRight: '0.75rem',
    });

    const labelElement = document.createElement('div');
    labelElement.classList.add(`${className}-label`);
    labelElement.style.fontSize = '2rem';

    labelContainer.appendChild(icon);
    labelContainer.appendChild(labelElement);

    container.appendChild(numberContainer);
    container.appendChild(labelContainer);

    return container;
  }

  function createOverlay(bannerElement) {
    clearExistingOverlay();

    if (!bannerElement) return null;

    const overlay = document.createElement('div');
    overlay.classList.add('channel-banner-overlay');
    Object.assign(overlay.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      backgroundColor: `rgba(0, 0, 0, ${state.overlayOpacity})`,
      borderRadius: '15px',
      zIndex: '10',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      color: 'white',
      fontFamily: localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif',
      fontSize: (localStorage.getItem('youtubeEnhancerFontSize') || '24') + 'px',
      boxSizing: 'border-box',
      transition: 'background-color 0.3s ease',
    });

    // Accessibility attributes
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', 'YouTube Channel Statistics Overlay');
    overlay.setAttribute('tabindex', '-1');

    // Responsive design for mobile
    if (window.innerWidth <= 768) {
      overlay.style.flexDirection = 'column';
      overlay.style.padding = '10px';
      overlay.style.minHeight = '200px';
    }

    const settingsButton = createSettingsButton();
    settingsButton.setAttribute('tabindex', '0');
    settingsButton.setAttribute('aria-label', 'Open settings menu');
    settingsButton.setAttribute('role', 'button');

    const settingsMenu = createSettingsMenu();
    settingsMenu.setAttribute('aria-label', 'Statistics display settings');
    settingsMenu.setAttribute('role', 'dialog');

    overlay.appendChild(settingsButton);
    overlay.appendChild(settingsMenu);

    // Enhanced event handling with keyboard support
    const toggleMenu = show => {
      settingsMenu.classList.toggle('show', show);
      settingsButton.setAttribute('aria-expanded', show);
      if (show) {
        settingsMenu.focus();
      }
    };

    settingsButton.addEventListener('click', e => {
      e.stopPropagation();
      toggleMenu(!settingsMenu.classList.contains('show'));
    });

    settingsButton.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleMenu(!settingsMenu.classList.contains('show'));
      }
    });

    // Close menu when clicking outside or pressing escape
    const documentClickHandler = e => {
      const target = /** @type {EventTarget & Node} */ (e.target);
      if (!settingsMenu.contains(target) && !settingsButton.contains(target)) {
        toggleMenu(false);
      }
    };
    const clickListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'click',
      documentClickHandler
    );
    state.documentListenerKeys.add(clickListenerKey);

    const documentKeydownHandler = e => {
      if (e.key === 'Escape' && settingsMenu.classList.contains('show')) {
        toggleMenu(false);
        settingsButton.focus();
      }
    };
    const keyListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'keydown',
      documentKeydownHandler
    );
    state.documentListenerKeys.add(keyListenerKey);

    const spinner = createSpinner();
    overlay.appendChild(spinner);

    const subscribersElement = createStatContainer(
      'subscribers',
      'M144 160c-44.2 0-80-35.8-80-80S99.8 0 144 0s80 35.8 80 80s-35.8 80-80 80zm368 0c-44.2 0-80-35.8-80-80s35.8-80 80-80s80 35.8 80 80s-35.8 80-80 80zM0 298.7C0 239.8 47.8 192 106.7 192h42.7c15.9 0 31 3.5 44.6 9.7c-1.3 7.2-1.9 14.7-1.9 22.3c0 38.2 16.8 72.5 43.3 96c-.2 0-.4 0-.7 0H21.3C9.6 320 0 310.4 0 298.7zM405.3 320c-.2 0-.4 0-.7 0c26.6-23.5 43.3-57.8 43.3-96c0-7.6-.7-15-1.9-22.3c13.6-6.3 28.7-9.7 44.6-9.7h42.7C592.2 192 640 239.8 640 298.7c0 11.8-9.6 21.3-21.3 21.3H405.3zM416 224c0 53-43 96-96 96s-96-43-96-96s43-96 96-96s96 43 96 96zM128 485.3C128 411.7 187.7 352 261.3 352H378.7C452.3 352 512 411.7 512 485.3c0 14.7-11.9 26.7-26.7 26.7H154.7c-14.7 0-26.7-11.9-26.7-26.7z'
    );
    const viewsElement = createStatContainer(
      'views',
      'M288 32c-80.8 0-145.5 36.8-192.6 80.6C48.6 156 17.3 208 2.5 243.7c-3.3 7.9-3.3 16.7 0 24.6C17.3 304 48.6 356 95.4 399.4C142.5 443.2 207.2 480 288 480s145.5-36.8 192.6-80.6c46.8-43.5 78.1-95.4 93-131.1c3.3-7.9 3.3-16.7 0-24.6c-14.9-35.7-46.2-87.7-93-131.1C433.5 68.8 368.8 32 288 32zM144 256a144 144 0 1 1 288 0 144 144 0 1 1 -288 0zm144-64c0 35.3-28.7 64-64 64c-7.1 0-13.9-1.2-20.3-3.3c-5.5-1.8-11.9 1.6-11.7 7.4c.3 6.9 1.3 13.8 3.2 20.7c13.7 51.2 66.4 81.6 117.6 67.9s81.6-66.4 67.9-117.6c-11.1-41.5-47.8-69.4-88.6-71.1c-5.8-.2-9.2 6.1-7.4 11.7c2.1 6.4 3.3 13.2 3.3 20.3z'
    );
    const videosElement = createStatContainer(
      'videos',
      'M0 128C0 92.7 28.7 64 64 64H320c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128zM559.1 99.8c10.4 5.6 16.9 16.4 16.9 28.2V384c0 11.8-6.5 22.6-16.9 28.2s-23 5-32.9-1.6l-96-64L416 337.1V320 192 174.9l14.2-9.5 96-64c9.8-6.5 22.4-7.2 32.9-1.6z'
    );

    overlay.appendChild(subscribersElement);
    overlay.appendChild(viewsElement);
    overlay.appendChild(videosElement);

    bannerElement.appendChild(overlay);
    updateDisplayState();
    return overlay;
  }

  function fetchWithGM(url, headers = {}) {
    const requestHeaders = {
      Accept: 'application/json',
      ...headers,
    };
    // Access GM_xmlhttpRequest via window to avoid TS "Cannot find name" when d.ts isn't picked up
    const gm = /** @type {any} */ (window).GM_xmlhttpRequest;
    if (typeof gm === 'function') {
      return new Promise((resolve, reject) => {
        gm({
          method: 'GET',
          url,
          headers: requestHeaders,
          timeout: 10000,
          onload: response => {
            if (response.status >= 200 && response.status < 300) {
              try {
                resolve(JSON.parse(response.responseText));
              } catch (parseError) {
                reject(new Error(`Failed to parse response: ${parseError.message}`));
              }
            } else {
              reject(new Error(`Failed to fetch: ${response.status}`));
            }
          },
          onerror: error => reject(error),
          ontimeout: () => reject(new Error('Request timed out')),
        });
      });
    }

    utils.warn('GM_xmlhttpRequest unavailable, falling back to fetch API');
    return fetch(url, {
      method: 'GET',
      headers: requestHeaders,
      credentials: 'omit',
      mode: 'cors',
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }
        return response.json();
      })
      .catch(error => {
        utils.error('Fallback fetch failed:', error);
        throw error;
      });
  }

  async function fetchChannelId(_channelName) {
    // Try meta tag first
    const metaTag = document.querySelector('meta[itemprop="channelId"]');
    if (metaTag && metaTag.content) return metaTag.content;

    // Try URL pattern
    const urlMatch = window.location.href.match(/channel\/(UC[\w-]+)/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];

    // Try ytInitialData
    const channelInfo = await getChannelInfo(window.location.href);
    if (channelInfo && channelInfo.channelId) return channelInfo.channelId;
    throw new Error('Could not determine channel ID');
  }

  async function fetchChannelStats(channelId) {
    try {
      let retries = CONFIG.MAX_RETRIES;

      while (retries > 0) {
        try {
          const stats = await fetchWithGM(`${STATS_API_URL}${channelId}`, {
            origin: 'https://livecounts.io',
            referer: 'https://livecounts.io/',
          });

          // Validate response structure
          if (!stats || typeof stats.followerCount === 'undefined') {
            throw new Error('Invalid stats response structure');
          }

          // Cache successful response
          state.lastSuccessfulStats.set(channelId, {
            ...stats,
            timestamp: Date.now(),
          });
          return stats;
        } catch (e) {
          utils.warn('Fetch attempt failed:', e.message);
          retries--;
          if (retries > 0) {
            // Exponential backoff for retries
            await new Promise(resolve =>
              setTimeout(resolve, 1000 * (CONFIG.MAX_RETRIES - retries + 1))
            );
          }
        }
      }

      // Try to use cached data if available and recent (within 5 minutes)
      if (state.lastSuccessfulStats.has(channelId)) {
        const cached = state.lastSuccessfulStats.get(channelId);
        const isRecent = Date.now() - cached.timestamp < CONFIG.CACHE_DURATION;
        if (isRecent) {
          utils.log('Using cached stats for channel:', channelId);
          return cached;
        }
      }

      // Fallback: try to extract subscriber count from page
      const fallbackStats = {
        followerCount: 0,
        bottomOdos: [0, 0],
        error: true,
        timestamp: Date.now(),
      };

      // Try multiple selectors for subscriber count
      const subCountSelectors = [
        '#subscriber-count',
        '.yt-subscription-button-subscriber-count-branded-horizontal',
        '[id*="subscriber"]',
        '.ytd-subscribe-button-renderer',
      ];

      for (const selector of subCountSelectors) {
        const subCountElem = document.querySelector(selector);
        if (subCountElem) {
          const subText = subCountElem.textContent || subCountElem.innerText || '';
          const subMatch = subText.match(/[\d,\.]+[KMB]?/);
          if (subMatch) {
            const raw = subMatch[0].replace(/,/g, '');
            // parse into number safely
            let numCount = Number(raw.replace(/[KMB]/, '')) || 0;
            if (raw.includes('K')) {
              numCount = numCount * 1000;
            } else if (raw.includes('M')) {
              numCount = numCount * 1000000;
            } else if (raw.includes('B')) {
              numCount = numCount * 1000000000;
            }
            // Ensure followerCount is a number
            fallbackStats.followerCount = Math.floor(numCount);
            utils.log('Extracted fallback subscriber count:', fallbackStats.followerCount);
            break;
          }
        }
      }

      return fallbackStats;
    } catch (error) {
      utils.error('Failed to fetch channel stats:', error);
      return {
        followerCount: 0,
        bottomOdos: [0, 0],
        error: true,
        timestamp: Date.now(),
      };
    }
  }

  function clearExistingOverlay() {
    const existingOverlay = document.querySelector('.channel-banner-overlay');
    if (existingOverlay) {
      try {
        existingOverlay.remove();
      } catch {
        console.warn('[YouTube+] Failed to remove overlay');
      }
    }
    if (state.intervalId) {
      try {
        clearInterval(state.intervalId);
        // ✅ Unregister from cleanupManager if it was registered
        YouTubeUtils.cleanupManager.unregisterInterval(state.intervalId);
      } catch {
        console.warn('[YouTube+] Failed to clear interval');
      }
      state.intervalId = null;
    }
    if (state.documentListenerKeys && state.documentListenerKeys.size) {
      state.documentListenerKeys.forEach(key => {
        try {
          YouTubeUtils.cleanupManager.unregisterListener(key);
        } catch {
          console.warn('[YouTube+] Failed to unregister listener');
        }
      });
      state.documentListenerKeys.clear();
    }
    if (state.lastSuccessfulStats) state.lastSuccessfulStats.clear();
    if (state.previousStats) state.previousStats.clear();
    state.isUpdating = false;
    state.overlay = null;
    utils.log('Cleared existing overlay');
  }

  function createDigitElement() {
    const digit = document.createElement('span');
    Object.assign(digit.style, {
      display: 'inline-block',
      width: '0.6em',
      textAlign: 'center',
      marginRight: '0.025em',
      marginLeft: '0.025em',
    });
    return digit;
  }

  function createCommaElement() {
    const comma = document.createElement('span');
    comma.textContent = ',';
    Object.assign(comma.style, {
      display: 'inline-block',
      width: '0.3em',
      textAlign: 'center',
    });
    return comma;
  }

  function createNumberContainer() {
    const container = document.createElement('div');
    Object.assign(container.style, {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      letterSpacing: '0.025em',
    });
    return container;
  }

  function updateDigits(container, newValue) {
    const newValueStr = newValue.toString();
    const digits = [];

    for (let i = newValueStr.length - 1; i >= 0; i -= 3) {
      const start = Math.max(0, i - 2);
      digits.unshift(newValueStr.slice(start, i + 1));
    }

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    for (let i = 0; i < digits.length; i++) {
      const group = digits[i];
      for (let j = 0; j < group.length; j++) {
        const digitElement = createDigitElement();
        digitElement.textContent = group[j];
        container.appendChild(digitElement);
      }
      if (i < digits.length - 1) {
        container.appendChild(createCommaElement());
      }
    }

    let elementIndex = 0;
    for (let i = 0; i < digits.length; i++) {
      const group = digits[i];
      for (let j = 0; j < group.length; j++) {
        const digitElement = container.children[elementIndex];
        const newDigit = parseInt(group[j]);
        const currentDigit = parseInt(digitElement.textContent || '0');

        if (currentDigit !== newDigit) {
          animateDigit(digitElement, currentDigit, newDigit);
        }
        elementIndex++;
      }
      if (i < digits.length - 1) {
        elementIndex++;
      }
    }
  }

  function animateDigit(element, start, end) {
    const duration = 1000;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = Math.round(start + (end - start) * easeOutQuart);
      element.textContent = current;

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  }

  function showContent(overlay) {
    const spinnerContainer = overlay.querySelector('.spinner-container');
    if (spinnerContainer) {
      spinnerContainer.remove();
    }

    const containers = overlay.querySelectorAll('div[style*="visibility: hidden"]');
    containers.forEach(container => {
      container.style.visibility = 'visible';
    });

    const icons = overlay.querySelectorAll('svg[style*="display: none"]');
    icons.forEach(icon => {
      icon.style.display = 'block';
    });
  }

  function updateDifferenceElement(element, currentValue, previousValue) {
    if (!previousValue) return;

    const difference = currentValue - previousValue;
    if (difference === 0) {
      element.textContent = '';
      return;
    }

    const sign = difference > 0 ? '+' : '';
    element.textContent = `${sign}${difference.toLocaleString()}`;
    element.style.color = difference > 0 ? '#1ed760' : '#f3727f';

    setTimeout(() => {
      element.textContent = '';
    }, 1000);
  }

  function updateDisplayState() {
    const overlay = document.querySelector('.channel-banner-overlay');
    if (!overlay) return;

    const statContainers = overlay.querySelectorAll('div[style*="width"]');
    if (!statContainers.length) return;

    let visibleCount = 0;
    const visibleContainers = [];

    statContainers.forEach(container => {
      const numberContainer = container.querySelector('[class$="-number"]');
      if (!numberContainer) return;

      const type = numberContainer.className.replace('-number', '');

      const isVisible = localStorage.getItem(`show-${type}`) !== 'false';

      if (isVisible) {
        container.style.display = 'flex';
        visibleCount++;
        visibleContainers.push(container);
      } else {
        container.style.display = 'none';
      }
    });

    visibleContainers.forEach(container => {
      container.style.width = '';
      container.style.margin = '';

      switch (visibleCount) {
        case 1:
          container.style.width = '100%';
          break;
        case 2:
          container.style.width = '50%';
          break;
        case 3:
          container.style.width = '33.33%';
          break;
        default:
          container.style.display = 'none';
      }
    });

    // Only update font size and font family for .subscribers-number, .views-number, .videos-number
    const fontSize = localStorage.getItem('youtubeEnhancerFontSize') || '24';
    const fontFamily = localStorage.getItem('youtubeEnhancerFontFamily') || 'Rubik, sans-serif';
    overlay.querySelectorAll('.subscribers-number,.views-number,.videos-number').forEach(el => {
      el.style.fontSize = `${fontSize}px`;
      el.style.fontFamily = fontFamily;
    });

    overlay.style.display = 'flex';
  }

  async function updateOverlayContent(overlay, channelName) {
    if (state.isUpdating || channelName !== state.currentChannelName) return;
    state.isUpdating = true;

    try {
      const channelId = await fetchChannelId(channelName);
      const stats = await fetchChannelStats(channelId);

      // Check if channel changed during async operations
      if (channelName !== state.currentChannelName) {
        state.isUpdating = false;
        return;
      }

      if (stats.error) {
        const containers = overlay.querySelectorAll('[class$="-number"]');
        containers.forEach(container => {
          if (container.classList.contains('subscribers-number') && stats.followerCount > 0) {
            updateDigits(container, stats.followerCount);
          } else {
            container.textContent = '---';
          }
        });
        utils.warn('Using fallback stats due to API error');
        return;
      }

      const updateElement = (className, value, label) => {
        const numberContainer = overlay.querySelector(`.${className}-number`);
        const differenceElement = overlay.querySelector(`.${className}-difference`);
        const labelElement = overlay.querySelector(`.${className}-label`);

        if (numberContainer) {
          updateDigits(numberContainer, value);
        }

        if (differenceElement && state.previousStats.has(channelId)) {
          const previousValue =
            className === 'subscribers'
              ? state.previousStats.get(channelId).followerCount
              : state.previousStats.get(channelId).bottomOdos[className === 'views' ? 0 : 1];
          updateDifferenceElement(differenceElement, value, previousValue);
        }

        if (labelElement) {
          labelElement.textContent = label;
        }
      };

      updateElement('subscribers', stats.followerCount, 'Subscribers');
      updateElement('views', stats.bottomOdos[0], 'Views');
      updateElement('videos', stats.bottomOdos[1], 'Videos');

      if (!state.previousStats.has(channelId)) {
        showContent(overlay);
        utils.log('Displayed initial stats for channel:', channelName);
      }

      state.previousStats.set(channelId, stats);
    } catch (error) {
      utils.error('Failed to update overlay content:', error);
      const containers = overlay.querySelectorAll('[class$="-number"]');
      containers.forEach(container => {
        container.textContent = '---';
      });
    } finally {
      state.isUpdating = false;
    }
  }

  // Add settings UI to experimental section
  function addSettingsUI() {
    const section = document.querySelector(
      '.ytp-plus-settings-section[data-section="experimental"]'
    );
    if (!section || section.querySelector('.count-settings-item')) return;

    const item = document.createElement('div');
    item.className = 'ytp-plus-settings-item count-settings-item';
    item.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Channel Stats</label>
          <div class="ytp-plus-settings-item-description">Show live subscriber/views/videos overlay on channel banner</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" ${state.enabled ? 'checked' : ''}>
      `;
    section.appendChild(item);

    item.querySelector('input').addEventListener('change', e => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      state.enabled = target.checked;
      localStorage.setItem(CONFIG.STORAGE_KEY, state.enabled ? 'true' : 'false');
      if (!state.enabled) {
        clearExistingOverlay();
      } else {
        observePageChanges();
        addNavigationListener();
        setTimeout(() => {
          const bannerElement = document.getElementById('page-header-banner-sizer');
          if (bannerElement && isChannelPage()) {
            addOverlay(bannerElement);
          }
        }, 100);
      }
    });
  }

  // Observe settings modal for experimental section
  const settingsObserver = new MutationObserver(mutations => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node instanceof Element && node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addSettingsUI, 100);
          return;
        }
      }
    }
    if (document.querySelector('.ytp-plus-settings-nav-item[data-section="experimental"].active')) {
      setTimeout(addSettingsUI, 50);
    }
  });
  YouTubeUtils.cleanupManager.registerObserver(settingsObserver);

  // ✅ Safe observe with document.body check
  if (document.body) {
    settingsObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      settingsObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  const experimentalNavClickHandler = e => {
    const target = /** @type {EventTarget & HTMLElement} */ (e.target);
    if (
      target.classList?.contains('ytp-plus-settings-nav-item') &&
      target.dataset?.section === 'experimental'
    ) {
      setTimeout(addSettingsUI, 50);
    }
  };

  const listenerKey = YouTubeUtils.cleanupManager.registerListener(
    document,
    'click',
    experimentalNavClickHandler,
    true
  );
  state.documentListenerKeys.add(listenerKey);

  function addOverlay(bannerElement) {
    // Improved channel name extraction with better URL parsing
    let channelName = null;
    const pathname = window.location.pathname;

    if (pathname.startsWith('/@')) {
      channelName = pathname.split('/')[1].replace('@', '');
    } else if (pathname.startsWith('/channel/')) {
      channelName = pathname.split('/')[2];
    } else if (pathname.startsWith('/c/')) {
      channelName = pathname.split('/')[2];
    } else if (pathname.startsWith('/user/')) {
      channelName = pathname.split('/')[2];
    }

    // Skip if no valid channel name or already processing the same channel
    if (!channelName || (channelName === state.currentChannelName && state.overlay)) {
      return;
    }

    // Ensure banner element is properly positioned
    if (bannerElement && !bannerElement.style.position) {
      bannerElement.style.position = 'relative';
    }

    state.currentChannelName = channelName;
    state.overlay = createOverlay(bannerElement);

    if (state.overlay) {
      // Clear existing interval
      if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
      }

      // Debounced update function for better performance
      let lastUpdateTime = 0;
      const debouncedUpdate = () => {
        const now = Date.now();
        if (now - lastUpdateTime >= state.updateInterval - 100) {
          updateOverlayContent(state.overlay, channelName);
          lastUpdateTime = now;
        }
      };

      // Set up interval with debouncing
      state.intervalId = setInterval(debouncedUpdate, state.updateInterval);

      // ✅ Register interval in cleanupManager
      YouTubeUtils.cleanupManager.registerInterval(state.intervalId);

      // Initial update
      updateOverlayContent(state.overlay, channelName);
      utils.log('Added overlay for channel:', channelName);
    }
  }

  function isChannelPage() {
    return (
      window.location.pathname.startsWith('/@') ||
      window.location.pathname.startsWith('/channel/') ||
      window.location.pathname.startsWith('/c/')
    );
  }

  function observePageChanges() {
    if (!state.enabled) return;

    // More robust banner detection with multiple fallback selectors
    const observer = new MutationObserver(_mutations => {
      // Throttle observations for better performance
      if (/** @type {any} */ (observer)._timeout) {
        YouTubeUtils.cleanupManager.unregisterTimeout(/** @type {any} */ (observer)._timeout);
        clearTimeout(/** @type {any} */ (observer)._timeout);
      }

      /** @type {any} */ (observer)._timeout = YouTubeUtils.cleanupManager.registerTimeout(
        setTimeout(() => {
          let bannerElement = document.getElementById('page-header-banner-sizer');

          // Try alternative selectors if main one fails
          if (!bannerElement) {
            const alternatives = [
              '[id*="banner"]',
              '.ytd-c4-tabbed-header-renderer',
              '#channel-header',
              '.channel-header',
            ];

            for (const selector of alternatives) {
              bannerElement = document.querySelector(selector);
              if (bannerElement) break;
            }
          }

          if (bannerElement && isChannelPage()) {
            // Ensure banner has proper positioning
            if (bannerElement.style.position !== 'relative') {
              bannerElement.style.position = 'relative';
            }
            addOverlay(bannerElement);
          } else if (!isChannelPage()) {
            // Clean up when not on channel page
            clearExistingOverlay();
            state.currentChannelName = null;
          }
        }, 100)
      ); // Small delay to batch rapid changes
    });

    // ✅ Safe observe with document.body check
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false, // Reduce observation scope for performance
      });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: false,
        });
      });
    }

    // Store timeout reference for cleanup
    /** @type {any} */ (observer)._timeout = null;

    // Store observer for cleanup on page unload
    if (typeof state.observers === 'undefined') {
      state.observers = [];
    }
    state.observers.push(observer);

    return observer;
  }

  function addNavigationListener() {
    if (!state.enabled) return;

    window.addEventListener('yt-navigate-finish', () => {
      if (!isChannelPage()) {
        clearExistingOverlay();
        state.currentChannelName = null;
        utils.log('Navigated away from channel page');
      } else {
        const bannerElement = document.getElementById('page-header-banner-sizer');
        if (bannerElement) {
          addOverlay(bannerElement);
          utils.log('Navigated to channel page');
        }
      }
    });
  }

  // Cleanup function for page unload
  function cleanup() {
    // Disconnect all observers
    if (state.observers && Array.isArray(state.observers)) {
      state.observers.forEach(observer => {
        try {
          observer.disconnect();
        } catch (e) {
          console.warn('[YouTube+] Failed to disconnect observer:', e);
        }
      });
      state.observers = [];
    }

    // Clear overlay and intervals
    clearExistingOverlay();

    utils.log('Cleanup completed');
  }

  // Register cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

  init();
})();
