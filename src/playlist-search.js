// Playlist Search
(function () {
  'use strict';

  let featureEnabled = true;
  const loadFeatureEnabled = () => {
    try {
      const settings = localStorage.getItem('youtube_plus_settings');
      if (settings) {
        const parsed = JSON.parse(settings);
        return parsed.enablePlaylistSearch !== false;
      }
    } catch {}
    return true;
  };
  const setFeatureEnabled = nextEnabled => {
    featureEnabled = nextEnabled !== false;
    if (!featureEnabled) {
      cleanup();
    } else {
      ensureInit();
      handleNavigation();
    }
  };

  featureEnabled = loadFeatureEnabled();

  // Prevent multiple initializations
  if (window._playlistSearchInitialized) return;
  window._playlistSearchInitialized = true;

  // DOM cache helpers with fallback
  const qs = selector => {
    if (window.YouTubeDOMCache && typeof window.YouTubeDOMCache.get === 'function') {
      return window.YouTubeDOMCache.get(selector);
    }
    return document.querySelector(selector);
  };

  /**
   * Translation helper - uses centralized i18n system
   * @param {string} key - Translation key
   * @param {Object} params - Interpolation parameters
   * @returns {string} Translated string
   */
  const t = (key, params = {}) => {
    if (window.YouTubePlusI18n?.t) return window.YouTubePlusI18n.t(key, params);
    if (window.YouTubeUtils?.t) return window.YouTubeUtils.t(key, params);
    // Embedded English fallback (prevents showing raw keys during early init)
    try {
      const embeddedEn = window.YouTubePlusEmbeddedTranslations?.en;
      if (embeddedEn && embeddedEn[key]) {
        let text = embeddedEn[key];
        if (params && Object.keys(params).length > 0) {
          Object.keys(params).forEach(param => {
            text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
          });
        }
        return text;
      }
    } catch {}
    // Fallback for initialization phase
    return key || '';
  };

  // This module targets playlist content on both /watch and /playlist pages.
  const shouldRunOnThisPage = () => {
    return (
      window.location.hostname.endsWith('youtube.com') &&
      window.location.hostname !== 'music.youtube.com' &&
      (window.location.pathname === '/watch' || window.location.pathname === '/playlist')
    );
  };

  const isWatchPage = () => window.location.pathname === '/watch';
  const isPlaylistPage = () => window.location.pathname === '/playlist';

  const isRelevantRoute = () => {
    if (!shouldRunOnThisPage()) return false;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.has('list');
    } catch {
      return false;
    }
  };

  const onDomReady = cb => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb, { once: true });
    } else {
      cb();
    }
  };

  // Use shared debounce/throttle from YouTubeUtils
  const debounce = (func, wait) => {
    if (window.YouTubeUtils?.debounce) return window.YouTubeUtils.debounce(func, wait);
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  };

  const throttle = (func, limit) => {
    if (window.YouTubeUtils?.throttle) return window.YouTubeUtils.throttle(func, limit);
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  };

  // Previously limited to specific lists (LL/WL). Now support any playlist id.

  const config = {
    enabled: true,
    storageKey: 'youtube_playlist_search_settings',
    searchDebounceMs: 150, // Optimized debounce for better responsiveness
    observerThrottleMs: 300, // Reduced throttle for faster updates
    maxPlaylistItems: 10000, // Increased limit for large playlists
    maxQueryLength: 300, // Increased for more flexible search
    deleteDelay: 250, // Delay between sequential delete actions
  };

  const state = {
    searchInput: null,
    searchResults: null,
    originalItems: [],
    currentPlaylistId: null,
    mutationObserver: null,
    rafId: null,
    itemsCache: new Map(), // Cache for faster lookups
    itemsContainer: null,
    itemSelector: null,
    itemTagName: null,
    playlistPanel: null,
    isPlaylistPage: false,
    // Deletion state
    isDeleting: false,
    deleteMode: false,
    selectedItems: new Set(),
  };

  const inputDebouncers = new WeakMap();
  const setupInputDelegation = (() => {
    let attached = false;
    return () => {
      if (attached) return;
      attached = true;

      const handleFocus = input => {
        input.style.borderColor = 'var(--yt-spec-call-to-action)';
      };

      const handleBlur = input => {
        input.style.borderColor = 'var(--yt-spec-10-percent-layer)';
      };

      const handleInput = input => {
        let debounced = inputDebouncers.get(input);
        if (!debounced) {
          debounced = debounce(value => {
            if (value.length > config.maxQueryLength) {
              const truncated = value.substring(0, config.maxQueryLength);
              input.value = truncated;
              filterPlaylistItems(truncated);
              return;
            }
            filterPlaylistItems(value);
          }, config.searchDebounceMs);
          inputDebouncers.set(input, debounced);
        }
        debounced(input.value || '');
      };

      const delegator = window.YouTubePlusEventDelegation;
      if (delegator?.on) {
        delegator.on(document, 'focusin', '.ytplus-playlist-search-input', (ev, target) => {
          void ev;
          if (target) handleFocus(target);
        });
        delegator.on(document, 'focusout', '.ytplus-playlist-search-input', (ev, target) => {
          void ev;
          if (target) handleBlur(target);
        });
        delegator.on(document, 'input', '.ytplus-playlist-search-input', (ev, target) => {
          void ev;
          if (target) handleInput(target);
        });
      } else {
        document.addEventListener(
          'focusin',
          ev => {
            const target = ev.target?.closest?.('.ytplus-playlist-search-input');
            if (target) handleFocus(target);
          },
          true
        );
        document.addEventListener(
          'focusout',
          ev => {
            const target = ev.target?.closest?.('.ytplus-playlist-search-input');
            if (target) handleBlur(target);
          },
          true
        );
        document.addEventListener(
          'input',
          ev => {
            const target = ev.target?.closest?.('.ytplus-playlist-search-input');
            if (target) handleInput(target);
          },
          true
        );
      }
    };
  })();

  // Load settings from localStorage
  const loadSettings = () => {
    try {
      const globalSettings = localStorage.getItem('youtube_plus_settings');
      if (globalSettings) {
        const parsedGlobal = JSON.parse(globalSettings);
        if (typeof parsedGlobal.enablePlaylistSearch === 'boolean') {
          config.enabled = parsedGlobal.enablePlaylistSearch;
        }
      }
      const saved = localStorage.getItem(config.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Use safeMerge to prevent prototype pollution
        if (window.YouTubeUtils && window.YouTubeUtils.safeMerge) {
          window.YouTubeUtils.safeMerge(config, parsed);
        } else {
          // Fallback: only copy known safe keys
          if (typeof parsed.enabled === 'boolean') config.enabled = parsed.enabled;
        }
      }
    } catch (error) {
      console.warn('[Playlist Search] Failed to load settings:', error);
    }
  };

  // (saveSettings removed - settings are static for this module)

  /**
   * Get current playlist id with validation
   * @returns {string|null} Valid playlist ID or null
   */
  const getCurrentPlaylistId = () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const listId = urlParams.get('list');

      // Validate playlist ID format (alphanumeric, dashes, underscores)
      if (listId && /^[a-zA-Z0-9_-]+$/.test(listId)) {
        return listId;
      }

      return null;
    } catch (error) {
      console.warn('[Playlist Search] Failed to get playlist ID:', error);
      return null;
    }
  };

  /**
   * Try to obtain a display name for the current playlist from DOM
   * @param {Element|HTMLElement} playlistPanel - Playlist panel element
   * @param {string} listId - Playlist ID
   * @returns {string} Playlist display name
   */
  const getPlaylistDisplayName = (playlistPanel, listId) => {
    try {
      // Common places for title: .title, h3 a, #header-title, #title
      const sel = [
        'ytd-playlist-header-renderer #title',
        'ytd-playlist-header-renderer .title',
        '.title',
        'h3 a',
        '#header-title',
        '#title',
        '.playlist-title',
        'h1.title',
      ];
      for (const s of sel) {
        const el = playlistPanel.querySelector(s) || qs(s);
        if (el && el.textContent && el.textContent.trim()) {
          // Sanitize and limit length
          const title = el.textContent.trim();
          return title.length > 100 ? title.substring(0, 100) + '...' : title;
        }
      }

      // Fallback to meta or channel-specific metadata
      const meta = qs('meta[name="title"]') || qs('meta[property="og:title"]');
      if (meta && meta.content) {
        const title = meta.content.trim();
        return title.length > 100 ? title.substring(0, 100) + '...' : title;
      }
    } catch (error) {
      console.warn('[Playlist Search] Failed to get display name:', error);
    }

    // Default to sanitized id if nothing else
    if (listId && typeof listId === 'string') {
      return listId.substring(0, 50); // Limit length
    }

    return 'playlist';
  };

  const getPlaylistContext = () => {
    if (isPlaylistPage()) {
      const panel = qs('ytd-playlist-video-list-renderer');
      if (!panel) return null;
      const itemsContainer =
        panel.querySelector('#contents') ||
        panel.querySelector('ytd-playlist-video-list-renderer #contents');
      return {
        panel,
        itemsContainer,
        itemSelector: 'ytd-playlist-video-renderer',
        itemTagName: 'YTD-PLAYLIST-VIDEO-RENDERER',
        isPlaylistPage: true,
      };
    }

    if (isWatchPage()) {
      const panel = qs('ytd-playlist-panel-renderer');
      if (!panel) return null;
      const itemsContainer =
        panel.querySelector('#items') ||
        panel.querySelector('.playlist-items.style-scope.ytd-playlist-panel-renderer') ||
        panel.querySelector('.playlist-items');
      return {
        panel,
        itemsContainer,
        itemSelector: 'ytd-playlist-panel-video-renderer',
        itemTagName: 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER',
        isPlaylistPage: false,
      };
    }

    return null;
  };

  // Add search UI to playlist panel
  const addSearchUI = () => {
    if (!config.enabled) return;

    if (!shouldRunOnThisPage()) return;

    const playlistId = getCurrentPlaylistId();
    if (!playlistId) return;

    const context = getPlaylistContext();
    if (!context) return;
    const { panel: playlistPanel, itemsContainer, itemSelector, itemTagName } = context;

    // Don't add search UI twice
    if (playlistPanel.querySelector('.ytplus-playlist-search')) return;

    state.currentPlaylistId = playlistId;
    state.itemsContainer = itemsContainer || null;
    state.itemSelector = itemSelector;
    state.itemTagName = itemTagName;
    state.playlistPanel = playlistPanel;
    state.isPlaylistPage = context.isPlaylistPage;

    // Create search container
    const searchContainer = document.createElement('div');
    searchContainer.className = 'ytplus-playlist-search';
    searchContainer.style.cssText = `
      padding: 8px 16px;
      background: transparent;
      border-bottom: 1px solid var(--yt-spec-10-percent-layer);
      z-index: 50;
      width: 94%;
    `;

    // Make search (and delete bar inside it) sticky within the playlist area.
    // We try to use `position: sticky` when possible; if the DOM structure
    // prevents sticky from working, fall back to `position: fixed` anchored
    // to the playlist panel so the UI remains visible while scrolling.
    const ensureSticky = () => {
      try {
        // If we're on the /watch page, keep the previous simple sticky style
        // to avoid changing the look/positioning inside the right-hand panel.
        if (!state.isPlaylistPage) {
          searchContainer.style.position = 'sticky';
          searchContainer.style.top = '0';
          searchContainer.style.zIndex = '1';
          searchContainer.style.background = 'transparent';
          return;
        }

        const panel = state.playlistPanel || getPlaylistContext()?.panel;
        // Prefer small top offset on watch page (inside right panel), larger
        // offset on playlist page to account for header/thumbnail column.
        const topOffset = state.isPlaylistPage ? 84 : 8;

        // Try to find a scrollable ancestor for sticky positioning
        let scrollAncestor = panel;
        while (scrollAncestor && scrollAncestor !== document.body) {
          const style = window.getComputedStyle(scrollAncestor);
          const overflowY = style.overflowY;
          if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            scrollAncestor.scrollHeight > scrollAncestor.clientHeight
          ) {
            break;
          }
          scrollAncestor = scrollAncestor.parentElement;
        }

        if (scrollAncestor && scrollAncestor !== document.body) {
          // If a scrollable ancestor exists, use sticky
          searchContainer.style.position = 'sticky';
          searchContainer.style.top = `${topOffset}px`;
          searchContainer.style.background = 'var(--yt-spec-badge-chip-background)';
          searchContainer.style.backdropFilter = 'blur(6px)';
          searchContainer.style.boxShadow = 'var(--yt-shadow)';
        } else if (panel) {
          // Fallback: position fixed near the playlist panel so it remains visible
          const rect = panel.getBoundingClientRect();
          searchContainer.style.position = 'fixed';
          searchContainer.style.top = `${topOffset}px`;
          // Place horizontally aligned with the panel
          searchContainer.style.left = `${rect.left}px`;
          searchContainer.style.width = `${rect.width}px`;
          searchContainer.style.background = 'var(--yt-spec-badge-chip-background)';
          searchContainer.style.backdropFilter = 'blur(6px)';
          searchContainer.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
          searchContainer.style.zIndex = '9999';

          // Recompute on resize/scroll to keep alignment
          const recompute = debounce(() => {
            const r = panel.getBoundingClientRect();
            searchContainer.style.left = `${r.left}px`;
            searchContainer.style.width = `${r.width}px`;
          }, 120);
          window.addEventListener('resize', recompute, { passive: true });
          // If panel scrolls inside the page, adjust on scroll
          window.addEventListener('scroll', recompute, { passive: true });
        } else {
          // Last fallback: simple sticky at top
          searchContainer.style.position = 'sticky';
          searchContainer.style.top = `${topOffset}px`;
          searchContainer.style.background = 'var(--yt-spec-badge-chip-background)';
        }
      } catch {
        // Ignore errors and leave default styles
      }
    };

    // Ensure sticky after insertion as DOM layout may change
    setTimeout(ensureSticky, 100);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    const playlistName = getPlaylistDisplayName(playlistPanel, playlistId);
    const placeholderKey = state.isPlaylistPage
      ? 'searchPlaceholderPlaylistPage'
      : 'searchPlaceholder';
    searchInput.placeholder = t(placeholderKey, { playlist: playlistName });
    searchInput.className = 'ytplus-playlist-search-input';
    searchInput.style.cssText = `
      width: 93%;
      padding: 8px 16px;
      border: 1px solid var(--yt-spec-10-percent-layer);
      border-radius: 20px;
      background: var(--yt-spec-badge-chip-background);
      color: var(--yt-spec-text-primary);
      font-size: 14px;
      font-family: 'Roboto', Arial, sans-serif;
      outline: none;
      transition: border-color 0.2s;
    `;

    setupInputDelegation();

    searchContainer.appendChild(searchInput);
    state.searchInput = searchInput;

    // Try to insert the search UI into the playlist items container so it appears
    // inline with the list of videos. Prefer inserting before the first
    // ytd-playlist-panel-video-renderer if present.
    // Use more specific selector first for better performance
    if (itemsContainer) {
      /** @type {Element|null} */
      const firstVideo = itemsContainer.querySelector(itemSelector);
      if (firstVideo && firstVideo.parentElement === itemsContainer) {
        itemsContainer.insertBefore(searchContainer, /** @type {Node} */ (firstVideo));
      } else {
        // Append to items container if no video element found
        itemsContainer.appendChild(searchContainer);
      }
    } else {
      // Fallback: prepend to the panel root to ensure visibility
      if (playlistPanel.firstChild) {
        playlistPanel.insertBefore(searchContainer, playlistPanel.firstChild);
      } else {
        playlistPanel.appendChild(searchContainer);
      }
    }

    // Store original items
    collectOriginalItems();

    // Add delete UI (toggle button + action bar)
    addDeleteUI(searchContainer);

    // Setup MutationObserver to watch for new playlist items
    setupPlaylistObserver();
  };

  // Setup MutationObserver for dynamic playlist updates
  const setupPlaylistObserver = () => {
    // Disconnect existing observer if any
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
    }

    const playlistPanel = state.playlistPanel || getPlaylistContext()?.panel;
    if (!playlistPanel || !state.itemTagName) return;

    let lastUpdateCount = state.originalItems.length;
    let updateScheduled = false;
    const itemTagName = state.itemTagName;
    const itemSelector = state.itemSelector;
    const itemsRoot = state.itemsContainer || playlistPanel;

    // Throttled handler for mutations with better batching
    const handleMutations = throttle(mutations => {
      // Skip if update already scheduled
      if (updateScheduled) return;

      // Fast check: only process if playlist items were actually added/removed
      const hasRelevantChange = mutations.some(mutation => {
        if (mutation.type !== 'childList') return false;
        if (mutation.addedNodes.length === 0 && mutation.removedNodes.length === 0) return false;

        // Check if added/removed nodes contain playlist items
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node.nodeType === 1) {
            const element = /** @type {Element} */ (node);
            if (element.tagName === itemTagName) return true;
          }
        }
        for (let i = 0; i < mutation.removedNodes.length; i++) {
          const node = mutation.removedNodes[i];
          if (node.nodeType === 1) {
            const element = /** @type {Element} */ (node);
            if (element.tagName === itemTagName) return true;
          }
        }
        return false;
      });

      if (!hasRelevantChange) return;

      updateScheduled = true;
      requestAnimationFrame(() => {
        const currentCount = lastUpdateCount;
        const newItems = itemsRoot
          ? itemsRoot.querySelectorAll(itemSelector)
          : /** @type {NodeListOf<Element>} */ ([]);

        // Only recollect if item count changed
        if (newItems.length !== currentCount) {
          lastUpdateCount = newItems.length;
          collectOriginalItems();

          // Re-apply current search filter if any
          if (state.searchInput && state.searchInput.value) {
            filterPlaylistItems(state.searchInput.value);
          }
        }
        updateScheduled = false;
      });
    }, config.observerThrottleMs);

    state.mutationObserver = new MutationObserver(handleMutations);

    // Observe only the items container, not entire subtree
    const targetElement = itemsRoot || playlistPanel;

    state.mutationObserver.observe(targetElement, {
      childList: true,
      subtree: itemsRoot ? false : true, // Only observe subtree if we couldn't find items container
    });
  };

  /**
   * Collect all playlist items for filtering with limit and improved caching
   */
  const collectOriginalItems = () => {
    const itemsRoot = state.itemsContainer || state.playlistPanel;
    if (!itemsRoot || !state.itemSelector) return;
    const items = itemsRoot.querySelectorAll(state.itemSelector);

    // Limit number of items to prevent performance issues
    if (items.length > config.maxPlaylistItems) {
      console.warn(
        `[Playlist Search] Playlist has ${items.length} items, limiting to ${config.maxPlaylistItems}`
      );
    }

    // Don't clear cache - keep existing cached items to avoid reprocessing
    // Only remove items that are no longer in the DOM
    const currentVideoIds = new Set();

    const itemsArray = Array.from(items).slice(0, config.maxPlaylistItems);

    state.originalItems = itemsArray.map((item, index) => {
      const videoId = item.getAttribute('video-id') || `item-${index}`;
      currentVideoIds.add(videoId);

      // Check if this item is already cached and element is still the same
      if (state.itemsCache.has(videoId)) {
        const cached = state.itemsCache.get(videoId);
        if (cached.element === item) {
          return cached;
        }
      }

      // Optimize: use textContent directly without extra trim/toLowerCase calls
      const titleEl = item.querySelector('#video-title') || item.querySelector('a#video-title');
      const bylineEl =
        item.querySelector('#byline') ||
        item.querySelector('#channel-name') ||
        item.querySelector('ytd-channel-name a');

      const title = titleEl?.textContent || '';
      const channel = bylineEl?.textContent || '';

      const itemData = {
        element: item,
        videoId,
        // Store original text and lowercased version separately for better performance
        titleOriginal: title,
        channelOriginal: channel,
        title: title.trim().toLowerCase(),
        channel: channel.trim().toLowerCase(),
      };

      // Cache the item data
      state.itemsCache.set(videoId, itemData);

      return itemData;
    });

    // Clean up cache - remove items no longer in DOM
    for (const [videoId] of state.itemsCache) {
      if (!currentVideoIds.has(videoId)) {
        state.itemsCache.delete(videoId);
      }
    }
  };

  /**
   * Filter playlist items based on search query with validation
   * @param {string} query - Search query
   */
  const filterPlaylistItems = query => {
    // Cancel any pending RAF
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
    }

    // Validate and sanitize query
    if (query && typeof query !== 'string') {
      console.warn('[Playlist Search] Invalid query type');
      return;
    }

    // Limit query length to prevent performance issues
    if (query && query.length > config.maxQueryLength) {
      query = query.substring(0, config.maxQueryLength);
    }

    if (!query || query.trim() === '') {
      // Show all items using RAF for smooth update
      state.rafId = requestAnimationFrame(() => {
        state.originalItems.forEach(item => {
          item.element.style.display = '';
        });
        state.rafId = null;
      });
      return;
    }

    const searchTerm = query.toLowerCase().trim();
    let visibleCount = 0;

    // Batch DOM updates using RAF
    state.rafId = requestAnimationFrame(() => {
      // Use document fragment approach - collect changes first
      const updates = [];

      state.originalItems.forEach(item => {
        const matches = item.title.includes(searchTerm) || item.channel.includes(searchTerm);

        if (matches) {
          if (item.element.style.display === 'none') {
            updates.push({ element: item.element, display: '' });
          }
          visibleCount++;
        } else {
          if (item.element.style.display !== 'none') {
            updates.push({ element: item.element, display: 'none' });
          }
        }
      });

      // Apply all updates in one batch to minimize reflows
      updates.forEach(update => {
        update.element.style.display = update.display;
      });

      // Update results count indicator if needed
      updateResultsCount(visibleCount, state.originalItems.length);

      state.rafId = null;
    });
  };

  // Update results count (optional visual feedback)
  const updateResultsCount = (visible, total) => {
    // Could add a results counter here if desired
    window.YouTubeUtils &&
      YouTubeUtils.logger &&
      YouTubeUtils.logger.debug &&
      YouTubeUtils.logger.debug(`[Playlist Search] Showing ${visible} of ${total} videos`);
  };

  // ── Video Deletion Feature (similar to comment.js pattern) ──

  /**
   * Log error with error boundary integration
   * @param {string} context - Error context
   * @param {Error|string|unknown} error - Error object or message
   */
  const logError = (context, error) => {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    if (window.YouTubeErrorBoundary) {
      window.YouTubeErrorBoundary.logError(errorObj, { context });
    } else {
      console.error(`[YouTube+][PlaylistSearch] ${context}:`, error);
    }
  };

  /**
   * Wraps function with error boundary protection
   * @template {Function} T
   * @param {T} fn - Function to wrap
   * @param {string} context - Error context for debugging
   * @returns {T} Wrapped function
   */
  // Use shared withErrorBoundary from YouTubeErrorBoundary
  const withErrorBoundary = (fn, context) => {
    if (window.YouTubeErrorBoundary?.withErrorBoundary) {
      return /** @type {any} */ (
        window.YouTubeErrorBoundary.withErrorBoundary(fn, 'PlaylistSearch')
      );
    }
    return /** @type {any} */ (
      (...args) => {
        try {
          return fn(...args);
        } catch (e) {
          logError(context, e);
          return null;
        }
      }
    );
  };

  /**
   * Toggle delete mode — shows/hides checkboxes on playlist items
   */
  const toggleDeleteMode = withErrorBoundary(() => {
    state.deleteMode = !state.deleteMode;
    state.selectedItems.clear();

    const container = state.playlistPanel || getPlaylistContext()?.panel;
    if (!container) return;

    const toggleBtn = container.querySelector('.ytplus-playlist-delete-toggle');
    const deleteBar = container.querySelector('.ytplus-playlist-delete-bar');

    if (state.deleteMode) {
      if (toggleBtn) {
        toggleBtn.classList.add('active');
        toggleBtn.setAttribute('aria-pressed', 'true');
        toggleBtn.title = t('playlistDeleteModeExit');
      }
      if (deleteBar) deleteBar.style.display = '';
      addCheckboxesToItems();
    } else {
      if (toggleBtn) {
        toggleBtn.classList.remove('active');
        toggleBtn.setAttribute('aria-pressed', 'false');
        toggleBtn.title = t('playlistDeleteMode');
      }
      if (deleteBar) deleteBar.style.display = 'none';
      removeCheckboxesFromItems();
    }
    updateDeleteBarState();
  }, 'toggleDeleteMode');

  /**
   * Add selection checkboxes to each playlist video item
   */
  const addCheckboxesToItems = withErrorBoundary(() => {
    const itemsRoot = state.itemsContainer || state.playlistPanel;
    if (!itemsRoot || !state.itemSelector) return;

    const items = itemsRoot.querySelectorAll(state.itemSelector);
    items.forEach((item, idx) => {
      if (item.querySelector('.ytplus-playlist-item-checkbox')) return;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      // Use shared settings checkbox styling for consistent look
      checkbox.className = 'ytplus-playlist-item-checkbox ytp-plus-settings-checkbox';
      checkbox.setAttribute('aria-label', t('playlistSelectVideo'));
      checkbox.dataset.index = String(idx);
      checkbox.style.cssText = `
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 2;
        cursor: pointer;
      `;

      checkbox.addEventListener('change', () => {
        const videoId = item.getAttribute('video-id') || `item-${idx}`;
        if (checkbox.checked) {
          state.selectedItems.add(videoId);
        } else {
          state.selectedItems.delete(videoId);
        }
        updateDeleteBarState();
      });
      checkbox.addEventListener('click', e => e.stopPropagation());

      // Ensure the parent has relative positioning for the checkbox
      item.style.position = 'relative';
      item.insertBefore(checkbox, item.firstChild);
    });
  }, 'addCheckboxesToItems');

  /**
   * Remove all checkboxes from playlist items
   */
  const removeCheckboxesFromItems = withErrorBoundary(() => {
    const itemsRoot = state.itemsContainer || state.playlistPanel;
    if (!itemsRoot) return;
    itemsRoot.querySelectorAll('.ytplus-playlist-item-checkbox').forEach(cb => cb.remove());
    state.selectedItems.clear();
  }, 'removeCheckboxesFromItems');

  /**
   * Update delete action bar button state
   */
  const updateDeleteBarState = withErrorBoundary(() => {
    const container = state.playlistPanel || getPlaylistContext()?.panel;
    if (!container) return;

    const deleteBtn = container.querySelector('.ytplus-playlist-delete-selected');
    const countSpan = container.querySelector('.ytplus-playlist-selected-count');

    if (deleteBtn) {
      deleteBtn.disabled = state.selectedItems.size === 0;
      deleteBtn.style.opacity = state.selectedItems.size > 0 ? '1' : '0.5';
    }
    if (countSpan) {
      countSpan.textContent = t('playlistSelectedCount', { count: state.selectedItems.size });
    }
  }, 'updateDeleteBarState');

  /**
   * Select all visible playlist items
   */
  const selectAllItems = withErrorBoundary(() => {
    const itemsRoot = state.itemsContainer || state.playlistPanel;
    if (!itemsRoot) return;

    itemsRoot.querySelectorAll('.ytplus-playlist-item-checkbox').forEach(cb => {
      const item = cb.closest(state.itemSelector);
      if (item && item.style.display !== 'none') {
        cb.checked = true;
        const videoId = item.getAttribute('video-id') || `item-${cb.dataset.index}`;
        state.selectedItems.add(videoId);
      }
    });
    updateDeleteBarState();
  }, 'selectAllItems');

  /**
   * Clear all checkbox selections
   */
  const clearAllItems = withErrorBoundary(() => {
    const itemsRoot = state.itemsContainer || state.playlistPanel;
    if (!itemsRoot) return;

    itemsRoot.querySelectorAll('.ytplus-playlist-item-checkbox').forEach(cb => {
      cb.checked = false;
    });
    state.selectedItems.clear();
    updateDeleteBarState();
  }, 'clearAllItems');

  /**
   * Find and click the native "Remove from playlist" menu option for a given item.
   * YouTube provides a three-dot menu on each playlist item. We simulate a click on
   * the menu button, wait for the popup, then click the remove option.
   * @param {Element} item - playlist video renderer element
   * @returns {Promise<boolean>} Whether the item was successfully removed
   */
  const removeItemViaMenu = item => {
    return new Promise(resolve => {
      try {
        // Find the three-dot menu button (⋮)
        const menuBtn =
          item.querySelector('button#button[aria-label]') ||
          item.querySelector('yt-icon-button#button') ||
          item.querySelector('ytd-menu-renderer button') ||
          item.querySelector('[aria-haspopup="menu"]') ||
          item.querySelector('button.yt-icon-button');

        if (!menuBtn) {
          console.warn('[Playlist Search] Could not find menu button for item');
          resolve(false);
          return;
        }

        // Click the menu button to open popup
        menuBtn.click();

        // Wait for the popup menu to appear
        setTimeout(() => {
          try {
            // Look for the "Remove from playlist" option in the popup
            const menuItems = document.querySelectorAll(
              'tp-yt-paper-listbox ytd-menu-service-item-renderer, ' +
                'ytd-menu-popup-renderer ytd-menu-service-item-renderer, ' +
                'tp-yt-iron-dropdown ytd-menu-service-item-renderer'
            );

            let removeOption = null;
            for (const mi of menuItems) {
              const text = (mi.textContent || '').toLowerCase();
              // Match various translations of "Remove from playlist"
              if (
                text.includes('remove') ||
                text.includes('удалить') ||
                text.includes('supprimer') ||
                text.includes('entfernen') ||
                text.includes('eliminar') ||
                text.includes('rimuovi') ||
                text.includes('kaldır') ||
                text.includes('削除') ||
                text.includes('삭제') ||
                text.includes('移除') ||
                text.includes('oʻchirish') ||
                text.includes('жою') ||
                text.includes('өчүрүү') ||
                text.includes('выдаліць') ||
                text.includes('премахване') ||
                text.includes('xóa')
              ) {
                removeOption = mi;
                break;
              }
            }

            if (removeOption) {
              removeOption.click();
              // Close any remaining popup
              setTimeout(() => {
                document.body.click();
                resolve(true);
              }, 100);
            } else {
              // Close the menu if we can't find the option
              document.body.click();
              console.warn('[Playlist Search] Could not find "Remove" option in menu');
              resolve(false);
            }
          } catch (err) {
            document.body.click();
            logError('removeItemViaMenu:findOption', err);
            resolve(false);
          }
        }, 350);
      } catch (err) {
        logError('removeItemViaMenu', err);
        resolve(false);
      }
    });
  };

  /**
   * Delete selected videos from the playlist sequentially
   */
  const deleteSelectedItems = withErrorBoundary(async () => {
    if (state.isDeleting || state.selectedItems.size === 0) return;

    const count = state.selectedItems.size;
    const confirmed = confirm(t('playlistDeleteConfirm', { count }));
    if (!confirmed) return;

    state.isDeleting = true;
    const itemsRoot = state.itemsContainer || state.playlistPanel;
    if (!itemsRoot || !state.itemSelector) {
      state.isDeleting = false;
      return;
    }

    const allItems = Array.from(itemsRoot.querySelectorAll(state.itemSelector));
    const toDelete = allItems.filter((item, idx) => {
      const videoId = item.getAttribute('video-id') || `item-${idx}`;
      return state.selectedItems.has(videoId);
    });

    let successCount = 0;
    let failCount = 0;

    for (const item of toDelete) {
      const result = await removeItemViaMenu(item);
      if (result) {
        successCount++;
      } else {
        failCount++;
      }
      // Delay between actions to let YouTube process
      await new Promise(r => setTimeout(r, config.deleteDelay));
    }

    state.isDeleting = false;
    state.selectedItems.clear();

    // Re-collect items after deletion
    setTimeout(() => {
      collectOriginalItems();
      if (state.deleteMode) {
        addCheckboxesToItems();
      }
      updateDeleteBarState();
    }, 500);

    // Notify user
    const msg =
      failCount > 0
        ? t('playlistDeletePartial', { success: successCount, fail: failCount })
        : t('playlistDeleteSuccess', { count: successCount });
    window.YouTubeUtils?.logger?.debug?.(`[Playlist Search] ${msg}`);
  }, 'deleteSelectedItems');

  /**
   * Add delete mode toggle button and action bar to the search UI
   * @param {HTMLElement} searchContainer - The .ytplus-playlist-search container
   */
  const addDeleteUI = searchContainer => {
    if (!searchContainer || searchContainer.querySelector('.ytplus-playlist-delete-toggle')) return;

    // Add styles for delete UI (once)
    addDeleteStyles();

    // Toggle button (trash icon) next to the search input
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'ytplus-playlist-delete-toggle';
    toggleBtn.setAttribute('aria-pressed', 'false');
    toggleBtn.title = t('playlistDeleteMode');
    toggleBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        <line x1="10" y1="11" x2="10" y2="17"/>
        <line x1="14" y1="11" x2="14" y2="17"/>
      </svg>
    `;
    toggleBtn.style.cssText = `
      background: transparent;
      border: 1px solid var(--yt-spec-10-percent-layer);
      border-radius: 50%;
      width: 36px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--yt-spec-text-secondary);
      transition: all 0.2s;
      vertical-align: middle;
      margin-left: 6px;
      flex-shrink: 0;
    `;
    toggleBtn.addEventListener('click', toggleDeleteMode);

    // Wrap search input and toggle in a flex container
    const inputWrapper = document.createElement('div');
    inputWrapper.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const searchInput = searchContainer.querySelector('.ytplus-playlist-search-input');
    if (searchInput) {
      searchInput.style.width = ''; // Reset fixed width
      searchInput.style.flex = '1';
      searchInput.parentNode.insertBefore(inputWrapper, searchInput);
      inputWrapper.appendChild(searchInput);
      inputWrapper.appendChild(toggleBtn);
    }

    // Action bar (hidden initially)
    const deleteBar = document.createElement('div');
    deleteBar.className = 'ytplus-playlist-delete-bar';
    deleteBar.style.cssText = `
      display: none;
      padding: 6px 0 0;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    `;
    deleteBar.style.display = 'none';

    const countSpan = document.createElement('span');
    countSpan.className = 'ytplus-playlist-selected-count';
    countSpan.style.cssText = `
      font-size: 12px;
      color: var(--yt-spec-text-secondary);
      margin-right: auto;
    `;
    countSpan.textContent = t('playlistSelectedCount', { count: 0 });

    const createBtn = (label, cls, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.className = cls;
      btn.style.cssText = `
        padding: 5px 12px;
        border-radius: 16px;
        border: 1px solid var(--yt-spec-10-percent-layer);
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        background: var(--yt-spec-badge-chip-background);
        color: var(--yt-spec-text-primary);
        transition: all 0.2s;
      `;
      btn.addEventListener('click', onClick);
      return btn;
    };

    const selectAllBtn = createBtn(t('selectAll'), 'ytplus-playlist-select-all', selectAllItems);
    const clearAllBtn = createBtn(t('clearAll'), 'ytplus-playlist-clear-all', clearAllItems);
    const deleteBtn = createBtn(
      t('deleteSelected'),
      'ytplus-playlist-delete-selected',
      deleteSelectedItems
    );
    deleteBtn.disabled = true;
    deleteBtn.style.opacity = '0.5';
    deleteBtn.style.background = 'rgba(255,99,71,.12)';
    deleteBtn.style.borderColor = 'rgba(255,99,71,.25)';
    deleteBtn.style.color = '#ff5c5c';

    deleteBar.append(countSpan, selectAllBtn, clearAllBtn, deleteBtn);
    searchContainer.appendChild(deleteBar);
  };

  /**
   * Add CSS styles for the delete UI components
   */
  const addDeleteStyles = () => {
    if (document.getElementById('ytplus-playlist-delete-styles')) return;
    const css = `
      .ytplus-playlist-delete-toggle.active {
        color: #ff5c5c !important;
        border-color: rgba(255,99,71,.4) !important;
        background: rgba(255,99,71,.1) !important;
      }
      .ytplus-playlist-delete-toggle:hover {
        color: var(--yt-spec-text-primary);
        border-color: var(--yt-spec-text-secondary);
      }
      .ytplus-playlist-delete-bar {
        display: flex;
      }
      .ytplus-playlist-delete-selected:not(:disabled):hover {
        background: rgba(255,99,71,.22) !important;
      }
      .ytplus-playlist-select-all:hover,
      .ytplus-playlist-clear-all:hover {
        background: var(--yt-spec-10-percent-layer) !important;
      }
      .ytplus-playlist-item-checkbox {
        opacity: 0.85;
        transition: opacity 0.15s;
      }
      .ytplus-playlist-item-checkbox:hover {
        opacity: 1;
      }
      /* Use the shared settings checkbox styling for playlist item checkboxes */
      .ytplus-playlist-item-checkbox.ytp-plus-settings-checkbox{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:20px;height:20px;min-width:20px;min-height:20px;margin-left:auto;border:2px solid var(--yt-glass-border);border-radius:50%;background:transparent;display:inline-flex;align-items:center;justify-content:center;transition:all 250ms cubic-bezier(.4,0,.23,1);cursor:pointer;position:relative;flex-shrink:0;color:#fff;box-sizing:border-box;}
      html:not([dark]) .ytplus-playlist-item-checkbox.ytp-plus-settings-checkbox{border-color:rgba(0,0,0,.25);color:#222;}
      .ytplus-playlist-item-checkbox.ytp-plus-settings-checkbox:focus-visible{outline:2px solid var(--yt-accent);outline-offset:2px;}
      .ytplus-playlist-item-checkbox.ytp-plus-settings-checkbox:hover{background:var(--yt-hover-bg);transform:scale(1.1);}
      .ytplus-playlist-item-checkbox.ytp-plus-settings-checkbox::before{content:"";width:5px;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(45deg);top:6px;left:3px;transition:width 100ms ease 50ms,opacity 50ms;transform-origin:0% 0%;opacity:0;}
      .ytplus-playlist-item-checkbox.ytp-plus-settings-checkbox::after{content:"";width:0;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(305deg);top:11px;left:7px;transition:width 100ms ease,opacity 50ms;transform-origin:0% 0%;opacity:0;}
      .ytplus-playlist-item-checkbox.ytp-plus-settings-checkbox:checked{transform:rotate(0deg) scale(1.15);}
      .ytplus-playlist-item-checkbox.ytp-plus-settings-checkbox:checked::before{width:9px;opacity:1;background:#fff;transition:width 150ms ease 100ms,opacity 150ms ease 100ms;}
      .ytplus-playlist-item-checkbox.ytp-plus-settings-checkbox:checked::after{width:16px;opacity:1;background:#fff;transition:width 150ms ease 250ms,opacity 150ms ease 250ms;}
    `;
    try {
      if (window.YouTubeUtils?.StyleManager) {
        window.YouTubeUtils.StyleManager.add('ytplus-playlist-delete-styles', css);
        return;
      }
    } catch {}
    const style = document.createElement('style');
    style.id = 'ytplus-playlist-delete-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  };

  // Clean up search UI
  const cleanup = () => {
    // Exit delete mode if active
    if (state.deleteMode) {
      removeCheckboxesFromItems();
      state.deleteMode = false;
    }
    state.isDeleting = false;
    state.selectedItems.clear();

    const searchUI = qs('.ytplus-playlist-search');
    if (searchUI) {
      searchUI.remove();
    }

    // Disconnect mutation observer
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }

    // Cancel any pending RAF
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }

    // Clear cache
    state.itemsCache.clear();

    state.searchInput = null;
    state.originalItems = [];
    state.currentPlaylistId = null;
    state.itemsContainer = null;
    state.itemSelector = null;
    state.itemTagName = null;
    state.playlistPanel = null;
    state.isPlaylistPage = false;
  };

  // Handle navigation changes with debouncing
  const handleNavigation = debounce(() => {
    if (!featureEnabled) {
      cleanup();
      return;
    }
    if (!shouldRunOnThisPage()) {
      cleanup();
      return;
    }
    // Check if we're still on a playlist page
    const newPlaylistId = getCurrentPlaylistId();

    // If playlist hasn't changed and UI exists, no action needed
    if (newPlaylistId === state.currentPlaylistId && qs('.ytplus-playlist-search')) {
      return;
    }

    cleanup();

    // Only add UI if we're on a playlist page
    if (newPlaylistId) {
      setTimeout(addSearchUI, 300);
    }
  }, 250);

  let initialized = false;

  const ensureInit = () => {
    if (initialized || !featureEnabled || !isRelevantRoute()) return;
    initialized = true;

    const run = () => {
      loadSettings();
      if (!featureEnabled || config.enabled === false) return;
      addSearchUI();
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 0);
    }
  };

  const handleNavigate = () => {
    if (!isRelevantRoute()) {
      cleanup();
      return;
    }
    ensureInit();
    handleNavigation();
  };

  onDomReady(ensureInit);

  if (window.YouTubeUtils?.cleanupManager?.registerListener) {
    YouTubeUtils.cleanupManager.registerListener(document, 'yt-navigate-finish', handleNavigate, {
      passive: true,
    });
    YouTubeUtils.cleanupManager.registerListener(window, 'beforeunload', cleanup, {
      passive: true,
    });
  } else {
    document.addEventListener('yt-navigate-finish', handleNavigate);
    window.addEventListener('beforeunload', cleanup);
  }

  window.addEventListener('youtube-plus-settings-updated', e => {
    try {
      const nextEnabled = e?.detail?.enablePlaylistSearch !== false;
      if (nextEnabled === featureEnabled) return;
      setFeatureEnabled(nextEnabled);
    } catch {
      setFeatureEnabled(loadFeatureEnabled());
    }
  });
})();
