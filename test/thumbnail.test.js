/**
 * @jest-environment jsdom
 */

describe('Thumbnail Module', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    document.body.innerHTML =
      '<yt-thumbnail-view-model><img src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" alt="thumb"></yt-thumbnail-view-model>';
    document.head.innerHTML = '';

    mockLocation({
      href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=dQw4w9WgXcQ',
    });

    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: cb => cb(),
    });

    Object.defineProperty(window, 'YouTubePlusLazyLoader', {
      configurable: true,
      writable: true,
      value: null,
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: sel => document.querySelector(sel),
        $$: sel => Array.from(document.querySelectorAll(sel)),
        byId: id => document.getElementById(id),
        t: key => key,
        helpers: {
          $: sel => document.querySelector(sel),
          $$: sel => Array.from(document.querySelectorAll(sel)),
          byId: id => document.getElementById(id),
          t: key => key,
          logger: null,
          createHTML: s => s,
          debounce: fn => fn,
          setTimeout_: (fn, ms) => setTimeout(fn, ms),
        },
        loadFeatureEnabled: jest.fn(() => true),
        isWatchPage: jest.fn(() => true),
        isYouTubeDomain: jest.fn(() => true),
        isWatchRoute: jest.fn(() => window.location.pathname === '/watch'),
        isShortsRoute: jest.fn(() => window.location.pathname.startsWith('/shorts')),
        isChannelRoute: jest.fn(() => false),
        isSettingsModalOpen: jest.fn(() => false),
        logSuppressed: jest.fn(),
        StyleManager: {
          add: jest.fn(),
          remove: jest.fn(),
        },
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('injects class-based overlay CSS with hover states', () => {
    const registryCss = [
      '.thumbnail-player-overlay{opacity:0}',
      '.thumbnail-base-overlay{opacity:0}',
      '.thumb-overlay:hover{background:var(--yt-thumbnail-overlay-hover)}',
      '.avatar-overlay:hover{background:var(--yt-thumbnail-overlay-active)}',
      '.banner-overlay:hover{background:var(--yt-thumbnail-overlay-active)}',
    ].join('\n');

    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: {
        getStyle: jest.fn(id => (id === 'thumbnail-viewer-styles' ? registryCss : '')),
      },
    });

    require('../src/thumbnail.js');
    jest.advanceTimersByTime(150);

    const addCalls = window.YouTubeUtils.StyleManager.add.mock.calls;
    expect(addCalls.length).toBeGreaterThan(0);

    const cssText = addCalls.find(([key]) => key === 'thumbnail-viewer-styles')?.[1] || '';
    expect(cssText).toContain('.thumbnail-base-overlay');
    expect(cssText).toContain('.thumb-overlay:hover');
    expect(cssText).toContain('.avatar-overlay:hover');
    expect(cssText).toContain('.banner-overlay:hover');
    expect(cssText).toContain('.thumbnail-player-overlay');
  });

  test('creates thumbnail overlay with base class and no JS hover background handler', () => {
    require('../src/thumbnail.js');
    jest.advanceTimersByTime(150);

    const overlay = document.querySelector('.thumb-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('thumbnail-base-overlay')).toBe(true);
    expect(overlay.onmouseenter).toBeNull();
    expect(overlay.onmouseleave).toBeNull();
  });
});
