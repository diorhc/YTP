/**
 * YouTube+ Internationalization (i18n) — canonical translation service.
 *
 * Responsibilities:
 *   - Translation lookup with parameter interpolation.
 *   - Embedded / CDN-backed translation loading.
 *   - Language detection (YouTube HTML lang, hl param, ytcfg, browser).
 *   - Language change subscriptions (in-process + window CustomEvent).
 *   - Locale-aware number / date / plural formatting.
 *
 * Public surface (canonical):
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
 *   - Mutating window.YouTubeUtils: utils.js is the canonical compatibility
 *     facade and already exposes t / getLanguage on YouTubeUtils.
 */
(function () {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const GITHUB_CONFIG = {
    owner: 'diorhc',
    repo: 'YTP',
    branch: 'main',
    basePath: 'locales',
  };

  const CDN_URLS = {
    github: `https://raw.githubusercontent.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/${GITHUB_CONFIG.branch}/${GITHUB_CONFIG.basePath}`,
    jsdelivr: `https://cdn.jsdelivr.net/gh/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}@${GITHUB_CONFIG.branch}/${GITHUB_CONFIG.basePath}`,
  };

  // Translation files shipped with the project (and embedded by
  // embed-translations.js). Any other YouTube UI language will map to the
  // closest language below (usually English).
  const AVAILABLE_LANGUAGES = [
    'en',
    'ru',
    'ko',
    'fr',
    'nl',
    'zh-CN',
    'zh-TW',
    'ja',
    'tr',
    'es',
    'pt',
    'de',
    'it',
    'pl',
    'uk',
    'ar',
    'hi',
    'id',
    'vi',
    'uz',
    'kk',
    'ky',
    'be',
    'bg',
    'az',
  ];

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
    // Canonical BCP 47 aliases
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
  const logger =
    /** @type {any} */ (window).YouTubePlusLogger ||
    /** @type {any} */ (window).YouTubeUtils?.logger ||
    null;

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
  /** @type {Promise<any> | null} */
  let loadingPromise = null;

  // ---------------------------------------------------------------------------
  // Loader (embedded / GitHub / jsDelivr)
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
      return JSON.parse(String(responseText || '{}'));
    }

    const response = await fetch(url, {
      cache: 'default',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /**
   * @param {string} lang
   * @returns {Promise<Record<string, string>>}
   */
  async function fetchTranslation(lang) {
    // Fast local fallback first.
    try {
      if (typeof window !== 'undefined' && window.YouTubePlusEmbeddedTranslations) {
        const embedded = window.YouTubePlusEmbeddedTranslations[lang];
        if (embedded) {
          logger?.debug?.('i18n', `Using embedded translations for ${lang}`);
          return /** @type {Record<string, string>} */ (embedded);
        }
      }
    } catch (e) {
      logger?.warn?.('i18n', 'Error reading embedded translations', e);
    }

    // Try raw GitHub first; fall back to jsDelivr with cache-bust.
    try {
      const rawUrl = `${CDN_URLS.github}/${lang}.json`;
      return await fetchJSON(rawUrl);
    } catch (firstErr) {
      try {
        const cdnUrl = `${CDN_URLS.jsdelivr}/${lang}.json?_=${Date.now()}`;
        logger?.warn?.('i18n', `Raw GitHub fetch failed, trying jsDelivr: ${cdnUrl}`);
        return await fetchJSON(cdnUrl);
      } catch (err) {
        logger?.error?.('i18n', `Failed to fetch translations for ${lang}`, {
          err,
          firstErr,
        });
        throw err;
      }
    }
  }

  /**
   * Validate and sanitize translation data to prevent prototype pollution or non-string values.
   * @param {unknown} data
   * @returns {Record<string, string>}
   */
  function validateTranslations(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Invalid translation data: expected an object');
    }
    /** @type {Record<string, string>} */
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        throw new Error('Invalid translation entry: key and value must be strings');
      }
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      clean[key] = value;
    }
    return clean;
  }

  /**
   * @param {string} lang
   * @returns {Promise<Record<string, string>>}
   */
  function loadTranslationsFromLoader(lang) {
    const languageCode = AVAILABLE_LANGUAGES.includes(lang) ? lang : 'en';
    const cached = translationsCache.get(languageCode);
    if (cached) {
      return Promise.resolve(cached);
    }
    const inflight = loadingPromises.get(languageCode);
    if (inflight) return inflight;

    const loadPromise = (async () => {
      try {
        const rawData = await fetchTranslation(languageCode);
        const data = validateTranslations(rawData);
        // Sanity check: warn if common UI keys are missing.
        try {
          /** @type {string[]} */
          const missing = [];
          for (const k of ['loading', 'fetching']) {
            if (!Object.hasOwn(data, k)) missing.push(k);
          }
          if (missing.length > 0) {
            logger?.warn?.(
              'i18n',
              `Translations for ${languageCode} missing keys: ${missing.join(', ')} (source may be stale)`
            );
          }
        } catch (_e) {
          /* ignore sanity-check errors */
        }
        translationsCache.set(languageCode, data);
        loadingPromises.delete(languageCode);
        return data;
      } catch (error) {
        loadingPromises.delete(languageCode);
        if (languageCode !== 'en') return loadTranslationsFromLoader('en');
        throw error;
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
    try {
      const ytLang =
        document.documentElement.lang || window.YouTubeUtils?.$?.('html')?.getAttribute('lang');
      if (ytLang) return mapToSupportedLanguage(ytLang);

      try {
        const urlParams = new URLSearchParams(window.location.search);
        const hlParam = urlParams.get('hl');
        if (hlParam) return mapToSupportedLanguage(hlParam);
      } catch {
        /* empty */
      }

      try {
        const ytConfig = window.ytcfg || window.yt?.config_;
        if (ytConfig && typeof ytConfig.get === 'function') {
          const hl = ytConfig.get('HL') || ytConfig.get('GAPI_LOCALE');
          if (hl) return mapToSupportedLanguage(hl);
        }
      } catch {
        /* empty */
      }

      const browserLang = navigator.language || /** @type {any} */ (navigator).userLanguage || 'en';
      return mapToSupportedLanguage(browserLang);
    } catch (error) {
      logger?.error?.('i18n', 'Error detecting language', error);
      return 'en';
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle events
  // ---------------------------------------------------------------------------

  /**
   * @param {any} detail
   * @returns {any}
   */
  const toStructuredCloneSafeDetail = detail => {
    if (detail == null || typeof detail !== 'object') return detail;
    try {
      const clone = /** @type {any} */ (globalThis)?.structuredClone;
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
   * @param {string} name
   * @param {Object} [detail]
   */
  function emitI18nEvent(name, detail = {}) {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: toStructuredCloneSafeDetail(detail) }));
    } catch (_e) {
      try {
        window.dispatchEvent(new Event(name));
      } catch {
        /* no-op */
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Translation core
  // ---------------------------------------------------------------------------

  /**
   * @param {unknown} text
   * @param {Record<string, any>} params
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
   * Translate a key with optional placeholders.
   * @param {string} key - Translation key
   * @param {Record<string, any>} [params] - Interpolation parameters
   * @returns {string}
   */
  function translate(key, params = {}) {
    if (typeof key !== 'string' || !key) return key == null ? '' : String(key);

    const safeParams = params && typeof params === 'object' ? params : {};
    const keys = Object.keys(safeParams);

    // Fast path: parameterless translations
    if (keys.length === 0) {
      if (translationCache.has(key)) {
        return translationCache.get(key) ?? key;
      }
      const { text, found } = resolveKey(key);
      const result = found ? text : key;
      if (
        !found &&
        Object.keys(translations).length > 0 &&
        Object.keys(fallbackTranslationsEn).length > 0
      ) {
        logger?.warn?.('i18n', `Missing translation for key: ${key}`);
      }
      translationCache.set(key, result);
      return result;
    }

    // Slow path: parameterized translations (build flat stable key instead of JSON.stringify)
    let paramPart = '';
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      paramPart += `${k}:${safeParams[k]};`;
    }
    const cacheKey = `${key}:${paramPart}`;

    if (translationCache.has(cacheKey)) {
      return translationCache.get(cacheKey) ?? key;
    }

    const { text, found } = resolveKey(key);
    let result;

    if (found) {
      result = interpolate(text, safeParams);
    } else {
      if (Object.keys(translations).length > 0 && Object.keys(fallbackTranslationsEn).length > 0) {
        logger?.warn?.('i18n', `Missing translation for key: ${key}`);
      }
      result = interpolate(key, safeParams);
    }

    translationCache.set(cacheKey, result);
    return result;
  }

  /**
   * @returns {Promise<boolean>}
   */
  async function loadTranslations() {
    if (loadingPromise) {
      await loadingPromise;
      return true;
    }

    loadingPromise = (async () => {
      try {
        logger?.debug?.('i18n', `Loading translations for ${currentLanguage}...`);
        translations = /** @type {Record<string, string>} */ (
          await loadTranslationsFromLoader(currentLanguage)
        );

        // Ensure English fallback is available.
        if (!fallbackTranslationsEn || Object.keys(fallbackTranslationsEn).length === 0) {
          try {
            const embeddedEn =
              typeof window !== 'undefined' &&
              window.YouTubePlusEmbeddedTranslations &&
              window.YouTubePlusEmbeddedTranslations.en;
            if (embeddedEn && typeof embeddedEn === 'object') {
              fallbackTranslationsEn = /** @type {Record<string, string>} */ (embeddedEn);
            } else {
              fallbackTranslationsEn = /** @type {Record<string, string>} */ (
                await loadTranslationsFromLoader('en')
              );
            }
          } catch (_e) {
            fallbackTranslationsEn = {};
          }
        }
        translationCache.clear();
        logger?.debug?.(
          'i18n',
          `Loaded ${Object.keys(translations).length} translations for ${currentLanguage}`
        );
        return true;
      } catch (error) {
        logger?.error?.('i18n', 'Failed to load translations', error);
        if (currentLanguage !== 'en') {
          currentLanguage = 'en';
          return loadTranslations();
        }
        return false;
      } finally {
        loadingPromise = null;
      }
    })();

    return loadingPromise;
  }

  /**
   * @returns {string}
   */
  function getLanguage() {
    return currentLanguage;
  }

  /**
   * @param {string} lang
   * @returns {Promise<boolean>}
   */
  async function setLanguage(lang) {
    if (lang === currentLanguage) return true;

    const oldLang = currentLanguage;
    currentLanguage = lang;

    try {
      const success = await loadTranslations();
      if (success) {
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
      }
      return success;
    } catch (error) {
      logger?.error?.('i18n', 'Failed to change language', error);
      currentLanguage = oldLang; // revert
      return false;
    }
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
   * @param {Record<string, any>} newTranslations
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
   * @param {number} num
   * @param {Object} [options]
   * @returns {string}
   */
  function formatNumber(num, options = {}) {
    try {
      const lang = getLanguage();
      const locale = LOCALE_FOR_LANG[lang] || 'en-US';
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
      const lang = getLanguage();
      const locale = LOCALE_FOR_LANG[lang] || 'en-US';
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
   *   ready: boolean
   * }}
   */
  function getStats() {
    return {
      currentLanguage,
      translationCount: Object.keys(translations).length,
      fallbackCount: Object.keys(fallbackTranslationsEn).length,
      cacheSize: translationCache.size,
      availableLanguages: getAvailableLanguages(),
      ready: isReady(),
    };
  }

  function isReady() {
    return loadingPromise === null && Object.keys(translations).length > 0;
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async function initialize() {
    try {
      currentLanguage = detectLanguage();
      logger?.debug?.(
        'i18n',
        `Detected language: ${currentLanguage} (${LANGUAGE_NAMES[currentLanguage] || currentLanguage})`
      );
      await loadTranslations();
      emitI18nEvent('youtube-plus-i18n-ready', { language: currentLanguage });
    } catch (error) {
      logger?.error?.('i18n', 'Initialization error', error);
      currentLanguage = 'en';
    }
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} I18nAPI
   * @property {(key: string, params?: Record<string, any>) => string} t
   * @property {(key: string, params?: Record<string, any>) => string} translate
   * @property {() => string} getLanguage
   * @property {(lang: string) => Promise<boolean>} setLanguage
   * @property {() => string} detectLanguage
   * @property {() => Record<string, string>} getAllTranslations
   * @property {() => string[]} getAvailableLanguages
   * @property {(key: string) => boolean} hasTranslation
   * @property {(key: string, value: string) => void} addTranslation
   * @property {(translations: Record<string, any>) => void} addTranslations
   * @property {(cb: (newLang: string, oldLang: string) => void) => () => void} onLanguageChange
   * @property {(num: number, options?: Object) => string} formatNumber
   * @property {(date: Date|number|string, options?: Object) => string} formatDate
   * @property {(count: number, singular: string, plural: string, few?: string) => string} pluralize
   * @property {() => void} clearCache
   * @property {() => Object} getCacheStats
   * @property {() => Object} getStats
   * @property {() => boolean} isReady
   * @property {() => Promise<boolean>} loadTranslations
   * @property {() => Promise<void>} initialize
   * @property {Record<string, string>} translations
   * @property {string} currentLanguage
   */

  /** @type {I18nAPI & { [k: string]: any }} */
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
    isReady,
    loadTranslations,
    initialize,
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
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusI18n = i18nAPI;
    }

    // Back-compat shim for the legacy loader namespace. Canonical ownership
    // is YouTubePlusI18n; this is kept only so any code that referenced
    // YouTubePlusI18nLoader directly continues to work.
    window.YouTubePlusI18nLoader = {
      loadTranslations: loadTranslationsFromLoader,
      AVAILABLE_LANGUAGES,
      LANGUAGE_NAMES,
      CDN_URLS,
    };
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusI18nLoader = window.YouTubePlusI18nLoader;
    }
    Object.freeze(window.YouTubePlusI18n);
    if (window.YouTubePlusI18nLoader) {
      Object.freeze(window.YouTubePlusI18nLoader);
    }
  }

  // Note: we deliberately do NOT mutate window.YouTubeUtils here.
  // utils.js is the canonical compatibility facade and already wires
  // t/getLanguage/i18n on YouTubeUtils, deferring to this module.

  initialize().then(() => {
    logger?.debug?.('i18n', 'i18n system initialized successfully');
  });
})();
