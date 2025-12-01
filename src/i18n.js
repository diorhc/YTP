/**
 * YouTube+ Internationalization (i18n) System - v3.0
 * Динамическая система переводов с загрузкой из внешних JSON файлов
 * @module i18n
 * @version 3.0
 */

(function () {
  'use strict';

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

  // Language mapping for common locale codes
  const languageMap = {
    ko: 'kr', // Korean
    'ko-kr': 'kr',
    fr: 'fr', // French
    'fr-fr': 'fr',
    nl: 'du', // Dutch
    'nl-nl': 'du',
    'nl-be': 'du',
    zh: 'cn', // Chinese Simplified (default)
    'zh-cn': 'cn',
    'zh-hans': 'cn',
    'zh-tw': 'tw', // Chinese Traditional
    'zh-hk': 'tw',
    'zh-hant': 'tw',
    ja: 'jp', // Japanese
    'ja-jp': 'jp',
    tr: 'tr', // Turkish
    'tr-tr': 'tr',
  };

  /**
   * Detect user's language preference
   * @returns {string} Language code
   */
  function detectLanguage() {
    try {
      // Try YouTube's language setting first
      const ytLang =
        document.documentElement.lang || document.querySelector('html')?.getAttribute('lang');
      if (ytLang) {
        const mapped = languageMap[ytLang.toLowerCase()] || ytLang.toLowerCase().substr(0, 2);
        if (window.YouTubePlusI18nLoader?.AVAILABLE_LANGUAGES.includes(mapped)) {
          return mapped;
        }
      }

      // Fallback to browser language
      const browserLang = navigator.language || navigator.userLanguage || 'en';
      const mapped = languageMap[browserLang.toLowerCase()] || browserLang.split('-')[0];

      if (window.YouTubePlusI18nLoader?.AVAILABLE_LANGUAGES.includes(mapped)) {
        return mapped;
      }

      return 'en'; // Default fallback
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
    if (!window.YouTubePlusI18nLoader) {
      console.error('[YouTube+][i18n]', 'i18n-loader not available');
      return false;
    }

    if (loadingPromise) {
      await loadingPromise;
      return true;
    }

    loadingPromise = (async () => {
      try {
        console.log('[YouTube+][i18n]', `Loading translations for ${currentLanguage}...`);
        translations = await window.YouTubePlusI18nLoader.loadTranslations(currentLanguage);
        translationCache.clear(); // Clear cache on new load
        console.log(
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

    // Fallback to key if not found
    if (!text) {
      // Only warn if translations have been loaded and key is still missing
      if (Object.keys(translations).length > 0) {
        console.warn('[YouTube+][i18n]', `Missing translation for key: ${key}`);
      }
      text = key;
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
    return window.YouTubePlusI18nLoader?.AVAILABLE_LANGUAGES || ['en'];
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

      // Wait for i18n-loader to be available
      let attempts = 0;
      while (!window.YouTubePlusI18nLoader && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (!window.YouTubePlusI18nLoader) {
        console.error('[YouTube+][i18n]', 'i18n-loader not available after waiting');
        return;
      }

      const languageNames = window.YouTubePlusI18nLoader.LANGUAGE_NAMES;
      console.log(
        '[YouTube+][i18n]',
        `Detected language: ${currentLanguage} (${languageNames[currentLanguage] || currentLanguage})`
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
    console.log('[YouTube+][i18n]', 'i18n system initialized successfully');
  });
})();
