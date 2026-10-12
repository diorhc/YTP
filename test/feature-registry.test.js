/**
 * @jest-environment jsdom
 *
 * Tests for FeatureRegistry, VisionDockHost, PlayerActionHost, and SettingsHost.
 */

const setupDeps = () => {
  // Clear any existing globals
  delete window.YouTubePlusFeatureRegistry;
  delete window.YouTubePlusVisionDockHost;
  delete window.YouTubePlusPlayerActionHost;
  delete window.YouTubePlusSettingsHost;

  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => (key === 'takeScreenshot' ? 'Take screenshot' : key)),
      cleanupManager: {
        registerListener: jest.fn((target, event, handler, options) => {
          target.addEventListener(event, handler, options);
          return { dispose: () => target.removeEventListener(event, handler) };
        }),
      },
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      logSuppressed: jest.fn(),
      logError: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusLogger', {
    configurable: true,
    writable: true,
    value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });

  Object.defineProperty(window, 'YouTubePlusSafeDOM', {
    configurable: true,
    writable: true,
    value: {
      setInnerHTML: jest.fn((el, html) => {
        el.innerHTML = html;
      }),
    },
  });

  // SettingsStore mock — mirrors the real contract: get() resolves
  // registered dot-paths (e.g. "styles.themeVariant"), flat keys for
  // top-level settings.
  const storeData = {
    styles: { themeVariant: 'vision' },
    enableScreenshot: true,
    enableZoom: true,
    enableSpeedControl: true,
  };

  Object.defineProperty(window, 'YouTubePlusSettingsStore', {
    configurable: true,
    writable: true,
    value: {
      get: jest.fn((key, def) => {
        if (typeof key === 'string' && key.includes('.')) {
          let cur = storeData;
          for (const seg of key.split('.')) {
            if (cur == null || typeof cur !== 'object' || !(seg in cur)) return def;
            cur = cur[seg];
          }
          return cur;
        }
        return key in storeData ? storeData[key] : def;
      }),
      hasKey: jest.fn(key => key in storeData || key === 'validKey'),
      set: jest.fn((key, val) => {
        storeData[key] = val;
        window.dispatchEvent(
          new CustomEvent('youtube-plus-settings-updated', {
            detail: { key, value: val, changes: { [key]: val } },
          })
        );
      }),
      _storeData: storeData,
    },
  });
};

