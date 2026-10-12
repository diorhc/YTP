/**
 * @jest-environment jsdom
 *
 * The shared menu positioner picks the side with room: a Vision dock anchor at
 * the top of the player opens downward, a classic bottom-bar anchor opens
 * upward, and either side flips when the menu does not fit.
 */

function load() {
  jest.resetModules();
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/feature-registry.js');
  return window.YouTubePlusFeatureRegistry.PopoverController;
}

/** @param {{ top: number, bottom: number, left?: number, width?: number }} anchor */
function makeAnchor(anchor) {
  const el = document.createElement('div');
  const left = anchor.left ?? 100;
  const width = anchor.width ?? 40;
  el.getBoundingClientRect = () => ({
    top: anchor.top,
    bottom: anchor.bottom,
    left,
    right: left + width,
    width,
    height: anchor.bottom - anchor.top,
    x: left,
    y: anchor.top,
  });
  return el;
}

/** @param {number} height */
function makeDropdown(height) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({
    top: 0,
    bottom: height,
    left: 0,
    right: 0,
    width: 100,
    height,
    x: 0,
    y: 0,
  });
  return el;
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: 600,
  });
});

test('a Vision dock anchor at the top opens downward', () => {
  const pc = load();
  const dropdown = makeDropdown(200);
  const openDown = pc.positionDropdown(makeAnchor({ top: 16, bottom: 50 }), dropdown, {
    preferDown: true,
    gap: 10,
  });
  expect(openDown).toBe(true);
  expect(dropdown.style.top).toBe('60px');
  expect(dropdown.style.bottom).toBe('auto');
});

test('a classic bottom-bar anchor opens upward', () => {
  const pc = load();
  const dropdown = makeDropdown(200);
  const openDown = pc.positionDropdown(makeAnchor({ top: 520, bottom: 560 }), dropdown, {
    preferDown: false,
    gap: 10,
  });
  expect(openDown).toBe(false);
  expect(dropdown.style.bottom).toBe('90px');
  expect(dropdown.style.top).toBe('auto');
});

test('a classic anchor with no room above flips downward', () => {
  const pc = load();
  const dropdown = makeDropdown(200);
  const openDown = pc.positionDropdown(makeAnchor({ top: 10, bottom: 40 }), dropdown, {
    preferDown: false,
    gap: 10,
  });
  expect(openDown).toBe(true);
  expect(dropdown.style.top).toBe('50px');
});

test('a Vision dock anchor with no room below flips upward', () => {
  const pc = load();
  const dropdown = makeDropdown(200);
  const openDown = pc.positionDropdown(makeAnchor({ top: 300, bottom: 500 }), dropdown, {
    preferDown: true,
    gap: 10,
  });
  expect(openDown).toBe(false);
  expect(dropdown.style.bottom).toBe('310px');
});

test('a missing anchor or dropdown is a no-op', () => {
  const pc = load();
  expect(pc.positionDropdown(null, makeDropdown(100), {})).toBe(false);
  expect(pc.positionDropdown(makeAnchor({ top: 10, bottom: 30 }), null, {})).toBe(false);
});
