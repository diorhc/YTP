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

  const gmApi = globalContext?.GM ?? null;
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
        .ytp-btn {border-radius: 8px; font-family: 'Roboto', 'Arial', sans-serif; font-size: 1.4rem; line-height: 2rem; font-weight: 500; padding: 0.5em; margin-left: 0.6em; user-select: none;}        
        .ytp-btn, .ytp-btn > * {text-decoration: none; cursor: pointer;}        
        .ytp-btn-sections {padding: 0;}        
        .ytp-btn-sections > .ytp-btn-section {padding: 0.5em; display: inline-block;} 
        .ytp-btn-sections > .ytp-btn-section:first-child {border-top-left-radius: 8px; border-bottom-left-radius: 8px;} 
        .ytp-btn-sections > .ytp-btn-section:nth-last-child(1 of .ytp-btn-section) {border-top-right-radius: 8px; border-bottom-right-radius: 8px;}        
        .ytp-badge {border-radius: 8px; padding: 0.2em; font-size: 0.8em; vertical-align: top;} 
        .ytp-play-all-btn {background-color: #bf4bcc; color: white;} 
        .ytp-play-all-btn:hover {background-color: #d264de;}        
        .ytp-random-btn > .ytp-btn-section, .ytp-random-badge, .ytp-random-notice, .ytp-random-popover > * {background-color: #2b66da; color: white;} 
        .ytp-random-btn > .ytp-btn-section:hover, .ytp-random-popover > *:hover {background-color: #6192ee;}        
        .ytp-play-all-btn.ytp-unsupported {background-color: #828282; color: white;}        
        .ytp-random-popover {position: absolute; border-radius: 8px; font-size: 1.6rem; transform: translate(-100%, 0.4em);}        
        .ytp-random-popover > * {display: block; text-decoration: none; padding: 0.4em;}        
        .ytp-random-popover > :first-child {border-top-left-radius: 8px; border-top-right-radius: 8px;}        
        .ytp-random-popover > :last-child {border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;}    
        .ytp-random-popover > *:not(:last-child) {border-bottom: 1px solid #6e8dbb;}    
        .ytp-button-container {display: flex; width: 100%; margin-top: 1em; margin-bottom: -1em;} 
        ytd-rich-grid-renderer .ytp-button-container > :first-child {margin-left: 0;}        
        /* fetch() API introduces a race condition. This hides the occasional duplicate buttons */
        .ytp-play-all-btn ~ .ytp-play-all-btn, .ytp-random-btn ~ .ytp-random-btn {display: none;}        
        /* Fix for mobile view */
        ytm-feed-filter-chip-bar-renderer .ytp-btn {margin-right: 12px; padding: 0.4em;}        
        body:has(#secondary ytd-playlist-panel-renderer[ytp-random]) .ytp-prev-button.ytp-button, body:has(#secondary ytd-playlist-panel-renderer[ytp-random]) .ytp-next-button.ytp-button:not([ytp-random="applied"]) {display: none !important;}        
        #secondary ytd-playlist-panel-renderer[ytp-random] ytd-menu-renderer.ytd-playlist-panel-renderer {height: 1em; visibility: hidden;}        
        #secondary ytd-playlist-panel-renderer[ytp-random]:not(:hover) ytd-playlist-panel-video-renderer {filter: blur(2em);} 
        .ytp-random-notice {padding: 1em; z-index: 1000;}        
        .ytp-playlist-emulator {margin-bottom: 1.6rem; border-radius: 1rem;}        
        .ytp-playlist-emulator > .title {border-top-left-radius: 1rem; border-top-right-radius: 1rem; font-size: 2rem; background-color: #323232; color: white; padding: 0.8rem;}        
        .ytp-playlist-emulator > .information {font-size: 1rem; background-color: #2b2a2a; color: white; padding: 0.8rem;}        
        .ytp-playlist-emulator > .footer {border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; background-color: #323232; padding: 0.8rem;}        
        .ytp-playlist-emulator > .items {max-height: 500px; overflow-y: auto; overflow-x: hidden;}        
        .ytp-playlist-emulator:not([data-failed]) > .items:empty::before {content: 'Loading playlist...'; background-color: #626262; padding: 0.8rem; color: white; font-size: 2rem; display: block;}        
        .ytp-playlist-emulator[data-failed="rejected"] > .items:empty::before {content: "Make sure to allow the external API call to ytplaylist.robert.wesner.io to keep viewing playlists that YouTube doesn't natively support!"; background-color: #491818; padding: 0.8rem; color: #ff7c7c; font-size: 1rem; display: block;}        
        .ytp-playlist-emulator > .items > .item {background-color: #2c2c2c; padding: 0.8rem; border: 1px solid #1b1b1b; font-size: 1.6rem; color: white; min-height: 5rem; cursor: pointer;}        
        .ytp-playlist-emulator > .items > .item:hover {background-color: #505050;}      
        .ytp-playlist-emulator > .items > .item:not(:last-of-type) {border-bottom: 0;}        
        .ytp-playlist-emulator > .items > .item[data-current] {background-color: #767676;}        
        body:has(.ytp-playlist-emulator) .ytp-prev-button.ytp-button, body:has(.ytp-playlist-emulator) .ytp-next-button.ytp-button:not([ytp-emulation="applied"]) {display: none !important;}        
        /* hide when sorting by oldest */
        ytm-feed-filter-chip-bar-renderer > div :nth-child(3).selected ~ .ytp-btn:not(.ytp-unsupported), ytd-feed-filter-chip-bar-renderer iron-selector#chips :nth-child(3).iron-selected ~ .ytp-btn:not(.ytp-unsupported) {display: none;}
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

    let parent =
      location.host === 'm.youtube.com'
        ? // mobile view
          queryHTMLElement(
            'ytm-feed-filter-chip-bar-renderer .chip-bar-contents, ytm-feed-filter-chip-bar-renderer > div'
          )
        : // desktop view
          queryHTMLElement('ytd-feed-filter-chip-bar-renderer iron-selector#chips');

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
    if (parent.querySelector('.ytp-play-all-btn, .ytp-random-btn')) {
      try {
        window.YouTubeUtils &&
          YouTubeUtils.logger &&
          YouTubeUtils.logger.debug &&
          YouTubeUtils.logger.debug('[Play All] Buttons already exist, skipping');
      } catch {}
      return;
    }

    // See: available-lists.md
    const [allPlaylist, popularPlaylist] = window.location.pathname.endsWith('/videos')
      ? // Normal videos
        // list=UULP has the all videos sorted by popular
        // list=UU<ID> adds shorts into the playlist, list=UULF<ID> has videos without shorts
        ['UULF', 'UULP']
      : // Shorts
        window.location.pathname.endsWith('/shorts')
        ? ['UUSH', 'UUPS']
        : // Live streams
          ['UULV', 'UUPV'];

    const playlistSuffix = id.startsWith('UC') ? id.substring(2) : id;

    // Check if popular videos are displayed
    if (parent.querySelector(':nth-child(2).selected, :nth-child(2).iron-selected')) {
      parent.insertAdjacentHTML(
        'beforeend',
        `<a class="ytp-btn ytp-play-all-btn" href="/playlist?list=${popularPlaylist}${playlistSuffix}&playnext=1">Play Popular</a>`
      );
    } else if (parent.querySelector(':nth-child(1).selected, :nth-child(1).iron-selected')) {
      parent.insertAdjacentHTML(
        'beforeend',
        `<a class="ytp-btn ytp-play-all-btn" href="/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1">Play All</a>`
      );
    } else {
      parent.insertAdjacentHTML(
        'beforeend',
        `<a class="ytp-btn ytp-play-all-btn ytp-unsupported" href="https://github.com/RobertWesner/YouTube-Play-All/issues/39" target="_blank">No Playlist Found</a>`
      );
    }

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
          const btn = event.target.closest(
            '.ytp-play-all-btn:not(.ytp-unsupported), .ytp-random-btn a'
          );
          if (btn && btn.href) {
            event.preventDefault();
            event.stopPropagation();
            navigate(btn.href);
          }
        });
      }

      // Only allow random play in desktop version for now
      parent.insertAdjacentHTML(
        'beforeend',
        `
                <span class="ytp-btn ytp-random-btn ytp-btn-sections">
                    <a class="ytp-btn-section" href="/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1&ytp-random=random&ytp-random-initial=1">
                        Play Random
                    </a><!--
                    --><span class="ytp-btn-section ytp-random-more-options-btn ytp-hover-popover">
                        &#x25BE
                    </span>
                </span>
            `
      );

      // Remove existing popovers to prevent duplicates when navigating between tabs
      $$('.ytp-random-popover').forEach(popover => popover.remove());

      document.body.insertAdjacentHTML(
        'beforeend',
        `
                <div class="ytp-random-popover" hidden="">
                    <a href="/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1&ytp-random=prefer-newest">
                        Prefer newest
                    </a>
                    <a href="/playlist?list=${allPlaylist}${playlistSuffix}&playnext=1&ytp-random=prefer-oldest&ytp-random-initial=1">
                        Prefer oldest
                    </a>
                </div>
            `
      );

      const randomPopover = $('.ytp-random-popover');
      const randomMoreOptionsBtn = $('.ytp-random-more-options-btn');

      // Use event delegation for random popover links
      if (randomPopover && !randomPopover.hasAttribute('data-ytp-delegated')) {
        randomPopover.setAttribute('data-ytp-delegated', 'true');
        randomPopover.addEventListener('click', event => {
          const link = event.target.closest('a');
          if (link && link.href) {
            event.preventDefault();
            event.stopPropagation();
            navigate(link.href);
          }
        });
        randomPopover.addEventListener('mouseleave', () => {
          randomPopover.setAttribute('hidden', '');
        });
      }

      if (randomMoreOptionsBtn && randomPopover) {
        randomMoreOptionsBtn.addEventListener('click', () => {
          const rect = randomMoreOptionsBtn.getBoundingClientRect();
          randomPopover.style.top = `${rect.bottom}px`;
          randomPopover.style.left = `${rect.right}px`;
          randomPopover.removeAttribute('hidden');
        });
      }
    }
  };

  const observer = new MutationObserver(() => {
    if (!featureEnabled) return;
    // [20250929-0] removeButton first and then apply, not addButton, since we don't need the pathname validation, and we want mobile to also use it
    removeButton();
    apply();
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
  const removeButton = () => $$('.ytp-btn').forEach(element => element.remove());

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

  // Fallback playlist emulation
  (() => {
    const getItems = playlist => {
      return new Promise(resolve => {
        const payload = {
          uri: `https://www.youtube.com/playlist?list=${playlist}`,
          requestType: `ytp ${gmInfo?.script?.version ?? 'unknown'}`,
        };

        const markFailure = () => {
          const emulator = $('.ytp-playlist-emulator');
          if (emulator instanceof HTMLElement) {
            emulator.setAttribute('data-failed', 'rejected');
          }
        };

        const handleSuccess = data => {
          resolve(data);
        };

        const handleError = () => {
          markFailure();
          resolve({ status: 'error', items: [] });
        };

        if (gmApi && typeof gmApi.xmlHttpRequest === 'function') {
          gmApi.xmlHttpRequest({
            method: 'POST',
            url: 'https://ytplaylist.robert.wesner.io/api/list',
            data: JSON.stringify(payload),
            headers: {
              'Content-Type': 'application/json',
            },
            onload: response => {
              try {
                handleSuccess(JSON.parse(response.responseText));
              } catch (parseError) {
                console.error('[Play All] Failed to parse playlist response:', parseError);
                handleError();
              }
            },
            onerror: _error => {
              handleError();
            },
          });
          return;
        }

        // Fallback to fetch when GM.xmlHttpRequest is unavailable (e.g., during tests)
        fetch('https://ytplaylist.robert.wesner.io/api/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
          .then(resp => resp.json())
          .then(handleSuccess)
          .catch(err => {
            console.error('[Play All] Playlist fetch failed:', err);
            handleError();
          });
      });
    };

    const processItems = items => {
      const itemsContainer = $('.ytp-playlist-emulator .items');
      const params = new URLSearchParams(window.location.search);
      const list = params.get('list');

      if (!(itemsContainer instanceof HTMLElement)) {
        return;
      }

      items.forEach(
        /**
         * @param {{
         *  position: number,
         *  title: string,
         *  videoId: string,
         * }} item
         */
        item => {
          const element = document.createElement('div');
          element.className = 'item';
          element.textContent = item.title;
          element.setAttribute('data-id', item.videoId);
          element.addEventListener('click', () => redirect(item.videoId, list));

          itemsContainer.append(element);
        }
      );

      markCurrentItem(params.get('v'));
    };

    const playNextEmulationItem = () => {
      $(`.ytp-playlist-emulator .items .item[data-current] + .item`)?.click();
    };

    const markCurrentItem = videoId => {
      const existing = $(`.ytp-playlist-emulator .items .item[data-current]`);
      if (existing) {
        existing.removeAttribute('data-current');
      }

      const current = $(`.ytp-playlist-emulator .items .item[data-id="${videoId}"]`);
      if (current instanceof HTMLElement) {
        current.setAttribute('data-current', '');
        const parentElement = current.parentElement;
        if (parentElement instanceof HTMLElement) {
          const docElement = /** @type {any} */ (document.documentElement);
          const fontSize = parseFloat(getComputedStyle(docElement).fontSize || '16');
          parentElement.scrollTop = current.offsetTop - 12 * fontSize;
        }
      }
    };

    const emulatePlaylist = () => {
      if (!window.location.pathname.endsWith('/watch')) {
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const list = params.get('list');
      if (!list) {
        return;
      }
      if (params.has('ytp-random')) {
        return;
      }

      // prevent playlist emulation on queue
      // its impossible to fetch that playlist externally anyway
      // https://github.com/RobertWesner/YouTube-Play-All/issues/33
      if (list.startsWith('TLPQ')) {
        return;
      }

      // No user ID in the list, cannot be fetched externally -> no emulation
      if (list.length <= 4) {
        return;
      }

      const existingEmulator = $('.ytp-playlist-emulator');
      if (existingEmulator) {
        if (list === existingEmulator.getAttribute('data-list')) {
          markCurrentItem(params.get('v'));

          return;
        } else {
          // necessary to lose all the client side manipulations like SHIFT + N and the play next button
          window.location.reload();
        }
      }

      if (!new URLSearchParams(window.location.search).has('list')) {
        return;
      }

      if (!$('#secondary-inner > ytd-playlist-panel-renderer#playlist #items:empty')) {
        return;
      }

      const playlistEmulator = document.createElement('div');
      playlistEmulator.className = 'ytp-playlist-emulator';
      playlistEmulator.innerHTML = `
                <div class="title">
                    Playlist emulator
                </div>
                <div class="information">
                    It looks like YouTube is unable to handle this large playlist.
                    Playlist emulation is a <b>limited</b> fallback feature of ytp to enable you to watch even more content. <br>
                </div>
                <div class="items"></div>
                <div class="footer"></div>
            `;
      playlistEmulator.setAttribute('data-list', list);
      const playlistHost = $('#secondary-inner > ytd-playlist-panel-renderer#playlist');
      if (playlistHost instanceof HTMLElement) {
        playlistHost.insertAdjacentElement('afterend', /** @type {any} */ (playlistEmulator));
      }

      getItems(list).then(response => {
        if (response?.status === 'running') {
          setTimeout(
            () =>
              getItems(list).then(nextResponse => {
                if (nextResponse && Array.isArray(nextResponse.items)) {
                  processItems(nextResponse.items);
                }
              }),
            5000
          );

          return;
        }

        if (response && Array.isArray(response.items)) {
          processItems(response.items);
        }
      });

      // Use MutationObserver instead of setInterval for better performance
      const setupNextButton = () => {
        const nextButton = $(
          '#ytd-player .ytp-next-button.ytp-button:not([ytp-emulation="applied"])'
        );
        if (nextButton) {
          // Replace with span to prevent anchor click events
          const newButton = document.createElement('span');
          newButton.className = nextButton.className;
          newButton.innerHTML = nextButton.innerHTML;
          nextButton.replaceWith(newButton);

          newButton.setAttribute('ytp-emulation', 'applied');
          newButton.addEventListener('click', () => playNextEmulationItem());
          return true;
        }
        return false;
      };

      if (!setupNextButton()) {
        const nextButtonObserver = new MutationObserver(() => {
          if (setupNextButton()) {
            nextButtonObserver.disconnect();
          }
        });
        const playerEl = $('#ytd-player');
        if (playerEl) {
          nextButtonObserver.observe(playerEl, { childList: true, subtree: true });
        }
      }

      document.addEventListener(
        'keydown',
        event => {
          // SHIFT + N
          if (event.shiftKey && event.key.toLowerCase() === 'n') {
            event.stopImmediatePropagation();
            event.preventDefault();

            playNextEmulationItem();
          }
        },
        true
      );

      // Use video timeupdate event instead of setInterval for better performance
      const videoEl = $('video');
      if (videoEl) {
        const handleTimeUpdate = () => {
          const player = getPlayer();
          if (!player || typeof player.getProgressState !== 'function') {
            return;
          }

          const progressState = player.getProgressState();
          if (!progressState) {
            return;
          }

          // Do not listen for watch progress when watching advertisements
          if (!isAdPlaying()) {
            // Autoplay random video
            if (
              typeof progressState.current === 'number' &&
              typeof progressState.duration === 'number' &&
              progressState.current >= progressState.duration - 2
            ) {
              // make sure vanilla autoplay doesnt take over
              if (typeof player.pauseVideo === 'function') player.pauseVideo();
              if (typeof player.seekTo === 'function') player.seekTo(0);
              playNextEmulationItem();
            }
          }
        };
        videoEl.addEventListener('timeupdate', handleTimeUpdate, { passive: true });
      }
    };

    if (location.host === 'm.youtube.com') {
      // Note: Mobile playlist emulation is currently not supported due to different DOM structure
      // and API limitations on mobile YouTube. Future implementation would require:
      // - Mobile-specific DOM selectors
      // - Touch event handling
      // - Responsive UI adjustments
      try {
        window.YouTubeUtils &&
          YouTubeUtils.logger &&
          YouTubeUtils.logger.info &&
          YouTubeUtils.logger.info('[Play All] Mobile playlist emulation not yet supported');
      } catch {}
    } else {
      window.addEventListener('yt-navigate-finish', () => setTimeout(emulatePlaylist, 1000));
    }
  })();

  // Random play feature
  (() => {
    // Random play is not supported for mobile devices
    if (location.host === 'm.youtube.com') {
      return;
    }

    const getParams = () => new URLSearchParams(window.location.search);

    /** @returns {{ params: URLSearchParams, mode: 'random'|'prefer-newest'|'prefer-oldest', list: string, storageKey: string } | null} */
    const getRandomConfig = () => {
      const params = getParams();
      const modeParam = params.get('ytp-random');
      if (!modeParam || modeParam === '0') return null;

      /** @type {'random'|'prefer-newest'|'prefer-oldest'} */
      const mode =
        modeParam === 'prefer-newest' || modeParam === 'prefer-oldest' ? modeParam : 'random';
      const list = params.get('list') || '';
      if (!list) return null;

      return { params, mode, list, storageKey: `ytp-random-${list}` };
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

      // Either one fifth or at most the 20 newest.
      const preferredCount = Math.max(1, Math.min(Math.floor(videos.length * 0.2), 20));

      let videoIndex;
      switch (cfg.mode) {
        case 'prefer-newest':
          // Select between latest 20 videos
          videoIndex = Math.floor(Math.random() * preferredCount);

          break;
        case 'prefer-oldest':
          // Select between oldest `preferredCount` videos (the last N entries).
          // videos is an array where order follows the playlist DOM order; to pick
          // from the oldest items we need to start at `videos.length - preferredCount`.
          videoIndex = videos.length - preferredCount + Math.floor(Math.random() * preferredCount);

          break;
        default:
          videoIndex = Math.floor(Math.random() * videos.length);
      }

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
      const headerContainer = playlistContainer.querySelector('.header');
      if (headerContainer) {
        headerContainer.insertAdjacentHTML(
          'afterend',
          `
                <div class="ytp-random-notice">
                    This playlist is using random play.<br>
                    The videos will <strong>not be played in the order</strong> listed here.
                </div>
            `
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
        anchorHeader.innerHTML += ` <span class="ytp-badge ytp-random-badge">${cfg.mode} <span style="font-size: 2rem; vertical-align: top">&times;</span></span>`;
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
