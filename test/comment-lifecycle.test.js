/**
 * Comment Translation (src/comment.js) on the FeatureLifecycle contract
 * (feature-registry.js). Real CleanupManager, SettingsStore, EventDelegation,
 * MutationCoordinator and DesignSystem; only fetch is stubbed for the
 * translation request.
 * @jest-environment jsdom
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
  require('../src/mutation-coordinator.js');
  require('../src/comment.js');
}

const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;
const store = () => window.YouTubePlusSettingsStore;

function counts() {
  const cm = window.YouTubePlusCleanupManager;
  const mc = window.YouTubePlusMutationCoordinator;
  return {
    listeners: cm.getListenerStats().active,
    observers: cm.observers.size,
    timeouts: cm.timeouts.size + cm.sessionTimeouts.size,
    watchers: mc.getStats().rootSubscribers,
    delegated: window.YouTubePlusEventDelegation?.getStats?.().totalHandlers ?? 0,
  };
}

const styleText = () => [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');

/** @param {number} count */
function addThreads(count) {
  const threads = [];
  for (let i = 0; i < count; i++) {
    const thread = document.createElement('ytd-comment-thread-renderer');
    const content = document.createElement('div');
    content.id = 'content-text';
    content.textContent = `Comment number ${i} carries a body long enough to translate`;
    thread.appendChild(content);
    const actions = document.createElement('div');
    actions.id = 'action-buttons';
    thread.appendChild(actions);
    document.body.appendChild(thread);
    threads.push(thread);
  }
  return threads;
}

