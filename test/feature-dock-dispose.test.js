/**
 * U05/A03 — unified custom-dock mount lifecycle.
 *
 * Contract: custom mountDock implementations must be idempotent, re-attach
 * their listeners on every mount/update call (restoring handlers after the
 * per-navigation cleanup sweep), and return an idempotent dispose that the
 * host calls on removeFeatureButton/unmount/replacement — leaving zero
 * detached registrations behind.
 * @jest-environment jsdom
 */

describe('Custom dock mount lifecycle (U05/A03)', () => {
  let clicks;

  /** Descriptor following the U05 contract: stable closure + dispose. */
  function makeCustomDescriptor(id, domId) {
    return {
      id,
      titleKey: `u05${id}`,
      fallbackTitle: id,
      iconSVG: '<svg></svg>',
      command: jest.fn(() => {
        clicks += 1;
        return true;
      }),
      settingsKey: 'enableScreenshot',
      mountDock(_player, dock) {
        let btn = dock.querySelector(`#${domId}`);
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.id = domId;
          btn.className = 'vision-dock-btn';
          dock.appendChild(btn);
        }
        const stable = /** @type {(e: Event) => void} */ (
          () => {
            clicks += 1;
          }
        );
        const cmKey = window.YouTubePlusCleanupManager?.registerListener?.(
          btn,
          'click',
          stable,
          undefined,
          false
        );
        return () => {
          if (cmKey) window.YouTubePlusCleanupManager?.unregisterListener?.(cmKey);
        };
      },
    };
  }

  function setupDeps() {
    Object.defineProperty(window, 'YouTubePlusSafeDOM', {
      configurable: true,
      writable: true,
      value: {
        setInnerHTML: jest.fn((el, html) => {
          el.innerHTML = html;
        }),
      },
    });
    Object.defineProperty(window, 'YouTubePlusSettingsStore', {
      configurable: true,
      writable: true,
      value: {
        get: jest.fn((key, def) => {
          if (typeof key === 'string' && key.includes('.')) {
            const data = { styles: { themeVariant: 'vision' } };
            let cur = data;
            for (const seg of key.split('.')) {
              if (cur == null || typeof cur !== 'object' || !(seg in cur)) return def;
              cur = cur[seg];
            }
            return cur;
          }
          return def;
        }),
        hasKey: jest.fn(() => true),
      },
    });
  }

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML =
      '<div id="movie_player"><div class="ytp-chrome-bottom"><div class="ytp-right-controls"></div></div></div>';
    setupDeps();
    clicks = 0;
    // The manager is installed once per file by setup.js; wipe its non-persistent
    // entries the same way a navigation sweep would, so tests start at baseline.
    window.YouTubePlusCleanupManager?.cleanup?.();
    require('../src/feature-registry.js');
  });

  function getRegistry() {
    return window.YouTubePlusFeatureRegistry;
  }

  function detachedListenerCount() {
    const cm = window.YouTubePlusCleanupManager;
    let detached = 0;
    for (const entry of cm.listeners.values()) {
      const t = entry.target;
      if (t && typeof t === 'object' && 'isConnected' in t && !t.isConnected) detached += 1;
    }
    return detached;
  }

  test('isAvailable false keeps the button out of the dock and releases a mounted one', () => {
    const reg = getRegistry();
    const player = reg.VisionDockHost.getPlayer();
    let available = true;
    const desc = makeCustomDescriptor('u05-avail', 'yp-vision-u05-avail-btn');
    desc.isAvailable = () => available;
    reg.register(desc);

    reg.VisionDockHost.mount(player);
    expect(document.querySelector('#yp-vision-u05-avail-btn')).toBeTruthy();
    const listenersMounted = window.YouTubePlusCleanupManager.getListenerStats().active;

    available = false;
    reg.VisionDockHost.renderFeature('u05-avail', player, reg.VisionDockHost.getDock());
    expect(document.querySelector('#yp-vision-u05-avail-btn')).toBeNull();
    expect(window.YouTubePlusCleanupManager.getListenerStats().active).toBe(listenersMounted - 1);
    expect(detachedListenerCount()).toBe(0);

    available = true;
    reg.VisionDockHost.renderFeature('u05-avail', player, reg.VisionDockHost.getDock());
    expect(document.querySelector('#yp-vision-u05-avail-btn')).toBeTruthy();
  });

  test('custom mount restores click handlers after cleanup sweep on stable DOM', () => {
    const reg = getRegistry();
    const player = reg.VisionDockHost.getPlayer();
    reg.register(makeCustomDescriptor('u05-custom', 'yp-vision-u05-btn'));

    reg.VisionDockHost.mount(player);
    const btn = document.querySelector('#yp-vision-u05-btn');
    expect(btn).toBeTruthy();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toBe(1);

    // Per-navigation sweep (utils.js runs this on yt-navigate-start).
    window.YouTubePlusCleanupManager.cleanup();

    // Stable DOM: the same button is still in the dock; renderFeature must
    // restore the handler instead of early-returning.
    reg.VisionDockHost.renderFeature('u05-custom', player, reg.VisionDockHost.getDock());
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toBe(2);
  });

  test('removeFeatureButton releases custom mount registrations (no detached entries)', () => {
    const reg = getRegistry();
    const player = reg.VisionDockHost.getPlayer();
    reg.register(makeCustomDescriptor('u05-detach', 'yp-vision-u05-detach-btn'));
    reg.VisionDockHost.mount(player);

    for (let i = 0; i < 20; i++) {
      reg.VisionDockHost.renderFeature('u05-detach', player, reg.VisionDockHost.getDock());
      reg.VisionDockHost.removeFeatureButton('u05-detach');
    }

    expect(document.querySelector('#yp-vision-u05-detach-btn')).toBeNull();
    expect(detachedListenerCount()).toBe(0);
  });

  test('unmount disposes custom mounts; re-mount on new player restores actions', () => {
    const reg = getRegistry();
    const player = reg.VisionDockHost.getPlayer();
    reg.register(makeCustomDescriptor('u05-remount', 'yp-vision-u05-remount-btn'));

    reg.VisionDockHost.mount(player);
    const dock1 = reg.VisionDockHost.getDock();
    expect(dock1).toBeTruthy();
    dock1
      .querySelector('#yp-vision-u05-remount-btn')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toBe(1);

    // Player replacement: old dock is unmounted and must leave no detached
    // registrations behind.
    reg.VisionDockHost.unmount();
    expect(reg.VisionDockHost.getDock()).toBeNull();
    expect(detachedListenerCount()).toBe(0);

    const player2 = document.createElement('div');
    player2.id = 'movie_player2';
    document.body.appendChild(player2);
    reg.VisionDockHost.mount(player2);
    const dock2 = reg.VisionDockHost.getDock();
    expect(dock2).toBeTruthy();
    dock2
      .querySelector('#yp-vision-u05-remount-btn')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toBe(2);
    expect(detachedListenerCount()).toBe(0);
  });

  test('acceptance: 100 toggles + 20 SPA sweeps + player replacement keep actions alive with detached=0', () => {
    const reg = getRegistry();
    reg.register(makeCustomDescriptor('u05-stress', 'yp-vision-u05-stress-btn'));

    const sweep = () => {
      // utils.js runs cleanupManager.cleanup() on yt-navigate-start.
      window.YouTubePlusCleanupManager.cleanup();
    };

    // 20 SPA transitions: sweep (navigate-start) + re-render (navigate finish).
    for (let nav = 0; nav < 20; nav++) {
      sweep();
      reg.VisionDockHost.mount(reg.VisionDockHost.getPlayer());
      const btn = document.querySelector('#yp-vision-u05-stress-btn');
      expect(btn).toBeTruthy();
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicks).toBe(nav + 1);
    }
    expect(detachedListenerCount()).toBe(0);

    // Player replacement: brand-new player element, old dock goes away.
    const oldPlayer = reg.VisionDockHost.getPlayer();
    reg.VisionDockHost.unmount();
    oldPlayer.remove();
    const player2 = document.createElement('div');
    player2.id = 'movie_player';
    document.body.appendChild(player2);
    reg.VisionDockHost.mount(player2);

    // 100 enable/disable toggles (settings updates re-render each feature).
    for (let t = 0; t < 100; t++) {
      reg.VisionDockHost.renderFeature('u05-stress', player2, reg.VisionDockHost.getDock());
      reg.VisionDockHost.removeFeatureButton('u05-stress');
    }
    expect(document.querySelector('#yp-vision-u05-stress-btn')).toBeNull();
    expect(detachedListenerCount()).toBe(0);

    // Final render works and registry sits at baseline (single live entry).
    reg.VisionDockHost.renderFeature('u05-stress', player2, reg.VisionDockHost.getDock());
    const btn = document.querySelector('#yp-vision-u05-stress-btn');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toBe(21);
    expect(detachedListenerCount()).toBe(0);
  });
});
