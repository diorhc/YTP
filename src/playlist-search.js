// Playlist Search
(function () {
  'use strict';

  // Prevent multiple initializations
  if (window._playlistSearchInitialized) return;
  window._playlistSearchInitialized = true;

  // Localization
  const i18n = {
    en: {
      searchPlaceholder: 'Search in {playlist}...',
    },
    ru: {
      searchPlaceholder: 'Поиск в плейлисте "{playlist}"...',
    },
  };

  // Detect language
  const getLanguage = () => {
    const htmlLang = document.documentElement.lang || 'en';
    if (htmlLang.startsWith('ru')) return 'ru';
    return 'en';
  };

  const lang = getLanguage();
  const t = key => i18n[lang][key] || i18n.en[key] || key;

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
    searchDebounceMs: 200, // Debounce search input
    observerThrottleMs: 500, // Throttle mutation observer
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
      if (saved) Object.assign(config, JSON.parse(saved));
    } catch (error) {
      console.warn('[Playlist Search] Failed to load settings:', error);
    }
  };

  // (saveSettings removed - settings are static for this module)

  // Get current playlist id (if present)
  const getCurrentPlaylistId = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('list');
  };

  // Try to obtain a display name for the current playlist from DOM
  const getPlaylistDisplayName = (playlistPanel, listId) => {
    try {
      // Common places for title: .title, h3 a, #header-title, #title
      const sel = ['.title', 'h3 a', '#header-title', '#title', '.playlist-title', 'h1.title'];
      for (const s of sel) {
        const el = playlistPanel.querySelector(s) || document.querySelector(s);
        if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
      }

      // Fallback to meta or channel-specific metadata
      const meta =
        document.querySelector('meta[name="title"]') ||
        document.querySelector('meta[property="og:title"]');
      if (meta && meta.content) return meta.content;
    } catch {}

    // Default to id if nothing else
    return listId || 'playlist';
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
      filterPlaylistItems(value);
    }, config.searchDebounceMs);

    searchInput.addEventListener('input', e => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      debouncedFilter(target.value);
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

    // Throttled handler for mutations
    const handleMutations = throttle(() => {
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

    state.mutationObserver = new MutationObserver(handleMutations);

    // Observe the playlist container for changes
    state.mutationObserver.observe(playlistPanel, {
      childList: true,
      subtree: true,
    });
  };

  // Collect all playlist items for filtering
  const collectOriginalItems = () => {
    const items = document.querySelectorAll(
      'ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer'
    );

    // Clear cache when collecting new items
    state.itemsCache.clear();

    state.originalItems = Array.from(items).map((item, index) => {
      const videoId = item.getAttribute('video-id') || `item-${index}`;

      // Check if this item is already cached
      if (state.itemsCache.has(videoId)) {
        return state.itemsCache.get(videoId);
      }

      const titleEl = item.querySelector('#video-title');
      const bylineEl = item.querySelector('#byline');

      const itemData = {
        element: item,
        videoId,
        title: titleEl?.textContent?.trim()?.toLowerCase() || '',
        channel: bylineEl?.textContent?.trim()?.toLowerCase() || '',
      };

      // Cache the item data
      state.itemsCache.set(videoId, itemData);

      return itemData;
    });
  };

  // Filter playlist items based on search query
  const filterPlaylistItems = query => {
    // Cancel any pending RAF
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
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
    console.log(`[Playlist Search] Showing ${visible} of ${total} videos`);
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

  // Start
  init();
})();
