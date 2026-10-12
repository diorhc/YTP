// Thumbnail viewer.
//
// Responsibility: while `enableThumbnail` is on, add preview buttons to
//   video thumbnails, avatars, banners and the player, and show the
//   full-size image in a modal with open and download actions.
// Public surface: window.YouTubePlusThumbnail.
(function () {
  const U = window.YouTubeUtils;
  // One stable click closure per dock button, so repeated
  // mountDock calls dedup to a single live registration.
  /** @type {WeakMap<HTMLElement, (e: Event) => void>} */
  const dockClickHandlers = new WeakMap();
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'Thumbnail');

  const { $: qs, $$: qsAll, t, logger: thumbLogger, setTimeout_ } = U?.helpers ?? {};

  const isAllowedHost = (/** @type {string} */ host, /** @type {string} */ domain) => {
    const normalizedHost = String(host || '').toLowerCase();
    const normalizedDomain = String(domain || '').toLowerCase();
    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
  };

  /** Marks a YouTube element that hosts one of our overlays. */
  const HOST_ATTR = 'data-yp-thumb-host';
  /** Set when we switched the host from static to relative positioning. */
  const HOST_POSITION_ATTR = 'data-yp-thumb-position';

  /** Feature context while `enableThumbnail` is on. @type {YouTubePlusFeatureContext | null} */
  let thumbCtx = null;
  /** The open image modal. @type {YouTubePlusFeatureContext | null} */
  let modalScope = null;
  /** The player-bar button. @type {YouTubePlusFeatureContext | null} */
  let playerScope = null;

  /**
   * Extract video ID from thumbnail source with validation
   * @param {string} thumbnailSrc - Thumbnail source URL
   * @returns {string|null} Video ID or null if invalid
   */
  function extractVideoId(thumbnailSrc) {
    if (!thumbnailSrc || typeof thumbnailSrc !== 'string') return null;
    const match = thumbnailSrc.match(/\/vi\/([^/]+)\//);
    const videoId = match ? match[1] : null;
    // Validate video ID format (11 characters, alphanumeric + - and _)
    if (videoId && !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      thumbLogger?.warn?.('Thumbnail', 'Invalid video ID format', videoId);
      return null;
    }
    return videoId;
  }

  /**
   * Extract shorts ID from URL with validation
   * @param {string} href - URL to extract shorts ID from
   * @returns {string|null} Shorts ID or null if invalid
   */
  function extractShortsId(href) {
    if (U?.getVideoIdFromUrl) {
      return U.getVideoIdFromUrl(href);
    }
    if (!href || typeof href !== 'string') return null;
    const match = href.match(/\/shorts\/([^/?]+)/);
    const shortsId = match ? match[1] : null;
    if (shortsId && !/^[a-zA-Z0-9_-]{11}$/.test(shortsId)) {
      thumbLogger?.warn?.('Thumbnail', 'Invalid shorts ID format', shortsId);
      return null;
    }
    return shortsId;
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
      thumbLogger?.warn?.('Thumbnail', 'Invalid URL provided');
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
      thumbLogger?.warn?.('Thumbnail', 'Only HTTPS URLs are allowed');
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
    if (!(isAllowedHost(hostname, 'ytimg.com') || isAllowedHost(hostname, 'youtube.com'))) {
      thumbLogger?.warn?.('Thumbnail', 'Only YouTube image domains are allowed');
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
    // `new URL` rejects malformed input text.
    try {
      const parsedUrl = new URL(url);
      if (!hasValidProtocol(parsedUrl)) return null;
      if (!hasValidDomain(parsedUrl)) return null;
      return parsedUrl;
    } catch (error) {
      logS(error);
      thumbLogger?.error?.('Thumbnail', 'Invalid URL', error);
      return null;
    }
  }

  /**
   * @param {string} url - Image URL
   * @returns {Promise<boolean|null>} True/false when the HEAD request is
   *   definitive; null on network error, CORS block, or timeout/abort, so
   *   callers fall back to `checkViaImageLoad`.
   */
  async function checkViaHeadRequest(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout_(() => controller.abort(), 5000);

    const response = await fetch?.(url, {
      method: 'HEAD',
      signal: controller.signal,
    })?.catch?.(() => null);

    clearTimeout(timeoutId);
    return response ? response.ok : null;
  }

  /**
   * Cleanup image element
   * @param {HTMLImageElement} img - Image element
   */
  function cleanupImageElement(img) {
    img.onload = null;
    img.onerror = null;
    img.src = ''; // Cancel any in-flight loading
    if (img.parentNode) {
      img.parentNode.removeChild(img);
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
      img.style.display = 'none';

      const timeout = setTimeout_(() => {
        cleanupImageElement(img);
        resolve(false);
      }, 3000);

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
    if (!isValidUrlString(url)) return false;

    const parsedUrl = parseAndValidateUrl(url);
    if (!parsedUrl) return false;

    // Try HEAD request first
    const headResult = await checkViaHeadRequest(url);
    if (headResult !== null) return headResult;

    // Fallback to image load test
    return await checkViaImageLoad(url);
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Apply the shared base attribute set to an inline SVG icon element.
   * @param {SVGElement} svg
   */
  function applySvgIconBaseAttrs(svg) {
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'white');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }

  function createSpinner() {
    const spinner = document.createElementNS(SVG_NS, 'svg');
    spinner.setAttribute('xmlns', SVG_NS);
    applySvgIconBaseAttrs(spinner);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M21 12a9 9 0 1 1-6.219-8.56');
    spinner.appendChild(path);

    /** @type {SVGElement} */ (spinner).style.animation = 'spin 1s linear infinite';

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
  const isValidVideoId = /** @type {(id: string | null) => boolean} */ (
    window.YouTubeSafeDOM?.isValidVideoId ||
      (id => !!(id && typeof id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(id)))
  );

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
      if (spinner?.parentNode) {
        overlayElement.replaceChild(originalSvg, spinner);
      }
    } catch (restoreError) {
      logS(restoreError);
      thumbLogger?.error?.('Thumbnail', 'Error restoring original SVG', restoreError);
      if (spinner?.parentNode) {
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
        thumbLogger?.error?.('Thumbnail', 'Invalid video ID', videoId);
        return;
      }

      if (!isValidOverlayElement(overlayElement)) {
        thumbLogger?.error?.('Thumbnail', 'Invalid overlay element');
        return;
      }

      const originalSvg = overlayElement.querySelector('svg');
      if (!originalSvg) {
        thumbLogger?.warn?.('Thumbnail', 'No SVG found in overlay element');
        return;
      }

      const spinner = replaceWithSpinner(overlayElement, originalSvg);

      try {
        await loadAndShowThumbnail(videoId, isShorts);
      } finally {
        restoreOriginalSvg(overlayElement, spinner, originalSvg);
      }
    } catch (error) {
      logS(error);
      thumbLogger?.error?.('Thumbnail', 'Error opening thumbnail', error);
    }
  }

  /**
   * Validate modal URL security
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid
   */
  function validateModalUrl(url) {
    if (!url || typeof url !== 'string') {
      thumbLogger?.error?.('Thumbnail', 'Invalid URL provided to modal');
      return false;
    }

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:') {
        thumbLogger?.error?.('Thumbnail', 'Only HTTPS URLs are allowed');
        return false;
      }
      const allowedDomains = ['ytimg.com', 'youtube.com', 'ggpht.com', 'googleusercontent.com'];
      if (!allowedDomains.some(d => isAllowedHost(parsedUrl.hostname, d))) {
        thumbLogger?.error?.('Thumbnail', 'Image domain not allowed', parsedUrl.hostname);
        return false;
      }
      return true;
    } catch (urlError) {
      logS(urlError);
      thumbLogger?.error?.('Thumbnail', 'Invalid URL format', urlError);
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
    img.style.cursor = 'pointer';
    modalScope?.listen(img, 'click', () =>
      U?.openSafe ? U.openSafe(img.src, '_blank') : window.open(img.src, '_blank')
    );
    return img;
  }

  /**
   * Create close button for modal
   * @returns {HTMLButtonElement} Close button
   */
  function createCloseButton() {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'thumbnail-modal-close thumbnail-modal-action-btn yp-settings-close';
    closeBtn.setAttribute('data-shared-close-button', 'yp-close-settings');
    window.YouTubeUtils.renderTemplateClone(
      closeBtn,
      `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>`
    );
    closeBtn.title = t('closeButton') || t('close');
    closeBtn.setAttribute('aria-label', t('closeButton') || t('close'));
    return closeBtn;
  }

  /**
   * Open an image URL in a new tab, preferring the safe opener
   * @param {HTMLImageElement} img
   */
  function openImageInNewTab(img) {
    if (U?.openSafe) U.openSafe(img.src, '_blank');
    else window.open(img.src, '_blank');
  }

  /**
   * Attach the download-with-fallback behavior shared by the modal and
   * classic header download buttons
   * @param {HTMLButtonElement} btn
   * @param {HTMLImageElement} img
   */
  function attachImageDownloadBehavior(btn, img) {
    modalScope?.listen(btn, 'click', async (/** @type {Event} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await downloadImageAsBlob(img.src);
      } catch (_e) {
        logS(_e);
        openImageInNewTab(img);
      }
    });
  }

  /**
   * Create open in new tab button for modal
   * @param {HTMLImageElement} img - Image element
   * @returns {HTMLButtonElement} New tab button
   */
  function createNewTabButton(img) {
    const newTabBtn = document.createElement('button');
    newTabBtn.className = 'thumbnail-modal-open thumbnail-modal-action-btn yp-settings-close';
    window.YouTubeUtils.renderTemplateClone(
      newTabBtn,
      `\n            <svg fill="currentColor" viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" stroke="currentColor">\n        <g id="SVGRepo_bgCarrier" stroke-width="0"></g>\n        <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>\n        <g id="SVGRepo_iconCarrier"><path d="M14.293,9.707a1,1,0,0,1,0-1.414L18.586,4H16a1,1,0,0,1,0-2h5a1,1,0,0,1,1,1V8a1,1,0,0,1-2,0V5.414L15.707,9.707a1,1,0,0,1-1.414,0ZM3,22H8a1,1,0,0,0,0-2H5.414l4.293-4.293a1,1,0,0,0-1.414-1.414L4,18.586V16a1,1,0,0,0-2,0v5A1,1,0,0,0,3,22Z"></path></g>\n      </svg>\n        `
    );
    newTabBtn.title = t('clickToOpen');
    newTabBtn.setAttribute('aria-label', t('clickToOpen'));
    modalScope?.listen(newTabBtn, 'click', (/** @type {Event} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      openImageInNewTab(img);
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
    } catch (_e) {
      logS(_e);
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
    downloadBtn.className = 'thumbnail-modal-download thumbnail-modal-action-btn yp-settings-close';
    window.YouTubeUtils.renderTemplateClone(
      downloadBtn,
      `\n            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="0.5" d="M3 15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M12 3V16M12 16L16 11.625M12 16L8 11.625" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>\n        `
    );
    downloadBtn.title = t('download');
    downloadBtn.setAttribute('aria-label', t('download'));
    attachImageDownloadBehavior(downloadBtn, img);
    return downloadBtn;
  }

  /**
   * Escape closes the modal.
   * @param {() => void} close
   */
  function setupModalKeyboard(close) {
    modalScope?.listen(
      window,
      'keydown',
      (/** @type {Event} */ e) => {
        if (e instanceof KeyboardEvent && e.key === 'Escape') close();
      },
      { capture: true }
    );
  }

  /**
   * Setup modal image error handler
   * @param {HTMLImageElement} img - Image element
   * @param {HTMLElement} content - Content container
   */
  function setupImageErrorHandler(img, content) {
    modalScope?.listen(img, 'error', () => {
      const err = document.createElement('div');
      err.textContent = t('thumbnailLoadFailed');
      err.style.color = 'white';
      content.appendChild(err);
    });
  }

  /**
   * Create Classic mode header
   * @param {string} badgeText
   * @param {HTMLImageElement} img
   * @returns {{ classicHeader: HTMLElement, resSpan: HTMLElement, classicCloseBtn: HTMLButtonElement }}
   */
  function createClassicHeader(badgeText, img) {
    const classicHeader = document.createElement('div');
    classicHeader.className = 'thumbnail-classic-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'thumbnail-classic-title-group';

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'thumbnail-classic-badge';
    badgeSpan.textContent = badgeText;

    const resSpan = document.createElement('span');
    resSpan.className = 'thumbnail-classic-res-text';

    titleGroup.appendChild(badgeSpan);
    titleGroup.appendChild(resSpan);

    const classicActions = document.createElement('div');
    classicActions.className = 'thumbnail-classic-actions';

    const classicDownloadBtn = document.createElement('button');
    classicDownloadBtn.className = 'thumbnail-classic-btn thumbnail-classic-download-btn';
    classicDownloadBtn.title = t('download') || 'Download';
    classicDownloadBtn.setAttribute('aria-label', t('download') || 'Download');
    window.YouTubeUtils.renderTemplateClone(
      classicDownloadBtn,
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
    );
    attachImageDownloadBehavior(classicDownloadBtn, img);

    const classicOpenBtn = document.createElement('button');
    classicOpenBtn.className = 'thumbnail-classic-btn thumbnail-classic-open-btn';
    classicOpenBtn.title = t('clickToOpen') || 'Open in new tab';
    classicOpenBtn.setAttribute('aria-label', t('clickToOpen') || 'Open in new tab');
    window.YouTubeUtils.renderTemplateClone(
      classicOpenBtn,
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
    );
    modalScope?.listen(classicOpenBtn, 'click', (/** @type {Event} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      openImageInNewTab(img);
    });

    const classicCloseBtn = document.createElement('button');
    classicCloseBtn.className = 'thumbnail-classic-btn thumbnail-classic-close-btn';
    classicCloseBtn.title = t('closeButton') || t('close') || 'Close';
    classicCloseBtn.setAttribute('aria-label', t('closeButton') || t('close') || 'Close');
    window.YouTubeUtils.renderTemplateClone(
      classicCloseBtn,
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`
    );

    classicActions.appendChild(classicDownloadBtn);
    classicActions.appendChild(classicOpenBtn);
    classicActions.appendChild(classicCloseBtn);

    classicHeader.appendChild(titleGroup);
    classicHeader.appendChild(classicActions);

    return { classicHeader, resSpan, classicCloseBtn };
  }

  /**
   * Create Vision mode floating top pill
   * @param {string} badgeText
   * @returns {{ visionTopPill: HTMLElement, visionResText: HTMLElement }}
   */
  function createVisionTopPill(badgeText) {
    const visionTopPill = document.createElement('div');
    visionTopPill.className = 'vision-top-pill vision-pill-left';
    const visionBadge = document.createElement('span');
    visionBadge.className = 'vision-top-pill-red';
    visionBadge.textContent = badgeText;
    const visionResText = document.createElement('span');
    visionTopPill.appendChild(visionBadge);
    visionTopPill.appendChild(visionResText);
    return { visionTopPill, visionResText };
  }

  /**
   * Show image in modal with error handling and security
   * @param {string} url - Image URL to display
   * @returns {void}
   */
  function showImageModal(url) {
    if (!thumbCtx) return;
    if (!validateModalUrl(url)) return;

    // One modal at a time: its group owns the overlay and every listener.
    modalScope?.dispose();
    modalScope = thumbCtx.scope();
    const scope = modalScope;

    const overlay = document.createElement('div');
    overlay.className = 'thumbnail-modal-overlay yp-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t('thumbnailPreview'));

    const content = document.createElement('div');
    content.className = 'thumbnail-modal-content yp-modal-content';

    const img = createModalImage(url);

    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'thumbnail-modal-options';

    const isMaxRes = url.includes('maxresdefault');
    const badgeRaw = isMaxRes ? t('thumbnailBadge4k') : t('thumbnailBadgeHd');
    const badgeText =
      !badgeRaw || badgeRaw.startsWith('thumbnailBadge')
        ? isMaxRes
          ? '4K UHD'
          : 'HD Preview'
        : badgeRaw;

    const { classicHeader, resSpan, classicCloseBtn } = createClassicHeader(badgeText, img);
    const { visionTopPill, visionResText } = createVisionTopPill(badgeText);

    const updateDimensions = () => {
      if (img.naturalWidth && img.naturalHeight) {
        const dimText = `${img.naturalWidth} × ${img.naturalHeight} px`;
        resSpan.textContent = dimText;
        visionResText.textContent = dimText;
      }
    };
    modalScope.listen(img, 'load', updateDimensions);
    if (img.complete && img.naturalWidth) {
      updateDimensions();
    }

    const closeBtn = createCloseButton();
    const newTabBtn = createNewTabButton(img);
    const downloadBtn = createDownloadButton(img);

    content.appendChild(classicHeader);
    content.appendChild(img);
    content.appendChild(optionsDiv);

    const wrapper = document.createElement('div');
    wrapper.className = 'thumbnail-modal-wrapper';

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'thumbnail-modal-actions';

    actionsDiv.appendChild(closeBtn);
    actionsDiv.appendChild(newTabBtn);
    actionsDiv.appendChild(downloadBtn);

    wrapper.appendChild(visionTopPill);
    wrapper.appendChild(content);
    wrapper.appendChild(actionsDiv);
    overlay.appendChild(wrapper);

    scope.own(overlay);
    const closeOverlay = () => {
      scope.dispose();
      if (modalScope === scope) modalScope = null;
    };

    modalScope.listen(overlay, 'click', (/** @type {Event} */ { target }) => {
      if (target === overlay) closeOverlay();
    });
    modalScope.listen(closeBtn, 'click', (/** @type {Event} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
    });
    modalScope.listen(classicCloseBtn, 'click', (/** @type {Event} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
    });

    setupModalKeyboard(closeOverlay);
    setupImageErrorHandler(img, content);

    document.body.appendChild(overlay);

    // Focus trap and initial focus
    scope.frame(() => {
      const focusTarget = overlay.querySelector('button, [tabindex="0"]');
      if (focusTarget) /** @type {HTMLElement} */ (focusTarget).focus();
    });
    const removeTrap = window.YouTubePlusModalHandlers?.createFocusTrap?.(overlay);
    if (removeTrap) scope.onDispose(removeTrap);
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
    return U.getVideoIdFromLocation();
  }

  /**
   * Remove old thumbnail button/overlay
   */
  function removeOldOverlay() {
    const oldBtn = qs('#thumbnailPreview-player-button');
    if (oldBtn) oldBtn.remove();
    const oldOverlay = qs('#thumbnailPreview-player-overlay');
    if (oldOverlay) oldOverlay.remove();
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
   * Find controls element with retry logic
   * @returns {HTMLElement|null} Controls element or null
   */
  function findControlsElement() {
    return /** @type {HTMLElement | null} */ (qs('.ytp-right-controls'));
  }

  /**
   * Append the shared viewer icon shapes (frame, lens dot, pointer) to an
   * inline SVG element. The variants differ exactly in these attributes.
   * @param {SVGElement} svg
   * @param {{ rx: string, circleCx: string, circleCy: string, circleR: string, circleFill?: string, polylinePoints: string }} opts
   */
  function appendViewerIconShapes_(svg, opts) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '3');
    rect.setAttribute('y', '3');
    rect.setAttribute('width', '18');
    rect.setAttribute('height', '18');
    rect.setAttribute('rx', opts.rx);
    rect.setAttribute('ry', opts.rx);
    svg.appendChild(rect);

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', opts.circleCx);
    circle.setAttribute('cy', opts.circleCy);
    circle.setAttribute('r', opts.circleR);
    if (opts.circleFill) circle.setAttribute('fill', opts.circleFill);
    svg.appendChild(circle);

    const polyline = document.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute('points', opts.polylinePoints);
    svg.appendChild(polyline);
  }

  /** Register a deduped click handler for a dock button; returns its disposer. */
  function registerDockButtonListener(
    /** @type {HTMLElement} */ btn,
    /** @type {(e: Event) => void} */ clickFn
  ) {
    const cmKey = window.YouTubePlusCleanupManager?.registerListener?.(
      btn,
      'click',
      clickFn,
      undefined,
      false
    );
    // Dispose is idempotent; the host calls it on remove/unmount/replace.
    return () => {
      if (cmKey) window.YouTubePlusCleanupManager?.unregisterListener?.(cmKey);
    };
  }

  /**
   * Create thumbnail button for player controls bar
   * @param {string} videoId - Video ID
   * @returns {HTMLElement} Created button element
   */
  function createPlayerThumbnailButton(videoId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ytp-button yp-thumbnail-button';
    button.id = 'thumbnailPreview-player-button';
    button.dataset.videoId = videoId;
    button.setAttribute('title', t('showThumbnailPreview') || 'Show Thumbnail');
    button.setAttribute('aria-label', t('showThumbnailPreview') || 'Show Thumbnail');

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    appendViewerIconShapes_(svg, {
      rx: '3',
      circleCx: '8.5',
      circleCy: '8.5',
      circleR: '1.5',
      circleFill: 'currentColor',
      polylinePoints: '21 15 16 10 5 21',
    });

    button.appendChild(svg);

    playerScope?.listen(button, 'click', async (/** @type {Event} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      await openThumbnail(button.dataset.videoId || videoId, false, button);
    });
    playerScope?.own(button);

    return button;
  }

  /**
   * Attempt to insert thumbnail button into player controls
   */
  function attemptInsertion() {
    if (!thumbCtx) return;
    const controls = findControlsElement();

    if (!controls) {
      thumbnailInsertionAttempts++;
      if (thumbnailInsertionAttempts < MAX_ATTEMPTS) {
        thumbCtx.timeout(attemptInsertion, RETRY_DELAY);
      } else {
        thumbnailInsertionAttempts = 0;
      }
      return;
    }

    const buttonId = 'thumbnailPreview-player-button';
    let button = /** @type {HTMLElement | null} */ (controls.querySelector(`#${buttonId}`));

    if (!button) {
      playerScope?.dispose();
      playerScope = thumbCtx.scope();
      button = createPlayerThumbnailButton(thumbnailPreviewCurrentVideoId);
      controls.insertBefore(button, controls.firstChild);
      thumbnailInsertionAttempts = 0;
      return;
    }

    if (button.dataset.videoId !== thumbnailPreviewCurrentVideoId) {
      button.dataset.videoId = thumbnailPreviewCurrentVideoId;
    }

    thumbnailInsertionAttempts = 0;
  }

  /**
   * Add or update thumbnail image on watch page
   */
  function addOrUpdateThumbnailImage() {
    if (!thumbCtx) return;
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

  function createThumbnailOverlay(
    /** @type {string} */ videoId,
    /** @type {HTMLElement} */ container
  ) {
    const overlay = document.createElement('div');

    const svg = document.createElementNS(SVG_NS, 'svg');
    applySvgIconBaseAttrs(svg);
    /** @type {SVGElement} */ (svg).style.transition = 'stroke 0.2s ease';

    const mainRect = document.createElementNS(SVG_NS, 'rect');
    mainRect.setAttribute('width', '18');
    mainRect.setAttribute('height', '18');
    mainRect.setAttribute('x', '3');
    mainRect.setAttribute('y', '3');
    mainRect.setAttribute('rx', '2');
    mainRect.setAttribute('ry', '2');
    svg.appendChild(mainRect);

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '9');
    circle.setAttribute('cy', '9');
    circle.setAttribute('r', '2');
    svg.appendChild(circle);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21');
    svg.appendChild(path);

    overlay.appendChild(svg);
    overlay.classList.add('thumbnail-base-overlay');

    overlay.onclick = async (/** @type {MouseEvent} */ e) => {
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
    const link = /** @type {HTMLAnchorElement | null} */ (
      container.querySelector('a[href*="/shorts/"]')
    );
    if (!link?.href) return { videoId: null, thumbnailContainer: null };

    const videoId = extractShortsId(link.href);
    const shortsImg = /** @type {HTMLImageElement | null} */ (
      container.querySelector('img[src*="ytimg.com"]')
    );
    const thumbnailContainer = findShortsThumbnailContainer(shortsImg);
    return { videoId, thumbnailContainer };
  }

  /**
   * Mark a YouTube element as an overlay host. The stylesheet shows the
   * overlay on hover; a static host becomes relative so the overlay can be
   * positioned, and is switched back when the feature stops.
   * @param {HTMLElement} host
   */
  function markHost(host) {
    if (host.hasAttribute(HOST_ATTR)) return;
    host.setAttribute(HOST_ATTR, '');
    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
      host.setAttribute(HOST_POSITION_ATTR, '');
    }
  }

  /** Remove every overlay and give the hosts their own styling back. */
  function restoreHosts() {
    for (const el of qsAll('.thumb-overlay, .avatar-overlay, .banner-overlay')) el.remove();
    for (const host of qsAll(`[${HOST_ATTR}]`)) {
      if (host.hasAttribute(HOST_POSITION_ATTR)) {
        /** @type {HTMLElement} */ (host).style.position = '';
        host.removeAttribute(HOST_POSITION_ATTR);
      }
      host.removeAttribute(HOST_ATTR);
    }
  }

  /**
   * Add thumbnail overlay to container
   * @param {HTMLElement} container - Container element
   * @returns {void}
   */
  function addThumbnailOverlay(container) {
    if (!thumbCtx) return;
    if (container.querySelector('.thumb-overlay')) return;

    // Try regular video first
    let { videoId, thumbnailContainer } = extractVideoInfo(container);

    // If no video found, try shorts
    if (!videoId) {
      ({ videoId, thumbnailContainer } = extractShortsInfo(container));
    }

    if (!(videoId && thumbnailContainer)) return;

    markHost(thumbnailContainer);

    const overlay = createThumbnailOverlay(videoId, container);
    overlay.className = 'thumbnail-base-overlay thumb-overlay';
    thumbnailContainer.appendChild(overlay);
  }

  function createAvatarOverlay() {
    const overlay = document.createElement('div');

    const svg = document.createElementNS(SVG_NS, 'svg');
    applySvgIconBaseAttrs(svg);
    /** @type {SVGElement} */ (svg).style.transition = 'stroke 0.2s ease';

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '8');
    circle.setAttribute('r', '5');
    svg.appendChild(circle);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M20 21a8 8 0 0 0-16 0');
    svg.appendChild(path);

    overlay.appendChild(svg);

    overlay.classList.add('thumbnail-base-overlay');

    return overlay;
  }

  function addAvatarOverlay(/** @type {HTMLImageElement} */ img) {
    if (!thumbCtx) return;
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

    // Skip avatar overlays inside Shorts lockups/containers.
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

    markHost(container);

    const overlay = createAvatarOverlay();
    overlay.className = 'thumbnail-base-overlay avatar-overlay';

    overlay.onclick = (/** @type {MouseEvent} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      const highResUrl = img.src.replace(/=s\d+-c-k-c0x00ffffff-no-rj.*/, '=s0');
      showImageModal(highResUrl);
    };

    container.appendChild(overlay);
  }

  function createBannerOverlay() {
    const overlay = document.createElement('div');

    const svg = document.createElementNS(SVG_NS, 'svg');
    applySvgIconBaseAttrs(svg);
    /** @type {SVGElement} */ (svg).style.transition = 'stroke 0.2s ease';
    appendViewerIconShapes_(svg, {
      rx: '2',
      circleCx: '9',
      circleCy: '9',
      circleR: '2',
      polylinePoints: '21,15 16,10 5,21',
    });

    overlay.appendChild(svg);

    overlay.classList.add('thumbnail-base-overlay');

    return overlay;
  }

  function addBannerOverlay(/** @type {HTMLImageElement} */ img) {
    if (!thumbCtx) return;
    const container = img.parentElement;
    if (!container || container.querySelector('.banner-overlay')) return;

    markHost(container);

    const overlay = createBannerOverlay();
    overlay.className = 'thumbnail-base-overlay banner-overlay';

    overlay.onclick = (/** @type {MouseEvent} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      const highResUrl = img.src.replace(/=w\d+-.*/, '=s0');
      showImageModal(highResUrl);
    };

    container.appendChild(overlay);
  }

  // One union query per family per pass replaces the per-selector scans.
  const THUMBNAIL_HOST_SELECTOR =
    'yt-thumbnail-view-model, .ytd-thumbnail, ytm-shorts-lockup-view-model, .shortsLockupViewModelHost, [class*="shortsLockupViewModelHost"]';
  const AVATAR_IMG_SELECTOR =
    'yt-avatar-shape img, #avatar img, ytd-channel-avatar-editor img, .ytd-video-owner-renderer img[src*="yt"], img[src*="yt3.ggpht.com"], img[src*="yt4.ggpht.com"]';
  const BANNER_IMG_SELECTOR =
    'yt-image-banner-view-model img, ytd-c4-tabbed-header-renderer img[src*="yt"], #channel-header img[src*="banner"], img[src*="banner"]';
  // Subscription filter: only batches that add one of these hosts wake the feature.
  const ROOT_MUTATION_SELECTOR = `${THUMBNAIL_HOST_SELECTOR}, ${AVATAR_IMG_SELECTOR}, ${BANNER_IMG_SELECTOR}`;

  /**
   * Query a selector inside a pass's scope: without a root this scans the
   * page; with a root it scans that subtree and matches the root itself, so a
   * newly added thumbnail host gets processed.
   * @param {string} selector
   * @param {Element} [root]
   * @returns {Element[]}
   */
  const scopedQuery = (selector, root) => {
    if (!root) return Array.from(qsAll(selector));
    const self = root.matches(selector) ? [root] : [];
    return self.concat(Array.from(root.querySelectorAll(selector)));
  };

  /**
   * Incremental pass: process only the subtrees the batch introduced instead
   * of scanning the whole document on every live-page mutation.
   * @param {MutationRecord[]} records
   */
  function processMutationBatch(records) {
    if (!thumbCtx) return;
    for (const record of records) {
      // YouTube lazy-loads images: an avatar or banner <img> is often
      // inserted without a src, which it gets later as an attribute change.
      if (record.type === 'attributes') {
        if (record.target instanceof HTMLImageElement) {
          processAvatars(record.target);
          processBanners(record.target);
        }
        continue;
      }
      if (record.type !== 'childList') continue;
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        processThumbnails(node);
        processAvatars(node);
        processBanners(node);
      }
    }
    // The watch-page insert is per-video guarded; batches refresh it too.
    addOrUpdateThumbnailImage();
  }

  /** @param {Element} [root] pass scope: omitted = whole-document scan */
  function processAvatars(root) {
    for (const el of scopedQuery(AVATAR_IMG_SELECTOR, root)) {
      if (!(el instanceof HTMLImageElement)) continue;
      const img = el;
      if (!img.src) continue;
      if (!img.src.includes('yt')) continue;
      if (img.closest('.avatar-overlay')) continue;

      // Проверяем, что это действительно аватар (квадратное изображение)
      const isAvatar = img.naturalWidth > 0 && img.naturalWidth === img.naturalHeight;

      if (isAvatar || img.src.includes('ggpht.com')) {
        addAvatarOverlay(img);
      }
    }
  }

  /** @param {Element} [root] pass scope: omitted = whole-document scan */
  function processBanners(root) {
    for (const el of scopedQuery(BANNER_IMG_SELECTOR, root)) {
      if (!(el instanceof HTMLImageElement)) continue;
      const img = el;
      if (!img.src) continue;
      if (img.closest('.banner-overlay')) continue;

      const isBanner =
        (img.src.includes('banner') || img.src.includes('yt')) &&
        img.naturalWidth > img.naturalHeight * 2; // Баннеры обычно широкие

      if (isBanner || img.src.includes('banner')) {
        addBannerOverlay(img);
      }
    }
  }

  /** @param {Element} [root] pass scope: omitted = whole-document scan */
  function processThumbnails(root) {
    for (const el of scopedQuery(THUMBNAIL_HOST_SELECTOR, root)) {
      addThumbnailOverlay(/** @type {HTMLElement} */ (el));
    }
  }

  function processAll() {
    if (!thumbCtx) return;
    processThumbnails();
    processAvatars();
    processBanners();
    addOrUpdateThumbnailImage();
  }

  // Throttle processing: mutation batches only queue their records; the pass
  // then processes just the added subtrees, keeping the full-page scan for
  // navigation-driven passes.
  /** @type {(() => void) | null} */
  let processRelease = null;
  /** @type {MutationRecord[]} */
  let pendingMutations = [];
  let forceFullPass = false;
  let lastProcessAllTime = 0;
  const MIN_PROCESS_ALL_INTERVAL = 350;

  /**
   * @param {number} [minDelay]
   * @param {MutationRecord[]} [records] mutation batch delivered by the root
   * subscription; records accumulate while a pass is already pending.
   */
  function scheduleProcessAll(minDelay, records) {
    const delay = typeof minDelay === 'number' ? minDelay : 0;
    if (!thumbCtx) {
      pendingMutations.length = 0;
      forceFullPass = false;
      return;
    }
    if (records?.length) {
      pendingMutations = pendingMutations.concat(records);
    } else {
      // Navigation/startup passes rescan everything whatever is queued.
      forceFullPass = true;
    }
    if (processRelease) return;
    const dueIn = Math.max(
      delay,
      Math.max(0, MIN_PROCESS_ALL_INTERVAL - (Date.now() - lastProcessAllTime))
    );
    processRelease = thumbCtx.timeout(() => {
      processRelease = null;
      lastProcessAllTime = Date.now();
      const records = pendingMutations;
      pendingMutations = [];
      const forced = forceFullPass;
      forceFullPass = false;
      if (forced || !records.length) {
        processAll();
      } else {
        processMutationBatch(records);
      }
    }, dueIn);
  }

  /** @param {YouTubePlusFeatureContext} ctx */
  function watchPage(ctx) {
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.subscribeRoot) {
      const target = qs('#content') || qs('#page-manager') || document.body;
      const subId = 'thumbnail::routeObserver';
      coordinator.subscribeRoot(subId, records => scheduleProcessAll(120, records), {
        selector: ROOT_MUTATION_SELECTOR,
        childList: true,
        attributes: true,
        attributeFilter: ['src'],
        subtree: target !== document.body,
      });
      ctx.onDispose(() => coordinator.unsubscribe?.(subId));
    }

    const onNavigate = () => scheduleProcessAll(120);
    ctx.listen(window, 'yt-navigate-finish', onNavigate);
    ctx.listen(window, 'yp-history-navigate', onNavigate);
    ctx.listen(window, 'popstate', onNavigate);
    // LazyLoader dispatches yp:nav-refresh after every SPA navigation.
    ctx.listen(window, 'yp:nav-refresh', () => scheduleProcessAll(0));
  }

  const thumbnailFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'thumbnail',
    settingsKey: 'enableThumbnail',
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      thumbCtx = ctx;
      ctx.style(
        'thumbnail-overlay-styles',
        window.YouTubePlusDesignSystem?.getStyle?.('thumbnail-overlay-styles') || ''
      );
      watchPage(ctx);
      // Late-loaded nodes get two spaced passes after the first one.
      scheduleProcessAll(0);
      ctx.timeout(() => scheduleProcessAll(0), 900);
      ctx.timeout(() => scheduleProcessAll(0), 1800);
      ctx.onDispose(() => {
        processRelease = null;
        pendingMutations.length = 0;
        modalScope = null;
        playerScope = null;
        thumbnailPreviewCurrentVideoId = '';
        thumbnailPreviewClosed = false;
        thumbnailInsertionAttempts = 0;
        restoreHosts();
      });
    },
    stop() {
      thumbCtx = null;
    },
  });

  const YouTubePlusThumbnail = {
    getShortsThumbnailUrls,
    showImageModal,
    registerDockButtonListener,
  };

  window.YouTubePlusThumbnail = YouTubePlusThumbnail;

  // Test-only surface: internal entry points live here, not on the facade root.
  U?.exposeTestHooks?.(YouTubePlusThumbnail, {
    extractVideoId,
    extractShortsId,
    getVideoThumbnailUrls,
  });

  // --- FeatureRegistry descriptor: thumbnail (Vision dock surface) ---
  const descThumbnailIconSVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" ry="3"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21"/></svg>';

  const DESCRIPTOR = {
    id: 'thumbnail',
    titleKey: 'showThumbnailPreview',
    fallbackTitle: 'Thumbnail',
    settingsKey: 'enableThumbnail',
    iconSVG: descThumbnailIconSVG,
    command(/** @type {unknown} */ _shim) {
      const videoId = U.getVideoIdFromUrl(window.location.href);
      if (!videoId) return false;
      const isShorts = window.location.pathname.startsWith('/shorts');
      loadAndShowThumbnail(videoId, isShorts);
      return true;
    },
    mountDock(/** @type {HTMLElement} */ player, /** @type {HTMLElement} */ dock) {
      void player;
      let btn = /** @type {HTMLButtonElement|null} */ (
        dock.querySelector('#yp-vision-thumbnail-btn')
      );
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'yp-vision-thumbnail-btn';
        btn.className = 'vision-dock-btn yp-thumbnail-button';
        const title = U?.t?.('showThumbnailPreview') || 'Thumbnail';
        btn.setAttribute('title', title);
        btn.setAttribute('aria-label', title);
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('role', 'button');
        U.setSafeHTML(btn, descThumbnailIconSVG);
        dock.appendChild(btn);
      }
      // stable per-button closure, so re-mounts dedup to one live
      // registration and the returned dispose releases exactly this entry.
      let clickFn = dockClickHandlers.get(btn);
      if (!clickFn) {
        clickFn = /** @type {(e: Event) => void} */ (
          e => {
            e.preventDefault();
            const videoId = U.getVideoIdFromUrl(window.location.href);
            if (videoId) {
              const isShorts = window.location.pathname.startsWith('/shorts');
              openThumbnail(videoId, isShorts, btn);
            }
          }
        );
        dockClickHandlers.set(btn, clickFn);
      }
      return registerDockButtonListener(btn, clickFn);
    },
  };

  /** @type {Record<string, unknown>} */ (YouTubePlusThumbnail).DESCRIPTOR = DESCRIPTOR;
  window.YouTubePlusFeatureRegistry?.register?.(DESCRIPTOR);
  U.onDomReady(() => thumbnailFeature?.sync());
})();
