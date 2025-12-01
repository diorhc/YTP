/**
 * Embed Translations into Build
 * This script embeds all translation files directly into the userscript
 * for immediate use without requiring CDN fetches
 */

const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, 'locales');
const buildFile = path.join(__dirname, 'youtube.user.js');

// Read all locale files
const locales = ['en', 'ru', 'kr', 'fr', 'du', 'cn', 'tw', 'jp', 'tr'];
const translations = {};

console.log('📦 Embedding translations into build...\n');

locales.forEach(lang => {
  const filePath = path.join(localesDir, `${lang}.json`);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    translations[lang] = JSON.parse(content);
    console.log(`✓ Loaded ${lang}.json (${Object.keys(translations[lang]).length} keys)`);
  } catch (error) {
    console.error(`✗ Failed to load ${lang}.json:`, error.message);
  }
});

// Read the build file
let buildContent = fs.readFileSync(buildFile, 'utf8');

// Create the embedded translations code
const embeddedCode = `
// Embedded translations for offline/immediate use
window.YouTubePlusEmbeddedTranslations = ${JSON.stringify(translations, null, 0)};
`;

// Find the i18n-loader section and inject the embedded translations before it
let i18nLoaderStart = buildContent.indexOf('/* YouTube+ i18n Loader */');

if (i18nLoaderStart === -1) {
  // Try alternative pattern
  i18nLoaderStart = buildContent.indexOf("'[YouTube+][i18n-loader] initialized'");
  if (i18nLoaderStart > 0) {
    // Go back to find the start of this function/module
    i18nLoaderStart = buildContent.lastIndexOf('(function ()', i18nLoaderStart);
  }
}

if (i18nLoaderStart === -1) {
  console.error('✗ Could not find i18n-loader section in build file');
  process.exit(1);
}

// Insert the embedded translations before the i18n-loader
buildContent = `${buildContent.slice(0, i18nLoaderStart)}${embeddedCode}\n${buildContent.slice(i18nLoaderStart)}`;

// Write back to file
fs.writeFileSync(buildFile, buildContent, 'utf8');

console.log('\n✅ Successfully embedded translations into youtube.user.js');
console.log(`📊 Total translations embedded: ${locales.length} languages`);
console.log('🔄 The userscript will now use embedded translations instead of CDN');
