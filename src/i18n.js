/**
 * YouTube+ Internationalization (i18n): translation service.
 *
 * Responsibilities:
 *   - Translation lookup with parameter interpolation.
 *   - Embedded / CDN-backed translation loading.
 *   - Language detection (YouTube HTML lang, hl param, ytcfg, browser).
 *   - Language change subscriptions (in-process + window CustomEvent).
 *   - Locale-aware number / date / plural formatting.
 *
 * Public surface:
 *   window.YouTubePlusI18n
 *     - t(key, params?) / translate(key, params?)
 *     - getLanguage() / setLanguage(lang) / detectLanguage()
 *     - getAllTranslations() / getAvailableLanguages()
 *     - hasTranslation(key) / addTranslation(key, value) / addTranslations({...})
 *     - onLanguageChange(cb) -> unsubscribe
 *     - formatNumber(num, options?) / formatDate(date, options?) / pluralize(...)
 *     - clearCache() / getCacheStats()
 *     - isReady() / loadTranslations() / initialize()
 *     - translations            [read-only snapshot]
 *     - currentLanguage         [read-only snapshot]
 *     - getStats()              [for diagnostics]
 *
 * Non-responsibilities:
 *   - Settings modal internals (settings-helpers.js / modal-handlers.js).
 *   - DOM / feature logic.
 *   - Mutating window.YouTubeUtils: utils.js is the compatibility
 *     facade and already exposes t / getLanguage on YouTubeUtils.
 */
