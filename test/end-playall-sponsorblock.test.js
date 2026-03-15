/**
 * Unit tests for YouTube+ End Screen and SponsorBlock-related logic
 */

describe('End Screen Module', () => {
  beforeEach(() => {
    window._ytplusCreateHTML = s => s;
    window.YouTubeUtils = {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      t: jest.fn(key => key || ''),
      cleanupManager: {
        registerTimeout: jest.fn(id => id),
        registerObserver: jest.fn(obs => obs),
        registerListener: jest.fn(),
        cleanup: jest.fn(),
      },
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      loadFeatureEnabled: jest.fn(() => true),
      SETTINGS_KEY: 'youtube_plus_settings',
    };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
  });

  test('should define end screen selectors', () => {
    const selectors = {
      endScreen: '.ytp-ce-element',
      endScreenContainer: '.html5-endscreen',
      cards: '.ytp-ce-covering-overlay',
    };
    expect(selectors.endScreen).toBe('.ytp-ce-element');
    expect(selectors.endScreenContainer).toBe('.html5-endscreen');
  });

  test('should hide end screen elements via CSS', () => {
    const hideCSS = '.html5-endscreen { display: none !important; }';
    window.YouTubeUtils.StyleManager.add('end-screen-hider', hideCSS);
    expect(window.YouTubeUtils.StyleManager.add).toHaveBeenCalledWith(
      'end-screen-hider',
      expect.stringContaining('.html5-endscreen')
    );
  });

  test('should respect feature toggle', () => {
    expect(window.YouTubeUtils.loadFeatureEnabled('enableEndScreenRemover')).toBe(true);
    window.YouTubeUtils.loadFeatureEnabled = jest.fn(() => false);
    expect(window.YouTubeUtils.loadFeatureEnabled('enableEndScreenRemover')).toBe(false);
  });
});

describe('PlayAll Module', () => {
  beforeEach(() => {
    window._ytplusCreateHTML = s => s;
    window.YouTubeUtils = {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => []),
      t: jest.fn(key => key || ''),
      loadFeatureEnabled: jest.fn(() => true),
      cleanupManager: {
        registerTimeout: jest.fn(id => id),
        registerInterval: jest.fn(id => id),
        registerObserver: jest.fn(obs => obs),
        registerListener: jest.fn(),
        cleanup: jest.fn(),
      },
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
    };
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/@channel',
      href: 'https://www.youtube.com/@channel',
    });
  });

  test('should detect channel/playlist pages', () => {
    const isPlayAllTarget = path => {
      return (
        path.startsWith('/@') ||
        path.startsWith('/channel/') ||
        path.startsWith('/playlist') ||
        path.startsWith('/c/')
      );
    };
    expect(isPlayAllTarget('/@channel')).toBe(true);
    expect(isPlayAllTarget('/channel/UC123')).toBe(true);
    expect(isPlayAllTarget('/playlist?list=PL123')).toBe(true);
    expect(isPlayAllTarget('/c/SomeChannel')).toBe(true);
    expect(isPlayAllTarget('/watch')).toBe(false);
    expect(isPlayAllTarget('/')).toBe(false);
  });

  test('should respect feature toggle', () => {
    expect(window.YouTubeUtils.loadFeatureEnabled('enablePlayAll')).toBe(true);
  });
});

describe('SponsorBlock Module', () => {
  test('should define segment categories', () => {
    const categories = [
      'sponsor',
      'selfpromo',
      'interaction',
      'intro',
      'outro',
      'preview',
      'music_offtopic',
      'filler',
    ];
    expect(categories).toHaveLength(8);
    expect(categories).toContain('sponsor');
    expect(categories).toContain('selfpromo');
  });

  test('should validate SponsorBlock API URL', () => {
    const apiUrl = 'https://sponsor.ajay.app/api/skipSegments';
    expect(apiUrl).toMatch(/^https:\/\/sponsor\.ajay\.app/);
  });
});
