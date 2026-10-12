// Playlist Search.
//
// Responsibility: while `enablePlaylistSearch` is on, a search/filter bar
//   and a bulk-delete mode for playlists on /watch and /playlist.
// Public surface: window.YouTubePlusPlaylistSearch.
(function () {
  // The feature runs under the FeatureLifecycle contract (feature-registry.js):
  // `psCtx` exists only while its setting is on. `uiScope` owns one search-bar
  // instance (rebuilt per navigation); `deleteScope` owns one delete-mode
  // checkbox round.
  /** @type {YouTubePlusFeatureContext | null} */
  let psCtx = null;
  /** @type {YouTubePlusFeatureContext | null} */
  let uiScope = null;
  /** @type {YouTubePlusFeatureContext | null} */
  let deleteScope = null;
  /** @type {(() => void) | null} */
  let frameRelease = null;

  // Shared DOM helper from YouTubeUtils
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'PlaylistSearch');

  const { $: qs, t, logger: playlistLogger } = U?.helpers ?? {};

  // This module targets playlist content on both /watch and /playlist pages.
  const shouldRunOnThisPage = () => {
    return U.isYouTubeDomain() && (U.isWatchRoute() || window.location.pathname === '/playlist');
  };

  const isPlaylistPage = () => window.location.pathname === '/playlist';

  const isRelevantRoute = () => {
    if (!shouldRunOnThisPage()) return false;
    const params = new URLSearchParams(window.location.search);
    return params.has('list');
  };

  // Shared debounce/throttle from YouTubeUtils
  const debounce = U.debounce;
  const throttle = U.throttle;

  const config = {
    searchDebounceMs: 150, // Optimized debounce for better responsiveness
    observerThrottleMs: 300, // Reduced throttle for faster updates
    maxPlaylistItems: 10000, // Increased limit for large playlists
    maxQueryLength: 300, // Increased for more flexible search
    deleteDelay: 250, // Delay between sequential delete actions
  };

  /**
   * @typedef {{
   * element: Element,
   * videoId: string,
   * titleOriginal: string,
   * channelOriginal: string,
   * title: string,
   * channel: string
   * }} PlaylistItemData
   */

  /** @type {{
   * searchInput: HTMLInputElement|null,
   * searchResults: HTMLElement|null,
   * originalItems: PlaylistItemData[],
   * currentPlaylistId: string|null,
   * itemsCache: Map<string, PlaylistItemData>,
   * itemsContainer: Element|HTMLElement|null,
   * itemSelector: string|null,
   * itemTagName: string|null,
   * playlistPanel: Element|HTMLElement|null,
   * isPlaylistPage: boolean,
   * isDeleting: boolean,
   * deleteMode: boolean,
   * selectedItems: Map<Element, string>,
   * rootSubId: string|null
   * }} */
  const state = {
    searchInput: null,
    searchResults: null,
    originalItems: [],
    currentPlaylistId: null,
    itemsCache: new Map(), // Cache for faster lookups
    itemsContainer: null,
    itemSelector: null,
    itemTagName: null,
    playlistPanel: null,
    isPlaylistPage: false,
    // Deletion state
    isDeleting: false,
    deleteMode: false,
    selectedItems: new Map(),
    rootSubId: null,
  };

  // batch-deletion cancel flag - set by the Stop button or navigation.
  let deleteCancelled = false;
  // monotonic operation id. Every per-item removal allocates an id; a
  // cancel records the id active at that moment. An operation whose id was
  // already covered by a cancel must never issue a new destructive click,
  // while a later operation (higher id) starts clean, so stale cancellation
  // cannot poison the next run.
  let deleteOperationEpoch = 0;
  let cancelledAtEpoch = -1;

  /**
   * One-shot timer for the deletion flow. A batch must always reach its
   * report, so its polls are not swept by navigation; each poll checks the
   * cancel epoch and the timer leaves the manager when it fires.
   * @param {() => void} fn
   * @param {number} ms
   */
  const deleteTimeout = (fn, ms) =>
    window.YouTubePlusCleanupManager.timeout(fn, ms, { scope: 'session' });

  /** Batch one repaint after the next frame; owned by the search bar. */
  const scheduleFrame = (/** @type {() => void} */ worker) => {
    if (!uiScope) return;
    frameRelease?.();
    frameRelease = uiScope.frame(() => {
      frameRelease = null;
      worker();
    });
  };

  /**
   * Cancel a running batch deletion. Safe to call anytime.
   * @returns {void}
   */
  const cancelBatchDeletion = () => {
    deleteCancelled = true;
    cancelledAtEpoch = deleteOperationEpoch;
  };

  const inputDebouncers = new WeakMap();
  /**
   * Attach focus/input delegations for the search bar, owned by its group.
   * @param {YouTubePlusFeatureContext} owner
   */
  const setupInputDelegation = owner => {
    const handleFocus = (/** @type {HTMLInputElement} */ input) => {
      input.classList.add('is-focused');
    };

    const handleBlur = (/** @type {HTMLInputElement} */ input) => {
      input.classList.remove('is-focused');
    };

    const handleInput = (/** @type {HTMLInputElement} */ input) => {
      let debounced = inputDebouncers.get(input);
      if (!debounced) {
        debounced = debounce((/** @type {string} */ value) => {
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

    // Owned by the feature: the delegations are released when it stops
    // (and with each rebuilt UI instance).
    owner.delegate(
      document,
      'focusin',
      '.yp-playlist-search-input',
      (/** @type {Event} */ _ev, /** @type {Element} */ target) => {
        if (target instanceof HTMLInputElement) handleFocus(target);
      }
    );
    owner.delegate(
      document,
      'focusout',
      '.yp-playlist-search-input',
      (/** @type {Event} */ _ev, /** @type {Element} */ target) => {
        if (target instanceof HTMLInputElement) handleBlur(target);
      }
    );
    owner.delegate(
      document,
      'input',
      '.yp-playlist-search-input',
      (/** @type {Event} */ _ev, /** @type {Element} */ target) => {
        if (target instanceof HTMLInputElement) handleInput(target);
      }
    );
  };

  // (saveSettings removed - settings are static for this module)

  /**
   * Get current playlist id with validation
   * @returns {string|null} Valid playlist ID or null
   */
  const getCurrentPlaylistId = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const listId = urlParams.get('list');

    // Validate playlist ID format (alphanumeric, dashes, underscores)
    if (listId && /^[a-zA-Z0-9_-]+$/.test(listId)) {
      return listId;
    }
    return null;
  };

  /**
   * Try to obtain a display name for the current playlist from DOM
   * @param {Element|HTMLElement} playlistPanel - Playlist panel element
   * @param {string} listId - Playlist ID
   * @returns {string} Playlist display name
   */
  const getPlaylistDisplayName = (playlistPanel, listId) => {
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
      const el = playlistPanel?.querySelector(s) || qs(s);
      if (el?.textContent?.trim()) {
        // Sanitize and limit length
        const title = el.textContent.trim();
        return title.length > 100 ? `${title.substring(0, 100)}...` : title;
      }
    }

    // Fallback to meta or channel-specific metadata
    const meta = /** @type {HTMLMetaElement | null} */ (
      qs('meta[name="title"]') || qs('meta[property="og:title"]')
    );
    if (meta?.content) {
      const title = meta.content.trim();
      return title.length > 100 ? `${title.substring(0, 100)}...` : title;
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

    if (U?.isWatchPage?.() === true) {
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
    if (!(psCtx && shouldRunOnThisPage())) return;

    const playlistId = getCurrentPlaylistId();
    if (!playlistId) return;

    const context = getPlaylistContext();
    if (!context) return;
    const { panel: playlistPanel, itemsContainer, itemSelector, itemTagName } = context;

    // Don't add search UI twice
    if (playlistPanel.querySelector('.yp-playlist-search')) return;

    // One scope per search-bar instance: stale-bar resources are released
    // here, so a rebuilt UI never doubles its listeners.
    uiScope?.dispose();
    uiScope = psCtx.scope();

    state.currentPlaylistId = playlistId;
    state.itemsContainer = itemsContainer || null;
    state.itemSelector = itemSelector;
    state.itemTagName = itemTagName;
    state.playlistPanel = playlistPanel;
    state.isPlaylistPage = context.isPlaylistPage;

    // Create search container
    const searchContainer = document.createElement('div');
    searchContainer.className = 'yp-playlist-search';

    // Make search (and delete bar inside it) sticky within the playlist area.
    // We try to use `position: sticky` when possible; if the DOM structure
    // prevents sticky from working, fall back to `position: fixed` anchored
    // to the playlist panel so the UI remains visible while scrolling.
    /** Watch-page search sits inside the right-hand panel: plain sticky. */
    const applyStickyForWatch_ = () => {
      Object.assign(searchContainer.style, {
        position: 'sticky',
        top: '0',
        zIndex: '1',
        background: 'transparent',
      });
    };

    /** First ancestor (up to body) that actually scrolls. */
    const findScrollAncestor_ = (/** @type {Element|HTMLElement|null} */ panel) => {
      let scrollAncestor = panel;
      while (scrollAncestor && scrollAncestor !== document.body) {
        const style = window.getComputedStyle(scrollAncestor);
        if (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          scrollAncestor.scrollHeight > scrollAncestor.clientHeight
        ) {
          break;
        }
        scrollAncestor = scrollAncestor.parentElement;
      }
      return scrollAncestor;
    };

    /**
     * /playlist sticky positioning: prefer a scrolling ancestor, then a
     * panel-anchored fixed bar, then plain sticky with the panel offset.
     * @param {Element|HTMLElement|null} panel
     */
    const applyStickyForPlaylist_ = panel => {
      // Prefer small top offset on watch page (inside right panel), larger
      // offset on playlist page to account for header/thumbnail column.
      const topOffset = state.isPlaylistPage ? 84 : 8;
      const scrollAncestor = findScrollAncestor_(panel);

      if (scrollAncestor && scrollAncestor !== document.body) {
        // If a scrollable ancestor exists, use sticky
        Object.assign(searchContainer.style, {
          position: 'sticky',
          top: `${topOffset}px`,
          background: 'var(--yt-spec-badge-chip-background)',
          backdropFilter: 'var(--yp-mat-thin-blur)',
          boxShadow: 'var(--yt-shadow)',
        });
      } else if (panel) {
        // Fallback: position fixed near the playlist panel so it remains visible
        const rect = panel.getBoundingClientRect();
        Object.assign(searchContainer.style, {
          position: 'fixed',
          top: `${topOffset}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          background: 'var(--yt-spec-badge-chip-background)',
          backdropFilter: 'var(--yp-mat-thin-blur)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
          zIndex: '9999',
        });

        // Recompute on resize/scroll to keep alignment
        const recompute = debounce(() => {
          const r = panel.getBoundingClientRect();
          searchContainer.style.left = `${r.left}px`;
          searchContainer.style.width = `${r.width}px`;
        }, 120);
        // Owned by the UI instance; released together with the rebuilt bar.
        uiScope?.listen(window, 'resize', recompute, { passive: true });
        uiScope?.listen(window, 'scroll', recompute, { passive: true });
      } else {
        // Last fallback: simple sticky at top
        searchContainer.style.position = 'sticky';
        searchContainer.style.top = `${topOffset}px`;
        searchContainer.style.background = 'var(--yt-spec-badge-chip-background)';
      }
    };

    const ensureSticky = () => {
      // If we're on the /watch page, use the simple sticky style
      // to avoid changing the look/positioning inside the right-hand panel.
      if (!state.isPlaylistPage) {
        applyStickyForWatch_();
        return;
      }
      applyStickyForPlaylist_(
        /** @type {Element|HTMLElement|null} */ (
          state.playlistPanel || getPlaylistContext()?.panel || null
        )
      );
    };

    // Ensure sticky after insertion as DOM layout may change
    uiScope.timeout(ensureSticky, 100);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    const playlistName = getPlaylistDisplayName(playlistPanel, playlistId);
    const placeholderKey = state.isPlaylistPage
      ? 'searchPlaceholderPlaylistPage'
      : 'searchPlaceholder';
    searchInput.placeholder = t(placeholderKey, { playlist: playlistName });
    searchInput.className = 'yp-playlist-search-input';

    setupInputDelegation(uiScope);

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
        itemsContainer.insertBefore(searchContainer, firstVideo);
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

    // Feature-owned: removed with the UI scope when the bar is torn down.
    uiScope.own(searchContainer);

    // Store original items
    collectOriginalItems();

    // Add delete UI (toggle button + action bar)
    addDeleteUI(searchContainer);

    // Setup MutationObserver to watch for new playlist items
    setupPlaylistObserver();
  };

  /**
   * True when the node list contains a playlist item renderer element.
   * @param {NodeList} nodes
   * @param {string} tagName
   * @returns {boolean}
   */
  const nodesContainItemRenderer = (nodes, tagName) => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.nodeType === 1 && /** @type {Element} */ (node).tagName === tagName) return true;
    }
    return false;
  };

  // Setup MutationObserver for dynamic playlist updates
  const setupPlaylistObserver = () => {
    // Disconnect existing watcher if any
    if (state.rootSubId && window.YouTubePlusMutationCoordinator?.unsubscribe) {
      window.YouTubePlusMutationCoordinator.unsubscribe(state.rootSubId);
      state.rootSubId = null;
    }
    const playlistPanel = state.playlistPanel || getPlaylistContext()?.panel;
    if (!(playlistPanel && state.itemTagName && state.itemSelector)) return;

    let lastUpdateCount = state.originalItems.length;
    let updateScheduled = false;
    const itemTagName = state.itemTagName;
    const itemSelector = state.itemSelector;
    const itemsRoot = state.itemsContainer || playlistPanel;

    // Throttled handler for mutations with better batching
    const handleMutations = throttle((/** @type {MutationRecord[]} */ mutations) => {
      // Skip if update already scheduled
      if (updateScheduled) return;

      // Fast check: only process childList changes that add/remove playlist items
      const hasRelevantChange = mutations.some(
        mutation =>
          mutation.type === 'childList' &&
          (nodesContainItemRenderer(mutation.addedNodes, itemTagName) ||
            nodesContainItemRenderer(mutation.removedNodes, itemTagName))
      );

      if (!hasRelevantChange) return;

      updateScheduled = true;
      scheduleFrame(() => {
        const currentCount = lastUpdateCount;
        const newItems = itemsRoot ? itemsRoot.querySelectorAll(itemSelector) : [];

        // Only recollect if item count changed
        if (newItems.length !== currentCount) {
          lastUpdateCount = newItems.length;
          collectOriginalItems();

          // Re-apply current search filter if any
          if (state.searchInput?.value) {
            filterPlaylistItems(state.searchInput.value);
          }
        }
        updateScheduled = false;
      });
    }, config.observerThrottleMs);

    const coordinator = window.YouTubePlusMutationCoordinator;
    const subId = coordinator.subscribeRoot('playlist-search-items', handleMutations, {
      selector: itemSelector,
    });
    state.rootSubId = subId;
    // Released with the search bar.
    uiScope?.onDispose(() => {
      coordinator.unsubscribe(subId);
      if (state.rootSubId === subId) state.rootSubId = null;
    });
  };

  /**
   * Collect all playlist items for filtering with limit and improved caching
   */
  const collectOriginalItems = () => {
    const itemsRoot = state.itemsContainer || state.playlistPanel;
    if (!(itemsRoot && state.itemSelector)) return;
    const items = itemsRoot.querySelectorAll(state.itemSelector);

    // Limit number of items to prevent performance issues
    if (items.length > config.maxPlaylistItems) {
      playlistLogger?.warn?.(
        'Playlist Search',
        `Playlist has ${items.length} items, limiting to ${config.maxPlaylistItems}`
      );
    }

    // Don't clear cache - keep existing cached items to avoid reprocessing
    // Only remove items that left the DOM
    const currentVideoIds = new Set();

    const itemsArray = Array.from(items).slice(0, config.maxPlaylistItems);

    state.originalItems = itemsArray.map((item, index) => {
      const videoId = item.getAttribute('video-id') || `item-${index}`;
      currentVideoIds.add(videoId);

      // Check if this item is already cached and element is still the same
      if (state.itemsCache.has(videoId)) {
        const cached = state.itemsCache.get(videoId);
        if (cached && cached.element === item) {
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

    // Clean up cache - drop items that left the DOM
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
    // Cancel any pending frame
    frameRelease?.();
    frameRelease = null;

    // Validate and sanitize query
    if (query && typeof query !== 'string') {
      playlistLogger?.warn?.('Playlist Search', 'Invalid query type');
      return;
    }

    // Limit query length to prevent performance issues
    if (query && query.length > config.maxQueryLength) {
      query = query.substring(0, config.maxQueryLength);
    }

    if (!query || query.trim() === '') {
      // Show all items using RAF for smooth update
      scheduleFrame(() => {
        state.originalItems.forEach(item => {
          if (item.element instanceof HTMLElement) {
            item.element.style.display = '';
          }
        });
      });
      return;
    }

    const searchTerm = query.toLowerCase().trim();
    let visibleCount = 0;

    // Batch DOM updates using RAF
    scheduleFrame(() => {
      // Use document fragment approach - collect changes first
      /** @type {{ element: HTMLElement, display: string }[]} */
      const updates = [];

      state.originalItems.forEach(item => {
        const matches = item.title.includes(searchTerm) || item.channel.includes(searchTerm);

        if (item.element instanceof HTMLElement) {
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
        }
      });

      // Apply all updates in one batch to minimize reflows
      updates.forEach(update => {
        update.element.style.display = update.display;
      });

      // Update results count indicator if needed
      updateResultsCount(visibleCount, state.originalItems.length);
    });
  };

  // Update results count (optional visual feedback)
  const updateResultsCount = (/** @type {number} */ visible, /** @type {number} */ total) => {
    // Could add a results counter here if desired
    U?.logger?.debug?.(`[Playlist Search] Showing ${visible} of ${total} videos`);
  };

  // ── Video Deletion Feature ──

  /** Shared error-boundary wrapper for this module's flows. */
  const withErrorBoundary = U.createWithErrorBoundary('PlaylistSearch');

  /**
   * Toggle delete mode: show or hide checkboxes on playlist items
   */
  const toggleDeleteMode = withErrorBoundary(() => {
    state.deleteMode = !state.deleteMode;
    state.selectedItems.clear();

    const container = state.playlistPanel || getPlaylistContext()?.panel;
    if (!container) return;

    const toggleBtn = container.querySelector('.yp-playlist-delete-toggle');
    const deleteBar = container.querySelector('.yp-playlist-delete-bar');

    if (state.deleteMode) {
      if (toggleBtn instanceof HTMLElement) {
        toggleBtn.classList.add('active');
        toggleBtn.setAttribute('aria-pressed', 'true');
        toggleBtn.title = t('playlistDeleteModeExit');
      }
      if (deleteBar) {
        deleteBar.classList.add('is-visible');
      }
      addCheckboxesToItems();
    } else {
      if (toggleBtn instanceof HTMLElement) {
        toggleBtn.classList.remove('active');
        toggleBtn.setAttribute('aria-pressed', 'false');
        toggleBtn.title = t('playlistDeleteMode');
      }
      if (deleteBar) {
        deleteBar.classList.remove('is-visible');
      }
      removeCheckboxesFromItems();
    }
    updateDeleteBarState();
  }, 'toggleDeleteMode');

  /**
   * Add selection checkboxes to each playlist video item
   */
  const addCheckboxesToItems = withErrorBoundary(() => {
    const itemsRoot = state.itemsContainer || state.playlistPanel;
    if (!(itemsRoot && state.itemSelector)) return;

    const items = itemsRoot.querySelectorAll(state.itemSelector);

    // One scope per delete-mode round: the last round's checkbox
    // listeners and elements are released here.
    if (!uiScope) return;
    deleteScope?.dispose();
    const roundScope = uiScope.scope();
    deleteScope = roundScope;

    items.forEach((item, idx) => {
      if (item.querySelector('.yp-playlist-item-checkbox')) return;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      // Use shared settings checkbox styling for consistent look
      checkbox.className = 'yp-playlist-item-checkbox yp-settings-checkbox';
      checkbox.setAttribute('aria-label', t('playlistSelectVideo'));
      checkbox.dataset.index = String(idx);

      const onSelectionChange = () => {
        // the selection unit is the playlist occurrence: this exact renderer
        // element plus its video-id at selection time. Duplicate renderers of
        // the same video are independent selection units; a staleness check at
        // delete time keeps a recycled element from dragging a different video
        // into the batch.
        if (checkbox.checked) {
          state.selectedItems.set(item, item.getAttribute('video-id') || `item-${idx}`);
        } else {
          state.selectedItems.delete(item);
        }
        updateDeleteBarState();
      };

      // Owned by the delete-mode round: released with it.
      roundScope.listen(checkbox, 'change', onSelectionChange);
      roundScope.listen(checkbox, 'click', (/** @type {Event} */ e) => e.stopPropagation());

      // The item needs relative positioning for the checkbox; the round
      // gives it back together with the checkbox.
      const itemStyle = /** @type {HTMLElement} */ (item).style;
      const previousPosition = itemStyle.position;
      itemStyle.position = 'relative';
      item.insertBefore(checkbox, item.firstChild);
      roundScope.own(checkbox);
      roundScope.onDispose(() => {
        itemStyle.position = previousPosition;
      });
    });
  }, 'addCheckboxesToItems');

  /**
   * Remove all checkboxes from playlist items
   */
  const removeCheckboxesFromItems = withErrorBoundary(() => {
    // The round owns its checkboxes, their listeners and the item styling.
    deleteScope?.dispose();
    deleteScope = null;
    state.selectedItems.clear();
  }, 'removeCheckboxesFromItems');

  /**
   * Update delete action bar button state
   */
  const updateDeleteBarState = withErrorBoundary(() => {
    const container = state.playlistPanel || getPlaylistContext()?.panel;
    if (!container) return;

    const deleteBtn = container.querySelector('.yp-playlist-delete-selected');
    const countSpan = container.querySelector('.yp-playlist-selected-count');

    if (deleteBtn instanceof HTMLButtonElement) {
      deleteBtn.disabled = state.selectedItems.size === 0;
    }
    if (countSpan instanceof HTMLElement) {
      countSpan.textContent = t('playlistSelectedCount', {
        count: state.selectedItems.size,
      });
    }
  }, 'updateDeleteBarState');

  /**
   * Select all visible playlist items
   */
  const selectAllItems = withErrorBoundary(() => {
    const itemsRoot = state.itemsContainer || state.playlistPanel;
    if (!(itemsRoot && state.itemSelector)) return;
    const itemSelector = state.itemSelector;

    itemsRoot.querySelectorAll('.yp-playlist-item-checkbox').forEach(node => {
      if (!(node instanceof HTMLInputElement)) return;
      const item = node.closest(itemSelector);
      if (item instanceof HTMLElement && item.style.display !== 'none') {
        node.checked = true;
        state.selectedItems.set(
          item,
          item.getAttribute('video-id') || `item-${node.dataset.index}`
        );
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

    itemsRoot.querySelectorAll('.yp-playlist-item-checkbox').forEach(node => {
      if (node instanceof HTMLInputElement) {
        node.checked = false;
      }
    });
    state.selectedItems.clear();
    updateDeleteBarState();
  }, 'clearAllItems');

  /**
   * selection token pinned to ONE queued occurrence. Virtualization
   * can recycle the renderer element between batch steps (the slot starts
   * displaying a DIFFERENT video); every destructive decision re-checks this
   * token, so a recycled renderer is never clicked.
   * @typedef {{
   *   item: Element,
   *   videoId: string,
   *   itemsRoot: Element
   * }} PlaylistOccurrenceToken
   */

  /**
   * an occurrence token stays valid only while the SAME renderer keeps
   * showing the SAME recorded video inside the SAME playlist root.
   * @param {PlaylistOccurrenceToken} token
   * @returns {boolean}
   */
  const isOccurrenceValid = token =>
    !!token &&
    !!token.itemsRoot &&
    token.itemsRoot.contains(token.item) &&
    token.item.getAttribute('video-id') === token.videoId;

  /**
   * Outcome contract for playlist item removal:
   *   - 'unconfirmed': the destructive click was sent and the DOM showed a
   *                    settled detach, but DOM evidence alone cannot prove the
   *                    server accepted the deletion because a recycled
   *                    renderer looks identical. Reported honestly, not as a
   *                    success.
   *   - 'not_removed': the click was sent but the item is still there
   *                    (backend did not accept it);
   *   - 'cancelled': refused before the destructive click (batch/Stop cancel,
   *                    stale context, or a recycled occurrence), so no click
   *                    was sent;
   *   - 'unknown': a click was sent but the evidence is inconsistent (item
   *                    re-appeared, context churn); not a success.
   * @typedef {{status: 'unconfirmed'|'not_removed'|'cancelled'|'unknown', clicked: boolean, detail: string}} PlaylistRemovalOutcome
   */

  /**
   * Find and click the native "Remove from playlist" menu option for a given
   * item. YouTube provides a three-dot menu on each playlist item; we click the
   * menu button, wait for the popup, then click the remove option.
   *
   * Contract:
   *   - the caller's cancellation predicate is honored at every await/poll and
   *     immediately before the destructive click; a popup that appears after
   *     the cancel is never clicked;
   *   - popup ownership: a popup qualifies as ours only if it became visible
   *     after our click (a fresh element, or a reused YouTube popup that was
   *     hidden before) and no foreign gesture was observed while we waited; an
   *     already-open foreign menu stays foreign;
   *   - completion evidence: our element must be gone from an unchanged
   *     playlist context whose container shrank. A DOM-only detach is identical
   *     for a real removal and a recycled renderer, so that evidence is
   *     reported as 'unconfirmed', never as a confirmed server success;
   *   - identity: when the caller passes an occurrence token, it is re-verified
   *     before the menu is opened, after the popup appears and immediately
   *     before the destructive click; a recycled renderer is refused without
   *     any click.
   *   - an already-sent remove click is observed to its real outcome; only
   *     not-yet-sent clicks are forbidden after a cancel.
   *
   * @param {Element} item - playlist video renderer element
   * @param {{ isCancelled?: () => boolean, token?: PlaylistOccurrenceToken }} [opts]
   *   - extra cancellation token (e.g. a batch-level predicate) and the
   *   occurrence identity token; combined with the operation-id based Stop flag
   * @returns {Promise<PlaylistRemovalOutcome>} The removal outcome (see the
   *   contract above; DOM evidence is never claimed as server success)
   */
  const removeItemViaMenu = (item, opts = {}) => {
    const opId = ++deleteOperationEpoch;
    const isCancelled =
      typeof opts?.isCancelled === 'function'
        ? () => (opts.isCancelled ? opts.isCancelled() : false) || opId <= cancelledAtEpoch
        : () => opId <= cancelledAtEpoch;
    return new Promise(resolve => {
      try {
        // Find the three-dot menu button (?)
        const menuBtn =
          item.querySelector('button#button[aria-label]') ||
          item.querySelector('yt-icon-button#button') ||
          item.querySelector('ytd-menu-renderer button') ||
          item.querySelector('[aria-haspopup="menu"]') ||
          item.querySelector('button.yt-icon-button');

        if (!menuBtn) {
          playlistLogger?.warn?.('Playlist Search', 'Could not find menu button for item');
          resolve({
            status: 'unknown',
            clicked: false,
            detail: 'no menu button',
          });
          return;
        }

        // refuse BEFORE opening any menu when the recorded occurrence no
        // longer matches (virtualization recycled this renderer into another
        // video, or the playlist root was replaced). No destructive click.
        if (opts.token && !isOccurrenceValid(opts.token)) {
          playlistLogger?.warn?.(
            'Playlist Search',
            'Selected occurrence no longer matches its recorded video (recycled) — no click'
          );
          resolve({
            status: 'cancelled',
            clicked: false,
            detail: 'selected occurrence recycled',
          });
          return;
        }

        const POPUP_SELECTOR = 'tp-yt-paper-listbox, ytd-menu-popup-renderer, tp-yt-iron-dropdown';

        // Identity snapshot: completion is proven against this context.
        const routeAtStart = location.href;
        const parentAtStart = item.parentElement;
        // Count only playlist-item-like siblings (elements carrying a
        // video-id) so unrelated nodes (e.g. menu popups attached to the
        // same container) cannot mask the removal.
        const countItemLikeSiblings = () =>
          parentAtStart
            ? Array.from(parentAtStart.children).filter(c => c.hasAttribute?.('video-id')).length
            : -1;
        const siblingsAtStart = countItemLikeSiblings();

        /**
         * Visible in the layout sense: attached, not hidden, not display:none.
         * @param {Element} el
         * @returns {boolean}
         */
        const isPopupVisible = el => {
          if (!el?.isConnected) return false;
          if (el.hasAttribute?.('hidden')) return false;
          const style = document.defaultView?.getComputedStyle?.(el);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
          return true;
        };

        // Ownership: snapshot popups visible BEFORE our click so we only
        // ever scan a popup that THIS click opened - never a foreign menu
        // that happened to be open (e.g. a popup from another UI surface).
        const popupsBefore = new Set(Array.from(document.querySelectorAll(POPUP_SELECTOR)));
        const visibleBefore = new Set(
          Array.from(document.querySelectorAll(POPUP_SELECTOR)).filter(isPopupVisible)
        );

        // bind the popup to our gesture. While we wait, any click on an
        // element outside our item means another surface opened a menu, so the
        // next fresh popup is foreign for this item and must never be acted
        // on. Our own menuBtn.click() has already finished dispatching by the
        // time this watcher registers (element.click() is synchronous).
        let foreignClickObserved = false;
        /**
         * @param {Event} e
         */
        const onForeignClick = e => {
          if (e.target instanceof Node && !item.contains(e.target)) foreignClickObserved = true;
        };
        const cm = window.YouTubePlusCleanupManager;
        const watcherKey = cm.registerListener(document, 'click', onForeignClick, true, true);
        const stopForeignWatcher = () => {
          if (watcherKey) cm.unregisterListener?.(watcherKey);
        };

        // every refusal path closes our popup, stops the foreign
        // watcher and reports the outcome WITHOUT any destructive click.
        const refuse = (
          /** @type {'cancelled'|'unknown'} */ status,
          /** @type {string} */ detail,
          /** @type {string} */ warnText
        ) => {
          stopForeignWatcher();
          document.body.click();
          if (warnText) playlistLogger?.warn?.('Playlist Search', warnText);
          resolve({ status, clicked: false, detail });
        };

        // The popup is stale when a cancel arrived, another surface
        // clicked meanwhile, the popup vanished, the renderer is detached OR
        // displays a different video (recycled), or the route
        // changed. Such a context must never receive a destructive click.
        const isStaleContext = /** @type {(ourPopup: Element) => boolean} */ (
          ourPopup =>
            isCancelled() ||
            foreignClickObserved ||
            !isPopupVisible(ourPopup) ||
            !document.contains(item) ||
            (opts.token && !isOccurrenceValid(opts.token)) ||
            location.href !== routeAtStart
        );

        // Exact playlist-removal action identity. A broad
        // includes('remove') would click "Remove from queue" (and other
        // surfaces), so the destructive action must be the playlist one. The
        // list covers the localized forms of "Remove from playlist"; without
        // an exact match we do nothing (no destructive click, honest failure);
        // a wrong action is worse than a skipped one.
        const PLAYLIST_REMOVE_PHRASES = [
          'remove from playlist',
          'удалить из плейлиста',
          'вилучити з плейлиста',
          'выдаліць з плейліста',
          'supprimer de la playlist',
          'aus playlist entfernen',
          'aus wiedergabeliste entfernen',
          'eliminar de la playlist',
          'eliminar de la lista de reproducción',
          'elimina dalla playlist',
          'rimuovi dalla playlist',
          'oynatma listesinden çıkar',
          'çalma listesinden kaldır',
          '재생목록에서 삭제',
          '플레이리스트에서 삭제',
          'プレイリストから削除',
          '从播放列表中移除',
          '從播放清單中移除',
          'премахване от плейлиста',
          'playlistdan oʻchirish',
          'плейлисттен жою',
          'плейлисттен өчүрүү',
          'usuń z playlisty',
          'remover da playlist',
          'remover da lista de reprodução',
          'xóa khỏi danh sách phát',
        ];
        // Belt-and-suspenders: even an exact-phrase hit is rejected when the
        // label clearly names another surface (queue/history/watched/dupes).
        const COMPETING_SURFACE_RE =
          /queue|очеред|истор|watched|просмотрен|позже|later|duplicate|дубликат|похожие|similar/;

        const normalizeMenuText = /** @type {(text: string) => string} */ (
          text => (text || '').toLowerCase().replace(/\s+/g, ' ').trim()
        );

        const findPlaylistRemoveAction = (/** @type {Element} */ ourPopup) => {
          const menuItems = Array.from(ourPopup.querySelectorAll('ytd-menu-service-item-renderer'));
          for (const mi of menuItems) {
            const label = normalizeMenuText(mi.getAttribute('aria-label') || mi.textContent);
            if (!label) continue;
            const phrase = PLAYLIST_REMOVE_PHRASES.find(p => label === p || label.startsWith(p));
            if (!phrase) continue;
            if (COMPETING_SURFACE_RE.test(label)) continue;
            return mi;
          }
          return null;
        };

        /**
         * Outcome contract (see the typedef above):
         *   - 'unconfirmed': click sent, DOM showed a settled detach; DOM
         *                    evidence alone cannot prove server acceptance;
         *   - 'not_removed': the click was sent but the item is still there;
         *   - 'cancelled': refused before the destructive click (no click
         *                    sent);
         *   - 'unknown': a click was sent but the evidence is inconsistent;
         *                    not a success.
         */

        // the option click only counts as success once THIS item is
        // actually detached AND stays detached in an unchanged playlist
        // context whose container shrank (two consecutive polls ≥250ms
        // apart). Navigation/virtualization removals are not claimed as
        // success, and a re-attached renderer resets the evidence.
        const confirmRemoval = () => {
          if (location.href !== routeAtStart) return false;
          if (document.contains(item)) return false;
          if (!parentAtStart?.isConnected) return false;
          return countItemLikeSiblings() < siblingsAtStart;
        };
        const waitForRemoval = (
          /** @type {number} */ deadlineMs,
          /** @type {(outcome: PlaylistRemovalOutcome) => void} */ onDone
        ) => {
          const started = Date.now();
          // the settle-state machine tracks whether the removal evidence
          // (detach + shrink) held for the full window; churn resets it.
          let firstConfirmedAt = -1;
          const observeEvidence = () => {
            if (confirmRemoval()) {
              if (firstConfirmedAt < 0) {
                firstConfirmedAt = Date.now();
                return 'pending';
              }
              return Date.now() - firstConfirmedAt >= 250 ? 'settled' : 'pending';
            }
            // The renderer re-appeared (virtualization churn) or the context
            // changed mid-confirmation, so the evidence is inconsistent.
            if (firstConfirmedAt >= 0) firstConfirmedAt = -1;
            return 'unsettled';
          };
          const finish = (
            /** @type {'unconfirmed'|'not_removed'|'unknown'} */ status,
            /** @type {string} */ detail
          ) => {
            stopForeignWatcher();
            onDone({ status, clicked: true, detail });
          };
          const poll = () => {
            // An already-sent click is observed to its real outcome even
            // after a cancel; only new clicks are refused.
            if (observeEvidence() === 'settled') {
              // DOM-only evidence (detach + shrink) is identical for a real
              // server removal and a recycled renderer, so it is reported as
              // unconfirmed, never as a confirmed server deletion.
              finish('unconfirmed', 'removal observed in DOM; server acceptance unverified');
              return;
            }
            if (Date.now() - started >= deadlineMs) {
              if (firstConfirmedAt >= 0) {
                finish('unknown', 'removal evidence never settled');
              } else {
                finish('not_removed', 'item still attached after deadline');
              }
              return;
            }
            deleteTimeout(poll, 100);
          };
          poll();
        };

        // Click the menu button to open popup
        /** @type {HTMLElement} */ (menuBtn).click();

        // Ownership: poll for a popup that became visible after our click, a
        // fresh element or a reused YouTube popup that was hidden before. An
        // already-open foreign menu stays foreign; a popup that appears after
        // a foreign gesture is never scanned for this item.
        /** @typedef {Element | { cancelled: boolean } | null} PopupResult */
        const POPUP_WAIT_MS = 2000;
        const popupPollStarted = Date.now();
        const waitForOurPopup = (/** @type {(popup: PopupResult) => void} */ onDone) => {
          const poll = () => {
            // honor the cancellation at every poll.
            if (isCancelled()) {
              onDone({ cancelled: true });
              return;
            }
            const fresh = Array.from(document.querySelectorAll(POPUP_SELECTOR)).filter(
              p =>
                isPopupVisible(p) &&
                ((popupsBefore.has(p) && !visibleBefore.has(p)) || !popupsBefore.has(p))
            );
            if (fresh.length > 0) {
              onDone(fresh[0]);
              return;
            }
            if (Date.now() - popupPollStarted >= POPUP_WAIT_MS) {
              onDone(null);
              return;
            }
            deleteTimeout(poll, 100);
          };
          poll();
        };

        /**
         * Handle the settled popup result. Every refusal path closes our menu
         * and reports WITHOUT a destructive click; the destructive click is
         * the LAST step, behind the second identity gate.
         * @param {PopupResult} ourPopup
         */
        const handlePopupOutcome = ourPopup => {
          if (ourPopup && 'cancelled' in ourPopup && ourPopup.cancelled) {
            // cancelled while waiting: close any menu that appeared and
            // report failure without any destructive click.
            refuse(
              'cancelled',
              'cancelled before popup',
              'Item removal cancelled while waiting for the menu'
            );
            return;
          }
          if (!(ourPopup instanceof Element)) {
            refuse(
              'unknown',
              'no popup appeared',
              'Could not open item menu (slow popup or foreign menu open)'
            );
            return;
          }

          // Re-check context identity immediately before the destructive
          // click: the popup may be stale by now (item recycled by
          // virtualization, foreign gesture, a cancel that arrived while the
          // popup was being detected, or a mismatched occurrence token).
          if (isStaleContext(ourPopup)) {
            refuse(
              'cancelled',
              'stale context',
              'Menu context stale (cancel, foreign gesture, or item recycled) — no destructive click'
            );
            return;
          }

          const removeOption = findPlaylistRemoveAction(ourPopup);
          if (!removeOption) {
            // No exact playlist-removal action in OUR popup: close it, no
            // destructive click (wrong action is worse than none).
            refuse(
              'unknown',
              'no exact playlist remove action',
              'No exact "Remove from playlist" action in menu — refusing to guess'
            );
            return;
          }
          // the last identity gate, directly before the destructive click.
          // Nothing between here and .click() may act on a renderer that now
          // displays another video. The same stale predicate is re-run
          // (cancel, foreign gesture, popup visibility, recycled occurrence,
          // route).
          if (isStaleContext(ourPopup)) {
            refuse(
              'cancelled',
              'occurrence recycled before destructive click',
              'Occurrence recycled or cancelled just before the destructive click — refusing'
            );
            return;
          }
          /** @type {HTMLElement} */ (removeOption).click();
          // The remove click is now SENT: cancellation cannot un-send it.
          // We keep observing the real outcome; only new clicks are
          // forbidden, and the foreign watcher is not needed now.
          stopForeignWatcher();

          // A settled DOM detach is reported honestly as
          // unconfirmed (never a confirmed server success); any other
          // outcome closes our popup and is reported as-is.
          const reportOutcome = /** @type {(outcome: PlaylistRemovalOutcome) => void} */ (
            outcome => {
              if (outcome.status === 'unconfirmed') {
                resolve(outcome);
                return;
              }
              document.body.click();
              playlistLogger?.warn?.(
                'Playlist Search',
                `Remove option clicked but item was not confirmed removed (${outcome.status})`
              );
              resolve(outcome);
            }
          );
          waitForRemoval(2000, reportOutcome);
        };

        waitForOurPopup(ourPopup => {
          try {
            handlePopupOutcome(ourPopup);
          } catch (err) {
            window.YouTubePlusErrorBoundary.logError(
              err instanceof Error ? err : new Error(String(err)),
              { context: 'removeItemViaMenu:findOption' }
            );
            logS(err);
            refuse('unknown', 'error', '');
          }
        });
      } catch (err) {
        window.YouTubePlusErrorBoundary.logError(
          err instanceof Error ? err : new Error(String(err)),
          { context: 'removeItemViaMenu' }
        );
        logS(err);
        resolve({ status: 'unknown', clicked: false, detail: 'error' });
      }
    });
  };
  /**
   * Run the sequential removal batch over OCCURRENCE TOKENS. Each
   * step re-checks the recorded identity before opening any menu; a recycled
   * renderer is skipped WITHOUT any click. Only clicks that were actually
   * sent are counted; a settled DOM detach is reported as unconfirmed, never
   * as a confirmed server deletion.
   * @param {PlaylistOccurrenceToken[]} toDelete
   * @returns {Promise<{unconfirmedCount: number, failCount: number, unknownCount: number, refusedCount: number}>}
   */
  const runRemovalBatch = async toDelete => {
    let unconfirmedCount = 0;
    let failCount = 0;
    let unknownCount = 0;
    let refusedCount = 0;
    for (const token of toDelete) {
      // stop the batch when navigation or the Stop button cancelled it.
      if (deleteCancelled) break;
      // the recorded occurrence must still match before any menu is opened;
      // a mid-batch recycle is skipped without a destructive click.
      if (!isOccurrenceValid(token)) {
        refusedCount++;
        playlistLogger?.warn?.(
          'Playlist Search',
          'Selected occurrence changed mid-batch — skipped without clicking'
        );
        continue;
      }
      const outcome = await removeItemViaMenu(token.item, { token });
      if (outcome.status === 'unconfirmed') {
        unconfirmedCount++;
      } else if (outcome.status === 'unknown') {
        unknownCount++;
      } else if (outcome.status === 'cancelled') {
        // Refused before the destructive click (cancel, stale context or a
        // mid-operation recycle), so nothing was deleted by this step.
        refusedCount++;
      } else {
        failCount++;
      }
      // Delay between actions to let YouTube process
      await new Promise(r => deleteTimeout(() => r(undefined), config.deleteDelay));
    }
    return { unconfirmedCount, failCount, unknownCount, refusedCount };
  };

  /**
   * resolve the selected occurrences to delete. Each queue entry carries its
   * identity token (element + recorded videoId + items root); an entry is
   * skipped without any click when its renderer vanished or was recycled by
   * virtualization (its current video-id differs from the recorded one).
   * Clicking it would act on whatever now occupies that slot.
   * @param {Element} itemsRoot
   * @returns {{toDelete: PlaylistOccurrenceToken[], staleCount: number}}
   */
  const resolveSelectedOccurrences = itemsRoot => {
    const toDelete = [];
    let staleCount = 0;
    for (const [item, videoIdAtSelection] of state.selectedItems) {
      if (!itemsRoot.contains(item) || item.getAttribute('video-id') !== videoIdAtSelection) {
        staleCount++;
        continue;
      }
      toDelete.push({ item, videoId: videoIdAtSelection, itemsRoot });
    }
    if (staleCount > 0) {
      playlistLogger?.warn?.(
        'Playlist Search',
        `${staleCount} selected occurrence(s) no longer match their recorded video — skipped without clicking`
      );
    }
    return { toDelete, staleCount };
  };

  /**
   * Delete selected videos from the playlist sequentially
   */
  const deleteSelectedItems = withErrorBoundary(async () => {
    if (state.isDeleting || state.selectedItems.size === 0) return;

    const count = state.selectedItems.size;
    // own focus-trapped dialog instead of the page-blocking
    // native confirm; the message goes through the dictionary interpolation.
    const confirmed = await U.confirmDialog({
      message: t('playlistDeleteConfirm', { count }),
      confirmLabel: t('confirm'),
      cancelLabel: t('cancel'),
    });
    if (!confirmed) return;

    // the per-item operations already honor the Stop flag via
    // their operation ids (cancelBatchDeletion pins cancelledAtEpoch).
    deleteCancelled = false;
    state.isDeleting = true;
    const stopBtn = qs('.yp-playlist-delete-cancel');
    if (stopBtn instanceof HTMLElement) stopBtn.hidden = false;
    const itemsRoot = state.itemsContainer || state.playlistPanel;
    if (!(itemsRoot && state.itemSelector)) {
      state.isDeleting = false;
      if (stopBtn) /** @type {HTMLElement} */ (stopBtn).hidden = true;
      return;
    }

    const { toDelete, staleCount } = resolveSelectedOccurrences(itemsRoot);

    const { unconfirmedCount, failCount, unknownCount, refusedCount } =
      await runRemovalBatch(toDelete);

    state.isDeleting = false;
    deleteCancelled = false;
    if (stopBtn) /** @type {HTMLElement} */ (stopBtn).hidden = true;
    state.selectedItems.clear();

    // Re-collect items after deletion
    uiScope?.timeout(() => {
      collectOriginalItems();
      if (state.deleteMode) {
        addCheckboxesToItems();
      }
      updateDeleteBarState();
    }, 500);

    // Notify user.
    // A settled DOM detach cannot prove server acceptance, so the batch never
    // reports confirmed removals; every sent click lands in the
    // unconfirmed/failed buckets and is visible in the log line below.
    const unconfirmedTotal = unconfirmedCount + unknownCount + refusedCount + staleCount;
    const msg =
      failCount > 0 || unconfirmedTotal > 0
        ? t('playlistDeletePartial', {
            success: 0,
            fail: failCount + unconfirmedTotal,
          })
        : t('playlistDeleteSuccess', { count: 0 });
    // unconfirmed outcomes are visible in the log, not hidden in "failed".
    U?.logger?.debug?.(
      `[Playlist Search] ${msg}${unconfirmedTotal ? ` (unconfirmed: ${unconfirmedTotal})` : ''}`
    );
  }, 'deleteSelectedItems');

  /**
   * Add delete mode toggle button and action bar to the search UI
   * @param {HTMLElement} searchContainer - The .yp-playlist-search container
   */
  const addDeleteUI = (/** @type {HTMLElement} */ searchContainer) => {
    if (!searchContainer) return;
    if (!uiScope) return;
    if (searchContainer.querySelector('.yp-playlist-delete-toggle')) return;
    const scope = uiScope;

    // Toggle button (trash icon) next to the search input
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'yp-playlist-delete-toggle';
    toggleBtn.setAttribute('aria-pressed', 'false');
    toggleBtn.setAttribute('aria-label', t('playlistDeleteMode'));
    toggleBtn.title = t('playlistDeleteMode');
    U.renderTemplateClone(
      toggleBtn,
      `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        <line x1="10" y1="11" x2="10" y2="17"/>
        <line x1="14" y1="11" x2="14" y2="17"/>
      </svg>
    `
    );
    // Owned by the UI instance; released together with the rebuilt bar.
    scope.listen(toggleBtn, 'click', toggleDeleteMode);

    // Wrap search input and toggle in a flex container
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'yp-playlist-input-row';
    const searchInput = searchContainer.querySelector('.yp-playlist-search-input');
    if (searchInput) {
      if (searchInput.parentNode) {
        searchInput.parentNode.insertBefore(inputWrapper, searchInput);
      }
      inputWrapper.appendChild(searchInput);
      inputWrapper.appendChild(toggleBtn);
    }

    // Action bar (hidden initially)
    const deleteBar = document.createElement('div');
    deleteBar.className = 'yp-playlist-delete-bar';

    const countSpan = document.createElement('span');
    countSpan.className = 'yp-playlist-selected-count';
    countSpan.textContent = t('playlistSelectedCount', { count: 0 });

    const createBtn = (
      /** @type {string} */ label,
      /** @type {string} */ cls,
      /** @type {(ev: Event) => void} */ onClick
    ) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.className = `yp-playlist-delete-action ${cls}`;
      // Owned by the UI instance; released together with the rebuilt bar.
      scope.listen(btn, 'click', onClick);
      return btn;
    };

    const selectAllBtn = createBtn(t('selectAll'), 'yp-playlist-select-all', selectAllItems);
    const clearAllBtn = createBtn(t('clearAll'), 'yp-playlist-clear-all', clearAllItems);
    const deleteBtn = createBtn(
      t('deleteSelected'),
      'yp-playlist-delete-selected',
      deleteSelectedItems
    );
    deleteBtn.disabled = true;

    // Stop button - visible only while a batch deletion is running.
    const stopBtn = createBtn(t('cancel'), 'yp-playlist-delete-cancel', () => {
      cancelBatchDeletion();
    });
    stopBtn.hidden = true;

    deleteBar.append(countSpan, selectAllBtn, clearAllBtn, deleteBtn, stopBtn);
    searchContainer.appendChild(deleteBar);
  };

  // Clean up search UI
  const cleanup = () => {
    // navigation away or unload cancels a running batch.
    cancelBatchDeletion();
    // Items hidden by the filter belong to YouTube; show them again.
    for (const item of state.originalItems) {
      /** @type {HTMLElement} */ (item.element).style.display = '';
    }
    state.isDeleting = false;
    state.deleteMode = false;
    state.selectedItems.clear();

    // The search bar group owns the bar, its listeners, the delete round and
    // the item watch.
    uiScope?.dispose();
    uiScope = null;
    deleteScope = null;
    frameRelease = null;
    state.rootSubId = null;
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

  // Rebuild or remove the search bar for the current route. Single source
  // for navigation events and the initial feature start.
  const syncToRoute = () => {
    const ctx = psCtx;
    if (!(ctx && shouldRunOnThisPage())) {
      cleanup();
      return;
    }
    const newPlaylistId = getCurrentPlaylistId();

    // If playlist hasn't changed and UI exists, no action needed
    if (newPlaylistId === state.currentPlaylistId && qs('.yp-playlist-search')) {
      return;
    }

    cleanup();
    if (!newPlaylistId) return;

    const targetSelector = isPlaylistPage()
      ? 'ytd-playlist-video-list-renderer #contents'
      : 'ytd-playlist-panel-renderer #items';
    U.waitForElement(targetSelector, 1500).finally(() => {
      // A stop or restart between the wait and the build must not build.
      if (ctx.active && ctx === psCtx) addSearchUI();
    });
  };

  // Navigation settles before the playlist panel renders; one rebuild per burst.
  /** @type {(() => void) | null} */
  let navigationRelease = null;
  const handleNavigation = () => {
    navigationRelease?.();
    navigationRelease =
      psCtx?.timeout(() => {
        navigationRelease = null;
        syncToRoute();
      }, 250) || null;
  };

  // Feature start/stop under the FeatureLifecycle contract.
  /** @param {YouTubePlusFeatureContext} ctx */
  const start = ctx => {
    psCtx = ctx;
    // The search/delete style bundle lives only while the feature runs.
    ctx.style(
      'yp-playlist-delete-styles',
      window.YouTubePlusDesignSystem?.getStyle?.('yp-playlist-delete-styles') || ''
    );
    ctx.listen(document, 'yt-navigate-finish', handleNavigation, { passive: true });
    ctx.listen(window, 'beforeunload', cleanup, { passive: true });
    ctx.onDispose(() => {
      navigationRelease = null;
    });
    syncToRoute();
  };

  const stop = () => {
    psCtx = null;
    cleanup();
  };

  // Routing helpers and the deletion flow are exposed for the real-API tests.
  window.YouTubePlusPlaylistSearch = {
    isPlaylistPage,
    shouldRunOnThisPage,
    isRelevantRoute,
    getCurrentPlaylistId,
    getPlaylistDisplayName,
    getPlaylistContext,
    deleteSelectedItems,
    removeItemViaMenu,
    cancelBatchDeletion,
  };

  const playlistSearchFeature = window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
    id: 'playlist-search',
    settingsKey: 'enablePlaylistSearch',
    start,
    stop,
  });

  // Starts the feature when its setting is on, then follows the setting.
  U.onDomReady(() => playlistSearchFeature?.sync());
})();
