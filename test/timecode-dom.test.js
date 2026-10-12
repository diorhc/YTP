/**
 * Branch coverage for src/timecode.js with the full runtime host present:
 * FeatureLifecycle, EventDelegation, MutationCoordinator and DesignSystem.
 * These are the paths a release build takes - the panel is wired through the
 * shared delegator and the settings modal through the mutation coordinator.
 * @jest-environment jsdom
 */

describe('Timecode branches (full runtime host)', () => {
  let api;
  let hooks;

  const store = () => window.YouTubePlusSettingsStore;
  const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;
  const coordinator = () => window.YouTubePlusMutationCoordinator;
  const cleanup = () => window.YouTubePlusCleanupManager;
  const items = () => document.querySelectorAll('#timecode-panel .timecode-item');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

  const stubVideo = () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    });
    video.play = jest.fn(() => Promise.resolve());
    document.body.appendChild(video);
    return video;
  };

  /** The settings modal as the settings renderer builds it. */
  const buildModal = ({ withItem = true } = {}) => {
    const modal = document.createElement('div');
    modal.className = 'yp-settings-modal';
    modal.innerHTML = `<div class="yp-settings-section" data-section="advanced">${
      withItem
        ? `<div class="timecode-settings-item">
             <input type="checkbox" id="timecode-enable-checkbox">
           </div>`
        : ''
    }</div>`;
    document.body.appendChild(modal);
    return modal;
  };

  const openPanel = () => {
    store().set('timecodeEnabled', true);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'T', shiftKey: true, bubbles: true })
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'T', shiftKey: true, bubbles: true })
    );
    const panel = document.getElementById('timecode-panel');
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('hidden')).toBe(false);
    return panel;
  };

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    delete window._timecodeModuleInitialized;

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=hosted',
    });

    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/settings-store.js');
    require('../src/safe-dom.js');
    require('../src/event-delegation.js');
    require('../src/i18n.js');
    require('../src/feature-registry.js');
    require('../src/design-system.js');
    require('../src/mutation-coordinator.js');

    window.YouTubeUtils.NotificationManager = { show: jest.fn() };
    window.YouTubeUtils.confirmDialog = jest.fn(() => Promise.resolve(true));

    document.body.appendChild(document.createElement('ytd-app'));
    stubVideo();

    store().set('timecodeEnabled', false);
    // Both hosts below guard on their window facade, so resetModules returns
    // the same instances and their state would otherwise leak test to test.
    coordinator().dispose();
    require('../src/timecode.js');
    api = window.YouTubePlusTimecode;
    hooks = api.testHooks;
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });

  afterEach(() => {
    api?.cleanup?.();
    // Each require() above adds a fresh document listener to the shared jsdom
    // document; only the instance that registered it can release it, so the
    // per-test manager must be flushed or later tests see stale handlers.
    window.YouTubePlusCleanupManager.cleanup();
    coordinator().dispose();
    lifecycle()?._reset?.();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('delegated panel controls', () => {
    let panel;
    let video;

    beforeEach(() => {
      video = document.querySelector('video');
      panel = openPanel();
    });

    test('the header reload button re-detects the description', async () => {
      const desc = document.createElement('div');
      desc.id = 'description';
      desc.textContent = '00:15 delegated reload';
      document.body.appendChild(desc);

      panel.querySelector('#timecode-reload').click();
      expect(panel.querySelector('#timecode-reload').disabled).toBe(true);
      await wait(0);

      expect(items()).toHaveLength(1);
      expect(panel.querySelector('#timecode-reload').disabled).toBe(false);
    });

    test('the header close button hides the panel and stops tracking', () => {
      expect(api.state.trackingId).toBe(1);
      panel.querySelector('#timecode-close').click();
      expect(panel.classList.contains('hidden')).toBe(true);
      expect(api.state.trackingId).toBe(0);
    });

    test('the add button opens the form at the current position', () => {
      video.currentTime = 125;
      panel.querySelector('#timecode-add-btn').click();
      expect(api.state.dom.timeInput.value).toBe('2:05');
    });

    test('the tracking toggle disables tracking and the next tick releases it', () => {
      expect(api.state.trackingId).toBe(1);

      panel.querySelector('#timecode-track-toggle').click();
      expect(api.config.autoTrackPlayback).toBe(false);
      expect(panel.classList.contains('auto-tracking')).toBe(false);

      // The toggle itself only records the preference; the timeupdate handler
      // sees the disabled flag and releases the listener on its next run.
      video.dispatchEvent(new Event('timeupdate'));
      expect(api.state.trackingId).toBe(0);

      panel.querySelector('#timecode-track-toggle').click();
      expect(api.config.autoTrackPlayback).toBe(true);
      expect(api.state.trackingId).toBe(1);
    });

    test('the export button copies the rows', async () => {
      const writeText = jest.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      hooks.updateTimecodePanel([{ time: 90, label: 'Delegated' }]);

      panel.querySelector('#timecode-export-btn').click();
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('1:30 - Delegated'));
    });

    test('the cancel button closes the form', () => {
      hooks.showTimecodeForm(30);
      panel.querySelector('#timecode-form-cancel').click();
      expect(api.state.dom.form.classList.contains('visible')).toBe(false);
    });

    test('the save button adds a row and rejects a bad time', () => {
      panel.querySelector('#timecode-form-save').click();
      expect(window.YouTubeUtils.NotificationManager.show).toHaveBeenCalledWith(
        'invalidTimeFormat',
        expect.anything()
      );

      api.state.dom.timeInput.value = '0:30';
      api.state.dom.labelInput.value = 'Delegated row';
      panel.querySelector('#timecode-form-save').click();
      expect(items()).toHaveLength(1);
    });

    test('the row action buttons edit and delete', async () => {
      hooks.updateTimecodePanel([{ time: 30, label: 'Row' }]);
      const row = items()[0];

      row.querySelector('.timecode-action.edit').click();
      expect(api.state.editingIndex).toBe(0);

      row.querySelector('.timecode-action.delete').click();
      await wait(0);
      expect(items()).toHaveLength(0);
    });

    test('clicking a row seeks without touching the action area', () => {
      hooks.updateTimecodePanel([{ time: 42, label: 'Row' }]);
      video.currentTime = 0;

      items()[0].querySelector('.timecode-label').click();
      expect(video.currentTime).toBe(42);
      expect(video.play).toHaveBeenCalled();

      video.currentTime = 0;
      items()[0].querySelector('.timecode-actions').click();
      expect(video.currentTime).toBe(0);
    });

    test('a row without a usable time never seeks', () => {
      const row = document.createElement('div');
      row.className = 'timecode-item';
      panel.querySelector('#timecode-list').appendChild(row);

      row.click();
      expect(video.currentTime).toBe(0);
    });

    test('an unknown row action is ignored', () => {
      hooks.updateTimecodePanel([{ time: 30, label: 'Row' }]);
      const unknown = document.createElement('button');
      unknown.className = 'timecode-action';
      unknown.dataset.action = 'move';
      items()[0].appendChild(unknown);

      unknown.click();
      expect(api.state.editingIndex).toBeNull();
    });
  });

  describe('settings modal wiring through the shared hosts', () => {
    test('opening the modal attaches the timecode controls', () => {
      const modal = buildModal();
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));

      expect(modal.querySelector('.timecode-settings-item').dataset.handlerAttached).toBe('1');
    });

    test('a section activation wires the controls without the modal event', () => {
      const modal = buildModal();

      document.dispatchEvent(
        new CustomEvent('youtube-plus-settings-section-activated', {
          detail: { section: 'advanced' },
        })
      );
      expect(modal.querySelector('.timecode-settings-item').dataset.handlerAttached).toBe('1');
    });

    test('another section activation changes nothing', () => {
      const modal = buildModal();

      document.dispatchEvent(
        new CustomEvent('youtube-plus-settings-section-activated', {
          detail: { section: 'appearance' },
        })
      );
      expect(
        modal.querySelector('.timecode-settings-item').dataset.handlerAttached
      ).toBeUndefined();
    });

    test('the advanced nav item wires the controls through the delegator', () => {
      const navItem = document.createElement('button');
      navItem.className = 'yp-settings-nav-item';
      navItem.dataset.section = 'advanced';
      document.body.appendChild(navItem);

      const modal = buildModal();
      navItem.click();

      expect(modal.querySelector('.timecode-settings-item').dataset.handlerAttached).toBe('1');
    });

    test('the modal is watched exactly once, however often it is opened', () => {
      store().set('timecodeEnabled', true);
      buildModal();

      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      const afterFirst = coordinator().getStats().rootSubscribers;
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));

      expect(coordinator().getStats().rootSubscribers).toBe(afterFirst);
      expect(afterFirst).toBe(1);
    });

    test('modal mutations schedule one debounced settings check', async () => {
      // The modal observer is registered by init(), which only runs while the
      // feature is on - the settings-integration wiring above is module-scope.
      store().set('timecodeEnabled', true);
      const modal = buildModal({ withItem: false });
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));

      const timeoutSpy = jest.spyOn(window.YouTubeUtils.cleanupManager, 'timeout');
      modal.appendChild(document.createElement('span'));
      await nextFrame();
      expect(timeoutSpy).toHaveBeenCalledTimes(1);

      // A second mutation while the debounce is pending is ignored.
      modal.appendChild(document.createElement('span'));
      await nextFrame();
      expect(timeoutSpy).toHaveBeenCalledTimes(1);

      await wait(60);
      // The timecode block is still missing, so nothing was attached.
      expect(modal.querySelector('.timecode-settings-item')).toBeNull();
    });

    test('a hidden advanced section is left alone', async () => {
      store().set('timecodeEnabled', true);
      const modal = buildModal({ withItem: false });
      modal.querySelector('.yp-settings-section').classList.add('hidden');
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));

      const timeoutSpy = jest.spyOn(window.YouTubeUtils.cleanupManager, 'timeout');
      modal.appendChild(document.createElement('span'));
      await nextFrame();
      await wait(60);

      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      expect(modal.querySelector('.timecode-settings-item')).toBeNull();
    });

    test('the modal watch is released by the shared cleanup', () => {
      store().set('timecodeEnabled', true);
      buildModal({ withItem: false });
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      const watched = coordinator().getStats().rootSubscribers;
      expect(watched).toBe(1);

      cleanup().cleanup();

      expect(coordinator().getStats().rootSubscribers).toBe(0);
    });
  });
});
