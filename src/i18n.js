/**
 * YouTube+ Internationalization (i18n) System - v3.2
 * Unified i18n system with integrated loader
 * Supports all major YouTube interface languages
 * @module i18n
 * @version 3.2
 */

(function () {
  'use strict';

  // ============================================================================
  // I18N LOADER (merged from i18n-loader.js)
  // ============================================================================

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

  // Translation files shipped with the project (and embedded by embed-translations.js).
  // Any other YouTube UI language will map to the closest language below (usually English).
  const AVAILABLE_LANGUAGES = [
    'en',
    'ru',
    'kr',
    'fr',
    'du',
    'cn',
    'tw',
    'jp',
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
  ];

  // Complete language names mapping for all YouTube supported languages
  const LANGUAGE_NAMES = {
    // Primary supported languages
    en: 'English',
    ru: 'Русский',
    kr: '한국어',
    fr: 'Français',
    du: 'Nederlands',
    cn: '简体中文',
    tw: '繁體中文',
    jp: '日本語',
    tr: 'Türkçe',
    // European languages
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
    // Middle Eastern & African languages
    ar: 'العربية',
    he: 'עברית',
    fa: 'فارسی',
    sw: 'Kiswahili',
    zu: 'isiZulu',
    af: 'Afrikaans',
    am: 'አማርኛ',
    // Asian languages
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
    // Central Asian & Caucasus languages
    az: 'Azərbaycanca',
    be: 'Беларуская',
    hy: 'Հայերեն',
    ka: 'ქართული',
    kk: 'Қазақ',
    ky: 'Кыргызча',
    mn: 'Монгол',
    tg: 'Тоҷикӣ',
    uz: 'Oʻzbekcha',
  };

  // Language fallback mapping - maps YouTube locale variants to shipped translation files
  const LANGUAGE_FALLBACKS = {
    // Spanish variants
    es: 'es',
    'es-es': 'es',
    'es-mx': 'es',
    'es-419': 'es',
    // Portuguese variants
    pt: 'pt',
    'pt-br': 'pt',
    'pt-pt': 'pt',
    // German variants
    de: 'de',
    'de-de': 'de',
    'de-at': 'de',
    'de-ch': 'de',
    // Italian
    it: 'it',
    // Polish
    pl: 'pl',
    // Ukrainian - fallback to Russian
    uk: 'uk',
    'uk-ua': 'uk',
    // Arabic variants
    ar: 'ar',
    'ar-sa': 'ar',
    'ar-ae': 'ar',
    'ar-eg': 'ar',
    // Hindi
    hi: 'hi',
    'hi-in': 'hi',
    // Thai
    th: 'en',
    'th-th': 'en',
    // Vietnamese
    vi: 'vi',
    'vi-vn': 'vi',
    // Indonesian/Malay
    id: 'id',
    'id-id': 'id',
    ms: 'en',
    'ms-my': 'en',
    // Scandinavian languages
    sv: 'en',
    'sv-se': 'en',
    no: 'en',
    'nb-no': 'en',
    'nn-no': 'en',
    da: 'en',
    'da-dk': 'en',
    fi: 'en',
    'fi-fi': 'en',
    // Central European languages
    cs: 'en',
    'cs-cz': 'en',
    sk: 'en',
    'sk-sk': 'en',
    hu: 'en',
    'hu-hu': 'en',
    ro: 'en',
    'ro-ro': 'en',
    // Balkan languages
    bg: 'ru',
    'bg-bg': 'ru',
    hr: 'en',
    'hr-hr': 'en',
    sr: 'ru',
    'sr-rs': 'ru',
    sl: 'en',
    'sl-si': 'en',
    // Greek
    el: 'en',
    'el-gr': 'en',
    // Hebrew
    he: 'en',
    'he-il': 'en',
    iw: 'en',
    // Persian
    fa: 'en',
    'fa-ir': 'en',
    // Indian languages
    bn: 'en',
    'bn-in': 'en',
    ta: 'en',
    'ta-in': 'en',
    te: 'en',
    'te-in': 'en',
    mr: 'en',
    'mr-in': 'en',
    gu: 'en',
    'gu-in': 'en',
    kn: 'en',
    'kn-in': 'en',
    ml: 'en',
    'ml-in': 'en',
    pa: 'en',
    'pa-in': 'en',
    // Southeast Asian
    fil: 'en',
    'fil-ph': 'en',
    tl: 'en',
    km: 'en',
    lo: 'en',
    my: 'en',
    ne: 'en',
    si: 'en',
    // African languages
    sw: 'en',
    'sw-ke': 'en',
    zu: 'en',
    af: 'en',
    am: 'en',
    // Central Asian
    az: 'tr',
    'az-az': 'tr',
    be: 'ru',
    'be-by': 'ru',
    hy: 'ru',
    ka: 'en',
    kk: 'ru',
    'kk-kz': 'ru',
    ky: 'ru',
    mn: 'ru',
    tg: 'ru',
    uz: 'ru',
    // Baltic languages
    lt: 'en',
    'lt-lt': 'en',
    lv: 'en',
    'lv-lv': 'en',
    et: 'en',
    'et-ee': 'en',
    // Others
    mk: 'ru',
    sq: 'en',
    bs: 'en',
    is: 'en',
    ca: 'es',
    eu: 'es',
    gl: 'es',
  };

  const translationsCache = new Map();
  const loadingPromises = new Map();

  /**
   * Fetch translation from CDN or embedded source
   * @param {string} lang - Language code
   * @returns {Promise<Object>} Translation object
   */
  async function fetchTranslation(lang) {
    // Use embedded translations if available (fast local fallback)
    try {
      if (typeof window !== 'undefined' && window.YouTubePlusEmbeddedTranslations) {
        const embedded = window.YouTubePlusEmbeddedTranslations[lang];
        if (embedded) {
          window.YouTubeUtils &&
            YouTubeUtils.logger &&
            YouTubeUtils.logger.debug &&
            YouTubeUtils.logger.debug(
              '[YouTube+][i18n]',
              `Using embedded translations for ${lang}`
            );
          return embedded;
        }
      }
    } catch (e) {
      console.warn('[YouTube+][i18n]', 'Error reading embedded translations', e);
    }

    try {
      const url = `${CDN_URLS.jsdelivr}/${lang}.json`;
      const response = await fetch(url, {
        cache: 'default',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch {
      try {
        const url = `${CDN_URLS.github}/${lang}.json`;
        console.warn('[YouTube+][i18n]', `Primary CDN failed, trying GitHub raw: ${url}`);
        const response = await fetch(url, {
          cache: 'default',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        console.error('[YouTube+][i18n]', `Failed to fetch translations for ${lang}:`, err);
        throw err;
      }
    }
  }

  /**
   * Load translations for a language (with caching)
   * @param {string} lang - Language code
   * @returns {Promise<Object>} Translation object
   */
  function loadTranslationsFromLoader(lang) {
    const languageCode = AVAILABLE_LANGUAGES.includes(lang) ? lang : 'en';
    if (translationsCache.has(languageCode)) return translationsCache.get(languageCode);
    if (loadingPromises.has(languageCode)) return loadingPromises.get(languageCode);

    const loadPromise = (async () => {
      try {
        const translations = await fetchTranslation(languageCode);
        translationsCache.set(languageCode, translations);
        loadingPromises.delete(languageCode);
        return translations;
      } catch (error) {
        loadingPromises.delete(languageCode);
        if (languageCode !== 'en') return loadTranslationsFromLoader('en');
        throw error;
      }
    })();

    loadingPromises.set(languageCode, loadPromise);
    return loadPromise;
  }

  // ============================================================================
  // I18N CORE SYSTEM
  // ============================================================================

  /**
   * Current language
   * @type {string}
   */
  let currentLanguage = 'en';

  /**
   * Loaded translations for current language
   * @type {Object}
   */
  let translations = {};

  /**
   * English fallback translations (loaded once).
   * @type {Object}
   */
  let fallbackTranslationsEn = {};

  /**
   * Translation cache
   * @type {Map<string, string>}
   */
  const translationCache = new Map();

  /**
   * Language change listeners
   * @type {Set<Function>}
   */
  const languageChangeListeners = new Set();

  /**
   * Loading state
   * @type {Promise|null}
   */
  let loadingPromise = null;

  // Language mapping for common locale codes - extended to support all YouTube languages
  const languageMap = {
    // Korean
    ko: 'kr',
    'ko-kr': 'kr',
    // French
    fr: 'fr',
    'fr-fr': 'fr',
    'fr-ca': 'fr',
    'fr-be': 'fr',
    'fr-ch': 'fr',
    // Dutch
    nl: 'du',
    'nl-nl': 'du',
    'nl-be': 'du',
    // Chinese
    zh: 'cn',
    'zh-cn': 'cn',
    'zh-hans': 'cn',
    'zh-sg': 'cn',
    'zh-tw': 'tw',
    'zh-hk': 'tw',
    'zh-hant': 'tw',
    // Japanese
    ja: 'jp',
    'ja-jp': 'jp',
    // Turkish
    tr: 'tr',
    'tr-tr': 'tr',
    // Russian
    ru: 'ru',
    'ru-ru': 'ru',
    // English variants
    en: 'en',
    'en-us': 'en',
    'en-gb': 'en',
    'en-au': 'en',
    'en-ca': 'en',
    'en-in': 'en',
    // For languages with fallbacks, use the fallback
    ...Object.fromEntries(
      Object.entries(LANGUAGE_FALLBACKS).map(([key, fallback]) => [key, fallback])
    ),
  };

  /**
   * Check if a language code maps to a primary supported language
   * @param {string} langCode - Language code to check
   * @returns {string} Mapped language code
   */
  function mapToSupportedLanguage(langCode) {
    const lower = langCode.toLowerCase();

    // Direct match in language map
    if (languageMap[lower]) {
      return languageMap[lower];
    }

    // Direct match in shipped translations
    if (AVAILABLE_LANGUAGES.includes(lower)) {
      return lower;
    }

    // Check first two characters
    const shortCode = lower.substr(0, 2);
    if (languageMap[shortCode]) {
      return languageMap[shortCode];
    }

    if (AVAILABLE_LANGUAGES.includes(shortCode)) {
      return shortCode;
    }

    // Check fallbacks
    if (LANGUAGE_FALLBACKS[lower]) {
      return LANGUAGE_FALLBACKS[lower];
    }
    if (LANGUAGE_FALLBACKS[shortCode]) {
      return LANGUAGE_FALLBACKS[shortCode];
    }

    // Default to English
    return 'en';
  }

  /**
   * Detect user's language preference with extended support
   * @returns {string} Language code
   */
  function detectLanguage() {
    try {
      // Try YouTube's language setting first (from HTML lang attribute)
      const ytLang =
        document.documentElement.lang || document.querySelector('html')?.getAttribute('lang');
      if (ytLang) {
        const mapped = mapToSupportedLanguage(ytLang);
        return mapped;
      }

      // Try YouTube's hl parameter from URL
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const hlParam = urlParams.get('hl');
        if (hlParam) {
          const mapped = mapToSupportedLanguage(hlParam);
          return mapped;
        }
      } catch {}

      // Try to get YouTube's internal language setting
      try {
        const ytConfig = window.ytcfg || window.yt?.config_;
        if (ytConfig && typeof ytConfig.get === 'function') {
          const hl = ytConfig.get('HL') || ytConfig.get('GAPI_LOCALE');
          if (hl) {
            const mapped = mapToSupportedLanguage(hl);
            return mapped;
          }
        }
      } catch {}

      // Fallback to browser language
      const browserLang = navigator.language || navigator.userLanguage || 'en';
      const mapped = mapToSupportedLanguage(browserLang);

      return mapped;
    } catch (error) {
      console.error('[YouTube+][i18n]', 'Error detecting language:', error);
      return 'en';
    }
  }

  /**
   * Load translations for current language
   * @returns {Promise<boolean>} Success status
   */
  async function loadTranslations() {
    if (loadingPromise) {
      await loadingPromise;
      return true;
    }

    loadingPromise = (async () => {
      try {
        window.YouTubeUtils &&
          YouTubeUtils.logger &&
          YouTubeUtils.logger.debug &&
          YouTubeUtils.logger.debug(
            '[YouTube+][i18n]',
            `Loading translations for ${currentLanguage}...`
          );
        translations = await loadTranslationsFromLoader(currentLanguage);
        // Ensure we always have English fallback available (best-effort).
        if (!fallbackTranslationsEn || Object.keys(fallbackTranslationsEn).length === 0) {
          try {
            fallbackTranslationsEn = await loadTranslationsFromLoader('en');
          } catch {
            fallbackTranslationsEn = {};
          }
        }
        translationCache.clear(); // Clear cache on new load
        window.YouTubeUtils &&
          YouTubeUtils.logger &&
          YouTubeUtils.logger.debug &&
          YouTubeUtils.logger.debug(
            '[YouTube+][i18n]',
            `✓ Loaded ${Object.keys(translations).length} translations for ${currentLanguage}`
          );
        return true;
      } catch (error) {
        console.error('[YouTube+][i18n]', 'Failed to load translations:', error);
        // Use English as fallback
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
   * Translate a key with optional placeholders
   * @param {string} key - Translation key
   * @param {Object} [params] - Parameters to replace in translation
   * @returns {string} Translated string
   */
  function translate(key, params = {}) {
    // Check cache
    const cacheKey = `${key}:${JSON.stringify(params)}`;
    if (translationCache.has(cacheKey)) {
      return translationCache.get(cacheKey);
    }

    // Get translation
    let text = translations[key];

    // Fallback to English if current language misses the key
    if (!text) {
      const enText = fallbackTranslationsEn ? fallbackTranslationsEn[key] : undefined;
      if (enText) {
        text = enText;
      } else {
        // Only warn if translations have been loaded and key is still missing everywhere
        if (Object.keys(translations).length > 0) {
          console.warn('[YouTube+][i18n]', `Missing translation for key: ${key}`);
        }
        text = key;
      }
    }

    // Replace parameters
    if (Object.keys(params).length > 0) {
      Object.keys(params).forEach(param => {
        text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
      });
    }

    // Cache result
    translationCache.set(cacheKey, text);
    return text;
  }

  /**
   * Get current language
   * @returns {string} Language code
   */
  function getLanguage() {
    return currentLanguage;
  }

  /**
   * Set language and reload translations
   * @param {string} lang - Language code
   * @returns {Promise<boolean>} Success status
   */
  async function setLanguage(lang) {
    if (lang === currentLanguage) {
      return true;
    }

    const oldLang = currentLanguage;
    currentLanguage = lang;

    try {
      const success = await loadTranslations();
      if (success) {
        // Notify listeners
        languageChangeListeners.forEach(listener => {
          try {
            listener(currentLanguage, oldLang);
          } catch (error) {
            console.error('[YouTube+][i18n]', 'Error in language change listener:', error);
          }
        });
      }
      return success;
    } catch (error) {
      console.error('[YouTube+][i18n]', 'Failed to change language:', error);
      currentLanguage = oldLang; // Revert
      return false;
    }
  }

  /**
   * Get all translations for current language
   * @returns {Object} All translations
   */
  function getAllTranslations() {
    return { ...translations };
  }

  /**
   * Get available languages
   * @returns {string[]} Array of language codes
   */
  function getAvailableLanguages() {
    return AVAILABLE_LANGUAGES;
  }

  /**
   * Check if translation exists for key
   * @param {string} key - Translation key
   * @returns {boolean} True if exists
   */
  function hasTranslation(key) {
    return translations[key] !== undefined;
  }

  /**
   * Add translation dynamically
   * @param {string} key - Translation key
   * @param {string} value - Translation value
   */
  function addTranslation(key, value) {
    translations[key] = value;
    translationCache.clear(); // Clear cache
  }

  /**
   * Add translations for current language
   * @param {Object} newTranslations - Object with translations
   */
  function addTranslations(newTranslations) {
    Object.assign(translations, newTranslations);
    translationCache.clear(); // Clear cache
  }

  /**
   * Register language change listener
   * @param {Function} callback - Callback function(newLang, oldLang)
   */
  function onLanguageChange(callback) {
    languageChangeListeners.add(callback);
    return () => languageChangeListeners.delete(callback);
  }

  /**
   * Format numbers according to locale
   * @param {number} num - Number to format
   * @param {Object} [options] - Intl.NumberFormat options
   * @returns {string} Formatted number
   */
  function formatNumber(num, options = {}) {
    try {
      const lang = getLanguage();
      const localeMap = {
        ru: 'ru-RU',
        kr: 'ko-KR',
        fr: 'fr-FR',
        du: 'nl-NL',
        cn: 'zh-CN',
        tw: 'zh-TW',
        jp: 'ja-JP',
        tr: 'tr-TR',
      };
      const locale = localeMap[lang] || 'en-US';
      return new Intl.NumberFormat(locale, options).format(num);
    } catch (error) {
      console.error('[YouTube+][i18n]', 'Error formatting number:', error);
      return String(num);
    }
  }

  /**
   * Format date according to locale
   * @param {Date|number|string} date - Date to format
   * @param {Object} [options] - Intl.DateTimeFormat options
   * @returns {string} Formatted date
   */
  function formatDate(date, options = {}) {
    try {
      const lang = getLanguage();
      const localeMap = {
        ru: 'ru-RU',
        kr: 'ko-KR',
        fr: 'fr-FR',
        du: 'nl-NL',
        cn: 'zh-CN',
        tw: 'zh-TW',
        jp: 'ja-JP',
        tr: 'tr-TR',
      };
      const locale = localeMap[lang] || 'en-US';
      const dateObj = date instanceof Date ? date : new Date(date);
      return new Intl.DateTimeFormat(locale, options).format(dateObj);
    } catch (error) {
      console.error('[YouTube+][i18n]', 'Error formatting date:', error);
      return String(date);
    }
  }

  /**
   * Pluralize a word based on count and language
   * @param {number} count - Count value
   * @param {string} singular - Singular form
   * @param {string} plural - Plural form
   * @param {string} [few] - Few form (for Russian, etc.)
   * @returns {string} Appropriate form
   */
  function pluralize(count, singular, plural, few = null) {
    const lang = getLanguage();

    // Russian pluralization
    if (lang === 'ru' && few) {
      const mod10 = count % 10;
      const mod100 = count % 100;

      if (mod10 === 1 && mod100 !== 11) {
        return singular;
      }
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
        return few;
      }
      return plural;
    }

    // Default English-like pluralization
    return count === 1 ? singular : plural;
  }

  /**
   * Clear translation cache
   */
  function clearCache() {
    translationCache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  function getCacheStats() {
    return {
      size: translationCache.size,
      currentLanguage,
      availableLanguages: getAvailableLanguages(),
      translationsLoaded: Object.keys(translations).length,
    };
  }

  // Initialize
  async function initialize() {
    try {
      currentLanguage = detectLanguage();

      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.debug &&
        YouTubeUtils.logger.debug(
          '[YouTube+][i18n]',
          `Detected language: ${currentLanguage} (${LANGUAGE_NAMES[currentLanguage] || currentLanguage})`
        );

      // Load translations
      await loadTranslations();
    } catch (error) {
      console.error('[YouTube+][i18n]', 'Initialization error:', error);
      currentLanguage = 'en';
    }
  }

  // Export API
  const i18nAPI = {
    // Core functions
    t: translate,
    translate,
    getLanguage,
    setLanguage,
    detectLanguage,

    // Advanced functions
    getAllTranslations,
    getAvailableLanguages,
    hasTranslation,
    addTranslation,
    addTranslations,
    onLanguageChange,

    // Formatting functions
    formatNumber,
    formatDate,
    pluralize,

    // Cache management
    clearCache,
    getCacheStats,

    // Internal functions
    loadTranslations,
    initialize,
  };

  // Expose to window for global access
  if (typeof window !== 'undefined') {
    window.YouTubePlusI18n = i18nAPI;

    // Expose loader API for backward compatibility
    window.YouTubePlusI18nLoader = {
      loadTranslations: loadTranslationsFromLoader,
      AVAILABLE_LANGUAGES,
      LANGUAGE_NAMES,
      CDN_URLS,
    };

    // Also expose as part of YouTubeUtils if it exists
    if (window.YouTubeUtils) {
      window.YouTubeUtils.i18n = i18nAPI;
      window.YouTubeUtils.t = translate;
      window.YouTubeUtils.getLanguage = getLanguage;
    }
  }

  // Module export for ES6
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = i18nAPI;
  }

  // Auto-initialize
  initialize().then(() => {
    window.YouTubeUtils &&
      YouTubeUtils.logger &&
      YouTubeUtils.logger.debug &&
      YouTubeUtils.logger.debug('[YouTube+][i18n]', 'i18n system initialized successfully');
  });
})();
