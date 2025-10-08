// Stats button and menu
(function () {
  'use strict';

  // Glassmorphism styles for stats button and menu
  const styles = `
            .videoStats{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-left:8px;background:rgba(255,255,255,0.15);box-shadow:0 8px 32px rgba(0,0,0,.18);backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);border:1px solid rgba(255,255,255,.18);transition:background .2s}
            html[dark] .videoStats{background:rgba(34,34,34,0.7);border:1px solid rgba(255,255,255,.18)}html:not([dark]) .videoStats{background:rgba(255,255,255,0.15);border:1px solid rgba(0,0,0,.08)}.videoStats:hover{background:rgba(255,255,255,0.22)}.videoStats svg{width:18px;height:18px;fill:var(--yt-spec-text-primary,#030303)}html[dark] .videoStats svg{fill:#fff}html:not([dark]) .videoStats svg{fill:#222}.shortsStats{display:flex;align-items:center;justify-content:center;margin-top:16px;margin-bottom:16px;width:48px;height:48px;border-radius:50%;cursor:pointer;background:rgba(255,255,255,0.15);box-shadow:0 8px 32px rgba(0,0,0,.18);backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);border:1px solid rgba(255,255,255,.18);transition:background .3s}html[dark] .shortsStats{background:rgba(34,34,34,0.7);border:1px solid rgba(255,255,255,.18)}html:not([dark]) .shortsStats{background:rgba(255,255,255,0.15);border:1px solid rgba(0,0,0,.08)}
            .shortsStats:hover{background:rgba(255,255,255,0.22)}.shortsStats svg{width:24px;height:24px;fill:#222}html[dark] .shortsStats svg{fill:#fff}html:not([dark]) .shortsStats svg{fill:#222}.stats-menu-container{position:relative;display:inline-block}.stats-horizontal-menu{position:absolute;display:flex;left:100%;top:0;height:100%;visibility:hidden;opacity:0;transition:visibility 0s,opacity 0.2s linear;z-index:100}.stats-menu-container:hover .stats-horizontal-menu{visibility:visible;opacity:1}.stats-menu-button{margin-left:8px;white-space:nowrap}.stats-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeInModal 0.2s;backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%)}.stats-modal-content{background:rgba(34,34,34,0.95);border-radius:18px;box-shadow:0 8px 32px rgba(0,0,0,.2);max-width:75vw;max-height:90vh;overflow:auto;position:relative;padding:24px 0 0 0;display:flex;flex-direction:column;align-items:center;animation:scaleInModal 0.2s;border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%)}html[dark] .stats-modal-content{background:rgba(34,34,34,0.95)}html:not([dark]) .stats-modal-content{background:#fff;color:#222}.stats-modal-close{position:absolute;top:12px;right:18px;background:transparent;color:#fff;border:none;font-size:28px;line-height:1;width:36px;height:36px;cursor:pointer;transition:background 0.2s;z-index:2;display:flex;align-items:center;justify-content:center}.stats-modal-close:hover{color:#ff4444;transform:rotate(90deg) scale(1.25)}.stats-modal-iframe{width:72vw;height:70vh;box-shadow:0 8px 32px rgba(0,0,0,.2);background:#222;border:1px solid rgba(255,255,255,.2)}.stats-modal-title{font-size:18px;font-weight:600;color:#fff;margin-bottom:10px;text-align:center;text-shadow:0 2px 8px rgba(0,0,0,0.15)}html:not([dark]) .stats-modal-title{color:#222}@keyframes fadeInModal{from{opacity:0}to{opacity:1}}@keyframes scaleInModal{from{transform:scale(0.95)}to{transform:scale(1)}}
        `;

  // Settings state
  const SETTINGS_KEY = 'youtube_stats_button_enabled';
  let statsButtonEnabled = localStorage.getItem(SETTINGS_KEY) !== 'false';

  let previousUrl = location.href;
  let isChecking = false;
  let experimentalNavListenerKey = null;
  let channelFeatures = {
    hasStreams: false,
    hasShorts: false,
  };

  function addStyles() {
    if (!document.querySelector('#youtube-enhancer-styles')) {
      // ✅ Use StyleManager instead of createElement('style')
      YouTubeUtils.StyleManager.add('youtube-enhancer-styles', styles);
    }
  }

  function getCurrentVideoUrl() {
    const url = window.location.href;
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');

    if (videoId) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }

    const shortsMatch = url.match(/\/shorts\/([^?]+)/);
    if (shortsMatch) {
      return `https://www.youtube.com/shorts/${shortsMatch[1]}`;
    }

    return null;
  }

  function getChannelIdentifier() {
    const url = window.location.href;
    let identifier = '';

    if (url.includes('/channel/')) {
      identifier = url.split('/channel/')[1].split('/')[0];
    } else if (url.includes('/@')) {
      identifier = url.split('/@')[1].split('/')[0];
    }

    return identifier;
  }

  async function checkChannelTabs(url) {
    if (isChecking) return;
    isChecking = true;

    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        isChecking = false;
        return;
      }

      const html = await response.text();
      const match = html.match(/var ytInitialData = (.+?);<\/script>/);

      if (!match || !match[1]) {
        isChecking = false;
        return;
      }

      const data = JSON.parse(match[1]);
      const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];

      let hasStreams = false;
      let hasShorts = false;

      tabs.forEach((tab) => {
        const tabUrl = tab?.tabRenderer?.endpoint?.commandMetadata?.webCommandMetadata?.url;
        if (tabUrl) {
          if (/\/streams$/.test(tabUrl)) hasStreams = true;
          if (/\/shorts$/.test(tabUrl)) hasShorts = true;
        }
      });

      channelFeatures = {
        hasStreams: hasStreams,
        hasShorts: hasShorts,
      };

      const existingMenu = document.querySelector('.stats-menu-container');
      if (existingMenu) {
        existingMenu.remove();
        createStatsMenu();
      }
    } catch (e) {
    } finally {
      isChecking = false;
    }
  }

  function isChannelPage(url) {
    return (
      url.includes('youtube.com/') &&
      (url.includes('/channel/') || url.includes('/@')) &&
      !url.includes('/video/') &&
      !url.includes('/watch')
    );
  }

  function checkUrlChange() {
    const currentUrl = location.href;
    if (currentUrl !== previousUrl) {
      previousUrl = currentUrl;
      if (isChannelPage(currentUrl)) {
        setTimeout(() => checkChannelTabs(currentUrl), 500);
      }
    }
  }

  function createStatsIcon(isShorts = false) {
    const icon = document.createElement('div');
    icon.className = isShorts ? 'shortsStats' : 'videoStats';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M500 89c13.8-11 16-31.2 5-45s-31.2-16-45-5L319.4 151.5 211.2 70.4c-11.7-8.8-27.8-8.5-39.2 .6L12 199c-13.8 11-16 31.2-5 45s31.2 16 45 5L192.6 136.5l108.2 81.1c11.7 8.8 27.8 8.5 39.2-.6L500 89zM160 256l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32zM32 352l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32zm288-64c-17.7 0-32 14.3-32 32l0 128c0 17.7 14.3 32 32 32s32-14.3 32-32l0-128c0-17.7-14.3-32-32-32zm96-32l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32z'
    );

    svg.appendChild(path);
    icon.appendChild(svg);

    icon.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const videoUrl = getCurrentVideoUrl();
      if (videoUrl) {
        openStatsModal(
          `https://stats.afkarxyz.fun/?directVideo=${encodeURIComponent(videoUrl)}`,
          'Video Stats'
        );
      }
    });

    return icon;
  }

  function insertIconForRegularVideo() {
    if (!statsButtonEnabled) return;
    const targetSelector = '#owner';
    const target = document.querySelector(targetSelector);

    if (target && !document.querySelector('.videoStats')) {
      const statsIcon = createStatsIcon();
      target.appendChild(statsIcon);
    }
  }

  function insertIconForShorts() {
    if (!statsButtonEnabled) return false;
    const likeButtonContainer = document.querySelector(
      'ytd-reel-video-renderer[is-active] #like-button'
    );

    if (likeButtonContainer && !document.querySelector('.shortsStats')) {
      const iconDiv = createStatsIcon(true);
      likeButtonContainer.parentNode.insertBefore(iconDiv, likeButtonContainer);
      return true;
    }
    return false;
  }

  function createButton(text, svgPath, viewBox, className, onClick) {
    const buttonViewModel = document.createElement('button-view-model');
    buttonViewModel.className = `yt-spec-button-view-model ${className}-view-model`;

    const button = document.createElement('button');
    button.className = `yt-spec-button-shape-next yt-spec-button-shape-next--outline yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--enable-backdrop-filter-experiment ${className}-button`;
    button.setAttribute('aria-disabled', 'false');
    button.setAttribute('aria-label', text);
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.gap = '8px';

    button.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.style.width = '20px';
    svg.style.height = '20px';
    svg.style.fill = 'currentColor';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', svgPath);
    svg.appendChild(path);

    const buttonText = document.createElement('div');
    buttonText.className = `yt-spec-button-shape-next__button-text-content ${className}-text`;
    buttonText.textContent = text;
    buttonText.style.display = 'flex';
    buttonText.style.alignItems = 'center';

    const touchFeedback = document.createElement('yt-touch-feedback-shape');
    touchFeedback.style.borderRadius = 'inherit';

    const touchFeedbackDiv = document.createElement('div');
    touchFeedbackDiv.className =
      'yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--touch-response';
    touchFeedbackDiv.setAttribute('aria-hidden', 'true');

    const strokeDiv = document.createElement('div');
    strokeDiv.className = 'yt-spec-touch-feedback-shape__stroke';

    const fillDiv = document.createElement('div');
    fillDiv.className = 'yt-spec-touch-feedback-shape__fill';

    touchFeedbackDiv.appendChild(strokeDiv);
    touchFeedbackDiv.appendChild(fillDiv);
    touchFeedback.appendChild(touchFeedbackDiv);

    button.appendChild(svg);
    button.appendChild(buttonText);
    button.appendChild(touchFeedback);
    buttonViewModel.appendChild(button);

    return buttonViewModel;
  }

  function openStatsModal(url, titleText) {
    document.querySelectorAll('.stats-modal-overlay').forEach((m) => m.remove());

    const overlay = document.createElement('div');
    overlay.className = 'stats-modal-overlay';

    const content = document.createElement('div');
    content.className = 'stats-modal-content';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'stats-modal-close';
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
      </svg>
    `;
    closeBtn.title = 'Close';
    closeBtn.onclick = () => overlay.remove();

    const title = document.createElement('div');
    title.className = 'stats-modal-title';
    title.textContent = titleText || 'Stats';

    const iframe = document.createElement('iframe');
    iframe.className = 'stats-modal-iframe';
    iframe.src = url;
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    iframe.style.background = '#222';

    content.append(closeBtn, title, iframe);
    overlay.appendChild(content);

    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    document.addEventListener(
      'keydown',
      function escHandler(e) {
        if (e.key === 'Escape') {
          overlay.remove();
          document.removeEventListener('keydown', escHandler, true);
        }
      },
      true
    );

    document.body.appendChild(overlay);
  }

  function createStatsMenu() {
    if (!statsButtonEnabled) return;
    if (document.querySelector('.stats-menu-container')) {
      return;
    }

    const containerDiv = document.createElement('div');
    containerDiv.className = 'yt-flexible-actions-view-model-wiz__action stats-menu-container';

    const mainButtonViewModel = document.createElement('button-view-model');
    mainButtonViewModel.className = 'yt-spec-button-view-model main-stats-view-model';

    const mainButton = document.createElement('button');
    mainButton.className =
      'yt-spec-button-shape-next yt-spec-button-shape-next--outline yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--enable-backdrop-filter-experiment main-stats-button';
    mainButton.setAttribute('aria-disabled', 'false');
    mainButton.setAttribute('aria-label', 'Stats');
    mainButton.style.display = 'flex';
    mainButton.style.alignItems = 'center';
    mainButton.style.justifyContent = 'center';
    mainButton.style.gap = '8px';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.style.width = '20px';
    svg.style.height = '20px';
    svg.style.fill = 'currentColor';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M500 89c13.8-11 16-31.2 5-45s-31.2-16-45-5L319.4 151.5 211.2 70.4c-11.7-8.8-27.8-8.5-39.2 .6L12 199c-13.8 11-16 31.2-5 45s31.2 16 45 5L192.6 136.5l108.2 81.1c11.7 8.8 27.8 8.5 39.2-.6L500 89zM160 256l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32zM32 352l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32zm288-64c-17.7 0-32 14.3-32 32l0 128c0 17.7 14.3 32 32 32s32-14.3 32-32l0-128c0-17.7-14.3-32-32-32zm96-32l0 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-192c0-17.7-14.3-32-32-32s-32 14.3-32 32z'
    );
    svg.appendChild(path);

    const buttonText = document.createElement('div');
    buttonText.className = 'yt-spec-button-shape-next__button-text-content main-stats-text';
    buttonText.textContent = 'Stats';
    buttonText.style.display = 'flex';
    buttonText.style.alignItems = 'center';

    const touchFeedback = document.createElement('yt-touch-feedback-shape');
    touchFeedback.style.borderRadius = 'inherit';

    const touchFeedbackDiv = document.createElement('div');
    touchFeedbackDiv.className =
      'yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--touch-response';
    touchFeedbackDiv.setAttribute('aria-hidden', 'true');

    const strokeDiv = document.createElement('div');
    strokeDiv.className = 'yt-spec-touch-feedback-shape__stroke';

    const fillDiv = document.createElement('div');
    fillDiv.className = 'yt-spec-touch-feedback-shape__fill';

    touchFeedbackDiv.appendChild(strokeDiv);
    touchFeedbackDiv.appendChild(fillDiv);
    touchFeedback.appendChild(touchFeedbackDiv);

    mainButton.appendChild(svg);
    mainButton.appendChild(buttonText);
    mainButton.appendChild(touchFeedback);
    mainButtonViewModel.appendChild(mainButton);
    containerDiv.appendChild(mainButtonViewModel);

    const horizontalMenu = document.createElement('div');
    horizontalMenu.className = 'stats-horizontal-menu';

    const channelButtonContainer = document.createElement('div');
    channelButtonContainer.className = 'stats-menu-button channel-stats-container';

    const channelButton = createButton(
      'Channel',
      'M64 48c-8.8 0-16 7.2-16 16l0 288c0 8.8 7.2 16 16 16l512 0c8.8 0 16-7.2 16-16l0-288c0-8.8-7.2-16-16-16L64 48zM0 64C0 28.7 28.7 0 64 0L576 0c35.3 0 64 28.7 64 64l0 288c0 35.3-28.7 64-64 64L64 416c-35.3 0-64-28.7-64-64L0 64zM120 464l400 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-400 0c-13.3 0-24-10.7-24-24s10.7-24 24-24z',
      '0 0 640 512',
      'channel-stats',
      () => {
        const channelId = getChannelIdentifier();
        if (channelId) {
          openStatsModal(`https://stats.afkarxyz.fun/?directChannel=${channelId}`, 'Channel Stats');
        }
      }
    );

    channelButtonContainer.appendChild(channelButton);
    horizontalMenu.appendChild(channelButtonContainer);

    if (channelFeatures.hasStreams) {
      const liveButtonContainer = document.createElement('div');
      liveButtonContainer.className = 'stats-menu-button live-stats-container';

      const liveButton = createButton(
        'Live',
        'M99.8 69.4c10.2 8.4 11.6 23.6 3.2 33.8C68.6 144.7 48 197.9 48 256s20.6 111.3 55 152.8c8.4 10.2 7 25.3-3.2 33.8s-25.3 7-33.8-3.2C24.8 389.6 0 325.7 0 256S24.8 122.4 66 72.6c8.4-10.2 23.6-11.6 33.8-3.2zm376.5 0c10.2-8.4 25.3-7 33.8 3.2c41.2 49.8 66 113.8 66 183.4s-24.8 133.6-66 183.4c-8.4 10.2-23.6 11.6-33.8 3.2s-11.6-23.6-3.2-33.8c34.3-41.5 55-94.7 55-152.8s-20.6-111.3-55-152.8c-8.4-10.2-7-25.3 3.2-33.8zM248 256a40 40 0 1 1 80 0 40 40 0 1 1 -80 0zm-61.1-78.5C170 199.2 160 226.4 160 256s10 56.8 26.9 78.5c8.1 10.5 6.3 25.5-4.2 33.7s-25.5 6.3-33.7-4.2c-23.2-29.8-37-67.3-37-108s13.8-78.2 37-108c8.1-10.5 23.2-12.3 33.7-4.2s12.3 23.2 4.2 33.7zM427 148c23.2 29.8 37 67.3 37 108s-13.8 78.2-37 108c-8.1 10.5-23.2 12.3-33.7 4.2s-12.3-23.2-4.2-33.7C406 312.8 416 285.6 416 256s-10-56.8-26.9-78.5c-8.1-10.5-6.3-25.5 4.2-33.7s25.5-6.3 33.7 4.2z',
        '0 0 576 512',
        'live-stats',
        () => {
          const channelId = getChannelIdentifier();
          if (channelId) {
            openStatsModal(`https://stats.afkarxyz.fun/?directStream=${channelId}`, 'Live Stats');
          }
        }
      );

      liveButtonContainer.appendChild(liveButton);
      horizontalMenu.appendChild(liveButtonContainer);
    }

    if (channelFeatures.hasShorts) {
      const shortsButtonContainer = document.createElement('div');
      shortsButtonContainer.className = 'stats-menu-button shorts-stats-container';

      const shortsButton = createButton(
        'Shorts',
        'M80 48c-8.8 0-16 7.2-16 16l0 384c0 8.8 7.2 16 16 16l224 0c8.8 0 16-7.2 16-16l0-384c0-8.8-7.2-16-16-16L80 48zM16 64C16 28.7 44.7 0 80 0L304 0c35.3 0 64 28.7 64 64l0 384c0 35.3-28.7 64-64 64L80 512c-35.3 0-64-28.7-64-64L16 64zM160 400l64 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-64 0c-8.8 0-16-7.2-16-16s7.2-16 16-16z',
        '0 0 384 512',
        'shorts-stats',
        () => {
          const channelId = getChannelIdentifier();
          if (channelId) {
            openStatsModal(`https://stats.afkarxyz.fun/?directShorts=${channelId}`, 'Shorts Stats');
          }
        }
      );

      shortsButtonContainer.appendChild(shortsButton);
      horizontalMenu.appendChild(shortsButtonContainer);
    }

    containerDiv.appendChild(horizontalMenu);

    const joinButton = document.querySelector(
      '.yt-flexible-actions-view-model-wiz__action:not(.stats-menu-container)'
    );
    if (joinButton) {
      joinButton.parentNode.appendChild(containerDiv);
    } else {
      const buttonContainer = document.querySelector('#subscribe-button + #buttons');
      if (buttonContainer) {
        buttonContainer.appendChild(containerDiv);
      }
    }

    return containerDiv;
  }

  function checkAndAddMenu() {
    if (!statsButtonEnabled) return;
    const joinButton = document.querySelector(
      '.yt-flexible-actions-view-model-wiz__action:not(.stats-menu-container)'
    );
    const statsMenu = document.querySelector('.stats-menu-container');

    if (joinButton && !statsMenu) {
      createStatsMenu();
    }
  }

  function checkAndInsertIcon() {
    if (!statsButtonEnabled) return;
    const isShorts = window.location.pathname.includes('/shorts/');
    if (isShorts) {
      const shortsObserver = new MutationObserver((_mutations, observer) => {
        if (insertIconForShorts()) {
          observer.disconnect();
        }
      });

      // ✅ Register observer in cleanupManager
      YouTubeUtils.cleanupManager.registerObserver(shortsObserver);

      const shortsContainer = document.querySelector('ytd-shorts');
      if (shortsContainer) {
        shortsObserver.observe(shortsContainer, {
          childList: true,
          subtree: true,
        });
        insertIconForShorts();
      }
    } else if (getCurrentVideoUrl()) {
      insertIconForRegularVideo();
    }
  }

  function addSettingsUI() {
    const section = document.querySelector(
      '.ytp-plus-settings-section[data-section="experimental"]'
    );
    if (!section || section.querySelector('.stats-button-settings-item')) return;

    const item = document.createElement('div');
    item.className = 'ytp-plus-settings-item stats-button-settings-item';
    item.innerHTML = `
        <div>
          <label class="ytp-plus-settings-item-label">Statistics Button</label>
          <div class="ytp-plus-settings-item-description">Show statistics button on videos and channel menu for quick access to statistics</div>
        </div>
        <input type="checkbox" class="ytp-plus-settings-checkbox" ${statsButtonEnabled ? 'checked' : ''}>
      `;
    section.appendChild(item);

    item.querySelector('input').addEventListener('change', (e) => {
      statsButtonEnabled = e.target.checked;
      localStorage.setItem(SETTINGS_KEY, statsButtonEnabled ? 'true' : 'false');
      // Remove all stats buttons and menus
      document
        .querySelectorAll('.videoStats,.shortsStats,.stats-menu-container')
        .forEach((el) => el.remove());
      if (statsButtonEnabled) {
        checkAndInsertIcon();
        checkAndAddMenu();
      }
    });
  }

  // Observe settings modal for experimental section
  const settingsObserver = new MutationObserver((mutations) => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.classList?.contains('ytp-plus-settings-modal')) {
          setTimeout(addSettingsUI, 50);
        }
      }
    }
    if (document.querySelector('.ytp-plus-settings-nav-item[data-section="experimental"].active')) {
      setTimeout(addSettingsUI, 50);
    }
  });

  // ✅ Register observer in cleanupManager
  YouTubeUtils.cleanupManager.registerObserver(settingsObserver);
  settingsObserver.observe(document.body, { childList: true, subtree: true });

  const handleExperimentalNavClick = (e) => {
    if (
      e.target.classList?.contains('ytp-plus-settings-nav-item') &&
      e.target.dataset.section === 'experimental'
    ) {
      setTimeout(addSettingsUI, 50);
    }
  };

  if (!experimentalNavListenerKey) {
    experimentalNavListenerKey = YouTubeUtils.cleanupManager.registerListener(
      document,
      'click',
      handleExperimentalNavClick,
      true
    );
  }

  function init() {
    addStyles();
    if (statsButtonEnabled) {
      checkAndInsertIcon();
      checkAndAddMenu();
    }

    history.pushState = (function (f) {
      return function () {
        const result = f.apply(this, arguments);
        checkUrlChange();
        return result;
      };
    })(history.pushState);

    history.replaceState = (function (f) {
      return function () {
        const result = f.apply(this, arguments);
        checkUrlChange();
        return result;
      };
    })(history.replaceState);

    window.addEventListener('popstate', checkUrlChange);

    if (isChannelPage(location.href)) {
      checkChannelTabs(location.href);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      if (mutation.type === 'childList') {
        if (statsButtonEnabled) {
          checkAndInsertIcon();
          checkAndAddMenu();
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('yt-navigate-finish', () => {
    if (statsButtonEnabled) {
      checkAndInsertIcon();
      checkAndAddMenu();
      if (isChannelPage(location.href)) {
        checkChannelTabs(location.href);
      }
    }
  });

  document.addEventListener('yt-action', function (event) {
    if (event.detail && event.detail.actionName === 'yt-reload-continuation-items-command') {
      if (statsButtonEnabled) {
        checkAndInsertIcon();
        checkAndAddMenu();
      }
    }
  });
})();
