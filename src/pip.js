// YouTube Picture-in-Picture: LazyLoader registered as 'pip'.
//
// Responsibility: PiP toggle button, keyboard shortcut, Firefox
//   bridge script injection, and PiP session state persistence.
//   Injects the page bridge through GM_addElement (CSP-safe).
// Public surface: window.YouTubePlusPip.
(function () {
  // Shared helpers from YouTubeUtils
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'Pip');

  const { logger, $: qs, byId } = U?.helpers ?? {};

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
   *   shortcut: PipShortcut,
   *   storageKey: string
   * }} PipSettings
   */

  /**
   * PiP settings configuration
   * @type {PipSettings}
   * @property {Object} shortcut - Keyboard shortcut configuration
   * @property {string} storageKey - LocalStorage key for persistence
   */
  const pipSettings = {
    shortcut: { key: 'P', shiftKey: true, altKey: false, ctrlKey: false },
    storageKey: 'youtube_pip_settings',
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
    if (Object.hasOwn(symbolCodeMap, normalized)) {
      return /** @type {Record<string, string>} */ (symbolCodeMap)[normalized];
    }

    if (normalized.length === 1 && /[A-Z]/.test(normalized)) return `Key${normalized}`;
    if (normalized.length === 1 && /[0-9]/.test(normalized)) return `Digit${normalized}`;
    return normalized;
  };

  const PIP_SESSION_KEY = 'youtube_plus_pip_session';
  const FIREFOX_PIP_BRIDGE_FLAG = '__ytplusFirefoxPipBridgeInstalled';
  const FIREFOX_PIP_KEYDOWN_BRIDGE_FLAG = '__ytplusFirefoxPipKeydownBridge';
  const FIREFOX_PIP_SHORTCUT_KEY = '__ytplusPipShortcut';

  /**
   * Get video element with validation.
   *Uses a WeakRef cache to avoid repeated DOM queries for the same element.
   * @returns {HTMLVideoElement|null} Video element or null if not found
   */
  /** @type {WeakRef<HTMLVideoElement> | null} */
  let _cachedVideoRef = null;
  let _cachedVideoTs = 0;
  const _VIDEO_CACHE_TTL = 2000; // 2 seconds

  const getVideoElement = () => {
    try {
      // Check WeakRef cache first
      const now = Date.now();
      if (_cachedVideoRef && now - _cachedVideoTs < _VIDEO_CACHE_TTL) {
        const cached = _cachedVideoRef.deref?.();
        if (cached?.isConnected) {
          return cached;
        }
        _cachedVideoRef = null;
      }

      const pageGlobal = U.getPageWindow();

      const candidate =
        pageGlobal?.document?.querySelector?.(
          'video.html5-main-video, #movie_player video, video'
        ) || qs('video');

      if (candidate?.tagName && candidate.tagName.toLowerCase() === 'video') {
        const video = /** @type {HTMLVideoElement} */ (candidate);
        // Cache the result
        try {
          _cachedVideoRef = new WeakRef(video);
          _cachedVideoTs = now;
        } catch (_e) {
          logS(_e);
          // WeakRef unavailable, so skip caching.
        }
        return video;
      }

      return null;
    } catch (error) {
      logS(error);
      logger?.error?.('PiP', 'Error getting video element', error);
      return null;
    }
  };

  /**
   * Request Picture-in-Picture with page-context fallback for Firefox userscript environments.
   * @param {HTMLVideoElement} video
   * @returns {Promise<unknown>}
   */
  const requestPictureInPictureCompat = async video => {
    if (typeof video.requestPictureInPicture === 'function') {
      return video.requestPictureInPicture();
    }

    const pageGlobal = U.getPageWindow();
    const pageVideo = /** @type {HTMLVideoElement | null} */ (
      pageGlobal?.document?.querySelector?.('video.html5-main-video, #movie_player video, video')
    );
    const proto = pageGlobal?.HTMLVideoElement?.prototype;

    if (pageVideo && typeof pageVideo.requestPictureInPicture === 'function') {
      return pageVideo.requestPictureInPicture();
    }

    if (pageVideo && proto && typeof proto.requestPictureInPicture === 'function') {
      return proto.requestPictureInPicture.call(pageVideo);
    }

    const player =
      /** @type {(HTMLElement & { togglePictureInPicture?: () => Promise<void> | void, requestPictureInPicture?: () => Promise<void> | void }) | null} */ (
        pageGlobal?.document?.getElementById?.('movie_player') ||
          pageGlobal?.document?.querySelector?.('#movie_player')
      );
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

      window.YouTubePlusCleanupManager?.registerListener?.(
        video,
        'loadedmetadata',
        finish,
        { once: true },
        false
      );
      setTimeout(finish, 700);
    });

  let bridgeToken = '';
  const getBridgeToken = () => {
    if (!bridgeToken) {
      const c =
        (typeof window !== 'undefined' && window.crypto) ||
        (typeof crypto !== 'undefined' ? crypto : null);
      if (c?.getRandomValues) {
        const bytes = new Uint8Array(16);
        c.getRandomValues(bytes);
        bridgeToken = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      }
    }
    return bridgeToken;
  };

  /**
   * Run a page-realm script through GM_addElement and detach the script node.
   * GM_addElement bypasses the page CSP in Tampermonkey/Violentmonkey, the
   * reliable injection path in Firefox userscript contexts.
   * @param {string} script - Script text to run in the page realm.
   * @returns {boolean} Whether GM_addElement ran the script.
   */
  const runGmPageScript = script => {
    const gmAddElement = globalThis.GM_addElement;
    if (typeof gmAddElement !== 'function') return false;
    try {
      const scriptEl = gmAddElement('script', {
        // GM_addElement options cross the extension bridge and must stay
        // structured-clone-safe in Firefox userscript environments.
        textContent: String(script),
      });
      scriptEl?.remove?.();
      return true;
    } catch (_e) {
      logS(_e);
      return false;
    }
  };

  const ensureFirefoxPagePipBridge = () => {
    const pageGlobal = U.getPageWindow();
    if (
      !pageGlobal ||
      /** @type {Record<string, unknown>} */ (/** @type {object} */ (pageGlobal))[
        FIREFOX_PIP_BRIDGE_FLAG
      ]
    )
      return true;

    // Without a random token the bridge would accept any page message.
    const token = getBridgeToken();
    if (!token) return false;
    const sourceURL = 'debug://youtube-plus/pip-firefox-bridge.js';
    const bridgeScript = `(() => {
  if (window['${FIREFOX_PIP_BRIDGE_FLAG}']) return;
  window['${FIREFOX_PIP_BRIDGE_FLAG}'] = true;

  const bridgeToken = '${token}';

  const selectVideo = () =>
    document['querySelector']('video.html5-main-video, #movie_player video, video');

  const clickNativePipButton = () => {
    const selectors = [
      'button.yp-pip-button',
      '.ytp-right-controls .yp-pip-button',
      '.ytp-right-controls button[aria-keyshortcuts="i"]'
    ];
    for (const selector of selectors) {
      const button = document['querySelector'](selector);
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

  const safeTargetOrigin =
    typeof location !== 'undefined' && typeof location.origin === 'string' && location.origin
      ? location.origin
      : '*';

  const handleMessage = event => { // lint:custom:ignore
    if (event.source !== window) return;
    // Allow same-origin page messages and Firefox/userscript sandbox-origin messages.
    // In some Firefox userscript contexts event.origin may be "null".
    const msgOrigin = String(event.origin || '');
    if (msgOrigin && msgOrigin !== 'null' && msgOrigin !== location.origin) return;
    if (event.data?.type !== 'yp-pip-request' || typeof event.data?.id !== 'string') return;
    if (event.data.id.length > 80) return;
    if (!bridgeToken || event.data?.token !== bridgeToken) return;

    const respond = success => {
      window.postMessage({ type: 'yp-pip-response', id: event.data.id, success }, safeTargetOrigin);
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
  };
  window['__ytplusFirefoxPipBridgeMessageHandler'] = handleMessage;
  // lint:custom:ignore page-realm script: CleanupManager and the remove FirefoxPipBridges detacher do not reach here
  window.addEventListener('message', handleMessage);
})();
//# sourceURL=${sourceURL}`;

    if (runGmPageScript(bridgeScript)) return true;

    // Bridge installation failed, so the postMessage path is unavailable;
    // clickNativeYouTubePipButton() and unsafeWindow paths are still tried.
    logger?.warn?.(
      'PiP',
      'Firefox PiP bridge could not be installed (CSP). Using button fallback.'
    );
    return false;
  };

  /**
   * Sync the current PiP shortcut into the page global so the keydown bridge can read it.
   */
  const syncPipShortcutToPageGlobal = () => {
    try {
      const pageGlobal = U.getPageWindow();
      if (pageGlobal) {
        /** @type {Record<string, unknown>} */ (/** @type {object} */ (pageGlobal))[
          FIREFOX_PIP_SHORTCUT_KEY
        ] = {
          key: pipSettings.shortcut.key,
          shiftKey: pipSettings.shortcut.shiftKey,
          altKey: pipSettings.shortcut.altKey,
          ctrlKey: pipSettings.shortcut.ctrlKey,
          enabled: true,
        };
      }
    } catch (_e) {
      logS(_e);
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
    const pageGlobal = U.getPageWindow();
    if (!pageGlobal) return false;
    if (
      /** @type {Record<string, unknown>} */ (/** @type {object} */ (pageGlobal))[
        FIREFOX_PIP_KEYDOWN_BRIDGE_FLAG
      ]
    )
      return true;

    syncPipShortcutToPageGlobal();

    const shortcutKey = FIREFOX_PIP_SHORTCUT_KEY;
    const bridgeFlag = FIREFOX_PIP_KEYDOWN_BRIDGE_FLAG;
    const bridgeScript = `(() => {
  if (window['${bridgeFlag}']) return;
  window['${bridgeFlag}'] = true;

  const selectVideo = () =>
      document['querySelector']('video.html5-main-video, #movie_player video, video');

  const clickPipBtn = () => {
    const sels = ['button.yp-pip-button', '.ytp-right-controls .yp-pip-button',
                  '.ytp-right-controls button[aria-keyshortcuts="i"]'];
    for (const sel of sels) {
      const btn = document['querySelector'](sel);
      if (!(btn instanceof HTMLElement)) continue;
      if (btn.getAttribute('aria-disabled') === 'true' || btn.hasAttribute('disabled') ||
          btn.classList.contains('ytp-button-disabled')) continue;
      btn.click();
      return true;
    }
    return false;
  };

  const getShortcut = () => window['${shortcutKey}'] || { key: 'P', shiftKey: true, altKey: false, ctrlKey: false, enabled: true };
  const keyToCode = key => {
    const normalized = String(key || '').trim().toUpperCase();
    if (!normalized) return '';
    const symbolCodeMap = {
      '\`': 'Backquote',
      '~': 'Backquote',
      '-': 'Minus',
      _: 'Minus',
      '=': 'Equal',
      '+': 'Equal',
      '[': 'BracketLeft',
      '{': 'BracketLeft',
      ']': 'BracketRight',
      '}': 'BracketRight',
      '\\\\': 'Backslash',
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
      '?': 'Slash'
    };
    if (Object.prototype.hasOwnProperty.call(symbolCodeMap, normalized)) {
      return symbolCodeMap[normalized];
    }
    if (normalized.length === 1 && /[A-Z]/.test(normalized)) return 'Key' + normalized;
    if (normalized.length === 1 && /[0-9]/.test(normalized)) return 'Digit' + normalized;
    return normalized;
  };

  const handlePiPHotkey = function ytplusPipKeydown(e) {
    const s = getShortcut();
    if (!s || !s.enabled) return;
    if (e.repeat || e.isComposing || e.metaKey) return;
    const expectedCode = keyToCode(String(s.key || ''));
    const eventCode = String(e.code || '');
    const eventKey = String(e.key || '').toUpperCase();
    const keyMatches =
      eventKey === String(s.key || '').toUpperCase() || (expectedCode && eventCode === expectedCode);
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
  };

  window['__ytplusFirefoxPipKeydownHandler'] = handlePiPHotkey;
  // lint:custom:ignore page-realm script: CleanupManager is unavailable here; removeFirefoxPipBridges detaches
  window.addEventListener('keydown', handlePiPHotkey, true);
  // lint:custom:ignore page-realm script: detached by removeFirefoxPipBridges on the feature stop
  document.addEventListener('keydown', handlePiPHotkey, true);
})();`;

    if (
      runGmPageScript(bridgeScript) &&
      /** @type {Record<string, unknown>} */ (/** @type {object} */ (pageGlobal))[bridgeFlag]
    )
      return true;

    return false;
  };

  /**
   * Remove the page-realm Firefox bridges (message + keydown) installed at
   * the runtime start. The bridge scripts publish their own handlers as
   * window globals, so a small removal script can detach the listeners and
   * clear the install flags; a later start re-installs with the same token.
   * @returns {void}
   */
  const removeFirefoxPipBridges = () => {
    const pageGlobal = U.getPageWindow();
    if (!pageGlobal) return;

    const removalScript = `(() => {
  const keydownHandler = window['__ytplusFirefoxPipKeydownHandler'];
  if (typeof keydownHandler === 'function') {
    window.removeEventListener('keydown', keydownHandler, true);
    document.removeEventListener('keydown', keydownHandler, true);
    delete window['__ytplusFirefoxPipKeydownHandler'];
  }
  const messageHandler = window['__ytplusFirefoxPipBridgeMessageHandler'];
  if (typeof messageHandler === 'function') {
    window.removeEventListener('message', messageHandler);
    delete window['__ytplusFirefoxPipBridgeMessageHandler'];
  }
  delete window['${FIREFOX_PIP_BRIDGE_FLAG}'];
  delete window['${FIREFOX_PIP_KEYDOWN_BRIDGE_FLAG}'];
})();`;

    runGmPageScript(removalScript);
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

        const requestId = `yp-pip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let settled = false;

        const onResponse = (/** @type {MessageEvent} */ evt) => {
          if (evt.source !== window) return;
          const msgOrigin = String(evt.origin || '');
          if (msgOrigin && msgOrigin !== 'null' && msgOrigin !== location.origin) return;
          if (evt.data?.type !== 'yp-pip-response' || evt.data?.id !== requestId) return;
          finish(Boolean(evt.data?.success));
        };

        const cm = window.YouTubePlusCleanupManager;
        const listenerKey = cm.registerListener(window, 'message', onResponse, true, true);

        const finish = (/** @type {boolean} */ success) => {
          if (settled) return;
          settled = true;
          if (listenerKey) cm.unregisterListener?.(listenerKey);
          resolve(Boolean(success));
        };

        const targetOrigin =
          typeof location !== 'undefined' && typeof location.origin === 'string' && location.origin
            ? location.origin
            : '*';
        const token = getBridgeToken();
        window.postMessage({ type: 'yp-pip-request', id: requestId, token }, targetOrigin);

        cm.timeout(() => finish(false), 1200);
      } catch (_e) {
        logS(_e);
        resolve(false);
      }
    });

  /**
   * Fallback: click YouTube native PiP control when API is not exposed in userscript context.
   * @returns {boolean}
   */
  const clickNativeYouTubePipButton = () => {
    const revealPlayerControls = () => {
      const player = byId('movie_player');
      if (!(player instanceof HTMLElement)) return;

      const rect = player.getBoundingClientRect();
      const clientX = Math.round(rect.left + rect.width - 32);
      const clientY = Math.round(rect.top + rect.height - 32);
      // Use the page's own Window as the event `view`, not the userscript
      // sandbox `window`. In Firefox userscript contexts the two are
      // different (Xray-wrapped) objects, and the native MouseEvent
      // constructor rejects a `view` that is not a real Window for that
      // document with "'view' member of UIEventInit does not implement
      // interface Window".
      const eventView = U.getPageWindow() || window;
      ['mousemove', 'mouseover', 'mouseenter'].forEach(type => {
        try {
          player.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              view: eventView,
              clientX,
              clientY,
            })
          );
        } catch (_e) {
          logS(_e);
        }
      });
    };

    const selectors = [
      'button.yp-pip-button',
      '.ytp-right-controls .yp-pip-button',
      '.ytp-right-controls button[aria-keyshortcuts="i"]',
    ];
    const contexts = [];

    try {
      contexts.push(document);
      const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : null;
      const pageDoc = pageWin?.document;
      if (pageDoc) {
        contexts.push(pageDoc);
      }
    } catch (_e) {
      logS(_e);
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
    } catch (_e) {
      logS(_e);
    }
  };

  const wasSessionActive = () => {
    try {
      return sessionStorage.getItem(PIP_SESSION_KEY) === 'true';
    } catch (_e) {
      logS(_e);
      return false;
    }
  };

  /** Module namespace in the shared settings blob. */
  const MODULE_NAME = 'pip';

  /** @returns {YouTubePlusSettingsStore | null} the store when the blob bridge is active */
  const bridgedStore = () => window.YouTubePlusSettingsStore?.moduleBridge?.() ?? null;

  /**
   * Apply a stored settings payload to the live PiP state. `undefined` means
   * nothing was stored and keeps the defaults.
   * @param {unknown} parsed
   */
  const applySettings = parsed => {
    if (parsed === undefined) return;
    if (typeof parsed !== 'object' || parsed === null) {
      logger?.warn?.('PiP', 'Invalid settings format');
      return;
    }
    const p = /** @type {Record<string, unknown>} */ (parsed);

    // Validate shortcut object
    const sc = /** @type {Record<string, unknown>|null|undefined} */ (p.shortcut);
    if (sc && typeof sc === 'object') {
      if (typeof sc.key === 'string' && sc.key.length > 0) {
        pipSettings.shortcut.key = sc.key;
      }
      if (typeof sc.shiftKey === 'boolean') {
        pipSettings.shortcut.shiftKey = sc.shiftKey;
      }
      if (typeof sc.altKey === 'boolean') {
        pipSettings.shortcut.altKey = sc.altKey;
      }
      if (typeof sc.ctrlKey === 'boolean') {
        pipSettings.shortcut.ctrlKey = sc.ctrlKey;
      }
    }
  };

  /**
   * Read the legacy settings payload. Returns `undefined` when nothing is
   * stored so it is not mistaken for an invalid payload.
   * @returns {unknown}
   */
  const readLegacySettings = () => {
    const saved = U.storage?.getItem(pipSettings.storageKey);
    if (!saved) return undefined;
    return JSON.parse(saved);
  };

  /**
   * Load settings. From the shared blob once it exists (migrating the legacy
   * key on first read), otherwise from the legacy key.
   * @returns {void}
   */
  const loadSettings = () => {
    try {
      const store = bridgedStore();
      if (store) {
        const mod = store.getModuleSettings(MODULE_NAME);
        if (mod && Object.keys(mod).length) {
          applySettings(mod);
          return;
        }
        applySettings(readLegacySettings());
        saveSettings();
        return;
      }
      applySettings(readLegacySettings());
    } catch (e) {
      logS(e);
      logger?.error?.('PiP', 'Error loading settings', e);
    }
  };

  /**
   * Save settings through the shared bridge, or the legacy key before the blob.
   * @returns {void}
   */
  const saveSettings = () => {
    const store = bridgedStore();
    if (store) {
      store.updateModuleSettings(MODULE_NAME, { shortcut: { ...pipSettings.shortcut } });
    } else {
      try {
        U.storage?.setItem(
          pipSettings.storageKey,
          JSON.stringify({ shortcut: pipSettings.shortcut })
        );
      } catch (e) {
        logS(e);
        logger?.error?.('PiP', 'Error saving settings', e);
      }
    }
    // Keep page-context keydown bridge in sync with the updated shortcut.
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
        const pageGlobal = U.getPageWindow();
        const doc = pageGlobal?.document || document;
        // Firefox adds a data-pip attribute or sets a special class on PiP videos
        const pipVideo = doc.querySelector('video[__pip]') || doc.querySelector('video._pip');
        if (pipVideo && pipVideo.tagName?.toLowerCase() === 'video') {
          return /** @type {HTMLVideoElement} */ (pipVideo);
        }
      } catch (_e) {
        logS(_e);
        /* empty */
      }
    }

    return null;
  };

  /**
   * Try to request PiP from the page context (unsafeWindow side) on Firefox.
   * @returns {Promise<boolean>} true when PiP was activated
   */
  const requestFirefoxPipViaPageContext = async () => {
    try {
      const pageGlobal = U.getPageWindow();
      const pageVideo = /** @type {HTMLVideoElement | null} */ (
        pageGlobal?.document?.querySelector?.('video.html5-main-video, #movie_player video, video')
      );
      if (pageVideo && typeof pageVideo.requestPictureInPicture === 'function') {
        await pageVideo.requestPictureInPicture();
        setSessionActive(true);
        return true;
      }
      // Try calling via prototype
      const proto = pageGlobal?.HTMLVideoElement?.prototype;
      if (pageVideo && proto && typeof proto.requestPictureInPicture === 'function') {
        await proto.requestPictureInPicture.call(pageVideo);
        setSessionActive(true);
        return true;
      }
    } catch (_e) {
      logS(_e);
      /* no-op */
    }
    return false;
  };

  /**
   * Firefox PiP path: prefer native button / page-context APIs before bridge fallbacks.
   * @param {HTMLVideoElement} _video
   * @returns {Promise<void>}
   */
  const enterOrExitFirefoxPip = async _video => {
    ensureFirefoxPagePipBridge();

    // Try exiting PiP first if active. Use getCurrentPiPElement() (which
    // falls back to Firefox's video[__pip] attribute) rather than the raw
    // document.pictureInPictureElement check: Firefox userscript contexts
    // don't always reflect that property, and a missed check falls through
    // to the click fallback instead of exiting.
    if (typeof document.exitPictureInPicture === 'function' && getCurrentPiPElement()) {
      try {
        await document.exitPictureInPicture();
        setSessionActive(false);
        return;
      } catch (_e) {
        logS(_e);
        /* no-op: fall through to click-based exit below */
      }
    }

    // Try the native YouTube PiP button (most reliable on Firefox)
    const toggledByButton = clickNativeYouTubePipButton();
    if (toggledByButton) {
      setSessionActive(true);
      return;
    }

    // Try page-context requestPictureInPicture via unsafeWindow
    if (await requestFirefoxPipViaPageContext()) return;

    // Final Firefox fallback: use postMessage to trigger PiP from page context
    // This avoids CSP violations from inline script injection
    try {
      const bridgeSuccess = await requestFirefoxPiPViaBridge();
      if (bridgeSuccess) {
        setSessionActive(true);
        return;
      }

      // Also try using Greasemonkey's cloneInto/exportFunction if available
      const pageGlobal2 = U.getPageWindow();
      if (pageGlobal2) {
        const pageVid = /** @type {HTMLVideoElement | null} */ (
          pageGlobal2.document?.querySelector?.('video')
        );
        if (pageVid && typeof pageVid.requestPictureInPicture === 'function') {
          pageVid.requestPictureInPicture().catch(() => {
            /* ignore */
          });
          setSessionActive(true);
        }
      }
    } catch (_e) {
      logS(_e);
      logger?.warn?.('PiP', 'All Firefox PiP fallbacks exhausted');
    }
  };

  /**
   * Exit any currently active PiP session (used before entering a new one).
   * @param {HTMLVideoElement} video
   * @returns {Promise<boolean>} true when an exit was performed
   */
  const exitActivePip = async video => {
    const currentPiP = getCurrentPiPElement();
    if (currentPiP && currentPiP !== video) {
      if (typeof document.exitPictureInPicture === 'function') {
        await document.exitPictureInPicture();
      }
      setSessionActive(false);
      return true;
    }
    if (currentPiP === video) {
      if (typeof document.exitPictureInPicture === 'function') {
        await document.exitPictureInPicture();
      }
      setSessionActive(false);
    }
    return false;
  };

  /**
   * Request PiP with one metadata-wait retry, falling back to the native button.
   * @param {HTMLVideoElement} video
   * @returns {Promise<void>}
   */
  const requestPipWithRetry = async video => {
    try {
      await requestPictureInPictureCompat(video);
    } catch (_e) {
      logS(_e);
      await waitForMetadataOnce(video);
      try {
        await requestPictureInPictureCompat(video);
      } catch (_e) {
        logS(_e);
        const toggledByButton = clickNativeYouTubePipButton();
        if (!toggledByButton) {
          throw new Error('requestPictureInPicture is not available on video element');
        }
      }
    }
  };

  /**
   * Non-Firefox (Chromium) PiP path via the W3C API.
   * @param {HTMLVideoElement} video
   * @returns {Promise<void>}
   */
  const toggleChromiumPip = async video => {
    await exitActivePip(video);
    if (getCurrentPiPElement() === video) return;

    const hadDisablePiP = video.disablePictureInPicture === true;
    if (hadDisablePiP) {
      try {
        video.disablePictureInPicture = false;
      } catch (_e) {
        logS(_e);
        /* ignore */
      }
    }

    // Keep user activation path short, but retry once after metadata for API timing quirks.
    await requestPipWithRetry(video);

    if (hadDisablePiP) {
      try {
        video.disablePictureInPicture = true;
      } catch (_e) {
        logS(_e);
        /* ignore */
      }
    }

    setSessionActive(true);
  };

  /**
   * Toggle Picture-in-Picture mode
   * @param {HTMLVideoElement} video - The video element
   * @returns {Promise<void>}
   */
  const togglePictureInPicture = async video => {
    if (!video) return;

    try {
      const isFirefox = /firefox/i.test(navigator.userAgent || '');

      // Firefox path: always prefer native YouTube PiP button first
      // because Firefox doesn't expose requestPictureInPicture in userscript context
      if (isFirefox) {
        await enterOrExitFirefoxPip(video);
        return;
      }

      // Non-Firefox path (Chrome, Edge, Safari): standard W3C API.
      await toggleChromiumPip(video);
    } catch (error) {
      logS(error);
      logger?.error?.('PiP', 'Failed to toggle Picture-in-Picture', error);
    }
  };

  /** Stop the browser from acting on this key event. @param {KeyboardEvent} e */
  const preventKeyEventDefaults = e => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }
  };

  /**
   * Hotkey toggle when the sandbox cannot reach the video element directly:
   * try the native button, then the page bridge.
   * @param {KeyboardEvent} e
   * @param {boolean} allowBrowserFallback
   * @returns {boolean}
   */
  const togglePipWithoutVideoHandle = (e, allowBrowserFallback) => {
    if (clickNativeYouTubePipButton()) {
      setSessionActive(true);
      preventKeyEventDefaults(e);
      return true;
    }
    // Fallback to page bridge when direct video handle is unavailable in sandbox.
    void requestFirefoxPiPViaBridge().then(success => {
      if (success) setSessionActive(true);
    });
    if (!allowBrowserFallback) {
      preventKeyEventDefaults(e);
      return true;
    }
    return false;
  };

  /** One delayed retry of the native PiP button after a hotkey toggle. */
  const schedulePipButtonRetry = () => {
    setTimeout(() => {
      if (document.pictureInPictureElement) return;
      if (clickNativeYouTubePipButton()) {
        setSessionActive(true);
        return;
      }
      void requestFirefoxPiPViaBridge().then(success => {
        if (success) setSessionActive(true);
      });
    }, 70);
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
    if (!video) return togglePipWithoutVideoHandle(e, allowBrowserFallback);

    try {
      if (video.disablePictureInPicture === true) {
        video.disablePictureInPicture = false;
      }
    } catch (_e) {
      logS(_e);
    }

    // Firefox hotkey path: preserve user gesture by trying native button first.
    // Async promise fallbacks can lose gesture trust in Firefox.
    let handled = false;
    if (clickNativeYouTubePipButton()) {
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

    if (!(handled || document.pictureInPictureElement)) schedulePipButtonRetry();

    if (!(handled || allowBrowserFallback)) {
      // Custom shortcuts in Firefox should not fall through to browser defaults (e.g. Ctrl+P print).
      void togglePictureInPicture(video);
      handled = true;
    }

    if (!handled) return false;

    preventKeyEventDefaults(e);
    return true;
  };

  /**
   * Inject PiP settings styles via the shared style system.
   * Uses design-system.js getStyle(...) + StyleManager.add so the CSS is
   * owned by the shared host (`#youtube-plus-styles`) and stays in sync
   * with other modules. The byId('pip-styles') guard preserves
   * compatibility with installs that injected a raw `<style id="pip-styles">`
   * element before styles moved to the shared host.
   * @returns {void}
   */
  const addPipStyles = () => {
    if (byId('pip-styles')) return;
    const styles = window.YouTubePlusDesignSystem?.getStyle?.('pip-styles') || '';
    YouTubeUtils.StyleManager.add('pip-styles', styles);
  };

  /**
   * Attach event handlers to the static PiP settings UI.
   * The HTML is generated by settings-helpers.js; this function only
   * wires up the shortcut handlers and initializes glass dropdowns. The
   * enable checkbox is owned by the settings modal's general handler.
   */
  const attachPipHandlers = () => {
    const advancedSection = qs('.yp-settings-section[data-section="advanced"]');
    if (!advancedSection) return;
    const enableItem = advancedSection.querySelector('.pip-settings-item');
    if (!enableItem || /** @type {HTMLElement} */ (enableItem).dataset.handlerAttached) return;
    /** @type {HTMLElement} */ (enableItem).dataset.handlerAttached = '1';

    addPipStyles();

    window.YouTubePlusDesignSystem?.initGlassDropdown?.({
      dropdown: byId('pip-modifier-dropdown'),
      hiddenSelect: byId('pip-modifier-combo'),
    });

    const modifierCombo = byId('pip-modifier-combo');
    if (modifierCombo instanceof HTMLSelectElement) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        modifierCombo,
        'change',
        (/** @type {Event} */ e) => {
          const target = /** @type {EventTarget & HTMLSelectElement} */ (e.target);
          const value = target.value;
          pipSettings.shortcut.ctrlKey = value.includes('ctrl');
          pipSettings.shortcut.altKey = value.includes('alt');
          pipSettings.shortcut.shiftKey = value.includes('shift');
          saveSettings();
        },
        undefined,
        false
      );
    }

    const pipKeyInput = byId('pip-key');
    if (pipKeyInput instanceof HTMLInputElement) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        pipKeyInput,
        'input',
        (/** @type {Event} */ e) => {
          const target = /** @type {EventTarget & HTMLInputElement} */ (e.target);
          if (target.value) {
            pipSettings.shortcut.key = target.value.toUpperCase();
            saveSettings();
          }
        },
        undefined,
        false
      );
      window.YouTubePlusCleanupManager?.registerListener?.(
        pipKeyInput,
        'keydown',
        (/** @type {KeyboardEvent} */ e) => e.stopPropagation(),
        undefined,
        false
      );
    }
  };

  /** @type {YouTubePlusFeatureContext | null} */
  let pipRuntimeScope = null;

  const startPipRuntime = (/** @type {YouTubePlusFeatureContext} */ ctx) => {
    // Each route entry wires a fresh runtime group; the exit (or the
    // facade's cleanup) disposes it together with the page bridges.
    const scope = ctx.scope();
    pipRuntimeScope = scope;

    // Initialize
    loadSettings();

    // Event listeners: register with cleanupManager for SPA cleanup.
    const isEditableTarget = (/** @type {EventTarget | null} */ target) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toUpperCase();
      if (target.isContentEditable) return true;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return !!target.closest('input, textarea, select, [contenteditable="true"]');
    };

    const isFirefoxNativePipShortcutSetting = () => {
      const s = pipSettings.shortcut;
      const normalizedKey = String(s.key || '').trim();
      return (
        s.ctrlKey === true && s.shiftKey === true && s.altKey === false && normalizedKey === ']'
      );
    };

    let lastHotkeyTriggerTs = 0;

    /**
     * @param {KeyboardEvent} evt
     * @param {{ key: string, shiftKey: boolean, altKey: boolean, ctrlKey: boolean }} shortcut
     */
    const hotkeyMatches = (evt, shortcut) => {
      const expectedCode = keyToCode(shortcut.key);
      const eventCode = String(evt.code || '');
      const eventKey = String(evt.key || '').toUpperCase();
      const keyMatches =
        eventKey === shortcut.key.toUpperCase() || (expectedCode && eventCode === expectedCode);
      // Exact modifier match: an "at least" match lets Ctrl+Shift+P satisfy Shift+P.
      return (
        evt.shiftKey === shortcut.shiftKey &&
        evt.altKey === shortcut.altKey &&
        evt.ctrlKey === shortcut.ctrlKey &&
        keyMatches
      );
    };

    /** @param {KeyboardEvent} evt @param {number} now */
    const handleFirefoxHotkey = (evt, now) => {
      // If the page-context keydown bridge is installed, defer entirely to it.
      // The bridge runs in page context (trusted user gesture for PiP) and is
      // registered with capture:true. Our userscript handler may run BEFORE the
      // bridge handler depending on listener registration order, so if we call
      // stopImmediatePropagation here we'd starve the bridge. Instead, when the
      // bridge is present, do nothing and let it handle the shortcut natively.
      const pageGlobal = U.getPageWindow();
      const bridgeInstalled = Boolean(
        /** @type {Record<string, unknown>} */ (/** @type {object} */ (pageGlobal))?.[
          FIREFOX_PIP_KEYDOWN_BRIDGE_FLAG
        ]
      );
      const pageHandledTs = Number(pageGlobal?.__ytplusPipPageHandled || 0);
      if (now - pageHandledTs < 300) {
        // Bridge already handled this key event.
        return false;
      }
      // Fall back even when bridge is installed; this covers layout/code mismatches
      // where page bridge may miss shortcut matching in Firefox.
      return toggleFirefoxPiPFromHotkey(
        evt,
        bridgeInstalled ? false : isFirefoxNativePipShortcutSetting()
      );
    };

    /** @param {KeyboardEvent} evt @param {Event} e */
    const triggerChromiumPip = (evt, e) => {
      const video = getVideoElement();
      if (video) {
        void togglePictureInPicture(video);
      } else if (!clickNativeYouTubePipButton()) {
        logger?.warn?.('PiP', 'Picture-in-Picture API is unavailable in this browser/context');
      }
      if (!((evt instanceof Event && document.pictureInPictureElement) || getVideoElement())) {
        logger?.warn?.('PiP', 'Picture-in-Picture API is unavailable in this browser/context');
      }
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      e.preventDefault();
    };

    /**
     * True when a keydown event should trigger the PiP shortcut.
     * @param {KeyboardEvent} evt
     */
    const shouldHandlePipHotkey = evt => {
      if (!evt || typeof evt !== 'object') return false;
      if (typeof evt.key !== 'string' || typeof evt.code !== 'string') return false;
      if (evt.repeat || evt.isComposing) return false;
      if (evt.metaKey) return false;
      if (isEditableTarget(evt.target)) return false;
      return hotkeyMatches(evt, pipSettings.shortcut);
    };

    const pipKeydownHandler = (/** @type {KeyboardEvent} */ e) => {
      const evt = e;
      if (!shouldHandlePipHotkey(evt)) return;
      const now = Date.now();
      if (now - lastHotkeyTriggerTs < 250) {
        e.preventDefault();
        return;
      }
      lastHotkeyTriggerTs = now;
      if (/firefox/i.test(navigator.userAgent || '')) {
        if (!handleFirefoxHotkey(evt, now)) return;
      } else {
        triggerChromiumPip(evt, e);
      }
    };
    // Register keydown only: a keyup handler double-fires on every shortcut press.
    scope.listen(document, 'keydown', /** @type {EventListener} */ (pipKeydownHandler), {
      capture: true,
    });
    scope.listen(window, 'keydown', /** @type {EventListener} */ (pipKeydownHandler), {
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
      const pageGlobal = U.getPageWindow();
      const pageDocument = pageGlobal?.document;
      const pageWindow = pageGlobal;
      if (
        pageDocument &&
        pageDocument !== document &&
        /** @type {{ addEventListener?: unknown }} */ (pageDocument).addEventListener
      ) {
        scope.listen(pageDocument, 'keydown', /** @type {EventListener} */ (pipKeydownHandler), {
          capture: true,
        });
      }
      if (
        pageWindow &&
        pageWindow !== window &&
        /** @type {{ addEventListener?: unknown }} */ (pageWindow).addEventListener
      ) {
        scope.listen(pageWindow, 'keydown', /** @type {EventListener} */ (pipKeydownHandler), {
          capture: true,
        });
      }
    } catch (_e) {
      logS(_e);
      // Firefox sandbox may throw here; continue without a page-level listener.
      logger?.warn?.('PiP', 'Could not register page-context keydown listener (Firefox sandbox)');
    }

    const storageHandler = (/** @type {Event} */ e) => {
      if (!(e instanceof StorageEvent)) return;
      if (e.key === pipSettings.storageKey) {
        loadSettings();
      }
    };
    scope.listen(window, 'storage', storageHandler);

    // Blob changes arrive through the unified event; only pip keys matter.
    scope.listen(window, 'youtube-plus-settings-updated', (/** @type {Event} */ e) => {
      if (window.YouTubePlusSettingsStore?.affectsModule?.(e, MODULE_NAME) === false) return;
      loadSettings();
    });

    scope.listen(
      window,
      'load',
      () => {
        if (!wasSessionActive() || document.pictureInPictureElement) {
          return;
        }

        // Bound how long a stale PiP session flag waits for the next user
        // interaction before it is treated as resumable. Without this, the
        // first keypress of any kind (even many videos later) resumes PiP
        // from a leftover flag, and Firefox rejects it with "requires user
        // activation".
        const RESUME_WINDOW_MS = 15000;
        const resumeDeadline = Date.now() + RESUME_WINDOW_MS;

        const resumePiP = () => {
          if (Date.now() > resumeDeadline) {
            setSessionActive(false);
            return;
          }
          const video = getVideoElement();
          if (!video) return;

          togglePictureInPicture(video).catch(() => {
            // If resume fails we reset the session flag to avoid loops
            setSessionActive(false);
          });
        };

        // Removing the other listener when one fires needs its matching event
        // type, so a dormant listener cannot stay armed after the resume
        // attempt is over. Each listener also self-removes via {once:true}.
        const ensureCleanup = (
          /** @type {string} */ type,
          /** @type {EventListenerOrEventListenerObject | null} */ handler
        ) => {
          if (!handler) return;
          document.removeEventListener(type, handler, true);
        };

        const cleanupListeners = () => {
          ensureCleanup('pointerdown', pointerListener);
          ensureCleanup('keydown', keyListener);
          clearTimeout(expiryTimer);
        };

        const pointerListener = () => {
          cleanupListeners();
          resumePiP();
        };

        const keyListener = () => {
          cleanupListeners();
          resumePiP();
        };

        window.YouTubePlusCleanupManager?.registerListener?.(
          document,
          'pointerdown',
          pointerListener,
          {
            once: true,
            capture: true,
          },
          true
        );
        window.YouTubePlusCleanupManager?.registerListener?.(
          document,
          'keydown',
          keyListener,
          {
            once: true,
            capture: true,
          },
          true
        );

        // Defense in depth: even with correct cross-removal above, expire the
        // resume attempt outright after RESUME_WINDOW_MS so it can never fire
        // on a much-later, unrelated interaction.
        const expiryTimer = setTimeout(() => {
          cleanupListeners();
          setSessionActive(false);
        }, RESUME_WINDOW_MS);
      },
      undefined
    );

    const leavePipHandler = () => {
      setSessionActive(false);
    };
    scope.listen(document, 'leavepictureinpicture', leavePipHandler);
  };

  const cleanupPipRuntime = () => {
    // The runtime group owns every listener; disposing releases them all
    // so a later lifecycle start re-wires cleanly.
    pipRuntimeScope?.dispose?.();
    pipRuntimeScope = null;
  };

  // Register settings modal listener at module scope so it fires
  // regardless of route. Without this, the listener inside
  // startPipRuntime() would only be registered after whenRelevant
  // decides the route is relevant, causing a race condition where
  // opening the modal on a non-/watch page would miss the event.
  window.YouTubePlusCleanupManager?.registerListener?.(
    document,
    'youtube-plus-settings-modal-opened',
    () => {
      // Ensure settings handlers are attached even on non-/watch pages.
      // attachPipHandlers is idempotent (checks for existing DOM).
      setTimeout(() => {
        attachPipHandlers();
      }, 50);
    },
    undefined,
    true
  );

  // PiP has two lifecycles:
  //
  //   1. Runtime on /watch: the keyboard shortcut and the page bridges are
  //      owned by the FeatureLifecycle start; the route exit releases them.
  //   2. Settings UI on the "Advanced" tab: the shortcut editor is injected
  //      when the user opens that section (the module scope above).
  const pipFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'pip',
    settingsKey: 'enablePip',
    // PiP only makes sense on the watch player; the fullscreen shorts player
    // is excluded on purpose.
    routes: ['watch'],
    start: startPipRuntime,
    stop: () => {
      if (pipRuntimeScope) {
        pipRuntimeScope.dispose();
        pipRuntimeScope = null;
      }
      removeFirefoxPipBridges();
    },
  });
  pipFeature?.sync();

  if (window.YouTubeUtils?.onSectionActive) {
    window.YouTubeUtils.onSectionActive('advanced', () => {
      // Attach handlers on every activation. attachPipHandlers is
      // idempotent and short-circuits when handlers are already attached.
      setTimeout(() => {
        attachPipHandlers();
      }, 25);
    });
  }

  // Feature facade
  const YouTubePlusPip = {
    cleanup: cleanupPipRuntime,
  };
  // Test-only surface: internal entry points and state accessors live here,
  // not on the facade root.
  U?.exposeTestHooks?.(YouTubePlusPip, {
    init: startPipRuntime,
    keyToCode,
    isFeatureEnabled: () => true,
    getSettings: () => ({
      ...pipSettings,
      shortcut: { ...pipSettings.shortcut },
    }),
    getBridgeToken,
    ensureFirefoxPagePipBridge,
    requestFirefoxPiPViaBridge,
  });

  if (typeof window !== 'undefined') {
    window.YouTubePlusPip = YouTubePlusPip;
  }
})();
