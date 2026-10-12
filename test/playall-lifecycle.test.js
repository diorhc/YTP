/**
 * Play All (src/playall.js) on the FeatureLifecycle contract
 * (feature-registry.js). Real CleanupManager, SettingsStore, EventDelegation,
 * MutationCoordinator and DesignSystem; only the network layer behind
 * resolveChannelIdWithRetry stays on the mock-YouTubeUtils surface the module
 * reads.
 * @jest-environment jsdom
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
  require('../src/mutation-coordinator.js');
}

const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;
const store = () => window.YouTubePlusSettingsStore;

function counts() {
  const cm = window.YouTubePlusCleanupManager;
  return {
    listeners: cm.getListenerStats().active,
    observers: cm.observers.size,
    timeouts: cm.timeouts.size + cm.sessionTimeouts.size,
    watchers: window.YouTubePlusMutationCoordinator.getStats().rootSubscribers,
    delegated: window.YouTubePlusEventDelegation?.getStats?.().totalHandlers ?? 0,
  };
}

/** Channel-style page in the dom with a chip bar + grid and channel meta. */
function mountChannelPage() {
  document.head.innerHTML =
    '<meta itemprop="channelId" content="UC1234567890123456789012"><link rel="canonical" href="">';
  const grid = document.createElement('ytd-rich-grid-renderer');
  const chipBar = document.createElement('chip-bar-view-model');
  chipBar.className = 'ytChipBarViewModelHost';
  grid.appendChild(chipBar);
  document.body.appendChild(grid);
  const app = document.createElement('ytd-app');
  app.appendChild(document.createElement('div'));
  document.body.appendChild(app);
}

describe('playall on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.YouTubePlusPlayall;

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/@channel/videos',
      href: 'https://www.youtube.com/@channel/videos',
    });

    loadChain();
    store().set('enablePlayAll', false);
    mountChannelPage();
    require('../src/playall.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
    jest.useRealTimers();
  });

  /** Wait for the scheduler-driven button (created ~120ms after start). */
  const waitBtn = async () => {
    for (let i = 0; i < 30; i++) {
      const el = document.querySelector('.yp-play-all-btn');
      if (el) return el;
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  };

  test('10 on/off cycles return to the starting counts and leave no button or CSS', async () => {
    store().set('enablePlayAll', true);
    expect(lifecycle().isRunning('playall')).toBe(true);
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-play-all-styles')).toBe(true);

    // resolveChannelIdWithRetry retries on timers before the button appears.
    const btn = await waitBtn();
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('href')).toContain('list=UULF1234567890123456789012');

    store().set('enablePlayAll', false);
    expect(lifecycle().isRunning('playall')).toBe(false);
    expect(document.querySelector('.yp-play-all-btn')).toBeNull();
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-play-all-styles')).toBe(false);

    const baseline = counts();
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');

    for (let i = 0; i < 10; i++) {
      store().set('enablePlayAll', true);
      expect(await waitBtn()).not.toBeNull();
      store().set('enablePlayAll', false);
      expect(document.querySelector('.yp-play-all-btn')).toBeNull();
    }

    expect(counts()).toEqual(baseline);
    expect([...document.querySelectorAll('style')].map(s => s.textContent).join('\n')).toBe(css);
    expect(
      document.querySelectorAll('.yp-play-all-btn, .yp-random-badge, .yp-random-notice')
    ).toHaveLength(0);
  });

  test('chip selection work is owned by the feature through the observer', async () => {
    store().set('enablePlayAll', true);
    await waitBtn();
    expect(document.querySelector('.yp-play-all-btn')).not.toBeNull();
    expect(window.YouTubePlusMutationCoordinator.getStats().rootSubscribers).toBe(1);

    // Mutating the grid re-runs the feature work through the owned observer.
    document
      .querySelector('ytd-rich-grid-renderer')
      .dispatchEvent(new CustomEvent('noop', { bubbles: true }));

    // The button stays unique and the watch is still the same subscription.
    await new Promise(r => setTimeout(r, 50));
    expect(document.querySelectorAll('.yp-play-all-btn')).toHaveLength(1);

    // Off removes the button and the watch; on re-adds both.
    store().set('enablePlayAll', false);
    expect(window.YouTubePlusMutationCoordinator.getStats().rootSubscribers).toBe(0);

    store().set('enablePlayAll', true);
    await waitBtn();
    const btnAgain = document.querySelector('.yp-play-all-btn');
    expect(btnAgain).not.toBeNull();
    expect(btnAgain.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('playall random-play ownership on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.YouTubePlusPlayall;

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLTEST123&ytp-random=random',
    });
    document.body.innerHTML =
      '<div id="secondary"><ytd-playlist-panel-renderer><div id="header"></div><div id="items"></div></ytd-playlist-panel-renderer></div>';

    loadChain();
    store().set('enablePlayAll', true);
    require('../src/playall.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('random panel attributes and badge go away when the feature stops', async () => {
    const panel = document.querySelector('#secondary ytd-playlist-panel-renderer');
    document.querySelector('#secondary video') ||
      document.body.appendChild(document.createElement('video'));

    await new Promise(r => setTimeout(r, 600));
    expect(panel.hasAttribute('ytp-random')).toBe(true);
    expect(document.querySelector('.yp-random-notice')).not.toBeNull();

    store().set('enablePlayAll', false);
    expect(panel.hasAttribute('ytp-random')).toBe(false);
    expect(panel.hasAttribute('data-yp-random-delegated')).toBe(false);
    expect(document.querySelector('.yp-random-notice')).toBeNull();
    expect(document.querySelector('.yp-random-badge')).toBeNull();
    expect(lifecycle().isRunning('playall')).toBe(false);
  });
});

