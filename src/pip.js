// YouTube Picture-in-Picture settings
(function () {
  'use strict';
  const _createHTML = window._ytplusCreateHTML || (s => s);

  // Translation helper from centralized i18n
  const t = window.YouTubeUtils?.t || ((/** @type {string} */ key) => key || '');
  const logger = window.YouTubeUtils?.logger || console;

  /**
   * @typedef {{
   *   key: string,
   *   shiftKey: boolean,
   *   altKey: boolean,
   *   ctrlKey: boolean
   * }} PipShortcut
   */

  /**
   * @typedef {{
   *   enabled: boolean,
   *   shortcut: PipShortcut,
   *   storageKey: string
   * }} PipSettings
   */

  /**
   * PiP settings configuration
   * @type {PipSettings}
   * @property {boolean} enabled - Whether PiP is enabled
   * @property {Object} shortcut - Keyboard shortcut configuration
   * @property {string} storageKey - LocalStorage key for persistence
   */
  const pipSettings = {
    enabled: true,
    shortcut: { key: 'P', shiftKey: true, altKey: false, ctrlKey: false },
    storageKey: 'youtube_pip_settings',
  };

  const PIP_SESSION_KEY = 'youtube_plus_pip_session';
  const FIREFOX_PIP_BRIDGE_FLAG = '__ytplusFirefoxPipBridgeInstalled';
  const FIREFOX_PIP_KEYDOWN_BRIDGE_FLAG = '__ytplusFirefoxPipKeydownBridge';
  const FIREFOX_PIP_SHORTCUT_KEY = '__ytplusPipShortcut';

  const getPageGlobal = () => {
    try {
      if (typeof unsafeWindow !== 'undefined') {
        const unwrapped = /** @type {any} */ (unsafeWindow)?.wrappedJSObject;
        if (unwrapped && typeof unwrapped === 'object') return unwrapped;
        return /** @type {any} */ (unsafeWindow);
      }
    } catch (e) {
      // Non-critical, suppressed
    }
    return /** @type {any} */ (window);
  };

  /**
   * Get video element with validation.
   * P9: Uses a WeakRef cache to avoid repeated DOM queries for the same element.
   * @returns {HTMLVideoElement|null} Video element or null if not found
   */
  /** @type {WeakRef<HTMLVideoElement> | null} */
  let _cachedVideoRef = null;
  let _cachedVideoTs = 0;
  const _VIDEO_CACHE_TTL = 2000; // 2 seconds

  const getVideoElement = () => {
    try {
      // P9: Check WeakRef cache first
      const now = Date.now();
      if (_cachedVideoRef && now - _cachedVideoTs < _VIDEO_CACHE_TTL) {
        const cached = _cachedVideoRef.deref?.();
        if (cached && cached.isConnected) {
          return cached;
        }
        _cachedVideoRef = null;
      }

      const pageGlobal = getPageGlobal();

      const candidate =
        pageGlobal?.document?.querySelector?.(
          'video.html5-main-video, #movie_player video, video'
        ) ||
        (typeof YouTubeUtils?.querySelector === 'function' &&
          YouTubeUtils.querySelector('video')) ||
        document.querySelector('video');

      if (candidate && candidate.tagName && candidate.tagName.toLowerCase() === 'video') {
        const video = /** @type {HTMLVideoElement} */ (candidate);
        // P9: Cache the result
        try {
          _cachedVideoRef = new WeakRef(video);
          _cachedVideoTs = now;
        } catch (e) {
          // WeakRef not supported — no caching
        }
        return video;
      }

      return null;
    } catch (error) {
      console.error('[PiP] Error getting video element:', error);
      return null;
    }
  };

  /**
   * Request Picture-in-Picture with page-context fallback for Firefox userscript environments.
   * @param {HTMLVideoElement} video
   * @returns {Promise<any>}
   */
  const requestPictureInPictureCompat = async video => {
    if (typeof video.requestPictureInPicture === 'function') {
      return video.requestPictureInPicture();
    }

    const pageGlobal = getPageGlobal();
    const pageVideo = pageGlobal?.document?.querySelector?.(
      'video.html5-main-video, #movie_player video, video'
    );
    const proto = pageGlobal?.HTMLVideoElement?.prototype;

    if (pageVideo && typeof pageVideo.requestPictureInPicture === 'function') {
      return pageVideo.requestPictureInPicture();
    }

    if (pageVideo && proto && typeof proto.requestPictureInPicture === 'function') {
      return proto.requestPictureInPicture.call(pageVideo);
    }

    const player =
      pageGlobal?.document?.getElementById?.('movie_player') ||
      pageGlobal?.document?.querySelector?.('#movie_player');
    if (player && typeof player.togglePictureInPicture === 'function') {
      return player.togglePictureInPicture();
    }
    if (player && typeof player.requestPictureInPicture === 'function') {
      return player.requestPictureInPicture();
    }

    throw new Error('requestPictureInPicture is not available on video element');
  };

  /**
   * Wait for metadata once (short timeout), then continue.
   * @param {HTMLVideoElement} video
   * @returns {Promise<void>}
   */
  const waitForMetadataOnce = video =>
    new Promise(resolve => {
      if (!video || video.readyState >= 1) {
        resolve();
        return;
      }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener('loadedmetadata', finish);
        resolve();
      };

      video.addEventListener('loadedmetadata', finish, { once: true });
      setTimeout(finish, 700);
    });

  const ensureFirefoxPagePipBridge = () => {
    const pageGlobal = getPageGlobal();
    if (!pageGlobal || pageGlobal[FIREFOX_PIP_BRIDGE_FLAG]) return true;

    const sourceURL = 'debug://youtube-plus/pip-firefox-bridge.js';
    const bridgeScript = `(() => {
  if (window['${FIREFOX_PIP_BRIDGE_FLAG}']) return;
  window['${FIREFOX_PIP_BRIDGE_FLAG}'] = true;

  const selectVideo = () =>
    document.querySelector('video.html5-main-video, #movie_player video, video');

  const clickNativePipButton = () => {
    const selectors = [
      'button.ytp-pip-button',
      '.ytp-right-controls .ytp-pip-button',
      '.ytp-right-controls button[aria-keyshortcuts="i"]'
    ];
    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (!(button instanceof HTMLElement)) continue;
      const disabled =
        button.getAttribute('aria-disabled') === 'true' ||
        button.hasAttribute('disabled') ||
        button.classList.contains('ytp-button-disabled');
      if (disabled) continue;
      button.click();
      return true;
    }
    return false;
  };

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    // Allow same-origin page messages and Firefox/userscript sandbox-origin messages.
    // In some Firefox userscript contexts event.origin may be "null".
    const msgOrigin = String(event.origin || '');
    if (msgOrigin && msgOrigin !== 'null' && msgOrigin !== location.origin) return;
    if (event.data?.type !== 'ytp-pip-request' || !event.data?.id) return;

    const respond = success => {
      window.postMessage({ type: 'ytp-pip-response', id: event.data.id, success }, '*');
    };

    Promise.resolve()
      .then(async () => {
        const video = selectVideo();
        if (document.pictureInPictureElement && typeof document.exitPictureInPicture === 'function') {
          await document.exitPictureInPicture();
          return true;
        }
        if (video && typeof video.requestPictureInPicture === 'function') {
          await video.requestPictureInPicture();
          return true;
        }
        return clickNativePipButton();
      })
      .then(success => respond(Boolean(success)))
      .catch(() => respond(false));
  }, true);
})();
//# sourceURL=${sourceURL}`;

    try {
      // Strategy 1: GM_addElement — bypasses CSP in Tampermonkey/Violentmonkey.
      // This is the most reliable approach in Firefox userscript contexts.
      const gmAddElement = /** @type {any} */ (globalThis).GM_addElement;
      if (typeof gmAddElement === 'function') {
        gmAddElement('script', { textContent: bridgeScript });
        return true;
      }
    } catch (e) {
      // GM_addElement not available — fall through
    }

    try {
      // Strategy 2: Nonce-based inline script injection.
      // Firefox hides nonce values from content via getAttribute() for security,
      // so this may still fail; it is kept as a secondary attempt.
      const nonceSource =
        document.querySelector('script[nonce]') ||
        document.querySelector('[nonce]') ||
        document.documentElement;
      const nonce =
        /** @type {any} */ (nonceSource)?.nonce ||
        nonceSource?.getAttribute?.('nonce') ||
        document.documentElement?.getAttribute?.('nonce') ||
        '';
      if (nonce) {
        const script = document.createElement('script');
        script.setAttribute('nonce', nonce);
        script.textContent = bridgeScript;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        if (pageGlobal[FIREFOX_PIP_BRIDGE_FLAG]) return true;
      }
    } catch (e) {
      // Nonce injection failed — fall through
    }

    // Bridge installation failed — the postMessage path won't work,
    // but clickNativeYouTubePipButton() and unsafeWindow paths are still tried.
    console.warn('[PiP] Firefox PiP bridge could not be installed (CSP). Using button fallback.');
    return false;
  };

  /**
   * Sync the current PiP shortcut into the page global so the keydown bridge can read it.
   */
  const syncPipShortcutToPageGlobal = () => {
    try {
      const pageGlobal = getPageGlobal();
      if (pageGlobal) {
        pageGlobal[FIREFOX_PIP_SHORTCUT_KEY] = {
          key: pipSettings.shortcut.key,
          shiftKey: pipSettings.shortcut.shiftKey,
          altKey: pipSettings.shortcut.altKey,
          ctrlKey: pipSettings.shortcut.ctrlKey,
          enabled: pipSettings.enabled,
        };
      }
    } catch (e) {
      // Non-critical, suppressed
    }
  };

  /**
   * Install a page-context keydown bridge for Firefox PiP hotkey.
   * Firefox requires requestPictureInPicture() to be called synchronously inside
   * a trusted user-gesture event handler. Clicking a button from userscript context
   * (via .click()) is NOT treated as a trusted gesture for PiP in Firefox.
   * This bridge runs in page context where keyboard events ARE trusted gestures.
   * @returns {boolean} Whether installation succeeded
   */
  const installFirefoxPipKeydownBridge = () => {
    const pageGlobal = getPageGlobal();
    if (!pageGlobal) return false;
    if (pageGlobal[FIREFOX_PIP_KEYDOWN_BRIDGE_FLAG]) return true;

    syncPipShortcutToPageGlobal();

    const shortcutKey = FIREFOX_PIP_SHORTCUT_KEY;
    const bridgeFlag = FIREFOX_PIP_KEYDOWN_BRIDGE_FLAG;
    const bridgeScript = `(() => {
  if (window['${bridgeFlag}']) return;
  window['${bridgeFlag}'] = true;

  const selectVideo = () =>
    document.querySelector('video.html5-main-video, #movie_player video, video');

  const clickPipBtn = () => {
    const sels = ['button.ytp-pip-button', '.ytp-right-controls .ytp-pip-button',
                  '.ytp-right-controls button[aria-keyshortcuts="i"]'];
    for (const sel of sels) {
      const btn = document.querySelector(sel);
      if (!(btn instanceof HTMLElement)) continue;
      if (btn.getAttribute('aria-disabled') === 'true' || btn.hasAttribute('disabled') ||
          btn.classList.contains('ytp-button-disabled')) continue;
      btn.click();
      return true;
    }
    return false;
  };

  const getShortcut = () => window['${shortcutKey}'] || { key: 'P', shiftKey: true, altKey: false, ctrlKey: false, enabled: true };

  document.addEventListener('keydown', function ytplusPipKeydown(e) {
    const s = getShortcut();
    if (!s || !s.enabled) return;
    if (e.repeat || e.isComposing || e.metaKey) return;
    const keyMatches = e.key.toUpperCase() === String(s.key || '').toUpperCase();
    const modsMatch = !!e.shiftKey === !!s.shiftKey && !!e.altKey === !!s.altKey && !!e.ctrlKey === !!s.ctrlKey;
    if (!keyMatches || !modsMatch) return;

    // Check active element is not a text input
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
               ae.tagName === 'SELECT' || ae.isContentEditable)) return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    // Signal the userscript handler to not double-toggle
    window['__ytplusPipPageHandled'] = Date.now();

    if (document.pictureInPictureElement) {
      document.exitPictureInPicture && document.exitPictureInPicture();
      return;
    }

    const video = selectVideo();
    if (video && typeof video.requestPictureInPicture === 'function') {
      video.requestPictureInPicture().catch(() => clickPipBtn());
      return;
    }
    clickPipBtn();
  }, true);
})();`;

    const gmAddEl = /** @type {any} */ (globalThis).GM_addElement;
    if (typeof gmAddEl === 'function') {
      try {
        gmAddEl('script', { textContent: bridgeScript });
        if (pageGlobal[FIREFOX_PIP_KEYDOWN_BRIDGE_FLAG]) return true;
      } catch (e) {
        // Fall through to script tag injection
      }
    }

    try {
      const script = document.createElement('script');
      script.textContent = bridgeScript;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      if (pageGlobal[FIREFOX_PIP_KEYDOWN_BRIDGE_FLAG]) return true;
    } catch (e) {
      // Non-critical
    }

    return false;
  };

  /**
   * Ask page-context bridge to toggle PiP and wait for response.
   * @returns {Promise<boolean>}
   */
  const requestFirefoxPiPViaBridge = () =>
    new Promise(resolve => {
      try {
        if (!ensureFirefoxPagePipBridge()) {
          resolve(false);
          return;
        }

        const requestId = `ytp-pip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let settled = false;

        const finish = (/** @type {boolean} */ success) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onResponse, true);
          resolve(Boolean(success));
        };

        const onResponse = (/** @type {MessageEvent} */ evt) => {
          if (evt.data?.type !== 'ytp-pip-response' || evt.data?.id !== requestId) return;
          finish(Boolean(evt.data?.success));
        };

        window.addEventListener('message', onResponse, true);
        window.postMessage({ type: 'ytp-pip-request', id: requestId }, '*');

        setTimeout(() => finish(false), 1200);
      } catch (e) {
        resolve(false);
      }
    });

  /**
   * Fallback: click YouTube native PiP control when API is not exposed in userscript context.
   * @returns {boolean}
   */
  const clickNativeYouTubePipButton = () => {
    const revealPlayerControls = () => {
      const player = document.getElementById('movie_player');
      if (!(player instanceof HTMLElement)) return;

      const rect = player.getBoundingClientRect();
      const clientX = Math.round(rect.left + rect.width - 32);
      const clientY = Math.round(rect.top + rect.height - 32);
      ['mousemove', 'mouseover', 'mouseenter'].forEach(type => {
        try {
          player.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX,
              clientY,
            })
          );
        } catch (e) {
          // Non-critical, suppressed
        }
      });
    };

    const selectors = [
      'button.ytp-pip-button',
      '.ytp-right-controls .ytp-pip-button',
      '.ytp-right-controls button[aria-keyshortcuts="i"]',
    ];
    const contexts = [];

    try {
      contexts.push(document);
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow?.document) {
        contexts.push(/** @type {Document} */ (unsafeWindow.document));
      }
    } catch (e) {
      // Non-critical, suppressed
    }

    revealPlayerControls();

    for (const ctx of contexts) {
      for (const sel of selectors) {
        const btn = ctx.querySelector(sel);
        if (btn instanceof HTMLElement) {
          const disabled =
            btn.getAttribute('aria-disabled') === 'true' ||
            btn.hasAttribute('disabled') ||
            btn.classList.contains('ytp-button-disabled');
          if (disabled) continue;
          btn.click();
          return true;
        }
      }
    }

    return false;
  };

  const setSessionActive = (/** @type {boolean} */ isActive) => {
    try {
      if (isActive) {
        sessionStorage.setItem(PIP_SESSION_KEY, 'true');
      } else {
        sessionStorage.removeItem(PIP_SESSION_KEY);
      }
    } catch (e) {
      // Non-critical, suppressed
    }
  };

  const wasSessionActive = () => {
    try {
      return sessionStorage.getItem(PIP_SESSION_KEY) === 'true';
    } catch (e) {
      return false;
    }
  };

  /**
   * Load settings from localStorage with validation
   * @returns {void}
   */
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(pipSettings.storageKey);
      if (!saved) return;

      const parsed = JSON.parse(saved);
      if (typeof parsed !== 'object' || parsed === null) {
        console.warn('[PiP] Invalid settings format');
        return;
      }

      // Validate and merge settings
      if (typeof parsed.enabled === 'boolean') {
        pipSettings.enabled = parsed.enabled;
      }

      // Validate shortcut object
      if (parsed.shortcut && typeof parsed.shortcut === 'object') {
        if (typeof parsed.shortcut.key === 'string' && parsed.shortcut.key.length > 0) {
          pipSettings.shortcut.key = parsed.shortcut.key;
        }
        if (typeof parsed.shortcut.shiftKey === 'boolean') {
          pipSettings.shortcut.shiftKey = parsed.shortcut.shiftKey;
        }
        if (typeof parsed.shortcut.altKey === 'boolean') {
          pipSettings.shortcut.altKey = parsed.shortcut.altKey;
        }
        if (typeof parsed.shortcut.ctrlKey === 'boolean') {
          pipSettings.shortcut.ctrlKey = parsed.shortcut.ctrlKey;
        }
      }
    } catch (e) {
      console.error('[PiP] Error loading settings:', e);
    }
  };

  /**
   * Save settings to localStorage with error handling
   * @returns {void}
   */
  const saveSettings = () => {
    try {
      const settingsToSave = {
        enabled: pipSettings.enabled,
        shortcut: pipSettings.shortcut,
      };
      localStorage.setItem(pipSettings.storageKey, JSON.stringify(settingsToSave));
    } catch (e) {
      console.error('[PiP] Error saving settings:', e);
    }
    // Keep page-context keydown bridge in sync with updated shortcut/enabled state.
    syncPipShortcutToPageGlobal();
  };

  /**
   * Get current PiP element as HTMLVideoElement when available.
   * Firefox does not expose document.pictureInPictureElement, so we also check
   * for Firefox's proprietary attribute on the video element.
   * @returns {HTMLVideoElement|null}
   */
  const getCurrentPiPElement = () => {
    // Standard W3C API (Chrome, Edge, Safari)
    const current = document.pictureInPictureElement;
    if (current && typeof current === 'object' && 'tagName' in current) {
      const tag = /** @type {{ tagName?: string }} */ (current).tagName;
      if (typeof tag === 'string' && tag.toLowerCase() === 'video') {
        return /** @type {HTMLVideoElement} */ (/** @type {unknown} */ (current));
      }
    }

    // Firefox fallback: check if any video has the PiP attribute
    if (/firefox/i.test(navigator.userAgent || '')) {
      try {
        const pageGlobal = getPageGlobal();
        const doc = pageGlobal?.document || document;
        // Firefox adds a data-pip attribute or sets a special class on PiP videos
        const pipVideo = doc.querySelector('video[__pip]') || doc.querySelector('video._pip');
        if (pipVideo && pipVideo.tagName?.toLowerCase() === 'video') {
          return /** @type {HTMLVideoElement} */ (pipVideo);
        }
      } catch {
        /* empty */
      }
    }

    return null;
  };

  /**
   * Toggle Picture-in-Picture mode
   * @param {HTMLVideoElement} video - The video element
   * @returns {Promise<void>}
   */
  const togglePictureInPicture = async video => {
    if (!pipSettings.enabled || !video) return;

    try {
      const isFirefox = /firefox/i.test(navigator.userAgent || '');

      // Firefox path: always prefer native YouTube PiP button first
      // because Firefox doesn't expose requestPictureInPicture in userscript context
      if (isFirefox) {
        ensureFirefoxPagePipBridge();

        // Try exiting PiP first if active
        if (
          typeof document.exitPictureInPicture === 'function' &&
          document.pictureInPictureElement
        ) {
          try {
            await document.exitPictureInPicture();
            setSessionActive(false);
            return;
          } catch (e) {
            void e; /* fall through */
          }
        }

        // Try the native YouTube PiP button (most reliable on Firefox)
        const toggledByButton = clickNativeYouTubePipButton();
        if (toggledByButton) {
          setSessionActive(true);
          return;
        }

        // Try page-context requestPictureInPicture via unsafeWindow
        try {
          const pageGlobal = getPageGlobal();
          const pageVideo = pageGlobal?.document?.querySelector?.(
            'video.html5-main-video, #movie_player video, video'
          );
          if (pageVideo && typeof pageVideo.requestPictureInPicture === 'function') {
            await pageVideo.requestPictureInPicture();
            setSessionActive(true);
            return;
          }
          // Try calling via prototype
          const proto = pageGlobal?.HTMLVideoElement?.prototype;
          if (pageVideo && proto && typeof proto.requestPictureInPicture === 'function') {
            await proto.requestPictureInPicture.call(pageVideo);
            setSessionActive(true);
            return;
          }
        } catch (e) {
          void e; /* fall through */
        }

        // Final Firefox fallback: use postMessage to trigger PiP from page context
        // This avoids CSP violations from inline script injection
        try {
          const bridgeSuccess = await requestFirefoxPiPViaBridge();
          if (bridgeSuccess) {
            setSessionActive(true);
            return;
          }

          // Also try using Greasemonkey's cloneInto/exportFunction if available
          const pageGlobal2 = getPageGlobal();
          if (pageGlobal2) {
            const pageVid = pageGlobal2.document?.querySelector?.('video');
            if (pageVid && typeof pageVid.requestPictureInPicture === 'function') {
              pageVid.requestPictureInPicture().catch(() => {
                /* ignore */
              });
              setSessionActive(true);
            }
          }
        } catch (e) {
          logger.warn('[PiP] All Firefox PiP fallbacks exhausted');
        }
        return;
      }

      // Non-Firefox path (Chrome, Edge, Safari) — standard W3C API
      const currentPiP = getCurrentPiPElement();

      if (currentPiP && currentPiP !== video) {
        if (typeof document.exitPictureInPicture === 'function') {
          await document.exitPictureInPicture();
        }
        setSessionActive(false);
      }

      if (getCurrentPiPElement() === video) {
        if (typeof document.exitPictureInPicture === 'function') {
          await document.exitPictureInPicture();
        }
        setSessionActive(false);
        return;
      }

      const hadDisablePiP = video.disablePictureInPicture === true;
      if (hadDisablePiP) {
        try {
          video.disablePictureInPicture = false;
        } catch (e) {
          /* ignore */
          void e; // Non-critical, suppressed
          /* ignore */
        }
      }

      // Keep user activation path short, but retry once after metadata for API timing quirks.
      try {
        await requestPictureInPictureCompat(video);
      } catch (e) {
        await waitForMetadataOnce(video);
        try {
          await requestPictureInPictureCompat(video);
        } catch (e) {
          const toggledByButton = clickNativeYouTubePipButton();
          if (!toggledByButton) {
            throw new Error('requestPictureInPicture is not available on video element');
          }
        }
      }

      if (hadDisablePiP) {
        try {
          video.disablePictureInPicture = true;
        } catch (e) {
          /* ignore */
          void e; // Non-critical, suppressed
          /* ignore */
        }
      }

      setSessionActive(true);
    } catch (error) {
      console.error('[YouTube+][PiP] Failed to toggle Picture-in-Picture:', error);
    }
  };

  /**
   * Firefox-specific hotkey toggle path that keeps request/click in direct user gesture.
   * @param {KeyboardEvent} e
   * @param {boolean} allowBrowserFallback
   * @returns {boolean}
   */
  const toggleFirefoxPiPFromHotkey = (e, allowBrowserFallback) => {
    const currentPiP = getCurrentPiPElement();
    if (currentPiP && typeof document.exitPictureInPicture === 'function') {
      void document.exitPictureInPicture();
      setSessionActive(false);
      return true;
    }

    const video = getVideoElement();
    if (!video) {
      if (clickNativeYouTubePipButton()) {
        setSessionActive(true);
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
        return true;
      }

      // Fallback to page bridge when direct video handle is unavailable in sandbox.
      void requestFirefoxPiPViaBridge().then(success => {
        if (success) setSessionActive(true);
      });

      if (!allowBrowserFallback) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
        return true;
      }
      return false;
    }

    try {
      if (video.disablePictureInPicture === true) {
        video.disablePictureInPicture = false;
      }
    } catch (e) {
      // Non-critical, suppressed
    }

    // Firefox hotkey path: preserve user gesture by trying native button first.
    // Async promise fallbacks can lose gesture trust in Firefox.
    let handled = false;
    const toggledByButtonNow = clickNativeYouTubePipButton();
    if (toggledByButtonNow) {
      setSessionActive(true);
      handled = true;
    }

    if (!handled) {
      void requestFirefoxPiPViaBridge().then(success => {
        if (success) {
          setSessionActive(true);
          return;
        }
        requestPictureInPictureCompat(video)
          .then(() => setSessionActive(true))
          .catch(() => {
            // Final best-effort click retry.
            if (clickNativeYouTubePipButton()) setSessionActive(true);
          });
      });
      handled = !allowBrowserFallback;
    }

    if (!handled && !document.pictureInPictureElement) {
      setTimeout(() => {
        if (!document.pictureInPictureElement) {
          const toggledByButton = clickNativeYouTubePipButton();
          if (toggledByButton) {
            setSessionActive(true);
            return;
          }
          void requestFirefoxPiPViaBridge().then(success => {
            if (success) setSessionActive(true);
          });
        }
      }, 70);
    }

    if (!handled && !allowBrowserFallback) {
      // Custom shortcuts in Firefox should not fall through to browser defaults (e.g. Ctrl+P print).
      void togglePictureInPicture(video);
      handled = true;
    }

    if (!handled) {
      return false;
    }

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }

    return true;
  };

  /**
   * Add PiP settings UI to advanced settings modal
   * @returns {boolean}
   */
  const addPipSettingsToModal = () => {
    const advancedSection = document.querySelector(
      '.ytp-plus-settings-section[data-section="advanced"]'
    );
    if (!advancedSection || advancedSection.querySelector('.pip-settings-item')) return false;

    const getSubmenuExpanded = () => {
      try {
        const raw = localStorage.getItem('ytp-plus-submenu-states');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.pip === 'boolean') return parsed.pip;
      } catch (e) {
        // Non-critical, suppressed
      }
      return null;
    };
    const storedExpanded = getSubmenuExpanded();
    const initialExpanded = typeof storedExpanded === 'boolean' ? storedExpanded : true;

    // Add styles if they don't exist
    if (!document.getElementById('pip-styles')) {
      const styles = `
          .pip-shortcut-editor { display: flex; align-items: center; gap: 8px; }
          .pip-shortcut-editor select, #pip-key {background: rgba(34, 34, 34, var(--yt-header-bg-opacity)); color: var(--yt-spec-text-primary); border: 1px solid var(--yt-spec-10-percent-layer); border-radius: var(--yt-radius-sm); padding: 4px;}
        `;
      YouTubeUtils.StyleManager.add('pip-styles', styles);
    }

    // Enable/disable toggle
    const enableItem = document.createElement('div');
    enableItem.className =
      'ytp-plus-settings-item pip-settings-item ytp-plus-settings-item--with-submenu';
    enableItem.innerHTML = _createHTML(`
        <div>
          <label class="ytp-plus-settings-item-label" for="pip-enable-checkbox">${t(
            'pipTitle'
          )}</label>
          <div class="ytp-plus-settings-item-description">${t('pipDescription')}</div>
        </div>
        <div class="ytp-plus-settings-item-actions">
          <button
            type="button"
            class="ytp-plus-submenu-toggle"
            data-submenu="pip"
            aria-label="Toggle PiP submenu"
            aria-expanded="${initialExpanded ? 'true' : 'false'}"
            ${pipSettings.enabled ? '' : 'disabled'}
            style="display:${pipSettings.enabled ? 'inline-flex' : 'none'};"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enablePiP" id="pip-enable-checkbox" ${pipSettings.enabled ? 'checked' : ''}>
        </div>
      `);
    advancedSection.appendChild(enableItem);

    // Shortcut settings
    const submenuWrap = document.createElement('div');
    submenuWrap.className = 'pip-submenu';
    /** @type {any} */ (submenuWrap).dataset.submenu = 'pip';
    /** @type {any} */ (submenuWrap).style.display =
      pipSettings.enabled && initialExpanded ? 'block' : 'none';
    /** @type {any} */ (submenuWrap).style.marginLeft = '12px';
    /** @type {any} */ (submenuWrap).style.marginBottom = '12px';

    const submenuCard = document.createElement('div');
    submenuCard.className = 'glass-card';
    /** @type {any} */ (submenuCard).style.display = 'flex';
    /** @type {any} */ (submenuCard).style.flexDirection = 'column';
    /** @type {any} */ (submenuCard).style.gap = '8px';

    const shortcutItem = document.createElement('div');
    shortcutItem.className = 'ytp-plus-settings-item pip-shortcut-item';
    /** @type {any} */ (shortcutItem).style.display = 'flex';

    const { ctrlKey, altKey, shiftKey } = pipSettings.shortcut;
    const modifierValue =
      ctrlKey && altKey && shiftKey
        ? 'ctrl+alt+shift'
        : ctrlKey && altKey
          ? 'ctrl+alt'
          : ctrlKey && shiftKey
            ? 'ctrl+shift'
            : altKey && shiftKey
              ? 'alt+shift'
              : ctrlKey
                ? 'ctrl'
                : altKey
                  ? 'alt'
                  : shiftKey
                    ? 'shift'
                    : 'none';

    shortcutItem.innerHTML = _createHTML(`
        <div>
          <label class="ytp-plus-settings-item-label">${t('pipShortcutTitle')}</label>
          <div class="ytp-plus-settings-item-description">${t('pipShortcutDescription')}</div>
        </div>
        <div class="pip-shortcut-editor">
          <!-- hidden native select kept for compatibility -->
          <select id="pip-modifier-combo" style="display:none;">
            ${[
              'none',
              'ctrl',
              'alt',
              'shift',
              'ctrl+alt',
              'ctrl+shift',
              'alt+shift',
              'ctrl+alt+shift',
            ]
              .map(
                v =>
                  `<option value="${v}" ${v === modifierValue ? 'selected' : ''}>${
                    v === 'none'
                      ? t('none')
                      : v
                          .replace(/\+/g, '+')
                          .split('+')
                          .map(k => t(k.toLowerCase()))
                          .join('+')
                          .split('+')
                          .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                          .join('+')
                  }</option>`
              )
              .join('')}
          </select>

          <div class="glass-dropdown" id="pip-modifier-dropdown" tabindex="0" role="listbox" aria-expanded="false">
            <button class="glass-dropdown__toggle" type="button" aria-haspopup="listbox">
              <span class="glass-dropdown__label">${
                modifierValue === 'none'
                  ? t('none')
                  : modifierValue
                      .replace(/\+/g, '+')
                      .split('+')
                      .map(k => t(k.toLowerCase()))
                      .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                      .join('+')
              }</span>
              <svg class="glass-dropdown__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <ul class="glass-dropdown__list" role="presentation">
              ${[
                'none',
                'ctrl',
                'alt',
                'shift',
                'ctrl+alt',
                'ctrl+shift',
                'alt+shift',
                'ctrl+alt+shift',
              ]
                .map(v => {
                  const label =
                    v === 'none'
                      ? t('none')
                      : v
                          .replace(/\+/g, '+')
                          .split('+')
                          .map(k => t(k.toLowerCase()))
                          .map(k => k.charAt(0).toUpperCase() + k.slice(1))
                          .join('+');
                  const sel = v === modifierValue ? ' aria-selected="true"' : '';
                  return `<li class="glass-dropdown__item" data-value="${v}" role="option"${sel}>${label}</li>`;
                })
                .join('')}
            </ul>
          </div>

          <span>+</span>
          <input type="text" id="pip-key" value="${pipSettings.shortcut.key}" maxlength="1" style="width: 30px; text-align: center;">
        </div>
      `);
    submenuCard.appendChild(shortcutItem);
    submenuWrap.appendChild(submenuCard);
    advancedSection.appendChild(submenuWrap);

    // Initialize glass dropdown interactions for PiP selector
    const initPipDropdown = () => {
      const hidden = document.getElementById('pip-modifier-combo');
      const dropdown = document.getElementById('pip-modifier-dropdown');
      if (!(hidden instanceof HTMLSelectElement) || !(dropdown instanceof HTMLElement)) return;

      const toggle = dropdown.querySelector('.glass-dropdown__toggle');
      const list = dropdown.querySelector('.glass-dropdown__list');
      const label = dropdown.querySelector('.glass-dropdown__label');
      if (
        !(toggle instanceof HTMLElement) ||
        !(list instanceof HTMLElement) ||
        !(label instanceof HTMLElement)
      ) {
        return;
      }
      let items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
      let idx = items.findIndex(it => it.getAttribute('aria-selected') === 'true');
      if (idx < 0) idx = 0;

      const openList = () => {
        dropdown.setAttribute('aria-expanded', 'true');
        /** @type {any} */ (list).style.display = 'block';
        items = Array.from(list.querySelectorAll('.glass-dropdown__item'));
      };
      const closeList = () => {
        dropdown.setAttribute('aria-expanded', 'false');
        /** @type {any} */ (list).style.display = 'none';
      };

      toggle.addEventListener('click', () => {
        const expanded = dropdown.getAttribute('aria-expanded') === 'true';
        if (expanded) closeList();
        else openList();
      });

      const outsideClickHandler = (/** @type {Event} */ e) => {
        const target = e.target instanceof Node ? e.target : null;
        if (!target || !dropdown.contains(target)) closeList();
      };
      if (window.YouTubeUtils && YouTubeUtils.cleanupManager) {
        YouTubeUtils.cleanupManager.registerListener(document, 'click', outsideClickHandler);
      } else {
        document.addEventListener('click', outsideClickHandler);
      }

      // Arrow-key navigation and selection
      dropdown.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
        const expanded = dropdown.getAttribute('aria-expanded') === 'true';
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (!expanded) openList();
          idx = Math.min(idx + 1, items.length - 1);
          items.forEach(it => it.removeAttribute('aria-selected'));
          items[idx].setAttribute('aria-selected', 'true');
          items[idx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (!expanded) openList();
          idx = Math.max(idx - 1, 0);
          items.forEach(it => it.removeAttribute('aria-selected'));
          items[idx].setAttribute('aria-selected', 'true');
          items[idx].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!expanded) {
            openList();
            return;
          }
          const it = items[idx];
          if (it) {
            hidden.value = /** @type {any} */ (it).dataset.value;
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
            label.textContent = it.textContent;
            closeList();
          }
        } else if (e.key === 'Escape') {
          closeList();
        }
      });

      list.addEventListener('click', (/** @type {MouseEvent} */ e) => {
        const target = e.target instanceof HTMLElement ? e.target : null;
        const it = target ? target.closest('.glass-dropdown__item') : null;
        if (!it) return;
        const val = /** @type {any} */ (it).dataset.value;
        hidden.value = val;
        list
          .querySelectorAll('.glass-dropdown__item')
          .forEach(li => li.removeAttribute('aria-selected'));
        it.setAttribute('aria-selected', 'true');
        label.textContent = it.textContent;
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
        closeList();
      });
    };

    setTimeout(initPipDropdown, 0);

    // Event listeners
    const enableCheckbox = document.getElementById('pip-enable-checkbox');
    if (!(enableCheckbox instanceof HTMLInputElement)) return true;
    enableCheckbox.addEventListener('change', (/** @type {Event} */ e) => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      pipSettings.enabled = target.checked;
      const submenuToggle = enableItem.querySelector(
        '.ytp-plus-submenu-toggle[data-submenu="pip"]'
      );
      if (submenuToggle instanceof HTMLElement) {
        if (pipSettings.enabled) {
          const stored = getSubmenuExpanded();
          const nextExpanded = typeof stored === 'boolean' ? stored : true;
          submenuToggle.removeAttribute('disabled');
          /** @type {any} */ (submenuToggle).style.display = 'inline-flex';
          submenuToggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
          /** @type {any} */ (submenuWrap).style.display = nextExpanded ? 'block' : 'none';
        } else {
          submenuToggle.setAttribute('disabled', '');
          /** @type {any} */ (submenuToggle).style.display = 'none';
          /** @type {any} */ (submenuWrap).style.display = 'none';
        }
      }
      saveSettings();
    });

    const modifierCombo = document.getElementById('pip-modifier-combo');
    if (!(modifierCombo instanceof HTMLSelectElement)) return true;
    modifierCombo.addEventListener('change', (/** @type {Event} */ e) => {
      const target = /** @type {EventTarget & HTMLSelectElement} */ (e.target);
      const value = target.value;
      pipSettings.shortcut.ctrlKey = value.includes('ctrl');
      pipSettings.shortcut.altKey = value.includes('alt');
      pipSettings.shortcut.shiftKey = value.includes('shift');
      saveSettings();
    });

    const pipKeyInput = document.getElementById('pip-key');
    if (!(pipKeyInput instanceof HTMLInputElement)) return true;
    pipKeyInput.addEventListener('input', (/** @type {Event} */ e) => {
      const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
      if (target.value) {
        pipSettings.shortcut.key = target.value.toUpperCase();
        saveSettings();
      }
    });

    pipKeyInput.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) =>
      e.stopPropagation()
    );
    return true;
  };

  // Initialize
  loadSettings();

  // Event listeners — register with cleanupManager for SPA cleanup
  const isEditableTarget = (/** @type {EventTarget | null} */ target) => {
    const node = /** @type {any} */ (target);
    if (!node || typeof node !== 'object') return false;
    const tag = String(node.tagName || '').toUpperCase();
    if (node.isContentEditable === true) return true;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (typeof node.closest === 'function') {
      return !!node.closest('input, textarea, select, [contenteditable="true"]');
    }
    return false;
  };

  const keyToCode = (/** @type {string} */ key) => {
    const normalized = String(key || '')
      .trim()
      .toUpperCase();
    if (!normalized) return '';

    const symbolCodeMap = {
      '`': 'Backquote',
      '~': 'Backquote',
      '-': 'Minus',
      _: 'Minus',
      '=': 'Equal',
      '+': 'Equal',
      '[': 'BracketLeft',
      '{': 'BracketLeft',
      ']': 'BracketRight',
      '}': 'BracketRight',
      '\\': 'Backslash',
      '|': 'Backslash',
      ';': 'Semicolon',
      ':': 'Semicolon',
      "'": 'Quote',
      '"': 'Quote',
      ',': 'Comma',
      '<': 'Comma',
      '.': 'Period',
      '>': 'Period',
      '/': 'Slash',
      '?': 'Slash',
    };
    if (Object.prototype.hasOwnProperty.call(symbolCodeMap, normalized)) {
      return /** @type {Record<string, string>} */ (symbolCodeMap)[normalized];
    }

    if (normalized.length === 1 && /[A-Z]/.test(normalized)) return `Key${normalized}`;
    if (normalized.length === 1 && /[0-9]/.test(normalized)) return `Digit${normalized}`;
    return normalized;
  };

  const isFirefoxNativePipShortcutSetting = () => {
    const s = pipSettings.shortcut;
    const normalizedKey = String(s.key || '').trim();
    return s.ctrlKey === true && s.shiftKey === true && s.altKey === false && normalizedKey === ']';
  };

  let lastHotkeyTriggerTs = 0;

  const pipKeydownHandler = (/** @type {Event} */ e) => {
    const evt = /** @type {any} */ (e);
    const isKeyboardLike =
      evt && typeof evt === 'object' && typeof evt.key === 'string' && typeof evt.code === 'string';
    if (!isKeyboardLike) return;
    if (!pipSettings.enabled) return;
    if (evt.repeat || evt.isComposing) return;
    if (evt.metaKey) return;
    if (isEditableTarget(evt.target)) return;
    const { shiftKey, altKey, ctrlKey, key } = pipSettings.shortcut;
    const expectedCode = keyToCode(key);
    const eventCode = String(evt.code || '');
    const eventKey = String(evt.key || '').toUpperCase();
    const keyMatches =
      eventKey === key.toUpperCase() || (expectedCode && eventCode === expectedCode);
    // Strict modifier matching: all modifiers must match exactly.
    // Previous "at least" logic allowed false positives (e.g. Ctrl+Shift+P matching Shift+P).
    const modifiersMatch =
      evt.shiftKey === shiftKey && evt.altKey === altKey && evt.ctrlKey === ctrlKey;
    if (modifiersMatch && keyMatches) {
      const now = Date.now();
      if (now - lastHotkeyTriggerTs < 250) {
        e.preventDefault();
        return;
      }
      lastHotkeyTriggerTs = now;

      const isFirefox = /firefox/i.test(navigator.userAgent || '');
      if (isFirefox) {
        // Check if the page-context keydown bridge already handled this event.
        // The bridge runs with capture=true in page context and sets a timestamp flag.
        // If it was set within the last 300ms, don't double-toggle.
        const pageGlobal = getPageGlobal();
        const pageHandledTs = Number(pageGlobal?.['__ytplusPipPageHandled'] || 0);
        if (now - pageHandledTs < 300) {
          // Bridge handled it — just cancel the event here so YouTube's own
          // keyboard handler doesn't also fire (e.g. YouTube's 'i' shortcut for PiP).
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          return;
        }
        // Page-context bridge didn't handle it (may not be installed yet). Fall back.
        const handled = toggleFirefoxPiPFromHotkey(
          /** @type {KeyboardEvent} */ (/** @type {unknown} */ (evt)),
          isFirefoxNativePipShortcutSetting()
        );
        if (!handled) {
          return;
        }
      } else {
        const video = getVideoElement();
        if (video) {
          void togglePictureInPicture(video);
        } else if (!clickNativeYouTubePipButton()) {
          console.warn('[PiP] Picture-in-Picture API is unavailable in this browser/context');
        }
      }

      if (!isFirefox && !document.pictureInPictureElement && !getVideoElement()) {
        console.warn('[PiP] Picture-in-Picture API is unavailable in this browser/context');
      }
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      e.preventDefault();
    }
  };
  // Register keydown handlers only — keyup was causing double-fire on every shortcut press.
  YouTubeUtils.cleanupManager.registerListener(document, 'keydown', pipKeydownHandler, {
    capture: true,
  });
  YouTubeUtils.cleanupManager.registerListener(window, 'keydown', pipKeydownHandler, {
    capture: true,
  });

  // For Firefox: install a page-context keydown bridge that calls requestPictureInPicture()
  // synchronously inside the keyboard event (trusted user gesture). This is more reliable
  // than clicking the PiP button via JS or using postMessage, because both lose gesture context.
  if (/firefox/i.test(navigator.userAgent || '')) {
    installFirefoxPipKeydownBridge();
  }

  // Firefox userscript sandboxes can miss some browser-reserved key combos (e.g. Ctrl+P)
  // on the content window. Mirror listeners onto page globals when available.
  try {
    const pageGlobal = getPageGlobal();
    const pageDocument = pageGlobal?.document;
    const pageWindow = pageGlobal;
    if (pageDocument && pageDocument !== document && pageDocument.addEventListener) {
      pageDocument.addEventListener('keydown', pipKeydownHandler, { capture: true });
    }
    if (pageWindow && pageWindow !== window && pageWindow.addEventListener) {
      pageWindow.addEventListener('keydown', pipKeydownHandler, { capture: true });
    }
  } catch (e) {
    // Firefox sandbox may throw Security Exceptions here — continue without page-level listener
    logger.warn('[PiP] Could not register page-context keydown listener (Firefox sandbox)');
  }

  const storageHandler = (/** @type {Event} */ e) => {
    if (!(e instanceof StorageEvent)) return;
    if (e.key === pipSettings.storageKey) {
      loadSettings();
    }
  };
  YouTubeUtils.cleanupManager.registerListener(window, 'storage', storageHandler);

  window.addEventListener('load', () => {
    if (!pipSettings.enabled || !wasSessionActive() || document.pictureInPictureElement) {
      return;
    }

    const resumePiP = () => {
      const video = getVideoElement();
      if (!video) return;

      togglePictureInPicture(video).catch(() => {
        // If resume fails we reset the session flag to avoid loops
        setSessionActive(false);
      });
    };

    const ensureCleanup = (/** @type {EventListenerOrEventListenerObject | null} */ handler) => {
      if (!handler) return;
      try {
        document.removeEventListener('pointerdown', handler, true);
      } catch (e) {
        // Non-critical, suppressed
      }
    };

    const cleanupListeners = () => {
      ensureCleanup(pointerListener);
      ensureCleanup(keyListener);
    };

    const pointerListener = () => {
      cleanupListeners();
      resumePiP();
    };

    const keyListener = () => {
      cleanupListeners();
      resumePiP();
    };

    document.addEventListener('pointerdown', pointerListener, { once: true, capture: true });
    document.addEventListener('keydown', keyListener, { once: true, capture: true });
  });

  // Settings modal integration — use event instead of MutationObserver
  const ensurePipSettings = () => {
    if (window.YouTubeUtils?.createRetryScheduler) {
      window.YouTubeUtils.createRetryScheduler({
        check: () => addPipSettingsToModal() === true,
        maxAttempts: 20,
        interval: 120,
      });
      return;
    }
    let attempts = 0;
    const retry = () => {
      attempts += 1;
      if (addPipSettingsToModal() || attempts >= 20) return;
      setTimeout(retry, 120);
    };
    retry();
  };

  const settingsModalHandler = () => {
    setTimeout(ensurePipSettings, 50);
  };
  YouTubeUtils.cleanupManager.registerListener(
    document,
    'youtube-plus-settings-modal-opened',
    settingsModalHandler
  );

  const leavePipHandler = () => {
    setSessionActive(false);
  };
  YouTubeUtils.cleanupManager.registerListener(document, 'leavepictureinpicture', leavePipHandler);

  const clickHandler = (/** @type {Event} */ e) => {
    if (!(e instanceof MouseEvent)) return;
    const target = /** @type {EventTarget & HTMLElement} */ (e.target);
    if (target.classList && target.classList.contains('ytp-plus-settings-nav-item')) {
      if (target.dataset?.section === 'advanced') {
        setTimeout(ensurePipSettings, 25);
      }
    }
  };
  YouTubeUtils.cleanupManager.registerListener(document, 'click', clickHandler, true);
})();
