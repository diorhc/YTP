/**
 * The settings modal has ONE lifecycle
 * session; every close path (re-open, Escape, close button, backdrop,
 * external API) completes the SAME idempotent dispose.
 *
 * Contracts under test (real SettingsModal + real CleanupManager; the
 * enhancer and modal-handlers surface are the external UI context, as in
 * the audit probe):
 *   - Repeated open without close releases the previous session: exactly
 *     one window keydown listener, no detached DOM registrations, registry
 *     back to the per-session baseline.
 *   - Escape and API close go through the same dispose: closed event fires
 *     exactly once per close, focus returns to the initiator.
 *   - 50 open/close cycles return the registry to baseline.
 */

describe('single modal lifecycle session', () => {
  const makeEnhancer = () => ({
    settings: {},
    getElement: /** @type {(sel: string, useCache?: boolean) => Element|null} */ sel =>
      document.querySelector(sel),
    insertStyles: () => {
      /* mock */
    },
    ensureNonCriticalStyles: () => {
      /* mock */
    },
    addDownloadButton: () => {
      /* mock */
    },
    addSpeedControlButton: () => {
      /* mock */
    },
    refreshDownloadButton: () => {
      /* mock */
    },
    updateActiveSectionLabel: () => {
      /* mock */
    },
    openSettingsSection: () => {
      /* mock */
    },
    handleThemeOptionsClick_: () => false,
    showNotification: () => {
      /* mock */
    },
    updatePageBasedOnSettings: () => {
      /* mock */
    },
    saveSettings: () => {
      /* mock */
    },
  });

  const makeTriggerButton = () => {
    const btn = document.createElement('button');
    btn.textContent = 'open settings';
    document.body.append(btn);
    btn.focus();
    return btn;
  };

  beforeAll(() => {
    require('../src/cleanup-manager.js');
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    // External UI context (as in the audit probe) and the REAL navigation
    // core: the A11 contracts exercise the real section-activation
    // scheduling that the modal delegates to.
    require('../src/utils.js');
    require('../src/safe-dom.js');
    require('../src/settings-helpers.js');
    require('../src/modal-handlers.js');
    require('../src/settings-modal.js');
  });

  afterEach(() => {
    // Complete any session left open by the test (the global afterEach then
    // wipes the facades).
    window.YouTubePlusSettingsModal?.close?.();
    document.body.innerHTML = '';
  });

  test('repeated open releases the previous session (one keydown, no detached)', () => {
    const cm = window.YouTubePlusCleanupManager;
    const enhancer = makeEnhancer();

    window.YouTubePlusSettingsModal.open(enhancer);
    const afterOneOpen = cm.getListenerStats().active;

    // Nine further opens must dispose the previous session each time: the
    // registry must stay at exactly ONE session's worth of registrations.
    for (let i = 0; i < 9; i++) {
      window.YouTubePlusSettingsModal.open(enhancer);
    }
    expect(cm.getListenerStats().active).toBe(afterOneOpen);

    const keys = [...cm.listeners.values()];
    const escapes = keys.filter(x => x.target === window && x.ev === 'keydown');
    const detached = keys.filter(
      /** @type {(l: any) => boolean} */ x =>
        x.target instanceof HTMLElement && !x.target.isConnected
    );
    expect(escapes).toHaveLength(1);
    expect(detached).toHaveLength(0);
  });

  test('Escape and API close share one dispose; closed event fires exactly once', () => {
    const cm = window.YouTubePlusCleanupManager;
    const enhancer = makeEnhancer();
    const start = cm.getListenerStats().active;

    let closedEvents = 0;
    document.addEventListener('youtube-plus-settings-modal-closed', () => {
      closedEvents++;
    });

    // Escape path
    window.YouTubePlusSettingsModal.open(enhancer);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.yp-settings-modal')).toBeNull();
    expect(closedEvents).toBe(1);
    expect(cm.getListenerStats().active).toBe(start);

    // API close (external closeSettings surface)
    window.YouTubePlusSettingsModal.open(enhancer);
    const closedViaApi = window.YouTubePlusSettingsModal.close();
    expect(closedViaApi).toBe(true);
    expect(document.querySelector('.yp-settings-modal')).toBeNull();
    expect(closedEvents).toBe(2);
    expect(cm.getListenerStats().active).toBe(start);
  });

  test('Basic.closeSettings goes through the same session dispose', () => {
    const cm = window.YouTubePlusCleanupManager;
    const enhancer = makeEnhancer();
    // Load the Basic facade (the real external API consumer) BEFORE the
    // baseline so its own module-level registrations are included. Auto-init
    // is suppressed; the closeSettings wiring is module-level.
    window.__ytpBasicInitDone__ = true;
    require('../src/design-system.js');
    require('../src/settings-store.js');
    require('../src/basic.js');
    const start = cm.getListenerStats().active;

    const initiator = makeTriggerButton();
    window.YouTubePlusSettingsModal.open(enhancer);
    expect(document.querySelector('.yp-settings-modal')).toBeTruthy();

    // Load the Basic facade (the real external API consumer). Auto-init is
    // suppressed; the closeSettings wiring is module-level.
    window.__ytpBasicInitDone__ = true;
    require('../src/design-system.js');
    require('../src/settings-store.js');
    require('../src/basic.js');

    window.YouTubePlusBasic.closeSettings();
    expect(document.querySelector('.yp-settings-modal')).toBeNull();
    expect(cm.getListenerStats().active).toBe(start);
    // Focus must return to the existing initiator.
    expect(document.activeElement).toBe(initiator);
  });

  test('50 open/close cycles return the registry to baseline', () => {
    const cm = window.YouTubePlusCleanupManager;
    const enhancer = makeEnhancer();
    const start = cm.getListenerStats().active;

    for (let i = 0; i < 50; i++) {
      window.YouTubePlusSettingsModal.open(enhancer);
      window.YouTubePlusSettingsModal.close();
    }

    const keys = [...cm.listeners.values()];
    const detached = keys.filter(
      /** @type {(l: any) => boolean} */ x =>
        x.target instanceof HTMLElement && !x.target.isConnected
    );
    expect(cm.getListenerStats().active).toBe(start);
    expect(detached).toHaveLength(0);
  });

  test('closing releases listeners other modules attached inside the dialog', () => {
    const cm = window.YouTubePlusCleanupManager;
    const enhancer = makeEnhancer();
    const start = cm.getListenerStats().active;

    for (let i = 0; i < 10; i++) {
      window.YouTubePlusSettingsModal.open(enhancer);
      const modal = document.querySelector('.yp-settings-modal');
      const widget = document.createElement('button');
      modal?.appendChild(widget);
      // A section widget (e.g. a glass dropdown) and its click-outside
      // listener on document, owned by the widget.
      cm.registerListener(widget, 'click', jest.fn());
      cm.registerListener(document, 'click', jest.fn(), { owner: widget }, true);
      window.YouTubePlusSettingsModal.close();
    }

    expect(cm.getListenerStats().active).toBe(start);
  });

  test('A11: open then immediate close cancels initial section activation', async () => {
    const enhancer = makeEnhancer();
    let activatedEvents = 0;
    const onActivated = () => activatedEvents++;
    document.addEventListener('youtube-plus-settings-section-activated', onActivated);

    // Open and close immediately in same tick
    window.YouTubePlusSettingsModal.open(enhancer);
    window.YouTubePlusSettingsModal.close();

    // Advance tick / flush microtasks
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(activatedEvents).toBe(0);

    document.removeEventListener('youtube-plus-settings-section-activated', onActivated);
  });

  test('A11 positive control: open and stay dispatches section activation on next tick', async () => {
    const enhancer = makeEnhancer();
    let activatedDetail = null;
    const onActivated = e => {
      activatedDetail = e.detail;
    };
    document.addEventListener('youtube-plus-settings-section-activated', onActivated);

    window.YouTubePlusSettingsModal.open(enhancer);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(activatedDetail).toBeTruthy();
    expect(activatedDetail.section).toBeTruthy();

    window.YouTubePlusSettingsModal.close();
    document.removeEventListener('youtube-plus-settings-section-activated', onActivated);
  });

  test('A11 with MutationCoordinator: immediate close leaves section inactive', async () => {
    require('../src/mutation-coordinator.js');
    const mc = window.YouTubePlusMutationCoordinator;
    const enhancer = makeEnhancer();

    let entered = 0;
    let left = 0;
    const sub = mc.onSectionActive(
      'basic',
      () => entered++,
      () => left++
    );

    // Open then close immediately
    window.YouTubePlusSettingsModal.open(enhancer);
    window.YouTubePlusSettingsModal.close();

    await new Promise(resolve => setTimeout(resolve, 50));
    // Must NOT have entered the section after closure
    expect(entered).toBe(0);

    sub.dispose();
  });

  test('Route change (yt-navigate-start and popstate) closes modal with single event and 0 leaks', () => {
    const cm = window.YouTubePlusCleanupManager;
    const enhancer = makeEnhancer();
    const start = cm.getListenerStats().active;

    let closedEvents = 0;
    const onClosed = () => closedEvents++;
    document.addEventListener('youtube-plus-settings-modal-closed', onClosed);

    // Test yt-navigate-start
    window.YouTubePlusSettingsModal.open(enhancer);
    expect(document.querySelector('.yp-settings-modal')).toBeTruthy();
    window.dispatchEvent(new CustomEvent('yt-navigate-start'));
    expect(document.querySelector('.yp-settings-modal')).toBeNull();
    expect(closedEvents).toBe(1);
    expect(cm.getListenerStats().active).toBe(start);

    // Test popstate
    window.YouTubePlusSettingsModal.open(enhancer);
    expect(document.querySelector('.yp-settings-modal')).toBeTruthy();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.querySelector('.yp-settings-modal')).toBeNull();
    expect(closedEvents).toBe(2);
    expect(cm.getListenerStats().active).toBe(start);

    document.removeEventListener('youtube-plus-settings-modal-closed', onClosed);
  });

  test('A12: focus containment traps Tab and Shift+Tab inside modal', () => {
    const enhancer = makeEnhancer();
    const trigger = makeTriggerButton();

    window.YouTubePlusSettingsModal.open(enhancer);
    const modal = document.querySelector('.yp-settings-modal');
    expect(modal).toBeTruthy();

    const focusables = Array.from(modal.querySelectorAll('button, input, [tabindex="0"]')).filter(
      el => el.offsetParent !== null || !el.closest('.hidden')
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Forward Tab from last element wraps to first
    last.focus();
    expect(document.activeElement).toBe(last);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(first);

    // Backward Shift+Tab from first element wraps to last
    first.focus();
    expect(document.activeElement).toBe(first);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(last);

    // Tab when focus was outside modal redirects to first
    document.body.focus();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(first);

    // Close restores focus to trigger button
    window.YouTubePlusSettingsModal.close();
    expect(document.activeElement).toBe(trigger);
  });
});
