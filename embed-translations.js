/**
 * Embed Translations into Build
 * This script embeds all translation files directly into the userscript
 * for immediate use without requiring CDN fetches
 *
 * Usage:
 *   1. Run `npm run build` to create youtube.user.js
 *   2. Run `node embed-translations.js` to embed translations
 *   3. The script finds the i18n module (by searching for GITHUB_CONFIG)
 *   4. It injects `window.YouTubePlusEmbeddedTranslations` before the i18n module
 *   5. The i18n module will use embedded translations as a fast local fallback
 *
 * Note: Run this after every build to keep translations embedded
 */

/* Allow console usage in this build/tool script. These logs are for developer output. */

const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, 'locales');
// Embed into both the optimized and unoptimized build outputs so userscripts
// installed from either file will contain embedded translations.
const buildFiles = [
  path.join(__dirname, 'youtube.user.js'),
  path.join(__dirname, 'youtube.user.unoptimized.js'),
];

// Read all locale files
const locales = [
  'en',
  'ru',
  'kr',
  'fr',
  'du',
  'cn',
  'tw',
  'jp',
  'tr',
  'de',
  'es',
  'ar',
  'hi',
  'id',
  'it',
  'pl',
  'pt',
  'uk',
  'vi',
];
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

// Read and patch each build file (optimized + unoptimized when present)
for (const buildFile of buildFiles) {
  if (!fs.existsSync(buildFile)) {
    console.warn(`⚠️ Build file not found, skipping: ${buildFile}`);
    continue;
  }

  let buildContent = fs.readFileSync(buildFile, 'utf8');

  // Check if translations are already embedded and remove old versions
  const embeddedMarker = '// Embedded translations for offline/immediate use';
  if (buildContent.includes(embeddedMarker)) {
    console.log(
      `⚠️  Translations already embedded in ${path.basename(buildFile)}, removing old version...`
    );

    // Find and remove each embedded translation block
    let startIndex;
    while ((startIndex = buildContent.indexOf(embeddedMarker)) !== -1) {
      // Find the end of the embedded translations line (ends with };)
      const endMarker = '};';
      let endIndex = buildContent.indexOf(endMarker, startIndex);

      if (endIndex !== -1) {
        // Move past the }; and any trailing newlines
        endIndex += endMarker.length;
        while (
          endIndex < buildContent.length &&
          (buildContent[endIndex] === '\n' || buildContent[endIndex] === '\r')
        ) {
          endIndex++;
        }

        // Remove this embedded translation block
        buildContent = buildContent.slice(0, startIndex) + buildContent.slice(endIndex);
      } else {
        // Safety: if we can't find the end, break to avoid infinite loop
        console.warn('⚠️  Could not find end of embedded translations block');
        break;
      }
    }
  }

  // Create the embedded translations code
  const embeddedCode = `
// Embedded translations for offline/immediate use
window.YouTubePlusEmbeddedTranslations = ${JSON.stringify(translations, null, 0)};
`;

  // Find the i18n module section and inject the embedded translations before it
  // Look for the GITHUB_CONFIG marker that starts the i18n module
  let i18nLoaderStart = buildContent.indexOf('const GITHUB_CONFIG = {');

  if (i18nLoaderStart === -1) {
    console.error('✗ Could not find i18n module section in build file');
    console.error('   Looking for: const GITHUB_CONFIG = {');
    process.exit(1);
  }

  // Go back to find the start of this IIFE/module (the (function () { before GITHUB_CONFIG)
  const functionStart = buildContent.lastIndexOf('(function () {', i18nLoaderStart);
  if (functionStart !== -1 && i18nLoaderStart - functionStart < 100) {
    i18nLoaderStart = functionStart;
  }

  // Insert the embedded translations before the i18n-loader
  buildContent = `${buildContent.slice(0, i18nLoaderStart)}${embeddedCode}\n${buildContent.slice(i18nLoaderStart)}`;

  // Write back to file
  fs.writeFileSync(buildFile, buildContent, 'utf8');

  console.log(`\n✅ Successfully embedded translations into ${path.basename(buildFile)}`);
}

console.log(`\n📊 Total translations embedded: ${locales.length} languages`);
console.log('🔄 The userscript(s) will now use embedded translations instead of CDN');
