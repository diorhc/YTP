/**
 * Unit tests for src/settings-modal.js
 *
 * Verifies:
 * 1. Dialog semantics (role="dialog", aria-modal="true", aria-label).
 * 2. Escape key dismissal and previousActiveElement focus restoration.
 * 3. Close button dismissal.
 * 4. Modal open lifecycle (focusInitialModalElement_, openSettingsModal, event dispatching).
 * 5. Cleanup and event dispatch on close.
 */

const fs = require('fs');
const path = require('path');

describe('YouTubePlusSettingsModal', () => {
  /** @type {any} */
  let enhancer;
  /** @type {HTMLElement} */
  let triggerButton;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';

    triggerButton = document.createElement('button');
    triggerButton.id = 'test-trigger';
    document.body.appendChild(triggerButton);
    triggerButton.focus();

    require('../src/cleanup-manager.js');
    require('../src/safe-dom.js');
    require('../src/error-boundary.js');
    require('../src/logger.js');
    require('../src/utils.js');
    require('../src/settings-store.js');
    require('../src/settings-helpers.js');

    jest.spyOn(window.YouTubeUtils, 'openSafe').mockImplementation(() => true);
    jest.spyOn(window.YouTubeUtils, 'registerListenerSafe');
    jest.spyOn(window.YouTubeUtils.storage, 'setItem');
    jest.spyOn(window.YouTubeUtils.storage, 'getItem');

    window.YouTubePlusModalHandlers = /** @type {any} */ ({
      attachSettingsListeners: jest.fn(),
      bindCollapsibleSubmenus: jest.fn(),
      bindSearchFilter: jest.fn(),
      setSettingByPath: jest.fn(),
      applySettingLive: jest.fn(),
      handleDownloadSiteToggle: jest.fn(),
      handleDownloadSiteInput: jest.fn(),
      handleMusicSettingToggle: jest.fn(),
      handleSimpleSettingToggle: jest.fn(),
      isMusicSetting: jest.fn(() => false),
    });

    require('../src/settings-modal.js');

    enhancer = {
      settings: {
        theme: 'auto',
      },
      getElement: jest.fn(selector => document.querySelector(selector)),
      insertStyles: jest.fn(),
      addDownloadButton: jest.fn(),
      addSpeedControlButton: jest.fn(),
      refreshDownloadButton: jest.fn(),
      updatePageBasedOnSettings: jest.fn(),
      showNotification: jest.fn(),
      saveSettings: jest.fn(),
      openSettingsSection: jest.fn(),
      updateActiveSectionLabel: jest.fn(),
      ensureNonCriticalStyles: jest.fn(),
      handleThemeOptionsClick_: jest.fn(() => false),
    };
  });

  afterEach(() => {
    delete window.YouTubePlusSettingsModal;
    delete window.YouTubePlusModalHandlers;
    delete window.YouTubePlusSettingsHelpers;
    delete window.YouTubePlusCleanupManager;
    delete window.YouTubePlusErrorBoundary;
    delete window.YouTubeSafeDOM;
    delete window.YouTubeUtils;
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  test('creates modal with dialog semantics and aria-modal', () => {
    const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);

    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.getAttribute('aria-label')).toBeTruthy();
    expect(modal.className).toContain('yp-settings-modal');

    // Dismiss to clean up registered keydown listener
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  test('Escape key dismisses modal and restores focus to previous active element', () => {
    const closedEventSpy = jest.fn();
    document.addEventListener('youtube-plus-settings-modal-closed', closedEventSpy);

    const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
    document.body.appendChild(modal);

    // Press Escape
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.dispatchEvent(escEvent);

    expect(document.querySelector('.yp-settings-modal')).toBeNull();
    expect(closedEventSpy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(triggerButton);

    document.removeEventListener('youtube-plus-settings-modal-closed', closedEventSpy);
  });

  test('clicking close button dismisses modal and dispatches closed event', () => {
    const closedEventSpy = jest.fn();
    document.addEventListener('youtube-plus-settings-modal-closed', closedEventSpy);

    const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#yp-close-settings');
    expect(closeBtn).not.toBeNull();
    closeBtn.click();

    expect(document.querySelector('.yp-settings-modal')).toBeNull();
    expect(closedEventSpy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(triggerButton);

    document.removeEventListener('youtube-plus-settings-modal-closed', closedEventSpy);
  });

  test('clicking modal backdrop dismisses modal', () => {
    const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
    document.body.appendChild(modal);

    // Clicking directly on modal backdrop (target === modal)
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.querySelector('.yp-settings-modal')).toBeNull();
  });

  test('openSettingsModal mounts modal, focuses initial element, and dispatches opened event', () => {
    const openedEventSpy = jest.fn();
    document.addEventListener('youtube-plus-settings-modal-opened', openedEventSpy);

    window.YouTubePlusSettingsModal.open(enhancer);

    const modal = document.querySelector('.yp-settings-modal');
    expect(modal).not.toBeNull();
    expect(openedEventSpy).toHaveBeenCalledTimes(1);

    document.removeEventListener('youtube-plus-settings-modal-opened', openedEventSpy);
  });

  test('openSettingsModal removes previously existing modal before opening new one', () => {
    window.YouTubePlusSettingsModal.open(enhancer);
    expect(document.querySelectorAll('.yp-settings-modal').length).toBe(1);

    window.YouTubePlusSettingsModal.open(enhancer);
    expect(document.querySelectorAll('.yp-settings-modal').length).toBe(1);
  });

  describe('Focus containment & AA contrast', () => {
    afterEach(() => {
      document.documentElement.removeAttribute('data-yp-variant');
    });

    test('Vision mode: focus containment wraps Tab and Shift+Tab without selecting Classic controls', () => {
      document.documentElement.removeAttribute('data-yp-variant');
      const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
      document.body.appendChild(modal);

      const classicClose = modal.querySelector('#yp-close-settings-classic');
      const classicSave = modal.querySelector('#yp-save-settings-classic');
      const visionClose = modal.querySelector('#yp-close-settings');
      const visionSave = modal.querySelector('#yp-save-settings');

      expect(visionClose).not.toBeNull();
      expect(visionSave).not.toBeNull();

      // In Vision mode, Tab from visionSave must wrap to first focusable element
      visionSave.focus();
      expect(document.activeElement).toBe(visionSave);

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(tabEvent);

      // Tab was trapped and prevented default
      expect(tabEvent.defaultPrevented).toBe(true);
      // Active element must NOT be classicSave or classicClose
      expect(document.activeElement).not.toBe(classicSave);
      expect(document.activeElement).not.toBe(classicClose);
      expect(modal.contains(document.activeElement)).toBe(true);

      // Now test Shift+Tab from first element wraps to last
      const firstActive = document.activeElement;
      expect(firstActive).not.toBeNull();
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(shiftTabEvent);

      expect(shiftTabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(classicSave);
      expect(document.activeElement).not.toBe(classicClose);
      expect(modal.contains(document.activeElement)).toBe(true);

      // Clean up
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('Classic mode: focus containment wraps Tab and Shift+Tab without selecting Vision controls', () => {
      document.documentElement.setAttribute('data-yp-variant', 'classic');
      const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
      document.body.appendChild(modal);

      const classicClose = modal.querySelector('#yp-close-settings-classic');
      const classicSave = modal.querySelector('#yp-save-settings-classic');
      const visionClose = modal.querySelector('#yp-close-settings');
      const visionSave = modal.querySelector('#yp-save-settings');

      expect(classicClose).not.toBeNull();
      expect(classicSave).not.toBeNull();

      // Focus classicClose (last element in Classic mode)
      classicClose.focus();
      expect(document.activeElement).toBe(classicClose);

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(tabEvent);

      // Tab was trapped and prevented default (did NOT escape to body)
      expect(tabEvent.defaultPrevented).toBe(true);
      // Active element must NOT be visionSave or visionClose
      expect(document.activeElement).not.toBe(visionSave);
      expect(document.activeElement).not.toBe(visionClose);
      expect(modal.contains(document.activeElement)).toBe(true);

      // Shift+Tab from first element wraps to last visible control
      const firstActive = document.activeElement;
      expect(firstActive).not.toBeNull();
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(shiftTabEvent);

      expect(shiftTabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(visionSave);
      expect(document.activeElement).not.toBe(visionClose);
      expect(modal.contains(document.activeElement)).toBe(true);

      // Clean up
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.activeElement).toBe(triggerButton);
    });

    test('Classic save button achieves WCAG AA contrast ratio (>= 4.5:1 for 13px text)', () => {
      const cssContent = fs.readFileSync(
        path.resolve(__dirname, '../src/design-system.js'),
        'utf8'
      );
      // Verify rule for .yp-classic-save uses --yp-accent-strong resolving to #cc0029
      expect(cssContent).toContain('.yp-classic-save');
      expect(cssContent).toMatch(
        /\.yp-classic-save\s*\{[^}]*background:\s*var\(--yp-accent-strong\)/
      );
      expect(cssContent).toMatch(/--yp-accent-strong:\s*#cc0029/);

      // Calculate exact WCAG contrast ratio for #cc0029 on #ffffff
      function sRGBtoLin(c) {
        c /= 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }
      function lum(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return 0.2126 * sRGBtoLin(r) + 0.7152 * sRGBtoLin(g) + 0.0722 * sRGBtoLin(b);
      }
      function getContrast(h1, h2) {
        const l1 = lum(h1),
          l2 = lum(h2);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }

      const contrastRatio = getContrast('#cc0029', '#ffffff');
      // Must be >= 4.5:1 (WCAG AA requirement for normal text under 18pt/14pt bold)
      expect(contrastRatio).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio).toBeCloseTo(5.83, 1);
    });
  });

  describe('modal delegation and restore', () => {
    /** Dispatch a bubbling modal click onto a fresh modal dialog. */
    const openModal = (extraSettings = {}) => {
      enhancer.settings = { ...enhancer.settings, ...extraSettings };
      const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
      document.body.appendChild(modal);
      return modal;
    };

    test('select changes persist through the settings path', () => {
      const modal = openModal();
      const select = document.createElement('select');
      select.dataset.setting = 'theme';
      select.innerHTML = '<option value="auto"></option><option value="dark"></option>';
      select.value = 'dark';
      modal.querySelector('.yp-settings-panel')?.appendChild(select);

      select.dispatchEvent(new Event('change', { bubbles: true }));

      expect(window.YouTubePlusModalHandlers.setSettingByPath).toHaveBeenCalledWith(
        enhancer.settings,
        'theme',
        'dark'
      );
      expect(window.YouTubePlusModalHandlers.applySettingLive).toHaveBeenCalledWith(
        'theme',
        expect.any(Object)
      );
      expect(enhancer.saveSettings).toHaveBeenCalled();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('download site checkbox changes route to the site toggle handler', () => {
      const modal = openModal();
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'yp-settings-checkbox';
      box.dataset.setting = 'downloadSite_ytdl';
      modal.querySelector('.yp-settings-panel')?.appendChild(box);

      box.dispatchEvent(new Event('change', { bubbles: true }));

      expect(window.YouTubePlusModalHandlers.handleDownloadSiteToggle).toHaveBeenCalledWith(
        box,
        'ytdl',
        enhancer.settings,
        expect.any(Function)
      );

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('music setting toggles without a toast', () => {
      const modal = openModal();
      window.YouTubePlusModalHandlers.isMusicSetting = jest.fn(() => true);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'yp-settings-checkbox';
      box.dataset.setting = 'enableMusic';
      modal.querySelector('.yp-settings-panel')?.appendChild(box);

      box.dispatchEvent(new Event('change', { bubbles: true }));

      expect(window.YouTubePlusModalHandlers.handleMusicSettingToggle).toHaveBeenCalledWith(
        box,
        'enableMusic'
      );
      expect(enhancer.showNotification).not.toHaveBeenCalled();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('site input editing routes to the download input handler', () => {
      const modal = openModal();
      const input = document.createElement('input');
      input.className = 'download-site-input';
      input.dataset.site = 'ytdl';
      input.dataset.field = 'path';
      input.value = '/bin/ytdl';
      modal.querySelector('.yp-settings-panel')?.appendChild(input);

      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(window.YouTubePlusModalHandlers.handleDownloadSiteInput).toHaveBeenCalledWith(
        input,
        'ytdl',
        'path',
        enhancer.settings,
        expect.any(Function)
      );

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('hotkey blurs persist single normalized characters and save', () => {
      const modal = openModal();
      const speed = document.createElement('input');
      speed.type = 'text';
      speed.className = 'speed-hotkey-input';
      speed.dataset.speedHotkey = 'decrease';
      speed.value = ' G ';
      modal.querySelector('.yp-settings-panel')?.appendChild(speed);
      const loop = document.createElement('input');
      loop.type = 'text';
      loop.className = 'loop-hotkey-input';
      loop.dataset.loopHotkey = 'setPointA';
      loop.value = ' K';
      modal.querySelector('.yp-settings-panel')?.appendChild(loop);

      speed.dispatchEvent(new FocusEvent('blur'));
      loop.dispatchEvent(new FocusEvent('blur'));

      expect(enhancer.settings.speedControlHotkeys.decrease).toBe('g');
      expect(speed.value).toBe('g');
      expect(enhancer.settings.loopHotkeys.setPointA).toBe('k');
      expect(loop.value).toBe('k');
      expect(enhancer.saveSettings).toHaveBeenCalled();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('unrecognized hotkey types leave settings untouched and skip saving', () => {
      const modal = openModal();
      const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
      input.className = 'speed-hotkey-input';
      input.dataset.speedHotkey = 'explode';
      input.value = 'z';
      modal.querySelector('.yp-settings-panel')?.appendChild(input);

      input.dispatchEvent(new FocusEvent('blur'));

      expect(enhancer.settings.speedControlHotkeys).toBeUndefined();
      expect(enhancer.saveSettings).not.toHaveBeenCalled();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('submenu toggle collapses the panel and persists expanded state', () => {
      const modal = openModal({ enableMusic: true });
      const toggleBtn = /** @type {HTMLElement} */ (
        modal.querySelector('.yp-submenu-toggle[data-submenu="music"]')
      );
      const submenu = modal.querySelector('.music-submenu[data-submenu="music"]');
      expect(toggleBtn instanceof HTMLElement).toBe(true);
      expect(submenu instanceof HTMLElement).toBe(true);
      // Enabled settings start expanded; the toggle collapses them.
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');

      toggleBtn.click();

      expect(submenu.style.display).toBe('none');
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
      expect(/** @type {any} */ (window.YouTubeUtils.storage.setItem.mock.calls.at(-1))).toEqual([
        'ytp-plus-submenu-states',
        expect.stringContaining('"music":false'),
      ]);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('clicking a settings item row toggles its checkbox', () => {
      const modal = openModal();
      const row = document.createElement('div');
      row.className = 'yp-settings-item';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'yp-settings-checkbox';
      box.dataset.setting = 'enableStyles';
      box.checked = false;
      row.appendChild(box);
      const rowLabel = document.createElement('span');
      row.appendChild(rowLabel);
      modal.querySelector('.yp-settings-panel')?.appendChild(row);

      rowLabel.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(box.checked).toBe(true);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('external link buttons open their page through the safe opener', () => {
      const modal = openModal();
      const link = document.createElement('button');
      link.id = 'open-ytp-github';
      modal.querySelector('.yp-settings-panel')?.appendChild(link);

      link.click();

      expect(window.YouTubeUtils.openSafe).toHaveBeenCalledWith(
        'https://github.com/diorhc/YTP',
        '_blank'
      );

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('the saved active section is restored when it exists', () => {
      jest.useFakeTimers();
      try {
        window.YouTubeUtils.storage.getItem.mockImplementation(key =>
          key === 'ytp-plus-active-nav-section' ? 'about' : ''
        );
        // The real navigation core: swap + label come from the owner module.
        require('../src/modal-handlers.js');
        const modal = openModal();
        const navItem = modal.querySelector('.yp-settings-nav-item[data-section="about"]');
        expect(navItem?.classList.contains('active')).toBe(true);
        expect(navItem?.getAttribute('aria-selected')).toBe('true');
        const activeLabel = modal.querySelector('#yp-active-section-label');
        expect(activeLabel?.textContent).toBe(/** @type {HTMLElement} */ (navItem)?.dataset?.label);

        jest.advanceTimersByTime(10);
        const sectionEl = modal.querySelector('.yp-settings-section[data-section="about"]');
        expect(sectionEl?.classList.contains('hidden')).toBe(false);

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } finally {
        jest.useRealTimers();
      }
    });

    test('a foreign modal without a session is released defensively', () => {
      const foreign = document.createElement('div');
      foreign.className = 'yp-settings-modal';
      document.body.appendChild(foreign);

      const closedSpy = jest.fn();
      document.addEventListener('youtube-plus-settings-modal-closed', closedSpy);
      try {
        window.YouTubePlusSettingsModal.open(enhancer);

        expect(foreign.isConnected).toBe(false);
        expect(closedSpy).toHaveBeenCalled();
        expect(document.querySelectorAll('.yp-settings-modal').length).toBe(1);
      } finally {
        document.removeEventListener('youtube-plus-settings-modal-closed', closedSpy);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    });

    test('opening initializes and rebuilds the voting UI', () => {
      const voting = { init: jest.fn(), createUI: jest.fn() };
      window.YouTubePlus = /** @type {any} */ ({ Voting: voting });
      const container = document.createElement('div');
      container.id = 'yp-voting-container';
      document.body.appendChild(container);

      const openedSpy = jest.fn();
      document.addEventListener('youtube-plus-settings-modal-opened', openedSpy);
      try {
        window.YouTubePlusSettingsModal.open(enhancer);

        expect(openedSpy).toHaveBeenCalled();
        expect(voting.init).toHaveBeenCalled();
        expect(voting.createUI).toHaveBeenCalledWith(container);
      } finally {
        document.removeEventListener('youtube-plus-settings-modal-opened', openedSpy);
        delete window.YouTubePlus;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    });

    test('the report module may populate the settings modal', () => {
      const report = { render: jest.fn() };
      window.YouTubePlusReport = /** @type {any} */ (report);
      try {
        const modal = openModal();

        expect(report.render).toHaveBeenCalledWith(modal);
      } finally {
        delete window.YouTubePlusReport;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    });

    test('a report module that throws does not stop the modal from opening', () => {
      window.YouTubePlusReport = /** @type {any} */ ({
        render: () => {
          throw new Error('report render failed');
        },
      });
      try {
        const modal = openModal();

        expect(modal?.isConnected).toBe(true);
      } finally {
        delete window.YouTubePlusReport;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    });
  });

  test('a dictionary loading after mount re-renders the modal without losing form state', () => {
    let translationsLoaded = false;
    window.YouTubePlusI18n = {
      // Before delivery completes the resolver honestly returns the raw key.
      t: key => (translationsLoaded ? `Translated: ${key}` : key),
      isReady: () => translationsLoaded,
    };
    window.YouTubeUtils.t = key => window.YouTubePlusI18n.t(key);

    const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
    document.body.appendChild(modal);

    // While the dictionary is still loading, the labels render as raw keys.
    const rawLabel = Array.from(modal.querySelectorAll('.yp-settings-item-label')).find(
      el => el.textContent.trim() === 'adBlocker'
    );
    expect(rawLabel).toBeTruthy();

    // The user toggles a checkbox before the dictionary becomes ready.
    const stylesCheckbox = /** @type {HTMLInputElement} */ (
      modal.querySelector('#yp-setting-enableStyles')
    );
    expect(stylesCheckbox instanceof HTMLInputElement).toBe(true);
    stylesCheckbox.checked = false;

    expect(window.YouTubeUtils.registerListenerSafe).toHaveBeenCalledWith(
      window,
      'youtube-plus-i18n-ready',
      expect.any(Function)
    );

    let eventCaught = false;
    window.addEventListener('youtube-plus-i18n-ready', () => {
      eventCaught = true;
    });
    // The dictionary delivery completes: from now on the resolver returns
    // translated strings and the service reports itself ready.
    translationsLoaded = true;
    window.dispatchEvent(new CustomEvent('youtube-plus-i18n-ready', { bubbles: true }));
    expect(eventCaught).toBe(true);

    // The settled UI re-renders with translated labels...
    const translatedLabel = Array.from(modal.querySelectorAll('.yp-settings-item-label')).find(
      el => el.textContent.trim() === 'Translated: adBlocker'
    );
    expect(translatedLabel).toBeTruthy();
    expect(
      Array.from(modal.querySelectorAll('.yp-settings-item-label')).some(
        el => el.textContent.trim() === 'adBlocker'
      )
    ).toBe(false);
    // ...and the unsaved checkbox state survives the re-render.
    expect(
      /** @type {HTMLInputElement} */ (modal.querySelector('#yp-setting-enableStyles')).checked
    ).toBe(false);
  });

  describe('defensive storage and fallback branches', () => {
    test('submenu states and flags fall back safely when storage throws', () => {
      window.YouTubeUtils.storage.getItem.mockImplementation(() => {
        throw new Error('storage read failed');
      });
      window.YouTubeUtils.storage.setItem.mockImplementation(() => {
        throw new Error('storage write failed');
      });

      const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
      document.body.appendChild(modal);

      expect(modal).not.toBeNull();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('setSafeHTML falls back to YouTubeSafeDOM when YouTubeUtils.setSafeHTML is absent', () => {
      const origSetSafe = window.YouTubeUtils.setSafeHTML;
      delete window.YouTubeUtils.setSafeHTML;
      const setHTMLSpy = jest.spyOn(window.YouTubeSafeDOM, 'setHTML');

      try {
        const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
        expect(setHTMLSpy).toHaveBeenCalled();
        document.body.appendChild(modal);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } finally {
        window.YouTubeUtils.setSafeHTML = origSetSafe;
      }
    });

    test('restores expanded submenu state when saved in storage', () => {
      window.YouTubeUtils.storage.getItem.mockImplementation(key =>
        key === 'ytp-plus-submenu-states' ? JSON.stringify({ music: true }) : ''
      );

      const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
      document.body.appendChild(modal);

      const toggleBtn = modal.querySelector('.yp-submenu-toggle[data-submenu="music"]');
      expect(toggleBtn?.getAttribute('aria-expanded')).toBe('true');

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('dismissal cleanup handles function disposers and survives throwing disposer', () => {
      const throwingDisposer = jest.fn(() => {
        throw new Error('disposer error');
      });
      const healthyDisposer = jest.fn();

      window.YouTubeUtils.registerListenerSafe
        .mockReturnValueOnce(throwingDisposer)
        .mockReturnValueOnce(healthyDisposer);

      const modal = window.YouTubePlusSettingsModal.create(enhancer, triggerButton);
      document.body.appendChild(modal);

      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(throwingDisposer).toHaveBeenCalled();
      expect(healthyDisposer).toHaveBeenCalled();
    });
  });
});
