(function () {
  'use strict';

  const setTimeout_ = setTimeout.bind(window);
  const _createHTML =
    window._ytplusCreateHTML || /** @type {any} */ ((/** @type {string} */ s) => s);
  const renderTemplateClone = (/** @type {Element} */ container, /** @type {string} */ html) => {
    if (!(container instanceof Element)) return;
    const template = document.createElement('template');
    const range = document.createRange();
    const root = document.body || document.documentElement;
    if (root) range.selectNode(root);
    // eslint-disable-next-line no-unsanitized/method -- pre-sanitized via Trusted Types policy (_createHTML)
    template.content.append(range.createContextualFragment(_createHTML(html)));
    container.replaceChildren(template.content.cloneNode(true));
  };

  // Shared DOM helpers from YouTubeUtils
  const qs = window.YouTubeUtils?.$ || document.querySelector.bind(document);
  const qsAll =
    window.YouTubeUtils?.$$ || (sel => Array.from(document['querySelectorAll'](String(sel || ''))));
  const byId =
    window.YouTubeUtils?.byId ||
    ((/** @type {string} */ id) =>
      /** @type {HTMLElement|null} */ (document['getElementById'](id)));

  // Shared translation helper from YouTubeUtils
  const t = window.YouTubeUtils.t;

  const isAllowedHost = (/** @type {string} */ host, /** @type {string} */ domain) => {
    const normalizedHost = String(host || '').toLowerCase();
    const normalizedDomain = String(domain || '').toLowerCase();
    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
  };

  function loadEnableThumbnail() {
    return window.YouTubeUtils?.loadFeatureEnabled?.('enableThumbnail') ?? true;
  }

  let thumbnailFeatureEnabled = loadEnableThumbnail();
  const isEnabled = () => thumbnailFeatureEnabled;
  const isRelevantRoute = () => {
    try {
      const host = window.location.hostname || '';
      if (!isAllowedHost(host, 'youtube.com') || host === 'music.youtube.com') return false;
      const path = window.location.pathname || '';
      return (
        path === '/watch' ||
        path.startsWith('/shorts') ||
        path.startsWith('/channel/') ||
        path.startsWith('/@')
      );
    } catch (e) {
      return false;
    }
  };

  let started = false;
  let startScheduled = false;
  /** @type {string|null} */
  let mutationObserverSubId = null;
  /** @type {string|null} */
  let modalCleanupSubId = null;
  /** @type {null | (() => void)} */
  let urlChangeCleanup = null;
  let thumbnailStylesInjected = false;

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
        window.console.warn('[YouTube+][Thumbnail]', 'Invalid video ID format:', videoId);
        return null;
      }
      return videoId;
    } catch (error) {
      window.console.error('[YouTube+][Thumbnail]', 'Error extracting video ID:', error);
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
        window.console.warn('[YouTube+][Thumbnail]', 'Invalid shorts ID format:', shortsId);
        return null;
      }
      return shortsId;
    } catch (error) {
      window.console.error('[YouTube+][Thumbnail]', 'Error extracting shorts ID:', error);
      return null;
    }
  }

  /**
   * Check if image exists with timeout and error handling
   * @param {string} url - Image URL to check
   * @returns {Promise<boolean>} True if image exists and is accessible
   */
  /**
   * Validate URL string format
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid
   */
  function isValidUrlString(url) {
    if (!url || typeof url !== 'string') {
      window.console.warn('[YouTube+][Thumbnail]', 'Invalid URL provided');
      return false;
    }
    return true;
  }

  /**
   * Validate URL protocol (HTTPS only)
   * @param {URL} parsedUrl - Parsed URL object
   * @returns {boolean} True if valid
   */
  function hasValidProtocol(parsedUrl) {
    if (parsedUrl.protocol !== 'https:') {
      window.console.warn('[YouTube+][Thumbnail]', 'Only HTTPS URLs are allowed');
      return false;
    }
    return true;
  }

  /**
   * Validate URL domain (YouTube only)
   * @param {URL} parsedUrl - Parsed URL object
   * @returns {boolean} True if valid
   */
  function hasValidDomain(parsedUrl) {
    const { hostname } = parsedUrl;
    if (!isAllowedHost(hostname, 'ytimg.com') && !isAllowedHost(hostname, 'youtube.com')) {
      window.console.warn('[YouTube+][Thumbnail]', 'Only YouTube image domains are allowed');
      return false;
    }
    return true;
  }

  /**
   * Parse and validate URL
   * @param {string} url - URL to parse
   * @returns {URL|null} Parsed URL or null if invalid
   */
  function parseAndValidateUrl(url) {
    try {
      const parsedUrl = new URL(url);
      if (!hasValidProtocol(parsedUrl)) return null;
      if (!hasValidDomain(parsedUrl)) return null;
      return parsedUrl;
    } catch (error) {
      window.console.error('[YouTube+][Thumbnail]', 'Invalid URL:', error);
      return null;
    }
  }

  /**
   * Check image via HEAD request
   * @param {string} url - Image URL
   * @returns {Promise<boolean>} True if image exists
   */
  async function checkViaHeadRequest(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout_(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeoutId);
      return response ? response.ok : true;
    } catch (e) {
      clearTimeout(timeoutId);
      return false;
    }
  }

  /**
   * Cleanup image element
   * @param {HTMLImageElement} img - Image element
   */
  function cleanupImageElement(img) {
    try {
      img.onload = null;
      img.onerror = null;
      img.src = ''; // Cancel any in-flight loading
      if (img.parentNode) {
        img.parentNode.removeChild(img);
      }
    } catch (e) {
      // Element may already be removed
    }
  }

  /**
   * Check image via image load test
   * @param {string} url - Image URL
   * @returns {Promise<boolean>} True if image loads
   */
  function checkViaImageLoad(url) {
    return new Promise(resolve => {
      const img = document.createElement('img');
      /** @type {any} */ (img).style.display = 'none';

      const timeout = setTimeout_(() => {
        cleanupImageElement(img);
        resolve(false);
      }, 3000);
      // Register timeout with cleanupManager so SPA navigation can cancel it
      if (window.YouTubeUtils?.cleanupManager?.registerTimeout) {
        window.YouTubeUtils.cleanupManager.registerTimeout(timeout);
      }

      img.onload = () => {
        clearTimeout(timeout);
        cleanupImageElement(img);
        resolve(true);
      };

      img.onerror = () => {
        clearTimeout(timeout);
        cleanupImageElement(img);
        resolve(false);
      };

      document.body.appendChild(img);
      img.src = url;
    });
  }

  /**
   * Check if image exists at URL
   * @param {string} url - Image URL to check
   * @returns {Promise<boolean>} True if image exists
   */
  async function checkImageExists(url) {
    try {
      if (!isValidUrlString(url)) return false;

      const parsedUrl = parseAndValidateUrl(url);
      if (!parsedUrl) return false;

      // Try HEAD request first
      const headResult = await checkViaHeadRequest(url);
      if (headResult !== null) return headResult;

      // Fallback to image load test
      return await checkViaImageLoad(url);
    } catch (error) {
      window.console.error('[YouTube+][Thumbnail]', 'Error checking image:', error);
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

    /** @type {any} */ (spinner).style.animation = 'spin 1s linear infinite';

    // spin keyframe is defined in shared-keyframes (basic.js)

    return spinner;
  }

  /**
   * Open thumbnail in modal with error handling
   * @param {string} videoId - YouTube video ID
   * @param {boolean} isShorts - Whether this is a Shorts video
   * @param {HTMLElement} overlayElement - Overlay element containing the button
   * @returns {Promise<void>}
   */
  /**
   * Validate video ID format
   * @param {string} videoId - Video ID to validate
   * @returns {boolean} True if valid
   */
  function isValidVideoId(videoId) {
    return !!(videoId && typeof videoId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(videoId));
  }

  /**
   * Validate overlay element
   * @param {HTMLElement} overlayElement - Overlay element to validate
   * @returns {boolean} True if valid
   */
  function isValidOverlayElement(overlayElement) {
    return !!(overlayElement && overlayElement instanceof HTMLElement);
  }

  /**
   * Get thumbnail URLs for shorts
   * @param {string} videoId - Video ID
   * @returns {{primary: string, fallback: string}} Thumbnail URLs
   */
  function getShortsThumbnailUrls(videoId) {
    return {
      primary: `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`,
      fallback: `https://i.ytimg.com/vi/${videoId}/oar2.jpg`,
    };
  }

  /**
   * Get thumbnail URLs for regular videos
   * @param {string} videoId - Video ID
   * @returns {{primary: string, fallback: string}} Thumbnail URLs
   */
  function getVideoThumbnailUrls(videoId) {
    return {
      primary: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      fallback: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    };
  }

  /**
   * Load and show best available thumbnail
   * @param {string} videoId - Video ID
   * @param {boolean} isShorts - Whether this is a shorts video
   */
  async function loadAndShowThumbnail(videoId, isShorts) {
    const urls = isShorts ? getShortsThumbnailUrls(videoId) : getVideoThumbnailUrls(videoId);
    const isPrimaryAvailable = await checkImageExists(urls.primary);
    showImageModal(isPrimaryAvailable ? urls.primary : urls.fallback);
  }

  /**
   * Replace SVG with spinner
   * @param {HTMLElement} overlayElement - Overlay element
   * @param {SVGElement} originalSvg - Original SVG element
   * @returns {SVGElement} Spinner element
   */
  function replaceWithSpinner(overlayElement, originalSvg) {
    const spinner = createSpinner();
    overlayElement.replaceChild(spinner, originalSvg);
    return /** @type {SVGElement} */ (spinner);
  }

  /**
   * Restore original SVG after loading
   * @param {HTMLElement} overlayElement - Overlay element
   * @param {SVGElement} spinner - Spinner element
   * @param {SVGElement} originalSvg - Original SVG element
   */
  function restoreOriginalSvg(overlayElement, spinner, originalSvg) {
    try {
      if (spinner && spinner.parentNode) {
        overlayElement.replaceChild(originalSvg, spinner);
      }
    } catch (restoreError) {
      window.console.error('[YouTube+][Thumbnail]', 'Error restoring original SVG:', restoreError);
      if (spinner && spinner.parentNode) {
        spinner.parentNode.removeChild(spinner);
      }
    }
  }

  /**
   * Open thumbnail in modal viewer
   * @param {string} videoId - Video ID
   * @param {boolean} isShorts - Whether this is a shorts video
   * @param {HTMLElement} overlayElement - Overlay element
   */
  async function openThumbnail(videoId, isShorts, overlayElement) {
    try {
      if (!isValidVideoId(videoId)) {
        window.console.error('[YouTube+][Thumbnail]', 'Invalid video ID:', videoId);
        return;
      }

      if (!isValidOverlayElement(overlayElement)) {
        window.console.error('[YouTube+][Thumbnail]', 'Invalid overlay element');
        return;
      }

      const originalSvg = overlayElement.querySelector('svg');
      if (!originalSvg) {
        window.console.warn('[YouTube+][Thumbnail]', 'No SVG found in overlay element');
        return;
      }

      const spinner = replaceWithSpinner(overlayElement, originalSvg);

      try {
        await loadAndShowThumbnail(videoId, isShorts);
      } finally {
        restoreOriginalSvg(overlayElement, spinner, originalSvg);
      }
    } catch (error) {
      window.console.error('[YouTube+][Thumbnail]', 'Error opening thumbnail:', error);
    }
  }

  function ensureThumbnailStyles() {
    if (thumbnailStylesInjected) return;
    try {
      const css = `
        .thumbnail-overlay-container { position: absolute; bottom: 8px; left: 8px; z-index: var(--yt-z-overlay); opacity: 0; transition: opacity 0.2s ease; }
        .thumbnail-overlay-button { width: 28px; height: 28px; background: var(--yt-glass-bg); border: none; border-radius: var(--yt-radius-xs); cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--yt-text-primary); position: relative; box-shadow: var(--yt-glass-shadow); backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur); border: 1px solid var(--yt-glass-border); }
        .thumbnail-overlay-button svg{width:16px;height:16px;display:block;flex:none;}
        .thumbnail-overlay-button:hover { background: var(--yt-hover-bg); }
        .thumbnail-dropdown { position: absolute; bottom: 100%; left: 0; background: var(--yt-glass-bg); border-radius: var(--yt-radius-xs); padding: 4px; margin-bottom: 4px; display: none; flex-direction: column; min-width: 140px; box-shadow: var(--yt-glass-shadow); z-index: var(--yt-z-flyout); backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur); border: 1px solid var(--yt-glass-border); }
        .thumbnail-dropdown.show { display: flex !important; }
        .thumbnail-dropdown-item { background: none; border: none; color: var(--yt-text-primary); padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 12px; text-align: left; white-space: nowrap; transition: background-color 0.2s ease; }
        .thumbnail-dropdown-item:hover { background: var(--yt-hover-bg); }
        .thumbnailPreview-button { position: absolute; bottom: 10px; left: 5px; background-color: var(--yt-glass-bg); color: var(--yt-text-primary); border: none; border-radius: var(--yt-radius-xs); padding: 3px; font-size: 18px; cursor: pointer; z-index: var(--yt-z-overlay); opacity: 0; transition: opacity 0.3s; display: flex; align-items: center; justify-content: center; box-shadow: var(--yt-glass-shadow); backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur); border: 1px solid var(--yt-glass-border); }
        .thumbnailPreview-button svg{width:16px;height:16px;display:block;flex:none;}
        .thumbnailPreview-container { position: relative; }
        .thumbnailPreview-container:hover .thumbnailPreview-button { opacity: 1; }
        .thumbnail-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: var(--yt-modal-bg); z-index: var(--yt-z-modal); display: flex; align-items: center; justify-content: center; animation: fadeInModal 0.22s cubic-bezier(.4,0,.2,1); backdrop-filter: blur(8px) saturate(140%); -webkit-backdrop-filter: blur(8px) saturate(140%); }
        .thumbnail-modal-content { background: var(--yt-glass-bg); border-radius: var(--yt-radius-lg); box-shadow: 0 12px 40px var(--yt-timecode-panel-shadow); max-width: 78vw; max-height: 90vh; overflow: auto; position: relative; display: flex; flex-direction: column; align-items: center; animation: scaleInModal 0.22s cubic-bezier(.4,0,.2,1); border: 1.5px solid var(--yt-glass-border); backdrop-filter: blur(14px) saturate(150%); -webkit-backdrop-filter: blur(14px) saturate(150%);}
        /* Wrapper to place content and action buttons side-by-side */
        .thumbnail-modal-wrapper { display: flex; align-items: flex-start; gap: 12px; }
        .thumbnail-modal-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
        .thumbnail-modal-action-btn { padding: 0; line-height: 0; }
        .thumbnail-modal-action-btn svg{width:18px;height:18px;display:block;flex:none;}
        .thumbnail-modal-close svg{width:36px;height:36px;}
        .thumbnail-modal-close { }
        .thumbnail-modal-open { }
        .thumbnail-modal-img { max-width: 72vw; max-height: 70vh; box-shadow: var(--yt-glass-shadow); background: #222; border: 1px solid var(--yt-glass-border); }
        .thumbnail-modal-options { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
        .thumbnail-modal-option-btn { background: var(--yt-button-bg); color: var(--yt-text-primary); border: none; border-radius: var(--yt-radius-xs); padding: 8px 18px; font-size: 14px; cursor: pointer; transition: background 0.2s,color .2s; margin-bottom: 6px; box-shadow: var(--yt-glass-shadow); backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur); border: 1px solid var(--yt-glass-border); }
        .thumbnail-modal-option-btn:hover { background: var(--yt-hover-bg); color: var(--yt-accent); }
        .thumbnail-modal-title { font-size: 18px; font-weight: 600; color: var(--yt-text-primary); margin-bottom: 10px; text-align: center; text-shadow: 0 2px 8px var(--yt-shadow-deep-1); }
        /* fadeInModal, scaleInModal are provided by design-system */
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
      thumbnailStylesInjected = true;
    } catch (e) {
      // fallback: inject minimal styles
      if (!byId('ytplus-thumbnail-styles')) {
        const s = document.createElement('style');
        s.id = 'ytplus-thumbnail-styles';
        s.textContent = '.thumbnail-modal-img{max-width:72vw;max-height:70vh;}';
        (document.head || document.documentElement).appendChild(s);
      }
      thumbnailStylesInjected = true;
    }
  }

  function removeThumbnailStyles() {
    try {
      if (window.YouTubeUtils?.StyleManager?.remove) {
        window.YouTubeUtils.StyleManager.remove('thumbnail-viewer-styles');
      }
    } catch (e) {
      // Non-critical, suppressed
    }

    const el = byId('ytplus-thumbnail-styles');
    if (el) {
      try {
        el.remove();
      } catch (e) {
        // Non-critical, suppressed
      }
    }

    thumbnailStylesInjected = false;
  }

  /**
   * Validate modal URL security
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid
   */
  function validateModalUrl(url) {
    if (!url || typeof url !== 'string') {
      window.console.error('[YouTube+][Thumbnail]', 'Invalid URL provided to modal');
      return false;
    }

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:') {
        window.console.error('[YouTube+][Thumbnail]', 'Only HTTPS URLs are allowed');
        return false;
      }
      const allowedDomains = ['ytimg.com', 'youtube.com', 'ggpht.com', 'googleusercontent.com'];
      if (!allowedDomains.some(d => isAllowedHost(parsedUrl.hostname, d))) {
        window.console.error(
          '[YouTube+][Thumbnail]',
          'Image domain not allowed:',
          parsedUrl.hostname
        );
        return false;
      }
      return true;
    } catch (urlError) {
      window.console.error('[YouTube+][Thumbnail]', 'Invalid URL format:', urlError);
      return false;
    }
  }

  /**
   * Create modal image element
   * @param {string} url - Image URL
   * @returns {HTMLImageElement} Image element
   */
  function createModalImage(url) {
    const img = document.createElement('img');
    img.className = 'thumbnail-modal-img';
    img.src = url;
    img.alt = t('thumbnailPreview');
    img.title = '';
    /** @type {any} */ (img).style.cursor = 'pointer';
    img.addEventListener('click', () => window.open(img.src, '_blank'));
    return img;
  }

  /**
   * Create close button for modal
   * @param {HTMLElement} overlay - Overlay element to remove on click
   * @returns {HTMLButtonElement} Close button
   */
  function createCloseButton(overlay) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'thumbnail-modal-close thumbnail-modal-action-btn ytp-plus-settings-close';
    closeBtn.setAttribute('data-shared-close-button', 'ytp-plus-close-settings');
    renderTemplateClone(
      closeBtn,
      `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.5 9.50002L9.5 14.5M9.49998 9.5L14.5 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>`
    );
    closeBtn.title = t('closeButton') || t('close');
    closeBtn.setAttribute('aria-label', t('closeButton') || t('close'));
    closeBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      overlay.remove();
    });
    return closeBtn;
  }

  /**
   * Create open in new tab button for modal
   * @param {HTMLImageElement} img - Image element
   * @returns {HTMLButtonElement} New tab button
   */
  function createNewTabButton(img) {
    const newTabBtn = document.createElement('button');
    newTabBtn.className = 'thumbnail-modal-open thumbnail-modal-action-btn ytp-plus-settings-close';
    renderTemplateClone(
      newTabBtn,
      `\n            <svg fill="currentColor" viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" stroke="currentColor">\n        <g id="SVGRepo_bgCarrier" stroke-width="0"></g>\n        <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>\n        <g id="SVGRepo_iconCarrier"><path d="M14.293,9.707a1,1,0,0,1,0-1.414L18.586,4H16a1,1,0,0,1,0-2h5a1,1,0,0,1,1,1V8a1,1,0,0,1-2,0V5.414L15.707,9.707a1,1,0,0,1-1.414,0ZM3,22H8a1,1,0,0,0,0-2H5.414l4.293-4.293a1,1,0,0,0-1.414-1.414L4,18.586V16a1,1,0,0,0-2,0v5A1,1,0,0,0,3,22Z"></path></g>\n      </svg>\n        `
    );
    newTabBtn.title = t('clickToOpen');
    newTabBtn.setAttribute('aria-label', t('clickToOpen'));
    newTabBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      window.open(img.src, '_blank');
    });
    return newTabBtn;
  }

  /**
   * Download image as blob
   * @param {string} imgSrc - Image source URL
   * @returns {Promise<void>}
   */
  async function downloadImageAsBlob(imgSrc) {
    const controller = new AbortController();
    const timerId = setTimeout_(() => controller.abort(), 15000); // 15 s timeout for image download
    let response;
    try {
      response = await fetch(imgSrc, { signal: controller.signal });
    } finally {
      clearTimeout(timerId);
    }
    if (!response.ok) throw new Error('Network response was not ok');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;

    try {
      const urlObj = new URL(imgSrc);
      const segments = urlObj.pathname.split('/');
      a.download = segments[segments.length - 1] || 'thumbnail.jpg';
    } catch (e) {
      a.download = 'thumbnail.jpg';
    }

    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout_(() => URL.revokeObjectURL(blobUrl), 1500);
  }

  /**
   * Create download button for modal
   * @param {HTMLImageElement} img - Image element
   * @returns {HTMLButtonElement} Download button
   */
  function createDownloadButton(img) {
    const downloadBtn = document.createElement('button');
    downloadBtn.className =
      'thumbnail-modal-download thumbnail-modal-action-btn ytp-plus-settings-close';
    renderTemplateClone(
      downloadBtn,
      `\n            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="0.5" d="M3 15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: var(--darkreader-text-ffffff, #cad3f5);" data-darkreader-inline-stroke=""></path> <path d="M12 3V16M12 16L16 11.625M12 16L8 11.625" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="--darkreader-inline-stroke: var(--darkreader-text-ffffff, #cad3f5);" data-darkreader-inline-stroke=""></path></svg>\n        `
    );
    downloadBtn.title = t('download');
    downloadBtn.setAttribute('aria-label', t('download'));
    downloadBtn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await downloadImageAsBlob(img.src);
      } catch (e) {
        window.open(img.src, '_blank');
      }
    });
    return downloadBtn;
  }

  /**
   * Setup modal keyboard handlers
   * @param {HTMLElement} overlay - Overlay element
   */
  function setupModalKeyboard(overlay) {
    function escHandler(/** @type {any} */ e) {
      if (e.key === 'Escape') {
        overlay.remove();
        window.removeEventListener('keydown', escHandler, true);
      }
    }
    window.addEventListener('keydown', escHandler, true);
  }

  /**
   * Setup modal image error handler
   * @param {HTMLImageElement} img - Image element
   * @param {HTMLElement} content - Content container
   */
  function setupImageErrorHandler(img, content) {
    img.addEventListener('error', () => {
      const err = document.createElement('div');
      err.textContent = t('thumbnailLoadFailed');
      /** @type {any} */ (err).style.color = 'white';
      content.appendChild(err);
    });
  }

  /**
   * Show image in modal with error handling and security
   * @param {string} url - Image URL to display
   * @returns {void}
   */
  function showImageModal(url) {
    try {
      if (!isEnabled()) return;
      if (!validateModalUrl(url)) return;

      // Remove existing modals
      qsAll('.thumbnail-modal-overlay').forEach(m => m.remove());

      const overlay = document.createElement('div');
      overlay.className = 'thumbnail-modal-overlay ytp-plus-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Thumbnail preview');

      const content = document.createElement('div');
      content.className = 'thumbnail-modal-content ytp-plus-modal-content';

      const img = createModalImage(url);

      const optionsDiv = document.createElement('div');
      optionsDiv.className = 'thumbnail-modal-options';

      const closeBtn = createCloseButton(overlay);
      const newTabBtn = createNewTabButton(img);
      const downloadBtn = createDownloadButton(img);

      content.appendChild(img);
      content.appendChild(optionsDiv);

      const wrapper = document.createElement('div');
      wrapper.className = 'thumbnail-modal-wrapper';

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'thumbnail-modal-actions';

      actionsDiv.appendChild(closeBtn);
      actionsDiv.appendChild(newTabBtn);
      actionsDiv.appendChild(downloadBtn);

      wrapper.appendChild(content);
      wrapper.appendChild(actionsDiv);
      overlay.appendChild(wrapper);

      overlay.addEventListener('click', ({ target }) => {
        if (target === overlay) overlay.remove();
      });

      setupModalKeyboard(overlay);
      setupImageErrorHandler(img, content);

      document.body.appendChild(overlay);

      // Focus trap and initial focus
      requestAnimationFrame(() => {
        const focusTarget = overlay.querySelector('button, [tabindex="0"]');
        if (focusTarget) /** @type {HTMLElement} */ (focusTarget).focus();
      });
      if (window.YouTubePlusModalHandlers && window.YouTubePlusModalHandlers.createFocusTrap) {
        const removeTrap = window.YouTubePlusModalHandlers.createFocusTrap(overlay);
        const coordinator = window.YouTubeMutationCoordinator;
        if (coordinator?.subscribeRoot) {
          modalCleanupSubId = 'thumbnail::modalCleanup';
          coordinator.subscribeRoot(
            modalCleanupSubId,
            () => {
              if (!overlay.isConnected) {
                removeTrap();
                coordinator.unsubscribe(modalCleanupSubId);
                modalCleanupSubId = null;
              }
            },
            { childList: true, attributes: false, subtree: true }
          );
        }
      }
    } catch (error) {
      window.console.error('[YouTube+][Thumbnail]', 'Error showing modal:', error);
    }
  }

  let thumbnailPreviewCurrentVideoId = '';
  let thumbnailPreviewClosed = false;
  let thumbnailInsertionAttempts = 0;
  const MAX_ATTEMPTS = 10;
  const RETRY_DELAY = 500;

  /**
   * Get current video ID from URL
   * @returns {string|null} Video ID or null
   */
  function getCurrentVideoId() {
    return new URLSearchParams(window.location.search).get('v');
  }

  /**
   * Remove old thumbnail overlay
   */
  function removeOldOverlay() {
    const oldOverlay = qs('#thumbnailPreview-player-overlay');
    if (oldOverlay) {
      oldOverlay.remove();
    }
  }

  /**
   * Check if thumbnail update should be skipped
   * @param {string|null} newVideoId - New video ID
   * @returns {boolean} True if should skip
   */
  function shouldSkipThumbnailUpdate(newVideoId) {
    return !newVideoId || newVideoId === thumbnailPreviewCurrentVideoId || thumbnailPreviewClosed;
  }

  /**
   * Find player element with retry logic
   * @returns {HTMLElement|null} Player element or null
   */
  function findPlayerElement() {
    return /** @type {HTMLElement | null} */ (qs('#movie_player') || qs('ytd-player'));
  }

  /**
   * Create thumbnail overlay for player
   * @param {string} videoId - Video ID
   * @param {HTMLElement} player - Player element
   * @returns {HTMLElement} Created overlay element
   */
  function createPlayerThumbnailOverlay(videoId, player) {
    const overlay = /** @type {any} */ (createThumbnailOverlay(videoId, player));
    overlay.id = 'thumbnailPreview-player-overlay';
    overlay.dataset.videoId = videoId;
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
    return overlay;
  }

  /**
   * Attempt to insert thumbnail overlay
   */
  function attemptInsertion() {
    const player = findPlayerElement();

    if (!player) {
      thumbnailInsertionAttempts++;
      if (thumbnailInsertionAttempts < MAX_ATTEMPTS) {
        setTimeout_(attemptInsertion, RETRY_DELAY);
      } else {
        thumbnailInsertionAttempts = 0;
      }
      return;
    }

    const overlayId = 'thumbnailPreview-player-overlay';
    let overlay = /** @type {any} */ (player.querySelector(`#${overlayId}`));

    if (!overlay) {
      overlay = /** @type {any} */ (
        createPlayerThumbnailOverlay(thumbnailPreviewCurrentVideoId, player)
      );

      // Add hover and focus behaviour so overlay becomes fully visible when interacted with
      overlay.tabIndex = 0; // make focusable for keyboard users
      overlay.setAttribute('role', 'button');
      overlay.setAttribute('aria-label', 'Show thumbnail preview');
      overlay.onmouseenter = () => {
        try {
          overlay.style.opacity = '0.5';
        } catch (e) {
          // Non-critical, suppressed
        }
      };
      overlay.onmouseleave = () => {
        try {
          overlay.style.opacity = '0';
        } catch (e) {
          // Non-critical, suppressed
        }
      };
      overlay.onfocus = () => {
        try {
          overlay.style.opacity = '0.5';
        } catch (e) {
          // Non-critical, suppressed
        }
      };
      overlay.onblur = () => {
        try {
          overlay.style.opacity = '0';
        } catch (e) {
          // Non-critical, suppressed
        }
      };
      // allow Enter/Space to open the thumbnail
      overlay.addEventListener('keydown', (/** @type {any} */ e) => {
        // cast to KeyboardEvent for lint/type safety
        const ke = /** @type {KeyboardEvent} */ (e);
        if (ke && (ke.key === 'Enter' || ke.key === ' ')) {
          ke.preventDefault();
          overlay.click();
        }
      });

      // ensure the player is positioned to allow absolute child
      const playerElement = /** @type {HTMLElement} */ (player);
      if (getComputedStyle(playerElement).position === 'static') {
        playerElement.style.position = 'relative';
      }
      playerElement.appendChild(overlay);
      return;
    }

    // overlay already exists — verify it matches current video ID, otherwise remove and recreate
    if (/** @type {any} */ (overlay).dataset.videoId !== thumbnailPreviewCurrentVideoId) {
      overlay.remove();
      // Recursively call to create new overlay
      attemptInsertion();
    }

    thumbnailInsertionAttempts = 0;
  }

  /**
   * Add or update thumbnail image on watch page
   */
  function addOrUpdateThumbnailImage() {
    if (!isEnabled()) return;
    if (!(window.YouTubeUtils?.isWatchPage?.(window.location.href) ?? false)) return;

    const newVideoId = getCurrentVideoId();

    if (newVideoId !== thumbnailPreviewCurrentVideoId) {
      thumbnailPreviewClosed = false;
      removeOldOverlay();
    }

    if (shouldSkipThumbnailUpdate(newVideoId)) {
      return;
    }

    thumbnailPreviewCurrentVideoId = newVideoId || '';
    attemptInsertion();
  }

  function createThumbnailOverlay(/** @type {any} */ videoId, /** @type {any} */ container) {
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
    /** @type {any} */ (svg).style.transition = 'stroke 0.2s ease';

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
    /** @type {any} */ (overlay).style.cssText = `
        position: absolute;
        bottom: 8px;
        left: 8px;
        background: var(--yt-thumbnail-overlay-idle);
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
      /** @type {any} */ (overlay).style.background = 'var(--yt-thumbnail-overlay-hover)';
    };
    overlay.onmouseleave = () => {
      /** @type {any} */ (overlay).style.background = 'var(--yt-thumbnail-overlay-idle)';
    };

    overlay.onclick = async (/** @type {any} */ e) => {
      /** @type {any} */ (e).preventDefault();
      /** @type {any} */ (e).stopPropagation();

      const isShorts =
        container.closest('ytm-shorts-lockup-view-model') ||
        container.closest('.shortsLockupViewModelHost') ||
        container.closest('[class*="shortsLockupViewModelHost"]') ||
        container.querySelector('a[href*="/shorts/"]');

      await openThumbnail(videoId, !!isShorts, overlay);
    };

    return overlay;
  }

  /**
   * Find thumbnail container from image
   * @param {HTMLImageElement} img - Image element
   * @returns {HTMLElement|null} Thumbnail container
   */
  function findThumbnailContainerFromImage(img) {
    return /** @type {HTMLElement | null} */ (
      img.closest('yt-thumbnail-view-model') || img.parentElement
    );
  }

  /**
   * Find thumbnail container for shorts
   * @param {HTMLImageElement | null} shortsImg - Shorts image
   * @returns {HTMLElement|null} Thumbnail container
   */
  function findShortsThumbnailContainer(shortsImg) {
    if (!shortsImg) return null;

    return /** @type {HTMLElement | null} */ (
      shortsImg.closest('.ytCoreImageHost') ||
        shortsImg.closest('[class*="ThumbnailContainer"]') ||
        shortsImg.closest('[class*="ImageHost"]') ||
        shortsImg.parentElement
    );
  }

  /**
   * Extract video ID and container from regular video
   * @param {HTMLElement} container - Container element
   * @returns {{videoId: string|null, thumbnailContainer: HTMLElement|null}} Result
   */
  function extractVideoInfo(container) {
    const img = /** @type {HTMLImageElement | null} */ (
      container.querySelector('img[src*="ytimg.com"]')
    );
    if (!img?.src) return { videoId: null, thumbnailContainer: null };

    const videoId = extractVideoId(img.src);
    const thumbnailContainer = findThumbnailContainerFromImage(img);
    return { videoId, thumbnailContainer };
  }

  /**
   * Extract shorts ID and container
   * @param {HTMLElement} container - Container element
   * @returns {{videoId: string|null, thumbnailContainer: HTMLElement|null}} Result
   */
  function extractShortsInfo(container) {
    const link = container.querySelector('a[href*="/shorts/"]');
    if (!link?.href) return { videoId: null, thumbnailContainer: null };

    const videoId = extractShortsId(link.href);
    const shortsImg = /** @type {HTMLImageElement | null} */ (
      container.querySelector('img[src*="ytimg.com"]')
    );
    const thumbnailContainer = findShortsThumbnailContainer(shortsImg);
    return { videoId, thumbnailContainer };
  }

  /**
   * Ensure container has relative positioning
   * @param {HTMLElement} thumbnailContainer - Thumbnail container
   * @returns {void}
   */
  function ensureRelativePosition(thumbnailContainer) {
    if (getComputedStyle(/** @type {Element} */ (thumbnailContainer)).position === 'static') {
      /** @type {any} */ (thumbnailContainer).style.position = 'relative';
    }
  }

  /**
   * Setup hover effects for overlay
   * @param {HTMLElement} thumbnailContainer - Thumbnail container
   * @param {HTMLElement} overlay - Overlay element
   * @returns {void}
   */
  function setupOverlayHoverEffects(thumbnailContainer, overlay) {
    thumbnailContainer.onmouseenter = () => {
      /** @type {any} */ (overlay).style.opacity = '1';
    };
    thumbnailContainer.onmouseleave = () => {
      /** @type {any} */ (overlay).style.opacity = '0';
    };
  }

  /**
   * Add thumbnail overlay to container
   * @param {HTMLElement} container - Container element
   * @returns {void}
   */
  function addThumbnailOverlay(container) {
    if (!isEnabled()) return;
    if (container.querySelector('.thumb-overlay')) return;

    // Try regular video first
    let { videoId, thumbnailContainer } = extractVideoInfo(container);

    // If no video found, try shorts
    if (!videoId) {
      ({ videoId, thumbnailContainer } = extractShortsInfo(container));
    }

    if (!videoId || !thumbnailContainer) return;

    ensureRelativePosition(thumbnailContainer);

    const overlay = createThumbnailOverlay(videoId, container);
    overlay.className = 'thumb-overlay';
    thumbnailContainer.appendChild(overlay);

    setupOverlayHoverEffects(thumbnailContainer, overlay);
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
    /** @type {any} */ (svg).style.transition = 'stroke 0.2s ease';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '8');
    circle.setAttribute('r', '5');
    svg.appendChild(circle);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 21a8 8 0 0 0-16 0');
    svg.appendChild(path);

    overlay.appendChild(svg);

    /** @type {any} */ (overlay).style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--yt-thumbnail-overlay-hover);
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
      /** @type {any} */ (overlay).style.background = 'var(--yt-thumbnail-overlay-active)';
    };
    overlay.onmouseleave = () => {
      /** @type {any} */ (overlay).style.background = 'var(--yt-thumbnail-overlay-hover)';
    };

    return overlay;
  }

  function addAvatarOverlay(/** @type {any} */ img) {
    if (!isEnabled()) return;
    const container = img.parentElement;
    if (!container) return;

    // Don't add avatar overlay on avatar buttons or when inside a button.
    // This avoids adding the overlay on elements like `avatar-btn` which are
    // already interactive controls and may conflict with their behavior.
    if (
      img.closest('.avatar-btn, #avatar-btn') ||
      container.closest('.avatar-btn, #avatar-btn') ||
      img.closest('button') ||
      container.closest('button') ||
      // Skip when inside the thumbnail modal wrapper (don't add overlays inside modals)
      img.closest('.thumbnail-modal-wrapper') ||
      container.closest('.thumbnail-modal-wrapper')
    ) {
      return;
    }

    // Don't add avatar overlay inside Shorts lockups/containers — these are
    // special UI elements where avatar overlays are undesirable.
    if (
      img.closest('ytm-shorts-lockup-view-model') ||
      container.closest('ytm-shorts-lockup-view-model') ||
      img.closest('.shortsLockupViewModelHost') ||
      container.closest('.shortsLockupViewModelHost') ||
      img.closest('[class*="shortsLockupViewModelHost"]') ||
      container.closest('[class*="shortsLockupViewModelHost"]') ||
      img.closest('[class*="shorts"]') ||
      container.closest('[class*="shorts"]')
    ) {
      return;
    }

    if (container.querySelector('.avatar-overlay')) return;

    if (getComputedStyle(container).position === 'static') {
      /** @type {any} */ (container).style.position = 'relative';
    }

    const overlay = createAvatarOverlay();
    overlay.className = 'avatar-overlay';

    overlay.onclick = e => {
      /** @type {any} */ (e).preventDefault();
      /** @type {any} */ (e).stopPropagation();
      const highResUrl = img.src.replace(/=s\d+-c-k-c0x00ffffff-no-rj.*/, '=s0');
      showImageModal(highResUrl);
    };

    container.appendChild(overlay);

    container.onmouseenter = () => {
      /** @type {any} */ (overlay).style.opacity = '1';
    };
    container.onmouseleave = () => {
      /** @type {any} */ (overlay).style.opacity = '0';
    };
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
    /** @type {any} */ (svg).style.transition = 'stroke 0.2s ease';

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

    /** @type {any} */ (overlay).style.cssText = `
        position: absolute;
        bottom: 8px;
        left: 8px;
        background: var(--yt-thumbnail-overlay-hover);
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
      /** @type {any} */ (overlay).style.background = 'var(--yt-thumbnail-overlay-active)';
    };
    overlay.onmouseleave = () => {
      /** @type {any} */ (overlay).style.background = 'var(--yt-thumbnail-overlay-hover)';
    };

    return overlay;
  }

  function addBannerOverlay(/** @type {any} */ img) {
    if (!isEnabled()) return;
    const container = img.parentElement;
    if (container.querySelector('.banner-overlay')) return;

    if (getComputedStyle(container).position === 'static') {
      /** @type {any} */ (container).style.position = 'relative';
    }

    const overlay = createBannerOverlay();
    overlay.className = 'banner-overlay';

    overlay.onclick = e => {
      /** @type {any} */ (e).preventDefault();
      /** @type {any} */ (e).stopPropagation();
      const highResUrl = img.src.replace(/=w\d+-.*/, '=s0');
      showImageModal(highResUrl);
    };

    container.appendChild(overlay);

    container.onmouseenter = () => {
      /** @type {any} */ (overlay).style.opacity = '1';
    };
    container.onmouseleave = () => {
      /** @type {any} */ (overlay).style.opacity = '0';
    };
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
      qsAll(selector).forEach((/** @type {any} */ img) => {
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
      qsAll(selector).forEach((/** @type {any} */ img) => {
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
    // Cache NodeLists to avoid repeated DOM lookups and reduce GC churn
    const n1 = qsAll('yt-thumbnail-view-model');
    for (let i = 0; i < n1.length; i++) addThumbnailOverlay(/** @type {HTMLElement} */ (n1[i]));

    const n2 = qsAll('.ytd-thumbnail');
    for (let i = 0; i < n2.length; i++) addThumbnailOverlay(/** @type {HTMLElement} */ (n2[i]));

    const n3 = qsAll('ytm-shorts-lockup-view-model');
    for (let i = 0; i < n3.length; i++) addThumbnailOverlay(/** @type {HTMLElement} */ (n3[i]));

    const n4 = qsAll('.shortsLockupViewModelHost');
    for (let i = 0; i < n4.length; i++) addThumbnailOverlay(/** @type {HTMLElement} */ (n4[i]));

    const n5 = qsAll('[class*="shortsLockupViewModelHost"]');
    for (let i = 0; i < n5.length; i++) addThumbnailOverlay(/** @type {HTMLElement} */ (n5[i]));
  }

  function processAll() {
    if (!isEnabled()) return;
    processThumbnails();
    processAvatars();
    processBanners();
    addOrUpdateThumbnailImage();
  }

  // Throttle/debounce processing to avoid expensive full-page rescans on every DOM mutation.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let processAllTimerId = null;
  let lastProcessAllTime = 0;
  const MIN_PROCESS_ALL_INTERVAL = 350;

  function scheduleProcessAll(minDelay = 0) {
    if (processAllTimerId) return;
    const now = Date.now();
    const dueIn = Math.max(
      minDelay,
      Math.max(0, MIN_PROCESS_ALL_INTERVAL - (now - lastProcessAllTime))
    );

    processAllTimerId = setTimeout_(() => {
      processAllTimerId = null;
      lastProcessAllTime = Date.now();
      try {
        if (!isEnabled()) return;
        processAll();
      } catch (e) {
        window.console.error('[YouTube+][Thumbnail]', 'processAll failed:', e);
      }
    }, dueIn);
  }

  function setupMutationObserver() {
    if (mutationObserverSubId) return;

    // Scope to #content or #page-manager instead of full body for performance
    const startObserving = () => {
      const coordinator = window.YouTubeMutationCoordinator;
      if (!coordinator?.subscribeRoot) return;
      const target = qs('#content') || qs('#page-manager') || document.body;
      mutationObserverSubId = 'thumbnail::routeObserver';
      coordinator.subscribeRoot(
        mutationObserverSubId,
        () => {
          scheduleProcessAll(120);
        },
        {
          selector: target instanceof Element ? undefined : '#content, #page-manager',
          childList: true,
          attributes: false,
          subtree: target !== document.body,
        }
      );
    };

    if (document.body) {
      startObserving();
    } else {
      document.addEventListener('DOMContentLoaded', startObserving);
    }
  }

  function teardownMutationObserver() {
    if (!mutationObserverSubId) return;
    const coordinator = window.YouTubeMutationCoordinator;
    if (coordinator?.unsubscribe) {
      coordinator.unsubscribe(mutationObserverSubId);
    }
    mutationObserverSubId = null;
  }

  function setupUrlChangeDetection() {
    let currentUrl = location.href;

    const onNavChange = () => {
      setTimeout_(() => {
        if (!isEnabled()) return;
        if (location.href !== currentUrl) {
          currentUrl = location.href;
          scheduleProcessAll(250);
        }
      }, 100);
    };

    const ytNavigateHandler = () => {
      if (!isEnabled()) return;
      if (location.href !== currentUrl) {
        currentUrl = location.href;
      }
      scheduleProcessAll(120);
    };

    // Use centralized pushState/replaceState event from utils.js
    window.addEventListener('ytp-history-navigate', onNavChange);
    window.addEventListener('popstate', onNavChange);
    window.addEventListener('yt-navigate-finish', ytNavigateHandler);

    return () => {
      try {
        window.removeEventListener('ytp-history-navigate', onNavChange);
        window.removeEventListener('popstate', onNavChange);
        window.removeEventListener('yt-navigate-finish', ytNavigateHandler);
      } catch (e) {
        // Non-critical, suppressed
      }
    };
  }

  function removeInjectedUi() {
    try {
      qsAll('.thumbnail-modal-overlay').forEach(m => m.remove());
    } catch (e) {
      // Non-critical, suppressed
    }
    try {
      qsAll('.thumb-overlay, .avatar-overlay, .banner-overlay').forEach(el => el.remove());
    } catch (e) {
      // Non-critical, suppressed
    }
    try {
      const playerOverlay = qs('#thumbnailPreview-player-overlay');
      if (playerOverlay) playerOverlay.remove();
    } catch (e) {
      // Non-critical, suppressed
    }
  }

  function stop() {
    if (!started) return;
    started = false;

    try {
      if (processAllTimerId) {
        clearTimeout(processAllTimerId);
        processAllTimerId = null;
      }
    } catch (e) {
      // Non-critical, suppressed
    }

    teardownMutationObserver();

    if (urlChangeCleanup) {
      try {
        urlChangeCleanup();
      } catch (e) {
        // Non-critical, suppressed
      }
      urlChangeCleanup = null;
    }

    removeInjectedUi();
    removeThumbnailStyles();
  }

  function start() {
    if (started) return;
    if (!isEnabled()) return;

    started = true;
    ensureThumbnailStyles();

    if (!urlChangeCleanup) {
      urlChangeCleanup = setupUrlChangeDetection();
    }
    setupMutationObserver();

    // Defer heavy work off the critical path.
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => scheduleProcessAll(0), { timeout: 2000 });
    } else {
      scheduleProcessAll(400);
    }

    // A couple of spaced retries for late-loaded nodes.
    setTimeout_(() => scheduleProcessAll(0), 900);
    setTimeout_(() => scheduleProcessAll(0), 1800);

    // Safety net: LazyLoader dispatches ytp:nav-refresh after every SPA nav.
    // Re-process thumbnails so previews/avatars get applied to freshly
    // rendered YouTube DOM after in-page navigation.
    try {
      window.addEventListener('ytp:nav-refresh', () => {
        try {
          if (thumbnailFeatureEnabled) scheduleProcessAll(0);
        } catch (e) {
          void e;
        }
      });
    } catch (e) {
      void e;
    }
  }

  function startMaybe() {
    if (started || startScheduled) return;
    if (!isEnabled()) return;
    if (!isRelevantRoute()) return;

    startScheduled = true;
    const run = () => {
      startScheduled = false;
      start();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout_(run, 100), {
        once: true,
      });
    } else {
      setTimeout_(run, 100);
    }
  }

  function setEnabled(/** @type {any} */ nextEnabled) {
    thumbnailFeatureEnabled = nextEnabled !== false;
    if (thumbnailFeatureEnabled) startMaybe();
    else stop();
  }

  // Initial state
  if (window.YouTubePlusLazyLoader) {
    window.YouTubePlusLazyLoader.register(
      'thumbnail',
      startMaybe,
      /** @type {any} */ ({
        priority: 1,
        shouldLoad: isRelevantRoute,
      })
    );
  } else {
    startMaybe();
  }

  // Live updates
  window.addEventListener('youtube-plus-settings-updated', (/** @type {any} */ e) => {
    try {
      const enabledFromEvent = /** @type {any} */ (e).detail?.enableThumbnail;
      setEnabled(enabledFromEvent !== false);
    } catch (e) {
      setEnabled(loadEnableThumbnail());
    }
  });
})();
