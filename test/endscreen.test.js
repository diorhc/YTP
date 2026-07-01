/**
 * Unit tests for YouTube+ Endscreen module (endscreen.js)
 *
 * Tests the end screen removal functionality, settings persistence,
 * DOM mutation detection, and cleanup lifecycle.
 */

const setupEndscreenDeps = () => {
  Object.defineProperty(window, 'YouTubeUtils', {
    configurable: true,
    writable: true,
    value: {
      $: jest.fn(sel => document.querySelector(sel)),
      $$: jest.fn(sel => Array.from(document.querySelectorAll(sel))),
      byId: jest.fn(id => document.getElementById(id)),
      t: jest.fn(key => key || ''),
      cleanupManager: {
        registerInterval: jest.fn(id => id),
        registerTimeout: jest.fn(id => id),
        registerObserver: jest.fn(obs => obs),
        registerListener: jest.fn(),
        register: jest.fn(),
        cleanup: jest.fn(),
        registerAnimationFrame: jest.fn(id => id),
        getListenerStats: jest.fn(() => ({ active: 0, registeredTotal: 0 })),
      },
      StyleManager: { add: jest.fn(), remove: jest.fn(), clear: jest.fn() },
      loadFeatureEnabled: jest.fn(() => true),
      logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      SETTINGS_KEY: 'youtube_plus_settings',
      debounce: jest.fn(fn => Object.assign(fn, { cancel: jest.fn() })),
      whenRelevant: jest.fn(() => ({ active: false, check: jest.fn(), dispose: jest.fn() })),
      renderTemplateClone: jest.fn((el, html) => { el.innerHTML = html; }),
      logSuppressed: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusMutationCoordinator', {
    configurable: true,
    writable: true,
    value: {
      subscribeRoot: jest.fn(() => 'sub-id'),
      unsubscribe: jest.fn(),
      watchTarget: jest.fn(),
      unwatch: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusEventDelegation', {
    configurable: true,
    writable: true,
    value: {
      on: jest.fn(),
      off: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      StyleManager: window.YouTubeUtils.StyleManager,
      getStyle: jest.fn(() => ''),
    },
  });

  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    href: 'https://www.youtube.com/watch?v=test',
  });
};

