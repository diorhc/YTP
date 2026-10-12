/**
 * Playlist batch deletion is a
 * cancellable operation with explicit popup ownership and item identity.
 *
 * Contracts under test (real playlist-search module; only the YouTube page
 * DOM itself is simulated):
 *   - Cancel (Stop / navigation) must be honored at every await/poll and
 *     IMMEDIATELY BEFORE the destructive click — a popup that appears after
 *     the cancel must never be clicked, and the operation must not report
 *     success.
 *   - Popup ownership: an already-open foreign popup is skipped; a reused
 *     YouTube popup that existed HIDDEN before our click and became visible
 *     afterwards IS ours; a popup opened by a foreign gesture after our
 *     click must never be clicked.
 *   - Completion must be proven (our element gone in an unchanged playlist
 *     context), not assumed from any DOM disappearance: navigation during
 *     the wait must not claim success.
 *   - Identity: distinct DOM items with the same video-id are independent;
 *   - A cancel must not poison a later operation (stale operation id is
 *     discarded).
 */

describe('cancellable playlist item removal', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/playlist',
      href: 'https://www.youtube.com/playlist?list=PLtest',
    });
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/playlist-search.js');
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  const advance = async ms => {
    jest.advanceTimersByTime(ms);
    // Flush the microtask queue so promise callbacks settle.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  const makeItem = (videoId, onMenuClick) => {
    const item = document.createElement('div');
    item.setAttribute('video-id', videoId);
    item.innerHTML = '<button id="button" aria-label="Menu"></button>';
    const menuBtn = item.firstChild;
    if (onMenuClick) {
      menuBtn.addEventListener('click', () => onMenuClick(item));
    }
    document.body.append(item);
    return item;
  };

  const makePopup = ({ visible = true, hiddenAttr = false } = {}) => {
    const popup = document.createElement('ytd-menu-popup-renderer');
    popup.innerHTML =
      '<ytd-menu-service-item-renderer>Remove from playlist</ytd-menu-service-item-renderer>';
    const removeOption = popup.firstChild;
    if (hiddenAttr) popup.setAttribute('hidden', '');
    if (visible) document.body.append(popup);
    return { popup, removeOption };
  };

  test('cancel before the popup appears prevents the destructive click', async () => {
    const api = window.YouTubePlusPlaylistSearch;
    let clicked = 0;
    const item = makeItem('vid1', () => {
      setTimeout(() => {
        const { popup, removeOption } = makePopup();
        removeOption.addEventListener('click', () => {
          clicked++;
          item.remove();
        });
        document.body.append(popup);
      }, 150);
    });

    const pending = api.removeItemViaMenu(item);
    api.cancelBatchDeletion();
    // Popup appears AFTER the cancel was issued.
    await advance(200);
    await advance(200);
    const result = await pending;

    expect(clicked).toBe(0);
    expect(result).toMatchObject({ clicked: false });
  });

  test('cancel issued as the popup appears is checked immediately before the click', async () => {
    const api = window.YouTubePlusPlaylistSearch;
    let clicked = 0;
    const item = makeItem('vid1', () => {
      setTimeout(() => {
        const { popup, removeOption } = makePopup();
        removeOption.addEventListener('click', () => {
          clicked++;
          item.remove();
        });
        document.body.append(popup);
        // User hits Stop at the exact moment the menu appeared.
        api.cancelBatchDeletion();
      }, 150);
    });

    const pending = api.removeItemViaMenu(item);
    await advance(200);
    await advance(200);
    const result = await pending;

    expect(clicked).toBe(0);
    expect(result).toMatchObject({ clicked: false });
  });

  test('a reused YouTube popup that becomes visible after our click IS ours', async () => {
    const api = window.YouTubePlusPlaylistSearch;
    let clicked = 0;
    // YouTube reuses one popup element: it exists HIDDEN before our click.
    const { popup, removeOption } = makePopup({ hiddenAttr: true });
    removeOption.addEventListener('click', () => {
      clicked++;
      item.remove();
    });
    document.body.append(popup);

    const item = makeItem('vid1', () => {
      setTimeout(() => {
        popup.removeAttribute('hidden');
      }, 150);
    });

    const pending = api.removeItemViaMenu(item);
    await advance(200);
    await advance(2200);
    const result = await pending;
    expect(clicked).toBe(1);
    expect(result).toMatchObject({ status: 'unconfirmed', clicked: true });
  });

  test('an already-open foreign popup is never clicked', async () => {
    const api = window.YouTubePlusPlaylistSearch;
    let foreignClicked = 0;
    // Foreign popup visible BEFORE our flow starts.
    const { popup, removeOption } = makePopup();
    removeOption.addEventListener('click', () => {
      foreignClicked++;
    });
    document.body.append(popup);

    const item = makeItem('vid1'); // our menu never opens anything
    const pending = api.removeItemViaMenu(item);
    await advance(2200);
    const result = await pending;

    expect(foreignClicked).toBe(0);
    expect(result).toMatchObject({ clicked: false });
  });

  test('a foreign NEW popup opened by another gesture after our click is not clicked', async () => {
    const api = window.YouTubePlusPlaylistSearch;
    let foreignClicked = 0;
    const item = makeItem('vid1');
    // Another surface reacts to *some* gesture while we wait: a foreign
    // click on a different element, then its own popup with a Remove entry.
    const foreignBtn = document.createElement('button');
    document.body.append(foreignBtn);
    foreignBtn.addEventListener('click', () => {
      setTimeout(() => {
        const { popup, removeOption } = makePopup();
        removeOption.addEventListener('click', () => {
          foreignClicked++;
        });
        document.body.append(popup);
      }, 50);
    });

    const pending = api.removeItemViaMenu(item);
    await advance(100);
    foreignBtn.click(); // foreign gesture
    await advance(300);
    await advance(2200);
    const result = await pending;

    expect(foreignClicked).toBe(0);
    expect(result).toMatchObject({ clicked: false });
  });

  test('navigation during the removal wait must not claim success', async () => {
    const api = window.YouTubePlusPlaylistSearch;
    let clicked = 0;
    const item = makeItem('vid1', () => {
      setTimeout(() => {
        const { popup, removeOption } = makePopup();
        removeOption.addEventListener('click', () => {
          clicked++;
          // The backend processes the request with a delay: the node
          // disappears well AFTER the navigation started, so the
          // disappearance is indistinguishable from navigation-driven DOM
          // recycling.
          setTimeout(() => item.remove(), 400);
        });
        document.body.append(popup);
      }, 150);
    });

    const pending = api.removeItemViaMenu(item);
    await advance(200); // popup opens
    await advance(200); // remove option clicked; item still present
    // Navigation happens between the sent click and the node disappearing.
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/',
      href: 'https://www.youtube.com/',
    });
    await advance(300); // item disappears under the new route
    await advance(2400); // removal deadline elapses under the new route
    const result = await pending;

    // The click was already sent (cannot be un-sent), but success must NOT
    // be claimed: the disappearance is indistinguishable from navigation.
    expect(clicked).toBe(1);
    expect(result).toMatchObject({ status: 'not_removed', clicked: true });
  });

  test('same video-id on distinct items: removing item1 does not satisfy item2', async () => {
    const api = window.YouTubePlusPlaylistSearch;
    const container = document.createElement('div');
    document.body.append(container);
    let item2Clicked = 0;

    const item1 = makeItem('dupvid', it => {
      setTimeout(() => {
        const { popup, removeOption } = makePopup();
        removeOption.addEventListener('click', () => {
          it.remove();
        });
        document.body.append(popup);
      }, 150);
    });
    container.append(item1);
    const item2 = makeItem('dupvid', it => {
      setTimeout(() => {
        const { popup, removeOption } = makePopup();
        removeOption.addEventListener('click', () => {
          item2Clicked++;
          it.remove();
        });
        document.body.append(popup);
      }, 150);
    });
    container.append(item2);

    const pending = api.removeItemViaMenu(item1);
    await advance(200);
    await advance(200);
    // Settle window — the removal must hold for ~300ms more.
    await advance(400);
    const result1 = await pending;
    expect(result1).toMatchObject({ status: 'unconfirmed', clicked: true });
    // item2 is still exactly where it was — element identity, not id match.
    expect(container.contains(item2)).toBe(true);
    expect(item2Clicked).toBe(0);
  });

  test('unsuccessful backend (option clicked, item not removed) reports failure', async () => {
    const api = window.YouTubePlusPlaylistSearch;
    let clicked = 0;
    const item = makeItem('vid1', () => {
      setTimeout(() => {
        const { popup, removeOption } = makePopup();
        removeOption.addEventListener('click', () => {
          clicked++;
          // Backend rejects the removal: item stays in the DOM.
        });
        document.body.append(popup);
      }, 150);
    });

    const pending = api.removeItemViaMenu(item);
    await advance(200);
    await advance(2200);
    const result = await pending;

    expect(clicked).toBe(1);
    expect(result).toMatchObject({ status: 'not_removed', clicked: true });
  });

  test('a stale cancel does not poison the next operation', async () => {
    const api = window.YouTubePlusPlaylistSearch;
    let clicked = 0;
    const item = makeItem('vid1', () => {
      setTimeout(() => {
        const { popup, removeOption } = makePopup();
        removeOption.addEventListener('click', () => {
          clicked++;
          item.remove();
        });
        document.body.append(popup);
      }, 150);
    });

    // Operation 1: cancelled before its popup appears.
    const pending1 = api.removeItemViaMenu(item);
    api.cancelBatchDeletion();
    await advance(200);
    await advance(200);
    const result1 = await pending1;
    expect(result1).toMatchObject({ clicked: false });
    expect(clicked).toBe(0);

    // Operation 2 (new operation id): must run normally and confirm.
    const item2 = makeItem('vid2', () => {
      setTimeout(() => {
        const { popup, removeOption } = makePopup();
        removeOption.addEventListener('click', () => {
          clicked++;
          item2.remove();
        });
        document.body.append(popup);
      }, 150);
    });
    const pending2 = api.removeItemViaMenu(item2);
    await advance(200);
    await advance(200);
    // The settle window needs the removal to hold for ~300ms more.
    await advance(400);
    const result2 = await pending2;
    expect(clicked).toBe(1);
    expect(result2).toMatchObject({ status: 'unconfirmed', clicked: true });
  });
});
