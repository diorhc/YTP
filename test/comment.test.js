/**
 * @jest-environment jsdom
 *
 * Tests the real comment.js module surface through window.YouTubePlusComment.
 * Exercises actual bulk-management helpers, settings storage, and comment
 * translation button injection against real DOM structures.
 */

// Mirrors the utils.js test-hook gate: the mock YouTubeUtils object below
// stands in for the real surface, so it carries the same gated exposure.
const exposeTestHooks = (facade, hooks) => {
  if (window.__YTP_TEST_HOOKS__ === true) facade.testHooks = hooks;
};

describe('Comment Module', () => {
  const setupCommentDeps = () => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    const utils = {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn((key, params = {}) =>
        key === 'deleteCommentsConfirm' ? `Delete ${params?.count ?? ''} comment(s)?` : key || ''
      ),
      helpers: {
        t: jest.fn((key, params = {}) =>
          key === 'deleteCommentsConfirm' ? `Delete ${params?.count ?? ''} comment(s)?` : key || ''
        ),
        logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      },
      confirmDialog: jest.fn(() => Promise.resolve(true)),
      debounce: jest.fn(fn => fn),
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      openSafe: jest.fn(),
      renderTemplateClone: jest.fn((el, html) => {
        el.innerHTML = html;
      }),
      cleanupManager: {
        registerObserver: obs => obs,
        registerListener: (target, type, handler, opts) => {
          target?.addEventListener?.(type, handler, opts);
          return Symbol('listener-key');
        },
        registerTimer: id => id,
        registerInterval: id => id,
        cleanup: () => {
          /* mock */
        },
      },
      logError: jest.fn(),
      logSuppressed: jest.fn(),
      exposeTestHooks,
      createWithErrorBoundary: jest.fn(() => fn => fn),
      onDomReady: jest.fn(cb => cb()),
      getLanguage: jest.fn(() => 'en'),
      getRoute: () => 'watch',
      setSafeHTML: jest.fn((el, html) => {
        el.innerHTML = html;
      }),
      SETTINGS_KEY: 'youtube_plus_settings',
      storage: {
        get: (key, def = null) => {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : def;
        },
        set: (key, val) => {
          localStorage.setItem(key, JSON.stringify(val));
          return true;
        },
        remove: key => localStorage.removeItem(key),
        has: key => localStorage.getItem(key) !== null,
        getItem: key => localStorage.getItem(key),
        setItem: (key, val) => {
          localStorage.setItem(key, val);
          return true;
        },
        removeItem: key => localStorage.removeItem(key),
      },
    };

    Object.defineProperty(window, 'YouTubeUtils', {
      configurable: true,
      writable: true,
      value: utils,
    });

    Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
      configurable: true,
      writable: true,
      value: {
        subscribeRoot: jest.fn(() => 'sub-root'),
        unsubscribeRoot: jest.fn(),
        watchTarget: jest.fn(() => 'watch-target'),
        unwatch: jest.fn(),
      },
    });

    Object.defineProperty(window, 'YouTubePlusCleanupManager', {
      configurable: true,
      writable: true,
      value: {
        registerListener: (target, type, handler, opts) => {
          target?.addEventListener?.(type, handler, opts);
          return Symbol('cm-key');
        },
      },
    });

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=test',
    });
  };

  beforeEach(() => {
    jest.resetModules();
    delete window.YouTubePlusComment;
    localStorage.clear();
    sessionStorage.clear();

    setupCommentDeps();
    require('../src/comment.js');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('exposes the real API facade on window.YouTubePlusComment', () => {
    expect(window.YouTubePlusComment).toBeDefined();
    expect(window.YouTubePlusComment.testHooks.settings).toBeDefined();
    expect(typeof window.YouTubePlusComment.testHooks.settings.load).toBe('function');
    expect(typeof window.YouTubePlusComment.testHooks.settings.save).toBe('function');
    expect(typeof window.YouTubePlusComment.testHooks.addCheckboxes).toBe('function');
    expect(typeof window.YouTubePlusComment.testHooks.deleteSelectedComments).toBe('function');
    expect(typeof window.YouTubePlusComment.testHooks.addTranslateButton).toBe('function');
    expect(typeof window.YouTubePlusComment.testHooks.processComments).toBe('function');
  });

  describe('Settings Management', () => {
    test('saves settings to localStorage and retrieves them accurately', () => {
      window.YouTubePlusComment.testHooks.CONFIG.enabled = false;
      window.YouTubePlusComment.testHooks.settings.save();

      const raw = localStorage.getItem('youtube_comment_manager_settings');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw || '{}');
      expect(parsed.enabled).toBe(false);

      window.YouTubePlusComment.testHooks.CONFIG.enabled = true;
      window.YouTubePlusComment.testHooks.settings.load();
      expect(window.YouTubePlusComment.testHooks.CONFIG.enabled).toBe(false);
    });

    test('handles missing or invalid localStorage data gracefully with default config', () => {
      localStorage.removeItem('youtube_comment_manager_settings');
      window.YouTubePlusComment.testHooks.settings.load();
      expect(window.YouTubePlusComment.testHooks.CONFIG.enabled).toBe(true);

      localStorage.setItem('youtube_comment_manager_settings', 'malformed-json{');
      window.YouTubePlusComment.testHooks.settings.load();
      expect(window.YouTubePlusComment.testHooks.CONFIG.enabled).toBe(true);
    });
  });

  describe('Bulk Comment Checkboxes (addCheckboxes)', () => {
    test('injects checkboxes next to delete buttons on activity pages', () => {
      const container = document.createElement('div');
      container.className = 'activity-root';

      const comment1 = document.createElement('div');
      comment1.className = 'comment-row';
      const deleteBtn1 = document.createElement('button');
      deleteBtn1.setAttribute('aria-label', 'Delete comment 1');
      comment1.appendChild(deleteBtn1);
      container.appendChild(comment1);

      const comment2 = document.createElement('div');
      comment2.className = 'comment-row';
      const deleteBtn2 = document.createElement('button');
      deleteBtn2.setAttribute('aria-label', 'Delete comment 2');
      comment2.appendChild(deleteBtn2);
      container.appendChild(comment2);

      document.body.appendChild(container);

      window.YouTubePlusComment.testHooks.addCheckboxes();

      const checkboxes = document.querySelectorAll('.comment-checkbox');
      expect(checkboxes.length).toBe(2);
      expect(checkboxes[0].tagName).toBe('INPUT');
      expect(/** @type {HTMLInputElement} */ (checkboxes[0]).type).toBe('checkbox');
    });

    test('does not duplicate checkboxes when called multiple times', () => {
      const comment = document.createElement('div');
      const deleteBtn = document.createElement('button');
      deleteBtn.setAttribute('aria-label', 'Delete comment');
      comment.appendChild(deleteBtn);
      document.body.appendChild(comment);

      window.YouTubePlusComment.testHooks.addCheckboxes();
      expect(document.querySelectorAll('.comment-checkbox').length).toBe(1);

      window.YouTubePlusComment.testHooks.addCheckboxes();
      expect(document.querySelectorAll('.comment-checkbox').length).toBe(1);
    });
  });

  describe('Comment Translation (addTranslateButton)', () => {
    // Translation runs as a lifecycle feature: load the real manager, store
    // and registry so the feature starts with its own context.
    beforeEach(() => {
      jest.resetModules();
      delete window.YouTubePlusComment;
      delete window.YouTubePlusCleanupManager;
      require('../src/cleanup-manager.js');
      require('../src/settings-store.js');
      require('../src/feature-registry.js');
      require('../src/comment.js');
    });

    afterEach(() => {
      window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
      delete window.YouTubePlusFeatureRegistry;
    });

    test('injects translate button into YouTube comment elements', () => {
      const commentThread = document.createElement('ytd-comment-thread-renderer');
      const contentText = document.createElement('div');
      contentText.id = 'content-text';
      contentText.textContent = 'This is a great video!';
      commentThread.appendChild(contentText);

      const actionButtons = document.createElement('div');
      actionButtons.id = 'action-buttons';
      commentThread.appendChild(actionButtons);

      document.body.appendChild(commentThread);

      window.YouTubePlusComment.testHooks.addTranslateButton(commentThread);

      const btn = commentThread.querySelector('.yp-comment-translate-btn');
      expect(btn).not.toBeNull();
      expect(btn?.tagName).toBe('BUTTON');
      expect(btn?.getAttribute('aria-label')).toBeDefined();
    });

    test('processComments injects buttons and removeTranslateButtons sweeps them', () => {
      const thread = document.createElement('ytd-comment-thread-renderer');
      const text = document.createElement('div');
      text.id = 'content-text';
      text.textContent = 'Hello world from comment';
      thread.appendChild(text);
      document.body.appendChild(thread);

      window.YouTubePlusComment.testHooks.processComments();
      expect(thread.querySelector('.yp-comment-translate-btn')).not.toBeNull();

      window.YouTubePlusComment.testHooks.removeTranslateButtons();
      expect(thread.querySelector('.yp-comment-translate-btn')).toBeNull();
    });

    test('translates text on button click and toggles back to original', async () => {
      const thread = document.createElement('ytd-comment-thread-renderer');
      const text = document.createElement('div');
      text.id = 'content-text';
      text.textContent = 'Hello world';
      thread.appendChild(text);
      document.body.appendChild(thread);

      window.YouTubePlusComment.testHooks.addTranslateButton(thread);
      const btn = thread.querySelector('.yp-comment-translate-btn');
      expect(btn).not.toBeNull();

      const origFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [[['Hola mundo', 'Hello world']]],
      });

      btn.click();
      await new Promise(r => setTimeout(r, 20));

      expect(text.textContent).toBe('Hola mundo');

      // Click again to revert to original
      btn.click();
      expect(text.textContent).toBe('Hello world');

      global.fetch = origFetch;
    });

    test('a failed translation re-enables the button', async () => {
      const thread = document.createElement('ytd-comment-thread-renderer');
      const text = document.createElement('div');
      text.id = 'content-text';
      text.textContent = 'Hello error';
      thread.appendChild(text);
      document.body.appendChild(thread);

      window.YouTubePlusComment.testHooks.addTranslateButton(thread);
      const btn = thread.querySelector('.yp-comment-translate-btn');
      expect(btn).not.toBeNull();

      const origFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Network fail'));

      btn?.click();
      await new Promise(r => setTimeout(r, 20));

      expect(btn?.disabled).toBe(false);
      global.fetch = origFetch;
    });
  });

  describe('Host and Route detection', () => {
    test('accurately identifies trusted MyActivity hosts and routes', () => {
      expect(window.YouTubePlusComment.testHooks.isTrustedMyActivityHost()).toBe(false);
      expect(window.YouTubePlusComment.testHooks.isMyActivityHost()).toBe(false);
      expect(window.YouTubePlusComment.testHooks.isMyActivityCommentsPage()).toBe(false);
    });
  });

  describe('Bulk Comment Controls & Action Handlers', () => {
    test('addControlButtons creates panel and wires select/clear/delete actions', async () => {
      jest.useFakeTimers();
      const container = document.createElement('div');
      container.className = 'activity-root';

      const row = document.createElement('div');
      const deleteBtn = document.createElement('button');
      deleteBtn.setAttribute('aria-label', 'Delete comment');
      const deleteClickSpy = jest.fn();
      deleteBtn.addEventListener('click', deleteClickSpy);
      row.appendChild(deleteBtn);
      container.appendChild(row);
      document.body.appendChild(container);

      window.YouTubePlusComment.testHooks.addCheckboxes();
      window.YouTubePlusComment.testHooks.addControlButtons();

      const panel = document.querySelector('.comment-controls-panel');
      expect(panel).not.toBeNull();

      const checkbox = document.querySelector('.comment-checkbox');
      expect(checkbox).not.toBeNull();
      expect(checkbox.checked).toBe(false);

      const buttons = panel.querySelectorAll('button');
      const deleteActionBtn = panel.querySelector('.comment-controls-button-delete');
      const selectAllBtn = Array.from(buttons).find(b => b.textContent === 'selectAll');
      const clearAllBtn = Array.from(buttons).find(b => b.textContent === 'clearAll');

      expect(deleteActionBtn.disabled).toBe(true);

      // Select all
      selectAllBtn.click();
      expect(checkbox.checked).toBe(true);
      expect(deleteActionBtn.disabled).toBe(false);

      // Clear all
      clearAllBtn.click();
      expect(checkbox.checked).toBe(false);
      expect(deleteActionBtn.disabled).toBe(true);

      // Delete flow with confirm
      checkbox.checked = true;
      window.YouTubePlusComment.testHooks.updateDeleteButtonState();
      expect(deleteActionBtn.disabled).toBe(false);

      const confirmSpy = jest.spyOn(window, 'confirm');
      deleteActionBtn.click();
      // The in-UI confirm dialog resolves before the deletion timers run.
      await Promise.resolve();
      await Promise.resolve();

      jest.advanceTimersByTime(500);
      expect(deleteClickSpy).toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();

      jest.clearAllTimers();
      jest.useRealTimers();
    });

    test('bulk delete asks the in-UI confirm dialog, never native confirm', async () => {
      jest.useFakeTimers();
      const container = document.createElement('div');

      const row = document.createElement('div');
      const deleteBtn = document.createElement('button');
      deleteBtn.setAttribute('aria-label', 'Delete comment');
      const deleteClickSpy = jest.fn();
      deleteBtn.addEventListener('click', deleteClickSpy);
      row.appendChild(deleteBtn);
      container.appendChild(row);
      document.body.appendChild(container);

      window.YouTubePlusComment.testHooks.addCheckboxes();
      window.YouTubePlusComment.testHooks.addControlButtons();

      const checkbox = document.querySelector('.comment-checkbox');
      checkbox.checked = true;

      const confirmSpy = jest.spyOn(window, 'confirm');
      const dialogStub = window.YouTubeUtils.confirmDialog;
      await window.YouTubePlusComment.testHooks.deleteSelectedComments();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(dialogStub).toHaveBeenCalledTimes(1);
      // The message goes through the dictionary with the {count} param.
      expect(dialogStub.mock.calls[0][0].message).toBe('Delete 1 comment(s)?');

      jest.advanceTimersByTime(500);
      expect(deleteClickSpy).toHaveBeenCalled();

      jest.clearAllTimers();
      jest.useRealTimers();
    });

    test('settings integration wires open-comment-history-page and experimental nav click', () => {
      const openBtn = document.createElement('button');
      openBtn.id = 'open-comment-history-page';
      document.body.appendChild(openBtn);

      document.dispatchEvent(new Event('youtube-plus-settings-modal-opened'));
      expect(openBtn.dataset.handlerAttached).toBe('true');

      const navItem = document.createElement('div');
      navItem.className = 'yp-settings-nav-item';
      navItem.dataset.section = 'experimental';
      document.body.appendChild(navItem);

      expect(() => {
        navItem.click();
      }).not.toThrow();
    });
  });

  describe('Extended coverage for Comment module', () => {
    test('isTrustedMyActivityHost and route checks', () => {
      expect(window.YouTubePlusComment.testHooks.isTrustedMyActivityHost()).toBe(false);
      expect(window.YouTubePlusComment.testHooks.isMyActivityHost()).toBe(false);
      expect(window.YouTubePlusComment.testHooks.isMyActivityCommentsPage()).toBe(false);
    });

    test('settings load and save methods', () => {
      window.YouTubePlusComment.testHooks.settings.save();
      window.YouTubePlusComment.testHooks.settings.load();
      expect(window.YouTubePlusComment.testHooks.CONFIG.enabled).toBe(true);
    });

    test('registerListenerSafe fallback when utils.cleanupManager throws', () => {
      const origCM = window.YouTubeUtils.cleanupManager;
      window.YouTubeUtils.cleanupManager = {
        registerListener: () => {
          throw new Error('boom');
        },
      };
      const btn = document.createElement('button');
      const text = document.createElement('div');
      text.id = 'content-text';
      text.textContent = 'Some comment';
      const container = document.createElement('div');
      container.appendChild(text);
      container.appendChild(btn);
      document.body.appendChild(container);

      expect(() => {
        window.YouTubePlusComment.testHooks.addTranslateButton(container);
      }).not.toThrow();

      window.YouTubeUtils.cleanupManager = origCM;
    });
  });
});
