// Playlist Search
(function () {
  'use strict';

  // Prevent multiple initializations
  if (window._playlistSearchInitialized) return;
  window._playlistSearchInitialized = true;

  /**
   * Translation helper - uses centralized i18n system
   * @param {string} key - Translation key
   * @param {Object} params - Interpolation parameters
   * @returns {string} Translated string
   */
  const t = (key, params = {}) => {
    try {
      if (typeof window !== 'undefined') {
        if (window.YouTubePlusI18n && typeof window.YouTubePlusI18n.t === 'function') {
          return window.YouTubePlusI18n.t(key, params);
        }
        if (window.YouTubeUtils && typeof window.YouTubeUtils.t === 'function') {
          return window.YouTubeUtils.t(key, params);
        }
      }
    } catch {
      // Fallback to key if central i18n unavailable
    }
    return key;
  };

  // Utility functions for performance optimization
  const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  const throttle = (func, limit) => {
    let inThrottle;
    return function executedFunction(...args) {
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
  };

  const state = {
    searchInput: null,
    searchResults: null,
    originalItems: [],
    currentPlaylistId: null,
    mutationObserver: null,
    rafId: null,
    itemsCache: new Map(), // Cache for faster lookups
  };

  // Load settings from localStorage
  const loadSettings = () => {
    try {
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
      const sel = ['.title', 'h3 a', '#header-title', '#title', '.playlist-title', 'h1.title'];
      for (const s of sel) {
        const el = playlistPanel.querySelector(s) || document.querySelector(s);
        if (el && el.textContent && el.textContent.trim()) {
          // Sanitize and limit length
          const title = el.textContent.trim();
          return title.length > 100 ? title.substring(0, 100) + '...' : title;
        }
      }

      // Fallback to meta or channel-specific metadata
      const meta =
        document.querySelector('meta[name="title"]') ||
        document.querySelector('meta[property="og:title"]');
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

  // Add search UI to playlist panel
  const addSearchUI = () => {
    if (!config.enabled) return;

    const playlistId = getCurrentPlaylistId();
    if (!playlistId) return;

    // Find playlist panel (works both on /watch and on playlist pages)
    const playlistPanel = document.querySelector('ytd-playlist-panel-renderer');
    if (!playlistPanel) {
      // Use MutationObserver instead of setTimeout for better performance
      const observer = new MutationObserver((_mutations, obs) => {
        const panel = document.querySelector('ytd-playlist-panel-renderer');
        if (panel) {
          obs.disconnect();
          addSearchUI();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Timeout fallback to prevent infinite observation
      setTimeout(() => observer.disconnect(), 5000);
      return;
    }

    // Don't add search UI twice
    if (playlistPanel.querySelector('.ytplus-playlist-search')) return;

    state.currentPlaylistId = playlistId;

    // Create search container
    const searchContainer = document.createElement('div');
    searchContainer.className = 'ytplus-playlist-search';
    searchContainer.style.cssText = `
      padding: 8px 16px;
      background: transparent;
      border-bottom: 1px solid var(--yt-spec-10-percent-layer);
      position: sticky;
      top: 0;
      z-index: 1;
    `;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    const playlistName = getPlaylistDisplayName(playlistPanel, playlistId);
    searchInput.placeholder = t('searchPlaceholder').replace('{playlist}', playlistName);
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

    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = 'var(--yt-spec-call-to-action)';
    });

    searchInput.addEventListener('blur', () => {
      searchInput.style.borderColor = 'var(--yt-spec-10-percent-layer)';
    });

    // Use debounced filtering for better performance
    const debouncedFilter = debounce(value => {
      // Validate input length to prevent performance issues
      if (value.length > config.maxQueryLength) {
        searchInput.value = value.substring(0, config.maxQueryLength);
        return;
      }
      filterPlaylistItems(value);
    }, config.searchDebounceMs);

    searchInput.addEventListener(
      'input',
      e => {
        const target = /** @type {HTMLInputElement} */ (e.target);
        debouncedFilter(target.value);
      },
      { passive: true }
    );

    searchContainer.appendChild(searchInput);
    state.searchInput = searchInput;

    // Try to insert the search UI into the playlist items container so it appears
    // inline with the list of videos. Prefer inserting before the first
    // ytd-playlist-panel-video-renderer if present.
    // Use more specific selector first for better performance
    /** @type {Element|null} */
    const rawItemsContainer =
      playlistPanel.querySelector('#items') ||
      playlistPanel.querySelector('.playlist-items.style-scope.ytd-playlist-panel-renderer') ||
      playlistPanel.querySelector('.playlist-items');

    if (rawItemsContainer) {
      /** @type {HTMLElement} */
      const itemsContainer = /** @type {HTMLElement} */ (
        /** @type {unknown} */ (rawItemsContainer)
      );
      /** @type {Element|null} */
      const firstVideo = itemsContainer.querySelector('ytd-playlist-panel-video-renderer');
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

    // Setup MutationObserver to watch for new playlist items
    setupPlaylistObserver();
  };

  // Setup MutationObserver for dynamic playlist updates
  const setupPlaylistObserver = () => {
    // Disconnect existing observer if any
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
    }

    const playlistPanel = document.querySelector('ytd-playlist-panel-renderer');
    if (!playlistPanel) return;

    let lastUpdateCount = state.originalItems.length;
    let updateScheduled = false;

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
            if (element.tagName === 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER') return true;
          }
        }
        for (let i = 0; i < mutation.removedNodes.length; i++) {
          const node = mutation.removedNodes[i];
          if (node.nodeType === 1) {
            const element = /** @type {Element} */ (node);
            if (element.tagName === 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER') return true;
          }
        }
        return false;
      });

      if (!hasRelevantChange) return;

      updateScheduled = true;
      requestAnimationFrame(() => {
        const currentCount = lastUpdateCount;
        const newItems = document.querySelectorAll(
          'ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer'
        );

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
    const itemsContainer = playlistPanel.querySelector('#items, .playlist-items');
    const targetElement = itemsContainer || playlistPanel;

    state.mutationObserver.observe(targetElement, {
      childList: true,
      subtree: itemsContainer ? false : true, // Only observe subtree if we couldn't find items container
    });
  };

  /**
   * Collect all playlist items for filtering with limit and improved caching
   */
  const collectOriginalItems = () => {
    const items = document.querySelectorAll(
      'ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer'
    );

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
      const titleEl = item.querySelector('#video-title');
      const bylineEl = item.querySelector('#byline');

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

  // Clean up search UI
  const cleanup = () => {
    const searchUI = document.querySelector('.ytplus-playlist-search');
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
  };

  // Handle navigation changes with debouncing
  const handleNavigation = debounce(() => {
    // Check if we're still on a playlist page
    const newPlaylistId = getCurrentPlaylistId();

    // If playlist hasn't changed and UI exists, no action needed
    if (
      newPlaylistId === state.currentPlaylistId &&
      document.querySelector('.ytplus-playlist-search')
    ) {
      return;
    }

    cleanup();

    // Only add UI if we're on a playlist page
    if (newPlaylistId) {
      setTimeout(addSearchUI, 300);
    }
  }, 250);

  // Initialize
  const init = () => {
    loadSettings();

    // Try to add search UI
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addSearchUI, { once: true });
    } else {
      addSearchUI();
    }

    // Listen for YouTube navigation events
    document.addEventListener('yt-navigate-finish', handleNavigation);

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanup);
  };

  // Start
  init();
})();
