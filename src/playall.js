// Play All
(async function () {
  'use strict';
  const setTimeout_ = setTimeout.bind(window);
  const _createHTML = window._ytpDefaults?.createHTML || ((/** @type {string} */ s) => s);
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

  let featureEnabled = true;
  /** @type {(() => void)|null} */
  let stopRandomPlayTimers = null;
  /** @type {(() => void)|null} */
  let scheduleApplyRandomPlay = null;
  /** @type {any|null} */
  let addButtonRetryTimer = null;
  const setFeatureEnabled = (/** @type {boolean|undefined} */ nextEnabled) => {
    featureEnabled = nextEnabled !== false;
    if (!featureEnabled) {
      try {
        removeButton();
      } catch (e) {
        /* feature disable cleanup */
      }
      try {
        if (addButtonRetryTimer) {
          clearTimeout(addButtonRetryTimer);
          if (typeof addButtonRetryTimer.cancel === 'function') addButtonRetryTimer.cancel();
        }
        addButtonRetryTimer = null;
      } catch (e) {
        /* timer cleanup safe to ignore */
      }
      try {
        if (typeof stopRandomPlayTimers === 'function') stopRandomPlayTimers();
      } catch (e) {
        /* timer cleanup safe to ignore */
      }
    } else {
      try {
        queueDesktopAddButton();
      } catch (e) {
        /* feature enable may fail */
      }
      try {
        if (typeof scheduleApplyRandomPlay === 'function') scheduleApplyRandomPlay();
      } catch (e) {
        /* feature enable may fail */
      }
    }
  };

  featureEnabled = window.YouTubeUtils?.loadFeatureEnabled?.('enablePlayAll') ?? true;

  // Shared DOM helpers from YouTubeUtils
  const $ = window.YouTubeUtils.$;
  const $$ = window.YouTubeUtils.$$;
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
          window.console.warn('[Play All] DOMReady callback error:', e);
        }
      }
    };
    if (!ready) document.addEventListener('DOMContentLoaded', run, { once: true });
    return (/** @type {() => void} */ cb) => {
      if (ready) cb();
      else queue.push(cb);
    };
  })();

  const t = window.YouTubeUtils.t;

  const hasTranslation = (/** @type {string} */ key) => {
    try {
      if (window.YouTubePlusI18n?.hasTranslation) return window.YouTubePlusI18n.hasTranslation(key);
    } catch (e) {
      /* i18n check optional */
    }
    return false;
  };

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

  const resolveChannelIdFromDom = () => {
    try {
      const metaChannel = $('meta[itemprop="channelId"]');
      const metaValue = metaChannel?.getAttribute('content');
      if (metaValue && /^UC[a-zA-Z0-9_-]{22}$/.test(metaValue)) return metaValue;

      const canonical = $('link[rel="canonical"]');
      const canonicalHref = canonical?.getAttribute('href') || '';
      const canonicalMatch = canonicalHref.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
      if (canonicalMatch?.[1]) return canonicalMatch[1];

      const browseNode = $('ytd-browse[page-subtype="channels"]');
      const attrId =
        browseNode?.getAttribute?.('channel-id') || browseNode?.getAttribute?.('external-id');
      if (attrId && /^UC[a-zA-Z0-9_-]{22}$/.test(attrId)) return attrId;

      const channelHrefNode = $(
        'ytd-channel-name a[href*="/channel/UC"], #channel-name a[href*="/channel/UC"], a[href^="/channel/UC"]'
      );
      const channelHref = channelHrefNode?.getAttribute?.('href') || '';
      const channelHrefMatch = channelHref.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
      if (channelHrefMatch?.[1]) return channelHrefMatch[1];

      const href = location.href;
      const fromUrl = href.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
      if (fromUrl?.[1]) return fromUrl[1];

      const initialData = window.ytInitialData;
      const headerId =
        initialData?.header?.c4TabbedHeaderRenderer?.channelId ||
        initialData?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.find?.(
          (/** @type {any} */ p) => /^UC[a-zA-Z0-9_-]{22}$/.test(p?.text?.content || '')
        )?.text?.content;
      if (headerId && /^UC[a-zA-Z0-9_-]{22}$/.test(headerId)) return headerId;

      if (window.ytcfg?.get) {
        const cfgId = window.ytcfg.get('CHANNEL_ID');
        if (cfgId && /^UC[a-zA-Z0-9_-]{22}$/.test(cfgId)) return cfgId;
      }
    } catch (e) {
      window.console.warn('[Play All] Failed to resolve channel ID from DOM:', e);
    }
    return null;
  };

  const scheduleNonCritical = (/** @type {() => void} */ fn) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: 2000 });
    } else {
      setTimeout(fn, 200);
    }
  };

  /** @type {{ script?: { version?: string } } | null} */
  const gmInfo =
    /** @type {{ script?: { version?: string } } | null} */ (
      /** @type {any} */ (globalThis)?.GM_info ?? null
    ) ||
    /** @type {{ script?: { version?: string } } | null} */ (
      /** @type {any} */ (window)?.GM_info ?? null
    );

  const scriptVersion = gmInfo?.script?.version ?? null;
  if (scriptVersion && /-(alpha|beta|dev|test)$/.test(scriptVersion)) {
    try {
      window.YouTubeUtils &&
        window.YouTubeUtils?.logger?.info?.(
          '%cytp - YouTube Play All\n',
          'color: var(--yt-playall-accent-purple); font-size: 32px; font-weight: bold',
          'You are currently running a test version:',
          scriptVersion
        );
    } catch (e) {
      /* logging non-critical */
    }
  }

  // TrustedTypes default policy is registered in main.js — no duplicate needed here

  const insertStylesSafely = (/** @type {string} */ html) => {
    try {
      const target = document.head || document.documentElement;
      if (target && typeof target.insertAdjacentHTML === 'function') {
        // eslint-disable-next-line no-unsanitized/method -- pre-sanitized via Trusted Types policy (_createHTML)
        target.insertAdjacentHTML('beforeend', _createHTML(html));
        return;
      }

      // If head isn't available yet, wait for DOMContentLoaded and insert then.
      const onReady = () => {
        try {
          const t = document.head || document.documentElement;
          if (t && typeof t.insertAdjacentHTML === 'function') {
            // eslint-disable-next-line no-unsanitized/method -- pre-sanitized via Trusted Types policy (_createHTML)
            t.insertAdjacentHTML('beforeend', _createHTML(html));
          }
        } catch (e) {
          /* DOM insertion may fail before head available */
        }
      };
      onDomReady(onReady);
    } catch (e) {
      window.console.warn('[Play All] Style insertion error:', e);
    }
  };

  scheduleNonCritical(() => {
    const css =
      window.YouTubePlusStyleResources?.playall ||
      `.ytp-play-all-btn{display:inline-flex;align-items:center;padding:0 12px;height:32px;border-radius:8px;background:linear-gradient(135deg,var(--yt-playall-accent-purple),var(--yt-playall-accent-blue));color:#fff;font-size:1.4rem;font-weight:500;text-decoration:none;white-space:nowrap;cursor:pointer;flex-shrink:0;user-select:none;font-family:Roboto,Arial,sans-serif;letter-spacing:.007em;line-height:1;vertical-align:middle;border:none;outline:none}.ytp-play-all-btn:hover{opacity:.85}`;
    insertStylesSafely(`<style>${css}</style>`);
  });

  const getVideoId = (/** @type {string} */ url) => {
    try {
      return new URLSearchParams(new URL(url).search).get('v');
    } catch (e) {
      return null;
    }
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
   * @return {{ getProgressState: () => { current: number, duration: number, number: number }, pauseVideo: () => void, seekTo: (arg0: number) => void, isLifaAdPlaying: () => boolean }|null} player
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

  const redirect = (/** @type {string} */ v, /** @type {string} */ list, ytpRandom = null) => {
    if (location.host === 'm.youtube.com') {
      // Mobile: use direct navigation
      const url = `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`;
      window.location.href = url;
    } else {
      // Desktop: try YouTube's client-side routing first, with fallback
      try {
        const playlistPanel = $('ytd-playlist-panel-renderer #items');
        if (playlistPanel) {
          const redirector = document.createElement('a');
          redirector.className = 'yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer';
          redirector.setAttribute('hidden', '');
          redirector.data = {
            commandMetadata: {
              webCommandMetadata: {
                url: `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`,
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
          const url = `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`;
          window.location.href = url;
        }
      } catch (e) {
        // Fallback: use direct navigation on error
        const url = `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`;
        window.location.href = url;
      }
    }
  };

  let id = '';
  /** @type {string | null} */
  let observerSubId = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let observerFallbackTimerId = null;
  const scheduleApplyRetry = (
    /** @type {number} */ retryCount,
    /** @type {string} */ selector,
    /** @type {number} */ timeoutMs
  ) => {
    if (retryCount >= 12) return;
    const waitFor = window.YouTubeUtils?.waitFor || window.YouTubeUtils?.waitForElement;
    if (typeof waitFor === 'function') {
      waitFor(selector, timeoutMs)
        .then(() => apply(retryCount + 1))
        .catch(() => apply(retryCount + 1));
      return;
    }
    requestAnimationFrame(() => apply(retryCount + 1));
  };

  const apply = (retryCount = 0) => {
    if (id === '') {
      // do not apply prematurely, caused by mutation observer
      window.console.warn('[Play All] Channel ID not yet determined');
      return;
    }

    let parent = null;
    if (location.host === 'm.youtube.com') {
      parent = queryHTMLElement(
        'ytm-feed-filter-chip-bar-renderer .chip-bar-contents, ytm-feed-filter-chip-bar-renderer > div'
      );
    } else {
      // Use document.querySelector directly to bypass the DOM cache, which can
      // return a stale null when the chip bar renders after the first apply() call.
      // Use chip-bar-view-model.ytChipBarViewModelHost as primary (new 2026 UI),
      // matching the reference script at greasyfork.org/ru/scripts/490557.
      const desktopParentSelectors = [
        'chip-bar-view-model.ytChipBarViewModelHost',
        'ytd-feed-filter-chip-bar-renderer iron-selector#chips',
        'ytd-feed-filter-chip-bar-renderer #chips-wrapper',
        'yt-chip-cloud-renderer #chips',
        'yt-chip-cloud-renderer .yt-chip-cloud-renderer',
      ];

      for (const selector of desktopParentSelectors) {
        const candidate = $(selector);
        if (candidate instanceof HTMLElement) {
          parent = candidate;
          break;
        }
      }
    }

    // #5: add a custom container for buttons if chip bar not found
    if (parent === null) {
      const grid = queryHTMLElement(
        'ytd-rich-grid-renderer, ytm-rich-grid-renderer, div.ytChipBarViewModelChipWrapper'
      );
      if (!grid) {
        // Grid not yet rendered — retry via shared wait helper
        scheduleApplyRetry(
          retryCount,
          'ytd-rich-grid-renderer, ytm-rich-grid-renderer, div.ytChipBarViewModelChipWrapper',
          1500
        );
        return;
      }

      // Also search inside the grid for chip bar in case it is a child
      const chipBarInGrid = grid.querySelector(
        'chip-bar-view-model.ytChipBarViewModelHost, ytd-feed-filter-chip-bar-renderer iron-selector#chips, ytd-feed-filter-chip-bar-renderer #chips-wrapper, yt-chip-cloud-renderer #chips'
      );
      if (chipBarInGrid instanceof HTMLElement) {
        parent = chipBarInGrid;
      } else if (retryCount < 8) {
        // Chip bar not rendered yet — retry via shared wait helper
        scheduleApplyRetry(
          retryCount,
          'chip-bar-view-model.ytChipBarViewModelHost, ytd-feed-filter-chip-bar-renderer iron-selector#chips, ytd-feed-filter-chip-bar-renderer #chips-wrapper, yt-chip-cloud-renderer #chips',
          1200
        );
        return;
      } else {
        // Last resort: insert a wrapper at the top of the grid
        let existingContainer = grid.querySelector('.ytp-button-container');
        if (!existingContainer) {
          // eslint-disable-next-line no-unsanitized/method -- static literal HTML wrapped by Trusted Types policy
          grid.insertAdjacentHTML(
            'afterbegin',
            _createHTML('<div class="ytp-button-container"></div>')
          );
          existingContainer = grid.querySelector('.ytp-button-container');
        }
        parent = existingContainer instanceof HTMLElement ? existingContainer : null;
      }
    }

    if (!parent) {
      window.console.warn('[Play All] Could not find parent container');
      return;
    }

    // Prevent duplicate buttons
    if (parent.querySelector('.ytp-play-all-btn')) {
      try {
        window.YouTubeUtils?.logger?.debug?.('[Play All] Buttons already exist, skipping');
      } catch (e) {
        /* logging non-critical */
      }
      return;
    }

    // See: available-lists.md
    const path = window.location.pathname || '';
    const [allPlaylist] = path.endsWith('/shorts')
      ? ['UUSH']
      : path.endsWith('/streams')
        ? ['UULV']
        : // Default for /@channel, /channel/* and /videos is regular videos.
          // list=UU<ID> may include shorts, list=UULF<ID> is videos-only.
          ['UULF'];

    const playlistSuffix = id.startsWith('UC') ? id.substring(2) : id;

    // Insert button directly into the container (chip bar or fallback wrapper)
    // eslint-disable-next-line no-unsanitized/method -- pre-sanitized via Trusted Types policy (_createHTML)
    parent.insertAdjacentHTML(
      'beforeend',
      _createHTML(
        `<a class="ytp-btn ytp-play-all-btn" href="/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1&ytp-random=random&ytp-random-initial=1" title="${getPlayAllAriaLabel()}" aria-label="${getPlayAllAriaLabel()}">${getPlayAllLabel()}</a>`
      )
    );

    const navigate = (/** @type {string} */ href) => {
      window.location.assign(href);
    };

    if (location.host === 'm.youtube.com') {
      // Use event delegation for mobile buttons
      if (!parent.hasAttribute('data-ytp-delegated')) {
        parent.setAttribute('data-ytp-delegated', 'true');
        parent.addEventListener('click', event => {
          const tgt = event.target instanceof Element ? event.target : null;
          const btn = /** @type {HTMLAnchorElement|null} */ (tgt?.closest?.('.ytp-btn') ?? null);
          if (btn && btn.href) {
            event.preventDefault();
            navigate(btn.href);
          }
        });
      }
    } else {
      // Desktop: do NOT intercept the click. The inserted element is a real
      // <a href="/playlist?...">, so YouTube's polymer router will pick up the
      // navigation natively. Calling preventDefault() here previously made
      // the click look ignored when chip-bar-view-model swallowed our handler.
    }
  };

  let observerFrame = 0;
  const runObserverWork = () => {
    observerFrame = 0;
    if (!featureEnabled) return;
    removeButton();
    apply();
  };

  const scheduleObserverWork = () => {
    if (!featureEnabled) return;
    if (observerFrame) return;
    if (typeof requestAnimationFrame === 'function') {
      observerFrame = requestAnimationFrame(runObserverWork);
      return;
    }
    observerFrame = /** @type {number} */ (
      /** @type {unknown} */ (setTimeout(runObserverWork, 16))
    );
  };

  const detachObserver = () => {
    if (observerSubId && window.YouTubeMutationCoordinator?.unsubscribe) {
      window.YouTubeMutationCoordinator.unsubscribe(observerSubId);
      observerSubId = null;
    }
    if (observerFallbackTimerId) {
      clearInterval(observerFallbackTimerId);
      observerFallbackTimerId = null;
    }
  };

  const attachObserver = (/** @type {Element | null | undefined} */ observeTarget) => {
    detachObserver();
    if (!featureEnabled || !observeTarget) return;

    const coordinator = window.YouTubeMutationCoordinator;
    if (coordinator?.watchTarget) {
      observerSubId = 'playall::observer';
      coordinator.watchTarget(observerSubId, observeTarget, () => scheduleObserverWork(), {
        attributes: true,
        childList: true,
        subtree: true,
      });
      return;
    }

    // Fallback for environments without MutationCoordinator; low-frequency polling only.
    observerFallbackTimerId = setInterval(() => {
      scheduleObserverWork();
    }, 500);
  };

  const addButton = async () => {
    detachObserver();

    if (!featureEnabled) return;

    if (!isSupportedTabPath()) {
      return;
    }

    // Regenerate button if switched between Latest and Popular.
    // Observe the grid (attribute changes when chip selection changes) and
    // also observe chip-bar-view-model directly for the new 2026 UI.
    const observeTarget =
      $('ytd-rich-grid-renderer') ||
      $('chip-bar-view-model.ytChipBarViewModelHost') ||
      $(
        'ytm-feed-filter-chip-bar-renderer .iron-selected, ytm-feed-filter-chip-bar-renderer .chip-bar-contents .selected'
      );
    attachObserver(observeTarget);

    // This check is necessary for the mobile Interval
    if ($('.ytp-play-all-btn')) {
      return;
    }

    const resolvedFromDom = resolveChannelIdFromDom();
    if (resolvedFromDom) {
      id = resolvedFromDom;
      apply();
      return;
    }

    // Try to extract channel ID from canonical link first
    try {
      const canonical = $('link[rel="canonical"]');
      if (canonical && canonical.href) {
        const match = canonical.href.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
        if (match && match[1]) {
          id = match[1];
          apply();
          return;
        }

        // Also try @handle format
        const handleMatch = canonical.href.match(/\/@([^\/]+)/);
        if (handleMatch) {
          // Try to get channel ID from page data
          const pageData = $('ytd-browse[page-subtype="channels"]');
          if (pageData) {
            const channelId = pageData.getAttribute('channel-id');
            if (channelId && channelId.startsWith('UC')) {
              id = channelId;
              apply();
              return;
            }
          }
        }
      }
    } catch (e) {
      window.console.warn('[Play All] Error extracting channel ID from canonical:', e);
    }

    // Fallback: fetch HTML and parse
    try {
      const currentUrl = location.href;
      // Only fetch YouTube pages to prevent SSRF
      const parsedUrl = new URL(currentUrl);
      if (
        parsedUrl.hostname !== 'www.youtube.com' &&
        parsedUrl.hostname !== 'youtube.com' &&
        parsedUrl.hostname !== 'm.youtube.com'
      ) {
        window.console.warn('[Play All] Skipping fetch for non-YouTube URL');
        return;
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

      if (canonicalMatch && canonicalMatch[1]) {
        id = canonicalMatch[1];
      } else {
        // Try alternative extraction methods
        const channelIdMatch = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
        if (channelIdMatch && channelIdMatch[1]) {
          id = channelIdMatch[1];
        }
      }

      if (id) {
        apply();
      } else {
        window.console.warn('[Play All] Could not extract channel ID');
      }
    } catch (e) {
      window.console.error('[Play All] Error fetching channel data:', e);
    }
  };

  const stopAddButtonRetries = () => {
    if (addButtonRetryTimer) {
      clearTimeout(addButtonRetryTimer);
      if (typeof addButtonRetryTimer.cancel === 'function') addButtonRetryTimer.cancel();
    }
    addButtonRetryTimer = null;
  };

  const queueDesktopAddButton = (reset = true) => {
    if (location.host === 'm.youtube.com') {
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
        if (!featureEnabled || !isSupportedTabPath()) return true;
        addButton();
        return !!$('.ytp-play-all-btn');
      },
    });

    if (scheduler) {
      addButtonRetryTimer = scheduler;
      return;
    }

    requestAnimationFrame(addButton);
  };

  // Removing the button prevents it from still existing when switching between "Videos", "Shorts", and "Live"
  // This is necessary due to the mobile Interval requiring a check for an already existing button
  const removeButton = () => {
    $$('.ytp-play-all-btn, .ytp-random-badge, .ytp-random-notice').forEach(element =>
      element.remove()
    );
  };

  let playAllRuntimeStarted = false;
  const startPlayAllRuntime = () => {
    if (playAllRuntimeStarted) return;
    playAllRuntimeStarted = true;

    if (location.host === 'm.youtube.com') {
      // The "yt-navigate-finish" event does not fire on mobile
      // Detect URL changes via pushState/replaceState override + popstate (lightweight)
      let lastUrl = location.href;
      const checkUrlChange = () => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          addButton();
        }
      };
      // Use centralized pushState/replaceState event from utils.js
      const _ytpNavHandler = () => setTimeout(checkUrlChange, 50);
      if (_cm?.registerListener) {
        _cm.registerListener(window, 'ytp-history-navigate', _ytpNavHandler, { passive: true });
        _cm.registerListener(window, 'popstate', checkUrlChange, { passive: true });
      } else {
        window.addEventListener('ytp-history-navigate', _ytpNavHandler, { passive: true });
        window.addEventListener('popstate', checkUrlChange, { passive: true });
      }
      // Initial call
      addButton();
    } else {
      const _navStartHandler = () => {
        stopAddButtonRetries();
        removeButton();
        id = '';
      };
      const _navFinishHandler = () => {
        queueDesktopAddButton();
        setTimeout(function () {
          queueDesktopAddButton(false);
        }, 120);
        setTimeout(function () {
          queueDesktopAddButton(false);
        }, 600);
        setTimeout_(function () {
          queueDesktopAddButton(false);
        }, 1400);
        setTimeout_(function () {
          queueDesktopAddButton(false);
        }, 2800);
      };
      const _pageshowHandler = () =>
        setTimeout(function () {
          queueDesktopAddButton();
        }, 120);
      const _visChangeHandler = () => {
        if (document.visibilityState === 'visible') {
          queueDesktopAddButton();
        }
      };
      if (_cm?.registerListener) {
        _cm.registerListener(window, 'yt-navigate-start', _navStartHandler);
        _cm.registerListener(window, 'yt-navigate-finish', _navFinishHandler);
        _cm.registerListener(document, 'yt-page-data-updated', _navFinishHandler);
        _cm.registerListener(document, 'yt-page-data-fetched', _navFinishHandler);
        _cm.registerListener(window, 'pageshow', _pageshowHandler);
        _cm.registerListener(document, 'visibilitychange', _visChangeHandler);
      } else {
        window.addEventListener('yt-navigate-start', _navStartHandler);
        window.addEventListener('yt-navigate-finish', _navFinishHandler);
        document.addEventListener('yt-page-data-updated', _navFinishHandler);
        document.addEventListener('yt-page-data-fetched', _navFinishHandler);
        window.addEventListener('pageshow', _pageshowHandler);
        document.addEventListener('visibilitychange', _visChangeHandler);
      }
      // Also attempt to add buttons on initial script run in case the SPA navigation event
      // already happened before this script was loaded (some browsers/firefox timing).
      try {
        onDomReady(() => queueDesktopAddButton(false));
        setTimeout(function () {
          queueDesktopAddButton(false);
        }, 50);
        setTimeout(function () {
          queueDesktopAddButton(false);
        }, 400);
        setTimeout_(function () {
          queueDesktopAddButton(false);
        }, 1200);
      } catch (e) {
        /* setTimeout unlikely to fail */
      }

      // Safety net: LazyLoader dispatches ytp:nav-refresh after every SPA nav.
      // Re-queue the desktop Add button so it appears reliably after in-page
      // navigation between channel tabs / playlists.
      try {
        window.addEventListener('ytp:nav-refresh', function () {
          try {
            queueDesktopAddButton(false);
          } catch (e) {
            void e;
          }
        });
      } catch (e) {
        void e;
      }
    }

    const _settingsUpdHandler = (/** @type {Event} */ e) => {
      try {
        const custom = e instanceof CustomEvent ? e : null;
        const nextEnabled = custom?.detail?.enablePlayAll !== false;
        if (nextEnabled === featureEnabled) return;
        setFeatureEnabled(nextEnabled);
      } catch (e) {
        setFeatureEnabled(window.YouTubeUtils?.loadFeatureEnabled?.('enablePlayAll') ?? true);
      }
    };
    if (_cm?.registerListener) {
      _cm.registerListener(window, 'youtube-plus-settings-updated', _settingsUpdHandler);
    } else {
      window.addEventListener('youtube-plus-settings-updated', _settingsUpdHandler);
    }

    // Random play feature
    (() => {
      // Random play is not supported for mobile devices
      if (location.host === 'm.youtube.com') {
        return;
      }

      const getParams = () => new URLSearchParams(window.location.search);

      /** @returns {{ params: URLSearchParams, mode: 'random', list: string, storageKey: string } | null} */
      const getRandomConfig = () => {
        const params = getParams();
        const modeParam = params.get('ytp-random');
        if (!modeParam || modeParam === '0') return null;
        const list = params.get('list') || '';
        if (!list) return null;

        return { params, mode: 'random', list, storageKey: `ytp-random-${list}` };
      };

      const getStorage = (/** @type {string} */ storageKey) => {
        try {
          return JSON.parse(localStorage.getItem(storageKey) || '{}');
        } catch (e) {
          return {};
        }
      };

      const isWatched = (/** @type {string} */ storageKey, /** @type {string} */ videoId) =>
        getStorage(storageKey)[videoId] || false;
      const markWatched = (/** @type {string} */ storageKey, /** @type {string} */ videoId) => {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ ...getStorage(storageKey), [videoId]: true })
        );
        document
          .querySelectorAll('#wc-endpoint[href*=zsA3X40nz9w]')
          .forEach(element => element.parentElement?.setAttribute('hidden', ''));
      };

      const playNextRandom = (/** @type {Record<string,any>} */ cfg, reload = false) => {
        const playerInstance = getPlayer();
        if (playerInstance && typeof playerInstance.pauseVideo === 'function') {
          playerInstance.pauseVideo();
        }

        const videos = Object.entries(getStorage(cfg.storageKey)).filter(
          ([_, watched]) => !watched
        );
        const params = new URLSearchParams(window.location.search);

        if (videos.length === 0) {
          return;
        }

        let videoIndex = Math.floor(Math.random() * videos.length);

        // Safety clamp in case of unexpected edge cases
        if (videoIndex < 0) videoIndex = 0;
        if (videoIndex >= videos.length) videoIndex = videos.length - 1;

        if (reload) {
          params.set('v', videos[videoIndex][0]);
          params.set('ytp-random', cfg.mode);
          params.delete('t');
          params.delete('index');
          params.delete('ytp-random-initial');
          window.location.href = `${window.location.pathname}?${params.toString()}`;
        } else {
          // Use the redirect() function for consistent navigation
          try {
            const listId = params.get('list') || '';
            redirect(videos[videoIndex][0], listId, cfg.mode);
          } catch (error) {
            window.console.error(
              '[Play All] Error using redirect(), falling back to manual redirect:',
              error
            );
            // Fallback to manual redirect if the redirect() function fails
            const redirector = document.createElement('a');
            redirector.className =
              'yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer';
            redirector.setAttribute('hidden', '');
            redirector.data = {
              commandMetadata: {
                webCommandMetadata: {
                  url: `/watch?v=${videos[videoIndex][0]}&list=${params.get('list')}&ytp-random=${cfg.mode}`,
                  webPageType: 'WEB_PAGE_TYPE_WATCH',
                  rootVe: 3832,
                },
              },
              watchEndpoint: {
                videoId: videos[videoIndex][0],
                playlistId: params.get('list'),
              },
            };
            const listContainer = $('ytd-playlist-panel-renderer #items');
            if (listContainer instanceof HTMLElement) {
              listContainer.append(redirector);
            } else {
              document.body.appendChild(redirector);
            }
            redirector.click();
          }
        }
      };

      /** @type {number | { stop: () => void } | null} */
      let applyRetryTimeoutId = null;
      /** @type {number|boolean|null} */
      let progressIntervalId = null;

      stopRandomPlayTimers = () => {
        if (applyRetryTimeoutId) {
          if (typeof applyRetryTimeoutId === 'number') {
            clearTimeout(applyRetryTimeoutId);
          } else {
            applyRetryTimeoutId.stop();
          }
        }
        applyRetryTimeoutId = null;
        // progressIntervalId is now a boolean or event listener, not a timer
        if (progressIntervalId && typeof progressIntervalId !== 'boolean') {
          clearInterval(progressIntervalId);
        }
        progressIntervalId = null;
      };

      const applyRandomPlay = (/** @type {Record<string,any>} */ cfg) => {
        if (!featureEnabled) return;
        if (!window.location.pathname.endsWith('/watch')) return;

        const playlistContainer = $('#secondary ytd-playlist-panel-renderer');
        if (playlistContainer === null) {
          return;
        }
        if (playlistContainer.hasAttribute('ytp-random')) {
          return;
        }

        playlistContainer.setAttribute('ytp-random', 'applied');
        const headerContainer = playlistContainer.querySelector('#header');
        if (headerContainer && !headerContainer.querySelector('.ytp-random-notice')) {
          // eslint-disable-next-line no-unsanitized/method -- static template wrapped by Trusted Types policy (_createHTML)
          headerContainer.insertAdjacentHTML(
            'beforeend',
            _createHTML(`<span class="ytp-random-notice">Play All mode</span>`)
          );
        }

        const storage = getStorage(cfg.storageKey);

        // Robustly collect playlist anchors - different YT layouts use different selectors
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
            if (a instanceof Element && a.tagName === 'A') anchors.push(/** @type {any} */ (a));
          });
        });

        // Deduplicate by href
        /** @type {HTMLAnchorElement[]} */
        const uniq = [];
        const seen = new Set();
        anchors.forEach(a => {
          const href = /** @type {HTMLAnchorElement} */ (a).href || a.getAttribute('href') || '';
          if (!seen.has(href)) {
            seen.add(href);
            uniq.push(a);
          }
        });

        const navigate = (/** @type {string} */ href) => (window.location.href = href);

        // Mark videos and prepare links
        uniq.forEach(element => {
          let videoId = null;
          try {
            videoId = new URL(element.href, window.location.origin).searchParams.get('v');
          } catch (e) {
            videoId = new URLSearchParams(element.search || '').get('v');
          }

          if (!videoId) return;

          if (!isWatched(cfg.storageKey, videoId)) {
            storage[videoId] = false;
          }

          // Ensure ytp-random param present
          try {
            const u = new URL(element.href, window.location.origin);
            u.searchParams.set('ytp-random', cfg.mode);
            element.href = u.toString();
          } catch (e) {
            /* malformed URL ignored */
          }

          element.setAttribute('data-ytp-random-link', 'true');

          const entryKey = getVideoId(element.href);
          if (entryKey && isWatched(cfg.storageKey, entryKey)) {
            element.parentElement?.setAttribute('hidden', '');
          }
        });

        // Use event delegation for video links
        if (playlistContainer && !playlistContainer.hasAttribute('data-ytp-random-delegated')) {
          playlistContainer.setAttribute('data-ytp-random-delegated', 'true');
          playlistContainer.addEventListener('click', event => {
            const tgt = event.target instanceof Element ? event.target : null;
            const link = /** @type {HTMLAnchorElement|null} */ (
              tgt?.closest?.('a[data-ytp-random-link]') ?? null
            );
            if (link && link.href) {
              event.preventDefault();
              navigate(link.href);
            }
          });
        }
        localStorage.setItem(cfg.storageKey, JSON.stringify(storage));

        const currentVideoId = getVideoId(location.href);
        if (
          cfg.params.get('ytp-random-initial') === '1' ||
          (currentVideoId && isWatched(cfg.storageKey, currentVideoId))
        ) {
          playNextRandom(cfg);

          return;
        }

        const header = playlistContainer.querySelector('h3 a');
        if (header && header.tagName === 'A') {
          const anchorHeader = /** @type {HTMLAnchorElement} */ (/** @type {unknown} */ (header));
          // eslint-disable-next-line no-unsanitized/method -- static template wrapped by Trusted Types policy (_createHTML)
          anchorHeader.insertAdjacentHTML(
            'beforeend',
            _createHTML(
              ` <span class="ytp-badge ytp-random-badge">Play All <span style="font-size: 2rem; vertical-align: top">&times;</span></span>`
            )
          );
          anchorHeader.href = '#';
          const badge = anchorHeader.querySelector('.ytp-random-badge');
          if (badge) {
            badge.addEventListener('click', event => {
              event.preventDefault();

              localStorage.removeItem(cfg.storageKey);

              const params = new URLSearchParams(location.search);
              params.delete('ytp-random');
              window.location.href = `${window.location.pathname}?${params.toString()}`;
            });
          }
        }

        const _keydownHandler = (/** @type {Event} */ event) => {
          if (!(event instanceof KeyboardEvent)) return;
          // SHIFT + N
          if (event.shiftKey && event.key.toLowerCase() === 'n') {
            event.stopImmediatePropagation();
            event.preventDefault();

            const videoId = getVideoId(location.href);
            if (videoId) markWatched(cfg.storageKey, videoId);
            // Unfortunately there is no workaround to YouTube redirecting to the next in line without a reload
            playNextRandom(cfg, true);
          }
        };
        if (_cm?.registerListener) {
          _cm.registerListener(document, 'keydown', _keydownHandler, true);
        } else {
          document.addEventListener('keydown', _keydownHandler, true);
        }

        if (progressIntervalId) return;

        // Use video timeupdate event instead of setInterval for better performance
        const videoEl = $('video');
        if (!videoEl) return;

        const handleProgress = () => {
          const videoId = getVideoId(location.href);

          const params = new URLSearchParams(location.search);
          params.set('ytp-random', cfg.mode);
          window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

          const player = getPlayer();
          if (!player || typeof player.getProgressState !== 'function') {
            return;
          }

          const progressState = player.getProgressState();
          if (
            !progressState ||
            typeof progressState.current !== 'number' ||
            typeof progressState.duration !== 'number'
          ) {
            return;
          }

          // Do not listen for watch progress when watching advertisements
          if (!isAdPlaying()) {
            if (progressState.current / progressState.duration >= 0.9) {
              if (videoId) markWatched(cfg.storageKey, videoId);
            }

            // Autoplay random video
            if (progressState.current >= progressState.duration - 2) {
              // make sure vanilla autoplay doesnt take over
              if (typeof player.pauseVideo === 'function') player.pauseVideo();
              if (typeof player.seekTo === 'function') player.seekTo(0);
              playNextRandom(cfg);
            }
          }

          const nextButton = $(
            '#ytd-player .ytp-next-button.ytp-button:not([ytp-random="applied"])'
          );
          if (nextButton instanceof HTMLElement) {
            // Replace with span to prevent anchor click events
            const newButton = document.createElement('span');
            newButton.className = nextButton.className;
            renderTemplateClone(newButton, nextButton.innerHTML);
            nextButton.replaceWith(newButton);

            newButton.setAttribute('ytp-random', 'applied');
            newButton.addEventListener('click', () => {
              if (videoId) markWatched(cfg.storageKey, videoId);
              playNextRandom(cfg);
            });
          }
        };

        videoEl.addEventListener('timeupdate', handleProgress, { passive: true });
        progressIntervalId = true; // Mark as initialized
      };

      scheduleApplyRandomPlay = () => {
        if (!featureEnabled) return;
        stopRandomPlayTimers?.();

        if (!window.location.pathname.endsWith('/watch')) return;

        const performApply = () => {
          const cfg = getRandomConfig();
          if (!cfg) return false;

          // Storage needs to now be { [videoId]: bool }
          try {
            const current = localStorage.getItem(cfg.storageKey);
            if (current && Array.isArray(JSON.parse(current))) {
              localStorage.removeItem(cfg.storageKey);
            }
          } catch (e) {
            localStorage.removeItem(cfg.storageKey);
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
        if (!featureEnabled) {
          stopRandomPlayTimers?.();
          return;
        }
        stopRandomPlayTimers?.();
        scheduleApplyRandomPlay?.();
      };

      onNavigate();
      const _navFinishRandom = () => setTimeout(onNavigate, 200);
      if (_cm?.registerListener) {
        _cm.registerListener(window, 'yt-navigate-finish', _navFinishRandom);
      } else {
        window.addEventListener('yt-navigate-finish', _navFinishRandom);
      }
    })();
  };

  if (window.YouTubePlusLazyLoader?.register) {
    window.YouTubePlusLazyLoader.register('playall', startPlayAllRuntime, {
      priority: 55,
      delay: 0,
      // Keep runtime listeners active globally; route checks are handled inside
      // addButton/isSupportedTabPath, which avoids missing early SPA transitions.
      shouldLoad: () => true,
    });
  } else {
    startPlayAllRuntime();
  }
})().catch(error =>
  window.console.error(
    '%cytp - YouTube Play All\n',
    'color: var(--yt-playall-accent-purple); font-size: 32px; font-weight: bold',
    error
  )
);
