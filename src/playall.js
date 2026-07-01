// Play All — LazyLoader registered as 'playall'.
//
// Responsibility: "Play All" button injection on playlist pages,
//   sequential video playback orchestration, and random-shuffle mode
//   via the `ytp-random` URL parameter.
// Public surface: none (self-contained IIFE, registered via LazyLoader).
(async function () {
  const setTimeout_ = setTimeout.bind(window);
  const _createHTML = window.YouTubeUtils.createHTML;
  const RANDOM_PARAM = 'ytp-random';

  let featureEnabled = true;
  /** @type {(() => void)|null} */
  let stopRandomPlayTimers = null;
  /** @type {(() => void)|null} */
  let scheduleApplyRandomPlay = null;
  /** @type {any|null} */
  let addButtonRetryTimer = null;
  const clearRetryHandle = (/** @type {any} */ handle) => {
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
  const setFeatureEnabled = (/** @type {boolean|undefined} */ nextEnabled) => {
    featureEnabled = nextEnabled !== false;
    if (!featureEnabled) {
      try {
        removeButton();
      } catch (_e) {
        /* feature disable cleanup */
      }
      try {
        if (addButtonRetryTimer) {
          clearRetryHandle(addButtonRetryTimer);
        }
        addButtonRetryTimer = null;
      } catch (_e) {
        /* timer cleanup safe to ignore */
      }
      try {
        if (typeof stopRandomPlayTimers === 'function') stopRandomPlayTimers();
      } catch (_e) {
        /* timer cleanup safe to ignore */
      }
    } else {
      try {
        queueDesktopAddButton();
      } catch (_e) {
        /* feature enable may fail */
      }
      try {
        if (typeof scheduleApplyRandomPlay === 'function') scheduleApplyRandomPlay();
      } catch (_e) {
        /* feature enable may fail */
      }
    }
  };

  featureEnabled = window.YouTubeUtils?.loadFeatureEnabled?.('enablePlayAll') ?? true;

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
          playAllLogger?.warn?.('Play All', 'DOMReady callback error', e);
        }
      }
    };
    if (!ready) document.addEventListener('DOMContentLoaded', run, { once: true });
    return (/** @type {() => void} */ cb) => {
      if (ready) cb();
      else queue.push(cb);
    };
  })();

  const t = window.YouTubeUtils?.t || ((/** @type {string} */ key) => key || '');

  const hasTranslation = (/** @type {string} */ key) => {
    try {
      if (window.YouTubePlusI18n?.hasTranslation) return window.YouTubePlusI18n.hasTranslation(key);
    } catch (_e) {
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
        initialData?.metadata?.channelMetadataRenderer?.externalId ||
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
      playAllLogger?.warn?.('Play All', 'Failed to resolve channel ID from DOM', e);
    }
    return null;
  };

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
      window.YouTubeUtils?.logger?.info?.(
        '%cytp - YouTube Play All\n',
        'color: var(--yt-playall-accent-purple); font-size: 32px; font-weight: bold',
        'You are currently running a test version:',
        scriptVersion
      );
    } catch (_e) {
      /* logging non-critical */
    }
  }

  // TrustedTypes default policy is registered in main.js — no duplicate needed here

  scheduleNonCritical(() => {
    // Play All styles are owned by the canonical design-system style
    // registry (`ytp-play-all-styles` bundle in design-system.js) and
    // mounted via StyleManager so they share the single style host with
    // the rest of the design system. StyleManager.add is idempotent
    // (no-op when the css is unchanged), so this is safe to call from
    // any boot path. The defensive guard keeps an unexpected absence of
    // StyleManager a clean no-op rather than a throw.
    try {
      const SM = window.YouTubeUtils?.StyleManager;
      if (SM && typeof SM.add === 'function') {
        const css = window.YouTubePlusDesignSystem?.getStyle?.('ytp-play-all-styles') || '';
        SM.add('ytp-play-all-styles', css);
      }
    } catch (e) {
      playAllLogger?.warn?.('Play All', 'Failed to inject Play All styles via StyleManager', e);
    }
  });

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
      } catch (_e) {
        // Fallback: use direct navigation on error
        const url = `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`;
        window.location.href = url;
      }
    }
  };

  let id = '';
  /** @type {string | null} */
  let observerSubId = null;
  // Coordinator's setManagedTimeout is intentionally private (see
  // mutation-coordinator.js header), so route the timeout through the
  // standard YouTubeUtils-aware wrapper directly. The coordinator is
  // still the single source of truth for the observer (subscribeRoot /
  // watchTarget) below.
  /**
   * @param {() => void} callback
   * @param {number} delay
   */
  const scheduleManagedTimeout = (callback, delay) => {
    setTimeout_(callback, delay);
  };
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
    scheduleManagedTimeout(() => apply(retryCount + 1), 80);
  };

  const apply = (retryCount = 0) => {
    playAllLogger?.warn?.('Play All', 'apply() start', {
      id,
      retryCount,
      path: location.pathname,
    });
    if (id === '') {
      // DOM may still be transitioning; queue another resolution attempt
      // instead of giving up permanently.
      playAllLogger?.warn?.('Play All', 'apply() id empty, scheduling addButton retry');
      scheduleManagedTimeout(() => {
        if (id === '') addButton();
      }, 200);
      return;
    }

    let parent = null;
    /** @type {HTMLElement | null} */
    let chipBarHost = null;
    /** @type {HTMLElement | null} */
    let chipBarInsertBefore = null;
    if (location.host === 'm.youtube.com') {
      parent = queryHTMLElement(
        'ytm-feed-filter-chip-bar-renderer .chip-bar-contents, ytm-feed-filter-chip-bar-renderer > div'
      );
    } else {
      // Use document.querySelector directly to bypass the DOM cache, which can
      // return a stale null when the chip bar renders after the first apply() call.
      // Prefer chip-bar hosts that live inside the channel grid; the bare selector
      // can match engagement-panel / miniplayer chip bars which are not the ones
      // we want to augment. The tab container renders earlier, but we want the
      // button in the chip row (Новые/Популярные/Старые), so we look for chip
      // bars first and only fall back to tabs after a few retries.
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
        if (candidate instanceof HTMLElement) {
          // Ignore chip-bar hosts inside engagement panels / miniplayer / live chat.
          if (
            candidate.tagName === 'CHIP-BAR-VIEW-MODEL' &&
            candidate.closest(
              'ytd-engagement-panel-section-list-renderer, ytd-engagement-panel-title-header-renderer, ytd-miniplayer, ytd-live-chat-frame'
            )
          ) {
            continue;
          }
          if (candidate.tagName === 'CHIP-BAR-VIEW-MODEL') {
            chipBarHost = candidate;
            const hostSr = /** @type {any} */ (chipBarHost).shadowRoot;
            if (hostSr instanceof ShadowRoot) {
              // Insert directly into the chip bar's shadow root so the button
              // renders as a flex item in the same row as the chips.
              parent = hostSr;
              playAllLogger?.warn?.('Play All', 'Using chip-bar shadow root', {
                selector,
              });
            } else {
              // The host has not upgraded yet (or has a closed shadow root).
              // Place the button as a sibling immediately before the chip bar
              // so it stays visible even after the component upgrades.
              const hostParent = chipBarHost.parentElement;
              if (hostParent instanceof HTMLElement) {
                parent = hostParent;
                chipBarInsertBefore = chipBarHost;
                playAllLogger?.warn?.('Play All', 'Using chip-bar host parent', {
                  selector,
                  parentTag: hostParent.tagName,
                });
              } else {
                parent = chipBarHost;
                playAllLogger?.warn?.('Play All', 'Using chip-bar host directly', {
                  selector,
                  noParent: true,
                });
              }
            }
          } else {
            parent = candidate;
            playAllLogger?.warn?.('Play All', 'Found parent via selector', selector);
          }
          break;
        }
      }
    }

    // #5: add a custom container for buttons if chip bar not found
    if (parent === null) {
      playAllLogger?.warn?.('Play All', 'No chip bar parent, looking for grid');
      const grid = queryHTMLElement(
        'ytd-rich-grid-renderer, ytm-rich-grid-renderer, div.ytChipBarViewModelChipWrapper'
      );
      if (!grid) {
        // Grid not yet rendered — retry via shared wait helper
        playAllLogger?.warn?.('Play All', 'Grid not found, scheduling retry', { retryCount });
        scheduleApplyRetry(
          retryCount,
          'ytd-rich-grid-renderer, ytm-rich-grid-renderer, div.ytChipBarViewModelChipWrapper',
          1500
        );
        return;
      }

      // Also search inside the grid for chip bar in case it is a child
      const chipBarInGrid = grid.querySelector(
        'chip-bar-view-model.ytChipBarViewModelHost, chip-bar-view-model, ytd-feed-filter-chip-bar-renderer iron-selector#chips, ytd-feed-filter-chip-bar-renderer #chips-wrapper, yt-chip-cloud-renderer #chips'
      );
      if (chipBarInGrid instanceof HTMLElement) {
        if (chipBarInGrid.tagName === 'CHIP-BAR-VIEW-MODEL') {
          chipBarHost = chipBarInGrid;
          const hostSr = /** @type {any} */ (chipBarHost).shadowRoot;
          if (hostSr instanceof ShadowRoot) {
            parent = hostSr;
            playAllLogger?.warn?.(
              'Play All',
              'Found chip-bar-view-model inside grid, using shadow root'
            );
          } else {
            const hostParent = chipBarHost.parentElement;
            if (hostParent instanceof HTMLElement) {
              parent = hostParent;
              chipBarInsertBefore = chipBarHost;
              playAllLogger?.warn?.(
                'Play All',
                'Found chip-bar-view-model inside grid, using host parent',
                {
                  parentTag: hostParent.tagName,
                }
              );
            } else {
              parent = chipBarHost;
              playAllLogger?.warn?.(
                'Play All',
                'Found chip-bar-view-model inside grid, using host directly'
              );
            }
          }
        } else {
          chipBarHost = chipBarInGrid;
          parent = /** @type {any} */ (chipBarHost).shadowRoot || chipBarHost;
          playAllLogger?.warn?.('Play All', 'Found chip bar inside grid', {
            inShadowRoot: !!(/** @type {any} */ (chipBarHost).shadowRoot),
          });
        }
      } else if (retryCount < 8) {
        // Chip bar not rendered yet — retry via shared wait helper
        playAllLogger?.warn?.('Play All', 'Chip bar not in grid, scheduling retry', {
          retryCount,
        });
        scheduleApplyRetry(
          retryCount,
          'chip-bar-view-model.ytChipBarViewModelHost, ytd-feed-filter-chip-bar-renderer iron-selector#chips, ytd-feed-filter-chip-bar-renderer #chips-wrapper, yt-chip-cloud-renderer #chips',
          1200
        );
        return;
      } else {
        // Last resort: insert a wrapper at the top of the grid
        playAllLogger?.warn?.('Play All', 'Using grid fallback container');
        let existingContainer = grid.querySelector('.ytp-button-container');
        if (!existingContainer) {
          // static literal HTML wrapped by Trusted Types policy (_createHTML)
          grid.insertAdjacentHTML(
            'afterbegin',
            _createHTML('<div class="ytp-button-container"></div>')
          );
          existingContainer = grid.querySelector('.ytp-button-container');
        }
        parent = existingContainer instanceof HTMLElement ? existingContainer : null;
      }
    }

    // #6: fall back to the tab container only when no chip bar / grid exists.
    // This keeps the button out of the tab row on pages that do have a chip bar.
    if (parent === null && location.host !== 'm.youtube.com') {
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
      return;
    }

    // Prevent duplicate buttons. Search both the chosen parent and the chip bar
    // host itself so re-applies after chip-bar mutations do not stack duplicates.
    const existingButton =
      chipBarHost?.querySelector('.ytp-play-all-btn') || parent.querySelector('.ytp-play-all-btn');
    if (existingButton) {
      try {
        playAllLogger?.warn?.('Play All', 'Button already exists, skipping');
      } catch (_e) {
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

    // Create the button element in JS so the click handler is attached
    // before it enters the DOM.
    const playAllHref = `/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1&ytp-random=random&ytp-random-initial=1`;
    playAllLogger?.warn?.('Play All', 'Creating button', {
      playlist: allPlaylist,
      id,
      href: playAllHref,
    });
    const btn = document.createElement('a');
    btn.className = 'ytp-btn ytp-play-all-btn';
    btn.href = playAllHref;
    btn.title = getPlayAllAriaLabel();
    btn.setAttribute('aria-label', getPlayAllAriaLabel());
    btn.textContent = getPlayAllLabel();
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      window.location.href = playAllHref;
    });
    // Guard: detach the observer while we insert the button.
    // Without this, appending the button triggers the mutation observer,
    // which calls removeButton()+apply() in an infinite loop (the button
    // is removed and recreated every frame, so clicks land on a detached element).
    detachObserver();
    if (parent instanceof ShadowRoot) {
      // Inject the Play All styles into the shadow root so the button renders
      // correctly when inserted there. Prepend the button so it appears as the
      // first flex item in the chip bar row.
      const playAllCss = window.YouTubePlusDesignSystem?.getStyle?.('ytp-play-all-styles');
      if (playAllCss && !parent.querySelector('style[data-ytp-play-all-styles]')) {
        const style = document.createElement('style');
        style.setAttribute('data-ytp-play-all-styles', '');
        style.textContent = playAllCss;
        parent.appendChild(style);
      }
      parent.insertBefore(btn, parent.firstChild);
      playAllLogger?.warn?.('Play All', 'Button inserted into chip-bar shadow root');
    } else if (chipBarInsertBefore && chipBarInsertBefore.parentElement === parent) {
      parent.insertBefore(btn, chipBarInsertBefore);
      parent.classList.add('ytp-play-all-parent');
      playAllLogger?.warn?.('Play All', 'Button inserted before chip bar', {
        parentSelector: parent.tagName + (parent.className ? `.${parent.className}` : ''),
      });
    } else {
      parent.appendChild(btn);
      playAllLogger?.warn?.('Play All', 'Button appended', {
        parentSelector: parent.tagName + (parent.className ? `.${parent.className}` : ''),
      });
    }
    // Re-attach observer after a microtask so it doesn't pick up our own insertion.
    // observeTarget is re-queried here since it's local to addButton().
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
  const runObserverWork = () => {
    observerFrame = 0;
    if (!featureEnabled) return;
    // Detach the observer before removing the button — removeButton() removes
    // children of the observed target, which triggers childList mutations that
    // would re-queue scheduleObserverWork → runObserverWork in an infinite loop.
    detachObserver();
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
    if (observerSubId && window.YouTubePlusMutationCoordinator?.unsubscribe) {
      window.YouTubePlusMutationCoordinator.unsubscribe(observerSubId);
      observerSubId = null;
    }
  };

  const attachObserver = (/** @type {Element | null | undefined} */ observeTarget) => {
    detachObserver();
    if (!(featureEnabled && observeTarget)) return;

    // The mutation coordinator is always loaded before this module
    // (see build.order.json), so the legacy setInterval polling
    // fallback has been removed: it was dead code in production
    // and would have re-introduced a polling observer.
    const coordinator = window.YouTubePlusMutationCoordinator;
    if (coordinator?.watchTarget) {
      observerSubId = 'playall::observer';
      coordinator.watchTarget(observerSubId, observeTarget, () => scheduleObserverWork(), {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }
  };

  const addButton = async () => {
    detachObserver();

    playAllLogger?.warn?.('Play All', 'addButton() start', {
      featureEnabled,
      path: location.pathname,
      supported: isSupportedTabPath(),
    });

    if (!featureEnabled) {
      playAllLogger?.warn?.('Play All', 'addButton() feature disabled');
      return;
    }

    if (!isSupportedTabPath()) {
      playAllLogger?.warn?.('Play All', 'addButton() path not supported');
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

    const resolvedFromDom = await resolveChannelIdWithRetry(12, 100);
    playAllLogger?.warn?.('Play All', 'resolveChannelIdWithRetry result', { resolvedFromDom });
    if (resolvedFromDom) {
      id = resolvedFromDom;
      apply();
      return;
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
        playAllLogger?.warn?.('Play All', 'Skipping fetch for non-YouTube URL');
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

      if (canonicalMatch?.[1]) {
        id = canonicalMatch[1];
      } else {
        // Try alternative extraction methods
        const channelIdMatch = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
        if (channelIdMatch?.[1]) {
          id = channelIdMatch[1];
        }
      }

      if (id) {
        apply();
        playAllLogger?.warn?.('Play All', 'Channel ID resolved via fetch, button applied');
      } else {
        playAllLogger?.warn?.('Play All', 'Could not extract channel ID');
      }
    } catch (e) {
      playAllLogger?.error?.('Play All', 'Error fetching channel data', e);
    }
  };

  const stopAddButtonRetries = () => {
    if (addButtonRetryTimer) {
      clearRetryHandle(addButtonRetryTimer);
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
        if (!(featureEnabled && isSupportedTabPath())) return true;
        addButton();
        return !!$('.ytp-play-all-btn');
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
    $$('.ytp-play-all-btn, .ytp-random-badge, .ytp-random-notice').forEach(element =>
      element.remove()
    );
  };

  let playAllRuntimeStarted = false;
  const resetPlayAllRuntime = () => {
    try {
      stopAddButtonRetries();
      removeButton();
      id = '';
      if (typeof stopRandomPlayTimers === 'function') stopRandomPlayTimers();
    } catch (_e) {
      /* non-critical reset */
    }
  };
  const startPlayAllRuntime = () => {
    playAllLogger?.warn?.('Play All', 'startPlayAllRuntime()', {
      runtimeStarted: playAllRuntimeStarted,
      path: location.pathname,
    });
    if (playAllRuntimeStarted) {
      // Re-entry after onLeave/onEnter cycle: just re-queue an immediate attempt.
      resetPlayAllRuntime();
    }
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
      const _ytpNavHandler = () => scheduleManagedTimeout(checkUrlChange, 50);
      if (_cm?.registerListener) {
        _cm.registerListener(window, 'ytp-history-navigate', _ytpNavHandler, {
          passive: true,
        });
        _cm.registerListener(window, 'popstate', checkUrlChange, {
          passive: true,
        });
      } else {
        window.addEventListener('ytp-history-navigate', _ytpNavHandler, {
          passive: true,
        });
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
      };
      const _pageshowHandler = () => scheduleManagedTimeout(() => queueDesktopAddButton(), 120);
      const _visChangeHandler = () => {
        if (document.visibilityState === 'visible') {
          queueDesktopAddButton();
        }
      };
      if (_cm?.registerListener) {
        _cm.registerListener(document, 'yt-navigate-start', _navStartHandler);
        _cm.registerListener(document, 'yt-navigate-finish', _navFinishHandler);
        _cm.registerListener(document, 'yt-page-data-updated', _navFinishHandler);
        _cm.registerListener(document, 'yt-page-data-fetched', _navFinishHandler);
        _cm.registerListener(window, 'pageshow', _pageshowHandler);
        _cm.registerListener(document, 'visibilitychange', _visChangeHandler);
      } else {
        document.addEventListener('yt-navigate-start', _navStartHandler);
        document.addEventListener('yt-navigate-finish', _navFinishHandler);
        document.addEventListener('yt-page-data-updated', _navFinishHandler);
        document.addEventListener('yt-page-data-fetched', _navFinishHandler);
        window.addEventListener('pageshow', _pageshowHandler);
        document.addEventListener('visibilitychange', _visChangeHandler);
      }
      // Also attempt to add buttons on initial script run in case the SPA navigation event
      // already happened before this script was loaded (some browsers/firefox timing).
      try {
        onDomReady(() => queueDesktopAddButton(false));
        scheduleManagedTimeout(() => queueDesktopAddButton(false), 120);
      } catch (_e) {
        /* setTimeout unlikely to fail */
      }

      // Safety net: LazyLoader dispatches ytp:nav-refresh after every SPA nav.
      // Re-queue the desktop Add button so it appears reliably after in-page
      // navigation between channel tabs / playlists.
      try {
        window.addEventListener('ytp:nav-refresh', function () {
          try {
            queueDesktopAddButton(false);
          } catch {}
        });
      } catch {}
    }

    const _settingsUpdHandler = (/** @type {Event} */ e) => {
      try {
        const custom = e instanceof CustomEvent ? e : null;
        const nextEnabled = custom?.detail?.enablePlayAll !== false;
        if (nextEnabled === featureEnabled) return;
        setFeatureEnabled(nextEnabled);
      } catch (_e) {
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
          return JSON.parse(localStorage.getItem(storageKey) || '{}');
        } catch (_e) {
          return {};
        }
      };

      const isWatched = (/** @type {string} */ storageKey, /** @type {string} */ videoId) =>
        getStorage(storageKey)[videoId];
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
            playAllLogger?.error?.(
              'Play All',
              'Error using redirect(), falling back to manual redirect',
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
              const safeAppendRoot = document.body || document.documentElement;
              if (safeAppendRoot) {
                safeAppendRoot.appendChild(redirector);
              }
            }
            redirector.click();
          }
        }
      };

      /** @type {number | { stop: () => void } | null} */
      let applyRetryTimeoutId = null;
      /** @type {boolean} */
      let _progressTrackingInitialized = false;

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
          // static template wrapped by Trusted Types policy (_createHTML)
          headerContainer.insertAdjacentHTML(
            'beforeend',
            _createHTML(`<span class="ytp-random-notice">${t('playAllMode')}</span>`)
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
          } catch (_e) {
            videoId = new URLSearchParams(element.search || '').get('v');
          }

          if (!videoId) return;

          if (!isWatched(cfg.storageKey, videoId)) {
            storage[videoId] = false;
          }

          // Ensure ytp-random param present
          try {
            const u = new URL(element.href, window.location.origin);
            u.searchParams.set(RANDOM_PARAM, cfg.mode);
            element.href = u.toString();
          } catch (_e) {
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
            if (link?.href) {
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
          // static template wrapped by Trusted Types policy (_createHTML)
          anchorHeader.insertAdjacentHTML(
            'beforeend',
            _createHTML(
              ` <span class="ytp-badge ytp-random-badge">Play All <span class="ytp-random-badge-close">&times;</span></span>`
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

        if (_progressTrackingInitialized) return;

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
            window.YouTubeUtils.renderTemplateClone(newButton, nextButton.innerHTML);
            nextButton.replaceWith(newButton);

            newButton.setAttribute('ytp-random', 'applied');
            newButton.addEventListener('click', () => {
              if (videoId) markWatched(cfg.storageKey, videoId);
              playNextRandom(cfg);
            });
          }
        };

        videoEl.addEventListener('timeupdate', handleProgress, {
          passive: true,
        });
        _progressTrackingInitialized = true;
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
          } catch (_e) {
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
        _cm.registerListener(document, 'yt-navigate-finish', _navFinishRandom);
      } else {
        document.addEventListener('yt-navigate-finish', _navFinishRandom);
      }
    })();
  };

  if (window.YouTubeUtils?.whenRelevant) {
    window.YouTubeUtils.whenRelevant({
      name: 'playall',
      // Channel pages only — /@handle/videos, /@handle/shorts,
      // /channel/..., /c/..., /user/... and their /videos, /shorts,
      // /streams sub-tabs. Playlist pages are explicitly excluded
      // (the URL has no list, and the UI is wrong there).
      isRelevant: () => {
        try {
          if (window.location.search.includes('list=')) return false;
          return isSupportedTabPath();
        } catch (_e) {
          return false;
        }
      },
      onEnter: startPlayAllRuntime,
      onLeave: resetPlayAllRuntime,
    });
  } else {
    startPlayAllRuntime();
  }
})().catch(error =>
  (window.YouTubeUtils?.logger || null)?.error?.('Play All', 'Module bootstrap failure', error)
);
