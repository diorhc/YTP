const fs = require('fs');
const content = fs.readFileSync('youtube.user.js', 'utf8');

const modules = [
  'utils',
  'basic',
  'thumbnail',
  'timecode',
  'update',
  'comment',
  'adblocker',
  'enhanced',
  'main',
  'stats',
  'playlist-search',
  'style',
];

console.log('Проверка модулей в youtube.user.js:\n');

modules.forEach(m => {
  const markerComment = `// === src/${m}.js ===`;
  const markerPath = `src/${m}.js`;
  const foundComment = content.includes(markerComment);
  const foundPath = content.includes(markerPath);

  console.log(`${m}.js: ${foundComment || foundPath ? '✓ включён' : '✗ отсутствует'}`);
});

// Проверка YouTubeUtils
const hasYouTubeUtils = content.includes('window.YouTubeUtils');
const hasWindowYouTubeUtils = content.includes('window).YouTubeUtils');

console.log(
  `\nYouTubeUtils экспорт: ${hasYouTubeUtils || hasWindowYouTubeUtils ? '✓ найден' : '✗ не найден'}`
);

// Количество IIFE
const iifeCount = (content.match(/\(function\s*\(\)/g) || []).length;
console.log(`\nКоличество IIFE: ${iifeCount}`);
