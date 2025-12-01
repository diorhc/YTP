// Playlist Search
(function () {
  'use strict';

  // Prevent multiple initializations
  if (window._playlistSearchInitialized) return;
  window._playlistSearchInitialized = true;

  // Use centralized i18n for playlist placeholder
  const _globalI18n_playlist =
    typeof window !== 'undefined' && window.YouTubePlusI18n ? window.YouTubePlusI18n : null;
  const t = (key, params = {}) => {
    try {
      if (_globalI18n_playlist && typeof _globalI18n_playlist.t === 'function') {
        return _globalI18n_playlist.t(key, params);
      }
      if (
        typeof window !== 'undefined' &&
        window.YouTubeUtils &&
        typeof window.YouTubeUtils.t === 'function'
      ) {
        return window.YouTubeUtils.t(key, params);
      }
    } catch {
      // fallback
    }
    if (!key || typeof key !== 'string') return '';
    if (Object.keys(params).length === 0) return key;
    let result = key;
    for (const [k, v] of Object.entries(params)) result = result.split(`{${k}}`).join(String(v));
    return result;
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
        setTimeout(() => {
          inThrottle = false;
        }, limit);
      }
    };
  };

  // Previously limited to specific lists (LL/WL). Now support any playlist id.

  const config = {
    enabled: true,
    storageKey: 'youtube_playlist_search_settings',
    searchDebounceMs: 200, // Debounce search input
    observerThrottleMs: 500, // Throttle mutation observer
    maxPlaylistItems: 5000, // Maximum items to process
    maxQueryLength: 200, // Maximum search query length
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

  // Common selectors cached to avoid repeated string allocations and query lookups
  const ITEM_TITLE_SELECTOR = '#video-title';
  const ITEM_BYLINE_SELECTOR = '#byline';

  // Load settings from localStorage
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(config.storageKey);
      if (saved) Object.assign(config, JSON.parse(saved));
    } catch (error) {
      console.warn('[YouTube+][Playlist Search]', 'Failed to load settings:', error);
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
      console.warn('[YouTube+][Playlist Search]', 'Failed to get playlist ID:', error);
      return null;
    }
  };

  /**
   * Sanitize and limit title length
   * @param {string} title - Title to sanitize
   * @param {number} maxLength - Maximum length
   * @returns {string} Sanitized title
   */
  const sanitizeTitle = (title, maxLength = 100) => {
    const trimmed = title.trim();
    return trimmed.length > maxLength ? `${trimmed.substring(0, maxLength)}...` : trimmed;
  };

  /**
   * Find title element by selectors
   * @param {Element|HTMLElement} playlistPanel - Playlist panel element
   * @param {string[]} selectors - Array of CSS selectors
   * @returns {string|null} Found title or null
   */
  const findTitleBySelectors = (playlistPanel, selectors) => {
    for (const selector of selectors) {
      const el = playlistPanel?.querySelector(selector) || document.querySelector(selector);
      if (el && el.textContent && el.textContent.trim()) {
        return sanitizeTitle(el.textContent);
      }
    }
    return null;
  };

  /**
   * Get title from meta tags
   * @returns {string|null} Meta title or null
   */
  const getTitleFromMeta = () => {
    const meta =
      document.querySelector('meta[name="title"]') ||
      document.querySelector('meta[property="og:title"]');
    return meta && meta.content ? sanitizeTitle(meta.content) : null;
  };

  /**
   * Try to obtain a display name for the current playlist from DOM
   * @param {Element|HTMLElement} playlistPanel - Playlist panel element
   * @param {string} listId - Playlist ID
   * @returns {string} Playlist display name
   */
  const getPlaylistDisplayName = (playlistPanel, listId) => {
    try {
      const titleSelectors = [
        '.title',
        'h3 a',
        '#header-title',
        '#title',
        '.playlist-title',
        'h1.title',
      ];

      // Try finding title by selectors
      const titleFromSelectors = findTitleBySelectors(playlistPanel, titleSelectors);
      if (titleFromSelectors) return titleFromSelectors;

      // Fallback to meta tags
      const titleFromMeta = getTitleFromMeta();
      if (titleFromMeta) return titleFromMeta;
    } catch (error) {
      console.warn('[YouTube+][Playlist Search]', 'Failed to get display name:', error);
    }

    // Default to sanitized id if nothing else
    return listId && typeof listId === 'string' ? listId.substring(0, 50) : 'playlist';
  };

  /**
   * Setup observer to wait for playlist panel
   * @param {MutationObserver} observer - Observer instance
   */
  const setupPanelObserver = observer => {
    try {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      } else {
        document.addEventListener(
          'DOMContentLoaded',
          () => {
            try {
              observer.observe(document.body, { childList: true, subtree: true });
            } catch (observeError) {
              console.error(
                '[YouTube+][PlaylistSearch] observer.observe failed after DOMContentLoaded:',
                observeError
              );
            }
          },
          { once: true }
        );
      }
    } catch (observeError) {
      console.error('[YouTube+][PlaylistSearch] observer.observe failed:', observeError);
    }
  };

  /**
   * Wait for playlist panel to appear in DOM
   * @returns {void}
   */
  const waitForPlaylistPanel = () => {
    const observer = new MutationObserver((_mutations, obs) => {
      const panel = document.querySelector('ytd-playlist-panel-renderer');
      if (panel) {
        try {
          obs.disconnect();
        } catch {}
        addSearchUI();
      }
    });

    setupPanelObserver(observer);

    // Timeout fallback to prevent infinite observation
    setTimeout(() => {
      try {
        observer.disconnect();
      } catch {}
    }, 5000);
  };

  // Add search UI to playlist panel
  const addSearchUI = () => {
    if (!config.enabled) return;

    const playlistId = getCurrentPlaylistId();
    if (!playlistId) return;

    // Find playlist panel (works both on /watch and on playlist pages)
    const playlistPanel = document.querySelector('ytd-playlist-panel-renderer');
    if (!playlistPanel) {
      waitForPlaylistPanel();
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
      filterPlaylistItems(value);
    }, config.searchDebounceMs);

    searchInput.addEventListener('input', e => {
      const { target } = e;
      const inputEl = /** @type {HTMLInputElement} */ (target);
      const { value } = inputEl;
      debouncedFilter(value);
    });

    searchContainer.appendChild(searchInput);
    state.searchInput = searchInput;

    // Try to insert the search UI into the playlist items container so it appears
    // inline with the list of videos. Prefer inserting before the first
    // ytd-playlist-panel-video-renderer if present.
    /** @type {Element|null} */
    const rawItemsContainer =
      playlistPanel.querySelector('.playlist-items.style-scope.ytd-playlist-panel-renderer') ||
      playlistPanel.querySelector('.playlist-items') ||
      playlistPanel.querySelector('#items');

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
      // insertBefore with null second arg appends when no firstChild exists
      playlistPanel.insertBefore(searchContainer, playlistPanel.firstChild);
    }

    // Store original items
    collectOriginalItems();

    // Setup MutationObserver to watch for new playlist items
    setupPlaylistObserver();
  };

  // Setup MutationObserver for dynamic playlist updates
  /**
   * Handle mutations to playlist items
   * @returns {void}
   */
  const handlePlaylistMutations = throttle(() => {
    const currentCount = state.originalItems.length;
    const newItems = document.querySelectorAll(
      'ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer'
    );

    // Only recollect if item count changed significantly
    if (Math.abs(newItems.length - currentCount) > 0) {
      collectOriginalItems();

      // Re-apply current search filter if any
      if (state.searchInput && state.searchInput.value) {
        filterPlaylistItems(state.searchInput.value);
      }
    }
  }, config.observerThrottleMs);

  /**
   * Setup fallback body observer
   * @returns {void}
   */
  const setupBodyObserverFallback = () => {
    const bodyObserver = new MutationObserver((_mutations, obs) => {
      const panel = document.querySelector('ytd-playlist-panel-renderer');
      if (panel) {
        try {
          state.mutationObserver.observe(panel, { childList: true, subtree: true });
        } catch (err) {
          console.warn(
            '[YouTube+][Playlist Search] Failed to observe playlist panel after fallback:',
            err
          );
        }
        obs.disconnect();
      }
    });
    try {
      bodyObserver.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => bodyObserver.disconnect(), 5000);
    } catch (err) {
      console.warn(
        '[YouTube+][Playlist Search] Failed to observe document.body for playlist fallback:',
        err
      );
    }
  };

  /**
   * Observe playlist panel or setup fallback
   * @param {Element} playlistPanel - Playlist panel element
   * @returns {void}
   */
  const observePlaylistPanel = playlistPanel => {
    try {
      if (playlistPanel && playlistPanel instanceof Element && playlistPanel.isConnected) {
        state.mutationObserver.observe(playlistPanel, { childList: true, subtree: true });
      } else if (document.body) {
        setupBodyObserverFallback();
      }
    } catch (observeError) {
      console.error(
        '[YouTube+][Playlist Search] Failed to set up playlist observer:',
        observeError
      );
    }
  };

  const setupPlaylistObserver = () => {
    // Disconnect existing observer if any
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
    }

    const playlistPanel = document.querySelector('ytd-playlist-panel-renderer');
    if (!playlistPanel) return;

    state.mutationObserver = new MutationObserver(handlePlaylistMutations);
    observePlaylistPanel(playlistPanel);
  };

  /**
   * Collect all playlist items for filtering with limit
   */
  /**
   * Get playlist items from DOM
   * @returns {NodeList} Playlist items
   */
  const getPlaylistItems = () => {
    return document.querySelectorAll(
      'ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer'
    );
  };

  /**
   * Limit items to max configured amount
   * @param {NodeList|Array} items - Items to limit
   * @returns {Array} Limited items array
   */
  const limitPlaylistItems = items => {
    if (items.length > config.maxPlaylistItems) {
      console.warn(
        `[YouTube+][Playlist Search] Playlist has ${items.length} items, limiting to ${config.maxPlaylistItems}`
      );
    }
    return Array.from(items).slice(0, config.maxPlaylistItems);
  };

  /**
   * Extract item data from DOM element
   * @param {HTMLElement} item - Playlist item element
   * @param {number} index - Item index
   * @returns {Object} Item data
   */
  const extractItemData = (item, index) => {
    const videoId = item.getAttribute('video-id') || `item-${index}`;
    // Use cached selector constants to reduce string churn
    const titleEl = item.querySelector(ITEM_TITLE_SELECTOR);
    const bylineEl = item.querySelector(ITEM_BYLINE_SELECTOR);

    return {
      element: item,
      videoId,
      title: titleEl?.textContent?.trim()?.toLowerCase() || '',
      channel: bylineEl?.textContent?.trim()?.toLowerCase() || '',
    };
  };

  /**
   * Get or create cached item data
   * @param {HTMLElement} item - Playlist item element
   * @param {number} index - Item index
   * @returns {Object} Item data
   */
  const getCachedItemData = (item, index) => {
    const videoId = item.getAttribute('video-id') || `item-${index}`;

    if (state.itemsCache.has(videoId)) {
      return state.itemsCache.get(videoId);
    }

    const itemData = extractItemData(item, index);
    state.itemsCache.set(videoId, itemData);
    return itemData;
  };

  /**
   * Collect original playlist items and cache them
   */
  const collectOriginalItems = () => {
    const items = getPlaylistItems();
    state.itemsCache.clear();
    const itemsArray = limitPlaylistItems(items);
    state.originalItems = itemsArray.map((item, index) => getCachedItemData(item, index));
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
      console.warn('[YouTube+][Playlist Search]', 'Invalid query type');
      return;
    }

    // Limit query length to prevent performance issues
    let processedQuery = query;
    if (processedQuery && processedQuery.length > config.maxQueryLength) {
      processedQuery = processedQuery.substring(0, config.maxQueryLength);
    }

    if (!processedQuery || processedQuery.trim() === '') {
      // Show all items using RAF for smooth update
      state.rafId = requestAnimationFrame(() => {
        state.originalItems.forEach(item => {
          item.element.style.display = '';
        });
        state.rafId = null;
      });
      return;
    }

    const searchTerm = processedQuery.toLowerCase().trim();
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
        } else if (item.element.style.display !== 'none') {
          updates.push({ element: item.element, display: 'none' });
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
    console.log('[YouTube+][Playlist Search]', `Showing ${visible} of ${total} videos`);
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

  // Handle navigation changes
  const handleNavigation = () => {
    cleanup();
    setTimeout(addSearchUI, 300);
  };

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

  // Export module to global scope for module loader
  if (typeof window !== 'undefined') {
    window.YouTubePlaylistSearch = {
      init,
      cleanup,
      version: '2.2',
    };
  }

  // Start
  init();
})();