(function () {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const GITHUB_CONFIG = {
    owner: 'diorhc',
    repo: 'YTP',
    // Dictionaries are read from the mutable `main` branch so a translation fix
    // ships without a new release. Payloads are shape-checked at runtime, so a
    // bad branch commit can lose keys, not inject markup or values.
    ref: 'main',
    basePath: 'locales',
  };

  // AUTO-GENERATED-START: LOCALE_DELIVERY_MANIFEST
  // Release metadata for the locale delivery contract.
  // Regenerate with: node scripts/sync-locale-metadata.js
  // localeDigests: SHA-256 over the sorted JSON payload
  // of each shipped locales file; a release fingerprint, not a runtime check.
  // candidateDigest: aggregate over raw file bytes, matching the locale parity
  // checker. Only the embedded en digest is verified at build time.
  // biome-ignore format: generated data block
  /** @type {{ version: string; keysCount: number; candidateDigest: string; localeDigests: Readonly<Record<string, string>> }} */
  const LOCALE_DELIVERY_MANIFEST = Object.freeze({
    version: "3.0.1",
    keysCount: 425,
    candidateDigest: "57a279429b0f251d675c28b234a8bcd24884c1b6adcbb04f8fc9702da9b0fb4c",
    localeDigests: Object.freeze({
      "ar": "e2705520e5a5ba896cdd343131ab8498d2a47b0c742d4263e44d1cf662c7b7a0",
      "az": "414845721fe3d7cac99c93b9c90f63b267f99544398c2dc8c1e8eae69376bccf",
      "be": "874e4fab14c831a2ebffd56438007126db38b7738e560d1e2f1dce8d28f93916",
      "bg": "ad099e10cd36c1472140a6574fe1dfc03492881fe6543f4e70fe48ad74921ee4",
      "de": "2ab3620ef9fc573e72c2215d7b2f4f58ffe2bacddf2c48d900ccbb0048ce540c",
      "en": "10834fd7ec1e86dac1c23c56008a5e8721729579bc6ccc02fda1b99eaacd43c9",
      "es": "88a1f778ac699643b7518602c22034942b334b366bfa886dafe2cb58e3f69838",
      "fr": "3a7732f4a18c7e5b51b40189864dd2e33e81dec2069aee1672216f124b90ea42",
      "hi": "b2fb3dba03c299d1bea4f2fc4473f94a3346edd2db19bca1c2a2ace51ad662c5",
      "id": "a34575d67870205a4acbaeec6fcf09b1c15ba34b0bf35f2aebb475b023f99293",
      "it": "f8502f8afb0379ba79928bfb11b1f4bdad642853d016cb2a9db779361fc32936",
      "ja": "0d7181220de2b19a253cdb192c503367f9e7fd39d81da3c0e656e2d4182fbc2c",
      "kk": "4b308268178a7d7a3fdfbbb75c7e5387a7b38777b729e30762150c5a6766cb14",
      "ko": "546134a72275d86014834529be35b10d88e4903e6417fd7dd675f6aec6312039",
      "ky": "264ff8d2aa8ec29d885cccc6c483f77c05ab31a209ab3791f066e3a15666dd89",
      "nl": "83b16a5c7464c069fcd36fbd3903aa26c95386c075ecd47abe1ae565af0b0280",
      "pl": "d230d2cc3224375976445f3cbac1ac1b03e0286d6e8350bdec151ca46a093963",
      "pt": "dcf70624609e15d2631eadb21206cdc1a92244cfc5dad565845904db4bc785e8",
      "ru": "ca4c638617b4dd62f27a1d0f67aeb44b9d223ea1d957ecb779270d60a99d050d",
      "tr": "795eb99fe2de31d7441b5d234c759d2e391e73e3b374076dcd111d9eb52f7257",
      "uk": "8a5577bccf02fb3646b39582ff717b54213d7304e40bc1e522f15c6a42eea53a",
      "uz": "d9079637ded0de878ad74d521c5a3362c681ebfd2ddf52b603d6e76277b162cf",
      "vi": "3db2000191c8c9500855947e049e05bf0133dc0858193f4cef36d15233b57f41",
      "zh-CN": "c6464c532a85cc5292d6cc17a82dc738403cc4258fcbab1278956092f29ab26b",
      "zh-TW": "1bb5b1f728c87b4e1e1c020808488c7591bbd2416d61875a1fd4efa23a308eec",
    }),
  });
  // AUTO-GENERATED-END: LOCALE_DELIVERY_MANIFEST

  // Facade over the generated delivery manifest. Only the embedded English
  // dictionary still checks a build-time manifest digest; remote and cached
  // payloads are shape-checked instead.
  const CANDIDATE_METADATA = Object.freeze({
    version: LOCALE_DELIVERY_MANIFEST.version,
    keysCount: LOCALE_DELIVERY_MANIFEST.keysCount,
  });

  const CDN_URLS = {
    github: `https://raw.githubusercontent.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/${GITHUB_CONFIG.ref}/${GITHUB_CONFIG.basePath}`,
    jsdelivr: `https://cdn.jsdelivr.net/gh/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}@${GITHUB_CONFIG.ref}/${GITHUB_CONFIG.basePath}`,
  };

  // Translation files shipped with the project. Any other YouTube UI language will map to the
  // closest language below (usually English).
  // AUTO-GENERATED-START: AVAILABLE_LANGUAGES
  const AVAILABLE_LANGUAGES = [
    'ar',
    'az',
    'be',
    'bg',
    'de',
    'en',
    'es',
    'fr',
    'hi',
    'id',
    'it',
    'ja',
    'kk',
    'ko',
    'ky',
    'nl',
    'pl',
    'pt',
    'ru',
    'tr',
    'uk',
    'uz',
    'vi',
    'zh-CN',
    'zh-TW',
  ];
  // AUTO-GENERATED-END: AVAILABLE_LANGUAGES

  /** @type {Record<string, string>} */
  const LANGUAGE_NAMES = {
    en: 'English',
    ru: 'Русский',
    ko: '한국어',
    fr: 'Français',
    nl: 'Nederlands',
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    ja: '日本語',
    tr: 'Türkçe',
    es: 'Español',
    pt: 'Português',
    de: 'Deutsch',
    it: 'Italiano',
    pl: 'Polski',
    uk: 'Українська',
    sv: 'Svenska',
    no: 'Norsk',
    da: 'Dansk',
    fi: 'Suomi',
    cs: 'Čeština',
    sk: 'Slovenčina',
    hu: 'Magyar',
    ro: 'Română',
    bg: 'Български',
    hr: 'Hrvatski',
    sr: 'Српски',
    sl: 'Slovenščina',
    el: 'Ελληνικά',
    lt: 'Lietuvių',
    lv: 'Latviešu',
    et: 'Eesti',
    mk: 'Македонски',
    sq: 'Shqip',
    bs: 'Bosanski',
    is: 'Íslenska',
    ca: 'Català',
    eu: 'Euskara',
    gl: 'Galego',
    ar: 'العربية',
    he: 'עברית',
    fa: 'فارسی',
    sw: 'Kiswahili',
    zu: 'isiZulu',
    af: 'Afrikaans',
    am: 'አማርኛ',
    hi: 'हिन्दी',
    th: 'ไทย',
    vi: 'Tiếng Việt',
    id: 'Bahasa Indonesia',
    ms: 'Bahasa Melayu',
    bn: 'বাংলা',
    ta: 'தமிழ்',
    te: 'తెలుగు',
    mr: 'मराठी',
    gu: 'ગુજરાતી',
    kn: 'ಕನ್ನಡ',
    ml: 'മലയാളം',
    pa: 'ਪੰਜਾਬੀ',
    fil: 'Filipino',
    km: 'ភាសាខ្មែរ',
    lo: 'ລາວ',
    my: 'မြန်မာ',
    ne: 'नेपाली',
    si: 'සිංහල',
    az: 'Azərbaycanca',
    be: 'Беларуская',
    hy: 'Հայերեն',
    ka: 'ქართული',
    kk: 'Қазақ',
    ky: 'Кыргыз',
    mn: 'Монгол',
    tg: 'Тоҷикӣ',
    uz: 'O\u02BBzbekcha',
  };

  // Languages whose translation file is English (no dedicated translation
  // shipped). Stored as a list so the fallback table below stays compact.
  /** @type {string[]} */
  const EN_FALLBACK_LANGS = [
    'th',
    'th-th',
    'ms',
    'ms-my',
    'sv',
    'sv-se',
    'no',
    'nb-no',
    'nn-no',
    'da',
    'da-dk',
    'fi',
    'fi-fi',
    'cs',
    'cs-cz',
    'sk',
    'sk-sk',
    'hu',
    'hu-hu',
    'ro',
    'ro-ro',
    'hr',
    'hr-hr',
    'sl',
    'sl-si',
    'el',
    'el-gr',
    'he',
    'he-il',
    'iw',
    'fa',
    'fa-ir',
    'bn',
    'bn-in',
    'ta',
    'ta-in',
    'te',
    'te-in',
    'mr',
    'mr-in',
    'gu',
    'gu-in',
    'kn',
    'kn-in',
    'ml',
    'ml-in',
    'pa',
    'pa-in',
    'fil',
    'fil-ph',
    'tl',
    'km',
    'lo',
    'my',
    'ne',
    'si',
    'sw',
    'sw-ke',
    'zu',
    'af',
    'am',
    'ka',
    'lt',
    'lt-lt',
    'lv',
    'lv-lv',
    'et',
    'et-ee',
    'sq',
    'bs',
    'is',
  ];

  /** @type {Record<string, string>} */
  const LANGUAGE_FALLBACKS = {
    es: 'es',
    'es-es': 'es',
    'es-mx': 'es',
    'es-419': 'es',
    pt: 'pt',
    'pt-br': 'pt',
    'pt-pt': 'pt',
    de: 'de',
    'de-de': 'de',
    'de-at': 'de',
    'de-ch': 'de',
    it: 'it',
    pl: 'pl',
    uk: 'uk',
    'uk-ua': 'uk',
    ar: 'ar',
    'ar-sa': 'ar',
    'ar-ae': 'ar',
    'ar-eg': 'ar',
    hi: 'hi',
    'hi-in': 'hi',
    vi: 'vi',
    'vi-vn': 'vi',
    id: 'id',
    'id-id': 'id',
    bg: 'bg',
    'bg-bg': 'bg',
    sr: 'ru',
    'sr-rs': 'ru',
    az: 'az',
    'az-az': 'az',
    be: 'be',
    'be-by': 'be',
    hy: 'ru',
    kk: 'kk',
    'kk-kz': 'kk',
    ky: 'ky',
    mn: 'ru',
    tg: 'ru',
    uz: 'uz',
    'uz-uz': 'uz',
    mk: 'ru',
    ca: 'es',
    eu: 'es',
    gl: 'es',
    ...Object.fromEntries(EN_FALLBACK_LANGS.map(k => [k, 'en'])),
  };

  // YouTube language code -> shipped short code.
  /** @type {Record<string, string>} */
  const languageMap = {
    ko: 'ko',
    'ko-kr': 'ko',
    fr: 'fr',
    'fr-fr': 'fr',
    'fr-ca': 'fr',
    'fr-be': 'fr',
    'fr-ch': 'fr',
    nl: 'nl',
    'nl-nl': 'nl',
    'nl-be': 'nl',
    zh: 'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-hans': 'zh-CN',
    'zh-sg': 'zh-CN',
    'zh-tw': 'zh-TW',
    'zh-hk': 'zh-TW',
    'zh-hant': 'zh-TW',
    ja: 'ja',
    'ja-jp': 'ja',
    tr: 'tr',
    'tr-tr': 'tr',
    ru: 'ru',
    'ru-ru': 'ru',
    en: 'en',
    'en-us': 'en',
    'en-gb': 'en',
    'en-au': 'en',
    'en-ca': 'en',
    'en-in': 'en',
    // BCP 47 aliases
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    ...LANGUAGE_FALLBACKS,
  };

  /** @type {Record<string, string>} */
  const LOCALE_FOR_LANG = {
    ru: 'ru-RU',
    ko: 'ko-KR',
    fr: 'fr-FR',
    nl: 'nl-NL',
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    ja: 'ja-JP',
    tr: 'tr-TR',
    es: 'es-ES',
    pt: 'pt-PT',
    de: 'de-DE',
    it: 'it-IT',
    pl: 'pl-PL',
    uk: 'uk-UA',
    ar: 'ar-SA',
    hi: 'hi-IN',
    vi: 'vi-VN',
    id: 'id-ID',
    uz: 'uz-UZ',
    kk: 'kk-KZ',
    ky: 'ky-KG',
    be: 'be-BY',
    bg: 'bg-BG',
    az: 'az-AZ',
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const setTimeout_ = setTimeout.bind(window);
  const logger = window.YouTubePlusLogger || window.YouTubeUtils?.logger || null;

  /** @type {Map<string, Record<string, string>>} */
  const translationsCache = new Map();
  /** @type {Map<string, Promise<Record<string, string>>>} */
  const loadingPromises = new Map();
  /** @type {Map<string, string>} */
  const translationCache = new Map();
  /** @type {Set<(newLang: string, oldLang: string) => void>} */
  const languageChangeListeners = new Set();

  let currentLanguage = 'en';
  /** @type {Record<string, string>} */
  let translations = {};
  /** @type {Record<string, string>} */
  let fallbackTranslationsEn = {};

  /**
   * Reads embedded English dictionary synchronously so `t()` has English
   * fallbacks immediately from boot, avoiding raw key display before async
   * network / digest verification completes.
   */
  function syncInitEmbeddedEn_() {
    const host =
      /** @type {{ __YouTubePlusEmbeddedDictionaries__?: Record<string, { data?: unknown }> }} */ (
        globalThis
      );
    const entry = host.__YouTubePlusEmbeddedDictionaries__?.en;
    const data = entry && typeof entry === 'object' ? entry.data : null;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      fallbackTranslationsEn = /** @type {Record<string, string>} */ (data);
    }
  }

  syncInitEmbeddedEn_();

  // The only offline dictionary is the English payload embedded into the
  // bundle by build.js; it is trusted only after digest verification against
  // the locale delivery manifest, exactly like network and cache delivery.
  // Missing UI strings render as raw keys when neither network, cache, nor
  // that verified embedded payload is available.

  /**
   * UTF-8 bytes of a string without TextEncoder (unavailable in some jsdom
   * builds). encodeURIComponent escapes every non-ASCII byte as %XX, so the
   * binary-safe reconstruction below yields the exact UTF-8 byte sequence.
   * @param {string} str
   * @returns {Uint8Array}
   */
  function utf8Bytes_(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    const binary = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_m, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /**
   * SHA-256 over the payload's sorted-key UTF-8 form. Stays identical to
   * canonicalDigest() in scripts/sync-locale-metadata.js; the expected values
   * in LOCALE_DELIVERY_MANIFEST.localeDigests were computed with this form.
   * Returns '' when the platform exposes no WebCrypto: digest verification
   * cannot pass, so an unhashable payload is unverified, never "current".
   * @param {Record<string, string>} data
   * @returns {Promise<string>}
   */
  async function computeLocaleDigest_(data) {
    try {
      const cryptoHost = /** @type {{ subtle?: SubtleCrypto }} */ (globalThis.crypto);
      if (!cryptoHost?.subtle) return '';
      const canonical = JSON.stringify(data, Object.keys(data).sort());
      const buf = await cryptoHost.subtle.digest(
        'SHA-256',
        /** @type {BufferSource} */
        (utf8Bytes_(canonical))
      );
      return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    } catch (_e) {
      return '';
    }
  }

  /**
   * A payload counts as CURRENT candidate delivery only when the hash
   * RECOMPUTED over its actual content matches the manifest expectation for
   * this language. The digest over the payload's sorted-key form is itself the
   * key-completeness proof; the stored digest field is metadata, not proof
   * A missing/empty recomputed hash (no WebCrypto) is unverified,
   * never "current".
   * @param {string} lang
   * @param {Record<string, string>} data
   * @returns {Promise<boolean>}
   */
  async function isVerifiedCandidateDelivery_(lang, data) {
    const actual = await computeLocaleDigest_(data);
    if (!actual) return false;
    if (actual !== LOCALE_DELIVERY_MANIFEST.localeDigests[lang]) return false;
    return Object.keys(data).length === CANDIDATE_METADATA.keysCount;
  }

  // ---------------------------------------------------------------------------
  // Loader (GitHub / jsDelivr)
  // ---------------------------------------------------------------------------

  /**
   * @param {string} url
   * @returns {Promise<Record<string, string>>}
   */
  async function fetchJSON(url) {
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      const responseText = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout_(() => reject(new Error('i18n request timeout')), 12000);
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: 12000,
          headers: { Accept: 'application/json' },
          onload: response => {
            clearTimeout(timeoutId);
            if (response.status >= 200 && response.status < 300) {
              resolve(response.responseText || '');
              return;
            }
            reject(
              new Error(`HTTP ${response.status}: ${response.statusText || 'request failed'}`)
            );
          },
          onerror: err => {
            clearTimeout(timeoutId);
            reject(new Error(`Network error: ${String(err)}`));
          },
          ontimeout: () => {
            clearTimeout(timeoutId);
            reject(new Error('i18n request timeout'));
          },
        });
      });
      try {
        return JSON.parse(String(responseText || '{}'));
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        throw new Error(`Malformed JSON response from ${url}: ${msg}`);
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout_(() => controller.abort(new Error('i18n request timeout')), 12000);
    try {
      const response = await fetch(url, {
        cache: 'default',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      return JSON.parse(text || '{}');
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error('i18n request timeout');
      }
      if (err instanceof SyntaxError) {
        throw new Error(`Malformed JSON response from ${url}: ${err.message}`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * @param {string} lang
   * @returns {Promise<Record<string, string>>}
   */
  async function fetchTranslation(lang) {
    // Both URLs point at `main`, so the CDN may serve a slightly stale copy;
    // the runtime revalidates on a 24 h cadence and shape-checks every payload.
    try {
      const rawUrl = `${CDN_URLS.github}/${lang}.json`;
      return await fetchJSON(rawUrl);
    } catch (firstErr) {
      try {
        const cdnUrl = `${CDN_URLS.jsdelivr}/${lang}.json`;
        logger?.warn?.('i18n', `Raw GitHub fetch failed, trying jsDelivr: ${cdnUrl}`);
        return await fetchJSON(cdnUrl);
      } catch (err) {
        // Not a script fault: the release tag may not be published yet, or
        // the network is offline. The caller falls back to English.
        logger?.warn?.(
          'i18n',
          `Translations for ${lang} unavailable (${
            /** @type {string} */ (
              /** @type {{ message?: unknown }} */ (/** @type {unknown} */ (err))?.message
            ) || err
          }; first: ${
            /** @type {string} */ (
              /** @type {{ message?: unknown }} */ (/** @type {unknown} */ (firstErr))?.message
            ) || firstErr
          })`
        );
        throw err;
      }
    }
  }

  const CACHE_CONFIG = {
    storageKeyPrefix: 'ytp_locale_cache_v',
    version: LOCALE_DELIVERY_MANIFEST.version,
    ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  };

  /** @type {Map<string, { isFallback: boolean; isStale: boolean; isOffline?: boolean; keysCount: number; timestamp: number }>} */
  const localeDeliveryStatuses = new Map();

  /**
   * @param {string} lang
   * @param {{ isFallback: boolean; isStale: boolean; isOffline?: boolean; keysCount: number }} status
   */
  function recordLocaleDeliveryStatus_(lang, status) {
    localeDeliveryStatuses.set(lang, {
      ...status,
      timestamp: Date.now(),
    });
  }

  /**
   * @param {string} [lang]
   * @returns {{
   *   language: string;
   *   version: string;
   *   ref: string;
   *   isFallback: boolean;
   *   isStale: boolean;
   *   isOffline: boolean;
   *   keysCount: number;
   *   expectedKeysCount: number;
   *   isComplete: boolean;
   * }}
   */
  function getLocaleDeliveryStatus_(lang = currentLanguage) {
    const langCode = AVAILABLE_LANGUAGES.includes(lang) ? lang : 'en';
    const recorded = localeDeliveryStatuses.get(langCode);
    const activeTranslations =
      translationsCache.get(langCode) ||
      (currentLanguage === langCode && translations ? translations : null);
    const activeKeysCount = activeTranslations ? Object.keys(activeTranslations).length : 0;
    if (recorded) {
      return {
        language: langCode,
        version: CACHE_CONFIG.version,
        ref: GITHUB_CONFIG.ref,
        isFallback: Boolean(recorded.isFallback),
        isStale: Boolean(recorded.isStale),
        isOffline: Boolean(recorded.isOffline),
        keysCount: recorded.keysCount,
        expectedKeysCount: CANDIDATE_METADATA.keysCount,
        isComplete: !(recorded.isFallback || recorded.isStale),
      };
    }
    const isComplete = activeKeysCount > 0;
    return {
      language: langCode,
      version: CACHE_CONFIG.version,
      ref: GITHUB_CONFIG.ref,
      isFallback: false,
      isStale: false,
      isOffline: false,
      keysCount: activeKeysCount,
      expectedKeysCount: CANDIDATE_METADATA.keysCount,
      isComplete,
    };
  }

  /**
   * Get versioned storage key for language cache.
   * @param {string} lang
   * @returns {string}
   */
  function getCacheKey(lang) {
    return `${CACHE_CONFIG.storageKeyPrefix}${CACHE_CONFIG.version}_${lang}`;
  }

  /**
   * The English dictionary baked into the bundle by build.js (locales/en.json,
   * digest verified at build time). A payload is trusted only when the
   * SHA-256 recomputed over its sorted-key form matches the locale delivery
   * manifest, the same bar as network and cache delivery, so a planted global
   * cannot bypass verification.
   * @param {string} lang
   * @returns {Promise<Record<string, string> | null>}
   */
  async function getVerifiedEmbeddedDictionary_(lang) {
    const host =
      /** @type {{ __YouTubePlusEmbeddedDictionaries__?: Record<string, { data?: unknown }> }} */ (
        globalThis
      );
    const entry = host.__YouTubePlusEmbeddedDictionaries__?.[lang];
    const data = entry && typeof entry === 'object' ? entry.data : null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const flat = /** @type {Record<string, string>} */ (data);
    if (Object.keys(flat).length === 0) return null;
    if (!(await isVerifiedCandidateDelivery_(lang, flat))) {
      logger?.warn?.('i18n', `Embedded ${lang} dictionary failed digest verification; ignoring`);
      if (lang === 'en' && fallbackTranslationsEn === flat) {
        fallbackTranslationsEn = {};
        translationCache.clear();
      }
      return null;
    }
    return flat;
  }

  /**
   * Read a translation dictionary from the persistent browser cache. Entries
   * written under a different cache version, or that fail the shape check, are
   * dropped. Age is not a rejection here: the caller serves a stale entry and
   * revalidates it in the background.
   * @param {string} lang
   * @returns {{ data: Record<string, string>; timestamp: number } | null}
   */
  function readPersistentCache(lang) {
    try {
      if (typeof localStorage === 'undefined') return null;
      const key = getCacheKey(lang);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_jsonErr) {
        localStorage.removeItem(key);
        return null;
      }
      if (!parsed || typeof parsed !== 'object' || parsed.version !== CACHE_CONFIG.version) {
        localStorage.removeItem(key);
        return null;
      }
      const data = sanitizeRemoteDictionary_(parsed.data);
      if (!data || typeof parsed.timestamp !== 'number') {
        localStorage.removeItem(key);
        return null;
      }
      return { data, timestamp: parsed.timestamp };
    } catch (_e) {
      return null;
    }
  }

  /**
   * Persist a shape-validated dictionary with version metadata. Only accepted
   * payloads reach this function, so a later read can skip re-validation.
   * @param {string} lang
   * @param {Record<string, string>} data
   */
  function writePersistentCache(lang, data) {
    try {
      if (typeof localStorage === 'undefined') return;
      const key = getCacheKey(lang);
      localStorage.setItem(
        key,
        JSON.stringify({ version: CACHE_CONFIG.version, timestamp: Date.now(), data })
      );
    } catch (_e) {
      /* ignore storage quota exceeded errors */
    }
  }

  /** Longest accepted translation value, in code units. */
  const MAX_TRANSLATION_LENGTH = 1000;
  /** Control characters except tab/newline/CR are never valid in a value. */
  const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

  /**
   * Shape check for a dictionary from the mutable `main` branch (or the cache
   * written from one). There is no digest to pin, so a payload is trusted only
   * by form: an object whose keys exist in the embedded English dictionary and
   * whose values are short plain strings. Unknown keys are dropped; an empty
   * result is rejected. Keys the payload omits fall back to embedded English in
   * resolveKey().
   * @param {unknown} raw
   * @returns {Record<string, string> | null}
   */
  function sanitizeRemoteDictionary_(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const enKeys = new Set(Object.keys(fallbackTranslationsEn || {}));
    /** @type {Record<string, string>} */
    const clean = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (enKeys.size > 0 && !enKeys.has(key)) continue;
      if (typeof value !== 'string' || value.length > MAX_TRANSLATION_LENGTH) continue;
      if (CONTROL_CHARS_RE.test(value)) continue;
      clean[key] = value;
    }
    return Object.keys(clean).length > 0 ? clean : null;
  }

  /**
   * Fetch and shape-check a remote dictionary, or throw when it is unusable.
   * @param {string} lang
   * @returns {Promise<Record<string, string>>}
   */
  async function fetchAndValidateDictionary_(lang) {
    const raw = await fetchTranslation(lang);
    const data = sanitizeRemoteDictionary_(raw);
    if (!data) throw new Error(`Rejected ${lang} dictionary: shape check failed`);
    return data;
  }

  /**
   * Revalidate a cached dictionary in the background: the cached copy is served
   * immediately, then the fresh one replaces it and a language-changed event
   * lets views re-render. A failed refresh leaves the cached dictionary in place.
   * @param {string} lang
   * @returns {Promise<void>}
   */
  async function refreshDictionaryInBackground_(lang) {
    try {
      const data = await fetchAndValidateDictionary_(lang);
      translationsCache.set(lang, data);
      writePersistentCache(lang, data);
      recordLocaleDeliveryStatus_(lang, {
        isFallback: false,
        isStale: false,
        keysCount: Object.keys(data).length,
      });
      if (currentLanguage === lang) {
        translations = data;
        translationCache.clear();
        emitI18nEvent('youtube-plus-language-changed', { language: lang, previousLanguage: lang });
      }
    } catch (error) {
      logger?.debug?.(
        'i18n',
        `Background refresh for ${lang} failed; keeping the cached dictionary`,
        error
      );
    }
  }

  /**
   * Load a dictionary for `lang`: memory → persistent cache → GitHub/jsDelivr
   * (`main`). A cached dictionary is served immediately and revalidated in the
   * background; the embedded English dictionary backs missing keys and the
   * offline path.
   * @param {string} lang
   * @returns {Promise<Record<string, string>>}
   */
  function loadTranslationsFromLoader(lang) {
    const languageCode = AVAILABLE_LANGUAGES.includes(lang) ? lang : 'en';

    const inMemoryCached = translationsCache.get(languageCode);
    if (inMemoryCached) return Promise.resolve(inMemoryCached);

    // Deduplicate concurrent loads so parallel callers share one network fetch.
    const inflight = loadingPromises.get(languageCode);
    if (inflight) return inflight;

    const cachedEntry = readPersistentCache(languageCode);

    const loadPromise = (async () => {
      try {
        if (cachedEntry) {
          const fresh = Date.now() - cachedEntry.timestamp <= CACHE_CONFIG.ttlMs;
          translationsCache.set(languageCode, cachedEntry.data);
          recordLocaleDeliveryStatus_(languageCode, {
            isFallback: false,
            isStale: !fresh,
            keysCount: Object.keys(cachedEntry.data).length,
          });
          // Serve the cached dictionary now, then revalidate in the background:
          // the fresh payload replaces it and fires a language-changed event.
          void refreshDictionaryInBackground_(languageCode);
          return cachedEntry.data;
        }

        const data = await fetchAndValidateDictionary_(languageCode);
        translationsCache.set(languageCode, data);
        recordLocaleDeliveryStatus_(languageCode, {
          isFallback: false,
          isStale: false,
          keysCount: Object.keys(data).length,
        });
        writePersistentCache(languageCode, data);
        return data;
      } finally {
        loadingPromises.delete(languageCode);
      }
    })();

    loadingPromises.set(languageCode, loadPromise);
    return loadPromise;
  }

  // ---------------------------------------------------------------------------
  // Language detection
  // ---------------------------------------------------------------------------

  /**
   * @param {string} langCode
   * @returns {string}
   */
  function mapToSupportedLanguage(langCode) {
    const lower = String(langCode || '').toLowerCase();
    if (!lower) return 'en';

    if (languageMap[lower]) return languageMap[lower];
    if (AVAILABLE_LANGUAGES.includes(lower)) return lower;

    const shortCode = lower.slice(0, 2);
    if (languageMap[shortCode]) return languageMap[shortCode];
    if (AVAILABLE_LANGUAGES.includes(shortCode)) return shortCode;

    if (LANGUAGE_FALLBACKS[lower]) return LANGUAGE_FALLBACKS[lower];
    if (LANGUAGE_FALLBACKS[shortCode]) return LANGUAGE_FALLBACKS[shortCode];

    return 'en';
  }

  /**
   * @returns {string}
   */
  function detectLanguage() {
    // At document-start the <html> element may not exist yet.
    const ytLang =
      document.documentElement?.lang || window.YouTubeUtils?.$?.('html')?.getAttribute('lang');
    if (ytLang) return mapToSupportedLanguage(ytLang);

    // The `hl` query parameter wins when present.
    const urlParams = new URLSearchParams(window.location.search);
    const hlParam = urlParams.get('hl');
    if (hlParam) return mapToSupportedLanguage(hlParam);

    // The host-page config is cross-context and can be hostile/proxied.
    try {
      const ytConfig = window.ytcfg || window.yt?.config_;
      if (ytConfig && typeof ytConfig.get === 'function') {
        const hl = ytConfig.get('HL') || ytConfig.get('GAPI_LOCALE');
        if (hl) return mapToSupportedLanguage(hl);
      }
    } catch (_e) {
      /* host config access can reject in hardened embeds */
    }

    const browserLang =
      navigator.language ||
      /** @type {{ userLanguage?: string }} */ (/** @type {unknown} */ (navigator)).userLanguage ||
      'en';
    return mapToSupportedLanguage(browserLang);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle events
  // ---------------------------------------------------------------------------

  /**
   * The GM bridge cannot structured-clone functions, symbols or bigints, so the
   * navigation detail is copied through a replacer that flattens them.
   * @param {unknown} detail
   * @returns {unknown}
   */
  const toStructuredCloneSafeDetail = detail => {
    if (detail == null || typeof detail !== 'object') return detail;
    try {
      const clone = /** @type {{ structuredClone?: (value: unknown) => unknown }} */ (
        /** @type {unknown} */ (globalThis)
      ).structuredClone;
      if (typeof clone === 'function') {
        return clone(detail);
      }
    } catch (_e) {
      /* fall through to JSON clone */
    }
    try {
      return JSON.parse(
        JSON.stringify(detail, (_key, value) => {
          if (typeof value === 'function' || typeof value === 'symbol') return undefined;
          if (typeof value === 'bigint') return value.toString();
          return value;
        })
      );
    } catch (_e) {
      return {};
    }
  };

  /**
   * Resolve the page-realm window (userscript sandboxes wrap it; unsafeWindow is
   * the real one), unwrapping the Firefox Xray wrapper when present. Mirrors
   * utils.getPageWindow so every page bridge resolves it the same way.
   * @returns {Window | null}
   */
  function getPageWindow_() {
    if (typeof unsafeWindow === 'undefined') return null;
    const uw = /** @type {{ wrappedJSObject?: unknown }} */ (unsafeWindow);
    const unwrapped = uw.wrappedJSObject;
    if (unwrapped && typeof unwrapped === 'object') return /** @type {Window} */ (unwrapped);
    return /** @type {Window} */ (unsafeWindow);
  }

  /**
   * Dispatch an i18n lifecycle event on a target window.
   * @param {EventTarget} target
   * @param {string} name
   * @param {Object} detail
   */
  function dispatchI18nEventTo(target, name, detail) {
    try {
      target.dispatchEvent(new CustomEvent(name, { detail: toStructuredCloneSafeDetail(detail) }));
    } catch (_e) {
      try {
        target.dispatchEvent(new Event(name));
      } catch {
        /* no-op */
      }
    }
  }

  /**
   * @param {string} name
   * @param {Object} [detail]
   */
  function emitI18nEvent(name, detail = {}) {
    if (typeof window === 'undefined') return;
    dispatchI18nEventTo(window, name, detail);
    // The page realm (Tabview) runs in a different window; mirror there so its
    // listeners re-read the tab labels whenever the locale set changes.
    const pageWin = getPageWindow_();
    if (pageWin && pageWin !== window) dispatchI18nEventTo(pageWin, name, detail);
  }

  // ---------------------------------------------------------------------------
  // Translation core
  // ---------------------------------------------------------------------------

  /**
   * @param {unknown} text
   * @param {TranslationParams} params
   * @returns {string}
   */
  function interpolate(text, params) {
    if (typeof text !== 'string' || !text) return '';
    const entries = Object.entries(params || {});
    if (entries.length === 0) return text;
    let out = text;
    for (const [k, v] of entries) {
      const token = `{${k}}`;
      out = out.split(token).join(String(v));
    }
    return out;
  }

  /**
   * Resolve the source text for a key using the current language, then the
   * English fallback. Returns '' if the key is unknown everywhere; the caller
   * (translate) decides whether to return the key as a last resort.
   * @param {string} key
   * @returns {{ text: string; found: boolean }}
   */
  function resolveKey(key) {
    if (translations && Object.hasOwn(translations, key)) {
      return { text: translations[key], found: true };
    }
    if (fallbackTranslationsEn && Object.hasOwn(fallbackTranslationsEn, key)) {
      return { text: fallbackTranslationsEn[key], found: true };
    }
    return { text: '', found: false };
  }

  /**
   * Warn if a translation is missing and translations are loaded.
   * @param {string} key - Translation key
   * @param {boolean} found - Whether the key was found in translations
   */
  function warnIfMissing(key, found) {
    if (
      !found &&
      Object.keys(translations).length > 0 &&
      Object.keys(fallbackTranslationsEn).length > 0
    ) {
      logger?.warn?.('i18n', `Missing translation for key: ${key}`);
    }
  }

  /** Cache read: the cached translation string, or null on a miss. */
  const cacheLookup = (/** @type {string} */ cacheKey, /** @type {string} */ key) =>
    translationCache.has(cacheKey) ? (translationCache.get(cacheKey) ?? key) : null;

  /**
   * Parameterized translations path.
   * @param {string} key
   * @param {TranslationParams} safeParams
   * @param {string[]} keys
   * @returns {string}
   */
  function translateParameterized(key, safeParams, keys) {
    let paramPart = '';
    for (let i = 0; i < keys.length; i++) {
      paramPart += `${keys[i]}:${safeParams[keys[i]]};`;
    }
    const cacheKey = `${key}:${paramPart}`;

    const cached = cacheLookup(cacheKey, key);
    if (cached !== null) return cached;

    const { text, found } = resolveKey(key);
    if (!found) warnIfMissing(key, found);
    const result = interpolate(found ? text : key, safeParams);

    if (isReady() && found) {
      translationCache.set(cacheKey, result);
    }
    return result;
  }

  /**
   * @param {string} key - Translation key
   * @param {TranslationParams} [params] - Interpolation parameters
   * @returns {string}
   */
  function translate(key, params = {}) {
    if (typeof key !== 'string' || !key) return key == null ? '' : String(key);

    const safeParams = params && typeof params === 'object' ? params : {};
    const keys = Object.keys(safeParams);
    if (keys.length > 0) {
      return translateParameterized(key, safeParams, keys);
    }

    // Fast path: parameterless translations
    const cached = cacheLookup(key, key);
    if (cached !== null) return cached;
    const { text, found } = resolveKey(key);
    const result = found ? text : key;
    warnIfMissing(key, found);
    if (isReady() && found) {
      translationCache.set(key, result);
    }
    return result;
  }

  let activeGeneration = 0;
  let activeLanguageLoading = /** @type {string | null} */ (null);

  /**
   * @returns {Promise<boolean>}
   */
  /**
   * English ships inside the bundle and is digest-verified against the build
   * manifest, so it never needs a network round trip; the network loader is
   * only the path for raw-source runs without the embedded payload.
   * @returns {Promise<Record<string, string>>}
   */
  async function loadEnglish_() {
    const embedded = await getVerifiedEmbeddedDictionary_('en');
    if (embedded) {
      recordLocaleDeliveryStatus_('en', {
        isFallback: false,
        isStale: false,
        keysCount: Object.keys(embedded).length,
      });
      return embedded;
    }
    return /** @type {Record<string, string>} */ (await loadTranslationsFromLoader('en'));
  }

  async function loadTranslations() {
    const currentGen = ++activeGeneration;
    const langToLoad = currentLanguage;
    activeLanguageLoading = langToLoad;

    try {
      logger?.debug?.('i18n', `Loading translations for ${langToLoad} (gen #${currentGen})...`);

      // Kick off the English fallback fetch in parallel with the target
      // language instead of a sequential waterfall after it completes. When
      // that fetch fails, the digest-verified build-embedded dictionary takes
      // over below.
      /** @type {Promise<unknown> | null} */
      let enPromise = null;
      if (
        langToLoad !== 'en' &&
        (!fallbackTranslationsEn || Object.keys(fallbackTranslationsEn).length === 0)
      ) {
        enPromise = loadEnglish_();
        // Prevent unhandled-rejection noise while the fetch is in flight.
        enPromise.catch(() => {});
      }

      const loadedTranslations = /** @type {Record<string, string>} */ (
        langToLoad === 'en' ? await loadEnglish_() : await loadTranslationsFromLoader(langToLoad)
      );

      // Guard against race condition: only commit if this request is still the active generation
      if (currentGen !== activeGeneration || currentLanguage !== langToLoad) {
        logger?.debug?.(
          'i18n',
          `Ignoring stale translations load for ${langToLoad} (gen #${currentGen} vs active #${activeGeneration})`
        );
        return currentLanguage === langToLoad;
      }

      translations = loadedTranslations;

      // Ensure English fallback is available.
      if (enPromise) {
        try {
          fallbackTranslationsEn = /** @type {Record<string, string>} */ (await enPromise);
        } catch (_e) {
          // The English fallback fetch failed (no network): use the
          // digest-verified build-embedded dictionary instead of none.
          fallbackTranslationsEn = (await getVerifiedEmbeddedDictionary_('en')) ?? {};
        }
      }

      translationCache.clear();
      logger?.debug?.(
        'i18n',
        `Loaded ${Object.keys(translations).length} translations for ${langToLoad}`
      );
      return true;
    } catch (error) {
      logger?.warn?.(
        'i18n',
        `Falling back to English: ${
          /** @type {string} */ (
            /** @type {{ message?: unknown }} */ (/** @type {unknown} */ (error))?.message
          ) || error
        }`
      );
      if (currentGen === activeGeneration && currentLanguage !== 'en') {
        currentLanguage = 'en';
        return loadTranslations();
      }
      // English already tried the build-embedded dictionary first
      // (loadEnglish_), so reaching here means no verified English exists.
      return false;
    } finally {
      if (currentGen === activeGeneration) {
        activeLanguageLoading = null;
      }
    }
  }

  /**
   * @returns {string}
   */
  function getLanguage() {
    return currentLanguage;
  }

  /**
   * Tracks an in-flight `setLanguage` call so concurrent callers requesting
   * the same target language share one promise instead of each capturing
   * their own (possibly already-mutated) `oldLang` and firing duplicate
   * `youtube-plus-language-changed` events. Without this, two overlapping
   * `setLanguage('fr')` calls could both "succeed" and emit two events,
   * the second with `previousLanguage: 'fr'` even though the language never
   * actually changed away from 'fr' in between.
   * @type {{ lang: string, promise: Promise<boolean> } | null}
   */
  let activeSetLanguageCall = null;

  /**
   * @param {string} lang
   * @returns {Promise<boolean>}
   */
  async function setLanguage(lang) {
    if (
      lang === currentLanguage &&
      Object.keys(translations).length > 0 &&
      activeLanguageLoading === null
    ) {
      return true;
    }

    if (activeSetLanguageCall && activeSetLanguageCall.lang === lang) {
      return activeSetLanguageCall.promise;
    }

    const oldLang = currentLanguage;
    currentLanguage = lang;

    const callPromise = (async () => {
      try {
        const success = await loadTranslations();
        if (success && currentLanguage === lang) {
          for (const listener of languageChangeListeners) {
            try {
              listener(currentLanguage, oldLang);
            } catch (error) {
              logger?.error?.('i18n', 'Error in language change listener', error);
            }
          }
          emitI18nEvent('youtube-plus-language-changed', {
            language: currentLanguage,
            previousLanguage: oldLang,
          });
          emitI18nEvent('youtube-plus-i18n-ready', { language: currentLanguage });
        }
        return Boolean(success && currentLanguage === lang);
      } catch (error) {
        logger?.error?.('i18n', 'Failed to change language', error);
        return false;
      } finally {
        if (activeSetLanguageCall && activeSetLanguageCall.lang === lang) {
          activeSetLanguageCall = null;
        }
      }
    })();

    activeSetLanguageCall = { lang, promise: callPromise };
    return callPromise;
  }

  /**
   * @returns {Record<string, string>}
   */
  function getAllTranslations() {
    return { ...translations };
  }

  /**
   * @returns {string[]}
   */
  function getAvailableLanguages() {
    return AVAILABLE_LANGUAGES.slice();
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  function hasTranslation(key) {
    return (
      typeof key === 'string' &&
      ((translations && Object.hasOwn(translations, key)) ||
        (fallbackTranslationsEn && Object.hasOwn(fallbackTranslationsEn, key)))
    );
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  function addTranslation(key, value) {
    if (typeof key !== 'string' || !key) return;
    translations[key] = String(value ?? '');
    translationCache.clear();
  }

  /**
   * @param {TranslationDictionary} newTranslations
   */
  function addTranslations(newTranslations) {
    if (!newTranslations || typeof newTranslations !== 'object') return;
    Object.assign(translations, newTranslations);
    translationCache.clear();
  }

  /**
   * @param {(newLang: string, oldLang: string) => void} callback
   * @returns {() => void}
   */
  function onLanguageChange(callback) {
    if (typeof callback !== 'function') return () => {};
    languageChangeListeners.add(callback);
    return () => languageChangeListeners.delete(callback);
  }

  // ---------------------------------------------------------------------------
  // Locale-aware formatting
  // ---------------------------------------------------------------------------

  /**
   * Resolve the locale string for the current language.
   * @returns {string}
   */
  function resolveLocale() {
    const lang = getLanguage();
    return LOCALE_FOR_LANG[lang] || 'en-US';
  }

  /**
   * @param {number} num
   * @param {Object} [options]
   * @returns {string}
   */
  function formatNumber(num, options = {}) {
    try {
      const locale = resolveLocale();
      return new Intl.NumberFormat(locale, options).format(num);
    } catch (error) {
      logger?.error?.('i18n', 'Error formatting number', error);
      return String(num);
    }
  }

  /**
   * @param {Date|number|string} date
   * @param {Object} [options]
   * @returns {string}
   */
  function formatDate(date, options = {}) {
    try {
      const locale = resolveLocale();
      const dateObj = date instanceof Date ? date : new Date(date);
      return new Intl.DateTimeFormat(locale, options).format(dateObj);
    } catch (error) {
      logger?.error?.('i18n', 'Error formatting date', error);
      return String(date);
    }
  }

  /**
   * @param {number} count
   * @param {string} singular
   * @param {string} plural
   * @param {string} [few]
   * @returns {string}
   */
  function pluralize(count, singular, plural, few) {
    const lang = getLanguage();
    if (lang === 'ru' && few) {
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 === 1 && mod100 !== 11) return singular;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
      return plural;
    }
    return count === 1 ? singular : plural;
  }

  // ---------------------------------------------------------------------------
  // Cache / diagnostics
  // ---------------------------------------------------------------------------

  function clearCache() {
    translationCache.clear();
    translationsCache.clear();
    try {
      if (typeof localStorage !== 'undefined') {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (
            key &&
            (key.startsWith('ytp_i18n_cache_') ||
              key.startsWith('ytp_locale_cache_') ||
              key.startsWith(CACHE_CONFIG.storageKeyPrefix))
          ) {
            keysToRemove.push(key);
          }
        }
        for (const k of keysToRemove) {
          localStorage.removeItem(k);
        }
      }
    } catch (_e) {
      /* ignore storage errors */
    }
  }

  /**
   * @returns {{
   *   size: number,
   *   currentLanguage: string,
   *   availableLanguages: string[],
   *   translationsLoaded: number,
   *   fallbackLoaded: number
   * }}
   */
  function getCacheStats() {
    return {
      size: translationCache.size,
      currentLanguage,
      availableLanguages: getAvailableLanguages(),
      translationsLoaded: Object.keys(translations).length,
      fallbackLoaded: Object.keys(fallbackTranslationsEn).length,
    };
  }

  /**
   * @returns {{
   *   currentLanguage: string,
   *   translationCount: number,
   *   fallbackCount: number,
   *   cacheSize: number,
   *   availableLanguages: string[],
   *   ready: boolean,
   *   isFallback: boolean,
   *   isStale: boolean,
   *   localeStatus: Object
   * }}
   */
  function getStats() {
    const status = getLocaleDeliveryStatus_(currentLanguage);
    return {
      currentLanguage,
      translationCount: Object.keys(translations).length,
      fallbackCount: Object.keys(fallbackTranslationsEn).length,
      cacheSize: translationCache.size,
      availableLanguages: getAvailableLanguages(),
      ready: isReady(),
      isFallback: status.isFallback,
      isStale: status.isStale,
      localeStatus: status,
    };
  }

  function isReady() {
    return activeLanguageLoading === null && Object.keys(translations).length > 0;
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async function initialize() {
    currentLanguage = detectLanguage();
    logger?.debug?.(
      'i18n',
      `Detected language: ${currentLanguage} (${LANGUAGE_NAMES[currentLanguage] || currentLanguage})`
    );
    await loadTranslations();
    emitI18nEvent('youtube-plus-i18n-ready', { language: currentLanguage });
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} I18nAPI
   * @property {(key: string, params?: TranslationParams) => string} t
   * @property {(key: string, params?: TranslationParams) => string} translate
   * @property {() => string} getLanguage
   * @property {(lang: string) => Promise<boolean>} setLanguage
   * @property {() => string} detectLanguage
   * @property {() => Record<string, string>} getAllTranslations
   * @property {() => string[]} getAvailableLanguages
   * @property {(key: string) => boolean} hasTranslation
   * @property {(key: string, value: string) => void} addTranslation
   * @property {(translations: TranslationDictionary) => void} addTranslations
   * @property {(cb: (newLang: string, oldLang: string) => void) => () => void} onLanguageChange
   * @property {(num: number, options?: Object) => string} formatNumber
   * @property {(date: Date|number|string, options?: Object) => string} formatDate
   * @property {(count: number, singular: string, plural: string, few?: string) => string} pluralize
   * @property {() => void} clearCache
   * @property {() => Object} getCacheStats
   * @property {() => Object} getStats
   * @property {(lang?: string) => Object} getLocaleStatus
   * @property {() => boolean} isReady
   * @property {() => Promise<boolean>} loadTranslations
   * @property {() => Promise<void>} initialize
   * @property {Record<string, string>} translations
   * @property {string} currentLanguage
   */

  /** @type {I18nAPI & { [k: string]: unknown }} */
  const i18nAPI = {
    t: translate,
    translate,
    getLanguage,
    setLanguage,
    detectLanguage,
    getAllTranslations,
    getAvailableLanguages,
    hasTranslation,
    addTranslation,
    addTranslations,
    onLanguageChange,
    formatNumber,
    formatDate,
    pluralize,
    clearCache,
    getCacheStats,
    getStats,
    getLocaleStatus: getLocaleDeliveryStatus_,
    isReady,
    loadTranslations,
    initialize,
    _fetchJSON: fetchJSON,
    /** @type {Record<string, string>} */
    get translations() {
      return { ...translations };
    },
    get currentLanguage() {
      return currentLanguage;
    },
  };

  if (typeof window !== 'undefined') {
    window.YouTubePlusI18n = i18nAPI;

    // Page-realm bridge: Tabview renders its tab rail in the page window, which
    // cannot reach the sandbox i18n object. Expose a read-only translator there
    // so the page realm's window.YouTubePlusI18n.t(...) resolves real labels
    // instead of its English fallback.
    const pageWin = getPageWindow_();
    if (pageWin && pageWin !== window) {
      pageWin.YouTubePlusI18n = {
        t: (
          /** @type {string} */ key,
          /** @type {Record<string, string | number>} */ params = {}
        ) => i18nAPI.t(key, params),
        getLanguage: () => i18nAPI.getLanguage(),
      };
    }

    // Back-compat shim for the legacy loader namespace. Ownership
    // is YouTubePlusI18n; this is kept only so any code that referenced
    // YouTubePlusI18nLoader directly continues to work.
    window.YouTubePlusI18nLoader = {
      // Runtime accepts an omitted lang (falls back to 'en' via the
      // AVAILABLE_LANGUAGES check); widen only at this shim boundary.
      loadTranslations: /** @type {(lang?: string) => Promise<Record<string, string>>} */ (
        loadTranslationsFromLoader
      ),
    };
    Object.freeze(window.YouTubePlusI18n);
    if (window.YouTubePlusI18nLoader) {
      Object.freeze(window.YouTubePlusI18nLoader);
    }
  }

  // Note: we deliberately do NOT mutate window.YouTubeUtils here.
  // utils.js is the compatibility facade and already wires
  // t/getLanguage/i18n on YouTubeUtils, deferring to this module.

  initialize().then(() => {
    logger?.debug?.('i18n', 'i18n system initialized successfully');
  });
})();
