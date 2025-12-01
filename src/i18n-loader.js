/* YouTube+ i18n Loader */
(function () {
  'use strict';
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
  const AVAILABLE_LANGUAGES = ['en', 'ru', 'kr', 'fr', 'du', 'cn', 'tw', 'jp', 'tr'];
  const LANGUAGE_NAMES = {
    en: 'English',
    ru: 'Русский',
    kr: '한국어',
    fr: 'Français',
    du: 'Nederlands',
    cn: '简体中文',
    tw: '繁體中文',
    jp: '日本語',
    tr: 'Türkçe',
  };
  const translationsCache = new Map();
  const loadingPromises = new Map();
  // Optional embedded translations (useful for userscripts or offline builds)
  // Projects can set `window.YouTubePlusEmbeddedTranslations = { en: {...}, ru: {...} }`
  // to avoid remote fetches.
  async function fetchTranslation(lang) {
    // Use embedded translations if available (fast local fallback)
    try {
      if (typeof window !== 'undefined' && window.YouTubePlusEmbeddedTranslations) {
        const embedded = window.YouTubePlusEmbeddedTranslations[lang];
        if (embedded) {
          console.log('[YouTube+][i18n-loader]', `Using embedded translations for ${lang}`);
          return embedded;
        }
      }
    } catch (e) {
      // ignore and continue to network fetch
      console.warn('[YouTube+][i18n-loader]', 'Error reading embedded translations', e);
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
      // Try GitHub raw as fallback and log the error for easier debugging
      try {
        const url = `${CDN_URLS.github}/${lang}.json`;
        console.warn('[YouTube+][i18n-loader]', `Primary CDN failed, trying GitHub raw: ${url}`);
        const response = await fetch(url, {
          cache: 'default',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        console.error('[YouTube+][i18n-loader]', `Failed to fetch translations for ${lang}:`, err);
        throw err;
      }
    }
  }
  async function loadTranslations(lang) {
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
        if (languageCode !== 'en') return loadTranslations('en');
        throw error;
      }
    })();
    loadingPromises.set(languageCode, loadPromise);
    return loadPromise;
  }
  const i18nLoaderAPI = { loadTranslations, AVAILABLE_LANGUAGES, LANGUAGE_NAMES, CDN_URLS };
  if (typeof window !== 'undefined') window.YouTubePlusI18nLoader = i18nLoaderAPI;
  console.log('[YouTube+][i18n-loader] initialized');
})();
