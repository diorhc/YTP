/**
 * @jest-environment jsdom
 */

/**
 * Locale delivery contract against the mutable `main` branch.
 *
 * There is no digest to pin, so a payload is accepted by SHAPE only: an object
 * whose keys exist in the embedded English dictionary and whose values are short
 * plain strings. Unknown keys are dropped, a set that filters down to nothing is
 * rejected, and missing keys fall back to embedded English. Cached dictionaries
 * are served immediately and revalidated in the background on a 24 h cadence.
 */

const PKG_VERSION = require('../package.json').version;
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');
const CACHE_KEY = `ytp_locale_cache_v${PKG_VERSION}_ru`;
const DAY_MS = 24 * 60 * 60 * 1000;

function readLocaleJson(lang) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), 'utf8'));
}

/** Canonical form hashed by scripts/sync-locale-metadata.js. */
function canonicalize(data) {
  return JSON.stringify(data, Object.keys(data).sort());
}

function sha256(text) {
  // eslint-disable-next-line local/no-require-imports
  const { createHash } = require('crypto');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function freshRequire() {
  jest.resetModules();
  delete require.cache[require.resolve('../src/i18n.js')];
  require('../src/i18n.js');
  return window.YouTubePlusI18n;
}

function okJson(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  };
}

/** The bundle's embedded English dictionary, digest-verified against the manifest. */
function installEmbeddedEn() {
  Object.defineProperty(globalThis, '__YouTubePlusEmbeddedDictionaries__', {
    configurable: true,
    writable: true,
    value: { en: { data: readLocaleJson('en') } },
  });
}

/** @param {number} [ageMs] */
function seedCache(data, ageMs = 0) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ version: `${PKG_VERSION}`, timestamp: Date.now() - ageMs, data })
  );
}

