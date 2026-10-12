/**
 * The Animations feature on the real chain: CleanupManager, SettingsStore,
 * FeatureRegistry and src/animations.js.
 * @jest-environment jsdom
 */

function goTo(url) {
  const u = new URL(url);
  global.mockLocation({
    hostname: u.hostname,
    pathname: u.pathname,
    search: u.search,
    href: u.href,
  });
}

function navigate(url) {
  goTo(url);
  window.dispatchEvent(new CustomEvent('yp-history-navigate', { detail: { type: 'navigate' } }));
}

function load() {
  window.__YTP_TEST_HOOKS__ = true;
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/design-system.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/animations.js');
}

const store = () => window.YouTubePlusSettingsStore;
const hooks = () => window.YouTubePlusAnimations.testHooks;
const has = () => window.YouTubePlusDesignSystem.StyleManager.has('yp-animations');

describe('animations feature', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    goTo('https://www.youtube.com/');
    load();
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    delete window.__YTP_TEST_HOOKS__;
  });

  test('is off by default and adds no CSS', () => {
    expect(store().get('enableAnimations')).toBe(false);
    expect(has()).toBe(false);
  });

  test('turning it on adds its style; turning it off removes it', () => {
    store().set('enableAnimations', true);
    expect(has()).toBe(true);
    store().set('enableAnimations', false);
    expect(has()).toBe(false);
  });

  test('performance mode stops it and releasing performance mode restarts it', () => {
    store().set('enableAnimations', true);
    store().set('performanceMode', true);
    expect(has()).toBe(false);
    store().set('performanceMode', false);
    expect(has()).toBe(true);
  });

  test('runs on YouTube pages and never on Music or Studio', () => {
    expect(hooks().ROUTES).not.toContain('music');
    expect(hooks().ROUTES).not.toContain('studio');
    store().set('enableAnimations', true);
    navigate('https://www.youtube.com/watch?v=abc');
    expect(has()).toBe(true);
  });

  test('ten on/off cycles leave nothing behind', () => {
    for (let i = 0; i < 10; i++) {
      store().set('enableAnimations', true);
      store().set('enableAnimations', false);
    }
    expect(has()).toBe(false);
  });

  test('its CSS animates only transform and opacity, inside a no-preference query', () => {
    const css = hooks().CSS;
    expect(css.startsWith('@media (prefers-reduced-motion:no-preference)')).toBe(true);
    const props = [...css.matchAll(/transition:([^;}]+)/g)].flatMap(m =>
      m[1].split(',').map(part => part.trim().split(/\s+/)[0])
    );
    expect(new Set(props)).toEqual(new Set(['opacity', 'transform', 'display']));
    expect(css).not.toMatch(/will-change|transition:\s*all|infinite/);
  });
});
