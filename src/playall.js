// Play All: LazyLoader registered as 'playall'.
//
// Responsibility: "Play All" button injection on playlist pages,
//   sequential video playback orchestration, and random-shuffle mode
//   via the `ytp-random` URL parameter.
// Public surface: window.YouTubePlusPlayall.
(function () {
  const setTimeout_ = setTimeout.bind(window);
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'PlayAll');

  const _createHTML = U.createHTML;
  const RANDOM_PARAM = 'ytp-random';

  /** @type {(() => void)|null} */
  let stopRandomPlayTimers = null;
  /** @type {(() => void)|null} */
  let scheduleApplyRandomPlay = null;
  /** @type {number | { stop?: () => void, cancel?: () => void } | null} */
  let addButtonRetryTimer = null;

  // Runtime resources follow the FeatureLifecycle contract
  // (feature-registry.js): `playAllCtx` exists only while the
  // `enablePlayAll` setting is on. Dynamic groups get their own scope:
  // `btnScope` owns each button instance, `randomScope` owns the
  // random-play UI per playlist panel. YouTube DOM touched by the module
  // (chip-bar parent class, chip-bar shadow-root style, playlist header
  // href, applied panel attributes) is tracked and restored on stop.
  /** @type {FeatureContext | null} */
  let playAllCtx = null;
  /** @type {FeatureScope | null} */
  let btnScope = null;
  /** @type {FeatureScope | null} */
  let randomScope = null;
  /** @type {Element | null} */
  let randomPrevPanel = null;
  /** @type {(() => void) | null} */
  let keydownRelease = null;
  /** @type {(() => void) | null} */
  let timeupdateRelease = null;
  /** @type {string | null} */
  let badgeAnchorPrevHref = null;
  /** @type {Element | null} */
  let shadowStyleEl = null;
  /** @type {Element | null} */
  let parentClassEl = null;

  const isMobileHost = () => window.location.host === 'm.youtube.com';

  const navigate = (/** @type {string} */ targetUrl) => U.navigateTo(targetUrl);

  const clearRetryHandle = (
    /** @type {number | { stop?: () => void, cancel?: () => void } | null | undefined} */ handle
  ) => {
    if (!handle) return;
    if (typeof handle === 'number') {
      clearTimeout(handle);
      return;
    }
    if (typeof handle.stop === 'function') {
      handle.stop();
      return;
    }
    if (typeof handle.cancel === 'function') {
      handle.cancel();
    }
  };
  // Shared DOM helpers from YouTubeUtils
  const $ = window.YouTubeUtils.$;
  const $$ = window.YouTubeUtils.$$;
  const playAllLogger = window.YouTubeUtils?.logger || null;
  const _cm = window.YouTubeUtils?.cleanupManager;
  const onDomReady = (() => {
    let ready = document.readyState !== 'loading';
    const queue = /** @type {Array<() => void>} */ ([]);
    const run = () => {
      ready = true;
      while (queue.length) {
        const cb = queue.shift();
        try {
          if (cb) cb();
        } catch (e) {
          logS(e);
          playAllLogger?.warn?.('Play All', 'DOMReady callback error', e);
        }
      }
    };
    if (!ready)
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'DOMContentLoaded',
        run,
        { once: true },
        true
      );
    return (/** @type {() => void} */ cb) => {
      if (ready) cb();
      else queue.push(cb);
    };
  })();

  const t = window.YouTubeUtils?.t || ((/** @type {string} */ key) => key || '');

  const hasTranslation = (/** @type {string} */ key) =>
    Boolean(window.YouTubePlusI18n?.hasTranslation?.(key));

  const getPlayAllLabel = () => {
    if (hasTranslation('playAllButton')) {
      const localized = t('playAllButton');
      if (localized && localized !== 'playAllButton') return localized;
    }
    return 'Play All';
  };

  const getPlayAllAriaLabel = () => {
    const localized = t('enablePlayAllLabel');
    return localized && localized !== 'enablePlayAllLabel' ? localized : getPlayAllLabel();
  };

  const UC_CHANNEL_RE = /^UC[a-zA-Z0-9_-]{22}$/;

  const resolveMetaChannelId_ = () => {
    const metaChannel = $('meta[itemprop="channelId"]');
    const metaValue = metaChannel?.getAttribute('content');
    if (metaValue && UC_CHANNEL_RE.test(metaValue)) return metaValue;

    const canonical = $('link[rel="canonical"]');
    const canonicalHref = canonical?.getAttribute('href') || '';
    const canonicalMatch = canonicalHref.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    return canonicalMatch?.[1] ?? null;
  };

  const resolveDomNodeChannelId_ = () => {
    const browseNode = $('ytd-browse[page-subtype="channels"]');
    const attrId =
      browseNode?.getAttribute?.('channel-id') || browseNode?.getAttribute?.('external-id');
    if (attrId && UC_CHANNEL_RE.test(attrId)) return attrId;

    const channelHrefNode = $(
      'ytd-channel-name a[href*="/channel/UC"], #channel-name a[href*="/channel/UC"], a[href^="/channel/UC"]'
    );
    const channelHref = channelHrefNode?.getAttribute?.('href') || '';
    const channelHrefMatch = channelHref.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    if (channelHrefMatch?.[1]) return channelHrefMatch[1];

    const fromUrl = location.href.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    return fromUrl?.[1] ?? null;
  };

  const resolveInitialDataChannelId_ = () => {
    const initialData =
      /** @type {{ metadata?: { channelMetadataRenderer?: { externalId?: string } }, header?: { c4TabbedHeaderRenderer?: { channelId?: string }, pageHeaderRenderer?: { content?: { pageHeaderViewModel?: { metadata?: { contentMetadataViewModel?: { metadataRows?: Array<{ metadataParts?: Array<{ text?: { content?: string } }> }> } } } } } } } } | undefined} */ (
        window.ytInitialData
      );
    const headerId =
      initialData?.metadata?.channelMetadataRenderer?.externalId ||
      initialData?.header?.c4TabbedHeaderRenderer?.channelId ||
      initialData?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.find?.(
        (/** @type {{ text?: { content?: string } }} */ p) =>
          UC_CHANNEL_RE.test(p?.text?.content || '')
      )?.text?.content;
    if (headerId && UC_CHANNEL_RE.test(headerId)) return headerId;

    if (window.ytcfg?.get) {
      const cfgId = window.ytcfg.get('CHANNEL_ID');
      if (cfgId && UC_CHANNEL_RE.test(cfgId)) return cfgId;
    }
    return null;
  };

  const resolveChannelIdFromDom = () =>
    resolveMetaChannelId_() || resolveDomNodeChannelId_() || resolveInitialDataChannelId_();

  /**
   * Retry resolving the channel ID from DOM sources up to `maxAttempts` times.
   * Useful during SPA transitions when ytInitialData/meta tags are not yet
   * updated at the moment yt-navigate-finish fires.
   * @param {number} [maxAttempts]
   * @param {number} [intervalMs]
   * @returns {Promise<string|null>} Channel ID or null
   */
  const resolveChannelIdWithRetry = (maxAttempts = 10, intervalMs = 120) =>
    new Promise(resolve => {
      let attempts = 0;
      const check = () => {
        attempts += 1;
        const id = resolveChannelIdFromDom();
        if (id) return resolve(id);
        if (attempts >= maxAttempts) return resolve(null);
        scheduleManagedTimeout(check, intervalMs);
      };
      check();
    });

  /** @type {{ script?: { version?: string } } | null} */
  const gmInfo =
    (typeof globalThis !== 'undefined' &&
      /** @type {{ GM_info?: { script?: { version?: string } } }} */ (globalThis).GM_info) ||
    (typeof window !== 'undefined' &&
      /** @type {{ GM_info?: { script?: { version?: string } } }} */ (window).GM_info) ||
    null;

  const scriptVersion = gmInfo?.script?.version ?? null;
  if (scriptVersion && /-(alpha|beta|dev|test)$/.test(scriptVersion)) {
    window.YouTubeUtils?.logger?.info?.(
      '%cytp - YouTube Play All\n',
      'color: var(--yt-playall-accent-purple); font-size: 32px; font-weight: bold',
      'You are currently running a test version:',
      scriptVersion
    );
  }

  // TrustedTypes default policy lives in main.js, so none is registered here.

  const getVideoId = (/** @type {string} */ url) => {
    return window.YouTubeUtils?.getVideoIdFromUrl?.(url) ?? null;
  };

  const queryHTMLElement = (/** @type {string} */ selector) => {
    const el = $(selector);
    return el instanceof HTMLElement ? el : null;
  };

  /**
   * @typedef {HTMLDivElement & {
   *   getProgressState: () => { current: number, duration: number, number: number },
   *   pauseVideo: () => void,
   *   seekTo: (seconds: number, allowSeekAhead?: boolean) => void,
   *   isLifaAdPlaying: () => boolean
   * }} PlayerElement
   */

  /**
   * @return {PlayerElement | null}
   */
  const getPlayer = () => /** @type {PlayerElement | null} */ ($('#movie_player'));

  const isSupportedTabPath = () => {
    const path = window.location.pathname || '';
    return (
      /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(?:\/(videos|shorts|streams))?\/?$/.test(
        path
      ) || /\/(videos|shorts|streams)\/?$/.test(path)
    );
  };

  const isAdPlaying = () => !!$('.ad-interrupting');

  /**
   * Build a /watch URL with optional list and ytp-random query params.
   * @param {string} v
   * @param {string} list
   * @param {string|number|null} [ytpRandom]
   * @returns {string}
   */
  const buildWatchUrl = (v, list, ytpRandom) =>
    `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`;

  const redirect = (
    /** @type {string} */ v,
    /** @type {string} */ list,
    /** @type {string | number | null} */ ytpRandom = null
  ) => {
    const url = buildWatchUrl(v, list, ytpRandom);
    if (isMobileHost()) {
      // Mobile: use direct navigation
      navigate(url);
    } else {
      // Desktop: try YouTube's client-side routing first, with fallback
      try {
        const playlistPanel = $('ytd-playlist-panel-renderer #items');
        if (playlistPanel) {
          const redirector = document.createElement('a');
          redirector.className = 'yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer';
          redirector.setAttribute('hidden', '');
          /** @type {HTMLAnchorElement & { data?: unknown }} */ (redirector).data = {
            commandMetadata: {
              webCommandMetadata: {
                url,
                webPageType: 'WEB_PAGE_TYPE_WATCH',
                rootVe: 3832, // ??? required though
              },
            },
            watchEndpoint: {
              videoId: v,
              playlistId: list,
            },
          };
          playlistPanel.append(redirector);
          redirector.click();
        } else {
          // Fallback: use direct navigation if playlist panel not found
          navigate(url);
        }
      } catch (_e) {
        logS(_e);
        // Fallback: use direct navigation on error
        navigate(url);
      }
    }
  };

  let id = '';
  /** @type {string | null} */
  let observerSubId = null;
  // The lifecycle context routes one-shot timers while the feature runs so
  // a stop clears pending retries; outside the feature (manual facade
  // callers) the plain bound setTimeout applies.
  /**
   * @param {() => void} callback
   * @param {number} delay
   */
  const scheduleManagedTimeout = (callback, delay) => {
    if (playAllCtx) {
      playAllCtx.timeout(callback, delay);
      return;
    }
    setTimeout_(callback, delay);
  };
  const scheduleApplyRetry = (
    /** @type {number} */ retryCount,
    /** @type {string} */ selector,
    /** @type {number} */ timeoutMs
  ) => {
    if (retryCount >= 12) return;
    if (!playAllCtx) return;
    const waitFor =
      /** @type {((selector: string, timeoutMs?: number) => Promise<unknown>) | undefined} */ (
        window.YouTubeUtils?.waitFor || window.YouTubeUtils?.waitForElement
      );
    if (typeof waitFor === 'function') {
      waitFor(selector, timeoutMs)
        .then(() => apply(retryCount + 1))
        .catch(() => apply(retryCount + 1));
      return;
    }
    scheduleManagedTimeout(() => apply(retryCount + 1), 80);
  };

  // Placement for a chip-bar-view-model host: insert directly into its
  // shadow root when available, else as a sibling before the host inside
  // its parent, else inside the host itself (no upgraded parent).
  /**
   * @param {HTMLElement} hostEl
   * @returns {{ parent: HTMLElement | ShadowRoot | null, chipBarInsertBefore: HTMLElement | null }}
   */
  const resolveChipBarPlacement = hostEl => {
    const hostSr = hostEl.shadowRoot;
    if (hostSr instanceof ShadowRoot) {
      return { parent: hostSr, chipBarInsertBefore: null };
    }
    const hostParent = hostEl.parentElement;
    if (hostParent instanceof HTMLElement) {
      return { parent: hostParent, chipBarInsertBefore: hostEl };
    }
    return { parent: hostEl, chipBarInsertBefore: null };
  };

  // Desktop parent resolution: prefer chip-bar hosts that live inside the
  // channel grid; the bare selector can match engagement-panel / miniplayer
  // chip bars which are not the ones we want to augment. The tab container
  // renders earlier, but we want the button in the chip row
  // (Новые/Популярные/Старые), so we look for chip bars first and only fall
  // back to tabs after a few retries (handled by apply()).
  /**
   * @returns {{ parent: HTMLElement | ShadowRoot | null, chipBarHost: HTMLElement | null, chipBarInsertBefore: HTMLElement | null }}
   */
  const resolveDesktopParent = () => {
    // Use document.querySelector directly to bypass the DOM cache, which can
    // return a stale null when the chip bar renders after the first apply() call.
    const desktopChipBarSelectors = [
      'ytd-rich-grid-renderer chip-bar-view-model.ytChipBarViewModelHost',
      'ytd-rich-grid-renderer chip-bar-view-model',
      'ytm-rich-grid-renderer chip-bar-view-model.ytChipBarViewModelHost',
      'ytm-rich-grid-renderer chip-bar-view-model',
      'ytd-two-column-browse-results-renderer chip-bar-view-model',
      'ytd-browse chip-bar-view-model',
      'chip-bar-view-model.ytChipBarViewModelHost',
      'chip-bar-view-model',
      'ytd-feed-filter-chip-bar-renderer iron-selector#chips',
      'ytd-feed-filter-chip-bar-renderer #chips-wrapper',
      'ytd-feed-filter-chip-bar-renderer',
      'yt-chip-cloud-renderer #chips',
      'yt-chip-cloud-renderer .yt-chip-cloud-renderer',
      'ytd-tabbed-page-header chip-bar-view-model',
    ];

    for (const selector of desktopChipBarSelectors) {
      const candidate = $(selector);
      if (!(candidate instanceof HTMLElement)) continue;
      // Ignore chip-bar hosts inside engagement panels / miniplayer / live chat.
      if (
        candidate.tagName === 'CHIP-BAR-VIEW-MODEL' &&
        candidate.closest(
          'ytd-engagement-panel-section-list-renderer, ytd-engagement-panel-title-header-renderer, ytd-miniplayer, ytd-live-chat-frame'
        )
      ) {
        continue;
      }
      if (candidate.tagName !== 'CHIP-BAR-VIEW-MODEL') {
        playAllLogger?.warn?.('Play All', 'Found parent via selector', selector);
        return {
          parent: candidate,
          chipBarHost: null,
          chipBarInsertBefore: null,
        };
      }
      const placement = resolveChipBarPlacement(candidate);
      if (placement.parent instanceof ShadowRoot) {
        // Insert directly into the chip bar's shadow root so the button
        // renders as a flex item in the same row as the chips.
        playAllLogger?.warn?.('Play All', 'Using chip-bar shadow root', {
          selector,
        });
      } else if (placement.chipBarInsertBefore) {
        // The host has not upgraded yet (or has a closed shadow root).
        // Place the button as a sibling immediately before the chip bar
        // so it stays visible even after the component upgrades.
        playAllLogger?.warn?.('Play All', 'Using chip-bar host parent', {
          selector,
          parentTag: placement.parent?.tagName,
        });
      } else {
        playAllLogger?.warn?.('Play All', 'Using chip-bar host directly', {
          selector,
          noParent: true,
        });
      }
      return {
        parent: placement.parent,
        chipBarHost: candidate,
        chipBarInsertBefore: placement.chipBarInsertBefore,
      };
    }
    return { parent: null, chipBarHost: null, chipBarInsertBefore: null };
  };

  // Grid fallback when no chip bar was found on the page: search inside the
  // grid for the chip bar, retry while it is not rendered yet, and finally
  // create a wrapper container at the top of the grid as a last resort.
  /**
   * @param {number} retryCount
   * @returns {{ retry?: boolean, parent: HTMLElement | ShadowRoot | null, chipBarHost: HTMLElement | null, chipBarInsertBefore: HTMLElement | null }}
   */
  const resolveGridParent = retryCount => {
    const grid = queryHTMLElement(
      'ytd-rich-grid-renderer, ytm-rich-grid-renderer, div.ytChipBarViewModelChipWrapper'
    );
    if (!grid) {
      playAllLogger?.warn?.('Play All', 'Grid not found, scheduling retry', {
        retryCount,
      });
      scheduleApplyRetry(
        retryCount,
        'ytd-rich-grid-renderer, ytm-rich-grid-renderer, div.ytChipBarViewModelChipWrapper',
        1500
      );
      return {
        retry: true,
        parent: null,
        chipBarHost: null,
        chipBarInsertBefore: null,
      };
    }

    const chipBarInGrid = grid.querySelector(
      'chip-bar-view-model.ytChipBarViewModelHost, chip-bar-view-model, ytd-feed-filter-chip-bar-renderer iron-selector#chips, ytd-feed-filter-chip-bar-renderer #chips-wrapper, yt-chip-cloud-renderer #chips'
    );
    if (chipBarInGrid instanceof HTMLElement) {
      if (chipBarInGrid.tagName === 'CHIP-BAR-VIEW-MODEL') {
        const placement = resolveChipBarPlacement(chipBarInGrid);
        playAllLogger?.warn?.(
          'Play All',
          placement.parent instanceof ShadowRoot
            ? 'Found chip-bar-view-model inside grid, using shadow root'
            : placement.chipBarInsertBefore
              ? 'Found chip-bar-view-model inside grid, using host parent'
              : 'Found chip-bar-view-model inside grid, using host directly'
        );
        return {
          parent: placement.parent,
          chipBarHost: chipBarInGrid,
          chipBarInsertBefore: placement.chipBarInsertBefore,
        };
      }
      playAllLogger?.warn?.('Play All', 'Found chip bar inside grid', {
        inShadowRoot: Boolean(chipBarInGrid.shadowRoot),
      });
      return {
        parent: chipBarInGrid.shadowRoot || chipBarInGrid,
        chipBarHost: chipBarInGrid,
        chipBarInsertBefore: null,
      };
    }
    if (retryCount < 8) {
      playAllLogger?.warn?.('Play All', 'Chip bar not in grid, scheduling retry', {
        retryCount,
      });
      scheduleApplyRetry(
        retryCount,
        'chip-bar-view-model.ytChipBarViewModelHost, ytd-feed-filter-chip-bar-renderer iron-selector#chips, ytd-feed-filter-chip-bar-renderer #chips-wrapper, yt-chip-cloud-renderer #chips',
        1200
      );
      return {
        retry: true,
        parent: null,
        chipBarHost: null,
        chipBarInsertBefore: null,
      };
    }
    // Last resort: insert a wrapper at the top of the grid
    playAllLogger?.warn?.('Play All', 'Using grid fallback container');
    let existingContainer = grid.querySelector('.yp-button-container');
    if (!existingContainer) {
      // static literal HTML wrapped by Trusted Types policy (_createHTML)
      grid.insertAdjacentHTML('afterbegin', _createHTML('<div class="yp-button-container"></div>'));
      existingContainer = grid.querySelector('.yp-button-container');
    }
    return {
      parent: existingContainer instanceof HTMLElement ? existingContainer : null,
      chipBarHost: null,
      chipBarInsertBefore: null,
    };
  };

  // Insert the Play All button accounting for shadow roots and the
  // chip-bar sibling placement chosen during parent resolution.
  /**
   * @param {HTMLElement | ShadowRoot} parent
   * @param {HTMLElement | null} chipBarInsertBefore
   * @param {HTMLAnchorElement} btn
   * @returns {void}
   */
  const insertPlayAllButton = (parent, chipBarInsertBefore, btn) => {
    if (parent instanceof ShadowRoot) {
      // Inject the Play All styles into the shadow root so the button renders
      // correctly when inserted there. Prepend the button so it appears as the
      // first flex item in the chip bar row.
      const playAllCss = window.YouTubePlusDesignSystem?.getStyle?.('yp-play-all-styles');
      if (playAllCss && !parent.querySelector('style[data-yp-play-all-styles]')) {
        const style = document.createElement('style');
        style.setAttribute('data-yp-play-all-styles', '');
        style.textContent = playAllCss;
        parent.appendChild(style);
        shadowStyleEl = style;
      }
      parent.insertBefore(btn, parent.firstChild);
      playAllLogger?.warn?.('Play All', 'Button inserted into chip-bar shadow root');
    } else if (chipBarInsertBefore && chipBarInsertBefore.parentElement === parent) {
      parent.insertBefore(btn, chipBarInsertBefore);
      parent.classList.add('yp-play-all-parent');
      parentClassEl = /** @type {Element} */ (parent);
      playAllLogger?.warn?.('Play All', 'Button inserted before chip bar', {
        parentSelector: parent.tagName + (parent.className ? `.${parent.className}` : ''),
      });
    } else {
      parent.appendChild(btn);
      playAllLogger?.warn?.('Play All', 'Button appended', {
        parentSelector: parent.tagName + (parent.className ? `.${parent.className}` : ''),
      });
    }
  };

  /**
   * @param {number} retryCount
   * @returns {{ parent: HTMLElement | ShadowRoot, chipBarHost: HTMLElement | null, chipBarInsertBefore: HTMLElement | null } | null}
   */
  const resolveMountTarget_ = retryCount => {
    /** @type {HTMLElement | ShadowRoot | null} */
    let parent = null;
    /** @type {HTMLElement | null} */
    let chipBarHost = null;
    /** @type {HTMLElement | null} */
    let chipBarInsertBefore = null;

    if (isMobileHost()) {
      parent = queryHTMLElement(
        'ytm-feed-filter-chip-bar-renderer .chip-bar-contents, ytm-feed-filter-chip-bar-renderer > div'
      );
    } else {
      ({ parent, chipBarHost, chipBarInsertBefore } = resolveDesktopParent());
    }

    if (parent === null) {
      playAllLogger?.warn?.('Play All', 'No chip bar parent, looking for grid');
      const gridResult = resolveGridParent(retryCount);
      if (gridResult.retry) return null;
      parent = gridResult.parent;
      chipBarHost = gridResult.chipBarHost;
      chipBarInsertBefore = gridResult.chipBarInsertBefore;
    }

    if (parent === null && !isMobileHost()) {
      const tabContainer = $(
        '[role="tablist"], ytd-tabbed-page-header #tabsContainer, ytd-tabbed-page-header'
      );
      if (tabContainer instanceof HTMLElement) {
        parent = tabContainer;
        playAllLogger?.warn?.('Play All', 'Using tab container fallback');
      }
    }

    if (!parent) {
      playAllLogger?.warn?.('Play All', 'Could not find parent container');
      return null;
    }

    return { parent, chipBarHost, chipBarInsertBefore };
  };

  /**
   * @param {string} path
   * @returns {string}
   */
  const getPlaylistPrefix_ = path => {
    if (path.endsWith('/shorts')) return 'UUSH';
    if (path.endsWith('/streams')) return 'UULV';
    return 'UULF';
  };

  /**
   * Href the button must carry for the current path and channel id. The
   * observer rebuilds only when a live button's href differs from this.
   * @returns {string}
   */
  const expectedPlayAllHref_ = () => {
    const allPlaylist = getPlaylistPrefix_(window.location.pathname || '');
    const playlistSuffix = id.startsWith('UC') ? id.substring(2) : id;
    return `/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1&ytp-random=random&ytp-random-initial=1`;
  };

  /**
   * @param {HTMLAnchorElement} btn
   * @param {string} playAllHref
   */
  const wirePlayAllButtonClick_ = (btn, playAllHref) => {
    btnScope?.dispose();
    btnScope = playAllCtx?.scope?.() ?? null;
    if (btnScope?.listen) {
      btnScope.listen(
        btn,
        'click',
        /** @type {EventListener} */ (
          event => {
            event.preventDefault();
            event.stopPropagation();
            navigate(playAllHref);
          }
        )
      );
      btnScope.own(btn);
    } else {
      window.YouTubePlusCleanupManager?.registerListener?.(
        btn,
        'click',
        event => {
          event.preventDefault();
          event.stopPropagation();
          navigate(playAllHref);
        },
        undefined,
        false
      );
    }
  };

  const apply = (retryCount = 0) => {
    playAllLogger?.warn?.('Play All', 'apply() start', {
      id,
      retryCount,
      path: location.pathname,
    });
    if (!playAllCtx) {
      playAllLogger?.warn?.('Play All', 'apply() before runtime start, skipping');
      return;
    }
    if (id === '') {
      playAllLogger?.warn?.('Play All', 'apply() id empty, scheduling addButton retry');
      scheduleManagedTimeout(() => {
        if (id === '') addButton();
      }, 200);
      return;
    }

    const mount = resolveMountTarget_(retryCount);
    if (!mount) return;
    const { parent, chipBarHost, chipBarInsertBefore } = mount;

    const existingButton =
      chipBarHost?.querySelector('.yp-play-all-btn') || parent.querySelector('.yp-play-all-btn');
    if (existingButton) {
      playAllLogger?.warn?.('Play All', 'Button already exists, skipping');
      return;
    }

    const playAllHref = expectedPlayAllHref_();
    playAllLogger?.warn?.('Play All', 'Creating button', {
      id,
      href: playAllHref,
    });
    const btn = document.createElement('a');
    btn.className = 'yp-btn yp-play-all-btn';
    btn.href = playAllHref;
    btn.title = getPlayAllAriaLabel();
    btn.setAttribute('aria-label', getPlayAllAriaLabel());
    btn.textContent = getPlayAllLabel();

    wirePlayAllButtonClick_(btn, playAllHref);

    detachObserver();
    insertPlayAllButton(parent, chipBarInsertBefore, btn);
    scheduleManagedTimeout(
      () =>
        attachObserver(
          $('ytd-rich-grid-renderer') ||
            $('chip-bar-view-model.ytChipBarViewModelHost') ||
            $(
              'ytm-feed-filter-chip-bar-renderer .iron-selected, ytm-feed-filter-chip-bar-renderer .chip-bar-contents .selected'
            )
        ),
      0
    );
  };

  let observerFrame = 0;
  /** @type {(() => void) | null} */
  let observerFrameRelease = null;
  const runObserverWork = () => {
    observerFrame = 0;
    observerFrameRelease = null;
    if (!playAllCtx) return;
    // Mutations on routes that host no Play All button cannot rebuild
    // anything: the runtime stays started over the random-/watch pages the
    // button opens, but those pages have no supported tab path and their
    // grid batches must not drive the rebuild/retry chain.
    if (!isSupportedTabPath()) return;
    // A live button carrying the href the current path and id expect needs no
    // work; the mutation only re-rendered grid content around it.
    const existing = $('.yp-play-all-btn');
    if (existing && existing.getAttribute('href') === expectedPlayAllHref_()) return;
    // Detach before removeButton(): removing children of the observed target
    // triggers childList mutations that would re-queue runObserverWork forever.
    detachObserver();
    removeButton();
    apply();
  };

  const scheduleObserverWork = () => {
    if (!playAllCtx) return;
    if (observerFrame) return;
    // One animated frame, owned by the feature context.
    observerFrameRelease = playAllCtx.frame(runObserverWork) || null;
    observerFrame = 1;
  };

  const detachObserver = () => {
    if (observerSubId && window.YouTubePlusMutationCoordinator?.unsubscribe) {
      window.YouTubePlusMutationCoordinator.unsubscribe(observerSubId);
      observerSubId = null;
    }
  };

  const attachObserver = (/** @type {Element | null | undefined} */ observeTarget) => {
    detachObserver();
    if (!(playAllCtx && observeTarget)) return;

    // The mutation coordinator is always loaded before this module
    // (see build.order.json), so the legacy setInterval polling
    // fallback has been removed: it was dead code in production
    // and would have re-introduced a polling observer.
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.watchTarget) {
      observerSubId = 'playall::observer';
      coordinator.watchTarget(observerSubId, observeTarget, () => scheduleObserverWork(), {
        attributes: false,
        childList: true,
        subtree: true,
      });
    }
  };

  /**
   * @returns {Promise<string | null>}
   */
  const fetchChannelId_ = async () => {
    try {
      const currentUrl = location.href;
      // Only fetch YouTube pages to prevent SSRF
      const parsedUrl = new URL(currentUrl);
      if (
        parsedUrl.hostname !== 'www.youtube.com' &&
        parsedUrl.hostname !== 'youtube.com' &&
        parsedUrl.hostname !== 'm.youtube.com'
      ) {
        playAllLogger?.warn?.('Play All', 'Skipping fetch for non-YouTube URL');
        return null;
      }
      const _fetchCtrl = new AbortController();
      const _fetchTimer = setTimeout_(function () {
        _fetchCtrl.abort();
      }, 10000); // 10 s timeout
      let _fetchResp;
      try {
        _fetchResp = await fetch(currentUrl, { signal: _fetchCtrl.signal });
      } finally {
        clearTimeout(_fetchTimer);
      }
      const html = await _fetchResp.text();
      const canonicalMatch = html.match(
        /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/
      );

      if (canonicalMatch?.[1]) {
        return canonicalMatch[1];
      }
      const channelIdMatch = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
      return channelIdMatch?.[1] ?? null;
    } catch (e) {
      logS(e);
      playAllLogger?.error?.('Play All', 'Error fetching channel data', e);
      return null;
    }
  };

  const addButton = async () => {
    detachObserver();

    playAllLogger?.warn?.('Play All', 'addButton() start', {
      path: location.pathname,
      supported: isSupportedTabPath(),
    });

    if (!playAllCtx) {
      playAllLogger?.warn?.('Play All', 'addButton() runtime not started');
      return;
    }

    if (!isSupportedTabPath()) {
      playAllLogger?.warn?.('Play All', 'addButton() path not supported');
      return;
    }

    // The chip-bar re-render drops the button; watch the grid and, for the new
    // 2026 UI, the chip bar directly.
    const observeTarget =
      $('ytd-rich-grid-renderer') ||
      $('chip-bar-view-model.ytChipBarViewModelHost') ||
      $(
        'ytm-feed-filter-chip-bar-renderer .iron-selected, ytm-feed-filter-chip-bar-renderer .chip-bar-contents .selected'
      );
    attachObserver(observeTarget);

    // This check is necessary for the mobile Interval
    if ($('.yp-play-all-btn')) {
      return;
    }

    const resolvedFromDom = await resolveChannelIdWithRetry(12, 100);
    playAllLogger?.warn?.('Play All', 'resolveChannelIdWithRetry result', {
      resolvedFromDom,
    });
    if (resolvedFromDom) {
      id = resolvedFromDom;
      apply();
      return;
    }

    // Fallback: fetch HTML and parse
    const fetchedId = await fetchChannelId_();
    if (fetchedId) {
      id = fetchedId;
      apply();
      playAllLogger?.warn?.('Play All', 'Channel ID resolved via fetch, button applied');
    } else {
      playAllLogger?.warn?.('Play All', 'Could not extract channel ID');
    }
  };

  const stopAddButtonRetries = () => {
    if (addButtonRetryTimer) {
      clearRetryHandle(addButtonRetryTimer);
    }
    addButtonRetryTimer = null;
  };

  const queueDesktopAddButton = (reset = true) => {
    if (isMobileHost()) {
      addButton();
      return;
    }

    if (reset) {
      stopAddButtonRetries();
    }

    const scheduler = window.YouTubeUtils?.createRetryScheduler?.({
      label: 'playall-add-button',
      interval: 120,
      maxAttempts: 80,
      check: () => {
        if (!(playAllCtx && isSupportedTabPath())) return true;
        addButton();
        return !!$('.yp-play-all-btn');
      },
    });

    if (scheduler) {
      addButtonRetryTimer = scheduler;
      return;
    }

    addButton();
  };

  // Removing the button prevents it from still existing when switching between "Videos", "Shorts", and "Live"
  // This is necessary due to the mobile Interval requiring a check for an already existing button
  const removeButton = () => {
    $$('.yp-play-all-btn, .yp-random-badge, .yp-random-notice').forEach(element =>
      element.remove()
    );
  };

  let playAllRuntimeStarted = false;
  /** Release every resource the runtime owns and restore YouTube DOM. */
  const resetPlayAllRuntime = () => {
    stopAddButtonRetries();
    detachObserver();
    observerFrameRelease?.();
    observerFrameRelease = null;
    // Cancelling the frame must free the gate too, or a later mutation can
    // never schedule observer work again.
    observerFrame = 0;
    removeButton();
    id = '';
    if (typeof stopRandomPlayTimers === 'function') stopRandomPlayTimers();
    keydownRelease?.();
    keydownRelease = null;
    timeupdateRelease?.();
    timeupdateRelease = null;
    if (randomScope) {
      randomScope.dispose();
      randomScope = null;
    }
    if (randomPrevPanel) {
      randomPrevPanel.removeAttribute('ytp-random');
      randomPrevPanel.removeAttribute('data-yp-random-delegated');
      randomPrevPanel = null;
    }
    if (btnScope) {
      btnScope.dispose();
      btnScope = null;
    }
    if (parentClassEl) {
      parentClassEl.classList?.remove('yp-play-all-parent');
      parentClassEl = null;
    }
    if (shadowStyleEl) {
      shadowStyleEl.remove();
      shadowStyleEl = null;
    }
    if (badgeAnchorPrevHref !== null) {
      const badgeAnchor = $('#secondary ytd-playlist-panel-renderer #header h3 a');
      if (badgeAnchor instanceof HTMLAnchorElement) {
        badgeAnchor.setAttribute('href', badgeAnchorPrevHref);
      }
      badgeAnchorPrevHref = null;
    }
  };
  /** Mount the feature styles on the lifecycle context. @param {FeatureContext} ctx */
  const mountStyles = ctx => {
    const css = window.YouTubePlusDesignSystem?.getStyle?.('yp-play-all-styles') || '';
    ctx.style('yp-play-all-styles', css);
  };

  /**
   * @param {FeatureContext | null} [ctx]
   */
  const createEventRegistrar_ = ctx => {
    /**
     * @param {EventTarget} target
     * @param {string} type
     * @param {EventListener} fn
     * @param {AddEventListenerOptions | boolean} [opts]
     */
    return (target, type, fn, opts) => {
      if (ctx?.listen) {
        return ctx.listen(target, type, fn, typeof opts === 'boolean' ? { capture: opts } : opts);
      }
      if (_cm?.registerListener) return _cm.registerListener(target, type, fn, opts);
      return window.YouTubePlusCleanupManager?.registerListener?.(target, type, fn, opts, true);
    };
  };

  /**
   * Wire the SPA/visibility reactions for one runtime session. The lifecycle
   * path owns them with the context; manual facade callers keep the
   * CleanupManager registrations.
   * @param {FeatureContext | null} [ctx]
   */
  const wireNavigation = ctx => {
    const register = createEventRegistrar_(ctx);
    if (isMobileHost()) {
      // The "yt-navigate-finish" event does not fire on mobile
      // Detect URL changes via pushState/replaceState override + popstate (lightweight)
      let lastUrl = location.href;
      const checkUrlChange = () => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          addButton();
        }
      };
      const _ytpNavHandler = () => scheduleManagedTimeout(checkUrlChange, 50);
      register(window, 'yp-history-navigate', _ytpNavHandler, { passive: true });
      register(window, 'popstate', checkUrlChange, { passive: true });
      // Initial call
      addButton();
      return;
    }

    const _navStartHandler = () => {
      stopAddButtonRetries();
      removeButton();
      id = '';
    };
    const _navFinishHandler = () => {
      queueDesktopAddButton();
    };
    const _pageshowHandler = () => scheduleManagedTimeout(() => queueDesktopAddButton(), 120);
    const _visChangeHandler = () => {
      if (document.visibilityState === 'visible') {
        queueDesktopAddButton();
      }
    };

    register(document, 'yt-navigate-start', _navStartHandler);
    register(document, 'yt-navigate-finish', _navFinishHandler);
    register(document, 'yt-page-data-updated', _navFinishHandler);
    register(document, 'yt-page-data-fetched', _navFinishHandler);
    register(window, 'pageshow', _pageshowHandler);
    register(document, 'visibilitychange', _visChangeHandler);
    register(window, 'yp:nav-refresh', () => queueDesktopAddButton(false));

    // Also attempt to add buttons on initial script run in case the SPA navigation event
    // already happened before this script was loaded (some browsers/firefox timing).
    onDomReady(() => queueDesktopAddButton(false));
    scheduleManagedTimeout(() => queueDesktopAddButton(false), 120);
  };

  /**
   * Runtime entry point. The lifecycle host calls it with its context;
   * the manual facade path (testHooks.init()) calls it without one.
   * @param {FeatureContext} ctx
   */
  const startPlayAllRuntime = ctx => {
    playAllLogger?.warn?.('Play All', 'startPlayAllRuntime()', {
      runtimeStarted: playAllRuntimeStarted,
      path: location.pathname,
    });
    if (playAllRuntimeStarted) {
      // Re-entry: re-queue an immediate attempt on the existing wiring.
      resetPlayAllRuntime();
      return;
    }
    playAllRuntimeStarted = true;
    playAllCtx = ctx;
    mountStyles(ctx);
    wireNavigation(ctx);

    // Random play feature
    (() => {
      // Random play is not supported for mobile devices
      if (isMobileHost()) {
        return;
      }

      /**
       * @typedef {{
       *   params: URLSearchParams,
       *   mode: string,
       *   list: string,
       *   storageKey: string
       * }} RandomPlayConfig
       */

      const getParams = () => new URLSearchParams(window.location.search);

      /** @returns {RandomPlayConfig | null} */
      const getRandomConfig = () => {
        const params = getParams();
        const modeParam = params.get(RANDOM_PARAM);
        if (!modeParam || modeParam === '0') return null;
        const list = params.get('list') || '';
        if (!list) return null;

        return {
          params,
          mode: 'random',
          list,
          storageKey: `ytp-random-${list}`,
        };
      };

      const getStorage = (/** @type {string} */ storageKey) => {
        try {
          return JSON.parse(U.storage?.getItem(storageKey) || '{}');
        } catch (_e) {
          logS(_e);
          return {};
        }
      };

      const isWatched = (/** @type {string} */ storageKey, /** @type {string} */ videoId) =>
        getStorage(storageKey)[videoId];
      const markWatched = (/** @type {string} */ storageKey, /** @type {string} */ videoId) => {
        U.storage?.setItem(
          storageKey,
          JSON.stringify({ ...getStorage(storageKey), [videoId]: true })
        );
        document
          .querySelectorAll(`#wc-endpoint[href*="${videoId}"]`)
          .forEach(element => element.parentElement?.setAttribute('hidden', ''));
      };

      /**
       * @param {string} storageKey
       * @returns {string | null}
       */
      const selectNextRandomVideo_ = storageKey => {
        const videos = Object.entries(getStorage(storageKey)).filter(([_, watched]) => !watched);
        if (videos.length === 0) return null;
        let videoIndex = Math.floor(Math.random() * videos.length);
        if (videoIndex < 0) videoIndex = 0;
        if (videoIndex >= videos.length) videoIndex = videos.length - 1;
        return videos[videoIndex][0];
      };

      /**
       * @param {string} videoId
       * @param {string} listId
       * @param {string} mode
       */
      const fallbackManualRedirect_ = (videoId, listId, mode) => {
        const redirector = document.createElement('a');
        redirector.className = 'yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer';
        redirector.setAttribute('hidden', '');
        /** @type {HTMLAnchorElement & { data?: unknown }} */ (redirector).data = {
          commandMetadata: {
            webCommandMetadata: {
              url: `/watch?v=${videoId}&list=${listId}&ytp-random=${mode}`,
              webPageType: 'WEB_PAGE_TYPE_WATCH',
              rootVe: 3832,
            },
          },
          watchEndpoint: {
            videoId,
            playlistId: listId,
          },
        };
        const listContainer = $('ytd-playlist-panel-renderer #items');
        if (listContainer instanceof HTMLElement) {
          listContainer.append(redirector);
        } else {
          const safeAppendRoot = document.body || document.documentElement;
          if (safeAppendRoot) {
            safeAppendRoot.appendChild(redirector);
          }
        }
        redirector.click();
      };

      /**
       * @param {string} videoId
       * @param {RandomPlayConfig} cfg
       * @param {boolean} reload
       */
      const navigateNextRandom_ = (videoId, cfg, reload) => {
        const params = new URLSearchParams(window.location.search);
        if (reload) {
          params.set('v', videoId);
          params.set('ytp-random', cfg.mode);
          params.delete('t');
          params.delete('index');
          params.delete('ytp-random-initial');
          navigate(`${window.location.pathname}?${params.toString()}`);
          return;
        }

        try {
          const listId = params.get('list') || '';
          redirect(videoId, listId, cfg.mode);
        } catch (error) {
          logS(error);
          playAllLogger?.error?.(
            'Play All',
            'Error using redirect(), falling back to manual redirect',
            error
          );
          fallbackManualRedirect_(videoId, params.get('list') || '', cfg.mode);
        }
      };

      const playNextRandom = (/** @type {RandomPlayConfig} */ cfg, reload = false) => {
        const playerInstance = getPlayer();
        if (playerInstance && typeof playerInstance.pauseVideo === 'function') {
          playerInstance.pauseVideo();
        }

        const nextVideoId = selectNextRandomVideo_(cfg.storageKey);
        if (!nextVideoId) return;

        navigateNextRandom_(nextVideoId, cfg, reload);
      };

      /** @type {number | { stop: () => void } | null} */
      let applyRetryTimeoutId = null;
      /** @type {boolean} */
      let _progressTrackingInitialized = false;
      /** @type {((e: Event) => void) | null} */
      let _activeKeydownHandler = null;
      /** @type {(() => void) | null} */
      let _activeTimeupdateHandler = null;
      /** @type {HTMLVideoElement | null} */
      let _activeVideoEl = null;

      stopRandomPlayTimers = () => {
        if (applyRetryTimeoutId) {
          if (typeof applyRetryTimeoutId === 'number') {
            clearTimeout(applyRetryTimeoutId);
          } else {
            applyRetryTimeoutId.stop();
          }
        }
        applyRetryTimeoutId = null;
        _progressTrackingInitialized = false;
        keydownRelease?.();
        keydownRelease = null;
        timeupdateRelease?.();
        timeupdateRelease = null;
        // Remove delegated keydown/timeupdate so re-entry doesn't stack handlers
        if (_activeKeydownHandler) {
          document.removeEventListener('keydown', _activeKeydownHandler, true);
          _activeKeydownHandler = null;
        }
        if (_activeTimeupdateHandler && _activeVideoEl) {
          _activeVideoEl.removeEventListener('timeupdate', _activeTimeupdateHandler);
          _activeTimeupdateHandler = null;
          _activeVideoEl = null;
        }
      };

      /**
       * @param {Element | null} headerContainer
       */
      const appendRandomNotice_ = headerContainer => {
        if (headerContainer && !headerContainer.querySelector('.yp-random-notice')) {
          const noticeSpan = document.createElement('span');
          noticeSpan.className = 'yp-random-notice';
          noticeSpan.textContent = t('playAllMode');
          headerContainer.appendChild(noticeSpan);
        }
      };

      /**
       * @param {Element} playlistContainer
       * @returns {HTMLAnchorElement[]}
       */
      const collectPlaylistAnchors_ = playlistContainer => {
        const anchorSelectors = [
          '#wc-endpoint',
          'ytd-playlist-panel-video-renderer a#wc-endpoint',
          'ytd-playlist-panel-video-renderer a',
          'a#video-title',
          '#secondary ytd-playlist-panel-renderer a[href*="/watch?"]',
        ];
        /** @type {HTMLAnchorElement[]} */
        const anchors = [];
        anchorSelectors.forEach(sel => {
          playlistContainer.querySelectorAll(sel).forEach(a => {
            if (a instanceof Element && a.tagName === 'A')
              anchors.push(/** @type {HTMLAnchorElement} */ (a));
          });
        });

        /** @type {HTMLAnchorElement[]} */
        const uniq = [];
        const seen = new Set();
        anchors.forEach(a => {
          const href = a.href || a.getAttribute('href') || '';
          if (!seen.has(href)) {
            seen.add(href);
            uniq.push(a);
          }
        });
        return uniq;
      };

      /**
       * @param {HTMLAnchorElement} element
       * @param {RandomPlayConfig} cfg
       * @param {Record<string, boolean>} storage
       */
      const processPlaylistAnchor_ = (element, cfg, storage) => {
        let videoId = null;
        try {
          videoId = new URL(element.href, window.location.origin).searchParams.get('v');
        } catch (_e) {
          logS(_e);
          videoId = new URLSearchParams(element.search || '').get('v');
        }
        if (!videoId) return;

        if (!isWatched(cfg.storageKey, videoId)) {
          storage[videoId] = false;
        }

        try {
          const u = new URL(element.href, window.location.origin);
          u.searchParams.set(RANDOM_PARAM, cfg.mode);
          element.href = u.toString();
        } catch (_e) {
          logS(_e);
        }

        element.setAttribute('data-yp-random-link', 'true');
        const entryKey = getVideoId(element.href);
        if (entryKey && isWatched(cfg.storageKey, entryKey)) {
          element.parentElement?.setAttribute('hidden', '');
        }
      };

      /**
       * @param {Element} playlistContainer
       */
      const delegatePlaylistClicks_ = playlistContainer => {
        if (!playlistContainer || playlistContainer.hasAttribute('data-yp-random-delegated'))
          return;
        playlistContainer.setAttribute('data-yp-random-delegated', 'true');
        const delegationHandler = /** @type {EventListener} */ (
          event => {
            const tgt = event.target instanceof Element ? event.target : null;
            const link = /** @type {HTMLAnchorElement | null} */ (
              tgt?.closest?.('a[data-yp-random-link]') ?? null
            );
            if (link?.href) {
              event.preventDefault();
              navigate(link.href);
            }
          }
        );
        if (randomScope?.listen) {
          randomScope.listen(playlistContainer, 'click', delegationHandler);
        } else {
          window.YouTubePlusCleanupManager?.registerListener?.(
            playlistContainer,
            'click',
            delegationHandler,
            undefined,
            false
          );
        }
      };

      /**
       * @param {Element} playlistContainer
       * @param {RandomPlayConfig} cfg
       */
      const setupRandomBadge_ = (playlistContainer, cfg) => {
        const header = playlistContainer.querySelector('h3 a');
        if (header?.tagName !== 'A') return;
        const anchorHeader = /** @type {HTMLAnchorElement} */ (/** @type {unknown} */ (header));
        anchorHeader.insertAdjacentHTML(
          'beforeend',
          _createHTML(
            ` <span class="yp-badge yp-random-badge">Play All <span class="yp-random-badge-close">&times;</span></span>`
          )
        );
        if (badgeAnchorPrevHref === null) {
          badgeAnchorPrevHref = anchorHeader.getAttribute('href');
        }
        anchorHeader.href = '#';
        const badge = anchorHeader.querySelector('.yp-random-badge');
        if (badge) {
          const badgeClick = /** @type {EventListener} */ (
            event => {
              event.preventDefault();
              U.storage?.removeItem(cfg.storageKey);
              const params = new URLSearchParams(location.search);
              params.delete('ytp-random');
              navigate(`${window.location.pathname}?${params.toString()}`);
            }
          );
          if (randomScope?.listen) {
            randomScope.listen(badge, 'click', badgeClick);
          } else {
            window.YouTubePlusCleanupManager?.registerListener?.(
              badge,
              'click',
              badgeClick,
              undefined,
              false
            );
          }
        }
      };

      /**
       * @param {RandomPlayConfig} cfg
       */
      const setupKeydownHandler_ = cfg => {
        const _keydownHandler = (/** @type {Event} */ event) => {
          if (!(event instanceof KeyboardEvent)) return;
          if (event.shiftKey && event.key.toLowerCase() === 'n') {
            event.stopImmediatePropagation();
            event.preventDefault();
            const videoId = getVideoId(location.href);
            if (videoId) markWatched(cfg.storageKey, videoId);
            playNextRandom(cfg, true);
          }
        };
        if (_activeKeydownHandler) {
          document.removeEventListener('keydown', _activeKeydownHandler, true);
          _activeKeydownHandler = null;
        }
        _activeKeydownHandler = _keydownHandler;
        if (randomScope?.listen) {
          keydownRelease = randomScope.listen(document, 'keydown', _keydownHandler, {
            capture: true,
          });
        } else if (_cm?.registerListener) {
          keydownRelease = null;
          _cm.registerListener(document, 'keydown', _keydownHandler, true);
        } else {
          keydownRelease = null;
          window.YouTubePlusCleanupManager?.registerListener?.(
            document,
            'keydown',
            _keydownHandler,
            true,
            true
          );
        }
      };

      /**
       * @param {string} mode
       */
      const syncRandomUrlParam_ = mode => {
        const params = new URLSearchParams(location.search);
        params.set('ytp-random', mode);
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
      };

      /**
       * @param {PlayerElement | null} player
       * @returns {{ current: number, duration: number } | null}
       */
      const getValidProgressState_ = player => {
        if (!player || typeof player.getProgressState !== 'function') return null;
        const state = player.getProgressState();
        if (!state) return null;
        if (typeof state.current !== 'number' || typeof state.duration !== 'number') return null;
        return state;
      };

      /**
       * @param {PlayerElement | null} player
       * @param {RandomPlayConfig} cfg
       */
      const triggerAutoplayNext_ = (player, cfg) => {
        if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
        if (player && typeof player.seekTo === 'function') player.seekTo(0);
        playNextRandom(cfg);
      };

      /**
       * @param {PlayerElement | null} player
       * @param {string | null} videoId
       * @param {RandomPlayConfig} cfg
       */
      const checkAutoplayProgress_ = (player, videoId, cfg) => {
        const state = getValidProgressState_(player);
        if (!state || isAdPlaying()) return;

        if (state.current / state.duration >= 0.9 && videoId) {
          markWatched(cfg.storageKey, videoId);
        }

        if (state.current >= state.duration - 2) {
          triggerAutoplayNext_(player, cfg);
        }
      };

      /**
       * @param {string | null} videoId
       * @param {RandomPlayConfig} cfg
       */
      const hijackNextButton_ = (videoId, cfg) => {
        const nextButton = $('#ytd-player .ytp-next-button.ytp-button:not([ytp-random="applied"])');
        if (!(nextButton instanceof HTMLElement)) return;

        const newButton = document.createElement('span');
        newButton.className = nextButton.className;
        window.YouTubeUtils.renderTemplateClone(newButton, nextButton.innerHTML);
        nextButton.replaceWith(newButton);

        newButton.setAttribute('ytp-random', 'applied');
        const nextClick = () => {
          if (videoId) markWatched(cfg.storageKey, videoId);
          playNextRandom(cfg);
        };
        if (randomScope?.listen) {
          randomScope.listen(newButton, 'click', nextClick);
        } else {
          window.YouTubePlusCleanupManager?.registerListener?.(
            newButton,
            'click',
            nextClick,
            undefined,
            false
          );
        }
      };

      /**
       * @param {RandomPlayConfig} cfg
       */
      const setupProgressTracking_ = cfg => {
        if (_progressTrackingInitialized) return;
        const videoEl = $('video');
        if (!videoEl) return;

        if (_activeTimeupdateHandler && _activeVideoEl) {
          _activeVideoEl.removeEventListener('timeupdate', _activeTimeupdateHandler);
        }

        const handleProgress = () => {
          const videoId = getVideoId(location.href);
          syncRandomUrlParam_(cfg.mode);
          const player = getPlayer();
          // The next button is taken over only once the player reports progress.
          if (!getValidProgressState_(player)) return;
          checkAutoplayProgress_(player, videoId, cfg);
          hijackNextButton_(videoId, cfg);
        };

        _activeTimeupdateHandler = handleProgress;
        _activeVideoEl = /** @type {HTMLVideoElement} */ (videoEl);
        if (randomScope?.listen) {
          timeupdateRelease = randomScope.listen(videoEl, 'timeupdate', handleProgress, {
            passive: true,
          });
        } else {
          timeupdateRelease = null;
          window.YouTubePlusCleanupManager?.registerListener?.(
            videoEl,
            'timeupdate',
            handleProgress,
            { passive: true },
            false
          );
        }
        _progressTrackingInitialized = true;
      };

      const applyRandomPlay = (/** @type {RandomPlayConfig} */ cfg) => {
        if (!playAllCtx) return;
        if (!window.location.pathname.endsWith('/watch')) return;

        const playlistContainer = $('#secondary ytd-playlist-panel-renderer');
        if (playlistContainer === null || playlistContainer.hasAttribute('ytp-random')) {
          return;
        }

        playlistContainer.setAttribute('ytp-random', 'applied');

        if (randomPrevPanel !== playlistContainer) {
          randomScope?.dispose();
          randomScope = playAllCtx?.scope?.() ?? null;
          randomPrevPanel = playlistContainer;
          keydownRelease = null;
          timeupdateRelease = null;
        }

        appendRandomNotice_(playlistContainer.querySelector('#header'));

        /** @type {Record<string, boolean>} */
        const storage = getStorage(cfg.storageKey);
        const uniq = collectPlaylistAnchors_(playlistContainer);
        uniq.forEach(element => processPlaylistAnchor_(element, cfg, storage));

        delegatePlaylistClicks_(playlistContainer);
        U.storage?.setItem(cfg.storageKey, JSON.stringify(storage));

        const currentVideoId = getVideoId(location.href);
        if (
          cfg.params.get('ytp-random-initial') === '1' ||
          (currentVideoId && isWatched(cfg.storageKey, currentVideoId))
        ) {
          playNextRandom(cfg);
          return;
        }

        setupRandomBadge_(playlistContainer, cfg);
        setupKeydownHandler_(cfg);
        setupProgressTracking_(cfg);
      };

      scheduleApplyRandomPlay = () => {
        if (!playAllCtx) return;
        stopRandomPlayTimers?.();

        if (!window.location.pathname.endsWith('/watch')) return;

        const performApply = () => {
          const cfg = getRandomConfig();
          if (!cfg) return false;

          // Storage needs to now be { [videoId]: bool }
          try {
            const current = U.storage?.getItem(cfg.storageKey);
            if (current && Array.isArray(JSON.parse(current))) {
              U.storage?.removeItem(cfg.storageKey);
            }
          } catch (_e) {
            logS(_e);
            U.storage?.removeItem(cfg.storageKey);
          }

          applyRandomPlay(cfg);
          // Consider done when playlist panel is found
          return !!$('#secondary ytd-playlist-panel-renderer[ytp-random]');
        };

        // Use shared retry scheduler instead of manual recursion
        const scheduler = window.YouTubeUtils?.createRetryScheduler?.({
          check: performApply,
          maxAttempts: 30,
          interval: 250,
        });
        if (scheduler) applyRetryTimeoutId = scheduler;
      };

      const onNavigate = () => {
        if (!playAllCtx) {
          stopRandomPlayTimers?.();
          return;
        }
        stopRandomPlayTimers?.();
        scheduleApplyRandomPlay?.();
      };

      onNavigate();
      const _navFinishRandom = () => scheduleManagedTimeout(onNavigate, 200);
      if (ctx?.listen) {
        ctx.listen(document, 'yt-navigate-finish', _navFinishRandom, { passive: true });
      } else if (_cm?.registerListener) {
        _cm.registerListener(document, 'yt-navigate-finish', _navFinishRandom);
      } else {
        window.YouTubePlusCleanupManager?.registerListener?.(
          document,
          'yt-navigate-finish',
          _navFinishRandom,
          undefined,
          true
        );
      }
    })();
  };

  const playAllFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'playall',
    settingsKey: 'enablePlayAll',
    // The button lives on channel tabs; random play runs on the playlist and
    // watch URLs the button opens, which carry the ytp-random query.
    routes: ['channel', 'watch', 'playlist'],
    when: () =>
      isSupportedTabPath() || new URLSearchParams(window.location.search).has(RANDOM_PARAM),
    start: startPlayAllRuntime,
    stop: () => {
      resetPlayAllRuntime();
      playAllRuntimeStarted = false;
      playAllCtx = null;
    },
  });

  // Starts the feature when its setting is on, then follows the setting.
  onDomReady(() => playAllFeature?.sync());

  // Feature facade
  const YouTubePlusPlayall = {};
  // Test-only surface: internal entry points and state accessors live here,
  // not on the facade root.
  U?.exposeTestHooks?.(YouTubePlusPlayall, {
    init: startPlayAllRuntime,
    cleanup: () => {
      resetPlayAllRuntime();
      playAllRuntimeStarted = false;
      playAllCtx = null;
    },
    isSupportedTabPath,
    clearRetryHandle,
    getPlayAllLabel,
    getPlayAllAriaLabel,
    hasTranslation,
    resolveMetaChannelId_,
    resolveDomNodeChannelId_,
    resolveInitialDataChannelId_,
    resolveChannelIdFromDom,
    resolveChannelIdWithRetry,
    buildWatchUrl,
    redirect,
    scheduleManagedTimeout,
    scheduleApplyRetry,
    resolveChipBarPlacement,
    resolveDesktopParent,
    resolveGridParent,
    resolveMountTarget_,
    getPlaylistPrefix_,
    insertPlayAllButton,
    wirePlayAllButtonClick_,
    apply,
    addButton,
    removeButton,
    fetchChannelId_,
    mountStyles,
    createEventRegistrar_,
    wireNavigation,
    getId: () => id,
    setId: (/** @type {string} */ val) => {
      id = val;
    },
    isAdPlaying,
    getPlayer,
    scheduleApplyRandomPlay: () => scheduleApplyRandomPlay?.(),
    stopRandomPlayTimers: () => stopRandomPlayTimers?.(),
    navigate,
  });

  if (typeof window !== 'undefined') {
    window.YouTubePlusPlayall = YouTubePlusPlayall;
  }
})();