describe('comment translate on the lifecycle contract', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=lifecycle',
    });
    loadChain();
    store().set('enableCommentTranslate', false);
    require('../src/comment.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('10 on/off cycles return to the starting counts and leave no DOM, CSS or attributes', () => {
    addThreads(3);
    store().set('enableCommentTranslate', true);
    expect(lifecycle().isRunning('commentTranslate')).toBe(true);
    expect(document.querySelectorAll('.yp-comment-translate-btn')).toHaveLength(3);
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-comment-translate-styles')).toBe(
      true
    );

    store().set('enableCommentTranslate', false);
    expect(lifecycle().isRunning('commentTranslate')).toBe(false);
    expect(document.querySelectorAll('.yp-comment-translate-btn')).toHaveLength(0);
    expect(window.YouTubePlusDesignSystem.StyleManager.has('yp-comment-translate-styles')).toBe(
      false
    );
    const baseline = counts();
    const css = styleText();

    for (let i = 0; i < 10; i++) {
      store().set('enableCommentTranslate', true);
      expect(document.querySelectorAll('.yp-comment-translate-btn')).toHaveLength(3);
      store().set('enableCommentTranslate', false);
      expect(document.querySelectorAll('.yp-comment-translate-btn')).toHaveLength(0);
    }

    expect(counts()).toEqual(baseline);
    expect(styleText()).toBe(css);
    expect(document.querySelectorAll('[data-yp-translated]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-yp-original-text]')).toHaveLength(0);
  });

  test('translation still works after it is switched off and on again', async () => {
    const [thread] = addThreads(1);
    const content = thread.querySelector('#content-text');

    store().set('enableCommentTranslate', true);
    const btn = thread.querySelector('.yp-comment-translate-btn');
    expect(btn).not.toBeNull();

    const origFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [[['Переведённый комментарий', 'x']]] });
    try {
      btn.click();
      await new Promise(r => setTimeout(r, 20));
      expect(content.textContent).toBe('Переведённый комментарий');
      expect(content.hasAttribute('data-yp-translated')).toBe(true);

      // Off and on again: the restored original keeps translating.
      store().set('enableCommentTranslate', false);
      store().set('enableCommentTranslate', true);
      const rebuilt = thread.querySelector('.yp-comment-translate-btn');
      expect(rebuilt).not.toBeNull();
      expect(content.textContent).toBe('Comment number 0 carries a body long enough to translate');

      rebuilt.click();
      await new Promise(r => setTimeout(r, 20));
      expect(content.textContent).toBe('Переведённый комментарий');
    } finally {
      global.fetch = origFetch;
      store().set('enableCommentTranslate', false);
    }
  });

  test('watch and navigation reprocess comments through the feature ctx', async () => {
    store().set('enableCommentTranslate', true);

    // A comment thread that arrives after start flows through the MutationCoordinator watch.
    const [lateThread] = addThreads(1);
    await new Promise(r => setTimeout(r, 450));
    expect(lateThread.querySelector('.yp-comment-translate-btn')).not.toBeNull();

    // A navigation event reprocesses through the feature-owned listener.
    window.dispatchEvent(new Event('yt-navigate-finish'));
    await new Promise(r => setTimeout(r, 450));
    expect(document.querySelectorAll('.yp-comment-translate-btn')).toHaveLength(1);

    store().set('enableCommentTranslate', false);
    expect(document.querySelector('.yp-comment-translate-btn')).toBeNull();
    expect(document.querySelectorAll('[data-yp-translated]')).toHaveLength(0);
  });

  test('translate button keeps working after the per-navigation listener sweep', async () => {
    const [thread] = addThreads(1);
    const content = thread.querySelector('#content-text');

    store().set('enableCommentTranslate', true);
    const btn = thread.querySelector('.yp-comment-translate-btn');
    expect(btn).not.toBeNull();

    window.YouTubePlusCleanupManager.cleanup();
    expect(btn.isConnected).toBe(true);

    const origFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [[['Перевод переживает навигацию', 'x']]] });
    try {
      btn.click();
      await new Promise(r => setTimeout(r, 20));
      expect(content.textContent).toBe('Перевод переживает навигацию');
      expect(content.hasAttribute('data-yp-translated')).toBe(true);
    } finally {
      global.fetch = origFetch;
      store().set('enableCommentTranslate', false);
    }
  });

  test('late translation response after stop cannot touch the DOM', async () => {
    const [thread] = addThreads(1);
    const content = thread.querySelector('#content-text');
    const originalText = 'Comment number 0 carries a body long enough to translate';

    store().set('enableCommentTranslate', true);
    const btn = thread.querySelector('.yp-comment-translate-btn');
    expect(btn).not.toBeNull();

    let resolveFetch;
    const origFetch = global.fetch;
    global.fetch = jest.fn(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve;
        })
    );
    try {
      btn.click();
      await new Promise(r => setTimeout(r, 20));
      const signal = global.fetch.mock.calls[0][1].signal;
      expect(signal.aborted).toBe(false);

      store().set('enableCommentTranslate', false);
      expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(thread.querySelector('.yp-comment-translate-btn')).toBeNull();

      // The response still arrives, but the DOM stays untouched.
      resolveFetch({ ok: true, json: async () => [[['Поздний перевод', 'x']]] });
      await new Promise(r => setTimeout(r, 20));
      expect(content.textContent).toBe(originalText);
      expect(content.hasAttribute('data-yp-translated')).toBe(false);
      expect(content.hasAttribute('data-yp-original-text')).toBe(false);
    } finally {
      global.fetch = origFetch;
    }
  });

  test('a malformed translation payload is rejected and the comment text is unchanged', async () => {
    const [thread] = addThreads(1);
    const content = thread.querySelector('#content-text');
    const originalText = content.textContent;

    store().set('enableCommentTranslate', true);
    const btn = thread.querySelector('.yp-comment-translate-btn');
    const origFetch = global.fetch;
    // The segment is a number instead of the expected [string, ...] pair.
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [[123]] });
    try {
      btn.click();
      await new Promise(r => setTimeout(r, 20));
      expect(content.textContent).toBe(originalText);
      expect(content.hasAttribute('data-yp-translated')).toBe(false);
    } finally {
      global.fetch = origFetch;
      store().set('enableCommentTranslate', false);
    }
  });

  test('a translation longer than the limit is rejected and the comment text is unchanged', async () => {
    const [thread] = addThreads(1);
    const content = thread.querySelector('#content-text');
    const originalText = content.textContent;

    store().set('enableCommentTranslate', true);
    const btn = thread.querySelector('.yp-comment-translate-btn');
    const origFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [[['x'.repeat(6000)]]] });
    try {
      btn.click();
      await new Promise(r => setTimeout(r, 20));
      expect(content.textContent).toBe(originalText);
      expect(content.hasAttribute('data-yp-translated')).toBe(false);
    } finally {
      global.fetch = origFetch;
      store().set('enableCommentTranslate', false);
    }
  });
});