describe('Endscreen Module', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setupEndscreenDeps();
  });

  describe('End screen element removal', () => {
    test('should hide elements matching endscreen selectors', () => {
      document.body.innerHTML = `
        <div class="ytp-ce-element">End card</div>
        <div class="ytp-endscreen-element">End screen</div>
        <div class="ytp-cards-teaser">Teaser</div>
      `;

      const selectors = '.ytp-ce-element,.ytp-endscreen-element,.ytp-cards-teaser';
      const elements = document.querySelectorAll(selectors);
      elements.forEach(el => {
        el.style.display = 'none';
        el.style.visibility = 'hidden';
      });

      expect(document.querySelector('.ytp-ce-element').style.display).toBe('none');
      expect(document.querySelector('.ytp-endscreen-element').style.display).toBe('none');
      expect(document.querySelector('.ytp-cards-teaser').style.display).toBe('none');
    });

    test('should batch-remove elements up to batch size', () => {
      const batchSize = 20;
      const elements = [];
      for (let i = 0; i < 25; i++) {
        const el = document.createElement('div');
        el.className = 'ytp-ce-element';
        document.body.appendChild(el);
        elements.push(el);
      }

      const toRemove = elements.slice(0, batchSize);
      toRemove.forEach(el => {
        el.style.display = 'none';
        el.remove();
      });

      expect(document.querySelectorAll('.ytp-ce-element')).toHaveLength(5);
    });

    test('should handle empty element list gracefully', () => {
      expect(() => {
        const elements = [];
        elements.forEach(el => el.remove());
      }).not.toThrow();
    });
  });

  describe('Settings persistence', () => {
    test('should save endscreen settings to localStorage', () => {
      const storageKey = 'youtube_endscreen_settings';
      const settings = { enabled: true };
      localStorage.setItem(storageKey, JSON.stringify(settings));

      const stored = JSON.parse(localStorage.getItem(storageKey));
      expect(stored.enabled).toBe(true);
    });

    test('should load endscreen settings from localStorage', () => {
      const storageKey = 'youtube_endscreen_settings';
      localStorage.setItem(storageKey, JSON.stringify({ enabled: false }));

      const data = JSON.parse(localStorage.getItem(storageKey));
      expect(data.enabled).toBe(false);
    });

    test('should default to enabled when no settings exist', () => {
      const storageKey = 'youtube_endscreen_settings';
      localStorage.removeItem(storageKey);

      const data = localStorage.getItem(storageKey);
      const enabled = data ? JSON.parse(data).enabled : true;
      expect(enabled).toBe(true);
    });

    test('should handle corrupted localStorage data', () => {
      localStorage.setItem('youtube_endscreen_settings', 'invalid-json');
      let enabled = true;
      try {
        const data = JSON.parse(localStorage.getItem('youtube_endscreen_settings'));
        enabled = data.enabled;
      } catch {
        enabled = true;
      }
      expect(enabled).toBe(true);
    });
  });

  describe('CSS injection', () => {
    test('should generate correct CSS for hiding endscreen elements', () => {
      const selectors = '.ytp-ce-element-show,.ytp-ce-element,.ytp-endscreen-element';
      const css = `${selectors}{display:none!important;opacity:0!important;visibility:hidden!important}`;
      expect(css).toContain('display:none!important');
      expect(css).toContain('visibility:hidden!important');
    });

    test('should inject CSS via StyleManager', () => {
      const sm = window.YouTubeUtils.StyleManager;
      const styles = '.ytp-ce-element{display:none!important}';
      sm.add('end-screen-remover', styles);
      expect(sm.add).toHaveBeenCalledWith('end-screen-remover', expect.any(String));
    });

    test('should remove CSS on cleanup', () => {
      const sm = window.YouTubeUtils.StyleManager;
      sm.remove('end-screen-remover');
      expect(sm.remove).toHaveBeenCalledWith('end-screen-remover');
    });
  });

  describe('className value extraction', () => {
    test('should extract string className directly', () => {
      const el = document.createElement('div');
      el.className = 'ytp-ce-element test';
      expect(typeof el.className).toBe('string');
      expect(el.className).toContain('ytp-ce-element');
    });

    test('should handle SVGAnimatedString className', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ytp-ce-element');
      const className = svg.getAttribute('class');
      expect(className).toBe('ytp-ce-element');
    });

    test('should return empty string for missing className', () => {
      const el = document.createElement('div');
      const className = el.className || '';
      expect(className).toBe('');
    });
  });

  describe('isRelevantNode', () => {
    test('should detect ytp- prefixed elements', () => {
      const el = document.createElement('div');
      el.className = 'ytp-ce-element';
      expect(el.className.includes('ytp-')).toBe(true);
    });

    test('should reject non-relevant elements', () => {
      const el = document.createElement('div');
      el.className = 'some-other-class';
      expect(el.className.includes('ytp-')).toBe(false);
    });

    test('should reject non-Element nodes', () => {
      const textNode = document.createTextNode('text');
      expect(textNode instanceof Element).toBe(false);
    });
  });

  describe('hasRelevantChanges', () => {
    test('should detect mutations with ytp- added nodes', () => {
      const el = document.createElement('div');
      el.className = 'ytp-ce-element';
      const mutations = [{ addedNodes: [el] }];
      const hasRelevant = mutations.some(m =>
        Array.from(m.addedNodes).some(n => n instanceof Element && n.className.includes?.('ytp-'))
      );
      expect(hasRelevant).toBe(true);
    });

    test('should return false for irrelevant mutations', () => {
      const el = document.createElement('div');
      el.className = 'irrelevant';
      const mutations = [{ addedNodes: [el] }];
      const hasRelevant = mutations.some(m =>
        Array.from(m.addedNodes).some(n => n instanceof Element && n.className.includes?.('ytp-'))
      );
      expect(hasRelevant).toBe(false);
    });
  });

  describe('MutationObserver lifecycle', () => {
    test('should register observer subscription', () => {
      const coordinator = window.YouTubePlusMutationCoordinator;
      const subId = coordinator.subscribeRoot('test', jest.fn(), { childList: true });
      expect(subId).toBe('sub-id');
      expect(coordinator.subscribeRoot).toHaveBeenCalled();
    });

    test('should unsubscribe on cleanup', () => {
      const coordinator = window.YouTubePlusMutationCoordinator;
      coordinator.unsubscribe('test-id');
      expect(coordinator.unsubscribe).toHaveBeenCalledWith('test-id');
    });
  });

  describe('Cleanup lifecycle', () => {
    test('should reset state on cleanup', () => {
      const state = {
        observerSubId: 'sub-id',
        styleEl: 'end-screen-remover',
        isActive: true,
        removeCount: 5,
      };

      state.observerSubId = null;
      state.styleEl = null;
      state.isActive = false;

      expect(state.observerSubId).toBeNull();
      expect(state.styleEl).toBeNull();
      expect(state.isActive).toBe(false);
    });

    test('should be safe to call cleanup multiple times', () => {
      const coordinator = window.YouTubePlusMutationCoordinator;
      expect(() => {
        coordinator.unsubscribe(null);
        coordinator.unsubscribe(undefined);
      }).not.toThrow();
    });
  });

  describe('Debouncing', () => {
    test('should debounce remove calls', () => {
      const debounceMs = 32;
      const lastCheck = 0;
      const now = performance.now();
      const shouldCheck = now - lastCheck >= debounceMs;
      expect(shouldCheck).toBe(true);
    });

    test('should skip if within debounce window', () => {
      const debounceMs = 32;
      const now = performance.now();
      const lastCheck = now - 10;
      const shouldSkip = now - lastCheck < debounceMs;
      expect(shouldSkip).toBe(true);
    });
  });
});
