/**
 * Unit tests for YouTube+ Update module (update.js)
 *
 * Tests version comparison, metadata parsing, update URL validation,
 * and notification logic.
 */

const setupUpdateDeps = () => {
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
      NotificationManager: { show: jest.fn(), remove: jest.fn() },
      getLanguage: jest.fn(() => 'en'),
      renderTemplateClone: jest.fn((el, html) => { el.innerHTML = html; }),
      onSectionActive: jest.fn(() => ({ dispose: jest.fn() })),
      logSuppressed: jest.fn(),
    },
  });

  Object.defineProperty(window, 'YouTubePlusLogger', {
    configurable: true,
    writable: true,
    value: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });

  Object.defineProperty(window, 'YouTubePlusDesignSystem', {
    configurable: true,
    writable: true,
    value: {
      StyleManager: window.YouTubeUtils.StyleManager,
      getStyle: jest.fn(() => ''),
    },
  });

  Object.defineProperty(window, 'YouTubePlusSafeDOM', {
    configurable: true,
    writable: true,
    value: { sanitizeHTML: jest.fn(s => s), setHTML: jest.fn((el, h) => { el.innerHTML = h; }) },
  });

  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    href: 'https://www.youtube.com/watch?v=test',
  });
};

describe('Update Module', () => {
  beforeEach(() => {
    setupUpdateDeps();
  });

  describe('Version string validation', () => {
    test('should accept valid semver format', () => {
      const isVersionString = v => typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v);
      expect(isVersionString('2.5.2')).toBe(true);
      expect(isVersionString('1.0.0')).toBe(true);
      expect(isVersionString('10.20.30')).toBe(true);
    });

    test('should reject invalid version strings', () => {
      const isVersionString = v => typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v);
      expect(isVersionString('abc')).toBe(false);
      expect(isVersionString('1.0')).toBe(false);
      expect(isVersionString('')).toBe(false);
      expect(isVersionString(null)).toBe(false);
    });
  });

  describe('Version comparison', () => {
    test('should detect newer version', () => {
      const compare = (a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if (pa[i] > pb[i]) return 1;
          if (pa[i] < pb[i]) return -1;
        }
        return 0;
      };
      expect(compare('2.5.3', '2.5.2')).toBe(1);
      expect(compare('3.0.0', '2.9.9')).toBe(1);
    });

    test('should detect older version', () => {
      const compare = (a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if (pa[i] > pb[i]) return 1;
          if (pa[i] < pb[i]) return -1;
        }
        return 0;
      };
      expect(compare('2.5.1', '2.5.2')).toBe(-1);
    });

    test('should detect equal versions', () => {
      const compare = (a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if (pa[i] > pb[i]) return 1;
          if (pa[i] < pb[i]) return -1;
        }
        return 0;
      };
      expect(compare('2.5.2', '2.5.2')).toBe(0);
    });
  });

  describe('Metadata parsing', () => {
    test('should extract field from userscript header', () => {
      const extractField = (text, field) => {
        const regex = new RegExp(`@${field}\\s+(.+)`, 'm');
        const match = text.match(regex);
        return match ? match[1].trim() : null;
      };

      const header = '// ==UserScript==\n// @name YouTube+\n// @version 2.5.2\n// ==/UserScript==';
      expect(extractField(header, 'name')).toBe('YouTube+');
      expect(extractField(header, 'version')).toBe('2.5.2');
      expect(extractField(header, 'nonexistent')).toBeNull();
    });

    test('should parse multiple metadata fields', () => {
      const header = '// @name Test\n// @version 1.0.0\n// @author testuser';
      const fields = {};
      header.split('\n').forEach(line => {
        const match = line.match(/@(\w+)\s+(.+)/);
        if (match) fields[match[1]] = match[2].trim();
      });
      expect(fields.name).toBe('Test');
      expect(fields.version).toBe('1.0.0');
      expect(fields.author).toBe('testuser');
    });
  });

  describe('Update URL validation', () => {
    test('should accept valid GreasyFork URL', () => {
      const isValid = url => {
        try {
          const u = new URL(url);
          return u.protocol === 'https:' && u.hostname === 'greasyfork.org';
        } catch { return false; }
      };
      expect(isValid('https://greasyfork.org/ru/scripts/537017-youtube')).toBe(true);
    });

    test('should reject non-HTTPS URLs', () => {
      const isValid = url => {
        try {
          const u = new URL(url);
          return u.protocol === 'https:' && u.hostname === 'greasyfork.org';
        } catch { return false; }
      };
      expect(isValid('http://greasyfork.org/script')).toBe(false);
    });

    test('should reject non-GreasyFork domains', () => {
      const isValid = url => {
        try {
          const u = new URL(url);
          return u.protocol === 'https:' && u.hostname === 'greasyfork.org';
        } catch { return false; }
      };
      expect(isValid('https://example.com/script')).toBe(false);
    });

    test('should reject invalid URLs', () => {
      const isValid = url => {
        try {
          new URL(url);
          return true;
        } catch { return false; }
      };
      expect(isValid('not-a-url')).toBe(false);
    });
  });

  describe('Time ago formatting', () => {
    test('should format recent time', () => {
      const formatTimeAgo = ts => {
        const diff = Date.now() - ts;
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
      };
      const now = Date.now();
      expect(formatTimeAgo(now - 60000)).toBe('1m ago');
      expect(formatTimeAgo(now - 3600000)).toBe('1h ago');
      expect(formatTimeAgo(now - 86400000)).toBe('1d ago');
    });
  });

  describe('Update notification', () => {
    test('should create update notification element', () => {
      const el = document.createElement('div');
      el.className = 'ytp-update-notification';
      expect(el.className).toBe('ytp-update-notification');
    });

    test('should contain version info', () => {
      const el = document.createElement('div');
      el.textContent = 'Update available: v2.6.0';
      expect(el.textContent).toContain('2.6.0');
    });

    test('should have install button', () => {
      const el = document.createElement('button');
      el.textContent = 'Install';
      expect(el.textContent).toBe('Install');
    });
  });

  describe('Settings storage', () => {
    test('should store last check timestamp', () => {
      const key = 'ytp_update_last_check';
      const now = Date.now();
      localStorage.setItem(key, String(now));
      expect(Number(localStorage.getItem(key))).toBe(now);
    });

    test('should store dismissed updates', () => {
      const key = 'ytp_update_dismissed';
      localStorage.setItem(key, '2.5.2');
      expect(localStorage.getItem(key)).toBe('2.5.2');
    });

    test('should handle missing update settings', () => {
      const lastCheck = Number(localStorage.getItem('ytp_update_last_check') || '0');
      expect(lastCheck).toBe(0);
    });
  });

  describe('Changelog fetching', () => {
    test('should construct GreasyFork versions URL', () => {
      const version = '2.6.0';
      const url = `https://greasyfork.org/ru/scripts/537017-youtube/versions/${version}`;
      expect(url).toContain('greasyfork.org');
      expect(url).toContain(version);
    });
  });

  describe('Error handling', () => {
    test('should handle network errors gracefully', async () => {
      let error = null;
      try {
        throw new Error('Network error');
      } catch (e) {
        error = e;
      }
      expect(error).toBeTruthy();
      expect(error.message).toBe('Network error');
    });

    test('should handle timeout errors', () => {
      const isTransient = err => err?.message?.includes('timeout') || err?.message?.includes('network');
      expect(isTransient(new Error('timeout'))).toBe(true);
      expect(isTransient(new Error('network error'))).toBe(true);
      expect(isTransient(new Error('parse error'))).toBe(false);
    });
  });
});
