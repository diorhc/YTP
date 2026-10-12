/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const enLocale = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'en.json'), 'utf8'));
const ruLocale = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'ru.json'), 'utf8'));

describe('Resume overlay i18n network latency and dynamic update', () => {
  let rootScope;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();

    // Install real WebCrypto subtle in jsdom for locale SHA-256 verification
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: nodeCrypto.webcrypto,
    });

    // Provide embedded English dictionary synchronously
    globalThis.__YouTubePlusEmbeddedDictionaries__ = {
      en: { data: enLocale },
    };

    localStorage.clear();
    document.body.innerHTML = '<div id="movie_player"></div>';
    document.documentElement.lang = 'ru';

    // Mock fetch with 2000ms delay for ru.json
    global.fetch = jest.fn(url => {
      const urlStr = String(url);
      if (urlStr.includes('ru.json')) {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              text: async () => JSON.stringify(ruLocale),
            });
          }, 2000);
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${urlStr}`));
    });

    // Load dependencies
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/settings-store.js');
    require('../src/safe-dom.js');
    require('../src/feature-registry.js');
    require('../src/design-system.js');
    require('../src/i18n.js');
    require('../src/time.js');

    rootScope = window.YouTubePlusFeatureRegistry.FeatureLifecycle.createContext('time-resume');
  });

  afterEach(() => {
    if (rootScope) {
      rootScope.dispose();
    }
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('uses embedded en immediately under slow network, then updates resume overlay when ru dictionary arrives', async () => {
    const i18n = window.YouTubePlusI18n;
    expect(i18n).toBeDefined();

    // 1. Immediately at boot before ru dictionary arrives:
    // isReady() is false
    expect(i18n.isReady()).toBe(false);

    // t('resumePlayback') returns English from embedded dictionary, not raw key
    expect(i18n.t('resumePlayback')).toBe('Resume playback?');
    expect(i18n.t('resume')).toBe('Resume');
    expect(i18n.t('startOver')).toBe('Start over');

    // 2. Open resume overlay
    const timeResume = window.YouTubePlusTimeResume;
    expect(timeResume).toBeDefined();

    timeResume.createOverlay(45, jest.fn(), jest.fn(), 'test-vid-123', rootScope);

    const overlay = document.getElementById('yt-resume-overlay');
    expect(overlay).not.toBeNull();

    const titleEl = overlay.querySelector('.yp-resume-title');
    const resumeBtn = overlay.querySelector('.yp-resume-btn.primary');
    const restartBtn = overlay.querySelector('.yp-resume-btn.ghost');

    expect(titleEl).not.toBeNull();
    expect(resumeBtn).not.toBeNull();
    expect(restartBtn).not.toBeNull();

    // Verify initial English labels in overlay
    expect(titleEl.textContent).toContain('Resume playback?');
    expect(resumeBtn.textContent).toBe('Resume');
    expect(restartBtn.textContent).toBe('Start over');

    // 3. Advance timers by 2000ms to simulate slow network resolution
    await jest.advanceTimersByTimeAsync(2000);
    // Let any remaining microtasks/webcrypto promises flush
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    // Advance any 0ms ticks
    await jest.advanceTimersByTimeAsync(10);
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    // After dictionary arrives, i18n is ready and current language is ru
    expect(i18n.isReady()).toBe(true);
    expect(i18n.getLanguage()).toBe('ru');

    // t() now returns Russian
    expect(i18n.t('resumePlayback')).toBe('Продолжить воспроизведение?');
    expect(i18n.t('resume')).toBe('Продолжить');
    expect(i18n.t('startOver')).toBe('Начать сначала');

    // 4. Overlay automatically updated to Russian
    expect(titleEl.textContent).toContain('Продолжить воспроизведение?');
    expect(resumeBtn.textContent).toBe('Продолжить');
    expect(restartBtn.textContent).toBe('Начать сначала');
  });
});