describe('FeatureRegistry and Hosts', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="movie_player">
        <div class="ytp-chrome-bottom">
          <div class="ytp-right-controls"></div>
        </div>
      </div>
    `;
    setupDeps();
    require('../src/feature-registry.js');
  });

  describe('FeatureRegistry', () => {
    test('exposes the public API and global aliases', () => {
      const reg = window.YouTubePlusFeatureRegistry;
      expect(reg).toBeDefined();
      expect(typeof reg.register).toBe('function');
      expect(typeof reg.get).toBe('function');
      expect(typeof reg.getAll).toBe('function');
      expect(window.YouTubePlusVisionDockHost).toBe(reg.VisionDockHost);
      expect(window.YouTubePlusPlayerActionHost).toBe(reg.PlayerActionHost);
      expect(window.YouTubePlusSettingsHost).toBe(reg.SettingsHost);
    });

    test('registers descriptor and retrieves by id', () => {
      const reg = window.YouTubePlusFeatureRegistry;
      const desc = {
        id: 'test-feat',
        titleKey: 'testTitle',
        settingsKey: 'validKey',
        command: jest.fn(),
      };
      reg.register(desc);

      expect(reg.get('test-feat')).toBe(desc);
      expect(reg.getAll()).toContain(desc);
    });

    test('rejects duplicate feature registration without crashing', () => {
      const reg = window.YouTubePlusFeatureRegistry;
      const desc1 = { id: 'dup-feat', settingsKey: 'validKey' };
      const desc2 = { id: 'dup-feat', settingsKey: 'validKey' };

      expect(reg.register(desc1)).toBe(true);
      expect(reg.register(desc2)).toBe(false);
    });

    test('rejects unknown settingsKey', () => {
      const reg = window.YouTubePlusFeatureRegistry;
      const invalidDesc = {
        id: 'typo-feat',
        settingsKey: 'enableScreenshottTypo',
      };

      expect(reg.register(invalidDesc)).toBe(false);
      expect(reg.get('typo-feat')).toBeNull();
    });
  });

  describe('SettingsHost', () => {
    test('isEnabled delegates to SettingsStore.get', () => {
      const { SettingsHost } = window.YouTubePlusFeatureRegistry;
      expect(SettingsHost.isEnabled('enableScreenshot')).toBe(true);

      window.YouTubePlusSettingsStore._storeData.enableScreenshot = false;
      expect(SettingsHost.isEnabled('enableScreenshot')).toBe(false);
    });

    test('onChange listens to youtube-plus-settings-updated events', () => {
      const { SettingsHost } = window.YouTubePlusFeatureRegistry;
      const cb = jest.fn();
      const sub = SettingsHost.onChange(cb);

      window.dispatchEvent(
        new CustomEvent('youtube-plus-settings-updated', {
          detail: { key: 'enableScreenshot', value: false },
        })
      );

      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'enableScreenshot',
          value: false,
        })
      );

      sub.dispose();
      window.dispatchEvent(
        new CustomEvent('youtube-plus-settings-updated', {
          detail: { key: 'enableScreenshot', value: true },
        })
      );
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('PlayerActionHost', () => {
    test('createButton generates an accessible button with SVG and attributes', () => {
      const { PlayerActionHost } = window.YouTubePlusFeatureRegistry;
      const desc = {
        id: 'screenshot',
        titleKey: 'takeScreenshot',
        iconSVG: '<svg><path d="M0 0h24v24H0z"/></svg>',
      };

      const btn = PlayerActionHost.createButton(desc, {
        className: 'ytp-button yp-screenshot-button',
        id: 'yp-vision-screenshot-btn',
      });

      expect(btn).toBeInstanceOf(HTMLButtonElement);
      expect(btn.id).toBe('yp-vision-screenshot-btn');
      expect(btn.className).toBe('ytp-button yp-screenshot-button');
      expect(btn.getAttribute('aria-label')).toBe('Take screenshot');
      expect(btn.getAttribute('title')).toBe('Take screenshot');
      expect(btn.innerHTML).toContain('<svg');
    });

    test('invokeCommand safely runs descriptor command', () => {
      const { PlayerActionHost } = window.YouTubePlusFeatureRegistry;
      const cmd = jest.fn();
      const desc = { id: 'test-action', command: cmd };
      const ctx = { player: document.getElementById('movie_player') };

      PlayerActionHost.invokeCommand(desc, ctx);
      expect(cmd).toHaveBeenCalledWith(ctx);
    });

    test('invokeCommand catches and logs command error', () => {
      const { PlayerActionHost } = window.YouTubePlusFeatureRegistry;
      const cmd = jest.fn(() => {
        throw new Error('Explosion');
      });
      const desc = { id: 'bad-action', command: cmd };

      PlayerActionHost.invokeCommand(desc, {});
      expect(window.YouTubeUtils.logError).toHaveBeenCalledWith(
        'PlayerActionHost',
        'Command failed for bad-action',
        expect.any(Error)
      );
    });
  });

  describe('VisionDockHost', () => {
    test('mount creates .vision-top-center-dock in Vision theme', () => {
      const { VisionDockHost } = window.YouTubePlusFeatureRegistry;
      const player = document.getElementById('movie_player');

      const dock = VisionDockHost.mount(player);
      expect(dock).toBeTruthy();
      expect(dock.classList.contains('vision-top-center-dock')).toBe(true);
      expect(player.contains(dock)).toBe(true);
    });

    test('mount unmounts dock in Classic theme (themeVariant === "classic")', () => {
      const { VisionDockHost } = window.YouTubePlusFeatureRegistry;
      window.YouTubePlusSettingsStore._storeData.styles.themeVariant = 'classic';
      const player = document.getElementById('movie_player');

      const dock = VisionDockHost.mount(player);
      expect(dock).toBeNull();
      expect(document.querySelector('.vision-top-center-dock')).toBeNull();
    });

    test('generic renderer mounts feature without custom mountDock', () => {
      const reg = window.YouTubePlusFeatureRegistry;
      const { VisionDockHost } = reg;
      const player = document.getElementById('movie_player');

      const genericDesc = {
        id: 'screenshot',
        titleKey: 'takeScreenshot',
        settingsKey: 'enableScreenshot',
        iconSVG: '<svg class="icon"></svg>',
        command: jest.fn(),
      };
      reg.register(genericDesc);

      const dock = VisionDockHost.mount(player);
      expect(dock).toBeTruthy();

      const btn = dock.querySelector('#yp-vision-screenshot-btn');
      expect(btn).toBeTruthy();
      expect(btn.classList.contains('vision-dock-btn')).toBe(true);
      expect(btn.getAttribute('title')).toBe('Take screenshot');

      btn.click();
      expect(genericDesc.command).toHaveBeenCalled();
    });

    test('custom mountDock is called when descriptor defines it', () => {
      const reg = window.YouTubePlusFeatureRegistry;
      const { VisionDockHost } = reg;
      const player = document.getElementById('movie_player');

      const customMount = jest.fn((_p, dock) => {
        const customBtn = document.createElement('button');
        customBtn.id = 'yp-vision-custom-btn';
        dock.appendChild(customBtn);
      });

      const customDesc = {
        id: 'custom-zoom',
        settingsKey: 'enableZoom',
        mountDock: customMount,
      };
      reg.register(customDesc);

      const dock = VisionDockHost.mount(player);
      expect(customMount).toHaveBeenCalledWith(player, dock, undefined);
      expect(dock.querySelector('#yp-vision-custom-btn')).toBeTruthy();
    });

    test('removeFeatureButton removes only specified feature and preserves dock', () => {
      const reg = window.YouTubePlusFeatureRegistry;
      const { VisionDockHost } = reg;
      const player = document.getElementById('movie_player');

      reg.register({
        id: 'screenshot',
        settingsKey: 'enableScreenshot',
        iconSVG: '<svg></svg>',
      });
      reg.register({
        id: 'zoom',
        settingsKey: 'enableZoom',
        mountDock: (_p, dock) => {
          const btn = document.createElement('button');
          btn.id = 'yp-vision-zoom-btn';
          dock.appendChild(btn);
        },
      });

      const dock = VisionDockHost.mount(player);
      expect(dock.querySelector('#yp-vision-screenshot-btn')).toBeTruthy();
      expect(dock.querySelector('#yp-vision-zoom-btn')).toBeTruthy();

      // Removing zoom feature button must NOT remove dock or other buttons!
      VisionDockHost.removeFeatureButton('zoom');

      expect(dock.querySelector('#yp-vision-zoom-btn')).toBeNull();
      expect(dock.querySelector('#yp-vision-screenshot-btn')).toBeTruthy();
      expect(document.querySelector('.vision-top-center-dock')).toBe(dock);
    });

    test('dynamically mounts/unmounts buttons on settings update', () => {
      const reg = window.YouTubePlusFeatureRegistry;
      const { VisionDockHost } = reg;
      const player = document.getElementById('movie_player');

      reg.register({
        id: 'screenshot',
        settingsKey: 'enableScreenshot',
        iconSVG: '<svg></svg>',
      });

      const dock = VisionDockHost.mount(player);
      expect(dock.querySelector('#yp-vision-screenshot-btn')).toBeTruthy();

      // Disable screenshot setting
      window.YouTubePlusSettingsStore.set('enableScreenshot', false);

      expect(dock.querySelector('#yp-vision-screenshot-btn')).toBeNull();
      expect(document.querySelector('.vision-top-center-dock')).toBe(dock);

      // Re-enable screenshot setting
      window.YouTubePlusSettingsStore.set('enableScreenshot', true);

      expect(dock.querySelector('#yp-vision-screenshot-btn')).toBeTruthy();
    });

    test('dynamically tears down dock when theme switches to classic', () => {
      const reg = window.YouTubePlusFeatureRegistry;
      const { VisionDockHost } = reg;
      const player = document.getElementById('movie_player');

      reg.register({
        id: 'screenshot',
        settingsKey: 'enableScreenshot',
        iconSVG: '<svg></svg>',
      });

      const dock = VisionDockHost.mount(player);
      expect(dock).toBeTruthy();
      expect(document.querySelector('.vision-top-center-dock')).toBeTruthy();

      // Switch theme to classic (nested path, as the real store stores it)
      window.YouTubePlusSettingsStore.set('styles', { themeVariant: 'classic' });

      expect(document.querySelector('.vision-top-center-dock')).toBeNull();
    });
  });
});