describe('playall random-play hotkey on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.YouTubePlusPlayall;

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLTEST123&ytp-random=random',
    });
    document.body.innerHTML =
      '<div id="secondary"><ytd-playlist-panel-renderer><div id="header"></div><div id="wrapper"><a id="wc-endpoint" href="/watch?v=dQw4w9WgXcQ&list=PLTEST123&ytp-random=random"></a></div></ytd-playlist-panel-renderer></div><video></video>';

    loadChain();
    store().set('enablePlayAll', true);
    require('../src/playall.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('Shift+N marks the current video as watched and hides its playlist endpoint', async () => {
    await new Promise(r => setTimeout(r, 600));

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'n', shiftKey: true, bubbles: true, cancelable: true })
    );

    const storage = JSON.parse(localStorage.getItem('ytp-random-PLTEST123') || '{}');
    expect(storage.dQw4w9WgXcQ).toBe(true);
    expect(document.querySelector('#wrapper').getAttribute('hidden')).toBe('');
  });
});

describe('playall random-play badge on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.YouTubePlusPlayall;

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLTEST123&ytp-random=random',
    });
    document.body.innerHTML =
      '<div id="secondary"><ytd-playlist-panel-renderer><h3><a href="/playlist?list=PLTEST123"></a></h3><div id="items"><a id="wc-endpoint" href="/watch?v=AAAAAAAAAAA&list=PLTEST123"></a></div></ytd-playlist-panel-renderer></div><video></video>';

    loadChain();
    store().set('enablePlayAll', true);
    require('../src/playall.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('renders the random badge and removes it when the feature stops', async () => {
    await new Promise(r => setTimeout(r, 600));
    expect(document.querySelector('.yp-random-badge')).not.toBeNull();

    store().set('enablePlayAll', false);
    expect(document.querySelector('.yp-random-badge')).toBeNull();
  });

  /** Records full page loads instead of performing them. */
  const watchNavigation = () => {
    const spy = jest.spyOn(window.YouTubeUtils, 'navigateTo').mockImplementation(() => undefined);
    return () => {
      const started = spy.mock.calls.length > 0;
      spy.mockRestore();
      return started;
    };
  };

  test('clicking the badge close clears the flag and leaves the random mode', async () => {
    const navigated = watchNavigation();
    await new Promise(r => setTimeout(r, 600));

    const close = document.querySelector('.yp-random-badge-close');
    expect(close).not.toBeNull();
    close.click();
    await new Promise(r => setTimeout(r, 50));

    expect(navigated()).toBe(true);
  });

  test('a watched current video takes the random redirect path', async () => {
    const h = window.YouTubePlusPlayall.testHooks;
    const navigated = watchNavigation();
    await new Promise(r => setTimeout(r, 600));

    // Mark the current video watched, then re-apply the random play.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'n', shiftKey: true, bubbles: true, cancelable: true })
    );
    h.scheduleApplyRandomPlay();
    await new Promise(r => setTimeout(r, 500));

    expect(navigated()).toBe(true);
  });

  test('progress tracking and the next-button hijack run on a watch page', async () => {
    const player = document.createElement('div');
    player.id = 'movie_player';
    player.getProgressState = () => ({ current: 99, duration: 100 });
    player.pauseVideo = () => undefined;
    player.seekTo = () => undefined;
    document.body.appendChild(player);

    const host = document.createElement('div');
    host.id = 'ytd-player';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'ytp-next-button ytp-button';
    host.appendChild(nextBtn);
    document.body.appendChild(host);

    window.YouTubePlusPlayall.testHooks.scheduleApplyRandomPlay();
    await new Promise(r => setTimeout(r, 400));

    document.querySelector('video')?.dispatchEvent(new Event('timeupdate'));
    await new Promise(r => setTimeout(r, 100));

    expect(document.querySelector('[ytp-random="applied"]')).not.toBeNull();
  });

  test('the next button stays native until the player reports progress', async () => {
    const player = document.createElement('div');
    player.id = 'movie_player';
    document.body.appendChild(player);

    const host = document.createElement('div');
    host.id = 'ytd-player';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'ytp-next-button ytp-button';
    host.appendChild(nextBtn);
    document.body.appendChild(host);

    window.YouTubePlusPlayall.testHooks.scheduleApplyRandomPlay();
    await new Promise(r => setTimeout(r, 400));

    document.querySelector('video')?.dispatchEvent(new Event('timeupdate'));
    await new Promise(r => setTimeout(r, 100));

    expect(document.querySelector('#ytd-player [ytp-random="applied"]')).toBeNull();
    expect(nextBtn.isConnected).toBe(true);
  });
});

