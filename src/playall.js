// Play All
(async function () {
  'use strict';

  let featureEnabled = true;
  let stopRandomPlayTimers = null;
  let scheduleApplyRandomPlay = null;
  const loadFeatureEnabled = () => {
    try {
      const settings = localStorage.getItem('youtube_plus_settings');
      if (settings) {
        const parsed = JSON.parse(settings);
        return parsed.enablePlayAll !== false;
      }
    } catch {}
    return true;
  };
  const setFeatureEnabled = nextEnabled => {
    featureEnabled = nextEnabled !== false;
    if (!featureEnabled) {
      try {
        removeButton();
      } catch {}
      try {
        if (typeof stopRandomPlayTimers === 'function') stopRandomPlayTimers();
      } catch {}
    } else {
      try {
        addButton();
      } catch {}
      try {
        if (typeof scheduleApplyRandomPlay === 'function') scheduleApplyRandomPlay();
      } catch {}
    }
  };

  featureEnabled = loadFeatureEnabled();

  // DOM helpers
  const _getDOMCache = () => typeof window !== 'undefined' && window.YouTubeDOMCache;
  const $ = (sel, ctx) =>
    _getDOMCache()?.querySelector(sel, ctx) || (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) =>
    _getDOMCache()?.querySelectorAll(sel, ctx) ||
    Array.from((ctx || document).querySelectorAll(sel));
  const onDomReady = (() => {
    let ready = document.readyState !== 'loading';
    const queue = [];
    const run = () => {
      ready = true;
      while (queue.length) {
        const cb = queue.shift();
        try {
          cb();
        } catch {}
      }
    };
    if (!ready) document.addEventListener('DOMContentLoaded', run, { once: true });
    return cb => {
      if (ready) cb();
      else queue.push(cb);
    };
  })();

  const t = (key, params = {}) => {
    if (window.YouTubePlusI18n?.t) return window.YouTubePlusI18n.t(key, params);
    if (window.YouTubeUtils?.t) return window.YouTubeUtils.t(key, params);
    return key;
  };

  const hasTranslation = key => {
    try {
      if (window.YouTubePlusI18n?.hasTranslation) return window.YouTubePlusI18n.hasTranslation(key);
    } catch {}
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

  const scheduleNonCritical = fn => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: 2000 });
    } else {
      setTimeout(fn, 200);
    }
  };

  /** @type {any} */
  const globalContext =
    typeof unsafeWindow !== 'undefined'
      ? /** @type {any} */ (unsafeWindow)
      : /** @type {any} */ (window);

  const gmInfo = globalContext?.GM_info ?? null;

  const scriptVersion = gmInfo?.script?.version ?? null;
  if (scriptVersion && /-(alpha|beta|dev|test)$/.test(scriptVersion)) {
    try {
      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.info &&
        YouTubeUtils.logger.info(
          '%cytp - YouTube Play All\n',
          'color: #bf4bcc; font-size: 32px; font-weight: bold',
          'You are currently running a test version:',
          scriptVersion
        );
    } catch {}
  }

  if (
    Object.prototype.hasOwnProperty.call(window, 'trustedTypes') &&
    !window.trustedTypes.defaultPolicy
  ) {
    window.trustedTypes.createPolicy('default', { createHTML: string => string });
  }

  const insertStylesSafely = html => {
    try {
      const target = document.head || document.documentElement;
      if (target && typeof target.insertAdjacentHTML === 'function') {
        target.insertAdjacentHTML('beforeend', html);
        return;
      }

      // If head isn't available yet, wait for DOMContentLoaded and insert then.
      const onReady = () => {
        try {
          const t = document.head || document.documentElement;
          if (t && typeof t.insertAdjacentHTML === 'function') {
            t.insertAdjacentHTML('beforeend', html);
          }
        } catch {}
      };
      onDomReady(onReady);
    } catch {}
  };

  scheduleNonCritical(() =>
    insertStylesSafely(`<style>
        .ytp-btn {border-radius: 10px; font-family: 'Roboto', 'Arial', sans-serif; font-size: 1.35rem; line-height: 1.8rem; font-weight: 500; padding: 0.4em 0.75em; margin-left: 0; user-select: none; white-space: nowrap;}        
        .ytp-btn, .ytp-btn > * {text-decoration: none; cursor: pointer;}        
        .ytp-badge {border-radius: 8px; padding: 0.2em; font-size: 0.8em; vertical-align: top;} 
        .ytp-play-all-btn, .ytp-random-badge, .ytp-random-notice {background-color: #2b66da; color: white;} 
        .ytp-play-all-btn {display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:0.45em 0.85em;white-space:nowrap;flex-shrink:0;max-width:fit-content;}
        .ytp-play-all-btn:hover {background-color: #6192ee;}        
        .ytp-button-row-wrapper {width: 100%; display: block; margin: 0 0 0.6rem 0;} 
        .ytp-button-container {display: inline-flex; align-items: center; gap: 0.6em; width: auto; margin: 0; flex-wrap: nowrap; overflow-x: auto; max-width: 100%;} 
        ytd-feed-filter-chip-bar-renderer iron-selector#chips,
        ytd-feed-filter-chip-bar-renderer iron-selector,
        ytd-feed-filter-chip-bar-renderer #chips-wrapper {display:flex; align-items:center; flex-wrap:nowrap; gap:8px; overflow-x:auto;}
        ytd-rich-grid-renderer .ytp-button-row-wrapper {margin-left: 0;}        
        /* fetch() API introduces a race condition. This hides the occasional duplicate buttons */
        .ytp-play-all-btn ~ .ytp-play-all-btn {display: none;}        
        /* Fix for mobile view */
        ytm-feed-filter-chip-bar-renderer .ytp-btn {margin-right: 12px; padding: 0.4em;}        
        body:has(#secondary ytd-playlist-panel-renderer[ytp-random]) .ytp-prev-button.ytp-button, body:has(#secondary ytd-playlist-panel-renderer[ytp-random]) .ytp-next-button.ytp-button:not([ytp-random="applied"]) {display: none !important;}        
        #secondary ytd-playlist-panel-renderer[ytp-random] ytd-menu-renderer.ytd-playlist-panel-renderer {height: 1em; visibility: hidden;}        
        #secondary ytd-playlist-panel-renderer[ytp-random]:not(:hover) ytd-playlist-panel-video-renderer {filter: blur(2em);} 
        #secondary ytd-playlist-panel-renderer[ytp-random] #header {display: flex; align-items: center; gap: 8px; flex-wrap: nowrap;}       
        .ytp-random-notice {padding: 0.3em 0.7em; z-index: 1000; white-space: nowrap;}        
    </style>`)
  );

  const getVideoId = url => {
    try {
      return new URLSearchParams(new URL(url).search).get('v');
    } catch {
      return null;
    }
  };

  const queryHTMLElement = selector => {
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
   * @return {{ getProgressState: () => { current: number, duration, number }, pauseVideo: () => void, seekTo: (number) => void, isLifaAdPlaying: () => boolean }} player
   */
  const getPlayer = () => /** @type {PlayerElement | null} */ ($('#movie_player'));

  const isAdPlaying = () => !!$('.ad-interrupting');

  const redirect = (v, list, ytpRandom = null) => {
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
      } catch {
        // Fallback: use direct navigation on error
        const url = `/watch?v=${v}&list=${list}${ytpRandom !== null ? `&ytp-random=${ytpRandom}` : ''}`;
        window.location.href = url;
      }
    }
  };

  let id = '';
  const apply = () => {
    if (id === '') {
      // do not apply prematurely, caused by mutation observer
      console.warn('[Play All] Channel ID not yet determined');
      return;
    }

    let parent = null;
    if (location.host === 'm.youtube.com') {
      parent = queryHTMLElement(
        'ytm-feed-filter-chip-bar-renderer .chip-bar-contents, ytm-feed-filter-chip-bar-renderer > div'
      );
    } else {
      parent = queryHTMLElement(
        'ytd-feed-filter-chip-bar-renderer iron-selector#chips, ytd-feed-filter-chip-bar-renderer iron-selector, ytd-feed-filter-chip-bar-renderer #chips-wrapper'
      );
    }

    // #5: add a custom container for buttons if Latest/Popular/Oldest is missing
    if (parent === null) {
      const grid = queryHTMLElement('ytd-rich-grid-renderer, ytm-rich-grid-renderer');
      if (!grid) {
        try {
          const sel = 'ytd-rich-grid-renderer, ytm-rich-grid-renderer';
          window.YouTubeUtils && YouTubeUtils.logger && YouTubeUtils.logger.debug
            ? YouTubeUtils.logger.debug('[Play All] Grid container not found', sel)
            : console.warn('[Play All] Grid container not found', sel);
        } catch {}
        return;
      }

      // Check if container already exists
      let existingContainer = grid.querySelector('.ytp-button-container');
      if (!existingContainer) {
        grid.insertAdjacentHTML('afterbegin', '<div class="ytp-button-container"></div>');
        existingContainer = grid.querySelector('.ytp-button-container');
      }
      parent = existingContainer instanceof HTMLElement ? existingContainer : null;
    }

    if (!parent) {
      console.warn('[Play All] Could not find parent container');
      return;
    }

    // Prevent duplicate buttons
    if (parent.querySelector('.ytp-play-all-btn')) {
      try {
        window.YouTubeUtils &&
          YouTubeUtils.logger &&
          YouTubeUtils.logger.debug &&
          YouTubeUtils.logger.debug('[Play All] Buttons already exist, skipping');
      } catch {}
      return;
    }

    // See: available-lists.md
    const [allPlaylist] = window.location.pathname.endsWith('/videos')
      ? // Normal videos
        // list=UU<ID> adds shorts into the playlist, list=UULF<ID> has videos without shorts
        ['UULF']
      : // Shorts
        window.location.pathname.endsWith('/shorts')
        ? ['UUSH']
        : // Live streams
          ['UULV'];

    const playlistSuffix = id.startsWith('UC') ? id.substring(2) : id;

    parent.insertAdjacentHTML(
      'beforeend',
      `<a class="ytp-btn ytp-play-all-btn" href="/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1&ytp-random=random&ytp-random-initial=1" title="${getPlayAllAriaLabel()}" aria-label="${getPlayAllAriaLabel()}">${getPlayAllLabel()}</a>`
    );

    const navigate = href => {
      window.location.assign(href);
    };

    if (location.host === 'm.youtube.com') {
      // Use event delegation for mobile buttons
      if (!parent.hasAttribute('data-ytp-delegated')) {
        parent.setAttribute('data-ytp-delegated', 'true');
        parent.addEventListener('click', event => {
          const btn = event.target.closest('.ytp-btn');
          if (btn && btn.href) {
            event.preventDefault();
            navigate(btn.href);
          }
        });
      }
    } else {
      // Use event delegation for desktop buttons
      if (!parent.hasAttribute('data-ytp-delegated')) {
        parent.setAttribute('data-ytp-delegated', 'true');
        parent.addEventListener('click', event => {
          const btn = event.target.closest('.ytp-play-all-btn');
          if (btn && btn.href) {
            event.preventDefault();
            event.stopPropagation();
            navigate(btn.href);
          }
        });
      }
    }
  };

  let observerFrame = 0;
  const runObserverWork = () => {
    observerFrame = 0;
    if (!featureEnabled) return;
    removeButton();
    apply();
  };

  const observer = new MutationObserver(() => {
    if (!featureEnabled) return;
    if (observerFrame) return;
    if (typeof requestAnimationFrame === 'function') {
      observerFrame = requestAnimationFrame(runObserverWork);
      return;
    }
    observerFrame = setTimeout(runObserverWork, 16);
  });

  const addButton = async () => {
    observer.disconnect();

    if (!featureEnabled) return;

    if (
      !(
        window.location.pathname.endsWith('/videos') ||
        window.location.pathname.endsWith('/shorts') ||
        window.location.pathname.endsWith('/streams')
      )
    ) {
      return;
    }

    // Regenerate button if switched between Latest and Popular
    const element = $(
      'ytd-rich-grid-renderer, ytm-feed-filter-chip-bar-renderer .iron-selected, ytm-feed-filter-chip-bar-renderer .chip-bar-contents .selected'
    );
    if (element) {
      observer.observe(element, {
        attributes: true,
        childList: false,
        subtree: false,
      });
    }

    // This check is necessary for the mobile Interval
    if ($('.ytp-play-all-btn')) {
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
      console.warn('[Play All] Error extracting channel ID from canonical:', e);
    }

    // Fallback: fetch HTML and parse
    try {
      const html = await (await fetch(location.href)).text();
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
        console.warn('[Play All] Could not extract channel ID');
      }
    } catch (e) {
      console.error('[Play All] Error fetching channel data:', e);
    }
  };

  // Removing the button prevents it from still existing when switching between "Videos", "Shorts", and "Live"
  // This is necessary due to the mobile Interval requiring a check for an already existing button
  const removeButton = () => {
    $$('.ytp-play-all-btn, .ytp-random-badge, .ytp-random-notice').forEach(element =>
      element.remove()
    );
  };

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
    // Intercept pushState/replaceState for SPA navigation on mobile
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () {
      const result = origPush.apply(this, arguments);
      setTimeout(checkUrlChange, 50);
      return result;
    };
    history.replaceState = function () {
      const result = origReplace.apply(this, arguments);
      setTimeout(checkUrlChange, 50);
      return result;
    };
    window.addEventListener('popstate', checkUrlChange, { passive: true });
    // Initial call
    addButton();
  } else {
    window.addEventListener('yt-navigate-start', removeButton);
    window.addEventListener('yt-navigate-finish', addButton);
    // Also attempt to add buttons on initial script run in case the SPA navigation event
    // already happened before this script was loaded (some browsers/firefox timing).
    try {
      setTimeout(addButton, 300);
    } catch {}
  }

  window.addEventListener('youtube-plus-settings-updated', e => {
    try {
      const nextEnabled = e?.detail?.enablePlayAll !== false;
      if (nextEnabled === featureEnabled) return;
      setFeatureEnabled(nextEnabled);
    } catch {
      setFeatureEnabled(loadFeatureEnabled());
    }
  });

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

    const getStorage = storageKey => {
      try {
        return JSON.parse(localStorage.getItem(storageKey) || '{}');
      } catch {
        return {};
      }
    };

    const isWatched = (storageKey, videoId) => getStorage(storageKey)[videoId] || false;
    const markWatched = (storageKey, videoId) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ ...getStorage(storageKey), [videoId]: true })
      );
      document
        .querySelectorAll('#wc-endpoint[href*=zsA3X40nz9w]')
        .forEach(element => element.parentElement.setAttribute('hidden', ''));
    };

    const playNextRandom = (cfg, reload = false) => {
      const playerInstance = getPlayer();
      if (playerInstance && typeof playerInstance.pauseVideo === 'function') {
        playerInstance.pauseVideo();
      }

      const videos = Object.entries(getStorage(cfg.storageKey)).filter(([_, watched]) => !watched);
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
          redirect(videos[videoIndex][0], params.get('list'), cfg.mode);
        } catch (error) {
          console.error(
            '[Play All] Error using redirect(), falling back to manual redirect:',
            error
          );
          // Fallback to manual redirect if the redirect() function fails
          const redirector = document.createElement('a');
          redirector.className = 'yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer';
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

    let applyRetryTimeoutId = null;
    let progressIntervalId = null;

    stopRandomPlayTimers = () => {
      if (applyRetryTimeoutId) clearTimeout(applyRetryTimeoutId);
      applyRetryTimeoutId = null;
      // progressIntervalId is now a boolean or event listener, not a timer
      if (progressIntervalId && typeof progressIntervalId !== 'boolean') {
        clearInterval(progressIntervalId);
      }
      progressIntervalId = null;
    };

    const applyRandomPlay = cfg => {
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
        headerContainer.insertAdjacentHTML(
          'beforeend',
          `<span class="ytp-random-notice">Play All mode</span>`
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

      const anchors = [];
      anchorSelectors.forEach(sel => {
        playlistContainer.querySelectorAll(sel).forEach(a => {
          if (a instanceof Element && a.tagName === 'A') anchors.push(/** @type {any} */ (a));
        });
      });

      // Deduplicate by href
      const uniq = [];
      const seen = new Set();
      anchors.forEach(a => {
        const href = a.href || a.getAttribute('href') || '';
        if (!seen.has(href)) {
          seen.add(href);
          uniq.push(a);
        }
      });

      const navigate = href => (window.location.href = href);

      // Mark videos and prepare links
      uniq.forEach(element => {
        let videoId = null;
        try {
          videoId = new URL(element.href, window.location.origin).searchParams.get('v');
        } catch {
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
        } catch {}

        element.setAttribute('data-ytp-random-link', 'true');

        const entryKey = getVideoId(element.href);
        if (isWatched(cfg.storageKey, entryKey)) {
          element.parentElement?.setAttribute('hidden', '');
        }
      });

      // Use event delegation for video links
      if (playlistContainer && !playlistContainer.hasAttribute('data-ytp-random-delegated')) {
        playlistContainer.setAttribute('data-ytp-random-delegated', 'true');
        playlistContainer.addEventListener('click', event => {
          const link = event.target.closest('a[data-ytp-random-link]');
          if (link && link.href) {
            event.preventDefault();
            navigate(link.href);
          }
        });
      }
      localStorage.setItem(cfg.storageKey, JSON.stringify(storage));

      if (
        cfg.params.get('ytp-random-initial') === '1' ||
        isWatched(cfg.storageKey, getVideoId(location.href))
      ) {
        playNextRandom(cfg);

        return;
      }

      const header = playlistContainer.querySelector('h3 a');
      if (header && header.tagName === 'A') {
        const anchorHeader = /** @type {HTMLAnchorElement} */ (/** @type {unknown} */ (header));
        anchorHeader.innerHTML += ` <span class="ytp-badge ytp-random-badge">Play All <span style="font-size: 2rem; vertical-align: top">&times;</span></span>`;
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

      document.addEventListener(
        'keydown',
        event => {
          // SHIFT + N
          if (event.shiftKey && event.key.toLowerCase() === 'n') {
            event.stopImmediatePropagation();
            event.preventDefault();

            const videoId = getVideoId(location.href);
            markWatched(cfg.storageKey, videoId);
            // Unfortunately there is no workaround to YouTube redirecting to the next in line without a reload
            playNextRandom(cfg, true);
          }
        },
        true
      );

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

        const nextButton = $('#ytd-player .ytp-next-button.ytp-button:not([ytp-random="applied"])');
        if (nextButton instanceof HTMLElement) {
          // Replace with span to prevent anchor click events
          const newButton = document.createElement('span');
          newButton.className = nextButton.className;
          newButton.innerHTML = nextButton.innerHTML;
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

    scheduleApplyRandomPlay = (attempt = 0) => {
      if (!featureEnabled) return;
      stopRandomPlayTimers();

      if (!window.location.pathname.endsWith('/watch')) return;

      const cfg = getRandomConfig();
      if (!cfg) return;

      // Storage needs to now be { [videoId]: bool }
      try {
        const current = localStorage.getItem(cfg.storageKey);
        if (current && Array.isArray(JSON.parse(current))) {
          localStorage.removeItem(cfg.storageKey);
        }
      } catch {
        localStorage.removeItem(cfg.storageKey);
      }

      applyRandomPlay(cfg);

      // If the playlist panel isn't ready yet, retry a few times (no always-on polling)
      if (attempt >= 30) return;
      applyRetryTimeoutId = setTimeout(() => scheduleApplyRandomPlay(attempt + 1), 250);
    };

    const onNavigate = () => {
      if (!featureEnabled) {
        stopRandomPlayTimers();
        return;
      }
      stopRandomPlayTimers();
      scheduleApplyRandomPlay();
    };

    onNavigate();
    window.addEventListener('yt-navigate-finish', () => setTimeout(onNavigate, 200));
  })();
})().catch(error =>
  console.error(
    '%cytp - YouTube Play All\n',
    'color: #bf4bcc; font-size: 32px; font-weight: bold',
    error
  )
);
