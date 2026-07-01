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
    const html = H.createSettingsItem(
      'Label',
      '"><script>alert(1)</script>',
      'foo"bar',
      false
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('"foo"bar"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('foo&quot;bar');
  });

  test('createSettingsSelect escapes option label and value', () => {
    const html = H.createSettingsSelect(
      'Label',
      'Description',
      'setting',
      'b',
      [
        { value: 'a', label: 'A' },
        { value: 'b"', label: '<img onerror=alert(1)>' },
      ]
    );

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
});
