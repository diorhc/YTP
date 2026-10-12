/**
 * @jest-environment jsdom
 *
 * Tests the real modal-handlers.js surface through window.YouTubePlusModalHandlers.
 * Earlier versions of this file tested locally reimplemented copies of
 * setSettingByPath / initializeDownloadSites; now every assertion exercises
 * the actual exported methods.
 */

describe('ModalHandlers', () => {
  beforeEach(() => {
    jest.resetModules();

    Object.defineProperty(window, 'YouTubePlusDOMCache', {
      configurable: true,
      writable: true,
      value: {
        get: jest.fn(sel => document.querySelector(sel)),
        getAll: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
        querySelector: jest.fn((sel, ctx = document) => ctx.querySelector(sel)),
        querySelectorAll: jest.fn((sel, ctx = document) => Array.from(ctx.querySelectorAll(sel))),
        getElementById: jest.fn(id => document.getElementById(id)),
        waitForElement: jest.fn(async sel => document.querySelector(sel)),
        invalidate: jest.fn(),
        getStats: jest.fn(() => ({})),
      },
    });

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: {
        $: jest.fn(sel => {
          const el = document.querySelector(sel);
          return el instanceof HTMLElement ? el : null;
        }),
        t: jest.fn(key => key || ''),
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
        storage: { getItem: jest.fn(() => ''), setItem: jest.fn(), removeItem: jest.fn() },
        get cleanupManager() {
          return window.YouTubePlusCleanupManager || null;
        },
      },
    });

    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        registerListener: jest.fn((target, type, handler, options) => {
          target.addEventListener(type, handler, options);
          return Symbol('cm-key');
        }),
        unregisterListener: jest.fn(),
        registerAnimationFrame: jest.fn(id => id),
        timeout: jest.fn(),
      },
    });

    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    Object.defineProperty(window, 'YouTubePlusDesignSystem', {
      configurable: true,
      writable: true,
      value: {
        applyThemePreference: jest.fn(),
      },
    });

    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: {
        save: jest.fn(),
      },
    });

    require('../src/modal-handlers.js');
    require('../src/modal-download-handlers.js');
  });

  test('exposes the real API on window.YouTubePlusModalHandlers', () => {
    expect(window.YouTubePlusModalHandlers).toBeDefined();
    expect(typeof window.YouTubePlusModalHandlers.setSettingByPath).toBe('function');
    expect(typeof window.YouTubePlusModalHandlers.initializeDownloadSites).toBe('function');
    expect(typeof window.YouTubePlusModalHandlers.toggleDownloadSiteControls).toBe('function');
    expect(typeof window.YouTubePlusModalHandlers.handleSimpleSettingToggle).toBe('function');
    expect(typeof window.YouTubePlusModalHandlers.applySettingLive).toBe('function');
    expect(typeof window.YouTubePlusModalHandlers.createFocusTrap).toBe('function');
  });

  describe('setSettingByPath', () => {
    test('sets a simple key', () => {
      const settings = {};
      window.YouTubePlusModalHandlers.setSettingByPath(settings, 'volume', 80);
      expect(settings.volume).toBe(80);
    });

    test('sets a nested key', () => {
      const settings = {};
      window.YouTubePlusModalHandlers.setSettingByPath(settings, 'download.quality', '1080p');
      expect(settings.download).toEqual({ quality: '1080p' });
    });

    test('does not throw on invalid inputs', () => {
      const settings = {};
      expect(() =>
        window.YouTubePlusModalHandlers.setSettingByPath(null, 'key', 'value')
      ).not.toThrow();
      expect(() =>
        window.YouTubePlusModalHandlers.setSettingByPath(settings, '', 'value')
      ).not.toThrow();
      expect(() =>
        window.YouTubePlusModalHandlers.setSettingByPath(settings, null, 'value')
      ).not.toThrow();
    });
  });

  describe('initializeDownloadSites', () => {
    test('fills in defaults when missing', () => {
      const settings = {};
      window.YouTubePlusModalHandlers.initializeDownloadSites(settings);
      expect(settings.downloadSites).toEqual({
        externalDownloader: true,
        ytdl: true,
        direct: true,
      });
    });

    test('migrates old y2mate key to externalDownloader', () => {
      const settings = { downloadSites: { y2mate: true, ytdl: false, direct: false } };
      window.YouTubePlusModalHandlers.initializeDownloadSites(settings);
      expect(settings.downloadSites).toEqual({
        externalDownloader: true,
        ytdl: false,
        direct: false,
      });
    });

    test('does not overwrite existing values', () => {
      const settings = { downloadSites: { externalDownloader: false, ytdl: true, direct: false } };
      window.YouTubePlusModalHandlers.initializeDownloadSites(settings);
      expect(settings.downloadSites).toEqual({
        externalDownloader: false,
        ytdl: true,
        direct: false,
      });
    });
  });

  describe('toggleDownloadSiteControls', () => {
    test('shows controls when checkbox is checked', () => {
      const container = document.createElement('div');
      container.className = 'download-site-option';
      const controls = document.createElement('div');
      controls.className = 'download-site-controls';
      controls.style.display = 'none';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      container.append(checkbox, controls);

      window.YouTubePlusModalHandlers.toggleDownloadSiteControls(checkbox);

      expect(controls.style.display).toBe('block');
    });

    test('hides controls when checkbox is unchecked', () => {
      const container = document.createElement('div');
      container.className = 'download-site-option';
      const controls = document.createElement('div');
      controls.className = 'download-site-controls';
      controls.style.display = 'block';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      container.append(checkbox, controls);

      window.YouTubePlusModalHandlers.toggleDownloadSiteControls(checkbox);

      expect(controls.style.display).toBe('none');
    });
  });

  describe('applySettingLive', () => {
    test('applies theme preference through design system', () => {
      const applyThemePreference = window.YouTubePlusDesignSystem.applyThemePreference;
      const context = {
        settings: { styles: { themePreference: 'dark' } },
      };

      window.YouTubePlusModalHandlers.applySettingLive('styles.themePreference', context);

      expect(applyThemePreference).toHaveBeenCalledWith('dark');
    });
  });

  describe('handleSimpleSettingToggle', () => {
    test('writes checked state to settings and fills default columns', () => {
      const target = document.createElement('input');
      target.type = 'checkbox';
      target.checked = true;

      const settings = {};
      const modal = document.createElement('div');
      const saveSettings = jest.fn();

      window.YouTubePlusModalHandlers.handleSimpleSettingToggle(
        target,
        'styles.sideVideosColumnsEnabled',
        settings,
        { settings },
        saveSettings,
        modal
      );

      expect(settings.styles.sideVideosColumnsEnabled).toBe(true);
      expect(settings.styles.sideVideosColumns).toBe(1);
      expect(saveSettings).toHaveBeenCalled();
    });
  });

  describe('a live update that throws', () => {
    test('the toggle is still saved', () => {
      const target = document.createElement('input');
      target.type = 'checkbox';
      target.checked = true;

      const settings = {};
      const saveSettings = jest.fn();
      const context = {
        settings,
        updatePageBasedOnSettings: () => {
          throw new Error('dock mount failed');
        },
      };

      window.YouTubePlusModalHandlers.handleSimpleSettingToggle(
        target,
        'enableZoom',
        settings,
        context,
        saveSettings,
        document.createElement('div')
      );

      expect(settings.enableZoom).toBe(true);
      expect(saveSettings).toHaveBeenCalled();
    });
  });

  describe('createFocusTrap', () => {
    test('returns a cleanup function that removes the listener', () => {
      const container = document.createElement('div');
      const button = document.createElement('button');
      // jsdom reports offsetParent === null for unattached elements, so stub it
      // so the real focus-trap code considers the button focusable.
      Object.defineProperty(button, 'offsetParent', { value: container, configurable: true });
      container.appendChild(button);
      document.body.appendChild(container);

      const removeTrap = window.YouTubePlusModalHandlers.createFocusTrap(container);
      expect(typeof removeTrap).toBe('function');

      // The real focus handler calls e.preventDefault() when the activeElement
      // equals the last focusable element and Tab is pressed.  Set the active
      // element and focusable stub so the condition is satisfied.
      button.focus();
      Object.defineProperty(document, 'activeElement', { value: button, configurable: true });

      const activeEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(activeEvent);
      expect(activeEvent.defaultPrevented).toBe(true);

      // After cleanup, the same event should no longer be intercepted.
      removeTrap();
      const inactiveEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(inactiveEvent);
      expect(inactiveEvent.defaultPrevented).toBe(false);

      // Restore the real activeElement getter for the following tests.
      delete document.activeElement;
      container.remove();
    });
  });

  describe('handleModalClickActions', () => {
    test('dispatches sidebar navigation when nav item is clicked', () => {
      const modal = document.createElement('div');
      const navItem = document.createElement('div');
      navItem.className = 'yp-settings-nav-item';
      modal.appendChild(navItem);

      const handlers = {
        handleSidebarNavigation: jest.fn(),
      };

      window.YouTubePlusModalHandlers.handleModalClickActions(
        navItem,
        modal,
        handlers,
        {},
        key => key
      );

      expect(handlers.handleSidebarNavigation).toHaveBeenCalledWith(navItem, modal);
    });

    test('saves settings, fires event, removes modal, and shows notification on save button click', () => {
      const modal = document.createElement('div');
      document.body.appendChild(modal);
      const saveBtn = document.createElement('button');
      saveBtn.id = 'yp-save-settings';
      modal.appendChild(saveBtn);

      const saveSettings = jest.fn();
      const showNotification = jest.fn();
      const closedEventSpy = jest.fn();
      document.addEventListener('youtube-plus-settings-modal-closed', closedEventSpy);

      window.YouTubePlusModalHandlers.handleModalClickActions(
        saveBtn,
        modal,
        {},
        { saveSettings, showNotification },
        key => `translated:${key}`
      );

      expect(saveSettings).toHaveBeenCalled();
      expect(closedEventSpy).toHaveBeenCalled();
      expect(document.body.contains(modal)).toBe(false);
      expect(showNotification).toHaveBeenCalledWith('translated:settingsSaved');

      document.removeEventListener('youtube-plus-settings-modal-closed', closedEventSpy);
    });

    test('dispatches external downloader save and reset actions', () => {
      const modal = document.createElement('div');
      const saveBtn = document.createElement('button');
      saveBtn.id = 'download-externalDownloader-save';
      const resetBtn = document.createElement('button');
      resetBtn.id = 'download-externalDownloader-reset';

      const handlers = {
        handleExternalDownloaderSave: jest.fn(),
        handleExternalDownloaderReset: jest.fn(),
      };
      const context = { settings: {}, saveSettings: jest.fn(), showNotification: jest.fn() };

      window.YouTubePlusModalHandlers.handleModalClickActions(
        saveBtn,
        modal,
        handlers,
        context,
        k => k
      );
      expect(handlers.handleExternalDownloaderSave).toHaveBeenCalled();

      window.YouTubePlusModalHandlers.handleModalClickActions(
        resetBtn,
        modal,
        handlers,
        context,
        k => k
      );
      expect(handlers.handleExternalDownloaderReset).toHaveBeenCalled();
    });
  });

  describe('handleThemeOptionsClick', () => {
    test('handles style button clicks with data-layout and data-style', () => {
      const modal = document.createElement('div');
      const styleBtn = document.createElement('button');
      styleBtn.className = 'yp-theme-style-btn';
      styleBtn.dataset.layout = 'glass';
      styleBtn.dataset.style = 'material';
      modal.appendChild(styleBtn);

      const settings = { styles: {} };
      const saveSettings = jest.fn();
      const handlers = window.YouTubePlusModalHandlers;
      const context = { settings, saveSettings };

      const handled = handlers.handleThemeOptionsClick(styleBtn, modal, handlers, context);
      expect(handled).toBe(true);
      expect(settings.styles.themeVariant).toBe('glass');
      expect(settings.styles.themeStyle).toBe('material');
      expect(saveSettings).toHaveBeenCalled();
    });

    test('handles theme preference card clicks', () => {
      const modal = document.createElement('div');
      const card = document.createElement('div');
      card.className = 'yp-theme-card';
      card.dataset.settingCard = 'styles.themePreference';
      card.dataset.value = 'dark';
      modal.appendChild(card);

      const settings = { styles: {} };
      const saveSettings = jest.fn();
      const handlers = window.YouTubePlusModalHandlers;
      const context = { settings, saveSettings };

      const handled = handlers.handleThemeOptionsClick(card, modal, handlers, context);
      expect(handled).toBe(true);
      expect(settings.styles.themePreference).toBe('dark');
      expect(saveSettings).toHaveBeenCalled();
    });

    test('returns false for unhandled elements', () => {
      const modal = document.createElement('div');
      const plainDiv = document.createElement('div');
      const handlers = window.YouTubePlusModalHandlers;
      expect(handlers.handleThemeOptionsClick(plainDiv, modal, handlers, {})).toBe(false);
    });
  });

  describe('live setting applies', () => {
    /** Build the enhancer context the modal layer passes around. */
    const makeContext = (settings = {}) => ({
      settings,
      getElement: jest.fn(sel => document.querySelector(sel)),
      addDownloadButton: jest.fn(),
      addSpeedControlButton: jest.fn(),
      refreshDownloadButton: jest.fn(),
      updatePageBasedOnSettings: jest.fn(),
      showNotification: jest.fn(),
      saveSettings: jest.fn(),
    });

    test('enableDownload applies create the button when missing and remove it when off', () => {
      const rightControls = document.createElement('div');
      rightControls.className = 'ytp-right-controls';
      document.body.appendChild(rightControls);

      const on = makeContext({ enableDownload: true });
      window.YouTubePlusModalHandlers.applySettingLive('enableDownload', on);
      expect(on.updatePageBasedOnSettings).toHaveBeenCalled();
      expect(on.addDownloadButton).toHaveBeenCalledWith(rightControls);
      expect(on.refreshDownloadButton).toHaveBeenCalled();

      const existing = document.createElement('button');
      existing.className = 'yp-download-button';
      document.body.appendChild(existing);
      const dropdown = document.createElement('div');
      dropdown.className = 'download-options';
      document.body.appendChild(dropdown);

      const off = makeContext({ enableDownload: false });
      window.YouTubePlusModalHandlers.applySettingLive('enableDownload', off);
      expect(document.querySelector('.yp-download-button')).toBeNull();
      expect(document.querySelector('.download-options')).toBeNull();
    });

    test('enableSpeedControl delegates to the module and manages its button', () => {
      const refresh = jest.fn();
      Object.defineProperty(window, 'YouTubePlusSpeedControl', {
        configurable: true,
        writable: true,
        value: { refreshVisibility: refresh },
      });
      const rightControls = document.createElement('div');
      rightControls.className = 'ytp-right-controls';
      document.body.appendChild(rightControls);

      const on = makeContext({ enableSpeedControl: true });
      window.YouTubePlusModalHandlers.applySettingLive('enableSpeedControl', on);
      expect(refresh).toHaveBeenCalledWith(true);
      expect(on.addSpeedControlButton).toHaveBeenCalledWith(rightControls);

      const existing = document.createElement('div');
      document.body.appendChild(existing);
      const options = document.createElement('div');
      options.className = 'speed-options';
      document.body.appendChild(options);

      const off = makeContext({ enableSpeedControl: false });
      window.YouTubePlusModalHandlers.applySettingLive('enableSpeedControl', off);
      expect(document.querySelector('.speed-options')).toBeNull();

      delete window.YouTubePlusSpeedControl;
    });

    test('theme preference changes apply the cookie and schedule the reload', () => {
      const applyThemePreference = jest.fn();
      Object.defineProperty(window, 'YouTubePlusDesignSystem', {
        configurable: true,
        writable: true,
        value: { applyThemePreference, applyThemeVariant: jest.fn() },
      });
      const cmTimeout = jest.fn();
      Object.defineProperty(window, 'YouTubePlusCleanupManager', {
        configurable: true,
        writable: true,
        value: {
          registerListener: window.YouTubePlusCleanupManager.registerListener,
          timeout: cmTimeout,
        },
      });

      const context = makeContext({ styles: { themePreference: 'dark' } });
      window.YouTubePlusModalHandlers.applySettingLive('styles.themePreference', context);
      expect(applyThemePreference).toHaveBeenCalledWith('dark');
      expect(context.showNotification).toHaveBeenCalled();
      expect(cmTimeout).toHaveBeenCalledWith(expect.any(Function), 1200);
    });

    test('theme variant changes rebuild the button surface immediately', () => {
      const applyThemeVariant = jest.fn();
      Object.defineProperty(window, 'YouTubePlusDesignSystem', {
        configurable: true,
        writable: true,
        value: { applyThemePreference: jest.fn(), applyThemeVariant },
      });
      const rebuild = jest.fn();
      window.YouTubePlusZoom = /** @type {any} */ ({ rebuildUI: rebuild });

      const context = makeContext({ styles: { themeVariant: 'classic' } });
      window.YouTubePlusModalHandlers.applySettingLive('styles.themeVariant', context);
      expect(applyThemeVariant).toHaveBeenCalledWith('classic', 'glass');
      expect(rebuild).toHaveBeenCalled();

      delete window.YouTubePlusZoom;
    });

    test('simple toggle writes the setting, applies live, saves and syncs submenus', () => {
      const context = makeContext({ enableLoop: false });
      context.addDownloadButton = jest.fn();
      const modal = document.createElement('div');
      const submenu = document.createElement('div');
      submenu.className = 'loop-submenu';
      modal.appendChild(submenu);
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'yp-submenu-toggle';
      toggleBtn.dataset.submenu = 'loop';
      toggleBtn.setAttribute('disabled', '');
      modal.appendChild(toggleBtn);
      document.body.appendChild(modal);

      const box = /** @type {HTMLInputElement} */ (document.createElement('input'));
      modal.appendChild(box);
      box.checked = true;
      window.YouTubePlusModalHandlers.handleSimpleSettingToggle(
        box,
        'enableLoop',
        context.settings,
        context,
        context.saveSettings,
        modal
      );

      expect(context.settings.enableLoop).toBe(true);
      expect(context.updatePageBasedOnSettings).toHaveBeenCalled();
      expect(context.saveSettings).toHaveBeenCalled();
      expect(submenu.style.display).toBe('block');
      expect(toggleBtn.hasAttribute('disabled')).toBe(false);
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    });

    test('toggling enableScreenshot controls .screenshot-submenu and toggle button', () => {
      const modal = document.createElement('div');
      const submenu = document.createElement('div');
      submenu.className = 'screenshot-submenu';
      submenu.dataset.submenu = 'screenshot';
      modal.appendChild(submenu);

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'yp-submenu-toggle';
      toggleBtn.dataset.submenu = 'screenshot';
      modal.appendChild(toggleBtn);
      document.body.appendChild(modal);

      const context = {
        settings: {},
        updatePageBasedOnSettings: jest.fn(),
        saveSettings: jest.fn(),
      };

      const box = /** @type {HTMLInputElement} */ (document.createElement('input'));
      modal.appendChild(box);
      box.checked = true;
      window.YouTubePlusModalHandlers.handleSimpleSettingToggle(
        box,
        'enableScreenshot',
        context.settings,
        context,
        context.saveSettings,
        modal
      );

      expect(context.settings.enableScreenshot).toBe(true);
      expect(context.saveSettings).toHaveBeenCalled();
      expect(submenu.style.display).toBe('block');
      expect(toggleBtn.hasAttribute('disabled')).toBe(false);
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');

      box.checked = false;
      window.YouTubePlusModalHandlers.handleSimpleSettingToggle(
        box,
        'enableScreenshot',
        context.settings,
        context,
        context.saveSettings,
        modal
      );

      expect(context.settings.enableScreenshot).toBe(false);
      expect(submenu.style.display).toBe('none');
      expect(toggleBtn.hasAttribute('disabled')).toBe(true);
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('sidebar navigation', () => {
    test('activateSettingsSection swaps the active nav and visible section', () => {
      const modal = document.createElement('div');
      const navA = document.createElement('div');
      navA.className = 'yp-settings-nav-item active';
      navA.dataset.section = 'basic';
      navA.dataset.label = 'Basic';
      const navB = document.createElement('div');
      navB.className = 'yp-settings-nav-item';
      navB.dataset.section = 'about';
      navB.dataset.label = 'About';
      const label = document.createElement('div');
      label.id = 'yp-active-section-label';
      modal.appendChild(label);
      const secA = document.createElement('div');
      secA.className = 'yp-settings-section';
      secA.dataset.section = 'basic';
      const secB = document.createElement('div');
      secB.className = 'yp-settings-section hidden';
      secB.dataset.section = 'about';
      modal.appendChild(navA);
      modal.appendChild(navB);
      modal.appendChild(secA);
      modal.appendChild(secB);
      document.body.appendChild(modal);

      const section = window.YouTubePlusModalHandlers.activateSettingsSection(navB, modal);

      expect(section).toBe('about');
      expect(navB.classList.contains('active')).toBe(true);
      expect(navB.getAttribute('aria-selected')).toBe('true');
      expect(navB.getAttribute('tabindex')).toBe('0');
      expect(navA.classList.contains('active')).toBe(false);
      expect(label.textContent).toBe('About');
      expect(secA.classList.contains('hidden')).toBe(true);
      expect(secB.classList.contains('hidden')).toBe(false);
    });

    test('handleSidebarNavigation persists the section and broadcasts activation', () => {
      jest.spyOn(window.YouTubeUtils.storage, 'setItem');
      let activated = null;
      document.addEventListener('youtube-plus-settings-section-activated', e => {
        activated = /** @type {any} */ (e).detail;
      });
      const modal = document.createElement('div');
      const nav = document.createElement('div');
      nav.className = 'yp-settings-nav-item';
      nav.dataset.section = 'advanced';
      nav.dataset.label = 'Advanced';
      const sec = document.createElement('div');
      sec.className = 'yp-settings-section';
      sec.dataset.section = 'advanced';
      modal.appendChild(sec);
      document.body.appendChild(modal);

      window.YouTubePlusModalHandlers.handleSidebarNavigation(nav, modal);

      expect(window.YouTubeUtils.storage.setItem).toHaveBeenCalledWith(
        'ytp-plus-active-nav-section',
        'advanced'
      );
      expect(activated?.section).toBe('advanced');
      expect(activated?.label).toBe('Advanced');
    });

    test('the voting section initializes the slider through a registered frame', () => {
      jest.useFakeTimers();
      try {
        const initSlider = jest.fn();
        Object.defineProperty(window, 'YouTubePlusVoting', {
          configurable: true,
          writable: true,
          value: { initSlider },
        });
        const modal = document.createElement('div');
        const nav = document.createElement('div');
        nav.className = 'yp-settings-nav-item';
        nav.dataset.section = 'voting';
        document.body.appendChild(modal);

        window.YouTubePlusModalHandlers.handleSidebarNavigation(nav, modal);
        expect(window.YouTubePlusCleanupManager.registerAnimationFrame).toHaveBeenCalledTimes(1);
        // The registered frame fires and initializes the slider.
        jest.advanceTimersByTime(20);
        expect(initSlider).toHaveBeenCalled();

        delete window.YouTubePlusVoting;
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('music settings', () => {
    test('isMusicSetting recognizes every music key', () => {
      const handlers = window.YouTubePlusModalHandlers;
      expect(handlers.isMusicSetting('enableMusic')).toBe(true);
      expect(handlers.isMusicSetting('hoverStyles')).toBe(true);
      expect(handlers.isMusicSetting('enableStyles')).toBe(false);
    });

    test('delegates to the settings helpers and the music module when present', () => {
      const updateMusicSettings = jest.fn();
      const getMusicSettings = jest.fn(() => ({ enableMusic: true }));
      window.YouTubePlusSettingsHelpers = /** @type {any} */ ({
        updateMusicSettings,
        getMusicSettings,
      });
      const music = { saveSettings: jest.fn(), applySettingsChanges: jest.fn() };
      window.YouTubePlusMusic = /** @type {any} */ (music);

      const box = /** @type {HTMLInputElement} */ (document.createElement('input'));
      box.checked = true;
      window.YouTubePlusModalHandlers.handleMusicSettingToggle(box, 'enableMusic');

      expect(updateMusicSettings).toHaveBeenCalledWith({ enableMusic: true });
      expect(music.saveSettings).toHaveBeenCalledWith({ enableMusic: true });
      expect(music.applySettingsChanges).toHaveBeenCalled();

      delete window.YouTubePlusSettingsHelpers;
      delete window.YouTubePlusMusic;
    });

    test('routes the fallback through the store music bridge when present', () => {
      // A SettingsHelpers without the bridge forces the store branch.
      window.YouTubePlusSettingsHelpers = /** @type {any} */ ({
        getMusicSettings: jest.fn(() => ({ enableMusic: false })),
      });
      const getMusicSettings = jest.fn(() => ({ enableMusic: false, hoverStyles: true }));
      const updateMusicSettings = jest.fn(() => true);
      window.YouTubePlusSettingsStore = /** @type {any} */ ({
        getMusicSettings,
        updateMusicSettings,
      });
      const saved = jest.fn();
      window.YouTubeUtils.storage.setItem = saved;

      const box = /** @type {HTMLInputElement} */ (document.createElement('input'));
      box.checked = true;
      window.YouTubePlusModalHandlers.handleMusicSettingToggle(box, 'enableMusic');

      expect(updateMusicSettings).toHaveBeenCalledWith({ enableMusic: true });
      expect(saved).not.toHaveBeenCalled();
      delete window.YouTubePlusSettingsHelpers;
    });

    test('a helper with only updateMusicSettings falls through to the store bridge', () => {
      window.YouTubePlusSettingsHelpers = /** @type {any} */ ({ updateMusicSettings: jest.fn() });
      const updateMusicSettings = jest.fn(() => true);
      const getMusicSettings = jest.fn(() => ({ enableMusic: true }));
      window.YouTubePlusSettingsStore = /** @type {any} */ ({
        updateMusicSettings,
        getMusicSettings,
      });

      const box = /** @type {HTMLInputElement} */ (document.createElement('input'));
      box.checked = true;
      window.YouTubePlusModalHandlers.handleMusicSettingToggle(box, 'enableMusic');

      expect(updateMusicSettings).toHaveBeenCalledWith({ enableMusic: true });
      delete window.YouTubePlusSettingsHelpers;
    });

    test('without the store bridge the toggle stays on the page and writes nothing', () => {
      window.YouTubePlusSettingsStore = /** @type {any} */ ({ save: jest.fn() });
      const saved = jest.fn();
      window.YouTubeUtils.storage.setItem = saved;

      const box = /** @type {HTMLInputElement} */ (document.createElement('input'));
      box.checked = true;

      expect(() =>
        window.YouTubePlusModalHandlers.handleMusicSettingToggle(box, 'enableMusic')
      ).not.toThrow();
      expect(saved).not.toHaveBeenCalled();
    });

    test('without the store bridge mirrors the music card and writes nothing', () => {
      const saved = jest.fn();
      window.YouTubeUtils.storage.setItem = saved;
      const section = document.createElement('div');
      section.className = 'yp-settings-section';
      const submenu = document.createElement('div');
      submenu.className = 'music-submenu';
      submenu.dataset.submenu = 'music';
      section.appendChild(submenu);
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'yp-submenu-toggle';
      toggleBtn.dataset.submenu = 'music';
      section.appendChild(toggleBtn);
      document.body.appendChild(section);

      const box = /** @type {HTMLInputElement} */ (document.createElement('input'));
      section.appendChild(box);
      box.checked = true;
      window.YouTubePlusModalHandlers.handleMusicSettingToggle(box, 'enableMusic');

      expect(submenu.style.display).toBe('block');
      expect(toggleBtn.hasAttribute('disabled')).toBe(false);
      expect(toggleBtn.style.display).toBe('inline-flex');
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
      expect(saved).not.toHaveBeenCalled();
    });

    test('non-music keys are ignored entirely', () => {
      const saved = jest.fn();
      window.YouTubeUtils.storage.setItem = saved;
      window.YouTubePlusModalHandlers.handleMusicSettingToggle(
        document.createElement('input'),
        'notMusic'
      );
      expect(saved).not.toHaveBeenCalled();
    });
  });

  describe('glass dropdown', () => {
    /** Build one dropdown with its backing hidden select. */
    const buildDropdown = () => {
      const dropdown = document.createElement('div');
      dropdown.className = 'glass-dropdown';
      dropdown.innerHTML = `
        <button type="button" class="glass-dropdown__toggle"><span class="glass-dropdown__label">None</span></button>
        <ul class="glass-dropdown__list">
          <li class="glass-dropdown__item" data-value="none">None</li>
          <li class="glass-dropdown__item" data-value="ctrl">Ctrl</li>
          <li class="glass-dropdown__item" data-value="alt">Alt</li>
        </ul>`;
      const hidden = document.createElement('select');
      hidden.innerHTML =
        '<option value="none"></option><option value="ctrl"></option><option value="alt"></option>';
      dropdown.appendChild(hidden);
      document.body.appendChild(dropdown);
      return { dropdown, hidden, toggle: dropdown.querySelector('.glass-dropdown__toggle') };
    };

    beforeAll(() => {
      if (typeof Element.prototype.scrollIntoView !== 'function') {
        Element.prototype.scrollIntoView = () => {
          /* mock */
        };
      }
    });

    test('opens via the toggle with overflow direction handling and closes outside', () => {
      const { dropdown, toggle, hidden } = buildDropdown();
      window.YouTubePlusModalHandlers.initGlassDropdown({ dropdown, hiddenSelect: hidden });

      toggle.click();
      expect(dropdown.querySelector('.glass-dropdown__toggle').getAttribute('aria-expanded')).toBe(
        'true'
      );
      expect(dropdown.querySelector('.glass-dropdown__list').style.display).toBe('block');
      expect(
        document
          .querySelector('.glass-dropdown__list')
          .classList.contains('glass-dropdown__list--down')
      ).toBe(true);

      document.body.click();
      expect(dropdown.querySelector('.glass-dropdown__toggle').getAttribute('aria-expanded')).toBe(
        'false'
      );
    });

    test('list click commits the selection through the hidden select change', () => {
      const { dropdown, hidden } = buildDropdown();
      window.YouTubePlusModalHandlers.initGlassDropdown({ dropdown, hiddenSelect: hidden });
      let changed = 0;
      hidden.addEventListener('change', () => {
        changed += 1;
      });

      const ctrlItem = dropdown.querySelector('li[data-value="ctrl"]');
      ctrlItem.click();

      expect(hidden.value).toBe('ctrl');
      expect(changed).toBe(1);
      expect(ctrlItem.getAttribute('aria-selected')).toBe('true');
      expect(dropdown.querySelector('.glass-dropdown__label').textContent).toBe('Ctrl');
      expect(dropdown.querySelector('.glass-dropdown__toggle').getAttribute('aria-expanded')).toBe(
        'false'
      );
    });

    test('keyboard arrows move the selection, Enter commits, Escape closes', () => {
      const { dropdown, hidden, toggle } = buildDropdown();
      window.YouTubePlusModalHandlers.initGlassDropdown({ dropdown, hiddenSelect: hidden });

      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(dropdown.querySelector('.glass-dropdown__toggle').getAttribute('aria-expanded')).toBe(
        'true'
      );
      expect(
        dropdown
          .querySelector('.glass-dropdown__list li[data-value="ctrl"]')
          ?.getAttribute('aria-selected')
      ).toBe('true');

      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(
        dropdown
          .querySelector('.glass-dropdown__list li[data-value="alt"]')
          ?.getAttribute('aria-selected')
      ).toBe('true');

      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(
        dropdown
          .querySelector('.glass-dropdown__list li[data-value="ctrl"]')
          ?.getAttribute('aria-selected')
      ).toBe('true');

      hidden.value = 'ctrl';
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(hidden.value).toBe('ctrl');
      expect(dropdown.querySelector('.glass-dropdown__label').textContent).toBe('Ctrl');
      expect(dropdown.querySelector('.glass-dropdown__toggle').getAttribute('aria-expanded')).toBe(
        'false'
      );

      toggle.click();
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(dropdown.querySelector('.glass-dropdown__toggle').getAttribute('aria-expanded')).toBe(
        'false'
      );
    });

    test('keyboard Home, End, Tab, Space, scrollIntoView and disabled guards', () => {
      const { dropdown, hidden, toggle } = buildDropdown();
      window.YouTubePlusModalHandlers.initGlassDropdown({ dropdown, hiddenSelect: hidden });

      dropdown.querySelectorAll('.glass-dropdown__item').forEach(it => {
        it.scrollIntoView = jest.fn();
      });

      // Space to open
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      // Home moves to first item
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      expect(dropdown.querySelector('li[data-value="none"]').getAttribute('aria-selected')).toBe(
        'true'
      );

      // End moves to last item
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      expect(dropdown.querySelector('li[data-value="alt"]').getAttribute('aria-selected')).toBe(
        'true'
      );

      // Tab closes the list
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      // Disabled guard via aria-disabled
      toggle.setAttribute('aria-disabled', 'true');
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      // Disabled guard via _disabled property
      toggle.removeAttribute('aria-disabled');
      dropdown._disabled = true;
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    test('initializes each dropdown only once', () => {
      const { dropdown, hidden } = buildDropdown();
      window.YouTubePlusModalHandlers.initGlassDropdown({ dropdown, hiddenSelect: hidden });
      window.YouTubePlusModalHandlers.initGlassDropdown({ dropdown, hiddenSelect: hidden });
      expect(dropdown.getAttribute('data-yp-dropdown-init')).toBe('true');
      // One toggle registration, one document registration, one keydown, one list click.
      expect(dropdown.querySelectorAll('.glass-dropdown__toggle').length).toBe(1);
    });
  });

  describe('focus trap', () => {
    // jsdom has no layout: it reports offsetParent as null, which the trap's
    // visibility filter rejects. Report connected elements as laid out.
    const originalOffsetParent = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetParent'
    );
    beforeAll(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get: function () {
          return this.parentElement || document.body;
        },
      });
    });
    afterAll(() => {
      if (originalOffsetParent) {
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', originalOffsetParent);
      }
    });

    test('Tab cycles within the container and cleanup removes it', () => {
      const container = document.createElement('div');
      const first = document.createElement('button');
      const last = document.createElement('button');
      container.appendChild(first);
      container.appendChild(last);
      document.body.appendChild(container);
      document.activeElement?.blur?.();
      last.focus();
      expect(document.activeElement).toBe(last);

      const cleanup = window.YouTubePlusModalHandlers.createFocusTrap(container);
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(first);

      first.focus();
      container.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
      expect(document.activeElement).toBe(last);

      cleanup();
      first.focus();
      container.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
      expect(document.activeElement).toBe(first);
    });
  });

  describe('modal click actions', () => {
    test('nav clicks route through handleSidebarNavigation and stop there', () => {
      const H = window.YouTubePlusModalHandlers;
      const spy = jest.spyOn(H, 'handleSidebarNavigation').mockImplementation(() => {
        /* mock */
      });
      const modal = document.createElement('div');
      const nav = document.createElement('div');
      nav.className = 'yp-settings-nav-item';
      modal.appendChild(nav);

      H.handleModalClickActions(nav, modal, H, { settings: {} }, key => key);
      expect(spy).toHaveBeenCalled();
    });

    test('save buttons save, close the dialog and notify', () => {
      const modal = document.createElement('div');
      const saveBtn = document.createElement('button');
      saveBtn.id = 'yp-save-settings';
      modal.appendChild(saveBtn);
      document.body.appendChild(modal);

      const save = jest.fn();
      const notify = jest.fn();
      let closed = 0;
      const onClosed = () => {
        closed += 1;
      };
      document.addEventListener('youtube-plus-settings-modal-closed', onClosed);
      try {
        window.YouTubePlusModalHandlers.handleModalClickActions(
          saveBtn,
          modal,
          window.YouTubePlusModalHandlers,
          { settings: {}, saveSettingsBound: save, showNotificationBound: notify },
          key => key
        );
        expect(save).toHaveBeenCalled();
        expect(closed).toBe(1);
        expect(notify).toHaveBeenCalledWith('settingsSaved');
        expect(modal.isConnected).toBe(false);
      } finally {
        document.removeEventListener('youtube-plus-settings-modal-closed', onClosed);
      }
    });

    test('external downloader clicks route to their handlers', () => {
      const H = window.YouTubePlusModalHandlers;
      const spySave = jest.spyOn(H, 'handleExternalDownloaderSave').mockImplementation(() => {
        /* mock */
      });
      const modal = document.createElement('div');
      const btnSave = document.createElement('button');
      btnSave.id = 'download-externalDownloader-save';
      modal.appendChild(btnSave);
      const context = { settings: { downloadSites: {} } };

      H.handleModalClickActions(btnSave, modal, H, context, key => key);
      expect(spySave).toHaveBeenCalledWith(
        btnSave,
        context.settings,
        undefined,
        undefined,
        expect.any(Function)
      );

      const spyReset = jest.spyOn(H, 'handleExternalDownloaderReset').mockImplementation(() => {
        /* mock */
      });
      spySave.mockRestore();
      const btnReset = document.createElement('button');
      btnReset.id = 'download-externalDownloader-reset';
      modal.appendChild(btnReset);
      H.handleModalClickActions(btnReset, modal, H, context, key => key);
      expect(spyReset).toHaveBeenCalledWith(
        modal,
        context.settings,
        undefined,
        undefined,
        expect.any(Function)
      );
    });
  });

  describe('theme option clicks', () => {
    const makeContext = (settings = {}) => ({
      settings,
      updatePageBasedOnSettings: jest.fn(),
      refreshDownloadButton: jest.fn(),
      showNotification: jest.fn(),
      saveSettings: jest.fn(),
      saveSettingsBound: jest.fn(),
    });

    test('material style buttons write both settings and sync the cards', () => {
      const modal = document.createElement('div');
      const card = document.createElement('div');
      card.className = 'yp-theme-card';
      card.dataset.value = 'vision';
      const styleBtn = document.createElement('button');
      styleBtn.className = 'yp-theme-style-btn';
      styleBtn.dataset.layout = 'vision';
      styleBtn.dataset.style = 'glass';
      modal.appendChild(card);
      modal.appendChild(styleBtn);
      document.body.appendChild(modal);

      const context = makeContext();
      const handled = window.YouTubePlusModalHandlers.handleThemeOptionsClick(
        styleBtn,
        modal,
        window.YouTubePlusModalHandlers,
        context
      );

      expect(handled).toBe(true);
      expect(context.settings.styles).toEqual({
        themeVariant: 'vision',
        themeStyle: 'glass',
      });
      expect(card.classList.contains('active')).toBe(true);
      // Live apply ran through the real dispatch for the variant setting.
      expect(context.updatePageBasedOnSettings).toHaveBeenCalled();
      expect(context.saveSettingsBound).toHaveBeenCalled();
    });

    test('preference buttons toggle within their bar', () => {
      const modal = document.createElement('div');
      const bar = document.createElement('div');
      bar.className = 'yp-theme-pref-bar';
      const prefOn = document.createElement('button');
      prefOn.className = 'yp-theme-pref-btn';
      prefOn.dataset.settingCard = 'styles.themePreference';
      prefOn.dataset.value = 'device';
      const prefOff = document.createElement('button');
      prefOff.className = 'yp-theme-pref-btn';
      prefOff.dataset.settingCard = 'styles.themePreference';
      prefOff.dataset.value = 'dark';
      bar.appendChild(prefOn);
      bar.appendChild(prefOff);
      modal.appendChild(bar);
      document.body.appendChild(modal);

      const context = makeContext({ styles: { themeStyle: 'glass' } });
      const handled = window.YouTubePlusModalHandlers.handleThemeOptionsClick(
        prefOff,
        modal,
        window.YouTubePlusModalHandlers,
        context
      );

      expect(handled).toBe(true);
      expect(context.settings.styles.themePreference).toBe('dark');
      expect(prefOff.classList.contains('active')).toBe(true);
      expect(prefOn.classList.contains('active')).toBe(false);
      expect(prefOff.getAttribute('aria-checked')).toBe('true');
    });

    test('variant cards sync their grid plus the retained style row', () => {
      const modal = document.createElement('div');
      const grid = document.createElement('div');
      grid.className = 'yp-theme-grid';
      const cardA = document.createElement('div');
      cardA.className = 'yp-theme-card';
      cardA.dataset.settingCard = 'styles.themeVariant';
      cardA.dataset.value = 'vision';
      const cardB = document.createElement('div');
      cardB.className = 'yp-theme-card';
      cardB.dataset.settingCard = 'styles.themeVariant';
      cardB.dataset.value = 'classic';
      grid.appendChild(cardA);
      grid.appendChild(cardB);
      const styleBtn = document.createElement('button');
      styleBtn.className = 'yp-theme-style-btn';
      styleBtn.dataset.layout = 'classic';
      styleBtn.dataset.style = 'glass';
      modal.appendChild(grid);
      modal.appendChild(styleBtn);
      document.body.appendChild(modal);

      const context = makeContext({ styles: { themeStyle: 'glass' } });
      const handled = window.YouTubePlusModalHandlers.handleThemeOptionsClick(
        cardB,
        modal,
        window.YouTubePlusModalHandlers,
        context
      );

      expect(handled).toBe(true);
      expect(context.settings.styles.themeVariant).toBe('classic');
      expect(cardB.classList.contains('active')).toBe(true);
      expect(cardA.classList.contains('active')).toBe(false);
      expect(styleBtn.classList.contains('active')).toBe(true);
    });

    test('unrelated targets are not handled', () => {
      const modal = document.createElement('div');
      document.body.appendChild(modal);
      const context = makeContext();
      const handled = window.YouTubePlusModalHandlers.handleThemeOptionsClick(
        modal,
        modal,
        window.YouTubePlusModalHandlers,
        context
      );
      expect(handled).toBe(false);
    });
  });

  describe('modifier combo helpers', () => {
    test('formatModifierComboLabel and resolveModifierComboValue format and resolve labels', () => {
      const handlers = window.YouTubePlusModalHandlers;
      expect(handlers.resolveModifierComboValue({ ctrlKey: true })).toBe('ctrl');
      expect(handlers.resolveModifierComboValue({ altKey: true, shiftKey: true })).toBe(
        'alt+shift'
      );
      expect(handlers.resolveModifierComboValue({})).toBe('none');

      const label = handlers.formatModifierComboLabel('ctrl+shift', { translatePart: k => k });
      expect(typeof label).toBe('string');
      expect(label).toBe('Ctrl+Shift');
    });

    test('buildModifierComboOptionItems and buildModifierComboDropdownItems build options', () => {
      const handlers = window.YouTubePlusModalHandlers;
      const options = handlers.buildModifierComboOptionItems('ctrl', k => k);
      expect(typeof options).toBe('string');
      expect(options).toContain('<option value="ctrl" selected>');

      const dropdownItems = handlers.buildModifierComboDropdownItems('shift', k => k);
      expect(typeof dropdownItems).toBe('string');
      expect(dropdownItems).toContain(
        '<li class="glass-dropdown__item" data-value="shift" role="option" aria-selected="true">'
      );
    });
  });
});
