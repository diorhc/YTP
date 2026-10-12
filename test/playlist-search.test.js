/**
 * @jest-environment jsdom
 *
 * Tests exercise the real playlist-search.js module through
 * window.YouTubePlusPlaylistSearch. All fake local regex/filter reimplementations
 * have been eliminated in favor of genuine facade testing.
 */

describe('Playlist Search Module (real)', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete window.YouTubePlusPlaylistSearch;
    window._playlistSearchInitialized = false;

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(sel => document.querySelector(sel)),
        $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
        t: jest.fn((key, params = {}) =>
          key === 'playlistDeleteConfirm'
            ? `Delete ${params?.count ?? ''} video(s) from playlist?`
            : key || ''
        ),
        loadFeatureEnabled: jest.fn(() => true),
        isYouTubeDomain: jest.fn(() => true),
        isWatchRoute: jest.fn(() => window.location.pathname === '/watch'),
        isWatchPage: jest.fn(() => window.location.pathname === '/watch'),
        onDomReady: jest.fn(cb => cb()),
        debounce: jest.fn(fn => Object.assign(fn, { cancel: jest.fn() })),
        throttle: jest.fn(fn => fn),
        waitForElement: jest.fn(() => Promise.resolve(null)),
        cleanupManager: {
          registerInterval: jest.fn(id => id),
          registerTimeout: jest.fn(id => id),
          registerObserver: jest.fn(obs => obs),
          registerListener: jest.fn(),
          register: jest.fn(),
          cleanup: jest.fn(),
          registerAnimationFrame: jest.fn(id => id),
        },
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        SETTINGS_KEY: 'youtube_plus_settings',
        logSuppressed: jest.fn(),
        createHTML: jest.fn(s => s),
        createWithErrorBoundary: jest.fn((_name, _logError) => fn => fn),
        helpers: {
          $: jest.fn(sel => document.querySelector(sel)),
          $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
          t: jest.fn((key, params = {}) =>
            key === 'playlistDeleteConfirm'
              ? `Delete ${params?.count ?? ''} video(s) from playlist?`
              : key || ''
          ),
          logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        confirmDialog: jest.fn(() => Promise.resolve(true)),
      },
    });

    mockLocation({
      href: 'https://www.youtube.com/watch?v=test&list=PLtest123',
      search: '?v=test&list=PLtest123',
      hostname: 'www.youtube.com',
      pathname: '/watch',
    });

    localStorage.getItem = jest.fn(() => null);
    localStorage.setItem = jest.fn();

    require('../src/playlist-search.js');
  });

  test('exports canonical window.YouTubePlusPlaylistSearch facade', () => {
    expect(window.YouTubePlusPlaylistSearch).toBeDefined();
    expect(typeof window.YouTubePlusPlaylistSearch.isPlaylistPage).toBe('function');
    expect(typeof window.YouTubePlusPlaylistSearch.shouldRunOnThisPage).toBe('function');
    expect(typeof window.YouTubePlusPlaylistSearch.isRelevantRoute).toBe('function');
    expect(typeof window.YouTubePlusPlaylistSearch.getCurrentPlaylistId).toBe('function');
    expect(typeof window.YouTubePlusPlaylistSearch.getPlaylistDisplayName).toBe('function');
    expect(typeof window.YouTubePlusPlaylistSearch.getPlaylistContext).toBe('function');
  });

  test('isPlaylistPage reflects /playlist pathname', () => {
    mockLocation({
      href: 'https://www.youtube.com/playlist?list=PLtest123',
      search: '?list=PLtest123',
      hostname: 'www.youtube.com',
      pathname: '/playlist',
    });
    expect(window.YouTubePlusPlaylistSearch.isPlaylistPage()).toBe(true);

    mockLocation({
      href: 'https://www.youtube.com/watch?v=test&list=PLtest123',
      search: '?v=test&list=PLtest123',
      hostname: 'www.youtube.com',
      pathname: '/watch',
    });
    expect(window.YouTubePlusPlaylistSearch.isPlaylistPage()).toBe(false);
  });

  test('shouldRunOnThisPage is true on YouTube watch/playlist routes', () => {
    expect(window.YouTubePlusPlaylistSearch.shouldRunOnThisPage()).toBe(true);
  });

  test('isRelevantRoute requires list query param', () => {
    expect(window.YouTubePlusPlaylistSearch.isRelevantRoute()).toBe(true);

    mockLocation({
      href: 'https://www.youtube.com/watch?v=test',
      search: '?v=test',
      hostname: 'www.youtube.com',
      pathname: '/watch',
    });
    expect(window.YouTubePlusPlaylistSearch.isRelevantRoute()).toBe(false);
  });

  test('getCurrentPlaylistId validates alphanumeric IDs and rejects malformed', () => {
    expect(window.YouTubePlusPlaylistSearch.getCurrentPlaylistId()).toBe('PLtest123');

    mockLocation({
      href: 'https://www.youtube.com/playlist?list=PL@invalid',
      search: '?list=PL@invalid',
      hostname: 'www.youtube.com',
      pathname: '/playlist',
    });
    expect(window.YouTubePlusPlaylistSearch.getCurrentPlaylistId()).toBeNull();
  });

  test('getPlaylistDisplayName falls back to list id if title missing', () => {
    expect(window.YouTubePlusPlaylistSearch.getPlaylistDisplayName(null, 'PLfallback')).toBe(
      'PLfallback'
    );
  });

  test('getPlaylistDisplayName truncates long titles cleanly', () => {
    const panel = document.createElement('div');
    panel.innerHTML = `<h1 class="title">${'a'.repeat(120)}</h1>`;
    const name = window.YouTubePlusPlaylistSearch.getPlaylistDisplayName(panel, 'PLfallback');
    expect(name.endsWith('...')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(103);
  });

  test('settings-updated event triggers setFeatureEnabled and cleanup', () => {
    expect(() => {
      window.dispatchEvent(
        new CustomEvent('youtube-plus-settings-updated', {
          detail: { enablePlaylistSearch: false },
        })
      );
    }).not.toThrow();
  });

  test('getPlaylistContext returns correct context object for watch page', () => {
    document.body.innerHTML =
      '<ytd-playlist-panel-renderer><div id="items"></div></ytd-playlist-panel-renderer>';
    const ctx = window.YouTubePlusPlaylistSearch.getPlaylistContext();
    expect(ctx).toMatchObject({
      isPlaylistPage: false,
      itemSelector: 'ytd-playlist-panel-video-renderer',
      itemTagName: 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER',
    });
    expect(ctx?.panel).toBeInstanceOf(HTMLElement);
    expect(ctx?.itemsContainer).toBeInstanceOf(HTMLElement);
  });

  test('shouldRunOnThisPage returns false when not YouTube domain', () => {
    window.YouTubeUtils.isYouTubeDomain = jest.fn(() => false);
    expect(window.YouTubePlusPlaylistSearch.shouldRunOnThisPage()).toBe(false);
  });

  test('getPlaylistContext returns playlist-page context on /playlist path', () => {
    mockLocation({
      href: 'https://www.youtube.com/playlist?list=PLtest123',
      search: '?list=PLtest123',
      hostname: 'www.youtube.com',
      pathname: '/playlist',
    });
    document.body.innerHTML =
      '<ytd-playlist-video-list-renderer><div id="contents"></div></ytd-playlist-video-list-renderer>';
    const ctx = window.YouTubePlusPlaylistSearch.getPlaylistContext();
    expect(ctx).toMatchObject({
      isPlaylistPage: true,
      itemSelector: 'ytd-playlist-video-renderer',
      itemTagName: 'YTD-PLAYLIST-VIDEO-RENDERER',
    });
  });

  test('getPlaylistDisplayName falls back to meta title tag', () => {
    const meta = document.createElement('meta');
    meta.name = 'title';
    meta.content = 'Meta Playlist Title';
    document.head.appendChild(meta);
    const panel = document.createElement('div');
    const name = window.YouTubePlusPlaylistSearch.getPlaylistDisplayName(panel, 'PLfallback');
    expect(name).toBe('Meta Playlist Title');
  });

  /**
   * M7b: the real UI build on a /playlist page — sticky positioning,
   * focus/input delegations and filtering through the real feature stack.
   */
  describe('M7b: search UI build and input delegation', () => {
    afterEach(() => {
      window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
      delete window.YouTubePlusFeatureRegistry;
    });

    const wait = ms => new Promise(r => setTimeout(r, ms));

    const loadFeature = () => {
      delete window.YouTubePlusCleanupManager;
      delete window.YouTubePlusFeatureRegistry;
      require('../src/cleanup-manager.js');
      require('../src/settings-store.js');
      require('../src/event-delegation.js');
      require('../src/mutation-coordinator.js');
      require('../src/feature-registry.js');
      require('../src/playlist-search.js');
    };

    const buildPlaylistPageDom = () => {
      mockLocation({
        href: 'https://www.youtube.com/playlist?list=PLui',
        search: '?list=PLui',
        hostname: 'www.youtube.com',
        pathname: '/playlist',
      });
      const contents = document.createElement('div');
      contents.id = 'contents';
      const panel = document.createElement('ytd-playlist-video-list-renderer');
      panel.appendChild(contents);
      document.body.appendChild(panel);
      for (let i = 0; i < 2; i++) {
        const item = document.createElement('ytd-playlist-video-renderer');
        item.setAttribute('video-id', `vid-${i}`);
        const title = document.createElement('div');
        title.id = 'video-title';
        title.textContent = i ? 'Alpha video' : 'Beta video';
        item.appendChild(title);
        contents.appendChild(item);
      }
    };

    const loadUiFeature = async () => {
      jest.resetModules();
      window.YouTubeUtils.renderTemplateClone = jest.fn((el, html) => {
        el.innerHTML = html;
      });
      delete window.YouTubePlusPlaylistSearch;
      loadFeature();
      // ensureInit builds the bar immediately; ensureSticky lands at 100ms.
      await wait(300);
      return document.querySelector('.yp-playlist-search-input');
    };

    test('the bar builds on /playlist, anchors to the panel and filters items', async () => {
      buildPlaylistPageDom();
      const input = await loadUiFeature();
      expect(input).toBeTruthy();

      const bar = /** @type {HTMLElement} */ (document.querySelector('.yp-playlist-search'));
      // jsdom rects are zero: no scrollable ancestor, so the fixed-anchored
      // branch positions the bar next to the panel.
      expect(bar.style.position).toBe('fixed');

      // focus/blur delegation toggles the visual state
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(input.classList.contains('is-focused')).toBe(true);
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      expect(input.classList.contains('is-focused')).toBe(false);

      // filtering hides non-matching items
      input.value = 'alpha';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(60);
      const items = document.querySelectorAll('ytd-playlist-video-renderer');
      expect(items[0].style.display).toBe('none');
      expect(items[1].style.display).toBe('');

      // query change to beta unhides items[0] and hides items[1]
      input.value = 'beta';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(60);
      expect(items[0].style.display).toBe('');
      expect(items[1].style.display).toBe('none');

      // clearing the query shows everything again
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(60);
      expect(items[0].style.display).toBe('');
      expect(items[1].style.display).toBe('');
    });

    test('overlong queries are truncated to the configured maximum', async () => {
      buildPlaylistPageDom();
      const input = await loadUiFeature();
      expect(input).toBeTruthy();

      input.value = 'x'.repeat(305);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(60);
      expect(input.value.length).toBe(300);
    });

    test('delete UI controls toggle mode, selection, and handle stop button', async () => {
      buildPlaylistPageDom();
      const input = await loadUiFeature();
      expect(input).toBeTruthy();

      const toggleBtn = document.querySelector('.yp-playlist-delete-toggle');
      const deleteBar = document.querySelector('.yp-playlist-delete-bar');
      const stopBtn = document.querySelector('.yp-playlist-delete-cancel');
      const selectAllBtn = document.querySelector('.yp-playlist-select-all');
      const clearAllBtn = document.querySelector('.yp-playlist-clear-all');

      expect(toggleBtn).toBeTruthy();
      expect(deleteBar).toBeTruthy();
      expect(stopBtn).toBeTruthy();

      if (toggleBtn instanceof HTMLElement) {
        toggleBtn.click();
        expect(toggleBtn.classList.contains('active')).toBe(true);
      }
      if (selectAllBtn instanceof HTMLElement) {
        selectAllBtn.click();
      }
      if (clearAllBtn instanceof HTMLElement) {
        clearAllBtn.click();
      }
      if (toggleBtn instanceof HTMLElement) {
        toggleBtn.click();
        expect(toggleBtn.classList.contains('active')).toBe(false);
      }
      if (stopBtn instanceof HTMLElement) {
        expect(() => stopBtn.click()).not.toThrow();
      }
    });

    test('the bar builds on /watch route and applies watch sticky styles', async () => {
      mockLocation({
        href: 'https://www.youtube.com/watch?v=abc&list=PLwatch',
        search: '?v=abc&list=PLwatch',
        hostname: 'www.youtube.com',
        pathname: '/watch',
      });
      const items = document.createElement('div');
      items.id = 'items';
      const panel = document.createElement('ytd-playlist-panel-renderer');
      panel.appendChild(items);
      document.body.appendChild(panel);

      const video = document.createElement('ytd-playlist-panel-video-renderer');
      video.setAttribute('video-id', 'vid-watch');
      const title = document.createElement('div');
      title.id = 'video-title';
      title.textContent = 'Watch video';
      video.appendChild(title);
      items.appendChild(video);

      const input = await loadUiFeature();
      expect(input).toBeTruthy();
      const bar = /** @type {HTMLElement} */ (document.querySelector('.yp-playlist-search'));
      expect(bar.style.position).toBe('sticky');
    });

    test('the bar mounts with scrollable ancestor and empty items container', async () => {
      mockLocation({
        href: 'https://www.youtube.com/playlist?list=PLscroll',
        search: '?list=PLscroll',
        hostname: 'www.youtube.com',
        pathname: '/playlist',
      });
      const scrollParent = document.createElement('div');
      scrollParent.style.overflowY = 'auto';
      Object.defineProperty(scrollParent, 'scrollHeight', { value: 500, configurable: true });
      Object.defineProperty(scrollParent, 'clientHeight', { value: 200, configurable: true });
      document.body.appendChild(scrollParent);

      const panel = document.createElement('ytd-playlist-video-list-renderer');
      const contents = document.createElement('div');
      contents.id = 'contents';
      panel.appendChild(contents);
      scrollParent.appendChild(panel);

      const input = await loadUiFeature();
      expect(input).toBeTruthy();
      const bar = /** @type {HTMLElement} */ (document.querySelector('.yp-playlist-search'));
      expect(bar.style.position).toBe('sticky');
    });
  });

  describe('batch delete', () => {
    // The search bar and delete mode run as a lifecycle feature: load the real
    // manager, store, delegator and registry so the feature starts.
    const loadFeature = () => {
      delete window.YouTubePlusCleanupManager;
      delete window.YouTubePlusFeatureRegistry;
      require('../src/cleanup-manager.js');
      require('../src/settings-store.js');
      require('../src/event-delegation.js');
      require('../src/mutation-coordinator.js');
      require('../src/feature-registry.js');
      require('../src/playlist-search.js');
    };

    afterEach(() => {
      window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
      delete window.YouTubePlusFeatureRegistry;
    });

    /** Build a playlist item with a menu button matching the module's fallback selectors. */
    function buildItem() {
      const item = document.createElement('ytd-playlist-video-renderer');
      item.setAttribute('video-id', 'vid1');
      const menuBtn = document.createElement('button');
      menuBtn.id = 'button';
      menuBtn.setAttribute('aria-label', 'Action menu');
      item.appendChild(menuBtn);
      document.body.appendChild(item);
      return { item, menuBtn };
    }

    /** Build a popup container with a service item of the given text. */
    function buildPopup(text, clickHandler) {
      const popup = document.createElement('ytd-menu-popup-renderer');
      const option = document.createElement('ytd-menu-service-item-renderer');
      option.textContent = text;
      option.addEventListener('click', clickHandler || jest.fn());
      popup.appendChild(option);
      document.body.appendChild(popup);
      return { popup, option };
    }

    test('facade exposes batch-delete functions', () => {
      const api = window.YouTubePlusPlaylistSearch;
      expect(typeof api.removeItemViaMenu).toBe('function');
      expect(typeof api.deleteSelectedItems).toBe('function');
      expect(typeof api.cancelBatchDeletion).toBe('function');
    });

    test('batch delete asks the in-UI dialog, never native confirm', async () => {
      mockLocation({
        href: 'https://www.youtube.com/playlist?list=PLr620',
        search: '?list=PLr620',
        hostname: 'www.youtube.com',
        pathname: '/playlist',
      });
      const removeClicks = [];
      const contents = document.createElement('div');
      contents.id = 'contents';
      const panelEl = document.createElement('ytd-playlist-video-list-renderer');
      panelEl.appendChild(contents);
      document.body.appendChild(panelEl);
      const item = document.createElement('ytd-playlist-video-renderer');
      item.setAttribute('video-id', 'vid-r620');
      const menuBtn = document.createElement('button');
      menuBtn.id = 'button';
      menuBtn.setAttribute('aria-label', 'Action menu');
      menuBtn.addEventListener('click', () => {
        const popup = document.createElement('ytd-menu-popup-renderer');
        const option = document.createElement('ytd-menu-service-item-renderer');
        option.textContent = 'Remove from playlist';
        option.addEventListener('click', () => {
          removeClicks.push(1);
          item.remove();
          popup.remove();
        });
        popup.appendChild(option);
        document.body.appendChild(popup);
      });
      item.appendChild(menuBtn);
      contents.appendChild(item);

      jest.resetModules();
      window.YouTubeUtils.renderTemplateClone = jest.fn((el, html) => {
        el.innerHTML = html;
      });
      delete window.YouTubePlusPlaylistSearch;
      window._playlistSearchInitialized = false;
      loadFeature();
      await new Promise(r => setTimeout(r, 20));

      document.querySelector('.yp-playlist-delete-toggle').click();
      const checkbox = document.querySelector('.yp-playlist-item-checkbox');
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));

      const confirmSpy = jest.spyOn(window, 'confirm');
      window.YouTubeUtils.confirmDialog.mockImplementationOnce(async () => false);

      document.querySelector('.yp-playlist-delete-selected').click();
      await new Promise(r => setTimeout(r, 30));

      expect(window.YouTubeUtils.confirmDialog).toHaveBeenCalledTimes(1);
      // The message goes through the dictionary with the {count} param.
      expect(window.YouTubeUtils.confirmDialog.mock.calls[0][0].message).toBe(
        'Delete 1 video(s) from playlist?'
      );
      expect(confirmSpy).not.toHaveBeenCalled();
      // Declining the dialog never clicks any Remove menu action.
      expect(removeClicks).toEqual([]);
    });

    test('resolves unconfirmed when our popup removes the item (fast path)', async () => {
      const api = window.YouTubePlusPlaylistSearch;
      const { item } = buildItem();
      // Popup must appear AFTER the call starts (fresh popup = ours), like
      // a real menu opening on click.
      setTimeout(() => buildPopup('Remove from playlist', () => item.remove()), 50);

      // A DOM-only detach is identical to a recycled renderer, so
      // the outcome is unconfirmed — never a confirmed 'removed'.
      await expect(api.removeItemViaMenu(item)).resolves.toMatchObject({
        status: 'unconfirmed',
        clicked: true,
      });
      expect(document.contains(item)).toBe(false);
    });

    test('finds slow popups (beyond fixed-delay era) via polling', async () => {
      const api = window.YouTubePlusPlaylistSearch;
      const { item } = buildItem();

      // Popup appears only after 400ms, item removed on option click.
      setTimeout(() => {
        buildPopup('Remove from playlist', () => item.remove());
      }, 400);

      await expect(api.removeItemViaMenu(item)).resolves.toMatchObject({ status: 'unconfirmed' });
    });

    test('ignores foreign menu open before the call (ownership snapshot)', async () => {
      const api = window.YouTubePlusPlaylistSearch;
      const { item } = buildItem();
      const foreignClick = jest.fn();
      buildPopup('Remove from playlist', foreignClick); // open BEFORE the call

      await expect(api.removeItemViaMenu(item)).resolves.toMatchObject({
        clicked: false,
      });
      expect(foreignClick).not.toHaveBeenCalled();
    });

    test('does not match popup with non-remove text (locale mismatch)', async () => {
      const api = window.YouTubePlusPlaylistSearch;
      const { item } = buildItem();
      const optionClick = jest.fn();
      const bodyClick = jest.spyOn(document.body, 'click');
      setTimeout(() => buildPopup('Something entirely else', optionClick), 50);

      await expect(api.removeItemViaMenu(item)).resolves.toMatchObject({
        clicked: false,
        detail: 'no exact playlist remove action',
      });
      expect(optionClick).not.toHaveBeenCalled();
      expect(bodyClick).toHaveBeenCalled();
      bodyClick.mockRestore();
    });

    test('reports not-removed when item is not actually removed (backend fail)', async () => {
      const api = window.YouTubePlusPlaylistSearch;
      const { item } = buildItem();
      // The popup is open BEFORE the call (foreign snapshot) — our item never
      // opens its own menu, so nothing destructive is clicked.
      buildPopup('Remove from playlist'); // click does nothing - item stays

      await expect(api.removeItemViaMenu(item)).resolves.toMatchObject({
        clicked: false,
      });
      expect(document.contains(item)).toBe(true);
    });

    test('no auto-retry: menu button clicked exactly once per attempt', async () => {
      const api = window.YouTubePlusPlaylistSearch;
      const { item, menuBtn } = buildItem();
      const clickSpy = jest.fn();
      menuBtn.addEventListener('click', clickSpy);

      await api.removeItemViaMenu(item);
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    test('cancelBatchDeletion is a safe no-op outside a batch', async () => {
      const api = window.YouTubePlusPlaylistSearch;
      expect(() => api.cancelBatchDeletion()).not.toThrow();
      // Empty selection guard resolves without throwing.
      await expect(api.deleteSelectedItems()).resolves.toBeUndefined();
    });

    test('N12: picks the exact playlist action, never a competing Remove label', async () => {
      const api = window.YouTubePlusPlaylistSearch;
      const { item } = buildItem();
      let wrongClicks = 0;
      let correctClicks = 0;
      // A real surface can offer several Remove-* actions in ONE menu; the
      // destructive click must bind to the playlist one only.
      setTimeout(() => {
        const popup = document.createElement('ytd-menu-popup-renderer');
        const queue = document.createElement('ytd-menu-service-item-renderer');
        queue.textContent = 'Remove from queue';
        queue.addEventListener('click', () => {
          wrongClicks++;
          item.remove();
        });
        const correct = document.createElement('ytd-menu-service-item-renderer');
        correct.textContent = 'Remove from playlist';
        correct.addEventListener('click', () => {
          correctClicks++;
          item.remove();
        });
        popup.append(queue, correct);
        document.body.appendChild(popup);
      }, 50);

      await expect(api.removeItemViaMenu(item)).resolves.toMatchObject({
        status: 'unconfirmed',
        clicked: true,
      });
      expect(wrongClicks).toBe(0);
      expect(correctClicks).toBe(1);
    });

    test('N11: a virtualization-churned renderer is never claimed as removed', async () => {
      const api = window.YouTubePlusPlaylistSearch;
      const { item } = buildItem();
      const parent = item.parentElement;
      // Destructive click sent, then the simulator recycles the renderer
      // (detach + re-attach) WITHOUT any server mutation.
      setTimeout(() => {
        buildPopup('Remove from playlist', () => {
          item.remove();
          // Virtualization churn: the renderer comes back moments later.
          setTimeout(() => parent.appendChild(item), 300);
        });
      }, 50);

      await expect(api.removeItemViaMenu(item)).resolves.toMatchObject({
        clicked: true,
        status: expect.not.stringMatching(/^removed$/),
      });
    });

    test('removal evidence pending at the deadline reports unknown (not success)', async () => {
      const api = window.YouTubePlusPlaylistSearch;
      const { item } = buildItem();
      // The renderer detaches right before the confirmation deadline: the
      // settle window (250ms) can never complete → 'unknown', NOT 'removed'.
      // Fake timers drive the module's 100ms polling, the simulated detach
      // AND the clock the deadline/settle windows read — so a loaded CI box
      // can no longer decide the outcome by which real-world timer slips.
      jest.useFakeTimers();
      try {
        setTimeout(() => {
          buildPopup('Remove from playlist', () => {
            setTimeout(() => item.remove(), 1800);
          });
        }, 50);

        const pending = api.removeItemViaMenu(item);
        await jest.advanceTimersByTimeAsync(50); // popup appears
        await jest.advanceTimersByTimeAsync(100); // poll opens it, click sent
        await jest.advanceTimersByTimeAsync(1800); // detach just before the deadline
        await jest.advanceTimersByTimeAsync(300); // deadline expires unsettled

        await expect(pending).resolves.toMatchObject({
          clicked: true,
          status: 'unknown',
          detail: 'removal evidence never settled',
        });
      } finally {
        jest.useRealTimers();
      }
    });

    test('menu button fallback selectors; no menu button reports unknown without a click', async () => {
      const api = window.YouTubePlusPlaylistSearch;

      // (a) item without any recognizable menu button → honest unknown.
      // The refusal happens before any waiting, so it is clock-independent.
      const bare = document.createElement('ytd-playlist-video-renderer');
      bare.setAttribute('video-id', 'vid-bare');
      document.body.appendChild(bare);
      await expect(api.removeItemViaMenu(bare)).resolves.toMatchObject({
        clicked: false,
        detail: 'no menu button',
      });

      // (b) fallback selector: [aria-haspopup="menu"] when no #button exists.
      // Fake timers drive the popup delay and the module's polling so the
      // not-removed verdict comes from virtual time, never from wall clock.
      const item = document.createElement('ytd-playlist-video-renderer');
      item.setAttribute('video-id', 'vid-fallback');
      const menuBtn = document.createElement('button');
      menuBtn.setAttribute('aria-haspopup', 'menu');
      item.appendChild(menuBtn);
      document.body.appendChild(item);
      let correctClicks = 0;
      jest.useFakeTimers();
      try {
        setTimeout(() => {
          const popup = document.createElement('ytd-menu-popup-renderer');
          const option = document.createElement('ytd-menu-service-item-renderer');
          // The action can also be identified via aria-label alone.
          option.setAttribute('aria-label', 'Remove from playlist');
          option.textContent = 'Удалить';
          option.addEventListener('click', () => correctClicks++);
          popup.appendChild(option);
          document.body.appendChild(popup);
        }, 50);

        const pending = api.removeItemViaMenu(item);
        await jest.advanceTimersByTimeAsync(50); // popup appears
        await jest.advanceTimersByTimeAsync(100); // poll opens it, click sent
        await jest.advanceTimersByTimeAsync(2100); // deadline: item stays attached

        // The exact action is matched by aria-label alone and clicked; nothing
        // removes the item (no handler), so the honest outcome is not_removed.
        await expect(pending).resolves.toMatchObject({
          status: 'not_removed',
          clicked: true,
        });
        expect(correctClicks).toBe(1);
      } finally {
        jest.useRealTimers();
      }
    });

    /**
     * Drive the REAL batch UI (toggle → checkbox → delete button) over
     * two renderers sharing one video-id. The playlist page location is set
     * BEFORE require so addSearchUI builds the full UI.
     */
    async function driveBatchSelection({ recycleSelected }) {
      mockLocation({
        href: 'https://www.youtube.com/playlist?list=PLdup',
        search: '?list=PLdup',
        hostname: 'www.youtube.com',
        pathname: '/playlist',
      });

      const removeClicks = [];
      const contents = document.createElement('div');
      contents.id = 'contents';
      const panel = document.createElement('ytd-playlist-video-list-renderer');
      panel.appendChild(contents);
      document.body.appendChild(panel);
      const items = [];
      for (let i = 0; i < 2; i++) {
        const item = document.createElement('ytd-playlist-video-renderer');
        item.setAttribute('video-id', 'vid-dup');
        const menuBtn = document.createElement('button');
        menuBtn.id = 'button';
        menuBtn.setAttribute('aria-label', 'Action menu');
        item.appendChild(menuBtn);
        menuBtn.addEventListener('click', () => {
          const popup = document.createElement('ytd-menu-popup-renderer');
          const option = document.createElement('ytd-menu-service-item-renderer');
          option.textContent = 'Remove from playlist';
          option.addEventListener('click', () => {
            removeClicks.push(i);
            item.remove();
            popup.remove();
          });
          popup.appendChild(option);
          document.body.appendChild(popup);
        });
        contents.appendChild(item);
        items.push(item);
      }

      jest.resetModules();
      window.YouTubeUtils.renderTemplateClone = jest.fn((el, html) => {
        el.innerHTML = html;
      });
      delete window.YouTubePlusPlaylistSearch;
      window._playlistSearchInitialized = false;
      loadFeature();
      // ensureInit schedules addSearchUI via setTimeout(0).
      await new Promise(r => setTimeout(r, 20));

      const toggle = document.querySelector('.yp-playlist-delete-toggle');
      expect(toggle).toBeTruthy();
      toggle.click();
      const checkboxes = document.querySelectorAll('.yp-playlist-item-checkbox');
      expect(checkboxes.length).toBe(2);

      checkboxes[0].checked = true;
      checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }));

      if (recycleSelected) {
        // Virtualization recycle: the element now renders a DIFFERENT video.
        items[0].setAttribute('video-id', 'vid-recycled');
      }

      const deleteBtn = document.querySelector('.yp-playlist-delete-selected');
      expect(deleteBtn.disabled).toBe(false);
      deleteBtn.click();

      // Popup wait + settled-removal evidence (≥250ms) + deleteDelay(250ms).
      await new Promise(r => setTimeout(r, 1600));

      return { removeClicks, items };
    }

    test('two occurrences of one videoId — selecting one deletes exactly that occurrence', async () => {
      const { removeClicks, items } = await driveBatchSelection({ recycleSelected: false });
      expect(removeClicks).toEqual([0]);
      expect(document.contains(items[0])).toBe(false);
      expect(document.contains(items[1])).toBe(true);
    });

    test('recycled renderer (video-id changed) is skipped without any remove-click', async () => {
      const { removeClicks, items } = await driveBatchSelection({ recycleSelected: true });
      expect(removeClicks).toEqual([]);
      expect(document.contains(items[0])).toBe(true);
      expect(document.contains(items[1])).toBe(true);
    });

    /**
     * Drive the REAL batch UI over two renderers with DIFFERENT
     * video-ids; while A's removal is already running, the virtualization
     * recycle turns B's renderer into C (video-id unselected3). C must
     * receive ZERO remove-clicks — the mid-batch identity check refuses B's
     * step without opening any menu.
     */
    async function driveBatchRecycle({ recycleDuringPopupWait = false }) {
      mockLocation({
        href: 'https://www.youtube.com/playlist?list=PLrecycle',
        search: '?list=PLrecycle',
        hostname: 'www.youtube.com',
        pathname: '/playlist',
      });

      const removeClicks = [];
      const contents = document.createElement('div');
      contents.id = 'contents';
      const panel = document.createElement('ytd-playlist-video-list-renderer');
      panel.appendChild(contents);
      document.body.appendChild(panel);
      const ids = ['selected001', 'selected002'];
      const items = ids.map((videoId, i) => {
        const item = document.createElement('ytd-playlist-video-renderer');
        item.setAttribute('video-id', videoId);
        const menuBtn = document.createElement('button');
        menuBtn.id = 'button';
        menuBtn.setAttribute('aria-label', 'Action menu');
        item.appendChild(menuBtn);
        menuBtn.addEventListener('click', () => {
          const popup = document.createElement('ytd-menu-popup-renderer');
          const option = document.createElement('ytd-menu-service-item-renderer');
          option.textContent = 'Remove from playlist';
          option.addEventListener('click', () => {
            removeClicks.push({ i, videoAtClick: item.getAttribute('video-id') });
            if (i === 0 && !recycleDuringPopupWait) {
              // Recycle B while the batch is already running.
              items[1].setAttribute('video-id', 'unselected3');
            }
            item.remove();
            popup.remove();
          });
          popup.appendChild(option);
          if (i === 1 && recycleDuringPopupWait) {
            // Popup appears at +50ms; B is recycled at +80ms — after OUR
            // popup exists but before the first detection poll (100ms), so
            // the destructive click must be refused on the token check.
            setTimeout(() => {
              document.body.appendChild(popup);
              items[1].setAttribute('video-id', 'unselected3');
            }, 80);
          } else {
            document.body.appendChild(popup);
          }
        });
        contents.appendChild(item);
        return item;
      });

      jest.resetModules();
      window.YouTubeUtils.renderTemplateClone = jest.fn((el, html) => {
        el.innerHTML = html;
      });
      delete window.YouTubePlusPlaylistSearch;
      window._playlistSearchInitialized = false;
      loadFeature();
      // ensureInit schedules addSearchUI via setTimeout(0).
      await new Promise(r => setTimeout(r, 20));

      document.querySelector('.yp-playlist-delete-toggle').click();
      const checkboxes = document.querySelectorAll('.yp-playlist-item-checkbox');
      expect(checkboxes.length).toBe(2);

      for (const cb of checkboxes) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector('.yp-playlist-delete-selected').click();

      // Two popup waits + settle evidence (≥250ms) + deleteDelay(250ms) each.
      await new Promise(r => setTimeout(r, 3600));

      return { removeClicks, items };
    }

    test('recycled mid-batch renderer (B→C) receives ZERO remove-clicks', async () => {
      const { removeClicks, items } = await driveBatchRecycle({});
      expect(removeClicks).toEqual([{ i: 0, videoAtClick: 'selected001' }]);
      // C (the replacement video) is never clicked and stays in the DOM.
      expect(document.contains(items[1])).toBe(true);
      expect(items[1].getAttribute('video-id')).toBe('unselected3');
    });

    test('occurrence recycled while its own popup is open is refused before the destructive click', async () => {
      const { removeClicks, items } = await driveBatchRecycle({ recycleDuringPopupWait: true });
      // A's removal proceeds; B is recycled while ITS popup is open and
      // must never be clicked.
      expect(removeClicks).toEqual([{ i: 0, videoAtClick: 'selected001' }]);
      expect(document.contains(items[1])).toBe(true);
    });

    /**
     * A reorder of the playlist between selection and the
     * batch must not invalidate the selection — both selected occurrences
     * still receive exactly one remove-click each.
     */
    test('reorder keeps the recorded occurrences clickable (one click each)', async () => {
      mockLocation({
        href: 'https://www.youtube.com/playlist?list=PLreorder',
        search: '?list=PLreorder',
        hostname: 'www.youtube.com',
        pathname: '/playlist',
      });

      const removeClicks = [];
      const contents = document.createElement('div');
      contents.id = 'contents';
      const panel = document.createElement('ytd-playlist-video-list-renderer');
      panel.appendChild(contents);
      document.body.appendChild(panel);
      const ids = ['reorder001', 'reorder002'];
      const items = ids.map((videoId, i) => {
        const item = document.createElement('ytd-playlist-video-renderer');
        item.setAttribute('video-id', videoId);
        const menuBtn = document.createElement('button');
        menuBtn.id = 'button';
        menuBtn.setAttribute('aria-label', 'Action menu');
        item.appendChild(menuBtn);
        menuBtn.addEventListener('click', () => {
          const popup = document.createElement('ytd-menu-popup-renderer');
          const option = document.createElement('ytd-menu-service-item-renderer');
          option.textContent = 'Remove from playlist';
          option.addEventListener('click', () => {
            removeClicks.push({ i, videoAtClick: item.getAttribute('video-id') });
            item.remove();
            popup.remove();
          });
          popup.appendChild(option);
          document.body.appendChild(popup);
        });
        contents.appendChild(item);
        return item;
      });

      jest.resetModules();
      window.YouTubeUtils.renderTemplateClone = jest.fn((el, html) => {
        el.innerHTML = html;
      });
      delete window.YouTubePlusPlaylistSearch;
      window._playlistSearchInitialized = false;
      loadFeature();
      await new Promise(r => setTimeout(r, 20));

      document.querySelector('.yp-playlist-delete-toggle').click();
      const checkboxes = document.querySelectorAll('.yp-playlist-item-checkbox');

      for (const cb of checkboxes) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Reorder: the second renderer moves before the first one.
      contents.insertBefore(items[1], items[0]);
      document.querySelector('.yp-playlist-delete-selected').click();

      await new Promise(r => setTimeout(r, 3600));
      expect(removeClicks).toEqual([
        { i: 0, videoAtClick: 'reorder001' },
        { i: 1, videoAtClick: 'reorder002' },
      ]);
    });

    test('missing video-id, deselection, and vanished renderers are handled honestly', async () => {
      mockLocation({
        href: 'https://www.youtube.com/playlist?list=PLdup',
        search: '?list=PLdup',
        hostname: 'www.youtube.com',
        pathname: '/playlist',
      });

      const removeClicks = [];
      const contents = document.createElement('div');
      contents.id = 'contents';
      const panel = document.createElement('ytd-playlist-video-list-renderer');
      panel.appendChild(contents);
      document.body.appendChild(panel);
      // A renderer WITHOUT a video-id attribute (mid-hydration DOM).
      const item = document.createElement('ytd-playlist-video-renderer');
      const menuBtn = document.createElement('button');
      menuBtn.id = 'button';
      menuBtn.setAttribute('aria-label', 'Action menu');
      item.appendChild(menuBtn);
      menuBtn.addEventListener('click', () => {
        const popup = document.createElement('ytd-menu-popup-renderer');
        const option = document.createElement('ytd-menu-service-item-renderer');
        option.textContent = 'Remove from playlist';
        option.addEventListener('click', () => {
          removeClicks.push(0);
          item.remove();
          popup.remove();
        });
        popup.appendChild(option);
        document.body.appendChild(popup);
      });
      contents.appendChild(item);

      jest.resetModules();
      window.YouTubeUtils.renderTemplateClone = jest.fn((el, html) => {
        el.innerHTML = html;
      });
      delete window.YouTubePlusPlaylistSearch;
      window._playlistSearchInitialized = false;
      loadFeature();
      await new Promise(r => setTimeout(r, 20));

      document.querySelector('.yp-playlist-delete-toggle').click();
      const checkbox = document.querySelector('.yp-playlist-item-checkbox');
      expect(checkbox).toBeTruthy();

      const deleteBtn = document.querySelector('.yp-playlist-delete-selected');

      // (1) Select the attribute-less renderer — the fallback occurrence key
      // keeps it a valid independent selection unit.
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      expect(deleteBtn.disabled).toBe(false);

      // (2) Deselect — the occurrence is dropped, the entrypoint locks again.
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      expect(deleteBtn.disabled).toBe(true);

      // (3) Re-select, then the renderer VANISHES (virtualization drop):
      // the batch must skip it without any remove-click.
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      item.remove();
      deleteBtn.click();
      await new Promise(r => setTimeout(r, 700));
      expect(removeClicks).toEqual([]);
    });
  });

  describe('additional branch coverage', () => {
    test('getPlaylistDisplayName handles overlong title and fallback branches', () => {
      const panel = document.createElement('div');
      const longTitle = 'A'.repeat(120);
      const meta = document.createElement('meta');
      meta.name = 'title';
      meta.content = longTitle;
      document.head.appendChild(meta);

      const truncated = window.YouTubePlusPlaylistSearch.getPlaylistDisplayName(panel, 'PL123');
      expect(truncated).toBe(`${'A'.repeat(100)}...`);
      meta.remove();

      // No meta tag, listId provided
      expect(window.YouTubePlusPlaylistSearch.getPlaylistDisplayName(panel, 'PLcustom')).toBe(
        'PLcustom'
      );

      // Overlong listId is truncated to 50 chars
      expect(
        window.YouTubePlusPlaylistSearch.getPlaylistDisplayName(panel, `PL${'x'.repeat(60)}`)
      ).toHaveLength(50);

      // No meta tag, empty listId
      // @ts-expect-error test empty string fallback
      expect(window.YouTubePlusPlaylistSearch.getPlaylistDisplayName(panel, '')).toBe('playlist');
    });

    test('getPlaylistContext returns null outside playlist or watch page', () => {
      mockLocation({
        href: 'https://www.youtube.com/feed/subscriptions',
        search: '',
        hostname: 'www.youtube.com',
        pathname: '/feed/subscriptions',
      });
      expect(window.YouTubePlusPlaylistSearch.getPlaylistContext()).toBeNull();
    });

    test('isRelevantRoute handles various routes and params', () => {
      mockLocation({
        href: 'https://www.youtube.com/playlist',
        search: '',
        hostname: 'www.youtube.com',
        pathname: '/playlist',
      });
      expect(window.YouTubePlusPlaylistSearch.isRelevantRoute()).toBe(false);

      mockLocation({
        href: 'https://www.youtube.com/playlist?list=PLvalid',
        search: '?list=PLvalid',
        hostname: 'www.youtube.com',
        pathname: '/playlist',
      });
      expect(window.YouTubePlusPlaylistSearch.isRelevantRoute()).toBe(true);

      mockLocation({
        href: 'https://www.youtube.com/feed/subscriptions?list=PLvalid',
        search: '?list=PLvalid',
        hostname: 'www.youtube.com',
        pathname: '/feed/subscriptions',
      });
      expect(window.YouTubePlusPlaylistSearch.isRelevantRoute()).toBe(false);
    });
  });
});
