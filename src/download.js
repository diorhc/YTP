/**
 * YouTube+ Download Module
 * Unified download system with button UI and download functionality
 * @version 2.5.3
 */

/**
 * @typedef {{
 *   abort: () => void,
 * }} GMRequestHandle
 */

/**
 * @typedef {{
 *   url: string,
 *   method?: string,
 *   headers?: Record<string, string>,
 *   data?: string,
 *   body?: BodyInit,
 *   responseType?: string,
 *   timeout?: number,
 *   signal?: AbortSignal,
 *   onRequest?: (request: GMRequestHandle) => void,
 *   onload?: (response: GMResponseLike) => void,
 *   onerror?: (error: unknown) => void,
 *   onprogress?: (progress: unknown) => void,
 *   onabort?: () => void,
 *   ontimeout?: () => void,
 *   [key: string]: unknown,
 * }} GMDownloadRequestOptions
 */

/**
 * @typedef {{
 *   name: string,
 *   origin: string,
 *   referer: string,
 * }} CnvConverter
 */

/**
 * @typedef {{
 *   link: string,
 *   format: string,
 *   audioBitrate?: string,
 *   videoQuality?: string,
 *   filenameStyle?: string,
 *   vCodec?: string,
 * }} ConversionPayload
 */

/**
 * @typedef {{
 *   url?: string,
 *   filename?: string,
 *   status?: string,
 *   error?: { code?: string, message?: string },
 *   [key: string]: unknown,
 * }} CnvDownloadInfo
 */

/**
 * @typedef {{
 *   name: string,
 *   api: string,
 * }} CobaltInstance
 */

/**
 * @typedef {{
 *   url: string,
 *   downloadMode: string,
 *   videoQuality?: string,
 *   audioFormat?: string,
 *   audioBitrate?: string,
 *   [key: string]: unknown,
 * }} CobaltPayload
 */

/**
 * @typedef {{
 *   itag?: number,
 *   url: string,
 *   mimeType?: string,
 *   qualityLabel?: string,
 *   bitrate?: number,
 *   audioBitrate?: number,
 *   height?: number,
 *   width?: number,
 *   contentLength?: string,
 *   [key: string]: unknown,
 * }} YouTubeStreamingFormat
 */

/**
 * @typedef {{
 *   playabilityStatus?: { status?: string, reason?: string },
 *   streamingData?: {
 *     formats?: YouTubeStreamingFormat[],
 *     adaptiveFormats?: YouTubeStreamingFormat[],
 *   },
 *   [key: string]: unknown,
 * }} AndroidPlayerData
 */

/**
 * @typedef {{
 *   format: string,
 *   quality: string,
 *   audioBitrate: string,
 *   embedThumbnail: boolean,
 *   onProgress: ((progress: DownloadProgress) => void) | null,
 *   onCancel: (() => boolean) | null,
 *   onRequest: ((request: GMRequestHandle) => void) | null,
 * }} NormalizedDownloadOptions
 */

/**
 * @typedef {{
 *   id?: string,
 *   title: string,
 *   format: string,
 *   qualityLabel?: string,
 *   status: string,
 *   progress?: number,
 *   cancelled?: boolean,
 *   startTime?: number,
 *   request?: GMRequestHandle | null,
 *   cancel?: () => void,
 *   element?: HTMLElement,
 *   [key: string]: unknown,
 * }} ActiveDownloadItem
 */

/**
 * @typedef {{
 *   loaded?: number,
 *   total?: number,
 *   percent?: number,
 *   [key: string]: unknown,
 * }} DownloadProgress
 */

/**
 * @typedef {{
 *   title: string,
 *   format: string,
 *   qualityLabel: string,
 *   status: string,
 *   timestamp: number,
 *   [key: string]: unknown,
 * }} DownloadHistoryEntry
 */

/**
 * @typedef {{
 *   format?: string,
 *   quality?: string,
 *   audioBitrate?: string,
 *   embedThumbnail?: boolean,
 *   source?: string,
 *   onProgress?: ((progress: DownloadProgress) => void) | null,
 *   onCancel?: (() => boolean) | null,
 *   onRequest?: ((request: GMRequestHandle) => void) | null,
 *   onComplete?: (() => void) | null,
 *   [key: string]: unknown,
 * }} EnqueueDownloadOptions
 */

/**
 * @typedef {{
 *   settings?: Record<string, unknown>,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   getElement: (selector: string) => Element | null,
 *   YouTubeUtils?: Record<string, unknown>,
 *   [key: string]: unknown,
 * }} DownloadButtonManagerConfig
 */

/**
 * @typedef {{
 *   qualitySelect: HTMLElement & { value?: string, dataset: DOMStringMap },
 *   [key: string]: unknown,
 * }} ModalFormParts
 */

