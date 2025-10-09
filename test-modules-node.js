// Тест функциональности модулей в Node.js окружении

const vm = require('vm');
const fs = require('fs');

console.log('🧪 Тестирование модулей YouTube+\n');

// Создаём mock окружение
const sandbox = {
  console,
  window: {},
  document: {
    createElement: () => ({}),
    head: { appendChild: () => {} },
    addEventListener: () => {},
    readyState: 'complete',
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  setTimeout: setTimeout,
  setInterval: setInterval,
  clearTimeout: clearTimeout,
  clearInterval: clearInterval,
  requestAnimationFrame: cb => setTimeout(cb, 16),
  cancelAnimationFrame: clearTimeout,
  trustedTypes: undefined,
  CustomElementRegistry: function () {},
  HTMLElement: function () {},
  Node: function () {},
  Element: function () {},
  MutationObserver: function () {},
  IntersectionObserver: function () {},
  ResizeObserver: function () {},
  // GM API
  GM_xmlhttpRequest: () => {},
  unsafeWindow: null,
};

sandbox.window = sandbox;
sandbox.unsafeWindow = sandbox.window;

// Загружаем userscript
const code = fs.readFileSync('youtube.user.js', 'utf8');

console.log('📦 Загрузка userscript...');

try {
  const script = new vm.Script(code, { filename: 'youtube.user.js' });
  script.runInNewContext(sandbox, { timeout: 5000 });

  console.log('✅ Userscript загружен без ошибок\n');

  // Проверяем экспорты
  console.log('🔍 Проверка экспортированных объектов:\n');

  if (sandbox.window.YouTubeUtils) {
    console.log('✅ window.YouTubeUtils найден');
    console.log('   Методы:');
    for (const key of Object.keys(sandbox.window.YouTubeUtils)) {
      const type = typeof sandbox.window.YouTubeUtils[key];
      const icon = type === 'function' || type === 'object' ? '✅' : '⚠️';
      console.log(`   ${icon} ${key}: ${type}`);
    }
  } else {
    console.log('❌ window.YouTubeUtils НЕ найден');
  }

  console.log('');

  if (sandbox.window.YouTubePlusDebug) {
    console.log('✅ window.YouTubePlusDebug найден');
    if (typeof sandbox.window.YouTubePlusDebug.stats === 'function') {
      try {
        const stats = sandbox.window.YouTubePlusDebug.stats();
        console.log('   Статистика:', JSON.stringify(stats, null, 2));
      } catch (e) {
        console.log('   ⚠️ Ошибка при вызове stats():', e.message);
      }
    }
  } else {
    console.log('❌ window.YouTubePlusDebug НЕ найден');
  }

  console.log('\n📊 Итоговый статус:');
  const hasUtils = !!sandbox.window.YouTubeUtils;
  const hasDebug = !!sandbox.window.YouTubePlusDebug;

  if (hasUtils && hasDebug) {
    console.log('✅ Все основные модули инициализированы успешно');
  } else {
    console.log('⚠️ Некоторые модули не инициализированы:');
    if (!hasUtils) console.log('   ❌ YouTubeUtils отсутствует');
    if (!hasDebug) console.log('   ❌ YouTubePlusDebug отсутствует');
  }
} catch (error) {
  console.error('❌ Ошибка при загрузке userscript:');
  console.error('   Сообщение:', error.message);
  console.error('   Стек:', error.stack);
}
