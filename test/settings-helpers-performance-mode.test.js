/**
 * @jest-environment jsdom
 *
 * The Basic section renders the performance-mode switch with its submenu (one
 * toggle per route-scoped part) and the Animations switch; Advanced has neither.
 */

describe('basic section — performance mode and animations', () => {
  const t = (/** @type {string} */ key) => key;

  const render = (/** @type {Record<string, unknown>} */ settings) => {
    require('../src/settings-helpers.js');
    return window.YouTubePlusSettingsHelpers.createBasicSettingsSection(settings, t);
  };

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusSettingsHelpers;
    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: { escapeHTML: (/** @type {string} */ s) => s, logSuppressed: () => undefined },
    });
  });

  test('renders the master switch and the four part toggles', () => {
    const html = render({
      performanceMode: true,
      performanceModeAmbient: true,
      performanceModeHoverPreview: true,
      performanceModeContentVisibility: true,
      performanceModeLazyChat: true,
    });

    expect(html).toContain('data-setting="performanceMode"');
    expect(html).toContain('data-submenu="performance-mode"');
    for (const key of [
      'performanceModeAmbient',
      'performanceModeHoverPreview',
      'performanceModeContentVisibility',
      'performanceModeLazyChat',
    ]) {
      expect(html).toContain(`data-setting="${key}"`);
    }
    expect(html).toContain('performanceModeLabel');
    expect(html).toContain('performanceModeToggleSubmenu');
  });

  test('checks the master and every part when all are on', () => {
    const html = render({
      performanceMode: true,
      performanceModeAmbient: true,
      performanceModeHoverPreview: true,
      performanceModeContentVisibility: true,
      performanceModeLazyChat: true,
    });
    expect(html).toMatch(/data-setting="performanceMode"\s+checked/);
    expect(html).toMatch(/class="performance-mode-submenu"[^>]*style="display:block;"/);
    expect(html).toMatch(/data-setting="performanceModeAmbient"[^>]*\schecked/);
    expect(html).toMatch(/data-setting="performanceModeLazyChat"[^>]*\schecked/);
  });

  test('leaves the master and every part unchecked when all are off', () => {
    const html = render({
      performanceMode: false,
      performanceModeAmbient: false,
      performanceModeHoverPreview: false,
      performanceModeContentVisibility: false,
      performanceModeLazyChat: false,
    });
    expect(html).not.toMatch(/data-setting="performanceMode"\s+checked/);
    expect(html).not.toMatch(/data-setting="performanceModeHoverPreview"[^>]*\schecked/);
    expect(html).not.toMatch(/data-setting="performanceModeContentVisibility"[^>]*\schecked/);
  });

  test('defaults an omitted part toggle to checked', () => {
    const html = render({ performanceMode: true });
    expect(html).toMatch(/data-setting="performanceModeAmbient"[^>]*\schecked/);
    expect(html).toMatch(/data-setting="performanceModeContentVisibility"[^>]*\schecked/);
  });

  test('hides the submenu and its toggle while the master switch is off', () => {
    const html = render({ performanceMode: false });
    expect(html).toMatch(/class="performance-mode-submenu"[^>]*style="display:none;"/);
    expect(html).toMatch(/data-submenu="performance-mode"[^>]*aria-expanded="false"[^>]*disabled/s);
  });

  test('renders the Animations switch, off unless enabled', () => {
    expect(render({})).toMatch(/data-setting="enableAnimations"\s*>/);
    expect(render({ enableAnimations: true })).toMatch(/data-setting="enableAnimations"\s+checked/);
  });

  test('the Advanced section no longer carries performance mode', () => {
    require('../src/settings-helpers.js');
    const html = window.YouTubePlusSettingsHelpers.createAdvancedSettingsSection({}, t);
    expect(html).not.toContain('data-setting="performanceMode"');
  });
});