(function () {
  const U = window.YouTubeUtils;
  // Pass the original error straight to U.logSuppressed, which normalizes it.
  const logS = (/** @type {unknown} */ err, /** @type {string|undefined} */ label = undefined) =>
    U?.logSuppressed?.(err, label || 'Download');
  const _setSafeHTML = U?.setSafeHTML;
  const createVisibilityAwareInterval =
    U?.createVisibilityAwareInterval ||
    /**
     * @param {() => void} callback
     * @param {number} delay
     */
    ((callback, delay) => {
      const id = setInterval(callback, delay);
      window.YouTubePlusCleanupManager?.registerInterval?.(id);
      return {
        stop: () => clearInterval(id),
        pause: () => clearInterval(id),
        resume: () => {},
      };
    });
  const setTimeout_ = setTimeout.bind(window);
  const DOWNLOAD_BUTTON_STYLE_ID = 'yp-download-button-styles';
  const DOWNLOAD_MODAL_STYLE_ID = 'yp-download-styles';
  const DROPDOWN_HIDE_DELAY_MS = 180;

  const SELECTORS = {
    BUTTON: '.yp-download-button',
    DROPDOWN: '.download-options',
    RIGHT_CONTROLS: '.ytp-right-controls',
  };

  const NOTIFY_DURATION = {
    SHORT: 2000,
    MEDIUM: 3000,
    LONG: 5000,
  };

  /**
   * Create a DOM element with attributes, inline styles, text, and children in one call.
   * @param {string} tag
   * @param {{ attrs?: Record<string,string>, style?: Record<string,string>, text?: string, children?: (Node|string)[] }} [opts]
   * @returns {HTMLElement}
   */
  function createEl(tag, opts = {}) {
    const el = document.createElement(tag);
    if (opts.attrs) {
      for (const [k, v] of Object.entries(opts.attrs)) el.setAttribute(k, v);
    }
    if (opts.style) Object.assign(el.style, opts.style);
    if (opts.text !== undefined) el.textContent = opts.text;
    if (opts.children) {
      for (const child of opts.children) {
        el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      }
    }
    return el;
  }

  // Initialize logger early (logger.js loads before this module in build order)
  const _YouTubePlusLogger = window.YouTubePlusLogger;
  const logger =
    typeof _YouTubePlusLogger !== 'undefined' && _YouTubePlusLogger
      ? _YouTubePlusLogger.createLogger('Download')
      : {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        };

  /**
   * Inject one static download CSS bundle through the shared StyleManager.
   * @param {string} styleId
   * @returns {void}
   */
  const injectStyleBundle = styleId => {
    try {
      const css = window.YouTubePlusDesignSystem?.getStyle?.(styleId) || '';
      if (!css) return;
      const SM = U?.StyleManager || YouTubeUtils?.StyleManager;
      if (SM && typeof SM.add === 'function') {
        SM.add(styleId, css);
      }
    } catch (e) {
      logS(e);
      logger?.warn?.('[YouTube+ Download] style injection failed:', e);
    }
  };

  /** Button + dropdown CSS; needed as soon as the button mounts. */
  const injectDownloadStyles = () => injectStyleBundle(DOWNLOAD_BUTTON_STYLE_ID);

  /**
   * Inject the download modal CSS right before the modal is inserted, so a
   * page that never opens it costs nothing for its rules.
   * @returns {void}
   */
  const ensureDownloadModalStyles = () => injectStyleBundle(DOWNLOAD_MODAL_STYLE_ID);

  /** @param {boolean} enabled */
  const refreshDownloadVisibility = enabled => {
    const btns = document.querySelectorAll(SELECTORS.BUTTON);
    btns.forEach(btn => {
      if (/** @type {HTMLElement} */ (btn).style) {
        /** @type {HTMLElement} */ (btn).style.setProperty(
          'display',
          enabled ? '' : 'none',
          'important'
        );
      }
    });
    const dd = /** @type {HTMLElement | null} */ ($(SELECTORS.DROPDOWN));
    if (dd) {
      dd.style.setProperty('display', enabled ? '' : 'none', 'important');
      if (!enabled) dd.classList.remove('visible');
    }
  };

  // -------------------------------------------------------------------------
  // PoT (Proof-of-Origin Token) collector
  // -------------------------------------------------------------------------
  // YouTube's `/api/timedtext` endpoint silently returns HTTP 200 with an
  // empty body for ASR (auto-generated) and many translated captions unless
  // the request carries a `pot` (BotGuard) token plus matching client metadata
  // params. The YouTube player attaches `pot` to every subtitle request it
  // makes, so we hook `fetch`/`XMLHttpRequest` on `unsafeWindow` lazily, cache
  // `pot`+`potc`+client params per `videoId` when the player requests
  // `/api/timedtext`, and reuse them for our own subtitle downloads.
  // YouTube quirk: without these params every URL variant returns 0 bytes.
  /** @type {Map<string, Record<string, string>>} */
  const _potParamsByVideoId = new Map();
  const _POT_PARAMS_MAX = 50;
  /** Params copied from a player request to forge our own. */
  const _potCarriedParamNames = [
    'pot',
    'potc',
    'c',
    'cver',
    'cplayer',
    'cos',
    'cosver',
    'cplatform',
    'cbr',
    'cbrver',
    'xorb',
    'xobt',
    'xovt',
  ];
  let _potHooksInstalled = false;
  let _potElicitInflight = false;
  /** @type {Function|null} */
  let _origFetch = null;
  /** @type {Function|null} */
  let _origXhrOpen = null;

  function _pageGlobal() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }

  function _rememberPotFromTimedtextUrl(/** @type {string} */ rawUrl) {
    try {
      if (!rawUrl || rawUrl.indexOf('/api/timedtext') === -1) return;
      const u = new URL(rawUrl, 'https://www.youtube.com');
      const videoId = u.searchParams.get('v');
      const pot = u.searchParams.get('pot');
      if (!(videoId && pot)) return;
      /** @type {Record<string, string>} */
      const collected = {};
      for (const name of _potCarriedParamNames) {
        const value = u.searchParams.get(name);
        if (value != null && value !== '') collected[name] = value;
      }
      _potParamsByVideoId.set(videoId, collected);
      if (_potParamsByVideoId.size > _POT_PARAMS_MAX) {
        const firstKey = _potParamsByVideoId.keys().next().value;
        if (firstKey !== undefined) _potParamsByVideoId.delete(firstKey);
      }
    } catch (_e) {
      logS(_e);
      // Ignore parse failures: a hook side-effect must not break the page.
    }
  }

  /**
   * Install global fetch / XHR hooks that capture PoT (Proof-of-Origin Token)
   * params from YouTube's /api/timedtext caption requests so the cnv.cx
   * subtitle backend can be given params only present on those URLs.
   *
   * Patching global prototypes can interfere with other scripts or YouTube's
   * own code, so the interception is read-only (it inspects URLs and forwards
   * every argument unchanged), interceptor errors never reach the caller, the
   * hooks install once per page and are never uninstalled, and a second call
   * to _installPotHooksOnce is a no-op.
   */
  /** The PoT capture hooks exist only for the subtitle-download feature, so
   * users without it get no global fetch/XHR patches. The gate re-evaluates
   * on every lazy trigger, so enabling the feature later installs the hooks
   * on the next such interaction.
   * @returns {boolean}
   */
  function _potHooksFeatureEnabled() {
    return U?.loadFeatureEnabled?.('enableDownload') !== false;
  }

  /**
   * @param {RequestInfo | URL | unknown} input
   * @returns {string}
   */
  function extractUrlFromFetchInput(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    const inputWithUrl = /** @type {{ url?: unknown }} */ (
      input && typeof input === 'object' ? input : {}
    );
    return typeof inputWithUrl.url === 'string' ? inputWithUrl.url : '';
  }

  /**
   * @param {Function | unknown} realFetch
   * @param {Window & typeof globalThis} pg
   * @returns {(input: RequestInfo | URL, _init?: RequestInit) => unknown}
   */
  function createPatchedFetch(realFetch, pg) {
    /** @this {unknown} */
    return function patchedFetch(
      /** @type {RequestInfo | URL} */ input,
      /** @type {RequestInit | undefined} */ _init
    ) {
      try {
        const url = extractUrlFromFetchInput(input);
        if (url) _rememberPotFromTimedtextUrl(url);
      } catch (_e) {
        logS(_e);
      }
      const fn = typeof realFetch === 'function' ? realFetch : pg.fetch;
      return /** @type {Function} */ (fn).call(this, input, _init);
    };
  }

  /**
   * @param {Function | unknown} realXhrOpen
   * @param {Window & typeof globalThis} pg
   * @returns {(...args: unknown[]) => unknown}
   */
  function createPatchedOpen(realXhrOpen, pg) {
    /** @this {XMLHttpRequest} */
    return function patchedOpen(...args) {
      try {
        const url = args[1];
        if (typeof url === 'string') _rememberPotFromTimedtextUrl(url);
      } catch (_e) {
        logS(_e);
      }
      const fn =
        typeof realXhrOpen === 'function' ? realXhrOpen : pg.XMLHttpRequest?.prototype?.open;
      return /** @type {Function} */ (fn).apply(this, args);
    };
  }

  function _installPotHooksOnce() {
    if (_potHooksInstalled) return;
    // Only subtitle-download users pay for the global patches.
    if (!_potHooksFeatureEnabled()) return;
    const pg = _pageGlobal();
    if (!pg || typeof pg !== 'object') return;
    try {
      _origFetch = pg.fetch;
      if (typeof _origFetch === 'function') {
        const patchedFetch = createPatchedFetch(_origFetch, pg);
        pg.fetch = /** @type {typeof fetch} */ (patchedFetch);
        /** @type {typeof fetch & { __ytpPlusPotPatch?: boolean }} */ (pg.fetch).__ytpPlusPotPatch =
          true;
      }
      const xhrProto = pg.XMLHttpRequest?.prototype;
      if (xhrProto && typeof xhrProto.open === 'function') {
        _origXhrOpen = /** @type {(...args: unknown[]) => void} */ (xhrProto.open);
        xhrProto.open = /** @type {typeof xhrProto.open} */ (createPatchedOpen(_origXhrOpen, pg));
      }
      _potHooksInstalled = true;
    } catch (_e) {
      logS(_e);
      // If we cannot patch (sandboxed window), we silently degrade.
    }
  }

  // Session-once lazy install: the hooks install exactly once per page, at
  // the user's first subtitle-UI interaction or before an elicit flow needs a
  // token, so SPA navigation never re-wraps fetch and grows the chain.
  if (typeof U?.cleanupManager?.register === 'function') {
    U.cleanupManager.register(destroyManagerPanel);
  }

  /**
   * @param {Element & Record<string, unknown>} playerEl
   * @returns {Record<string, unknown> | null}
   */
  function getCaptionTrackToElicit(playerEl) {
    try {
      const list =
        typeof playerEl.getOption === 'function'
          ? playerEl.getOption('captions', 'tracklist', {
              includeAsr: true,
            }) || []
          : [];
      if (Array.isArray(list) && list.length) {
        return list.find(t => t && t.languageCode === 'ru' && t.kind === 'asr') || list[0];
      }
    } catch (_e) {
      logS(_e);
    }
    return null;
  }

  /**
   * The caption track the user has on now, so it can be restored afterwards.
   * @param {Element & Record<string, unknown>} playerEl
   * @returns {unknown}
   */
  function readPlayerCaptionTrack(playerEl) {
    if (typeof playerEl.getOption !== 'function') return null;
    try {
      return playerEl.getOption('captions', 'track');
    } catch (_e) {
      // the page player's captions module is not ready
      logS(_e);
      return null;
    }
  }

  /**
   * @param {Element & Record<string, unknown>} playerEl
   * @param {Window & typeof globalThis} pg
   * @returns {void}
   */
  function triggerCaptionFetch(playerEl, pg) {
    const trackToLoad = getCaptionTrackToElicit(playerEl);
    if (trackToLoad && typeof playerEl.setOption === 'function') {
      try {
        playerEl.setOption('captions', 'track', trackToLoad);
        return;
      } catch (_e) {
        logS(_e);
      }
    }
    try {
      const ccBtn = pg.document?.querySelector?.('.ytp-subtitles-button');
      if (ccBtn && ccBtn.getAttribute('aria-pressed') !== 'true') {
        /** @type {HTMLElement} */ (ccBtn).click();
      }
    } catch (_e) {
      logS(_e);
    }
  }

  /**
   * @param {string} videoId
   * @param {number} [timeoutMs=2200]
   * @returns {Promise<void>}
   */
  async function waitForPotParam(videoId, timeoutMs = 2200) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (_potParamsByVideoId.has(videoId)) break;
      await waitMs(120);
    }
  }

  /**
   * @param {Element & Record<string, unknown>} playerEl
   * @param {unknown} priorTrack
   * @param {Window & typeof globalThis} pg
   * @returns {void}
   */
  function restorePlayerCaptionState(playerEl, priorTrack, pg) {
    try {
      if (priorTrack && typeof playerEl.setOption === 'function') {
        playerEl.setOption('captions', 'track', priorTrack);
      } else if (typeof playerEl.toggleSubtitles === 'function') {
        const ccBtn = pg.document?.querySelector?.('.ytp-subtitles-button');
        if (ccBtn && ccBtn.getAttribute('aria-pressed') === 'true') {
          /** @type {HTMLElement} */ (ccBtn).click();
        }
      }
    } catch (_e) {
      logS(_e);
    }
  }

  /**
   * Try to elicit a PoT for the currently playing video by briefly toggling
   * the player's caption track. Resolves once a pot has been captured or
   * after a short timeout. Idempotent and never throws.
   * @returns {Promise<boolean>}
   */
  async function _tryElicitPotForCurrentVideo() {
    if (_potElicitInflight) return false;
    _potElicitInflight = true;
    _installPotHooksOnce();
    try {
      const pg = _pageGlobal();
      const params = new URLSearchParams(pg.location?.search || '');
      const videoId = params.get('v') || '';
      if (!videoId) return false;
      if (_potParamsByVideoId.has(videoId)) return true;

      const playerEl = /** @type {Element & Record<string, unknown> | null} */ (
        pg.document?.querySelector?.('.html5-video-player')
      );
      if (!playerEl) return false;

      const priorTrack = readPlayerCaptionTrack(playerEl);

      triggerCaptionFetch(playerEl, pg);
      await waitForPotParam(videoId, 2200);
      restorePlayerCaptionState(playerEl, priorTrack, pg);

      return _potParamsByVideoId.has(videoId);
    } catch (_e) {
      logS(_e);
      return false;
    } finally {
      _potElicitInflight = false;
    }
  }

  function _getVideoIdFromCandidate(/** @type {string} */ url) {
    return U.getVideoIdFromUrl(url) || '';
  }

  /**
   * Given a list of candidate timedtext URLs, prepend equivalent variants
   * with PoT+client params applied (when known for the candidate's video).
   * @param {string[]} candidates
   * @returns {string[]}
   */
  function augmentSubtitleCandidatesWithPot(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return candidates || [];
    /** @type {string[]} */
    const augmented = [];
    for (const candidate of candidates) {
      try {
        const videoId = _getVideoIdFromCandidate(candidate);
        const params = videoId ? _potParamsByVideoId.get(videoId) : null;
        if (!params) continue;
        const u = new URL(candidate, 'https://www.youtube.com');
        for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
        augmented.push(u.toString());
      } catch (_e) {
        logS(_e);
        // Skip malformed candidate
      }
    }
    // De-duplicate while preserving order (augmented first, then originals)
    const merged = augmented.concat(candidates);
    return Array.from(new Set(merged.filter(u => typeof u === 'string' && u.length > 0)));
  }

  // Shared DOM helpers from YouTubeUtils
  const $ = (/** @type {string} */ sel) => U.$(sel);

  // Check dependencies
  if (typeof YouTubeUtils === 'undefined') {
    window.YouTubePlusLogger?.error?.('Download', 'YouTubeUtils not found!');
    return;
  }

  /**
   * Create a custom glassmorphic subtitle dropdown control
   * @returns {YtpCustomSelect}
   */
  function createSubtitleSelect() {
    const subtitleSelect = /** @type {YtpCustomSelect} */ (
      createEl('div', {
        attrs: {
          role: 'listbox',
          'aria-expanded': 'false',
          'aria-label': 'Subtitle language',
          tabindex: '0',
          class: 'glass-dropdown dl-subtitle-select yp-download-subtitle-dropdown',
          id: 'yp-download-subtitle-dropdown',
        },
      })
    );

    const toggle = /** @type {HTMLButtonElement} */ (
      createEl('button', {
        attrs: {
          type: 'button',
          class: 'glass-dropdown__toggle dl-subtitle-display',
          'aria-haspopup': 'listbox',
          'aria-expanded': 'false',
        },
      })
    );

    const label = createEl('span', {
      attrs: { class: 'glass-dropdown__label dl-subtitle-label' },
      text: t('loading'),
    });

    const chevron = createEl('span', {
      attrs: { class: 'glass-dropdown__chev dl-subtitle-chevron' },
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '6 9 12 15 18 9');
    svg.appendChild(polyline);
    chevron.appendChild(svg);

    toggle.appendChild(label);
    toggle.appendChild(chevron);

    const list = /** @type {HTMLUListElement} */ (
      createEl('ul', {
        attrs: {
          class: 'glass-dropdown__list dl-subtitle-list',
          role: 'listbox',
          'aria-label': 'Subtitle language',
        },
      })
    );

    const hiddenSelect = /** @type {HTMLSelectElement} */ (
      createEl('select', {
        attrs: {
          class: 'yp-download-subtitle-hidden-select',
          style: 'display:none;',
          tabindex: '-1',
          'aria-hidden': 'true',
        },
      })
    );

    subtitleSelect.appendChild(toggle);
    subtitleSelect.appendChild(list);
    subtitleSelect.appendChild(hiddenSelect);

    subtitleSelect._options = [];
    subtitleSelect._value = '';
    subtitleSelect._disabled = false;

    window.YouTubePlusCleanupManager?.registerListener?.(
      toggle,
      'click',
      () => {
        if (!subtitleSelect._disabled) {
          _installPotHooksOnce();
        }
      },
      undefined,
      false
    );

    window.YouTubePlusCleanupManager?.registerListener?.(
      list,
      'mouseover',
      (/** @type {Event} */ e) => {
        const item = e.target && /** @type {HTMLElement} */ (e.target).closest?.('[data-value]');
        if (item && list.contains(item)) {
          /** @type {HTMLElement} */ (item).style.background = 'var(--yt-surface-overlay-faint)';
        }
      },
      undefined,
      false
    );

    window.YouTubePlusCleanupManager?.registerListener?.(
      list,
      'mouseout',
      (/** @type {MouseEvent} */ e) => {
        const item = e.target && /** @type {HTMLElement} */ (e.target).closest?.('[data-value]');
        if (!(item && list.contains(item))) return;
        const related = e.relatedTarget;
        if (related && item.contains(/** @type {Node} */ (related))) return;
        /** @type {HTMLElement} */ (item).style.background = 'transparent';
      },
      undefined,
      false
    );

    if (window.YouTubePlusDesignSystem?.initGlassDropdown) {
      window.YouTubePlusDesignSystem.initGlassDropdown({
        dropdown: subtitleSelect,
        hiddenSelect,
        onOpen: () => _installPotHooksOnce(),
      });
    } else {
      window.YouTubePlusCleanupManager?.registerListener?.(
        toggle,
        'click',
        (/** @type {Event} */ e) => {
          e.stopPropagation();
          if (subtitleSelect._disabled) return;
          _installPotHooksOnce();
          const open = list.classList.toggle('is-open');
          list.style.display = open ? 'block' : 'none';
          subtitleSelect.setAttribute('aria-expanded', String(open));
          toggle.setAttribute('aria-expanded', String(open));
        },
        undefined,
        false
      );
    }

    subtitleSelect.setPlaceholder = (/** @type {string} */ text) => {
      label.textContent = text || '';
      subtitleSelect._options = [];
      list.replaceChildren();
      hiddenSelect.replaceChildren();
      subtitleSelect._value = '';
      hiddenSelect.value = '';
    };

    subtitleSelect.setOptions = (
      /** @type {Array<{ text: string, value: string | number }>} */ options
    ) => {
      subtitleSelect._options = options || [];
      list.replaceChildren();
      hiddenSelect.replaceChildren();
      subtitleSelect._options.forEach(
        (/** @type {{ text: string, value: string | number }} */ opt, idx) => {
          const optVal = String(opt.value);
          const hOpt = /** @type {HTMLOptionElement} */ (
            createEl('option', {
              attrs: { value: optVal },
              text: opt.text,
            })
          );
          hiddenSelect.appendChild(hOpt);

          const item = createEl('li', {
            text: opt.text,
            attrs: {
              'data-value': optVal,
              role: 'option',
              class: 'glass-dropdown__item dl-subtitle-option',
            },
          });
          if (idx === 0) item.setAttribute('aria-selected', 'true');
          list.appendChild(item);
        }
      );
      if (subtitleSelect._options.length > 0) {
        subtitleSelect.value = String(subtitleSelect._options[0].value);
      } else {
        subtitleSelect._value = '';
        label.textContent = t('noSubtitles');
      }
    };

    Object.defineProperty(subtitleSelect, 'value', {
      get() {
        return subtitleSelect._value;
      },
      set(v) {
        subtitleSelect._value = String(v);
        hiddenSelect.value = subtitleSelect._value;
        const found = subtitleSelect._options.find(
          (/** @type {{ text: string, value: string | number }} */ o) =>
            String(o.value) === subtitleSelect._value
        );
        label.textContent = found ? found.text : '';
        const items = list.querySelectorAll('.glass-dropdown__item');
        items.forEach(it => {
          if (it.getAttribute('data-value') === subtitleSelect._value) {
            it.setAttribute('aria-selected', 'true');
          } else {
            it.removeAttribute('aria-selected');
          }
        });
      },
    });

    Object.defineProperty(subtitleSelect, 'disabled', {
      get() {
        return subtitleSelect._disabled;
      },
      set(v) {
        subtitleSelect._disabled = Boolean(v);
        toggle.disabled = subtitleSelect._disabled;
        subtitleSelect.classList.toggle('disabled', subtitleSelect._disabled);
        if (v) {
          list.classList.remove('is-open');
          list.style.display = 'none';
          subtitleSelect.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-expanded', 'false');
        }
      },
    });

    subtitleSelect.destroy = () => {};

    return subtitleSelect;
  }

  // Use a stable, defensively-resolved reference to the notification
  // manager. In production this is always YouTubeUtils.NotificationManager,
  // but the build optimiser may rename a destructured `NotificationManager`
  // local inconsistently across function scopes (e.g. `yt` in one place
  // and a missing binding in another). Keeping it as a property lookup on
  // `YouTubeUtils` guarantees every call site resolves the same object.
  const getNotificationManager = () => YouTubeUtils?.NotificationManager;

  // Translation helper: delegate to YouTubeUtils.t, which resolves via
  // YouTubePlusI18n.t() with caching and interpolation.
  const t =
    U?.t ||
    ((/** @type {string} */ key, /** @type {Record<string, unknown>} */ _p = {}) => {
      const str = String(key || '');
      if (!_p || Object.keys(_p).length === 0) return str;
      let result = str;
      for (const [k, v] of Object.entries(_p)) result = result.split(`{${k}}`).join(String(v));
      return result;
    });

  /**
   * @param {string} key
   * @param {string} fallback
   * @returns {string}
   */
  function translatedOr(key, fallback) {
    const value = t(key);
    return value && value !== key ? value : fallback;
  }

  /**
   * Download configuration
   *
   * Origin header spoofing (line below): the cnv.cx conversion API enforces
   * a CORS/Origin allowlist that only permits requests from mp3yt.is. We
   * impersonate that Origin via GM_xmlhttpRequest (which bypasses browser
   * CORS) so conversion works for our users. This depends on a third-party
   * service's API policy and may break if cnv.cx tightens validation (for
   * example by requiring a Referer header, a signed token, or an API key).
   * If the conversion endpoint starts returning 403/429, this is the first
   * place to investigate. There is no browser-level security risk because
   * GM_xmlhttpRequest operates outside the Same-Origin Policy.
   */
  const DownloadConfig = {
    // Bound every API/player/subtitle request; media downloads are exempt.
    REQUEST_TIMEOUT_MS: 15000,
    // cnv.cx conversion backend endpoints
    API: {
      BASE_URL: 'https://cnv.cx',
      KEY_URL: 'https://cnv.cx/v2/sanity/key',
      CONVERT_URL: 'https://cnv.cx/v2/converter',
    },

    /**
     * Converter origin/Referer configs. cnv.cx allowlists a handful of
     * third-party origins; if one server is down or rate-limits us, we try
     * the next. The first entry is the preferred/primary one.
     */
    CONVERTERS: [
      {
        name: 'mp3yt',
        origin: 'https://mp3yt.is',
        referer: 'https://mp3yt.is/',
      },
      {
        name: 'y2meta-uk',
        origin: 'https://iframe.y2meta-uk.com',
        referer: 'https://iframe.y2meta-uk.com/',
      },
    ],

    // Default converter index (0 = primary)
    DEFAULT_CONVERTER_INDEX: 0,

    // Total conversion attempts across all converters. The cnv.cx backend is
    // intermittently overloaded and answers with `400` + "Please try again in
    // a moment as we are unable to convert rigt now." Retrying round-robin
    // through CONVERTERS makes downloads succeed in practice.
    MAX_CONVERT_ATTEMPTS: 4,

    // Delay (ms) before each attempt after the first (index = attempt).
    CONVERT_RETRY_BACKOFF_MS: [0, 1500, 3000, 6000],

    // HTTP headers for API requests
    HEADERS: {
      'Content-Type': 'application/json',
      Origin: 'https://mp3yt.is',
      Accept: '*/*',
      'User-Agent': typeof navigator !== 'undefined' ? navigator.userAgent : '',
    },

    // Available video qualities (144p to 4K)
    VIDEO_QUALITIES: ['144', '240', '360', '480', '720', '1080', '1440', '2160'],

    // Available audio bitrates (kbps)
    AUDIO_BITRATES: ['64', '128', '192', '256', '320'],

    // Default download options
    DEFAULTS: {
      format: 'video', // 'video' or 'audio'
      videoQuality: '1080',
      audioBitrate: '320',
      embedThumbnail: true,
    },

    // Download sources selectable in the modal. 'cnvcx' is the primary
    // converter backend; 'cobalt' and 'mobile' are independent fallbacks
    // used when the converter is down.
    SOURCES: {
      CNVCX: 'cnvcx',
      COBALT: 'cobalt',
      MOBILE: 'mobile',
    },

    // Video qualities offered for the fallback sources. The converter
    // backend still loads the actual qualities available for the video;
    // these are the fixed sets for Cobalt / direct mobile streams.
    SOURCE_VIDEO_QUALITIES: ['360', '480', '720', '1080'],

    // Audio bitrate options (kbps) per non-converter source.
    SOURCE_AUDIO_BITRATES: {
      cobalt: ['128'],
      mobile: ['128', '256'],
    },

    COBALT: {
      // Community instances that serve the v10 `/` endpoint without a
      // Turnstile CAPTCHA (no JWT needed). Tried in order; a failing
      // instance is skipped and the next one is used.
      INSTANCES: [
        { name: 'rue-cobalt', api: 'https://rue-cobalt.xenon.zone' },
        { name: 'cobaltapi', api: 'https://cobaltapi.cjs.nz' },
        { name: 'liubquanti', api: 'https://api.cobalt.liubquanti.click' },
      ],
      // Auto-discovery source for currently working community instances.
      DIRECTORY_URL: 'https://cobalt.directory/api/working?type=api',
      DIRECTORY_CACHE_MS: 60 * 60 * 1000,
      DIRECTORY_TIMEOUT_MS: 8000,
      MAX_ATTEMPTS: 6,
    },

    MOBILE: {
      PLAYER_URL: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      CLIENT_NAME: 'ANDROID',
      CLIENT_VERSION: '20.02.35',
      ANDROID_SDK_VERSION: 30,
    },
  };

  /**
   * Get current YouTube video ID
   * @returns {string|null} Video ID or null
   */
  function getVideoId() {
    return U.getVideoIdFromLocation();
  }

  /**
   * Get current video URL
   * @returns {string} Full video URL
   */
  function getVideoUrl() {
    const videoId = getVideoId();
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : window.location.href;
  }

  /**
   * Redact sensitive URL params and IDs before writing debug logs.
   * @param {string} rawUrl
   * @returns {string}
   */
  function sanitizeUrlForLog(rawUrl) {
    try {
      if (!rawUrl || typeof rawUrl !== 'string') return '';
      const u = new URL(rawUrl, window.location.origin || 'https://www.youtube.com');
      const sensitiveParams = [
        'v',
        'videoId',
        'pot',
        'potc',
        'key',
        'token',
        'sig',
        'signature',
        'oauth',
        'authorization',
        'cookie',
      ];
      for (const name of sensitiveParams) {
        if (u.searchParams.has(name)) {
          u.searchParams.set(name, '<redacted>');
        }
      }
      return `${u.origin}${u.pathname}`;
    } catch (_e) {
      logS(_e);
      return '<redacted-url>';
    }
  }

  /**
   * Get video title from page
   * @returns {string} Video title or 'video'
   */
  function getVideoTitle() {
    const titleElement =
      $('h1.ytd-video-primary-info-renderer yt-formatted-string') ||
      $('h1.title yt-formatted-string') ||
      $('ytd-watch-metadata h1');
    return titleElement?.textContent?.trim() || 'video';
  }

  /**
   * Sanitize filename for safe file system operations
   * @param {string} filename - Original filename
   * @returns {string} Sanitized filename
   */
  function sanitizeFilename(filename) {
    return filename
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202f\ufeff]/g, '') // S8: strip Unicode control chars
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200); // Limit length
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - Byte count
   * @returns {string} Formatted string (e.g., "8.5 MB")
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Create GM_xmlhttpRequest wrapper with callbacks
   * @param {GMDownloadRequestOptions} options - Request options
   * @param {(value: GMResponseLike) => void} resolve - Promise resolve function
   * @param {(reason?: unknown) => void} reject - Promise reject function
   * @returns {GMDownloadRequestOptions} GM_xmlhttpRequest options
   */
  function createGmRequestOptions(options, resolve, reject) {
    return {
      ...options,
      onload: (/** @type {GMResponseLike} */ response) => {
        if (options.onload) options.onload(response);
        resolve(response);
      },
      onerror: (/** @type {unknown} */ error) => {
        if (options.onerror) options.onerror(error);
        reject(error);
      },
      onabort: () => {
        reject(new DOMException('Request aborted', 'AbortError'));
      },
      ontimeout: () => {
        if (options.ontimeout) options.ontimeout();
        // Same error contract as the fetch fallback (TimeoutError),
        // so consumers can distinguish deadline from cancel across both
        // transports.
        reject(new DOMException('Request timeout', 'TimeoutError'));
      },
    };
  }

  /**
   * Build response-like object from fetch response
   * @param {Response} resp - Fetch response
   * @returns {GMResponseLike} Response-like object
   */
  function buildResponseObject(resp) {
    return {
      status: resp.status,
      statusText: resp.statusText,
      finalUrl: resp.url,
      headers: {},
      responseText: null,
      response: null,
    };
  }

  /**
   * Minimal engine contract for the request deadline:
   *   - when the engine provides `AbortSignal.timeout`, the native timeout
   *     signal composes the deadline;
   *   - otherwise (supported engines with a reduced AbortSignal, e.g. some
   *     manager realms) the deadline is composed by a request-owned
   *     AbortController + timer whose reason is a TimeoutError DOMException;
   *     the timer is cleared in `cleanup` once the request settles, so no
   *     background timer survives a finished request;
   *   - the deadline is enforced through the same transport signal as the
   *     caller abort, so it covers the response headers and the body read;
   *   - the underlying request is actually aborted (no Promise.race with a
   *     request that would keep running in the background).
   *
   * Compose the caller abort signal and the configured deadline into one
   * transport signal. Returns `{ signal, cleanup }`; `cleanup` removes
   * temporary composition listeners and must be called once the request
   * settles.
   * @param {{ signal?: AbortSignal, timeout?: number, [key: string]: unknown }} options
   * @returns {{ signal: AbortSignal | undefined, cleanup: () => void }}
   */
  function composeCancelSignals(options) {
    /** @type {AbortSignal[]} */
    const cancelSources = [];
    /** @type {(() => void)[]} */
    const cleanups = [];
    if (options.signal) cancelSources.push(options.signal);
    const timeoutOpt = /** @type {number} */ (options.timeout);
    const hasDeadline = typeof timeoutOpt === 'number' && timeoutOpt > 0;
    const nativeTimeoutAvailable =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function';
    if (hasDeadline && nativeTimeoutAvailable) {
      cancelSources.push(AbortSignal.timeout(timeoutOpt));
    } else if (hasDeadline) {
      // Fallback for supported engines whose AbortSignal lacks .timeout():
      // a request-owned controller + timer with full cleanup.
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort(new DOMException('Request timeout', 'TimeoutError'));
      }, timeoutOpt);
      cleanups.push(() => clearTimeout(timer));
      cancelSources.push(controller.signal);
    }
    const runCleanups = () => {
      for (const fn of cleanups) fn();
    };
    if (cancelSources.length === 0) {
      return { signal: undefined, cleanup: () => {} };
    }
    if (cancelSources.length === 1) {
      return { signal: cancelSources[0], cleanup: runCleanups };
    }
    if (typeof AbortSignal.any === 'function') {
      return { signal: AbortSignal.any(cancelSources), cleanup: runCleanups };
    }
    // Manual composition fallback for engines without AbortSignal.any:
    // relay either source into one controller, carrying the original
    // reason so the AbortError/TimeoutError contract survives.
    const composed = new AbortController();
    /**
     * @param {Event} ev
     */
    const relay = ev =>
      composed.abort(/** @type {{ reason?: unknown } | undefined} */ (ev?.target)?.reason);
    // An already-aborted source must short-circuit: AbortSignal.any
    // would produce an aborted signal, the relay alone would not.
    const alreadyAborted = cancelSources.find(source => source.aborted);
    if (alreadyAborted) {
      composed.abort(alreadyAborted.reason);
    } else {
      for (const source of cancelSources) {
        // lint:custom:ignore - ephemeral in-memory AbortSignal relay cleaned up by returned cleanup()
        source.addEventListener('abort', relay, { once: true });
      }
    }
    return {
      signal: composed.signal,
      cleanup: () => {
        for (const source of cancelSources) source.removeEventListener('abort', relay);
        runCleanups();
      },
    };
  }

  /**
   * Execute fetch-based request as fallback
   * @param {GMDownloadRequestOptions} options - Request options
   * @returns {Promise<GMResponseLike>} Response object
   */
  async function executeFetchFallback(options) {
    /** @type {RequestInit} */
    const fetchOpts = {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: /** @type {BodyInit | undefined} */ (options.data) || options.body || undefined,
    };
    // Compose caller abort and deadline into one transport signal so either
    // condition cancels the real request, including the body read.
    const { signal: composedSignal, cleanup } = composeCancelSignals(options);
    if (composedSignal) fetchOpts.signal = composedSignal;

    try {
      const resp = await fetch(options.url, fetchOpts);
      const responseLike = buildResponseObject(resp);

      // Single body read (blob or text) that rejects on abort, timeout or
      // network failure. A failed read must not surface as a successful
      // null-body response, which would corrupt downloads; the caller's
      // onerror path runs instead of onload.
      if (options.responseType === 'blob') {
        responseLike.response = await resp.blob();
      } else {
        responseLike.responseText = await resp.text();
      }

      if (options.onload) options.onload(responseLike);
      return responseLike;
    } finally {
      // temporary composition listeners never outlive the request.
      cleanup();
    }
  }

  // API rate limiter with exponential backoff on rate-limit hits, so we do
  // not hammer YouTube or external APIs.
  const _downloadRateLimiter = (() => {
    const maxRequests = 15; // max requests per time window
    const timeWindowMs = 60000; // 1 minute window

    // Paths that should never be rate-limited (subtitle/caption data fetches).
    // These are direct content requests, not API calls to external services.
    const RATE_LIMIT_EXEMPT_PATHS = ['/api/timedtext', '/api/timedtext_ui'];
    const RATE_LIMIT_EXEMPT_HOSTS = ['cnv.cx'];

    /** @type {Map<string, number[]>} */
    const requests = new Map();
    /** @type {Map<string, number>} S7: per-host backoff until timestamp */
    const backoffUntil = new Map();

    return {
      /**
       * Check whether a request to the given host is allowed.
       * Implements exponential backoff when rate limit is exceeded (S7).
       * @param {string} url - Full request URL
       * @returns {boolean} true if the request may proceed
       */
      canRequest(url) {
        let host = 'unknown';
        let pathname = '';
        try {
          const parsed = new URL(url);
          host = parsed.hostname;
          pathname = parsed.pathname;
        } catch (_e) {
          logS(_e);
          /* keep 'unknown' */
        }

        // Exempt timedtext and other direct-content paths from rate limiting
        if (RATE_LIMIT_EXEMPT_PATHS.some(p => pathname.startsWith(p))) {
          return true;
        }
        // Exempt conversion backend from per-host rate limiting: it has its own
        // fallback converter strategy and blocking one request would kill retries.
        if (RATE_LIMIT_EXEMPT_HOSTS.includes(host)) {
          return true;
        }

        const now = Date.now();

        // S7: Check backoff
        const backoff = backoffUntil.get(host) || 0;
        if (now < backoff) {
          logger.warn(
            `Rate limit backoff: ${host} blocked for ${Math.ceil((backoff - now) / 1000)}s more`
          );
          return false;
        }

        const recent = (requests.get(host) || []).filter(t => now - t < timeWindowMs);
        if (recent.length >= maxRequests) {
          // S7: Apply exponential backoff (2s, 4s, 8s, 16s, max 60s)
          const consecutiveHits = Math.min(5, Math.floor(recent.length / maxRequests));
          const backoffMs = Math.min(60000, 2000 * 2 ** consecutiveHits);
          backoffUntil.set(host, now + backoffMs);
          logger.warn(
            `Rate limit: ${recent.length}/${maxRequests} requests to ${host}, backing off ${backoffMs}ms`
          );
          return false;
        }
        recent.push(now);
        requests.set(host, recent);
        return true;
      },
    };
  })();

  /**
   * Promise wrapper for GM_xmlhttpRequest
   * @param {GMDownloadRequestOptions} options - Request options
   * @returns {Promise<GMResponseLike>} Response object
   */
  function gmXmlHttpRequest(options) {
    return new Promise((resolve, reject) => {
      // S6: enforce rate limiting per host before making the request
      if (options.url && !_downloadRateLimiter.canRequest(options.url)) {
        reject(new Error('[YouTube+ Download] Rate limit exceeded — request blocked'));
        return;
      }

      // once the raw request handle exists, wire signal -> abort so an
      // aborted transport actually cancels the in-flight GM request.
      const onRequest = typeof options.onRequest === 'function' ? options.onRequest : null;
      const wireSignal = (/** @type {GMRequestHandle | null | undefined} */ request) => {
        if (onRequest && request) onRequest(request);
        const signal = options.signal;
        if (signal && request && typeof request.abort === 'function') {
          if (signal.aborted) {
            try {
              request.abort();
            } catch (_e) {
              logS(_e);
            }
            return;
          }
          // lint:custom:ignore
          signal.addEventListener(
            'abort',
            () => {
              try {
                request.abort();
              } catch (_e) {
                logS(_e);
              }
            },
            { once: true }
          );
        }
      };

      // Prefer GM_xmlhttpRequest (userscript/extension context) because it can bypass CORS.
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        wireSignal(GM_xmlhttpRequest(createGmRequestOptions(options, resolve, reject)));
        return;
      }

      // Violentmonkey/Tampermonkey modern API fallback
      const gmApi =
        /** @type {{ GM?: { xmlHttpRequest?: (details: unknown) => GMRequestHandle } }} */ (
          /** @type {unknown} */ (globalThis)
        ).GM;
      if (gmApi && typeof gmApi.xmlHttpRequest === 'function') {
        wireSignal(gmApi.xmlHttpRequest(createGmRequestOptions(options, resolve, reject)));
        return;
      }

      // Fallback for page context: try using fetch(). Note: fetch() is subject to CORS and
      // may fail where GM_xmlhttpRequest would succeed. This fallback attempts to mimic
      // a similar response shape used by the rest of the code.
      (async () => {
        try {
          const responseLike = await executeFetchFallback(options);
          resolve(responseLike);
        } catch (err) {
          logS(err);
          if (options.onerror) options.onerror(err);
          reject(err);
        }
      })();
    });
  }

  /**
   * Create square album art from YouTube thumbnail
   * @param {string} thumbnailUrl - Thumbnail URL
   * @returns {Promise<Blob>} Album art blob
   */
  function createSquareAlbumArt(thumbnailUrl) {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height);
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          canvas.width = 0;
          canvas.height = 0;
          reject(new Error('Failed to get canvas context'));
          return;
        }

        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);

        canvas.toBlob(
          blob => {
            // Release canvas memory after blob is created
            canvas.width = 0;
            canvas.height = 0;
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
          },
          'image/jpeg',
          0.95
        );
      };

      img.onerror = () => reject(new Error('Failed to load thumbnail'));
      img.src = thumbnailUrl;
    });
  }

  /**
   * Embed album art and metadata into MP3 file
   * Requires ID3Writer library (browser-id3-writer)
   *
   * @param {Blob} mp3Blob - Original MP3 blob
   * @param {Blob} albumArtBlob - Album art image blob
   * @param {{ title?: string, artist?: string, album?: string }} metadata - Metadata (title, artist, album)
   * @returns {Promise<Blob>} MP3 blob with embedded metadata
   */
  async function embedAlbumArtToMP3(mp3Blob, albumArtBlob, metadata) {
    try {
      if (typeof window.ID3Writer === 'undefined') {
        logger.warn('ID3Writer not available, skipping album art embedding');
        return mp3Blob;
      }

      const arrayBuffer = await mp3Blob.arrayBuffer();
      const writer = new window.ID3Writer(arrayBuffer);

      // Set metadata
      if (metadata.title) {
        writer.setFrame('TIT2', metadata.title);
      }
      if (metadata.artist) {
        writer.setFrame('TPE1', [metadata.artist]);
      }
      if (metadata.album) {
        writer.setFrame('TALB', metadata.album);
      }

      // Embed album art
      if (albumArtBlob) {
        const coverArrayBuffer = await albumArtBlob.arrayBuffer();
        writer.setFrame('APIC', {
          type: 3, // Cover (front)
          data: coverArrayBuffer,
          description: 'Cover',
        });
      }

      writer.addTag();
      /* global Blob */
      return new Blob([writer.arrayBuffer], { type: 'audio/mpeg' });
    } catch (error) {
      logS(error);
      logger.error('Error embedding album art:', error);
      return mp3Blob;
    }
  }

  /**
   * Get available subtitles for a video
   * @param {string} videoId - YouTube video ID
   * @returns {Promise<SubtitleData | null>} Subtitle data
   */

  /**
   * Log, notify, and re-throw a download error with a consistent shape.
   * @param {unknown} error
   * @param {{ logMessage: string, failedKey: string }} opts
   * @returns {never}
   */
  function reportDownloadError(error, { logMessage, failedKey }) {
    logger.error(logMessage, error);
    const msg = error instanceof Error ? error.message : String(error);
    getNotificationManager()?.show?.(`${t(failedKey)} ${msg}`, {
      duration: NOTIFY_DURATION.LONG,
      type: 'error',
    });
    throw error;
  }

  // ---------------------------------------------------------------------------
  // TTL-based in-memory cache for player data (subtitles + formats)
  // Prevents redundant API calls when user opens the download dialog multiple times.
  // ---------------------------------------------------------------------------
  const _playerDataCache = (() => {
    const TTL_MS = 5 * 60 * 1000; // 5 minutes
    /** @type {Map<string, { data: PlayerResponse, ts: number }>} */
    const store = new Map();
    return {
      get(/** @type {string} */ videoId) {
        const entry = store.get(videoId);
        if (!entry) return null;
        if (Date.now() - entry.ts > TTL_MS) {
          store.delete(videoId);
          return null;
        }
        return entry.data;
      },
      set(/** @type {string} */ videoId, /** @type {PlayerResponse} */ data) {
        // Evict oldest entry when cache exceeds 10 videos to bound memory
        if (store.size >= 10) {
          const oldestKey = store.keys().next().value;
          if (typeof oldestKey === 'string') store.delete(oldestKey);
        }
        store.set(videoId, { data, ts: Date.now() });
      },
    };
  })();

  /**
   * Fetch player data from YouTube API
   * @param {string} videoId - Video ID
   * @returns {Promise<PlayerResponse>} Player data response
   * @private
   */
  async function fetchPlayerData(videoId) {
    // serve from cache when available
    const cached = _playerDataCache.get(videoId);
    if (cached) return cached;

    const response = await gmXmlHttpRequest({
      method: 'POST',
      url: 'https://www.youtube.com/youtubei/v1/player',
      timeout: DownloadConfig.REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': DownloadConfig.HEADERS['User-Agent'],
      },
      data: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240304.00.00',
          },
        },
        videoId,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`Failed to get player data: ${response.status}`);
    }

    const parsed = /** @type {PlayerResponse} */ (JSON.parse(String(response.responseText)));
    _playerDataCache.set(videoId, parsed); // store in cache
    return parsed;
  }

  /**
   * Extract available video qualities from player streaming data.
   * Uses only actual video-capable formats exposed by YouTube for the current video.
   * @param {PlayerResponse | null | undefined} playerData
   * @returns {string[]}
   */
  function extractAvailableVideoQualities(playerData) {
    const streamingData = playerData?.streamingData || {};
    /** @type {Array<{ mimeType?: string, qualityLabel?: string }>} */
    const combined = [
      ...(Array.isArray(streamingData.formats) ? streamingData.formats : []),
      ...(Array.isArray(streamingData.adaptiveFormats) ? streamingData.adaptiveFormats : []),
    ];

    const qualitySet = new Set();
    combined.forEach(format => {
      const mimeType = String(format?.mimeType || '');
      if (!mimeType.includes('video/')) return;

      const qualityLabel = String(format?.qualityLabel || '').trim();
      const match = qualityLabel.match(/(\d{3,4})p/i);
      if (!match) return;

      qualitySet.add(match[1]);
    });

    return Array.from(qualitySet).sort((left, right) => Number(left) - Number(right));
  }

  /**
   * Get the actual available video qualities for the current video.
   * Falls back to watch HTML and then to configured defaults if player data is unavailable.
   * @param {string} videoId
   * @returns {Promise<string[]>}
   */
  async function getAvailableVideoQualities(videoId) {
    if (!videoId) return DownloadConfig.VIDEO_QUALITIES.slice();

    try {
      const playerData = await fetchPlayerData(videoId);
      const actualQualities = extractAvailableVideoQualities(playerData);
      if (actualQualities.length > 0) return actualQualities;
    } catch (error) {
      logS(error);
      logger.warn('Primary player quality fetch failed:', error);
    }

    try {
      const fallbackPlayerData = await fetchPlayerResponseFromWatchHtml(videoId);
      const fallbackQualities = extractAvailableVideoQualities(fallbackPlayerData);
      if (fallbackQualities.length > 0) return fallbackQualities;
    } catch (error) {
      logS(error);
      logger.warn('Watch HTML quality fallback failed:', error);
    }

    return DownloadConfig.VIDEO_QUALITIES.slice();
  }

  /**
   * Choose the initial quality selection from available options.
   * @param {string[]} qualities
   * @param {string} preferredQuality
   * @returns {string}
   */
  function pickDefaultVideoQuality(qualities, preferredQuality) {
    if (!Array.isArray(qualities) || qualities.length === 0) {
      return preferredQuality || DownloadConfig.DEFAULTS.videoQuality;
    }

    if (qualities.includes(preferredQuality)) return preferredQuality;
    if (qualities.includes(DownloadConfig.DEFAULTS.videoQuality)) {
      return DownloadConfig.DEFAULTS.videoQuality;
    }

    const sorted = qualities.slice().sort((left, right) => Number(left) - Number(right));
    return sorted[sorted.length - 1] || preferredQuality || DownloadConfig.DEFAULTS.videoQuality;
  }

  /**
   * @param {string} ch
   * @param {{ depth: number, inStr: boolean, escape: boolean }} state
   * @returns {boolean}
   */
  function stepJsonScanChar(ch, state) {
    if (state.escape) {
      state.escape = false;
      return false;
    }
    if (state.inStr) {
      if (ch === '\\') state.escape = true;
      else if (ch === '"') state.inStr = false;
      return false;
    }
    if (ch === '"') {
      state.inStr = true;
      return false;
    }
    if (ch === '{') {
      state.depth++;
      return false;
    }
    if (ch === '}') {
      state.depth--;
      return state.depth === 0;
    }
    return false;
  }

  /**
   * Extract a balanced JSON object starting at the `{` at `startIdx` from `src`.
   * Respects strings and escape sequences so embedded `{}` inside string literals
   * do not throw off the brace counter. Returns null if no balanced object found.
   * @param {string} src
   * @param {number} startIdx
   * @returns {string|null}
   * @private
   */
  function extractBalancedJsonObject(src, startIdx) {
    if (!src || startIdx < 0 || startIdx >= src.length || src[startIdx] !== '{') return null;
    const state = { depth: 0, inStr: false, escape: false };
    for (let i = startIdx; i < src.length; i++) {
      if (stepJsonScanChar(src[i], state)) {
        return src.slice(startIdx, i + 1);
      }
    }
    return null;
  }

  async function fetchPlayerResponseFromWatchHtml(/** @type {string} */ videoId) {
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      const response = await gmXmlHttpRequest({
        method: 'GET',
        url: watchUrl,
        timeout: DownloadConfig.REQUEST_TIMEOUT_MS,
      });
      if (response.status !== 200 || !response.responseText) return null;

      const html = String(response.responseText);
      // Locate ytInitialPlayerResponse assignment. Some adblock/userscripts
      // (e.g. jsonPrune) inject extra content after the value, so a lazy regex
      // ending at `;</script>` can capture mangled JSON. Use a balanced-brace
      // scanner that respects string literals to extract the exact object.
      const assignRe = /ytInitialPlayerResponse\s*=\s*\{/g;
      let match;
      while ((match = assignRe.exec(html)) !== null) {
        const braceIdx = match.index + match[0].length - 1;
        const jsonText = extractBalancedJsonObject(html, braceIdx);
        if (!jsonText) continue;
        try {
          return JSON.parse(jsonText);
        } catch (_e) {
          logS(_e);
          // Try the next occurrence (rare: multiple assignments)
        }
      }
      return null;
    } catch (error) {
      logS(error);
      logger.warn('Watch HTML subtitle fallback failed:', error);
      return null;
    }
  }

  /**
   * Try to obtain captions renderer from page runtime state.
   * Helps in browsers where youtubei player request is blocked/limited.
   * @returns {{captions: PlayerCaptionsTracklistRenderer, videoTitle: string}|null}
   * @private
   */
  function getCaptionsFromPageFallback() {
    try {
      const title = getVideoTitle();
      const globalContext = _pageGlobal();

      const initial = globalContext.ytInitialPlayerResponse;
      const initialCaps = initial?.captions?.playerCaptionsTracklistRenderer;
      if (initialCaps) {
        return {
          captions: initialCaps,
          videoTitle: initial?.videoDetails?.title || title,
        };
      }

      const playerEl = U.byId('movie_player');
      /** @type {(HTMLElement & { getPlayerResponse?: () => PlayerResponse | null }) | null} */
      const player = playerEl instanceof HTMLElement ? playerEl : null;
      const response =
        (typeof player?.getPlayerResponse === 'function' && player.getPlayerResponse()) || null;
      const respCaps = response?.captions?.playerCaptionsTracklistRenderer;
      if (respCaps) {
        return {
          captions: respCaps,
          videoTitle: response?.videoDetails?.title || title,
        };
      }

      const ytPlayerResponse =
        /** @type {{ ytplayer?: { config?: { args?: { player_response?: unknown } } } }} */ (
          globalContext
        )?.ytplayer?.config?.args?.player_response;
      if (typeof ytPlayerResponse === 'string' && ytPlayerResponse.length > 0) {
        const parsed = JSON.parse(ytPlayerResponse);
        const parsedCaps = parsed?.captions?.playerCaptionsTracklistRenderer;
        if (parsedCaps) {
          return {
            captions: parsedCaps,
            videoTitle: parsed?.videoDetails?.title || title,
          };
        }
      }
    } catch (error) {
      logS(error);
      logger.warn('Subtitle fallback extraction failed:', error);
    }
    return null;
  }

  /**
   * Build subtitle URL with format parameter
   * @param {string} baseUrl - Base subtitle URL
   * @returns {string} Complete subtitle URL
   * @private
   */
  function buildSubtitleUrl(baseUrl) {
    const normalized = normalizeSubtitleBaseUrl(baseUrl);
    if (!normalized) return '';
    if (!normalized.includes('fmt=')) {
      return `${normalized}&fmt=srv1`;
    }
    return normalized;
  }

  /**
   * Normalize subtitle base URL from player response.
   * @param {string} baseUrl - Raw subtitle URL
   * @returns {string} Normalized URL
   */
  function normalizeSubtitleBaseUrl(baseUrl) {
    const raw = String(baseUrl || '').trim();
    if (!raw) return '';
    return raw.replace(/&amp;/g, '&');
  }

  /**
   * Serialize an XML document to trimmed text via XMLSerializer.
   * @param {Document | XMLDocument | null} doc
   * @returns {string}
   */
  function serializeXmlToText(doc) {
    if (!(doc && window.XMLSerializer)) return '';
    try {
      return new window.XMLSerializer().serializeToString(doc).trim();
    } catch (_e) {
      logS(_e);
      return '';
    }
  }

  /**
   * Decode binary (ArrayBuffer or ArrayBufferView) response bodies to text.
   * @param {unknown} rawResponse
   * @returns {string}
   */
  function decodeBinaryToText(rawResponse) {
    try {
      if (rawResponse instanceof ArrayBuffer) {
        if (window.TextDecoder) {
          return new window.TextDecoder('utf-8').decode(rawResponse).trim();
        }
        return '';
      }
      if (rawResponse && ArrayBuffer.isView(rawResponse)) {
        const view = /** @type {ArrayBufferView} */ (rawResponse);
        const sliced = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
        if (window.TextDecoder) {
          return new window.TextDecoder('utf-8').decode(sliced).trim();
        }
      }
    } catch (_e) {
      logS(_e);
      // Non-critical
    }
    return '';
  }

  /**
   * Extract text from a text-like object (userscript API wrappers).
   * @param {Record<string, unknown> & { text?: unknown; data?: unknown; content?: unknown }} rawObject
   * @returns {Promise<string>}
   */
  async function extractTextLikeObject(rawObject) {
    const maybeText = rawObject.text || rawObject.data || rawObject.content;
    if (typeof maybeText === 'string' && maybeText.trim()) {
      return maybeText.trim();
    }
    if (typeof rawObject.text === 'function') {
      try {
        const extracted = await /** @type {() => Promise<unknown>} */ (rawObject.text)();
        if (typeof extracted === 'string' && extracted.trim()) {
          return extracted.trim();
        }
      } catch (_e) {
        logS(_e);
        // Non-critical
      }
    }
    return '';
  }

  /**
   * @param {GMResponseLike | Record<string, unknown> | null | undefined} response
   * @param {unknown} rawResponse
   * @returns {string}
   */
  function extractXmlSubtitleBody(response, rawResponse) {
    if (response?.responseXML) {
      const serialized = serializeXmlToText(/** @type {Document} */ (response.responseXML));
      if (serialized) return serialized;
    }
    if (rawResponse && typeof rawResponse === 'object') {
      const rawDocument = /** @type {Document | XMLDocument | null} */ (rawResponse);
      if (typeof rawDocument?.documentElement?.nodeName === 'string') {
        const serialized = serializeXmlToText(rawDocument);
        if (serialized) return serialized;
      }
    }
    return '';
  }

  /**
   * @param {unknown} rawResponse
   * @returns {Promise<string>}
   */
  async function extractBinarySubtitleBody(rawResponse) {
    if (rawResponse instanceof ArrayBuffer || (rawResponse && ArrayBuffer.isView(rawResponse))) {
      const decoded = decodeBinaryToText(rawResponse);
      if (decoded) return decoded;
    }
    if (typeof Blob !== 'undefined' && rawResponse instanceof Blob) {
      try {
        return (await rawResponse.text()).trim();
      } catch (_e) {
        logS(_e);
      }
    }
    return '';
  }

  /**
   * Extract textual body from GM/fetch response shapes.
   * Handles multiple response formats: responseText, responseXML, response (string/object/ArrayBuffer).
   * @param {GMResponseLike | Record<string, unknown> | null | undefined} response - Response object
   * @returns {Promise<string>}
   */
  async function extractSubtitleBody(response) {
    const text = String(response?.responseText || '').trim();
    if (text) return text;

    const rawResponse = response?.response;
    if (typeof rawResponse === 'string' && rawResponse.trim()) {
      return rawResponse.trim();
    }

    const xmlText = extractXmlSubtitleBody(response, rawResponse);
    if (xmlText) return xmlText;

    const binaryText = await extractBinarySubtitleBody(rawResponse);
    if (binaryText) return binaryText;

    if (rawResponse && typeof rawResponse === 'object') {
      const extracted = await extractTextLikeObject(
        /** @type {Record<string, unknown> & { text?: unknown; data?: unknown; content?: unknown }} */ (
          rawResponse
        )
      );
      if (extracted) return extracted;
    }

    return '';
  }

  /**
   * Build fallback request profiles for subtitle payload retrieval.
   * @returns {GMRequestProfile[]}
   */
  function getSubtitleRequestProfiles() {
    return [
      {
        method: 'GET',
        withCredentials: true,
        anonymous: false,
        responseType: 'text', // Forces GM_xmlhttpRequest to populate responseText
        headers: {
          Referer: 'https://www.youtube.com/',
          // Avoid gzipped empty-body bug in some GM_xmlhttpRequest implementations.
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
      {
        method: 'GET',
        withCredentials: true,
        anonymous: false,
        // No responseType, so Firefox returns responseXML for XML content
        headers: {
          Referer: 'https://www.youtube.com/',
          'Accept-Encoding': 'identity',
        },
      },
    ];
  }

  /**
   * Parse caption tracks into subtitle objects
   * @param {CaptionTrack[]} captionTracks - Caption track data
   * @returns {SubtitleTrack[]} Subtitle objects
   * @private
   */
  function parseCaptionTracks(captionTracks) {
    return captionTracks.map(track => ({
      name: track.name?.simpleText || track.languageCode,
      languageCode: track.languageCode,
      url: buildSubtitleUrl(track.baseUrl),
      baseUrl: normalizeSubtitleBaseUrl(track.baseUrl),
      isAutoGenerated: track.kind === 'asr',
      trackId: String(track?.vssId || ''),
      kind: String(track?.kind || ''),
    }));
  }

  /**
   * @param {CaptionTrack} track
   * @param {Record<string, unknown>} criteria
   * @returns {number}
   */
  function calculateTrackScore(track, criteria) {
    let score = 0;
    const trackBaseUrl = normalizeSubtitleBaseUrl(String(track?.baseUrl || ''));
    const trackLang = String(track?.languageCode || '');
    const trackId = String(track?.vssId || '');
    const trackIsAuto = track?.kind === 'asr';

    if (criteria.wantedTrackId && trackId === criteria.wantedTrackId) score += 120;
    if (criteria.wantedBaseUrl && trackBaseUrl === criteria.wantedBaseUrl) score += 100;
    if (criteria.wantedLang && trackLang === criteria.wantedLang) {
      score += 40;
    } else if (criteria.langPrefix && trackLang.startsWith(String(criteria.langPrefix))) {
      score += 20;
    }

    if (criteria.wantsAuto !== null) {
      score += trackIsAuto === criteria.wantsAuto ? 15 : -5;
    }

    if (track?.isTranslatable !== false) score += 5;
    if (trackBaseUrl) score += 2;
    return score;
  }

  /**
   * Pick the most suitable caption track for translation or refresh retries.
   * Prefer exact baseUrl/lang/kind matches, then translatable tracks.
   * @param {CaptionTrack[]} captionTracks
   * @param {{ languageCode?: string, isAutoGenerated?: boolean | null, baseUrl?: string, trackId?: string }} [criteria]
   * @returns {CaptionTrack | null}
   */
  function findBestCaptionTrack(captionTracks, criteria = {}) {
    const tracks = Array.isArray(captionTracks) ? captionTracks.filter(Boolean) : [];
    if (tracks.length === 0) return null;

    const wantedLang = String(criteria.languageCode || '').trim();
    const normalizedCriteria = {
      wantedLang,
      langPrefix: wantedLang ? wantedLang.split('-')[0] : '',
      wantedBaseUrl: normalizeSubtitleBaseUrl(criteria.baseUrl || ''),
      wantedTrackId: String(criteria.trackId || '').trim(),
      wantsAuto: typeof criteria.isAutoGenerated === 'boolean' ? criteria.isAutoGenerated : null,
    };

    return (
      tracks
        .map(track => ({ track, score: calculateTrackScore(track, normalizedCriteria) }))
        .sort((left, right) => right.score - left.score)[0]?.track || null
    );
  }

  /**
   * Choose the source caption track used for translated subtitle variants.
   * @param {CaptionTrack[]} captionTracks
   * @returns {CaptionTrack | null}
   */
  function getTranslationSourceTrack(captionTracks) {
    return (
      findBestCaptionTrack(captionTracks, { isAutoGenerated: true }) ||
      findBestCaptionTrack(captionTracks) ||
      null
    );
  }

  /**
   * Parse translation languages into subtitle objects
   * @param {CaptionTranslationLanguage[]} translationLanguages - Translation language data
   * @param {CaptionTrack | null} sourceTrack - Source caption track used for translations
   * @returns {SubtitleTrack[]} Auto-translation subtitle objects
   * @private
   */
  function parseTranslationLanguages(translationLanguages, sourceTrack) {
    const sourceBaseUrl = normalizeSubtitleBaseUrl(sourceTrack?.baseUrl || '');
    const sourceLanguageCode = String(sourceTrack?.languageCode || '');
    const sourceTrackId = String(sourceTrack?.vssId || '');
    return translationLanguages.map(lang => ({
      name: lang.languageName?.simpleText || lang.languageCode,
      languageCode: lang.languageCode,
      sourceLanguageCode: sourceLanguageCode || '',
      baseUrl: sourceBaseUrl,
      url: buildSubtitleUrl(sourceBaseUrl),
      isAutoGenerated: sourceTrack?.kind === 'asr',
      trackId: sourceTrackId,
      translateTo: lang.languageCode,
    }));
  }

  /**
   * Create empty subtitle result
   * @param {string} videoId - Video ID
   * @param {string} videoTitle - Video title
   * @returns {SubtitleData} Empty subtitle result
   * @private
   */
  function createEmptySubtitleResult(videoId, videoTitle) {
    return {
      videoId,
      videoTitle,
      subtitles: [],
      autoTransSubtitles: [],
    };
  }

  /**
   * Get subtitles for a video
   * @param {string} videoId - Video ID
   * @returns {Promise<SubtitleData | null>} Subtitle data or null on error
   */
  async function getSubtitles(videoId) {
    try {
      let data = null;
      try {
        data = await fetchPlayerData(videoId);
      } catch (error) {
        logS(error);
        logger.warn('Primary subtitle API request failed, trying page fallback:', error);
      }

      let fallback = getCaptionsFromPageFallback();
      if (!fallback) {
        const parsedFromHtml = await fetchPlayerResponseFromWatchHtml(videoId);
        if (parsedFromHtml?.captions?.playerCaptionsTracklistRenderer) {
          fallback = {
            captions: parsedFromHtml.captions.playerCaptionsTracklistRenderer,
            videoTitle: parsedFromHtml?.videoDetails?.title || getVideoTitle(),
          };
        }
      }

      const videoTitle = data?.videoDetails?.title || fallback?.videoTitle || 'video';
      const captions =
        data?.captions?.playerCaptionsTracklistRenderer || fallback?.captions || null;

      if (!captions) {
        return createEmptySubtitleResult(videoId, videoTitle);
      }

      const captionTracks = captions.captionTracks || [];
      const translationLanguages = captions.translationLanguages || [];
      const translationSourceTrack = getTranslationSourceTrack(captionTracks);

      return {
        videoId,
        videoTitle,
        subtitles: parseCaptionTracks(captionTracks),
        autoTransSubtitles: parseTranslationLanguages(translationLanguages, translationSourceTrack),
      };
    } catch (error) {
      logS(error);
      logger.error('Error getting subtitles:', error);
      return null;
    }
  }

  /**
   * @param {string} xmlText
   * @returns {Document | null}
   */
  function parseXmlDocument(xmlText) {
    if (typeof window.DOMParser !== 'function') return null;
    try {
      // XML must not go through the sanitizing policy: it would strip the
      // caption tags. Under `require-trusted-types-for 'script'` this plain
      // string sink throws; the catch below hands the input to the regex
      // parsers.
      const doc = new window.DOMParser().parseFromString(xmlText, 'text/xml');
      const rootName = doc.documentElement?.nodeName?.toLowerCase?.() || '';
      if (rootName === 'parsererror' || doc.getElementsByTagName('parsererror').length > 0) {
        return null;
      }
      return doc;
    } catch (e) {
      // The expected Trusted Types rejection is silent: logging it would reach
      // console.error and the error journal on every subtitle parse.
      if (!(e instanceof TypeError)) logS(e);
      return null;
    }
  }

  /**
   * @param {Document} doc
   * @returns {SubtitleCue[]}
   */
  function parseSubtitleXmlDomNodes(doc) {
    /** @type {SubtitleCue[]} */
    const cues = [];
    const nodes = Array.from(doc.getElementsByTagName('text'));
    nodes.forEach(node => {
      const start = parseFloat(node.getAttribute('start') || '0');
      const duration = parseFloat(node.getAttribute('dur') || '0');
      const text = decodeHTMLEntities(String(node.textContent || '').trim());
      if (!text) return;
      cues.push({ start, duration, text });
    });
    return cues;
  }

  /**
   * @param {string} normalizedXml
   * @returns {SubtitleCue[]}
   */
  function parseSubtitleXmlRegexTextTags(normalizedXml) {
    /** @type {SubtitleCue[]} */
    const cues = [];
    const textTagRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = textTagRegex.exec(normalizedXml)) !== null) {
      const attrs = match[1] || '';
      const startRaw = /\bstart\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '0';
      const durRaw = /\bdur\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '0';
      const start = parseFloat(startRaw || '0');
      const duration = parseFloat(durRaw || '0');
      let text = match[2] || '';

      text = text.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
      text = decodeHTMLEntities(text.replace(/<br\s*\/?>/gi, ' ').trim());
      text = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) continue;
      cues.push({ start, duration, text });
    }
    return cues;
  }

  /**
   * @param {string} normalizedXml
   * @returns {SubtitleCue[]}
   */
  function parseSubtitleXmlRegexPTags(normalizedXml) {
    /** @type {SubtitleCue[]} */
    const cues = [];
    const pTagRegex = /<p\b([^>]*)>([\s\S]{0,20000}?)<\/p>/gi;
    let match;
    while ((match = pTagRegex.exec(normalizedXml)) !== null) {
      const attrs = match[1] || '';
      const inner = match[2] || '';

      const tMsRaw = /\bt="([^"]+)"/i.exec(attrs)?.[1] || '0';
      const dMsRaw = /\bd="([^"]+)"/i.exec(attrs)?.[1] || '0';

      const start = Math.max(0, Number(tMsRaw) / 1000);
      const duration = Math.max(0, Number(dMsRaw) / 1000);

      const assembled = inner.includes('<s')
        ? inner
            .replace(/<s\b[^>]*>/gi, '')
            .replace(/<\/s>/gi, '')
            .replace(/<br\s*\/?>/gi, ' ')
        : inner;

      const text = decodeHTMLEntities(
        assembled
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );

      if (!text) continue;
      cues.push({
        start,
        duration: duration > 0 ? duration : 2,
        text,
      });
    }
    return cues;
  }

  /**
   * Parse subtitle XML to cues
   * @param {string} xml - XML subtitle content
   * @returns {SubtitleCue[]} Array of cues
   */
  function parseSubtitleXML(xml) {
    const normalizedXml = String(xml || '').replace(/\uFEFF/g, '');
    const doc = parseXmlDocument(normalizedXml);
    if (doc) {
      const cues = parseSubtitleXmlDomNodes(doc);
      if (cues.length > 0) return cues;
    }

    return [
      ...parseSubtitleXmlRegexTextTags(normalizedXml),
      ...parseSubtitleXmlRegexPTags(normalizedXml),
    ];
  }

  /**
   * Decode HTML entities.
   * O2: Uses single regex + lookup map instead of multiple split/join passes.
   * @param {string} text - Text with HTML entities
   * @returns {string} Decoded text
   */
  const _htmlEntityMap = /** @type {Record<string, string>} */ ({
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
    apos: "'",
    nbsp: ' ',
  });
  function decodeHTMLEntities(/** @type {string} */ text) {
    // Single pass: match &name; and &#decimal; and &#xhex; patterns
    return text.replace(
      /&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g,
      (/** @type {string} */ match, /** @type {string} */ entity) => {
        // Named entity
        if (_htmlEntityMap[entity]) return _htmlEntityMap[entity];
        // Numeric decimal: &#123;
        if (entity.startsWith('#') && !entity.startsWith('#x')) {
          const num = parseInt(entity.slice(1), 10);
          return num > 0 && num < 0x10ffff ? String.fromCharCode(num) : match;
        }
        // Numeric hex: &#xAB;
        if (entity.startsWith('#x')) {
          const num = parseInt(entity.slice(2), 16);
          return num > 0 && num < 0x10ffff ? String.fromCharCode(num) : match;
        }
        return match;
      }
    );
  }

  /**
   * Convert cues to SRT format
   * @param {SubtitleCue[]} cues - Array of cues
   * @returns {string} SRT formatted text
   */
  function convertToSRT(cues) {
    let srt = '';
    cues.forEach((cue, index) => {
      const startTime = formatSRTTime(cue.start);
      const endTime = formatSRTTime(cue.start + cue.duration);
      const text = cue.text.replace(/\n/g, ' ').trim();

      srt += `${index + 1}\n`;
      srt += `${startTime} --> ${endTime}\n`;
      srt += `${text}\n\n`;
    });

    return srt;
  }

  /**
   * Format time for SRT (HH:MM:SS,mmm)
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time
   */
  function formatSRTTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
  }

  /**
   * Convert cues to plain text
   * @param {SubtitleCue[]} cues - Array of cues
   * @returns {string} Plain text
   */
  function convertToTXT(cues) {
    return cues.map(cue => cue.text.trim()).join('\n');
  }

  /**
   * Parse subtitle JSON3 to cues
   * @param {string} jsonText - JSON3 subtitle content
   * @returns {SubtitleCue[]} Array of cues
   */
  function parseSubtitleJSON3(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      const events = Array.isArray(data?.events) ? data.events : [];
      /** @type {SubtitleCue[]} */
      const cues = [];

      events.forEach(
        (
          /** @type {{ tStartMs?: number, dDurationMs?: number, segs?: Array<{ utf8?: string }> }} */ event
        ) => {
          const segs = Array.isArray(event?.segs) ? event.segs : [];
          const text = segs
            .map(seg => String(seg?.utf8 || ''))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          if (!text) return;

          const start = Number(event?.tStartMs || 0) / 1000;
          const duration = Math.max(0, Number(event?.dDurationMs || 0) / 1000);
          cues.push({ start, duration, text });
        }
      );

      return cues;
    } catch (_e) {
      logS(_e);
      return [];
    }
  }

  /**
   * @param {string} part
   * @returns {boolean}
   */
  function isNumericTimePart(part) {
    if (!part) return false;
    let dotSeen = false;
    for (let i = 0; i < part.length; i += 1) {
      const ch = part[i];
      if (ch >= '0' && ch <= '9') continue;
      if (ch === '.' && !dotSeen) {
        dotSeen = true;
        continue;
      }
      return false;
    }
    return true;
  }

  /**
   * @param {string} v
   * @returns {number | null}
   */
  function parseSecondsSuffixTime(v) {
    const last = v[v.length - 1];
    if (last === 's' || last === 'S') {
      const n = Number(v.slice(0, -1));
      return Number.isFinite(n) ? n : 0;
    }
    return null;
  }

  /**
   * @param {string[]} parts
   * @returns {number}
   */
  function parseColonSeparatedTime(parts) {
    if ((parts.length !== 2 && parts.length !== 3) || !parts.every(isNumericTimePart)) return 0;

    const isThree = parts.length === 3;
    const h = isThree ? Number(parts[0]) : 0;
    const m = isThree ? Number(parts[1]) : Number(parts[0]);
    const secPart = isThree ? parts[2] : parts[1];

    const dot = secPart.indexOf('.');
    const sec = Number(dot >= 0 ? secPart.slice(0, dot) : secPart);
    const frac = dot >= 0 ? secPart.slice(dot + 1) : '';
    const ms = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0;

    if (![h, m, sec, ms].every(Number.isFinite)) {
      return 0;
    }
    return h * 3600 + m * 60 + sec + ms / 1000;
  }

  /**
   * Parse a clock-time string (H:MM:SS.mmm or MM:SS.mmm) to seconds.
   * Supports optional seconds suffix (s/S) for TTML format.
   * @param {string} value - Time string to parse
   * @param {{ allowSecondsSuffix?: boolean }} [opts] - Options
   * @returns {number} Time in seconds
   */
  function parseClockTimeToSeconds(value, opts = {}) {
    const v = String(value || '').trim();
    if (!v) return 0;

    // Support seconds suffix (s/S) for TTML format (e.g., "12.5s")
    if (opts.allowSecondsSuffix) {
      const suffixed = parseSecondsSuffixTime(v);
      if (suffixed !== null) return suffixed;
    }

    return parseColonSeparatedTime(v.split(':'));
  }

  /**
   * Parse VTT text to cues
   * @param {string} vttText - VTT subtitle content
   * @returns {SubtitleCue[]} Array of cues
   */
  function parseSubtitleVTT(vttText) {
    /** @type {SubtitleCue[]} */
    const cues = [];
    const blocks = String(vttText || '')
      .replace(/\r/g, '')
      .split(/\n\n+/);

    blocks.forEach((/** @type {string} */ block) => {
      const lines = block
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return;
      if (lines[0] === 'WEBVTT') return;

      const timeIndex = lines.findIndex(line => line.includes('-->'));
      if (timeIndex < 0) return;

      const range = lines[timeIndex].split('-->');
      if (range.length < 2) return;

      const start = parseClockTimeToSeconds(range[0]);
      const end = parseClockTimeToSeconds(range[1].split(' ')[0]);
      const duration = Math.max(0, end - start);
      const text = lines
        .slice(timeIndex + 1)
        .join(' ')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) return;
      cues.push({ start, duration, text });
    });

    return cues;
  }

  /**
   * @param {Document} doc
   * @returns {SubtitleCue[]}
   */
  function parseSubtitleTtmlDomNodes(doc) {
    /** @type {SubtitleCue[]} */
    const cues = [];
    const nodes = Array.from(doc.getElementsByTagName('p'));
    nodes.forEach(node => {
      const start = parseClockTimeToSeconds(
        node.getAttribute('begin') || node.getAttribute('start') || '',
        { allowSecondsSuffix: true }
      );
      const end = parseClockTimeToSeconds(node.getAttribute('end') || '', {
        allowSecondsSuffix: true,
      });
      const dur = parseClockTimeToSeconds(node.getAttribute('dur') || '', {
        allowSecondsSuffix: true,
      });
      const duration = dur || Math.max(0, end - start);
      const text = decodeHTMLEntities(
        String(node.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
      );
      if (!text) return;
      cues.push({ start, duration, text });
    });
    return cues;
  }

  /**
   * @param {string} normalizedTtml
   * @returns {SubtitleCue[]}
   */
  function parseSubtitleTtmlRegex(normalizedTtml) {
    /** @type {SubtitleCue[]} */
    const cues = [];
    const pTagRegex = /<p\b([^>]*)>([\s\S]{0,20000}?)<\/p>/gi;
    let match;
    while ((match = pTagRegex.exec(normalizedTtml)) !== null) {
      const attrs = match[1] || '';
      const inner = match[2] || '';

      const begin = /\bbegin\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '';
      const end = /\bend\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '';
      const dur = /\bdur\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '';

      const start = parseClockTimeToSeconds(begin, {
        allowSecondsSuffix: true,
      });
      let duration = 0;
      if (dur) duration = parseClockTimeToSeconds(dur, { allowSecondsSuffix: true });
      else if (end)
        duration = Math.max(0, parseClockTimeToSeconds(end, { allowSecondsSuffix: true }) - start);

      const text = decodeHTMLEntities(
        inner
          .replace(/<br\s*\/?\s*>/gi, ' ')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
      if (!text) continue;
      cues.push({ start, duration, text });
    }
    return cues;
  }

  /**
   * Parse TTML subtitles to cues
   * @param {string} ttmlText - TTML subtitle content
   * @returns {SubtitleCue[]} Array of cues
   */
  function parseSubtitleTTML(ttmlText) {
    const normalizedTtml = String(ttmlText || '').replace(/\uFEFF/g, '');
    const doc = parseXmlDocument(normalizedTtml);
    if (doc) {
      const cues = parseSubtitleTtmlDomNodes(doc);
      if (cues.length > 0) return cues;
    }
    return parseSubtitleTtmlRegex(normalizedTtml);
  }

  /**
   * Escape XML entities
   * @param {string} text - Raw text
   * @returns {string} Escaped text
   */
  function escapeXML(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Convert cues to transcript XML
   * @param {SubtitleCue[]} cues - Array of cues
   * @returns {string} XML transcript
   */
  function convertToXML(cues) {
    const body = cues
      .map(cue => {
        const start = Number(cue?.start || 0);
        const duration = Number(cue?.duration || 0);
        const text = escapeXML(String(cue?.text || '').trim());
        return `<text start="${start.toFixed(3)}" dur="${duration.toFixed(3)}">${text}</text>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="utf-8"?><transcript>${body}</transcript>`;
  }

  /**
   * @param {string} str
   * @param {string} key
   * @param {string} value
   * @returns {string}
   */
  function setQueryParamStringFallback(str, key, value) {
    const encoded = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    const qPos = str.indexOf('?');
    const hashPos = str.indexOf('#');
    const baseEnd = qPos >= 0 ? qPos : hashPos >= 0 ? hashPos : str.length;
    const base = str.slice(0, baseEnd);
    const hash = hashPos >= 0 ? str.slice(hashPos) : '';
    const queryStart = qPos >= 0 ? qPos + 1 : baseEnd;
    const queryEnd = hashPos >= 0 ? hashPos : str.length;
    const rawQuery = str.slice(queryStart, queryEnd);
    const pairs = rawQuery ? rawQuery.split('&').filter(Boolean) : [];

    let replaced = false;
    for (let i = 0; i < pairs.length; i += 1) {
      const pair = pairs[i];
      const eq = pair.indexOf('=');
      const name = eq >= 0 ? pair.slice(0, eq) : pair;
      if (decodeURIComponent(name) === key) {
        pairs[i] = encoded;
        replaced = true;
      }
    }
    if (!replaced) pairs.push(encoded);
    return `${base}?${pairs.join('&')}${hash}`;
  }

  /**
   * Set or replace query parameter in URL string
   * @param {string} inputUrl - Input URL
   * @param {string} key - Query key
   * @param {string} value - Query value
   * @returns {string} Updated URL
   */
  function setQueryParam(inputUrl, key, value) {
    try {
      const url = new URL(inputUrl);
      url.searchParams.set(key, value);
      return url.toString();
    } catch (_e) {
      logS(_e);
      return setQueryParamStringFallback(String(inputUrl || ''), key, value);
    }
  }

  /**
   * Remove query parameter from URL string.
   * @param {string} inputUrl
   * @param {string} key
   * @returns {string}
   */
  function removeQueryParam(inputUrl, key) {
    try {
      const url = new URL(inputUrl);
      url.searchParams.delete(key);
      return url.toString();
    } catch (_e) {
      logS(_e);
      const str = String(inputUrl || '');
      const qPos = str.indexOf('?');
      if (qPos < 0) return str;
      const hashPos = str.indexOf('#');
      const base = str.slice(0, qPos);
      const hash = hashPos >= 0 ? str.slice(hashPos) : '';
      const query = str.slice(qPos + 1, hashPos >= 0 ? hashPos : str.length);
      const nextPairs = query
        .split('&')
        .filter(Boolean)
        .filter(pair => {
          const eq = pair.indexOf('=');
          const name = eq >= 0 ? pair.slice(0, eq) : pair;
          return decodeURIComponent(name) !== key;
        });
      const nextQuery = nextPairs.join('&');
      return `${base}${nextQuery ? `?${nextQuery}` : ''}${hash}`;
    }
  }

  /**
   * Check whether URL is a valid http(s) URL.
   * @param {string} inputUrl
   * @returns {boolean}
   */
  function isHttpUrl(inputUrl) {
    try {
      const parsed = new URL(String(inputUrl || ''));
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_e) {
      logS(_e);
      return false;
    }
  }

  /**
   * Check whether URL is a valid https URL.
   * @param {string} inputUrl
   * @returns {boolean}
   */
  function isHttpsUrl(inputUrl) {
    try {
      const parsed = new URL(String(inputUrl || ''));
      return parsed.protocol === 'https:';
    } catch (_e) {
      logS(_e);
      return false;
    }
  }

  /**
   * Keep only unique, valid http(s) subtitle candidates.
   * @param {string[]} urls
   * @returns {string[]}
   */
  function normalizeSubtitleCandidates(urls) {
    return Array.from(new Set((urls || []).filter(u => isHttpUrl(u))));
  }

  /**
   * Sleep helper for paced retries.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  /**
   * Build minimal candidates for rate-limit recovery.
   * Keeps only lean URLs (without fmt) and prioritizes no-translation/no-asr variants.
   * @param {string[]} candidates
   * @returns {string[]}
   */
  function buildMinimalRateLimitCandidates(candidates) {
    const preferred = [];
    for (const candidate of normalizeSubtitleCandidates(candidates)) {
      const noFmt = removeQueryParam(candidate, 'fmt');
      const noTlang = removeQueryParam(noFmt, 'tlang');
      const noAsr = removeQueryParam(noTlang, 'kind');
      preferred.push(noAsr);
      preferred.push(noTlang);
      preferred.push(noFmt);
    }
    return normalizeSubtitleCandidates(preferred).slice(0, 3);
  }

  /**
   * Build candidate subtitle URLs with multiple formats.
   * Strips any pre-existing `tlang` and `fmt` params from baseUrl before
   * adding new ones to prevent parameter duplication.
   * @param {string} baseUrl - Base subtitle URL
   * @param {string | null} translateTo - Target language
   * @returns {string[]} Candidate URLs
   */
  function buildSubtitleCandidates(baseUrl, translateTo) {
    if (!baseUrl) return [];

    // Strip any pre-existing tlang/fmt to prevent duplication
    let resolved = baseUrl;
    try {
      const url = new URL(resolved);
      url.searchParams.delete('tlang');
      url.searchParams.delete('fmt');
      resolved = url.toString();
    } catch (_e) {
      logS(_e);
      // Fallback: strip via regex if URL is malformed
      resolved = resolved.replace(/[&?]tlang=[^&]*/g, '').replace(/[&?]fmt=[^&]*/g, '');
      // Fix dangling ? or &
      resolved = resolved.replace(/\?&/, '?').replace(/\?$/, '');
    }

    if (translateTo) {
      resolved = setQueryParam(resolved, 'tlang', translateTo);
    }

    // Build candidates with different subtitle formats
    const candidates = [
      resolved, // Try base URL without fmt first
      setQueryParam(resolved, 'fmt', 'srv1'),
      setQueryParam(resolved, 'fmt', 'json3'),
      setQueryParam(resolved, 'fmt', 'srv3'),
      setQueryParam(resolved, 'fmt', 'vtt'),
    ];

    return normalizeSubtitleCandidates(candidates);
  }

  /**
   * Build direct timedtext candidates when base URL is missing or expired.
   * @param {string} videoId - Video ID
   * @param {string} languageCode - Subtitle language
   * @param {boolean} isAutoGenerated - Whether source track is ASR
   * @param {string | null} translateTo - Target language
   * @returns {string[]} Candidate URLs
   */
  function buildDirectSubtitleCandidates(videoId, languageCode, isAutoGenerated, translateTo) {
    if (!(videoId && languageCode)) return [];

    const base = 'https://www.youtube.com/api/timedtext';
    const common = new URLSearchParams({
      v: videoId,
      lang: languageCode,
    });
    if (isAutoGenerated) {
      common.set('kind', 'asr');
    }
    if (translateTo) {
      common.set('tlang', translateTo);
    }

    const withFmt = (fmt = '') => {
      const q = new URLSearchParams(common);
      if (fmt) q.set('fmt', fmt);
      return `${base}?${q.toString()}`;
    };

    return normalizeSubtitleCandidates([
      withFmt(),
      withFmt('srv1'),
      withFmt('srv3'),
      withFmt('json3'),
      withFmt('vtt'),
    ]);
  }

  /**
   * @param {string} text
   * @returns {boolean}
   */
  function isHtmlErrorPage(text) {
    return (
      text.includes('<!DOCTYPE') ||
      text.includes('<html') ||
      text.includes('</html>') ||
      /^\s*<!DOCTYPE/i.test(text)
    );
  }

  /**
   * Try to detect subtitle payload format and validate parsed cues.
   * @param {string} raw
   * @returns {{ text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null}
   */
  function classifySubtitlePayload(raw) {
    const text = String(raw || '').trim();
    if (!text || text.length < 10 || isHtmlErrorPage(text)) return null;

    if (text.startsWith('{')) {
      return parseSubtitleJSON3(text).length > 0 ? { text, kind: 'json3' } : null;
    }
    if (text.includes('WEBVTT') || text.includes('-->')) {
      return parseSubtitleVTT(text).length > 0 ? { text, kind: 'vtt' } : null;
    }
    if (
      (text.includes('<transcript') || text.includes('<text')) &&
      parseSubtitleXML(text).length > 0
    ) {
      return { text, kind: 'xml' };
    }
    if ((text.includes('<tt') || text.includes('<p ')) && parseSubtitleTTML(text).length > 0) {
      return { text, kind: 'ttml' };
    }
    return text.length > 20 ? { text, kind: 'raw' } : null;
  }

  /**
   * Firefox/userscript fallback: fetch subtitles via page-context fetch.
   * This avoids userscript CORS/sandbox edge-cases when timedtext requests fail.
   * @param {string[]} candidates
   * @param {AbortSignal | null} [signal]
   * @returns {Promise<{ text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null>}
   */
  async function fetchSubtitlePayloadViaPageFetch(candidates, signal = null) {
    try {
      const pageGlobal = /** @type {Window & typeof globalThis & { fetch?: unknown }} */ (
        _pageGlobal()
      );
      const pageFetch = /** @type {typeof fetch | undefined} */ (pageGlobal?.fetch);
      if (typeof pageFetch !== 'function') return null;

      for (const candidateUrl of normalizeSubtitleCandidates(candidates)) {
        if (signal?.aborted) return null;
        try {
          /** @type {RequestInit} */
          const fetchOptions = {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: { Accept: '*/*' },
          };
          if (signal) fetchOptions.signal = signal;
          const response = await pageFetch(candidateUrl, fetchOptions);
          if (!response?.ok) continue;
          const raw = await response.text();
          const detected = classifySubtitlePayload(raw);
          if (detected) return detected;
        } catch (_e) {
          logS(_e);
          // Try next candidate
        }
      }
    } catch (_e) {
      logS(_e);
      // Ignore and let caller handle final failure
    }
    return null;
  }

  /** @type {AbortController|null} */
  let _subtitleAbortController = null;

  /**
   * Ensure a PoT token exists for the video implied by the candidate list.
   * @param {string[]} candidates
   * @returns {Promise<void>}
   */
  async function ensurePotForCandidates(candidates) {
    try {
      const candidateVideoId = (candidates || []).map(_getVideoIdFromCandidate).find(Boolean) || '';
      if (candidateVideoId && !_potParamsByVideoId.has(candidateVideoId)) {
        await _tryElicitPotForCurrentVideo();
      }
    } catch (_e) {
      logS(_e);
      // Non-critical
    }
  }

  /**
   * Normalizes the candidate list according to the request mode and attaches PoT.
   * @param {string[]} candidates
   * @param {boolean} minimalMode
   * @returns {string[]}
   */
  function normalizeCandidatesForMode(candidates, minimalMode) {
    const baseNormalized = minimalMode
      ? buildMinimalRateLimitCandidates(candidates)
      : normalizeSubtitleCandidates(candidates);
    return minimalMode ? baseNormalized : augmentSubtitleCandidatesWithPot(baseNormalized);
  }

  function resetSubtitleAbortSignal() {
    if (_subtitleAbortController) {
      try {
        _subtitleAbortController.abort();
      } catch (_e) {
        logS(_e);
      }
    }
    _subtitleAbortController = new AbortController();
    return _subtitleAbortController.signal;
  }

  /**
   * @param {string[]} candidates
   * @param {AbortSignal} signal
   * @returns {Promise<{ aborted?: boolean, done?: boolean, payload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null }>}
   */
  async function tryEarlyPageFetch(candidates, signal) {
    try {
      const earlyPageFetched = await fetchSubtitlePayloadViaPageFetch(candidates, signal);
      if (signal?.aborted) return { aborted: true, payload: null };
      if (earlyPageFetched && earlyPageFetched.kind !== 'raw') {
        return { done: true, payload: earlyPageFetched };
      }
      return { payload: earlyPageFetched };
    } catch (_e) {
      logS(_e);
      return { payload: null };
    }
  }

  /**
   * @param {string} candidateUrl
   * @param {Record<string, unknown>} profile
   * @returns {Promise<{ rateLimited?: boolean, failed?: boolean, detected?: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null }>}
   */
  async function fetchCandidateProfile(candidateUrl, profile) {
    try {
      const response = await gmXmlHttpRequest({
        ...profile,
        url: candidateUrl,
        timeout: DownloadConfig.REQUEST_TIMEOUT_MS,
      });

      const status = Number(response?.status || 0);
      if (status === 429) {
        return { rateLimited: true };
      }
      if (status !== 0 && !(status >= 200 && status < 400)) {
        return { failed: true };
      }

      const raw = await extractSubtitleBody(response);
      const detected = classifySubtitlePayload(raw);
      return { detected };
    } catch (_e) {
      logS(_e);
      return { failed: true };
    }
  }

  /**
   * Try to download subtitle payload from candidate URLs
   * @param {string[]} candidates - Candidate URLs
   * @param {{ minimalMode?: boolean }} [options]
   * @returns {Promise<{ payload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null, hadRateLimit: boolean }>} Payload with metadata
   */
  async function fetchSubtitlePayload(candidates, options = {}) {
    /** @type {{ text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null} */
    let firstNonEmpty = null;
    let hadRateLimit = false;
    const minimalMode = options.minimalMode === true;
    const allProfiles = getSubtitleRequestProfiles();
    const profiles = minimalMode ? allProfiles.slice(0, 1) : allProfiles;

    const signal = resetSubtitleAbortSignal();

    if (!minimalMode) {
      await ensurePotForCandidates(candidates);
    }

    const normalizedCandidates = normalizeCandidatesForMode(candidates, minimalMode);

    if (!minimalMode) {
      const early = await tryEarlyPageFetch(normalizedCandidates, signal);
      if (early.aborted) return { payload: null, hadRateLimit };
      if (early.done) return { payload: early.payload, hadRateLimit };
      if (early.payload && !firstNonEmpty) firstNonEmpty = early.payload;
    }

    const gmResult = await fetchSubtitleViaGmWrapper(
      normalizedCandidates,
      profiles,
      signal,
      firstNonEmpty
    );
    if (gmResult.returned) {
      return (
        gmResult.result ?? {
          payload: null,
          hadRateLimit: gmResult.hadRateLimit,
        }
      );
    }
    if (gmResult.firstNonEmpty)
      firstNonEmpty = /** @type {typeof firstNonEmpty} */ (gmResult.firstNonEmpty);
    if (typeof gmResult.hadRateLimit === 'boolean') hadRateLimit = gmResult.hadRateLimit;

    return resolveFallbackSubtitle(
      normalizedCandidates,
      firstNonEmpty,
      hadRateLimit,
      minimalMode,
      signal
    );
  }

  /**
   * @param {string[]} normalizedCandidates
   * @param {{ text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null} firstNonEmpty
   * @param {boolean} hadRateLimit
   * @param {boolean} minimalMode
   * @param {AbortSignal} signal
   * @returns {Promise<{ payload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null, hadRateLimit: boolean }>}
   */
  async function resolveFallbackSubtitle(
    normalizedCandidates,
    firstNonEmpty,
    hadRateLimit,
    minimalMode,
    signal
  ) {
    if (!firstNonEmpty) {
      const pageFetched = await fetchSubtitlePayloadViaPageFetch(normalizedCandidates, signal);
      if (pageFetched) {
        return { payload: pageFetched, hadRateLimit };
      }
    }

    if (!firstNonEmpty && hadRateLimit && !minimalMode) {
      await waitMs(1200);
      return fetchSubtitlePayload(normalizedCandidates, { minimalMode: true });
    }

    return { payload: firstNonEmpty, hadRateLimit };
  }

  /**
   * @param {string} candidateUrl
   * @param {Array<Record<string, unknown>>} profiles
   * @returns {Promise<{ rateLimited: boolean, directPayload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null, rawPayload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null }>}
   */
  async function tryProfilesForCandidate(candidateUrl, profiles) {
    let rateLimited = false;
    let directPayload = null;
    let rawPayload = null;

    for (const profile of profiles) {
      const res = await fetchCandidateProfile(candidateUrl, profile);
      if (res.rateLimited) {
        rateLimited = true;
        await waitMs(350);
        continue;
      }
      if (res.detected) {
        if (res.detected.kind !== 'raw') {
          directPayload = res.detected;
          break;
        }
        if (!rawPayload) rawPayload = res.detected;
      }
    }
    return { rateLimited, directPayload, rawPayload };
  }

  /**
   * Walk candidates × request profiles via GM_xmlhttpRequest, returning the
   * first classified payload. Mutates tracking via returned aggregates.
   * @param {string[]} normalizedCandidates
   * @param {Array<Record<string, unknown>>} profiles
   * @param {AbortSignal} signal
   * @param {() => { text: string, kind: string } | null} getFirstNonEmpty
   * @returns {Promise<{ returned: boolean, result: { payload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null, hadRateLimit: boolean }, firstNonEmpty?: unknown, hadRateLimit?: boolean }>}
   */
  async function fetchSubtitleViaGmLoop(normalizedCandidates, profiles, signal, getFirstNonEmpty) {
    let hadRateLimit = false;
    let firstNonEmpty = getFirstNonEmpty();
    for (const candidateUrl of normalizedCandidates) {
      if (signal?.aborted) {
        return {
          returned: true,
          result: { payload: null, hadRateLimit },
          hadRateLimit: false,
        };
      }

      const { rateLimited, directPayload, rawPayload } = await tryProfilesForCandidate(
        candidateUrl,
        profiles
      );
      if (rateLimited) hadRateLimit = true;
      if (directPayload) {
        return {
          returned: true,
          result: { payload: directPayload, hadRateLimit },
          hadRateLimit: false,
        };
      }
      if (rawPayload && !firstNonEmpty) {
        firstNonEmpty = rawPayload;
      }

      if (hadRateLimit) {
        await waitMs(220);
      }
    }
    return {
      returned: false,
      result: { payload: null, hadRateLimit },
      firstNonEmpty,
      hadRateLimit,
    };
  }

  /**
   * Wrap the GM_xmlhttpRequest loop with firstNonEmpty/hadRateLimit threading
   * shared with the page-fetch pre-pass.
   * @param {string[]} normalizedCandidates
   * @param {Array<Record<string, unknown>>} profiles
   * @param {AbortSignal} signal
   * @param {{ text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null} firstNonEmpty
   * @returns {Promise<{ returned: boolean, result: { payload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null, hadRateLimit: boolean }, firstNonEmpty?: unknown, hadRateLimit?: boolean }>}
   */
  async function fetchSubtitleViaGmWrapper(normalizedCandidates, profiles, signal, firstNonEmpty) {
    return fetchSubtitleViaGmLoop(normalizedCandidates, profiles, signal, () => firstNonEmpty);
  }

  /**
   * Trigger a browser file download and revoke the object URL after the click settles.
   * Immediate revocation is flaky in Chromium/Firefox and breaks repeated downloads.
   * @param {Blob} blob
   * @param {string} filename
   * @param {number} [revokeDelayMs=1500]
   */
  function triggerBlobDownload(blob, filename, revokeDelayMs = 1500) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout_(
      () => {
        try {
          if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(blobUrl);
          }
        } catch (_e) {
          logS(_e);
          /* ignore revocation errors */
        }
      },
      Math.max(500, Number(revokeDelayMs) || 1500)
    );
  }

  /**
   * @param {Record<string, unknown>} p
   * @returns {Promise<{ payload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null, hadRateLimit: boolean }>}
   */
  async function retrySubtitleRateLimited(p) {
    const translated = Array.isArray(p.translatedCandidates) ? p.translatedCandidates : [];
    const sourceNoAsr = Array.isArray(p.sourceNoAsrCandidates) ? p.sourceNoAsrCandidates : [];
    const source = Array.isArray(p.sourceCandidates) ? p.sourceCandidates : [];
    const rateLimitCandidates = buildMinimalRateLimitCandidates(
      p.translateTo ? [...translated] : [...sourceNoAsr, ...source]
    );
    return fetchSubtitlePayload(rateLimitCandidates, {
      minimalMode: true,
    });
  }

  /**
   * @param {Record<string, unknown>} p
   * @returns {Promise<{ payload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null, hadRateLimit: boolean } | null>}
   */
  async function fetchFreshWatchPageCandidates(p) {
    try {
      const videoId = String(p.videoId || '');
      const freshPlayerResponse = await fetchPlayerResponseFromWatchHtml(videoId);
      const freshTracks =
        freshPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const freshTrack = findBestCaptionTrack(freshTracks, {
        languageCode: String(p.languageCode || ''),
        isAutoGenerated: Boolean(p.isAutoGenerated),
        baseUrl: String(p.baseUrl || ''),
        trackId: String(p.trackId || ''),
      });
      if (freshTrack?.baseUrl) {
        const freshBase = normalizeSubtitleBaseUrl(freshTrack.baseUrl);
        const languageCode = String(p.languageCode || '');
        const isAutoGenerated = Boolean(p.isAutoGenerated);
        const translateTo = p.translateTo ? String(p.translateTo) : null;
        const freshCandidates = translateTo
          ? [
              ...buildSubtitleCandidates(freshBase, translateTo),
              ...buildDirectSubtitleCandidates(videoId, languageCode, isAutoGenerated, translateTo),
            ]
          : [
              ...buildSubtitleCandidates(freshBase, null),
              ...buildDirectSubtitleCandidates(videoId, languageCode, isAutoGenerated, null),
              ...buildDirectSubtitleCandidates(videoId, languageCode, false, null),
            ];
        return await fetchSubtitlePayload(freshCandidates);
      }
    } catch (_e) {
      logS(_e);
    }
    return null;
  }

  /**
   * Try the primary candidate list, then the rate-limit / fresh-URL fallbacks.
   * Returns {payload, sawRateLimit}; payload may be null (caller throws).
   * @param {{ candidates: string[], sourceNoAsrCandidates: string[], isFirefox?: boolean, isAutoGenerated?: boolean, translateTo?: string | null, videoId?: string, languageCode?: string, baseUrl?: string | null, trackId?: string }} p
   * @returns {Promise<{payload: { text: string, kind: 'xml' | 'json3' | 'vtt' | 'ttml' | 'raw' } | null, sawRateLimit: boolean}>}
   */
  async function fetchSubtitleWithFallbacks(p) {
    let sawRateLimit = false;
    let { payload, hadRateLimit } = await fetchSubtitlePayload(p.candidates, {
      minimalMode: p.isFirefox,
    });
    sawRateLimit = sawRateLimit || hadRateLimit;

    if (!payload && hadRateLimit) {
      await waitMs(900);
    }

    // Fallback 1: some videos expose captions but reject kind=asr with translation;
    // retry direct timedtext without ASR flag and without tlang.
    if (!payload && p.isAutoGenerated && !p.translateTo) {
      const langOnlyAttempt = await fetchSubtitlePayload(p.sourceNoAsrCandidates);
      payload = langOnlyAttempt.payload;
      hadRateLimit = hadRateLimit || langOnlyAttempt.hadRateLimit;
      sawRateLimit = sawRateLimit || langOnlyAttempt.hadRateLimit;
    }

    // Fallback 2: aggressive minimal retry specifically for 429-heavy sessions.
    if (!payload && hadRateLimit) {
      const finalAttempt = await retrySubtitleRateLimited(p);
      payload = finalAttempt.payload;
      sawRateLimit = sawRateLimit || finalAttempt.hadRateLimit;
    }

    // Fallback 4: Signed timedtext URLs expire after a few hours and YouTube returns
    // HTTP 200 with an empty body instead of 403. Re-fetch the watch page to get fresh
    // signed URLs and retry the download with those.
    if (!payload) {
      const freshAttempt = await fetchFreshWatchPageCandidates(p);
      if (freshAttempt) {
        payload = freshAttempt.payload;
        sawRateLimit = sawRateLimit || freshAttempt.hadRateLimit;
      }
    }

    return { payload, sawRateLimit };
  }

  /**
   * Parse subtitle text into cues by detected kind, with a format-fallback chain.
   * @param {string} subtitleText
   * @param {string} subtitleKind
   * @returns {SubtitleCue[]}
   */
  function parseSubtitleCues(subtitleText, subtitleKind) {
    /** @type {SubtitleCue[]} */
    let cues = [];
    if (subtitleKind === 'xml') cues = parseSubtitleXML(subtitleText);
    else if (subtitleKind === 'json3') cues = parseSubtitleJSON3(subtitleText);
    else if (subtitleKind === 'vtt') cues = parseSubtitleVTT(subtitleText);
    else if (subtitleKind === 'ttml') cues = parseSubtitleTTML(subtitleText);
    else {
      cues = parseSubtitleXML(subtitleText);
      if (cues.length === 0) cues = parseSubtitleJSON3(subtitleText);
      if (cues.length === 0) cues = parseSubtitleVTT(subtitleText);
      if (cues.length === 0) cues = parseSubtitleTTML(subtitleText);
    }
    return cues;
  }

  /**
   * Convert parsed cues into the requested output format.
   * @param {SubtitleCue[]} cues
   * @param {string} subtitleText
   * @param {string} subtitleKind
   * @param {string} format
   * @returns {{content: string, extension: string}}
   */
  function formatSubtitleOutput(cues, subtitleText, subtitleKind, format) {
    let content;
    let extension;

    if (format === 'xml') {
      content = subtitleKind === 'xml' ? subtitleText : convertToXML(cues);
      extension = 'xml';
    } else {
      if (cues.length === 0) {
        throw new Error('No subtitle cues found');
      }

      if (format === 'srt') {
        content = convertToSRT(cues);
        extension = 'srt';
      } else if (format === 'txt') {
        content = convertToTXT(cues);
        extension = 'txt';
      } else {
        content = subtitleKind === 'xml' ? subtitleText : convertToXML(cues);
        extension = 'xml';
      }
    }

    return { content, extension };
  }

  /**
   * @param {{ baseUrl?: string | null, videoId?: string, languageCode?: string, isAutoGenerated?: boolean, translateTo?: string | null, isFirefox?: boolean }} opts
   * @returns {{ candidates: string[], translatedCandidates: string[], sourceCandidates: string[], sourceNoAsrCandidates: string[] }}
   */
  function prepareSubtitleCandidates({
    baseUrl,
    videoId,
    languageCode,
    isAutoGenerated,
    translateTo,
    isFirefox,
  }) {
    const _baseUrl = baseUrl || '';
    const _videoId = videoId || '';
    const _lang = languageCode || '';
    const _isAuto = Boolean(isAutoGenerated);
    const translatedCandidates = [
      ...buildSubtitleCandidates(_baseUrl, translateTo || null),
      ...buildDirectSubtitleCandidates(_videoId, _lang, _isAuto, translateTo || null),
    ];
    const sourceCandidates = [
      ...buildSubtitleCandidates(_baseUrl, null),
      ...buildDirectSubtitleCandidates(_videoId, _lang, _isAuto, null),
    ];
    const sourceNoAsrCandidates = [
      ...buildSubtitleCandidates(removeQueryParam(String(_baseUrl), 'tlang'), null),
      ...buildDirectSubtitleCandidates(_videoId, _lang, false, null),
    ];

    // When user explicitly selected auto-translation, never prioritize source
    // tracks, otherwise we may silently download the wrong language.
    const primaryCandidates = translateTo ? translatedCandidates : sourceCandidates;

    // Firefox: still use minimal candidate strategy to reduce 429 bursts, but
    // preserve user intent for translated subtitle downloads.
    const candidates = isFirefox
      ? buildMinimalRateLimitCandidates(
          translateTo ? [...primaryCandidates] : [...sourceNoAsrCandidates, ...sourceCandidates]
        )
      : primaryCandidates;

    return { candidates, translatedCandidates, sourceCandidates, sourceNoAsrCandidates };
  }

  /**
   * @param {SubtitleCue[]} cues
   * @param {string} subtitleText
   * @param {string} subtitleKind
   * @param {string} format
   * @param {string} title
   * @param {string | undefined} languageName
   * @param {string | undefined} languageCode
   * @param {string | null} translateTo
   * @returns {void}
   */
  function saveSubtitleBlob(
    cues,
    subtitleText,
    subtitleKind,
    format,
    title,
    languageName,
    languageCode,
    translateTo
  ) {
    const { content, extension } = formatSubtitleOutput(cues, subtitleText, subtitleKind, format);
    const code = languageCode || '';
    const name = languageName || code;
    const langSuffix = translateTo ? `${code}-${translateTo}` : code;
    const filename = sanitizeFilename(`${title} - ${name} (${langSuffix}).${extension}`);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    triggerBlobDownload(blob, filename);

    getNotificationManager()?.show?.(t('subtitleDownloaded'), {
      duration: NOTIFY_DURATION.MEDIUM,
      type: 'success',
    });

    logger.debug('Subtitle downloaded:', filename);
  }

  /**
   * Download subtitle file
   * @param {SubtitleDownloadOptions} [options] - Download options
   * @returns {Promise<void>}
   */
  async function downloadSubtitle(options = /** @type {SubtitleDownloadOptions} */ ({})) {
    const {
      videoId,
      url: baseUrl,
      languageCode,
      languageName,
      isAutoGenerated = false,
      format = 'srt',
      translateTo = null,
      trackId = '',
    } = options;

    if (!(videoId && (baseUrl || languageCode))) {
      throw new Error('Video ID and subtitle source are required');
    }

    const title = getVideoTitle();
    const isFirefox = /firefox/i.test(navigator.userAgent || '');
    const candidateBundle = prepareSubtitleCandidates({
      baseUrl,
      videoId,
      languageCode,
      isAutoGenerated,
      translateTo,
      isFirefox,
    });

    getNotificationManager()?.show?.(t('subtitleDownloading'), {
      duration: NOTIFY_DURATION.SHORT,
      type: 'info',
    });

    let sawRateLimit = false;

    try {
      const fallbackResult = await fetchSubtitleWithFallbacks({
        ...candidateBundle,
        isFirefox,
        isAutoGenerated,
        translateTo,
        videoId,
        languageCode,
        baseUrl,
        trackId,
      });
      const payload = fallbackResult.payload;
      sawRateLimit = fallbackResult.sawRateLimit;

      if (!payload) {
        if (translateTo) {
          throw new Error('Translated subtitle track is unavailable for this video/language');
        }
        throw new Error('Empty subtitle response');
      }

      const subtitleText = payload.text;
      const subtitleKind = payload.kind;
      const cues = parseSubtitleCues(subtitleText, subtitleKind);
      saveSubtitleBlob(
        cues,
        subtitleText,
        subtitleKind,
        format,
        title,
        languageName,
        languageCode,
        translateTo
      );
    } catch (error) {
      logS(error);
      const errMsg = error instanceof Error ? error.message : String(error);
      if (sawRateLimit && errMsg === 'Empty subtitle response') {
        if (error instanceof Error) {
          error.message =
            'YouTube temporarily limited subtitle requests (HTTP 429). Please retry in 20-60 seconds.';
        }
      }
      reportDownloadError(error, {
        logMessage: 'Error downloading subtitle:',
        failedKey: 'subtitleDownloadFailed',
      });
    }
  }

  /**
   * Make a request to a cnv.cx converter endpoint and return the parsed JSON response.
   * @param {CnvConverter} converter
   * @param {{ method: string, url: string, extraHeaders?: Record<string, string>, body?: string, formatErrorMessage: (status: number) => string }} opts
   * @returns {Promise<Record<string, unknown>>}
   */
  async function cnvRequest(
    converter,
    { method, url, extraHeaders = {}, body, formatErrorMessage }
  ) {
    const headers = {
      ...DownloadConfig.HEADERS,
      Origin: converter.origin,
      Referer: converter.referer,
      ...extraHeaders,
    };
    const response = await gmXmlHttpRequest({
      method,
      url,
      headers,
      timeout: DownloadConfig.REQUEST_TIMEOUT_MS,
      ...(body ? { data: body } : {}),
    });
    if (response.status !== 200) {
      const serverMsg = extractServerErrorMessage(response);
      const base = formatErrorMessage(response.status);
      throw new Error(serverMsg ? `${base}: ${serverMsg}` : base);
    }
    return JSON.parse(String(response.responseText));
  }

  /**
   * Extract a human-readable message from a cnv.cx error response body.
   * @param {GMResponseLike | null | undefined} response
   * @returns {string}
   */
  function extractServerErrorMessage(response) {
    try {
      const parsed = JSON.parse(String(response?.responseText || ''));
      if (parsed?.errorMsg) return String(parsed.errorMsg);
      if (parsed?.error?.message) return String(parsed.error.message);
    } catch (_e) {
      logS(_e);
      // Non-JSON body, so there is nothing to extract.
    }
    return '';
  }

  /**
   * Extract YouTube video ID from a watch/shorts/live URL string.
   * @param {string} url
   * @returns {string}
   */
  function extractVideoIdFromLink(url) {
    return U?.getVideoIdFromUrl?.(url) || '';
  }

  /**
   * Fetch conversion API key from cnv.cx using the provided converter config.
   * cnv.cx requires the target video `id` query parameter on the key endpoint.
   * @param {CnvConverter} converter
   * @param {string} videoId
   * @returns {Promise<string>}
   */
  async function fetchConverterKey(converter, videoId) {
    const keyUrl =
      DownloadConfig.API.KEY_URL + (videoId ? `?id=${encodeURIComponent(videoId)}` : '');
    const keyData = /** @type {{ key?: string }} */ (
      await cnvRequest(converter, {
        method: 'GET',
        url: keyUrl,
        formatErrorMessage: status => `Failed to get API key from ${converter.name}: ${status}`,
      })
    );

    if (!keyData?.key) {
      throw new Error(`API key not found in response from ${converter.name}`);
    }

    logger.debug(`API key obtained via ${converter.name}`);
    return keyData.key;
  }

  /**
   * Request conversion from cnv.cx using the provided converter config.
   * @param {CnvConverter} converter
   * @param {ConversionPayload} payload
   * @param {string} key
   * @returns {Promise<CnvDownloadInfo>}
   */
  async function requestConversion(converter, payload, key) {
    logger.debug(`Requesting conversion via ${converter.name}...`, {
      format: payload?.format,
      videoQuality: payload?.videoQuality,
      audioBitrate: payload?.audioBitrate,
    });

    const apiDownloadInfo = /** @type {CnvDownloadInfo} */ (
      await cnvRequest(converter, {
        method: 'POST',
        url: DownloadConfig.API.CONVERT_URL,
        extraHeaders: { key },
        body: JSON.stringify(payload),
        formatErrorMessage: status => `${converter.name} conversion failed: ${status}`,
      })
    );

    if (!apiDownloadInfo?.url) {
      const detail = apiDownloadInfo?.error?.code || apiDownloadInfo?.status || 'unknown error';
      throw new Error(`No download URL received from ${converter.name} (${detail})`);
    }

    return apiDownloadInfo;
  }

  /**
   * Convert via configured converter servers with fallback and retries.
   * The cnv.cx backend intermittently returns transient `400` errors, so we
   * round-robin through the converters with a short backoff between attempts.
   * @param {ConversionPayload} payload
   * @param {(() => boolean) | null} [onCancel]
   * @returns {Promise<{info: CnvDownloadInfo, converter: CnvConverter}>}
   */
  async function convertWithFallback(payload, onCancel = null) {
    let lastError = null;
    const videoId = extractVideoIdFromLink(payload?.link);
    const converters = DownloadConfig.CONVERTERS;
    const maxAttempts = Math.max(converters.length, DownloadConfig.MAX_CONVERT_ATTEMPTS);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (onCancel?.()) {
        throw new Error('Download cancelled');
      }
      const converter = converters[attempt % converters.length];
      try {
        const key = await fetchConverterKey(converter, videoId);
        const info = await requestConversion(converter, payload, key);
        return { info, converter };
      } catch (error) {
        logS(error);
        lastError = error;
        logger.warn(
          `${converter.name} failed (attempt ${attempt + 1}/${maxAttempts}):`,
          error instanceof Error ? error.message : error
        );
        if (attempt < maxAttempts - 1) {
          const delay = DownloadConfig.CONVERT_RETRY_BACKOFF_MS[attempt] ?? 0;
          if (delay > 0) {
            await waitMs(delay);
          }
        }
      }
    }
    throw lastError || new Error('All converter servers failed');
  }

  /**
   * Download blob from CDN using converter-specific Referer.
   * @param {{ url?: string, converter?: { referer?: string }, onProgress?: ((p: { loaded: number, total: number, percent?: number }) => void) | null, onRequest?: ((req: GMRequestHandle) => void) | null, timeout?: number }} [options]
   * @returns {Promise<Blob>}
   */
  function downloadBlobFromUrl(options) {
    const { url = '', converter, onProgress, onRequest, timeout = 0 } = options || {};
    // Response-supplied media URLs must be https; anything else is refused
    // before any network call.
    if (!isHttpsUrl(url)) {
      return Promise.reject(new Error('Refused non-https download URL'));
    }
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'undefined') {
        logger.warn('GM_xmlhttpRequest not available, opening in new tab');
        if (U?.openSafe) {
          U.openSafe(url, '_blank');
        } else {
          window.open(url, '_blank');
        }
        // Mark a synthetic request so the queue still sees a cancelable handle.
        if (typeof onRequest === 'function') {
          onRequest({
            abort: () => {
              // Nothing to abort for a new-tab fallback, but matching the shape
              // keeps the manager cancel button consistent.
            },
          });
        }
        resolve(new Blob([]));
        return;
      }

      const request = GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        headers: {
          'User-Agent': DownloadConfig.HEADERS['User-Agent'],
          // See the Origin security note in DownloadConfig: the cnv.cx CDN
          // requires the same referer impersonation to serve the file.
          Referer: converter?.referer || 'https://mp3yt.is/',
          Accept: '*/*',
        },
        onprogress: (/** @type {{ loaded: number, total: number }} */ progress) => {
          if (onProgress) {
            onProgress({
              loaded: progress.loaded,
              total: progress.total,
              percent: progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0,
            });
          }
        },
        onload: (/** @type {GMResponseLike} */ response) => {
          if (response.status === 200 && response.response) {
            const respBlob = /** @type {Blob} */ (response.response);
            if (respBlob.size === 0) {
              reject(new Error(t('zeroBytesError')));
              return;
            }
            resolve(respBlob);
          } else {
            reject(new Error(`Download failed: ${response.status}`));
          }
        },
        onerror: () => reject(new Error('Download failed - network error')),
        // only reject on timeout when a timeout is actually configured -
        // GM fires ontimeout spuriously for indefinite downloads otherwise.
        ...(timeout > 0
          ? {
              timeout,
              ontimeout: () => reject(new Error('Download timeout')),
            }
          : {}),
      });

      if (typeof onRequest === 'function') {
        onRequest(request);
      }
    });
  }

  /**
   * @param {(() => boolean) | null} [onCancel]
   * @returns {{ videoId: string, videoUrl: string, title: string }}
   */
  function initDownloadSession(onCancel) {
    const videoId = getVideoId();
    if (!videoId) {
      throw new Error('Video ID not found');
    }
    if (onCancel?.()) {
      throw new Error('Download cancelled');
    }
    const videoUrl = getVideoUrl();
    const title = getVideoTitle();
    getNotificationManager()?.show?.(t('startingDownload'), {
      duration: NOTIFY_DURATION.SHORT,
      type: 'info',
    });
    return { videoId, videoUrl, title };
  }

  /**
   * @param {Partial<NormalizedDownloadOptions>} [options]
   * @returns {NormalizedDownloadOptions}
   */
  function normalizeDownloadOptions(options = {}) {
    return {
      format: options.format ?? DownloadConfig.DEFAULTS.format,
      quality: options.quality ?? DownloadConfig.DEFAULTS.videoQuality,
      audioBitrate: options.audioBitrate ?? DownloadConfig.DEFAULTS.audioBitrate,
      embedThumbnail: options.embedThumbnail ?? DownloadConfig.DEFAULTS.embedThumbnail,
      onProgress: options.onProgress ?? null,
      onCancel: options.onCancel ?? null,
      onRequest: options.onRequest ?? null,
    };
  }

  /**
   * @param {string} format
   * @param {string} quality
   * @param {string} audioBitrate
   * @param {string} videoUrl
   * @returns {ConversionPayload}
   */
  function prepareConversionPayload(format, quality, audioBitrate, videoUrl) {
    if (format === 'video') {
      const codec = parseInt(quality, 10) > 1080 ? 'vp9' : 'h264';
      return {
        link: videoUrl,
        format: 'mp4',
        audioBitrate: '128',
        videoQuality: quality,
        filenameStyle: 'pretty',
        vCodec: codec,
      };
    }
    return {
      link: videoUrl,
      format: 'mp3',
      audioBitrate,
      filenameStyle: 'pretty',
    };
  }

  /**
   * @param {Blob} blob
   * @param {string} videoId
   * @param {string} title
   * @returns {Promise<Blob>}
   */
  async function tryEmbedAudioThumbnail(blob, videoId, title) {
    try {
      logger.debug('Embedding album art...');
      const thumbnailUrls = [
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      ];
      let albumArt = null;
      for (const thumbnailUrl of thumbnailUrls) {
        try {
          albumArt = await createSquareAlbumArt(thumbnailUrl);
          break;
        } catch (error) {
          logS(error);
          logger.warn(`Album art source failed ${thumbnailUrl}:`, error);
        }
      }
      if (albumArt) {
        const enriched = await embedAlbumArtToMP3(blob, albumArt, { title });
        logger.debug('Album art embedded successfully');
        return enriched;
      }
    } catch (error) {
      logS(error);
      logger.error('Failed to embed album art:', error);
    }
    return blob;
  }

  /**
   * Download video or audio from YouTube
   *
   * This is the main download function that uses the cnv.cx conversion backend
   * to convert and download YouTube videos/audio.
   *
   * @param {DownloadOptions} [options] - Download options
   * @returns {Promise<void>} Resolves when download completes
   *
   * @example
   * // Download 1080p video
   * await downloadVideo({ format: 'video', quality: '1080' });
   *
   * // Download 320kbps audio with album art
   * await downloadVideo({
   *   format: 'audio',
   *   audioBitrate: '320',
   *   embedThumbnail: true
   * });
   */
  async function downloadVideo(options = {}) {
    const opts = normalizeDownloadOptions(options);
    const { videoId, videoUrl, title } = initDownloadSession(opts.onCancel);

    try {
      const payload = prepareConversionPayload(
        opts.format,
        opts.quality,
        opts.audioBitrate,
        videoUrl
      );

      const { info: apiDownloadInfo, converter } = await convertWithFallback(
        payload,
        /** @type {(() => boolean) | null} */ (opts.onCancel ?? null)
      );
      if (opts.onCancel?.()) {
        throw new Error('Download cancelled');
      }

      logger.debug('Downloading file from:', sanitizeUrlForLog(String(apiDownloadInfo.url || '')));
      let blob = await downloadBlobFromUrl({
        url: String(apiDownloadInfo.url || ''),
        converter,
        onProgress: opts.onProgress,
        onRequest: opts.onRequest,
      });

      if (blob.size === 0) {
        return;
      }

      U && YouTubeUtils.logger?.debug?.(`[Download] File downloaded: ${formatBytes(blob.size)}`);

      if (opts.format === 'audio' && opts.embedThumbnail) {
        blob = await tryEmbedAudioThumbnail(blob, videoId, title);
      }

      const filename = String(
        apiDownloadInfo.filename || `${title}.${opts.format === 'video' ? 'mp4' : 'mp3'}`
      );
      triggerBlobDownload(blob, sanitizeFilename(filename), 2000);

      getNotificationManager()?.show?.(t('downloadCompleted'), {
        duration: NOTIFY_DURATION.MEDIUM,
        type: 'success',
      });

      logger.debug('Download completed:', filename);
    } catch (error) {
      logS(error);
      reportDownloadError(error, {
        logMessage: 'Error:',
        failedKey: 'downloadFailed',
      });
    }
  }

  // ============================================================================
  // ALTERNATIVE SOURCES (Cobalt + direct mobile stream)
  // ============================================================================
  // Independent download paths used when the cnv.cx converter backend is down.

  /** @type {number | null} */
  let _cobaltDirectoryFetchedAt = null;
  /** @type {Array<{name: string, api: string}> | null} */
  let _cobaltDirectoryCache = null;
  /** @type {Set<string>} Hosts already disclosed to the user this session. */
  const _cobaltDisclosedHosts = new Set();

  /**
   * Resolve a promise with a hard timeout.
   * @template T
   * @param {Promise<T>} promise
   * @param {number} ms
   * @returns {Promise<T>}
   */
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const id = setTimeout_(() => reject(new Error(`Request timed out after ${ms}ms`)), ms);
      Promise.resolve(promise).then(
        value => {
          clearTimeout(id);
          resolve(value);
        },
        error => {
          clearTimeout(id);
          reject(error);
        }
      );
    });
  }

  /**
   * De-duplicate Cobalt instances, keeping the first occurrence of each API URL.
   * @param {Array<{name: string, api: string}>} instances
   * @returns {Array<{name: string, api: string}>}
   */
  function dedupeCobaltInstances(instances) {
    const seen = new Set();
    return instances.filter(inst => {
      const key = String(inst.api || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Validate a cobalt.directory-discovered API base URL before it may be
   * contacted: HTTPS only, no embedded credentials, no path/query/hash
   * (bare origin endpoints only).
   * @param {string} api
   * @returns {boolean}
   */
  function isValidDiscoveredCobaltApi(api) {
    try {
      const url = new URL(api);
      if (url.protocol !== 'https:') return false;
      if (url.username || url.password) return false;
      if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return false;
      return true;
    } catch (_e) {
      logS(_e);
      return false;
    }
  }

  /**
   * Return the list of Cobalt instances to try, in priority order.
   * The statically verified (no-Turnstile) instances come first, then any
   * currently working instances discovered via cobalt.directory (cached).
   * @returns {Promise<Array<{name: string, api: string}>>}
   */
  async function fetchCobaltInstances() {
    const base = DownloadConfig.COBALT.INSTANCES.slice();
    // community discovery is an explicit opt-in. Without it only the
    // statically verified @connect instances are contacted: cobalt.directory
    // is not fetched and discovered hosts never see the watch URL.
    if (window.YouTubePlusSettingsStore?.get?.('allowCobaltDiscovery') !== true) {
      return dedupeCobaltInstances(base);
    }

    const now = Date.now();
    const stale =
      _cobaltDirectoryFetchedAt === null ||
      now - /** @type {number} */ (_cobaltDirectoryFetchedAt) >
        DownloadConfig.COBALT.DIRECTORY_CACHE_MS;

    if (!stale && _cobaltDirectoryCache) {
      return dedupeCobaltInstances([...base, ..._cobaltDirectoryCache]);
    }

    try {
      const response = await withTimeout(
        gmXmlHttpRequest({
          method: 'GET',
          url: DownloadConfig.COBALT.DIRECTORY_URL,
          timeout: DownloadConfig.COBALT.DIRECTORY_TIMEOUT_MS,
          headers: { Accept: 'application/json' },
        }),
        DownloadConfig.COBALT.DIRECTORY_TIMEOUT_MS
      );
      if (response.status === 200) {
        const parsed = JSON.parse(String(response.responseText || '{}'));
        const list = Array.isArray(parsed?.data?.youtube)
          ? /** @type {unknown[]} */ (parsed.data.youtube)
          : [];
        const discovered = list
          .map(entry => {
            if (typeof entry === 'string') return entry;
            if (entry && typeof entry === 'object' && 'api' in entry) {
              return String(/** @type {{ api?: unknown }} */ (entry).api || '');
            }
            return '';
          })
          .filter(isValidDiscoveredCobaltApi)
          .map((/** @type {string} */ api) => ({
            name: String(new URL(api).hostname),
            api: String(api).replace(/\/+$/, ''),
          }));
        _cobaltDirectoryCache = discovered;
        _cobaltDirectoryFetchedAt = now;
        return dedupeCobaltInstances([...base, ...discovered]);
      }
    } catch (error) {
      logS(error);
      logger.warn(
        'Cobalt directory discovery failed:',
        (error instanceof Error ? error.message : null) || error
      );
    }

    return dedupeCobaltInstances(base);
  }

  /**
   * @param {string} format
   * @param {string} quality
   * @param {string} audioBitrate
   * @param {string} videoUrl
   * @returns {Record<string, string | number>}
   */
  function prepareCobaltPayload(format, quality, audioBitrate, videoUrl) {
    /** @type {Record<string, string | number>} */
    const payload = {
      url: videoUrl,
      downloadMode: format === 'audio' ? 'audio' : 'auto',
    };
    if (format === 'video') {
      payload.videoQuality = String(quality);
    } else {
      payload.audioFormat = 'mp3';
      payload.audioBitrate = String(audioBitrate);
    }
    return payload;
  }

  /**
   * @param {string} instanceName
   */
  function discloseCobaltHost(instanceName) {
    if (!_cobaltDisclosedHosts.has(instanceName)) {
      // Disclose which community host receives the watch URL (M2 hardening).
      _cobaltDisclosedHosts.add(instanceName);
      getNotificationManager()?.show?.(`${t('sourceCobalt')}: ${instanceName}`, {
        duration: NOTIFY_DURATION.SHORT,
        type: 'info',
      });
    }
  }

  /**
   * @param {CobaltInstance} instance
   * @param {Record<string, string | number>} payload
   * @param {{ onCancel?: (() => boolean) | null, onProgress?: ((p: DownloadProgress) => void) | null, onRequest?: ((r: GMRequestHandle) => void) | null, format?: string } & Record<string, unknown>} options
   * @param {string} title
   * @returns {Promise<boolean>}
   */
  async function tryCobaltInstance(
    instance,
    payload,
    { onCancel, onProgress, onRequest, format },
    title
  ) {
    const response = await gmXmlHttpRequest({
      method: 'POST',
      url: `${instance.api}/`,
      timeout: DownloadConfig.REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': DownloadConfig.HEADERS['User-Agent'],
      },
      data: JSON.stringify(payload),
    });

    if (response.status !== 200) {
      const serverMsg = extractServerErrorMessage(response);
      throw new Error(
        `Cobalt (${instance.name}) failed: ${response.status}${serverMsg ? `: ${serverMsg}` : ''}`
      );
    }

    let result;
    try {
      result = JSON.parse(String(response.responseText || ''));
    } catch (_e) {
      logS(_e);
      throw new Error(`Cobalt (${instance.name}) returned invalid JSON`);
    }

    if (result?.status === 'tunnel' && result.url) {
      if (onCancel?.()) {
        throw new Error('Download cancelled');
      }
      const blob = await downloadBlobFromUrl({
        url: String(result.url),
        converter: { referer: `${instance.api}/` },
        onProgress,
        onRequest,
      });
      if (blob.size === 0) {
        // New-tab fallback returned an empty blob; nothing more to do.
        return true;
      }
      const filename =
        String(result.filename || '') || `${title}.${format === 'audio' ? 'mp3' : 'mp4'}`;
      triggerBlobDownload(blob, sanitizeFilename(filename), 2000);
      getNotificationManager()?.show?.(t('downloadCompleted'), {
        duration: NOTIFY_DURATION.MEDIUM,
        type: 'success',
      });
      logger.debug('Cobalt download completed:', filename);
      return true;
    }

    const statusText = String(result?.text || result?.status || 'unknown response');
    throw new Error(`Cobalt (${instance.name}) error: ${statusText}`);
  }

  /**
   * Download a video/audio via a community Cobalt instance.
   *
   * Cobalt converts the YouTube link on a third-party server and returns a
   * temporary tunnel URL that we stream into a Blob. Instances are tried in
   * order; Turnstile-protected, rate-limited, or failing instances are skipped.
   *
   * @param {DownloadOptions} [options] - Download options (mirrors downloadVideo)
   * @returns {Promise<void>}
   */
  async function downloadViaCobalt(options = {}) {
    const opts = normalizeDownloadOptions(options);
    const { videoUrl, title } = initDownloadSession(opts.onCancel);
    const payload = prepareCobaltPayload(opts.format, opts.quality, opts.audioBitrate, videoUrl);

    let lastError = null;
    let attempts = 0;
    const instances = await fetchCobaltInstances();
    for (const instance of instances) {
      if (attempts >= DownloadConfig.COBALT.MAX_ATTEMPTS) break;
      if (opts.onCancel?.()) {
        throw new Error('Download cancelled');
      }
      attempts += 1;
      discloseCobaltHost(instance.name);
      try {
        const completed = await tryCobaltInstance(
          instance,
          payload,
          {
            onCancel: opts.onCancel,
            onProgress: opts.onProgress,
            onRequest: opts.onRequest,
            format: opts.format,
          },
          title
        );
        if (completed) return;
      } catch (error) {
        logS(error);
        lastError = error;
        logger.warn(
          `Cobalt instance ${instance.name} failed, trying next:`,
          (error instanceof Error ? error.message : null) || error
        );
      }
    }

    if (lastError) {
      reportDownloadError(lastError, {
        logMessage: 'Cobalt download failed:',
        failedKey: 'downloadFailed',
      });
    } else {
      throw new Error(t('noStreamAvailable'));
    }
  }

  /**
   * Fetch the mobile (ANDROID client) player response for a video.
   * The ANDROID client exposes plain (unsigned) stream URLs and muxed
   * progressive formats, which lets us download directly without a converter.
   * @param {string} videoId
   * @returns {Promise<AndroidPlayerData>}
   */
  async function fetchAndroidPlayerData(videoId) {
    const response = await gmXmlHttpRequest({
      method: 'POST',
      url: DownloadConfig.MOBILE.PLAYER_URL,
      timeout: DownloadConfig.REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': DownloadConfig.HEADERS['User-Agent'],
      },
      data: JSON.stringify({
        context: {
          client: {
            clientName: DownloadConfig.MOBILE.CLIENT_NAME,
            clientVersion: DownloadConfig.MOBILE.CLIENT_VERSION,
            androidSdkVersion: DownloadConfig.MOBILE.ANDROID_SDK_VERSION,
            hl: 'en',
            gl: 'US',
          },
        },
        videoId,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`Failed to get mobile player data: ${response.status}`);
    }

    const parsed = JSON.parse(String(response.responseText || '{}'));
    const playability = parsed?.playabilityStatus?.status || 'OK';
    if (playability !== 'OK') {
      const reason = parsed?.playabilityStatus?.reason || playability;
      throw new Error(`Mobile player: ${reason}`);
    }
    return parsed;
  }

  /**
   * Parse the vertical resolution of a YouTube format from `height` or `qualityLabel`.
   * @param {YouTubeStreamingFormat | null | undefined} format
   * @returns {number}
   */
  function parseFormatHeight(format) {
    const height = Number(format?.height);
    if (Number.isFinite(height) && height > 0) return height;
    const match = String(format?.qualityLabel || '').match(/(\d{3,4})p/i);
    return match ? Number(match[1]) : 0;
  }

  /**
   * Pick the best video format at or below maxHeight, preferring `preferCodec`.
   * Falls back to the highest available quality when nothing matches the cap.
   * @param {YouTubeStreamingFormat[]} formats
   * @param {number} maxHeight
   * @param {string} [preferCodec]
   * @returns {YouTubeStreamingFormat | null}
   */
  function pickBestVideoFormat(formats, maxHeight, preferCodec) {
    const all = (Array.isArray(formats) ? formats : []).filter(f => f?.url);
    const candidates = all.filter(f => {
      const h = parseFormatHeight(f);
      if (!h) return false;
      if (maxHeight > 0 && h > maxHeight) return false;
      if (preferCodec && !String(f.mimeType || '').includes(preferCodec)) return false;
      return true;
    });
    const pool = candidates.length ? candidates : all.filter(f => parseFormatHeight(f) > 0);
    if (!pool.length) return null;
    pool.sort((a, b) => {
      const ha = parseFormatHeight(a);
      const hb = parseFormatHeight(b);
      if (ha !== hb) return hb - ha;
      const aPref = preferCodec && String(a.mimeType || '').includes(preferCodec) ? 1 : 0;
      const bPref = preferCodec && String(b.mimeType || '').includes(preferCodec) ? 1 : 0;
      return bPref - aPref;
    });
    return pool[0] || null;
  }

  /**
   * Pick the best m4a audio format at or below maxBitrateKbps.
   * @param {YouTubeStreamingFormat[]} formats
   * @param {number} maxBitrateKbps
   * @returns {YouTubeStreamingFormat | null}
   */
  function pickBestAudioFormat(formats, maxBitrateKbps) {
    const all = (Array.isArray(formats) ? formats : []).filter(
      f =>
        f?.url &&
        String(f.mimeType || '').includes('audio/') &&
        String(f.mimeType || '').includes('mp4')
    );
    if (!all.length) return null;
    const want = Number(maxBitrateKbps) * 1000 || 0;
    const sorted = all.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    if (want > 0) {
      const match = sorted.find(f => (f.bitrate || 0) <= want);
      if (match) return match;
    }
    return sorted[0] || null;
  }

  /**
   * @param {{ allFormats: YouTubeStreamingFormat[], audioBitrate: string, baseName: string, referer: string, onProgress?: ((p: DownloadProgress) => void) | null, onRequest?: ((req: GMRequestHandle) => void) | null }} params
   * @returns {Promise<void>}
   */
  async function downloadDirectAudioStream({
    allFormats,
    audioBitrate,
    baseName,
    referer,
    onProgress,
    onRequest,
  }) {
    const target = pickBestAudioFormat(allFormats, parseInt(audioBitrate, 10));
    if (!target) {
      throw new Error(t('noStreamAvailable'));
    }
    const blob = await downloadBlobFromUrl({
      url: target.url,
      converter: { referer },
      onProgress,
      onRequest,
    });
    if (blob.size === 0) return;
    triggerBlobDownload(blob, `${baseName}.m4a`, 2000);
    getNotificationManager()?.show?.(t('downloadCompleted'), {
      duration: NOTIFY_DURATION.MEDIUM,
      type: 'success',
    });
  }

  /**
   * @param {{ progressive: YouTubeStreamingFormat[], wantQuality: number, baseName: string, referer: string, onProgress?: ((p: DownloadProgress) => void) | null, onRequest?: ((req: GMRequestHandle) => void) | null }} params
   * @returns {Promise<boolean>}
   */
  async function downloadDirectMuxedVideoStream({
    progressive,
    wantQuality,
    baseName,
    referer,
    onProgress,
    onRequest,
  }) {
    if (wantQuality > 360) return false;
    const muxed = progressive.filter(f => f?.url && String(f.mimeType || '').includes('video/'));
    if (!muxed.length) return false;
    const sorted = muxed.slice().sort((a, b) => parseFormatHeight(b) - parseFormatHeight(a));
    const target = sorted.find(f => parseFormatHeight(f) <= wantQuality) || sorted[0];
    const blob = await downloadBlobFromUrl({
      url: target.url,
      converter: { referer },
      onProgress,
      onRequest,
    });
    if (blob.size === 0) return true;
    triggerBlobDownload(blob, `${baseName}.mp4`, 2000);
    getNotificationManager()?.show?.(t('downloadCompleted'), {
      duration: NOTIFY_DURATION.MEDIUM,
      type: 'success',
    });
    return true;
  }

  /**
   * @param {{ adaptive: YouTubeStreamingFormat[], allFormats: YouTubeStreamingFormat[], wantQuality: number, baseName: string, referer: string, onProgress?: ((p: DownloadProgress) => void) | null, onRequest?: ((req: GMRequestHandle) => void) | null }} params
   * @returns {Promise<void>}
   */
  async function downloadDirectAdaptiveVideoStream({
    adaptive,
    allFormats,
    wantQuality,
    baseName,
    referer,
    onProgress,
    onRequest,
  }) {
    const videoTrack = pickBestVideoFormat(adaptive, wantQuality, 'avc1');
    if (!videoTrack) {
      throw new Error(t('noStreamAvailable'));
    }
    const videoBlob = await downloadBlobFromUrl({
      url: videoTrack.url,
      converter: { referer },
      onProgress,
      onRequest,
    });
    if (videoBlob.size === 0) return;
    triggerBlobDownload(videoBlob, `${baseName} (${t('sourceVideoNoAudio')}).mp4`, 2000);

    try {
      const audioTrack = pickBestAudioFormat(allFormats, 128);
      if (audioTrack) {
        const audioBlob = await downloadBlobFromUrl({
          url: audioTrack.url,
          converter: { referer },
          onRequest,
        });
        if (audioBlob.size > 0) {
          triggerBlobDownload(audioBlob, `${baseName} (audio).m4a`, 2000);
        }
      }
    } catch (error) {
      logS(error);
      logger.warn(
        'Companion audio download failed:',
        (error instanceof Error ? error.message : null) || error
      );
    }

    getNotificationManager()?.show?.(t('downloadCompleted'), {
      duration: NOTIFY_DURATION.MEDIUM,
      type: 'success',
    });
  }

  /**
   * Download video/audio directly from YouTube using the ANDROID client.
   *
   * The ANDROID client returns unsigned stream URLs (no signature decryption),
   * but only the 360p muxed format contains audio+video together. Higher
   * qualities download the video track only, plus a companion audio file.
   *
   * @param {DownloadOptions} [options] - Download options (mirrors downloadVideo)
   * @returns {Promise<void>}
   */
  async function downloadViaDirectStream(options = {}) {
    const opts = normalizeDownloadOptions(options);
    const { videoId, title } = initDownloadSession(opts.onCancel);
    const baseName = sanitizeFilename(title) || 'video';
    const referer = 'https://www.youtube.com/';

    try {
      const playerData = await fetchAndroidPlayerData(videoId);
      if (opts.onCancel?.()) {
        throw new Error('Download cancelled');
      }
      const streamingData = playerData?.streamingData || {};
      const progressive = Array.isArray(streamingData.formats)
        ? /** @type {YouTubeStreamingFormat[]} */ (streamingData.formats)
        : [];
      const adaptive = Array.isArray(streamingData.adaptiveFormats)
        ? /** @type {YouTubeStreamingFormat[]} */ (streamingData.adaptiveFormats)
        : [];
      const allFormats = [...progressive, ...adaptive];

      if (opts.format === 'audio') {
        await downloadDirectAudioStream({
          allFormats,
          audioBitrate: opts.audioBitrate,
          baseName,
          referer,
          onProgress: opts.onProgress,
          onRequest: opts.onRequest,
        });
        return;
      }

      const wantQuality = parseInt(opts.quality, 10) || 1080;
      const muxedDone = await downloadDirectMuxedVideoStream({
        progressive,
        wantQuality,
        baseName,
        referer,
        onProgress: opts.onProgress,
        onRequest: opts.onRequest,
      });
      if (muxedDone) return;

      await downloadDirectAdaptiveVideoStream({
        adaptive,
        allFormats,
        wantQuality,
        baseName,
        referer,
        onProgress: opts.onProgress,
        onRequest: opts.onRequest,
      });
    } catch (error) {
      logS(error);
      reportDownloadError(error, {
        logMessage: 'Error:',
        failedKey: 'downloadFailed',
      });
    }
  }

  // ============================================================================
  // DOWNLOAD QUEUE MANAGER
  // ============================================================================
  /** @type {Map<string, ActiveDownloadItem>} */
  const _activeDownloads = new Map();
  let _downloadIdCounter = 0;
  /** @type {HTMLElement|null} */
  let _managerPanel = null;
  /** @type {HTMLElement|null} */
  let _managerList = null;
  /** @type {HTMLElement|null} */
  let _managerCounter = null;

  const HISTORY_STORAGE_KEY = 'ytp-download-history';
  const HISTORY_MAX_ITEMS = 50;

  /**
   * Persist a finished download to storage history.
   * @param {ActiveDownloadItem | null | undefined} download
   * @param {string} finalStatus
   */
  function persistDownloadHistory(download, finalStatus) {
    try {
      if (!download) return;
      const raw = window.YouTubeUtils?.storage?.getItem(HISTORY_STORAGE_KEY) || '[]';
      const history = JSON.parse(raw);
      if (!Array.isArray(history)) return;

      history.unshift({
        title: download.title,
        format: download.format,
        qualityLabel: download.qualityLabel,
        status: finalStatus,
        timestamp: Date.now(),
      });

      while (history.length > HISTORY_MAX_ITEMS) history.pop();
      window.YouTubeUtils?.storage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (_e) {
      logS(_e);
      // Non-critical: history is best-effort.
    }
  }

  /**
   * Completely tear down the download manager panel and cancel any active downloads.
   * Called on SPA navigation so the queue does not outlive the page it belongs to.
   */
  function destroyManagerPanel() {
    _activeDownloads.forEach((download, _downloadId) => {
      if (!['completed', 'error', 'cancelled'].includes(download.status)) {
        download.cancelled = true;
        if (download.request && typeof download.request.abort === 'function') {
          try {
            download.request.abort();
          } catch (_e) {
            logS(_e);
            /* ignore */
          }
        }
      }
    });

    if (_managerPanel?.parentNode) {
      _managerPanel.parentNode.removeChild(_managerPanel);
    }

    _managerPanel = null;
    _managerList = null;
    _managerCounter = null;
    _activeDownloads.clear();
  }

  const MAX_QUEUE_ITEMS = 10;

  /** @type {Array<{ time: number, loaded: number }>} */
  let _speedSamples = [];
  const SPEED_WINDOW_MS = 5000;

  /**
   * Compute download speed from bytes loaded during a sliding time window.
   * @param {number} loaded
   * @returns {string}
   */
  function computeSpeed(loaded) {
    const now = Date.now();
    _speedSamples = _speedSamples.filter(sample => now - sample.time <= SPEED_WINDOW_MS);
    _speedSamples.push({ time: now, loaded });

    if (_speedSamples.length < 2) return '0 B/s';
    const first = _speedSamples[0];
    const last = _speedSamples[_speedSamples.length - 1];
    const elapsedSeconds = (last.time - first.time) / 1000;
    const deltaBytes = last.loaded - first.loaded;
    if (elapsedSeconds <= 0 || deltaBytes <= 0) return '0 B/s';
    return `${formatBytes(deltaBytes / elapsedSeconds)}/s`;
  }

  /**
   * Create or return the download manager panel.
   * @returns {HTMLElement}
   */
  function ensureManagerPanel() {
    if (_managerPanel) return /** @type {HTMLElement} */ (_managerPanel);

    const panel = createEl('div', {
      attrs: {
        class: 'yp-download-manager',
        role: 'region',
        'aria-label': t('downloadManagerTitle') || 'Downloads',
      },
    });

    const header = createEl('div', {
      attrs: { class: 'yp-download-manager-header' },
    });

    const titleWrap = createEl('div', {
      attrs: { class: 'yp-download-manager-title-wrap' },
    });

    const title = createEl('h4', {
      attrs: { class: 'yp-download-manager-title' },
      text: t('downloadManagerTitle') || 'Downloads',
    });

    const counter = createEl('span', {
      attrs: { class: 'yp-download-manager-counter' },
      text: '0',
    });

    titleWrap.appendChild(title);
    titleWrap.appendChild(counter);

    const historyBtn = createEl('button', {
      attrs: {
        type: 'button',
        class: 'yp-download-manager-history-btn',
        'aria-label': t('downloadHistory') || 'History',
        title: t('downloadHistory') || 'History',
      },
    });
    if (_setSafeHTML) {
      _setSafeHTML(
        historyBtn,
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      );
    } else {
      historyBtn.textContent = '🕒';
    }
    window.YouTubePlusCleanupManager?.registerListener?.(
      historyBtn,
      'click',
      toggleHistoryPanel,
      undefined,
      false
    );

    const closeBtn = createEl('button', {
      attrs: {
        type: 'button',
        class: 'yp-download-manager-close',
        'aria-label': t('close') || 'Close',
        title: t('close') || 'Close',
      },
    });
    if (_setSafeHTML) {
      _setSafeHTML(
        closeBtn,
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
      );
    } else {
      closeBtn.textContent = '×';
    }
    window.YouTubePlusCleanupManager?.registerListener?.(
      closeBtn,
      'click',
      hideDownloadManager,
      undefined,
      false
    );

    header.appendChild(titleWrap);
    header.appendChild(historyBtn);
    header.appendChild(closeBtn);

    const list = createEl('div', {
      attrs: { class: 'yp-download-manager-list' },
    });

    panel.appendChild(header);
    panel.appendChild(list);

    document.body.appendChild(panel);

    _managerPanel = panel;
    _managerList = list;
    _managerCounter = counter;

    try {
      // Animate in on next frame
      window.YouTubePlusCleanupManager?.registerAnimationFrame?.(
        requestAnimationFrame(() => panel.classList.add('visible'))
      );
    } catch (_e) {
      logS(_e);
      panel.classList.add('visible');
    }

    return panel;
  }

  /**
   * Show the download manager panel.
   */
  function showDownloadManager() {
    ensureManagerPanel();
    _managerPanel?.classList.add('visible');
  }

  /**
   * Hide the download manager panel.
   */
  function hideDownloadManager() {
    _managerPanel?.classList.remove('visible');
  }

  /**
   * Toggle the history sub-panel inside the manager.
   */
  function toggleHistoryPanel() {
    if (!_managerPanel) return;
    let historyPanel = _managerPanel.querySelector('.yp-download-manager-history');
    if (historyPanel) {
      historyPanel.remove();
      return;
    }

    historyPanel = createEl('div', {
      attrs: { class: 'yp-download-manager-history' },
    });

    const title = createEl('div', {
      attrs: { class: 'yp-download-manager-history-title' },
      text: t('downloadHistory') || 'Recent downloads',
    });
    historyPanel.appendChild(title);

    const list = createEl('div', {
      attrs: { class: 'yp-download-manager-history-list' },
    });

    const history = loadDownloadHistory();
    if (history.length === 0) {
      const empty = createEl('div', {
        attrs: { class: 'yp-download-manager-history-empty' },
        text: t('downloadHistoryEmpty') || 'No recent downloads',
      });
      list.appendChild(empty);
    } else {
      history.forEach(entry => {
        const row = createEl('div', {
          attrs: { class: 'yp-download-manager-history-item' },
        });

        const nameText =
          entry.title || `${entry.format}.${entry.format === 'video' ? 'mp4' : 'mp3'}`;
        const name = createEl('span', {
          attrs: {
            class: 'yp-download-manager-history-name',
            title: nameText,
          },
          text: nameText,
        });

        const meta = createEl('span', {
          attrs: { class: 'yp-download-manager-history-meta' },
          text: `${entry.qualityLabel} • ${new Date(entry.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}`,
        });

        const status = createEl('span', {
          attrs: {
            class: `yp-download-manager-history-status status-${entry.status}`,
          },
          text: entry.status,
        });

        row.appendChild(name);
        row.appendChild(meta);
        row.appendChild(status);
        list.appendChild(row);
      });
    }

    historyPanel.appendChild(list);
    _managerPanel.appendChild(historyPanel);
  }

  /**
   * Load persisted download history from storage.
   * @returns {DownloadHistoryEntry[]}
   */
  function loadDownloadHistory() {
    try {
      const raw = window.YouTubeUtils?.storage?.getItem(HISTORY_STORAGE_KEY) || '[]';
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      logS(_e);
      return [];
    }
  }

  /**
   * Update the active-download counter badge.
   */
  function updateManagerCounter() {
    if (!_managerCounter) return;
    const activeCount = Array.from(_activeDownloads.values()).filter(
      d => !['completed', 'error', 'cancelled'].includes(d.status)
    ).length;
    _managerCounter.textContent = String(activeCount);
  }

  /**
   * Remove a completed/error/cancelled item after a short delay.
   * @param {string} downloadId
   * @param {number} [delayMs]
   */
  function scheduleRemoveItem(downloadId, delayMs = 3000) {
    setTimeout_(() => {
      removeDownloadItem(downloadId);
    }, delayMs);
  }

  /**
   * Remove item DOM and state.
   * @param {string} downloadId
   */
  function removeDownloadItem(downloadId) {
    const download = _activeDownloads.get(downloadId);
    if (download?.request && typeof download.request.abort === 'function') {
      try {
        download.request.abort();
      } catch (_e) {
        logS(_e);
        /* ignore */
      }
    }

    const item = document.getElementById(`yp-download-item-${downloadId}`);
    if (item?.parentNode) {
      item.classList.add('removing');
      setTimeout_(() => {
        item.parentNode?.removeChild(item);
      }, 250);
    }

    _activeDownloads.delete(downloadId);
    updateManagerCounter();

    if (_activeDownloads.size === 0) {
      hideDownloadManager();
    }
  }

  /**
   * Cancel an active download.
   * @param {string} downloadId
   */
  function cancelDownload(downloadId) {
    const download = _activeDownloads.get(downloadId);
    if (!download || ['completed', 'error', 'cancelled'].includes(download.status)) return;

    download.status = 'cancelled';
    download.cancelled = true;

    if (download.request && typeof download.request.abort === 'function') {
      try {
        download.request.abort();
      } catch (_e) {
        logS(_e);
        /* ignore */
      }
    }

    persistDownloadHistory(download, 'cancelled');
    updateDownloadItem(downloadId, 'cancelled', t('downloadCancelled') || 'Cancelled', null, null);
    scheduleRemoveItem(downloadId, 1000);
  }

  /**
   * Create a download item element for the manager.
   * @param {string} downloadId
   * @param {string} title
   * @param {string} format
   * @param {string} qualityLabel
   * @returns {HTMLElement}
   */
  function createDownloadItem(downloadId, title, format, qualityLabel) {
    const item = createEl('div', {
      attrs: {
        class: 'yp-download-manager-item',
        id: `yp-download-item-${downloadId}`,
      },
    });

    const header = createEl('div', {
      attrs: { class: 'yp-download-manager-item-header' },
    });

    const filenameText = title || `${format}.${format === 'video' ? 'mp4' : 'mp3'}`;
    const filename = createEl('div', {
      attrs: {
        class: 'yp-download-manager-item-filename',
        title: filenameText,
      },
      text: filenameText,
    });

    const cancelBtn = createEl('button', {
      attrs: {
        type: 'button',
        class: 'yp-download-manager-item-cancel',
        'aria-label': t('cancel') || 'Cancel',
        title: t('cancel') || 'Cancel',
      },
    });
    if (_setSafeHTML) {
      _setSafeHTML(
        cancelBtn,
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>'
      );
    } else {
      cancelBtn.textContent = '×';
    }
    window.YouTubePlusCleanupManager?.registerListener?.(
      cancelBtn,
      'click',
      () => cancelDownload(downloadId),
      undefined,
      false
    );

    header.appendChild(filename);
    header.appendChild(cancelBtn);

    const meta = createEl('div', {
      attrs: { class: 'yp-download-manager-item-meta' },
    });

    const formatBadge = createEl('span', {
      attrs: {
        class: `yp-download-manager-item-badge ${format === 'video' ? 'badge-video' : 'badge-audio'}`,
      },
      text: format === 'video' ? t('videoBadge') || 'VIDEO' : t('audioBadge') || 'AUDIO',
    });

    const qualityBadge = createEl('span', {
      attrs: { class: 'yp-download-manager-item-badge badge-quality' },
      text: qualityLabel,
    });

    meta.appendChild(formatBadge);
    meta.appendChild(qualityBadge);

    const progressWrap = createEl('div', {
      attrs: { class: 'yp-download-manager-item-progress' },
    });

    const progressBar = createEl('div', {
      attrs: { class: 'yp-download-manager-item-progress-bar' },
    });

    const progressFill = createEl('div', {
      attrs: { class: 'yp-download-manager-item-progress-fill' },
      style: { width: '0%' },
    });

    progressBar.appendChild(progressFill);
    progressWrap.appendChild(progressBar);

    const info = createEl('div', {
      attrs: { class: 'yp-download-manager-item-info' },
      text: `${t('starting') || 'Starting...'} • 0 B/s`,
    });

    item.appendChild(header);
    item.appendChild(meta);
    item.appendChild(progressWrap);
    item.appendChild(info);

    return item;
  }

  /**
   * Update existing download item UI.
   * @param {string} downloadId
   * @param {string} status
   * @param {string} details
   * @param {?string} [sizeText]
   * @param {?string} [speedText]
   */
  function updateDownloadItem(downloadId, status, details, sizeText, speedText) {
    const item = document.getElementById(`yp-download-item-${downloadId}`);
    const download = _activeDownloads.get(downloadId);
    if (!(item && download)) return;

    download.status = status.toLowerCase().replace(/\s+/g, '-');

    const info = item.querySelector('.yp-download-manager-item-info');
    if (info) {
      const parts = [details];
      if (sizeText) parts.push(sizeText);
      if (speedText) parts.push(speedText);
      info.textContent = parts.filter(Boolean).join(' • ');
    }

    if (status.toLowerCase() === 'completed') {
      item.classList.add('completed');
      const cancelBtn = item.querySelector('.yp-download-manager-item-cancel');
      if (cancelBtn) {
        if (_setSafeHTML) {
          const successIcon = createEl('span', {
            attrs: { class: 'yp-download-status-icon success' },
          });
          _setSafeHTML(
            successIcon,
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
          );
          cancelBtn.replaceWith(successIcon);
        } else {
          cancelBtn.remove();
        }
      }
      persistDownloadHistory(download, 'completed');
      scheduleRemoveItem(downloadId, 3000);
    }

    if (status.toLowerCase() === 'error') {
      item.classList.add('error');
      persistDownloadHistory(download, 'error');
      scheduleRemoveItem(downloadId, 5000);
    }

    updateManagerCounter();
  }

  /**
   * Update download progress UI (percent + size + speed).
   * @param {string} downloadId
   * @param {DownloadProgress | null | undefined} progress
   * @param {number} _startTime
   */
  function updateDownloadProgress(downloadId, progress, _startTime) {
    const item = document.getElementById(`yp-download-item-${downloadId}`);
    if (!item) return;

    const loaded = Number(progress?.loaded || 0);
    const total = Number(progress?.total || 0);
    const hasTotal = Number.isFinite(total) && total > 0;

    const fill = /** @type {HTMLElement | null} */ (
      item.querySelector('.yp-download-manager-item-progress-fill')
    );
    if (fill) {
      const percent = hasTotal
        ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100)))
        : Math.min(95, Math.max(5, Math.round(Math.log2(loaded + 1) * 4)));
      fill.style.width = `${percent}%`;
    }

    const sizeText = hasTotal
      ? `${formatBytes(loaded)} / ${formatBytes(total)}`
      : `${formatBytes(loaded)} / ${t('unknownSize') || '—'}`;
    const speedText = computeSpeed(loaded);
    const detail = hasTotal
      ? `${Math.round((loaded / total) * 100)}%`
      : t('downloading') || 'Downloading';

    updateDownloadItem(downloadId, 'downloading', detail, sizeText, speedText);
  }

  /**
   * Add a new download to the manager.
   * @param {string} title
   * @param {string} format
   * @param {string} qualityLabel
   * @returns {string} downloadId
   */
  function addDownloadToManager(title, format, qualityLabel) {
    const activeCount = Array.from(_activeDownloads.values()).filter(
      d => !['completed', 'error', 'cancelled'].includes(d.status)
    ).length;

    if (activeCount >= MAX_QUEUE_ITEMS) {
      getNotificationManager()?.show?.(t('downloadQueueFull') || 'Download queue is full', {
        duration: NOTIFY_DURATION.MEDIUM,
        type: 'warning',
      });
      throw new Error('Download queue is full');
    }

    const downloadId = `dl_${++_downloadIdCounter}_${Date.now()}`;

    _activeDownloads.set(downloadId, {
      id: downloadId,
      title,
      format,
      qualityLabel,
      status: 'initializing',
      startTime: Date.now(),
      cancelled: false,
      request: null,
    });

    ensureManagerPanel();
    const item = createDownloadItem(downloadId, title, format, qualityLabel);
    _managerList?.insertBefore(item, _managerList.firstChild);
    showDownloadManager();
    updateManagerCounter();

    return downloadId;
  }

  /**
   * @param {EnqueueDownloadOptions} options
   * @param {string} downloadId
   * @returns {EnqueueDownloadOptions & DownloadOptions}
   */
  function createWrappedDownloadOptions(options, downloadId) {
    return {
      ...options,
      onCancel: () => {
        const dl = _activeDownloads.get(downloadId);
        return !!dl?.cancelled;
      },
      onProgress: (/** @type {unknown} */ progress) => {
        updateDownloadProgress(
          downloadId,
          /** @type {DownloadProgress} */ (progress),
          _activeDownloads.get(downloadId)?.startTime || Date.now()
        );
        if (options.onProgress) options.onProgress(/** @type {DownloadProgress} */ (progress));
      },
      onRequest: (/** @type {unknown} */ request) => {
        const dl = _activeDownloads.get(downloadId);
        if (dl) dl.request = /** @type {GMRequestHandle} */ (request);
        if (options.onRequest) options.onRequest(/** @type {GMRequestHandle} */ (request));
      },
    };
  }

  /**
   * @param {EnqueueDownloadOptions & DownloadOptions} wrappedOptions
   * @returns {Promise<void>}
   */
  async function executeDownloadWithFallbackSources(wrappedOptions) {
    const source = String(wrappedOptions.source || DownloadConfig.SOURCES.CNVCX);
    /** @type {Record<string, (opts: DownloadOptions) => Promise<void>>} */
    const sourceFns = {
      [DownloadConfig.SOURCES.COBALT]: downloadViaCobalt,
      [DownloadConfig.SOURCES.MOBILE]: downloadViaDirectStream,
      [DownloadConfig.SOURCES.CNVCX]: downloadVideo,
    };
    const fallbackOrder = [
      source,
      ...Object.values(DownloadConfig.SOURCES).filter(s => s !== source),
    ];
    let lastSourceError = null;
    for (let i = 0; i < fallbackOrder.length; i++) {
      const src = fallbackOrder[i];
      const fn = sourceFns[src];
      if (!fn) continue;
      if (wrappedOptions.onCancel?.()) {
        throw new Error('Download cancelled');
      }
      try {
        if (i > 0) {
          getNotificationManager()?.show?.(
            `${translatedOr('retryingWithSource', 'Retrying with another source')}…`,
            { duration: NOTIFY_DURATION.SHORT, type: 'info' }
          );
        }
        await fn(wrappedOptions);
        return;
      } catch (fnError) {
        logS(fnError);
        lastSourceError = fnError;
        const fnMsg = fnError instanceof Error ? fnError.message : String(fnError);
        if (fnMsg.toLowerCase().includes('cancel')) {
          throw fnError;
        }
        logger.warn(`Download source "${src}" failed, trying next fallback:`, fnMsg);
      }
    }
    throw lastSourceError || new Error(t('downloadFailed') || 'Download failed');
  }

  /**
   * @param {unknown} err
   * @param {string} downloadId
   * @param {EnqueueDownloadOptions} options
   */
  function handleEnqueueDownloadError(err, downloadId, options) {
    logS(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('cancel')) {
      updateDownloadItem(
        downloadId,
        'cancelled',
        t('downloadCancelled') || 'Cancelled',
        null,
        null
      );
      scheduleRemoveItem(downloadId, 1000);
    } else {
      updateDownloadItem(
        downloadId,
        'error',
        `${t('downloadFailed') || 'Failed'} ${msg}`,
        null,
        null
      );
    }
    if (options.onComplete) options.onComplete();
  }

  /**
   * Enqueue a media download and wire it to the manager.
   * This is the queue-aware wrapper around downloadVideo().
   * @param {EnqueueDownloadOptions} options
   * @returns {Promise<void>}
   */
  async function enqueueDownload(options) {
    const title = getVideoTitle();
    const format = options.format || DownloadConfig.DEFAULTS.format;
    const qualityLabel =
      format === 'video'
        ? `${options.quality || DownloadConfig.DEFAULTS.videoQuality}p`
        : `${options.audioBitrate || DownloadConfig.DEFAULTS.audioBitrate} kbps`;

    let downloadId;
    try {
      downloadId = addDownloadToManager(title, format, qualityLabel);
    } catch (error) {
      logS(error);
      logger.warn(
        'Failed to add download to manager:',
        (error instanceof Error ? error.message : null) || error
      );
      throw error;
    }

    const wrappedOptions = createWrappedDownloadOptions(options, downloadId);

    try {
      updateDownloadItem(
        downloadId,
        'initializing',
        t('startingDownload') || 'Starting download...',
        null,
        null
      );
      await executeDownloadWithFallbackSources(wrappedOptions);
      updateDownloadItem(
        downloadId,
        'completed',
        t('downloadCompleted') || 'Completed',
        null,
        null
      );
      if (options.onComplete) options.onComplete();
    } catch (err) {
      logS(err);
      handleEnqueueDownloadError(err, downloadId, options);
      throw err;
    }
  }

  /**
   * Initialize module
   * This module doesn't create any UI, just exposes the API
   */
  // --- Modal UI for Direct Download (lightweight, self-contained) ---
  /** @type {({ overlay: HTMLElement, box: HTMLElement } & ModalFormParts) | null} */
  let _modalElements = null;

  /**
   * @param {string} [rawText]
   * @returns {{ title: string, subtitle: string }}
   */
  function parseTabLabel(rawText) {
    const match = (rawText || '').match(/^(.*?)\s*(\(.*?\))?$/);
    const title = match?.[1] ? match[1].trim() : rawText || '';
    const subtitle = match?.[2] ? match[2].replace(/[()]/g, '').trim() : '';
    return { title, subtitle };
  }

  /**
   * @param {string} format
   * @param {string} [rawText]
   * @returns {HTMLElement}
   */
  function createTabButton(format, rawText) {
    const { title, subtitle } = parseTabLabel(rawText);
    const btn = /** @type {HTMLButtonElement} */ (
      createEl('button', {
        attrs: {
          type: 'button',
          role: 'tab',
          'aria-selected': 'false',
          class: 'yp-download-modal-tab',
          'data-format': format,
        },
      })
    );
    const titleEl = createEl('span', {
      attrs: { class: 'yp-download-tab-title' },
      text: title,
    });
    btn.appendChild(titleEl);
    if (subtitle) {
      const subEl = createEl('span', {
        attrs: { class: 'yp-download-tab-sub' },
        text: subtitle,
      });
      btn.appendChild(subEl);
    }
    return btn;
  }

  function createTabButtons(/** @type {(format: string) => void} */ onTabChange) {
    const tabContainer = createEl('div', {
      attrs: { role: 'tablist', class: 'yp-download-modal-tabs' },
    });

    const videoTab = createTabButton('video', t('videoTab'));
    const audioTab = createTabButton('audio', t('audioTab'));
    const subTab = createTabButton('subtitle', t('subtitleTab'));

    function setActive(/** @type {HTMLElement} */ btn) {
      [videoTab, audioTab, subTab].forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      try {
        onTabChange(btn.dataset.format || '');
      } catch (_e) {
        logS(_e);
        // ignore - avoids visual glitches if consumer manipulates DOM before it's fully appended
      }
    }

    [videoTab, audioTab, subTab].forEach(btn => {
      window.YouTubePlusCleanupManager?.registerListener?.(
        btn,
        'click',
        () => {
          setActive(btn);
          btn?.blur?.();
        },
        undefined,
        false
      );
    });

    tabContainer.appendChild(videoTab);
    tabContainer.appendChild(audioTab);
    tabContainer.appendChild(subTab);

    window.YouTubePlusCleanupManager?.registerListener?.(
      tabContainer,
      'keydown',
      (/** @type {KeyboardEvent} */ e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const tabs = [videoTab, audioTab, subTab];
        const idx = tabs.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
        if (idx < 0) return;
        e.preventDefault();
        const next =
          e.key === 'ArrowRight'
            ? tabs[(idx + 1) % tabs.length]
            : tabs[(idx - 1 + tabs.length) % tabs.length];
        next.focus();
        next.click();
      },
      undefined,
      false
    );

    setTimeout(() => setActive(videoTab), 0);

    return tabContainer;
  }

  /**
   * @param {HTMLButtonElement[]} group
   * @param {string} activeValue
   * @param {(value: string) => void} [onChange]
   */
  const applyPillSelection = (group, activeValue, onChange) => {
    group.forEach(btn => {
      const isActive = btn.dataset.value === activeValue;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    if (onChange) onChange(activeValue);
  };

  /**
   * @param {string} value
   * @param {string} label
   * @param {string} [sizeClass]
   * @returns {HTMLButtonElement}
   */
  const createPillButton = (value, label, sizeClass = '') =>
    /** @type {HTMLButtonElement} */ (
      createEl('button', {
        attrs: {
          type: 'button',
          role: 'radio',
          'aria-checked': 'false',
          'data-value': value,
          class: `yp-download-pill${sizeClass ? ` ${sizeClass}` : ''}`,
        },
        text: label,
      })
    );

  function buildModalForm() {
    const qualitySelect = /** @type {HTMLElement & { value?: string, disabled?: boolean }} */ (
      createEl('div', {
        attrs: { class: 'yp-download-quality', role: 'radiogroup' },
      })
    );
    qualitySelect.value = DownloadConfig.DEFAULTS.videoQuality;

    const embedCheckbox = /** @type {HTMLInputElement} */ (
      createEl('input', {
        attrs: { type: 'checkbox' },
      })
    );
    embedCheckbox.checked = DownloadConfig.DEFAULTS.embedThumbnail;

    const embedLabel = /** @type {HTMLLabelElement} */ (
      createEl('label', {
        attrs: { class: 'yp-download-embed-label' },
      })
    );
    embedLabel.appendChild(embedCheckbox);
    embedLabel.appendChild(document.createTextNode(t('embedThumbnail')));

    const subtitleWrapper = /** @type {HTMLDivElement} */ (
      createEl('div', {
        attrs: { class: 'yp-download-subtitle-wrapper' },
      })
    );

    const subtitleSelect = createSubtitleSelect();

    const formatSelect = /** @type {HTMLElement & { value?: string }} */ (
      createEl('div', {
        attrs: { class: 'yp-download-select-wrap', role: 'radiogroup' },
      })
    );
    formatSelect.value = 'srt';
    /** @type {HTMLButtonElement[]} */
    const fmtButtons = [];
    ['srt', 'txt', 'xml'].forEach((/** @type {string} */ fmt) => {
      const btn = createPillButton(fmt, fmt.toUpperCase(), 'small');
      fmtButtons.push(btn);
      window.YouTubePlusCleanupManager?.registerListener?.(
        btn,
        'click',
        () => {
          formatSelect.value = fmt;
          applyPillSelection(fmtButtons, fmt);
        },
        undefined,
        false
      );
      formatSelect.appendChild(btn);
    });
    applyPillSelection(fmtButtons, 'srt');

    subtitleWrapper.appendChild(subtitleSelect);
    subtitleWrapper.appendChild(formatSelect);

    const cancelBtn = /** @type {HTMLButtonElement} */ (
      createEl('button', {
        attrs: { type: 'button', class: 'yp-download-btn' },
        text: t('cancel'),
      })
    );

    const downloadBtn = /** @type {HTMLButtonElement} */ (
      createEl('button', {
        attrs: { type: 'button', class: 'yp-download-btn primary' },
        text: t('download'),
      })
    );

    const progressWrapper = /** @type {HTMLDivElement} */ (
      createEl('div', {
        attrs: { class: 'yp-download-progress' },
      })
    );

    const progressBar = /** @type {HTMLDivElement} */ (
      createEl('div', {
        attrs: { class: 'yp-download-progress-bar' },
      })
    );

    const progressFill = /** @type {HTMLDivElement} */ (
      createEl('div', {
        attrs: { class: 'yp-download-progress-fill' },
      })
    );

    progressBar.appendChild(progressFill);

    const progressText = /** @type {HTMLDivElement} */ (
      createEl('div', {
        attrs: { class: 'yp-download-progress-text' },
      })
    );

    progressWrapper.appendChild(progressBar);
    progressWrapper.appendChild(progressText);

    const sourceWrap = /** @type {HTMLDivElement} */ (
      createEl('div', {
        attrs: { class: 'yp-download-source-wrap' },
      })
    );
    const sourceSelect = /** @type {HTMLElement & { value?: string }} */ (
      createEl('div', {
        attrs: {
          class: 'yp-download-select-wrap yp-download-source-select',
          role: 'radiogroup',
        },
      })
    );
    sourceSelect.value = DownloadConfig.SOURCES.CNVCX;
    /** @type {HTMLButtonElement[]} */
    const sourceButtons = [];
    const sourceOptions = [
      { key: DownloadConfig.SOURCES.CNVCX, label: t('sourceCnvCx') },
      { key: DownloadConfig.SOURCES.COBALT, label: t('sourceCobalt') },
      { key: DownloadConfig.SOURCES.MOBILE, label: t('sourceMobile') },
    ];
    sourceOptions.forEach((/** @type {{ key: string, label: string }} */ sourceOption) => {
      const btn = createPillButton(
        sourceOption.key,
        sourceOption.label,
        'small yp-download-source-btn'
      );
      btn.dataset.source = sourceOption.key;
      sourceButtons.push(btn);
      sourceSelect.appendChild(btn);
    });
    applyPillSelection(sourceButtons, DownloadConfig.SOURCES.CNVCX);
    sourceWrap.appendChild(sourceSelect);

    const sourceHint = /** @type {HTMLDivElement} */ (
      createEl('div', {
        attrs: { class: 'yp-download-source-hint' },
        text: t('sourceMobileHint'),
      })
    );
    sourceWrap.appendChild(sourceHint);

    const classicSourceSelect = /** @type {HTMLSelectElement} */ (
      createEl('select', {
        attrs: {
          class: 'yp-download-classic-source-select',
          'aria-label': t('source') || 'Source',
        },
      })
    );
    sourceOptions.forEach((/** @type {{ key: string, label: string }} */ sourceOption) => {
      const opt = /** @type {HTMLOptionElement} */ (
        createEl('option', {
          attrs: { value: sourceOption.key },
          text: sourceOption.label,
        })
      );
      classicSourceSelect.appendChild(opt);
    });
    classicSourceSelect.value = DownloadConfig.SOURCES.CNVCX;

    return {
      qualitySelect,
      embedLabel,
      subtitleWrapper,
      subtitleSelect,
      formatSelect,
      cancelBtn,
      downloadBtn,
      progressWrapper,
      progressFill,
      progressText,
      sourceWrap,
      sourceSelect,
      sourceButtons,
      sourceHint,
      classicSourceSelect,
    };
  }

  /**
   * Disable form controls during download
   * @param {Record<string, unknown>} formParts - Form elements
   */
  function disableFormControls(formParts) {
    const q = /** @type {{ disabled?: boolean } | undefined} */ (formParts.qualitySelect);
    if (q) q.disabled = true;
    const d = /** @type {HTMLButtonElement | undefined} */ (formParts.downloadBtn);
    if (d) {
      d.disabled = true;
      d.style.opacity = '0.5';
      d.style.cursor = 'not-allowed';
    }
    const c = /** @type {HTMLButtonElement | undefined} */ (formParts.cancelBtn);
    if (c) c.disabled = true;
  }

  /**
   * Enable form controls after download
   * @param {Record<string, unknown>} formParts - Form elements
   */
  function enableFormControls(formParts) {
    const q = /** @type {{ disabled?: boolean } | undefined} */ (formParts.qualitySelect);
    if (q) q.disabled = false;
    const d = /** @type {HTMLButtonElement | undefined} */ (formParts.downloadBtn);
    if (d) d.disabled = false;
    const c = /** @type {HTMLButtonElement | undefined} */ (formParts.cancelBtn);
    if (c) c.disabled = false;

    // Reset button styles to ensure they're clickable
    if (d) {
      d.style.opacity = '1';
      d.style.cursor = 'pointer';
      d.style.pointerEvents = 'auto';
    }
  }

  /**
   * Initialize progress display
   * @param {Record<string, unknown>} formParts - Form elements
   */
  function initializeProgress(formParts) {
    const pw = /** @type {HTMLElement} */ (formParts.progressWrapper);
    const pf = /** @type {HTMLElement} */ (formParts.progressFill);
    const pt = /** @type {HTMLElement} */ (formParts.progressText);
    pw.style.display = '';
    pf.style.width = '0%';
    pt.textContent = t('starting');
  }

  /**
   * Handle subtitle download
   * @param {Record<string, unknown>} formParts - Form elements
   * @param {() => Record<string, unknown>} getSubtitlesData - Function to get subtitles data
   */
  async function handleSubtitleDownload(formParts, getSubtitlesData) {
    const subtitlesData = /** @type {{ all?: Array<Record<string, unknown>> }} */ (
      getSubtitlesData()
    );
    const sel = /** @type {{ value: string }} */ (formParts.subtitleSelect);
    const selectedIndex = parseInt(sel.value, 10);
    const subtitle = subtitlesData.all?.[selectedIndex];
    const fmtSel = /** @type {{ value: string }} */ (formParts.formatSelect);
    const subtitleFormat = fmtSel.value;

    if (!subtitle) {
      throw new Error(t('noSubtitleSelected'));
    }

    const videoId = getVideoId() || '';
    // For auto-translated subtitles, use the source track language as the primary
    // languageCode (for timedtext API `lang` param) and the target as `translateTo`.
    const effectiveLanguageCode = String(
      subtitle.sourceLanguageCode || subtitle.languageCode || ''
    );
    const effectiveTranslateTo = subtitle.translateTo ? String(subtitle.translateTo) : null;
    await downloadSubtitle({
      videoId,
      url: String(subtitle.baseUrl || subtitle.url || ''),
      languageCode: effectiveLanguageCode,
      languageName: String(subtitle.name || ''),
      isAutoGenerated: !!subtitle.isAutoGenerated,
      format: subtitleFormat,
      translateTo: effectiveTranslateTo,
      trackId: String(subtitle.trackId || ''),
    });
  }

  /**
   * Handle video/audio download
   * @param {Record<string, unknown>} formParts - Form elements
   * @param {string} format - Download format
   */
  async function handleMediaDownload(formParts, format) {
    const srcSel = /** @type {{ value?: string } | undefined} */ (formParts.sourceSelect);
    const qSel = /** @type {{ value: string }} */ (formParts.qualitySelect);
    const pw = /** @type {HTMLElement} */ (formParts.progressWrapper);
    const pf = /** @type {HTMLElement} */ (formParts.progressFill);
    const pt = /** @type {HTMLElement} */ (formParts.progressText);
    void pw;
    const opts = {
      format,
      source: srcSel?.value || DownloadConfig.SOURCES.CNVCX,
      quality: qSel.value,
      audioBitrate: qSel.value,
      embedThumbnail: format === 'audio' && srcSel?.value === DownloadConfig.SOURCES.CNVCX,
      onProgress: (/** @type {DownloadProgress} */ p) => {
        const loaded = Number(p?.loaded || 0);
        const total = Number(p?.total || 0);
        const hasTotal = Number.isFinite(total) && total > 0;
        let percent = Number(p?.percent || 0);

        if (hasTotal) {
          percent = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
        } else {
          // Indeterminate progress fallback for servers that don't send content-length.
          percent = Math.min(95, Math.max(5, Math.round(Math.log2(loaded + 1) * 4)));
        }

        pf.style.width = `${percent}%`;
        pt.textContent = hasTotal
          ? `${percent}% • ${formatBytes(loaded)} / ${formatBytes(total)}`
          : `${t('downloading')} • ${formatBytes(loaded)} / —`;
      },
      onComplete: () => {
        // The modal's inline progress is driven by the queue manager; re-enable
        // controls only after this specific download leaves the active queue.
        enableFormControls(formParts);
      },
    };

    await enqueueDownload(opts);
  }

  /**
   * Complete download and close modal
   * @param {Record<string, unknown>} formParts - Form elements
   */
  function completeDownload(formParts) {
    const pt = /** @type {HTMLElement} */ (formParts.progressText);
    pt.textContent = t('completed');
    setTimeout(() => closeModal(), 800);
  }

  /**
   * Handle download error
   * @param {Record<string, unknown>} formParts - Form elements
   * @param {Error} err - Error object
   */
  function handleDownloadError(formParts, err) {
    const errorMsg = err?.message || 'Unknown error';
    const pt = /** @type {HTMLElement} */ (formParts.progressText);
    pt.textContent = `${t('downloadFailed')} ${errorMsg}`;
    pt.style.color = 'var(--yt-danger-text)';

    // Ensure controls are re-enabled even if something goes wrong
    enableFormControls(formParts);

    // Add a safety timeout to force re-enable after 500ms
    setTimeout_(() => {
      enableFormControls(formParts);
    }, 500);

    // Reset progress text color after 3 seconds
    setTimeout_(() => {
      pt.style.color = '#fff';
    }, 3000);
  }

  /**
   * @param {Record<string, unknown>} formParts
   * @param {() => string} activeFormatGetter
   * @param {() => Record<string, unknown>} getSubtitlesData
   */
  function wireModalEvents(formParts, activeFormatGetter, getSubtitlesData) {
    const c = /** @type {HTMLElement} */ (formParts.cancelBtn);
    const d = /** @type {HTMLButtonElement} */ (formParts.downloadBtn);
    window.YouTubePlusCleanupManager?.registerListener?.(
      c,
      'click',
      () => closeModal(),
      undefined,
      false
    );

    window.YouTubePlusCleanupManager?.registerListener?.(
      d,
      'click',
      async () => {
        // Prevent multiple simultaneous downloads
        if (d.disabled) return;

        disableFormControls(formParts);
        initializeProgress(formParts);

        const format = activeFormatGetter();

        try {
          if (format === 'subtitle') {
            await handleSubtitleDownload(formParts, getSubtitlesData);
          } else {
            await handleMediaDownload(formParts, format);
          }
          completeDownload(formParts);
        } catch (err) {
          logS(err);
          logger.error('Download error', err);
          handleDownloadError(formParts, /** @type {Error} */ (err));
        }
      },
      undefined,
      false
    );
  }

  /**
   * Load subtitles into the provided form parts and fill subtitlesData
   * Separated from createModalUI to reduce function length for linting.
   * @param {Record<string, unknown>} formParts
   * @param {Record<string, unknown>} subtitlesData
   */
  async function loadSubtitlesForForm(formParts, subtitlesData) {
    const videoId = getVideoId();
    if (!videoId) return;

    const sel =
      /** @type {Record<string, unknown> & { setPlaceholder: (s: string) => void, setOptions: (opts: unknown) => void, disabled?: boolean }} */ (
        formParts.subtitleSelect
      );
    sel.setPlaceholder(t('loading'));
    sel.disabled = true;

    try {
      const data = await getSubtitles(videoId);
      if (!data) {
        sel.setPlaceholder(t('noSubtitles'));
        return;
      }

      subtitlesData.original = data.subtitles;
      subtitlesData.translated = data.autoTransSubtitles.map(
        (/** @type {SubtitleTrack} */ autot) => ({
          ...autot,
          url: autot.url || (autot.baseUrl ? buildSubtitleUrl(String(autot.baseUrl)) : ''),
          translateTo: autot.languageCode,
        })
      );
      subtitlesData.all = [
        .../** @type {unknown[]} */ (subtitlesData.original),
        .../** @type {unknown[]} */ (subtitlesData.translated),
      ];

      if (/** @type {unknown[]} */ (subtitlesData.all).length === 0) {
        sel.setPlaceholder(t('noSubtitles'));
        return;
      }

      const opts = /** @type {Array<Record<string, unknown>>} */ (subtitlesData.all).map(
        (sub, idx) => ({
          value: idx,
          text: String(sub.name) + (sub.translateTo ? t('autoTranslateSuffix') : ''),
        })
      );
      sel.setOptions(opts);
      sel.disabled = false;
    } catch (err) {
      logS(err);
      logger.error('Failed to load subtitles:', err);
      sel.setPlaceholder(t('subtitleLoadError'));
    }
  }

  /**
   * @param {string} val
   * @param {string} label
   * @param {HTMLButtonElement[]} buttonsList
   * @param {HTMLElement & { value?: string }} qualitySelect
   * @returns {HTMLButtonElement}
   */
  function attachQualityPillButton(val, label, buttonsList, qualitySelect) {
    const btn = createPillButton(val, label);
    buttonsList.push(btn);
    window.YouTubePlusCleanupManager?.registerListener?.(
      btn,
      'click',
      () => {
        qualitySelect.value = val;
        applyPillSelection(buttonsList, val);
      },
      undefined,
      false
    );
    return btn;
  }

  /**
   * @param {ModalFormParts} formParts
   * @param {string} renderToken
   * @param {string} activeFormat
   */
  function renderCnvQualityOptions(formParts, renderToken, activeFormat) {
    const videoId = getVideoId() || '';

    const loadingLabel = document.createElement('div');
    loadingLabel.className = 'dl-quality-loading';
    loadingLabel.textContent = t('loading');
    formParts.qualitySelect.appendChild(loadingLabel);

    /** @type {HTMLButtonElement[]} */
    let qualityButtons = [];

    void getAvailableVideoQualities(videoId).then(qualities => {
      if (activeFormat !== 'video') return;
      if (formParts.qualitySelect.dataset.renderToken !== renderToken) return;

      const availableQualities =
        Array.isArray(qualities) && qualities.length > 0
          ? qualities
          : DownloadConfig.VIDEO_QUALITIES.slice();
      const lowQuals = availableQualities.filter(q => parseInt(q, 10) <= 1080);
      const highQuals = availableQualities.filter(q => parseInt(q, 10) > 1080);
      const previousQuality = String(formParts.qualitySelect.value || '');

      formParts.qualitySelect.replaceChildren();
      qualityButtons = [];
      lowQuals.forEach(q =>
        formParts.qualitySelect.appendChild(
          attachQualityPillButton(q, `${q}p`, qualityButtons, formParts.qualitySelect)
        )
      );

      if (highQuals.length > 0) {
        const labelWrap = document.createElement('div');
        labelWrap.className = 'yp-download-quality-label';
        const lineLeft = document.createElement('div');
        lineLeft.className = 'yp-download-quality-label-line';
        const label = document.createElement('div');
        label.className = 'yp-download-quality-label-text';
        label.textContent = t('vp9Label');
        const lineRight = document.createElement('div');
        lineRight.className = 'yp-download-quality-label-line';
        labelWrap.appendChild(lineLeft);
        labelWrap.appendChild(label);
        labelWrap.appendChild(lineRight);
        formParts.qualitySelect.appendChild(labelWrap);

        highQuals.forEach(q =>
          formParts.qualitySelect.appendChild(
            attachQualityPillButton(q, `${q}p`, qualityButtons, formParts.qualitySelect)
          )
        );
      }

      formParts.qualitySelect.value = pickDefaultVideoQuality(availableQualities, previousQuality);
      applyPillSelection(qualityButtons, formParts.qualitySelect.value);
    });
  }

  /**
   * @param {ModalFormParts} formParts
   */
  function renderSourceQualityOptions(formParts) {
    const availableQualities = DownloadConfig.SOURCE_VIDEO_QUALITIES.slice();
    const previousQuality = String(formParts.qualitySelect.value || '');
    /** @type {HTMLButtonElement[]} */
    const qualityButtons = [];
    availableQualities.forEach((/** @type {string} */ q) => {
      formParts.qualitySelect.appendChild(
        attachQualityPillButton(q, `${q}p`, qualityButtons, formParts.qualitySelect)
      );
    });
    formParts.qualitySelect.value = pickDefaultVideoQuality(availableQualities, previousQuality);
    applyPillSelection(qualityButtons, formParts.qualitySelect.value);
  }

  /**
   * @param {Record<string, unknown>} formParts
   * @param {string} source
   */
  function renderAudioBitrateOptions(formParts, source) {
    const el = /** @type {HTMLElement} */ (formParts.embedLabel);
    el.style.display = 'none';
    const sh = /** @type {HTMLElement | undefined} */ (formParts.sourceHint);
    if (sh) sh.style.display = 'none';
    const sourceBitrates = /** @type {Record<string, string[]>} */ (
      DownloadConfig.SOURCE_AUDIO_BITRATES
    );
    const bitrates =
      source === DownloadConfig.SOURCES.CNVCX
        ? DownloadConfig.AUDIO_BITRATES.slice()
        : (sourceBitrates[source] || ['128']).slice();
    const defaultBitrate = bitrates.includes(DownloadConfig.DEFAULTS.audioBitrate)
      ? DownloadConfig.DEFAULTS.audioBitrate
      : bitrates[bitrates.length - 1];
    /** @type {HTMLButtonElement[]} */
    const audioButtons = [];
    const qs = /** @type {HTMLElement & { value?: string }} */ (formParts.qualitySelect);
    bitrates.forEach((/** @type {string} */ b) => {
      qs.appendChild(attachQualityPillButton(b, `${b} kbps`, audioButtons, qs));
    });
    qs.value = defaultBitrate;
    applyPillSelection(audioButtons, qs.value);
  }

  /**
   * Update quality/options UI depending on active format.
   * Extracted from createModalUI to satisfy max-lines-per-function.
   * @param {ModalFormParts} formParts
   * @param {string} activeFormat
   * @param {Record<string, unknown>} subtitlesData
   */
  function updateQualityOptionsForForm(formParts, activeFormat, subtitlesData) {
    const srcSel = /** @type {{ value?: string } | undefined} */ (formParts.sourceSelect);
    const qs = /** @type {HTMLElement & { value?: string }} */ (formParts.qualitySelect);
    const el = /** @type {HTMLElement} */ (formParts.embedLabel);
    const sw = /** @type {HTMLElement} */ (formParts.subtitleWrapper);
    const wrap = /** @type {HTMLElement | undefined} */ (formParts.sourceWrap);
    const sh = /** @type {HTMLElement | undefined} */ (formParts.sourceHint);
    const source = srcSel?.value || DownloadConfig.SOURCES.CNVCX;

    if (activeFormat === 'subtitle') {
      qs.style.display = 'none';
      el.style.display = 'none';
      sw.style.display = 'block';
      if (wrap) wrap.style.display = 'none';
      if (sh) sh.style.display = 'none';
      loadSubtitlesForForm(formParts, subtitlesData);
      return;
    }

    qs.style.display = 'flex';
    el.style.display = 'none';
    sw.style.display = 'none';
    if (wrap) wrap.style.display = 'block';
    qs.replaceChildren();

    // Invalidate any in-flight async quality load (e.g. cnv.cx's live quality
    // detection) whenever the format or source changes, so a stale response
    // cannot overwrite the freshly rendered options.
    const renderToken = String(Date.now()) + Math.random().toString(36).slice(2);
    qs.dataset.renderToken = renderToken;

    if (activeFormat === 'video') {
      if (sh) {
        sh.style.display = source === DownloadConfig.SOURCES.MOBILE ? 'block' : 'none';
      }

      if (source === DownloadConfig.SOURCES.CNVCX) {
        renderCnvQualityOptions(formParts, renderToken, activeFormat);
        return;
      }

      renderSourceQualityOptions(formParts);
      return;
    }

    renderAudioBitrateOptions(formParts, source);
  }

  function createModalUI() {
    if (_modalElements) return _modalElements;

    let activeFormat = 'video';
    const subtitlesData = { all: [], original: [], translated: [] };

    const overlay = /** @type {HTMLDivElement} */ (document.createElement('div'));
    overlay.className = 'yp-download-modal-overlay';

    const box = /** @type {HTMLDivElement} */ (document.createElement('div'));
    box.className = 'yp-download-modal-box';
    // a11y: expose the box as a modal dialog for assistive tech.
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const formParts = buildModalForm();

    const tabContainer = createTabButtons(format => {
      activeFormat = format;
      updateQualityOptionsForForm(formParts, activeFormat, subtitlesData);
    });

    // Wire the source selector: clicking a pill or changing dropdown re-renders quality options
    if (formParts.classicSourceSelect) {
      window.YouTubePlusCleanupManager?.registerListener?.(
        formParts.classicSourceSelect,
        'change',
        () => {
          formParts.sourceSelect.value = formParts.classicSourceSelect.value;
          applyPillSelection(formParts.sourceButtons, formParts.sourceSelect.value);
          updateQualityOptionsForForm(formParts, activeFormat, subtitlesData);
        },
        undefined,
        false
      );
    }

    formParts.sourceButtons.forEach((/** @type {HTMLButtonElement} */ btn) => {
      window.YouTubePlusCleanupManager?.registerListener?.(
        btn,
        'click',
        () => {
          formParts.sourceSelect.value = btn.dataset.source || DownloadConfig.SOURCES.CNVCX;
          if (formParts.classicSourceSelect) {
            formParts.classicSourceSelect.value = formParts.sourceSelect.value;
          }
          applyPillSelection(formParts.sourceButtons, formParts.sourceSelect.value);
          updateQualityOptionsForForm(formParts, activeFormat, subtitlesData);
        },
        undefined,
        false
      );
    });

    const content = /** @type {HTMLDivElement} */ (document.createElement('div'));
    content.className = 'yp-download-modal-content';
    content.appendChild(formParts.qualitySelect);
    content.appendChild(formParts.embedLabel);
    content.appendChild(formParts.subtitleWrapper);
    content.appendChild(formParts.progressWrapper);

    const btnRow = /** @type {HTMLDivElement} */ (document.createElement('div'));
    btnRow.className = 'yp-download-form-row';
    if (formParts.classicSourceSelect) {
      btnRow.appendChild(formParts.classicSourceSelect);
    }
    const actionsWrap = /** @type {HTMLDivElement} */ (document.createElement('div'));
    actionsWrap.className = 'yp-download-actions-wrap';
    actionsWrap.appendChild(formParts.cancelBtn);
    actionsWrap.appendChild(formParts.downloadBtn);
    btnRow.appendChild(actionsWrap);

    box.appendChild(tabContainer);
    box.appendChild(content);
    box.appendChild(btnRow);

    const shell = /** @type {HTMLDivElement} */ (document.createElement('div'));
    shell.className = 'yp-download-modal-shell';
    shell.appendChild(box);
    shell.appendChild(formParts.sourceWrap);
    overlay.appendChild(shell);

    updateQualityOptionsForForm(formParts, activeFormat, subtitlesData);
    wireModalEvents(
      formParts,
      () => activeFormat,
      () => subtitlesData
    );
    _modalElements = { overlay, box, ...formParts };
    return _modalElements;
  }

  /** @type {(() => void) | null} */
  let _activeFocusTrap = null;

  function openModal() {
    ensureDownloadModalStyles();
    const els = createModalUI();
    if (!els) return;
    if (!document.body.contains(els.overlay)) document.body.appendChild(els.overlay);
    // a11y: focus the first focusable element and trap Tab inside the
    // dialog while it is open (shared trap from modal-handlers.js).
    if (_activeFocusTrap) {
      try {
        _activeFocusTrap();
      } catch (_e) {
        logS(_e);
      }
      _activeFocusTrap = null;
    }
    const firstFocusable = /** @type {HTMLElement | null} */ (
      els.box?.querySelector(
        'button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])'
      )
    );
    if (firstFocusable) {
      window.YouTubePlusCleanupManager?.registerAnimationFrame?.(
        requestAnimationFrame(() => {
          firstFocusable?.focus?.();
        })
      );
    }
    const modalBox = /** @type {HTMLElement | null} */ (els.box);
    if (modalBox) {
      _activeFocusTrap = window.YouTubePlusModalHandlers?.createFocusTrap?.(modalBox) || null;
    }
    // Escape closes the modal (page-level listener, swept on nav cleanup).
    window.YouTubePlusCleanupManager?.registerListener?.(
      els.overlay,
      'keydown',
      /** @type {EventListener} */ (
        /** @param {KeyboardEvent} e */ e => {
          if (e.key === 'Escape') closeModal();
        }
      ),
      undefined,
      false
    );
  }

  function closeModal() {
    if (_activeFocusTrap) {
      try {
        _activeFocusTrap();
      } catch (_e) {
        logS(_e);
      }
      _activeFocusTrap = null;
    }
    if (!_modalElements) return;
    // Clean up subtitle select listener to prevent document click leak
    const ss = /** @type {(Element & { destroy?: () => void }) | null} */ (
      _modalElements.overlay?.querySelector('[role="listbox"]') ?? null
    );
    if (ss && typeof ss.destroy === 'function') ss.destroy();
    if (_modalElements.overlay?.parentNode) {
      _modalElements.overlay.parentNode.removeChild(_modalElements.overlay);
    }
    _modalElements = null;
  }

  // ============================================================================
  // DOWNLOAD BUTTON UI (merged from download-button.js)
  // ============================================================================

  /**
   * Helper to wait for download API to be available
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Object|undefined>} Download API or undefined
   */
  const waitForDownloadAPI = timeout =>
    new Promise(resolve => {
      const interval = 200;
      let waited = 0;

      if (
        typeof window !== 'undefined' &&
        typeof window.YouTubePlusDownload === 'object' &&
        window.YouTubePlusDownload !== null
      ) {
        return resolve(window.YouTubePlusDownload);
      }

      const id = createVisibilityAwareInterval(() => {
        waited += interval;
        if (
          typeof window !== 'undefined' &&
          typeof window.YouTubePlusDownload === 'object' &&
          window.YouTubePlusDownload !== null
        ) {
          id.stop();
          return resolve(window.YouTubePlusDownload);
        }
        if (waited >= timeout) {
          id.stop();
          return resolve(undefined);
        }
      }, interval);
      // Register with cleanupManager for safe SPA cleanup
      if (U?.cleanupManager?.register) {
        U.cleanupManager.register(() => id.stop());
      }
    });

  /**
   * Fallback clipboard copy with modern API priority
   * @param {string} text - Text to copy
   * @param {(key: string, params?: Record<string, string | number>) => string} tFn - Translation function
   * @param {{ show?: (msg: string, opts?: object) => void } | null} notificationMgr - Notification manager
   */
  const fallbackCopyToClipboard = async (text, tFn, notificationMgr) => {
    /**
     * @param {string} msg
     * @param {object} [opts]
     */
    const show = (msg, opts) => notificationMgr?.show?.(msg, opts);
    try {
      // Modern Clipboard API (preferred)
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        show(tFn('copiedToClipboard'), {
          duration: NOTIFY_DURATION.SHORT,
          type: 'success',
        });
        return;
      }

      // Fallback: textarea + Selection API for older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'dl-clipboard-proxy';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);

      let copied = false;
      try {
        // execCommand is deprecated but still the only sync fallback
        copied = document.execCommand('copy');
      } catch (_e) {
        logS(_e);
        logger.warn('[Download] execCommand copy not supported');
      }
      document.body.removeChild(ta);

      if (copied) {
        show(tFn('copiedToClipboard'), {
          duration: NOTIFY_DURATION.SHORT,
          type: 'success',
        });
      } else {
        show(tFn('copyFailed') || 'Copy failed', {
          duration: NOTIFY_DURATION.SHORT,
          type: 'error',
        });
      }
    } catch (e) {
      logS(e);
      logger.warn('[Download] Clipboard copy failed:', e);
      show(tFn('copyFailed') || 'Copy failed', {
        duration: NOTIFY_DURATION.SHORT,
        type: 'error',
      });
    }
  };

  /**
   * Build URL from template
   * @param {string} template - URL template
   * @param {string | null} videoId - Video ID
   * @param {string} videoUrl - Full video URL
   * @returns {string} Built URL
   */
  const buildUrl = (template, videoId, videoUrl) =>
    (template || '')
      .replace('{videoId}', videoId || '')
      .replace('{videoUrl}', encodeURIComponent(videoUrl || ''));

  /**
   * Create download button element
   * @param {Function} tFn - Translation function
   * @returns {HTMLElement} Button element
   */
  const createButtonElement = tFn => {
    const button = createEl('div', {
      attrs: {
        class: 'ytp-button yp-download-button',
        title: tFn('downloadOptions'),
        tabindex: '0',
        role: 'button',
        'aria-haspopup': 'true',
        'aria-expanded': 'false',
      },
    });
    _setSafeHTML(
      button,
      `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="0.5" d="M3 15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M12 3V16M12 16L16 11.625M12 16L8 11.625" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>
    `
    );
    return button;
  };

  /** @type {HTMLElement|null} */
  let lastActiveDownloadAnchor = null;

  /**
   * @param {HTMLElement | null} [initialTarget]
   * @returns {HTMLElement | null}
   */
  function findVisibleDownloadAnchor(initialTarget) {
    if (initialTarget) {
      const r = initialTarget.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) return initialTarget;
    }
    const allBtns = U.$$('.yp-download-button');
    for (const b of allBtns) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return /** @type {HTMLElement} */ (b);
      }
    }
    return null;
  }

  /**
   * Schedule a dock-aware, direction-aware placement of the dropdown below or
   * above its anchor, batched with RAF. The vertical side comes from the shared
   * PopoverController.positionDropdown so every menu flips the same way.
   * @param {HTMLElement} button - Button element
   * @param {HTMLElement} dropdown - Dropdown element
   */
  const scheduleDropdownPosition = (() => {
    /** @type {number | null} */ let rafId = null;
    /** @type {HTMLElement | null} */ let pendingButton = null;
    /** @type {HTMLElement | null} */ let pendingDropdown = null;

    const applyPosition = () => {
      // Reset the rafId FIRST: any early return below must not leave the scheduler
      // latched, or every later placement call is skipped forever (e.g. a
      // transient 0x0 button rect during boot/SPA transitions would brick the
      // dropdown permanently).
      rafId = null;
      if (!pendingDropdown) return;
      const target = findVisibleDownloadAnchor(pendingButton || lastActiveDownloadAnchor);
      if (!target) return;

      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      lastActiveDownloadAnchor = target;
      const dock = window.YouTubePlusZoom?.closestDock?.(target);
      pendingDropdown.style.left = `${Math.max(8, rect.left + rect.width / 2 - 75)}px`;
      pendingDropdown.style.right = 'auto';
      window.YouTubePlusFeatureRegistry?.PopoverController?.positionDropdown?.(
        dock || target,
        pendingDropdown,
        { preferDown: Boolean(dock), gap: 10 }
      );

      pendingButton = null;
      pendingDropdown = null;
    };

    return (/** @type {HTMLElement} */ button, /** @type {HTMLElement} */ dropdown) => {
      if (button) lastActiveDownloadAnchor = button;
      pendingButton = button;
      pendingDropdown = dropdown;

      if (rafId !== null) return; // Already scheduled
      rafId = window.YouTubePlusCleanupManager?.registerAnimationFrame?.(
        requestAnimationFrame(applyPosition)
      );
    };
  })();

  /**
   * Download Site Actions - Handle different types of downloads
   */
  const createDownloadActions = (
    /** @type {(key: string, params?: Record<string, string | number>) => string} */ tFn,
    /** @type {Record<string, unknown>} */ ytUtils
  ) => {
    /**
     * Handle direct download
     */
    const handleDirectDownload = async () => {
      const api = await waitForDownloadAPI(2000);
      const notify = /** @type {{ show?: Function } | undefined} */ (ytUtils?.NotificationManager);
      if (!api) {
        logger.error('Direct download module not loaded');
        notify?.show?.(tFn('directDownloadModuleNotAvailable'), {
          duration: NOTIFY_DURATION.MEDIUM,
          type: 'error',
        });
        return;
      }

      try {
        const directApi =
          /** @type {{ openModal?: Function, downloadVideo?: (opts: unknown) => Promise<unknown> }} */ (
            api
          );
        if (typeof directApi.openModal === 'function') {
          directApi.openModal();
          return;
        }
        if (typeof directApi.downloadVideo === 'function') {
          await directApi.downloadVideo({
            format: 'video',
            quality: '1080',
          });
          return;
        }
      } catch (err) {
        logS(err);
        logger.error('Direct download invocation failed', err);
      }

      notify?.show?.(tFn('directDownloadModuleNotAvailable'), {
        duration: NOTIFY_DURATION.MEDIUM,
        type: 'error',
      });
    };

    /**
     * Handle YTDL download - copies URL to clipboard and opens YTDL
     * @param {string} url - YTDL URL
     */
    const handleYTDLDownload = url => {
      const videoId = new URLSearchParams(location.search).get('v');
      const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

      // Copy to clipboard
      const notify = /** @type {{ show?: (msg: string, opts?: object) => void } | null} */ (
        ytUtils?.NotificationManager || null
      );
      fallbackCopyToClipboard(videoUrl, tFn, notify);

      // Open YTDL in new tab
      if (typeof ytUtils?.openSafe === 'function') {
        /** @type {(u: string, t: string) => boolean} */ (ytUtils.openSafe)(url, '_blank');
      } else {
        window.open(url, '_blank');
      }
    };

    /**
     * Helper to open download site or trigger direct download
     * @param {string} url - Download URL
     * @param {boolean} isYTDL - Whether this is YTDL download
     * @param {boolean} isDirect - Whether this is direct download
     * @param {HTMLElement} dropdown - Dropdown element to hide
     * @param {HTMLElement} button - Button element
     */
    const openDownloadSite = (url, isYTDL, isDirect, dropdown, button) => {
      dropdown?.classList?.remove?.('visible');
      button?.setAttribute?.('aria-expanded', 'false');

      if (isDirect) {
        handleDirectDownload();
        return;
      }

      if (isYTDL) {
        handleYTDLDownload(url);
        return;
      }

      if (typeof ytUtils?.openSafe === 'function') {
        /** @type {(u: string, t: string) => boolean} */ (ytUtils.openSafe)(url, '_blank');
      } else {
        window.open(url, '_blank');
      }
    };

    return { handleDirectDownload, handleYTDLDownload, openDownloadSite };
  };

  /**
   * Download Sites Configuration Builder
   * @param {(key: string, params?: Record<string, string | number>) => string} tFn - Translation function
   * @returns {(customization: Record<string, unknown> | undefined, enabledSites: Record<string, boolean> | undefined, videoId: string | null, videoUrl: string) => { baseSites: Array<{ key: string, name: string, url: string, isYTDL: boolean, isDirect: boolean }>, downloadSites: Array<{ key: string, name: string, url: string, isYTDL: boolean, isDirect: boolean }> }} Builder function
   */
  const createDownloadSitesBuilder = tFn => {
    return (
      /** @type {Record<string, unknown> | undefined} */ customization,
      /** @type {Record<string, boolean> | undefined} */ enabledSites,
      /** @type {string | null} */ videoId,
      /** @type {string} */ videoUrl
    ) => {
      const ext = /** @type {{ name?: string, url?: string } | undefined} */ (
        customization?.externalDownloader
      );
      const baseSites = [
        {
          key: 'externalDownloader',
          name: ext?.name || 'SSYouTube',
          url: buildUrl(ext?.url || `https://ssyoutube.com/watch?v={videoId}`, videoId, videoUrl),
          isYTDL: false,
          isDirect: false,
        },
        {
          key: 'ytdl',
          name: 'by YTDL',
          // Local opt-in: a plain HTTP URL for the user's own locally-running
          // YTDL server (yt-dlp GUI). No network call: we just open it in a
          // new tab after copying the video URL to the clipboard.
          // Opt-in only: hidden unless the user enables it in settings.
          url: `http://localhost:5005`,
          isYTDL: true,
          isDirect: false,
        },
        {
          key: 'direct',
          name: tFn('directDownload'),
          url: '#',
          isYTDL: false,
          isDirect: true,
        },
      ];

      const downloadSites = baseSites.filter(s => enabledSites?.[s.key] !== false);
      return { baseSites, downloadSites };
    };
  };

  /**
   * Create dropdown options element
   * @param {Array<Record<string, unknown>>} downloadSites - Download sites configuration
   * @param {HTMLElement} button - Button element
   * @param {Function} openDownloadSiteFn - Click handler
   * @param {{ listen: Function }} scope - Feature scope that owns the dropdown and its listeners
   * @returns {HTMLElement} Dropdown element
   */
  const createDropdownOptions = (downloadSites, button, openDownloadSiteFn, scope) => {
    const options = createEl('div', {
      attrs: { class: 'download-options', role: 'menu' },
    });

    const list = createEl('div', {
      attrs: { class: 'download-options-list' },
    });

    downloadSites.forEach(site => {
      const opt = createEl('div', {
        attrs: {
          class: 'download-option-item',
          role: 'menuitem',
          tabindex: '0',
          'data-url': String(site.url || ''),
          'data-is-ytdl': site.isYTDL ? 'true' : 'false',
          'data-is-direct': site.isDirect ? 'true' : 'false',
        },
        text: String(site.name || ''),
      });
      list.appendChild(opt);
    });

    const handleOptionActivate = (/** @type {HTMLElement | null} */ item) => {
      if (!item) return;
      openDownloadSiteFn(
        item.dataset.url,
        item.dataset.isYtdl === 'true',
        item.dataset.isDirect === 'true',
        options,
        button
      );
    };

    const findActiveItem = (/** @type {Event} */ e) => {
      const target = e.target instanceof Element ? e.target : null;
      const item = /** @type {HTMLElement | null} */ (
        target?.closest('.download-option-item') || null
      );
      return item && list.contains(item) ? item : null;
    };

    scope.listen(list, 'click', (/** @type {MouseEvent} */ e) => {
      const item = findActiveItem(e);
      if (item) handleOptionActivate(item);
    });

    scope.listen(list, 'keydown', (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = findActiveItem(e);
      if (item) handleOptionActivate(item);
    });

    options.appendChild(list);
    return options;
  };

  /**
   * Setup dropdown hover behavior with event delegation
   * Uses WeakMap to store timers per button/dropdown pair
   */
  const setupDropdownHoverBehavior = (() => {
    const dropdownTimers = new WeakMap();

    const getTimer = (/** @type {Element} */ element) => dropdownTimers.get(element);
    const setTimer = (
      /** @type {Element} */ element,
      /** @type {ReturnType<typeof setTimeout>} */ timerId
    ) => dropdownTimers.set(element, timerId);
    const clearTimer = (/** @type {Element} */ element) => {
      const timerId = getTimer(element);
      if (timerId !== undefined) {
        clearTimeout(timerId);
        dropdownTimers.delete(element);
      }
    };

    const showDropdown = (
      /** @type {HTMLElement} */ button,
      /** @type {HTMLElement} */ dropdown
    ) => {
      if (!(button && dropdown)) return;
      clearTimer(button);
      clearTimer(dropdown);
      scheduleDropdownPosition(button, dropdown);
      dropdown.classList.add('visible');
      button.setAttribute?.('aria-expanded', 'true');
    };

    const hideDropdown = (
      /** @type {HTMLElement} */ button,
      /** @type {HTMLElement} */ dropdown
    ) => {
      if (!(button && dropdown)) return;
      clearTimer(button);
      clearTimer(dropdown);
      const timerId = setTimeout(() => {
        dropdown?.classList?.remove?.('visible');
        button?.setAttribute?.('aria-expanded', 'false');
      }, DROPDOWN_HIDE_DELAY_MS);
      setTimer(button, timerId);
    };

    function resolveHoverTarget(/** @type {EventTarget | null} */ target) {
      const el = target instanceof Element ? target : null;
      const button = /** @type {HTMLElement | null} */ (el?.closest(SELECTORS.BUTTON) || null);
      if (button) {
        const dropdown = /** @type {HTMLElement | null} */ ($(SELECTORS.DROPDOWN));
        return dropdown ? { anchor: button, dropdown, timerTarget: button } : null;
      }
      const dropdown = /** @type {HTMLElement | null} */ (el?.closest(SELECTORS.DROPDOWN) || null);
      if (dropdown) {
        const anchor = /** @type {HTMLElement | null} */ (
          lastActiveDownloadAnchor || $(SELECTORS.BUTTON)
        );
        return anchor ? { anchor, dropdown, timerTarget: dropdown } : null;
      }
      return null;
    }

    /**
     * The dropdown a button interaction targets: the existing shared menu, or a
     * lazily created one for the Vision dock button when no classic button made it.
     * @param {HTMLElement} button
     * @returns {HTMLElement | null}
     */
    const activeDropdownFor = button =>
      /** @type {HTMLElement | null} */ ($(SELECTORS.DROPDOWN)) ||
      (button.id === 'yp-vision-download-btn' ? ensureDownloadDropdown() : null);

    /** @param {{ listen: Function }} ctx */
    const initDelegation = ctx => {
      // Mouseenter/mouseleave delegation on document with capture phase
      ctx.listen(
        document,
        'mouseenter',
        (/** @type {Event} */ e) => {
          const resolved = resolveHoverTarget(e.target);
          if (!resolved) return;
          clearTimer(resolved.anchor);
          clearTimer(resolved.dropdown);
          showDropdown(resolved.anchor, resolved.dropdown);
        },
        true
      );

      ctx.listen(
        document,
        'mouseleave',
        (/** @type {Event} */ e) => {
          const resolved = resolveHoverTarget(e.target);
          if (!resolved) return;
          clearTimer(resolved.anchor);
          clearTimer(resolved.dropdown);
          const timerId = setTimeout(
            () => hideDropdown(resolved.anchor, resolved.dropdown),
            DROPDOWN_HIDE_DELAY_MS
          );
          setTimer(resolved.timerTarget, timerId);
        },
        true
      );

      // Keydown delegation for Enter/Space on button
      ctx.listen(document, 'keydown', (/** @type {KeyboardEvent} */ e) => {
        const target = e.target instanceof Element ? e.target : null;
        const button = /** @type {HTMLElement | null} */ (
          target?.closest(SELECTORS.BUTTON) || null
        );
        if (!button) return;

        if (e.key === 'Enter' || e.key === ' ') {
          const dropdown = activeDropdownFor(button);
          if (!dropdown) return;

          if (dropdown.classList.contains('visible')) {
            hideDropdown(button, dropdown);
          } else {
            showDropdown(button, dropdown);
          }
        }
      });

      // A click on the button opens the menu (hover opens it too; a click
      // outside closes the open one). Covers the classic and dock buttons.
      ctx.listen(
        document,
        'click',
        (/** @type {Event} */ e) => {
          const target = e.target instanceof Element ? e.target : null;
          const button = /** @type {HTMLElement | null} */ (
            target?.closest(SELECTORS.BUTTON) || null
          );
          if (!button) {
            const open = /** @type {HTMLElement | null} */ ($(`${SELECTORS.DROPDOWN}.visible`));
            if (open) hideDropdown(lastActiveDownloadAnchor || open, open);
            return;
          }
          const dropdown = activeDropdownFor(button);
          if (dropdown) showDropdown(button, dropdown);
        },
        true
      );
    };

    return initDelegation;
  })();

  // The download button runs as a lifecycle feature (FeatureLifecycle in
  // feature-registry.js). `downloadCtx` exists only while the setting is on
  // and owns the hover delegation; each classic button with its dropdown
  // lives in `buttonScope`, replaced whenever the button is rebuilt.
  /** @type {YouTubePlusFeatureContext | null} */
  let downloadCtx = null;
  /** @type {YouTubePlusFeatureContext | null} */
  let buttonScope = null;
  /** Last manager config from basic.js, reused when the feature starts later. */
  /** @type {DownloadButtonManagerConfig | null} */
  let lastManagerConfig = null;

  // The download menu is shared by the classic button and the Vision dock
  // button, and is owned by the feature (not a single button), so it must exist
  // even when no classic button is created (Vision).
  /** @type {YouTubePlusFeatureContext | null} */
  let dropdownScope = null;
  /** @type {HTMLElement | null} */
  let downloadDropdownEl = null;

  /**
   * Build (once) and return the shared `.download-options` menu. Missing
   * settings fall back to the store and then the built-in site defaults.
   * @param {Record<string, unknown>} [settings]
   * @returns {HTMLElement | null}
   */
  const ensureDownloadDropdown = settings => {
    if (downloadDropdownEl?.isConnected) return downloadDropdownEl;
    if (!downloadCtx) return null;
    const cfg = /** @type {Record<string, unknown>} */ (
      settings || window.YouTubePlusSettingsStore?.load?.() || {}
    );
    const tFn = /** @type {(key: string, params?: Record<string, string | number>) => string} */ (
      (key, params) => U?.t?.(key, params) ?? key
    );
    const videoId = new URLSearchParams(location.search).get('v');
    const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;
    const customization = /** @type {Record<string, unknown>} */ (
      cfg.downloadSiteCustomization || {
        externalDownloader: {
          name: 'SSYouTube',
          url: 'https://ssyoutube.com/watch?v={videoId}',
        },
      }
    );
    const enabledSites = /** @type {Record<string, boolean>} */ (
      cfg.downloadSites || { externalDownloader: true, ytdl: true, direct: true }
    );
    const { downloadSites } = createDownloadSitesBuilder(tFn)(
      customization,
      enabledSites,
      videoId,
      videoUrl
    );
    if (!downloadSites.length) return null;

    const actions = createDownloadActions(
      tFn,
      /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window.YouTubeUtils || {}))
    );
    const scope = downloadCtx.scope();
    const anchor =
      /** @type {HTMLElement | null} */ (document.querySelector('#yp-vision-download-btn')) ||
      /** @type {HTMLElement | null} */ (document.querySelector(SELECTORS.BUTTON)) ||
      document.body;
    const dropdown = createDropdownOptions(downloadSites, anchor, actions.openDownloadSite, scope);
    dropdownScope = scope;
    downloadDropdownEl = dropdown;
    if (document.body) {
      document.body.appendChild(dropdown);
    } else {
      anchor.appendChild(dropdown);
    }
    window.YouTubePlusDOMCache?.invalidate?.(SELECTORS.DROPDOWN);
    return dropdown;
  };

  /** Drop the shared menu and its listeners (feature stop). */
  const disposeDownloadDropdown = () => {
    dropdownScope?.dispose();
    dropdownScope = null;
    downloadDropdownEl?.remove();
    downloadDropdownEl = null;
    window.YouTubePlusDOMCache?.invalidate?.(SELECTORS.DROPDOWN);
  };

  /**
   * Remove classic buttons not owned by the current scope. The Vision dock
   * button belongs to VisionDockHost.
   * @param {ParentNode} root
   */
  const removeStrayClassicButtons = root => {
    for (const btn of root.querySelectorAll(SELECTORS.BUTTON)) {
      if (btn.id !== 'yp-vision-download-btn') btn.remove();
    }
  };

  /**
   * Remove the Classic download button and its listeners. The shared menu and
   * the Vision dock button are left to `disposeDownloadDropdown`/VisionDockHost.
   */
  const removeClassicButtons = () => {
    buttonScope?.dispose();
    buttonScope = null;
    for (const root of document.querySelectorAll(SELECTORS.RIGHT_CONTROLS)) {
      removeStrayClassicButtons(root);
    }
  };

  /**
   * Download Button Manager - Handles download button creation and dropdown management
   * @param {DownloadButtonManagerConfig} config - Configuration object
   * @returns {{ addDownloadButton: (controls: HTMLElement) => void } & Record<string, unknown>} Download button manager API
   */
  const createDownloadButtonManager = config => {
    lastManagerConfig = config;
    const { settings, t: tFn, getElement, YouTubeUtils: ytUtils } = config;

    const actions = createDownloadActions(tFn, ytUtils || {});
    const buildDownloadSites = createDownloadSitesBuilder(tFn);

    /**
     * Add download button to controls
     * @param {HTMLElement} controls - Controls container
     */
    const addDownloadButton = controls => {
      if (!(controls && downloadCtx)) return;
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') return;
      injectDownloadStyles();

      // One classic button and one dropdown at a time; rebuilding disposes
      // the current pair and its listeners.
      buttonScope?.dispose();
      buttonScope = downloadCtx.scope();
      const scope = buttonScope;
      removeStrayClassicButtons(controls);

      const videoId = new URLSearchParams(location.search).get('v');
      const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

      const customization = /** @type {Record<string, unknown>} */ (
        settings?.downloadSiteCustomization || {
          externalDownloader: {
            name: 'SSYouTube',
            url: 'https://ssyoutube.com/watch?v={videoId}',
          },
        }
      );

      const enabledSites = /** @type {Record<string, boolean>} */ (
        settings?.downloadSites || {
          externalDownloader: true,
          ytdl: true,
          direct: true,
        }
      );
      const { downloadSites } = buildDownloadSites(customization, enabledSites, videoId, videoUrl);

      const button = scope.own(createButtonElement(tFn));

      // Expose the rebuild hook on the module's own facade so
      // modal-download-handlers can trigger a rebuild without the
      // legacy window.youtubePlus namespace bridge.
      if (window.YouTubePlusDownloadButton) {
        window.YouTubePlusDownloadButton.rebuildDownloadDropdown = () => {
          try {
            if (downloadCtx)
              ensureDownloadDropdown(/** @type {Record<string, unknown>} */ (settings));
            if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') return;
            const controlsEl = $(SELECTORS.RIGHT_CONTROLS);
            if (!controlsEl) return;
            addDownloadButton(/** @type {HTMLElement} */ (controlsEl));
          } catch (e) {
            logS(e);
            logger.warn('rebuildDownloadDropdown failed', e);
          }
        };
      }

      if (downloadSites.length === 1) {
        const singleSite = downloadSites[0];
        button.style.cursor = 'pointer';
        const tempDropdown = document.createElement('div');
        scope.listen(button, 'click', () =>
          actions.openDownloadSite(
            singleSite.url,
            singleSite.isYTDL,
            singleSite.isDirect,
            tempDropdown,
            button
          )
        );
        controls.insertBefore(button, controls.firstChild);
        return;
      }

      ensureDownloadDropdown(/** @type {Record<string, unknown>} */ (settings));

      controls.insertBefore(button, controls.firstChild);
    };

    /**
     * Refresh download button visibility based on settings
     */
    const refreshDownloadButton = () => {
      if (downloadCtx) ensureDownloadDropdown(/** @type {Record<string, unknown>} */ (settings));
      if (window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision') return;
      const button = getElement(SELECTORS.BUTTON);
      let dropdown = $(SELECTORS.DROPDOWN);

      // If downloads are enabled but the dropdown/button are missing, recreate them
      if (downloadCtx && !(button && dropdown)) {
        try {
          const controlsEl = $(SELECTORS.RIGHT_CONTROLS);
          if (controlsEl) {
            addDownloadButton(/** @type {HTMLElement} */ (controlsEl));
            // re-query after creation
            dropdown = $(SELECTORS.DROPDOWN);
          }
        } catch (e) {
          logS(e);
          logger?.warn?.('[YouTube+] recreate download button failed:', e);
        }
      }

      refreshDownloadVisibility(Boolean(downloadCtx));
    };

    return {
      addDownloadButton,
      refreshDownloadButton,
    };
  };

  // ============================================================================
  // MODULE INITIALIZATION
  // ============================================================================

  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    injectDownloadStyles();
    const l = YouTubeUtils?.logger;
    l?.debug?.('[YouTube+ Download] Unified module loaded');
    l?.debug?.('[YouTube+ Download] Use window.YouTubePlusDownload.downloadVideo() to download');
    l?.debug?.('[YouTube+ Download] Button manager available');
  }

  // Export public API
  if (typeof window !== 'undefined') {
    window.YouTubePlusDownload = {
      downloadVideo,

      // Alternative source downloaders
      downloadViaCobalt,
      downloadViaDirectStream,

      // Queue-aware download wrapper
      enqueueDownload,

      // Subtitle functions
      getSubtitles,
      downloadSubtitle,

      // Configuration
      DownloadConfig,

      // UI: open modal for user selection
      openModal,

      // Initialize (called automatically)
      init,

      // Security guard (exported for guard-branch tests)
      isHttpUrl,
      isHttpsUrl,

      // POT hook lifecycle (exported for lifecycle tests; session-once install)
      _installPotHooksOnce,

      // Transport primitives (exported for cancel/lifecycle tests)
      gmXmlHttpRequest,
      downloadBlobFromUrl,
    };

    // Export button manager for basic.js
    window.YouTubePlusDownloadButton = {
      createDownloadButtonManager:
        /** @type {(config: Record<string, unknown>) => { refreshDownloadButton(): void; addDownloadButton(): void; [key: string]: unknown }} */ (
          /** @type {unknown} */ (createDownloadButtonManager)
        ),
      refreshVisibility: refreshDownloadVisibility,
      removeClassicButtons,
      injectStyles: injectDownloadStyles,
    };
  }

  // --- FeatureRegistry descriptor: download (Vision dock surface) ---
  // Hover/click flow through download.js's own document-level delegation
  // (closest('.yp-download-button')); the dock button needs no listeners.
  const descDownloadIconSVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  const DESCRIPTOR = {
    id: 'download',
    titleKey: 'downloadOptions',
    fallbackTitle: 'Download',
    settingsKey: 'enableDownload',
    iconSVG: descDownloadIconSVG,
    command(/** @type {unknown} */ _shim) {
      const btn = /** @type {HTMLElement|null} */ (document.querySelector('.yp-download-button'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    mountDock(/** @type {HTMLElement} */ player, /** @type {HTMLElement} */ dock) {
      void player;
      let btn = /** @type {HTMLButtonElement|null} */ (
        dock.querySelector('#yp-vision-download-btn')
      );
      if (btn) return;

      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'yp-vision-download-btn';
      btn.className = 'vision-dock-btn yp-download-button';
      const title = U?.t?.('downloadOptions') || 'Download';
      btn.setAttribute('title', title);
      btn.setAttribute('aria-label', title);
      btn.setAttribute('tabindex', '0');
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');
      if (U?.setSafeHTML) {
        U.setSafeHTML(btn, descDownloadIconSVG);
      } else if (window.YouTubePlusSafeDOM?.setInnerHTML) {
        window.YouTubePlusSafeDOM.setInnerHTML(btn, descDownloadIconSVG);
      } else if (window.YouTubeSafeDOM?.setHTML) {
        window.YouTubeSafeDOM.setHTML(btn, descDownloadIconSVG);
      }
      dock.appendChild(btn);
      // clicks arrive via the module's document-level delegation, so the
      // dock button owns no host-visible registrations and dispose is a no-op.
      return () => {};
    },
  };

  if (typeof window !== 'undefined') {
    if (window.YouTubePlusDownload) {
      window.YouTubePlusDownload.DESCRIPTOR = DESCRIPTOR;
    }
    if (window.YouTubePlusDownloadButton) {
      window.YouTubePlusDownloadButton.DESCRIPTOR = DESCRIPTOR;
    }
  }

  window.YouTubePlusFeatureRegistry?.register?.(DESCRIPTOR);

  const downloadFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'download',
    settingsKey: 'enableDownload',
    // The classic button and its dropdown belong to the video players only.
    routes: ['watch', 'shorts'],
    start(/** @type {YouTubePlusFeatureContext} */ ctx) {
      downloadCtx = ctx;
      init();
      setupDropdownHoverBehavior(ctx);
      const controls = document.querySelector(SELECTORS.RIGHT_CONTROLS);
      const isVision = window.YouTubePlusDesignSystem?.getThemeVariant?.() === 'vision';
      // In Vision there is no classic button to create the shared menu, so the
      // dock needs it up front; the classic path builds it with its own settings.
      if (isVision) ensureDownloadDropdown();
      if (controls && lastManagerConfig && !isVision) {
        createDownloadButtonManager(lastManagerConfig).addDownloadButton(
          /** @type {HTMLElement} */ (controls)
        );
      }
    },
    stop() {
      removeClassicButtons();
      disposeDownloadDropdown();
      downloadCtx = null;
    },
  });
  downloadFeature?.sync();
})();
