/**
 * Settings section transitions.
 *
 * Contract under test (real MutationCoordinator + real CleanupManager):
 *   - onSectionActive fires onEnter/leave exactly once per TRANSITION:
 *     A→A re-activation does not duplicate enter; switching to another
 *     section calls onLeave (previously only modal-close did).
 *   - Closing the modal leaves the active section; disposing an ACTIVE
 *     section invokes its final onLeave and releases the scope.
 *   - The whenRelevant persistent-listener fix stays green.
 */

describe('settings section transitions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/mutation-coordinator.js');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const activateSection = section => {
    document.dispatchEvent(
      new CustomEvent('youtube-plus-settings-section-activated', {
        detail: { section },
      })
    );
  };

  test('A→B switch calls onLeave of the previous section', () => {
    const mc = window.YouTubePlusMutationCoordinator;
    /** @type {string[]} */
    const events = [];
    const sub = mc.onSectionActive(
      'download',
      () => events.push('enter:download'),
      () => events.push('leave:download')
    );

    activateSection('download');
    activateSection('music');

    expect(events).toEqual(['enter:download', 'leave:download']);
    sub.dispose();
  });

  test('A→A→B→close→dispose: every enter/leave at most once per transition', () => {
    const mc = window.YouTubePlusMutationCoordinator;
    /** @type {string[]} */
    const events = [];
    const sub = mc.onSectionActive(
      'download',
      () => events.push('enter:download'),
      () => events.push('leave:download')
    );

    activateSection('download'); // enter
    activateSection('download'); // re-activation: no duplicate enter
    activateSection('music'); // leave download
    activateSection('music'); // already left: no duplicate leave
    // Close the modal while music is active — but our section is INACTIVE:
    // no leave should fire for it.
    document.dispatchEvent(new CustomEvent('youtube-plus-settings-modal-closed'));
    sub.dispose(); // disposing an INACTIVE section: no trailing leave

    expect(events).toEqual(['enter:download', 'leave:download']);
  });

  test('modal close leaves the active section exactly once', () => {
    const mc = window.YouTubePlusMutationCoordinator;
    /** @type {string[]} */
    const events = [];
    const sub = mc.onSectionActive(
      'download',
      () => events.push('enter:download'),
      () => events.push('leave:download')
    );

    activateSection('download');
    document.dispatchEvent(new CustomEvent('youtube-plus-settings-modal-closed'));
    document.dispatchEvent(new CustomEvent('youtube-plus-settings-modal-closed'));
    sub.dispose();

    expect(events).toEqual(['enter:download', 'leave:download']);
  });

  test('disposing an ACTIVE section invokes its final onLeave', () => {
    const mc = window.YouTubePlusMutationCoordinator;
    /** @type {string[]} */
    const events = [];
    const sub = mc.onSectionActive(
      'download',
      () => events.push('enter:download'),
      () => events.push('leave:download')
    );

    activateSection('download');
    sub.dispose();

    expect(events).toEqual(['enter:download', 'leave:download']);
    // Scope released: a later activation does nothing.
    activateSection('download');
    expect(events).toEqual(['enter:download', 'leave:download']);
  });

  test('onEnter failure retries on the next matching activation', () => {
    const mc = window.YouTubePlusMutationCoordinator;
    let attempts = 0;
    let enters = 0;
    const sub = mc.onSectionActive(
      'download',
      () => {
        attempts++;
        if (attempts === 1) throw new Error('first enter fails');
        enters++;
      },
      () => {
        /* onLeave */
      }
    );

    activateSection('download'); // onEnter throws → stays inactive
    activateSection('download'); // retried
    expect(attempts).toBe(2);
    expect(enters).toBe(1);
    sub.dispose();
  });

  test('regression: whenRelevant signal survives cleanup; dispose removes', () => {
    const cm = window.YouTubePlusCleanupManager;
    const mc = window.YouTubePlusMutationCoordinator;
    let enabled = false;
    let enters = 0;
    const rel = mc.whenRelevant({ isRelevant: () => enabled, onEnter: () => enters++ });
    const withSub = cm.listeners.size;
    cm.cleanup();
    enabled = true;
    window.dispatchEvent(new CustomEvent('youtube-plus-settings-updated'));
    expect(enters).toBe(1);
    // The persistent signal handlers survived the sweep (no growth, no loss).
    expect(cm.listeners.size).toBe(withSub);
    rel.dispose();
    expect(cm.listeners.size).toBe(withSub - 4);
  });
});
