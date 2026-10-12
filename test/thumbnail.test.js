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

    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/settings-store.js');
    require('../src/safe-dom.js');
    require('../src/mutation-coordinator.js');
    require('../src/event-delegation.js');
    require('../src/i18n.js');
    require('../src/feature-registry.js');
    require('../src/design-system.js');
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    jest.useRealTimers();
  });

  const store = () => window.YouTubePlusSettingsStore;
  const listenerCount = () => window.YouTubePlusCleanupManager.getListenerStats().active;
  const host = () => document.querySelector('yt-thumbnail-view-model');

  test('the stylesheet shows an overlay while its host is hovered', () => {
    const css = window.YouTubePlusDesignSystem.getStyle('thumbnail-overlay-styles');
    expect(css).toContain('[data-yp-thumb-host]:hover>.thumbnail-base-overlay{opacity:1}');
    expect(css).toContain('.thumb-overlay:hover');
    expect(css).toContain('.avatar-overlay:hover');
    expect(css).toContain('.banner-overlay:hover');
  });

  test('creates thumbnail overlay with base class and no JS hover background handler', () => {
    require('../src/thumbnail.js');
    jest.advanceTimersByTime(400);

    const overlay = document.querySelector('.thumb-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('thumbnail-base-overlay')).toBe(true);
    expect(overlay.onmouseenter).toBeNull();
    expect(overlay.onmouseleave).toBeNull();
    expect(host().hasAttribute('data-yp-thumb-host')).toBe(true);
    expect(host().onmouseenter).toBeNull();
  });

  test('10 on/off cycles leave no overlay, host change, listener or timer behind', () => {
    require('../src/thumbnail.js');
    jest.advanceTimersByTime(2000);
    const cm = window.YouTubePlusCleanupManager;
    store().set('enableThumbnail', false);
    const baseline = { listeners: listenerCount(), timeouts: cm.timeouts.size };

    for (let i = 0; i < 10; i++) {
      store().set('enableThumbnail', true);
      jest.advanceTimersByTime(2000);
      expect(document.querySelector('.thumb-overlay')).not.toBeNull();
      store().set('enableThumbnail', false);
    }

    expect({ listeners: listenerCount(), timeouts: cm.timeouts.size }).toEqual(baseline);
    expect(document.querySelector('.thumb-overlay')).toBeNull();
    expect(host().hasAttribute('data-yp-thumb-host')).toBe(false);
    expect(host().style.position).toBe('');

    store().set('enableThumbnail', true);
    jest.advanceTimersByTime(2000);
    expect(document.querySelector('.thumb-overlay')).not.toBeNull();
  });

  test('the image modal closes with Escape and is removed when the feature stops', () => {
    require('../src/thumbnail.js');
    jest.advanceTimersByTime(2000);
    const baseline = listenerCount();
    const url = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg';

    window.YouTubePlusThumbnail.showImageModal(url);
    expect(document.querySelector('.thumbnail-modal-overlay')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.thumbnail-modal-overlay')).toBeNull();
    expect(listenerCount()).toBe(baseline);

    window.YouTubePlusThumbnail.showImageModal(url);
    window.YouTubePlusThumbnail.showImageModal(url);
    expect(document.querySelectorAll('.thumbnail-modal-overlay')).toHaveLength(1);
    store().set('enableThumbnail', false);
    expect(document.querySelector('.thumbnail-modal-overlay')).toBeNull();
    window.YouTubePlusThumbnail.showImageModal(url);
    expect(document.querySelector('.thumbnail-modal-overlay')).toBeNull();
  });

  test('the player button follows the feature', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="movie_player"><div class="ytp-right-controls"></div></div>'
    );
    require('../src/thumbnail.js');
    jest.advanceTimersByTime(2000);
    expect(document.querySelectorAll('#thumbnailPreview-player-button')).toHaveLength(1);
    store().set('enableThumbnail', false);
    expect(document.querySelector('#thumbnailPreview-player-button')).toBeNull();
    store().set('enableThumbnail', true);
    jest.advanceTimersByTime(2000);
    expect(document.querySelectorAll('#thumbnailPreview-player-button')).toHaveLength(1);
  });

  test('falls back to image load probe when HEAD request fails inconclusively', async () => {
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    });

    require('../src/thumbnail.js');
    jest.advanceTimersByTime(400);

    const overlay = document.querySelector('.thumb-overlay');
    expect(overlay).toBeTruthy();
    // No direct-body image yet — the thumbnail image is nested in the custom element.
    expect(document.querySelectorAll('body > img').length).toBe(0);

    overlay.click();
    // The click handler is async. Flushing microtasks lets the rejected HEAD
    // promise settle to null, so checkImageExists falls back to
    // checkViaImageLoad, which synchronously appends its probe <img> to body.
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }

    const probe = document.querySelector('body > img');
    expect(probe).toBeTruthy();
    expect(probe.src).toContain('i.ytimg.com/vi/dQw4w9WgXcQ/');
  });

  test('exports canonical window.YouTubePlusThumbnail facade and validates helper methods', () => {
    require('../src/thumbnail.js');
    expect(window.YouTubePlusThumbnail).toBeDefined();

    expect(
      window.YouTubePlusThumbnail.testHooks.extractVideoId(
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
      )
    ).toBe('dQw4w9WgXcQ');
    expect(
      window.YouTubePlusThumbnail.testHooks.extractShortsId(
        'https://www.youtube.com/shorts/abcdefghijk'
      )
    ).toBe('abcdefghijk');

    const urls = window.YouTubePlusThumbnail.testHooks.getVideoThumbnailUrls('dQw4w9WgXcQ');
    expect(urls).toHaveProperty('primary');
    expect(urls.primary).toContain('dQw4w9WgXcQ');
  });

  describe('Unified Feature Contract (M4)', () => {
    test('exposes canonical DESCRIPTOR matching FeatureRegistry schema', () => {
      require('../src/thumbnail.js');
      const desc = window.YouTubePlusThumbnail.DESCRIPTOR;
      expect(desc).toBeDefined();
      expect(desc.id).toBe('thumbnail');
      expect(desc.settingsKey).toBe('enableThumbnail');
      expect(desc.titleKey).toBe('showThumbnailPreview');
      expect(typeof desc.command).toBe('function');
      expect(typeof desc.mountDock).toBe('function');
    });

    test('DESCRIPTOR.mountDock creates Vision dock button idempotently', () => {
      require('../src/thumbnail.js');
      const desc = window.YouTubePlusThumbnail.DESCRIPTOR;
      const player = document.createElement('div');
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);

      desc.mountDock(player, dock);

      const btn = dock.querySelector('#yp-vision-thumbnail-btn');
      expect(btn).toBeTruthy();
      expect(btn?.classList.contains('vision-dock-btn')).toBe(true);
      expect(btn?.classList.contains('yp-thumbnail-button')).toBe(true);

      // Second mount should not duplicate button
      desc.mountDock(player, dock);
      expect(dock.querySelectorAll('#yp-vision-thumbnail-btn').length).toBe(1);
    });

    test('DESCRIPTOR.command opens thumbnail for current video', () => {
      require('../src/thumbnail.js');
      const desc = window.YouTubePlusThumbnail.DESCRIPTOR;

      const result = desc.command({});
      expect(result).toBe(true);
    });
  });

  describe('Custom dock dispose contract (U05/A03)', () => {
    test('click survives sweep + re-mount; dispose releases it; double mount does not stack', () => {
      require('../src/thumbnail.js');
      const desc = window.YouTubePlusThumbnail.DESCRIPTOR;
      const player = document.createElement('div');
      const dock = document.createElement('div');
      dock.className = 'vision-top-center-dock';
      player.appendChild(dock);
      const cm = window.YouTubePlusCleanupManager;
      const countEntries = () => {
        let n = 0;
        for (const e of cm.listeners.values()) {
          if (e.target === dock.querySelector('#yp-vision-thumbnail-btn')) n += 1;
        }
        return n;
      };

      let dispose = desc.mountDock(player, dock);
      expect(typeof dispose).toBe('function');
      expect(countEntries()).toBe(1);

      // Direct re-mount: stable closure dedups, no stacking.
      dispose = desc.mountDock(player, dock);
      expect(countEntries()).toBe(1);

      cm.cleanup();
      expect(countEntries()).toBe(0);
      dispose = desc.mountDock(player, dock);
      expect(countEntries()).toBe(1);

      // Click opens the thumbnail flow: the icon is synchronously replaced by
      // the loading spinner (replaceWithSpinner runs before the async load).
      const btn = dock.querySelector('#yp-vision-thumbnail-btn');
      expect(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }).not.toThrow();
      const pathD = btn.querySelector('path')?.getAttribute('d') || '';
      expect(pathD).toContain('M21 12a9 9');

      dispose();
      expect(countEntries()).toBe(0);
    });
  });

  /**
   * Host-restore contract (the leak e2e asserts these attributes), overlay
   * families, and the modal download flow through the real feature stack.
   */
  describe('host restore, avatar/banner overlays and downloads', () => {
    afterEach(() => {
      window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
      jest.useRealTimers();
    });

    const startFeature = () => {
      require('../src/thumbnail.js');
      jest.advanceTimersByTime(400);
    };

    const stopFeature = () => {
      window.YouTubePlusSettingsStore.set('enableThumbnail', false);
      jest.advanceTimersByTime(2000);
    };

    /** A static-position banner host exercises markHost + full restore. */
    test('static hosts are marked, become relative, and restore on stop', () => {
      const bannerHost = document.createElement('yt-image-banner-view-model');
      const img = document.createElement('img');
      img.src = 'https://i.ytimg.com/banner/test.jpg';
      bannerHost.appendChild(img);
      document.body.appendChild(bannerHost);

      startFeature();
      expect(document.querySelector('.banner-overlay')).toBeTruthy();
      expect(bannerHost.hasAttribute('data-yp-thumb-host')).toBe(true);

      stopFeature();
      // The restore gives the host its own styling back and drops the marker.
      expect(document.querySelector('.banner-overlay')).toBeNull();
      expect(bannerHost.hasAttribute('data-yp-thumb-host')).toBe(false);
      expect(bannerHost.hasAttribute('data-yp-thumb-position')).toBe(false);
    });

    test('avatar overlays appear for ggpht sources and skip shorts lockups', () => {
      const avatarHost = document.createElement('yt-avatar-shape');
      const img = document.createElement('img');
      img.src = 'https://yt3.ggpht.com/avatar-test=s48-c-k-c0x00ffffff-no-rj';
      avatarHost.appendChild(img);
      document.body.appendChild(avatarHost);

      const shortsHost = document.createElement('ytm-shorts-lockup-view-model');
      const shortsImg = document.createElement('img');
      shortsImg.src = 'https://yt3.ggpht.com/shorts-avatar=s48-c-k-c0x00ffffff-no-rj';
      shortsHost.appendChild(shortsImg);
      document.body.appendChild(shortsHost);

      startFeature();
      const avatarHostOverlay = avatarHost.querySelector('.avatar-overlay');
      const shortsOverlay = shortsHost.querySelector('.avatar-overlay');
      expect(avatarHostOverlay).toBeTruthy();
      expect(shortsOverlay).toBeNull();

      // A second pass does not stack overlays on the same host.
      jest.advanceTimersByTime(2000);
      expect(avatarHost.querySelectorAll('.avatar-overlay').length).toBe(1);

      stopFeature();
      expect(document.querySelector('.avatar-overlay')).toBeNull();
    });

    test('the modal download saves the blob under its URL filename and revokes it', async () => {
      const created = jest.fn(() => 'blob:mock-url');
      const revoked = [];
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: created,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: url => revoked.push(url),
      });
      startFeature();
      // resetMocks wipes the shared polyfill's implementation; the download
      // flow needs its own ok-response.
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        writable: true,
        value: jest.fn(() =>
          Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) })
        ),
      });

      window.YouTubePlusThumbnail.showImageModal(
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'
      );
      const img = /** @type {HTMLImageElement} */ (document.querySelector('.thumbnail-modal-img'));
      expect(img).toBeTruthy();

      const anchorClicks = [];
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function () {
          anchorClicks.push(/** @type {HTMLAnchorElement} */ (this));
        });
      const downloadBtn = /** @type {HTMLButtonElement} */ (
        document.querySelector('.thumbnail-modal-download')
      );
      downloadBtn.click();
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(1600);

      expect(created).toHaveBeenCalled();
      expect(anchorClicks[0]?.download).toBe('maxresdefault.jpg');
      expect(revoked).toContain('blob:mock-url');
      clickSpy.mockRestore();
    });

    test('a failed download reopens the image in a new tab instead', async () => {
      startFeature();
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        writable: true,
        value: jest.fn(() => Promise.reject(new TypeError('download failed'))),
      });

      const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
      window.YouTubePlusThumbnail.showImageModal(
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'
      );
      const downloadBtn = /** @type {HTMLButtonElement} */ (
        document.querySelector('.thumbnail-modal-download')
      );
      downloadBtn.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(openSpy).toHaveBeenCalledWith(
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
        '_blank',
        'noopener,noreferrer'
      );
    });
  });
});
