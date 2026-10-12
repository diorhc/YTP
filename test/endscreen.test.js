/**
 * @jest-environment jsdom
 *
 * The end-screen remover (src/endscreen.js) on the FeatureLifecycle contract,
 * with the real CleanupManager, SettingsStore, EventDelegation, registry and
 * StyleManager.
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

const store = () => window.YouTubePlusSettingsStore;
const hooks = () => window.YouTubePlusEndscreen.testHooks;
const css = () => [...document.querySelectorAll('style')].map(el => el.textContent).join('\n');
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
const counts = () => ({
  listeners: window.YouTubePlusCleanupManager.getListenerStats().active,
  timeouts: window.YouTubePlusCleanupManager.timeouts.size,
});

/** @param {string} className */
const addCard = className => {
  const el = document.createElement('div');
  el.className = className;
  document.querySelector('#movie_player').appendChild(el);
  return el;
};

describe('Endscreen remover', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="movie_player"></div>';
    localStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    // Each test loads its own design system; the next one must not fight
    // this one's style-host observer.
    window.YouTubePlusDesignSystem?.StyleManager?.clear?.();
  });

  const load = () => {
    loadChain();
    require('../src/endscreen.js');
  };

  test('removes existing cards on start and hides new ones with its style', async () => {
    addCard('ytp-ce-element');
    load();
    expect(document.querySelector('.ytp-ce-element')).toBeNull();
    await nextFrame();
    expect(css()).toContain('.ytp-ce-element');
    expect(hooks().state.removeCount).toBeGreaterThanOrEqual(1);
  });

  test('fastRemove hides and detaches at most one batch', () => {
    load();
    const cards = Array.from({ length: hooks().CONFIG.batchSize + 2 }, () =>
      addCard('ytp-endscreen-element')
    );
    hooks().fastRemove(cards);
    expect(cards.filter(el => el.isConnected)).toHaveLength(2);
  });

  test('removeEndScreens is debounced unless forced', () => {
    load();
    const first = addCard('ytp-cards-teaser');
    hooks().removeEndScreens({ force: true });
    expect(first.isConnected).toBe(false);

    hooks().removeEndScreens();
    const second = addCard('ytp-cards-teaser');
    hooks().removeEndScreens();
    expect(second.isConnected).toBe(true);
  });

  test('isRelevantNode accepts player elements only', () => {
    load();
    const el = document.createElement('div');
    el.className = 'ytp-ce-element-show';
    expect(hooks().isRelevantNode(el)).toBe(true);
    const unrelated = document.createElement('div');
    unrelated.className = 'header-nav';
    expect(hooks().isRelevantNode(unrelated)).toBe(false);
    expect(hooks().isRelevantNode(document.createTextNode('x'))).toBe(false);
  });

  test('element with className === undefined does not crash subscriber or isRelevantNode', () => {
    load();
    const el = document.createElement('div');
    Object.defineProperty(el, 'className', { value: undefined });

    expect(hooks().getClassNameValue(el)).toBe('');
    expect(() => hooks().isRelevantNode(el)).not.toThrow();
    expect(hooks().isRelevantNode(el)).toBe(false);

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.defineProperty(svgEl, 'className', { value: { baseVal: 'ytp-svg-test' } });
    expect(hooks().getClassNameValue(svgEl)).toBe('ytp-svg-test');
    expect(hooks().isRelevantNode(svgEl)).toBe(true);

    const svgEmpty = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.defineProperty(svgEmpty, 'className', { value: { baseVal: '' } });
    expect(hooks().getClassNameValue(svgEmpty)).toBe('');

    const plainObj = document.createElement('div');
    Object.defineProperty(plainObj, 'className', { value: {} });
    expect(hooks().getClassNameValue(plainObj)).toBe('');

    // Simulate mutation containing the undefined-className element
    const coordinator = window.YouTubePlusMutationCoordinator;
    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      document.querySelector('#movie_player').appendChild(el);
      // Trigger coordinator manual sweep / dispatch if coordinator tracks mutations
      if (coordinator?._dispatch) {
        coordinator._dispatch([
          {
            type: 'childList',
            target: document.querySelector('#movie_player'),
            addedNodes: [el],
            removedNodes: [],
          },
        ]);
      }
    } finally {
      console.error = origError;
    }
    // Must not log subscriber failed error
    expect(errors.some(e => e.includes('subscriber failed'))).toBe(false);
  });

  test('10 on/off cycles leave no listener, timer, style or watcher behind', async () => {
    load();
    const coordinator = window.YouTubePlusMutationCoordinator;
    store().set('endscreen', false);
    const baseline = counts();
    const watchers = coordinator.getStats().rootWatchers;

    for (let i = 0; i < 10; i++) {
      store().set('endscreen', true);
      await nextFrame();
      expect(css()).toContain('.ytp-ce-element');
      store().set('endscreen', false);
      await nextFrame();
    }

    expect(counts()).toEqual(baseline);
    expect(coordinator.getStats().rootWatchers).toBe(watchers);
    expect(css()).not.toContain('.ytp-ce-element');
    const card = addCard('ytp-ce-element');
    hooks().removeEndScreens({ force: true });
    expect(card.isConnected).toBe(true);

    store().set('endscreen', true);
    expect(card.isConnected).toBe(false);
  });

  test('cards added later are removed through the player watch', async () => {
    load();
    const card = addCard('ytp-ce-element');
    await new Promise(r => setTimeout(r, 120));
    expect(card.isConnected).toBe(false);

    const unrelated = document.createElement('div');
    unrelated.className = 'header-nav';
    document.querySelector('#movie_player').appendChild(unrelated);
    await new Promise(r => setTimeout(r, 120));
    expect(unrelated.isConnected).toBe(true);
  });

  test('opening the Advanced section mounts the settings row', () => {
    load();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="enhanced-submenu"><div class="glass-card"></div></div><button data-section="advanced"></button>'
    );
    jest.useFakeTimers();
    try {
      document.querySelector('[data-section="advanced"]').click();
      jest.advanceTimersByTime(10);
    } finally {
      jest.useRealTimers();
    }
    expect(document.querySelector('.endscreen-settings')).not.toBeNull();
  });

  test('the settings checkbox writes the store key', () => {
    load();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="enhanced-submenu"><div class="glass-card"></div></div>'
    );
    jest.useFakeTimers();
    try {
      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      jest.advanceTimersByTime(25);
    } finally {
      jest.useRealTimers();
    }
    const checkbox = document.querySelector('.endscreen-settings .yp-settings-checkbox');
    expect(checkbox.checked).toBe(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store().get('endscreen')).toBe(false);
    expect(css()).not.toContain('.ytp-ce-element');
  });

  test('the legacy flag moves into the store once and the legacy key is dropped', () => {
    localStorage.setItem('youtube_endscreen_settings', JSON.stringify({ enabled: false }));
    load();
    expect(store().get('endscreen')).toBe(false);
    expect(JSON.parse(localStorage.getItem('youtube_endscreen_settings'))).toEqual({});
    expect(css()).not.toContain('.ytp-ce-element');
  });

  test('a store value wins over a stale legacy flag', () => {
    localStorage.setItem('youtube_plus_settings', JSON.stringify({ endscreen: true }));
    localStorage.setItem('youtube_endscreen_settings', JSON.stringify({ enabled: false }));
    load();
    expect(store().get('endscreen')).toBe(true);
    expect(JSON.parse(localStorage.getItem('youtube_endscreen_settings'))).toEqual({});
  });
});
