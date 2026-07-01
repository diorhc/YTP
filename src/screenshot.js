// Screenshot — no canonical window symbol (self-initializing IIFE).
//
// Responsibility: capture a frame from the video player via
//   canvas.drawImage + captureStream, offer download or copy-to-clipboard.
// Public surface: none (self-contained, no LazyLoader registration).
(function () {
  const logger = window.YouTubeUtils?.logger || window.YouTubePlusLogger || null;
  const U = window.YouTubeUtils;
  const STYLE_ID = 'ytp-screenshot-styles';

  const injectStyles = () => {
    try {
      const StyleManager = U?.StyleManager;
      if (!StyleManager || typeof StyleManager.add !== 'function') return;
      const css = window.YouTubePlusDesignSystem?.getStyle?.(STYLE_ID) || '';
      StyleManager.add(STYLE_ID, css);
    } catch (e) {
      logger?.warn?.('screenshot', 'Failed to inject styles', e);
    }
  };

  /**
   * @param {any} enhancer
   * @returns {boolean}
   */
  function capture(enhancer) {
    const video = enhancer.getElement('video', false);
    if (!video) return false;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const videoTitle = document.title.replace(/\s-\sYouTube$/, '').trim();
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${videoTitle}.png`;

    try {
      link.click();
      const translated = typeof U?.t === 'function' ? U.t('screenshotSaved') : null;
      const message =
        translated && translated !== 'screenshotSaved' ? translated : 'Screenshot saved';
      enhancer.showNotification(message, 2000);
      return true;
    } catch (err) {
      U?.logError?.('Screenshot', 'Screenshot download failed', err);
      const translatedFail = typeof U?.t === 'function' ? U.t('screenshotFailed') : null;
      const failMsg =
        translatedFail && translatedFail !== 'screenshotFailed'
          ? translatedFail
          : 'Screenshot failed';
      enhancer.showNotification(failMsg, 3000);
      return false;
    }
  }

  /**
   * @param {any} enhancer
   * @param {any} controls
   */
  function addButton(enhancer, controls) {
    injectStyles();
    const button = document.createElement('button');
    button.className = 'ytp-button ytp-screenshot-button';
    button.setAttribute('title', U?.t?.('takeScreenshot') || 'Take screenshot');
    button.setAttribute('aria-label', U?.t?.('takeScreenshot') || 'Take screenshot');
    U?.setSafeHTML?.(
      button,
      `
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="0.5" d="M7.142 18.9706C5.18539 18.8995 3.99998 18.6568 3.17157 17.8284C2 16.6569 2 14.7712 2 11C2 7.22876 2 5.34315 3.17157 4.17157C4.34315 3 6.22876 3 10 3H14C17.7712 3 19.6569 3 20.8284 4.17157C22 5.34315 22 7.22876 22 11C22 14.7712 22 16.6569 20.8284 17.8284C20.0203 18.6366 18.8723 18.8873 17 18.965" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path d="M9.94955 16.0503C10.8806 15.1192 11.3461 14.6537 11.9209 14.6234C11.9735 14.6206 12.0261 14.6206 12.0787 14.6234C12.6535 14.6537 13.119 15.1192 14.0501 16.0503C16.0759 18.0761 17.0888 19.089 16.8053 19.963C16.7809 20.0381 16.7506 20.1112 16.7147 20.1815C16.2973 21 14.8648 21 11.9998 21C9.13482 21 7.70233 21 7.28489 20.1815C7.249 20.1112 7.21873 20.0381 7.19436 19.963C6.91078 19.089 7.92371 18.0761 9.94955 16.0503Z" stroke="currentColor" stroke-width="1.5"></path></svg>
        `
    );
    button.addEventListener('click', () => capture(enhancer));
    controls.insertBefore(button, controls.firstChild);
  }

  /** @param {boolean} enabled */
  function refreshVisibility(enabled) {
    const button = document.querySelector('.ytp-screenshot-button');
    if (!(button && /** @type {any} */ (button).style)) return;
    /** @type {any} */ (button).style.display = enabled ? '' : 'none';
  }

  /** @param {any} enhancer */
  function registerHotkey(enhancer) {
    try {
      U?.cleanupManager?.registerListener?.(
        document,
        'keydown',
        (/** @type {any} */ e) => {
          if (!e?.key) return;
          if (!(e.key === 's' || e.key === 'S')) return;
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          if (!enhancer.settings.enableScreenshot) return;
          if (enhancer.isEditableTarget(document.activeElement)) return;
          capture(enhancer);
        },
        true
      );
    } catch (e) {
      U?.logError?.('Screenshot', 'Failed to register screenshot hotkey', e);
    }
  }

  if (typeof window !== 'undefined') {
    window.YouTubePlusScreenshot = {
      addButton,
      capture,
      refreshVisibility,
      registerHotkey,
      injectStyles,
    };
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusScreenshot = window.YouTubePlusScreenshot;
    }
  }

  logger?.debug?.('screenshot', 'Screenshot module loaded');
})();
