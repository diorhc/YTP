/**
 * Tests for src/settings-helpers.js template HTML generation.
 *
 * The exported modal HTML helpers must escape all user-controlled
 * values so a malicious translation key, a custom downloader name,
 * or a user-editable URL cannot inject markup into the settings
 * modal.
 */

describe('YouTubePlusSettingsHelpers template HTML', () => {
  /** @type {any} */
  let H;

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusSettingsHelpers;
    delete window.YouTubePlusSettingsStore;
    // Bundle order guarantee: utils.js (and its YouTubeUtils.escapeHTML
    // fallback) always loads before settings-helpers.js.
    require('../src/utils.js');
    require('../src/settings-helpers.js');
    H = window.YouTubePlusSettingsHelpers;
  });

  test('createSettingsItem escapes <img onerror=...> in label', () => {
    const dirty = '<img onerror=alert(1)>';
    const html = H.createSettingsItem(dirty, 'safe description', 'enableFoo', true);

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&gt;');

    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  test('createSettingsItem escapes description and setting attribute', () => {
    const html = H.createSettingsItem('Label', '"><script>alert(1)</script>', 'foo"bar', false);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('"foo"bar"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('foo&quot;bar');
  });

  test('createSettingsSelect escapes option label and value', () => {
    const html = H.createSettingsSelect('Label', 'Description', 'setting', 'b', [
      { value: 'a', label: 'A' },
      { value: 'b"', label: '<img onerror=alert(1)>' },
    ]);

    expect(html).not.toContain('<img onerror=alert(1)>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('b&quot;');
  });

  test('createDownloadSiteOption escapes user-editable site name', () => {
    const html = H.createDownloadSiteOption(
      {
        key: 'externalDownloader"><script>',
        name: '<img onerror=alert(1)>',
        description: '"><svg onload=alert(1)>',
        checked: true,
        hasControls: false,
      },
      () => ''
    );

    expect(html).not.toContain('<img onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<svg onload=alert(1)>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
  });

  test('escaping is idempotent for safe inputs', () => {
    const html = H.createSettingsItem('Plain label', 'Plain desc', 'plainKey', true);
    expect(html).toContain('Plain label');
    expect(html).toContain('Plain desc');
    expect(html).toContain('data-setting="plainKey"');
  });

  describe('dictionary-driven aria labels', () => {
    const translatingT = (/** @type {string} */ key) => {
      const ru = {
        themeVariantMaterial: 'Материал',
        timecodeSubmenuToggle: 'Переключить подменю таймкодов',
      };
      return ru[key] || key;
    };

    test('theme cards Material aria-label comes from the dictionary', () => {
      const html = H.createExperimentalSettingsSection({}, translatingT);
      expect(html).toContain('aria-label="Материал"');
      expect(html).not.toContain('aria-label="Material"');
    });

    test('advanced section timecode toggle uses the dictionary', () => {
      const advancedHtml = H.createAdvancedSettingsSection({}, translatingT);
      expect(advancedHtml).not.toContain('aria-label="Toggle timecode submenu"');
      expect(advancedHtml).toContain('aria-label="Переключить подменю таймкодов"');
    });
  });

  describe('buildScreenshotSettingsHTML', () => {
    test('renders toggle button, checkbox and collapsible submenu with shortcut editor', () => {
      const html = H.buildScreenshotSettingsHTML(
        { enableScreenshot: true },
        (/** @type {string} */ k) => k
      );
      expect(html).toContain('data-submenu="screenshot"');
      expect(html).toContain('id="yp-setting-enableScreenshot"');
      expect(html).toContain('class="yp-settings-checkbox"');
      expect(html).toContain('checked');
      expect(html).toContain('screenshot-submenu');
      expect(html).toContain('screenshot-modifier-dropdown');
      expect(html).toContain('screenshot-key');
      expect(html).toContain('value="S"');
    });

    test('hides toggle and unchecks checkbox when enableScreenshot is false', () => {
      const html = H.buildScreenshotSettingsHTML(
        { enableScreenshot: false },
        (/** @type {string} */ k) => k
      );
      expect(html).toContain('screenshot-submenu-toggle-hidden');
      expect(html).toContain('disabled');
      expect(html).toContain('style="display:none;"');
      expect(html).not.toMatch(/id="yp-setting-enableScreenshot"[^>]*checked/);
    });

    test('createBasicSettingsSection includes the screenshot submenu item', () => {
      const html = H.createBasicSettingsSection(
        { enableScreenshot: true },
        (/** @type {string} */ k) => k
      );
      expect(html).toContain('data-submenu="screenshot"');
      expect(html).toContain('screenshot-submenu');
      expect(html).toContain('id="yp-setting-enableScreenshot"');
    });
  });
});