describe('locale delivery contract (main branch)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'YouTubePlusI18n', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    // jsdom provides no WebCrypto subtle — install the real Node webcrypto so
    // the embedded English dictionary verifies against the manifest and the
    // en-known key filter is active.
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: nodeCrypto.webcrypto,
    });
    global.fetch = jest.fn();
    localStorage.clear();
    delete globalThis.GM_xmlhttpRequest;
    delete globalThis.__YouTubePlusEmbeddedDictionaries__;
  });

  afterEach(() => {
    localStorage.clear();
    delete globalThis.__YouTubePlusEmbeddedDictionaries__;
    jest.clearAllMocks();
  });

  describe('generated manifest ↔ shipped locales', () => {
    test('LOCALE_DELIVERY_MANIFEST digests match every shipped locale file', () => {
      const source = fs.readFileSync(path.join(ROOT, 'src', 'i18n.js'), 'utf8');
      const start = source.indexOf('// AUTO-GENERATED-START: LOCALE_DELIVERY_MANIFEST');
      const end = source.indexOf('// AUTO-GENERATED-END: LOCALE_DELIVERY_MANIFEST');
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const block = source.slice(start, end);

      const localeFiles = fs
        .readdirSync(LOCALES_DIR)
        .filter(f => f.endsWith('.json'))
        .sort();

      const enKeys = Object.keys(readLocaleJson('en')).sort();
      const declaredKeysCount = Number(block.match(/^\s*keysCount: (\d+),$/m)?.[1]);
      expect(declaredKeysCount).toBe(enKeys.length);

      // Aggregate digest over the LF text of each file: the same algorithm as
      // scripts/check-locale-parity.js, so a CRLF checkout gives the same value.
      const cryptoMod = require('crypto');
      const aggregate = cryptoMod.createHash('sha256');
      for (const f of localeFiles) {
        const text = fs.readFileSync(path.join(LOCALES_DIR, f), 'utf8').replace(/\r\n/g, '\n');
        aggregate.update(`${f}:${cryptoMod.createHash('sha256').update(text).digest('hex')}\n`);
      }
      expect(block.match(/^\s*candidateDigest: "([0-9a-f]{64})",$/m)?.[1]).toBe(
        aggregate.digest('hex')
      );

      for (const f of localeFiles) {
        const lang = f.replace('.json', '');
        const match = block.match(new RegExp(`^\\s*"${lang}": "([0-9a-f]{64})",$`, 'm'));
        expect(match).not.toBeNull();
        const actualDigest = sha256(canonicalize(readLocaleJson(lang)));
        expect(match[1]).toBe(actualDigest);
      }
    });
  });

  describe('shape-based remote delivery', () => {
    test('a dictionary fetched from main is accepted by shape and persisted', async () => {
      const ru = readLocaleJson('ru');
      global.fetch = jest.fn(async url => {
        if (String(url).includes('/ru.json')) return okJson(ru);
        return okJson({ settingsTitle: 'Settings' });
      });

      const i18n = freshRequire();
      await expect(i18n.setLanguage('ru')).resolves.toBe(true);

      const status = i18n.getLocaleStatus('ru');
      expect(status.isComplete).toBe(true);
      expect(status.isFallback).toBe(false);
      expect(status.isStale).toBe(false);
      expect(i18n.t('settingsTitle')).toBe(ru.settingsTitle);

      // The cache entry holds no digest, only the accepted data and version.
      const stored = JSON.parse(localStorage.getItem(CACHE_KEY));
      expect(stored).not.toBeNull();
      expect(stored.digest).toBeUndefined();
      expect(typeof stored.timestamp).toBe('number');
      expect(Object.keys(stored.data)).toHaveLength(Object.keys(ru).length);
    });

    test('extra keys, non-string, huge and control-char values are filtered out', async () => {
      installEmbeddedEn();
      const payload = {
        settingsTitle: 'Из main',
        extraNotInEn: 'dropped: key not in en',
        numberValue: 42,
        boolValue: true,
        hugeValue: 'a'.repeat(1001),
        controlValue: 'bad\u0000value',
      };
      global.fetch = jest.fn(async url => {
        if (String(url).includes('/ru.json')) return okJson(payload);
        return okJson({ settingsTitle: 'Settings' });
      });

      const i18n = freshRequire();
      await expect(i18n.setLanguage('ru')).resolves.toBe(true);

      // Only the shape-valid, en-known key survives.
      expect(i18n.t('settingsTitle')).toBe('Из main');
      expect(i18n.t('extraNotInEn')).toBe('extraNotInEn');
      expect(i18n.t('numberValue')).toBe('numberValue');
      expect(i18n.t('boolValue')).toBe('boolValue');
      expect(i18n.t('hugeValue')).toBe('hugeValue');
      expect(i18n.t('controlValue')).toBe('controlValue');

      const stored = JSON.parse(localStorage.getItem(CACHE_KEY));
      expect(Object.keys(stored.data)).toEqual(['settingsTitle']);
    });

    test('a payload that filters down to nothing is rejected and falls back to embedded en', async () => {
      installEmbeddedEn();
      const en = readLocaleJson('en');
      global.fetch = jest.fn(async url => {
        if (String(url).includes('/ru.json')) {
          return okJson({ notInEnA: 1, notInEnB: 'x', notInEnC: true });
        }
        return okJson({ settingsTitle: 'Settings' });
      });

      const i18n = freshRequire();
      // No accepted dictionary → the language falls back to English.
      await expect(i18n.setLanguage('ru')).resolves.toBe(false);
      expect(i18n.getLanguage()).toBe('en');
      expect(i18n.t('settingsTitle')).toBe(en.settingsTitle);
      expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    });

    test('offline with a fresh cache serves the cache without a rejected fallback', async () => {
      const cached = { settingsTitle: 'Кэшированное' };
      seedCache(cached, 1000);
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const i18n = freshRequire();
      await expect(i18n.setLanguage('ru')).resolves.toBe(true);

      expect(i18n.t('settingsTitle')).toBe('Кэшированное');
      const status = i18n.getLocaleStatus('ru');
      expect(status.isStale).toBe(false);
      expect(status.isComplete).toBe(true);

      // The background refresh failed offline; the cache entry is untouched.
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(i18n.t('settingsTitle')).toBe('Кэшированное');
      expect(JSON.parse(localStorage.getItem(CACHE_KEY)).data.settingsTitle).toBe('Кэшированное');
    });

    test('a cache older than 24 h is served then refreshed in the background with a change event', async () => {
      seedCache({ settingsTitle: 'Старое' }, DAY_MS + 60_000);
      /** @type {(() => void) | null} */
      let releaseRefresh = null;
      global.fetch = jest.fn(async url => {
        if (String(url).includes('/ru.json')) {
          return new Promise(resolve => {
            releaseRefresh = () => resolve(okJson({ settingsTitle: 'Новое' }));
          });
        }
        return okJson({ settingsTitle: 'Settings' });
      });

      const i18n = freshRequire();
      const changes = [];
      window.addEventListener('youtube-plus-language-changed', event => {
        changes.push(/** @type {CustomEvent} */ (event).detail);
      });

      await expect(i18n.setLanguage('ru')).resolves.toBe(true);
      // The stale cache is served first, marked stale.
      expect(i18n.t('settingsTitle')).toBe('Старое');
      expect(i18n.getLocaleStatus('ru').isStale).toBe(true);

      // The background refresh resolves and replaces the dictionary.
      expect(releaseRefresh).toBeInstanceOf(Function);
      /** @type {() => void} */ (releaseRefresh)();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(i18n.t('settingsTitle')).toBe('Новое');
      expect(i18n.getLocaleStatus('ru').isStale).toBe(false);
      expect(changes.some(detail => detail && detail.language === 'ru')).toBe(true);
      expect(JSON.parse(localStorage.getItem(CACHE_KEY)).data.settingsTitle).toBe('Новое');
    });

    test('concurrent loads share one network fetch', async () => {
      const ru = readLocaleJson('ru');
      let resolveRu;
      global.fetch = jest.fn(async url => {
        if (String(url).includes('/ru.json')) {
          return new Promise(resolve => {
            resolveRu = () => resolve(okJson(ru));
          });
        }
        return okJson({ settingsTitle: 'Settings' });
      });

      freshRequire();
      const loader = window.YouTubePlusI18nLoader;
      expect(loader).toBeTruthy();
      const first = loader.loadTranslations('ru');
      const second = loader.loadTranslations('ru');
      for (let i = 0; i < 100 && global.fetch.mock.calls.length === 0; i++) {
        await Promise.resolve();
      }
      resolveRu();
      await expect(first).resolves.toEqual(ru);
      await expect(second).resolves.toEqual(ru);
      const ruFetches = global.fetch.mock.calls.filter(([u]) => String(u).includes('/ru.json'));
      expect(ruFetches).toHaveLength(1);
    });
  });
});
