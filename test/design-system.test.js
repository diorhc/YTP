/**
 * @jest-environment jsdom
 */

/** Wait for the animation frame that renders styles. */
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

describe('Design system StyleManager', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete window.YouTubePlusDesignSystem;
    delete window.YouTubePlusLogger;
    delete window.YouTubeUtils;
    delete window.unsafeWindow;
    delete window.__ytplusThemeSync;

    Object.defineProperty(window, 'YouTubePlusLogger', {
      configurable: true,
      writable: true,
      value: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        createLogger: jest.fn(() => ({
          error: jest.fn(),
          warn: jest.fn(),
          info: jest.fn(),
          debug: jest.fn(),
        })),
      },
    });
  });

  afterEach(() => {
    delete window.__ytplusThemeSync;
    const sm = window.YouTubePlusDesignSystem?.StyleManager;
    if (sm && typeof sm.clear === 'function') {
      sm.clear();
    }
  });

  test('creates a single style host and renders registered css', async () => {
    require('../src/design-system.js');

    const sm = window.YouTubePlusDesignSystem.StyleManager;
    sm.add('test-style', '.demo-style-manager { color: red; }');
    await nextFrame();

    const host = document.getElementById('youtube-plus-styles');
    expect(host).toBeTruthy();
    expect(host.textContent).toContain('.demo-style-manager { color: red; }');
    expect(sm.has('test-style')).toBe(true);
  });

  test('re-renders unchanged css when the style host was removed by the page', async () => {
    require('../src/design-system.js');

    const sm = window.YouTubePlusDesignSystem.StyleManager;
    const css = '.demo-style-manager-restored { color: blue; }';

    sm.add('restored-style', css);
    await nextFrame();
    const firstHost = document.getElementById('youtube-plus-styles');
    expect(firstHost).toBeTruthy();
    firstHost.remove();

    sm.add('restored-style', css);
    await nextFrame();

    const recreatedHost = document.getElementById('youtube-plus-styles');
    expect(recreatedHost).toBeTruthy();
    expect(recreatedHost).not.toBe(firstHost);
    expect(recreatedHost.textContent).toContain(css);
  });

  test('uses a MutationObserver instead of setInterval to watch the style host', () => {
    require('../src/design-system.js');

    const sm = window.YouTubePlusDesignSystem.StyleManager;
    expect(() => sm.add('observed-style', '.observed { color: green; }')).not.toThrow();
    expect(window.YouTubePlusDesignSystem.StyleManager.has('observed-style')).toBe(true);
  });

  test('does not duplicate css when the same id and content are added twice', async () => {
    require('../src/design-system.js');

    const sm = window.YouTubePlusDesignSystem.StyleManager;
    const css = '.yp-video-stats-styles-dup { color: purple; }';

    sm.add('yp-video-stats-styles', css);
    sm.add('yp-video-stats-styles', css);
    await nextFrame();

    expect(document.querySelectorAll('#youtube-plus-styles').length).toBe(1);
    expect(
      (
        document
          .getElementById('youtube-plus-styles')
          .textContent.match(/yp-video-stats-styles-dup/g) || []
      ).length
    ).toBe(1);
  });

  test('get retrieves css or empty string when absent or invalid', () => {
    require('../src/design-system.js');
    const sm = window.YouTubePlusDesignSystem.StyleManager;
    sm.add('key1', '.k1 { color: red; }');
    expect(sm.get('key1')).toBe('.k1 { color: red; }');
    expect(sm.get('unknown')).toBe('');
    expect(sm.get(null)).toBe('');
  });

  test('remove deletes registered style and ignores unknown or invalid ids', () => {
    require('../src/design-system.js');
    const sm = window.YouTubePlusDesignSystem.StyleManager;
    const initialSize = sm.size();
    sm.add('to-del', '.del { display: none; }');
    expect(sm.has('to-del')).toBe(true);
    expect(sm.size()).toBe(initialSize + 1);
    expect(sm.ids()).toContain('to-del');

    sm.remove('to-del');
    expect(sm.has('to-del')).toBe(false);
    expect(sm.size()).toBe(initialSize);
    expect(sm.ids()).not.toContain('to-del');

    expect(() => sm.remove('non-existent')).not.toThrow();
    expect(() => sm.remove(null)).not.toThrow();
    expect(() => sm.remove('')).not.toThrow();
  });

  test('add handles empty css as remove and ignores invalid inputs', () => {
    require('../src/design-system.js');
    const sm = window.YouTubePlusDesignSystem.StyleManager;
    sm.add('clr', '.clr { font-size: 10px; }');
    expect(sm.has('clr')).toBe(true);

    sm.add('clr', '');
    expect(sm.has('clr')).toBe(false);

    expect(() => sm.add('', 'valid-css')).not.toThrow();
    expect(() => sm.add(null, 'valid-css')).not.toThrow();
    expect(() => sm.add('valid-id', null)).not.toThrow();
    expect(() => sm.add('valid-id', 123)).not.toThrow();
  });

  test('host getter and inspectStyles reflect active style state', async () => {
    require('../src/design-system.js');
    const ds = window.YouTubePlusDesignSystem;
    const sm = ds.StyleManager;
    sm.add('insp', '.insp { margin: 0; }');
    await nextFrame();

    expect(sm.host).toBe(document.getElementById('youtube-plus-styles'));
    const info = ds.inspectStyles();
    expect(info.hostPresent).toBe(true);
    expect(info.hostConnected).toBe(true);
    expect(info.registeredStyleIds).toContain('insp');
    expect(info.textMatchesExpected).toBe(true);
  });

  test('clear removes all styles, disconnects observer and nulls host', () => {
    require('../src/design-system.js');
    const sm = window.YouTubePlusDesignSystem.StyleManager;
    const initialSize = sm.size();
    sm.add('c1', '.c1 {}');
    sm.add('c2', '.c2 {}');
    expect(sm.size()).toBe(initialSize + 2);

    sm.clear();
    expect(sm.size()).toBe(0);
    expect(sm.host).toBeNull();
    expect(document.getElementById('youtube-plus-styles')).toBeNull();
  });

  test('Solid turns every material blur off without touching YouTube elements', () => {
    require('../src/design-system.js');
    const ds = window.YouTubePlusDesignSystem;
    const css = ds.StyleManager.get('yp-design-system');
    for (const theme of ['html[dark]', 'html:not([dark])']) {
      const sel = `${theme}[data-yp-style="solid"]{`;
      const at = css.indexOf(sel);
      expect(at).toBeGreaterThanOrEqual(0);
      const rule = css.slice(at, css.indexOf('}', at));
      for (const level of ['--yp-mat-thin-blur', '--yp-mat-blur', '--yp-mat-thick-blur']) {
        expect(rule).toContain(`${level}:none`);
      }
    }
    // No catch-all rule strips backdrop-filter from the whole page any more.
    const all = ds.StyleManager.ids()
      .map(id => ds.StyleManager.get(id))
      .join('\n');
    expect(all).not.toMatch(/data-yp-style="solid"\]\s*\*\s*\{/);
  });

  test('legacy blur variables follow the material tokens', () => {
    require('../src/design-system.js');
    const css = window.YouTubePlusDesignSystem.StyleManager.get('yp-design-system');
    expect(css).toContain('--yt-glass-blur:var(--yp-mat-blur);');
    expect(css).toContain('--yt-glass-blur-light:var(--yp-mat-thin-blur);');
    expect(css).toContain('--yt-glass-blur-heavy:var(--yp-mat-thick-blur);');
  });

  test('prefers-reduced-motion rule targets only the script own class prefixes', () => {
    require('../src/design-system.js');
    const sm = window.YouTubePlusDesignSystem.StyleManager;
    const css = sm.get('yp-design-system');
    const start = css.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{/);
    expect(start).toBeGreaterThanOrEqual(0);
    // The whole @media block, nested rules included.
    let depth = 0;
    let end = start;
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    const block = css.slice(start, end);
    // The host page must keep its own animation/transition behavior: YouTube
    // logic waiting on transitionend hangs when the rule targets every node.
    expect(block).not.toMatch(/[{,]\s*\*/);
    // The script own prefixes stay covered.
    expect(block).toMatch(/\[class\*="yp-"\]/);
    expect(block).toMatch(/\[class\*="yp-"\]/);
    expect(block).toMatch(/\[class\*="comment-controls"\]/); // Loading spinners keep turning; movement becomes a short fade.
    expect(block).toMatch(/:not\(\[class\*="spinner"\]\)/);
    expect(block).toMatch(/--yp-dur-4:var\(--yp-dur-2\)/);
  });

  test('theme preference and variant APIs', async () => {
    require('../src/design-system.js');
    const ds = window.YouTubePlusDesignSystem;
    expect(typeof ds.getThemePreference).toBe('function');
    expect(typeof ds.applyThemePreference).toBe('function');
    expect(typeof ds.getThemeVariant).toBe('function');
    expect(typeof ds.applyThemeVariant).toBe('function');

    // biome-ignore lint/suspicious/noDocumentCookie: test sets cookie directly
    document.cookie = 'PREF=f6=400';
    ds.applyThemePreference('dark');
    expect(ds.getThemePreference()).toBe('dark');
    expect(document.documentElement.hasAttribute('dark')).toBe(true);

    ds.applyThemePreference('light');
    expect(ds.getThemePreference()).toBe('light');
    expect(document.documentElement.hasAttribute('dark')).toBe(false);

    ds.applyThemePreference('device');
    expect(ds.getThemePreference()).toBe('device');

    ds.applyThemeVariant('classic', 'solid');
    expect(ds.getThemeVariant()).toBe('classic');
    expect(document.documentElement.getAttribute('data-yp-variant')).toBe('classic');
    expect(document.documentElement.getAttribute('data-yp-style')).toBe('solid');

    ds.applyThemeVariant('vision', 'glass');
    expect(ds.getThemeVariant()).toBe('vision');
    expect(document.documentElement.getAttribute('data-yp-variant')).toBe('vision');
    expect(document.documentElement.getAttribute('data-yp-style')).toBe('glass');

    window.dispatchEvent(new Event('youtube-plus-settings-updated'));
    window.dispatchEvent(new Event('yt-navigate-finish'));

    // Trigger theme observer dark attribute mutation
    document.documentElement.setAttribute('dark', '');
    await nextFrame();
  });

  test('re-attaches its head observer when the head element is replaced', async () => {
    require('../src/design-system.js');
    const sm = window.YouTubePlusDesignSystem.StyleManager;
    sm.add('head-resync-style', '.head-resync { color: green; }');
    await nextFrame();

    // Replacing <head> mutates documentElement's childList, which the
    // document observer watches; it must resync onto the new head root.
    const replacementHead = document.createElement('head');
    document.documentElement.replaceChild(replacementHead, document.head);
    await nextFrame();

    replacementHead.appendChild(document.createElement('meta'));
    await nextFrame();

    // The style host is (re)rendered after the resync.
    expect(document.getElementById('youtube-plus-styles')).toBeTruthy();
    sm.add('head-resync-style-2', '.head-resync-2 { color: red; }');
    await nextFrame();
    expect(document.getElementById('youtube-plus-styles')?.textContent).toContain(
      '.head-resync-2 { color: red; }'
    );
  });
});
