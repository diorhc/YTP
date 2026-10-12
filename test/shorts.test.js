/**
 * @jest-environment jsdom
 *
 * Shorts keyboard controls and the Shorts download button (src/shorts.js)
 * on the FeatureLifecycle contract, with the real CleanupManager,
 * SettingsStore, EventDelegation, MutationCoordinator and registry.
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/mutation-coordinator.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
}

const SHORTS_HREF = 'https://www.youtube.com/shorts/abc123';
const store = () => window.YouTubePlusSettingsStore;
const hooks = () => window.YouTubePlusShorts.testHooks;
const listenerCount = () => window.YouTubePlusCleanupManager.getListenerStats().active;
const video = () => /** @type {HTMLVideoElement} */ (document.querySelector('video'));

/** @param {string} pathname */
const goTo = pathname => {
  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname,
    href: `https://www.youtube.com${pathname}`,
  });
  window.dispatchEvent(new Event('yt-navigate-finish'));
};

/**
 * @param {string} key
 * @param {Record<string, unknown>} [extra]
 */
const press = (key, extra = {}) =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
  );

const mountReel = () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<ytd-reel-video-renderer is-active>
       <div id="actions"><div id="like-button"><button aria-label="Like"></button></div></div>
     </ytd-reel-video-renderer>`
  );
};

/** @param {string | null} [saved] */
const load = (saved = null) => {
  if (saved) localStorage.setItem('youtube_shorts_keyboard_settings', saved);
  loadChain();
  require('../src/shorts.js');
};

const resetPage = () => {
  jest.resetModules();
  document.head.innerHTML = '';
  document.body.innerHTML = '<video></video>';
  localStorage.clear();
  localStorage.setItem('shorts_keyboard_help_shown', 'true');
  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/shorts/abc123',
    href: SHORTS_HREF,
  });
};

describe('Shorts keyboard controls', () => {
  beforeEach(resetPage);

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    // Each test loads its own design system; the next one must not fight
    // this one's style-host observer.
    window.YouTubePlusDesignSystem?.StyleManager?.clear?.();
  });

  test('defaults cover every documented action', () => {
    load();
    const defaults = hooks().getDefaultShortcuts();
    expect(Object.keys(defaults)).toEqual([
      'seekBackward',
      'seekForward',
      'volumeUp',
      'volumeDown',
      'mute',
      'toggleCaptions',
      'showHelp',
    ]);
    expect(defaults.showHelp.editable).toBe(false);
    expect(hooks().getSettings().shortcuts.mute.key).toBe('m');
  });

  test('persisted bindings merge into the defaults and replace the default key', () => {
    load(JSON.stringify({ shortcuts: { mute: { key: 'x' } } }));
    expect(hooks().getSettings().shortcuts.mute.key).toBe('x');
    expect(hooks().getSettings().shortcuts.seekBackward.key).toBe('ArrowLeft');

    press('m');
    expect(video().muted).toBe(false);
    press('x');
    expect(video().muted).toBe(true);
  });

  test('malformed persisted settings keep the defaults', () => {
    load('{not json');
    expect(hooks().getSettings().shortcuts.mute.key).toBe('m');
  });

  test('getSettings returns a copy', () => {
    load();
    const first = hooks().getSettings();
    first.shortcuts.mute = { key: 'z', description: '' };
    expect(hooks().getSettings().shortcuts.mute.key).toBe('m');
  });

  test('isOnShortsPage follows the route', () => {
    load();
    expect(hooks().isOnShortsPage()).toBe(true);
    goTo('/watch');
    expect(hooks().isOnShortsPage()).toBe(false);
    goTo('/');
    expect(hooks().isOnShortsPage()).toBe(false);
  });

  test('seek, volume and numpad keys act on the active video', () => {
    load();
    const v = video();
    v.currentTime = 20;
    press('ArrowLeft');
    expect(v.currentTime).toBe(15);
    press('ArrowRight');
    expect(v.currentTime).toBe(20);

    v.volume = 0.5;
    press('+');
    expect(v.volume).toBeCloseTo(0.6);
    press('-');
    expect(v.volume).toBeCloseTo(0.5);
    press('x', { code: 'NumpadAdd' });
    expect(v.volume).toBeCloseTo(0.6);
    press('x', { code: 'NumpadSubtract' });
    expect(v.volume).toBeCloseTo(0.5);
  });

  test('captions key reports when the video has no captions', () => {
    load();
    press('c');
    expect(document.getElementById('shorts-keyboard-feedback')?.textContent).toBe(
      window.YouTubeUtils.t('captionsUnavailable')
    );
  });

  test('keys do nothing off /shorts or in a text field', () => {
    load();
    const v = video();
    v.currentTime = 20;
    goTo('/watch');
    press('ArrowLeft');
    expect(v.currentTime).toBe(20);

    goTo('/shorts/abc123');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press('ArrowLeft');
    expect(v.currentTime).toBe(20);
  });

  test('the help panel opens with ?, closes with Escape and with an outside click', () => {
    load();
    press('?');
    const panel = document.getElementById('shorts-keyboard-help');
    expect(panel.classList.contains('visible')).toBe(true);
    press('Escape');
    expect(panel.classList.contains('visible')).toBe(false);

    press('?');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel.classList.contains('visible')).toBe(false);
  });

  test('a shortcut is rebound from the help panel and persisted', () => {
    load();
    press('?');
    document.querySelector('#shorts-keyboard-help kbd[data-action="mute"]').click();
    expect(document.querySelector('.shortcut-edit-dialog')).not.toBeNull();

    press('k');
    expect(document.querySelector('.shortcut-edit-dialog')).toBeNull();
    expect(hooks().getSettings().shortcuts.mute.key).toBe('k');
    const saved = JSON.parse(localStorage.getItem('youtube_shorts_keyboard_settings'));
    expect(saved.shortcuts.mute.key).toBe('k');
    expect(
      document.querySelector('#shorts-keyboard-help kbd[data-action="mute"]').textContent
    ).toBe('k');

    press('k');
    expect(video().muted).toBe(true);
  });

  test('a key used by another action is refused and Escape closes the dialog', () => {
    load();
    press('?');
    document.querySelector('#shorts-keyboard-help kbd[data-action="mute"]').click();
    press('c');
    expect(document.querySelector('.shortcut-edit-dialog')).not.toBeNull();
    expect(hooks().getSettings().shortcuts.mute.key).toBe('m');
    press('Escape');
    expect(document.querySelector('.shortcut-edit-dialog')).toBeNull();
  });

  test('reset-all asks the in-page dialog and restores the defaults', async () => {
    load(JSON.stringify({ shortcuts: { seekBackward: { key: 'J' } } }));
    window.YouTubeUtils.confirmDialog = jest.fn(async () => true);
    const confirmSpy = jest.spyOn(window, 'confirm');

    press('?');
    document.querySelector('#shorts-keyboard-help .reset-all-shortcuts').click();
    await new Promise(r => setTimeout(r, 0));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(window.YouTubeUtils.confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: window.YouTubeUtils.t('resetAllConfirm') })
    );
    expect(hooks().getSettings().shortcuts.seekBackward.key).toBe('ArrowLeft');
    confirmSpy.mockRestore();
  });

  test('declining reset-all keeps the custom bindings', async () => {
    load(JSON.stringify({ shortcuts: { seekBackward: { key: 'J' } } }));
    window.YouTubeUtils.confirmDialog = jest.fn(async () => false);
    press('?');
    document.querySelector('#shorts-keyboard-help .reset-all-shortcuts').click();
    await new Promise(r => setTimeout(r, 0));
    expect(hooks().getSettings().shortcuts.seekBackward.key).toBe('J');
  });

  test('leaving /shorts removes the help panel and the feedback', () => {
    load();
    press('?');
    press('ArrowLeft');
    expect(document.getElementById('shorts-keyboard-help')).not.toBeNull();
    expect(document.getElementById('shorts-keyboard-feedback')).not.toBeNull();
    goTo('/watch');
    expect(document.getElementById('shorts-keyboard-help')).toBeNull();
    expect(document.getElementById('shorts-keyboard-feedback')).toBeNull();
  });

  test('10 on/off cycles leave no listener, panel or timer behind', () => {
    load();
    const cm = window.YouTubePlusCleanupManager;
    store().set('shortsKeyboard', false);
    const baseline = { listeners: listenerCount(), timeouts: cm.timeouts.size };

    for (let i = 0; i < 10; i++) {
      store().set('shortsKeyboard', true);
      press('?');
      press('ArrowLeft');
      expect(document.getElementById('shorts-keyboard-help')).not.toBeNull();
      store().set('shortsKeyboard', false);
    }

    expect({ listeners: listenerCount(), timeouts: cm.timeouts.size }).toEqual(baseline);
    expect(document.getElementById('shorts-keyboard-help')).toBeNull();
    expect(document.getElementById('shorts-keyboard-feedback')).toBeNull();
    const v = video();
    v.currentTime = 20;
    press('ArrowLeft');
    expect(v.currentTime).toBe(20);

    store().set('shortsKeyboard', true);
    press('ArrowLeft');
    expect(v.currentTime).toBe(15);
  });

  test('the first visit shows the help tip once', () => {
    localStorage.removeItem('shorts_keyboard_help_shown');
    jest.useFakeTimers();
    try {
      load();
      jest.advanceTimersByTime(2000);
      expect(document.getElementById('shorts-keyboard-feedback')?.textContent).toContain('?');
      expect(localStorage.getItem('shorts_keyboard_help_shown')).toBe('true');
    } finally {
      jest.useRealTimers();
    }
  });

  test('the legacy flag moves into the store', () => {
    load(JSON.stringify({ enabled: false, shortcuts: { mute: { key: 'x' } } }));
    expect(store().get('shortsKeyboard')).toBe(false);
    expect(JSON.parse(localStorage.getItem('youtube_shorts_keyboard_settings'))).toEqual({
      shortcuts: { mute: { key: 'x' } },
    });
    const v = video();
    v.currentTime = 20;
    press('ArrowLeft');
    expect(v.currentTime).toBe(20);
  });
});

describe('Shorts download button', () => {
  beforeEach(() => {
    resetPage();
    mountReel();
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    // Each test loads its own design system; the next one must not fight
    // this one's style-host observer.
    window.YouTubePlusDesignSystem?.StyleManager?.clear?.();
  });

  const button = () => document.querySelector('.yp-shorts-download');

  test('sits before the like button and opens the download modal', () => {
    load();
    expect(button()).not.toBeNull();
    expect(button().nextElementSibling?.id).toBe('like-button');

    window.YouTubePlusDownload = { openModal: jest.fn() };
    button().click();
    expect(window.YouTubePlusDownload.openModal).toHaveBeenCalledTimes(1);
    delete window.YouTubePlusDownload;
  });

  test('follows enableDownload and the route, leaving nothing behind', () => {
    load();
    store().set('enableDownload', false);
    const baseline = listenerCount();
    for (let i = 0; i < 10; i++) {
      store().set('enableDownload', true);
      expect(button()).not.toBeNull();
      store().set('enableDownload', false);
      expect(button()).toBeNull();
    }
    expect(listenerCount()).toBe(baseline);

    store().set('enableDownload', true);
    goTo('/watch');
    expect(button()).toBeNull();
    goTo('/shorts/abc123');
    expect(button()).not.toBeNull();
  });

  test('stays when only the keyboard feature is switched off', () => {
    load();
    store().set('shortsKeyboard', false);
    expect(button()).not.toBeNull();
  });

  test('same-route navigation refreshes the mount; a later reel re-anchors it', async () => {
    load();
    const first = button();
    expect(first).not.toBeNull();

    // Same-route navigation: the page group survives and the sync refreshes
    // the existing mount instead of rebuilding it.
    goTo('/shorts/abc123');
    expect(button()).toBe(first);

    // A newly mounted reel arrives through the coordinator's root
    // subscription: the frame-queued ensure re-anchors the button next to
    // the new active reel's like button.
    document.querySelector('ytd-reel-video-renderer[is-active]')?.removeAttribute('is-active');
    document.body.insertAdjacentHTML(
      'beforeend',
      `<ytd-reel-video-renderer is-active="true">
         <div id="actions"><div id="like-button"><button aria-label="Like"></button></div></div>
       </ytd-reel-video-renderer>`
    );
    const deadline = Date.now() + 1500;
    while (
      Date.now() < deadline &&
      (!button() ||
        button().closest('ytd-reel-video-renderer') === first.closest('ytd-reel-video-renderer'))
    ) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(button()).not.toBeNull();
    expect(button().closest('ytd-reel-video-renderer')).not.toBe(
      first.closest('ytd-reel-video-renderer')
    );
  });
});
