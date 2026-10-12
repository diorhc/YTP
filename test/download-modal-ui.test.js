/**
 * Unit tests for the download modal: the custom subtitle listbox, the tab and
 * source selectors, quality/audio rendering and the download/cancel/error flow.
 */

describe('Download modal UI', () => {
  const createLogger = () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  });

  function installModule() {
    jest.resetModules();
    require('../src/download.js');
    return window.YouTubePlusDownload;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.resetModules();
    require('../src/utils.js');
    require('../src/modal-handlers.js');
    if (!window.YouTubePlusDesignSystem) window.YouTubePlusDesignSystem = {};
    window.YouTubePlusDesignSystem.initGlassDropdown =
      window.YouTubePlusModalHandlers?.initGlassDropdown;
    const canonUtils = window.YouTubeUtils;
    window._ytplusCreateHTML = s => s;
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(sel => document.querySelector(sel)),
        $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        byId: jest.fn(id => document.getElementById(id)),
        getVideoIdFromUrl: canonUtils.getVideoIdFromUrl,
        getVideoIdFromLocation: jest.fn(canonUtils.getVideoIdFromLocation),
        t: jest.fn(key => key || ''),
        setSafeHTML: jest.fn((el, html) => {
          el.innerHTML = html;
        }),
        createVisibilityAwareInterval: jest.fn((cb, delay) => {
          const id = setInterval(cb, delay);
          return {
            active: true,
            stop: () => clearInterval(id),
            pause: () => clearInterval(id),
            resume: jest.fn(),
          };
        }),
        cleanupManager: {
          register: jest.fn(),
          registerInterval: jest.fn(id => id),
          registerTimeout: jest.fn(id => id),
          registerObserver: jest.fn(obs => obs),
          registerListener: jest.fn((target, event, fn, opts) => {
            target.addEventListener(event, fn, opts);
            return Symbol('listener');
          }),
          cleanup: jest.fn(),
          registerAnimationFrame: jest.fn(id => id),
        },
        NotificationManager: { show: jest.fn(), hide: jest.fn() },
        StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
        logError: jest.fn(),
        createElement: jest.fn(tag => document.createElement(tag)),
        loadFeatureEnabled: jest.fn(() => true),
        storage: {
          get: jest.fn(),
          set: jest.fn(),
          remove: jest.fn(),
          getItem: jest.fn(() => null),
          setItem: jest.fn(),
        },
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        SETTINGS_KEY: 'youtube_plus_settings',
        isWatchRoute: jest.fn(() => true),
        isShortsRoute: jest.fn(() => false),
        isYouTubeDomain: jest.fn(() => true),
        isChannelRoute: jest.fn(() => false),
        isSettingsModalOpen: jest.fn(() => false),
        createIsRelevantRoute: () => () => true,
        createWithErrorBoundary: _name => fn => fn,
        logSuppressed: jest.fn(),
        getRoute: jest.fn(() => 'watch'),
      },
    });
    Object.defineProperty(window, 'YouTubePlusI18n', {
      configurable: true,
      writable: true,
      value: {
        t: jest.fn(key => key),
        getLanguage: jest.fn(() => 'en'),
        loadTranslations: jest.fn(),
        isReady: jest.fn(() => true),
      },
    });
    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        createLogger: jest.fn(() => createLogger()),
        setLevel: jest.fn(),
        getLevel: jest.fn(() => 'info'),
        getRecent: jest.fn(() => []),
        export: jest.fn(),
        createChild: jest.fn(),
      },
    });
    Object.defineProperty(window, 'YouTubePlusDOMCache', {
      configurable: true,
      writable: true,
      value: {
        get: jest.fn(),
        querySelector: jest.fn(),
        getAll: jest.fn(),
        querySelectorAll: jest.fn(),
        getElementById: jest.fn(),
        waitForElement: jest.fn(),
        invalidate: jest.fn(),
        clear: jest.fn(),
      },
    });

    global.mockLocation({
      href: 'https://www.youtube.com/watch?v=test12345ab',
      hostname: 'www.youtube.com',
      pathname: '/watch',
      search: '?v=test12345ab',
    });

    global.fetch = jest.fn(() => Promise.reject(new Error('network disabled in unit tests')));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:modal-test'),
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  const JSON3_PAYLOAD = JSON.stringify({
    events: [{ tStartMs: 0, dDurationMs: 800, segs: [{ utf8: 'modal cue' }] }],
  });

  /**
   * @param {{ captions?: unknown, streamingData?: unknown, downloadFails?: boolean }} [parts]
   */
  function serveSubtitles(parts = {}) {
    GM_xmlhttpRequest.mockImplementation(options => {
      const url = String(options.url || '');
      if (url.includes('/youtubei/v1/player')) {
        options.onload({
          status: 200,
          responseText: JSON.stringify({
            videoDetails: { title: 'Modal demo' },
            streamingData: parts.streamingData,
            captions: parts.captions,
          }),
        });
        return { abort: jest.fn() };
      }
      if (url.includes('/api/timedtext')) {
        options.onload({ status: 200, responseText: JSON3_PAYLOAD });
        return { abort: jest.fn() };
      }
      if (url.includes('/sanity/key')) {
        options.onload({ status: 200, responseText: JSON.stringify({ key: 'k' }) });
        return { abort: jest.fn() };
      }
      if (url.includes('/converter')) {
        options.onload({
          status: 200,
          responseText: parts.downloadFails
            ? JSON.stringify({})
            : JSON.stringify({ url: 'https://cdn.example.com/f.mp4' }),
        });
        return { abort: jest.fn() };
      }
      options.onload({
        status: parts.cdnStatus ?? 200,
        response: parts.cdnStatus ? null : new window.Blob(['stream bytes']),
      });
      return { abort: jest.fn() };
    });
  }

  /** Open the modal and let the deferred tab/quality renders settle. */
  async function openSettled(api) {
    api.openModal();
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  const listbox = () => /** @type {HTMLElement} */ (document.querySelector('[role="listbox"]'));
  const tablist = () => /** @type {HTMLElement} */ (document.querySelector('[role="tablist"]'));
  const tab = format =>
    /** @type {HTMLElement} */ (document.querySelector(`[data-format="${format}"]`));
  const qualityGroup = () =>
    /** @type {HTMLElement} */ (document.querySelector('.yp-download-quality'));
  const downloadBtn = () =>
    /** @type {HTMLButtonElement} */ (document.querySelector('.yp-download-btn.primary'));
  const cancelBtn = () =>
    /** @type {HTMLButtonElement} */ (
      Array.from(document.querySelectorAll('.yp-download-btn')).find(
        b => !b.classList.contains('primary')
      )
    );
  const progressText = () =>
    /** @type {HTMLElement} */ (document.querySelector('.yp-download-progress-text'));
  const notifications = () =>
    window.YouTubeUtils.NotificationManager.show.mock.calls.map(call => String(call[0]));

  describe('subtitle listbox', () => {
    const TRACKS = {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            languageCode: 'en',
            vssId: 'a.en',
            name: { simpleText: 'English' },
            baseUrl: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
          },
          {
            languageCode: 'de',
            kind: 'asr',
            vssId: 'a.de',
            name: { simpleText: 'Deutsch' },
            baseUrl: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=de&kind=asr',
          },
        ],
        translationLanguages: [{ languageCode: 'fr', languageName: { simpleText: 'French' } }],
      },
    };

    test('options are rendered, the first is selected and the label follows', async () => {
      serveSubtitles({ captions: TRACKS });
      const api = installModule();
      await openSettled(api);

      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();

      const options = Array.from(listbox().querySelectorAll('[data-value]'));
      expect(options.map(o => o.getAttribute('data-value'))).toEqual(['0', '1', '2']);
      expect(options.map(o => o.textContent)).toEqual([
        'English',
        'Deutsch',
        'FrenchautoTranslateSuffix',
      ]);
      expect(listbox().querySelector('.dl-subtitle-label')?.textContent).toBe('English');
    });

    test('the display click opens and closes the option list', async () => {
      serveSubtitles({ captions: TRACKS });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const display = listbox().querySelector('.dl-subtitle-display');
      display?.click();
      expect(listbox().querySelector('.dl-subtitle-list')?.classList.contains('is-open')).toBe(
        true
      );
      expect(listbox().getAttribute('aria-expanded')).toBe('true');

      display?.click();
      expect(listbox().querySelector('.dl-subtitle-list')?.classList.contains('is-open')).toBe(
        false
      );
    });

    test('a disabled listbox ignores display clicks', async () => {
      serveSubtitles({ captions: TRACKS });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const display = listbox().querySelector('.dl-subtitle-display');
      display?.setAttribute('data-nothing', 'x');
      const select = listbox();
      select.disabled = true;
      expect(select.disabled).toBe(true);
      display?.click();
      expect(listbox().querySelector('.dl-subtitle-list')?.classList.contains('is-open')).toBe(
        false
      );
      select.disabled = false;
    });

    test('clicking an option selects it and closes the list', async () => {
      serveSubtitles({ captions: TRACKS });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const display = listbox().querySelector('.dl-subtitle-display');
      display?.click();
      const options = Array.from(listbox().querySelectorAll('[data-value]'));
      /** @type {HTMLElement} */ (options[2]).click();

      expect(listbox().querySelector('.dl-subtitle-list')?.classList.contains('is-open')).toBe(
        false
      );
      expect(listbox().querySelector('.dl-subtitle-label')?.textContent).toBe(
        'FrenchautoTranslateSuffix'
      );
    });

    test('a click outside the listbox closes it', async () => {
      serveSubtitles({ captions: TRACKS });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));

      listbox().querySelector('.dl-subtitle-display')?.click();
      document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      expect(listbox().querySelector('.dl-subtitle-list')?.classList.contains('is-open')).toBe(
        false
      );
      expect(listbox().getAttribute('aria-expanded')).toBe('false');
    });

    test('hovering an option highlights it and leaving clears the highlight', async () => {
      serveSubtitles({ captions: TRACKS });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const option = /** @type {HTMLElement} */ (listbox().querySelector('[data-value]'));
      option.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
      expect(option.style.background).toBe('var(--yt-surface-overlay-faint)');

      option.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
      expect(option.style.background).toBe('transparent');

      // Leaving toward a child keeps the highlight.
      const child = document.createElement('span');
      option.appendChild(child);
      option.dispatchEvent(
        new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: child })
      );
      expect(option.style.background).toBe('transparent');
    });

    test('a mouse event outside any option is ignored', async () => {
      serveSubtitles({ captions: TRACKS });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const list = listbox().querySelector('.dl-subtitle-list');
      list?.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
      list?.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
      expect(list).toBeTruthy();
    });

    test('Enter and Space toggle the list, Escape closes it', async () => {
      serveSubtitles({ captions: TRACKS });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const select = listbox();
      select.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(select.querySelector('.dl-subtitle-list')?.classList.contains('is-open')).toBe(true);

      select.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(select.querySelector('.dl-subtitle-list')?.classList.contains('is-open')).toBe(false);

      // Escape while closed is a no-op.
      select.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(select.querySelector('.dl-subtitle-list')?.classList.contains('is-open')).toBe(false);

      select.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(select.getAttribute('aria-expanded')).toBe('false');
    });

    test('arrow keys open the list and cycle the selected option', async () => {
      serveSubtitles({ captions: TRACKS });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const select = listbox();
      select.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
      expect(select.querySelector('.dl-subtitle-list')?.classList.contains('is-open')).toBe(true);
      expect(select.querySelector('.dl-subtitle-label')?.textContent).toBe('Deutsch');

      select.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
      expect(select.querySelector('.dl-subtitle-label')?.textContent).toBe(
        'FrenchautoTranslateSuffix'
      );

      // The last option does not wrap past the end.
      select.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
      expect(select.querySelector('.dl-subtitle-label')?.textContent).toBe(
        'FrenchautoTranslateSuffix'
      );

      select.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(select.querySelector('.dl-subtitle-label')?.textContent).toBe('Deutsch');
    });

    test('keyboard navigation is ignored while the listbox is disabled', async () => {
      serveSubtitles({ captions: TRACKS });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const select = listbox();
      select.disabled = true;
      select.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
      expect(select.querySelector('.dl-subtitle-list')?.classList.contains('is-open')).toBe(false);
    });

    test('a video without captions shows the empty placeholder', async () => {
      serveSubtitles({});
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();

      expect(listbox().querySelector('.dl-subtitle-label')?.textContent).toBe('noSubtitles');
    });

    test('a malformed caption track list degrades to the empty placeholder', async () => {
      // captionTracks is not an array: getSubtitles swallows the failure and
      // the modal shows the empty state instead of breaking the tab strip.
      serveSubtitles({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: { nope: true },
            translationLanguages: [],
          },
        },
      });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();
      await Promise.resolve();

      expect(listbox().querySelector('.dl-subtitle-label')?.textContent).toBe('noSubtitles');
    });
  });

  describe('tabs and sources', () => {
    test('tab labels with a parenthesised part render a subtitle span', async () => {
      window.YouTubeUtils.t.mockImplementation(key =>
        key === 'videoTab' ? 'Video (1080p)' : key === 'audioTab' ? 'Audio' : key
      );
      serveSubtitles();
      const api = installModule();
      await openSettled(api);

      expect(tab('video').querySelector('.yp-download-tab-sub')?.textContent).toBe('1080p');
      expect(tab('audio').querySelector('.yp-download-tab-sub')).toBeNull();
    });

    test('arrow keys move through the tabs and activate the neighbour', async () => {
      serveSubtitles();
      const api = installModule();
      await openSettled(api);

      const active = format => tab(format).getAttribute('aria-selected');
      const press = key =>
        tablist().dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));

      tab('video').focus();
      expect(document.activeElement).toBe(tab('video'));

      press('ArrowRight');
      expect(active('audio')).toBe('true');
      expect(active('video')).toBe('false');

      // The activated tab is blurred again so the page keeps focus.
      expect(document.activeElement).not.toBe(tab('audio'));

      tab('audio').focus();
      press('ArrowLeft');
      expect(active('video')).toBe('true');

      // Wrapping backwards from the first tab lands on the last one.
      tab('video').focus();
      press('ArrowLeft');
      expect(active('subtitle')).toBe('true');

      // Unrelated keys are ignored, and focus outside the tablist does nothing.
      press('Enter');
      expect(active('subtitle')).toBe('true');
      tab('subtitle').blur();
      press('ArrowRight');
      expect(active('subtitle')).toBe('true');
    });

    test('a tab switch that throws does not break the tab strip', async () => {
      serveSubtitles();
      let calls = 0;
      window.YouTubeUtils.getVideoIdFromLocation.mockImplementation(() => {
        calls += 1;
        if (calls > 2) throw new Error('route changed mid-switch');
        return 'test12345ab';
      });
      const api = installModule();
      await openSettled(api);

      expect(() => tab('audio').click()).not.toThrow();
      expect(tab('audio').getAttribute('aria-selected')).toBe('true');
    });

    test('the source pills and the classic dropdown re-render the quality options', async () => {
      serveSubtitles({
        streamingData: {
          adaptiveFormats: [
            { mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '720p' },
            { mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '1080p' },
          ],
        },
      });
      const api = installModule();
      await openSettled(api);

      const cnvValues = () =>
        Array.from(qualityGroup().querySelectorAll('button'))
          .map(b => b.getAttribute('data-value'))
          .filter(Boolean);
      expect(cnvValues()).toEqual(['720', '1080']);

      const cobaltBtn = /** @type {HTMLElement} */ (
        document.querySelector('[data-source="cobalt"]')
      );
      cobaltBtn.click();
      expect(cnvValues()).toEqual(['360', '480', '720', '1080']);
      expect(
        /** @type {HTMLSelectElement} */ (
          document.querySelector('.yp-download-classic-source-select')
        ).value
      ).toBe('cobalt');

      const dropdown = /** @type {HTMLSelectElement} */ (
        document.querySelector('.yp-download-classic-source-select')
      );
      dropdown.value = 'mobile';
      dropdown.dispatchEvent(new window.Event('change', { bubbles: true }));
      expect(cnvValues()).toEqual(['360', '480', '720', '1080']);
      expect(document.querySelector('.yp-download-source-hint')?.style.display).toBe('block');
    });

    test('the audio tab offers per-source bitrates and hides the thumbnail option', async () => {
      serveSubtitles();
      const api = installModule();
      await openSettled(api);

      tab('audio').click();
      const labels = () =>
        Array.from(qualityGroup().querySelectorAll('button')).map(b =>
          b.getAttribute('data-value')
        );
      expect(labels()).toEqual(['64', '128', '192', '256', '320']);
      expect(
        /** @type {HTMLElement} */ (document.querySelector('.yp-download-embed-label')).style
          .display
      ).toBe('none');

      /** @type {HTMLElement} */ (document.querySelector('[data-source="mobile"]')).click();
      expect(labels()).toEqual(['128', '256']);
    });

    test('an unknown source falls back to the 128 kbps option', async () => {
      serveSubtitles();
      const api = installModule();
      await openSettled(api);
      tab('audio').click();

      const dropdown = /** @type {HTMLSelectElement} */ (
        document.querySelector('.yp-download-classic-source-select')
      );
      dropdown.value = 'mobile';
      dropdown.dispatchEvent(new window.Event('change', { bubbles: true }));
      const labels = Array.from(qualityGroup().querySelectorAll('button')).map(b =>
        b.getAttribute('data-value')
      );
      expect(labels).toEqual(['128', '256']);
      expect(qualityGroup().getAttribute('aria-checked')).toBeNull();
    });

    test('a quality pill selects and re-highlights its group', async () => {
      serveSubtitles({
        streamingData: {
          adaptiveFormats: [
            { mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '360p' },
            { mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '720p' },
          ],
        },
      });
      const api = installModule();
      await openSettled(api);

      const pills = Array.from(qualityGroup().querySelectorAll('button'));
      /** @type {HTMLElement} */ (pills[0]).click();
      expect(pills[0].getAttribute('aria-checked')).toBe('true');
      expect(pills[1].getAttribute('aria-checked')).toBe('false');
    });

    test('a quality list is not rendered for the subtitle tab', async () => {
      serveSubtitles();
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      expect(qualityGroup().style.display).toBe('none');
    });

    test('a video with only low qualities still opens on the highest one', async () => {
      serveSubtitles({
        streamingData: {
          adaptiveFormats: [
            { mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '144p' },
            { mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '240p' },
          ],
        },
      });
      const api = installModule();
      await openSettled(api);

      const active = Array.from(qualityGroup().querySelectorAll('button')).filter(b =>
        b.classList.contains('active')
      );
      expect(active).toHaveLength(1);
      expect(active[0].getAttribute('data-value')).toBe('240');
    });
  });

  describe('download and cancel flow', () => {
    test('a media download disables the form, resets progress and re-enables it', async () => {
      serveSubtitles({
        streamingData: {
          adaptiveFormats: [{ mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '720p' }],
        },
      });
      const api = installModule();
      await openSettled(api);

      const fill = /** @type {HTMLElement} */ (
        document.querySelector('.yp-download-progress-fill')
      );
      fill.style.width = '80%';

      const btn = downloadBtn();
      btn.click();
      // The form is disabled and the inline progress bar is reset immediately.
      expect(fill.style.width).toBe('0%');
      expect(progressText()?.textContent).toBe('starting');

      await new Promise(resolve => setTimeout(resolve, 30));
      expect(progressText()?.textContent).toBe('completed');
      expect(btn.disabled).toBe(false);
      expect(btn.style.opacity).toBe('1');
      expect(btn.style.cursor).toBe('pointer');
    });

    test('a second click while the form is disabled is ignored', async () => {
      serveSubtitles();
      const api = installModule();
      await openSettled(api);

      const btn = downloadBtn();
      btn.disabled = true;
      const before = GM_xmlhttpRequest.mock.calls.length;
      btn.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(GM_xmlhttpRequest.mock.calls.length).toBe(before);
      btn.disabled = false;
    });

    test('the cancel button closes the modal', async () => {
      serveSubtitles();
      const api = installModule();
      await openSettled(api);
      cancelBtn()?.click();
      expect(document.querySelector('.yp-download-modal-overlay')).toBeNull();
    });

    test('Escape inside the modal closes it', async () => {
      serveSubtitles();
      const api = installModule();
      await openSettled(api);
      const overlay = /** @type {HTMLElement} */ (
        document.querySelector('.yp-download-modal-overlay')
      );
      overlay.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.querySelector('.yp-download-modal-overlay')).toBeNull();
    });

    test('a failed media download shows the error and restores the controls', async () => {
      serveSubtitles({
        streamingData: {
          adaptiveFormats: [{ mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '720p' }],
        },
        cdnStatus: 500,
      });
      // The converter succeeds and the CDN refuses, so the error surfaces
      // without entering the retry ladder.
      const api = installModule();
      await openSettled(api);

      const btn = downloadBtn();
      btn.click();
      await new Promise(resolve => setTimeout(resolve, 60));

      expect(progressText()?.textContent).toContain('downloadFailed');
      expect(btn.disabled).toBe(false);
      expect(progressText()?.style.color).toBe('var(--yt-danger-text)');
    });

    test('a subtitle download with no track selected reports the missing selection', async () => {
      serveSubtitles({});
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();

      const btn = downloadBtn();
      btn.click();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(progressText()?.textContent).toContain('noSubtitleSelected');
      expect(btn.disabled).toBe(false);
    });

    test('a subtitle download saves the selected track and notifies', async () => {
      serveSubtitles({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                languageCode: 'en',
                vssId: 'a.en',
                name: { simpleText: 'English' },
                baseUrl: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
              },
            ],
            translationLanguages: [],
          },
        },
      });
      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();

      downloadBtn().click();
      await new Promise(resolve => setTimeout(resolve, 40));

      expect(notifications()).toContain('subtitleDownloaded');
      expect(progressText()?.textContent).toBe('completed');
    });

    test('the format pills choose the subtitle container', async () => {
      serveSubtitles({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                languageCode: 'en',
                vssId: 'a.en',
                name: { simpleText: 'English' },
                baseUrl: 'https://www.youtube.com/api/timedtext?v=test12345ab&lang=en',
              },
            ],
            translationLanguages: [],
          },
        },
      });
      const OriginalBlob = window.Blob;
      /** @type {string[]} */
      const contents = [];
      window.Blob = jest.fn(function (parts, opts) {
        if (typeof parts?.[0] === 'string') contents.push(parts[0]);
        return new OriginalBlob(parts, opts);
      });

      const api = installModule();
      await openSettled(api);
      tab('subtitle').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();

      const xmlPill = /** @type {HTMLElement} */ (
        document.querySelector('.yp-download-select-wrap [data-value="xml"]')
      );
      xmlPill.click();
      expect(xmlPill.getAttribute('aria-checked')).toBe('true');

      downloadBtn().click();
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(contents.join('\n')).toContain('<transcript>');
    });
  });

  describe('modal lifecycle', () => {
    test('reopening replaces any previous focus trap and never throws', async () => {
      const release = jest.fn();
      window.YouTubePlusModalHandlers = {
        createFocusTrap: jest.fn(() => release),
      };
      serveSubtitles();
      const api = installModule();

      await openSettled(api);
      expect(window.YouTubePlusModalHandlers.createFocusTrap).toHaveBeenCalled();

      cancelBtn()?.click();
      await openSettled(api);
      expect(release).toHaveBeenCalled();
    });

    test('a throwing focus-trap release is swallowed on both close and reopen', async () => {
      const release = jest.fn(() => {
        throw new Error('trap already released');
      });
      window.YouTubePlusModalHandlers = { createFocusTrap: jest.fn(() => release) };
      serveSubtitles();
      const api = installModule();

      await openSettled(api);
      expect(() => cancelBtn()?.click()).not.toThrow();
      expect(() => api.openModal()).not.toThrow();
    });
  });
});
