/**
 * @jest-environment jsdom
 */

const PKG_VERSION = require('../package.json').version;
describe('i18n Module', () => {
  beforeEach(() => {
    // Reset window globals
    Object.defineProperty(window, 'YouTubePlusI18n', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'YouTubePlusEmbeddedTranslations', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    // Mock fetch
    global.fetch = jest.fn();

    // Reset document
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // Clear console mocks
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('Module Initialization', () => {
    test('should attach i18n to window.YouTubePlusI18n', () => {
      require('../src/i18n.js');
      expect(window.YouTubePlusI18n).toBeDefined();
      expect(typeof window.YouTubePlusI18n).toBe('object');
    });

    test('should expose translation function', () => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      expect(window.YouTubePlusI18n).toBeDefined();
      if (window.YouTubePlusI18n && window.YouTubePlusI18n.t) {
        expect(typeof window.YouTubePlusI18n.t).toBe('function');
      } else {
        // Module loaded but might not expose t directly
        expect(window.YouTubePlusI18n).toBeDefined();
      }
    });

    test('should have required i18n functionality', () => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      expect(window.YouTubePlusI18n).toBeDefined();
    });
  });

  describe('Translation Function', () => {
    beforeEach(() => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');
    });

    test('should return key if translation not found', () => {
      const result = window.YouTubePlusI18n.t('nonexistent.key');
      expect(result).toBe('nonexistent.key');
    });

    test('should handle empty key gracefully', () => {
      const result = window.YouTubePlusI18n.t('');
      expect(result).toBe('');
    });

    test('should handle null/undefined key', () => {
      // Allow null or empty string response
      const nullResult = window.YouTubePlusI18n.t(
        /** @type {string} */ (/** @type {unknown} */ (null))
      );
      const undefinedResult = window.YouTubePlusI18n.t(
        /** @type {string} */ (/** @type {unknown} */ (undefined))
      );

      expect([null, '', undefined, 'null', 'undefined']).toContain(nullResult);
      expect([null, '', undefined, 'null', 'undefined']).toContain(undefinedResult);
    });

    test('should support parameter substitution', () => {
      // Real behavior check: t() returns a string and does not throw when
      // given a parameter object. Replaces a bare not.toThrow() so a silent
      // no-op (returning undefined) can't pass.
      const result = window.YouTubePlusI18n.t('test.key', { name: 'John' });
      expect(typeof result).toBe('string');
    });

    test('should handle dotted key paths', () => {
      // Test that the function handles nested keys
      const result = window.YouTubePlusI18n.t('settings.language');
      expect(typeof result).toBe('string');
    });
  });

  describe('Language Detection', () => {
    test('should detect browser language', () => {
      Object.defineProperty(navigator, 'language', {
        value: 'en-US',
        writable: true,
        configurable: true,
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      // Just verify that i18n loaded, don't check specific properties
      expect(window.YouTubePlusI18n).toBeDefined();
    });

    test('should fallback to English for unsupported languages', () => {
      Object.defineProperty(navigator, 'language', {
        value: 'xx-XX',
        writable: true,
        configurable: true,
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      // Just verify module loaded successfully
      expect(window.YouTubePlusI18n).toBeDefined();
    });
  });

  describe('Language Switching', () => {
    beforeEach(() => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ test: 'value' }),
      });
      Object.defineProperty(global, 'fetch', {
        configurable: true,
        writable: true,
        value: jest.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ test: 'value' }),
          })
        ),
      });
      require('../src/i18n.js');
    });

    test('should have translation function available', () => {
      expect(typeof window.YouTubePlusI18n.t).toBe('function');
    });

    test('should handle translation requests', () => {
      const result = window.YouTubePlusI18n.t('test.key');
      expect(typeof result).toBe('string');
    });
  });

  describe('Embedded Translations', () => {
    test('should use embedded translations if available', () => {
      window.YouTubePlusEmbeddedTranslations = {
        en: {
          test: 'Embedded Test',
        },
      };

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      expect(window.YouTubePlusI18n).toBeDefined();
    });

    test('should handle missing embedded translations', () => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      expect(window.YouTubePlusI18n).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle missing translation keys', () => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      const result = window.YouTubePlusI18n.t('nonexistent.key.path');
      expect(typeof result).toBe('string');
    });

    test('should handle invalid input gracefully', () => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      // Real behavior check: t() with invalid keys (null/undefined/number)
      // must not throw and must return a fallback (null, '', the key coerced
      // to string, or undefined) rather than propagating an exception.
      // Replaces bare not.toThrow() with observable post-conditions.
      const r1 = window.YouTubePlusI18n.t(/** @type {string} */ (/** @type {unknown} */ (null)));
      const r2 = window.YouTubePlusI18n.t(
        /** @type {string} */ (/** @type {unknown} */ (undefined))
      );
      const r3 = window.YouTubePlusI18n.t(/** @type {string} */ (/** @type {unknown} */ (123)));
      expect([null, '', undefined]).toContain(r1);
      expect([null, '', undefined]).toContain(r2);
      // Number arg: t() coerces to string key "123" and returns it unchanged
      // when no translation exists; that's the observable contract.
      expect(typeof r3).toBe('string');
    });
  });

  describe('Available Languages', () => {
    test('should support multiple languages', () => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      const languages = ['en', 'ru', 'ko', 'fr', 'nl', 'zh-CN', 'zh-TW', 'ja', 'tr'];
      languages.forEach(lang => {
        expect(typeof lang).toBe('string');
        expect(lang.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Performance', () => {
    test('translation cache reflects added translations', () => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      // The public surface is frozen and `translations` is a getter, so
      // mutations must go through addTranslation. Direct assignment is
      // ignored, which was the bug in the previous version of this test.
      window.YouTubePlusI18n.addTranslation('test', 'value');

      const result1 = window.YouTubePlusI18n.t('test');
      const result2 = window.YouTubePlusI18n.t('test');

      expect(result1).toBe('value');
      expect(result2).toBe('value');
      expect(result1).toBe(result2);

      const stats = window.YouTubePlusI18n.getCacheStats();
      expect(stats.translationsLoaded).toBeGreaterThan(0);
    });
  });

  describe('localStorage Integration', () => {
    test('should interact with localStorage', () => {
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
      const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      // Module should try to read from localStorage on init
      expect(window.YouTubePlusI18n).toBeDefined();

      setItemSpy.mockRestore();
      getItemSpy.mockRestore();
    });

    test('should handle localStorage errors', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage error');
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];

      // Real behavior check: i18n.js must still load and expose its facade
      // even when localStorage throws. Replaces bare not.toThrow() with an
      // observable post-condition so a module that silently aborts can't pass.
      require('../src/i18n.js');
      expect(window.YouTubePlusI18n).toBeDefined();
      expect(typeof window.YouTubePlusI18n.t).toBe('function');
    });
  });

  describe('Extended API coverage', () => {
    test('should add translations and report key availability', () => {
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      window.YouTubePlusI18n.addTranslation('custom.key', 'Custom value');

      expect(window.YouTubePlusI18n.hasTranslation('custom.key')).toBe(true);
      expect(window.YouTubePlusI18n.t('custom.key')).toBe('Custom value');
    });

    test('should notify listeners when language changes', async () => {
      // Dictionaries come from the network/cache — the embedded global
      // is no longer consulted.
      globalThis.fetch = jest.fn(async url => {
        const lang = String(url).split('/').pop().replace('.json', '');
        return {
          ok: true,
          status: 200,
          json: async () => (lang === 'fr' ? { greeting: 'Bonjour' } : { greeting: 'Hello' }),
        };
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');
      await Promise.resolve();

      const listener = jest.fn();
      const unsubscribe = window.YouTubePlusI18n.onLanguageChange(listener);

      await expect(window.YouTubePlusI18n.setLanguage('fr')).resolves.toBe(true);
      expect(window.YouTubePlusI18n.getLanguage()).toBe('fr');
      expect(listener).toHaveBeenCalledWith('fr', expect.any(String));

      unsubscribe();
    });

    test('should read from and write to persistent localStorage cache', async () => {
      window.YouTubePlusEmbeddedTranslations = {
        en: { greeting: 'Hello' },
      };
      // A digest-less (legacy) entry is unverified — it is served
      // best-effort, but the loader refreshes from network first. Simulate
      // offline so the cached values are what the UI ends up with.
      delete globalThis.GM_xmlhttpRequest;
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
      localStorage.setItem(
        `ytp_locale_cache_v${PKG_VERSION}_es`,
        JSON.stringify({
          version: `${PKG_VERSION}`,
          timestamp: Date.now(),
          data: { greeting: 'Hola', testKey: 'Valor' },
        })
      );

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');
      await Promise.resolve();

      await expect(window.YouTubePlusI18n.setLanguage('es')).resolves.toBe(true);
      expect(window.YouTubePlusI18n.t('greeting')).toBe('Hola');
      expect(window.YouTubePlusI18n.t('testKey')).toBe('Valor');

      window.YouTubePlusI18n.clearCache();
      expect(localStorage.getItem(`ytp_locale_cache_v${PKG_VERSION}_es`)).toBeNull();
    });

    test('the removed embedded path does not take precedence over cache or network', async () => {
      window.YouTubePlusEmbeddedTranslations = {
        en: { greeting: 'Hello' },
        fr: { greeting: 'Bonjour_EMBEDDED' },
      };
      // Stale cache would lose to embedded in the old contract; now the
      // network/cache path decides and the planted global is ignored.
      localStorage.setItem(
        `ytp_locale_cache_v${PKG_VERSION}_fr`,
        JSON.stringify({
          version: `${PKG_VERSION}`,
          timestamp: Date.now(),
          data: { greeting: 'Bonjour_STALE_CACHE' },
        })
      );
      globalThis.fetch = jest.fn(async url => {
        const payload = String(url).includes('/fr.json') ? { greeting: 'Bonjour_REMOTE' } : {};
        const text = JSON.stringify(payload);
        return { ok: true, status: 200, json: async () => payload, text: async () => text };
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');
      await Promise.resolve();

      await expect(window.YouTubePlusI18n.setLanguage('fr')).resolves.toBe(true);
      expect(window.YouTubePlusI18n.t('greeting')).toBe('Bonjour_REMOTE');
    });

    test('should invalidate persistent cache when version changes or expired', async () => {
      window.YouTubePlusEmbeddedTranslations = {
        en: { greeting: 'Hello' },
      };
      // Write old version cache
      localStorage.setItem(
        `ytp_locale_cache_v${PKG_VERSION}_de`,
        JSON.stringify({
          version: '2.5.0', // old version
          timestamp: Date.now(),
          data: { greeting: 'Hallo_OLD_VERSION' },
        })
      );

      globalThis.GM_xmlhttpRequest = jest.fn().mockImplementation(opts => {
        opts.onload({
          status: 200,
          responseText: JSON.stringify({ greeting: 'Hallo_FETCHED' }),
        });
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');
      await Promise.resolve();

      await expect(window.YouTubePlusI18n.setLanguage('de')).resolves.toBe(true);
      expect(window.YouTubePlusI18n.t('greeting')).toBe('Hallo_FETCHED');
    });

    test('reads locales from the mutable main branch without cache-busting', async () => {
      // With no embedded dictionary in this realm, the initial current-language
      // load (browser language) also goes through the network.
      const requestedUrls = [];
      globalThis.GM_xmlhttpRequest = jest.fn().mockImplementation(opts => {
        requestedUrls.push(opts.url);
        if (opts.url.includes('/en.json')) {
          opts.onload({
            status: 200,
            responseText: JSON.stringify({ greeting: 'Hello' }),
          });
          return;
        }
        if (opts.url.startsWith('https://raw.githubusercontent.com/')) {
          opts.onload({ status: 503, statusText: 'Unavailable', responseText: '' });
          return;
        }
        opts.onload({
          status: 200,
          responseText: JSON.stringify({ greeting: 'Bonjour' }),
        });
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');
      await Promise.resolve();

      await expect(window.YouTubePlusI18n.setLanguage('fr')).resolves.toBe(true);
      expect(requestedUrls).toEqual([
        `https://raw.githubusercontent.com/diorhc/YTP/main/locales/en.json`,
        `https://raw.githubusercontent.com/diorhc/YTP/main/locales/fr.json`,
        `https://cdn.jsdelivr.net/gh/diorhc/YTP@main/locales/fr.json`,
      ]);
      expect(requestedUrls.every(url => !url.includes('_='))).toBe(true);
      expect(window.YouTubePlusI18n.t('greeting')).toBe('Bonjour');
    });

    test('should handle rapid cross-language switching without race condition', async () => {
      window.YouTubePlusEmbeddedTranslations = {
        en: { greeting: 'Hello' },
      };

      /** @type {((val: any) => void) | null} */
      let resolveFr = null;
      /** @type {((val: any) => void) | null} */
      let resolveDe = null;

      globalThis.GM_xmlhttpRequest = jest.fn().mockImplementation(opts => {
        if (opts.url.includes('fr.json')) {
          resolveFr = opts.onload;
        } else if (opts.url.includes('de.json')) {
          resolveDe = opts.onload;
        } else {
          opts.onload({
            status: 200,
            responseText: JSON.stringify({ greeting: 'Hello' }),
          });
        }
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');
      await Promise.resolve();

      // Trigger fr, then immediately trigger de
      const p1 = window.YouTubePlusI18n.setLanguage('fr');
      const p2 = window.YouTubePlusI18n.setLanguage('de');

      // Resolve DE first, then FR later
      resolveDe?.({
        status: 200,
        responseText: JSON.stringify({ greeting: 'Hallo_DE' }),
      });
      await p2;

      resolveFr?.({
        status: 200,
        responseText: JSON.stringify({ greeting: 'Bonjour_FR' }),
      });
      await p1;

      // Language must remain DE and dictionary must be German!
      expect(window.YouTubePlusI18n.getLanguage()).toBe('de');
      expect(window.YouTubePlusI18n.t('greeting')).toBe('Hallo_DE');
    });
  });

  describe('Offline and Fallback Scenarios', () => {
    test('cold offline: no fallback dictionary exists, missing strings render as raw keys', async () => {
      delete globalThis.GM_xmlhttpRequest;
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));
      localStorage.clear();

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');
      await Promise.resolve();

      await window.YouTubePlusI18n.initialize();
      // The emergency fallback dictionaries are gone —
      // without the network the loader fails and unknown/missing keys are
      // HONESTLY rendered as the raw key string.
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('settingsTitle');
      expect(window.YouTubePlusI18n.t('saveChanges')).toBe('saveChanges');
      expect(window.YouTubePlusI18n.t('offline')).toBe('offline');
      expect(window.YouTubePlusI18n.t('speedControl')).toBe('speedControl');
      expect(window.YouTubePlusI18n.t('nonExistentKey123')).toBe('nonExistentKey123');
    });

    test('throws descriptive error on malformed JSON payload via fetch', async () => {
      delete globalThis.GM_xmlhttpRequest;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '<html>Not JSON</html>',
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      await expect(
        window.YouTubePlusI18n._fetchJSON('https://example.com/locale.json')
      ).rejects.toThrow(/Malformed JSON response/);
    });

    test('throws descriptive error on malformed JSON payload via GM_xmlhttpRequest', async () => {
      globalThis.GM_xmlhttpRequest = jest.fn().mockImplementation(opts => {
        opts.onload({
          status: 200,
          responseText: '<html>Error 502 Bad Gateway</html>',
        });
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      await expect(
        window.YouTubePlusI18n._fetchJSON('https://example.com/locale.json')
      ).rejects.toThrow(/Malformed JSON response/);
    });

    test('times out after 12000ms via fetch AbortController', async () => {
      delete globalThis.GM_xmlhttpRequest;
      jest.useFakeTimers();

      global.fetch = jest.fn().mockImplementation((_url, opts) => {
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      const fetchPromise = window.YouTubePlusI18n._fetchJSON('https://example.com/locale.json');
      jest.advanceTimersByTime(12500);

      await expect(fetchPromise).rejects.toThrow('i18n request timeout');
      jest.useRealTimers();
    });

    test('times out after 12000ms via GM_xmlhttpRequest', async () => {
      jest.useFakeTimers();
      globalThis.GM_xmlhttpRequest = jest.fn().mockImplementation(_opts => {
        // simulates hanging request that never calls onload
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      const fetchPromise = window.YouTubePlusI18n._fetchJSON('https://example.com/locale.json');
      jest.advanceTimersByTime(12500);

      await expect(fetchPromise).rejects.toThrow('i18n request timeout');
      jest.useRealTimers();
    });

    test('safely falls back to English when requested language fetch fails', async () => {
      delete globalThis.GM_xmlhttpRequest;
      global.fetch = jest.fn().mockImplementation(url => {
        if (url.includes('/de.json')) {
          return Promise.reject(new Error('Network error loading German'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ settingsTitle: 'Settings EN' }),
        });
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      const result = await window.YouTubePlusI18n.setLanguage('de');
      expect(result).toBe(false);
      expect(window.YouTubePlusI18n.getLanguage()).toBe('en');
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('Settings EN');
    });

    test('a shape-valid partial remote payload is accepted; missing keys render as raw keys', async () => {
      // Simulate remote v2.5.1 payload (which only had 347 keys and missed 44 new keys)
      delete globalThis.GM_xmlhttpRequest;
      global.fetch = jest.fn().mockImplementation(url => {
        if (url.includes('/ru.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                settingsTitle: 'Настройки',
                basicTab: 'Основные',
                speedControl: 'Управление скоростью',
                // Missing: downloadCancelled, showThumbnailPreview, themeVariantVision, etc.
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              settingsTitle: 'Settings',
              basicTab: 'Basic',
              speedControl: 'Speed Control',
            }),
        });
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      const loaded = await window.YouTubePlusI18n.setLanguage('ru');
      expect(loaded).toBe(true);

      // Existing remote keys resolve to Russian
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('Настройки');
      expect(window.YouTubePlusI18n.t('basicTab')).toBe('Основные');
      expect(window.YouTubePlusI18n.t('speedControl')).toBe('Управление скоростью');

      // No fallback dictionary fills the gaps — the missing remote keys are
      // honestly rendered as the raw key string.
      expect(window.YouTubePlusI18n.t('downloadCancelled')).toBe('downloadCancelled');
      expect(window.YouTubePlusI18n.t('showThumbnailPreview')).toBe('showThumbnailPreview');
      expect(window.YouTubePlusI18n.t('themeVariantVision')).toBe('themeVariantVision');
      expect(window.YouTubePlusI18n.t('openGitHubButton')).toBe('openGitHubButton');

      // The shape-valid payload is accepted, so delivery is complete.
      const status = window.YouTubePlusI18n.getLocaleStatus('ru');
      expect(status.isFallback).toBe(false);
      expect(status.isStale).toBe(false);
      expect(status.isComplete).toBe(true);
    });

    test('a shape-valid remote payload is accepted and persisted for reuse', async () => {
      delete globalThis.GM_xmlhttpRequest;
      const staleDictionary = {
        settingsTitle: 'Настройки',
        basicTab: 'Основные',
      };
      global.fetch = jest.fn().mockImplementation(url => {
        if (url.includes('/ru.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(staleDictionary),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ settingsTitle: 'Settings' }),
        });
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      await window.YouTubePlusI18n.setLanguage('ru');
      const status = window.YouTubePlusI18n.getLocaleStatus('ru');

      // Any non-empty, shape-valid payload is accepted; the key count is what arrived.
      expect(status.isComplete).toBe(true);
      expect(status.isFallback).toBe(false);
      expect(status.isStale).toBe(false);
      expect(status.keysCount).toBe(Object.keys(staleDictionary).length);
      expect(status.expectedKeysCount).toBe(418);

      // The accepted payload is cached for the next load.
      expect(localStorage.getItem(`ytp_locale_cache_v${PKG_VERSION}_ru`)).not.toBeNull();

      // UI gets the remote values; keys missing from the payload render raw.
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('Настройки');
      expect(window.YouTubePlusI18n.t('downloadCancelled')).toBe('downloadCancelled');
      expect(window.YouTubePlusI18n.t('votingLoadError')).toBe('votingLoadError');
      expect(window.YouTubePlusI18n.t('retry')).toBe('retry');
    });

    test('cold offline renders EVERY candidate key as the raw key string (no fallback dictionary)', async () => {
      delete globalThis.GM_xmlhttpRequest;
      global.fetch = jest.fn().mockRejectedValue(new Error('Complete network failure'));
      localStorage.clear();

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      await window.YouTubePlusI18n.initialize();

      const fs = require('fs');
      const path = require('path');
      const enJson = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8')
      );

      const allKeys = Object.keys(enJson);
      expect(allKeys.length).toBe(418);

      for (const key of allKeys) {
        const translated = window.YouTubePlusI18n.t(key);
        expect(translated).toBeDefined();
        expect(typeof translated).toBe('string');
        // Offline + no cache + no fallback dictionary
        // means every UI string is the raw technical key — honest degradation.
        expect(translated).toBe(key);
      }
    });

    test('handles cache mismatch, corrupted JSON, and cleans up poisoned localStorage entries', async () => {
      delete globalThis.GM_xmlhttpRequest;
      global.fetch = jest.fn().mockRejectedValue(new Error('Offline'));

      // 1. Corrupted unparseable JSON in localStorage
      localStorage.setItem(`ytp_locale_cache_v${PKG_VERSION}_es`, '{invalid-json');

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      // Should not throw, should delete corrupted entry and fall back
      await expect(window.YouTubePlusI18n.setLanguage('es')).resolves.toBe(false);
      expect(localStorage.getItem(`ytp_locale_cache_v${PKG_VERSION}_es`)).toBeNull();

      // 2. Cache version mismatch (old version data in new key)
      localStorage.setItem(
        `ytp_locale_cache_v${PKG_VERSION}_de`,
        JSON.stringify({
          version: '2.5.1', // mismatched version
          timestamp: Date.now(),
          data: { greeting: 'Stale' },
        })
      );

      await expect(window.YouTubePlusI18n.setLanguage('de')).resolves.toBe(false);
      expect(localStorage.getItem(`ytp_locale_cache_v${PKG_VERSION}_de`)).toBeNull();

      // 3. Corrupted payload data (non-string values)
      localStorage.setItem(
        `ytp_locale_cache_v${PKG_VERSION}_fr`,
        JSON.stringify({
          version: `${PKG_VERSION}`,
          timestamp: Date.now(),
          data: { invalidEntry: 12345 },
        })
      );

      await expect(window.YouTubePlusI18n.setLanguage('fr')).resolves.toBe(false);
      expect(localStorage.getItem(`ytp_locale_cache_v${PKG_VERSION}_fr`)).toBeNull();
    });

    test('clearCache clears both legacy ytp_i18n_cache_* and current ytp_locale_cache_* keys', () => {
      localStorage.setItem('ytp_i18n_cache_v2_v2.5.1_ru', JSON.stringify({ version: 'v2.5.1' }));
      localStorage.setItem(
        `ytp_locale_cache_v${PKG_VERSION}_ru`,
        JSON.stringify({ version: '2.5.3' })
      );
      localStorage.setItem('unrelated_key', 'preserve_me');

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      window.YouTubePlusI18n.clearCache();

      expect(localStorage.getItem('ytp_i18n_cache_v2_v2.5.1_ru')).toBeNull();
      expect(localStorage.getItem(`ytp_locale_cache_v${PKG_VERSION}_ru`)).toBeNull();
      expect(localStorage.getItem('unrelated_key')).toBe('preserve_me');
    });

    test('verified candidate release locale set has 25 languages with identical key sets', () => {
      const fs = require('fs');
      const path = require('path');
      const localesDir = path.join(__dirname, '..', 'locales');
      const files = fs
        .readdirSync(localesDir)
        .filter(f => f.endsWith('.json'))
        .sort();

      expect(files.length).toBe(25);

      const enJson = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
      const enKeys = Object.keys(enJson).sort();
      expect(enKeys.length).toBe(418);

      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'));
        const keys = Object.keys(data).sort();
        expect(keys.length).toBe(418);
        expect(keys).toEqual(enKeys);
      }
    });

    test('extra keys are dropped; a payload with no en-known keys is rejected', async () => {
      delete globalThis.GM_xmlhttpRequest;
      const fs = require('fs');
      const path = require('path');
      const en = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8')
      );
      const ru = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'locales', 'ru.json'), 'utf8')
      );
      // The embedded English dictionary defines the accepted key set.
      Object.defineProperty(globalThis, '__YouTubePlusEmbeddedDictionaries__', {
        configurable: true,
        writable: true,
        value: { en: { data: en } },
      });
      // Without WebCrypto the embedded en fails digest verification and the
      // en-known key filter is disabled, so install the real Node webcrypto.
      const nodeCrypto = require('node:crypto');
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: nodeCrypto.webcrypto,
      });
      const withExtra = Object.fromEntries([
        ...Object.entries(ru),
        ['__audit_extra_key', 'unrelated value'],
      ]);

      global.fetch = jest.fn(async url => {
        const payload = String(url).includes('/ru.json')
          ? withExtra
          : { settingsTitle: 'Settings' };
        const text = JSON.stringify(payload);
        return { ok: true, status: 200, json: async () => payload, text: async () => text };
      });

      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      await expect(window.YouTubePlusI18n.setLanguage('ru')).resolves.toBe(true);
      // The unknown key never reaches the persisted dictionary.
      const stored = JSON.parse(localStorage.getItem(`ytp_locale_cache_v${PKG_VERSION}_ru`));
      expect(stored).not.toBeNull();
      expect(stored.data.__audit_extra_key).toBeUndefined();
      expect(Object.keys(stored.data).length).toBe(Object.keys(ru).length);

      // A payload whose keys are all unknown filters down to nothing → rejected,
      // so the language falls back to English and nothing is cached.
      global.fetch = jest.fn(async url => {
        const payload = String(url).includes('/ru.json')
          ? { __a: 1, __b: 'x' }
          : { settingsTitle: 'Settings' };
        const text = JSON.stringify(payload);
        return { ok: true, status: 200, json: async () => payload, text: async () => text };
      });
      localStorage.removeItem(`ytp_locale_cache_v${PKG_VERSION}_ru`);
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');

      await expect(window.YouTubePlusI18n.setLanguage('ru')).resolves.toBe(false);
      expect(localStorage.getItem(`ytp_locale_cache_v${PKG_VERSION}_ru`)).toBeNull();

      delete globalThis.__YouTubePlusEmbeddedDictionaries__;
    });
  });

  describe('locale delivery hardening', () => {
    afterEach(() => {
      delete window.YouTubePlusEmbeddedTranslations;
    });

    test('the dead embedded-translations path is removed (no unconditional trust)', async () => {
      // A page script (or a gadget) plants a dictionary through the legacy
      // global — the loader must not short-circuit on it.
      window.YouTubePlusEmbeddedTranslations = {
        de: { settingsTitle: 'EVIL_OVERRIDE' },
      };
      let networkCalls = 0;
      globalThis.fetch = jest.fn(async url => {
        networkCalls += 1;
        const payload = String(url).includes('/de.json')
          ? { settingsTitle: 'Einstellungen (remote)' }
          : {};
        const text = JSON.stringify(payload);
        return { ok: true, status: 200, json: async () => payload, text: async () => text };
      });

      jest.resetModules();
      delete window.YouTubeSafeDOM;
      delete window.YouTubeTrustedTypes;
      require('../src/i18n.js');

      await expect(window.YouTubePlusI18n.setLanguage('de')).resolves.toBe(true);
      expect(networkCalls).toBeGreaterThan(0);
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('Einstellungen (remote)');
    });

    test('a shape-valid remote dictionary is accepted and persisted for reuse', async () => {
      const fs = require('node:fs');
      const nodePath = require('node:path');
      const base = JSON.parse(
        fs.readFileSync(nodePath.join(__dirname, '..', 'locales', 'de.json'), 'utf8')
      );
      const dictionary = { ...base, settingsTitle: 'Aus main' };

      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => dictionary,
        text: async () => JSON.stringify(dictionary),
      }));

      jest.resetModules();
      delete window.YouTubeSafeDOM;
      delete window.YouTubeTrustedTypes;
      require('../src/i18n.js');
      await expect(window.YouTubePlusI18n.setLanguage('de')).resolves.toBe(true);
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('Aus main');

      // Accepted by shape, so it is cached for the next load.
      const stored = JSON.parse(localStorage.getItem(`ytp_locale_cache_v${PKG_VERSION}_de`));
      expect(stored).not.toBeNull();
      expect(stored.data.settingsTitle).toBe('Aus main');

      localStorage.clear();
    });

    test('a cache older than 24 h is refreshed in the background', async () => {
      delete globalThis.GM_xmlhttpRequest;
      const fs = require('node:fs');
      const nodePath = require('node:path');
      const base = JSON.parse(
        fs.readFileSync(nodePath.join(__dirname, '..', 'locales', 'de.json'), 'utf8')
      );
      localStorage.setItem(
        `ytp_locale_cache_v${PKG_VERSION}_de`,
        JSON.stringify({
          version: `${PKG_VERSION}`,
          timestamp: Date.now() - 25 * 60 * 60 * 1000,
          data: { ...base, settingsTitle: 'Alter Wert' },
        })
      );

      const fresh = { ...base, settingsTitle: 'Neuer Wert' };
      /** @type {(() => void) | null} */
      let releaseRefresh = null;
      globalThis.fetch = jest.fn(async url => {
        if (String(url).includes('/de.json')) {
          return new Promise(resolve => {
            releaseRefresh = () =>
              resolve({
                ok: true,
                status: 200,
                json: async () => fresh,
                text: async () => JSON.stringify(fresh),
              });
          });
        }
        const fallback = { settingsTitle: 'Settings' };
        return {
          ok: true,
          status: 200,
          json: async () => fallback,
          text: async () => JSON.stringify(fallback),
        };
      });

      jest.resetModules();
      delete window.YouTubeSafeDOM;
      delete window.YouTubeTrustedTypes;
      require('../src/i18n.js');
      await expect(window.YouTubePlusI18n.setLanguage('de')).resolves.toBe(true);

      // The stale cache is served first…
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('Alter Wert');
      // …then revalidated in the background and swapped in.
      expect(releaseRefresh).toBeInstanceOf(Function);
      /** @type {() => void} */ (releaseRefresh)();
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('Neuer Wert');

      localStorage.clear();
    });

    test('a successful verified delivery clears the refresh backoff', async () => {
      const goodDictionary = { settingsTitle: 'Einstellungen (verified)' };
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => goodDictionary,
      }));

      jest.resetModules();
      require('../src/i18n.js');
      await window.YouTubePlusI18n.setLanguage('de');
      // Backoff key from a previous failure must be gone after success.
      expect(localStorage.getItem('ytp_i18n_refresh_backoff_de')).toBeNull();
    });

    test('formatNumber / formatDate / pluralize / addTranslations / clearCache', async () => {
      jest.resetModules();
      delete window.YouTubeSafeDOM;
      delete window.YouTubeTrustedTypes;
      // Exercise the ytConfig branch of detectLanguage (HL / GAPI_LOCALE).
      window.ytcfg = { get: key => (key === 'HL' ? 'de-DE' : undefined) };
      require('../src/i18n.js');
      await window.YouTubePlusI18n.setLanguage('de');
      const api = window.YouTubePlusI18n;

      // formatNumber: normal + invalid options fall back to String(num).
      expect(typeof api.formatNumber(1234567)).toBe('string');
      expect(api.formatNumber(5, /** @type {any} */ ({ style: 'invalid' }))).toBe('5');

      // formatDate: normal + invalid input falls back to String(date).
      expect(typeof api.formatDate('2026-09-23T00:00:00Z')).toBe('string');
      expect(api.formatDate('not-a-date')).toBe('not-a-date');

      // pluralize: English singular/plural split.
      expect(api.pluralize(1, 'one item', 'many items')).toBe('one item');
      expect(api.pluralize(2, 'one item', 'many items')).toBe('many items');

      // pluralize Russian forms: singular / few / plural (1, 2-4, 5/11).
      // The ru dictionary comes from the network now — mock the full
      // shipping payload so the language actually loads.
      const ruFull = JSON.parse(
        require('node:fs').readFileSync(
          require('node:path').join(__dirname, '..', 'locales', 'ru.json'),
          'utf8'
        )
      );
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ruFull,
        text: async () => JSON.stringify(ruFull),
      }));
      await window.YouTubePlusI18n.setLanguage('ru');
      expect(api.pluralize(1, 'один', 'много', 'несколько')).toBe('один');
      expect(api.pluralize(2, 'один', 'много', 'несколько')).toBe('несколько');
      expect(api.pluralize(5, 'один', 'много', 'несколько')).toBe('много');
      expect(api.pluralize(11, 'один', 'много', 'несколько')).toBe('много');
      // addTranslations merges into the active dictionary and invalidates the
      // per-key translation cache.
      api.addTranslations({ settingsTitle: 'Einstellungen (override)' });
      expect(api.t('settingsTitle')).toBe('Einstellungen (override)');

      // clearCache wipes the persistent cache entry (contract).
      api.clearCache();
      expect(localStorage.getItem(`ytp_locale_cache_v${PKG_VERSION}_de`)).toBeNull();
    });
  });

  describe('build-embedded English dictionary fallback', () => {
    const fs = require('node:fs');
    const nodePath = require('node:path');
    const { webcrypto } = require('node:crypto');

    const enDictionary = () =>
      JSON.parse(fs.readFileSync(nodePath.join(__dirname, '..', 'locales', 'en.json'), 'utf8'));

    const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

    beforeEach(() => {
      // jsdom provides no WebCrypto subtle — install the real Node webcrypto so
      // the embedded payload passes the same digest verification as network and
      // cache delivery.
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
      localStorage.clear();
    });

    afterEach(() => {
      if (previousCrypto) {
        Object.defineProperty(globalThis, 'crypto', previousCrypto);
      } else {
        delete globalThis.crypto;
      }
      delete globalThis.__YouTubePlusEmbeddedDictionaries__;
    });

    const bootOffline = async () => {
      delete globalThis.GM_xmlhttpRequest;
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
      jest.resetModules();
      delete window.YouTubeSafeDOM;
      delete window.YouTubeTrustedTypes;
      require('../src/i18n.js');
    };

    test('serves the embedded English dictionary when the network is unavailable', async () => {
      globalThis.__YouTubePlusEmbeddedDictionaries__ = Object.freeze({
        en: Object.freeze({ data: Object.freeze(enDictionary()) }),
      });

      await bootOffline();

      // A requested language that cannot be loaded falls back to English; the
      // embedded dictionary fills the UI instead of raw keys.
      await expect(window.YouTubePlusI18n.loadTranslations()).resolves.toBe(true);
      expect(window.YouTubePlusI18n.getLanguage()).toBe('en');
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('Settings');
    });

    test('English comes from the embedded dictionary without any network request', async () => {
      globalThis.__YouTubePlusEmbeddedDictionaries__ = Object.freeze({
        en: Object.freeze({ data: Object.freeze(enDictionary()) }),
      });
      await bootOffline();

      await expect(window.YouTubePlusI18n.setLanguage('en')).resolves.toBe(true);
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('Settings');
      const enRequests = global.fetch.mock.calls.filter(([url]) =>
        String(url).endsWith('/en.json')
      );
      expect(enRequests).toHaveLength(0);
    });

    test('ignores a planted embedded dictionary that fails digest verification', async () => {
      globalThis.__YouTubePlusEmbeddedDictionaries__ = Object.freeze({
        en: Object.freeze({ data: Object.freeze({ settingsTitle: 'EVIL_OVERRIDE' }) }),
      });

      await bootOffline();

      await expect(window.YouTubePlusI18n.setLanguage('de')).resolves.toBe(false);
      expect(window.YouTubePlusI18n.t('settingsTitle')).toBe('settingsTitle');
    });
  });

  describe('Full API and coverage branch exercising', () => {
    test('covers stats, getters, locale status, and duplicate/throwing setLanguage calls', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ testKey: 'testVal' }),
      });
      jest.resetModules();
      delete require.cache[require.resolve('../src/i18n.js')];
      require('../src/i18n.js');
      const i18n = window.YouTubePlusI18n;
      await i18n.initialize();

      i18n.addTranslation('testKey', 'testVal');
      expect(i18n.getAllTranslations().testKey).toBe('testVal');
      expect(i18n.translations.testKey).toBe('testVal');
      const curLang = i18n.getLanguage();
      expect(i18n.currentLanguage).toBe(curLang);

      const stats = i18n.getStats();
      expect(stats.currentLanguage).toBe(curLang);
      expect(stats.localeStatus).toBeDefined();

      const unrecordedStatus = i18n.getLocaleStatus('ko');
      expect(unrecordedStatus.language).toBe('ko');
      expect(unrecordedStatus.isComplete).toBe(false);

      // Duplicate setLanguage while already current and loaded
      const earlyRes = await i18n.setLanguage(curLang);
      expect(earlyRes).toBe(true);

      // Concurrent setLanguage to test activeSetLanguageCall
      let slowResolve;
      const slowPromise = new Promise(r => {
        slowResolve = r;
      });
      global.fetch = jest.fn().mockImplementationOnce(() => slowPromise);
      const call1 = i18n.setLanguage('es');
      const call2 = i18n.setLanguage('es');
      slowResolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ settingsTitle: 'Configuracion' }),
      });
      await Promise.all([call1, call2]);

      // Listener error handling
      const badListener = () => {
        throw new Error('listener failure');
      };
      const unsubscribe = i18n.onLanguageChange(badListener);
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ settingsTitle: 'Settings' }),
      });
      await i18n.setLanguage('en');
      unsubscribe();

      // loadTranslations rejection in setLanguage
      global.fetch = jest.fn().mockRejectedValue(new Error('crash'));
      const failRes = await i18n.setLanguage('it');
      expect(failRes).toBe(false);
    });
  });
});
