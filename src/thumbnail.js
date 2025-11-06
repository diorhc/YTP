(function () {
  'use strict';

  // Internationalization
  const i18n = {
    en: {
      close: 'Close',
      thumbnailPreview: 'Thumbnail Preview',
      clickToOpen: 'Click to open in new tab',
      download: 'Download',
    },
    ru: {
      close: 'Закрыть',
      thumbnailPreview: 'Предпросмотр миниатюры',
      clickToOpen: 'Нажмите, чтобы открыть в новой вкладке',
      download: 'Скачать',
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

  /**
   * Extract video ID from thumbnail source with validation
   * @param {string} thumbnailSrc - Thumbnail source URL
   * @returns {string|null} Video ID or null if invalid
   */
  function extractVideoId(thumbnailSrc) {
    try {
      if (!thumbnailSrc || typeof thumbnailSrc !== 'string') return null;
      const match = thumbnailSrc.match(/\/vi\/([^\/]+)\//);
      const videoId = match ? match[1] : null;
      // Validate video ID format (11 characters, alphanumeric + - and _)
      if (videoId && !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        console.warn('[Thumbnail] Invalid video ID format:', videoId);
        return null;
      }
      return videoId;
    } catch (error) {
      console.error('[Thumbnail] Error extracting video ID:', error);
      return null;
    }
  }

  /**
   * Extract shorts ID from URL with validation
   * @param {string} href - URL to extract shorts ID from
   * @returns {string|null} Shorts ID or null if invalid
   */
  function extractShortsId(href) {
    try {
      if (!href || typeof href !== 'string') return null;
      const match = href.match(/\/shorts\/([^\/\?]+)/);
      const shortsId = match ? match[1] : null;
      // Validate shorts ID format (11 characters, alphanumeric + - and _)
      if (shortsId && !/^[a-zA-Z0-9_-]{11}$/.test(shortsId)) {
        console.warn('[Thumbnail] Invalid shorts ID format:', shortsId);
        return null;
      }
      return shortsId;
    } catch (error) {
      console.error('[Thumbnail] Error extracting shorts ID:', error);
      return null;
    }
  }

  /**
   * Check if image exists with timeout and error handling
   * @param {string} url - Image URL to check
   * @returns {Promise<boolean>} True if image exists and is accessible
   */
  async function checkImageExists(url) {
    try {
      // Validate URL
      if (!url || typeof url !== 'string') {
        console.warn('[Thumbnail] Invalid URL provided');
        return false;
      }

      // Validate URL format and protocol
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
        // Only allow https protocol for security
        if (parsedUrl.protocol !== 'https:') {
          console.warn('[Thumbnail] Only HTTPS URLs are allowed');
          return false;
        }
        // Validate domain (only allow YouTube image domains)
        if (
          !parsedUrl.hostname.endsWith('ytimg.com') &&
          !parsedUrl.hostname.endsWith('youtube.com')
        ) {
          console.warn('[Thumbnail] Only YouTube image domains are allowed');
          return false;
        }
      } catch (error) {
        console.error('[Thumbnail] Invalid URL:', error);
        return false;
      }

      // Try HEAD request first with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      try {
        const corsTest = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
        }).catch(() => null);

        clearTimeout(timeoutId);

        if (corsTest) {
          return corsTest.ok;
        } else {
          return true; // Fallback if HEAD request fails
        }
      } catch {
        clearTimeout(timeoutId);

        // Fallback to image load test
        return new Promise(resolve => {
          const img = document.createElement('img');
          img.style.display = 'none';

          const timeout = setTimeout(() => {
            if (img.parentNode) {
              document.body.removeChild(img);
            }
            resolve(false);
          }, 3000); // 3 second timeout for image load

          img.onload = () => {
            clearTimeout(timeout);
            if (img.parentNode) {
              document.body.removeChild(img);
            }
            resolve(true);
          };

          img.onerror = () => {
            clearTimeout(timeout);
            if (img.parentNode) {
              document.body.removeChild(img);
            }
            resolve(false);
          };

          document.body.appendChild(img);
          img.src = url;
        });
      }
    } catch (error) {
      console.error('[Thumbnail] Error checking image:', error);
      return false;
    }
  }

  function createSpinner() {
    const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spinner.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    spinner.setAttribute('width', '16');
    spinner.setAttribute('height', '16');
    spinner.setAttribute('viewBox', '0 0 24 24');
    spinner.setAttribute('fill', 'none');
    spinner.setAttribute('stroke', 'white');
    spinner.setAttribute('stroke-width', '2');
    spinner.setAttribute('stroke-linecap', 'round');
    spinner.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M21 12a9 9 0 1 1-6.219-8.56');
    spinner.appendChild(path);

    spinner.style.animation = 'spin 1s linear infinite';

    if (!document.querySelector('#spinner-keyframes')) {
      const style = document.createElement('style');
      style.id = 'spinner-keyframes';
      style.textContent = `
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
      (document.head || document.documentElement).appendChild(style);
    }

    return spinner;
  }

  /**
   * Open thumbnail in modal with error handling
   * @param {string} videoId - YouTube video ID
   * @param {boolean} isShorts - Whether this is a Shorts video
   * @param {HTMLElement} overlayElement - Overlay element containing the button
   * @returns {Promise<void>}
   */
  async function openThumbnail(videoId, isShorts, overlayElement) {
    try {
      // Validate inputs
      if (!videoId || typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        console.error('[Thumbnail] Invalid video ID:', videoId);
        return;
      }

      if (!overlayElement || !(overlayElement instanceof HTMLElement)) {
        console.error('[Thumbnail] Invalid overlay element');
        return;
      }

      const originalSvg = overlayElement.querySelector('svg');
      if (!originalSvg) {
        console.warn('[Thumbnail] No SVG found in overlay element');
        return;
      }

      const spinner = createSpinner();
      overlayElement.replaceChild(spinner, originalSvg);

      try {
        if (isShorts) {
          const oardefaultUrl = `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`;
          const isOarDefaultAvailable = await checkImageExists(oardefaultUrl);

          if (isOarDefaultAvailable) {
            showImageModal(oardefaultUrl);
          } else {
            showImageModal(`https://i.ytimg.com/vi/${videoId}/oar2.jpg`);
          }
        } else {
          const maxresdefaultUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
          const isMaxResAvailable = await checkImageExists(maxresdefaultUrl);

          if (isMaxResAvailable) {
            showImageModal(maxresdefaultUrl);
          } else {
            showImageModal(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
          }
        }
      } finally {
        // Restore original svg
        try {
          if (spinner && spinner.parentNode) {
            overlayElement.replaceChild(originalSvg, spinner);
          }
        } catch (restoreError) {
          console.error('[Thumbnail] Error restoring original SVG:', restoreError);
          // Fallback: remove spinner if original not found
          if (spinner && spinner.parentNode) {
            spinner.parentNode.removeChild(spinner);
          }
        }
      }
    } catch (error) {
      console.error('[Thumbnail] Error opening thumbnail:', error);
    }
  }

  // Inject CSS styles via StyleManager (if available) to match base theme
  (function addThumbnailStyles() {
    try {
      const css = `
    :root { --thumbnail-btn-bg-light: rgba(255, 255, 255, 0.85); --thumbnail-btn-bg-dark: rgba(0, 0, 0, 0.7); --thumbnail-btn-hover-bg-light: rgba(255, 255, 255, 1); --thumbnail-btn-hover-bg-dark: rgba(0, 0, 0, 0.9); --thumbnail-btn-color-light: #222; --thumbnail-btn-color-dark: #fff; --thumbnail-modal-bg-light: rgba(255, 255, 255, 0.95); --thumbnail-modal-bg-dark: rgba(34, 34, 34, 0.85); --thumbnail-modal-title-light: #222; --thumbnail-modal-title-dark: #fff; --thumbnail-modal-btn-bg-light: rgba(0, 0, 0, 0.08); --thumbnail-modal-btn-bg-dark: rgba(255, 255, 255, 0.08); --thumbnail-modal-btn-hover-bg-light: rgba(0, 0, 0, 0.18); --thumbnail-modal-btn-hover-bg-dark: rgba(255, 255, 255, 0.18); --thumbnail-modal-btn-color-light: #222; --thumbnail-modal-btn-color-dark: #fff; --thumbnail-modal-btn-hover-color-light: #ff4444; --thumbnail-modal-btn-hover-color-dark: #ff4444; --thumbnail-glass-blur: blur(18px) saturate(180%); --thumbnail-glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); --thumbnail-glass-border: rgba(255, 255, 255, 0.2); }
    html[dark], body[dark] { --thumbnail-btn-bg: var(--thumbnail-btn-bg-dark); --thumbnail-btn-hover-bg: var(--thumbnail-btn-hover-bg-dark); --thumbnail-btn-color: var(--thumbnail-btn-color-dark); --thumbnail-modal-bg: var(--thumbnail-modal-bg-dark); --thumbnail-modal-title: var(--thumbnail-modal-title-dark); --thumbnail-modal-btn-bg: var(--thumbnail-modal-btn-bg-dark); --thumbnail-modal-btn-hover-bg: var(--thumbnail-modal-btn-hover-bg-dark); --thumbnail-modal-btn-color: var(--thumbnail-modal-btn-color-dark); --thumbnail-modal-btn-hover-color: var(--thumbnail-modal-btn-hover-color-dark); }
    html:not([dark]) { --thumbnail-btn-bg: var(--thumbnail-btn-bg-light); --thumbnail-btn-bg: var(--thumbnail-btn-bg-light); --thumbnail-btn-hover-bg: var(--thumbnail-btn-hover-bg-light); --thumbnail-btn-color: var(--thumbnail-btn-color-light); --thumbnail-modal-bg: var(--thumbnail-modal-bg-light); --thumbnail-modal-title: var(--thumbnail-modal-title-light); --thumbnail-modal-btn-bg: var(--thumbnail-modal-btn-bg-light); --thumbnail-modal-btn-hover-bg: var(--thumbnail-modal-btn-hover-bg-light); --thumbnail-modal-btn-color: var(--thumbnail-modal-btn-color-light); --thumbnail-modal-btn-hover-color: var(--thumbnail-modal-btn-hover-color-light); }
    .thumbnail-overlay-container { position: absolute; bottom: 8px; left: 8px; z-index: 9999; opacity: 0; transition: opacity 0.2s ease; }
    .thumbnail-overlay-button { width: 28px; height: 28px; background: var(--thumbnail-btn-bg); border: none; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--thumbnail-btn-color); position: relative; box-shadow: var(--thumbnail-glass-shadow); backdrop-filter: var(--thumbnail-glass-blur); -webkit-backdrop-filter: var(--thumbnail-glass-blur); border: 1px solid var(--thumbnail-glass-border); }
    .thumbnail-overlay-button:hover { background: var(--thumbnail-btn-hover-bg); }
    .thumbnail-dropdown { position: absolute; bottom: 100%; left: 0; background: var(--thumbnail-btn-hover-bg); border-radius: 8px; padding: 4px; margin-bottom: 4px; display: none; flex-direction: column; min-width: 140px; box-shadow: var(--thumbnail-glass-shadow); z-index: 10000; backdrop-filter: var(--thumbnail-glass-blur); -webkit-backdrop-filter: var(--thumbnail-glass-blur); border: 1px solid var(--thumbnail-glass-border); }
    .thumbnail-dropdown.show { display: flex !important; }
    .thumbnail-dropdown-item { background: none; border: none; color: var(--thumbnail-btn-color); padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 12px; text-align: left; white-space: nowrap; transition: background-color 0.2s ease; }
    .thumbnail-dropdown-item:hover { background: rgba(255,255,255,0.06); }
    .thumbnailPreview-button { position: absolute; bottom: 10px; left: 5px; background-color: var(--thumbnail-btn-bg); color: var(--thumbnail-btn-color); border: none; border-radius: 6px; padding: 3px; font-size: 18px; cursor: pointer; z-index: 2000; opacity: 0; transition: opacity 0.3s; display: flex; align-items: center; justify-content: center; box-shadow: var(--thumbnail-glass-shadow); backdrop-filter: var(--thumbnail-glass-blur); -webkit-backdrop-filter: var(--thumbnail-glass-blur); border: 1px solid var(--thumbnail-glass-border); }
    .thumbnailPreview-container { position: relative; }
    .thumbnailPreview-container:hover .thumbnailPreview-button { opacity: 1; }
    .thumbnail-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.55); z-index: 100000; display: flex; align-items: center; justify-content: center; animation: fadeInModal 0.22s cubic-bezier(.4,0,.2,1); backdrop-filter: blur(8px) saturate(140%); -webkit-backdrop-filter: blur(8px) saturate(140%); }
  .thumbnail-modal-content { background: var(--thumbnail-modal-bg); border-radius: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.45); max-width: 78vw; max-height: 90vh; overflow: auto; position: relative; display: flex; flex-direction: column; align-items: center; animation: scaleInModal 0.22s cubic-bezier(.4,0,.2,1); border: 1.5px solid var(--thumbnail-glass-border); backdrop-filter: blur(14px) saturate(150%); -webkit-backdrop-filter: blur(14px) saturate(150%);}
    /* Wrapper to place content and action buttons side-by-side */
    .thumbnail-modal-wrapper { display: flex; align-items: flex-start; gap: 12px; }
    .thumbnail-modal-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
  .thumbnail-modal-action-btn { width: 40px; height: 40px; border-radius: 50%; background: var(--thumbnail-modal-btn-bg); border: 1px solid rgba(0,0,0,0.08); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.2); transition: transform 0.12s ease, background 0.12s ease; color: var(--thumbnail-modal-btn-color); }
    .thumbnail-modal-action-btn:hover { transform: translateY(-2px); }
    .thumbnail-modal-close { }
    .thumbnail-modal-open { }
    .thumbnail-modal-img { max-width: 72vw; max-height: 70vh; box-shadow: var(--thumbnail-glass-shadow); background: #222; border: 1px solid var(--thumbnail-glass-border); }
    .thumbnail-modal-options { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
    .thumbnail-modal-option-btn { background: var(--thumbnail-modal-btn-bg); color: var(--thumbnail-modal-btn-color); border: none; border-radius: 8px; padding: 8px 18px; font-size: 14px; cursor: pointer; transition: background 0.2s; margin-bottom: 6px; box-shadow: var(--thumbnail-glass-shadow); backdrop-filter: var(--thumbnail-glass-blur); -webkit-backdrop-filter: var(--thumbnail-glass-blur); border: 1px solid var(--thumbnail-glass-border); }
    .thumbnail-modal-option-btn:hover { background: var(--thumbnail-modal-btn-hover-bg); color: var(--thumbnail-modal-btn-hover-color); }
    .thumbnail-modal-title { font-size: 18px; font-weight: 600; color: var(--thumbnail-modal-title); margin-bottom: 10px; text-align: center; text-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    @keyframes fadeInModal { from { opacity: 0; } to { opacity: 1; } }
    @keyframes scaleInModal { from { transform: scale(0.95); } to { transform: scale(1); } }
            `;

      if (
        window.YouTubeUtils &&
        YouTubeUtils.StyleManager &&
        typeof YouTubeUtils.StyleManager.add === 'function'
      ) {
        YouTubeUtils.StyleManager.add('thumbnail-viewer-styles', css);
      } else {
        const s = document.createElement('style');
        s.id = 'ytplus-thumbnail-styles';
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
      }
    } catch {
      // fallback: inject minimal styles
      if (!document.getElementById('ytplus-thumbnail-styles')) {
        const s = document.createElement('style');
        s.id = 'ytplus-thumbnail-styles';
        s.textContent = '.thumbnail-modal-img{max-width:72vw;max-height:70vh;}';
        (document.head || document.documentElement).appendChild(s);
      }
    }
  })();

  /**
   * Show image in modal with error handling and security
   * @param {string} url - Image URL to display
   * @returns {void}
   */
  function showImageModal(url) {
    try {
      // Validate URL
      if (!url || typeof url !== 'string') {
        console.error('[Thumbnail] Invalid URL provided to modal');
        return;
      }

      // Validate URL format and security
      try {
        const parsedUrl = new URL(url);
        // Only allow HTTPS protocol
        if (parsedUrl.protocol !== 'https:') {
          console.error('[Thumbnail] Only HTTPS URLs are allowed');
          return;
        }
        // Validate domain (allow common YouTube image domains)
        // Avatars and some images may be hosted on ggpht.com or googleusercontent.com
        const allowedDomains = ['ytimg.com', 'youtube.com', 'ggpht.com', 'googleusercontent.com'];
        if (!allowedDomains.some(d => parsedUrl.hostname.endsWith(d))) {
          console.error('[Thumbnail] Image domain not allowed:', parsedUrl.hostname);
          return;
        }
      } catch (urlError) {
        console.error('[Thumbnail] Invalid URL format:', urlError);
        return;
      }

      // Remove existing modals
      document.querySelectorAll('.thumbnail-modal-overlay').forEach(m => m.remove());

      const overlay = document.createElement('div');
      overlay.className = 'thumbnail-modal-overlay';

      const content = document.createElement('div');
      content.className = 'thumbnail-modal-content';

      // create image element
      const img = document.createElement('img');
      img.className = 'thumbnail-modal-img';
      img.src = url;
      img.alt = t('thumbnailPreview');
      // remove tooltip/title text per request
      img.title = '';
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => window.open(img.src, '_blank'));

      const optionsDiv = document.createElement('div');
      optionsDiv.className = 'thumbnail-modal-options';

      // close button placed on the overlay (outside modal content)
      const closeBtn = document.createElement('button');
      closeBtn.className = 'thumbnail-modal-close';
      closeBtn.innerHTML = `\n            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>\n            </svg>\n            `;
      closeBtn.title = t('close');
      closeBtn.setAttribute('aria-label', t('close'));
      closeBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        overlay.remove();
      });

      // open-in-new-tab button (uses extension-like puzzle icon)
      const newTabBtn = document.createElement('button');
      newTabBtn.className = 'thumbnail-modal-open';
      newTabBtn.innerHTML = `\n            <svg fill="currentColor" viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" stroke="currentColor">\n        <g id="SVGRepo_bgCarrier" stroke-width="0"></g>\n        <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>\n        <g id="SVGRepo_iconCarrier"><path d="M14.293,9.707a1,1,0,0,1,0-1.414L18.586,4H16a1,1,0,0,1,0-2h5a1,1,0,0,1,1,1V8a1,1,0,0,1-2,0V5.414L15.707,9.707a1,1,0,0,1-1.414,0ZM3,22H8a1,1,0,0,0,0-2H5.414l4.293-4.293a1,1,0,0,0-1.414-1.414L4,18.586V16a1,1,0,0,0-2,0v5A1,1,0,0,0,3,22Z"></path></g>\n      </svg>\n        `;
      newTabBtn.title = t('clickToOpen');
      newTabBtn.setAttribute('aria-label', t('clickToOpen'));
      newTabBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        window.open(img.src, '_blank');
      });

      // download button
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'thumbnail-modal-download';
      downloadBtn.innerHTML = `\n            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>\n                <polyline points="7 10 12 15 17 10"/>\n                <line x1="12" y1="15" x2="12" y2="3"/>\n            </svg>\n        `;
      downloadBtn.title = t('download');
      downloadBtn.setAttribute('aria-label', t('download'));
      downloadBtn.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        try {
          // Try to download by fetching the image as a blob first. Browsers often ignore
          // the `download` attribute for cross-origin links, so fetching and creating
          // an object URL forces a download when allowed by CORS.
          const response = await fetch(img.src);
          if (!response.ok) throw new Error('Network response was not ok');
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          // Derive a sensible filename from the image URL, fallback to thumbnail.jpg
          try {
            const urlObj = new URL(img.src);
            const segments = urlObj.pathname.split('/');
            a.download = segments[segments.length - 1] || 'thumbnail.jpg';
          } catch {
            a.download = 'thumbnail.jpg';
          }
          document.body.appendChild(a);
          a.click();
          a.remove();
          // Revoke object URL shortly after to free memory
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
        } catch {
          // If fetch failed (CORS or network), fallback to opening in a new tab so user
          // can still save the image manually.
          window.open(img.src, '_blank');
        }
      });

      // append modal pieces: create wrapper with content and an actions column
      content.appendChild(img);
      content.appendChild(optionsDiv);

      const wrapper = document.createElement('div');
      wrapper.className = 'thumbnail-modal-wrapper';

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'thumbnail-modal-actions';

      // style action buttons consistently
      closeBtn.classList.add('thumbnail-modal-action-btn');
      newTabBtn.classList.add('thumbnail-modal-action-btn');
      downloadBtn.classList.add('thumbnail-modal-action-btn');

      // put close first, then open (new-tab), then download (last)
      actionsDiv.appendChild(closeBtn);
      actionsDiv.appendChild(newTabBtn);
      actionsDiv.appendChild(downloadBtn);

      wrapper.appendChild(content);
      wrapper.appendChild(actionsDiv);
      overlay.appendChild(wrapper);

      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.remove();
      });

      function escHandler(e) {
        if (e.key === 'Escape') {
          overlay.remove();
          window.removeEventListener('keydown', escHandler, true);
        }
      }
      window.addEventListener('keydown', escHandler, true);

      img.addEventListener('error', () => {
        const err = document.createElement('div');
        err.textContent = 'Не удалось загрузить изображение';
        err.style.color = 'white';
        content.appendChild(err);
      });

      document.body.appendChild(overlay);
    } catch (error) {
      console.error('[Thumbnail] Error showing modal:', error);
    }
  }

  let thumbnailPreviewCurrentVideoId = '';
  let thumbnailPreviewClosed = false;
  let thumbnailInsertionAttempts = 0;
  const MAX_ATTEMPTS = 10;
  const RETRY_DELAY = 500;

  function isWatchPage() {
    const url = new URL(window.location.href);
    return url.pathname === '/watch' && url.searchParams.has('v');
  }

  function addOrUpdateThumbnailImage() {
    if (!isWatchPage()) return;

    const newVideoId = new URLSearchParams(window.location.search).get('v');

    if (newVideoId !== thumbnailPreviewCurrentVideoId) {
      thumbnailPreviewClosed = false;
      // Remove old overlay when video changes to prevent showing stale thumbnails
      const oldOverlay = document.querySelector('#thumbnailPreview-player-overlay');
      if (oldOverlay) {
        oldOverlay.remove();
      }
    }

    if (!newVideoId || newVideoId === thumbnailPreviewCurrentVideoId || thumbnailPreviewClosed) {
      return;
    }

    thumbnailPreviewCurrentVideoId = newVideoId;

    function attemptInsertion() {
      const player =
        document.querySelector('#movie_player') || document.querySelector('ytd-player');
      if (!player) {
        thumbnailInsertionAttempts++;
        if (thumbnailInsertionAttempts < MAX_ATTEMPTS) {
          setTimeout(attemptInsertion, RETRY_DELAY);
        } else {
          thumbnailInsertionAttempts = 0;
        }
        return;
      }

      // Add or update a small overlay icon at top-left of the player
      const overlayId = 'thumbnailPreview-player-overlay';
      let overlay = player.querySelector(`#${overlayId}`);

      if (!overlay) {
        // create a standard thumb-overlay and adapt it for the top-left player position
        overlay = /** @type {any} */ (
          createThumbnailOverlay(thumbnailPreviewCurrentVideoId, player)
        );
        overlay.id = overlayId;
        overlay.dataset.videoId = thumbnailPreviewCurrentVideoId; // Store video ID
        // override position/size for player overlay (top-left)
        overlay.style.cssText = `
                    position: absolute;
                    top: 10%;
                    right: 8px;
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 6px;
                    cursor: pointer;
                    z-index: 1001;
                    transition: all 0.15s ease;
                    opacity: 0;
                `;

        // Add hover and focus behaviour so overlay becomes fully visible when interacted with
        overlay.tabIndex = 0; // make focusable for keyboard users
        overlay.onmouseenter = () => {
          try {
            overlay.style.opacity = '0.5';
          } catch {}
        };
        overlay.onmouseleave = () => {
          try {
            overlay.style.opacity = '0';
          } catch {}
        };
        overlay.onfocus = () => {
          try {
            overlay.style.opacity = '0.5';
          } catch {}
        };
        overlay.onblur = () => {
          try {
            overlay.style.opacity = '0';
          } catch {}
        };
        // allow Enter/Space to open the thumbnail
        overlay.addEventListener('keydown', e => {
          // cast to KeyboardEvent for lint/type safety
          const ke = /** @type {KeyboardEvent} */ (e);
          if (ke && (ke.key === 'Enter' || ke.key === ' ')) {
            ke.preventDefault();
            overlay.click();
          }
        });

        // ensure the player is positioned to allow absolute child
        const playerAny = /** @type {any} */ (player);
        if (/** @type {any} */ (getComputedStyle(playerAny)).position === 'static') {
          playerAny.style.position = 'relative';
        }
        playerAny.appendChild(overlay);
      } else {
        // overlay already exists — verify it matches current video ID, otherwise remove and recreate
        if (overlay.dataset.videoId !== thumbnailPreviewCurrentVideoId) {
          overlay.remove();
          // Recursively call to create new overlay
          attemptInsertion();
          return;
        }
      }

      thumbnailInsertionAttempts = 0;
    }

    attemptInsertion();
  }

  function createThumbnailOverlay(videoId, container) {
    const overlay = document.createElement('div');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'white');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.transition = 'stroke 0.2s ease';

    const mainRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    mainRect.setAttribute('width', '18');
    mainRect.setAttribute('height', '18');
    mainRect.setAttribute('x', '3');
    mainRect.setAttribute('y', '3');
    mainRect.setAttribute('rx', '2');
    mainRect.setAttribute('ry', '2');
    svg.appendChild(mainRect);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '9');
    circle.setAttribute('cy', '9');
    circle.setAttribute('r', '2');
    svg.appendChild(circle);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21');
    svg.appendChild(path);

    overlay.appendChild(svg);
    overlay.style.cssText = `
            position: absolute;
            bottom: 8px;
            left: 8px;
            background: rgba(0, 0, 0, 0.3);
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            cursor: pointer;
            z-index: 1000;
            opacity: 0;
            transition: all 0.2s ease;
        `;

    overlay.onmouseenter = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.7)';
    };
    overlay.onmouseleave = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.3)';
    };

    overlay.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();

      const isShorts =
        container.closest('ytm-shorts-lockup-view-model') ||
        container.closest('.shortsLockupViewModelHost') ||
        container.closest('[class*="shortsLockupViewModelHost"]') ||
        container.querySelector('a[href*="/shorts/"]');

      await openThumbnail(videoId, !!isShorts, overlay);
    };

    return overlay;
  }

  function addThumbnailOverlay(container) {
    if (container.querySelector('.thumb-overlay')) return;

    let videoId = null;
    let thumbnailContainer = null;

    const img = container.querySelector('img[src*="ytimg.com"]');
    if (img?.src) {
      videoId = extractVideoId(img.src);
      thumbnailContainer = img.closest('yt-thumbnail-view-model') || img.parentElement;
    }

    if (!videoId) {
      const link = container.querySelector('a[href*="/shorts/"]');
      if (link?.href) {
        videoId = extractShortsId(link.href);

        const shortsImg = container.querySelector('img[src*="ytimg.com"]');
        if (shortsImg) {
          thumbnailContainer =
            shortsImg.closest('.ytCoreImageHost') ||
            shortsImg.closest('[class*="ThumbnailContainer"]') ||
            shortsImg.closest('[class*="ImageHost"]') ||
            shortsImg.parentElement;
        }
      }
    }

    if (!videoId || !thumbnailContainer) return;

    if (getComputedStyle(thumbnailContainer).position === 'static') {
      thumbnailContainer.style.position = 'relative';
    }
    const overlay = createThumbnailOverlay(videoId, container);
    overlay.className = 'thumb-overlay';
    thumbnailContainer.appendChild(overlay);

    thumbnailContainer.onmouseenter = () => (overlay.style.opacity = '1');
    thumbnailContainer.onmouseleave = () => (overlay.style.opacity = '0');
  }

  function createAvatarOverlay() {
    const overlay = document.createElement('div');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'white');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.transition = 'stroke 0.2s ease';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '8');
    circle.setAttribute('r', '5');
    svg.appendChild(circle);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 21a8 8 0 0 0-16 0');
    svg.appendChild(path);

    overlay.appendChild(svg);

    overlay.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.7);
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            cursor: pointer;
            z-index: 1000;
            opacity: 0;
            transition: all 0.2s ease;
        `;

    overlay.onmouseenter = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.9)';
    };
    overlay.onmouseleave = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.7)';
    };

    return overlay;
  }

  function addAvatarOverlay(img) {
    const container = img.parentElement;
    if (container.querySelector('.avatar-overlay')) return;

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const overlay = createAvatarOverlay();
    overlay.className = 'avatar-overlay';

    overlay.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      const highResUrl = img.src.replace(/=s\d+-c-k-c0x00ffffff-no-rj.*/, '=s0');
      showImageModal(highResUrl);
    };

    container.appendChild(overlay);

    container.onmouseenter = () => (overlay.style.opacity = '1');
    container.onmouseleave = () => (overlay.style.opacity = '0');
  }

  function createBannerOverlay() {
    const overlay = document.createElement('div');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'white');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.transition = 'stroke 0.2s ease';

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '3');
    rect.setAttribute('y', '3');
    rect.setAttribute('width', '18');
    rect.setAttribute('height', '18');
    rect.setAttribute('rx', '2');
    rect.setAttribute('ry', '2');
    svg.appendChild(rect);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '9');
    circle.setAttribute('cy', '9');
    circle.setAttribute('r', '2');
    svg.appendChild(circle);

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '21,15 16,10 5,21');
    svg.appendChild(polyline);

    overlay.appendChild(svg);

    overlay.style.cssText = `
            position: absolute;
            bottom: 8px;
            left: 8px;
            background: rgba(0, 0, 0, 0.7);
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            cursor: pointer;
            z-index: 1000;
            opacity: 0;
            transition: all 0.2s ease;
        `;

    overlay.onmouseenter = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.9)';
    };
    overlay.onmouseleave = () => {
      overlay.style.background = 'rgba(0, 0, 0, 0.7)';
    };

    return overlay;
  }

  function addBannerOverlay(img) {
    const container = img.parentElement;
    if (container.querySelector('.banner-overlay')) return;

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const overlay = createBannerOverlay();
    overlay.className = 'banner-overlay';

    overlay.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      const highResUrl = img.src.replace(/=w\d+-.*/, '=s0');
      showImageModal(highResUrl);
    };

    container.appendChild(overlay);

    container.onmouseenter = () => (overlay.style.opacity = '1');
    container.onmouseleave = () => (overlay.style.opacity = '0');
  }

  function processAvatars() {
    const avatarSelectors = [
      'yt-avatar-shape img',
      '#avatar img',
      'ytd-channel-avatar-editor img',
      '.ytd-video-owner-renderer img[src*="yt"]',
      'img[src*="yt3.ggpht.com"]', // Добавляем прямой селектор для аватаров
      'img[src*="yt4.ggpht.com"]',
    ];

    avatarSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(img => {
        if (!img.src) return;
        if (!img.src.includes('yt')) return;
        if (img.closest('.avatar-overlay')) return;

        // Проверяем, что это действительно аватар (квадратное изображение)
        const isAvatar = img.naturalWidth > 0 && img.naturalWidth === img.naturalHeight;

        if (isAvatar || img.src.includes('ggpht.com')) {
          addAvatarOverlay(img);
        }
      });
    });
  }

  function processBanners() {
    const bannerSelectors = [
      'yt-image-banner-view-model img',
      'ytd-c4-tabbed-header-renderer img[src*="yt"]',
      '#channel-header img[src*="banner"]',
      'img[src*="banner"]', // Более общий селектор для баннеров
    ];

    bannerSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(img => {
        if (!img.src) return;
        if (img.closest('.banner-overlay')) return;

        const isBanner =
          (img.src.includes('banner') || img.src.includes('yt')) &&
          img.naturalWidth > img.naturalHeight * 2; // Баннеры обычно широкие

        if (isBanner || img.src.includes('banner')) {
          addBannerOverlay(img);
        }
      });
    });
  }

  function processThumbnails() {
    document.querySelectorAll('yt-thumbnail-view-model').forEach(addThumbnailOverlay);
    document.querySelectorAll('.ytd-thumbnail').forEach(addThumbnailOverlay);

    document.querySelectorAll('ytm-shorts-lockup-view-model').forEach(addThumbnailOverlay);
    document.querySelectorAll('.shortsLockupViewModelHost').forEach(addThumbnailOverlay);
    document.querySelectorAll('[class*="shortsLockupViewModelHost"]').forEach(addThumbnailOverlay);
  }

  function processAll() {
    processThumbnails();
    processAvatars();
    processBanners();
    addOrUpdateThumbnailImage();
  }

  function setupMutationObserver() {
    const observer = new MutationObserver(() => {
      setTimeout(processAll, 50);
    });

    // ✅ Safe observe with document.body check
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      });
    }
  }

  function setupUrlChangeDetection() {
    let currentUrl = location.href;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      originalPushState.apply(history, arguments);
      setTimeout(() => {
        if (location.href !== currentUrl) {
          currentUrl = location.href;
          setTimeout(addOrUpdateThumbnailImage, 500);
        }
      }, 100);
    };

    history.replaceState = function () {
      originalReplaceState.apply(history, arguments);
      setTimeout(() => {
        if (location.href !== currentUrl) {
          currentUrl = location.href;
          setTimeout(addOrUpdateThumbnailImage, 500);
        }
      }, 100);
    };

    window.addEventListener('popstate', function () {
      setTimeout(() => {
        if (location.href !== currentUrl) {
          currentUrl = location.href;
          setTimeout(addOrUpdateThumbnailImage, 500);
        }
      }, 100);
    });

    setInterval(function () {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        setTimeout(addOrUpdateThumbnailImage, 300);
      }
    }, 500);
  }

  function initialize() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(init, 100);
      });
    } else {
      setTimeout(init, 100);
    }
  }

  function init() {
    setupUrlChangeDetection();
    setupMutationObserver();
    processAll();
    setTimeout(processAll, 500);
    setTimeout(processAll, 1000);
    setTimeout(processAll, 2000);
  }

  initialize();
})();
