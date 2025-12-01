/**
 * Translation Completeness Analyzer
 * Analyzes all modules for i18n usage and checks translation completeness
 */

const fs = require('fs');
const path = require('path');

// Read i18n.js to extract all translations
const i18nPath = path.join(__dirname, 'src', 'i18n.js');
const i18nContent = fs.readFileSync(i18nPath, 'utf8');

// Extract supported languages
const languages = ['en', 'ru', 'kr', 'fr', 'du', 'cn', 'tw', 'jp', 'tr'];

console.log('='.repeat(80));
console.log('YOUTUBE+ TRANSLATION COMPLETENESS ANALYSIS');
console.log('='.repeat(80));
console.log(`\nSupported Languages: ${languages.join(', ')}`);

// Extract all translation keys for English (reference)
const enMatch = i18nContent.match(/en:\s*\{([\s\S]*?)\n\s+\},\n\s+ru:/);
if (!enMatch) {
  console.error('Could not extract English translations');
  process.exit(1);
}

const enSection = enMatch[1];
const keyPattern = /\s+([a-zA-Z_]+):/g;
let match;
const enKeys = new Set();
while ((match = keyPattern.exec(enSection)) !== null) {
  if (match[1] !== 'en') {
    // Skip if it's just a nested object key
    enKeys.add(match[1]);
  }
}

console.log(`\nTotal English translation keys: ${enKeys.size}`);

// Extract keys for each language and compare
const missingTranslations = {};
const stats = {};

for (const lang of languages) {
  if (lang === 'en') {
    stats[lang] = { total: enKeys.size, missing: 0, complete: 100 };
    continue;
  }

  // Extract language section
  const nextLangIndex = languages.indexOf(lang) + 1;
  const nextLang = nextLangIndex < languages.length ? languages[nextLangIndex] : null;

  let langPattern;
  if (nextLang) {
    langPattern = new RegExp(`${lang}:\\s*\\{([\\s\\S]*?)\\n\\s+\\},\\n\\s+${nextLang}:`, 'm');
  } else {
    // Last language (tr)
    langPattern = new RegExp(`${lang}:\\s*\\{([\\s\\S]*?)\\n\\s+\\},\\n\\s+\\};`, 'm');
  }

  const langMatch = i18nContent.match(langPattern);
  if (!langMatch) {
    console.error(`Could not extract ${lang} translations`);
    missingTranslations[lang] = Array.from(enKeys);
    stats[lang] = { total: 0, missing: enKeys.size, complete: 0 };
    continue;
  }

  const langSection = langMatch[1];
  const langKeys = new Set();
  const langKeyPattern = /\s+([a-zA-Z_]+):/g;
  let keyMatch;

  while ((keyMatch = langKeyPattern.exec(langSection)) !== null) {
    langKeys.add(keyMatch[1]);
  }

  // Find missing keys
  const missing = [];
  for (const key of enKeys) {
    if (!langKeys.has(key)) {
      missing.push(key);
    }
  }

  missingTranslations[lang] = missing;
  const complete = ((langKeys.size / enKeys.size) * 100).toFixed(1);
  stats[lang] = {
    total: langKeys.size,
    missing: missing.length,
    complete: parseFloat(complete),
  };
}

// Display statistics
console.log(`\n${'='.repeat(80)}`);
console.log('TRANSLATION STATISTICS BY LANGUAGE');
console.log('='.repeat(80));
console.log('\nLang  | Total Keys | Missing Keys | Completion |');
console.log('------|------------|--------------|------------|');
for (const lang of languages) {
  const s = stats[lang];
  const bar = '█'.repeat(Math.floor(s.complete / 5)) + '░'.repeat(20 - Math.floor(s.complete / 5));
  console.log(
    `${lang.padEnd(6)}| ${String(s.total).padEnd(10)} | ${String(s.missing).padEnd(12)} | ${String(s.complete).padStart(6)}% ${bar} |`
  );
}

// Display missing translations details
console.log(`\n${'='.repeat(80)}`);
console.log('MISSING TRANSLATIONS DETAILS');
console.log('='.repeat(80));

let hasMissing = false;
for (const lang of languages) {
  if (lang === 'en') continue;
  const missing = missingTranslations[lang];
  if (missing && missing.length > 0) {
    hasMissing = true;
    console.log(`\n${lang.toUpperCase()} (${missing.length} missing keys):`);
    console.log('-'.repeat(80));
    for (let i = 0; i < Math.min(missing.length, 20); i++) {
      console.log(`  - ${missing[i]}`);
    }
    if (missing.length > 20) {
      console.log(`  ... and ${missing.length - 20} more`);
    }
  }
}

if (!hasMissing) {
  console.log('\n✅ All languages have complete translations!');
}

// Analyze module usage
console.log(`\n${'='.repeat(80)}`);
console.log('MODULE TRANSLATION USAGE ANALYSIS');
console.log('='.repeat(80));

const srcDir = path.join(__dirname, 'src');
const modules = fs
  .readdirSync(srcDir)
  .filter(f => f.endsWith('.js') && f !== 'i18n.js' && f !== 'constants.js');

const usageByModule = {};

for (const moduleName of modules) {
  const modulePath = path.join(srcDir, moduleName);
  const content = fs.readFileSync(modulePath, 'utf8');

  // Find translation keys used in module
  const patterns = [
    /\.t\(['"]([a-zA-Z_]+)['"]\)/g,
    /getText\(['"]([a-zA-Z_]+)['"]\)/g,
    /i18n\.t\(['"]([a-zA-Z_]+)['"]\)/g,
    /YouTubeUtils\.t\(['"]([a-zA-Z_]+)['"]\)/g,
    /YouTubePlusI18n\.t\(['"]([a-zA-Z_]+)['"]\)/g,
  ];

  const usedKeys = new Set();
  for (const pattern of patterns) {
    let keyMatch2;
    while ((keyMatch2 = pattern.exec(content)) !== null) {
      usedKeys.add(keyMatch2[1]);
    }
  }

  if (usedKeys.size > 0) {
    usageByModule[moduleName] = Array.from(usedKeys).sort();
  }
}

console.log(`\nModules using translations: ${Object.keys(usageByModule).length}`);
console.log('-'.repeat(80));
for (const [module, keys] of Object.entries(usageByModule)) {
  console.log(`\n${module} (${keys.length} keys):`);
  console.log(`  ${keys.join(', ')}`);

  // Check for missing keys
  const missingKeys = keys.filter(k => !enKeys.has(k));
  if (missingKeys.length > 0) {
    console.log(`  ⚠️  MISSING IN i18n.js: ${missingKeys.join(', ')}`);
  }
}

// Summary
console.log(`\n${'='.repeat(80)}`);
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`Total translation keys: ${enKeys.size}`);
console.log(`Supported languages: ${languages.length}`);

const avgCompletion =
  languages.slice(1).reduce((sum, lang) => sum + stats[lang].complete, 0) / (languages.length - 1);
console.log(`Average completion (excluding English): ${avgCompletion.toFixed(1)}%`);

const incompleteLangs = languages.filter(lang => lang !== 'en' && stats[lang].missing > 0).length;
if (incompleteLangs > 0) {
  console.log(`\n⚠️  ${incompleteLangs} language(s) have missing translations`);
  console.log('   Run this script to see details and fix them.');
} else {
  console.log('\n✅ All languages are complete!');
}

console.log(`\n${'='.repeat(80)}`);