/** Wait for the scheduler-driven button (created ~120ms after start). */
const waitChannelButton = async () => {
  for (let i = 0; i < 30; i++) {
    const el = document.querySelector('.yp-play-all-btn');
    if (el) return el;
    await new Promise(r => setTimeout(r, 50));
  }
  return null;
};

describe('playall button behaviour on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML =
      '<meta itemprop="channelId" content="UC1234567890123456789012"><link rel="canonical" href="https://www.youtube.com/@channel/videos">';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.YouTubePlusPlayall;

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/@channel/videos',
      href: 'https://www.youtube.com/@channel/videos',
    });
    const grid = document.createElement('ytd-rich-grid-renderer');
    const chipBar = document.createElement('chip-bar-view-model');
    chipBar.className = 'ytChipBarViewModelHost';
    grid.appendChild(chipBar);
    document.body.appendChild(grid);
    const app = document.createElement('ytd-app');
    app.appendChild(document.createElement('div'));
    document.body.appendChild(app);

    loadChain();
    store().set('enablePlayAll', false);
    require('../src/playall.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('button gets the expected tag, class and aria-label', async () => {
    store().set('enablePlayAll', true);
    const btn = await waitChannelButton();
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe('A');
    expect(btn.classList.contains('yp-btn')).toBe(true);
    expect(btn.hasAttribute('aria-label')).toBe(true);
  });

  test('restarting the feature leaves exactly one button', async () => {
    store().set('enablePlayAll', true);
    await waitChannelButton();
    store().set('enablePlayAll', false);
    expect(document.querySelector('.yp-play-all-btn')).toBeNull();
    store().set('enablePlayAll', true);
    await waitChannelButton();
    expect(document.querySelectorAll('.yp-play-all-btn')).toHaveLength(1);
  });

  test('a navigation on a channel page re-queues the button', async () => {
    store().set('enablePlayAll', true);
    await waitChannelButton();
    document.querySelector('.yp-play-all-btn')?.remove();
    document.dispatchEvent(new Event('yt-navigate-finish'));
    expect(await waitChannelButton()).not.toBeNull();
  });

  test('navigation and visibility events re-run the feature work', async () => {
    store().set('enablePlayAll', true);
    await waitChannelButton();

    document.dispatchEvent(new Event('yt-navigate-start'));
    document.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('yt-page-data-updated'));
    document.dispatchEvent(new Event('yt-page-data-fetched'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('yp:nav-refresh'));
    await new Promise(r => setTimeout(r, 250));

    expect(document.querySelector('.yp-play-all-btn')).not.toBeNull();
  });

  test('falls back to a grid container when the chip bar never appears', () => {
    const h = window.YouTubePlusPlayall.testHooks;
    store().set('enablePlayAll', true);
    h.setId('UC1234567890123456789012');
    // A grid without a chip bar, at the retry limit, takes the fallback path.
    document.querySelector('chip-bar-view-model')?.remove();
    h.apply(8);

    expect(document.querySelector('.yp-button-container')).not.toBeNull();
    expect(document.querySelector('.yp-play-all-btn')).not.toBeNull();
  });

  test('fetchChannelId_ skips non-YouTube hosts', async () => {
    global.mockLocation({ hostname: 'evil.example', pathname: '/', href: 'https://evil.example/' });
    await expect(window.YouTubePlusPlayall.testHooks.fetchChannelId_()).resolves.toBeNull();
  });

  test('fetchChannelId_ reads the canonical link from the fetched HTML', async () => {
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/@x/videos',
      href: 'https://www.youtube.com/@x/videos',
    });
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      text: async () =>
        '<link rel="canonical" href="https://www.youtube.com/channel/UC1234567890123456789012">',
    }));
    try {
      await expect(window.YouTubePlusPlayall.testHooks.fetchChannelId_()).resolves.toBe(
        'UC1234567890123456789012'
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('fetchChannelId_ falls back to the channelId JSON when canonical is absent', async () => {
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/@x/videos',
      href: 'https://www.youtube.com/@x/videos',
    });
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      text: async () => '"channelId":"UC1234567890123456789012"',
    }));
    try {
      await expect(window.YouTubePlusPlayall.testHooks.fetchChannelId_()).resolves.toBe(
        'UC1234567890123456789012'
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('playall route gating on the lifecycle contract', () => {
  const goTo = url => {
    const u = new URL(url);
    global.mockLocation({
      hostname: u.hostname,
      pathname: u.pathname,
      search: u.search,
      href: u.href,
    });
  };
  const navigate = url => {
    goTo(url);
    window.dispatchEvent(new CustomEvent('yp-history-navigate', { detail: { type: 'navigate' } }));
  };
  const waitButton = async () => {
    for (let i = 0; i < 30; i++) {
      const el = document.querySelector('.yp-play-all-btn');
      if (el) return el;
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  };

  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.YouTubePlusPlayall;

    goTo('https://www.youtube.com/');
    loadChain();
    store().set('enablePlayAll', true);
    mountChannelPage();
    require('../src/playall.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('stays stopped on the home page: no styles, listeners or grid observer', () => {
    const baseline = counts();
    expect(lifecycle().isRunning('playall')).toBe(false);
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-play-all-styles')).toBe(false);
    expect(counts()).toEqual(baseline);
    expect(window.YouTubePlusMutationCoordinator.getStats().rootSubscribers).toBe(0);
    expect(document.querySelector('.yp-play-all-btn')).toBeNull();
  });

  test('starts on a channel Videos tab', async () => {
    navigate('https://www.youtube.com/@channel/videos');
    expect(lifecycle().isRunning('playall')).toBe(true);
    expect(await waitButton()).not.toBeNull();
  });

  test('leaving the channel tab stops it and restores YouTube markup', async () => {
    navigate('https://www.youtube.com/@channel/videos');
    expect(await waitButton()).not.toBeNull();

    navigate('https://www.youtube.com/results?search_query=x');
    expect(lifecycle().isRunning('playall')).toBe(false);
    expect(document.querySelector('.yp-play-all-btn')).toBeNull();
    expect(document.querySelector('.yp-play-all-parent')).toBeNull();
    expect(window.YouTubePlusMutationCoordinator.getStats().rootSubscribers).toBe(0);
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-play-all-styles')).toBe(false);
  });

  test('runs on a watch URL only when the ytp-random query is present', () => {
    navigate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(lifecycle().isRunning('playall')).toBe(false);

    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="secondary"><ytd-playlist-panel-renderer><div id="header"></div><div id="items"></div></ytd-playlist-panel-renderer></div>'
    );
    navigate('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLTEST123&ytp-random=random');
    expect(lifecycle().isRunning('playall')).toBe(true);

    navigate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(lifecycle().isRunning('playall')).toBe(false);
  });
});

describe('playall grid observer rebuild gating on the lifecycle contract', () => {
  const frame = () => new Promise(r => setTimeout(r, 60));

  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML =
      '<meta itemprop="channelId" content="UC1234567890123456789012"><link rel="canonical" href="https://www.youtube.com/@channel/videos">';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.YouTubePlusPlayall;

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/@channel/videos',
      href: 'https://www.youtube.com/@channel/videos',
    });
    const grid = document.createElement('ytd-rich-grid-renderer');
    const chipBar = document.createElement('chip-bar-view-model');
    chipBar.className = 'ytChipBarViewModelHost';
    grid.appendChild(chipBar);
    document.body.appendChild(grid);
    const app = document.createElement('ytd-app');
    app.appendChild(document.createElement('div'));
    document.body.appendChild(app);

    loadChain();
    store().set('enablePlayAll', false);
    require('../src/playall.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('an attribute change on the chip does not rebuild the button', async () => {
    store().set('enablePlayAll', true);
    const btn = await waitChannelButton();
    expect(btn).not.toBeNull();

    const chip = document.querySelector('chip-bar-view-model');
    chip.setAttribute('aria-selected', 'true');
    chip.classList.add('iron-selected');
    await frame();

    expect(document.querySelector('.yp-play-all-btn')).toBe(btn);
    expect(document.querySelectorAll('.yp-play-all-btn')).toHaveLength(1);
  });

  test('removing the button from the grid brings it back exactly once', async () => {
    store().set('enablePlayAll', true);
    const btn = await waitChannelButton();
    btn.remove();

    await frame();
    const again = document.querySelector('.yp-play-all-btn');
    expect(again).not.toBeNull();
    expect(again).not.toBe(btn);
    expect(document.querySelectorAll('.yp-play-all-btn')).toHaveLength(1);
  });

  test('new grid content does not recreate the button', async () => {
    store().set('enablePlayAll', true);
    const btn = await waitChannelButton();

    document.querySelector('ytd-rich-grid-renderer').appendChild(document.createElement('div'));
    await frame();

    expect(document.querySelector('.yp-play-all-btn')).toBe(btn);
  });

  test('a path change with a live button rebuilds it with the new tab href', async () => {
    store().set('enablePlayAll', true);
    const btn = await waitChannelButton();
    expect(btn.getAttribute('href')).toContain('list=UULF');

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/@channel/shorts',
      href: 'https://www.youtube.com/@channel/shorts',
    });
    document.querySelector('ytd-rich-grid-renderer').appendChild(document.createElement('div'));
    await frame();

    const again = document.querySelector('.yp-play-all-btn');
    expect(again).not.toBeNull();
    expect(again).not.toBe(btn);
    expect(again.getAttribute('href')).toContain('list=UUSH');
  });

  test('grid mutations on random-/watch pages do not drive the rebuild chain', async () => {
    store().set('enablePlayAll', true);
    const btn = await waitChannelButton();

    // The runtime stays started on the random-/watch route (the pages the
    // button opens), but those pages host no supported tab path: their grid
    // batches must not wake the rebuild/retry chain.
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=abc&ytp-random=random',
      href: 'https://www.youtube.com/watch?v=abc&ytp-random=random',
    });
    btn.remove();
    document.querySelector('ytd-rich-grid-renderer')?.appendChild(document.createElement('div'));
    await frame();

    expect(document.querySelector('.yp-play-all-btn')).toBeNull();
  });
});
