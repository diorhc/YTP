/**
 * @jest-environment jsdom
 *
 * Tests the real screenshot.js surface through window.YouTubePlusScreenshot.
 * Earlier versions of this file tested locally reimplemented copies of the
 * module logic; now every assertion checks an effect produced by the actual
 * module code.
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
}

const store = () => window.YouTubePlusSettingsStore;
const controls = () => document.querySelector('.ytp-right-controls');
const listenerCount = () => window.YouTubePlusCleanupManager.getListenerStats().active;

describe('Screenshot Module', () => {
  /** @type {jest.Mock} */
  let getContextSpy;
  /** @type {jest.Mock} */
  let toDataURLSpy;

  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <div id="movie_player">
        <div class="ytp-chrome-bottom"><div class="ytp-right-controls"></div></div>
      </div>`;
    localStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
    loadChain();
    store().set('styles.themeVariant', 'classic');

    // jsdom does not implement 2D canvas context. Provide a minimal stub so
    // the real capture() code can run and produce its DOM/link side effects.
    const mockCtx = { drawImage: jest.fn() };
    getContextSpy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx);
    toDataURLSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,test');

    require('../src/screenshot.js');
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    getContextSpy?.mockRestore();
    toDataURLSpy?.mockRestore();
  });

  test('exposes the real API on window.YouTubePlusScreenshot', () => {
    expect(window.YouTubePlusScreenshot).toBeDefined();
    expect(typeof window.YouTubePlusScreenshot.addButton).toBe('function');
    expect(typeof window.YouTubePlusScreenshot.testHooks.capture).toBe('function');
    expect(typeof window.YouTubePlusScreenshot.registerHotkey).toBe('function');
  });

  test('the running feature mounts one Classic button in the player controls', () => {
    const enhancer = { getElement: () => null, showNotification: jest.fn() };
    window.YouTubePlusScreenshot.addButton(enhancer, controls());
    window.YouTubePlusScreenshot.addButton(enhancer, controls());

    const buttons = controls().querySelectorAll('.yp-screenshot-button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('aria-label')).toBeTruthy();
  });

  test('capture draws the real video to a canvas and triggers a download', () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      /* mock */
    });

    const video = document.createElement('video');
    Object.defineProperties(video, {
      videoWidth: { value: 1920 },
      videoHeight: { value: 1080 },
    });

    const enhancer = {
      getElement: (/** @type {string} */ type) => (type === 'video' ? video : null),
      showNotification: jest.fn(),
    };

    const result = window.YouTubePlusScreenshot.testHooks.capture(enhancer);

    expect(result).toBe(true);
    expect(clickSpy).toHaveBeenCalled();
    expect(enhancer.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('Screenshot'),
      2000
    );

    clickSpy.mockRestore();
  });

  test('capture reports failure when no video is found', () => {
    const enhancer = {
      getElement: () => null,
      showNotification: jest.fn(),
    };

    const result = window.YouTubePlusScreenshot.testHooks.capture(enhancer);

    expect(result).toBe(false);
    // The real module returns false immediately when no video is present;
    // it does not show a notification in this path.
    expect(enhancer.showNotification).not.toHaveBeenCalled();
  });

  test('10 on/off cycles leave no button, hotkey, listener or CSS behind', () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      /* mock */
    });
    const video = document.createElement('video');
    document.querySelector('#movie_player').appendChild(video);
    const enhancer = { getElement: () => video, showNotification: jest.fn() };
    window.YouTubePlusScreenshot.registerHotkey(enhancer);

    store().set('enableScreenshot', false);
    const baseline = listenerCount();
    for (let i = 0; i < 10; i++) {
      store().set('enableScreenshot', true);
      expect(controls().querySelector('.yp-screenshot-button')).not.toBeNull();
      store().set('enableScreenshot', false);
    }

    expect(listenerCount()).toBe(baseline);
    expect(document.querySelector('.yp-screenshot-button')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(clickSpy).not.toHaveBeenCalled();

    store().set('enableScreenshot', true);
    controls().querySelector('.yp-screenshot-button').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(clickSpy).toHaveBeenCalledTimes(2);
    clickSpy.mockRestore();
  });

  test('registerHotkey captures a screenshot when S is pressed', () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      /* mock */
    });
    const video = document.createElement('video');
    Object.defineProperties(video, {
      videoWidth: { value: 640 },
      videoHeight: { value: 360 },
    });

    const enhancer = {
      getElement: (/** @type {string} */ type) => (type === 'video' ? video : null),
      showNotification: jest.fn(),
      isEditableTarget: () => false,
    };

    window.YouTubePlusScreenshot.registerHotkey(enhancer);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));

    expect(clickSpy).toHaveBeenCalled();
    expect(enhancer.showNotification).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  test('registerHotkey ignores S with modifiers', () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      /* mock */
    });
    const enhancer = {
      getElement: () => null,
      showNotification: jest.fn(),
      isEditableTarget: () => false,
    };

    window.YouTubePlusScreenshot.registerHotkey(enhancer);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', shiftKey: true, bubbles: true })
    );

    expect(clickSpy).not.toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  test('capture failure path: link.click() throw reports failure via fallback toast', () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('download blocked');
    });
    const video = document.createElement('video');
    Object.defineProperties(video, {
      videoWidth: { value: 640 },
      videoHeight: { value: 360 },
    });

    const enhancer = {
      getElement: (/** @type {string} */ type) => (type === 'video' ? video : null),
      showNotification: jest.fn(),
    };

    const result = window.YouTubePlusScreenshot.testHooks.capture(enhancer);

    expect(result).toBe(false);
    // Failure path reports the failure (through the enhancer toast here).
    expect(enhancer.showNotification).toHaveBeenCalledWith(expect.stringContaining('failed'), 3000);

    clickSpy.mockRestore();
  });

  test('showNotification falls back to the PopoverController when enhancer has none', () => {
    const showToast = jest.fn();
    window.YouTubePlusPopoverController = { showToast };

    const video = document.createElement('video');
    Object.defineProperties(video, {
      videoWidth: { value: 640 },
      videoHeight: { value: 360 },
    });
    const enhancer = {
      getElement: (/** @type {string} */ type) => (type === 'video' ? video : null),
      // No showNotification on the enhancer — exercises the popover path.
    };

    const result = window.YouTubePlusScreenshot.testHooks.capture(enhancer);

    expect(result).toBe(true);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Screenshot'),
      expect.anything()
    );

    delete window.YouTubePlusPopoverController;
  });

  describe('shortcut settings and handlers', () => {
    test('getSettings returns default shortcut configuration', () => {
      const settings = window.YouTubePlusScreenshot.getSettings();
      expect(settings.storageKey).toBe('youtube_screenshot_settings');
      expect(settings.shortcut).toEqual({
        key: 'S',
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
      });
    });

    test('loadSettings reads shortcut preferences from storage and normalizes values', () => {
      localStorage.setItem(
        'youtube_screenshot_settings',
        JSON.stringify({
          shortcut: { key: ' x ', shiftKey: true, altKey: false, ctrlKey: true },
        })
      );
      window.YouTubePlusScreenshot.loadSettings();
      const settings = window.YouTubePlusScreenshot.getSettings();
      expect(settings.shortcut.key).toBe('X');
      expect(settings.shortcut.shiftKey).toBe(true);
      expect(settings.shortcut.altKey).toBe(false);
      expect(settings.shortcut.ctrlKey).toBe(true);
    });

    test('saveSettings persists shortcut preferences to storage', () => {
      const settings = window.YouTubePlusScreenshot.getSettings();
      settings.shortcut.key = 'Z';
      settings.shortcut.altKey = true;
      window.YouTubePlusScreenshot.saveSettings();

      const stored = JSON.parse(localStorage.getItem('youtube_screenshot_settings') || '{}');
      expect(stored.shortcut.key).toBe('Z');
      expect(stored.shortcut.altKey).toBe(true);
    });

    test('attachSettingsHandlers binds modifier and key inputs and saves changes', () => {
      document.body.innerHTML = `
        <div class="screenshot-submenu">
          <select id="screenshot-modifier-dropdown">
            <option value="none">None</option>
            <option value="ctrl">Ctrl</option>
            <option value="alt">Alt</option>
            <option value="shift">Shift</option>
            <option value="ctrl+alt">Ctrl + Alt</option>
          </select>
          <input type="hidden" id="screenshot-modifier-combo" value="none" />
          <input type="text" id="screenshot-key" value="S" />
        </div>
      `;

      window.YouTubePlusScreenshot.attachSettingsHandlers();

      const select = /** @type {HTMLSelectElement} */ (
        document.getElementById('screenshot-modifier-dropdown')
      );
      const hidden = /** @type {HTMLInputElement} */ (
        document.getElementById('screenshot-modifier-combo')
      );
      const keyInput = /** @type {HTMLInputElement} */ (document.getElementById('screenshot-key'));

      // Change modifier dropdown to ctrl+alt
      select.value = 'ctrl+alt';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      expect(hidden.value).toBe('ctrl+alt');
      let current = window.YouTubePlusScreenshot.getSettings();
      expect(current.shortcut.ctrlKey).toBe(true);
      expect(current.shortcut.altKey).toBe(true);
      expect(current.shortcut.shiftKey).toBe(false);

      // Change key input to 'w'
      keyInput.value = 'w';
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));

      current = window.YouTubePlusScreenshot.getSettings();
      expect(current.shortcut.key).toBe('W');
      expect(keyInput.value).toBe('W');

      // Keydown on key input stops propagation
      const keyEvent = new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true });
      const stopPropagationSpy = jest.spyOn(keyEvent, 'stopPropagation');
      keyInput.dispatchEvent(keyEvent);
      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    test('onHotkey respects custom configured shortcut modifiers and key', () => {
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const video = document.createElement('video');
      Object.defineProperties(video, {
        videoWidth: { value: 640 },
        videoHeight: { value: 360 },
      });

      const enhancer = {
        getElement: (/** @type {string} */ type) => (type === 'video' ? video : null),
        showNotification: jest.fn(),
        isEditableTarget: () => false,
      };

      // Set shortcut to Ctrl + Shift + P
      const settings = window.YouTubePlusScreenshot.getSettings();
      settings.shortcut = {
        key: 'P',
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
      };

      window.YouTubePlusScreenshot.registerHotkey(enhancer);

      // Pressing P alone should not fire
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
      expect(clickSpy).not.toHaveBeenCalled();

      // Pressing Ctrl + P should not fire (missing shift)
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true })
      );
      expect(clickSpy).not.toHaveBeenCalled();

      // Pressing Ctrl + Shift + P SHOULD fire
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true, bubbles: true })
      );
      expect(clickSpy).toHaveBeenCalledTimes(1);

      clickSpy.mockRestore();
    });

    test('modal opened event automatically initializes and binds settings handlers', () => {
      document.body.innerHTML = `
        <div class="screenshot-submenu">
          <select id="screenshot-modifier-dropdown">
            <option value="none">None</option>
            <option value="ctrl">Ctrl</option>
          </select>
          <input type="hidden" id="screenshot-modifier-combo" value="none" />
          <input type="text" id="screenshot-key" value="S" />
        </div>
      `;

      // Save custom shortcut to storage first
      localStorage.setItem(
        'youtube_screenshot_settings',
        JSON.stringify({
          shortcut: { key: 'K', ctrlKey: true, shiftKey: false, altKey: false },
        })
      );

      // Dispatch modal opened event
      document.dispatchEvent(new CustomEvent('youtube-plus-settings-modal-opened'));

      const select = /** @type {HTMLSelectElement} */ (
        document.getElementById('screenshot-modifier-dropdown')
      );
      const hidden = /** @type {HTMLInputElement} */ (
        document.getElementById('screenshot-modifier-combo')
      );
      const keyInput = /** @type {HTMLInputElement} */ (document.getElementById('screenshot-key'));

      expect(hidden.value).toBe('ctrl');
      expect(select.value).toBe('ctrl');
      expect(keyInput.value).toBe('K');
    });
  });

  describe('settings handler fallback paths', () => {
    /**
     * Build a `.screenshot-settings-item` fixture.
     * @param {{ withLabel?: boolean, withKeyField?: boolean, dropdownTag?: string }} [opts]
     */
    const mountItem = (opts = {}) => {
      const { withLabel = false, withKeyField = true, dropdownTag = 'select' } = opts;
      const item = document.createElement('div');
      item.className = 'screenshot-settings-item';

      const dd = document.createElement(dropdownTag);
      dd.id = 'screenshot-modifier-dropdown';
      if (dropdownTag === 'select') {
        for (const value of ['none', 'ctrl', 'alt', 'shift', 'ctrl+alt']) {
          const option = document.createElement('option');
          option.value = value;
          dd.appendChild(option);
        }
      }
      if (withLabel) {
        const labelEl = document.createElement('span');
        labelEl.className = 'glass-dropdown__label';
        dd.appendChild(labelEl);
      }

      const combo = document.createElement('input');
      combo.type = 'hidden';
      combo.id = 'screenshot-modifier-combo';
      item.append(dd, combo);

      if (withKeyField) {
        const keyField = document.createElement('input');
        keyField.type = 'text';
        keyField.id = 'screenshot-key';
        item.appendChild(keyField);
      }

      document.body.appendChild(item);
      return item;
    };

    test('capture without an enhancer falls back to the page video element', () => {
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const video = document.createElement('video');
      Object.defineProperties(video, { videoWidth: { value: 320 }, videoHeight: { value: 180 } });
      document.querySelector('#movie_player').appendChild(video);

      const result = window.YouTubePlusScreenshot.testHooks.capture();

      expect(result).toBe(true);
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    test('attachSettingsHandlers accepts the submenu element and applies stored modifiers', () => {
      window.YouTubePlusScreenshot.testHooks.screenshotSettings.shortcut = {
        key: 'K',
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
      };
      const item = mountItem();

      window.YouTubePlusScreenshot.attachSettingsHandlers(item);

      const combo = /** @type {HTMLInputElement} */ (
        document.getElementById('screenshot-modifier-combo')
      );
      expect(combo.value).toBe('ctrl+alt');
    });

    test('attachSettingsHandlers without a key input binds only the modifier controls', () => {
      const item = mountItem({ withKeyField: false });

      expect(() => window.YouTubePlusScreenshot.attachSettingsHandlers(item)).not.toThrow();

      const combo = /** @type {HTMLInputElement} */ (
        document.getElementById('screenshot-modifier-combo')
      );
      expect(combo.value).toBe('none');
    });

    test('a glass dropdown label is populated from the modifier combo', () => {
      const item = mountItem({ withLabel: true, dropdownTag: 'div' });

      window.YouTubePlusScreenshot.attachSettingsHandlers(item);

      expect(item.querySelector('.glass-dropdown__label')?.textContent).toBe('none');
    });

    test('changing the modifier select writes the combo to the hidden input and the store', () => {
      const item = mountItem();
      window.YouTubePlusScreenshot.attachSettingsHandlers(item);

      const dd = /** @type {HTMLSelectElement} */ (
        document.getElementById('screenshot-modifier-dropdown')
      );
      const combo = /** @type {HTMLInputElement} */ (
        document.getElementById('screenshot-modifier-combo')
      );
      dd.value = 'ctrl+alt';
      dd.dispatchEvent(new Event('change', { bubbles: true }));

      expect(combo.value).toBe('ctrl+alt');
      const current = window.YouTubePlusScreenshot.getSettings();
      expect(current.shortcut.ctrlKey).toBe(true);
      expect(current.shortcut.altKey).toBe(true);
    });
  });
});
