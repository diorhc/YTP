/**
 * Vision dock buttons are explicit
 * host-owned resources with release-on-remove and working remount.
 *
 * Contracts under test (real FeatureRegistry/VisionDockHost + real
 * SettingsStore + real CleanupManager):
 *   - After the per-navigation cleanup sweep, a REMOUNTED dock button is
 *     clickable again: the generic host re-attaches its OWN registration
 *     for the same handler — a present-but-dead button is not
 *     silently reused.
 *   - 20 disable/enable toggle cycles release detached button
 *     registrations: no listener-registry growth, no entries pointing at
 *     detached elements.
 *   - Removing ONE feature's button must not disturb other features'
 *     live registrations.
 *   - The host owns only the registrations it created (no command copies).
 */

describe('Vision dock button dispose and remount', () => {
  // ONE surviving CleanupManager for the whole file (setup.js keeps its
  // facade across tests): feature-registry/settings-store instances are
  // re-required per test and unregister their previous window listeners
  // through THIS manager via their saved keys — so no leaked handlers.
  beforeAll(() => {
    require('../src/cleanup-manager.js');
  });

  beforeEach(() => {
    require('../src/utils.js');
    require('../src/settings-store.js');
    require('../src/safe-dom.js');
    require('../src/feature-registry.js');
  });

  const setupPlayer = () => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=testvideo1',
    });
    const player = document.createElement('div');
    player.id = 'movie_player';
    document.body.append(player);
    return player;
  };

  afterEach(() => {
    // Release this test's dock registrations before the facade is wiped.
    window.YouTubePlusVisionDockHost?.unmount?.();
    window.YouTubePlusFeatureRegistry?._reset?.();
    document.body.innerHTML = '';
  });

  test('dock button stays interactive after cleanup and remount', () => {
    const reg = window.YouTubePlusFeatureRegistry;
    const host = window.YouTubePlusVisionDockHost;
    const cm = window.YouTubePlusCleanupManager;
    const player = setupPlayer();

    let hits = 0;
    expect(
      reg.register({
        id: 'screenshot',
        settingsKey: 'enableScreenshot',
        titleKey: 'takeScreenshot',
        command: () => {
          hits++;
          return true;
        },
      })
    ).toBe(true);

    host.mount(player);
    const btn = host.getDock().firstChild;
    expect(btn).toBeTruthy();

    btn.click();
    expect(hits).toBe(1);

    // Per-navigation sweep: the click registration is removed, DOM stays.
    cm.cleanup();
    host.mount(player);
    // The host must make the SAME button clickable again.
    expect(hits).toBe(1); // no click happened during remount
    btn.click();
    expect(hits).toBe(2);
    expect(btn === host.getDock().firstChild).toBe(true); // reused, not duplicated
  });

  test('20 disable/enable cycles leave no detached registrations', () => {
    const reg = window.YouTubePlusFeatureRegistry;
    const host = window.YouTubePlusVisionDockHost;
    const cm = window.YouTubePlusCleanupManager;
    const store = window.YouTubePlusSettingsStore;
    const player = setupPlayer();

    expect(
      reg.register({
        id: 'screenshot',
        settingsKey: 'enableScreenshot',
        titleKey: 'takeScreenshot',
        command: () => true,
      })
    ).toBe(true);

    host.mount(player);
    const base = cm.getListenerStats().active;

    for (let i = 0; i < 20; i++) {
      store.set('enableScreenshot', false);
      store.set('enableScreenshot', true);
    }

    const after = cm.getListenerStats().active;
    const detached = [...cm.listeners.values()].filter(
      /** @type {(l: any) => boolean} */ l =>
        l.target instanceof HTMLElement && !l.target.isConnected
    );
    expect(after).toBeLessThanOrEqual(base);
    expect(detached).toHaveLength(0);
    // And the final button still works.
    const btn = host.getDock().querySelector('.yp-screenshot-button');
    expect(btn).toBeTruthy();
  });

  test('removing one feature releases only its own registration', () => {
    const reg = window.YouTubePlusFeatureRegistry;
    const host = window.YouTubePlusVisionDockHost;
    const cm = window.YouTubePlusCleanupManager;
    const player = setupPlayer();

    let zoomHits = 0;
    let shotHits = 0;
    reg.register({
      id: 'screenshot',
      settingsKey: 'enableScreenshot',
      command: () => {
        shotHits++;
        return true;
      },
    });
    reg.register({
      id: 'zoom',
      settingsKey: 'enableZoom',
      command: () => {
        zoomHits++;
        return true;
      },
    });

    host.mount(player);
    const shotBtn = host.getDock().querySelector('.yp-screenshot-button');
    const zoomBtn = host.getDock().querySelector('.yp-zoom-button');
    expect(shotBtn).toBeTruthy();
    expect(zoomBtn).toBeTruthy();

    const registryBefore = cm.getListenerStats().active;
    host.removeFeatureButton('zoom');
    // Releasing zoom's registration removed exactly one entry.
    expect(cm.getListenerStats().active).toBe(registryBefore - 1);

    // Other features' buttons stay interactive.
    shotBtn.click();
    expect(shotHits).toBe(1);
    expect(zoomHits).toBe(0);
  });

  test('unmount releases all host-created registrations', () => {
    const reg = window.YouTubePlusFeatureRegistry;
    const host = window.YouTubePlusVisionDockHost;
    const cm = window.YouTubePlusCleanupManager;
    const player = setupPlayer();

    reg.register({
      id: 'screenshot',
      settingsKey: 'enableScreenshot',
      command: () => true,
    });
    reg.register({
      id: 'zoom',
      settingsKey: 'enableZoom',
      command: () => true,
    });

    host.mount(player);
    const active = cm.getListenerStats().active;
    expect(active).toBeGreaterThan(0);

    host.unmount();
    // All host-owned click registrations are released (the persistent
    // settings-updated subscription belongs to the registry itself and
    // survives — it is not button-scoped).
    const dockRelated = [...cm.listeners.values()].filter(
      /** @type {(l: any) => boolean} */ l => l.target instanceof HTMLButtonElement
    );
    expect(dockRelated).toHaveLength(0);
    expect(document.querySelector('.vision-top-center-dock')).toBeNull();

    // Remount restores a working dock.
    host.mount(player);
    const btn = host.getDock().querySelector('.yp-screenshot-button');
    expect(btn).toBeTruthy();
  });
});
