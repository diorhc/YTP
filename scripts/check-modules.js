const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(root, 'youtube.user.js');
const orderPath = path.join(root, 'build.order.json');

const content = fs.readFileSync(bundlePath, 'utf8');
const moduleOrder = JSON.parse(fs.readFileSync(orderPath, 'utf8'));

console.log('Проверка модульной склейки в youtube.user.js:\n');

/** @type {string[]} */
const missingModules = [];

for (const moduleName of moduleOrder) {
  const marker = `// --- MODULE: ${moduleName} ---`;
  const found = content.includes(marker);
  if (!found) {
    missingModules.push(moduleName);
  }
  console.log(`${moduleName}: ${found ? '✓ включён' : '✗ отсутствует'}`);
}

const hasYouTubeUtils = content.includes('window.YouTubeUtils');
const hasWindowYouTubeUtils = content.includes('window).YouTubeUtils');
const hasUtilsExport = hasYouTubeUtils || hasWindowYouTubeUtils;

console.log(`\nYouTubeUtils экспорт: ${hasUtilsExport ? '✓ найден' : '✗ не найден'}`);

const iifeCount = (content.match(/\(function\s*\(\)/g) || []).length;
console.log(`Количество IIFE: ${iifeCount}`);

if (missingModules.length > 0) {
  console.error(`\n❌ Отсутствуют модули: ${missingModules.join(', ')}`);
  process.exit(1);
}

if (!hasUtilsExport) {
  console.error('\n❌ Не найден экспорт YouTubeUtils');
  process.exit(1);
}

console.log('\n✅ Проверка модульной склейки пройдена');
