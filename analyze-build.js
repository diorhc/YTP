const fs = require('fs');

const content = fs.readFileSync('youtube.user.js', 'utf8');
const lines = content.split('\n');

console.log('📊 Анализ youtube.user.js\n');
console.log('Всего строк:', lines.length);

// Найти все модули
const modules = content.match(/\/\/ --- MODULE: .+ ---/g);
if (modules) {
  console.log('\n📦 Найдено модулей:', modules.length);
  modules.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
} else {
  console.log('\n❌ Модули НЕ НАЙДЕНЫ');
}

// Проверить экспорт YouTubeUtils
const youtubeUtilsExport =
  content.includes('window.YouTubeUtils') || content.includes('window).YouTubeUtils');
console.log('\n🔧 YouTubeUtils экспорт:', youtubeUtilsExport ? '✅ Найден' : '❌ НЕ НАЙДЕН');

// Подсчитать IIFE
const iifes = (content.match(/\(function\s*\(\s*\)\s*\{/g) || []).length;
console.log('🔒 IIFE функций:', iifes);

// Проверить инициализацию
const hasInit =
  content.includes('[YouTube+] Core utilities merged') || content.includes('YouTubePlusDebug');
console.log('🚀 Инициализация:', hasInit ? '✅ Найдена' : '❌ НЕ НАЙДЕНА');

// Проверить ошибки
const hasBindError = content.includes('.bind(YouTubeEnhancer)');
console.log('⚠️  .bind() проблемы:', hasBindError ? '❌ Найдены' : '✅ Отсутствуют');

// Размер файла
const sizeKB = (content.length / 1024).toFixed(2);
console.log('\n📁 Размер файла:', sizeKB, 'KB');
